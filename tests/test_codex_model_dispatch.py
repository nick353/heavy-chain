from __future__ import annotations

import pytest

from social_flow.codex_model_dispatch import (
    NativeModelDispatchError,
    dispatch_native_model_with_fallback,
)


def test_dispatch_retries_next_live_native_model_and_records_receipt() -> None:
    calls: list[tuple[str, str]] = []

    def dispatch(model: str, effort: str) -> str:
        calls.append((model, effort))
        if model == "gpt-5.6-sol":
            raise NativeModelDispatchError("model_unavailable")
        return "ok"

    result = dispatch_native_model_with_fallback(
        dispatch,
        role="reviewer",
        primary_model="gpt-5.6-sol",
        reasoning_effort="max",
        available_models={"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5"},
        lane="reviewer",
    )

    assert calls == [("gpt-5.6-sol", "max"), ("gpt-5.6-terra", "max")]
    assert result.value == "ok"
    assert result.selected_model == "gpt-5.6-terra"
    assert result.fallback_receipt == {
        "schema": "model_fallback.v1",
        "provider": "codex-native",
        "role": "reviewer",
        "requested_model": "gpt-5.6-sol",
        "selected_model": "gpt-5.6-terra",
        "failure_code": "model_unavailable",
        "attempted_models": ["gpt-5.6-sol", "gpt-5.6-terra"],
        "requested_reasoning_effort": "max",
        "selected_reasoning_effort": "max",
        "fallback": True,
    }


def test_dispatch_downgrades_effort_only_when_fallback_model_requires_it() -> None:
    calls: list[tuple[str, str]] = []

    def dispatch(model: str, effort: str) -> str:
        calls.append((model, effort))
        if model == "gpt-5.6-sol":
            raise NativeModelDispatchError("provider_timeout")
        return "ok"

    result = dispatch_native_model_with_fallback(
        dispatch,
        role="reviewer",
        primary_model="gpt-5.6-sol",
        reasoning_effort="max",
        available_models={"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5"},
        lane="reviewer",
    )

    assert calls == [("gpt-5.6-sol", "max"), ("gpt-5.6-terra", "max")]
    assert result.selected_reasoning_effort == "max"


def test_dispatch_records_codex_app_tool_thread_provenance() -> None:
    def dispatch(model: str, effort: str) -> str:
        if model == "gpt-5.6-sol":
            raise NativeModelDispatchError("model_unavailable")
        return "ok"

    result = dispatch_native_model_with_fallback(
        dispatch,
        role="reviewer",
        primary_model="gpt-5.6-sol",
        reasoning_effort="max",
        available_models={"gpt-5.6-sol", "gpt-5.6-terra"},
        lane="reviewer",
        tool_name="codex_app__send_message_to_thread",
        thread_id="thread-123",
        host_id="host-456",
    )

    assert result.fallback_receipt is not None
    assert result.fallback_receipt["tool_thread_provenance"] == {
        "tool": "codex_app__send_message_to_thread",
        "thread_id": "thread-123",
        "host_id": "host-456",
    }


def test_dispatch_does_not_substitute_on_malformed_output() -> None:
    calls: list[str] = []

    def dispatch(model: str, effort: str) -> str:
        calls.append(model)
        raise NativeModelDispatchError("malformed_output")

    with pytest.raises(NativeModelDispatchError, match="malformed_output"):
        dispatch_native_model_with_fallback(
            dispatch,
            role="reviewer",
            primary_model="gpt-5.6-sol",
            reasoning_effort="max",
            available_models={"gpt-5.6-sol", "gpt-5.6-terra"},
            lane="reviewer",
        )
    assert calls == ["gpt-5.6-sol"]


def test_disabled_fallback_does_not_substitute() -> None:
    from social_flow.codex_policy import CodexUxPolicy

    calls: list[tuple[str, str]] = []
    policy = CodexUxPolicy(
        task_model="gpt-5.4-mini",
        review_model="gpt-5.6-sol",
        critical_review_model="gpt-5.6-sol",
        allowed_models=("gpt-5.4-mini", "gpt-5.6-sol", "gpt-5.5"),
        model_fallback_enabled=False,
        fallback_models=("gpt-5.5",),
    )

    def dispatch(model: str, effort: str) -> str:
        calls.append((model, effort))
        raise NativeModelDispatchError("model_unavailable")

    with pytest.raises(NativeModelDispatchError, match="model_unavailable"):
        dispatch_native_model_with_fallback(
            dispatch,
            role="executor",
            primary_model="gpt-5.6-sol",
            reasoning_effort="max",
            available_models={"gpt-5.6-sol", "gpt-5.5"},
            policy=policy,
        )

    assert calls == [("gpt-5.6-sol", "max")]


def test_environment_disabled_fallback_is_respected_without_explicit_policy(monkeypatch) -> None:
    monkeypatch.setenv("SOCIAL_FLOW_MODEL_FALLBACK_ENABLED", "false")
    calls: list[tuple[str, str]] = []

    def dispatch(model: str, effort: str) -> str:
        calls.append((model, effort))
        raise NativeModelDispatchError("model_unavailable")

    with pytest.raises(NativeModelDispatchError, match="model_unavailable"):
        dispatch_native_model_with_fallback(
            dispatch,
            role="reviewer",
            primary_model="gpt-5.6-sol",
            reasoning_effort="max",
            available_models={"gpt-5.6-sol", "gpt-5.6-terra"},
            lane="reviewer",
        )

    assert calls == [("gpt-5.6-sol", "max")]


def test_dispatch_defaults_to_the_same_role_fallback_lane() -> None:
    calls: list[str] = []

    def dispatch(model: str, effort: str) -> str:
        calls.append(model)
        if model == "gpt-5.6-sol":
            raise NativeModelDispatchError("model_unavailable")
        return "ok"

    result = dispatch_native_model_with_fallback(
        dispatch,
        role="reviewer",
        primary_model="gpt-5.6-sol",
        reasoning_effort="max",
        available_models={"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"},
    )

    assert calls == ["gpt-5.6-sol", "gpt-5.6-terra"]
    assert result.selected_model == "gpt-5.6-terra"


def test_dispatch_always_starts_with_primary_when_configured_fallbacks_omit_it() -> None:
    from social_flow.codex_policy import CodexUxPolicy

    calls: list[str] = []
    policy = CodexUxPolicy(
        task_model="gpt-5.4-mini",
        review_model="gpt-5.6-sol",
        critical_review_model="gpt-5.6-sol",
        allowed_models=("gpt-5.4-mini", "gpt-5.6-sol", "gpt-5.5"),
        fallback_models=("gpt-5.6-terra", "gpt-5.5"),
    )

    def dispatch(model: str, effort: str) -> str:
        calls.append(model)
        if model == "gpt-5.6-sol":
            raise NativeModelDispatchError("model_unavailable")
        return "ok"

    result = dispatch_native_model_with_fallback(
        dispatch,
        role="reviewer",
        primary_model="gpt-5.6-sol",
        reasoning_effort="max",
        available_models={"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5"},
        policy=policy,
    )

    assert calls == ["gpt-5.6-sol", "gpt-5.6-terra"]
    assert result.selected_model == "gpt-5.6-terra"


def test_dispatch_rejects_known_role_lane_mismatch() -> None:
    with pytest.raises(ValueError, match="codex_model_fallback_role_lane_mismatch:reviewer:worker"):
        dispatch_native_model_with_fallback(
            lambda model, effort: "unused",
            role="reviewer",
            primary_model="gpt-5.6-sol",
            reasoning_effort="max",
            available_models={"gpt-5.6-sol", "gpt-5.6-terra"},
            lane="worker",
        )


def test_dispatch_requires_live_candidate_for_fallback() -> None:
    def dispatch(model: str, effort: str) -> str:
        raise NativeModelDispatchError("model_unavailable")

    with pytest.raises(NativeModelDispatchError, match="all native model fallback candidates failed"):
        dispatch_native_model_with_fallback(
            dispatch,
            role="reviewer",
            primary_model="gpt-5.6-sol",
            reasoning_effort="max",
            available_models={"gpt-5.6-sol"},
            lane="reviewer",
        )
