import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("resume projection, locator selection, and recording status summary stay distinct", () => {
  const script = String.raw`
import argparse, contextlib, importlib.util, io, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_resume_status_consistency", SourceFileLoader("codex_browser_use_resume_status_consistency", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def write_json(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")
    path.chmod(0o600)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    roots = {
        "browser_use_home": str(base / "home"),
        "temporary_profiles": str(base / "profiles"),
        "recordings": str(base / "recordings"),
    }
    for value in roots.values(): pathlib.Path(value).mkdir(mode=0o700)
    config = {"roots": roots}

    auth_descriptor = {
        "task_id": "auth-task", "automation_id": "manual", "mode": "authorized", "lifecycle": "temporary",
        "status": "continued", "authentication_state": "waiting", "run_id": "auth-run", "session": "auth-session",
        "room_id": "room-auth", "port": 20080, "target_origins": ["https://example.com"],
        "account_identity": "private-account", "authentication_wait": {
            "state": "waiting", "exact_blocker": "browser_use_authentication_required",
            "next_action": "login in the existing Temporary room, then continue the same run",
            "password": "must-not-be-projected",
        },
        "profile": str(base / "profiles" / "auth-task"),
        "recording_dir": str(base / "recordings" / "auth-run"),
    }
    auth_path = base / "recordings" / "auth-run" / "descriptor.json"
    projected = h._resume_checkpoint_from_descriptor(config, auth_descriptor, str(auth_path))
    assert projected["state"] == "waiting_auth"
    assert projected["authentication_state"] == "waiting"
    assert projected["exact_blocker"] == "browser_use_authentication_required"
    assert projected["next_action"] == auth_descriptor["authentication_wait"]["next_action"]
    assert "must-not-be-projected" not in json.dumps(projected)

    def checkpoint(task_id, run_id, state, status):
        descriptor = {
            "task_id": task_id, "automation_id": "manual", "mode": "authorized", "lifecycle": "temporary",
            "status": status, "run_id": run_id, "session": f"session-{task_id}", "room_id": f"room-{task_id}",
            "port": 20080, "source_thread_id": "thread-source", "target_origins": ["https://example.com"],
            "profile": str(base / "profiles" / task_id), "recording_dir": str(base / "recordings" / run_id),
        }
        descriptor_path = base / "recordings" / run_id / "descriptor.json"
        write_json(descriptor_path, descriptor)
        value = h._resume_checkpoint_from_descriptor(config, descriptor, str(descriptor_path), state=state)
        h.json_atomic_replace(h.task_resume_path(config, task_id), value)

    checkpoint("task-active", "run-active", "active", "active")
    checkpoint("task-auth", "run-auth", "waiting_auth", "continued")
    checkpoint("task-old", "run-old", "finalized", "finalized")
    auth_descriptor_path = base / "recordings" / "run-auth" / "descriptor.json"
    current_auth_descriptor = json.loads(auth_descriptor_path.read_text(encoding="utf-8"))
    current_auth_descriptor.update({
        "authentication_state": "waiting",
        "authentication_wait": {
            "state": "waiting",
            "exact_blocker": "browser_use_authentication_required",
            "next_action": "login in the existing Temporary room, then continue the same run",
            "password": "descriptor-secret-must-not-appear",
        },
    })
    write_json(auth_descriptor_path, current_auth_descriptor)
    stale_checkpoint_path = pathlib.Path(h.task_resume_path(config, "task-auth"))
    stale_checkpoint = h.read_json_safe(str(stale_checkpoint_path))
    stale_checkpoint["exact_blocker"] = None
    stale_checkpoint["next_action"] = None
    h.json_atomic_replace(str(stale_checkpoint_path), stale_checkpoint)
    checkpoint_before_resume = stale_checkpoint_path.read_bytes()

    with patch.object(h, "read_toml", return_value=config), patch.object(h, "validate_installation", return_value={}):
        ambiguous_output = io.StringIO()
        with contextlib.redirect_stdout(ambiguous_output):
            exit_code = h.task_resume(argparse.Namespace(task_id=None, thread_id="thread-source", run_id=None))
        ambiguous = json.loads(ambiguous_output.getvalue())
        assert exit_code == 1
        assert ambiguous["status"] == "resume_locator_ambiguous"
        assert ambiguous["exact_blocker"] == "browser_use_task_resume_multiple_current_candidates"
        assert "current_descriptor" not in ambiguous

        selected_output = io.StringIO()
        with contextlib.redirect_stdout(selected_output):
            exit_code = h.task_resume(argparse.Namespace(task_id=None, thread_id="thread-source", run_id="run-auth"))
        selected = json.loads(selected_output.getvalue())
        assert exit_code == 0
        assert selected["status"] == "resume_locator_found"
        assert selected["current_descriptor"]["run_id"] == "run-auth"
        refreshed_match = next(item for item in selected["matches"] if item["task_id"] == "task-auth")
        assert refreshed_match["authentication_state"] == "waiting"
        assert refreshed_match["exact_blocker"] == "browser_use_authentication_required"
        assert refreshed_match["next_action"] == current_auth_descriptor["authentication_wait"]["next_action"]
        assert "descriptor-secret-must-not-appear" not in json.dumps(selected)
        assert stale_checkpoint_path.read_bytes() == checkpoint_before_resume

    parser_args = h.build_parser().parse_args(["resume", "--run-id", "run-auth"])
    assert parser_args.run_id == "run-auth"

    status_paths = []
    for name in ("live", "recoverable", "recoverable-pending", "stale", "cleanup", "finalized", "finalized-blocked"):
        status_path = base / "recordings" / f"{name}.json"
        write_json(status_path, {"schema": h.RECORDING_SCHEMA})
        status_paths.append(str(status_path))
    entries = [
        {"liveness": "live", "status": "active", "process_live": True},
        {"liveness": "recoverable", "status": "continued", "process_live": True},
        {"liveness": "recoverable", "status": "continued", "process_live": False},
        {"liveness": "stale", "status": "stale", "process_live": False},
        {"liveness": "cleanup_pending", "status": "cleanup_pending", "process_live": False},
        {"liveness": "finalized", "status": "finalized", "process_live": False},
        {"liveness": "finalized_blocked", "status": "finalized", "process_live": False},
    ]
    with patch.object(h, "read_toml", return_value=config), patch.object(h, "validate_installation", return_value={}), patch.object(h, "_recording_descriptor_paths", return_value=status_paths), patch.object(h, "_classify_recording_descriptor", side_effect=entries):
        status_output = io.StringIO()
        with contextlib.redirect_stdout(status_output):
            exit_code = h.recording_status(argparse.Namespace(descriptor=None, mark_stale=False))
    summary = json.loads(status_output.getvalue())
    assert exit_code == 0
    assert summary["status"] == "completed"
    assert summary["inspection_status"] == "completed"
    assert summary["inspection_succeeded"] is True
    assert summary["inspection_command_succeeded"] is True
    assert summary["overall_completion"] == "blocked"
    assert summary["active_runtime_count"] == 2
    assert summary["recoverable_pending_count"] == 1
    assert summary["historical_debt_count"] == 2
    assert summary["cleanup_pending_count"] == 1
    assert summary["recording_completion_count"] == 1
    assert summary["recording_completion_pending_count"] == 4
    assert summary["recording_completion_status"] == "blocked"
    assert summary["finalized"] is False

print("ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ok/);
});
