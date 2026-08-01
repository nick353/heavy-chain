from __future__ import annotations

import json
from pathlib import Path

from social_flow import adaptive_orchestration_runtime as runtime
from social_flow.adaptive_route_policy import DIRECT_ROOT_BOUNDED_READBACK, GRAPH
from social_flow.adaptive_session_audit import SessionAuditResult


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def test_runtime_exposes_the_project_route_boundary() -> None:
    evidence_audit = runtime.resolve_project_adaptive_route(
        {"cross_session": True, "read_only": True, "evidence_only": True}
    )
    implementation = runtime.resolve_project_adaptive_route({"implementation": True})

    assert evidence_audit.route == DIRECT_ROOT_BOUNDED_READBACK
    assert evidence_audit.role == "root"
    assert implementation.route == GRAPH
    assert implementation.role == "executor"


def test_runtime_delegates_with_safe_defaults_and_returns_result_unchanged(
    tmp_path: Path, monkeypatch
) -> None:
    index = tmp_path / "session_index.jsonl"
    expected = SessionAuditResult("completed", (), None, 0, 0, 0.0)
    calls: dict[str, object] = {}

    def fake_audit(path: Path, **kwargs: object) -> SessionAuditResult:
        calls["path"] = path
        calls["kwargs"] = kwargs
        return expected

    monkeypatch.setattr(runtime, "audit_local_session_evidence", fake_audit)

    result = runtime.audit_adaptive_session_evidence(index)

    assert result is expected
    assert calls == {
        "path": index,
        "kwargs": {
            "rollout_paths": (),
            "rollout_root": None,
            "max_bytes": runtime.SAFE_MAX_BYTES,
            "max_records": runtime.SAFE_MAX_RECORDS,
            "max_elapsed_seconds": runtime.SAFE_MAX_ELAPSED_SECONDS,
            "clock": runtime.time.monotonic,
        },
    }


def test_runtime_propagates_exact_timeout_blocker(tmp_path: Path) -> None:
    index = tmp_path / "session_index.jsonl"
    _write_jsonl(index, [{"session_id": "session-1", "prompt": "raw transcript"}])

    result = runtime.audit_adaptive_session_evidence(index, max_bytes=1)

    assert result.status == "blocked"
    assert result.exact_blocker == "session_audit_timeout:bytes"


def test_runtime_never_returns_raw_transcript(tmp_path: Path) -> None:
    index = tmp_path / "session_index.jsonl"
    secret = "raw-transcript-must-not-escape"
    _write_jsonl(index, [{"session_id": "session-1", "prompt": secret}])

    result = runtime.audit_adaptive_session_evidence(index)

    assert secret not in json.dumps(result.records)
    assert "prompt" not in json.dumps(result.records)
