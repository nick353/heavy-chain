from __future__ import annotations

from dataclasses import dataclass
from os import getenv
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from social_flow.codex_policy import validate_codex_model_choice


@dataclass(frozen=True)
class Settings:
    openai_api_key: str
    openai_model: str
    gemini_api_key: str
    gemini_model: str
    draft_api_key: str
    draft_model: str
    draft_base_url: str
    draft_http_referer: str
    draft_app_title: str
    draft_timeout_seconds: float
    google_service_account_json: str
    spreadsheet_id: str
    spreadsheet_title: str
    queue_tab: str
    sources_config_json: str
    google_drive_folder_url: str
    google_drive_folder_id: str
    x_api_access_token: str
    x_expected_handle: str
    linkedin_access_token: str
    linkedin_author_urn: str
    linkedin_api_version: str
    chrome_executable_path: str
    chrome_user_data_dir: str
    chrome_profile_directory: str
    chrome_main_user_data_dir: str
    chrome_main_profile_label: str
    chrome_main_profile_directory: str
    chrome_main_preferences_path: str
    chrome_main_remote_debugging_port: int
    chrome_task_group_prefix: str
    chrome_publish_headless: bool


def _required(name: str) -> str:
    value = getenv(name, "").strip()
    if not value:
        raise ValueError(f"Environment variable `{name}` is required.")
    return value


def _default_chrome_executable_path() -> str:
    mac_path = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    return str(mac_path) if mac_path.exists() else ""


def _default_chrome_user_data_dir() -> str:
    return str(Path.home() / ".social-flow-chrome-profile")


def _default_google_chrome_user_data_dir() -> str:
    return str(Path.home() / "Library" / "Application Support" / "Google" / "Chrome")


def _default_main_chrome_user_data_dir() -> str:
    return str(Path.home() / ".social-flow-nicky-automation-chrome")


def _default_main_chrome_preferences_path(user_data_dir: str, profile_directory: str) -> str:
    return str(Path(user_data_dir).expanduser() / profile_directory / "Preferences")


def _bool_env(name: str, default: bool = False) -> bool:
    value = getenv(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


def load_settings() -> Settings:
    load_dotenv()
    openai_api_key = getenv("OPENAI_API_KEY", "").strip()
    gemini_api_key = getenv("GEMINI_API_KEY", "").strip()
    draft_api_key = getenv("DRAFT_API_KEY", "").strip() or openai_api_key
    draft_model = getenv("DRAFT_MODEL", "").strip() or getenv("OPENAI_MODEL", "gpt-5.4-mini").strip() or "gpt-5.4-mini"
    openai_model = validate_codex_model_choice(getenv("OPENAI_MODEL", "gpt-5.4-mini").strip() or "gpt-5.4-mini")
    chrome_main_user_data_dir = (
        getenv("CHROME_MAIN_USER_DATA_DIR", "").strip() or _default_main_chrome_user_data_dir()
    )
    chrome_main_profile_directory = getenv("CHROME_MAIN_PROFILE_DIRECTORY", "Default").strip() or "Default"
    chrome_main_preferences_path = (
        getenv("CHROME_MAIN_PREFERENCES_PATH", "").strip()
        or _default_main_chrome_preferences_path(chrome_main_user_data_dir, chrome_main_profile_directory)
    )
    return Settings(
        openai_api_key=openai_api_key,
        openai_model=openai_model,
        gemini_api_key=gemini_api_key,
        gemini_model=getenv("GEMINI_MODEL", "gemini-2.5-pro").strip() or "gemini-2.5-pro",
        draft_api_key=draft_api_key,
        draft_model=draft_model,
        draft_base_url=getenv("DRAFT_BASE_URL", "").strip(),
        draft_http_referer=getenv("DRAFT_HTTP_REFERER", "").strip(),
        draft_app_title=getenv("DRAFT_APP_TITLE", "social-flow").strip() or "social-flow",
        draft_timeout_seconds=float(getenv("DRAFT_TIMEOUT_SECONDS", "45").strip() or "45"),
        google_service_account_json=_required("GOOGLE_SERVICE_ACCOUNT_JSON"),
        spreadsheet_id=_required("GOOGLE_SHEETS_SPREADSHEET_ID"),
        spreadsheet_title=getenv("GOOGLE_SHEETS_TITLE", "Short Video Performance Hub").strip() or "Short Video Performance Hub",
        queue_tab=getenv("GOOGLE_SHEETS_QUEUE_TAB", "queue").strip() or "queue",
        sources_config_json=getenv("SOCIAL_FLOW_SOURCES_CONFIG_JSON", "").strip(),
        google_drive_folder_url=getenv("GOOGLE_DRIVE_FOLDER_URL", "").strip(),
        google_drive_folder_id=getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip(),
        x_api_access_token=getenv("X_API_ACCESS_TOKEN", "").strip(),
        x_expected_handle=getenv("X_EXPECTED_HANDLE", "").strip().lstrip("@"),
        linkedin_access_token=getenv("LINKEDIN_ACCESS_TOKEN", "").strip(),
        linkedin_author_urn=getenv("LINKEDIN_AUTHOR_URN", "").strip(),
        linkedin_api_version=getenv("LINKEDIN_API_VERSION", "202502").strip() or "202502",
        chrome_executable_path=getenv("CHROME_EXECUTABLE_PATH", "").strip() or _default_chrome_executable_path(),
        chrome_user_data_dir=getenv("CHROME_USER_DATA_DIR", "").strip() or _default_chrome_user_data_dir(),
        chrome_profile_directory=getenv("CHROME_PROFILE_DIRECTORY", "Default").strip() or "Default",
        chrome_main_user_data_dir=chrome_main_user_data_dir,
        chrome_main_profile_label=getenv("CHROME_MAIN_PROFILE_LABEL", "二千 (Nicky automation)").strip()
        or "二千 (Nicky automation)",
        chrome_main_profile_directory=chrome_main_profile_directory,
        chrome_main_preferences_path=chrome_main_preferences_path,
        chrome_main_remote_debugging_port=int(getenv("CHROME_MAIN_REMOTE_DEBUGGING_PORT", "9222").strip() or "9222"),
        chrome_task_group_prefix=getenv("CHROME_TASK_GROUP_PREFIX", "social-flow").strip() or "social-flow",
        chrome_publish_headless=_bool_env("CHROME_PUBLISH_HEADLESS", default=False),
    )


def build_draft_client(settings: Settings) -> OpenAI:
    default_headers: dict[str, str] = {}
    if settings.draft_http_referer:
        default_headers["HTTP-Referer"] = settings.draft_http_referer
    if settings.draft_app_title:
        default_headers["X-Title"] = settings.draft_app_title

    kwargs: dict[str, object] = {"api_key": settings.draft_api_key, "timeout": settings.draft_timeout_seconds}
    if settings.draft_base_url:
        kwargs["base_url"] = settings.draft_base_url
    if default_headers:
        kwargs["default_headers"] = default_headers
    return OpenAI(**kwargs)
