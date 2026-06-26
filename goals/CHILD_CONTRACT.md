# CHILD_CONTRACT.md

Loop-wide contract for every Heavy Chain 10M product-readiness child goal.

## Ownership

Own exactly one assigned goal packet. Do not change parent `GOAL.md`, unrelated child packets, or unrelated code unless the parent packet explicitly requires it. Follow repository instructions first.

## Boundaries

Allowed: inspect files, implement assigned UI/UX/verification scope, run local and Zeabur QA, use Playwright recording/screenshots/DOM, use bounded non-billing marker-scoped generation QA, create evidence under `output/playwright/10m-product-readiness-*`, update assigned docs/state when packet allows it.

Not allowed without explicit parent approval: commit, push, deploy, change secrets, change billing/payment/checkout/identity flows, external public publishing, destructive cleanup outside marker-scoped QA artifacts, or use the old `localhost:15554` Runway dynamic-client OAuth flow.

## Validation

For code changes, run targeted checks and report `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run build`, and `git diff --check` status or why each was not run.

For UI/UX work, provide URL, DOM/body assertion, screenshot, and video evidence. Include desktop and mobile when the user-facing surface is responsive.

For Lightchain parity work, include a short comparison ledger: Lightchain reference, Heavy Chain rendered behavior, match status, intentional Heavy Chain addition, remaining mismatch.

For generated-image work, provide prompt/job/task IDs when available, downloaded image path or app URL, DB/Storage/readback where applicable, and a visual scorecard for prompt adherence, apparel fidelity, unwanted text/watermark/UI artifacts, composition, and commercial usefulness.

For security/performance/scale/legal work, label confirmed facts, inferences, unresolved human decisions, and blocked checks separately.

## Internal Quality Pass

Required for every child goal. Review against the latest user intent: Heavy Chain should feel like Lightchain first, with extra Heavy Chain features only where they fit naturally, and should be credible for mass-market apparel workflows.

## Codex Review / Review Pass

Run Codex read-only review before terminal reporting when code/config/runtime artifacts changed. If unavailable, record the fallback. Docs/research-only children may mark review `not_required` with reason.

## Result Delivery

Return exactly one compact block:

```text
[GOAL_LOOP_RESULT]
loop_id: HC-10M-PRODUCT-READINESS-20260626-R2
parent_thread_id: 019ef728-e38a-7d01-988d-451c95668bf5
child_thread_id:
child_thread_name:
goal_id:
status: complete | needs_review | human-needed | blocked | failed
delivery: parent-thread-message | final-response-fallback
result_summary:
changed_files:
  - path:
    summary:
evidence:
  -
validation:
  - command_or_check:
    result: passed | failed | not-run | not_required
    notes:
quality_pass:
  status: passed | revised | needs_human_judgment | not_required
  method: lightchain-comparison | image-inspection | self-review | review-helper | not_required
  notes:
review_pass:
  status: passed | findings_fixed | findings_remaining | not_required | failed
  notes:
execution_and_integration_notes:
  -
open_risks:
  -
human_needed:
  -
next_action:
[/GOAL_LOOP_RESULT]
```
