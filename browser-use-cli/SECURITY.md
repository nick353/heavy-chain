# Security and state boundary

The repository contains code, schemas, tests, and documentation only. Never commit:

- Browser profiles, cookies, storage state, CDP URLs, credentials, tokens, or authority JSON files.
- Real recordings, screenshots, page bodies, manifests, receipts, recovery checkpoints, or operation ledgers.
- Machine-specific paths, usernames, secrets, or provider credentials.

Runtime state is kept under `BROWSER_USE_STATE_ROOT` or the default `~/.browser-use-cli/` with `0700` directories and `0600` JSON/TOML files. The installer is intentionally no-sudo and refuses to silently overwrite a different helper already installed in `~/.local/bin`.
The installer uses a per-user install lock, checks helper conflicts before creating runtime state, writes the runtime config atomically, swaps the helper symlink atomically, and restores the previous config/helper and empty transaction-created directories when post-install verification fails. A forced replacement keeps the previous helper as an explicit timestamped backup.

The generic package cannot prove business idempotency without a workflow-specific resource key. After an unknown external effect, same-run and cross-run effectful admission remains blocked until the owning workflow performs source-of-truth reconciliation. Navigation readback alone is never business completion proof.
