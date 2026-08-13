import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("authority lineage, held-room reuse, and current/historical status stay bounded", () => {
  const script = String.raw`
import argparse, contextlib, datetime as dt, importlib.util, io, json, os, pathlib, tempfile
from unittest.mock import patch
from importlib.machinery import SourceFileLoader

spec = importlib.util.spec_from_loader("codex_browser_use_stability_hardening", SourceFileLoader("codex_browser_use_stability_hardening", os.environ["HELPER_PATH"]))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def config(base):
    roots = {name: str(base / name) for name in ("browser_use_home", "scheduled_profiles", "single_use_profiles", "temporary_profiles", "receipts", "locks", "quarantine", "downloads", "logs", "recordings")}
    for value in roots.values(): pathlib.Path(value).mkdir(mode=0o700, parents=True, exist_ok=True)
    return {"roots": roots, "ports": {"scheduled_start": 19880, "scheduled_end": 19899, "single_use_start": 19980, "single_use_end": 19999, "temporary_start": 20080, "temporary_end": 20099, "max_parallel": 20}}

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    cfg = config(base)
    first = h.room_registry_claim(cfg, lifecycle="temporary", run_id="run-one", task_id="task-one", port=20081)
    h.room_registry_update(cfg, first["room_id"], run_id="run-one", state="held", activity="held")
    with patch.object(h, "port_listener", return_value=False), patch.object(h, "lsof_listener", return_value=False), patch.object(h, "psutil", None):
        reused = h.room_registry_claim(cfg, lifecycle="temporary", run_id="run-two", task_id="task-one", port=20081)
    assert reused["room_id"] == first["room_id"]

    h.room_registry_update(cfg, reused["room_id"], run_id="run-two", state="held", activity="held")
    calls = {"count": 0}
    def port_probe(_port):
        calls["count"] += 1
        return calls["count"] >= 2
    with patch.object(h, "port_listener", side_effect=port_probe), patch.object(h, "lsof_listener", return_value=False), patch.object(h, "psutil", None):
        try:
            h.room_registry_claim(cfg, lifecycle="temporary", run_id="run-three", task_id="task-one", port=20081)
        except h.Blocker as exc:
            assert exc.code == "browser_use_room_owner_reuse_listener_live"
        else:
            raise AssertionError("live listener was reused")

    now = dt.datetime.now(dt.timezone.utc)
    authority_path = base / "authority.json"
    authority = {
        "browser_surface": "browser_use_cli", "run_id": "run-test", "session": "session-test",
        "authority_issued_at": h.iso(now - dt.timedelta(hours=1)),
        "authority_lineage_expires_at": h.iso(now + dt.timedelta(hours=1)),
        "expires_at": h.iso(now - dt.timedelta(seconds=1)), "allowed_origins": ["https://example.com"],
        "account_identity": "account-test", "data_exposure": "bounded", "side_effect_scope": "task-test-only",
        "approval": "approved", "readback_required": True,
    }
    authority_path.write_text(json.dumps(authority), encoding="utf-8")
    authority_path.chmod(0o600)
    descriptor = {"run_id": "run-test", "session": "session-test", "recording_dir": str(base / "recording"), "authority_generation": 1, "authority_sha256": h.sha256_file(str(authority_path))}
    renewal = h.automatic_authority_renewal_path(cfg, descriptor, str(authority_path), "record-command", {"required_seconds": 30})
    renewed = h.read_json_safe(renewal)
    assert renewed["authority_lineage_expires_at"] == authority["authority_lineage_expires_at"]
    renewed_expires = dt.datetime.fromisoformat(renewed["expires_at"].replace("Z", "+00:00"))
    assert renewed_expires >= now + dt.timedelta(seconds=h.AUTHORITY_AUTOMATIC_RENEWAL_HORIZON_SECONDS - 5)
    assert renewed_expires <= now + dt.timedelta(hours=1)

    handoff_dir = base / "home" / "handoffs" / "run-test"
    handoff_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    handoff_authority = handoff_dir / "handoff-authority.json"
    handoff_authority.write_text(json.dumps(authority), encoding="utf-8")
    handoff_authority.chmod(0o600)
    handoff_descriptor_path = handoff_dir / "session-test.json"
    handoff_descriptor = {
        "run_id": "run-test", "session": "session-test", "requested_session": "session-test",
        "authority_current_path": str(handoff_authority), "authority_sha256": h.sha256_file(str(handoff_authority)),
        "authority_generation": 1, "authority_lineage_expires_at": authority["authority_lineage_expires_at"],
        "expires_at": authority["expires_at"], "authority_issued_at": authority["authority_issued_at"],
    }
    handoff_descriptor_path.write_text(json.dumps(handoff_descriptor), encoding="utf-8")
    handoff_descriptor_path.chmod(0o600)
    h.renew_handoff_authority(cfg, str(handoff_descriptor_path), handoff_descriptor)
    assert handoff_descriptor["authority_generation"] == 2
    assert handoff_descriptor["authority_current_path"] != str(handoff_authority)
    assert handoff_descriptor["expires_at"] != authority["expires_at"]

    status_paths = []
    for index in range(7):
        p = base / "recordings" / f"status-{index}.json"
        p.write_text(json.dumps({"schema": h.RECORDING_SCHEMA}), encoding="utf-8")
        p.chmod(0o600)
        status_paths.append(str(p))
    entries = [
        {"liveness": "live", "status": "active", "process_live": True, "exact_blocker": "live"},
        {"liveness": "recoverable", "status": "continued", "process_live": False, "exact_blocker": "recoverable"},
        {"liveness": "stale", "status": "stale", "process_live": False, "exact_blocker": "stale"},
        {"liveness": "cleanup_pending", "status": "cleanup_pending", "process_live": False, "exact_blocker": "cleanup"},
        {"liveness": "finalized", "status": "finalized", "process_live": False},
        {"liveness": "finalized_blocked", "status": "finalized", "process_live": False, "exact_blocker": "old-proof"},
        {"liveness": "recoverable", "status": "continued", "process_live": True, "exact_blocker": "recoverable-live"},
    ]
    with patch.object(h, "read_toml", return_value=cfg), patch.object(h, "validate_installation", return_value={}), patch.object(h, "_recording_descriptor_paths", return_value=status_paths), patch.object(h, "_classify_recording_descriptor", side_effect=entries):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            assert h.recording_status(argparse.Namespace(descriptor=None, mark_stale=False)) == 0
    summary = json.loads(output.getvalue())
    assert summary["current_unresolved_count"] == 3
    assert summary["historical_debt_count"] == 3
    assert summary["current_completion_status"] == "pending"
    assert summary["historical_debt_status"] == "present"
    assert h.build_parser().parse_args(["runtime-readback"]).action == "runtime-readback"

    historical_only = [{"liveness": "stale", "status": "stale", "process_live": False, "exact_blocker": "old"}] * 7
    with patch.object(h, "read_toml", return_value=cfg), patch.object(h, "validate_installation", return_value={}), patch.object(h, "_recording_descriptor_paths", return_value=status_paths), patch.object(h, "_classify_recording_descriptor", side_effect=historical_only):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            assert h.recording_status(argparse.Namespace(descriptor=None, mark_stale=False)) == 0
    historical_summary = json.loads(output.getvalue())
    assert historical_summary["current_unresolved_count"] == 0
    assert historical_summary["overall_completion"] == "completed"
    assert historical_summary["historical_completion_status"] == "debt"

print("ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ok/);
});
