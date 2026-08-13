import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("authentication wait holds and resumes the same recording room without credentials", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_auth_wait", SourceFileLoader("codex_browser_use_auth_wait", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def write_json(path, value):
    pathlib.Path(path).write_text(json.dumps(value), encoding="utf-8")
    os.chmod(path, 0o600)

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp).resolve()
    roots = {name: str(root / name) for name in ("recordings", "temporary_profiles", "browser_use_home")}
    for value in roots.values(): pathlib.Path(value).mkdir(mode=0o700)
    recording_dir = pathlib.Path(roots["recordings"]) / "run-1"
    recording_dir.mkdir(mode=0o700)
    descriptor_path = recording_dir / "session-nonce.json"
    status_path = recording_dir / ".recording-status.json"
    write_json(status_path, {"schema": h.RECORDING_STATUS_SCHEMA, "recorder_configured": True, "recorder_active": True, "finalized": False, "recording_dir": str(recording_dir)})
    descriptor = {
        "schema": h.RECORDING_SCHEMA, "status": "continued", "mode": "authorized", "lifecycle": "temporary",
        "run_id": "run-1", "session": "session-1", "task_id": "task-1", "automation_id": "manual",
        "nonce": "nonce-1", "room_id": "room-task", "port": 20080, "profile": str(root / "profile"),
        "recording_dir": str(recording_dir), "status_path": str(status_path), "target_origins": ["https://example.com"],
        "recording_framerate": 12, "operations": [], "process": {"root_pid": 1, "root_start_time": 1.0},
        "owned_chrome": True, "download_dir": str(root / "downloads"), "lock_paths": [],
        "authority_sha256": "a" * 64, "account_identity": "account-1", "effectful_retry_allowed": False,
        "authority_expires_at": h.iso(h.now_utc() + h.dt.timedelta(minutes=10)),
    }
    write_json(descriptor_path, descriptor)
    recording = {"status_path": str(status_path), "recording_source_dir": str(recording_dir)}
    evidence = h._navigation_binding_for_url("https://example.com/home")
    auth = h.Blocker("browser_use_authentication_required")
    with patch.object(h, "browser_harness_cli_enabled", return_value=False), patch.object(h, "room_registry_update") as room_update, patch.object(h.time, "sleep"), patch.object(h, "_verified_navigation_with_checkpoint", side_effect=[auth, {"schema": "browser-use-navigation-readback.v1", **evidence}]):
        result = h._wait_for_authentication(
            {"roots": roots}, descriptor, str(descriptor_path), recording,
            expected_origins=["https://example.com"], expected_url="https://example.com/home",
            operation_id="a" * 32, timeout_seconds=5, poll_interval_seconds=0.01,
        )
    assert result["status"] == "authenticated"
    assert descriptor["authentication_state"] == "authenticated"
    assert descriptor["authentication_wait"]["same_room"] is True
    assert room_update.call_args_list[0].kwargs["state"] == "held"
    assert room_update.call_args_list[-1].kwargs["state"] == "active"
    saved = json.loads(descriptor_path.read_text())
    assert "password" not in descriptor_path.read_text().lower()
    assert saved["authentication_wait"]["expected_navigation"]["path_sha256"] == evidence["path_sha256"]

    # A real login usually redirects away from the exact login URL.  The
    # same-origin, ready-state readback is the proof for that redirect; the
    # helper must not keep waiting on the stale /login binding.
    descriptor["authentication_state"] = "waiting"
    redirect_evidence = h._navigation_binding_for_url("https://example.com/")
    with patch.object(h, "browser_harness_cli_enabled", return_value=False), patch.object(h, "room_registry_update"), patch.object(h.time, "sleep"), patch.object(h, "_verified_navigation_with_checkpoint", side_effect=[h.Blocker("browser_use_navigation_exact_url_mismatch"), {"schema": "browser-use-navigation-readback.v1", **redirect_evidence}]):
        result = h._wait_for_authentication(
            {"roots": roots}, descriptor, str(descriptor_path), recording,
            expected_origins=["https://example.com"], expected_url="https://example.com/login",
            operation_id="d" * 32, timeout_seconds=5, poll_interval_seconds=0.01,
        )
    assert result["status"] == "authenticated"
    assert result["evidence"]["authentication_readback"] == "same_origin_post_login_navigation"
    assert descriptor["authentication_state"] == "authenticated"

    descriptor["authentication_state"] = "waiting"
    descriptor["target_origins"] = ["https://supabase.com"]
    descriptor["authentication_wait"] = {"expected_navigation": h._navigation_binding_for_url("https://supabase.com/dashboard")}
    supabase_evidence = h._navigation_binding_for_url("https://supabase.com/dashboard/organizations")
    supabase_state = '[0]<div id="__next"> Organizations href="/dashboard/org/example" Your Organizations'
    supabase_stdout = json.dumps({"success": True, "data": {"state": supabase_state, "url": "https://supabase.com/dashboard/organizations", "title": "Organizations"}})
    with patch.object(h, "browser_harness_cli_enabled", return_value=False), patch.object(h, "room_registry_update") as room_update, patch.object(h.time, "sleep"), patch.object(h, "_verified_navigation_with_checkpoint", side_effect=[auth, supabase_evidence]), patch.object(h, "run_cli_keep_alive_capture", return_value=(0, 0, supabase_stdout)):
        result = h._wait_for_authentication(
            {"roots": roots}, descriptor, str(descriptor_path), recording,
            expected_origins=["https://supabase.com"], expected_url=None,
            operation_id="c" * 32, timeout_seconds=5, poll_interval_seconds=0.01,
        )
    assert result["status"] == "authenticated"
    assert result["evidence"]["authentication_readback"] == "supabase_authenticated_dashboard_landing"
    assert descriptor["authentication_state"] == "authenticated"

    descriptor["authentication_state"] = None
    with patch.object(h, "browser_harness_cli_enabled", return_value=False), patch.object(h, "room_registry_update") as room_update, patch.object(h.time, "sleep") as sleep, patch.object(h, "_verified_navigation_with_checkpoint", side_effect=auth):
        result = h._wait_for_authentication(
            {"roots": roots}, descriptor, str(descriptor_path), recording,
            expected_origins=["https://example.com"], expected_url="https://example.com/home",
            operation_id="b" * 32, timeout_seconds=0, poll_interval_seconds=0.01,
        )
    assert result["status"] == "waiting"
    assert descriptor["authentication_state"] == "waiting"
    assert descriptor["recovery_state"] == "authentication_pending"
    assert room_update.call_args_list[0].kwargs["state"] == "held"
    assert sleep.call_count == 0

print("ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ok/);
});

test("manual retained profiles do not treat null expiry as malformed auth-wait time", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_manual_retention_auth_wait", SourceFileLoader("codex_browser_use_manual_retention_auth_wait", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    profile = (pathlib.Path(temp) / "profile").resolve()
    profile.mkdir(mode=0o700)
    marker = profile / ".browser-use-profile.json"
    marker.write_text(json.dumps({
        "schema": h.TEMPORARY_PROFILE_MARKER_SCHEMA,
        "version": 2,
        "retention_mode": h.TEMPORARY_RETENTION_MANUAL,
        "expires_at": None,
    }), encoding="utf-8")
    marker.chmod(0o600)
    deadline = h._authentication_wait_deadline({"profile": str(profile)}, 5)
    assert deadline > h.now_utc()
print("manual retention auth-wait proof ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /manual retention auth-wait proof ok/);
});
