from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import time
from typing import Any


class ChildTaskValidationError(RuntimeError):
    """A child dispatch envelope is not eligible to be marked successful."""

    def __init__(self, failure_code: str) -> None:
        self.failure_code = failure_code
        super().__init__(failure_code)


def validate_child_prompt_and_final(task_prompt: object, final: object) -> None:
    """Require both the dispatched prompt and the child's final response.

    This is a post-dispatch contract for callers wrapping the external Codex
    App dispatcher. The external dispatcher is outside this repository and is
    intentionally not edited here; callers must run this validator before
    recording a child task as successful.
    """

    if not isinstance(task_prompt, str) or not task_prompt.strip():
        raise ChildTaskValidationError("child_task_prompt_missing")
    if not isinstance(final, str) or not final.strip():
        raise ChildTaskValidationError("child_task_final_missing")


def validate_child_task_result(result: Mapping[str, object]) -> Mapping[str, object]:
    """Validate a child result envelope and return it unchanged.

    Accepted aliases keep this reusable across local adapters: ``task_prompt``
    or ``prompt`` for the request, and ``final`` or ``final_response`` for the
    returned answer. No transcript or provider payload is inspected.
    """

    if not isinstance(result, Mapping):
        raise ChildTaskValidationError("child_task_result_missing")
    task_prompt = result.get("task_prompt", result.get("prompt"))
    final = result.get("final", result.get("final_response"))
    validate_child_prompt_and_final(task_prompt, final)
    return result


class _AuditBudgetExceeded(RuntimeError):
    def __init__(self, blocker: str) -> None:
        self.blocker = blocker
        super().__init__(blocker)


@dataclass(frozen=True)
class SessionAuditResult:
    """Sanitized, bounded local-session evidence; never raw transcript data."""

    status: str
    records: tuple[dict[str, object], ...]
    exact_blocker: str | None
    bytes_read: int
    records_read: int
    elapsed_seconds: float


DEFAULT_MAX_BYTES = 256_000
DEFAULT_MAX_RECORDS = 256
DEFAULT_MAX_ELAPSED_SECONDS = 2.0


class _AuditState:
    def __init__(
        self,
        *,
        max_bytes: int,
        max_records: int,
        max_elapsed_seconds: float,
        clock: Callable[[], float],
    ) -> None:
        self.max_bytes = max_bytes
        self.max_records = max_records
        self.max_elapsed_seconds = max_elapsed_seconds
        self.clock = clock
        self.started = clock()
        self.bytes_read = 0
        self.records_read = 0

    @property
    def elapsed_seconds(self) -> float:
        return max(0.0, self.clock() - self.started)

    def check_elapsed(self) -> None:
        if self.elapsed_seconds >= self.max_elapsed_seconds:
            raise _AuditBudgetExceeded("session_audit_timeout:elapsed")

    def accept_line(self, line: bytes) -> None:
        self.check_elapsed()
        if self.bytes_read + len(line) > self.max_bytes:
            self.bytes_read = self.max_bytes
            raise _AuditBudgetExceeded("session_audit_timeout:bytes")
        if self.records_read >= self.max_records:
            self.records_read = self.max_records
            raise _AuditBudgetExceeded("session_audit_timeout:records")
        self.bytes_read = min(self.max_bytes, self.bytes_read + len(line))
        self.records_read = min(self.max_records, self.records_read + 1)


def _session_key(value: object) -> str | None:
    if not isinstance(value, (str, int)):
        return None
    normalized = str(value).strip()
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def _safe_scalar(value: object) -> object | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str) and len(value) <= 128:
        normalized = value.strip()
        lowered = normalized.lower()
        if normalized and not any(
            marker in lowered
            for marker in ("authorization", "bearer", "credential", "final", "key", "password", "prompt", "secret", "token", "transcript")
        ) and re.fullmatch(r"[A-Za-z0-9_.:/+\-]+", normalized):
            return normalized
    return None


def _sanitize_record(payload: Mapping[str, Any], *, source: str, record_number: int) -> dict[str, object]:
    """Keep metadata only; never copy payload text, paths, prompts, or IDs."""

    summary: dict[str, object] = {"source": source, "record_number": record_number}
    for key in ("session_id", "thread_id", "id"):
        digest = _session_key(payload.get(key))
        if digest:
            summary["session_key"] = digest
            break
    for key in ("timestamp", "created_at", "updated_at", "status", "model"):
        value = _safe_scalar(payload.get(key))
        if value is not None:
            summary[key] = value
    if source == "rollout":
        for key in ("type", "event", "role"):
            value = _safe_scalar(payload.get(key))
            if isinstance(value, str):
                summary["event_kind"] = value
                break
    return summary


def _path_from_index_row(
    payload: Mapping[str, Any],
    *,
    rollout_root: Path | None,
) -> Path | None:
    raw_path = next(
        (
            payload.get(key)
            for key in ("rollout_path", "rollout", "evidence_path")
            if isinstance(payload.get(key), str) and str(payload.get(key)).strip()
        ),
        None,
    )
    if raw_path is None:
        return None
    candidate = Path(str(raw_path))
    if rollout_root is not None:
        root = rollout_root.resolve()
        candidate = candidate if candidate.is_absolute() else root / candidate
        resolved = candidate.resolve()
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise ValueError("session_audit_rollout_outside_root") from exc
        return resolved
    return candidate.resolve()


def read_bounded_session_evidence(
    session_index_path: Path,
    *,
    rollout_paths: Iterable[Path] = (),
    rollout_root: Path | None = None,
    max_bytes: int = DEFAULT_MAX_BYTES,
    max_records: int = DEFAULT_MAX_RECORDS,
    max_elapsed_seconds: float = DEFAULT_MAX_ELAPSED_SECONDS,
    clock: Callable[[], float] = time.monotonic,
) -> SessionAuditResult:
    """Read local session/rollout metadata without a broad live session list.

    Only the index and explicitly supplied/index-referenced rollout files are
    opened. The aggregate byte, record, and elapsed budgets are enforced while
    reading. Budget exhaustion returns an explicit ``session_audit_timeout:*``
    blocker and sanitized metadata only; it never returns raw JSONL lines.
    """

    if max_bytes <= 0 or max_records <= 0 or max_elapsed_seconds <= 0:
        raise ValueError("session_audit_limits_must_be_positive")
    state = _AuditState(
        max_bytes=max_bytes,
        max_records=max_records,
        max_elapsed_seconds=max_elapsed_seconds,
        clock=clock,
    )
    sanitized: list[dict[str, object]] = []
    referenced_rollouts: list[Path] = []
    seen_paths: set[Path] = set()

    def consume(path: Path, *, source: str) -> None:
        state.check_elapsed()
        try:
            handle = path.open("rb")
        except FileNotFoundError:
            raise FileNotFoundError(f"session_audit_source_missing:{source}") from None
        except OSError as exc:
            raise OSError(f"session_audit_source_unreadable:{source}") from exc
        with handle:
            line_number = 0
            for raw_line in handle:
                state.accept_line(raw_line)
                line_number += 1
                try:
                    payload = json.loads(raw_line)
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise ValueError("session_audit_record_invalid") from exc
                if not isinstance(payload, Mapping):
                    raise ValueError("session_audit_record_invalid")
                sanitized.append(_sanitize_record(payload, source=source, record_number=line_number))
                state.check_elapsed()
                if source == "session_index":
                    referenced = _path_from_index_row(payload, rollout_root=rollout_root)
                    if referenced is not None and referenced not in seen_paths:
                        seen_paths.add(referenced)
                        referenced_rollouts.append(referenced)

    try:
        consume(Path(session_index_path), source="session_index")
        for path in rollout_paths:
            candidate = Path(path).resolve()
            if rollout_root is not None:
                root = rollout_root.resolve()
                try:
                    candidate.relative_to(root)
                except ValueError as exc:
                    raise ValueError("session_audit_rollout_outside_root") from exc
            if candidate not in seen_paths:
                seen_paths.add(candidate)
                referenced_rollouts.append(candidate)
        for path in referenced_rollouts:
            consume(path, source="rollout")
        state.check_elapsed()
    except _AuditBudgetExceeded as exc:
        return SessionAuditResult(
            status="blocked",
            records=tuple(sanitized),
            exact_blocker=exc.blocker,
            bytes_read=state.bytes_read,
            records_read=state.records_read,
            elapsed_seconds=state.elapsed_seconds,
        )
    except (FileNotFoundError, OSError, ValueError) as exc:
        return SessionAuditResult(
            status="blocked",
            records=tuple(sanitized),
            exact_blocker=str(exc),
            bytes_read=state.bytes_read,
            records_read=state.records_read,
            elapsed_seconds=state.elapsed_seconds,
        )
    return SessionAuditResult(
        status="completed",
        records=tuple(sanitized),
        exact_blocker=None,
        bytes_read=state.bytes_read,
        records_read=state.records_read,
        elapsed_seconds=state.elapsed_seconds,
    )


def audit_local_session_evidence(
    session_index_path: Path,
    *,
    rollout_paths: Iterable[Path] = (),
    rollout_root: Path | None = None,
    max_bytes: int = DEFAULT_MAX_BYTES,
    max_records: int = DEFAULT_MAX_RECORDS,
    max_elapsed_seconds: float = DEFAULT_MAX_ELAPSED_SECONDS,
    clock: Callable[[], float] = time.monotonic,
) -> SessionAuditResult:
    """Production-facing bounded local audit adapter.

    The low-level reader owns sanitization and limits. This adapter keeps the
    safe defaults at the production boundary and returns its exact blocker,
    including every ``session_audit_timeout:*`` value, without exposing raw
    transcript data.
    """

    return read_bounded_session_evidence(
        session_index_path,
        rollout_paths=rollout_paths,
        rollout_root=rollout_root,
        max_bytes=max_bytes,
        max_records=max_records,
        max_elapsed_seconds=max_elapsed_seconds,
        clock=clock,
    )
