# 画像が表示されない場合の確認手順

画像表示は Private bucket と signed URL が前提です。`generated-images`、`brand-assets`、`exports` を Public にしたり、root の `storage-setup.sql` / `setup.sql` を実行したりしないでください。

## まず確認すること

Supabase の接続情報、DB レコード、Storage ファイル、signed URL 生成のどこで失敗しているかを切り分けます。古い公開バケット手順では直さず、最新 migration を正本として復旧してください。

1. Supabase Dashboard で対象プロジェクトを開く。
2. SQL Editor で `storage-diagnostics.sql` を実行し、bucket、policy、画像レコード、実ファイルの整合性を確認する。
3. ローカルまたは運用手順で最新 migration を適用する。

```bash
supabase db push
```

## Storage の正しい状態

以下の bucket はすべて Private です。

- `generated-images`
- `brand-assets`
- `exports`

画像の表示には public URL ではなく signed URL を使います。403 が出る場合は bucket を Public に変更せず、signed URL の生成、ログイン状態、RLS / storage policy、`storage_path` と実ファイル名の一致を確認してください。

## よくある症状

### 403 が出る

Private bucket に対して signed URL が発行されていない、期限切れ、または現在のユーザーに対象ブランドの参照権限がない可能性があります。最新 migration を適用し、アプリ側が signed URL を取得しているか確認してください。

### 404 が出る

DB の `storage_path` に対応する実ファイルが Storage に存在しない可能性があります。`storage-diagnostics.sql` で不一致を確認し、必要なら画像を再生成してください。

### bucket や policy が壊れている

通常は migration を再適用します。

```bash
supabase db push
```

緊急時に Storage bucket / policy だけを手動復旧する場合に限り、Supabase SQL Editor で `supabase/storage-setup.sql` を実行してください。このファイルは private bucket と RLS-backed access policy を再適用するための emergency reapply です。

## 最終確認

- `storage-diagnostics.sql` で bucket / policy / file 整合性を確認した
- 最新 migration を適用した
- `generated-images`、`brand-assets`、`exports` が Private のままになっている
- アプリが signed URL で画像を表示している
- ギャラリーで対象画像が表示される

解決しない場合は、ブラウザ Console と Network のエラー、`storage-diagnostics.sql` の結果、対象画像の `storage_path` を確認してください。
