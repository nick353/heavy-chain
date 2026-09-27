# Heavy Chain parity history contract diagnosis — 2026-09-27 r1

## Result

The focused local command reached 24/25 passing assertions and one failure:

```text
node --experimental-strip-types --test \
  scripts/verify-lightchain-provider-adapter.test.ts \
  scripts/verify-lightchain-persistence-compaction.test.ts \
  scripts/verify-unified-lineage-readback.test.ts \
  scripts/verify-parity-entry-history-readback.test.ts
```

The failing assertion is the `data-testid="oriented-design-persisted-history"` expectation in
`scripts/verify-parity-entry-history-readback.test.ts`.

## Evidence

- `LightchainOrientedDesignPage` in `src/pages/LightchainParityPages.tsx` currently renders the
  source-matched project grid and reference cases. It does not render a persisted-history panel,
  does not call `listWorkspaceArtifacts` in that component, and contains no
  `data-testid="oriented-design-persisted-history"`.
- The test was introduced in commit `525e806` and still asserts the older persisted-history
  surface.
- Commit `53a74f6` intentionally replaced the earlier history-panel implementation with the
  source-matched oriented-design project/reference UI. The same commit removed the testid and the
  component-local history loading. This establishes a source/test contract drift rather than a
  random missing attribute.
- The current source-parity checks require the oriented-design project grid, reference cases, and
  detail upload surface; they do not currently require a history panel for this entry.

## Interpretation

The failure must not be fixed by blindly restoring the old panel. Doing so could regress the
source-parity surface and would mix two competing contracts. The bounded decision required from
the next Astra engineering capacity is:

1. Keep the source-matched oriented-design entry as canonical and update/retire the stale history
   assertion, while preserving persisted history on Creator, Fitting, and Design Production; or
2. Reintroduce a clearly non-disruptive history affordance whose placement and behavior are
   explicitly accepted against the current source parity, then retain a revised test.

No provider call, remote write, auth change, entitlement change, billing action, publication, or
destructive operation was performed for this diagnosis.

## Reopen condition

When the held `heavy-cross-surface-astra-engineering` package can be claimed, root should pass this
diagnosis plus the exact current source/test excerpts to Astra. Any mutation must be limited to the
approved contract decision, followed by the focused parity/history suite and the normal typecheck
and build. Until then, keep the worktree clean and treat the single failing assertion as an open
local contract blocker.
