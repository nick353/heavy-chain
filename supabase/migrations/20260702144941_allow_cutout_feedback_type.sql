-- Allow beta feedback to capture AI cutout quality issues as a first-class category.

ALTER TABLE public.feedback_submissions
  DROP CONSTRAINT IF EXISTS feedback_submissions_type_check;

ALTER TABLE public.feedback_submissions
  ADD CONSTRAINT feedback_submissions_type_check
  CHECK (type IN ('lost', 'cutout', 'result', 'save', 'speed', 'other'));
