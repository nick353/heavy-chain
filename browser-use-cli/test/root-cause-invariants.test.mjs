import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("shared projections do not re-request login or mix current and historical completion", () => {
  const script = String.raw`
import argparse, contextlib, importlib.util, io, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_root_cause_invariants", SourceFileLoader("codex_browser_use_root_cause_invariants", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

assert "login" not in h.authentication_next_action("authenticated")
assert "login" in h.authentication_next_action("waiting")

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    roots = {name: str(base / name) for name in ("browser_use_home", "temporary_profiles", "recordings")}
    for value in roots.values(): pathlib.Path(value).mkdir(mode=0o700, parents=True)
    config = {"roots": roots}
    descriptor = {
        "task_id": "auth-task", "automation_id": "manual", "mode": "authorized", "lifecycle": "temporary",
        "status": "continued", "authentication_state": "authenticated", "run_id": "auth-run", "session": "auth-session",
        "room_id": "room-auth", "port": 20080, "target_origins": ["https://example.com"],
        "profile": str(base / "temporary_profiles" / "auth-task"), "recording_dir": str(base / "recordings" / "auth-run"),
        "next_action": "login in the existing Temporary room, then continue the same run",
        "authentication_wait": {"state": "authenticated", "exact_blocker": "authentication_readback_verified", "next_action": "login in the existing Temporary room, then continue the same run"},
    }
    checkpoint = h._resume_checkpoint_from_descriptor(config, descriptor, str(base / "recordings" / "auth-run" / "descriptor.json"))
    assert checkpoint["authentication_state"] == "authenticated"
    assert checkpoint["next_action"] == "continue the original same-run flow; authentication was verified"
    assert "login" not in checkpoint["next_action"]

    status_paths = []
    for index in range(2):
        path = base / "recordings" / f"status-{index}.json"
        path.write_text(json.dumps({"schema": h.RECORDING_SCHEMA}), encoding="utf-8")
        path.chmod(0o600)
        status_paths.append(str(path))
    entries = [
        {"liveness": "finalized", "status": "finalized", "process_live": False},
        {"liveness": "stale", "status": "stale", "process_live": False},
    ]
    with patch.object(h, "read_toml", return_value=config), patch.object(h, "validate_installation", return_value={}), patch.object(h, "shared_profile_inventory", return_value={"profile_count": 0, "available_count": 0, "leased_count": 0, "busy_count": 0}), patch.object(h, "_recording_descriptor_paths", return_value=status_paths), patch.object(h, "_classify_recording_descriptor", side_effect=entries):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            assert h.recording_status(argparse.Namespace(descriptor=None, mark_stale=False)) == 0
    summary = json.loads(output.getvalue())
    assert summary["current_terminal"] is True
    assert summary["historical_debt_present"] is True
    assert summary["historical_debt_count"] == 1
    assert summary["finalized"] is False
    assert "historical" in summary["operator_next_action"]

print("ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /ok/);
});

test("semantic target resolution matches submit labels exposed as element attributes", () => {
  const script = String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_attribute_target", SourceFileLoader("codex_browser_use_attribute_target", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

state = '''[42]<input type="submit" value="Submit application" aria-label="Submit application">'''
matches = h._state_candidates(state, "Submit application")
assert matches[0]["index"] == 42
assert h._target_is_interactive(matches[0], matches[0]["attributes"]) is True
semantic = h._state_candidates('''[43]<input type="submit">''', "__semantic__:type=submit")
assert semantic[0]["index"] == 43
try:
    h._state_candidates('''[44]<input type="submit">\n[45]<input type="submit">''', "__semantic__:type=submit")
    raise AssertionError("ambiguous semantic submit was accepted")
except h.Blocker as error:
    assert error.code == "browser_use_target_ambiguous"
print("attribute semantic target resolution ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /attribute semantic target resolution ok/);
});

test("shared profile inventory exposes bounded ownership and actionability only", () => {
  const script = String.raw`
import importlib.util, json, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_inventory_invariants", SourceFileLoader("codex_browser_use_inventory_invariants", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
candidate = {
    "availability_marker_sha256": "a" * 64, "account_identity_sha256": "b" * 64,
    "origins": ["https://example.com"], "match_digest": "c" * 64, "port": 20090,
    "status": "available", "retention_mode": "manual", "marker": {
        "automation_id": "manual", "task_id": "source-task", "run_id": "source-run", "expires_at": None,
    },
}
with patch.object(h, "list_shared_temporary_profiles", return_value=[candidate]):
    value = h.shared_profile_inventory({})
item = value["profiles"][0]
assert item["owner_bound"] is True
assert item["purpose"] == "authenticated_temporary_profile"
assert item["claimability"] == "claimable"
assert item["source_task_id"] == "source-task"
assert item["source_run_id"] == "source-run"
assert "private-account" not in json.dumps(value)
assert "canonical_profile" not in json.dumps(value)
print("ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /ok/);
});

test("terminal cleanup repairs only closed auxiliary tab index entries", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_terminal_inventory", SourceFileLoader("codex_browser_use_terminal_inventory", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    path = pathlib.Path(os.path.realpath(temp)) / "tab-inventory.json"
    path.write_text(json.dumps({
        "schema": h.TAB_INVENTORY_SCHEMA,
        "working_target_id": "working",
        "active_target_id": "working",
        "command_target_id": None,
        "baseline_target_ids": [],
        "auxiliary_target_ids": ["closed-auxiliary"],
        "tabs": [{
            "target_id": "working", "role": "working", "url_length": 1,
            "url_sha256": "a" * 64, "title_length": 1, "title_sha256": "b" * 64,
        }],
    }), encoding="utf-8")
    path.chmod(0o600)
    try:
        h.read_recording_tab_inventory(str(path))
    except h.Blocker as error:
        assert error.code == "browser_use_recording_tab_inventory_role_index_mismatch"
    else:
        raise AssertionError("strict inventory unexpectedly accepted a stale auxiliary ID")
    repaired = h.read_recording_tab_inventory_for_terminal_cleanup(str(path))
    assert repaired["auxiliary_target_ids"] == []
    assert repaired["working_target_id"] == "working"
print("terminal inventory cleanup repair ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /terminal inventory cleanup repair ok/);
});

test("one recording descriptor permits only one browser command at a time", () => {
  const script = String.raw`
import importlib.util, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_command_lease", SourceFileLoader("codex_browser_use_command_lease", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    descriptor = {"recording_dir": os.path.realpath(temp), "run_id": "run-1", "session": "session-1", "nonce": "nonce-1"}
    path, token = h.acquire_recording_command_lock(descriptor)
    try:
        try:
            h.acquire_recording_command_lock(descriptor)
            raise AssertionError("overlapping recording command was accepted")
        except h.Blocker as error:
            assert error.code == "browser_use_recording_command_in_progress"
    finally:
        h.release_lock(path, token, token)
    released_path, released_token = h.acquire_recording_command_lock(descriptor)
    h.release_lock(released_path, released_token, released_token)
print("recording command lease serialization ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /recording command lease serialization ok/);
});

test("recording capture failure cannot downgrade an already-proven effect", () => {
  const script = String.raw`
import importlib.util, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_capture_boundary", SourceFileLoader("codex_browser_use_capture_boundary", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    root = os.path.realpath(temp)
    descriptor = {
        "recording_dir": root, "run_id": "run-1", "session": "session-1", "nonce": "nonce-1",
        "operation_ledger_path": os.path.join(root, "operation-ledger.jsonl"),
        "authority_lineage_root_sha256": "b" * 64,
        "profile": os.path.join(root, "profile"), "port": 20080,
        "failed_operations": [], "reconciliations": [],
    }
    h.append_operation_ledger(descriptor, operation_id="a" * 32, phase="intent", command=["target-click"], external_effects="unknown", outcome="dispatch_intent_durable")
    h.append_operation_ledger(descriptor, operation_id="a" * 32, phase="outcome", command=["target-click"], external_effects="executed", outcome="post_click_readback_verified")
    descriptor["failed_operations"].append({"operation": "target-click", "operation_id": "a" * 32, "external_action_possible": False})
    assert h.pending_operation_reconciliation_ids(descriptor) == []
print("capture failure preserves executed proof")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /capture failure preserves executed proof/);
});

test("capture paths and post-proof click failures stay run-safe", () => {
  const script = String.raw`
import importlib.util, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_capture_collision", SourceFileLoader("codex_browser_use_capture_collision", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    source = pathlib.Path(temp).resolve()
    (source / "0001.jpg").write_bytes(b"frame")
    (source / ".capture-0002.png").write_bytes(b"stale")
    frame_path, capture_path = h.next_recording_frame_paths(str(source))
    assert pathlib.Path(frame_path).name == "0002.jpg"
    assert pathlib.Path(capture_path).name.startswith(".capture-0002-")
    assert pathlib.Path(capture_path).suffix == ".png"
    assert capture_path != str(source / ".capture-0002.png")

assert h._target_click_failure_outcome(dispatch_attempted=True, effect_proof_committed=True, blocker="capture") is None
assert h._target_click_failure_outcome(dispatch_attempted=True, effect_proof_committed=False, blocker="dispatch") == {"external_effects": "unknown", "outcome": "dispatch"}
assert h._target_click_failure_outcome(dispatch_attempted=False, effect_proof_committed=False, blocker="preflight") == {"external_effects": "none", "outcome": "preflight"}
print("capture collision and post-proof boundary ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /capture collision and post-proof boundary ok/);
});
