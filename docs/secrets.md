# Secrets

Store production secrets in Supabase Edge Function secrets and CI secret storage. Do not commit real values.

Required runtime secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RUNWAY_MCP_BRIDGE_URL`
- `RUNWAY_MCP_BRIDGE_TOKEN`
- `RUNWAY_MCP_TOKEN_ENCRYPTION_KEY`
- `PUBLIC_URL`

Optional Runway model override:

- `RUNWAY_IMAGE_MODEL`: image generation model. Defaults to `gen4_image`.

Image generation Edge Functions must call the Runway MCP bridge and must not call `https://api.dev.runwayml.com/v1` directly. `RUNWAYML_API_SECRET` is not an accepted Heavy Chain runtime secret; the bridge service is responsible for connecting to Runway MCP (`https://mcp.runwayml.com/mcp`) through its hosted `mcp-remote` auth cache. `RUNWAY_MCP_TOKEN_ENCRYPTION_KEY` is retained for the legacy first-party OAuth table, but production image generation does not require `runway_mcp_oauth_connections`. Missing bridge URL/token fails closed as `runway_mcp_bridge_not_configured`, bridge 401/403 fails as `runway_mcp_auth_required`, and bridge 402 fails as `runway_mcp_subscription_inactive`.

For local testing, `npm run start:runway-mcp-bridge` starts a temporary `127.0.0.1` bridge backed by the local Codex `mcp-remote` Runway MCP session. Production Supabase cannot call `127.0.0.1`; if this bridge is exposed through a tunnel such as `cloudflared`, use temporary HTTPS, a throwaway bridge token, and clean up the process/tunnel immediately after verification. Oversized requests fail closed as `runway_mcp_payload_too_large`. Do not manually transplant local MCP/OAuth tokens into `runway_mcp_oauth_connections` or related DB tables.

For permanent bridge hosting, deploy `Dockerfile.runway-mcp-bridge` as a separate service with a persistent `/data` volume and `RUNWAY_MCP_REMOTE_CONFIG_DIR=/data/.mcp-auth`. Store any static OAuth client info in a mounted file and pass `RUNWAY_MCP_STATIC_OAUTH_CLIENT_INFO_FILE`; do not pass client secrets as CLI arguments or raw environment JSON.

Runway MCP access has three gates:

1. Supabase Edge Function secrets must point to the bridge service with `RUNWAY_MCP_BRIDGE_URL` and `RUNWAY_MCP_BRIDGE_TOKEN`.
2. The hosted bridge must pass `/tools` using its persistent `MCP_REMOTE_CONFIG_DIR` auth cache.
3. Each brand must have `public.runway_mcp_connection_approvals.status = 'approved'` before any Runway-backed generation can reserve usage.

Do not store Runway MCP URLs, OAuth tokens, API keys, bridge tokens, or generated secret values in `runway_mcp_connection_approvals`. The table stores approval state only. A brand approval is durable on the Heavy Chain side, but generation can still fail closed if the hosted bridge loses Runway authorization, Runway credits/subscription expire, or the Heavy Chain subscription/plan gate fails.

Frontend-only environment:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Production frontend builds prefer those environment variables from the deploy
environment.

Deployment-only:

- `SUPABASE_PROJECT_REF`
- `SUPABASE_ACCESS_TOKEN`

Use `npm run env:check` to validate presence. The script prints names only, never values.
