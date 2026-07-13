from __future__ import annotations

from dataclasses import dataclass
from html import escape
import json
from pathlib import Path
import re
import subprocess
import time
from typing import Literal
from urllib.parse import quote

from playwright.sync_api import BrowserContext, Locator, Page, TimeoutError as PlaywrightTimeoutError, sync_playwright


X_COMPOSE_URL = "https://x.com/compose/post"
LINKEDIN_COMPOSE_URL = "https://www.linkedin.com/feed/?shareActive=true"
X_EDITOR_CANDIDATE_SELECTORS = (
    'div[data-testid="tweetTextarea_0"][role="textbox"]',
    'div[role="textbox"][data-testid="tweetTextarea_0"]',
    '[data-testid="tweetTextarea_0"] div[role="textbox"]',
    '[data-testid="tweetTextarea_0"][contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"][data-testid]',
    'div[contenteditable="true"][aria-label*="Post text"]',
    'div[contenteditable="true"][aria-label*="What is happening"]',
    'div[contenteditable="true"][aria-label*="いまどうしてる"]',
    'div[contenteditable="true"][aria-multiline="true"]',
    'div[role="textbox"][contenteditable="true"]',
)
LINKEDIN_EDITOR_CANDIDATE_SELECTORS = (
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label*="Text editor"]',
    '[contenteditable="true"][aria-label*="テキストエディタ"]',
    '[contenteditable="true"][aria-label*="投稿"]',
    'div.ql-editor[contenteditable="true"]',
)
LINKEDIN_COMPOSE_ENTRY_LABELS = ("Start a post", "投稿を開始")
LINKEDIN_POST_BUTTON_LABELS = ("Post", "投稿")
LINKEDIN_VIEW_POST_LABELS = ("View post", "投稿を表示")


@dataclass(frozen=True)
class ChromeLaunchConfig:
    executable_path: str
    user_data_dir: str
    profile_directory: str
    headless: bool = False
    profile_label: str = ""


@dataclass(frozen=True)
class ChromePublishResult:
    platform: Literal["x", "linkedin"]
    ok: bool
    post_url: str = ""
    post_id: str = ""
    published_at: str = ""
    error: str = ""
    mode: str = ""


class ChromePublisher:
    def __init__(self, config: ChromeLaunchConfig) -> None:
        self._config = config
        self._last_live_error = ""

    def publish_linkedin(self, text: str, *, dry_run: bool = False, artifact_dir: str | None = None) -> ChromePublishResult:
        if not text.strip():
            return ChromePublishResult(platform="linkedin", ok=False, error="linkedin_text is empty.", mode="validation")
        return ChromePublishResult(
            platform="linkedin",
            ok=False,
            error=(
                "Legacy foreground Chrome publishing is disabled in Soy-safe mode. "
                "Use the Chrome plugin registered runner with the authenticated browser lane and tab-scoped DOM control. "
                "Do not fall back to Playwright, Browser Use, Chrome Extension/Profile 2, or Codex in-app Browser Use unless explicitly requested."
            ),
            mode="browser_use_lane_required",
        )

    def publish_x(self, text: str, *, dry_run: bool = False, expected_handle: str = "") -> ChromePublishResult:
        if not text.strip():
            return ChromePublishResult(platform="x", ok=False, error="x_text is empty.", mode="validation")
        return ChromePublishResult(
            platform="x",
            ok=False,
            error=(
                "Legacy foreground Chrome publishing is disabled in Soy-safe mode. "
                "Use the Chrome plugin registered runner with the authenticated browser lane and tab-scoped DOM control. "
                "Do not fall back to Playwright, Browser Use, Chrome Extension/Profile 2, or Codex in-app Browser Use unless explicitly requested."
            ),
            mode="browser_use_lane_required",
        )

    def fetch_x_metrics(self, post_url: str) -> dict[str, str]:
        raise RuntimeError(
            "Legacy foreground Chrome metrics capture is disabled in Soy-safe mode. "
            "Use the Chrome plugin registered runner with the authenticated browser lane and tab-scoped readback or API metrics. "
            "Do not fall back to Playwright, Browser Use, Chrome Extension/Profile 2, or Codex in-app Browser Use unless explicitly requested."
        )

    def fetch_linkedin_metrics(self, post_url: str) -> dict[str, str]:
        raise RuntimeError(
            "Legacy foreground Chrome metrics capture is disabled in Soy-safe mode. "
            "Use the Chrome plugin registered runner with the authenticated browser lane and tab-scoped readback or API metrics. "
            "Do not fall back to Playwright, Browser Use, Chrome Extension/Profile 2, or Codex in-app Browser Use unless explicitly requested."
        )

    def _try_publish_linkedin_via_live_chrome_tab(
        self,
        text: str,
        *,
        dry_run: bool,
    ) -> ChromePublishResult | None:
        if not _command_exists("osascript"):
            self._last_live_error = "osascript is not available on this Mac."
            return None

        try:
            self._prime_live_chrome_window(LINKEDIN_COMPOSE_URL)
            window_index, tab_index = self._activate_linkedin_compose_tab(_build_linkedin_compose_seed(text))
            injection = self._wait_for_linkedin_compose_state(window_index, tab_index)
            if not injection.get("ok"):
                if injection.get("composeEntryVisible") and (
                    self._open_linkedin_compose_with_javascript_click(window_index, tab_index)
                    or self._open_linkedin_compose_with_real_click(window_index, tab_index)
                ):
                    time.sleep(2.0)
                    injection = self._wait_for_linkedin_compose_state(window_index, tab_index)
                if injection.get("reason") == "editor_not_found":
                    injection = self._run_chrome_javascript(
                        _build_linkedin_editor_injection_javascript(text),
                        window_index=window_index,
                        tab_index=tab_index,
                    )
                    time.sleep(1.0)
                    injection = self._wait_for_linkedin_compose_state(window_index, tab_index)
            elif injection.get("editorText", "").strip() != text.strip():
                injection = self._run_chrome_javascript(
                    _build_linkedin_editor_injection_javascript(text),
                    window_index=window_index,
                    tab_index=tab_index,
                )
                time.sleep(1.0)
                injection = self._wait_for_linkedin_compose_state(window_index, tab_index)
            if not injection.get("ok"):
                self._last_live_error = _format_live_chrome_error(
                    f"Live Chrome editor injection failed: {injection.get('reason', 'unknown_reason')}.",
                )
                return None
            if not injection.get("postEnabled"):
                if self._focus_linkedin_editor_with_real_click(window_index, tab_index) and self._paste_text_into_focused_field(text):
                    time.sleep(1.0)
                    injection = self._run_chrome_javascript(
                        _build_linkedin_post_state_javascript(),
                        window_index=window_index,
                        tab_index=tab_index,
                    )
                if not injection.get("ok"):
                    self._last_live_error = _format_live_chrome_error(
                        f"Live Chrome editor injection failed after real input: {injection.get('reason', 'unknown_reason')}.",
                    )
                    return None
            if not injection.get("postEnabled"):
                self._last_live_error = _format_live_chrome_error(
                    "Live Chrome injection ran, but LinkedIn Post button stayed disabled.",
                )
                return None

            if dry_run:
                return ChromePublishResult(platform="linkedin", ok=True, mode="chrome_live_dry_run")

            submit = self._run_chrome_javascript(
                _build_linkedin_post_submit_javascript(),
                window_index=window_index,
                tab_index=tab_index,
            )
            if not submit.get("clicked"):
                if self._click_linkedin_post_with_real_click(window_index, tab_index):
                    submit = {"clicked": True}
                else:
                    self._last_live_error = _format_live_chrome_error(
                        "Live Chrome found the LinkedIn Post button, but could not click it.",
                    )
                    return None

            time.sleep(4.0)
            capture = self._run_chrome_javascript(
                _build_linkedin_post_capture_javascript(),
                window_index=window_index,
                tab_index=tab_index,
            )
            if not capture.get("postUrl"):
                return ChromePublishResult(
                    platform="linkedin",
                    ok=False,
                    error=(
                        "LinkedIn post may have been submitted, but the resulting URL could not be captured. "
                        "Do not repost; verify the live automation profile post URL before marking this row published."
                    ),
                    mode="chrome_live_url_pending",
                )
            return ChromePublishResult(
                platform="linkedin",
                ok=True,
                post_url=str(capture.get("postUrl", "") or ""),
                mode="chrome_live",
            )
        except subprocess.CalledProcessError as exc:
            details = (exc.stderr or exc.stdout or str(exc)).strip()
            self._last_live_error = _format_live_chrome_error(details)
            return None
        except Exception as exc:
            self._last_live_error = _format_live_chrome_error(str(exc))
            return None

    def _try_publish_x_via_live_chrome_tab(
        self,
        text: str,
        *,
        dry_run: bool,
        expected_handle: str = "",
    ) -> ChromePublishResult | None:
        if not _command_exists("osascript"):
            self._last_live_error = "osascript is not available on this Mac."
            return None

        snippet = " ".join(text.split())[:80]
        try:
            self._prime_live_chrome_window(X_COMPOSE_URL)
            self._run_osascript(_build_activate_x_compose_applescript(self._config.profile_label))
            time.sleep(2.0)
            injection: dict[str, object] = {}
            for attempt in range(4):
                injection = self._run_chrome_javascript(_build_x_editor_injection_javascript(text))
                if injection.get("ok"):
                    break
                if injection.get("reason") != "editor_not_found":
                    break
                time.sleep(1.5 + attempt)
            if not injection.get("ok"):
                reason = str(injection.get("reason", "unknown_reason") or "unknown_reason")
                current_url = str(injection.get("currentUrl", "") or "")
                if reason == "login_required":
                    self._last_live_error = (
                        "Live Chrome X path failed: X in the automation profile is not logged in. "
                        f"Current URL: {current_url or 'unknown'}"
                    )
                else:
                    self._last_live_error = f"Live Chrome X editor injection failed: {reason}."
                return None
            actual_handle = str(injection.get("handle", "") or "").lstrip("@")
            if expected_handle and not actual_handle:
                return ChromePublishResult(
                    platform="x",
                    ok=False,
                    error=(
                        f"X account could not be verified before posting: expected @{expected_handle}, "
                        "but the active handle was not visible. Do not repost until the live automation profile "
                        "X account is confirmed."
                    ),
                    mode="chrome_live_account_unverified",
                )
            if expected_handle and actual_handle and actual_handle.lower() != expected_handle.lstrip("@").lower():
                return ChromePublishResult(
                    platform="x",
                    ok=False,
                    error=f"X account mismatch before posting: expected @{expected_handle}, got @{actual_handle}.",
                    mode="chrome_live_account_mismatch",
                )
            if not injection.get("postEnabled"):
                if self._focus_x_editor_with_real_click() and self._paste_text_into_focused_field(text):
                    time.sleep(1.0)
                    injection = self._run_chrome_javascript(_build_x_post_state_javascript())
                    actual_handle = str(injection.get("handle", actual_handle) or actual_handle).lstrip("@")
                    if expected_handle and not actual_handle:
                        return ChromePublishResult(
                            platform="x",
                            ok=False,
                            error=(
                                f"X account could not be verified before posting: expected @{expected_handle}, "
                                "but the active handle was not visible. Do not repost until the live automation profile "
                                "X account is confirmed."
                            ),
                            mode="chrome_live_account_unverified",
                        )
                    if expected_handle and actual_handle and actual_handle.lower() != expected_handle.lstrip("@").lower():
                        return ChromePublishResult(
                            platform="x",
                            ok=False,
                            error=f"X account mismatch before posting: expected @{expected_handle}, got @{actual_handle}.",
                            mode="chrome_live_account_mismatch",
                        )
                if not injection.get("postEnabled"):
                    self._last_live_error = "Live Chrome X injection ran, but the Post button stayed disabled."
                    return None
            if dry_run:
                return ChromePublishResult(platform="x", ok=True, mode="chrome_live_dry_run")

            submit = self._run_chrome_javascript(_build_x_post_submit_javascript())
            if not submit.get("clicked"):
                self._last_live_error = "Live Chrome X publish could not click the Post button."
                return None

            time.sleep(4.0)
            handle = actual_handle or expected_handle.lstrip("@")
            capture = self._run_chrome_javascript(_build_x_post_capture_javascript(snippet, handle=handle))
            if not capture.get("postUrl") and handle:
                self._open_url_in_front_tab(f"https://x.com/{handle}")
                time.sleep(3.0)
                capture = self._run_chrome_javascript(_build_x_post_capture_javascript(snippet, handle=handle))
            return ChromePublishResult(
                platform="x",
                ok=bool(capture.get("postUrl")),
                post_url=str(capture.get("postUrl", "") or ""),
                post_id=str(capture.get("postId", "") or ""),
                error=(
                    ""
                    if capture.get("postUrl")
                    else (
                        "X post may have been submitted, but the resulting URL could not be captured. "
                        "Do not repost; verify the live automation profile X post URL before marking this row published."
                    )
                ),
                mode="chrome_live",
            )
        except subprocess.CalledProcessError as exc:
            details = (exc.stderr or exc.stdout or str(exc)).strip()
            self._last_live_error = f"Live Chrome X path failed: {' '.join(details.split())}"
            return None
        except Exception as exc:
            self._last_live_error = f"Live Chrome X path failed: {' '.join(str(exc).split())}"
            return None

    def _launch_context(self, playwright: object) -> BrowserContext:
        config = self._config
        if not config.executable_path:
            raise RuntimeError("CHROME_EXECUTABLE_PATH is not set.")
        if not Path(config.executable_path).exists():
            raise RuntimeError(f"Chrome executable not found: {config.executable_path}")
        Path(config.user_data_dir).mkdir(parents=True, exist_ok=True)

        chromium = getattr(playwright, "chromium")
        return chromium.launch_persistent_context(
            user_data_dir=config.user_data_dir,
            executable_path=config.executable_path,
            headless=config.headless,
            args=[f"--profile-directory={config.profile_directory}"],
            viewport={"width": 1440, "height": 900},
        )

    def _prime_live_chrome_window(self, url: str) -> None:
        config = self._config
        if not config.executable_path:
            return
        if not Path(config.executable_path).exists():
            return
        subprocess.Popen(
            [
                config.executable_path,
                f"--user-data-dir={config.user_data_dir}",
                f"--profile-directory={config.profile_directory}",
                url,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(1.5)

    def _ensure_linkedin_compose_modal(self, page: Page) -> None:
        if self._try_get_visible_editor(page) is not None:
            return

        if not self._click_compose_entry(page):
            raise RuntimeError(
                "Could not find the LinkedIn compose entry in the current UI. "
                "This legacy fallback driver is not a Daily AI publish lane; use the Chrome plugin registered runner and tab-scoped DOM control."
            )
        editor = self._find_visible_editor(page, timeout_ms=10000)
        editor.wait_for(state="visible", timeout=10000)

    def _set_linkedin_editor_text(self, page: Page, text: str) -> None:
        editor = self._find_visible_editor(page, timeout_ms=10000)
        editor.click()
        editor_html = _build_linkedin_editor_html(text)
        editor.evaluate(
            """(element, payload) => {
                const text = String(payload.text);
                const html = String(payload.html);
                const lines = text.split("\\n");
                const selection = window.getSelection();
                const setCaretToEnd = () => {
                    const range = document.createRange();
                    range.selectNodeContents(element);
                    range.collapse(false);
                    selection?.removeAllRanges();
                    selection?.addRange(range);
                };
                element.focus();
                let usedExecCommand = false;
                try {
                    document.execCommand("selectAll", false);
                    document.execCommand("delete", false);
                    lines.forEach((line, index) => {
                        if (line) {
                            usedExecCommand = document.execCommand("insertText", false, line) || usedExecCommand;
                        }
                        if (index < lines.length - 1) {
                            usedExecCommand =
                                document.execCommand("insertParagraph", false) ||
                                document.execCommand("insertLineBreak", false) ||
                                usedExecCommand;
                        }
                    });
                } catch (error) {
                    usedExecCommand = false;
                }
                if (!usedExecCommand || !String(element.innerText || "").trim()) {
                    element.innerHTML = html;
                }
                setCaretToEnd();
                element.dispatchEvent(new InputEvent("beforeinput", {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    inputType: "insertText",
                    data: text,
                }));
                element.dispatchEvent(new InputEvent("input", {
                    bubbles: true,
                    composed: true,
                    inputType: "insertText",
                    data: text,
                }));
                element.dispatchEvent(new Event("change", { bubbles: true }));
                element.dispatchEvent(new Event("blur", { bubbles: true }));
                element.dispatchEvent(new Event("focus", { bubbles: true }));
                element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
                element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
                return {
                    textContent: element.textContent,
                    innerText: element.innerText,
                    ariaLabel: element.getAttribute("aria-label") || "",
                    usedExecCommand,
                };
            }""",
            {"text": text, "html": editor_html},
        )
        page.wait_for_timeout(500)
        editor.blur()
        page.wait_for_timeout(300)

    def _capture_linkedin_post_url(self, page: Page) -> str:
        if "/feed/update/" in page.url:
            return page.url

        try:
            view_post = self._find_named_locator(page, "link", LINKEDIN_VIEW_POST_LABELS, timeout_ms=10000)
            view_post.wait_for(state="visible", timeout=10000)
            with page.expect_navigation(wait_until="domcontentloaded", timeout=15000):
                view_post.click()
            if "/feed/update/" in page.url:
                return page.url
        except PlaywrightTimeoutError:
            return ""
        except Exception:
            return ""

        return ""

    def _wait_for_enabled_post_button(self, page: Page, timeout_ms: int = 5000) -> Locator:
        deadline = time.monotonic() + (timeout_ms / 1000)
        last_error = (
            "LinkedIn Post button is still disabled after text injection. "
            "This legacy fallback driver is not a Daily AI publish lane; use the Chrome plugin registered runner and tab-scoped DOM control."
        )
        while time.monotonic() < deadline:
            try:
                post_button = self._find_named_locator(page, "button", LINKEDIN_POST_BUTTON_LABELS, timeout_ms=800)
                if post_button.is_enabled():
                    return post_button
            except Exception as exc:
                last_error = str(exc)
            page.wait_for_timeout(250)
        raise RuntimeError(last_error)

    def _click_compose_entry(self, page: Page) -> bool:
        candidates: list[Locator] = [
            page.locator(
                'button:has-text("Start a post"), '
                'button:has-text("投稿を開始"), '
                'div[role="button"]:has-text("Start a post"), '
                'div[role="button"]:has-text("投稿を開始")'
            ).first,
            page.locator('[aria-label*="Start a post"], [aria-label*="投稿を開始"]').first,
        ]
        try:
            candidates.insert(0, self._find_named_locator(page, "button", LINKEDIN_COMPOSE_ENTRY_LABELS, timeout_ms=1000))
        except Exception:
            pass

        for locator in candidates:
            try:
                locator.wait_for(state="visible", timeout=1500)
                locator.click()
                return True
            except Exception:
                continue
        return False

    def _find_visible_editor(self, page: Page, timeout_ms: int) -> Locator:
        editor = self._try_get_visible_editor(page, timeout_ms=timeout_ms)
        if editor is None:
            raise RuntimeError("Could not find a visible LinkedIn editor in the current UI.")
        return editor

    def _try_get_visible_editor(self, page: Page, timeout_ms: int = 1200) -> Locator | None:
        for selector in LINKEDIN_EDITOR_CANDIDATE_SELECTORS:
            locator = page.locator(selector).first
            try:
                locator.wait_for(state="visible", timeout=timeout_ms)
                return locator
            except Exception:
                continue
        return None

    def _find_named_locator(self, page: Page, role: str, labels: tuple[str, ...], timeout_ms: int) -> Locator:
        pattern = re.compile(rf"^({'|'.join(re.escape(label) for label in labels)})$")
        candidates = [page.get_by_role(role, name=pattern).first]
        candidates.extend(page.get_by_text(label, exact=True).first for label in labels)
        candidates.append(page.locator(", ".join(f'[aria-label*=\"{label}\"]' for label in labels)).first)
        for locator in candidates:
            try:
                locator.wait_for(state="visible", timeout=timeout_ms)
                return locator
            except Exception:
                continue
        joined = ", ".join(labels)
        raise RuntimeError(f"Could not find visible LinkedIn {role} for labels: {joined}")

    def _run_osascript(self, script: str) -> str:
        completed = subprocess.run(
            ["osascript", "-"],
            input=script,
            text=True,
            capture_output=True,
            check=True,
            timeout=20,
        )
        return completed.stdout.strip()

    def _activate_linkedin_compose_tab(self, text: str) -> tuple[int, int]:
        output = self._run_osascript(
            _build_activate_linkedin_compose_applescript(text, profile_label=self._config.profile_label)
        )
        match = re.fullmatch(r"(\d+):(\d+)", output)
        if not match:
            raise RuntimeError(f"Could not resolve LinkedIn compose tab from AppleScript: {output or 'empty output'}")
        return int(match.group(1)), int(match.group(2))

    def _activate_chrome_tab(self, window_index: int, tab_index: int) -> None:
        self._run_osascript(
            f"""
tell application "Google Chrome"
  tell window {window_index}
    set active tab index to {tab_index}
  end tell
  set index of window {window_index} to 1
  activate
end tell
"""
        )

    def _wait_for_linkedin_compose_state(self, window_index: int, tab_index: int, timeout_seconds: float = 20.0) -> dict[str, object]:
        deadline = time.monotonic() + timeout_seconds
        last_state: dict[str, object] = {}
        while time.monotonic() < deadline:
            state = self._run_chrome_javascript(
                _build_linkedin_post_state_javascript(),
                window_index=window_index,
                tab_index=tab_index,
            )
            last_state = state
            loading_state = str(state.get("loadingState", "") or "")
            if loading_state != "complete":
                time.sleep(0.75)
                continue
            if state.get("ok") or state.get("dialogVisible"):
                return state
            time.sleep(0.75)
        return last_state

    def _open_url_in_front_tab(self, url: str) -> None:
        self._run_osascript(_build_open_url_in_front_tab_applescript(url))

    def cleanup_automation_tabs(self, *, keep_linkedin_tabs: int = 1, keep_x_tabs: int = 1) -> None:
        self._run_osascript(
            _build_cleanup_automation_tabs_applescript(
                keep_linkedin_tabs=keep_linkedin_tabs,
                keep_x_tabs=keep_x_tabs,
                profile_label=self._config.profile_label,
            )
        )

    def _run_chrome_javascript(
        self,
        script: str,
        *,
        window_index: int | None = None,
        tab_index: int | None = None,
) -> dict[str, object]:
        script = script.replace("\r", " ").replace("\n", " ")
        target = "active tab of front window"
        if window_index is not None and tab_index is not None:
            target = f"tab {tab_index} of window {window_index}"
        elif window_index is not None:
            target = f"active tab of window {window_index}"
        wrapped = f'''
tell application "Google Chrome"
  tell {target}
    execute javascript {_applescript_string(script)}
  end tell
end tell
'''
        try:
            output = self._run_osascript(wrapped)
        except subprocess.CalledProcessError as exc:
            details = (exc.stderr or exc.stdout or str(exc)).strip()
            if window_index is not None and tab_index is not None and "正しくないインデックス" in details:
                fallback_wrapped = f'''
tell application "Google Chrome"
  tell active tab of window {window_index}
    execute javascript {_applescript_string(script)}
  end tell
end tell
'''
                output = self._run_osascript(fallback_wrapped)
            else:
                raise
        if not output:
            return {}
        try:
            parsed = json.loads(output)
        except json.JSONDecodeError:
            return {"raw": output}
        return parsed if isinstance(parsed, dict) else {"value": parsed}

    def _open_linkedin_compose_with_real_click(self, window_index: int, tab_index: int) -> bool:
        if not _command_exists("cliclick"):
            return False
        self._activate_chrome_tab(window_index, tab_index)
        click_point = self._run_chrome_javascript(
            _build_linkedin_compose_click_point_javascript(),
            window_index=window_index,
            tab_index=tab_index,
        )
        if not click_point.get("found"):
            return False

        x = int(round(float(click_point.get("screenX", 0))))
        y = int(round(float(click_point.get("screenY", 0))))
        subprocess.run(["cliclick", f"c:{x},{y}"], check=True, capture_output=True, text=True)
        return True

    def _open_linkedin_compose_with_javascript_click(self, window_index: int, tab_index: int) -> bool:
        result = self._run_chrome_javascript(
            _build_linkedin_compose_dom_click_javascript(),
            window_index=window_index,
            tab_index=tab_index,
        )
        return bool(result.get("clicked"))

    def _focus_x_editor_with_real_click(self) -> bool:
        if not _command_exists("cliclick"):
            return False
        click_point = self._run_chrome_javascript(_build_x_editor_click_point_javascript())
        if not click_point.get("found"):
            return False
        x = int(round(float(click_point.get("screenX", 0))))
        y = int(round(float(click_point.get("screenY", 0))))
        subprocess.run(["cliclick", f"c:{x},{y}"], check=True, capture_output=True, text=True)
        return True

    def _focus_linkedin_editor_with_real_click(self, window_index: int, tab_index: int) -> bool:
        if not _command_exists("cliclick"):
            return False
        self._activate_chrome_tab(window_index, tab_index)
        click_point = self._run_chrome_javascript(
            _build_linkedin_editor_click_point_javascript(),
            window_index=window_index,
            tab_index=tab_index,
        )
        if not click_point.get("found"):
            return False
        x = int(round(float(click_point.get("screenX", 0))))
        y = int(round(float(click_point.get("screenY", 0))))
        subprocess.run(["cliclick", f"c:{x},{y}"], check=True, capture_output=True, text=True)
        return True

    def _click_linkedin_post_with_real_click(self, window_index: int, tab_index: int) -> bool:
        if not _command_exists("cliclick"):
            return False
        self._activate_chrome_tab(window_index, tab_index)
        click_point = self._run_chrome_javascript(
            _build_linkedin_post_click_point_javascript(),
            window_index=window_index,
            tab_index=tab_index,
        )
        if not click_point.get("found"):
            return False
        x = int(round(float(click_point.get("screenX", 0))))
        y = int(round(float(click_point.get("screenY", 0))))
        subprocess.run(["cliclick", f"c:{x},{y}"], check=True, capture_output=True, text=True)
        return True

    def _paste_text_into_focused_field(self, text: str) -> bool:
        try:
            subprocess.run(["pbcopy"], input=text, text=True, check=True, capture_output=True)
            self._run_osascript(
                """
tell application "System Events"
  keystroke "v" using command down
end tell
"""
            )
            return True
        except Exception:
            return False


def _build_linkedin_editor_html(text: str) -> str:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[str] = []
    for line in lines:
        if line:
            blocks.append(f"<p>{escape(line)}</p>")
        else:
            blocks.append("<p><br></p>")
    return "".join(blocks) or "<p><br></p>"


def _command_exists(name: str) -> bool:
    return subprocess.run(["which", name], capture_output=True, text=True).returncode == 0


def _format_live_chrome_error(details: str) -> str:
    normalized = " ".join(details.split())
    if "AppleScript からの JavaScript の実行がオフ" in normalized:
        return (
            "Live Chrome path is still blocked because Chrome reports "
            "'Allow JavaScript from Apple Events' as off. "
            "If the menu is already checked in the Nicky window, fully quit and reopen Google Chrome once, "
            "then retry the LinkedIn publish command."
        )
    return f"Live Chrome path failed: {normalized}"


def _applescript_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _build_linkedin_compose_url(text: str = "") -> str:
    if not text.strip():
        return LINKEDIN_COMPOSE_URL
    return f"{LINKEDIN_COMPOSE_URL}&text={quote(text)}"


def _build_linkedin_compose_seed(text: str) -> str:
    normalized = " ".join(line.strip() for line in text.splitlines() if line.strip())
    return normalized[:80]


def _build_activate_linkedin_compose_applescript(text: str = "", *, profile_label: str = "") -> str:
    compose_url = _build_linkedin_compose_url(text)
    return f"""
tell application "Google Chrome"
  set profileLabel to {_applescript_string(profile_label)}
  set allowedProfileWindowIndexes to {{}}
  if profileLabel is not "" then
    try
      tell application "System Events"
        tell process "Google Chrome"
          repeat with sw from 1 to count of windows
            if (name of window sw) contains profileLabel then set end of allowedProfileWindowIndexes to sw
          end repeat
        end tell
      end tell
    end try
    if (count of allowedProfileWindowIndexes) is 0 then error "profile_window_not_found:" & profileLabel
  end if
  set preferredWindowIndex to 0
  set existingComposeWindowIndex to 0
  set existingComposeTabIndex to 0
  set existingFeedWindowIndex to 0
  set existingFeedTabIndex to 0
  repeat with w from 1 to count of windows
    set windowAllowed to false
    if profileLabel is "" then
      set windowAllowed to true
    else
      repeat with allowedWindowIndex in allowedProfileWindowIndexes
        if w is (allowedWindowIndex as integer) then set windowAllowed to true
      end repeat
    end if
    if windowAllowed then
      repeat with t from 1 to count of tabs of window w
        set currentTab to tab t of window w
        set currentUrl to URL of currentTab
        if preferredWindowIndex is 0 then
          if currentUrl contains "https://www.linkedin.com/" or currentUrl contains "https://docs.google.com/spreadsheets/" or currentUrl contains "https://x.com/" then
            set preferredWindowIndex to w
          end if
        end if
        if currentUrl contains "{LINKEDIN_COMPOSE_URL}" then
          if existingComposeWindowIndex is 0 then
            set existingComposeWindowIndex to w
            set existingComposeTabIndex to t
          end if
        else if currentUrl contains "https://www.linkedin.com/feed/" and currentUrl does not contain "https://www.linkedin.com/uas/login" then
          if existingFeedWindowIndex is 0 then
            set existingFeedWindowIndex to w
            set existingFeedTabIndex to t
          end if
        end if
      end repeat
    end if
  end repeat
  if (count of windows) = 0 then
    make new window
  end if
  if existingComposeWindowIndex is not 0 then
    tell window existingComposeWindowIndex
      set active tab index to existingComposeTabIndex
    end tell
    set index of window existingComposeWindowIndex to 1
    activate
    return (existingComposeWindowIndex as text) & ":" & (existingComposeTabIndex as text)
  end if
  if existingFeedWindowIndex is not 0 then
    tell window existingFeedWindowIndex
      set active tab index to existingFeedTabIndex
    end tell
    set index of window existingFeedWindowIndex to 1
    activate
    return (existingFeedWindowIndex as text) & ":" & (existingFeedTabIndex as text)
  end if
  if preferredWindowIndex is 0 then
    if profileLabel is "" then
      set preferredWindowIndex to 1
    else
      set preferredWindowIndex to item 1 of allowedProfileWindowIndexes
    end if
  end if
  tell window preferredWindowIndex
    make new tab with properties {{URL:{_applescript_string(compose_url)}}}
    set active tab index to (count of tabs)
  end tell
  set index of window preferredWindowIndex to 1
  activate
  return (preferredWindowIndex as text) & ":" & (active tab index of window preferredWindowIndex as text)
end tell
"""


def _build_activate_x_compose_applescript(profile_label: str = "") -> str:
    return f"""
tell application "Google Chrome"
  set profileLabel to {_applescript_string(profile_label)}
  set allowedProfileWindowIndexes to {{}}
  if profileLabel is not "" then
    try
      tell application "System Events"
        tell process "Google Chrome"
          repeat with sw from 1 to count of windows
            if (name of window sw) contains profileLabel then set end of allowedProfileWindowIndexes to sw
          end repeat
        end tell
      end tell
    end try
    if (count of allowedProfileWindowIndexes) is 0 then error "profile_window_not_found:" & profileLabel
  end if
  set foundTarget to false
  set preferredWindowIndex to 0
  set xWindowIndex to 0
  repeat with w from 1 to count of windows
    set windowAllowed to false
    if profileLabel is "" then
      set windowAllowed to true
    else
      repeat with allowedWindowIndex in allowedProfileWindowIndexes
        if w is (allowedWindowIndex as integer) then set windowAllowed to true
      end repeat
    end if
    if windowAllowed then
      repeat with t from 1 to count of tabs of window w
        set currentTab to tab t of window w
        set currentUrl to URL of currentTab
        if preferredWindowIndex is 0 then
          if currentUrl contains "https://www.linkedin.com/" or currentUrl contains "https://docs.google.com/spreadsheets/" then
            set preferredWindowIndex to w
          end if
        end if
        if xWindowIndex is 0 then
          if currentUrl contains "https://x.com/" then set xWindowIndex to w
        end if
        if (currentUrl contains "{X_COMPOSE_URL}" or currentUrl contains "https://x.com/home") and (preferredWindowIndex is 0 or w is preferredWindowIndex) then
          set active tab index of window w to t
          set index of window w to 1
          set foundTarget to true
          exit repeat
        end if
      end repeat
    end if
    if foundTarget then exit repeat
  end repeat
  if not foundTarget then
    if (count of windows) = 0 then
      make new window
    end if
    if preferredWindowIndex is 0 then
      if xWindowIndex is not 0 then
        set preferredWindowIndex to xWindowIndex
      else if profileLabel is "" then
        set preferredWindowIndex to 1
      else
        set preferredWindowIndex to item 1 of allowedProfileWindowIndexes
      end if
    end if
    tell window preferredWindowIndex
      make new tab with properties {{URL:"{X_COMPOSE_URL}"}}
      set active tab index to (count of tabs)
    end tell
    set index of window preferredWindowIndex to 1
  else
    tell active tab of front window
      if URL does not contain "{X_COMPOSE_URL}" then set URL to "{X_COMPOSE_URL}"
    end tell
  end if
  activate
end tell
"""


def _build_open_url_in_front_tab_applescript(url: str) -> str:
    return f"""
tell application "Google Chrome"
  if (count of windows) = 0 then
    make new window
  end if
  tell active tab of front window
    set URL to {_applescript_string(url)}
  end tell
  activate
end tell
"""


def _build_cleanup_automation_tabs_applescript(*, keep_linkedin_tabs: int, keep_x_tabs: int, profile_label: str = "") -> str:
    return f"""
tell application "Google Chrome"
  set profileLabel to {_applescript_string(profile_label)}
  set allowedProfileWindowIndexes to {{}}
  if profileLabel is not "" then
    try
      tell application "System Events"
        tell process "Google Chrome"
          repeat with sw from 1 to count of windows
            if (name of window sw) contains profileLabel then set end of allowedProfileWindowIndexes to sw
          end repeat
        end tell
      end tell
    end try
    if (count of allowedProfileWindowIndexes) is 0 then return
  end if
  repeat with w from 1 to count of windows
    set windowAllowed to false
    if profileLabel is "" then
      set windowAllowed to true
    else
      repeat with allowedWindowIndex in allowedProfileWindowIndexes
        if w is (allowedWindowIndex as integer) then set windowAllowed to true
      end repeat
    end if
    if not windowAllowed then
      -- Skip non-target Chrome profile windows.
    else
    set keptLinkedIn to 0
    set keptX to 0
    repeat with t from (count of tabs of window w) to 1 by -1
      set currentTab to tab t of window w
      set currentUrl to URL of currentTab
      if currentUrl contains "https://www.linkedin.com/feed/?shareActive=true" then
        if keptLinkedIn < {keep_linkedin_tabs} then
          set keptLinkedIn to keptLinkedIn + 1
        else
          close currentTab
        end if
      else if currentUrl contains "{X_COMPOSE_URL}" then
        if keptX < {keep_x_tabs} then
          set keptX to keptX + 1
        else
          close currentTab
        end if
      end if
    end repeat
    end if
  end repeat
end tell
"""


def _build_linkedin_editor_injection_javascript(text: str) -> str:
    selectors = json.dumps(LINKEDIN_EDITOR_CANDIDATE_SELECTORS)
    html = _build_linkedin_editor_html(text)
    return f"""
(() => {{
  const selectors = {selectors};
  const text = {json.dumps(text)};
  const html = {json.dumps(html)};
  const collectRoots = () => {{
    const roots = [document];
    const queue = [document];
    while (queue.length) {{
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {{
        if (node && node.shadowRoot) {{
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }}
      }}
    }}
    return roots;
  }};
  const deepQueryAll = (selector) => collectRoots().flatMap((root) => Array.from(root.querySelectorAll(selector)));
  const deepQueryWithin = (container, selector) => {{
    const roots = [container];
    const queue = [container];
    while (queue.length) {{
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {{
        if (node && node.shadowRoot) {{
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }}
      }}
    }}
    return roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
  }};
  const isVisible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );
  const findEditor = () => {{
    for (const selector of selectors) {{
      const node = deepQueryAll(selector).find((candidate) => isVisible(candidate));
      if (node) return node;
    }}
    return null;
  }};
  let editor = findEditor();
  if (!editor) {{
    return JSON.stringify({{ ok: false, reason: 'editor_not_found' }});
  }}

  const lines = text.split('\\n');
  const selection = window.getSelection();
  const setCaretToEnd = () => {{
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }};
  editor.focus();
  let usedExecCommand = false;
  try {{
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    lines.forEach((line, index) => {{
      if (line) {{
        usedExecCommand = document.execCommand('insertText', false, line) || usedExecCommand;
      }}
      if (index < lines.length - 1) {{
        usedExecCommand =
          document.execCommand('insertParagraph', false) ||
          document.execCommand('insertLineBreak', false) ||
          usedExecCommand;
      }}
    }});
  }} catch (error) {{
    usedExecCommand = false;
  }}
  if (!usedExecCommand || !String(editor.innerText || '').trim()) {{
    editor.innerHTML = html;
  }}
  setCaretToEnd();
  editor.dispatchEvent(new InputEvent('beforeinput', {{
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'insertText',
    data: text,
  }}));
  editor.dispatchEvent(new InputEvent('input', {{
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: text,
  }}));
  editor.dispatchEvent(new Event('change', {{ bubbles: true }}));
  editor.dispatchEvent(new Event('blur', {{ bubbles: true }}));
  editor.dispatchEvent(new Event('focus', {{ bubbles: true }}));

  const container =
    editor.closest('[role="dialog"], .share-box, .share-creation-state, .artdeco-modal') || document;
  const buttons = deepQueryWithin(container, 'button');
  const postButton = buttons.find((button) => {{
    const label = (button.innerText || button.getAttribute('aria-label') || '').trim();
    const isPostLabel = label === 'Post' || label === '投稿';
    const className = String(button.className || '');
    const isPrimaryPostButton =
      className.includes('share-actions__primary-action') ||
      className.includes('share-box_actions-post-button');
    return isVisible(button) && isPostLabel && isPrimaryPostButton;
  }});
  return JSON.stringify({{
    ok: true,
    postEnabled: Boolean(postButton && !postButton.disabled && postButton.getAttribute('aria-disabled') !== 'true'),
    editorText: editor.innerText || editor.textContent || '',
  }});
}})();
"""


def _build_linkedin_post_state_javascript() -> str:
    return """
(() => {
  const collectRoots = () => {
    const roots = [document];
    const queue = [document];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  };
  const selectors = [
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label*="Text editor"]',
    '[contenteditable="true"][aria-label*="テキストエディタ"]',
    '[contenteditable="true"][aria-label*="投稿"]',
    'div.ql-editor[contenteditable="true"]',
  ];
  const isVisible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );
  const findPrimaryPostButton = (container) => {
    const collectContainerRoots = () => {
      const roots = [container];
      const queue = [container];
      while (queue.length) {
        const root = queue.shift();
        const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
        for (const node of nodes) {
          if (node && node.shadowRoot) {
            roots.push(node.shadowRoot);
            queue.push(node.shadowRoot);
          }
        }
      }
      return roots;
    };
    const buttons = collectContainerRoots().flatMap((root) => Array.from(root.querySelectorAll('button')));
    return buttons.find((button) => {
      const label = (button.innerText || button.getAttribute('aria-label') || '').trim();
      const isPostLabel = label === 'Post' || label === '投稿';
      const className = String(button.className || '');
      const isPrimaryPostButton =
        className.includes('share-actions__primary-action') ||
        className.includes('share-box_actions-post-button');
      return isVisible(button) && isPostLabel && isPrimaryPostButton;
    });
  };
  const roots = collectRoots();
  const editor = selectors
    .flatMap((selector) => roots.flatMap((root) => Array.from(root.querySelectorAll(selector))))
    .find((candidate) => isVisible(candidate) && (candidate.innerText || candidate.textContent || '').trim().length > 0);
  const container = editor
    ? (editor.closest('[role="dialog"], .share-box, .share-creation-state, .artdeco-modal') || document)
    : document;
  const postButton = findPrimaryPostButton(container);
  const composeEntry = roots.flatMap((root) => Array.from(root.querySelectorAll('button, div[role="button"], [aria-label]'))).find((node) => {
    const label = (node.innerText || node.getAttribute('aria-label') || '').trim();
    return (label.includes('Start a post') || label.includes('投稿を開始')) && isVisible(node);
  });
  const dialog = roots.flatMap((root) => Array.from(root.querySelectorAll('[role="dialog"], .artdeco-modal, .share-box'))).find((node) => isVisible(node));
  return JSON.stringify({
    ok: Boolean(editor),
    reason: editor ? '' : 'editor_not_found',
    postEnabled: Boolean(postButton && !postButton.disabled && postButton.getAttribute('aria-disabled') !== 'true'),
    editorText: editor ? (editor.innerText || editor.textContent || '') : '',
    loadingState: document.readyState || '',
    composeEntryVisible: Boolean(composeEntry),
    dialogVisible: Boolean(dialog),
  });
})();
"""


def _build_linkedin_compose_dom_click_javascript() -> str:
    return """
(() => {
  const collectRoots = () => {
    const roots = [document];
    const queue = [document];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  };
  const isVisible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );
  const labels = ['Start a post', '投稿を開始'];
  const nodes = collectRoots().flatMap((root) => Array.from(root.querySelectorAll('button, div[role="button"], [aria-label]')));
  const target = nodes.find((node) => {
    if (!isVisible(node)) return false;
    const label = `${node.innerText || node.textContent || ''} ${node.getAttribute('aria-label') || ''}`.trim();
    return labels.some((candidate) => label.includes(candidate));
  });
  if (!target) {
    return JSON.stringify({ clicked: false, reason: 'compose_entry_not_found' });
  }
  target.click();
  return JSON.stringify({
    clicked: true,
    tagName: target.tagName,
    role: target.getAttribute('role') || '',
  });
})();
"""


def _build_linkedin_editor_click_point_javascript() -> str:
    return """
(() => {
  const collectRoots = () => {
    const roots = [document];
    const queue = [document];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  };
  const selectors = [
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label*="Text editor"]',
    '[contenteditable="true"][aria-label*="テキストエディタ"]',
    '[contenteditable="true"][aria-label*="投稿"]',
    'div.ql-editor[contenteditable="true"]',
  ];
  const isVisible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );
  const editor = selectors.flatMap((selector) => collectRoots().flatMap((root) => Array.from(root.querySelectorAll(selector)))).find((candidate) => isVisible(candidate));
  if (!editor) {
    return JSON.stringify({ found: false });
  }
  const rect = editor.getBoundingClientRect();
  const topChrome = Math.max(0, window.outerHeight - window.innerHeight);
  return JSON.stringify({
    found: true,
    screenX: window.screenX + rect.left + Math.min(40, rect.width / 2),
    screenY: window.screenY + topChrome + rect.top + Math.min(40, rect.height / 2),
  });
})();
"""


def _build_x_editor_injection_javascript(text: str) -> str:
    selectors = json.dumps(X_EDITOR_CANDIDATE_SELECTORS)
    return f"""
(() => {{
  const selectors = {selectors};
  const text = {json.dumps(text)};
  const collectRoots = () => {{
    const roots = [document];
    const queue = [document];
    while (queue.length) {{
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {{
        if (node && node.shadowRoot) {{
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }}
      }}
    }}
    return roots;
  }};
  const isVisible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );
  const deepQueryAll = (selector) => collectRoots().flatMap((root) => Array.from(root.querySelectorAll(selector)));
  const findEditor = () => {{
    for (const selector of selectors) {{
      const node = deepQueryAll(selector).find((candidate) => isVisible(candidate));
      if (node) return node;
    }}
    const fallback = deepQueryAll('div[contenteditable="true"], [role="textbox"][contenteditable="true"]').find((candidate) => {{
      if (!isVisible(candidate)) return false;
      const textInput = String(candidate.getAttribute('aria-label') || candidate.getAttribute('data-testid') || candidate.textContent || '');
      return /post|tweet|text|いまどうしてる/i.test(textInput) || candidate.getAttribute('aria-multiline') === 'true';
    }});
    return fallback || null;
  }};
  const editor = findEditor();
  if (!editor) {{
    const currentUrl = window.location.href || '';
    if (currentUrl.includes('/i/flow/login') || currentUrl.includes('/login')) {{
      return JSON.stringify({{ ok: false, reason: 'login_required', currentUrl }});
    }}
    return JSON.stringify({{ ok: false, reason: 'editor_not_found' }});
  }}
  editor.focus();
  let usedExecCommand = false;
  try {{
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    usedExecCommand = document.execCommand('insertText', false, text) || usedExecCommand;
  }} catch (error) {{
    usedExecCommand = false;
  }}
  if (!usedExecCommand || !String(editor.innerText || '').trim()) {{
    editor.textContent = text;
  }}
  editor.dispatchEvent(new InputEvent('beforeinput', {{
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'insertText',
    data: text,
  }}));
  editor.dispatchEvent(new InputEvent('input', {{
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: text,
  }}));
  editor.dispatchEvent(new Event('change', {{ bubbles: true }}));
  const postButton = deepQueryAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"], button[aria-label="Post"], button[aria-label="投稿する"]').find((button) => isVisible(button));
  const profileLink = deepQueryAll('a[data-testid="AppTabBar_Profile_Link"], a[href^="/"][role="link"]').find((link) => {{
    const href = String(link.getAttribute('href') || '');
    return /^\\/[^/]+$/.test(href) && isVisible(link);
  }});
  const handle = profileLink ? String(profileLink.getAttribute('href') || '').replace(/^\\//, '') : '';
  return JSON.stringify({{
    ok: true,
    postEnabled: Boolean(postButton && !postButton.disabled && postButton.getAttribute('aria-disabled') !== 'true'),
    handle,
    editorText: editor.innerText || editor.textContent || '',
  }});
}})();
"""


def _build_x_post_state_javascript() -> str:
    return """
(() => {
  const collectRoots = () => {
    const roots = [document];
    const queue = [document];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  };
  const selectors = [
    'div[data-testid="tweetTextarea_0"][role="textbox"]',
    'div[role="textbox"][data-testid="tweetTextarea_0"]',
    '[data-testid="tweetTextarea_0"] div[role="textbox"]',
    '[data-testid="tweetTextarea_0"][contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"][data-testid]',
    'div[contenteditable="true"][aria-label*="Post text"]',
    'div[contenteditable="true"][aria-label*="What is happening"]',
    'div[contenteditable="true"][aria-label*="いまどうしてる"]',
    'div[contenteditable="true"][aria-multiline="true"]',
    'div[role="textbox"][contenteditable="true"]',
  ];
  const isVisible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );
  const roots = collectRoots();
  const editor = selectors
    .flatMap((selector) => roots.flatMap((root) => Array.from(root.querySelectorAll(selector))))
    .find((candidate) => isVisible(candidate));
  const postButton = roots
    .flatMap((root) => Array.from(root.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"], button[aria-label="Post"], button[aria-label="投稿する"]')))
    .find((button) => isVisible(button));
  return JSON.stringify({
    ok: Boolean(editor),
    reason: editor ? '' : ((window.location.href || '').includes('/i/flow/login') || (window.location.href || '').includes('/login') ? 'login_required' : 'editor_not_found'),
    postEnabled: Boolean(postButton && !postButton.disabled && postButton.getAttribute('aria-disabled') !== 'true'),
    editorText: editor ? (editor.innerText || editor.textContent || '') : '',
  });
})();
"""


def _build_x_editor_click_point_javascript() -> str:
    return """
(() => {
  const collectRoots = () => {
    const roots = [document];
    const queue = [document];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  };
  const selectors = [
    'div[data-testid="tweetTextarea_0"][role="textbox"]',
    'div[role="textbox"][data-testid="tweetTextarea_0"]',
    '[data-testid="tweetTextarea_0"] div[role="textbox"]',
    '[data-testid="tweetTextarea_0"][contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"][data-testid]',
    'div[contenteditable="true"][aria-label*="Post text"]',
    'div[contenteditable="true"][aria-label*="What is happening"]',
    'div[contenteditable="true"][aria-label*="いまどうしてる"]',
    'div[contenteditable="true"][aria-multiline="true"]',
    'div[role="textbox"][contenteditable="true"]',
  ];
  const isVisible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );
  const editor = selectors
    .flatMap((selector) => collectRoots().flatMap((root) => Array.from(root.querySelectorAll(selector))))
    .find((candidate) => isVisible(candidate));
  if (!editor) {
    return JSON.stringify({ found: false });
  }
  const rect = editor.getBoundingClientRect();
  const topChrome = Math.max(0, window.outerHeight - window.innerHeight);
  return JSON.stringify({
    found: true,
    screenX: window.screenX + rect.left + Math.min(20, rect.width / 2),
    screenY: window.screenY + topChrome + rect.top + Math.min(20, rect.height / 2),
  });
})();
"""


def _build_x_post_submit_javascript() -> str:
    return """
(() => {
  const collectRoots = () => {
    const roots = [document];
    const queue = [document];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  };
  const isVisible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );
  const postButton = collectRoots()
    .flatMap((root) => Array.from(root.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"], button[aria-label="Post"], button[aria-label="投稿する"]')))
    .find((button) => isVisible(button));
  if (!postButton || postButton.disabled || postButton.getAttribute('aria-disabled') === 'true') {
    return JSON.stringify({ clicked: false });
  }
  postButton.click();
  return JSON.stringify({ clicked: true });
})();
"""


def _build_x_post_capture_javascript(snippet: str, handle: str = "") -> str:
    return f"""
(() => {{
  const snippet = {json.dumps(snippet)};
  const handle = {json.dumps(handle)};
  const articles = Array.from(document.querySelectorAll('article'));
  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  for (const article of articles) {{
    const text = normalize(article.innerText || article.textContent || '');
    if (snippet && !text.includes(snippet)) continue;
    const links = Array.from(article.querySelectorAll('a[href*="/status/"]'));
    const matched = links.find((link) => {{
      const href = String(link.getAttribute('href') || '');
      return !handle || href.includes('/' + handle + '/status/') || href.includes('/i/web/status/');
    }});
    if (matched) {{
      const href = String(matched.href || matched.getAttribute('href') || '');
      const match = href.match(/\\/status\\/(\\d+)/);
      return JSON.stringify({{ postUrl: href, postId: match ? match[1] : '' }});
    }}
  }}
  if (handle) {{
    return JSON.stringify({{ postUrl: '', postId: '' }});
  }}
  const links = Array.from(document.querySelectorAll('a[href*="/status/"]'));
  const matched = links.find((link) => {{
    const href = String(link.getAttribute('href') || '');
    return !handle || href.includes('/' + handle + '/status/') || href.includes('/i/web/status/');
  }});
  if (matched) {{
    const href = String(matched.href || matched.getAttribute('href') || '');
    const match = href.match(/\\/status\\/(\\d+)/);
    return JSON.stringify({{ postUrl: href, postId: match ? match[1] : '' }});
  }}
  return JSON.stringify({{ postUrl: '', postId: '' }});
}})();
"""


def _build_linkedin_post_submit_javascript() -> str:
    return """
(() => {
  const collectRoots = () => {
    const roots = [document];
    const queue = [document];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  };
  const roots = collectRoots();
  const isVisible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );
  const editors = roots.flatMap((root) => Array.from(root.querySelectorAll(
    '.ql-editor[contenteditable="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="Text editor"], [contenteditable="true"][aria-label*="テキストエディタ"], [contenteditable="true"][aria-label*="投稿"]'
  )));
  const activeEditor = editors.find((editor) => isVisible(editor) && (editor.innerText || editor.textContent || '').trim().length > 0);
  if (!activeEditor) {
    return JSON.stringify({ clicked: false, reason: 'editor_text_missing' });
  }
  const container =
    activeEditor.closest('[role="dialog"], .share-box, .share-creation-state, .artdeco-modal') || document;
  const containerRoots = (() => {
    const roots = [container];
    const queue = [container];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  })();
  const buttons = containerRoots.flatMap((root) => Array.from(root.querySelectorAll('button')));
  const postButton = buttons.find((button) => {
    const label = (button.innerText || button.getAttribute('aria-label') || '').trim();
    const isPostLabel = label === 'Post' || label === '投稿';
    const className = String(button.className || '');
    const isPrimaryPostButton =
      className.includes('share-actions__primary-action') ||
      className.includes('share-box_actions-post-button');
    return isVisible(button) && isPostLabel && isPrimaryPostButton;
  });
  if (!postButton || postButton.disabled || postButton.getAttribute('aria-disabled') === 'true') {
    return JSON.stringify({ clicked: false, reason: 'post_button_unavailable' });
  }
  postButton.click();
  return JSON.stringify({ clicked: true });
})();
"""


def _build_linkedin_post_click_point_javascript() -> str:
    return """
(() => {
  const collectRoots = () => {
    const roots = [document];
    const queue = [document];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  };
  const isVisible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );
  const roots = collectRoots();
  const editors = roots.flatMap((root) => Array.from(root.querySelectorAll(
    '.ql-editor[contenteditable="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="Text editor"], [contenteditable="true"][aria-label*="テキストエディタ"], [contenteditable="true"][aria-label*="投稿"]'
  )));
  const activeEditor = editors.find((editor) => isVisible(editor) && (editor.innerText || editor.textContent || '').trim().length > 0);
  if (!activeEditor) {
    return JSON.stringify({ found: false, reason: 'editor_text_missing' });
  }
  const container =
    activeEditor.closest('[role="dialog"], .share-box, .share-creation-state, .artdeco-modal') || document;
  const containerRoots = (() => {
    const roots = [container];
    const queue = [container];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  })();
  const buttons = containerRoots.flatMap((root) => Array.from(root.querySelectorAll('button')));
  const target = buttons.find((button) => {
    const label = (button.innerText || button.getAttribute('aria-label') || '').trim();
    const isPostLabel = label === 'Post' || label === '投稿';
    const className = String(button.className || '');
    const isPrimaryPostButton =
      className.includes('share-actions__primary-action') ||
      className.includes('share-box_actions-post-button');
    return (
      isVisible(button) &&
      isPostLabel &&
      isPrimaryPostButton &&
      !button.disabled &&
      button.getAttribute('aria-disabled') !== 'true'
    );
  });
  if (!target) {
    return JSON.stringify({ found: false, reason: 'post_button_unavailable' });
  }
  const rect = target.getBoundingClientRect();
  const topChrome = Math.max(0, window.outerHeight - window.innerHeight);
  return JSON.stringify({
    found: true,
    screenX: window.screenX + rect.left + (rect.width / 2),
    screenY: window.screenY + topChrome + rect.top + (rect.height / 2),
  });
})();
"""


def _build_linkedin_post_capture_javascript() -> str:
    return """
(() => {
  const collectRoots = () => {
    const roots = [document];
    const queue = [document];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  };
  const currentUrl = window.location.href || '';
  const links = collectRoots().flatMap((root) => Array.from(root.querySelectorAll('a[href]')));
  const postLink = links.find((link) => String(link.href || '').includes('/feed/update/'));
  return JSON.stringify({
    postUrl: postLink ? postLink.href : (currentUrl.includes('/feed/update/') ? currentUrl : ''),
  });
})();
"""


def _build_x_metrics_capture_javascript() -> str:
    return """
(() => {
  const bodyText = String(document.body ? document.body.innerText : '');
  const extract = (patterns) => {
    for (const pattern of patterns) {
      const match = bodyText.match(pattern);
      if (match) return String(match[1]).replace(/,/g, '');
    }
    return '';
  };
  return JSON.stringify({
    x_reply_count: extract([/(\\d[\\d,]*)\\s+(?:Reply|Replies|リプライ)/i]),
    x_repost_count: extract([/(\\d[\\d,]*)\\s+(?:Repost|Reposts|Retweet|Retweets|リポスト)/i]),
    x_like_count: extract([/(\\d[\\d,]*)\\s+(?:Like|Likes|いいね)/i]),
    x_quote_count: extract([/(\\d[\\d,]*)\\s+(?:Quote|Quotes|引用)/i]),
    x_impression_count: extract([/(\\d[\\d,]*)\\s+(?:Views|View|表示)/i]),
  });
})();
"""


def _build_linkedin_metrics_capture_javascript() -> str:
    return """
(() => {
  const bodyText = String(document.body ? document.body.innerText : '');
  const extract = (patterns) => {
    for (const pattern of patterns) {
      const match = bodyText.match(pattern);
      if (match) return String(match[1]).replace(/,/g, '');
    }
    return '';
  };
  return JSON.stringify({
    linkedin_impression_count: extract([/(\\d[\\d,]*)\\s+impressions/i, /(\\d[\\d,]*)\\s+閲覧/i]),
    linkedin_reaction_count: extract([/(\\d[\\d,]*)\\s+reactions?/i, /(\\d[\\d,]*)\\s+件のリアクション/i]),
    linkedin_comment_count: extract([/(\\d[\\d,]*)\\s+comments?/i, /(\\d[\\d,]*)\\s+件のコメント/i]),
    linkedin_reshare_count: extract([/(\\d[\\d,]*)\\s+(?:reposts?|reshares?)/i, /(\\d[\\d,]*)\\s+件のリポスト/i]),
  });
})();
"""


def _build_linkedin_compose_click_point_javascript() -> str:
    return """
(() => {
  const collectRoots = () => {
    const roots = [document];
    const queue = [document];
    while (queue.length) {
      const root = queue.shift();
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node && node.shadowRoot) {
          roots.push(node.shadowRoot);
          queue.push(node.shadowRoot);
        }
      }
    }
    return roots;
  };
  const isVisible = (node) => Boolean(
    node &&
    node.getClientRects &&
    node.getClientRects().length > 0 &&
    window.getComputedStyle(node).visibility !== 'hidden' &&
    window.getComputedStyle(node).display !== 'none'
  );
  const candidates = collectRoots().flatMap((root) => Array.from(root.querySelectorAll('button, div[role="button"], [aria-label]')));
  const target = candidates.find((node) => {
    const label = (node.innerText || node.getAttribute('aria-label') || '').trim();
    return isVisible(node) && (label.includes('Start a post') || label.includes('投稿を開始'));
  });
  if (!target) {
    return JSON.stringify({ found: false });
  }
  const rect = target.getBoundingClientRect();
  const topChrome = Math.max(0, window.outerHeight - window.innerHeight);
  return JSON.stringify({
    found: true,
    screenX: window.screenX + rect.left + Math.min(32, Math.max(18, rect.width * 0.18)),
    screenY: window.screenY + topChrome + rect.top + (rect.height / 2),
  });
})();
"""
