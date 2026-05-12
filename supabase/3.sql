-- ================================================================
-- FIX: Enable RLS and create admin policies for quiz tables
-- ================================================================

-- 1. Secure the quiz_questions table
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

-- Allow anyone (or just authenticated students) to read the questions
CREATE POLICY "questions_select_policy" 
ON public.quiz_questions FOR SELECT 
USING (true);

-- Allow ONLY admins to insert, update, or delete questions
CREATE POLICY "questions_admin_insert" 
ON public.quiz_questions FOR INSERT 
WITH CHECK (public.is_admin());

CREATE POLICY "questions_admin_update" 
ON public.quiz_questions FOR UPDATE 
USING (public.is_admin());

CREATE POLICY "questions_admin_delete" 
ON public.quiz_questions FOR DELETE 
USING (public.is_admin());

-- 2. Secure the quiz_config table
ALTER TABLE public.quiz_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quiz_config_select" 
ON public.quiz_config FOR SELECT 
USING (true);

-- FIXED: "FOR ALL" is the correct Postgres syntax
CREATE POLICY "quiz_config_admin_all" 
ON public.quiz_config FOR ALL 
USING (public.is_admin());