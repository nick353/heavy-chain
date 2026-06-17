# Secrets

Store production secrets in Supabase Edge Function secrets and CI secret storage. Do not commit real values.

Required runtime secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `PUBLIC_URL`

Optional chat/completions override:

- `OPENAI_CHAT_API_KEY`: used before `OPENAI_API_KEY` for chat/completions only.
- `OPENAI_CHAT_BASE_URL`: OpenAI-compatible `/v1` base URL. Defaults to `https://api.openai.com/v1`.
- `OPENAI_CHAT_MODEL`: overrides the chat model. Defaults are set by each Edge Function.

`OPENAI_CHAT_API_KEY` is never used for image generation. DALL-E fallback requires `OPENAI_API_KEY`.

Optional Gemini model overrides:

- `GEMINI_IMAGE_MODEL`: image generation/editing model. Defaults to `gemini-2.5-flash-image`.
- `GEMINI_ANALYSIS_MODEL`: image analysis and text planning model. Defaults to `gemini-2.5-flash`.

Frontend-only environment:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Production frontend builds prefer those environment variables from the deploy
environment.

Deployment-only:

- `SUPABASE_PROJECT_REF`
- `SUPABASE_ACCESS_TOKEN`

Use `npm run env:check` to validate presence. The script prints names only, never values.
