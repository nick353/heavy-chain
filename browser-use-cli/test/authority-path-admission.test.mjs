import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("authority paths are current-source defaults and explicit typos fail with an authority-specific blocker", () => {
  const script = String.raw`
import datetime as dt, importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

spec = importlib.util.spec_from_loader("codex_browser_use_authority_path_admission", SourceFileLoader("codex_browser_use_authority_path_admission", os.environ["HELPER_PATH"]))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    authority_path = base / "authority.json"
    authority = {
        "browser_surface": "browser_use_cli", "run_id": "run-1", "session": "session-1",
        "expires_at": "2099-01-01T00:00:00Z", "allowed_origins": ["https://example.com"],
        "account_identity": "account-1", "data_exposure": "authenticated",
        "side_effect_scope": "bounded", "approval": "approved", "readback_required": True,
    }
    authority_path.write_text(json.dumps(authority), encoding="utf-8")
    authority_path.chmod(0o600)
    missing = str(base / "authority-typo.json")

    try:
        h.parse_authority(missing, "run-1", "session-1")
    except h.Blocker as exc:
        assert exc.code == "browser_use_authority_path_missing"
    else:
        raise AssertionError("missing authority path was accepted")

    descriptor = {
        "mode": "authorized", "run_id": "run-1", "session": "session-1",
        "authority_current_path": str(authority_path),
        "authority_sha256": h.sha256_file(str(authority_path)),
        "account_identity": "account-1", "target_origins": ["https://example.com"],
    }
    resolved = h.recording_authority({}, descriptor, None)
    assert resolved["account_identity"] == "account-1"

    try:
        h.recording_authority({}, descriptor, missing)
    except h.Blocker as exc:
        assert exc.code == "browser_use_authority_path_missing"
    else:
        raise AssertionError("explicit typo was silently replaced")

    parsed = h.build_parser().parse_args(["record-finalize", "--run-id", "run-1", "--session", "session-1", "--descriptor", str(base / "descriptor.json")])
    assert parsed.authority is None
    released = h.build_parser().parse_args(["temporary-share-release", "--run-id", "run-1", "--session", "session-1", "--task-id", "task-1", "--lease", str(base / "lease.json")])
    assert released.authority is None

print("authority path admission ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${helper}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /authority path admission ok/);
});
