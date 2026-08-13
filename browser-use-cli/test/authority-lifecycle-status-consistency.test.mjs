import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("cleanup capability is retained, directly usable, owner-bound, and secret-free", () => {
  const script = String.raw`
import contextlib, importlib.util, io, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_authority_lifecycle", SourceFileLoader("codex_browser_use_authority_lifecycle", helper_path))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    recording = base / "recordings" / "run-1"; recording.mkdir(mode=0o700, parents=True)
    config = {"roots": {"browser_use_home": str(base / "home")}}
    pathlib.Path(config["roots"]["browser_use_home"]).mkdir(mode=0o700)
    authority = {
        "browser_surface": "browser_use_cli", "run_id": "run-1", "session": "session-1",
        "expires_at": "2099-01-01T00:00:00Z", "allowed_origins": ["https://example.com"],
        "account_identity": "private-account", "data_exposure": "authenticated",
        "side_effect_scope": "bounded", "approval": "approved", "readback_required": True,
    }
    path_value, binding_digest = h.write_recording_cleanup_capability(
        str(recording), run_id="run-1", requested_session="session-1", session="session-1",
        mode="authorized", lifecycle="temporary", automation_id="manual", task_id="task-1",
        nonce="n" * 32, authority=authority, authority_digest="a" * 64,
    )
    descriptor = {
        "run_id": "run-1", "session": "session-1", "requested_session": "session-1",
        "mode": "authorized", "lifecycle": "temporary", "automation_id": "manual", "task_id": "task-1",
        "nonce": "n" * 32, "recording_dir": str(recording),
        "cleanup_capability_path": path_value, "cleanup_capability_sha256": binding_digest,
        "account_identity": "private-account", "target_origins": ["https://example.com"],
    }
    updated_digest = h.update_recording_cleanup_capability(
        path_value, expected_run_id="run-1", expected_session="session-1", expected_nonce="n" * 32,
        cleanup_phase=h.lifecycle_phase(observed=True, requested=True, executed=True, completed=True),
    )
    assert updated_digest == binding_digest
    recovered = h.recording_authority(config, descriptor, None, cleanup_only=True)
    assert recovered["account_identity"] == "private-account"
    assert recovered["allowed_origins"] == ["https://example.com"]
    assert json.loads(pathlib.Path(path_value).read_text())["cleanup_phase"]["completed"] is True

    mismatched = dict(descriptor, task_id="other-task")
    try:
        h.recording_authority(config, mismatched, None, cleanup_only=True)
    except h.Blocker as exc:
        assert exc.code == "browser_use_recording_cleanup_capability_owner_mismatch"
    else:
        raise AssertionError("owner mismatch was accepted")

    raw = pathlib.Path(path_value).read_text()
    assert "password" not in raw.lower() and "token" not in raw.lower()
    assert "private-account" in raw
print("authority retention/owner binding/redaction ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper }, encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /authority retention\/owner binding\/redaction ok/);
});

test("record-start writes capability before room mutation and fails closed", () => {
  const script = String.raw`
import argparse, contextlib, importlib.util, io, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_start_preflight", SourceFileLoader("codex_browser_use_start_preflight", helper_path))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    recording = base / "recordings" / "run-2"; recording.mkdir(mode=0o700, parents=True)
    home = base / "home"; home.mkdir(mode=0o700)
    authority_path = base / "authority.json"
    authority_path.write_text(json.dumps({"placeholder": True}), encoding="utf-8"); authority_path.chmod(0o600)
    config = {"roots": {"browser_use_home": str(home), "downloads": str(base / "downloads"), "temporary_profiles": str(base / "profiles")}, "ports": {"temporary_start": 20080, "temporary_end": 20099}, "executables": {"chrome": {"canonical_path": "/bin/false"}}}
    pathlib.Path(config["roots"]["downloads"]).mkdir(mode=0o700)
    pathlib.Path(config["roots"]["temporary_profiles"]).mkdir(mode=0o700)
    authority = {"allowed_origins": ["https://example.com"], "account_identity": "private-account", "data_exposure": "authenticated", "side_effect_scope": "bounded", "approval": "approved", "readback_required": True, "expires_at": "2099-01-01T00:00:00Z"}
    calls = []
    def claim(*args, **kwargs):
        capability = recording / ".recording-cleanup-capability.json"
        assert capability.exists(), "room mutation happened before capability"
        calls.append("room")
        raise h.Blocker("browser_use_room_registry_no_free_room")
    args = argparse.Namespace(
        mode="authorized", lifecycle="temporary", run_id="run-2", session="session-2", automation_id="manual",
        task_id="task-2", port=20080, allowed_origin=[], authority=str(authority_path), recording_dir=str(recording),
        framerate=None, handoff_descriptor=None, source_run_id=None, source_session=None, owner_attestation=None,
        thread_id=None, host_id=None, source_handoff=None, shared_lease=None, command=[],
    )
    output = io.StringIO()
    with patch.object(h, "read_toml", return_value=config), patch.object(h, "validate_installation", return_value={}), \
         patch.object(h, "validate_recording_tools", return_value={}), patch.object(h, "validate_recording_runtime", return_value={"default_framerate": 12}), \
         patch.object(h, "parse_authority", return_value=authority), patch.object(h, "sha256_file", return_value="a" * 64), \
         patch.object(h, "remaining_authority_budget", return_value={"sufficient": True}), patch.object(h, "validate_record_start_owner_metadata", return_value={"thread_id": "thread-1"}), \
         patch.object(h, "validate_command", return_value=(["state"], ["https://example.com"], [])), patch.object(h, "require_cross_run_reconciliation_clear"), \
         patch.object(h, "temporary_binding", return_value="b" * 64), patch.object(h, "temporary_profile_path", return_value=str(base / "profiles" / ("b" * 64))), \
         patch.object(h, "room_registry_claim", side_effect=claim), patch.object(h, "close_owned_daemon_if_active", return_value=(True, None)), \
         contextlib.redirect_stdout(output):
        exit_code = h.record_start(args)
    assert exit_code == 1
    payload = json.loads(output.getvalue())
    assert payload["exact_blocker"] == "browser_use_room_registry_no_free_room"
    assert payload["phases"]["record_start"]["blocked"] is True
    assert payload["phases"]["terminal_cleanup"]["completed"] is True
    capability = recording / ".recording-cleanup-capability.json"
    value = json.loads(capability.read_text())
    assert value["phase"]["blocked"] is True
    assert value["cleanup_phase"]["completed"] is True
    assert value["cleanup_phase"]["blocked"] is False
    assert calls == ["room"]
    assert "password" not in output.getvalue().lower() and "token" not in output.getvalue().lower()
print("start preflight/fail-closed/phase ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper }, encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /start preflight\/fail-closed\/phase ok/);
});

test("recording-status preserves explicit lifecycle phases in machine-readable output", () => {
  const script = String.raw`
import contextlib, importlib.util, io, json, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_status_phase", SourceFileLoader("codex_browser_use_status_phase", helper_path))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
entry = {
    "descriptor": "/tmp/descriptor.json", "run_id": "run-3", "session": "session-3",
    "status": "active", "liveness": "live", "process_live": True,
    "cleanup_completed": False, "phases": {
        "record_start": h.lifecycle_phase(observed=True, requested=True, executed=True, completed=True),
        "terminal_cleanup": h.lifecycle_phase(),
    },
}
with patch.object(h, "read_toml", return_value={"roots": {"recordings": "/tmp/recordings"}}), \
     patch.object(h, "validate_installation", return_value={}), patch.object(h, "shared_profile_inventory", return_value={"profile_count": 0, "available_count": 0, "leased_count": 0, "busy_count": 0}), \
     patch.object(h, "_recording_descriptor_paths", return_value=[]), patch.object(h, "_classify_recording_descriptor", return_value=entry), \
     patch.object(h, "_recording_descriptor_paths", return_value=["/tmp/descriptor.json"]), patch.object(h, "read_json_safe", return_value={"schema": h.RECORDING_SCHEMA, "room_id": "room-4"}), \
     patch.object(h, "_cleanup_pending_is_terminal_resource_free", return_value=False):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert h.recording_status(type("Args", (), {"descriptor": None, "mark_stale": False})()) == 0
payload = json.loads(output.getvalue())
assert payload["entries"][0]["phases"]["record_start"]["completed"] is True
assert payload["entries"][0]["phases"]["terminal_cleanup"]["requested"] is False
print("status phase projection ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper }, encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /status phase projection ok/);
});

test("recording-status does not claim completion while an owner room or Harness daemon remains", () => {
  const script = String.raw`
import contextlib, importlib.util, io, json, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_room_pending", SourceFileLoader("codex_browser_use_room_pending", helper_path))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
entry = {
    "descriptor": "/tmp/descriptor.json", "run_id": "run-4", "session": "session-4",
    "room_id": "room-4", "status": "continued", "liveness": "stale", "process_live": False,
    "cleanup_completed": False, "phases": {},
}
room = {"room_id": "room-4", "state": "active", "owner": {"id": "task-4"}}
observation = {"room_id": "room-4", "process_observed": False, "listener_observed": False, "daemon_observed": True, "reclaim_allowed": False, "observed_at": "now"}
with patch.object(h, "read_toml", return_value={"roots": {"recordings": "/tmp/recordings"}}), \
     patch.object(h, "validate_installation", return_value={}), patch.object(h, "shared_profile_inventory", return_value={"profile_count": 0, "available_count": 0, "leased_count": 0, "busy_count": 0}), \
     patch.object(h, "_recording_descriptor_paths", return_value=["/tmp/descriptor.json"]), patch.object(h, "read_json_safe", return_value={"schema": h.RECORDING_SCHEMA, "room_id": "room-4"}), \
     patch.object(h, "_classify_recording_descriptor", return_value=entry), patch.object(h, "_cleanup_pending_is_terminal_resource_free", return_value=False), \
     patch.object(h, "room_registry_list", return_value=[room]), patch.object(h, "room_registry_observations", return_value=[observation]):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert h.recording_status(type("Args", (), {"descriptor": None, "mark_stale": False})()) == 0
payload = json.loads(output.getvalue())
assert payload["overall_completion"] == "blocked", payload
assert payload["current_unresolved_count"] == 1
assert payload["room_resource_pending_count"] == 1
assert payload["entries"][0]["room_resource_blocker"] == "browser_use_room_or_daemon_cleanup_pending"
print("room/daemon pending status ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper }, encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /room\/daemon pending status ok/);
});

test("recording-status separates inspection completion and task completion without double-counting a live room", () => {
  const script = String.raw`
import contextlib, importlib.util, io, json, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_status_contract", SourceFileLoader("codex_browser_use_status_contract", helper_path))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
entry = {
    "descriptor": "/tmp/descriptor.json", "run_id": "run-contract", "session": "session-contract",
    "room_id": "room-contract", "status": "active", "liveness": "live", "process_live": True,
    "cleanup_completed": False, "phases": {},
}
room = {"room_id": "room-contract", "state": "active", "owner": {"id": "task-contract"}}
observation = {"room_id": "room-contract", "process_observed": True, "listener_observed": True, "daemon_observed": True, "reclaim_allowed": False, "observed_at": "now"}
with patch.object(h, "read_toml", return_value={"roots": {"recordings": "/tmp/recordings"}}), \
     patch.object(h, "validate_installation", return_value={}), patch.object(h, "shared_profile_inventory", return_value={"profile_count": 0, "available_count": 0, "leased_count": 0, "busy_count": 0}), \
     patch.object(h, "_recording_descriptor_paths", return_value=["/tmp/descriptor.json"]), patch.object(h, "read_json_safe", return_value={"schema": h.RECORDING_SCHEMA, "room_id": "room-contract"}), \
     patch.object(h, "_classify_recording_descriptor", return_value=entry), patch.object(h, "_cleanup_pending_is_terminal_resource_free", return_value=False), \
     patch.object(h, "room_registry_list", return_value=[room]), patch.object(h, "room_registry_observations", return_value=[observation]):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert h.recording_status(type("Args", (), {"descriptor": None, "mark_stale": False})()) == 0
payload = json.loads(output.getvalue())
assert payload["status"] == "completed"
assert payload["status_scope"] == "inspection"
assert payload["inspection_status"] == "completed"
assert payload["task_status"] == "blocked"
assert payload["current_runtime_status"] == "pending"
assert payload["current_unresolved_count"] == 1
assert payload["current_pending_unique_count"] == 1
assert payload["recording_completion_pending_count"] == 1
assert payload["current_work_policy"] == "owner_bound_terminal_cleanup_or_same_generation_readback"
assert payload["historical_work_policy"] == "owner_bound_readback_only_no_replay"
assert payload["historical_reconciliation_required_count"] == 0
print("status contract and unique pending count ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper }, encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /status contract and unique pending count ok/);
});

test("room sync admission permits only source-generation-bound active rooms", () => {
  const script = String.raw`
import importlib.util
from importlib.machinery import SourceFileLoader

helper_path = __import__("os").environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_sync_admission", SourceFileLoader("codex_browser_use_sync_admission", helper_path))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
source = "a" * 64
installed = "b" * 64
same_generation = {"room_id": "room-source", "owner": {"kind": "task", "id": "task-source"}, "task_id": "task-source", "port": 20081, "state": "active", "current_activity": "record-command", "helper_sha256": source}
legacy = {"room_id": "room-legacy", "owner": {"kind": "task", "id": "task-legacy"}, "task_id": "task-legacy", "port": 20082, "state": "active", "current_activity": "record-start"}
ready = h.room_registry_sync_admission([same_generation], source_helper_sha256=source, installed_helper_sha256=installed)
assert ready["ready"] is True and ready["reason"] == "all_active_rooms_source_generation_bound"
blocked = h.room_registry_sync_admission([legacy], source_helper_sha256=source, installed_helper_sha256=installed)
assert blocked["ready"] is False
assert blocked["blocking_rooms"][0]["exact_blocker"] == "browser_use_cli_live_room_helper_identity_missing"
conflict = h.room_registry_sync_admission([{**same_generation, "helper_sha256": installed}], source_helper_sha256=source, installed_helper_sha256=installed)
assert conflict["blocking_rooms"][0]["exact_blocker"] == "browser_use_cli_live_room_helper_generation_conflict"
assert h.room_registry_sync_admission([legacy], source_helper_sha256=source, installed_helper_sha256=source)["reason"] == "parity_already_true"
print("room sync admission is owner-generation bound")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper }, encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /room sync admission is owner-generation bound/);
});

test("restartable stale cleanup can delete a profile after exact locks were already released", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_lockless_cleanup", SourceFileLoader("codex_browser_use_lockless_cleanup", helper_path))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    profiles = base / "profiles"; locks = base / "locks"
    profiles.mkdir(mode=0o700); locks.mkdir(mode=0o700)
    profile = profiles / ("p" * 64); profile.mkdir(mode=0o700)
    config = {"roots": {"temporary_profiles": str(profiles), "locks": str(locks)}}
    authority_scope = {"data_exposure": "authenticated", "side_effect_scope": "bounded", "approval": "approved", "readback_required": True}
    marker = h.temporary_marker_value(
        config, profile=str(profile), mode="authorized", automation_id="manual", task_id="task-5",
        run_id="run-5", binding="b" * 64, port=20098, authority_digest="a" * 64,
        authority_scope=authority_scope, account_identity="private-account",
        origins=["https://example.com"], created_at="2099-01-01T00:00:00Z",
    )
    marker_path = profile / ".browser-use-profile.json"
    marker_path.write_text(json.dumps(marker), encoding="utf-8"); marker_path.chmod(0o600)
    descriptor = {
        "status": "stale", "recovery_state": "restartable", "lifecycle": "temporary", "owned_chrome": True,
        "mode": "authorized", "automation_id": "manual", "task_id": "task-5", "run_id": "run-5",
        "creation_binding": "b" * 64, "nonce": "b" * 64, "profile": str(profile), "port": 20098,
        "authority_sha256": "a" * 64, "authority_scope": authority_scope,
        "account_identity": "private-account", "target_origins": ["https://example.com"],
        "lock_paths": [h.temporary_profile_lock_path(config, str(profile)), h.temporary_port_lock_path(config, 20098)],
    }
    h.cleanup_temporary_profile(config, descriptor, process_verified=True, allow_released_locks=True)
    assert not profile.exists()
print("restartable lockless profile cleanup ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper }, encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /restartable lockless profile cleanup ok/);
});

test("stale cleanup fails closed when a foreign lock claims the profile", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_foreign_cleanup_lock", SourceFileLoader("codex_browser_use_foreign_cleanup_lock", helper_path))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    profiles = base / "profiles"; locks = base / "locks"
    profiles.mkdir(mode=0o700); locks.mkdir(mode=0o700)
    profile = profiles / ("q" * 64); profile.mkdir(mode=0o700)
    config = {"roots": {"temporary_profiles": str(profiles), "locks": str(locks)}}
    authority_scope = {"data_exposure": "authenticated", "side_effect_scope": "bounded", "approval": "approved", "readback_required": True}
    marker = h.temporary_marker_value(
        config, profile=str(profile), mode="authorized", automation_id="manual", task_id="task-6",
        run_id="run-6", binding="c" * 64, port=20098, authority_digest="a" * 64,
        authority_scope=authority_scope, account_identity="private-account",
        origins=["https://example.com"], created_at="2099-01-01T00:00:00Z",
    )
    marker_path = profile / ".browser-use-profile.json"
    marker_path.write_text(json.dumps(marker), encoding="utf-8"); marker_path.chmod(0o600)
    descriptor = {
        "status": "stale", "recovery_state": "restartable", "lifecycle": "temporary", "owned_chrome": True,
        "mode": "authorized", "automation_id": "manual", "task_id": "task-6", "run_id": "run-6",
        "creation_binding": "c" * 64, "nonce": "c" * 64, "profile": str(profile), "port": 20098,
        "authority_sha256": "a" * 64, "authority_scope": authority_scope,
        "account_identity": "private-account", "target_origins": ["https://example.com"],
        "lock_paths": [h.temporary_profile_lock_path(config, str(profile)), h.temporary_port_lock_path(config, 20098)],
    }
    def foreign_claim(path, payload):
        pathlib.Path(path).write_text(json.dumps({
            "schema": "browser-use-lock.v1", "run_id": "foreign-run", "nonce": "foreign-nonce",
            "canonical_profile": str(profile), "port": 20098,
        }), encoding="utf-8")
        raise h.Blocker("browser_use_lock_already_held", path)
    original = h.lock_file
    h.lock_file = foreign_claim
    try:
        h.cleanup_temporary_profile(config, descriptor, process_verified=True, allow_released_locks=True)
    except h.Blocker as exc:
        assert exc.code == "browser_use_lock_already_held"
    else:
        raise AssertionError("foreign lock claim was accepted")
    assert profile.exists()
    h.lock_file = original
print("foreign cleanup lock fail-closed ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper }, encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /foreign cleanup lock fail-closed ok/);
});
