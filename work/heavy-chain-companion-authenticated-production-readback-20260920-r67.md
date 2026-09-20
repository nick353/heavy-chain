# Heavy Chain authenticated production readback — 2026-09-20 r67

## Result

One task-owned AOS Chrome Companion session reached the authenticated Cloudflare
Web surface and completed same-tab semantic plus visual readback. The session
was closed with the owner cleanup receipt: `ok=true`, one task tab closed, one
lease released and confirmed, no retained or unknown-effect tabs, no foreign-tab
mutation, and no external action.

No cookie, storage state, auth token, provider credential, or other secret was
exported.

## Readback matrix

| Route | Fresh authenticated readback |
| --- | --- |
| `/lightchain` | `Lightchain AI`; header, category tabs, six feature cards, authenticated avatar; no visible rights checkbox. |
| `/model` | AI fitting controls, single/multi-task tabs, input tabs, generation history; generation control is `権限がありません`; no visible rights checkbox. |
| `/flow/GenerateShortVideo` | Video Workstation with `新規ファイル`, six recent Untitled projects, five reference cases, and `修正` actions. |
| `/gallery` | `12枚の画像`, selection/favorite/sort controls, saved cards and detail actions. |
| `/history` | Generation timeline, resume/jobs/gallery continuation links, saved count and failure-state wording. |
| `/jobs` | Production Queue with refresh/new/reopen/stopped/completed lanes; current queue is empty. |
| `/canvas/new` | Nisen canvas with toolbar, Canvas/派生ツリー, save/export, Gallery add, and feature actions; generation state is `権限がありません`; no rights checkbox. |
| `/designProduction` | Source-shaped design workspace with project/dialog start tabs, four new-project actions, and empty My Projects state. |
| `/model-library/model-custom-form` | Model customization tabs/fields, model history link, and `権限がありません`; no rights checkbox. |
| `/generate?feature=campaign-image` | Stayed in the generation-preparation shell after the bounded wait; no provider action was submitted and this route is not promoted to business completion. |

## Zeabur and credential boundary

The official Zeabur CLI is logged in as the account owner and resolves the
personal workspace, project `automation-wiled`, service `heavy-chain`, and its
environment. The service readback contains the two Cloudflare Web configuration
variables only; it does not contain `HEAVY_CHAIN_MONITOR_TOKEN` or a provider
credential. A Zeabur management login cannot mint or substitute the live
consumer-auth bearer session required by the monitor/API verifier. No guessed,
empty, unrelated, or extracted secret was assigned.

The latest Zeabur deployment failed before runtime because commit `12fa010`
referenced the new `SourceModelLibrarySurface` module without including that
file in the pushed commit. The five new parity source files are now selected for
the corrective commit; deployment/readback remains pending until that commit
is pushed and Zeabur reports a successful build.

## Remaining gates

Provider generation/result/save/reuse and same-run source-sync/reconciliation
remain unproven. The production monitor/UI pair, launch operations,
mass-market baseline, real-generation quality scorecard, G608/G618/G633/H602,
and clean-worktree release acceptance also remain open. The backend continues
to fail closed when provider/auth/permission proof is absent.
