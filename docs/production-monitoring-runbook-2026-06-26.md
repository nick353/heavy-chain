# Heavy Chain Production Monitoring Runbook

Updated: 2026-06-26

## Daily Command

Run this from the Heavy Chain root:

```bash
npm run monitor:production
```

The command is read-only. It does not click generation submit, purchase, payment, checkout, cleanup, or external publishing actions.

## What It Checks

- generation failure rate from `generation_jobs`
- stale `pending` / `processing` generation jobs
- provider and image-storage failures tied to recent generation jobs
- Edge Function failures from `edge_function_runs`
- usage reservation/failure health from `usage_events`
- generated image Storage signed-url readback
- Zeabur UI health through the existing launch-ops probe, including relevant console/page/network failures

## Outputs

Each run writes:

- `output/playwright/production-monitor-*/summary.json`
- `output/playwright/production-monitor-*/SUMMARY.md`
- nested UI proof under `output/playwright/production-monitor-*/ui/`

Use `SUMMARY.md` for the human daily readout and `summary.json` for exact blocker details.

## Triage Rules

- `generation_failure_rate_high`: inspect recent failed Jobs first, then worker artifacts.
- `stale_generation_jobs_detected`: inspect the job, Edge Function, and OpenAI provider readback before retrying.
- `generated_image_storage_errors`: inspect `generated_images.storage_path` and Storage object existence before trusting Gallery.
- `production_ui_probe_failed`: open the nested UI proof screenshots and console/network failure details.
- `local_worker_inbox_stale_files`: old audit files may remain, but fresh files should be processed or archived.

## Boundaries

The hosted image path is the server-side OpenAI adapter. Billing, purchase, payment, checkout, identity verification, security prompts, secret entry, and external public publishing remain human-only.
