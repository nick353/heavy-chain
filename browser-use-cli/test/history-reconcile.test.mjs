import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("terminal history reconciliation is owner-bound and never infers an effect result", () => {
  const script = String.raw`
import argparse, contextlib, importlib.util, io, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_history_reconcile", SourceFileLoader("codex_browser_use_history_reconcile", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(os.path.realpath(temp))
    recording = base / "recording"
    receipts = base / "receipts"
    profiles = base / "profiles"
    recording.mkdir(mode=0o700)
    receipts.mkdir(mode=0o700)
    profiles.mkdir(mode=0o700)
    config = {
        "roots": {
            "browser_use_home": str(base / "home"),
            "temporary_profiles": str(profiles),
            "receipts": str(receipts),
        },
    }
    descriptor = {
        "schema": h.RECORDING_SCHEMA,
        "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE, "status": "stale",
        "run_id": "history-run", "session": "history-session", "task_id": "history-task",
        "recording_dir": str(recording), "recording_framerate": 6,
        "owned_chrome": False, "room_id": None, "port": 20080,
        "profile": str(profiles / ("a" * 64)), "download_dir": str(base / "downloads"),
        "lock_paths": [], "nonce": "b" * 64, "helper_sha256": "c" * 64,
        "authority_sha256": "d" * 64, "authority_scope": "history-scope",
        "creation_binding": "e" * 64, "automation_id": "manual",
        "target_origins": ["https://example.com"], "account_identity": "account",
        "operations": [], "process": {"root_pid": 999999, "root_start_time": 1.0},
        "operation_ledger_path": str(recording / "operation-ledger.jsonl"),
    }
    operation_id = "f" * 32
    h.append_operation_ledger(descriptor, operation_id=operation_id, phase="intent", command=["target-click"], external_effects="unknown", outcome="dispatch_intent_durable")
    h.append_operation_ledger(descriptor, operation_id=operation_id, phase="outcome", command=["target-click"], external_effects="unknown", outcome="browser_use_target_click_failed")

    evidence_path = recording / "owner-history-evidence.json"
    evidence = {
        "schema": h.HISTORY_RECONCILIATION_SCHEMA,
        "run_id": descriptor["run_id"], "session": descriptor["session"],
        "operation_id": operation_id, "resolution": "none", "external_effects": "none",
        "source_system": "owner_workflow",
        "source_ref_sha256": "1" * 64,
    }
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    evidence_path.chmod(0o600)
    captured = {}
    args = argparse.Namespace(
        run_id=descriptor["run_id"], session=descriptor["session"], task_id=descriptor["task_id"],
        descriptor=str(recording / "descriptor.json"), authority=str(base / "authority.json"),
        operation_id=operation_id, resolution="none", evidence_file=str(evidence_path),
    )
    with patch.object(h, "read_toml", return_value=config), \
         patch.object(h, "validate_installation", return_value={}), \
         patch.object(h, "read_recording_descriptor", return_value=descriptor), \
         patch.object(h, "recording_authority", return_value={"allowed_origins": ["https://example.com"]}), \
         patch.object(h, "_write_recording_descriptor", side_effect=lambda _config, _path, value, replace: captured.update(value)):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            assert h.record_reconcile_operation_history(args) == 0
    result = json.loads(output.getvalue())
    assert result["status"] == "recording_history_reconciliation_completed"
    assert result["resolution"] == "none"
    assert result["pending_reconciliation"] == []
    assert result["fresh_run_admission_allowed"] is True
    assert captured["reconciliation_state"] == "completed"
    assert captured["reconciliations"][-1]["evidence_sha256"] == h.sha256_file(str(evidence_path))

    bad_path = recording / "bad-evidence.json"
    bad = dict(evidence, external_effects="executed")
    bad_path.write_text(json.dumps(bad), encoding="utf-8")
    bad_path.chmod(0o600)
    try:
        h._read_history_reconciliation_evidence(config, descriptor, str(bad_path), operation_id, "none")
    except h.Blocker as exc:
        assert exc.code == "browser_use_history_reconciliation_evidence_effect_mismatch"
    else:
        raise AssertionError("mismatched history evidence was accepted")

    orphan_id = "0" * 32
    h.append_operation_ledger(descriptor, operation_id=orphan_id, phase="intent", command=["open", "https://example.com"], external_effects="none", outcome="dispatch_intent_durable")
    orphan_args = argparse.Namespace(
        run_id=descriptor["run_id"], session=descriptor["session"], task_id=descriptor["task_id"],
        descriptor=str(recording / "descriptor.json"), authority=str(base / "authority.json"),
        operation_id=orphan_id,
    )
    with patch.object(h, "read_toml", return_value=config), \
         patch.object(h, "validate_installation", return_value={}), \
         patch.object(h, "read_recording_descriptor", return_value=descriptor), \
         patch.object(h, "recording_authority", return_value={"allowed_origins": ["https://example.com"]}), \
         patch.object(h, "_write_recording_descriptor", side_effect=lambda _config, _path, value, replace: captured.update(value)):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            assert h.record_reconcile_read_only_orphan(orphan_args) == 0
    orphan_result = json.loads(output.getvalue())
    assert orphan_result["status"] == "recording_read_only_orphan_reconciliation_completed"
    assert orphan_result["pending_reconciliation"] == []
    assert h._cleanup_pending_is_terminal_resource_free(config, {
        "status": "cleanup_pending",
        "cleanup_state": {
            "status": "cleaned", "process_terminated": True,
            "listener_absent": True, "daemon_close": "closed",
            "locks_retained": [],
        },
        "lock_paths": [], "room_id": None,
    }) is True
    assert h._cleanup_pending_is_terminal_resource_free(config, {
        "status": "cleanup_pending",
        "cleanup_state": {"status": "cleaned", "process_terminated": True},
        "lock_paths": [], "room_id": None,
    }) is False

    shared_root = pathlib.Path(config["roots"]["browser_use_home"], h.SHARED_PROFILE_LEASE_ROOT_NAME)
    shared_root.mkdir(mode=0o700, parents=True)
    locks_root = pathlib.Path(config["roots"]["browser_use_home"], "locks")
    locks_root.mkdir(mode=0o700, parents=True)
    config["roots"]["locks"] = str(locks_root)
    profile = (profiles / ("a" * 64)).resolve()
    profile.mkdir(mode=0o700)
    profile_lock = pathlib.Path(h.temporary_profile_lock_path(config, str(profile)))
    port_lock = pathlib.Path(h.temporary_port_lock_path(config, 20080))
    lock_paths = [str(profile_lock), str(port_lock)]
    old_lease_path = shared_root / "old-lease.json"
    current_lease_path = shared_root / "current-lease.json"
    old_lease = {
        "schema": h.SHARED_PROFILE_LEASE_SCHEMA, "state": "released",
        "run_id": "old-run", "session": "old-session", "task_id": "old-task",
        "nonce": "old-nonce", "profile": str(profile), "port": 20080,
        "lock_paths": lock_paths,
    }
    current_lease = {
        "schema": h.SHARED_PROFILE_LEASE_SCHEMA, "state": "claimed",
        "lease_id": "current-lease", "run_id": "new-run", "session": "new-session", "task_id": "new-task",
        "nonce": "new-nonce", "profile": str(profile), "port": 20080,
        "lock_paths": lock_paths, "room_id": "new-room",
    }
    old_lease_path.write_text(json.dumps(old_lease), encoding="utf-8")
    current_lease_path.write_text(json.dumps(current_lease), encoding="utf-8")
    old_lease_path.chmod(0o600)
    current_lease_path.chmod(0o600)
    for lock_path in (profile_lock, port_lock):
        lock_path.write_text(json.dumps({
            "schema": "browser-use-lock.v1", "run_id": "new-run", "nonce": "new-nonce",
            "canonical_profile": str(profile), "port": 20080, "shared_profile_lease_id": "current-lease",
        }), encoding="utf-8")
        lock_path.chmod(0o600)
    transferred_descriptor = {
        "status": "cleanup_pending", "run_id": "old-run", "session": "old-session", "task_id": "old-task",
        "nonce": "old-nonce", "profile": str(profile), "port": 20080,
        "shared_profile_lease_path": str(old_lease_path), "lock_paths": lock_paths,
        "cleanup_state": {"status": "cleaned", "process_terminated": True, "listener_absent": True, "daemon_close": "closed", "locks_retained": []},
        "room_id": "old-room",
    }
    with patch.object(h, "room_registry_lookup", side_effect=lambda _config, room_id: {"room_id": "old-room", "state": "released"} if room_id == "old-room" else {"room_id": "new-room", "state": "active", "profile": str(profile), "port": 20080}):
        assert h._cleanup_pending_is_terminal_resource_free(config, transferred_descriptor) is True
    current_lease["state"] = "released"
    current_lease_path.write_text(json.dumps(current_lease), encoding="utf-8")
    with patch.object(h, "room_registry_lookup", return_value=None):
        assert h._cleanup_pending_is_terminal_resource_free(config, transferred_descriptor) is False

assert h.build_parser().parse_args([
    "record-reconcile-operation-history", "--run-id", "run", "--session", "session",
    "--descriptor", "/tmp/descriptor.json", "--authority", "/tmp/authority.json",
    "--operation-id", "f" * 32, "--resolution", "none", "--evidence-file", "/tmp/evidence.json",
]).action == "record-reconcile-operation-history"
assert h.build_parser().parse_args([
    "record-reconcile-read-only-orphan", "--run-id", "run", "--session", "session",
    "--descriptor", "/tmp/descriptor.json", "--authority", "/tmp/authority.json",
    "--operation-id", "0" * 32,
]).action == "record-reconcile-read-only-orphan"
print("history reconciliation proof ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /history reconciliation proof ok/);
});
