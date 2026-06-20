-- Harden remaining RLS policies after remote history 20260618090000.
-- Existing 001 edits do not apply to already-migrated remote databases, so this
-- migration recreates the current final policies with explicit roles and checks.

-- users
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
CREATE POLICY "Admins can view all users"
  ON public.users FOR SELECT
  TO authenticated
  USING (private.is_current_user_admin());

-- brands
DROP POLICY IF EXISTS "Users can create brands" ON public.brands;
CREATE POLICY "Users can create brands"
  ON public.brands FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Brand viewers can view brands" ON public.brands;
CREATE POLICY "Brand viewers can view brands"
  ON public.brands FOR SELECT
  TO authenticated
  USING (private.has_brand_role(id, 'viewer'));

DROP POLICY IF EXISTS "Brand editors can update brands" ON public.brands;
CREATE POLICY "Brand editors can update brands"
  ON public.brands FOR UPDATE
  TO authenticated
  USING (private.has_brand_role(id, 'editor'))
  WITH CHECK (private.has_brand_role(id, 'editor'));

DROP POLICY IF EXISTS "Brand owners can delete brands" ON public.brands;
CREATE POLICY "Brand owners can delete brands"
  ON public.brands FOR DELETE
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- brand members
DROP POLICY IF EXISTS "Joined brand viewers can view memberships" ON public.brand_members;
CREATE POLICY "Joined brand viewers can view memberships"
  ON public.brand_members FOR SELECT
  TO authenticated
  USING (private.has_brand_role(brand_id, 'viewer'));

DROP POLICY IF EXISTS "Brand admins can insert members" ON public.brand_members;
CREATE POLICY "Brand admins can insert members"
  ON public.brand_members FOR INSERT
  TO authenticated
  WITH CHECK (private.has_brand_role(brand_id, 'admin'));

DROP POLICY IF EXISTS "Brand admins can update members" ON public.brand_members;
CREATE POLICY "Brand admins can update members"
  ON public.brand_members FOR UPDATE
  TO authenticated
  USING (private.has_brand_role(brand_id, 'admin'))
  WITH CHECK (private.has_brand_role(brand_id, 'admin'));

DROP POLICY IF EXISTS "Brand admins can delete members" ON public.brand_members;
CREATE POLICY "Brand admins can delete members"
  ON public.brand_members FOR DELETE
  TO authenticated
  USING (private.has_brand_role(brand_id, 'admin'));

-- generation jobs
DROP POLICY IF EXISTS "Brand viewers can view jobs" ON public.generation_jobs;
CREATE POLICY "Brand viewers can view jobs"
  ON public.generation_jobs FOR SELECT
  TO authenticated
  USING (private.has_brand_role(brand_id, 'viewer'));

DROP POLICY IF EXISTS "Brand editors can create jobs" ON public.generation_jobs;
CREATE POLICY "Brand editors can create jobs"
  ON public.generation_jobs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND private.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Brand editors can update jobs" ON public.generation_jobs;
CREATE POLICY "Brand editors can update jobs"
  ON public.generation_jobs FOR UPDATE
  TO authenticated
  USING (private.has_brand_role(brand_id, 'editor'))
  WITH CHECK (private.has_brand_role(brand_id, 'editor'));

-- generated images
DROP POLICY IF EXISTS "Brand viewers can view images" ON public.generated_images;
CREATE POLICY "Brand viewers can view images"
  ON public.generated_images FOR SELECT
  TO authenticated
  USING (private.has_brand_role(brand_id, 'viewer'));

DROP POLICY IF EXISTS "Brand editors can insert images" ON public.generated_images;
CREATE POLICY "Brand editors can insert images"
  ON public.generated_images FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND private.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Brand editors can update images" ON public.generated_images;
CREATE POLICY "Brand editors can update images"
  ON public.generated_images FOR UPDATE
  TO authenticated
  USING (private.has_brand_role(brand_id, 'editor'))
  WITH CHECK (private.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Brand editors can delete images" ON public.generated_images;
CREATE POLICY "Brand editors can delete images"
  ON public.generated_images FOR DELETE
  TO authenticated
  USING (private.has_brand_role(brand_id, 'editor'));

-- folders
DROP POLICY IF EXISTS "Brand viewers can view folders" ON public.folders;
CREATE POLICY "Brand viewers can view folders"
  ON public.folders FOR SELECT
  TO authenticated
  USING (private.has_brand_role(brand_id, 'viewer'));

DROP POLICY IF EXISTS "Brand editors can insert folders" ON public.folders;
CREATE POLICY "Brand editors can insert folders"
  ON public.folders FOR INSERT
  TO authenticated
  WITH CHECK (private.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Brand editors can update folders" ON public.folders;
CREATE POLICY "Brand editors can update folders"
  ON public.folders FOR UPDATE
  TO authenticated
  USING (private.has_brand_role(brand_id, 'editor'))
  WITH CHECK (private.has_brand_role(brand_id, 'editor'));

DROP POLICY IF EXISTS "Brand editors can delete folders" ON public.folders;
CREATE POLICY "Brand editors can delete folders"
  ON public.folders FOR DELETE
  TO authenticated
  USING (private.has_brand_role(brand_id, 'editor'));

-- tags
DROP POLICY IF EXISTS "Brand viewers can view tags" ON public.tags;
CREATE POLICY "Brand viewers can view tags"
  ON public.tags FOR SELECT
  TO authenticated
  USING (private.has_brand_role(brand_id, 'viewer'));

DROP POLICY IF EXISTS "Brand editors can manage tags" ON public.tags;
CREATE POLICY "Brand editors can manage tags"
  ON public.tags FOR ALL
  TO authenticated
  USING (private.has_brand_role(brand_id, 'editor'))
  WITH CHECK (private.has_brand_role(brand_id, 'editor'));

-- image tags
DROP POLICY IF EXISTS "Brand viewers can view image tags" ON public.image_tags;
CREATE POLICY "Brand viewers can view image tags"
  ON public.image_tags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.generated_images gi
      JOIN public.tags t ON t.id = image_tags.tag_id
      WHERE gi.id = image_tags.image_id
        AND gi.brand_id = t.brand_id
        AND private.has_brand_role(gi.brand_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "Brand editors can manage image tags" ON public.image_tags;
CREATE POLICY "Brand editors can manage image tags"
  ON public.image_tags FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.generated_images gi
      JOIN public.tags t ON t.id = image_tags.tag_id
      WHERE gi.id = image_tags.image_id
        AND gi.brand_id = t.brand_id
        AND private.has_brand_role(gi.brand_id, 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.generated_images gi
      JOIN public.tags t ON t.id = image_tags.tag_id
      WHERE gi.id = image_tags.image_id
        AND gi.brand_id = t.brand_id
        AND private.has_brand_role(gi.brand_id, 'editor')
    )
  );

-- image folders
DROP POLICY IF EXISTS "Brand viewers can view image folders" ON public.image_folders;
CREATE POLICY "Brand viewers can view image folders"
  ON public.image_folders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.generated_images gi
      JOIN public.folders f ON f.id = image_folders.folder_id
      WHERE gi.id = image_folders.image_id
        AND gi.brand_id = f.brand_id
        AND private.has_brand_role(gi.brand_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "Brand editors can manage image folders" ON public.image_folders;
CREATE POLICY "Brand editors can manage image folders"
  ON public.image_folders FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.generated_images gi
      JOIN public.folders f ON f.id = image_folders.folder_id
      WHERE gi.id = image_folders.image_id
        AND gi.brand_id = f.brand_id
        AND private.has_brand_role(gi.brand_id, 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.generated_images gi
      JOIN public.folders f ON f.id = image_folders.folder_id
      WHERE gi.id = image_folders.image_id
        AND gi.brand_id = f.brand_id
        AND private.has_brand_role(gi.brand_id, 'editor')
    )
  );

-- style presets
DROP POLICY IF EXISTS "Users can manage style presets in own brands" ON public.style_presets;
DROP POLICY IF EXISTS "Brand viewers can view style presets" ON public.style_presets;
DROP POLICY IF EXISTS "Brand editors can manage style presets" ON public.style_presets;
CREATE POLICY "Brand viewers can view style presets"
  ON public.style_presets FOR SELECT
  TO authenticated
  USING (private.has_brand_role(brand_id, 'viewer'));

CREATE POLICY "Brand editors can manage style presets"
  ON public.style_presets FOR ALL
  TO authenticated
  USING (private.has_brand_role(brand_id, 'editor'))
  WITH CHECK (private.has_brand_role(brand_id, 'editor'));

-- legacy usage log table
DROP POLICY IF EXISTS "Users can view own usage" ON public.api_usage_logs;
CREATE POLICY "Users can view own usage"
  ON public.api_usage_logs FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "System can insert usage logs" ON public.api_usage_logs;
DROP POLICY IF EXISTS "Users can insert usage logs" ON public.api_usage_logs;
DROP POLICY IF EXISTS "Users can insert own usage logs" ON public.api_usage_logs;
CREATE POLICY "Users can insert own usage logs"
  ON public.api_usage_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- share links
DROP POLICY IF EXISTS "Users can create share links for accessible images" ON public.share_links;
CREATE POLICY "Users can create share links for accessible images"
  ON public.share_links FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.generated_images gi
      WHERE gi.id = image_id
        AND private.has_brand_role(gi.brand_id, 'editor')
    )
  );

DROP POLICY IF EXISTS "Users can view own share links" ON public.share_links;
CREATE POLICY "Users can view own share links"
  ON public.share_links FOR SELECT
  TO authenticated
  USING (created_by = (SELECT auth.uid()));

-- admin announcements
DROP POLICY IF EXISTS "Authenticated users can view active announcements" ON public.admin_announcements;
CREATE POLICY "Authenticated users can view active announcements"
  ON public.admin_announcements FOR SELECT
  TO authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "Admins can insert announcements" ON public.admin_announcements;
CREATE POLICY "Admins can insert announcements"
  ON public.admin_announcements FOR INSERT
  TO authenticated
  WITH CHECK (private.is_current_user_admin());

DROP POLICY IF EXISTS "Admins can update announcements" ON public.admin_announcements;
CREATE POLICY "Admins can update announcements"
  ON public.admin_announcements FOR UPDATE
  TO authenticated
  USING (private.is_current_user_admin())
  WITH CHECK (private.is_current_user_admin());

DROP POLICY IF EXISTS "Admins can delete announcements" ON public.admin_announcements;
CREATE POLICY "Admins can delete announcements"
  ON public.admin_announcements FOR DELETE
  TO authenticated
  USING (private.is_current_user_admin());

-- storage policies. Qualify storage.objects.name inside subqueries so it does
-- not bind to brands.name.
DROP POLICY IF EXISTS "Users can view accessible generated images" ON storage.objects;
CREATE POLICY "Users can view accessible generated images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'generated-images'
    AND EXISTS (
      SELECT 1
      FROM public.generated_images gi
      WHERE gi.storage_path = storage.objects.name
        AND private.has_brand_role(gi.brand_id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "Users can update own generated images" ON storage.objects;
CREATE POLICY "Users can update own generated images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'generated-images'
    AND EXISTS (
      SELECT 1
      FROM public.generated_images gi
      WHERE gi.storage_path = storage.objects.name
        AND private.has_brand_role(gi.brand_id, 'editor')
    )
  )
  WITH CHECK (
    bucket_id = 'generated-images'
    AND split_part(storage.objects.name, '/', 1) = (SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(storage.objects.name, '/', 2)
        AND private.has_brand_role(b.id, 'editor')
    )
  );

DROP POLICY IF EXISTS "Users can delete own generated images" ON storage.objects;
CREATE POLICY "Users can delete own generated images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'generated-images'
    AND EXISTS (
      SELECT 1
      FROM public.generated_images gi
      WHERE gi.storage_path = storage.objects.name
        AND private.has_brand_role(gi.brand_id, 'editor')
    )
  );

DROP POLICY IF EXISTS "Users can view brand assets" ON storage.objects;
CREATE POLICY "Users can view brand assets"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(storage.objects.name, '/', 2)
        AND private.has_brand_role(b.id, 'viewer')
    )
  );

DROP POLICY IF EXISTS "Users can upload brand assets" ON storage.objects;
CREATE POLICY "Users can upload brand assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND split_part(storage.objects.name, '/', 1) = (SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(storage.objects.name, '/', 2)
        AND private.has_brand_role(b.id, 'editor')
    )
  );

DROP POLICY IF EXISTS "Users can update own brand assets" ON storage.objects;
CREATE POLICY "Users can update own brand assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(storage.objects.name, '/', 2)
        AND private.has_brand_role(b.id, 'editor')
    )
  )
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND split_part(storage.objects.name, '/', 1) = (SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(storage.objects.name, '/', 2)
        AND private.has_brand_role(b.id, 'editor')
    )
  );

DROP POLICY IF EXISTS "Users can delete own brand assets" ON storage.objects;
CREATE POLICY "Users can delete own brand assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = split_part(storage.objects.name, '/', 2)
        AND private.has_brand_role(b.id, 'editor')
    )
  );
