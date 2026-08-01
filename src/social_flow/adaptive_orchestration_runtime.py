"""Production-facing boundary for bounded Adaptive session audits."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
import time

from social_flow.adaptive_route_policy import AdaptiveRouteDecision, resolve_adaptive_route
from social_flow.adaptive_session_audit import (
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_ELAPSED_SECONDS,
    DEFAULT_MAX_RECORDS,
    SessionAuditResult,
    audit_local_session_evidence,
)


SAFE_MAX_BYTES = DEFAULT_MAX_BYTES
SAFE_MAX_RECORDS = DEFAULT_MAX_RECORDS
SAFE_MAX_ELAPSED_SECONDS = DEFAULT_MAX_ELAPSED_SECONDS


def resolve_project_adaptive_route(
    task: str | Mapping[str, object],
    *,
    requested_mode: str = "auto",
) -> AdaptiveRouteDecision:
    """Resolve the project route at the production orchestration boundary."""

    return resolve_adaptive_route(task, requested_mode=requested_mode)


def audit_adaptive_session_evidence(
    session_index_path: Path,
    *,
    rollout_paths: Iterable[Path] = (),
    rollout_root: Path | None = None,
    max_bytes: int = SAFE_MAX_BYTES,
    max_records: int = SAFE_MAX_RECORDS,
    max_elapsed_seconds: float = SAFE_MAX_ELAPSED_SECONDS,
    clock: Callable[[], float] = time.monotonic,
) -> SessionAuditResult:
    """Audit local session evidence through the explicit runtime boundary."""

    return audit_local_session_evidence(
        session_index_path,
        rollout_paths=rollout_paths,
        rollout_root=rollout_root,
        max_bytes=max_bytes,
        max_records=max_records,
        max_elapsed_seconds=max_elapsed_seconds,
        clock=clock,
    )
