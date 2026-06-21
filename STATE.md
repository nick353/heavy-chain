# Heavy Chain Current State

Updated: 2026-06-21

This file is the project-owned source of truth entrypoint for Codex/Obsidian resume. Generated Obsidian pages are locators, not execution proof.

## Obsidian Context Fields

current_state: Production URL QA and authenticated production smoke QA passed on 2026-06-20; release-prep work is tracked in this repo plus output artifacts.
next_action: Treat production as QA-passed but release-gated. Before any launch/deploy/storage/auth/RLS/payment/external-data change, fresh-read README.md, package.json, docs, output/release-prep, and the 2026-06-20 production QA artifacts below.
blocker: release gate still requires explicit approval for storage/auth/RLS/deploy/payment/external data changes; plain shell env is missing production secrets and must not be treated as deploy-ready.
risk_gate: Do not change storage/auth/RLS/deploy/payment/external data without explicit approval and current proof.
maturity_candidate: release_prep
proof_locator: output/playwright/prod-auth-qa-20260620/qa-auth-summary.json
public_url_qa_locator: output/playwright/prod-url-qa-20260620/qa-closeout.json
prod_db_readback_locator: output/playwright/prod-auth-qa-20260620/prod-db-readback.json
cleanup_locator: output/playwright/prod-auth-qa-20260620/prod-cleanup.json
env_locator: output/playwright/prod-auth-qa-20260620/env-check-summary.json
decision_locator: docs
runbook_locator: README.md
