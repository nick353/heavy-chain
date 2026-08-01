from __future__ import annotations

import json
from pathlib import Path

import pytest

from social_flow.adaptive_session_audit import (
    ChildTaskValidationError,
    audit_local_session_evidence,
    read_bounded_session_evidence,
    validate_child_prompt_and_final,
    validate_child_task_result,
)


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def test_child_result_requires_prompt_and_final() -> None:
    validate_child_prompt_and_final("prompt", "final")
    assert validate_child_task_result({"prompt": "prompt", "final_response": "final"})["prompt"] == "prompt"

    with pytest.raises(ChildTaskValidationError, match="child_task_prompt_missing"):
        validate_child_task_result({"final": "final"})
    with pytest.raises(ChildTaskValidationError, match="child_task_final_missing"):
        validate_child_task_result({"task_prompt": "prompt", "final": "   "})


def test_session_audit_reads_only_bounded_sanitized_metadata(tmp_path: Path) -> None:
    index = tmp_path / "session_index.jsonl"
    rollout = tmp_path / "rollout.jsonl"
    secret = "secret-token-should-not-escape"
    _write_jsonl(
        index,
        [{"session_id": "session-1", "rollout_path": str(rollout), "prompt": secret}],
    )
    _write_jsonl(rollout, [{"type": "event", "text": secret, "final": secret}])

    result = read_bounded_session_evidence(index, rollout_root=tmp_path)

    assert result.status == "completed"
    serialized = json.dumps(result.records)
    assert secret not in serialized
    assert "prompt" not in serialized
    assert "text" not in serialized
    assert result.records[0]["source"] == "session_index"
    assert result.records[1]["source"] == "rollout"
    assert "session_key" in result.records[0]


@pytest.mark.parametrize("limit", ["bytes", "records", "elapsed"])
def test_session_audit_returns_explicit_timeout_blocker(tmp_path: Path, limit: str) -> None:
    index = tmp_path / "session_index.jsonl"
    _write_jsonl(index, [{"session_id": "session-1", "status": "running"}] * 3)

    clock_values = [0.0, 3.0]

    def clock() -> float:
        return clock_values.pop(0) if clock_values else 3.0

    kwargs: dict[str, object] = {"clock": clock}
    if limit == "bytes":
        kwargs["max_bytes"] = 1
    elif limit == "records":
        kwargs["max_records"] = 1
    else:
        kwargs["max_elapsed_seconds"] = 2.0

    result = read_bounded_session_evidence(index, **kwargs)

    assert result.status == "blocked"
    assert result.exact_blocker is not None
    assert result.exact_blocker.startswith("session_audit_timeout:")
    assert result.bytes_read <= int(kwargs.get("max_bytes", 256_000))
    assert result.records_read <= int(kwargs.get("max_records", 256))


def test_session_audit_caps_bytes_before_accepting_over_limit(tmp_path: Path) -> None:
    index = tmp_path / "session_index.jsonl"
    _write_jsonl(index, [{"session_id": "session-1", "status": "running"}])

    result = read_bounded_session_evidence(index, max_bytes=1)

    assert result.status == "blocked"
    assert result.exact_blocker == "session_audit_timeout:bytes"
    assert result.bytes_read == 1
    assert result.records_read == 0
    assert result.records == ()


def test_session_audit_caps_records_before_accepting_over_limit(tmp_path: Path) -> None:
    index = tmp_path / "session_index.jsonl"
    _write_jsonl(index, [{"session_id": "session-1"}, {"session_id": "session-2"}])

    result = read_bounded_session_evidence(index, max_records=1, max_bytes=10_000)

    assert result.status == "blocked"
    assert result.exact_blocker == "session_audit_timeout:records"
    assert result.records_read == 1
    assert result.bytes_read <= 10_000
    assert len(result.records) == 1


def test_session_audit_does_not_use_rollout_outside_declared_root(tmp_path: Path) -> None:
    index = tmp_path / "session_index.jsonl"
    outside = tmp_path.parent / "outside-rollout.jsonl"
    _write_jsonl(index, [{"rollout_path": str(outside)}])
    _write_jsonl(outside, [{"type": "event"}])

    result = read_bounded_session_evidence(index, rollout_root=tmp_path)

    assert result.status == "blocked"
    assert result.exact_blocker == "session_audit_rollout_outside_root"


def test_production_audit_adapter_propagates_exact_timeout_without_raw_transcript(tmp_path: Path) -> None:
    index = tmp_path / "session_index.jsonl"
    secret = "raw-transcript-must-not-escape"
    _write_jsonl(index, [{"session_id": "session-1", "prompt": secret}])

    result = audit_local_session_evidence(index, max_bytes=1)

    assert result.status == "blocked"
    assert result.exact_blocker == "session_audit_timeout:bytes"
    assert secret not in json.dumps(result.records)
