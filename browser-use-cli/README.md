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

The installer creates `~/.browser-use-cli/` with mode `0700`, writes a machine-local runtime config with mode `0600`, and installs a symlink at `~/.local/bin/codex-browser-use`. It never copies profiles, cookies, authority files, recordings, receipts, or tokens from another computer.

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

- Use `bin/codex-browser-use` as the only entrypoint.
- Use a fresh run/session and the reserved profile/port binding for each flow.
- Treat URL/state/screenshot/readback and business-effect proof as separate evidence layers.
- Do not retry an effectful operation while orphan or unknown ledger state remains.
- `record-recover` is read-only reconciliation; it never clears unknown external effects.
- Finalize only at terminal run cleanup after video, manifest, receipt, process, listener, profile, and lock readback.

See [SECURITY.md](SECURITY.md) for state boundaries and publication rules.
