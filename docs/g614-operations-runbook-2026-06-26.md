# Heavy Chain operations runbook

This runbook describes the current Lightchain-compatible Heavy Chain workflow. Hosted image generation uses the OpenAI image adapter; the retired third-party worker and OAuth bridge are not part of the product.

## Normal flow

1. Open the authenticated Heavy Chain workspace.
2. Select a brand and feature, then upload or choose a material when required.
3. Confirm rights and legal-safety input before generation.
4. Submit once from Generate or the relevant workspace.
5. Read the job result from Jobs/History, then continue to Gallery, Canvas, or Download.

## Provider boundary

- Edge Functions call `supabase/functions/_shared/openaiImage.ts` through the shared provider adapter.
- `OPENAI_API_KEY` or `OPENAI_IMAGE_API_KEY` stays server-side in Supabase secrets.
- Signed URLs, raw data URLs, local filesystem paths, and secret values are never persisted as public image URLs or emitted in logs.
- OpenAI API calls, generation, billing, and deployment are separate release actions and must be explicitly verified before execution.

## Monitoring and recovery

- `generation_failure_rate_high`: inspect recent Jobs and Edge Function readback.
- `stale_generation_jobs_detected`: inspect the job state and provider error before retrying.
- `generated_image_storage_errors`: verify `generated_images.storage_path` and Storage signing before trusting Gallery.
- `production_ui_probe_failed`: inspect the nested UI proof screenshots and console/network details.

Use:

```bash
npm run monitor:production
npm run verify:launch-ops
npm run verify:release-gate
```

## Stop conditions

Stop on billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA, secret entry, external publishing, destructive deletion, or an unavailable browser/Supabase permission surface. Record the exact blocker, current evidence, and restart point.
