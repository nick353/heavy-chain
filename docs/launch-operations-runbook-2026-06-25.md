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

## One-Page Production Flow

Use this exact path for customer-facing work:

1. Upload or select the product/material image in Heavy Chain before clicking `Runway workerで生成`.
2. Confirm the queued job has `provider=runway_mcp_local_worker`. If a material image was used, DB readback must show `hasReferenceImage=true` and a `referenceImageHandoff`.
3. Generate the matching output in the approved Codex/Runway MCP client. The prompt should describe one finished image only; do not ask for a grid unless the customer wants a grid.
4. Save the MCP result JSON with the Heavy Chain job ID:

```json
{
  "heavyChainJobId": "<generation_jobs.id>",
  "generationJobId": "<generation_jobs.id>",
  "taskId": "<runway task id>",
  "asset_urls": ["https://..."],
  "candidate_paths": ["/absolute/path/to/generated.png"]
}
```

5. Prefer watch mode for normal work. Use a single-job import only for deliberate recovery:

```bash
npm run worker:local-runway -- --job-id <generation_jobs.id> --mcp-result output/runway-mcp-results/inbox/<generation_jobs.id>.json
```

6. Accept the run only after all of these are true: `generation_jobs.status=completed`, `usage_events.status=succeeded`, `generated_images.storage_path` downloads, Gallery image natural width is non-zero, Canvas `Galleryから追加` can see the image, and the output passes visual review.

## Failure Triage

- `waiting_for_mcp_result` or a pending job older than 10 minutes: confirm the MCP JSON file contains `heavyChainJobId` or `generationJobId`, then drop it into `output/runway-mcp-results/inbox`.
- JSON moved to `failed/`: open the worker manifest/error, fix the JSON path, task URL, or job ID mismatch, then retry with single-job import.
- Reference image/handoff failure: verify the original UI submit produced `hasReferenceImage=true` and `referenceImageHandoff`; if not, resubmit from the material workbench rather than manually pasting raw image data.
- Runway consent page shows `localhost:15554` or `Consent session missing or expired`: stop using that path. Use the approved Codex Runway MCP tools only.
- Use `--allow-unmatched-mcp-result` only for one-off recovery after manually verifying the generated image belongs to that exact Heavy Chain job. Do not use it in watch mode.

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
