from __future__ import annotations

import json
from pathlib import Path

from social_flow.codex_policy import (
    DEFAULT_OPENCODE_GO_REVIEWER_MODELS,
    DEFAULT_NATIVE_MODEL_FALLBACK_MODELS,
    OPENCODE_GO_PROVIDER,
    CodexArchitecturePolicy,
    CodexLanePolicy,
    CodexUxPolicy,
    compatible_reasoning_effort,
    load_codex_architecture_policy,
    load_codex_ux_policy,
    model_fallback_candidates,
    select_opencode_go_reviewer_model,
    select_model_fallback,
    validate_codex_reasoning_effort,
)


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


def _load_adaptive_manifest() -> dict:
    return json.loads(_read("docs/adaptive-orchestration-manifest.v1.json"))


def test_codex_architecture_policy_defaults_to_legacy_social_flow_lanes(monkeypatch) -> None:
    monkeypatch.delenv("SOCIAL_FLOW_ALLOWED_CODEX_MODELS", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_REVIEW_MODEL", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_CRITICAL_REVIEW_MODEL", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_MODEL_FALLBACK_ENABLED", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_CODEX_FALLBACK_MODELS", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_ARCHITECT_MODEL", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_CRITICAL_ARCHITECT_MODEL", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_WORKER_REASONING_EFFORT", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_ARCHITECT_REASONING_EFFORT", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_REVIEW_REASONING_EFFORT", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_CRITICAL_ARCHITECT_REASONING_EFFORT", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_CRITICAL_REVIEW_REASONING_EFFORT", raising=False)

    policy = load_codex_architecture_policy()

    assert policy == CodexArchitecturePolicy(
        architect=CodexLanePolicy(
            model="gpt-5.6-sol",
            reasoning_effort="high",
            fallback_models=("gpt-5.6-terra", "gpt-5.5", "gpt-5.4"),
        ),
        worker=CodexLanePolicy(
            model="gpt-5.4-mini",
            reasoning_effort="medium",
            fallback_models=("gpt-5.4", "gpt-5.6-luna"),
        ),
        reviewer=CodexLanePolicy(
            model="runtime-selected",
            reasoning_effort="route-defined",
            fallback_models=DEFAULT_OPENCODE_GO_REVIEWER_MODELS,
            provider=OPENCODE_GO_PROVIDER,
        ),
        critical_architect=CodexLanePolicy(
            model="gpt-5.6-sol",
            reasoning_effort="high",
            fallback_models=("gpt-5.6-terra", "gpt-5.5", "gpt-5.4"),
        ),
        critical_reviewer=CodexLanePolicy(
            model="gpt-5.6-sol",
            reasoning_effort="high",
            fallback_models=("gpt-5.6-terra", "gpt-5.5", "gpt-5.4"),
        ),
        allowed_models=("gpt-5.4-mini", "gpt-5.6-sol"),
        model_fallback_enabled=True,
        fallback_models=DEFAULT_NATIVE_MODEL_FALLBACK_MODELS,
    )
    assert load_codex_ux_policy() == CodexUxPolicy(
        task_model="gpt-5.4-mini",
        review_model="gpt-5.6-sol",
        critical_review_model="gpt-5.6-sol",
        allowed_models=("gpt-5.4-mini", "gpt-5.6-sol"),
        model_fallback_enabled=True,
        fallback_models=DEFAULT_NATIVE_MODEL_FALLBACK_MODELS,
    )


def test_native_model_fallback_is_ordered_and_requires_live_availability(monkeypatch) -> None:
    monkeypatch.delenv("SOCIAL_FLOW_MODEL_FALLBACK_ENABLED", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_CODEX_FALLBACK_MODELS", raising=False)

    assert model_fallback_candidates("gpt-5.6-sol", lane="reviewer") == (
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.5",
        "gpt-5.4",
    )
    assert select_model_fallback(
        "gpt-5.6-sol",
        lane="reviewer",
        failure_code="model_unavailable:requested model is not listed",
        available_models={"gpt-5.5", "gpt-5.4"},
        attempted_models={"gpt-5.6-sol"},
    ) == "gpt-5.5"
    assert select_model_fallback(
        "gpt-5.6-sol",
        lane="reviewer",
        failure_code="malformed_output",
        available_models={"gpt-5.5"},
        attempted_models={"gpt-5.6-sol"},
    ) is None
    assert compatible_reasoning_effort("gpt-5.5", "max") == "xhigh"
    assert compatible_reasoning_effort("gpt-5.6-terra", "max") == "max"

    assert select_model_fallback(
        "gpt-5.6-sol",
        lane="reviewer",
        failure_code="model_unavailable",
        attempted_models={"gpt-5.6-sol"},
    ) is None


def test_native_model_fallback_can_be_disabled(monkeypatch) -> None:
    monkeypatch.setenv("SOCIAL_FLOW_MODEL_FALLBACK_ENABLED", "false")
    policy = load_codex_ux_policy()
    assert policy.model_fallback_enabled is False
    assert select_model_fallback(
        "gpt-5.6-sol",
        failure_code="provider_timeout",
        available_models={"gpt-5.5"},
        policy=policy,
    ) is None


def test_opencode_go_reviewer_model_is_selected_from_fresh_live_capability(monkeypatch) -> None:
    monkeypatch.delenv("SOCIAL_FLOW_OPENCODE_GO_REVIEWER_MODELS", raising=False)
    policy = load_codex_ux_policy()

    assert policy.opencode_go_reviewer_models == DEFAULT_OPENCODE_GO_REVIEWER_MODELS
    architecture_policy = load_codex_architecture_policy()
    assert architecture_policy.reviewer.provider == OPENCODE_GO_PROVIDER
    assert architecture_policy.reviewer.model == "runtime-selected"
    assert architecture_policy.reviewer.fallback_models == DEFAULT_OPENCODE_GO_REVIEWER_MODELS
    assert select_opencode_go_reviewer_model(
        {"opencode-go/deepseek-v4-flash"},
        policy=policy,
    ) == "opencode-go/deepseek-v4-flash"
    assert select_opencode_go_reviewer_model(
        {"opencode-go/mimo-v2.5-pro", "opencode-go/deepseek-v4-pro"},
        policy=policy,
    ) == "opencode-go/deepseek-v4-pro"


def test_opencode_go_reviewer_model_order_can_be_set_without_persisting_a_selection(monkeypatch) -> None:
    monkeypatch.setenv(
        "SOCIAL_FLOW_OPENCODE_GO_REVIEWER_MODELS",
        "opencode-go/mimo-v2.5-pro,opencode-go/deepseek-v4-flash",
    )
    policy = load_codex_ux_policy()

    assert policy.opencode_go_reviewer_models == (
        "opencode-go/mimo-v2.5-pro",
        "opencode-go/deepseek-v4-flash",
    )
    assert select_opencode_go_reviewer_model(
        {"opencode-go/deepseek-v4-flash"},
        policy=policy,
    ) == "opencode-go/deepseek-v4-flash"


def test_validate_codex_reasoning_effort_accepts_extra_high_alias() -> None:
    assert validate_codex_reasoning_effort("xhigh") == "xhigh"
    assert validate_codex_reasoning_effort("extra high") == "xhigh"


def test_codex_architecture_mode_files_pin_role_routing() -> None:
    doc = _read("docs/codex-architecture-mode.md")
    ux_contract = _read("docs/codex-ux-contract.md")
    agents_dir = ".codex/agents"
    architect = _read(f"{agents_dir}/architect.toml")
    workers = {
        "worker_gpt_5_3_codex_spark": ("gpt-5.3-codex-spark", _read(f"{agents_dir}/worker_gpt_5_3_codex_spark.toml")),
        "worker_gpt_5_4": ("gpt-5.4", _read(f"{agents_dir}/worker_gpt_5_4.toml")),
        "worker_gpt_5_4_mini": ("gpt-5.4-mini", _read(f"{agents_dir}/worker_gpt_5_4_mini.toml")),
        "worker_gpt_5_5": ("gpt-5.5", _read(f"{agents_dir}/worker_gpt_5_5.toml")),
    }
    reviewer = _read(f"{agents_dir}/reviewer.toml")
    critical_architect = _read(f"{agents_dir}/critical_architect.toml")
    critical_reviewer = _read(f"{agents_dir}/critical_reviewer.toml")
    agents_text = "\n".join((architect, *(text for _, text in workers.values()), reviewer, critical_architect, critical_reviewer))

    assert "architect-as-orchestrator" in doc
    assert "Shann-inspired" in doc
    assert "effective starting parent" in doc
    assert "v3 marker" in doc
    assert "static model pin" in doc
    assert "gpt-5.6-sol / max" in doc
    assert "Codex App" in doc
    assert "fable-advisor" in doc
    assert "codex-architecture-mode.md" in ux_contract
    assert ".codex/agents/architect.toml" in ux_contract
    assert "worker_gpt_*" in ux_contract
    assert ".codex/agents/reviewer.toml" in ux_contract
    assert ".codex/agents/critical_architect.toml" in ux_contract
    assert not (REPO_ROOT / agents_dir / "worker.toml").exists()
    for role, (model, worker) in workers.items():
        assert f'name = "{role}"' in worker
        assert f'model = "{model}"' in worker
        assert "model_reasoning_effort =" not in worker
        assert "static model pin in this role is authoritative" in worker
        assert "Do not accept ad hoc model or effort overrides" in worker
        assert "Do not take over orchestration or self-review" in worker
    assert "model = \"gpt-5.6-sol\"" in architect
    assert "model_reasoning_effort = \"max\"" in architect
    assert "model = \"gpt-5.6-sol\"" in reviewer
    assert "model_reasoning_effort = \"max\"" in reviewer
    assert "model = \"gpt-5.6-sol\"" in critical_architect
    assert "model_reasoning_effort = \"max\"" in critical_architect
    assert "model = \"gpt-5.6-sol\"" in critical_reviewer
    assert "model_reasoning_effort = \"max\"" in critical_reviewer
    assert "Do not spawn child agents" in architect
    assert "Do not spawn child agents" in critical_architect
    assert "BASE, STANDARD, or CRITICAL" in doc
    assert "Comparing two or more independent sources" in doc
    assert "outer parent must not perform target work before receiving the command plan" in doc
    assert 'fork_turns="none"' in doc
    assert "command plan" in doc
    assert "mechanical dispatcher" in doc
    assert "Nested custom-agent" in doc
    assert "gpt-5.3-codex-spark" in doc
    assert "gpt-5.4-mini" in doc
    assert "gpt-5.5" in doc
    assert "model_fallback" in doc
    assert "OpenCode Go MCP / runtime-selected" in doc
    assert "opencode-go/deepseek-v4-pro" in doc
    assert "never pass an `opencode-go/*` ID" in doc
    assert "model_fallback.v1" in ux_contract
    assert "direct OpenCode Go MCP" in ux_contract


def test_adaptive_recovery_manifest_is_narrow_and_portable() -> None:
    manifest = _load_adaptive_manifest()
    recovery = _read("docs/adaptive-orchestration-recovery.md")
    adaptive_files = [
        *manifest["required_recovery_files"],
        *manifest["role_files"],
        *manifest["supporting_files"],
    ]

    assert manifest["schema"] == "adaptive_orchestration_recovery_manifest.v1"
    assert manifest["scope"] == "adaptive_orchestration_only"
    assert manifest["restore_policy"]["model_and_role_selection"] == "restore_time_after_live_preflight"
    assert "AGENTS.md" in manifest["excluded_paths"]
    assert "STATE.md" in manifest["excluded_paths"]
    assert "work/" in manifest["excluded_paths"]
    assert "outputs/" in manifest["excluded_paths"]
    assert all(not Path(path).is_absolute() for path in adaptive_files)
    assert not any(path.startswith(("work/", "outputs/", "platform-follow-up/")) for path in adaptive_files)
    assert not any(path in {"AGENTS.md", "STATE.md", "README.md"} for path in adaptive_files)

    for recovery_path in manifest["required_recovery_files"]:
        recovery_text = _read(recovery_path)
        assert "/Users/" not in recovery_text
        assert "model-routing-policy.md" not in recovery_text

    assert "/Users/" not in recovery
    assert "model-routing-policy.md" not in recovery
    assert "after live preflight" in recovery
    assert "secrets" in recovery
    assert "credentials" in recovery
    assert "session/thread/host identifiers" in recovery
    assert "absolute local paths" in recovery

    for role_path in manifest["role_files"]:
        role_text = _read(role_path)
        assert "/Users/" not in role_text
        assert "model-routing-policy.md" not in role_text
        assert "live preflight" in role_text
