-- Supabase Storage Setup for Heavy Chain
-- Run this in your Supabase SQL Editor

-- ============================================
-- CREATE STORAGE BUCKETS
-- ============================================

-- Create generated-images bucket (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-images', 'generated-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Create brand-assets bucket (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ============================================
-- STORAGE POLICIES FOR generated-images
-- ============================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public read access for generated images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload generated images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own generated images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own generated images" ON storage.objects;

-- Allow public read access to all files in generated-images bucket
CREATE POLICY "Public read access for generated images"
ON storage.objects FOR SELECT
USING (bucket_id = 'generated-images');

-- Allow authenticated users to upload files to their own folder
CREATE POLICY "Users can upload generated images"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'generated-images' 
    AND auth.role() = 'authenticated'
);

-- Allow users to update their own files
CREATE POLICY "Users can update own generated images"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'generated-images'
    AND auth.role() = 'authenticated'
);

-- Allow users to delete their own files
CREATE POLICY "Users can delete own generated images"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'generated-images'
    AND auth.role() = 'authenticated'
);

-- ============================================
-- STORAGE POLICIES FOR brand-assets
-- ============================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public read access for brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own brand assets" ON storage.objects;

-- Allow public read access to all files in brand-assets bucket
CREATE POLICY "Public read access for brand assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'brand-assets');

-- Allow authenticated users to upload files
CREATE POLICY "Users can upload brand assets"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'brand-assets' 
    AND auth.role() = 'authenticated'
);

-- Allow users to update files
CREATE POLICY "Users can update own brand assets"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'brand-assets'
    AND auth.role() = 'authenticated'
);

-- Allow users to delete files
CREATE POLICY "Users can delete own brand assets"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'brand-assets'
    AND auth.role() = 'authenticated'
);

