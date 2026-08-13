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

test("cleanup-complete handoff publishes an explicitly retained profile after cleanup", () => {
  const output = runPython(String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_handoff_publish", SourceFileLoader("codex_browser_use_handoff_publish", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp).resolve()
    profile = root / "profile"
    profile.mkdir(mode=0o700)
    marker_path = profile / ".browser-use-profile.json"
    marker_path.write_text(json.dumps({"schema": "browser-use-profile.v1"}))
    marker_path.chmod(0o600)
    descriptor_path = root / "handoff.json"
    descriptor = {
        "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
        "run_id": "run-handoff", "session": "session-handoff", "task_id": "task-handoff",
        "nonce": "nonce-handoff", "room_id": "room-handoff", "profile": str(profile),
        "download_dir": str(root / "downloads"), "lock_paths": [], "port": 20080,
        "process": {"root_pid": 1}, "cleanup_state": {
            "process_terminated": True, "listener_absent": True,
            "profile_preserved": True, "download_dir_removed": True,
            "locks_release_started": True,
        },
    }
    observed = {}
    def record(path, value, **updates):
        value.setdefault("cleanup_state", {}).update(updates)
    def publish(config, value):
        observed["published"] = True
        return "availability-marker"
    config = {"roots": {"browser_use_home": str(root)}}
    with patch.object(h, "_read_cleanup_complete", return_value=False), \
         patch.object(h, "_select_cleanup_candidate", return_value=str(descriptor_path)), \
         patch.object(h, "read_handoff", return_value=descriptor), \
         patch.object(h, "validate_handoff_resources"), \
         patch.object(h, "_claim_handoff_for_cleanup", return_value=(str(descriptor_path), descriptor)), \
         patch.object(h, "_record_cleanup_state", side_effect=record), \
         patch.object(h, "_release_lock_set", return_value=(True, None, [])), \
         patch.object(h, "room_registry_release", return_value={"state": "released"}), \
         patch.object(h, "mark_temporary_profile_shareable", side_effect=publish), \
         patch.object(h, "_write_cleanup_complete", side_effect=lambda base, value: observed.setdefault("marker", dict(value))), \
         patch.object(h, "_remove_handoff_descriptors"):
        result = h.cleanup_abandoned_handoff(
            config, str(descriptor_path), "run-handoff", "session-handoff",
            require_expired=False, preserve_temporary=True,
        )
    assert observed["published"] is True
    assert observed["marker"]["cleanup_state"]["shared_profile_available"] is True
    assert result["shared_profile_available"] is True
print("handoff publish proof ok")
`);
  assert.match(output, /handoff publish proof ok/);
});

test("temporary-share-publish validates an older cleanup-complete descriptor without browser launch", () => {
  const output = runPython(String.raw`
import argparse, importlib.util, os, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_publish_command", SourceFileLoader("codex_browser_use_publish_command", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

descriptor = {
    "mode": "authorized", "lifecycle": h.TEMPORARY_LIFECYCLE,
    "run_id": "run-publish", "session": "session-publish", "task_id": "task-publish",
    "status": "stale", "cleanup_completed": True, "room_id": "room-publish",
    "lock_paths": [], "cleanup_state": {
        "profile_preserved": True, "external_effects": "none",
        "process_absent": True, "listener_absent": True, "daemon_absent": True,
    },
}
args = argparse.Namespace(
    run_id="run-publish", session="session-publish", task_id="task-publish",
    descriptor="/tmp/cleanup-complete.json",
)
observed = {}
config = {"roots": {"browser_use_home": "/tmp/browser-use-home"}}
with patch.object(h, "read_toml", return_value=config), \
     patch.object(h, "validate_installation", return_value={}), \
     patch.object(h, "read_recording_descriptor", return_value=descriptor), \
     patch.object(h, "operation_effect_summary", return_value="none"), \
     patch.object(h, "room_registry_lookup", return_value={"state": "released"}), \
     patch.object(h, "mark_temporary_profile_shareable", side_effect=lambda config, value: observed.setdefault("published", True)):
    assert h.publish_retained_temporary_profile(args) == 0
assert observed["published"] is True
print("publish command proof ok")
`);
  assert.match(output, /publish command proof ok/);
});
