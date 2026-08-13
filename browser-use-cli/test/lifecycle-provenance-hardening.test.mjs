import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("explicitly retained temporary profiles are manual-retention and status files stay run-bound", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_lifecycle_provenance", SourceFileLoader("codex_browser_use_lifecycle_provenance", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp).resolve()
    roots = {name: str(root / name) for name in ("browser_use_home", "scheduled_profiles", "single_use_profiles", "temporary_profiles", "receipts", "locks", "downloads", "recordings", "logs", "quarantine")}
    for value in roots.values(): pathlib.Path(value).mkdir(mode=0o700, parents=True)
    # Keep this hermetic fixture outside the live Browser Use port ranges so a
    # foreign parallel room cannot make the retained-profile assertion fail.
    config = {"roots": roots, "ports": {"scheduled_start": 31880, "scheduled_end": 31899, "single_use_start": 31980, "single_use_end": 31999, "temporary_start": 32080, "temporary_end": 32099}}
    scope = {"data_exposure": "authenticated", "side_effect_scope": "none", "approval": "approved", "readback_required": True}
    info = h.prepare_temporary_profile(config, mode="authorized", automation_id="manual", task_id="task-1", run_id="run-1", authority_digest="a" * 64, authority_scope=scope, account_identity="account-1", origins=["https://x.example"], download_dir=str(root / "downloads" / "source"))
    h.release_lock(info["profile_lock"], "run-1", info["binding"])
    h.mark_temporary_profile_shareable(config, {"mode": "authorized", "lifecycle": "temporary", "profile": info["profile"]})
    marker = json.loads((pathlib.Path(info["profile"]) / ".browser-use-profile.json").read_text())
    availability = json.loads((pathlib.Path(info["profile"]) / ".browser-use-profile-shareable.json").read_text())
    assert marker["retention_mode"] == h.TEMPORARY_RETENTION_MANUAL
    assert marker["expires_at"] is None
    assert availability["retention_mode"] == h.TEMPORARY_RETENTION_MANUAL
    assert availability["expires_at"] is None
    assert len(h.find_shared_temporary_profiles(config, account_identity="account-1", allowed_origins=["https://x.example"])) == 1
    lease_root = pathlib.Path(roots["browser_use_home"], h.SHARED_PROFILE_LEASE_ROOT_NAME)
    assert not lease_root.exists()
    inventory = h.shared_profile_inventory(config)
    assert not lease_root.exists()
    assert inventory["profile_count"] == 1
    assert inventory["available_count"] == 1
    profile_view = inventory["profiles"][0]
    assert set(profile_view) == {"inventory_id", "status", "retention_mode", "account_identity_sha256", "origins", "match_digest", "port", "expires_at", "owner_bound", "purpose", "owner_automation_id", "source_task_id", "source_run_id", "claimability", "operation_policy"}
    assert profile_view["account_identity_sha256"] == h.hashlib.sha256(b"account-1").hexdigest()
    assert profile_view["origins"] == ["https://x.example"]
    assert profile_view["match_digest"] == h.shared_profile_match_digest("account-1", ["https://x.example"])
    assert isinstance(profile_view["port"], int) and profile_view["port"] >= 20080
    assert profile_view["expires_at"] is None
    assert profile_view["owner_bound"] is True
    assert profile_view["purpose"] == "authenticated_temporary_profile"
    assert profile_view["source_task_id"] == "task-1"
    assert profile_view["source_run_id"] == "run-1"
    assert profile_view["claimability"] == "claimable"
    assert "account-1" not in json.dumps(inventory)
    assert info["profile"] not in json.dumps(inventory)

    recording_dir = root / "recordings" / "run-1"
    recording_dir.mkdir(mode=0o700)
    status_path = recording_dir / ".recording-status.json"
    recording = {"recording_source_dir": str(recording_dir), "run_id": "run-1", "session": "session-1"}
    h.write_harness_recording_status(str(status_path), recording, active=True, finalized=False)
    status = json.loads(status_path.read_text())
    assert status["run_id"] == "run-1"
    assert status["session"] == "session-1"
    h.write_harness_recording_status(str(status_path), {"recording_source_dir": str(recording_dir)}, active=False, finalized=False)
    preserved = json.loads(status_path.read_text())
    assert preserved["run_id"] == "run-1"
    assert preserved["session"] == "session-1"

    mismatched = dict(preserved)
    mismatched["run_id"] = "other-run"
    status_path.write_text(json.dumps(mismatched))
    entry = h._classify_recording_descriptor({}, str(root / "descriptor.json"), {"run_id": "run-1", "session": "session-1", "status": "active", "status_path": str(status_path)})
    assert entry["recording_status_binding"] == "mismatch"
    assert entry["exact_blocker"] == "browser_use_recording_status_binding_mismatch"

print("ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ok/);
});

test("shared profile claim selectors disambiguate retained owners without guessing", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_shared_claim_selector", SourceFileLoader("codex_browser_use_shared_claim_selector", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp).resolve()
    roots = {name: str(root / name) for name in ("browser_use_home", "scheduled_profiles", "single_use_profiles", "temporary_profiles", "receipts", "locks", "downloads", "recordings", "logs", "quarantine")}
    for value in roots.values(): pathlib.Path(value).mkdir(mode=0o700, parents=True)
    # Keep this hermetic fixture outside the live Browser Use port ranges so a
    # foreign parallel room cannot make the retained-profile assertion fail.
    config = {"roots": roots, "ports": {"scheduled_start": 31880, "scheduled_end": 31899, "single_use_start": 31980, "single_use_end": 31999, "temporary_start": 32080, "temporary_end": 32099}}
    scope = {"data_exposure": "authenticated", "side_effect_scope": "none", "approval": "approved", "readback_required": True}
    for run_id, task_id in (("source-run-a", "source-task-a"), ("source-run-b", "source-task-b")):
        info = h.prepare_temporary_profile(config, mode="authorized", automation_id="manual", task_id=task_id, run_id=run_id, authority_digest="a" * 64, authority_scope=scope, account_identity="account-1", origins=["https://x.example"], download_dir=str(root / "downloads" / run_id))
        h.release_lock(info["profile_lock"], run_id, info["binding"])
        h.mark_temporary_profile_shareable(config, {"mode": "authorized", "lifecycle": "temporary", "profile": info["profile"]})

    all_candidates = h.find_shared_temporary_profiles(config, account_identity="account-1", allowed_origins=["https://x.example"])
    assert len(all_candidates) == 2
    selected = h.find_shared_temporary_profiles(config, account_identity="account-1", allowed_origins=["https://x.example"], source_run_id="source-run-b", source_task_id="source-task-b")
    assert len(selected) == 1
    assert selected[0]["marker"]["run_id"] == "source-run-b"
    assert selected[0]["marker"]["task_id"] == "source-task-b"

print("ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ok/);
});
