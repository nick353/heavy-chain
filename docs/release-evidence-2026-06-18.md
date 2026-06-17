# Release Evidence 2026-06-18

Status: **not release-ready**.

This file records what is known for the 2026-06-18 release gate. It is an
evidence ledger, not approval to release.

## Start State

Before these doc edits, `npm run release:doctor --silent` reported `git clean`
as OK.

## Doctor Target Check

Before this file was added, the latest release evidence file was
`docs/release-evidence-2026-06-17.md`, so the default doctor target remained
`release_date=2026-06-17`.

Before the release doctor was hardened to require
`RELEASE_BROWSER_USE_PROOF_DIR`, the 2026-06-18 target was checked with an
explicit override:

```bash
RELEASE_DATE=2026-06-18 npm run release:doctor --silent
```

Result: stopped at `env:check`.

Passed before the stop:

```text
OK git clean
OK proof target
```

Stopped check:

```text
STOP env:check
```

Safe output tail reported 2/8 required keys present and these missing required
environment names:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PUBLIC_URL
```

No secret values are recorded here.

## Missing Proof

- Current staging readback is incomplete.
- Generated image `image_url` null/missing/empty readback is incomplete.
- Current Browser Use proof is incomplete until
  `RELEASE_BROWSER_USE_PROOF_DIR` points at a recaptured env-injected proof
  directory whose `home-env-eval.json` and `login-eval.json` include matching
  `metadata.release_date`, `metadata.environment`, `metadata.git_commit`, and a
  valid `metadata.captured_at`.
- Current readback metadata proof for 2026-06-18 is incomplete. Without
  `RELEASE_BROWSER_USE_PROOF_DIR`, doctor stops at `proof target`; after that
  directory is set, the current environment still stops at `env:check`, so
  `verify:readback:current` is not reached.

After the release doctor was hardened to require a current Browser Use proof
directory, running it in a clean worktree without
`RELEASE_BROWSER_USE_PROOF_DIR` stops at `proof target` before `env:check`.
The historical Browser Use proof remains useful as supporting view-only shape
evidence, but it fails current metadata expectations and must not be treated as
2026-06-18 current proof.

## Stop Boundary

Stop before any step that requires sending, submitting, publishing, deleting,
authentication, payment, personal information entry, deploy, or DB mutation.
