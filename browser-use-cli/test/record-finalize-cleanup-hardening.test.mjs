import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("cleanup-only rebinds a dead continued borrowed handoff owner-safely", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_cleanup_hardening", SourceFileLoader("codex_browser_use_cleanup_hardening", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def write_json(path, value):
    pathlib.Path(path).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    pathlib.Path(path).write_text(json.dumps(value), encoding="utf-8")
    os.chmod(path, 0o600)

def fixture(label):
    root = pathlib.Path(tempfile.mkdtemp(prefix="borrowed-cleanup-" + label + "-")).resolve()
    home = root / "home"
    profile_root = home / "profiles" / "temporary"
    locks = home / "locks"
    receipts = home / "receipts"
    recordings = home / "recordings"
    downloads = home / "downloads"
    source_dir = home / "handoffs" / "source-run"
    for item in (profile_root, locks, receipts, recordings, downloads, source_dir):
        item.mkdir(mode=0o700, parents=True)
    profile = (profile_root / ("a" * 64)).resolve()
    profile.mkdir(mode=0o700)
    download_dir = (downloads / "recording").resolve()
    download_dir.mkdir(mode=0o700)
    source_path = (source_dir / "source-session.json.consumed").resolve()
    source_path.write_text("{}", encoding="utf-8"); source_path.chmod(0o600)
    recording_dir = (recordings / "destination-run").resolve()
    recording_dir.mkdir(mode=0o700)
    status_path = (recording_dir / ".recording-status.json").resolve()
    status_path.write_text("{}", encoding="utf-8"); status_path.chmod(0o600)
    port = 20085
    source_run, source_session, source_task, source_nonce = "source-run", "source-session", "source-task", "source-nonce"
    process = {"pid": 999999, "root_pid": 999999, "root_start_time": 1.0}
    config = {
        "roots": {"browser_use_home": str(home), "temporary_profiles": str(profile_root), "locks": str(locks), "receipts": str(receipts), "recordings": str(recordings), "downloads": str(downloads)},
        "ports": {"temporary_start": 20080, "temporary_end": 20099},
        "executables": {"chrome": {"canonical_path": "/bin/false"}},
    }
    profile_lock = os.path.realpath(h.temporary_profile_lock_path(config, str(profile)))
    port_lock = os.path.realpath(h.temporary_port_lock_path(config, port))
    lock_value = {"schema": "browser-use-lock.v1", "run_id": source_run, "nonce": source_nonce, "canonical_profile": str(profile), "port": port}
    write_json(profile_lock, lock_value); write_json(port_lock, lock_value)
    source = {
        "schema": h.HANDOFF_SCHEMA, "status": "continued", "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": source_run, "session": source_session, "requested_session": source_session, "automation_id": "manual", "task_id": source_task,
        "nonce": source_nonce, "authority_sha256": "b" * 64, "origin": "https://example.com", "profile": str(profile),
        "profile_hash": "c" * 64, "profile_marker_sha256": "d" * 64, "port": port, "daemon_session": source_session,
        "process": process, "lock_paths": [profile_lock, port_lock], "lease_path": str(source_path), "download_dir": str(download_dir),
        "creation_binding": "a" * 64, "authority_scope": {"approval": "approved"}, "room_id": "room-source-task",
        "expires_at": "2099-01-01T00:00:00Z",
    }
    descriptor = {
        "schema": h.RECORDING_SCHEMA, "status": "continued", "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": "destination-run", "session": "destination-session", "source_run_id": source_run, "source_session": source_session,
        "source_handoff_descriptor": str(source_path), "automation_id": "manual", "task_id": "stale-task", "nonce": "recording-nonce",
        "profile": str(root / "stale-profile"), "port": 20086, "process": {"root_pid": 1, "root_start_time": 0.0}, "owned_chrome": False,
        "room_id": "room-stale", "status_path": str(status_path), "recording_dir": str(recording_dir), "download_dir": str(download_dir),
        "operations": ["state"],
    }
    room = {"room_id": "room-source-task", "lifecycle": h.TEMPORARY_LIFECYCLE, "state": "active", "owner": {"kind": "task", "id": source_task}, "task_id": source_task, "profile": str(profile), "port": port, "lease_digest": __import__("hashlib").sha256(source_run.encode()).hexdigest()}
    return root, config, source_path, source, descriptor, room, profile, profile_lock, port_lock

def run_cleanup(values, *, validate=False, listener=None, daemon=False, room=None, receipt=None):
    root, config, source_path, source, descriptor, expected_room, profile, profile_lock, port_lock = values
    runtime_root = root / "harness" / source["session"] / "runtime"
    if daemon:
        runtime_root.mkdir(mode=0o700, parents=True); (runtime_root / "bu.pid").write_text("0", encoding="utf-8")
    if receipt is not None:
        receipt_path = h.recording_cleanup_receipt_path(config, dict(descriptor, run_id=source["run_id"], session=source["session"]))
        write_json(receipt_path, receipt)
    calls = []
    def release(path, run_id, nonce):
        calls.append(("lock", os.path.realpath(path)))
        return original_release(path, run_id, nonce)
    def release_room(*args, **kwargs):
        calls.append(("room", kwargs.get("run_id")))
        return {"room_id": expected_room["room_id"], "state": "released"}
    original_release = h.release_lock
    room_value = expected_room if room is None else room
    patches = [
        patch.object(h, "read_handoff", return_value=source),
        patch.object(h, "validate_handoff_process_identity", return_value=validate),
        patch.object(h, "assert_debug_listener_absent", side_effect=listener),
        patch.object(h, "browser_harness_root", return_value=str(root / "harness" / source["session"])),
        patch.object(h, "room_registry_read", return_value={"rooms": [room_value]}),
        patch.object(h, "room_registry_release", side_effect=release_room),
        patch.object(h, "release_lock", side_effect=release),
        patch.object(h, "update_handoff"),
        patch.object(h, "mark_recording_abandoned"),
        patch.object(h, "_write_recording_descriptor"),
        patch.object(h, "pending_operation_reconciliation_ids", return_value=[]),
        patch.object(h, "operation_effect_summary", return_value="none"),
    ]
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7], patches[8], patches[9], patches[10], patches[11]:
        try:
            result = h.cleanup_borrowed_handoff_recording_descriptor(config, {"helper": "versions"}, descriptor, str(root / "descriptor.json"))
            return result, calls, None
        except h.Blocker as exc:
            return None, calls, exc.code

with tempfile.TemporaryDirectory() as _unused:
    values = fixture("success")
    result, calls, blocker = run_cleanup(values)
    assert blocker is None, blocker
    assert result["status"] == "recording_cleanup_completed"
    descriptor = values[4]; source = values[3]
    assert descriptor["run_id"] == source["run_id"] and descriptor["session"] == source["session"]
    assert descriptor["task_id"] == source["task_id"] and descriptor["room_id"] == source["room_id"]
    assert descriptor["profile"] == source["profile"] and descriptor["port"] == source["port"] and descriptor["process"] == source["process"]
    assert calls[-1] == ("room", source["run_id"]), calls
    assert {item[1] for item in calls[:2]} == {values[7], values[8]}, calls
    assert not pathlib.Path(values[7]).exists() and not pathlib.Path(values[8]).exists()
    assert values[6].is_dir(), "profile must be preserved without delete approval"
    receipt = json.loads(pathlib.Path(result["cleanup_receipt"]).read_text())
    assert receipt["kind"] == "continued_handoff_recording_cleanup"
    assert receipt["source_handoff_descriptor"] == str(values[2])
    assert receipt["run_id"] == source["run_id"] and receipt["session"] == source["session"]
    assert receipt["task_id"] == source["task_id"] and receipt["room_id"] == source["room_id"]
    assert receipt["profile"] == source["profile"] and receipt["port"] == source["port"] and receipt["process"] == source["process"]
print("success/profile/receipt binding ok")

values = fixture("profile-already-removed")
values[6].rmdir()
values[3]["cleanup_state"] = {
    "profile_removed": True,
    "temporary_profile_removed": True,
    "uncertain": True,
    "locks_retained": [values[7], values[8]],
}
result, calls, blocker = run_cleanup(values)
assert blocker is None, blocker
assert result["cleanup"]["profile_preserved"] is False
assert result["cleanup"]["profile_removed"] is True
assert result["cleanup"]["profile_missing"] is True
assert not pathlib.Path(values[7]).exists() and not pathlib.Path(values[8]).exists()
print("already-removed profile reconciled without recreation ok")

for label, expected in (("live-process", "browser_use_recording_cleanup_process_still_live"), ("live-listener", "browser_use_listener_remains_after_cleanup"), ("live-daemon", "browser_use_recording_daemon_still_present")):
    values = fixture(label)
    listener = None
    validate = False
    daemon = False
    if label == "live-process": validate = True
    if label == "live-listener": listener = (lambda *args: (_ for _ in ()).throw(h.Blocker(expected)))
    if label == "live-daemon": daemon = True
    _, _, blocker = run_cleanup(values, validate=validate, listener=listener, daemon=daemon)
    assert blocker == expected, (label, blocker, expected)
    assert pathlib.Path(values[7]).exists() and pathlib.Path(values[8]).exists(), label
print("live process/listener/daemon fail-closed ok")

values = fixture("foreign-lock")
foreign = json.loads(pathlib.Path(values[8]).read_text()); foreign["run_id"] = "foreign-run"; write_json(values[8], foreign)
_, _, blocker = run_cleanup(values)
assert blocker == "browser_use_recording_recovery_foreign_lock", blocker
assert pathlib.Path(values[7]).exists() and pathlib.Path(values[8]).exists()

values = fixture("foreign-room")
foreign_room = dict(values[5], lease_digest="f" * 64)
_, _, blocker = run_cleanup(values, room=foreign_room)
assert blocker == "browser_use_recording_handoff_room_binding_mismatch", blocker
assert pathlib.Path(values[7]).exists() and pathlib.Path(values[8]).exists()
print("foreign/mismatch fail-closed ok")

values = fixture("receipt")
wrong = {"schema": h.RECORDING_CLEANUP_RECEIPT_SCHEMA, "kind": "continued_handoff_recording_cleanup", "descriptor": "wrong", "source_handoff_descriptor": str(values[2]), "run_id": values[3]["run_id"], "session": values[3]["session"], "task_id": values[3]["task_id"], "room_id": values[3]["room_id"], "profile": "wrong", "port": values[3]["port"], "process": values[3]["process"], "source_nonce": values[3]["nonce"], "nonce": values[4]["nonce"], "process_absent": True, "listener_absent": True, "daemon_absent": True}
_, _, blocker = run_cleanup(values, receipt=wrong)
assert blocker == "browser_use_recording_cleanup_receipt_binding_mismatch", blocker
assert pathlib.Path(values[7]).exists() and pathlib.Path(values[8]).exists()
print("receipt mismatch fail-closed ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.match(result.stdout, /success\/profile\/receipt binding ok/);
  assert.match(result.stdout, /live process\/listener\/daemon fail-closed ok/);
  assert.match(result.stdout, /foreign\/mismatch fail-closed ok/);
  assert.match(result.stdout, /receipt mismatch fail-closed ok/);
});

test("record-finalize cleanup-only routes continued borrowed handoffs before browser commands", () => {
  const script = String.raw`
import argparse, builtins, importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_cleanup_route", SourceFileLoader("codex_browser_use_cleanup_route", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp).resolve()
    source = root / "source.json"; source.write_text("{}", encoding="utf-8")
    descriptor_path = root / "descriptor.json"
    descriptor = {"status": "continued", "owned_chrome": False, "lifecycle": h.TEMPORARY_LIFECYCLE, "mode": "authorized", "task_id": "old-task", "source_handoff_descriptor": str(source), "run_id": "old-run", "session": "old-session"}
    args = argparse.Namespace(run_id="old-run", session="old-session", descriptor=str(descriptor_path), authority=str(root / "authority.json"), authority_renewal=None, task_id="source-task", cleanup_only=True, delete_approved=False, user_ok=False)
    calls = []
    def rebind(_config, value):
        calls.append("rebind"); value.update({"status": "cleanup_pending", "run_id": "source-run", "session": "source-session", "task_id": "source-task"}); return str(source), value
    cleanup = {"cleanup_receipt": str(root / "cleanup.json"), "cleanup": {}, "pending_reconciliation": [], "external_effects": "none"}
    def finish(*_args): calls.append("cleanup"); return cleanup
    config = {"roots": {"browser_use_home": str(root)}}
    with patch.object(h, "read_toml", return_value=config), \
         patch.object(h, "validate_installation", return_value={}), \
         patch.object(h, "validate_recording_tools", return_value={}), \
         patch.object(h, "read_recording_descriptor", return_value=descriptor), \
         patch.object(h, "_rebind_borrowed_handoff_recording_descriptor", side_effect=rebind), \
         patch.object(h, "require_temporary_task_id"), \
         patch.object(h, "recording_authority", return_value=None), \
         patch.object(h, "cleanup_borrowed_handoff_recording_descriptor", side_effect=finish), \
         patch.object(builtins, "print") as output:
        assert h.record_finalize(args) == 0
    assert calls == ["rebind", "cleanup"], calls
    payload = json.loads(output.call_args.args[0])
    assert payload["cleanup_reconciled"] is True and payload["finalized"] is False
print("record-finalize route ok")

`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.match(result.stdout, /record-finalize route ok/);
});

test("descriptor validation accepts only an explicitly removed borrowed profile", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_missing_profile_validation", SourceFileLoader("codex_browser_use_missing_profile_validation", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp).resolve()
    recording_dir = root / "recordings" / "old-run"
    recording_dir.mkdir(mode=0o700, parents=True)
    descriptor_path = recording_dir / "old-session-n.json"
    source_path = root / "handoff.json.consumed"
    source_path.write_text("{}", encoding="utf-8")
    profile = root / "temporary" / ("a" * 64)
    source = {
        "lifecycle": h.TEMPORARY_LIFECYCLE, "mode": "authorized", "run_id": "source-run", "session": "source-session",
        "profile": str(profile), "cleanup_state": {"profile_removed": True, "temporary_profile_removed": True},
    }
    status_path = recording_dir / ".recording-status.json"
    status_path.write_text("{}", encoding="utf-8")
    status_path.chmod(0o600)
    descriptor = {
        "schema": h.RECORDING_SCHEMA, "status": "continued", "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": "old-run", "session": "old-session", "automation_id": "manual", "nonce": "n", "helper_sha256": "0" * 64,
        "recording_dir": str(recording_dir), "status_path": str(status_path), "recording_framerate": 1, "port": 20085,
        "process": {"root_pid": 1, "root_start_time": 0.0}, "owned_chrome": False, "profile": str(profile), "download_dir": str(root / "downloads"),
        "lock_paths": [], "target_origins": ["https://example.com"], "authority_sha256": "1" * 64, "account_identity": "interactive_user",
        "operations": [], "task_id": "old-task", "creation_binding": "2" * 64, "authority_scope": {},
        "source_handoff_descriptor": str(source_path), "source_run_id": "source-run", "source_session": "source-session",
        "room_id": "room-source", "profile_owner_task_id": "source-task",
    }
    descriptor_path.write_text(json.dumps(descriptor), encoding="utf-8")
    descriptor_path.chmod(0o600)
    config = {"roots": {"browser_use_home": str(root), "temporary_profiles": str(root / "temporary"), "recordings": str(root / "recordings")}}
    room = {"profile": str(profile), "port": 20085}
    with patch.object(h, "read_handoff", return_value=source), \
         patch.object(h, "room_registry_lookup", return_value=room), \
         patch.object(h, "temporary_profile_path", return_value=str(profile)), \
         patch.object(h, "recording_status_path", return_value=str(status_path)), \
         patch.object(h, "sha256_trusted_helper", return_value="0" * 64), \
         patch.object(h, "assert_recording_descriptor_path"), \
         patch.object(h, "canonical_session_id", return_value="old-session"):
        result = h.read_recording_descriptor(config, str(descriptor_path), "old-run", "old-session", allow_helper_hash_mismatch=True, allow_expired_temporary=True, allow_stale_runtime_recovery=True)
    assert result["profile"] == str(profile)
print("missing-profile descriptor validation ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.match(result.stdout, /missing-profile descriptor validation ok/);
});

test("history reconciliation publishes an append-only terminal receipt", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_reconciled_receipt", SourceFileLoader("codex_browser_use_reconciled_receipt", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp).resolve()
    receipts = root / "receipts" / "run-1"
    receipts.mkdir(mode=0o700, parents=True)
    config = {"roots": {"receipts": str(root / "receipts"), "browser_use_home": str(root / "home")}}
    base = receipts / "session-1.json"
    original = {
        "schema": "browser-use-receipt.v1", "run_id": "run-1", "session": "session",
        "finalized": False, "completion_status": "blocked",
        "completion_blocker": "browser_use_external_effects_unknown",
    }
    base.write_text(json.dumps(original), encoding="utf-8"); base.chmod(0o600)
    ctx = {
        "mode": "authorized", "lifecycle": "scheduled", "run_id": "run-1", "session": "session",
        "nonce": "1", "automation_id": "job", "process": {}, "target_origins": [],
        "external_effects": "executed", "completion_status": "completed", "completion_blocker": None,
        "reconciliation_state": "completed", "pending_reconciliation": [], "cleanup": {},
    }
    path = h.finalized_receipt(config, {}, ctx, None)
    assert path.endswith("session-1-reconciled.json"), path
    assert json.loads(base.read_text(encoding="utf-8"))["finalized"] is False
    terminal = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    assert terminal["finalized"] is True
    assert terminal["reconciliation_upgrade"]["prior_receipt_path"] == str(base)
print("append-only reconciled receipt ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.match(result.stdout, /append-only reconciled receipt ok/);
});
