# Browser Use CLI Portable Package

This directory is the portable distribution boundary for the hardened Browser Use CLI lane.
It preserves the canonical helper entrypoint, run-bound profiles and ports, same-run navigation/readback proof, unknown-effect reconciliation gates, recording lifecycle, and cleanup receipts.

## Install on another macOS computer

Install the pinned Browser Use package and local tools first:

```bash
python3 -m pip install --user "browser-use==0.13.7" "imageio[ffmpeg]" numpy Pillow
```

Install Google Chrome and ffmpeg, then run:

```bash
./scripts/install.sh
./scripts/doctor.sh
```

The installer creates `~/.browser-use-cli/` with mode `0700`, writes a machine-local runtime config with mode `0600`, and installs `~/.local/bin/codex-browser-use` as an owner/mode-verified regular file. The official Automation Kernel rejects symlinks at this trust boundary. It never copies profiles, cookies, authority files, recordings, receipts, or tokens from another computer.

The repository's live adapters import this package directly. After pulling a
new version, run `./scripts/sync-live.sh` at a terminal lifecycle boundary;
it first marks only descriptor-backed rooms with a positively absent process,
listener, and daemon as `stale`, refuses to replace the helper while any room
is still active, then installs and verifies helper/source parity atomically.

To let the installer install the Python package itself, use the explicit opt-in:

```bash
BROWSER_USE_INSTALL_DEPS=1 ./scripts/install.sh
```

## Local verification

```bash
npm test
./scripts/clean-room.sh
./scripts/installer-smoke.sh
./scripts/publication-scan.sh
```

The clean-room check uses a temporary state root. It does not open a browser, submit a form, upload, download, or reuse an existing profile or recording.
The installer smoke test uses a temporary HOME, checks that a different existing helper is rejected before config creation, and verifies an idempotent second install.

## Operating contract

The cross-session lifecycle, login continuation, recording, proof-layer, and
rollback vocabulary is defined in
[`docs/browser-use-lifecycle-continuation-contract.md`](../docs/browser-use-lifecycle-continuation-contract.md).

- Use `bin/codex-browser-use` as the only entrypoint.
- Use a fresh run/session and the reserved profile/port binding for each flow.
- Treat URL/state/screenshot/readback and business-effect proof as separate evidence layers.
- Do not retry an effectful operation while orphan or unknown ledger state remains.
- `record-recover` is read-only reconciliation; it never clears unknown external effects.
- A stale temporary recording borrowed from a login handoff can be cleaned up
  after the exact Chrome/listener/Harness runtime is proven absent.  Cleanup
  releases only that handoff's locks and room; the shared profile and download
  directory are preserved, and unresolved effects remain `unknown`.
- A successful same-run reconciliation changes the transient
  `readback_pending` marker to `reconciled`, so a resolved operation does not
  remain blocked by stale descriptor metadata.  A `state` command is also used
  as its own post-command readback to avoid a redundant second state probe.
- An authorized Temporary navigation that reaches a login/SSO page enters an
  explicit `authentication_waiting` state instead of creating a new profile or
  room. `record-command` polls the same room for up to 900 seconds using only
  URL/readiness readback; after a successful human login it resumes from the
  readback point without replaying the navigation. If the bounded wait expires,
  `record-auth-wait` resumes the same run. Credentials are never typed or
  persisted, and effectful operations remain reconciliation-gated.
- Every authorized Temporary task writes a private, secret-free task resume
  checkpoint. Read it from a later Codex task with
  `codex-browser-use resume --task-id <stable-task-id>` or
  `--thread-id <source-thread-id>`. This command only locates the last
  descriptor, blocker, next action, and restart point; it never attaches to a
  browser or dispatches a command. A live descriptor may be continued only
  after fresh authority, process, port, profile, and readback checks. If the
  old descriptor was already cleaned up, the locator explicitly requires a new
  authorized handoff for the same task ID and never assumes that cookies or
  login state survived.
- An intentionally retained authenticated Temporary profile can be used by a
  later task through `temporary-share-claim` with a fresh authority for the
  same account and allowed origin. This never copies cookies or credentials:
  it acquires an exclusive owner-bound lease for the existing profile, port,
  and room. Pass the returned lease to `authorized --lifecycle temporary
  --shared-lease` or `record-start --shared-lease`; terminal cleanup releases
  the lease while preserving the profile. Busy, ambiguous, mismatched,
  expired, or live profiles fail closed.
- A retained profile uses `retention_mode=manual` and `expires_at=null` by
  design. Authentication-wait deadline calculation treats that as explicit
  indefinite retention while still requiring fresh authority, lease, and
  same-run readback; it never turns the null value into a valid login claim.
- A cleanup-complete handoff that explicitly retained its Temporary profile
  publishes that profile to the shared inventory only after the exact
  process/listener/lock/room cleanup readback. If an older helper retained the
  profile without publishing it, the owner-bound no-browser-command repair is
  `temporary-share-publish --run-id ... --session ... --task-id ...
  --descriptor ...`; it revalidates the stale descriptor, expiry, effect-free
  state, and idle runtime before creating the availability marker.
- Target resolution failures that occur before click dispatch are recorded as
  `external_effects=none`, so ambiguous labels do not create a false
  external-effect retry loop. A dispatch marker is required before a click can
  be recorded as executed.
- Numeric `record-command click` operations automatically capture a bounded
  same-run pre-dispatch observation. If Browser Harness rejects the fresh
  element before sending input (for example, no visible bounding box), the
  unchanged state/tab/download proof can be reconciled as `none`; ambiguous or
  unclassified failures remain `unknown` and still block replay.
- Authorized `record-command`, `record-recover`, `record-resume`, and target
  operations automatically issue one bounded, append-only authority
  generation when the remaining admission/readback budget is too short
  (`--auto-renew` is the explicit contract marker). The scope, account,
  origins, and lineage are copied; the old authority is never overwritten.
- Reconciliation state is aggregate: any remaining pending operation keeps the
  descriptor in `pending`, even if another operation was already reconciled.
- A canonical-helper hash mismatch stops live commands; do not rely on the run-pinned snapshot as an implicit fallback.
- To adopt a changed helper, use `record-command --refresh-helper` with one explicitly read-only command. It creates a new immutable helper generation, invalidates old navigation proof, and never replays a pending operation; perform a fresh same-run navigation readback before target/effectful work.
- Finalize only at terminal run cleanup after video, manifest, receipt, process, listener, profile, and lock readback.

See [SECURITY.md](SECURITY.md) for state boundaries and publication rules.
