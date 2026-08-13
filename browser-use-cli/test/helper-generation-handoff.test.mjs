import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("helper generation handoff is owner-bound and idempotent without browser dispatch", () => {
  const script = String.raw`
import contextlib, importlib.util, io, json, os, pathlib, tempfile
from argparse import Namespace
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_generation_handoff", SourceFileLoader("codex_browser_use_generation_handoff", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    roots = {name: str(base / name) for name in ("browser_use_home", "scheduled_profiles", "single_use_profiles", "temporary_profiles", "receipts", "locks", "quarantine", "downloads", "logs", "recordings")}
    for value in roots.values(): pathlib.Path(value).mkdir(mode=0o700, parents=True, exist_ok=True)
    (base / "recording").mkdir(mode=0o700, parents=True, exist_ok=True)
    config = {"roots": roots, "ports": {"scheduled_start": 19880, "scheduled_end": 19899, "single_use_start": 19980, "single_use_end": 19999, "temporary_start": 20080, "temporary_end": 20099}}
    with patch.object(h, "port_listener", return_value=False), patch.object(h, "lsof_listener", return_value=False):
        room = h.room_registry_claim(config, lifecycle=h.TEMPORARY_LIFECYCLE, run_id="run-handoff", task_id="task-handoff", port=20081)
    ledger_path, _ = h.room_registry_paths(config)
    ledger = h.room_registry_read(config)
    ledger["rooms"][0]["helper_sha256"] = "b" * 64
    h.json_atomic_replace(ledger_path, ledger)
    descriptor = {
        "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": "run-handoff", "session": "session-handoff", "task_id": "task-handoff",
        "room_id": room["room_id"], "status": "continued", "owned_chrome": True, "authentication_state": None,
        "helper_sha256": "b" * 64, "profile": room["profile"], "port": 20081,
        "helper_generation": 1,
        "process": {"root_pid": 12345, "root_start_time": 100.0},
        "status_path": str(base / "recording-status.json"),
        "recording_dir": str(base / "recording"), "target_origins": ["https://jp.linkaigc.com"],
        "operation_ledger_path": str(base / "operation-ledger.jsonl"),
    }
    observation = {
        "room_id": room["room_id"], "descriptor": str(base / "descriptor.json"),
        "run_id": "run-handoff", "session": "session-handoff", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "state": "continued", "port": 20081, "profile": room["profile"],
        "listener_observed": True, "process_observed": True, "daemon_observed": True,
        "process_start_time": 100.0,
    }
    source = "a" * 64
    installed = "b" * 64
    readback_patch = patch.object(h, "room_registry_observations", return_value=[observation])
    descriptor_patch = patch.object(h, "read_recording_descriptor", return_value=descriptor)
    status_patch = patch.object(h, "read_recording_status", return_value={"recorder_active": True, "state": "recording"})
    process_patch = patch.object(h, "validate_recording_process")
    with readback_patch, descriptor_patch, status_patch, process_patch:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            assert h.helper_generation_handoff_command(config, Namespace(phase="prepare", source_helper_sha256=source, installed_helper_sha256=installed, handoff=None)) == 0
        prepared = json.loads(output.getvalue())
        handoff_path = prepared["handoff"]
        assert prepared["status"] == "helper_generation_handoff_prepared"

    refreshed_descriptor = dict(descriptor)
    refreshed_descriptor.update({
        "helper_sha256": source,
        "helper_snapshot_path": str(base / "recording" / ".helper-generation" / source / "codex-browser-use"),
        "helper_generation": 2,
    })
    with readback_patch, descriptor_patch, status_patch, process_patch, patch.object(h, "sha256_trusted_helper", return_value=source), patch.object(h, "refresh_recording_helper_generation", return_value=refreshed_descriptor) as refresh_patch:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            assert h.helper_generation_handoff_command(config, Namespace(phase="commit", source_helper_sha256=source, installed_helper_sha256=installed, handoff=handoff_path)) == 0
        committed = json.loads(output.getvalue())
        assert committed["status"] == "helper_generation_handoff_committed"
    assert refresh_patch.call_count == 1
    assert refresh_patch.call_args.args[2] == str(base / "descriptor.json")
    assert h.room_registry_list(config)[0]["helper_sha256"] == source
    assert h.read_json_safe(handoff_path)["state"] == "committed"

print("helper generation handoff proof ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /helper generation handoff proof ok/);
});

test("terminal stop adopts one helper generation without requiring a retry flag", () => {
  const script = String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_terminal_helper_adoption", SourceFileLoader("codex_browser_use_terminal_helper_adoption", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

descriptor = {"helper_sha256": "old-helper", "run_id": "run-stop", "session": "session-stop"}
refreshed = dict(descriptor, helper_sha256="current-helper", helper_generation=2)
with patch.object(h, "sha256_trusted_helper", return_value="current-helper"), \
     patch.object(h, "refresh_recording_helper_generation", return_value=refreshed) as refresh:
    result = h._adopt_helper_for_terminal_stop({}, descriptor, "/tmp/descriptor.json")
    assert result["helper_sha256"] == "current-helper"
    assert refresh.call_count == 1

same = dict(descriptor, helper_sha256="current-helper")
with patch.object(h, "sha256_trusted_helper", return_value="current-helper"), \
     patch.object(h, "refresh_recording_helper_generation") as refresh:
    assert h._adopt_helper_for_terminal_stop({}, same, "/tmp/descriptor.json") is same
    refresh.assert_not_called()
print("terminal helper adoption proof ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /terminal helper adoption proof ok/);
});

test("explicit helper refresh also rebinds the owner room projection", () => {
  const script = String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_direct_refresh_room", SourceFileLoader("codex_browser_use_direct_refresh_room", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

current = "a" * 64
old = "b" * 64
descriptor = {"helper_sha256": current, "room_id": "room-refresh", "run_id": "run-refresh"}
with patch.object(h, "sha256_trusted_helper", return_value=current), \
     patch.object(h, "room_registry_lookup", return_value={"room_id": "room-refresh", "helper_sha256": old, "state": "active"}), \
     patch.object(h, "room_registry_adopt_helper_generation", return_value={"room_id": "room-refresh", "helper_sha256": current}) as adopt:
    result = h.refresh_recording_helper_generation({}, descriptor, "/tmp/descriptor.json")
assert result is descriptor
assert adopt.call_count == 1
assert adopt.call_args.kwargs["previous_helper_sha256"] == old
assert adopt.call_args.kwargs["helper_sha256"] == current
print("direct helper refresh room binding ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /direct helper refresh room binding ok/);
});

test("live continuation automatically adopts the current helper generation", () => {
  const script = String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_auto_generation_adoption", SourceFileLoader("codex_browser_use_auto_generation_adoption", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

descriptor = {
    "status": "continued", "helper_sha256": "b" * 64,
    "run_id": "run-auto", "session": "session-auto", "room_id": "room-auto",
}
refreshed = dict(descriptor, helper_sha256="a" * 64, helper_generation=2)
with patch.object(h, "sha256_trusted_helper", return_value="a" * 64), \
     patch.object(h, "room_registry_lookup", return_value={"room_id": "room-auto", "state": "active", "helper_sha256": "b" * 64}), \
     patch.object(h, "_live_room_readback_confirmed", return_value=True), \
     patch.object(h, "refresh_recording_helper_generation", return_value=refreshed) as refresh:
    result = h.ensure_current_helper_generation({}, descriptor, "/tmp/descriptor.json")
assert result["helper_sha256"] == "a" * 64
assert refresh.call_count == 1
print("automatic live generation adoption ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /automatic live generation adoption ok/);
});

test("live same-generation continuation repairs missing generation metadata automatically", () => {
  const script = String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_auto_generation_repair", SourceFileLoader("codex_browser_use_auto_generation_repair", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

current = "a" * 64
descriptor = {
    "status": "continued", "helper_sha256": current,
    "run_id": "run-auto-repair", "session": "session-auto-repair", "room_id": "room-auto-repair",
}
with patch.object(h, "sha256_trusted_helper", return_value=current), \
     patch.object(h, "room_registry_lookup", return_value={"room_id": "room-auto-repair", "state": "active", "helper_sha256": current}), \
     patch.object(h, "_write_recording_descriptor") as write:
    result = h.ensure_current_helper_generation({}, descriptor, "/tmp/descriptor.json")
assert result["helper_generation"] == 1
assert write.call_count == 1
print("automatic same-generation repair ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /automatic same-generation repair ok/);
});
