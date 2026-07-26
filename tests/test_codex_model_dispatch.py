from __future__ import annotations

from dataclasses import replace

import pytest

from social_flow.codex_model_dispatch import (
    NativeModelDispatchError,
    OpenCodeGoDispatchResponse,
    OpenCodeGoModelDispatchError,
    OpenCodeGoModelPreflight,
    dispatch_opencode_go_reviewer_with_fallback,
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


def _opencode_preflight(model: str) -> OpenCodeGoModelPreflight:
    return OpenCodeGoModelPreflight(
        provider="opencode-go",
        model=model,
        bridge_version="bridge-2026-07",
    )


def _opencode_response(model: str, value: str = "PASS") -> OpenCodeGoDispatchResponse[str]:
    return OpenCodeGoDispatchResponse(
        value=value,
        provider="opencode-go",
        model=model,
        bridge_version="bridge-2026-07",
        request_id=f"req-{model.rsplit('/', 1)[-1]}",
        usage={"input_tokens": 10, "output_tokens": 4},
    )


def test_opencode_go_reviewer_selects_first_live_model_at_runtime() -> None:
    calls: list[str] = []

    def dispatch(model: str) -> OpenCodeGoDispatchResponse[str]:
        calls.append(model)
        return _opencode_response(model)

    result = dispatch_opencode_go_reviewer_with_fallback(
        dispatch,
        available_models={"opencode-go/deepseek-v4-flash"},
        preflight={"opencode-go/deepseek-v4-flash": _opencode_preflight("opencode-go/deepseek-v4-flash")},
        supported_bridge_versions={"bridge-2026-07"},
    )

    assert calls == ["opencode-go/deepseek-v4-flash"]
    assert result.selected_model == "opencode-go/deepseek-v4-flash"
    assert result.request_id == "req-deepseek-v4-flash"
    assert result.fallback_receipt is None


def test_opencode_go_reviewer_retries_same_role_model_failure_with_receipt() -> None:
    calls: list[str] = []
    models = ("opencode-go/deepseek-v4-pro", "opencode-go/mimo-v2.5-pro")

    def dispatch(model: str) -> OpenCodeGoDispatchResponse[str]:
        calls.append(model)
        if model == models[0]:
            raise OpenCodeGoModelDispatchError("provider_timeout")
        return _opencode_response(model)

    result = dispatch_opencode_go_reviewer_with_fallback(
        dispatch,
        available_models=set(models),
        preflight={model: _opencode_preflight(model) for model in models},
        supported_bridge_versions={"bridge-2026-07"},
        preferred_model=models[0],
        tool_name="mcp__opencode_go_reviewer",
    )

    assert calls == list(models)
    assert result.selected_model == models[1]
    assert result.fallback_receipt == {
        "schema": "model_fallback.v1",
        "provider": "opencode-go",
        "role": "reviewer",
        "requested_model": models[0],
        "selected_model": models[1],
        "failure_code": "provider_timeout",
        "attempted_models": list(models),
        "requested_reasoning_effort": None,
        "selected_reasoning_effort": None,
        "fallback": True,
        "tool_thread_provenance": {"tool": "mcp__opencode_go_reviewer"},
        "route": {
            "bridge_version": "bridge-2026-07",
            "request_id": "req-mimo-v2.5-pro",
            "usage": {"input_tokens": 10, "output_tokens": 4},
            "bounded_output": True,
        },
    }


@pytest.mark.parametrize(
    "failure_code",
    ["provider_auth_failed", "provider_schema_error", "task_failed", "malformed_output"],
)
def test_opencode_go_reviewer_does_not_substitute_on_provider_or_task_failure(failure_code: str) -> None:
    calls: list[str] = []
    models = ("opencode-go/deepseek-v4-pro", "opencode-go/mimo-v2.5-pro")

    def dispatch(model: str) -> OpenCodeGoDispatchResponse[str]:
        calls.append(model)
        raise OpenCodeGoModelDispatchError(failure_code)

    with pytest.raises(OpenCodeGoModelDispatchError, match=failure_code):
        dispatch_opencode_go_reviewer_with_fallback(
            dispatch,
            available_models=set(models),
            preflight={model: _opencode_preflight(model) for model in models},
            supported_bridge_versions={"bridge-2026-07"},
            preferred_model=models[0],
        )
    assert calls == [models[0]]


def test_opencode_go_reviewer_rejects_unverified_route_metadata() -> None:
    model = "opencode-go/deepseek-v4-flash"

    with pytest.raises(OpenCodeGoModelDispatchError, match="opencode_go_bridge_version_unsupported"):
        dispatch_opencode_go_reviewer_with_fallback(
            lambda selected: _opencode_response(selected),
            available_models={model},
            preflight={model: _opencode_preflight(model)},
            supported_bridge_versions={"bridge-older"},
        )


@pytest.mark.parametrize(
    "response_update,expected_code",
    [
        ({"request_id": ""}, "opencode_go_request_id_missing"),
        ({"usage": {}}, "opencode_go_usage_missing"),
        ({"bounded_output": False}, "opencode_go_bounded_output_missing"),
    ],
)
def test_opencode_go_reviewer_rejects_incomplete_result_evidence(
    response_update: dict[str, object],
    expected_code: str,
) -> None:
    model = "opencode-go/deepseek-v4-flash"
    response = replace(_opencode_response(model), **response_update)

    with pytest.raises(OpenCodeGoModelDispatchError, match=expected_code):
        dispatch_opencode_go_reviewer_with_fallback(
            lambda selected: response,
            available_models={model},
            preflight={model: _opencode_preflight(model)},
            supported_bridge_versions={"bridge-2026-07"},
        )


def test_opencode_go_reviewer_does_not_catch_native_dispatch_errors() -> None:
    model = "opencode-go/deepseek-v4-flash"

    def dispatch(selected: str) -> OpenCodeGoDispatchResponse[str]:
        raise NativeModelDispatchError("model_unavailable")

    with pytest.raises(NativeModelDispatchError, match="model_unavailable"):
        dispatch_opencode_go_reviewer_with_fallback(
            dispatch,
            available_models={model},
            preflight={model: _opencode_preflight(model)},
            supported_bridge_versions={"bridge-2026-07"},
        )


def test_opencode_go_reviewer_requires_route_when_no_live_candidate_exists() -> None:
    with pytest.raises(OpenCodeGoModelDispatchError, match="opencode_go_reviewer_route_unavailable"):
        dispatch_opencode_go_reviewer_with_fallback(
            lambda selected: _opencode_response(selected),
            available_models=set(),
            preflight={},
            supported_bridge_versions={"bridge-2026-07"},
        )
