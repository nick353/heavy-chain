-- Durable per-task state for Lightchain-compatible workflows.
CREATE TABLE IF NOT EXISTS public.lightchain_task_steps (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES public.generation_jobs(id) ON DELETE CASCADE,
    image_id UUID REFERENCES public.generated_images(id) ON DELETE SET NULL,
    brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    lightchain_feature_id TEXT NOT NULL,
    lightchain_feature_title TEXT NOT NULL,
    task_code TEXT NOT NULL,
    step_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'retryable')),
    source_workspace TEXT,
    workflow_version TEXT,
    request_id TEXT,
    artifact_uri TEXT,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

ALTER TABLE public.lightchain_task_steps ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.lightchain_task_steps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.lightchain_task_steps TO authenticated;
GRANT ALL ON TABLE public.lightchain_task_steps TO service_role;

CREATE POLICY "Brand viewers can view Lightchain task steps"
    ON public.lightchain_task_steps FOR SELECT
    TO authenticated
    USING (
        brand_id IN (SELECT id FROM public.brands WHERE owner_id = auth.uid())
        OR brand_id IN (
            SELECT brand_id
            FROM public.brand_members
            WHERE user_id = auth.uid()
              AND joined_at IS NOT NULL
        )
    );

CREATE POLICY "Brand editors can create Lightchain task steps"
    ON public.lightchain_task_steps FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND (
            brand_id IN (SELECT id FROM public.brands WHERE owner_id = auth.uid())
            OR brand_id IN (
                SELECT brand_id
                FROM public.brand_members
                WHERE user_id = auth.uid()
                  AND role IN ('owner', 'admin', 'editor')
                  AND joined_at IS NOT NULL
            )
        )
    );

CREATE POLICY "Brand editors can update Lightchain task steps"
    ON public.lightchain_task_steps FOR UPDATE
    TO authenticated
    USING (
        brand_id IN (SELECT id FROM public.brands WHERE owner_id = auth.uid())
        OR brand_id IN (
            SELECT brand_id
            FROM public.brand_members
            WHERE user_id = auth.uid()
              AND role IN ('owner', 'admin', 'editor')
              AND joined_at IS NOT NULL
        )
    )
    WITH CHECK (
        brand_id IN (SELECT id FROM public.brands WHERE owner_id = auth.uid())
        OR brand_id IN (
            SELECT brand_id
            FROM public.brand_members
            WHERE user_id = auth.uid()
              AND role IN ('owner', 'admin', 'editor')
              AND joined_at IS NOT NULL
        )
    );

CREATE INDEX IF NOT EXISTS idx_lightchain_task_steps_job ON public.lightchain_task_steps(job_id);
CREATE INDEX IF NOT EXISTS idx_lightchain_task_steps_image ON public.lightchain_task_steps(image_id);
CREATE INDEX IF NOT EXISTS idx_lightchain_task_steps_brand ON public.lightchain_task_steps(brand_id);
CREATE INDEX IF NOT EXISTS idx_lightchain_task_steps_task_code ON public.lightchain_task_steps(task_code);
CREATE INDEX IF NOT EXISTS idx_lightchain_task_steps_status ON public.lightchain_task_steps(status);
CREATE INDEX IF NOT EXISTS idx_lightchain_task_steps_created ON public.lightchain_task_steps(created_at DESC);

DROP TRIGGER IF EXISTS update_lightchain_task_steps_updated_at ON public.lightchain_task_steps;
CREATE TRIGGER update_lightchain_task_steps_updated_at
    BEFORE UPDATE ON public.lightchain_task_steps
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
