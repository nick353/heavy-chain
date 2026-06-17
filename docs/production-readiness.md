# Production Readiness

Heavy Chain production readiness is gated by `npm run verify:full`.

Current production hardening points:

- Billing and usage are enforced through `private.reserve_brand_usage` before external API calls.
- Generated image database records use `storage_path` as the durable source of truth. Temporary signed URLs or data URLs can be returned to clients but must not be persisted as `image_url`.
- Edge Function telemetry is recorded through `private.record_edge_function_run`; public `SECURITY DEFINER` helpers are removed.

Before release, run:

```bash
npm run verify
npm run build
npm run supabase:verify
```

Run `npm run verify:full` when Playwright dependencies and Supabase CLI are available.
