# Apparel Heavy Chain Subdirectory State

Updated: 2026-06-23

This directory is a legacy/build-artifact subdirectory under `/Users/nichikatanaka/Desktop/アパレル１`. It is not the production source of truth by itself. Generated Obsidian pages are locators, not execution proof.

## Obsidian Context Fields

current_state: The project-owned Heavy Chain source of truth is `/Users/nichikatanaka/Desktop/アパレル１/STATE.md`. This subdirectory currently contains build artifacts, dependencies, and environment residue, but no independent app authority files. Treat it as a locator that points back to the root workspace.

next_action: Before any Heavy Chain work, fresh-read `/Users/nichikatanaka/Desktop/アパレル１/STATE.md`, then the root `README.md`, `package.json`, `src/`, `supabase/`, `docs/`, latest `output/` proof, and production readback artifacts. Do not deploy, edit production settings, or treat this subdirectory as current until the root state explicitly says to use it.

blocker: subdirectory_authority_missing_by_design_use_root_state

risk_gate: Do not deploy, change secrets, change Supabase/storage/auth/RLS settings, or use this directory's `.env` as proof. Billing, purchase, payment, checkout, secret changes, external service settings changes, deletion, and deploy require explicit user approval or a fresh root workflow contract.

maturity_candidate: locator_only_use_apparel_root_state

source_of_truth:
- Root Heavy Chain state: `/Users/nichikatanaka/Desktop/アパレル１/STATE.md`
- Root app code: `/Users/nichikatanaka/Desktop/アパレル１/src/`
- Root package/build authority: `/Users/nichikatanaka/Desktop/アパレル１/package.json`
- Root Supabase/deploy authority: `/Users/nichikatanaka/Desktop/アパレル１/supabase/`, `/Users/nichikatanaka/Desktop/アパレル１/zeabur.json`
- Root proof artifacts: `/Users/nichikatanaka/Desktop/アパレル１/output/`, `/Users/nichikatanaka/Desktop/アパレル１/test-results/`, and `/Users/nichikatanaka/Desktop/アパレル１/docs/`

proof_locator:
- Root state: `/Users/nichikatanaka/Desktop/アパレル１/STATE.md`
- Latest production/readback proof paths are listed in the root `proof_locator` and `latest_proof_locator` fields.

related_projects:
- Apparel AI Workspace: `/Users/nichikatanaka/Desktop/アパレル１` is the only current Heavy Chain execution source of truth.
- Automation OS: `/Users/nichikatanaka/Documents/Codex/automation-os` may display this subdirectory in Obsidian, but must not treat it as an independent execution-ready project.

## Boundary

If Obsidian shows this Context Pack, use it only to remember that this subdirectory exists. Resume, implementation, deployment, and verification must start from the root Heavy Chain `STATE.md`.
