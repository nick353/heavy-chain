import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helpers = [path.join(root, "bin", "codex-browser-use")];

test("state is its own successful readback in the normal recording command path", () => {
  const script = String.raw`
import importlib.util
from importlib.machinery import SourceFileLoader
from types import SimpleNamespace
from unittest.mock import patch

helper_path = __import__("os").environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_state_readback", SourceFileLoader("codex_browser_use_state_readback", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

calls = []
def run(*args, **kwargs):
    calls.append((args, kwargs))
    return SimpleNamespace(returncode=0, stdout="", stderr="")

config = {"executables": {"browser_use": {"canonical_path": "/bin/true"}}, "roots": {"browser_use_home": "/tmp/browser-use-home"}}
with patch.object(h, "browser_harness_cli_enabled", return_value=True), patch.object(h.subprocess, "run", side_effect=run):
    code, readback_exit = h.run_cli3_session(config, "/tmp/browser-use-home", 19980, "session-1", ["state"], True, close_after=False)
assert (code, readback_exit) == (0, 0)
assert len(calls) == 1
print("state readback ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /state readback ok/);
  }
});

test("video render pads odd headed surfaces before libx264", () => {
  const script = String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_render_command", SourceFileLoader("codex_browser_use_render_command", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

command = h.recording_video_render_command("/ffmpeg", 12, "/tmp/[0-9]*.jpg", "/tmp/browser-recording.mp4")
vf_index = command.index("-vf")
assert command[vf_index + 1] == "pad=ceil(iw/2)*2:ceil(ih/2)*2"
assert command[command.index("-c:v") + 1] == "libx264"
assert command[-1] == "/tmp/browser-recording.mp4"
print("odd-dimension render command ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /odd-dimension render command ok/);
  }
});

test("video finalization failures persist blocked state and preserve source handoff ownership", () => {
  const script = String.raw`
import importlib.util, os, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_media_failure", SourceFileLoader("codex_browser_use_media_failure", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    descriptor = {
        "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": "run-1", "session": "session-1", "requested_session": "session-1",
        "automation_id": "manual", "task_id": "task-1", "nonce": "nonce-1",
        "started_at": "2026-01-01T00:00:00Z", "lock_paths": [],
        "process": {"root_pid": 1}, "port": 20080,
        "profile": os.path.join(temp, "profile"), "download_dir": os.path.join(temp, "downloads"),
        "recording_dir": temp, "status_path": os.path.join(temp, "recording-status.json"), "recording_framerate": 12,
        "owned_chrome": False, "status": "continued",
    }
    config = {"roots": {"receipts": os.path.join(temp, "receipts"), "browser_use_home": os.path.join(temp, "browser-home")}}
    status_calls = []
    recording_status = {"recording_source_dir": temp, "status_path": os.path.join(temp, "recording-status.json")}
    with patch.object(h, "browser_harness_cli_enabled", return_value=True), \
         patch.object(h, "close_owned_daemon_if_active", return_value=(True, None)), \
         patch.object(h, "recording_env", return_value=recording_status), \
         patch.object(h, "write_harness_recording_status", side_effect=lambda path, recording, *, active, finalized: status_calls.append((active, finalized))), \
         patch.object(h, "_write_recording_descriptor"), \
         patch.object(h, "finalized_receipt", return_value=os.path.join(temp, "blocked-receipt.json")):
        receipt, blocker = h._recording_finalize_cleanup_after_media_failure(
            config, {"helper": "versions"}, descriptor, os.path.join(temp, "descriptor.json"),
            "browser_use_recording_video_render_failed", failure_phase="video_finalize",
        )
    assert receipt.endswith("blocked-receipt.json")
    assert blocker == "browser_use_recording_video_render_failed"
    assert descriptor["status"] == "cleanup_pending"
    assert descriptor["finalize_failure"] == "browser_use_recording_video_render_failed"
    assert descriptor["cleanup_state"]["status"] == "source_handoff_preserved"
    assert descriptor["cleanup_state"]["video_finalize"] == "failed"
    assert status_calls == [(False, False)]
print("video failure cleanup proof ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /video failure cleanup proof ok/);
  }
});

test("temporary profile deletion requires explicit approval", () => {
  const script = String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_delete_gate", SourceFileLoader("codex_browser_use_delete_gate", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

descriptor = {"lifecycle": h.TEMPORARY_LIFECYCLE, "status": "active"}
for kwargs, expected in (
    ({}, "browser_use_temporary_delete_approval_required"),
    ({"cleanup_only": True}, "browser_use_temporary_cleanup_only_requires_terminal_state"),
):
    try:
        h.require_temporary_delete_approval(descriptor, **kwargs)
        raise AssertionError("unapproved deletion was accepted")
    except h.Blocker as exc:
        assert exc.code == expected
h.require_temporary_delete_approval(descriptor, delete_approved=True)
print("temporary deletion gate ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /temporary deletion gate ok/);
  }
});

test("room release is owner-bound even for excluded 20088 and 20089 ports", () => {
  const script = String.raw`
import importlib.util, os, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_room_owner", SourceFileLoader("codex_browser_use_room_owner", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    root = os.path.realpath(temp)
    roots = {name: os.path.join(root, name) for name in ("browser_use_home", "scheduled_profiles", "single_use_profiles", "temporary_profiles")}
    for value in roots.values():
        os.makedirs(value, mode=0o700)
    config = {"roots": roots, "ports": {"temporary_start": 20080, "temporary_end": 20099, "scheduled_start": 20100, "scheduled_end": 20109, "single_use_start": 20110, "single_use_end": 20119}}
    first = h.room_registry_claim(config, lifecycle=h.TEMPORARY_LIFECYCLE, run_id="run-a", task_id="owner-a", port=20088)
    second = h.room_registry_claim(config, lifecycle=h.TEMPORARY_LIFECYCLE, run_id="run-b", task_id="owner-b", port=20089)
    assert {first["port"], second["port"]} == {20088, 20089}
    try:
        h.room_registry_release(config, first["room_id"], run_id="run-b", activity="foreign-cleanup")
        raise AssertionError("foreign owner released another room")
    except h.Blocker as exc:
        assert exc.code == "browser_use_room_registry_owner_conflict"
    listed = {item["room_id"]: item for item in h.room_registry_list(config)}
    assert listed[first["room_id"]]["state"] == "active"
    assert listed[second["room_id"]]["state"] == "active"
print("room owner exclusion proof ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /room owner exclusion proof ok/);
  }
});

test("durable semantic readback strips canary secrets and query strings", () => {
  const script = String.raw`
import importlib.util, json, os
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_canary_redaction", SourceFileLoader("codex_browser_use_canary_redaction", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

canary = "CANARY_SECRET_DO_NOT_PERSIST"
stored = h.safe_semantic_readback_for_storage({
    "schema": "browser_use_semantic_readback.v1", "kind": "state",
    "state": {"url": "https://example.com/?token=" + canary, "state": canary, "input_value": canary, "origin": "https://example.com"},
    "state_sha256": "a" * 64,
})
assert canary not in json.dumps(stored, ensure_ascii=False)
assert stored["state"]["url_length"] > 0 and len(stored["state"]["url_sha256"]) == 64
print("semantic canary redaction ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /semantic canary redaction ok/);
  }
});

test("no-dispatch click reconciliation requires a bound immutable proof receipt", () => {
  const script = String.raw`
import importlib.util, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_no_dispatch", SourceFileLoader("codex_browser_use_no_dispatch", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    recording_dir = os.path.realpath(temp)
    descriptor = {
        "run_id": "run-1", "session": "session-1", "nonce": "nonce-1",
        "profile": os.path.join(recording_dir, "profile"), "port": 20080,
        "authority_sha256": "a" * 64, "recording_dir": recording_dir,
    }
    descriptor["operation_lineage_digest"] = h.operation_lineage_digest(descriptor)
    operation_id = "b" * 32
    command = ["click", "5"]
    fingerprint = h._no_dispatch_command_fingerprint(command)
    observation = {
        "state_sha256": "c" * 64, "state_length": 10,
        "tab_inventory": {"sha256": "d" * 64, "tab_count": 1},
        "downloads": {"exists": True, "entries": 0, "sha256": "e" * 64},
        "readback_exit": 0, "observed_at": "2026-01-01T00:00:00Z",
    }
    receipt = {
        "schema": h.NO_DISPATCH_RECEIPT_SCHEMA,
        "status": "ready_for_reconciliation", "run_id": descriptor["run_id"], "session": descriptor["session"],
        "operation_id": operation_id, "recovery_operation_id": "f" * 32,
        "last_recovery_trigger_operation_id": operation_id, "recovery_status": "verified",
        "authority_sha256": descriptor["authority_sha256"],
        "operation_lineage_digest": descriptor["operation_lineage_digest"],
        "descriptor_binding_sha256": h._no_dispatch_binding_digest(descriptor, operation_id, fingerprint),
        "command_name": "click", "command": command, "target_fingerprint": fingerprint,
        "failure_marker": "runtime_error_browser_use_recording_working_tab_missing",
        "dispatch_phase": "not_started", "dispatch_exit": 1, "readback_exit": 0,
        "pre_observation": observation, "post_observation": dict(observation),
        "effect_observation": {"state_unchanged": True, "tab_inventory_unchanged": True, "downloads_unchanged": True, "network_dispatch_started": False},
    }
    h._validate_no_dispatch_receipt(descriptor, operation_id, receipt)
    receipt["post_observation"] = dict(observation, state_sha256="1" * 64)
    try:
        h._validate_no_dispatch_receipt(descriptor, operation_id, receipt)
        raise AssertionError("changed observation was accepted")
    except h.Blocker as exc:
        assert exc.code == "browser_use_no_dispatch_receipt_observation_changed"
    print("no-dispatch receipt proof ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /no-dispatch receipt proof ok/);
  }
});

test("stale temporary recording recovery is bounded, owned, and effect-safe", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use", SourceFileLoader("codex_browser_use", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

source_text = pathlib.Path(helper_path).read_text(encoding="utf-8")
assert 'descriptor["owner_metadata"] = owner_metadata' in source_text
assert source_text.index("recording_dir = validate_recording_output_dir(args.recording_dir)") < source_text.index("owner_metadata = validate_record_start_owner_metadata(args, binding=binding)")
assert "and not args.handoff_descriptor" in source_text

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

    different_origin = json.loads(pathlib.Path(stale_descriptor_path).read_text())
    different_origin["target_origins"] = ["https://automation-os.zeabur.app"]
    write_json(stale_descriptor_path, different_origin)
    with patch.object(h, "_operation_ledger_reconciliation", side_effect=AssertionError("different origin must not be blocked")):
        h.require_cross_run_reconciliation_clear(
            config2,
            run_id="fresh-run",
            automation_id="manual",
            account_identity="acct",
            target_origins=["https://jp.linkaigc.com"],
        )

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

test("dead Chrome recovery gracefully closes only the session-bound Harness daemon", () => {
  const script = String.raw`
import importlib.util, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_stale_daemon", SourceFileLoader("codex_browser_use_stale_daemon", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    session = "stale-daemon-" + pathlib.Path(temp).name
    runtime = pathlib.Path(h.browser_harness_root(session)) / "runtime"
    runtime.mkdir(parents=True, mode=0o700)
    for name in ("bu.pid", "bu.sock", "bu.port"):
        (runtime / name).write_text("owned\n", encoding="utf-8")
    config = {"roots": {"browser_use_home": os.path.join(temp, "browser-home")}}
    descriptor = {
        "owned_chrome": True,
        "session": session,
        "port": 29991,
        "profile": os.path.join(temp, "profile"),
        "process": {"root_pid": 999999, "root_start_time": 1.0},
    }
    calls = []
    def close(config_arg, home, port, session_arg):
        calls.append((home, port, session_arg))
        assert session_arg == session
        assert port == 29991
        for path in runtime.iterdir():
            path.unlink()
        return True, None

    with patch.object(h, "validate_handoff_process_identity", return_value=False), \
         patch.object(h, "close_owned_daemon_if_active", side_effect=close):
        assert h._recording_runtime_is_stale(config, descriptor) is True
    assert calls == [(config["roots"]["browser_use_home"], 29991, session)]
    assert not any(runtime.iterdir())
    runtime.rmdir()
    pathlib.Path(h.browser_harness_root(session)).rmdir()
print("session-bound stale daemon close ok")
`;
  const helper = path.join(root, "bin", "codex-browser-use");
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /session-bound stale daemon close ok/);
});

test("explicit dead-Chrome cleanup lane rebinds an old helper generation without browser dispatch", () => {
  const script = String.raw`
import importlib.util, io, json, os, tempfile
from contextlib import redirect_stdout
from importlib.machinery import SourceFileLoader
from types import SimpleNamespace
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_cleanup_daemon", SourceFileLoader("codex_browser_use_cleanup_daemon", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

parser = h.build_parser()
parsed = parser.parse_args([
    "record-cleanup-daemon", "--run-id", "run-1", "--session", "session-1",
    "--task-id", "task-1", "--descriptor", "/tmp/descriptor.json",
    "--authority", "/tmp/authority.json", "--delete-approved",
])
assert parsed.action == "record-cleanup-daemon"

descriptor = {
    "lifecycle": h.TEMPORARY_LIFECYCLE, "owned_chrome": True,
    "run_id": "run-1", "session": "session-1", "task_id": "task-1", "nonce": "nonce-1",
    "process": {"root_pid": 999999, "root_start_time": 1.0}, "port": 20080,
    "profile": "/tmp/profile", "lock_paths": ["/tmp/profile.lock", "/tmp/port.lock"],
    "status": "continued",
}
config = {"roots": {"browser_use_home": "/tmp/browser-home"}}
args = SimpleNamespace(
    run_id="run-1", session="session-1", task_id="task-1", descriptor="/tmp/descriptor.json",
    authority="/tmp/authority.json", delete_approved=True,
)
cleanup = {"cleanup_receipt": "/tmp/cleanup.json", "cleanup": {"daemon_absent": True}, "pending_reconciliation": ["unknown-op"], "external_effects": "unknown"}
close_calls = []
with patch.object(h, "read_toml", return_value=config), \
     patch.object(h, "validate_installation", return_value={"helper": "v"}), \
     patch.object(h, "canonical_session_id", return_value="session-1"), \
     patch.object(h, "read_recording_descriptor", return_value=descriptor), \
     patch.object(h, "require_temporary_task_id"), \
     patch.object(h, "recording_authority"), \
     patch.object(h, "assert_owned_locks"), \
     patch.object(h, "validate_handoff_process_identity", return_value=False), \
     patch.object(h, "assert_debug_listener_absent"), \
     patch.object(h, "_close_stale_recording_daemon_if_present", side_effect=lambda *a: close_calls.append(True)), \
     patch.object(h, "_write_recording_descriptor"), \
     patch.object(h, "cleanup_stale_recording_descriptor", return_value=cleanup):
    output = io.StringIO()
    with redirect_stdout(output):
        code = h.record_cleanup_daemon(args)
assert code == 0
assert close_calls == [True]
assert json.loads(output.getvalue())["pending_reconciliation"] == ["unknown-op"]
print("explicit dead-Chrome cleanup lane ok")
`;
  const helper = path.join(root, "bin", "codex-browser-use");
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /explicit dead-Chrome cleanup lane ok/);
});

test("stale recording terminal cleanup is recording-scoped, idempotent, and preserves unknown effects", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_stale_cleanup", SourceFileLoader("codex_browser_use_stale_cleanup", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def write_json(path, value):
    pathlib.Path(path).write_text(json.dumps(value), encoding="utf-8")
    os.chmod(path, 0o600)

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp).resolve()
    roots = {name: str(root / name) for name in ("locks", "temporary_profiles", "browser_use_home", "recordings", "receipts", "downloads")}
    for value in roots.values():
        pathlib.Path(value).mkdir(mode=0o700)
    profile = str((pathlib.Path(roots["temporary_profiles"]) / ("a" * 64)).resolve())
    pathlib.Path(profile).mkdir(mode=0o700)
    recording_dir = str((pathlib.Path(roots["recordings"]) / "run-1").resolve())
    pathlib.Path(recording_dir).mkdir(mode=0o700)
    status_path = os.path.join(recording_dir, ".recording-status.json")
    write_json(status_path, {"schema": h.RECORDING_STATUS_SCHEMA, "recorder_configured": True, "recorder_active": True, "finalized": False, "recording_dir": recording_dir})
    descriptor_path = os.path.join(recording_dir, "session-nonce.json")
    download_dir = str((pathlib.Path(roots["downloads"]) / "run-1").resolve())
    pathlib.Path(download_dir).mkdir(mode=0o700)
    config = {"roots": roots}
    descriptor = {
        "schema": h.RECORDING_SCHEMA, "status": "stale", "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": "run-1", "session": "session-1", "automation_id": "manual", "task_id": "task-1", "nonce": "nonce-1",
        "profile": profile, "port": 20080, "recording_dir": recording_dir, "status_path": status_path,
        "download_dir": download_dir, "lock_paths": [h.temporary_profile_lock_path(config, profile), h.temporary_port_lock_path(config, 20080)],
        "owned_chrome": True, "process": {"root_pid": 999999, "root_start_time": 1.0}, "room_id": "room-task",
        "operations": [], "target_origins": ["https://example.com"], "authority_sha256": "a" * 64, "account_identity": "acct",
    }
    write_json(descriptor_path, descriptor)
    lock_payload = {"schema": "browser-use-lock.v1", "run_id": "run-1", "nonce": "nonce-1", "canonical_profile": profile, "port": 20080}
    for lock_path in descriptor["lock_paths"]:
        write_json(lock_path, lock_payload)

    patches = [
        patch.object(h, "_recording_runtime_is_stale", return_value=True),
        patch.object(h, "assert_debug_listener_absent"),
        patch.object(h, "browser_harness_root", return_value=str(root / "harness")),
        patch.object(h, "room_registry_release", return_value={"room_id": "room-task", "state": "released"}),
        patch.object(h, "pending_operation_reconciliation_ids", return_value=["d11c920b93a84a55807e48487a0414ad"]),
        patch.object(h, "operation_effect_summary", return_value="unknown"),
    ]
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5]:
        result = h.cleanup_stale_recording_descriptor(config, {}, descriptor, descriptor_path)
    assert result["status"] == "recording_cleanup_completed"
    assert result["external_effects"] == "unknown"
    assert result["pending_reconciliation"] == ["d11c920b93a84a55807e48487a0414ad"]
    assert os.path.exists(profile)
    assert not os.path.exists(download_dir)
    assert all(not os.path.exists(path) for path in descriptor["lock_paths"])
    receipt = json.loads(pathlib.Path(result["cleanup_receipt"]).read_text())
    assert receipt["schema"] == h.RECORDING_CLEANUP_RECEIPT_SCHEMA
    assert receipt["process_absent"] is True and receipt["listener_absent"] is True and receipt["daemon_absent"] is True
    saved = json.loads(pathlib.Path(descriptor_path).read_text())
    assert saved["status"] == "stale" and saved["recovery_state"] == "cleanup_complete"
    assert saved["external_effects"] == "unknown"

    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5]:
        again = h.cleanup_stale_recording_descriptor(config, {}, saved, descriptor_path)
    assert again["idempotent"] is True
    assert again["cleanup_receipt"] == result["cleanup_receipt"]
    assert all(not os.path.exists(path) for path in descriptor["lock_paths"])

    with patch.object(h, "_recording_runtime_is_stale", return_value=False), patch.object(h, "assert_debug_listener_absent"):
        try:
            h.cleanup_stale_recording_descriptor(config, {}, saved, descriptor_path)
            raise AssertionError("live runtime was accepted")
        except h.Blocker as exc:
            assert exc.code == "browser_use_recording_cleanup_process_still_live"

print("stale recording cleanup ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /stale recording cleanup ok/);
  }
});

test("record-finalize cleanup-only routes stale recordings to the recording cleanup owner", () => {
  const script = String.raw`
import argparse, builtins, importlib.util, json
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = __import__("os").environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_finalize_route", SourceFileLoader("codex_browser_use_finalize_route", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

descriptor = {
    "status": "stale", "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
    "run_id": "run-1", "session": "session-1", "task_id": "task-1",
}
args = argparse.Namespace(
    run_id="run-1", session="session-1", descriptor="/tmp/stale-recording.json",
    authority="/tmp/authority.json", authority_renewal=None, task_id="task-1",
    delete_approved=False, user_ok=False, cleanup_only=True,
)
seen = {}
def read_descriptor(config, path, run_id, session, **kwargs):
    assert kwargs["allow_stale_runtime_recovery"] is True
    return descriptor

def cleanup(config, versions, value, path, *, delete_approved=False):
    seen["called"] = True
    assert delete_approved is False
    return {"cleanup_receipt": "/tmp/cleanup.json", "cleanup": {}, "pending_reconciliation": ["d11"], "external_effects": "unknown"}

config = {"roots": {"browser_use_home": "/tmp/browser-home"}}
with patch.object(h, "read_toml", return_value=config), \
     patch.object(h, "validate_installation", return_value={}), \
     patch.object(h, "validate_recording_tools", return_value={}), \
     patch.object(h, "read_recording_descriptor", side_effect=read_descriptor), \
     patch.object(h, "recording_authority", return_value=None), \
     patch.object(h, "cleanup_stale_recording_descriptor", side_effect=cleanup), \
     patch.object(builtins, "print") as output:
    assert h.record_finalize(args) == 1
assert seen["called"] is True
payload = json.loads(output.call_args.args[0])
assert payload["cleanup_reconciled"] is True
assert payload["exact_blocker"] == "browser_use_external_effects_unknown"
print("record-finalize route ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /record-finalize route ok/);
  }
});

test("new temporary authorized recording starts require a signed owner attestation", () => {
  const script = String.raw`
import argparse, importlib.util, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_owner_metadata", SourceFileLoader("codex_browser_use_owner_metadata", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

OWNER_BINDING = {
    "command": "record-start", "mode": "authorized", "lifecycle": "temporary",
    "run_id": "run-1", "requested_session": "session-1", "automation_id": "manual",
    "task_id": "task-1", "command_args": ["state"],
    "allowed_origins": ["https://example.com"], "authority_sha256": "a" * 64,
    "recording_dir": os.path.join(os.path.realpath(tempfile.gettempdir()), "fixture-recording"),
}

def args_for(**updates):
    value = {"thread_id": None, "host_id": None, "source_handoff": None, "owner_attestation": None}
    value.update(updates)
    return argparse.Namespace(**value)

def expect_block(call, code):
    try:
        call()
    except h.Blocker as exc:
        assert exc.code == code, (exc.code, code)
    else:
        raise AssertionError(f"expected {code}")

with patch.dict(os.environ, {}, clear=True):
    expect_block(lambda: h.validate_record_start_owner_metadata(args_for()), "browser_use_owner_attestation_binding_required")
    expect_block(lambda: h.validate_record_start_owner_metadata(args_for(), binding=OWNER_BINDING), "browser_use_owner_context_provider_unavailable")

with patch.dict(os.environ, {"CODEX_THREAD_ID": "thread-1", "CODEX_HOST_ID": "spoofed-host"}, clear=True):
    expect_block(lambda: h.validate_record_start_owner_metadata(args_for(), binding=OWNER_BINDING), "browser_use_owner_metadata_untrusted")

parsed = h.build_parser().parse_args([
    "record-start", "--mode", "authorized", "--run-id", "run-1", "--session", "session-1",
    "--lifecycle", "temporary", "--task-id", "task-1", "--authority", "authority.json",
    "--recording-dir", "/private/tmp/fixture-recording", "--thread-id", "cli-thread", "--host-id", "cli-host",
    "--source-handoff", "/does/not/exist/opaque-reference", "--", "state",
])
with patch.dict(os.environ, {}, clear=True), patch.object(h, "read_handoff", side_effect=AssertionError("source_handoff was read")):
    expect_block(lambda: h.validate_record_start_owner_metadata(parsed, binding=OWNER_BINDING), "browser_use_owner_metadata_untrusted")

with tempfile.TemporaryDirectory() as temp:
    fixture = pathlib.Path(temp) / "fixture"
    fixture.mkdir()
    (fixture / "sentinel").write_text("unchanged", encoding="utf-8")
    before = sorted(str(path.relative_to(fixture)) for path in fixture.rglob("*"))
    with patch.dict(os.environ, {}, clear=True):
        expect_block(lambda: h.validate_record_start_owner_metadata(args_for(), binding=OWNER_BINDING), "browser_use_owner_context_provider_unavailable")
    after = sorted(str(path.relative_to(fixture)) for path in fixture.rglob("*"))
    assert before == after and (fixture / "sentinel").read_text(encoding="utf-8") == "unchanged"

config = {"roots": {"browser_use_home": "/tmp/fixture-browser-home", "temporary_profiles": os.path.realpath(tempfile.gettempdir()), "downloads": os.path.realpath(tempfile.gettempdir())}, "ports": {"temporary_start": 20080, "temporary_end": 20099}, "commands": {"authorized": ["state"], "public": ["state"]}, "policy": {"unsafe_path_fragments": []}, "limits": {"max_upload_bytes": 1}}
authority = {"allowed_origins": ["https://example.com"], "account_identity": "acct", "data_exposure": "authorized", "side_effect_scope": "in-app-save", "approval": "user-approved", "readback_required": True, "expires_at": "2099-01-01T00:00:00Z"}
runtime = {"default_framerate": 12}
base = dict(mode="authorized", lifecycle="temporary", run_id="run-1", session="session-1", automation_id="manual", task_id="task-1", authority="authority.json", recording_dir=os.path.join(os.path.realpath(tempfile.gettempdir()), "fixture-recording"), framerate=None, handoff_descriptor=None, source_run_id=None, source_session=None, port=None, allowed_origin=[], command=["state"], thread_id=None, host_id=None, source_handoff=None, owner_attestation=None)
patches = [
    patch.object(h, "read_toml", return_value=config), patch.object(h, "validate_installation", return_value={}),
    patch.object(h, "validate_recording_tools", return_value={}), patch.object(h, "validate_recording_runtime", return_value=runtime),
    patch.object(h, "parse_authority", return_value=authority), patch.object(h, "sha256_file", return_value="a" * 64),
    patch.object(h, "validate_recording_output_dir", return_value=base["recording_dir"]),
    patch.object(h, "require_cross_run_reconciliation_clear", side_effect=AssertionError("resource-stage reached")),
]
with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7]:
    with patch.dict(os.environ, {}, clear=True):
        expect_block(lambda: h.record_start(argparse.Namespace(**base)), "browser_use_owner_context_provider_unavailable")

for mode, lifecycle in (("public", "single-use"), ("authorized", "single-use"), ("authorized", "scheduled")):
    lane = dict(base, mode=mode, lifecycle=lifecycle, allowed_origin=["https://example.com"], authority=None if mode == "public" else "authority.json")
    lane_patches = [
        patch.object(h, "read_toml", return_value=config), patch.object(h, "validate_installation", return_value={}),
        patch.object(h, "validate_recording_tools", return_value={}), patch.object(h, "validate_recording_runtime", return_value=runtime),
        patch.object(h, "parse_authority", return_value=authority), patch.object(h, "sha256_file", return_value="a" * 64),
        patch.object(h, "require_cross_run_reconciliation_clear", return_value=None),
        patch.object(h, "validate_recording_output_dir", side_effect=RuntimeError("fixture-stop-before-resources")),
        patch.object(h, "validate_record_start_owner_metadata", side_effect=AssertionError("owner metadata lane regression")),
    ]
    with lane_patches[0], lane_patches[1], lane_patches[2], lane_patches[3], lane_patches[4], lane_patches[5], lane_patches[6], lane_patches[7], lane_patches[8]:
        try:
            h.record_start(argparse.Namespace(**lane))
        except RuntimeError as exc:
            assert str(exc) == "fixture-stop-before-resources"
        else:
            raise AssertionError("lane did not reach fixture stop")

authority_base = dict(base, thread_id="thread-1", host_id="host-1", source_handoff="opaque-handoff")
with patch.object(h, "read_toml", return_value=config), patch.object(h, "validate_installation", return_value={}), patch.object(h, "validate_recording_tools", return_value={}), patch.object(h, "validate_recording_runtime", return_value=runtime):
    expect_block(lambda: h.record_start(argparse.Namespace(**dict(authority_base, authority=None))), "browser_use_authority_required")
    expect_block(lambda: h.record_start(argparse.Namespace(**dict(authority_base, authority="/does/not/exist/authority.json"))), "browser_use_path_missing")

print("owner metadata ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /owner metadata ok/);
  }
});

test("temporary startup cleanup distinguishes uncreated profiles from lost profiles and uncertain resources", () => {
  const script = String.raw`
import importlib.util, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_cleanup_tracking", SourceFileLoader("codex_browser_use_cleanup_tracking", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

source_text = pathlib.Path(helper_path).read_text(encoding="utf-8")
assert source_text.count('"profile_created": False') == 3
assert source_text.count('ctx["profile_created"] = True') == 3
assert source_text.count('"launch_attempted": False') == 3
assert source_text.count('ctx["launch_attempted"] = True') == 3
assert "_recording_failure_cleanup(config, ctx, chrome_proc, args.lifecycle, descriptor_path)" in source_text
assert "_cleanup_execute_failure(config, ctx, chrome_proc, args.lifecycle)" in source_text
assert "_cleanup_login_handoff_failure(config, ctx, ctx.get(\"descriptor_path\")" in source_text

def context(config, profile, *, profile_created, launch_attempted=False, port=None):
    return {
        "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": "run-1", "session": "session-1", "requested_session": "session-1",
        "automation_id": "manual", "task_id": "task-1", "nonce": "nonce-1",
        "lock_paths": [], "cleanup": {}, "config": config, "owned_chrome": True,
        "home": config["roots"]["browser_use_home"], "port": port, "profile": profile,
        "download_dir": os.path.join(config["roots"]["downloads"], "missing-download"),
        "profile_created": profile_created, "launch_attempted": launch_attempted,
    }

with tempfile.TemporaryDirectory() as temp:
    roots = {name: os.path.join(temp, name) for name in ("browser_use_home", "downloads", "locks", "temporary_profiles")}
    for value in roots.values():
        os.makedirs(value, mode=0o700)
    config = {"roots": roots, "executables": {"chrome": {"canonical_path": "/bin/false"}}}
    profile = os.path.join(roots["temporary_profiles"], "missing-profile")

    uncreated = context(config, profile, profile_created=False)
    with patch.object(h, "close_owned_daemon_if_active", return_value=(True, None)), patch.object(h, "_release_locks_after_verified_cleanup", return_value=(True, None)):
        assert h._cleanup_execute_failure(config, uncreated, None, h.TEMPORARY_LIFECYCLE) is None
    assert "temporary_profile_preserved" not in uncreated["cleanup"]
    assert uncreated["cleanup"].get("uncertain") is not True

    created_then_missing = context(config, profile, profile_created=True)
    with patch.object(h, "close_owned_daemon_if_active", return_value=(True, None)):
        assert h._cleanup_execute_failure(config, created_then_missing, None, h.TEMPORARY_LIFECYCLE) == "browser_use_temporary_profile_missing_after_cleanup"
    assert created_then_missing["cleanup"]["uncertain"] is True

    process_uncertain = context(config, profile, profile_created=False, launch_attempted=True, port=20080)
    with patch.object(h, "close_owned_daemon_if_active", return_value=(True, None)), patch.object(h, "verify_chrome_absent", side_effect=h.Blocker("browser_use_process_identity_recheck_failed")):
        assert h._cleanup_execute_failure(config, process_uncertain, None, h.TEMPORARY_LIFECYCLE) == "browser_use_process_identity_recheck_failed"

    lock_uncertain = context(config, profile, profile_created=False)
    with patch.object(h, "close_owned_daemon_if_active", return_value=(True, None)), patch.object(h, "_release_locks_after_verified_cleanup", return_value=(False, "browser_use_lock_cleanup_readback_failed")):
        assert h._cleanup_execute_failure(config, lock_uncertain, None, h.TEMPORARY_LIFECYCLE) == "browser_use_lock_cleanup_readback_failed"

    handoff_uncreated = context(config, profile, profile_created=False)
    with patch.object(h, "_release_locks_after_verified_cleanup", return_value=(True, None)):
        assert h._cleanup_login_handoff_failure(config, handoff_uncreated, None, "run-1", "session-1", "nonce-1", profile, handoff_uncreated["download_dir"], True, "browser_use_handoff_open_failed") == "browser_use_handoff_open_failed"
    assert "temporary_profile_preserved" not in handoff_uncreated["cleanup"]
    assert handoff_uncreated["cleanup"].get("uncertain") is not True

    handoff_created_then_missing = context(config, profile, profile_created=True)
    assert h._cleanup_login_handoff_failure(config, handoff_created_then_missing, None, "run-1", "session-1", "nonce-1", profile, handoff_created_then_missing["download_dir"], True, "browser_use_handoff_open_failed") == "browser_use_temporary_profile_missing_after_cleanup"

print("temporary cleanup tracking ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /temporary cleanup tracking ok/);
  }
});

test("stale handoff-backed recording cleanup releases only the borrowed lease", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_handoff_stale_cleanup", SourceFileLoader("codex_browser_use_handoff_stale_cleanup", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def write_json(path, value):
    pathlib.Path(path).write_text(json.dumps(value), encoding="utf-8")
    os.chmod(path, 0o600)

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp).resolve()
    roots = {name: str(root / name) for name in ("browser_use_home", "temporary_profiles", "downloads", "locks", "recordings", "receipts")}
    for value in roots.values():
        pathlib.Path(value).mkdir(mode=0o700)
    run_id = "run-1"
    session = "session-1"
    nonce = "nonce-1"
    binding = "a" * 64
    profile = str((pathlib.Path(roots["temporary_profiles"]) / binding).resolve())
    download_dir = str((pathlib.Path(roots["downloads"]) / "run-1").resolve())
    pathlib.Path(profile).mkdir(mode=0o700)
    pathlib.Path(download_dir).mkdir(mode=0o700)
    handoff_dir = pathlib.Path(roots["browser_use_home"]) / "handoffs" / run_id
    handoff_dir.mkdir(mode=0o700, parents=True)
    source_path = str((handoff_dir / "session-1.json.consumed").resolve())
    recording_dir = str((pathlib.Path(roots["recordings"]) / run_id).resolve())
    pathlib.Path(recording_dir).mkdir(mode=0o700)
    status_path = str((pathlib.Path(recording_dir) / ".recording-status.json").resolve())
    descriptor_path = str((pathlib.Path(recording_dir) / "descriptor.json").resolve())
    write_json(status_path, {"schema": h.RECORDING_STATUS_SCHEMA, "recorder_configured": True, "recorder_active": True, "finalized": False, "recording_dir": recording_dir})
    lock_paths = [str((pathlib.Path(roots["locks"]) / "profile.lock").resolve()), str((pathlib.Path(roots["locks"]) / "port.lock").resolve())]
    process = {"pid": 999999, "root_pid": 999999, "root_start_time": 1.0}
    room_id = "room-task"
    source = {
        "schema": h.HANDOFF_SCHEMA, "status": "continued", "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": run_id, "session": session, "requested_session": session, "automation_id": "manual", "task_id": "task-1",
        "nonce": nonce, "authority_sha256": "b" * 64, "origin": "https://example.com", "profile": profile,
        "profile_hash": "c" * 64, "profile_marker_sha256": "d" * 64, "port": 20080, "daemon_session": session,
        "process": process, "lock_paths": lock_paths, "lease_path": source_path, "download_dir": download_dir,
        "creation_binding": binding, "authority_scope": {"approval": "approved"}, "room_id": room_id,
        "expires_at": "2026-08-01T00:00:00Z",
    }
    descriptor = {
        "schema": h.RECORDING_SCHEMA, "status": "stale", "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": run_id, "session": session, "source_run_id": run_id, "source_session": session,
        "source_handoff_descriptor": source_path, "automation_id": "manual", "task_id": "task-1", "nonce": "recording-nonce",
        "profile": profile, "port": 20080, "process": process, "owned_chrome": False, "room_id": room_id,
        "status_path": status_path, "recording_dir": recording_dir, "download_dir": download_dir,
    }
    config = {"roots": roots, "ports": {"temporary_start": 20080, "temporary_end": 20099}}
    for path in lock_paths:
        write_json(path, {"schema": "browser-use-lock.v1", "run_id": run_id, "nonce": nonce, "canonical_profile": profile, "port": 20080})
    write_json(source_path, source)
    write_json(descriptor_path, descriptor)
    room = {"room_id": room_id, "profile": profile, "port": 20080, "state": "active"}
    with patch.object(h, "room_registry_lookup", return_value=room), \
         patch.object(h, "validate_handoff_process_identity", return_value=False), \
         patch.object(h, "assert_debug_listener_absent"), \
         patch.object(h, "browser_harness_root", return_value=str(root / "harness")), \
         patch.object(h, "room_registry_release", return_value={"room_id": room_id, "state": "released"}) as room_release, \
         patch.object(h, "pending_operation_reconciliation_ids", return_value=["unknown-op"]), \
         patch.object(h, "operation_effect_summary", return_value="unknown"):
        result = h.cleanup_stale_recording_descriptor(config, {}, descriptor, descriptor_path)
    assert result["external_effects"] == "unknown"
    assert result["cleanup"]["profile_preserved"] is True and result["cleanup"]["download_dir_preserved"] is True
    assert all(not os.path.exists(path) for path in lock_paths)
    assert pathlib.Path(profile).exists() and pathlib.Path(download_dir).exists()
    assert room_release.call_args.kwargs["run_id"] == run_id
    receipt = json.loads(pathlib.Path(result["cleanup_receipt"]).read_text())
    assert receipt["kind"] == "stale_handoff_recording_cleanup"
    saved_source = json.loads(pathlib.Path(source_path).read_text())
    assert saved_source["cleanup_state"]["recording_stale_cleanup"] is True
    assert saved_source["cleanup_state"]["locks_released"] is True
    assert pathlib.Path(str(pathlib.Path(source_path).with_suffix("")) + ".cleanup-complete.json").exists()
    saved_descriptor = json.loads(pathlib.Path(descriptor_path).read_text())
    assert saved_descriptor["recovery_state"] == "cleanup_complete"

    with patch.object(h, "room_registry_lookup", return_value=room), \
         patch.object(h, "validate_handoff_process_identity", return_value=False), \
         patch.object(h, "assert_debug_listener_absent"), \
         patch.object(h, "browser_harness_root", return_value=str(root / "harness")), \
         patch.object(h, "room_registry_release", return_value={"room_id": room_id, "state": "released"}), \
         patch.object(h, "pending_operation_reconciliation_ids", return_value=["unknown-op"]), \
         patch.object(h, "operation_effect_summary", return_value="unknown"):
        again = h.cleanup_stale_recording_descriptor(config, {}, saved_descriptor, descriptor_path)
    assert again["external_effects"] == "unknown"
    assert all(not os.path.exists(path) for path in lock_paths)
print("stale handoff recording cleanup ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /stale handoff recording cleanup ok/);
  }
});

test("reconciled ledger state clears the transient readback-pending marker", () => {
  const script = String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_reconciliation_normalization", SourceFileLoader("codex_browser_use_reconciliation_normalization", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

descriptor = {"recovery_state": "readback_pending", "effectful_retry_allowed": False}
with patch.object(h, "pending_operation_reconciliation_ids", return_value=[]):
    assert h.update_reconciliation_summary(descriptor) == []
assert descriptor["recovery_state"] == "reconciled"
assert descriptor["effectful_retry_allowed"] is True

pending = {"recovery_state": "readback_pending", "effectful_retry_allowed": False}
with patch.object(h, "pending_operation_reconciliation_ids", return_value=["op-1"]):
    assert h.update_reconciliation_summary(pending) == ["op-1"]
assert pending["recovery_state"] == "readback_pending"
assert pending["effectful_retry_allowed"] is False
print("reconciliation normalization ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /reconciliation normalization ok/);
  }
});

test("cleanup-only accepts a continued source-handoff recording after its bound cleanup marker", () => {
  const script = String.raw`
import importlib.util, os, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_continued_cleanup_marker", SourceFileLoader("codex_browser_use_continued_cleanup_marker", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

root = tempfile.mkdtemp(prefix="continued-cleanup-")
descriptor_path = os.path.join(root, "descriptor.json")
receipt_path = os.path.join(root, "cleanup-receipt.json")
descriptor = {
    "schema": h.RECORDING_SCHEMA,
    "status": "continued",
    "mode": "authorized",
    "lifecycle": h.TEMPORARY_LIFECYCLE,
    "run_id": "run-1",
    "session": "session-1",
    "nonce": "nonce-1",
    "task_id": "task-1",
    "creation_binding": "binding-1",
    "owned_chrome": False,
    "source_handoff_descriptor": os.path.join(root, "missing-handoff.json.consumed"),
    "status_path": os.path.join(root, "recording-status.json"),
    "profile": os.path.join(root, "profile"),
    "port": 20080,
    "lock_paths": [],
}

with patch.object(h, "_recording_source_cleanup_marker", return_value={"completed": True}), \
     patch.object(h, "assert_debug_listener_absent"), \
     patch.object(h, "browser_harness_root", return_value=os.path.join(root, "runtime")), \
     patch.object(h, "recording_cleanup_receipt_path", return_value=receipt_path), \
     patch.object(h, "mark_recording_abandoned"), \
     patch.object(h, "pending_operation_reconciliation_ids", return_value=[]), \
     patch.object(h, "operation_effect_summary", return_value="none"), \
     patch.object(h, "_write_recording_descriptor"):
    result = h.reconcile_cleanup_complete_source_recording({}, {"helper": "versions"}, descriptor, descriptor_path)

assert result["status"] == "recording_cleanup_completed"
assert result["external_effects"] == "none"
assert result["cleanup"]["source_cleanup_marker"]["completed"] is True
print("continued cleanup marker reconciliation ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /continued cleanup marker reconciliation ok/);
  }
});

test("continued marker-backed cleanup passes the existing temporary terminal gate only in cleanup-only mode", () => {
  const script = String.raw`
import argparse, builtins, importlib.util, os, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_continued_cleanup_route", SourceFileLoader("codex_browser_use_continued_cleanup_route", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

root = tempfile.mkdtemp(prefix="continued-cleanup-route-")
descriptor = {
    "status": "continued", "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
    "run_id": "run-1", "session": "session-1", "task_id": "task-1",
    "owned_chrome": False,
    "source_handoff_descriptor": os.path.join(root, "missing-handoff.json.consumed"),
}
args = argparse.Namespace(
    run_id="run-1", session="session-1", descriptor=os.path.join(root, "descriptor.json"),
    authority=os.path.join(root, "authority.json"), authority_renewal=None,
    task_id="task-1", cleanup_only=True, delete_approved=False, user_ok=False,
)
config = {"roots": {"browser_use_home": root}}
cleanup = {"cleanup_receipt": os.path.join(root, "cleanup.json"), "cleanup": {}, "pending_reconciliation": [], "external_effects": "none"}

with patch.object(h, "read_toml", return_value=config), \
     patch.object(h, "validate_installation", return_value={}), \
     patch.object(h, "validate_recording_tools", return_value={}), \
     patch.object(h, "read_recording_descriptor", return_value=descriptor), \
     patch.object(h, "require_temporary_task_id"), \
     patch.object(h, "recording_authority", return_value=None), \
     patch.object(h, "_recording_source_cleanup_marker", return_value={"completed": True}), \
     patch.object(h, "reconcile_cleanup_complete_source_recording", return_value=cleanup), \
     patch.object(builtins, "print") as output:
    assert h.record_finalize(args) == 0

assert descriptor["status"] == "cleanup_pending"
payload = __import__("json").loads(output.call_args.args[0])
assert payload["cleanup_reconciled"] is True
print("continued cleanup route ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /continued cleanup route ok/);
  }
});

test("recording status separates recorder stop from media finalization and blocks misleading terminal state", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_completion_contract", SourceFileLoader("codex_browser_use_completion_contract", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    temp_root = pathlib.Path(os.path.realpath(temp))
    recording_dir = temp_root / "frames"
    recording_dir.mkdir()
    status_path = temp_root / "recording-status.json"
    recording = {"recording_source_dir": str(recording_dir)}
    h.write_harness_recording_status(
        str(status_path), recording, active=False, finalized=True,
        media_finalized=False, state="stopped_pending_media_finalize",
    )
    status_path.chmod(0o600)
    stopped = h.read_recording_status(str(status_path), require_active=False)
    assert stopped["finalized"] is True and stopped["media_finalized"] is False
    h.write_harness_recording_status(
        str(status_path), recording, active=False, finalized=True,
        media_finalized=True, state="media_finalized",
    )
    status_path.chmod(0o600)
    finished = h.read_recording_status(str(status_path), require_active=False)
    assert finished["media_finalized"] is True

    descriptor = {
        "schema": h.RECORDING_SCHEMA, "status": "finalized", "run_id": "run-1", "session": "session-1",
        "lifecycle": h.TEMPORARY_LIFECYCLE, "status_path": str(status_path),
        "process": {}, "owned_chrome": True, "profile": str(temp_root / "profile"),
        "lock_paths": [], "recording_finalized": False,
        "completion_status": "blocked", "completion_blocker": "browser_use_recording_media_not_finalized",
    }
    classified = h._classify_recording_descriptor({}, str(temp_root / "descriptor.json"), descriptor)
    assert classified["liveness"] == "finalized_blocked"
    assert classified["exact_blocker"] == "browser_use_recording_media_not_finalized"
print("recording completion contract ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /recording completion contract ok/);
  }
});

test("audit freshness and owner completion metadata are bound without sending signals", () => {
  const script = String.raw`
import hashlib, importlib.util, json, os
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_audit_contract", SourceFileLoader("codex_browser_use_audit_contract", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

fresh = h.build_audit_freshness(
    run_id="run-1", session="session-1", nonce="nonce-1", room_id="room-1", port=20080,
    helper_sha256="a" * 64, generated_at="2026-08-04T00:00:00Z",
)
expected = hashlib.sha256(json.dumps({key: fresh[key] for key in ("schema", "run_id", "session", "nonce", "room_id", "port", "helper_sha256", "generated_at")}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
assert fresh["schema"] == h.AUDIT_FRESHNESS_SCHEMA and fresh["binding_hash"] == expected
assert fresh["binding_hash"] != h.build_audit_freshness(run_id="run-2", session="session-1", nonce="nonce-1", room_id="room-1", port=20080, helper_sha256="a" * 64, generated_at="2026-08-04T00:00:00Z")["binding_hash"]

descriptor = {"run_id": "run-1", "session": "session-1", "nonce": "nonce-1", "task_id": "task-1", "source_thread_id": "thread-1"}
owner = h.owner_completion_receipt(descriptor, command=["state"], readback_exit=0, consumed_at="2026-08-04T00:00:00Z")
assert owner["schema"] == h.OWNER_COMPLETION_RECEIPT_SCHEMA
assert owner["state"] == "consumed_not_auth_proof" and owner["auth_proof"] is False and owner["external_signal_sent"] is False
assert "state" not in owner["command_digest"] and len(owner["command_digest"]) == 64
print("audit and owner completion contracts ok")
`;
  for (const helper of helpers) {
    const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
      env: { ...process.env, HELPER_PATH: helper },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /audit and owner completion contracts ok/);
  }
});
