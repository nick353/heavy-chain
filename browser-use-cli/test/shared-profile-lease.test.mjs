import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("cross-session shared profile lease is exclusive, identity-bound, and profile-preserving", () => {
  const script = String.raw`
import argparse, importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_shared_profile", SourceFileLoader("codex_browser_use_shared_profile", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def authority(account):
    return {"account_identity": account, "allowed_origins": ["https://x.example"], "expires_at": h.iso(h.now_utc() + h.dt.timedelta(minutes=10)), "data_exposure": "authenticated", "side_effect_scope": "none", "approval": "approved", "readback_required": True}

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp).resolve()
    roots = {name: str(root / name) for name in ("browser_use_home", "scheduled_profiles", "single_use_profiles", "temporary_profiles", "receipts", "locks", "downloads", "recordings", "logs", "quarantine")}
    for value in roots.values(): pathlib.Path(value).mkdir(mode=0o700, parents=True)
    config = {"roots": roots, "ports": {"scheduled_start": 19880, "scheduled_end": 19899, "single_use_start": 19980, "single_use_end": 19999, "temporary_start": 20080, "temporary_end": 20099}}
    scope = {"data_exposure": "authenticated", "side_effect_scope": "none", "approval": "approved", "readback_required": True}
    info = h.prepare_temporary_profile(config, mode="authorized", automation_id="manual", task_id="source-task", run_id="source-run", authority_digest="a" * 64, authority_scope=scope, account_identity="account-x", origins=["https://x.example"], download_dir=str(root / "downloads" / "source"))
    h.release_lock(info["profile_lock"], "source-run", info["binding"])
    h.mark_temporary_profile_shareable(config, {"mode": "authorized", "lifecycle": "temporary", "profile": info["profile"]})
    first_availability = json.loads(pathlib.Path(info["profile"], h.SHARED_PROFILE_AVAILABILITY_FILENAME).read_text())
    h.mark_temporary_profile_shareable(config, {"mode": "authorized", "lifecycle": "temporary", "profile": info["profile"]})
    second_availability = json.loads(pathlib.Path(info["profile"], h.SHARED_PROFILE_AVAILABILITY_FILENAME).read_text())
    assert second_availability == first_availability
    assert pathlib.Path(info["profile"]).exists()

    args = argparse.Namespace(run_id="borrow-run", session="borrow-session", task_id="borrow-task", automation_id="manual", authority="authority.json", origin=None)
    with patch.object(h, "read_toml", return_value=config), patch.object(h, "validate_installation", return_value={}), patch.object(h, "parse_authority", return_value=authority("account-x")):
        assert h.claim_shared_temporary_profile(args) == 0
    leases = list(pathlib.Path(roots["browser_use_home"], h.SHARED_PROFILE_LEASE_ROOT_NAME).glob("*.json"))
    assert len(leases) == 1
    lease_path = str(leases[0].resolve())
    lease = json.loads(leases[0].read_text())
    assert lease["state"] == "claimed"
    assert lease["profile"] == info["profile"]
    assert lease["profile_owner_run_id"] == "source-run"
    assert lease["profile_owner_authority_sha256"] == "a" * 64
    assert lease["account_identity_sha256"] == h.hashlib.sha256(b"account-x").hexdigest()
    assert "account-x" not in leases[0].read_text()
    assert pathlib.Path(lease["profile"]).exists()
    assert all(pathlib.Path(item).exists() for item in lease["lock_paths"])

    reused_room = h.validate_shared_profile_record_start(
        config, lease, profile=lease["profile"], port=lease["port"],
        run_id="borrow-run", room_id=lease["room_id"],
    )
    assert reused_room["state"] == "active"
    assert reused_room["owner"]["id"] == "borrow-task"

    recording_dir = root / "recordings" / "borrow-recording"
    recording_dir.mkdir(mode=0o700, parents=True)
    descriptor_path = recording_dir / "borrow-session-recording.json"
    legacy_lease = dict(lease)
    legacy_lease.pop("profile_owner_run_id", None)
    legacy_lease.pop("profile_owner_authority_sha256", None)
    pathlib.Path(lease_path).write_text(json.dumps(legacy_lease))
    descriptor = {
        "schema": h.RECORDING_SCHEMA, "status": "active", "mode": "authorized", "lifecycle": "temporary",
        "run_id": "borrow-run", "session": "borrow-session", "automation_id": "manual",
        "task_id": "borrow-task", "nonce": lease["nonce"], "creation_binding": lease["creation_binding"],
        "helper_sha256": "b" * 64, "recording_dir": str(recording_dir.resolve()),
        "status_path": str((recording_dir / ".recording-status.json").resolve()), "recording_framerate": 12,
        "port": lease["port"], "process": {"root_pid": 123, "root_start_time": 1.0}, "owned_chrome": True,
        "profile": lease["profile"], "download_dir": str((root / "downloads" / "borrow").resolve()),
        "lock_paths": lease["lock_paths"], "target_origins": ["https://x.example"],
        "authority_sha256": "b" * 64, "account_identity": "account-x", "operations": [],
        "authority_scope": scope, "room_id": lease["room_id"],
        "shared_profile_lease_path": lease_path, "shared_profile_marker_sha256": lease["profile_marker_sha256"],
        "profile_owner_task_id": lease["source_task_id"], "profile_owner_run_id": lease["profile_owner_run_id"],
        "profile_owner_authority_sha256": lease["profile_owner_authority_sha256"],
        "profile_owner_authority_scope": lease["profile_owner_authority_scope"],
        "profile_owner_origins": lease["origins"],
    }
    descriptor.pop("profile_owner_run_id")
    descriptor.pop("profile_owner_authority_sha256")
    (root / "downloads" / "borrow").mkdir(mode=0o700, parents=True)
    descriptor_path.write_text(json.dumps(descriptor))
    os.chmod(descriptor_path, 0o600)
    h.sys.argv[0] = helper_path
    validated = h.read_recording_descriptor(
        config, str(descriptor_path.resolve()), "borrow-run", "borrow-session",
        allow_helper_hash_mismatch=True,
    )
    assert validated["profile_owner_run_id"] == "source-run"
    assert validated["profile_owner_authority_sha256"] == "a" * 64

    exec_args = argparse.Namespace(
        mode="authorized", lifecycle="temporary", run_id="borrow-run", session="borrow-session",
        requested_session="borrow-session", automation_id="manual", task_id="borrow-task",
        port=None, allowed_origin=[], authority="authority.json", shared_lease=lease_path,
        post_command_json="", artifact_dir="", command=["--", "state"],
    )
    config["policy"] = {"unsafe_path_fragments": []}
    config["executables"] = {"chrome": {"canonical_path": "/bin/true"}}
    config["limits"] = {"max_download_bytes": 1024}
    with patch.object(h, "read_toml", return_value=config), patch.object(h, "validate_installation", return_value={}), patch.object(h, "configure_logging"), patch.object(h, "parse_authority", return_value=authority("account-x")), patch.object(h, "validate_command", return_value=(["state"], ["https://x.example"], [])), patch.object(h, "launch_chrome", return_value=(object(), {"root_pid": 123, "root_start_time": 1.0})), patch.object(h, "terminate_chrome", return_value=(True, None)), patch.object(h, "annotate_lock_process_identity"), patch.object(h, "run_cli", return_value=(0, 0)), patch.object(h, "scan_downloads", return_value=[]), patch.object(h, "finalized_receipt", return_value="receipt.json"):
        assert h.execute(exec_args) == 0
    executed = json.loads(leases[0].read_text())
    assert executed["state"] == "released"
    assert pathlib.Path(info["profile"]).exists()
    assert not any(pathlib.Path(item).exists() for item in lease["lock_paths"])

    args = argparse.Namespace(run_id="borrow-run-2", session="borrow-session-2", task_id="borrow-task-2", automation_id="manual", authority="authority.json", origin=None)
    with patch.object(h, "read_toml", return_value=config), patch.object(h, "validate_installation", return_value={}), patch.object(h, "parse_authority", return_value=authority("account-x")):
        assert h.claim_shared_temporary_profile(args) == 0
    leases = sorted(pathlib.Path(roots["browser_use_home"], h.SHARED_PROFILE_LEASE_ROOT_NAME).glob("*.json"))
    claimed_paths = [path for path in leases if json.loads(path.read_text())["state"] == "claimed"]
    assert len(claimed_paths) == 1
    lease_path = str(claimed_paths[0].resolve())
    lease = json.loads(claimed_paths[0].read_text())

    checked = h.read_shared_profile_lease(config, lease_path, run_id="borrow-run-2", session="borrow-session-2", task_id="borrow-task-2", authority=authority("account-x"))
    assert checked["profile"] == info["profile"]
    with patch.object(h, "read_toml", return_value=config), patch.object(h, "validate_installation", return_value={}), patch.object(h, "parse_authority", return_value=authority("account-x")):
        release_args = argparse.Namespace(run_id="borrow-run-2", session="borrow-session-2", task_id="borrow-task-2", authority="authority.json", lease=lease_path)
        assert h.release_shared_temporary_profile(release_args) == 0
    released = json.loads(leases[0].read_text())
    assert released["state"] == "released"
    assert released["profile_preserved"] is True
    assert pathlib.Path(info["profile"]).exists()
    assert not any(pathlib.Path(item).exists() for item in lease["lock_paths"])
    room = h.room_registry_lookup(config, lease["room_id"])
    assert room["state"] == "released"

    assert h.find_shared_temporary_profiles(config, account_identity="other-account", allowed_origins=["https://x.example"]) == []
    assert h.find_shared_temporary_profiles(config, account_identity="account-x", allowed_origins=["https://other.example"]) == []

print("ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ok/);
});
