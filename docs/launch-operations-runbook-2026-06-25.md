# Heavy Chain Launch Operations Runbook - 2026-06-25

Status: launch operations are verified through read-only production UI rehearsal. This runbook is the day-one operating path for Heavy Chain after the Runway MCP worker queue migration.

## Stop Rules

Stop before billing, purchase, payment, checkout, external publishing, identity verification, secret entry, production DB deletion, storage deletion, or proof artifact deletion. Capture the blocker and resume only after explicit human approval.

## Daily Operator Flow

1. Start the approved local worker lane:

```bash
npm run worker:local-runway:watch
```

2. In production Heavy Chain, create a generation job from the intended feature. Use `/generate?feature=campaign-image` for campaign visuals, or the feature-specific entrypoint for EC, fitting, graphic, editing, or multilingual work.
3. Use the approved existing Runway MCP client to generate the image. Do not open the `localhost:15554` consent path for production work.
4. Save the MCP result JSON into `output/runway-mcp-results/inbox` with `heavyChainJobId` or `generationJobId`.
5. Confirm the worker moves the JSON to `processed/`, the job is completed, Storage readback is HTTP 200, Gallery shows the image, Canvas can reuse it, and Canvas export or project reload works.

## Launch Verification Command

Run this before a public demo, sales call, or release handoff:

```bash
npm run verify:launch-ops
```

The command uses the saved production auth state at `output/playwright/prod-auth-refresh-20260625/auth-state.json`, opens `https://heavy-chain.zeabur.app`, verifies the current Zeabur asset, checks Dashboard, Generate, Gallery, Canvas, contact/OGP, mobile Generate/Gallery/Canvas, and confirms the final Runway image proof bundle exists. It fills the Generate prompt but does not submit generation.

Override paths when needed:

```bash
HEAVY_CHAIN_BASE_URL=https://heavy-chain.zeabur.app \
HEAVY_CHAIN_AUTH_STATE=output/playwright/prod-auth-refresh-20260625/auth-state.json \
HEAVY_CHAIN_EXPECTED_ASSET=assets/index.CTWP3Xmm.js \
npm run verify:launch-ops
```

## Quantity UAT

For product acceptance, run 10 to 20 real product prompts across these lanes:

- EC product material: `product-shots`, `remove-bg`, `upscale`
- Wearing image: `model-matrix`, `scene-coordinate`
- Graphic exploration: `design-gacha`, `colorize`, `variations`
- Promotion: `campaign-image`, `multilingual-banner`
- Editing: remove background, colorize, upscale, variations with a real garment input

Each accepted output must pass visual review for product identity, garment shape, fabric texture, unwanted text, obvious anatomy errors, background suitability, Gallery reuse, Canvas placement, and export or reload.

## Monitoring

At minimum, review these signals daily during launch week:

- pending `generation_jobs` older than 10 minutes
- failed `generation_jobs` with local worker or storage errors
- Storage signed URL failures for `generated-images`
- Gallery image count and image natural width in production UI
- worker process health and `output/runway-mcp-results/inbox` backlog
- Zeabur current asset and contact/OGP public surface

Use `npm run verify:launch-ops` for read-only UI proof and `npm run verify:runway-approved-generation` only when a strict approved generation readback is intended.

## Cleanup Policy

Do not delete proof artifacts listed in `STATE.md`. For disposable production UAT data, cleanup must be marker-scoped and must leave a JSON proof with deleted row IDs, removed storage paths, and zero residual readback. Never run broad deletion against production without explicit approval.

## Backup Checklist

Before external launch, save a recovery point for:

- GitHub `main` commit
- Zeabur environment variable names and deployment ID
- Supabase migration state
- Supabase Edge Function deployed versions
- Storage bucket names and policies
- latest `STATE.md`
- latest launch proof directories under `output/playwright/`

Do not store secret values in docs, screenshots, logs, or committed files.
