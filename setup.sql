-- Heavy Chain Database Schema - Fixed version
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users Table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    language TEXT DEFAULT 'ja',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;

CREATE POLICY "Users can view own profile" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);

-- Brands Table
CREATE TABLE IF NOT EXISTS public.brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    logo_url TEXT,
    brand_colors JSONB DEFAULT '{}',
    tone_description TEXT,
    target_audience TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own brands" ON public.brands;
DROP POLICY IF EXISTS "Users can create brands" ON public.brands;
DROP POLICY IF EXISTS "Users can update own brands" ON public.brands;
DROP POLICY IF EXISTS "Users can delete own brands" ON public.brands;

CREATE POLICY "Users can view own brands" ON public.brands FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "Users can create brands" ON public.brands FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Users can update own brands" ON public.brands FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "Users can delete own brands" ON public.brands FOR DELETE USING (owner_id = auth.uid());

-- Brand Members Table
CREATE TABLE IF NOT EXISTS public.brand_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    joined_at TIMESTAMPTZ,
    UNIQUE(brand_id, user_id)
);

ALTER TABLE public.brand_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Brand members can view their memberships" ON public.brand_members;
DROP POLICY IF EXISTS "Brand owners can manage members" ON public.brand_members;

CREATE POLICY "Brand members can view their memberships" ON public.brand_members FOR SELECT 
    USING (user_id = auth.uid() OR brand_id IN (SELECT id FROM public.brands WHERE owner_id = auth.uid()));

CREATE POLICY "Brand owners can manage members" ON public.brand_members FOR ALL 
    USING (brand_id IN (SELECT id FROM public.brands WHERE owner_id = auth.uid()));

-- Generation Jobs Table
CREATE TABLE IF NOT EXISTS public.generation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own jobs" ON public.generation_jobs;
DROP POLICY IF EXISTS "Users can create jobs" ON public.generation_jobs;
DROP POLICY IF EXISTS "Users can update own jobs" ON public.generation_jobs;

CREATE POLICY "Users can view own jobs" ON public.generation_jobs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create jobs" ON public.generation_jobs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own jobs" ON public.generation_jobs FOR UPDATE USING (user_id = auth.uid());

-- Generated Images Table
CREATE TABLE IF NOT EXISTS public.generated_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES public.generation_jobs(id) ON DELETE CASCADE,
    brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    prompt TEXT,
    model_used TEXT,
    generation_params JSONB DEFAULT '{}',
    thumbnail_path TEXT,
    version INTEGER DEFAULT 1,
    parent_image_id UUID REFERENCES public.generated_images(id) ON DELETE SET NULL,
    is_favorite BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own images" ON public.generated_images;
DROP POLICY IF EXISTS "Users can insert images" ON public.generated_images;
DROP POLICY IF EXISTS "Users can update own images" ON public.generated_images;
DROP POLICY IF EXISTS "Users can delete own images" ON public.generated_images;

CREATE POLICY "Users can view own images" ON public.generated_images FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert images" ON public.generated_images FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own images" ON public.generated_images FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own images" ON public.generated_images FOR DELETE USING (user_id = auth.uid());

-- API Usage Logs Table
CREATE TABLE IF NOT EXISTS public.api_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    cost_usd DECIMAL(10, 6) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own usage" ON public.api_usage_logs;
DROP POLICY IF EXISTS "System can insert usage logs" ON public.api_usage_logs;

CREATE POLICY "Users can view own usage" ON public.api_usage_logs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "System can insert usage logs" ON public.api_usage_logs FOR INSERT WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_brands_owner ON public.brands(owner_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_brand ON public.generation_jobs(brand_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_user ON public.generation_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_brand ON public.generated_images(brand_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_user ON public.generated_images(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_created ON public.generated_images(created_at DESC);

-- Update trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
DROP TRIGGER IF EXISTS update_brands_updated_at ON public.brands;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_brands_updated_at BEFORE UPDATE ON public.brands
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

