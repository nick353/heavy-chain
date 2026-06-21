# Heavy Chain Current State

Updated: 2026-06-21

This file is the project-owned source of truth entrypoint for Codex/Obsidian resume. Generated Obsidian pages are locators, not execution proof.

## Obsidian Context Fields

current_state: Production app is deployed and QA-passed on app commit 7c93b450b77ad47c1a46773d5c74a865336fd645; release doctor passed with no STOP on 2026-06-21.
next_action: No repo-side launch-readiness task remains. Before any future storage/auth/RLS/payment/external-data change, fresh-read README.md, package.json, docs, output/release-prep, and the 2026-06-21 production QA artifacts below.
blocker: none for the requested launch-readiness closeout. Service-role key rotation was not performed by user instruction.
risk_gate: Billing, purchase, payment, or checkout still requires explicit human approval. Future storage/auth/RLS/deploy/external-data changes require fresh proof.
maturity_candidate: release_prep
proof_locator: output/release-prep/final-production-20260621/auth-qa/qa-auth-summary.json
public_url_qa_locator: output/release-prep/final-production-20260621/public-url-qa/qa-summary.json
prod_db_readback_locator: output/playwright/prod-db-readback.json
cleanup_locator: output/release-prep/final-production-20260621/auth-qa/cleanup.json
env_locator: output/release-prep/final-production-20260621/release-doctor-after-deploy.txt
decision_locator: docs
runbook_locator: README.md
