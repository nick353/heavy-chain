# Security and state boundary

The repository contains code, schemas, tests, and documentation only. Never commit:

- Browser profiles, cookies, storage state, CDP URLs, credentials, tokens, or authority JSON files.
- Real recordings, screenshots, page bodies, manifests, receipts, recovery checkpoints, or operation ledgers.
- Machine-specific paths, usernames, secrets, or provider credentials.

Runtime state is kept under `BROWSER_USE_STATE_ROOT` or the default `~/.browser-use-cli/` with `0700` directories and `0600` JSON/TOML files. The installer is intentionally no-sudo and refuses to silently overwrite a different helper already installed in `~/.local/bin`.
The installer uses a per-user install lock, checks helper conflicts before creating runtime state, writes the runtime config atomically, swaps the helper symlink atomically, and restores the previous config/helper and empty transaction-created directories when post-install verification fails. A forced replacement keeps the previous helper as an explicit timestamped backup.

`scripts/sync-live.sh` is the only supported update path for an already
installed live lane. It first records a bounded observation and marks only
descriptor-backed rooms with positively absent process, listener, and daemon
as `stale`; it refuses to replace the helper while a room is `active`,
`starting`, `held`, or `cleanup_pending`, preventing a mid-run
descriptor/hash split.

The generic package cannot prove business idempotency without a workflow-specific resource key. After an unknown external effect, same-run and cross-run effectful admission remains blocked until the owning workflow performs source-of-truth reconciliation. Navigation readback alone is never business completion proof.

Live recording commands require the current canonical helper's verified path, owner, mode, and digest. A run-pinned helper snapshot is historical evidence, not a current-helper trust bypass. An explicit read-only `record-command --refresh-helper` may adopt a changed canonical helper into a new immutable generation; it invalidates navigation proof and requires fresh same-run readback before further target or effectful work.

Authorized command, recovery, resume, and target lanes can request one bounded
`--auto-renew`. This creates a new 0600 authority generation only when the
existing admission/readback budget is insufficient, preserves the existing
scope and lineage, and never edits the old authority. A target resolver error
before dispatch is recorded as no external effect; once dispatch begins, the
operation remains reconciliation-required until same-run evidence resolves it.

Retained authenticated Temporary profiles are never copied between sessions.
The optional shared-profile lane matches the account and allowed origins from a
fresh authority, proves that the source profile has no live process, listener,
daemon, active room, or lock, then acquires an exclusive owner-bound lease.
The lease stores only hashes and bounded metadata, not cookies, storage state,
passwords, or tokens. Any ambiguity, foreign owner, live resource, marker
change, or expiry is fail-closed. Release retains the profile for the next
authorized claim and never deletes it.
