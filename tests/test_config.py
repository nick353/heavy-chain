from __future__ import annotations

from pathlib import Path

import pytest

from social_flow.config import load_settings
from social_flow.codex_policy import CodexUxPolicy, load_codex_ux_policy, validate_codex_model_choice


def test_load_settings_uses_main_chrome_profile_defaults(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/tmp/service-account.json")
    monkeypatch.setenv("GOOGLE_SHEETS_SPREADSHEET_ID", "spreadsheet-id")
    monkeypatch.delenv("CHROME_MAIN_USER_DATA_DIR", raising=False)
    monkeypatch.delenv("CHROME_MAIN_PROFILE_DIRECTORY", raising=False)
    monkeypatch.delenv("CHROME_MAIN_PREFERENCES_PATH", raising=False)
    monkeypatch.setenv("X_EXPECTED_HANDLE", "")

    settings = load_settings()

    expected_root = Path.home() / ".social-flow-nicky-automation-chrome"
    assert settings.chrome_main_user_data_dir == str(expected_root)
    assert settings.chrome_main_profile_label == "二千 (Nicky automation)"
    assert settings.chrome_main_profile_directory == "Default"
    assert settings.chrome_main_preferences_path == str(expected_root / "Default" / "Preferences")
    assert settings.chrome_main_remote_debugging_port == 9222
    assert settings.x_expected_handle == ""


def test_load_settings_allows_main_chrome_profile_overrides(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/tmp/service-account.json")
    monkeypatch.setenv("GOOGLE_SHEETS_SPREADSHEET_ID", "spreadsheet-id")
    monkeypatch.setenv("CHROME_MAIN_USER_DATA_DIR", "/tmp/main-chrome")
    monkeypatch.setenv("CHROME_MAIN_PROFILE_DIRECTORY", "Profile 7")
    monkeypatch.setenv("CHROME_MAIN_PREFERENCES_PATH", "/tmp/main-chrome/Profile 7/Preferences")
    monkeypatch.setenv("CHROME_MAIN_REMOTE_DEBUGGING_PORT", "9333")

    settings = load_settings()

    assert settings.chrome_main_user_data_dir == "/tmp/main-chrome"
    assert settings.chrome_main_profile_directory == "Profile 7"
    assert settings.chrome_main_preferences_path == "/tmp/main-chrome/Profile 7/Preferences"
    assert settings.chrome_main_remote_debugging_port == 9333


def test_load_settings_rejects_non_codex_models(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/tmp/service-account.json")
    monkeypatch.setenv("GOOGLE_SHEETS_SPREADSHEET_ID", "spreadsheet-id")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o")

    with pytest.raises(ValueError, match="codex_model_choice_not_allowed"):
        load_settings()


def test_validate_codex_model_choice_uses_policy_allowlist(monkeypatch) -> None:
    monkeypatch.setenv("SOCIAL_FLOW_ALLOWED_CODEX_MODELS", "gpt-5.4-mini,gpt-5.6-sol")
    monkeypatch.setenv("SOCIAL_FLOW_REVIEW_MODEL", "gpt-5.6-sol")
    monkeypatch.setenv("SOCIAL_FLOW_CRITICAL_REVIEW_MODEL", "gpt-5.6-sol")
    policy = load_codex_ux_policy()
    assert policy == CodexUxPolicy(
        task_model="gpt-5.4-mini",
        review_model="gpt-5.6-sol",
        critical_review_model="gpt-5.6-sol",
        allowed_models=("gpt-5.4-mini", "gpt-5.6-sol"),
    )
    assert validate_codex_model_choice("gpt-5.6-sol", policy) == "gpt-5.6-sol"


def test_load_settings_keeps_existing_draft_model(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/tmp/service-account.json")
    monkeypatch.setenv("GOOGLE_SHEETS_SPREADSHEET_ID", "spreadsheet-id")
    monkeypatch.setenv("DRAFT_MODEL", "anthropic/claude-sonnet-4.6")

    settings = load_settings()

    assert settings.draft_model == "anthropic/claude-sonnet-4.6"
