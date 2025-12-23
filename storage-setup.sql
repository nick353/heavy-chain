-- Heavy Chain - ストレージバケット設定
-- Supabase Dashboard の SQL Editor で実行してください

-- ============================================
-- ストレージバケットの作成
-- ============================================

-- generated-images バケット（画像生成用）
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-images', 'generated-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- brand-assets バケット（ブランドロゴ等）
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ============================================
-- ストレージポリシー: generated-images
-- ============================================

-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own images" ON storage.objects;

-- パブリック読み取りアクセス（全員が画像を見られる）
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'generated-images');

-- 認証済みユーザーはアップロード可能
CREATE POLICY "Authenticated users can upload"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'generated-images' 
  AND auth.role() = 'authenticated'
);

-- 認証済みユーザーは更新可能
CREATE POLICY "Users can update own images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'generated-images'
  AND auth.role() = 'authenticated'
);

-- 認証済みユーザーは削除可能
CREATE POLICY "Users can delete own images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'generated-images'
  AND auth.role() = 'authenticated'
);

-- ============================================
-- ストレージポリシー: brand-assets
-- ============================================

-- パブリック読み取りアクセス
CREATE POLICY "Public Access Brand Assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'brand-assets');

-- 認証済みユーザーはアップロード可能
CREATE POLICY "Authenticated users can upload brand assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'brand-assets' 
  AND auth.role() = 'authenticated'
);

-- 認証済みユーザーは更新可能
CREATE POLICY "Users can update brand assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'brand-assets'
  AND auth.role() = 'authenticated'
);

-- 認証済みユーザーは削除可能
CREATE POLICY "Users can delete brand assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'brand-assets'
  AND auth.role() = 'authenticated'
);

-- ============================================
-- 確認
-- ============================================

-- バケット一覧を表示
SELECT id, name, public FROM storage.buckets;

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '✅ ストレージバケットとポリシーの設定が完了しました！';
  RAISE NOTICE '   - generated-images: 公開設定';
  RAISE NOTICE '   - brand-assets: 公開設定';
  RAISE NOTICE '';
  RAISE NOTICE '次のステップ: アプリを起動して画像が表示されることを確認してください。';
END $$;

