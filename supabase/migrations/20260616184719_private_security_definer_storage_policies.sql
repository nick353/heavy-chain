-- Move SECURITY DEFINER authorization helpers out of the exposed public schema
-- and align API/storage policies with private buckets.

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;

GRANT USAGE ON SCHEMA private TO anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE OR REPLACE FUNCTION private.brand_role_for_user(p_brand_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
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

CREATE OR REPLACE FUNCTION private.has_brand_role(p_brand_id UUID, p_min_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    CASE private.brand_role_for_user(p_brand_id, auth.uid())
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

CREATE OR REPLACE FUNCTION private.is_current_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT u.is_admin FROM public.users u WHERE u.id = auth.uid()),
    FALSE
  )
$$;

REVOKE ALL ON FUNCTION private.brand_role_for_user(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.brand_role_for_user(UUID, UUID) FROM anon, authenticated;
REVOKE ALL ON FUNCTION private.has_brand_role(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_current_user_admin() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.brand_role_for_user(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION private.has_brand_role(UUID, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_current_user_admin() TO anon, authenticated, service_role;

-- Recreate public table policies so they no longer depend on public.* helpers.

DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
CREATE POLICY "Admins can view all users"
  ON public.users FOR SELECT
  USING (private.is_current_user_admin());

DROP POLICY IF EXISTS "Brand viewers can view brands" ON public.brands;
DROP POLICY IF EXISTS "Brand editors can update brands" ON public.brands;
DROP POLICY IF EXISTS "Brand owners can delete brands" ON public.brands;
CREATE POLICY "Brand viewers can view brands"
  ON public.brands FOR SELECT
  USING (private.has_brand_role(id, 'viewer'));
CREATE POLICY "Brand editors can update brands"
  ON public.brands FOR UPDATE
  USING (private.has_brand_role(id, 'editor'))
  WITH CHECK (private.has_brand_role(id, 'editor'));
CREATE POLICY "Brand owners can delete brands"
  ON public.brands FOR DELETE
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Joined brand viewers can view memberships" ON public.brand_members;
DROP POLICY IF EXISTS "Brand admins can insert members" ON public.brand_members;
DROP POLICY IF EXISTS "Brand admins can update members" ON public.brand_members;
DROP POLICY IF EXISTS "Brand admins can delete members" ON public.brand_members;
CREATE POLICY "Joined brand viewers can view memberships"
  ON public.brand_members FOR SELECT
  USING (private.has_brand_role(brand_id, 'viewer'));
CREATE POLICY "Brand admins can insert members"
  ON public.brand_members FOR INSERT
  WITH CHECK (private.has_brand_role(brand_id, 'admin'));
CREATE POLICY "Brand admins can update members"
  ON public.brand_members FOR UPDATE
  USING (private.has_brand_role(brand_id, 'admin'))
  WITH CHECK (private.has_brand_role(brand_id, 'admin'));
CREATE POLICY "Brand admins can delete members"
  ON public.brand_members FOR DELETE
  USING (private.has_brand_role(brand_id, 'admin'));

DROP POLICY IF EXISTS "Brand viewers can view jobs" ON public.generation_jobs;
DROP POLICY IF EXISTS "Brand editors can create jobs" ON public.generation_jobs;
DROP POLICY IF EXISTS "Brand editors can update jobs" ON public.generation_jobs;
CREATE POLICY "Brand viewers can view jobs"
  ON public.generation_jobs FOR SELECT
  USING (private.has_brand_role(brand_id, 'viewer'));
CREATE POLICY "Brand editors can create jobs"
  ON public.generation_jobs FOR INSERT
  WITH CHECK (user_id = auth.uid() AND private.has_brand_role(brand_id, 'editor'));
CREATE POLICY "Brand editors can update jobs"
  ON public.generation_jobs FOR UPDATE
  USING (private.has_brand_role(brand_id, 'editor'))
  WITH CHECK (private.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Brand viewers can view images" ON public.generated_images;
DROP POLICY IF EXISTS "Brand editors can insert images" ON public.generated_images;
DROP POLICY IF EXISTS "Brand editors can update images" ON public.generated_images;
DROP POLICY IF EXISTS "Brand editors can delete images" ON public.generated_images;
CREATE POLICY "Brand viewers can view images"
  ON public.generated_images FOR SELECT
  USING (private.has_brand_role(brand_id, 'viewer'));
CREATE POLICY "Brand editors can insert images"
  ON public.generated_images FOR INSERT
  WITH CHECK (user_id = auth.uid() AND private.has_brand_role(brand_id, 'editor'));
CREATE POLICY "Brand editors can update images"
  ON public.generated_images FOR UPDATE
  USING (private.has_brand_role(brand_id, 'editor'))
  WITH CHECK (private.has_brand_role(brand_id, 'editor'));
CREATE POLICY "Brand editors can delete images"
  ON public.generated_images FOR DELETE
  USING (private.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Brand viewers can view folders" ON public.folders;
DROP POLICY IF EXISTS "Brand editors can insert folders" ON public.folders;
DROP POLICY IF EXISTS "Brand editors can update folders" ON public.folders;
DROP POLICY IF EXISTS "Brand editors can delete folders" ON public.folders;
CREATE POLICY "Brand viewers can view folders"
  ON public.folders FOR SELECT
  USING (private.has_brand_role(brand_id, 'viewer'));
CREATE POLICY "Brand editors can insert folders"
  ON public.folders FOR INSERT
  WITH CHECK (private.has_brand_role(brand_id, 'editor'));
CREATE POLICY "Brand editors can update folders"
  ON public.folders FOR UPDATE
  USING (private.has_brand_role(brand_id, 'editor'))
  WITH CHECK (private.has_brand_role(brand_id, 'editor'));
CREATE POLICY "Brand editors can delete folders"
  ON public.folders FOR DELETE
  USING (private.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Brand viewers can view tags" ON public.tags;
DROP POLICY IF EXISTS "Brand editors can manage tags" ON public.tags;
CREATE POLICY "Brand viewers can view tags"
  ON public.tags FOR SELECT
  USING (private.has_brand_role(brand_id, 'viewer'));
CREATE POLICY "Brand editors can manage tags"
  ON public.tags FOR ALL
  USING (private.has_brand_role(brand_id, 'editor'))
  WITH CHECK (private.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Brand viewers can view image tags" ON public.image_tags;
DROP POLICY IF EXISTS "Brand editors can manage image tags" ON public.image_tags;
CREATE POLICY "Brand viewers can view image tags"
  ON public.image_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.generated_images gi
      WHERE gi.id = image_id AND private.has_brand_role(gi.brand_id, 'viewer')
    )
  );
CREATE POLICY "Brand editors can manage image tags"
  ON public.image_tags FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.generated_images gi
      WHERE gi.id = image_id AND private.has_brand_role(gi.brand_id, 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.generated_images gi
      WHERE gi.id = image_id AND private.has_brand_role(gi.brand_id, 'editor')
    )
  );

DROP POLICY IF EXISTS "Brand viewers can view image folders" ON public.image_folders;
DROP POLICY IF EXISTS "Brand editors can manage image folders" ON public.image_folders;
CREATE POLICY "Brand viewers can view image folders"
  ON public.image_folders FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.generated_images gi
      JOIN public.folders f ON f.id = folder_id
      WHERE gi.id = image_id
        AND gi.brand_id = f.brand_id
        AND private.has_brand_role(gi.brand_id, 'viewer')
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
        AND private.has_brand_role(gi.brand_id, 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.generated_images gi
      JOIN public.folders f ON f.id = folder_id
      WHERE gi.id = image_id
        AND gi.brand_id = f.brand_id
        AND private.has_brand_role(gi.brand_id, 'editor')
    )
  );

DROP POLICY IF EXISTS "Users can create share links for accessible images" ON public.share_links;
DROP POLICY IF EXISTS "Users can view own share links" ON public.share_links;
CREATE POLICY "Users can create share links for accessible images"
  ON public.share_links FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.generated_images gi
      WHERE gi.id = image_id AND private.has_brand_role(gi.brand_id, 'editor')
    )
  );
CREATE POLICY "Users can view own share links"
  ON public.share_links FOR SELECT
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Admins can insert announcements" ON public.admin_announcements;
DROP POLICY IF EXISTS "Admins can update announcements" ON public.admin_announcements;
DROP POLICY IF EXISTS "Admins can delete announcements" ON public.admin_announcements;
CREATE POLICY "Admins can insert announcements"
  ON public.admin_announcements FOR INSERT
  WITH CHECK (private.is_current_user_admin());
CREATE POLICY "Admins can update announcements"
  ON public.admin_announcements FOR UPDATE
  USING (private.is_current_user_admin())
  WITH CHECK (private.is_current_user_admin());
CREATE POLICY "Admins can delete announcements"
  ON public.admin_announcements FOR DELETE
  USING (private.is_current_user_admin());

DROP POLICY IF EXISTS "System can insert usage logs" ON public.api_usage_logs;
DROP POLICY IF EXISTS "Users can insert usage logs" ON public.api_usage_logs;
DROP POLICY IF EXISTS "Users can insert own usage logs" ON public.api_usage_logs;

-- Private storage buckets and policies.

INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-images', 'generated-images', false)
ON CONFLICT (id) DO UPDATE SET public = false;

INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', false)
ON CONFLICT (id) DO UPDATE SET public = false;

INSERT INTO storage.buckets (id, name, public)
VALUES ('exports', 'exports', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Access Brand Assets" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for generated images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view generated images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload generated images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update generated images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete generated images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can view accessible generated images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload generated images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own generated images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own generated images" ON storage.objects;
DROP POLICY IF EXISTS "Users can view brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own brand assets" ON storage.objects;

CREATE POLICY "Users can view accessible generated images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'generated-images'
    AND EXISTS (
      SELECT 1
      FROM public.generated_images gi
      WHERE gi.storage_path = name
        AND private.has_brand_role(gi.brand_id, 'viewer')
    )
  );

CREATE POLICY "Users can update own generated images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'generated-images'
    AND EXISTS (
      SELECT 1
      FROM public.generated_images gi
      WHERE gi.storage_path = name
        AND private.has_brand_role(gi.brand_id, 'editor')
    )
  )
  WITH CHECK (
    bucket_id = 'generated-images'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(name, '/', 2)
        AND private.has_brand_role(b.id, 'editor')
    )
  );

CREATE POLICY "Users can delete own generated images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'generated-images'
    AND EXISTS (
      SELECT 1
      FROM public.generated_images gi
      WHERE gi.storage_path = name
        AND private.has_brand_role(gi.brand_id, 'editor')
    )
  );

CREATE POLICY "Users can view brand assets"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(name, '/', 2)
        AND private.has_brand_role(b.id, 'viewer')
    )
  );

CREATE POLICY "Users can upload brand assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(name, '/', 2)
        AND private.has_brand_role(b.id, 'editor')
    )
  );

CREATE POLICY "Users can update own brand assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(name, '/', 2)
        AND private.has_brand_role(b.id, 'editor')
    )
  )
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(name, '/', 2)
        AND private.has_brand_role(b.id, 'editor')
    )
  );

CREATE POLICY "Users can delete own brand assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(name, '/', 2)
        AND private.has_brand_role(b.id, 'editor')
    )
  );

DROP FUNCTION IF EXISTS public.has_brand_role(UUID, TEXT);
DROP FUNCTION IF EXISTS public.brand_role_for_user(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_current_user_admin();
