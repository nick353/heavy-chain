# Light Chain parity — progress ledger

Goal loop started 2026-10-06 (Claude Code). Source of truth for the plan: `docs/HANDOFF_LIGHTCHAIN_PARITY_2026-10-06.md`.
Each iteration: read this file → advance the next open item → append result (変更／検証／残blocker／次の作業) → commit.

## Standing rules
- Compare Light (`https://jp.linkaigc.com`) and Heavy (`https://heavy-chain.zeabur.app`) with AOS Chrome Companion at 1440×900 (also 1280 / 2560).
- Release = production 360-file input set (`docs/handoff/production-input-manifest-20261006.json` + reverse overlay patch) **plus only the files changed for the accepted fix**. Never ship the 10 unverified WIP files or pending Worker/migration changes wholesale.
- Deploy: `zeabur deploy --service-id 6a318803302ffbcd03a92935 --json -i=false` from the release tree (project 69df815a554543d46b0f2485, env 69df815a5ae0a69725e92048). Pre-approved.
- Do not replay historical unknown-effect operations (Canvas r1008, Studio pendingACK, Pose, Angle back, Wear R07, old Light viewport tab).

## Release tree overlay (files that differ from the 2026-10-06 production input)
- src/pages/LightchainParityPages.tsx, src/components/DesignArtifactThumbnail.tsx, src/index.css, src/lib/designProjectArtifacts.ts (iteration 1)

## Phase status
| Phase | Status |
|---|---|
| P0 source reproduction | done — build/typecheck/119 regressions + Worker 158 pass; prod 360-file hash match after reverse patch |
| P1 route/state parity ledger | in progress — see `docs/parity/route-ledger.md` |
| P2 20 items / 31 features | open |
| P3 Provider/D1/R2 identity, unknown-op settlement | open — needs Cloudflare admin access (self-acquire) |
| P4 quality / speed / Mac 1280–2560 | open (Windows device + operator out of scope for now) |
| P5 final reconciliation | open |

## Known pre-existing test failures (not caused by parity work)
- `scripts/verify-heavy-canonical-aliases.test.ts` — alias boundary regex
- `scripts/verify-design-artifact-thumbnail.test.ts` — expects old `onOpen={openProject}` card wiring

## Log

### 2026-10-06 iteration 1 — /designProduction project + dialogue tabs
- 変更: conversation projects merged into Light's single recency-ordered "マイプロジェクト" / "最近のプロジェクト" grids (`mergeDesignProjectGridItems`); card CSS no longer depends on nth-child (the extra conversation section had broken the 220×240 / 167px cover layout); covers top-aligned at natural aspect; send arrow ↑; scene labels 16px medium with lighter gradient; "すべて表示" 14px nowrap; error state no longer shows the empty-state copy.
- 検証: tsc, vite build, design tests 21/21 + new merge test 3/3, regressions 119/119; Codex review ×2 (findings fixed). Deployed Zeabur `6ac4eee04a4c47e13ede418a` (RUNNING) from prod tree + 4 files.
- 本番readback: Companion 1440×900 — card grid x=141, top=520, 5 columns × 228px pitch, heading y≈487, conversation card merged first with default cover; matches Light capture of the same state.
- 残: thumbnail resolve latency (~5s) → P4 speed; default cover still hotlinked from Light.
- 次: build route inventory from Light navigation, then group 1 remaining (designProduction/detail, header/account menu).

### 2026-10-06 iteration 2 — release tooling, Cloudflare probe, /creator
- 変更: `docs/parity/release.sh` + `release-overlay.txt` rebuild prod 360-file tree + overlay, typecheck/build, deploy. /creator fixed (see route-ledger #7).
- 検証: parity tests 67/70 identical before/after (3 pre-existing failures: launcher order ×2, Wear Design Lab card regex). Codex review: only finding = style panel empty after selection → recorded as unconfirmed-light. Deployed `6ac4f1bc4a4c47e13ede41e9`, Companion readback matches Light geometry (video 408–1032, keyword box bottom ≈796, button y≈831).
- **Blocker (P3)**: `wrangler` is logged in (OAuth, account ffa9a931…, d1 write scope) but Claude Code's auto-mode classifier denied a read-only remote D1 query as "Production Reads". Needs the user to allow it (permission rule) — do not work around.
- 次: /printing, /tools/fabric, then 素材 group.
