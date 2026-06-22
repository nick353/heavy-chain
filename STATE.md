# Heavy Chain Current State

Updated: 2026-06-22

This file is the project-owned source of truth entrypoint for Codex/Obsidian resume. Generated Obsidian pages are locators, not execution proof.

## Obsidian Context Fields

current_state: Production app is deployed/readback-passed for the 2026-06-22 parity closeout. Commit `977ddb60e88de032c902c10df7622c401e6d77e1` has been pushed to `origin/main`. `deploy-edge-functions.sh` deployed `generate-image`, `remove-background`, `upscale`, `colorize`, `generate-variations`, `design-gacha`, `product-shots`, `model-matrix`, `multilingual-banner`, `optimize-prompt`, `marketing-workspace-artifact`, `bulk-download`, and `share-link` to production Supabase project `ghwjymozrwmcrpjqvbmo`. Production readback proof is saved under `output/playwright/production-parity-readback-20260622/summary.json` with `prod-db-readback.json`, `prod-cleanup.json`, `rate-limit-db-proof-2.json`, `rate-limit-cleanup-2.json`, public auth QA at `output/release-prep/production-parity-20260622/public-auth-qa/qa-summary.json`, doctor proof at `output/release-prep/production-parity-20260622/release-doctor.txt`, and browser-use current proof at `output/release-prep/production-parity-20260622/browser-use-current`. Marketing production proof confirms `marketing-workspace-artifact` job/image/storage readback and `image_url: null`. Fitting/Models production proof confirms `model-matrix` readback for Street LOOK 30s with `regular / 30s / medium / medium` source metadata plus usage/run/storage readback. Cleanup remaining users is `0`. `release:doctor` is all OK.
latest_slice: `production-parity-readback-20260622` closes the deploy/readback gap for Marketing and Fitting/Models. It promotes the prior local/mock `marketing-workspace-artifact` and `model-matrix` persistence work to production proof on project `ghwjymozrwmcrpjqvbmo`, with database, storage, cleanup, rate-limit, public auth QA, release doctor, and browser-use current artifacts recorded.
next_action: Connect `/studio`, `/patterns`, `/video`, and `/lab` beyond local artifact/Canvas/Gallery/History handoff into real generation and server-side workflow/readback. The next useful slice should make those workspaces create durable generation jobs with DB/Storage readback for scene/studio composition, graphic/pattern/vector generation, video rendering, and lab simulation. Keep billing, purchase, payment, checkout, future RLS/auth/storage/external-data changes, and new production deploys behind fresh proof and explicit approval.
blocker: none for the requested launch-readiness closeout. Service-role key rotation was not performed by user instruction.
risk_gate: Billing, purchase, payment, or checkout still requires explicit human approval. Future storage/auth/RLS/deploy/external-data changes require fresh proof.
maturity_candidate: release_prep
proof_locator: output/playwright/production-parity-readback-20260622/summary.json; output/playwright/production-parity-readback-20260622/prod-db-readback.json; output/playwright/production-parity-readback-20260622/prod-cleanup.json; output/playwright/production-parity-readback-20260622/rate-limit-db-proof-2.json; output/playwright/production-parity-readback-20260622/rate-limit-cleanup-2.json; output/release-prep/production-parity-20260622/public-auth-qa/qa-summary.json; output/release-prep/production-parity-20260622/release-doctor.txt; output/release-prep/production-parity-20260622/browser-use-current; output/playwright/source-context-summary-local-20260622/manifest.json; output/playwright/pattern-structured-context-local-20260622/manifest.json; output/playwright/model-library-local-20260622/manifest.json
latest_proof_locator: output/playwright/production-parity-readback-20260622/summary.json
public_url_qa_locator: output/release-prep/production-parity-20260622/public-auth-qa/qa-summary.json
prod_db_readback_locator: output/playwright/production-parity-readback-20260622/prod-db-readback.json
cleanup_locator: output/playwright/production-parity-readback-20260622/prod-cleanup.json
env_locator: output/release-prep/production-parity-20260622/release-doctor.txt
decision_locator: docs
runbook_locator: README.md
