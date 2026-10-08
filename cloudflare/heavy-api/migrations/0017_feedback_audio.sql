-- Optional voice memo attached to feedback, stored privately next to the screenshot.
ALTER TABLE feedback_submissions ADD COLUMN audio_path TEXT;
ALTER TABLE feedback_submissions ADD COLUMN audio_sha256 TEXT;
ALTER TABLE feedback_submissions ADD COLUMN audio_bytes INTEGER;
ALTER TABLE feedback_submissions ADD COLUMN audio_type TEXT;
