import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("temporary descriptorless startup reconciliation is owner-bound and fail-closed", () => {
  const script = String.raw`
import argparse, hashlib, importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_temporary_startup", SourceFileLoader("codex_browser_use_temporary_startup", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def fixture(base, *, profile_exists=True, room_state="released"):
    root = pathlib.Path(base).resolve()
    home = root / "home"; profile_root = home / "profiles" / "temporary"; locks = home / "locks"; receipts = home / "receipts"; downloads = home / "downloads"
    for item in (profile_root, locks, receipts, downloads): item.mkdir(mode=0o700, parents=True)
    run_id, task_id, session, room_id, port = "run-temporary-reconcile", "task-temporary-reconcile", "session-temporary-reconcile", "room-temporary-reconcile", 20086
    profile = (profile_root / ("a" * 64)).resolve(); nonce = "b" * 64
    config = {"roots": {"browser_use_home": str(home), "temporary_profiles": str(profile_root), "locks": str(locks), "receipts": str(receipts), "downloads": str(downloads)}, "ports": {"temporary_start": 20080, "temporary_end": 20099}, "executables": {"chrome": {"canonical_path": "/bin/false"}}}
    profile_lock = pathlib.Path(h.temporary_profile_lock_path(config, str(profile))); port_lock = pathlib.Path(h.temporary_port_lock_path(config, port))
    payload = {"schema": "browser-use-lock.v1", "run_id": run_id, "nonce": nonce, "helper_pid": 0, "helper_start_time": 0, "automation_id": "probe", "task_id": task_id, "port": port, "canonical_profile": str(profile), "lifecycle": "temporary"}
    h.lock_file(str(profile_lock), payload); h.lock_file(str(port_lock), payload)
    if profile_exists:
        profile.mkdir(mode=0o700, parents=True)
        h.json_atomic_no_replace(str(profile / ".browser-use-profile.json"), {"schema": h.TEMPORARY_PROFILE_MARKER_SCHEMA, "lifecycle": "temporary", "run_id": run_id, "task_id": task_id, "canonical_profile": str(profile), "port": port, "profile_lock_path": str(profile_lock.resolve()), "port_lock_path": str(port_lock.resolve())})
    room = {"room_id": room_id, "lifecycle": "temporary", "state": room_state, "owner": {"kind": "task", "id": task_id}, "task_id": task_id, "automation_id": None, "profile": str(profile), "port": port, "created_at": "2026-08-04T00:00:00Z", "updated_at": "2026-08-04T00:00:00Z", "last_activity_at": "2026-08-04T00:00:00Z", "current_activity": "failed-startup", "activity": [], "lease_digest": hashlib.sha256(run_id.encode()).hexdigest()}
    h.json_atomic_replace(str(home / h.ROOM_REGISTRY_FILENAME), {"schema": h.ROOM_REGISTRY_SCHEMA, "version": 1, "rooms": [room], "created_at": "2026-08-04T00:00:00Z", "updated_at": "2026-08-04T00:00:00Z"})
    args = argparse.Namespace(run_id=run_id, session=session, task_id=task_id, room_id=room_id, profile=str(profile), port=port)
    return config, args, profile_lock, port_lock, profile, home

def prepare(base, **kwargs):
    values = fixture(base, **kwargs)
    h.validate_installation = lambda _config: {}
    h.verify_chrome_absent = lambda _chrome, _port, _profile: None
    h.browser_harness_root = lambda session: str(values[-1] / "harness" / session)
    return values

def blocked(fn, code):
    try: fn()
    except h.Blocker as exc:
        assert exc.code == code, (exc.code, code); return
    raise AssertionError("expected " + code)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp)
    parsed = h.build_parser().parse_args(["reconcile-failed-temporary-startup", "--run-id", "r", "--session", "s", "--task-id", "t", "--room-id", "room-r", "--profile", "/tmp/p", "--port", "20086"])
    assert parsed.action == "reconcile-failed-temporary-startup"
    stop_parsed = h.build_parser().parse_args(["record-stop-preserve-temporary", "--run-id", "r", "--session", "s", "--task-id", "t", "--descriptor", "/tmp/d.json", "--authority", "/tmp/a.json"])
    assert stop_parsed.action == "record-stop-preserve-temporary"

    config, args, profile_lock, port_lock, profile, home = prepare(base / "success")
    order = []; original_release, original_room, original_receipt = h.release_lock, h.room_registry_release, h.json_atomic_no_replace
    def release(path, run_id, nonce):
        if os.path.realpath(path) in {os.path.realpath(profile_lock), os.path.realpath(port_lock)}: order.append("lock")
        return original_release(path, run_id, nonce)
    def room(*values, **kwargs): order.append("room"); return original_room(*values, **kwargs)
    def receipt(path, value):
        if path.endswith("temporary-startup-reconciliation-" + "b" * 64 + ".json"): order.append("receipt")
        return original_receipt(path, value)
    h.release_lock, h.room_registry_release, h.json_atomic_no_replace = release, room, receipt
    assert h.reconcile_temporary_startup(args, config) == 0
    assert order == ["lock", "lock", "room", "receipt"], order
    assert not profile_lock.exists() and not port_lock.exists() and profile.is_dir() and (profile / ".browser-use-profile.json").is_file()
    receipt_path = home / "receipts" / (args.run_id + "-temporary-startup-reconciliation-" + "b" * 64 + ".json")
    receipt = json.loads(receipt_path.read_text())
    assert receipt["run_id"] == args.run_id and receipt["room_id"] == args.room_id and receipt["profile"] == str(profile) and receipt["port"] == args.port
    assert receipt["profile_preserved"] is True and receipt["external_effects"] == "none"

    config, args, profile_lock, port_lock, profile, home = prepare(base / "foreign")
    foreign = json.loads(port_lock.read_text()); foreign["run_id"] = "other-run"; port_lock.write_text(json.dumps(foreign), encoding="utf-8")
    blocked(lambda: h.reconcile_temporary_startup(args, config), "browser_use_temporary_startup_lock_binding_mismatch")
    assert profile_lock.exists() and port_lock.exists()

    config, args, profile_lock, port_lock, profile, home = prepare(base / "partial")
    port_lock.unlink()
    blocked(lambda: h.reconcile_temporary_startup(args, config), "browser_use_temporary_startup_lock_set_incomplete")
    assert profile_lock.exists()

    config, args, profile_lock, port_lock, profile, home = prepare(base / "owner")
    registry_path = home / h.ROOM_REGISTRY_FILENAME; registry = json.loads(registry_path.read_text()); registry["rooms"][0]["lease_digest"] = "c" * 64; registry_path.write_text(json.dumps(registry), encoding="utf-8")
    blocked(lambda: h.reconcile_temporary_startup(args, config), "browser_use_temporary_startup_room_owner_conflict")
    assert profile_lock.exists() and port_lock.exists()

    for name, code in (("pid", "browser_use_chrome_process_cleanup_unverified"), ("listener", "browser_use_listener_remains_after_cleanup")):
        config, args, profile_lock, port_lock, profile, home = prepare(base / name)
        h.verify_chrome_absent = lambda _chrome, _port, _profile, blocker=code: (_ for _ in ()).throw(h.Blocker(blocker))
        blocked(lambda: h.reconcile_temporary_startup(args, config), code)
        assert profile_lock.exists() and port_lock.exists()
        h.verify_chrome_absent = lambda _chrome, _port, _profile: None

    config, args, profile_lock, port_lock, profile, home = prepare(base / "daemon")
    runtime = home / "harness" / args.session / "runtime"; runtime.mkdir(mode=0o700, parents=True); (runtime / "bu.pid").write_text("0", encoding="utf-8")
    blocked(lambda: h.reconcile_temporary_startup(args, config), "browser_use_temporary_startup_harness_daemon_present")
    assert profile_lock.exists() and port_lock.exists()

    config, args, profile_lock, port_lock, profile, home = prepare(base / "receipt")
    receipt_path = home / "receipts" / (args.run_id + "-temporary-startup-reconciliation-" + "b" * 64 + ".json")
    receipt_path.write_text(json.dumps({"schema": "wrong", "run_id": args.run_id}), encoding="utf-8"); receipt_path.chmod(0o600)
    blocked(lambda: h.reconcile_temporary_startup(args, config), "browser_use_temporary_startup_receipt_binding_mismatch")
    assert profile_lock.exists() and port_lock.exists()

print("ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.match(result.stdout, /ok/);
});
