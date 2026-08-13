import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("temporary authorized binding survives authority refresh and stable URL reuse", () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader

helper_path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_temporary", SourceFileLoader("codex_browser_use_temporary", helper_path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp).resolve()
    profile_root = root / "temporary_profiles"
    locks_root = root / "locks"
    downloads_root = root / "downloads"
    for value in (profile_root, locks_root, downloads_root):
        value.mkdir(mode=0o700)
    config = {
        "roots": {
            "temporary_profiles": str(profile_root),
            "locks": str(locks_root),
            "downloads": str(downloads_root),
        },
        "ports": {"temporary_start": 20080, "temporary_end": 20099},
    }
    scope = {"data_exposure": "authenticated", "side_effect_scope": "none", "approval": "approved", "readback_required": "yes"}
    origins = ["https://example.com"]
    first = h.prepare_temporary_profile(
        config, mode="authorized", automation_id="manual", task_id="task-1",
        run_id="run-1", authority_digest="a" * 64, authority_scope=scope,
        account_identity="account-1", origins=origins, download_dir=str(downloads_root / "temporary"),
    )
    h.release_lock(first["profile_lock"], "run-1", first["binding"])
    second = h.prepare_temporary_profile(
        config, mode="authorized", automation_id="manual", task_id="task-1",
        run_id="run-2", authority_digest="b" * 64, authority_scope=scope,
        account_identity="account-1", origins=origins, download_dir=str(downloads_root / "temporary"),
        requested_port=first["port"],
    )
    assert second["binding"] == first["binding"]
    assert second["profile"] == first["profile"]
    assert second["port"] == first["port"]
    h.release_lock(second["profile_lock"], "run-2", second["binding"])

    changed_task = h.temporary_binding(
        mode="authorized", lifecycle="temporary", automation_id="manual", task_id="task-2",
        run_id="run-3", authority_digest="c" * 64, authority_scope=scope,
        account_identity="account-1", origins=origins,
    )
    assert changed_task != first["binding"]

print("ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ok/);
});
