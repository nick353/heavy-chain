-- Migration: Make job_id optional for generated_images
-- This allows Edge Functions to insert images without creating a job first

-- Drop the foreign key constraint first
ALTER TABLE public.generated_images 
    DROP CONSTRAINT IF EXISTS generated_images_job_id_fkey;

-- Make job_id nullable
ALTER TABLE public.generated_images 
    ALTER COLUMN job_id DROP NOT NULL;

-- Re-add the foreign key constraint with ON DELETE SET NULL
ALTER TABLE public.generated_images 
    ADD CONSTRAINT generated_images_job_id_fkey 
    FOREIGN KEY (job_id) 
    REFERENCES public.generation_jobs(id) 
    ON DELETE SET NULL;

-- Add image_url column to store direct URL (for cases where storage fails)
ALTER TABLE public.generated_images 
    ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add model_used column
ALTER TABLE public.generated_images 
    ADD COLUMN IF NOT EXISTS model_used TEXT;

-- Add generation_params column (JSONB)
ALTER TABLE public.generated_images 
    ADD COLUMN IF NOT EXISTS generation_params JSONB DEFAULT '{}';

-- Make expires_at optional with default
ALTER TABLE public.generated_images 
    ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '30 days');

ALTER TABLE public.generated_images 
    ALTER COLUMN expires_at DROP NOT NULL;

-- Comment
COMMENT ON COLUMN public.generated_images.job_id IS 'Optional reference to generation job';
COMMENT ON COLUMN public.generated_images.image_url IS 'Direct URL to image (used when storage is unavailable)';

