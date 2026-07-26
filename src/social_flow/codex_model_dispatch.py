from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Callable, Generic, Iterable, TypeVar

from social_flow.codex_policy import (
    DEFAULT_MODEL_FALLBACK_CHAINS,
    OPENCODE_GO_PROVIDER,
    CodexUxPolicy,
    build_model_fallback_receipt,
    compatible_reasoning_effort,
    is_model_fallback_eligible,
    load_codex_ux_policy,
    model_fallback_candidates,
    select_opencode_go_reviewer_model,
    validate_opencode_go_model,
)


T = TypeVar("T")


class NativeModelDispatchError(RuntimeError):
    """A dispatch failure that may be eligible for native model fallback."""

    def __init__(self, failure_code: str, message: str | None = None) -> None:
        self.failure_code = failure_code.strip().lower().split(":", 1)[0]
        super().__init__(message or self.failure_code)


class OpenCodeGoModelDispatchError(RuntimeError):
    """A structured OpenCode Go failure; only model-level failures may retry."""

    def __init__(self, failure_code: str, message: str | None = None) -> None:
        self.failure_code = failure_code.strip().lower().split(":", 1)[0]
        super().__init__(message or self.failure_code)


@dataclass(frozen=True)
class NativeDispatchAttempt:
    model: str
    reasoning_effort: str
    status: str
    failure_code: str | None = None


@dataclass(frozen=True)
class NativeDispatchResult(Generic[T]):
    value: T
    selected_model: str
    selected_reasoning_effort: str
    attempts: tuple[NativeDispatchAttempt, ...]
    fallback_receipt: dict[str, object] | None


@dataclass(frozen=True)
class OpenCodeGoModelPreflight:
    """Verified metadata from the current OpenCode Go route preflight."""

    provider: str
    model: str
    bridge_version: str


@dataclass(frozen=True)
class OpenCodeGoDispatchResponse(Generic[T]):
    """Normalized direct-MCP response required before accepting a review."""

    value: T
    provider: str
    model: str
    bridge_version: str
    request_id: str
    usage: Mapping[str, object]
    bounded_output: bool = True


@dataclass(frozen=True)
class OpenCodeGoDispatchAttempt:
    model: str
    status: str
    failure_code: str | None = None


@dataclass(frozen=True)
class OpenCodeGoDispatchResult(Generic[T]):
    value: T
    selected_model: str
    bridge_version: str
    request_id: str
    usage: Mapping[str, object]
    attempts: tuple[OpenCodeGoDispatchAttempt, ...]
    fallback_receipt: dict[str, object] | None


def _validate_opencode_go_preflight(
    model: str,
    preflight: OpenCodeGoModelPreflight,
    supported_bridge_versions: set[str],
) -> None:
    validate_opencode_go_model(model)
    if preflight.provider != OPENCODE_GO_PROVIDER:
        raise OpenCodeGoModelDispatchError("opencode_go_provider_metadata_mismatch")
    if preflight.model != model:
        raise OpenCodeGoModelDispatchError("opencode_go_model_metadata_mismatch")
    if not preflight.bridge_version or preflight.bridge_version not in supported_bridge_versions:
        raise OpenCodeGoModelDispatchError("opencode_go_bridge_version_unsupported")


def _validate_opencode_go_response(
    model: str,
    response: OpenCodeGoDispatchResponse[T],
    preflight: OpenCodeGoModelPreflight,
    supported_bridge_versions: set[str],
) -> None:
    if response.provider != OPENCODE_GO_PROVIDER:
        raise OpenCodeGoModelDispatchError("opencode_go_provider_metadata_mismatch")
    if response.model != model or response.model != preflight.model:
        raise OpenCodeGoModelDispatchError("opencode_go_model_metadata_mismatch")
    if response.bridge_version != preflight.bridge_version or response.bridge_version not in supported_bridge_versions:
        raise OpenCodeGoModelDispatchError("opencode_go_bridge_version_unsupported")
    if not response.request_id:
        raise OpenCodeGoModelDispatchError("opencode_go_request_id_missing")
    if not isinstance(response.usage, Mapping) or not response.usage:
        raise OpenCodeGoModelDispatchError("opencode_go_usage_missing")
    if response.bounded_output is not True or response.value is None:
        raise OpenCodeGoModelDispatchError("opencode_go_bounded_output_missing")


def dispatch_opencode_go_reviewer_with_fallback(
    dispatch: Callable[[str], OpenCodeGoDispatchResponse[T]],
    *,
    available_models: Iterable[str],
    preflight: Mapping[str, OpenCodeGoModelPreflight],
    supported_bridge_versions: Iterable[str],
    preferred_model: str | None = None,
    policy: CodexUxPolicy | None = None,
    role: str = "reviewer",
    tool_name: str | None = None,
) -> OpenCodeGoDispatchResult[T]:
    """Dispatch the standard reviewer through direct OpenCode Go MCP.

    ``available_models`` and ``preflight`` must be fresh for this invocation.
    No OpenCode model ID is passed to native Codex agent APIs. Provider,
    bridge, request, usage, and bounded-output failures are hard failures;
    only structured model-level failures can advance to another live model in
    the same OpenCode Go reviewer role.
    """

    if role != "reviewer":
        raise ValueError(f"opencode_go_role_not_supported:{role}")
    active_policy = policy or load_codex_ux_policy()
    supported = {version.strip() for version in supported_bridge_versions if version.strip()}
    if not supported:
        raise OpenCodeGoModelDispatchError("opencode_go_supported_bridge_versions_missing")
    live_available = {model.strip() for model in available_models}
    configured = tuple(validate_opencode_go_model(model) for model in active_policy.opencode_go_reviewer_models)
    selected = select_opencode_go_reviewer_model(
        live_available,
        preferred_model=preferred_model,
        policy=active_policy,
    )
    if selected is None:
        raise OpenCodeGoModelDispatchError("opencode_go_reviewer_route_unavailable")
    candidates = (selected, *(model for model in configured if model != selected))
    attempts: list[OpenCodeGoDispatchAttempt] = []
    attempted_models: list[str] = []
    failure_code: str | None = None

    for model in candidates:
        if model not in live_available or model not in preflight or model in attempted_models:
            continue
        route_preflight = preflight[model]
        _validate_opencode_go_preflight(model, route_preflight, supported)
        attempted_models.append(model)
        try:
            response = dispatch(model)
            _validate_opencode_go_response(model, response, route_preflight, supported)
        except OpenCodeGoModelDispatchError as exc:
            failure_code = exc.failure_code
            attempts.append(OpenCodeGoDispatchAttempt(model=model, status="failed", failure_code=failure_code))
            if not is_model_fallback_eligible(failure_code):
                raise
            continue
        except Exception:
            attempts.append(
                OpenCodeGoDispatchAttempt(
                    model=model,
                    status="failed",
                    failure_code="unclassified_dispatch_error",
                )
            )
            raise

        attempts.append(OpenCodeGoDispatchAttempt(model=model, status="completed"))
        receipt = None
        if model != selected:
            receipt = build_model_fallback_receipt(
                role=role,
                requested_model=selected,
                selected_model=model,
                failure_code=failure_code or "model_unavailable",
                attempted_models=attempted_models,
                tool_name=tool_name,
                provider=OPENCODE_GO_PROVIDER,
            )
            receipt["route"] = {
                "bridge_version": response.bridge_version,
                "request_id": response.request_id,
                "usage": dict(response.usage),
                "bounded_output": response.bounded_output,
            }
        return OpenCodeGoDispatchResult(
            value=response.value,
            selected_model=model,
            bridge_version=response.bridge_version,
            request_id=response.request_id,
            usage=response.usage,
            attempts=tuple(attempts),
            fallback_receipt=receipt,
        )

    if failure_code:
        raise OpenCodeGoModelDispatchError(
            failure_code,
            f"{failure_code}: all OpenCode Go reviewer fallback candidates failed",
        )
    raise OpenCodeGoModelDispatchError("opencode_go_reviewer_route_unavailable")


def dispatch_native_model_with_fallback(
    dispatch: Callable[[str, str], T],
    *,
    role: str,
    primary_model: str,
    reasoning_effort: str,
    available_models: Iterable[str],
    lane: str | None = None,
    policy: CodexUxPolicy | None = None,
    tool_name: str | None = None,
    thread_id: str | None = None,
    host_id: str | None = None,
) -> NativeDispatchResult[T]:
    """Run a native role and retry only model-level failures.

    ``available_models`` must come from the caller's fresh model preflight. The
    wrapper never probes providers itself and never falls back across providers.
    The callback must raise ``NativeModelDispatchError`` for a structured model
    failure; other exceptions remain hard failures and are not substituted. When
    the callback wraps a Codex App high-level tool, pass its tool/thread/host
    identifiers so the fallback receipt preserves same-thread provenance.
    """

    if lane is not None and role in DEFAULT_MODEL_FALLBACK_CHAINS and lane != role:
        raise ValueError(f"codex_model_fallback_role_lane_mismatch:{role}:{lane}")
    effective_lane = lane or (role if role in DEFAULT_MODEL_FALLBACK_CHAINS else "root")
    active_policy = policy or load_codex_ux_policy()
    if active_policy.model_fallback_enabled:
        candidates = model_fallback_candidates(primary_model, lane=effective_lane, policy=active_policy)
    else:
        candidates = (primary_model,)
    live_available = set(available_models)
    attempted: list[str] = []
    attempts: list[NativeDispatchAttempt] = []
    failure_code: str | None = None

    for model in candidates:
        if model != primary_model and model not in live_available:
            continue
        if model in attempted:
            continue
        attempted.append(model)
        effort = compatible_reasoning_effort(model, reasoning_effort)
        try:
            value = dispatch(model, effort)
        except NativeModelDispatchError as exc:
            failure_code = exc.failure_code
            attempts.append(
                NativeDispatchAttempt(
                    model=model,
                    reasoning_effort=effort,
                    status="failed",
                    failure_code=failure_code,
                )
            )
            if not is_model_fallback_eligible(failure_code):
                raise
            continue
        except Exception:
            attempts.append(
                NativeDispatchAttempt(
                    model=model,
                    reasoning_effort=effort,
                    status="failed",
                    failure_code="unclassified_dispatch_error",
                )
            )
            raise

        attempts.append(NativeDispatchAttempt(model=model, reasoning_effort=effort, status="completed"))
        receipt = None
        if model != primary_model:
            receipt = build_model_fallback_receipt(
                role=role,
                requested_model=primary_model,
                selected_model=model,
                failure_code=failure_code or "model_unavailable",
                attempted_models=attempted,
                requested_reasoning_effort=reasoning_effort,
                selected_reasoning_effort=effort,
                tool_name=tool_name,
                thread_id=thread_id,
                host_id=host_id,
            )
        return NativeDispatchResult(
            value=value,
            selected_model=model,
            selected_reasoning_effort=effort,
            attempts=tuple(attempts),
            fallback_receipt=receipt,
        )

    if failure_code:
        raise NativeModelDispatchError(
            failure_code,
            f"{failure_code}: all native model fallback candidates failed",
        )
    raise NativeModelDispatchError("model_unavailable", "no live native model fallback candidate")
