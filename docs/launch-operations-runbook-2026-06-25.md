# Heavy Chain launch operations

Status: read-only production rehearsal is the default. The active hosted image route is the server-side OpenAI adapter.

## Read-only rehearsal

```bash
npm run verify:launch-ops
npm run monitor:production -- --skip-ui
```

The rehearsal checks asset freshness, authenticated Generate/Gallery/Canvas routes, mobile layout, relevant HTTP responses, Storage readback, and console/page/request errors. It does not submit a generation, call an external provider, change billing, or publish externally.

## Explicit generation verification

Only when the release scope explicitly allows provider execution:

1. Select a brand and existing Gallery/material asset.
2. Confirm rights and legal-safety input.
3. Submit one bounded OpenAI image request with an idempotency key.
4. Read back the job, generated image, Storage object, signed URL, Gallery, Canvas, and Download result.
5. Record prompt, feature, job ID, provider/model, status transitions, output hash, and cleanup proof.

Never place an API key, signed URL, raw data URL, or local file path in the client bundle or evidence.

## Failure handling

- Provider quota/auth failure: preserve the exact error and stop before an automatic retry.
- Pending or stale job: inspect Jobs and Edge Function readback before retrying.
- Reference image failure: use the material workbench and preserve the source/storage handoff metadata.
- Storage/signing failure: do not call Gallery or Download complete until the readback succeeds.

Billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA, security prompts, secret entry, destructive deletion, and external public publishing remain human-only.
