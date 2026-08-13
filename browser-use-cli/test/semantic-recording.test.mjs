import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("public semantic readback is origin-bounded and final visual proof binds the working surface", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_semantic_recording", SourceFileLoader("codex_browser_use_semantic_recording", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

descriptor = {
    "mode": "public",
    "lifecycle": "single-use",
    "automation_id": "automation-os-public-readback",
    "target_origins": ["https://automation-os.zeabur.app"],
}
dns = {"public_only": True, "private_address_count": 0, "link_local_address_count": 0, "loopback_address_count": 0, "address_count": 1}
with patch.object(h, "browser_harness_cli_enabled", return_value=True), \
     patch.object(h, "_fixed_url_state_probe", return_value=("https://automation-os.zeabur.app/?fresh=readback", "complete")), \
     patch.object(h, "preflight_url", return_value="https://automation-os.zeabur.app"), \
     patch.object(h, "_public_dns_proof", return_value=dns):
    config = {"policy": {"unsafe_path_fragments": []}}
    code, readback_exit, state = h.run_cli_semantic_readback(config, "/tmp/browser-use-home", 19988, "session-1", ["state"], descriptor, {})
    assert (code, readback_exit) == (0, 0)
    assert state["schema"] == "browser_use_semantic_readback.v1"
    assert state["state"]["origin"] == "https://automation-os.zeabur.app"
    safe = h.safe_semantic_readback_for_storage(state)
    assert safe["state"]["url_sha256"]
    assert "url" not in safe["state"]

with tempfile.TemporaryDirectory() as temp:
    source = pathlib.Path(temp).resolve()
    (source / "0001.jpg").write_bytes(b"frame")
    inventory_path = source / "tab-inventory.json"
    inventory_path.write_text(json.dumps({
        "schema": h.TAB_INVENTORY_SCHEMA,
        "working_target_id": "target-working",
        "active_target_id": "target-working",
        "command_target_id": None,
        "baseline_target_ids": [],
        "auxiliary_target_ids": [],
        "tabs": [{
            "target_id": "target-working",
            "role": "working",
            "url_length": 42,
            "url_sha256": "a" * 64,
            "title_length": 15,
            "title_sha256": "b" * 64,
        }],
    }))
    inventory_path.chmod(0o600)
    visual = h.final_visual_readback_from_stop_capture({
        "recording_source_dir": str(source),
        "tab_inventory_path": str(inventory_path),
    }, json.dumps({"data": {
        "final_page": {"url": "https://automation-os.zeabur.app/", "title": "Automation OS"},
        "final_state": "'{\"ready_state\":\"complete\"}'",
    }}))
    assert visual["target_id"] == "target-working"
    assert visual["surface_role"] == "working"
    bound = h.bind_final_visual_readback_to_video(visual, {
        "sha256": "d" * 64,
        "final_frame_path": str(source / "video-final-frame.jpg"),
        "final_frame_sha256": "e" * 64,
        "final_frame_time_seconds": 0.417,
    })
    assert bound["frame_path"].endswith("video-final-frame.jpg")
    assert bound["frame_sha256"] == "e" * 64
    assert bound["video_frame_sha256"] == "e" * 64
    assert bound["video_sha256"] == "d" * 64

print("generic semantic readback and surface binding ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /generic semantic readback and surface binding ok/);
});

test("fixed navigation probe retries only the read-only eval after an effectful dispatch", () => {
  const script = String.raw`
import importlib.util, json, os
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_fixed_probe_retry", SourceFileLoader("codex_browser_use_fixed_probe_retry", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
success = json.dumps({"data": {"result": json.dumps({"url": "https://heavy-chain.zeabur.app/lightchain/printing-image", "ready_state": "complete"})}})
responses = [(1, 1, ""), (0, 0, success)]
with patch.object(h, "browser_harness_cli_enabled", return_value=True), \
     patch.object(h, "run_cli3_keep_alive_capture", side_effect=responses) as probe, \
     patch.object(h.time, "sleep"):
    url, ready = h._fixed_url_state_probe({}, "/tmp/browser-use-home", 20091, "session-1", {})
    assert url.endswith("/lightchain/printing-image")
    assert ready == "complete"
    assert probe.call_count == 2
print("fixed read-only navigation probe retry ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /fixed read-only navigation probe retry ok/);
});

test("screenshot commands fail with a stable blocker and cannot escape the recording directory", () => {
  const script = String.raw`
import importlib.util, os, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_screenshot_validation", SourceFileLoader("codex_browser_use_screenshot_validation", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
config = {
    "commands": {"public": ["screenshot"], "authorized": ["screenshot"]},
    "policy": {"unsafe_path_fragments": []},
}
try:
    h.validate_command(["screenshot"], "public", config, ["https://automation-os.zeabur.app"], "/tmp/downloads")
except h.Blocker as error:
    assert error.code == "browser_use_screenshot_path_required"
else:
    raise AssertionError("missing screenshot path was accepted")
with tempfile.TemporaryDirectory() as temp:
    root = os.path.realpath(temp)
    path = os.path.join(root, "frame.jpg")
    assert h.validate_capture_path(path, root) == path
    try:
        h.validate_capture_path(os.path.join(os.path.dirname(root), "outside.jpg"), root)
    except h.Blocker as error:
        assert error.code == "browser_use_capture_path_out_of_artifact_scope"
    else:
        raise AssertionError("out-of-scope screenshot path was accepted")
print("screenshot validation ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /screenshot validation ok/);
});

test("URL-shaped form values are data, while open destinations remain origin-bounded", () => {
  const script = String.raw`
import importlib.util, os
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_url_value_boundary", SourceFileLoader("codex_browser_use_url_value_boundary", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
config = {
    "commands": {"public": ["open"], "authorized": ["open", "type"]},
    "policy": {"unsafe_path_fragments": []},
}
command, origins, uploads = h.validate_command(
    ["type", "https://github.com/example/profile"],
    "authorized",
    config,
    ["https://www.linkedin.com"],
    "/tmp/downloads",
)
assert command == ["type", "https://github.com/example/profile"]
assert origins == []
assert uploads == []
try:
    h.validate_command(
        ["open", "https://github.com/example/profile"],
        "authorized",
        config,
        ["https://www.linkedin.com"],
        "/tmp/downloads",
    )
except h.Blocker as error:
    assert error.code == "browser_use_origin_not_allowed"
else:
    raise AssertionError("untrusted navigation origin was accepted")
print("URL value/navigation origin boundary ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /URL value\/navigation origin boundary ok/);
});

test("closing a run-owned auxiliary tab removes it from the role index", () => {
  const script = String.raw`
import importlib.util, json, os, sys, tempfile, time, types, hashlib
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_close_auxiliary", SourceFileLoader("codex_browser_use_close_auxiliary", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

helpers = types.ModuleType("browser_harness.helpers")
helpers.list_tabs = lambda include_chrome=True: [{"targetId": "working", "url": "https://example.test", "title": "working"}]
helpers.current_tab = lambda: {"targetId": "working"}
helpers.cdp = lambda method, params=None: {"targetInfos": []}
for name in ("switch_tab", "goto_url", "ensure_real_tab", "page_info", "js", "wait", "wait_for_load", "new_tab", "close_tab", "type_text", "press_key", "capture_screenshot", "scroll", "click_at_xy"):
    setattr(helpers, name, lambda *args, **kwargs: None)
browser_harness = types.ModuleType("browser_harness")
browser_harness.helpers = helpers
sys.modules["browser_harness"] = browser_harness
sys.modules["browser_harness.helpers"] = helpers

with tempfile.TemporaryDirectory() as temp:
    inventory_path = os.path.join(os.path.realpath(temp), "tab-inventory.json")
    inventory = {
        "schema": h.TAB_INVENTORY_SCHEMA,
        "working_target_id": "working",
        "active_target_id": "working",
        "command_target_id": None,
        "baseline_target_ids": [],
        "auxiliary_target_ids": ["closed-auxiliary"],
        "tabs": [
            {"target_id": "working", "role": "working", "url_length": 1, "url_sha256": "a" * 64, "title_length": 1, "title_sha256": "b" * 64},
            {"target_id": "closed-auxiliary", "role": "auxiliary", "url_length": 1, "url_sha256": "c" * 64, "title_length": 1, "title_sha256": "d" * 64},
        ],
    }
    with open(inventory_path, "w", encoding="utf-8") as handle:
        json.dump(inventory, handle)
    os.environ["BH_RECORDING_TAB_INVENTORY_PATH"] = inventory_path
    namespace = {"__name__": "browser_harness_guard", "hashlib": hashlib, "json": json, "os": os, "time": time}
    exec(h._BROWSER_HARNESS_TAB_GUARD, namespace)
    result = namespace["_finish_recording_command"]()
    assert result["auxiliary_target_ids"] == []
    assert [tab["target_id"] for tab in result["tabs"]] == ["working"]
    assert h.read_recording_tab_inventory(inventory_path)["auxiliary_target_ids"] == []
print("closed auxiliary role index repaired")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /closed auxiliary role index repaired/);
});
