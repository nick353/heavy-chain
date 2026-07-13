# 🚀 Heavy Chain - セットアップ完了ガイド

## ✅ Supabase設定

Supabaseの接続情報は `.env` で設定してください。

## 📋 次のステップ

### ステップ1: Supabase migration の適用（必須）

画像を表示するには、SupabaseでDBスキーマ、private bucket、storage policyを適用する必要があります。

```bash
supabase link --project-ref your-project-ref
supabase db push
```

SQL Editorで手動実行する場合は、`supabase/migrations/` を `001_initial_schema.sql` から最新まで順番に実行してください。

これで以下が作成されます：
- ✅ `generated-images` バケット（画像保存用）
- ✅ `brand-assets` バケット（ロゴ等）
- ✅ `exports` バケット（一時ダウンロード用）
- ✅ private bucket と RLS ベースのアクセスポリシー

### ステップ2: アプリを起動

```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。

### ステップ3: 画像が表示されることを確認

- ダッシュボードとギャラリーに移動
- 画像が正常に表示されれば完了です！🎉

## 🔍 トラブルシューティング

### 画像が「読込失敗」と表示される場合

**原因**: migration または storage policy が適用されていない

**解決方法**:
1. `supabase db push` で最新 migration を適用したか確認
2. Supabase Dashboard → **Storage** で以下を確認：
   - `generated-images` バケットが存在する
   - 一括ダウンロードを使う場合は `exports` バケットも存在する
   - バケットが **Private** になっている

### ストレージバケットの状態を確認

Supabase Dashboard で：
1. **Storage** メニューを開く
2. バケット一覧に以下が表示されるはず：
   - `generated-images` (Private)
   - `brand-assets` (Private)
   - `exports` (Private)

### データベーステーブルが見つからない場合

**解決方法**:
1. `supabase link --project-ref your-project-ref`
2. `supabase db push`

## 📊 確認項目チェックリスト

- [ ] Supabase `.env` 設定完了
- [ ] `supabase db push` を実行した
- [ ] ストレージバケットが作成されている
- [ ] 最新 migration まで適用した
- [ ] アプリが起動する
- [ ] ログイン/サインアップができる
- [ ] ダッシュボードが表示される
- [ ] ギャラリーページが開く
- [ ] 画像が正常に表示される

## 🎨 画像生成機能を使う場合（オプション）

実際に画像を生成したい場合は、Supabase Edge Functions に API キーを設定します：

1. Supabase Dashboard → **Edge Functions** → **Secrets**
2. 以下の環境変数を追加：
   ```
   GEMINI_API_KEY=your-gemini-api-key
   OPENAI_IMAGE_API_KEY=your-openai-api-key
   ```
   OpenAI のチャット系キーと共通にしたい場合だけ `OPENAI_API_KEY` でも動きます。画像生成専用に分けるなら `OPENAI_IMAGE_API_KEY` を使ってください。

## 💡 重要な注意事項

### セキュリティ

Supabaseの認証情報はコードへ直書きせず、必ず `.env` ファイルを使用してください：

1. プロジェクトルートに `.env` ファイルを作成
2. 以下を記載：
   ```env
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

**注意**: `.env` ファイルは `.gitignore` に含まれているため、Gitにコミットされません。

## 📚 関連ドキュメント

- [デプロイガイド](./DEPLOYMENT_CHECKLIST.md)
- [プロジェクト要件](./HeavyChain_Requirements%20(3).md)
- [次のステップ](./NEXT_STEPS.md)

## 🎉 完了！

すべてのステップを完了したら、Heavy Chainを使い始められます！

問題が発生した場合は、ブラウザの開発者ツール（F12）でコンソールのエラーメッセージを確認してください。
