-- Heavy Chain Database Schema
-- Version: 1.0
-- Date: 2024

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    language TEXT DEFAULT 'ja',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
    ON public.users FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.users FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON public.users FOR INSERT
    WITH CHECK (auth.uid() = id);

-- ============================================
-- BRANDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.brands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    logo_url TEXT,
    brand_colors JSONB DEFAULT '{}',
    tone_description TEXT,
    target_audience TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for brands
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own brands"
    ON public.brands FOR SELECT
    USING (owner_id = auth.uid());

CREATE POLICY "Users can create brands"
    ON public.brands FOR INSERT
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update own brands"
    ON public.brands FOR UPDATE
    USING (owner_id = auth.uid());

CREATE POLICY "Users can delete own brands"
    ON public.brands FOR DELETE
    USING (owner_id = auth.uid());

-- ============================================
-- BRAND MEMBERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.brand_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    joined_at TIMESTAMPTZ,
    UNIQUE(brand_id, user_id)
);

-- RLS for brand_members
ALTER TABLE public.brand_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brand members can view their memberships"
    ON public.brand_members FOR SELECT
    USING (user_id = auth.uid() OR 
           brand_id IN (SELECT id FROM public.brands WHERE owner_id = auth.uid()));

CREATE POLICY "Brand owners can manage members"
    ON public.brand_members FOR ALL
    USING (brand_id IN (SELECT id FROM public.brands WHERE owner_id = auth.uid()));

-- ============================================
-- GENERATION JOBS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.generation_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    feature_type TEXT NOT NULL,
    input_params JSONB NOT NULL DEFAULT '{}',
    optimized_prompt TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- RLS for generation_jobs
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own jobs"
    ON public.generation_jobs FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can create jobs"
    ON public.generation_jobs FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own jobs"
    ON public.generation_jobs FOR UPDATE
    USING (user_id = auth.uid());

-- ============================================
-- GENERATED IMAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.generated_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES public.generation_jobs(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    thumbnail_path TEXT,
    version INTEGER DEFAULT 1,
    parent_image_id UUID REFERENCES public.generated_images(id) ON DELETE SET NULL,
    is_favorite BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- RLS for generated_images
ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own images"
    ON public.generated_images FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can insert images"
    ON public.generated_images FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own images"
    ON public.generated_images FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete own images"
    ON public.generated_images FOR DELETE
    USING (user_id = auth.uid());

-- ============================================
-- FOLDERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    parent_folder_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for folders
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage folders in own brands"
    ON public.folders FOR ALL
    USING (brand_id IN (SELECT id FROM public.brands WHERE owner_id = auth.uid()));

-- ============================================
-- TAGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(brand_id, name)
);

-- RLS for tags
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage tags in own brands"
    ON public.tags FOR ALL
    USING (brand_id IN (SELECT id FROM public.brands WHERE owner_id = auth.uid()));

-- ============================================
-- IMAGE TAGS TABLE (Junction)
-- ============================================
CREATE TABLE IF NOT EXISTS public.image_tags (
    image_id UUID NOT NULL REFERENCES public.generated_images(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (image_id, tag_id)
);

-- RLS for image_tags
ALTER TABLE public.image_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage image tags"
    ON public.image_tags FOR ALL
    USING (image_id IN (SELECT id FROM public.generated_images WHERE user_id = auth.uid()));

-- ============================================
-- IMAGE FOLDERS TABLE (Junction)
-- ============================================
CREATE TABLE IF NOT EXISTS public.image_folders (
    image_id UUID NOT NULL REFERENCES public.generated_images(id) ON DELETE CASCADE,
    folder_id UUID NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
    PRIMARY KEY (image_id, folder_id)
);

-- RLS for image_folders
ALTER TABLE public.image_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage image folders"
    ON public.image_folders FOR ALL
    USING (image_id IN (SELECT id FROM public.generated_images WHERE user_id = auth.uid()));

-- ============================================
-- STYLE PRESETS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.style_presets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prompt_template TEXT,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for style_presets
ALTER TABLE public.style_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage style presets in own brands"
    ON public.style_presets FOR ALL
    USING (brand_id IN (SELECT id FROM public.brands WHERE owner_id = auth.uid()));

-- ============================================
-- API USAGE LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.api_usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
    provider TEXT NOT NULL CHECK (provider IN ('openai', 'gemini')),
    tokens_used INTEGER DEFAULT 0,
    cost_usd DECIMAL(10, 6) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for api_usage_logs
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage"
    ON public.api_usage_logs FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "System can insert usage logs"
    ON public.api_usage_logs FOR INSERT
    WITH CHECK (true);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_brands_owner ON public.brands(owner_id);
CREATE INDEX IF NOT EXISTS idx_brand_members_brand ON public.brand_members(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_members_user ON public.brand_members(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_brand ON public.generation_jobs(brand_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_user ON public.generation_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON public.generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_generated_images_brand ON public.generated_images(brand_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_user ON public.generated_images(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_job ON public.generated_images(job_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_created ON public.generated_images(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_images_favorite ON public.generated_images(is_favorite) WHERE is_favorite = TRUE;
CREATE INDEX IF NOT EXISTS idx_folders_brand ON public.folders(brand_id);
CREATE INDEX IF NOT EXISTS idx_tags_brand ON public.tags(brand_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_brands_updated_at
    BEFORE UPDATE ON public.brands
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- STORAGE BUCKET
-- ============================================
-- Note: Run this in Supabase Dashboard or via API
-- INSERT INTO storage.buckets (id, name, public) 
-- VALUES ('generated-images', 'generated-images', true);






