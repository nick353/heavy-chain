-- Internal beta feedback capture with private screenshots.

CREATE TYPE public.feedback_submission_status AS ENUM ('new', 'in_progress', 'done');
CREATE TYPE public.feedback_screenshot_capture_status AS ENUM ('captured', 'screenshot_capture_failed', 'screenshot_upload_failed');

CREATE TABLE IF NOT EXISTS public.feedback_submissions (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('lost', 'result', 'save', 'speed', 'other')),
  message TEXT NOT NULL CHECK (char_length(trim(message)) > 0),
  email TEXT,
  page_url TEXT NOT NULL,
  pathname TEXT NOT NULL,
  viewport JSONB NOT NULL DEFAULT '{}',
  user_agent TEXT,
  screenshot_path TEXT,
  screenshot_capture_status public.feedback_screenshot_capture_status NOT NULL DEFAULT 'captured',
  status public.feedback_submission_status NOT NULL DEFAULT 'new',
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_created_at
  ON public.feedback_submissions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_status
  ON public.feedback_submissions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user
  ON public.feedback_submissions(user_id, created_at DESC);

DROP TRIGGER IF EXISTS set_feedback_submissions_updated_at ON public.feedback_submissions;
CREATE TRIGGER set_feedback_submissions_updated_at
  BEFORE UPDATE ON public.feedback_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "Users can insert own beta feedback" ON public.feedback_submissions;
CREATE POLICY "Users can insert own beta feedback"
  ON public.feedback_submissions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'new'
    AND admin_note IS NULL
    AND resolved_at IS NULL
    AND screenshot_path IS NULL
    AND screenshot_capture_status IN ('screenshot_capture_failed', 'screenshot_upload_failed')
    AND (
      brand_id IS NULL
      OR private.has_brand_role(brand_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "Users can view own beta feedback" ON public.feedback_submissions;
CREATE POLICY "Users can view own beta feedback"
  ON public.feedback_submissions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR private.is_current_user_admin());

DROP POLICY IF EXISTS "Admins can update beta feedback" ON public.feedback_submissions;
CREATE POLICY "Admins can update beta feedback"
  ON public.feedback_submissions FOR UPDATE
  TO authenticated
  USING (private.is_current_user_admin())
  WITH CHECK (private.is_current_user_admin());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('feedback-screenshots', 'feedback-screenshots', false, 5242880, ARRAY['image/png'])
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png'];

DROP POLICY IF EXISTS "Users can upload own feedback screenshots" ON storage.objects;

DROP POLICY IF EXISTS "Users and admins can view feedback screenshots" ON storage.objects;
CREATE POLICY "Users and admins can view feedback screenshots"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'feedback-screenshots'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR private.is_current_user_admin()
    )
  );

DROP POLICY IF EXISTS "Users can update own feedback screenshots" ON storage.objects;

DROP POLICY IF EXISTS "Users can delete own feedback screenshots" ON storage.objects;

GRANT SELECT, INSERT ON TABLE public.feedback_submissions TO authenticated;
GRANT UPDATE(status, admin_note, resolved_at) ON TABLE public.feedback_submissions TO authenticated;
GRANT ALL ON TABLE public.feedback_submissions TO service_role;
