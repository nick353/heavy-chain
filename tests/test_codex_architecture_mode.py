from __future__ import annotations

from pathlib import Path

from social_flow.codex_policy import (
    CodexArchitecturePolicy,
    CodexLanePolicy,
    CodexUxPolicy,
    load_codex_architecture_policy,
    load_codex_ux_policy,
    validate_codex_reasoning_effort,
)


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


def test_codex_architecture_policy_defaults_to_codex_app_lanes(monkeypatch) -> None:
    monkeypatch.delenv("SOCIAL_FLOW_ALLOWED_CODEX_MODELS", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_REVIEW_MODEL", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_CRITICAL_REVIEW_MODEL", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_ARCHITECT_MODEL", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_CRITICAL_ARCHITECT_MODEL", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_WORKER_REASONING_EFFORT", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_ARCHITECT_REASONING_EFFORT", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_REVIEW_REASONING_EFFORT", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_CRITICAL_ARCHITECT_REASONING_EFFORT", raising=False)
    monkeypatch.delenv("SOCIAL_FLOW_CRITICAL_REVIEW_REASONING_EFFORT", raising=False)

    policy = load_codex_architecture_policy()

    assert policy == CodexArchitecturePolicy(
        architect=CodexLanePolicy(model="gpt-5.6-sol", reasoning_effort="high"),
        worker=CodexLanePolicy(model="gpt-5.4-mini", reasoning_effort="medium"),
        reviewer=CodexLanePolicy(model="gpt-5.6-sol", reasoning_effort="high"),
        critical_architect=CodexLanePolicy(model="gpt-5.6-sol", reasoning_effort="high"),
        critical_reviewer=CodexLanePolicy(model="gpt-5.6-sol", reasoning_effort="high"),
        allowed_models=("gpt-5.4-mini", "gpt-5.6-sol"),
    )
    assert load_codex_ux_policy() == CodexUxPolicy(
        task_model="gpt-5.4-mini",
        review_model="gpt-5.6-sol",
        critical_review_model="gpt-5.6-sol",
        allowed_models=("gpt-5.4-mini", "gpt-5.6-sol"),
    )


def test_validate_codex_reasoning_effort_accepts_extra_high_alias() -> None:
    assert validate_codex_reasoning_effort("xhigh") == "xhigh"
    assert validate_codex_reasoning_effort("extra high") == "xhigh"


def test_codex_architecture_mode_files_pin_role_routing() -> None:
    doc = _read("docs/codex-architecture-mode.md")
    ux_contract = _read("docs/codex-ux-contract.md")
    project_agents = _read("AGENTS.md")
    agents_dir = ".codex/agents"
    architect = _read(f"{agents_dir}/architect.toml")
    worker = _read(f"{agents_dir}/worker.toml")
    reviewer = _read(f"{agents_dir}/reviewer.toml")
    critical_architect = _read(f"{agents_dir}/critical_architect.toml")
    critical_reviewer = _read(f"{agents_dir}/critical_reviewer.toml")
    agents_text = "\n".join((architect, worker, reviewer, critical_architect, critical_reviewer))

    assert "architect-as-orchestrator" in doc
    assert "Shann-inspired" in doc
    assert "gpt-5.6-sol" in doc
    assert "gpt-5.4-mini" in doc
    assert "meaning" in doc
    assert "Codex App" in doc
    assert "fable-advisor" in doc
    assert "docs/codex-architecture-mode.md" in ux_contract
    assert ".codex/agents/architect.toml" in ux_contract
    assert ".codex/agents/worker.toml" in ux_contract
    assert ".codex/agents/reviewer.toml" in ux_contract
    assert ".codex/agents/critical_architect.toml" in ux_contract
    assert "gpt-5.6-sol" in agents_text
    assert "gpt-5.4-mini" in agents_text
    assert "medium" in agents_text
    assert "high" in agents_text
    assert "gpt-5.6-sol" in reviewer
    assert "gpt-5.6-sol" in critical_architect
    assert "gpt-5.6-sol" in critical_reviewer
    assert "Do not spawn child agents" in architect
    assert "Do not spawn child agents" in critical_architect
    assert "BASE / STANDARD / CRITICAL" in project_agents
    assert "2つ以上の独立source比較" in project_agents
    assert "対象sourceを読んだり編集したりする前" in project_agents
    assert "fork_context=false" in project_agents
    assert "最初にSol" in project_agents
    assert "command plan" in project_agents
    assert "mechanical dispatcher" in project_agents
    assert "nested custom-agent" in project_agents
    assert "黙ってfallback" in project_agents
