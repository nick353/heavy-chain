# CHILD_CONTRACT.md

Loop-wide contract for every Heavy Chain product-excellence child thread.

## Ownership

Own exactly one assigned goal packet. Do not change parent `GOAL.md`, unrelated child packets, or unrelated code. You are not alone in the codebase; do not revert other edits. Adapt to current files.

Follow repository instructions first. If this contract conflicts with repository policy, stop and report the conflict.

## Boundaries

Allowed: inspect files, implement in assigned scope, run local checks, create evidence artifacts under `output/playwright/lightchain-product-excellence-20260626/`, update assigned docs if the packet allows it.

Not allowed without parent approval: commit, push, deploy, change secrets, change billing/payment/checkout/identity flows, destructive cleanup outside marker-scoped test artifacts.

## Validation

Run the checks appropriate to your changes. For code changes, at minimum run targeted static checks and report whether `npm run typecheck`, `npm run lint -- --max-warnings=0`, or `npm run build` were run or why not.

For UI/UX work, provide screenshot/DOM/video evidence. For subjective UX claims, include a short quality pass against Lightchain-like criteria.

## Result Delivery

Return exactly one compact block:

```text
[GOAL_LOOP_RESULT]
loop_id: HC-LIGHTCHAIN-20260626
parent_thread_id: 019ef728-e38a-7d01-988d-451c95668bf5
child_thread_id:
child_thread_name:
goal_id:
status: complete | needs_review | human-needed | blocked | failed
delivery: final-response-fallback
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
  method: self-review | not_required
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

