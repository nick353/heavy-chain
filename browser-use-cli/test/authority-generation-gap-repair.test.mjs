import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "bin", "codex-browser-use");

test("authority renewal repairs exactly one missing descriptor generation", () => {
  const script = String.raw`
import datetime as dt, hashlib, importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_authority_gap_repair", SourceFileLoader("codex_browser_use_authority_gap_repair", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

def authority(path, generation, previous, expires):
    value = {
        "schema": "browser-use-authority-renewal.v1", "browser_surface": "browser_use_cli", "run_id": "run-gap", "session": "session-gap",
        "expires_at": expires, "authority_issued_at": "2026-08-07T13:00:00Z",
        "authority_lineage_expires_at": "2026-08-08T13:00:00Z",
        "authority_generation": generation, "previous_authority_sha256": previous,
        "allowed_origins": ["https://jp.linkaigc.com"], "account_identity": "account-gap",
        "data_exposure": "authorized_recording", "side_effect_scope": "bounded_recording",
        "approval": "approved", "readback_required": True, "issuer_id": "issuer-gap",
    }
    pathlib.Path(path).write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
    os.chmod(path, 0o600)
    return value

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    recording = base / "recording"
    recording.mkdir(mode=0o700)
    current_path = base / "authority-current.json"
    renewal_path = base / "authority-renewal.json"
    current = authority(current_path, 2, "a" * 64, "2026-08-07T17:00:00Z")
    renewal = authority(renewal_path, 3, "", "2026-08-07T18:00:00Z")
    current_digest = h.sha256_file(str(current_path))
    renewal_digest = h.sha256_file(str(renewal_path))
    renewal["previous_authority_sha256"] = current_digest
    renewal_path.write_text(json.dumps(renewal, sort_keys=True), encoding="utf-8")
    os.chmod(renewal_path, 0o600)
    renewal_digest = h.sha256_file(str(renewal_path))
    descriptor = {
        "run_id": "run-gap", "session": "session-gap", "recording_dir": str(recording),
        "authority_generation": 2, "authority_sha256": current_digest,
        "authority_issuer_id": "issuer-gap", "profile": str(base / "profile"), "port": 20080,
        "process": {}, "nonce": "nonce-gap",
    }
    ledger = recording / "authority-generation-ledger.jsonl"
    history = recording / "authority-descriptor-history.jsonl"
    descriptor["authority_ledger_path"] = str(ledger)
    descriptor["authority_history_path"] = str(history)
    first = {
        "account_identity": "account-gap", "allowed_origins": ["https://jp.linkaigc.com"],
        "authority_generation": 1, "authority_issued_at": "2026-08-07T13:00:00Z",
        "authority_lineage_expires_at": "2026-08-08T13:00:00Z", "authority_scope_digest": h.authority_scope_digest(current),
        "authority_sha256": "a" * 64, "expires_at": "2026-08-07T15:00:00Z",
        "issuer_id": "issuer-gap", "previous_authority_sha256": None, "previous_chain_digest": "0" * 64,
        "run_id": "run-gap", "schema": h.AUTHORITY_LEDGER_SCHEMA, "sequence": 1, "session": "session-gap",
    }
    first["chain_digest"] = hashlib.sha256((first["previous_chain_digest"] + json.dumps(first, sort_keys=True, separators=(",", ":"))).encode()).hexdigest()
    ledger.write_text(json.dumps(first, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(ledger, 0o600)

    config = {"roots": {"browser_use_home": str(base)}}
    # Keep the historical fixture deterministic.  The authority dates are
    # intentionally in the fixture's 2026-08-07 window; production code must
    # continue rejecting genuinely expired authorities.
    with patch.object(h, "now_utc", return_value=dt.datetime(2026, 8, 7, 14, tzinfo=dt.timezone.utc)):
        result = h.renew_recording_authority(config, descriptor, str(current_path), str(renewal_path))
    rows = h._read_jsonl_chain(str(ledger), h.AUTHORITY_LEDGER_SCHEMA, "browser_use_authority_ledger")
    assert result["authority_generation"] == 3
    assert [row["authority_generation"] for row in rows] == [1, 2, 3]
    assert rows[1]["authority_sha256"] == current_digest
    assert rows[1]["previous_authority_sha256"] == "a" * 64
    assert rows[2]["authority_sha256"] == renewal_digest
    assert rows[2]["previous_authority_sha256"] == current_digest

print("authority generation gap repair proof ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /authority generation gap repair proof ok/);
});

test("automatic renewal does not reuse an expired immutable artifact", () => {
  const script = String.raw`
import datetime as dt, importlib.util, json, os, pathlib, tempfile
from importlib.machinery import SourceFileLoader
from unittest.mock import patch

path = os.environ["HELPER_PATH"]
spec = importlib.util.spec_from_loader("codex_browser_use_authority_reissue", SourceFileLoader("codex_browser_use_authority_reissue", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp).resolve()
    recording = base / "recording"
    recording.mkdir(mode=0o700)
    current_path = base / "authority-current.json"
    current = {
        "browser_surface": "browser_use_cli", "run_id": "run-reissue", "session": "session-reissue",
        "expires_at": "2026-08-07T17:00:00Z", "authority_issued_at": "2026-08-07T13:00:00Z",
        "authority_lineage_expires_at": "2026-08-08T13:00:00Z", "allowed_origins": ["https://jp.linkaigc.com"],
        "account_identity": "account-reissue", "data_exposure": "authorized_recording",
        "side_effect_scope": "bounded_recording", "approval": "approved", "readback_required": True,
    }
    current_path.write_text(json.dumps(current), encoding="utf-8")
    os.chmod(current_path, 0o600)
    stale = recording / "authority-renewal-generation-2.json"
    stale.write_text(json.dumps({"authority_generation": 2, "previous_authority_sha256": h.sha256_file(str(current_path)), "expires_at": "2020-01-01T00:00:00Z"}), encoding="utf-8")
    os.chmod(stale, 0o600)
    descriptor = {"recording_dir": str(recording), "run_id": "run-reissue", "session": "session-reissue", "authority_generation": 1}
    with patch.object(h, "now_utc", return_value=dt.datetime(2026, 8, 7, 14, tzinfo=dt.timezone.utc)):
        path = h.automatic_authority_renewal_path({}, descriptor, str(current_path), "record-command", {"required_seconds": 30})
    assert path != str(stale)
    assert "authority-renewal-generation-2-reissue-" in pathlib.Path(path).name
    assert pathlib.Path(path).is_file()

print("expired renewal reissue proof ok")
`;
  const result = spawnSync(process.env.PYTHON ?? "python3", ["-c", script], {
    env: { ...process.env, HELPER_PATH: helper },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /expired renewal reissue proof ok/);
});
