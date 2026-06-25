# Heavy Chain Productization Final Checklist - 2026-06-25

Status: app functionality is verified; remaining launch work is product polish, operating discipline, and real customer asset acceptance.

Latest launch-ops proof: use `npm run verify:launch-ops` for a read-only production rehearsal. The command verifies Zeabur asset freshness, authenticated Generate/Gallery/Canvas routes, contact/OGP, mobile Generate/Gallery/Canvas, the saved auth state, and the final Runway hoodie proof without clicking generation submit.

## Release-Critical

- Generation prompt quality: all user-facing generation requests must pass through `heavy-chain-production-apparel-v1` prompt shaping. The prompt must not include QA labels, verification wording, random logos, or watermark requests unless the user explicitly asks for visible text.
- Image acceptance: generated assets must be reviewed for product identity, garment shape, fabric texture, unwanted text, obvious anatomy errors, background suitability, and reuse in Gallery/Canvas.
- Canvas export: Canvas can now export the current board as PNG from the toolbar. If a browser blocks export because of cross-origin image tainting, use individual image download and saved Canvas project reload as the fallback proof.
- Runway lane: use the approved-client MCP path only. Do not use `localhost:15554` consent or dynamic `mcp-remote` as the production generation route.
- Irreversible boundaries: billing, purchase, payment, checkout, secret rotation, and external-public posting still stop for human approval.

## Product Polish

- Empty states: Dashboard, Gallery, History, Jobs, Canvas, and Generate should give one concrete next action and avoid developer/debug phrasing.
- Failure states: local worker not running, Runway approval missing, rate limit, storage readback failure, and image load failure must show Japanese messages with the recovery path.
- Mobile: primary flows must remain usable at 390px width: Dashboard, Lightchain, Generate, Gallery, Canvas, and Brand settings.
- Performance: Gallery and Canvas should remain responsive with the latest generated image set; any slow image must produce a visible loading or retry state instead of a blank board.
- Public surface: OGP, favicon, product copy, privacy policy, terms, and contact route must be set before external launch.

## Operating Checklist

1. Start `npm run worker:local-runway:watch` on the approved Mac lane.
2. Generate from Heavy Chain production UI.
3. Run Runway MCP generation from the approved existing client.
4. Drop the MCP result JSON into `output/runway-mcp-results/inbox` with `heavyChainJobId` or `generationJobId`.
5. Confirm worker archives the JSON, DB row is completed, Storage readback is HTTP 200, Gallery shows the image, Canvas imports it, and Canvas export or project reload succeeds.

## Final UAT Set

- EC商品画像セット: product-shots -> Gallery -> Canvas -> PNG export.
- 着用画像: model-matrix -> Gallery detail -> Canvas reuse.
- デザイン探索: design-gacha -> History -> regenerate or reuse.
- 販促: campaign-image or multilingual-banner -> Gallery -> Canvas text/layout adjustment.
- 編集: remove background, colorize, upscale, variations with a real uploaded garment image.

Pass only when the output image is visually product-usable, not merely technically generated.

## Day-One Runbook

The canonical operating handoff is `docs/launch-operations-runbook-2026-06-25.md`.
