# G633 Production Scale And Alerting Plan

Updated: 2026-07-01

## Purpose

This plan defines the production or production-equivalent load, concurrency, SLO, cost, and alerting targets that must be approved before Heavy Chain can claim 10M-user public-launch readiness. It does not run a load test, buy monitoring software, enable checkout, publish externally, change DNS, or mutate production data.

## Hard Stops

Stop before billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA/security prompt, secret entry, external public publishing, destructive production cleanup, broad production load, DNS/hosting changes, new paid vendor setup, or alert destination setup.

## Current Safe Baseline

The current accepted baseline is non-destructive:

- G618 local synthetic scale: 1200 Gallery images, 600 Canvas objects, PNG export proof, and 96h read-only production monitor.
- G620 security operations: production monitor SLO checks, audit/RLS/RPC/Edge observability, abuse-case matrix, and incident response guidance.
- G631 production broad UX readback: 17 desktop routes and 8 mobile routes on Zeabur, with no submit/payment/publish action.
- G632 incident response drill: Runway failure, worker stop, Storage readback failure, RLS/permission anomaly, and generation-quality regression.

This baseline is not a real concurrent production load test and not external alerting.

## Approval-Required Load Tiers

| Tier | Purpose | Minimum target | Cost/risk bound | Required proof | Stop condition |
|---|---|---:|---|---|---|
| T0 local synthetic | Regression-safe UI/Canvas load | 1200 image records, 600 Canvas objects, export PNG valid | local only, no provider spend | `npm run verify:g618-scale-ops` | any route SLO, export, cleanup, or monitor blocker |
| T1 production read-only | Production health without mutations | 96h monitor, 0 failed jobs, 0 stale active jobs, Storage signed URL success, 0 Edge/usage failures | read-only | `npm run monitor:production` and release gate | any monitor blocker or non-allowlisted warning |
| T2 marker-scoped production UAT | Single-operator non-billing generation smoke | explicit marker, bounded job count, all DB/Storage/readback/cleanup proof | user-approved, no checkout/payment/publish, marker cleanup only | run manifest, DB/Storage/Gallery/Canvas readback, cleanup proof | failed cleanup, failed readback, provider/account limitation, unsafe content |
| T3 approved concurrency test | Production-equivalent concurrent generation/load | target users, job count, concurrency, duration, budget cap, rollback owner defined before start | explicit user/operator approval required | load manifest, monitor before/during/after, cost ledger, cleanup/readback, incident notes | budget cap, failure-rate threshold, stale jobs, Storage errors, worker backlog, H601/H602/public-entrypoint blocker |

## Proposed T3 Targets Before Execution

These are planning targets only. They require approval before any run:

- authenticated users: 25 synthetic/operator-controlled sessions
- generation jobs: 50 marker-scoped jobs across the 10 major features
- Runway concurrency: at most 2 image generations in flight unless the user approves a different provider limit
- duration: 30 minutes active window plus 60 minutes post-run monitor
- cost cap: operator-approved cap recorded before start
- data scope: one marker prefix, one brand, no broad cleanup
- success thresholds: generation failure rate <= 2%, stale active jobs = 0 after cleanup, Storage signed URL errors = 0, Edge failed/stale = 0, usage failed/stale = 0, no console/page/request failure on smoke UI readback

## Alerting Decision Packet

External alerting is useful but not automatic. Before adding any paid monitoring or alert destination, decide:

- vendor or built-in channel
- cost cap
- destination owner
- on-call window
- escalation policy
- retention period
- secrets storage path
- rollback/remove procedure

Minimum alert signals:

- generation failure rate above threshold
- stale pending/processing jobs
- local worker inbox backlog
- Storage signed URL/readback errors
- Edge Function failed/stale started runs
- usage reservation failures or stale reservations
- production UI probe failure
- release gate regression
- G617/G619/H601/H602/public-domain blockers still open during public-launch review

## Verification

Run:

```bash
npm run verify:g633-scale-alerting-plan
```

The verifier checks this plan, the existing G618/G620/G631/G632 proof paths, release-gate wiring, hard stops, T0-T3 tiers, proposed T3 targets, and alerting decision fields. Passing the verifier means the plan is ready for approval. It does not authorize or execute a load test, external alerting setup, purchase, payment, checkout, public publishing, DNS change, or destructive cleanup.
