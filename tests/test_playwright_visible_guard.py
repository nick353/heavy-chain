import importlib.util
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PROJECT_ROOT / "scripts/job_applications/playwright_visible_guard.py"
RUNNER_PATH = PROJECT_ROOT / "scripts/job_applications/run_visible_checked_playwright_apply.py"
INSPECTOR_PATH = PROJECT_ROOT / "scripts/job_applications/run_cdp_job_form_inspector.py"
SPEC = importlib.util.spec_from_file_location("playwright_visible_guard", MODULE_PATH)
assert SPEC and SPEC.loader
playwright_visible_guard = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = playwright_visible_guard
SPEC.loader.exec_module(playwright_visible_guard)


class FakeLocator:
    def __init__(self, text: str):
        self.text = text

    def inner_text(self, timeout: int = 0) -> str:
        return self.text


class FakePage:
    url = "https://hrmos.co/pages/givery/jobs/2226994868202393617"

    def __init__(self, body: str):
        self.body = body
        self.brought_to_front = False
        self.screenshot_target = ""

    def bring_to_front(self) -> None:
        self.brought_to_front = True

    def screenshot(self, *, path: str, full_page: bool = False) -> None:
        self.screenshot_target = path
        Path(path).write_bytes(b"fake-png")

    def title(self) -> str:
        return "【生成AIに強み有り｜リモート】ITコンサルタント | 株式会社ギブリー"

    def locator(self, selector: str) -> FakeLocator:
        assert selector == "body"
        return FakeLocator(self.body)


def test_assert_visible_open_writes_json_and_screenshot(tmp_path) -> None:
    page = FakePage("株式会社ギブリー\nITコンサルタント\n応募する")

    result = playwright_visible_guard.assert_visible_open(
        page,
        artifact_dir=tmp_path,
        marker_texts=["ギブリー", "ITコンサルタント"],
    )

    assert result.opened_ok
    assert page.brought_to_front
    assert (tmp_path / "site-open-check.png").exists()
    assert (tmp_path / "site-open-check.json").exists()


def test_assert_visible_open_fails_when_markers_are_missing(tmp_path) -> None:
    page = FakePage("別会社\n別求人")

    with pytest.raises(RuntimeError, match="visible_open_check_failed"):
        playwright_visible_guard.assert_visible_open(
            page,
            artifact_dir=tmp_path,
            marker_texts=["存在しない会社", "存在しない職種"],
        )

    assert (tmp_path / "site-open-check.png").exists()
    assert (tmp_path / "site-open-check.json").exists()


def test_marker_supports_regex_prefix(tmp_path) -> None:
    page = FakePage("株式会社ギブリー\n年収 720万円 〜 1500万円")

    result = playwright_visible_guard.assert_visible_open(
        page,
        artifact_dir=tmp_path,
        marker_texts=["re:年収\\s*720万円"],
    )

    assert result.opened_ok


def test_marker_texts_are_required(tmp_path) -> None:
    page = FakePage("株式会社ギブリー\nITコンサルタント")

    with pytest.raises(RuntimeError, match="marker_texts_required"):
        playwright_visible_guard.assert_visible_open(
            page,
            artifact_dir=tmp_path,
            marker_texts=[],
        )


def test_visible_checked_runner_uses_guard_before_form_mutation() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")

    assert "assert_visible_open" in runner
    assert "visible_open_check_passed_form_runner_not_selected" in runner
    assert "visible_open_check_failed_before_form_mutation" in runner
    assert "Select an ATS-specific guarded form runner before mutating fields or submitting." in runner


def test_visible_checked_runner_uses_real_chrome_and_form_surface_guard() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")

    assert 'channel="chrome"' in runner
    assert "Chrome for Testing" not in runner
    assert "FORM_SURFACE_MARKER" in runner
    marker_line = runner.split("FORM_SURFACE_MARKER", 1)[1].split("\n", 1)[0]
    assert "jobs" not in marker_line
    assert "herp" not in marker_line
    assert "hrmos" not in marker_line
    assert "応募" not in marker_line
    assert "エントリー" not in marker_line
    assert "個人情報" not in marker_line
    assert "re:メール|" not in marker_line
    assert "re:電話|" not in marker_line


def test_visible_checked_runner_records_playwright_video_for_visual_qa_sidecar() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")

    assert "record_video_dir" in runner
    assert 'artifact_dir / "playwright-video"' in runner


def test_visible_checked_runner_requires_company_role_and_form_surface_by_default() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")

    assert "markers = [args.company, args.role, FORM_SURFACE_MARKER, *args.marker]" in runner


def test_visible_checked_runner_appends_jsonl_outcomes() -> None:
    runner = RUNNER_PATH.read_text(encoding="utf-8")

    assert 'path.open("a", encoding="utf-8")' in runner
    assert ".write_text(json.dumps" not in runner


def test_cdp_job_form_inspector_reuses_existing_chrome_without_submit_or_close() -> None:
    inspector = INSPECTOR_PATH.read_text(encoding="utf-8")

    assert "connect_over_cdp" in inspector
    assert "http://127.0.0.1:9334" in inspector
    assert "cdp_existing_context_unavailable" in inspector
    assert "browser.new_context" not in inspector
    assert "launch_persistent_context" not in inspector
    assert "channel=\"chrome\"" not in inspector
    assert "context.close(" not in inspector
    assert "browser.close(" not in inspector
    assert "click(" not in inspector
    assert "set_input_files" not in inspector
    assert "def candidate_artifact_path" in inspector
    assert "candidate_artifact_dir = candidate_artifact_path" in inspector
    assert "time.time_ns()" in inspector
    assert "exist_ok=False" in inspector
    assert "candidate_artifact_path(artifact_dir, args.job_key)" in inspector
    assert "artifact_dir=artifact_dir" not in inspector
    assert 'raise RuntimeError("cdp_existing_context_unavailable")' not in inspector
    assert "form_model_captured_adapter_required" in inspector
    assert "visible_open_check_failed_before_form_inspection" in inspector
    assert 'path.open("a", encoding="utf-8")' in inspector
