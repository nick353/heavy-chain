-- Heavy Chain storage emergency reapply.
-- The normal source of truth is supabase/migrations.
-- Run this file manually only if storage buckets or policies need to be repaired
-- outside the migration flow.

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

REVOKE ALL ON FUNCTION private.brand_role_for_user(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.brand_role_for_user(UUID, UUID) FROM anon, authenticated;
REVOKE ALL ON FUNCTION private.has_brand_role(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.brand_role_for_user(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION private.has_brand_role(UUID, TEXT) TO anon, authenticated, service_role;

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
