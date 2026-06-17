-- Phase 1 production blockers: align schema and tighten access policies.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.brand_role_for_user(p_brand_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN b.owner_id = p_user_id THEN 'owner'
    ELSE (
      SELECT bm.role
      FROM public.brand_members bm
      WHERE bm.brand_id = p_brand_id
        AND bm.user_id = p_user_id
        AND bm.joined_at IS NOT NULL
      LIMIT 1
    )
  END
  FROM public.brands b
  WHERE b.id = p_brand_id
$$;

CREATE OR REPLACE FUNCTION public.has_brand_role(p_brand_id UUID, p_min_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    CASE public.brand_role_for_user(p_brand_id, auth.uid())
      WHEN 'viewer' THEN 1
      WHEN 'editor' THEN 2
      WHEN 'admin' THEN 3
      WHEN 'owner' THEN 4
      ELSE 0
    END >=
    CASE p_min_role
      WHEN 'viewer' THEN 1
      WHEN 'editor' THEN 2
      WHEN 'admin' THEN 3
      WHEN 'owner' THEN 4
      ELSE 999
    END,
    FALSE
  )
$$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT u.is_admin FROM public.users u WHERE u.id = auth.uid()),
    FALSE
  )
$$;

ALTER TABLE public.generated_images
  ADD COLUMN IF NOT EXISTS prompt TEXT,
  ADD COLUMN IF NOT EXISTS negative_prompt TEXT,
  ADD COLUMN IF NOT EXISTS feature_type TEXT,
  ADD COLUMN IF NOT EXISTS style_preset TEXT,
  ADD COLUMN IF NOT EXISTS model_used TEXT,
  ADD COLUMN IF NOT EXISTS generation_params JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.generated_images ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE public.generated_images ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '30 days');
ALTER TABLE public.generated_images ALTER COLUMN expires_at DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.share_links (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  image_id UUID NOT NULL REFERENCES public.generated_images(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_announcements (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.admin_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
CREATE POLICY "Admins can view all users"
  ON public.users FOR SELECT
  USING (public.is_current_user_admin());

DROP POLICY IF EXISTS "Users can view own brands" ON public.brands;
DROP POLICY IF EXISTS "Users can update own brands" ON public.brands;
DROP POLICY IF EXISTS "Users can delete own brands" ON public.brands;
CREATE POLICY "Brand viewers can view brands"
  ON public.brands FOR SELECT
  USING (public.has_brand_role(id, 'viewer'));
CREATE POLICY "Brand editors can update brands"
  ON public.brands FOR UPDATE
  USING (public.has_brand_role(id, 'editor'))
  WITH CHECK (public.has_brand_role(id, 'editor'));
CREATE POLICY "Brand owners can delete brands"
  ON public.brands FOR DELETE
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Brand members can view their memberships" ON public.brand_members;
DROP POLICY IF EXISTS "Brand owners can manage members" ON public.brand_members;
CREATE POLICY "Joined brand viewers can view memberships"
  ON public.brand_members FOR SELECT
  USING (public.has_brand_role(brand_id, 'viewer'));
CREATE POLICY "Brand admins can insert members"
  ON public.brand_members FOR INSERT
  WITH CHECK (public.has_brand_role(brand_id, 'admin'));
CREATE POLICY "Brand admins can update members"
  ON public.brand_members FOR UPDATE
  USING (public.has_brand_role(brand_id, 'admin'))
  WITH CHECK (public.has_brand_role(brand_id, 'admin'));
CREATE POLICY "Brand admins can delete members"
  ON public.brand_members FOR DELETE
  USING (public.has_brand_role(brand_id, 'admin'));

DROP POLICY IF EXISTS "Users can view own jobs" ON public.generation_jobs;
DROP POLICY IF EXISTS "Users can create jobs" ON public.generation_jobs;
DROP POLICY IF EXISTS "Users can update own jobs" ON public.generation_jobs;
CREATE POLICY "Brand viewers can view jobs"
  ON public.generation_jobs FOR SELECT
  USING (public.has_brand_role(brand_id, 'viewer'));
CREATE POLICY "Brand editors can create jobs"
  ON public.generation_jobs FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.has_brand_role(brand_id, 'editor'));
CREATE POLICY "Brand editors can update jobs"
  ON public.generation_jobs FOR UPDATE
  USING (public.has_brand_role(brand_id, 'editor'))
  WITH CHECK (public.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Users can view own images" ON public.generated_images;
DROP POLICY IF EXISTS "Users can insert images" ON public.generated_images;
DROP POLICY IF EXISTS "Users can update own images" ON public.generated_images;
DROP POLICY IF EXISTS "Users can delete own images" ON public.generated_images;
CREATE POLICY "Brand viewers can view images"
  ON public.generated_images FOR SELECT
  USING (public.has_brand_role(brand_id, 'viewer'));
CREATE POLICY "Brand editors can insert images"
  ON public.generated_images FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.has_brand_role(brand_id, 'editor'));
CREATE POLICY "Brand editors can update images"
  ON public.generated_images FOR UPDATE
  USING (public.has_brand_role(brand_id, 'editor'))
  WITH CHECK (public.has_brand_role(brand_id, 'editor'));
CREATE POLICY "Brand editors can delete images"
  ON public.generated_images FOR DELETE
  USING (public.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Users can manage folders in own brands" ON public.folders;
CREATE POLICY "Brand viewers can view folders"
  ON public.folders FOR SELECT
  USING (public.has_brand_role(brand_id, 'viewer'));
CREATE POLICY "Brand editors can insert folders"
  ON public.folders FOR INSERT
  WITH CHECK (public.has_brand_role(brand_id, 'editor'));
CREATE POLICY "Brand editors can update folders"
  ON public.folders FOR UPDATE
  USING (public.has_brand_role(brand_id, 'editor'))
  WITH CHECK (public.has_brand_role(brand_id, 'editor'));
CREATE POLICY "Brand editors can delete folders"
  ON public.folders FOR DELETE
  USING (public.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Users can manage tags in own brands" ON public.tags;
CREATE POLICY "Brand viewers can view tags"
  ON public.tags FOR SELECT
  USING (public.has_brand_role(brand_id, 'viewer'));
CREATE POLICY "Brand editors can manage tags"
  ON public.tags FOR ALL
  USING (public.has_brand_role(brand_id, 'editor'))
  WITH CHECK (public.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Users can manage image tags" ON public.image_tags;
CREATE POLICY "Brand viewers can view image tags"
  ON public.image_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.generated_images gi
      WHERE gi.id = image_id AND public.has_brand_role(gi.brand_id, 'viewer')
    )
  );
CREATE POLICY "Brand editors can manage image tags"
  ON public.image_tags FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.generated_images gi
      WHERE gi.id = image_id AND public.has_brand_role(gi.brand_id, 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.generated_images gi
      WHERE gi.id = image_id AND public.has_brand_role(gi.brand_id, 'editor')
    )
  );

DROP POLICY IF EXISTS "Users can manage image folders" ON public.image_folders;
CREATE POLICY "Brand viewers can view image folders"
  ON public.image_folders FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.generated_images gi
      JOIN public.folders f ON f.id = folder_id
      WHERE gi.id = image_id
        AND gi.brand_id = f.brand_id
        AND public.has_brand_role(gi.brand_id, 'viewer')
    )
  );
CREATE POLICY "Brand editors can manage image folders"
  ON public.image_folders FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.generated_images gi
      JOIN public.folders f ON f.id = folder_id
      WHERE gi.id = image_id
        AND gi.brand_id = f.brand_id
        AND public.has_brand_role(gi.brand_id, 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.generated_images gi
      JOIN public.folders f ON f.id = folder_id
      WHERE gi.id = image_id
        AND gi.brand_id = f.brand_id
        AND public.has_brand_role(gi.brand_id, 'editor')
    )
  );

DROP POLICY IF EXISTS "System can insert usage logs" ON public.api_usage_logs;
DROP POLICY IF EXISTS "Users can insert usage logs" ON public.api_usage_logs;

CREATE POLICY "Users can create share links for accessible images"
  ON public.share_links FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.generated_images gi
      WHERE gi.id = image_id AND public.has_brand_role(gi.brand_id, 'viewer')
    )
  );
CREATE POLICY "Users can view own share links"
  ON public.share_links FOR SELECT
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.generated_images gi
      WHERE gi.id = image_id AND public.has_brand_role(gi.brand_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "Authenticated users can view active announcements" ON public.admin_announcements;
DROP POLICY IF EXISTS "Admins can insert announcements" ON public.admin_announcements;
DROP POLICY IF EXISTS "Admins can update announcements" ON public.admin_announcements;
DROP POLICY IF EXISTS "Admins can delete announcements" ON public.admin_announcements;
CREATE POLICY "Authenticated users can view active announcements"
  ON public.admin_announcements FOR SELECT
  USING (auth.role() = 'authenticated' AND is_active = TRUE);
CREATE POLICY "Admins can insert announcements"
  ON public.admin_announcements FOR INSERT
  WITH CHECK (public.is_current_user_admin());
CREATE POLICY "Admins can update announcements"
  ON public.admin_announcements FOR UPDATE
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());
CREATE POLICY "Admins can delete announcements"
  ON public.admin_announcements FOR DELETE
  USING (public.is_current_user_admin());

CREATE INDEX IF NOT EXISTS idx_share_links_token ON public.share_links(token);
CREATE INDEX IF NOT EXISTS idx_share_links_image ON public.share_links(image_id);
