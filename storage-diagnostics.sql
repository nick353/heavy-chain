-- Supabase ストレージのトラブルシューティング用SQL
-- 問題が発生している場合、このSQLを実行して状態を確認してください

-- ============================================
-- 1. ストレージバケットの確認
-- ============================================
SELECT 
  '=== ストレージバケット ===' as section,
  id, 
  name, 
  public as "公開設定",
  created_at as "作成日時"
FROM storage.buckets
ORDER BY created_at DESC;

-- ============================================
-- 2. ストレージポリシーの確認
-- ============================================
SELECT 
  '=== ストレージポリシー ===' as section,
  schemaname,
  tablename,
  policyname as "ポリシー名",
  permissive,
  roles,
  cmd as "操作",
  qual as "条件"
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- ============================================
-- 3. generated_images テーブルの確認
-- ============================================
SELECT 
  '=== 画像レコード（最新5件） ===' as section,
  id,
  storage_path as "ストレージパス",
  brand_id,
  user_id,
  created_at as "作成日時"
FROM generated_images
ORDER BY created_at DESC
LIMIT 5;

-- ============================================
-- 4. ストレージ内の実際のファイル確認
-- ============================================
SELECT 
  '=== ストレージ内のファイル（最新10件） ===' as section,
  name as "ファイル名",
  bucket_id as "バケット",
  owner as "所有者",
  created_at as "作成日時",
  metadata->>'size' as "サイズ(bytes)"
FROM storage.objects
WHERE bucket_id = 'generated-images'
ORDER BY created_at DESC
LIMIT 10;

-- ============================================
-- 5. 画像レコードとファイルの整合性チェック
-- ============================================
SELECT 
  '=== 整合性チェック ===' as section,
  gi.id as "画像ID",
  gi.storage_path as "データベース上のパス",
  CASE 
    WHEN so.name IS NOT NULL THEN '✅ ファイル存在'
    ELSE '❌ ファイル不在'
  END as "ファイル状態"
FROM generated_images gi
LEFT JOIN storage.objects so ON gi.storage_path = so.name AND so.bucket_id = 'generated-images'
ORDER BY gi.created_at DESC
LIMIT 10;

-- ============================================
-- 診断結果の解釈
-- ============================================
DO $$
DECLARE
  bucket_count INTEGER;
  policy_count INTEGER;
  image_count INTEGER;
  file_count INTEGER;
BEGIN
  -- バケット数を確認
  SELECT COUNT(*) INTO bucket_count 
  FROM storage.buckets 
  WHERE id = 'generated-images';
  
  -- ポリシー数を確認
  SELECT COUNT(*) INTO policy_count 
  FROM pg_policies 
  WHERE schemaname = 'storage' AND tablename = 'objects';
  
  -- 画像レコード数を確認
  SELECT COUNT(*) INTO image_count 
  FROM generated_images;
  
  -- ファイル数を確認
  SELECT COUNT(*) INTO file_count 
  FROM storage.objects 
  WHERE bucket_id = 'generated-images';
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '診断結果サマリー';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'ストレージバケット: % 個', bucket_count;
  IF bucket_count = 0 THEN
    RAISE NOTICE '  ❌ generated-images バケットが見つかりません';
    RAISE NOTICE '  💡 storage-setup.sql を実行してください';
  ELSE
    RAISE NOTICE '  ✅ バケットが存在します';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'ストレージポリシー: % 個', policy_count;
  IF policy_count < 4 THEN
    RAISE NOTICE '  ⚠️ ポリシーが不足している可能性があります';
    RAISE NOTICE '  💡 storage-setup.sql を実行してください';
  ELSE
    RAISE NOTICE '  ✅ ポリシーが設定されています';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '画像レコード数: % 件', image_count;
  RAISE NOTICE '実際のファイル数: % 件', file_count;
  
  IF image_count > 0 AND file_count = 0 THEN
    RAISE NOTICE '  ❌ データベースに画像レコードはあるが、ファイルが存在しません';
    RAISE NOTICE '  💡 画像を再生成する必要があります';
  ELSIF image_count = 0 THEN
    RAISE NOTICE '  ℹ️ まだ画像が生成されていません';
  ELSIF image_count = file_count THEN
    RAISE NOTICE '  ✅ レコードとファイルが一致しています';
  ELSE
    RAISE NOTICE '  ⚠️ レコード数とファイル数が一致しません';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END $$;

