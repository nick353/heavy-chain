import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.BROWSER_USE_HOME = path.join(root, ".portable-test-state");
process.env.BROWSER_USE_RUNTIME_CONFIG = path.join(process.env.BROWSER_USE_HOME, "browser-use-runtime.toml");
process.env.BROWSER_USE_CLI_HELPER = path.join(root, "bin", "codex-browser-use");
const adapter = await import(path.join(root, "lib", "stage-adapter.mjs"));

test("package resolves helper and state paths from the checkout/environment", () => {
  assert.equal(adapter.BROWSER_USE_CLI_HELPER, path.join(root, "bin", "codex-browser-use"));
  assert.equal(adapter.BROWSER_USE_HOME.includes(".codex"), false);
  assert.equal(adapter.BROWSER_USE_HOME, path.join(root, ".portable-test-state"));
  const parity = adapter.browserUseCliHelperSourceParity();
  assert.equal(parity.same_source, true);
  assert.equal(parity.helper_mode, 0o700);
});

test("recording source must be a direct child of the harness recordings root", () => {
  const root = path.join(adapter.BROWSER_USE_HOME, "recordings");
  assert.equal(
    adapter.validateBrowserUseCliRecordingDir(path.join(root, "run-1"), root),
    path.join(root, "run-1"),
  );
  assert.throws(
    () => adapter.validateBrowserUseCliRecordingDir(path.join(root, "run-1", "nested"), root),
    (error) => error?.exact_blocker === "browser_use_recording_dir_not_harness_scoped",
  );
});

test("package does not embed the origin user's absolute paths", () => {
  const source = [
    path.join(root, "bin", "codex-browser-use"),
    path.join(root, "lib", "stage-adapter.mjs"),
    path.join(root, "scripts", "configure.py"),
    path.join(root, "scripts", "doctor.py"),
  ].map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const originPath = ["/", "Users", "/", "nichi", "katana", "ka"].join("");
  const skillPath = [".codex", "skills"].join("/");
  assert.equal(source.includes(originPath), false);
  assert.equal(source.includes(skillPath), false);
});

test("current helper hash mismatch is not satisfied by a run-pinned snapshot", () => {
  const suffix = crypto.randomBytes(8).toString("hex");
  const recordingDir = path.join(adapter.BROWSER_USE_HOME, "recordings", `run-${suffix}`);
  const profile = path.join(adapter.BROWSER_USE_HOME, "profiles", "single-use", `run-${suffix}-${"a".repeat(32)}`);
  const downloadDir = path.join(adapter.BROWSER_USE_HOME, "downloads", `run-${suffix}-${"b".repeat(32)}`);
  const snapshot = path.join(recordingDir, ".helper-generation", "codex-browser-use");
  fs.mkdirSync(path.dirname(snapshot), { recursive: true, mode: 0o700 });
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  fs.mkdirSync(downloadDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(snapshot, "pinned generation\n", { mode: 0o700 });
  const snapshotHash = crypto.createHash("sha256").update(fs.readFileSync(snapshot)).digest("hex");
  const descriptor = {
    mode: "public",
    lifecycle: "single-use",
    automation_id: "portable-test",
    run_id: `run-${suffix}`,
    stage_id: "stage-1",
    session: "session-test",
    requested_session: "session-test",
    effective_session: "session-test",
    status: "active",
    nonce: "a".repeat(32),
    helper_sha256: snapshotHash,
    helper_snapshot_path: snapshot,
    recording_dir: recordingDir,
    status_path: path.join(recordingDir, ".recording-status.json"),
    profile,
    download_dir: downloadDir,
    port: 19980,
    lock_paths: [
      path.join(adapter.BROWSER_USE_HOME, "locks", `profile-${crypto.createHash("sha256").update(profile).digest("hex").slice(0, 24)}.lock`),
      path.join(adapter.BROWSER_USE_HOME, "locks", "port-19980.lock"),
    ],
    process: { root_pid: process.pid, root_start_time: 1, owner_uid: process.getuid?.() ?? 0, cmdline_digest: "c".repeat(64) },
    loopback_listener: { host: "127.0.0.1", port: 19980, verified: true },
    recording: { active: true, recording_dir: recordingDir, status_path: path.join(recordingDir, ".recording-status.json") },
    allowed_origins: ["https://example.com"],
    authority_digest: "public_manifest_only",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  try {
    assert.throws(
      () => adapter.parseBrowserUseCliStartDescriptor(descriptor, {
        automationId: descriptor.automation_id,
        runId: descriptor.run_id,
        stageId: descriptor.stage_id,
        requestedSession: descriptor.requested_session,
        effectiveSession: descriptor.effective_session,
        port: descriptor.port,
        authorityDigest: descriptor.authority_digest,
        helperSha256: "f".repeat(64),
        requireHelperHash: true,
        expiresAt: descriptor.expires_at,
      }),
      (error) => error?.exact_blocker === "browser_use_cli_helper_hash_mismatch",
    );
  } finally {
    fs.rmSync(recordingDir, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
});
