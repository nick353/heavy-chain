from __future__ import annotations

from dataclasses import dataclass
from os import getenv
from typing import Iterable


DEFAULT_WORKER_MODEL = "gpt-5.4-mini"
DEFAULT_CLAUDE_LIKE_TASK_MODEL = DEFAULT_WORKER_MODEL
DEFAULT_ARCHITECT_MODEL = "gpt-5.6-sol"
DEFAULT_REVIEW_MODEL = "gpt-5.6-sol"
DEFAULT_CRITICAL_ARCHITECT_MODEL = "gpt-5.6-sol"
DEFAULT_CRITICAL_REVIEW_MODEL = "gpt-5.6-sol"
DEFAULT_WORKER_REASONING_EFFORT = "medium"
DEFAULT_ARCHITECT_REASONING_EFFORT = "high"
DEFAULT_REVIEW_REASONING_EFFORT = "high"
DEFAULT_CRITICAL_ARCHITECT_REASONING_EFFORT = "high"
DEFAULT_CRITICAL_REVIEW_REASONING_EFFORT = "high"
DEFAULT_ALLOWED_MODELS = (DEFAULT_WORKER_MODEL, DEFAULT_ARCHITECT_MODEL)
DEFAULT_NATIVE_MODEL_FALLBACK_MODELS = (
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex-spark",
)
NATIVE_MODEL_REASONING_EFFORTS = {
    "gpt-5.6-sol": ("low", "medium", "high", "xhigh", "max", "ultra"),
    "gpt-5.6-terra": ("low", "medium", "high", "xhigh", "max", "ultra"),
    "gpt-5.6-luna": ("low", "medium", "high", "xhigh", "max"),
    "gpt-5.5": ("low", "medium", "high", "xhigh"),
    "gpt-5.4": ("low", "medium", "high", "xhigh"),
    "gpt-5.4-mini": ("low", "medium", "high", "xhigh"),
    "gpt-5.3-codex-spark": ("low", "medium", "high", "xhigh"),
}
DEFAULT_MODEL_FALLBACK_CHAINS = {
    "root": ("gpt-5.6-luna", "gpt-5.5", "gpt-5.4"),
    "architect": ("gpt-5.6-terra", "gpt-5.5", "gpt-5.4"),
    "planner": ("gpt-5.6-terra", "gpt-5.5", "gpt-5.4"),
    "reviewer": ("gpt-5.6-terra", "gpt-5.5", "gpt-5.4"),
    "security_reviewer": ("gpt-5.6-terra", "gpt-5.5", "gpt-5.4"),
    "critical_architect": ("gpt-5.6-terra", "gpt-5.5", "gpt-5.4"),
    "critical_reviewer": ("gpt-5.6-terra", "gpt-5.5", "gpt-5.4"),
    "worker": ("gpt-5.4-mini", "gpt-5.4", "gpt-5.6-luna"),
    "executor": ("gpt-5.4-mini", "gpt-5.4", "gpt-5.5"),
    "researcher": ("gpt-5.4-mini", "gpt-5.4", "gpt-5.6-luna"),
    "verifier": ("gpt-5.4-mini", "gpt-5.4", "gpt-5.6-luna"),
}
MODEL_FALLBACK_ELIGIBLE_FAILURES = frozenset(
    {
        "model_unavailable",
        "provider_model_unavailable",
        "model_route_unavailable",
        "provider_timeout",
        "model_timeout",
        "model_rate_limited",
        "no_final_response",
    }
)
ALLOWED_REASONING_EFFORTS = ("minimal", "low", "medium", "high", "xhigh")
REASONING_EFFORT_ALIASES = {
    "extra high": "xhigh",
    "extra-high": "xhigh",
    "x-high": "xhigh",
}


@dataclass(frozen=True)
class CodexLanePolicy:
    model: str
    reasoning_effort: str
    fallback_models: tuple[str, ...] = ()


@dataclass(frozen=True)
class CodexArchitecturePolicy:
    architect: CodexLanePolicy
    worker: CodexLanePolicy
    reviewer: CodexLanePolicy
    critical_architect: CodexLanePolicy
    critical_reviewer: CodexLanePolicy
    allowed_models: tuple[str, ...]
    model_fallback_enabled: bool = True
    fallback_models: tuple[str, ...] = DEFAULT_NATIVE_MODEL_FALLBACK_MODELS


@dataclass(frozen=True)
class CodexUxPolicy:
    task_model: str
    review_model: str
    critical_review_model: str
    allowed_models: tuple[str, ...]
    model_fallback_enabled: bool = True
    fallback_models: tuple[str, ...] = DEFAULT_NATIVE_MODEL_FALLBACK_MODELS


def _parse_models(raw_value: str) -> tuple[str, ...]:
    models = tuple(model.strip() for model in raw_value.split(",") if model.strip())
    return models


def _normalize_reasoning_effort(raw_value: str) -> str:
    normalized = raw_value.strip().lower().replace("_", "-")
    return REASONING_EFFORT_ALIASES.get(normalized, normalized)


def _parse_bool(raw_value: str, *, default: bool) -> bool:
    normalized = raw_value.strip().lower()
    if not normalized:
        return default
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"codex_model_fallback_enabled_invalid:{raw_value}")


def _fallback_models_from_environment() -> tuple[str, ...]:
    configured = _parse_models(getenv("SOCIAL_FLOW_CODEX_FALLBACK_MODELS", ""))
    if not configured:
        return DEFAULT_NATIVE_MODEL_FALLBACK_MODELS
    unknown = tuple(model for model in configured if model not in DEFAULT_NATIVE_MODEL_FALLBACK_MODELS)
    if unknown:
        raise ValueError(f"codex_model_fallback_not_native:{','.join(unknown)}")
    return configured


def model_fallback_candidates(
    model: str,
    *,
    lane: str = "root",
    policy: CodexUxPolicy | None = None,
) -> tuple[str, ...]:
    """Return an ordered native-Codex fallback chain; this is not live availability proof."""

    normalized = model.strip()
    if normalized not in DEFAULT_NATIVE_MODEL_FALLBACK_MODELS:
        raise ValueError(f"codex_model_fallback_not_native:{normalized}")
    active_policy = policy or load_codex_ux_policy()
    ordered = (normalized, *DEFAULT_MODEL_FALLBACK_CHAINS.get(lane, ()))
    allowed = set(active_policy.fallback_models)
    result: list[str] = [normalized]
    for candidate in ordered[1:]:
        if candidate in allowed and candidate not in result:
            result.append(candidate)
    return tuple(result)


def is_model_fallback_eligible(failure_code: str) -> bool:
    """Keep task, safety, auth, and output failures out of model substitution."""

    normalized = failure_code.strip().lower().split(":", 1)[0]
    return normalized in MODEL_FALLBACK_ELIGIBLE_FAILURES


def compatible_reasoning_effort(model: str, requested_effort: str) -> str:
    """Downgrade only when the fallback model does not support the requested effort."""

    normalized_model = model.strip()
    normalized_effort = _normalize_reasoning_effort(requested_effort)
    supported = NATIVE_MODEL_REASONING_EFFORTS.get(normalized_model)
    if supported is None:
        raise ValueError(f"codex_model_fallback_not_native:{normalized_model}")
    if normalized_effort not in ALLOWED_REASONING_EFFORTS and normalized_effort not in {"max", "ultra"}:
        raise ValueError(f"codex_reasoning_effort_not_allowed:{normalized_effort}")
    if normalized_effort in supported:
        return normalized_effort
    ranking = ("minimal", "low", "medium", "high", "xhigh", "max", "ultra")
    requested_rank = ranking.index(normalized_effort)
    supported_ranks = [ranking.index(effort) for effort in supported]
    compatible = [rank for rank in supported_ranks if rank <= requested_rank]
    return ranking[max(compatible)] if compatible else ranking[min(supported_ranks)]


def select_model_fallback(
    model: str,
    *,
    lane: str = "root",
    failure_code: str,
    available_models: Iterable[str] | None = None,
    attempted_models: Iterable[str] = (),
    policy: CodexUxPolicy | None = None,
) -> str | None:
    """Select the first fresh candidate proven by a caller's live preflight."""

    active_policy = policy or load_codex_ux_policy()
    if not active_policy.model_fallback_enabled or not is_model_fallback_eligible(failure_code):
        return None
    if available_models is None:
        return None
    candidates = model_fallback_candidates(model, lane=lane, policy=active_policy)
    attempted = set(attempted_models)
    live_available = set(available_models)
    for candidate in candidates[1:]:
        if candidate in attempted:
            continue
        if candidate not in live_available:
            continue
        return candidate
    return None


def build_model_fallback_receipt(
    *,
    role: str,
    requested_model: str,
    selected_model: str,
    failure_code: str,
    attempted_models: Iterable[str],
    requested_reasoning_effort: str | None = None,
    selected_reasoning_effort: str | None = None,
    tool_name: str | None = None,
    thread_id: str | None = None,
    host_id: str | None = None,
) -> dict[str, object]:
    """Create the bounded evidence record required when a native model changes."""

    receipt: dict[str, object] = {
        "schema": "model_fallback.v1",
        "provider": "codex-native",
        "role": role,
        "requested_model": requested_model,
        "selected_model": selected_model,
        "failure_code": failure_code,
        "attempted_models": list(attempted_models),
        "requested_reasoning_effort": requested_reasoning_effort,
        "selected_reasoning_effort": selected_reasoning_effort,
        "fallback": requested_model != selected_model,
    }
    provenance = {
        key: value
        for key, value in (
            ("tool", tool_name),
            ("thread_id", thread_id),
            ("host_id", host_id),
        )
        if value
    }
    if provenance:
        receipt["tool_thread_provenance"] = provenance
    return receipt


def validate_codex_reasoning_effort(reasoning_effort: str) -> str:
    normalized = _normalize_reasoning_effort(reasoning_effort)
    if not normalized:
        raise ValueError("codex_reasoning_effort_missing")
    if normalized not in ALLOWED_REASONING_EFFORTS:
        raise ValueError(
            f"codex_reasoning_effort_not_allowed:{normalized}:allowed={','.join(ALLOWED_REASONING_EFFORTS)}"
        )
    return normalized


def load_codex_ux_policy() -> CodexUxPolicy:
    allowed_models = _parse_models(getenv("SOCIAL_FLOW_ALLOWED_CODEX_MODELS", ""))
    if not allowed_models:
        allowed_models = DEFAULT_ALLOWED_MODELS
    task_model = getenv("OPENAI_MODEL", DEFAULT_WORKER_MODEL).strip() or DEFAULT_WORKER_MODEL
    review_model = getenv("SOCIAL_FLOW_REVIEW_MODEL", DEFAULT_REVIEW_MODEL).strip() or DEFAULT_REVIEW_MODEL
    critical_review_model = (
        getenv("SOCIAL_FLOW_CRITICAL_REVIEW_MODEL", DEFAULT_CRITICAL_REVIEW_MODEL).strip()
        or DEFAULT_CRITICAL_REVIEW_MODEL
    )
    model_fallback_enabled = _parse_bool(
        getenv("SOCIAL_FLOW_MODEL_FALLBACK_ENABLED", "true"),
        default=True,
    )
    return CodexUxPolicy(
        task_model=task_model,
        review_model=review_model,
        critical_review_model=critical_review_model,
        allowed_models=allowed_models,
        model_fallback_enabled=model_fallback_enabled,
        fallback_models=_fallback_models_from_environment(),
    )


def load_codex_architecture_policy() -> CodexArchitecturePolicy:
    ux_policy = load_codex_ux_policy()
    worker_model = validate_codex_model_choice(ux_policy.task_model, ux_policy)
    reviewer_model = validate_codex_model_choice(ux_policy.review_model, ux_policy)
    critical_reviewer_model = validate_codex_model_choice(ux_policy.critical_review_model, ux_policy)
    critical_architect_model = validate_codex_model_choice(
        getenv("SOCIAL_FLOW_CRITICAL_ARCHITECT_MODEL", DEFAULT_CRITICAL_ARCHITECT_MODEL).strip()
        or DEFAULT_CRITICAL_ARCHITECT_MODEL,
        ux_policy,
    )
    architect_model = validate_codex_model_choice(
        getenv("SOCIAL_FLOW_ARCHITECT_MODEL", DEFAULT_ARCHITECT_MODEL).strip() or DEFAULT_ARCHITECT_MODEL,
        ux_policy,
    )
    worker_reasoning_effort = validate_codex_reasoning_effort(
        getenv("SOCIAL_FLOW_WORKER_REASONING_EFFORT", DEFAULT_WORKER_REASONING_EFFORT).strip()
        or DEFAULT_WORKER_REASONING_EFFORT
    )
    architect_reasoning_effort = validate_codex_reasoning_effort(
        getenv("SOCIAL_FLOW_ARCHITECT_REASONING_EFFORT", DEFAULT_ARCHITECT_REASONING_EFFORT).strip()
        or DEFAULT_ARCHITECT_REASONING_EFFORT
    )
    reviewer_reasoning_effort = validate_codex_reasoning_effort(
        getenv("SOCIAL_FLOW_REVIEW_REASONING_EFFORT", DEFAULT_REVIEW_REASONING_EFFORT).strip()
        or DEFAULT_REVIEW_REASONING_EFFORT
    )
    critical_architect_reasoning_effort = validate_codex_reasoning_effort(
        getenv(
            "SOCIAL_FLOW_CRITICAL_ARCHITECT_REASONING_EFFORT",
            DEFAULT_CRITICAL_ARCHITECT_REASONING_EFFORT,
        ).strip()
        or DEFAULT_CRITICAL_ARCHITECT_REASONING_EFFORT
    )
    critical_reviewer_reasoning_effort = validate_codex_reasoning_effort(
        getenv("SOCIAL_FLOW_CRITICAL_REVIEW_REASONING_EFFORT", DEFAULT_CRITICAL_REVIEW_REASONING_EFFORT).strip()
        or DEFAULT_CRITICAL_REVIEW_REASONING_EFFORT
    )
    return CodexArchitecturePolicy(
        architect=CodexLanePolicy(
            model=architect_model,
            reasoning_effort=architect_reasoning_effort,
            fallback_models=model_fallback_candidates(architect_model, lane="architect", policy=ux_policy)[1:],
        ),
        worker=CodexLanePolicy(
            model=worker_model,
            reasoning_effort=worker_reasoning_effort,
            fallback_models=model_fallback_candidates(worker_model, lane="worker", policy=ux_policy)[1:],
        ),
        reviewer=CodexLanePolicy(
            model=reviewer_model,
            reasoning_effort=reviewer_reasoning_effort,
            fallback_models=model_fallback_candidates(reviewer_model, lane="reviewer", policy=ux_policy)[1:],
        ),
        critical_architect=CodexLanePolicy(
            model=critical_architect_model,
            reasoning_effort=critical_architect_reasoning_effort,
            fallback_models=model_fallback_candidates(
                critical_architect_model, lane="critical_architect", policy=ux_policy
            )[1:],
        ),
        critical_reviewer=CodexLanePolicy(
            model=critical_reviewer_model,
            reasoning_effort=critical_reviewer_reasoning_effort,
            fallback_models=model_fallback_candidates(
                critical_reviewer_model, lane="critical_reviewer", policy=ux_policy
            )[1:],
        ),
        allowed_models=ux_policy.allowed_models,
        model_fallback_enabled=ux_policy.model_fallback_enabled,
        fallback_models=ux_policy.fallback_models,
    )


def validate_codex_model_choice(model: str, policy: CodexUxPolicy | None = None) -> str:
    active_policy = policy or load_codex_ux_policy()
    normalized = model.strip()
    if not normalized:
        raise ValueError("codex_model_choice_missing")
    if normalized not in active_policy.allowed_models:
        raise ValueError(
            f"codex_model_choice_not_allowed:{normalized}:allowed={','.join(active_policy.allowed_models)}"
        )
    return normalized
