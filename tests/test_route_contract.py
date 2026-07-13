from __future__ import annotations

from social_flow.route_contract import (
    RouteAxisState,
    build_route_contract_v1,
    route_contract_blockers,
    route_contract_ready,
    route_contract_to_dict,
)


def test_route_contract_flags_identity_mismatch_and_missing_proof() -> None:
    contract = build_route_contract_v1(
        required_surface="chrome_plugin",
        fallback_allowed=True,
        subject="publish",
        identity_hint="Chrome plugin registered runner",
        resource_scope="purpose:publish",
        decision_state=RouteAxisState(
            configured=True,
            enabled=True,
            verified=True,
            connected=True,
        ),
        readback_state=RouteAxisState(
            configured=True,
            enabled=True,
            verified=True,
            connected=True,
        ),
        observed_surface="chrome_plugin",
        observed_identity="Chrome Extension Profile 2",
        evidence_ref="",
        required_proof=True,
    )

    blockers = route_contract_blockers(contract)

    assert "identity_mismatch:expected=Chrome plugin registered runner:observed=Chrome Extension Profile 2" in blockers
    assert "proof_insufficient:missing_evidence_ref" in blockers
    assert route_contract_ready(contract) is False
    payload = route_contract_to_dict(contract)
    assert payload["ready"] is False
    assert payload["decision"]["required_surface"] == "chrome_plugin"


def test_route_contract_is_ready_when_axes_align() -> None:
    contract = build_route_contract_v1(
        required_surface="chrome_plugin",
        fallback_allowed=True,
        subject="engagement",
        identity_hint="Chrome plugin registered runner",
        resource_scope="purpose:engagement",
        decision_state=RouteAxisState(
            configured=True,
            enabled=True,
            verified=True,
            connected=True,
        ),
        readback_state=RouteAxisState(
            configured=True,
            enabled=True,
            verified=True,
            connected=True,
        ),
        observed_surface="chrome_plugin",
        observed_identity="Chrome plugin registered runner",
        evidence_ref="cdp:/json/version:9333",
    )

    assert route_contract_blockers(contract) == []
    assert route_contract_ready(contract) is True
    payload = route_contract_to_dict(contract)
    assert payload["ready"] is True
    assert payload["blockers"] == []
