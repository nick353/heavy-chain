# 🔧 Supabase設定クイックガイド

提供いただいたAnon Key (`sbp_257c591725f8def68c6316c5859a76c31845979c`) を使用して、簡単にSupabaseを設定できるようにしました。

## 📝 設定手順（2ステップ）

### ステップ1: アプリを起動

```bash
npm run dev
```

アプリを開くと、**Supabase設定モーダル**が自動的に表示されます。

### ステップ2: Project URLを入力

1. [Supabase Dashboard](https://app.supabase.com) にログイン
2. プロジェクトを選択
3. **Settings** → **API** に移動
4. **Project URL** をコピー（例: `https://xxxxx.supabase.co`）
5. モーダルのフィールドに貼り付けて **「保存してリロード」** をクリック

これで完了です！画像が表示されるようになります。

## 🎨 追加の設定

### ストレージバケットのセットアップ

画像を表示するには、Supabaseのストレージバケットとポリシーを設定する必要があります。

1. Supabase Dashboard で **SQL Editor** を開く
2. `supabase/storage-setup.sql` の内容をコピー&ペースト
3. **Run** をクリック

これにより以下が作成されます：
- ✅ `generated-images` バケット（公開設定）
- ✅ `brand-assets` バケット（公開設定）
- ✅ 適切なアクセスポリシー

### データベーススキーマのセットアップ

1. Supabase Dashboard で **SQL Editor** を開く
2. `setup.sql` の内容をコピー&ペースト
3. **Run** をクリック

## 💡 便利な機能

### 設定を変更する

右下の⚙️アイコンをクリックすると、いつでも設定モーダルを開けます。

### ブラウザコンソールから設定

開発者ツール（F12）のコンソールで以下のコマンドが使えます：

```javascript
// 現在の設定を確認
checkSupabaseConfig()

// URLを設定
setSupabaseUrl("https://your-project.supabase.co")
```

## 🔍 トラブルシューティング

### 画像が表示されない場合

1. **ストレージバケットを確認**
   - Supabase Dashboard → Storage
   - `generated-images` バケットが存在し、Public になっているか確認

2. **ストレージポリシーを確認**
   - `supabase/storage-setup.sql` を実行したか確認

3. **コンソールでエラーを確認**
   - ブラウザの開発者ツール（F12）を開く
   - Console タブでエラーメッセージを確認
   - デバッグ情報が表示されます：
     ```
     Fetched images: X images
     Sample image data: {...}
     Image URL generated: {...}
     ```

### 設定をリセットする

設定モーダルで **「リセット」** ボタンをクリックすると、保存した設定がクリアされます。

## 📚 関連ドキュメント

- [詳細なセットアップガイド](./SETUP.md)
- [デプロイガイド](./DEPLOYMENT_CHECKLIST.md)

## ⚙️ 技術的な詳細

### 設定の保存場所

- **開発環境**: ブラウザの LocalStorage に保存
- **本番環境**: `.env` ファイルの環境変数を使用（推奨）

### 提供されたAnon Key

以下のAnon Keyがコードに組み込まれています：
```
sbp_257c591725f8def68c6316c5859a76c31845979c
```

このため、**Project URLのみ**設定すれば動作します。

### セキュリティについて

- Anon Keyは公開キーなので、フロントエンドコードに含めても安全です
- 実際のデータアクセスは、Supabaseの Row Level Security (RLS) で保護されています
- 本番環境では、必ず環境変数（`.env`）を使用してください

## 🎉 完了！

これで画像が正常に表示されるはずです。問題が解決しない場合は、上記のトラブルシューティングを確認してください。

