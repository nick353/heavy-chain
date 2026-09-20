# Heavy Chain Companion production route readback — 2026-09-20 r51

## Result

Using a fresh task-owned AOS Chrome Companion session, ten Cloudflare Web
routes were read in temporary tabs:

- `/lightchain`
- `/marketing`
- `/model`
- `/flow/GenerateShortVideo`
- `/flow/GenerateShortVideo/detail?project=new`
- `/gallery`
- `/history`
- `/jobs`
- `/canvas/new`
- `/designProduction`

Coverage was `10/10`, failed `0`, cancelled `0`, and every temporary tab
reported `status=read` with `cleanup.closed=true`. The session close receipt
reported `ok=true`, `foreign_tabs_mutated=false`, and
`external_action_executed=false`.

## Boundary

The temporary Companion tabs reached the current Cloudflare origin, but their
semantic readback remained in the workspace-preparation shell for the
protected routes. The result is therefore production route reachability and
cleanup evidence, not stable authenticated business-state proof. It does not
prove provider generation, private-media persistence, save/reuse/reload,
source synchronization, reconciliation, or release acceptance.

The exact next step remains a same-session authenticated production readback
with a stable owner-bound session, followed by provider receipt and
reconciliation. No auth cookie, token, or storage state was exported.
