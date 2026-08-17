# Secrets

本番のsecretはSupabase Edge Function secretsまたはCI secret storageに置き、実値はcommitしない。

Required runtime secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` または `OPENAI_IMAGE_API_KEY`
- `PUBLIC_URL`

OpenAI画像生成はサーバー側の `supabase/functions/_shared/openaiImage.ts` を経由する。標準のfrontend設定は `VITE_GENERATION_PROVIDER=openai`。モデルを固定する場合は `OPENAI_IMAGE_MODEL`、編集モデルは `OPENAI_IMAGE_EDIT_MODEL`、APIの向き先を差し替える場合は `OPENAI_IMAGE_BASE_URL` を使う。

API keyは `VITE_*`、client bundle、localStorage、スクリーンショット、録画、artifact、ユーザー向けログへ出してはいけない。キー欠落時は `openai_image_api_key_missing` でfail-closedにする。今回の撤去作業ではAPI呼び出し・生成・課金を実行しない。

Optional analysis/runtime secrets:

- `GEMINI_API_KEY`
- `GEMINI_IMAGE_MODEL`
- `GEMINI_ANALYSIS_MODEL`

Frontend-only environment:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GENERATION_PROVIDER=openai`

Deployment-only:

- `SUPABASE_PROJECT_REF`
- `SUPABASE_ACCESS_TOKEN`

`npm run env:check` はsecretの値を表示せず、必要なキー名だけを検査する。
