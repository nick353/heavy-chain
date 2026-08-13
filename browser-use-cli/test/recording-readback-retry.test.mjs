import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("readback failure keeps the recovery and cleanup gates fail-closed", () => {
  const source = readFileSync(helper, "utf8");
  assert.match(source, /if readback_exit != 0:\n        append_operation_outcome_durable\(descriptor, operation_id=operation_id, command=command, external_effects="unknown"/);
  assert.match(source, /descriptor\["recovery_state"\] = "readback_pending"/);
  assert.match(source, /descriptor\["effectful_retry_allowed"\] = False/);
  assert.match(source, /require_no_pending_effect_reconciliation\(descriptor, effectful=operation_effect == "unknown"\)/);
  assert.match(source, /read_recording_status\(descriptor\["status_path"\], require_active=True\)/);
  assert.match(source, /run_cli3_keep_alive_capture[\s\S]*_recording_state_readback_with_retry/);
});

test("recording retries only the post-command state readback", () => {
  const script = String.raw`
import importlib.util, os
from unittest.mock import patch
from importlib.machinery import SourceFileLoader

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_readback_retry", SourceFileLoader("codex_browser_use_readback_retry", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

class Result:
    def __init__(self, returncode, stderr="", stdout=""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = stdout

def run_case(capture):
    calls = []
    state_attempts = {"count": 0}
    sleeps = []

    def fake_run(argv, *, input, **kwargs):
        calls.append(input)
        if "['upload', '0', '/tmp/image.jpg']" in input:
            return Result(0, stdout='{"success":true}')
        assert "['state']" in input
        state_attempts["count"] += 1
        if state_attempts["count"] == 1:
            return Result(1, stderr="runtime_error")
        return Result(0, stdout='{"success":true}')

    config = {"executables": {"browser_use": {"canonical_path": "/tmp/browser-use"}}}
    with patch.object(h, "browser_harness_script", side_effect=lambda command: repr(command)), \
         patch.object(h, "browser_harness_env", return_value={}), \
         patch.object(h.subprocess, "run", side_effect=fake_run), \
         patch.object(h.time, "sleep", side_effect=lambda seconds: sleeps.append(seconds)):
        if capture:
            result = h.run_cli3_keep_alive_capture(config, "/tmp/home", 20081, "session", ["upload", "0", "/tmp/image.jpg"], recording={})
            assert result[0:2] == (0, 0)
        else:
            result = h.run_cli3_session(config, "/tmp/home", 20081, "session", ["upload", "0", "/tmp/image.jpg"], True, close_after=False, recording={})
            assert result == (0, 0)
    assert sum("['upload', '0', '/tmp/image.jpg']" in call for call in calls) == 1
    assert state_attempts["count"] == 2
    assert sleeps == [0.25]

run_case(False)
run_case(True)
print("recording readback retry proof ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /recording readback retry proof ok/);
});

test("recording keeps the effect unknown when every readback retry fails", () => {
  const script = String.raw`
import importlib.util, os
from unittest.mock import patch
from importlib.machinery import SourceFileLoader

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_readback_exhausted", SourceFileLoader("codex_browser_use_readback_exhausted", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

class Result:
    def __init__(self, returncode, stderr="", stdout=""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = stdout

def run_case(capture):
    calls = []
    sleeps = []

    def fake_run(argv, *, input, **kwargs):
        calls.append(input)
        if "['upload', '0', '/tmp/image.jpg']" in input:
            return Result(0, stdout='{"success":true}')
        assert "['state']" in input
        return Result(1, stderr="runtime_error")

    config = {"executables": {"browser_use": {"canonical_path": "/tmp/browser-use"}}}
    with patch.object(h, "browser_harness_script", side_effect=lambda command: repr(command)), \
         patch.object(h, "browser_harness_env", return_value={}), \
         patch.object(h.subprocess, "run", side_effect=fake_run), \
         patch.object(h.time, "sleep", side_effect=lambda seconds: sleeps.append(seconds)):
        if capture:
            result = h.run_cli3_keep_alive_capture(config, "/tmp/home", 20081, "session", ["upload", "0", "/tmp/image.jpg"], recording={})
            assert result[0:2] == (0, 1)
        else:
            result = h.run_cli3_session(config, "/tmp/home", 20081, "session", ["upload", "0", "/tmp/image.jpg"], True, close_after=False, recording={})
            assert result == (0, 1)
    assert sum("['upload', '0', '/tmp/image.jpg']" in call for call in calls) == 1
    assert sum("['state']" in call for call in calls) == 4
    assert sleeps == [0.25, 0.5, 1.0]

run_case(False)
run_case(True)
print("recording readback exhaustion proof ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /recording readback exhaustion proof ok/);
});
