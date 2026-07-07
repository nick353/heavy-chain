# Lightchain Production Proof Next Steps - 2026-07-07

## Current Gate
- Local upgraded `/lightchain/fashion-studio` proof is complete:
  - `output/playwright/lightchain-all-feature-workflows-20260707-fashion-studio-r2/SUMMARY.json`
  - `output/playwright/lightchain-canvas-metadata-readback-20260707-fashion-studio-r1/SUMMARY.json`
  - `output/playwright/lightchain-chrome-proof-20260707-profile2-local-fashion-studio-upgraded/SUMMARY.json`
- Completion matrix remains `30 Lightchain同等 / 1 ほぼ同等 / 0 部分一致 / 0 Heavy未実装`.
- `fashion-studio` stays `ほぼ同等` until the upgraded surface is available on production and verified with Chrome plugin/Profile 2.
- Latest production focused proof confirms the blocker:
  - `output/playwright/lightchain-chrome-proof-20260707-profile2-prod-fashion-studio-current-r1/SUMMARY.json`
  - `blocker=production_upgraded_surface_not_available`

## Approval Required Before Proceeding
- Deploy/publish production changes.
- External or real AI generation submit.
- Paid/video generation, checkout, payment, credit purchase, billing.
- Credential entry, OTP, CAPTCHA, security-code, identity verification.
- Destructive cleanup or quota/security bypass.

## Next Safe Production Proof After Approved Deploy
1. Use Chrome plugin/Profile 2 only.
2. Open `https://heavy-chain.zeabur.app/lightchain/fashion-studio`.
3. Confirm final URL is not `/login`.
4. Save screenshot, DOM/body readback, controls JSON, and `SUMMARY.json`.
5. Required readback checks:
   - Heavy Chain logo remains visible.
   - `ファッションスタジオ` is visible.
   - `スタジオ案` / `コーディネート` / `360度表示` are visible.
   - Example prompts are visible.
   - Prompt box and `AI生成` are visible.
   - `生成履歴` and history cards are visible.
   - No payment, checkout, publish, external generation, or credential action was performed.

## Promotion Rule
- Promote `fashion-studio` from `ほぼ同等` to `Lightchain同等` only after:
  - production Chrome/Profile 2 upgraded surface proof is `ok=true`, and
  - no hard-stop action was crossed, and
  - matrix/status/STATE are updated with the production proof URI.

## If Blocked
- If redirected to `/login`, record exact blocker `profile2_prod_auth_missing` and stop.
- If production still shows the older simplified studio surface, keep `fashion-studio` as `ほぼ同等` and record `production_upgraded_surface_not_available`.
