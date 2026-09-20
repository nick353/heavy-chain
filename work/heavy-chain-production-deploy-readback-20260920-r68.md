# Heavy Chain production deploy/readback — 2026-09-20 r68

## Deployments

- Cloudflare Web was rebuilt from the current checkout, large assets were
  uploaded to the existing public R2 bucket, and Wrangler deployed version
  `a386799c-8574-4e77-9619-24cddfd432ae`.
- Zeabur service `heavy-chain` was redeployed with the official CLI to the
  resolved target environment. Deployment `6aafc154342483d22ad88cc7` reached
  `RUNNING` after the Docker build completed.
- Zeabur's `/_health` returned HTTP 200 with `hosting=zeabur`, `cloudflare.api=true`,
  and `cloudflare.auth=true`. Zeabur `/lightchain` returned HTTP 200.
- Cloudflare `/_health` and `/lightchain` both returned HTTP 200.

## Artifact readback

Cloudflare served `assets/index.DnyV_Ymg.js`; the deployed bytes matched the
Cloudflare build output exactly at 716,759 bytes with SHA-256
`b5c37151bd6b42325dfdc7bc22969f70ed62c3fcec195a0c059c35870fe7dcbb`.

Zeabur served `assets/index.ulbiRalL.js`. Rebuilding locally with the same
Zeabur Docker Vite environment (`VITE_CLOUDFLARE_API_ENABLED`, Cloudflare API
base, R2 media order, Workers AI provider, and Zeabur public URL) matched the
Zeabur bytes exactly at 716,759 bytes with SHA-256
`39e727e37a13002c82f9f0b999e58d5df3351b97c3693866bdacb2498bc1aed6`.

This proves deployment/build parity and public route reachability. It does not
prove provider generation, result persistence/reuse, authenticated monitor
completion, or business-level release acceptance.

## Credential boundary

Zeabur CLI login is valid and the target service/environment is resolved, but
the service still has no `HEAVY_CHAIN_MONITOR_TOKEN` or provider credential.
That monitor value is a live consumer-auth session and cannot be minted from a
Zeabur management login. No secret was guessed, extracted from the browser,
or assigned as a placeholder.

## Remaining gates

Provider receipt/result/save/reuse, same-run source sync and reconciliation,
production monitor/UI pair, launch operations, mass-market baseline, real
generation scorecard, G608/G618/G633/H602, and clean-worktree release
acceptance remain open. Backend auth/rights/provider guards remain fail-closed.
