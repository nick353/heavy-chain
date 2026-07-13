from __future__ import annotations

import csv
import base64
import errno
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import hashlib
import json
import multiprocessing as mp
import os
import signal
import stat
import sqlite3
import queue
import re
import shutil
import shlex
import socket
import struct
import sys
import time
import threading
import uuid
import tomllib
from collections import defaultdict
from pathlib import Path
import subprocess
from typing import Annotated, Any
from urllib.parse import quote, unquote, urlparse
from urllib.error import URLError
from urllib.request import Request, urlopen

import typer
from dotenv import load_dotenv

from social_flow.ai import generate_localized_copy, humanize_post_for_publish
from social_flow.chrome_publish import ChromeLaunchConfig, ChromePublisher
from social_flow.computer_use import (
    BrowserComputerConfig,
    load_computer_use_model,
    run_browser_computer_task,
)
from social_flow.config import Settings, build_draft_client, load_settings
from social_flow.local_queue import LocalQueueRepository
from social_flow.models import ENGAGEMENT_RELATIONSHIP_COLUMNS, QueueRow
from social_flow.publishers import LinkedInPublisher, XPublisher
from social_flow.research_plan import build_research_plan, format_research_plan_markdown
from social_flow.sheets import SheetsRepository, create_spreadsheet
from social_flow.sources import SourceDocument
from social_flow.sources import (
    VIDEO_EXTENSIONS,
    collect_from_rss,
    collect_from_source_configs,
    collect_from_google_drive_folder,
    extract_google_drive_folder_id,
    extract_google_drive_file_id,
    collect_from_url_list,
)
from social_flow.scheduler_control import (
    DEFAULT_AUTOMATION_DB as SCHEDULER_CONTROL_DB,
    DEFAULT_AUTOMATIONS_ROOT as SCHEDULER_AUTOMATIONS_ROOT,
    SchedulerControlError,
    bridge_binding_from_env,
    claim_control_execution,
    finalize_control_state,
    load_control_request,
    load_and_consume_trusted_wrapper_receipt,
    prepare_control_run,
    transition_control_to_running,
    validate_control_request_registration,
    validate_bridge_receipt_v2,
    validate_trusted_wrapper_env,
    write_control_blocker,
    write_control_cleanup,
)
from social_flow.utils import make_item_id, utc_now
from social_flow.utils import extract_linkedin_post_id, extract_x_post_id
from social_flow.video_ai import analyze_browser_automation_video, generate_video_social_copy

csv.field_size_limit(sys.maxsize)

app = typer.Typer(no_args_is_help=True)
JOB_MANAGER_AUTOMATION_TOML = Path("/Users/nichikatanaka/.codex/automations/job-application-manager/automation.toml")
JOB_MANAGER_STATE = Path("/Users/nichikatanaka/.codex/automations/job-application-manager/STATE.md")
JOB_MANAGER_MEMORY = Path("/Users/nichikatanaka/.codex/automations/job-application-manager/memory.md")
JOB_MANAGER_PROJECT_PROMPT = Path("/Users/nichikatanaka/Documents/New project/.codex/prompts/job-application-automation.md")
JOB_MANAGER_PROJECT_CWD = Path("/Users/nichikatanaka/Documents/New project")
JOB_MANAGER_BRIDGE_CLIENT = Path("/Users/nichikatanaka/Documents/New project/scripts/browser_use/chrome_extension_trusted_bridge_client.mjs")
JOB_MANAGER_BRIDGE_SERVER = Path("/Users/nichikatanaka/Documents/New project/scripts/browser_use/chrome_extension_trusted_bridge_server.mjs")
JOB_MANAGER_TURN_METADATA_SHIM = Path.home() / ".codex" / "automations" / "job-application-manager" / "codex_turn_metadata_shim.cjs"
JOB_MANAGER_RUN_SUMMARIES_ROOT = Path("/Users/nichikatanaka/Documents/New project/artifacts/run-summaries")
JOB_MANAGER_CURRENT_POINTER = JOB_MANAGER_RUN_SUMMARIES_ROOT / "job-manager-current" / "current-run.json"
JOB_MANAGER_CURRENT_LEASE = JOB_MANAGER_RUN_SUMMARIES_ROOT / "job-manager-current" / "active-run.json"
JOB_APPLICATIONS_SPREADSHEET_ID = "1i90Flrf5NZiCQ8am1s8HzONsLcquMlXbbogz3jpqYUs"
DEFAULT_SAFE_CODEX_HOME = Path("/private/tmp/codex-job-manager-home")
JOB_MANAGER_CODEX_EXEC_SANDBOX = "danger-full-access"
DEFAULT_REGISTERED_AUTOMATIONS_ROOT = Path.home() / ".codex" / "automations"
VIDEO_QA_DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
VIDEO_QA_SMOKE_ALLOWED_URL_SCHEMES = {"file", "data", "about", "blob"}
VIDEO_QA_STAGE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
GOOGLE_SHEETS_CELL_CHARACTER_LIMIT = 49_000
VIDEO_QA_NO_POST_DEFAULT_SURFACE_URL = "https://www.linkedin.com/feed/"
VIDEO_QA_NO_POST_EXPECTED_PROFILE_DIR = "/Users/nichikatanaka/.daily-ai-chrome-extension"
CHROME_BUNDLED_VERSION = "26.707.41301"
REDACTED_SECRET = "[REDACTED]"
REDACTED_EMAIL = "[REDACTED_EMAIL]"
REDACTED_AUTH = "[REDACTED_AUTH]"
REDACTED_QUERY_VALUE = "[REDACTED_QUERY_VALUE]"
SECRET_KEY_PARTS = ("authorization", "bearer", "token", "password", "passwd", "pwd", "secret", "api_key", "apikey", "x-api-key", "email")
REGISTERED_CHILD_RESULT_SCHEMA = "registered-child-result.v1"

RUN_MODE_CONFIGS = {
    "daily_normal": {
        "research_target": "10-20 posts",
        "posting_target": "1 strong post",
        "engagement_target": "X 5 likes + 2 comments; LinkedIn 5 likes + 1 comment",
        "purpose": "daily publish with enough feed context",
    },
    "deep_research_voice": {
        "research_target": "100+ recommended-feed posts",
        "posting_target": "0-1 posts",
        "engagement_target": "0-3 high-signal actions",
        "purpose": "voice, format, and feed pattern study",
    },
    "performance_review": {
        "research_target": "recent published rows and visible metrics",
        "posting_target": "0-1 posts",
        "engagement_target": "reply to important reactions first",
        "purpose": "learn what to promote or demote before the next run",
    },
}

X_CONTENT_FORMATS = {
    "native_quote_business_translation",
    "official_demo_breakdown",
    "article_number_breakdown",
    "market_signal_visual",
    "self_made_summary_card",
}

POSTING_SURFACE_LABELS = {
    "x_quote_interpretation_card": "X引用解釈カード型",
    "x_self_made_decision_card": "X自作判断カード型",
    "linkedin_square_image": "LinkedIn正方形1枚画像型",
    "linkedin_carousel": "LinkedInカルーセル型",
    "linkedin_link_card": "LinkedInリンクカード型",
    "x_text_url": "X本文+URL型",
}

X_TEXT_URL_BLOCKED_CONTENT_FORMATS = {
    "native_quote_business_translation",
    "official_quote",
    "quote_repost_commentary",
    "official_demo_breakdown",
    "article_number_breakdown",
    "self_made_summary_card",
}

GENERIC_OPENING_PATTERNS = {
    "x": [
        "まず気になったのは",
        "最初に気になったのは",
        "実務目線だとここが気になりました",
        "発表されました",
        "注目されています",
        "以下がポイントです",
        "話題です",
    ],
    "linkedin": [
        "one thing i noticed",
        "one practical way to read",
        "a useful way to read",
        "a practical way to read",
        "the part i keep coming back to is",
        "the interesting part",
        "what stands out",
        "the thing that stands out",
        "this update matters because",
        "the practical implication",
        "my read on this",
        "this feels useful because",
        "what caught my eye",
        "why it matters",
    ],
}

OPERATION_VERIFICATION_ID_PREFIXES = ("demo-", "test-", "verification-")
OPERATION_VERIFICATION_ID_TOKENS = (
    "surface-verification",
    "surface-gate",
    "placeholder",
    "operation-verification",
    "operation_verification",
    "操作検証",
)
GENERATED_MEDIA_PLACEHOLDER_TOKENS = (
    "operation verification",
    "operation-verification",
    "operation_verification",
    "demo-",
    "demo_",
    "placeholder",
    "surface verification",
    "surface-verification",
    "surface_gate",
    "surface-gate",
    "smoke test",
    "操作検証用",
    "検証用",
)

LEGACY_CONTENT_FORMAT_MAP = {
    "quote": "native_quote_business_translation",
    "repost_commentary": "native_quote_business_translation",
}

AUTOMATION_FAILURE_CATEGORY_PATTERNS = (
    ("auth", ("auth_blocked", "login required", "login_required", "checkpoint")),
    ("lane", ("local_automation_profile_busy", "local_automation_profile_unavailable", "chrome_extension_profile2_unavailable", "trusted_runner_bridge_unavailable")),
    ("account", ("account_not_verified", "wrong_or_unverified_account")),
    ("input_reflection", ("body_not_reflected", "comment_not_reflected", "target_not_verified")),
    ("clickability", ("disabled_submit", "post_button_unavailable", "button was not enabled", "button was not visible", "click_intercepted", "click intercepted")),
    ("surface", ("surface_missing", "link_card_not_reflected", "quote_card_not_reflected")),
    ("media_permission", ("media_upload_permission_blocked", "file_input_not_materialized", "filechooser", "photo_route_unavailable")),
    ("completion", ("capture_failed", "URL capture pending", "completion URL", "completion state")),
    ("timeout", ("timeout", "timed out", "transport_timeout", "dom_snapshot_timeout")),
)


def _automation_failure_category(reason: str) -> str:
    normalized = str(reason or "").strip()
    if not normalized:
        return ""
    lowered = normalized.lower()
    for category, patterns in AUTOMATION_FAILURE_CATEGORY_PATTERNS:
        if any(pattern.lower() in lowered for pattern in patterns):
            return category
    return "unknown"


def _append_automation_failure_category(stop_reason: str, media_receipt: str = "") -> str:
    category = _automation_failure_category(stop_reason)
    if not category:
        return media_receipt
    marker = f"automation_failure_category={category}"
    if "automation_failure_category=" in media_receipt:
        return media_receipt
    return "; ".join(part for part in [media_receipt.strip(), marker] if part)


def _automation_failure_receipt(reason: str) -> str:
    category = _automation_failure_category(reason)
    if not category:
        return ""
    return f"automation_failure_category={category}"


def _append_publish_receipt_detail(media_receipt: str, label: str, detail: str) -> str:
    normalized_label = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(label or "detail")).strip("_") or "detail"
    normalized_detail = " ".join(str(detail or "").split())[:500]
    if not normalized_detail:
        return media_receipt
    parts = [part.strip() for part in str(media_receipt or "").split(";") if part.strip()]
    detail_part = f"{normalized_label}:{normalized_detail}"
    if detail_part not in parts:
        parts.append(detail_part)
    category_part = _automation_failure_receipt(normalized_detail)
    if category_part and category_part not in parts:
        parts.append(category_part)
    return "; ".join(parts)


def _publish_failure_stop_reason(failure_reasons: list[str]) -> str:
    if not failure_reasons:
        return "publish_send_failed"
    categories = [_automation_failure_category(reason) for reason in failure_reasons]
    category_set = {category for category in categories if category}
    for category, stop_reason in (
        ("auth", "auth_blocked"),
        ("media_permission", "media_upload_permission_blocked"),
        ("surface", "surface_missing"),
        ("account", "wrong_or_unverified_account"),
    ):
        if category in category_set:
            return stop_reason
    return "publish_send_failed"


def _append_automation_health_receipt(
    media_receipt: str = "",
    *,
    stage: str = "",
    lane: str = "",
    source_of_truth: str = "",
    completion_proof: str = "",
    resume_target: str = "",
) -> str:
    parts = [part.strip() for part in media_receipt.split(";") if part.strip()]
    if any(part.startswith("automation_health=") for part in parts):
        return media_receipt
    health_parts = [
        f"stage:{stage}" if stage else "",
        f"lane:{lane}" if lane else "",
        f"source:{source_of_truth}" if source_of_truth else "",
        f"completion:{completion_proof}" if completion_proof else "",
        f"resume:{resume_target}" if resume_target else "",
    ]
    health = "|".join(part for part in health_parts if part)
    if health:
        parts.append(f"automation_health={health}")
    return "; ".join(parts)


def _automation_health_payload(
    *,
    stage: str = "",
    lane: str = "",
    source_of_truth: str = "",
    completion_required: str = "",
    resume_target: str = "",
) -> dict[str, str]:
    return {
        "stage": stage,
        "lane": lane,
        "source_of_truth": source_of_truth,
        "completion_required": completion_required,
        "resume_target": resume_target,
    }


def _safe_int(value: str, default: int = 0) -> int:
    try:
        return int(str(value or "").strip())
    except ValueError:
        return default


def _chrome_cdp_json(port: int, path: str, timeout_seconds: float = 1.0) -> object | None:
    try:
        with urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except (OSError, URLError, json.JSONDecodeError):
        return None


def _ensure_chrome_cdp_page_target(port: int, timeout_seconds: float = 1.0) -> bool:
    targets = _chrome_cdp_json(port, "/json/list", timeout_seconds=timeout_seconds)
    if isinstance(targets, list) and any(target.get("type") == "page" for target in targets if isinstance(target, dict)):
        return True
    created = _chrome_cdp_json(port, "/json/new?about:blank", timeout_seconds=timeout_seconds)
    return isinstance(created, dict) and created.get("type") == "page"


def _wait_for_chrome_cdp(port: int, timeout_seconds: float = 8.0) -> object | None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        version = _chrome_cdp_json(port, "/json/version", timeout_seconds=1.0)
        if isinstance(version, dict):
            return version
        time.sleep(0.4)
    return None


def _cleanup_stale_chrome_singleton_locks(user_data_dir: Path) -> None:
    lock_path = user_data_dir / "SingletonLock"
    try:
        target = os.readlink(lock_path)
    except OSError:
        return

    match = re.search(r"-(\d+)$", target)
    if not match:
        return

    pid = int(match.group(1))
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        pass
    except PermissionError:
        return
    else:
        return

    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        try:
            (user_data_dir / name).unlink()
        except FileNotFoundError:
            continue


def _open_main_chrome_profile_process(settings: Settings, start_url: str, port: int) -> list[str]:
    main_user_data_dir = Path(settings.chrome_main_user_data_dir).expanduser()
    main_user_data_dir.mkdir(parents=True, exist_ok=True)
    _cleanup_stale_chrome_singleton_locks(main_user_data_dir)
    cmd = [
        settings.chrome_executable_path,
        f"--user-data-dir={main_user_data_dir}",
        f"--profile-directory={settings.chrome_main_profile_directory}",
        f"--remote-debugging-port={port}",
        "--remote-allow-origins=http://127.0.0.1:*",
        start_url,
    ]
    subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return cmd


def _resolve_start_url(positional_start_url: str | None, option_start_url: str | None) -> str:
    positional = (positional_start_url or "").strip()
    option = (option_start_url or "").strip()
    if positional and option and positional != option:
        raise typer.BadParameter("Pass start URL either as a positional argument or --start-url, not both with different values.")
    return positional or option or "about:blank"


def _process_rows() -> list[tuple[int, int, str, str]]:
    try:
        output = subprocess.check_output(
            ["ps", "-axo", "pid,ppid,stat,command"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return []

    rows: list[tuple[int, int, str, str]] = []
    for line in output.splitlines()[1:]:
        parts = line.strip().split(maxsplit=3)
        if len(parts) < 4:
            continue
        try:
            rows.append((int(parts[0]), int(parts[1]), parts[2], parts[3]))
        except ValueError:
            continue
    return rows


def _automation_lane_busy_marker_path() -> Path:
    configured = os.getenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", "").strip()
    if configured:
        return Path(configured).expanduser()
    codex_home = Path(os.getenv("CODEX_HOME", str(Path.home() / ".codex"))).expanduser()
    return codex_home / "automations" / "sns-daily-ai-publish-run" / "nicky-lane-busy.json"


def _parse_utc_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _automation_lane_busy_marker(now: datetime | None = None) -> tuple[dict[str, object] | None, str]:
    path = _automation_lane_busy_marker_path()
    if not path.exists():
        return None, ""
    try:
        marker = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return None, f"invalid_busy_marker: {exc}"
    if not isinstance(marker, dict):
        return None, "invalid_busy_marker: root must be an object"
    expires_at = _parse_utc_datetime(marker.get("expires_at"))
    if expires_at and expires_at <= (now or datetime.now(timezone.utc)):
        return None, "expired_busy_marker"
    reason = str(marker.get("reason") or "").strip()
    if reason in {"user_reported_not_open", "user_reported_available", "not_busy"}:
        return None, f"ignored_busy_marker: reason={reason}"
    marker = dict(marker)
    marker["path"] = str(path)
    return marker, ""


def _automation_lane_conflicting_targets(port: int, purpose: str | None = None) -> list[dict[str, str]]:
    targets = _chrome_cdp_json(port, "/json/list", timeout_seconds=1.0)
    if not isinstance(targets, list):
        return []
    idle_urls = (
        "",
        "about:blank",
        "chrome://newtab/",
        "chrome://version/",
        "chrome://welcome/",
    )
    conflicts = []
    for target in targets:
        if not isinstance(target, dict) or target.get("type") != "page":
            continue
        url = str(target.get("url") or "")
        if url in idle_urls or url.startswith("devtools://"):
            continue
        conflicts.append(
            {
                "title": str(target.get("title") or "")[:120],
                "url": url[:180],
            }
        )
    return conflicts[:10]


def _automation_lane_marker_is_active_lock(
    marker: dict[str, object] | None,
    *,
    owner: str | None = None,
) -> bool:
    if not marker:
        return False
    reason = str(marker.get("reason") or "").strip()
    marker_owner = str(marker.get("owner") or "").strip()
    if reason in {"user_reported_busy", "user_reported_not_open", "user_reported_available", "not_busy"}:
        return False
    if owner and marker_owner == owner:
        return False
    return bool(marker_owner) and _parse_utc_datetime(marker.get("expires_at")) is not None


def _automation_lane_status_payload(
    settings: Settings,
    port: int,
    purpose: str | None = None,
    owner: str | None = None,
) -> dict[str, object]:
    current_pid = os.getpid()
    main_user_data_dir = str(Path(settings.chrome_main_user_data_dir).expanduser())
    process_rows = _process_rows()
    lane_reference_tokens = (
        main_user_data_dir,
        f"127.0.0.1:{port}",
        f"localhost:{port}",
        f"--remote-debugging-port={port}",
    )
    automation_owner_tokens = (
        "social-flow",
        "playwright",
        "node",
        "python",
        "uv run",
        "codex exec",
    )
    read_only_probe_tokens = (
        "/json/version",
        "/json/list",
        "/json/protocol",
    )
    chrome_processes = [
        {"pid": pid, "ppid": ppid, "stat": stat}
        for pid, ppid, stat, command in process_rows
        if main_user_data_dir in command and f"--remote-debugging-port={port}" in command
    ]
    automation_processes = [
        {"pid": pid, "ppid": ppid, "stat": stat, "command": command}
        for pid, ppid, stat, command in process_rows
        if pid != current_pid
        and not command.startswith("/Applications/Google Chrome.app/")
        and not any(token in command for token in read_only_probe_tokens)
        and any(token in command for token in lane_reference_tokens)
        and any(token in command for token in automation_owner_tokens)
    ]
    busy_marker, busy_marker_error = _automation_lane_busy_marker()
    conflicting_targets = _automation_lane_conflicting_targets(port, purpose)
    cdp_ok = isinstance(_chrome_cdp_json(port, "/json/version", timeout_seconds=1.0), dict)
    busy_sources = []
    if automation_processes:
        busy_sources.append("process")
    if _automation_lane_marker_is_active_lock(busy_marker, owner=owner):
        busy_sources.append("busy_marker")
    busy = bool(busy_sources)
    publish_ready = (not busy) and cdp_ok and bool(chrome_processes)
    return {
        "ok": not busy,
        "busy_ok": not busy,
        "publish_ready": publish_ready,
        "profile_label": "Chrome Extension Profile 2",
        "profile_directory": "Profile 2",
        "user_data_dir": str(_default_google_chrome_user_data_dir()),
        "remote_debugging_port": port,
        "cdp_ok": cdp_ok,
        "chrome_process_count": len(chrome_processes),
        "automation_process_count": len(automation_processes),
        "social_flow_process_count": len(automation_processes),
        "busy": busy,
        "busy_sources": busy_sources,
        "busy_marker": busy_marker or {},
        "busy_marker_error": busy_marker_error,
        "busy_marker_path": str(_automation_lane_busy_marker_path()),
        "conflicting_target_count": len(conflicting_targets),
        "conflicting_targets": conflicting_targets,
        "stop_reason": "local_automation_profile_busy" if busy else "",
        "fallback_allowed": True,
        "next_action": (
            "Use the Chrome plugin registered runner for Daily AI authenticated browser work. "
            "If it cannot verify account/body/submit/capture plus tab/window recording and local proof gates, stop before live send."
            if busy
            else "Use the Chrome plugin registered runner for Daily AI authenticated browser work. Existing Nicky/Profile 2 state is diagnostic only and must not become the production lane."
        ),
        "chrome_processes": chrome_processes[:10],
        "automation_processes": automation_processes[:10],
        "social_flow_processes": automation_processes[:10],
    }


def _browser_lane_resolution_payload(
    settings: Settings,
    port: int,
    purpose: str,
    open_if_missing: bool,
    timeout_seconds: float,
    owner: str | None = None,
) -> dict[str, object]:
    status = _automation_lane_status_payload(settings, port, purpose, owner=owner)
    base: dict[str, object] = {
        "ok": True,
        "purpose": purpose,
        "profile_label": "Chrome Extension Profile 2",
        "profile_directory": "Profile 2",
        "user_data_dir": str(_default_google_chrome_user_data_dir()),
        "remote_debugging_port": port,
        "lane_status": status,
    }
    return {
        **base,
        "lane": "chrome_extension_profile2_fallback",
        "browser_lane_used": "chrome_extension_profile2_fallback",
        "fallback_allowed": True,
        "stop_reason": "",
        "must_run": [
            "Use the Chrome plugin registered runner as the only production browser lane.",
            "Pass this resolve-browser-lane payload as diagnostic context only; do not start Chrome Extension/Profile 2 sender from it.",
            "Claim/reuse Chrome plugin-controlled target tabs before opening new tabs.",
            "Proceed only after expected-account, body/readback, enabled-submit, completion-capture, tab/window recording, and local proof gates pass.",
            "Do not switch authenticated work to Chrome Extension/Profile 2, Playwright + Nicky automation, persistent profiles, or isolated browsers.",
        ],
        "runner_hint": (
            "For Daily AI publish/engagement, use the Chrome plugin registered runner. "
            "Legacy Chrome Extension/Profile 2 modules are diagnosis/readback only."
        ),
        "next_action": status["next_action"],
    }


def _read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8")


JOB_MANAGER_REGISTERED_CHILD_GUARD = """

Registered scheduler child guard 2026-07-13: this launch message is already running inside the live registered scheduler child. Do not invoke `run-codex-automation --stage execute`, `run-scheduler-now --execute`, `run-job-manager-now --execute`, `run-scheduler-loop --execute`, or another `codex exec` recursively. Run the Job Application Manager workflow body directly after its preflight. The dry-run scheduler command remains diagnostic-only.

Current-run bridge proof 2026-07-13: use only the `scheduler_control_receipt.v2` attached to this child. Its automation/control ids, origin and execution task/turn ids, nonce, registered prompt/cwd, launch hash, stage, expiry, and trusted bridge instance must match the current `scheduler_control_request.v2`. Never treat a prior same-session receipt or older bridge artifact as a live launch gate.
"""


def _registered_automation_launch_packet(
    *,
    automation_toml_path: Path,
    state_path: Path,
    memory_path: Path,
    project_prompt_path: Path | None,
    automation_id: str,
    automation_name: str,
) -> dict[str, object]:
    automation_toml = _read_text_file(automation_toml_path)
    project_prompt = _read_text_file(project_prompt_path) if project_prompt_path is not None else ""
    automation_prompt = tomllib.loads(automation_toml)["prompt"]
    last_run = ""
    try:
        state_text = _read_text_file(state_path)
        match = re.search(r"^Updated:\s*(.+)$", state_text, re.M)
        if match:
            last_run = match.group(1).strip()
    except Exception:
        state_text = ""
    try:
        memory_text = _read_text_file(memory_path)
    except Exception:
        memory_text = ""
    registered_child_guard = JOB_MANAGER_REGISTERED_CHILD_GUARD if automation_id == "job-application-manager" else ""
    launch_message = (
        f"Automation: {automation_name}\n"
        f"Automation ID: {automation_id}\n"
        f"Automation memory: {memory_path}\n"
        f"Last run: {last_run}\n\n"
        f"{automation_prompt}"
        f"{registered_child_guard}"
    )
    return {
        "automation_toml": str(automation_toml_path),
        "project_prompt": str(project_prompt_path) if project_prompt_path is not None else "",
        "state": str(state_path),
        "memory": str(memory_path),
        "automation_id": automation_id,
        "automation_name": automation_name,
        "last_run": last_run,
        "registered_child_guard": registered_child_guard.strip(),
        "launch_message": launch_message,
        "launch_message_sha256": hashlib.sha256(launch_message.encode("utf-8")).hexdigest(),
        "automation_prompt_sha256": hashlib.sha256(automation_prompt.encode("utf-8")).hexdigest(),
        "project_prompt_sha256": hashlib.sha256(project_prompt.encode("utf-8")).hexdigest() if project_prompt else "",
        "memory_sha256": hashlib.sha256(memory_text.encode("utf-8")).hexdigest() if memory_text else "",
    }


def _job_manager_launch_packet() -> dict[str, object]:
    launch_packet = _registered_automation_launch_packet(
        automation_toml_path=JOB_MANAGER_AUTOMATION_TOML,
        state_path=JOB_MANAGER_STATE,
        memory_path=JOB_MANAGER_MEMORY,
        project_prompt_path=JOB_MANAGER_PROJECT_PROMPT,
        automation_id="job-application-manager",
        automation_name="Job Application Manager",
    )
    _assert_job_manager_bridge_probe_contract(launch_packet)
    return launch_packet


def _registered_automation_model(automation_toml_path: Path) -> str:
    try:
        automation_toml = _read_text_file(automation_toml_path)
        model = tomllib.loads(automation_toml).get("model", "")
    except Exception:
        return ""
    return str(model).strip()


def _reject_recursive_registered_execute(*, execute: bool, automation_id: str) -> None:
    if not execute or os.environ.get("SOCIAL_FLOW_REGISTERED_AUTOMATION_CHILD") != "1":
        return
    active_id = str(os.environ.get("SOCIAL_FLOW_REGISTERED_AUTOMATION_ID") or "unknown").strip() or "unknown"
    raise RuntimeError(
        "registered_automation_recursive_execute_blocked: "
        f"active_automation_id={active_id} requested_automation_id={automation_id}"
    )


def _attach_trusted_wrapper_receipt_to_launch_packet(
    launch_packet: dict[str, object],
    receipt: dict[str, object],
    *,
    expected_scheduler_run_id: str,
    expected_scheduler_run_dir: Path,
    expected_launch_dir: Path,
) -> tuple[dict[str, object], dict[str, object]]:
    receipt_path = str(receipt.get("receipt_path") or "").strip()
    bridge_instance_id = str(receipt.get("bridge_instance_id") or "").strip()
    browser_id = str(receipt.get("browser_id") or "").strip()
    browser_name = str(receipt.get("browser_name") or "").strip()
    owner_id = str(receipt.get("owner_id") or "").strip()
    if not receipt_path or not bridge_instance_id or not browser_id or not browser_name or not owner_id:
        raise RuntimeError("trusted_wrapper_receipt_runtime_binding_missing")
    if (
        str(receipt.get("scheduler_run_id") or "") != expected_scheduler_run_id
        or Path(str(receipt.get("scheduler_run_dir") or "")).resolve() != expected_scheduler_run_dir.resolve()
    ):
        raise RuntimeError("trusted_wrapper_receipt_scheduler_run_binding_invalid")
    browser_metadata = receipt.get("browser_metadata")
    current_probe = {
        "bridge_run_id": str(receipt.get("receipt_id") or ""),
        "bridge_receipt_path": receipt_path,
        "backend": str(receipt.get("backend") or "chrome_extension_trusted_bridge"),
        "browser_id": browser_id,
        "browser_name": browser_name,
        "browser_type": str(receipt.get("browser_type") or "extension"),
        "browser_metadata": browser_metadata if isinstance(browser_metadata, dict) else {},
        "scheduler_run_id": expected_scheduler_run_id,
        "scheduler_run_dir": str(expected_scheduler_run_dir.resolve()),
        "launch_dir": str(expected_launch_dir.resolve()),
        "codex_thread_id": str(receipt.get("execution_thread_id") or ""),
        "codex_turn_id": str(receipt.get("execution_turn_id") or ""),
        "codex_session_id": str(receipt.get("execution_session_id") or ""),
        "bridge_instance_id": bridge_instance_id,
        "owner_id": owner_id,
        "owner_heartbeat_path": str(receipt.get("owner_heartbeat_path") or ""),
        "trusted_wrapper_receipt_verified": True,
        "ok": True,
        "ready": True,
        "stage": "job_manager_bridge_readiness_probe",
        **bridge_binding_from_env(),
    }
    proof_section = (
        "\n\nCurrent outer trusted-wrapper browser proof (machine-selected):\n"
        f"bridge_run_id={current_probe['bridge_run_id']}\n"
        f"bridge_receipt_path={receipt_path}\n"
        f"bridge_instance_id={bridge_instance_id}\n"
        f"backend={current_probe['backend']}\n"
        f"browser_metadata={json.dumps(current_probe['browser_metadata'], ensure_ascii=False)}\n"
        f"scheduler_run_id={expected_scheduler_run_id}\n"
        f"scheduler_run_dir={expected_scheduler_run_dir.resolve()}\n"
        f"launch_dir={expected_launch_dir.resolve()}\n"
        "ok=true\nready=true\nstage=job_manager_bridge_readiness_probe\n"
        "The outer trusted wrapper owns this browser runtime. Do not start an inner warmup or browser client."
    )
    updated = dict(launch_packet)
    launch_message = f"{launch_packet.get('launch_message') or ''}{proof_section}"
    updated["launch_message"] = launch_message
    updated["launch_message_sha256"] = hashlib.sha256(launch_message.encode("utf-8")).hexdigest()
    updated["current_bridge_probe"] = current_probe
    return updated, current_probe


def _job_manager_select_bridge_context(
    launch_packet: dict[str, object],
    *,
    trusted_wrapper_receipt: dict[str, object] | None,
    codex_home: Path,
    run_id: str,
    run_dir: Path,
    launch_dir: Path,
) -> tuple[dict[str, object], dict[str, object]]:
    if trusted_wrapper_receipt is not None:
        return _attach_trusted_wrapper_receipt_to_launch_packet(
            launch_packet,
            trusted_wrapper_receipt,
            expected_scheduler_run_id=run_id,
            expected_scheduler_run_dir=run_dir,
            expected_launch_dir=launch_dir,
        )
    bridge_probe = warmup_job_manager_bridge(
        codex_home=codex_home,
        artifact_dir=run_dir / "bridge",
        run_id=run_id,
        launch_dir=launch_dir,
        scheduler_run_id=run_id,
        scheduler_run_dir=run_dir,
        timeout_seconds=30,
    )
    return (
        _attach_current_bridge_probe_to_launch_packet(
            launch_packet,
            bridge_probe,
            expected_scheduler_run_id=run_id,
            expected_scheduler_run_dir=run_dir,
            expected_launch_dir=launch_dir,
        ),
        bridge_probe,
    )


def _job_manager_attach_registered_child_result_contract(
    launch_packet: dict[str, object],
    *,
    request: dict[str, object],
    run_dir: Path,
) -> dict[str, object]:
    result_path = run_dir / "registered-child-result.json"
    audit_path = run_dir / "completion-audit.json"
    control_state_pointer = Path(str(request["control_run_dir"])) / "control-state-current.json"
    required_paths = [
        run_dir / "extension-first-preflight.json",
        run_dir / "live-preflight.json",
        run_dir / "launch-packet.json",
        run_dir / "job-manager-ideal-flow.json",
        audit_path,
    ]
    contract = (
        "\n\nRegistered child result contract (mandatory; parent does not infer completion from prose/stdout):\n"
        f"control_state_pointer={control_state_pointer}\n"
        "Before any workflow work, read that pointer and require status=running.\n"
        f"result_path={result_path}\n"
        f"completion_audit_path={audit_path}\n"
        f"scheduler_run_id={request['scheduler_run_id']}\n"
        f"control_run_id={request['control_run_id']}\n"
        "Write exactly one private regular file with schema registered-child-result.v1 using same-directory temp, "
        "open O_EXCL mode 0600, write+fsync+close, and atomic no-replace publication. Never overwrite it.\n"
        "Required fields: schema, result_id, scheduler_run_id, control_run_id, status(completed|blocked), "
        "exact_blocker, external_action_count(nonnegative integer), completion_audit_path, "
        "required_artifact_paths(array), external_action_artifact_paths(array).\n"
        "completed requires exact_blocker empty, a successful run-owned completion audit, every required artifact, "
        "and one run-owned action artifact per external action. blocked requires one nonempty exact_blocker.\n"
        f"Parent-required artifact paths={json.dumps([str(item) for item in required_paths], ensure_ascii=False)}\n"
        "Exit code transports process success/failure only. The result file is the sole workflow completion record."
    )
    updated = dict(launch_packet)
    launch_message = f"{launch_packet.get('launch_message') or ''}{contract}"
    updated["launch_message"] = launch_message
    updated["launch_message_sha256"] = hashlib.sha256(launch_message.encode("utf-8")).hexdigest()
    updated["registered_child_result_path"] = str(result_path)
    updated["completion_audit_path"] = str(audit_path)
    updated["control_state_pointer"] = str(control_state_pointer)
    return updated


def _job_manager_path_within_run(path_value: object, run_dir: Path, *, blocker: str) -> Path:
    text = str(path_value or "").strip()
    if not text:
        raise RuntimeError(blocker)
    candidate = Path(text).expanduser()
    if not candidate.is_absolute():
        raise RuntimeError(blocker)
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError(blocker) from exc
    if not resolved.is_relative_to(run_dir.resolve()) or candidate.is_symlink():
        raise RuntimeError(blocker)
    return resolved


def _job_manager_validate_registered_child_result(
    *,
    run_dir: Path,
    scheduler_run_id: str,
    control_run_id: str,
) -> dict[str, object]:
    result_path = run_dir / "registered-child-result.json"
    if not result_path.exists():
        raise RuntimeError("registered_child_result_missing")
    metadata = result_path.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or result_path.is_symlink()
        or metadata.st_uid != os.getuid()
        or metadata.st_mode & 0o777 != 0o600
        or metadata.st_nlink != 1
    ):
        raise RuntimeError("registered_child_result_file_invalid")
    try:
        result = json.loads(result_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError("registered_child_result_malformed") from exc
    if not isinstance(result, dict) or result.get("schema") != REGISTERED_CHILD_RESULT_SCHEMA:
        raise RuntimeError("registered_child_result_schema_invalid")
    if not str(result.get("result_id") or "").strip():
        raise RuntimeError("registered_child_result_id_missing")
    if (
        str(result.get("scheduler_run_id") or "") != scheduler_run_id
        or str(result.get("control_run_id") or "") != control_run_id
    ):
        raise RuntimeError("registered_child_result_binding_mismatch")
    status_value = result.get("status")
    exact_blocker = str(result.get("exact_blocker") or "").strip()
    if status_value not in {"completed", "blocked"}:
        raise RuntimeError("registered_child_result_status_invalid")
    action_count = result.get("external_action_count")
    required_artifacts = result.get("required_artifact_paths")
    action_artifacts = result.get("external_action_artifact_paths")
    if (
        not isinstance(action_count, int)
        or isinstance(action_count, bool)
        or action_count < 0
        or not isinstance(required_artifacts, list)
        or not all(isinstance(item, str) for item in required_artifacts)
        or not isinstance(action_artifacts, list)
        or not all(isinstance(item, str) for item in action_artifacts)
    ):
        raise RuntimeError("registered_child_result_types_invalid")
    if status_value == "blocked":
        if not exact_blocker:
            raise RuntimeError("registered_child_blocked_exact_blocker_missing")
        _job_manager_claim_registered_child_result(
            run_dir=run_dir,
            result=result,
            scheduler_run_id=scheduler_run_id,
            control_run_id=control_run_id,
        )
        raise RuntimeError(exact_blocker)
    resolved_actions = [
        _job_manager_path_within_run(item, run_dir, blocker="registered_child_action_artifact_missing_or_outside")
        for item in action_artifacts
    ]
    if len(resolved_actions) != action_count or len(set(resolved_actions)) != len(resolved_actions):
        raise RuntimeError("registered_child_external_action_count_mismatch")
    if exact_blocker:
        raise RuntimeError("registered_child_completed_exact_blocker_must_be_empty")
    audit_path = _job_manager_path_within_run(
        result.get("completion_audit_path"),
        run_dir,
        blocker="registered_child_completion_audit_missing_or_outside",
    )
    expected_audit_path = (run_dir / "completion-audit.json").resolve()
    if audit_path != expected_audit_path:
        raise RuntimeError("registered_child_completion_audit_path_mismatch")
    try:
        audit = json.loads(audit_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError("registered_child_completion_audit_malformed") from exc
    if (
        not isinstance(audit, dict)
        or audit.get("ok") is not True
        or audit.get("stage") != "job_manager_completion_audit"
        or Path(str(audit.get("run_dir") or "")).resolve() != run_dir.resolve()
    ):
        raise RuntimeError("registered_child_completion_audit_failed_or_mismatched")
    resolved_required = {
        _job_manager_path_within_run(item, run_dir, blocker="registered_child_required_artifact_missing_or_outside")
        for item in required_artifacts
    }
    mandatory = {
        (run_dir / "extension-first-preflight.json").resolve(),
        (run_dir / "live-preflight.json").resolve(),
        (run_dir / "launch-packet.json").resolve(),
        (run_dir / "job-manager-ideal-flow.json").resolve(),
        expected_audit_path,
    }
    if not mandatory.issubset(resolved_required):
        raise RuntimeError("registered_child_required_artifact_set_incomplete")
    _job_manager_claim_registered_child_result(
        run_dir=run_dir,
        result=result,
        scheduler_run_id=scheduler_run_id,
        control_run_id=control_run_id,
    )
    return result


def _job_manager_write_bridge_diagnostic(
    run_dir: Path,
    *,
    run_id: str,
    bridge_probe: dict[str, object],
    trusted_wrapper_receipt: dict[str, object] | None,
) -> Path:
    payload = {
        "schema": "job_manager_bridge_diagnostic.v1",
        "workflow": "job-applications",
        "run_id": run_id,
        "stage": "job_manager_bridge_diagnostic",
        "ok": bridge_probe.get("ok") is True and bridge_probe.get("ready") is True,
        "ready": bridge_probe.get("ready") is True,
        "bridge_instance_id": str(bridge_probe.get("bridge_instance_id") or ""),
        "bridge_receipt_path": str(bridge_probe.get("bridge_receipt_path") or ""),
        "trusted_wrapper_receipt_path": str((trusted_wrapper_receipt or {}).get("receipt_path") or ""),
        "owner_id": str((trusted_wrapper_receipt or {}).get("owner_id") or ""),
        "external_action_count": 0,
        "read_only": True,
        "exact_blocker": str(bridge_probe.get("exact_blocker") or ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    path = run_dir / "bridge-diagnostic.json"
    _job_manager_atomic_write_json(path, payload)
    return path


def _job_manager_validate_trusted_owner_heartbeat(
    receipt: dict[str, object],
    *,
    stale_seconds: float = 15.0,
) -> dict[str, object]:
    scheduler_run_dir = Path(str(receipt.get("scheduler_run_dir") or "")).resolve(strict=True)
    heartbeat_path = Path(str(receipt.get("owner_heartbeat_path") or "")).absolute()
    terminal_path = Path(str(receipt.get("owner_terminal_path") or "")).absolute()
    if heartbeat_path.parent != scheduler_run_dir or heartbeat_path.name != "trusted-wrapper-owner-heartbeat.json":
        raise RuntimeError("trusted_wrapper_owner_heartbeat_path_invalid")
    if terminal_path.parent != scheduler_run_dir or terminal_path.name != "trusted-wrapper-owner-terminal.json":
        raise RuntimeError("trusted_wrapper_owner_terminal_path_invalid")
    if terminal_path.exists():
        raise RuntimeError("trusted_wrapper_owner_terminal_while_child_running")
    try:
        metadata = heartbeat_path.lstat()
        payload = json.loads(heartbeat_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError("trusted_wrapper_owner_heartbeat_unreadable") from exc
    if (
        not stat.S_ISREG(metadata.st_mode)
        or heartbeat_path.is_symlink()
        or metadata.st_uid != os.getuid()
        or metadata.st_mode & 0o777 != 0o600
        or metadata.st_nlink != 1
        or not isinstance(payload, dict)
        or payload.get("schema") != "scheduler_control_trusted_wrapper_owner_heartbeat.v1"
        or payload.get("status") != "running"
        or str(payload.get("owner_id") or "") != str(receipt.get("owner_id") or "")
        or str(payload.get("bridge_instance_id") or "") != str(receipt.get("bridge_instance_id") or "")
    ):
        raise RuntimeError("trusted_wrapper_owner_heartbeat_binding_invalid")
    try:
        updated_at = datetime.fromisoformat(str(payload.get("updated_at") or ""))
    except ValueError as exc:
        raise RuntimeError("trusted_wrapper_owner_heartbeat_time_invalid") from exc
    age = (datetime.now(timezone.utc) - updated_at).total_seconds()
    if updated_at.tzinfo is None or age < -1 or age > stale_seconds:
        raise RuntimeError("trusted_wrapper_owner_heartbeat_stale")
    return payload


def _job_manager_communicate_with_owner_watchdog(
    proc: subprocess.Popen,
    *,
    receipt: dict[str, object],
    deadline: float,
    poll_seconds: float = 1.0,
    stale_seconds: float = 15.0,
    term_grace_seconds: float = 5.0,
) -> tuple[str, str]:
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise subprocess.TimeoutExpired(proc.args, 0)
        try:
            return proc.communicate(timeout=max(0.01, min(poll_seconds, remaining)))
        except subprocess.TimeoutExpired:
            try:
                _job_manager_validate_trusted_owner_heartbeat(receipt, stale_seconds=stale_seconds)
            except Exception as exc:
                exact_blocker = f"trusted_wrapper_owner_lost:{str(exc).splitlines()[0]}"
                termination_signal = "SIGTERM"
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    stdout, stderr = proc.communicate(timeout=max(0.01, term_grace_seconds))
                except subprocess.TimeoutExpired:
                    termination_signal = "SIGKILL"
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    stdout, stderr = proc.communicate()
                run_dir = Path(str(receipt["scheduler_run_dir"])).resolve()
                _job_manager_atomic_write_json(
                    run_dir / "trusted-owner-watchdog-cleanup.json",
                    {
                        "schema": "scheduler_control_trusted_owner_watchdog_cleanup.v1",
                        "status": "blocked",
                        "exact_blocker": exact_blocker,
                        "owner_id": str(receipt.get("owner_id") or ""),
                        "bridge_instance_id": str(receipt.get("bridge_instance_id") or ""),
                        "termination_signal": termination_signal,
                        "external_action_count": 0,
                        "owned_processes_remaining": [],
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                raise RuntimeError(exact_blocker) from exc


def _job_manager_claim_registered_child_result(
    *,
    run_dir: Path,
    result: dict[str, object],
    scheduler_run_id: str,
    control_run_id: str,
) -> Path:
    consume_path = run_dir / "registered-child-result-consumed.json"
    consume_payload = {
        "schema": "registered-child-result-consumption.v1",
        "result_id": result["result_id"],
        "scheduler_run_id": scheduler_run_id,
        "control_run_id": control_run_id,
        "consumed_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        descriptor = os.open(consume_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise RuntimeError("registered_child_result_already_consumed") from exc
    try:
        os.write(descriptor, (json.dumps(consume_payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return consume_path


def _job_manager_evaluate_child_transport(
    *,
    returncode: int,
    run_dir: Path,
    scheduler_run_id: str,
    control_run_id: str,
) -> dict[str, object]:
    if returncode != 0:
        raise RuntimeError(f"job_manager_child_returned_nonzero:{returncode}")
    return _job_manager_validate_registered_child_result(
        run_dir=run_dir,
        scheduler_run_id=scheduler_run_id,
        control_run_id=control_run_id,
    )


def _job_manager_write_terminal_state(
    *,
    run_dir: Path,
    run_id: str,
    control_run_id: str,
    status: str,
    exact_blocker: str,
    child_result: dict[str, object] | None = None,
) -> Path:
    if status not in {"completed", "blocked"}:
        raise RuntimeError(f"job_manager_terminal_status_invalid:{status}")
    if status == "completed" and exact_blocker:
        raise RuntimeError("job_manager_completed_terminal_blocker_must_be_empty")
    if status == "blocked" and not exact_blocker:
        raise RuntimeError("job_manager_blocked_terminal_exact_blocker_missing")
    payload: dict[str, object] = {
        "schema": "job_manager_terminal_state.v1",
        "run_id": run_id,
        "control_run_id": control_run_id,
        "status": status,
        "exact_blocker": exact_blocker,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    if child_result is not None:
        payload["registered_child_result"] = child_result
    return _job_manager_atomic_write_json(run_dir / "terminal-state.json", payload)


def _attach_current_bridge_probe_to_launch_packet(
    launch_packet: dict[str, object],
    bridge_probe: dict[str, object],
    *,
    expected_scheduler_run_id: str | None = None,
    expected_scheduler_run_dir: Path | None = None,
    expected_launch_dir: Path | None = None,
) -> dict[str, object]:
    allow_current_bridge_receipt_override = False
    if not (
        bridge_probe.get("ok") is True
        and bridge_probe.get("ready") is True
        and bridge_probe.get("stage") == "job_manager_bridge_readiness_probe"
    ):
        raise RuntimeError("bridge_readiness_probe_not_passed_before_registered_child")
    bridge_run_id = str(bridge_probe.get("bridge_run_id") or "").strip()
    receipt_path = str(bridge_probe.get("bridge_receipt_path") or "").strip()
    if not bridge_run_id or not receipt_path:
        raise RuntimeError("bridge_readiness_probe_receipt_missing_before_registered_child")
    try:
        receipt = json.loads(Path(receipt_path).read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(
            f"bridge_readiness_probe_receipt_unreadable_before_registered_child: receipt={receipt_path}: {exc}"
        ) from exc
    receipt_result = receipt.get("result") if isinstance(receipt, dict) else None
    if not isinstance(receipt_result, dict):
        raise RuntimeError("bridge_readiness_probe_receipt_invalid_before_registered_child")
    if os.environ.get("SOCIAL_FLOW_TRUSTED_BROWSER_WRAPPER_V2") == "1":
        validate_bridge_receipt_v2(receipt)
        validate_bridge_receipt_v2(receipt_result)
    exact_blocker = _job_manager_bridge_probe_exact_blocker(receipt_result)
    if exact_blocker:
        raise RuntimeError(exact_blocker)
    receipt_scheduler_run_id = str(receipt.get("scheduler_run_id") or "") if isinstance(receipt, dict) else ""
    receipt_scheduler_run_dir = str(receipt.get("scheduler_run_dir") or "") if isinstance(receipt, dict) else ""
    receipt_launch_dir = str(receipt.get("launch_dir") or "") if isinstance(receipt, dict) else ""
    receipt_codex_thread_id = str(receipt.get("codex_thread_id") or "") if isinstance(receipt, dict) else ""
    receipt_codex_turn_id = str(receipt.get("codex_turn_id") or "") if isinstance(receipt, dict) else ""
    receipt_codex_session_id = str(receipt.get("codex_session_id") or "") if isinstance(receipt, dict) else ""
    expected_codex_thread_id = str(os.environ.get("CODEX_THREAD_ID") or "").strip()
    expected_codex_turn_id = str(os.environ.get("CODEX_TURN_ID") or expected_codex_thread_id).strip() or expected_codex_thread_id
    expected_codex_session_id = str(os.environ.get("CODEX_SESSION_ID") or expected_codex_thread_id).strip() or expected_codex_thread_id
    expected_scheduler_run_dir_text = str(expected_scheduler_run_dir.resolve()) if expected_scheduler_run_dir is not None else ""
    expected_launch_dir_text = str(expected_launch_dir.resolve()) if expected_launch_dir is not None else ""
    if not (
        isinstance(receipt_result, dict)
        and receipt.get("ok") is True
        and receipt.get("status") == "succeeded"
        and receipt.get("mode") == "probe"
        and receipt_result.get("ok") is True
        and receipt_result.get("ready") is True
        and receipt_result.get("stage") == "job_manager_bridge_readiness_probe"
        and (
            allow_current_bridge_receipt_override
            or (
                str(receipt.get("run_id") or "") == bridge_run_id
                and Path(str(receipt.get("receipt_path") or "")).resolve() == Path(receipt_path).resolve()
                and (not expected_scheduler_run_id or receipt_scheduler_run_id == expected_scheduler_run_id)
                and (not expected_scheduler_run_dir_text or receipt_scheduler_run_dir == expected_scheduler_run_dir_text)
                and (not expected_launch_dir_text or receipt_launch_dir == expected_launch_dir_text)
                and (not expected_codex_thread_id or receipt_codex_thread_id == expected_codex_thread_id)
                and (not expected_codex_turn_id or receipt_codex_turn_id == expected_codex_turn_id)
                and (not expected_codex_session_id or receipt_codex_session_id == expected_codex_session_id)
                and str(receipt_result.get("bridge_run_id") or "") == bridge_run_id
                and Path(str(receipt_result.get("bridge_receipt_path") or "")).resolve() == Path(receipt_path).resolve()
                and (not expected_scheduler_run_id or str(receipt_result.get("scheduler_run_id") or "") == expected_scheduler_run_id)
                and (not expected_scheduler_run_dir_text or str(receipt_result.get("scheduler_run_dir") or "") == expected_scheduler_run_dir_text)
                and (not expected_launch_dir_text or str(receipt_result.get("launch_dir") or "") == expected_launch_dir_text)
                and (not expected_codex_thread_id or str(receipt_result.get("codex_thread_id") or "") == expected_codex_thread_id)
                and (not expected_codex_turn_id or str(receipt_result.get("codex_turn_id") or "") == expected_codex_turn_id)
                and (not expected_codex_session_id or str(receipt_result.get("codex_session_id") or "") == expected_codex_session_id)
            )
        )
    ):
        raise RuntimeError(
            f"bridge_readiness_probe_receipt_invalid_before_registered_child: receipt={receipt_path}"
        )
    current_probe = {
        "bridge_run_id": bridge_run_id,
        "bridge_receipt_path": receipt_path,
        "backend": receipt_result.get("backend"),
        "browser_metadata": receipt_result.get("browser_metadata"),
        "scheduler_run_id": receipt_result.get("scheduler_run_id") or receipt_scheduler_run_id,
        "scheduler_run_dir": receipt_result.get("scheduler_run_dir") or receipt_scheduler_run_dir,
        "launch_dir": receipt_result.get("launch_dir") or receipt_launch_dir,
        "codex_thread_id": receipt_result.get("codex_thread_id") or receipt_codex_thread_id,
        "codex_turn_id": receipt_result.get("codex_turn_id") or receipt_codex_turn_id,
        "codex_session_id": receipt_result.get("codex_session_id") or receipt_codex_session_id,
        "ok": True,
        "ready": True,
        "stage": "job_manager_bridge_readiness_probe",
    }
    if os.environ.get("SOCIAL_FLOW_TRUSTED_BROWSER_WRAPPER_V2") == "1":
        current_probe.update(bridge_binding_from_env())
        current_probe["control_schema"] = "scheduler_control_receipt.v2"
    proof_section = (
        "\n\nCurrent same-run bridge proof (machine-selected):\n"
        f"bridge_run_id={bridge_run_id}\n"
        f"bridge_receipt_path={receipt_path}\n"
        f"backend={current_probe['backend']}\n"
        f"browser_metadata={json.dumps(current_probe['browser_metadata'], ensure_ascii=False)}\n"
        f"scheduler_run_id={current_probe['scheduler_run_id']}\n"
        f"scheduler_run_dir={current_probe['scheduler_run_dir']}\n"
        f"launch_dir={current_probe['launch_dir']}\n"
        "ok=true\nready=true\nstage=job_manager_bridge_readiness_probe\n"
        "Use this receipt as current bridge truth. Older failed probe artifacts do not override it."
    )
    updated = dict(launch_packet)
    launch_message = f"{launch_packet.get('launch_message') or ''}{proof_section}"
    updated["launch_message"] = launch_message
    updated["launch_message_sha256"] = hashlib.sha256(launch_message.encode("utf-8")).hexdigest()
    updated["current_bridge_probe"] = current_probe
    return updated


def _job_manager_registered_contract(automation_toml_path: Path | None = None) -> dict[str, object]:
    toml_path = (automation_toml_path or JOB_MANAGER_AUTOMATION_TOML).resolve()
    automation = tomllib.loads(_read_text_file(toml_path))
    cwds = automation.get("cwds") or []
    expected_cwd = str(JOB_MANAGER_PROJECT_CWD)
    if not isinstance(cwds, list) or not cwds or str(cwds[0]) != expected_cwd:
        raise RuntimeError(
            "job_manager_registered_cwd_mismatch:"
            f"expected={expected_cwd}:actual={json.dumps(cwds, ensure_ascii=False)}"
        )
    con = sqlite3.connect("/Users/nichikatanaka/.codex/sqlite/codex-dev.db")
    try:
        db_row = con.execute(
            "select prompt, cwds, model, reasoning_effort, status from automations where id=?",
            ("job-application-manager",),
        ).fetchone()
    finally:
        con.close()
    if not db_row:
        raise RuntimeError("job_manager_registered_store_missing")
    db_prompt, db_cwds, db_model, db_reasoning_effort, db_status = db_row
    if (
        db_prompt != automation.get("prompt")
        or json.loads(db_cwds) != cwds
        or db_model != automation.get("model")
        or db_reasoning_effort != automation.get("reasoning_effort")
        or db_status != automation.get("status")
    ):
        raise RuntimeError(
            "registered_store_matches_automation_toml_failed:"
            + json.dumps(
                {
                    "prompt": db_prompt == automation.get("prompt"),
                    "cwds": json.loads(db_cwds) == cwds,
                    "model": db_model == automation.get("model"),
                    "reasoning_effort": db_reasoning_effort == automation.get("reasoning_effort"),
                    "status": db_status == automation.get("status"),
                },
                ensure_ascii=False,
            )
        )
    return {
        "automation_toml_path": str(toml_path),
        "automation": automation,
        "db_row": {
            "prompt": db_prompt,
            "cwds": json.loads(db_cwds),
            "model": db_model,
            "reasoning_effort": db_reasoning_effort,
            "status": db_status,
        },
    }


def _job_manager_registered_model(automation_toml_path: Path | None = None) -> str:
    contract = _job_manager_registered_contract(automation_toml_path)
    return str(contract["automation"].get("model") or "").strip()


def _job_manager_registered_reasoning_effort(automation_toml_path: Path | None = None) -> str:
    contract = _job_manager_registered_contract(automation_toml_path)
    return str(contract["automation"].get("reasoning_effort") or "").strip()


def _job_manager_registered_cwd(automation_toml_path: Path | None = None) -> Path:
    contract = _job_manager_registered_contract(automation_toml_path)
    cwds = contract["automation"].get("cwds") or []
    return Path(str(cwds[0])).expanduser()


def _job_manager_run_id() -> str:
    now = datetime.now(timezone(timedelta(hours=9)))
    return f"{now.strftime('%Y%m%d-%H%M%S-%f')}-{uuid.uuid4().hex[:8]}"


def _job_manager_run_dir(run_id: str) -> Path:
    return JOB_MANAGER_RUN_SUMMARIES_ROOT / f"codex-app-job-application-manager-{run_id}"


def _job_manager_allocate_run_dir() -> tuple[str, Path]:
    JOB_MANAGER_RUN_SUMMARIES_ROOT.mkdir(parents=True, exist_ok=True)
    for _ in range(64):
        run_id = _job_manager_run_id()
        run_dir = _job_manager_run_dir(run_id)
        try:
            run_dir.mkdir(parents=False, exist_ok=False)
        except FileExistsError:
            continue
        return run_id, run_dir
    raise RuntimeError("job_manager_run_dir_collision_unresolved")


def _job_manager_atomic_write_json(path: Path, payload: dict[str, object]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)
    return path


def _job_manager_lease_path() -> Path:
    return JOB_MANAGER_CURRENT_LEASE


def _job_manager_pointer_path() -> Path:
    return JOB_MANAGER_CURRENT_POINTER


def _job_manager_lease_lock_path() -> Path:
    return JOB_MANAGER_RUN_SUMMARIES_ROOT / "job-manager-current" / "lease-mutation.lock"


def _job_manager_acquire_lease_lock(*, action: str, run_id: str, owner_token: str) -> Path:
    lock_path = _job_manager_lease_lock_path()
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        lock_path.mkdir(parents=False, exist_ok=False)
    except FileExistsError as exc:
        blocker = {
            "action": action,
            "run_id": run_id,
            "owner_token": owner_token,
            "lock_path": str(lock_path),
        }
        raise RuntimeError("job_manager_lease_lock_active:" + json.dumps(blocker, ensure_ascii=False)) from exc
    _job_manager_atomic_write_json(
        lock_path / "owner.json",
        {
            "action": action,
            "run_id": run_id,
            "owner_token": owner_token,
            "pid": os.getpid(),
            "acquired_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return lock_path


def _job_manager_release_lease_lock(lock_path: Path) -> None:
    shutil.rmtree(lock_path, ignore_errors=True)


def _job_manager_current_record_matches(
    payload: dict[str, object] | None,
    *,
    run_id: str,
    run_dir: Path,
    owner_token: str,
) -> bool:
    if not isinstance(payload, dict):
        return False
    return (
        str(payload.get("run_id") or "") == run_id
        and str(payload.get("run_dir") or "") == str(run_dir)
        and str(payload.get("owner_token") or "") == owner_token
        and int(payload.get("pid") or 0) == os.getpid()
    )


def _job_manager_write_current_pointer(
    *,
    run_id: str,
    run_dir: Path,
    owner_token: str,
    mode: str,
    status: str,
    exact_blocker: str = "",
    cleanup_proof: str = "",
) -> Path:
    pointer_path = _job_manager_pointer_path()
    payload = {
        "workflow": "job-applications",
        "automation_id": "job-application-manager",
        "run_id": run_id,
        "run_dir": str(run_dir),
        "owner_token": owner_token,
        "pid": os.getpid(),
        "lease_path": str(_job_manager_lease_path()),
        "mode": mode,
        "status": status,
        "exact_blocker": exact_blocker,
        "cleanup_proof": cleanup_proof,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _job_manager_atomic_write_json(pointer_path, payload)
    written = json.loads(pointer_path.read_text(encoding="utf-8"))
    if not _job_manager_current_record_matches(written, run_id=run_id, run_dir=run_dir, owner_token=owner_token):
        raise RuntimeError("current_run_pointer_cas_write_failed")
    return pointer_path


def _job_manager_can_write_home(codex_home: Path) -> bool:
    codex_home.mkdir(parents=True, exist_ok=True)
    probe = codex_home / f".job-manager-write-probe-{os.getpid()}"
    try:
        probe.write_text("ok\n", encoding="utf-8")
        probe.unlink()
    except OSError:
        return False
    return True


def _job_manager_auth_mode(codex_home: Path) -> str:
    auth_path = codex_home.expanduser() / "auth.json"
    default_auth_path = Path.home() / ".codex" / "auth.json"
    try:
        auth_data = json.loads(auth_path.read_text(encoding="utf-8"))
    except Exception as exc:
        if auth_path != default_auth_path and default_auth_path.exists():
            try:
                auth_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(default_auth_path, auth_path)
                auth_data = json.loads(auth_path.read_text(encoding="utf-8"))
            except Exception as copy_exc:
                raise RuntimeError(
                    f"job_manager_auth_mode_unavailable:{auth_path}:{exc}; "
                    f"fallback_auth_copy_failed={default_auth_path}:{copy_exc}"
                ) from copy_exc
        else:
            raise RuntimeError(f"job_manager_auth_mode_unavailable:{auth_path}:{exc}") from exc
    if not isinstance(auth_data, dict):
        raise RuntimeError(f"job_manager_auth_mode_invalid:{auth_path}")
    auth_mode = str(auth_data.get("auth_mode") or "").strip().lower()
    if not auth_mode:
        raise RuntimeError(f"job_manager_auth_mode_missing:{auth_path}")
    return auth_mode


def _job_manager_lease_conflict_blocker(lease_payload: dict[str, object]) -> str:
    owner_pid = str(lease_payload.get("pid") or "").strip()
    owner_run_id = str(lease_payload.get("run_id") or "").strip()
    owner_expires_at = str(lease_payload.get("expires_at") or "").strip()
    return (
        "active_run_lease_conflict:"
        f"run_id={owner_run_id or 'unknown'}:"
        f"pid={owner_pid or 'unknown'}:"
        f"expires_at={owner_expires_at or 'unknown'}"
    )


def _job_manager_load_active_lease() -> dict[str, object] | None:
    lease_path = _job_manager_lease_path()
    if not lease_path.exists():
        return None
    try:
        payload = json.loads(lease_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _job_manager_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _job_manager_acquire_lease(run_id: str, run_dir: Path, *, mode: str, deadline_seconds: int) -> dict[str, object]:
    lease_path = _job_manager_lease_path()
    owner_token = uuid.uuid4().hex
    lock_path = _job_manager_acquire_lease_lock(action="acquire", run_id=run_id, owner_token=owner_token)
    lease_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        active = _job_manager_load_active_lease()
        now = datetime.now(timezone.utc)
        if active:
            try:
                expires_at = datetime.fromisoformat(str(active.get("expires_at") or ""))
            except ValueError:
                expires_at = now
            active_pid = int(active.get("pid") or 0)
            if expires_at > now and active_pid and _job_manager_pid_alive(active_pid):
                raise RuntimeError(_job_manager_lease_conflict_blocker(active))
        started_at = now.isoformat()
        expires_at = (now + timedelta(seconds=deadline_seconds)).isoformat()
        lease = {
            "workflow": "job-applications",
            "automation_id": "job-application-manager",
            "mode": mode,
            "pid": os.getpid(),
            "owner_token": owner_token,
            "run_id": run_id,
            "run_dir": str(run_dir),
            "started_at": started_at,
            "expires_at": expires_at,
            "heartbeat_at": started_at,
            "status": "active",
        }
        _job_manager_atomic_write_json(lease_path, lease)
        written_lease = _job_manager_load_active_lease()
        if not _job_manager_current_record_matches(written_lease, run_id=run_id, run_dir=run_dir, owner_token=owner_token):
            raise RuntimeError("active_run_lease_cas_write_failed")
        _job_manager_write_current_pointer(
            run_id=run_id,
            run_dir=run_dir,
            owner_token=owner_token,
            mode=mode,
            status="active",
        )
        return lease
    finally:
        _job_manager_release_lease_lock(lock_path)


def _job_manager_release_lease(
    run_id: str,
    run_dir: Path,
    *,
    owner_token: str,
    status: str,
    exact_blocker: str = "",
    cleanup_proof: str = "",
) -> Path:
    lease_path = _job_manager_lease_path()
    lock_path = _job_manager_acquire_lease_lock(action="release", run_id=run_id, owner_token=owner_token)
    try:
        active = _job_manager_load_active_lease()
        if not _job_manager_current_record_matches(active, run_id=run_id, run_dir=run_dir, owner_token=owner_token):
            raise RuntimeError(
                "active_run_lease_owner_mismatch_before_release:"
                + json.dumps(
                    {
                        "run_id": run_id,
                        "run_dir": str(run_dir),
                        "expected_owner_token": owner_token,
                        "active": active or {},
                    },
                    ensure_ascii=False,
                )
            )
        payload = {
            "workflow": "job-applications",
            "automation_id": "job-application-manager",
            "run_id": run_id,
            "run_dir": str(run_dir),
            "owner_token": owner_token,
            "pid": os.getpid(),
            "status": status,
            "exact_blocker": exact_blocker,
            "cleanup_proof": cleanup_proof,
            "released_at": datetime.now(timezone.utc).isoformat(),
            "owned_processes_remaining": [],
        }
        _job_manager_atomic_write_json(lease_path, payload)
        written_lease = _job_manager_load_active_lease()
        if not _job_manager_current_record_matches(written_lease, run_id=run_id, run_dir=run_dir, owner_token=owner_token):
            raise RuntimeError("active_run_lease_cas_release_failed")
        _job_manager_write_current_pointer(
            run_id=run_id,
            run_dir=run_dir,
            owner_token=owner_token,
            mode=status,
            status=status,
            exact_blocker=exact_blocker,
            cleanup_proof=cleanup_proof,
        )
    finally:
        _job_manager_release_lease_lock(lock_path)
    return lease_path


def _job_manager_write_run_start_artifact(run_dir: Path, *, run_id: str, mode: str) -> Path:
    start_path = run_dir / "run-start.json"
    _job_manager_atomic_write_json(
        start_path,
        {
            "workflow": "job-applications",
            "automation_id": "job-application-manager",
            "run_id": run_id,
            "mode": mode,
            "pid": os.getpid(),
            "started_at": datetime.now(timezone.utc).isoformat(),
            "run_dir": str(run_dir),
        },
    )
    return start_path


def _job_manager_write_heartbeat(
    run_dir: Path,
    *,
    run_id: str,
    owner_token: str,
    mode: str,
    exact_blocker: str = "",
) -> Path:
    heartbeat_path = run_dir / "heartbeat.json"
    lock_path = _job_manager_acquire_lease_lock(action="heartbeat", run_id=run_id, owner_token=owner_token)
    try:
        active = _job_manager_load_active_lease()
        if not _job_manager_current_record_matches(active, run_id=run_id, run_dir=run_dir, owner_token=owner_token):
            raise RuntimeError(
                "active_run_lease_owner_mismatch_before_heartbeat:"
                + json.dumps(
                    {
                        "run_id": run_id,
                        "run_dir": str(run_dir),
                        "expected_owner_token": owner_token,
                        "active": active or {},
                    },
                    ensure_ascii=False,
                )
            )
        _job_manager_atomic_write_json(
            heartbeat_path,
            {
                "workflow": "job-applications",
                "automation_id": "job-application-manager",
                "run_id": run_id,
                "owner_token": owner_token,
                "mode": mode,
                "pid": os.getpid(),
                "heartbeat_at": datetime.now(timezone.utc).isoformat(),
                "exact_blocker": exact_blocker,
            },
        )
    finally:
        _job_manager_release_lease_lock(lock_path)
    return heartbeat_path


def _job_manager_write_ideal_flow_manifest(
    run_dir: Path,
    *,
    run_id: str,
    launch_dir: Path,
    launch_model: str,
    launch_reasoning_effort: str,
    bridge_probe: dict[str, object],
    auth_mode: str,
) -> Path:
    manifest_path = run_dir / "job-manager-ideal-flow.json"
    current_paths = {
        "readiness_audit": str(JOB_MANAGER_RUN_SUMMARIES_ROOT / "job-manager-current" / "job-manager-extension-readiness-audit-current.json"),
        "readiness_audit_validation": str(JOB_MANAGER_RUN_SUMMARIES_ROOT / "job-manager-current" / "job-manager-extension-readiness-audit-current-validation.json"),
        "current_overseas_packet_manifest": str(JOB_MANAGER_RUN_SUMMARIES_ROOT / "job-manager-current" / "current-overseas-packet-manifest.json"),
        "current_overseas_packet_manifest_validation": str(JOB_MANAGER_RUN_SUMMARIES_ROOT / "job-manager-current" / "current-overseas-packet-manifest-validation.json"),
        "next_overseas_resume_packet_validation": str(JOB_MANAGER_RUN_SUMMARIES_ROOT / "job-manager-current" / "next-overseas-extension-resume-packet-current-validation-after-playwright-primary-route-fix.json"),
        "final_user_action_manifest": str(JOB_MANAGER_RUN_SUMMARIES_ROOT / "job-manager-current" / "final-user-action-manifest.json"),
    }
    payload = {
        "workflow": "job-applications",
        "stage": "job_manager_ideal_flow_manifest",
        "run_id": run_id,
        "run_dir": str(run_dir),
        "launch_dir": str(launch_dir),
        "launch_model": launch_model,
        "launch_reasoning_effort": launch_reasoning_effort,
        "auth_mode": auth_mode,
        "bridge_probe": bridge_probe,
        "current_gap_summary": {
            "why_current_flow_fails": [
                "candidate_supply_refresh is not yet guaranteed before submit",
                "source-of-truth readback is not yet guaranteed before submit",
                "current packet validation is not yet guaranteed before submit",
                "fresh_submitted_count_by_bucket is not guaranteed to be written before completion audit",
            ],
            "must_not_rely_on": [
                "inherited prior-run counts",
                "discovery-only candidate supply without a refreshed buffer artifact",
                "completion audit without same-run fresh bucket counts",
            ],
        },
        "ideal_order": [
            "source-of-truth readback",
            "candidate-supply refresh",
            "current overseas packet manifest validation",
            "next overseas resume packet validation",
            "Gmail full sweep / follow-up sweep",
            "one-candidate-at-a-time submit loop",
            "same-run fresh_submitted_count_by_bucket rollup",
            "completion audit",
            "cleanup proof",
        ],
        "required_pre_submit_gates": [
            "candidate_supply_buffer_refresh artifact exists for the active bucket",
            "source_of_truth_readback artifact exists",
            "current_overseas_packet_manifest validation exists",
            "next_overseas_extension_resume_packet validation exists",
        ],
        "required_for_full_success": [
            "fresh_submitted_count_by_bucket Japan-targeted>=20",
            "fresh_submitted_count_by_bucket overseas/global>=20",
            "Gmail full sweep proof or exact blocker",
            "completion audit pass",
            "cleanup proof",
        ],
        "current_authority_paths": current_paths,
    }
    _job_manager_atomic_write_json(manifest_path, payload)
    return manifest_path


def _job_manager_validate_live_preflight(
    *,
    run_dir: Path,
    run_id: str,
    owner_token: str,
    codex_home: Path,
    launch_dir: Path,
    launch_model: str,
    launch_reasoning_effort: str,
    bridge_probe: dict[str, object],
    auth_mode: str,
) -> dict[str, object]:
    registered_cwd = _job_manager_registered_cwd(JOB_MANAGER_AUTOMATION_TOML).resolve()
    if Path(launch_dir).resolve() != registered_cwd or registered_cwd != JOB_MANAGER_PROJECT_CWD.resolve():
        raise RuntimeError(
            "live_preflight_registered_cwd_mismatch:"
            f"launch_dir={Path(launch_dir).resolve()}:registered_cwd={registered_cwd}:expected={JOB_MANAGER_PROJECT_CWD.resolve()}"
        )
    lease_path = _job_manager_lease_path()
    if not lease_path.exists():
        raise RuntimeError("active_run_lease_missing_before_live_preflight")
    try:
        lease = json.loads(lease_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"active_run_lease_unreadable_before_live_preflight:{exc}") from exc
    if not isinstance(lease, dict):
        raise RuntimeError("active_run_lease_invalid_before_live_preflight")
    if (
        str(lease.get("run_id") or "") != run_id
        or str(lease.get("run_dir") or "") != str(run_dir)
        or str(lease.get("owner_token") or "") != owner_token
    ):
        raise RuntimeError("active_run_lease_run_mismatch_before_live_preflight")
    if int(lease.get("pid") or 0) != os.getpid():
        raise RuntimeError("active_run_lease_not_owned_before_live_preflight")
    pointer_path = _job_manager_pointer_path()
    if not pointer_path.exists():
        raise RuntimeError("current_run_pointer_missing_before_live_preflight")
    try:
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"current_run_pointer_unreadable_before_live_preflight:{exc}") from exc
    if not isinstance(pointer, dict):
        raise RuntimeError("current_run_pointer_invalid_before_live_preflight")
    if (
        str(pointer.get("run_id") or "") != run_id
        or str(pointer.get("run_dir") or "") != str(run_dir)
        or str(pointer.get("owner_token") or "") != owner_token
    ):
        raise RuntimeError("current_run_pointer_run_mismatch_before_live_preflight")
    preflight_artifact = run_dir / "extension-first-preflight.json"
    if not preflight_artifact.exists():
        raise RuntimeError("live_preflight_missing_extension_first_preflight_artifact")
    preflight = json.loads(preflight_artifact.read_text(encoding="utf-8"))
    run_start_path = run_dir / "run-start.json"
    if not run_start_path.exists():
        raise RuntimeError("run_start_artifact_missing_before_live_preflight")
    try:
        run_start = json.loads(run_start_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"run_start_artifact_unreadable_before_live_preflight:{exc}") from exc
    started_at = str(run_start.get("started_at") or "")
    try:
        started_dt = datetime.fromisoformat(started_at)
    except ValueError as exc:
        raise RuntimeError(f"run_start_artifact_invalid_timestamp_before_live_preflight:{started_at}") from exc
    if datetime.now(timezone.utc) - started_dt > timedelta(seconds=120):
        raise RuntimeError("run_start_artifact_too_old_before_live_preflight")
    return {
        "workflow": "job-applications",
        "stage": "job_manager_live_preflight",
        "ok": True,
        "run_id": run_id,
        "run_dir": str(run_dir),
        "codex_home": str(codex_home),
        "launch_dir": str(launch_dir),
        "launch_model": launch_model,
        "launch_reasoning_effort": launch_reasoning_effort,
        "auth_mode": auth_mode,
        "bridge_probe": bridge_probe,
        "registered_parity": preflight,
    }


def _codex_exec_env(*, codex_home: Path | None = None) -> dict[str, str]:
    env = os.environ.copy()
    # ChatGPT/Codex auth must come from CODEX_HOME; a stale API key in the
    # parent shell can force codex exec down the wrong auth path.
    env.pop("OPENAI_API_KEY", None)
    if codex_home is not None:
        env["CODEX_HOME"] = str(codex_home.expanduser())
    return env


def _codex_exec_auth_env(*, codex_home: Path | None = None) -> dict[str, str]:
    env = _codex_exec_env(codex_home=codex_home)
    auth_home = Path(env.get("CODEX_HOME") or Path.home() / ".codex").expanduser()
    auth_path = auth_home / "auth.json"
    default_auth_path = Path.home() / ".codex" / "auth.json"
    try:
        auth_data = json.loads(auth_path.read_text(encoding="utf-8"))
    except Exception as exc:
        if auth_path != default_auth_path and default_auth_path.exists():
            try:
                auth_home.mkdir(parents=True, exist_ok=True)
                shutil.copy2(default_auth_path, auth_path)
                auth_data = json.loads(auth_path.read_text(encoding="utf-8"))
            except Exception as copy_exc:
                raise RuntimeError(
                    f"codex_exec_auth_missing_before_workflow_start: auth_file_unreadable={auth_path}: {exc}; "
                    f"fallback_auth_copy_failed={default_auth_path}:{copy_exc}"
                ) from copy_exc
        else:
            raise RuntimeError(f"codex_exec_auth_missing_before_workflow_start: auth_file_unreadable={auth_path}: {exc}") from exc
    if not isinstance(auth_data, dict):
        raise RuntimeError(f"codex_exec_auth_missing_before_workflow_start: auth_file_invalid={auth_path}")
    tokens = auth_data.get("tokens")
    legacy_api_key = str(auth_data.get("OPENAI_API_KEY") or "").strip()
    if legacy_api_key:
        env["OPENAI_API_KEY"] = legacy_api_key
        return env
    if isinstance(tokens, dict):
        access_token = str(tokens.get("access_token") or "").strip()
        if access_token:
            env["OPENAI_API_KEY"] = access_token
            return env
    auth_mode = str(auth_data.get("auth_mode") or "").strip().lower()
    raise RuntimeError(
        "codex_exec_auth_missing_before_workflow_start: "
        f"auth_mode={auth_mode or 'unknown'} auth_file={auth_path}"
    )


def _codex_exec_registered_child_env(
    *,
    codex_home: Path | None,
    automation_id: str,
    reasoning_effort: str | None = None,
    current_bridge_probe: dict[str, object] | None = None,
    registered_child_result_path: Path | None = None,
    control_state_pointer: Path | None = None,
    scheduler_run_id: str = "",
    control_run_id: str = "",
) -> dict[str, str]:
    env = _codex_exec_auth_env(codex_home=codex_home)
    env["SOCIAL_FLOW_REGISTERED_AUTOMATION_CHILD"] = "1"
    env["SOCIAL_FLOW_REGISTERED_AUTOMATION_ID"] = automation_id
    node_options = str(env.get("NODE_OPTIONS") or "").strip()
    require_flag = f"--require={JOB_MANAGER_TURN_METADATA_SHIM}"
    if require_flag not in node_options:
        env["NODE_OPTIONS"] = f"{node_options} {require_flag}".strip()
    if reasoning_effort:
        env["SOCIAL_FLOW_REGISTERED_REASONING_EFFORT"] = reasoning_effort
    if registered_child_result_path is not None:
        env["SOCIAL_FLOW_REGISTERED_CHILD_RESULT_PATH"] = str(registered_child_result_path)
        env["SOCIAL_FLOW_REGISTERED_CHILD_RESULT_SCHEMA"] = REGISTERED_CHILD_RESULT_SCHEMA
        env["SOCIAL_FLOW_CONTROL_STATE_POINTER"] = str(control_state_pointer or "")
        env["SOCIAL_FLOW_CONTROL_SCHEDULER_RUN_ID"] = scheduler_run_id
        env["SOCIAL_FLOW_CONTROL_RUN_ID"] = control_run_id
    if current_bridge_probe:
        env["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_RUN_ID"] = str(current_bridge_probe.get("bridge_run_id") or "")
        env["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_RECEIPT"] = str(current_bridge_probe.get("bridge_receipt_path") or "")
        env["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_STAGE"] = str(current_bridge_probe.get("stage") or "")
        env["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_READY"] = "1" if current_bridge_probe.get("ready") is True else "0"
        env["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_SCHEDULER_RUN_ID"] = str(current_bridge_probe.get("scheduler_run_id") or "")
        env["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_SCHEDULER_RUN_DIR"] = str(current_bridge_probe.get("scheduler_run_dir") or "")
        env["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_LAUNCH_DIR"] = str(current_bridge_probe.get("launch_dir") or "")
        env["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_THREAD_ID"] = str(current_bridge_probe.get("codex_thread_id") or "")
        env["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_TURN_ID"] = str(current_bridge_probe.get("codex_turn_id") or "")
        env["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_SESSION_ID"] = str(current_bridge_probe.get("codex_session_id") or "")
        if not env.get("CODEX_THREAD_ID") and current_bridge_probe.get("codex_thread_id"):
            env["CODEX_THREAD_ID"] = str(current_bridge_probe.get("codex_thread_id") or "")
        if not env.get("CODEX_SESSION_ID") and current_bridge_probe.get("codex_session_id"):
            env["CODEX_SESSION_ID"] = str(current_bridge_probe.get("codex_session_id") or "")
        if not env.get("CODEX_TURN_ID") and current_bridge_probe.get("codex_turn_id"):
            env["CODEX_TURN_ID"] = str(current_bridge_probe.get("codex_turn_id") or "")
    return env


def _codex_exec_session_healthcheck(*, codex_home: Path | None = None, launch_dir: Path, launch_model: str | None = None) -> None:
    env = _codex_exec_auth_env(codex_home=codex_home)
    cmd = [
        "codex",
        "exec",
        "--ignore-user-config",
        "--ephemeral",
        "--sandbox",
        JOB_MANAGER_CODEX_EXEC_SANDBOX,
        "--config",
        "shell_environment_policy.inherit=all",
        "--config",
        'model_reasoning_effort="high"',
        "--skip-git-repo-check",
        "--cd",
        str(launch_dir),
    ]
    if launch_model:
        cmd.extend(["--model", launch_model])
    cmd.append("Authentication healthcheck only. Reply READY and do nothing else.")
    try:
        result = subprocess.run(cmd, check=False, text=True, capture_output=True, env=env, timeout=120, cwd=str(launch_dir))
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            "codex_exec_auth_probe_timeout_before_workflow_start: "
            f"timeout_seconds=120 launch_dir={launch_dir}"
        ) from exc

    if result.returncode == 0:
        return

    combined = "\n".join(part for part in [result.stdout, result.stderr] if part).strip()
    lowered = combined.lower()
    if "usage limit" in lowered or "purchase more credits" in lowered:
        retry_match = re.search(r"try again at\s+([^\r\n.]+)", combined, flags=re.IGNORECASE)
        retry_after = re.sub(r"\s+", "_", retry_match.group(1).strip()) if retry_match else "reported_reset_time"
        raise RuntimeError(f"codex_exec_usage_limit_before_workflow_start:retry_after={retry_after}")
    if "token_invalidated" in lowered or "refresh_token_invalidated" in lowered:
        raise RuntimeError("codex_exec_auth_token_invalidated_before_workflow_start")
    if "auth_missing_before_workflow_start" in lowered or "auth_file" in lowered:
        raise RuntimeError("codex_exec_auth_missing_before_workflow_start")
    raise RuntimeError(
        "codex_exec_auth_probe_failed_before_workflow_start: "
        f"returncode={result.returncode} output={combined or 'empty'}"
    )


def _assert_job_manager_bridge_probe_contract(launch_packet: dict[str, object]) -> None:
    launch_message = str(launch_packet.get("launch_message") or "")
    required_markers = (
        "scheduler_control_request.v2",
        "runRegisteredAutomationWithTrustedBridge",
        "Chrome Extension/Profile 2",
    )
    missing = [marker for marker in required_markers if marker not in launch_message]
    if missing:
        raise RuntimeError("scheduler_control_v2_missing_from_registered_prompt:" + ",".join(missing))


def _job_manager_current_codex_turn_metadata() -> dict[str, str]:
    explicit_thread_id = str(os.environ.get("CODEX_THREAD_ID") or "").strip()
    explicit_session_id = str(
        os.environ.get("SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_SESSION_ID")
        or os.environ.get("CODEX_SESSION_ID")
        or explicit_thread_id
        or ""
    ).strip()
    explicit_turn_id = str(
        os.environ.get("SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_TURN_ID")
        or os.environ.get("CODEX_TURN_ID")
        or explicit_session_id
        or ""
    ).strip() or explicit_session_id
    if explicit_session_id and explicit_turn_id:
        return {
            "session_id": explicit_session_id,
            "thread_id": explicit_thread_id or explicit_session_id,
            "turn_id": explicit_turn_id,
        }
    codex_home = Path.home() / ".codex"
    session_index_path = codex_home / "session_index.jsonl"
    current_cwd = str(JOB_MANAGER_PROJECT_CWD.resolve())
    session_metadata = _job_manager_current_codex_turn_metadata_from_session_logs(
        codex_home=codex_home,
        session_index_path=session_index_path,
        current_cwd=current_cwd,
    )
    if session_metadata:
        return session_metadata
    try:
        session_rows = [json.loads(line) for line in session_index_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    except Exception:
        session_rows = []
    matching_sessions = [
        row
        for row in session_rows
        if isinstance(row, dict) and str(row.get("thread_name") or "").strip() == "求人応募管理" and str(row.get("id") or "").strip()
    ]
    if matching_sessions:
        matching_sessions.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
        session_id = str(matching_sessions[0].get("id") or "").strip()
        if session_id:
            rollout_root = codex_home / "sessions"
            rollout_candidates = sorted(
                rollout_root.rglob(f"*{session_id}.jsonl"),
                key=lambda path: path.stat().st_mtime,
                reverse=True,
            )
            for rollout_path in rollout_candidates:
                try:
                    lines = rollout_path.read_text(encoding="utf-8").splitlines()
                except Exception:
                    continue
                for raw_line in reversed(lines):
                    if not raw_line.strip():
                        continue
                    try:
                        row = json.loads(raw_line)
                    except Exception:
                        continue
                    payload = row.get("payload") if isinstance(row, dict) else None
                    passthrough = None
                    if isinstance(payload, dict):
                        passthrough = payload.get("internal_chat_message_metadata_passthrough")
                    if isinstance(passthrough, dict):
                        turn_id = str(passthrough.get("turn_id") or "").strip()
                        if turn_id:
                            return {
                                "session_id": session_id,
                                "thread_id": session_id,
                                "turn_id": turn_id,
                            }
            return {
                "session_id": session_id,
                "thread_id": session_id,
                "turn_id": session_id,
            }
    session_id = str(os.environ.get("CODEX_SESSION_ID") or os.environ.get("CODEX_THREAD_ID") or "").strip()
    turn_id = str(os.environ.get("CODEX_TURN_ID") or session_id).strip() or session_id
    if session_id and turn_id:
        return {
            "session_id": session_id,
            "thread_id": session_id,
        "turn_id": turn_id,
    }
    return {}


def _job_manager_current_codex_turn_metadata_from_session_logs(
    *,
    codex_home: Path,
    session_index_path: Path,
    current_cwd: str,
) -> dict[str, str]:
    """
    Recover the active Codex turn from the current workspace cwd when explicit
    turn metadata is missing.

    This intentionally ignores thread names so new automations and non-manager
    threads can still resolve the same workspace session.
    """

    try:
        session_rows = [json.loads(line) for line in session_index_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    except Exception:
        return {}

    session_rows = [
        row
        for row in session_rows
        if isinstance(row, dict) and str(row.get("id") or "").strip()
    ]
    session_rows.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    rollout_root = codex_home / "sessions"
    for row in session_rows:
        session_id = str(row.get("id") or "").strip()
        if not session_id:
            continue
        rollout_candidates = sorted(
            rollout_root.rglob(f"*{session_id}.jsonl"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        for rollout_path in rollout_candidates:
            try:
                lines = rollout_path.read_text(encoding="utf-8").splitlines()
            except Exception:
                continue
            session_matches_current_cwd = False
            latest_turn_id = ""
            for raw_line in lines:
                if not raw_line.strip():
                    continue
                try:
                    event = json.loads(raw_line)
                except Exception:
                    continue
                if (
                    isinstance(event, dict)
                    and event.get("type") == "session_meta"
                    and isinstance(event.get("payload"), dict)
                    and str(event["payload"].get("cwd") or "").strip() == current_cwd
                ):
                    session_matches_current_cwd = True
                if (
                    isinstance(event, dict)
                    and event.get("type") == "response_item"
                    and isinstance(event.get("payload"), dict)
                ):
                    passthrough = event["payload"].get("internal_chat_message_metadata_passthrough")
                    if isinstance(passthrough, dict):
                        turn_id = str(passthrough.get("turn_id") or "").strip()
                        if turn_id:
                            latest_turn_id = turn_id
            if session_matches_current_cwd:
                return {
                    "session_id": session_id,
                    "thread_id": session_id,
                    "turn_id": latest_turn_id or session_id,
                }
    return {}


def _job_manager_bridge_probe_is_auto_startable(error: str) -> bool:
    lowered = str(error or "").lower()
    return "bridge_endpoint_not_listening" in lowered


def _wait_for_job_manager_bridge_health(*, host: str = "127.0.0.1", port: int = 58737, token: str = "", timeout_seconds: int = 180) -> dict[str, object]:
    health_url = f"http://{host}:{port}/health"
    deadline = time.monotonic() + max(5, timeout_seconds)
    headers = {"x-social-flow-bridge-token": token} if token else {}
    last_error = ""
    while time.monotonic() < deadline:
        try:
            request = Request(health_url, headers=headers)
            with urlopen(request, timeout=5) as response:
                text = response.read().decode("utf-8")
            payload = json.loads(text or "{}")
            if isinstance(payload, dict) and payload.get("ok") is True and payload.get("backend") == "chrome_extension_trusted_bridge":
                return payload
            last_error = f"invalid_health_payload:{(text or '')[:240]}"
        except Exception as exc:
            last_error = " ".join(str(exc).split())[:240]
        if time.monotonic() < deadline:
            time.sleep(1)
    raise RuntimeError(
        "trusted_runner_bridge_daemon_failed_to_start: "
        f"health_unavailable_after_{timeout_seconds}s last_error={last_error or 'empty'}"
    )


def _start_job_manager_bridge_daemon(
    *,
    codex_home: Path | None = None,
    launch_dir: Path | None = None,
    artifact_dir: Path | None = None,
    timeout_seconds: int = 180,
    codex_turn_metadata: dict[str, str] | None = None,
) -> dict[str, object]:
    env = os.environ.copy()
    if codex_home is not None:
        env["CODEX_HOME"] = str(codex_home.expanduser())
    codex_turn_metadata = codex_turn_metadata or _job_manager_current_codex_turn_metadata()
    if codex_turn_metadata:
        env["CODEX_SESSION_ID"] = codex_turn_metadata["session_id"]
        env["CODEX_THREAD_ID"] = codex_turn_metadata["thread_id"]
        env["CODEX_TURN_ID"] = codex_turn_metadata["turn_id"]
    node_options = str(env.get("NODE_OPTIONS") or "").strip()
    require_flag = f"--require={JOB_MANAGER_TURN_METADATA_SHIM}"
    if require_flag not in node_options:
        env["NODE_OPTIONS"] = f"{node_options} {require_flag}".strip()
    bridge_launch_dir = launch_dir or JOB_MANAGER_PROJECT_CWD
    bridge_artifact_dir = artifact_dir or (JOB_MANAGER_PROJECT_CWD / "artifacts" / "job-manager-bridge-readiness-probe")
    bridge_artifact_dir.mkdir(parents=True, exist_ok=True)
    log_path = bridge_artifact_dir / "bridge-daemon.log"
    log_handle = log_path.open("a", encoding="utf-8")
    cmd = [
        "node",
        str(JOB_MANAGER_BRIDGE_SERVER),
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        "58737",
        "--timeout-seconds",
        str(max(30, timeout_seconds)),
    ]
    proc: subprocess.Popen[str] | None = None

    def terminate_bridge_process_group() -> None:
        if proc is None or proc.poll() is not None:
            return
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            pass
        except Exception:
            pass
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except Exception:
            pass

    try:
        proc = subprocess.Popen(
            cmd,
            text=True,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            env=env,
            cwd=str(bridge_launch_dir),
            start_new_session=True,
        )
    finally:
        log_handle.close()
    time.sleep(0.5)
    if proc is None:
        raise RuntimeError(f"trusted_runner_bridge_daemon_failed_to_start: spawn_failed; log={log_path}")
    if proc.poll() not in (None, 0):
        raise RuntimeError(f"trusted_runner_bridge_daemon_failed_to_start: returncode={proc.returncode}; log={log_path}")
    try:
        _wait_for_job_manager_bridge_health(
            host="127.0.0.1",
            port=58737,
            timeout_seconds=timeout_seconds,
        )
    except Exception:
        terminate_bridge_process_group()
        raise
    return {
        "ok": True,
        "bridge_daemon_pid": proc.pid,
        "bridge_daemon_cmd": cmd,
        "bridge_daemon_log": str(log_path),
        "bridge_daemon_health_url": "http://127.0.0.1:58737/health",
    }


def _run_job_manager_bridge_probe(
    *,
    codex_home: Path | None = None,
    artifact_dir: Path | None = None,
    run_id: str | None = None,
    launch_dir: Path | None = None,
    scheduler_run_id: str | None = None,
    scheduler_run_dir: Path | None = None,
    timeout_seconds: int = 180,
    codex_turn_metadata: dict[str, str] | None = None,
) -> dict[str, object]:
    codex_turn_metadata = codex_turn_metadata or _job_manager_current_codex_turn_metadata()
    codex_thread_id = str(codex_turn_metadata.get("thread_id") or "").strip()
    codex_session_id = str(codex_turn_metadata.get("session_id") or codex_thread_id).strip() or codex_thread_id
    codex_turn_id = str(codex_turn_metadata.get("turn_id") or codex_session_id or codex_thread_id).strip() or codex_session_id or codex_thread_id
    payload = {
        "runId": run_id or f"bridge-warmup-{int(time.time())}",
        "artifactDir": str(artifact_dir or Path.cwd() / "artifacts" / "job-manager-bridge-readiness-probe"),
        "schedulerRunId": scheduler_run_id or "",
        "schedulerRunDir": str(scheduler_run_dir.resolve()) if scheduler_run_dir is not None else "",
        "launchDir": str(launch_dir.resolve()) if launch_dir is not None else "",
        **(
            {
                "session_id": codex_session_id,
                "thread_id": codex_thread_id,
                "turn_id": codex_turn_id,
                "codexThreadId": codex_thread_id,
                "codexTurnId": codex_turn_id,
                "codexSessionId": codex_session_id,
            }
            if codex_session_id and codex_turn_id
            else {}
        ),
    }
    control_binding = bridge_binding_from_env()
    if os.environ.get("SOCIAL_FLOW_TRUSTED_BROWSER_WRAPPER_V2") == "1":
        payload.update(
            {
                "controlSchema": "scheduler_control_receipt.v2",
                "automationId": control_binding["automation_id"],
                "controlRunId": control_binding["control_run_id"],
                "originThreadId": control_binding["origin_thread_id"],
                "originSessionId": control_binding["origin_session_id"],
                "originTurnId": control_binding["origin_turn_id"],
                "executionThreadId": control_binding["execution_thread_id"],
                "executionTurnId": control_binding["execution_turn_id"],
                "runNonce": control_binding["run_nonce"],
                "registeredPromptSha256": control_binding["registered_prompt_sha256"],
                "launchMessageSha256": control_binding["launch_message_sha256"],
                "registeredCwd": control_binding["registered_cwd"],
                "controlStage": control_binding["control_stage"],
                "bridgeInstanceId": control_binding["bridge_instance_id"],
                "controlIssuedAt": control_binding["issued_at"],
                "controlExpiresAt": control_binding["expires_at"],
            }
        )
    env = os.environ.copy()
    if codex_home is not None:
        env["CODEX_HOME"] = str(codex_home.expanduser())
    if codex_thread_id:
        env["CODEX_THREAD_ID"] = codex_thread_id
    if codex_session_id:
        env["CODEX_SESSION_ID"] = codex_session_id
    if codex_turn_id:
        env["CODEX_TURN_ID"] = codex_turn_id
    node_options = str(env.get("NODE_OPTIONS") or "").strip()
    require_flag = f"--require={JOB_MANAGER_TURN_METADATA_SHIM}"
    if require_flag not in node_options:
        env["NODE_OPTIONS"] = f"{node_options} {require_flag}".strip()
    env["SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TIMEOUT_MS"] = str(max(30, timeout_seconds) * 1000)
    result = subprocess.run(
        [
            "node",
            str(JOB_MANAGER_BRIDGE_CLIENT),
            "probe",
        ],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
        env=env,
        cwd=str(launch_dir or Path.cwd()),
    )
    if result.stdout:
        typer.echo(result.stdout)
    if result.stderr:
        typer.echo(result.stderr, err=True)
    if result.returncode != 0:
        combined = "\n".join(part for part in [result.stdout, result.stderr] if part).strip()
        raise RuntimeError(
            "trusted_runner_bridge_unavailable_before_probe_artifact: "
            f"returncode={result.returncode} output={combined or 'empty'}"
        )
    try:
        payload = json.loads(result.stdout.strip() or "{}")
    except json.JSONDecodeError:
        raise RuntimeError(
            "trusted_runner_bridge_unavailable_before_probe_artifact: "
            f"probe_stdout_json_decode_failed output={result.stdout.strip()[:500] or 'empty'}"
        )
    if not isinstance(payload, dict):
        raise RuntimeError(
            "trusted_runner_bridge_unavailable_before_probe_artifact: "
            f"probe_stdout_not_object type={type(payload).__name__}"
        )
    exact_blocker = _job_manager_bridge_probe_exact_blocker(payload)
    if exact_blocker:
        raise RuntimeError(exact_blocker)
    return payload


def _job_manager_bridge_probe_exact_blocker(payload: dict[str, object]) -> str:
    if not isinstance(payload, dict):
        return "trusted_runner_bridge_unavailable_before_probe_artifact: probe_stdout_not_object"
    if payload.get("ok") is not True or payload.get("ready") is not True or payload.get("stage") != "job_manager_bridge_readiness_probe":
        return (
            "trusted_runner_bridge_unavailable_before_probe_artifact: "
            "probe_contract_invalid: expected ok=true ready=true stage=job_manager_bridge_readiness_probe"
        )
    backend = str(payload.get("backend") or "").strip()
    if backend != "chrome_extension_trusted_bridge":
        return (
            "trusted_runner_bridge_unavailable_before_probe_artifact: "
            f"probe_backend_invalid: backend={backend or 'missing'} expected=chrome_extension_trusted_bridge"
        )
    browser_metadata = payload.get("browser_metadata")
    if not isinstance(browser_metadata, dict):
        return (
            "trusted_runner_bridge_unavailable_before_probe_artifact: "
            "probe_profile_invalid: browser_metadata_missing"
        )
    profile_ordering = str(browser_metadata.get("profileOrdering") or "").strip()
    profile_name = str(browser_metadata.get("profileName") or "").strip()
    profile_name_normalized = profile_name.lower()
    trusted_profile_names = {"nicky", "nicky/profile 2"}
    if profile_ordering != "2" or profile_name_normalized not in trusted_profile_names:
        return (
            "trusted_runner_bridge_unavailable_before_probe_artifact: "
            "probe_profile_invalid: inconsistent_profile_identity "
            f"profileOrdering={profile_ordering or 'missing'} profileName={profile_name or 'missing'} expected=Nicky"
        )
    return ""


def _job_manager_reusable_bridge_probe_from_artifacts(
    *,
    codex_turn_metadata: dict[str, str] | None,
    launch_dir: Path | None,
) -> dict[str, object]:
    expected_session_id = str((codex_turn_metadata or {}).get("session_id") or "").strip()
    expected_thread_id = str((codex_turn_metadata or {}).get("thread_id") or "").strip()
    expected_turn_id = str((codex_turn_metadata or {}).get("turn_id") or "").strip()
    if not expected_session_id and not expected_thread_id and not expected_turn_id:
        return {}

    expected_launch_dir = str((launch_dir or JOB_MANAGER_PROJECT_CWD).resolve())
    candidate_artifact_names = ("live-preflight.json", "launch-packet.json", "job-manager-ideal-flow.json")
    candidate_paths: list[Path] = []
    for artifact_name in candidate_artifact_names:
        try:
            candidate_paths.extend(JOB_MANAGER_RUN_SUMMARIES_ROOT.rglob(artifact_name))
        except Exception:
            continue
    candidate_paths = sorted(
        {path.resolve() for path in candidate_paths if path.is_file()},
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )

    for artifact_path in candidate_paths:
        try:
            artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(artifact, dict):
            continue
        probe = artifact.get("current_bridge_probe")
        if not isinstance(probe, dict):
            probe = artifact.get("bridge_probe") if isinstance(artifact.get("bridge_probe"), dict) else None
        if not isinstance(probe, dict):
            continue
        if _job_manager_bridge_probe_exact_blocker(probe):
            continue

        probe_launch_dir = str(probe.get("launch_dir") or artifact.get("launch_dir") or "").strip()
        if probe_launch_dir and str(Path(probe_launch_dir).resolve()) != expected_launch_dir:
            continue

        probe_session_id = str(probe.get("codex_session_id") or "").strip()
        probe_thread_id = str(probe.get("codex_thread_id") or "").strip()
        probe_turn_id = str(probe.get("codex_turn_id") or "").strip()
        if expected_session_id and probe_session_id and probe_session_id != expected_session_id:
            continue
        if expected_thread_id and probe_thread_id and probe_thread_id != expected_thread_id:
            continue
        if expected_turn_id and probe_turn_id and probe_turn_id != expected_turn_id:
            continue

        receipt_path = str(probe.get("bridge_receipt_path") or "").strip()
        if not receipt_path:
            continue
        receipt_file = Path(receipt_path)
        if not receipt_file.exists():
            continue
        try:
            receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(receipt, dict):
            continue
        receipt_result = receipt.get("result") if isinstance(receipt.get("result"), dict) else None
        if not isinstance(receipt_result, dict):
            continue
        if _job_manager_bridge_probe_exact_blocker(receipt_result):
            continue
        if (
            receipt.get("ok") is not True
            or receipt.get("status") != "succeeded"
            or receipt.get("mode") != "probe"
            or receipt_result.get("ok") is not True
            or receipt_result.get("ready") is not True
            or receipt_result.get("stage") != "job_manager_bridge_readiness_probe"
        ):
            continue

        reusable_probe = dict(receipt_result)
        reusable_probe.setdefault("bridge_run_id", str(probe.get("bridge_run_id") or receipt.get("run_id") or "").strip())
        reusable_probe.setdefault("bridge_receipt_path", receipt_path)
        reusable_probe.setdefault("scheduler_run_id", str(probe.get("scheduler_run_id") or receipt.get("scheduler_run_id") or "").strip())
        reusable_probe.setdefault("scheduler_run_dir", str(probe.get("scheduler_run_dir") or receipt.get("scheduler_run_dir") or "").strip())
        reusable_probe.setdefault("launch_dir", probe_launch_dir or str(receipt.get("launch_dir") or "").strip())
        reusable_probe.setdefault("codex_thread_id", probe_thread_id or str(receipt.get("codex_thread_id") or "").strip())
        reusable_probe.setdefault("codex_turn_id", probe_turn_id or str(receipt.get("codex_turn_id") or "").strip())
        reusable_probe.setdefault("codex_session_id", probe_session_id or str(receipt.get("codex_session_id") or "").strip())
        return reusable_probe

    return {}


def _expected_main_chrome_profile_path(settings: Settings) -> str:
    return str(
        Path(settings.chrome_main_user_data_dir).expanduser()
        / settings.chrome_main_profile_directory
    )


def _observed_chrome_profile_path(version_text: str) -> str:
    profile_path_labels = ("Profile Path", "プロフィール パス")
    for line in version_text.splitlines():
        for label in profile_path_labels:
            if label in line:
                return line.split(label, 1)[-1].strip()
    return ""


def _normalized_profile_path(path: str) -> str:
    return os.path.normcase(os.path.normpath(Path(path).expanduser()))


def _verify_main_chrome_profile_path(page, settings: Settings, *, timeout_seconds: float = 8.0) -> None:
    expected_profile_path = _expected_main_chrome_profile_path(settings)
    page.goto("chrome://version/", wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
    version_text = page.locator("body").inner_text(timeout=int(timeout_seconds * 1000))
    observed_profile_path = _observed_chrome_profile_path(version_text)
    if _normalized_profile_path(observed_profile_path) != _normalized_profile_path(expected_profile_path):
        raise RuntimeError(
            "local_automation_profile_unavailable: profile_path_mismatch "
            f"expected={expected_profile_path} observed={observed_profile_path}"
        )


def _default_google_chrome_user_data_dir() -> Path:
    return Path.home() / "Library" / "Application Support" / "Google" / "Chrome"


def _is_default_google_chrome_user_data_dir(user_data_dir: str) -> bool:
    return _normalized_profile_path(user_data_dir) == _normalized_profile_path(str(_default_google_chrome_user_data_dir()))


def _chrome_default_user_data_dir_block_payload(settings: Settings, port: int) -> dict[str, object]:
    return {
        "ok": False,
        "stop_reason": "local_automation_profile_unavailable",
        "legacy_stop_reason": "local_profile2_lane_unavailable",
        "profile_label": settings.chrome_main_profile_label,
        "profile_directory": settings.chrome_main_profile_directory,
        "user_data_dir": settings.chrome_main_user_data_dir,
        "remote_debugging_port": port,
        "reason": "chrome_default_user_data_dir_blocked",
        "next_action": (
            "Use a non-default automation profile, for example "
            "`CHROME_MAIN_USER_DATA_DIR=$HOME/.social-flow-nicky-automation-chrome` and "
            "`CHROME_MAIN_PROFILE_DIRECTORY=Default`, then sign in to X, LinkedIn, and Google there once."
        ),
    }


def _run_mode_config(run_mode: str) -> dict[str, str]:
    normalized = run_mode.strip() or "daily_normal"
    if normalized not in RUN_MODE_CONFIGS:
        allowed = ", ".join(sorted(RUN_MODE_CONFIGS))
        raise typer.BadParameter(f"Unknown run_mode '{run_mode}'. Use one of: {allowed}.")
    return RUN_MODE_CONFIGS[normalized]


def _recommended_chrome_task_groups(settings: Settings) -> list[str]:
    prefix = settings.chrome_task_group_prefix.strip() or "social-flow"
    return [
        f"{prefix}: job applications",
        f"{prefix}: job proof cleanup",
        f"{prefix}: inbox",
        f"{prefix}: drive intake",
        f"{prefix}: draft review",
        f"{prefix}: publish tiktok",
        f"{prefix}: publish instagram",
        f"{prefix}: publish youtube",
        f"{prefix}: publish facebook",
        f"{prefix}: performance",
    ]


def _applescript_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _google_sheets_url(spreadsheet_id: str) -> str:
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"


def _group_header_tab_url(group_name: str, description: str) -> str:
    html = f"""
    <html>
      <head>
        <meta charset="utf-8">
        <title>{group_name}</title>
        <style>
          body {{
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #0b1220, #1f3b5b);
            color: #f8fafc;
            display: grid;
            place-items: center;
            min-height: 100vh;
          }}
          main {{
            max-width: 720px;
            padding: 32px;
          }}
          h1 {{ margin: 0 0 12px; font-size: 32px; }}
          p {{ margin: 0; font-size: 18px; line-height: 1.6; color: #dbeafe; }}
        </style>
      </head>
      <body>
        <main>
          <h1>{group_name}</h1>
          <p>{description}</p>
        </main>
      </body>
    </html>
    """.strip()
    return "data:text/html;charset=utf-8," + quote(html)


def _video_workspace_tab_specs(settings: Settings) -> list[tuple[str, str]]:
    spreadsheet_url = _google_sheets_url(settings.spreadsheet_id)
    drive_url = settings.google_drive_folder_url.strip() or "https://drive.google.com/drive/my-drive"
    groups: list[tuple[str, list[tuple[str, str]]]] = [
        (
            f"{settings.chrome_task_group_prefix}: inbox",
            [
                ("Inbox board", spreadsheet_url),
            ],
        ),
        (
            f"{settings.chrome_task_group_prefix}: drive intake",
            [
                ("Shared Drive folder", drive_url),
            ],
        ),
        (
            f"{settings.chrome_task_group_prefix}: draft review",
            [
                ("Draft queue", spreadsheet_url),
                ("Gemini prompt output review", spreadsheet_url),
            ],
        ),
        (
            f"{settings.chrome_task_group_prefix}: publish tiktok",
            [
                ("TikTok upload", "https://www.tiktok.com/upload"),
            ],
        ),
        (
            f"{settings.chrome_task_group_prefix}: publish instagram",
            [
                ("Instagram", "https://www.instagram.com/"),
            ],
        ),
        (
            f"{settings.chrome_task_group_prefix}: publish youtube",
            [
                ("YouTube Studio", "https://studio.youtube.com/"),
            ],
        ),
        (
            f"{settings.chrome_task_group_prefix}: publish facebook",
            [
                ("Facebook Reels", "https://www.facebook.com/reels/create"),
            ],
        ),
        (
            f"{settings.chrome_task_group_prefix}: performance",
            [
                ("Performance sheet", spreadsheet_url),
                ("TikTok analytics", "https://www.tiktok.com/tiktokstudio/analytics"),
                ("Instagram insights", "https://www.instagram.com/"),
                ("YouTube analytics", "https://studio.youtube.com/"),
                ("Facebook insights", "https://www.facebook.com/"),
            ],
        ),
    ]

    specs: list[tuple[str, str]] = []
    for group_name, tabs in groups:
        specs.append(
            (
                group_name,
                _group_header_tab_url(
                    group_name,
                    "Use the tabs to the right of this header as one logical task block in Nicky automation.",
                ),
            )
        )
        specs.extend(tabs)
    return specs


def _job_workspace_tab_specs(settings: Settings) -> list[tuple[str, str]]:
    spreadsheet_url = _google_sheets_url(JOB_APPLICATIONS_SPREADSHEET_ID)
    prefix = settings.chrome_task_group_prefix.strip() or "social-flow"
    groups: list[tuple[str, list[tuple[str, str]]]] = [
        (
            f"{prefix}: job applications",
            [
                ("Job source of truth", spreadsheet_url),
            ],
        ),
        (
            f"{prefix}: job proof cleanup",
            [
                ("Job source of truth", spreadsheet_url),
            ],
        ),
    ]
    specs: list[tuple[str, str]] = []
    for group_name, tabs in groups:
        specs.append(
            (
                group_name,
                _group_header_tab_url(
                    group_name,
                    "Use the tabs to the right of this header for job application automation in Chrome Extension/Profile 2.",
                ),
            )
        )
        specs.extend(tabs)
    return specs


def _build_open_workspace_tabs_applescript(urls: list[str]) -> str:
    quoted_urls = ", ".join(_applescript_string(url) for url in urls)
    return f"""
tell application "Google Chrome"
  if (count of windows) = 0 then
    make new window
  end if
  set targetWindow to front window
  set urlList to {{{quoted_urls}}}
  repeat with currentUrl in urlList
    tell targetWindow
      make new tab with properties {{URL:(contents of currentUrl)}}
    end tell
  end repeat
  set index of targetWindow to 1
  activate
end tell
"""


def _open_profile2_chrome_tabs(chrome_executable_path: str, urls: list[str]) -> list[str]:
    user_data_dir = _default_google_chrome_user_data_dir()
    cmd = [
        chrome_executable_path,
        f"--user-data-dir={user_data_dir}",
        "--profile-directory=Profile 2",
        *urls,
    ]
    subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return cmd


def _run_osascript(script: str) -> str:
    completed = subprocess.run(
        ["osascript", "-"],
        input=script,
        text=True,
        capture_output=True,
        check=True,
        timeout=30,
    )
    return completed.stdout.strip()


def _run_front_chrome_javascript(script: str) -> dict[str, object]:
    sanitized = script.replace("\r", " ").replace("\n", " ")
    wrapped = f'''
tell application "Google Chrome"
  if (count of windows) = 0 then
    return "{{\\"ok\\":false,\\"reason\\":\\"chrome_window_not_found\\"}}"
  end if
  tell active tab of front window
    execute javascript {_applescript_string(sanitized)}
  end tell
end tell
'''
    output = _run_osascript(wrapped)
    if not output:
        return {}
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        return {"raw": output}
    return parsed if isinstance(parsed, dict) else {"value": parsed}


def _activate_chrome_tab_containing_url(url_fragment: str) -> bool:
    if not url_fragment.strip():
        return False
    wrapped = f'''
tell application "Google Chrome"
  if (count of windows) = 0 then
    return "false"
  end if
  repeat with windowIndex from 1 to count of windows
    tell window windowIndex
      repeat with tabIndex from 1 to count of tabs
        set currentTab to tab tabIndex
        if (URL of currentTab) contains {_applescript_string(url_fragment)} then
          set active tab index to tabIndex
          set index of window windowIndex to 1
          activate
          return "true"
        end if
      end repeat
    end tell
  end repeat
  return "false"
end tell
'''
    try:
        return _run_osascript(wrapped).strip().lower() == "true"
    except subprocess.CalledProcessError:
        return False


def _collect_drive_documents_from_front_chrome_tab(source_name: str = "Google Drive") -> list[SourceDocument]:
    script = r"""
JSON.stringify((() => {
  const videoPattern = /\.(mp4|mov|m4v|webm|avi)$/i;
  const fileIdPattern = /(?:\/file\/d\/|[?&]id=)([a-zA-Z0-9_-]+)/;
  const items = [];
  const seen = new Set();
  const normalizeName = (value) => (value || "").replace(/\s+/g, " ").trim();
  const inferFileId = (value) => {
    const match = String(value || "").match(fileIdPattern);
    return match ? match[1] : "";
  };
  const pushItem = (name, url, fileId) => {
    const normalizedName = normalizeName(name);
    if (!videoPattern.test(normalizedName)) {
      return;
    }
    const normalizedUrl = String(url || "").trim();
    const normalizedFileId = String(fileId || "").trim() || inferFileId(normalizedUrl);
    const key = `${normalizedName}||${normalizedFileId}||${normalizedUrl}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push({ name: normalizedName, url: normalizedUrl, fileId: normalizedFileId });
  };

  Array.from(document.querySelectorAll("a[href]")).forEach((anchor) => {
    const label = normalizeName(anchor.textContent) || normalizeName(anchor.getAttribute("title")) || normalizeName(anchor.getAttribute("aria-label"));
    pushItem(label, anchor.href, inferFileId(anchor.href));
  });

  Array.from(document.querySelectorAll("[aria-label],[title],[data-id]")).forEach((element) => {
    const label = normalizeName(element.getAttribute("aria-label")) || normalizeName(element.getAttribute("title")) || normalizeName(element.textContent);
    if (!videoPattern.test(label)) {
      return;
    }
    const anchor = element.closest("a[href]");
    const html = element.outerHTML || "";
    const fileId = String(element.getAttribute("data-id") || "").trim() || inferFileId(html);
    pushItem(label, anchor ? anchor.href : "", fileId);
  });

  return {
    ok: true,
    title: document.title,
    href: location.href,
    items,
  };
})())
"""
    result = _run_front_chrome_javascript(script)
    if not result.get("ok"):
        return []
    items = result.get("items")
    if not isinstance(items, list):
        return []

    documents: list[SourceDocument] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("name", "")).strip()
        if not title.lower().endswith(VIDEO_EXTENSIONS):
            continue
        file_id = str(item.get("fileId", "")).strip()
        url = str(item.get("url", "")).strip()
        if not url and file_id:
            url = f"https://drive.google.com/file/d/{file_id}/view"
        if not url:
            continue
        documents.append(
            SourceDocument(
                title=title,
                url=url,
                summary_en=f"Video discovered in Google Drive tab `{source_name}`.",
                source_name=source_name,
                source_type="google_drive",
            )
        )
    return documents


def _collect_drive_documents_from_chrome_tab(folder_url: str, source_name: str = "Google Drive") -> list[SourceDocument]:
    folder_id = extract_google_drive_folder_id(folder_url)
    target_fragments = [folder_url.split("?", 1)[0], folder_id]
    activated = any(_activate_chrome_tab_containing_url(fragment) for fragment in target_fragments if fragment)
    if not activated:
        return []
    return _collect_drive_documents_from_front_chrome_tab(source_name=source_name)


def _is_enabled_flag(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _pending_video_platforms(row: QueueRow) -> list[str]:
    pending: list[str] = []
    if _is_enabled_flag(row.tiktok_enabled) and not (row.tiktok_post_id or row.tiktok_post_url):
        pending.append("tiktok")
    if _is_enabled_flag(row.instagram_enabled) and not (row.instagram_post_id or row.instagram_post_url):
        pending.append("instagram")
    if _is_enabled_flag(row.youtube_shorts_enabled) and not (row.youtube_video_id or row.youtube_video_url):
        pending.append("youtube")
    if _is_enabled_flag(row.facebook_reels_enabled) and not (row.facebook_post_id or row.facebook_post_url):
        pending.append("facebook")
    return pending


def _video_publish_tab_plan(row: QueueRow) -> list[tuple[str, str]]:
    plan = [
        ("Drive video", row.drive_web_url or row.source_url),
    ]
    for platform in _pending_video_platforms(row):
        if platform == "tiktok":
            plan.append(("TikTok upload", "https://www.tiktok.com/upload"))
        elif platform == "instagram":
            plan.append(("Instagram", "https://www.instagram.com/"))
        elif platform == "youtube":
            plan.append(("YouTube Studio", "https://studio.youtube.com/"))
        elif platform == "facebook":
            plan.append(("Facebook Reels", "https://www.facebook.com/reels/create"))
    return [(label, url) for label, url in plan if url.strip()]


def _video_publish_brief(row: QueueRow) -> str:
    sections = [
        f"ID: {row.id}",
        f"Video: {row.drive_file_name or row.title}",
        f"Best platform: {row.best_platform or '(not set)'}",
        f"Best hook: {row.best_hook or '(not set)'}",
    ]
    if "tiktok" in _pending_video_platforms(row):
        sections.append(f"TikTok caption: {row.tiktok_caption or '(empty)'}")
        sections.append(f"TikTok hashtags: {row.tiktok_hashtags or '(empty)'}")
    if "instagram" in _pending_video_platforms(row):
        sections.append(f"Instagram caption: {row.instagram_caption or '(empty)'}")
        sections.append(f"Instagram hashtags: {row.instagram_hashtags or '(empty)'}")
    if "youtube" in _pending_video_platforms(row):
        sections.append(f"YouTube title: {row.youtube_title or '(empty)'}")
        sections.append(f"YouTube description: {row.youtube_description or '(empty)'}")
        sections.append(f"YouTube hashtags: {row.youtube_hashtags or '(empty)'}")
    if "facebook" in _pending_video_platforms(row):
        sections.append(f"Facebook caption: {row.facebook_caption or '(empty)'}")
        sections.append(f"Facebook hashtags: {row.facebook_hashtags or '(empty)'}")
    return "\n".join(sections)


def _build_contenteditable_html(text: str) -> str:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[str] = []
    for line in lines:
        if line:
            blocks.append(f"<p>{line}</p>")
        else:
            blocks.append("<p><br></p>")
    return "".join(blocks) or "<p><br></p>"


def _build_platform_prefill_javascript(platform: str, row: QueueRow) -> str:
    payload: dict[str, str]
    if platform == "tiktok":
        payload = {
            "caption": row.tiktok_caption,
            "hashtags": row.tiktok_hashtags,
        }
    elif platform == "instagram":
        payload = {
            "caption": row.instagram_caption,
            "hashtags": row.instagram_hashtags,
        }
    elif platform == "youtube":
        payload = {
            "title": row.youtube_title,
            "description": row.youtube_description,
            "hashtags": row.youtube_hashtags,
        }
    elif platform == "facebook":
        payload = {
            "caption": row.facebook_caption,
            "hashtags": row.facebook_hashtags,
        }
    else:
        raise ValueError(f"Unsupported platform: {platform}")

    return f"""
(() => {{
  const platform = {json.dumps(platform)};
  const payload = {json.dumps(payload)};
  const makeText = (...parts) => parts.filter(Boolean).join("\\n\\n").trim();
  const bodyText = platform === "youtube"
    ? makeText(payload.description || "", payload.hashtags || "")
    : makeText(payload.caption || "", payload.hashtags || "");
  const titleText = payload.title || "";

  const visible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );

  const firstVisible = (selectors) => {{
    for (const selector of selectors) {{
      const nodes = Array.from(document.querySelectorAll(selector));
      const found = nodes.find((node) => visible(node));
      if (found) return found;
    }}
    return null;
  }};

  const setField = (node, text) => {{
    if (!node) return false;
    if ('value' in node) {{
      node.focus();
      node.value = text;
      node.dispatchEvent(new Event('input', {{ bubbles: true }}));
      node.dispatchEvent(new Event('change', {{ bubbles: true }}));
      return true;
    }}
    if (node.isContentEditable) {{
      node.focus();
      node.innerHTML = {json.dumps(_build_contenteditable_html("{{TEXT}}"))}.replace('{{TEXT}}', '');
      node.innerHTML = text
        .split('\\n')
        .map((line) => line ? `<p>${{line.replace(/[&<>]/g, (m) => ({{'&':'&amp;','<':'&lt;','>':'&gt;'}}[m]))}}</p>` : '<p><br></p>')
        .join('');
      node.dispatchEvent(new InputEvent('input', {{ bubbles: true, composed: true, inputType: 'insertText', data: text }}));
      node.dispatchEvent(new Event('change', {{ bubbles: true }}));
      return true;
    }}
    return false;
  }};

  const titleSelectors = [
    'input[aria-label*="Title"]',
    'input[placeholder*="Title"]',
    'textarea[aria-label*="Title"]',
    'ytcp-social-suggestions-textbox#title-textarea textarea',
    '#title-textarea textarea',
  ];
  const bodySelectors = [
    'textarea[aria-label*="caption"]',
    'textarea[aria-label*="Caption"]',
    'textarea[placeholder*="caption"]',
    'textarea[placeholder*="Write"]',
    'textarea[placeholder*="説明"]',
    'textarea[aria-label*="description"]',
    'textarea[aria-label*="Description"]',
    'textarea[placeholder*="description"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'ytcp-social-suggestions-textbox#description-textarea textarea',
    '#description-textarea textarea',
  ];

  let titleFilled = false;
  let bodyFilled = false;
  if (platform === 'youtube' && titleText) {{
    titleFilled = setField(firstVisible(titleSelectors), titleText);
  }}
  bodyFilled = setField(firstVisible(bodySelectors), bodyText);

  return JSON.stringify({{
    ok: titleFilled || bodyFilled,
    platform,
    titleFilled,
    bodyFilled,
    currentUrl: window.location.href || '',
  }});
}})();
"""


def _video_platform_url_field(platform: str) -> str:
    mapping = {
        "tiktok": "tiktok_post_url",
        "instagram": "instagram_post_url",
        "youtube": "youtube_video_url",
        "facebook": "facebook_post_url",
    }
    return mapping[platform]


def _video_platform_id_field(platform: str) -> str:
    mapping = {
        "tiktok": "tiktok_post_id",
        "instagram": "instagram_post_id",
        "youtube": "youtube_video_id",
        "facebook": "facebook_post_id",
    }
    return mapping[platform]


def _video_platform_published_at_field(platform: str) -> str:
    mapping = {
        "tiktok": "tiktok_published_at",
        "instagram": "instagram_published_at",
        "youtube": "youtube_published_at",
        "facebook": "facebook_published_at",
    }
    return mapping[platform]


def _video_platform_status_field(platform: str) -> str:
    mapping = {
        "tiktok": "tiktok_post_status",
        "instagram": "instagram_post_status",
        "youtube": "youtube_post_status",
        "facebook": "facebook_post_status",
    }
    return mapping[platform]


def _render_video_publish_packet(row: QueueRow) -> str:
    lines = [
        f"# Publish Packet: {row.id}",
        "",
        f"- video: {row.drive_file_name or row.title}",
        f"- drive_url: {row.drive_web_url or row.source_url}",
        f"- best_platform: {row.best_platform or '(not set)'}",
        f"- best_hook: {row.best_hook or '(not set)'}",
        f"- media_plan: {row.media_plan or '(not set)'}",
        "",
        "## TikTok",
        f"- caption: {row.tiktok_caption or '(empty)'}",
        f"- hashtags: {row.tiktok_hashtags or '(empty)'}",
        "",
        "## Instagram Reels",
        f"- caption: {row.instagram_caption or '(empty)'}",
        f"- hashtags: {row.instagram_hashtags or '(empty)'}",
        "",
        "## YouTube Shorts",
        f"- title: {row.youtube_title or '(empty)'}",
        f"- description: {row.youtube_description or '(empty)'}",
        f"- hashtags: {row.youtube_hashtags or '(empty)'}",
        "",
        "## Facebook Reels",
        f"- caption: {row.facebook_caption or '(empty)'}",
        f"- hashtags: {row.facebook_hashtags or '(empty)'}",
        "",
    ]
    return "\n".join(lines)


def _refresh_video_publish_status(row: QueueRow) -> None:
    pending = _pending_video_platforms(row)
    published_platforms = [
        platform
        for platform in ("tiktok", "instagram", "youtube", "facebook")
        if getattr(row, _video_platform_url_field(platform), "") or getattr(row, _video_platform_id_field(platform), "")
    ]
    if pending and published_platforms:
        row.status = "partially_published"
    elif pending:
        row.status = row.status or "approved"
    elif published_platforms:
        row.status = "published"
        if not row.published_at:
            row.published_at = utc_now()


def _chrome_plugin_check_script() -> Path:
    return (
        Path.home()
        / ".codex"
        / "plugins"
        / "cache"
        / "openai-bundled"
        / "chrome"
        / CHROME_BUNDLED_VERSION
        / "scripts"
        / "check-extension-installed.js"
    )


def _read_local_state_profile_summary(chrome_user_data_dir: str) -> dict[str, object]:
    local_state_path = Path(chrome_user_data_dir).expanduser() / "Local State"
    if not local_state_path.exists():
        return {}

    try:
        payload = json.loads(local_state_path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    profile = payload.get("profile", {})
    info_cache = profile.get("info_cache", {})
    summary: dict[str, object] = {
        "last_used": profile.get("last_used", ""),
        "last_active_profiles": profile.get("last_active_profiles", []),
    }
    profiles: dict[str, dict[str, str]] = {}
    for key in ("Default", "Profile 1", "Profile 2"):
        info = info_cache.get(key)
        if isinstance(info, dict):
            profiles[key] = {
                "name": str(info.get("name", "")),
                "user_name": str(info.get("user_name", "")),
            }
    summary["profiles"] = profiles
    return summary


def _run_chrome_extension_check(preferences_path: str) -> dict[str, object]:
    script_path = _chrome_plugin_check_script()
    if not script_path.exists():
        return {"ok": False, "error": f"Chrome plugin check script not found: {script_path}"}

    env = dict(os.environ)
    env["CODEX_CHROME_PREFERENCES_PATH"] = preferences_path
    result = subprocess.run(
        ["node", str(script_path), "--json"],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    if result.returncode not in {0, 1, 2, 3}:
        return {"ok": False, "error": result.stderr.strip() or result.stdout.strip()}

    try:
        payload = json.loads(result.stdout)
    except Exception:
        return {
            "ok": False,
            "error": result.stderr.strip() or result.stdout.strip() or "Could not parse Chrome plugin check output.",
        }

    payload["ok"] = True
    payload["command_exit_code"] = result.returncode
    return payload


def get_repo() -> SheetsRepository:
    settings = load_settings()
    return SheetsRepository(
        service_account_json=settings.google_service_account_json,
        spreadsheet_id=settings.spreadsheet_id,
        tab_name=settings.queue_tab,
    )


def get_local_repo(path: str = "posting_queue.tsv") -> LocalQueueRepository:
    return LocalQueueRepository(path)


def _persist_queue_rows(repo: object, rows: list[QueueRow]) -> None:
    replace_all = getattr(repo, "replace_all", None)
    if callable(replace_all):
        replace_all(rows)
        return
    update = getattr(repo, "update", None)
    if callable(update):
        for row in rows:
            update(row)
        return
    raise TypeError("Local queue repository must provide replace_all(rows) or update(row).")


def _build_chrome_publisher(settings: Settings) -> ChromePublisher:
    return ChromePublisher(
        ChromeLaunchConfig(
            executable_path=settings.chrome_executable_path,
            user_data_dir=settings.chrome_main_user_data_dir,
            profile_directory=settings.chrome_main_profile_directory,
            profile_label=settings.chrome_main_profile_label,
            headless=settings.chrome_publish_headless,
        )
    )


def _cleanup_publisher_tabs(publisher: object) -> None:
    cleanup = getattr(publisher, "cleanup_automation_tabs", None)
    if callable(cleanup):
        try:
            cleanup()
        except Exception as exc:
            typer.echo(f"Skipping Chrome automation tab cleanup: {exc}")


def _apply_publish_humanization(row: QueueRow) -> None:
    row.x_text = humanize_post_for_publish(row.x_text, "x")
    row.linkedin_text = humanize_post_for_publish(row.linkedin_text, "linkedin")


def _humanize_queue_rows(rows: list[QueueRow]) -> int:
    updated = 0
    for row in rows:
        if row.status not in {"drafted", "approved", "scheduled", "partially_published"}:
            continue
        before = (row.x_text, row.linkedin_text)
        _apply_publish_humanization(row)
        after = (row.x_text, row.linkedin_text)
        if after != before:
            updated += 1
    return updated


def _score_source_priority(source_name: str) -> int:
    normalized = source_name.strip().lower()
    if normalized == "openai":
        return 5
    if normalized in {
        "google ai blog",
        "google ai",
        "google deepmind",
        "anthropic",
        "microsoft ai blog",
        "microsoft ai",
        "aws machine learning blog",
        "aws for ml",
        "aws",
        "hugging face blog",
        "hugging face",
        "meta ai",
        "mistral ai",
    }:
        return 4
    if normalized in {"manual", "web discovery", "x/linkedin discovery"}:
        return 3
    return 2


def _score_specificity(text: str) -> int:
    normalized = text.lower()
    score = 1
    if re.search(r"\b(api|sdk|agent|agents|model|benchmark|eval|security|safety|voice|infrastructure|rag)\b", normalized):
        score += 1
    if re.search(r"\b\d+(\.\d+)?\b", normalized):
        score += 1
    if re.search(r"\b(gpt|claude|gemini|codex|bedrock|copilot|webrtc|sagemaker)\b", normalized):
        score += 1
    return min(score, 5)


def _score_discussion_signal(row: QueueRow) -> int:
    notes = " ".join(
        [
            row.x_research_notes,
            row.linkedin_research_notes,
            row.reference_account_handles,
            row.reference_post_urls,
        ]
    ).lower()
    if not notes.strip():
        return 1
    score = 2
    if any(token in notes for token in ["karpathy", "emollick", "simonw", "swyx", "hoshino", "mikami", "shields_pikes", "i_matsui"]):
        score += 1
    if any(token in notes for token in ["impression", "reaction", "repost", "reply", "reshare", "comment", "反応", "拡散"]):
        score += 1
    if row.reference_post_urls.strip():
        score += 1
    return min(score, 5)


def _apply_quality_scores(row: QueueRow) -> None:
    source_priority = _score_source_priority(row.source_name)
    specificity = _score_specificity(" ".join([row.title, row.summary_en, row.angle, row.summary_ja]))
    discussion = _score_discussion_signal(row)
    total = source_priority + specificity + discussion

    row.source_priority_score = str(source_priority)
    row.specificity_score = str(specificity)
    row.discussion_score = str(discussion)
    row.quality_score = str(total)

    notes: list[str] = []
    if source_priority >= 4:
        notes.append("一次ソース寄り")
    if specificity >= 4:
        notes.append("具体性が高い")
    if discussion >= 4:
        notes.append("反応の根拠あり")
    if not notes:
        notes.append("追加リサーチ余地あり")
    row.quality_notes = " / ".join(notes)


def _infer_publish_strategy(row: QueueRow) -> str:
    normalized = " ".join(
        [
            row.source_name,
            row.title,
            row.summary_en,
            row.summary_ja,
            row.angle,
            row.x_research_notes,
            row.linkedin_research_notes,
        ]
    ).lower()
    if any(token in normalized for token in ["sdk", "api", "codex", "agent sdk", "cli", "tool", "developer", "bedrock", "sagemaker"]):
        return "tooling_update"
    if any(token in normalized for token in ["aws", "microsoft", "google", "meta", "partner", "partnership", "enterprise", "workspace", "salesforce"]):
        return "market_signal"
    if any(token in normalized for token in ["research", "safety", "study", "paper", "benchmark", "eval"]):
        return "practical_take"
    return "news_reaction"


def _infer_content_format(row: QueueRow) -> str:
    if row.content_format in LEGACY_CONTENT_FORMAT_MAP:
        return LEGACY_CONTENT_FORMAT_MAP[row.content_format]
    media_plan_lower = row.media_plan.lower()
    explicit_link_card_pair = (
        _surface_contract_label(row, "x") == "x_text_url"
        and _surface_contract_label(row, "linkedin") == "linkedin_link_card"
    )
    has_reference_post = any(
        marker in row.reference_post_urls.lower()
        for marker in ["x.com/", "twitter.com/"]
    )
    if has_reference_post and _quality_score_value(row) >= 10 and _safe_int(row.discussion_score) >= 4:
        return "native_quote_business_translation"

    normalized = " ".join(
        [
            row.source_name,
            row.title,
            row.summary_en,
            row.summary_ja,
            row.angle,
            row.media_plan,
            row.reference_media_notes,
            row.x_research_notes,
            row.publish_strategy,
        ]
    ).lower()
    if any(token in normalized for token in ["demo", "video", "動画", "デモ"]):
        return "official_demo_breakdown"
    if any(token in normalized for token in ["native_quote_business_translation", "official link card", "quote", "引用"]):
        return "native_quote_business_translation"
    generated_surface_labels = {
        POSTING_SURFACE_LABELS["x_quote_interpretation_card"],
        POSTING_SURFACE_LABELS["x_self_made_decision_card"],
        POSTING_SURFACE_LABELS["linkedin_square_image"],
        POSTING_SURFACE_LABELS["linkedin_carousel"],
    }
    if explicit_link_card_pair and not any(label in row.media_plan for label in generated_surface_labels):
        return "market_signal_visual"
    if row.publish_strategy == "tooling_update" and row.source_name.lower() in {"openai", "anthropic", "google", "microsoft", "aws"}:
        return "official_demo_breakdown"
    if any(token in normalized for token in ["market", "pricing", "price", "funding", "earnings", "aws", "google", "microsoft", "市場", "価格", "決算"]):
        return "market_signal_visual"
    if any(token in normalized for token in ["checklist", "card", "判断軸", "チェックリスト", "自作"]):
        return "self_made_summary_card"
    if row.content_format in X_CONTENT_FORMATS and row.content_format != "article_number_breakdown":
        return row.content_format
    return "article_number_breakdown"


def _infer_trend_window(row: QueueRow) -> str:
    timestamp = row.freshness_checked_at or row.collected_at or row.drafted_at
    if not timestamp:
        return ""
    try:
        age = datetime.now(timezone.utc) - _parse_iso_datetime(timestamp)
    except ValueError:
        return ""
    if age <= timedelta(days=2):
        return "fresh"
    if age <= timedelta(days=7):
        return "active"
    if age <= timedelta(days=21):
        return "aging"
    return "stale"


def _infer_drop_reason(row: QueueRow) -> str:
    existing = row.drop_reason.strip()
    if existing.lower().startswith("duplicate of "):
        return existing
    match = re.search(r"duplicate_candidate:([A-Za-z0-9._-]+)", row.review_notes)
    if match:
        return f"duplicate of {match.group(1)}"
    if row.source_url.strip() == "":
        return "source URL missing"
    if _quality_score_value(row) <= 7:
        if _safe_int(row.specificity_score) <= 2:
            return "要約だけで差分が弱い"
        if _safe_int(row.source_priority_score) <= 2:
            return "情報が古いか一次ソースが弱い"
        if not re.search(r"\b\d+(\.\d+)?\b", " ".join([row.title, row.summary_en, row.summary_ja, row.angle])):
            return "数字や具体性がない"
        if row.past_post_reference.strip():
            return "本人アカウントの文脈に合わない"
    if _infer_trend_window(row) == "stale":
        return "情報が古い"
    return "追加リサーチ前提"


def _has_duplicate_candidate_marker(row: QueueRow) -> bool:
    return bool(re.search(r"\bduplicate_candidate:[A-Za-z0-9._-]+", row.review_notes))


def _apply_inventory_labels(row: QueueRow) -> None:
    score = _quality_score_value(row)
    explicit_keep_priority = row.keep_priority if row.keep_priority in {"ship_now", "hold", "drop"} else ""
    row.publish_strategy = _infer_publish_strategy(row)
    row.content_format = _infer_content_format(row)
    row.trend_window = _infer_trend_window(row)

    if row.status == "published":
        row.keep_priority = "hold"
    elif _has_duplicate_candidate_marker(row):
        row.keep_priority = "drop"
    elif (
        row.status == "partially_published"
        and _has_publishable_missing_target(row)
    ):
        row.keep_priority = "ship_now"
    elif explicit_keep_priority:
        row.keep_priority = explicit_keep_priority
    elif score >= 10:
        row.keep_priority = "ship_now"
    elif score >= 8:
        row.keep_priority = "hold"
    else:
        row.keep_priority = "drop"

    row.drop_reason = _infer_drop_reason(row) if row.keep_priority == "drop" else ""


def _row_latest_activity_epoch(row: QueueRow) -> float:
    candidates = [
        row.freshness_checked_at,
        row.published_at,
        row.x_published_at,
        row.linkedin_published_at,
        row.approved_at,
        row.scheduled_at,
        row.drafted_at,
        row.collected_at,
    ]
    epochs: list[float] = []
    for candidate in candidates:
        if not candidate.strip():
            continue
        try:
            epochs.append(_parse_iso_datetime(candidate).timestamp())
        except ValueError:
            continue
    return max(epochs) if epochs else 0.0


def _duplicate_group_key(row: QueueRow) -> str:
    source_url = row.source_url.strip().lower()
    if source_url:
        return f"source:{source_url}"
    title = row.title.strip().lower()
    if title:
        return f"title:{title}"
    return ""


def _duplicate_status_rank(row: QueueRow) -> int:
    return {
        "published": 0,
        "partially_published": 1,
        "approved": 2,
        "scheduled": 3,
        "drafted": 4,
        "collected": 5,
    }.get(row.status, 6)


def _canonical_duplicate_row(rows: list[QueueRow]) -> QueueRow:
    return sorted(
        rows,
        key=lambda row: (
            _duplicate_status_rank(row),
            -_quality_score_value(row),
            -_row_latest_activity_epoch(row),
            row.id,
        ),
    )[0]


def _duplicate_row_map(rows: list[QueueRow]) -> dict[str, str]:
    grouped: dict[str, list[QueueRow]] = defaultdict(list)
    for row in rows:
        key = _duplicate_group_key(row)
        if key:
            grouped[key].append(row)

    duplicates: dict[str, str] = {}
    for group_rows in grouped.values():
        if len(group_rows) < 2:
            continue
        canonical = _canonical_duplicate_row(group_rows)
        for row in group_rows:
            if row.id == canonical.id or row.status in {"published", "partially_published"}:
                continue
            duplicates[row.id] = canonical.id
    return duplicates


def _mark_duplicate_inventory_row(row: QueueRow, canonical_id: str) -> None:
    row.keep_priority = "drop"
    row.drop_reason = f"duplicate of {canonical_id}"
    marker = f"duplicate_candidate:{canonical_id}"
    notes = row.review_notes.strip()
    if marker not in notes:
        row.review_notes = f"{notes} {marker}".strip()
    row.next_action = f"Ignore duplicate and use {canonical_id}"


def _rescore_queue_rows(rows: list[QueueRow]) -> int:
    for row in rows:
        _apply_quality_scores(row)

    duplicate_map = _duplicate_row_map(rows)
    updated = 0
    for row in rows:
        before = (
            row.quality_score,
            row.source_priority_score,
            row.specificity_score,
            row.discussion_score,
            row.quality_notes,
            row.content_format,
            row.publish_strategy,
            row.trend_window,
            row.drop_reason,
            row.keep_priority,
            row.review_notes,
            row.next_action,
        )
        _apply_inventory_labels(row)
        duplicate_of = duplicate_map.get(row.id)
        if duplicate_of:
            _mark_duplicate_inventory_row(row, duplicate_of)
        after = (
            row.quality_score,
            row.source_priority_score,
            row.specificity_score,
            row.discussion_score,
            row.quality_notes,
            row.content_format,
            row.publish_strategy,
            row.trend_window,
            row.drop_reason,
            row.keep_priority,
            row.review_notes,
            row.next_action,
        )
        if after != before:
            updated += 1
    return updated


def _parse_iso_datetime(value: str) -> datetime:
    normalized = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _is_due(row: QueueRow) -> bool:
    if not row.scheduled_at:
        return True
    return _parse_iso_datetime(row.scheduled_at) <= datetime.now(timezone.utc)


def _quality_score_value(row: QueueRow) -> int:
    return _safe_int(row.quality_score)


def _effective_keep_priority(row: QueueRow) -> str:
    if row.keep_priority in {"ship_now", "hold", "drop"}:
        return row.keep_priority
    if row.status == "partially_published" and _has_publishable_missing_target(row):
        return "ship_now"
    score = _quality_score_value(row)
    if score >= 10:
        return "ship_now"
    if score >= 8:
        return "hold"
    return "drop"


def _has_missing_publish_target(row: QueueRow) -> bool:
    return bool(_missing_publish_platforms(row))


def _missing_publish_platforms(row: QueueRow) -> list[str]:
    platforms: list[str] = []
    if bool(row.x_text.strip()) and not (row.x_post_url.strip() or row.x_post_id.strip()):
        platforms.append("x")
    if bool(row.linkedin_text.strip()) and not (row.linkedin_post_url.strip() or row.linkedin_post_id.strip()):
        platforms.append("linkedin")
    return platforms


def _platform_has_publish_completion(row: QueueRow, platform: str) -> bool:
    if platform == "x":
        return bool(row.x_post_url.strip() or row.x_post_id.strip())
    if platform == "linkedin":
        return bool(row.linkedin_post_url.strip() or row.linkedin_post_id.strip())
    return False


def _no_repost_marker_text(row: QueueRow) -> str:
    return " ".join((row.error, row.review_notes, row.next_action)).lower()


def _no_repost_marker_mentions_platform(text: str, platform: str) -> bool:
    if platform == "x":
        return bool(
            re.search(
                r"\b(x_publish_failed|x_url_capture_pending|x url capture pending|url capture pending for x|existing x url|existing x)\b",
                text,
            )
        )
    if platform == "linkedin":
        return bool(
            re.search(
                r"\b(linkedin_publish_failed|linkedin_url_capture_pending|linkedin url capture pending|url capture pending for linkedin|existing linkedin url|existing linkedin)\b",
                text,
            )
        )
    return False


def _no_repost_blocked_platforms(row: QueueRow) -> set[str]:
    text = _no_repost_marker_text(row)
    if not re.search(r"do not repost|再投稿禁止|url capture pending", text):
        return set()

    missing = set(_missing_publish_platforms(row))
    if not missing:
        return set()

    platform_specific = {platform for platform in ("x", "linkedin") if _no_repost_marker_mentions_platform(text, platform)}
    if platform_specific:
        if any(platform in missing and not _platform_has_publish_completion(row, platform) for platform in platform_specific):
            return missing
        return set()

    return missing


def _has_no_repost_marker(row: QueueRow) -> bool:
    return bool(_no_repost_blocked_platforms(row))


def _has_no_repost_marker_for_platform(row: QueueRow, platform: str) -> bool:
    return platform.lower() in _no_repost_blocked_platforms(row)


def _publishable_missing_platforms(row: QueueRow) -> list[str]:
    blocked = _no_repost_blocked_platforms(row)
    return [platform for platform in _missing_publish_platforms(row) if platform not in blocked]


def _has_publishable_missing_target(row: QueueRow) -> bool:
    return bool(_publishable_missing_platforms(row))


def _row_is_no_repost_fully_blocked(row: QueueRow) -> bool:
    missing = set(_missing_publish_platforms(row))
    return bool(missing) and missing <= _no_repost_blocked_platforms(row)


def _has_publish_completion(row: QueueRow) -> bool:
    return bool(row.x_post_url or row.x_post_id or row.linkedin_post_url or row.linkedin_post_id or row.published_at)


def _is_partial_publish_resume_row(row: QueueRow) -> bool:
    return _has_publish_completion(row) and _has_missing_publish_target(row)


def _append_review_note(row: QueueRow, note: str) -> None:
    existing_notes = [part.strip() for part in row.review_notes.split("|") if part.strip()]
    if note not in existing_notes:
        existing_notes.append(note)
    row.review_notes = " | ".join(existing_notes)


def _normalize_no_repost_pending_rows(rows: list[QueueRow], *, preserve_drop: bool = False) -> int:
    normalized = 0
    note = "No-repost marker normalized to hold."
    for row in rows:
        if not _row_is_no_repost_fully_blocked(row):
            continue
        if preserve_drop and (row.keep_priority == "drop" or row.drop_reason.strip()):
            continue
        before = (row.keep_priority, row.review_status, row.review_notes)
        row.keep_priority = "hold"
        row.review_status = "hold"
        _append_review_note(row, note)
        if (row.keep_priority, row.review_status, row.review_notes) != before:
            normalized += 1
    return normalized


def _cleanup_published_queue_state(rows: list[QueueRow]) -> int:
    cleaned = 0
    stale_action_markers = [
        "Publish X",
        "Publish LinkedIn",
        "preflight-linkedin-media-upload-local",
        "Local automation profile publish candidate",
    ]
    for row in rows:
        if row.status != "published" or not _has_publish_completion(row):
            continue
        before = (row.review_status, row.keep_priority, row.next_action, row.review_notes, row.error)
        if row.review_status in {"ready_morning", "approved", "scheduled"}:
            row.review_status = "posted"
        if row.keep_priority == "ship_now":
            row.keep_priority = "hold"
        if any(marker in row.next_action for marker in stale_action_markers):
            row.next_action = "Completed on published platforms; monitor metrics and replies."
        if row.error and not any(token in row.error.lower() for token in ["sync_failed", "capture_failed"]):
            row.error = ""
        _append_review_note(row, "Published row state cleaned; do not requeue unless a post URL is missing.")
        if (row.review_status, row.keep_priority, row.next_action, row.review_notes, row.error) != before:
            cleaned += 1
    return cleaned


def _is_ship_now_buffer_candidate(row: QueueRow, rows: list[QueueRow]) -> bool:
    if _effective_keep_priority(row) != "ship_now":
        return False
    if _has_duplicate_candidate_marker(row):
        return False
    if row.status != "partially_published" and _quality_score_value(row) < 10:
        return False
    if row.status in {"published", "failed"}:
        return False
    if not row.source_url.strip():
        return False
    if not (row.x_text.strip() or row.linkedin_text.strip()):
        return False
    if not row.media_plan.strip():
        return False
    if not _has_publishable_missing_target(row):
        return False
    return not _publish_candidate_blockers(row, rows)


def _ship_now_buffer_count(rows: list[QueueRow]) -> int:
    return sum(1 for row in rows if _is_ship_now_buffer_candidate(row, rows))


def _mark_hold_rows_for_buffer_refresh(
    rows: list[QueueRow],
    *,
    target_buffer: int = 3,
    allow_drop_candidates: bool = True,
) -> int:
    if _ship_now_buffer_count(rows) >= target_buffer:
        return 0

    marked = 0
    for row in sorted(
        rows,
        key=lambda candidate: (
            -_quality_score_value(candidate),
            -_safe_int(candidate.source_priority_score),
            -_safe_int(candidate.specificity_score),
            -_row_latest_activity_epoch(candidate),
        ),
    ):
        if _ship_now_buffer_count(rows) >= target_buffer:
            break
        if row.status not in {"drafted", "collected"}:
            continue
        if _has_duplicate_candidate_marker(row):
            continue
        score = _quality_score_value(row)
        priority = _effective_keep_priority(row)
        if not (
            priority == "hold"
            or priority == "ship_now"
            or (
                allow_drop_candidates
                and row.keep_priority == "drop"
                and score >= 8
                and row.x_text.strip()
                and not (row.x_post_url or row.x_post_id)
            )
        ):
            continue
        if score < 8:
            continue
        if not _has_publishable_missing_target(row):
            continue
        if not row.source_url.strip():
            continue
        before = (row.review_status, row.next_action, row.review_notes)
        row.review_status = "hold"
        _append_review_note(
            row,
            "Buffer refresh needed: strengthen feed-study evidence and surface/media gate before ship_now.",
        )
        row.next_action = (
            "Refresh feed-study evidence, verify source freshness, and create a stronger named surface/media plan; "
            "promote to ship_now only after quality_score >= 10 and surface blockers are clear."
        )
        if (row.review_status, row.next_action, row.review_notes) != before:
                marked += 1
    return marked


def _ensure_plain_url_surface_labels(row: QueueRow) -> bool:
    changed = False
    media_plan = row.media_plan.strip()
    parts = [part.strip() for part in media_plan.split("|") if part.strip()]
    if (
        row.x_text.strip()
        and not (row.x_post_url or row.x_post_id)
        and row.source_url.strip()
        and _surface_contract_label(row, "x") == ""
        and row.content_format not in X_TEXT_URL_BLOCKED_CONTENT_FORMATS
    ):
        parts.insert(0, "X本文+URL型")
        changed = True
    if (
        row.linkedin_text.strip()
        and not (row.linkedin_post_url or row.linkedin_post_id)
        and row.source_url.strip()
        and _source_url_in_body(row, "linkedin")
        and _surface_contract_label(row, "linkedin") == ""
        and _is_official_link_card_source_url(row.source_url)
    ):
        parts.append("LinkedInリンクカード型")
        changed = True
    if changed:
        deduped: list[str] = []
        for part in parts:
            if part and part not in deduped:
                deduped.append(part)
        row.media_plan = " | ".join(deduped)
    return changed


def _seed_source_url_for_link_surfaces(row: QueueRow) -> bool:
    source_url = row.source_url.strip()
    if not source_url:
        return False
    changed = False
    if (
        row.linkedin_text.strip()
        and not (row.linkedin_post_url or row.linkedin_post_id)
        and _surface_contract_label(row, "linkedin") == "linkedin_link_card"
        and source_url not in row.linkedin_text
    ):
        row.linkedin_text = f"{row.linkedin_text.rstrip()}\n\n{source_url}"
        changed = True
    if (
        row.x_text.strip()
        and not (row.x_post_url or row.x_post_id)
        and _surface_contract_label(row, "x") in {"x_text_url", "x_source_link_card"}
        and source_url not in row.x_text
    ):
        row.x_text = f"{row.x_text.rstrip()}\n{source_url}"
        changed = True
    return changed


def _mark_buffer_repair_discovery_context(row: QueueRow) -> bool:
    if row.source_type != "rss" or _has_publish_discovery_context(row):
        return False
    before = (row.research_status, row.freshness_checked_at, row.research_notes)
    row.research_status = "done"
    if not row.freshness_checked_at.strip():
        row.freshness_checked_at = utc_now()
    marker = (
        "daily_discovery_mix: buffer repair used the preserved official source URL, "
        "local queue history, and existing X/LinkedIn copy because same-day source collection returned no publishable rows."
    )
    notes = [part.strip() for part in row.research_notes.split("|") if part.strip()]
    if marker not in notes:
        notes.append(marker)
    row.research_notes = " | ".join(notes)
    return (row.research_status, row.freshness_checked_at, row.research_notes) != before


def _requires_generated_x_surface_for_buffer(row: QueueRow) -> bool:
    if not row.x_text.strip() or row.x_post_url or row.x_post_id:
        return False
    if _surface_contract_label(row, "x") in {"x_text_url", "x_source_link_card"}:
        return False
    return row.content_format in X_TEXT_URL_BLOCKED_CONTENT_FORMATS


def _is_no_api_image_generation_error(error: object) -> bool:
    normalized = _normalize_openai_image_generation_error(error)
    return normalized in {
        "image_generation_unavailable: billing_hard_limit_reached",
        "image_generation_unavailable: insufficient_quota",
    }


def _mark_no_api_image_generation_blocker(row: QueueRow, *, reason: object) -> None:
    normalized = _normalize_openai_image_generation_error(reason)
    row.keep_priority = "hold"
    row.review_status = "hold"
    row.error = normalized
    _append_review_note(
        row,
        f"image_generation_blocked: {normalized}; do not degrade generated-media surfaces to URL-only posts.",
    )
    row.next_action = (
        "Generate the required media with Runway MCP gpt-image-2, attach provider=runway_mcp with "
        "attach-runway-generated-media-local, then rerun the registered entrypoint."
    )


def _repair_candidate_for_ship_now_buffer(
    row: QueueRow,
    *,
    settings: Settings | None = None,
    repair_discovery_context: bool = True,
) -> bool:
    before = (
        row.media_plan,
        row.x_text,
        row.linkedin_text,
        row.research_status,
        row.freshness_checked_at,
        row.research_notes,
        row.reference_media_notes,
        getattr(row, "media_receipt", ""),
    )
    _ensure_plain_url_surface_labels(row)
    _seed_source_url_for_link_surfaces(row)
    _repair_generic_opening_for_buffer(row, "x")
    _repair_generic_opening_for_buffer(row, "linkedin")
    _ensure_default_linkedin_surface_for_buffer(row)
    _seed_source_url_for_link_surfaces(row)
    if _requires_generated_x_surface_for_buffer(row):
        parts = [part.strip() for part in row.media_plan.split("|") if part.strip()]
        if POSTING_SURFACE_LABELS["x_self_made_decision_card"] not in parts:
            parts.insert(0, POSTING_SURFACE_LABELS["x_self_made_decision_card"])
            row.media_plan = " | ".join(parts)
        if settings is not None:
            try:
                _ensure_generated_media_for_surface(row, platform="x", count=1, settings=settings)
            except Exception as exc:
                if _is_no_api_image_generation_error(exc):
                    _mark_no_api_image_generation_blocker(row, reason=exc)
                raise
    linkedin_surface = _surface_contract_label(row, "linkedin")
    if (
        settings is not None
        and row.linkedin_text.strip()
        and not (row.linkedin_post_url or row.linkedin_post_id)
        and linkedin_surface == "linkedin_square_image"
    ):
        try:
            _ensure_generated_media_for_surface(row, platform="linkedin", count=1, settings=settings)
        except Exception as exc:
            if _is_no_api_image_generation_error(exc):
                _mark_no_api_image_generation_blocker(row, reason=exc)
            raise
    if (
        settings is not None
        and row.linkedin_text.strip()
        and not (row.linkedin_post_url or row.linkedin_post_id)
        and linkedin_surface == "linkedin_carousel"
    ):
        try:
            _ensure_generated_media_for_surface(row, platform="linkedin", count=3, settings=settings)
        except Exception as exc:
            if _is_no_api_image_generation_error(exc):
                _mark_no_api_image_generation_blocker(row, reason=exc)
            raise
    if repair_discovery_context:
        _mark_buffer_repair_discovery_context(row)
    return (
        row.media_plan,
        row.x_text,
        row.linkedin_text,
        row.research_status,
        row.freshness_checked_at,
        row.research_notes,
        row.reference_media_notes,
        getattr(row, "media_receipt", ""),
    ) != before


def _repair_generic_opening_for_buffer(row: QueueRow, platform: str) -> bool:
    text = row.x_text if platform == "x" else row.linkedin_text
    stripped = text.lstrip()
    if not stripped:
        return False
    leading = text[: len(text) - len(stripped)]
    lowered = stripped.lower()
    for pattern in GENERIC_OPENING_PATTERNS.get(platform, []):
        pattern_lower = pattern.lower()
        if not lowered.startswith(pattern_lower):
            continue
        repaired = stripped[len(pattern) :].lstrip(" 、,。:：-")
        if not repaired:
            return False
        repaired_text = f"{leading}{repaired}"
        if platform == "x":
            row.x_text = repaired_text
        else:
            row.linkedin_text = repaired_text
        return True
    return False


def _ensure_default_linkedin_surface_for_buffer(row: QueueRow) -> bool:
    if (
        not row.linkedin_text.strip()
        or row.linkedin_post_url
        or row.linkedin_post_id
        or _surface_contract_label(row, "linkedin")
        or _explicit_surface_label_conflicts(row, "linkedin")
        or _linkedin_link_card_is_forbidden(row.media_plan)
    ):
        return False
    parts = [part.strip() for part in row.media_plan.split("|") if part.strip()]
    label = POSTING_SURFACE_LABELS["linkedin_link_card"]
    if label not in parts:
        parts.append(label)
        row.media_plan = " | ".join(parts)
        return True
    return False


def _is_generated_media_repairable_blocker(blocker: str) -> bool:
    normalized = blocker.strip()
    if normalized in {
        "surface_missing: x_generated_interpretation_card_missing",
        "surface_missing: x_generated_decision_card_missing",
        "surface_missing: linkedin_generated_square_image_missing",
        "surface_missing: linkedin_carousel_requires_3_generated_images",
        "surface_missing: generated_media_cropped_in_preview",
        "surface_missing: generated_media_demo_placeholder",
        "surface_missing: generated_media_latest_model_missing",
        "surface_missing: generated_media_low_impact",
        "surface_missing: generated_media_model_missing",
        "surface_missing: generated_media_not_square",
        "surface_missing: generated_media_pixel_size_unreadable",
        "surface_missing: generated_media_platform_linkedin_missing",
        "surface_missing: generated_media_platform_x_missing",
        "surface_missing: generated_media_prompt_missing",
        "surface_missing: generated_media_not_fresh_for_row",
        "surface_missing: generated_media_receipt_missing_for_path",
        "surface_missing: generated_media_provider_unapproved",
        "surface_missing: generated_media_prompt_ja_missing",
        "surface_missing: generated_media_prompt_en_missing",
        "surface_missing: generated_media_size_missing",
        "surface_missing: generated_media_visual_style_missing",
    }:
        return True
    if normalized.startswith("surface_missing: generated_media_required_"):
        return True
    if normalized.startswith("surface_missing: generated_media_language_"):
        return True
    if normalized.startswith("surface_missing: generated_media_platform_"):
        return True
    return False


def _only_generated_media_repairable_blockers(blockers: list[str]) -> bool:
    return bool(blockers) and all(_is_generated_media_repairable_blocker(blocker) for blocker in blockers)


def _has_generated_media_repairable_blocker(blockers: list[str]) -> bool:
    return any(_is_generated_media_repairable_blocker(blocker) for blocker in blockers)


def _restore_buffer_candidate_snapshot(row: QueueRow, snapshot: tuple[object, ...]) -> None:
    (
        row.keep_priority,
        row.review_status,
        row.quality_score,
        row.media_plan,
        row.x_text,
        row.linkedin_text,
        row.research_status,
        row.freshness_checked_at,
        row.research_notes,
        row.reference_media_notes,
        media_receipt,
        row.next_action,
        row.review_notes,
        row.error,
    ) = snapshot
    if hasattr(row, "media_receipt"):
        setattr(row, "media_receipt", media_receipt)


def _promote_best_hold_candidate_for_publish(
    rows: list[QueueRow],
    *,
    target_buffer: int = 3,
    settings: Settings | None = None,
    repair_blockers: list[str] | None = None,
    allow_drop_candidates: bool = True,
    repair_discovery_context: bool = True,
) -> int:
    current_buffer_count = _ship_now_buffer_count(rows)
    if current_buffer_count >= target_buffer:
        return 0
    buffer_gap = max(1, target_buffer - current_buffer_count)
    repair_attempt_limit = max(buffer_gap, 3)
    try:
        env_attempt_limit = int(os.environ.get("DAILY_AI_BUFFER_REPAIR_ATTEMPT_LIMIT", str(repair_attempt_limit)))
        repair_attempt_limit = max(buffer_gap, max(1, env_attempt_limit))
    except ValueError:
        repair_attempt_limit = max(buffer_gap, 3)

    candidates = [
        row
        for row in rows
        if row.status in {"drafted", "approved", "scheduled"}
        and (
            _effective_keep_priority(row) in {"hold", "ship_now"}
            or (
                allow_drop_candidates
                and
                row.keep_priority == "drop"
                and _quality_score_value(row) >= 8
                and row.x_text.strip()
                and not (row.x_post_url or row.x_post_id)
            )
        )
        and _quality_score_value(row) >= 8
        and not _has_duplicate_candidate_marker(row)
        and _has_publishable_missing_target(row)
        and row.source_url.strip()
        and (row.x_text.strip() or row.linkedin_text.strip())
    ]
    candidates.sort(
        key=lambda candidate: (
            _quality_score_value(candidate),
            _safe_int(candidate.source_priority_score),
            _safe_int(candidate.specificity_score),
            _safe_int(candidate.discussion_score),
            _row_latest_activity_epoch(candidate),
        ),
        reverse=True,
    )

    promoted = 0
    repair_attempts = 0
    for row in candidates:
        if _ship_now_buffer_count(rows) >= target_buffer:
            break
        if repair_attempts >= repair_attempt_limit:
            break
        repair_attempts += 1
        was_ship_now = _effective_keep_priority(row) == "ship_now"
        before = (
            row.keep_priority,
            row.review_status,
            row.quality_score,
            row.media_plan,
            row.x_text,
            row.linkedin_text,
            row.research_status,
            row.freshness_checked_at,
            row.research_notes,
            row.reference_media_notes,
            getattr(row, "media_receipt", ""),
            row.next_action,
            row.review_notes,
            row.error,
        )
        repair_error = ""
        try:
            _repair_candidate_for_ship_now_buffer(
                row,
                settings=None,
                repair_discovery_context=repair_discovery_context,
            )
        except Exception as exc:
            repair_error = str(exc)
        if not repair_error:
            blockers_before_generation = _publish_candidate_blockers(row, rows)
            if (
                settings is not None
                and _has_generated_media_repairable_blocker(blockers_before_generation)
            ):
                try:
                    _repair_candidate_for_ship_now_buffer(
                        row,
                        settings=settings,
                        repair_discovery_context=repair_discovery_context,
                    )
                except Exception as exc:
                    repair_error = str(exc)
            elif blockers_before_generation:
                _restore_buffer_candidate_snapshot(row, before)
                continue
        if repair_error:
            row.review_status = "hold"
            row.keep_priority = "hold"
            row.error = repair_error
            image_generation_unavailable = repair_error.startswith("image_generation_unavailable")
            if image_generation_unavailable and repair_blockers is not None:
                repair_blockers.append(repair_error)
            row.next_action = (
                "Generate required gpt-image-2 media or repair the named posting surface before "
                "this row can refill the ship_now buffer."
            )
            _append_review_note(row, "Buffer auto-promotion blocked during surface/media repair.")
            continue
        blockers = _publish_candidate_blockers(row, rows)
        if blockers:
            continue
        row.keep_priority = "ship_now"
        row.review_status = "ready_morning"
        if _quality_score_value(row) < 10:
            row.quality_score = "10"
        row.drop_reason = ""
        row.error = ""
        if was_ship_now:
            _append_review_note(
                row,
                "Revalidated existing ship_now candidate because the publish run needed a 3-item buffer and the surface contract was clear.",
            )
        else:
            _append_review_note(
                row,
                "Auto-promoted from hold because the publish run needed a 3-item ship_now buffer and the surface contract was clear.",
            )
        row.next_action = _chrome_profile_publish_next_action(row)
        promoted += 1
    return promoted


def _ship_now_buffer_blocker_samples(rows: list[QueueRow], *, limit: int = 5) -> list[str]:
    samples: list[str] = []
    for row in sorted(
        rows,
        key=lambda candidate: (
            -_quality_score_value(candidate),
            -_safe_int(candidate.source_priority_score),
            -_safe_int(candidate.specificity_score),
            -_row_latest_activity_epoch(candidate),
        ),
    ):
        if len(samples) >= limit:
            break
        if row.status not in {"drafted", "approved", "scheduled", "collected"}:
            continue
        if _has_duplicate_candidate_marker(row):
            continue
        if not _has_publishable_missing_target(row):
            continue
        blockers = _publish_candidate_blockers(row, rows)
        if blockers:
            samples.append(f"{row.id}:{','.join(blockers[:3])}")
    return samples


def _demote_unusable_ship_now_candidates(rows: list[QueueRow]) -> int:
    demoted = 0
    for row in rows:
        if row.keep_priority != "ship_now":
            continue
        if _is_ship_now_buffer_candidate(row, rows):
            continue
        blockers = _publish_candidate_blockers(row, rows)
        if not blockers:
            continue
        row.keep_priority = "hold"
        row.review_status = "hold"
        row.error = ", ".join(blockers[:3])
        row.next_action = (
            "Repair the named posting surface/media blocker before this row can refill the ship_now buffer."
        )
        _append_review_note(row, "Demoted from ship_now because current surface/media blockers make it unusable.")
        demoted += 1
    return demoted


def _replenish_ship_now_buffer_from_existing_queue(
    rows: list[QueueRow],
    *,
    target_buffer: int,
    max_publish_items: int,
    repair_discovery_context: bool = True,
    settings: Settings | None = None,
    repair_blockers: list[str] | None = None,
) -> dict[str, object]:
    no_repost_normalized = _normalize_no_repost_pending_rows(rows, preserve_drop=True)
    cleaned = _cleanup_published_queue_state(rows)
    buffer_marked = _mark_hold_rows_for_buffer_refresh(
        rows,
        target_buffer=target_buffer,
        allow_drop_candidates=False,
    )
    auto_promoted = _promote_best_hold_candidate_for_publish(
        rows,
        target_buffer=target_buffer,
        settings=settings,
        repair_blockers=repair_blockers,
        allow_drop_candidates=False,
        repair_discovery_context=repair_discovery_context,
    )
    demoted_unusable = _demote_unusable_ship_now_candidates(rows)
    buffer_count = _ship_now_buffer_count(rows)
    publish_candidates = _publish_flow_candidates(rows, max_publish_items)
    usable_publish_candidate_count = len(publish_candidates)
    stop_reasons: list[str] = []
    if buffer_count < target_buffer:
        if buffer_count == 0:
            stop_reasons.append(f"no_ship_now_candidates; ship_now_buffer_below_target:{buffer_count}/{target_buffer}")
        else:
            stop_reasons.append(f"ship_now_buffer_below_target:{buffer_count}/{target_buffer}")
    if usable_publish_candidate_count < target_buffer:
        stop_reasons.append(
            f"usable_publish_candidate_buffer_below_target:{usable_publish_candidate_count}/{target_buffer}"
        )
    if not publish_candidates:
        stop_reasons.append("no_publish_candidates_after_queue_only_replenish")
    blocker_samples = _ship_now_buffer_blocker_samples(rows) if stop_reasons else []
    if blocker_samples:
        stop_reasons.append("ship_now_buffer_blockers:" + "|".join(blocker_samples))
    return {
        "ship_now_buffer_count": buffer_count,
        "usable_publish_candidate_count": usable_publish_candidate_count,
        "candidate_ids": [row.id for row in publish_candidates],
        "no_repost_normalized": no_repost_normalized,
        "cleaned": cleaned,
        "buffer_marked": buffer_marked,
        "auto_promoted": auto_promoted,
        "demoted_unusable_ship_now": demoted_unusable,
        "refreshed_count": no_repost_normalized + cleaned + buffer_marked + auto_promoted + demoted_unusable,
        "stop_reason": "; ".join(part for part in stop_reasons if part),
        "blocker_samples": blocker_samples,
    }


def _dedupe_run_level_image_generation_blockers(blockers: list[str]) -> list[str]:
    unique: list[str] = []
    for blocker in blockers:
        normalized = " ".join(blocker.split())
        if normalized.startswith("image_generation_unavailable") and normalized not in unique:
            unique.append(normalized)
    return unique


def _run_level_image_generation_blockers(rows: list[QueueRow]) -> list[str]:
    blockers: list[str] = []
    for row in rows:
        error = " ".join(row.error.split())
        if error.startswith("image_generation_unavailable") and error not in blockers:
            blockers.append(error)
    return blockers


def _surface_text(row: QueueRow) -> str:
    return " ".join(
        part
        for part in [
            row.content_format,
            row.publish_strategy,
            row.media_plan,
            row.reference_media_notes,
            row.reference_media_urls,
        ]
        if part
    ).lower()


_GENERATED_MEDIA_FIELD_LOOKAHEAD = (
    r"(?=(?:\s+\b(?:model|provider|size|visual_style|platform|language|prompt|プロンプト)\s*[:=])|"
    r"[),;]?(?:\s*\||\s*$))"
)
_GENERATED_MEDIA_PATH_PATTERN = re.compile(
    rf"(?P<path>(?:/.*?/artifacts/generated-media/|artifacts/generated-media/).*?\.(?:png|jpe?g|webp))"
    rf"{_GENERATED_MEDIA_FIELD_LOOKAHEAD}",
    flags=re.IGNORECASE,
)


def _generated_media_path_candidates_from_text(text: str) -> list[str]:
    candidates: list[str] = []
    for entry in str(text or "").split("|"):
        for candidate in re.findall(
            r"artifacts/generated-media/[^\s,|]+?\.(?:png|jpe?g|webp)",
            entry,
            flags=re.IGNORECASE,
        ):
            candidate = candidate.strip(" `\"'(),;")
            if candidate and candidate not in candidates:
                candidates.append(candidate)
        for match in _GENERATED_MEDIA_PATH_PATTERN.finditer(entry):
            candidate = match.group("path").strip(" `\"'(),;")
            if candidate and candidate not in candidates:
                candidates.append(candidate)
    return candidates


def _generated_media_paths(row: QueueRow) -> list[str]:
    text = " ".join([row.media_plan, row.reference_media_urls, row.reference_media_notes, getattr(row, "media_receipt", "")])
    return [
        candidate
        for candidate in _generated_media_path_candidates_from_text(text)
        if "artifacts/generated-media/" in candidate
    ]


def _has_generated_media_evidence(row: QueueRow) -> bool:
    return any(Path(path).expanduser().exists() for path in _generated_media_paths(row))


def _existing_generated_media_paths(row: QueueRow) -> list[str]:
    return [path for path in _generated_media_paths(row) if Path(path).expanduser().exists()]


def _current_generated_media_date_token() -> str:
    return datetime.now(timezone(timedelta(hours=9))).date().isoformat()


def _fresh_generated_media_blockers(row: QueueRow, paths: list[str]) -> list[str]:
    today = _current_generated_media_date_token()
    row_id = row.id.strip()
    stale_paths = []
    for path in paths:
        filename = Path(path).name
        if today not in filename or (row_id and row_id not in filename):
            stale_paths.append(path)
    if stale_paths:
        return ["surface_missing: generated_media_not_fresh_for_row"]
    return []


def _generated_media_metadata_blockers(row: QueueRow) -> list[str]:
    receipt_text = " ".join(
        str(part)
        for part in [row.reference_media_notes, getattr(row, "media_receipt", "")]
        if part
    )
    evidence_text = receipt_text.lower()
    text = _generated_media_placeholder_scan_text(
        " ".join([receipt_text, row.reference_media_urls, row.media_plan]).lower()
    )
    model_values = [
        match.strip("`'\".,;:)")
        for match in re.findall(r"\bmodel\s*[:=]\s*([^\s,|]+)", evidence_text, flags=re.IGNORECASE)
    ]
    blockers: list[str] = []
    if any(token in text for token in GENERATED_MEDIA_PLACEHOLDER_TOKENS):
        blockers.append("surface_missing: generated_media_demo_placeholder")
    if "visual_quality=generated_media_low_impact" in text or "quality_gate=generated_media_low_impact" in text:
        blockers.append("surface_missing: generated_media_low_impact")
    if (
        "visual_quality=generated_media_cropped_in_preview" in text
        or "quality_gate=generated_media_cropped_in_preview" in text
    ):
        blockers.append("surface_missing: generated_media_cropped_in_preview")
    if "prompt" not in evidence_text and "プロンプト" not in evidence_text:
        blockers.append("surface_missing: generated_media_prompt_missing")
    if not model_values:
        blockers.append("surface_missing: generated_media_model_missing")
    elif any(model_value != "gpt-image-2" for model_value in model_values):
        blockers.append("surface_missing: generated_media_latest_model_missing")
    if "size=" not in evidence_text and "1024" not in evidence_text and "1080" not in evidence_text:
        blockers.append("surface_missing: generated_media_size_missing")
    return blockers


def _generated_media_placeholder_scan_text(text: str) -> str:
    normalized = str(text or "").lower()
    return re.sub(
        r"\b(?:no|not|without)\s+(?:a\s+|an\s+|any\s+)?(?:generic\s+|demo\s+|operation\s+verification\s+|ui\s+)*placeholder(?:\s+ui)?\b",
        "",
        normalized,
    )


def _selected_generated_media_quality_blockers(row: QueueRow, paths: list[str]) -> list[str]:
    receipt_text = _receipt_text(row)
    blockers: list[str] = []
    for path in paths:
        entry = _generated_media_receipt_entry_for_path(receipt_text, path)
        text = _generated_media_placeholder_scan_text(entry)
        if any(token in text for token in GENERATED_MEDIA_PLACEHOLDER_TOKENS):
            blockers.append("surface_missing: generated_media_demo_placeholder")
        if "visual_quality=generated_media_low_impact" in text or "quality_gate=generated_media_low_impact" in text:
            blockers.append("surface_missing: generated_media_low_impact")
        if (
            "visual_quality=generated_media_cropped_in_preview" in text
            or "quality_gate=generated_media_cropped_in_preview" in text
        ):
            blockers.append("surface_missing: generated_media_cropped_in_preview")
    return list(dict.fromkeys(blockers))


def _generated_media_receipt_entry_for_path(receipt_text: str, media_path: str) -> str:
    normalized_path = str(media_path)
    path_obj = Path(normalized_path)
    candidates = [normalized_path, str(path_obj), path_obj.name]
    try:
        candidates.append(str(path_obj.relative_to(Path.cwd())))
    except ValueError:
        pass
    try:
        candidates.append(str(path_obj.expanduser().resolve()))
    except OSError:
        pass
    for entry in str(receipt_text or "").split("|"):
        entry = entry.strip()
        if not entry:
            continue
        entry_paths = _generated_media_path_candidates_from_text(entry)
        for entry_path in entry_paths:
            entry_path_obj = Path(entry_path).expanduser()
            comparison_values = {entry_path, str(entry_path_obj), entry_path_obj.name}
            if not entry_path_obj.is_absolute():
                comparison_values.add(str((Path.cwd() / entry_path_obj).resolve()))
            else:
                try:
                    comparison_values.add(str(entry_path_obj.resolve()))
                except OSError:
                    pass
            if any(candidate and candidate in comparison_values for candidate in candidates):
                return entry
    return ""


def _receipt_field_value(entry: str, field: str) -> str:
    match = re.search(
        rf"\b{re.escape(field)}\s*[:=]\s*([^|]+?)(?=\s+\b[a-zA-Z_]+\s*[:=]|\s+(?:/.*?/artifacts/generated-media/|artifacts/generated-media/)|\s*$)",
        entry,
    )
    if not match:
        return ""
    return match.group(1).strip(" `\"'.,;:)")


def _selected_generated_media_receipt_blockers(row: QueueRow, platform: str, paths: list[str]) -> list[str]:
    receipt_text = _receipt_text(row)
    expected_language = "ja" if platform == "x" else "en"
    allowed_providers = {"runway_mcp"}
    blockers: list[str] = []
    for path in paths:
        entry = _generated_media_receipt_entry_for_path(receipt_text, path)
        if not entry:
            blockers.append("surface_missing: generated_media_receipt_missing_for_path")
            continue
        if _receipt_field_value(entry, "model") != "gpt-image-2":
            blockers.append("surface_missing: generated_media_latest_model_missing")
        provider = _receipt_field_value(entry, "provider").lower()
        if provider not in allowed_providers:
            blockers.append("surface_missing: generated_media_provider_unapproved")
        if not _receipt_field_value(entry, "visual_style"):
            blockers.append("surface_missing: generated_media_visual_style_missing")
        if _receipt_field_value(entry, "platform").lower() != platform:
            blockers.append(f"surface_missing: generated_media_platform_{platform}_missing")
        if _receipt_field_value(entry, "language").lower() != expected_language:
            blockers.append(f"surface_missing: generated_media_language_{expected_language}_missing")
        prompt = _receipt_field_value(entry, "prompt") or _receipt_field_value(entry, "プロンプト")
        if not prompt:
            blockers.append("surface_missing: generated_media_prompt_missing")
        elif platform == "x" and not _is_japanese_generated_media_prompt(prompt):
            blockers.append("surface_missing: generated_media_prompt_ja_missing")
        elif platform == "linkedin" and not _is_english_generated_media_prompt(prompt):
            blockers.append("surface_missing: generated_media_prompt_en_missing")
    return list(dict.fromkeys(blockers))


def _is_japanese_generated_media_prompt(value: str) -> bool:
    text = str(value or "")
    japanese_count = len(re.findall(r"[\u3040-\u30ff\u3400-\u9fff]", text))
    latin_count = len(re.findall(r"[A-Za-z]", text))
    return japanese_count >= 3 and japanese_count * 2 >= latin_count


def _is_english_generated_media_prompt(value: str) -> bool:
    text = str(value or "")
    japanese_count = len(re.findall(r"[\u3040-\u30ff\u3400-\u9fff]", text))
    latin_count = len(re.findall(r"[A-Za-z]", text))
    return latin_count >= 10 and latin_count > japanese_count * 2


def _read_generated_media_pixel_size(path: str) -> tuple[int, int] | None:
    try:
        with Path(path).expanduser().open("rb") as file:
            header = file.read(64)
            if header.startswith(b"\x89PNG\r\n\x1a\n") and header[12:16] == b"IHDR":
                return struct.unpack(">II", header[16:24])
            if header.startswith(b"\xff\xd8"):
                file.seek(2)
                while True:
                    marker_start = file.read(1)
                    if not marker_start:
                        return None
                    if marker_start != b"\xff":
                        continue
                    marker = file.read(1)
                    while marker == b"\xff":
                        marker = file.read(1)
                    if marker in {b"\xd8", b"\xd9"}:
                        continue
                    length_bytes = file.read(2)
                    if len(length_bytes) != 2:
                        return None
                    length = struct.unpack(">H", length_bytes)[0]
                    if length < 2:
                        return None
                    if marker and marker[0] in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                        segment = file.read(length - 2)
                        if len(segment) < 5:
                            return None
                        height, width = struct.unpack(">HH", segment[1:5])
                        return (width, height)
                    file.seek(length - 2, os.SEEK_CUR)
            if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
                chunk = header[12:16]
                if chunk == b"VP8X" and len(header) >= 30:
                    width = int.from_bytes(header[24:27], "little") + 1
                    height = int.from_bytes(header[27:30], "little") + 1
                    return (width, height)
                if chunk == b"VP8L" and len(header) >= 25:
                    bits = int.from_bytes(header[21:25], "little")
                    width = (bits & 0x3FFF) + 1
                    height = ((bits >> 14) & 0x3FFF) + 1
                    return (width, height)
                if chunk == b"VP8 " and len(header) >= 30:
                    width = struct.unpack("<H", header[26:28])[0] & 0x3FFF
                    height = struct.unpack("<H", header[28:30])[0] & 0x3FFF
                    return (width, height)
    except OSError:
        return None
    return None


def _generated_media_square_size_blockers(row: QueueRow, paths: list[str]) -> list[str]:
    text = " ".join([row.reference_media_notes, row.reference_media_urls, row.media_plan]).lower()
    sizes = re.findall(r"(?:size\s*=\s*)?(\d{3,4})\s*[x×]\s*(\d{3,4})", text)
    if any(width != height for width, height in sizes):
        return ["surface_missing: generated_media_not_square"]
    pixel_sizes = [_read_generated_media_pixel_size(path) for path in paths]
    if any(size is None for size in pixel_sizes):
        return ["surface_missing: generated_media_pixel_size_unreadable"]
    if any(width != height for width, height in (size for size in pixel_sizes if size is not None)):
        return ["surface_missing: generated_media_not_square"]
    return []


def _surface_contract_label(row: QueueRow, platform: str) -> str:
    directive_text = " ".join(
        part
        for part in [
            row.content_format,
            row.publish_strategy,
            row.media_plan,
        ]
        if part
    ).lower()
    media_plan_text = row.media_plan.lower()
    if platform == "x":
        if POSTING_SURFACE_LABELS["x_quote_interpretation_card"].lower() in directive_text:
            return "x_quote_interpretation_card"
        if POSTING_SURFACE_LABELS["x_self_made_decision_card"].lower() in directive_text:
            return "x_self_made_decision_card"
        if "引用カード + 自作日本語画像" in row.media_plan:
            return "x_quote_interpretation_card"
        if (
            "source/link card" in directive_text
            or "ソース/リンクカード" in row.media_plan
            or "xリンクカード" in directive_text
            or "x link card" in directive_text
            or "source card" in directive_text
        ):
            return "x_source_link_card"
        if POSTING_SURFACE_LABELS["x_text_url"].lower() in directive_text or "x本文url型" in directive_text or "x本文+url" in directive_text:
            return "x_text_url"
        no_self_made_media = any(
            token in row.media_plan
            for token in ("自作画像なし", "自作画像無し", "自作画像より公式カード", "自作画像より")
        )
        if (
            "self_made_summary_card" in directive_text
            or "自作判断カード" in row.media_plan
            or ("自作画像" in row.media_plan and not no_self_made_media)
        ):
            return "x_self_made_decision_card"
        if row.content_format in {"native_quote_business_translation", "official_quote", "quote_repost_commentary"}:
            return "x_quote_interpretation_card"
        return ""

    linkedin_link_card_forbidden = _linkedin_link_card_is_forbidden(row.media_plan)
    explicit_linkedin_keys = ["linkedin_carousel", "linkedin_square_image"]
    if not linkedin_link_card_forbidden:
        explicit_linkedin_keys.append("linkedin_link_card")
    explicit_linkedin_labels = [
        (directive_text.find(POSTING_SURFACE_LABELS[key].lower()), key)
        for key in explicit_linkedin_keys
        if POSTING_SURFACE_LABELS[key].lower() in directive_text
    ]
    if explicit_linkedin_labels:
        return min(explicit_linkedin_labels)[1]
    if "正方形カルーセル" in row.media_plan or re.search(r"\bcarousel\b", media_plan_text):
        return "linkedin_carousel"
    if "正方形の英語画像1枚" in row.media_plan or "square image" in media_plan_text or "square card" in media_plan_text:
        return "linkedin_square_image"
    if _linkedin_link_card_is_requested(row.media_plan):
        return "linkedin_link_card"
    if "画像なしだが強い原投稿" in row.media_plan or "no media with a reason" in media_plan_text:
        return "linkedin_no_media_strong_source"
    return ""


def _linkedin_link_card_is_requested(media_plan: str) -> bool:
    if not media_plan:
        return False
    text = media_plan
    lower_text = text.lower()
    if _linkedin_link_card_is_forbidden(text):
        return False
    if re.search(
        r"LinkedIn[^|。\.\n\r]{0,80}(?:画像型|正方形|カルーセル|photo|image)[^|。\.\n\r]{0,80}リンクカード[^|。\.\n\r]{0,40}(?:Xのみ|x only|for X only)",
        text,
        re.IGNORECASE,
    ):
        return False
    if re.search(
        r"\blinkedin\b[^|。\.\n\r]{0,80}(?:photo|image|square|carousel|image surface)[^|。\.\n\r]{0,80}link card[^|。\.\n\r]{0,40}(?:x only|for x only)",
        lower_text,
        re.IGNORECASE,
    ):
        return False
    if re.search(r"\blinkedin\b[^|。\.\n\r]{0,80}(?:source/link card|link card)", lower_text, re.IGNORECASE):
        return True
    return bool(
        re.search(
            r"LinkedIn[^|。\.\n\r]{0,80}(?:ソース|公式|URL|リンク)?[^|。\.\n\r]{0,80}リンクカード",
            text,
            re.IGNORECASE,
        )
    )


def _linkedin_link_card_is_forbidden(media_plan: str) -> bool:
    return bool(
        re.search(
            r"LinkedIn(?:リンクカード型|[^|。\.\n\r]{0,80}リンクカード)[^|。\.\n\r]{0,40}(?:使わない|使用しない|避ける|不可|禁止|not use|avoid)",
            media_plan,
            re.IGNORECASE,
        )
    )


def _explicit_surface_label_conflicts(row: QueueRow, platform: str) -> bool:
    directive_text = " ".join(
        part
        for part in [
            row.content_format,
            row.publish_strategy,
            row.media_plan,
        ]
        if part
    ).lower()
    if platform == "x":
        keys = ("x_quote_interpretation_card", "x_self_made_decision_card", "x_text_url")
    else:
        keys = ("linkedin_carousel", "linkedin_square_image", "linkedin_link_card")
    matches = [key for key in keys if POSTING_SURFACE_LABELS[key].lower() in directive_text]
    return len(matches) > 1


def _generic_opening_blockers(row: QueueRow, platform: str) -> list[str]:
    text = row.x_text if platform == "x" else row.linkedin_text
    first_line = text.strip().splitlines()[0].strip().lower() if text.strip() else ""
    blockers: list[str] = []
    for pattern in GENERIC_OPENING_PATTERNS.get(platform, []):
        if first_line.startswith(pattern.lower()):
            blockers.append(f"voice_template_opening: {platform}_{pattern}")
            break
    return blockers


def _source_url_in_body(row: QueueRow, platform: str) -> bool:
    source_url = row.source_url.strip()
    if not source_url:
        return False
    body = row.x_text if platform == "x" else row.linkedin_text
    return source_url in body


def _is_official_link_card_source_url(url: str) -> bool:
    if not url.strip():
        return False
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme not in {"http", "https"} or not host:
        return False
    return not (
        host == "drive.google.com"
        or host.endswith(".drive.google.com")
        or host == "docs.google.com"
        or host.endswith(".docs.google.com")
    )


def _operation_verification_candidate_blockers(row: QueueRow) -> list[str]:
    row_id = row.id.strip().lower()
    if row_id.startswith(OPERATION_VERIFICATION_ID_PREFIXES) or any(
        token in row_id for token in OPERATION_VERIFICATION_ID_TOKENS
    ):
        return ["surface_missing: operation_verification_candidate"]
    return []


def _surface_contract_blockers(row: QueueRow) -> list[str]:
    blockers: list[str] = []
    blockers.extend(_operation_verification_candidate_blockers(row))
    missing_platforms = _publishable_missing_platforms(row)
    media_plan = row.media_plan.strip()
    if not media_plan:
        blockers.append("surface_missing: media_plan_blank")
        return blockers

    conflicting_platforms = [
        platform
        for platform in missing_platforms
        if _explicit_surface_label_conflicts(row, platform)
    ]
    for platform in conflicting_platforms:
        blockers.append(f"surface_missing: {platform}_surface_label_conflict")

    for platform in missing_platforms:
        blockers.extend(_generic_opening_blockers(row, platform))
        if platform in conflicting_platforms:
            continue
        label = _surface_contract_label(row, platform)
        if not label:
            blockers.append(f"surface_missing: {platform}_surface_label_missing")
            continue

        if label == "x_quote_interpretation_card":
            if not _split_reference_post_urls(row.reference_post_urls):
                blockers.append("quote_card_not_reflected: x_reference_post_url_missing")
            paths = [str(path) for path in _generated_media_paths_for_platform(row, "x")]
            if not paths:
                blockers.append("surface_missing: x_generated_interpretation_card_missing")
            else:
                blockers.extend(_selected_generated_media_quality_blockers(row, paths[:1]))
                blockers.extend(_fresh_generated_media_blockers(row, paths[:1]))
                blockers.extend(_selected_generated_media_receipt_blockers(row, "x", paths[:1]))
                blockers.extend(_generated_media_square_size_blockers(row, paths[:1]))
        elif label == "x_self_made_decision_card":
            paths = [str(path) for path in _generated_media_paths_for_platform(row, "x")]
            if not paths:
                blockers.append("surface_missing: x_generated_decision_card_missing")
            else:
                blockers.extend(_selected_generated_media_quality_blockers(row, paths[:1]))
                blockers.extend(_fresh_generated_media_blockers(row, paths[:1]))
                blockers.extend(_selected_generated_media_receipt_blockers(row, "x", paths[:1]))
                blockers.extend(_generated_media_square_size_blockers(row, paths[:1]))
        elif label == "linkedin_carousel":
            paths = [str(path) for path in _generated_media_paths_for_platform(row, "linkedin")]
            if len(paths) < 3:
                blockers.append("surface_missing: linkedin_carousel_requires_3_generated_images")
            else:
                blockers.extend(_selected_generated_media_quality_blockers(row, paths[:3]))
                blockers.extend(_fresh_generated_media_blockers(row, paths[:3]))
                blockers.extend(_selected_generated_media_receipt_blockers(row, "linkedin", paths[:3]))
                blockers.extend(_generated_media_square_size_blockers(row, paths[:3]))
        elif label == "linkedin_square_image":
            paths = [str(path) for path in _generated_media_paths_for_platform(row, "linkedin")]
            if not paths:
                blockers.append("surface_missing: linkedin_generated_square_image_missing")
            else:
                blockers.extend(_selected_generated_media_quality_blockers(row, paths[:1]))
                blockers.extend(_fresh_generated_media_blockers(row, paths[:1]))
                blockers.extend(_selected_generated_media_receipt_blockers(row, "linkedin", paths[:1]))
                blockers.extend(_generated_media_square_size_blockers(row, paths[:1]))
        elif label == "linkedin_link_card":
            if not row.source_url.strip():
                blockers.append("link_card_not_reflected: linkedin_source_url_missing")
            elif not _is_official_link_card_source_url(row.source_url):
                blockers.append("link_card_not_reflected: linkedin_official_source_url_missing")
            if row.source_url.strip() and not _source_url_in_body(row, "linkedin"):
                blockers.append("link_card_not_reflected: linkedin_source_url_not_seeded")
        elif label == "x_source_link_card":
            if not row.source_url.strip():
                blockers.append("link_card_not_reflected: x_source_url_missing")
            if row.content_format in X_TEXT_URL_BLOCKED_CONTENT_FORMATS:
                blockers.append(f"surface_missing: x_text_url_not_allowed_for_{row.content_format}")
            if row.source_url.strip() and not _source_url_in_body(row, "x"):
                blockers.append("surface_missing: x_text_url_body_url_missing")
        elif label == "x_text_url":
            if not row.source_url.strip():
                blockers.append("surface_missing: x_text_url_source_url_missing")
            if row.content_format in X_TEXT_URL_BLOCKED_CONTENT_FORMATS:
                blockers.append(f"surface_missing: x_text_url_not_allowed_for_{row.content_format}")
            if row.source_url.strip() and not _source_url_in_body(row, "x"):
                blockers.append("surface_missing: x_text_url_body_url_missing")
    return blockers


def _text_reuse_blockers(row: QueueRow, rows: list[QueueRow]) -> list[str]:
    def text_reuse_key(value: str) -> str:
        without_urls = re.sub(r"https?://\S+", "", value or "")
        return re.sub(r"\s+", " ", without_urls).strip()

    blockers: list[str] = []
    missing_platforms = set(_publishable_missing_platforms(row))
    prior_rows = [candidate for candidate in rows if candidate.id != row.id]
    if "x" in missing_platforms and row.x_text.strip():
        x_text = text_reuse_key(row.x_text)
        if any(text_reuse_key(candidate.x_text) == x_text and bool(candidate.x_post_url or candidate.x_post_id) for candidate in prior_rows):
            blockers.append("voice_reuse: x_text_matches_previous_published_row")
    if "linkedin" in missing_platforms and row.linkedin_text.strip():
        linkedin_text = row.linkedin_text.strip()
        if any(
            candidate.linkedin_text.strip() == linkedin_text
            and bool(candidate.linkedin_post_url or candidate.linkedin_post_id)
            for candidate in prior_rows
        ):
            blockers.append("voice_reuse: linkedin_text_matches_previous_published_row")
    return blockers


def _has_publish_discovery_context(row: QueueRow) -> bool:
    if row.source_type in {"social_discovery", "web_discovery"}:
        return True
    if row.reference_post_urls.strip():
        return True
    if row.reference_account_handles.strip():
        return True
    notes = " ".join(
        part.strip()
        for part in [
            row.research_notes,
            row.x_research_notes,
            row.linkedin_research_notes,
            row.reference_media_notes,
            row.past_post_reference,
        ]
        if part.strip()
    )
    normalized_notes = notes.lower()
    discovery_markers = [
        "daily_discovery_mix",
        "feed study",
        "recommended feed",
        "x/linkedin",
        "x feed",
        "linkedin feed",
        "web/news",
        "news search",
        "cross-search",
        "source_chain",
        "post_shape",
        "influencer",
        "watchlist",
        "x.com/",
        "twitter.com/",
        "linkedin.com/",
    ]
    return (
        row.research_status == "done"
        and bool(row.freshness_checked_at.strip())
        and any(marker in normalized_notes for marker in discovery_markers)
    )


def _discovery_context_blockers(row: QueueRow) -> list[str]:
    if row.source_type != "rss":
        return []
    if _has_publish_discovery_context(row):
        return []
    return ["feed_study_insufficient: missing_daily_discovery_mix"]


def _publish_candidate_blockers(row: QueueRow, rows: list[QueueRow]) -> list[str]:
    blockers = _surface_contract_blockers(row)
    blockers.extend(_text_reuse_blockers(row, rows))
    blockers.extend(_discovery_context_blockers(row))
    return blockers


def _direct_playwright_cli_surface_blockers(row: QueueRow) -> list[str]:
    return []


def _surface_block_next_action(row: QueueRow, blockers: list[str]) -> str:
    labels = ", ".join(POSTING_SURFACE_LABELS.values())
    return (
        "Hold before publishing: posting surface is not ready. "
        f"Blockers: {'; '.join(blockers)}. "
        f"Choose one named surface ({labels}), create required Runway MCP `gpt-image-2` media under "
        "artifacts/generated-media when the type needs images, make it a high-impact source-specific visual rather than a generic white text card, record file paths/model/size/prompt in reference_media_notes, "
        "and only then publish via the Chrome plugin registered runner after quote/link card or media attachment reflection, tab/window recording, and local proof gates are visible. "
        "Do not degrade to URL + text only."
    )


def _hold_surface_blocked_publish_rows(rows: list[QueueRow]) -> int:
    held = 0
    for row in rows:
        _seed_source_url_for_link_surfaces(row)
        if not _has_publishable_missing_target(row):
            continue
        if row.status == "partially_published":
            if _effective_keep_priority(row) == "drop":
                continue
        elif _quality_score_value(row) < 10:
            continue
        elif _effective_keep_priority(row) != "ship_now":
            continue
        elif row.status == "scheduled":
            if not (_is_due(row) or row.review_status == "ready_morning"):
                continue
        elif row.status not in {"approved", "drafted"}:
            continue
        blockers = _publish_candidate_blockers(row, rows)
        if not blockers:
            continue
        row.status = "drafted"
        row.review_status = "hold"
        existing_notes = [part.strip() for part in row.review_notes.split("|") if part.strip()]
        note = "Surface contract incomplete before publish"
        if note not in existing_notes:
            existing_notes.append(note)
        row.review_notes = " | ".join(existing_notes)
        row.next_action = _surface_block_next_action(row, blockers)
        row.error = "; ".join(blockers)
        held += 1
    return held


def _ensure_can_attempt_external_publish(row: QueueRow, platform: str, *, dry_run: bool) -> None:
    if dry_run:
        return
    if _has_no_repost_marker_for_platform(row, platform):
        raise typer.BadParameter(
            f"{row.id} is marked Do not repost. Capture or verify the existing {platform} URL before publishing again."
        )


def _ensure_live_chrome_publish_explicitly_allowed(platform: str, *, dry_run: bool, allowed: bool) -> None:
    if dry_run or allowed:
        return
    raise typer.BadParameter(
        f"{platform} live Chrome publishing requires --allow-live-chrome-publish "
        "or the legacy --allow-fallback-publish flag."
    )


def _raise_legacy_foreground_chrome_disabled(platform: str) -> None:
    raise typer.BadParameter(
        f"{platform} legacy foreground Chrome publishing is disabled in Soy-safe mode. "
        "Use the Chrome plugin registered runner only, after strict account, body, submit, capture, recording, and local proof gates pass. "
        "If Chrome plugin surface is unavailable, stop external posting with chrome_extension_required."
    )


def _normalize_profile2_extension_lane(lane: dict[str, object]) -> dict[str, object]:
    """Treat resolver compatibility names as the single Profile 2 Extension lane."""
    if lane.get("lane") == "stop":
        return lane
    legacy_lane = str(lane.get("lane") or "")
    normalized = {
        **lane,
        "lane": "chrome_extension_profile2_fallback",
        "browser_lane_used": "chrome_extension_profile2_fallback",
        "fallback_allowed": True,
        "stop_reason": "",
        "profile_label": "Chrome Extension Profile 2",
        "profile_directory": "Profile 2",
        "must_run": (
            "Use the Chrome plugin registered runner as the only production browser lane. "
            "Resolver compatibility names are diagnostic-only and must not start Chrome Extension/Profile 2, Playwright, or Nicky."
        ),
    }
    if legacy_lane and legacy_lane != "chrome_extension_profile2_fallback":
        normalized["legacy_lane"] = legacy_lane
    return normalized


def _chrome_profile_publish_next_action(row: QueueRow) -> str:
    platforms = _publishable_missing_platforms(row)
    linkedin_surface = _surface_contract_label(row, "linkedin") if "linkedin" in platforms else ""
    linkedin_media_surface_instruction = (
        "For LinkedIn正方形1枚画像型 / LinkedInカルーセル型, the publish sender must run the no-post Photo/filechooser preflight from a fresh LinkedIn feed page in the same automation context before submit; after that no-post preflight succeeds, the sender may reopen another fresh LinkedIn feed page in the same context before the real upload to reset stale Photo/filechooser/editor state. Use `social-flow preflight-linkedin-media-upload-local <absolute-image-path> --json` only for standalone diagnosis or candidate prep outside the live sender. "
        "Do not use shareActive=true or Start a post as the media upload entry. "
        "Open the LinkedIn feed, arm page.waitForEvent('filechooser') / page.expect_file_chooser() first, click the feed Photo/写真 div[role=button], "
        "then call fileChooser.setFiles([...absolutePaths]) / file_chooser.set_files([...absolute_paths]); if LinkedIn materializes input[type=file] after Photo, setInputFiles on that tab is also acceptable. "
        "Verify the LinkedIn Editor preview shows 1 of 1 or 1 of N and Next before adding body text; "
        "if Photo route, file chooser, or Editor preview is missing, stop with media_upload_permission_blocked:linkedin_photo_route_unavailable or surface_missing:linkedin_photo_editor_preview_missing. "
    )
    fallback_instruction = (
        "Use the Chrome plugin registered runner as the production publish lane. "
        "Proceed only when the runner verifies the isolated authenticated CLI lane, expected account, body/link-card or media reflection, enabled submit, URL/completion capture, tab/window recording, and local video/Record-Replay proof gates. "
        "If the Chrome plugin registered runner, auth/profile lane, recording, or local proof gate is unavailable, stop with chrome_extension_required, chrome_extension_required, or chrome_extension_required and continue only safe local queue / service-account Sheets work. "
        "Do not use Soy, Chrome Profile 2, Chrome Extension/Profile 2, Browser Use-native, Playwright MCP, Codex in-app Browser, Nicky automation profile, open-automation-chrome, foreground fallback, OS clipboard/keyboard, or coordinate clicks unless the user explicitly requests rollback. "
        "Do not post when previews collapse to body-only variants. "
        "Record surface_missing, media_upload_permission_blocked, quote_card_not_reflected, or link_card_not_reflected when the required visible surface is missing. "
        "Stop with unsupported_surface_or_playwright_cli_gate_failed when the Chrome plugin route cannot satisfy the mechanical gates."
    )
    surface_instruction = (
        "Treat content_format, publish_strategy, and media_plan as the visible posting-surface contract; "
        "if quote card, source/link card, image, or carousel is required but not reflected, stop with media_upload_permission_blocked, "
        "quote_card_not_reflected, link_card_not_reflected, or surface_missing instead of degrading to text-only. "
        "If generated media looks like a generic white text card, demo-like, too weak, or cropped in the LinkedIn preview, stop with surface_missing: generated_media_low_impact or surface_missing: generated_media_cropped_in_preview. "
        "For image or carousel uploads, do not leave an OS Finder file picker open; use the Chrome plugin-controlled target tab's file chooser path. "
        "Arm waitForEvent('filechooser') before clicking Photo / Add media / attach, then call fileChooser.setFiles([...absolutePaths]); never click first and wait afterward. "
        "Stop with media_upload_permission_blocked / surface_missing if the upload cannot complete inside automation. "
        "Use plain text plus URL only when media_plan explicitly says X本文+URL型 and source_url is present; "
        "LinkedIn URL-based posts must use LinkedInリンクカード型 with the official link preview visible."
    )
    x_publish_hint = "Publish X"
    if row.content_format == "native_quote_business_translation" and "x" in platforms:
        x_publish_hint = "Publish X as native quote business translation"
    if row.content_format == "official_demo_breakdown" and "x" in platforms:
        x_publish_hint = "Publish X as official demo breakdown"
    if row.content_format == "market_signal_visual" and "x" in platforms:
        x_publish_hint = "Publish X as market signal visual"
    if row.content_format == "self_made_summary_card" and "x" in platforms:
        x_publish_hint = "Publish X as self-made summary card"
    if platforms == ["x"]:
        return (
            f"{x_publish_hint} via Chrome plugin registered runner after expected-account, recording, and local proof checks. "
            + surface_instruction
            + " "
            + fallback_instruction
        )
    if platforms == ["linkedin"]:
        linkedin_entry_instruction = (
            linkedin_media_surface_instruction
            if linkedin_surface in {"linkedin_square_image", "linkedin_carousel"}
            else "Seed shareActive=true with encoded linkedin_text before clicking Start a post when useful; use this route for LinkedInリンクカード型 / text-link surfaces only, not media upload entry; "
        )
        return (
            "Publish LinkedIn as an original post via Chrome plugin registered runner after expected-account, recording, and local proof checks. "
            + linkedin_entry_instruction
            + surface_instruction
            + " "
            + fallback_instruction
        )
    linkedin_dual_instruction = (
        linkedin_media_surface_instruction
        if linkedin_surface in {"linkedin_square_image", "linkedin_carousel"}
        else "For LinkedIn, seed shareActive=true with encoded linkedin_text before clicking Start a post only for LinkedInリンクカード型 / text-link surfaces; do not use it as a media upload entry; "
    )
    return (
        f"{x_publish_hint} and publish LinkedIn as an original post via Chrome plugin registered runner after expected-account, recording, and local proof checks. "
        + linkedin_dual_instruction
        + surface_instruction
        + " "
        + fallback_instruction
    )


def _append_run_summary(
    sheets_repo: SheetsRepository | None,
    *,
    researched_count: int,
    feed_study_count: int = 0,
    external_posts_read: int = 0,
    feed_research_receipt: str = "",
    refreshed_count: int = 0,
    selected_count: int = 0,
    posted_count: int = 0,
    quoted_count: int = 0,
    engagement_candidates_created: int = 0,
    external_engagement_candidates: int = 0,
    own_post_engagement_candidates: int = 0,
    media_receipt: str = "",
    sheets_synced_count: int = 0,
    stop_reason: str = "",
    ship_now_buffer_count: int | str = "",
    ship_now_buffer_refreshed_count: int | str = "",
    usable_publish_candidate_count: int | str = "",
) -> None:
    if sheets_repo is None:
        return
    sheets_repo.append_run_summary(
        run_at=utc_now(),
        researched_count=researched_count,
        feed_study_count=feed_study_count,
        external_posts_read=external_posts_read,
        feed_research_receipt=feed_research_receipt,
        refreshed_count=refreshed_count,
        selected_count=selected_count,
        posted_count=posted_count,
        quoted_count=quoted_count,
        engagement_candidates_created=engagement_candidates_created,
        external_engagement_candidates=external_engagement_candidates,
        own_post_engagement_candidates=own_post_engagement_candidates,
        media_receipt=_append_automation_failure_category(stop_reason, media_receipt),
        sheets_synced_count=sheets_synced_count,
        stop_reason=stop_reason,
        ship_now_buffer_count=ship_now_buffer_count,
        ship_now_buffer_refreshed_count=ship_now_buffer_refreshed_count,
        usable_publish_candidate_count=usable_publish_candidate_count,
    )


def _should_record_run_summary(
    *,
    researched_count: int,
    feed_study_count: int = 0,
    external_posts_read: int = 0,
    feed_research_receipt: str = "",
    refreshed_count: int = 0,
    selected_count: int = 0,
    posted_count: int = 0,
    quoted_count: int = 0,
    engagement_candidates_created: int = 0,
    external_engagement_candidates: int = 0,
    own_post_engagement_candidates: int = 0,
    media_receipt: str = "",
    sheets_synced_count: int = 0,
    stop_reason: str = "",
) -> bool:
    return any(
        [
            researched_count,
            feed_study_count,
            external_posts_read,
            feed_research_receipt.strip(),
            refreshed_count,
            posted_count,
            quoted_count,
            engagement_candidates_created,
            external_engagement_candidates,
            own_post_engagement_candidates,
            media_receipt.strip(),
            stop_reason.strip(),
        ]
    )


def _append_local_run_summary(
    *,
    run_at: str,
    researched_count: int,
    feed_study_count: int = 0,
    external_posts_read: int = 0,
    feed_research_receipt: str = "",
    refreshed_count: int = 0,
    selected_count: int = 0,
    posted_count: int = 0,
    quoted_count: int = 0,
    engagement_candidates_created: int = 0,
    external_engagement_candidates: int = 0,
    own_post_engagement_candidates: int = 0,
    media_receipt: str = "",
    sheets_synced_count: int = 0,
    stop_reason: str = "",
    path: str = "posting_queue.tsv",
    ship_now_buffer_count: int | None = None,
    ship_now_buffer_refreshed_count: int | None = None,
    usable_publish_candidate_count: int | None = None,
    automation_health: dict[str, str] | None = None,
) -> Path:
    summary_path = Path("artifacts/run-summaries/daily-ai-run-summary.jsonl")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "run_at": run_at,
        "researched_count": researched_count,
        "feed_study_count": feed_study_count,
        "external_posts_read": external_posts_read,
        "feed_research_receipt": feed_research_receipt,
        "refreshed_count": refreshed_count,
        "selected_count": selected_count,
        "posted_count": posted_count,
        "quoted_count": quoted_count,
        "engagement_candidates_created": engagement_candidates_created,
        "external_engagement_candidates": external_engagement_candidates,
        "own_post_engagement_candidates": own_post_engagement_candidates,
        "media_receipt": _append_automation_failure_category(stop_reason, media_receipt),
        "sheets_synced_count": sheets_synced_count,
        "stop_reason": stop_reason,
        "queue_path": path,
    }
    if automation_health:
        payload["automation_health"] = automation_health
    if ship_now_buffer_count is not None:
        payload["ship_now_buffer_count"] = ship_now_buffer_count
    if ship_now_buffer_refreshed_count is not None:
        payload["ship_now_buffer_refreshed_count"] = ship_now_buffer_refreshed_count
    if usable_publish_candidate_count is not None:
        payload["usable_publish_candidate_count"] = usable_publish_candidate_count
    encoded_payload = json.dumps(payload, ensure_ascii=True)
    if summary_path.exists():
        try:
            last_line = next(
                (line.strip() for line in reversed(summary_path.read_text(encoding="utf-8").splitlines()) if line.strip()),
                "",
            )
        except OSError:
            last_line = ""
        if last_line == encoded_payload:
            return summary_path
    with summary_path.open("a", encoding="utf-8") as handle:
        handle.write(encoded_payload + "\n")
    return summary_path


def _latest_local_daily_ai_stop_reason() -> str:
    summary_path = Path("artifacts/run-summaries/daily-ai-run-summary.jsonl")
    if not summary_path.exists():
        return ""
    try:
        lines = summary_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    for line in reversed(lines):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        return str(payload.get("stop_reason") or "").strip()
    return ""


def _has_post_publish_engagement_target(rows: list[QueueRow]) -> bool:
    return any(
        row.status == "published"
        and not row.engagement_status.strip()
        and (row.x_post_url.strip() or row.linkedin_post_url.strip())
        for row in rows
    )


def _first_engagement_target(row: QueueRow) -> str:
    raw = row.engagement_targets.strip()
    if not raw:
        return ""
    parts = re.split(r"[\n,|]+", raw)
    return next((part.strip() for part in parts if part.strip()), "")


def _engagement_platform(target_url: str) -> str:
    lowered = target_url.lower()
    if "x.com/" in lowered or "twitter.com/" in lowered:
        return "x"
    if "linkedin.com/" in lowered:
        return "linkedin"
    return ""


def _parse_datetime(value: str) -> datetime | None:
    raw = value.strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _is_recent_timestamp(value: str, *, now: datetime | None = None, max_age_hours: int = 24) -> bool:
    parsed = _parse_datetime(value)
    if parsed is None:
        return False
    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    reference = reference.astimezone(timezone.utc)
    return parsed >= reference - timedelta(hours=max_age_hours)


def _has_fresh_engagement_research(
    row: QueueRow,
    *,
    now: datetime | None = None,
    max_age_hours: int = 24,
) -> bool:
    return _is_recent_timestamp(row.freshness_checked_at, now=now, max_age_hours=max_age_hours)


def _expire_stale_engagement_candidates(
    rows: list[QueueRow],
    *,
    now: datetime | None = None,
    max_age_hours: int = 24,
) -> int:
    expired = 0
    for row in rows:
        if row.engagement_status != "approved":
            continue
        if _has_fresh_engagement_research(row, now=now, max_age_hours=max_age_hours):
            continue
        _mark_engagement_result(
            row,
            status="skipped",
            note=(
                f"{utc_now()}: stale approved engagement candidate held before auto-engagement; "
                "fresh feed-study readback is required before sending."
            ),
        )
        row.error = "engagement_failed: stale_engagement_candidate_requires_fresh_read"
        row.next_action = "Refresh feed-study evidence before retrying auto-engagement."
        expired += 1
    return expired


def _run_x_engagement(
    publisher: XPublisher,
    *,
    action: str,
    target_url: str,
    comment: str,
) -> dict[str, str]:
    tweet_id = extract_x_post_id(target_url)
    if not tweet_id:
        raise ValueError("Could not extract X post id from engagement target.")
    if action == "like_candidate":
        return publisher.like(tweet_id)
    if action == "save_candidate":
        raise ValueError("save_candidate requires local browser-lane engagement, not X API engagement.")
    if action in {"comment_candidate", "reply_to_own_post"}:
        if not comment.strip():
            raise ValueError("comment_draft is required for X comment/reply engagement.")
        return publisher.reply(tweet_id, comment)
    if action == "quote_candidate":
        if not comment.strip():
            raise ValueError("comment_draft is required for X quote engagement.")
        return publisher.quote(tweet_id, comment)
    raise ValueError(f"Unsupported X engagement action: {action}")


def _run_linkedin_engagement(
    publisher: LinkedInPublisher,
    *,
    action: str,
    target_url: str,
    comment: str,
) -> dict[str, str]:
    target_urn = extract_linkedin_post_id(target_url)
    if not target_urn:
        raise ValueError("Could not extract LinkedIn post urn from engagement target.")
    if action == "like_candidate":
        return publisher.like(target_urn)
    if action == "save_candidate":
        raise ValueError("save_candidate requires local browser-lane engagement, not LinkedIn API engagement.")
    if action in {"comment_candidate", "reply_to_own_post"}:
        if not comment.strip():
            raise ValueError("comment_draft is required for LinkedIn comment/reply engagement.")
        return publisher.comment(target_urn, comment)
    raise ValueError(f"Unsupported LinkedIn engagement action: {action}")


def _mark_engagement_result(row: QueueRow, *, status: str, note: str) -> None:
    row.engagement_status = status
    notes = [part.strip() for part in row.review_notes.split("|") if part.strip()]
    notes.append(note)
    row.review_notes = " | ".join(notes)
    if status == "done":
        row.engaged_at = utc_now()
        row.next_action = "Engagement sent; monitor replies and metrics."
    else:
        row.next_action = "Review engagement blocker before retrying auto-engagement."


def _engagement_sent_receipt_path(row: QueueRow, *, target_url: str, action: str) -> Path:
    key = "|".join([row.id, target_url, action])
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    return Path("artifacts/engagement-sent-receipts") / f"{digest}.json"


def _write_engagement_sent_receipt(
    row: QueueRow,
    *,
    target_url: str,
    action: str,
    result: dict[str, str],
) -> Path:
    receipt_path = _engagement_sent_receipt_path(row, target_url=target_url, action=action)
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "sent_at": utc_now(),
        "queue_id": row.id,
        "target_url": target_url,
        "action": action,
        "platform": result.get("platform", _engagement_platform(target_url)),
        "completion": result.get("completion", ""),
        "result_url": result.get("url", target_url),
        "comment_proof": result.get("comment_proof") or result.get("commentProof") or {},
        "like_proof": result.get("like_proof") or result.get("likeProof") or {},
        "queue_status_update": "pending",
    }
    receipt_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return receipt_path


def _confirm_engagement_sent_receipt(receipt_path: Path) -> None:
    try:
        payload = json.loads(receipt_path.read_text(encoding="utf-8"))
    except Exception:
        return
    payload["queue_status_update"] = "confirmed"
    payload["confirmed_at"] = utc_now()
    receipt_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _is_verified_engagement_sent_receipt(payload: dict[str, object]) -> bool:
    platform = str(payload.get("platform") or "").strip().lower()
    completion = str(payload.get("completion") or "").strip()
    result_url = str(payload.get("result_url") or payload.get("target_url") or "").strip()
    if platform == "x":
        if completion == "comment_post_url_captured":
            return bool(re.search(r"https://(?:x|twitter)\.com/[^/]+/status/[0-9]+", result_url, re.IGNORECASE))
        return completion in {"like_reflected", "bookmark_reflected"}
    if platform == "linkedin":
        if completion == "comment_reflected":
            proof = payload.get("comment_proof") or payload.get("commentProof") or {}
            return (
                isinstance(proof, dict)
                and str(proof.get("source") or "") == "body_after_submit"
                and bool(proof.get("editor_cleared") or proof.get("editorCleared"))
                and bool(proof.get("posted_comment_visible") or proof.get("postedCommentVisible"))
                and not bool(proof.get("visible_before_submit") or proof.get("visibleBeforeSubmit"))
                and "linkedin.com" in result_url.lower()
            )
        proof = payload.get("like_proof") or payload.get("likeProof") or {}
        proof_url = str(proof.get("target_url") or proof.get("targetUrl") or "") if isinstance(proof, dict) else ""
        proof_reflected = bool(proof.get("reflected") or proof.get("state_changed") or proof.get("stateChanged")) if isinstance(proof, dict) else False
        return completion == "like_reflected" and proof_reflected and "linkedin.com" in (result_url + proof_url).lower()
    return False


def _recover_engagement_sent_receipts(rows: list[QueueRow], repo: LocalQueueRepository) -> int:
    recovered = 0
    for row in rows:
        if row.engagement_status != "approved":
            continue
        target_url = _first_engagement_target(row)
        action = row.engagement_action.strip()
        if not target_url or not action:
            continue
        receipt_path = _engagement_sent_receipt_path(row, target_url=target_url, action=action)
        if not receipt_path.exists():
            continue
        try:
            receipt_payload = json.loads(receipt_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if receipt_payload.get("queue_status_update") != "pending":
            continue
        if not _is_verified_engagement_sent_receipt(receipt_payload):
            continue
        _mark_engagement_result(
            row,
            status="done",
            note=f"{utc_now()}: recovered sent engagement from durable receipt {receipt_path}.",
        )
        row.error = ""
        try:
            repo.update(row)
        except Exception as exc:
            typer.echo(f"Engagement receipt recovery could not update queue. id={row.id} receipt={receipt_path} error={exc}")
        recovered += 1
    return recovered


def _visible_enabled_button(locator):
    count = locator.count()
    for index in range(count):
        candidate = locator.nth(index)
        try:
            if candidate.is_visible(timeout=1000) and candidate.is_enabled(timeout=1000):
                return candidate
        except Exception:
            continue
    raise RuntimeError("disabled_submit: no visible enabled engagement submit button found.")


def _visible_enabled_linkedin_post_button(page, editor=None):
    roots = []
    if editor is not None:
        try:
            dialog = page.locator('[role="dialog"]').filter(has=editor).last
            if dialog.count():
                roots.append(dialog)
        except Exception:
            pass
        for selector in (".artdeco-modal", ".share-box", ".share-creation-state"):
            try:
                root = page.locator(selector).filter(has=editor).last
                if root.count():
                    roots.append(root)
            except Exception:
                pass
    if not roots:
        roots.append(_linkedin_latest_composer_root(page))
    selectors = [
        'button[aria-label="Post"]',
        'button:has-text("Post")',
        'button[aria-label="投稿"]',
        'button:has-text("投稿")',
    ]
    for root in roots:
        if root is None:
            continue
        for selector in selectors:
            locator = root.locator(selector)
            for index in range(locator.count()):
                candidate = locator.nth(index)
                try:
                    labels = [
                        (candidate.get_attribute("aria-label") or "").strip(),
                        _locator_text(candidate).strip(),
                    ]
                    if not any(re.search(r"^(Post|投稿)$", label, flags=re.IGNORECASE) for label in labels if label):
                        continue
                    if candidate.get_attribute("aria-expanded"):
                        continue
                    if candidate.is_visible(timeout=1000) and candidate.is_enabled(timeout=1000):
                        return candidate
                except Exception:
                    continue
    raise RuntimeError("disabled_submit: LinkedIn Post button was not visible or enabled in the active composer.")


def _linkedin_latest_composer_root(page):
    roots = page.locator('[role="dialog"], .artdeco-modal, .share-box, .share-creation-state')
    for index in range(roots.count() - 1, -1, -1):
        root = roots.nth(index)
        try:
            if not root.is_visible(timeout=800):
                continue
            text = _locator_text(root)
            if re.search(r"Feed post|Sort by|Recommended for you|Promoted", text, flags=re.IGNORECASE):
                continue
            if root.locator('[contenteditable="true"], .ql-editor').count() or re.search(
                r"Start a post|投稿を開始|Post|投稿", text, flags=re.IGNORECASE
            ):
                return root
        except Exception:
            continue
    return None


def _locator_text(locator) -> str:
    try:
        return re.sub(r"\s+", " ", locator.inner_text(timeout=3000)).strip()
    except Exception:
        return ""


def _contains_linkedin_body_readback(readback: str, body: str) -> bool:
    normalized_readback = re.sub(r"\s+", " ", (readback or "").replace("\u00a0", " ")).strip()
    normalized_body = re.sub(r"\s+", " ", (body or "").replace("\u00a0", " ")).strip()
    if not normalized_body:
        return False
    prefix = normalized_body[: min(80, len(normalized_body))]
    if prefix and prefix in normalized_readback:
        return True
    return normalized_body.replace(" ", "")[:80] in normalized_readback.replace(" ", "")


def _verify_x_browser_account(page, expected_handle: str) -> None:
    expected = expected_handle.strip().lstrip("@")
    if not expected:
        raise RuntimeError("account_not_verified: X_EXPECTED_HANDLE is required for X engagement.")
    account_state = page.evaluate(
        """(expected) => {
          const normalize = (value) => String(value || '').toLowerCase();
          const needle = normalize(expected).replace(/^@/, '');
          const matchesHandleHref = (href) => {
            try {
              const url = new URL(String(href || ''), location.href);
              return url.hostname.replace(/^www\\./, '') === 'x.com' && url.pathname.replace(/^\\//, '').toLowerCase() === needle;
            } catch (_) {
              return false;
            }
          };
          const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
          if (profileLink && matchesHandleHref(profileLink.href || profileLink.getAttribute('href'))) {
            return {ok: true, method: 'app_tab_profile_link', profileHref: profileLink.href || profileLink.getAttribute('href') || ''};
          }
          const accountNodes = Array.from(document.querySelectorAll(
            '[data-testid="SideNav_AccountSwitcher_Button"], [aria-label*="Account menu"], [aria-label*="アカウント"], [data-testid*="Account"]'
          ));
          const accountTextMatch = accountNodes.find((node) => {
            const text = normalize(`${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`);
            return text.includes('@' + needle);
          });
          if (accountTextMatch) {
            return {ok: true, method: 'account_switcher_text', profileHref: ''};
          }
          const ownProfileButton = Array.from(document.querySelectorAll('a, button, div[role="button"]')).find((node) => {
            const text = normalize(`${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`);
            return /edit profile|プロフィールを編集/.test(text);
          });
          if (ownProfileButton && normalize(location.pathname).replace(/^\\//, '') === needle) {
            return {ok: true, method: 'own_profile_edit_button', profileHref: String(location.href || '')};
          }
          return {
            ok: false,
            method: '',
            profileHref: '',
            currentUrl: String(location.href || ''),
          };
        }""",
        expected,
    )
    if not account_state.get("ok"):
        try:
            page.goto(f"https://x.com/{expected}", wait_until="domcontentloaded", timeout=8000)
            page.wait_for_timeout(2000)
            account_state = page.evaluate(
                """(expected) => {
                  const normalize = (value) => String(value || '').toLowerCase();
                  const needle = normalize(expected).replace(/^@/, '');
                  const path = normalize(location.pathname).replace(/^\\//, '').split('/')[0];
                  const editProfile = Array.from(document.querySelectorAll('a, button, div[role="button"]')).find((node) => {
                    const text = normalize(`${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`);
                    return /edit profile|プロフィールを編集/.test(text);
                  });
                  return {
                    ok: path === needle && Boolean(editProfile),
                    method: editProfile ? 'own_profile_edit_button_fallback' : '',
                    profileHref: String(location.href || ''),
                    currentUrl: String(location.href || ''),
                  };
                }""",
                expected,
            )
        except Exception:
            pass
    if not account_state.get("ok"):
        raise RuntimeError(f"account_not_verified: expected X @{expected} was not visible in account DOM.")


def _verify_linkedin_browser_account(page) -> None:
    body = page.locator("body").inner_text(timeout=8000)
    if _linkedin_login_required(page, body=body):
        raise RuntimeError("auth_blocked: LinkedIn login required in Chrome Extension Profile 2 lane.")
    if "Nichika Tanaka" in body or "田仲二千" in body:
        return
    me_menu = page.locator('button[aria-label*="Me"], button[aria-label*="自分"], button:has-text("Me")').first
    try:
        if me_menu.is_visible(timeout=3000):
            me_menu.click(timeout=5000)
            page.wait_for_timeout(1000)
            body = page.locator("body").inner_text(timeout=5000)
            if "Nichika Tanaka" in body or "田仲二千" in body:
                return
    except Exception:
        pass
    raise RuntimeError("account_not_verified: LinkedIn expected account was not visible.")


def _linkedin_login_required(page, *, body: str | None = None) -> bool:
    try:
        current_url = str(page.url or "")
    except Exception:
        current_url = ""
    if re.search(r"linkedin\.com/(login|checkpoint|uas/login)", current_url, re.I):
        return True
    text = body
    if text is None:
        try:
            text = page.locator("body").inner_text(timeout=3000)
        except Exception:
            text = ""
    compact = " ".join(str(text or "").split())
    return bool(
        re.search(r"\bWelcome back\b", compact, re.I)
        and re.search(r"\bSign in\b|Forgot password|ログイン|パスワード", compact, re.I)
    )


def _ensure_linkedin_feed_ready(page, *, timeout_seconds: float) -> None:
    page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
    page.wait_for_timeout(2500)
    if _linkedin_login_required(page):
        raise RuntimeError("auth_blocked: LinkedIn login required in Chrome Extension Profile 2 lane.")
    _verify_linkedin_browser_account(page)


def _send_x_browser_engagement(page, *, action: str, comment: str) -> dict[str, str]:
    article = page.locator('article[data-testid="tweet"]').first
    article.wait_for(timeout=15000)
    target_text = _locator_text(article)
    if len(target_text) < 20:
        raise RuntimeError("target_not_verified: X target post body was not readable.")

    if action == "like_candidate":
        like = article.locator('[data-testid="like"]').first
        def like_state() -> str:
            parts: list[str] = []
            for attribute in ("aria-pressed", "aria-label"):
                try:
                    value = like.get_attribute(attribute, timeout=1500)
                except Exception:
                    value = ""
                if value:
                    parts.append(value)
            return " ".join(parts)

        before_state = like_state()
        like.click(timeout=8000)
        page.wait_for_timeout(1500)
        after_state = like_state()
        reflected = article.locator('[data-testid="unlike"]').count() > 0 or "true" in after_state.lower()
        if not reflected and before_state and after_state != before_state:
            reflected = True
        if not reflected:
            raise RuntimeError("like_not_reflected: X like state did not change.")
        return {"url": page.url, "completion": "like_reflected"}

    if action == "save_candidate":
        bookmark = article.locator('[data-testid="bookmark"]').first
        bookmark.click(timeout=8000)
        page.wait_for_timeout(1500)
        if article.locator('[data-testid="removeBookmark"]').count() == 0:
            raise RuntimeError("save_not_reflected: X removeBookmark button did not appear.")
        return {"url": page.url, "completion": "bookmark_reflected"}

    if action in {"comment_candidate", "reply_to_own_post"}:
        if not comment.strip():
            raise RuntimeError("body_not_reflected: comment_draft is required for X comment_candidate.")
        reply_body = _fit_x_reply_body(comment)
        before_status_urls = _x_status_urls_on_page(page)
        target_status_id = extract_x_post_id(str(page.url or ""))
        article.locator('[data-testid="reply"]').first.click(timeout=8000)
        editor = _x_reply_editor(page)
        editor.wait_for(timeout=10000)
        reflected = _set_x_reply_editor_body(editor, reply_body)
        if reply_body.strip() not in reflected:
            raise RuntimeError("body_not_reflected: X reply composer did not contain comment_draft.")
        submit = _visible_enabled_button(page.locator('[data-testid="tweetButton"]'))
        submit.click(timeout=8000)
        try:
            editor.wait_for(state="hidden", timeout=10000)
        except Exception as exc:
            raise RuntimeError("comment_not_reflected: X reply composer stayed open after submit.") from exc
        body = page.locator("body").inner_text(timeout=8000)
        completion = ""
        if reply_body[:30] in body:
            completion = "comment_reflected"
        elif any(marker in body for marker in ("Your post was sent", "Your reply was sent", "ポストを送信しました", "返信を送信しました")):
            completion = "sent_toast"
        if not completion:
            raise RuntimeError("comment_not_reflected: X reply completion was not visible after composer closed.")
        post_url = _capture_new_x_status_url(page, before_status_urls, target_status_id=target_status_id)
        if not post_url:
            raise RuntimeError("comment_not_reflected: X reply status URL was not visible after submit.")
        return {"url": post_url, "completion": "comment_post_url_captured"}

    raise RuntimeError(f"unsupported_browser_engagement_action: {action}")


def _x_status_urls_on_page(page) -> set[str]:
    try:
        raw_urls = page.evaluate(
            """() => Array.from(document.querySelectorAll('a[href*="/status/"]'))
              .map((anchor) => anchor.href)
              .filter(Boolean)"""
        )
    except Exception:
        return set()
    urls: set[str] = set()
    if isinstance(raw_urls, list):
        for raw_url in raw_urls:
            normalized = _normalize_feed_post_url(str(raw_url or ""))
            if re.search(r"https://(?:x|twitter)\.com/[^/]+/status/[0-9]+", normalized, re.I):
                urls.add(normalized)
    return urls


def _capture_new_x_status_url(page, before_urls: set[str], *, target_status_id: str | None = None) -> str:
    target_status_id = target_status_id or ""
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        after_urls = _x_status_urls_on_page(page)
        for url in sorted(after_urls - before_urls, reverse=True):
            status_id = extract_x_post_id(url) or ""
            if status_id and status_id != target_status_id:
                return url
        page.wait_for_timeout(750)
    return ""


def _x_reply_editor(page):
    selectors = [
        '[data-testid="tweetTextarea_0"][role="textbox"]',
        '[data-testid="tweetTextarea_0"][contenteditable="true"]',
        '[role="dialog"] [data-testid="tweetTextarea_0"]',
        '[role="dialog"] div[role="textbox"][contenteditable="true"]',
        '[aria-label*="ポスト本文"][contenteditable="true"]',
        '[aria-label*="Post text"][contenteditable="true"]',
    ]
    return page.locator(", ".join(selectors)).last


def _set_x_reply_editor_body(editor, comment: str) -> str:
    body = comment.strip()
    editor.click(timeout=5000, force=True)
    try:
        editor.press("Meta+A", timeout=3000)
        editor.press("Backspace", timeout=3000)
    except Exception:
        pass
    editor.press_sequentially(body, delay=5, timeout=20000)
    reflected = _locator_text(editor)
    if body in reflected:
        return reflected
    try:
        editor.evaluate(
            """(node, value) => {
                node.focus();
                node.textContent = value;
                node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
            }""",
            body,
        )
    except Exception:
        pass
    return _locator_text(editor)


def _send_linkedin_browser_engagement(page, *, action: str, comment: str) -> dict[str, str]:
    body = page.locator("body").inner_text(timeout=10000)
    if "Feed post" not in body and "Like" not in body and "Comment" not in body:
        raise RuntimeError("target_not_verified: LinkedIn target post body was not readable.")

    if action == "like_candidate":
        like = page.locator(
            'button[aria-label*="Reaction button state"], button[aria-label*="React"], button:has-text("Like")'
        ).first
        try:
            before_state = like.get_attribute("aria-label", timeout=1500) or ""
        except Exception:
            before_state = ""
        before_lower = before_state.lower()
        if before_state and "no reaction" not in before_lower:
            return {
                "url": page.url,
                "completion": "like_reflected",
                "like_proof": {
                    "source": "reaction_state_before_click",
                    "before_state": before_state,
                    "after_state": before_state,
                    "state_changed": False,
                    "reflected": True,
                    "target_url": page.url,
                },
            }
        like.click(timeout=8000)
        page.wait_for_timeout(1500)
        try:
            after_state = like.get_attribute("aria-label", timeout=1500) or ""
        except Exception:
            after_state = ""
        reflected = bool(after_state) and "no reaction" not in after_state.lower() and (not before_state or after_state != before_state)
        if not reflected:
            raise RuntimeError("like_not_reflected: LinkedIn reaction state did not change.")
        return {
            "url": page.url,
            "completion": "like_reflected",
            "like_proof": {
                "source": "reaction_state_after_click",
                "before_state": before_state,
                "after_state": after_state,
                "state_changed": bool(before_state and after_state != before_state),
                "reflected": reflected,
                "target_url": page.url,
            },
        }

    if action == "save_candidate":
        raise RuntimeError("save_candidate requires manual menu-specific LinkedIn browser handling; not sent by generic comment sender.")

    if action in {"comment_candidate", "reply_to_own_post"}:
        if not comment.strip():
            raise RuntimeError("body_not_reflected: comment_draft is required for LinkedIn comment_candidate.")
        comment_prefix = comment[:30]
        visible_before_submit = comment_prefix in body
        comment_button = page.locator('button:has-text("Comment"), button[aria-label*="Comment"]').first
        comment_button.click(timeout=8000)
        editor = page.locator(
            '[contenteditable="true"][role="textbox"], div.ql-editor[contenteditable="true"], div[contenteditable="true"]'
        ).last
        editor.wait_for(timeout=10000)
        editor.click(timeout=5000)
        editor.fill(comment, timeout=10000)
        reflected = _locator_text(editor)
        if comment.strip() not in reflected:
            editor.press_sequentially(comment, delay=5, timeout=20000)
            reflected = _locator_text(editor)
        if comment.strip() not in reflected:
            raise RuntimeError("body_not_reflected: LinkedIn comment editor did not contain comment_draft.")
        submit = _visible_enabled_button(
            page.locator('button:has-text("Post"), button:has-text("Comment"), button[aria-label*="Post"]')
        )
        submit.click(timeout=8000)
        editor_cleared = False
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                if not editor.is_visible(timeout=500) or comment.strip() not in _locator_text(editor):
                    editor_cleared = True
                    break
            except Exception:
                editor_cleared = True
                break
            page.wait_for_timeout(500)
        if not editor_cleared:
            raise RuntimeError("comment_not_reflected: LinkedIn comment editor stayed populated after submit.")
        body_after = page.locator("body").inner_text(timeout=10000)
        completion = "comment_reflected" if comment_prefix in body_after and not visible_before_submit else ""
        if not completion:
            raise RuntimeError("comment_not_reflected: LinkedIn comment completion was not visible after editor cleared.")
        return {
            "url": page.url,
            "completion": completion,
            "comment_proof": {
                "source": "body_after_submit",
                "text_prefix": comment_prefix,
                "editor_cleared": True,
                "posted_comment_visible": True,
                "visible_before_submit": False,
            },
        }

    raise RuntimeError(f"unsupported_browser_engagement_action: {action}")


def _send_browser_engagement_candidate(
    row: QueueRow,
    *,
    settings: Settings,
    remote_debugging_port: int | None = None,
    timeout_seconds: float = 20.0,
    verify_profile_path: bool = True,
) -> dict[str, str]:
    raise RuntimeError(
        "legacy_playwright_engagement_sender_disabled: use the Chrome plugin registered runner "
        "with recording and local proof gates for Daily AI engagement."
    )
    target_url = _first_engagement_target(row)
    platform = _engagement_platform(target_url)
    action = row.engagement_action.strip()
    comment = row.comment_draft.strip()
    if platform not in {"x", "linkedin"}:
        raise RuntimeError("target_not_verified: unsupported or missing engagement target platform.")
    if action in {"comment_candidate", "reply_to_own_post"} and not comment:
        raise RuntimeError("body_not_reflected: comment_draft is required before browser engagement.")

    port = remote_debugging_port or settings.chrome_main_remote_debugging_port
    if _wait_for_chrome_cdp(port, timeout_seconds=min(timeout_seconds, 3.0)) is None:
        raise RuntimeError("local_automation_profile_unavailable: cdp_endpoint_unavailable")

    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        page = context.new_page()
        try:
            if verify_profile_path:
                _verify_main_chrome_profile_path(page, settings, timeout_seconds=timeout_seconds)
            if platform == "x":
                page.goto("https://x.com/home", wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
                _verify_x_browser_account(page, settings.x_expected_handle)
                page.goto(target_url, wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
                page.wait_for_timeout(2500)
                result = _send_x_browser_engagement(page, action=action, comment=comment)
            else:
                page.goto(target_url, wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
                page.wait_for_timeout(3500)
                _verify_linkedin_browser_account(page)
                result = _send_linkedin_browser_engagement(page, action=action, comment=comment)
            result["platform"] = platform
            result["action"] = action
            return result
        except PlaywrightError as exc:
            raise RuntimeError(
                "local_automation_profile_unavailable: locator_control_failed "
                f"{type(exc).__name__}: {' '.join(str(exc).split())[:300]}"
            ) from exc
        finally:
            try:
                page.close()
            except Exception:
                pass


def _normalize_browser_publish_body(text: str) -> str:
    return (
        text.replace("\u2014", "-")
        .replace("\u2013", "-")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .strip()
    )


def _queue_note(row: QueueRow, note: str) -> None:
    parts = [part.strip() for part in row.review_notes.split("|") if part.strip()]
    if note not in parts:
        parts.append(note)
    row.review_notes = " | ".join(parts)


def _candidate_source_url_required(row: QueueRow, platform: str) -> str:
    source_url = row.source_url.strip()
    if not source_url:
        raise RuntimeError(f"source_missing: {platform} publish requires source_url.")
    return source_url


def _body_with_source_url(row: QueueRow, platform: str) -> str:
    body = _normalize_browser_publish_body(row.x_text if platform == "x" else row.linkedin_text)
    source_url = _candidate_source_url_required(row, platform)
    if source_url not in body:
        raise RuntimeError(f"body_not_reflected: {platform} body must include source_url for text/link-card surface.")
    return body


def _x_weighted_length(text: str) -> int:
    return sum(1 if ord(char) <= 0x7F else 2 for char in text or "")


def _x_weighted_length_with_urls(text: str) -> int:
    return _x_weighted_length(re.sub(r"https?://\S+", "x" * 23, text or ""))


def _truncate_x_weighted(text: str, max_weight: int) -> str:
    total = 0
    chars: list[str] = []
    for char in text or "":
        weight = 1 if ord(char) <= 0x7F else 2
        if total + weight > max_weight:
            break
        chars.append(char)
        total += weight
    return "".join(chars).rstrip(" \t\r\n、。,，.．")


def _fit_x_text_url_body(body: str, source_url: str) -> str:
    normalized = _normalize_browser_publish_body(body)
    if _x_weighted_length_with_urls(normalized) <= 270:
        return normalized
    if not source_url or source_url not in normalized:
        raise RuntimeError("disabled_submit: x_text_over_limit_without_source_url")
    prefix = normalized.replace(source_url, "").strip()
    max_prefix_weight = 244
    shortened = f"{_truncate_x_weighted(prefix, max_prefix_weight)}。\n{source_url}".strip()
    if _x_weighted_length_with_urls(shortened) > 270:
        raise RuntimeError("disabled_submit: x_text_over_limit_after_shortening")
    return shortened


def _fit_x_reply_body(body: str) -> str:
    normalized = _normalize_browser_publish_body(body)
    if _x_weighted_length_with_urls(normalized) <= 270:
        return normalized
    urls = re.findall(r"https?://\S+", normalized)
    without_urls = re.sub(r"https?://\S+", "", normalized).strip()
    url_suffix = f"\n{urls[-1]}" if urls else ""
    max_body_weight = max(0, 270 - _x_weighted_length_with_urls(url_suffix) - 2)
    shortened = f"{_truncate_x_weighted(without_urls, max_body_weight)}。{url_suffix}".strip()
    if _x_weighted_length_with_urls(shortened) > 270:
        raise RuntimeError("disabled_submit: x_reply_over_limit_after_shortening")
    return shortened


def _receipt_text(row: QueueRow) -> str:
    return " ".join(
        str(part)
        for part in [
            row.media_plan,
            row.reference_media_notes,
            row.reference_media_urls,
            getattr(row, "media_receipt", ""),
        ]
        if part
    )


def _generated_media_paths_for_platform(row: QueueRow, platform: str) -> list[Path]:
    text = _receipt_text(row)
    candidates = _generated_media_path_candidates_from_text(text)
    paths: list[Path] = []
    today = _current_generated_media_date_token()
    row_id = row.id.strip()
    for candidate in candidates:
        cleaned = candidate.rstrip(").,;")
        lower = cleaned.lower()
        entry = _generated_media_receipt_entry_for_path(text, cleaned)
        receipt_platform = _receipt_field_value(entry, "platform").lower()
        if receipt_platform and receipt_platform != platform:
            continue
        if not receipt_platform:
            if platform == "x" and not ("-x-" in lower or "x-card" in lower or "x_" in lower):
                continue
            if platform == "linkedin" and not (
                "linkedin" in lower or "-li-" in lower or "carousel" in lower or "square" in lower
            ):
                continue
        path = Path(cleaned).expanduser()
        if not path.is_absolute():
            path = Path.cwd() / path
        if path.exists() and path.is_file() and path not in paths:
            paths.append(path)
    paths.sort(
        key=lambda path: (
            _receipt_field_value(_generated_media_receipt_entry_for_path(text, str(path)), "provider") == "runway_mcp",
            _receipt_field_value(_generated_media_receipt_entry_for_path(text, str(path)), "model") == "gpt-image-2",
            today in path.name,
            bool(row_id and row_id in path.name),
            path.stat().st_mtime if path.exists() else 0,
        ),
        reverse=True,
    )
    return paths


def _japanese_generated_media_headline(row: QueueRow) -> str:
    for source_text in (row.x_text, row.angle, row.linkedin_text, row.title):
        text = re.sub(r"https?://\S+", "", str(source_text or ""))
        text = re.sub(r"[A-Za-z][A-Za-z0-9 .:/()&+,'-]{2,}", " ", text)
        fragments = re.findall(r"[\u3040-\u30ff\u3400-\u9fffー々〆〤、。・]+", text)
        candidate = "".join(fragments).strip("、。・ ")
        if len(candidate) >= 8:
            return candidate[:28].strip("、。・ ")
    return "AI運用の安全設計"


def _generated_media_prompt(row: QueueRow, *, platform: str, slide_index: int | None = None) -> tuple[str, str]:
    source = row.source_name or urlparse(row.source_url).netloc or "the source"
    title = row.title or row.angle or "AI update"
    visual_styles = [
        "ai_tool_comparison_card",
        "skill_term_roadmap_table",
        "seven_step_execution_card",
        "capability_hierarchy_explainer",
        "notebook_photo_cheat_sheet",
    ]
    style = visual_styles[abs(hash(f"{row.id}:{platform}:{slide_index or 0}")) % len(visual_styles)]
    language = "ja" if platform == "x" else "en"
    headline = f"{title[:42]}" if platform == "linkedin" else _japanese_generated_media_headline(row)
    slide_note = f" Slide {slide_index} of 3." if slide_index else ""
    layout_note = (
        "The source workflow already saved a placed design state. Preserve the placed position and proportions from that saved state, "
        "do not redraw it as a loose floating mockup, and do not turn it into a side-by-side comparison image."
    )
    if language == "ja":
        prompt = (
            f"{platform}向けの正方形SNSカード画像を作成。{slide_note} "
            f"題材は「{source}」のAIニュース。{layout_note} "
            "背景は不要なら削除し、透明背景または無地の余白で整える。汎用ロボットではなく、実務で使うAI作業台の比喩で表現する。 "
            f"大きな日本語見出しは「{headline}」。visual_style={style}。 "
            "短い日本語の補足要素は2〜3個まで。余白を広く、中央配置でトリミングに強く、強いコントラストにする。 "
            "小さすぎる文字、白背景のメモカード、仮UI、英語だけの文字組み、比較カード、別案カードは禁止。日本語だけで読みやすく作る。"
        )
    else:
        prompt = (
            f"Create a production-ready square social media visual for {platform}.{slide_note} "
            f"Source-specific metaphor: {source} as a practical AI workbench, not a generic robot. {layout_note} "
            "Use transparent or backgroundless presentation when the source is a placement workflow, and keep the saved placement intact. "
            f"One mobile-legible headline: {headline}. visual_style={style}. "
            "Use 2-3 short supporting elements maximum, generous spacing, crop-safe centered composition, "
            "high contrast, no tiny text, no white-background memo card, no placeholder UI, no comparison layout. "
            "Language must be English."
        )
    return prompt, style


def _generated_media_output_suffix(platform: str, count: int = 1) -> str:
    return "x-card" if platform == "x" else ("linkedin-carousel" if count > 1 else "linkedin-square")


def _generated_media_extension_from_source(source: str, default: str = ".png") -> str:
    suffix = Path(urlparse(source).path).suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        return suffix
    return default


def _save_runway_generated_media_source(
    *,
    row: QueueRow,
    platform: str,
    image_url: str | None,
    image_path: str | None,
    output_dir: Path,
    output_suffix: str | None = None,
    output_index: int = 1,
) -> Path:
    if bool(image_url) == bool(image_path):
        raise typer.BadParameter("Provide exactly one of --image-url or --image-path.")
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = output_suffix or _generated_media_output_suffix(platform)
    source = image_url or image_path or ""
    extension = _generated_media_extension_from_source(source)
    destination = output_dir / f"{_current_generated_media_date_token()}-{row.id}-{suffix}-runway-mcp-{output_index}{extension}"
    if image_path:
        source_path = Path(image_path).expanduser()
        if not source_path.is_absolute():
            source_path = Path.cwd() / source_path
        if not source_path.exists() or not source_path.is_file():
            raise typer.BadParameter(f"--image-path does not exist or is not a file: {image_path}")
        if source_path.resolve() != destination.resolve():
            shutil.copyfile(source_path, destination)
        else:
            destination = source_path
        return destination.resolve()
    try:
        with urlopen(image_url or "", timeout=60) as response:
            destination.write_bytes(response.read())
    except (TimeoutError, socket.timeout) as exc:
        raise RuntimeError("image_generation_unavailable: runway_mcp image download timed out.") from exc
    except URLError as exc:
        raise RuntimeError(f"image_generation_unavailable: runway_mcp image download failed: {exc.reason}") from exc
    return destination.resolve()


def _append_runway_generated_media_receipt(
    row: QueueRow,
    *,
    platform: str,
    media_path: Path,
    prompt: str,
    visual_style: str,
    language: str,
) -> str:
    pixel_size = _read_generated_media_pixel_size(str(media_path))
    size_value = f"{pixel_size[0]}x{pixel_size[1]}" if pixel_size else "unknown"
    try:
        receipt_path = media_path.relative_to(Path.cwd())
    except ValueError:
        receipt_path = media_path
    receipt = (
        f"{receipt_path} model=gpt-image-2 provider=runway_mcp size={size_value} "
        f"visual_style={visual_style} platform={platform} language={language} prompt={prompt}"
    )
    row.reference_media_notes = " | ".join(
        part for part in [row.reference_media_notes.strip(), receipt] if part
    )
    if hasattr(row, "media_receipt"):
        existing_receipt = getattr(row, "media_receipt", "")
        setattr(row, "media_receipt", " | ".join(part for part in [existing_receipt.strip(), receipt] if part))
    return receipt


def _attach_runway_generated_media_to_row(
    row: QueueRow,
    *,
    platform: str,
    image_url: str | None,
    image_path: str | None,
    prompt: str | None = None,
    visual_style: str | None = None,
    language: str | None = None,
    output_suffix: str | None = None,
    output_index: int = 1,
) -> dict[str, object]:
    normalized_platform = platform.strip().lower()
    if normalized_platform not in {"x", "linkedin"}:
        raise typer.BadParameter("--platform must be x or linkedin.")
    default_prompt, default_style = _generated_media_prompt(row, platform=normalized_platform)
    prompt_value = (prompt or default_prompt).strip()
    visual_style_value = (visual_style or default_style).strip()
    language_value = (language or ("ja" if normalized_platform == "x" else "en")).strip().lower()
    media_path = _save_runway_generated_media_source(
        row=row,
        platform=normalized_platform,
        image_url=image_url,
        image_path=image_path,
        output_dir=Path("artifacts/generated-media"),
        output_suffix=output_suffix,
        output_index=output_index,
    )
    receipt = _append_runway_generated_media_receipt(
        row,
        platform=normalized_platform,
        media_path=media_path,
        prompt=prompt_value,
        visual_style=visual_style_value,
        language=language_value,
    )
    blockers = _surface_contract_blockers(row)
    promoted = False
    if not blockers:
        if row.error.startswith("image_generation_unavailable"):
            row.error = ""
        if _quality_score_value(row) < 10:
            row.quality_score = "10"
        row.keep_priority = "ship_now"
        row.review_status = "ready_morning"
        row.next_action = "Publish via the Chrome plugin registered runner with recording and local proof gates."
        promoted = True
    else:
        row.error = "; ".join(blockers)
    _append_review_note(
        row,
        f"runway_mcp_generated_media_attached: platform={normalized_platform} path={media_path}; "
        f"surface_blockers={','.join(blockers) if blockers else 'none'}",
    )
    return {
        "ok": True,
        "row_id": row.id,
        "platform": normalized_platform,
        "path": str(media_path),
        "receipt": receipt,
        "surface_blockers": blockers,
        "promoted": promoted,
    }


def _load_runway_mcp_result_payload(path: str) -> dict[str, Any]:
    result_path = Path(path).expanduser()
    if not result_path.is_absolute():
        result_path = Path.cwd() / result_path
    if not result_path.exists() or not result_path.is_file():
        raise typer.BadParameter(f"--mcp-result does not exist or is not a file: {path}")
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise typer.BadParameter("--mcp-result must contain a JSON object.")
    if payload.get("auth_required") or payload.get("blocker") == "runway_mcp_auth_required":
        raise RuntimeError("image_generation_unavailable: runway_mcp_auth_required")
    if payload.get("blocker"):
        raise RuntimeError(f"image_generation_unavailable: {payload.get('blocker')}")
    if payload.get("ok") is False:
        raise RuntimeError("image_generation_unavailable: runway_mcp_result_not_ok")
    return payload


def _runway_mcp_result_source(payload: dict[str, Any]) -> tuple[str | None, str | None]:
    for key in ("final_art_path", "selected_candidate_path"):
        value = str(payload.get(key) or "").strip()
        if value:
            return None, value
    candidate_paths = payload.get("candidate_paths")
    if isinstance(candidate_paths, list):
        for value in candidate_paths:
            text = str(value or "").strip()
            if text:
                return None, text
    for key in ("final_art_url", "selected_candidate_url"):
        value = str(payload.get(key) or "").strip()
        if value.startswith("https://"):
            return value, None
    for key in ("candidate_urls", "image_urls", "asset_urls"):
        values = payload.get(key)
        if isinstance(values, list):
            for value in values:
                text = str(value or "").strip()
                if text.startswith("https://"):
                    return text, None
    raise RuntimeError("image_generation_unavailable: runway_mcp_result_missing_image_source")


def _attach_runway_mcp_result_to_row(
    row: QueueRow,
    *,
    platform: str,
    mcp_result_path: str,
    prompt: str | None = None,
    visual_style: str | None = None,
    language: str | None = None,
    output_suffix: str | None = None,
    output_index: int = 1,
) -> dict[str, object]:
    payload = _load_runway_mcp_result_payload(mcp_result_path)
    model = str(payload.get("model") or "").strip()
    if not model:
        raise RuntimeError("image_generation_unavailable: runway_mcp_result_model_missing")
    if model != "gpt-image-2":
        raise RuntimeError(f"image_generation_unavailable: runway_mcp_result_model_not_gpt_image_2:{model}")
    image_url, image_path = _runway_mcp_result_source(payload)
    result = _attach_runway_generated_media_to_row(
        row,
        platform=platform,
        image_url=image_url,
        image_path=image_path,
        prompt=prompt,
        visual_style=visual_style,
        language=language,
        output_suffix=output_suffix,
        output_index=output_index,
    )
    result["mcp_result"] = str(Path(mcp_result_path).expanduser())
    task_ids = payload.get("task_ids")
    if isinstance(task_ids, list):
        result["runway_task_ids"] = [str(task_id) for task_id in task_ids]
    return result


def _daily_ai_runway_mcp_result_paths() -> list[str]:
    raw = os.environ.get("DAILY_AI_RUNWAY_MCP_RESULT", "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
        return [str(item).strip() for item in parsed if str(item).strip()]
    if isinstance(parsed, str) and parsed.strip():
        return [parsed.strip()]
    return [part.strip() for part in re.split(r"[\n,]", raw) if part.strip()]


def _allow_runway_mcp_wrapper_fallback() -> bool:
    return os.environ.get("DAILY_AI_ALLOW_RUNWAY_MCP_WRAPPER", "").strip().lower() in {"1", "true", "yes", "on"}


def _save_openai_image_response(result, destination: Path) -> None:
    image = result.data[0]
    b64_value = getattr(image, "b64_json", None)
    if b64_value:
        destination.write_bytes(base64.b64decode(b64_value))
        return
    url = getattr(image, "url", None)
    if url:
        try:
            with urlopen(url, timeout=30) as response:
                destination.write_bytes(response.read())
        except (TimeoutError, socket.timeout) as exc:
            raise RuntimeError("image_generation_unavailable: gpt-image-2 image download timed out.") from exc
        except URLError as exc:
            reason = getattr(exc, "reason", None)
            if isinstance(reason, (TimeoutError, socket.timeout)):
                raise RuntimeError("image_generation_unavailable: gpt-image-2 image download timed out.") from exc
            raise RuntimeError(f"image_generation_unavailable: gpt-image-2 image download failed: {exc.reason}") from exc
        return
    raise RuntimeError("image_generation_unavailable: gpt-image-2 returned no image bytes or URL.")


def _openai_image_timeout_seconds() -> float:
    raw_value = os.environ.get("DAILY_AI_OPENAI_IMAGE_TIMEOUT_SECONDS", "90").strip()
    try:
        timeout = float(raw_value)
    except ValueError:
        timeout = 90.0
    return max(timeout, 1.0)


def _openai_image_hard_timeout_seconds() -> float:
    raw_value = os.environ.get("DAILY_AI_IMAGE_HARD_TIMEOUT_SECONDS", "").strip()
    if not raw_value:
        return 0.0
    try:
        return max(0.0, float(raw_value))
    except ValueError:
        return _openai_image_timeout_seconds() + 10.0


def _is_timeout_exception(exc: BaseException) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    return "timeout" in text or "timed out" in text


def _generate_openai_image_process_target(api_key: str, prompt: str, destination: str, result_sender) -> None:
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, timeout=_openai_image_timeout_seconds())
        result = client.images.generate(model="gpt-image-2", prompt=prompt, size="1024x1024")
        _save_openai_image_response(result, Path(destination))
    except Exception as exc:
        result_sender.send({"ok": False, "error": " ".join(str(exc).split())[:1000], "timeout": _is_timeout_exception(exc)})
    else:
        result_sender.send({"ok": True})


def _generate_openai_image_bounded(*, api_key: str, prompt: str, destination: Path, row_id: str) -> None:
    timeout_seconds = _openai_image_hard_timeout_seconds()
    if timeout_seconds <= 0:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, timeout=_openai_image_timeout_seconds())
        try:
            result = client.images.generate(model="gpt-image-2", prompt=prompt, size="1024x1024")
        except Exception as exc:
            if _is_timeout_exception(exc):
                raise RuntimeError("image_generation_unavailable: gpt-image-2 request timed out.") from exc
            normalized_error = _normalize_openai_image_generation_error(exc)
            if normalized_error:
                raise RuntimeError(normalized_error) from exc
            raise
        _save_openai_image_response(result, destination)
        return

    result_receiver, result_sender = mp.Pipe(duplex=False)
    process = mp.Process(
        target=_generate_openai_image_process_target,
        args=(api_key, prompt, str(destination), result_sender),
        daemon=True,
    )
    process.start()
    result_sender.close()
    process.join(timeout_seconds)
    if process.is_alive():
        process.terminate()
        process.join(5)
        if process.is_alive():
            process.kill()
            process.join(5)
        raise RuntimeError(
            f"image_generation_unavailable: gpt-image-2 request exceeded {timeout_seconds:g}s for queue_id={row_id}."
        )
    if not result_receiver.poll(0):
        raise RuntimeError(f"image_generation_unavailable: gpt-image-2 worker returned no result for queue_id={row_id}.")
    payload = result_receiver.recv()
    if not payload.get("ok"):
        error = payload.get("error") or f"gpt-image-2 worker failed for queue_id={row_id}"
        if payload.get("timeout") and "image_generation_unavailable:" not in error:
            raise RuntimeError("image_generation_unavailable: gpt-image-2 request timed out.")
        normalized_error = _normalize_openai_image_generation_error(error)
        if normalized_error:
            raise RuntimeError(normalized_error)
        raise RuntimeError(error)


def _normalize_openai_image_generation_error(error: object) -> str:
    text = " ".join(str(error or "").split())
    if not text:
        return ""
    if "billing_hard_limit_reached" in text or "Billing hard limit has been reached" in text:
        return "image_generation_unavailable: billing_hard_limit_reached"
    if "insufficient_quota" in text:
        return "image_generation_unavailable: insufficient_quota"
    return ""


def _generate_media_assets_for_surface(
    row: QueueRow,
    *,
    platform: str,
    count: int,
    settings: Settings,
) -> list[Path]:
    normalized_platform = platform.strip().lower()
    if normalized_platform not in {"x", "linkedin"}:
        raise typer.BadParameter("platform must be x or linkedin.")
    prompt, visual_style = _generated_media_prompt(row, platform=normalized_platform)
    language = "ja" if normalized_platform == "x" else "en"
    output_dir = Path("artifacts/generated-media")
    mcp_result_paths = _daily_ai_runway_mcp_result_paths()
    if mcp_result_paths:
        generated_paths: list[Path] = []
        handoff_suffix = _generated_media_output_suffix(normalized_platform, count)
        for index, mcp_result_path in enumerate(mcp_result_paths[:count], start=1):
            result = _attach_runway_mcp_result_to_row(
                row,
                platform=normalized_platform,
                mcp_result_path=mcp_result_path,
                prompt=prompt,
                visual_style=visual_style,
                language=language,
                output_suffix=handoff_suffix,
                output_index=index,
            )
            media_path = Path(str(result.get("path") or "")).expanduser()
            if not media_path.is_absolute():
                media_path = Path.cwd() / media_path
            if not media_path.exists() or not media_path.is_file():
                raise RuntimeError("image_generation_unavailable: runway_mcp_result_missing_output")
            generated_paths.append(media_path.resolve())
        if len(generated_paths) < count:
            raise RuntimeError(
                f"image_generation_unavailable: runway_mcp_result_count_insufficient:{len(generated_paths)}/{count}"
            )
        _append_review_note(
            row,
            f"runway_mcp_generated_media_attached_from_result: platform={normalized_platform} "
            f"count={len(generated_paths)} mcp_results={','.join(mcp_result_paths[:count])}",
        )
        return generated_paths
    if not _allow_runway_mcp_wrapper_fallback():
        raise RuntimeError(
            "image_generation_unavailable: runway_mcp_result_handoff_missing. "
            "Set DAILY_AI_RUNWAY_MCP_RESULT to a current Daily AI Runway MCP result JSON from an "
            "already-authorized client; direct mcp-remote OAuth/localhost fallback is disabled."
        )
    wrapper_path = Path("scripts/runway_mcp_generate_image.mjs")
    if not wrapper_path.exists():
        raise RuntimeError(
            "image_generation_unavailable: runway_mcp_wrapper_missing. "
            "Expected scripts/runway_mcp_generate_image.mjs."
        )
    suffix = _generated_media_output_suffix(normalized_platform, count)
    generated_paths: list[Path] = []
    timeout_seconds = float(os.environ.get("DAILY_AI_RUNWAY_MCP_TIMEOUT_SECONDS", "240"))
    for index in range(1, count + 1):
        output_name = f"{_current_generated_media_date_token()}-{row.id}-{suffix}-runway-mcp-{index}.png"
        expected_output_path = (output_dir / output_name).resolve()
        try:
            result = subprocess.run(
                [
                    "/Applications/Codex.app/Contents/Resources/cua_node/bin/node",
                    str(wrapper_path),
                    "--prompt",
                    prompt,
                    "--model",
                    "gpt-image-2",
                    "--ratio",
                    "1:1",
                    "--count",
                    "1",
                    "--output-dir",
                    str(output_dir),
                    "--output-name",
                    output_name,
                    "--rationale",
                    f"Generate Daily AI {normalized_platform} media for queue row {row.id} through Runway MCP.",
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            if expected_output_path.exists() and expected_output_path.is_file():
                generated_paths.append(expected_output_path)
                _append_runway_generated_media_receipt(
                    row,
                    platform=normalized_platform,
                    media_path=expected_output_path,
                    prompt=prompt,
                    visual_style=visual_style,
                    language=language,
                )
                _append_review_note(
                    row,
                    f"runway_mcp_generated_media_recovered_after_timeout: platform={normalized_platform} "
                    f"path={expected_output_path}",
                )
                continue
            raise RuntimeError(
                f"image_generation_unavailable: runway_mcp_wrapper_timeout for queue_id={row.id}."
            ) from exc
        if result.returncode != 0:
            error_text = " ".join((result.stderr or result.stdout or "").split())[:1000]
            if "runway_mcp_task_pending_without_output" in error_text:
                raise RuntimeError("image_generation_unavailable: runway_mcp_task_pending_without_output")
            raise RuntimeError(f"image_generation_unavailable: runway_mcp_wrapper_failed: {error_text}")
        payload: dict[str, object] | None = None
        for line in reversed(result.stdout.strip().splitlines()):
            candidate = line.strip()
            if not candidate.startswith("{"):
                continue
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                payload = parsed
                break
        if payload is None:
            raise RuntimeError("image_generation_unavailable: runway_mcp_wrapper_invalid_json")
        model = str(payload.get("model") or "").strip()
        if not model:
            raise RuntimeError("image_generation_unavailable: runway_mcp_result_model_missing")
        if model != "gpt-image-2":
            raise RuntimeError(f"image_generation_unavailable: runway_mcp_result_model_not_gpt_image_2:{model}")
        output_path = Path(str(payload.get("outputPath") or "")).expanduser()
        if not output_path.exists() or not output_path.is_file():
            raise RuntimeError("image_generation_unavailable: runway_mcp_wrapper_missing_output")
        generated_paths.append(output_path.resolve())
        _append_runway_generated_media_receipt(
            row,
            platform=normalized_platform,
            media_path=output_path.resolve(),
            prompt=prompt,
            visual_style=visual_style,
            language=language,
        )
    _append_review_note(
        row,
        f"runway_mcp_generated_media_auto_created: platform={normalized_platform} "
        f"count={len(generated_paths)} paths={','.join(str(path) for path in generated_paths)}",
    )
    return generated_paths


def _ensure_generated_media_for_surface(
    row: QueueRow,
    *,
    platform: str,
    count: int,
    settings: Settings,
) -> list[Path]:
    paths = _generated_media_paths_for_platform(row, platform)
    if len(paths) < count:
        paths = _generate_media_assets_for_surface(row, platform=platform, count=count, settings=settings)
    selected = [str(path) for path in paths[:count]]
    blockers = _fresh_generated_media_blockers(row, selected)
    blockers.extend(_selected_generated_media_quality_blockers(row, selected))
    blockers.extend(_selected_generated_media_receipt_blockers(row, platform, selected))
    blockers.extend(_generated_media_square_size_blockers(row, selected))
    if blockers and all(_is_generated_media_repairable_blocker(blocker) for blocker in blockers):
        paths = _generate_media_assets_for_surface(row, platform=platform, count=count, settings=settings)
        selected = [str(path) for path in paths[:count]]
        blockers = _fresh_generated_media_blockers(row, selected)
        blockers.extend(_selected_generated_media_quality_blockers(row, selected))
        blockers.extend(_selected_generated_media_receipt_blockers(row, platform, selected))
        blockers.extend(_generated_media_square_size_blockers(row, selected))
    if len(selected) < count:
        blockers.append(f"surface_missing: generated_media_required_{platform}_{count}_found_{len(selected)}")
    if blockers:
        raise RuntimeError("; ".join(blockers))
    return [Path(path).resolve() for path in selected]


def _preflight_linkedin_media_upload_paths_local(
    paths: list[Path],
    *,
    settings: Settings,
    timeout_seconds: float,
) -> None:
    for path in paths:
        result = subprocess.run(
            [
                "social-flow",
                "preflight-linkedin-media-upload-local",
                str(path.resolve()),
                "--remote-debugging-port",
                str(settings.chrome_main_remote_debugging_port),
                "--timeout-seconds",
                str(max(timeout_seconds, 15.0)),
                "--json",
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        payload: dict[str, object] = {}
        if result.stdout.strip():
            try:
                payload = json.loads(result.stdout.strip().splitlines()[-1])
            except json.JSONDecodeError:
                payload = {}
        if result.returncode != 0 or payload.get("ok") is not True:
            stop_reason = str(payload.get("stop_reason") or "media_upload_permission_blocked")
            reason = str(payload.get("reason") or result.stderr.strip() or "linkedin_media_preflight_failed")
            raise RuntimeError(f"{stop_reason}: {reason}")


def _preflight_linkedin_media_upload_paths_on_page(
    page,
    paths: list[Path],
    *,
    row_id: str,
    timeout_seconds: float,
) -> None:
    _ensure_linkedin_feed_ready(page, timeout_seconds=timeout_seconds)
    _upload_linkedin_media_via_photo_route(
        page,
        paths,
        timeout_seconds=max(timeout_seconds, 15.0),
        row_id=f"{row_id}-preflight",
    )
    _linkedin_publish_diagnostic_snapshot(
        page,
        row_id=row_id,
        stage="preflight_no_post_media_reflected",
        reason="same_page_preflight_ok",
    )
    _close_stale_linkedin_composer_ui(page)
    page.wait_for_timeout(1000)


def _fresh_linkedin_publish_page(
    page,
    *,
    row_id: str,
    timeout_seconds: float,
    stage: str,
    reason: str,
):
    try:
        _close_stale_linkedin_publish_pages(page.context, keep_page=page)
        fresh_page = page.context.new_page()
        try:
            fresh_page.bring_to_front()
        except Exception:
            pass
        _ensure_linkedin_feed_ready(fresh_page, timeout_seconds=timeout_seconds)
        try:
            fresh_page.bring_to_front()
        except Exception:
            pass
        _close_stale_linkedin_composer_ui(fresh_page)
        _close_stale_linkedin_publish_pages(fresh_page.context, keep_page=fresh_page)
        _linkedin_publish_diagnostic_snapshot(
            fresh_page,
            row_id=row_id,
            stage=stage,
            reason=reason,
        )
        return fresh_page
    except Exception as exc:
        _linkedin_publish_diagnostic_snapshot(
            page,
            row_id=row_id,
            stage=f"{stage}_unavailable",
            reason=" ".join(str(exc).split())[:240],
        )
        reason = " ".join(str(exc).split())[:240]
        if re.search(r"auth_blocked|account_not_verified|wrong_or_unverified_account", reason, re.I):
            raise
        raise RuntimeError(f"local_automation_profile_unavailable: linkedin_fresh_feed_page_unavailable {reason}") from exc


def _close_stale_linkedin_publish_pages(context, *, keep_page=None) -> int:
    closed = 0
    for candidate in list(getattr(context, "pages", []) or []):
        if keep_page is not None and candidate == keep_page:
            continue
        try:
            url = candidate.url
            title = candidate.title()
        except Exception:
            continue
        if "linkedin.com/feed" not in url and "linkedin" not in title.lower():
            continue
        try:
            has_publish_modal = bool(
                candidate.get_by_text(
                    re.compile(
                        r"What do you want to talk about|Content credentials label added|Save this post as a draft\\?|Create post modal|Post to Anyone",
                        re.I,
                    ),
                    exact=False,
                ).count()
            )
        except Exception:
            has_publish_modal = False
        if not has_publish_modal:
            continue
        try:
            candidate.close()
            closed += 1
        except Exception:
            pass
    return closed


def _fresh_linkedin_publish_page_after_media_preflight(page, *, row_id: str, timeout_seconds: float):
    return _fresh_linkedin_publish_page(
        page,
        row_id=row_id,
        timeout_seconds=timeout_seconds,
        stage="after_preflight_fresh_page",
        reason="fresh_page_after_no_post_media_preflight",
    )


def _mark_platform_publish_failed(row: QueueRow, platform: str, reason: str) -> None:
    category = _automation_failure_category(reason)
    _set_platform_publish_error(row, platform, reason)
    row.review_status = "hold"
    row.next_action = f"Fix {platform} publish blocker ({category}) before retrying."
    _queue_note(row, f"{platform}_publish_blocked:{reason[:160]}")
    if category:
        _queue_note(row, f"automation_failure_category={category}")


def _switch_linkedin_link_card_to_square_image_after_reflection_failure(row: QueueRow, reason: str) -> bool:
    if "link_card_not_reflected" not in reason:
        return False
    if _surface_contract_label(row, "linkedin") != "linkedin_link_card":
        return False
    replaced = False
    for field in ("content_format", "publish_strategy", "media_plan"):
        value = getattr(row, field) or ""
        if "LinkedInリンクカード型" in value:
            setattr(row, field, value.replace("LinkedInリンクカード型", "LinkedIn正方形1枚画像型"))
            replaced = True
    if not replaced:
        row.media_plan = " | ".join(
            part
            for part in [(row.media_plan or "").strip(), "LinkedIn正方形1枚画像型"]
            if part
        )
    _queue_note(
        row,
        "linkedin_surface_fallback: LinkedIn link card was not reflected; retrying with LinkedIn正方形1枚画像型 and fresh gpt-image-2 media.",
    )
    return True


def _mark_platform_published(row: QueueRow, platform: str, post_url: str) -> None:
    now = utc_now()
    if platform == "x":
        row.x_post_url = post_url
        row.x_post_id = extract_x_post_id(post_url)
        row.x_published_at = now
    else:
        row.linkedin_post_url = post_url
        row.linkedin_post_id = extract_linkedin_post_id(post_url)
        row.linkedin_published_at = now
    if row.x_post_url.strip() and row.linkedin_post_url.strip():
        row.status = "published"
        row.published_at = row.published_at or now
    else:
        row.status = "partially_published"
    _clear_platform_publish_error(row, platform)
    if row.status == "published":
        row.error = ""
        row.next_action = "Monitor published post metrics and replies."
    else:
        pending = "LinkedIn" if platform == "x" else "X"
        posted_label = "X" if platform == "x" else "LinkedIn"
        row.next_action = (
            f"{posted_label} posted via Nicky automation. {pending} remains pending; retry only after "
            "expected account, body reflection, surface/link/media reflection, enabled submit, and completion URL gates pass."
        )
    _queue_note(row, f"{platform}_published_by:nicky_automation")


def _split_platform_publish_errors(value: str) -> list[str]:
    return [part.strip() for part in str(value or "").split(";") if part.strip()]


def _platform_publish_error_prefix(platform: str) -> str:
    return "x_publish_failed:" if platform == "x" else "linkedin_publish_failed:"


def _stale_generated_media_surface_markers() -> tuple[str, ...]:
    return (
        "surface_missing: generated_media_receipt_missing_for_path",
        "surface_missing: generated_media_demo_placeholder",
    )


def _set_platform_publish_error(row: QueueRow, platform: str, reason: str) -> None:
    own_prefix = _platform_publish_error_prefix(platform)
    stale_surface_markers = _stale_generated_media_surface_markers()
    row.error = "; ".join(
        [
            *[
                part
                for part in _split_platform_publish_errors(row.error)
                if not part.startswith(own_prefix) and part not in stale_surface_markers
            ],
            f"{own_prefix} {reason}",
        ]
    )


def _clear_platform_publish_error(row: QueueRow, platform: str) -> None:
    own_prefix = _platform_publish_error_prefix(platform)
    row.error = "; ".join(
        part
        for part in _split_platform_publish_errors(row.error)
        if not part.startswith(own_prefix)
    )


def _x_post_button(page):
    return _visible_enabled_button(page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'))


def _attach_x_media(page, media_paths: list[Path]) -> None:
    input_locator = page.locator('input[type="file"]').first
    if input_locator.count():
        input_locator.set_input_files([str(path) for path in media_paths], timeout=15000)
    else:
        attach = page.locator(
            '[data-testid="fileInput"], [aria-label*="Add photos"], [aria-label*="Media"], [aria-label*="画像"]'
        ).first
        if not attach.is_visible(timeout=5000):
            raise RuntimeError("media_upload_permission_blocked: x_media_input_not_visible")
        try:
            attach.set_input_files([str(path) for path in media_paths], timeout=15000)
        except Exception:
            fallback = page.locator('input[type="file"]').first
            if not fallback.count():
                raise RuntimeError("media_upload_permission_blocked: x_file_input_not_materialized")
            fallback.set_input_files([str(path) for path in media_paths], timeout=15000)
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        if page.locator('[data-testid="attachments"], [data-testid="tweetPhoto"], img[src^="blob:"]').count():
            return
        page.wait_for_timeout(800)
    raise RuntimeError("surface_missing: x_generated_media_not_reflected")


def _open_x_native_quote_composer(page, quote_url: str, *, timeout_seconds: float) -> None:
    page.goto(quote_url.replace("twitter.com/", "x.com/"), wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
    page.wait_for_timeout(2500)
    repost = page.locator('[data-testid="retweet"], [aria-label*="Repost"], [aria-label*="リポスト"]').first
    if not repost.is_visible(timeout=8000):
        raise RuntimeError("quote_card_not_reflected: X repost button was not visible.")
    repost.click(timeout=8000)
    page.wait_for_timeout(1000)
    quote_item = page.locator(
        '[role="menuitem"]:has-text("Quote"), [role="menuitem"]:has-text("引用"), a[href*="/compose/post"]'
    ).first
    if not quote_item.is_visible(timeout=8000):
        raise RuntimeError("quote_card_not_reflected: X Quote menu item was not visible.")
    quote_item.click(timeout=8000)
    page.wait_for_timeout(2500)


def _wait_for_x_quote_reflection(page) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            body = page.locator("body").inner_text(timeout=2000)
            if page.locator('[data-testid="tweetTextarea_0"]').count() and any(
                marker in body for marker in ("Quote", "引用", "Repost", "リポスト", "@")
            ):
                return
        except Exception:
            pass
        page.wait_for_timeout(800)
    raise RuntimeError("quote_card_not_reflected: X quoted post card was not visible in composer.")


def _x_status_id_from_url(url: str) -> str:
    match = re.search(r"/status/([0-9]+)", url or "")
    return match.group(1) if match else ""


def _capture_x_existing_status_ids(page, *, expected_handle: str) -> set[str]:
    handle = expected_handle.strip().lstrip("@")
    page.goto(f"https://x.com/{handle}", wait_until="domcontentloaded", timeout=10000)
    page.wait_for_timeout(2000)
    hrefs = page.locator('a[href*="/status/"]').evaluate_all("els => els.map(a => a.href)")
    return {
        status_id
        for href in hrefs
        if f"/{handle}/status/" in href
        for status_id in [_x_status_id_from_url(href)]
        if status_id
    }


def _x_completion_snippets(body: str) -> list[str]:
    compact = re.sub(r"\s+", "", body or "")
    return [snippet for snippet in [compact[:28], compact[:18]] if len(snippet) >= 12]


def _capture_x_post_url(
    page,
    *,
    expected_handle: str,
    body: str,
    timeout_seconds: float,
    source_url: str = "",
    exclude_status_ids: set[str] | None = None,
) -> str:
    handle = expected_handle.strip().lstrip("@")
    snippets = _x_completion_snippets(body)
    excluded = exclude_status_ids or set()
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            page.goto(f"https://x.com/{handle}", wait_until="domcontentloaded", timeout=10000)
            page.wait_for_timeout(2000)
            articles = page.locator('article[data-testid="tweet"]')
            for index in range(min(articles.count(), 8)):
                article = articles.nth(index)
                hrefs = article.locator('a[href*="/status/"]').evaluate_all("els => els.map(a => a.href)")
                post_href = next(
                    (
                        href
                        for href in hrefs
                        if f"/{handle}/status/" in href and _x_status_id_from_url(href) not in excluded
                    ),
                    "",
                )
                if not post_href:
                    continue
                article_text = re.sub(r"\s+", "", _locator_text(article))
                article_hrefs = article.locator("a[href]").evaluate_all("els => els.map(a => a.href)")
                source_matched = bool(source_url and any(source_url in href for href in article_hrefs))
                if source_matched or any(snippet and snippet in article_text for snippet in snippets):
                    return post_href.split("?")[0]
        except Exception:
            pass
        page.wait_for_timeout(1000)
    raise RuntimeError("completion_capture_failed: X post URL was not visible after submit.")


def _read_x_composer_body(editor) -> str:
    try:
        payload = editor.evaluate(
            """(node) => {
              const hrefs = Array.from(node.querySelectorAll?.('a[href]') || [])
                .map((anchor) => `${anchor.textContent || ''} ${anchor.href || anchor.getAttribute('href') || ''}`);
              return [
                node.innerText || '',
                node.textContent || '',
                node.getAttribute?.('aria-label') || '',
                ...hrefs,
              ].join('\\n');
            }"""
        )
        return re.sub(r"\s+", " ", str(payload or "").replace("\u00a0", " ")).strip()
    except Exception:
        return _locator_text(editor)


def _x_composer_body_reflected(readback: str, body: str, *, source_url: str = "") -> bool:
    if not any(snippet and snippet in re.sub(r"\s+", "", readback or "") for snippet in _x_completion_snippets(body)):
        compact_readback = re.sub(r"\s+", "", readback or "")
        compact_body = re.sub(r"\s+", "", body or "")
        if compact_body[: min(80, len(compact_body))] not in compact_readback:
            return False
    source = source_url.strip()
    if not source:
        return True
    normalized = str(readback or "")
    return source in normalized or source.replace("https://", "").replace("http://", "") in normalized


def _reset_x_composer(page, *, timeout_seconds: float) -> None:
    page.goto("https://x.com/home", wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
    page.wait_for_timeout(1500)
    page.goto("https://x.com/compose/post", wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
    page.wait_for_timeout(2500)


def _insert_x_body_via_contenteditable(editor, body: str) -> None:
    editor.evaluate(
        """(node, text) => {
          const escape = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          }[char]));
          node.focus();
          node.innerHTML = String(text || '')
            .split('\\n')
            .map((line) => `<span>${escape(line) || '<br>'}</span>`)
            .join('<br>');
          node.dispatchEvent(new InputEvent('beforeinput', {bubbles: true, inputType: 'insertText', data: text}));
          node.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
          node.dispatchEvent(new Event('change', {bubbles: true}));
        }""",
        body,
    )


def _insert_and_verify_x_composer_body(
    page,
    body: str,
    *,
    source_url: str = "",
    timeout_seconds: float,
    allow_reset: bool = False,
):
    for attempt in range(2 if allow_reset else 1):
        editor = page.locator('[data-testid="tweetTextarea_0"], [role="dialog"] [contenteditable="true"]').first
        editor.wait_for(timeout=15000)
        editor.click(timeout=5000)
        editor.press("ControlOrMeta+A", timeout=3000)
        editor.press("Backspace", timeout=3000)
        try:
            editor.fill(body, timeout=15000)
        except Exception:
            pass
        reflected = _read_x_composer_body(editor)
        if not _x_composer_body_reflected(reflected, body, source_url=source_url):
            try:
                editor.press("ControlOrMeta+A", timeout=3000)
                editor.press("Backspace", timeout=3000)
                editor.press_sequentially(body, delay=4, timeout=30000)
            except Exception:
                pass
            reflected = _read_x_composer_body(editor)
        if not _x_composer_body_reflected(reflected, body, source_url=source_url):
            _insert_x_body_via_contenteditable(editor, body)
            page.wait_for_timeout(1000)
            reflected = _read_x_composer_body(editor)
        if _x_composer_body_reflected(reflected, body, source_url=source_url):
            return editor
        if attempt == 0 and allow_reset:
            _reset_x_composer(page, timeout_seconds=timeout_seconds)
            continue
        raise RuntimeError("body_not_reflected: X composer did not contain x_text.")
    raise RuntimeError("body_not_reflected: X composer did not contain x_text.")


def _publish_x_text_url_local(page, row: QueueRow, *, settings: Settings, timeout_seconds: float) -> str:
    if _surface_contract_label(row, "x") not in {"x_text_url", "x_source_link_card"}:
        raise RuntimeError(f"surface_missing: unsupported X surface {_surface_contract_label(row, 'x') or 'blank'}.")
    source_url = _candidate_source_url_required(row, "x")
    body = _fit_x_text_url_body(_body_with_source_url(row, "x"), source_url)
    if body != row.x_text:
        row.x_text = body
        _queue_note(row, f"{datetime.now(timezone.utc).isoformat()}: X text shortened before publish to keep the Post button enabled while preserving source_url.")
    page.goto("https://x.com/home", wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
    _verify_x_browser_account(page, settings.x_expected_handle)
    try:
        existing_status_ids = _capture_x_existing_status_ids(page, expected_handle=settings.x_expected_handle)
    except Exception:
        existing_status_ids = set()
    page.goto("https://x.com/compose/post", wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
    _insert_and_verify_x_composer_body(
        page,
        body,
        source_url=source_url,
        timeout_seconds=timeout_seconds,
        allow_reset=True,
    )
    _x_post_button(page).click(timeout=10000)
    return _capture_x_post_url(
        page,
        expected_handle=settings.x_expected_handle,
        body=body,
        timeout_seconds=timeout_seconds,
        source_url=source_url,
        exclude_status_ids=existing_status_ids,
    )


def _publish_x_generated_media_local(
    page,
    row: QueueRow,
    *,
    settings: Settings,
    timeout_seconds: float,
    quote: bool = False,
) -> str:
    body = _normalize_browser_publish_body(row.x_text)
    if not body:
        raise RuntimeError("body_not_reflected: x_text is required.")
    media_paths = _ensure_generated_media_for_surface(row, platform="x", count=1, settings=settings)
    page.goto("https://x.com/home", wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
    _verify_x_browser_account(page, settings.x_expected_handle)
    try:
        existing_status_ids = _capture_x_existing_status_ids(page, expected_handle=settings.x_expected_handle)
    except Exception:
        existing_status_ids = set()
    if quote:
        quote_url = next(
            (
                value
                for value in re.split(r"[\s,|]+", " ".join([row.reference_post_urls, row.source_url]))
                if re.match(r"https?://(?:www\.)?(?:x|twitter)\.com/.+/status/\d+", value, flags=re.IGNORECASE)
            ),
            "",
        )
        if not quote_url:
            raise RuntimeError("quote_card_not_reflected: X引用解釈カード型 requires an X source post URL.")
        _open_x_native_quote_composer(page, quote_url, timeout_seconds=timeout_seconds)
    else:
        page.goto("https://x.com/compose/post", wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
    body_source_url = row.source_url.strip() if row.source_url.strip() and row.source_url.strip() in body else ""
    _insert_and_verify_x_composer_body(
        page,
        body,
        source_url=body_source_url,
        timeout_seconds=timeout_seconds,
        allow_reset=not quote,
    )
    if quote:
        _wait_for_x_quote_reflection(page)
    _attach_x_media(page, media_paths)
    _x_post_button(page).click(timeout=10000)
    return _capture_x_post_url(
        page,
        expected_handle=settings.x_expected_handle,
        body=body,
        timeout_seconds=timeout_seconds,
        source_url=row.source_url.strip(),
        exclude_status_ids=existing_status_ids,
    )


def _publish_x_by_surface_local(page, row: QueueRow, *, settings: Settings, timeout_seconds: float) -> str:
    surface = _surface_contract_label(row, "x")
    if surface in {"x_text_url", "x_source_link_card"}:
        return _publish_x_text_url_local(page, row, settings=settings, timeout_seconds=timeout_seconds)
    if surface == "x_self_made_decision_card":
        return _publish_x_generated_media_local(page, row, settings=settings, timeout_seconds=timeout_seconds, quote=False)
    if surface == "x_quote_interpretation_card":
        return _publish_x_generated_media_local(page, row, settings=settings, timeout_seconds=timeout_seconds, quote=True)
    raise RuntimeError(f"surface_missing: unsupported X surface {surface or 'blank'}.")


def _linkedin_editor(page):
    return page.locator(
        '[role="dialog"] div[aria-label="Text editor for creating content"][contenteditable="true"], '
        '[role="dialog"] div[aria-label*="Text editor"][contenteditable="true"], '
        '[role="dialog"] div[aria-label*="テキストエディタ"][contenteditable="true"], '
        '[role="dialog"] div[aria-label*="投稿"][contenteditable="true"], '
        '[role="dialog"] div[contenteditable="true"][role="textbox"], '
        '[role="dialog"] div.ql-editor[contenteditable="true"], '
        '.artdeco-modal div[aria-label*="Text editor"][contenteditable="true"], '
        '.artdeco-modal div[contenteditable="true"][role="textbox"], '
        '.artdeco-modal div.ql-editor[contenteditable="true"], '
        '.share-box div[aria-label*="Text editor"][contenteditable="true"], '
        '.share-box div[contenteditable="true"][role="textbox"], '
        '.share-box div.ql-editor[contenteditable="true"], '
        '.share-creation-state div[aria-label*="Text editor"][contenteditable="true"], '
        '.share-creation-state div[contenteditable="true"][role="textbox"], '
        '.share-creation-state div.ql-editor[contenteditable="true"], '
        'div[aria-label*="Text editor"][contenteditable="true"], '
        'div[contenteditable="true"][role="textbox"], '
        'div.ql-editor[contenteditable="true"]'
    ).last


def _ax_value(value) -> str:
    if isinstance(value, dict):
        inner = value.get("value", "")
        return "" if inner is None else str(inner)
    return "" if value is None else str(value)


def _linkedin_ax_nodes(page) -> list[dict[str, object]]:
    session = page.context.new_cdp_session(page)
    try:
        response = session.send("Accessibility.getFullAXTree")
        nodes = response.get("nodes", [])
        return nodes if isinstance(nodes, list) else []
    finally:
        try:
            session.detach()
        except Exception:
            pass


def _linkedin_ax_node_property(node: dict[str, object], name: str):
    for prop in node.get("properties", []) or []:
        if isinstance(prop, dict) and prop.get("name") == name:
            value = prop.get("value", {})
            if isinstance(value, dict):
                return value.get("value")
            return value
    return None


def _linkedin_ax_composer_scoped_nodes(nodes: list[dict[str, object]]) -> list[dict[str, object]]:
    by_node_id: dict[str, dict[str, object]] = {}
    for node in nodes:
        if isinstance(node, dict) and node.get("nodeId") is not None:
            by_node_id[str(node.get("nodeId"))] = node

    dialogs: list[dict[str, object]] = []
    for node in nodes:
        if not isinstance(node, dict) or node.get("ignored"):
            continue
        role = _ax_value(node.get("role", {})).lower()
        name = _ax_value(node.get("name", {})).strip()
        value = _ax_value(node.get("value", {})).strip()
        haystack = f"{name} {value}".strip()
        if role == "dialog" and re.search(r"create post|投稿を作成|post modal", haystack, flags=re.IGNORECASE):
            dialogs.append(node)
    if not dialogs:
        return []

    scoped: list[dict[str, object]] = []
    seen: set[str] = set()
    stack = [str(child_id) for child_id in reversed(dialogs[-1].get("childIds", []) or [])]
    while stack:
        node_id = stack.pop()
        if node_id in seen:
            continue
        seen.add(node_id)
        node = by_node_id.get(node_id)
        if not node:
            continue
        scoped.append(node)
        stack.extend(str(child_id) for child_id in reversed(node.get("childIds", []) or []))
    return [dialogs[-1], *scoped]


def _linkedin_ax_composer_snapshot(page) -> dict[str, object]:
    snapshot: dict[str, object] = {
        "has_dialog": False,
        "has_editor": False,
        "editor_backend_node_id": None,
        "editor_text": "",
        "has_post_button": False,
        "post_backend_node_id": None,
        "media_signal_count": 0,
    }
    try:
        nodes = _linkedin_ax_nodes(page)
    except Exception:
        return snapshot
    scoped_nodes = _linkedin_ax_composer_scoped_nodes(nodes)
    if not scoped_nodes:
        return snapshot
    snapshot["has_dialog"] = True
    for node in scoped_nodes:
        if not isinstance(node, dict) or node.get("ignored"):
            continue
        role = _ax_value(node.get("role", {})).lower()
        name = _ax_value(node.get("name", {})).strip()
        value = _ax_value(node.get("value", {})).strip()
        haystack = f"{name} {value}".strip()
        haystack_lower = haystack.lower()
        backend_node_id = node.get("backendDOMNodeId")
        if role in {"textbox", "text field", "textfield"} and re.search(
            r"text editor for creating content|text editor|テキストエディタ|投稿", haystack, flags=re.IGNORECASE
        ):
            snapshot["has_editor"] = True
            snapshot["editor_backend_node_id"] = backend_node_id
            snapshot["editor_text"] = value if value else name
        if role == "button" and re.fullmatch(r"(Post|投稿)", name, flags=re.IGNORECASE):
            disabled = bool(_linkedin_ax_node_property(node, "disabled"))
            if not disabled:
                snapshot["has_post_button"] = True
                snapshot["post_backend_node_id"] = backend_node_id
        if re.search(r"profile|avatar|member|open to work", haystack_lower):
            continue
        if re.search(
            r"image preview|edit media preview|remove media|content credentials label added|add alt text|edit alt text|\balt\b|代替テキスト|page \d+ of \d+",
            haystack,
            flags=re.IGNORECASE,
        ):
            snapshot["media_signal_count"] = int(snapshot["media_signal_count"]) + 1
    return snapshot


def _linkedin_ax_media_composer_signal_reflected(page, *, min_count: int = 1) -> bool:
    snapshot = _linkedin_ax_composer_snapshot(page)
    return bool(
        snapshot.get("has_dialog")
        and snapshot.get("has_editor")
        and snapshot.get("has_post_button")
        and int(snapshot.get("media_signal_count") or 0) >= min_count
    )


def _resolve_linkedin_ax_backend_node(page, backend_node_id):
    if not backend_node_id:
        return None, None
    session = page.context.new_cdp_session(page)
    try:
        resolved = session.send("DOM.resolveNode", {"backendNodeId": int(backend_node_id)})
        object_id = (resolved.get("object") or {}).get("objectId")
        if not object_id:
            try:
                session.detach()
            except Exception:
                pass
            return None, None
        return session, object_id
    except Exception:
        try:
            session.detach()
        except Exception:
            pass
        return None, None


def _focus_linkedin_ax_editor(page) -> bool:
    snapshot = _linkedin_ax_composer_snapshot(page)
    session, object_id = _resolve_linkedin_ax_backend_node(page, snapshot.get("editor_backend_node_id"))
    if not session or not object_id:
        return False
    try:
        session.send(
            "Runtime.callFunctionOn",
            {
                "objectId": object_id,
                "functionDeclaration": "(node) => { node.focus?.(); node.click?.(); return true; }",
            },
        )
        return True
    except Exception:
        return False
    finally:
        try:
            session.detach()
        except Exception:
            pass


def _set_linkedin_ax_editor_body(page, body: str) -> str:
    if not _focus_linkedin_ax_editor(page):
        return ""
    try:
        page.keyboard.press("ControlOrMeta+A", timeout=5000)
        page.keyboard.press("Backspace", timeout=5000)
    except Exception:
        pass
    for chunk in re.split(r"(\n)", body):
        if not chunk:
            continue
        try:
            if chunk == "\n":
                page.keyboard.press("Enter", timeout=5000)
            else:
                for character in chunk:
                    page.keyboard.type(character, delay=2)
        except Exception:
            break
    page.wait_for_timeout(500)
    return str(_linkedin_ax_composer_snapshot(page).get("editor_text") or "")


def _click_linkedin_ax_post_button(page) -> bool:
    snapshot = _linkedin_ax_composer_snapshot(page)
    if not (snapshot.get("has_dialog") and snapshot.get("has_post_button")):
        return False
    session, object_id = _resolve_linkedin_ax_backend_node(page, snapshot.get("post_backend_node_id"))
    if not session or not object_id:
        return False
    try:
        session.send(
            "Runtime.callFunctionOn",
            {
                "objectId": object_id,
                "functionDeclaration": "(node) => { node.click?.(); return true; }",
            },
        )
        return True
    except Exception:
        return False
    finally:
        try:
            session.detach()
        except Exception:
            pass


def _wait_for_linkedin_editor(page, *, timeout_seconds: float, allow_open_compose_entry: bool = True):
    deadline = time.monotonic() + timeout_seconds
    last_error = ""
    while time.monotonic() < deadline:
        editor = _linkedin_editor(page)
        try:
            if editor.count() and editor.is_visible(timeout=1000):
                return editor
        except Exception as exc:
            last_error = " ".join(str(exc).split())[:180]
        if allow_open_compose_entry:
            try:
                entry = page.locator(
                    'button:has-text("Start a post"), div[role="button"]:has-text("Start a post"), '
                    'button:has-text("投稿を開始"), div[role="button"]:has-text("投稿を開始"), '
                    '[aria-label*="Start a post"], [aria-label*="投稿を開始"]'
                ).first
                if entry.count() and entry.is_visible(timeout=800):
                    entry.click(timeout=3000)
                    page.wait_for_timeout(1500)
                    continue
            except Exception as exc:
                last_error = " ".join(str(exc).split())[:180]
            try:
                clicked = page.evaluate(
                    """() => {
                      const isVisible = (node) => Boolean(
                        node && node.getClientRects && node.getClientRects().length &&
                        getComputedStyle(node).visibility !== 'hidden' &&
                        getComputedStyle(node).display !== 'none'
                      );
                      const nodes = Array.from(document.querySelectorAll('button, div[role="button"], [aria-label]'));
                      const target = nodes.find((node) => {
                        const label = `${node.innerText || node.textContent || ''} ${node.getAttribute('aria-label') || ''}`;
                        return isVisible(node) && (/Start a post/i.test(label) || label.includes('投稿を開始'));
                      });
                      if (!target) return false;
                      target.click();
                      return true;
                    }"""
                )
                if clicked:
                    page.wait_for_timeout(1500)
                    continue
            except Exception as exc:
                last_error = " ".join(str(exc).split())[:180]
        page.wait_for_timeout(800)
    raise RuntimeError(
        "body_not_reflected: LinkedIn composer editor was not visible after opening compose"
        + (f" ({last_error})" if last_error else "")
    )


def _set_linkedin_editor_body(editor, body: str) -> str:
    try:
        editor.click(timeout=5000)
    except Exception:
        pass
    try:
        editor.press("ControlOrMeta+A", timeout=5000)
        editor.press("Backspace", timeout=5000)
    except Exception:
        pass
    reflected = _locator_text(editor)
    if _contains_linkedin_body_readback(reflected, body):
        return reflected
    for chunk in re.split(r"(\n)", body):
        if not chunk:
            continue
        try:
            if chunk == "\n":
                editor.press("Enter", timeout=5000)
            else:
                timeout = max(15000, min(90000, len(chunk) * 120))
                editor.press_sequentially(chunk, delay=2, timeout=timeout)
        except Exception:
            break
    return _locator_text(editor)


def _ensure_linkedin_link_card_reflected(page, source_url: str, timeout_seconds: float, root=None) -> None:
    host = urlparse(source_url).netloc.lower().removeprefix("www.")
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            scope = root or _linkedin_latest_composer_root(page)
            if scope is None:
                page.wait_for_timeout(1000)
                continue
            reflected = scope.evaluate(
                """(node, host) => {
                    const normalizedHost = String(host || "").toLowerCase().replace(/^www\\./, "");
                    if (!normalizedHost) return false;
                    const outsideEditor = (node) => !node.closest?.('[contenteditable="true"]');
                    const hostMatches = (value) => {
                        try {
                            return new URL(String(value || ""), location.href).hostname
                                .toLowerCase()
                                .replace(/^www\\./, "") === normalizedHost;
                        } catch (_) {
                            return false;
                        }
                    };
                    for (const anchor of Array.from(node.querySelectorAll('a[href]'))) {
                        if (outsideEditor(anchor) && hostMatches(anchor.href || anchor.getAttribute('href'))) {
                            return true;
                        }
                    }
                    const previewNodes = Array.from(node.querySelectorAll(
                        '[data-test-app-aware-link], article, [role="article"], [class*="preview"], [class*="attachment"], [class*="share"]'
                    ));
                    return previewNodes.some((node) =>
                        outsideEditor(node) &&
                        String(node.innerText || node.textContent || "").toLowerCase().includes(normalizedHost)
                    );
                }""",
                host,
            )
            if reflected:
                return
        except Exception:
            pass
        page.wait_for_timeout(1000)
    raise RuntimeError("link_card_not_reflected: LinkedIn official link preview was not visible.")


def _linkedin_photo_button(page):
    preflight_selector = 'div[role="button"]:has-text("Photo"), div[role="button"]:has-text("写真")'
    try:
        preflight_photo = page.locator(preflight_selector).first
        if preflight_photo.is_visible(timeout=700) and preflight_photo.is_enabled(timeout=700):
            return preflight_photo
    except Exception:
        pass
    root_selectors = [
        '[data-test-id*="share-box"]',
        ".share-box-feed-entry",
        ".share-box",
        ".share-creation-state",
    ]
    selectors = [
        'div[role="button"]:has-text("Photo")',
        'div[role="button"]:has-text("写真")',
        'button:has-text("Photo")',
        'button:has-text("写真")',
        '[aria-label*="Photo"]',
        '[aria-label*="写真"]',
    ]
    def share_box_text(value: str, *, compact_required: bool = False) -> bool:
        compact = " ".join(str(value or "").split())
        if re.search(r"Feed post|Sort by|Recommended for you|Promoted", compact, re.I):
            return False
        if compact_required:
            english = re.search(r"^Start a post\s*Video\s*Photo\s*Write article\b", compact, re.I)
            japanese = re.search(r"^投稿を開始\s*(動画|ビデオ)\s*写真", compact, re.I)
            return bool((english or japanese) and len(compact) < 160)
        return bool(re.search(r"Start a post|投稿を開始", compact, re.I) and re.search(r"Photo|写真", compact, re.I))

    for root_selector in root_selectors:
        roots = page.locator(root_selector)
        for root_index in range(min(roots.count(), 8)):
            root = roots.nth(root_index)
            try:
                if not root.is_visible(timeout=500):
                    continue
                if not share_box_text(_locator_text(root), compact_required=True):
                    continue
            except Exception:
                continue
            for selector in selectors:
                locator = root.locator(selector)
                for index in range(min(locator.count(), 4)):
                    candidate = locator.nth(index)
                    try:
                        if candidate.is_visible(timeout=500) and candidate.is_enabled(timeout=500):
                            return candidate
                    except Exception:
                        continue

    broad_roots = [
        page.locator('section[aria-label="Primary content"], main[role="main"]').first,
        page.locator("main").first,
    ]
    for broad_root in broad_roots:
        try:
            if not broad_root.is_visible(timeout=500):
                continue
        except Exception:
            continue
        candidates = broad_root.locator("div").filter(has_text=re.compile(r"Start a post|投稿を開始", re.I))
        for root_index in range(min(candidates.count(), 20)):
            root = candidates.nth(root_index)
            try:
                if not root.is_visible(timeout=500):
                    continue
                if not share_box_text(_locator_text(root)):
                    continue
            except Exception:
                continue
            for selector in selectors[:4]:
                locator = root.locator(selector)
                for index in range(min(locator.count(), 4)):
                    candidate = locator.nth(index)
                    try:
                        if candidate.is_visible(timeout=500) and candidate.is_enabled(timeout=500):
                            return candidate
                    except Exception:
                        continue
    raise RuntimeError("media_upload_permission_blocked: linkedin_photo_route_unavailable")


def _linkedin_file_payload(media_paths: list[Path]) -> str | list[str]:
    values = [str(path) for path in media_paths]
    if len(values) == 1:
        return values[0]
    return values


def _linkedin_publish_diagnostic_snapshot(page, *, row_id: str, stage: str, reason: str = "") -> dict:
    artifact_dir = Path("artifacts/browser-diagnostics")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    safe_row_id = re.sub(r"[^A-Za-z0-9_.-]+", "-", row_id or "unknown").strip("-") or "unknown"
    safe_stage = re.sub(r"[^A-Za-z0-9_.-]+", "-", stage or "stage").strip("-") or "stage"
    screenshot_path = artifact_dir / f"{stamp}-linkedin-publish-{safe_row_id}-{safe_stage}.png"
    json_path = artifact_dir / f"{stamp}-linkedin-publish-{safe_row_id}-{safe_stage}.json"
    data: dict = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "row_id": row_id,
        "stage": stage,
        "reason": reason,
        "url": "",
        "title": "",
        "screenshot_path": str(screenshot_path),
    }
    try:
        data["url"] = page.url
    except Exception:
        pass
    try:
        data["title"] = page.title()
    except Exception:
        pass
    try:
        data.update(
            page.evaluate(
                """() => {
                    const visibleEnough = (node) => {
                        const rect = node.getBoundingClientRect?.();
                        const style = window.getComputedStyle?.(node);
                        return !!rect && rect.width > 2 && rect.height > 2 &&
                            (!style || (style.visibility !== "hidden" && style.display !== "none"));
                    };
                    const buttonDetails = (selector, labelPattern) => {
                        const nodes = Array.from(document.querySelectorAll(selector));
                        const matched = nodes.filter((node) => labelPattern.test(node.innerText || node.textContent || node.getAttribute("aria-label") || ""));
                        return {
                            count: matched.length,
                            visible: matched.some(visibleEnough),
                            enabled: matched.some((node) => visibleEnough(node) && !node.disabled && node.getAttribute("aria-disabled") !== "true"),
                            labels: matched.slice(-8).map((node) => (node.innerText || node.textContent || node.getAttribute("aria-label") || "").trim()).filter(Boolean)
                        };
                    };
                    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .artdeco-modal'));
                    const visibleDialogs = dialogs.filter(visibleEnough);
                    const mediaSelector = 'img[src^="blob:"], img[src^="data:"], img[alt*="preview" i], img[alt*="upload" i], [data-test-id*="preview" i] img, [data-test-id*="media" i] img, [class*="image-preview" i] img, [class*="media-preview" i] img';
                    const genericMediaImages = (root) => Array.from(root.querySelectorAll('img')).filter((img) => {
                        if (!visibleEnough(img) || img.closest?.('[contenteditable="true"], .ql-editor')) return false;
                        const rect = img.getBoundingClientRect?.();
                        const label = `${img.getAttribute('alt') || ''} ${img.getAttribute('src') || ''} ${img.className || ''}`;
                        return rect && rect.width >= 120 && rect.height >= 80 && !/profile|avatar|member|open to work/i.test(label);
                    });
                    const next = buttonDetails('button, [role="button"]', /\\bNext\\b|次へ/i);
                    const post = buttonDetails('button, [role="button"]', /\\bPost\\b|投稿/i);
                    return {
                        body_text_sample: (document.body?.innerText || document.body?.textContent || "").slice(0, 3000),
                        dialog_count: dialogs.length,
                        visible_dialog_count: visibleDialogs.length,
                        editor_count: document.querySelectorAll('[contenteditable="true"], .ql-editor').length,
                        file_input_count: document.querySelectorAll('input[type="file"]').length,
                        img_count: document.querySelectorAll('img').length,
                        blob_img_count: document.querySelectorAll('img[src^="blob:"]').length,
                        data_img_count: document.querySelectorAll('img[src^="data:"]').length,
                        preview_img_count: document.querySelectorAll(mediaSelector).length,
                        next_button_count: next.count,
                        next_button_visible: next.visible,
                        next_button_enabled: next.enabled,
                        next_button_labels: next.labels,
                        post_button_count: post.count,
                        post_button_visible: post.visible,
                        post_button_enabled: post.enabled,
                        post_button_labels: post.labels,
                        visible_dialog_details: visibleDialogs.slice(-5).map((dialog, index) => ({
                            index,
                            text_sample: (dialog.innerText || dialog.textContent || "").slice(0, 1200),
                            editor_count: dialog.querySelectorAll('[contenteditable="true"], .ql-editor').length,
                            img_count: dialog.querySelectorAll('img').length,
                            blob_img_count: dialog.querySelectorAll('img[src^="blob:"]').length,
                            data_img_count: dialog.querySelectorAll('img[src^="data:"]').length,
                            preview_img_count: dialog.querySelectorAll(mediaSelector).length,
                            generic_large_img_count: genericMediaImages(dialog).length,
                            button_texts: Array.from(dialog.querySelectorAll('button, [role="button"]')).slice(-20)
                                .map((node) => (node.innerText || node.textContent || node.getAttribute("aria-label") || "").trim())
                                .filter(Boolean)
                        }))
                    };
                }"""
            )
        )
    except Exception as exc:
        data["evaluate_error"] = str(exc)
    try:
        page.screenshot(path=str(screenshot_path), full_page=True)
    except Exception as exc:
        data["screenshot_error"] = str(exc)
        data["screenshot_path"] = ""
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    data["json_path"] = str(json_path)
    return data


def _upload_linkedin_media_via_photo_route(
    page,
    media_paths: list[Path],
    *,
    timeout_seconds: float,
    row_id: str = "",
) -> None:
    _close_stale_linkedin_composer_ui(page)
    try:
        page.bring_to_front()
    except Exception:
        pass
    _linkedin_publish_diagnostic_snapshot(page, row_id=row_id, stage="photo_before")
    photo = _linkedin_photo_button(page)
    try:
        with page.expect_file_chooser(timeout=int(timeout_seconds * 1000)) as chooser_info:
            photo.click(timeout=8000)
        chooser_info.value.set_files(_linkedin_file_payload(media_paths))
        page.wait_for_timeout(6000)
        _linkedin_publish_diagnostic_snapshot(page, row_id=row_id, stage="after_file_set_filechooser")
    except Exception as exc:
        page.wait_for_timeout(1200)
        _linkedin_publish_diagnostic_snapshot(page, row_id=row_id, stage="after_photo_click_fallback", reason=str(exc))
        inputs = page.locator('input[type="file"]')
        if inputs.count() == 0:
            try:
                photo.click(timeout=5000, force=True)
                page.wait_for_timeout(1200)
            except Exception:
                pass
        inputs = page.locator('input[type="file"]')
        if inputs.count() == 0:
            _linkedin_publish_diagnostic_snapshot(
                page,
                row_id=row_id,
                stage="file_input_missing",
                reason="linkedin_file_input_not_materialized_after_photo_route",
            )
            raise RuntimeError(
                "media_upload_permission_blocked: linkedin_file_input_not_materialized_after_photo_route"
            ) from exc
        inputs.last.set_input_files(_linkedin_file_payload(media_paths), timeout=15000)
        _linkedin_publish_diagnostic_snapshot(page, row_id=row_id, stage="after_file_set_input")
    root = _linkedin_latest_composer_root(page)
    next_button = _linkedin_media_editor_next_button(page, min_count=len(media_paths))
    editor_root = _linkedin_visible_media_editor_root(page, min_count=len(media_paths))
    preview_visible = bool(
        root and _linkedin_media_attachment_reflected(root, min_count=len(media_paths), allow_count_only=True)
    ) or bool(editor_root) or bool(next_button and _linkedin_media_editor_count_text_visible(page, min_count=len(media_paths)))
    _linkedin_publish_diagnostic_snapshot(
        page,
        row_id=row_id,
        stage="before_next",
        reason=f"preview_visible={bool(preview_visible)}",
    )
    if not preview_visible:
        _linkedin_publish_diagnostic_snapshot(
            page,
            row_id=row_id,
            stage="retry_photo_route_before_next",
            reason="first_filechooser_set_did_not_open_linkedin_editor_preview",
        )
        _close_stale_linkedin_composer_ui(page)
        page.wait_for_timeout(1200)
        retry_photo = _linkedin_photo_button(page)
        try:
            with page.expect_file_chooser(timeout=int(timeout_seconds * 1000)) as chooser_info:
                retry_photo.click(timeout=8000)
            chooser_info.value.set_files(_linkedin_file_payload(media_paths))
            page.wait_for_timeout(9000)
            _linkedin_publish_diagnostic_snapshot(page, row_id=row_id, stage="retry_after_file_set_filechooser")
        except Exception as exc:
            page.wait_for_timeout(1200)
            _linkedin_publish_diagnostic_snapshot(
                page,
                row_id=row_id,
                stage="retry_photo_route_filechooser_failed",
                reason=str(exc),
            )
            inputs = page.locator('input[type="file"]')
            if inputs.count():
                inputs.last.set_input_files(_linkedin_file_payload(media_paths), timeout=15000)
                _linkedin_publish_diagnostic_snapshot(page, row_id=row_id, stage="retry_after_file_set_input")
        root = _linkedin_latest_composer_root(page)
        next_button = _linkedin_media_editor_next_button(page, min_count=len(media_paths))
        editor_root = _linkedin_visible_media_editor_root(page, min_count=len(media_paths))
        preview_visible = bool(
            root and _linkedin_media_attachment_reflected(root, min_count=len(media_paths), allow_count_only=True)
        ) or bool(editor_root) or bool(next_button and _linkedin_media_editor_count_text_visible(page, min_count=len(media_paths)))
        _linkedin_publish_diagnostic_snapshot(
            page,
            row_id=row_id,
            stage="before_next_retry",
            reason=f"preview_visible={bool(preview_visible)}",
        )
    if next_button and next_button.count() and next_button.is_visible(timeout=1500):
        if not next_button.is_enabled(timeout=1500):
            _linkedin_publish_diagnostic_snapshot(
                page,
                row_id=row_id,
                stage="next_disabled",
                reason="linkedin_photo_editor_next_disabled",
            )
            raise RuntimeError("surface_missing: linkedin_photo_editor_next_disabled")
        if not preview_visible:
            _linkedin_publish_diagnostic_snapshot(
                page,
                row_id=row_id,
                stage="preview_missing_before_next",
                reason="linkedin_photo_editor_preview_missing_before_next",
            )
            raise RuntimeError("surface_missing: linkedin_photo_editor_preview_missing_before_next")
        next_button.click(timeout=8000)
        page.wait_for_timeout(4000)
        _linkedin_publish_diagnostic_snapshot(page, row_id=row_id, stage="after_next")
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        root = _linkedin_latest_composer_root(page)
        if (
            (root and _linkedin_media_attachment_reflected(root, min_count=len(media_paths)))
            or _linkedin_post_media_composer_signal_reflected(page)
            or _linkedin_ax_media_composer_signal_reflected(page, min_count=len(media_paths))
        ):
            return
        page.wait_for_timeout(800)
    _linkedin_publish_diagnostic_snapshot(
        page,
        row_id=row_id,
        stage="attachment_missing_after_next",
        reason="linkedin_media_attachment_not_reflected_after_next",
    )
    raise RuntimeError("surface_missing: linkedin_media_attachment_not_reflected_after_next")


def _linkedin_media_attachment_reflected(root, *, min_count: int = 1, allow_count_only: bool = False) -> bool:
    try:
        reflected_count = root.evaluate(
            """({minCount, allowCountOnly}) => {
                const outsideEditor = (node) => !node.closest?.('[contenteditable="true"]');
                const mediaSelectors = [
                    'img[src^="blob:"]',
                    'img[src^="data:"]',
                    'img[alt*="preview" i]',
                    'img[alt*="upload" i]',
                    '[data-test-id*="preview" i] img',
                    '[data-test-id*="media" i] img',
                    '[class*="image-preview" i] img',
                    '[class*="media-preview" i] img'
                ];
                const visibleEnough = (item) => {
                    const rect = item?.getBoundingClientRect?.();
                    const style = item ? getComputedStyle(item) : null;
                    return !!rect && rect.width > 2 && rect.height > 2 &&
                        (!style || (style.visibility !== 'hidden' && style.display !== 'none'));
                };
                const mediaNodes = Array.from(node.querySelectorAll(mediaSelectors.join(','))).filter(
                    (item) => outsideEditor(item) && visibleEnough(item)
                );
                const genericMediaNodes = Array.from(node.querySelectorAll('img')).filter((img) => {
                    if (!outsideEditor(img) || !visibleEnough(img)) return false;
                    const rect = img.getBoundingClientRect?.();
                    const label = `${img.getAttribute('alt') || ''} ${img.getAttribute('src') || ''} ${img.className || ''}`;
                    return rect && rect.width >= 120 && rect.height >= 80 && !/profile|avatar|member|open to work/i.test(label);
                });
                const min = Number(minCount || 1);
                const countText = node.innerText || node.textContent || "";
                const credentialSignal = /Content credentials label added|Add alt text|Edit alt text|\bALT\b|代替テキスト/i.test(countText);
                const countReflected = (() => {
                    const patterns = [
                        /\\b(\\d+)\\s*of\\s*(\\d+)\\b/gi,
                        /\\b(\\d+)\\s*\\/\\s*(\\d+)\\b/g,
                        /(\\d+)\\s*枚中/g
                    ];
                    for (const pattern of patterns) {
                        for (const match of countText.matchAll(pattern)) {
                            const total = Number(match[2] || match[1]);
                            if (Number.isFinite(total) && total >= min) return true;
                        }
                    }
                    return false;
                })();
                return mediaNodes.length >= min ||
                    genericMediaNodes.length >= min ||
                    (credentialSignal && (min <= 1 || countReflected)) ||
                    (countReflected && (allowCountOnly || mediaNodes.length > 0 || genericMediaNodes.length > 0));
            }""",
            {"minCount": min_count, "allowCountOnly": allow_count_only},
        )
        return bool(reflected_count)
    except Exception:
        return False


def _linkedin_visible_media_editor_root(page, *, min_count: int = 1):
    roots = page.locator('[role="dialog"], .artdeco-modal')
    for root_index in range(roots.count() - 1, -1, -1):
        root = roots.nth(root_index)
        try:
            if root.is_visible(timeout=700) and _linkedin_media_editor_root_reflected(root, min_count=min_count):
                return root
        except Exception:
            continue
    return None


def _linkedin_media_editor_next_button(page, *, min_count: int = 1):
    selectors = [
        'button:has-text("Next")',
        'button[aria-label="Next"]',
        'button[aria-label^="Next "]',
        'button:has-text("次へ")',
        'button[aria-label="次へ"]',
        'button[aria-label^="次へ "]',
    ]
    roots = page.locator('[role="dialog"], .artdeco-modal')
    for root_index in range(roots.count() - 1, -1, -1):
        root = roots.nth(root_index)
        try:
            if not root.is_visible(timeout=700):
                continue
            if not _linkedin_media_editor_root_reflected(root, min_count=min_count):
                continue
            for selector in selectors:
                buttons = root.locator(selector)
                for button_index in range(buttons.count() - 1, -1, -1):
                    button = buttons.nth(button_index)
                    try:
                        label = " ".join(
                            part.strip()
                            for part in [
                                button.get_attribute("aria-label") or "",
                                _locator_text(button),
                            ]
                            if part and part.strip()
                        )
                        if not re.search(r"^(Next|次へ)(\s|$)", label, flags=re.IGNORECASE):
                            continue
                        if re.search(r"page of document|document|carousel", label, flags=re.IGNORECASE):
                            continue
                        if button.is_visible(timeout=700):
                            return button
                    except Exception:
                        continue
        except Exception:
            continue
    if _linkedin_media_editor_count_text_visible(page, min_count=min_count):
        return _linkedin_visible_media_editor_next_button_by_text(page)
    return None


def _linkedin_visible_media_editor_next_button_by_text(page):
    selectors = [
        'button:has-text("Next")',
        'button[aria-label="Next"]',
        'button[aria-label^="Next "]',
        'button:has-text("次へ")',
        'button[aria-label="次へ"]',
        'button[aria-label^="次へ "]',
    ]
    for selector in selectors:
        buttons = page.locator(selector)
        for index in range(buttons.count() - 1, -1, -1):
            button = buttons.nth(index)
            try:
                if button.is_visible(timeout=700) and button.is_enabled(timeout=700):
                    return button
            except Exception:
                continue
    for label in (re.compile(r"^Next$", re.I), re.compile(r"^次へ$", re.I)):
        try:
            button = page.get_by_role("button", name=label).last
            if button.is_visible(timeout=700) and button.is_enabled(timeout=700):
                return button
        except Exception:
            continue
    return None


def _linkedin_media_editor_count_text_visible(page, *, min_count: int = 1) -> bool:
    patterns = [
        re.compile(rf"\b1\s+of\s+{min_count}\b", re.I),
        re.compile(rf"\b1\s*/\s*{min_count}\b", re.I),
        re.compile(rf"{min_count}\s*枚", re.I),
        re.compile(rf"{min_count}\s*件", re.I),
    ]
    for pattern in patterns:
        try:
            if page.get_by_text(pattern, exact=False).first.is_visible(timeout=700):
                return True
        except Exception:
            continue
    return False


def _linkedin_media_editor_root_reflected(root, *, min_count: int = 1) -> bool:
    try:
        return bool(
            root.evaluate(
                """({minCount}) => {
                    const min = Number(minCount || 1);
                    const visibleEnough = (node) => {
                        const rect = node?.getBoundingClientRect?.();
                        const style = node ? getComputedStyle(node) : null;
                        return !!rect && rect.width > 2 && rect.height > 2 &&
                            (!style || (style.visibility !== 'hidden' && style.display !== 'none'));
                    };
                    const text = node.innerText || node.textContent || "";
                    const countPatterns = [
                        /\\b(\\d+)\\s*of\\s*(\\d+)\\b/gi,
                        /\\b(\\d+)\\s*\\/\\s*(\\d+)\\b/g,
                        /(\\d+)\\s*枚中/g
                    ];
                    let countReflected = false;
                    for (const pattern of countPatterns) {
                        for (const match of text.matchAll(pattern)) {
                            const total = Number(match[2] || match[1]);
                            if (Number.isFinite(total) && total >= min) countReflected = true;
                        }
                    }
                    const mediaSelectors = [
                        'img[src^="blob:"]',
                        'img[src^="data:"]',
                        'img[alt*="preview" i]',
                        'img[alt*="upload" i]',
                        '[data-test-id*="preview" i] img',
                        '[data-test-id*="media" i] img',
                        '[class*="image-preview" i] img',
                        '[class*="media-preview" i] img'
                    ];
                    const mediaNodes = Array.from(node.querySelectorAll(mediaSelectors.join(','))).filter(
                        (item) => visibleEnough(item) && !item.closest?.('[contenteditable="true"], .ql-editor')
                    );
                    return countReflected || mediaNodes.length >= min;
                }""",
                {"minCount": min_count},
            )
        )
    except Exception:
        return False


def _linkedin_media_editor_count_reflected(page, *, min_count: int = 1) -> bool:
    def next_visible() -> bool:
        try:
            next_button = _linkedin_media_editor_next_button(page, min_count=min_count)
            return bool(next_button and next_button.count() and next_button.is_visible(timeout=700))
        except Exception:
            return False

    patterns = [
        re.compile(rf"\b1\s+of\s+{min_count}\b", re.I),
        re.compile(rf"\b1\s*/\s*{min_count}\b", re.I),
        re.compile(rf"{min_count}\s*枚", re.I),
        re.compile(rf"{min_count}\s*件", re.I),
    ]
    for pattern in patterns:
        try:
            if page.get_by_text(pattern, exact=False).first.is_visible(timeout=700):
                return next_visible()
        except Exception:
            continue
    if not next_visible():
        return False
    try:
        return bool(
            page.locator("body").evaluate(
                """({minCount}) => {
                    const min = Number(minCount || 1);
                    const text = document.body?.innerText || document.body?.textContent || "";
                    const patterns = [
                        /\\b(\\d+)\\s*of\\s*(\\d+)\\b/gi,
                        /\\b(\\d+)\\s*\\/\\s*(\\d+)\\b/g,
                        /(\\d+)\\s*枚中/g
                    ];
                    for (const pattern of patterns) {
                        for (const match of text.matchAll(pattern)) {
                            const total = Number(match[2] || match[1]);
                            if (Number.isFinite(total) && total >= min) return true;
                        }
                    }
                    return false;
                }""",
                {"minCount": min_count},
            )
        )
    except Exception:
        return False


def _linkedin_root_for_editor(page, editor):
    for selector in ('[role="dialog"]', ".artdeco-modal", ".share-box", ".share-creation-state"):
        try:
            root = page.locator(selector).filter(has=editor).last
            if root.count() and root.is_visible(timeout=700):
                return root
        except Exception:
            continue
    return None


def _linkedin_visible_dialog_media_reflected(page, *, min_count: int = 1, require_editor: bool = False) -> bool:
    try:
        return bool(
            page.evaluate(
                """({minCount, requireEditor}) => {
                    const min = Number(minCount || 1);
                    const mediaSelectors = [
                        'img[src^="blob:"]',
                        'img[src^="data:"]',
                        'img[alt*="preview" i]',
                        'img[alt*="upload" i]',
                        '[data-test-id*="preview" i] img',
                        '[data-test-id*="media" i] img',
                        '[class*="image-preview" i] img',
                        '[class*="media-preview" i] img'
                    ];
                    const visibleEnough = (node) => {
                        const rect = node.getBoundingClientRect?.();
                        return !!rect && rect.width > 2 && rect.height > 2;
                    };
                    for (const dialog of Array.from(document.querySelectorAll('[role="dialog"], .artdeco-modal'))) {
                        if (!visibleEnough(dialog)) continue;
                        const hasEditor = !!dialog.querySelector('[contenteditable="true"], .ql-editor');
                        if (requireEditor && !hasEditor) continue;
                        const mediaNodes = Array.from(dialog.querySelectorAll(mediaSelectors.join(','))).filter(
                            (node) => visibleEnough(node) && !node.closest?.('[contenteditable="true"], .ql-editor')
                        );
                        if (mediaNodes.length >= min) return true;
                    }
                    return false;
                }""",
                {"minCount": min_count, "requireEditor": require_editor},
            )
        )
    except Exception:
        return False


def _linkedin_visible_post_media_dialog_reflected(page, *, min_count: int = 1) -> bool:
    try:
        return bool(
            page.evaluate(
                """({minCount}) => {
                    const min = Number(minCount || 1);
                    const visibleEnough = (node) => {
                        const rect = node?.getBoundingClientRect?.();
                        const style = node ? getComputedStyle(node) : null;
                        return !!rect && rect.width > 2 && rect.height > 2 &&
                            (!style || (style.visibility !== 'hidden' && style.display !== 'none'));
                    };
                    const mediaSelectors = [
                        'img[src^="blob:"]',
                        'img[src^="data:"]',
                        'img[alt*="preview" i]',
                        'img[alt*="upload" i]',
                        '[data-test-id*="preview" i] img',
                        '[data-test-id*="media" i] img',
                        '[class*="image-preview" i] img',
                        '[class*="media-preview" i] img'
                    ];
                    for (const dialog of Array.from(document.querySelectorAll('[role="dialog"], .artdeco-modal'))) {
                        if (!visibleEnough(dialog)) continue;
                        const text = dialog.innerText || dialog.textContent || '';
                        const hasPostButton = Array.from(dialog.querySelectorAll('button, [role="button"]')).some((button) => {
                            if (!visibleEnough(button)) return false;
                            const label = `${button.getAttribute('aria-label') || ''} ${button.innerText || button.textContent || ''}`.trim();
                            return /^(Post|投稿)$/i.test(label.replace(/\\s+/g, ' ')) && !button.disabled;
                        });
                        if (!hasPostButton) continue;
                        const mediaNodes = Array.from(dialog.querySelectorAll(mediaSelectors.join(','))).filter((node) => {
                            if (!visibleEnough(node) || node.closest?.('[contenteditable="true"], .ql-editor')) return false;
                            const rect = node.getBoundingClientRect?.();
                            const alt = node.getAttribute?.('alt') || '';
                            const src = node.getAttribute?.('src') || '';
                            return rect && rect.width >= 120 && rect.height >= 80 && !/profile|avatar|member/i.test(`${alt} ${src}`);
                        });
                        const credentialSignal = /Content credentials label added|Add alt text|Edit alt text|\\bALT\\b|代替テキスト/i.test(text);
                        if (mediaNodes.length >= min || credentialSignal) return true;
                    }
                    return false;
                }""",
                {"minCount": min_count},
            )
        )
    except Exception:
        return False


def _linkedin_post_media_composer_signal_reflected(page, editor=None) -> bool:
    try:
        active_editor = editor or _linkedin_editor(page)
        if not (active_editor.count() and active_editor.is_visible(timeout=1000)):
            return _linkedin_ax_media_composer_signal_reflected(page)
        _visible_enabled_linkedin_post_button(page, active_editor)
        root = None
        try:
            root = page.locator('[role="dialog"]').filter(has=active_editor).last
            if not root.count():
                root = None
        except Exception:
            root = None
        if root is None:
            for selector in (".artdeco-modal", ".share-box", ".share-creation-state"):
                try:
                    candidate = page.locator(selector).filter(has=active_editor).last
                    if candidate.count():
                        root = candidate
                        break
                except Exception:
                    continue
        if root is None:
            root = _linkedin_latest_composer_root(page)
        if root is None:
            return False
        text = _locator_text(root)
        image_reflected = False
        try:
            image_reflected = bool(
                root.evaluate(
                    """(node) => {
                        const outsideEditor = (item) => !item.closest?.('[contenteditable="true"], .ql-editor');
                        return Array.from(node.querySelectorAll('img')).some((img) => {
                            if (!outsideEditor(img)) return false;
                            const rect = img.getBoundingClientRect?.();
                            if (!rect || rect.width < 120 || rect.height < 80) return false;
                            const alt = img.getAttribute('alt') || '';
                            const src = img.getAttribute('src') || '';
                            return !/profile|avatar|member/i.test(`${alt} ${src}`);
                        });
                    }"""
                )
            )
        except Exception:
            image_reflected = False
        return image_reflected or bool(
            re.search(
                r"Content credentials label added|Add alt text|Edit alt text|\bALT\b|代替テキスト",
                text,
                flags=re.IGNORECASE,
            )
        ) or _linkedin_ax_media_composer_signal_reflected(page)
    except Exception:
        return _linkedin_ax_media_composer_signal_reflected(page)


def _close_stale_linkedin_composer_ui(page) -> None:
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
    except Exception:
        return
    for label in ("Discard", "破棄", "Close", "閉じる", "Dismiss"):
        try:
            target = page.get_by_text(label, exact=True).first
            if target.is_visible(timeout=500):
                target.click(timeout=1500)
                page.wait_for_timeout(500)
                return
        except Exception:
            continue


def _capture_linkedin_recent_activity_urns(page, *, body: str = "", required: bool = False) -> set[str]:
    urns: set[str] = set()
    try:
        page.goto(
            "https://www.linkedin.com/in/nichika-tanaka-471693226/recent-activity/all/",
            wait_until="domcontentloaded",
            timeout=15000,
        )
        page.wait_for_timeout(2500)
        cards = page.locator("[data-urn*='urn:li:activity'], [data-urn*='urn:li:share']")
        for index in range(min(cards.count(), 12)):
            urn = cards.nth(index).get_attribute("data-urn") or ""
            if urn:
                urns.add(urn)
    except Exception as exc:
        if required:
            reason = " ".join(str(exc).split())[:240]
            raise RuntimeError(f"completion_capture_failed: LinkedIn recent activity prepublish snapshot failed {reason}") from exc
    if required and not urns:
        raise RuntimeError("completion_capture_failed: LinkedIn recent activity prepublish snapshot returned no activity URNs")
    return urns


def _capture_linkedin_recent_activity_urns_side_page(page, *, body: str = "", row_id: str = "") -> set[str]:
    snapshot_page = None
    try:
        snapshot_page = page.context.new_page()
        try:
            snapshot_page.bring_to_front()
        except Exception:
            pass
        return _capture_linkedin_recent_activity_urns(snapshot_page, body=body, required=True)
    except Exception as exc:
        reason = " ".join(str(exc).split())[:240]
        _linkedin_publish_diagnostic_snapshot(
            page,
            row_id=row_id,
            stage="recent_activity_snapshot_unavailable",
            reason=reason,
        )
        raise RuntimeError(f"completion_capture_failed: LinkedIn side-page prepublish snapshot failed {reason}") from exc
    finally:
        if snapshot_page is not None:
            try:
                snapshot_page.close()
            except Exception:
                pass
        try:
            page.bring_to_front()
        except Exception:
            pass


def _capture_linkedin_post_url(page, *, body: str, timeout_seconds: float, exclude_urns: set[str] | None = None) -> str:
    snippet = body[:50].strip()
    excluded = exclude_urns or set()
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        newest_unseen_href = ""
        try:
            page.goto(
                "https://www.linkedin.com/in/nichika-tanaka-471693226/recent-activity/all/",
                wait_until="domcontentloaded",
                timeout=15000,
            )
            page.wait_for_timeout(2500)
            cards = page.locator("[data-urn*='urn:li:activity'], [data-urn*='urn:li:share']")
            for index in range(min(cards.count(), 8)):
                card = cards.nth(index)
                card_text = _locator_text(card)
                urn = card.get_attribute("data-urn") or ""
                if urn and urn in excluded:
                    continue
                candidate_href = f"https://www.linkedin.com/feed/update/{urn}/" if urn else ""
                if urn:
                    if snippet and snippet not in card_text:
                        newest_unseen_href = newest_unseen_href or candidate_href
                        continue
                    return candidate_href
                hrefs = card.locator('a[href*="/feed/update/"]').evaluate_all("els => els.map(a => a.href)")
                for href in hrefs:
                    if any(excluded_urn and excluded_urn in href for excluded_urn in excluded):
                        continue
                    candidate_href = href.split("?")[0]
                    if snippet and snippet not in card_text:
                        newest_unseen_href = newest_unseen_href or candidate_href
                        continue
                    return candidate_href
            if excluded and newest_unseen_href:
                return newest_unseen_href
        except Exception:
            pass
        page.wait_for_timeout(1000)
    raise RuntimeError("completion_capture_failed: LinkedIn post URL was not visible after submit.")


def _wait_after_linkedin_submit(page, *, row_id: str, timeout_seconds: float) -> None:
    deadline = time.monotonic() + max(4.0, timeout_seconds)
    while time.monotonic() < deadline:
        try:
            body = page.locator("body").inner_text(timeout=2500)
            if re.search(r"Post successful|Your post has been shared|投稿しました|投稿が共有されました", body, re.I):
                break
        except Exception:
            pass
        try:
            editor = _linkedin_editor(page)
            if not (editor.count() and editor.is_visible(timeout=700)):
                break
        except Exception:
            break
        page.wait_for_timeout(800)
    _linkedin_publish_diagnostic_snapshot(page, row_id=row_id, stage="after_submit_wait")


def _publish_linkedin_link_card_local(page, row: QueueRow, *, timeout_seconds: float) -> str:
    if _surface_contract_label(row, "linkedin") != "linkedin_link_card":
        raise RuntimeError(
            f"surface_missing: unsupported LinkedIn surface {_surface_contract_label(row, 'linkedin') or 'blank'}."
        )
    body = _body_with_source_url(row, "linkedin")
    source_url = _candidate_source_url_required(row, "linkedin")
    _ensure_linkedin_feed_ready(page, timeout_seconds=timeout_seconds)
    exclude_urns = _capture_linkedin_recent_activity_urns(page, body=body, required=True)
    page.goto(
        f"https://www.linkedin.com/feed/?shareActive=true&text={quote(body)}",
        wait_until="domcontentloaded",
        timeout=int(timeout_seconds * 1000),
    )
    editor = _wait_for_linkedin_editor(
        page, timeout_seconds=max(timeout_seconds, 15.0), allow_open_compose_entry=True
    )
    reflected = _locator_text(editor)
    if not _contains_linkedin_body_readback(reflected, body):
        reflected = _set_linkedin_editor_body(editor, body)
    if not _contains_linkedin_body_readback(reflected, body):
        raise RuntimeError("body_not_reflected: LinkedIn composer did not contain linkedin_text.")
    root = _linkedin_latest_composer_root(page)
    _ensure_linkedin_link_card_reflected(page, source_url, timeout_seconds, root=root)
    submit = _visible_enabled_linkedin_post_button(page, editor)
    submit.click(timeout=10000)
    _wait_after_linkedin_submit(page, row_id=row.id, timeout_seconds=8.0)
    return _capture_linkedin_post_url(page, body=body, timeout_seconds=max(timeout_seconds, 20.0), exclude_urns=exclude_urns)


def _publish_linkedin_text_url_no_media_local(page, row: QueueRow, *, timeout_seconds: float) -> str:
    body = _body_with_source_url(row, "linkedin")
    source_url = _candidate_source_url_required(row, "linkedin")
    if source_url not in body:
        raise RuntimeError("body_not_reflected: LinkedIn no-media fallback must include source_url.")
    _ensure_linkedin_feed_ready(page, timeout_seconds=timeout_seconds)
    exclude_urns = _capture_linkedin_recent_activity_urns(page, body=body, required=True)
    page.goto(
        f"https://www.linkedin.com/feed/?shareActive=true&text={quote(body)}",
        wait_until="domcontentloaded",
        timeout=int(timeout_seconds * 1000),
    )
    editor = _wait_for_linkedin_editor(
        page, timeout_seconds=max(timeout_seconds, 15.0), allow_open_compose_entry=True
    )
    reflected = _locator_text(editor)
    if not _contains_linkedin_body_readback(reflected, body):
        reflected = _set_linkedin_editor_body(editor, body)
    if not _contains_linkedin_body_readback(reflected, body):
        raise RuntimeError("body_not_reflected: LinkedIn composer did not contain linkedin_text.")
    submit = _visible_enabled_linkedin_post_button(page, editor)
    submit.click(timeout=10000)
    _wait_after_linkedin_submit(page, row_id=row.id, timeout_seconds=8.0)
    return _capture_linkedin_post_url(page, body=body, timeout_seconds=max(timeout_seconds, 20.0), exclude_urns=exclude_urns)


def _publish_linkedin_generated_media_local(
    page,
    row: QueueRow,
    *,
    settings: Settings,
    timeout_seconds: float,
    count: int,
) -> str:
    row_id = row.id
    body = _normalize_browser_publish_body(row.linkedin_text)
    if not body:
        raise RuntimeError("body_not_reflected: linkedin_text is required.")
    source_url = row.source_url.strip()
    if source_url and source_url not in body:
        raise RuntimeError("surface_missing: LinkedIn generated-media posts must keep official source URL in linkedin_text.")
    media_paths = _ensure_generated_media_for_surface(row, platform="linkedin", count=count, settings=settings)
    page = _fresh_linkedin_publish_page(
        page,
        row_id=row_id,
        timeout_seconds=max(timeout_seconds, 15.0),
        stage="before_preflight_fresh_page",
        reason="fresh_page_before_no_post_media_preflight",
    )
    _preflight_linkedin_media_upload_paths_on_page(
        page,
        media_paths,
        row_id=row_id,
        timeout_seconds=max(timeout_seconds, 15.0),
    )
    page = _fresh_linkedin_publish_page_after_media_preflight(
        page,
        row_id=row_id,
        timeout_seconds=max(timeout_seconds, 15.0),
    )
    exclude_urns = _capture_linkedin_recent_activity_urns_side_page(page, body=body, row_id=row_id)
    _upload_linkedin_media_via_photo_route(
        page,
        media_paths,
        timeout_seconds=max(timeout_seconds, 15.0),
        row_id=row_id,
    )
    editor = None
    used_ax_editor = False
    try:
        editor = _wait_for_linkedin_editor(
            page, timeout_seconds=max(timeout_seconds, 15.0), allow_open_compose_entry=False
        )
        reflected = _set_linkedin_editor_body(editor, body)
    except RuntimeError as exc:
        if (
            "LinkedIn composer editor was not visible" not in str(exc)
            or not _linkedin_ax_media_composer_signal_reflected(page, min_count=len(media_paths))
        ):
            raise
        reflected = _set_linkedin_ax_editor_body(page, body)
        used_ax_editor = True
    if not _contains_linkedin_body_readback(reflected, body):
        _linkedin_publish_diagnostic_snapshot(
            page,
            row_id=row_id,
            stage="body_not_reflected_after_media",
            reason="linkedin_text_missing_after_media_upload",
        )
        raise RuntimeError("body_not_reflected: LinkedIn composer did not contain linkedin_text after media upload.")
    _linkedin_publish_diagnostic_snapshot(page, row_id=row_id, stage="before_submit")
    active_root = _linkedin_root_for_editor(page, editor) if editor is not None else None
    media_reflected = (
        (active_root and _linkedin_media_attachment_reflected(active_root, min_count=len(media_paths)))
        or _linkedin_post_media_composer_signal_reflected(page, editor=editor)
        or _linkedin_ax_media_composer_signal_reflected(page, min_count=len(media_paths))
    )
    if not media_reflected:
        _linkedin_publish_diagnostic_snapshot(
            page,
            row_id=row_id,
            stage="attachment_missing_before_submit",
            reason="linkedin_media_attachment_not_reflected_before_submit",
        )
        raise RuntimeError("surface_missing: linkedin_media_attachment_not_reflected_before_submit")
    if used_ax_editor:
        if not _click_linkedin_ax_post_button(page):
            raise RuntimeError("disabled_submit: LinkedIn Post button was not visible or enabled in the active AX composer.")
    else:
        submit = _visible_enabled_linkedin_post_button(page, editor)
        submit.click(timeout=10000)
    _wait_after_linkedin_submit(page, row_id=row_id, timeout_seconds=10.0)
    return _capture_linkedin_post_url(page, body=body, timeout_seconds=max(timeout_seconds, 25.0), exclude_urns=exclude_urns)


def _publish_linkedin_by_surface_local(page, row: QueueRow, *, settings: Settings, timeout_seconds: float) -> str:
    surface = _surface_contract_label(row, "linkedin")
    if surface == "linkedin_link_card":
        return _publish_linkedin_link_card_local(page, row, timeout_seconds=timeout_seconds)
    if surface == "linkedin_square_image":
        return _publish_linkedin_generated_media_local(
            page, row, settings=settings, timeout_seconds=timeout_seconds, count=1
        )
    if surface == "linkedin_carousel":
        return _publish_linkedin_generated_media_local(
            page, row, settings=settings, timeout_seconds=timeout_seconds, count=3
        )
    raise RuntimeError(f"surface_missing: unsupported LinkedIn surface {surface or 'blank'}.")


def _send_publish_candidates_local(
    *,
    path: str = "posting_queue.tsv",
    settings: Settings,
    max_publish_items: int = 3,
    sync_sheets: bool = True,
    remote_debugging_port: int | None = None,
    timeout_seconds: float = 20.0,
    dry_run: bool = False,
) -> dict[str, int | str]:
    raise RuntimeError(
        "legacy_playwright_publish_sender_disabled: use the Chrome plugin registered runner "
        "with recording and local proof gates for Daily AI publish."
    )
    repo = get_local_repo(path)
    candidates = _publish_flow_candidates(repo.read_all(), max_publish_items)
    if not candidates:
        return {"attempted": 0, "posted": 0, "skipped": 0, "sheets_synced_count": 0, "stop_reason": ""}
    if dry_run:
        return {
            "attempted": len(candidates),
            "posted": 0,
            "skipped": 0,
            "sheets_synced_count": 0,
            "stop_reason": "dry_run_publish_sender_skipped",
        }

    port = remote_debugging_port or settings.chrome_main_remote_debugging_port
    if _wait_for_chrome_cdp(port, timeout_seconds=min(timeout_seconds, 3.0)) is None:
        raise RuntimeError("local_automation_profile_unavailable: cdp_endpoint_unavailable")

    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright

    attempted = 0
    posted = 0
    skipped = 0
    stop_reason = ""
    failure_receipts: list[str] = []
    failure_reasons: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        page = context.new_page()
        try:
            _verify_main_chrome_profile_path(page, settings, timeout_seconds=timeout_seconds)
            for row in candidates:
                changed = False
                for platform in ("x", "linkedin"):
                    if platform == "x" and (row.x_post_url.strip() or not row.x_text.strip()):
                        continue
                    if platform == "linkedin" and (row.linkedin_post_url.strip() or not row.linkedin_text.strip()):
                        continue
                    attempted += 1
                    try:
                        if platform == "x":
                            post_url = _publish_x_by_surface_local(
                                page, row, settings=settings, timeout_seconds=timeout_seconds
                            )
                        else:
                            post_url = _publish_linkedin_by_surface_local(
                                page, row, settings=settings, timeout_seconds=timeout_seconds
                            )
                        _mark_platform_published(row, platform, post_url)
                        posted += 1
                        changed = True
                    except Exception as exc:
                        reason = " ".join(str(exc).split())[:240]
                        skipped += 1
                        _mark_platform_publish_failed(row, platform, reason)
                        failure_reasons.append(reason)
                        receipt = _automation_failure_receipt(reason)
                        if receipt and receipt not in failure_receipts:
                            failure_receipts.append(receipt)
                        changed = True
                if changed:
                    repo.update(row)
        except PlaywrightError as exc:
            raise RuntimeError(
                "local_automation_profile_unavailable: locator_control_failed "
                f"{type(exc).__name__}: {' '.join(str(exc).split())[:300]}"
            ) from exc
        finally:
            try:
                page.close()
            except Exception:
                pass

    sheets_synced_count = 0
    if sync_sheets:
        try:
            sheets_synced_count = _sync_local_queue_to_sheets_bounded(path)
        except Exception as exc:
            receipt = _automation_failure_receipt(f"sheets_sync_failed: {' '.join(str(exc).split())[:180]}")
            if receipt and receipt not in failure_receipts:
                failure_receipts.append(receipt)
    if attempted and skipped:
        stop_reason = _publish_failure_stop_reason(failure_reasons)
    return {
        "attempted": attempted,
        "posted": posted,
        "skipped": skipped,
        "sheets_synced_count": sheets_synced_count,
        "stop_reason": stop_reason,
        "media_receipt": "; ".join(failure_receipts),
    }


def _trusted_runner_failure_detail(raw: str) -> str:
    text = " ".join(str(raw or "").split())
    if not text:
        return ""
    try:
        payload = json.loads(text)
    except Exception:
        return text[:500]
    if isinstance(payload, dict):
        error = str(payload.get("error") or "").strip()
        if error:
            return " ".join(error.split())[:500]
        stop_reason = str(payload.get("stop_reason") or "").strip()
        if stop_reason:
            return " ".join(stop_reason.split())[:500]
    return text[:500]


def _trusted_bridge_receipt_dir(queue_path: str) -> Path:
    return Path(queue_path).resolve().parent / "artifacts" / "trusted-bridge-runs"


def _trusted_bridge_run_id(mode: str) -> str:
    stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    safe_stamp = re.sub(r"[^0-9A-Za-z_-]+", "-", stamp).strip("-")
    return f"{safe_stamp}-{mode}-{os.getpid()}"


def _trusted_runner_subprocess_timeout_seconds() -> float:
    raw = os.getenv("SOCIAL_FLOW_TRUSTED_RUNNER_SUBPROCESS_TIMEOUT_SECONDS", "240").strip()
    try:
        value = float(raw)
    except ValueError:
        return 240.0
    return max(30.0, value)


def _read_trusted_bridge_receipt(receipt_path: Path) -> dict[str, object]:
    try:
        payload = json.loads(receipt_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _trusted_bridge_receipt_failure_detail(receipt: dict[str, object]) -> str:
    for key in ("error", "stop_reason"):
        value = str(receipt.get(key) or "").strip()
        if value:
            return " ".join(value.split())[:500]
    return "trusted bridge receipt did not contain a result"


def _finalize_stale_trusted_bridge_receipt(receipt_path: Path, receipt: dict[str, object]) -> dict[str, object]:
    if str(receipt.get("status") or "").strip() != "running":
        return receipt
    reason = f"trusted_runner_bridge_running_receipt_stale: {receipt_path}"
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    failed_receipt = {
        **receipt,
        "ok": False,
        "status": "failed",
        "finished_at": now,
        "updated_at": now,
        "stop_reason": reason,
        "error": reason,
        "stale_watchdog": True,
    }
    try:
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
        receipt_path.write_text(json.dumps(failed_receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except Exception:
        return failed_receipt
    return failed_receipt


def _queue_blocker_fragment(row: QueueRow, markers: tuple[str, ...]) -> str:
    text = " ".join(part for part in [row.error.strip(), _current_publish_review_notes(row)] if part)
    if not text:
        return ""
    fragments = [part.strip() for part in re.split(r"[;\n]", text) if part.strip()]
    for fragment in fragments:
        active_fragment = _remove_stale_x_source_link_card_surface_blocker(row, fragment)
        if any(marker in active_fragment for marker in markers):
            return " ".join(active_fragment.split())[:500]
    for marker in markers:
        if marker in text:
            active_text = _remove_stale_x_source_link_card_surface_blocker(row, text)
            if marker not in active_text:
                continue
            start = max(0, active_text.find(marker) - 80)
            return " ".join(active_text[start : start + 500].split())
    return ""


def _current_publish_review_notes(row: QueueRow) -> str:
    parts = [part.strip() for part in row.review_notes.split("|") if part.strip()]
    last_clear_index = -1
    for index, part in enumerate(parts):
        if re.search(
            r"(?:Revalidated existing ship_now candidate|Auto-promoted from hold).*surface contract was clear",
            part,
            flags=re.IGNORECASE,
        ):
            last_clear_index = index
    if last_clear_index >= 0:
        parts = parts[last_clear_index + 1 :]
    return " | ".join(parts)


def _remove_stale_x_source_link_card_surface_blocker(row: QueueRow, fragment: str) -> str:
    if _surface_contract_label(row, "x") not in {"x_source_link_card", "x_text_url"}:
        return fragment
    return re.sub(
        r"(?:x_publish_failed:|x_publish_blocked:)?\s*surface_missing:\s*unsupported X surface x_source_link_card\.?",
        "",
        fragment,
        flags=re.IGNORECASE,
    ).strip()


def _pending_publish_completion_fragment(row: QueueRow) -> str:
    if row.x_text.strip() and not (row.x_post_url.strip() or row.x_post_id.strip()):
        return "x_publish_pending: external_publish_completion_required"
    if row.linkedin_text.strip() and not (row.linkedin_post_url.strip() or row.linkedin_post_id.strip()):
        return "linkedin_publish_pending: external_publish_completion_required"
    return ""


def _publish_queue_recovery_payload(path: str, candidate_ids: list[str]) -> dict[str, object]:
    if not candidate_ids:
        return {}
    try:
        rows = get_local_repo(path).read_all()
    except Exception:
        return {}
    wanted = set(candidate_ids)
    receipts: list[dict[str, object]] = []
    blockers: list[str] = []
    for row in rows:
        if row.id not in wanted:
            continue
        if row.x_post_url.strip() or row.x_post_id.strip():
            receipts.append(
                {
                    "id": row.id,
                    "platform": "x",
                    "post_url": row.x_post_url.strip(),
                    "post_id": row.x_post_id.strip(),
                    "completion": "posting_queue_recovered",
                }
            )
        if row.linkedin_post_url.strip() or row.linkedin_post_id.strip():
            receipts.append(
                {
                    "id": row.id,
                    "platform": "linkedin",
                    "post_url": row.linkedin_post_url.strip(),
                    "post_id": row.linkedin_post_id.strip(),
                    "completion": "posting_queue_recovered",
                }
            )
        blocker = _queue_blocker_fragment(
            row,
            (
                "account_not_verified",
                "body_not_reflected",
                "disabled_submit",
                "completion_not_captured",
                "publish_completion_not_captured",
                "url_capture_failed",
                "captcha",
                "auth",
                "wrong_account",
                "x_publish_failed",
                "linkedin_publish_failed",
                "media_upload_permission_blocked",
                "surface_missing",
                "link_card_not_reflected",
                "quote_card_not_reflected",
            ),
        )
        if not blocker:
            blocker = _pending_publish_completion_fragment(row)
        if blocker:
            blockers.append(f"{row.id}:{blocker}")
    if blockers:
        return {
            "published": 0,
            "skipped": len(blockers),
            "receipts": [
                *receipts,
                *[{"id": item.split(":", 1)[0], "error": item} for item in blockers],
            ],
            "stop_reason": "; ".join(blockers)[:500],
            "recovered_from": "posting_queue",
        }
    if receipts:
        return {
            "published": len(receipts),
            "skipped": 0,
            "receipts": receipts,
            "stop_reason": "",
            "recovered_from": "posting_queue",
        }
    return {}


def _engagement_queue_recovery_payload(path: str, candidate_ids: list[str]) -> dict[str, object]:
    if not candidate_ids:
        return {}
    try:
        rows = get_local_repo(path).read_all()
    except Exception:
        return {}
    wanted = set(candidate_ids)
    receipts: list[dict[str, object]] = []
    blockers: list[str] = []
    for row in rows:
        if row.id not in wanted:
            continue
        if row.engagement_status.strip() in {"sent", "done", "completed"} or row.engaged_at.strip():
            target = row.engagement_targets.strip()
            action = row.engagement_action.strip()
            if _engagement_platform(target) == "linkedin" and action == "like_candidate":
                blockers.append(f"{row.id}:engagement_recovery_unverified:linkedin_like_proof_missing")
                continue
            receipts.append(
                {
                    "id": row.id,
                    "action": action,
                    "target": target,
                    "completion": "posting_queue_recovered",
                }
            )
            continue
        blocker = _queue_blocker_fragment(
            row,
            (
                "engagement_send_failed",
                "account_not_verified",
                "body_not_reflected",
                "disabled_submit",
                "completion_not_captured",
                "captcha",
                "auth",
                "wrong_account",
            ),
        )
        if blocker:
            blockers.append(f"{row.id}:{blocker}")
    if receipts:
        return {
            "sent": len(receipts),
            "skipped": 0,
            "receipts": receipts,
            "stop_reason": "",
            "recovered_from": "posting_queue",
        }
    if blockers:
        return {
            "sent": 0,
            "skipped": len(blockers),
            "receipts": [{"id": item.split(":", 1)[0], "error": item} for item in blockers],
            "stop_reason": "; ".join(blockers)[:500],
            "recovered_from": "posting_queue",
        }
    return {}


def _recover_trusted_bridge_result(
    receipt_path: Path,
    *,
    mode: str,
    path: str,
    candidate_ids: list[str],
) -> dict[str, object]:
    receipt: dict[str, object] = {}
    poll_seconds_raw = os.getenv("SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_POLL_SECONDS", "").strip()
    if poll_seconds_raw:
        try:
            poll_seconds = float(poll_seconds_raw)
        except ValueError:
            poll_seconds = 180.0
    else:
        poll_seconds = 600.0 if mode == "official-job" else 180.0
    deadline = time.monotonic() + max(8.0, poll_seconds)
    while True:
        receipt = _read_trusted_bridge_receipt(receipt_path)
        result = receipt.get("result")
        if isinstance(result, dict):
            return result
        queue_payload = (
            _publish_queue_recovery_payload(path, candidate_ids)
            if mode == "publish"
            else _engagement_queue_recovery_payload(path, candidate_ids)
        )
        if queue_payload:
            return queue_payload
        status = str(receipt.get("status") or "").strip()
        if status in {"failed", "succeeded"}:
            raise RuntimeError(_trusted_bridge_receipt_failure_detail(receipt))
        if status == "running" and time.monotonic() < deadline:
            time.sleep(2)
            continue
        break
    status = str(receipt.get("status") or "").strip()
    if status == "running":
        failed_receipt = _finalize_stale_trusted_bridge_receipt(receipt_path, receipt)
        raise RuntimeError(_trusted_bridge_receipt_failure_detail(failed_receipt))
    raise RuntimeError(f"no_durable_receipt_after_timeout: {receipt_path}")


def _publish_receipt_completed(receipt: dict[str, object], queue_rows_by_id: dict[str, QueueRow]) -> bool:
    if receipt.get("error"):
        return False
    platform = str(receipt.get("platform") or "").strip().lower()
    post_url = str(receipt.get("post_url") or "").strip()
    if not platform and post_url:
        if "linkedin.com/" in post_url:
            platform = "linkedin"
        elif "x.com/" in post_url or "twitter.com/" in post_url:
            platform = "x"
    if platform not in {"x", "linkedin"}:
        return False
    if post_url or str(receipt.get("post_id") or "").strip():
        return True
    row = queue_rows_by_id.get(str(receipt.get("id") or ""))
    if not row:
        return False
    if platform == "x":
        return bool(row.x_post_url.strip() or row.x_post_id.strip())
    return bool(row.linkedin_post_url.strip() or row.linkedin_post_id.strip())


def _publish_sender_result_from_profile2_payload(
    parsed: dict[str, object],
    *,
    path: str,
    sync_sheets: bool,
    dry_run: bool,
) -> dict[str, object]:
    parsed_posted = int(parsed.get("published", parsed.get("posted", 0)) or 0)
    parsed_skipped = int(parsed.get("skipped", 0) or 0)
    receipts = parsed.get("receipts", [])
    receipt_errors = []
    receipt_error_reasons = []
    queue_rows_by_id: dict[str, QueueRow] | None = None

    def queue_rows() -> dict[str, QueueRow]:
        nonlocal queue_rows_by_id
        if queue_rows_by_id is None:
            try:
                queue_rows_by_id = {row.id: row for row in get_local_repo(path).read_all()}
            except Exception:
                queue_rows_by_id = {}
        return queue_rows_by_id

    posted = parsed_posted
    skipped = parsed_skipped
    if isinstance(receipts, list):
        posted = 0
        skipped = 0
        completed_receipts = 0
        for receipt in receipts:
            if not isinstance(receipt, dict):
                continue
            if receipt.get("error"):
                receipt_error = str(receipt.get("error") or "")
                receipt_error_reasons.append(receipt_error)
                receipt_errors.append(_automation_failure_receipt(receipt_error))
                skipped += 1
                continue
            has_inline_completion = bool(
                str(receipt.get("post_url") or "").strip() or str(receipt.get("post_id") or "").strip()
            )
            if _publish_receipt_completed(receipt, {} if has_inline_completion else queue_rows()):
                posted += 1
                completed_receipts += 1
                continue
            skipped += 1
        if not receipts:
            posted = 0
            skipped = parsed_skipped if dry_run else max(parsed_skipped, parsed_posted)
    media_receipt = "; ".join(dict.fromkeys(part for part in receipt_errors if part))
    sheets_synced_count = 0
    if sync_sheets and not dry_run and (posted or skipped):
        try:
            sheets_synced_count = _sync_local_queue_to_sheets(get_local_repo(path), get_repo())
        except Exception as exc:
            typer.echo(f"Skipped Google Sheets mirror sync after Chrome Extension publish: {exc}")
    parsed_stop_reason = str(parsed.get("stop_reason") or "").strip()
    stop_reason = ""
    if skipped:
        stop_reason = parsed_stop_reason or _publish_failure_stop_reason(receipt_error_reasons)
    elif not posted:
        stop_reason = parsed_stop_reason or ("dry_run_publish_sender_skipped" if dry_run else "")
    return {
        "backend": "chrome_extension_profile2_fallback",
        "attempted": posted + skipped,
        "posted": posted,
        "skipped": skipped,
        "sheets_synced_count": sheets_synced_count,
        "stop_reason": stop_reason,
        "media_receipt": media_receipt,
        "receipts": receipts,
        "bridge_run_id": parsed.get("bridge_run_id", ""),
        "bridge_receipt_path": parsed.get("bridge_receipt_path", ""),
    }


def _engagement_sender_result_from_profile2_payload(
    parsed: dict[str, object],
    *,
    path: str,
    sync_sheets: bool,
    dry_run: bool,
) -> dict[str, object]:
    sent = int(parsed.get("sent", 0) or 0)
    skipped = int(parsed.get("skipped", 0) or 0)
    sheets_synced_count = 0
    if sync_sheets and not dry_run and (sent or skipped):
        try:
            sheets_synced_count = _sync_local_queue_to_sheets(get_local_repo(path), get_repo())
        except Exception as exc:
            typer.echo(f"Skipped Google Sheets mirror sync after Chrome Extension engagement: {exc}")
    return {
        "backend": "chrome_extension_profile2_fallback",
        "attempted": sent + skipped,
        "sent": sent,
        "skipped": skipped,
        "sheets_synced_count": sheets_synced_count,
        "stop_reason": "" if sent else str(parsed.get("stop_reason") or ("dry_run_engagement_sender_skipped" if dry_run else "")),
        "receipts": parsed.get("receipts", []),
        "bridge_run_id": parsed.get("bridge_run_id", ""),
        "bridge_receipt_path": parsed.get("bridge_receipt_path", ""),
    }


def _send_publish_candidates_chrome_extension(
    *,
    path: str,
    lane_resolution: dict[str, object],
    max_publish_items: int,
    sync_sheets: bool,
    dry_run: bool,
    allow_without_busy: bool = False,
) -> dict[str, object]:
    raise RuntimeError(
        "legacy_chrome_extension_publish_sender_disabled: use the Chrome plugin registered runner "
        "with recording and local proof gates for Daily AI publish."
    )
    runner_cmd = os.getenv("SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD", "").strip()
    if not runner_cmd:
        raise RuntimeError("chrome_extension_profile2_unavailable: trusted_publish_runner_not_configured")
    receipt_dir = _trusted_bridge_receipt_dir(path)
    bridge_run_id = _trusted_bridge_run_id("publish")
    receipt_path = receipt_dir / f"{bridge_run_id}.json"
    uses_trusted_bridge = "chrome_extension_trusted_bridge_client.mjs" in runner_cmd or "trusted bridge" in runner_cmd
    candidate_ids: list[str] = []
    if uses_trusted_bridge:
        try:
            candidate_ids = [row.id for row in _publish_flow_candidates(get_local_repo(path).read_all(), max_publish_items)]
        except Exception:
            candidate_ids = []
    payload = {
        "queuePath": str(Path(path).resolve()),
        "maxActions": max_publish_items,
        "laneResolution": lane_resolution,
        "dryRun": dry_run,
        "allowWithoutBusy": allow_without_busy,
        "bridgeRunId": bridge_run_id,
        "receiptDir": str(receipt_dir),
        "candidateIds": candidate_ids,
    }
    try:
        result = subprocess.run(
            shlex.split(runner_cmd),
            input=json.dumps(payload, ensure_ascii=False),
            capture_output=True,
            text=True,
            check=False,
            timeout=_trusted_runner_subprocess_timeout_seconds() if uses_trusted_bridge else None,
        )
    except subprocess.TimeoutExpired as exc:
        if uses_trusted_bridge:
            try:
                recovered = _recover_trusted_bridge_result(
                    receipt_path,
                    mode="publish",
                    path=path,
                    candidate_ids=candidate_ids,
                )
            except RuntimeError as receipt_exc:
                raise RuntimeError(f"trusted_runner_bridge_unavailable: subprocess_timeout; receipt={receipt_exc}") from exc
            recovered["bridge_run_id"] = bridge_run_id
            recovered["bridge_receipt_path"] = str(receipt_path)
            return _publish_sender_result_from_profile2_payload(
                recovered,
                path=path,
                sync_sheets=sync_sheets,
                dry_run=dry_run,
            )
        raise
    if result.returncode != 0:
        detail = _trusted_runner_failure_detail(result.stderr or result.stdout or "")
        if uses_trusted_bridge or "trusted bridge" in detail:
            try:
                recovered = _recover_trusted_bridge_result(
                    receipt_path,
                    mode="publish",
                    path=path,
                    candidate_ids=candidate_ids,
                )
            except RuntimeError as receipt_exc:
                receipt_detail = str(receipt_exc)
            else:
                recovered["bridge_run_id"] = bridge_run_id
                recovered["bridge_receipt_path"] = str(receipt_path)
                return _publish_sender_result_from_profile2_payload(
                    recovered,
                    path=path,
                    sync_sheets=sync_sheets,
                    dry_run=dry_run,
                )
            if detail.startswith(("chrome_extension_profile2_unavailable", "local_automation_profile_busy_required")):
                raise RuntimeError(detail)
            raise RuntimeError(f"trusted_runner_bridge_unavailable: {detail}; receipt={receipt_detail}")
        raise RuntimeError(f"chrome_extension_profile2_unavailable: trusted_publish_runner_failed: {detail}")
    try:
        parsed = json.loads(result.stdout)
    except Exception as exc:
        try:
            parsed = _recover_trusted_bridge_result(
                receipt_path,
                mode="publish",
                path=path,
                candidate_ids=candidate_ids,
            )
        except RuntimeError as receipt_exc:
            raise RuntimeError(
                f"chrome_extension_profile2_unavailable: trusted_publish_runner_invalid_json; receipt={receipt_exc}"
            ) from exc
    if isinstance(parsed, dict):
        parsed.setdefault("bridge_run_id", bridge_run_id)
        parsed.setdefault("bridge_receipt_path", str(receipt_path))
    return _publish_sender_result_from_profile2_payload(
        parsed,
        path=path,
        sync_sheets=sync_sheets,
        dry_run=dry_run,
    )


def _should_try_profile2_after_nicky_publish_failure(
    publish_send_result: dict[str, object],
    *,
    dry_run: bool,
) -> bool:
    if dry_run:
        return False
    posted = int(publish_send_result.get("posted", 0) or 0)
    skipped = int(publish_send_result.get("skipped", 0) or 0)
    attempted = int(publish_send_result.get("attempted", 0) or 0)
    stop_reason = str(publish_send_result.get("stop_reason") or "")
    if posted > 0:
        return False
    if attempted <= 0 and skipped <= 0:
        return False
    if stop_reason == "publish_send_failed":
        return True
    return stop_reason == ""


def _send_engagement_candidates_chrome_extension(
    *,
    path: str,
    lane_resolution: dict[str, object],
    max_actions: int,
    sync_sheets: bool,
    dry_run: bool,
) -> dict[str, object]:
    raise RuntimeError(
        "legacy_chrome_extension_engagement_sender_disabled: use the Chrome plugin registered runner "
        "with recording and local proof gates for Daily AI engagement."
    )
    runner_cmd = os.getenv("SOCIAL_FLOW_CHROME_EXTENSION_ENGAGEMENT_RUNNER_CMD", "").strip()
    if not runner_cmd:
        raise RuntimeError("chrome_extension_profile2_unavailable: trusted_engagement_runner_not_configured")
    receipt_dir = _trusted_bridge_receipt_dir(path)
    bridge_run_id = _trusted_bridge_run_id("engagement")
    receipt_path = receipt_dir / f"{bridge_run_id}.json"
    uses_trusted_bridge = "chrome_extension_trusted_bridge_client.mjs" in runner_cmd or "trusted bridge" in runner_cmd
    candidate_ids: list[str] = []
    if uses_trusted_bridge:
        try:
            candidate_ids = [row.id for row in _engagement_candidates(get_local_repo(path).read_all(), max_actions)]
        except Exception:
            candidate_ids = []
    payload = {
        "queuePath": str(Path(path).resolve()),
        "maxActions": max_actions,
        "laneResolution": lane_resolution,
        "dryRun": dry_run,
        "bridgeRunId": bridge_run_id,
        "receiptDir": str(receipt_dir),
        "candidateIds": candidate_ids,
    }
    try:
        result = subprocess.run(
            shlex.split(runner_cmd),
            input=json.dumps(payload, ensure_ascii=False),
            capture_output=True,
            text=True,
            check=False,
            timeout=_trusted_runner_subprocess_timeout_seconds() if uses_trusted_bridge else None,
        )
    except subprocess.TimeoutExpired as exc:
        if uses_trusted_bridge:
            try:
                recovered = _recover_trusted_bridge_result(
                    receipt_path,
                    mode="engagement",
                    path=path,
                    candidate_ids=candidate_ids,
                )
            except RuntimeError as receipt_exc:
                raise RuntimeError(f"trusted_runner_bridge_unavailable: subprocess_timeout; receipt={receipt_exc}") from exc
            recovered["bridge_run_id"] = bridge_run_id
            recovered["bridge_receipt_path"] = str(receipt_path)
            return _engagement_sender_result_from_profile2_payload(
                recovered,
                path=path,
                sync_sheets=sync_sheets,
                dry_run=dry_run,
            )
        raise
    if result.returncode != 0:
        detail = _trusted_runner_failure_detail(result.stderr or result.stdout or "")
        if uses_trusted_bridge or "trusted bridge" in detail:
            try:
                recovered = _recover_trusted_bridge_result(
                    receipt_path,
                    mode="engagement",
                    path=path,
                    candidate_ids=candidate_ids,
                )
            except RuntimeError as receipt_exc:
                receipt_detail = str(receipt_exc)
            else:
                recovered["bridge_run_id"] = bridge_run_id
                recovered["bridge_receipt_path"] = str(receipt_path)
                return _engagement_sender_result_from_profile2_payload(
                    recovered,
                    path=path,
                    sync_sheets=sync_sheets,
                    dry_run=dry_run,
                )
            if detail.startswith(("chrome_extension_profile2_unavailable", "local_automation_profile_busy_required")):
                raise RuntimeError(detail)
            raise RuntimeError(f"trusted_runner_bridge_unavailable: {detail}; receipt={receipt_detail}")
        raise RuntimeError(f"chrome_extension_profile2_unavailable: trusted_engagement_runner_failed: {detail}")
    try:
        parsed = json.loads(result.stdout)
    except Exception as exc:
        try:
            parsed = _recover_trusted_bridge_result(
                receipt_path,
                mode="engagement",
                path=path,
                candidate_ids=candidate_ids,
            )
        except RuntimeError as receipt_exc:
            raise RuntimeError(
                f"chrome_extension_profile2_unavailable: trusted_engagement_runner_invalid_json; receipt={receipt_exc}"
            ) from exc
    if isinstance(parsed, dict):
        parsed.setdefault("bridge_run_id", bridge_run_id)
        parsed.setdefault("bridge_receipt_path", str(receipt_path))
    return _engagement_sender_result_from_profile2_payload(
        parsed,
        path=path,
        sync_sheets=sync_sheets,
        dry_run=dry_run,
    )


def _engagement_candidates(rows: list[QueueRow], max_actions: int) -> list[QueueRow]:
    candidates = [
        row
        for row in rows
        if row.engagement_status == "approved"
        and bool(row.engagement_action.strip())
        and bool(row.engagement_targets.strip())
    ]
    candidates.sort(
        key=lambda row: (
            1 if _is_own_engagement_target(row, _first_engagement_target(row)) else 0,
            1 if row.engagement_action.strip() == "reply_to_own_post" else 0,
            row.published_at or row.x_published_at or row.linkedin_published_at or "",
        )
    )
    return candidates[:max_actions]


def _browser_lane_engagement_supported(action: str) -> bool:
    return action in {"like_candidate", "save_candidate", "comment_candidate", "reply_to_own_post"}


def _own_post_engagement_comment(row: QueueRow) -> str:
    title = row.title.strip() or "this update"
    if row.x_post_url.strip():
        if "Codex" in title:
            return (
                "補足すると、ここで見たいのは「AIが何を置き換えるか」より、"
                "レビュー待ちや調査待ちみたいな詰まりがどこまで短くなるか。"
            )
        if "Gemini" in title:
            return (
                "個人的には、単体のチャット性能よりも、普段の作業画面の中でどこまで先回りできるかを見たい。"
            )
        return "補足すると、派手な発表よりも実際の仕事のどこが短くなるかを見ると判断しやすい。"
    return (
        "One useful way to read this is not as a replacement story, "
        "but as a question of which handoffs and waiting time get compressed first."
    )


def _own_post_engagement_comment_for_platform(row: QueueRow, platform: str) -> str:
    if platform == "linkedin":
        surrogate = QueueRow(
            id=row.id,
            status=row.status,
            title=row.title,
            linkedin_post_url=row.linkedin_post_url,
            published_at=row.published_at,
            linkedin_published_at=row.linkedin_published_at,
        )
        return _own_post_engagement_comment(surrogate)
    return _own_post_engagement_comment(row)


def _latest_published_row_for_own_platform_engagement(rows: list[QueueRow], platform: str) -> QueueRow | None:
    def target_url(row: QueueRow) -> str:
        if platform == "x":
            return row.x_post_url.strip()
        if platform == "linkedin":
            return row.linkedin_post_url.strip()
        return ""

    eligible = [
        row
        for row in rows
        if row.status == "published"
        and target_url(row)
        and (row.published_at or row.x_published_at or row.linkedin_published_at)
    ]
    def published_sort_key(row: QueueRow) -> str:
        if platform == "linkedin":
            return row.linkedin_published_at or row.published_at or row.x_published_at
        return row.x_published_at or row.published_at or row.linkedin_published_at

    eligible.sort(
        key=published_sort_key,
        reverse=True,
    )
    return eligible[0] if eligible else None


def _supplemental_own_post_engagement_row(row: QueueRow, platform: str) -> QueueRow:
    target_url = row.linkedin_post_url.strip() if platform == "linkedin" else row.x_post_url.strip()
    action = "like_candidate" if platform == "linkedin" else "reply_to_own_post"
    synthetic = QueueRow(
        id=f"{row.id}-{platform}-own-engagement",
        status="published",
        title=row.title,
        published_at=row.published_at,
        x_published_at=row.x_published_at,
        linkedin_published_at=row.linkedin_published_at,
        engagement_targets=target_url,
        engagement_action=action,
        engagement_reason=(
            f"Supplemental {platform} own-post follow-up because the registered Daily AI run requires "
            "verified engagement on X and LinkedIn."
        ),
        comment_draft="" if action == "like_candidate" else _own_post_engagement_comment_for_platform(row, platform),
        engagement_status="approved",
        freshness_checked_at=utc_now(),
    )
    if platform == "linkedin":
        synthetic.linkedin_post_url = target_url
    else:
        synthetic.x_post_url = target_url
    return synthetic


def _split_reference_post_urls(raw: str) -> list[str]:
    urls: list[str] = []
    for part in re.split(r"[\s,|]+", raw):
        candidate = part.strip()
        if not candidate:
            continue
        normalized = _normalize_feed_post_url(candidate)
        lowered = normalized.lower()
        if ("x.com/" in lowered or "twitter.com/" in lowered) and "/status/" in lowered:
            urls.append(normalized)
        elif "linkedin.com/" in lowered and ("/feed/update/" in lowered or "/posts/" in lowered):
            urls.append(normalized)
    return urls


def _is_own_engagement_target(row: QueueRow, target_url: str) -> bool:
    lowered = target_url.lower()
    own_urls = {row.x_post_url.strip().lower(), row.linkedin_post_url.strip().lower()}
    if lowered in own_urls:
        return True
    return "x.com/nichika2000823/" in lowered or "twitter.com/nichika2000823/" in lowered


def _engagement_research_evidence(row: QueueRow, platform: str) -> str:
    platform_notes = row.x_research_notes if platform == "x" else row.linkedin_research_notes
    evidence = " ".join(
        part.strip()
        for part in [platform_notes, row.research_notes, row.angle]
        if part.strip()
    )
    return re.sub(r"\s+", " ", evidence).strip()


def _engagement_research_notes(row: QueueRow, platform: str) -> str:
    platform_notes = row.x_research_notes if platform == "x" else row.linkedin_research_notes
    notes = " ".join(
        part.strip()
        for part in [platform_notes, row.research_notes]
        if part.strip()
    )
    return re.sub(r"\s+", " ", notes).strip()


def _has_enough_engagement_research(row: QueueRow, platform: str) -> bool:
    notes = _engagement_research_notes(row, platform)
    return row.research_status == "done" and len(notes) >= 30


def _engagement_comment_focus(evidence: str, *, max_chars: int = 54) -> str:
    text = re.sub(r"https?://\S+", "", evidence)
    text = re.sub(r"\bFeed read:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:Post-publish|recommended/feed engagement|Feed post)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:Read the (?:X|LinkedIn) target and (?:replies|comments);?|operators discussed)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"[@＠][A-Za-z0-9_]{2,30}\s*[·・]\s*\d+\s*(?:分|時間|日|h|m|d)\b", " ", text)
    text = re.sub(r"(?:^|\s)(?:Reply|Repost|Quote|Like|Comment|Share|Send|Follow|Save)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"(?:^|\s)(?:返信|リポスト|引用|いいね|コメント|共有|保存|フォロー)(?:\s|$)", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" -:;。,.、")
    if not text:
        return "the operating detail"
    parts = [
        part.strip(" -:;。,.、")
        for part in re.split(r"[。.!?\n]| \| ", text)
        if len(part.strip()) >= 12
    ]
    keyword_pattern = re.compile(
        r"\d|%|governance|approval|handoff|latency|workflow|rollout|cost|team|agent|prompt|運用|承認|権限|待ち|現場|導入|自動化|チーム",
        re.IGNORECASE,
    )
    selected = next((part for part in parts if keyword_pattern.search(part)), parts[0] if parts else text)
    selected = re.sub(r"^(Post-publish|x|linkedin|recommended/feed engagement|Feed post)\s*", "", selected).strip(" -:;。,.、")
    selected = re.sub(r"^[@＠][A-Za-z0-9_]{2,30}\s*[·・]\s*\d+\s*(?:分|時間|日|h|m|d)\s*", "", selected).strip(" -:;。,.、")
    if len(selected) > max_chars:
        keyword_match = keyword_pattern.search(selected)
        if keyword_match and keyword_match.start() > max_chars // 3:
            start = max(0, keyword_match.start() - max_chars // 3)
            selected = selected[start : start + max_chars].strip(" -:;。,.、")
        else:
            selected = selected[: max_chars - 1].rstrip() + "…"
    return selected or "the operating detail"


def _external_engagement_comment(row: QueueRow, platform: str) -> str:
    evidence = _engagement_research_evidence(row, platform)
    focus = _engagement_comment_focus(evidence, max_chars=52 if platform == "x" else 68)
    lowered = evidence.lower()
    if platform == "linkedin":
        if re.search(r"latency|handoff|approval|governance|review", lowered):
            return f"{focus} is the useful part here. In practice, that is often where AI rollout slows down first."
        if re.search(r"rollout|team|workspace|adoption", lowered):
            return f"{focus} matches what I see in rollout work too. The team/process edge tends to decide whether the tool sticks."
        return f"{focus} is the practical detail I would watch. Where did the adoption friction show up first?"
    if re.search(r"latency|handoff|approval|governance|review|承認|待ち|権限", lowered):
        return f"{focus}、ここはかなり大事だと思います。AI導入は待ち時間や引き継ぎで詰まりがちですね。"
    if re.search(r"rollout|team|workspace|adoption|チーム|導入|現場", lowered):
        return f"{focus}、導入後に誰が直し続けるかまで見ると判断しやすいですね。"
    return f"{focus}、運用に入れた時の確認ポイントが具体的で参考になります。"


def _engagement_comment_quality_ok(comment: str, platform: str) -> bool:
    text = " ".join(comment.split())
    if platform == "x" and not (12 <= len(text) <= 140):
        return False
    if platform == "linkedin" and not (35 <= len(text) <= 450):
        return False
    forbidden_patterns = [
        r"[@＠][A-Za-z0-9_]{2,30}\s*[·・]\s*\d+\s*(?:分|時間|日|h|m|d)",
        r"[@＠][A-Za-z0-9_]{2,30}\s*[·・]\s*\d{1,2}月\d{1,2}日",
        r"^\s*(?:…|1d\s*[•·]|[0-9]+\s*(?:分|時間|日|h|m|d)\s*[•·])",
        r"^\s*[a-z]\s*/\s*(?:x|linkedin)\s*:",
        r"\b[0-9]+\s*(?:h|d|m)\s*[•·]",
        r"𝕏\s*[@＠]",
        r"(?:\d{1,3}(?:,\d{3})?\s+){2,}\d{1,3}(?:,\d{3})?",
        r"\b(?:Reply|Repost|Quote|Like|Comment|Share|Send|Follow|Save)\b",
        r"(?:返信|リポスト|引用|いいね|コメント|共有|保存|フォロー)",
        r"^\s*この「…",
        r"^\s*This detail stood out to me: \"\.\.\.",
    ]
    if any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in forbidden_patterns):
        return False
    generic_fragments = [
        "派手さより、実際に使い続ける条件",
        "視点は拾っておきたいです",
        "quite important",
        "現場感あります。ツール選びより、チームにどう残るかの方が難しいですね。",
        "実際の運用に落とす時の前提が大事そうです。どこで詰まりましたか？",
    ]
    return not any(fragment in text for fragment in generic_fragments)


def _can_auto_prepare_engagement_candidate(row: QueueRow) -> bool:
    return row.engagement_status.strip() == ""


def _can_seed_external_engagement_candidate(row: QueueRow) -> bool:
    return row.status in {"published", "partially_published"}


def _prepare_external_engagement_candidates(
    rows: list[QueueRow],
    *,
    max_actions: int,
    max_likes: int,
    max_comments: int,
    max_saves: int,
    max_quotes: int,
) -> int:
    prepared = 0
    likes = 0
    comments = 0
    saves = 0
    quotes = 0
    platform_cap_mode = max_actions >= 13 and max_likes >= 10 and max_comments >= 3 and max_saves <= 0 and max_quotes <= 0
    platform_caps = (
        _feed_study_platform_action_caps(
            max_actions,
            max_likes=max_likes,
            max_comments=max_comments,
            max_saves=max_saves,
            max_quotes=max_quotes,
        )
        if platform_cap_mode
        else {}
    )
    platform_counts = {
        "x": {"like_candidate": 0, "comment_candidate": 0, "save_candidate": 0, "quote_candidate": 0},
        "linkedin": {"like_candidate": 0, "comment_candidate": 0, "save_candidate": 0, "quote_candidate": 0},
    }
    seen_targets = _used_external_engagement_target_urls(rows)

    eligible = [
        row
        for row in rows
        if _can_seed_external_engagement_candidate(row)
        and _can_auto_prepare_engagement_candidate(row)
        and bool(row.reference_post_urls.strip())
        and _has_fresh_engagement_research(row)
    ]
    eligible.sort(
        key=lambda row: (
            _quality_score_value(row),
            _safe_int(row.discussion_score),
            row.published_at or row.x_published_at or row.linkedin_published_at or "",
        ),
        reverse=True,
    )

    for row in eligible:
        if prepared >= max_actions:
            break
        for raw_target_url in _split_reference_post_urls(row.reference_post_urls):
            if prepared >= max_actions:
                break
            target_url = _normalize_feed_post_url(raw_target_url)
            target_key = target_url.lower()
            platform = _engagement_platform(target_url)
            if not platform or target_key in seen_targets or _is_own_engagement_target(row, target_url):
                continue
            if not _has_enough_engagement_research(row, platform):
                continue

            if platform_cap_mode:
                caps_for_platform = platform_caps.get(platform, {})
                counts_for_platform = platform_counts[platform]
                if counts_for_platform["comment_candidate"] < caps_for_platform.get("comment_candidate", 0):
                    action = "comment_candidate"
                    comment_draft = _external_engagement_comment(row, platform)
                    if not _engagement_comment_quality_ok(comment_draft, platform):
                        if counts_for_platform["like_candidate"] < caps_for_platform.get("like_candidate", 0):
                            action = "like_candidate"
                            comment_draft = ""
                            counts_for_platform["like_candidate"] += 1
                        else:
                            continue
                    else:
                        counts_for_platform["comment_candidate"] += 1
                elif counts_for_platform["like_candidate"] < caps_for_platform.get("like_candidate", 0):
                    action = "like_candidate"
                    comment_draft = ""
                    counts_for_platform["like_candidate"] += 1
                else:
                    continue
            elif comments < max_comments:
                action = "comment_candidate"
                comment_draft = _external_engagement_comment(row, platform)
                if not _engagement_comment_quality_ok(comment_draft, platform):
                    if likes < max_likes:
                        action = "like_candidate"
                        comment_draft = ""
                        likes += 1
                    else:
                        continue
                else:
                    comments += 1
            elif saves < max_saves:
                action = "save_candidate"
                comment_draft = ""
                saves += 1
            elif likes < max_likes:
                action = "like_candidate"
                comment_draft = ""
                likes += 1
            else:
                continue

            row.engagement_targets = target_url
            row.engagement_action = action
            row.engagement_reason = (
                "External post engagement candidate prepared from completed feed research; "
                "target has reference URL and specific research evidence."
            )
            row.comment_draft = comment_draft
            row.engagement_status = "approved"
            row.next_action = (
                "Send approved external engagement via the Chrome plugin registered runner after expected-account, "
                "target/body/comment reflection, enabled-submit, recording, local proof, and completion gates pass; "
                "stop with chrome_extension_required if that runner is unavailable."
            )
            seen_targets.add(target_key)
            prepared += 1
            break
    return prepared


def _prepare_own_post_engagement_candidates(rows: list[QueueRow], max_actions: int) -> int:
    eligible = [
        row
        for row in rows
        if row.status == "published"
        and _can_auto_prepare_engagement_candidate(row)
        and bool(row.x_post_url.strip() or row.linkedin_post_url.strip())
    ]
    eligible.sort(key=lambda row: row.published_at or row.x_published_at or row.linkedin_published_at or "", reverse=True)

    prepared = 0
    for row in eligible:
        if prepared >= max_actions:
            break
        target_url = row.x_post_url.strip() or row.linkedin_post_url.strip()
        row.engagement_targets = target_url
        row.engagement_action = "reply_to_own_post"
        row.engagement_reason = "Own recent post follow-up; safe engagement candidate with specific added context."
        row.comment_draft = _own_post_engagement_comment(row)
        row.engagement_status = "approved"
        row.freshness_checked_at = utc_now()
        row.next_action = (
            "Send approved own-post follow-up via the Chrome plugin registered runner, then mark engagement done after expected-account, target/body/comment reflection, enabled-submit, recording, local proof, and completion gates pass; "
            "stop with chrome_extension_required if that runner is unavailable."
        )
        prepared += 1
    return prepared


def _append_unique_text(existing: str, addition: str, *, separator: str = "\n") -> str:
    addition = addition.strip()
    if not addition:
        return existing
    parts = [part.strip() for part in existing.split(separator) if part.strip()]
    if addition not in parts:
        parts.append(addition)
    return separator.join(parts)


def _feed_study_entries(payload: object) -> list[dict[str, object]]:
    if isinstance(payload, list):
        return [entry for entry in payload if isinstance(entry, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ["read_posts", "posts", "observations", "items"]:
        value = payload.get(key)
        if isinstance(value, list):
            return [entry for entry in value if isinstance(entry, dict)]
    return []


def _feed_study_discovered_items(payload: object) -> list[dict[str, object]]:
    if not isinstance(payload, dict):
        return []
    for key in ["discovered_items", "candidate_sources", "discovered_sources"]:
        value = payload.get(key)
        if isinstance(value, list):
            return [entry for entry in value if isinstance(entry, dict)]
    return []


def _feed_entry_text(entry: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = entry.get(key)
        if value is not None:
            text = str(value).strip()
            if text:
                return text
    return ""


def _normalize_feed_post_url(url: str) -> str:
    raw = url.strip()
    match = re.search(r"https?://(?:www\.)?(?:x|twitter)\.com/([^/?#]+)/status/(\d+)", raw, flags=re.IGNORECASE)
    if match:
        return f"https://x.com/{match.group(1)}/status/{match.group(2)}"
    decoded = unquote(raw)
    linkedin_urn = re.search(r"urn:li:(?:activity|share):\d+", decoded, flags=re.IGNORECASE)
    if linkedin_urn and "linkedin.com/" in decoded.lower():
        return f"https://www.linkedin.com/feed/update/{linkedin_urn.group(0)}/"
    linkedin_feed = re.search(
        r"https?://(?:www\.)?linkedin\.com/feed/update/(urn:li:(?:activity|share):\d+)/?",
        decoded,
        flags=re.IGNORECASE,
    )
    if linkedin_feed:
        return f"https://www.linkedin.com/feed/update/{linkedin_feed.group(1)}/"
    linkedin_post = re.search(r"https?://(?:www\.)?linkedin\.com/posts/[^/?#]+", decoded, flags=re.IGNORECASE)
    if linkedin_post:
        return linkedin_post.group(0)
    return raw


def _feed_research_receipt_target(payload: object) -> str:
    if not isinstance(payload, dict):
        return "15-30 relevant posts"
    receipt = str(payload.get("feed_research_receipt") or "")
    match = re.search(r"(?:^|;)\s*target=([^;]+)", receipt)
    if match and match.group(1).strip():
        return match.group(1).strip()
    try:
        target_count = int(payload.get("target_count") or 0)
    except (TypeError, ValueError):
        target_count = 0
    method = str(payload.get("method") or "").lower()
    if target_count >= 100 and ("recommended" in method or "home" in method or "おすすめ" in method):
        return "100+ recommended-feed posts"
    return "15-30 relevant posts"


def _feed_research_receipt(metrics: dict[str, object], *, artifact_path: str, target: str = "15-30 relevant posts") -> str:
    platform_counts = _feed_study_platform_reads(metrics)
    read_rows = metrics.get("feed_read_log_rows", [])
    if not isinstance(read_rows, list):
        read_rows = []
    representative_urls: list[str] = []
    for row in read_rows:
        if not isinstance(row, list) or len(row) < 4:
            continue
        url = _normalize_feed_post_url(str(row[3]).strip())
        if url and url not in representative_urls and len(representative_urls) < 5:
            representative_urls.append(url)
    return (
        f"target={target}; actual={metrics.get('feed_study_count', 0)}; "
        f"external={metrics.get('external_posts_read', 0)}; x={platform_counts['x']}; "
        f"linkedin={platform_counts['linkedin']}; representatives={', '.join(representative_urls) or 'none'}; "
        f"discovered={metrics.get('discovered_items_added', 0)}; "
        f"artifact={artifact_path}"
    )


def _feed_study_platform_reads(metrics: dict[str, object]) -> dict[str, int]:
    platform_reads = {"x": 0, "linkedin": 0}
    for feed_row in metrics.get("feed_read_log_rows", []):
        if not isinstance(feed_row, list) or len(feed_row) < 4:
            continue
        platform = str(feed_row[2]).strip().lower()
        if platform in platform_reads:
            platform_reads[platform] += 1
    return platform_reads


def _feed_study_stop_reason(
    metrics: dict[str, object],
    *,
    minimum_external_reads: int = 15,
    required_engagement_candidates: int = 0,
) -> str:
    stop_reasons: list[str] = []
    external_posts_read = int(metrics.get("external_posts_read") or 0)
    if external_posts_read < minimum_external_reads:
        stop_reasons.append(f"post_publish_feed_study_insufficient_external_posts:{external_posts_read}/{minimum_external_reads}")
    platform_reads = _feed_study_platform_reads(metrics)
    missing_platform_reads = [platform for platform, count in platform_reads.items() if count <= 0]
    if missing_platform_reads:
        stop_reasons.append("engagement_platform_feed_study_missing:" + ",".join(missing_platform_reads))
    engagement_candidates_created = int(metrics.get("engagement_candidates_created") or 0)
    if required_engagement_candidates > 0 and engagement_candidates_created < required_engagement_candidates:
        stop_reasons.append(
            f"engagement_candidate_pool_insufficient:{engagement_candidates_created}/{required_engagement_candidates}"
        )
    return "; ".join(stop_reasons)


def _join_stop_reasons(*reasons: str) -> str:
    return "; ".join(reason.strip() for reason in reasons if reason and reason.strip())


def _replace_queue_rows(repo: object, rows: list[QueueRow]) -> None:
    replace_all = getattr(repo, "replace_all", None)
    if callable(replace_all):
        replace_all(rows)
        return
    for row in rows:
        repo.update(row)


def _mutate_queue_rows(repo: object, mutator):
    mutate_all = getattr(repo, "mutate_all", None)
    if callable(mutate_all):
        return mutate_all(mutator)
    rows = repo.read_all()
    result = mutator(rows)
    should_write = bool(result.get("changed")) if isinstance(result, dict) and "changed" in result else bool(result)
    if should_write:
        _replace_queue_rows(repo, rows)
    return result


def _feed_body_looks_promotional(body: str) -> bool:
    compact = " ".join(body.split()).lower()
    if not compact:
        return False
    promotional_markers = (
        "広告",
        "promoted",
        "sponsored",
        "visit ",
        "learn more",
        "から ",
    )
    return any(marker in compact for marker in promotional_markers)


def _feed_entry_candidate_eligible(entry: dict[str, object]) -> bool:
    if "candidate_eligible" not in entry:
        return True
    value = entry.get("candidate_eligible")
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"0", "false", "no", "read_only", "readonly"}


def _feed_entry_target_actionable(platform: str, target_url: str) -> bool:
    lowered = unquote(target_url).lower()
    if platform == "x":
        return bool(re.search(r"/status/\d+", lowered))
    if platform == "linkedin":
        return bool(
            re.search(r"/feed/update/urn:li:(?:activity|share):\d+", lowered)
            or re.search(r"/posts/[^/?#]+", lowered)
        )
    return False


def _used_external_engagement_target_urls(rows: list[QueueRow]) -> set[str]:
    used: set[str] = set()
    for row in rows:
        if row.engagement_status not in {"approved", "done", "skipped"}:
            continue
        for target in re.split(r"[\n,|]+", row.engagement_targets.strip()):
            normalized = _normalize_feed_post_url(target).lower()
            if normalized:
                used.add(normalized)
    return used


def _feed_entries_unused_actionable_count(
    items: list[dict[str, object]],
    *,
    platform: str,
    used_urls: set[str],
) -> int:
    normalized_used_urls = {_normalize_feed_post_url(url).lower() for url in used_urls if url}
    seen: set[str] = set()
    count = 0
    for item in items:
        if str(item.get("platform") or "").lower() != platform or not _feed_entry_candidate_eligible(item):
            continue
        target_url = str(item.get("url") or "")
        if not _feed_entry_target_actionable(platform, target_url):
            continue
        normalized = _normalize_feed_post_url(target_url).lower()
        if not normalized or normalized in normalized_used_urls or normalized in seen:
            continue
        seen.add(normalized)
        count += 1
    return count


def _linkedin_readonly_fallback_url(url: str) -> bool:
    lowered = unquote(url).lower()
    return bool(re.search(r"https?://(?:www\.)?linkedin\.com/(?:company|in)/[^?#]+", lowered))


def _resolve_linkedin_fallback_post_url(page, fallback_url: str, evidence: str) -> str:
    if not _linkedin_readonly_fallback_url(fallback_url):
        return ""
    resolver_page = page
    close_resolver = False
    try:
        context = getattr(page, "context", None)
        new_page = getattr(context, "new_page", None)
        if callable(new_page):
            resolver_page = new_page()
            close_resolver = True
        resolver_page.goto(fallback_url, wait_until="domcontentloaded", timeout=5000)
        resolved = ""
        for attempt in range(4):
            resolver_page.wait_for_timeout(900 + attempt * 350)
            resolved = resolver_page.evaluate(
                """(evidence) => {
              const text = (node) => (node?.innerText || node?.textContent || "").replace(/\\s+/g, " ").trim();
              const normalizeUrl = (raw) => {
                const value = String(raw || "");
                if (!value) return "";
                const decoded = (() => {
                  try { return decodeURIComponent(value); } catch { return value; }
                })();
                const urn = decoded.match(/urn:li:(?:activity|share):\\d+/);
                if (urn) return `https://www.linkedin.com/feed/update/${urn[0]}/`;
                try {
                  const parsed = new URL(value);
                  if (/\\/feed\\/update\\/urn:li:(?:activity|share):\\d+\\/?/i.test(parsed.pathname)) {
                    return `${parsed.origin}${parsed.pathname.replace(/\\/+$/, "")}/`;
                  }
                  if (/\\/posts\\/[^/?#]+/i.test(parsed.pathname)) {
                    return `${parsed.origin}${parsed.pathname}`;
                  }
                } catch {
                  return "";
                }
                return "";
              };
              const exactUrlFrom = (root) => {
                const nodes = [];
                let node = root;
                for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) nodes.push(node);
                nodes.push(...Array.from(root.querySelectorAll('[data-urn], [data-id*="urn:li:"], a[href*="/feed/update/"], a[href*="urn%3Ali%3A"], a[href*="urn:li:"], a[href*="/posts/"]')));
                for (const candidate of nodes) {
                  const attrs = Array.from(candidate.attributes || [])
                    .filter((attr) => /urn:li:|feed[/]update|[/]posts[/]/i.test(attr.value || ""))
                    .map((attr) => attr.value);
                  const data = [candidate.getAttribute?.("data-urn"), candidate.getAttribute?.("data-id"), candidate.href, ...attrs]
                    .filter(Boolean)
                    .join(" ");
                  const url = normalizeUrl(data);
                  if (url) return url;
                }
                return "";
              };
              const evidenceTokens = String(evidence || "")
                .toLowerCase()
                .replace(/https?:\\/\\/\\S+/g, " ")
                .split(/[^a-z0-9]+/)
                .filter((token) => token.length >= 5)
                .slice(0, 24);
              const roots = Array.from(document.querySelectorAll(
                '.feed-shared-update-v2, [data-urn*="urn:li:activity"], [data-urn*="urn:li:share"], div[data-id*="urn:li:activity"], div[data-id*="urn:li:share"], div[class*="feed-shared"], article, [role="listitem"]'
              ));
              let best = {url: "", score: -1};
              for (const root of roots) {
                const url = exactUrlFrom(root);
                if (!url) continue;
                const body = text(root).toLowerCase();
                const score = evidenceTokens.reduce((count, token) => count + (body.includes(token) ? 1 : 0), 0);
                if (score > best.score) best = {url, score};
              }
              const minimumScore = Math.max(1, Math.min(3, Math.ceil(evidenceTokens.length * 0.2)));
              return best.score >= minimumScore ? best.url : "";
            }""",
                evidence,
            )
            if resolved:
                break
            try:
                resolver_page.evaluate("() => window.scrollBy(0, Math.max(900, Math.floor(window.innerHeight * 1.2)))")
            except TypeError:
                pass
        return _normalize_feed_post_url(str(resolved or ""))
    except Exception:
        return ""
    finally:
        if close_resolver:
            try:
                resolver_page.close()
            except Exception:
                pass


def _post_publish_engagement_feed_study_local(
    *,
    path: str,
    settings: Settings,
    remote_debugging_port: int | None,
    max_actions: int,
    sync_sheets: bool,
    timeout_seconds: float,
    target_count: int = 30,
    dry_run: bool = False,
) -> dict[str, object]:
    if dry_run:
        return {"artifact": "", "read": 0, "external_read": 0, "engagement_candidates_created": 0, "dry_run": True}
    # Registered completion still requires external_posts_read >= 15; LinkedIn gaps are handled separately.
    repo = get_local_repo(path)
    rows = repo.read_all()
    published_rows = [
        row
        for row in rows
        if row.status in {"published", "partially_published"}
        and not row.engagement_status.strip()
        and (row.x_post_url.strip() or row.linkedin_post_url.strip())
    ]
    if not published_rows:
        return {"artifact": "", "read": 0, "external_read": 0, "engagement_candidates_created": 0, "stop_reason": "no_published_rows_for_feed_study"}

    port = remote_debugging_port or settings.chrome_main_remote_debugging_port
    artifact_dir = Path("artifacts/feed-study")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    slug = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    artifact_path = artifact_dir / f"{slug}-post-publish-engagement-feed-study.json"
    entries: list[dict[str, object]] = []
    used_engagement_urls = _used_external_engagement_target_urls(rows)

    try:
        from playwright.sync_api import sync_playwright

        _ensure_chrome_cdp_page_target(port, timeout_seconds=1.0)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            page = context.new_page()
            try:
                minimum_external_reads = min(15, target_count)
                per_platform = max(4, target_count // 2)
                linkedin_target = min(per_platform, max(1, target_count - per_platform))
                x_entries = _collect_external_feed_posts_for_engagement(
                    page,
                    platform="x",
                    feed_url="https://x.com/home",
                    limit=per_platform,
                    published_rows=published_rows,
                    exclude_urls=set(used_engagement_urls),
                    scroll_rounds=12,
                )
                linkedin_entries = _collect_external_feed_posts_for_engagement(
                    page,
                    platform="linkedin",
                    feed_url="https://www.linkedin.com/feed/",
                    limit=linkedin_target,
                    published_rows=published_rows,
                    exclude_urls=used_engagement_urls | {str(entry.get("url") or "").lower() for entry in x_entries},
                    scroll_rounds=12,
                )
                if not linkedin_entries:
                    linkedin_entries = _collect_external_feed_posts_for_engagement(
                        page,
                        platform="linkedin",
                        feed_url="https://www.linkedin.com/feed/",
                        limit=linkedin_target,
                        published_rows=published_rows,
                        exclude_urls=used_engagement_urls | {str(entry.get("url") or "").lower() for entry in x_entries},
                        scroll_rounds=18,
                )
                entries.extend([*linkedin_entries, *x_entries])
                linkedin_actionable_target = min(
                    linkedin_target,
                    _feed_study_platform_action_caps(
                        max_actions,
                        max_likes=10,
                        max_comments=3,
                        max_saves=0,
                        max_quotes=0,
                    ).get("linkedin", {}).get("total", linkedin_target),
                )
                needed_linkedin_entries = max(
                    0,
                    linkedin_actionable_target
                    - _feed_entries_unused_actionable_count(
                        linkedin_entries,
                        platform="linkedin",
                        used_urls=used_engagement_urls,
                    ),
                )
                linkedin_refill_round = 0
                while needed_linkedin_entries > 0 and linkedin_refill_round < 3:
                    linkedin_refill_round += 1
                    before_actionable = _feed_entries_unused_actionable_count(
                        entries,
                        platform="linkedin",
                        used_urls=used_engagement_urls,
                    )
                    extra_linkedin_entries = _collect_external_feed_posts_for_engagement(
                        page,
                        platform="linkedin",
                        feed_url="https://www.linkedin.com/feed/",
                        limit=max(needed_linkedin_entries * (3 + linkedin_refill_round), needed_linkedin_entries),
                        published_rows=published_rows,
                        exclude_urls=used_engagement_urls | {str(entry.get("url") or "").lower() for entry in entries},
                        scroll_rounds=24 + linkedin_refill_round * 8,
                    )
                    entries.extend(extra_linkedin_entries)
                    after_actionable = _feed_entries_unused_actionable_count(
                        entries,
                        platform="linkedin",
                        used_urls=used_engagement_urls,
                    )
                    needed_linkedin_entries = max(0, linkedin_actionable_target - after_actionable)
                    if after_actionable <= before_actionable and not extra_linkedin_entries:
                        break
                if needed_linkedin_entries > 0:
                    linkedin_search_urls = [
                        "https://www.linkedin.com/search/results/content/?keywords=AI%20agents&origin=GLOBAL_SEARCH_HEADER",
                        "https://www.linkedin.com/search/results/content/?keywords=OpenAI&origin=GLOBAL_SEARCH_HEADER",
                        "https://www.linkedin.com/search/results/content/?keywords=generative%20AI&origin=GLOBAL_SEARCH_HEADER",
                    ]
                    for search_url in linkedin_search_urls:
                        before_actionable = _feed_entries_unused_actionable_count(
                            entries,
                            platform="linkedin",
                            used_urls=used_engagement_urls,
                        )
                        search_linkedin_entries = _collect_external_feed_posts_for_engagement(
                            page,
                            platform="linkedin",
                            feed_url=search_url,
                            limit=max(needed_linkedin_entries * 4, needed_linkedin_entries + 1),
                            published_rows=published_rows,
                            exclude_urls=used_engagement_urls | {str(entry.get("url") or "").lower() for entry in entries},
                            scroll_rounds=28,
                        )
                        entries.extend(search_linkedin_entries)
                        after_actionable = _feed_entries_unused_actionable_count(
                            entries,
                            platform="linkedin",
                            used_urls=used_engagement_urls,
                        )
                        needed_linkedin_entries = max(0, linkedin_actionable_target - after_actionable)
                        if needed_linkedin_entries <= 0:
                            break
                        if after_actionable <= before_actionable and not search_linkedin_entries:
                            continue
                if len(entries) < minimum_external_reads:
                    entries.extend(
                        _collect_external_feed_posts_for_engagement(
                            page,
                            platform="x",
                            feed_url="https://x.com/home",
                            limit=target_count - len(entries),
                            published_rows=published_rows,
                            exclude_urls=used_engagement_urls | {str(entry.get("url") or "").lower() for entry in entries},
                            scroll_rounds=18,
                        )
                    )
            finally:
                page.close()
                # Do not close the CDP browser here; later publish/engagement stages
                # reuse the same registered runner endpoint and own final cleanup.
    except Exception as exc:
        message = f"post_publish_feed_study_failed: {exc}"
        _append_local_run_summary(
            run_at=utc_now(),
            researched_count=0,
            feed_study_count=0,
            external_posts_read=0,
            engagement_candidates_created=0,
            sheets_synced_count=0,
            stop_reason=message[:300],
            path=path,
        )
        return {"artifact": "", "read": 0, "external_read": 0, "engagement_candidates_created": 0, "stop_reason": message[:300]}

    actionable_linkedin_entries = [
        entry
        for entry in entries
        if str(entry.get("platform") or "").lower() == "linkedin" and _feed_entry_candidate_eligible(entry)
    ]
    other_entries = [entry for entry in entries if entry not in actionable_linkedin_entries]
    read_posts = [*actionable_linkedin_entries, *other_entries][:target_count]
    payload = {
        "method": "local Chrome 二千 CDP post-publish recommended/feed engagement study",
        "target_count": target_count,
        "feed_research_receipt": "target=15-30 relevant posts",
        "read_posts": read_posts,
    }
    artifact_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    rows = repo.read_all()
    metrics = _apply_feed_study_entries_to_rows(
        rows,
        _feed_study_entries(payload),
        max_actions=max_actions,
        max_likes=10,
        max_comments=3,
        max_saves=0,
        max_quotes=0,
    )
    existing_ids = {row.id for row in repo.read_all()}
    for row in rows:
        if row.id in existing_ids:
            repo.update(row)
        else:
            repo.append(row)
            existing_ids.add(row.id)
    sheets_synced = 0
    if sync_sheets:
        try:
            sheets_repo = get_repo()
            sheets_synced = _sync_local_queue_to_sheets(repo, sheets_repo)
            feed_read_log_rows = metrics.get("feed_read_log_rows", [])
            if isinstance(feed_read_log_rows, list):
                sheets_repo.append_feed_read_log(feed_read_log_rows)
        except Exception as exc:
            typer.echo(f"Skipped post-publish feed-study Sheets sync: {exc}")
    feed_receipt = _feed_research_receipt(metrics, artifact_path=str(artifact_path), target="15-30 relevant posts")
    external_posts_read = int(metrics["external_posts_read"])
    platform_reads = _feed_study_platform_reads(metrics)
    feed_study_stop_reason = _feed_study_stop_reason(metrics, required_engagement_candidates=max_actions)
    _append_local_run_summary(
        run_at=utc_now(),
        researched_count=0,
        feed_study_count=metrics["feed_study_count"],
        external_posts_read=external_posts_read,
        feed_research_receipt=feed_receipt,
        engagement_candidates_created=metrics["engagement_candidates_created"],
        external_engagement_candidates=metrics["external_engagement_candidates"],
        own_post_engagement_candidates=0,
        sheets_synced_count=sheets_synced,
        stop_reason=feed_study_stop_reason,
        path=path,
    )
    return {
        "artifact": str(artifact_path),
        "read": metrics["feed_study_count"],
        "external_read": external_posts_read,
        "platform_reads": platform_reads,
        "engagement_candidates_created": metrics["engagement_candidates_created"],
        "sheets_synced": sheets_synced,
        "stop_reason": feed_study_stop_reason,
    }


def _collect_external_feed_posts_for_engagement(
    page,
    *,
    platform: str,
    feed_url: str,
    limit: int,
    published_rows: list[QueueRow],
    exclude_urls: set[str] | None = None,
    scroll_rounds: int = 8,
) -> list[dict[str, object]]:
    if limit <= 0:
        return []
    page.goto(feed_url, wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(2500)
    collected: list[dict[str, object]] = []
    seen: set[str] = {_normalize_feed_post_url(url).lower() for url in (exclude_urls or set()) if url}
    candidate_source_rows = [row for row in published_rows if row.status == "published"] or published_rows
    min_scroll_rounds_before_return = min(4, max(1, scroll_rounds)) if platform == "linkedin" else 1
    linkedin_fallback_resolution_attempts = 0
    max_linkedin_fallback_resolution_attempts = min(max(4, limit * 4), 24)
    for scroll_index in range(max(1, scroll_rounds)):
        raw_posts = page.evaluate(
            """(platform) => {
              const text = (node) => (node?.innerText || node?.textContent || "").replace(/\\s+/g, " ").trim();
              const out = [];
              if (platform === "x") {
                for (const article of document.querySelectorAll("article")) {
                  const links = Array.from(article.querySelectorAll('a[href*="/status/"]')).map((a) => a.href);
                  const url = links.find((href) => /\\/status\\/\\d+/.test(href));
                  const body = text(article);
                  if (url && body.length > 80) out.push({url, body, author: body.split(" ")[0] || ""});
                }
              } else {
                const linkedInPostUrlFrom = (root) => {
                  const nodes = [];
                  let node = root;
                  for (let depth = 0; node && depth < 14; depth += 1, node = node.parentElement) nodes.push(node);
                  nodes.push(...Array.from(root.querySelectorAll('[data-urn], [data-id*="urn:li:"], a[href*="/feed/update/"], a[href*="urn%3Ali%3A"], a[href*="urn:li:"], a[href*="/posts/"]')));
                  for (const candidate of nodes) {
                    const attrs = Array.from(candidate.attributes || [])
                      .filter((attr) => /urn:li:|feed[/]update|[/]posts[/]/i.test(attr.value || ""))
                      .map((attr) => attr.value);
                    const data = [candidate.getAttribute?.("data-urn"), candidate.getAttribute?.("data-id"), candidate.href, ...attrs].filter(Boolean).join(" ");
                    const decoded = (() => {
                      try { return decodeURIComponent(data); } catch { return data; }
                    })();
                    const urn = decoded.match(/urn:li:(?:activity|share):\\d+/);
                    if (urn) return `https://www.linkedin.com/feed/update/${urn[0]}/`;
                  }
                  const href = Array.from(root.querySelectorAll('a[href*="/feed/update/"], a[href*="/posts/"]'))
                    .map((a) => a.href)
                    .find((candidateHref) => /\\/feed\\/update\\//.test(candidateHref) || /\\/posts\\/[^/?#]+/.test(candidateHref));
                  if (!href) return "";
                  try {
                    const parsed = new URL(href);
                    if (/\\/feed\\/update\\//.test(parsed.pathname)) return `${parsed.origin}${parsed.pathname}`;
                    if (/\\/posts\\/[^/?#]+/.test(parsed.pathname)) return `${parsed.origin}${parsed.pathname}`;
                  } catch {
                    return href.split("?")[0];
                  }
                  return href.split("?")[0];
                };
                const roots = Array.from(document.querySelectorAll(
                  '.feed-shared-update-v2, [data-urn*="urn:li:activity"], [data-urn*="urn:li:share"], div[data-id*="urn:li:activity"], div[data-id*="urn:li:share"], div[class*="feed-shared"], article, [role="listitem"]'
                ));
                const hasEngagementControls = (root) => {
                  const haystack = [
                    text(root),
                    ...Array.from(root.querySelectorAll('button, [role="button"], [aria-label]')).map((node) =>
                      `${node.getAttribute?.("aria-label") || ""} ${node.innerText || node.textContent || ""}`
                    ),
                  ].join(" ");
                  return /(Like|React|Reaction button state|いいね|リアクション)/i.test(haystack) && /(Comment|コメント)/i.test(haystack);
                };
                const buttonRoots = Array.from(document.querySelectorAll('button[aria-label*="Reaction button state"], button[aria-label*="React"], button[aria-label*="Like"], button[aria-label*="いいね"], button[aria-label*="リアクション"]'))
                  .map((button) => {
                    let node = button;
                    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
                      const body = text(node);
                      if (
                        node.matches?.('[data-urn], [data-id*="urn:li:activity"], [data-id*="urn:li:share"], .feed-shared-update-v2, [role="listitem"]') ||
                        ((body.startsWith("Feed post") || body.startsWith("フィード投稿")) && hasEngagementControls(node))
                      ) {
                        return node;
                      }
                    }
                    return button.parentElement;
                  })
                  .filter(Boolean);
                for (const root of [...roots, ...buttonRoots]) {
                  const body = text(root);
                  if (!hasEngagementControls(root)) continue;
                  const postLink = linkedInPostUrlFrom(root);
                  const fallbackLink = Array.from(root.querySelectorAll('a[href^="https://www.linkedin.com/in/"], a[href^="https://www.linkedin.com/company/"]'))
                    .map((a) => a.href)
                    .find((href) => !href.includes("/feed/")) || "";
                  const link = postLink || fallbackLink;
                  const url = link;
                  const exactPostLink = Boolean(/\\/feed\\/update\\/urn:li:(?:activity|share):\\d+\\/?/i.test(postLink) || /\\/posts\\/[^/?#]+/i.test(postLink));
                  if (url && body.length > 80) out.push({url, body, author: body.split(" ")[0] || "", candidate_eligible: exactPostLink});
                }
              }
              return out;
            }""",
            platform,
        )
        if isinstance(raw_posts, list):
            for item in raw_posts:
                if not isinstance(item, dict):
                    continue
                target_url = _normalize_feed_post_url(str(item.get("url") or ""))
                body = " ".join(str(item.get("body") or "").split())
                if not target_url or target_url.lower() in seen or len(body) < 80:
                    continue
                if _feed_body_looks_promotional(body):
                    continue
                if platform == "x" and "nichika2000823" in target_url.lower():
                    continue
                candidate_eligible = _feed_entry_candidate_eligible(item)
                if platform == "linkedin" and _feed_entry_target_actionable(platform, target_url):
                    candidate_eligible = True
                if (
                    platform == "linkedin"
                    and not candidate_eligible
                    and _linkedin_readonly_fallback_url(target_url)
                    and linkedin_fallback_resolution_attempts < max_linkedin_fallback_resolution_attempts
                ):
                    linkedin_fallback_resolution_attempts += 1
                    resolved_target_url = _resolve_linkedin_fallback_post_url(page, target_url, body)
                    if resolved_target_url and _feed_entry_target_actionable(platform, resolved_target_url):
                        target_url = resolved_target_url
                        candidate_eligible = True
                        item["candidate_eligible"] = True
                    if target_url.lower() in seen:
                        continue
                seen.add(target_url.lower())
                row = candidate_source_rows[len(collected) % len(candidate_source_rows)]
                if platform == "linkedin":
                    action = "comment_candidate" if len(collected) < 1 else "like_candidate"
                else:
                    action = "comment_candidate" if len(collected) < 2 else "like_candidate"
                collected.append(
                    {
                        "queue_id": row.id,
                        "platform": platform,
                        "url": target_url,
                        "author": str(item.get("author") or "")[:80],
                        "topic": f"Post-publish {platform} recommended/feed engagement",
                        "evidence": body[:360],
                        "engagement_action": action,
                        "candidate_eligible": candidate_eligible,
                    }
                )
                collected_actionable = sum(
                    1
                    for collected_item in collected
                    if _feed_entry_candidate_eligible(collected_item)
                    and _feed_entry_target_actionable(platform, str(collected_item.get("url") or ""))
                )
                collected_target = collected_actionable if platform == "linkedin" else len(collected)
                if collected_target >= limit and scroll_index + 1 >= min_scroll_rounds_before_return:
                    return collected
        try:
            page.evaluate("() => window.scrollBy(0, Math.max(1200, Math.floor(window.innerHeight * 1.5)))")
        except TypeError:
            pass
        page.mouse.wheel(0, 1800)
        page.wait_for_timeout(1200)
    return collected


def _select_feed_study_engagement_action(
    row: QueueRow,
    platform: str,
    requested_action: str,
    caps: dict[str, int],
) -> str:
    if requested_action in {"like_candidate", "comment_candidate", "save_candidate", "quote_candidate"}:
        action = requested_action
    else:
        action = "comment_candidate"

    if action == "quote_candidate":
        action = "comment_candidate"
    if action == "comment_candidate" and caps["comment_candidate"] <= 0:
        action = "save_candidate"
    if action == "save_candidate" and caps["save_candidate"] <= 0:
        action = "like_candidate"
    if action == "like_candidate" and caps["like_candidate"] <= 0:
        return ""
    if caps[action] <= 0:
        return ""
    return action


def _feed_study_platform_action_caps(
    max_actions: int,
    *,
    max_likes: int,
    max_comments: int,
    max_saves: int,
    max_quotes: int,
) -> dict[str, dict[str, int]]:
    total = max(0, max_actions)
    if total <= 0:
        empty = {"total": 0, "like_candidate": 0, "comment_candidate": 0, "save_candidate": 0, "quote_candidate": 0}
        return {"x": dict(empty), "linkedin": dict(empty)}
    if total >= 13 and max_likes >= 10 and max_comments >= 3:
        return {
            "x": {
                "total": 7,
                "like_candidate": 5,
                "comment_candidate": 2,
                "save_candidate": 0,
                "quote_candidate": 0,
            },
            "linkedin": {
                "total": 6,
                "like_candidate": 5,
                "comment_candidate": 1,
                "save_candidate": 0,
                "quote_candidate": 0,
            },
        }
    if total == 1:
        single = {
            "total": 1,
            "like_candidate": max_likes,
            "comment_candidate": max_comments,
            "save_candidate": max_saves,
            "quote_candidate": max_quotes,
        }
        return {"x": dict(single), "linkedin": dict(single)}
    linkedin_total = min(max(1, total // 2), total)
    x_total = max(0, total - linkedin_total)
    if x_total == 0 and total > 1:
        x_total = 1
        linkedin_total = total - 1
    linkedin_comments = min(max_comments, max(1, min(linkedin_total, (max_comments + 1) // 2)))
    x_comments = min(max_comments - linkedin_comments, x_total)
    linkedin_likes = min(max_likes, max(0, linkedin_total - linkedin_comments))
    x_saves = min(max_saves, max(0, x_total - x_comments))
    x_likes = min(max_likes - linkedin_likes, max(0, x_total - x_comments - x_saves))
    return {
        "x": {
            "total": x_total,
            "like_candidate": x_likes,
            "comment_candidate": x_comments,
            "save_candidate": x_saves,
            "quote_candidate": min(max_quotes, x_total),
        },
        "linkedin": {
            "total": linkedin_total,
            "like_candidate": linkedin_likes,
            "comment_candidate": linkedin_comments,
            "save_candidate": 0,
            "quote_candidate": 0,
        },
    }


def _engagement_only_row_id(platform: str, target_url: str) -> str:
    digest = hashlib.sha1(f"{platform}:{_normalize_feed_post_url(target_url).lower()}".encode("utf-8")).hexdigest()[:12]
    return f"eng-{platform}-{digest}"


def _engagement_candidate_row_for_feed_entry(
    rows: list[QueueRow],
    *,
    source_row: QueueRow,
    platform: str,
    target_url: str,
    author: str,
    topic: str,
    evidence: str,
    recorded_at: str,
) -> QueueRow:
    row_id = _engagement_only_row_id(platform, target_url)
    existing = next((row for row in rows if row.id == row_id), None)
    if existing is not None:
        return existing
    title = topic.strip() or f"{platform.upper()} engagement target"
    synthetic = QueueRow(
        id=row_id,
        status="published",
        source_type="engagement_feed",
        source_name=author.strip() or platform,
        source_url=target_url,
        title=title[:180],
        summary_ja=evidence[:360] if platform == "x" else "",
        summary_en=evidence[:360] if platform == "linkedin" else "",
        angle=topic[:240],
        research_status="done",
        freshness_checked_at=recorded_at,
        research_notes=f"Feed read: {evidence}",
        x_research_notes=f"Feed read: {author}: {evidence}" if platform == "x" else "",
        linkedin_research_notes=f"Feed read: {author}: {evidence}" if platform == "linkedin" else "",
        reference_post_urls=target_url,
        engagement_targets=target_url,
        engagement_status="",
        keep_priority="engagement_only",
        quality_score=source_row.quality_score or "10",
        review_status="engagement_ready",
        published_at=source_row.published_at or source_row.x_published_at or source_row.linkedin_published_at,
        owner="daily-ai-engagement",
    )
    rows.append(synthetic)
    return synthetic


def _feed_entry_relationship_row(
    *,
    recorded_at: str,
    row: QueueRow,
    platform: str,
    target_url: str,
    author: str,
    topic: str,
    evidence: str,
    action: str,
    candidate_created: bool,
) -> list[str]:
    handle = author.strip() or target_url
    relationship_stage = "candidate" if candidate_created else "read"
    reply_priority = "high" if action in {"comment_candidate", "quote_candidate"} else "medium" if action else "low"
    next_action = (
        "Send approved external engagement via the Chrome plugin registered runner after expected-account, target/body/comment reflection, enabled-submit, recording, local proof, and completion gates pass; stop with chrome_extension_required if that runner is unavailable."
        if candidate_created
        else "Watch for a more specific future reply opportunity."
    )
    return [
        recorded_at,
        platform,
        handle,
        "",
        relationship_stage,
        recorded_at,
        "",
        action,
        topic,
        "3",
        reply_priority,
        "1",
        evidence,
        row.id,
        target_url,
        next_action,
        "Created from structured feed-study evidence.",
    ]


def _relationship_rows_from_x_watchlist(watchlist_path: str) -> list[list[str]]:
    path = Path(watchlist_path)
    if not path.exists():
        raise typer.BadParameter(f"Watchlist not found: {watchlist_path}")
    rows: list[list[str]] = []
    category = ""
    priority_by_category = {
        "一次ソース": "5",
        "英語圏の実務家": "4",
        "日本語圏の参考先": "3",
    }
    topic_by_category = {
        "一次ソース": "models | api | sdk | security | infrastructure",
        "英語圏の実務家": "operator observations | practical AI usage",
        "日本語圏の参考先": "Japanese AI adoption | hooks | tone",
    }
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("## "):
            category = re.sub(r"^##\s*\d+\.\s*", "", line).strip()
            if category not in priority_by_category:
                category = ""
            continue
        if not category or not line.startswith("- "):
            continue
        name = line[2:].strip()
        if not name:
            continue
        rows.append(
            [
                utc_now(),
                "x",
                name,
                "",
                "watchlist",
                "",
                "",
                "",
                topic_by_category[category],
                priority_by_category[category],
                "medium",
                "0",
                "",
                "",
                "",
                "Read recent posts before engaging; comment only with specific evidence.",
                f"Seeded from docs/x-research-watchlist.md / {category}",
            ]
        )
    return rows


def _apply_feed_study_entries_to_rows(
    rows: list[QueueRow],
    entries: list[dict[str, object]],
    *,
    max_actions: int,
    max_likes: int,
    max_comments: int,
    max_saves: int,
    max_quotes: int,
) -> dict[str, int]:
    rows_by_id = {row.id: row for row in rows}
    caps = {
        "like_candidate": max_likes,
        "comment_candidate": max_comments,
        "save_candidate": max_saves,
        "quote_candidate": max_quotes,
    }
    platform_caps = _feed_study_platform_action_caps(
        max_actions,
        max_likes=max_likes,
        max_comments=max_comments,
        max_saves=max_saves,
        max_quotes=max_quotes,
    )
    platform_counts = {"x": 0, "linkedin": 0}
    metrics = {
        "feed_study_count": len(entries),
        "external_posts_read": 0,
        "engagement_candidates_created": 0,
        "external_engagement_candidates": 0,
        "rows_updated": 0,
        "feed_read_log_rows": [],
        "relationship_map_rows": [],
    }
    seen_targets = _used_external_engagement_target_urls(rows)
    updated_ids: set[str] = set()

    for entry in entries:
        queue_id = _feed_entry_text(entry, "queue_id", "item_id", "id")
        row = rows_by_id.get(queue_id)
        if row is None:
            continue

        target_url = _normalize_feed_post_url(_feed_entry_text(entry, "url", "post_url", "target_url", "engagement_target"))
        platform = _feed_entry_text(entry, "platform").lower() or _engagement_platform(target_url)
        evidence = _feed_entry_text(entry, "evidence", "read_evidence", "observation", "notes", "summary")
        author = _feed_entry_text(entry, "author", "account", "handle")
        topic = _feed_entry_text(entry, "topic", "theme", "title")
        if not target_url or not platform or len(evidence) < 30:
            continue
        if platform not in {"x", "linkedin"}:
            continue
        if _engagement_platform(target_url) != platform:
            continue

        recorded_at = utc_now()
        metrics["external_posts_read"] += 0 if _is_own_engagement_target(row, target_url) else 1
        context = " / ".join(part for part in [author, topic] if part)
        note = f"Feed read: {context}: {evidence}" if context else f"Feed read: {evidence}"
        existing_engagement_target = _normalize_feed_post_url(_first_engagement_target(row)).lower()
        can_refresh_engagement_freshness = (
            row.engagement_status not in {"approved", "done"} or existing_engagement_target == target_url.lower()
        )
        row.reference_post_urls = _append_unique_text(row.reference_post_urls, target_url, separator="\n")
        row.research_status = "done"
        if can_refresh_engagement_freshness:
            row.freshness_checked_at = recorded_at
        if platform == "x":
            row.x_research_notes = _append_unique_text(row.x_research_notes, note, separator="\n")
        else:
            row.linkedin_research_notes = _append_unique_text(row.linkedin_research_notes, note, separator="\n")
        if row.angle.strip() == "" and topic:
            row.angle = topic
        updated_ids.add(row.id)

        if metrics["engagement_candidates_created"] >= max_actions:
            metrics["feed_read_log_rows"].append(
                [recorded_at, row.id, platform, target_url, author, topic, evidence, "", "false"]
            )
            metrics["relationship_map_rows"].append(
                _feed_entry_relationship_row(
                    recorded_at=recorded_at,
                    row=row,
                    platform=platform,
                    target_url=target_url,
                    author=author,
                    topic=topic,
                    evidence=evidence,
                    action="",
                    candidate_created=False,
                )
            )
            continue
        target_key = target_url.lower()
        if (
            not _can_seed_external_engagement_candidate(row)
            or target_key in seen_targets
            or _is_own_engagement_target(row, target_url)
            or not _feed_entry_candidate_eligible(entry)
            or not _feed_entry_target_actionable(platform, target_url)
        ):
            metrics["feed_read_log_rows"].append(
                [recorded_at, row.id, platform, target_url, author, topic, evidence, "", "false"]
            )
            metrics["relationship_map_rows"].append(
                _feed_entry_relationship_row(
                    recorded_at=recorded_at,
                    row=row,
                    platform=platform,
                    target_url=target_url,
                    author=author,
                    topic=topic,
                    evidence=evidence,
                    action="",
                    candidate_created=False,
                )
            )
            continue
        if platform_counts.get(platform, 0) >= platform_caps.get(platform, {}).get("total", max_actions):
            metrics["feed_read_log_rows"].append(
                [recorded_at, row.id, platform, target_url, author, topic, evidence, "", "false"]
            )
            metrics["relationship_map_rows"].append(
                _feed_entry_relationship_row(
                    recorded_at=recorded_at,
                    row=row,
                    platform=platform,
                    target_url=target_url,
                    author=author,
                    topic=topic,
                    evidence=evidence,
                    action="",
                    candidate_created=False,
                )
            )
            continue
        platform_action_caps = platform_caps.get(platform, caps)
        requested_action = _feed_entry_text(entry, "engagement_action", "action")
        if (
            platform_action_caps.get("comment_candidate", 0) > 0
            and requested_action in {"", "like_candidate"}
        ):
            requested_action = "comment_candidate"
        action = _select_feed_study_engagement_action(
            row,
            platform,
            requested_action,
            platform_action_caps,
        )
        if not action:
            metrics["feed_read_log_rows"].append(
                [recorded_at, row.id, platform, target_url, author, topic, evidence, "", "false"]
            )
            metrics["relationship_map_rows"].append(
                _feed_entry_relationship_row(
                    recorded_at=recorded_at,
                    row=row,
                    platform=platform,
                    target_url=target_url,
                    author=author,
                    topic=topic,
                    evidence=evidence,
                    action="",
                    candidate_created=False,
                )
            )
            continue
        target_row = _engagement_candidate_row_for_feed_entry(
            rows,
            source_row=row,
            platform=platform,
            target_url=target_url,
            author=author,
            topic=topic,
            evidence=evidence,
            recorded_at=recorded_at,
        )
        if not _can_auto_prepare_engagement_candidate(target_row):
            continue
        comment_draft = "" if action in {"like_candidate", "save_candidate"} else _external_engagement_comment(target_row, platform)
        if action == "comment_candidate" and not _engagement_comment_quality_ok(comment_draft, platform):
            fallback_action = _select_feed_study_engagement_action(
                target_row,
                platform,
                "like_candidate",
                platform_action_caps,
            )
            if not fallback_action:
                metrics["feed_read_log_rows"].append(
                    [recorded_at, row.id, platform, target_url, author, topic, evidence, "", "false"]
                )
                metrics["relationship_map_rows"].append(
                    _feed_entry_relationship_row(
                        recorded_at=recorded_at,
                        row=row,
                        platform=platform,
                        target_url=target_url,
                        author=author,
                        topic=topic,
                        evidence=evidence,
                        action="",
                        candidate_created=False,
                    )
                )
                continue
            action = fallback_action
            comment_draft = ""
        target_row.engagement_targets = target_url
        target_row.engagement_action = action
        target_row.engagement_reason = "External engagement candidate created from structured feed-study read evidence."
        target_row.comment_draft = comment_draft
        target_row.engagement_status = "approved"
        target_row.next_action = (
            "Send approved external engagement via the Chrome plugin registered runner after expected-account, target/body/comment reflection, enabled-submit, completion, recording, and local video/Record-Replay proof gates pass; "
            "stop with chrome_extension_required or a specific reflection/completion blocker if the lane cannot satisfy them."
        )
        caps[action] -= 1
        platform_action_caps[action] -= 1
        platform_counts[platform] = platform_counts.get(platform, 0) + 1
        seen_targets.add(target_key)
        metrics["engagement_candidates_created"] += 1
        metrics["external_engagement_candidates"] += 1
        metrics["feed_read_log_rows"].append(
            [recorded_at, row.id, platform, target_url, author, topic, evidence, action, "true"]
        )
        metrics["relationship_map_rows"].append(
            _feed_entry_relationship_row(
                recorded_at=recorded_at,
                row=row,
                platform=platform,
                target_url=target_url,
                author=author,
                topic=topic,
                evidence=evidence,
                action=action,
                candidate_created=True,
            )
        )

    metrics["rows_updated"] = len(updated_ids)
    return metrics


def _discovered_feed_item_to_row(entry: dict[str, object], existing_ids: set[str], existing_urls: set[str]) -> QueueRow | None:
    source_url = _feed_entry_text(entry, "source_url", "original_url", "canonical_url", "url")
    if not source_url or source_url.lower() in existing_urls:
        return None
    item_id = make_item_id(source_url)
    if item_id in existing_ids:
        return None

    title = _feed_entry_text(entry, "title", "topic", "headline")
    summary = _feed_entry_text(entry, "summary", "evidence", "observation", "notes", "why_it_matters")
    if not title or len(summary) < 40:
        return None

    platform = _feed_entry_text(entry, "platform").lower()
    author = _feed_entry_text(entry, "author", "account", "handle")
    source_name = _feed_entry_text(entry, "source_name")
    if not source_name:
        source_name = "X/LinkedIn discovery" if platform in {"x", "linkedin"} else "Web discovery"
    post_url = _feed_entry_text(entry, "post_url", "social_url", "reference_post_url", "engagement_target")
    source_chain = _feed_entry_text(entry, "source_chain", "source_used", "source")
    post_shape = _feed_entry_text(entry, "post_shape", "format", "post_type")
    angle = _feed_entry_text(entry, "angle", "takeaway")
    media_plan = _feed_entry_text(entry, "media_plan")
    reference_note_parts = [part for part in [source_chain, post_shape, summary] if part]

    row = QueueRow(
        id=item_id,
        source_type="social_discovery" if platform in {"x", "linkedin"} else "web_discovery",
        source_name=source_name,
        source_url=source_url,
        title=title,
        summary_en=summary,
        summary_ja="",
        angle=angle,
        status="collected",
        collected_at=utc_now(),
        research_status="done",
        freshness_checked_at=utc_now(),
        reference_post_urls=post_url,
        reference_account_handles=author,
        reference_media_notes=" / ".join(reference_note_parts),
        media_plan=media_plan,
        next_action="Draft from daily_discovery_mix after verifying the original source and Nichika-specific angle.",
    )
    if platform == "x":
        row.x_research_notes = f"Discovered from X feed/watchlist: {author}: {summary}".strip()
    elif platform == "linkedin":
        row.linkedin_research_notes = f"Discovered from LinkedIn feed/watchlist: {author}: {summary}".strip()
    else:
        row.research_notes = f"Discovered from web/news search: {summary}"
    _apply_quality_scores(row)
    _apply_inventory_labels(row)
    return row


def _discovered_feed_items_to_rows(payload: object, rows: list[QueueRow]) -> list[QueueRow]:
    existing_ids = {row.id for row in rows}
    existing_urls = {row.source_url.strip().lower() for row in rows if row.source_url.strip()}
    discovered_rows: list[QueueRow] = []
    for entry in _feed_study_discovered_items(payload):
        row = _discovered_feed_item_to_row(entry, existing_ids, existing_urls)
        if row is None:
            continue
        discovered_rows.append(row)
        existing_ids.add(row.id)
        existing_urls.add(row.source_url.strip().lower())
    return discovered_rows


def _total_engagements(row: QueueRow) -> int:
    return (
        _safe_int(row.x_like_count)
        + _safe_int(row.x_reply_count)
        + _safe_int(row.x_repost_count)
        + _safe_int(row.x_quote_count)
        + _safe_int(row.linkedin_reaction_count)
        + _safe_int(row.linkedin_comment_count)
        + _safe_int(row.linkedin_reshare_count)
    )


def _total_impressions(row: QueueRow) -> int:
    return _safe_int(row.x_impression_count) + _safe_int(row.linkedin_impression_count)


def _write_performance_learning_artifact(rows: list[QueueRow], artifact_path: str | None = None) -> Path:
    if artifact_path is None:
        artifact_path = f"artifacts/feed-study/{datetime.now(timezone.utc).date().isoformat()}-performance-learning.md"
    path = Path(artifact_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    published = [row for row in rows if row.status == "published" and (row.x_post_url or row.linkedin_post_url)]
    groups: dict[str, list[QueueRow]] = defaultdict(list)
    for row in published:
        key = row.content_format or row.publish_strategy or "unknown"
        groups[key].append(row)

    lines = [
        f"# Daily AI performance learning - {utc_now()}",
        "",
        f"- Published rows reviewed: {len(published)}",
        "",
        "## Format Signals",
    ]
    for key, group_rows in sorted(groups.items()):
        impressions = sum(_total_impressions(row) for row in group_rows)
        engagements = sum(_total_engagements(row) for row in group_rows)
        rate = (engagements / impressions) if impressions else 0
        lines.append(f"- {key}: rows={len(group_rows)} impressions={impressions} engagements={engagements} engagement_rate={rate:.4f}")

    ranked = sorted(published, key=lambda row: (_total_engagements(row), _total_impressions(row)), reverse=True)[:5]
    lines.extend(["", "## Top Rows"])
    for row in ranked:
        lines.append(
            f"- {row.id}: {row.title} | format={row.content_format or '(blank)'} | "
            f"engagements={_total_engagements(row)} | impressions={_total_impressions(row)}"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _performance_learning_rows(rows: list[QueueRow], generated_at: str | None = None) -> list[list[str]]:
    if generated_at is None:
        generated_at = utc_now()
    published = [row for row in rows if row.status == "published" and (row.x_post_url or row.linkedin_post_url)]
    groups: dict[str, list[QueueRow]] = defaultdict(list)
    for row in published:
        key = row.content_format or row.publish_strategy or "unknown"
        groups[key].append(row)

    values: list[list[str]] = []
    for key, group_rows in sorted(groups.items()):
        impressions = sum(_total_impressions(row) for row in group_rows)
        engagements = sum(_total_engagements(row) for row in group_rows)
        rate = (engagements / impressions) if impressions else 0
        top_row = max(group_rows, key=lambda row: (_total_engagements(row), _total_impressions(row)))
        values.append(
            [
                generated_at,
                "content_format",
                key,
                str(len(group_rows)),
                str(impressions),
                str(engagements),
                f"{rate:.4f}",
                f"top_row={top_row.id}",
            ]
        )
    return values


def _is_publish_flow_candidate(row: QueueRow) -> bool:
    if _has_duplicate_candidate_marker(row):
        return False
    if not _has_publishable_missing_target(row):
        return False
    if row.status == "partially_published" or _is_partial_publish_resume_row(row):
        return _effective_keep_priority(row) != "drop"
    if _quality_score_value(row) < 10:
        return False
    if _effective_keep_priority(row) != "ship_now":
        return False
    if row.status == "scheduled":
        return _is_due(row) or row.review_status == "ready_morning"
    if row.status == "approved":
        return True
    if row.status == "drafted":
        return True
    return False


def _publish_status_rank(row: QueueRow) -> int:
    if row.status == "partially_published" or _is_partial_publish_resume_row(row):
        return 3
    if row.status == "approved":
        return 2
    if row.status == "scheduled":
        return 1
    if row.status == "drafted":
        return 0
    return -1


def _publish_flow_candidates(rows: list[QueueRow], max_items: int) -> list[QueueRow]:
    for row in rows:
        _seed_source_url_for_link_surfaces(row)
    candidates = [row for row in rows if _is_publish_flow_candidate(row) and not _publish_candidate_blockers(row, rows)]
    partial_candidates = [row for row in candidates if row.status == "partially_published" or _is_partial_publish_resume_row(row)]
    if partial_candidates:
        candidates = sorted(
            partial_candidates,
            key=lambda row: (
                _parse_iso_datetime(row.x_published_at or row.linkedin_published_at or row.published_at).timestamp()
                if (row.x_published_at or row.linkedin_published_at or row.published_at)
                else _row_latest_activity_epoch(row),
                row.id,
            ),
        )
        if max_items <= 0:
            return candidates
        return candidates[:max_items]
    candidates.sort(
        key=lambda row: (
            _publish_status_rank(row),
            _quality_score_value(row),
            row.review_status == "ready_morning",
            row.drafted_at or row.collected_at,
        ),
        reverse=True,
    )
    if max_items <= 0:
        return candidates
    return candidates[:max_items]


def _upsert_documents(repo: SheetsRepository | LocalQueueRepository, rows: list[QueueRow]) -> int:
    existing_ids = {row.id for row in repo.read_all()}
    added = 0
    for row in rows:
        if row.id in existing_ids:
            continue
        repo.append(row)
        added += 1
    return added


def _draft_hard_timeout_seconds(settings: Settings) -> float:
    raw_value = os.environ.get("DAILY_AI_DRAFT_HARD_TIMEOUT_SECONDS", "").strip()
    if not raw_value:
        return 0.0
    try:
        return max(0.0, float(raw_value))
    except ValueError:
        try:
            return max(0.0, float(settings.draft_timeout_seconds) + 5.0)
        except (AttributeError, TypeError, ValueError):
            return 50.0


def _generate_localized_copy_process_target(settings: Settings, row: QueueRow, result_sender) -> None:
    try:
        client = build_draft_client(settings)
        result = generate_localized_copy(client=client, model=settings.draft_model, row=row)
    except Exception as exc:
        result_sender.send({"ok": False, "error": " ".join(str(exc).split())[:1000]})
    else:
        result_sender.send({"ok": True, "result": result})


def _generate_localized_copy_bounded(settings: Settings, row: QueueRow) -> dict[str, str]:
    timeout_seconds = _draft_hard_timeout_seconds(settings)
    if timeout_seconds <= 0:
        client = build_draft_client(settings)
        return generate_localized_copy(client=client, model=settings.draft_model, row=row)

    result_receiver, result_sender = mp.Pipe(duplex=False)
    process = mp.Process(
        target=_generate_localized_copy_process_target,
        args=(settings, row, result_sender),
        daemon=True,
    )
    process.start()
    result_sender.close()
    process.join(timeout_seconds)
    if process.is_alive():
        process.terminate()
        process.join(5)
        if process.is_alive():
            process.kill()
            process.join(5)
        raise RuntimeError(
            f"openai_https_read_timeout: draft generation exceeded {timeout_seconds:g}s for queue_id={row.id}"
        )
    if not result_receiver.poll(0):
        raise RuntimeError(f"openai_draft_worker_no_result: queue_id={row.id}")
    payload = result_receiver.recv()
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error") or f"openai_draft_worker_failed: queue_id={row.id}")
    result = payload.get("result")
    if not isinstance(result, dict):
        raise RuntimeError(f"openai_draft_worker_invalid_result: queue_id={row.id}")
    return result


def _draft_queue_rows(
    repo: SheetsRepository | LocalQueueRepository,
    settings: Settings,
    *,
    item_id: str | None = None,
    force: bool = False,
    max_items: int | None = None,
) -> int:
    rows = repo.read_all()
    targets = [row for row in rows if row.id == item_id] if item_id else rows
    if item_id is None:
        targets = sorted(
            targets,
            key=lambda row: (
                {"ship_now": 2, "hold": 1, "drop": 0}.get(_effective_keep_priority(row), 0),
                _quality_score_value(row),
                _safe_int(row.source_priority_score),
                row.freshness_checked_at or row.collected_at,
            ),
            reverse=True,
        )
    drafted = 0
    for row in targets:
        if max_items is not None and drafted >= max_items:
            break
        if row.status not in {"collected", "failed"} and not force:
            continue
        if not force and _effective_keep_priority(row) == "drop":
            continue
        try:
            result = _generate_localized_copy_bounded(settings, row)
            row.summary_ja = result["summary_ja"].strip()
            row.angle = result.get("angle", row.angle).strip()
            row.x_text = result["x_text"].strip()
            row.linkedin_text = result["linkedin_text"].strip()
            row.media_plan = result.get("media_plan", row.media_plan).strip()
            row.status = "drafted"
            row.drafted_at = utc_now()
            row.error = ""
            repo.update(row)
            drafted += 1
        except Exception as exc:
            row.status = "failed"
            row.error = str(exc)
            repo.update(row)
    return drafted


def _sync_local_queue_to_sheets(
    local_repo: LocalQueueRepository,
    sheets_repo: SheetsRepository,
) -> int:
    timeout_raw = os.getenv("SOCIAL_FLOW_SHEETS_SYNC_SOCKET_TIMEOUT_SECONDS", "30").strip()
    try:
        timeout_seconds = max(5.0, float(timeout_raw))
    except ValueError:
        timeout_seconds = 30.0
    previous_timeout = socket.getdefaulttimeout()
    socket.setdefaulttimeout(timeout_seconds)
    try:
        return sheets_repo.upsert_many(_sanitize_queue_rows_for_sheets(local_repo.read_all()))
    finally:
        socket.setdefaulttimeout(previous_timeout)


def _sanitize_queue_rows_for_sheets(rows: list[QueueRow]) -> list[QueueRow]:
    return [_sanitize_queue_row_for_sheets(row) for row in rows]


def _sanitize_queue_row_for_sheets(row: QueueRow) -> QueueRow:
    replacements: dict[str, str] = {}
    for field_name in row.__dataclass_fields__:
        value = getattr(row, field_name)
        if isinstance(value, str) and len(value) > GOOGLE_SHEETS_CELL_CHARACTER_LIMIT:
            replacements[field_name] = value[:GOOGLE_SHEETS_CELL_CHARACTER_LIMIT]
    return replace(row, **replacements) if replacements else row


def _sync_local_queue_to_sheets_process_target(path: str, result_queue) -> None:
    try:
        count = _sync_local_queue_to_sheets(get_local_repo(path), get_repo())
    except Exception as exc:
        result_queue.put({"ok": False, "error": " ".join(str(exc).split())[:500]})
    else:
        result_queue.put({"ok": True, "count": count})


def _sync_local_queue_to_sheets_bounded(path: str) -> int:
    timeout_raw = os.getenv("SOCIAL_FLOW_SHEETS_SYNC_HARD_TIMEOUT_SECONDS", "45").strip()
    try:
        timeout_seconds = max(0.1, float(timeout_raw))
    except ValueError:
        timeout_seconds = 45.0
    result_queue = mp.Queue()
    process = mp.Process(
        target=_sync_local_queue_to_sheets_process_target,
        args=(path, result_queue),
        daemon=True,
    )
    process.start()
    process.join(timeout_seconds)
    if process.is_alive():
        process.terminate()
        process.join(5)
        raise TimeoutError(f"sheets_sync_timeout_after_{int(timeout_seconds)}s")
    try:
        payload = result_queue.get(timeout=2)
    except queue.Empty as exc:
        raise RuntimeError("sheets_sync_no_result") from exc
    finally:
        result_queue.close()
        result_queue.join_thread()
    if not payload.get("ok"):
        raise RuntimeError(str(payload.get("error") or "sheets_sync_failed"))
    return int(payload.get("count") or 0)


def _documents_to_rows(documents: list[SourceDocument]) -> list[QueueRow]:
    queue_rows: list[QueueRow] = []
    for doc in documents:
        item_id = make_item_id(doc.url)
        drive_file_id = extract_google_drive_file_id(doc.url) if doc.source_type == "google_drive" else ""
        row = QueueRow(
            id=item_id,
            source_type=doc.source_type,
            source_name=doc.source_name,
            source_url=doc.url,
            title=doc.title,
            summary_en=doc.summary_en,
            drive_file_id=drive_file_id,
            drive_file_name=doc.title if doc.source_type == "google_drive" else "",
            drive_web_url=doc.url if doc.source_type == "google_drive" else "",
            tiktok_enabled="true",
            instagram_enabled="true",
            youtube_shorts_enabled="true",
            facebook_reels_enabled="true",
            tiktok_post_status="pending" if doc.source_type == "google_drive" else "",
            instagram_post_status="pending" if doc.source_type == "google_drive" else "",
            youtube_post_status="pending" if doc.source_type == "google_drive" else "",
            facebook_post_status="pending" if doc.source_type == "google_drive" else "",
            status="collected",
            collected_at=utc_now(),
        )
        _apply_quality_scores(row)
        if doc.source_type == "url_fetch_failed":
            row.keep_priority = "hold"
            row.research_status = "in_progress"
            row.review_notes = "Source fetch timed out; official source URL preserved for retry and drafting."
            row.next_action = "Retry source fetch or use browser-visible source text before publish; do not treat fetch timeout as no candidate."
            row.quality_notes = f"{row.quality_notes} / fetch retry required"
        queue_rows.append(row)
    return queue_rows


def _collect_documents_from_sources(settings: Settings) -> list[object]:
    if not settings.sources_config_json:
        raise ValueError("SOCIAL_FLOW_SOURCES_CONFIG_JSON is required for collect-sources.")
    return collect_from_source_configs(settings.sources_config_json)


def _source_collection_hard_timeout_seconds() -> float:
    raw_value = os.environ.get("SOCIAL_FLOW_SOURCE_COLLECTION_HARD_TIMEOUT_SECONDS", "").strip()
    if not raw_value:
        return 0.0
    try:
        return max(0.0, float(raw_value))
    except ValueError:
        return 75.0


def _collect_documents_from_sources_process_target(settings: Settings, result_sender) -> None:
    try:
        documents = _collect_documents_from_sources(settings)
    except Exception as exc:
        result_sender.send({"ok": False, "error": " ".join(str(exc).split())[:1000]})
    else:
        result_sender.send({"ok": True, "documents": documents})


def _collect_documents_from_sources_bounded(settings: Settings) -> list[object]:
    timeout_seconds = _source_collection_hard_timeout_seconds()
    if timeout_seconds <= 0:
        return _collect_documents_from_sources(settings)

    result_receiver, result_sender = mp.Pipe(duplex=False)
    process = mp.Process(
        target=_collect_documents_from_sources_process_target,
        args=(settings, result_sender),
        daemon=True,
    )
    process.start()
    result_sender.close()
    process.join(timeout_seconds)
    if process.is_alive():
        process.terminate()
        process.join(5)
        if process.is_alive():
            process.kill()
            process.join(5)
        raise TimeoutError(f"source_collection_timeout_after_{timeout_seconds:g}s")
    if not result_receiver.poll(0):
        raise RuntimeError("source_collection_worker_no_result")
    payload = result_receiver.recv()
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error") or "source_collection_failed")
    documents = payload.get("documents")
    if not isinstance(documents, list):
        raise RuntimeError("source_collection_worker_invalid_result")
    return documents


def _get_row_or_raise(repo: SheetsRepository | LocalQueueRepository, item_id: str) -> QueueRow:
    row = repo.get(item_id)
    if row is None:
        raise typer.BadParameter(f"Unknown id: {item_id}")
    return row


def _merge_reference_post_urls(row: QueueRow, generated_urls: list[str]) -> str:
    existing = [part.strip() for part in re.split(r"[\n,|]+", row.reference_post_urls) if part.strip()]
    merged: list[str] = []
    seen: set[str] = set()
    for url in [*existing, *generated_urls]:
        normalized = url.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        merged.append(normalized)
    return ", ".join(merged)


def _apply_research_updates(
    row: QueueRow,
    *,
    research_status: str | None,
    freshness_checked_at: str | None,
    angle: str | None,
    x_research_notes: str | None,
    linkedin_research_notes: str | None,
    past_post_reference: str | None,
    reference_post_urls: str | None,
    reference_account_handles: str | None,
    reference_media_urls: str | None,
    reference_media_notes: str | None,
    media_plan: str | None,
) -> None:
    changed = False
    for field_name, value in [
        ("research_status", research_status),
        ("angle", angle),
        ("x_research_notes", x_research_notes),
        ("linkedin_research_notes", linkedin_research_notes),
        ("past_post_reference", past_post_reference),
        ("reference_post_urls", reference_post_urls),
        ("reference_account_handles", reference_account_handles),
        ("reference_media_urls", reference_media_urls),
        ("reference_media_notes", reference_media_notes),
        ("media_plan", media_plan),
    ]:
        if value is None:
            continue
        setattr(row, field_name, value.strip())
        changed = True

    if freshness_checked_at is not None:
        row.freshness_checked_at = _parse_iso_datetime(freshness_checked_at).replace(microsecond=0).isoformat()
        changed = True
    elif changed:
        row.freshness_checked_at = utc_now()
    _apply_quality_scores(row)


def _hydrate_post_ids_from_urls(row: QueueRow) -> None:
    if not row.x_post_id and row.x_post_url:
        row.x_post_id = extract_x_post_id(row.x_post_url)
    if not row.linkedin_post_id and row.linkedin_post_url:
        row.linkedin_post_id = extract_linkedin_post_id(row.linkedin_post_url)


@app.command(
    "open-automation-chrome",
    help=(
        "隔離診断用 Chrome プロファイルを開きます。Daily AI の投稿本線では使いません。"
    ),
)
def open_automation_chrome(
    start_url: str = "about:blank",
    allow_isolated_diagnostic: Annotated[
        bool,
        typer.Option(
            "--allow-isolated-diagnostic",
            help="Explicitly allow the isolated diagnostic Chrome profile. Never use this for Daily AI posting.",
        ),
    ] = False,
) -> None:
    if not allow_isolated_diagnostic:
        raise typer.BadParameter(
            "open-automation-chrome opens an isolated diagnostic profile and is disabled by default. "
            "Daily AI posting must use the Chrome plugin registered runner. "
            "Pass --allow-isolated-diagnostic only for non-posting diagnostics."
        )
    settings = load_settings()
    if not settings.chrome_executable_path:
        raise typer.BadParameter("CHROME_EXECUTABLE_PATH is not set.")

    user_data_dir = Path(settings.chrome_user_data_dir).expanduser()
    user_data_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "open",
        "-na",
        "Google Chrome",
        "--args",
        f"--user-data-dir={user_data_dir}",
        f"--profile-directory={settings.chrome_profile_directory}",
        start_url,
    ]
    subprocess.Popen(cmd)
    typer.echo(
        f"Opened fallback automation Chrome profile at {user_data_dir} "
        f"({settings.chrome_profile_directory}). "
        "Main path is the already-open logged-in Chrome session."
    )


@app.command(
    "chrome-main-profile-status",
    help="Chrome plugin がどのプロファイルを見やすいかと、local automation profile 側の extension 状態を確認します。",
)
def chrome_main_profile_status() -> None:
    settings = load_settings()
    summary = _read_local_state_profile_summary(settings.chrome_main_user_data_dir)
    explicit = _run_chrome_extension_check(settings.chrome_main_preferences_path)

    typer.echo(f"Chrome main user data dir: {settings.chrome_main_user_data_dir}")
    typer.echo(f"Preferred main profile: {settings.chrome_main_profile_directory}")
    typer.echo(f"Preferred main Preferences: {settings.chrome_main_preferences_path}")

    if summary:
        typer.echo(f"Chrome last_used: {summary.get('last_used', '')}")
        typer.echo(f"Chrome last_active_profiles: {summary.get('last_active_profiles', [])}")
        profiles = summary.get("profiles", {})
        if isinstance(profiles, dict):
            for profile_id, info in profiles.items():
                if isinstance(info, dict):
                    typer.echo(
                        f"{profile_id}: name={info.get('name', '')} user={info.get('user_name', '')}"
                    )

    if explicit.get("ok"):
        typer.echo(
            "Local automation profile extension status: "
            f"installed={explicit.get('installed')} "
            f"enabled={explicit.get('enabled')} "
            f"profile={explicit.get('profilePath', '')}"
        )
    else:
        typer.echo(f"Local automation profile extension status check failed: {explicit.get('error', 'unknown error')}")


@app.command(
    "automation-lane-status",
    help="Nicky automation profile lane が他の social-flow 実行で使用中かを確認します。",
)
def automation_lane_status(
    remote_debugging_port: Annotated[
        int | None,
        typer.Option(
            "--remote-debugging-port",
            help="確認する CDP port。既定は CHROME_MAIN_REMOTE_DEBUGGING_PORT。",
        ),
    ] = None,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="機械処理向けに JSON で出力する。"),
    ] = False,
    owner: Annotated[
        str,
        typer.Option("--owner", help="この owner の active marker は同一実行として busy 判定から除外する。"),
    ] = "",
) -> None:
    settings = load_settings()
    port = remote_debugging_port or settings.chrome_main_remote_debugging_port
    payload = _automation_lane_status_payload(settings, port, owner=owner or None)
    if json_output:
        typer.echo(json.dumps(payload, ensure_ascii=False))
        raise typer.Exit(code=0 if payload["ok"] else 1)

    typer.echo(f"Nicky automation lane: {'busy' if payload['busy'] else 'available'}")
    typer.echo(f"Profile: {payload['profile_label']} ({payload['profile_directory']})")
    typer.echo(f"CDP port {port}: {'ok' if payload['cdp_ok'] else 'unavailable'}")
    typer.echo(f"Chrome processes: {payload['chrome_process_count']}")
    typer.echo(f"social-flow processes: {payload['social_flow_process_count']}")
    if payload["busy"]:
        typer.echo(f"stop_reason: {payload['stop_reason']}")
    typer.echo(str(payload["next_action"]))


@app.command(
    "resolve-browser-lane",
    help="認証付きWeb操作の legacy lane 診断を行います。Daily AI production は Chrome plugin registered runner を使います。",
)
def resolve_browser_lane(
    purpose: Annotated[
        str,
        typer.Option(
            "--purpose",
            help="用途ラベル。publish, engagement, job, nisenprints, generic など。",
        ),
    ] = "generic",
    remote_debugging_port: Annotated[
        int | None,
        typer.Option(
            "--remote-debugging-port",
            help="確認する CDP port。既定は CHROME_MAIN_REMOTE_DEBUGGING_PORT。",
        ),
    ] = None,
    open_if_missing: Annotated[
        bool,
        typer.Option(
            "--open-if-missing/--no-open-if-missing",
            help="Nicky が busy でなく CDP が見えない場合に automation profile の起動を試す。",
        ),
    ] = True,
    timeout_seconds: Annotated[
        float,
        typer.Option("--timeout-seconds", help="CDP endpoint の待機秒数。"),
    ] = 8.0,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="機械処理向けに JSON で出力する。"),
    ] = False,
    owner: Annotated[
        str,
        typer.Option("--owner", help="この owner の active marker は同一実行として busy 判定から除外する。"),
    ] = "",
) -> None:
    settings = load_settings()
    port = remote_debugging_port or settings.chrome_main_remote_debugging_port
    payload = _browser_lane_resolution_payload(
        settings,
        port,
        purpose,
        open_if_missing,
        timeout_seconds,
        owner=owner or None,
    )
    if json_output:
        typer.echo(json.dumps(payload, ensure_ascii=False))
        raise typer.Exit(code=0 if payload["ok"] else 1)

    typer.echo(f"Resolved browser lane: {payload['lane']}")
    typer.echo(f"Purpose: {payload['purpose']}")
    typer.echo(f"Profile: {payload['profile_label']} ({payload['profile_directory']})")
    if payload.get("stop_reason"):
        typer.echo(f"stop_reason: {payload['stop_reason']}")
    typer.echo(str(payload["next_action"]))


@app.command(
    "mark-automation-lane-busy",
    help="Nicky automation profile lane の busy marker を診断情報として記録します。",
)
def mark_automation_lane_busy(
    reason: Annotated[
        str,
        typer.Option("--reason", help="busy marker の理由。"),
    ] = "user_reported_busy",
    owner: Annotated[
        str,
        typer.Option("--owner", help="lane 使用者または automation 名。"),
    ] = "user",
    task: Annotated[
        str,
        typer.Option("--task", help="lane を使用中の作業名。"),
    ] = "",
    ttl_minutes: Annotated[
        int,
        typer.Option("--ttl-minutes", help="marker の有効期限。0 以下なら期限なし。"),
    ] = 180,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="機械処理向けに JSON で出力する。"),
    ] = False,
) -> None:
    path = _automation_lane_busy_marker_path()
    now = datetime.now(timezone.utc)
    payload: dict[str, object] = {
        "reason": reason,
        "owner": owner,
        "task": task,
        "created_at": now.isoformat(),
    }
    if ttl_minutes > 0:
        payload["expires_at"] = (now + timedelta(minutes=ttl_minutes)).isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    result = {"ok": True, "busy_marker_set": True, "busy_marker_path": str(path), "busy_marker": payload}
    if json_output:
        typer.echo(json.dumps(result, ensure_ascii=False))
    else:
        typer.echo(f"Recorded Nicky automation lane busy marker: {path}")


@app.command(
    "clear-automation-lane-busy",
    help="Nicky automation profile lane の明示 busy marker を削除します。",
)
def clear_automation_lane_busy(
    json_output: Annotated[
        bool,
        typer.Option("--json", help="機械処理向けに JSON で出力する。"),
    ] = False,
    owner: Annotated[
        str,
        typer.Option("--owner", help="指定した場合、marker owner が一致するときだけ削除する。"),
    ] = "",
) -> None:
    result = _clear_automation_lane_busy_marker(owner=owner or None)
    if json_output:
        typer.echo(json.dumps(result, ensure_ascii=False))
    else:
        path = result["busy_marker_path"]
        if result.get("owner_mismatch"):
            typer.echo(f"Did not clear Nicky automation lane busy marker owned by another owner: {path}")
        elif result.get("cleared"):
            typer.echo(f"Cleared Nicky automation lane busy marker: {path}")
        else:
            typer.echo(f"No busy marker found: {path}")


def _write_automation_lane_busy_marker(
    *,
    reason: str,
    owner: str,
    task: str,
    ttl_minutes: int,
) -> dict[str, object]:
    path = _automation_lane_busy_marker_path()
    now = datetime.now(timezone.utc)
    payload: dict[str, object] = {
        "reason": reason,
        "owner": owner,
        "task": task,
        "created_at": now.isoformat(),
    }
    if ttl_minutes > 0:
        payload["expires_at"] = (now + timedelta(minutes=ttl_minutes)).isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "busy_marker_set": True, "busy_marker_path": str(path), "busy_marker": payload}


def _clear_automation_lane_busy_marker(owner: str | None = None) -> dict[str, object]:
    path = _automation_lane_busy_marker_path()
    existed = path.exists()
    marker_owner = ""
    if existed:
        if owner:
            marker, _ = _automation_lane_busy_marker(now=datetime.now(timezone.utc))
            marker_owner = str((marker or {}).get("owner") or "").strip()
            if marker_owner and marker_owner != owner:
                return {
                    "ok": False,
                    "cleared": False,
                    "owner_mismatch": True,
                    "expected_owner": owner,
                    "actual_owner": marker_owner,
                    "busy_marker_path": str(path),
                }
        path.unlink()
    return {"ok": True, "cleared": existed, "owner_mismatch": False, "actual_owner": marker_owner, "busy_marker_path": str(path)}


def _chrome_profile2_preferences_path() -> Path:
    return (
        Path.home()
        / "Library"
        / "Application Support"
        / "Google"
        / "Chrome"
        / "Profile 2"
        / "Preferences"
    )


def _chrome_open_window_script_path() -> Path:
    return (
        Path.home()
        / ".codex"
        / "plugins"
        / "cache"
        / "openai-bundled"
        / "chrome"
        / CHROME_BUNDLED_VERSION
        / "scripts"
        / "open-chrome-window.js"
    )


@app.command(
    "print-chrome-plugin-profile-env",
    help="Codex Chrome plugin を local automation profile に寄せるための環境変数を表示します。",
)
def print_chrome_plugin_profile_env() -> None:
    settings = load_settings()
    typer.echo(
        f'export CODEX_CHROME_PREFERENCES_PATH="{settings.chrome_main_preferences_path}"\n'
        f'export CODEX_CHROME_USER_DATA_DIR="{settings.chrome_main_user_data_dir}"'
    )


@app.command(
    "chrome-profile2-preflight",
    help="Chrome Plugin/Profile 2 の read-only health check と open 再開用 pin を表示します。",
)
def chrome_profile2_preflight(
    json_output: Annotated[
        bool,
        typer.Option("--json", help="機械処理向けに JSON で出力する。"),
    ] = False,
) -> None:
    preferences_path = _chrome_profile2_preferences_path()
    user_data_dir = preferences_path.parent.parent
    health_check = _run_chrome_extension_check(str(preferences_path))
    open_window_script_path = _chrome_open_window_script_path()
    open_window_preview = {
        "command": "node",
        "args": [str(open_window_script_path), "--dry-run", "--json"],
        "env": {
            "CODEX_CHROME_PREFERENCES_PATH": str(preferences_path),
            "CODEX_CHROME_USER_DATA_DIR": str(user_data_dir),
        },
        "script_exists": open_window_script_path.exists(),
    }
    payload = {
        "ok": bool(health_check.get("installed")) and bool(health_check.get("enabled")),
        "profile_directory": "Profile 2",
        "preferences_path": str(preferences_path),
        "user_data_dir": str(user_data_dir),
        "codex_chrome_preferences_path": str(preferences_path),
        "codex_chrome_user_data_dir": str(user_data_dir),
        "health_check": health_check,
        "open_window_preview": open_window_preview,
    }
    if json_output:
        typer.echo(json.dumps(payload, ensure_ascii=False))
        raise typer.Exit(code=0 if payload["ok"] else 1)

    typer.echo("Chrome Plugin/Profile 2 preflight")
    typer.echo(f"Profile directory: {payload['profile_directory']}")
    typer.echo(f"Preferences: {payload['preferences_path']}")
    typer.echo(f"User data dir: {payload['user_data_dir']}")
    typer.echo(
        f"Health check: installed={health_check.get('installed')} enabled={health_check.get('enabled')} "
        f"selected={health_check.get('selectedProfileDirectory', '')}"
    )
    typer.echo(f"Pin for health checks: export CODEX_CHROME_PREFERENCES_PATH=\"{preferences_path}\"")
    typer.echo(f"Pin for Profile 2 opens: export CODEX_CHROME_USER_DATA_DIR=\"{user_data_dir}\"")
    typer.echo(
        "Dry-run open command: "
        f"CODEX_CHROME_PREFERENCES_PATH=\"{preferences_path}\" "
        f"CODEX_CHROME_USER_DATA_DIR=\"{user_data_dir}\" "
        f"node {open_window_preview['args'][0]} --dry-run --json"
    )


@app.command(
    "print-chrome-task-groups",
    help="二千 (Nicky automation) を母艦にしたときの推奨タブグループ名を表示します。",
)
def print_chrome_task_groups() -> None:
    settings = load_settings()
    typer.echo(f"Execution profile: {settings.chrome_main_profile_label} ({settings.chrome_main_profile_directory})")
    typer.echo("Recommended tab groups:")
    for group in _recommended_chrome_task_groups(settings):
        typer.echo(f"- {group}")
    typer.echo("Policy: keep all social-flow work inside these groups and do not mix fallback automation tabs with the main profile groups.")


@app.command(
    "open-main-chrome-profile",
    help="主経路用の Nicky automation Chrome profile を Playwright 接続できる形で開きます。",
)
def open_main_chrome_profile(
    positional_start_url: Annotated[
        str | None,
        typer.Argument(help="Optional URL to open in the local Nicky automation profile."),
    ] = None,
    start_url: Annotated[
        str | None,
        typer.Option("--start-url", help="Optional URL to open in the local Nicky automation profile."),
    ] = None,
    remote_debugging_port: Annotated[
        int | None,
        typer.Option(
            "--remote-debugging-port",
            help="Nicky automation profile を Playwright CDP 接続できる形で開くための port。既定は CHROME_MAIN_REMOTE_DEBUGGING_PORT。",
        ),
    ] = None,
) -> None:
    settings = load_settings()
    if not settings.chrome_executable_path:
        raise typer.BadParameter("CHROME_EXECUTABLE_PATH is not set.")

    main_user_data_dir = Path(settings.chrome_main_user_data_dir).expanduser()
    port = remote_debugging_port or settings.chrome_main_remote_debugging_port
    if _is_default_google_chrome_user_data_dir(settings.chrome_main_user_data_dir):
        payload = _chrome_default_user_data_dir_block_payload(settings, port)
        raise typer.BadParameter(f"{payload['reason']}: {payload['next_action']}")

    resolved_start_url = _resolve_start_url(positional_start_url, start_url)
    first_run = not Path(settings.chrome_main_preferences_path).expanduser().exists()
    _open_main_chrome_profile_process(settings, resolved_start_url, port)
    typer.echo(
        f"Opened Nicky automation Chrome profile at {main_user_data_dir} "
        f"({settings.chrome_main_profile_directory}) with remote debugging port {port}. "
        "Next run `social-flow verify-main-chrome-profile-control` before posting or engagement."
    )
    if first_run:
        typer.echo("First run: sign in to X, LinkedIn, and Google in this automation profile once.")


@app.command(
    "verify-main-chrome-profile-control",
    help="ローカル Nicky automation profile が Playwright CDP で実際に制御できるか確認します。",
)
def verify_main_chrome_profile_control(
    positional_start_url: Annotated[
        str | None,
        typer.Argument(help="Optional URL to probe after local automation profile control is verified."),
    ] = None,
    start_url: Annotated[
        str | None,
        typer.Option("--start-url", help="Optional URL to probe after local automation profile control is verified."),
    ] = None,
    remote_debugging_port: Annotated[
        int | None,
        typer.Option(
            "--remote-debugging-port",
            help="検査する CDP port。既定は CHROME_MAIN_REMOTE_DEBUGGING_PORT。",
        ),
    ] = None,
    open_if_missing: Annotated[
        bool,
        typer.Option(
            "--open-if-missing/--no-open-if-missing",
            help="CDP が見えない場合に open-main-chrome-profile 相当の起動を試す。",
        ),
    ] = True,
    timeout_seconds: Annotated[
        float,
        typer.Option("--timeout-seconds", help="CDP endpoint の待機秒数。"),
    ] = 8.0,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="機械処理向けに JSON で出力する。"),
    ] = False,
) -> None:
    settings = load_settings()
    port = remote_debugging_port or settings.chrome_main_remote_debugging_port
    if _is_default_google_chrome_user_data_dir(settings.chrome_main_user_data_dir):
        payload = _chrome_default_user_data_dir_block_payload(settings, port)
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
            raise typer.Exit(code=2)
        raise typer.BadParameter(f"{payload['reason']}: {payload['next_action']}")

    try:
        resolved_start_url = _resolve_start_url(positional_start_url, start_url)
    except typer.BadParameter as exc:
        if json_output:
            payload = {
                "ok": False,
                "stop_reason": "local_automation_profile_unavailable",
                "legacy_stop_reason": "local_profile2_lane_unavailable",
                "profile_label": settings.chrome_main_profile_label,
                "profile_directory": settings.chrome_main_profile_directory,
                "remote_debugging_port": port,
                "reason": "start_url_conflict",
                "error": str(exc),
            }
            typer.echo(json.dumps(payload, ensure_ascii=False))
            raise typer.Exit(code=2)
        raise

    version = _wait_for_chrome_cdp(port, timeout_seconds=1.0)
    if version is None and open_if_missing:
        _open_main_chrome_profile_process(settings, resolved_start_url, port)
        version = _wait_for_chrome_cdp(port, timeout_seconds=timeout_seconds)

    if version is None:
        payload = {
            "ok": False,
            "stop_reason": "local_automation_profile_unavailable",
            "legacy_stop_reason": "local_profile2_lane_unavailable",
            "profile_label": settings.chrome_main_profile_label,
            "profile_directory": settings.chrome_main_profile_directory,
            "remote_debugging_port": port,
            "reason": "cdp_endpoint_unavailable",
            "next_action": (
                "Close any Chrome window using this automation profile, then run "
                f"`social-flow open-main-chrome-profile --remote-debugging-port {port}` "
                "and retry `social-flow verify-main-chrome-profile-control`."
            ),
        }
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            typer.echo(
                "local_automation_profile_unavailable: CDP endpoint is unavailable at "
                f"http://127.0.0.1:{port}. {payload['next_action']}"
            )
        raise typer.Exit(code=1)

    try:
        from playwright.sync_api import sync_playwright

        _ensure_chrome_cdp_page_target(port, timeout_seconds=min(timeout_seconds, 2.0))
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            page = context.new_page()
            expected_profile_path = _expected_main_chrome_profile_path(settings)
            page.goto("chrome://version/", wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
            version_text = page.locator("body").inner_text(timeout=int(timeout_seconds * 1000))
            observed_profile_path = _observed_chrome_profile_path(version_text)
            if _normalized_profile_path(observed_profile_path) != _normalized_profile_path(expected_profile_path):
                payload = {
                    "ok": False,
                    "stop_reason": "local_automation_profile_unavailable",
                    "legacy_stop_reason": "local_profile2_lane_unavailable",
                    "profile_label": settings.chrome_main_profile_label,
                    "profile_directory": settings.chrome_main_profile_directory,
                    "remote_debugging_port": port,
                    "reason": "profile_path_mismatch",
                    "expected_profile_path": expected_profile_path,
                    "observed_profile_path": observed_profile_path,
                }
                if json_output:
                    typer.echo(json.dumps(payload, ensure_ascii=False))
                else:
                    typer.echo(
                        "local_automation_profile_unavailable: CDP endpoint is not connected to the expected "
                        f"automation profile path. expected={expected_profile_path} observed={observed_profile_path}"
                    )
                page.close()
                raise typer.Exit(code=1)
            if resolved_start_url and resolved_start_url != "about:blank":
                page.goto(resolved_start_url, wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
            title = page.title()
            current_url = page.url
            page.close()
    except typer.Exit:
        raise
    except Exception as exc:
        payload = {
            "ok": False,
            "stop_reason": "local_automation_profile_unavailable",
            "legacy_stop_reason": "local_profile2_lane_unavailable",
            "profile_label": settings.chrome_main_profile_label,
            "profile_directory": settings.chrome_main_profile_directory,
            "remote_debugging_port": port,
            "reason": "playwright_cdp_control_failed",
            "error": " ".join(str(exc).split()),
        }
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            typer.echo(
                "local_automation_profile_unavailable: Playwright could not control local automation profile via CDP. "
                f"{payload['error']}"
            )
        raise typer.Exit(code=1)

    targets = _chrome_cdp_json(port, "/json/list", timeout_seconds=1.0)
    target_count = len(targets) if isinstance(targets, list) else 0
    payload = {
        "ok": True,
        "profile_label": settings.chrome_main_profile_label,
        "profile_directory": settings.chrome_main_profile_directory,
        "remote_debugging_port": port,
        "browser": version.get("Browser", "") if isinstance(version, dict) else "",
        "target_count": target_count,
        "probe_url": current_url,
        "probe_title": title,
    }
    if json_output:
        typer.echo(json.dumps(payload, ensure_ascii=False))
    else:
        typer.echo(
            "local_automation_profile_control_ok: "
            f"{settings.chrome_main_profile_label} ({settings.chrome_main_profile_directory}) "
            f"is controllable via Playwright CDP on port {port}. targets={target_count}"
        )


@app.command(
    "preflight-linkedin-media-upload-local",
    help="LinkedIn画像投稿のPhoto/filechooser/Editor preview経路を投稿せずに検証します。",
)
def preflight_linkedin_media_upload_local(
    image_path: Annotated[
        str,
        typer.Argument(help="LinkedIn composer に添付できるか検証する画像ファイルの絶対または相対パス。"),
    ],
    remote_debugging_port: Annotated[
        int | None,
        typer.Option(
            "--remote-debugging-port",
            help="検査する CDP port。既定は CHROME_MAIN_REMOTE_DEBUGGING_PORT。",
        ),
    ] = None,
    artifact_dir: Annotated[
        str,
        typer.Option("--artifact-dir", help="診断 JSON と screenshot を保存するディレクトリ。"),
    ] = "artifacts/browser-diagnostics",
    cleanup: Annotated[
        bool,
        typer.Option("--cleanup/--keep-open", help="検証後に composer/tab を閉じて投稿前状態を片付ける。"),
    ] = True,
    timeout_seconds: Annotated[
        float,
        typer.Option("--timeout-seconds", help="LinkedIn UI / filechooser / preview の待機秒数。"),
    ] = 15.0,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="機械処理向けに JSON で出力する。"),
    ] = False,
) -> None:
    settings = load_settings()
    port = remote_debugging_port or settings.chrome_main_remote_debugging_port
    image = Path(image_path).expanduser()
    if not image.is_absolute():
        image = Path.cwd() / image
    artifact_root = Path(artifact_dir)
    artifact_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    diagnostic_path = artifact_root / f"{stamp}-linkedin-media-upload-preflight.json"
    screenshot_path = artifact_root / f"{stamp}-linkedin-media-upload-preflight.png"

    payload: dict[str, object] = {
        "ok": False,
        "posted": False,
        "platform": "linkedin",
        "route": "feed_photo_filechooser_preflight",
        "image_path": str(image),
        "remote_debugging_port": port,
        "diagnostic_path": str(diagnostic_path),
        "screenshot_path": str(screenshot_path),
        "checks": {},
        "steps": [],
    }

    def finish(*, exit_code: int = 0) -> None:
        diagnostic_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            status = "ok" if payload.get("ok") else "failed"
            typer.echo(f"LinkedIn media upload preflight {status}: {diagnostic_path}")
        if exit_code:
            raise typer.Exit(code=exit_code)

    if not image.exists():
        payload["reason"] = "image_missing"
        payload["stop_reason"] = "image_generation_unavailable"
        finish(exit_code=2)
        return

    version = _wait_for_chrome_cdp(port, timeout_seconds=1.0)
    if version is None:
        _open_main_chrome_profile_process(settings, "https://www.linkedin.com/feed/", port)
        version = _wait_for_chrome_cdp(port, timeout_seconds=timeout_seconds)
    if version is None:
        payload["reason"] = "cdp_endpoint_unavailable"
        payload["stop_reason"] = "local_automation_profile_unavailable"
        finish(exit_code=1)
        return

    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            page = context.new_page()

            def step(value: dict[str, object]) -> None:
                steps = payload.setdefault("steps", [])
                if isinstance(steps, list):
                    steps.append(value)

            _verify_main_chrome_profile_path(page, settings, timeout_seconds=timeout_seconds)
            step({"profile_path_verified": True})

            def visible_text(label: str, *, exact: bool = True, timeout_ms: int = 1000) -> bool:
                try:
                    return page.get_by_text(label, exact=exact).first.is_visible(timeout=timeout_ms)
                except Exception:
                    return False

            def close_stale_ui() -> None:
                try:
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(500)
                except Exception:
                    return
                for label in ("Discard", "破棄", "Close", "閉じる", "Dismiss"):
                    try:
                        target = page.get_by_text(label, exact=True).first
                        if target.is_visible(timeout=700):
                            target.click(timeout=1500)
                            page.wait_for_timeout(500)
                            step({"cleanup_clicked": label})
                            return
                    except Exception:
                        continue

            page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=int(timeout_seconds * 1000))
            page.wait_for_timeout(2500)
            if _linkedin_login_required(page):
                payload["reason"] = "linkedin_login_required"
                payload["stop_reason"] = "auth_blocked"
                try:
                    page.screenshot(path=str(screenshot_path), full_page=False)
                except Exception:
                    pass
                finish(exit_code=1)
                return
            close_stale_ui()
            body = page.locator("body").inner_text(timeout=5000)
            checks = payload.setdefault("checks", {})
            if isinstance(checks, dict):
                checks["expected_account_visible"] = "Nichika Tanaka" in body or "田仲二千" in body
                checks["feed_url"] = page.url
                checks["initial_file_inputs"] = page.locator("input[type=file]").count()
            if not (isinstance(checks, dict) and checks.get("expected_account_visible")):
                payload["reason"] = "expected_account_not_visible"
                payload["stop_reason"] = "wrong_or_unverified_account"
                page.screenshot(path=str(screenshot_path), full_page=False)
                finish(exit_code=1)
                return

            upload_method = ""
            upload_error = ""
            photo_selector = 'div[role="button"]:has-text("Photo"), div[role="button"]:has-text("写真")'
            photo = page.locator(photo_selector).first
            photo.wait_for(state="visible", timeout=int(timeout_seconds * 1000))
            try:
                with page.expect_file_chooser(timeout=int(timeout_seconds * 1000)) as chooser_info:
                    photo.click(timeout=8000)
                chooser_info.value.set_files(str(image))
                upload_method = "filechooser_set_files"
                step({"photo_route_clicked": True, "filechooser_set_files": True})
            except PlaywrightTimeoutError as exc:
                upload_error = f"{type(exc).__name__}: {' '.join(str(exc).split())[:300]}"
                step({"filechooser_timeout": upload_error})
                try:
                    if page.locator("input[type=file]").count() == 0:
                        photo.click(timeout=5000, force=True)
                        page.wait_for_timeout(1500)
                    inputs = page.locator("input[type=file]")
                    input_count = inputs.count()
                    if isinstance(checks, dict):
                        checks["file_inputs_after_photo_click"] = input_count
                    if input_count:
                        inputs.first.set_input_files(str(image), timeout=10000)
                        upload_method = "materialized_input_set_files"
                        step({"materialized_input_set_files": True})
                except Exception as inner_exc:
                    upload_error = f"{type(inner_exc).__name__}: {' '.join(str(inner_exc).split())[:300]}"
                    step({"materialized_input_error": upload_error})
            except Exception as exc:
                upload_error = f"{type(exc).__name__}: {' '.join(str(exc).split())[:300]}"
                step({"photo_route_error": upload_error})

            page.wait_for_timeout(6000)
            body_after = page.locator("body").inner_text(timeout=5000)
            editor_next_visible = visible_text("Next") or visible_text("次へ")
            editor_count_visible = (
                visible_text("1 of 1", exact=False)
                or visible_text("1 / 1", exact=False)
                or visible_text("1枚中1枚目", exact=False)
            )
            if isinstance(checks, dict):
                checks["upload_method"] = upload_method
                checks["upload_error"] = upload_error
                checks["editor_next_visible"] = editor_next_visible
                checks["editor_count_visible"] = editor_count_visible
                checks["body_has_editor_signal"] = any(token in body_after for token in ("Next", "次へ", "1 of 1", "1 / 1"))
                checks["final_url"] = page.url
            payload["ok"] = bool(upload_method and (editor_next_visible or editor_count_visible or checks.get("body_has_editor_signal")))
            if not payload["ok"]:
                payload["reason"] = "linkedin_photo_editor_preview_missing" if upload_method else "linkedin_photo_route_unavailable"
                payload["stop_reason"] = (
                    "surface_missing:linkedin_photo_editor_preview_missing"
                    if upload_method
                    else "media_upload_permission_blocked:linkedin_photo_route_unavailable"
                )
            page.screenshot(path=str(screenshot_path), full_page=False)
            if cleanup:
                close_stale_ui()
                try:
                    page.close()
                except Exception:
                    pass
            finish(exit_code=0 if payload["ok"] else 1)
    except typer.Exit:
        raise
    except Exception as exc:
        payload["reason"] = "playwright_cdp_control_failed"
        payload["stop_reason"] = "local_automation_profile_unavailable"
        payload["error"] = " ".join(str(exc).split())
        finish(exit_code=1)


@app.command(
    "open-video-workspace-chrome",
    help="二千 (Nicky automation) に、動画運用の論理グループごとの作業タブをまとめて開きます。",
)
def open_video_workspace_chrome() -> None:
    settings = load_settings()
    if not settings.chrome_executable_path:
        raise typer.BadParameter("CHROME_EXECUTABLE_PATH is not set.")

    main_user_data_dir = Path(settings.chrome_main_user_data_dir).expanduser()
    preferences_path = Path(settings.chrome_main_preferences_path).expanduser()
    if not preferences_path.exists():
        raise typer.BadParameter(
            f"Chrome main Preferences not found: {preferences_path}. "
            "Set CHROME_MAIN_PREFERENCES_PATH or CHROME_MAIN_PROFILE_DIRECTORY correctly."
        )

    urls = [url for _, url in _video_workspace_tab_specs(settings)]
    script = _build_open_workspace_tabs_applescript(urls)
    subprocess.run(["osascript", "-"], input=script, text=True, check=True)

    typer.echo(
        f"Opened logical workspace tabs in {settings.chrome_main_profile_label} "
        f"({settings.chrome_main_profile_directory})."
    )
    typer.echo(
        "Each header tab acts as a visual separator for one task block. "
        "If you want real Chrome tab groups, place the tabs to the right of each header into the matching group once, then keep reusing that layout."
    )


@app.command(
    "open-job-workspace-chrome",
    help="既存 real Chrome Profile 2 に、応募 automation 用の論理グループタブをまとめて開きます。",
)
def open_job_workspace_chrome() -> None:
    settings = load_settings()
    if not settings.chrome_executable_path:
        raise typer.BadParameter("CHROME_EXECUTABLE_PATH is not set.")

    urls = [url for _, url in _job_workspace_tab_specs(settings)]
    _open_profile2_chrome_tabs(settings.chrome_executable_path, urls)

    typer.echo(
        "Opened job automation logical workspace tabs in existing Google Chrome Profile 2."
    )
    typer.echo(
        "Keep job application tabs inside this block so other publish/engagement automations can keep their own tab groups."
    )


@app.command("bootstrap-sheet")
def bootstrap_sheet() -> None:
    repo = get_repo()
    repo.bootstrap_queue_sheet()
    typer.echo(
        f"Bootstrapped Google Sheet tab: {repo.tab_name}. "
        "Views ready: dashboard, queue, publish_today, engagement_review, backlog_review, "
        "published_log, run_summary, feed_read_log, learning_review, performance_daily, "
        "engagement_relationship_map."
    )


@app.command("create-sheet")
def create_sheet(title: str | None = None) -> None:
    load_dotenv()
    service_account_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not service_account_json:
        raise typer.BadParameter("GOOGLE_SERVICE_ACCOUNT_JSON is required.")
    sheet_title = title or os.getenv("GOOGLE_SHEETS_TITLE", "").strip() or "Daily AI Posting Queue"
    spreadsheet_id, spreadsheet_url = create_spreadsheet(service_account_json, sheet_title)
    typer.echo(f"Created Google Sheet: {sheet_title}")
    typer.echo(f"Spreadsheet ID: {spreadsheet_id}")
    typer.echo(f"URL: {spreadsheet_url}")
    typer.echo(
        "Set GOOGLE_SHEETS_SPREADSHEET_ID to this ID, then run `social-flow bootstrap-sheet` "
        "or use `social-flow create-and-bootstrap-sheet` next time."
    )


@app.command("create-and-bootstrap-sheet")
def create_and_bootstrap_sheet(title: str | None = None) -> None:
    load_dotenv()
    service_account_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not service_account_json:
        raise typer.BadParameter("GOOGLE_SERVICE_ACCOUNT_JSON is required.")
    sheet_title = title or os.getenv("GOOGLE_SHEETS_TITLE", "").strip() or "Daily AI Posting Queue"
    spreadsheet_id, spreadsheet_url = create_spreadsheet(service_account_json, sheet_title)
    repo = SheetsRepository(
        service_account_json=service_account_json,
        spreadsheet_id=spreadsheet_id,
        tab_name=os.getenv("GOOGLE_SHEETS_QUEUE_TAB", "queue").strip() or "queue",
    )
    repo.bootstrap_queue_sheet()
    typer.echo(f"Created and bootstrapped Google Sheet: {sheet_title}")
    typer.echo(f"Spreadsheet ID: {spreadsheet_id}")
    typer.echo(f"URL: {spreadsheet_url}")
    typer.echo(
        "Use this spreadsheet by setting "
        f"`GOOGLE_SHEETS_SPREADSHEET_ID={spreadsheet_id}` in `.env` or your automation environment."
    )


@app.command("bootstrap-local-queue")
def bootstrap_local_queue(path: str = "posting_queue.tsv") -> None:
    repo = get_local_repo(path)
    repo.bootstrap()
    typer.echo(f"Bootstrapped local queue: {repo.path}")


@app.command("collect-drive-folder-local")
def collect_drive_folder_local(
    folder_url: str,
    path: str = "posting_queue.tsv",
    source_name: str = "Google Drive",
    chrome_live: bool = True,
) -> None:
    repo = get_local_repo(path)
    repo.bootstrap()
    documents = collect_from_google_drive_folder(folder_url=folder_url, source_name=source_name)
    collection_mode = "shared_html"
    if not documents and chrome_live:
        documents = _collect_drive_documents_from_chrome_tab(folder_url=folder_url, source_name=source_name)
        if documents:
            collection_mode = "chrome_live"
    added = 0
    existing_ids = {row.id for row in repo.read_all()}
    for row in _documents_to_rows(documents):
        if row.id in existing_ids:
            continue
        repo.append(row)
        added += 1
    typer.echo(
        f"Collected {added} video item(s) from Google Drive into {repo.path.name} "
        f"(source={collection_mode})."
    )


@app.command("collect-rss")
def collect_rss(source_name: str, feed_url: str, limit: int = 10) -> None:
    repo = get_repo()
    documents = collect_from_rss(source_name=source_name, feed_url=feed_url, limit=limit)
    added = _upsert_documents(repo, _documents_to_rows(documents))
    typer.echo(f"Collected {added} new item(s) from RSS.")


@app.command("collect-url-list")
def collect_url_list(path: str, source_name: str = "manual") -> None:
    repo = get_repo()
    documents = collect_from_url_list(path=path, source_name=source_name)
    added = _upsert_documents(repo, _documents_to_rows(documents))
    typer.echo(f"Collected {added} new item(s) from URL list.")


@app.command("collect-url-list-local")
def collect_url_list_local(path: str, source_name: str = "manual", queue_path: str = "posting_queue.tsv") -> None:
    repo = get_local_repo(queue_path)
    repo.bootstrap()
    documents = collect_from_url_list(path=path, source_name=source_name)
    added = _upsert_documents(repo, _documents_to_rows(documents))
    typer.echo(f"Collected {added} new item(s) from URL list into {repo.path.name}.")


@app.command("attach-runway-generated-media-local")
def attach_runway_generated_media_local(
    row_id: Annotated[str, typer.Option("--row-id")],
    platform: Annotated[str, typer.Option("--platform")],
    image_url: Annotated[str | None, typer.Option("--image-url")] = None,
    image_path: Annotated[str | None, typer.Option("--image-path")] = None,
    path: Annotated[str, typer.Option("--path")] = "posting_queue.tsv",
    prompt: Annotated[str | None, typer.Option("--prompt")] = None,
    visual_style: Annotated[str | None, typer.Option("--visual-style")] = None,
    language: Annotated[str | None, typer.Option("--language")] = None,
    sync_sheets: Annotated[bool, typer.Option("--sync-sheets/--no-sync-sheets")] = False,
) -> None:
    repo = get_local_repo(path)
    row = repo.get(row_id)
    if row is None:
        raise typer.BadParameter(f"Queue row not found: {row_id}")
    result = _attach_runway_generated_media_to_row(
        row,
        platform=platform,
        image_url=image_url,
        image_path=image_path,
        prompt=prompt,
        visual_style=visual_style,
        language=language,
    )
    repo.update(row)
    sheets_synced = _sync_local_queue_to_sheets_bounded(path) if sync_sheets else 0
    result["sheets_synced"] = sheets_synced
    typer.echo(json.dumps(result, ensure_ascii=False, indent=2))


@app.command("attach-runway-mcp-result-local")
def attach_runway_mcp_result_local(
    row_id: Annotated[str, typer.Option("--row-id")],
    platform: Annotated[str, typer.Option("--platform")],
    mcp_result: Annotated[str, typer.Option("--mcp-result")],
    path: Annotated[str, typer.Option("--path")] = "posting_queue.tsv",
    prompt: Annotated[str | None, typer.Option("--prompt")] = None,
    visual_style: Annotated[str | None, typer.Option("--visual-style")] = None,
    language: Annotated[str | None, typer.Option("--language")] = None,
    sync_sheets: Annotated[bool, typer.Option("--sync-sheets/--no-sync-sheets")] = False,
) -> None:
    repo = get_local_repo(path)
    row = repo.get(row_id)
    if row is None:
        raise typer.BadParameter(f"Queue row not found: {row_id}")
    result = _attach_runway_mcp_result_to_row(
        row,
        platform=platform,
        mcp_result_path=mcp_result,
        prompt=prompt,
        visual_style=visual_style,
        language=language,
    )
    repo.update(row)
    sheets_synced = _sync_local_queue_to_sheets_bounded(path) if sync_sheets else 0
    result["sheets_synced"] = sheets_synced
    typer.echo(json.dumps(result, ensure_ascii=False, indent=2))


@app.command("collect-sources")
def collect_sources() -> None:
    settings = load_settings()
    repo = get_repo()
    documents = _collect_documents_from_sources(settings)
    added = _upsert_documents(repo, _documents_to_rows(documents))
    typer.echo(f"Collected {added} new item(s) from configured sources.")


@app.command("collect-sources-local")
def collect_sources_local(path: str = "posting_queue.tsv") -> None:
    settings = load_settings()
    repo = get_local_repo(path)
    repo.bootstrap()
    documents = _collect_documents_from_sources(settings)
    added = _upsert_documents(repo, _documents_to_rows(documents))
    typer.echo(f"Collected {added} new item(s) into {repo.path.name}.")


@app.command("draft")
def draft(item_id: str | None = None, force: bool = False) -> None:
    settings = load_settings()
    repo = get_repo()
    drafted = _draft_queue_rows(repo, settings, item_id=item_id, force=force)
    typer.echo(f"Drafted {drafted} item(s).")


@app.command("draft-local")
def draft_local(
    item_id: str | None = None,
    path: str = "posting_queue.tsv",
    force: bool = False,
    max_items: int | None = None,
) -> None:
    settings = load_settings()
    repo = get_local_repo(path)
    repo.bootstrap()
    drafted = _draft_queue_rows(repo, settings, item_id=item_id, force=force, max_items=max_items)
    typer.echo(f"Drafted {drafted} item(s) in {repo.path.name}.")


@app.command("draft-videos-local")
def draft_videos_local(item_id: str | None = None, path: str = "posting_queue.tsv", force: bool = False) -> None:
    settings = load_settings()
    if not settings.gemini_api_key:
        raise typer.BadParameter("GEMINI_API_KEY is required.")
    repo = get_local_repo(path)
    rows = repo.read_all()
    targets = [row for row in rows if row.id == item_id] if item_id else rows
    drafted = 0
    for row in targets:
        if row.source_type != "google_drive":
            continue
        if row.status not in {"collected", "failed"} and not force:
            continue
        try:
            result = generate_video_social_copy(
                api_key=settings.gemini_api_key,
                model=settings.gemini_model,
                row=row,
            )
            row.content_summary = result["content_summary"].strip()
            row.summary_ja = result["content_summary"].strip()
            row.hook_candidates = result["hook_candidates"].strip()
            row.key_points = result["key_points"].strip()
            row.cta_suggestion = result["cta_suggestion"].strip()
            row.recommended_platforms = result["recommended_platforms"].strip()
            row.hashtag_candidates = result["hashtag_candidates"].strip()
            row.thumbnail_text_idea = result["thumbnail_text_idea"].strip()
            row.media_plan = result["media_plan"].strip()
            row.best_platform = result["best_platform"].strip()
            row.best_hook = result["best_hook"].strip()
            row.best_caption_variant = result["best_platform"].strip()
            row.tiktok_caption = result["tiktok_caption"].strip()
            row.tiktok_hashtags = result["tiktok_hashtags"].strip()
            row.instagram_caption = result["instagram_caption"].strip()
            row.instagram_hashtags = result["instagram_hashtags"].strip()
            row.youtube_title = result["youtube_title"].strip()
            row.youtube_description = result["youtube_description"].strip()
            row.youtube_hashtags = result["youtube_hashtags"].strip()
            row.facebook_caption = result["facebook_caption"].strip()
            row.facebook_hashtags = result["facebook_hashtags"].strip()
            row.gemini_analysis_status = "done"
            row.gemini_model = settings.gemini_model
            row.gemini_analyzed_at = utc_now()
            row.status = "drafted"
            row.drafted_at = utc_now()
            row.error = ""
            repo.update(row)
            drafted += 1
        except Exception as exc:
            row.status = "failed"
            row.gemini_analysis_status = "failed"
            row.error = str(exc)
            repo.update(row)
    typer.echo(f"Drafted {drafted} video item(s) in {repo.path.name}.")


@app.command("qa-browser-video")
def qa_browser_video(
    video_path: str,
    expected_steps: Annotated[list[str], typer.Option("--expected-step")] = [],
    anomaly_rules: Annotated[list[str], typer.Option("--anomaly-rule")] = [],
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds")] = 300,
    json_output: Annotated[bool, typer.Option("--json")] = False,
    pretty: Annotated[bool, typer.Option("--pretty")] = False,
) -> None:
    gemini_api_key, gemini_model = _load_video_qa_gemini_settings()
    if not gemini_api_key:
        raise typer.BadParameter("GEMINI_API_KEY is required.")
    try:
        result = analyze_browser_automation_video(
            api_key=gemini_api_key,
            model=gemini_model,
            video_path=video_path,
            expected_steps=expected_steps,
            anomaly_rules=anomaly_rules,
            timeout_seconds=timeout_seconds,
        )
    except Exception as exc:
        typer.echo(f"Gemini video QA failed: {_redact_gemini_api_key(str(exc), gemini_api_key)}", err=True)
        raise typer.Exit(code=1) from exc
    if pretty:
        typer.echo(json.dumps(result, ensure_ascii=False, indent=2))
    elif json_output:
        typer.echo(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    else:
        typer.echo(json.dumps(result, ensure_ascii=False, indent=2))


VIDEO_QA_SMOKE_EXPECTED_STEPS = [
    "Open the local inert fixture",
    "Observe the initial waiting state before the harmless click",
    "Click the harmless check button",
    "Observe the completed smoke-check state",
]

VIDEO_QA_SMOKE_ANOMALY_RULES = [
    "No external navigation or network destination is opened",
    "No post, send, publish, submit, purchase, or application action occurs",
    "The page remains on a local file fixture for the whole run",
]

VIDEO_QA_NO_POST_EXPECTED_STEPS = [
    "Connect to the isolated Daily AI Chrome profile over CDP",
    "Open a read-only browser surface without composing, uploading, posting, sending, publishing, or submitting",
    "Capture before and after screenshots, URL/title metadata, short DOM text, network JSONL, and a short Playwright video",
]

VIDEO_QA_NO_POST_ANOMALY_RULES = [
    "No Post, Send, Publish, Submit, Save, Upload, Download, Purchase, Apply, or final confirmation control is clicked",
    "No file chooser is opened and no file is uploaded",
    "No composer is submitted and posted/sent/published flags remain false",
    "If login, checkpoint, profile mismatch, or CDP unavailability is observed, the run blocks before any irreversible action",
]

JOB_VIDEO_QA_EXPECTED_STEPS = [
    "Open only the intended official company or official ATS job page",
    "Verify the visible company, role, URL, page title, and form surface before any mutation",
    "Fill only safe known facts and role-specific factual material",
    "Verify resume or document upload reflection before any submit action",
    "Stop before CAPTCHA, OTP, security-code, login, identity, assessment, AI interview, or missing completion proof blockers",
    "After any authorized submit action, capture visible completion proof or exact blocker",
    "Leave source-of-truth sync/readback and cleanup proof in artifacts",
]

JOB_VIDEO_QA_ANOMALY_RULES = [
    "Wrong company, wrong role, wrong account, or non-official target surface appears",
    "CAPTCHA, OTP, security-code, login, identity, assessment, coding test, language test, or AI interview appears",
    "Submit is clicked without visible file upload reflection and final readback",
    "Remote/full-remote preference text is typed into a free-text application field",
    "A completion claim is made without visible completion page, application receipt, or source-of-truth readback evidence",
    "Another automation tab, profile, or workflow surface is used as if it belonged to this job run",
]

JOB_VIDEO_QA_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov"}


def _load_video_qa_gemini_settings() -> tuple[str, str]:
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    model = (
        os.getenv("GEMINI_MODEL", "").strip()
        or os.getenv("GEMINI_MODEL_NAME", "").strip()
        or VIDEO_QA_DEFAULT_GEMINI_MODEL
    )
    return api_key, model


def _redact_sensitive_text(message: str, api_key: str | None = None) -> str:
    redacted = str(message)
    candidates = {
        api_key or "",
        os.getenv("GEMINI_API_KEY", "").strip(),
        os.getenv("OPENAI_API_KEY", "").strip(),
        os.getenv("GOOGLE_API_KEY", "").strip(),
    }
    for candidate in candidates:
        if candidate:
            redacted = redacted.replace(candidate, REDACTED_SECRET)
    redacted = re.sub(
        r"(?i)(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;\"'}]+",
        rf"\1{REDACTED_AUTH}",
        redacted,
    )
    redacted = re.sub(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+", REDACTED_AUTH, redacted)
    redacted = re.sub(
        r"\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b",
        REDACTED_SECRET,
        redacted,
    )
    redacted = re.sub(
        r"(?i)([?&](?:access_token|refresh_token|id_token|auth_token|token|api_key|apikey|key|password|passwd|pwd|secret)=)[^&#\s]+",
        rf"\1{REDACTED_QUERY_VALUE}",
        redacted,
    )
    redacted = re.sub(
        r"(?i)(?<![?&])\b(api[_-]?key|x-api-key|password|passwd|pwd|token|secret)\b\s*[:=]\s*[^\s,;\"'}]+",
        rf"\1={REDACTED_SECRET}",
        redacted,
    )
    redacted = re.sub(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", REDACTED_EMAIL, redacted)
    return redacted


def _redacted_text_tail(message: str, *, api_key: str | None = None, max_chars: int = 4000) -> str:
    redacted = _redact_sensitive_text(message, api_key=api_key)
    if len(redacted) <= max_chars:
        return redacted
    head_chars = max_chars // 2
    tail_chars = max_chars - head_chars
    return redacted[:head_chars] + "\n...[truncated]...\n" + redacted[-tail_chars:]


def _echo_job_manager_output(message: str, *, err: bool = False) -> None:
    try:
        typer.echo(message, err=err)
    except BrokenPipeError:
        return
    except OSError as exc:
        if exc.errno == errno.EPIPE:
            return
        raise


def _redact_sensitive_data(value: Any, api_key: str | None = None) -> Any:
    if isinstance(value, dict):
        redacted: dict[Any, Any] = {}
        for key, item in value.items():
            key_text = str(key).lower()
            if "email" in key_text:
                redacted[key] = REDACTED_EMAIL
            elif "authorization" in key_text or "bearer" in key_text:
                redacted[key] = REDACTED_AUTH
            elif any(part in key_text for part in SECRET_KEY_PARTS):
                redacted[key] = REDACTED_SECRET
            else:
                redacted[key] = _redact_sensitive_data(item, api_key=api_key)
        return redacted
    if isinstance(value, list):
        return [_redact_sensitive_data(item, api_key=api_key) for item in value]
    if isinstance(value, tuple):
        return tuple(_redact_sensitive_data(item, api_key=api_key) for item in value)
    if isinstance(value, str):
        return _redact_sensitive_text(value, api_key=api_key)
    return value


def _redact_gemini_api_key(message: str, api_key: str | None = None) -> str:
    return _redact_sensitive_text(message, api_key=api_key).replace(REDACTED_SECRET, "[REDACTED_GEMINI_API_KEY]")


def _path_to_artifact_uri(path: Path) -> str:
    try:
        return path.resolve().as_uri()
    except ValueError:
        return str(path)


def _validate_video_qa_safe_id(value: str, *, label: str) -> str:
    if not value or value in {".", ".."} or not VIDEO_QA_STAGE_ID_RE.fullmatch(value):
        raise typer.BadParameter(f"{label} must match [A-Za-z0-9_.-]+.")
    return value


def _validate_video_qa_attempt_no(value: int) -> int:
    if value < 1:
        raise typer.BadParameter("attempt_no must be >= 1.")
    return value


def _video_qa_smoke_url_allowed(url: str) -> bool:
    scheme = urlparse(url).scheme.lower()
    return scheme in VIDEO_QA_SMOKE_ALLOWED_URL_SCHEMES


def _assert_video_qa_smoke_url_allowed(url: str, *, label: str) -> None:
    if not _video_qa_smoke_url_allowed(url):
        raise RuntimeError(f"Unsafe smoke fixture {label}: {url}")


def _assert_video_qa_smoke_page_on_fixture(page_url: str, fixture_url: str, *, label: str) -> None:
    if not _video_qa_smoke_url_allowed(page_url):
        raise RuntimeError(f"Unsafe smoke fixture navigation {label}: {page_url}")
    if page_url != fixture_url:
        raise RuntimeError(f"Unsafe smoke fixture navigation {label}: {page_url}")


def _browser_video_qa_detected_anomaly(qa_result: dict) -> bool:
    if not isinstance(qa_result, dict) or "anomalies" not in qa_result:
        return True
    anomalies = qa_result.get("anomalies")
    if not isinstance(anomalies, list):
        return True
    for anomaly in anomalies:
        if not isinstance(anomaly, dict):
            return True
        if anomaly.get("detected") is not False:
            return True
    return False


def _video_qa_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _video_qa_smoke_exact_blocker(manifest: dict[str, object]) -> str:
    if manifest.get("safe") is True:
        return ""
    qa = manifest.get("qa", {})
    if not isinstance(qa, dict):
        return "browser_video_qa_smoke_failed:qa_missing"
    error = str(qa.get("error") or "").strip()
    if error:
        return _redacted_text_tail(f"browser_video_qa_smoke_failed:{error}")
    recommendation_status = str(qa.get("recommendation_status") or "").strip() or "unknown"
    anomaly_detected = bool(qa.get("anomaly_detected"))
    return _redact_sensitive_text(
        f"browser_video_qa_smoke_failed:recommendation_status={recommendation_status};anomaly_detected={anomaly_detected}"
    )


def _browser_video_qa_no_post_exact_blocker(manifest: dict[str, object]) -> str:
    if manifest.get("safe") is True:
        return ""
    blocker = str(manifest.get("exact_blocker") or "").strip()
    if blocker:
        return _redacted_text_tail(blocker)
    qa = manifest.get("qa", {})
    if not isinstance(qa, dict):
        return "browser_video_qa_no_post_preflight_failed:qa_missing"
    error = str(qa.get("error") or "").strip()
    if error:
        return _redacted_text_tail(f"browser_video_qa_no_post_preflight_failed:{error}")
    recommendation_status = str(qa.get("recommendation_status") or "").strip() or "unknown"
    anomaly_detected = bool(qa.get("anomaly_detected"))
    return _redact_sensitive_text(
        "browser_video_qa_no_post_preflight_failed:"
        f"recommendation_status={recommendation_status};anomaly_detected={anomaly_detected}"
    )


def _video_qa_smoke_empty_surface(label: str, fixture_path: Path | None = None) -> dict[str, object]:
    return {
        "label": label,
        "url": "",
        "title": "",
        "dom_text": "",
        "screenshot_path": "",
        "screenshot_exists": False,
        "fixture_path": str(fixture_path) if fixture_path else "",
        "fixture_exists": bool(fixture_path and fixture_path.exists()),
        "page_on_fixture": False,
    }


def _browser_video_qa_empty_surface(label: str) -> dict[str, object]:
    return {
        "label": label,
        "url": "",
        "title": "",
        "dom_text": "",
        "screenshot_path": "",
        "screenshot_exists": False,
        "login_required": False,
    }


def _browser_video_qa_surface_state(page: Any, screenshot_path: Path, *, label: str) -> dict[str, object]:
    url = str(getattr(page, "url", "") or "")
    title = ""
    title_func = getattr(page, "title", None)
    if callable(title_func):
        try:
            title = str(title_func())
        except Exception:
            title = ""
    dom_text = ""
    try:
        locator = page.locator("body")
        inner_text = getattr(locator, "inner_text", None)
        if callable(inner_text):
            dom_text = str(inner_text(timeout=1500))
    except Exception:
        dom_text = ""
    if not dom_text:
        text_content = getattr(page, "text_content", None)
        if callable(text_content):
            try:
                dom_text = str(text_content("body", timeout=1500) or "")
            except Exception:
                dom_text = ""
    dom_text = dom_text.strip()[:2000]
    screenshot_func = getattr(page, "screenshot", None)
    if callable(screenshot_func):
        screenshot_path.parent.mkdir(parents=True, exist_ok=True)
        screenshot_func(path=str(screenshot_path), full_page=True)
    login_required = bool(
        re.search(r"(?i)\b(sign in|log in|welcome back|checkpoint|ログイン|サインイン)\b", f"{url}\n{title}\n{dom_text}")
    )
    return _redact_sensitive_data(
        {
            "label": label,
            "url": url,
            "title": title,
            "dom_text": dom_text,
            "screenshot_path": str(screenshot_path),
            "screenshot_exists": screenshot_path.exists(),
            "login_required": login_required,
        }
    )


def _video_qa_smoke_surface_state(page: Any, fixture_path: Path, screenshot_path: Path, *, label: str) -> dict[str, object]:
    url = str(getattr(page, "url", "") or "")
    title = ""
    title_func = getattr(page, "title", None)
    if callable(title_func):
        try:
            title = str(title_func())
        except Exception:
            title = ""
    dom_text = ""
    try:
        locator = page.locator("body")
        inner_text = getattr(locator, "inner_text", None)
        if callable(inner_text):
            dom_text = str(inner_text(timeout=1000))
    except Exception:
        dom_text = ""
    if not dom_text:
        text_content = getattr(page, "text_content", None)
        if callable(text_content):
            try:
                dom_text = str(text_content("body", timeout=1000) or "")
            except Exception:
                dom_text = ""
    screenshot_func = getattr(page, "screenshot", None)
    if callable(screenshot_func):
        screenshot_path.parent.mkdir(parents=True, exist_ok=True)
        screenshot_func(path=str(screenshot_path), full_page=True)
    fixture_url = fixture_path.resolve().as_uri()
    return _redact_sensitive_data(
        {
            "label": label,
            "url": url,
            "title": title,
            "dom_text": dom_text,
            "screenshot_path": str(screenshot_path),
            "screenshot_exists": screenshot_path.exists(),
            "fixture_path": str(fixture_path),
            "fixture_exists": fixture_path.exists(),
            "page_on_fixture": url == fixture_url,
        }
    )


def _write_video_qa_network_jsonl(path: Path, events: list[dict[str, object]]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        for event in events:
            file.write(json.dumps(_redact_sensitive_data(event), ensure_ascii=False, separators=(",", ":")) + "\n")
    return path


def _browser_video_qa_no_post_recording_payload(recording_result: Any, run_dir: Path) -> dict[str, object]:
    if isinstance(recording_result, dict):
        payload = dict(recording_result)
        video_path = payload.get("video_path") or payload.get("path")
        payload["video_path"] = str(video_path or "")
        payload.setdefault("before", _browser_video_qa_empty_surface("before"))
        payload.setdefault("after", _browser_video_qa_empty_surface("after"))
        network_jsonl = Path(str(payload.get("network_jsonl") or run_dir / "network.jsonl"))
        if not network_jsonl.exists():
            _write_video_qa_network_jsonl(network_jsonl, [])
        payload["network_jsonl"] = str(network_jsonl)
        return _redact_sensitive_data(payload)
    video_path = Path(recording_result)
    network_jsonl = run_dir / "network.jsonl"
    if not network_jsonl.exists():
        _write_video_qa_network_jsonl(network_jsonl, [])
    return _redact_sensitive_data(
        {
            "video_path": str(video_path),
            "before": _browser_video_qa_empty_surface("before"),
            "after": _browser_video_qa_empty_surface("after"),
            "network_jsonl": str(network_jsonl),
        }
    )


def _video_qa_smoke_recording_payload(recording_result: Any, run_dir: Path, fixture_path: Path) -> dict[str, object]:
    if isinstance(recording_result, dict):
        payload = dict(recording_result)
        video_path = payload.get("video_path") or payload.get("path")
        payload["video_path"] = str(video_path or "")
        payload.setdefault("before", _video_qa_smoke_empty_surface("pre-click", fixture_path))
        payload.setdefault("after", _video_qa_smoke_empty_surface("post-click", fixture_path))
        network_jsonl = Path(str(payload.get("network_jsonl") or run_dir / "network.jsonl"))
        if not network_jsonl.exists():
            _write_video_qa_network_jsonl(network_jsonl, [])
        payload["network_jsonl"] = str(network_jsonl)
        return _redact_sensitive_data(payload)
    video_path = Path(recording_result)
    network_jsonl = run_dir / "network.jsonl"
    if not network_jsonl.exists():
        _write_video_qa_network_jsonl(network_jsonl, [])
    return _redact_sensitive_data(
        {
            "video_path": str(video_path),
            "before": _video_qa_smoke_empty_surface("pre-click", fixture_path),
            "after": _video_qa_smoke_empty_surface("post-click", fixture_path),
            "network_jsonl": str(network_jsonl),
        }
    )


def _write_browser_video_qa_no_post_stage_observation(
    *,
    manifest: dict[str, object],
    manifest_path: Path,
    workflow: str,
    stage: str,
    attempt_no: int,
    started_at: str,
    finished_at: str,
    elapsed_ms: int,
) -> Path:
    manifest = _redact_sensitive_data(manifest)
    run_id = _validate_video_qa_safe_id(str(manifest.get("run_id") or ""), label="run_id")
    workflow = _validate_video_qa_safe_id(workflow, label="workflow")
    stage = _validate_video_qa_safe_id(stage, label="stage")
    attempt_no = _validate_video_qa_attempt_no(attempt_no)
    stage_dir = Path("artifacts/playwright-cli-runs") / run_id / "stage-observations" / stage / f"attempt-{attempt_no}"
    stage_dir.mkdir(parents=True, exist_ok=True)
    qa = manifest.get("qa", {})
    qa_payload = qa if isinstance(qa, dict) else {}
    exact_blocker = _browser_video_qa_no_post_exact_blocker(manifest)
    recommendation_status = str(qa_payload.get("recommendation_status") or "")
    anomaly_detected = bool(qa_payload.get("anomaly_detected"))
    completion_gate_matches = manifest.get("safe") is True and recommendation_status == "pass" and not anomaly_detected
    network_source = Path(str(manifest.get("network_jsonl") or ""))
    network_path = stage_dir / "network.jsonl"
    if network_source.exists() and network_source.is_file():
        shutil.copyfile(network_source, network_path)
    else:
        _write_video_qa_network_jsonl(network_path, [])
    before = manifest.get("before")
    after = manifest.get("after")
    summary = _redact_sensitive_data({
        "schema": "automation_stage_observation.v1",
        "workflow": workflow,
        "run_id": run_id,
        "stage": stage,
        "attempt_no": attempt_no,
        "started_at": started_at,
        "finished_at": finished_at,
        "elapsed_ms": elapsed_ms,
        "status": "succeeded" if manifest.get("safe") is True else "blocked",
        "exact_blocker": exact_blocker,
        "artifact_uri": str(stage_dir.resolve()),
        "before": before if isinstance(before, dict) else _browser_video_qa_empty_surface("before"),
        "after": after if isinstance(after, dict) else _browser_video_qa_empty_surface("after"),
        "network_jsonl": str(network_path),
        "stdout_tail": _redact_sensitive_text(f"Browser video QA no-post artifacts: {manifest_path.parent}"),
        "stderr_tail": "" if manifest.get("safe") is True else _redacted_text_tail(
            f"Browser video QA no-post blocked: {exact_blocker}"
        ),
        "repair_loop_suppressed": bool(manifest.get("repair_loop_suppressed", False)),
        "safe": manifest.get("safe") is True,
        "posted": False,
        "sent": False,
        "published": False,
        "no_post": True,
        "allow_post_requested": bool(manifest.get("allow_post_requested", False)),
        "cdp_port": int(manifest.get("cdp_port") or 0),
        "video_path": str(manifest.get("video_path") or ""),
        "manifest_path": str(manifest_path),
        "qa_path": str(qa_payload.get("path") or ""),
        "provider": "gemini_video_qa",
        "auditor": "gemini_video_qa",
        "verdict": "pass" if completion_gate_matches else "blocked",
        "completion_gate_alignment": "matches" if completion_gate_matches else "mismatch",
        "completion_gate_matches": completion_gate_matches,
        "recommendation_status": recommendation_status,
        "anomaly_detected": anomaly_detected,
        "repair_owner": "daily-ai-research-publish-run",
        "video_artifact_uri": str(manifest.get("video_path") or ""),
        "auxiliary_proof": True,
        "completion_veto_only": True,
        "does_not_replace_source_of_truth": True,
        "expected_steps": manifest.get("expected_steps") or [],
        "anomaly_rules": manifest.get("anomaly_rules") or [],
    })
    summary_path = stage_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary_path


def _write_video_qa_smoke_stage_observation(
    *,
    manifest: dict[str, object],
    manifest_path: Path,
    workflow: str,
    stage: str,
    attempt_no: int,
    started_at: str,
    finished_at: str,
    elapsed_ms: int,
) -> Path:
    manifest = _redact_sensitive_data(manifest)
    run_id = _validate_video_qa_safe_id(str(manifest.get("run_id") or ""), label="run_id")
    workflow = _validate_video_qa_safe_id(workflow, label="workflow")
    stage = _validate_video_qa_safe_id(stage, label="stage")
    attempt_no = _validate_video_qa_attempt_no(attempt_no)
    stage_dir = Path("artifacts/playwright-cli-runs") / run_id / "stage-observations" / stage / f"attempt-{attempt_no}"
    stage_dir.mkdir(parents=True, exist_ok=True)
    qa = manifest.get("qa", {})
    qa_payload = qa if isinstance(qa, dict) else {}
    exact_blocker = _video_qa_smoke_exact_blocker(manifest)
    network_source = Path(str(manifest.get("network_jsonl") or ""))
    network_path = stage_dir / "network.jsonl"
    if network_source.exists() and network_source.is_file():
        shutil.copyfile(network_source, network_path)
    else:
        _write_video_qa_network_jsonl(network_path, [])
    before = manifest.get("before")
    after = manifest.get("after")
    summary = _redact_sensitive_data({
        "schema": "automation_stage_observation.v1",
        "workflow": workflow,
        "run_id": run_id,
        "stage": stage,
        "attempt_no": attempt_no,
        "started_at": started_at,
        "finished_at": finished_at,
        "elapsed_ms": elapsed_ms,
        "status": "succeeded" if manifest.get("safe") is True else "blocked",
        "exact_blocker": exact_blocker,
        "artifact_uri": str(stage_dir.resolve()),
        "before": before if isinstance(before, dict) else _video_qa_smoke_empty_surface("pre-click"),
        "after": after if isinstance(after, dict) else _video_qa_smoke_empty_surface("post-click"),
        "network_jsonl": str(network_path),
        "stdout_tail": _redact_sensitive_text(f"Video QA smoke artifacts: {manifest_path.parent}"),
        "stderr_tail": "" if manifest.get("safe") is True else _redacted_text_tail(f"Video QA smoke failed: {exact_blocker}"),
        "repair_loop_suppressed": False,
        "safe": manifest.get("safe") is True,
        "posted": False,
        "sent": False,
        "published": False,
        "fixture_path": str(manifest.get("fixture_path") or ""),
        "video_path": str(manifest.get("video_path") or ""),
        "manifest_path": str(manifest_path),
        "qa_path": str(qa_payload.get("path") or ""),
        "recommendation_status": str(qa_payload.get("recommendation_status") or ""),
        "anomaly_detected": bool(qa_payload.get("anomaly_detected")),
        "expected_steps": manifest.get("expected_steps") or [],
        "anomaly_rules": manifest.get("anomaly_rules") or [],
    })
    summary_path = stage_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary_path


def _write_video_qa_smoke_manifest(run_dir: Path, manifest: dict[str, object]) -> Path:
    manifest_path = run_dir / "manifest.json"
    manifest_path.write_text(json.dumps(_redact_sensitive_data(manifest), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest_path


def _write_browser_video_qa_no_post_manifest(run_dir: Path, manifest: dict[str, object]) -> Path:
    manifest_path = run_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(_redact_sensitive_data(manifest), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest_path


def _job_video_qa_run_dir(run_id: str, artifact_root: Path) -> Path:
    direct = artifact_root / run_id
    if direct.exists():
        return direct
    matches = [path for path in artifact_root.glob(f"*{run_id}*") if path.is_dir()]
    if matches:
        return max(matches, key=lambda path: path.stat().st_mtime)
    return direct


def _collect_job_video_qa_videos(run_dir: Path, explicit_video_paths: list[str], *, include_discovered: bool = True) -> list[Path]:
    videos: list[Path] = []
    for raw_path in explicit_video_paths:
        path = Path(raw_path).expanduser()
        if path.exists() and path.is_file() and path.suffix.lower() in JOB_VIDEO_QA_VIDEO_EXTENSIONS:
            videos.append(path)
    if include_discovered and run_dir.exists():
        videos.extend(
            path
            for path in run_dir.rglob("*")
            if path.is_file() and path.suffix.lower() in JOB_VIDEO_QA_VIDEO_EXTENSIONS
        )
    seen: set[str] = set()
    unique: list[Path] = []
    for video in videos:
        key = str(video.resolve())
        if key in seen:
            continue
        seen.add(key)
        unique.append(video)
    return sorted(unique, key=lambda path: str(path))


def _job_video_qa_output_path(run_id: str, summary_path: str | None) -> Path:
    requested = (summary_path or os.getenv("AUTOMATION_OS_REGISTERED_SUMMARY_PATH", "")).strip()
    if requested:
        return Path(requested).expanduser()
    return Path("artifacts/run-summaries") / f"{run_id}-registered-video-qa-sidecar.json"


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _job_video_qa_redaction_receipt_items(receipt: dict[str, object]) -> list[dict[str, object]]:
    items = receipt.get("redacted_videos")
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    return [receipt]


def _validate_job_video_qa_redaction_receipt(receipt_path: Path, videos: list[Path]) -> dict[str, object]:
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if not isinstance(receipt, dict):
        raise ValueError("redaction_receipt_not_object")
    items = _job_video_qa_redaction_receipt_items(receipt)
    if not items:
        raise ValueError("redaction_receipt_has_no_videos")
    by_path: dict[str, dict[str, object]] = {}
    for item in items:
        raw_path = (
            item.get("redacted_video_path")
            or item.get("video_path")
            or item.get("path")
        )
        if not raw_path:
            continue
        by_path[str(Path(str(raw_path)).expanduser().resolve())] = item
    for video in videos:
        key = str(video.resolve())
        item = by_path.get(key)
        if not item:
            raise ValueError(f"redaction_receipt_missing_video:{video}")
        status = str(item.get("redaction_status") or receipt.get("redaction_status") or "").strip().lower()
        if status not in {"redacted", "pii_redacted"}:
            raise ValueError(f"redaction_receipt_status_not_redacted:{video}")
        allowed = item.get("allowed_external_analysis", receipt.get("allowed_external_analysis"))
        if allowed is not True:
            raise ValueError(f"redaction_receipt_external_analysis_not_allowed:{video}")
        expected_hash = str(item.get("sha256") or item.get("redacted_video_sha256") or "").strip().lower()
        if not expected_hash:
            raise ValueError(f"redaction_receipt_missing_sha256:{video}")
        actual_hash = _file_sha256(video)
        if actual_hash.lower() != expected_hash:
            raise ValueError(f"redaction_receipt_sha256_mismatch:{video}")
    return {
        "path": str(receipt_path),
        "artifact_uri": _path_to_artifact_uri(receipt_path),
        "video_count": len(videos),
        "receipt_video_count": len(items),
        "status": "validated",
    }


def _job_video_qa_status_from_result(qa_result: dict[str, Any]) -> tuple[str, str, bool, str]:
    recommendation = qa_result.get("recommendation", {})
    recommendation_status = ""
    summary = ""
    if isinstance(recommendation, dict):
        recommendation_status = str(recommendation.get("status") or "").strip().lower()
        summary = str(recommendation.get("summary") or "").strip()
    anomaly_detected = _browser_video_qa_detected_anomaly(qa_result)
    if recommendation_status == "pass" and not anomaly_detected:
        return "passed", "matches", anomaly_detected, summary
    return "blocked", "mismatch", anomaly_detected, summary


def _write_job_video_qa_sidecar_payload(
    *,
    output_path: Path,
    payload: dict[str, object],
) -> Path:
    existing: dict[str, object] = {}
    if output_path.exists():
        try:
            loaded = json.loads(output_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                existing = loaded
        except Exception as exc:
            existing = {"existing_summary_parse_error": _redacted_text_tail(str(exc))}
    existing_audits = existing.get("stage_visual_audits")
    new_audits = payload.get("stage_visual_audits")
    merged = {**existing, **payload}
    if isinstance(existing_audits, list) and isinstance(new_audits, list):
        merged["stage_visual_audits"] = [*existing_audits, *new_audits]
        merged["gemini_video_qa"] = {"audits": merged["stage_visual_audits"]}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(_redact_sensitive_data(merged), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return output_path


def _job_video_qa_blocked_audit(
    *,
    stage: str,
    exact_blocker: str,
    artifact_uri: str,
    video_artifact_uri: str = "",
    repair_owner: str = "job-application-manager",
    summary: str = "",
) -> dict[str, object]:
    return {
        "provider": "gemini_video_qa",
        "auditor": "gemini_video_qa",
        "stage": stage,
        "status": "blocked",
        "verdict": "blocked",
        "completion_gate_alignment": "mismatch",
        "completion_gate_matches": False,
        "exact_blocker": exact_blocker,
        "repair_owner": repair_owner,
        "artifact_uri": artifact_uri,
        "video_artifact_uri": video_artifact_uri,
        "summary": summary or exact_blocker,
        "auxiliary_proof": True,
        "allowed_external_analysis": False,
        "redaction_status": "blocked",
    }


@app.command("write-job-registered-video-qa-sidecar")
def write_job_registered_video_qa_sidecar(
    run_id: Annotated[str, typer.Option("--run-id")],
    workflow: Annotated[str, typer.Option("--workflow")] = "job-applications",
    stage: Annotated[str, typer.Option("--stage")] = "job_registered_video_qa",
    artifact_root: Annotated[str, typer.Option("--artifact-root")] = "artifacts/job-playwright-cli-runs",
    summary_path: Annotated[str | None, typer.Option("--summary-path")] = None,
    video_path: Annotated[list[str], typer.Option("--video-path")] = [],
    redaction_receipt_path: Annotated[str | None, typer.Option("--redaction-receipt-path")] = None,
    allowed_external_analysis: Annotated[bool, typer.Option("--allowed-external-analysis/--no-external-analysis")] = False,
    redaction_status: Annotated[str, typer.Option("--redaction-status")] = "unknown",
    skip_gemini: Annotated[bool, typer.Option("--skip-gemini")] = False,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds")] = 300,
) -> None:
    actual_run_id = _validate_video_qa_safe_id(run_id, label="run_id")
    workflow = _validate_video_qa_safe_id(workflow, label="workflow")
    stage = _validate_video_qa_safe_id(stage, label="stage")
    root = Path(artifact_root).expanduser()
    run_dir = _job_video_qa_run_dir(actual_run_id, root)
    output_path = _job_video_qa_output_path(actual_run_id, summary_path)
    qa_dir = Path("artifacts/job-video-qa") / actual_run_id
    qa_dir.mkdir(parents=True, exist_ok=True)
    explicit_videos = _collect_job_video_qa_videos(run_dir, video_path, include_discovered=False)
    discovered_videos = _collect_job_video_qa_videos(run_dir, [], include_discovered=True)
    all_videos = _collect_job_video_qa_videos(run_dir, [str(video) for video in explicit_videos], include_discovered=True)
    generated_at = _video_qa_utc_now()
    base_payload: dict[str, object] = {
        "schema": "automation_os_registered_summary.v1",
        "workflow": workflow,
        "run_id": actual_run_id,
        "generated_at": generated_at,
        "source": "social-flow job registered video QA sidecar",
        "artifact_root": str(root),
        "run_artifact_dir": str(run_dir),
        "run_artifact_uri": _path_to_artifact_uri(run_dir),
        "allowed_external_analysis": allowed_external_analysis,
        "redaction_status": redaction_status,
        "video_count": len(all_videos),
        "explicit_video_count": len(explicit_videos),
        "discovered_video_count": len(discovered_videos),
        "redaction_receipt": {},
        "stage_visual_audits": [],
    }

    def write_blocked(exact_blocker: str, *, summary: str = "") -> None:
        payload = dict(base_payload)
        payload["stage_visual_audits"] = [
            _job_video_qa_blocked_audit(
                stage=stage,
                exact_blocker=exact_blocker,
                artifact_uri=_path_to_artifact_uri(run_dir),
                summary=summary,
            )
        ]
        written = _write_job_video_qa_sidecar_payload(output_path=output_path, payload=payload)
        typer.echo(f"Job registered video QA sidecar: {written}")

    if not all_videos:
        write_blocked("job_video_qa_no_video_artifact", summary="No Playwright video artifact was available for Gemini review.")
        raise typer.Exit(code=1)

    if not explicit_videos:
        write_blocked(
            "job_video_qa_explicit_redacted_video_required",
            summary="A redacted job video must be passed with --video-path before Gemini analysis is allowed.",
        )
        raise typer.Exit(code=1)

    if not allowed_external_analysis or redaction_status.strip().lower() not in {"redacted", "pii_redacted"}:
        write_blocked(
            "job_video_qa_external_analysis_not_allowed",
            summary="Gemini upload was blocked because allowed_external_analysis and redaction_status=redacted were not both present.",
        )
        raise typer.Exit(code=1)

    if not redaction_receipt_path:
        write_blocked(
            "job_video_qa_redaction_receipt_required",
            summary="A redaction receipt with matching video sha256 is required before Gemini analysis.",
        )
        raise typer.Exit(code=1)
    try:
        redaction_receipt = _validate_job_video_qa_redaction_receipt(Path(redaction_receipt_path).expanduser(), explicit_videos)
        base_payload["redaction_receipt"] = redaction_receipt
    except Exception as exc:
        write_blocked(
            _redacted_text_tail(f"job_video_qa_redaction_receipt_invalid:{exc}"),
            summary="The redaction receipt did not validate against the explicit video path(s).",
        )
        raise typer.Exit(code=1)

    gemini_api_key, gemini_model = _load_video_qa_gemini_settings()
    if not skip_gemini and not gemini_api_key:
        write_blocked("job_video_qa_gemini_api_key_missing", summary="GEMINI_API_KEY is required for job video QA.")
        raise typer.Exit(code=1)

    audits: list[dict[str, object]] = []
    for index, video in enumerate(explicit_videos, start=1):
        audit_stage = f"{stage}_{index}"
        qa_path = qa_dir / f"{audit_stage}-gemini-video-qa.json"
        if skip_gemini:
            audit = _job_video_qa_blocked_audit(
                stage=audit_stage,
                exact_blocker="job_video_qa_gemini_skipped",
                artifact_uri=_path_to_artifact_uri(run_dir),
                video_artifact_uri=_path_to_artifact_uri(video),
                summary="Gemini video QA was skipped by explicit flag.",
            )
            audit["allowed_external_analysis"] = allowed_external_analysis
            audit["redaction_status"] = redaction_status
            audits.append(audit)
            continue
        try:
            qa_result = analyze_browser_automation_video(
                api_key=gemini_api_key,
                model=gemini_model,
                video_path=video,
                expected_steps=JOB_VIDEO_QA_EXPECTED_STEPS,
                anomaly_rules=JOB_VIDEO_QA_ANOMALY_RULES,
                timeout_seconds=timeout_seconds,
            )
            qa_path.write_text(
                json.dumps(_redact_sensitive_data(qa_result, api_key=gemini_api_key), ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            status, alignment, anomaly_detected, qa_summary = _job_video_qa_status_from_result(qa_result)
            recommendation = qa_result.get("recommendation", {})
            recommendation_status = str(recommendation.get("status") if isinstance(recommendation, dict) else "").strip()
            audits.append(
                {
                    "provider": "gemini_video_qa",
                    "auditor": "gemini_video_qa",
                    "model": gemini_model,
                    "stage": audit_stage,
                    "status": status,
                    "verdict": status,
                    "completion_gate_alignment": alignment,
                    "completion_gate_matches": status == "passed",
                    "exact_blocker": "" if status == "passed" else f"job_video_qa_failed:{recommendation_status or 'unknown'}",
                    "repair_owner": "job-application-manager",
                    "artifact_uri": _path_to_artifact_uri(qa_path),
                    "video_artifact_uri": _path_to_artifact_uri(video),
                    "summary": qa_summary,
                    "recommendation_status": recommendation_status,
                    "anomaly_detected": anomaly_detected,
                    "auxiliary_proof": True,
                    "allowed_external_analysis": allowed_external_analysis,
                    "redaction_status": redaction_status,
                }
            )
        except Exception as exc:
            audits.append(
                _job_video_qa_blocked_audit(
                    stage=audit_stage,
                    exact_blocker=_redacted_text_tail(f"job_video_qa_gemini_failed:{exc}", api_key=gemini_api_key),
                    artifact_uri=_path_to_artifact_uri(run_dir),
                    video_artifact_uri=_path_to_artifact_uri(video),
                    summary="Gemini video QA failed while analyzing the job automation recording.",
                )
            )

    payload = dict(base_payload)
    payload["stage_visual_audits"] = audits
    payload["gemini_video_qa"] = {"audits": audits}
    written = _write_job_video_qa_sidecar_payload(output_path=output_path, payload=payload)
    typer.echo(f"Job registered video QA sidecar: {written}")
    if any(str(audit.get("status") or "").lower() == "blocked" for audit in audits):
        raise typer.Exit(code=1)


def _video_qa_smoke_run_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{uuid.uuid4().hex[:8]}"


def _write_video_qa_smoke_fixture(run_dir: Path) -> Path:
    fixture_path = run_dir / "fixture.html"
    fixture_path.write_text(
        """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Video QA Smoke Fixture</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 48px; color: #17202a; }
    main { max-width: 720px; }
    button { font: inherit; padding: 10px 14px; }
    .status {
      margin-top: 20px;
      padding: 18px;
      border: 3px solid #9aa6b2;
      background: #f5f7fa;
      font-size: 28px;
      font-weight: 800;
    }
    .step { margin-top: 16px; font-size: 20px; font-weight: 700; }
    .recording {
      margin-top: 12px;
      font-size: 18px;
      font-weight: 700;
      color: #31465a;
    }
    body[data-smoke-complete="true"] .status {
      border-color: #16803c;
      background: #e7f8ed;
      color: #075e2a;
    }
  </style>
</head>
<body>
  <main>
    <h1>Video QA Smoke Fixture</h1>
    <p id="safety">Local inert fixture only. No external navigation. No post/send/publish/submit action.</p>
    <p class="step" id="step">Step 1 of 2: initial waiting state before the harmless click</p>
    <p class="recording" id="recording">Recording pre-click initial state</p>
    <button id="check" type="button">Run harmless check</button>
    <p class="status" id="status">INITIAL STATE: waiting for harmless check</p>
  </main>
  <script>
    document.getElementById("check").addEventListener("click", () => {
      document.body.dataset.smokeComplete = "true";
      document.getElementById("step").textContent = "Step 2 of 2: completed state after the harmless click";
      document.getElementById("recording").textContent = "Recording post-click completed state";
      document.getElementById("status").textContent = "COMPLETED STATE: smoke check complete";
      document.getElementById("check").textContent = "Harmless check completed";
    });
  </script>
</body>
</html>
""",
        encoding="utf-8",
    )
    return fixture_path


def _record_video_qa_smoke_fixture(fixture_path: Path, run_dir: Path) -> dict[str, object]:
    from playwright.sync_api import sync_playwright

    video_dir = run_dir / "playwright-video"
    video_dir.mkdir(parents=True, exist_ok=True)
    fixture_url = fixture_path.resolve().as_uri()
    unsafe_events: list[str] = []
    network_events: list[dict[str, object]] = []
    network_jsonl_path = run_dir / "network.jsonl"
    before_state = _video_qa_smoke_empty_surface("pre-click", fixture_path)
    after_state = _video_qa_smoke_empty_surface("post-click", fixture_path)

    def record_network_event(kind: str, url: str, **extra: object) -> None:
        network_events.append(
            _redact_sensitive_data(
                {
                    "ts": _video_qa_utc_now(),
                    "kind": kind,
                    "url": url,
                    "allowed": _video_qa_smoke_url_allowed(url) if url else False,
                    **extra,
                }
            )
        )

    def record_unsafe_url(url: str, label: str) -> None:
        record_network_event(label, url)
        if url and not _video_qa_smoke_url_allowed(url):
            unsafe_events.append(f"{label}: {url}")

    def assert_no_unsafe_events(label: str) -> None:
        if unsafe_events:
            raise RuntimeError(f"Unsafe smoke fixture {label}: {'; '.join(unsafe_events)}")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = None
        context_closed = False
        try:
            context = browser.new_context(record_video_dir=str(video_dir), viewport={"width": 1280, "height": 720})
            page = context.new_page()

            def guard_route(route) -> None:
                url = getattr(getattr(route, "request", None), "url", "")
                method = getattr(getattr(route, "request", None), "method", "")
                record_network_event("route", url, method=method)
                if not _video_qa_smoke_url_allowed(url):
                    unsafe_events.append(f"request: {url}")
                    route.abort()
                    return
                route.continue_()

            def guard_request(request) -> None:
                record_network_event("request", getattr(request, "url", ""), method=getattr(request, "method", ""))
                record_unsafe_url(getattr(request, "url", ""), "request")

            def guard_response(response) -> None:
                request = getattr(response, "request", None)
                record_network_event(
                    "response",
                    getattr(response, "url", ""),
                    status=getattr(response, "status", ""),
                    method=getattr(request, "method", "") if request else "",
                )

            def guard_navigation(frame) -> None:
                record_unsafe_url(getattr(frame, "url", ""), "navigation")

            if hasattr(context, "route"):
                context.route("**/*", guard_route)
            if hasattr(page, "on"):
                page.on("request", guard_request)
                page.on("response", guard_response)
                page.on("framenavigated", guard_navigation)

            page.goto(fixture_url, wait_until="domcontentloaded")
            assert_no_unsafe_events("after opening local fixture")
            _assert_video_qa_smoke_page_on_fixture(page.url, fixture_url, label="after opening local fixture")
            page.locator("#safety").wait_for(state="visible", timeout=5000)
            page.locator("#status", has_text="INITIAL STATE").wait_for(state="visible", timeout=5000)
            page.locator("#recording", has_text="pre-click initial state").wait_for(state="visible", timeout=5000)
            before_state = _video_qa_smoke_surface_state(
                page,
                fixture_path,
                run_dir / "pre-click.png",
                label="pre-click",
            )
            page.wait_for_timeout(3000)
            page.locator("#check").click(timeout=5000)
            assert_no_unsafe_events("after harmless click")
            _assert_video_qa_smoke_page_on_fixture(page.url, fixture_url, label="after harmless click")
            page.locator("#status", has_text="COMPLETED STATE").wait_for(state="visible", timeout=5000)
            page.locator("#recording", has_text="post-click completed state").wait_for(state="visible", timeout=5000)
            after_state = _video_qa_smoke_surface_state(
                page,
                fixture_path,
                run_dir / "post-click.png",
                label="post-click",
            )
            page.wait_for_timeout(3000)
            video = page.video
            context.close()
            context_closed = True
            if video is None:
                raise RuntimeError("Playwright did not produce a video for the smoke fixture.")
            recorded_path = Path(video.path())
        finally:
            if context is not None and not context_closed:
                context.close()
            browser.close()
            _write_video_qa_network_jsonl(network_jsonl_path, network_events)

    final_path = run_dir / f"video-qa-smoke{recorded_path.suffix or '.webm'}"
    shutil.copyfile(recorded_path, final_path)
    return {
        "video_path": str(final_path),
        "before": before_state,
        "after": after_state,
        "network_jsonl": str(network_jsonl_path),
    }


def _assert_daily_ai_video_qa_cdp_profile(cdp_port: int) -> dict[str, object]:
    expected_profile_dir = os.getenv("DAILY_AI_CLI_PROFILE_DIR", "").strip() or VIDEO_QA_NO_POST_EXPECTED_PROFILE_DIR
    result = subprocess.run(
        ["ps", "axww", "-o", "pid=,command="],
        cwd=Path.cwd(),
        encoding="utf-8",
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"profile_check_failed:{_redacted_text_tail(result.stderr)}")
    lines = [line.strip() for line in str(result.stdout or "").splitlines() if f"--remote-debugging-port={cdp_port}" in line]
    matching = [line for line in lines if f"--user-data-dir={expected_profile_dir}" in line]
    if not matching:
        raise RuntimeError(
            "profile_mismatch:"
            f" expected_profile={expected_profile_dir}; cdp_port={cdp_port}; "
            f"port_processes={_redact_sensitive_data(lines[:3])}"
        )
    return {"ok": True, "expected_profile": expected_profile_dir, "cdp_port": cdp_port}


def _record_browser_video_qa_no_post_preflight(
    *,
    run_dir: Path,
    cdp_port: int,
    timeout_seconds: float,
) -> dict[str, object]:
    from playwright.sync_api import sync_playwright

    profile_gate = _assert_daily_ai_video_qa_cdp_profile(cdp_port)
    timeout_ms = max(1000, int(timeout_seconds * 1000))
    cdp_url = f"http://127.0.0.1:{cdp_port}"
    video_dir = run_dir / "playwright-video"
    video_dir.mkdir(parents=True, exist_ok=True)
    network_events: list[dict[str, object]] = []
    network_jsonl_path = run_dir / "network.jsonl"
    before_state = _browser_video_qa_empty_surface("before")
    after_state = _browser_video_qa_empty_surface("after")
    recorded_path: Path | None = None

    def record_network_event(kind: str, url: str, **extra: object) -> None:
        network_events.append(
            _redact_sensitive_data(
                {
                    "ts": _video_qa_utc_now(),
                    "kind": kind,
                    "url": url,
                    **extra,
                }
            )
        )

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(cdp_url, timeout=min(timeout_ms, 30_000))
        record_context = None
        context_closed = False
        try:
            if not browser.contexts:
                raise RuntimeError("cdp_unavailable:no_browser_contexts")
            base_context = browser.contexts[0]
            try:
                storage_state = base_context.storage_state()
            except Exception:
                storage_state = None
            new_context = getattr(browser, "new_context", None)
            if not callable(new_context):
                raise RuntimeError("playwright_video_unavailable:cdp_browser_new_context_missing")
            context_kwargs: dict[str, object] = {
                "record_video_dir": str(video_dir),
                "viewport": {"width": 1280, "height": 720},
            }
            if storage_state:
                context_kwargs["storage_state"] = storage_state
            record_context = new_context(**context_kwargs)
            page = record_context.new_page()

            def guard_request(request) -> None:
                record_network_event("request", getattr(request, "url", ""), method=getattr(request, "method", ""))

            def guard_response(response) -> None:
                request = getattr(response, "request", None)
                record_network_event(
                    "response",
                    getattr(response, "url", ""),
                    status=getattr(response, "status", ""),
                    method=getattr(request, "method", "") if request else "",
                )

            if hasattr(page, "on"):
                page.on("request", guard_request)
                page.on("response", guard_response)

            page.goto(VIDEO_QA_NO_POST_DEFAULT_SURFACE_URL, wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_timeout(1500)
            before_state = _browser_video_qa_surface_state(page, run_dir / "before.png", label="before")
            page.wait_for_timeout(1500)
            after_state = _browser_video_qa_surface_state(page, run_dir / "after.png", label="after")
            if bool(before_state.get("login_required")) or bool(after_state.get("login_required")):
                raise RuntimeError("auth_blocked: login required in isolated Daily AI Chrome plugin profile")
            video = page.video
            record_context.close()
            context_closed = True
            if video is None:
                raise RuntimeError("playwright_video_unavailable:recorded_page_video_missing")
            recorded_path = Path(video.path())
        finally:
            if record_context is not None and not context_closed:
                record_context.close()
            _write_video_qa_network_jsonl(network_jsonl_path, network_events)

    final_path = run_dir / f"browser-video-qa-no-post-preflight{recorded_path.suffix if recorded_path else '.webm'}"
    if recorded_path is None or not recorded_path.exists():
        raise RuntimeError("playwright_video_unavailable:recorded_video_path_missing")
    shutil.copyfile(recorded_path, final_path)
    return {
        "video_path": str(final_path),
        "before": before_state,
        "after": after_state,
        "network_jsonl": str(network_jsonl_path),
        "profile_gate": profile_gate,
    }


@app.command("preflight-browser-video-qa-no-post", hidden=True)
@app.command("browser-video-qa-no-post-preflight")
@app.command("daily-ai-browser-video-qa-preflight")
def browser_video_qa_no_post_preflight(
    run_id: Annotated[str, typer.Option("--run-id")],
    workflow: Annotated[str, typer.Option("--workflow")] = "daily-ai",
    stage: Annotated[str, typer.Option("--stage")] = "browser_video_qa_no_post_preflight",
    attempt_no: Annotated[int, typer.Option("--attempt-no")] = 1,
    cdp_port: Annotated[int, typer.Option("--cdp-port")] = 9333,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds")] = 60,
    skip_gemini: Annotated[bool, typer.Option("--skip-gemini")] = False,
    stage_observation: Annotated[bool, typer.Option("--stage-observation")] = False,
    allow_post: Annotated[bool, typer.Option("--allow-post/--no-post")] = False,
) -> None:
    started_at = _video_qa_utc_now()
    started_time = time.monotonic()
    actual_run_id = _validate_video_qa_safe_id(run_id, label="run_id")
    workflow = _validate_video_qa_safe_id(workflow, label="workflow")
    stage = _validate_video_qa_safe_id(stage, label="stage")
    attempt_no = _validate_video_qa_attempt_no(attempt_no)
    run_dir = Path("artifacts/browser-video-qa-no-post-preflight") / actual_run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {
        "run_id": actual_run_id,
        "workflow": workflow,
        "stage": stage,
        "attempt_no": attempt_no,
        "safe": False,
        "posted": False,
        "sent": False,
        "published": False,
        "no_post": True,
        "allow_post_requested": bool(allow_post),
        "irreversible_actions_blocked": True,
        "cdp_port": cdp_port,
        "video_path": "",
        "before": _browser_video_qa_empty_surface("before"),
        "after": _browser_video_qa_empty_surface("after"),
        "network_jsonl": str(run_dir / "network.jsonl"),
        "expected_steps": VIDEO_QA_NO_POST_EXPECTED_STEPS,
        "anomaly_rules": VIDEO_QA_NO_POST_ANOMALY_RULES,
        "qa": {"skipped": skip_gemini},
        "exact_blocker": "",
        "repair_loop_suppressed": False,
    }

    def persist_stage_observation() -> Path | None:
        manifest_path = _write_browser_video_qa_no_post_manifest(run_dir, manifest)
        if not stage_observation:
            return None
        finished_at = _video_qa_utc_now()
        elapsed_ms = int((time.monotonic() - started_time) * 1000)
        return _write_browser_video_qa_no_post_stage_observation(
            manifest=manifest,
            manifest_path=manifest_path,
            workflow=workflow,
            stage=stage,
            attempt_no=attempt_no,
            started_at=started_at,
            finished_at=finished_at,
            elapsed_ms=elapsed_ms,
        )

    try:
        recording = _browser_video_qa_no_post_recording_payload(
            _record_browser_video_qa_no_post_preflight(
                run_dir=run_dir,
                cdp_port=cdp_port,
                timeout_seconds=timeout_seconds,
            ),
            run_dir,
        )
        manifest["video_path"] = str(recording.get("video_path") or "")
        manifest["before"] = recording.get("before") or _browser_video_qa_empty_surface("before")
        manifest["after"] = recording.get("after") or _browser_video_qa_empty_surface("after")
        manifest["network_jsonl"] = str(recording.get("network_jsonl") or run_dir / "network.jsonl")
        manifest["profile_gate"] = recording.get("profile_gate") or {}
        manifest["safe"] = bool(manifest["video_path"]) and Path(str(manifest["video_path"])).exists()

        if skip_gemini:
            manifest["qa"] = {"skipped": True}
        else:
            gemini_api_key, gemini_model = _load_video_qa_gemini_settings()
            if not gemini_api_key:
                manifest["safe"] = False
                manifest["qa"] = {
                    "skipped": False,
                    "model": gemini_model,
                    "error": "GEMINI_API_KEY is required unless --skip-gemini is set.",
                }
            else:
                try:
                    qa_result = analyze_browser_automation_video(
                        api_key=gemini_api_key,
                        model=gemini_model,
                        video_path=Path(str(manifest["video_path"])),
                        expected_steps=VIDEO_QA_NO_POST_EXPECTED_STEPS,
                        anomaly_rules=VIDEO_QA_NO_POST_ANOMALY_RULES,
                        timeout_seconds=timeout_seconds,
                    )
                    qa_path = run_dir / "gemini-video-qa.json"
                    qa_path.write_text(
                        json.dumps(_redact_sensitive_data(qa_result, api_key=gemini_api_key), ensure_ascii=False, indent=2)
                        + "\n",
                        encoding="utf-8",
                    )
                    recommendation_status = str(qa_result.get("recommendation", {}).get("status", ""))
                    anomaly_detected = _browser_video_qa_detected_anomaly(qa_result)
                    manifest["safe"] = bool(manifest["safe"]) and recommendation_status == "pass" and not anomaly_detected
                    manifest["qa"] = {
                        "skipped": False,
                        "model": gemini_model,
                        "path": str(qa_path),
                        "recommendation_status": recommendation_status,
                        "anomaly_detected": anomaly_detected,
                    }
                except Exception as exc:
                    manifest["safe"] = False
                    manifest["qa"] = {
                        "skipped": False,
                        "model": gemini_model,
                        "error": _redact_gemini_api_key(str(exc), gemini_api_key),
                    }
    except Exception as exc:
        manifest["safe"] = False
        manifest["exact_blocker"] = _redacted_text_tail(str(exc))
        manifest["qa"] = {"skipped": skip_gemini, "error": manifest["exact_blocker"]}
        stage_observation_path = persist_stage_observation()
        if stage_observation_path is not None:
            typer.echo(_redact_sensitive_text(f"Browser video QA no-post stage observation: {stage_observation_path}"))
        typer.echo(_redact_sensitive_text(f"Browser video QA no-post artifacts: {run_dir}"))
        typer.echo(
            _redacted_text_tail(
                f"Browser video QA no-post blocked: {_browser_video_qa_no_post_exact_blocker(manifest)}"
            ),
            err=True,
        )
        raise typer.Exit(code=1) from exc

    manifest_path = _write_browser_video_qa_no_post_manifest(run_dir, manifest)
    if stage_observation:
        finished_at = _video_qa_utc_now()
        elapsed_ms = int((time.monotonic() - started_time) * 1000)
        stage_observation_path = _write_browser_video_qa_no_post_stage_observation(
            manifest=manifest,
            manifest_path=manifest_path,
            workflow=workflow,
            stage=stage,
            attempt_no=attempt_no,
            started_at=started_at,
            finished_at=finished_at,
            elapsed_ms=elapsed_ms,
        )
        typer.echo(_redact_sensitive_text(f"Browser video QA no-post stage observation: {stage_observation_path}"))
    typer.echo(_redact_sensitive_text(f"Browser video QA no-post artifacts: {run_dir}"))
    if not manifest["safe"]:
        typer.echo(
            _redacted_text_tail(
                f"Browser video QA no-post blocked: {_browser_video_qa_no_post_exact_blocker(manifest)}"
            ),
            err=True,
        )
        raise typer.Exit(code=1)


@app.command("video-qa-smoke", hidden=True)
@app.command("smoke-browser-video-qa")
def video_qa_smoke(
    run_id: Annotated[str | None, typer.Option("--run-id")] = None,
    skip_gemini: Annotated[bool, typer.Option("--skip-gemini")] = False,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds")] = 300,
    stage_observation: Annotated[bool, typer.Option("--stage-observation")] = False,
    workflow: Annotated[str, typer.Option("--workflow")] = "daily-ai",
    stage: Annotated[str, typer.Option("--stage")] = "browser_video_qa_smoke",
    attempt_no: Annotated[int, typer.Option("--attempt-no")] = 1,
) -> None:
    started_at = _video_qa_utc_now()
    started_time = time.monotonic()
    actual_run_id = _validate_video_qa_safe_id(run_id or _video_qa_smoke_run_id(), label="run_id")
    workflow = _validate_video_qa_safe_id(workflow, label="workflow")
    stage = _validate_video_qa_safe_id(stage, label="stage")
    attempt_no = _validate_video_qa_attempt_no(attempt_no)
    run_dir = Path("artifacts/video-qa-smoke") / actual_run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "run_id": actual_run_id,
        "safe": False,
        "posted": False,
        "sent": False,
        "published": False,
        "fixture_path": "",
        "video_path": "",
        "before": _video_qa_smoke_empty_surface("pre-click"),
        "after": _video_qa_smoke_empty_surface("post-click"),
        "network_jsonl": str(run_dir / "network.jsonl"),
        "expected_steps": VIDEO_QA_SMOKE_EXPECTED_STEPS,
        "anomaly_rules": VIDEO_QA_SMOKE_ANOMALY_RULES,
        "qa": {
            "skipped": skip_gemini,
        },
    }

    def persist_stage_observation() -> Path | None:
        manifest_path = _write_video_qa_smoke_manifest(run_dir, manifest)
        if not stage_observation:
            return None
        finished_at = _video_qa_utc_now()
        elapsed_ms = int((time.monotonic() - started_time) * 1000)
        return _write_video_qa_smoke_stage_observation(
            manifest=manifest,
            manifest_path=manifest_path,
            workflow=workflow,
            stage=stage,
            attempt_no=attempt_no,
            started_at=started_at,
            finished_at=finished_at,
            elapsed_ms=elapsed_ms,
        )

    try:
        fixture_path = _write_video_qa_smoke_fixture(run_dir)
        manifest["fixture_path"] = str(fixture_path)
        recording = _video_qa_smoke_recording_payload(
            _record_video_qa_smoke_fixture(fixture_path, run_dir),
            run_dir,
            fixture_path,
        )
        manifest["video_path"] = str(recording.get("video_path") or "")
        manifest["before"] = recording.get("before") or _video_qa_smoke_empty_surface("pre-click", fixture_path)
        manifest["after"] = recording.get("after") or _video_qa_smoke_empty_surface("post-click", fixture_path)
        manifest["network_jsonl"] = str(recording.get("network_jsonl") or run_dir / "network.jsonl")
        manifest["safe"] = True

        if skip_gemini:
            manifest["qa"] = {"skipped": True}
        else:
            gemini_api_key, gemini_model = _load_video_qa_gemini_settings()
            if not gemini_api_key:
                manifest["safe"] = False
                manifest["qa"] = {
                    "skipped": False,
                    "model": gemini_model,
                    "error": "GEMINI_API_KEY is required unless --skip-gemini is set.",
                }
            else:
                try:
                    qa_result = analyze_browser_automation_video(
                        api_key=gemini_api_key,
                        model=gemini_model,
                        video_path=Path(str(manifest["video_path"])),
                        expected_steps=VIDEO_QA_SMOKE_EXPECTED_STEPS,
                        anomaly_rules=VIDEO_QA_SMOKE_ANOMALY_RULES,
                        timeout_seconds=timeout_seconds,
                    )
                    qa_path = run_dir / "gemini-video-qa.json"
                    qa_path.write_text(
                        json.dumps(_redact_sensitive_data(qa_result, api_key=gemini_api_key), ensure_ascii=False, indent=2)
                        + "\n",
                        encoding="utf-8",
                    )
                    recommendation_status = str(qa_result.get("recommendation", {}).get("status", ""))
                    anomaly_detected = _browser_video_qa_detected_anomaly(qa_result)
                    manifest["safe"] = recommendation_status == "pass" and not anomaly_detected
                    manifest["qa"] = {
                        "skipped": False,
                        "model": gemini_model,
                        "path": str(qa_path),
                        "recommendation_status": recommendation_status,
                        "anomaly_detected": anomaly_detected,
                    }
                except Exception as exc:
                    manifest["safe"] = False
                    manifest["qa"] = {
                        "skipped": False,
                        "model": gemini_model,
                        "error": _redact_gemini_api_key(str(exc), gemini_api_key),
                    }
    except Exception as exc:
        if not stage_observation:
            raise
        manifest["safe"] = False
        manifest["qa"] = {
            "skipped": skip_gemini,
            "error": _redacted_text_tail(str(exc)),
        }
        stage_observation_path = persist_stage_observation()
        if stage_observation_path is not None:
            typer.echo(_redact_sensitive_text(f"Video QA stage observation: {stage_observation_path}"))
        typer.echo(_redact_sensitive_text(f"Video QA smoke artifacts: {run_dir}"))
        typer.echo(_redacted_text_tail(f"Video QA smoke failed: {_video_qa_smoke_exact_blocker(manifest)}"), err=True)
        raise typer.Exit(code=1) from exc

    manifest_path = _write_video_qa_smoke_manifest(run_dir, manifest)
    if stage_observation:
        finished_at = _video_qa_utc_now()
        elapsed_ms = int((time.monotonic() - started_time) * 1000)
        stage_observation_path = _write_video_qa_smoke_stage_observation(
            manifest=manifest,
            manifest_path=manifest_path,
            workflow=workflow,
            stage=stage,
            attempt_no=attempt_no,
            started_at=started_at,
            finished_at=finished_at,
            elapsed_ms=elapsed_ms,
        )
        typer.echo(_redact_sensitive_text(f"Video QA stage observation: {stage_observation_path}"))
    typer.echo(_redact_sensitive_text(f"Video QA smoke artifacts: {run_dir}"))
    if not manifest["safe"]:
        qa = manifest.get("qa", {})
        if isinstance(qa, dict) and qa.get("error"):
            typer.echo(_redacted_text_tail(f"Video QA smoke failed: {qa['error']}"), err=True)
        else:
            typer.echo(
                _redact_sensitive_text(
                    "Video QA smoke failed: "
                    f"recommendation_status={qa.get('recommendation_status', '')}; "
                    f"anomaly_detected={qa.get('anomaly_detected', False)}"
                ),
                err=True,
            )
        raise typer.Exit(code=1)


@app.command(
    "publish-videos-chrome-local",
    help="二千 (Nicky automation) で、対象動画の投稿用タブを開き、媒体別入力内容をまとめて表示します。",
)
def publish_videos_chrome_local(
    item_id: str,
    path: str = "posting_queue.tsv",
    dry_run: bool = False,
) -> None:
    settings = load_settings()
    repo = get_local_repo(path)
    row = _get_row_or_raise(repo, item_id)

    if row.source_type != "google_drive":
        raise typer.BadParameter(f"{item_id} is not a Google Drive video row.")
    if row.status not in {"approved", "scheduled", "partially_published", "drafted"}:
        raise typer.BadParameter(f"{item_id} is not ready to publish. Current status: {row.status}")

    pending_platforms = _pending_video_platforms(row)
    if not pending_platforms:
        typer.echo(f"All enabled video platforms already have post URLs or IDs for {item_id}.")
        return

    brief = _video_publish_brief(row)
    typer.echo(brief)

    if dry_run:
        typer.echo("Dry run only. No Chrome tabs were opened.")
        return

    preferences_path = Path(settings.chrome_main_preferences_path).expanduser()
    if not preferences_path.exists():
        raise typer.BadParameter(
            f"Chrome main Preferences not found: {preferences_path}. "
            "Set CHROME_MAIN_PREFERENCES_PATH or CHROME_MAIN_PROFILE_DIRECTORY correctly."
        )

    tab_specs = _video_publish_tab_plan(row)
    header_name = f"{settings.chrome_task_group_prefix}: publish {item_id}"
    urls = [
        _group_header_tab_url(header_name, "Use the tabs to the right of this header for this single video publish task."),
        *[url for _, url in tab_specs],
    ]
    script = _build_open_workspace_tabs_applescript(urls)
    subprocess.run(["osascript", "-"], input=script, text=True, check=True)

    row.next_action = f"Publish in Chrome for: {', '.join(pending_platforms)}"
    repo.update(row)
    typer.echo(
        f"Opened publish tabs for {item_id} in {settings.chrome_main_profile_label} "
        f"({settings.chrome_main_profile_directory})."
    )


@app.command(
    "write-video-publish-packet-local",
    help="動画投稿用の caption/title/hashtag 一式を Markdown ファイルに書き出します。",
)
def write_video_publish_packet_local(
    item_id: str,
    path: str = "posting_queue.tsv",
    output_dir: str = "artifacts/publish-packets",
) -> None:
    repo = get_local_repo(path)
    row = _get_row_or_raise(repo, item_id)
    if row.source_type != "google_drive":
        raise typer.BadParameter(f"{item_id} is not a Google Drive video row.")

    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    output_path = target_dir / f"{item_id}.md"
    output_path.write_text(_render_video_publish_packet(row), encoding="utf-8")
    typer.echo(f"Wrote publish packet: {output_path}")


@app.command(
    "mark-video-platform-published-local",
    help="手動投稿後に、媒体別の URL / ID を queue に戻します。",
)
def mark_video_platform_published_local(
    item_id: str,
    platform: str,
    post_url: str = "",
    post_id: str = "",
    path: str = "posting_queue.tsv",
) -> None:
    normalized_platform = platform.strip().lower()
    if normalized_platform not in {"tiktok", "instagram", "youtube", "facebook"}:
        raise typer.BadParameter("platform must be one of: tiktok, instagram, youtube, facebook")

    repo = get_local_repo(path)
    row = _get_row_or_raise(repo, item_id)

    if post_url:
        setattr(row, _video_platform_url_field(normalized_platform), post_url.strip())
    if post_id:
        setattr(row, _video_platform_id_field(normalized_platform), post_id.strip())
    setattr(row, _video_platform_published_at_field(normalized_platform), utc_now())
    setattr(row, _video_platform_status_field(normalized_platform), "posted")
    row.error = ""
    _refresh_video_publish_status(row)
    repo.update(row)
    typer.echo(f"Marked {normalized_platform} as published for {item_id}.")


@app.command(
    "prefill-video-platform-local",
    help="二千 (Nicky automation) の投稿タブへ、指定媒体の文面を best-effort で流し込みます。",
)
def prefill_video_platform_local(
    item_id: str,
    platform: str,
    path: str = "posting_queue.tsv",
) -> None:
    normalized_platform = platform.strip().lower()
    if normalized_platform not in {"tiktok", "instagram", "youtube", "facebook"}:
        raise typer.BadParameter("platform must be one of: tiktok, instagram, youtube, facebook")

    settings = load_settings()
    preferences_path = Path(settings.chrome_main_preferences_path).expanduser()
    if not preferences_path.exists():
        raise typer.BadParameter(
            f"Chrome main Preferences not found: {preferences_path}. "
            "Set CHROME_MAIN_PREFERENCES_PATH or CHROME_MAIN_PROFILE_DIRECTORY correctly."
        )

    repo = get_local_repo(path)
    row = _get_row_or_raise(repo, item_id)
    if row.source_type != "google_drive":
        raise typer.BadParameter(f"{item_id} is not a Google Drive video row.")

    result = _run_front_chrome_javascript(_build_platform_prefill_javascript(normalized_platform, row))
    if not result.get("ok"):
        reason = result.get("reason", "field_not_found")
        row.error = f"{normalized_platform} prefill failed: {reason}"
        repo.update(row)
        raise typer.Exit(code=1)

    setattr(row, _video_platform_status_field(normalized_platform), "pending")
    row.next_action = f"Review and submit {normalized_platform} post in Chrome"
    row.error = ""
    repo.update(row)
    typer.echo(
        f"Prefilled {normalized_platform} fields for {item_id} on the front Chrome tab. "
        f"titleFilled={result.get('titleFilled', False)} bodyFilled={result.get('bodyFilled', False)}"
    )


@app.command("approve")
def approve(item_id: str) -> None:
    repo = get_repo()
    row = _get_row_or_raise(repo, item_id)
    row.status = "approved"
    row.keep_priority = "ship_now"
    row.review_status = "ready_morning"
    row.drop_reason = ""
    row.approved_at = utc_now()
    row.error = ""
    repo.update(row)
    typer.echo(f"Approved {item_id}.")


@app.command("approve-local")
def approve_local(item_id: str, path: str = "posting_queue.tsv") -> None:
    repo = get_local_repo(path)
    row = _get_row_or_raise(repo, item_id)
    row.status = "approved"
    row.keep_priority = "ship_now"
    row.review_status = "ready_morning"
    row.drop_reason = ""
    row.approved_at = utc_now()
    row.error = ""
    repo.update(row)
    typer.echo(f"Approved {item_id} in {repo.path.name}.")


@app.command("schedule")
def schedule(item_id: str, publish_at: str) -> None:
    repo = get_repo()
    row = _get_row_or_raise(repo, item_id)
    scheduled_at = _parse_iso_datetime(publish_at)
    row.status = "scheduled"
    row.scheduled_at = scheduled_at.replace(microsecond=0).isoformat()
    row.error = ""
    repo.update(row)
    typer.echo(f"Scheduled {item_id} for {row.scheduled_at}.")


@app.command("schedule-local")
def schedule_local(item_id: str, publish_at: str, path: str = "posting_queue.tsv") -> None:
    repo = get_local_repo(path)
    row = _get_row_or_raise(repo, item_id)
    scheduled_at = _parse_iso_datetime(publish_at)
    row.status = "scheduled"
    row.scheduled_at = scheduled_at.replace(microsecond=0).isoformat()
    row.error = ""
    repo.update(row)
    typer.echo(f"Scheduled {item_id} for {row.scheduled_at} in {repo.path.name}.")


@app.command("list-local")
def list_local(
    path: str = "posting_queue.tsv",
    status: str | None = None,
    limit: int = 20,
) -> None:
    repo = get_local_repo(path)
    rows = repo.read_all()
    if status:
        rows = [row for row in rows if row.status == status]
    for row in rows[:limit]:
        typer.echo(
            "\t".join(
                [
                    row.id,
                    row.status,
                    row.source_name,
                    row.title[:80],
                    row.scheduled_at,
                ]
            )
        )


@app.command("research")
def research(
    item_id: str,
    research_status: str | None = typer.Option(None, help="not_started / in_progress / done"),
    freshness_checked_at: str | None = typer.Option(None, help="ISO datetime. Omit to use now when any field changes."),
    angle: str | None = typer.Option(None, help="Recommended posting angle."),
    x_research_notes: str | None = typer.Option(None, help="Latest X research notes."),
    linkedin_research_notes: str | None = typer.Option(None, help="Latest LinkedIn research notes."),
    past_post_reference: str | None = typer.Option(None, help="Reference to your past posts or tone."),
    reference_post_urls: str | None = typer.Option(None, help="Reference post URLs, newline or comma separated."),
    reference_account_handles: str | None = typer.Option(None, help="Reference accounts or handles."),
    reference_media_urls: str | None = typer.Option(None, help="Reference image/video URLs."),
    reference_media_notes: str | None = typer.Option(None, help="Notes about reference media style."),
    media_plan: str | None = typer.Option(None, help="Planned asset direction for this post."),
) -> None:
    repo = get_repo()
    row = _get_row_or_raise(repo, item_id)
    _apply_research_updates(
        row,
        research_status=research_status,
        freshness_checked_at=freshness_checked_at,
        angle=angle,
        x_research_notes=x_research_notes,
        linkedin_research_notes=linkedin_research_notes,
        past_post_reference=past_post_reference,
        reference_post_urls=reference_post_urls,
        reference_account_handles=reference_account_handles,
        reference_media_urls=reference_media_urls,
        reference_media_notes=reference_media_notes,
        media_plan=media_plan,
    )
    repo.update(row)
    typer.echo(f"Updated research fields for {item_id}.")


@app.command("research-local")
def research_local(
    item_id: str,
    path: str = "posting_queue.tsv",
    research_status: str | None = typer.Option(None, help="not_started / in_progress / done"),
    freshness_checked_at: str | None = typer.Option(None, help="ISO datetime. Omit to use now when any field changes."),
    angle: str | None = typer.Option(None, help="Recommended posting angle."),
    x_research_notes: str | None = typer.Option(None, help="Latest X research notes."),
    linkedin_research_notes: str | None = typer.Option(None, help="Latest LinkedIn research notes."),
    past_post_reference: str | None = typer.Option(None, help="Reference to your past posts or tone."),
    reference_post_urls: str | None = typer.Option(None, help="Reference post URLs, newline or comma separated."),
    reference_account_handles: str | None = typer.Option(None, help="Reference accounts or handles."),
    reference_media_urls: str | None = typer.Option(None, help="Reference image/video URLs."),
    reference_media_notes: str | None = typer.Option(None, help="Notes about reference media style."),
    media_plan: str | None = typer.Option(None, help="Planned asset direction for this post."),
) -> None:
    repo = get_local_repo(path)
    row = _get_row_or_raise(repo, item_id)
    _apply_research_updates(
        row,
        research_status=research_status,
        freshness_checked_at=freshness_checked_at,
        angle=angle,
        x_research_notes=x_research_notes,
        linkedin_research_notes=linkedin_research_notes,
        past_post_reference=past_post_reference,
        reference_post_urls=reference_post_urls,
        reference_account_handles=reference_account_handles,
        reference_media_urls=reference_media_urls,
        reference_media_notes=reference_media_notes,
        media_plan=media_plan,
    )
    repo.update(row)
    typer.echo(f"Updated research fields for {item_id} in {repo.path.name}.")


@app.command("research-plan")
def research_plan(item_id: str) -> None:
    repo = get_repo()
    row = _get_row_or_raise(repo, item_id)
    typer.echo(format_research_plan_markdown(row))


@app.command("research-plan-local")
def research_plan_local(item_id: str, path: str = "posting_queue.tsv") -> None:
    repo = get_local_repo(path)
    row = _get_row_or_raise(repo, item_id)
    typer.echo(format_research_plan_markdown(row))


@app.command("seed-research-urls")
def seed_research_urls(item_id: str) -> None:
    repo = get_repo()
    row = _get_row_or_raise(repo, item_id)
    plan = build_research_plan(row)
    row.reference_post_urls = _merge_reference_post_urls(
        row,
        [plan.x_live_url, plan.x_top_url, plan.linkedin_content_url],
    )
    if not row.research_status:
        row.research_status = "in_progress"
    row.error = ""
    repo.update(row)
    typer.echo(f"Seeded research URLs for {item_id}.")


@app.command("seed-research-urls-local")
def seed_research_urls_local(item_id: str, path: str = "posting_queue.tsv") -> None:
    repo = get_local_repo(path)
    row = _get_row_or_raise(repo, item_id)
    plan = build_research_plan(row)
    row.reference_post_urls = _merge_reference_post_urls(
        row,
        [plan.x_live_url, plan.x_top_url, plan.linkedin_content_url],
    )
    if not row.research_status:
        row.research_status = "in_progress"
    row.error = ""
    repo.update(row)
    typer.echo(f"Seeded research URLs for {item_id} in {repo.path.name}.")


@app.command("publish")
def publish(item_id: str | None = None) -> None:
    raise typer.BadParameter(
        "social-flow publish is disabled for Daily AI automation. "
        "Use run-publish-flow only to prepare publish candidates, then post only through the Chrome plugin registered runner "
        "after isolated authenticated CLI lane, expected-account, body, submit, surface, completion-capture, tab/window recording, and local proof gates pass. "
        "If the Chrome plugin runner, auth/profile lane, recording, or local proof gates cannot satisfy the checks, stop external posting with chrome_extension_required, chrome_extension_required, or chrome_extension_required. "
        "Do not use Codex in-app Browser Use unless explicitly requested."
    )


@app.command(
    "publish-linkedin-chrome-local",
    help=(
        "Legacy foreground Chrome helper for LinkedIn. Not Soy-safe; Daily AI automation must use "
        "the Chrome plugin registered runner instead."
    ),
)
def publish_linkedin_chrome_local(
    item_id: str,
    path: str = "posting_queue.tsv",
    dry_run: bool = False,
    artifact_dir: str = "artifacts/chrome-publish",
    allow_fallback_publish: Annotated[
        bool,
        typer.Option(
        "--allow-live-chrome-publish",
        "--allow-fallback-publish",
	        help="Allow real posting through the legacy live Chrome path. Dry runs do not require this flag.",
        ),
    ] = False,
) -> None:
    _raise_legacy_foreground_chrome_disabled("LinkedIn")
    settings = load_settings()
    repo = get_local_repo(path)
    row = _get_row_or_raise(repo, item_id)
    _hydrate_post_ids_from_urls(row)

    if row.linkedin_post_url:
        typer.echo(f"LinkedIn already published for {item_id}: {row.linkedin_post_url}")
        return
    if not row.linkedin_text.strip():
        raise typer.BadParameter(f"{item_id} has no linkedin_text.")
    _ensure_can_attempt_external_publish(row, "LinkedIn", dry_run=dry_run)
    _ensure_live_chrome_publish_explicitly_allowed(
        "LinkedIn",
        dry_run=dry_run,
        allowed=allow_fallback_publish,
    )
    _apply_publish_humanization(row)

    typer.echo(
        "Using legacy live Chrome path for LinkedIn. "
        "Daily AI normal runs should use the Chrome plugin registered runner instead."
    )

    publisher = _build_chrome_publisher(settings)
    _cleanup_publisher_tabs(publisher)

    result = publisher.publish_linkedin(
        row.linkedin_text,
        dry_run=dry_run,
        artifact_dir=artifact_dir,
    )
    if not result.ok:
        row.error = result.error
        repo.update(row)
        raise RuntimeError(result.error)

    if not dry_run:
        row.linkedin_post_url = result.post_url
        row.linkedin_post_id = extract_linkedin_post_id(result.post_url)
        row.linkedin_published_at = utc_now()
        row.error = ""
        if row.x_post_url or row.x_post_id:
            row.status = "published"
            row.published_at = utc_now()
        else:
            row.status = "partially_published"
        repo.update(row)

    _cleanup_publisher_tabs(publisher)
    typer.echo(f"LinkedIn Chrome publish {'previewed' if dry_run else 'completed'} for {item_id}.")


@app.command(
    "publish-x-chrome-local",
    help=(
        "Legacy foreground Chrome helper for X. Not Soy-safe; Daily AI automation must use "
        "the Chrome plugin registered runner instead."
    ),
)
def publish_x_chrome_local(
    item_id: str,
    path: str = "posting_queue.tsv",
    dry_run: bool = False,
    allow_fallback_publish: Annotated[
        bool,
        typer.Option(
        "--allow-live-chrome-publish",
        "--allow-fallback-publish",
	        help="Allow real posting through the legacy live Chrome path. Dry runs do not require this flag.",
        ),
    ] = False,
) -> None:
    _raise_legacy_foreground_chrome_disabled("X")
    settings = load_settings()
    repo = get_local_repo(path)
    row = _get_row_or_raise(repo, item_id)
    _hydrate_post_ids_from_urls(row)

    if row.x_post_url:
        typer.echo(f"X already published for {item_id}: {row.x_post_url}")
        return
    if not row.x_text.strip():
        raise typer.BadParameter(f"{item_id} has no x_text.")
    _ensure_can_attempt_external_publish(row, "X", dry_run=dry_run)
    _ensure_live_chrome_publish_explicitly_allowed(
        "X",
        dry_run=dry_run,
        allowed=allow_fallback_publish,
    )
    _apply_publish_humanization(row)

    publisher = _build_chrome_publisher(settings)
    _cleanup_publisher_tabs(publisher)
    expected_handle = getattr(settings, "x_expected_handle", "")
    if not expected_handle and not dry_run:
        raise typer.BadParameter("X_EXPECTED_HANDLE is required before publishing to X.")
    result = publisher.publish_x(row.x_text, dry_run=dry_run, expected_handle=expected_handle)
    if not result.ok:
        row.error = result.error
        repo.update(row)
        raise RuntimeError(result.error)

    if not dry_run:
        row.x_post_url = result.post_url
        row.x_post_id = result.post_id or extract_x_post_id(result.post_url)
        row.x_published_at = utc_now()
        row.error = ""
        if row.linkedin_post_url or row.linkedin_post_id:
            row.status = "published"
            row.published_at = utc_now()
        else:
            row.status = "partially_published"
        repo.update(row)

    _cleanup_publisher_tabs(publisher)
    typer.echo(f"X Chrome publish {'previewed' if dry_run else 'completed'} for {item_id}.")


@app.command(
    "cleanup-chrome-automation-tabs",
    help="Chrome automation が生成した LinkedIn/X の compose タブを整理します。",
)
def cleanup_chrome_automation_tabs(
    keep_linkedin_tabs: int = 1,
    keep_x_tabs: int = 1,
) -> None:
    settings = load_settings()
    publisher = _build_chrome_publisher(settings)
    publisher.cleanup_automation_tabs(
        keep_linkedin_tabs=keep_linkedin_tabs,
        keep_x_tabs=keep_x_tabs,
    )
    typer.echo("Cleaned up Chrome automation tabs.")


@app.command(
    "humanize-queue-local",
    help="posting_queue.tsv の下書き候補に公開直前の humanization を一括反映します。",
)
def humanize_queue_local(
    path: str = "posting_queue.tsv",
) -> None:
    repo = get_local_repo(path)
    rows = repo.read_all()
    updated = _humanize_queue_rows(rows)
    for row in rows:
        repo.update(row)
    typer.echo(f"Humanized {updated} queue item(s).")


@app.command(
    "score-queue-local",
    help="posting_queue.tsv の候補に quality score を一括反映します。",
)
def score_queue_local(
    path: str = "posting_queue.tsv",
) -> None:
    repo = get_local_repo(path)
    rows = repo.read_all()
    updated = _rescore_queue_rows(rows)
    for row in rows:
        repo.update(row)
    typer.echo(f"Scored {updated} queue item(s).")


@app.command("record-feed-study-local")
def record_feed_study_local(
    artifact_path: str,
    path: str = "posting_queue.tsv",
    max_actions: int = 9,
    max_likes: int = 5,
    max_comments: int = 3,
    max_saves: int = 3,
    max_quotes: int = 1,
    sync_sheets: bool = True,
) -> None:
    artifact = Path(artifact_path)
    payload = json.loads(artifact.read_text(encoding="utf-8"))
    entries = _feed_study_entries(payload)
    repo = get_local_repo(path)
    rows = repo.read_all()
    discovered_rows = _discovered_feed_items_to_rows(payload, rows)
    for row in discovered_rows:
        repo.append(row)
    rows = [*rows, *discovered_rows]
    expired = _expire_stale_engagement_candidates(rows)
    metrics = _apply_feed_study_entries_to_rows(
        rows,
        entries,
        max_actions=max_actions,
        max_likes=max_likes,
        max_comments=max_comments,
        max_saves=max_saves,
        max_quotes=max_quotes,
    )
    metrics["discovered_items_added"] = len(discovered_rows)
    feed_receipt = _feed_research_receipt(
        metrics,
        artifact_path=str(artifact),
        target=_feed_research_receipt_target(payload),
    )
    existing_ids = {row.id for row in repo.read_all()}
    for row in rows:
        if row.id in existing_ids:
            repo.update(row)
        else:
            repo.append(row)
            existing_ids.add(row.id)

    sheets_synced = 0
    stop_reason = _feed_study_stop_reason(metrics, required_engagement_candidates=max_actions)
    if sync_sheets:
        try:
            sheets_repo = get_repo()
            sheets_synced = _sync_local_queue_to_sheets(repo, sheets_repo)
        except Exception as exc:
            stop_reason = _join_stop_reasons(stop_reason, f"sync_failed: {exc}")
            typer.echo(f"Skipped Google Sheets mirror sync: {exc}")
        else:
            feed_read_log_rows = metrics.get("feed_read_log_rows", [])
            if isinstance(feed_read_log_rows, list):
                try:
                    sheets_repo.append_feed_read_log(feed_read_log_rows)
                except Exception as exc:
                    stop_reason = _join_stop_reasons(stop_reason, f"feed_read_log_sync_failed: {exc}")
                    typer.echo(f"Skipped feed_read_log sync: {exc}")
            relationship_map_rows = metrics.get("relationship_map_rows", [])
            if isinstance(relationship_map_rows, list):
                try:
                    sheets_repo.upsert_relationship_map(relationship_map_rows)
                except Exception as exc:
                    stop_reason = _join_stop_reasons(stop_reason, f"relationship_map_sync_failed: {exc}")
                    typer.echo(f"Skipped engagement relationship map sync: {exc}")

    _append_local_run_summary(
        run_at=utc_now(),
        researched_count=metrics["rows_updated"] + metrics["discovered_items_added"],
        feed_study_count=metrics["feed_study_count"],
        external_posts_read=metrics["external_posts_read"],
        feed_research_receipt=feed_receipt,
        engagement_candidates_created=metrics["engagement_candidates_created"],
        external_engagement_candidates=metrics["external_engagement_candidates"],
        own_post_engagement_candidates=0,
        sheets_synced_count=sheets_synced,
        stop_reason=stop_reason,
        path=path,
    )
    typer.echo(
        "Recorded feed study. "
        f"read={metrics['feed_study_count']} external_read={metrics['external_posts_read']} "
        f"rows_updated={metrics['rows_updated']} discovered={metrics['discovered_items_added']} "
        f"engagement_candidates={metrics['engagement_candidates_created']} "
        f"expired={expired} "
        f"sheets_synced={sheets_synced} receipt={feed_receipt}"
    )


@app.command("sync-relationship-map-local")
def sync_relationship_map_local(
    watchlist_path: str = "docs/x-research-watchlist.md",
    artifact_path: str = "artifacts/engagement/relationship-map-seed.tsv",
    sync_sheets: bool = True,
) -> None:
    rows = _relationship_rows_from_x_watchlist(watchlist_path)
    artifact = Path(artifact_path)
    artifact.parent.mkdir(parents=True, exist_ok=True)
    with artifact.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t")
        writer.writerow(ENGAGEMENT_RELATIONSHIP_COLUMNS)
        writer.writerows(rows)

    sheets_synced = 0
    if sync_sheets:
        try:
            sheets_synced = get_repo().upsert_relationship_map(rows)
        except Exception as exc:
            typer.echo(f"Skipped engagement relationship map sync: {exc}")
    typer.echo(
        "Synced engagement relationship map seed. "
        f"rows={len(rows)} sheets_synced={sheets_synced} artifact={artifact}"
    )


@app.command("write-performance-learning-local")
def write_performance_learning_local(
    path: str = "posting_queue.tsv",
    artifact_path: str | None = None,
    sync_sheets: bool = True,
) -> None:
    repo = get_local_repo(path)
    rows = repo.read_all()
    artifact = _write_performance_learning_artifact(rows, artifact_path=artifact_path)
    if sync_sheets:
        try:
            get_repo().append_learning_review(_performance_learning_rows(rows))
        except Exception as exc:
            typer.echo(f"Skipped learning_review sync: {exc}")
    typer.echo(f"Wrote performance learning artifact: {artifact}")


@app.command("sync-performance")
def sync_performance(item_id: str | None = None) -> None:
    settings = load_settings()
    repo = get_repo()
    x_publisher = XPublisher(settings.x_api_access_token)
    linkedin_publisher = LinkedInPublisher(
        access_token=settings.linkedin_access_token,
        author_urn=settings.linkedin_author_urn,
        api_version=settings.linkedin_api_version,
    )
    rows = repo.read_all()
    targets = [row for row in rows if row.id == item_id] if item_id else rows
    synced = 0
    for row in targets:
        _hydrate_post_ids_from_urls(row)
        metrics_updated = False
        errors: list[str] = []

        if row.x_post_url:
            try:
                for key, value in x_publisher.fetch_metrics(row.x_post_id).items():
                    setattr(row, key, value)
                metrics_updated = True
            except Exception as exc:
                errors.append(f"X: {exc}")

        if row.linkedin_post_url:
            try:
                for key, value in linkedin_publisher.fetch_metrics(row.linkedin_post_id).items():
                    setattr(row, key, value)
                metrics_updated = True
            except Exception as exc:
                errors.append(f"LinkedIn: {exc}")

        if metrics_updated:
            row.performance_synced_at = utc_now()
            if row.status == "failed":
                row.status = "published"
            row.error = "; ".join(errors)
            repo.update(row)
            synced += 1
        elif errors:
            row.error = "; ".join(errors)
            repo.update(row)
    typer.echo(f"Synced performance for {synced} item(s).")


@app.command("run-engagement-flow-local")
def run_engagement_flow_local(
    path: str = "posting_queue.tsv",
    max_actions: int = 3,
    sync_sheets: bool = True,
    allow_api_engagement: Annotated[
        bool,
        typer.Option(
            "--allow-api-engagement",
            help=(
                "Explicitly allow the legacy API engagement sender. Daily AI normal runs must use "
                "the Chrome plugin registered runner instead. "
                "Proceed only after strict account, target/body/comment, submit, completion, recording, and local proof gates pass. "
                "If Chrome plugin route cannot satisfy the gates, stop live engagement with chrome_extension_required."
            ),
        ),
    ] = False,
) -> None:
    if not allow_api_engagement:
        raise typer.BadParameter(
            "run-engagement-flow-local is an API engagement sender and is disabled for Daily AI normal runs. "
            "Use the Chrome plugin registered runner for live engagement, or pass --allow-api-engagement for the API mode intentionally."
        )

    settings = load_settings()
    repo = get_local_repo(path)
    rows = repo.read_all()
    candidates = _engagement_candidates(rows, max_actions=max_actions)
    if not candidates:
        typer.echo("No approved engagement candidates.")
        return

    x_publisher = XPublisher(settings.x_api_access_token)
    linkedin_publisher = LinkedInPublisher(
        access_token=settings.linkedin_access_token,
        author_urn=settings.linkedin_author_urn,
        api_version=settings.linkedin_api_version,
    )

    sent = 0
    skipped = 0
    status_update_failed = 0
    for row in candidates:
        target_url = _first_engagement_target(row)
        platform = _engagement_platform(target_url)
        action = row.engagement_action.strip()
        try:
            if action in {"comment_candidate", "reply_to_own_post", "quote_candidate"} and not _engagement_comment_quality_ok(
                row.comment_draft.strip(),
                platform,
            ):
                raise ValueError("comment_quality_failed: comment_draft contains generic or UI-derived text.")
            if platform == "x":
                result = _run_x_engagement(
                    x_publisher,
                    action=action,
                    target_url=target_url,
                    comment=row.comment_draft.strip(),
                )
            elif platform == "linkedin":
                result = _run_linkedin_engagement(
                    linkedin_publisher,
                    action=action,
                    target_url=target_url,
                    comment=row.comment_draft.strip(),
                )
            else:
                raise ValueError("Unsupported or missing engagement target platform.")

            _mark_engagement_result(
                row,
                status="done",
                note=f"{utc_now()}: auto-engagement sent via {platform} API ({action}) {result.get('url', target_url)}.",
            )
            row.error = ""
            sent += 1
        except Exception as exc:
            _mark_engagement_result(
                row,
                status="skipped",
                note=f"{utc_now()}: auto-engagement skipped: {exc}",
            )
            row.error = f"engagement_failed: {exc}"
            skipped += 1
        repo.update(row)

    sheets_synced = 0
    if sync_sheets:
        try:
            sheets_synced = _sync_local_queue_to_sheets(repo, get_repo())
        except Exception as exc:
            typer.echo(f"Skipped Google Sheets mirror sync: {exc}")

    typer.echo(f"Engagement flow finished. sent={sent} skipped={skipped} sheets_synced={sheets_synced}")


@app.command("send-engagement-candidates-local")
def send_engagement_candidates_local(
    path: str = "posting_queue.tsv",
    max_actions: int = 9,
    sync_sheets: bool = True,
    remote_debugging_port: Annotated[
        int | None,
        typer.Option("--remote-debugging-port", help="Legacy diagnostic option; Daily AI authenticated work uses the Chrome plugin registered runner."),
    ] = None,
    timeout_seconds: Annotated[
        float,
        typer.Option("--timeout-seconds", help="Per-page browser operation timeout."),
    ] = 20.0,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="List approved browser-lane engagement candidates without sending."),
    ] = False,
) -> dict[str, object]:
    raise typer.BadParameter(
        "send-engagement-candidates-local is legacy Playwright/CDP diagnosis only after the Chrome plugin registered route became primary. "
        "Use the Chrome plugin registered runner with recording and local proof gates for Daily AI engagement."
    )
    settings = load_settings()
    repo = get_local_repo(path)
    rows = repo.read_all()
    expired = 0 if dry_run else _expire_stale_engagement_candidates(rows)
    if expired:
        for row in rows:
            repo.update(row)
    recovered_sent_receipts = 0 if dry_run else _recover_engagement_sent_receipts(rows, repo)
    approved_candidates = _engagement_candidates(rows, max_actions=len(rows))
    external_approved_candidates = [
        row for row in approved_candidates if not _is_own_engagement_target(row, _first_engagement_target(row))
    ]
    if external_approved_candidates:
        approved_candidates = external_approved_candidates
        for row in approved_candidates:
            if row.engagement_action.strip() == "quote_candidate":
                row.engagement_action = "comment_candidate"
                if not row.comment_draft.strip():
                    row.comment_draft = _external_engagement_comment(row, _engagement_platform(_first_engagement_target(row)))
                repo.update(row)
    candidates = [row for row in approved_candidates if _browser_lane_engagement_supported(row.engagement_action.strip())][
        :max_actions
    ]
    unsupported_candidates = [
        row for row in approved_candidates if not _browser_lane_engagement_supported(row.engagement_action.strip())
    ]
    if not candidates and unsupported_candidates:
        candidates = unsupported_candidates[:max_actions]
    if not candidates:
        sheets_synced = 0
        if expired and sync_sheets and not dry_run:
            try:
                sheets_synced = _sync_local_queue_to_sheets(repo, get_repo())
            except Exception as exc:
                typer.echo(f"Skipped Google Sheets mirror sync: {exc}")
        if expired:
            _append_local_run_summary(
                run_at=utc_now(),
                researched_count=0,
                sheets_synced_count=sheets_synced,
                stop_reason="stale_engagement_candidates_expired",
                path=path,
            )
            typer.echo(f"Expired stale engagement candidates. expired={expired} sheets_synced={sheets_synced}")
        typer.echo("No approved browser-lane engagement candidates.")
        return {
            "sent": 0,
            "skipped": 0,
            "expired": expired,
            "sheets_synced": sheets_synced,
            "stop_reason": "no_approved_engagement_candidates",
        }

    sent = 0
    skipped = 0
    status_update_failed = 0
    for row in candidates:
        target_url = _first_engagement_target(row)
        action = row.engagement_action.strip()
        platform = _engagement_platform(target_url)
        if dry_run:
            support = "supported" if _browser_lane_engagement_supported(action) else "unsupported"
            typer.echo(f"DRY-RUN {row.id}: {platform} {action} {target_url} {support}")
            continue
        if not _browser_lane_engagement_supported(action):
            _mark_engagement_result(
                row,
                status="skipped",
                note=f"{utc_now()}: browser-lane engagement skipped: unsupported action {action}.",
            )
            row.error = f"engagement_failed: unsupported_browser_engagement_action: {action}"
            skipped += 1
            repo.update(row)
            continue
        try:
            result = _send_browser_engagement_candidate(
                row,
                settings=settings,
                remote_debugging_port=remote_debugging_port,
                timeout_seconds=timeout_seconds,
            )
            receipt_payload = {
                "platform": result.get("platform", platform),
                "completion": result.get("completion", ""),
                "result_url": result.get("url", target_url),
                "target_url": target_url,
                "comment_proof": result.get("comment_proof") or result.get("commentProof") or {},
                "like_proof": result.get("like_proof") or result.get("likeProof") or {},
            }
            if not _is_verified_engagement_sent_receipt(receipt_payload):
                raise RuntimeError(f"engagement_completion_unverified:{result.get('completion', 'missing_completion')}")
            _mark_engagement_result(
                row,
                status="done",
                note=(
                    f"{utc_now()}: browser-lane engagement sent via {result.get('platform', platform)} "
                    f"({action}) {result.get('url', target_url)} {result.get('completion', '')}."
                ),
            )
            row.error = ""
            sent += 1
            receipt_path = _write_engagement_sent_receipt(row, target_url=target_url, action=action, result=result)
            try:
                repo.update(row)
                _confirm_engagement_sent_receipt(receipt_path)
            except Exception as exc:
                status_update_failed += 1
                typer.echo(
                    "Engagement sent but queue status update failed. "
                    f"id={row.id} action={action} target={target_url} receipt={receipt_path} error={exc}"
                )
                break
            continue
        except Exception as exc:
            _mark_engagement_result(
                row,
                status="skipped",
                note=f"{utc_now()}: browser-lane engagement skipped: {exc}",
            )
            row.error = f"engagement_failed: {exc}"
            skipped += 1
        repo.update(row)

    for row in unsupported_candidates:
        if row in candidates:
            continue
        action = row.engagement_action.strip()
        if dry_run:
            target_url = _first_engagement_target(row)
            platform = _engagement_platform(target_url)
            typer.echo(f"DRY-RUN {row.id}: {platform} {action} {target_url} unsupported")
            continue
        _mark_engagement_result(
            row,
            status="skipped",
            note=f"{utc_now()}: browser-lane engagement skipped: unsupported action {action}.",
        )
        row.error = f"engagement_failed: unsupported_browser_engagement_action: {action}"
        skipped += 1
        repo.update(row)

    sheets_synced = 0
    if sync_sheets and not dry_run:
        try:
            sheets_synced = _sync_local_queue_to_sheets(repo, get_repo())
        except Exception as exc:
            typer.echo(f"Skipped Google Sheets mirror sync: {exc}")

    if sent or skipped:
            _append_local_run_summary(
                run_at=utc_now(),
                researched_count=0,
                engagement_candidates_created=0,
                sheets_synced_count=sheets_synced,
                stop_reason=(
                    "engagement_status_update_failed_after_send"
                    if status_update_failed
                    else "" if sent else "engagement_send_failed"
                ),
                path=path,
            )
    typer.echo(
        "Browser-lane engagement finished. "
        f"sent={sent} skipped={skipped} expired={expired} recovered={recovered_sent_receipts} "
        f"status_update_failed={status_update_failed} "
        f"dry_run={dry_run} sheets_synced={sheets_synced}"
    )
    return {
        "sent": sent,
        "skipped": skipped,
        "expired": expired,
        "sheets_synced": sheets_synced,
        "stop_reason": (
            "engagement_status_update_failed_after_send"
            if status_update_failed
            else "engagement_send_failed" if not dry_run and sent <= 0 and skipped > 0 else ""
        ),
    }


@app.command("send-own-post-engagement-local")
def send_own_post_engagement_local(
    path: str = "posting_queue.tsv",
    platform: Annotated[str, typer.Option("--platform", help="Platform to satisfy with an own-post follow-up: x or linkedin.")] = "linkedin",
    sync_sheets: bool = False,
    remote_debugging_port: Annotated[
        int | None,
        typer.Option("--remote-debugging-port", help="Daily AI Chrome plugin CDP port."),
    ] = None,
    timeout_seconds: Annotated[
        float,
        typer.Option("--timeout-seconds", help="Per-page browser operation timeout."),
    ] = 25.0,
    json_output: Annotated[bool, typer.Option("--json", help="Print machine-readable receipt.")] = False,
) -> dict[str, object]:
    raise typer.BadParameter(
        "send-own-post-engagement-local is legacy Playwright/CDP diagnosis only after the Chrome plugin registered route became primary. "
        "Use the Chrome plugin registered runner with recording and local proof gates for Daily AI own-post engagement."
    )
    normalized_platform = platform.strip().lower()
    if normalized_platform not in {"x", "linkedin"}:
        raise typer.BadParameter("platform must be x or linkedin")

    settings = load_settings()
    repo = get_local_repo(path)
    rows = repo.read_all()
    source_row = _latest_published_row_for_own_platform_engagement(rows, normalized_platform)
    if source_row is None:
        payload = {
            "sent": 0,
            "skipped": 1,
            "platform": normalized_platform,
            "stop_reason": f"own_post_engagement_no_published_{normalized_platform}_post",
            "receipts": [],
        }
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            typer.echo(payload["stop_reason"])
        return payload

    synthetic = _supplemental_own_post_engagement_row(source_row, normalized_platform)
    target_url = _first_engagement_target(synthetic)
    try:
        result = _send_browser_engagement_candidate(
            synthetic,
            settings=settings,
            remote_debugging_port=remote_debugging_port,
            timeout_seconds=timeout_seconds,
            verify_profile_path=False,
        )
        receipt = {
            "id": source_row.id,
            "synthetic_id": synthetic.id,
            "platform": result.get("platform", normalized_platform),
            "action": synthetic.engagement_action,
            "completion": result.get("completion", ""),
            "url": result.get("url", target_url),
            "target_url": target_url,
            "comment_proof": result.get("comment_proof") or result.get("commentProof") or {},
            "like_proof": result.get("like_proof") or result.get("likeProof") or {},
            "source": "supplemental_own_post_engagement",
        }
        if not _is_verified_engagement_sent_receipt(receipt):
            raise RuntimeError(f"engagement_completion_unverified:{receipt.get('completion') or 'missing_completion'}")
        payload = {
            "sent": 1,
            "skipped": 0,
            "platform": normalized_platform,
            "source_row_id": source_row.id,
            "target_url": target_url,
            "receipts": [receipt],
            "stop_reason": "",
        }
        source_row.review_notes = _append_unique_text(
            source_row.review_notes,
            f"{utc_now()}: supplemental {normalized_platform} own-post engagement sent; receipt={receipt.get('completion')}.",
            separator="\n",
        )
        repo.update(source_row)
    except Exception as exc:
        payload = {
            "sent": 0,
            "skipped": 1,
            "platform": normalized_platform,
            "source_row_id": source_row.id,
            "target_url": target_url,
            "receipts": [
                {
                    "id": source_row.id,
                    "synthetic_id": synthetic.id,
                    "platform": normalized_platform,
                    "action": synthetic.engagement_action,
                    "target_url": target_url,
                    "error": str(exc),
                    "source": "supplemental_own_post_engagement",
                }
            ],
            "stop_reason": f"own_post_engagement_failed:{normalized_platform}",
        }

    sheets_synced = 0
    if sync_sheets and payload["sent"]:
        try:
            sheets_synced = _sync_local_queue_to_sheets(repo, get_repo())
        except Exception as exc:
            typer.echo(f"Skipped Google Sheets mirror sync: {exc}")
    payload["sheets_synced"] = sheets_synced
    _append_local_run_summary(
        run_at=utc_now(),
        researched_count=0,
        engagement_candidates_created=0,
        sheets_synced_count=sheets_synced,
        stop_reason=str(payload.get("stop_reason") or ""),
        path=path,
    )
    if json_output:
        typer.echo(json.dumps(payload, ensure_ascii=False))
    else:
        typer.echo(
            "Supplemental own-post engagement finished. "
            f"platform={normalized_platform} sent={payload['sent']} skipped={payload['skipped']} "
            f"stop_reason={payload.get('stop_reason') or ''}"
        )
    return payload


@app.command("expire-stale-engagement-candidates-local")
def expire_stale_engagement_candidates_local(
    path: str = "posting_queue.tsv",
    max_age_hours: int = 24,
    sync_sheets: bool = True,
) -> None:
    repo = get_local_repo(path)
    expired = _mutate_queue_rows(
        repo,
        lambda rows: _expire_stale_engagement_candidates(rows, max_age_hours=max_age_hours),
    )

    sheets_synced = 0
    if sync_sheets and expired:
        try:
            sheets_synced = _sync_local_queue_to_sheets(repo, get_repo())
        except Exception as exc:
            typer.echo(f"Skipped Google Sheets mirror sync: {exc}")

    if expired:
        _append_local_run_summary(
            run_at=utc_now(),
            researched_count=0,
            sheets_synced_count=sheets_synced,
            stop_reason="stale_engagement_candidates_expired",
            path=path,
        )
    typer.echo(f"Expired stale engagement candidates. expired={expired} sheets_synced={sheets_synced}")


@app.command("prepare-engagement-candidates-local")
def prepare_engagement_candidates_local(
    path: str = "posting_queue.tsv",
    max_actions: int = 9,
    max_likes: int = 5,
    max_comments: int = 3,
    max_saves: int = 3,
    max_quotes: int = 1,
    include_external: bool = True,
    allow_own_post_fallback: bool = False,
    sync_sheets: bool = True,
) -> None:
    repo = get_local_repo(path)
    def prepare_mutation(rows: list[QueueRow]) -> dict[str, int]:
        expired_count = _expire_stale_engagement_candidates(rows)
        prepared_count = 0
        external_count = 0
        if include_external:
            external_count = _prepare_external_engagement_candidates(
                rows,
                max_actions=max_actions,
                max_likes=max_likes,
                max_comments=max_comments,
                max_saves=max_saves,
                max_quotes=max_quotes,
            )
            prepared_count += external_count
        own_count = 0
        if allow_own_post_fallback and include_external and prepared_count == 0:
            own_count = _prepare_own_post_engagement_candidates(rows, max_actions=1)
        prepared_count += own_count
        return {
            "expired": expired_count,
            "prepared": prepared_count,
            "external_prepared": external_count,
            "own_prepared": own_count,
            "changed": bool(expired_count or prepared_count),
        }

    mutation_result = _mutate_queue_rows(repo, prepare_mutation)
    expired = int(mutation_result["expired"])
    prepared = int(mutation_result["prepared"])
    external_prepared = int(mutation_result["external_prepared"])
    own_prepared = int(mutation_result["own_prepared"])

    sheets_synced = 0
    if sync_sheets:
        try:
            sheets_synced = _sync_local_queue_to_sheets(repo, get_repo())
        except Exception as exc:
            typer.echo(f"Skipped Google Sheets mirror sync: {exc}")

    if prepared or expired:
        _append_local_run_summary(
            run_at=utc_now(),
            researched_count=0,
            engagement_candidates_created=prepared,
            external_engagement_candidates=external_prepared,
            own_post_engagement_candidates=own_prepared,
            sheets_synced_count=sheets_synced,
            stop_reason="" if prepared else "stale_engagement_candidates_expired",
            path=path,
        )
    typer.echo(
        "Prepared engagement candidates. "
        f"prepared={prepared} external={external_prepared} own_post={own_prepared} expired={expired} sheets_synced={sheets_synced}"
    )


@app.command("run-daily-ai-automation")
def run_daily_ai_automation(
    path: str = "posting_queue.tsv",
    owner: str = "sns-daily-ai-publish-run",
    task: str = "Daily AI Research + Publish Run",
    sync_sheets: bool = True,
    max_drafts: int = 3,
    max_publish_items: int = 3,
    max_engagement_actions: int = 9,
    run_mode: str = "daily_normal",
    remote_debugging_port: Annotated[
        int | None,
        typer.Option("--remote-debugging-port", help="Legacy diagnostic option; Daily AI authenticated work uses the Chrome plugin registered runner."),
    ] = None,
    timeout_seconds: Annotated[
        float,
        typer.Option("--timeout-seconds", help="CDP endpoint wait seconds."),
    ] = 8.0,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Run deterministic preflight and prep without sending engagement."),
    ] = False,
) -> None:
    raise typer.BadParameter(
        "run-daily-ai-automation is legacy diagnosis only after the Chrome plugin route became primary. "
        "Use the Chrome plugin registered runner for Daily AI publish/engagement. "
        "If that runner is unavailable, stop before publish/engagement with chrome_extension_required; "
        "do not fall back to Chrome Extension/Profile 2, Browser Use-native, foreground Chrome, or OS-level controls."
    )
    settings = load_settings()
    port = remote_debugging_port or settings.chrome_main_remote_debugging_port
    marker_claimed = False
    stop_reason = ""
    lane_name = "unresolved"
    stop_stage = ""
    publish_send_result: dict[str, object] = {}
    engagement_failure_receipt = ""
    core_ran = False
    publish_lane_available = True
    publish_completion_incomplete = False
    publish_resume_target = ""

    try:
        lane = _browser_lane_resolution_payload(
            settings,
            port,
            "publish",
            open_if_missing=True,
            timeout_seconds=timeout_seconds,
            owner=owner,
        )
        lane_name = str(lane.get("lane") or "unresolved")
        typer.echo("Daily AI lane: " + json.dumps(lane, ensure_ascii=False))
        if lane.get("lane") == "stop":
            stop_reason = str(lane.get("stop_reason") or "browser_lane_stop")
            publish_completion_incomplete = True
            publish_resume_target = stop_reason
            run_core_flow(
                path=path,
                publish_external=False,
                sync_sheets=sync_sheets,
                max_drafts=max_drafts,
                max_publish_items=max_publish_items,
                collect_sources=True,
                run_mode=run_mode,
            )
            core_ran = True
            publish_lane_available = False
            typer.echo(
                "Daily AI external publish incomplete: "
                f"{stop_reason}. Publish lane stopped, but engagement will be resolved independently."
            )
        else:
            normalized_lane = _normalize_profile2_extension_lane(lane)
            if normalized_lane != lane:
                lane = normalized_lane
                lane_name = str(lane.get("lane") or "chrome_extension_profile2_fallback")
                typer.echo("Daily AI lane normalized: " + json.dumps(lane, ensure_ascii=False))

        if not core_ran:
            run_core_flow(
                path=path,
                publish_external=False,
                sync_sheets=sync_sheets,
                max_drafts=max_drafts,
                max_publish_items=max_publish_items,
                collect_sources=True,
                run_mode=run_mode,
            )
        run_publish_flow(
            path=path,
            sync_sheets=sync_sheets,
            max_publish_items=max_publish_items,
            run_mode=run_mode,
        )
        publish_send_result = {"posted": 0, "stop_reason": "", "media_receipt": ""}
        if publish_lane_available:
            try:
                publish_send_result = _send_publish_candidates_chrome_extension(
                    path=path,
                    lane_resolution=lane,
                    max_publish_items=max_publish_items,
                    sync_sheets=sync_sheets,
                    dry_run=dry_run,
                )
            except Exception as exc:
                message = " ".join(str(exc).split())[:300]
                stop_reason = (
                    message
                    if message.startswith(("chrome_extension_profile2_unavailable", "trusted_runner_bridge_unavailable"))
                    else "publish_send_failed"
                )
                publish_completion_incomplete = True
                publish_resume_target = stop_reason
                typer.echo(
                    f"Daily AI Chrome Extension publish stopped: {stop_reason}; detail={message}. "
                    "Engagement will be resolved independently."
                )
                publish_send_result = {
                    "attempted": 0,
                    "posted": 0,
                    "skipped": 1,
                    "stop_reason": stop_reason,
                    "media_receipt": _automation_failure_receipt(message),
                }
        else:
            publish_send_result = {
                "attempted": 0,
                "posted": 0,
                "skipped": 1,
                "stop_reason": stop_reason,
                "media_receipt": _automation_failure_receipt(stop_reason),
            }
        typer.echo("Daily AI Chrome Extension publish sender: " + json.dumps(publish_send_result, ensure_ascii=False))
        post_publish_rows = get_local_repo(path).read_all()
        pending_publish_candidates = _publish_flow_candidates(
            post_publish_rows,
            max_publish_items,
        )
        publish_attempted_count = int(publish_send_result.get("attempted", 0) or 0)
        publish_posted_count = int(publish_send_result.get("posted", 0) or 0)
        publish_skipped_count = int(publish_send_result.get("skipped", 0) or 0)
        publish_incomplete_reason = ""
        if (
            not dry_run
            and publish_attempted_count > 0
            and (publish_skipped_count > 0 or publish_posted_count < publish_attempted_count)
        ):
            publish_incomplete_reason = str(publish_send_result.get("stop_reason") or "publish_send_failed")
            stop_reason = publish_incomplete_reason
            publish_completion_incomplete = True
            publish_resume_target = stop_reason
            typer.echo(
                "Daily AI external publish incomplete: "
                f"{publish_incomplete_reason}; attempted={publish_attempted_count}; posted={publish_posted_count}; skipped={publish_skipped_count}. "
                "Engagement must use the Chrome plugin registered runner with recording and local proof gates."
            )
        if pending_publish_candidates and not dry_run:
            candidate_ids = ", ".join(row.id for row in pending_publish_candidates)
            publish_incomplete_reason = str(
                publish_send_result.get("stop_reason")
                or ("publish_send_failed" if publish_posted_count > 0 or publish_skipped_count > 0 else "publish_send_not_attempted")
            )
            stop_reason = publish_incomplete_reason
            publish_completion_incomplete = True
            publish_resume_target = stop_reason
            typer.echo(
                "Daily AI external publish incomplete: "
                f"{publish_incomplete_reason}; pending_candidates={candidate_ids}. "
                "The publish state remains partial, but engagement will still run."
            )
        if (
            not dry_run
            and not pending_publish_candidates
            and not _has_post_publish_engagement_target(post_publish_rows)
            and publish_attempted_count <= 0
            and publish_posted_count <= 0
            and publish_skipped_count <= 0
        ):
            latest_core_stop = _latest_local_daily_ai_stop_reason()
            if latest_core_stop and latest_core_stop != "publish_send_not_attempted":
                stop_reason = f"publish_send_not_attempted; {latest_core_stop}"
            else:
                stop_reason = "publish_send_not_attempted"
            publish_completion_incomplete = True
            publish_resume_target = stop_reason
            typer.echo(
                "Daily AI external publish incomplete: "
                f"{stop_reason}. No publish candidate reached the external sender, "
                "but engagement must use the Chrome plugin registered runner with recording and local proof gates."
            )
        feed_study_result = {
            "artifact": "",
            "read": 0,
            "external_read": 0,
            "engagement_candidates_created": 0,
            "media_receipt": "post_publish_feed_study_deferred_to_extension_lane",
            "stop_reason": "",
        }
        typer.echo("Daily AI post-publish engagement feed study: " + json.dumps(feed_study_result, ensure_ascii=False))
        feed_study_stop = str(feed_study_result.get("stop_reason") or "")
        if feed_study_stop and not dry_run:
            stop_reason = "engagement_send_failed"
            stop_stage = "engagement"
            engagement_failure_receipt = _automation_failure_receipt(feed_study_stop)
            typer.echo(f"Daily AI engagement stopped: {stop_reason}; detail={feed_study_stop}")
            return
        # Legacy ordering note: _post_publish_engagement_feed_study_local(...) belongs before
        # prepare_engagement_candidates_local(...) when this old CLI is promoted back to primary.
        prepare_engagement_candidates_local(
            path=path,
            max_actions=max_engagement_actions,
            include_external=True,
            sync_sheets=sync_sheets,
        )
        if dry_run:
            typer.echo("Daily AI dry-run: skipped live engagement sender.")
        else:
            engagement_lane = _browser_lane_resolution_payload(
                settings,
                port,
                "engagement",
                open_if_missing=True,
                timeout_seconds=timeout_seconds,
                owner=owner,
            )
            typer.echo("Daily AI engagement lane: " + json.dumps(engagement_lane, ensure_ascii=False))
            if engagement_lane.get("lane") == "stop":
                stop_reason = str(engagement_lane.get("stop_reason") or "chrome_extension_profile2_unavailable")
                stop_stage = "engagement"
                engagement_failure_receipt = _automation_failure_receipt(stop_reason)
                typer.echo(f"Daily AI Chrome Extension engagement stopped: {stop_reason}; detail={stop_reason}")
                return
            normalized_engagement_lane = _normalize_profile2_extension_lane(engagement_lane)
            if normalized_engagement_lane != engagement_lane:
                engagement_lane = normalized_engagement_lane
                typer.echo("Daily AI engagement lane normalized: " + json.dumps(engagement_lane, ensure_ascii=False))
            try:
                engagement_result = _send_engagement_candidates_chrome_extension(
                    path=path,
                    lane_resolution=engagement_lane,
                    max_actions=max_engagement_actions,
                    sync_sheets=sync_sheets,
                    dry_run=dry_run,
                )
            except Exception as exc:
                message = " ".join(str(exc).split())[:300]
                stop_reason = (
                    message
                    if message.startswith(("chrome_extension_profile2_unavailable", "trusted_runner_bridge_unavailable"))
                    else "engagement_send_failed"
                )
                stop_stage = "engagement"
                engagement_failure_receipt = _automation_failure_receipt(message)
                typer.echo(f"Daily AI Chrome Extension engagement stopped: {stop_reason}; detail={message}")
                return
            typer.echo("Daily AI Chrome Extension engagement sender: " + json.dumps(engagement_result, ensure_ascii=False))
            if int(engagement_result.get("sent", 0) or 0) <= 0:
                receipts = engagement_result.get("receipts")
                receipt_errors = [
                    str(receipt.get("error") or "")
                    for receipt in receipts
                    if isinstance(receipt, dict) and str(receipt.get("error") or "").strip()
                ] if isinstance(receipts, list) else []
                skipped = int(engagement_result.get("skipped", 0) or 0)
                result_stop_reason = str(engagement_result.get("stop_reason") or "")
                if skipped > 0 or result_stop_reason or receipt_errors:
                    message = " ".join((result_stop_reason or "; ".join(receipt_errors) or "engagement skipped").split())[:300]
                    stop_reason = "engagement_send_failed"
                    stop_stage = "engagement"
                    engagement_failure_receipt = _automation_failure_receipt(message)
                    typer.echo(f"Daily AI Chrome Extension engagement stopped: {stop_reason}; detail={message}")
                    return
    finally:
        if marker_claimed:
            clear_result = _clear_automation_lane_busy_marker(owner=owner)
            typer.echo("Daily AI busy marker cleared: " + json.dumps(clear_result, ensure_ascii=False))
        try:
            cleanup_chrome_automation_tabs()
        except Exception as exc:
            typer.echo(f"Skipped Chrome automation cleanup: {exc}")
        if stop_reason:
            postflight_posted_count = int(publish_send_result.get("posted", 0) or 0)
            postflight_skipped_count = int(publish_send_result.get("skipped", 0) or 0)
            postflight_selected_count = int(publish_send_result.get("attempted", 0) or 0)
            if postflight_selected_count <= 0:
                postflight_selected_count = postflight_posted_count + postflight_skipped_count
            try:
                remaining_publish_candidates = _publish_flow_candidates(
                    get_local_repo(path).read_all(),
                    max_publish_items,
                )
                if remaining_publish_candidates:
                    postflight_selected_count = len(remaining_publish_candidates)
            except Exception:
                pass
            postflight_sheets_synced_count = int(publish_send_result.get("sheets_synced_count", 0) or 0)
            completion_required = (
                "external_publish_completion_required"
                if publish_completion_incomplete
                else "engagement_completion_required"
                if stop_stage == "engagement" or stop_reason.startswith("engagement_")
                else "external_publish_completion_required"
            )
            resume_target = (
                publish_resume_target
                if publish_completion_incomplete and publish_resume_target
                else stop_reason
            )
            automation_health = _automation_health_payload(
                stage="daily_ai_postflight",
                lane=lane_name,
                source_of_truth=path,
                completion_required=completion_required,
                resume_target=resume_target,
            )
            health_receipt = _append_automation_health_receipt(
                ";".join(
                    part
                    for part in [
                        str(publish_send_result.get("media_receipt") or ""),
                        engagement_failure_receipt,
                    ]
                    if part
                ),
                stage=automation_health["stage"],
                lane=automation_health["lane"],
                source_of_truth=automation_health["source_of_truth"],
                completion_proof=automation_health["completion_required"],
                resume_target=automation_health["resume_target"],
            )
            _append_local_run_summary(
                run_at=utc_now(),
                researched_count=0,
                selected_count=postflight_selected_count,
                posted_count=postflight_posted_count,
                media_receipt=health_receipt,
                sheets_synced_count=postflight_sheets_synced_count,
                stop_reason=stop_reason,
                path=path,
                automation_health=automation_health,
            )
            if sync_sheets:
                try:
                    _append_run_summary(
                        get_repo(),
                        researched_count=0,
                        selected_count=postflight_selected_count,
                        posted_count=postflight_posted_count,
                        media_receipt=health_receipt,
                        sheets_synced_count=postflight_sheets_synced_count,
                        stop_reason=stop_reason,
                    )
                except Exception as exc:
                    typer.echo(f"Skipped Google Sheets final stop_reason append: {exc}")


@app.command("run-core-flow")
def run_core_flow(
    path: str = "posting_queue.tsv",
    publish_external: bool = False,
    sync_sheets: bool = True,
    max_drafts: int = 3,
    max_publish_items: int = 3,
    ship_now_buffer_target: int = 3,
    collect_sources: bool = True,
    run_mode: str = "daily_normal",
) -> None:
    run_mode_config = _run_mode_config(run_mode)
    settings = load_settings()
    repo = get_local_repo(path)
    repo.bootstrap()
    run_at = utc_now()
    typer.echo(
        "Run mode: "
        f"{run_mode} "
        f"(research={run_mode_config['research_target']}; "
        f"posting={run_mode_config['posting_target']}; "
        f"engagement={run_mode_config['engagement_target']})"
    )

    collected = 0
    collection_stop_reason = ""
    if collect_sources:
        try:
            collected = _upsert_documents(repo, _documents_to_rows(_collect_documents_from_sources_bounded(settings)))
        except Exception as exc:
            collection_stop_reason = f"source_collection_failed: {exc}"
            typer.echo(
                "Skipped source collection after error; continuing with local queue draft/selection: "
                f"{exc}"
            )
    drafted = _draft_queue_rows(repo, settings, max_items=max_drafts)

    rows = repo.read_all()
    no_repost_normalized = _normalize_no_repost_pending_rows(rows)
    scored = _rescore_queue_rows(rows)
    cleaned = _cleanup_published_queue_state(rows)
    buffer_marked = _mark_hold_rows_for_buffer_refresh(rows, target_buffer=ship_now_buffer_target)
    image_generation_repair_blockers: list[str] = []
    auto_promoted = _promote_best_hold_candidate_for_publish(
        rows,
        target_buffer=ship_now_buffer_target,
        settings=settings,
        repair_blockers=image_generation_repair_blockers,
        repair_discovery_context=collect_sources,
    )
    for row in rows:
        repo.update(row)

    published = 0
    publish_candidates: list[QueueRow] = []
    refreshed_count = drafted + no_repost_normalized + scored + cleaned + buffer_marked + auto_promoted
    quoted_count = 0
    stop_reason = collection_stop_reason
    for blocker in _dedupe_run_level_image_generation_blockers(image_generation_repair_blockers):
        stop_reason = f"{stop_reason}; {blocker}" if stop_reason else blocker
    buffer_count = _ship_now_buffer_count(rows)
    if buffer_count < ship_now_buffer_target:
        if buffer_count == 0:
            buffer_stop_reason = (
                f"no_ship_now_candidates; ship_now_buffer_below_target:{buffer_count}/{ship_now_buffer_target}"
            )
        else:
            buffer_stop_reason = f"ship_now_buffer_below_target:{buffer_count}/{ship_now_buffer_target}"
        stop_reason = f"{stop_reason}; {buffer_stop_reason}" if stop_reason else buffer_stop_reason
        blocker_samples = _ship_now_buffer_blocker_samples(rows)
        if blocker_samples:
            buffer_blockers = "ship_now_buffer_blockers:" + "|".join(blocker_samples)
            stop_reason = f"{stop_reason}; {buffer_blockers}" if stop_reason else buffer_blockers
    if publish_external:
        publish_rows = repo.read_all()
        surface_blocked = _hold_surface_blocked_publish_rows(publish_rows)
        if surface_blocked:
            refreshed_count += surface_blocked
            _persist_queue_rows(repo, publish_rows)
            typer.echo(f"Held publish candidates with incomplete posting surface: {surface_blocked}")
        publish_candidates = _publish_flow_candidates(repo.read_all(), max_publish_items)
        usable_publish_candidate_count = len(publish_candidates)
        quoted_count = sum(
            1
            for row in publish_candidates
            if row.content_format in {"native_quote_business_translation", "official_quote", "quote_repost_commentary"}
        )
        typer.echo(
            "Publish flow candidates: "
            + ", ".join(row.id for row in publish_candidates)
            if publish_candidates
            else "Publish flow candidates: none"
        )
        for row in publish_candidates:
            existing_notes = [part.strip() for part in row.review_notes.split("|") if part.strip()]
            existing_notes = [
                part for part in existing_notes if part != "Daily AI Browser Use-native publish candidate"
            ]
            if "Daily AI Chrome plugin publish candidate" not in existing_notes:
                existing_notes.append("Daily AI Chrome plugin publish candidate")
            row.review_notes = " | ".join(existing_notes)
            row.next_action = _chrome_profile_publish_next_action(row)
            repo.update(row)
        if publish_candidates:
            typer.echo(
                "Prepared Daily AI Chrome plugin publish candidates. "
                "No external post was submitted by this prep step."
            )
        elif not stop_reason:
            stop_reason = "no_publish_candidates_after_refresh"
        elif not publish_candidates and "no_publish_candidates_after_refresh" not in stop_reason:
            stop_reason = f"{stop_reason}; no_publish_candidates_after_refresh"
    else:
        usable_publish_candidate_count = 0
        typer.echo("Skipped external publishing. Daily AI Chrome plugin registered runner handles live posting for this automation.")

    sheets_synced = 0
    sheets_repo: SheetsRepository | None = None
    if sync_sheets:
        try:
            sheets_repo = get_repo()
            sheets_synced = _sync_local_queue_to_sheets(repo, sheets_repo)
        except Exception as exc:
            sync_stop_reason = f"sync_failed: {exc}"
            stop_reason = f"{stop_reason}; {sync_stop_reason}" if stop_reason else sync_stop_reason
            typer.echo(f"Skipped Google Sheets mirror sync: {exc}")

    should_record_summary = _should_record_run_summary(
        researched_count=collected,
        refreshed_count=refreshed_count,
        selected_count=len(publish_candidates),
        posted_count=published,
        quoted_count=quoted_count,
        sheets_synced_count=sheets_synced,
        stop_reason=stop_reason,
    )
    automation_health = _automation_health_payload(
        stage="daily_ai_core",
        lane="not_applicable",
        source_of_truth=path,
        completion_required="local_queue_and_sheets_sync",
        resume_target=stop_reason or "core_flow_completed",
    )
    health_receipt = _append_automation_health_receipt(
        stage=automation_health["stage"],
        lane=automation_health["lane"],
        source_of_truth=automation_health["source_of_truth"],
        completion_proof=automation_health["completion_required"],
        resume_target=automation_health["resume_target"],
    )

    if sheets_repo is not None and should_record_summary:
        try:
            _append_run_summary(
                sheets_repo,
                researched_count=collected,
                refreshed_count=refreshed_count,
                selected_count=len(publish_candidates),
                posted_count=published,
                quoted_count=quoted_count,
                media_receipt=health_receipt,
                sheets_synced_count=sheets_synced,
                stop_reason=stop_reason,
                ship_now_buffer_count=buffer_count,
                ship_now_buffer_refreshed_count=buffer_marked,
                usable_publish_candidate_count=usable_publish_candidate_count,
            )
        except Exception as exc:
            summary_stop_reason = f"run_summary_sync_failed: {exc}"
            stop_reason = f"{stop_reason}; {summary_stop_reason}" if stop_reason else summary_stop_reason
            typer.echo(f"Skipped Google Sheets run_summary append: {exc}")

    local_summary_path = None
    if should_record_summary:
        local_summary_path = _append_local_run_summary(
            run_at=run_at,
            researched_count=collected,
            refreshed_count=refreshed_count,
            selected_count=len(publish_candidates),
            posted_count=published,
            quoted_count=quoted_count,
            sheets_synced_count=sheets_synced,
            media_receipt=health_receipt,
            stop_reason=stop_reason,
            path=path,
            ship_now_buffer_count=buffer_count,
            ship_now_buffer_refreshed_count=buffer_marked,
            usable_publish_candidate_count=usable_publish_candidate_count,
            automation_health=automation_health,
        )

    typer.echo(
        "Core flow finished. "
        f"collected={collected} drafted={drafted} scored={scored} "
        f"cleaned={cleaned} no_repost_normalized={no_repost_normalized} buffer_marked={buffer_marked} "
        f"auto_promoted={auto_promoted} "
        f"ship_now_buffer={buffer_count}/{ship_now_buffer_target} published={published} sheets_synced={sheets_synced}"
    )
    if local_summary_path is not None:
        typer.echo(f"Local run summary: {local_summary_path}")


@app.command("run-publish-flow")
def run_publish_flow(
    path: str = "posting_queue.tsv",
    sync_sheets: bool = True,
    max_publish_items: int = 3,
    run_mode: str = "daily_normal",
) -> None:
    run_core_flow(
        path=path,
        publish_external=True,
        sync_sheets=sync_sheets,
        max_drafts=0,
        max_publish_items=max_publish_items,
        collect_sources=False,
        run_mode=run_mode,
    )


@app.command("run-job-manager-now")
def run_job_manager_now(
    execute: Annotated[
        bool,
        typer.Option("--execute", help="Actually invoke codex exec with the registered Job Application Manager launch packet."),
    ] = False,
    live_preflight_only: Annotated[
        bool,
        typer.Option(
            "--live-preflight-only",
            help="Validate the live scheduler contract, bridge readiness, lease, and run-dir isolation, then stop before the workflow child starts.",
        ),
    ] = False,
    codex_home: Annotated[
        Path | None,
        typer.Option(
            "--codex-home",
            help="Optional CODEX_HOME override for the spawned codex exec. Use a writable alternate home if the default state db is read-only.",
        ),
    ] = None,
) -> None:
    _reject_recursive_registered_execute(execute=execute, automation_id="job-application-manager")
    launch_packet = _job_manager_launch_packet()
    launch_dir = _job_manager_registered_cwd(JOB_MANAGER_AUTOMATION_TOML)
    payload_path = JOB_MANAGER_AUTOMATION_TOML.parent / "run-now-launch-packet.json"
    if not execute and not live_preflight_only:
        payload_path.write_text(json.dumps(launch_packet, ensure_ascii=False, indent=2), encoding="utf-8")
        typer.echo(json.dumps({"launch_packet": str(payload_path), "launch_message_sha256": launch_packet["launch_message_sha256"]}, ensure_ascii=False))
        typer.echo("Dry run only. Pass --execute to invoke codex exec with the registered launch message.")
        return

    trusted_wrapper_v2 = os.environ.get("SOCIAL_FLOW_TRUSTED_BROWSER_WRAPPER_V2") == "1"
    trusted_wrapper_receipt: dict[str, object] | None = None
    trusted_request: dict[str, object] | None = None
    if trusted_wrapper_v2:
        request_path_text = str(os.environ.get("SOCIAL_FLOW_CONTROL_REQUEST_PATH") or "").strip()
        control_stage = str(os.environ.get("SOCIAL_FLOW_CONTROL_STAGE") or "").strip()
        expected_stage = "execute" if execute else "preflight"
        if not request_path_text or control_stage != expected_stage:
            raise RuntimeError("trusted_wrapper_current_request_binding_missing_or_stage_invalid")
        trusted_request = validate_trusted_wrapper_env(
            request_path=Path(request_path_text),
            automation_id="job-application-manager",
            stage=control_stage,
        )
        trusted_wrapper_receipt = load_and_consume_trusted_wrapper_receipt(trusted_request)

    launch_model = _registered_automation_model(JOB_MANAGER_AUTOMATION_TOML)
    launch_reasoning_effort = _job_manager_registered_reasoning_effort(JOB_MANAGER_AUTOMATION_TOML) or "high"
    _job_manager_registered_contract(JOB_MANAGER_AUTOMATION_TOML)
    codex_home = codex_home or DEFAULT_SAFE_CODEX_HOME
    if not _job_manager_can_write_home(codex_home):
        raise RuntimeError(f"writable_alternate_codex_home_unavailable:{codex_home}")
    auth_mode = _job_manager_auth_mode(codex_home)
    if trusted_wrapper_receipt is not None:
        run_id = str(trusted_wrapper_receipt["scheduler_run_id"])
        run_dir = Path(str(trusted_wrapper_receipt["scheduler_run_dir"])).resolve(strict=True)
        if run_dir.parent != JOB_MANAGER_RUN_SUMMARIES_ROOT.resolve() or run_dir.is_symlink():
            raise RuntimeError("trusted_wrapper_scheduler_run_dir_outside_job_manager_root")
    else:
        run_id, run_dir = _job_manager_allocate_run_dir()
    lease_mode = "live-preflight-only" if live_preflight_only and not execute else "execute"
    lease = _job_manager_acquire_lease(run_id, run_dir, mode=lease_mode, deadline_seconds=5 * 60 * 60)
    lease_owner_token = str(lease.get("owner_token") or "")
    run_start_path = _job_manager_write_run_start_artifact(run_dir, run_id=run_id, mode=lease_mode)
    _job_manager_write_heartbeat(run_dir, run_id=run_id, owner_token=lease_owner_token, mode=lease_mode)
    release_status = "released"
    exact_blocker = ""
    cleanup_proof = ""
    heartbeat_stop = threading.Event()
    heartbeat_thread: threading.Thread | None = None
    bridge_probe: dict[str, object] | None = None
    try:
        preflight_artifact = run_dir / "extension-first-preflight.json"
        preflight_cmd = [
            sys.executable,
            str(JOB_MANAGER_PROJECT_CWD / "scripts" / "job_applications" / "validate_job_manager_extension_first.py"),
            "--artifact",
            str(preflight_artifact),
        ]
        preflight_result = subprocess.run(
            preflight_cmd,
            check=False,
            text=True,
            capture_output=True,
            cwd=str(JOB_MANAGER_PROJECT_CWD),
        )
        if preflight_result.stdout:
            typer.echo(preflight_result.stdout)
        if preflight_result.stderr:
            typer.echo(preflight_result.stderr, err=True)
        if preflight_result.returncode != 0:
            exact_blocker = "extension_first_preflight_failed_before_submit"
            raise RuntimeError(exact_blocker)

        launch_packet, bridge_probe = _job_manager_select_bridge_context(
            launch_packet,
            trusted_wrapper_receipt=trusted_wrapper_receipt,
            codex_home=codex_home,
            run_id=run_id,
            run_dir=run_dir,
            launch_dir=launch_dir,
        )
        if not (
            bridge_probe.get("ok") is True
            and bridge_probe.get("ready") is True
            and bridge_probe.get("stage") == "job_manager_bridge_readiness_probe"
        ):
            exact_blocker = str(
                bridge_probe.get("exact_blocker")
                or bridge_probe.get("stop_reason")
                or "bridge_readiness_probe_not_passed_before_registered_child"
            )
            raise RuntimeError(exact_blocker)
        bridge_diagnostic_path = _job_manager_write_bridge_diagnostic(
            run_dir,
            run_id=run_id,
            bridge_probe=bridge_probe,
            trusted_wrapper_receipt=trusted_wrapper_receipt,
        )
        launch_packet = dict(launch_packet)
        launch_packet.update(
            {
                "run_id": run_id,
                "run_dir": str(run_dir),
                "lease_path": str(_job_manager_lease_path()),
                "run_start_artifact": str(run_start_path),
                "launch_dir": str(launch_dir),
                "registered_model": launch_model or "",
                "registered_reasoning_effort": launch_reasoning_effort,
                "auth_mode": auth_mode,
                "bridge_diagnostic_path": str(bridge_diagnostic_path),
            }
        )
        payload_path.write_text(json.dumps(launch_packet, ensure_ascii=False, indent=2), encoding="utf-8")
        _job_manager_atomic_write_json(run_dir / "launch-packet.json", launch_packet)
        typer.echo(
            json.dumps(
                {
                    "launch_packet": str(payload_path),
                    "run_dir": str(run_dir),
                    "launch_message_sha256": launch_packet["launch_message_sha256"],
                    "run_start_artifact": str(run_start_path),
                    "lease_path": str(_job_manager_lease_path()),
                },
                ensure_ascii=False,
            )
        )
        live_preflight = _job_manager_validate_live_preflight(
            run_dir=run_dir,
            run_id=run_id,
            owner_token=lease_owner_token,
            codex_home=codex_home,
            launch_dir=launch_dir,
            launch_model=launch_model or "",
            launch_reasoning_effort=launch_reasoning_effort,
            bridge_probe=bridge_probe,
            auth_mode=auth_mode,
        )
        _job_manager_atomic_write_json(run_dir / "live-preflight.json", live_preflight)
        ideal_flow_manifest = _job_manager_write_ideal_flow_manifest(
            run_dir,
            run_id=run_id,
            launch_dir=launch_dir,
            launch_model=launch_model or "",
            launch_reasoning_effort=launch_reasoning_effort,
            bridge_probe=bridge_probe or {},
            auth_mode=auth_mode,
        )
        launch_packet = dict(launch_packet)
        launch_packet["ideal_flow_manifest"] = str(ideal_flow_manifest)
        _job_manager_atomic_write_json(run_dir / "launch-packet.json", launch_packet)
        payload_path.write_text(json.dumps(launch_packet, ensure_ascii=False, indent=2), encoding="utf-8")
        if live_preflight_only:
            cleanup_proof = f"cleanup proof: live preflight only; owned_processes_remaining=[]; bridge_run_id={bridge_probe.get('bridge_run_id') if bridge_probe else ''}"
            (run_dir / "cleanup-proof.txt").write_text(cleanup_proof + "\n", encoding="utf-8")
            release_status = "preflight_complete"
            return

        if trusted_request is None:
            raise RuntimeError("registered_child_trusted_control_request_missing")
        launch_packet = _job_manager_attach_registered_child_result_contract(
            launch_packet,
            request=trusted_request,
            run_dir=run_dir,
        )
        _job_manager_atomic_write_json(run_dir / "launch-packet.json", launch_packet)
        payload_path.write_text(json.dumps(launch_packet, ensure_ascii=False, indent=2), encoding="utf-8")
        transition_control_to_running(trusted_request)
        _codex_exec_session_healthcheck(codex_home=codex_home, launch_dir=launch_dir, launch_model=launch_model or None)
        cmd = [
            "codex",
            "exec",
            "--ignore-user-config",
            "--ephemeral",
            "--sandbox",
            JOB_MANAGER_CODEX_EXEC_SANDBOX,
            "--config",
            "shell_environment_policy.inherit=all",
            "--config",
            f'model_reasoning_effort="{launch_reasoning_effort or "high"}"',
            "--skip-git-repo-check",
            "--cd",
            str(launch_dir),
        ]
        if launch_model:
            cmd.extend(["--model", launch_model])
        cmd.append(str(launch_packet["launch_message"]))
        heartbeat_stop.clear()

        def heartbeat_loop() -> None:
            while not heartbeat_stop.wait(30):
                try:
                    _job_manager_write_heartbeat(run_dir, run_id=run_id, owner_token=lease_owner_token, mode=lease_mode)
                except Exception:
                    break

        heartbeat_thread = threading.Thread(target=heartbeat_loop, name="job-manager-heartbeat", daemon=True)
        heartbeat_thread.start()
        proc = subprocess.Popen(
            cmd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=_codex_exec_registered_child_env(
                codex_home=codex_home,
                automation_id="job-application-manager",
                reasoning_effort=launch_reasoning_effort,
                current_bridge_probe=bridge_probe,
                registered_child_result_path=run_dir / "registered-child-result.json",
                control_state_pointer=Path(str(trusted_request["control_run_dir"])) / "control-state-current.json",
                scheduler_run_id=run_id,
                control_run_id=str(trusted_request["control_run_id"]),
            ),
            cwd=str(launch_dir),
            start_new_session=True,
        )
        canonical_timeout_seconds = int(
            (trusted_wrapper_receipt or {}).get("owner_timeout_seconds")
            or (trusted_request or {}).get("run_timeout_seconds")
            or 18000
        )
        deadline = time.monotonic() + canonical_timeout_seconds
        try:
            if trusted_wrapper_receipt is not None:
                stdout, stderr = _job_manager_communicate_with_owner_watchdog(
                    proc,
                    receipt=trusted_wrapper_receipt,
                    deadline=deadline,
                )
            else:
                remaining = max(1.0, deadline - time.monotonic())
                stdout, stderr = proc.communicate(timeout=remaining)
        except subprocess.TimeoutExpired:
            exact_blocker = "whole_run_deadline_exceeded"
            release_status = "blocked"
            cleanup_proof = f"cleanup proof: owned process group terminated; exact_blocker={exact_blocker}; owned_processes_remaining=[]"
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                stdout, stderr = proc.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                stdout, stderr = proc.communicate()
            (run_dir / "child-stdout-tail.txt").write_text(
                _redacted_text_tail(stdout or "", max_chars=12000) + "\n",
                encoding="utf-8",
            )
            (run_dir / "child-stderr-tail.txt").write_text(
                _redacted_text_tail(stderr or "", max_chars=12000) + "\n",
                encoding="utf-8",
            )
            if stdout:
                _echo_job_manager_output(stdout)
            if stderr:
                _echo_job_manager_output(stderr, err=True)
            raise RuntimeError(exact_blocker)
        (run_dir / "child-stdout-tail.txt").write_text(
            _redacted_text_tail(stdout or "", max_chars=12000) + "\n",
            encoding="utf-8",
        )
        (run_dir / "child-stderr-tail.txt").write_text(
            _redacted_text_tail(stderr or "", max_chars=12000) + "\n",
            encoding="utf-8",
        )
        if stdout:
            _echo_job_manager_output(stdout)
        if stderr:
            _echo_job_manager_output(stderr, err=True)
        child_result = _job_manager_evaluate_child_transport(
            returncode=int(proc.returncode or 0),
            run_dir=run_dir,
            scheduler_run_id=run_id,
            control_run_id=str(trusted_request["control_run_id"]),
        )
        _job_manager_write_terminal_state(
            run_dir=run_dir,
            run_id=run_id,
            control_run_id=str(trusted_request["control_run_id"]),
            status="completed",
            exact_blocker="",
            child_result=child_result,
        )
        release_status = "completed"
    except Exception as exc:
        if not exact_blocker:
            exact_blocker = str(exc).strip().splitlines()[0][:1000] or type(exc).__name__
        release_status = "blocked"
        _job_manager_atomic_write_json(
            run_dir / "terminal-blocker.json",
            {
                "schema": "automation_stage_observation.v1",
                "workflow": "job-applications",
                "run_id": run_id,
                "stage": "scheduler_terminal",
                "attempt_no": 1,
                "status": "blocked",
                "exact_blocker": exact_blocker,
                "artifact_uri": str(run_dir),
                "repair_loop_suppressed": True,
                "finished_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        _job_manager_write_terminal_state(
            run_dir=run_dir,
            run_id=run_id,
            control_run_id=str(trusted_request.get("control_run_id") if trusted_request else ""),
            status="blocked",
            exact_blocker=exact_blocker,
        )
        raise
    finally:
        heartbeat_stop.set()
        if heartbeat_thread is not None:
            heartbeat_thread.join(timeout=2)
        if not cleanup_proof:
            cleanup_proof = f"cleanup proof: owned_processes_remaining=[]; exact_blocker={exact_blocker or 'none'}"
        (run_dir / "cleanup-proof.txt").write_text(cleanup_proof + "\n", encoding="utf-8")
        try:
            _job_manager_release_lease(
                run_id,
                run_dir,
                owner_token=lease_owner_token,
                status=release_status,
                exact_blocker=exact_blocker,
                cleanup_proof=cleanup_proof,
            )
        except Exception as exc:
            typer.echo(f"Skipped job-manager lease release: {exc}", err=True)


@app.command("run-registered-automation-now")
def run_registered_automation_now(
    automation_id: Annotated[str, typer.Option("--automation-id", help="Registered automation id.")],
    automation_name: Annotated[str, typer.Option("--automation-name", help="Human-readable automation name.")],
    automation_toml: Annotated[Path, typer.Option("--automation-toml", exists=True, dir_okay=False, readable=True, resolve_path=True)],
    state_path: Annotated[Path, typer.Option("--state-path", exists=True, dir_okay=False, readable=True, resolve_path=True)],
    memory_path: Annotated[Path, typer.Option("--memory-path", exists=True, dir_okay=False, readable=True, resolve_path=True)],
    project_prompt_path: Annotated[Path, typer.Option("--project-prompt-path", exists=True, dir_okay=False, readable=True, resolve_path=True)],
    execute: Annotated[bool, typer.Option("--execute", help="Actually invoke codex exec with the generated launch packet.")] = False,
    live_preflight_only: Annotated[
        bool,
        typer.Option(
            "--live-preflight-only",
            help="Validate the live scheduler contract, bridge readiness, lease, and run-dir isolation, then stop before the workflow child starts.",
        ),
    ] = False,
    codex_home: Annotated[
        Path | None,
        typer.Option(
            "--codex-home",
            help="Optional CODEX_HOME override for the spawned codex exec. Use a writable alternate home if the default state db is read-only.",
        ),
    ] = None,
) -> None:
    _reject_recursive_registered_execute(execute=execute, automation_id=automation_id)
    if automation_id == "job-application-manager":
        run_job_manager_now(execute=execute, live_preflight_only=live_preflight_only, codex_home=codex_home)
        return
    automation_definition = tomllib.loads(_read_text_file(automation_toml))
    automation_reasoning_effort = str(automation_definition.get("reasoning_effort") or "").strip()
    registered_cwds = automation_definition.get("cwds") or []
    if not isinstance(registered_cwds, list) or not registered_cwds or not str(registered_cwds[0]).strip():
        raise RuntimeError(f"registered_automation_cwd_missing:{automation_id}")
    registered_cwd = Path(str(registered_cwds[0])).expanduser().resolve()
    if not registered_cwd.is_dir():
        raise RuntimeError(f"registered_automation_cwd_not_found:{registered_cwd}")
    launch_packet = _registered_automation_launch_packet(
        automation_toml_path=automation_toml,
        state_path=state_path,
        memory_path=memory_path,
        project_prompt_path=project_prompt_path,
        automation_id=automation_id,
        automation_name=automation_name,
    )
    if automation_id == "job-application-manager":
        _assert_job_manager_bridge_probe_contract(launch_packet)
    launch_path = automation_toml.parent / "run-now-launch-packet.json"
    if not execute:
        launch_path.write_text(json.dumps(launch_packet, ensure_ascii=False, indent=2), encoding="utf-8")
        typer.echo(json.dumps({"launch_packet": str(launch_path), "launch_message_sha256": launch_packet["launch_message_sha256"]}, ensure_ascii=False))
        typer.echo("Dry run only. Pass --execute to invoke codex exec with the generated launch message.")
        return

    cmd = [
        "codex",
        "exec",
        "--ignore-user-config",
        "--ephemeral",
        "--sandbox",
        JOB_MANAGER_CODEX_EXEC_SANDBOX,
        "--config",
        "shell_environment_policy.inherit=all",
        "--config",
        f'model_reasoning_effort="{automation_reasoning_effort or "medium"}"',
        "--skip-git-repo-check",
        "--cd",
        str(registered_cwd),
    ]
    automation_model = _registered_automation_model(automation_toml)
    if automation_model:
        cmd.extend(["--model", automation_model])
    bridge_probe = None
    if automation_id == "job-application-manager":
        bridge_probe = warmup_job_manager_bridge(codex_home=codex_home, launch_dir=automation_toml.parent, timeout_seconds=30)
        launch_packet = _attach_current_bridge_probe_to_launch_packet(launch_packet, bridge_probe)
        _codex_exec_session_healthcheck(
            codex_home=codex_home,
            launch_dir=automation_toml.parent,
            launch_model=automation_model or None,
        )
    launch_path.write_text(json.dumps(launch_packet, ensure_ascii=False, indent=2), encoding="utf-8")
    typer.echo(json.dumps({"launch_packet": str(launch_path), "launch_message_sha256": launch_packet["launch_message_sha256"]}, ensure_ascii=False))
    cmd.append(str(launch_packet["launch_message"]))
    result = subprocess.run(
        cmd,
        check=False,
        text=True,
        capture_output=True,
        cwd=str(registered_cwd),
        env=_codex_exec_registered_child_env(
            codex_home=codex_home,
            automation_id=automation_id,
            reasoning_effort=automation_reasoning_effort or None,
            current_bridge_probe=bridge_probe,
        ),
    )
    typer.echo(result.stdout)
    if result.stderr:
        typer.echo(result.stderr, err=True)
    if result.returncode != 0:
        raise typer.Exit(result.returncode)


@app.command("run-registered-automation-safe")
def run_registered_automation_safe(
    automation_id: Annotated[str, typer.Option("--automation-id", help="Registered automation id.")],
    execute: Annotated[bool, typer.Option("--execute", help="Actually invoke codex exec with the generated launch packet.")] = False,
    live_preflight_only: Annotated[
        bool,
        typer.Option(
            "--live-preflight-only",
            help="Validate the live scheduler contract, bridge readiness, lease, and run-dir isolation, then stop before the workflow child starts.",
        ),
    ] = False,
    registry_codex_home: Annotated[
        Path | None,
        typer.Option(
            "--registry-codex-home",
            help="Optional CODEX_HOME override used only to discover registered automations.",
        ),
    ] = None,
    codex_home: Annotated[
        Path,
        typer.Option(
            "--codex-home",
            help="Writable alternate CODEX_HOME used for the spawned codex exec.",
        ),
    ] = DEFAULT_SAFE_CODEX_HOME,
) -> None:
    _reject_recursive_registered_execute(execute=execute, automation_id=automation_id)
    automation_root = (
        Path(registry_codex_home).expanduser()
        if registry_codex_home is not None
        else Path(os.getenv("CODEX_HOME", str(DEFAULT_REGISTERED_AUTOMATIONS_ROOT.parent))).expanduser()
    )
    automation_dir = automation_root / "automations" / automation_id
    automation_toml = automation_dir / "automation.toml"
    state_path = automation_dir / "STATE.md"
    memory_path = automation_dir / "memory.md"
    if not automation_toml.exists():
        raise typer.BadParameter(f"automation_toml not found: {automation_toml}")
    if not state_path.exists():
        raise typer.BadParameter(f"state_path not found: {state_path}")
    if not memory_path.exists():
        raise typer.BadParameter(f"memory_path not found: {memory_path}")
    project_prompt_path = JOB_MANAGER_PROJECT_PROMPT if automation_id == "job-application-manager" and JOB_MANAGER_PROJECT_PROMPT.exists() else None
    if not execute:
        typer.echo(json.dumps({"automation_id": automation_id, "automation_toml": str(automation_toml), "state_path": str(state_path), "memory_path": str(memory_path), "project_prompt_path": str(project_prompt_path) if project_prompt_path is not None else "", "codex_home": str(codex_home)}, ensure_ascii=False))
    run_registered_automation_now(
        automation_id=automation_id,
        automation_name=automation_id,
        automation_toml=automation_toml,
        state_path=state_path,
        memory_path=memory_path,
        project_prompt_path=project_prompt_path or automation_toml,
        execute=execute,
        live_preflight_only=live_preflight_only,
        codex_home=codex_home,
    )


@app.command("run-scheduler-now")
def run_scheduler_now(
    automation_id: Annotated[str, typer.Option("--automation-id", help="Registered automation id.")],
    execute: Annotated[bool, typer.Option("--execute", help="Actually invoke codex exec with the generated launch packet.")] = False,
    live_preflight_only: Annotated[
        bool,
        typer.Option(
            "--live-preflight-only",
            help="Validate the live scheduler contract, bridge readiness, lease, and run-dir isolation, then stop before the workflow child starts.",
        ),
    ] = False,
    registry_codex_home: Annotated[
        Path | None,
        typer.Option(
            "--registry-codex-home",
            help="Optional CODEX_HOME override used only to discover registered automations.",
        ),
    ] = None,
    codex_home: Annotated[
        Path,
        typer.Option(
            "--codex-home",
            help="Writable alternate CODEX_HOME used for the spawned codex exec.",
        ),
    ] = DEFAULT_SAFE_CODEX_HOME,
) -> None:
    _reject_recursive_registered_execute(execute=execute, automation_id=automation_id)
    run_codex_automation(
        automation_id=automation_id,
        stage="execute" if execute else ("preflight" if live_preflight_only else "dry-run"),
        request_path=None,
        control_run_id=None,
        registry_codex_home=registry_codex_home,
        codex_home=codex_home,
    )


@app.command("run-codex-automation")
def run_codex_automation(
    automation_id: Annotated[str, typer.Option("--automation-id", help="Registered automation id.")],
    stage: Annotated[
        str,
        typer.Option(
            "--stage",
            help="Control stage: dry-run, preflight, or execute.",
        ),
    ] = "dry-run",
    request_path: Annotated[
        Path | None,
        typer.Option(
            "--request-path",
            help="Existing scheduler_control_request.v2 path supplied by the trusted Chrome wrapper.",
        ),
    ] = None,
    control_run_id: Annotated[
        str | None,
        typer.Option(
            "--control-run-id",
            help="Optional control run id assertion for an existing request.",
        ),
    ] = None,
    registry_codex_home: Annotated[
        Path | None,
        typer.Option(
            "--registry-codex-home",
            help="Optional CODEX_HOME override used only to discover registered automations.",
        ),
    ] = None,
    codex_home: Annotated[
        Path,
        typer.Option(
            "--codex-home",
            help="Writable alternate CODEX_HOME used for the spawned codex exec.",
        ),
    ] = DEFAULT_SAFE_CODEX_HOME,
) -> None:
    if stage not in {"dry-run", "preflight", "execute"}:
        raise typer.BadParameter(f"scheduler_control_stage_invalid:{stage}")
    _reject_recursive_registered_execute(execute=stage == "execute", automation_id=automation_id)

    automation_root = (
        Path(registry_codex_home).expanduser() / "automations"
        if registry_codex_home is not None
        else SCHEDULER_AUTOMATIONS_ROOT
    )
    if stage == "dry-run":
        if request_path is not None or control_run_id is not None:
            raise typer.BadParameter("dry_run_does_not_accept_control_request")
        run_registered_automation_safe(
            automation_id=automation_id,
            execute=False,
            live_preflight_only=False,
            registry_codex_home=registry_codex_home,
            codex_home=codex_home,
        )
        return

    request: dict[str, object]
    if request_path is None:
        prepared = prepare_control_run(
            automation_id=automation_id,
            stage=stage,
            automations_root=automation_root,
            control_root=automation_root / "_shared" / "control-runs",
            capability_registry=automation_root / "_shared" / "scheduler-control.toml",
            db_path=(automation_root.parent / "sqlite" / "codex-dev.db"),
        )
        request_path = prepared.request_path
        request = prepared.request
    else:
        request_path = request_path.expanduser().resolve()
        request = load_control_request(
            request_path,
            control_root=automation_root / "_shared" / "control-runs",
        )

    request = validate_control_request_registration(
        request_path=request_path,
        automation_id=automation_id,
        stage=stage,
        automations_root=automation_root,
        capability_registry=automation_root / "_shared" / "scheduler-control.toml",
        db_path=automation_root.parent / "sqlite" / "codex-dev.db",
    )

    expected_run_id = str(request.get("control_run_id") or "")
    if str(request.get("automation_id") or "") != automation_id or str(request.get("stage") or "") != stage:
        exact_blocker = "scheduler_control_request_target_mismatch"
        write_control_blocker(request, exact_blocker)
        write_control_cleanup(request, status="blocked", exact_blocker=exact_blocker)
        raise RuntimeError(exact_blocker)
    if control_run_id is not None and control_run_id != expected_run_id:
        exact_blocker = (
            f"scheduler_control_run_id_mismatch:expected={expected_run_id}:actual={control_run_id}"
        )
        write_control_blocker(request, exact_blocker)
        write_control_cleanup(request, status="blocked", exact_blocker=exact_blocker)
        raise RuntimeError(exact_blocker)

    browser_required = request.get("browser_required") is True
    if browser_required and os.environ.get("SOCIAL_FLOW_TRUSTED_BROWSER_WRAPPER_V2") != "1":
        exact_blocker = f"trusted_browser_wrapper_required_for_current_run:request={request_path}"
        blocker_path = write_control_blocker(request, exact_blocker)
        cleanup_path = write_control_cleanup(request, status="blocked", exact_blocker=exact_blocker)
        typer.echo(
            json.dumps(
                {
                    "ok": False,
                    "automation_id": automation_id,
                    "stage": stage,
                    "control_run_id": expected_run_id,
                    "request_path": str(request_path),
                    "trusted_wrapper": "runRegisteredAutomationWithTrustedBridge",
                    "terminal_blocker": str(blocker_path),
                    "cleanup_proof": str(cleanup_path),
                    "exact_blocker": exact_blocker,
                },
                ensure_ascii=False,
            )
        )
        raise RuntimeError(exact_blocker)

    try:
        if browser_required or os.environ.get("SOCIAL_FLOW_TRUSTED_BROWSER_WRAPPER_V2") == "1":
            validate_trusted_wrapper_env(
                request_path=request_path,
                automation_id=automation_id,
                stage=stage,
                automations_root=automation_root,
                capability_registry=automation_root / "_shared" / "scheduler-control.toml",
                db_path=automation_root.parent / "sqlite" / "codex-dev.db",
            )
        if stage == "execute":
            claim_control_execution(request)
        run_registered_automation_safe(
            automation_id=automation_id,
            execute=stage == "execute",
            live_preflight_only=stage == "preflight",
            registry_codex_home=registry_codex_home,
            codex_home=codex_home,
        )
    except BaseException as exc:
        exact_blocker = str(exc).strip().splitlines()[0][:1000] or type(exc).__name__
        finalize_control_state(request, status="blocked", exact_blocker=exact_blocker)
        write_control_blocker(request, exact_blocker)
        write_control_cleanup(request, status="blocked", exact_blocker=exact_blocker)
        raise
    final_status = "preflight_complete" if stage == "preflight" else "completed"
    finalize_control_state(request, status=final_status)
    write_control_cleanup(
        request,
        status=final_status,
    )
    typer.echo(
        json.dumps(
            {
                "ok": True,
                "automation_id": automation_id,
                "stage": stage,
                "control_run_id": expected_run_id,
                "request_path": str(request_path),
            },
            ensure_ascii=False,
        )
    )


@app.command("warmup-job-manager-bridge")
def warmup_job_manager_bridge(
    codex_home: Annotated[
        Path | None,
        typer.Option(
            "--codex-home",
            help="Optional CODEX_HOME override used for the bridge probe.",
        ),
    ] = None,
    launch_dir: Annotated[
        Path | None,
        typer.Option(
            "--launch-dir",
            help="Optional launch directory for the bridge probe.",
        ),
    ] = None,
    artifact_dir: Annotated[
        Path | None,
        typer.Option(
            "--artifact-dir",
            help="Optional directory for probe artifacts.",
        ),
    ] = None,
    run_id: Annotated[
        str | None,
        typer.Option(
            "--run-id",
            help="Optional run id for the probe artifact.",
        ),
    ] = None,
    scheduler_run_id: Annotated[
        str | None,
        typer.Option(
            "--scheduler-run-id",
            help="Optional scheduler run id to bind into the probe receipt.",
        ),
    ] = None,
    scheduler_run_dir: Annotated[
        Path | None,
        typer.Option(
            "--scheduler-run-dir",
            help="Optional immutable scheduler run directory to bind into the probe receipt.",
        ),
    ] = None,
    timeout_seconds: Annotated[
        int,
        typer.Option(
            "--timeout-seconds",
            min=30,
            help="Max time to wait for the bridge probe.",
        ),
    ] = 180,
) -> dict[str, object]:
    codex_turn_metadata = _job_manager_current_codex_turn_metadata()
    daemon_artifact_dir = artifact_dir or (JOB_MANAGER_PROJECT_CWD / "artifacts" / "job-manager-bridge-readiness-probe")
    if os.environ.get("CODEX_SHELL") == "1" and os.environ.get("PYTEST_CURRENT_TEST") is None:
        request_path_text = str(os.environ.get("SOCIAL_FLOW_CONTROL_REQUEST_PATH") or "").strip()
        control_stage = str(os.environ.get("SOCIAL_FLOW_CONTROL_STAGE") or "").strip()
        try:
            if not request_path_text or not control_stage:
                raise SchedulerControlError("trusted_browser_wrapper_required_for_current_run")
            validate_trusted_wrapper_env(
                request_path=Path(request_path_text),
                automation_id="job-application-manager",
                stage=control_stage,
            )
        except Exception as error:
            cause = str(error).strip() or type(error).__name__
            exact_blocker = (
                cause
                if cause.startswith("trusted_browser_wrapper_required_for_current_run")
                else f"trusted_browser_wrapper_invalid_for_current_run:{cause}"
            )
            try:
                _job_manager_write_bridge_daemon_artifact(
                    daemon_artifact_dir,
                    None,
                    exact_blocker=exact_blocker,
                )
            except Exception:
                pass
            raise RuntimeError(exact_blocker) from error
    try:
        payload = _run_job_manager_bridge_probe(
            codex_home=codex_home,
            artifact_dir=artifact_dir,
            run_id=run_id,
            launch_dir=launch_dir,
            scheduler_run_id=scheduler_run_id,
            scheduler_run_dir=scheduler_run_dir,
            timeout_seconds=timeout_seconds,
            codex_turn_metadata=codex_turn_metadata,
        )
        exact_blocker = _job_manager_bridge_probe_exact_blocker(payload)
        if exact_blocker:
            raise RuntimeError(exact_blocker)
        if os.environ.get("SOCIAL_FLOW_TRUSTED_BROWSER_WRAPPER_V2") == "1":
            validate_bridge_receipt_v2(payload)
        daemon_info = _job_manager_bridge_daemon_artifact(payload)
        _job_manager_write_bridge_daemon_artifact(daemon_artifact_dir, payload)
    except Exception as error:
        exact_blocker = str(error).strip() or "trusted_runner_bridge_unavailable_before_probe_artifact"
        try:
            _job_manager_write_bridge_daemon_artifact(daemon_artifact_dir, None, exact_blocker=exact_blocker)
        except Exception:
            pass
        raise
    typer.echo(json.dumps(daemon_info, ensure_ascii=False, indent=2))
    typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))
    return payload


def _registered_automation_dirs(codex_home: Path | None = None) -> list[Path]:
    root = Path(codex_home).expanduser() / "automations" if codex_home is not None else DEFAULT_REGISTERED_AUTOMATIONS_ROOT
    if not root.exists():
        return []
    return sorted(path for path in root.iterdir() if path.is_dir() and (path / "automation.toml").exists())


def _job_manager_bridge_daemon_artifact(payload: dict[str, object] | None, *, exact_blocker: str = "") -> dict[str, object]:
    payload = payload if isinstance(payload, dict) else {}
    is_success = exact_blocker == ""
    daemon_info: dict[str, object] = {
        "ok": is_success,
        "ready": is_success,
        "stage": "job_manager_bridge_readiness_probe" if is_success else "job_manager_bridge_readiness_probe_failed",
        "health_ok": is_success,
        "probe_ok": is_success,
        "exact_blocker": exact_blocker,
    }
    for key in ("bridge_run_id", "bridge_receipt_path", "scheduler_run_id", "scheduler_run_dir", "launch_dir"):
        value = payload.get(key)
        if value is not None:
            daemon_info[key] = value
    backend = payload.get("backend")
    if backend is not None:
        daemon_info["backend"] = backend
    browser_metadata = payload.get("browser_metadata")
    if isinstance(browser_metadata, dict):
        daemon_info["browser_metadata"] = browser_metadata
    for key in ("browser_id", "browser_name", "browser_type"):
        value = payload.get(key)
        if value is not None:
            daemon_info[key] = value
    return daemon_info


def _job_manager_write_bridge_daemon_artifact(
    artifact_dir: Path,
    payload: dict[str, object] | None,
    *,
    exact_blocker: str = "",
) -> Path:
    return _job_manager_atomic_write_json(
        artifact_dir / "bridge-daemon.json",
        _job_manager_bridge_daemon_artifact(payload, exact_blocker=exact_blocker),
    )


@app.command("list-registered-automations")
def list_registered_automations(
    codex_home: Annotated[
        Path | None,
        typer.Option(
            "--codex-home",
            help="Optional CODEX_HOME override used to locate registered automations.",
        ),
    ] = None,
) -> None:
    automation_dirs = _registered_automation_dirs(codex_home)
    payload = [
        {
            "automation_id": path.name,
            "automation_toml": str(path / "automation.toml"),
            "state_path": str(path / "STATE.md"),
            "memory_path": str(path / "memory.md"),
        }
        for path in automation_dirs
    ]
    typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))


@app.command("run-registered-automations-loop")
def run_registered_automations_loop(
    execute: Annotated[bool, typer.Option("--execute", help="Actually invoke codex exec for each registered automation.")] = False,
    registry_codex_home: Annotated[
        Path | None,
        typer.Option(
            "--registry-codex-home",
            help="Optional CODEX_HOME override used only to discover registered automations.",
        ),
    ] = None,
    codex_home: Annotated[
        Path,
        typer.Option(
            "--codex-home",
            help="Writable alternate CODEX_HOME used for spawned codex exec processes.",
        ),
    ] = DEFAULT_SAFE_CODEX_HOME,
    stop_on_failure: Annotated[bool, typer.Option("--stop-on-failure/--continue-on-failure", help="Stop at the first failure instead of continuing to the next automation.")] = False,
) -> None:
    _reject_recursive_registered_execute(execute=execute, automation_id="registered-automation-loop")
    automation_dirs = _registered_automation_dirs(registry_codex_home)
    results: list[dict[str, object]] = []
    for automation_dir in automation_dirs:
        automation_id = automation_dir.name
        try:
            automation_status = str(
                tomllib.loads((automation_dir / "automation.toml").read_text(encoding="utf-8")).get("status") or ""
            ).strip().upper()
        except Exception as exc:
            results.append(
                {
                    "automation_id": automation_id,
                    "status": "error",
                    "error": f"automation_toml_invalid:{exc}",
                }
            )
            typer.echo(json.dumps(results[-1], ensure_ascii=False))
            if stop_on_failure:
                raise
            continue
        if automation_status != "ACTIVE":
            results.append(
                {
                    "automation_id": automation_id,
                    "status": "skipped",
                    "reason": f"automation_not_active:status={automation_status or 'missing'}",
                }
            )
            typer.echo(json.dumps(results[-1], ensure_ascii=False))
            continue
        state_path = automation_dir / "STATE.md"
        memory_path = automation_dir / "memory.md"
        if not state_path.exists() or not memory_path.exists():
            results.append(
                {
                    "automation_id": automation_id,
                    "status": "skipped",
                    "error": f"missing metadata: {', '.join(str(path) for path in [state_path, memory_path] if not path.exists())}",
                }
            )
            typer.echo(json.dumps(results[-1], ensure_ascii=False))
            continue
        try:
            run_registered_automation_safe(
                automation_id=automation_id,
                execute=execute,
                registry_codex_home=registry_codex_home,
                codex_home=codex_home,
            )
            results.append({"automation_id": automation_id, "status": "ok"})
        except Exception as exc:
            results.append({"automation_id": automation_id, "status": "error", "error": str(exc)})
            typer.echo(json.dumps(results[-1], ensure_ascii=False))
            if stop_on_failure:
                raise
    typer.echo(json.dumps({"count": len(results), "results": results}, ensure_ascii=False, indent=2))
    failed = [item for item in results if item.get("status") == "error"]
    if failed:
        raise RuntimeError(f"registered_automation_loop_completed_with_errors:{len(failed)}")


@app.command("run-scheduler-loop")
def run_scheduler_loop(
    execute: Annotated[bool, typer.Option("--execute", help="Actually invoke codex exec for each registered automation.")] = False,
    registry_codex_home: Annotated[
        Path | None,
        typer.Option(
            "--registry-codex-home",
            help="Optional CODEX_HOME override used only to discover registered automations.",
        ),
    ] = None,
    codex_home: Annotated[
        Path,
        typer.Option(
            "--codex-home",
            help="Writable alternate CODEX_HOME used for spawned codex exec processes.",
        ),
    ] = DEFAULT_SAFE_CODEX_HOME,
    stop_on_failure: Annotated[bool, typer.Option("--stop-on-failure/--continue-on-failure", help="Stop at the first failure instead of continuing to the next automation.")] = False,
) -> None:
    _reject_recursive_registered_execute(execute=execute, automation_id="scheduler-loop")
    run_registered_automations_loop(
        execute=execute,
        registry_codex_home=registry_codex_home,
        codex_home=codex_home,
        stop_on_failure=stop_on_failure,
    )


@app.command("prepare-publish-candidates-local")
def prepare_publish_candidates_local(
    path: str = "posting_queue.tsv",
    sync_sheets: bool = True,
    max_publish_items: int = 3,
) -> None:
    repo = get_local_repo(path)
    repo.bootstrap()
    rows = repo.read_all()
    no_repost_normalized = _normalize_no_repost_pending_rows(rows)
    if no_repost_normalized:
        _persist_queue_rows(repo, rows)
        rows = repo.read_all()
    surface_blocked = _hold_surface_blocked_publish_rows(rows)
    if surface_blocked:
        _persist_queue_rows(repo, rows)
        rows = repo.read_all()

    publish_candidates = _publish_flow_candidates(rows, max_publish_items)
    for row in publish_candidates:
        if row.status != "partially_published" and _is_partial_publish_resume_row(row):
            row.status = "partially_published"
        existing_notes = [part.strip() for part in row.review_notes.split("|") if part.strip()]
        existing_notes = [
            part for part in existing_notes if part != "Daily AI Browser Use-native publish candidate"
        ]
        if "Daily AI Chrome plugin publish candidate" not in existing_notes:
            existing_notes.append("Daily AI Chrome plugin publish candidate")
        row.review_notes = " | ".join(existing_notes)
        row.next_action = _chrome_profile_publish_next_action(row)
    if publish_candidates:
        _persist_queue_rows(repo, rows)

    sheets_synced = 0
    if sync_sheets:
        try:
            sheets_synced = _sync_local_queue_to_sheets(repo, get_repo())
        except Exception as exc:
            typer.echo(f"Skipped Google Sheets mirror sync: {exc}")

    stop_reason = "" if publish_candidates else "no_publish_candidates_after_queue_only_prep"
    if surface_blocked:
        _append_local_run_summary(
            run_at=utc_now(),
            researched_count=0,
            refreshed_count=surface_blocked,
            selected_count=0,
            posted_count=0,
            sheets_synced_count=sheets_synced,
            stop_reason="surface_blocked_before_queue_only_publish_prep",
            path=path,
            ship_now_buffer_count=_ship_now_buffer_count(repo.read_all()),
            usable_publish_candidate_count=len(publish_candidates),
        )
    typer.echo(
        json.dumps(
            {
                "prepared": len(publish_candidates),
                "candidate_ids": [row.id for row in publish_candidates],
                "surface_blocked": surface_blocked,
                "no_repost_normalized": no_repost_normalized,
                "sheets_synced": sheets_synced,
                "stop_reason": stop_reason,
            },
            ensure_ascii=False,
        )
    )


@app.command("check-ship-now-buffer-local")
def check_ship_now_buffer_local(
    path: str = "posting_queue.tsv",
    max_publish_items: int = 3,
) -> None:
    repo = get_local_repo(path)
    repo.bootstrap()
    rows = repo.read_all()
    publish_candidates = _publish_flow_candidates(rows, max_publish_items)
    typer.echo(
        json.dumps(
            {
                "ship_now_buffer_count": _ship_now_buffer_count(rows),
                "usable_publish_candidate_count": len(publish_candidates),
                "candidate_ids": [row.id for row in publish_candidates],
            },
            ensure_ascii=False,
        )
    )


@app.command("replenish-ship-now-buffer-local")
def replenish_ship_now_buffer_local(
    path: str = "posting_queue.tsv",
    sync_sheets: bool = True,
    target_buffer: int = 3,
    max_publish_items: int = 3,
    repair_discovery_context: bool = True,
    repair_generated_media: bool = False,
) -> None:
    repo = get_local_repo(path)
    repo.bootstrap()
    run_at = utc_now()
    rows = repo.read_all()
    repair_blockers: list[str] = []
    result = _replenish_ship_now_buffer_from_existing_queue(
        rows,
        target_buffer=target_buffer,
        max_publish_items=max_publish_items,
        repair_discovery_context=repair_discovery_context,
        settings=load_settings() if repair_generated_media else None,
        repair_blockers=repair_blockers,
    )
    _persist_queue_rows(repo, rows)

    sheets_synced = 0
    stop_reason = str(result["stop_reason"])
    for blocker in _dedupe_run_level_image_generation_blockers(repair_blockers):
        stop_reason = f"{stop_reason}; {blocker}" if stop_reason else blocker
    if sync_sheets:
        try:
            sheets_synced = _sync_local_queue_to_sheets(repo, get_repo())
        except Exception as exc:
            sync_stop_reason = f"sync_failed: {exc}"
            stop_reason = f"{stop_reason}; {sync_stop_reason}" if stop_reason else sync_stop_reason
            typer.echo(f"Skipped Google Sheets mirror sync: {exc}")

    local_summary_path = _append_local_run_summary(
        run_at=run_at,
        researched_count=0,
        refreshed_count=int(result["refreshed_count"]),
        selected_count=int(result["usable_publish_candidate_count"]),
        posted_count=0,
        sheets_synced_count=sheets_synced,
        stop_reason=stop_reason,
        path=path,
        ship_now_buffer_count=int(result["ship_now_buffer_count"]),
        ship_now_buffer_refreshed_count=int(result["buffer_marked"]),
        usable_publish_candidate_count=int(result["usable_publish_candidate_count"]),
    )
    output = dict(result)
    output["sheets_synced"] = sheets_synced
    output["local_summary_path"] = str(local_summary_path)
    output["stop_reason"] = stop_reason
    typer.echo(json.dumps(output, ensure_ascii=False))


@app.command("publish-linkedin-text-url-fallback-local")
def publish_linkedin_text_url_fallback_local(
    row_id: Annotated[str, typer.Option("--row-id", help="Local queue row id to publish on LinkedIn.")],
    path: str = "posting_queue.tsv",
    remote_debugging_port: int = 9333,
    sync_sheets: bool = True,
    timeout_seconds: float = 20.0,
    json_output: Annotated[bool, typer.Option("--json", help="Emit JSON for automation wrappers.")] = False,
) -> None:
    raise typer.BadParameter(
        "publish-linkedin-text-url-fallback-local is legacy Playwright/CDP diagnosis only after the Chrome plugin registered route became primary. "
        "Use the Chrome plugin registered runner with recording and local proof gates for Daily AI LinkedIn publish."
    )
    repo = get_local_repo(path)
    row = repo.get(row_id)
    if row is None:
        raise typer.BadParameter(f"queue_row_not_found:{row_id}")
    if row.linkedin_post_url.strip() or row.linkedin_post_id.strip():
        result = {
            "published": 0,
            "skipped": 0,
            "already_published": True,
            "post_url": row.linkedin_post_url.strip(),
            "post_id": row.linkedin_post_id.strip(),
        }
        typer.echo(json.dumps(result, ensure_ascii=False) if json_output else str(result))
        return
    if not row.linkedin_text.strip():
        raise typer.BadParameter(f"linkedin_text_missing:{row_id}")

    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright

    result: dict[str, object] = {
        "id": row.id,
        "platform": "linkedin",
        "surface": "LinkedIn本文+URL no-api fallback",
        "backend": "daily_ai_chrome_plugin_text_url_fallback",
        "published": 0,
        "skipped": 0,
        "post_url": "",
        "completion": "",
        "error": "",
    }
    try:
        if _wait_for_chrome_cdp(remote_debugging_port, timeout_seconds=min(timeout_seconds, 3.0)) is None:
            raise RuntimeError(f"local_automation_profile_unavailable: cdp_endpoint_unavailable:{remote_debugging_port}")
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{remote_debugging_port}")
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            page = context.new_page()
            try:
                post_url = _publish_linkedin_text_url_no_media_local(
                    page, row, timeout_seconds=timeout_seconds
                )
            finally:
                try:
                    page.close()
                except Exception:
                    pass
                try:
                    browser.close()
                except Exception:
                    pass
        _append_review_note(
            row,
            f"{utc_now()}: linkedin_no_api_text_url_fallback: Runway MCP generated media unavailable in explicit diagnostic fallback; posted LinkedIn body plus source URL after account/body/submit/completion gates.",
        )
        _mark_platform_published(row, "linkedin", post_url)
        repo.update(row)
        sheets_synced = _sync_local_queue_to_sheets_bounded(path) if sync_sheets else 0
        result.update(
            {
                "published": 1,
                "post_url": post_url,
                "post_id": extract_linkedin_post_id(post_url),
                "completion": "daily_ai_chrome_plugin_linkedin_text_url_captured",
                "sheets_synced": sheets_synced,
            }
        )
    except PlaywrightError as exc:
        result["skipped"] = 1
        result["error"] = (
            "local_automation_profile_unavailable: locator_control_failed "
            f"{type(exc).__name__}: {' '.join(str(exc).split())[:300]}"
        )
    except Exception as exc:
        result["skipped"] = 1
        result["error"] = " ".join(str(exc).split())[:500]
    typer.echo(json.dumps(result, ensure_ascii=False) if json_output else str(result))


@app.command("computer-browse")
def computer_browse(
    task: str,
    start_url: str,
    headless: bool = True,
    max_turns: int = 12,
    width: int = 1280,
    height: int = 800,
    slow_mo_ms: int = 0,
    wait_after_action_seconds: float = 1.0,
    acknowledge_safety_checks: bool = False,
    output_dir: str | None = None,
    model: str | None = None,
) -> None:
    config = BrowserComputerConfig(
        model=model or load_computer_use_model(),
        display_width=width,
        display_height=height,
        headless=headless,
        slow_mo_ms=slow_mo_ms,
        max_turns=max_turns,
        wait_after_action_seconds=wait_after_action_seconds,
        acknowledge_safety_checks=acknowledge_safety_checks,
    )
    result = run_browser_computer_task(
        task=task,
        start_url=start_url,
        config=config,
        output_dir=output_dir,
    )
    typer.echo(f"Response ID: {result['response_id']}")
    if result["final_text"]:
        typer.echo(result["final_text"])
    else:
        typer.echo("Completed without final text output.")


if __name__ == "__main__":
    app()
