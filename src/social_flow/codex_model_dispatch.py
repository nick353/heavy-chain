from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Generic, Iterable, TypeVar

from social_flow.codex_policy import (
    DEFAULT_MODEL_FALLBACK_CHAINS,
    CodexUxPolicy,
    build_model_fallback_receipt,
    compatible_reasoning_effort,
    is_model_fallback_eligible,
    load_codex_ux_policy,
    model_fallback_candidates,
)


T = TypeVar("T")


class NativeModelDispatchError(RuntimeError):
    """A dispatch failure that may be eligible for native model fallback."""

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
