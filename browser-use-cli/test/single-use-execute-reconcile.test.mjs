import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("descriptorless public one-shot cleanup is exact-owner and fail-closed", () => {
  const script = String.raw`
import argparse, hashlib, importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_single_use_reconcile", SourceFileLoader("codex_browser_use_single_use_reconcile", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def fixture(base):
    root = pathlib.Path(base).resolve()
    home = root / "home"; profile_root = home / "profiles" / "single-use"; locks = home / "locks"; receipts = home / "receipts"; quarantine = home / "quarantine"; downloads = home / "downloads"
    for item in (profile_root, locks, receipts, quarantine, downloads): item.mkdir(mode=0o700, parents=True)
    run_id, session, room_id, port = "run-single-use-reconcile", "session-single-use-reconcile", "room-single-use-reconcile", 19997
    profile = (profile_root / room_id).resolve(); nonce = "b" * 32
    profile.mkdir(mode=0o700, parents=True)
    h.json_atomic_no_replace(str(profile / ".browser-use-profile.json"), {"schema": "browser-use-profile.v1", "run_id": run_id, "nonce": nonce})
    config = {"roots": {"browser_use_home": str(home), "single_use_profiles": str(profile_root), "locks": str(locks), "receipts": str(receipts), "quarantine": str(quarantine), "downloads": str(downloads)}, "ports": {"single_use_start": 19980, "single_use_end": 19999}, "limits": {"quarantine_ttl_seconds": 86400}, "executables": {"chrome": {"canonical_path": "/bin/false"}}}
    profile_lock = pathlib.Path(locks / ("profile-" + hashlib.sha256(str(profile).encode()).hexdigest()[:24] + ".lock")); port_lock = pathlib.Path(locks / "port-19997.lock")
    payload = {"schema": "browser-use-lock.v1", "run_id": run_id, "nonce": nonce, "canonical_profile": str(profile), "port": port, "helper_pid": 0, "helper_start_time": 0}
    h.lock_file(str(profile_lock), payload); h.lock_file(str(port_lock), payload)
    room = {"room_id": room_id, "lifecycle": "single-use", "state": "active", "owner": {"kind": "task", "id": run_id}, "task_id": run_id, "profile": str(profile), "port": port, "lease_digest": hashlib.sha256(run_id.encode()).hexdigest(), "activity": [], "created_at": "2026-08-04T00:00:00Z", "updated_at": "2026-08-04T00:00:00Z", "last_activity_at": "2026-08-04T00:00:00Z", "current_activity": "execute-open"}
    h.json_atomic_replace(str(home / h.ROOM_REGISTRY_FILENAME), {"schema": h.ROOM_REGISTRY_SCHEMA, "version": 1, "rooms": [room], "created_at": "2026-08-04T00:00:00Z", "updated_at": "2026-08-04T00:00:00Z"})
    args = argparse.Namespace(run_id=run_id, session=session, room_id=room_id, profile=str(profile), port=port)
    return config, args, profile_lock, port_lock, profile, quarantine, home

def blocked(fn, code):
    try: fn()
    except h.Blocker as exc:
        assert exc.code == code, (exc.code, code); return
    raise AssertionError("expected " + code)

with tempfile.TemporaryDirectory() as temp:
    parsed = h.build_parser().parse_args(["reconcile-failed-single-use-execute", "--run-id", "r", "--session", "s", "--room-id", "room-r", "--profile", "/tmp/p", "--port", "19997"])
    assert parsed.action == "reconcile-failed-single-use-execute"
    h.validate_installation = lambda _config: {}
    config, args, profile_lock, port_lock, profile, quarantine, home = fixture(pathlib.Path(temp) / "success")
    assert h.reconcile_failed_single_use_execute(args, config) == 0
    assert not profile_lock.exists() and not port_lock.exists() and not profile.exists()
    assert (quarantine / profile.name / ".quarantine.json").is_file()
    room = json.loads((home / h.ROOM_REGISTRY_FILENAME).read_text())["rooms"][0]
    assert room["state"] == "released"

    config, args, profile_lock, port_lock, profile, quarantine, home = fixture(pathlib.Path(temp) / "foreign")
    value = json.loads(port_lock.read_text()); value["run_id"] = "other-run"; port_lock.write_text(json.dumps(value), encoding="utf-8")
    blocked(lambda: h.reconcile_failed_single_use_execute(args, config), "browser_use_single_use_execute_lock_owner_conflict")
    assert profile_lock.exists() and port_lock.exists() and profile.exists()

    config, args, profile_lock, port_lock, profile, quarantine, home = fixture(pathlib.Path(temp) / "room")
    registry = json.loads((home / h.ROOM_REGISTRY_FILENAME).read_text()); registry["rooms"][0]["owner"]["id"] = "other-run"; (home / h.ROOM_REGISTRY_FILENAME).write_text(json.dumps(registry), encoding="utf-8")
    blocked(lambda: h.reconcile_failed_single_use_execute(args, config), "browser_use_single_use_execute_room_owner_conflict")
    assert profile_lock.exists() and port_lock.exists() and profile.exists()

print("ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.match(result.stdout, /ok/);
});
