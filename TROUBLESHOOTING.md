# 🔧 画像が表示されない問題の解決方法

## 現在の状況

コンソールを見ると、画像のURLは生成されていますが、実際のファイルが読み込めていません。
これは以下のいずれかの原因です：

1. ✅ Supabase接続情報は正しく設定されている
2. ❌ ストレージバケットまたはポリシーが正しく設定されていない
3. ❌ データベースに画像レコードはあるが、実際のファイルが存在しない

## 📋 解決手順

### ステップ1: 診断SQLを実行（状況確認）

1. Supabase Dashboard を開く: https://app.supabase.com
2. プロジェクト `ulfbddqwumeoqidxatyq` を選択
3. **SQL Editor** を開く
4. **`storage-diagnostics.sql`** の内容をコピー&ペースト
5. **Run** をクリック

これで以下が表示されます：
- ストレージバケットの状態
- ポリシーの設定状況
- 画像レコードとファイルの整合性
- **診断結果サマリー** ← これが重要！

### ステップ2: storage-setup.sql を実行（修正版）

診断で問題が見つかった場合：

1. 同じSQL Editorで **新しいクエリ** を開く
2. **`storage-setup.sql`** の内容をコピー&ペースト
3. **Run** をクリック

これで以下が実行されます：
- ストレージバケットの作成（public設定）
- 既存のポリシーをすべて削除
- 新しいポリシーを作成（公開読み取り + 認証ユーザーの書き込み）

### ステップ3: Supabase Dashboardで手動確認

1. **Storage** メニューを開く
2. 以下のバケットが存在するか確認：
   - `generated-images` （Public: はい）
   - `brand-assets` （Public: はい）

もしバケットが **Private** になっている場合：
- バケットをクリック
- 右上の設定（⚙️）をクリック
- **Make public** を選択

### ステップ4: アプリをリロード

```bash
# 開発サーバーが起動していない場合
npm run dev
```

ブラウザでアプリをリロード（Ctrl+R または Cmd+R）

### ステップ5: コンソールで診断情報を確認

ブラウザの開発者ツール（F12）を開いて、Consoleタブで以下を確認：

```
📊 取得した画像数: X
📷 サンプル画像データ: {...}
🔗 生成されたURL: https://...
✅ 画像ファイルにアクセス可能です  ← これが表示されればOK
```

## 🔍 よくある問題と解決方法

### 問題1: 「画像ファイルにアクセスできません: 403」

**原因**: ストレージポリシーが正しく設定されていない

**解決方法**:
1. `storage-setup.sql` を再実行
2. Supabase Dashboard → Storage で各バケットが **Public** になっているか確認
3. もしPrivateになっていたら、手動でPublicに変更

### 問題2: 「画像ファイルにアクセスできません: 404」

**原因**: データベースに画像レコードはあるが、実際のファイルが存在しない

**解決方法**:
1. `storage-diagnostics.sql` を実行して整合性をチェック
2. 「ファイル不在」と表示される場合は、画像を再生成する必要があります
3. または、テスト画像をアップロードしてみる

### 問題3: バケットが表示されない

**原因**: バケットが作成されていない

**解決方法**:
1. `storage-setup.sql` を実行
2. SQL実行後、Storageメニューに `generated-images` が表示されるか確認

### 問題4: ポリシーエラーが表示される

**原因**: 既存のポリシーと競合している

**解決方法**:
```sql
-- すべてのストレージポリシーを削除
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;
```
その後、`storage-setup.sql` を再実行

## 🎯 最終確認チェックリスト

- [ ] `storage-diagnostics.sql` を実行した
- [ ] 診断結果で「✅」が表示されている
- [ ] `storage-setup.sql` を実行した
- [ ] Storageメニューで `generated-images` が **Public** になっている
- [ ] アプリをリロードした
- [ ] コンソールで「✅ 画像ファイルにアクセス可能です」と表示される
- [ ] ギャラリーで画像が表示される

## 💡 それでも解決しない場合

### デバッグ情報の収集

1. ブラウザのコンソール（F12）で表示される情報をすべてコピー
2. Supabase Dashboard → Storage → generated-images で以下を確認：
   - ファイルが存在するか
   - ファイル名は `storage_path` と一致するか
3. ネットワークタブで画像のリクエストを確認：
   - ステータスコード（200, 403, 404など）
   - レスポンスヘッダー

### 手動でテスト画像をアップロード

1. Supabase Dashboard → Storage → generated-images
2. **Upload file** をクリック
3. 任意の画像ファイルをアップロード
4. ファイル名をコピー（例: `test/image.png`）
5. SQL Editorで：
```sql
-- テスト画像レコードを作成
INSERT INTO generated_images (
  brand_id, 
  user_id, 
  storage_path, 
  prompt,
  expires_at
) VALUES (
  'your-brand-id',  -- 実際のbrand_idに置き換え
  'your-user-id',   -- 実際のuser_idに置き換え
  'test/image.png', -- アップロードしたファイル名
  'Test image',
  NOW() + INTERVAL '30 days'
);
```
6. ギャラリーで表示されるか確認

---

この手順で解決しない場合は、コンソールのエラーメッセージと診断SQLの結果を共有してください。

