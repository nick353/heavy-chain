from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class RouteAxisState:
    configured: bool
    enabled: bool
    verified: bool
    connected: bool


@dataclass(frozen=True)
class RouteDecisionV1:
    required_surface: str
    fallback_allowed: bool
    subject: str = ""
    identity_hint: str = ""
    resource_scope: str = ""
    policy_version: str = "route-contract.v1"


@dataclass(frozen=True)
class RouteReadbackV1:
    observed_surface: str = ""
    observed_identity: str = ""
    evidence_ref: str = ""
    observed_at: str = ""
    proof_ref: str = ""
    policy_version: str = "route-contract.v1"


@dataclass(frozen=True)
class RouteContractV1:
    decision: RouteDecisionV1
    decision_state: RouteAxisState
    readback: RouteReadbackV1
    readback_state: RouteAxisState
    required_proof: bool = False


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_route_contract_v1(
    *,
    required_surface: str,
    fallback_allowed: bool,
    decision_state: RouteAxisState,
    readback_state: RouteAxisState,
    subject: str = "",
    identity_hint: str = "",
    resource_scope: str = "",
    observed_surface: str = "",
    observed_identity: str = "",
    evidence_ref: str = "",
    proof_ref: str = "",
    observed_at: str = "",
    required_proof: bool = False,
) -> RouteContractV1:
    return RouteContractV1(
        decision=RouteDecisionV1(
            required_surface=required_surface.strip(),
            fallback_allowed=fallback_allowed,
            subject=subject.strip(),
            identity_hint=identity_hint.strip(),
            resource_scope=resource_scope.strip(),
        ),
        decision_state=decision_state,
        readback=RouteReadbackV1(
            observed_surface=observed_surface.strip(),
            observed_identity=observed_identity.strip(),
            evidence_ref=evidence_ref.strip(),
            observed_at=observed_at.strip() or _utc_now_iso(),
            proof_ref=proof_ref.strip(),
        ),
        readback_state=readback_state,
        required_proof=required_proof,
    )


def route_contract_blockers(contract: RouteContractV1) -> list[str]:
    blockers: list[str] = []

    required_surface = contract.decision.required_surface.strip()
    if not required_surface:
        return ["authority_missing:required_surface_missing"]

    if not contract.decision_state.configured:
        blockers.append("lane_unavailable:surface_not_configured")
    if not contract.decision_state.enabled:
        blockers.append("authority_missing:surface_disabled")
    if not contract.decision_state.verified:
        blockers.append("reachability_only:surface_unverified")
    if not contract.decision_state.connected:
        blockers.append("reachability_only:surface_not_connected")

    observed_surface = contract.readback.observed_surface.strip()
    if observed_surface and observed_surface != required_surface:
        blockers.append(
            f"identity_mismatch:surface_expected={required_surface}:surface_observed={observed_surface}"
        )

    expected_identity = contract.decision.identity_hint.strip()
    observed_identity = contract.readback.observed_identity.strip()
    if expected_identity and observed_identity and expected_identity != observed_identity:
        blockers.append(
            f"identity_mismatch:expected={expected_identity}:observed={observed_identity}"
        )

    if contract.required_proof and not contract.readback.evidence_ref.strip():
        blockers.append("proof_insufficient:missing_evidence_ref")

    return blockers


def route_contract_ready(contract: RouteContractV1) -> bool:
    return not route_contract_blockers(contract)


def route_contract_to_dict(contract: RouteContractV1) -> dict[str, Any]:
    blockers = route_contract_blockers(contract)
    payload = asdict(contract)
    payload["blockers"] = blockers
    payload["ready"] = not blockers
    return payload
