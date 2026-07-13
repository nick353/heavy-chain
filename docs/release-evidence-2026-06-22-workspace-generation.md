# 2026-06-22 Workspace Generation Production Evidence

Status: **PASS** for the approved `/patterns`, `/studio`, `/video`, and `/lab` production source-generation closeout.

## Target

- Production URL: `https://heavy-chain.zeabur.app`
- Supabase project: `ghwjymozrwmcrpjqvbmo`
- Git commit: `ab09ea3a935bb86fede33c213c80ced4742203a0`
- Production Web asset observed after deploy: `assets/index.Cu7MLD8E.js`
- Edge Functions deployed: `generate-image`, `design-gacha`, `model-matrix`

## Live Run Evidence

Primary artifact:

```text
output/playwright/production-workspace-generation-20260622-rerun3/live-workspace-proof.json
```

The run exercised each workspace through the production UI:

- `/patterns` -> save -> `/generate` -> `生成`
- `/studio` -> save -> `/generate` -> `生成`
- `/video` -> save -> `/generate` -> `生成`
- `/lab` -> save -> `/generate` -> `生成`

Screenshots are saved in:

```text
output/playwright/production-workspace-generation-20260622-rerun3/
```

## DB And Storage Readback

Readback artifact:

```text
output/playwright/production-workspace-generation-20260622-rerun3/workspace-db-readback.json
```

Counts:

```text
jobs=4
images=15
usage=4
runs=4
storage=15
```

The live proof and cleanup metadata identify the run, and the DB/Storage
readback is bounded by the approved run start timestamp:

```text
run_id=prod-workspace-20260622T071928Z
since=2026-06-22T07:19:28.863Z
```

## Cleanup Readback

Cleanup artifact:

```text
output/playwright/production-workspace-generation-20260622-rerun3/workspace-cleanup-readback.json
```

Result:

```text
deletedUsers=1
removedStoragePaths=15
remainingProdSmokeUsers=0
remainingStorageRows=0
remainingStorage=[]
storageRemoveErrors=[]
retainedEdgeFunctionRuns=4
```

`edge_function_runs` rows are intentionally retained as release evidence after the temporary production smoke user and storage objects are removed.

## Verification

Parent verification command:

```bash
npm run verify:workspace-readback -- --readback output/playwright/production-workspace-generation-20260622-rerun3/workspace-db-readback.json --cleanup output/playwright/production-workspace-generation-20260622-rerun3/workspace-cleanup-readback.json --expect-release-date 2026-06-22 --expect-environment production --expect-git-commit ab09ea3a935bb86fede33c213c80ced4742203a0
```

Result:

```text
Workspace generation readback verification passed. Secret values were not printed.
```

Target-owned runner cleanup check:

```bash
ps -axo pid,ppid,command | rg 'run-production-workspaces|production-workspace-generation-20260622-rerun3|prod-workspace-20260622T071928' | rg -v 'rg|ps -axo' || true
```

Result: no target-owned production runner process remained. Unrelated ambient Playwright MCP processes were present and were not treated as part of this release run.
