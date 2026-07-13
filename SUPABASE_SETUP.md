# Supabase設定クイックガイド

Supabaseの接続情報は `.env` の `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` で設定します。コードやブラウザのLocalStorageには保存しません。

## 設定手順

### ステップ1: `.env` を設定

```bash
cp .env.example .env
```

`.env` に以下を設定してください。

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

値は Supabase Dashboard の **Settings** → **API** から確認できます。

### ステップ2: Supabase migration を適用

```bash
supabase link --project-ref your-project-ref
supabase db push
```

SQL Editorで手動適用する場合は、`supabase/migrations/` を `001_initial_schema.sql` から最新まで順番に実行してください。

### ステップ3: アプリを起動

```bash
npm run dev
```

## データベースとストレージ

通常の Supabase 設定は `supabase/migrations/` を正本にします。最新 migration まで適用すると以下が作成されます。

- `generated-images` バケット（private）
- `brand-assets` バケット（private）
- `exports` バケット（private、一時ダウンロード用）
- private schema の権限判定関数
- RLS と storage policy

`supabase/storage-setup.sql` は、migration 適用後に storage bucket / policy だけを緊急再適用するためのファイルです。通常セットアップでは migration を使ってください。

## トラブルシューティング

画像が表示されない場合は、Supabase Dashboard → Storage で `generated-images`、`brand-assets`、`exports` が存在し、private になっているか確認してください。次に、最新 migration まで適用済みか確認してください。

ブラウザの開発者ツールでは、Console タブでエラーメッセージを確認できます。`supabase db push` 未適用、`.env` 不備、storage policy 不整合が主な原因です。

## 関連ドキュメント

- [詳細なセットアップガイド](./SETUP.md)
- [デプロイガイド](./DEPLOYMENT_CHECKLIST.md)

## セキュリティ

Anon Key は公開キーですが、コードへ直書きしないでください。実際のデータアクセスは Supabase の Row Level Security で保護します。
