import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("stale scheduled room release is owner-bound and requires positive absence readback", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

spec = importlib.util.spec_from_loader("codex_browser_use_stale_room_release", SourceFileLoader("codex_browser_use_stale_room_release", os.environ["HELPER_PATH"]))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    roots = {name: str(base / name) for name in ("browser_use_home", "scheduled_profiles", "single_use_profiles", "temporary_profiles", "receipts", "locks", "quarantine", "downloads", "logs", "recordings")}
    for value in roots.values(): pathlib.Path(value).mkdir(mode=0o700, parents=True, exist_ok=True)
    config = {"roots": roots, "ports": {"scheduled_start": 19880, "scheduled_end": 19899, "single_use_start": 19980, "single_use_end": 19999, "temporary_start": 20080, "temporary_end": 20099, "max_parallel": 20}}
    owner = "daily-ai-research-publish-run"
    with patch.object(h, "port_listener", return_value=False), patch.object(h, "lsof_listener", return_value=False):
        claimed = h.room_registry_claim(config, lifecycle="scheduled", run_id="old-scheduled-run", automation_id=owner, port=19880)
        h.room_registry_update(config, claimed["room_id"], run_id="old-scheduled-run", state="held", activity="held")
    profile_lock = pathlib.Path(config["roots"]["locks"]) / ("profile-" + __import__("hashlib").sha256(claimed["profile"].encode()).hexdigest()[:24] + ".lock")
    profile_lock.write_text(json.dumps({
        "schema": "browser-use-lock.v1", "run_id": "old-lock-run", "nonce": "old-lock-nonce",
        "canonical_profile": claimed["profile"], "port": 19880,
        "helper_pid": 999999, "helper_start_time": 1.0,
    }), encoding="utf-8")
    profile_lock.chmod(0o600)
    observation = [{"room_id": claimed["room_id"], "profile": claimed["profile"], "port": 19880, "listener_observed": False, "process_observed": False, "daemon_observed": False}]
    try:
        h.room_registry_release_stale(config, claimed["room_id"], run_id="foreign-owner")
    except h.Blocker as exc:
        assert exc.code == "browser_use_room_registry_owner_conflict"
    else:
        raise AssertionError("foreign stale-room release was accepted")
    with patch.object(h, "room_registry_observations", return_value=observation):
        released = h.room_registry_release_stale(config, claimed["room_id"], run_id=owner)
    assert released["state"] == "released"
    assert str(profile_lock) in released["locks_removed"]
    assert not profile_lock.exists()
    assert h.room_registry_lookup(config, claimed["room_id"])["state"] == "released"

assert h.build_parser().parse_args(["room-reconcile-stale-release", "--room-id", "room-test", "--run-id", "owner"]).action == "room-reconcile-stale-release"
print("stale room release proof ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /stale room release proof ok/);
});

test("stale temporary room release uses the temporary lock and closes its shared lease", () => {
  const script = String.raw`
import hashlib, importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

spec = importlib.util.spec_from_loader("codex_browser_use_stale_temporary_room_release", SourceFileLoader("codex_browser_use_stale_temporary_room_release", os.environ["HELPER_PATH"]))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    roots = {name: str(base / name) for name in ("browser_use_home", "scheduled_profiles", "single_use_profiles", "temporary_profiles", "receipts", "locks", "quarantine", "downloads", "logs", "recordings")}
    for value in roots.values(): pathlib.Path(value).mkdir(mode=0o700, parents=True, exist_ok=True)
    config = {"roots": roots, "ports": {"scheduled_start": 19880, "scheduled_end": 19899, "single_use_start": 19980, "single_use_end": 19999, "temporary_start": 20080, "temporary_end": 20099, "max_parallel": 20}}
    profile = pathlib.Path(roots["temporary_profiles"]) / ("a" * 64)
    profile.mkdir(mode=0o700)
    owner_task = "temporary-owner-task"
    run_id = "temporary-owner-run"
    session = "temporary-owner-session"
    port = 20080
    with patch.object(h, "port_listener", return_value=False), patch.object(h, "lsof_listener", return_value=False):
        claimed = h.room_registry_claim(config, lifecycle="temporary", run_id=run_id, profile=str(profile), port=port, task_id=owner_task, automation_id="manual")
        h.room_registry_update(config, claimed["room_id"], run_id=run_id, state="held", activity="held")
    lease_id = "b" * 32
    nonce = lease_id
    profile_lock = pathlib.Path(h.temporary_profile_lock_path(config, str(profile)))
    port_lock = pathlib.Path(h.temporary_port_lock_path(config, port))
    lock_payload = {"schema": "browser-use-lock.v1", "run_id": run_id, "nonce": nonce, "task_id": owner_task, "shared_profile_lease_id": lease_id, "canonical_profile": str(profile), "port": port, "helper_pid": 999999, "helper_start_time": 1.0}
    for lock in (profile_lock, port_lock):
        lock.write_text(json.dumps(lock_payload), encoding="utf-8")
        lock.chmod(0o600)
    shared_root = pathlib.Path(h.shared_profile_lease_root(config))
    shared_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    lease_path = shared_root / f"{lease_id}.json"
    lease_path.write_text(json.dumps({"schema": h.SHARED_PROFILE_LEASE_SCHEMA, "version": 1, "state": "claimed", "lease_id": lease_id, "run_id": run_id, "session": session, "task_id": owner_task, "profile": str(profile), "port": port, "room_id": claimed["room_id"], "lock_paths": [str(profile_lock), str(port_lock)], "nonce": nonce, "external_effects": "none"}), encoding="utf-8")
    lease_path.chmod(0o600)
    observation = [{"room_id": claimed["room_id"], "profile": str(profile), "port": port, "listener_observed": False, "process_observed": False, "daemon_observed": False}]
    with patch.object(h, "room_registry_observations", return_value=observation):
        released = h.room_registry_release_stale(config, claimed["room_id"], run_id=owner_task)
    assert released["state"] == "released"
    assert released["shared_profile_lease_released"] is True
    assert not profile_lock.exists()
    assert not port_lock.exists()
    assert json.loads(lease_path.read_text(encoding="utf-8"))["state"] == "released"

print("stale temporary room/shared lease proof ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /stale temporary room\/shared lease proof ok/);
});

test("admin room release requires approval, owner match, and deletes only the exact profile", () => {
  const script = String.raw`
import importlib.util, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

spec = importlib.util.spec_from_loader("codex_browser_use_admin_room_release", SourceFileLoader("codex_browser_use_admin_room_release", os.environ["HELPER_PATH"]))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    roots = {name: str(base / name) for name in ("browser_use_home", "scheduled_profiles", "single_use_profiles", "temporary_profiles", "receipts", "locks", "quarantine", "downloads", "logs", "recordings")}
    for value in roots.values(): pathlib.Path(value).mkdir(mode=0o700, parents=True, exist_ok=True)
    config = {"roots": roots, "ports": {"scheduled_start": 19880, "scheduled_end": 19899, "single_use_start": 19980, "single_use_end": 19999, "temporary_start": 20080, "temporary_end": 20099, "max_parallel": 20}}
    owner = "codex-server-zeabur-chatgpt-auth-v3"
    with patch.object(h, "port_listener", return_value=False), patch.object(h, "lsof_listener", return_value=False):
        claimed = h.room_registry_claim(config, lifecycle="scheduled", run_id="unrecoverable-lease", automation_id=owner, port=19888)
        h.room_registry_update(config, claimed["room_id"], run_id="unrecoverable-lease", state="held", activity="held")
    pathlib.Path(claimed["profile"]).mkdir(mode=0o700, parents=True, exist_ok=True)
    with patch.object(h, "_room_registry_owner_reuse_absence_readback", return_value=None):
        try:
            h.room_registry_admin_release(config, claimed["room_id"], owner_id="foreign-owner", delete_approved=True, delete_profile=True)
        except h.Blocker as exc:
            assert exc.code == "browser_use_room_registry_owner_conflict"
        else:
            raise AssertionError("foreign admin release was accepted")
        released = h.room_registry_admin_release(config, claimed["room_id"], owner_id=owner, delete_approved=True, delete_profile=True)
    assert released["state"] == "released"
    assert released["profile_deleted"] is True
    assert not pathlib.Path(claimed["profile"]).exists()

assert h.build_parser().parse_args(["room-admin-release", "--room-id", "room-test", "--owner-id", "owner", "--delete-approved", "--delete-profile"]).action == "room-admin-release"
print("admin room release proof ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /admin room release proof ok/);
});
