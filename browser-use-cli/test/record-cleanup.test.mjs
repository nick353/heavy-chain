import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

function runPython(script) {
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("authentication-wait unknown-effect cleanup is narrowly eligible", () => {
  const output = runPython(String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_cleanup_gate", SourceFileLoader("codex_browser_use_cleanup_gate", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

descriptor = {"lifecycle": h.TEMPORARY_LIFECYCLE, "owned_chrome": True}
status = {"recorder_active": True, "state": "authentication_required"}
with patch.object(h, "operation_effect_summary", return_value="unknown"):
    assert h._recording_cleanup_only_preserve_recovery_eligible(
        descriptor, status, cleanup_only=True, preserve_temporary=True
    ) is True
    assert h._recording_cleanup_only_preserve_recovery_eligible(
        descriptor, {"recorder_active": False, "state": "authentication_required"}, cleanup_only=True, preserve_temporary=True
    ) is False
    assert h._recording_cleanup_only_preserve_recovery_eligible(
        descriptor, status, cleanup_only=False, preserve_temporary=True
    ) is False
with patch.object(h, "operation_effect_summary", return_value="none"):
    assert h._recording_cleanup_only_preserve_recovery_eligible(
        descriptor, status, cleanup_only=True, preserve_temporary=True
    ) is False
print("cleanup eligibility gate ok")
`);
  assert.match(output, /cleanup eligibility gate ok/);
});

test("active authentication-wait status is a negative terminal probe, not a cleanup failure", () => {
  const output = runPython(String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_terminal_probe", SourceFileLoader("codex_browser_use_terminal_probe", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

descriptor = {"lifecycle": h.TEMPORARY_LIFECYCLE, "status": "continued", "status_path": "/tmp/status"}
with patch.object(h, "read_recording_status", side_effect=h.Blocker("browser_use_recording_not_finalized")):
    assert h.promote_verified_terminal_cleanup({}, descriptor) is False
print("active authentication-wait probe proof ok")
`);
  assert.match(output, /active authentication-wait probe proof ok/);
});

test("cleanup-only preserve lane admits only the live authentication-wait recovery", () => {
  const output = runPython(String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_cleanup_gate_order", SourceFileLoader("codex_browser_use_cleanup_gate_order", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

descriptor = {
    "lifecycle": h.TEMPORARY_LIFECYCLE, "status": "continued", "owned_chrome": True,
}
with patch.object(h, "operation_effect_summary", return_value="unknown"):
    h.require_temporary_delete_approval(descriptor, cleanup_only=True, preserve_temporary=True)
    descriptor["owned_chrome"] = False
    try:
        h.require_temporary_delete_approval(descriptor, cleanup_only=True, preserve_temporary=True)
    except h.Blocker as exc:
        assert exc.code == "browser_use_temporary_cleanup_only_requires_terminal_state"
    else:
        raise AssertionError("borrowed Chrome must not use the owned cleanup lane")
    descriptor["owned_chrome"] = True
    try:
        h.require_temporary_delete_approval(descriptor, cleanup_only=True, preserve_temporary=False)
    except h.Blocker as exc:
        assert exc.code == "browser_use_temporary_cleanup_only_requires_terminal_state"
    else:
        raise AssertionError("profile retention must be explicit")
with patch.object(h, "operation_effect_summary", return_value="none"):
    try:
        h.require_temporary_delete_approval(descriptor, cleanup_only=True, preserve_temporary=True)
    except h.Blocker as exc:
        assert exc.code == "browser_use_temporary_cleanup_only_requires_terminal_state"
    else:
        raise AssertionError("effect-free state must not bypass terminal cleanup gate")
print("cleanup gate ordering proof ok")
`);
  assert.match(output, /cleanup gate ordering proof ok/);
});

test("preserve-temporary failure cleanup keeps the profile and releases the terminal room", () => {
  const output = runPython(String.raw`
import importlib.util, json, os, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_cleanup_preserve", SourceFileLoader("codex_browser_use_cleanup_preserve", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    profile = os.path.join(temp, "profile")
    os.makedirs(profile, mode=0o700)
    marker = os.path.join(profile, ".browser-use-profile.json")
    with open(marker, "w", encoding="utf-8") as handle:
        json.dump({"schema": "browser-use-profile.v1"}, handle)
    os.chmod(marker, 0o600)
    descriptor = {
        "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": "run-preserve", "session": "session-preserve", "requested_session": "session-preserve",
        "automation_id": "manual", "task_id": "task-preserve", "nonce": "nonce-preserve",
        "started_at": "2026-01-01T00:00:00Z", "lock_paths": [],
        "process": {"root_pid": 1}, "port": 20093, "room_id": "room-preserve",
        "profile": profile, "download_dir": os.path.join(temp, "downloads"),
        "recording_dir": temp, "status_path": os.path.join(temp, "recording-status.json"), "recording_framerate": 12,
        "owned_chrome": True, "status": "continued",
    }
    config = {
        "roots": {"browser_use_home": os.path.join(temp, "browser-home"), "receipts": os.path.join(temp, "receipts")},
        "executables": {"chrome": {"canonical_path": "/bin/true"}},
    }
    observed = {}
    def cleanup_owned(config, value, **kwargs):
        observed["preserve_temporary"] = kwargs.get("preserve_temporary")
        return True, None
    status_calls = []
    recording = {"recording_source_dir": temp, "status_path": descriptor["status_path"]}
    with patch.object(h, "browser_harness_cli_enabled", return_value=True), \
         patch.object(h, "close_owned_daemon_if_active", return_value=(True, None)), \
         patch.object(h, "_cleanup_recording_owned_session", side_effect=cleanup_owned), \
         patch.object(h, "recording_env", return_value=recording), \
         patch.object(h, "write_harness_recording_status", side_effect=lambda path, rec, *, active, finalized, **kwargs: status_calls.append((active, finalized))), \
         patch.object(h, "_write_recording_descriptor"), \
         patch.object(h, "finalized_receipt", return_value=os.path.join(temp, "blocked-receipt.json")):
        receipt, blocker = h._recording_finalize_cleanup_after_media_failure(
            config, {"helper": "versions"}, descriptor, os.path.join(temp, "descriptor.json"),
            "browser_use_recording_not_finalized", failure_phase="record_stop", preserve_temporary=True,
        )
    assert receipt.endswith("blocked-receipt.json")
    assert blocker == "browser_use_recording_not_finalized"
    assert observed["preserve_temporary"] is True
    cleanup = descriptor["cleanup_state"]
    assert cleanup["status"] == "cleaned"
    assert cleanup["profile_preserved"] is True
    assert cleanup["temporary_profile_preserved"] is True
    assert cleanup["temporary_profile_removed"] is False
    assert status_calls == [(False, False)]

    # The common cleanup context marks this path as terminal, so the existing
    # owner-bound lock release routine releases the room instead of returning
    # it to held state.
    context = h._recording_context(config, descriptor)
    assert context["room_terminal_cleanup"] is True
print("preserve-temporary cleanup proof ok")
`);
  assert.match(output, /preserve-temporary cleanup proof ok/);
});

test("record-finalize routes an authentication-wait stop blocker to preserve cleanup", () => {
  const output = runPython(String.raw`
import importlib.util, os, tempfile
from argparse import Namespace
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_record_finalize_route", SourceFileLoader("codex_browser_use_record_finalize_route", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    descriptor_path = os.path.join(temp, "descriptor.json")
    descriptor = {
        "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": "run-route", "session": "session-route", "requested_session": "session-route",
        "automation_id": "manual", "task_id": "task-route", "nonce": "nonce-route",
        "status": "continued", "owned_chrome": True, "recording_framerate": 12,
        "recording_dir": temp, "recording_source_dir": temp,
        "status_path": os.path.join(temp, "recording-status.json"),
        "operation_ledger_path": os.path.join(temp, "operation-ledger.jsonl"),
        "process": {"root_pid": 1}, "port": 20093, "profile": os.path.join(temp, "profile"),
        "download_dir": os.path.join(temp, "downloads"), "lock_paths": [],
    }
    config = {"roots": {"browser_use_home": os.path.join(temp, "browser-home")}}
    status = {"recorder_active": True, "finalized": False, "state": "authentication_required"}
    observed = {}
    def stop_cleanup(config, versions, value, path_value, failure, *, preserve_temporary=False):
        observed["failure"] = failure
        observed["preserve_temporary"] = preserve_temporary
        return os.path.join(temp, "blocked-receipt.json"), failure
    args = Namespace(
        run_id="run-route", session="session-route", descriptor=descriptor_path,
        authority=None, authority_renewal=None, task_id="task-route",
        delete_approved=False, preserve_temporary=True, cleanup_only=True,
    )
    with patch.object(h, "read_toml", return_value=config), \
         patch.object(h, "validate_installation", return_value={}), \
         patch.object(h, "validate_recording_tools", return_value={}), \
         patch.object(h, "read_recording_descriptor", return_value=descriptor), \
         patch.object(h, "require_temporary_task_id"), \
         patch.object(h, "_source_handoff_cleanup_marker_reconciliation_eligible", return_value=False), \
         patch.object(h, "promote_verified_terminal_cleanup", return_value=False), \
         patch.object(h, "require_temporary_delete_approval"), \
         patch.object(h, "_write_recording_descriptor"), \
         patch.object(h, "recording_authority"), \
         patch.object(h, "read_json_safe", return_value=status), \
         patch.object(h, "validate_recording_process"), \
         patch.object(h, "recording_env", return_value={"recording_source_dir": temp}), \
         patch.object(h, "browser_harness_cli_enabled", return_value=False), \
         patch.object(h, "run_cli_keep_alive", return_value=(0, 0)), \
         patch.object(h, "wait_for_recording_stop", side_effect=h.Blocker("browser_use_recording_not_finalized")), \
         patch.object(h, "operation_effect_summary", return_value="unknown"), \
         patch.object(h, "_recording_finalize_cleanup_after_stop_failure", side_effect=stop_cleanup):
        code = h.record_finalize(args)
    assert code == 1
    assert observed == {"failure": "browser_use_recording_not_finalized", "preserve_temporary": True}
print("record-finalize preserve route proof ok")
`);
  assert.match(output, /record-finalize preserve route proof ok/);
});
