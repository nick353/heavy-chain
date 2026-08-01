import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helpers = [path.join(root, "bin", "codex-browser-use")];
const installedHelper = process.env.CODEX_BROWSER_USE_INSTALLED_HELPER
  || path.join(process.env.HOME || "", ".local", "bin", "codex-browser-use");
if (existsSync(installedHelper) && path.resolve(installedHelper) !== path.resolve(helpers[0])) {
  helpers.push(installedHelper);
}

test("stale temporary recording recovery is bounded, owned, and effect-safe", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use", SourceFileLoader("codex_browser_use", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def write_json(path, value):
    pathlib.Path(path).write_text(json.dumps(value), encoding="utf-8")
    os.chmod(path, 0o600)

def fixture(root):
    root = os.path.realpath(root)
    roots = {name: os.path.join(root, name) for name in ("locks", "temporary_profiles", "browser_use_home", "recordings")}
    for value in roots.values():
        os.makedirs(value, mode=0o700)
    config = {"roots": roots, "ports": {"temporary_start": 20080, "temporary_end": 20099}}
    profile = os.path.realpath(os.path.join(roots["temporary_profiles"], "a" * 64))
    os.makedirs(profile, mode=0o700)
    recording_dir = os.path.join(roots["recordings"], "run-1")
    os.makedirs(recording_dir, mode=0o700)
    status_path = os.path.join(recording_dir, ".recording-status.json")
    write_json(status_path, {"schema": h.RECORDING_STATUS_SCHEMA, "recorder_configured": True, "recorder_active": True, "finalized": False, "recording_dir": recording_dir})
    descriptor_path = os.path.join(recording_dir, "session-nonce.json")
    descriptor = {
        "schema": h.RECORDING_SCHEMA, "status": "active", "mode": "authorized", "lifecycle": "temporary",
        "run_id": "run-1", "session": "session-1", "automation_id": "manual", "task_id": "task-1", "nonce": "nonce-1",
        "profile": profile, "port": 20080, "recording_dir": recording_dir, "status_path": status_path,
        "lock_paths": [h.temporary_profile_lock_path(config, profile), h.temporary_port_lock_path(config, 20080)],
        "owned_chrome": True, "process": {"root_pid": 999999, "root_start_time": 1.0}, "room_id": "room-task",
    }
    write_json(descriptor_path, descriptor)
    payload = {"schema": "browser-use-lock.v1", "run_id": "run-1", "nonce": "nonce-1", "canonical_profile": profile, "port": 20080}
    for lock_path in descriptor["lock_paths"]:
        write_json(lock_path, payload)
    return config, descriptor, descriptor_path, profile

with tempfile.TemporaryDirectory() as temp:
    config, descriptor, descriptor_path, profile = fixture(temp)
    room = {"room_id": "room-task", "state": "active"}
    with patch.object(h, "room_registry_lookup", return_value=room), patch.object(h, "room_registry_update") as room_update, patch.object(h, "close_orphan_operation_intents", return_value=["unknown-op"]), patch.object(h, "pending_operation_reconciliation_ids", return_value=["unknown-op"]), patch.object(h, "write_recovery_checkpoint", return_value=os.path.join(descriptor["recording_dir"], "recovery-checkpoint.json")):
        result = h.reconcile_stale_recording_runtime(config, descriptor, descriptor_path, max_attempts=2)
    assert result["recovery_state"] == "restartable"
    assert result["recording_status"] == "abandoned"
    assert result["effectful_resume_allowed"] is False
    assert room_update.call_args.kwargs["state"] == "held"
    assert all(not os.path.exists(p) for p in descriptor["lock_paths"])
    status = json.loads(pathlib.Path(descriptor["status_path"]).read_text())
    assert status["recorder_active"] is False and status["finalized"] is False and status["durable_state"] == "abandoned"

    with patch.object(h, "room_registry_lookup", return_value={"room_id": "room-task", "state": "held"}), patch.object(h, "pending_operation_reconciliation_ids", return_value=["unknown-op"]):
        again = h.reconcile_stale_recording_runtime(config, descriptor, descriptor_path, max_attempts=2)
    assert again["idempotent"] is True
    assert again["effectful_resume_allowed"] is False

    config2, descriptor2, descriptor_path2, _ = fixture(os.path.join(temp, "foreign"))
    foreign = descriptor2["lock_paths"][1]
    write_json(foreign, {"schema": "browser-use-lock.v1", "run_id": "other-run", "nonce": "other-nonce", "canonical_profile": descriptor2["profile"], "port": descriptor2["port"]})
    try:
        with patch.object(h, "room_registry_lookup", return_value={"room_id": "room-task", "state": "active"}), patch.object(h, "room_registry_update"):
            h.reconcile_stale_recording_runtime(config2, descriptor2, descriptor_path2, max_attempts=2)
        raise AssertionError("foreign lock was accepted")
    except h.Blocker as exc:
        assert exc.code == "browser_use_recording_recovery_foreign_lock"
    assert os.path.exists(descriptor2["lock_paths"][0]) and os.path.exists(foreign)

    descriptor3 = dict(descriptor2, recovery_retry_count=2, recovery_max_attempts=2)
    with patch.object(h, "room_registry_lookup", return_value={"room_id": "room-task", "state": "active"}):
        try:
            h.reconcile_stale_recording_runtime(config2, descriptor3, descriptor_path2, max_attempts=2)
            raise AssertionError("retry bound was ignored")
        except h.Blocker as exc:
            assert exc.code == "browser_use_recording_recovery_attempt_limit"

    with patch.object(h, "validate_handoff_process_identity", return_value=True):
        assert h._recording_runtime_is_stale(config2, descriptor2) is False
    with patch.object(h, "validate_handoff_process_identity", return_value=False):
        assert h._recording_runtime_is_stale(config2, descriptor2) is True
    listener_calls = []
    with patch.object(h, "port_listener", side_effect=lambda port: listener_calls.append(("socket", port)) or False), patch.object(h, "lsof_listener", side_effect=lambda port: listener_calls.append(("lsof", port)) or False):
        h.assert_debug_listener_absent(20080)
    assert listener_calls == [("socket", 20080), ("lsof", 20080)]

    stale_descriptor_path = os.path.join(config2["roots"]["recordings"], "prior", "stale.json")
    os.makedirs(os.path.dirname(stale_descriptor_path), mode=0o700)
    write_json(stale_descriptor_path, {"schema": h.RECORDING_SCHEMA, "status": "stale", "run_id": "prior-run", "session": "prior-session", "status_path": descriptor2["status_path"], "process": descriptor2["process"], "owned_chrome": True, "profile": descriptor2["profile"], "lock_paths": descriptor2["lock_paths"], "automation_id": "manual", "account_identity": "acct"})
    with patch.object(h, "_operation_ledger_reconciliation", return_value=[{"operation_id": "unknown-op", "reason": "unknown_external_effect", "external_effects": "unknown"}]):
        try:
            h.require_cross_run_reconciliation_clear(config2, run_id="fresh-run", automation_id="manual", account_identity="acct")
            raise AssertionError("stale unknown effect was skipped")
        except h.Blocker as exc:
            assert exc.code == "browser_use_external_effect_reconciliation_required"

    ledger_dir = os.path.realpath(os.path.join(temp, "reconciliation-ledger"))
    os.makedirs(ledger_dir, mode=0o700)
    ledger_descriptor = {"run_id": "ledger-run", "session": "session-1", "recording_dir": ledger_dir, "operation_ledger_path": os.path.join(ledger_dir, "operation-ledger.jsonl"), "failed_operations": []}
    operation_id = "a" * 32
    h.append_operation_ledger(ledger_descriptor, operation_id=operation_id, phase="intent", command=["target-click"], external_effects="unknown", outcome="dispatch_intent_durable")
    h.append_operation_ledger(ledger_descriptor, operation_id=operation_id, phase="outcome", command=["target-click"], external_effects="unknown", outcome="browser_use_target_click_failed")
    assert h.pending_operation_reconciliation_ids(ledger_descriptor) == [operation_id]
    h.append_operation_reconciliation_durable(ledger_descriptor, operation_id=operation_id, external_effects="none", outcome="target_rejected_noninteractive_before_dispatch")
    assert h.pending_operation_reconciliation_ids(ledger_descriptor) == []
    assert h.operation_effect_summary(ledger_descriptor) == "none"

    failed_dir = os.path.realpath(os.path.join(temp, "failed-only"))
    failed_only = {"run_id": "failed-run", "session": "session-1", "recording_dir": failed_dir, "operation_ledger_path": os.path.join(failed_dir, "operation-ledger.jsonl"), "failed_operations": [{"external_action_possible": True, "exact_blocker": "browser_use_target_click_failed"}], "reconciliations": [{"operation_ids": ["failed-operation"], "resolution": "none"}]}
    os.makedirs(failed_only["recording_dir"], mode=0o700)
    assert h.pending_operation_reconciliation_ids(failed_only) == []
print("ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /ok/);
  }
});
