# Public entrypoint verifier contract drift — 2026-09-27 r1

## Fresh readback

`node scripts/verify-cloudflare-public-entrypoint-readback.mjs` produced
`output/playwright/g835-chosen-public-entrypoint-readback-r1/summary.json` at
`2026-09-27T07:43:09.481Z` with `ok=true`:

- chosen origin: `https://heavy-chain-web.nichika2000823.workers.dev`
- root status: `307`
- redirect: same-origin `/login?redirect=...`
- session endpoint status: `200`, unauthenticated body `null`
- submit, billing/payment, publish, and deployment: not touched

This proves public HTTP reachability and the unauthenticated fail-closed boundary. It does not prove authenticated UI, provider generation, or business completion.

## Contract mismatch

The current unified release gate accepts either:

- a `2xx` Heavy Chain shell with the expected marker, or
- a same-origin `3xx` protected redirect with `protectedRedirect=true`.

The current 10M completion audit still accepts only:

- a `2xx` response,
- `hasHeavyChainShell=true`,
- and no protected-redirect branch.

Therefore the same fresh readback passes the public-entrypoint item in the unified release-gate contract but remains a 10M `proof_not_complete:production_chosen_public_entrypoint_readback` blocker. This is verifier-contract drift, not evidence that the origin is unreachable.

## Bounded next decision

Do not fabricate a public shell or weaken a verifier by assertion. The next Astra engineering decision should choose one canonical contract:

1. Keep unauthenticated production fail-closed and update the 10M audit to accept the already-approved protected redirect branch; or
2. Provide a genuinely public, non-sensitive shell with the required marker, then retain the stricter 10M expectation.

Until that decision is made, preserve the current protected redirect, keep the readback artifact, and treat authenticated production proof as separate.

