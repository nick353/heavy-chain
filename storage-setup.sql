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
-- 既存のポリシーをすべて削除
-- ============================================

DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Access Brand Assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete brand assets" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view generated images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view brand assets" ON storage.objects;

-- ============================================
-- ストレージポリシー: generated-images
-- ============================================

-- 誰でも画像を見られる（公開読み取り）
CREATE POLICY "Anyone can view generated images"
ON storage.objects FOR SELECT
USING (bucket_id = 'generated-images');

-- 認証済みユーザーはアップロード可能
CREATE POLICY "Authenticated users can upload generated images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'generated-images');

-- 認証済みユーザーは更新可能
CREATE POLICY "Authenticated users can update generated images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'generated-images');

-- 認証済みユーザーは削除可能
CREATE POLICY "Authenticated users can delete generated images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'generated-images');

-- ============================================
-- ストレージポリシー: brand-assets
-- ============================================

-- 誰でもブランドアセットを見られる
CREATE POLICY "Anyone can view brand assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'brand-assets');

-- 認証済みユーザーはアップロード可能
CREATE POLICY "Authenticated users can upload brand assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'brand-assets');

-- 認証済みユーザーは更新可能
CREATE POLICY "Authenticated users can update brand assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'brand-assets');

-- 認証済みユーザーは削除可能
CREATE POLICY "Authenticated users can delete brand assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'brand-assets');

-- ============================================
-- 確認
-- ============================================

-- バケット一覧を表示
SELECT 
  id, 
  name, 
  public,
  created_at
FROM storage.buckets;

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '✅ ストレージバケットとポリシーの設定が完了しました！';
  RAISE NOTICE '   - generated-images: 公開設定 ✓';
  RAISE NOTICE '   - brand-assets: 公開設定 ✓';
  RAISE NOTICE '';
  RAISE NOTICE '📌 次のステップ:';
  RAISE NOTICE '   1. Supabase Dashboard → Storage で上記バケットが表示されることを確認';
  RAISE NOTICE '   2. 各バケットが Public になっていることを確認';
  RAISE NOTICE '   3. アプリをリロードして画像が表示されることを確認';
END $$;


