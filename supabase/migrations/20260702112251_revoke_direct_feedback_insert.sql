-- Route beta feedback writes through the submit-feedback Edge Function only.

DROP POLICY IF EXISTS "Users can insert own beta feedback" ON public.feedback_submissions;

REVOKE INSERT ON TABLE public.feedback_submissions FROM authenticated;
GRANT SELECT ON TABLE public.feedback_submissions TO authenticated;
GRANT ALL ON TABLE public.feedback_submissions TO service_role;
