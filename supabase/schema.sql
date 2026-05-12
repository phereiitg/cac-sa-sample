-- ============================================================
-- Summer Analytics 2025 — Native Quiz Upgrade Patch
-- Safely applies the new schema changes over your existing DB.
-- ============================================================

-- 1. Add the new native quiz configuration columns to the existing table
ALTER TABLE public.quiz_config 
  ADD COLUMN IF NOT EXISTS shuffle_questions boolean default true,
  ADD COLUMN IF NOT EXISTS shuffle_options boolean default false,
  ADD COLUMN IF NOT EXISTS show_result_immediately boolean default true;

-- 2. Create the brand new quiz_questions table
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id             uuid default gen_random_uuid() primary key,
  week_number    int not null,
  question_text  text not null,
  option_a       text not null,
  option_b       text not null,
  option_c       text,
  option_d       text,
  correct_option text not null check (correct_option in ('A','B','C','D')),
  explanation    text,
  marks          int default 1,
  sort_order     int default 0,
  created_at     timestamptz default now()
);

-- 3. Enable Security and Policies for the new table
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'quiz_questions' 
        AND policyname = 'quiz_questions: admin all'
    ) THEN
        CREATE POLICY "quiz_questions: admin all" ON public.quiz_questions FOR ALL
        USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin));
    END IF;
END $$;

-- 4. Create the secure functions (RPCs) to fetch and grade questions
CREATE OR REPLACE FUNCTION public.get_quiz_questions(p_week_number int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cfg record;
  v_qs  jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_cfg FROM public.quiz_config WHERE week_number = p_week_number;
  IF NOT FOUND             THEN RAISE EXCEPTION 'No quiz configured for week %', p_week_number; END IF;
  IF NOT v_cfg.is_active   THEN RAISE EXCEPTION 'Quiz is not active'; END IF;
  IF v_cfg.opens_at  IS NOT NULL AND now() < v_cfg.opens_at  THEN RAISE EXCEPTION 'Quiz has not opened yet'; END IF;
  IF v_cfg.closes_at IS NOT NULL AND now() > v_cfg.closes_at THEN RAISE EXCEPTION 'Quiz window has closed';  END IF;

  IF EXISTS (SELECT 1 FROM public.quiz_scores WHERE user_id = auth.uid() AND week_number = p_week_number) THEN
    RAISE EXCEPTION 'Already submitted';
  END IF;

  IF v_cfg.shuffle_questions THEN
    SELECT jsonb_agg(q) INTO v_qs FROM (
      SELECT id, week_number, question_text, option_a, option_b, option_c, option_d, marks
      FROM public.quiz_questions WHERE week_number = p_week_number ORDER BY random()
    ) q;
  ELSE
    SELECT jsonb_agg(q ORDER BY q.sort_order) INTO v_qs FROM (
      SELECT id, week_number, question_text, option_a, option_b, option_c, option_d, marks, sort_order
      FROM public.quiz_questions WHERE week_number = p_week_number
    ) q;
  END IF;

  RETURN jsonb_build_object(
    'questions',   COALESCE(v_qs, '[]'::jsonb),
    'time_limit',  v_cfg.time_limit_mins,
    'quiz_title',  v_cfg.quiz_title,
    'shuffle_opts',v_cfg.shuffle_options
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_quiz(
  p_week_number  int,
  p_answers      jsonb,
  p_time_secs    int default 0,
  p_tab_switches int default 0,
  p_fs_exits     int default 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_email    text;
  v_score    numeric := 0;
  v_max      numeric := 0;
  v_pct      numeric := 0;
  v_detail   jsonb   := '[]'::jsonb;
  q          record;
  v_selected text;
  v_ok       boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;

  IF EXISTS (SELECT 1 FROM public.quiz_scores WHERE user_id = v_uid AND week_number = p_week_number) THEN
    RAISE EXCEPTION 'Already submitted';
  END IF;

  FOR q IN SELECT * FROM public.quiz_questions WHERE week_number = p_week_number ORDER BY sort_order LOOP
    v_max := v_max + q.marks;

    SELECT upper(trim(elem->>'selected')) INTO v_selected
      FROM jsonb_array_elements(p_answers) elem
     WHERE elem->>'question_id' = q.id::text
     LIMIT 1;

    v_ok := (v_selected = upper(q.correct_option));
    IF v_ok THEN v_score := v_score + q.marks; END IF;

    v_detail := v_detail || jsonb_build_array(jsonb_build_object(
      'question',   q.question_text,
      'option_a',   q.option_a, 'option_b', q.option_b,
      'option_c',   q.option_c, 'option_d', q.option_d,
      'chosen',     COALESCE(v_selected, '—'),
      'correct',    q.correct_option,
      'is_correct', v_ok,
      'explanation',COALESCE(q.explanation,''),
      'marks',      q.marks
    ));
  END LOOP;

  IF v_max > 0 THEN v_pct := round((v_score / v_max) * 100, 2); END IF;

  INSERT INTO public.quiz_scores
    (user_id, email, week_number, score, max_score, percentage,
     answers, tab_switches, fullscreen_exits, time_taken_secs)
  VALUES
    (v_uid, v_email, p_week_number, v_score, v_max, v_pct,
     v_detail, p_tab_switches, p_fs_exits, p_time_secs);

  RETURN jsonb_build_object(
    'score', v_score, 'max_score', v_max, 'percentage', v_pct, 'answers', v_detail
  );
END;
$$;

-- 5. Grant permissions to use the functions
GRANT EXECUTE ON FUNCTION public.get_quiz_questions(int)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz(int,jsonb,int,int,int)   TO authenticated;

-- 6. Add Index for performance
CREATE INDEX IF NOT EXISTS idx_quiz_questions_week ON public.quiz_questions (week_number, sort_order);