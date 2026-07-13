from __future__ import annotations

from dataclasses import dataclass
from os import getenv


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


@dataclass(frozen=True)
class CodexArchitecturePolicy:
    architect: CodexLanePolicy
    worker: CodexLanePolicy
    reviewer: CodexLanePolicy
    critical_architect: CodexLanePolicy
    critical_reviewer: CodexLanePolicy
    allowed_models: tuple[str, ...]


@dataclass(frozen=True)
class CodexUxPolicy:
    task_model: str
    review_model: str
    critical_review_model: str
    allowed_models: tuple[str, ...]


def _parse_models(raw_value: str) -> tuple[str, ...]:
    models = tuple(model.strip() for model in raw_value.split(",") if model.strip())
    return models


def _normalize_reasoning_effort(raw_value: str) -> str:
    normalized = raw_value.strip().lower().replace("_", "-")
    return REASONING_EFFORT_ALIASES.get(normalized, normalized)


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
    return CodexUxPolicy(
        task_model=task_model,
        review_model=review_model,
        critical_review_model=critical_review_model,
        allowed_models=allowed_models,
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
        architect=CodexLanePolicy(model=architect_model, reasoning_effort=architect_reasoning_effort),
        worker=CodexLanePolicy(model=worker_model, reasoning_effort=worker_reasoning_effort),
        reviewer=CodexLanePolicy(model=reviewer_model, reasoning_effort=reviewer_reasoning_effort),
        critical_architect=CodexLanePolicy(
            model=critical_architect_model,
            reasoning_effort=critical_architect_reasoning_effort,
        ),
        critical_reviewer=CodexLanePolicy(
            model=critical_reviewer_model,
            reasoning_effort=critical_reviewer_reasoning_effort,
        ),
        allowed_models=ux_policy.allowed_models,
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
