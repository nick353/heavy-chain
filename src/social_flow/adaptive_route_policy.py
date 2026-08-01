"""Project-owned route policy for Adaptive Orchestration tasks."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal


DIRECT_ROOT_BOUNDED_READBACK = "direct_root_bounded_readback"
DIRECT_ROOT = "direct_root"
GRAPH = "graph"


@dataclass(frozen=True)
class AdaptiveRouteDecision:
    """The bounded route selected after applying project-owned policy."""

    route: str
    mode: Literal["direct", "graph"]
    role: Literal["root", "executor"]
    reason: str
    policy_version: str = "adaptive-project-route.v1"


def _flag(payload: Mapping[str, object], *names: str) -> bool:
    return any(payload.get(name) is True for name in names)


def _text(payload: Mapping[str, object]) -> str:
    values = [payload.get("task"), payload.get("description"), payload.get("objective"), payload.get("prompt")]
    return " ".join(
        value.strip().casefold()
        for value in values
        if isinstance(value, str) and value.strip()
    )


def _signals(task: str | Mapping[str, object]) -> dict[str, bool]:
    payload: Mapping[str, object] = {"task": task} if isinstance(task, str) else task
    description = _text(payload)
    kind = str(payload.get("kind") or payload.get("task_kind") or "").strip().casefold()
    return {
        "implementation": _flag(payload, "implementation", "implementation_work", "is_implementation")
        or "implementation" in description,
        "resume": _flag(payload, "resume", "resumption", "cross_session_resume")
        or "resume" in description,
        "cross_session": _flag(payload, "cross_session", "cross_session_audit", "cross_session_evidence_audit")
        or "cross-session" in description
        or "cross session" in description
        or kind in {"cross_session_audit", "cross_session_evidence_audit"},
        "read_only": _flag(payload, "read_only", "readonly", "read_only_audit")
        or "read-only" in description
        or "read only" in description,
        "evidence_only": _flag(payload, "evidence_only", "evidence_audit", "audit_only")
        or "evidence-only" in description
        or "evidence only" in description,
    }


def is_read_only_cross_session_evidence_audit(task: str | Mapping[str, object]) -> bool:
    """Return true only for an evidence-only, read-only cross-session audit."""

    signals = _signals(task)
    return (
        signals["cross_session"]
        and signals["read_only"]
        and signals["evidence_only"]
        and not signals["implementation"]
        and not signals["resume"]
    )


def resolve_adaptive_route(
    task: str | Mapping[str, object],
    *,
    requested_mode: str = "auto",
) -> AdaptiveRouteDecision:
    """Resolve the project route after the generic ``route_task`` result."""

    normalized_mode = requested_mode.strip().casefold()
    if normalized_mode not in {"auto", "direct", "graph"}:
        raise ValueError(f"adaptive_route_mode_invalid:{requested_mode}")
    signals = _signals(task)
    if normalized_mode == "direct":
        return AdaptiveRouteDecision(DIRECT_ROOT, "direct", "root", "explicit_direct_mode")
    if normalized_mode == "graph":
        return AdaptiveRouteDecision(GRAPH, "graph", "executor", "explicit_graph_mode")
    if is_read_only_cross_session_evidence_audit(task):
        return AdaptiveRouteDecision(
            DIRECT_ROOT_BOUNDED_READBACK,
            "direct",
            "root",
            "read_only_cross_session_evidence_audit",
        )
    if signals["implementation"] or signals["resume"]:
        return AdaptiveRouteDecision(
            GRAPH,
            "graph",
            "executor",
            "implementation_or_resume_requires_durable_graph",
        )
    return AdaptiveRouteDecision(DIRECT_ROOT, "direct", "root", "bounded_direct_default")


resolve_project_route = resolve_adaptive_route
