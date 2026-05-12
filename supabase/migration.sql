-- ================================================================
-- MIGRATION v2 — Summer Analytics 2025
-- Run this in Supabase SQL Editor AFTER the original schema.sql.
-- It is idempotent — safe to run multiple times.
-- ================================================================

-- ── Fix 3: Remove unique constraint on quiz_config.week_number
--    Quizzes are now identified by their UUID, not week_number.
--    week_number becomes a display label only.
ALTER TABLE public.quiz_config DROP CONSTRAINT IF EXISTS quiz_config_week_number_key;

-- ── Fix 3: quiz_questions belong to a specific quiz (not just a week)
ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS quiz_config_id uuid REFERENCES public.quiz_config(id) ON DELETE CASCADE;

-- ── Fix 4: Image support for questions
ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS question_image_url text;

-- ── Fix 2: Results release control — admin decides when students see scores
ALTER TABLE public.quiz_config ADD COLUMN IF NOT EXISTS results_released     boolean     DEFAULT false;
ALTER TABLE public.quiz_config ADD COLUMN IF NOT EXISTS results_released_at  timestamptz;

-- ── Fix 3: quiz_scores now reference the specific quiz config
ALTER TABLE public.quiz_scores
  ADD COLUMN IF NOT EXISTS quiz_config_id uuid REFERENCES public.quiz_config(id) ON DELETE SET NULL;

-- ── Fix 3: Change uniqueness from (user, week) → (user, quiz_config)
ALTER TABLE public.quiz_scores DROP CONSTRAINT IF EXISTS quiz_scores_user_id_week_number_key;
ALTER TABLE public.quiz_scores
  ADD CONSTRAINT quiz_scores_user_quiz UNIQUE (user_id, quiz_config_id);

-- ── Fix 6: Flexible tasks per day — JSONB array of task columns.
--    Structure: [[{label,url}, ...], [{label,url}, ...], ...]
--    Outer index = task column (0,1,2…); inner = multiple links per column.
ALTER TABLE public.week_days ADD COLUMN IF NOT EXISTS tasks_json jsonb DEFAULT '[]'::jsonb;

-- ── Fix 9: Admin can read ALL profiles (needed for violations join + leaderboard)
DROP POLICY IF EXISTS "profiles: own select"  ON public.profiles;
DROP POLICY IF EXISTS "profiles: select"      ON public.profiles;
CREATE POLICY "profiles: select" ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR (SELECT is_admin FROM public.profiles WHERE id = auth.uid())
  );

-- Keep insert/update policies (drop duplicates first)
DROP POLICY IF EXISTS "profiles: own insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles: own update" ON public.profiles;
CREATE POLICY "profiles: own insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles: own update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- ── Fix 4: Supabase Storage bucket for question images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quiz-images', 'quiz-images', true,
  5242880,   -- 5 MB
  ARRAY['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']
) ON CONFLICT (id) DO NOTHING;

-- Storage policy: admins can upload, everyone can read
CREATE POLICY "quiz-images: public read" ON storage.objects FOR SELECT
  USING (bucket_id = 'quiz-images');

CREATE POLICY "quiz-images: admin upload" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'quiz-images'
    AND (SELECT is_admin FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "quiz-images: admin delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'quiz-images'
    AND (SELECT is_admin FROM public.profiles WHERE id = auth.uid())
  );

-- ================================================================
-- Updated RPC: get_quiz_questions  (now takes quiz_config_id UUID)
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_quiz_questions(p_quiz_config_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cfg record;
  v_qs  jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_cfg FROM public.quiz_config WHERE id = p_quiz_config_id;
  IF NOT FOUND               THEN RAISE EXCEPTION 'Quiz not found'; END IF;
  IF NOT v_cfg.is_active     THEN RAISE EXCEPTION 'Quiz is not active'; END IF;
  IF v_cfg.opens_at  IS NOT NULL AND now() < v_cfg.opens_at  THEN RAISE EXCEPTION 'Quiz has not opened yet'; END IF;
  IF v_cfg.closes_at IS NOT NULL AND now() > v_cfg.closes_at THEN RAISE EXCEPTION 'Quiz window has closed'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.quiz_scores
    WHERE user_id = auth.uid() AND quiz_config_id = p_quiz_config_id
  ) THEN RAISE EXCEPTION 'Already submitted'; END IF;

  IF v_cfg.shuffle_questions THEN
    SELECT jsonb_agg(q) INTO v_qs FROM (
      SELECT id, question_text, option_a, option_b, option_c, option_d, marks, question_image_url
      FROM public.quiz_questions
      WHERE quiz_config_id = p_quiz_config_id ORDER BY random()
    ) q;
  ELSE
    SELECT jsonb_agg(q ORDER BY q.sort_order) INTO v_qs FROM (
      SELECT id, question_text, option_a, option_b, option_c, option_d, marks, sort_order, question_image_url
      FROM public.quiz_questions
      WHERE quiz_config_id = p_quiz_config_id
    ) q;
  END IF;

  RETURN jsonb_build_object(
    'questions',      COALESCE(v_qs, '[]'::jsonb),
    'time_limit',     v_cfg.time_limit_mins,
    'quiz_title',     v_cfg.quiz_title,
    'quiz_config_id', v_cfg.id::text
  );
END;
$$;

-- ================================================================
-- Updated RPC: submit_quiz  (takes quiz_config_id, not week_number)
-- ================================================================
CREATE OR REPLACE FUNCTION public.submit_quiz(
  p_quiz_config_id uuid,
  p_answers        jsonb,
  p_time_secs      int DEFAULT 0,
  p_tab_switches   int DEFAULT 0,
  p_fs_exits       int DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text;
  v_score  numeric := 0;
  v_max    numeric := 0;
  v_pct    numeric := 0;
  v_detail jsonb   := '[]'::jsonb;
  v_cfg    record;
  q        record;
  v_sel    text;
  v_ok     boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;

  SELECT * INTO v_cfg FROM public.quiz_config WHERE id = p_quiz_config_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz configuration not found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.quiz_scores
    WHERE user_id = v_uid AND quiz_config_id = p_quiz_config_id
  ) THEN RAISE EXCEPTION 'Already submitted'; END IF;

  -- Grade all questions for this quiz
  FOR q IN
    SELECT * FROM public.quiz_questions
    WHERE quiz_config_id = p_quiz_config_id ORDER BY sort_order
  LOOP
    v_max := v_max + q.marks;

    SELECT upper(trim(elem->>'selected')) INTO v_sel
      FROM jsonb_array_elements(p_answers) elem
     WHERE elem->>'question_id' = q.id::text
     LIMIT 1;

    v_ok := (v_sel = upper(q.correct_option));
    IF v_ok THEN v_score := v_score + q.marks; END IF;

    v_detail := v_detail || jsonb_build_array(jsonb_build_object(
      'question',    q.question_text,
      'option_a',    q.option_a,  'option_b',   q.option_b,
      'option_c',    q.option_c,  'option_d',   q.option_d,
      'chosen',      COALESCE(v_sel, '—'),
      'correct',     q.correct_option,
      'is_correct',  v_ok,
      'explanation', COALESCE(q.explanation, ''),
      'marks',       q.marks
    ));
  END LOOP;

  IF v_max > 0 THEN v_pct := ROUND((v_score / v_max) * 100, 2); END IF;

  INSERT INTO public.quiz_scores
    (user_id, email, week_number, quiz_config_id, score, max_score, percentage,
     answers, tab_switches, fullscreen_exits, time_taken_secs)
  VALUES
    (v_uid, v_email, v_cfg.week_number, p_quiz_config_id, v_score, v_max, v_pct,
     v_detail, p_tab_switches, p_fs_exits, p_time_secs);

  RETURN jsonb_build_object(
    'score', v_score, 'max_score', v_max, 'percentage', v_pct, 'answers', v_detail
  );
END;
$$;

-- Re-grant (old overload with p_week_number is replaced)
REVOKE ALL ON FUNCTION public.get_quiz_questions(int)            FROM authenticated;
REVOKE ALL ON FUNCTION public.submit_quiz(int,jsonb,int,int,int) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.get_quiz_questions(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz(uuid,jsonb,int,int,int)   TO authenticated;

-- ================================================================
-- Index updates
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_quiz_questions_cfg ON public.quiz_questions (quiz_config_id);
CREATE INDEX IF NOT EXISTS idx_quiz_scores_cfg    ON public.quiz_scores    (quiz_config_id);