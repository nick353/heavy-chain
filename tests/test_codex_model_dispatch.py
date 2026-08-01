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
from social_flow.adaptive_session_audit import (
    ChildTaskValidationError,
    validate_child_task_result,
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


@pytest.mark.parametrize(
    "failure",
    [TimeoutError(), RuntimeError("deadline exceeded"), RuntimeError("no-final response")],
)
def test_dispatch_falls_back_on_explicit_native_timeout_or_missing_final(failure: Exception) -> None:
    calls: list[str] = []

    def dispatch(model: str, effort: str) -> str:
        calls.append(model)
        if model == "gpt-5.6-sol":
            raise failure
        return "ok"

    result = dispatch_native_model_with_fallback(
        dispatch,
        role="reviewer",
        primary_model="gpt-5.6-sol",
        reasoning_effort="max",
        available_models={"gpt-5.6-sol", "gpt-5.6-terra"},
        lane="reviewer",
    )

    assert calls == ["gpt-5.6-sol", "gpt-5.6-terra"]
    assert result.fallback_receipt is not None
    assert result.fallback_receipt["schema"] == "model_fallback.v1"


def test_dispatch_does_not_substitute_on_unclassified_transport_exception() -> None:
    calls: list[str] = []

    def dispatch(model: str, effort: str) -> str:
        calls.append(model)
        raise RuntimeError("bridge transport closed")

    with pytest.raises(RuntimeError, match="bridge transport closed"):
        dispatch_native_model_with_fallback(
            dispatch,
            role="reviewer",
            primary_model="gpt-5.6-sol",
            reasoning_effort="max",
            available_models={"gpt-5.6-sol", "gpt-5.6-terra"},
            lane="reviewer",
        )
    assert calls == ["gpt-5.6-sol"]


@pytest.mark.parametrize(
    "failure",
    [
        TimeoutError("authentication timeout"),
        RuntimeError("transport deadline exceeded"),
        RuntimeError("task timeout"),
    ],
)
def test_dispatch_does_not_fallback_for_hard_failures_with_timeout_text(failure: Exception) -> None:
    calls: list[str] = []

    def dispatch(model: str, effort: str) -> str:
        calls.append(model)
        raise failure

    with pytest.raises(type(failure)):
        dispatch_native_model_with_fallback(
            dispatch,
            role="reviewer",
            primary_model="gpt-5.6-sol",
            reasoning_effort="max",
            available_models={"gpt-5.6-sol", "gpt-5.6-terra"},
            lane="reviewer",
        )
    assert calls == ["gpt-5.6-sol"]


@pytest.mark.parametrize("failure_code", ["provider_timeout", "model_timeout"])
def test_dispatch_falls_back_for_explicit_provider_or_model_timeout(failure_code: str) -> None:
    calls: list[str] = []

    def dispatch(model: str, effort: str) -> str:
        calls.append(model)
        if model == "gpt-5.6-sol":
            raise NativeModelDispatchError(failure_code)
        return "ok"

    result = dispatch_native_model_with_fallback(
        dispatch,
        role="reviewer",
        primary_model="gpt-5.6-sol",
        reasoning_effort="max",
        available_models={"gpt-5.6-sol", "gpt-5.6-terra"},
        lane="reviewer",
    )

    assert calls == ["gpt-5.6-sol", "gpt-5.6-terra"]
    assert result.fallback_receipt is not None
    assert result.fallback_receipt["failure_code"] == failure_code


def test_dispatch_validator_blocks_missing_child_final_without_fallback() -> None:
    calls: list[str] = []

    def dispatch(model: str, effort: str) -> dict[str, str]:
        calls.append(model)
        return {"task_prompt": "bounded child task", "final": ""}

    with pytest.raises(ChildTaskValidationError, match="child_task_final_missing"):
        dispatch_native_model_with_fallback(
            dispatch,
            role="worker",
            primary_model="gpt-5.4-mini",
            reasoning_effort="medium",
            available_models={"gpt-5.4-mini", "gpt-5.4"},
            lane="worker",
            result_validator=validate_child_task_result,
        )
    assert calls == ["gpt-5.4-mini"]


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
        request_id_bound=True,
        usage={"input_tokens": 10, "output_tokens": 4},
        preflight="passed",
        mode="review",
        read_only=True,
        verified=True,
        terminal=True,
        status="completed",
        output_complete=True,
        truncated=False,
        finish_reason="stop",
        verdict="APPROVE",
        summary="The bounded review completed successfully.",
        findings=(),
        bounded_output=True,
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
    assert result.verdict == "APPROVE"
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


@pytest.mark.parametrize(
    "failure_code",
    ["model_unavailable", "provider_model_unavailable", "provider_timeout", "model_rate_limited", "no_final_response"],
)
def test_opencode_go_reviewer_falls_back_only_for_explicit_model_failures(failure_code: str) -> None:
    calls: list[str] = []
    models = ("opencode-go/deepseek-v4-pro", "opencode-go/mimo-v2.5-pro")

    def dispatch(model: str) -> OpenCodeGoDispatchResponse[str]:
        calls.append(model)
        if model == models[0]:
            raise OpenCodeGoModelDispatchError(failure_code)
        return _opencode_response(model)

    result = dispatch_opencode_go_reviewer_with_fallback(
        dispatch,
        available_models=set(models),
        preflight={model: _opencode_preflight(model) for model in models},
        supported_bridge_versions={"bridge-2026-07"},
        preferred_model=models[0],
    )

    assert calls == list(models)
    assert result.selected_model == models[1]
    assert result.fallback_receipt is not None
    assert result.fallback_receipt["schema"] == "model_fallback.v1"
    assert result.fallback_receipt["failure_code"] == failure_code


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
        ({"request_id": ""}, "reviewer_output_invalid:request"),
        ({"request_id_bound": False}, "reviewer_output_invalid:request_binding"),
        ({"usage": {}}, "reviewer_output_invalid:usage"),
        ({"usage": {"input_tokens": -1, "output_tokens": 4}}, "reviewer_output_invalid:usage"),
        ({"usage": {"input_tokens": 10, "output_tokens": 0}}, "reviewer_output_invalid:usage"),
        ({"usage": {"input_tokens": 10.0, "output_tokens": 4}}, "reviewer_output_invalid:usage"),
        ({"bounded_output": False}, "reviewer_output_invalid:output"),
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


@pytest.mark.parametrize(
    "response_update,expected_code",
    [
        ({"provider": "other-provider"}, "reviewer_output_invalid:provider"),
        ({"model": "opencode-go/mimo-v2.5-pro"}, "reviewer_output_invalid:model"),
        ({"bridge_version": "bridge-older"}, "reviewer_output_invalid:bridge"),
        ({"preflight": "pending"}, "reviewer_output_invalid:preflight"),
        ({"mode": "execute"}, "reviewer_output_invalid:mode"),
        ({"read_only": False}, "reviewer_output_invalid:read_only"),
        ({"verified": False}, "reviewer_output_invalid:verified"),
        ({"terminal": False}, "reviewer_output_invalid:terminal"),
        ({"status": "running"}, "reviewer_output_invalid:status"),
        ({"output_complete": False}, "reviewer_output_invalid:output_complete"),
        ({"truncated": True}, "reviewer_output_invalid:truncated"),
        ({"finish_reason": "length"}, "reviewer_output_invalid:finish_reason"),
        ({"verdict": ""}, "reviewer_output_invalid:verdict"),
        ({"verdict": "unknown"}, "reviewer_output_invalid:verdict"),
        ({"summary": "", "findings": ()}, "reviewer_output_invalid:final_content"),
        ({"findings": None}, "reviewer_output_invalid:findings"),
    ],
)
def test_opencode_go_reviewer_rejects_incomplete_review_envelope_without_fallback(
    response_update: dict[str, object],
    expected_code: str,
) -> None:
    model = "opencode-go/deepseek-v4-flash"
    fallback_model = "opencode-go/mimo-v2.5-pro"
    calls: list[str] = []
    response = replace(_opencode_response(model), **response_update)

    def dispatch(selected: str) -> OpenCodeGoDispatchResponse[str]:
        calls.append(selected)
        return response

    with pytest.raises(OpenCodeGoModelDispatchError, match=expected_code):
        dispatch_opencode_go_reviewer_with_fallback(
            dispatch,
            available_models={model, fallback_model},
            preflight={
                model: _opencode_preflight(model),
                fallback_model: _opencode_preflight(fallback_model),
            },
            supported_bridge_versions={"bridge-2026-07"},
            preferred_model=model,
        )
    assert calls == [model]


@pytest.mark.parametrize("verdict", ["PASS", "APPROVE", "approved", "REVISE", "changes_requested", "STOP", "blocked"])
def test_opencode_go_reviewer_normalizes_supported_verdict_aliases(verdict: str) -> None:
    model = "opencode-go/deepseek-v4-flash"
    response = replace(_opencode_response(model), verdict=verdict)

    result = dispatch_opencode_go_reviewer_with_fallback(
        lambda selected: response,
        available_models={model},
        preflight={model: _opencode_preflight(model)},
        supported_bridge_versions={"bridge-2026-07"},
    )

    assert result.verdict in {"APPROVE", "REVISE", "STOP"}


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


@pytest.mark.parametrize("failure", [TimeoutError("provider timeout"), RuntimeError("provider timeout")])
def test_opencode_go_reviewer_does_not_substitute_on_unstructured_timeout(failure: Exception) -> None:
    model = "opencode-go/deepseek-v4-flash"
    fallback_model = "opencode-go/mimo-v2.5-pro"
    calls: list[str] = []

    def dispatch(selected: str) -> OpenCodeGoDispatchResponse[str]:
        calls.append(selected)
        raise failure

    with pytest.raises(type(failure), match="provider timeout"):
        dispatch_opencode_go_reviewer_with_fallback(
            dispatch,
            available_models={model, fallback_model},
            preflight={
                model: _opencode_preflight(model),
                fallback_model: _opencode_preflight(fallback_model),
            },
            supported_bridge_versions={"bridge-2026-07"},
            preferred_model=model,
        )
    assert calls == [model]


def test_opencode_go_reviewer_requires_route_when_no_live_candidate_exists() -> None:
    with pytest.raises(OpenCodeGoModelDispatchError, match="opencode_go_reviewer_route_unavailable"):
        dispatch_opencode_go_reviewer_with_fallback(
            lambda selected: _opencode_response(selected),
            available_models=set(),
            preflight={},
            supported_bridge_versions={"bridge-2026-07"},
        )
