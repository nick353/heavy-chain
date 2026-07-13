# Runway MCP Bridge

Heavy Chain image generation calls a bridge through `RUNWAY_MCP_BRIDGE_URL` and `RUNWAY_MCP_BRIDGE_TOKEN`. The preferred permanent path is a small always-on Node service running `scripts/runway-mcp-remote-http-bridge.mjs` with a persistent `MCP_REMOTE_CONFIG_DIR`.

## Runtime

Required environment variables:

- `RUNWAY_MCP_BRIDGE_TOKEN`: bearer token expected from Supabase Edge Functions.
- `RUNWAY_MCP_BRIDGE_HOST`: use `0.0.0.0` on hosted services.
- `PORT` or `RUNWAY_MCP_BRIDGE_PORT`: service port.
- `RUNWAY_MCP_REMOTE_CONFIG_DIR`: persistent auth cache directory. Use `/data/.mcp-auth` with a mounted persistent volume.

Useful optional variables:

- `RUNWAY_MCP_REMOTE_CALLBACK_PORT`: fixed OAuth callback port for first authorization or reauthorization.
- `RUNWAY_MCP_REMOTE_CALLBACK_HOST`: callback host passed to `mcp-remote`.
- `RUNWAY_MCP_REMOTE_AUTH_TIMEOUT_SECONDS`: callback wait timeout.
- `RUNWAY_MCP_REMOTE_TRANSPORT`: `http-first`, `http-only`, `sse-first`, or `sse-only`.
- `RUNWAY_MCP_REMOTE_RESOURCE`: isolates the OAuth session if needed.
- `RUNWAY_MCP_REMOTE_DEBUG=1`: writes detailed `mcp-remote` logs into the auth cache directory.
- `RUNWAY_MCP_STATIC_OAUTH_CLIENT_METADATA_FILE`: file path for static OAuth client metadata.
- `RUNWAY_MCP_STATIC_OAUTH_CLIENT_INFO_FILE`: file path for static OAuth client info. Use a file, not a raw environment variable, because this can include a client secret.

## Deploy Shape

Use `Dockerfile.runway-mcp-bridge` as a separate service from the Vite frontend.

The service must have a persistent volume mounted at `/data`; otherwise every restart can lose the Runway MCP authorization cache and the bridge will fail closed until reauthorized.

After deployment:

1. Set `RUNWAY_MCP_BRIDGE_TOKEN` on the bridge service and the same value in Supabase production secrets.
2. Attach a persistent volume at `/data`.
3. Set Supabase `RUNWAY_MCP_BRIDGE_URL` to the hosted bridge HTTPS origin.
4. Use unauthenticated `GET /healthz` only for platform health checks. Heavy Chain verification uses authenticated `GET /health`.
5. Run `npm run verify:runway-mcp-bridge` against the hosted URL with `--live-generate` omitted.
6. Run `npm run verify:runway-readiness`.
7. Only after hosted bridge `/tools` and paid plan readiness pass, run the strict approved-generation readback.

## First Authorization

`mcp-remote` stores OAuth credentials under `MCP_REMOTE_CONFIG_DIR`. Do not copy tokens into Heavy Chain DB tables. The cache belongs to the bridge service runtime.

If the hosted service needs first authorization or reauthorization, temporarily enable debug logs and run the bridge with a fixed callback host/port that the hosting platform can expose. Complete the Runway authorization in the browser, verify `/tools`, then disable debug logs and keep the persistent volume.

If Runway returns `Consent session missing or expired`, do not loop retries. Keep the artifact and escalate to Runway MCP support with redacted logs.

## Local Smoke

```bash
RUNWAY_MCP_BRIDGE_TOKEN=local-bridge-smoke-token npm run start:runway-mcp-bridge
RUNWAY_MCP_BRIDGE_URL=http://127.0.0.1:58744 RUNWAY_MCP_BRIDGE_TOKEN=local-bridge-smoke-token npm run verify:runway-mcp-bridge
```

The verifier does not generate images unless `--live-generate` is explicitly passed.
