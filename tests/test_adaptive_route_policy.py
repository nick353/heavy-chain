from __future__ import annotations

from social_flow.adaptive_route_policy import (
    DIRECT_ROOT_BOUNDED_READBACK,
    GRAPH,
    resolve_adaptive_route,
)


def test_auto_routes_read_only_cross_session_evidence_audit_to_direct_root() -> None:
    decision = resolve_adaptive_route(
        {"cross_session": True, "read_only": True, "evidence_only": True}
    )

    assert decision.route == DIRECT_ROOT_BOUNDED_READBACK
    assert decision.mode == "direct"
    assert decision.role == "root"


def test_auto_keeps_implementation_and_resume_work_on_graph() -> None:
    implementation = resolve_adaptive_route({"implementation": True})
    resume = resolve_adaptive_route({"resume": True, "read_only": True})

    assert implementation.route == GRAPH
    assert implementation.role == "executor"
    assert resume.route == GRAPH
    assert resume.role == "executor"


def test_explicit_mode_overrides_project_auto_policy() -> None:
    task = {"cross_session": True, "read_only": True, "evidence_only": True}

    assert resolve_adaptive_route(task, requested_mode="graph").route == GRAPH
