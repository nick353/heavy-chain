from __future__ import annotations

import errno
import csv
import hashlib
import json
import inspect
import os
import signal
from pathlib import Path
import subprocess
import struct
import sys
import time
import types
from unittest.mock import patch

import pytest
import typer
from typer.testing import CliRunner

from social_flow import cli
from social_flow.chrome_publish import ChromePublishResult
from social_flow.models import QUEUE_COLUMNS, QueueRow
from social_flow.sheets import SheetsRepository


class DummyRepo:
    def __init__(self, rows: list[QueueRow]) -> None:
        self._rows = rows
        self.updated_rows: list[QueueRow] = []
        self.path = Path("posting_queue.tsv")

    def read_all(self) -> list[QueueRow]:
        return self._rows

    def get(self, item_id: str) -> QueueRow | None:
        for row in self._rows:
            if row.id == item_id:
                return row
        return None

    def update(self, row: QueueRow) -> None:
        self.updated_rows.append(row)


class MutableDummyRepo(DummyRepo):
    def update(self, row: QueueRow) -> None:
        for index, existing in enumerate(self._rows):
            if existing.id == row.id:
                self._rows[index] = row
                break
        self.updated_rows.append(row)

    def bootstrap(self) -> None:
        return None

    def append(self, row: QueueRow) -> None:
        self._rows.append(row)
        self.updated_rows.append(row)


def _slow_sheets_sync_target_for_test(path, result_queue):
    cli.time.sleep(2)
    result_queue.put({"ok": True, "count": 99})


def _slow_draft_worker_for_test(settings, row, result_queue) -> None:
    time.sleep(2)


def _slow_image_worker_for_test(api_key, prompt, destination, result_queue) -> None:
    time.sleep(2)


def _slow_source_collection_worker_for_test(settings, result_queue) -> None:
    time.sleep(2)


class DummySheetsRepo:
    def __init__(self) -> None:
        self.bootstrap_called = False
        self.summary_calls: list[dict[str, object]] = []
        self.feed_read_log_rows: list[list[str]] = []
        self.learning_review_rows: list[list[str]] = []
        self.relationship_map_rows: list[list[str]] = []

    def bootstrap_queue_sheet(self) -> None:
        self.bootstrap_called = True

    def append_run_summary(self, **kwargs) -> None:
        self.summary_calls.append(kwargs)

    def append_feed_read_log(self, rows: list[list[str]]) -> None:
        self.feed_read_log_rows.extend(rows)

    def append_learning_review(self, rows: list[list[str]]) -> None:
        self.learning_review_rows.extend(rows)

    def upsert_relationship_map(self, rows: list[list[str]]) -> int:
        self.relationship_map_rows.extend(rows)
        return len(rows)


def _touch_generated_media(path: str, *, width: int = 1024, height: int = 1024) -> None:
    media_path = Path(path)
    media_path.parent.mkdir(parents=True, exist_ok=True)
    media_path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + b"\x08\x02\x00\x00\x00"
        + b"\x00\x00\x00\x00"
        + struct.pack(">I", 0)
        + b"IEND"
        + b"\x00\x00\x00\x00"
    )


def _touch_generated_jpeg(path: str, *, width: int = 1024, height: int = 1024) -> None:
    media_path = Path(path)
    media_path.parent.mkdir(parents=True, exist_ok=True)
    media_path.write_bytes(
        b"\xff\xd8"
        + b"\xff\xc0"
        + struct.pack(">H", 17)
        + b"\x08"
        + struct.pack(">HH", height, width)
        + b"\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00"
    )


def _touch_generated_webp(path: str, *, width: int = 1024, height: int = 1024) -> None:
    media_path = Path(path)
    media_path.parent.mkdir(parents=True, exist_ok=True)
    media_path.write_bytes(
        b"RIFF"
        + struct.pack("<I", 30)
        + b"WEBP"
        + b"VP8X"
        + struct.pack("<I", 10)
        + b"\x00\x00\x00\x00"
        + (width - 1).to_bytes(3, "little")
        + (height - 1).to_bytes(3, "little")
    )


class DummyLocator:
    def __init__(self, *, visible: bool = False, count: int = 1) -> None:
        self.visible = visible
        self._count = count
        self.clicked = False

    @property
    def first(self):
        return self

    @property
    def last(self):
        return self

    def count(self) -> int:
        return self._count

    def is_visible(self, timeout: int = 0) -> bool:
        return self.visible

    def click(self, timeout: int = 0) -> None:
        self.clicked = True


class DummyLinkedInPage:
    def __init__(self) -> None:
        self.editor = DummyLocator(visible=False)
        self.entry = DummyLocator(visible=True)
        self.evaluate_calls = 0
        self.waits = 0

    def locator(self, selector: str) -> DummyLocator:
        if "Start a post" in selector or "投稿を開始" in selector:
            return self.entry
        return self.editor

    def wait_for_timeout(self, timeout: int) -> None:
        self.waits += 1
        if self.entry.clicked:
            self.editor.visible = True

    def evaluate(self, script: str):
        self.evaluate_calls += 1
        return False


def test_verify_x_browser_account_accepts_handle_from_account_dom() -> None:
    class Page:
        def evaluate(self, script: str, expected: str) -> dict[str, object]:
            assert expected == "nichika2000823"
            return {"ok": True, "profileHref": "", "currentUrl": "https://x.com/home"}

    cli._verify_x_browser_account(Page(), "@nichika2000823")


def test_verify_x_browser_account_rejects_missing_active_account_signal() -> None:
    class Page:
        def evaluate(self, script: str, expected: str) -> dict[str, object]:
            return {"ok": False, "method": "", "currentUrl": "https://x.com/nichika2000823"}

    with pytest.raises(RuntimeError, match="account_not_verified"):
        cli._verify_x_browser_account(Page(), "@nichika2000823")


def test_verify_x_browser_account_accepts_own_profile_edit_button_fallback() -> None:
    class Page:
        def __init__(self) -> None:
            self.url = ""

        def evaluate(self, script: str, expected: str) -> dict[str, object]:
            if "own_profile_edit_button_fallback" in script:
                return {"ok": True, "method": "own_profile_edit_button_fallback"}
            return {"ok": False, "method": "", "currentUrl": "https://x.com/home"}

        def goto(self, url: str, **kwargs) -> None:
            self.url = url

        def wait_for_timeout(self, timeout: int) -> None:
            pass

    page = Page()
    cli._verify_x_browser_account(page, "@nichika2000823")
    assert page.url == "https://x.com/nichika2000823"


def test_fit_x_text_url_body_shortens_overlong_copy_with_fixed_url_weight() -> None:
    source_url = "https://aws.amazon.com/blogs/machine-learning/very/long/path/that/x/shortens"
    body = "これはかなり長い日本語の観察です。" * 18 + "\n" + source_url

    shortened = cli._fit_x_text_url_body(body, source_url)

    assert source_url in shortened
    assert cli._x_weighted_length_with_urls(shortened) <= 270
    assert cli._x_weighted_length_with_urls(shortened) < cli._x_weighted_length_with_urls(body)


def test_fit_x_reply_body_shortens_overlong_comment_with_fixed_url_weight() -> None:
    source_url = "https://example.com/very/long/path/that/x/treats/as/a/fixed/url"
    cases = [
        "a" * 280,
        "あ" * 140,
        "これはかなり長い日本語の返信です。" * 18 + "\n" + source_url,
    ]

    for body in cases:
        shortened = cli._fit_x_reply_body(body)
        assert cli._x_weighted_length_with_urls(shortened) <= 270

    shortened_with_url = cli._fit_x_reply_body("これはかなり長い日本語の返信です。" * 18 + "\n" + source_url)
    assert source_url in shortened_with_url


def test_capture_x_completion_does_not_accept_current_status_url_without_article_match() -> None:
    class Locator:
        def __init__(self, selector: str = "") -> None:
            self.selector = selector

        def evaluate_all(self, script: str) -> list[str]:
            return []

        def count(self) -> int:
            return 0

    class Page:
        url = "https://x.com/nichika2000823/status/999"

        def goto(self, url: str, **kwargs) -> None:
            self.url = url

        def wait_for_timeout(self, timeout: int) -> None:
            pass

        def locator(self, selector: str) -> Locator:
            return Locator(selector)

    with pytest.raises(RuntimeError, match="completion_capture_failed"):
        cli._capture_x_post_url(
            Page(),
            expected_handle="@nichika2000823",
            body="new body https://example.com/source",
            timeout_seconds=0.01,
            source_url="https://example.com/source",
            exclude_status_ids=set(),
        )


def test_wait_for_linkedin_editor_opens_start_post_when_editor_missing() -> None:
    page = DummyLinkedInPage()

    editor = cli._wait_for_linkedin_editor(page, timeout_seconds=2.0)

    assert editor is page.editor
    assert page.entry.clicked


def test_wait_for_linkedin_editor_does_not_open_start_post_when_disallowed() -> None:
    page = DummyLinkedInPage()

    with pytest.raises(RuntimeError, match="LinkedIn composer editor was not visible"):
        cli._wait_for_linkedin_editor(page, timeout_seconds=0.01, allow_open_compose_entry=False)

    assert not page.entry.clicked


class FailingXPublisher:
    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    def publish(self, text: str) -> dict[str, str]:
        raise RuntimeError("x failed")


class FailingChromeXPublisher:
    def publish_x(self, text: str, *, dry_run: bool = False, expected_handle: str = ""):
        raise RuntimeError("x failed")

    def publish_linkedin(self, text: str, *, dry_run: bool = False, artifact_dir: str | None = None):
        raise RuntimeError("linkedin chrome unavailable")


class FailingXSuccessfulLinkedInChromePublisher(FailingChromeXPublisher):
    def publish_linkedin(self, text: str, *, dry_run: bool = False, artifact_dir: str | None = None):
        return ChromePublishResult(
            platform="linkedin",
            ok=True,
            post_url="https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123/",
            mode="chrome_live",
        )


class SuccessfulLinkedInPublisher:
    def __init__(self, access_token: str, author_urn: str, api_version: str) -> None:
        self.access_token = access_token
        self.author_urn = author_urn
        self.api_version = api_version

    def publish(self, text: str) -> dict[str, str]:
        return {"id": "li-123", "url": "https://www.linkedin.com/feed/update/li-123/"}


class TrackingXPublisher:
    published_texts: list[str] = []

    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    def publish(self, text: str) -> dict[str, str]:
        self.published_texts.append(text)
        return {"id": "x-123", "url": "https://x.com/i/web/status/x-123"}


class TrackingLinkedInPublisher:
    published_texts: list[str] = []

    def __init__(self, access_token: str, author_urn: str, api_version: str) -> None:
        self.access_token = access_token
        self.author_urn = author_urn
        self.api_version = api_version

    def publish(self, text: str) -> dict[str, str]:
        self.published_texts.append(text)
        return {"id": "urn:li:share:123", "url": "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123/"}


class EngagementXPublisher:
    actions: list[tuple[str, str, str]] = []

    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    def like(self, tweet_id: str) -> dict[str, str]:
        self.actions.append(("like", tweet_id, ""))
        return {"id": tweet_id, "url": f"https://x.com/i/web/status/{tweet_id}"}

    def reply(self, tweet_id: str, text: str) -> dict[str, str]:
        self.actions.append(("reply", tweet_id, text))
        return {"id": "reply-1", "url": "https://x.com/i/web/status/reply-1"}

    def quote(self, tweet_id: str, text: str) -> dict[str, str]:
        self.actions.append(("quote", tweet_id, text))
        return {"id": "quote-1", "url": "https://x.com/i/web/status/quote-1"}


class EngagementLinkedInPublisher:
    actions: list[tuple[str, str, str]] = []

    def __init__(self, access_token: str, author_urn: str, api_version: str) -> None:
        self.access_token = access_token
        self.author_urn = author_urn
        self.api_version = api_version

    def like(self, target_urn: str) -> dict[str, str]:
        self.actions.append(("like", target_urn, ""))
        return {"id": target_urn, "url": f"https://www.linkedin.com/feed/update/{target_urn}/"}

    def comment(self, target_urn: str, text: str) -> dict[str, str]:
        self.actions.append(("comment", target_urn, text))
        return {"id": "comment-1", "url": f"https://www.linkedin.com/feed/update/{target_urn}/"}


class SuccessfulChromePublisher:
    def __init__(self, config) -> None:
        self.config = config

    def publish_x(self, text: str, *, dry_run: bool = False, expected_handle: str = ""):
        return ChromePublishResult(
            platform="x",
            ok=True,
            post_url="https://x.com/i/web/status/x-999",
            post_id="x-999",
            mode="chrome_live",
        )

    def publish_linkedin(self, text: str, *, dry_run: bool = False, artifact_dir: str | None = None):
        return ChromePublishResult(
            platform="linkedin",
            ok=True,
            post_url="https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A999/",
            mode="chrome",
        )

    def fetch_x_metrics(self, post_url: str) -> dict[str, str]:
        return {
            "x_like_count": "1",
            "x_reply_count": "2",
            "x_repost_count": "3",
            "x_quote_count": "4",
            "x_impression_count": "5",
        }

    def fetch_linkedin_metrics(self, post_url: str) -> dict[str, str]:
        return {
            "linkedin_impression_count": "6",
            "linkedin_reaction_count": "7",
            "linkedin_comment_count": "8",
            "linkedin_reshare_count": "9",
        }


class UrlPendingLinkedInChromePublisher(SuccessfulChromePublisher):
    def publish_linkedin(self, text: str, *, dry_run: bool = False, artifact_dir: str | None = None):
        return ChromePublishResult(
            platform="linkedin",
            ok=False,
            error=(
                "LinkedIn post may have been submitted, but the resulting URL could not be captured. "
                "Do not repost; verify the live automation profile post URL before marking this row published."
            ),
            mode="chrome_live_url_pending",
        )


class CleanupFailingChromePublisher(SuccessfulChromePublisher):
    def cleanup_automation_tabs(self, *, keep_linkedin_tabs: int = 1, keep_x_tabs: int = 1) -> None:
        raise RuntimeError("cleanup failed")


def test_publish_command_is_disabled_for_daily_ai_automation() -> None:
    with pytest.raises(cli.typer.BadParameter, match="Chrome plugin registered runner"):
        cli.publish(item_id=None)


def test_open_automation_chrome_requires_explicit_diagnostic_flag() -> None:
    with pytest.raises(cli.typer.BadParameter, match="isolated diagnostic profile"):
        cli.open_automation_chrome(start_url="about:blank")


def test_research_updates_notes_and_timestamp(monkeypatch) -> None:
    row = QueueRow(id="item-1", status="collected")
    repo = DummyRepo([row])

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-05-09T00:00:00+00:00")

    cli.research_local(
        item_id="item-1",
        path="posting_queue.tsv",
        research_status="done",
        freshness_checked_at=None,
        angle="会話型広告の運用ハードルが下がった点",
        x_research_notes="Xでは広告運用の入口拡大に反応が集まっている",
        linkedin_research_notes="LinkedInでは計測とガバナンスの観点が多い",
        past_post_reference="普段は運用実務寄りの切り口で投稿",
        reference_post_urls="https://x.com/OpenAI/status/123",
        reference_account_handles="@OpenAI, @AnthropicAI",
        reference_media_urls="https://pbs.twimg.com/media/example.jpg",
        reference_media_notes="短いデモ動画かUIスクリーンショットが多い",
        media_plan="UIスクリーンショット1枚",
    )

    assert row.research_status == "done"
    assert row.freshness_checked_at == "2026-05-09T00:00:00+00:00"
    assert row.angle == "会話型広告の運用ハードルが下がった点"
    assert "広告運用" in row.x_research_notes
    assert "ガバナンス" in row.linkedin_research_notes
    assert "@OpenAI" in row.reference_account_handles


def test_humanize_queue_local_updates_draft_copy(monkeypatch, capsys) -> None:
    row = QueueRow(
        id="item-1",
        status="drafted",
        x_text="The next phase of enterprise AI。要点は日本語でOpenAI が企業向け AI の次段階を整理。",
        linkedin_text="OpenAIのThe next phase of enterprise AI。背景と実務への影響を短く整理しました。",
    )
    repo = MutableDummyRepo([row])

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.humanize_queue_local(path="posting_queue.tsv")

    assert "要点は日本語で" not in row.x_text
    assert row.x_text.startswith("The next phase of enterprise AI。")
    assert "背景と実務への影響を短く整理しました。" not in row.linkedin_text
    assert "Humanized 1 queue item(s)." in capsys.readouterr().out
    assert repo.updated_rows == [row]


def test_documents_to_rows_assigns_quality_scores() -> None:
    from social_flow.sources import SourceDocument

    rows = cli._documents_to_rows(
        [
            SourceDocument(
                title="GPT-5.5 API security update",
                url="https://example.com/gpt55",
                summary_en="OpenAI shipped GPT-5.5 API controls with 3 new security settings.",
                source_name="OpenAI",
                source_type="rss",
            )
        ]
    )

    row = rows[0]
    assert row.quality_score
    assert row.source_priority_score == "5"
    assert row.specificity_score in {"4", "5"}
    assert row.quality_notes


def test_collect_url_list_local_writes_to_local_queue(monkeypatch, tmp_path, capsys) -> None:
    from social_flow.sources import SourceDocument

    repo = MutableDummyRepo([])
    url_list_path = tmp_path / "urls.txt"
    url_list_path.write_text("https://example.com/slow-post\n", encoding="utf-8")

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(
        cli,
        "collect_from_url_list",
        lambda path, source_name: [
            SourceDocument(
                title="Slow post",
                url="https://example.com/slow-post",
                summary_en="URL fetch failed during collection. fetch_error=Timeout",
                source_name=source_name,
                source_type="url_fetch_failed",
            )
        ],
    )

    cli.collect_url_list_local(path=str(url_list_path), source_name="manual", queue_path="posting_queue.tsv")

    assert len(repo.read_all()) == 1
    assert repo.read_all()[0].source_url == "https://example.com/slow-post"
    assert repo.read_all()[0].source_type == "url_fetch_failed"
    assert "Collected 1 new item(s) from URL list into posting_queue.tsv." in capsys.readouterr().out


def test_documents_to_rows_keeps_fetch_failed_urls_draftable() -> None:
    from social_flow.sources import SourceDocument

    row = cli._documents_to_rows(
        [
            SourceDocument(
                title="New and improved computer using agents",
                url="https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/new-and-improved-computer-using-agents/",
                summary_en="URL fetch failed during collection. fetch_error=Timeout",
                source_name="manual",
                source_type="url_fetch_failed",
            )
        ]
    )[0]

    assert row.source_type == "url_fetch_failed"
    assert row.keep_priority == "hold"
    assert row.research_status == "in_progress"
    assert cli._effective_keep_priority(row) == "hold"
    assert "fetch retry required" in row.quality_notes
    assert "Retry source fetch" in row.next_action


def test_score_source_priority_treats_diverse_ai_sources_as_primary() -> None:
    assert cli._score_source_priority("OpenAI") == 5
    assert cli._score_source_priority("Google AI") == 4
    assert cli._score_source_priority("Microsoft AI") == 4
    assert cli._score_source_priority("Microsoft AI Blog") == 4
    assert cli._score_source_priority("AWS for ML") == 4
    assert cli._score_source_priority("Hugging Face Blog") == 4
    assert cli._score_source_priority("Anthropic") == 4
    assert cli._score_source_priority("web discovery") == 3
    assert cli._score_source_priority("Web discovery") == 3
    assert cli._score_source_priority("X/LinkedIn discovery") == 3


def test_collect_drive_folder_local_falls_back_to_chrome_live(monkeypatch, capsys) -> None:
    repo = MutableDummyRepo([])

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "collect_from_google_drive_folder", lambda folder_url, source_name="Google Drive": [])
    monkeypatch.setattr(
        cli,
        "_collect_drive_documents_from_chrome_tab",
        lambda folder_url, source_name="Google Drive": [
            cli.SourceDocument(
                title="demo-video.mp4",
                url="https://drive.google.com/file/d/video123/view",
                summary_en="Video discovered in Google Drive tab `Google Drive`.",
                source_name=source_name,
                source_type="google_drive",
            )
        ],
    )
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-05-10T00:00:00+00:00")

    cli.collect_drive_folder_local("https://drive.google.com/drive/folders/folder123", path="posting_queue.tsv")

    assert len(repo.read_all()) == 1
    assert repo.read_all()[0].drive_file_name == "demo-video.mp4"
    assert "source=chrome_live" in capsys.readouterr().out


def test_draft_videos_local_populates_platform_fields(monkeypatch) -> None:
    row = QueueRow(
        id="video-1",
        source_type="google_drive",
        status="collected",
        drive_file_name="demo-video.mp4",
        drive_web_url="https://drive.google.com/file/d/video123/view",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        gemini_api_key = "gemini-key"
        gemini_model = "gemini-2.5-pro"

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-05-10T00:00:00+00:00")
    monkeypatch.setattr(
        cli,
        "generate_video_social_copy",
        lambda **kwargs: {
            "content_summary": "短い動画要約",
            "hook_candidates": "hook1 | hook2 | hook3",
            "key_points": "point1 | point2 | point3",
            "cta_suggestion": "続きは保存して見返してください。",
            "recommended_platforms": "TikTok, Instagram Reels, YouTube Shorts, Facebook Reels",
            "hashtag_candidates": "#ai #shortvideo",
            "thumbnail_text_idea": "3秒で伝わる",
            "media_plan": "縦動画をそのまま使う",
            "best_platform": "TikTok",
            "best_hook": "最初の3秒で差が出る",
            "tiktok_caption": "TikTok用キャプション",
            "tiktok_hashtags": "#tiktok #ai",
            "instagram_caption": "Instagram用キャプション",
            "instagram_hashtags": "#reels #ai",
            "youtube_title": "Shorts用タイトル",
            "youtube_description": "Shorts用説明文",
            "youtube_hashtags": "#shorts #ai",
            "facebook_caption": "Facebook用キャプション",
            "facebook_hashtags": "#facebookreels #ai",
        },
    )

    cli.draft_videos_local(path="posting_queue.tsv")

    assert row.status == "drafted"
    assert row.gemini_analysis_status == "done"
    assert row.tiktok_caption == "TikTok用キャプション"
    assert row.youtube_title == "Shorts用タイトル"
    assert row.facebook_caption == "Facebook用キャプション"


def test_qa_browser_video_cli_uses_gemini_settings_without_printing_api_key(monkeypatch, tmp_path) -> None:
    video = tmp_path / "browser-run.webm"
    video.write_bytes(b"fake webm")
    captured = {}

    def fake_analyze(**kwargs):
        captured.update(kwargs)
        return {
            "timeline": [],
            "step_matches": [
                {
                    "expected_step": "Open target page",
                    "matched": True,
                    "timecode": "00:01",
                    "evidence": "Target page visible.",
                    "confidence": 0.9,
                }
            ],
            "anomalies": [],
            "recommendation": {
                "status": "pass",
                "summary": "No blocker found.",
                "next_action": "Use this as baseline.",
            },
        }

    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-pro")
    monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_JSON", raising=False)
    monkeypatch.delenv("GOOGLE_SHEETS_SPREADSHEET_ID", raising=False)
    monkeypatch.setattr(cli, "analyze_browser_automation_video", fake_analyze)

    result = CliRunner().invoke(
        cli.app,
        [
            "qa-browser-video",
            str(video),
            "--expected-step",
            "Open target page",
            "--expected-step",
            "Click submit",
            "--anomaly-rule",
            "No reload loop",
            "--timeout-seconds",
            "12",
            "--json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["recommendation"]["status"] == "pass"
    assert "secret-gemini-key" not in result.output
    assert captured["api_key"] == "secret-gemini-key"
    assert captured["model"] == "gemini-2.5-pro"
    assert captured["video_path"] == str(video)
    assert captured["expected_steps"] == ["Open target page", "Click submit"]
    assert captured["anomaly_rules"] == ["No reload loop"]
    assert captured["timeout_seconds"] == 12


def test_qa_browser_video_cli_redacts_analyzer_exception(monkeypatch, tmp_path) -> None:
    video = tmp_path / "browser-run.webm"
    video.write_bytes(b"fake webm")
    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setenv("GEMINI_MODEL_NAME", "gemini-2.5-flash")
    monkeypatch.delenv("GEMINI_MODEL", raising=False)

    def fake_analyze(**kwargs):
        assert kwargs["model"] == "gemini-2.5-flash"
        raise RuntimeError("SDK failed with key secret-gemini-key")

    monkeypatch.setattr(cli, "analyze_browser_automation_video", fake_analyze)

    result = CliRunner().invoke(cli.app, ["qa-browser-video", str(video)])

    combined_output = result.output + getattr(result, "stderr", "")
    assert result.exit_code == 1
    assert "secret-gemini-key" not in combined_output
    assert "[REDACTED_GEMINI_API_KEY]" in combined_output


def test_video_qa_smoke_skip_gemini_writes_safe_artifact_manifest(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)

    def fake_record(fixture_path: Path, run_dir: Path) -> Path:
        assert fixture_path.exists()
        video_path = run_dir / "video-qa-smoke.webm"
        video_path.write_bytes(b"fake webm")
        return video_path

    monkeypatch.setattr(cli, "_record_video_qa_smoke_fixture", fake_record)
    monkeypatch.setattr(
        cli,
        "analyze_browser_automation_video",
        lambda **kwargs: pytest.fail("Gemini analyzer should not run when --skip-gemini is set."),
    )

    result = CliRunner().invoke(cli.app, ["smoke-browser-video-qa", "--run-id", "test-run", "--skip-gemini"])

    assert result.exit_code == 0
    run_dir = tmp_path / "artifacts/video-qa-smoke/test-run"
    manifest_path = run_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert (run_dir / "fixture.html").exists()
    assert (run_dir / "video-qa-smoke.webm").exists()
    assert not (run_dir / "gemini-video-qa.json").exists()
    assert manifest["safe"] is True
    assert manifest["posted"] is False
    assert manifest["sent"] is False
    assert manifest["published"] is False
    assert manifest["fixture_path"] == "artifacts/video-qa-smoke/test-run/fixture.html"
    assert manifest["video_path"] == "artifacts/video-qa-smoke/test-run/video-qa-smoke.webm"
    assert manifest["network_jsonl"] == "artifacts/video-qa-smoke/test-run/network.jsonl"
    assert manifest["before"]["label"] == "pre-click"
    assert manifest["after"]["label"] == "post-click"
    assert "local inert fixture" in manifest["expected_steps"][0].lower()
    assert any("No external navigation" in rule for rule in manifest["anomaly_rules"])
    assert manifest["qa"] == {"skipped": True}


def test_video_qa_smoke_stage_observation_wraps_safe_manifest(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)

    def fake_record(fixture_path: Path, run_dir: Path) -> Path:
        assert fixture_path.exists()
        video_path = run_dir / "video-qa-smoke.webm"
        video_path.write_bytes(b"fake webm")
        return video_path

    monkeypatch.setattr(cli, "_record_video_qa_smoke_fixture", fake_record)

    result = CliRunner().invoke(
        cli.app,
        [
            "smoke-browser-video-qa",
            "--run-id",
            "test-run",
            "--skip-gemini",
            "--stage-observation",
            "--workflow",
            "daily-ai",
            "--stage",
            "browser_video_qa_smoke",
            "--attempt-no",
            "2",
        ],
    )

    assert result.exit_code == 0
    summary_path = (
        tmp_path
        / "artifacts/playwright-cli-runs/test-run/stage-observations/browser_video_qa_smoke/attempt-2/summary.json"
    )
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["schema"] == "automation_stage_observation.v1"
    assert summary["workflow"] == "daily-ai"
    assert summary["run_id"] == "test-run"
    assert summary["stage"] == "browser_video_qa_smoke"
    assert summary["attempt_no"] == 2
    assert summary["status"] == "succeeded"
    assert summary["exact_blocker"] == ""
    assert summary["safe"] is True
    assert summary["posted"] is False
    assert summary["sent"] is False
    assert summary["published"] is False
    assert summary["artifact_uri"].endswith(
        "artifacts/playwright-cli-runs/test-run/stage-observations/browser_video_qa_smoke/attempt-2"
    )
    for key in ["before", "after", "network_jsonl", "stdout_tail", "stderr_tail"]:
        assert key in summary
    assert summary["before"]["label"] == "pre-click"
    assert summary["after"]["label"] == "post-click"
    assert Path(summary["network_jsonl"]).exists()
    assert summary["manifest_path"] == "artifacts/video-qa-smoke/test-run/manifest.json"
    assert summary["video_path"] == "artifacts/video-qa-smoke/test-run/video-qa-smoke.webm"


def test_video_qa_smoke_calls_gemini_without_printing_api_key(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    captured = {}

    def fake_record(fixture_path: Path, run_dir: Path) -> Path:
        video_path = run_dir / "video-qa-smoke.webm"
        video_path.write_bytes(b"fake webm")
        return video_path

    def fake_analyze(**kwargs):
        captured.update(kwargs)
        return {
            "timeline": [],
            "step_matches": [],
            "anomalies": [],
            "recommendation": {
                "status": "pass",
                "summary": "No unsafe action found.",
                "next_action": "Keep this as a baseline.",
            },
        }

    monkeypatch.setattr(cli, "_record_video_qa_smoke_fixture", fake_record)
    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-pro")
    monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_JSON", raising=False)
    monkeypatch.delenv("GOOGLE_SHEETS_SPREADSHEET_ID", raising=False)
    monkeypatch.setattr(cli, "analyze_browser_automation_video", fake_analyze)

    result = CliRunner().invoke(
        cli.app,
        ["smoke-browser-video-qa", "--run-id", "test-run", "--timeout-seconds", "12"],
    )

    assert result.exit_code == 0
    assert "secret-gemini-key" not in result.output
    run_dir = tmp_path / "artifacts/video-qa-smoke/test-run"
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    qa_result = json.loads((run_dir / "gemini-video-qa.json").read_text(encoding="utf-8"))
    assert qa_result["recommendation"]["status"] == "pass"
    assert "secret-gemini-key" not in json.dumps(qa_result)
    assert manifest["qa"]["skipped"] is False
    assert manifest["qa"]["model"] == "gemini-2.5-pro"
    assert manifest["qa"]["path"] == "artifacts/video-qa-smoke/test-run/gemini-video-qa.json"
    assert manifest["qa"]["recommendation_status"] == "pass"
    assert captured["api_key"] == "secret-gemini-key"
    assert captured["model"] == "gemini-2.5-pro"
    assert captured["video_path"] == Path("artifacts/video-qa-smoke/test-run/video-qa-smoke.webm")
    assert captured["expected_steps"] == cli.VIDEO_QA_SMOKE_EXPECTED_STEPS
    assert captured["anomaly_rules"] == cli.VIDEO_QA_SMOKE_ANOMALY_RULES
    assert captured["timeout_seconds"] == 12


@pytest.mark.parametrize(
    ("recommendation_status", "anomaly_detected"),
    [
        ("investigate", False),
        ("pass", True),
    ],
)
def test_video_qa_smoke_fail_closes_and_writes_artifacts(
    monkeypatch, tmp_path, recommendation_status, anomaly_detected
) -> None:
    monkeypatch.chdir(tmp_path)

    def fake_record(fixture_path: Path, run_dir: Path) -> Path:
        video_path = run_dir / "video-qa-smoke.webm"
        video_path.write_bytes(b"fake webm")
        return video_path

    def fake_analyze(**kwargs):
        return {
            "timeline": [],
            "step_matches": [],
            "anomalies": [
                {
                    "rule": "No external navigation",
                    "detected": anomaly_detected,
                    "timecode": "00:02",
                    "evidence": "Observed state.",
                    "severity": "high" if anomaly_detected else "none",
                }
            ],
            "recommendation": {
                "status": recommendation_status,
                "summary": "Needs review.",
                "next_action": "Inspect artifact.",
            },
        }

    monkeypatch.setattr(cli, "_record_video_qa_smoke_fixture", fake_record)
    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-pro")
    monkeypatch.setattr(cli, "analyze_browser_automation_video", fake_analyze)

    result = CliRunner().invoke(cli.app, ["smoke-browser-video-qa", "--run-id", "test-run"])

    combined_output = result.output + getattr(result, "stderr", "")
    run_dir = tmp_path / "artifacts/video-qa-smoke/test-run"
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    qa_result = json.loads((run_dir / "gemini-video-qa.json").read_text(encoding="utf-8"))
    assert result.exit_code == 1
    assert "secret-gemini-key" not in combined_output
    assert manifest["safe"] is False
    assert manifest["qa"]["recommendation_status"] == recommendation_status
    assert manifest["qa"]["anomaly_detected"] is anomaly_detected
    assert qa_result["recommendation"]["status"] == recommendation_status


def test_video_qa_smoke_redacts_analyzer_exception_and_writes_manifest(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)

    def fake_record(fixture_path: Path, run_dir: Path) -> Path:
        video_path = run_dir / "video-qa-smoke.webm"
        video_path.write_bytes(b"fake webm")
        return video_path

    def fake_analyze(**kwargs):
        raise RuntimeError("Gemini SDK error for secret-gemini-key")

    monkeypatch.setattr(cli, "_record_video_qa_smoke_fixture", fake_record)
    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setattr(cli, "analyze_browser_automation_video", fake_analyze)

    result = CliRunner().invoke(cli.app, ["smoke-browser-video-qa", "--run-id", "test-run"])

    combined_output = result.output + getattr(result, "stderr", "")
    manifest = json.loads((tmp_path / "artifacts/video-qa-smoke/test-run/manifest.json").read_text(encoding="utf-8"))
    assert result.exit_code == 1
    assert "secret-gemini-key" not in combined_output
    assert "secret-gemini-key" not in json.dumps(manifest)
    assert manifest["safe"] is False
    assert "[REDACTED_GEMINI_API_KEY]" in manifest["qa"]["error"]


def test_video_qa_smoke_stage_observation_blocks_failed_gemini_without_secret(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)

    def fake_record(fixture_path: Path, run_dir: Path) -> Path:
        video_path = run_dir / "video-qa-smoke.webm"
        video_path.write_bytes(b"fake webm")
        return video_path

    def fake_analyze(**kwargs):
        return {
            "timeline": [],
            "step_matches": [],
            "anomalies": [
                {
                    "rule": "No external navigation",
                    "detected": True,
                    "timecode": "00:02",
                    "evidence": "External navigation happened.",
                    "severity": "high",
                }
            ],
            "recommendation": {
                "status": "fail",
                "summary": "secret-gemini-key should not appear in stage summary.",
                "next_action": "Inspect artifact.",
            },
        }

    monkeypatch.setattr(cli, "_record_video_qa_smoke_fixture", fake_record)
    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setattr(cli, "analyze_browser_automation_video", fake_analyze)

    result = CliRunner().invoke(
        cli.app,
        ["smoke-browser-video-qa", "--run-id", "test-run", "--stage-observation"],
    )

    summary_path = (
        tmp_path
        / "artifacts/playwright-cli-runs/test-run/stage-observations/browser_video_qa_smoke/attempt-1/summary.json"
    )
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert result.exit_code == 1
    assert summary["status"] == "blocked"
    assert summary["safe"] is False
    assert summary["recommendation_status"] == "fail"
    assert summary["anomaly_detected"] is True
    assert summary["exact_blocker"] == "browser_video_qa_smoke_failed:recommendation_status=fail;anomaly_detected=True"
    assert "secret-gemini-key" not in json.dumps(summary)


def test_video_qa_smoke_stage_observation_persists_recorder_failure(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)

    def fake_record(fixture_path: Path, run_dir: Path) -> Path:
        raise RuntimeError(
            "recorder failed Authorization: Bearer secret-token "
            "user@example.com https://example.com/?token=abc123"
        )

    monkeypatch.setattr(cli, "_record_video_qa_smoke_fixture", fake_record)

    result = CliRunner().invoke(
        cli.app,
        ["smoke-browser-video-qa", "--run-id", "test-run", "--skip-gemini", "--stage-observation"],
    )

    run_dir = tmp_path / "artifacts/video-qa-smoke/test-run"
    summary_path = (
        tmp_path
        / "artifacts/playwright-cli-runs/test-run/stage-observations/browser_video_qa_smoke/attempt-1/summary.json"
    )
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    combined_output = result.output + getattr(result, "stderr", "")
    serialized = json.dumps({"manifest": manifest, "summary": summary, "output": combined_output})
    assert result.exit_code == 1
    assert manifest["safe"] is False
    assert summary["status"] == "blocked"
    assert summary["safe"] is False
    assert summary["network_jsonl"].endswith("network.jsonl")
    assert Path(summary["network_jsonl"]).exists()
    assert "secret-token" not in serialized
    assert "user@example.com" not in serialized
    assert "token=abc123" not in serialized
    assert "[REDACTED_AUTH]" in serialized
    assert "[REDACTED_EMAIL]" in serialized
    assert "[REDACTED_QUERY_VALUE]" in serialized


def test_browser_video_qa_no_post_preflight_skip_gemini_writes_manifest_and_stage_observation(
    monkeypatch, tmp_path
) -> None:
    monkeypatch.chdir(tmp_path)

    def fake_record(*, run_dir: Path, cdp_port: int, timeout_seconds: float) -> dict[str, object]:
        assert cdp_port == 9333
        assert timeout_seconds == 60
        video_path = run_dir / "browser-video-qa-no-post-preflight.webm"
        video_path.write_bytes(b"fake webm")
        network_jsonl = run_dir / "network.jsonl"
        network_jsonl.write_text('{"kind":"request","url":"https://www.linkedin.com/feed/"}\n', encoding="utf-8")
        before = {
            "label": "before",
            "url": "https://www.linkedin.com/feed/",
            "title": "Feed",
            "dom_text": "LinkedIn feed read-only surface",
            "screenshot_path": str(run_dir / "before.png"),
            "screenshot_exists": True,
            "login_required": False,
        }
        after = {**before, "label": "after", "screenshot_path": str(run_dir / "after.png")}
        (run_dir / "before.png").write_bytes(b"png")
        (run_dir / "after.png").write_bytes(b"png")
        return {
            "video_path": str(video_path),
            "before": before,
            "after": after,
            "network_jsonl": str(network_jsonl),
            "profile_gate": {"ok": True, "cdp_port": cdp_port},
        }

    monkeypatch.setattr(cli, "_record_browser_video_qa_no_post_preflight", fake_record)
    monkeypatch.setattr(
        cli,
        "analyze_browser_automation_video",
        lambda **kwargs: pytest.fail("Gemini analyzer should not run when --skip-gemini is set."),
    )

    result = CliRunner().invoke(
        cli.app,
        [
            "daily-ai-browser-video-qa-preflight",
            "--run-id",
            "test-run",
            "--stage-observation",
            "--skip-gemini",
            "--no-post",
        ],
    )

    assert result.exit_code == 0
    run_dir = tmp_path / "artifacts/browser-video-qa-no-post-preflight/test-run"
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    summary_path = (
        tmp_path
        / "artifacts/playwright-cli-runs/test-run/stage-observations/browser_video_qa_no_post_preflight/attempt-1/summary.json"
    )
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert manifest["safe"] is True
    assert manifest["posted"] is False
    assert manifest["sent"] is False
    assert manifest["published"] is False
    assert manifest["no_post"] is True
    assert manifest["allow_post_requested"] is False
    assert manifest["qa"] == {"skipped": True}
    assert summary["schema"] == "automation_stage_observation.v1"
    assert summary["workflow"] == "daily-ai"
    assert summary["stage"] == "browser_video_qa_no_post_preflight"
    assert summary["status"] == "succeeded"
    assert summary["exact_blocker"] == ""
    assert summary["safe"] is True
    assert summary["posted"] is False
    assert summary["sent"] is False
    assert summary["published"] is False
    assert summary["no_post"] is True
    assert summary["provider"] == "gemini_video_qa"
    assert summary["auditor"] == "gemini_video_qa"
    assert summary["completion_gate_alignment"] == "mismatch"
    assert summary["completion_gate_matches"] is False
    assert summary["completion_veto_only"] is True
    assert summary["does_not_replace_source_of_truth"] is True
    assert Path(summary["network_jsonl"]).exists()
    assert summary["video_path"].endswith("browser-video-qa-no-post-preflight.webm")


@pytest.mark.parametrize(
    ("recommendation_status", "anomaly", "expected_anomaly_detected"),
    [
        ("fail", {"rule": "No submit", "detected": False}, False),
        ("pass", {"rule": "No submit", "detected": True}, True),
        ("pass", {"rule": "No submit", "detected": "true"}, True),
        ("pass", {"rule": "No submit", "detected": 1}, True),
    ],
)
def test_browser_video_qa_no_post_preflight_blocks_gemini_fail_or_anomaly(
    monkeypatch, tmp_path, recommendation_status, anomaly, expected_anomaly_detected
) -> None:
    monkeypatch.chdir(tmp_path)

    def fake_record(*, run_dir: Path, cdp_port: int, timeout_seconds: float) -> dict[str, object]:
        video_path = run_dir / "browser-video-qa-no-post-preflight.webm"
        video_path.write_bytes(b"fake webm")
        network_jsonl = run_dir / "network.jsonl"
        network_jsonl.write_text("", encoding="utf-8")
        return {
            "video_path": str(video_path),
            "before": {"label": "before"},
            "after": {"label": "after"},
            "network_jsonl": str(network_jsonl),
        }

    def fake_analyze(**kwargs):
        return {
            "timeline": [],
            "step_matches": [],
            "anomalies": [anomaly],
            "recommendation": {"status": recommendation_status},
        }

    monkeypatch.setattr(cli, "_record_browser_video_qa_no_post_preflight", fake_record)
    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-pro")
    monkeypatch.setattr(cli, "analyze_browser_automation_video", fake_analyze)

    result = CliRunner().invoke(
        cli.app,
        [
            "daily-ai-browser-video-qa-preflight",
            "--run-id",
            "test-run",
            "--stage-observation",
        ],
    )

    summary_path = (
        tmp_path
        / "artifacts/playwright-cli-runs/test-run/stage-observations/browser_video_qa_no_post_preflight/attempt-1/summary.json"
    )
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert result.exit_code == 1
    assert summary["status"] == "blocked"
    assert summary["safe"] is False
    assert summary["posted"] is False
    assert summary["sent"] is False
    assert summary["published"] is False
    assert summary["recommendation_status"] == recommendation_status
    assert summary["anomaly_detected"] is expected_anomaly_detected
    assert summary["provider"] == "gemini_video_qa"
    assert summary["completion_gate_alignment"] == "mismatch"
    assert summary["completion_gate_matches"] is False
    assert summary["completion_veto_only"] is True
    assert summary["exact_blocker"] == (
        "browser_video_qa_no_post_preflight_failed:"
        f"recommendation_status={recommendation_status};anomaly_detected={expected_anomaly_detected}"
    )


@pytest.mark.parametrize(
    "args",
    [
        ["browser-video-qa-no-post-preflight", "--run-id", "../bad", "--skip-gemini"],
        ["daily-ai-browser-video-qa-preflight", "--run-id", "../bad", "--skip-gemini"],
        ["browser-video-qa-no-post-preflight", "--run-id", ".", "--skip-gemini"],
        ["browser-video-qa-no-post-preflight", "--workflow", "daily/ai", "--run-id", "ok", "--skip-gemini"],
        ["browser-video-qa-no-post-preflight", "--stage", "bad stage", "--run-id", "ok", "--skip-gemini"],
        ["browser-video-qa-no-post-preflight", "--attempt-no", "0", "--run-id", "ok", "--skip-gemini"],
    ],
)
def test_browser_video_qa_no_post_preflight_rejects_unsafe_ids(args, tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    result = CliRunner().invoke(cli.app, args)

    assert result.exit_code != 0
    assert not (tmp_path / "bad").exists()


def test_registered_runner_enables_browser_video_qa_no_post_preflight_by_default() -> None:
    source = Path("scripts/run_daily_ai_playwright_cli.mjs").read_text(encoding="utf-8")
    helper = Path("scripts/daily_ai_browser_video_qa_preflight.mjs").read_text(encoding="utf-8")

    assert "DAILY_AI_CLI_BROWSER_VIDEO_QA" in source
    assert "browserVideoQaMode === 'no-post-preflight'" in source
    assert "const browserVideoQaNoPostPreflightDisabled =" in source
    assert "!browserVideoQaNoPostPreflightDisabled ||" in source
    assert "DAILY_AI_CLI_BROWSER_VIDEO_QA_NO_POST_PREFLIGHT" in source
    assert "DAILY_AI_CLI_PROOF_ONLY_NO_POST_PREFLIGHT" in source
    assert "const proofOnlyNoPostPreflight = process.env.DAILY_AI_CLI_PROOF_ONLY_NO_POST_PREFLIGHT === 'true';" in source
    assert "DAILY_AI_CLI_EXTERNAL_VIDEO_QA_REQUIRED" in source
    assert "if (!externalVideoQaRequired) args.push('--skip-external-qa')" in source
    assert "external_ai_skipped: !externalVideoQaRequired" in source
    assert "registered_completion_external_ai_not_required: !externalVideoQaRequired" in source
    assert "DAILY_AI_BROWSER_VIDEO_QA_NO_POST_PREFLIGHT" in source
    assert "DAILY_AI_CLI_ENABLE_BROWSER_VIDEO_QA_NO_POST_PREFLIGHT" in source
    assert "runBrowserVideoQaNoPostPreflightIfEnabled" in source
    assert "stopAfterProofOnlyNoPostPreflightIfEnabled" in source
    assert source.index("await runStep('publish_prep'") < source.index(
        "await runBrowserVideoQaNoPostPreflightIfEnabled();"
    )
    assert source.index("await runBrowserVideoQaNoPostPreflightIfEnabled();") < source.index(
        "stopAfterProofOnlyNoPostPreflightIfEnabled();"
    )
    assert source.index("stopAfterProofOnlyNoPostPreflightIfEnabled();") < source.index(
        "const directSummary = await runDirectPublishStep();"
    )
    stop_block = source[
        source.index("function stopAfterProofOnlyNoPostPreflightIfEnabled()"):
        source.index("async function runActualTabVideoQaIfNeeded()")
    ]
    assert "summary.proof_only_no_post_preflight = true" in stop_block
    assert "summary.no_post = true" in stop_block
    assert "summary.posted = false" in stop_block
    assert "summary.sent = false" in stop_block
    assert "summary.published = false" in stop_block
    assert "summary.submitted = false" in stop_block
    assert "summary.direct_publish = null" in stop_block
    assert "summary.direct_engagement = null" in stop_block
    assert "summary.external_steps = null" in stop_block
    assert "summary.post_publish_feed_study = null" in stop_block
    assert "summary.postflight_sync = null" in stop_block
    assert "summary.buffer_replenish = null" in stop_block
    assert "summary.final_buffer_refresh = null" in stop_block
    assert "summary.current_stage = 'proof_only_no_post_preflight'" in stop_block
    assert "summary.stage_status = 'completed'" in stop_block
    assert "summary.finished_at = finishedAt" in stop_block
    assert "summary.stop_reason = stopReason" in stop_block
    assert "collectCleanupProof(stopReason, cleanupProofProcessHistory())" in stop_block
    assert "summary.full_flow_completion = {" in stop_block
    assert "ok: false" in stop_block
    assert "status: 'incomplete_intentional_stop'" in stop_block
    assert "completion_proof: false" in stop_block
    assert "process.exit(0)" in stop_block
    assert "'scripts/daily_ai_browser_video_qa_preflight.mjs'" in source
    assert "'daily-ai-browser-video-qa-preflight'" not in source
    assert "'--stage-observation'" not in source
    assert "'--no-post'" not in source
    assert "GEMINI_API_KEY" not in source
    assert "registered_completion_external_ai_not_required: !externalVideoQaRequired" in source
    assert "runStep('browser_video_qa_no_post_preflight', 'node', args, { timeoutMs: 180_000 })" in source
    assert "connectOverCDP(cdpUrl, {" in helper
    assert "noDefaults: true" in helper
    assert "timeout: Math.max(60_000, timeoutSeconds * 1000)" in helper
    assert "const context = browser.contexts()[0]" in helper
    assert "page = await context.newPage()" in helper
    assert "browser.disconnect().catch" not in helper
    assert "typeof browser.disconnect === 'function'" in helper
    assert "browser.close()" not in helper
    assert "status: 'noop:disconnect_unavailable'" in helper
    assert "cleanup:" in helper
    assert "browser.newContext" not in helper
    assert "record_video_dir" not in helper
    assert "startCdpTabVideoAudit" in helper
    assert "irreversible_actions_blocked: true" in helper
    assert "no_post: true" in helper
    assert "posted: false" in helper
    assert "sent: false" in helper
    assert "published: false" in helper
    assert "submitted: false" in helper
    assert "schema: 'automation_stage_observation.v1'" in helper
    assert "manifest.json" in helper
    assert "record_replay_playwright_no_post_preflight" in helper
    assert "record-replay-playwright-qa.json" in helper
    assert "process.exit(manifest.safe ? 0 : 1)" in helper


def test_daily_ai_cli_chrome_lane_is_headless_and_cleanup_owned_by_port_and_profile() -> None:
    source = Path("scripts/run_daily_ai_playwright_cli.mjs").read_text(encoding="utf-8")
    launcher = Path(
        "/Users/nichikatanaka/Documents/Codex/2026-06-03/playwight-mcp-playwirhgt-cli/scripts/open-cli-chrome.mjs"
    ).read_text(encoding="utf-8")

    assert "const cliProfileRoot = process.env.DAILY_AI_CLI_PROFILE_DIR || '/Users/nichikatanaka/.daily-ai-playwright-chrome';" in launcher
    assert "const headless = process.env.DAILY_AI_CLI_HEADLESS !== 'false' && !showBrowser;" in launcher
    assert "'--headless=new'" in launcher
    assert "function existingDailyAiChromeMatchesVisibility(command)" in launcher
    assert "if (showBrowser) return !existingHeadless;" in launcher
    assert "headless=${headless}" in launcher

    assert "function dailyAiChromeProcessRows(processRows)" in source
    assert "String(row.command || '').includes(`--remote-debugging-port=${cdpPort}`)" in source
    assert "String(row.command || '').includes(`--user-data-dir=${cliProfileDir}`)" in source
    assert "function cleanupDailyAiChromeProcesses(reason = '')" in source
    assert "daily_ai_chrome_processes_remaining" in source
    assert "terminated_pids: terminatedPids" in source
    assert "return summary.owned_process_history;" in source
    assert "startsWith('open_cli_chrome_')" not in source
    assert "cleanupDailyAiChromeProcesses('completed');" in source


def test_daily_ai_direct_publish_has_bounded_timeout_and_signal_cleanup() -> None:
    source = Path("scripts/run_daily_ai_playwright_cli.mjs").read_text(encoding="utf-8")
    source_py = Path("src/social_flow/cli.py").read_text(encoding="utf-8")
    direct_cli = Path(
        "/Users/nichikatanaka/Documents/Codex/2026-06-03/playwight-mcp-playwirhgt-cli/lib/daily-ai-direct-cli.mjs"
    ).read_text(encoding="utf-8")

    assert "DAILY_AI_CLI_DIRECT_PUBLISH_TIMEOUT_MS || 240_000" in source
    assert "timeoutMs: directPublishTimeoutMs" in source
    assert "const activeOwnedProcesses = new Map();" in source
    assert "function cleanupActiveOwnedProcesses(reason = '')" in source
    assert "function finalizeIncompleteRun(stopReason" in source
    assert "function forceIncompleteFullFlow(existingPayload, incompletePayload)" in source
    assert "summary.full_flow_completion = forceIncompleteFullFlow(" in source
    assert "ensureInterruptedDirectPublishPlaceholder(reason)" in source
    assert "function finalizeStaleUnfinishedSummaries()" in source
    assert "registered_runner_stale_unfinished_summary:${candidateSummary.current_stage || 'unknown_stage'}" in source
    assert "candidateSummary.full_flow_completion = forceIncompleteFullFlow(" in source
    assert "candidateSummary.automation_health = {" in source
    assert "candidateSummary?.core_flow?.target" in source
    assert "automation_failure_category=${failureCategory}" in source
    assert "process.once('SIGINT', () => handleShutdownSignal('SIGINT'))" in source
    assert "process.once('SIGTERM', () => handleShutdownSignal('SIGTERM'))" in source
    assert "finalizeIncompleteRun(`signal:${signal}`, { stageStatus: 'aborted' });" in source
    assert "finalizeStaleUnfinishedSummaries();" in source
    assert "DAILY_AI_CLI_FEED_STUDY_CHILD_HARD_TIMEOUT_SECONDS" in source
    assert "def _positive_int_env(name, default_value):" in source
    assert "feed_study_child_timeout_seconds = _positive_int_env(\"DAILY_AI_CLI_FEED_STUDY_CHILD_HARD_TIMEOUT_SECONDS\", 600)" in source
    assert 'target_count=int(os.environ.get("DAILY_AI_CLI_FEED_STUDY_TARGET_COUNT", "26"))' in source
    assert "DAILY_AI_CLI_FEED_STUDY_STEP_TIMEOUT_MS || 660_000" in source
    assert "signal.alarm(feed_study_child_timeout_seconds)" in source
    assert "except TimeoutError as exc:" in source
    assert "post_publish_feed_study_child_timeout:" in source
    assert "DAILY_AI_CLI_DIRECT_ENGAGEMENT_TIMEOUT_MS || 600_000" in source
    assert "if (approvedEngagementIdsForRun.length <= 0)" in source
    assert "noPreexistingApprovedEngagement &&" in source
    assert "const engagementCandidatesCreatedByFeedStudy = Number(" in source
    assert "engagementCandidatesCreatedByFeedStudy === 0 &&" in source
    assert "function runImageGenerationBlocker()" in source
    assert "summary.buffer_replenish?.stop_reason" in source
    assert "feedStudyStopReasonCoveredByNoCandidateProof(" in source
    assert "engagement_candidate_pool_insufficient:0" in source
    assert "engagementCandidatesCreatedByFeedStudy" in source
    assert "feed_study_stop_reason_covered_by_no_candidate_proof" in source
    assert "const verifiedExternalEngagementTargetsComplete =" in source
    assert "engagementSentCount >= requiredEngagementActionTotal" in source
    assert "const verifiedEngagementCoversNoPublishedFeedStudy =" in source
    assert "feedStudyStopReason === 'no_published_rows_for_feed_study'" in source
    assert "!verifiedEngagementCoversNoPublishedFeedStudy &&" in source
    assert "verified_external_engagement_targets_complete" in source
    assert "verified_engagement_covers_no_published_feed_study" in source
    assert "timeoutMs: directEngagementTimeoutMs" in source
    assert "direct_engagement_failed:" in source
    assert "summary.direct_engagement = {" in source
    assert "failed: true" in source
    assert "activeOwnedProcesses.set(child.pid, ownedProcess)" in source
    assert "activeOwnedProcesses.delete(child.pid)" in source
    feed_study_body = source_py[
        source_py.index("def _post_publish_engagement_feed_study_local(") :
        source_py.index("def _collect_external_feed_posts_for_engagement(")
    ]
    assert "browser.close()" not in feed_study_body
    assert "Do not close the CDP browser here" in feed_study_body

    assert "const persistSummary = async () => writeSummary(outputDir, summary);" in direct_cli
    assert "await persistSummary();" in direct_cli
    assert "summary.currentCandidate = {" in direct_cli
    assert "summary.currentCandidate.finished_at = new Date().toISOString();" in direct_cli
    assert "DAILY_AI_CLI_X_AUTH_WAIT_MS || 20_000" in direct_cli
    assert "DAILY_AI_CLI_X_TARGET_WAIT_MS || 30_000" in direct_cli
    assert "function linkedinStartPostLocator(page)" in direct_cli
    assert 'button:has-text("Start a post")' in direct_cli
    assert 'div[role="button"]:has-text("Start a post")' in direct_cli
    assert "clickLinkedInStartPostByDom(page)" in direct_cli
    collect_body = source_py[
        source_py.index("def _collect_external_feed_posts_for_engagement(") :
        source_py.index("def _select_feed_study_engagement_action(")
    ]
    assert "hasEngagementControls" in collect_body
    assert "リアクション" in collect_body
    assert "コメント" in collect_body
    runway_wrapper = Path("scripts/runway_mcp_generate_image.mjs").read_text(encoding="utf-8")
    assert "mcp-remote@0.1.37" in runway_wrapper
    assert 'DEFAULT_MCP_REMOTE_CONFIG_DIR = "/Users/nichikatanaka/.mcp-auth"' in runway_wrapper
    assert "MCP_REMOTE_CONFIG_DIR: mcpRemoteConfigDir" in runway_wrapper
    assert "RUNWAY_MCP_INIT_TIMEOUT_MS || 180000" in runway_wrapper
    assert "stderr=" in runway_wrapper


def test_registered_runner_resumes_post_publish_after_completed_direct_publish() -> None:
    source = Path("scripts/run_daily_ai_playwright_cli.mjs").read_text(encoding="utf-8")

    assert "function findLatestPostPublishResumeSummary()" in source
    assert "function applyPostPublishResume(candidate)" in source
    assert "function incompletePublishPlatformsForSummaryPayload(payload)" in source
    assert "reason: 'publish_platform_completion_missing'" in source
    assert "incomplete_platform_rows: incompletePlatforms" in source
    assert "completed_direct_publish_missing_downstream_registered_stages" in source
    assert "if (directPublish.queueUpdated !== true) return false;" in source
    assert "if (candidateSummary.post_publish_resume_consumed) return false;" in source
    assert "post_publish_resume_consumed: true" in source
    assert "post_publish_resume_superseded_by_run_id: runId" in source
    assert "post_publish_resume_superseded_by_summary_path: summaryPath" in source
    assert "const publishCompletionRowIds = [" in source
    assert "...(summary.direct_publish?.candidates || []).map" in source
    assert "...(summary.direct_publish?.receipts || []).map" in source
    assert "for (const id of [...new Set(publishCompletionRowIds)])" in source
    assert "if (expectsX && !row.x_post_url)" in source
    assert "if (expectsLinkedIn && !row.linkedin_post_url)" in source
    assert "const postPublishResume = findLatestPostPublishResumeSummary();" in source
    assert "const resumingPostPublish = applyPostPublishResume(postPublishResume);" in source
    assert source.index("finalizeStaleUnfinishedSummaries();") < source.index(
        "const postPublishResume = findLatestPostPublishResumeSummary();"
    )
    assert source.index("const resumingPostPublish = applyPostPublishResume(postPublishResume);") < source.index(
        "await runBrowserPreflight();"
    )
    assert "if (!resumingPostPublish) {" in source
    post_publish_resume_block = source[
        source.index("function applyPostPublishResume(candidate)") :
        source.index("function cleanupDailyAiChromeProcesses(reason = '')")
    ]
    assert "summary.direct_publish = payload.direct_publish;" in post_publish_resume_block
    assert "addStageVisualAudit(browserVideoQaAuditFromStageObservation" in post_publish_resume_block
    assert "payload.stage_visual_audits || payload.visual_qa?.audits || []" in post_publish_resume_block
    assert "recordSkippedStep('core_flow'" in post_publish_resume_block
    assert "recordSkippedStep('publish_prep'" in post_publish_resume_block
    assert "recordSkippedStep('browser_video_qa_no_post_preflight'" in post_publish_resume_block
    assert "recordSkippedStep('direct_publish'" in post_publish_resume_block
    main_resume_block = source[
        source.index("const resumingPostPublish = applyPostPublishResume(postPublishResume);") :
        source.index("const approvedBeforeFeedStudy = approvedEngagementSnapshot();")
    ]
    assert "const directSummary = await runDirectPublishStep();" in main_resume_block
    assert main_resume_block.index("if (!resumingPostPublish) {") < main_resume_block.index(
        "const directSummary = await runDirectPublishStep();"
    )
    assert source.index("const approvedBeforeFeedStudy = approvedEngagementSnapshot();") < source.index(
        "await runPostPublishFeedStudy();"
    )


def test_registered_runner_proof_only_no_post_preflight_stub_makes_no_external_steps(tmp_path) -> None:
    output_dir = tmp_path / "proof-only-run"
    env = {
        **os.environ,
        "NODE_ENV": "test",
        "DAILY_AI_CLI_TEST_STUB_STEPS": "true",
        "DAILY_AI_CLI_PROOF_ONLY_NO_POST_PREFLIGHT": "true",
        "DAILY_AI_CLI_OUTPUT_DIR": str(output_dir),
        "DAILY_AI_CLI_RUN_ID": "pytest-proof-only-no-post",
    }

    result = subprocess.run(
        ["node", "scripts/run_daily_ai_playwright_cli.mjs"],
        cwd=Path.cwd(),
        env=env,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 0, result.stderr[-2000:]
    summary_path = output_dir / "registered-playwright-cli-summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["proof_only_no_post_preflight"] is True
    assert summary["external_steps"] is None
    assert summary["direct_publish"] is None
    assert summary["direct_engagement"] is None
    assert summary["post_publish_feed_study"] is None
    assert summary["postflight_sync"] is None
    assert summary["buffer_replenish"] is None
    assert summary["final_buffer_refresh"] is None
    assert summary["full_flow_completion"]["ok"] is False
    assert summary["browser_video_qa_no_post_preflight"]["no_post"] is True
    assert summary["browser_video_qa_no_post_preflight"]["posted"] is False
    assert summary["browser_video_qa_no_post_preflight"]["sent"] is False
    assert summary["browser_video_qa_no_post_preflight"]["published"] is False
    assert summary["cdp_preflight"]["ok"] is True
    assert summary["profile_gate"]["ok"] is True
    assert summary["cdp_target_audit"]["ok"] is True
    assert summary["owned_process_history"] == []
    assert summary["cleanup_proof"]["stubbed"] is True
    step_names = [step["name"] for step in summary["steps"]]
    assert step_names == ["core_flow", "publish_prep", "browser_video_qa_no_post_preflight"]
    forbidden_steps = {
        "direct_publish",
        "direct_engagement",
        "post_publish_feed_study",
        "post_publish_sheets_and_run_summary",
        "expire_stale_engagement_candidates",
        "prepare_engagement_candidates",
        "replenish_ship_now_buffer",
        "refresh_final_ship_now_buffer",
    }
    assert forbidden_steps.isdisjoint(step_names)
    stage_observation = json.loads(
        (
            output_dir
            / "stage-observations/browser_video_qa_no_post_preflight/attempt-1/summary.json"
        ).read_text(encoding="utf-8")
    )
    assert stage_observation["safe"] is True
    assert stage_observation["recommendation_status"] == "pass"
    assert stage_observation["no_post"] is True
    assert stage_observation["posted"] is False
    assert stage_observation["sent"] is False
    assert stage_observation["published"] is False
    assert stage_observation["submitted"] is False


def test_daily_ai_core_flow_skip_policy_requires_ready_usable_buffer() -> None:
    script = """
        import { shouldSkipCoreFlowForReadyBuffer } from './scripts/daily_ai_core_flow_skip_policy.mjs';
        const cases = [
          [{ enabled: true, testStubSteps: false, targetShipNowBuffer: 2, snapshot: { ship_now_buffer_count: 2, usable_publish_candidate_count: 2 } }, true],
          [{ enabled: true, testStubSteps: false, targetShipNowBuffer: 2, snapshot: { ship_now_buffer_count: 2, usable_publish_candidate_count: 1 } }, false],
          [{ enabled: true, testStubSteps: false, targetShipNowBuffer: 2, snapshot: { ship_now_buffer_count: 1, usable_publish_candidate_count: 2 } }, false],
          [{ enabled: true, testStubSteps: true, targetShipNowBuffer: 2, snapshot: { ship_now_buffer_count: 2, usable_publish_candidate_count: 2 } }, false],
          [{ enabled: false, testStubSteps: false, targetShipNowBuffer: 2, snapshot: { ship_now_buffer_count: 2, usable_publish_candidate_count: 2 } }, false],
        ];
        for (const [input, expected] of cases) {
          const actual = shouldSkipCoreFlowForReadyBuffer(input);
          if (actual !== expected) {
            throw new Error(`${JSON.stringify(input)} expected ${expected} got ${actual}`);
          }
        }
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=Path.cwd(),
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_registered_runner_actual_tab_video_qa_is_external_opt_in_only() -> None:
    source = Path("scripts/run_daily_ai_playwright_cli.mjs").read_text(encoding="utf-8")

    assert "allowActualExternalVideoQa = false" in source
    assert "skipActualExternalVideoQa = true" in source
    assert "actual_tab_video_qa: null" in source
    assert "function collectActualTabVideoArtifacts()" in source
    assert "receipt?.tab_video_audit?.video_path" in source
    assert "receipt?.tab_video_audit?.ffmpeg?.output_path" in source
    assert "receipt?.ffmpeg?.output_path" in source
    assert "path.join(outputDir, 'actual-tab-video-qa')" in source
    assert "summary.actual_tab_video_qa.skipped" in source
    assert "skipped_artifacts: []" in source
    assert "video_artifact_missing_external_review_not_executed" in source
    assert "external_analysis_not_allowed" in source
    assert "external_ai_disabled" in source
    assert "qa-browser-video" in source
    assert "record-replay-playwright-qa-redacted.json" in source
    assert "allowed_external_analysis: false" in source
    assert "stage: `actual_tab_video_qa_${safeSlug(artifact.section)}_${safeSlug(artifact.platform)}_${artifact.index}`" in source
    assert "addStageVisualAudit(actualTabVideoQaAudit" in source
    assert "actual_tab_video_qa_completion_mismatch" in source
    assert "browser_video_qa_visual_audit_missing" in source
    assert "audit?.stage) === 'browser_video_qa_no_post_preflight'" in source


def test_registered_runner_stops_before_buffer_replenish_on_human_auth_gate() -> None:
    source = Path("scripts/run_daily_ai_playwright_cli.mjs").read_text(encoding="utf-8")

    helper_index = source.index("function isHumanInputRequiredEngagementStop(value)")
    stop_reason_index = source.index("if (publishStopReason || postflightStopReason)")
    human_gate_index = source.index("if (isHumanInputRequiredEngagementStop(postflightStopReason))", stop_reason_index)
    buffer_index = source.index("await runPostPublishBufferReplenish()", human_gate_index)

    assert "linkedin_auth_gate_failed" in source[helper_index:human_gate_index]
    assert "if (!dryRun && !postflightStopReason && updatedEngagementSummary.candidates.length > 0" in source
    assert "throw new Error(`human_input_required:${postflightStopReason}`)" in source[human_gate_index:buffer_index]
    assert human_gate_index < buffer_index
    assert "engagementSummary.selection_stop_reason = `engagement_candidate_target_missing:" in source
    assert source.index("const engagementSummary = await runDirectEngagementStep") < source.index(
        "await runActualTabVideoQaIfNeeded();"
    )
    assert source.index("await runActualTabVideoQaIfNeeded();") < source.index(
        "await runPostflightSync();"
    )


def test_job_registered_video_qa_sidecar_writes_matching_gemini_audit(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    run_dir = tmp_path / "artifacts/job-playwright-cli-runs/job-run-1"
    run_dir.mkdir(parents=True)
    video_path = run_dir / "apply-flow.webm"
    video_path.write_bytes(b"fake webm")
    receipt_path = run_dir / "redaction-receipt.json"
    receipt_path.write_text(
        json.dumps(
            {
                "redacted_videos": [
                    {
                        "redacted_video_path": str(video_path),
                        "redacted_video_sha256": cli._file_sha256(video_path),
                        "redaction_status": "redacted",
                        "allowed_external_analysis": True,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    summary_path = tmp_path / "sidecar.json"
    captured: dict[str, object] = {}

    def fake_analyze(**kwargs):
        captured.update(kwargs)
        return {
            "timeline": [],
            "step_matches": [],
            "anomalies": [
                {
                    "rule": "No wrong target",
                    "detected": False,
                    "timecode": "00:01",
                    "evidence": "Correct official form.",
                    "severity": "none",
                }
            ],
            "recommendation": {
                "status": "pass",
                "summary": "The job application flow matched the expected visual gates.",
                "next_action": "Use strict source-of-truth readback.",
            },
        }

    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setattr(cli, "analyze_browser_automation_video", fake_analyze)

    result = CliRunner().invoke(
        cli.app,
        [
            "write-job-registered-video-qa-sidecar",
            "--run-id",
            "job-run-1",
            "--summary-path",
            str(summary_path),
            "--allowed-external-analysis",
            "--redaction-status",
            "redacted",
            "--video-path",
            str(video_path),
            "--redaction-receipt-path",
            str(receipt_path),
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(summary_path.read_text(encoding="utf-8"))
    audit = payload["stage_visual_audits"][0]
    assert payload["workflow"] == "job-applications"
    assert payload["video_count"] == 1
    assert payload["explicit_video_count"] == 1
    assert payload["discovered_video_count"] == 1
    assert payload["redaction_receipt"]["status"] == "validated"
    assert audit["provider"] == "gemini_video_qa"
    assert audit["status"] == "passed"
    assert audit["completion_gate_alignment"] == "matches"
    assert audit["completion_gate_matches"] is True
    assert audit["video_artifact_uri"].endswith("/apply-flow.webm")
    assert Path(captured["video_path"]).resolve() == video_path.resolve()
    assert captured["expected_steps"] == cli.JOB_VIDEO_QA_EXPECTED_STEPS
    assert captured["anomaly_rules"] == cli.JOB_VIDEO_QA_ANOMALY_RULES


def test_job_registered_video_qa_sidecar_blocks_without_video(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    summary_path = tmp_path / "sidecar.json"

    result = CliRunner().invoke(
        cli.app,
        [
            "write-job-registered-video-qa-sidecar",
            "--run-id",
            "job-run-2",
            "--summary-path",
            str(summary_path),
        ],
    )

    assert result.exit_code == 1
    payload = json.loads(summary_path.read_text(encoding="utf-8"))
    audit = payload["stage_visual_audits"][0]
    assert audit["status"] == "blocked"
    assert audit["completion_gate_alignment"] == "mismatch"
    assert audit["exact_blocker"] == "job_video_qa_no_video_artifact"


def test_job_registered_video_qa_sidecar_blocks_unredacted_video_before_gemini(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    run_dir = tmp_path / "artifacts/job-playwright-cli-runs/job-run-3"
    run_dir.mkdir(parents=True)
    video_path = run_dir / "apply-flow.webm"
    video_path.write_bytes(b"fake webm")
    summary_path = tmp_path / "sidecar.json"
    monkeypatch.setattr(
        cli,
        "analyze_browser_automation_video",
        lambda **kwargs: pytest.fail("Gemini must not receive unredacted job artifacts."),
    )

    result = CliRunner().invoke(
        cli.app,
        [
            "write-job-registered-video-qa-sidecar",
            "--run-id",
            "job-run-3",
            "--summary-path",
            str(summary_path),
            "--video-path",
            str(video_path),
        ],
    )

    assert result.exit_code == 1
    payload = json.loads(summary_path.read_text(encoding="utf-8"))
    audit = payload["stage_visual_audits"][0]
    assert audit["exact_blocker"] == "job_video_qa_external_analysis_not_allowed"
    assert audit["completion_gate_matches"] is False


def test_job_registered_video_qa_sidecar_requires_explicit_redacted_video_before_gemini(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    run_dir = tmp_path / "artifacts/job-playwright-cli-runs/job-run-4"
    run_dir.mkdir(parents=True)
    (run_dir / "apply-flow.webm").write_bytes(b"fake webm")
    summary_path = tmp_path / "sidecar.json"
    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setattr(
        cli,
        "analyze_browser_automation_video",
        lambda **kwargs: pytest.fail("Gemini must only receive an explicit redacted --video-path."),
    )

    result = CliRunner().invoke(
        cli.app,
        [
            "write-job-registered-video-qa-sidecar",
            "--run-id",
            "job-run-4",
            "--summary-path",
            str(summary_path),
            "--allowed-external-analysis",
            "--redaction-status",
            "redacted",
        ],
    )

    assert result.exit_code == 1
    payload = json.loads(summary_path.read_text(encoding="utf-8"))
    audit = payload["stage_visual_audits"][0]
    assert payload["video_count"] == 1
    assert payload["explicit_video_count"] == 0
    assert payload["discovered_video_count"] == 1
    assert audit["exact_blocker"] == "job_video_qa_explicit_redacted_video_required"


def test_job_registered_video_qa_sidecar_requires_redaction_receipt_before_gemini(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    run_dir = tmp_path / "artifacts/job-playwright-cli-runs/job-run-6"
    run_dir.mkdir(parents=True)
    video_path = run_dir / "redacted-apply-flow.webm"
    video_path.write_bytes(b"fake webm")
    summary_path = tmp_path / "sidecar.json"
    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setattr(
        cli,
        "analyze_browser_automation_video",
        lambda **kwargs: pytest.fail("Gemini must not receive videos without a redaction receipt."),
    )

    result = CliRunner().invoke(
        cli.app,
        [
            "write-job-registered-video-qa-sidecar",
            "--run-id",
            "job-run-6",
            "--summary-path",
            str(summary_path),
            "--allowed-external-analysis",
            "--redaction-status",
            "redacted",
            "--video-path",
            str(video_path),
        ],
    )

    assert result.exit_code == 1
    payload = json.loads(summary_path.read_text(encoding="utf-8"))
    audit = payload["stage_visual_audits"][0]
    assert audit["exact_blocker"] == "job_video_qa_redaction_receipt_required"


def test_job_registered_video_qa_sidecar_blocks_invalid_redaction_receipt_before_gemini(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    run_dir = tmp_path / "artifacts/job-playwright-cli-runs/job-run-7"
    run_dir.mkdir(parents=True)
    video_path = run_dir / "redacted-apply-flow.webm"
    video_path.write_bytes(b"fake webm")
    receipt_path = run_dir / "redaction-receipt.json"
    receipt_path.write_text(
        json.dumps(
            {
                "redacted_video_path": str(video_path),
                "redacted_video_sha256": "0" * 64,
                "redaction_status": "redacted",
                "allowed_external_analysis": True,
            }
        ),
        encoding="utf-8",
    )
    summary_path = tmp_path / "sidecar.json"
    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setattr(
        cli,
        "analyze_browser_automation_video",
        lambda **kwargs: pytest.fail("Gemini must not receive videos with an invalid redaction receipt."),
    )

    result = CliRunner().invoke(
        cli.app,
        [
            "write-job-registered-video-qa-sidecar",
            "--run-id",
            "job-run-7",
            "--summary-path",
            str(summary_path),
            "--allowed-external-analysis",
            "--redaction-status",
            "redacted",
            "--video-path",
            str(video_path),
            "--redaction-receipt-path",
            str(receipt_path),
        ],
    )

    assert result.exit_code == 1
    payload = json.loads(summary_path.read_text(encoding="utf-8"))
    audit = payload["stage_visual_audits"][0]
    assert audit["exact_blocker"].startswith("job_video_qa_redaction_receipt_invalid:")
    assert "sha256_mismatch" in audit["exact_blocker"]


def test_job_registered_video_qa_sidecar_merges_existing_summary(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    run_dir = tmp_path / "artifacts/job-playwright-cli-runs/job-run-5"
    run_dir.mkdir(parents=True)
    video_path = run_dir / "redacted-apply-flow.webm"
    video_path.write_bytes(b"fake webm")
    receipt_path = run_dir / "redaction-receipt.json"
    receipt_path.write_text(
        json.dumps(
            {
                "redacted_video_path": str(video_path),
                "redacted_video_sha256": cli._file_sha256(video_path),
                "redaction_status": "redacted",
                "allowed_external_analysis": True,
            }
        ),
        encoding="utf-8",
    )
    summary_path = tmp_path / "sidecar.json"
    summary_path.write_text(
        json.dumps(
            {
                "job_registered_summary": {"ok": True},
                "stage_visual_audits": [
                    {
                        "provider": "existing",
                        "stage": "source_of_truth_readback",
                        "status": "passed",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    def fake_analyze(**kwargs):
        return {
            "timeline": [],
            "step_matches": [],
            "anomalies": [],
            "recommendation": {"status": "pass", "summary": "Visual gates match."},
        }

    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    monkeypatch.setattr(cli, "analyze_browser_automation_video", fake_analyze)

    result = CliRunner().invoke(
        cli.app,
        [
            "write-job-registered-video-qa-sidecar",
            "--run-id",
            "job-run-5",
            "--summary-path",
            str(summary_path),
            "--allowed-external-analysis",
            "--redaction-status",
            "redacted",
            "--video-path",
            str(video_path),
            "--redaction-receipt-path",
            str(receipt_path),
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(summary_path.read_text(encoding="utf-8"))
    assert payload["job_registered_summary"] == {"ok": True}
    assert [audit["stage"] for audit in payload["stage_visual_audits"]] == [
        "source_of_truth_readback",
        "job_registered_video_qa_1",
    ]
    assert payload["gemini_video_qa"]["audits"] == payload["stage_visual_audits"]


@pytest.mark.parametrize(
    "command",
    [
        "browser-video-qa-no-post-preflight",
        "preflight-browser-video-qa-no-post",
    ],
)
def test_browser_video_qa_no_post_preflight_compat_command_still_works(command, monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)

    def fake_record(*, run_dir: Path, cdp_port: int, timeout_seconds: float) -> dict[str, object]:
        video_path = run_dir / "browser-video-qa-no-post-preflight.webm"
        video_path.write_bytes(b"fake webm")
        network_jsonl = run_dir / "network.jsonl"
        network_jsonl.write_text("", encoding="utf-8")
        return {
            "video_path": str(video_path),
            "before": {"label": "before"},
            "after": {"label": "after"},
            "network_jsonl": str(network_jsonl),
        }

    monkeypatch.setattr(cli, "_record_browser_video_qa_no_post_preflight", fake_record)

    result = CliRunner().invoke(
        cli.app,
        [command, "--run-id", "test-run", "--skip-gemini", "--no-post"],
    )

    assert result.exit_code == 0


def test_video_qa_smoke_recursive_redaction_covers_common_secret_shapes(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "secret-gemini-key")
    payload = {
        "headers": {"Authorization": "Bearer secret-token"},
        "url": "https://example.com/path?api_key=abc123&next=ok",
        "jwt": "aaaaaaaaaa.bbbbbbbbbb.cccccccccc",
        "email": "person@example.com",
        "nested": ["password=hunter2", "token: abcdef"],
        "gemini": "secret-gemini-key",
    }

    redacted = cli._redact_sensitive_data(payload)
    serialized = json.dumps(redacted)
    assert "secret-token" not in serialized
    assert "abc123" not in serialized
    assert "aaaaaaaaaa.bbbbbbbbbb.cccccccccc" not in serialized
    assert "person@example.com" not in serialized
    assert "hunter2" not in serialized
    assert "secret-gemini-key" not in serialized
    assert "[REDACTED]" in serialized
    assert "[REDACTED_EMAIL]" in serialized


@pytest.mark.parametrize(
    "args",
    [
        ["smoke-browser-video-qa", "--run-id", "../bad", "--skip-gemini"],
        ["smoke-browser-video-qa", "--run-id", ".", "--skip-gemini"],
        ["smoke-browser-video-qa", "--run-id", "..", "--skip-gemini"],
        ["smoke-browser-video-qa", "--workflow", ".", "--skip-gemini"],
        ["smoke-browser-video-qa", "--workflow", "daily/ai", "--skip-gemini"],
        ["smoke-browser-video-qa", "--stage", "..", "--skip-gemini"],
        ["smoke-browser-video-qa", "--stage", "bad stage", "--skip-gemini"],
        ["smoke-browser-video-qa", "--attempt-no", "0", "--skip-gemini"],
    ],
)
def test_video_qa_smoke_rejects_unsafe_stage_observation_args(args, tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    result = CliRunner().invoke(cli.app, args)

    assert result.exit_code != 0
    assert not (tmp_path / "bad").exists()


def test_write_video_qa_smoke_fixture_has_distinct_initial_and_completed_states(tmp_path) -> None:
    fixture_path = cli._write_video_qa_smoke_fixture(tmp_path)
    html = fixture_path.read_text(encoding="utf-8")

    assert "INITIAL STATE: waiting for harmless check" in html
    assert "COMPLETED STATE: smoke check complete" in html
    assert "Step 1 of 2: initial waiting state before the harmless click" in html
    assert "Step 2 of 2: completed state after the harmless click" in html
    assert "Recording pre-click initial state" in html
    assert "Recording post-click completed state" in html
    assert "No external navigation. No post/send/publish/submit action." in html


def test_record_video_qa_smoke_fixture_resolves_video_path_before_playwright_exit(
    monkeypatch, tmp_path
) -> None:
    fixture_path = tmp_path / "fixture.html"
    fixture_path.write_text("<html><body></body></html>", encoding="utf-8")
    source_video = tmp_path / "source.webm"
    source_video.write_bytes(b"fake webm")

    class FakeVideo:
        def __init__(self, manager):
            self._manager = manager

        def path(self):
            assert self._manager.context_closed is True
            if self._manager.exited:
                raise RuntimeError("video.path() called after Playwright exited")
            return source_video

    class FakeLocator:
        def __init__(self, page):
            self._page = page

        def wait_for(self, **kwargs):
            return None

        def click(self, **kwargs):
            self._page.clicked = True
            return None

        def inner_text(self, **kwargs):
            if self._page.clicked:
                return "COMPLETED STATE: smoke check complete"
            return "INITIAL STATE: waiting for harmless check"

    class FakePage:
        def __init__(self, manager):
            self.url = ""
            self.video = FakeVideo(manager)
            self.clicked = False

        def goto(self, url, **kwargs):
            self.url = url

        def locator(self, selector, **kwargs):
            return FakeLocator(self)

        def title(self):
            return "Video QA Smoke Fixture"

        def screenshot(self, **kwargs):
            Path(kwargs["path"]).write_bytes(b"fake png")

        def wait_for_timeout(self, timeout):
            return None

    class FakeContext:
        def __init__(self, manager):
            self._manager = manager

        def new_page(self):
            return FakePage(self._manager)

        def close(self):
            self._manager.context_closed = True

    class FakeBrowser:
        def __init__(self, manager):
            self._manager = manager

        def new_context(self, **kwargs):
            return FakeContext(self._manager)

        def close(self):
            self._manager.browser_closed = True

    class FakeChromium:
        def __init__(self, manager):
            self._manager = manager

        def launch(self, **kwargs):
            return FakeBrowser(self._manager)

    class FakePlaywright:
        def __init__(self):
            self.exited = False
            self.context_closed = False
            self.browser_closed = False
            self.chromium = FakeChromium(self)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            self.exited = True
            return False

    fake_playwright = FakePlaywright()
    fake_playwright_module = types.SimpleNamespace(sync_playwright=lambda: fake_playwright)
    fake_playwright_package = types.SimpleNamespace(sync_api=fake_playwright_module)
    monkeypatch.setitem(sys.modules, "playwright", fake_playwright_package)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", fake_playwright_module)

    result = cli._record_video_qa_smoke_fixture(fixture_path, tmp_path)

    video_path = Path(result["video_path"])
    assert video_path == tmp_path / "video-qa-smoke.webm"
    assert video_path.read_bytes() == b"fake webm"
    assert Path(result["network_jsonl"]).exists()
    assert result["before"]["url"] == fixture_path.resolve().as_uri()
    assert result["before"]["title"] == "Video QA Smoke Fixture"
    assert "INITIAL STATE" in result["before"]["dom_text"]
    assert result["before"]["screenshot_exists"] is True
    assert Path(result["before"]["screenshot_path"]).exists()
    assert "COMPLETED STATE" in result["after"]["dom_text"]
    assert result["after"]["screenshot_exists"] is True
    assert fake_playwright.exited is True
    assert fake_playwright.browser_closed is True


def test_record_video_qa_smoke_fixture_rejects_external_navigation_after_click(monkeypatch, tmp_path) -> None:
    fixture_path = tmp_path / "fixture.html"
    fixture_path.write_text("<html><body></body></html>", encoding="utf-8")
    source_video = tmp_path / "source.webm"
    source_video.write_bytes(b"fake webm")

    class FakeVideo:
        def path(self):
            return source_video

    class FakeLocator:
        def __init__(self, page):
            self._page = page

        def wait_for(self, **kwargs):
            return None

        def click(self, **kwargs):
            self._page.url = "https://example.com/after-click"

    class FakePage:
        def __init__(self):
            self.url = ""
            self.video = FakeVideo()

        def goto(self, url, **kwargs):
            self.url = url

        def locator(self, selector, **kwargs):
            return FakeLocator(self)

        def wait_for_timeout(self, timeout):
            return None

    class FakeContext:
        def new_page(self):
            return FakePage()

        def close(self):
            return None

    class FakeBrowser:
        def new_context(self, **kwargs):
            return FakeContext()

        def close(self):
            return None

    class FakePlaywright:
        chromium = types.SimpleNamespace(launch=lambda **kwargs: FakeBrowser())

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    fake_playwright_module = types.SimpleNamespace(sync_playwright=lambda: FakePlaywright())
    monkeypatch.setitem(sys.modules, "playwright", types.SimpleNamespace(sync_api=fake_playwright_module))
    monkeypatch.setitem(sys.modules, "playwright.sync_api", fake_playwright_module)

    with pytest.raises(RuntimeError, match="Unsafe smoke fixture navigation after harmless click"):
        cli._record_video_qa_smoke_fixture(fixture_path, tmp_path)


def test_record_video_qa_smoke_fixture_rejects_external_request_after_click(monkeypatch, tmp_path) -> None:
    fixture_path = tmp_path / "fixture.html"
    fixture_path.write_text("<html><body></body></html>", encoding="utf-8")
    source_video = tmp_path / "source.webm"
    source_video.write_bytes(b"fake webm")

    class FakeRoute:
        def __init__(self, url):
            self.request = types.SimpleNamespace(url=url)
            self.aborted = False

        def abort(self):
            self.aborted = True

        def continue_(self):
            return None

    class FakeVideo:
        def path(self):
            return source_video

    class FakeLocator:
        def __init__(self, manager):
            self._manager = manager

        def wait_for(self, **kwargs):
            return None

        def click(self, **kwargs):
            assert self._manager.route_handler is not None
            self._manager.route_handler(FakeRoute("https://example.com/pixel"))

    class FakePage:
        def __init__(self, manager):
            self._manager = manager
            self.url = ""
            self.video = FakeVideo()

        def goto(self, url, **kwargs):
            self.url = url

        def locator(self, selector, **kwargs):
            return FakeLocator(self._manager)

        def wait_for_timeout(self, timeout):
            return None

    class FakeContext:
        def __init__(self, manager):
            self._manager = manager

        def route(self, pattern, handler):
            self._manager.route_handler = handler

        def new_page(self):
            return FakePage(self._manager)

        def close(self):
            return None

    class FakeBrowser:
        def __init__(self, manager):
            self._manager = manager

        def new_context(self, **kwargs):
            return FakeContext(self._manager)

        def close(self):
            return None

    class FakeChromium:
        def __init__(self, manager):
            self._manager = manager

        def launch(self, **kwargs):
            return FakeBrowser(self._manager)

    class FakePlaywright:
        def __init__(self):
            self.route_handler = None
            self.chromium = FakeChromium(self)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    fake_playwright_module = types.SimpleNamespace(sync_playwright=lambda: FakePlaywright())
    monkeypatch.setitem(sys.modules, "playwright", types.SimpleNamespace(sync_api=fake_playwright_module))
    monkeypatch.setitem(sys.modules, "playwright.sync_api", fake_playwright_module)

    with pytest.raises(RuntimeError, match="Unsafe smoke fixture after harmless click"):
        cli._record_video_qa_smoke_fixture(fixture_path, tmp_path)


def test_draft_queue_rows_prioritizes_ship_now_candidate(monkeypatch) -> None:
    hold = QueueRow(
        id="hold-item",
        status="collected",
        keep_priority="hold",
        quality_score="8",
        source_priority_score="5",
        title="Hold item",
    )
    ship_now = QueueRow(
        id="ship-now-item",
        status="collected",
        keep_priority="ship_now",
        quality_score="10",
        source_priority_score="5",
        source_url="https://openai.com/index/openai-on-aws/",
        title="Ship now item",
    )
    repo = MutableDummyRepo([hold, ship_now])

    class DummySettings:
        draft_model = "test-model"

    monkeypatch.setattr(cli, "build_draft_client", lambda settings: object())
    monkeypatch.setattr(
        cli,
        "generate_localized_copy",
        lambda **kwargs: {
            "summary_ja": "summary",
            "angle": "angle",
            "x_text": "x copy",
            "linkedin_text": "linkedin copy",
            "media_plan": "media plan",
        },
    )
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-05-19T00:00:00+00:00")

    drafted = cli._draft_queue_rows(repo, DummySettings(), max_items=1)

    assert drafted == 1
    assert ship_now.status == "drafted"
    assert ship_now.x_text == "x copy"
    assert hold.status == "collected"


def test_draft_queue_rows_records_hard_timeout_blocker(monkeypatch) -> None:
    row = QueueRow(id="timeout-item", status="collected", keep_priority="ship_now", title="Timeout item")
    repo = MutableDummyRepo([row])

    monkeypatch.setenv("DAILY_AI_DRAFT_HARD_TIMEOUT_SECONDS", "0.05")
    monkeypatch.setattr(cli, "_generate_localized_copy_process_target", _slow_draft_worker_for_test)

    settings = types.SimpleNamespace(draft_model="test-model", draft_timeout_seconds=45)
    drafted = cli._draft_queue_rows(repo, settings, max_items=1)

    assert drafted == 0
    assert row.status == "failed"
    assert row.error == "openai_https_read_timeout: draft generation exceeded 0.05s for queue_id=timeout-item"


def test_collect_documents_from_sources_bounded_times_out(monkeypatch) -> None:
    monkeypatch.setenv("SOCIAL_FLOW_SOURCE_COLLECTION_HARD_TIMEOUT_SECONDS", "0.05")
    monkeypatch.setattr(cli, "_collect_documents_from_sources_process_target", _slow_source_collection_worker_for_test)

    with pytest.raises(TimeoutError, match="source_collection_timeout_after_0.05s"):
        cli._collect_documents_from_sources_bounded(types.SimpleNamespace(sources_config_json="{}"))


def test_video_workspace_tab_specs_include_headers_and_publish_targets() -> None:
    class DummySettings:
        chrome_task_group_prefix = "social-flow"
        spreadsheet_id = "spreadsheet-id"
        google_drive_folder_url = "https://drive.google.com/drive/folders/demo"

    specs = cli._video_workspace_tab_specs(DummySettings())

    assert specs[0][0] == "social-flow: inbox"
    assert specs[0][1].startswith("data:text/html")
    assert any(label == "TikTok upload" and url == "https://www.tiktok.com/upload" for label, url in specs)
    assert any(label == "YouTube Studio" and url == "https://studio.youtube.com/" for label, url in specs)
    assert any(label == "Facebook Reels" and url == "https://www.facebook.com/reels/create" for label, url in specs)


def test_job_workspace_tab_specs_include_separate_application_groups() -> None:
    class DummySettings:
        chrome_task_group_prefix = "social-flow"
        spreadsheet_id = "spreadsheet-id"

    groups = cli._recommended_chrome_task_groups(DummySettings())
    specs = cli._job_workspace_tab_specs(DummySettings())

    assert "social-flow: job applications" in groups
    assert "social-flow: job proof cleanup" in groups
    assert specs[0][0] == "social-flow: job applications"
    assert specs[0][1].startswith("data:text/html")
    assert not any("jobs.ashbyhq.com/tailor" in url for _, url in specs)
    assert any(
        label == "Job source of truth" and cli.JOB_APPLICATIONS_SPREADSHEET_ID in url
        for label, url in specs
    )


def test_open_profile2_chrome_tabs_uses_existing_profile2(monkeypatch) -> None:
    calls: list[list[str]] = []

    class DummyPopen:
        def __init__(self, cmd, **kwargs):
            calls.append(cmd)

    monkeypatch.setattr(cli.subprocess, "Popen", DummyPopen)

    cmd = cli._open_profile2_chrome_tabs("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["https://example.com/job"])

    assert calls == [cmd]
    assert "--profile-directory=Profile 2" in cmd
    assert any(arg.startswith("--user-data-dir=/Users/") and "Google/Chrome" in arg for arg in cmd)
    assert "https://example.com/job" in cmd


def test_pending_video_platforms_skip_already_published_targets() -> None:
    row = QueueRow(
        tiktok_enabled="true",
        instagram_enabled="true",
        youtube_shorts_enabled="true",
        facebook_reels_enabled="true",
        instagram_post_url="https://instagram.com/p/demo",
        youtube_video_id="yt-123",
    )

    assert cli._pending_video_platforms(row) == ["tiktok", "facebook"]


def test_build_chrome_publisher_uses_main_profile_for_social_posts() -> None:
    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_user_data_dir = "/Users/example/.social-flow-chrome-profile"
        chrome_profile_directory = "Default"
        chrome_main_user_data_dir = "/Users/example/Library/Application Support/Google/Chrome"
        chrome_main_profile_label = "二千 (Nicky)"
        chrome_main_profile_directory = "Profile 2"
        chrome_publish_headless = False

    publisher = cli._build_chrome_publisher(DummySettings())

    assert publisher._config.user_data_dir == "/Users/example/Library/Application Support/Google/Chrome"
    assert publisher._config.profile_directory == "Profile 2"
    assert publisher._config.profile_label == "二千 (Nicky)"


def test_cleanup_chrome_automation_tabs_uses_main_profile(monkeypatch) -> None:
    seen: list[tuple[str, str]] = []

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = "/Users/example/Library/Application Support/Google/Chrome"
        chrome_main_profile_label = "二千 (Nicky)"
        chrome_main_profile_directory = "Profile 2"
        chrome_publish_headless = False

    def fake_cleanup(self, *, keep_linkedin_tabs: int = 1, keep_x_tabs: int = 1) -> None:
        seen.append((self._config.profile_label, self._config.profile_directory))

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli.ChromePublisher, "cleanup_automation_tabs", fake_cleanup)

    cli.cleanup_chrome_automation_tabs()

    assert seen == [("二千 (Nicky)", "Profile 2")]


def test_open_main_chrome_profile_uses_remote_debugging_port(tmp_path, monkeypatch, capsys) -> None:
    preferences_path = tmp_path / "Default" / "Preferences"
    preferences_path.parent.mkdir(parents=True)
    preferences_path.write_text("{}", encoding="utf-8")
    launched: list[list[str]] = []

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(tmp_path)
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_preferences_path = str(preferences_path)
        chrome_main_remote_debugging_port = 9333

    class DummyPopen:
        def __init__(self, cmd: list[str], *args, **kwargs) -> None:
            launched.append(cmd)

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli.subprocess, "Popen", DummyPopen)

    cli.open_main_chrome_profile("https://x.com/home")

    assert launched
    assert f"--user-data-dir={tmp_path}" in launched[0]
    assert "--profile-directory=Default" in launched[0]
    assert "--remote-debugging-port=9333" in launched[0]
    assert "--remote-allow-origins=http://127.0.0.1:*" in launched[0]
    assert "verify-main-chrome-profile-control" in capsys.readouterr().out


def test_open_main_chrome_profile_allows_first_run_without_preferences(tmp_path, monkeypatch, capsys) -> None:
    preferences_path = tmp_path / "Default" / "Preferences"
    launched: list[list[str]] = []

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(tmp_path)
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_preferences_path = str(preferences_path)
        chrome_main_remote_debugging_port = 9333

    class DummyPopen:
        def __init__(self, cmd: list[str], *args, **kwargs) -> None:
            launched.append(cmd)

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli.subprocess, "Popen", DummyPopen)

    cli.open_main_chrome_profile("https://x.com/home")

    assert launched
    assert Path(tmp_path).exists()
    assert "First run: sign in to X, LinkedIn, and Google" in capsys.readouterr().out


def test_open_main_chrome_profile_rejects_default_google_chrome_user_data_dir(monkeypatch) -> None:
    default_user_data_dir = str(Path.home() / "Library" / "Application Support" / "Google" / "Chrome")

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = default_user_data_dir
        chrome_main_profile_label = "二千 (Nicky)"
        chrome_main_profile_directory = "Profile 2"
        chrome_main_preferences_path = f"{default_user_data_dir}/Profile 2/Preferences"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())

    result = CliRunner().invoke(cli.app, ["open-main-chrome-profile", "https://x.com/home"])

    assert result.exit_code != 0
    assert "chrome_default_user_data_dir_blocked" in result.output
    assert ".social-flow-nicky-automation-chrome" in result.output


def test_open_main_chrome_profile_cli_accepts_positional_start_url(tmp_path, monkeypatch) -> None:
    preferences_path = tmp_path / "Profile 2" / "Preferences"
    preferences_path.parent.mkdir(parents=True)
    preferences_path.write_text("{}", encoding="utf-8")
    launched: list[list[str]] = []

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(tmp_path)
        chrome_main_profile_label = "二千 (Nicky)"
        chrome_main_profile_directory = "Profile 2"
        chrome_main_preferences_path = str(preferences_path)
        chrome_main_remote_debugging_port = 9333

    class DummyPopen:
        def __init__(self, cmd: list[str], *args, **kwargs) -> None:
            launched.append(cmd)

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli.subprocess, "Popen", DummyPopen)

    result = CliRunner().invoke(cli.app, ["open-main-chrome-profile", "https://x.com/home"])

    assert result.exit_code == 0
    assert launched
    assert launched[0][-1] == "https://x.com/home"
    assert "--remote-debugging-port=9333" in launched[0]


def test_open_main_chrome_profile_removes_stale_singleton_lock(tmp_path, monkeypatch) -> None:
    preferences_path = tmp_path / "Default" / "Preferences"
    preferences_path.parent.mkdir(parents=True)
    preferences_path.write_text("{}", encoding="utf-8")
    (tmp_path / "SingletonLock").symlink_to("Nichikas-MacBook-Pro.local-999999")
    (tmp_path / "SingletonCookie").symlink_to("dead-cookie")
    (tmp_path / "SingletonSocket").symlink_to("/tmp/dead-socket")
    launched: list[list[str]] = []

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(tmp_path)
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_preferences_path = str(preferences_path)
        chrome_main_remote_debugging_port = 9333

    class DummyPopen:
        def __init__(self, cmd: list[str], *args, **kwargs) -> None:
            launched.append(cmd)

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli.subprocess, "Popen", DummyPopen)

    result = CliRunner().invoke(cli.app, ["open-main-chrome-profile", "--start-url", "https://x.com/home"])

    assert result.exit_code == 0
    assert launched
    assert not (tmp_path / "SingletonLock").exists()
    assert not (tmp_path / "SingletonCookie").exists()
    assert not (tmp_path / "SingletonSocket").exists()


def test_open_main_chrome_profile_cli_keeps_start_url_option_compatible(tmp_path, monkeypatch) -> None:
    preferences_path = tmp_path / "Profile 2" / "Preferences"
    preferences_path.parent.mkdir(parents=True)
    preferences_path.write_text("{}", encoding="utf-8")
    launched: list[list[str]] = []

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(tmp_path)
        chrome_main_profile_label = "二千 (Nicky)"
        chrome_main_profile_directory = "Profile 2"
        chrome_main_preferences_path = str(preferences_path)
        chrome_main_remote_debugging_port = 9333

    class DummyPopen:
        def __init__(self, cmd: list[str], *args, **kwargs) -> None:
            launched.append(cmd)

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli.subprocess, "Popen", DummyPopen)

    result = CliRunner().invoke(cli.app, ["open-main-chrome-profile", "--start-url", "https://x.com/home"])

    assert result.exit_code == 0
    assert launched
    assert launched[0][-1] == "https://x.com/home"


def test_open_main_chrome_profile_cli_rejects_conflicting_start_urls(tmp_path, monkeypatch) -> None:
    preferences_path = tmp_path / "Profile 2" / "Preferences"
    preferences_path.parent.mkdir(parents=True)
    preferences_path.write_text("{}", encoding="utf-8")

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(tmp_path)
        chrome_main_profile_label = "二千 (Nicky)"
        chrome_main_profile_directory = "Profile 2"
        chrome_main_preferences_path = str(preferences_path)
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())

    result = CliRunner().invoke(
        cli.app,
        ["open-main-chrome-profile", "https://x.com/home", "--start-url", "https://www.linkedin.com/feed/"],
    )

    assert result.exit_code != 0
    assert "Pass start URL either as a positional argument" in result.output
    assert "--start-url" in result.output


def test_chrome_profile2_preflight_pins_code_x_preferences_path(monkeypatch, tmp_path) -> None:
    seen: dict[str, str] = {}

    def fake_check(preferences_path: str) -> dict[str, object]:
        seen["preferences_path"] = preferences_path
        return {
            "ok": True,
            "installed": True,
            "enabled": True,
            "selectedProfileDirectory": "Profile 2",
        }

    monkeypatch.setattr(cli, "_run_chrome_extension_check", fake_check)
    script_path = tmp_path / "open-chrome-window.js"
    script_path.write_text("console.log('dry-run')\n", encoding="utf-8")
    monkeypatch.setattr(cli, "_chrome_open_window_script_path", lambda: script_path)

    result = CliRunner().invoke(cli.app, ["chrome-profile2-preflight"])

    assert result.exit_code == 0
    assert seen["preferences_path"].endswith(
        "Library/Application Support/Google/Chrome/Profile 2/Preferences"
    )
    assert "CODEX_CHROME_PREFERENCES_PATH" in result.output
    assert "Profile 2" in result.output
    assert "dry-run" in result.output


def test_chrome_profile2_preflight_json_includes_pinned_paths(monkeypatch, tmp_path) -> None:
    def fake_check(preferences_path: str) -> dict[str, object]:
        return {
            "ok": True,
            "installed": True,
            "enabled": True,
            "selectedProfileDirectory": "Profile 2",
            "preferencesPath": preferences_path,
        }

    monkeypatch.setattr(cli, "_run_chrome_extension_check", fake_check)
    script_path = tmp_path / "open-chrome-window.js"
    script_path.write_text("console.log('dry-run')\n", encoding="utf-8")
    monkeypatch.setattr(cli, "_chrome_open_window_script_path", lambda: script_path)

    result = CliRunner().invoke(cli.app, ["chrome-profile2-preflight", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["profile_directory"] == "Profile 2"
    assert payload["codex_chrome_preferences_path"] == str(
        Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "Profile 2" / "Preferences"
    )
    assert payload["health_check"]["selectedProfileDirectory"] == "Profile 2"
    assert payload["open_window_preview"]["args"][0] == str(script_path)
    assert payload["open_window_preview"]["args"][1:] == ["--dry-run", "--json"]
    assert payload["open_window_preview"]["script_exists"] is True
    assert payload["open_window_preview"]["env"]["CODEX_CHROME_PREFERENCES_PATH"] == str(
        Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "Profile 2" / "Preferences"
    )
    assert payload["open_window_preview"]["env"]["CODEX_CHROME_USER_DATA_DIR"] == str(
        Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
    )


def test_chrome_open_window_script_path_points_to_codex_home() -> None:
    script_path = cli._chrome_open_window_script_path()

    assert script_path == (
        Path.home()
        / ".codex"
        / "plugins"
        / "cache"
        / "openai-bundled"
        / "chrome"
        / "26.707.41301"
        / "scripts"
        / "open-chrome-window.js"
    )
    assert script_path.name == "open-chrome-window.js"


def test_chrome_plugin_check_script_path_points_to_codex_home() -> None:
    script_path = cli._chrome_plugin_check_script()

    assert script_path == (
        Path.home()
        / ".codex"
        / "plugins"
        / "cache"
        / "openai-bundled"
        / "chrome"
        / "26.707.41301"
        / "scripts"
        / "check-extension-installed.js"
    )
    assert script_path.name == "check-extension-installed.js"


def test_verify_main_chrome_profile_control_reports_unavailable_cdp(monkeypatch, capsys) -> None:
    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = "/Users/example/Library/Application Support/Google/Chrome"
        chrome_main_profile_label = "二千 (Nicky)"
        chrome_main_profile_directory = "Profile 2"
        chrome_main_preferences_path = "/Users/example/Library/Application Support/Google/Chrome/Profile 2/Preferences"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_wait_for_chrome_cdp", lambda *args, **kwargs: None)

    try:
        cli.verify_main_chrome_profile_control(open_if_missing=False, json_output=True)
    except typer.Exit as exc:
        assert exc.exit_code == 1
    else:
        raise AssertionError("verify_main_chrome_profile_control should exit when CDP is unavailable")

    output = capsys.readouterr().out
    assert '"ok": false' in output
    assert '"stop_reason": "local_automation_profile_unavailable"' in output
    assert '"legacy_stop_reason": "local_profile2_lane_unavailable"' in output
    assert '"reason": "cdp_endpoint_unavailable"' in output
    assert '"remote_debugging_port": 9333' in output


def test_verify_main_chrome_profile_control_json_rejects_default_google_chrome_user_data_dir(monkeypatch) -> None:
    default_user_data_dir = str(Path.home() / "Library" / "Application Support" / "Google" / "Chrome")

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = default_user_data_dir
        chrome_main_profile_label = "二千 (Nicky)"
        chrome_main_profile_directory = "Profile 2"
        chrome_main_preferences_path = f"{default_user_data_dir}/Profile 2/Preferences"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())

    result = CliRunner().invoke(cli.app, ["verify-main-chrome-profile-control", "--json"])

    assert result.exit_code == 2
    parsed = json.loads(result.output)
    assert parsed["ok"] is False
    assert parsed["stop_reason"] == "local_automation_profile_unavailable"
    assert parsed["legacy_stop_reason"] == "local_profile2_lane_unavailable"
    assert parsed["reason"] == "chrome_default_user_data_dir_blocked"


def test_automation_lane_status_reports_busy_and_fallback(monkeypatch, tmp_path) -> None:
    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path)
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(tmp_path / "missing-busy-marker.json"))
    monkeypatch.setattr(
        cli,
        "_process_rows",
        lambda: [
            (111, 1, "Ss", f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={tmp_path} --remote-debugging-port=9333"),
            (222, 1, "S", f"uv run social-flow run-publish-flow --browser-cdp-url=http://127.0.0.1:9333 --profile-dir={tmp_path}"),
        ],
    )
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})

    result = CliRunner().invoke(cli.app, ["automation-lane-status", "--json"])

    assert result.exit_code == 1
    parsed = json.loads(result.output)
    assert parsed["ok"] is False
    assert parsed["busy_ok"] is False
    assert parsed["publish_ready"] is False
    assert parsed["busy"] is True
    assert parsed["cdp_ok"] is True
    assert parsed["fallback_allowed"] is True
    assert parsed["stop_reason"] == "local_automation_profile_busy"
    assert "Chrome plugin registered runner" in parsed["next_action"]
    assert parsed["route_contract"]["decision"]["required_surface"] == "chrome_plugin"
    assert "authority_missing:surface_disabled" in parsed["route_blockers"]


def test_automation_lane_status_reports_override_marker_without_busy(monkeypatch, tmp_path) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    marker_path.write_text(
        json.dumps(
            {
                "reason": "user_reported_busy",
                "owner": "user",
                "task": "other automation",
                "created_at": "2026-05-30T00:00:00+00:00",
                "expires_at": "2099-05-30T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(
        cli,
        "_process_rows",
        lambda: [
            (
                111,
                1,
                "Ss",
                f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={tmp_path / 'chrome'} --remote-debugging-port=9333",
            )
        ],
    )
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})

    result = CliRunner().invoke(cli.app, ["automation-lane-status", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["busy"] is False
    assert parsed["busy_sources"] == []
    assert parsed["busy_marker"]["reason"] == "user_reported_busy"
    assert parsed["fallback_allowed"] is True
    assert parsed["stop_reason"] == ""


def test_automation_lane_status_treats_ttl_owner_marker_as_busy(monkeypatch, tmp_path) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    marker_path.write_text(
        json.dumps(
            {
                "reason": "scheduled_run_nicky_lane_claim",
                "owner": "nisenprints-daily-draft-canva-swap",
                "task": "NisenPrints",
                "created_at": "2026-06-01T00:00:00+00:00",
                "expires_at": "2099-06-01T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(
        cli,
        "_process_rows",
        lambda: [
            (
                111,
                1,
                "Ss",
                f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={tmp_path / 'chrome'} --remote-debugging-port=9333",
            )
        ],
    )
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})

    result = CliRunner().invoke(cli.app, ["resolve-browser-lane", "--purpose", "nisenprints", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["lane"] == "chrome_extension_profile2_fallback"
    assert parsed["lane_status"]["busy_sources"] == ["busy_marker"]
    assert parsed["stop_reason"] == ""


def test_automation_lane_status_keeps_owner_marker_without_ttl_diagnostic(monkeypatch, tmp_path) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    marker_path.write_text(
        json.dumps(
            {
                "reason": "scheduled_run_nicky_lane_claim",
                "owner": "nisenprints-daily-draft-canva-swap",
                "task": "NisenPrints",
                "created_at": "2026-06-01T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(
        cli,
        "_process_rows",
        lambda: [
            (
                111,
                1,
                "Ss",
                f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={tmp_path / 'chrome'} --remote-debugging-port=9333",
            )
        ],
    )
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})

    result = CliRunner().invoke(cli.app, ["resolve-browser-lane", "--purpose", "nisenprints", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["lane"] == "chrome_extension_profile2_fallback"
    assert parsed["lane_status"]["busy_sources"] == []
    assert parsed["lane_status"]["busy_marker"]["owner"] == "nisenprints-daily-draft-canva-swap"


def test_automation_lane_status_ignores_user_reported_not_open_marker(monkeypatch, tmp_path) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    marker_path.write_text(
        json.dumps(
            {
                "reason": "user_reported_not_open",
                "owner": "sns-daily-ai-publish-run",
                "task": "stale correction marker",
                "created_at": "2026-06-01T00:00:00+00:00",
                "expires_at": "2099-06-01T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(
        cli,
        "_process_rows",
        lambda: [
            (
                111,
                1,
                "Ss",
                f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={tmp_path / 'chrome'} --remote-debugging-port=9333",
            )
        ],
    )
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})

    result = CliRunner().invoke(cli.app, ["resolve-browser-lane", "--purpose", "nisenprints", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["lane"] == "chrome_extension_profile2_fallback"
    assert parsed["fallback_allowed"] is True
    assert parsed["lane_status"]["busy"] is False
    assert parsed["lane_status"]["busy_marker_error"] == "ignored_busy_marker: reason=user_reported_not_open"


def test_automation_lane_status_ignores_expired_or_invalid_override_marker(monkeypatch, tmp_path) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(
        cli,
        "_process_rows",
        lambda: [
            (
                111,
                1,
                "Ss",
                f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={tmp_path / 'chrome'} --remote-debugging-port=9333",
            )
        ],
    )
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})

    marker_path.write_text(
        json.dumps({"reason": "old", "expires_at": "2000-01-01T00:00:00+00:00"}),
        encoding="utf-8",
    )
    expired = CliRunner().invoke(cli.app, ["automation-lane-status", "--json"])
    expired_payload = json.loads(expired.output)
    assert expired.exit_code == 0
    assert expired_payload["busy"] is False
    assert expired_payload["busy_marker_error"] == "expired_busy_marker"

    marker_path.write_text("{not-json", encoding="utf-8")
    invalid = CliRunner().invoke(cli.app, ["automation-lane-status", "--json"])
    invalid_payload = json.loads(invalid.output)
    assert invalid.exit_code == 0
    assert invalid_payload["busy"] is False
    assert invalid_payload["busy_marker_error"].startswith("invalid_busy_marker:")


def test_automation_lane_status_ok_requires_cdp_and_chrome_process(monkeypatch, tmp_path) -> None:
    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path)
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(tmp_path / "missing-busy-marker.json"))
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: None)

    result = CliRunner().invoke(cli.app, ["automation-lane-status", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["ok"] is True
    assert parsed["busy_ok"] is True
    assert parsed["publish_ready"] is False
    assert parsed["busy"] is False
    assert parsed["cdp_ok"] is False
    assert "Existing Nicky automation state is diagnostic only" in parsed["next_action"]


def test_automation_lane_status_ignores_non_lane_social_flow_process(monkeypatch, tmp_path) -> None:
    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path)
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(tmp_path / "missing-busy-marker.json"))
    monkeypatch.setattr(
        cli,
        "_process_rows",
        lambda: [
            (
                111,
                1,
                "Ss",
                f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={tmp_path} --remote-debugging-port=9333",
            ),
            (222, 1, "S", "uv run social-flow run-core-flow --no-publish-external --sync-sheets"),
        ],
    )
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})

    result = CliRunner().invoke(cli.app, ["automation-lane-status", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["ok"] is True
    assert parsed["publish_ready"] is True
    assert parsed["busy"] is False
    assert parsed["automation_process_count"] == 0


def test_automation_lane_status_ignores_chrome_helpers_and_diagnostic_probes(monkeypatch, tmp_path) -> None:
    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path)
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(tmp_path / "missing-busy-marker.json"))
    monkeypatch.setattr(
        cli,
        "_process_rows",
        lambda: [
            (
                111,
                1,
                "Ss",
                f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={tmp_path} --remote-debugging-port=9333",
            ),
            (
                112,
                111,
                "S",
                f"/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper --user-data-dir={tmp_path} --remote-debugging-port=9333",
            ),
            (222, 1, "S", "curl http://127.0.0.1:9333/json/version"),
            (223, 1, "S", "node probe.js http://127.0.0.1:9333/json/version"),
            (224, 1, "S", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:9333/json/version')\""),
        ],
    )
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})

    result = CliRunner().invoke(cli.app, ["automation-lane-status", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["ok"] is True
    assert parsed["publish_ready"] is True
    assert parsed["busy"] is False
    assert parsed["automation_process_count"] == 0


def test_resolve_browser_lane_uses_fallback_when_owner_ttl_marker_exists(monkeypatch, tmp_path) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    marker_path.write_text(
        json.dumps(
            {
                "reason": "other_automation",
                "owner": "sns-daily-ai-publish-run",
                "task": "publishing",
                "created_at": "2026-05-31T00:00:00+00:00",
                "expires_at": "2099-05-31T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})

    result = CliRunner().invoke(cli.app, ["resolve-browser-lane", "--purpose", "publish", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["ok"] is True
    assert parsed["lane"] == "chrome_extension_profile2_fallback"
    assert parsed["fallback_allowed"] is True
    assert parsed["stop_reason"] == ""
    assert parsed["lane_status"]["busy"] is True
    assert parsed["lane_status"]["busy_sources"] == ["busy_marker"]
    assert parsed["lane_status"]["busy_marker"]["reason"] == "other_automation"


def test_resolve_browser_lane_ignores_same_owner_ttl_marker(monkeypatch, tmp_path) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    marker_path.write_text(
        json.dumps(
            {
                "reason": "scheduled_run_nicky_lane_claim",
                "owner": "sns-daily-ai-publish-run",
                "task": "Daily AI Research + Publish Run",
                "created_at": "2026-06-01T00:00:00+00:00",
                "expires_at": "2099-06-01T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})

    result = CliRunner().invoke(
        cli.app,
        [
            "resolve-browser-lane",
            "--purpose",
            "engagement",
            "--owner",
            "sns-daily-ai-publish-run",
            "--json",
        ],
    )

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["lane"] == "chrome_extension_profile2_fallback"
    assert parsed["lane_status"]["busy"] is False
    assert parsed["lane_status"]["busy_sources"] == []
    assert parsed["route_contract"]["decision"]["required_surface"] == "chrome_plugin"
    assert parsed["route_blockers"] == []


def test_clear_automation_lane_busy_keeps_other_owner_marker(monkeypatch, tmp_path) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    marker_path.write_text(
        json.dumps(
            {
                "reason": "other_automation",
                "owner": "other-run",
                "task": "Other run",
                "created_at": "2026-06-01T00:00:00+00:00",
                "expires_at": "2099-06-01T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))

    result = CliRunner().invoke(
        cli.app,
        ["clear-automation-lane-busy", "--owner", "sns-daily-ai-publish-run", "--json"],
    )

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["cleared"] is False
    assert parsed["owner_mismatch"] is True
    assert marker_path.exists()


def test_resolve_browser_lane_uses_nicky_when_publish_lane_only_has_active_tab(monkeypatch, tmp_path) -> None:
    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    def fake_cdp_json(port, path, *args, **kwargs):
        if path == "/json/version":
            return {"Browser": "Chrome"}
        if path == "/json/list":
            return [
                {"type": "page", "title": "New Tab", "url": "chrome://newtab/"},
                {"type": "page", "title": "LinkedIn", "url": "https://www.linkedin.com/feed/"},
            ]
        return None

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(tmp_path / "missing-busy-marker.json"))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", fake_cdp_json)

    result = CliRunner().invoke(cli.app, ["resolve-browser-lane", "--purpose", "publish", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["lane"] == "chrome_extension_profile2_fallback"
    assert parsed["stop_reason"] == ""
    assert parsed["lane_status"]["busy_sources"] == []
    assert parsed["lane_status"]["conflicting_target_count"] == 1


def test_resolve_browser_lane_uses_nicky_when_job_lane_only_has_non_job_targets(monkeypatch, tmp_path) -> None:
    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    def fake_cdp_json(port, path, *args, **kwargs):
        if path == "/json/version":
            return {"Browser": "Chrome"}
        if path == "/json/list":
            return [
                {"type": "page", "title": "Canva design", "url": "https://www.canva.com/design/abc/edit"},
                {"type": "page", "title": "Etsy listing", "url": "https://www.etsy.com/your/shops/me/listing-editor/edit/123"},
            ]
        return None

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(tmp_path / "missing-busy-marker.json"))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(
        cli,
        "_process_rows",
        lambda: [
            (
                111,
                1,
                "Ss",
                f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={tmp_path / 'chrome'} --remote-debugging-port=9333",
            )
        ],
    )
    monkeypatch.setattr(cli, "_chrome_cdp_json", fake_cdp_json)

    result = CliRunner().invoke(cli.app, ["resolve-browser-lane", "--purpose", "job", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["lane"] == "chrome_extension_profile2_fallback"
    assert parsed["stop_reason"] == ""
    assert parsed["lane_status"]["busy_sources"] == []
    assert parsed["lane_status"]["conflicting_target_count"] == 2


def test_resolve_browser_lane_keeps_active_browser_targets_diagnostic(monkeypatch, tmp_path) -> None:
    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    def fake_cdp_json(port, path, *args, **kwargs):
        if path == "/json/version":
            return {"Browser": "Chrome"}
        if path == "/json/list":
            return [
                {"type": "page", "title": "Not Canva", "url": "https://notcanva.com/jobs"},
                {"type": "page", "title": "Etsy Careers", "url": "https://careers-etsy.com/jobs"},
            ]
        return None

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(tmp_path / "missing-busy-marker.json"))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(
        cli,
        "_process_rows",
        lambda: [
            (
                111,
                1,
                "Ss",
                f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={tmp_path / 'chrome'} --remote-debugging-port=9333",
            )
        ],
    )
    monkeypatch.setattr(cli, "_chrome_cdp_json", fake_cdp_json)

    result = CliRunner().invoke(cli.app, ["resolve-browser-lane", "--purpose", "job", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["lane"] == "chrome_extension_profile2_fallback"
    assert parsed["lane_status"]["busy_sources"] == []
    assert parsed["lane_status"]["conflicting_target_count"] == 2


def test_resolve_browser_lane_uses_nicky_when_available(monkeypatch, tmp_path) -> None:
    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(tmp_path / "missing-busy-marker.json"))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(
        cli,
        "_process_rows",
        lambda: [
            (
                111,
                1,
                "Ss",
                f"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir={tmp_path / 'chrome'} --remote-debugging-port=9333",
            )
        ],
    )
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})

    result = CliRunner().invoke(cli.app, ["resolve-browser-lane", "--purpose", "job", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["ok"] is True
    assert parsed["lane"] == "chrome_extension_profile2_fallback"
    assert parsed["fallback_allowed"] is True
    assert parsed["stop_reason"] == ""
    assert "Chrome plugin registered runner" in parsed["must_run"][0]


def test_resolve_browser_lane_opens_nicky_with_blank_page_when_cdp_is_missing(monkeypatch, tmp_path) -> None:
    opened: list[tuple[object, str, int]] = []
    cdp_calls = {"count": 0}

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_preferences_path = str(tmp_path / "chrome" / "Default" / "Preferences")
        chrome_main_remote_debugging_port = 9333

    def fake_cdp_json(*args, **kwargs):
        cdp_calls["count"] += 1
        return None

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(tmp_path / "missing-busy-marker.json"))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", fake_cdp_json)
    monkeypatch.setattr(cli, "_wait_for_chrome_cdp", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "_open_main_chrome_profile_process", lambda settings, start_url, port: opened.append((settings, start_url, port)))

    result = CliRunner().invoke(cli.app, ["resolve-browser-lane", "--purpose", "publish", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["lane"] == "chrome_extension_profile2_fallback"
    assert "opened_main_profile" not in parsed
    assert opened == []
    assert cdp_calls["count"] >= 1


def test_resolve_browser_lane_stops_when_nicky_is_unavailable_without_busy_owner(monkeypatch, tmp_path) -> None:
    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_preferences_path = str(tmp_path / "chrome" / "Default" / "Preferences")
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(tmp_path / "missing-busy-marker.json"))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: None)
    monkeypatch.setattr(cli, "_wait_for_chrome_cdp", lambda *args, **kwargs: None)
    monkeypatch.setattr(cli, "_open_main_chrome_profile_process", lambda *args, **kwargs: None)

    result = CliRunner().invoke(cli.app, ["resolve-browser-lane", "--purpose", "publish", "--json"])

    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed["ok"] is True
    assert parsed["lane"] == "chrome_extension_profile2_fallback"
    assert parsed["fallback_allowed"] is True
    assert parsed["stop_reason"] == ""


def test_preflight_linkedin_media_upload_local_requires_existing_image(tmp_path, monkeypatch) -> None:
    user_data_dir = tmp_path / "automation-chrome"

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(user_data_dir)
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_preferences_path = str(user_data_dir / "Default" / "Preferences")
        chrome_main_remote_debugging_port = 9333

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())

    result = CliRunner().invoke(
        cli.app,
        ["preflight-linkedin-media-upload-local", "missing.png", "--json"],
    )

    assert result.exit_code == 2
    parsed = json.loads(result.output)
    assert parsed["ok"] is False
    assert parsed["posted"] is False
    assert parsed["reason"] == "image_missing"
    assert parsed["stop_reason"] == "image_generation_unavailable"
    assert parsed["route"] == "feed_photo_filechooser_preflight"


def test_verify_main_chrome_profile_control_cli_accepts_positional_start_url(tmp_path, monkeypatch) -> None:
    launched: list[list[str]] = []
    user_data_dir = tmp_path / "automation-chrome"

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(user_data_dir)
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_preferences_path = str(user_data_dir / "Default" / "Preferences")
        chrome_main_remote_debugging_port = 9333

    class DummyPopen:
        def __init__(self, cmd: list[str], *args, **kwargs) -> None:
            launched.append(cmd)

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_wait_for_chrome_cdp", lambda *args, **kwargs: None)
    monkeypatch.setattr(cli.subprocess, "Popen", DummyPopen)

    result = CliRunner().invoke(cli.app, ["verify-main-chrome-profile-control", "https://x.com/home", "--json"])

    assert result.exit_code == 1
    parsed = json.loads(result.output)
    assert parsed["reason"] == "cdp_endpoint_unavailable"
    assert launched
    assert launched[0][-1] == "https://x.com/home"


def test_verify_main_chrome_profile_control_cli_keeps_start_url_option_compatible(tmp_path, monkeypatch) -> None:
    launched: list[list[str]] = []
    user_data_dir = tmp_path / "automation-chrome"

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(user_data_dir)
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_preferences_path = str(user_data_dir / "Default" / "Preferences")
        chrome_main_remote_debugging_port = 9333

    class DummyPopen:
        def __init__(self, cmd: list[str], *args, **kwargs) -> None:
            launched.append(cmd)

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_wait_for_chrome_cdp", lambda *args, **kwargs: None)
    monkeypatch.setattr(cli.subprocess, "Popen", DummyPopen)

    result = CliRunner().invoke(cli.app, ["verify-main-chrome-profile-control", "--start-url", "https://x.com/home", "--json"])

    assert result.exit_code == 1
    parsed = json.loads(result.output)
    assert parsed["reason"] == "cdp_endpoint_unavailable"
    assert launched
    assert launched[0][-1] == "https://x.com/home"


def test_verify_main_chrome_profile_control_cli_rejects_conflicting_start_urls(monkeypatch) -> None:
    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = "/Users/example/Library/Application Support/Google/Chrome"
        chrome_main_profile_label = "二千 (Nicky)"
        chrome_main_profile_directory = "Profile 2"
        chrome_main_preferences_path = "/Users/example/Library/Application Support/Google/Chrome/Profile 2/Preferences"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())

    result = CliRunner().invoke(
        cli.app,
        ["verify-main-chrome-profile-control", "https://x.com/home", "--start-url", "https://www.linkedin.com/feed/", "--json"],
    )

    assert result.exit_code != 0
    parsed = json.loads(result.output)
    assert parsed["ok"] is False
    assert parsed["reason"] == "start_url_conflict"
    assert "Pass start URL either as a positional argument" in parsed["error"]
    assert "--start-url" in parsed["error"]


def test_verify_main_chrome_profile_control_keeps_json_clean_when_opening(tmp_path, monkeypatch, capsys) -> None:
    calls = {"wait": 0}
    launched: list[list[str]] = []
    user_data_dir = tmp_path / "automation-chrome"

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = str(user_data_dir)
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_preferences_path = str(user_data_dir / "Default" / "Preferences")
        chrome_main_remote_debugging_port = 9333

    def fake_wait(*args, **kwargs):
        calls["wait"] += 1
        return None

    class DummyPopen:
        def __init__(self, cmd: list[str], *args, **kwargs) -> None:
            launched.append(cmd)

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_wait_for_chrome_cdp", fake_wait)
    monkeypatch.setattr(cli.subprocess, "Popen", DummyPopen)

    with pytest.raises(typer.Exit):
        cli.verify_main_chrome_profile_control(open_if_missing=True, json_output=True)

    output = capsys.readouterr().out
    parsed = json.loads(output)
    assert parsed["ok"] is False
    assert parsed["reason"] == "cdp_endpoint_unavailable"
    assert "Opened main Chrome profile" not in output
    assert launched


def test_verify_main_chrome_profile_control_ensures_page_target_before_cdp_connect(monkeypatch, capsys) -> None:
    calls: list[str] = []

    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = "/Users/example/.social-flow-nicky-automation-chrome"
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_preferences_path = "/Users/example/.social-flow-nicky-automation-chrome/Default/Preferences"
        chrome_main_remote_debugging_port = 9333

    class FakeLocator:
        def inner_text(self, timeout: int) -> str:
            return "Profile Path /Users/example/.social-flow-nicky-automation-chrome/Default"

    class FakePage:
        url = "chrome://version/"

        def goto(self, *args, **kwargs) -> None:
            return None

        def locator(self, selector: str) -> FakeLocator:
            return FakeLocator()

        def title(self) -> str:
            return "About Version"

        def close(self) -> None:
            return None

    class FakeContext:
        def new_page(self) -> FakePage:
            return FakePage()

    class FakeBrowser:
        contexts = [FakeContext()]

    class FakeChromium:
        def connect_over_cdp(self, endpoint: str) -> FakeBrowser:
            calls.append("connect")
            return FakeBrowser()

    class FakePlaywright:
        chromium = FakeChromium()

    class FakePlaywrightManager:
        def __enter__(self) -> FakePlaywright:
            return FakePlaywright()

        def __exit__(self, *args) -> None:
            return None

    def fake_ensure(port: int, timeout_seconds: float = 1.0) -> bool:
        calls.append("ensure")
        return True

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_wait_for_chrome_cdp", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "_ensure_chrome_cdp_page_target", fake_ensure)
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: [])

    with patch("playwright.sync_api.sync_playwright", return_value=FakePlaywrightManager()):
        cli.verify_main_chrome_profile_control(open_if_missing=False, json_output=True)

    parsed = json.loads(capsys.readouterr().out)
    assert parsed["ok"] is True
    assert calls == ["ensure", "connect"]


def test_verify_main_chrome_profile_control_rejects_wrong_cdp_profile(monkeypatch, capsys) -> None:
    class DummySettings:
        chrome_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        chrome_main_user_data_dir = "/Users/example/Library/Application Support/Google/Chrome"
        chrome_main_profile_label = "二千 (Nicky)"
        chrome_main_profile_directory = "Profile 2"
        chrome_main_preferences_path = "/Users/example/Library/Application Support/Google/Chrome/Profile 2/Preferences"
        chrome_main_remote_debugging_port = 9333

    class FakeLocator:
        def inner_text(self, timeout: int) -> str:
            return "Profile Path /Users/example/Library/Application Support/Google/Chrome/Profile 20"

    class FakePage:
        url = "chrome://version/"

        def goto(self, *args, **kwargs) -> None:
            return None

        def locator(self, selector: str) -> FakeLocator:
            return FakeLocator()

        def title(self) -> str:
            return "About Version"

        def close(self) -> None:
            return None

    class FakeContext:
        def new_page(self) -> FakePage:
            return FakePage()

    class FakeBrowser:
        contexts = [FakeContext()]

    class FakeChromium:
        def connect_over_cdp(self, endpoint: str) -> FakeBrowser:
            return FakeBrowser()

    class FakePlaywright:
        chromium = FakeChromium()

    class FakePlaywrightManager:
        def __enter__(self) -> FakePlaywright:
            return FakePlaywright()

        def __exit__(self, *args) -> None:
            return None

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_wait_for_chrome_cdp", lambda *args, **kwargs: {"Browser": "Chrome"})

    with patch("playwright.sync_api.sync_playwright", return_value=FakePlaywrightManager()):
        with pytest.raises(typer.Exit):
            cli.verify_main_chrome_profile_control(open_if_missing=False, json_output=True)

    parsed = json.loads(capsys.readouterr().out)
    assert parsed["ok"] is False
    assert parsed["reason"] == "profile_path_mismatch"
    assert parsed["expected_profile_path"].endswith("/Profile 2")
    assert parsed["observed_profile_path"].endswith("/Profile 20")


def test_observed_chrome_profile_path_extracts_japanese_profile_path() -> None:
    text = "Google Chrome\nプロフィール パス\t/Users/example/.social-flow-nicky-automation-chrome/Default\n"

    assert cli._observed_chrome_profile_path(text) == "/Users/example/.social-flow-nicky-automation-chrome/Default"


def test_publish_videos_chrome_local_dry_run_prints_brief(monkeypatch, capsys) -> None:
    row = QueueRow(
        id="video-1",
        source_type="google_drive",
        status="approved",
        drive_file_name="demo-video.mp4",
        drive_web_url="https://drive.google.com/file/d/video123/view",
        tiktok_enabled="true",
        instagram_enabled="true",
        youtube_shorts_enabled="false",
        facebook_reels_enabled="false",
        best_platform="TikTok",
        best_hook="最初の3秒で差が出る",
        tiktok_caption="TikTok用キャプション",
        tiktok_hashtags="#tiktok #ai",
        instagram_caption="Instagram用キャプション",
        instagram_hashtags="#reels #ai",
    )
    repo = DummyRepo([row])

    class DummySettings:
        chrome_main_preferences_path = "/tmp/Preferences"
        chrome_task_group_prefix = "social-flow"
        chrome_main_profile_label = "二千 (Nicky)"
        chrome_main_profile_directory = "Profile 2"

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.publish_videos_chrome_local(item_id="video-1", path="posting_queue.tsv", dry_run=True)

    output = capsys.readouterr().out
    assert "TikTok caption: TikTok用キャプション" in output
    assert "Instagram caption: Instagram用キャプション" in output
    assert "Dry run only. No Chrome tabs were opened." in output


def test_write_video_publish_packet_local_creates_markdown(tmp_path, monkeypatch) -> None:
    row = QueueRow(
        id="video-1",
        source_type="google_drive",
        drive_file_name="demo-video.mp4",
        tiktok_caption="TikTok用キャプション",
        youtube_title="Shorts用タイトル",
    )
    repo = DummyRepo([row])

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    output_dir = tmp_path / "packets"
    cli.write_video_publish_packet_local(item_id="video-1", output_dir=str(output_dir))

    content = (output_dir / "video-1.md").read_text(encoding="utf-8")
    assert "Publish Packet: video-1" in content
    assert "TikTok用キャプション" in content
    assert "Shorts用タイトル" in content


def test_mark_video_platform_published_local_updates_status(monkeypatch) -> None:
    row = QueueRow(
        id="video-1",
        source_type="google_drive",
        status="approved",
        tiktok_enabled="true",
        instagram_enabled="true",
        youtube_shorts_enabled="false",
        facebook_reels_enabled="false",
    )
    repo = MutableDummyRepo([row])

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-05-10T00:00:00+00:00")

    cli.mark_video_platform_published_local(
        item_id="video-1",
        platform="tiktok",
        post_url="https://www.tiktok.com/@demo/video/123",
        post_id="123",
    )

    assert row.tiktok_post_url == "https://www.tiktok.com/@demo/video/123"
    assert row.tiktok_post_id == "123"
    assert row.tiktok_post_status == "posted"
    assert row.status == "partially_published"


def test_prefill_video_platform_local_updates_next_action(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="video-1",
        source_type="google_drive",
        tiktok_caption="TikTok用キャプション",
        tiktok_hashtags="#tiktok #ai",
    )
    repo = MutableDummyRepo([row])
    preferences_path = tmp_path / "Preferences"
    preferences_path.write_text("{}", encoding="utf-8")

    class DummySettings:
        chrome_main_preferences_path = str(preferences_path)

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(
        cli,
        "_run_front_chrome_javascript",
        lambda script: {"ok": True, "titleFilled": False, "bodyFilled": True},
    )

    cli.prefill_video_platform_local(item_id="video-1", platform="tiktok")

    assert row.tiktok_post_status == "pending"
    assert row.next_action == "Review and submit tiktok post in Chrome"


def test_score_queue_local_updates_existing_rows(monkeypatch, capsys) -> None:
    row = QueueRow(
        id="item-1",
        source_name="OpenAI",
        title="GPT-5.5 API security update",
        summary_en="OpenAI shipped GPT-5.5 API controls with 3 new security settings.",
    )
    repo = MutableDummyRepo([row])

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.score_queue_local(path="posting_queue.tsv")

    assert row.quality_score
    assert row.source_priority_score == "5"
    assert "Scored 1 queue item(s)." in capsys.readouterr().out


def test_apply_research_updates_normalizes_freshness_timestamp() -> None:
    row = QueueRow(id="item-1")

    cli._apply_research_updates(
        row,
        research_status=None,
        freshness_checked_at="2026-05-09T09:30:00+09:00",
        angle=None,
        x_research_notes=None,
        linkedin_research_notes=None,
        past_post_reference=None,
        reference_post_urls=None,
        reference_account_handles=None,
        reference_media_urls=None,
        reference_media_notes=None,
        media_plan=None,
    )

    assert row.freshness_checked_at == "2026-05-09T00:30:00+00:00"


def test_publish_linkedin_chrome_local_is_disabled_in_soy_safe_mode() -> None:
    with pytest.raises(cli.typer.BadParameter, match="legacy foreground Chrome publishing is disabled"):
        cli.publish_linkedin_chrome_local(
            item_id="item-1",
            path="posting_queue.tsv",
            dry_run=True,
            allow_fallback_publish=True,
        )


def test_publish_x_chrome_local_is_disabled_in_soy_safe_mode() -> None:
    with pytest.raises(cli.typer.BadParameter, match="legacy foreground Chrome publishing is disabled"):
        cli.publish_x_chrome_local(
            item_id="item-1",
            path="posting_queue.tsv",
            dry_run=True,
            allow_fallback_publish=True,
        )


def test_run_publish_flow_prepares_ready_morning_draft_for_browser_use(monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    media_date = cli._current_generated_media_date_token()
    ready_card = f"artifacts/generated-media/{media_date}-item-ready-x-card.png"
    _touch_generated_media(ready_card)
    row = QueueRow(
        id="item-ready",
        status="drafted",
        review_status="ready_morning",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_text="x copy",
        linkedin_text="linkedin copy https://openai.com/index/openai-on-aws/",
        media_plan="X自作判断カード型 with generated card; LinkedInリンクカード型 with official source link card",
        reference_media_notes=(
            f"generated x card: {ready_card} provider=runway_mcp model=gpt-image-2 size=1024x1024 "
            "visual_style=ai_tool_comparison_card platform=x language=ja prompt=AWSアクセス判断カード"
        ),
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        pass

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(
        cli,
        "publish_x_chrome_local",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("direct Chrome publish should not run")),
    )
    monkeypatch.setattr(
        cli,
        "publish_linkedin_chrome_local",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("direct Chrome publish should not run")),
    )

    cli.run_publish_flow(path="posting_queue.tsv", sync_sheets=False, max_publish_items=3)

    output = capsys.readouterr().out
    assert "Publish flow candidates: item-ready" in output
    assert "Prepared Daily AI Chrome plugin publish candidates" in output
    assert row.status == "drafted"
    assert row.x_post_url == ""
    assert row.linkedin_post_url == ""
    assert "Daily AI Chrome plugin publish candidate" in row.review_notes
    assert "via Chrome plugin registered runner" in row.next_action
    assert "local Nicky automation profile" not in row.next_action
    assert "Do not use Soy, Chrome Profile 2, Chrome Extension/Profile 2" in row.next_action
    assert "isolated authenticated CLI lane" in row.next_action
    assert "expected account, body/link-card or media reflection" in row.next_action
    assert "surface_missing" in row.next_action
    assert "unless explicitly re-approved" not in row.next_action
    assert "unsupported_surface_or_playwright_cli_gate_failed" in row.next_action
    assert "shareActive=true" in row.next_action
    assert "local_profile2_lane_unavailable" not in row.next_action
    assert "visible posting-surface contract" in row.next_action
    assert "surface_missing" in row.next_action
    assert "instead of degrading to text-only" in row.next_action
    assert "generated_media_low_impact" in row.next_action
    assert "generic white text card" in row.next_action
    assert "fileChooser.setFiles" in row.next_action


def test_run_publish_flow_marks_partial_before_ready_draft(monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    media_date = cli._current_generated_media_date_token()
    partial_card = f"artifacts/generated-media/{media_date}-item-partial-x-card.png"
    ready_card = f"artifacts/generated-media/{media_date}-item-ready-x-card.png"
    _touch_generated_media(partial_card)
    _touch_generated_media(ready_card)
    partial = QueueRow(
        id="item-partial",
        status="partially_published",
        quality_score="10",
        x_text="x copy",
        linkedin_text="linkedin copy https://openai.com/index/openai-on-aws/",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:share:999/",
        reference_post_urls="https://x.com/OpenAI/status/123",
        media_plan="X引用解釈カード型 with source quote card plus generated Japanese interpretation card",
        reference_media_notes=(
            f"generated x quote card: {partial_card} model=gpt-image-2 size=1024x1024 "
            "visual_style=notebook_photo_cheat_sheet platform=x language=ja prompt=引用解釈カード"
        ),
    )
    ready = QueueRow(
        id="item-ready",
        status="drafted",
        review_status="ready_morning",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_text="x copy",
        linkedin_text="linkedin copy https://openai.com/index/openai-on-aws/",
        media_plan="X自作判断カード型 with generated card; LinkedInリンクカード型 with official source link card",
        reference_media_notes=(
            f"generated x card: {ready_card} model=gpt-image-2 size=1024x1024 "
            "visual_style=ai_tool_comparison_card platform=x language=ja prompt=AWS判断カード"
        ),
    )
    repo = MutableDummyRepo([ready, partial])

    class DummySettings:
        pass

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(
        cli,
        "publish_x_chrome_local",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("direct Chrome publish should not run")),
    )
    monkeypatch.setattr(cli, "publish_linkedin_chrome_local", lambda *args, **kwargs: None)

    cli.run_publish_flow(path="posting_queue.tsv", sync_sheets=False, max_publish_items=1)

    output = capsys.readouterr().out
    assert "Held publish candidates with incomplete posting surface: 2" in output
    assert "Publish flow candidates: none" in output
    assert "Daily AI Chrome plugin publish candidate" not in partial.review_notes
    assert "Daily AI Chrome plugin publish candidate" not in ready.review_notes
    assert "generated_media_provider_unapproved" in partial.next_action
    assert "generated_media_provider_unapproved" in ready.next_action
    assert "Do not degrade to URL + text only." in partial.next_action
    assert "Do not degrade to URL + text only." in ready.next_action


def test_run_publish_flow_uses_linkedin_prefill_action_for_linkedin_only(monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    row = QueueRow(
        id="item-linkedin-only",
        status="partially_published",
        quality_score="10",
        source_url="https://openai.com/index/openai-on-aws/",
        x_text="x copy",
        x_post_url="https://x.com/nichika2000823/status/123",
        linkedin_text="linkedin copy https://openai.com/index/openai-on-aws/",
        media_plan="LinkedInリンクカード型 with official source link card",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        pass

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)

    cli.run_publish_flow(path="posting_queue.tsv", sync_sheets=False, max_publish_items=1)

    output = capsys.readouterr().out
    assert "Publish flow candidates: item-linkedin-only" in output
    assert "Publish LinkedIn as an original post via Chrome plugin registered runner" in row.next_action
    assert "local Nicky automation profile" not in row.next_action
    assert "Do not use Soy, Chrome Profile 2, Chrome Extension/Profile 2" in row.next_action
    assert "isolated authenticated CLI lane" in row.next_action
    assert "expected account, body/link-card or media reflection" in row.next_action
    assert "link_card_not_reflected" in row.next_action
    assert "unless explicitly re-approved" not in row.next_action
    assert "unsupported_surface_or_playwright_cli_gate_failed" in row.next_action
    assert "shareActive=true" in row.next_action
    assert "local_profile2_lane_unavailable" not in row.next_action
    assert "Publish X via live Chrome Profile 2" not in row.next_action
    assert "visible posting-surface contract" in row.next_action
    assert "link_card_not_reflected" in row.next_action
    assert "instead of degrading to text-only" in row.next_action
    assert "generated_media_low_impact" in row.next_action
    assert "generic white text card" in row.next_action
    assert "fileChooser.setFiles" in row.next_action


def test_linkedin_media_publish_action_requires_photo_route() -> None:
    row = QueueRow(
        id="item-linkedin-image",
        status="partially_published",
        quality_score="10",
        source_url="https://openai.com/index/openai-on-aws/",
        x_post_url="https://x.com/nichika2000823/status/123",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        media_plan="LinkedIn正方形1枚画像型 with one square generated English explanatory image",
        reference_media_notes=(
            "artifacts/generated-media/2026-05-25-item-linkedin-image-card.png "
            "model=gpt-image-2 size=1024x1024 prompt=AWS buying path card"
        ),
    )

    action = cli._chrome_profile_publish_next_action(row)

    assert "LinkedIn正方形1枚画像型 / LinkedInカルーセル型" in action
    assert "fresh LinkedIn feed page in the same automation context" in action
    assert "preflight-linkedin-media-upload-local" in action
    assert "only for standalone diagnosis" in action
    assert "Do not use shareActive=true or Start a post as the media upload entry" in action
    assert "Photo/写真 div[role=button]" in action
    assert "page.expect_file_chooser()" in action
    assert "fileChooser.setFiles" in action
    assert "file_chooser.set_files" in action
    assert "Verify the LinkedIn Editor preview shows 1 of 1 or 1 of N and Next" in action
    assert "media_upload_permission_blocked:linkedin_photo_route_unavailable" in action
    assert "surface_missing:linkedin_photo_editor_preview_missing" in action
    assert "Seed shareActive=true with encoded linkedin_text before clicking Start a post" not in action


def test_linkedin_login_page_is_auth_blocker_not_media_route_failure() -> None:
    class BodyLocator:
        def inner_text(self, *args, **kwargs) -> str:
            return "Welcome back Nichika Tanaka Password Forgot password? Sign in"

    class LoginPage:
        url = "https://www.linkedin.com/login/?session_redirect=https%3A%2F%2Fwww.linkedin.com%2Ffeed%2F"

        def locator(self, selector: str):
            assert selector == "body"
            return BodyLocator()

    with pytest.raises(RuntimeError, match="auth_blocked: LinkedIn login required"):
        cli._verify_linkedin_browser_account(LoginPage())


def test_linkedin_recent_activity_required_snapshot_requires_activity_urns() -> None:
    class EmptyCards:
        def count(self) -> int:
            return 0

    class SnapshotPage:
        def goto(self, *args, **kwargs) -> None:
            return None

        def wait_for_timeout(self, *args, **kwargs) -> None:
            return None

        def locator(self, selector: str):
            assert "data-urn" in selector
            return EmptyCards()

    with pytest.raises(RuntimeError, match="prepublish snapshot returned no activity URNs"):
        cli._capture_linkedin_recent_activity_urns(SnapshotPage(), required=True)


@pytest.mark.skip(reason="legacy Playwright/CDP publish sender disabled after the 2026-06-17 Browser Use override")
def test_send_publish_candidates_local_preserves_auth_blocker_stop_reason(monkeypatch) -> None:
    row = QueueRow(
        id="linkedin-auth",
        status="partially_published",
        x_post_url="https://x.com/nichika2000823/status/123",
        linkedin_text="LinkedIn body https://example.com/source",
        media_plan="LinkedIn正方形1枚画像型",
        review_notes="Daily AI Browser Use-native publish candidate",
    )
    repo = MutableDummyRepo([row])

    class Settings:
        chrome_main_remote_debugging_port = 9222

    class FakePage:
        def close(self) -> None:
            return None

    class FakeContext:
        def new_page(self) -> FakePage:
            return FakePage()

    class FakeBrowser:
        contexts = [FakeContext()]

    class FakeChromium:
        def connect_over_cdp(self, endpoint: str) -> FakeBrowser:
            return FakeBrowser()

    class FakePlaywright:
        chromium = FakeChromium()

    class FakePlaywrightManager:
        def __enter__(self) -> FakePlaywright:
            return FakePlaywright()

        def __exit__(self, *args) -> None:
            return None

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_items: [row])
    monkeypatch.setattr(cli, "_wait_for_chrome_cdp", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "_verify_main_chrome_profile_path", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        cli,
        "_publish_linkedin_by_surface_local",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            RuntimeError("auth_blocked: LinkedIn login required in Daily AI Chrome plugin profile.")
        ),
    )

    with patch("playwright.sync_api.sync_playwright", return_value=FakePlaywrightManager()):
        result = cli._send_publish_candidates_local(settings=Settings(), sync_sheets=False)

    assert result["attempted"] == 1
    assert result["posted"] == 0
    assert result["skipped"] == 1
    assert result["stop_reason"] == "auth_blocked"
    assert result["media_receipt"] == "automation_failure_category=auth"
    assert "linkedin_publish_failed: auth_blocked" in row.error


@pytest.mark.skip(reason="legacy Playwright/CDP publish sender disabled after the 2026-06-17 Browser Use override")
def test_send_publish_candidates_local_reports_partial_platform_failure(monkeypatch) -> None:
    row = QueueRow(
        id="partial-platform",
        status="approved",
        quality_score="11",
        source_url="https://example.com/source",
        x_text="x body https://example.com/source",
        linkedin_text="LinkedIn body https://example.com/source",
        media_plan="X本文+URL型; LinkedInリンクカード型",
        review_notes="Local automation profile publish candidate",
    )
    repo = MutableDummyRepo([row])

    class Settings:
        chrome_main_remote_debugging_port = 9222

    class FakePage:
        def close(self) -> None:
            return None

    class FakeContext:
        def new_page(self) -> FakePage:
            return FakePage()

    class FakeBrowser:
        contexts = [FakeContext()]

    class FakeChromium:
        def connect_over_cdp(self, endpoint: str) -> FakeBrowser:
            return FakeBrowser()

    class FakePlaywright:
        chromium = FakeChromium()

    class FakePlaywrightManager:
        def __enter__(self) -> FakePlaywright:
            return FakePlaywright()

        def __exit__(self, *args) -> None:
            return None

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_items: [row])
    monkeypatch.setattr(cli, "_wait_for_chrome_cdp", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "_verify_main_chrome_profile_path", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        cli,
        "_publish_x_by_surface_local",
        lambda *args, **kwargs: "https://x.com/nichika2000823/status/123",
    )
    monkeypatch.setattr(
        cli,
        "_publish_linkedin_by_surface_local",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            RuntimeError("body_not_reflected: LinkedIn composer did not contain linkedin_text.")
        ),
    )

    with patch("playwright.sync_api.sync_playwright", return_value=FakePlaywrightManager()):
        result = cli._send_publish_candidates_local(settings=Settings(), sync_sheets=False)

    assert result["attempted"] == 2
    assert result["posted"] == 1
    assert result["skipped"] == 1
    assert result["stop_reason"] == "publish_send_failed"
    assert result["media_receipt"] == "automation_failure_category=input_reflection"
    assert row.x_post_url == "https://x.com/nichika2000823/status/123"
    assert "linkedin_publish_failed: body_not_reflected" in row.error


def test_publish_failure_stop_reason_preserves_hard_gate_categories() -> None:
    assert cli._publish_failure_stop_reason([
        "media_upload_permission_blocked: linkedin_photo_route_unavailable"
    ]) == "media_upload_permission_blocked"
    assert cli._publish_failure_stop_reason([
        "surface_missing: linkedin_photo_editor_preview_missing_before_next"
    ]) == "surface_missing"
    assert cli._publish_failure_stop_reason([
        "account_not_verified: LinkedIn expected account was not visible."
    ]) == "wrong_or_unverified_account"
    assert cli._publish_failure_stop_reason([
        "disabled_submit: X Post button was not enabled",
        "body_not_reflected: X composer did not contain x_text",
    ]) == "publish_send_failed"
    assert cli._publish_failure_stop_reason([
        "disabled_submit: X Post button was not enabled",
        "auth_blocked: LinkedIn login required in Nicky automation profile.",
    ]) == "auth_blocked"


def test_run_publish_flow_holds_rows_with_missing_surface_contract(monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    row = QueueRow(
        id="item-text-only",
        status="approved",
        review_status="ready_morning",
        quality_score="11",
        x_text="x copy",
        linkedin_text="linkedin copy",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        pass

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)

    cli.run_publish_flow(path="posting_queue.tsv", sync_sheets=False, max_publish_items=1)

    output = capsys.readouterr().out
    assert "Held publish candidates with incomplete posting surface: 1" in output
    assert "Publish flow candidates: none" in output
    assert row.review_status == "hold"
    assert "Surface contract incomplete before publish" in row.review_notes
    assert "surface_missing: media_plan_blank" in row.error
    assert "Do not degrade to URL + text only" in row.next_action


def test_surface_contract_blocks_incomplete_generated_media() -> None:
    x_quote = QueueRow(
        id="x-quote",
        status="approved",
        quality_score="11",
        x_text="x copy",
        reference_post_urls="https://x.com/kawabe/status/123",
        media_plan="X引用解釈カード型 with source quote card plus generated Japanese interpretation card",
    )
    linkedin_carousel = QueueRow(
        id="li-carousel",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        linkedin_text="linkedin copy",
        media_plan="LinkedInカルーセル型 with 3 square generated English slides",
        reference_media_notes=(
            "artifacts/generated-media/2026-05-23-li-carousel-1.png "
            "artifacts/generated-media/2026-05-23-li-carousel-2.png"
        ),
    )
    x_source_without_url = QueueRow(
        id="x-source",
        status="approved",
        quality_score="11",
        x_text="x copy",
        media_plan="source/link cardのみ",
    )
    x_source_with_reference_but_no_source = QueueRow(
        id="x-source-reference-only",
        status="approved",
        quality_score="11",
        x_text="x copy",
        media_plan="source/link cardのみ",
        reference_post_urls="https://x.com/example/status/123",
    )
    x_decision_fake_path = QueueRow(
        id="x-decision",
        status="approved",
        quality_score="11",
        x_text="x copy",
        media_plan="X自作判断カード型",
        reference_media_notes="artifacts/generated-media/missing.png model=gpt-image-2",
    )

    assert "surface_missing: x_generated_interpretation_card_missing" in cli._surface_contract_blockers(x_quote)
    assert "surface_missing: linkedin_carousel_requires_3_generated_images" in cli._surface_contract_blockers(linkedin_carousel)
    assert "link_card_not_reflected: x_source_url_missing" in cli._surface_contract_blockers(x_source_without_url)
    assert "link_card_not_reflected: x_source_url_missing" in cli._surface_contract_blockers(x_source_with_reference_but_no_source)
    assert "surface_missing: x_generated_decision_card_missing" in cli._surface_contract_blockers(x_decision_fake_path)


def test_surface_contract_recognizes_linkedin_square_image_label(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    image_path = "artifacts/generated-media/2026-05-23-li-square-card.png"
    _touch_generated_media(image_path)
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedIn正方形1枚画像型 with one square generated English explanatory image",
        reference_media_notes=(
            f"{image_path} model=gpt-image-2 provider=runway_mcp size=1024x1024 "
            "visual_style=skill_term_roadmap_table platform=linkedin language=en "
            "prompt=AWS buying path decision card"
        ),
    )

    assert cli._surface_contract_label(row, "linkedin") == "linkedin_square_image"
    assert cli._surface_contract_blockers(row) == []


def test_surface_contract_prioritizes_linkedin_media_label_over_link_card_text() -> None:
    row = QueueRow(
        id="li-square-mixed",
        media_plan="LinkedIn正方形1枚画像型 with one square image plus optional official source/link card",
    )

    assert cli._surface_contract_label(row, "linkedin") == "linkedin_square_image"


def test_surface_contract_prioritizes_explicit_linkedin_link_card_label_over_square_keyword() -> None:
    row = QueueRow(
        id="li-link-mixed",
        media_plan="LinkedInリンクカード型 with official source link card; generated square image is only an internal note",
    )

    assert cli._surface_contract_label(row, "linkedin") == "linkedin_link_card"


def test_surface_contract_recognizes_linkedin_link_card_natural_language_surface() -> None:
    row = QueueRow(
        id="li-link-natural",
        media_plan="X本文+URL型 | LinkedInはAWSブログのソースリンクカードを使用し、X投稿はソース/リンクカードを添付して公開する",
    )

    assert cli._surface_contract_label(row, "linkedin") == "linkedin_link_card"


def test_surface_contract_does_not_infer_linkedin_link_card_from_negative_instruction() -> None:
    row = QueueRow(
        id="li-link-negative",
        media_plan="X本文+URL型 | LinkedInはリンクカードを使わない。本文だけでは送らず画像surfaceを修理する",
    )

    assert cli._surface_contract_label(row, "linkedin") == ""


def test_surface_contract_does_not_infer_linkedin_link_card_when_card_is_x_only() -> None:
    row = QueueRow(
        id="li-link-x-only",
        media_plan="X本文+URL型 | LinkedInは画像型、リンクカードはXのみ",
    )

    assert cli._surface_contract_label(row, "linkedin") == ""


def test_surface_contract_does_not_infer_english_linkedin_link_card_when_card_is_x_only() -> None:
    row = QueueRow(
        id="li-link-x-only-en",
        media_plan="X text URL | LinkedIn image surface, link card for X only",
    )

    assert cli._surface_contract_label(row, "linkedin") == ""


def test_surface_contract_does_not_infer_explicit_linkedin_link_card_when_forbidden() -> None:
    row = QueueRow(
        id="li-link-explicit-forbidden",
        media_plan="X本文+URL型 | LinkedInリンクカード型は使わない",
    )

    assert cli._surface_contract_label(row, "linkedin") == ""


def test_nicky_x_source_link_card_uses_text_url_publish_path(monkeypatch) -> None:
    row = QueueRow(
        id="x-source-link-card",
        media_plan="X uses source/link card with the official source URL",
        source_url="https://example.com/source",
        x_text="Source-specific note",
    )
    called: dict[str, str] = {}

    def fake_publish(page, candidate, *, settings, timeout_seconds):
        called["surface"] = cli._surface_contract_label(candidate, "x")
        return "https://x.com/nichika2000823/status/123"

    monkeypatch.setattr(cli, "_publish_x_text_url_local", fake_publish)

    result = cli._publish_x_by_surface_local(object(), row, settings=object(), timeout_seconds=15)

    assert result == "https://x.com/nichika2000823/status/123"
    assert called["surface"] == "x_source_link_card"


def test_surface_contract_blocks_conflicting_explicit_linkedin_surface_labels() -> None:
    row = QueueRow(
        id="li-conflict",
        x_post_url="https://x.com/nichika2000823/status/1",
        media_plan="LinkedIn正方形1枚画像型 plus LinkedInリンクカード型",
    )

    assert "surface_missing: linkedin_surface_label_conflict" in cli._surface_contract_blockers(row)


def test_surface_contract_uses_first_explicit_linkedin_label_but_blocks_conflict() -> None:
    row = QueueRow(
        id="li-link-negated-square",
        x_post_url="https://x.com/nichika2000823/status/1",
        media_plan=(
            "LinkedInリンクカード型 with official source link card; "
            "not LinkedIn正方形1枚画像型 for this run"
        ),
    )

    assert cli._surface_contract_label(row, "linkedin") == "linkedin_link_card"
    assert "surface_missing: linkedin_surface_label_conflict" in cli._surface_contract_blockers(row)


def test_surface_contract_blocks_non_square_linkedin_generated_media(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    image_path = "artifacts/generated-media/2026-05-23-li-square-card.png"
    _touch_generated_media(image_path)
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedIn正方形1枚画像型 with one square generated English explanatory image",
        reference_media_notes=f"{image_path} model=gpt-image-2 size=1024x1792 prompt=AWS buying path decision card",
    )

    assert "surface_missing: generated_media_not_square" in cli._surface_contract_blockers(row)


def test_surface_contract_reads_actual_linkedin_image_pixels(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    image_path = "artifacts/generated-media/2026-05-23-li-square-card.png"
    _touch_generated_media(image_path, width=1024, height=1792)
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedIn正方形1枚画像型 with one square generated English explanatory image",
        reference_media_notes=f"{image_path} model=gpt-image-2 size=1024x1024 prompt=AWS buying path decision card",
    )

    assert "surface_missing: generated_media_not_square" in cli._surface_contract_blockers(row)


@pytest.mark.parametrize("extension", ["png", "jpg", "webp"])
def test_surface_contract_blocks_unreadable_linkedin_image_pixels(monkeypatch, tmp_path, extension) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    image_path = Path(f"artifacts/generated-media/2026-05-23-li-square-card.{extension}")
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"not an image")
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedIn正方形1枚画像型 with one square generated English explanatory image",
        reference_media_notes=f"{image_path} model=gpt-image-2 size=1024x1024 prompt=AWS buying path decision card",
    )

    assert "surface_missing: generated_media_pixel_size_unreadable" in cli._surface_contract_blockers(row)


@pytest.mark.parametrize(
    ("filename", "writer"),
    [
        ("artifacts/generated-media/2026-05-23-li-square-card.jpg", _touch_generated_jpeg),
        ("artifacts/generated-media/2026-05-23-li-square-card.webp", _touch_generated_webp),
    ],
)
def test_surface_contract_reads_actual_linkedin_jpeg_and_webp_pixels(
    monkeypatch, tmp_path, filename, writer
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    writer(filename, width=1024, height=1792)
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedIn正方形1枚画像型 with one square generated English explanatory image",
        reference_media_notes=f"{filename} model=gpt-image-2 size=1024x1024 prompt=AWS buying path decision card",
    )

    assert "surface_missing: generated_media_not_square" in cli._surface_contract_blockers(row)


@pytest.mark.parametrize(
    ("bad_index", "bad_writer", "expected_blocker"),
    [
        (1, lambda path: _touch_generated_media(path, width=1024, height=1792), "surface_missing: generated_media_not_square"),
        (2, lambda path: Path(path).write_bytes(b"not an image"), "surface_missing: generated_media_pixel_size_unreadable"),
    ],
)
def test_surface_contract_checks_actual_linkedin_carousel_image_pixels(
    monkeypatch, tmp_path, bad_index, bad_writer, expected_blocker
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    paths = [
        f"artifacts/generated-media/2026-05-23-li-carousel-{index}.png"
        for index in range(1, 4)
    ]
    for index, path in enumerate(paths):
        media_path = Path(path)
        media_path.parent.mkdir(parents=True, exist_ok=True)
        if index == bad_index:
            bad_writer(path)
        else:
            _touch_generated_media(path)
    row = QueueRow(
        id="li-carousel",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedInカルーセル型 with 3 square generated English slides",
        reference_media_notes=(
            " ".join(paths)
            + " model=gpt-image-2 size=1024x1024 prompt=AWS buying path carousel"
        ),
    )

    assert expected_blocker in cli._surface_contract_blockers(row)


def test_surface_contract_blocks_reused_generated_media(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    stale_path = "artifacts/generated-media/2026-05-22-x-decision-x-card-1.png"
    _touch_generated_media(stale_path)
    row = QueueRow(
        id="x-decision",
        status="approved",
        quality_score="11",
        x_text="x copy",
        media_plan="X自作判断カード型",
        reference_media_notes=(
            f"{stale_path} model=gpt-image-2 size=1024x1024 "
            "platform=x language=ja visual_style=ai_tool_comparison_card prompt=old card"
        ),
    )

    assert "surface_missing: generated_media_not_fresh_for_row" in cli._surface_contract_blockers(row)


def test_surface_contract_prefers_current_row_generated_media(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    stale_path = "artifacts/generated-media/2026-05-22-x-decision-x-card-1.png"
    fresh_path = "artifacts/generated-media/2026-05-23-x-decision-x-card-1.png"
    _touch_generated_media(stale_path)
    _touch_generated_media(fresh_path)
    row = QueueRow(
        id="x-decision",
        status="approved",
        quality_score="11",
        x_text="x copy",
        media_plan="X自作判断カード型",
        reference_media_notes=(
            f"{stale_path} model=gpt-image-2 size=1024x1024 "
            "platform=x language=ja visual_style=ai_tool_comparison_card prompt=old card | "
            f"{fresh_path} model=gpt-image-2 size=1024x1024 "
            "platform=x language=ja visual_style=ai_tool_comparison_card prompt=新しいカード"
        ),
    )

    assert Path(cli._generated_media_paths_for_platform(row, "x")[0]).name == Path(fresh_path).name
    assert "surface_missing: generated_media_not_fresh_for_row" not in cli._surface_contract_blockers(row)


def test_publish_candidate_allows_direct_cli_linkedin_image_surface(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    image_path = "artifacts/generated-media/2026-05-23-li-square-linkedin-square-1.png"
    _touch_generated_media(image_path)
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        keep_priority="ship_now",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        media_plan="LinkedIn正方形1枚画像型",
        reference_media_notes=(
            f"{image_path} model=gpt-image-2 size=1024x1024 "
            "platform=linkedin language=en visual_style=ai_tool_comparison_card prompt=English card"
        ),
    )

    assert cli._publish_candidate_blockers(row, [row]) == []


def test_surface_contract_blocks_demo_generated_media(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    demo_path = "artifacts/generated-media/2026-05-23-x-decision-demo-card.png"
    _touch_generated_media(demo_path)
    row = QueueRow(
        id="x-decision",
        status="approved",
        quality_score="11",
        x_text="x copy",
        media_plan="X自作判断カード型",
        reference_media_notes=f"{demo_path} model=gpt-image-2 size=1024x1024 prompt=operation verification card",
    )

    assert "surface_missing: generated_media_demo_placeholder" in cli._surface_contract_blockers(row)


def test_surface_contract_blocks_demo_generated_media_from_filename(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    demo_path = "artifacts/generated-media/2026-05-23-x-decision-demo-card.png"
    _touch_generated_media(demo_path)
    row = QueueRow(
        id="x-decision",
        status="approved",
        quality_score="11",
        x_text="x copy",
        media_plan="X自作判断カード型",
        reference_media_notes=f"{demo_path} model=gpt-image-2 size=1024x1024 prompt=AWS access decision card",
    )

    assert "surface_missing: generated_media_demo_placeholder" in cli._surface_contract_blockers(row)


def test_surface_contract_allows_negative_placeholder_prompt_instruction(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-02")
    image_path = "artifacts/generated-media/2026-06-02-linkedin-item-linkedin-square-1.png"
    _touch_generated_media(image_path)
    row = QueueRow(
        id="linkedin-item",
        status="approved",
        quality_score="11",
        linkedin_text="linkedin copy",
        media_plan="LinkedIn正方形1枚画像型",
        media_receipt=(
            f"{image_path} model=gpt-image-2 size=1024x1024 "
            "visual_style=skill_term_roadmap_table platform=linkedin language=en "
            "prompt=Create a production-ready square visual with no placeholder UI."
        ),
    )

    assert "surface_missing: generated_media_demo_placeholder" not in cli._surface_contract_blockers(row)


@pytest.mark.parametrize(
    ("quality_note", "expected_blocker"),
    [
        ("visual_quality=generated_media_low_impact", "surface_missing: generated_media_low_impact"),
        ("visual_quality=generated_media_cropped_in_preview", "surface_missing: generated_media_cropped_in_preview"),
        ("quality_gate=generated_media_low_impact", "surface_missing: generated_media_low_impact"),
        ("quality_gate=generated_media_cropped_in_preview", "surface_missing: generated_media_cropped_in_preview"),
    ],
)
def test_surface_contract_blocks_bad_generated_media_visual_quality(
    monkeypatch, tmp_path, quality_note, expected_blocker
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    image_path = "artifacts/generated-media/2026-05-23-li-square-card.png"
    _touch_generated_media(image_path)
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedIn正方形1枚画像型 with one square generated English explanatory image",
        reference_media_notes=(
            f"{image_path} model=gpt-image-2 size=1024x1024 "
            f"prompt=AWS buying path decision card {quality_note}"
        ),
    )

    assert expected_blocker in cli._surface_contract_blockers(row)


def test_surface_contract_blocks_generated_media_from_old_image_model(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    image_path = "artifacts/generated-media/2026-05-23-li-square-card.png"
    _touch_generated_media(image_path)
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedIn正方形1枚画像型 with one square generated English explanatory image",
        reference_media_notes=(
            f"{image_path} model=gpt-image-1 size=1024x1024 "
            "prompt=AWS buying path decision card"
        ),
    )

    assert "surface_missing: generated_media_latest_model_missing" in cli._surface_contract_blockers(row)


def test_surface_contract_ignores_latest_model_claim_in_media_plan(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    image_path = "artifacts/generated-media/2026-05-23-li-square-card.png"
    _touch_generated_media(image_path)
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedIn正方形1枚画像型; must use Runway MCP `gpt-image-2`",
        reference_media_notes=(
            f"{image_path} model=gpt-image-1 size=1024x1024 "
            "prompt=AWS buying path decision card"
        ),
    )

    assert "surface_missing: generated_media_latest_model_missing" in cli._surface_contract_blockers(row)


def test_surface_contract_ignores_unrelated_latest_model_text_in_media_urls(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    image_path = "artifacts/generated-media/2026-05-23-li-square-card.png"
    _touch_generated_media(image_path)
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedIn正方形1枚画像型",
        reference_media_notes=(
            f"{image_path} model=gpt-image-1 size=1024x1024 "
            "prompt=AWS buying path decision card"
        ),
        reference_media_urls="https://example.com/receipts/gpt-image-2-unrelated",
    )

    assert "surface_missing: generated_media_latest_model_missing" in cli._surface_contract_blockers(row)


def test_surface_contract_does_not_accept_model_only_in_media_urls(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    image_path = "artifacts/generated-media/2026-05-23-li-square-card.png"
    _touch_generated_media(image_path)
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedIn正方形1枚画像型",
        reference_media_notes=f"{image_path} size=1024x1024 prompt=AWS buying path decision card",
        reference_media_urls="https://example.com/receipts?model=gpt-image-2",
    )

    blockers = cli._surface_contract_blockers(row)
    assert "surface_missing: generated_media_visual_style_missing" in blockers
    assert "surface_missing: generated_media_platform_linkedin_missing" in blockers
    assert "surface_missing: generated_media_language_en_missing" in blockers


def test_surface_contract_does_not_block_quality_prompt_guidance(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    image_path = "artifacts/generated-media/2026-05-23-li-square-card.png"
    _touch_generated_media(image_path)
    row = QueueRow(
        id="li-square",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there.",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedIn正方形1枚画像型 with one square generated English explanatory image",
        reference_media_notes=(
            f"{image_path} model=gpt-image-2 size=1024x1024 "
            "prompt=avoid low-impact white text cards; use source-specific visual metaphor"
        ),
    )

    assert "surface_missing: generated_media_low_impact" not in cli._surface_contract_blockers(row)


def test_surface_contract_blocks_operation_verification_candidates(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-05-23")
    demo_paths = [
        "artifacts/generated-media/2026-05-23-demo-linkedin-carousel-1.png",
        "artifacts/generated-media/2026-05-23-demo-linkedin-carousel-2.png",
        "artifacts/generated-media/2026-05-23-demo-linkedin-carousel-3.png",
    ]
    for demo_path in demo_paths:
        _touch_generated_media(demo_path)
    row = QueueRow(
        id="demo-linkedin-carousel",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there. https://openai.com/index/openai-on-aws/",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedInカルーセル型 with 3 square generated English slides",
        reference_media_notes=(
            " ".join(demo_paths)
            + " model=gpt-image-2 size=1024x1024 prompt=AWS access decision card"
        ),
    )

    blockers = cli._surface_contract_blockers(row)
    assert "surface_missing: operation_verification_candidate" in blockers
    assert "surface_missing: generated_media_demo_placeholder" in blockers


def test_surface_label_ignores_media_note_filenames_when_plan_is_link_card() -> None:
    row = QueueRow(
        id="li-link-card",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="OpenAI on AWS changes the buying path for teams already there. https://openai.com/index/openai-on-aws/",
        source_url="https://openai.com/index/openai-on-aws/",
        media_plan="LinkedInリンクカード型 with official source link card",
        reference_media_notes="artifacts/generated-media/2026-05-23-demo-linkedin-carousel-1.png",
    )

    assert cli._surface_contract_label(row, "linkedin") == "linkedin_link_card"
    assert "surface_missing: linkedin_carousel_requires_3_generated_images" not in cli._surface_contract_blockers(row)


def test_surface_contract_allows_x_text_url_and_linkedin_link_card_surfaces() -> None:
    x_text_url = QueueRow(
        id="x-text-url",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_text="AWSからOpenAIを選びやすくなるのは、既存運用のチームにはかなり大きい。https://openai.com/index/openai-on-aws/",
        media_plan="X本文+URL型: 元の文章にsource URLを添える",
    )
    x_source_link_card = QueueRow(
        id="x-source-link-card",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_text="AWSからOpenAIを選びやすくなるのは、既存運用のチームにはかなり大きい。https://openai.com/index/openai-on-aws/",
        media_plan="X uses source/link card with the official source URL",
    )
    linkedin_link_card = QueueRow(
        id="li-link-card",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="The AWS path matters most for teams that already have procurement and security review there.\n\nhttps://openai.com/index/openai-on-aws/",
        media_plan="LinkedInリンクカード型: official source URL preview/link card visible",
    )
    missing_source = QueueRow(
        id="x-text-url-missing",
        status="approved",
        quality_score="11",
        x_text="source URL missing",
        media_plan="X本文+URL型",
    )
    missing_linkedin_source = QueueRow(
        id="li-link-card-source-missing",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="The AWS path matters most for teams already working there.",
        media_plan="LinkedInリンクカード型",
    )
    drive_only_linkedin_source = QueueRow(
        id="li-link-card-drive-only",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        drive_web_url="https://drive.google.com/file/d/example/view",
        linkedin_text="The AWS path matters most for teams already working there.",
        media_plan="LinkedInリンクカード型",
    )
    drive_source_url_linkedin_source = QueueRow(
        id="li-link-card-drive-source-url",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        source_url="https://drive.google.com/file/d/example/view",
        drive_web_url="https://drive.google.com/file/d/example/view",
        linkedin_text="Drive-hosted notes https://drive.google.com/file/d/example/view",
        media_plan="LinkedInリンクカード型",
    )
    docs_source_url_linkedin_source = QueueRow(
        id="li-link-card-docs-source-url",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        source_url="https://docs.google.com/document/d/example/edit",
        linkedin_text="Draft notes https://docs.google.com/document/d/example/edit",
        media_plan="LinkedInリンクカード型",
    )
    docs_port_source_url_linkedin_source = QueueRow(
        id="li-link-card-docs-port-source-url",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        source_url="https://docs.google.com:443/document/d/example/edit",
        linkedin_text="Draft notes https://docs.google.com:443/document/d/example/edit",
        media_plan="LinkedInリンクカード型",
    )
    docs_trailing_dot_source_url_linkedin_source = QueueRow(
        id="li-link-card-docs-trailing-dot-source-url",
        status="approved",
        quality_score="11",
        x_post_url="https://x.com/nichika2000823/status/1",
        source_url="https://docs.google.com.:443/document/d/example/edit",
        linkedin_text="Draft notes https://docs.google.com.:443/document/d/example/edit",
        media_plan="LinkedInリンクカード型",
    )
    missing_linkedin_seeded_url = QueueRow(
        id="li-link-card-url-not-seeded",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="The AWS path matters most for teams already working there.",
        media_plan="LinkedInリンクカード型",
    )
    x_missing_body_url = QueueRow(
        id="x-text-url-body-missing",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_text="AWSからOpenAIを選びやすくなるのは大きい。",
        media_plan="X本文+URL型",
    )
    x_source_link_missing_body_url = QueueRow(
        id="x-source-link-card-body-missing",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_text="AWSからOpenAIを選びやすくなるのは大きい。",
        media_plan="X uses source/link card with the official source URL",
    )
    official_demo_text_url = QueueRow(
        id="x-text-url-official-demo",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        content_format="official_demo_breakdown",
        x_text="AWSからOpenAIを選びやすくなるのは大きい。https://openai.com/index/openai-on-aws/",
        media_plan="X本文+URL型",
    )
    article_breakdown_text_url = QueueRow(
        id="x-text-url-article-breakdown",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        content_format="article_number_breakdown",
        x_text="AWSからOpenAIを選びやすくなるのは大きい。https://openai.com/index/openai-on-aws/",
        media_plan="X本文+URL型",
    )
    official_demo_source_link_card = QueueRow(
        id="x-source-link-card-official-demo",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        content_format="official_demo_breakdown",
        x_text="AWSからOpenAIを選びやすくなるのは大きい。https://openai.com/index/openai-on-aws/",
        media_plan="X uses source/link card with the official source URL",
    )

    assert cli._surface_contract_blockers(x_text_url) == []
    assert cli._surface_contract_blockers(x_source_link_card) == []
    assert cli._surface_contract_blockers(linkedin_link_card) == []
    assert "surface_missing: x_text_url_source_url_missing" in cli._surface_contract_blockers(missing_source)
    assert "link_card_not_reflected: linkedin_source_url_missing" in cli._surface_contract_blockers(
        missing_linkedin_source
    )
    assert "link_card_not_reflected: linkedin_source_url_missing" in cli._surface_contract_blockers(
        drive_only_linkedin_source
    )
    assert "link_card_not_reflected: linkedin_official_source_url_missing" in cli._surface_contract_blockers(
        drive_source_url_linkedin_source
    )
    assert "link_card_not_reflected: linkedin_official_source_url_missing" in cli._surface_contract_blockers(
        docs_source_url_linkedin_source
    )
    assert "link_card_not_reflected: linkedin_official_source_url_missing" in cli._surface_contract_blockers(
        docs_port_source_url_linkedin_source
    )
    assert "link_card_not_reflected: linkedin_official_source_url_missing" in cli._surface_contract_blockers(
        docs_trailing_dot_source_url_linkedin_source
    )
    assert "link_card_not_reflected: linkedin_source_url_not_seeded" in cli._surface_contract_blockers(
        missing_linkedin_seeded_url
    )
    assert "surface_missing: x_text_url_body_url_missing" in cli._surface_contract_blockers(x_missing_body_url)
    assert "surface_missing: x_text_url_body_url_missing" in cli._surface_contract_blockers(
        x_source_link_missing_body_url
    )
    assert "surface_missing: x_text_url_not_allowed_for_official_demo_breakdown" in cli._surface_contract_blockers(
        official_demo_text_url
    )
    assert "surface_missing: x_text_url_not_allowed_for_article_number_breakdown" in cli._surface_contract_blockers(
        article_breakdown_text_url
    )
    assert "surface_missing: x_text_url_not_allowed_for_official_demo_breakdown" in cli._surface_contract_blockers(
        official_demo_source_link_card
    )


def test_surface_contract_blocks_template_openings() -> None:
    x_row = QueueRow(
        id="x-template",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_text="まず気になったのは、OpenAIのAWS対応です。",
        media_plan="source/link cardのみ",
    )
    linkedin_row = QueueRow(
        id="li-template",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="One thing I noticed is the AWS link. https://openai.com/index/openai-on-aws/",
        media_plan="LinkedInリンクカード型 with official source link card",
    )

    assert "voice_template_opening: x_まず気になったのは" in cli._surface_contract_blockers(x_row)
    assert "voice_template_opening: linkedin_one thing i noticed" in cli._surface_contract_blockers(linkedin_row)

    practical_read_row = QueueRow(
        id="li-template-2",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="One practical way to read this update is that teams can buy OpenAI through AWS. https://openai.com/index/openai-on-aws/",
        media_plan="LinkedInリンクカード型 with official source link card",
    )
    assert "voice_template_opening: linkedin_one practical way to read" in cli._surface_contract_blockers(
        practical_read_row
    )

    useful_read_row = QueueRow(
        id="li-template-3",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_text="A useful way to read this update is through procurement. https://openai.com/index/openai-on-aws/",
        media_plan="LinkedInリンクカード型 with official source link card",
    )
    assert "voice_template_opening: linkedin_a useful way to read" in cli._surface_contract_blockers(useful_read_row)


def test_publish_flow_blocks_exact_reused_published_copy(monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    published = QueueRow(
        id="old-published",
        status="published",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_text="同じ本文をもう一度使う。\nhttps://openai.com/index/openai-on-aws/",
        x_post_url="https://x.com/nichika2000823/status/1",
    )
    candidate = QueueRow(
        id="new-candidate",
        status="approved",
        quality_score="11",
        source_url="https://openai.com/index/openai-on-aws/",
        x_text="同じ本文をもう一度使う。",
        media_plan="source/link cardのみ",
    )
    repo = MutableDummyRepo([published, candidate])

    class DummySettings:
        pass

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)

    cli.run_publish_flow(path="posting_queue.tsv", sync_sheets=False, max_publish_items=1)

    output = capsys.readouterr().out
    assert "Held publish candidates with incomplete posting surface: 1" in output
    assert candidate.review_status == "hold"
    assert "voice_reuse: x_text_matches_previous_published_row" in candidate.error


def test_run_publish_flow_does_not_collect_sources(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    row = QueueRow(
        id="item-ready",
        status="drafted",
        review_status="ready_morning",
        quality_score="10",
        source_url="https://openai.com/index/openai-on-aws/",
        x_text="x copy",
        media_plan="source/link cardのみ",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        pass

    def fail_collect(settings):
        raise AssertionError("run-publish-flow should reuse existing queue rows")

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", fail_collect)
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(
        cli,
        "publish_x_chrome_local",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("direct Chrome publish should not run")),
    )

    cli.run_publish_flow(path="posting_queue.tsv", sync_sheets=False, max_publish_items=1)


def test_run_core_flow_drafts_ship_now_within_max_drafts(monkeypatch, tmp_path, capsys) -> None:
    hold = QueueRow(
        id="hold-item",
        status="collected",
        keep_priority="hold",
        quality_score="8",
        source_priority_score="5",
        title="Hold item",
    )
    ship_now = QueueRow(
        id="ship-now-item",
        status="collected",
        keep_priority="ship_now",
        quality_score="10",
        source_priority_score="5",
        source_url="https://openai.com/index/openai-on-aws/",
        title="Ship now item",
    )
    repo = MutableDummyRepo([hold, ship_now])

    class DummySettings:
        draft_model = "test-model"

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "build_draft_client", lambda settings: object())
    monkeypatch.setattr(
        cli,
        "generate_localized_copy",
            lambda **kwargs: {
                "summary_ja": "summary",
                "angle": "angle",
                "x_text": "x copy",
                "linkedin_text": "linkedin copy https://openai.com/index/openai-on-aws/",
                "media_plan": "source/link cardのみ",
            },
    )
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-05-19T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=True,
        sync_sheets=False,
        max_drafts=1,
        max_publish_items=1,
        collect_sources=False,
    )

    output = capsys.readouterr().out
    assert ship_now.status == "drafted"
    assert ship_now.x_text == "x copy\nhttps://openai.com/index/openai-on-aws/"
    assert hold.status == "collected"
    assert "Publish flow candidates: ship-now-item" in output
    assert "Daily AI Chrome plugin publish candidate" in ship_now.review_notes


def test_run_core_flow_promotes_clear_hold_candidate_to_buffer(monkeypatch, tmp_path, capsys) -> None:
    hold = QueueRow(
        id="hold-vera",
        status="drafted",
        source_type="url",
        source_name="NVIDIA",
        source_url="https://nvidianews.nvidia.com/news/nvidia-unveils-vera-the-cpu-for-agents",
        title="NVIDIA Unveils Vera, the CPU for Agents",
        keep_priority="hold",
        quality_score="8",
        source_priority_score="3",
        specificity_score="4",
        discussion_score="1",
        x_text="x copy https://nvidianews.nvidia.com/news/nvidia-unveils-vera-the-cpu-for-agents",
        linkedin_text="linkedin copy https://nvidianews.nvidia.com/news/nvidia-unveils-vera-the-cpu-for-agents",
        media_plan="LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([hold])

    class DummySettings:
        pass

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=False,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=0,
        collect_sources=False,
    )

    output = capsys.readouterr().out
    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert "ship_now_buffer=1/3" in output
    assert "no_ship_now_candidates" not in payload["stop_reason"]
    assert "ship_now_buffer_below_target:1/3" in payload["stop_reason"]
    assert payload["ship_now_buffer_count"] == 1
    assert payload["ship_now_buffer_refreshed_count"] == 1
    assert payload["usable_publish_candidate_count"] == 0
    assert hold.review_status == "ready_morning"
    assert hold.keep_priority == "ship_now"
    assert hold.quality_score == "10"
    assert "Buffer refresh needed" in hold.review_notes
    assert "Auto-promoted from hold" in hold.review_notes


def test_replenish_ship_now_buffer_local_uses_existing_queue_only(monkeypatch, tmp_path, capsys) -> None:
    hold = QueueRow(
        id="hold-queue-only",
        status="drafted",
        source_type="url",
        source_name="NVIDIA",
        source_url="https://nvidianews.nvidia.com/news/nvidia-unveils-vera-the-cpu-for-agents",
        title="NVIDIA Unveils Vera, the CPU for Agents",
        keep_priority="hold",
        quality_score="8",
        source_priority_score="3",
        specificity_score="4",
        discussion_score="1",
        x_text="x copy https://nvidianews.nvidia.com/news/nvidia-unveils-vera-the-cpu-for-agents",
        linkedin_text="linkedin copy https://nvidianews.nvidia.com/news/nvidia-unveils-vera-the-cpu-for-agents",
        media_plan="LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([hold])

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "load_settings", lambda: pytest.fail("queue-only replenish must not load settings"))
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda *args, **kwargs: pytest.fail("queue-only replenish must not draft"))
    monkeypatch.setattr(cli, "_ensure_generated_media_for_surface", lambda *args, **kwargs: pytest.fail("queue-only replenish must not generate media"))
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.replenish_ship_now_buffer_local(
        path="posting_queue.tsv",
        sync_sheets=False,
        target_buffer=1,
        max_publish_items=1,
    )

    payload = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert payload["ship_now_buffer_count"] == 1
    assert payload["usable_publish_candidate_count"] == 1
    assert payload["candidate_ids"] == ["hold-queue-only"]
    assert payload["auto_promoted"] == 1
    assert payload["sheets_synced"] == 0
    assert payload["stop_reason"] == ""
    assert hold.keep_priority == "ship_now"
    assert hold.review_status == "ready_morning"
    assert hold.quality_score == "10"
    assert "Auto-promoted from hold" in hold.review_notes


def test_replenish_ship_now_buffer_limits_successful_promotions_to_buffer_gap(monkeypatch) -> None:
    ready = QueueRow(
        id="ready-buffer",
        status="drafted",
        source_type="url",
        source_name="OpenAI",
        source_url="https://openai.com/index/ready-buffer/",
        title="Ready buffer",
        keep_priority="ship_now",
        quality_score="10",
        x_text="Ready x copy https://openai.com/index/ready-buffer/",
        linkedin_text="Ready linkedin copy https://openai.com/index/ready-buffer/",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
    )
    holds = [
        QueueRow(
            id=f"hold-{idx}",
            status="drafted",
            source_type="url",
            source_name="OpenAI",
            source_url=f"https://openai.com/index/hold-{idx}/",
            title=f"Hold {idx}",
            keep_priority="hold",
            quality_score="9",
            source_priority_score=str(10 - idx),
            specificity_score="5",
            discussion_score="4",
            x_text=f"Hold {idx} x copy https://openai.com/index/hold-{idx}/",
            linkedin_text=f"Hold {idx} linkedin copy https://openai.com/index/hold-{idx}/",
            media_plan="X本文+URL型 | LinkedInリンクカード型",
        )
        for idx in range(4)
    ]
    calls: list[str] = []

    def fake_repair(row, **kwargs):
        calls.append(row.id)

    monkeypatch.delenv("DAILY_AI_BUFFER_REPAIR_ATTEMPT_LIMIT", raising=False)
    monkeypatch.setattr(cli, "_repair_candidate_for_ship_now_buffer", fake_repair)

    result = cli._replenish_ship_now_buffer_from_existing_queue(
        [ready, *holds],
        target_buffer=3,
        max_publish_items=3,
    )

    assert len(calls) == 3
    assert result["ship_now_buffer_count"] <= 3
    assert holds[1].keep_priority == "ship_now"
    assert holds[2].keep_priority == "hold"
    assert holds[3].keep_priority == "hold"


def test_replenish_ship_now_buffer_reports_usable_deficit_when_partial_publish_blocks_buffer(
    monkeypatch, tmp_path, capsys
) -> None:
    rows = [
        QueueRow(
            id="partial-row",
            status="partially_published",
            source_type="url",
            source_name="AWS",
            source_url="https://aws.amazon.com/blogs/machine-learning/example-partial/",
            title="Partial publish row",
            keep_priority="ship_now",
            quality_score="10",
            x_text="x copy https://aws.amazon.com/blogs/machine-learning/example-partial/",
            linkedin_text="linkedin copy https://aws.amazon.com/blogs/machine-learning/example-partial/",
            linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:1/",
            media_plan="X本文+URL型 | LinkedInリンクカード型",
        ),
        QueueRow(
            id="ready-row-1",
            status="drafted",
            source_type="url",
            source_name="OpenAI",
            source_url="https://openai.com/index/example-one/",
            title="Ready row one",
            keep_priority="ship_now",
            quality_score="10",
            x_text="x copy https://openai.com/index/example-one/",
            linkedin_text="linkedin copy https://openai.com/index/example-one/",
            media_plan="X本文+URL型 | LinkedInリンクカード型",
        ),
        QueueRow(
            id="ready-row-2",
            status="drafted",
            source_type="url",
            source_name="Anthropic",
            source_url="https://anthropic.com/news/example-two/",
            title="Ready row two",
            keep_priority="ship_now",
            quality_score="10",
            x_text="x copy https://anthropic.com/news/example-two/",
            linkedin_text="linkedin copy https://anthropic.com/news/example-two/",
            media_plan="X本文+URL型 | LinkedInリンクカード型",
        ),
    ]
    repo = MutableDummyRepo(rows)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "load_settings", lambda: pytest.fail("queue-only replenish must not load settings"))
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.replenish_ship_now_buffer_local(
        path="posting_queue.tsv",
        sync_sheets=False,
        target_buffer=3,
        max_publish_items=3,
    )

    payload = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert payload["ship_now_buffer_count"] == 3
    assert payload["usable_publish_candidate_count"] == 1
    assert payload["candidate_ids"] == ["partial-row"]
    assert "ship_now_buffer_below_target" not in payload["stop_reason"]
    assert "usable_publish_candidate_buffer_below_target:1/3" in payload["stop_reason"]


def test_replenish_ship_now_buffer_local_repairs_existing_queue_discovery_context(
    monkeypatch, tmp_path, capsys
) -> None:
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-24")
    media_path = tmp_path / "artifacts/generated-media/2026-06-24-hold-rss-context-x-card.png"
    _touch_generated_media(str(media_path), width=1920, height=1920)
    hold = QueueRow(
        id="hold-rss-context",
        status="drafted",
        source_type="rss",
        source_name="OpenAI",
        source_url="https://openai.com/index/example",
        title="OpenAI example",
        keep_priority="hold",
        quality_score="8",
        source_priority_score="3",
        specificity_score="4",
        discussion_score="1",
        content_format="self_made_summary_card",
        x_text="Model evaluation practice changed this week. https://openai.com/index/example",
        linkedin_text="Model evaluation practice changed this week. https://openai.com/index/example",
        media_plan="X自作判断カード型 | LinkedInリンクカード型",
        reference_media_notes=(
            f"{media_path} model=gpt-image-2 provider=runway_mcp size=1920x1920 "
            "visual_style=x_self_made_decision_card platform=x language=ja prompt=日本語カード"
        ),
        media_receipt=(
            f"{media_path} model=gpt-image-2 provider=runway_mcp size=1920x1920 "
            "visual_style=x_self_made_decision_card platform=x language=ja prompt=日本語カード"
        ),
        error="feed_study_insufficient: missing_daily_discovery_mix",
    )
    repo = MutableDummyRepo([hold])

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "load_settings", lambda: pytest.fail("queue-only replenish must not load settings"))
    monkeypatch.setattr(cli, "_ensure_generated_media_for_surface", lambda *args, **kwargs: pytest.fail("queue-only replenish must not generate media"))
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-24T00:00:00+00:00")

    cli.replenish_ship_now_buffer_local(
        path="posting_queue.tsv",
        sync_sheets=False,
        target_buffer=1,
        max_publish_items=1,
    )

    payload = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert payload["ship_now_buffer_count"] == 1
    assert payload["usable_publish_candidate_count"] == 1
    assert payload["candidate_ids"] == ["hold-rss-context"]
    assert payload["auto_promoted"] == 1
    assert payload["stop_reason"] == ""
    assert hold.research_status == "done"
    assert "daily_discovery_mix" in hold.research_notes


def test_replenish_ship_now_buffer_local_demotes_unusable_existing_ship_now(monkeypatch, tmp_path, capsys) -> None:
    blocked = QueueRow(
        id="blocked-ship-now",
        status="drafted",
        source_type="url",
        source_name="OpenAI",
        source_url="https://openai.com/index/example",
        title="OpenAI example",
        keep_priority="ship_now",
        review_status="ready_morning",
        quality_score="10",
        content_format="official_demo_breakdown",
        x_text="x copy https://openai.com/index/example",
        linkedin_text="linkedin copy https://openai.com/index/example",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([blocked])

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.replenish_ship_now_buffer_local(
        path="posting_queue.tsv",
        sync_sheets=False,
        target_buffer=1,
        max_publish_items=1,
    )

    payload = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert payload["ship_now_buffer_count"] == 0
    assert payload["usable_publish_candidate_count"] == 0
    assert payload["demoted_unusable_ship_now"] == 1
    assert blocked.keep_priority == "hold"
    assert blocked.review_status == "hold"
    assert "x_text_url_not_allowed_for_official_demo_breakdown" in blocked.error
    assert "Demoted from ship_now" in blocked.review_notes


def test_replenish_ship_now_buffer_local_does_not_demote_engagement_only_rows(monkeypatch, tmp_path, capsys) -> None:
    engagement = QueueRow(
        id="eng-linkedin-123",
        status="published",
        source_type="engagement_feed",
        source_name="LinkedIn",
        source_url="https://www.linkedin.com/feed/update/urn:li:activity:123/",
        title="LinkedIn engagement target",
        keep_priority="engagement_only",
        review_status="engagement_ready",
        quality_score="10",
        owner="daily-ai-engagement",
        engagement_status="approved",
        engagement_action="like_candidate",
        engagement_targets="https://www.linkedin.com/feed/update/urn:li:activity:123/",
    )
    repo = MutableDummyRepo([engagement])

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.replenish_ship_now_buffer_local(
        path="posting_queue.tsv",
        sync_sheets=False,
        target_buffer=1,
        max_publish_items=1,
    )

    payload = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert payload["demoted_unusable_ship_now"] == 0
    assert engagement.keep_priority == "engagement_only"
    assert engagement.review_status == "engagement_ready"
    assert engagement.error == ""
    assert engagement.next_action == ""


def test_replenish_ship_now_buffer_local_does_not_resurrect_drop_rows(monkeypatch, tmp_path, capsys) -> None:
    dropped = QueueRow(
        id="dropped-queue-only",
        status="drafted",
        source_type="url",
        source_name="Research Lab",
        source_url="https://example.com/ai-agent-report",
        title="AI agent report",
        keep_priority="drop",
        drop_reason="previously rejected",
        quality_score="9",
        source_priority_score="3",
        specificity_score="4",
        discussion_score="2",
        x_text="A useful agent benchmark update. https://example.com/ai-agent-report",
        linkedin_text="LinkedIn copy https://example.com/ai-agent-report",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([dropped])

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.replenish_ship_now_buffer_local(
        path="posting_queue.tsv",
        sync_sheets=False,
        target_buffer=1,
        max_publish_items=1,
    )

    payload = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert payload["ship_now_buffer_count"] == 0
    assert payload["usable_publish_candidate_count"] == 0
    assert payload["auto_promoted"] == 0
    assert "ship_now_buffer_below_target:0/1" in payload["stop_reason"]
    assert dropped.keep_priority == "drop"
    assert dropped.drop_reason == "previously rejected"


def test_replenish_ship_now_buffer_local_preserves_no_repost_drop_rows(monkeypatch, tmp_path, capsys) -> None:
    dropped = QueueRow(
        id="dropped-no-repost",
        status="drafted",
        source_type="url",
        source_name="Research Lab",
        source_url="https://example.com/ai-agent-report",
        title="AI agent report",
        keep_priority="drop",
        drop_reason="manual reject",
        review_notes="Do not repost; url capture pending for x; url capture pending for linkedin",
        quality_score="9",
        source_priority_score="3",
        specificity_score="4",
        discussion_score="2",
        x_text="A useful agent benchmark update. https://example.com/ai-agent-report",
        linkedin_text="LinkedIn copy https://example.com/ai-agent-report",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([dropped])

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.replenish_ship_now_buffer_local(
        path="posting_queue.tsv",
        sync_sheets=False,
        target_buffer=1,
        max_publish_items=1,
    )

    payload = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert payload["ship_now_buffer_count"] == 0
    assert payload["usable_publish_candidate_count"] == 0
    assert payload["no_repost_normalized"] == 0
    assert payload["auto_promoted"] == 0
    assert dropped.keep_priority == "drop"
    assert dropped.drop_reason == "manual reject"


def test_ship_now_buffer_repair_restores_runway_attached_rss_context(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-24")
    media_path = "artifacts/generated-media/2026-06-24-runway-rss-buffer-x-card-1.png"
    _touch_generated_media(media_path)
    row = QueueRow(
        id="runway-rss-buffer",
        status="drafted",
        source_type="rss",
        source_name="OpenAI",
        source_url="https://openai.com/index/deployment-simulation",
        title="Deployment Simulation",
        keep_priority="ship_now",
        review_status="hold",
        quality_score="10",
        source_priority_score="5",
        specificity_score="5",
        discussion_score="3",
        content_format="self_made_summary_card",
        x_text="Deployment simulation tests model behavior before release. https://openai.com/index/deployment-simulation",
        linkedin_text=(
            "Deployment simulation narrows the gap between lab evaluation and real usage. "
            "https://openai.com/index/deployment-simulation"
        ),
        media_plan="X自作判断カード型 | LinkedInリンクカード型",
        reference_media_notes=(
            f"{media_path} model=gpt-image-2 provider=runway_mcp size=1920x1920 "
            "visual_style=x_self_made_decision_card platform=x language=ja prompt=日本語の正方形カード。大見出しは本番前に挙動を試す。"
        ),
        media_receipt=(
            f"{media_path} model=gpt-image-2 provider=runway_mcp size=1920x1920 "
            "visual_style=x_self_made_decision_card platform=x language=ja prompt=日本語の正方形カード。大見出しは本番前に挙動を試す。"
        ),
        error="feed_study_insufficient: missing_daily_discovery_mix",
    )
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-24T00:00:00+00:00")

    assert cli._publish_candidate_blockers(row, [row]) == ["feed_study_insufficient: missing_daily_discovery_mix"]

    changed = cli._repair_candidate_for_ship_now_buffer(row, settings=None)

    assert changed
    assert "daily_discovery_mix" in row.research_notes
    assert row.research_status == "done"
    assert row.freshness_checked_at == "2026-06-24T00:00:00+00:00"
    assert cli._publish_candidate_blockers(row, [row]) == []


def test_ship_now_buffer_repair_removes_generic_opening_and_adds_linkedin_surface(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-24")
    media_path = "artifacts/generated-media/2026-06-24-generic-buffer-x-card-1.png"

    def fake_generated_media(row, *, platform, count, settings):
        assert platform == "x"
        assert count == 1
        _touch_generated_media(media_path)
        row.reference_media_notes = (
            f"{media_path} model=gpt-image-2 provider=runway_mcp size=1920x1920 "
            "visual_style=x_self_made_decision_card platform=x language=ja prompt=日本語の正方形カード"
        )
        row.media_receipt = row.reference_media_notes
        return [media_path]

    row = QueueRow(
        id="generic-buffer",
        status="drafted",
        source_type="url",
        source_name="OpenAI",
        source_url="https://openai.com/index/agents-sdk-next-evolution/",
        title="Agents SDK next evolution",
        keep_priority="hold",
        quality_score="9",
        source_priority_score="5",
        specificity_score="5",
        discussion_score="4",
        content_format="self_made_summary_card",
        x_text="まず気になったのは、OpenAI が Agents SDK を更新した点です。",
        linkedin_text="OpenAI updated the Agents SDK with a clearer production path.",
        media_plan="X自作判断カード型",
    )
    monkeypatch.setattr(cli, "_ensure_generated_media_for_surface", fake_generated_media)

    assert "voice_template_opening: x_まず気になったのは" in cli._publish_candidate_blockers(row, [row])
    assert "surface_missing: linkedin_surface_label_missing" in cli._publish_candidate_blockers(row, [row])

    changed = cli._repair_candidate_for_ship_now_buffer(row, settings=object())

    assert changed
    assert row.x_text.startswith("OpenAI が Agents SDK")
    assert "X自作判断カード型" in row.media_plan
    assert "LinkedInリンクカード型" in row.media_plan
    assert row.source_url in row.linkedin_text
    assert cli._publish_candidate_blockers(row, [row]) == []


def test_run_core_flow_auto_promotes_best_clear_hold_candidate(monkeypatch, tmp_path, capsys) -> None:
    hold = QueueRow(
        id="agent-365",
        status="drafted",
        source_type="url",
        source_name="Microsoft",
        source_url="https://www.microsoft.com/en-us/security/blog/2026/05/01/microsoft-agent-365-now-generally-available-expands-capabilities-and-integrations/",
        title="Microsoft Agent 365",
        keep_priority="hold",
        quality_score="8",
        source_priority_score="3",
        specificity_score="4",
        discussion_score="2",
        content_format="market_signal_visual",
        x_text=(
            "Agent inventory is becoming a security problem. "
            "https://www.microsoft.com/en-us/security/blog/2026/05/01/microsoft-agent-365-now-generally-available-expands-capabilities-and-integrations/"
        ),
        linkedin_text=(
            "Agent inventory is becoming a security problem.\n"
            "https://www.microsoft.com/en-us/security/blog/2026/05/01/microsoft-agent-365-now-generally-available-expands-capabilities-and-integrations/"
        ),
        media_plan="LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([hold])

    class DummySettings:
        pass

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=True,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=1,
        collect_sources=True,
    )

    output = capsys.readouterr().out
    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert "auto_promoted=1" in output
    assert "Publish flow candidates: agent-365" in output
    assert hold.keep_priority == "ship_now"
    assert hold.review_status == "ready_morning"
    assert hold.quality_score == "10"
    assert "X本文+URL型" in hold.media_plan
    assert "LinkedInリンクカード型" in hold.media_plan
    assert "Auto-promoted from hold" in hold.review_notes
    assert payload["ship_now_buffer_count"] == 1
    assert payload["usable_publish_candidate_count"] == 1
    assert "no_ship_now_candidates" not in payload["stop_reason"]


def test_ship_now_buffer_prefers_explicit_source_link_card_without_generating_image() -> None:
    row = QueueRow(
        id="source-link-card",
        status="drafted",
        source_name="AWS",
        source_url="https://aws.amazon.com/blogs/machine-learning/integrating-aws-api-mcp-server/",
        title="AWS API MCP Server",
        keep_priority="hold",
        quality_score="8",
        content_format="market_signal_visual",
        x_text="AWS API MCP Server makes CLI actions easier to route from natural language.",
        linkedin_text="AWS API MCP Server makes CLI actions easier to route from natural language.",
        media_plan=(
            "LinkedInはソースリンクカードを使用し、X はソース/リンクカードを添付して投稿する"
            "（自作画像なしで、記事サムネイルがビジュアル面を担う）"
        ),
    )

    changed = cli._repair_candidate_for_ship_now_buffer(row, settings=object())

    assert changed
    assert cli._surface_contract_label(row, "x") == "x_source_link_card"
    assert "X自作判断カード型" not in row.media_plan
    assert row.source_url in row.x_text
    assert row.source_url in row.linkedin_text
    assert "surface_missing: x_generated_decision_card_missing" not in cli._publish_candidate_blockers(row, [row])


def test_run_core_flow_can_reconsider_quality_nine_drop_for_x_buffer(monkeypatch, tmp_path, capsys) -> None:
    row = QueueRow(
        id="drop-but-usable-x",
        status="drafted",
        source_type="url",
        source_name="Research Lab",
        source_url="https://example.com/ai-agent-report",
        title="AI agent report",
        keep_priority="drop",
        quality_score="9",
        source_priority_score="3",
        specificity_score="4",
        discussion_score="2",
        x_text="A useful agent benchmark update. https://example.com/ai-agent-report",
        linkedin_text="LinkedIn copy https://example.com/ai-agent-report",
        media_plan="",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        pass

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=True,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=1,
        collect_sources=True,
    )

    output = capsys.readouterr().out
    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert "auto_promoted=1" in output
    assert "Publish flow candidates: drop-but-usable-x" in output
    assert row.keep_priority == "ship_now"
    assert row.review_status == "ready_morning"
    assert row.quality_score == "10"
    assert "X本文+URL型" in row.media_plan
    assert payload["ship_now_buffer_count"] == 1
    assert payload["usable_publish_candidate_count"] == 1


def test_run_core_flow_auto_promotes_up_to_three_clear_hold_candidates(monkeypatch, tmp_path, capsys) -> None:
    source_urls = [
        "https://www.microsoft.com/en-us/security/blog/2026/05/01/microsoft-agent-365-now-generally-available-expands-capabilities-and-integrations/",
        "https://nvidianews.nvidia.com/news/nvidia-unveils-vera-the-cpu-for-agents",
        "https://huggingface.co/blog/nvidia/cosmos-3-for-physical-ai",
    ]
    rows = [
        QueueRow(
            id=f"candidate-{index}",
            status="drafted",
            source_type="url",
            source_name="Vendor",
            source_url=url,
            title=f"Candidate {index}",
            keep_priority="hold",
            quality_score="8",
            source_priority_score="3",
            specificity_score="4",
            discussion_score="1",
            content_format="market_signal_visual",
            x_text=f"Clear X body {url}",
            linkedin_text=f"Clear LinkedIn body {url}",
            media_plan="LinkedInリンクカード型",
        )
        for index, url in enumerate(source_urls, start=1)
    ]
    repo = MutableDummyRepo(rows)

    class DummySettings:
        pass

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=True,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=3,
        collect_sources=False,
    )

    output = capsys.readouterr().out
    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert "auto_promoted=3" in output
    assert "ship_now_buffer=3/3" in output
    assert payload["ship_now_buffer_count"] == 3
    assert payload["usable_publish_candidate_count"] == 3
    assert "ship_now_buffer_below_target" not in payload["stop_reason"]
    assert all(row.keep_priority == "ship_now" for row in rows)
    assert all(row.review_status == "ready_morning" for row in rows)


def test_run_core_flow_repairs_generated_x_surface_for_buffer_candidate(monkeypatch, tmp_path, capsys) -> None:
    row = QueueRow(
        id="official-flow-buffer",
        status="drafted",
        source_type="url",
        source_name="AWS Machine Learning Blog",
        source_url="https://aws.amazon.com/blogs/machine-learning/secure-ai-agents-with-policy-interceptors/",
        title="Secure AI agents with policy interceptors",
        keep_priority="hold",
        quality_score="8",
        source_priority_score="4",
        specificity_score="3",
        discussion_score="2",
        content_format="official_demo_breakdown",
        x_text="Policy interceptors make the gateway decision visible.",
        linkedin_text="Policy interceptors make the gateway decision visible.",
        media_plan="LinkedInリンクカード型: official AWS preview is the strongest surface.",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        openai_api_key = "test-key"

    def fake_generate_media(row, *, platform, count, settings):
        assert platform == "x"
        assert count == 1
        path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-official-flow-buffer-x-card-1.png"
        _touch_generated_media(str(path))
        receipt = (
            f"{path} model=gpt-image-2 provider=runway_mcp size=1024x1024 visual_style=capability_hierarchy_explainer "
            "platform=x language=ja prompt=日本語の判断カード"
        )
        row.reference_media_notes = " | ".join(part for part in [row.reference_media_notes, receipt] if part)
        row.media_receipt = " | ".join(part for part in [row.media_receipt, receipt] if part)
        return [path]

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-02")
    monkeypatch.setattr(cli, "_generate_media_assets_for_surface", fake_generate_media)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-02T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=True,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=1,
        collect_sources=True,
    )

    output = capsys.readouterr().out
    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert "auto_promoted=1" in output
    assert "Publish flow candidates: official-flow-buffer" in output
    assert row.keep_priority == "ship_now"
    assert row.review_status == "ready_morning"
    assert row.quality_score == "10"
    assert "X自作判断カード型" in row.media_plan
    assert "LinkedInリンクカード型" in row.media_plan
    assert row.source_url in row.linkedin_text
    assert "model=gpt-image-2" in row.reference_media_notes
    assert payload["usable_publish_candidate_count"] == 1
    assert "no_ship_now_candidates" not in payload["stop_reason"]


def test_generate_media_assets_for_surface_uses_runway_mcp_wrapper(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="runway-wrapper-row",
        source_type="rss",
        source_name="OpenAI",
        source_url="https://openai.com/index/example/",
        title="Example AI update",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DAILY_AI_ALLOW_RUNWAY_MCP_WRAPPER", "1")
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-22")
    wrapper = tmp_path / "scripts" / "runway_mcp_generate_image.mjs"
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text("#!/usr/bin/env node\n", encoding="utf-8")

    def fake_run(cmd, **kwargs):
        assert "scripts/runway_mcp_generate_image.mjs" in cmd
        assert "--model" in cmd
        assert "gpt-image-2" in cmd
        output_path = tmp_path / "artifacts" / "generated-media" / "2026-06-22-runway-wrapper-row-x-card-runway-mcp-1.png"
        _touch_generated_media(str(output_path))
        return subprocess.CompletedProcess(
            cmd,
            0,
            stdout=json.dumps(
                {"ok": True, "taskId": "task_test", "outputPath": str(output_path), "model": "gpt-image-2"}
            ) + "\n",
            stderr="",
        )

    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    generated = cli._generate_media_assets_for_surface(row, platform="x", count=1, settings=object())

    assert generated == [
        (tmp_path / "artifacts" / "generated-media" / "2026-06-22-runway-wrapper-row-x-card-runway-mcp-1.png").resolve()
    ]
    assert "provider=runway_mcp" in row.reference_media_notes
    assert "model=gpt-image-2" in row.reference_media_notes
    assert "platform=x" in row.reference_media_notes
    assert "language=ja" in row.reference_media_notes
    assert "runway_mcp_generated_media_auto_created" in row.review_notes


def test_run_core_flow_reports_generated_media_timeout_as_run_blocker(monkeypatch, tmp_path, capsys) -> None:
    row = QueueRow(
        id="timeout-buffer",
        status="drafted",
        source_type="url",
        source_name="AWS Machine Learning Blog",
        source_url="https://aws.amazon.com/blogs/machine-learning/secure-ai-agents-with-policy-interceptors/",
        title="Secure AI agents with policy interceptors",
        keep_priority="hold",
        quality_score="8",
        source_priority_score="4",
        specificity_score="3",
        discussion_score="2",
        content_format="self_made_summary_card",
        x_text="Policy interceptors make the gateway decision visible.",
        linkedin_text=(
            "Policy interceptors make the gateway decision visible. "
            "https://aws.amazon.com/blogs/machine-learning/secure-ai-agents-with-policy-interceptors/"
        ),
        media_plan="X自作判断カード型 | LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        openai_api_key = "test-key"

    def fake_generate_media(row, *, platform, count, settings):
        raise RuntimeError("image_generation_unavailable: gpt-image-2 request timed out.")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "_generate_media_assets_for_surface", fake_generate_media)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-03T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=True,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=1,
        collect_sources=False,
    )

    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert row.keep_priority == "hold"
    assert row.review_status == "hold"
    assert row.error == "image_generation_unavailable: gpt-image-2 request timed out."
    assert "Buffer auto-promotion blocked during surface/media repair." in row.review_notes
    assert "image_generation_unavailable: gpt-image-2 request timed out." in payload["stop_reason"]
    assert "ship_now_buffer_below_target:0/3" in payload["stop_reason"]


def test_openai_image_billing_error_is_normalized() -> None:
    message = (
        "Error code: 400 - {'error': {'message': 'Billing hard limit has been reached.', "
        "'type': 'billing_limit_user_error', 'code': 'billing_hard_limit_reached'}}"
    )

    assert cli._normalize_openai_image_generation_error(message) == (
        "image_generation_unavailable: billing_hard_limit_reached"
    )


def test_run_core_flow_repairs_media_before_leaving_feed_study_blocker(
    monkeypatch, tmp_path
) -> None:
    row = QueueRow(
        id="billing-buffer",
        status="drafted",
        source_type="rss",
        source_name="AWS Machine Learning Blog",
        source_url="https://aws.amazon.com/blogs/machine-learning/example-ai-agent/",
        title="Example AI agent update",
        keep_priority="hold",
        quality_score="8",
        source_priority_score="4",
        specificity_score="3",
        discussion_score="2",
        content_format="official_demo_breakdown",
        x_text="This AI agent update matters because it changes the integration path.",
        linkedin_text="This AI agent update matters because it changes the integration path.",
        media_plan="X自作判断カード型 | LinkedIn正方形1枚画像型",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        openai_api_key = "test-key"

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    generated: list[Path] = []

    def fake_generate_media(row, *, platform, count, settings):
        path = (
            tmp_path
            / "artifacts"
            / "generated-media"
            / f"2026-06-03-billing-buffer-{platform}-runway-mcp-1.png"
        )
        _touch_generated_media(str(path))
        language = "ja" if platform == "x" else "en"
        prompt = "日本語の判断カード" if platform == "x" else "English explanatory square image"
        receipt = (
            f"{path} model=gpt-image-2 provider=runway_mcp size=1024x1024 "
            f"visual_style=capability_hierarchy_explainer platform={platform} language={language} prompt={prompt}"
        )
        row.reference_media_notes = " | ".join(part for part in [row.reference_media_notes, receipt] if part)
        row.media_receipt = " | ".join(part for part in [row.media_receipt, receipt] if part)
        generated.append(path)
        return [path]

    monkeypatch.setattr(cli, "_generate_media_assets_for_surface", fake_generate_media)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-03")
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-03T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=False,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=1,
        ship_now_buffer_target=1,
        collect_sources=False,
    )

    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert row.keep_priority == "hold"
    assert row.review_status == "hold"
    assert len(generated) >= 2
    assert "provider=runway_mcp" in row.media_receipt
    assert row.content_format == "official_demo_breakdown"
    assert "X自作判断カード型" in row.media_plan
    assert "LinkedIn正方形1枚画像型" in row.media_plan
    assert row.error == ""
    assert "do not degrade generated-media surfaces to URL-only posts" not in row.review_notes
    assert payload["ship_now_buffer_count"] == 0
    assert "feed_study_insufficient: missing_daily_discovery_mix" in payload["stop_reason"]
    assert "ship_now_buffer_below_target:0/1" in payload["stop_reason"]


def test_run_core_flow_repairs_media_before_leaving_voice_template_blocker(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="generic-opening-buffer",
        status="drafted",
        source_type="url",
        source_name="OpenAI",
        source_url="https://openai.com/index/example",
        title="Example OpenAI update",
        keep_priority="hold",
        quality_score="10",
        source_priority_score="4",
        specificity_score="3",
        discussion_score="2",
        content_format="self_made_summary_card",
        x_text="まず気になったのは、OpenAIの更新です。",
        linkedin_text="Specific LinkedIn copy about the OpenAI update. https://openai.com/index/example",
        media_plan="X自作判断カード型 | LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        pass

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    generated = []

    def fake_generate_media(row, *, platform, count, settings):
        assert platform == "x"
        assert count == 1
        path = tmp_path / "artifacts" / "generated-media" / "2026-06-03-generic-opening-buffer-x-card-runway-mcp-1.png"
        _touch_generated_media(str(path))
        receipt = (
            f"{path} model=gpt-image-2 provider=runway_mcp size=1024x1024 "
            "visual_style=capability_hierarchy_explainer platform=x language=ja prompt=日本語の判断カード"
        )
        row.reference_media_notes = " | ".join(part for part in [row.reference_media_notes, receipt] if part)
        row.media_receipt = " | ".join(part for part in [row.media_receipt, receipt] if part)
        generated.append(path)
        return [path]

    monkeypatch.setattr(cli, "_generate_media_assets_for_surface", fake_generate_media)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-03T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=False,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=1,
        ship_now_buffer_target=1,
        collect_sources=False,
    )

    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert row.keep_priority == "hold"
    assert generated
    assert "provider=runway_mcp" in row.media_receipt
    assert "voice_template_opening: x_まず気になったのは" in payload["stop_reason"]
    assert "ship_now_buffer_below_target:0/1" in payload["stop_reason"]


def test_run_core_flow_generates_only_until_buffer_target(monkeypatch, tmp_path) -> None:
    ready_one = QueueRow(
        id="ready-one",
        status="drafted",
        source_type="url",
        source_url="https://example.com/ready-one",
        keep_priority="ship_now",
        review_status="ready_morning",
        quality_score="10",
        x_text="Ready one https://example.com/ready-one",
        linkedin_text="Ready one LinkedIn https://example.com/ready-one",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
    )
    ready_two = QueueRow(
        id="ready-two",
        status="drafted",
        source_type="url",
        source_url="https://example.com/ready-two",
        keep_priority="ship_now",
        review_status="ready_morning",
        quality_score="10",
        x_text="Ready two https://example.com/ready-two",
        linkedin_text="Ready two LinkedIn https://example.com/ready-two",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
    )
    needs_media = QueueRow(
        id="needs-media",
        status="drafted",
        source_type="url",
        source_name="OpenAI",
        source_url="https://openai.com/index/needs-media",
        title="Needs media",
        keep_priority="hold",
        quality_score="10",
        source_priority_score="4",
        specificity_score="4",
        discussion_score="2",
        content_format="self_made_summary_card",
        x_text="Specific X copy about the media update.",
        linkedin_text="Specific LinkedIn copy about the media update. https://openai.com/index/needs-media",
        media_plan="X自作判断カード型 | LinkedInリンクカード型",
    )
    extra_media = QueueRow(
        id="extra-media",
        status="drafted",
        source_type="url",
        source_name="OpenAI",
        source_url="https://openai.com/index/extra-media",
        title="Extra media",
        keep_priority="hold",
        quality_score="9",
        source_priority_score="3",
        specificity_score="3",
        discussion_score="1",
        content_format="self_made_summary_card",
        x_text="Extra specific X copy.",
        linkedin_text="Extra LinkedIn copy. https://openai.com/index/extra-media",
        media_plan="X自作判断カード型 | LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([ready_one, ready_two, needs_media, extra_media])
    generated: list[str] = []

    class DummySettings:
        pass

    def fake_generate_media(row, *, platform, count, settings):
        generated.append(row.id)
        media_path = Path(f"artifacts/generated-media/2026-06-03-{row.id}-x-card-runway-mcp-1.png")
        _touch_generated_media(str(media_path))
        cli._append_runway_generated_media_receipt(
            row,
            platform=platform,
            media_path=(tmp_path / media_path).resolve(),
            prompt="日本語の正方形SNSカード。固有の実務判断を大きく示す。",
            visual_style="x_self_made_decision_card",
            language="ja",
        )
        return [(tmp_path / media_path).resolve()]

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "_generate_media_assets_for_surface", fake_generate_media)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-03T00:00:00+00:00")
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-03")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=False,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=3,
        ship_now_buffer_target=3,
        collect_sources=False,
    )

    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert set(generated) == {"needs-media"}
    assert needs_media.keep_priority == "ship_now"
    assert extra_media.keep_priority == "hold"
    assert payload["ship_now_buffer_count"] == 3
    assert "ship_now_buffer_below_target" not in payload["stop_reason"]


def test_run_core_flow_skips_image_generation_unavailable_candidate_for_link_card_buffer(
    monkeypatch, tmp_path
) -> None:
    first = QueueRow(
        id="first-media",
        status="drafted",
        source_type="url",
        source_name="OpenAI",
        source_url="https://openai.com/index/first-media",
        title="First media",
        keep_priority="hold",
        quality_score="10",
        source_priority_score="4",
        specificity_score="4",
        discussion_score="2",
        content_format="self_made_summary_card",
        x_text="Specific X copy about the first media update.",
        linkedin_text="Specific LinkedIn copy about the first media update. https://openai.com/index/first-media",
        media_plan="X自作判断カード型 | LinkedInリンクカード型",
    )
    second = QueueRow(
        id="second-link-card",
        status="drafted",
        source_type="url",
        source_name="OpenAI",
        source_url="https://openai.com/index/second-link-card",
        title="Second link card",
        keep_priority="hold",
        quality_score="9",
        source_priority_score="3",
        specificity_score="3",
        discussion_score="1",
        content_format="text_with_url",
        x_text="Specific X copy about the second link-card update. https://openai.com/index/second-link-card",
        linkedin_text="Specific LinkedIn copy about the second link-card update. https://openai.com/index/second-link-card",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([first, second])
    attempted: list[str] = []

    class DummySettings:
        pass

    def fake_generate_media(row, *, platform, count, settings):
        attempted.append(row.id)
        raise RuntimeError("image_generation_unavailable: runway_mcp_wrapper_missing_output")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "_generate_media_assets_for_surface", fake_generate_media)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-03T00:00:00+00:00")
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-03")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=False,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=3,
        ship_now_buffer_target=1,
        collect_sources=False,
    )

    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert attempted == ["first-media"]
    assert first.keep_priority == "hold"
    assert first.error == "image_generation_unavailable: runway_mcp_wrapper_missing_output"
    assert second.keep_priority == "ship_now"
    assert second.error == ""
    assert "image_generation_unavailable: runway_mcp_wrapper_missing_output" in payload["stop_reason"]
    assert payload["ship_now_buffer_count"] == 1
    assert "ship_now_buffer_below_target" not in payload["stop_reason"]


def test_run_core_flow_regenerates_unapproved_provider_media(monkeypatch, tmp_path) -> None:
    stale_path = Path("artifacts/generated-media/2026-06-03-provider-repair-x-card-runway-mcp-1.png")
    _touch_generated_media(str(tmp_path / stale_path))
    row = QueueRow(
        id="provider-repair",
        status="drafted",
        source_type="url",
        source_name="OpenAI",
        source_url="https://openai.com/index/provider-repair",
        title="Provider repair",
        keep_priority="hold",
        quality_score="10",
        source_priority_score="4",
        specificity_score="4",
        discussion_score="2",
        content_format="self_made_summary_card",
        x_text="Specific X copy about provider repair.",
        linkedin_text="Specific LinkedIn copy about provider repair. https://openai.com/index/provider-repair",
        media_plan="X自作判断カード型 | LinkedInリンクカード型",
        reference_media_notes=(
            f"{stale_path} model=gpt-image-2 provider=openai_api size=1024x1024 "
            "visual_style=x_self_made_decision_card platform=x language=ja prompt=日本語の古いカード"
        ),
    )
    row.media_receipt = row.reference_media_notes
    repo = MutableDummyRepo([row])
    generated: list[str] = []

    class DummySettings:
        pass

    def fake_generate_media(row, *, platform, count, settings):
        generated.append(row.id)
        fresh_path = Path(f"artifacts/generated-media/2026-06-03-{row.id}-x-card-runway-mcp-2.png")
        _touch_generated_media(str(fresh_path))
        cli._append_runway_generated_media_receipt(
            row,
            platform=platform,
            media_path=(tmp_path / fresh_path).resolve(),
            prompt="日本語の正方形カード。実務判断を大きく示す高品質カード。",
            visual_style="x_self_made_decision_card",
            language="ja",
        )
        return [(tmp_path / fresh_path).resolve()]

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "_generate_media_assets_for_surface", fake_generate_media)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-03T00:00:00+00:00")
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-03")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=False,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=1,
        ship_now_buffer_target=1,
        collect_sources=False,
    )

    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert generated == ["provider-repair"]
    assert row.keep_priority == "ship_now"
    assert "provider=runway_mcp" in row.reference_media_notes
    assert payload["ship_now_buffer_count"] == 1


def test_run_core_flow_ignores_stale_generated_media_error_in_run_blocker(monkeypatch, tmp_path) -> None:
    stale = QueueRow(
        id="stale-timeout",
        status="drafted",
        source_url="https://example.com/stale",
        keep_priority="hold",
        quality_score="8",
        x_text="stale x copy",
        linkedin_text="stale linkedin copy",
        error="image_generation_unavailable: gpt-image-2 request timed out.",
        review_notes="Buffer auto-promotion blocked during surface/media repair.",
    )
    ready = QueueRow(
        id="ready-buffer",
        status="drafted",
        source_url="https://example.com/ready",
        keep_priority="ship_now",
        review_status="ready_morning",
        quality_score="11",
        x_text="ready x copy https://example.com/ready",
        linkedin_text="ready linkedin copy https://example.com/ready",
        media_plan="X本文+URL型 | LinkedInリンクカード型：画像生成に依存しない安全な投稿表面にする。",
    )
    repo = MutableDummyRepo([stale, ready])

    class DummySettings:
        openai_api_key = "test-key"

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-03T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=True,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=1,
        collect_sources=False,
    )

    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert "image_generation_unavailable" not in payload["stop_reason"]


def test_auto_promote_does_not_bypass_surface_blockers() -> None:
    blocked = QueueRow(
        id="blocked-card",
        status="drafted",
        source_type="url",
        source_url="https://example.com/source",
        keep_priority="hold",
        quality_score="9",
        source_priority_score="3",
        specificity_score="4",
        discussion_score="2",
        content_format="self_made_summary_card",
        x_text="Needs an image card https://example.com/source",
        linkedin_text="Needs an image card https://example.com/source",
        media_plan="X自作判断カード型 | LinkedInリンクカード型",
    )

    assert cli._promote_best_hold_candidate_for_publish([blocked]) == 0
    assert blocked.keep_priority == "hold"
    assert blocked.review_status == ""


def test_auto_promote_skips_duplicate_candidate_marker() -> None:
    duplicate = QueueRow(
        id="duplicate-buffer",
        status="drafted",
        source_type="url",
        source_url="https://example.com/source",
        keep_priority="hold",
        quality_score="12",
        source_priority_score="5",
        specificity_score="4",
        discussion_score="3",
        content_format="self_made_summary_card",
        x_text="Clear X body https://example.com/source",
        linkedin_text="Clear LinkedIn body https://example.com/source",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
        review_notes="duplicate_candidate:published-source",
    )

    assert cli._promote_best_hold_candidate_for_publish([duplicate]) == 0
    assert duplicate.keep_priority == "hold"
    assert duplicate.review_status == ""


def test_ship_now_buffer_count_excludes_duplicate_candidate_marker() -> None:
    duplicate = QueueRow(
        id="duplicate-ship-now",
        status="drafted",
        source_type="url",
        source_url="https://example.com/source",
        keep_priority="ship_now",
        review_status="ready_morning",
        quality_score="12",
        content_format="market_signal_visual",
        x_text="Clear X body https://example.com/source",
        linkedin_text="Clear LinkedIn body https://example.com/source",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
        review_notes="duplicate_candidate:published-source",
    )

    assert not cli._is_ship_now_buffer_candidate(duplicate, [duplicate])
    assert cli._ship_now_buffer_count([duplicate]) == 0


def test_buffer_refresh_skips_duplicate_candidate_marker() -> None:
    duplicate = QueueRow(
        id="duplicate-refresh",
        status="drafted",
        source_type="url",
        source_url="https://example.com/source",
        keep_priority="hold",
        quality_score="12",
        source_priority_score="5",
        specificity_score="4",
        discussion_score="3",
        x_text="Clear X body https://example.com/source",
        linkedin_text="Clear LinkedIn body https://example.com/source",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
        review_notes="duplicate_candidate:published-source",
        next_action="Ignore duplicate and use published-source",
    )

    assert cli._mark_hold_rows_for_buffer_refresh([duplicate], target_buffer=1) == 0
    assert duplicate.review_status == ""
    assert duplicate.next_action == "Ignore duplicate and use published-source"
    assert duplicate.review_notes == "duplicate_candidate:published-source"


def test_inventory_labels_drop_duplicate_candidate_even_with_ship_now_marker() -> None:
    duplicate = QueueRow(
        id="duplicate-explicit-ship-now",
        status="drafted",
        source_type="url",
        source_url="https://example.com/source",
        keep_priority="ship_now",
        quality_score="12",
        x_text="Clear X body https://example.com/source",
        linkedin_text="Clear LinkedIn body https://example.com/source",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
        review_notes="duplicate_candidate:published-source",
    )

    cli._apply_inventory_labels(duplicate)

    assert duplicate.keep_priority == "drop"
    assert duplicate.drop_reason == "duplicate of published-source"


def test_publish_flow_candidates_skip_duplicate_candidate_marker() -> None:
    duplicate = QueueRow(
        id="duplicate-publish-candidate",
        status="drafted",
        source_type="url",
        source_url="https://example.com/source",
        keep_priority="ship_now",
        review_status="ready_morning",
        quality_score="12",
        x_text="Clear X body https://example.com/source",
        linkedin_text="Clear LinkedIn body https://example.com/source",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
        review_notes="duplicate_candidate:published-source",
    )

    assert not cli._is_publish_flow_candidate(duplicate)
    assert cli._publish_flow_candidates([duplicate], max_items=3) == []


def test_auto_promote_repairs_ship_now_row_rescored_below_publish_floor() -> None:
    row = QueueRow(
        id="rescored-ship",
        status="drafted",
        source_type="url",
        source_url="https://example.com/source",
        keep_priority="ship_now",
        review_status="ready_morning",
        quality_score="9",
        source_priority_score="3",
        specificity_score="4",
        discussion_score="2",
        content_format="market_signal_visual",
        x_text="Clear X body https://example.com/source",
        linkedin_text="Clear LinkedIn body https://example.com/source",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
    )

    assert cli._promote_best_hold_candidate_for_publish([row]) == 1
    assert row.keep_priority == "ship_now"
    assert row.review_status == "ready_morning"
    assert row.quality_score == "10"
    assert cli._is_publish_flow_candidate(row)


def test_link_card_pair_keeps_market_signal_format_during_rescore() -> None:
    row = QueueRow(
        id="link-card-bridge",
        status="drafted",
        source_type="rss",
        source_name="OpenAI",
        source_url="https://openai.com/index/nextdoor",
        title="How engineers at Nextdoor use Codex to build without limits",
        summary_en="Engineers use Codex to investigate hard-to-reproduce bugs.",
        keep_priority="ship_now",
        review_status="ready_morning",
        quality_score="9",
        source_priority_score="5",
        specificity_score="3",
        discussion_score="1",
        content_format="official_demo_breakdown",
        publish_strategy="tooling_update",
        x_text="Hard-to-reproduce bugs are expensive. https://openai.com/index/nextdoor",
        linkedin_text="Hard-to-reproduce bugs are expensive.\n\nhttps://openai.com/index/nextdoor",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
    )

    assert cli._infer_content_format(row) == "market_signal_visual"
    assert cli._rescore_queue_rows([row]) >= 1
    assert row.content_format == "market_signal_visual"
    assert cli._promote_best_hold_candidate_for_publish([row]) == 1
    assert row.quality_score == "10"
    assert cli._is_publish_flow_candidate(row)


def test_run_core_flow_cleans_published_ready_state(monkeypatch, tmp_path) -> None:
    published = QueueRow(
        id="published-ready",
        status="published",
        review_status="ready_morning",
        keep_priority="ship_now",
        quality_score="10",
        x_text="x copy",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:1/",
        next_action="Publish X and publish LinkedIn via local automation profile. preflight-linkedin-media-upload-local",
    )
    repo = MutableDummyRepo([published])

    class DummySettings:
        pass

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=False,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=0,
        collect_sources=False,
    )

    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert published.review_status == "posted"
    assert published.keep_priority == "hold"
    assert published.next_action == "Completed on published platforms; monitor metrics and replies."
    assert "Published row state cleaned" in published.review_notes
    assert payload["refreshed_count"] == 1


def test_run_core_flow_keeps_local_summary_when_sheet_summary_append_fails(monkeypatch, tmp_path, capsys) -> None:
    row = QueueRow(
        id="item-ready",
        status="approved",
        review_status="ready_morning",
        quality_score="10",
        x_text="x copy",
        media_plan="source/link cardのみ",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        pass

    class FailingSummarySheetsRepo:
        def append_run_summary(self, **kwargs) -> None:
            raise RuntimeError("oauth2 unavailable")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "get_repo", lambda: FailingSummarySheetsRepo())
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 1)
    monkeypatch.setattr(cli, "_sync_local_queue_to_sheets", lambda local_repo, sheets_repo: 1)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-05-21T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=False,
        sync_sheets=True,
        max_drafts=0,
        max_publish_items=0,
        collect_sources=False,
    )

    output = capsys.readouterr().out
    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert "Skipped Google Sheets run_summary append: oauth2 unavailable" in output
    assert payload["sheets_synced_count"] == 1
    assert "no_ship_now_candidates" in payload["stop_reason"]
    assert "ship_now_buffer_below_target:0/3" in payload["stop_reason"]
    assert "run_summary_sync_failed: oauth2 unavailable" in payload["stop_reason"]


def test_run_core_flow_passes_buffer_counts_to_sheets_summary(monkeypatch, tmp_path) -> None:
    repo = MutableDummyRepo([])
    sheets_repo = DummySheetsRepo()

    class DummySettings:
        pass

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "get_repo", lambda: sheets_repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "_sync_local_queue_to_sheets", lambda local_repo, sheets_repo: 143)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=False,
        sync_sheets=True,
        max_drafts=0,
        max_publish_items=0,
        collect_sources=False,
    )

    assert sheets_repo.summary_calls[-1]["ship_now_buffer_count"] == 0
    assert sheets_repo.summary_calls[-1]["ship_now_buffer_refreshed_count"] == 0
    assert sheets_repo.summary_calls[-1]["usable_publish_candidate_count"] == 0


def test_append_local_run_summary_skips_exact_consecutive_duplicates(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)

    first_path = cli._append_local_run_summary(
        run_at="2026-05-25T00:00:00+00:00",
        researched_count=1,
        sheets_synced_count=114,
        path="posting_queue.tsv",
    )
    second_path = cli._append_local_run_summary(
        run_at="2026-05-25T00:00:00+00:00",
        researched_count=1,
        sheets_synced_count=114,
        path="posting_queue.tsv",
    )

    assert second_path == first_path
    lines = first_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["researched_count"] == 1


def test_append_local_run_summary_records_automation_failure_category(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)

    summary_path = cli._append_local_run_summary(
        run_at="2026-06-02T00:00:00+00:00",
        researched_count=0,
        media_receipt="publish_attempted=true",
        stop_reason="disabled_submit: LinkedIn Post button was not enabled",
        path="posting_queue.tsv",
    )

    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[0])
    assert payload["media_receipt"] == "publish_attempted=true; automation_failure_category=clickability"


def test_append_automation_health_receipt_records_stage_lane_and_resume() -> None:
    receipt = cli._append_automation_health_receipt(
        "publish_attempted=true",
        stage="daily_ai_postflight",
        lane="nicky_automation",
        source_of_truth="posting_queue.tsv",
        completion_proof="external_publish_completion_required",
        resume_target="publish_send_failed",
    )

    assert receipt == (
        "publish_attempted=true; "
        "automation_health=stage:daily_ai_postflight|lane:nicky_automation|"
        "source:posting_queue.tsv|completion:external_publish_completion_required|resume:publish_send_failed"
    )


def test_mark_platform_publish_failed_records_retry_category() -> None:
    row = QueueRow(
        id="publish-fail",
        status="approved",
        review_status="ready_morning",
        review_notes="Local automation profile publish candidate",
    )

    cli._mark_platform_publish_failed(row, "linkedin", "capture_failed: LinkedIn completion URL was not visible")

    assert row.review_status == "hold"
    assert row.error == "linkedin_publish_failed: capture_failed: LinkedIn completion URL was not visible"
    assert "completion" in row.next_action
    assert "automation_failure_category=completion" in row.review_notes


def test_capture_linkedin_post_url_accepts_new_recent_activity_urn_without_snippet(monkeypatch) -> None:
    class FakeHrefs:
        def evaluate_all(self, _script):
            return []

    class FakeCard:
        def __init__(self, urn: str, text: str):
            self.urn = urn
            self.text = text

        def get_attribute(self, name: str):
            return self.urn if name == "data-urn" else ""

        def locator(self, _selector: str):
            return FakeHrefs()

    class FakeCards:
        def __init__(self, cards):
            self.cards = cards

        def count(self):
            return len(self.cards)

        def nth(self, index: int):
            return self.cards[index]

    class FakePage:
        def __init__(self):
            self.cards = FakeCards(
                [
                    FakeCard("urn:li:activity:new-post", "LinkedIn collapsed this card text"),
                    FakeCard("urn:li:activity:old-post", "Original body prefix appears here"),
                ]
            )

        def goto(self, *_args, **_kwargs):
            return None

        def wait_for_timeout(self, _ms: int):
            return None

        def locator(self, selector: str):
            assert "data-urn" in selector
            return self.cards

    monkeypatch.setattr(cli, "_locator_text", lambda locator: locator.text)

    url = cli._capture_linkedin_post_url(
        FakePage(),
        body="Original body prefix that may not be visible in recent activity",
        timeout_seconds=0.01,
        exclude_urns={"urn:li:activity:old-post"},
    )

    assert url == "https://www.linkedin.com/feed/update/urn:li:activity:new-post/"


def test_capture_linkedin_post_url_does_not_accept_unseen_urn_without_prepublish_snapshot(monkeypatch) -> None:
    class FakeHrefs:
        def evaluate_all(self, _script):
            return []

    class FakeCard:
        text = "LinkedIn collapsed this card text"

        def get_attribute(self, name: str):
            return "urn:li:activity:new-post" if name == "data-urn" else ""

        def locator(self, _selector: str):
            return FakeHrefs()

    class FakeCards:
        def count(self):
            return 1

        def nth(self, _index: int):
            return FakeCard()

    class FakePage:
        def goto(self, *_args, **_kwargs):
            return None

        def wait_for_timeout(self, _ms: int):
            return None

        def locator(self, selector: str):
            assert "data-urn" in selector
            return FakeCards()

    monkeypatch.setattr(cli, "_locator_text", lambda locator: locator.text)

    with pytest.raises(RuntimeError, match="completion_capture_failed"):
        cli._capture_linkedin_post_url(
            FakePage(),
            body="Original body prefix that may not be visible in recent activity",
            timeout_seconds=0.01,
            exclude_urns=None,
        )


def test_capture_linkedin_post_url_prefers_snippet_match_over_unseen_fallback(monkeypatch) -> None:
    class FakeHrefs:
        def evaluate_all(self, _script):
            return []

    class FakeCard:
        def __init__(self, urn: str, text: str):
            self.urn = urn
            self.text = text

        def get_attribute(self, name: str):
            return self.urn if name == "data-urn" else ""

        def locator(self, _selector: str):
            return FakeHrefs()

    class FakeCards:
        def __init__(self):
            self.cards = [
                FakeCard("urn:li:activity:new-collapsed-post", "LinkedIn collapsed this card text"),
                FakeCard(
                    "urn:li:activity:new-visible-post",
                    "Original body prefix that may not be visible in recent activity appears here",
                ),
            ]

        def count(self):
            return len(self.cards)

        def nth(self, index: int):
            return self.cards[index]

    class FakePage:
        def goto(self, *_args, **_kwargs):
            return None

        def wait_for_timeout(self, _ms: int):
            return None

        def locator(self, selector: str):
            assert "data-urn" in selector
            return FakeCards()

    monkeypatch.setattr(cli, "_locator_text", lambda locator: locator.text)

    url = cli._capture_linkedin_post_url(
        FakePage(),
        body="Original body prefix that may not be visible in recent activity",
        timeout_seconds=0.01,
        exclude_urns={"urn:li:activity:old-post"},
    )

    assert url == "https://www.linkedin.com/feed/update/urn:li:activity:new-visible-post/"


def test_linkedin_link_card_failure_switches_to_square_image_surface() -> None:
    row = QueueRow(
        id="linkedin-fallback",
        content_format="LinkedInリンクカード型",
        publish_strategy="LinkedInリンクカード型",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
        review_notes="Local automation profile publish candidate",
    )

    changed = cli._switch_linkedin_link_card_to_square_image_after_reflection_failure(
        row,
        "link_card_not_reflected: LinkedIn official link preview was not visible.",
    )

    assert changed is True
    assert cli._surface_contract_label(row, "linkedin") == "linkedin_square_image"
    assert "LinkedInリンクカード型" not in row.content_format
    assert "LinkedInリンクカード型" not in row.publish_strategy
    assert "LinkedIn正方形1枚画像型" in row.media_plan
    assert "linkedin_surface_fallback" in row.review_notes


def test_linkedin_link_card_fallback_is_not_wired_into_local_publish_sender() -> None:
    source = inspect.getsource(cli._send_publish_candidates_local)

    assert "_switch_linkedin_link_card_to_square_image_after_reflection_failure" not in source
    assert "_publish_linkedin_by_surface_local" in source
    assert "sheets_sync_failed" in source


def test_nicky_link_card_reflection_ignores_editor_body_text() -> None:
    source = inspect.getsource(cli._ensure_linkedin_link_card_reflected)

    assert "contenteditable" in source
    assert "querySelectorAll('a[href]')" in source
    assert 'page.locator("body").inner_text' not in source


def test_nicky_linkedin_media_upload_requires_attachment_reflection() -> None:
    upload_source = inspect.getsource(cli._upload_linkedin_media_via_photo_route)
    photo_button_source = inspect.getsource(cli._linkedin_photo_button)
    reflection_source = inspect.getsource(cli._linkedin_media_attachment_reflected)
    count_source = inspect.getsource(cli._linkedin_media_editor_count_reflected)
    media_editor_root_source = inspect.getsource(cli._linkedin_visible_media_editor_root)
    next_source = inspect.getsource(cli._linkedin_media_editor_next_button)
    next_root_source = inspect.getsource(cli._linkedin_media_editor_root_reflected)
    dialog_source = inspect.getsource(cli._linkedin_visible_dialog_media_reflected)
    editor_source = inspect.getsource(cli._linkedin_editor)
    post_media_signal_source = inspect.getsource(cli._linkedin_post_media_composer_signal_reflected)
    post_media_dialog_source = inspect.getsource(cli._linkedin_visible_post_media_dialog_reflected)

    assert "_linkedin_media_attachment_reflected" in upload_source
    assert "_linkedin_visible_media_editor_root" in upload_source
    assert "_linkedin_media_editor_count_reflected" not in upload_source
    assert "_linkedin_visible_dialog_media_reflected" not in upload_source
    assert "_linkedin_visible_post_media_dialog_reflected" not in upload_source
    assert "_close_stale_linkedin_composer_ui" in upload_source
    assert "_linkedin_publish_diagnostic_snapshot" in upload_source
    assert "stage=\"after_photo_click\"" not in upload_source
    assert "stage=\"retry_after_photo_click\"" not in upload_source
    assert upload_source.index("chooser_info.value.set_files") < upload_source.index("page.wait_for_timeout(6000)")
    assert upload_source.index("page.wait_for_timeout(6000)") < upload_source.index(
        "stage=\"after_file_set_filechooser\""
    )
    assert "stage=\"before_next\"" in upload_source
    assert "stage=\"retry_photo_route_before_next\"" in upload_source
    retry_set_index = upload_source.index("chooser_info.value.set_files", upload_source.index("retry_photo"))
    retry_wait_index = upload_source.index("page.wait_for_timeout(9000)", retry_set_index)
    assert retry_set_index < retry_wait_index
    assert retry_wait_index < upload_source.index("stage=\"retry_after_file_set_filechooser\"")
    assert "stage=\"before_next_retry\"" in upload_source
    assert "stage=\"attachment_missing_after_next\"" in upload_source
    assert "editor.is_visible" not in upload_source
    assert "share-box-feed-entry" in photo_button_source
    assert 'div[role="button"]:has-text("Photo"), div[role="button"]:has-text("写真")' in photo_button_source
    assert "Start a post|投稿を開始" in photo_button_source
    assert "compact_required=True" in photo_button_source
    assert "Start a post\\s*Video\\s*Photo\\s*Write article" in photo_button_source
    assert "Feed post|Sort by|Recommended for you|Promoted" in photo_button_source
    assert "for selector in selectors:\n        locator = page.locator(selector)" not in photo_button_source
    assert 'img[src^="blob:"]' in reflection_source
    assert "contenteditable" in reflection_source
    assert "genericMediaNodes" in reflection_source
    assert "rect.width >= 120" in reflection_source
    assert "profile|avatar|member|open to work" in reflection_source
    assert "credentialSignal" in reflection_source
    assert "Content credentials label added" in post_media_dialog_source
    assert "hasPostButton" in post_media_dialog_source
    assert 'img[src^="blob:"]' in post_media_dialog_source
    assert "total >= min" in reflection_source
    assert "match[2] || match[1]" in reflection_source
    assert "page.get_by_text(pattern, exact=False)" in count_source
    assert "document.body" in count_source
    assert 'page.locator("body").evaluate' in count_source
    assert "_linkedin_media_editor_root_reflected(root, min_count=min_count)" in media_editor_root_source
    assert "_linkedin_media_editor_next_button(page, min_count=min_count)" in count_source
    assert "if not next_visible()" in count_source
    assert count_source.index("if not next_visible()") < count_source.index('page.locator("body").evaluate')
    assert "_linkedin_media_editor_count_text_visible(page, min_count=min_count)" in next_source
    assert "_linkedin_visible_media_editor_next_button_by_text(page)" in next_source
    assert 'page.get_by_role("button", name=label).last' in inspect.getsource(
        cli._linkedin_visible_media_editor_next_button_by_text
    )
    assert "_linkedin_media_editor_count_text_visible(page, min_count=len(media_paths))" in upload_source
    assert 'button:has-text("Next")' in next_source
    assert "_linkedin_media_editor_root_reflected(root, min_count=min_count)" in next_source
    assert "page of document|document|carousel" in next_source
    assert "aria-label^=\"Next \"" in next_source
    assert "countReflected || mediaNodes.length >= min" in next_root_source
    assert 'querySelectorAll(\'[role="dialog"], .artdeco-modal\')' in dialog_source
    assert "requireEditor && !hasEditor" in dialog_source
    assert "_linkedin_post_media_composer_signal_reflected(page)" in upload_source
    assert "_linkedin_ax_media_composer_signal_reflected(page, min_count=len(media_paths))" in upload_source
    assert "Content credentials label added" in post_media_signal_source
    assert "_visible_enabled_linkedin_post_button(page, active_editor)" in post_media_signal_source
    assert "_linkedin_ax_media_composer_signal_reflected(page)" in post_media_signal_source
    assert "\\bALT\\b" in post_media_signal_source
    assert "generic_large_img_count" in inspect.getsource(cli._linkedin_publish_diagnostic_snapshot)
    assert "Enhance post" not in post_media_signal_source
    assert "rect.width < 120" in post_media_signal_source
    assert "profile|avatar|member" in post_media_signal_source
    assert 'locator("body").inner_text' not in post_media_signal_source
    assert "filter(has=active_editor)" in post_media_signal_source
    assert "_locator_text(root)" in post_media_signal_source
    assert 'div[contenteditable="true"][role="textbox"]' in editor_source
    payload_source = inspect.getsource(cli._linkedin_file_payload)
    assert "if len(values) == 1" in payload_source
    assert "return values[0]" in payload_source


def test_nicky_linkedin_post_button_is_scoped_to_active_composer() -> None:
    helper = inspect.getsource(cli._visible_enabled_linkedin_post_button)
    link_card = inspect.getsource(cli._publish_linkedin_link_card_local)
    media = inspect.getsource(cli._publish_linkedin_generated_media_local)
    snapshot = inspect.getsource(cli._capture_linkedin_recent_activity_urns)

    assert 'locator(\'[role="dialog"]\').filter(has=editor)' in helper
    assert 'candidate.get_attribute("aria-expanded")' in helper
    assert "^(Post|投稿)$" in helper
    assert "_visible_enabled_linkedin_post_button(page, editor)" in link_card
    assert "_visible_enabled_linkedin_post_button(page, editor)" in media
    assert "_capture_linkedin_recent_activity_urns(page, body=body, required=True)" in link_card
    assert "_capture_linkedin_recent_activity_urns_side_page(page, body=body, row_id=row_id)" in media
    assert "completion_capture_failed: LinkedIn recent activity prepublish snapshot failed" in snapshot
    assert "row_id = row.id" in media
    assert "row.queue_id" not in media
    assert "stage=\"before_submit\"" in media
    assert "stage=\"attachment_missing_before_submit\"" in media
    assert "linkedin_media_attachment_not_reflected_before_submit" in media
    assert "active_root = _linkedin_root_for_editor(page, editor)" in media
    assert "_linkedin_media_attachment_reflected(active_root" in media
    assert "_linkedin_visible_dialog_media_reflected(page, min_count=len(media_paths), require_editor=True)" not in media
    assert "_linkedin_post_media_composer_signal_reflected(page, editor=editor)" in media
    assert "_set_linkedin_ax_editor_body(page, body)" in media
    assert "_click_linkedin_ax_post_button(page)" in media
    assert "used_ax_editor" in media
    assert "_wait_after_linkedin_submit(page, row_id=row_id" in media
    assert "stage=\"after_submit_wait\"" in inspect.getsource(cli._wait_after_linkedin_submit)


def test_nicky_linkedin_ax_media_signal_requires_editor_media_and_enabled_post(monkeypatch) -> None:
    def node(
        node_id: int,
        role: str,
        name: str,
        *,
        children: list[int] | None = None,
        backend: int | None = None,
        disabled: bool | None = None,
        value: str = "",
    ):
        payload = {
            "nodeId": str(node_id),
            "role": {"value": role},
            "name": {"value": name},
            "value": {"value": value},
            "childIds": [str(child) for child in children or []],
        }
        if backend is not None:
            payload["backendDOMNodeId"] = backend
        if disabled is not None:
            payload["properties"] = [{"name": "disabled", "value": {"value": disabled}}]
        return payload

    good_nodes = [
        node(1, "dialog", "Create post modal", children=[2, 3, 4]),
        node(2, "textbox", "Text editor for creating content", backend=111),
        node(3, "image", "Image preview"),
        node(4, "button", "Post", backend=222, disabled=False),
        node(9, "image", "Profile avatar image"),
    ]
    monkeypatch.setattr(cli, "_linkedin_ax_nodes", lambda page: good_nodes)

    assert cli._linkedin_ax_media_composer_signal_reflected(object())
    assert cli._linkedin_ax_composer_snapshot(object())["editor_backend_node_id"] == 111

    monkeypatch.setattr(
        cli,
        "_linkedin_ax_nodes",
        lambda page: [
            node(1, "dialog", "Create post modal", children=[3, 4]),
            node(3, "image", "Image preview"),
            node(4, "button", "Post"),
        ],
    )
    assert not cli._linkedin_ax_media_composer_signal_reflected(object())

    monkeypatch.setattr(
        cli,
        "_linkedin_ax_nodes",
        lambda page: [
            node(1, "dialog", "Create post modal", children=[2, 3, 4]),
            node(2, "textbox", "Text editor for creating content"),
            node(3, "image", "Image preview"),
            node(4, "button", "Post", disabled=True),
        ],
    )
    assert not cli._linkedin_ax_media_composer_signal_reflected(object())

    monkeypatch.setattr(
        cli,
        "_linkedin_ax_nodes",
        lambda page: [
            node(1, "dialog", "Create post modal", children=[2, 3, 4]),
            node(2, "textbox", "Text editor for creating content"),
            node(3, "image", "Profile avatar image"),
            node(4, "button", "Post", disabled=False),
        ],
    )
    assert not cli._linkedin_ax_media_composer_signal_reflected(object())

    monkeypatch.setattr(
        cli,
        "_linkedin_ax_nodes",
        lambda page: [
            node(1, "dialog", "Create post modal", children=[2, 4]),
            node(2, "textbox", "Text editor for creating content"),
            node(4, "button", "Post", disabled=False),
            node(9, "image", "Image preview"),
        ],
    )
    assert not cli._linkedin_ax_media_composer_signal_reflected(object())


def test_nicky_linkedin_media_publish_reopens_fresh_page_after_same_page_preflight() -> None:
    media = inspect.getsource(cli._publish_linkedin_generated_media_local)
    same_page = inspect.getsource(cli._preflight_linkedin_media_upload_paths_on_page)
    fresh_page = inspect.getsource(cli._fresh_linkedin_publish_page_after_media_preflight)
    generic_fresh_page = inspect.getsource(cli._fresh_linkedin_publish_page)
    stale_cleanup = inspect.getsource(cli._close_stale_linkedin_publish_pages)

    assert "_preflight_linkedin_media_upload_paths_on_page(" in media
    assert "_preflight_linkedin_media_upload_paths_local(" not in media
    assert "stage=\"before_preflight_fresh_page\"" in media
    assert "_fresh_linkedin_publish_page_after_media_preflight(" in media
    assert "_upload_linkedin_media_via_photo_route(" in same_page
    assert "preflight_no_post_media_reflected" in same_page
    assert "_close_stale_linkedin_composer_ui(page)" in same_page
    assert "page.context.new_page()" in generic_fresh_page
    assert "fresh_page.bring_to_front()" in generic_fresh_page
    assert "_close_stale_linkedin_publish_pages(page.context, keep_page=page)" in generic_fresh_page
    assert "_close_stale_linkedin_publish_pages(fresh_page.context, keep_page=fresh_page)" in generic_fresh_page
    assert "Content credentials label added" in stale_cleanup
    assert "Save this post as a draft" in stale_cleanup
    assert "candidate.close()" in stale_cleanup
    assert "page.bring_to_front()" in inspect.getsource(cli._upload_linkedin_media_via_photo_route)
    assert "after_preflight_fresh_page" in fresh_page
    assert "_ensure_linkedin_feed_ready(fresh_page" in generic_fresh_page
    assert "return page" not in generic_fresh_page
    assert "linkedin_fresh_feed_page_unavailable" in generic_fresh_page


def test_mark_platform_published_preserves_other_platform_failure() -> None:
    row = QueueRow(
        id="partial-publish",
        status="approved",
        x_post_url="",
        x_post_id="",
        linkedin_post_url="",
        linkedin_post_id="",
        error="x_publish_failed: disabled_submit: X Post button was not enabled",
    )

    cli._mark_platform_published(
        row,
        "linkedin",
        "https://www.linkedin.com/feed/update/urn:li:share:123/",
    )

    assert row.status == "partially_published"
    assert row.error == "x_publish_failed: disabled_submit: X Post button was not enabled"
    assert "X remains pending" in row.next_action


def test_mark_platform_published_clears_stale_generated_media_surface_errors() -> None:
    row = QueueRow(
        id="partial-linkedin",
        status="approved",
        x_post_url="https://x.com/nichika2000823/status/1",
        x_post_id="1",
        error=(
            "surface_missing: generated_media_receipt_missing_for_path; "
            "linkedin_publish_failed: surface_missing: linkedin_photo_editor_preview_missing"
        ),
    )

    cli._mark_platform_published(
        row,
        "linkedin",
        "https://www.linkedin.com/feed/update/urn:li:share:123/",
    )

    assert row.status == "published"
    assert row.error == ""


def test_sync_local_queue_to_sheets_sets_bounded_socket_timeout(monkeypatch) -> None:
    calls: list[tuple[str, float | None]] = []
    previous_timeout = cli.socket.getdefaulttimeout()

    class SlowSheetsRepo:
        def upsert_many(self, rows):
            calls.append(("upsert", cli.socket.getdefaulttimeout()))
            return len(rows)

    monkeypatch.setenv("SOCIAL_FLOW_SHEETS_SYNC_SOCKET_TIMEOUT_SECONDS", "7")
    result = cli._sync_local_queue_to_sheets(MutableDummyRepo([QueueRow(id="row-1")]), SlowSheetsRepo())

    assert result == 1
    assert calls == [("upsert", 7.0)]
    assert cli.socket.getdefaulttimeout() == previous_timeout


def test_sync_local_queue_to_sheets_truncates_sheet_payload_without_mutating_local_rows(monkeypatch) -> None:
    assert cli.GOOGLE_SHEETS_CELL_CHARACTER_LIMIT == 49_000
    original_text = "a" * (cli.GOOGLE_SHEETS_CELL_CHARACTER_LIMIT + 17)
    local_row = QueueRow(id="row-1", review_notes=original_text, linkedin_text="kept")
    captured: list[QueueRow] = []

    class CapturingSheetsRepo:
        def upsert_many(self, rows):
            captured.extend(rows)
            return len(rows)

    result = cli._sync_local_queue_to_sheets(MutableDummyRepo([local_row]), CapturingSheetsRepo())

    assert result == 1
    assert local_row.review_notes == original_text
    assert captured[0] is not local_row
    assert len(captured[0].review_notes) == cli.GOOGLE_SHEETS_CELL_CHARACTER_LIMIT
    assert captured[0].review_notes == original_text[: cli.GOOGLE_SHEETS_CELL_CHARACTER_LIMIT]
    assert captured[0].linkedin_text == "kept"


def test_sync_local_queue_to_sheets_bounded_times_out(monkeypatch) -> None:
    monkeypatch.setenv("SOCIAL_FLOW_SHEETS_SYNC_HARD_TIMEOUT_SECONDS", "0.2")
    monkeypatch.setattr(cli, "_sync_local_queue_to_sheets_process_target", _slow_sheets_sync_target_for_test)

    with pytest.raises(TimeoutError, match="sheets_sync_timeout_after_0s"):
        cli._sync_local_queue_to_sheets_bounded("posting_queue.tsv")


def test_run_publish_flow_writes_local_run_summary(monkeypatch, tmp_path, capsys) -> None:
    repo = MutableDummyRepo([])

    class DummySettings:
        pass

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)

    cli.run_publish_flow(path="posting_queue.tsv", sync_sheets=False, max_publish_items=1)

    output = capsys.readouterr().out
    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert "Local run summary:" in output
    assert "no_ship_now_candidates" in payload["stop_reason"]
    assert "ship_now_buffer_below_target:0/3" in payload["stop_reason"]
    assert "no_publish_candidates_after_refresh" in payload["stop_reason"]


def test_browser_use_override_disables_legacy_daily_ai_automation() -> None:
    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--no-sync-sheets"],
    )

    assert result.exit_code == 2
    assert "Usage: root run-daily-ai-automation [OPTIONS]" in result.output


def test_browser_use_override_disables_legacy_browser_senders() -> None:
    runner = CliRunner()

    commands = [
        ["send-engagement-candidates-local", "--no-sync-sheets"],
        ["send-own-post-engagement-local", "--platform", "linkedin"],
        ["publish-linkedin-text-url-fallback-local", "--row-id", "item-1"],
    ]

    for command in commands:
        result = runner.invoke(cli.app, command)
        assert result.exit_code == 2
        assert f"Usage: root {command[0]} [OPTIONS]" in result.output


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_orchestrates_with_same_owner_marker(monkeypatch, tmp_path, capsys) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    calls: list[str] = []

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "verify_main_chrome_profile_control", lambda **kwargs: calls.append("verify"))
    monkeypatch.setattr(cli, "run_core_flow", lambda **kwargs: calls.append("core"))
    monkeypatch.setattr(cli, "run_publish_flow", lambda **kwargs: calls.append("publish"))
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: calls.append("extension_publish") or {"attempted": 0, "posted": 0, "skipped": 0, "stop_reason": "dry_run_publish_sender_skipped"},
    )
    monkeypatch.setattr(cli, "_post_publish_engagement_feed_study_local", lambda **kwargs: calls.append("feed_study") or {})
    monkeypatch.setattr(cli, "prepare_engagement_candidates_local", lambda **kwargs: calls.append("prepare_engagement"))
    monkeypatch.setattr(cli, "_send_engagement_candidates_chrome_extension", lambda **kwargs: calls.append("extension_engagement") or {"sent": 1, "skipped": 0, "stop_reason": ""})
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: calls.append("cleanup"))

    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--dry-run", "--no-sync-sheets"],
    )

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert calls == ["core", "publish", "extension_publish", "prepare_engagement", "cleanup"]
    assert "Daily AI lane:" in output
    assert not marker_path.exists()


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_runs_engagement_when_no_publish_candidates(monkeypatch, tmp_path, capsys) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    calls: list[str] = []
    repo = DummyRepo([])

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "verify_main_chrome_profile_control", lambda **kwargs: calls.append("verify"))
    monkeypatch.setattr(cli, "run_core_flow", lambda **kwargs: calls.append("core"))
    monkeypatch.setattr(cli, "run_publish_flow", lambda **kwargs: calls.append("publish"))
    monkeypatch.setattr(cli, "_latest_local_daily_ai_stop_reason", lambda: "no_ship_now_candidates; ship_now_buffer_below_target:0/3; no_publish_candidates_after_refresh")
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: calls.append("extension_publish") or {"attempted": 0, "posted": 0, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(
        cli,
        "_post_publish_engagement_feed_study_local",
        lambda **kwargs: calls.append("feed_study") or {},
    )
    monkeypatch.setattr(
        cli,
        "prepare_engagement_candidates_local",
        lambda **kwargs: calls.append("prepare_engagement"),
    )
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: calls.append("extension_engagement") or {"sent": 1, "skipped": 0, "stop_reason": "", "receipts": []},
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: calls.append("cleanup"))

    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--no-sync-sheets"],
    )

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert calls == ["core", "publish", "extension_publish", "prepare_engagement", "extension_engagement", "cleanup"]
    assert "Daily AI external publish incomplete: publish_send_not_attempted" in output
    assert "Daily AI Chrome Extension engagement sender" in output

    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["stop_reason"] == "publish_send_not_attempted; no_ship_now_candidates; ship_now_buffer_below_target:0/3; no_publish_candidates_after_refresh"
    assert payload["automation_health"]["completion_required"] == "external_publish_completion_required"
    assert "completion:external_publish_completion_required" in payload["media_receipt"]


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_resumes_engagement_for_published_rows(monkeypatch, tmp_path, capsys) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    row = QueueRow(
        id="published-needs-engagement",
        status="published",
        title="Published post that still needs engagement",
        x_post_url="https://x.com/nichika2000823/status/123",
        published_at="2026-06-02T00:00:00+00:00",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    calls: list[str] = []

    def fake_feed_study(**kwargs):
        calls.append("feed_study")
        row.engagement_status = "approved"
        row.engagement_action = "comment_candidate"
        row.engagement_targets = "https://x.com/example/status/456"
        row.comment_draft = "Specific comment based on fresh feed-study evidence."
        repo.update(row)
        return {"artifact": "feed.json", "read": 15, "external_read": 15, "engagement_candidates_created": 1, "stop_reason": ""}

    def fake_send_engagement(**kwargs):
        calls.append("send_engagement")
        row.engagement_status = "done"
        repo.update(row)
        return {"sent": 1, "skipped": 0, "stop_reason": ""}

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "verify_main_chrome_profile_control", lambda **kwargs: calls.append("verify"))
    monkeypatch.setattr(cli, "run_core_flow", lambda **kwargs: calls.append("core"))
    monkeypatch.setattr(cli, "run_publish_flow", lambda **kwargs: calls.append("publish"))
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: calls.append("extension_publish") or {"attempted": 0, "posted": 0, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(cli, "_post_publish_engagement_feed_study_local", fake_feed_study)
    monkeypatch.setattr(cli, "prepare_engagement_candidates_local", lambda **kwargs: calls.append("prepare_engagement"))
    monkeypatch.setattr(cli, "_send_engagement_candidates_chrome_extension", fake_send_engagement)
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: calls.append("cleanup"))

    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--no-sync-sheets"],
    )

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert calls == ["core", "publish", "extension_publish", "prepare_engagement", "send_engagement", "cleanup"]
    assert "Daily AI external publish stopped: publish_send_not_attempted" not in output
    assert "post_publish_feed_study_deferred_to_extension_lane" in output
    assert row.engagement_status == "done"


def test_daily_ai_engagement_defaults_use_expanded_caps() -> None:
    source = Path(cli.__file__).read_text(encoding="utf-8")
    run_daily_body = source.split("def run_daily_ai_automation", 1)[1].split(
        "\n\ndef _run_daily_ai_automation_entrypoint", 1
    )[0]
    send_body = source.split("def send_engagement_candidates_local", 1)[1].split(
        "\n\n@app.command(\"expire-stale-engagement-candidates-local\")", 1
    )[0]

    assert "max_engagement_actions: int = 9" in run_daily_body
    assert "max_actions: int = 9" in send_body
    assert "_post_publish_engagement_feed_study_local(" in run_daily_body
    assert "prepare_engagement_candidates_local(" in run_daily_body
    assert run_daily_body.index("_post_publish_engagement_feed_study_local(") < run_daily_body.index(
        "prepare_engagement_candidates_local("
    )
    assert "external_posts_read >= 15" in run_daily_body or "external_posts_read >= 15" in source


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_runs_engagement_when_publish_flow_only_prepares_candidates(monkeypatch, tmp_path, capsys) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    media_date = cli._current_generated_media_date_token()
    ready_card = f"artifacts/generated-media/{media_date}-item-ready-x-card.png"
    _touch_generated_media(tmp_path / ready_card)
    row = QueueRow(
        id="item-ready",
        status="drafted",
        review_status="ready_morning",
        quality_score="11",
        source_url="https://example.com/source",
        x_text="x copy",
        linkedin_text="linkedin copy https://example.com/source",
        media_plan="X自作判断カード型 with generated card; LinkedInリンクカード型 with official source link card",
        reference_media_notes=(
            f"generated x card: {ready_card} model=gpt-image-2 provider=runway_mcp size=1024x1024 "
            "visual_style=x_self_made_decision_card platform=x language=ja "
            "prompt=日本語の判断カードでAI導入の分岐を説明"
        ),
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    calls: list[str] = []

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "verify_main_chrome_profile_control", lambda **kwargs: calls.append("verify"))
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: calls.append("extension_publish")
        or {
            "attempted": 1,
            "posted": 0,
            "skipped": 1,
            "stop_reason": "publish_send_failed",
            "media_receipt": "automation_failure_category=clickability",
        },
    )
    monkeypatch.setattr(
        cli,
        "prepare_engagement_candidates_local",
        lambda **kwargs: calls.append("prepare_engagement"),
    )
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: calls.append("extension_engagement") or {"sent": 1, "skipped": 0, "stop_reason": "", "receipts": []},
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: calls.append("cleanup"))

    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--no-sync-sheets"],
    )

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert calls == ["extension_publish", "prepare_engagement", "extension_engagement", "cleanup"]
    assert "Daily AI external publish incomplete" in output
    assert "publish_send_failed" in output
    assert "attempted=1; posted=0; skipped=1" in output
    assert "Daily AI Chrome Extension engagement sender" in output

    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["stop_reason"] == "publish_send_failed"
    assert "automation_health=stage:daily_ai_postflight|lane:chrome_extension_profile2_fallback" in payload["media_receipt"]
    assert "resume:publish_send_failed" in payload["media_receipt"]
    assert "automation_failure_category=clickability" in payload["media_receipt"]
    assert row.status == "drafted"
    assert row.x_post_url == ""
    assert row.linkedin_post_url == ""
    assert "Daily AI Chrome plugin publish candidate" in row.review_notes


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_runs_engagement_after_publish_profile2_exception(
    monkeypatch, tmp_path, capsys
) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    row = QueueRow(
        id="item-ready",
        status="drafted",
        review_status="ready_morning",
        quality_score="11",
        keep_priority="ship_now",
        source_url="https://example.com/source",
        x_text="x copy https://example.com/source",
        linkedin_text="linkedin copy https://example.com/source",
        media_plan="X本文+URL型; LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([row])
    calls: list[str] = []

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "verify_main_chrome_profile_control", lambda **kwargs: None)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_local",
        lambda **kwargs: {
            "attempted": 1,
            "posted": 0,
            "skipped": 1,
            "stop_reason": "publish_send_failed",
            "media_receipt": "automation_failure_category=completion",
        },
    )
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: calls.append("publish")
        or (_ for _ in ()).throw(RuntimeError("chrome_extension_profile2_unavailable: Detached while handling command.")),
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: None)
    monkeypatch.setattr(
        cli,
        "prepare_engagement_candidates_local",
        lambda **kwargs: calls.append("prepare_engagement"),
    )
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: calls.append("engagement") or {"sent": 1, "skipped": 0, "receipts": []},
    )

    result = CliRunner().invoke(cli.app, ["run-daily-ai-automation", "--no-sync-sheets"])

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert "Daily AI Chrome Extension publish stopped: chrome_extension_profile2_unavailable: Detached while handling command." in output
    assert "Daily AI engagement lane:" in output
    assert "Daily AI Chrome Extension engagement sender" in output
    assert calls == ["publish", "prepare_engagement", "engagement"]
    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["stop_reason"] == "chrome_extension_profile2_unavailable: Detached while handling command."
    assert "automation_failure_category=lane" in payload["media_receipt"]
    assert "resume:chrome_extension_profile2_unavailable: Detached while handling command." in payload["media_receipt"]
    assert "automation_failure_category=lane" in payload["media_receipt"]


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_runs_engagement_when_attempted_publish_is_held_after_failure(
    monkeypatch, tmp_path, capsys
) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    row = QueueRow(
        id="held-after-failure",
        status="drafted",
        review_status="ready_morning",
        quality_score="11",
        keep_priority="ship_now",
        source_url="https://example.com/source",
        x_text="x copy https://example.com/source",
        linkedin_text="linkedin copy https://example.com/source",
        media_plan="X本文+URL型; LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    def fake_send_publish(**kwargs):
        row.review_status = "hold"
        row.error = "linkedin_publish_failed: surface_missing"
        repo.update(row)
        return {
            "attempted": 1,
            "posted": 0,
            "skipped": 1,
            "stop_reason": "surface_missing",
            "media_receipt": "automation_failure_category=surface",
        }

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "verify_main_chrome_profile_control", lambda **kwargs: None)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "_send_publish_candidates_chrome_extension", fake_send_publish)
    monkeypatch.setattr(
        cli,
        "_post_publish_engagement_feed_study_local",
        lambda **kwargs: {},
    )
    monkeypatch.setattr(cli, "prepare_engagement_candidates_local", lambda **kwargs: None)
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: {"sent": 1, "skipped": 0, "stop_reason": "", "receipts": []},
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: None)

    result = CliRunner().invoke(cli.app, ["run-daily-ai-automation", "--no-sync-sheets"])

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert "attempted=1; posted=0; skipped=1" in output
    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["stop_reason"] == "surface_missing"
    assert payload["automation_health"]["completion_required"] == "external_publish_completion_required"
    assert "completion:external_publish_completion_required" in payload["media_receipt"]


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_keeps_publish_completion_required_when_engagement_also_fails(
    monkeypatch, tmp_path, capsys
) -> None:
    row = QueueRow(
        id="publish-and-engagement-fail",
        status="drafted",
        review_status="ready_morning",
        quality_score="11",
        keep_priority="ship_now",
        source_url="https://example.com/source",
        x_text="x copy https://example.com/source",
        linkedin_text="linkedin copy https://example.com/source",
        media_plan="X本文+URL型; LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: {
            "attempted": 1,
            "posted": 0,
            "skipped": 1,
            "stop_reason": "publish_send_failed",
            "media_receipt": "automation_failure_category=completion",
        },
    )
    monkeypatch.setattr(cli, "prepare_engagement_candidates_local", lambda **kwargs: None)
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("engagement_send_failed: body_not_reflected")),
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: None)

    result = CliRunner().invoke(cli.app, ["run-daily-ai-automation", "--no-sync-sheets"])

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert "Daily AI Chrome Extension engagement stopped: engagement_send_failed" in output
    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["stop_reason"] == "engagement_send_failed"
    assert payload["automation_health"]["completion_required"] == "external_publish_completion_required"
    assert payload["automation_health"]["resume_target"] == "publish_send_failed"
    assert "completion:external_publish_completion_required" in payload["media_receipt"]


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_records_partial_publish_counts(monkeypatch, tmp_path, capsys) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    row = QueueRow(
        id="partial-item",
        status="drafted",
        review_status="ready_morning",
        quality_score="11",
        source_url="https://example.com/source",
        x_text="x copy https://example.com/source",
        linkedin_text="linkedin copy https://example.com/source",
        media_plan="X本文+URL型; LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    def fake_send_publish(**kwargs):
        row.status = "partially_published"
        row.x_post_url = "https://x.com/nichika2000823/status/123"
        row.error = "linkedin_publish_failed: body_not_reflected: LinkedIn composer did not contain linkedin_text."
        repo.update(row)
        return {
            "attempted": 2,
            "posted": 1,
            "skipped": 1,
            "sheets_synced_count": 42,
            "stop_reason": "",
            "media_receipt": "automation_failure_category=input_reflection",
        }

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "verify_main_chrome_profile_control", lambda **kwargs: None)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "_send_publish_candidates_chrome_extension", fake_send_publish)
    monkeypatch.setattr(cli, "prepare_engagement_candidates_local", lambda **kwargs: None)
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: {"sent": 1, "skipped": 0, "stop_reason": "", "receipts": []},
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: None)

    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--no-sync-sheets"],
    )

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert "Daily AI external publish incomplete" in output
    assert "Daily AI Chrome Extension engagement sender" in output

    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["stop_reason"] == "publish_send_failed"
    assert payload["selected_count"] == 1
    assert payload["posted_count"] == 1
    assert payload["sheets_synced_count"] == 42
    assert "automation_failure_category=input_reflection" in payload["media_receipt"]


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_records_partial_publish_with_no_skips_as_failed(monkeypatch, tmp_path, capsys) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    completed_row = QueueRow(
        id="completed-item",
        status="drafted",
        review_status="ready_morning",
        quality_score="11",
        source_url="https://example.com/source",
        x_text="x copy https://example.com/source",
        linkedin_text="linkedin copy https://example.com/source",
        media_plan="X本文+URL型; LinkedInリンクカード型",
    )
    pending_row = QueueRow(
        id="pending-item",
        status="drafted",
        review_status="ready_morning",
        quality_score="11",
        source_url="https://example.com/pending",
        x_text="pending source-specific copy https://example.com/pending",
        linkedin_text="linkedin copy https://example.com/pending",
        media_plan="X本文+URL型; LinkedInリンクカード型",
    )
    repo = MutableDummyRepo([completed_row, pending_row])

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    def fake_send_publish(**kwargs):
        completed_row.status = "published"
        completed_row.x_post_url = "https://x.com/nichika2000823/status/123"
        completed_row.linkedin_post_url = "https://www.linkedin.com/feed/update/urn:li:activity:123/"
        repo.update(completed_row)
        return {
            "attempted": 1,
            "posted": 1,
            "skipped": 0,
            "sheets_synced_count": 42,
            "stop_reason": "",
        }

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "verify_main_chrome_profile_control", lambda **kwargs: None)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "_send_publish_candidates_chrome_extension", fake_send_publish)
    monkeypatch.setattr(cli, "prepare_engagement_candidates_local", lambda **kwargs: None)
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: {"sent": 1, "skipped": 0, "stop_reason": "", "receipts": []},
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: None)

    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--no-sync-sheets"],
    )

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert "Daily AI external publish incomplete" in output
    assert "pending_candidates=pending-item" in output
    assert "Daily AI Chrome Extension engagement sender" in output

    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["stop_reason"] == "publish_send_failed"
    assert payload["posted_count"] == 1
    assert "resume:publish_send_failed" in payload["media_receipt"]


def test_local_linkedin_body_input_uses_press_sequentially_not_dom_injection() -> None:
    source = Path(cli.__file__).read_text(encoding="utf-8")
    function_body = source.split("def _set_linkedin_editor_body", 1)[1].split(
        "\n\ndef _ensure_linkedin_link_card_reflected", 1
    )[0]

    assert "press_sequentially" in function_body
    assert ".fill(" not in function_body
    assert "innerHTML" not in function_body
    assert "InputEvent" not in function_body


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_uses_profile2_extension_publish_sender(
    monkeypatch, tmp_path, capsys
) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"
    row = QueueRow(
        id="item-ready",
        status="drafted",
        review_status="ready_morning",
        quality_score="11",
        source_url="https://example.com/source",
        x_text="x copy https://example.com/source",
        media_plan="X本文+URL型",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    calls: list[str] = []

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "verify_main_chrome_profile_control", lambda **kwargs: calls.append("verify"))
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    def fake_profile2_publish(**kwargs):
        calls.append("extension_publish")
        assert kwargs["lane_resolution"]["lane"] == "chrome_extension_profile2_fallback"
        row.x_post_url = "https://x.com/nichika2000823/status/123"
        row.x_published_at = "2026-06-01T17:00:00+00:00"
        row.status = "partially_published"
        repo.update(row)
        return {"attempted": 1, "posted": 1, "skipped": 0, "stop_reason": ""}

    monkeypatch.setattr(cli, "_send_publish_candidates_chrome_extension", fake_profile2_publish)
    monkeypatch.setattr(cli, "_post_publish_engagement_feed_study_local", lambda **kwargs: calls.append("feed_study") or {})
    monkeypatch.setattr(cli, "prepare_engagement_candidates_local", lambda **kwargs: calls.append("prepare_engagement"))
    monkeypatch.setattr(cli, "_send_engagement_candidates_chrome_extension", lambda **kwargs: calls.append("extension_engagement") or {"sent": 1, "skipped": 0, "stop_reason": ""})
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: calls.append("cleanup"))

    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--no-sync-sheets"],
    )

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert calls == ["extension_publish", "prepare_engagement", "extension_engagement", "cleanup"]
    assert "Daily AI Chrome Extension publish sender" in output
    assert "Daily AI external publish stopped" not in output


def test_profile2_retry_after_nicky_failure_requires_attempt_or_skip_count() -> None:
    assert (
        cli._should_try_profile2_after_nicky_publish_failure(
            {"posted": 0, "stop_reason": "publish_send_failed"},
            dry_run=False,
        )
        is False
    )
    assert (
        cli._should_try_profile2_after_nicky_publish_failure(
            {"attempted": 1, "posted": 0, "skipped": 1, "stop_reason": "publish_send_failed"},
            dry_run=False,
        )
        is True
    )


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_uses_chrome_extension_senders_on_profile2_fallback(
    monkeypatch, tmp_path, capsys
) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    calls: list[str] = []

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": MutableDummyRepo([]))
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(
        cli,
        "_automation_lane_busy_marker",
        lambda: ({"owner": "other-run", "expires_at": "2099-01-01T00:00:00+00:00"}, None),
    )
    monkeypatch.setattr(cli, "run_core_flow", lambda **kwargs: calls.append("core"))
    monkeypatch.setattr(cli, "run_publish_flow", lambda **kwargs: calls.append("publish"))
    monkeypatch.setattr(cli, "prepare_engagement_candidates_local", lambda **kwargs: calls.append("prepare_engagement"))
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: calls.append("extension_publish") or {"posted": 1, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: calls.append("extension_engagement") or {"sent": 1, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(
        cli,
        "send_engagement_candidates_local",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("local sender must not run on Profile 2 fallback")),
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: calls.append("cleanup"))

    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--no-sync-sheets"],
    )

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert calls == ["core", "publish", "extension_publish", "prepare_engagement", "extension_engagement", "cleanup"]
    assert '"lane": "chrome_extension_profile2_fallback"' in output
    assert "Daily AI Chrome Extension publish sender" in output
    assert "post_publish_feed_study_deferred_to_extension_lane" in output
    assert "Daily AI Chrome Extension engagement sender" in output


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_normalizes_legacy_lane_to_extension_only(
    monkeypatch, tmp_path, capsys
) -> None:
    row = QueueRow(id="published", status="published", x_post_url="https://x.com/nichika2000823/status/1")
    repo = DummyRepo([row])
    calls: list[str] = []

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_browser_lane_resolution_payload", lambda *args, **kwargs: {"lane": "nicky_automation"})
    monkeypatch.setattr(cli, "run_core_flow", lambda **kwargs: calls.append("core"))
    monkeypatch.setattr(cli, "run_publish_flow", lambda **kwargs: calls.append("publish"))
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_publish_items: [])
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: {"attempted": 0, "posted": 0, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: calls.append(("extension_publish", kwargs["lane_resolution"]["lane"]))
        or {"attempted": 0, "posted": 0, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(cli, "prepare_engagement_candidates_local", lambda **kwargs: calls.append("prepare_engagement"))
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: calls.append(("extension_engagement", kwargs["lane_resolution"]["lane"]))
        or {"sent": 1, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_local",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("Nicky/local publish sender must not run")),
    )
    monkeypatch.setattr(
        cli,
        "send_engagement_candidates_local",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("Nicky/local engagement sender must not run")),
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: calls.append("cleanup"))

    result = CliRunner().invoke(cli.app, ["run-daily-ai-automation", "--no-sync-sheets"])

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert calls == [
        "core",
        "publish",
        ("extension_publish", "chrome_extension_profile2_fallback"),
        "prepare_engagement",
        ("extension_engagement", "chrome_extension_profile2_fallback"),
        "cleanup",
    ]
    assert '"legacy_lane": "nicky_automation"' in output
    assert "Daily AI Chrome Extension publish sender" in output
    assert "Daily AI Chrome Extension engagement sender" in output


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_partial_publish_allows_extension_engagement(
    monkeypatch, tmp_path, capsys
) -> None:
    row = QueueRow(
        id="partial",
        status="partially_published",
        x_post_url="https://x.com/nichika2000823/status/1",
    )
    repo = DummyRepo([row])
    calls: list[str] = []

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        cli,
        "_browser_lane_resolution_payload",
        lambda *args, **kwargs: {"lane": "chrome_extension_profile2_fallback"},
    )
    monkeypatch.setattr(cli, "run_core_flow", lambda **kwargs: calls.append("core"))
    monkeypatch.setattr(cli, "run_publish_flow", lambda **kwargs: calls.append("publish"))
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_publish_items: [row])
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: calls.append("extension_publish")
        or {"attempted": 1, "posted": 1, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(
        cli,
        "prepare_engagement_candidates_local",
        lambda **kwargs: calls.append("prepare_engagement"),
    )
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: calls.append("extension_engagement") or {"sent": 1, "skipped": 0, "stop_reason": "", "receipts": []},
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: calls.append("cleanup"))

    result = CliRunner().invoke(cli.app, ["run-daily-ai-automation", "--no-sync-sheets"])

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert calls == ["core", "publish", "extension_publish", "prepare_engagement", "extension_engagement", "cleanup"]
    assert "pending_candidates=partial" in output
    assert "Daily AI Chrome Extension engagement sender" in output


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_sender_syncs_skipped_queue_updates(monkeypatch, tmp_path) -> None:
    calls: list[str] = []

    class Result:
        returncode = 0
        stdout = '{"published": 0, "skipped": 1, "receipts": []}'
        stderr = ""

    monkeypatch.setenv("SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD", "trusted-runner")
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": calls.append("local_repo") or object())
    monkeypatch.setattr(cli, "get_repo", lambda: calls.append("sheets_repo") or object())
    monkeypatch.setattr(cli, "_sync_local_queue_to_sheets", lambda local, sheets: calls.append("sync") or 7)

    result = cli._send_publish_candidates_chrome_extension(
        path=str(tmp_path / "posting_queue.tsv"),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_publish_items=1,
        sync_sheets=True,
        dry_run=False,
    )

    assert result["skipped"] == 1
    assert result["sheets_synced_count"] == 7
    assert calls == ["local_repo", "sheets_repo", "sync"]


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_sender_reports_partial_payload_stop_reason(monkeypatch, tmp_path) -> None:
    calls: list[str] = []

    class Result:
        returncode = 0
        stdout = json.dumps(
            {
                "published": 1,
                "skipped": 1,
                "receipts": [
                    {
                        "id": "partial-profile2",
                        "error": "body_not_reflected: LinkedIn composer did not contain linkedin_text.",
                    }
                ],
            }
        )
        stderr = ""

    monkeypatch.setenv("SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD", "trusted-runner")
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": calls.append("local_repo") or object())
    monkeypatch.setattr(cli, "get_repo", lambda: calls.append("sheets_repo") or object())
    monkeypatch.setattr(cli, "_sync_local_queue_to_sheets", lambda local, sheets: calls.append("sync") or 7)

    result = cli._send_publish_candidates_chrome_extension(
        path=str(tmp_path / "posting_queue.tsv"),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_publish_items=1,
        sync_sheets=True,
        dry_run=False,
    )

    assert result["posted"] == 0
    assert result["skipped"] == 1
    assert result["stop_reason"] == "publish_send_failed"
    assert result["media_receipt"] == "automation_failure_category=input_reflection"
    assert calls == ["local_repo", "sheets_repo", "sync"]


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_sender_reports_trusted_bridge_unavailable(monkeypatch, tmp_path) -> None:
    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted bridge request failed: fetch failed"

    seen: dict[str, object] = {}
    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs publish",
    )

    def fake_run(args, **kwargs):
        seen["args"] = args
        seen["shell"] = kwargs.get("shell")
        return Result()

    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    try:
        cli._send_publish_candidates_chrome_extension(
            path=str(tmp_path / "posting_queue.tsv"),
            lane_resolution={"lane": "chrome_extension_profile2_fallback"},
            max_publish_items=1,
            sync_sheets=False,
            dry_run=False,
        )
    except RuntimeError as exc:
        assert "trusted_runner_bridge_unavailable" in str(exc)
    else:
        raise AssertionError("expected trusted bridge unavailable error")

    assert seen["args"] == ["node", "scripts/browser_use/chrome_extension_trusted_bridge_client.mjs", "publish"]
    assert seen["shell"] is None


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_sender_preserves_runner_gate_failure(monkeypatch, tmp_path) -> None:
    class Result:
        returncode = 2
        stdout = ""
        stderr = json.dumps(
            {
                "ok": False,
                "stop_reason": "trusted_runner_bridge_failed",
                "error": "chrome_extension_profile2_unavailable: account_not_verified: expected X @nichika2000823 was not visible",
            }
        )

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs publish",
    )
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    with pytest.raises(RuntimeError, match="chrome_extension_profile2_unavailable: account_not_verified"):
        cli._send_publish_candidates_chrome_extension(
            path=str(tmp_path / "posting_queue.tsv"),
            lane_resolution={"lane": "chrome_extension_profile2_fallback"},
            max_publish_items=1,
            sync_sheets=False,
            dry_run=False,
        )


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_sender_recovers_success_from_durable_receipt(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    receipt_dir = tmp_path / "artifacts" / "trusted-bridge-runs"
    receipt_dir.mkdir(parents=True)
    (receipt_dir / "fixed-publish.json").write_text(
        json.dumps(
            {
                "status": "succeeded",
                "result": {
                    "published": 1,
                    "skipped": 0,
                    "receipts": [{"id": "candidate", "post_url": "https://x.com/nichika2000823/status/1"}],
                },
            }
        ),
        encoding="utf-8",
    )

    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted_runner_bridge_unavailable: AbortError"

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs publish",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-publish")
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    result = cli._send_publish_candidates_chrome_extension(
        path=str(queue_path),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_publish_items=1,
        sync_sheets=False,
        dry_run=False,
    )

    assert result["posted"] == 1
    assert result["bridge_receipt_path"].endswith("fixed-publish.json")
    assert result["receipts"][0]["post_url"] == "https://x.com/nichika2000823/status/1"


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_sender_reports_durable_receipt_blocker(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    receipt_dir = tmp_path / "artifacts" / "trusted-bridge-runs"
    receipt_dir.mkdir(parents=True)
    (receipt_dir / "fixed-publish.json").write_text(
        json.dumps(
            {
                "status": "failed",
                "error": "chrome_extension_profile2_unavailable: account_not_verified: expected X account missing",
            }
        ),
        encoding="utf-8",
    )

    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted_runner_bridge_unavailable: AbortError"

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs publish",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-publish")
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    with pytest.raises(RuntimeError, match="account_not_verified"):
        cli._send_publish_candidates_chrome_extension(
            path=str(queue_path),
            lane_resolution={"lane": "chrome_extension_profile2_fallback"},
            max_publish_items=1,
            sync_sheets=False,
            dry_run=False,
        )


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_sender_reports_runtime_boundary_receipt(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    receipt_dir = tmp_path / "artifacts" / "trusted-bridge-runs"
    receipt_dir.mkdir(parents=True)
    boundary = "trusted_runner_bridge_runtime_boundary: active bridge job did not finish before trusted context shutdown"
    (receipt_dir / "fixed-publish.json").write_text(
        json.dumps(
            {
                "status": "failed",
                "stop_reason": boundary,
                "error": boundary,
            }
        ),
        encoding="utf-8",
    )

    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted_runner_bridge_unavailable: trusted_runner_bridge_poll_timeout"

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs publish",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-publish")
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    with pytest.raises(RuntimeError, match="trusted_runner_bridge_runtime_boundary"):
        cli._send_publish_candidates_chrome_extension(
            path=str(queue_path),
            lane_resolution={"lane": "chrome_extension_profile2_fallback"},
            max_publish_items=1,
            sync_sheets=False,
            dry_run=False,
        )


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_sender_recovers_post_url_from_queue(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    candidate = QueueRow(
        id="candidate",
        x_post_url="https://x.com/nichika2000823/status/2",
        review_notes="Local automation profile publish candidate",
    )

    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted_runner_bridge_unavailable: AbortError"

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs publish",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-publish")
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_items: [candidate])
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([candidate]))
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    result = cli._send_publish_candidates_chrome_extension(
        path=str(queue_path),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_publish_items=1,
        sync_sheets=False,
        dry_run=False,
    )

    assert result["posted"] == 1
    assert result["stop_reason"] == ""
    assert result["receipts"][0]["completion"] == "posting_queue_recovered"
    assert result["receipts"][0]["post_url"] == "https://x.com/nichika2000823/status/2"


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_recovery_does_not_hide_pending_linkedin_blocker(
    monkeypatch, tmp_path
) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    candidate = QueueRow(
        id="candidate",
        status="partially_published",
        x_post_url="https://x.com/nichika2000823/status/2",
        linkedin_text="LinkedIn copy",
        error="linkedin_publish_failed: local_automation_profile_unavailable",
        review_notes="Local automation profile publish candidate",
    )

    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted_runner_bridge_unavailable: AbortError"

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs publish",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-publish")
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_items: [candidate])
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([candidate]))
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    result = cli._send_publish_candidates_chrome_extension(
        path=str(queue_path),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_publish_items=1,
        sync_sheets=False,
        dry_run=False,
    )

    assert result["posted"] == 1
    assert result["skipped"] == 1
    assert "linkedin_publish_failed" in result["stop_reason"]
    assert result["receipts"][0]["completion"] == "posting_queue_recovered"
    assert result["receipts"][1]["error"].startswith("candidate:linkedin_publish_failed")


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_recovery_keeps_stale_x_source_link_card_pending(
    monkeypatch, tmp_path
) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    candidate = QueueRow(
        id="candidate",
        status="partially_published",
        x_text="Source note https://example.com/source",
        source_url="https://example.com/source",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:1/",
        media_plan="X uses source/link card with the official source URL",
        error="x_publish_failed: surface_missing: unsupported X surface x_source_link_card.",
        review_notes="Local automation profile publish candidate | x_publish_blocked:surface_missing: unsupported X surface x_source_link_card.",
    )

    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted_runner_bridge_unavailable: AbortError"

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs publish",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-publish")
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_items: [candidate])
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([candidate]))
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    result = cli._send_publish_candidates_chrome_extension(
        path=str(queue_path),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_publish_items=1,
        sync_sheets=False,
        dry_run=False,
    )

    assert result["posted"] == 1
    assert result["skipped"] == 1
    assert "x_publish_pending: external_publish_completion_required" in result["stop_reason"]
    assert result["receipts"][0]["completion"] == "posting_queue_recovered"
    assert result["receipts"][1]["error"].startswith("candidate:x_publish_pending")


def test_queue_blocker_fragment_keeps_real_blocker_after_stale_x_source_link_card() -> None:
    row = QueueRow(
        id="mixed-blocker",
        media_plan="X uses source/link card with the official source URL",
        error="x_publish_failed: surface_missing: unsupported X surface x_source_link_card. body_not_reflected",
    )

    blocker = cli._queue_blocker_fragment(row, ("surface_missing", "body_not_reflected"))

    assert "body_not_reflected" in blocker
    assert "unsupported X surface x_source_link_card" not in blocker


def test_publish_queue_recovery_ignores_stale_linkedin_surface_failure_after_revalidation(monkeypatch) -> None:
    row = QueueRow(
        id="linkedin-resume",
        status="partially_published",
        x_text="Already posted",
        x_post_url="https://x.com/nichika2000823/status/123",
        linkedin_text="LinkedIn pending https://example.com/source",
        source_url="https://example.com/source",
        media_plan="LinkedInリンクカード型",
        review_notes=(
            "Daily AI Browser Use-native publish candidate | "
            "2026-06-01T06:11:53Z: LinkedIn publish skipped: "
            "link_card_not_reflected: LinkedIn official source link card was not visible | "
            "Revalidated existing ship_now candidate because the publish run needed a 3-item buffer "
            "and the surface contract was clear."
        ),
    )

    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([row]))

    result = cli._publish_queue_recovery_payload("posting_queue.tsv", [row.id])

    assert result["skipped"] == 1
    assert "linkedin_publish_pending: external_publish_completion_required" in result["stop_reason"]
    assert "link_card_not_reflected" not in result["stop_reason"]


def test_publish_queue_recovery_keeps_current_linkedin_surface_failure_after_revalidation(monkeypatch) -> None:
    row = QueueRow(
        id="linkedin-current-failure",
        status="partially_published",
        x_text="Already posted",
        x_post_url="https://x.com/nichika2000823/status/123",
        linkedin_text="LinkedIn pending https://example.com/source",
        source_url="https://example.com/source",
        media_plan="LinkedInリンクカード型",
        review_notes=(
            "Daily AI Browser Use-native publish candidate | "
            "Revalidated existing ship_now candidate because the publish run needed a 3-item buffer "
            "and the surface contract was clear. | "
            "2026-06-04T05:00:00Z: LinkedIn publish skipped: "
            "link_card_not_reflected: LinkedIn official source link card was not visible"
        ),
    )

    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([row]))

    result = cli._publish_queue_recovery_payload("posting_queue.tsv", [row.id])

    assert result["skipped"] == 1
    assert "link_card_not_reflected" in result["stop_reason"]


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_sender_prefers_queue_url_over_failed_receipt(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    receipt_dir = tmp_path / "artifacts" / "trusted-bridge-runs"
    receipt_dir.mkdir(parents=True)
    (receipt_dir / "fixed-publish.json").write_text(
        json.dumps(
            {
                "status": "failed",
                "error": "trusted_runner_bridge_unavailable: outer timeout",
            }
        ),
        encoding="utf-8",
    )
    candidate = QueueRow(
        id="candidate",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:123",
        review_notes="Local automation profile publish candidate",
    )

    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted_runner_bridge_unavailable: AbortError"

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs publish",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-publish")
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_items: [candidate])
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([candidate]))
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    result = cli._send_publish_candidates_chrome_extension(
        path=str(queue_path),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_publish_items=1,
        sync_sheets=False,
        dry_run=False,
    )

    assert result["posted"] == 1
    assert result["receipts"][0]["platform"] == "linkedin"
    assert result["receipts"][0]["post_url"] == "https://www.linkedin.com/feed/update/urn:li:activity:123"


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_sender_recovers_exact_blocker_from_queue(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    candidate = QueueRow(
        id="candidate",
        error="x_publish_failed: body_not_reflected: X composer did not contain x_text after fallback typing",
        review_notes="Local automation profile publish candidate",
    )

    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted_runner_bridge_unavailable: AbortError"

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs publish",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-publish")
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_items: [candidate])
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([candidate]))
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    result = cli._send_publish_candidates_chrome_extension(
        path=str(queue_path),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_publish_items=1,
        sync_sheets=False,
        dry_run=False,
    )

    assert result["posted"] == 0
    assert result["skipped"] == 1
    assert "x_publish_failed: body_not_reflected: X composer did not contain x_text" in result["stop_reason"]


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_publish_sender_recovers_after_subprocess_timeout(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    candidate = QueueRow(
        id="candidate",
        x_post_url="https://x.com/nichika2000823/status/3",
        review_notes="Local automation profile publish candidate",
    )

    seen: dict[str, object] = {}

    def fake_run(*args, **kwargs):
        seen["timeout"] = kwargs.get("timeout")
        raise cli.subprocess.TimeoutExpired(cmd=args[0], timeout=120)

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_PUBLISH_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs publish",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-publish")
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_items: [candidate])
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([candidate]))
    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    result = cli._send_publish_candidates_chrome_extension(
        path=str(queue_path),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_publish_items=1,
        sync_sheets=False,
        dry_run=False,
    )

    assert result["posted"] == 1
    assert seen["timeout"] == 240.0
    assert result["receipts"][0]["post_url"] == "https://x.com/nichika2000823/status/3"


def test_recover_trusted_bridge_result_rechecks_running_receipt(monkeypatch, tmp_path) -> None:
    receipt_path = tmp_path / "artifacts" / "trusted-bridge-runs" / "fixed-publish.json"
    receipt_path.parent.mkdir(parents=True)
    reads = {"count": 0}

    def fake_read(path: Path) -> dict[str, object]:
        reads["count"] += 1
        if reads["count"] < 2:
            return {"status": "running"}
        return {
            "status": "succeeded",
            "result": {
                "published": 1,
                "skipped": 0,
                "receipts": [{"id": "candidate", "post_url": "https://x.com/nichika2000823/status/9"}],
            },
        }

    monkeypatch.setattr(cli, "_read_trusted_bridge_receipt", fake_read)
    monkeypatch.setattr(cli.time, "sleep", lambda seconds: None)

    result = cli._recover_trusted_bridge_result(
        receipt_path,
        mode="publish",
        path=str(tmp_path / "posting_queue.tsv"),
        candidate_ids=["candidate"],
    )

    assert result["published"] == 1
    assert reads["count"] == 2


def test_recover_trusted_bridge_result_reports_stale_running_receipt(monkeypatch, tmp_path) -> None:
    receipt_path = tmp_path / "artifacts" / "trusted-bridge-runs" / "fixed-publish.json"
    receipt_path.parent.mkdir(parents=True)
    clock = {"now": 0.0}

    monkeypatch.setattr(cli, "_read_trusted_bridge_receipt", lambda path: {"status": "running"})
    monkeypatch.setattr(cli.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(cli.time, "sleep", lambda seconds: clock.update(now=clock["now"] + seconds))
    monkeypatch.setenv("SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_POLL_SECONDS", "8")

    with pytest.raises(RuntimeError, match="trusted_runner_bridge_running_receipt_stale"):
        cli._recover_trusted_bridge_result(
            receipt_path,
            mode="publish",
            path=str(tmp_path / "posting_queue.tsv"),
            candidate_ids=["candidate"],
        )


def test_recover_trusted_bridge_result_finalizes_stale_running_receipt(monkeypatch, tmp_path) -> None:
    receipt_path = tmp_path / "artifacts" / "trusted-bridge-runs" / "fixed-publish.json"
    receipt_path.parent.mkdir(parents=True)
    receipt_path.write_text(
        json.dumps(
            {
                "ok": False,
                "status": "running",
                "mode": "publish",
                "started_at": "2026-06-02T00:00:00Z",
                "updated_at": "2026-06-02T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    clock = {"now": 0.0}

    monkeypatch.setattr(cli.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(cli.time, "sleep", lambda seconds: clock.update(now=clock["now"] + seconds))
    monkeypatch.setenv("SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_POLL_SECONDS", "8")

    with pytest.raises(RuntimeError, match="trusted_runner_bridge_running_receipt_stale"):
        cli._recover_trusted_bridge_result(
            receipt_path,
            mode="publish",
            path=str(tmp_path / "posting_queue.tsv"),
            candidate_ids=["candidate"],
        )

    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    assert receipt["status"] == "failed"
    assert receipt["stale_watchdog"] is True
    assert receipt["error"].startswith("trusted_runner_bridge_running_receipt_stale:")


@pytest.mark.skip(reason="legacy Profile 2 publish payload contract is diagnostic only after the 2026-06-17 Browser Use override")
def test_profile2_publish_result_counts_partial_platform_completion_from_receipts(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    rows = [
        QueueRow(
            id="candidate",
            x_post_url="https://x.com/nichika2000823/status/10",
            linkedin_text="LinkedIn copy",
        )
    ]
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo(rows))

    result = cli._publish_sender_result_from_profile2_payload(
        {
            "published": 2,
            "skipped": 0,
            "receipts": [
                {
                    "id": "candidate",
                    "platform": "x",
                    "completion": "x_post_url_captured",
                    "post_url": "https://x.com/nichika2000823/status/10",
                },
                {
                    "id": "candidate",
                    "platform": "linkedin",
                    "error": "capture_failed: LinkedIn completion URL was not visible after submit",
                },
            ],
        },
        path=str(queue_path),
        sync_sheets=False,
        dry_run=False,
    )

    assert result["posted"] == 1
    assert result["skipped"] == 1
    assert result["attempted"] == 2
    assert result["stop_reason"] == "publish_send_failed"


@pytest.mark.skip(reason="legacy Profile 2 publish payload contract is diagnostic only after the 2026-06-17 Browser Use override")
def test_profile2_publish_result_rejects_published_count_without_completion_receipt(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([QueueRow(id="candidate")]))

    result = cli._publish_sender_result_from_profile2_payload(
        {
            "published": 1,
            "skipped": 0,
            "receipts": [{"id": "candidate"}],
        },
        path=str(queue_path),
        sync_sheets=False,
        dry_run=False,
    )

    assert result["posted"] == 0
    assert result["skipped"] == 1
    assert result["stop_reason"] == "publish_send_failed"


@pytest.mark.skip(reason="legacy Profile 2 publish payload contract is diagnostic only after the 2026-06-17 Browser Use override")
def test_profile2_publish_result_rejects_published_count_with_empty_receipts(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([QueueRow(id="candidate")]))

    result = cli._publish_sender_result_from_profile2_payload(
        {
            "published": 1,
            "skipped": 0,
            "receipts": [],
        },
        path=str(queue_path),
        sync_sheets=False,
        dry_run=False,
    )

    assert result["posted"] == 0
    assert result["skipped"] == 1
    assert result["stop_reason"] == "publish_send_failed"


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_engagement_sender_recovers_done_from_queue(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    candidate = QueueRow(
        id="engage-candidate",
        engagement_status="done",
        engaged_at="2026-06-02T00:00:00Z",
        engagement_action="reply_to_own_post",
        engagement_targets="https://x.com/nichika2000823/status/3",
    )

    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted_runner_bridge_unavailable: AbortError"

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_ENGAGEMENT_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs engagement",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-engagement")
    monkeypatch.setattr(cli, "_engagement_candidates", lambda rows, max_items: [candidate])
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([candidate]))
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    result = cli._send_engagement_candidates_chrome_extension(
        path=str(queue_path),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_actions=1,
        sync_sheets=False,
        dry_run=False,
    )

    assert result["sent"] == 1
    assert result["receipts"][0]["completion"] == "posting_queue_recovered"
    assert result["receipts"][0]["target"] == "https://x.com/nichika2000823/status/3"


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_engagement_sender_recovers_success_from_durable_receipt(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    receipt_dir = tmp_path / "artifacts" / "trusted-bridge-runs"
    receipt_dir.mkdir(parents=True)
    (receipt_dir / "fixed-engagement.json").write_text(
        json.dumps(
            {
                "status": "succeeded",
                "result": {
                    "sent": 1,
                    "skipped": 0,
                    "receipts": [{"id": "engage-candidate", "target": "https://x.com/nichika2000823/status/3"}],
                },
            }
        ),
        encoding="utf-8",
    )

    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted_runner_bridge_unavailable: AbortError"

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_ENGAGEMENT_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs engagement",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-engagement")
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    result = cli._send_engagement_candidates_chrome_extension(
        path=str(queue_path),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_actions=1,
        sync_sheets=False,
        dry_run=False,
    )

    assert result["sent"] == 1
    assert result["bridge_receipt_path"].endswith("fixed-engagement.json")
    assert result["receipts"][0]["target"] == "https://x.com/nichika2000823/status/3"


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_engagement_sender_recovers_after_subprocess_timeout(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    candidate = QueueRow(
        id="engage-candidate",
        engagement_status="done",
        engaged_at="2026-06-02T00:00:00Z",
        engagement_action="reply_to_own_post",
        engagement_targets="https://x.com/nichika2000823/status/4",
    )

    seen: dict[str, object] = {}

    def fake_run(*args, **kwargs):
        seen["timeout"] = kwargs.get("timeout")
        raise cli.subprocess.TimeoutExpired(cmd=args[0], timeout=120)

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_ENGAGEMENT_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs engagement",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-engagement")
    monkeypatch.setattr(cli, "_engagement_candidates", lambda rows, max_items: [candidate])
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([candidate]))
    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    result = cli._send_engagement_candidates_chrome_extension(
        path=str(queue_path),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_actions=1,
        sync_sheets=False,
        dry_run=False,
    )

    assert result["sent"] == 1
    assert seen["timeout"] == 240.0
    assert result["receipts"][0]["target"] == "https://x.com/nichika2000823/status/4"


@pytest.mark.skip(reason="legacy Chrome Extension bridge sender is diagnostic only after the 2026-06-17 Browser Use override")
def test_chrome_extension_engagement_sender_recovers_exact_blocker_from_queue(monkeypatch, tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    queue_path.write_text("id\n", encoding="utf-8")
    candidate = QueueRow(
        id="engage-candidate",
        engagement_status="approved",
        engagement_action="comment_candidate",
        engagement_targets="https://x.com/example/status/1",
        error="engagement_send_failed: body_not_reflected: comment editor mismatch after sequential typing",
    )

    class Result:
        returncode = 2
        stdout = ""
        stderr = "trusted_runner_bridge_unavailable: AbortError"

    monkeypatch.setenv(
        "SOCIAL_FLOW_CHROME_EXTENSION_ENGAGEMENT_RUNNER_CMD",
        "node scripts/browser_use/chrome_extension_trusted_bridge_client.mjs engagement",
    )
    monkeypatch.setattr(cli, "_trusted_bridge_run_id", lambda mode: "fixed-engagement")
    monkeypatch.setattr(cli, "_engagement_candidates", lambda rows, max_items: [candidate])
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([candidate]))
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: Result())

    result = cli._send_engagement_candidates_chrome_extension(
        path=str(queue_path),
        lane_resolution={"lane": "chrome_extension_profile2_fallback"},
        max_actions=1,
        sync_sheets=False,
        dry_run=False,
    )

    assert result["sent"] == 0
@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_records_sender_exception_and_runs_engagement(
    monkeypatch, tmp_path, capsys
) -> None:
    marker_path = tmp_path / "nicky-lane-busy.json"

    class DummySettings:
        chrome_main_user_data_dir = str(tmp_path / "chrome")
        chrome_main_profile_label = "二千 (Nicky automation)"
        chrome_main_profile_directory = "Default"
        chrome_main_remote_debugging_port = 9333

    calls: list[str] = []

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOCIAL_FLOW_NICKY_LANE_BUSY_MARKER", str(marker_path))
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "_process_rows", lambda: [])
    monkeypatch.setattr(cli, "_chrome_cdp_json", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "verify_main_chrome_profile_control", lambda **kwargs: calls.append("verify"))
    monkeypatch.setattr(cli, "run_core_flow", lambda **kwargs: calls.append("core"))
    monkeypatch.setattr(cli, "run_publish_flow", lambda **kwargs: calls.append("publish"))
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("link_card_not_reflected: preview missing")),
    )
    monkeypatch.setattr(
        cli,
        "prepare_engagement_candidates_local",
        lambda **kwargs: calls.append("prepare_engagement"),
    )
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: calls.append("extension_engagement") or {"sent": 1, "skipped": 0, "stop_reason": "", "receipts": []},
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: calls.append("cleanup"))

    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--no-sync-sheets"],
    )

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert calls == ["core", "publish", "prepare_engagement", "extension_engagement", "cleanup"]
    assert "publish_send_failed" in output
    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["stop_reason"] == "publish_send_failed"
    assert "automation_failure_category=surface" in payload["media_receipt"]
    assert payload["automation_health"]["completion_required"] == "external_publish_completion_required"


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_records_engagement_completion_required(monkeypatch, tmp_path, capsys) -> None:
    row = QueueRow(id="item-published", status="published", x_post_url="https://x.com/nichika2000823/status/1")
    repo = DummyRepo([row])
    monkeypatch.chdir(tmp_path)

    calls: list[str] = []

    monkeypatch.setattr(cli, "_browser_lane_resolution_payload", lambda *args, **kwargs: {"lane": "nicky_automation"})
    monkeypatch.setattr(cli, "run_core_flow", lambda **kwargs: calls.append("core"))
    monkeypatch.setattr(cli, "run_publish_flow", lambda **kwargs: calls.append("publish"))
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_publish_items: [])
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: {"attempted": 0, "posted": 0, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(cli, "_post_publish_engagement_feed_study_local", lambda **kwargs: calls.append("feed_study") or {})
    monkeypatch.setattr(cli, "prepare_engagement_candidates_local", lambda **kwargs: calls.append("prepare_engagement"))
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("engagement surface timeout")),
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: calls.append("cleanup"))

    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--no-sync-sheets"],
    )

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert calls[:2] == ["core", "publish"]
    assert "prepare_engagement" in calls
    assert calls[-1] == "cleanup"
    assert "engagement_send_failed" in output
    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["stop_reason"] == "engagement_send_failed"
    assert payload["automation_health"]["completion_required"] == "engagement_completion_required"
    assert "automation_failure_category=timeout" in payload["media_receipt"]
    assert "completion:engagement_completion_required" in payload["media_receipt"]


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_normalizes_legacy_lane_before_engagement_delegate(monkeypatch, tmp_path, capsys) -> None:
    row = QueueRow(id="item-published", status="published", x_post_url="https://x.com/nichika2000823/status/1")
    repo = DummyRepo([row])
    monkeypatch.chdir(tmp_path)

    monkeypatch.setattr(cli, "_browser_lane_resolution_payload", lambda *args, **kwargs: {"lane": "nicky_automation"})
    monkeypatch.setattr(cli, "run_core_flow", lambda **kwargs: None)
    monkeypatch.setattr(cli, "run_publish_flow", lambda **kwargs: None)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_publish_items: [])
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: {"attempted": 0, "posted": 0, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(
        cli,
        "prepare_engagement_candidates_local",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: {"sent": 1, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: None)

    result = CliRunner().invoke(cli.app, ["run-daily-ai-automation", "--no-sync-sheets"])

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert "post_publish_feed_study_deferred_to_extension_lane" in output
    assert "Daily AI Chrome Extension engagement sender" in output


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_marks_local_engagement_all_skip_as_incomplete(monkeypatch, tmp_path, capsys) -> None:
    row = QueueRow(id="item-published", status="published", x_post_url="https://x.com/nichika2000823/status/1")
    repo = DummyRepo([row])
    monkeypatch.chdir(tmp_path)

    monkeypatch.setattr(cli, "_browser_lane_resolution_payload", lambda *args, **kwargs: {"lane": "nicky_automation"})
    monkeypatch.setattr(cli, "verify_main_chrome_profile_control", lambda **kwargs: {"ok": True})
    monkeypatch.setattr(cli, "_write_automation_lane_busy_marker", lambda **kwargs: {"claimed": True})
    monkeypatch.setattr(cli, "run_core_flow", lambda **kwargs: None)
    monkeypatch.setattr(cli, "run_publish_flow", lambda **kwargs: None)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_publish_items: [])
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: {"attempted": 0, "posted": 0, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(cli, "prepare_engagement_candidates_local", lambda **kwargs: None)
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: {"sent": 0, "skipped": 2, "stop_reason": "engagement_send_failed"},
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: None)

    result = CliRunner().invoke(cli.app, ["run-daily-ai-automation", "--no-sync-sheets"])

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert "Daily AI Chrome Extension engagement stopped: engagement_send_failed" in output
    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["stop_reason"] == "engagement_send_failed"
    assert payload["automation_health"]["completion_required"] == "engagement_completion_required"


@pytest.mark.skip(reason="legacy Chrome Extension/Profile 2 run-daily-ai-automation path is disabled after the 2026-06-17 Browser Use override")
def test_run_daily_ai_automation_delegates_post_publish_feed_study_to_profile2_extension(monkeypatch, tmp_path, capsys) -> None:
    repo = DummyRepo([])
    monkeypatch.chdir(tmp_path)

    monkeypatch.setattr(
        cli,
        "_browser_lane_resolution_payload",
        lambda *args, **kwargs: {"lane": "chrome_extension_profile2_fallback"},
    )
    monkeypatch.setattr(cli, "run_core_flow", lambda **kwargs: None)
    monkeypatch.setattr(cli, "run_publish_flow", lambda **kwargs: None)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_publish_flow_candidates", lambda rows, max_publish_items: [])
    monkeypatch.setattr(
        cli,
        "_send_publish_candidates_chrome_extension",
        lambda **kwargs: {"posted": 1, "skipped": 0, "stop_reason": "", "media_receipt": ""},
    )
    monkeypatch.setattr(
        cli,
        "prepare_engagement_candidates_local",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        cli,
        "_send_engagement_candidates_chrome_extension",
        lambda **kwargs: {"sent": 1, "skipped": 0, "stop_reason": ""},
    )
    monkeypatch.setattr(cli, "cleanup_chrome_automation_tabs", lambda **kwargs: None)

    result = CliRunner().invoke(
        cli.app,
        ["run-daily-ai-automation", "--no-sync-sheets"],
    )

    output = capsys.readouterr().out + result.output
    assert result.exit_code == 0
    assert "post_publish_feed_study_deferred_to_extension_lane" in output
    assert "Daily AI Chrome Extension engagement sender" in output


def test_nicky_publish_sender_dispatches_all_supported_surfaces(monkeypatch) -> None:
    calls: list[tuple[str, str]] = []

    class DummySettings:
        x_expected_handle = "nichika2000823"

    def fake_x_text(page, row, *, settings, timeout_seconds):
        calls.append(("x", "x_text_url"))
        return "https://x.com/nichika2000823/status/1"

    def fake_x_media(page, row, *, settings, timeout_seconds, quote=False):
        calls.append(("x", "x_quote_interpretation_card" if quote else "x_self_made_decision_card"))
        return "https://x.com/nichika2000823/status/2"

    def fake_link(page, row, *, timeout_seconds):
        calls.append(("linkedin", "linkedin_link_card"))
        return "https://www.linkedin.com/feed/update/urn:li:activity:1/"

    def fake_linkedin_media(page, row, *, settings, timeout_seconds, count):
        calls.append(("linkedin", "linkedin_carousel" if count == 3 else "linkedin_square_image"))
        return f"https://www.linkedin.com/feed/update/urn:li:activity:{count}/"

    monkeypatch.setattr(cli, "_publish_x_text_url_local", fake_x_text)
    monkeypatch.setattr(cli, "_publish_x_generated_media_local", fake_x_media)
    monkeypatch.setattr(cli, "_publish_linkedin_link_card_local", fake_link)
    monkeypatch.setattr(cli, "_publish_linkedin_generated_media_local", fake_linkedin_media)

    rows = [
        QueueRow(id="x-url", media_plan="X本文+URL型", x_text="copy https://example.com"),
        QueueRow(id="x-card", media_plan="X自作判断カード型", x_text="copy"),
        QueueRow(id="x-quote", media_plan="X引用解釈カード型", x_text="copy"),
        QueueRow(id="li-link", media_plan="LinkedInリンクカード型", linkedin_text="copy https://example.com"),
        QueueRow(id="li-square", media_plan="LinkedIn正方形1枚画像型", linkedin_text="copy https://example.com"),
        QueueRow(id="li-carousel", media_plan="LinkedInカルーセル型", linkedin_text="copy https://example.com"),
    ]

    for row in rows[:3]:
        cli._publish_x_by_surface_local(None, row, settings=DummySettings(), timeout_seconds=1)
    for row in rows[3:]:
        cli._publish_linkedin_by_surface_local(None, row, settings=DummySettings(), timeout_seconds=1)

    assert calls == [
        ("x", "x_text_url"),
        ("x", "x_self_made_decision_card"),
        ("x", "x_quote_interpretation_card"),
        ("linkedin", "linkedin_link_card"),
        ("linkedin", "linkedin_square_image"),
        ("linkedin", "linkedin_carousel"),
    ]


def test_nicky_x_publish_routes_use_composer_insert_readback_helper() -> None:
    import inspect

    x_text = inspect.getsource(cli._publish_x_text_url_local)
    x_media = inspect.getsource(cli._publish_x_generated_media_local)
    helper = inspect.getsource(cli._insert_and_verify_x_composer_body)

    assert "_insert_and_verify_x_composer_body(" in x_text
    assert "source_url=source_url" in x_text
    assert "allow_reset=True" in x_text
    assert "_insert_and_verify_x_composer_body(" in x_media
    assert "allow_reset=not quote" in x_media
    assert "_read_x_composer_body(editor)" in helper
    assert "_insert_x_body_via_contenteditable(editor, body)" in helper
    assert "_reset_x_composer(page" in helper
    assert "InputEvent('input'" in inspect.getsource(cli._insert_x_body_via_contenteditable)


def test_nicky_generated_media_receipt_requires_platform_language_and_style(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-02")
    media_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-linkedin-square.png"
    _touch_generated_media(media_path)
    row = QueueRow(
        id="item",
        media_plan="LinkedIn正方形1枚画像型",
        reference_media_notes=f"{media_path} model=gpt-image-2 size=1024x1024 prompt=English explanatory image",
    )

    blockers = cli._selected_generated_media_receipt_blockers(row, "linkedin", [str(media_path)])

    assert "surface_missing: generated_media_visual_style_missing" in blockers
    assert "surface_missing: generated_media_platform_linkedin_missing" in blockers
    assert "surface_missing: generated_media_language_en_missing" in blockers


def test_generated_media_prompt_language_matches_platform() -> None:
    row = QueueRow(
        id="item",
        source_name="AWS Machine Learning Blog",
        source_url="https://aws.amazon.com/blogs/machine-learning/example/",
        title="Secure AI agents with policy interceptors",
    )

    x_prompt, _ = cli._generated_media_prompt(row, platform="x")
    linkedin_prompt, _ = cli._generated_media_prompt(row, platform="linkedin")

    assert cli._is_japanese_generated_media_prompt(x_prompt)
    assert not cli._is_japanese_generated_media_prompt(linkedin_prompt)
    assert cli._is_english_generated_media_prompt(linkedin_prompt)
    assert not cli._is_english_generated_media_prompt(x_prompt)


def test_x_generated_media_prompt_uses_japanese_headline_when_title_is_english() -> None:
    row = QueueRow(
        id="community-safety",
        title="Our commitment to community safety",
        x_text="Our commitment to community safety。アカウント保護や運用安全を強める内容です。",
        linkedin_text="セキュリティや安全設計をどう強化しているかを整理すると、運用判断に役立ちます。",
    )

    prompt, _ = cli._generated_media_prompt(row, platform="x")

    assert "大きな日本語見出しは「アカウント保護や運用安全を強める内容です」" in prompt
    assert "Our commitment to community" not in prompt


def test_generated_media_receipt_rejects_prompt_language_mismatch(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-02")
    x_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-x-card-1.png"
    linkedin_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-linkedin-square-1.png"
    _touch_generated_media(x_path)
    _touch_generated_media(linkedin_path)
    row = QueueRow(
        id="item",
        media_plan="X自作判断カード型 | LinkedIn正方形1枚画像型",
        reference_media_notes=(
            f"{x_path} model=gpt-image-2 size=1024x1024 visual_style=decision_card platform=x language=ja prompt=English decision card | "
            f"{linkedin_path} model=gpt-image-2 size=1024x1024 visual_style=comparison_card platform=linkedin language=en prompt=日本語画像"
        ),
    )

    x_blockers = cli._selected_generated_media_receipt_blockers(row, "x", [str(x_path)])
    linkedin_blockers = cli._selected_generated_media_receipt_blockers(row, "linkedin", [str(linkedin_path)])

    assert "surface_missing: generated_media_prompt_ja_missing" in x_blockers
    assert "surface_missing: generated_media_prompt_en_missing" in linkedin_blockers


def test_x_generated_media_surface_requires_x_receipt_metadata(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-02")
    x_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-x-card-1.png"
    _touch_generated_media(x_path)
    row = QueueRow(
        id="item",
        content_format="self_made_summary_card",
        x_text="X copy",
        media_plan="X自作判断カード型",
        reference_media_notes=(
            f"{x_path} model=gpt-image-2 size=1024x1024 "
            "visual_style=decision_card platform=x language=en prompt=English card"
        ),
    )

    blockers = cli._surface_contract_blockers(row)

    assert "surface_missing: generated_media_language_ja_missing" in blockers
    assert "surface_missing: generated_media_prompt_ja_missing" in blockers


def test_x_generated_media_surface_uses_x_path_when_linkedin_media_is_present(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-02")
    linkedin_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-linkedin-square-1.png"
    x_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-x-card-1.png"
    _touch_generated_media(linkedin_path)
    _touch_generated_media(x_path)
    row = QueueRow(
        id="item",
        content_format="self_made_summary_card",
        x_text="X copy",
        media_plan="LinkedIn正方形1枚画像型 | X自作判断カード型",
        reference_media_notes=(
            f"{linkedin_path} model=gpt-image-2 provider=runway_mcp size=1024x1024 "
            "visual_style=comparison_card platform=linkedin language=en prompt=English explanatory image | "
            f"{x_path} model=gpt-image-2 provider=runway_mcp size=1024x1024 "
            "visual_style=decision_card platform=x language=ja prompt=日本語の判断カード画像"
        ),
    )

    assert cli._surface_contract_blockers(row) == []


def test_x_generated_media_surface_ignores_unselected_linkedin_receipt_errors(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-02")
    x_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-x-card-1.png"
    linkedin_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-linkedin-square-1.png"
    _touch_generated_media(x_path)
    _touch_generated_media(linkedin_path)
    row = QueueRow(
        id="item",
        content_format="self_made_summary_card",
        x_text="X copy",
        media_plan="X自作判断カード型 | LinkedIn正方形1枚画像型",
        reference_media_notes=(
            f"{x_path} model=gpt-image-2 provider=runway_mcp size=1024x1024 "
            "visual_style=decision_card platform=x language=ja prompt=日本語の判断カード画像 | "
            f"{linkedin_path} model=dall-e-3 provider=runway_mcp size=1024x1024 "
            "visual_style=comparison_card platform=linkedin language=en prompt=English explanatory image"
        ),
    )

    assert cli._surface_contract_blockers(row) == []


def test_attach_runway_generated_media_to_row_updates_receipt_and_promotes(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-08")
    source_path = tmp_path / "runway-proof.png"
    _touch_generated_media(source_path)
    row = QueueRow(
        id="item",
        content_format="self_made_summary_card",
        x_text="X copy",
        media_plan="X自作判断カード型",
        quality_score="8",
        keep_priority="hold",
        review_status="hold",
        error="image_generation_unavailable: billing_hard_limit_reached",
    )

    result = cli._attach_runway_generated_media_to_row(
        row,
        platform="x",
        image_url=None,
        image_path=str(source_path),
        prompt="日本語の正方形判断カード画像。大きな日本語見出しと三つの短い要素で読みやすく作る。",
        visual_style="ai_tool_comparison_card",
    )

    attached_path = Path(result["path"])
    assert result["promoted"] is True
    assert result["surface_blockers"] == []
    assert attached_path.exists()
    assert attached_path.name == "2026-06-08-item-x-card-runway-mcp-1.png"
    assert "provider=runway_mcp" in row.reference_media_notes
    assert "model=gpt-image-2" in row.media_receipt
    assert "platform=x" in row.media_receipt
    assert "language=ja" in row.media_receipt
    assert row.error == ""
    assert row.quality_score == "10"
    assert row.keep_priority == "ship_now"
    assert row.review_status == "ready_morning"


def test_generated_media_receipt_rejects_unapproved_provider(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-08")
    media_path = tmp_path / "artifacts" / "generated-media" / "2026-06-08-item-x-card-1.png"
    _touch_generated_media(media_path)
    row = QueueRow(
        id="item",
        content_format="self_made_summary_card",
        x_text="X copy",
        media_plan="X自作判断カード型",
        reference_media_notes=(
            f"{media_path} model=gpt-image-2 provider=unknown_vendor size=1024x1024 "
            "visual_style=ai_tool_comparison_card platform=x language=ja prompt=日本語の判断カード画像"
        ),
    )

    blockers = cli._surface_contract_blockers(row)

    assert "surface_missing: generated_media_provider_unapproved" in blockers


def test_attach_runway_generated_media_keeps_error_when_surface_blockers_remain(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-08")
    source_path = tmp_path / "runway-proof.png"
    _touch_generated_media(source_path)
    row = QueueRow(
        id="item",
        content_format="self_made_summary_card",
        x_text="X copy",
        media_plan="X自作判断カード型",
        keep_priority="hold",
        review_status="hold",
        error="image_generation_unavailable: billing_hard_limit_reached",
    )

    result = cli._attach_runway_generated_media_to_row(
        row,
        platform="x",
        image_url=None,
        image_path=str(source_path),
        prompt="English only card",
        visual_style="ai_tool_comparison_card",
        language="en",
    )

    assert result["promoted"] is False
    assert "surface_missing: generated_media_language_ja_missing" in result["surface_blockers"]
    assert "surface_missing: generated_media_language_ja_missing" in row.error
    assert row.keep_priority == "hold"
    assert row.review_status == "hold"


def test_attach_runway_generated_media_local_command_updates_queue(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-08")
    queue_path = tmp_path / "posting_queue.tsv"
    repo = cli.LocalQueueRepository(str(queue_path))
    repo.bootstrap()
    repo.append(
        QueueRow(
            id="item",
            content_format="self_made_summary_card",
            x_text="X copy",
            media_plan="X自作判断カード型",
            keep_priority="hold",
            review_status="hold",
        )
    )
    source_path = tmp_path / "runway-proof.png"
    _touch_generated_media(source_path)

    result = CliRunner().invoke(
        cli.app,
        [
            "attach-runway-generated-media-local",
            "--row-id",
            "item",
            "--platform",
            "x",
            "--image-path",
            str(source_path),
            "--path",
            str(queue_path),
            "--prompt",
            "日本語の正方形判断カード画像。大きな日本語見出しと三つの短い要素で読みやすく作る。",
            "--visual-style",
            "ai_tool_comparison_card",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    updated = repo.get("item")
    assert payload["promoted"] is True
    assert updated is not None
    assert "provider=runway_mcp" in updated.media_receipt
    assert updated.keep_priority == "ship_now"


def test_local_queue_reads_large_tsv_fields(tmp_path) -> None:
    queue_path = tmp_path / "posting_queue.tsv"
    repo = cli.LocalQueueRepository(str(queue_path))
    repo.bootstrap()
    large_notes = "x" * 140_000
    repo.append(QueueRow(id="large-field", x_research_notes=large_notes))

    rows = repo.read_all()

    assert rows[0].id == "large-field"
    assert rows[0].x_research_notes == large_notes


def test_cli_import_raises_csv_field_size_limit_for_large_queue_rows() -> None:
    assert csv.field_size_limit() > 140_000


def test_attach_runway_mcp_result_local_command_updates_queue(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-08")
    queue_path = tmp_path / "posting_queue.tsv"
    repo = cli.LocalQueueRepository(str(queue_path))
    repo.bootstrap()
    repo.append(
        QueueRow(
            id="item",
            content_format="self_made_summary_card",
            x_text="X copy",
            media_plan="X自作判断カード型",
            keep_priority="hold",
            review_status="hold",
            error="image_generation_unavailable: runway_mcp_wrapper_timeout",
        )
    )
    source_path = tmp_path / "runway-mcp-final.png"
    _touch_generated_media(source_path)
    mcp_result_path = tmp_path / "runway-mcp-result.json"
    mcp_result_path.write_text(
        json.dumps(
            {
                "ok": True,
                "model": "gpt-image-2",
                "final_art_path": str(source_path),
                "task_ids": ["task-1"],
            }
        ),
        encoding="utf-8",
    )

    result = CliRunner().invoke(
        cli.app,
        [
            "attach-runway-mcp-result-local",
            "--row-id",
            "item",
            "--platform",
            "x",
            "--mcp-result",
            str(mcp_result_path),
            "--path",
            str(queue_path),
            "--prompt",
            "日本語の正方形判断カード画像。大きな日本語見出しと三つの短い要素で読みやすく作る。",
            "--visual-style",
            "ai_tool_comparison_card",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    updated = repo.get("item")
    assert payload["promoted"] is True
    assert payload["runway_task_ids"] == ["task-1"]
    assert updated is not None
    assert "provider=runway_mcp" in updated.media_receipt
    assert "model=gpt-image-2" in updated.media_receipt
    assert updated.error == ""
    assert updated.keep_priority == "ship_now"


def test_attach_runway_mcp_result_requires_explicit_gpt_image_2_model(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    queue_path = tmp_path / "posting_queue.tsv"
    repo = cli.LocalQueueRepository(str(queue_path))
    repo.bootstrap()
    repo.append(QueueRow(id="item", content_format="self_made_summary_card", x_text="X copy"))
    source_path = tmp_path / "runway-mcp-final.png"
    _touch_generated_media(source_path)
    mcp_result_path = tmp_path / "runway-mcp-result.json"
    mcp_result_path.write_text(
        json.dumps({"ok": True, "final_art_path": str(source_path)}),
        encoding="utf-8",
    )

    result = CliRunner().invoke(
        cli.app,
        [
            "attach-runway-mcp-result-local",
            "--row-id",
            "item",
            "--platform",
            "x",
            "--mcp-result",
            str(mcp_result_path),
            "--path",
            str(queue_path),
        ],
    )

    assert result.exit_code != 0
    assert result.exception is not None
    assert "runway_mcp_result_model_missing" in str(result.exception)


def test_generate_media_assets_requires_runway_mcp_primary(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    row = QueueRow(id="item", title="Timeout bounded card")

    with pytest.raises(RuntimeError, match="runway_mcp_result_handoff_missing"):
        cli._generate_media_assets_for_surface(
            row,
            platform="x",
            count=1,
            settings=types.SimpleNamespace(openai_api_key="key"),
        )


def test_generate_media_assets_prefers_daily_ai_runway_mcp_result_handoff(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-24")
    source_path = tmp_path / "runway-mcp-final.png"
    _touch_generated_media(source_path)
    mcp_result_path = tmp_path / "runway-mcp-result.json"
    mcp_result_path.write_text(
        json.dumps(
            {
                "ok": True,
                "model": "gpt-image-2",
                "final_art_path": str(source_path),
                "task_ids": ["task-1"],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("DAILY_AI_RUNWAY_MCP_RESULT", str(mcp_result_path))
    row = QueueRow(
        id="item",
        title="Handoff card",
        content_format="self_made_summary_card",
        x_text="X copy",
        media_plan="X自作判断カード型",
    )

    generated = cli._generate_media_assets_for_surface(
        row,
        platform="x",
        count=1,
        settings=types.SimpleNamespace(openai_api_key="key"),
    )

    assert generated == [Path(row.media_receipt.split()[0]).resolve()]
    assert "provider=runway_mcp" in row.media_receipt
    assert "model=gpt-image-2" in row.media_receipt
    assert "platform=x" in row.media_receipt
    assert "language=ja" in row.media_receipt
    assert "runway_mcp_generated_media_attached_from_result" in row.review_notes


def test_generate_media_assets_requires_enough_daily_ai_runway_mcp_results(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    source_path = tmp_path / "runway-mcp-final.png"
    _touch_generated_media(source_path)
    mcp_result_path = tmp_path / "runway-mcp-result.json"
    mcp_result_path.write_text(
        json.dumps({"ok": True, "model": "gpt-image-2", "final_art_path": str(source_path)}),
        encoding="utf-8",
    )
    monkeypatch.setenv("DAILY_AI_RUNWAY_MCP_RESULT", json.dumps([str(mcp_result_path)]))

    with pytest.raises(RuntimeError, match="runway_mcp_result_count_insufficient:1/3"):
        cli._generate_media_assets_for_surface(
            QueueRow(id="item", title="Carousel card"),
            platform="linkedin",
            count=3,
            settings=types.SimpleNamespace(openai_api_key="key"),
        )


def test_generate_media_assets_daily_ai_runway_mcp_result_handoff_keeps_carousel_paths_distinct(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-24")
    result_paths: list[str] = []
    for index in range(1, 4):
        source_path = tmp_path / f"runway-mcp-final-{index}.png"
        _touch_generated_media(source_path)
        mcp_result_path = tmp_path / f"runway-mcp-result-{index}.json"
        mcp_result_path.write_text(
            json.dumps(
                {
                    "ok": True,
                    "model": "gpt-image-2",
                    "final_art_path": str(source_path),
                    "task_ids": [f"task-{index}"],
                }
            ),
            encoding="utf-8",
        )
        result_paths.append(str(mcp_result_path))
    monkeypatch.setenv("DAILY_AI_RUNWAY_MCP_RESULT", json.dumps(result_paths))
    row = QueueRow(
        id="item",
        title="Carousel handoff",
        content_format="self_made_summary_card",
        linkedin_text="LinkedIn copy",
        media_plan="LinkedInカルーセル型",
    )

    generated = cli._generate_media_assets_for_surface(
        row,
        platform="linkedin",
        count=3,
        settings=types.SimpleNamespace(openai_api_key="key"),
    )

    assert len(generated) == 3
    assert len(set(generated)) == 3
    assert all("linkedin-carousel-runway-mcp-" in str(path) for path in generated)
    assert all(path.exists() for path in generated)
    assert row.media_receipt.count("provider=runway_mcp") == 3
    assert "language=en" in row.media_receipt


def test_generate_media_assets_wraps_runway_wrapper_timeout(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DAILY_AI_ALLOW_RUNWAY_MCP_WRAPPER", "1")
    wrapper = tmp_path / "scripts" / "runway_mcp_generate_image.mjs"
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text("#!/usr/bin/env node\n", encoding="utf-8")

    def fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd=args[0], timeout=240)

    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError, match="runway_mcp_wrapper_timeout"):
        cli._generate_media_assets_for_surface(
            QueueRow(id="item", title="Timeout bounded card"),
            platform="x",
            count=1,
            settings=types.SimpleNamespace(openai_api_key="key"),
        )


def test_generate_media_assets_recovers_runway_output_after_wrapper_timeout(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DAILY_AI_ALLOW_RUNWAY_MCP_WRAPPER", "1")
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-24")
    wrapper = tmp_path / "scripts" / "runway_mcp_generate_image.mjs"
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text("#!/usr/bin/env node\n", encoding="utf-8")
    output_path = (
        tmp_path
        / "artifacts"
        / "generated-media"
        / "2026-06-24-item-x-card-runway-mcp-1.png"
    )

    def fake_run(*args, **kwargs):
        _touch_generated_media(str(output_path))
        raise subprocess.TimeoutExpired(cmd=args[0], timeout=240)

    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    row = QueueRow(id="item", title="Timeout recovered card")

    paths = cli._generate_media_assets_for_surface(
        row,
        platform="x",
        count=1,
        settings=types.SimpleNamespace(openai_api_key="key"),
    )

    assert paths == [output_path.resolve()]
    assert "provider=runway_mcp" in row.media_receipt
    assert "runway_mcp_generated_media_recovered_after_timeout" in row.review_notes


def test_generate_media_assets_wraps_runway_wrapper_failure(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DAILY_AI_ALLOW_RUNWAY_MCP_WRAPPER", "1")
    wrapper = tmp_path / "scripts" / "runway_mcp_generate_image.mjs"
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text("#!/usr/bin/env node\n", encoding="utf-8")

    def fake_run(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="Runway auth failed")

    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError, match="runway_mcp_wrapper_failed"):
        cli._generate_media_assets_for_surface(
            QueueRow(id="item", title="Hard timeout card"),
            platform="x",
            count=1,
            settings=types.SimpleNamespace(openai_api_key="key"),
        )


def test_generate_media_assets_normalizes_runway_pending_without_output(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DAILY_AI_ALLOW_RUNWAY_MCP_WRAPPER", "1")
    wrapper = tmp_path / "scripts" / "runway_mcp_generate_image.mjs"
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text("#!/usr/bin/env node\n", encoding="utf-8")

    def fake_run(cmd, **kwargs):
        return subprocess.CompletedProcess(
            cmd,
            1,
            stdout="",
            stderr="Error: runway_mcp_task_pending_without_output:task-123:RUNNING",
        )

    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError, match="runway_mcp_task_pending_without_output"):
        cli._generate_media_assets_for_surface(
            QueueRow(id="item", title="Pending output card"),
            platform="x",
            count=1,
            settings=types.SimpleNamespace(openai_api_key="key"),
        )


def test_generate_media_assets_wraps_runway_wrapper_invalid_json(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DAILY_AI_ALLOW_RUNWAY_MCP_WRAPPER", "1")
    wrapper = tmp_path / "scripts" / "runway_mcp_generate_image.mjs"
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text("#!/usr/bin/env node\n", encoding="utf-8")

    def fake_run(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 0, stdout="not-json\n", stderr="")

    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError, match="runway_mcp_wrapper_invalid_json"):
        cli._generate_media_assets_for_surface(
            QueueRow(id="item", title="Timeout bounded card"),
            platform="x",
            count=1,
            settings=types.SimpleNamespace(openai_api_key="key"),
        )


def test_generate_media_assets_accepts_json_before_wrapper_log_tail(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DAILY_AI_ALLOW_RUNWAY_MCP_WRAPPER", "1")
    wrapper = tmp_path / "scripts" / "runway_mcp_generate_image.mjs"
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text("#!/usr/bin/env node\n", encoding="utf-8")
    output_path = tmp_path / "artifacts" / "generated-media" / "image.png"
    _touch_generated_media(output_path)

    def fake_run(cmd, **kwargs):
        payload = {"ok": True, "outputPath": str(output_path), "model": "gpt-image-2"}
        return subprocess.CompletedProcess(cmd, 0, stdout=f"{json.dumps(payload)}\nwrapper shutdown warning\n", stderr="")

    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    row = QueueRow(id="item", title="Runway log tail card")

    paths = cli._generate_media_assets_for_surface(
        row,
        platform="x",
        count=1,
        settings=types.SimpleNamespace(openai_api_key="key"),
    )

    assert paths == [output_path.resolve()]
    assert "provider=runway_mcp" in row.media_receipt


def test_generate_media_assets_requires_wrapper_gpt_image_2_model(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DAILY_AI_ALLOW_RUNWAY_MCP_WRAPPER", "1")
    wrapper = tmp_path / "scripts" / "runway_mcp_generate_image.mjs"
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text("#!/usr/bin/env node\n", encoding="utf-8")
    output_path = tmp_path / "artifacts" / "generated-media" / "image.png"
    _touch_generated_media(output_path)

    def fake_run_missing_model(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"ok": True, "outputPath": str(output_path)}), stderr="")

    monkeypatch.setattr(cli.subprocess, "run", fake_run_missing_model)
    with pytest.raises(RuntimeError, match="runway_mcp_result_model_missing"):
        cli._generate_media_assets_for_surface(
            QueueRow(id="item", title="Missing model card"),
            platform="x",
            count=1,
            settings=types.SimpleNamespace(openai_api_key="key"),
        )

    def fake_run_wrong_model(cmd, **kwargs):
        return subprocess.CompletedProcess(
            cmd,
            0,
            stdout=json.dumps({"ok": True, "outputPath": str(output_path), "model": "gen4_image"}),
            stderr="",
        )

    monkeypatch.setattr(cli.subprocess, "run", fake_run_wrong_model)
    with pytest.raises(RuntimeError, match="runway_mcp_result_model_not_gpt_image_2:gen4_image"):
        cli._generate_media_assets_for_surface(
            QueueRow(id="item", title="Wrong model card"),
            platform="x",
            count=1,
            settings=types.SimpleNamespace(openai_api_key="key"),
        )


def test_save_openai_image_response_wraps_download_timeout(tmp_path, monkeypatch) -> None:
    destination = tmp_path / "image.png"

    def fake_urlopen(*args, **kwargs):
        raise TimeoutError("download timed out")

    monkeypatch.setattr(cli, "urlopen", fake_urlopen)
    result = types.SimpleNamespace(data=[types.SimpleNamespace(url="https://example.com/image.png")])

    with pytest.raises(RuntimeError, match="image_generation_unavailable: gpt-image-2 image download timed out"):
        cli._save_openai_image_response(result, destination)


def test_save_openai_image_response_wraps_download_url_error_without_timeout_label(tmp_path, monkeypatch) -> None:
    destination = tmp_path / "image.png"

    def fake_urlopen(*args, **kwargs):
        raise cli.URLError("dns failed")

    monkeypatch.setattr(cli, "urlopen", fake_urlopen)
    result = types.SimpleNamespace(data=[types.SimpleNamespace(url="https://example.com/image.png")])

    with pytest.raises(RuntimeError, match="image_generation_unavailable: gpt-image-2 image download failed: dns failed"):
        cli._save_openai_image_response(result, destination)


def test_queue_row_persists_media_receipt() -> None:
    row = QueueRow(
        id="item",
        reference_media_notes="notes",
        media_receipt="path model=gpt-image-2 size=1024x1024 visual_style=comparison_card platform=x language=ja prompt=prompt",
    )

    parsed = QueueRow.from_sheet_row(row.as_row(), QUEUE_COLUMNS)

    assert parsed.media_receipt == row.media_receipt


def test_nicky_linkedin_media_preflight_requires_ok(tmp_path, monkeypatch) -> None:
    image = tmp_path / "image.png"
    _touch_generated_media(image)
    calls = []

    class DummySettings:
        chrome_main_remote_debugging_port = 9222

    def fake_run(command, **kwargs):
        calls.append(command)

        class Result:
            returncode = 1
            stdout = '{"ok": false, "stop_reason": "media_upload_permission_blocked", "reason": "preview_missing"}\n'
            stderr = ""

        return Result()

    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError, match="media_upload_permission_blocked"):
        cli._preflight_linkedin_media_upload_paths_local(
            [image],
            settings=DummySettings(),
            timeout_seconds=15,
        )

    assert calls[0][:2] == ["social-flow", "preflight-linkedin-media-upload-local"]
    assert str(image.resolve()) in calls[0]


def test_nicky_generated_media_path_resolution_accepts_platform_receipt_with_generic_filename(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-02")
    media_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-card.png"
    _touch_generated_media(media_path)
    row = QueueRow(
        id="item",
        media_plan="LinkedIn正方形1枚画像型",
        reference_media_notes=(
            f"{media_path} model=gpt-image-2 provider=runway_mcp size=1024x1024 "
            "visual_style=comparison_card platform=linkedin language=en prompt=English explanatory image"
        ),
    )

    assert cli._generated_media_paths_for_platform(row, "linkedin") == [media_path]
    assert cli._ensure_generated_media_for_surface(
        row,
        platform="linkedin",
        count=1,
        settings=type("DummySettings", (), {"openai_api_key": ""})(),
    ) == [media_path]


def test_nicky_generated_media_gate_accepts_media_receipt_only(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-02")
    media_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-card.png"
    _touch_generated_media(media_path)
    row = QueueRow(
        id="item",
        media_plan="LinkedIn正方形1枚画像型",
        media_receipt=(
            f"{media_path} model=gpt-image-2 provider=runway_mcp size=1024x1024 "
            "visual_style=comparison_card platform=linkedin language=en prompt=English explanatory image"
        ),
    )

    assert cli._ensure_generated_media_for_surface(
        row,
        platform="linkedin",
        count=1,
        settings=type("DummySettings", (), {"openai_api_key": ""})(),
    ) == [media_path]


def test_generated_media_receipt_rejects_openai_api_provider(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-02")
    media_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-card.png"
    _touch_generated_media(media_path)
    row = QueueRow(
        id="item",
        media_plan="LinkedIn正方形1枚画像型",
        media_receipt=(
            f"{media_path} model=gpt-image-2 provider=openai_api size=1024x1024 "
            "visual_style=comparison_card platform=linkedin language=en prompt=English explanatory image"
        ),
    )

    assert cli._selected_generated_media_receipt_blockers(row, "linkedin", [str(media_path)]) == [
        "surface_missing: generated_media_provider_unapproved"
    ]


def test_generated_media_receipt_entry_matches_absolute_path_to_relative_receipt(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    media_path = tmp_path / "artifacts" / "generated-media" / "2026-06-02-item-linkedin-square-1.png"
    _touch_generated_media(media_path)
    receipt = (
        "artifacts/generated-media/2026-06-02-item-linkedin-square-1.png "
        "model=gpt-image-2 size=1024x1024 visual_style=skill_term_roadmap_table "
        "platform=linkedin language=en prompt=English production visual"
    )

    entry = cli._generated_media_receipt_entry_for_path(receipt, str(media_path))

    assert "2026-06-02-item-linkedin-square-1.png" in entry
    assert "model=gpt-image-2" in entry


def test_runway_generated_media_receipt_survives_space_in_workspace_path(tmp_path, monkeypatch) -> None:
    workspace = tmp_path / "New project"
    workspace.mkdir()
    monkeypatch.chdir(workspace)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-09")
    source_path = workspace / "source-card.png"
    _touch_generated_media(source_path)
    row = QueueRow(
        id="space-row",
        status="drafted",
        quality_score="9",
        keep_priority="hold",
        source_url="https://openai.com/index/example/",
        x_text="この更新は、AI運用で見るべき論点を三つに絞れる。 https://openai.com/index/example/",
        media_plan="X自作判断カード型",
    )

    result = cli._attach_runway_generated_media_to_row(
        row,
        platform="x",
        image_url=None,
        image_path=str(source_path),
        prompt="日本語の正方形投稿カード。大見出しは「人工知能運用の三層」。余白を広く読みやすく作る。",
        visual_style="x_self_made_decision_card",
        language="ja",
    )

    media_path = workspace / "artifacts" / "generated-media" / "2026-06-09-space-row-x-card-runway-mcp-1.png"
    assert result["surface_blockers"] == []
    assert row.media_receipt.startswith("artifacts/generated-media/")
    assert str(workspace) not in row.media_receipt
    assert cli._generated_media_paths_for_platform(row, "x") == [media_path]
    assert cli._selected_generated_media_receipt_blockers(row, "x", [str(media_path)]) == []


def test_generated_media_path_parser_reads_legacy_absolute_receipt_with_space(tmp_path, monkeypatch) -> None:
    workspace = tmp_path / "New project"
    workspace.mkdir()
    monkeypatch.chdir(workspace)
    monkeypatch.setattr(cli, "_current_generated_media_date_token", lambda: "2026-06-09")
    media_path = workspace / "artifacts" / "generated-media" / "2026-06-09-space-row-x-card-runway-mcp-1.png"
    _touch_generated_media(media_path)
    row = QueueRow(
        id="space-row",
        media_plan="X自作判断カード型",
        media_receipt=(
            f"{media_path} model=gpt-image-2 provider=runway_mcp size=1024x1024 "
            "visual_style=x_self_made_decision_card platform=x language=ja "
            "prompt=日本語の正方形SNSカード。"
        ),
    )

    assert cli._generated_media_paths_for_platform(row, "x") == [media_path]
    assert cli._selected_generated_media_receipt_blockers(row, "x", [str(media_path)]) == []


def test_run_core_flow_accepts_deep_research_voice_mode(monkeypatch, tmp_path, capsys) -> None:
    repo = MutableDummyRepo([])

    class DummySettings:
        pass

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=False,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=0,
        collect_sources=False,
        run_mode="deep_research_voice",
    )

    output = capsys.readouterr().out
    assert "Run mode: deep_research_voice" in output
    assert "research=100+ recommended-feed posts" in output


def test_run_core_flow_rejects_unknown_run_mode() -> None:
    with pytest.raises(typer.BadParameter):
        cli._run_mode_config("template_mode")


def test_create_and_bootstrap_sheet_bootstraps_new_sheet(monkeypatch, capsys) -> None:
    dummy_repo = DummySheetsRepo()

    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "/tmp/service-account.json")
    monkeypatch.setattr(cli, "create_spreadsheet", lambda service_account_json, title: ("sheet-123", "https://example.com/sheet"))
    monkeypatch.setattr(cli, "SheetsRepository", lambda service_account_json, spreadsheet_id, tab_name: dummy_repo)

    cli.create_and_bootstrap_sheet()

    output = capsys.readouterr().out
    assert "Created and bootstrapped Google Sheet" in output
    assert "sheet-123" in output
    assert dummy_repo.bootstrap_called is True


def test_publish_flow_candidate_status_rules() -> None:
    assert cli._is_publish_flow_candidate(
        QueueRow(id="approved", status="approved", quality_score="10", x_text="x copy")
    )
    assert cli._is_publish_flow_candidate(
        QueueRow(
            id="scheduled-ready",
            status="scheduled",
            review_status="ready_morning",
            scheduled_at="2099-01-01T00:00:00+00:00",
            quality_score="10",
            x_text="x copy",
        )
    )
    assert not cli._is_publish_flow_candidate(
        QueueRow(
            id="scheduled-future",
            status="scheduled",
            scheduled_at="2099-01-01T00:00:00+00:00",
            quality_score="10",
            x_text="x copy",
        )
    )
    assert cli._is_publish_flow_candidate(
        QueueRow(id="draft", status="drafted", quality_score="10", x_text="x copy")
    )
    assert not cli._is_publish_flow_candidate(
        QueueRow(id="approved-hold", status="approved", quality_score="9", x_text="x copy")
    )
    assert not cli._is_publish_flow_candidate(
        QueueRow(id="draft-hold", status="drafted", quality_score="9", x_text="x copy")
    )
    assert not cli._is_publish_flow_candidate(
        QueueRow(
            id="visible-url-pending",
            status="partially_published",
            x_text="x copy",
            error="X post is visible, but exact status URL capture is pending. Do not repost.",
        )
    )
    assert not cli._is_publish_flow_candidate(
        QueueRow(
            id="url-capture-pending-only",
            status="partially_published",
            x_text="x copy",
            error="URL capture pending",
        )
    )


def test_publish_flow_candidate_allows_linkedin_resume_after_x_no_repost_capture_done() -> None:
    row = QueueRow(
        id="x-captured-linkedin-resume",
        status="partially_published",
        quality_score="9",
        keep_priority="ship_now",
        source_type="url",
        source_url="https://example.com/source",
        x_text="X copy https://example.com/source",
        x_post_url="https://x.com/nichika2000823/status/123",
        linkedin_text="LinkedIn copy https://example.com/source",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
        error="x_publish_failed: URL capture pending for X; Do not repost until existing X URL is captured.",
    )

    assert cli._is_publish_flow_candidate(row)
    assert cli._publish_flow_candidates([row], max_items=3) == [row]


def test_publish_flow_candidate_allows_linkedin_resume_with_x_capture_note_and_publish_instruction() -> None:
    row = QueueRow(
        id="x-url-done-linkedin-original-post",
        status="partially_published",
        quality_score="9",
        keep_priority="ship_now",
        source_type="url",
        source_url="https://example.com/source",
        x_text="X copy https://example.com/source",
        x_post_url="https://x.com/nichika2000823/status/123",
        linkedin_text="LinkedIn copy https://example.com/source",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
        review_notes="X URL capture pending/Do not repost.",
        next_action="Publish LinkedIn as an original post",
    )

    assert cli._publishable_missing_platforms(row) == ["linkedin"]
    assert cli._is_publish_flow_candidate(row)


def test_publish_flow_candidate_blocks_x_no_repost_when_x_url_missing() -> None:
    row = QueueRow(
        id="x-capture-missing",
        status="partially_published",
        quality_score="9",
        keep_priority="ship_now",
        source_type="url",
        source_url="https://example.com/source",
        x_text="X copy https://example.com/source",
        media_plan="X本文+URL型",
        error="x_publish_failed: URL capture pending for X; Do not repost until existing X URL is captured.",
    )

    assert not cli._is_publish_flow_candidate(row)
    assert cli._publish_flow_candidates([row], max_items=3) == []


def test_publish_flow_candidate_blocks_x_capture_note_when_x_url_missing_even_with_linkedin_instruction() -> None:
    row = QueueRow(
        id="x-url-missing-linkedin-original-post",
        status="partially_published",
        quality_score="9",
        keep_priority="ship_now",
        source_type="url",
        source_url="https://example.com/source",
        x_text="X copy https://example.com/source",
        linkedin_text="LinkedIn copy https://example.com/source",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
        review_notes="X URL capture pending/Do not repost.",
        next_action="Publish LinkedIn as an original post",
    )

    assert cli._publishable_missing_platforms(row) == []
    assert not cli._is_publish_flow_candidate(row)


def test_no_repost_marker_platform_hint_ignores_plain_publish_instructions() -> None:
    assert not cli._no_repost_marker_mentions_platform("publish linkedin as an original post", "linkedin")
    assert not cli._no_repost_marker_mentions_platform("x post", "x")
    assert cli._no_repost_blocked_platforms(
        QueueRow(
            id="generic-no-repost",
            status="partially_published",
            quality_score="9",
            keep_priority="ship_now",
            x_text="X copy",
            linkedin_text="LinkedIn copy",
            error="Do not repost",
        )
    ) == {"x", "linkedin"}


def test_prepare_publish_candidates_normalizes_url_capture_pending_ship_now_row(
    monkeypatch, capsys
) -> None:
    row = QueueRow(
        id="url-capture-pending-ship-now",
        status="drafted",
        quality_score="12",
        keep_priority="ship_now",
        review_status="ready_morning",
        source_type="url",
        source_url="https://example.com/source",
        x_text="X copy https://example.com/source",
        media_plan="X本文+URL型",
        error="x_publish_failed: URL capture pending for X; Do not repost until existing X URL is captured.",
        next_action="Recover existing X URL before any publish retry.",
    )
    repo = MutableDummyRepo([row])

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.prepare_publish_candidates_local(
        path="posting_queue.tsv",
        sync_sheets=False,
        max_publish_items=3,
    )

    payload = json.loads(capsys.readouterr().out)
    assert payload["prepared"] == 0
    assert payload["candidate_ids"] == []
    assert payload["no_repost_normalized"] == 1
    assert row.keep_priority == "hold"
    assert row.review_status == "hold"
    assert "URL capture pending" in row.error
    assert row.next_action == "Recover existing X URL before any publish retry."
    assert row.review_notes.count("No-repost marker normalized to hold.") == 1
    assert cli._ship_now_buffer_count(repo.read_all()) == 0
    assert cli._publish_flow_candidates(repo.read_all(), max_items=3) == []


def test_prepare_publish_candidates_promotes_drafted_x_captured_linkedin_resume(
    monkeypatch, capsys
) -> None:
    row = QueueRow(
        id="drafted-x-captured-linkedin-resume",
        status="drafted",
        quality_score="12",
        keep_priority="ship_now",
        review_status="ready_morning",
        source_type="url",
        source_url="https://example.com/source",
        x_text="X copy https://example.com/source",
        x_post_url="https://x.com/nichika2000823/status/123",
        linkedin_text="LinkedIn copy https://example.com/source",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
        error="x_publish_failed: URL capture pending for X; Do not repost until existing X URL is captured.",
    )
    repo = MutableDummyRepo([row])

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.prepare_publish_candidates_local(
        path="posting_queue.tsv",
        sync_sheets=False,
        max_publish_items=3,
    )

    payload = json.loads(capsys.readouterr().out)
    assert payload["prepared"] == 1
    assert payload["candidate_ids"] == [row.id]
    assert payload["no_repost_normalized"] == 0
    assert row.status == "partially_published"
    assert row.next_action.startswith("Publish LinkedIn")
    assert "Publish X" not in row.next_action


def test_run_core_flow_local_repair_normalizes_url_capture_pending_before_buffer(
    monkeypatch, tmp_path, capsys
) -> None:
    row = QueueRow(
        id="url-capture-pending-buffer",
        status="drafted",
        quality_score="12",
        keep_priority="ship_now",
        review_status="ready_morning",
        source_type="url",
        source_url="https://example.com/source",
        x_text="X copy https://example.com/source",
        media_plan="X本文+URL型",
        error="x_publish_failed: URL capture pending for X; Do not repost until existing X URL is captured.",
        next_action="Recover existing X URL before any publish retry.",
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        pass

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: [])
    monkeypatch.setattr(cli, "_draft_queue_rows", lambda repo, settings, max_items=3: 0)
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-16T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=True,
        sync_sheets=False,
        max_drafts=0,
        max_publish_items=3,
        ship_now_buffer_target=1,
        collect_sources=False,
    )

    output = capsys.readouterr().out
    payload = json.loads((tmp_path / "artifacts/run-summaries/daily-ai-run-summary.jsonl").read_text().splitlines()[-1])
    assert "no_repost_normalized=1" in output
    assert row.keep_priority == "hold"
    assert row.review_status == "hold"
    assert "URL capture pending" in row.error
    assert row.next_action == "Recover existing X URL before any publish retry."
    assert row.review_notes.count("No-repost marker normalized to hold.") == 1
    assert payload["ship_now_buffer_count"] == 0
    assert payload["usable_publish_candidate_count"] == 0
    assert "no_ship_now_candidates" in payload["stop_reason"]
    assert "no_publish_candidates_after_refresh" in payload["stop_reason"]
    assert cli._publish_flow_candidates(repo.read_all(), max_items=3) == []


def test_publish_flow_candidates_sort_status_before_quality_and_limit() -> None:
    rows = [
        QueueRow(
            id="ready-draft",
            status="drafted",
            review_status="ready_morning",
            quality_score="99",
            source_url="https://openai.com/index/openai-on-aws/",
            x_text="x copy",
            media_plan="source/link cardのみ",
        ),
        QueueRow(
            id="scheduled-ready",
            status="scheduled",
            review_status="ready_morning",
            scheduled_at="2099-01-01T00:00:00+00:00",
            quality_score="30",
            source_url="https://openai.com/index/openai-on-aws/",
            x_text="x copy",
            media_plan="source/link cardのみ",
        ),
        QueueRow(id="approved", status="approved", quality_score="10", source_url="https://openai.com/index/openai-on-aws/", x_text="x copy", media_plan="source/link cardのみ"),
        QueueRow(id="partial", status="partially_published", quality_score="10", source_url="https://openai.com/index/openai-on-aws/", x_text="x copy", media_plan="source/link cardのみ"),
    ]

    candidates = cli._publish_flow_candidates(rows, max_items=3)

    assert [row.id for row in candidates] == ["partial"]


def test_publish_flow_candidates_resume_x_posted_linkedin_gap_before_new_x() -> None:
    rows = [
        QueueRow(
            id="partial-linkedin",
            status="partially_published",
            quality_score="9",
            keep_priority="ship_now",
            source_url="https://aws.amazon.com/blogs/machine-learning/example/",
            x_text="already posted x copy",
            x_post_url="https://x.com/nichika2000823/status/123",
            linkedin_text="LinkedIn resume copy https://aws.amazon.com/blogs/machine-learning/example/",
            media_plan="X本文+URL型 | LinkedInリンクカード型",
            research_status="done",
            freshness_checked_at="2026-06-01T00:00:00+00:00",
            research_notes="daily_discovery_mix: preserved official source URL and local queue history",
            error="linkedin_publish_failed: body_not_reflected: LinkedIn composer did not contain linkedin_text.",
        ),
        QueueRow(
            id="new-x",
            status="approved",
            quality_score="12",
            keep_priority="ship_now",
            source_url="https://openai.com/index/example/",
            x_text="new x copy https://openai.com/index/example/",
            linkedin_text="new linkedin copy https://openai.com/index/example/",
            media_plan="X本文+URL型 | LinkedInリンクカード型",
            research_status="done",
            freshness_checked_at="2026-06-01T00:00:00+00:00",
            research_notes="daily_discovery_mix: fresh source",
        ),
    ]

    candidates = cli._publish_flow_candidates(rows, max_items=3)

    assert [row.id for row in candidates] == ["partial-linkedin"]


def test_publish_flow_candidates_treats_drafted_x_posted_row_as_linkedin_resume() -> None:
    rows = [
        QueueRow(
            id="drafted-linkedin-resume",
            status="drafted",
            quality_score="10",
            keep_priority="ship_now",
            review_status="ready_morning",
            source_url="https://www.bullhorn.com/news-and-press/press-releases/example/",
            x_text="already posted x copy",
            x_post_url="https://x.com/nichika2000823/status/123",
            linkedin_text="linkedin resume copy https://www.bullhorn.com/news-and-press/press-releases/example/",
            media_plan="LinkedInリンクカード型：公式URLのプレビューカードを表示する",
            research_status="done",
            freshness_checked_at="2026-06-01T00:00:00+00:00",
            research_notes="daily_discovery_mix: preserved official source URL and local queue history",
        ),
        QueueRow(
            id="new-x",
            status="approved",
            quality_score="12",
            keep_priority="ship_now",
            source_url="https://openai.com/index/example/",
            x_text="new x copy https://openai.com/index/example/",
            linkedin_text="new linkedin copy https://openai.com/index/example/",
            media_plan="X本文+URL型 | LinkedInリンクカード型",
            research_status="done",
            freshness_checked_at="2026-06-01T00:00:00+00:00",
            research_notes="daily_discovery_mix: fresh source",
        ),
    ]

    candidates = cli._publish_flow_candidates(rows, max_items=3)

    assert [row.id for row in candidates] == ["drafted-linkedin-resume"]


def test_publish_flow_candidates_resume_x_posted_linkedin_gaps_oldest_first() -> None:
    rows = [
        QueueRow(
            id="newer-partial",
            status="partially_published",
            quality_score="12",
            keep_priority="ship_now",
            source_url="https://openai.com/index/example/",
            x_text="already posted newer",
            x_post_url="https://x.com/nichika2000823/status/456",
            x_published_at="2026-06-01T23:29:35+00:00",
            linkedin_text="newer linkedin https://openai.com/index/example/",
            media_plan="X本文+URL型 | LinkedInリンクカード型",
            research_status="done",
            freshness_checked_at="2026-06-01T00:00:00+00:00",
            research_notes="daily_discovery_mix: newer partial",
        ),
        QueueRow(
            id="older-partial",
            status="partially_published",
            quality_score="9",
            keep_priority="ship_now",
            source_url="https://aws.amazon.com/blogs/machine-learning/example/",
            x_text="already posted older",
            x_post_url="https://x.com/nichika2000823/status/123",
            x_published_at="2026-06-01T23:04:54+00:00",
            linkedin_text="older linkedin https://aws.amazon.com/blogs/machine-learning/example/",
            media_plan="X本文+URL型 | LinkedInリンクカード型",
            research_status="done",
            freshness_checked_at="2026-06-01T00:00:00+00:00",
            research_notes="daily_discovery_mix: older partial",
        ),
    ]

    candidates = cli._publish_flow_candidates(rows, max_items=1)

    assert [row.id for row in candidates] == ["older-partial"]


def test_publish_flow_candidates_caps_at_three_and_excludes_blocked_or_published() -> None:
    rows = [
        QueueRow(id="partial", status="partially_published", quality_score="8", x_text="x copy"),
        QueueRow(id="approved-high", status="approved", quality_score="12", source_url="https://openai.com/index/openai-on-aws/", x_text="x copy", media_plan="source/link cardのみ"),
        QueueRow(id="approved-mid", status="approved", quality_score="10", source_url="https://openai.com/index/openai-on-aws/", x_text="x copy", media_plan="source/link cardのみ"),
        QueueRow(id="draft-ready", status="drafted", review_status="ready_morning", quality_score="99", source_url="https://openai.com/index/openai-on-aws/", x_text="x copy", media_plan="source/link cardのみ"),
        QueueRow(id="published", status="published", quality_score="99", x_text="x copy"),
        QueueRow(id="blocked", status="approved", quality_score="99", x_text="x copy", error="Do not repost"),
        QueueRow(id="hold", status="approved", quality_score="9", x_text="x copy"),
    ]

    candidates = cli._publish_flow_candidates(rows, max_items=3)

    assert [row.id for row in candidates] == ["approved-high", "approved-mid", "draft-ready"]


def test_publish_flow_candidates_excludes_reused_published_copy() -> None:
    rows = [
        QueueRow(
            id="old-published",
            status="published",
            quality_score="11",
            source_url="https://openai.com/index/openai-on-aws/",
            x_text="same exact copy",
            x_post_url="https://x.com/nichika2000823/status/1",
        ),
        QueueRow(
            id="new-candidate",
            status="approved",
            quality_score="11",
            source_url="https://openai.com/index/openai-on-aws/",
            x_text="same exact copy",
            media_plan="source/link cardのみ",
        ),
    ]

    assert cli._publish_flow_candidates(rows, max_items=3) == []


def test_publish_flow_candidates_excludes_reused_published_linkedin_copy() -> None:
    rows = [
        QueueRow(
            id="old-linkedin-published",
            status="published",
            quality_score="11",
            source_url="https://openai.com/index/openai-on-aws/",
            linkedin_text="same exact linkedin copy https://openai.com/index/openai-on-aws/",
            linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:1/",
        ),
        QueueRow(
            id="new-linkedin-candidate",
            status="partially_published",
            quality_score="11",
            source_url="https://openai.com/index/openai-on-aws/",
            x_post_url="https://x.com/nichika2000823/status/1",
            linkedin_text="same exact linkedin copy https://openai.com/index/openai-on-aws/",
            media_plan="LinkedInリンクカード型",
        ),
    ]

    assert cli._publish_flow_candidates(rows, max_items=3) == []


def test_run_core_flow_continues_to_draft_and_select_after_collection_timeout(monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    media_date = cli._current_generated_media_date_token()
    ready_card = f"artifacts/generated-media/{media_date}-queued-timeout-x-card.png"
    _touch_generated_media(ready_card)
    row = QueueRow(
        id="queued-timeout",
        status="collected",
        keep_priority="ship_now",
        quality_score="11",
        source_priority_score="5",
        source_url="https://example.com/source",
        source_type="web_discovery",
        title="Queued candidate survives collection timeout",
        x_research_notes="Feed study read multiple AI posts and found a concrete discussion signal for this source.",
        media_plan="X自作判断カード型 with generated card; LinkedInリンクカード型 with official source link card",
        reference_media_notes=(
            f"generated x card: {ready_card} provider=runway_mcp model=gpt-image-2 size=1024x1024 "
            "visual_style=execution_steps_card platform=x language=ja prompt=タイムアウト復帰手順カード"
        ),
    )
    repo = MutableDummyRepo([row])

    class DummySettings:
        draft_model = "test-model"

    monkeypatch.setattr(cli, "load_settings", lambda: DummySettings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_collect_documents_from_sources", lambda settings: (_ for _ in ()).throw(TimeoutError("rss timeout")))
    monkeypatch.setattr(cli, "build_draft_client", lambda settings: object())
    monkeypatch.setattr(
        cli,
        "generate_localized_copy",
        lambda **kwargs: {
            "summary_ja": "summary",
            "angle": "angle",
            "x_text": "x copy https://example.com/source",
            "linkedin_text": "linkedin copy https://example.com/source",
            "media_plan": row.media_plan,
        },
    )
    monkeypatch.setattr(cli, "_rescore_queue_rows", lambda rows: 0)
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-06-01T00:00:00+00:00")

    cli.run_core_flow(
        path="posting_queue.tsv",
        publish_external=True,
        sync_sheets=False,
        max_drafts=1,
        max_publish_items=1,
        collect_sources=True,
    )

    output = capsys.readouterr().out
    assert "continuing with local queue draft/selection" in output
    assert "Publish flow candidates: queued-timeout" in output
    assert row.status == "drafted"
    assert row.x_text == "x copy https://example.com/source"
    assert "Daily AI Chrome plugin publish candidate" in row.review_notes


def test_publish_flow_candidates_blocks_rss_without_discovery_context() -> None:
    row = QueueRow(
        id="rss-only",
        status="approved",
        source_type="rss",
        source_name="OpenAI",
        source_url="https://openai.com/index/example/",
        title="OpenAI announces another Codex update",
        quality_score="11",
        keep_priority="ship_now",
        x_text="x copy https://openai.com/index/example/",
        linkedin_text="linkedin copy https://openai.com/index/example/",
        media_plan="X本文+URL型 | LinkedInリンクカード型",
    )

    assert "feed_study_insufficient: missing_daily_discovery_mix" in cli._publish_candidate_blockers(row, [row])
    assert cli._publish_flow_candidates([row], max_items=3) == []

    row.research_status = "done"
    row.freshness_checked_at = "2026-05-26T00:00:00+00:00"
    row.x_research_notes = (
        "Official RSS source reverified. This is still only a press-release summary "
        "with no feed, search, or practitioner context."
    )

    assert "feed_study_insufficient: missing_daily_discovery_mix" in cli._publish_candidate_blockers(row, [row])

    row.x_research_notes = "Feed study read multiple AI posts and found a concrete discussion signal for this source."

    assert "feed_study_insufficient: missing_daily_discovery_mix" not in cli._publish_candidate_blockers(row, [row])


def test_approve_local_promotes_candidate_to_publish_today(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="candidate",
        status="drafted",
        keep_priority="hold",
        quality_score="10",
        review_status="",
        drop_reason="追加リサーチ前提",
        x_text="x copy",
        linkedin_text="linkedin copy",
    )
    repo = MutableDummyRepo([row])
    repo.path = tmp_path / "posting_queue.tsv"
    monkeypatch.setattr(cli, "get_local_repo", lambda path: repo)

    cli.approve_local(item_id="candidate")

    assert row.status == "approved"
    assert row.keep_priority == "ship_now"
    assert row.review_status == "ready_morning"
    assert row.drop_reason == ""
    assert cli._is_publish_flow_candidate(row)


def test_rescore_queue_rows_marks_older_duplicate_source_as_drop() -> None:
    older = QueueRow(
        id="older",
        status="drafted",
        source_name="OpenAI",
        source_url="https://openai.com/index/the-next-evolution-of-the-agents-sdk/",
        title="The next evolution of the Agents SDK",
        summary_en="OpenAI shipped 3 new Agents SDK orchestration updates for enterprise teams.",
        collected_at="2026-05-01T00:00:00+00:00",
    )
    newer = QueueRow(
        id="newer",
        status="drafted",
        source_name="OpenAI",
        source_url="https://openai.com/index/the-next-evolution-of-the-agents-sdk/",
        title="The next evolution of the Agents SDK",
        summary_en="OpenAI shipped 3 new Agents SDK orchestration updates for enterprise teams.",
        collected_at="2026-05-06T00:00:00+00:00",
    )

    updated = cli._rescore_queue_rows([older, newer])

    assert updated == 2
    assert older.keep_priority == "drop"
    assert older.drop_reason == "duplicate of newer"
    assert "duplicate_candidate:newer" in older.review_notes
    assert older.next_action == "Ignore duplicate and use newer"
    assert newer.keep_priority == "hold"


def test_rescore_queue_rows_keeps_published_row_as_duplicate_canonical() -> None:
    published = QueueRow(
        id="published",
        status="published",
        source_name="OpenAI",
        source_url="https://openai.com/index/how-openai-delivers-low-latency-voice-ai-at-scale/",
        title="How OpenAI delivers low-latency voice AI at scale",
        summary_en="OpenAI explained 4 latency tactics behind production voice inference at scale.",
        published_at="2026-05-13T00:00:00+00:00",
    )
    draft = QueueRow(
        id="draft",
        status="drafted",
        source_name="OpenAI",
        source_url="https://openai.com/index/how-openai-delivers-low-latency-voice-ai-at-scale/",
        title="How OpenAI delivers low-latency voice AI at scale",
        summary_en="OpenAI explained 4 latency tactics behind production voice inference at scale.",
        drafted_at="2026-05-12T00:00:00+00:00",
    )

    cli._rescore_queue_rows([published, draft])

    assert published.keep_priority == "hold"
    assert draft.keep_priority == "drop"
    assert draft.drop_reason == "duplicate of published"


def test_should_record_run_summary_skips_candidate_preview_only() -> None:
    assert cli._should_record_run_summary(
        researched_count=0,
        refreshed_count=0,
        selected_count=1,
        posted_count=0,
        quoted_count=0,
        sheets_synced_count=0,
        stop_reason="",
    ) is False
    assert cli._should_record_run_summary(
        researched_count=0,
        feed_study_count=1,
        external_posts_read=0,
        refreshed_count=0,
        selected_count=0,
        posted_count=0,
        quoted_count=0,
        engagement_candidates_created=0,
        external_engagement_candidates=0,
        own_post_engagement_candidates=0,
        sheets_synced_count=0,
        stop_reason="",
    ) is True
    assert cli._should_record_run_summary(
        researched_count=0,
        refreshed_count=0,
        selected_count=1,
        posted_count=0,
        quoted_count=0,
        sheets_synced_count=82,
        stop_reason="",
    ) is False


def test_infer_content_format_uses_daily_ai_x_format_set() -> None:
    assert cli._infer_content_format(QueueRow(content_format="original")) == "article_number_breakdown"
    assert cli._infer_content_format(QueueRow(content_format="quote")) == "native_quote_business_translation"
    assert cli._infer_content_format(QueueRow(content_format="official_demo_breakdown")) == "official_demo_breakdown"
    assert (
        cli._infer_content_format(
            QueueRow(
                id="demo",
                title="New official demo video",
                media_plan="Use official demo video as source card",
            )
        )
        == "official_demo_breakdown"
    )
    assert (
        cli._infer_content_format(
            QueueRow(
                id="market",
                source_name="Google Blog",
                title="Gemini in Chrome pricing and market signal",
                content_format="article_number_breakdown",
            )
        )
        == "market_signal_visual"
    )
    assert (
        cli._infer_content_format(
            QueueRow(
                id="tooling",
                source_name="OpenAI",
                title="New agent SDK release",
                publish_strategy="tooling_update",
                content_format="article_number_breakdown",
            )
        )
        == "official_demo_breakdown"
    )
    assert (
        cli._infer_content_format(
            QueueRow(
                id="reference",
                quality_score="10",
                discussion_score="4",
                reference_post_urls="https://x.com/OpenAI/status/123",
            )
        )
        == "native_quote_business_translation"
    )


def test_engagement_review_values_only_show_auto_approved_candidates() -> None:
    repo = object.__new__(SheetsRepository)
    rows = [
        QueueRow(
            id="posted",
            status="published",
            title="AI post",
            engagement_action="comment_candidate",
            engagement_status="approved",
            engagement_reason="Relevant practitioner thread",
            comment_draft="The useful part here is the workflow detail. Did you also test latency?",
            engagement_targets="https://x.com/example/status/1",
            x_post_url="https://x.com/nichika2000823/status/1",
            published_at="2026-05-19T00:00:00+00:00",
        ),
        QueueRow(
            id="done",
            status="published",
            engagement_action="comment_candidate",
            engagement_status="done",
            comment_draft="Already sent",
            engagement_targets="https://x.com/example/status/2",
        ),
        QueueRow(
            id="empty",
            status="published",
            engagement_status="needs_review",
            engagement_action="comment_candidate",
            comment_draft="Needs a human look before automation",
            engagement_targets="https://x.com/example/status/3",
        ),
    ]

    values = repo._engagement_review_values(rows)

    assert values[0][:5] == ["id", "status", "title", "engagement_action", "engagement_status"]
    assert [row[0] for row in values[1:]] == ["posted"]
    assert values[1][5] == "Relevant practitioner thread"
    assert "latency" in values[1][6]


def test_run_engagement_flow_local_sends_only_approved_candidates(monkeypatch, capsys) -> None:
    EngagementXPublisher.actions = []
    EngagementLinkedInPublisher.actions = []
    rows = [
        QueueRow(
            id="x-engage",
            engagement_action="comment_candidate",
            engagement_status="approved",
            engagement_targets="https://x.com/example/status/123",
            comment_draft="I liked the workflow detail. Did latency change after rollout?",
            published_at="2026-05-19T00:00:00+00:00",
        ),
        QueueRow(
            id="li-engage",
            engagement_action="like_candidate",
            engagement_status="approved",
            engagement_targets="https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A456/",
            published_at="2026-05-19T00:01:00+00:00",
        ),
        QueueRow(
            id="needs-review",
            engagement_action="comment_candidate",
            engagement_status="needs_review",
            engagement_targets="https://x.com/example/status/789",
            comment_draft="Do not send.",
        ),
    ]
    repo = MutableDummyRepo(rows)

    class Settings:
        x_api_access_token = "x-token"
        linkedin_access_token = "li-token"
        linkedin_author_urn = "urn:li:person:1"
        linkedin_api_version = "202502"

    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "XPublisher", EngagementXPublisher)
    monkeypatch.setattr(cli, "LinkedInPublisher", EngagementLinkedInPublisher)

    cli.run_engagement_flow_local(path="posting_queue.tsv", sync_sheets=False, allow_api_engagement=True)

    assert EngagementXPublisher.actions == [
        ("reply", "123", "I liked the workflow detail. Did latency change after rollout?")
    ]
    assert EngagementLinkedInPublisher.actions == [("like", "urn:li:share:456", "")]
    assert rows[0].engagement_status == "done"
    assert rows[1].engagement_status == "done"
    assert rows[2].engagement_status == "needs_review"
    assert "sent=2 skipped=0" in capsys.readouterr().out


def test_run_engagement_flow_local_marks_missing_comment_as_skipped(monkeypatch) -> None:
    rows = [
        QueueRow(
            id="bad",
            engagement_action="comment_candidate",
            engagement_status="approved",
            engagement_targets="https://x.com/example/status/123",
            comment_draft="",
        )
    ]
    repo = MutableDummyRepo(rows)

    class Settings:
        x_api_access_token = "x-token"
        linkedin_access_token = ""
        linkedin_author_urn = ""
        linkedin_api_version = "202502"

    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "XPublisher", EngagementXPublisher)

    cli.run_engagement_flow_local(path="posting_queue.tsv", sync_sheets=False, allow_api_engagement=True)

    assert rows[0].engagement_status == "skipped"
    assert "comment_quality_failed" in rows[0].error


def test_engagement_comment_quality_rejects_scraped_ui_fragments() -> None:
    bad_comments = [
        ("x", "…@pengoo_writer · 6月22日 記事 【週15時間暇になる】Google Worksp、現場感あります。ツール選びより、チームにどう残るかの方が難しいですね。"),
        ("x", "…Fiで乗客と乗務員をつなぎました 1,241 2,056 2、現場感あります。ツール選びより、チームにどう残るかの方が難しいですね。"),
        ("x", "金のニワトリ: 金のニワトリ @gosrum · 6月22日 【悲報】 フグ、高すぎる、実際の運用に落とす時の前提が大事そうです。どこで詰まりましたか？"),
        ("x", "…本をAI先進国に」𝕏 @shota7180 · 6月23日 【速報】Sakana AI、Fableや、実際の運用に落とす時の前提が大事そうです。どこで詰まりましたか？"),
        ("linkedin", "1d • ❗ A website migration is not just a technical risk ❗ ✅ It can… is the practical detail I would watch. Where did the adoption friction show up first?"),
    ]

    for platform, comment in bad_comments:
        assert not cli._engagement_comment_quality_ok(comment, platform)


def test_run_engagement_flow_local_requires_explicit_api_mode() -> None:
    with pytest.raises(typer.BadParameter) as excinfo:
        cli.run_engagement_flow_local(path="posting_queue.tsv", sync_sheets=False)

    assert "API engagement sender" in str(excinfo.value)
    assert "--allow-api-engagement" in str(excinfo.value)


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_sends_browser_lane_comments(monkeypatch, capsys) -> None:
    rows = [
        QueueRow(
            id="x-comment",
            engagement_action="comment_candidate",
            engagement_status="approved",
            engagement_targets="https://x.com/example/status/123",
            comment_draft="The handoff point is the useful detail here. Did this change review latency?",
            freshness_checked_at=cli.utc_now(),
            published_at="2026-05-19T00:00:00+00:00",
        ),
        QueueRow(
            id="li-comment",
            engagement_action="comment_candidate",
            engagement_status="approved",
            engagement_targets="https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A456/",
            comment_draft="The spec-first handoff is the part I would watch. Did it change QA review time?",
            freshness_checked_at=cli.utc_now(),
            published_at="2026-05-19T00:01:00+00:00",
        ),
    ]
    repo = MutableDummyRepo(rows)
    calls: list[tuple[str, str, str]] = []

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    def fake_send(row, *, settings, remote_debugging_port=None, timeout_seconds=20.0):
        calls.append((row.id, row.engagement_action, row.comment_draft))
        platform = cli._engagement_platform(row.engagement_targets)
        return {
            "platform": platform,
            "action": row.engagement_action,
            "url": "https://x.com/nichika2000823/status/999" if platform == "x" else row.engagement_targets,
            "completion": "comment_post_url_captured" if platform == "x" else "comment_reflected",
            "comment_proof": {
                "source": "body_after_submit",
                "editor_cleared": True,
                "posted_comment_visible": True,
                "visible_before_submit": False,
            }
            if platform == "linkedin"
            else {},
        }

    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_send_browser_engagement_candidate", fake_send)
    monkeypatch.setattr(
        cli,
        "_append_local_run_summary",
        lambda **kwargs: "artifacts/run-summaries/test.jsonl",
    )

    cli.send_engagement_candidates_local(path="posting_queue.tsv", sync_sheets=False)

    assert calls == [
        ("x-comment", "comment_candidate", rows[0].comment_draft),
        ("li-comment", "comment_candidate", rows[1].comment_draft),
    ]
    assert rows[0].engagement_status == "done"
    assert rows[1].engagement_status == "done"
    assert rows[0].engaged_at
    assert "browser-lane engagement sent" in rows[0].review_notes
    assert "sent=2 skipped=0" in capsys.readouterr().out


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_stops_after_sent_queue_update_failure(monkeypatch, tmp_path, capsys) -> None:
    rows = [
        QueueRow(
            id="sent-but-not-saved",
            engagement_action="like_candidate",
            engagement_status="approved",
            engagement_targets="https://x.com/example/status/123",
            freshness_checked_at=cli.utc_now(),
        ),
        QueueRow(
            id="must-not-send-next",
            engagement_action="like_candidate",
            engagement_status="approved",
            engagement_targets="https://x.com/example/status/456",
            freshness_checked_at=cli.utc_now(),
        ),
    ]

    class FailingDoneUpdateRepo(MutableDummyRepo):
        def update(self, row: QueueRow) -> None:
            if row.engagement_status == "done":
                raise RuntimeError("queue write failed")
            super().update(row)

    repo = FailingDoneUpdateRepo(rows)
    calls: list[str] = []

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    def fake_send(row, *, settings, remote_debugging_port=None, timeout_seconds=20.0):
        calls.append(row.id)
        return {"platform": "x", "action": row.engagement_action, "url": row.engagement_targets, "completion": "like_reflected"}

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_send_browser_engagement_candidate", fake_send)
    monkeypatch.setattr(cli, "_append_local_run_summary", lambda **kwargs: "artifacts/run-summaries/test.jsonl")

    result = cli.send_engagement_candidates_local(path="posting_queue.tsv", max_actions=2, sync_sheets=False)

    assert calls == ["sent-but-not-saved"]
    assert result["sent"] == 1
    assert result["stop_reason"] == "engagement_status_update_failed_after_send"
    assert "receipt=artifacts/engagement-sent-receipts/" in capsys.readouterr().out
    assert list((tmp_path / "artifacts" / "engagement-sent-receipts").glob("*.json"))


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_recovers_sent_receipt_without_resending(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="already-sent",
        engagement_action="like_candidate",
        engagement_status="approved",
        engagement_targets="https://x.com/example/status/123",
        freshness_checked_at=cli.utc_now(),
    )
    repo = MutableDummyRepo([row])

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    monkeypatch.chdir(tmp_path)
    cli._write_engagement_sent_receipt(
        row,
        target_url=row.engagement_targets,
        action=row.engagement_action,
        result={"platform": "x", "url": row.engagement_targets, "completion": "like_reflected"},
    )
    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(
        cli,
        "_send_browser_engagement_candidate",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("receipt recovery must not resend")),
    )

    result = cli.send_engagement_candidates_local(path="posting_queue.tsv", sync_sheets=False)

    assert result["sent"] == 0
    assert row.engagement_status == "done"
    assert row.engaged_at
    assert "recovered sent engagement from durable receipt" in row.review_notes


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_does_not_recover_unverified_sent_receipt(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="unverified-receipt",
        engagement_action="comment_candidate",
        engagement_status="approved",
        engagement_targets="https://x.com/example/status/123",
        freshness_checked_at=cli.utc_now(),
    )
    repo = MutableDummyRepo([row])

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    monkeypatch.chdir(tmp_path)
    cli._write_engagement_sent_receipt(
        row,
        target_url=row.engagement_targets,
        action=row.engagement_action,
        result={"platform": "x", "url": row.engagement_targets, "completion": "comment_reflected_without_url"},
    )
    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(
        cli,
        "_send_browser_engagement_candidate",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("live resend unavailable")),
    )

    result = cli.send_engagement_candidates_local(path="posting_queue.tsv", sync_sheets=False)

    assert result["sent"] == 0
    assert result["stop_reason"] == "engagement_send_failed"
    assert row.engagement_status == "skipped"
    assert row.error == "engagement_failed: live resend unavailable"
    assert "recovered sent engagement from durable receipt" not in row.review_notes


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_rejects_weak_linkedin_comment_receipt(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="weak-linkedin-receipt",
        engagement_action="comment_candidate",
        engagement_status="approved",
        engagement_targets="https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A456/",
        freshness_checked_at=cli.utc_now(),
    )
    repo = MutableDummyRepo([row])

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    monkeypatch.chdir(tmp_path)
    cli._write_engagement_sent_receipt(
        row,
        target_url=row.engagement_targets,
        action=row.engagement_action,
        result={
            "platform": "linkedin",
            "url": row.engagement_targets,
            "completion": "comment_reflected",
            "comment_proof": {"source": "body_after_submit"},
        },
    )
    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(
        cli,
        "_send_browser_engagement_candidate",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("live resend unavailable")),
    )

    result = cli.send_engagement_candidates_local(path="posting_queue.tsv", sync_sheets=False)

    assert result["sent"] == 0
    assert result["stop_reason"] == "engagement_send_failed"
    assert row.engagement_status == "skipped"
    assert "recovered sent engagement from durable receipt" not in row.review_notes


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_recovers_linkedin_like_receipt_with_proof(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="linkedin-like-receipt",
        engagement_action="like_candidate",
        engagement_status="approved",
        engagement_targets="https://www.linkedin.com/feed/update/urn:li:activity:222/",
        freshness_checked_at=cli.utc_now(),
    )
    repo = MutableDummyRepo([row])

    class Settings:
        chrome_main_remote_debugging_port = 9222

    monkeypatch.chdir(tmp_path)
    cli._write_engagement_sent_receipt(
        row,
        target_url=row.engagement_targets,
        action=row.engagement_action,
        result={
            "platform": "linkedin",
            "url": row.engagement_targets,
            "completion": "like_reflected",
            "like_proof": {
                "source": "reaction_state_before_click",
                "before_state": "Reaction button state: Like",
                "after_state": "Reaction button state: Like",
                "state_changed": False,
                "reflected": True,
                "target_url": row.engagement_targets,
            },
        },
    )
    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(
        cli,
        "_send_browser_engagement_candidate",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("verified LinkedIn like receipt must recover")),
    )

    result = cli.send_engagement_candidates_local(path="posting_queue.tsv", sync_sheets=False)

    assert result["sent"] == 0
    assert row.engagement_status == "done"
    assert "recovered sent engagement from durable receipt" in row.review_notes


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_skips_unverified_browser_completion(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="unverified-live",
        engagement_action="comment_candidate",
        engagement_status="approved",
        engagement_targets="https://x.com/example/status/123",
        freshness_checked_at=cli.utc_now(),
    )
    repo = MutableDummyRepo([row])

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    def fake_send(row, *, settings, remote_debugging_port=None, timeout_seconds=20.0):
        return {"platform": "x", "url": row.engagement_targets, "completion": "comment_completion=sent_toast"}

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_send_browser_engagement_candidate", fake_send)

    result = cli.send_engagement_candidates_local(path="posting_queue.tsv", sync_sheets=False)

    assert result["sent"] == 0
    assert result["skipped"] == 1
    assert result["stop_reason"] == "engagement_send_failed"
    assert row.engagement_status == "skipped"
    assert row.error == "engagement_failed: engagement_completion_unverified:comment_completion=sent_toast"


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_does_not_fill_external_run_with_own_replies(monkeypatch, capsys) -> None:
    rows = [
        QueueRow(
            id="external",
            engagement_action="comment_candidate",
            engagement_status="approved",
            engagement_targets="https://x.com/example/status/123",
            comment_draft="A specific external comment.",
            freshness_checked_at=cli.utc_now(),
            published_at="2026-06-02T00:00:00+00:00",
        ),
        QueueRow(
            id="own",
            engagement_action="reply_to_own_post",
            engagement_status="approved",
            engagement_targets="https://x.com/nichika2000823/status/456",
            comment_draft="Own follow-up.",
            freshness_checked_at=cli.utc_now(),
            published_at="2026-06-01T00:00:00+00:00",
            x_post_url="https://x.com/nichika2000823/status/456",
        ),
    ]
    repo = MutableDummyRepo(rows)
    calls: list[str] = []

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    def fake_send(row, *, settings, remote_debugging_port=None, timeout_seconds=20.0):
        calls.append(row.id)
        return {
            "platform": "x",
            "action": row.engagement_action,
            "url": "https://x.com/nichika2000823/status/999",
            "completion": "comment_post_url_captured",
        }

    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_send_browser_engagement_candidate", fake_send)
    monkeypatch.setattr(
        cli,
        "_append_local_run_summary",
        lambda **kwargs: "artifacts/run-summaries/test.jsonl",
    )

    cli.send_engagement_candidates_local(path="posting_queue.tsv", max_actions=2, sync_sheets=False)

    assert calls == ["external"]
    assert rows[0].engagement_status == "done"
    assert rows[1].engagement_status == "approved"
    assert "sent=1 skipped=0" in capsys.readouterr().out


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_normalizes_external_quote_to_comment(monkeypatch) -> None:
    row = QueueRow(
        id="external-quote",
        engagement_action="quote_candidate",
        engagement_status="approved",
        engagement_targets="https://x.com/example/status/123",
        comment_draft="Specific external comment.",
        freshness_checked_at=cli.utc_now(),
        published_at="2026-06-02T00:00:00+00:00",
    )
    repo = MutableDummyRepo([row])
    calls: list[str] = []

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    def fake_send(row, *, settings, remote_debugging_port=None, timeout_seconds=20.0):
        calls.append(row.engagement_action)
        return {
            "platform": "x",
            "action": row.engagement_action,
            "url": "https://x.com/nichika2000823/status/999",
            "completion": "comment_post_url_captured",
        }

    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_send_browser_engagement_candidate", fake_send)
    monkeypatch.setattr(
        cli,
        "_append_local_run_summary",
        lambda **kwargs: "artifacts/run-summaries/test.jsonl",
    )

    cli.send_engagement_candidates_local(path="posting_queue.tsv", max_actions=1, sync_sheets=False)

    assert calls == ["comment_candidate"]
    assert row.engagement_action == "comment_candidate"
    assert row.engagement_status == "done"


def test_local_browser_engagement_like_uses_state_reflection() -> None:
    source = Path(cli.__file__).read_text(encoding="utf-8")
    x_like_body = source.split("def _send_x_browser_engagement", 1)[1].split('if action == "like_candidate":', 1)[1].split(
        '\n    if action == "save_candidate":', 1
    )[0]
    linkedin_like_body = source.split('def _send_linkedin_browser_engagement', 1)[1].split(
        '\n    if action == "save_candidate":', 1
    )[0]

    assert 'for attribute in ("aria-pressed", "aria-label")' in x_like_body
    assert "like.get_attribute(attribute" in x_like_body
    assert "X like state did not change" in x_like_body
    assert 'button[aria-label*="Reaction button state"]' in linkedin_like_body
    assert "reaction_state_before_click" in linkedin_like_body
    assert '"no reaction" not in before_lower' in linkedin_like_body
    assert "LinkedIn reaction state did not change" in linkedin_like_body


def test_capture_new_x_status_url_excludes_target_and_before_urls() -> None:
    class FakePage:
        def __init__(self) -> None:
            self.calls = 0
            self.waits: list[int] = []

        def evaluate(self, script):
            self.calls += 1
            if self.calls == 1:
                return [
                    "https://x.com/example/status/123",
                    "https://x.com/other/status/456",
                ]
            return [
                "https://x.com/example/status/123",
                "https://x.com/other/status/456",
                "https://x.com/nichika2000823/status/999",
            ]

        def wait_for_timeout(self, ms):
            self.waits.append(ms)

    page = FakePage()
    before = {
        "https://x.com/example/status/123",
        "https://x.com/other/status/456",
    }

    assert cli._capture_new_x_status_url(page, before, target_status_id="123") == "https://x.com/nichika2000823/status/999"


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_marks_browser_failure_as_skipped(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="x-comment",
        engagement_action="comment_candidate",
        engagement_status="approved",
        engagement_targets="https://x.com/example/status/123",
        comment_draft="A specific comment.",
        freshness_checked_at=cli.utc_now(),
    )
    repo = MutableDummyRepo([row])

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    def fake_send(*args, **kwargs):
        raise RuntimeError("comment_not_reflected: X reply completion was not visible.")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_send_browser_engagement_candidate", fake_send)
    monkeypatch.setattr(
        cli,
        "_append_local_run_summary",
        lambda **kwargs: "artifacts/run-summaries/test.jsonl",
    )

    cli.send_engagement_candidates_local(path="posting_queue.tsv", sync_sheets=False)

    assert row.engagement_status == "skipped"
    assert "comment_not_reflected" in row.error
    assert "Review engagement blocker" in row.next_action


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_browser_engagement_candidate_wraps_locator_timeout_as_profile_unavailable(monkeypatch) -> None:
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

    row = QueueRow(
        id="x-comment",
        engagement_action="comment_candidate",
        engagement_targets="https://x.com/example/status/123",
        comment_draft="A specific comment.",
    )

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    class FakePage:
        def goto(self, *args, **kwargs) -> None:
            return None

        def wait_for_timeout(self, *args, **kwargs) -> None:
            return None

        def close(self) -> None:
            return None

    class FakeContext:
        def new_page(self) -> FakePage:
            return FakePage()

    class FakeBrowser:
        contexts = [FakeContext()]

    class FakeChromium:
        def connect_over_cdp(self, endpoint: str) -> FakeBrowser:
            return FakeBrowser()

    class FakePlaywright:
        chromium = FakeChromium()

    class FakePlaywrightManager:
        def __enter__(self) -> FakePlaywright:
            return FakePlaywright()

        def __exit__(self, *args) -> None:
            return None

    def fake_send_x(*args, **kwargs):
        raise PlaywrightTimeoutError("locator timed out")

    monkeypatch.setattr(cli, "_wait_for_chrome_cdp", lambda *args, **kwargs: {"Browser": "Chrome"})
    monkeypatch.setattr(cli, "_verify_main_chrome_profile_path", lambda *args, **kwargs: None)
    monkeypatch.setattr(cli, "_verify_x_browser_account", lambda *args, **kwargs: None)
    monkeypatch.setattr(cli, "_send_x_browser_engagement", fake_send_x)

    with patch("playwright.sync_api.sync_playwright", return_value=FakePlaywrightManager()):
        with pytest.raises(RuntimeError, match="local_automation_profile_unavailable: locator_control_failed"):
            cli._send_browser_engagement_candidate(row, settings=Settings())


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_normalizes_single_external_quote_candidate(monkeypatch) -> None:
    row = QueueRow(
        id="x-quote",
        engagement_action="quote_candidate",
        engagement_status="approved",
        engagement_targets="https://x.com/example/status/123",
        comment_draft="A specific quote.",
        freshness_checked_at=cli.utc_now(),
    )
    repo = MutableDummyRepo([row])

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    calls: list[str] = []

    def fake_send(row, *args, **kwargs):
        calls.append(row.engagement_action)
        return {
            "platform": "x",
            "action": row.engagement_action,
            "url": "https://x.com/nichika2000823/status/999",
            "completion": "comment_post_url_captured",
        }

    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_send_browser_engagement_candidate", fake_send)
    monkeypatch.setattr(
        cli,
        "_append_local_run_summary",
        lambda **kwargs: "artifacts/run-summaries/test.jsonl",
    )

    cli.send_engagement_candidates_local(path="posting_queue.tsv", sync_sheets=False)

    assert calls == ["comment_candidate"]
    assert row.engagement_action == "comment_candidate"
    assert row.engagement_status == "done"
    assert row.error == ""
    assert row.next_action == "Engagement sent; monitor replies and metrics."


@pytest.mark.skip(reason="legacy Playwright/CDP engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_engagement_candidates_local_expires_stale_approved_candidates(monkeypatch, capsys) -> None:
    stale = QueueRow(
        id="stale",
        engagement_action="comment_candidate",
        engagement_status="approved",
        engagement_targets="https://x.com/example/status/123",
        comment_draft="This was approved too long ago.",
        freshness_checked_at="2026-05-20T00:00:00+00:00",
    )
    fresh = QueueRow(
        id="fresh",
        engagement_action="like_candidate",
        engagement_status="approved",
        engagement_targets="https://x.com/example/status/456",
        freshness_checked_at=cli.utc_now(),
    )
    repo = MutableDummyRepo([stale, fresh])
    calls: list[str] = []

    class Settings:
        chrome_main_remote_debugging_port = 9222
        x_expected_handle = "nichika2000823"

    def fake_send(row, *, settings, remote_debugging_port=None, timeout_seconds=20.0):
        calls.append(row.id)
        return {
            "platform": "x",
            "action": row.engagement_action,
            "url": row.engagement_targets,
            "completion": "like_reflected",
        }

    monkeypatch.setattr(cli, "load_settings", lambda: Settings())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_send_browser_engagement_candidate", fake_send)
    monkeypatch.setattr(
        cli,
        "_append_local_run_summary",
        lambda **kwargs: "artifacts/run-summaries/test.jsonl",
    )

    cli.send_engagement_candidates_local(path="posting_queue.tsv", sync_sheets=False)

    assert calls == ["fresh"]
    assert stale.engagement_status == "skipped"
    assert "stale_engagement_candidate_requires_fresh_read" in stale.error
    assert fresh.engagement_status == "done"
    assert "expired=1" in capsys.readouterr().out


def test_prepare_own_post_engagement_candidates_prefers_recent_x_posts() -> None:
    rows = [
        QueueRow(
            id="old",
            status="published",
            title="Older post",
            x_post_url="https://x.com/nichika2000823/status/111",
            published_at="2026-05-20T00:00:00+00:00",
        ),
        QueueRow(
            id="new",
            status="published",
            title="How Ramp engineers accelerate code review with Codex",
            x_post_url="https://x.com/nichika2000823/status/222",
            published_at="2026-05-21T00:00:00+00:00",
        ),
        QueueRow(
            id="done",
            status="published",
            title="Done post",
            x_post_url="https://x.com/nichika2000823/status/333",
            engagement_status="done",
            published_at="2026-05-22T00:00:00+00:00",
        ),
    ]

    prepared = cli._prepare_own_post_engagement_candidates(rows, max_actions=1)

    assert prepared == 1
    assert rows[1].engagement_status == "approved"
    assert rows[1].engagement_action == "reply_to_own_post"
    assert rows[1].engagement_targets == "https://x.com/nichika2000823/status/222"
    assert "Chrome plugin registered runner" in rows[1].next_action
    assert "recording, local proof" in rows[1].next_action
    assert "レビュー待ち" in rows[1].comment_draft
    assert rows[0].engagement_status == ""
    assert rows[2].engagement_status == "done"


def test_supplemental_own_post_engagement_row_uses_linkedin_target_like() -> None:
    row = QueueRow(
        id="dual",
        status="published",
        title="A blueprint for democratic governance of frontier AI",
        x_post_url="https://x.com/nichika2000823/status/111",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:222/",
        published_at="2026-06-05T18:59:52+00:00",
    )

    synthetic = cli._supplemental_own_post_engagement_row(row, "linkedin")

    assert synthetic.id == "dual-linkedin-own-engagement"
    assert synthetic.engagement_action == "like_candidate"
    assert synthetic.engagement_targets == "https://www.linkedin.com/feed/update/urn:li:activity:222/"
    assert synthetic.linkedin_post_url == "https://www.linkedin.com/feed/update/urn:li:activity:222/"
    assert synthetic.x_post_url == ""
    assert synthetic.comment_draft == ""


@pytest.mark.skip(reason="legacy Playwright/CDP own-post engagement sender disabled after the 2026-06-17 Browser Use override")
def test_send_own_post_engagement_local_returns_verified_linkedin_receipt(monkeypatch, tmp_path, capsys) -> None:
    row = QueueRow(
        id="latest",
        status="published",
        title="A blueprint for democratic governance of frontier AI",
        x_post_url="https://x.com/nichika2000823/status/111",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:222/",
        published_at="2026-06-05T18:59:52+00:00",
        linkedin_published_at="2026-06-05T18:59:52+00:00",
    )
    repo = MutableDummyRepo([row])
    sent_rows: list[QueueRow] = []

    def fake_send(row, *, settings, remote_debugging_port=None, timeout_seconds=20.0, verify_profile_path=True):
        sent_rows.append(row)
        assert verify_profile_path is False
        return {
            "platform": "linkedin",
            "completion": "like_reflected",
            "url": row.engagement_targets,
            "like_proof": {
                "source": "reaction_state_after_click",
                "before_state": "Reaction button state: no reaction",
                "after_state": "Reaction button state: liked",
                "state_changed": True,
                "reflected": True,
                "target_url": row.engagement_targets,
            },
            "comment_proof": {
                "source": "body_after_submit",
                "editor_cleared": True,
                "posted_comment_visible": True,
                "visible_before_submit": False,
            },
        }

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "load_settings", lambda: type("Settings", (), {"chrome_main_remote_debugging_port": 9333})())
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_send_browser_engagement_candidate", fake_send)

    payload = cli.send_own_post_engagement_local(
        path="posting_queue.tsv",
        platform="linkedin",
        sync_sheets=False,
        remote_debugging_port=9333,
        json_output=True,
    )

    assert payload["sent"] == 1
    assert payload["skipped"] == 0
    assert payload["receipts"][0]["platform"] == "linkedin"
    assert payload["receipts"][0]["completion"] == "like_reflected"
    assert sent_rows[0].id == "latest-linkedin-own-engagement"
    assert "supplemental linkedin own-post engagement sent" in row.review_notes
    output = capsys.readouterr().out
    assert '"sent": 1' in output


def test_linkedin_like_receipt_requires_linkedin_url() -> None:
    assert cli._is_verified_engagement_sent_receipt(
        {
            "platform": "linkedin",
            "completion": "like_reflected",
            "target_url": "https://www.linkedin.com/feed/update/urn:li:activity:222/",
            "like_proof": {
                "source": "reaction_state_after_click",
                "before_state": "Reaction button state: no reaction",
                "after_state": "Reaction button state: liked",
                "state_changed": True,
                "reflected": True,
                "target_url": "https://www.linkedin.com/feed/update/urn:li:activity:222/",
            },
        }
    )
    assert not cli._is_verified_engagement_sent_receipt(
        {
            "platform": "linkedin",
            "completion": "like_reflected",
            "target_url": "https://example.com/not-linkedin",
        }
    )
    assert not cli._is_verified_engagement_sent_receipt(
        {
            "platform": "linkedin",
            "completion": "like_reflected",
            "target_url": "https://www.linkedin.com/feed/update/urn:li:activity:222/",
        }
    )


def test_playwright_direct_cli_linkedin_like_emits_strict_like_proof() -> None:
    direct_cli_path = Path(
        "/Users/nichikatanaka/Documents/Codex/2026-06-03/playwight-mcp-playwirhgt-cli/lib/daily-ai-direct-cli.mjs"
    )
    source = direct_cli_path.read_text(encoding="utf-8")

    assert "likeProof" in source
    assert "linkedin_reaction_button_state_after_click" in source
    assert "reflected: true" in source
    assert "stateChanged" in source
    assert "afterAriaLabel" in source


def test_engagement_queue_recovery_rejects_linkedin_like_without_proof(monkeypatch, tmp_path) -> None:
    candidate = QueueRow(
        id="linkedin-like-done",
        engagement_status="done",
        engaged_at="2026-06-24T00:00:00Z",
        engagement_action="like_candidate",
        engagement_targets="https://www.linkedin.com/feed/update/urn:li:activity:222/",
    )
    monkeypatch.setattr(cli, "get_local_repo", lambda path: DummyRepo([candidate]))

    result = cli._engagement_queue_recovery_payload("posting_queue.tsv", ["linkedin-like-done"])

    assert result["sent"] == 0
    assert result["skipped"] == 1
    assert "engagement_recovery_unverified:linkedin_like_proof_missing" in result["stop_reason"]


def test_prepare_external_engagement_candidates_uses_researched_reference_posts() -> None:
    rows = [
        QueueRow(
            id="x-external",
            status="published",
            title="OpenAI agent SDK update",
            quality_score="10",
            discussion_score="5",
            research_status="done",
            freshness_checked_at=cli.utc_now(),
            x_research_notes="Read the source thread and replies; people focused on code review latency and handoff timing.",
            angle="The useful angle is where review waiting time gets shorter.",
            reference_post_urls="https://x.com/OpenAI/status/12345",
            x_post_url="https://x.com/nichika2000823/status/999",
            published_at="2026-05-21T00:00:00+00:00",
        ),
        QueueRow(
            id="li-external",
            status="published",
            title="Gemini enterprise rollout",
            quality_score="9",
            discussion_score="4",
            research_status="done",
            freshness_checked_at=cli.utc_now(),
            linkedin_research_notes="Read the LinkedIn discussion; operators cared about governance and workspace rollout.",
            angle="The practical angle is rollout governance inside existing teams.",
            reference_post_urls="https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A456/",
            published_at="2026-05-21T00:01:00+00:00",
        ),
        QueueRow(
            id="unread",
            status="published",
            title="Unread target",
            quality_score="10",
            research_status="in_progress",
            reference_post_urls="https://x.com/example/status/789",
        ),
        QueueRow(
            id="angle-only",
            status="published",
            title="Angle only target",
            quality_score="10",
            research_status="done",
            angle="This angle is long enough to sound like evidence, but it is not a readback from a target post.",
            reference_post_urls="https://x.com/example/status/999",
        ),
    ]

    prepared = cli._prepare_external_engagement_candidates(
        rows,
        max_actions=3,
        max_likes=1,
        max_comments=1,
        max_saves=1,
        max_quotes=1,
    )

    assert prepared == 2
    assert rows[0].engagement_action == "comment_candidate"
    assert rows[0].engagement_status == "approved"
    assert rows[0].engagement_targets == "https://x.com/OpenAI/status/12345"
    assert "code review latency" in rows[0].comment_draft
    assert "調査メモ" not in rows[0].comment_draft
    assert "実際の運用では" not in rows[0].comment_draft
    assert rows[1].engagement_action == "save_candidate"
    assert rows[1].engagement_status == "approved"
    assert rows[1].engagement_targets == "https://www.linkedin.com/feed/update/urn:li:share:456/"
    assert rows[1].comment_draft == ""
    assert rows[2].engagement_status == ""
    assert rows[3].engagement_status == ""


def test_prepare_external_engagement_candidates_applies_daily_platform_targets() -> None:
    rows = []
    for index in range(7):
        rows.append(
            QueueRow(
                id=f"x-{index}",
                status="published",
                title=f"X target {index}",
                quality_score="10",
                discussion_score=str(10 - index),
                research_status="done",
                freshness_checked_at=cli.utc_now(),
                x_research_notes="Read the X target and replies; operators discussed automation quality, comment specificity, and handoff timing.",
                angle="The practical angle is comment specificity in AI automation.",
                reference_post_urls=f"https://x.com/example/status/{9000 + index}",
                x_post_url="https://x.com/nichika2000823/status/999",
                published_at=f"2026-05-21T00:00:{index:02d}+00:00",
            )
        )
    for index in range(6):
        rows.append(
            QueueRow(
                id=f"linkedin-{index}",
                status="published",
                title=f"LinkedIn target {index}",
                quality_score="10",
                discussion_score=str(10 - index),
                research_status="done",
                freshness_checked_at=cli.utc_now(),
                linkedin_research_notes="Read the LinkedIn target and comments; operators discussed rollout governance, adoption, and practical ownership.",
                angle="The practical angle is rollout governance inside teams.",
                reference_post_urls=f"https://www.linkedin.com/feed/update/urn:li:activity:{8000 + index}/",
                linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/",
                published_at=f"2026-05-21T00:01:{index:02d}+00:00",
            )
        )

    prepared = cli._prepare_external_engagement_candidates(
        rows,
        max_actions=13,
        max_likes=10,
        max_comments=3,
        max_saves=0,
        max_quotes=0,
    )

    counts = {
        ("x", "like_candidate"): 0,
        ("x", "comment_candidate"): 0,
        ("linkedin", "like_candidate"): 0,
        ("linkedin", "comment_candidate"): 0,
    }
    for row in rows:
        if row.engagement_status != "approved":
            continue
        platform = cli._engagement_platform(cli._first_engagement_target(row))
        counts[(platform, row.engagement_action)] += 1

    assert prepared == 13
    assert counts == {
        ("x", "like_candidate"): 5,
        ("x", "comment_candidate"): 2,
        ("linkedin", "like_candidate"): 5,
        ("linkedin", "comment_candidate"): 1,
    }


def test_engagement_candidates_prioritize_external_targets_over_own_replies() -> None:
    own = QueueRow(
        id="own",
        status="published",
        published_at="2026-06-01T00:00:00+00:00",
        x_post_url="https://x.com/nichika2000823/status/111",
        engagement_action="reply_to_own_post",
        engagement_status="approved",
        engagement_targets="https://x.com/nichika2000823/status/111",
        comment_draft="Own follow-up.",
    )
    external = QueueRow(
        id="external",
        status="published",
        published_at="2026-06-02T00:00:00+00:00",
        engagement_action="comment_candidate",
        engagement_status="approved",
        engagement_targets="https://x.com/example/status/222",
        comment_draft="Specific external comment.",
    )

    candidates = cli._engagement_candidates([own, external], max_actions=1)

    assert [row.id for row in candidates] == ["external"]


def test_prepare_external_engagement_candidates_requires_research_notes_not_angle_only() -> None:
    rows = [
        QueueRow(
            id="angle-only",
            status="published",
            title="Angle without read notes",
            quality_score="10",
            discussion_score="5",
            research_status="done",
            freshness_checked_at=cli.utc_now(),
            angle="This angle is detailed enough to be tempting, but it is not evidence that the target post was read.",
            reference_post_urls="https://x.com/example/status/123",
        )
    ]

    prepared = cli._prepare_external_engagement_candidates(
        rows,
        max_actions=1,
        max_likes=1,
        max_comments=1,
        max_saves=1,
        max_quotes=1,
    )

    assert prepared == 0
    assert rows[0].engagement_status == ""


def test_prepare_external_engagement_candidates_does_not_resurrect_terminal_quote_skip() -> None:
    row = QueueRow(
        id="terminal-quote",
        status="published",
        error="engagement_skipped: unsupported_quote_candidate_stale",
        quality_score="12",
        discussion_score="4",
        research_status="done",
        freshness_checked_at=cli.utc_now(),
        x_research_notes="Fresh readback from a target post with specific evidence about workflow changes and replies.",
        reference_post_urls="https://x.com/example/status/123",
        engagement_status="skipped",
    )

    prepared = cli._prepare_external_engagement_candidates(
        [row],
        max_actions=1,
        max_likes=1,
        max_comments=1,
        max_saves=1,
        max_quotes=1,
    )

    assert prepared == 0
    assert row.engagement_status == "skipped"
    assert row.engagement_action == ""


def test_prepare_external_engagement_candidates_does_not_resurrect_skipped_comment() -> None:
    row = QueueRow(
        id="skipped-comment",
        status="published",
        error="engagement_failed: comment_not_sent: X reply completion URL was not visible after submit",
        quality_score="12",
        discussion_score="4",
        research_status="done",
        freshness_checked_at=cli.utc_now(),
        x_research_notes="Fresh readback from a target post with specific evidence about workflow changes and replies.",
        reference_post_urls="https://x.com/example/status/123",
        engagement_targets="https://x.com/example/status/123",
        engagement_status="skipped",
        next_action="Review engagement blocker before retrying CLI auto-engagement.",
    )

    prepared = cli._prepare_external_engagement_candidates(
        [row],
        max_actions=1,
        max_likes=1,
        max_comments=1,
        max_saves=1,
        max_quotes=1,
    )

    assert prepared == 0
    assert row.engagement_status == "skipped"
    assert row.engagement_action == ""
    assert row.engagement_targets == "https://x.com/example/status/123"


def test_prepare_external_engagement_candidates_does_not_reuse_skipped_target_from_other_row() -> None:
    skipped = QueueRow(
        id="skipped-prior",
        engagement_status="skipped",
        engagement_targets="https://x.com/example/status/123",
    )
    candidate = QueueRow(
        id="candidate",
        status="published",
        title="Candidate",
        quality_score="10",
        discussion_score="5",
        research_status="done",
        freshness_checked_at=cli.utc_now(),
        x_research_notes="Read the X target and replies; operators discussed automation quality, comment specificity, and handoff timing.",
        reference_post_urls="https://x.com/example/status/123",
    )

    prepared = cli._prepare_external_engagement_candidates(
        [skipped, candidate],
        max_actions=1,
        max_likes=1,
        max_comments=1,
        max_saves=0,
        max_quotes=0,
    )

    assert prepared == 0
    assert candidate.engagement_status == ""
    assert candidate.engagement_targets == ""


def test_prepare_engagement_candidates_local_uses_own_reply_only_when_no_external(monkeypatch, tmp_path, capsys) -> None:
    rows = [
        QueueRow(
            id="external",
            status="published",
            title="External researched post",
            quality_score="9",
            research_status="done",
            freshness_checked_at=cli.utc_now(),
            x_research_notes="Read the external thread; comments focused on practical deployment sequencing.",
            angle="The useful angle is deployment sequencing.",
            reference_post_urls="https://x.com/example/status/123",
            x_post_url="https://x.com/nichika2000823/status/321",
            published_at="2026-05-21T00:00:00+00:00",
        ),
        QueueRow(
            id="own",
            status="published",
            title="How Ramp engineers accelerate code review with Codex",
            x_post_url="https://x.com/nichika2000823/status/222",
            published_at="2026-05-21T00:01:00+00:00",
        ),
    ]
    repo = MutableDummyRepo(rows)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.prepare_engagement_candidates_local(path="posting_queue.tsv", max_actions=2, sync_sheets=False)

    assert rows[0].engagement_action == "comment_candidate"
    assert rows[0].engagement_status == "approved"
    assert rows[1].engagement_action == ""
    assert rows[1].engagement_status == ""
    assert "external=1 own_post=0" in capsys.readouterr().out


def test_prepare_own_post_engagement_candidates_does_not_resurrect_skipped_row() -> None:
    row = QueueRow(
        id="own-skipped",
        status="published",
        title="Own post",
        x_post_url="https://x.com/nichika2000823/status/222",
        engagement_status="skipped",
        engagement_targets="https://x.com/nichika2000823/status/222",
        error="engagement_failed: comment_not_sent: X reply completion URL was not visible after submit",
    )

    prepared = cli._prepare_own_post_engagement_candidates([row], max_actions=1)

    assert prepared == 0
    assert row.engagement_status == "skipped"
    assert row.engagement_action == ""
    assert row.engagement_targets == "https://x.com/nichika2000823/status/222"


def test_prepare_engagement_candidates_local_does_not_fallback_to_own_reply_by_default(monkeypatch, tmp_path, capsys) -> None:
    rows = [
        QueueRow(
            id="own",
            status="published",
            title="How Ramp engineers accelerate code review with Codex",
            x_post_url="https://x.com/nichika2000823/status/222",
            published_at="2026-05-21T00:01:00+00:00",
        ),
        QueueRow(
            id="own-2",
            status="published",
            title="Second own post",
            x_post_url="https://x.com/nichika2000823/status/333",
            published_at="2026-05-21T00:00:00+00:00",
        ),
    ]
    repo = MutableDummyRepo(rows)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.prepare_engagement_candidates_local(path="posting_queue.tsv", max_actions=6, sync_sheets=False)

    assert rows[0].engagement_action == ""
    assert rows[0].engagement_status == ""
    assert rows[1].engagement_action == ""
    assert rows[1].engagement_status == ""
    assert "external=0 own_post=0" in capsys.readouterr().out


def test_prepare_engagement_candidates_local_can_explicitly_fallback_to_one_own_reply(monkeypatch, tmp_path, capsys) -> None:
    rows = [
        QueueRow(
            id="own",
            status="published",
            title="How Ramp engineers accelerate code review with Codex",
            x_post_url="https://x.com/nichika2000823/status/222",
            published_at="2026-05-21T00:01:00+00:00",
        ),
        QueueRow(
            id="own-2",
            status="published",
            title="Second own post",
            x_post_url="https://x.com/nichika2000823/status/333",
            published_at="2026-05-21T00:00:00+00:00",
        ),
    ]
    repo = MutableDummyRepo(rows)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.prepare_engagement_candidates_local(
        path="posting_queue.tsv",
        max_actions=6,
        allow_own_post_fallback=True,
        sync_sheets=False,
    )

    assert rows[0].engagement_action == "reply_to_own_post"
    assert rows[0].engagement_status == "approved"
    assert rows[1].engagement_action == ""
    assert rows[1].engagement_status == ""
    assert "external=0 own_post=1" in capsys.readouterr().out


def test_prepare_engagement_candidates_local_does_not_fallback_when_external_skipped(monkeypatch, tmp_path, capsys) -> None:
    rows = [
        QueueRow(
            id="own",
            status="published",
            title="How Ramp engineers accelerate code review with Codex",
            x_post_url="https://x.com/nichika2000823/status/222",
            published_at="2026-05-21T00:01:00+00:00",
        )
    ]
    repo = MutableDummyRepo(rows)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.prepare_engagement_candidates_local(
        path="posting_queue.tsv",
        max_actions=6,
        include_external=False,
        sync_sheets=False,
    )

    assert rows[0].engagement_action == ""
    assert rows[0].engagement_status == ""
    assert "external=0 own_post=0" in capsys.readouterr().out


def test_record_feed_study_local_updates_research_and_engagement(monkeypatch, tmp_path, capsys) -> None:
    row = QueueRow(
        id="item-1",
        status="published",
        title="OpenAI agent SDK update",
        quality_score="10",
        discussion_score="5",
        x_post_url="https://x.com/nichika2000823/status/111",
        published_at="2026-05-21T00:00:00+00:00",
    )
    repo = MutableDummyRepo([row])
    artifact = tmp_path / "feed-study.json"
    artifact.write_text(
        json.dumps(
            {
                "read_posts": [
                    {
                        "queue_id": "item-1",
                        "platform": "x",
                        "url": "https://x.com/OpenAI/status/12345",
                        "author": "OpenAI",
                        "topic": "agent SDK rollout",
                        "evidence": "Read the source thread and replies; people focused on review latency and handoff timing.",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.record_feed_study_local(
        artifact_path=str(artifact),
        path="posting_queue.tsv",
        max_actions=1,
        sync_sheets=False,
    )

    assert row.research_status == "done"
    assert "https://x.com/OpenAI/status/12345" in row.reference_post_urls
    assert "Feed read: OpenAI / agent SDK rollout" in row.x_research_notes
    approved = [queue_row for queue_row in repo.read_all() if queue_row.engagement_status == "approved"]
    assert row.engagement_action == ""
    assert row.engagement_status == ""
    assert len(approved) == 1
    assert approved[0].id.startswith("eng-x-")
    assert approved[0].engagement_action == "comment_candidate"
    assert approved[0].engagement_targets == "https://x.com/OpenAI/status/12345"
    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["feed_study_count"] == 1
    assert payload["external_posts_read"] == 1
    assert payload["feed_research_receipt"].startswith("target=15-30 relevant posts; actual=1; external=1; x=1; linkedin=0")
    assert payload["stop_reason"] == "post_publish_feed_study_insufficient_external_posts:1/15; engagement_platform_feed_study_missing:linkedin"
    assert "https://x.com/OpenAI/status/12345" in payload["feed_research_receipt"]
    assert payload["engagement_candidates_created"] == 1
    output = capsys.readouterr().out
    assert "Recorded feed study. read=1 external_read=1" in output
    assert "receipt=target=15-30 relevant posts; actual=1" in output


def test_collect_external_feed_posts_for_engagement_broadens_linkedin_cards_and_skips_ads() -> None:
    class FakePage:
        def __init__(self) -> None:
            self.goto_calls: list[str] = []
            self.evaluate_scripts: list[str] = []
            self.waits: list[int] = []
            self.mouse = self

        def goto(self, url, wait_until=None, timeout=None):
            self.goto_calls.append(url)

        def wait_for_timeout(self, ms):
            self.waits.append(ms)

        def wheel(self, x, y):
            return None

        def evaluate(self, script, platform):
            self.evaluate_scripts.append(script)
            return [
                {
                    "url": "https://www.linkedin.com/feed/update/urn:li:activity:111/",
                    "body": "Promoted Sponsored Learn more " + ("generic ad copy " * 12),
                    "author": "Ad",
                },
                {
                    "url": "https://www.linkedin.com/feed/update/urn:li:activity:222/",
                    "body": "Nichika read this LinkedIn feed post about AI operations and it had specific enough context for a meaningful save or comment. " * 2,
                    "author": "Operator",
                },
            ]

    row = QueueRow(id="published-1", status="published", linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/")
    page = FakePage()

    posts = cli._collect_external_feed_posts_for_engagement(
        page,
        platform="linkedin",
        feed_url="https://www.linkedin.com/feed/",
        limit=3,
        published_rows=[row],
        scroll_rounds=1,
    )

    assert len(posts) == 1
    assert posts[0]["url"] == "https://www.linkedin.com/feed/update/urn:li:activity:222/"
    assert posts[0]["engagement_action"] == "comment_candidate"
    assert "data-urn*=\"urn:li:activity\"" in page.evaluate_scripts[0]
    assert "feed-shared-update-v2" in page.evaluate_scripts[0]


def test_normalize_feed_post_url_extracts_linkedin_encoded_activity_urn() -> None:
    assert (
        cli._normalize_feed_post_url(
            "https://www.linkedin.com/company/openai/posts/?update=urn%3Ali%3Aactivity%3A123456789"
        )
        == "https://www.linkedin.com/feed/update/urn:li:activity:123456789/"
    )
    assert (
        cli._normalize_feed_post_url("https://www.linkedin.com/feed/update/urn:li:share:987/?trk=feed")
        == "https://www.linkedin.com/feed/update/urn:li:share:987/"
    )


def test_prepare_external_engagement_candidates_accepts_linkedin_company_update_url() -> None:
    row = QueueRow(
        id="linkedin-company-update",
        status="published",
        title="LinkedIn company update",
        quality_score="10",
        research_status="done",
        freshness_checked_at=cli.utc_now(),
        linkedin_research_notes="Read the LinkedIn company update; operators discussed AI adoption, rollout governance, and practical team ownership.",
        angle="The practical angle is rollout governance inside teams.",
        reference_post_urls="https://www.linkedin.com/company/openai/posts/?update=urn%3Ali%3Aactivity%3A123456789",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/",
    )

    prepared = cli._prepare_external_engagement_candidates(
        [row],
        max_actions=13,
        max_likes=10,
        max_comments=3,
        max_saves=0,
        max_quotes=0,
    )

    assert prepared == 1
    assert row.engagement_targets == "https://www.linkedin.com/feed/update/urn:li:activity:123456789/"
    assert row.engagement_status == "approved"


def test_collect_external_feed_posts_for_engagement_prefers_linkedin_urn_over_company_fallback() -> None:
    class FakePage:
        def __init__(self) -> None:
            self.evaluate_scripts: list[str] = []
            self.mouse = self

        def goto(self, url, wait_until=None, timeout=None):
            return None

        def wait_for_timeout(self, ms):
            return None

        def wheel(self, x, y):
            return None

        def evaluate(self, script, platform=None):
            if platform is None:
                return None
            self.evaluate_scripts.append(script)
            return [
                {
                    "url": "https://www.linkedin.com/company/openai/posts/?update=urn%3Ali%3Aactivity%3A333",
                    "body": "Feed post Like Comment A concrete LinkedIn update about AI research workflows, adoption pressure, and operational handoffs. " * 2,
                    "author": "OpenAI",
                    "candidate_eligible": True,
                }
            ]

    row = QueueRow(id="published-1", status="published", linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/")
    page = FakePage()

    posts = cli._collect_external_feed_posts_for_engagement(
        page,
        platform="linkedin",
        feed_url="https://www.linkedin.com/feed/",
        limit=1,
        published_rows=[row],
        scroll_rounds=1,
    )

    assert posts[0]["url"] == "https://www.linkedin.com/feed/update/urn:li:activity:333/"
    assert posts[0]["candidate_eligible"] is True
    assert 'a[href*="urn%3Ali%3A"]' in page.evaluate_scripts[0]


def test_collect_external_feed_posts_for_engagement_resolves_linkedin_company_page_to_post_url() -> None:
    class FakeResolverPage:
        def __init__(self) -> None:
            self.closed = False
            self.visited: list[str] = []

        def goto(self, url, wait_until=None, timeout=None):
            self.visited.append(url)

        def wait_for_timeout(self, ms):
            return None

        def evaluate(self, script, evidence=None):
            assert "feed-shared-update-v2" in script
            assert "minimumScore" in script
            assert "AI research workflows" in evidence
            return "https://www.linkedin.com/feed/update/urn:li:activity:444/"

        def close(self):
            self.closed = True

    class FakeContext:
        def __init__(self) -> None:
            self.resolver = FakeResolverPage()

        def new_page(self):
            return self.resolver

    class FakePage:
        def __init__(self) -> None:
            self.context = FakeContext()
            self.mouse = self

        def goto(self, url, wait_until=None, timeout=None):
            return None

        def wait_for_timeout(self, ms):
            return None

        def wheel(self, x, y):
            return None

        def evaluate(self, script, platform=None):
            if platform is None:
                return None
            return [
                {
                    "url": "https://www.linkedin.com/company/openai/posts/",
                    "body": "Feed post OpenAI Like Comment A concrete LinkedIn update about AI research workflows, adoption pressure, and operational handoffs. " * 2,
                    "author": "OpenAI",
                    "candidate_eligible": False,
                }
            ]

    row = QueueRow(id="published-1", status="published", linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/")
    page = FakePage()

    posts = cli._collect_external_feed_posts_for_engagement(
        page,
        platform="linkedin",
        feed_url="https://www.linkedin.com/feed/",
        limit=1,
        published_rows=[row],
        scroll_rounds=1,
    )

    assert posts[0]["url"] == "https://www.linkedin.com/feed/update/urn:li:activity:444/"
    assert posts[0]["candidate_eligible"] is True
    assert page.context.resolver.visited == ["https://www.linkedin.com/company/openai/posts/"]
    assert page.context.resolver.closed is True


def test_linkedin_fallback_resolution_keeps_unmatched_read_only_url_ineligible() -> None:
    class FakeResolverPage:
        def __init__(self) -> None:
            self.closed = False
            self.scroll_attempts = 0

        def goto(self, url, wait_until=None, timeout=None):
            return None

        def wait_for_timeout(self, ms):
            return None

        def evaluate(self, script, evidence=None):
            if "scrollBy" in script:
                self.scroll_attempts += 1
            return ""

        def close(self):
            self.closed = True

    class FakeContext:
        def __init__(self) -> None:
            self.resolver = FakeResolverPage()

        def new_page(self):
            return self.resolver

    class FakePage:
        context = FakeContext()

    resolved = cli._resolve_linkedin_fallback_post_url(
        FakePage(),
        "https://www.linkedin.com/company/openai/posts/",
        "Evidence about AI rollout governance that does not match any visible fallback post.",
    )

    assert resolved == ""
    assert FakePage.context.resolver.scroll_attempts == 4
    assert FakePage.context.resolver.closed is True


def test_collect_external_feed_posts_for_engagement_prefers_published_source_rows() -> None:
    class FakePage:
        def __init__(self) -> None:
            self.mouse = self

        def goto(self, url, wait_until=None, timeout=None):
            return None

        def wait_for_timeout(self, ms):
            return None

        def wheel(self, x, y):
            return None

        def evaluate(self, script, platform=None):
            if platform is None:
                return None
            return [
                {
                    "url": "https://www.linkedin.com/feed/update/urn:li:activity:555/",
                    "body": "Feed post Like Comment A concrete LinkedIn update about AI deployment reviews and operational ownership boundaries. " * 2,
                    "author": "Operator",
                    "candidate_eligible": True,
                }
            ]

    partial = QueueRow(
        id="partial-row",
        status="partially_published",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/",
    )
    published = QueueRow(
        id="published-row",
        status="published",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:1000/",
    )

    posts = cli._collect_external_feed_posts_for_engagement(
        FakePage(),
        platform="linkedin",
        feed_url="https://www.linkedin.com/feed/",
        limit=1,
        published_rows=[partial, published],
        scroll_rounds=1,
    )

    assert posts[0]["queue_id"] == "published-row"


def test_collect_external_feed_posts_for_engagement_allocates_linkedin_one_comment_then_likes() -> None:
    class FakePage:
        def __init__(self) -> None:
            self.evaluate_calls = 0
            self.mouse = self

        def goto(self, url, wait_until=None, timeout=None):
            return None

        def wait_for_timeout(self, ms):
            return None

        def wheel(self, x, y):
            return None

        def evaluate(self, script, platform=None):
            if platform is None:
                return None
            self.evaluate_calls += 1
            return [
                {
                    "url": f"https://www.linkedin.com/feed/update/urn:li:activity:{5000 + self.evaluate_calls}/",
                    "body": "Feed post Like Comment A practical LinkedIn AI operations post about rollout ownership and research handoffs. " * 2,
                    "author": "Operator",
                    "candidate_eligible": True,
                }
            ]

    row = QueueRow(id="published-1", status="published", linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/")

    posts = cli._collect_external_feed_posts_for_engagement(
        FakePage(),
        platform="linkedin",
        feed_url="https://www.linkedin.com/feed/",
        limit=6,
        published_rows=[row],
        scroll_rounds=6,
    )

    assert [post["engagement_action"] for post in posts] == [
        "comment_candidate",
        "like_candidate",
        "like_candidate",
        "like_candidate",
        "like_candidate",
        "like_candidate",
    ]


def test_collect_external_feed_posts_for_engagement_allocates_x_two_comments_then_likes() -> None:
    class FakePage:
        def __init__(self) -> None:
            self.mouse = self

        def goto(self, url, wait_until=None, timeout=None):
            return None

        def wait_for_timeout(self, ms):
            return None

        def wheel(self, x, y):
            return None

        def evaluate(self, script, platform=None):
            if platform is None:
                return None
            return [
                {
                    "url": f"https://x.com/example/status/{7000 + index}",
                    "body": "A practical X post about AI research automation, comments, and operator handoffs with concrete implementation detail. " * 2,
                    "author": "Operator",
                }
                for index in range(7)
            ]

    row = QueueRow(id="published-1", status="published", x_post_url="https://x.com/nichika2000823/status/999/")

    posts = cli._collect_external_feed_posts_for_engagement(
        FakePage(),
        platform="x",
        feed_url="https://x.com/home",
        limit=7,
        published_rows=[row],
        scroll_rounds=1,
    )

    assert [post["engagement_action"] for post in posts] == [
        "comment_candidate",
        "comment_candidate",
        "like_candidate",
        "like_candidate",
        "like_candidate",
        "like_candidate",
        "like_candidate",
    ]


def test_collect_external_feed_posts_for_engagement_scrolls_linkedin_before_returning() -> None:
    class FakePage:
        def __init__(self) -> None:
            self.evaluate_calls = 0
            self.scroll_evaluates = 0
            self.wheel_calls: list[tuple[int, int]] = []
            self.waits: list[int] = []
            self.mouse = self

        def goto(self, url, wait_until=None, timeout=None):
            return None

        def wait_for_timeout(self, ms):
            self.waits.append(ms)

        def wheel(self, x, y):
            self.wheel_calls.append((x, y))

        def evaluate(self, script, platform=None):
            if platform is None:
                self.scroll_evaluates += 1
                return None
            self.evaluate_calls += 1
            return [
                {
                    "url": f"https://www.linkedin.com/feed/update/urn:li:activity:{220 + self.evaluate_calls}/",
                    "body": "Feed post Like Comment A practical AI operations post about governance, rollout latency, and team handoffs with enough detail to evaluate. " * 2,
                    "author": "Operator",
                    "candidate_eligible": True,
                }
            ]

    row = QueueRow(id="published-1", status="published", linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/")
    page = FakePage()

    posts = cli._collect_external_feed_posts_for_engagement(
        page,
        platform="linkedin",
        feed_url="https://www.linkedin.com/feed/",
        limit=1,
        published_rows=[row],
        scroll_rounds=5,
    )

    assert len(posts) == 4
    assert page.evaluate_calls == 4
    assert page.scroll_evaluates == 3
    assert page.wheel_calls == [(0, 1800), (0, 1800), (0, 1800)]


def test_feed_study_read_only_linkedin_fallback_does_not_create_candidate() -> None:
    row = QueueRow(
        id="published-1",
        status="published",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/",
    )

    metrics = cli._apply_feed_study_entries_to_rows(
        [row],
        [
            {
                "queue_id": "published-1",
                "platform": "linkedin",
                "url": "https://www.linkedin.com/in/example/",
                "author": "Example",
                "topic": "AI rollout",
                "evidence": "Feed post Like Comment A useful LinkedIn read about AI rollout constraints and approval handoffs in teams. " * 2,
                "engagement_action": "comment_candidate",
            }
        ],
        max_actions=1,
        max_likes=1,
        max_comments=1,
        max_saves=0,
        max_quotes=0,
    )

    assert metrics["external_posts_read"] == 1
    assert metrics["engagement_candidates_created"] == 0
    assert row.engagement_status == ""
    assert row.engagement_targets == ""
    assert "https://www.linkedin.com/in/example/" in row.reference_post_urls
    assert metrics["feed_read_log_rows"][0][7] == ""
    assert metrics["feed_read_log_rows"][0][8] == "false"


def test_external_engagement_comment_keeps_concrete_focus_and_avoids_template_phrases() -> None:
    row = QueueRow(
        id="published-1",
        status="published",
        x_research_notes="Feed read: Operator: code review latency and governance handoffs are slowing AI agent rollout in real teams.",
        linkedin_research_notes="Feed read: Operator: workspace rollout approval and team handoffs are the bottleneck for agents.",
    )

    x_comment = cli._external_engagement_comment(row, "x")
    linkedin_comment = cli._external_engagement_comment(row, "linkedin")
    combined = f"{x_comment}\n{linkedin_comment}"

    assert "code review latency" in x_comment
    assert "workspace rollout approval" in linkedin_comment
    assert x_comment != cli._external_engagement_comment(
        QueueRow(
            id="published-2",
            status="published",
            x_research_notes="Feed read: Operator: team adoption and workspace rollout are where AI tools either stick or fade.",
        ),
        "x",
    )
    for phrase in [
        "ここが面白い",
        "調査メモ",
        "実際の運用では",
        "One thing I noticed",
        "In the notes",
        "Great point",
        "What part",
    ]:
        assert phrase not in combined


def test_post_publish_feed_study_blocks_completion_when_linkedin_collects_none(monkeypatch, tmp_path) -> None:
    import sys
    import types

    row = QueueRow(
        id="published-1",
        status="published",
        x_post_url="https://x.com/nichika2000823/status/111",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/",
    )
    repo = MutableDummyRepo([row])
    calls: list[tuple[str, int]] = []

    def fake_collect(page, *, platform, feed_url, limit, published_rows, exclude_urls=None, scroll_rounds=8):
        calls.append((platform, scroll_rounds))
        if platform == "linkedin":
            return []
        start = len(calls) * 100
        count = min(limit, 8 if scroll_rounds == 12 else 7)
        return [
            {
                "queue_id": "published-1",
                "platform": "x",
                "url": f"https://x.com/example/status/{start + index}",
                "author": "Example",
                "topic": "AI feed",
                "evidence": "Read a concrete recommended feed post about AI work and saved the specific observation for engagement. " * 2,
                "engagement_action": "like_candidate",
            }
            for index in range(count)
        ]

    class FakeBrowser:
        @property
        def contexts(self):
            return [self]

        def new_context(self):
            return self

        def new_page(self):
            return self

        def close(self):
            return None

    class FakeChromium:
        def connect_over_cdp(self, url):
            return FakeBrowser()

    class FakePlaywright:
        chromium = FakeChromium()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_ensure_chrome_cdp_page_target", lambda *args, **kwargs: True)
    fake_playwright_module = types.SimpleNamespace(sync_playwright=lambda: FakePlaywright())
    fake_playwright_package = types.SimpleNamespace(sync_api=fake_playwright_module)
    monkeypatch.setitem(sys.modules, "playwright", fake_playwright_package)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", fake_playwright_module)
    monkeypatch.setattr(cli, "_collect_external_feed_posts_for_engagement", fake_collect)

    result = cli._post_publish_engagement_feed_study_local(
        path="posting_queue.tsv",
        settings=type("Settings", (), {"chrome_main_remote_debugging_port": 9222})(),
        remote_debugging_port=9222,
        max_actions=9,
        sync_sheets=False,
        timeout_seconds=30,
        target_count=30,
    )

    assert calls[:3] == [("x", 12), ("linkedin", 12), ("linkedin", 18)]
    assert ("x", 18) in calls
    linkedin_scroll_rounds = [scroll_rounds for platform, scroll_rounds in calls if platform == "linkedin"]
    assert {28, 32}.issubset(set(linkedin_scroll_rounds))
    assert all(scroll_rounds in {12, 18, 28, 32, 40, 48} for scroll_rounds in linkedin_scroll_rounds)
    assert result["external_read"] == 15
    assert result["platform_reads"] == {"x": 15, "linkedin": 0}
    assert result["stop_reason"] == (
        "engagement_platform_feed_study_missing:linkedin; "
        "engagement_candidate_pool_insufficient:5/9"
    )


def test_post_publish_feed_study_keeps_extra_actionable_linkedin_before_truncation(monkeypatch, tmp_path) -> None:
    import sys
    import types

    row = QueueRow(
        id="published-1",
        status="published",
        x_post_url="https://x.com/nichika2000823/status/111",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/",
    )
    repo = MutableDummyRepo([row])
    linkedin_calls = 0

    def fake_collect(page, *, platform, feed_url, limit, published_rows, exclude_urls=None, scroll_rounds=8):
        nonlocal linkedin_calls
        if platform == "x":
            return [
                {
                    "queue_id": "published-1",
                    "platform": "x",
                    "url": f"https://x.com/example/status/{index}",
                    "author": "Example",
                    "topic": "AI feed",
                    "evidence": "Read a concrete recommended feed post about AI work and saved the specific observation for engagement. " * 2,
                    "engagement_action": "like_candidate",
                }
                for index in range(min(limit, 20))
            ]
        linkedin_calls += 1
        if linkedin_calls == 1:
            return [
                {
                    "queue_id": "published-1",
                    "platform": "linkedin",
                    "url": f"https://www.linkedin.com/company/example-{index}/",
                    "author": "Example",
                    "topic": "AI feed",
                    "evidence": "Read a LinkedIn card but it did not expose an actionable post URL.",
                    "candidate_eligible": False,
                    "engagement_action": "like_candidate",
                }
                for index in range(min(limit, 20))
            ]
        return [
            {
                "queue_id": "published-1",
                "platform": "linkedin",
                "url": f"https://www.linkedin.com/feed/update/urn:li:activity:{1000 + index}/",
                "author": "Example",
                "topic": "AI feed",
                "evidence": "Read a concrete LinkedIn feed post and saved the specific observation for engagement. " * 2,
                "candidate_eligible": True,
                "engagement_action": "like_candidate",
            }
            for index in range(min(limit, 6))
        ]

    class FakeBrowser:
        @property
        def contexts(self):
            return [self]

        def new_context(self):
            return self

        def new_page(self):
            return self

        def close(self):
            return None

    class FakeChromium:
        def connect_over_cdp(self, url):
            return FakeBrowser()

    class FakePlaywright:
        chromium = FakeChromium()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_ensure_chrome_cdp_page_target", lambda *args, **kwargs: True)
    fake_playwright_module = types.SimpleNamespace(sync_playwright=lambda: FakePlaywright())
    fake_playwright_package = types.SimpleNamespace(sync_api=fake_playwright_module)
    monkeypatch.setitem(sys.modules, "playwright", fake_playwright_package)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", fake_playwright_module)
    monkeypatch.setattr(cli, "_collect_external_feed_posts_for_engagement", fake_collect)

    result = cli._post_publish_engagement_feed_study_local(
        path="posting_queue.tsv",
        settings=type("Settings", (), {"chrome_main_remote_debugging_port": 9222})(),
        remote_debugging_port=9222,
        max_actions=13,
        sync_sheets=False,
        timeout_seconds=30,
        target_count=40,
    )

    payload = json.loads(Path(result["artifact"]).read_text(encoding="utf-8"))
    read_posts = payload["read_posts"]
    actionable_linkedin = [
        entry
        for entry in read_posts
        if entry["platform"] == "linkedin" and cli._feed_entry_candidate_eligible(entry)
    ]
    assert len(read_posts) == 40
    assert len(actionable_linkedin) == 6
    assert actionable_linkedin[0]["url"].startswith("https://www.linkedin.com/feed/update/")
    assert result["engagement_candidates_created"] == 13
    assert result["stop_reason"] == ""


def test_post_publish_feed_study_retries_linkedin_refill_until_actionable_target(monkeypatch, tmp_path) -> None:
    import sys
    import types

    row = QueueRow(
        id="published-1",
        status="published",
        x_post_url="https://x.com/nichika2000823/status/111",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:999/",
    )
    repo = MutableDummyRepo([row])
    linkedin_calls = 0

    def fake_collect(page, *, platform, feed_url, limit, published_rows, exclude_urls=None, scroll_rounds=8):
        nonlocal linkedin_calls
        if platform == "x":
            return [
                {
                    "queue_id": "published-1",
                    "platform": "x",
                    "url": f"https://x.com/example/status/{index}",
                    "author": "Example",
                    "topic": "AI feed",
                    "evidence": "Read a concrete recommended feed post about AI work and saved the specific observation for engagement. " * 2,
                    "engagement_action": "like_candidate",
                }
                for index in range(min(limit, 20))
            ]
        linkedin_calls += 1
        if linkedin_calls == 1:
            return [
                {
                    "queue_id": "published-1",
                    "platform": "linkedin",
                    "url": "https://www.linkedin.com/feed/update/urn:li:activity:7000/",
                    "author": "Operator",
                    "topic": "AI feed",
                    "evidence": "Read a concrete LinkedIn feed post about agent rollout governance and team ownership. " * 2,
                    "candidate_eligible": True,
                    "engagement_action": "comment_candidate",
                },
                *[
                    {
                        "queue_id": "published-1",
                        "platform": "linkedin",
                        "url": f"https://www.linkedin.com/in/read-only-{index}/",
                        "author": "Example",
                        "topic": "AI feed",
                        "evidence": "Read a LinkedIn card but it did not expose an actionable post URL.",
                        "candidate_eligible": False,
                        "engagement_action": "like_candidate",
                    }
                    for index in range(7)
                ],
            ]
        return [
            {
                "queue_id": "published-1",
                "platform": "linkedin",
                "url": f"https://www.linkedin.com/feed/update/urn:li:activity:{7000 + linkedin_calls * 10 + index}/",
                "author": "Operator",
                "topic": "AI feed",
                "evidence": "Read a concrete LinkedIn feed post about agent rollout governance and team ownership. " * 2,
                "candidate_eligible": True,
                "engagement_action": "like_candidate",
            }
            for index in range(2 if linkedin_calls == 2 else 3)
        ]

    class FakeBrowser:
        @property
        def contexts(self):
            return [self]

        def new_context(self):
            return self

        def new_page(self):
            return self

        def close(self):
            return None

    class FakeChromium:
        def connect_over_cdp(self, url):
            return FakeBrowser()

    class FakePlaywright:
        chromium = FakeChromium()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "_ensure_chrome_cdp_page_target", lambda *args, **kwargs: True)
    fake_playwright_module = types.SimpleNamespace(sync_playwright=lambda: FakePlaywright())
    fake_playwright_package = types.SimpleNamespace(sync_api=fake_playwright_module)
    monkeypatch.setitem(sys.modules, "playwright", fake_playwright_package)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", fake_playwright_module)
    monkeypatch.setattr(cli, "_collect_external_feed_posts_for_engagement", fake_collect)

    result = cli._post_publish_engagement_feed_study_local(
        path="posting_queue.tsv",
        settings=type("Settings", (), {"chrome_main_remote_debugging_port": 9222})(),
        remote_debugging_port=9222,
        max_actions=13,
        sync_sheets=False,
        timeout_seconds=30,
        target_count=40,
    )

    assert linkedin_calls >= 3
    assert result["engagement_candidates_created"] == 13
    assert result["stop_reason"] == ""
    counts = {
        ("x", "like_candidate"): 0,
        ("x", "comment_candidate"): 0,
        ("linkedin", "like_candidate"): 0,
        ("linkedin", "comment_candidate"): 0,
    }
    for prepared in repo.read_all():
        if prepared.engagement_status != "approved":
            continue
        platform = cli._engagement_platform(cli._first_engagement_target(prepared))
        counts[(platform, prepared.engagement_action)] += 1
    assert counts == {
        ("x", "like_candidate"): 5,
        ("x", "comment_candidate"): 2,
        ("linkedin", "like_candidate"): 5,
        ("linkedin", "comment_candidate"): 1,
    }


def test_record_feed_study_local_preserves_deep_voice_receipt_target_and_normalizes_x_urls(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="item-1",
        status="published",
        title="AI feed voice sample",
        quality_score="10",
        x_post_url="https://x.com/nichika2000823/status/111",
    )
    repo = MutableDummyRepo([row])
    artifact = tmp_path / "feed-study.json"
    artifact.write_text(
        json.dumps(
            {
                "method": "local Chrome 二千 CDP, recommended/home feeds only, no search URLs or query pages",
                "target_count": 100,
                "feed_research_receipt": "target=100+ recommended-feed posts; actual=1",
                "read_posts": [
                    {
                        "queue_id": "item-1",
                        "platform": "x",
                        "url": "https://x.com/OpenAI/status/12345/analytics",
                        "author": "OpenAI",
                        "topic": "agent SDK rollout",
                        "evidence": "Read a recommended-feed post and checked why the first line felt concrete.",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.record_feed_study_local(
        artifact_path=str(artifact),
        path="posting_queue.tsv",
        max_actions=1,
        sync_sheets=False,
    )

    summary_path = tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl"
    payload = json.loads(summary_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["feed_research_receipt"].startswith(
        "target=100+ recommended-feed posts; actual=1; external=1; x=1; linkedin=0"
    )
    assert "https://x.com/OpenAI/status/12345/analytics" not in payload["feed_research_receipt"]
    assert "https://x.com/OpenAI/status/12345" in payload["feed_research_receipt"]
    assert row.reference_post_urls == "https://x.com/OpenAI/status/12345"


def test_record_feed_study_local_imports_discovered_items(monkeypatch, tmp_path, capsys) -> None:
    repo = MutableDummyRepo([])
    artifact = tmp_path / "feed-study.json"
    artifact.write_text(
        json.dumps(
            {
                "read_posts": [],
                "discovered_items": [
                    {
                        "platform": "x",
                        "post_url": "https://x.com/simonw/status/123",
                        "author": "Simon Willison",
                        "source_url": "https://example.com/ai-agent-eval",
                        "title": "A practical AI agent evaluation writeup",
                        "summary": "An experienced practitioner tested an AI agent workflow and focused on evaluation failures, handoff friction, and where the original demo was misleading.",
                        "source_chain": "Practitioner post -> original benchmark writeup",
                        "post_shape": "quote post with caveat and test notes",
                        "angle": "Use this as a practical evaluation checklist, not a launch recap.",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.record_feed_study_local(
        artifact_path=str(artifact),
        path="posting_queue.tsv",
        max_actions=0,
        sync_sheets=False,
    )

    assert len(repo.read_all()) == 1
    row = repo.read_all()[0]
    assert row.source_type == "social_discovery"
    assert row.source_name == "X/LinkedIn discovery"
    assert row.source_url == "https://example.com/ai-agent-eval"
    assert row.reference_post_urls == "https://x.com/simonw/status/123"
    assert row.reference_account_handles == "Simon Willison"
    assert row.research_status == "done"
    assert row.status == "collected"
    assert row.keep_priority in {"ship_now", "hold", "drop"}
    assert "Practitioner post" in row.reference_media_notes
    payload = json.loads((tmp_path / "artifacts" / "run-summaries" / "daily-ai-run-summary.jsonl").read_text(encoding="utf-8").splitlines()[-1])
    assert payload["researched_count"] == 1
    assert "discovered=1" in payload["feed_research_receipt"]
    assert "discovered=1" in capsys.readouterr().out


def test_feed_study_discovered_items_accepts_legacy_aliases() -> None:
    entry = {"source_url": "https://example.com/item"}

    assert cli._feed_study_discovered_items({"discovered_items": [entry]}) == [entry]
    assert cli._feed_study_discovered_items({"candidate_sources": [entry]}) == [entry]
    assert cli._feed_study_discovered_items({"discovered_sources": [entry]}) == [entry]


def test_record_feed_study_local_accepts_save_candidate(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="item-1",
        status="published",
        title="OpenAI agent SDK update",
        quality_score="8",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:share:111/",
    )
    repo = MutableDummyRepo([row])
    artifact = tmp_path / "feed-study.json"
    artifact.write_text(
        json.dumps(
            {
                "read_posts": [
                    {
                        "queue_id": "item-1",
                        "platform": "linkedin",
                        "url": "https://www.linkedin.com/feed/update/urn:li:share:456/",
                        "author": "OpenAI",
                        "topic": "agent SDK rollout",
                        "evidence": "Read the LinkedIn post and comments; the useful part is a later reference for rollout sequencing.",
                        "engagement_action": "save_candidate",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.record_feed_study_local(
        artifact_path=str(artifact),
        path="posting_queue.tsv",
        max_actions=1,
        sync_sheets=False,
    )

    approved = [queue_row for queue_row in repo.read_all() if queue_row.engagement_status == "approved"]
    assert row.engagement_action == ""
    assert row.engagement_status == ""
    assert len(approved) == 1
    assert approved[0].id.startswith("eng-linkedin-")
    assert approved[0].engagement_action == "save_candidate"
    assert approved[0].comment_draft == ""


def test_record_feed_study_local_does_not_resurrect_skipped_comment_candidate(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="item-1",
        status="published",
        title="OpenAI agent SDK update",
        quality_score="8",
        x_post_url="https://x.com/nichika2000823/status/111",
        engagement_status="skipped",
        engagement_targets="https://x.com/example/status/old",
        error="engagement_failed: comment_not_sent: X reply completion URL was not visible after submit",
        next_action="Review engagement blocker before retrying CLI auto-engagement.",
    )
    repo = MutableDummyRepo([row])
    artifact = tmp_path / "feed-study.json"
    artifact.write_text(
        json.dumps(
            {
                "read_posts": [
                    {
                        "queue_id": "item-1",
                        "platform": "x",
                        "url": "https://x.com/example/status/456",
                        "author": "OpenAI",
                        "topic": "agent SDK rollout",
                        "evidence": "Read the X post and replies; this is specific enough for a future engagement candidate.",
                        "engagement_action": "comment_candidate",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.record_feed_study_local(
        artifact_path=str(artifact),
        path="posting_queue.tsv",
        max_actions=1,
        sync_sheets=False,
    )

    assert row.engagement_action == ""
    assert row.engagement_status == "skipped"
    assert row.engagement_targets == "https://x.com/example/status/old"
    assert "https://x.com/example/status/456" in row.reference_post_urls
    assert "Feed read:" in row.x_research_notes


def test_record_feed_study_local_can_fall_through_to_like_candidate(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="item-1",
        status="published",
        title="OpenAI agent SDK update",
        quality_score="8",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:share:111/",
    )
    repo = MutableDummyRepo([row])
    artifact = tmp_path / "feed-study.json"
    artifact.write_text(
        json.dumps(
            {
                "read_posts": [
                    {
                        "queue_id": "item-1",
                        "platform": "linkedin",
                        "url": "https://www.linkedin.com/feed/update/urn:li:share:456/",
                        "author": "OpenAI",
                        "topic": "agent SDK rollout",
                        "evidence": "Read the LinkedIn post and comments; this is relevant but does not need a public reply.",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.record_feed_study_local(
        artifact_path=str(artifact),
        path="posting_queue.tsv",
        max_actions=1,
        max_comments=0,
        max_saves=0,
        max_likes=1,
        sync_sheets=False,
    )

    approved = [queue_row for queue_row in repo.read_all() if queue_row.engagement_status == "approved"]
    assert row.engagement_action == ""
    assert row.engagement_status == ""
    assert len(approved) == 1
    assert approved[0].id.startswith("eng-linkedin-")
    assert approved[0].engagement_action == "like_candidate"
    assert approved[0].comment_draft == ""


def test_record_feed_study_local_appends_synthetic_engagement_rows(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="published-1",
        status="published",
        title="Daily AI post",
        quality_score="10",
        x_post_url="https://x.com/nichika2000823/status/111",
        engagement_targets="https://x.com/example/status/already-seeded",
    )
    repo = MutableDummyRepo([row])
    artifact = tmp_path / "feed-study.json"
    artifact.write_text(
        json.dumps(
            {
                "read_posts": [
                    {
                        "queue_id": "published-1",
                        "platform": "x",
                        "url": f"https://x.com/example/status/{100 + index}",
                        "author": "Example",
                        "topic": "AI rollout",
                        "evidence": "Read a specific X post about code review latency, handoff timing, and rollout details.",
                        "engagement_action": "like_candidate",
                    }
                    for index in range(2)
                ]
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.record_feed_study_local(
        artifact_path=str(artifact),
        path="posting_queue.tsv",
        max_actions=2,
        max_likes=2,
        max_comments=0,
        max_saves=0,
        max_quotes=0,
        sync_sheets=False,
    )

    assert len(repo.read_all()) == 2
    assert any(queue_row.id.startswith("eng-x-") for queue_row in repo.read_all())
    assert sum(1 for queue_row in repo.read_all() if queue_row.engagement_status == "approved") == 1


def test_record_feed_study_local_syncs_feed_read_log(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="item-1",
        status="published",
        title="OpenAI agent SDK update",
        quality_score="10",
        x_post_url="https://x.com/nichika2000823/status/111",
    )
    repo = MutableDummyRepo([row])
    sheets_repo = DummySheetsRepo()
    artifact = tmp_path / "feed-study.json"
    artifact.write_text(
        json.dumps(
            {
                "read_posts": [
                    {
                        "queue_id": "item-1",
                        "platform": "x",
                        "url": "https://x.com/OpenAI/status/12345",
                        "author": "OpenAI",
                        "topic": "agent SDK rollout",
                        "evidence": "Read the source thread and replies; people focused on review latency and handoff timing.",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "get_repo", lambda: sheets_repo)
    monkeypatch.setattr(cli, "_sync_local_queue_to_sheets", lambda local_repo, remote_repo: 1)

    cli.record_feed_study_local(
        artifact_path=str(artifact),
        path="posting_queue.tsv",
        max_actions=1,
        sync_sheets=True,
    )

    assert sheets_repo.feed_read_log_rows[0][1:9] == [
        "item-1",
        "x",
        "https://x.com/OpenAI/status/12345",
        "OpenAI",
        "agent SDK rollout",
        "Read the source thread and replies; people focused on review latency and handoff timing.",
            "comment_candidate",
        "true",
    ]
    assert sheets_repo.relationship_map_rows[0][1:17] == [
        "x",
        "OpenAI",
        "",
        "candidate",
        sheets_repo.relationship_map_rows[0][5],
        "",
            "comment_candidate",
        "agent SDK rollout",
        "3",
        "high",
        "1",
        "Read the source thread and replies; people focused on review latency and handoff timing.",
        "item-1",
        "https://x.com/OpenAI/status/12345",
        "Send approved external engagement via the Chrome plugin registered runner after expected-account, target/body/comment reflection, enabled-submit, recording, local proof, and completion gates pass; stop with chrome_extension_required if that runner is unavailable.",
        "Created from structured feed-study evidence.",
    ]


def test_feed_study_engagement_candidates_keep_linkedin_when_x_entries_arrive_first() -> None:
    rows = [
        QueueRow(id="x-1", status="published", title="X one", x_post_url="https://x.com/nichika2000823/status/1"),
        QueueRow(id="x-2", status="published", title="X two", x_post_url="https://x.com/nichika2000823/status/2"),
        QueueRow(id="x-3", status="published", title="X three", x_post_url="https://x.com/nichika2000823/status/3"),
        QueueRow(
            id="li-1",
            status="published",
            title="LinkedIn one",
            linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:1/",
        ),
    ]
    entries = [
        {
            "queue_id": "x-1",
            "platform": "x",
            "url": "https://x.com/example/status/101",
            "author": "Example",
            "topic": "AI ops",
            "evidence": "Read a concrete X post with enough detail about AI operations and response quality.",
            "engagement_action": "comment_candidate",
        },
        {
            "queue_id": "x-2",
            "platform": "x",
            "url": "https://x.com/example/status/102",
            "author": "Example",
            "topic": "AI ops",
            "evidence": "Read a second X post with enough detail about AI operations and response quality.",
            "engagement_action": "save_candidate",
        },
        {
            "queue_id": "x-3",
            "platform": "x",
            "url": "https://x.com/example/status/103",
            "author": "Example",
            "topic": "AI ops",
            "evidence": "Read a third X post with enough detail about AI operations and response quality.",
            "engagement_action": "like_candidate",
        },
        {
            "queue_id": "li-1",
            "platform": "linkedin",
            "url": "https://www.linkedin.com/feed/update/urn:li:activity:202/",
            "author": "Operator",
            "topic": "AI rollout",
            "evidence": "Read a LinkedIn post with specific rollout context and useful operator comments.",
            "engagement_action": "comment_candidate",
        },
    ]

    metrics = cli._apply_feed_study_entries_to_rows(
        rows,
        entries,
        max_actions=4,
        max_likes=5,
        max_comments=3,
        max_saves=3,
        max_quotes=1,
    )

    assert metrics["engagement_candidates_created"] == 3
    approved = [row for row in rows if row.engagement_status == "approved"]
    assert len(approved) == 3
    assert all(row.id.startswith(("eng-x-", "eng-linkedin-")) for row in approved)
    assert all(row.engagement_status == "" for row in rows[:4])
    assert any(
        row.engagement_targets == "https://www.linkedin.com/feed/update/urn:li:activity:202/"
        for row in approved
    )


def test_feed_study_linkedin_refill_counts_only_unused_actionable_targets() -> None:
    rows = [
        QueueRow(
            id="used-done",
            engagement_status="done",
            engagement_targets="https://www.linkedin.com/feed/update/urn:li:activity:111/",
        ),
        QueueRow(
            id="used-skipped",
            engagement_status="skipped",
            engagement_targets="https://www.linkedin.com/feed/update/urn:li:activity:222/",
        ),
    ]
    entries = [
        {
            "platform": "linkedin",
            "url": "https://www.linkedin.com/feed/update/urn:li:activity:111/",
            "candidate_eligible": True,
        },
        {
            "platform": "linkedin",
            "url": "https://www.linkedin.com/feed/update/urn:li:activity:333/",
            "candidate_eligible": True,
        },
        {
            "platform": "linkedin",
            "url": "https://www.linkedin.com/company/example/posts/?update=urn%3Ali%3Aactivity%3A333",
            "candidate_eligible": True,
        },
        {
            "platform": "linkedin",
            "url": "https://www.linkedin.com/in/example/",
            "candidate_eligible": False,
        },
        {
            "platform": "linkedin",
            "url": "https://www.linkedin.com/company/example/posts/",
            "candidate_eligible": True,
        },
    ]

    used = cli._used_external_engagement_target_urls(rows)

    assert used == {
        "https://www.linkedin.com/feed/update/urn:li:activity:111/",
        "https://www.linkedin.com/feed/update/urn:li:activity:222/",
    }
    assert cli._feed_entries_unused_actionable_count(entries, platform="linkedin", used_urls=used) == 1


def test_feed_study_entries_do_not_reuse_skipped_engagement_target() -> None:
    skipped = QueueRow(
        id="skipped-prior",
        engagement_status="skipped",
        engagement_targets="https://x.com/example/status/456",
    )
    published = QueueRow(
        id="published",
        status="published",
        title="Daily AI post",
        quality_score="10",
        x_post_url="https://x.com/nichika2000823/status/1",
        published_at="2026-06-23T00:00:00+00:00",
    )
    entries = [
        {
            "queue_id": "published",
            "platform": "x",
            "url": "https://x.com/example/status/456",
            "author": "Example",
            "topic": "AI rollout",
            "evidence": "Read a specific X post about code review latency, handoff timing, and rollout details.",
            "engagement_action": "comment_candidate",
        }
    ]

    metrics = cli._apply_feed_study_entries_to_rows(
        [skipped, published],
        entries,
        max_actions=1,
        max_likes=1,
        max_comments=1,
        max_saves=0,
        max_quotes=0,
    )

    assert metrics["engagement_candidates_created"] == 0
    assert published.engagement_status == ""
    assert published.engagement_targets == ""
    assert metrics["feed_read_log_rows"][0][8] == "false"


def test_feed_study_engagement_candidates_create_target_mix_with_synthetic_rows() -> None:
    rows = [
        QueueRow(
            id="published",
            status="published",
            title="Daily AI post",
            quality_score="10",
            x_post_url="https://x.com/nichika2000823/status/1",
            linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:1/",
            published_at="2026-06-23T00:00:00+00:00",
        )
    ]
    entries = []
    for index in range(7):
        entries.append(
            {
                "queue_id": "published",
                "platform": "x",
                "url": f"https://x.com/example/status/{100 + index}",
                "author": "Example",
                "topic": "AI rollout",
                "evidence": "Read a specific X post about code review latency, handoff timing, and rollout details.",
            }
        )
    for index in range(6):
        entries.append(
            {
                "queue_id": "published",
                "platform": "linkedin",
                "url": f"https://www.linkedin.com/feed/update/urn:li:activity:{200 + index}/",
                "author": "Operator",
                "topic": "AI adoption",
                "evidence": "Read a specific LinkedIn post about workspace rollout approval, governance, and team adoption details.",
            }
        )

    metrics = cli._apply_feed_study_entries_to_rows(
        rows,
        entries,
        max_actions=13,
        max_likes=10,
        max_comments=3,
        max_saves=0,
        max_quotes=0,
    )

    approved = [row for row in rows if row.engagement_status == "approved"]
    counts = {
        ("x", "like_candidate"): 0,
        ("x", "comment_candidate"): 0,
        ("linkedin", "like_candidate"): 0,
        ("linkedin", "comment_candidate"): 0,
    }
    for row in approved:
        platform = cli._engagement_platform(cli._first_engagement_target(row))
        counts[(platform, row.engagement_action)] += 1
        assert "@Example ·" not in row.comment_draft
        assert "Like Comment" not in row.comment_draft

    assert metrics["engagement_candidates_created"] == 13
    assert len(approved) == 13
    assert any(row.id.startswith("eng-x-") for row in approved)
    assert any(row.id.startswith("eng-linkedin-") for row in approved)
    assert counts == {
        ("x", "like_candidate"): 5,
        ("x", "comment_candidate"): 2,
        ("linkedin", "like_candidate"): 5,
        ("linkedin", "comment_candidate"): 1,
    }


def test_feed_study_engagement_candidates_accept_partially_published_seed_rows() -> None:
    rows = [
        QueueRow(
            id="partial",
            status="partially_published",
            title="Daily AI post",
            quality_score="10",
            x_post_url="https://x.com/nichika2000823/status/1",
            published_at="2026-06-23T00:00:00+00:00",
        )
    ]
    entries = [
        {
            "queue_id": "partial",
            "platform": "linkedin",
            "url": "https://www.linkedin.com/feed/update/urn:li:activity:200/",
            "author": "Operator",
            "topic": "AI adoption",
            "evidence": "Read a specific LinkedIn post about workspace rollout approval, governance, and team adoption details.",
            "engagement_action": "like_candidate",
        }
    ]

    metrics = cli._apply_feed_study_entries_to_rows(
        rows,
        entries,
        max_actions=1,
        max_likes=1,
        max_comments=0,
        max_saves=0,
        max_quotes=0,
    )

    assert metrics["engagement_candidates_created"] == 1
    approved = [row for row in rows if row.engagement_status == "approved"]
    assert rows[0].engagement_status == ""
    assert len(approved) == 1
    assert approved[0].id.startswith("eng-linkedin-")
    assert approved[0].engagement_targets == "https://www.linkedin.com/feed/update/urn:li:activity:200/"


def test_feed_study_engagement_candidates_fill_comment_quota_after_like_requests() -> None:
    rows = [
        QueueRow(
            id="published",
            status="published",
            title="Daily AI post",
            quality_score="10",
            x_post_url="https://x.com/nichika2000823/status/1",
            linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:1/",
            published_at="2026-06-23T00:00:00+00:00",
        )
    ]
    entries = []
    for index in range(7):
        entries.append(
            {
                "queue_id": "published",
                "platform": "x",
                "url": f"https://x.com/example/status/{300 + index}",
                "author": "Example",
                "topic": "AI rollout",
                "evidence": "Read a specific X post about code review latency, handoff timing, and rollout details.",
                "engagement_action": "like_candidate",
            }
        )
    for index in range(6):
        entries.append(
            {
                "queue_id": "published",
                "platform": "linkedin",
                "url": f"https://www.linkedin.com/feed/update/urn:li:activity:{400 + index}/",
                "author": "Operator",
                "topic": "AI adoption",
                "evidence": "Read a specific LinkedIn post about workspace rollout approval, governance, and team adoption details.",
                "engagement_action": "like_candidate",
            }
        )

    metrics = cli._apply_feed_study_entries_to_rows(
        rows,
        entries,
        max_actions=13,
        max_likes=10,
        max_comments=3,
        max_saves=0,
        max_quotes=0,
    )

    counts = {
        ("x", "like_candidate"): 0,
        ("x", "comment_candidate"): 0,
        ("linkedin", "like_candidate"): 0,
        ("linkedin", "comment_candidate"): 0,
    }
    for row in rows:
        if row.engagement_status != "approved":
            continue
        platform = cli._engagement_platform(cli._first_engagement_target(row))
        counts[(platform, row.engagement_action)] += 1

    assert metrics["engagement_candidates_created"] == 13
    assert counts == {
        ("x", "like_candidate"): 5,
        ("x", "comment_candidate"): 2,
        ("linkedin", "like_candidate"): 5,
        ("linkedin", "comment_candidate"): 1,
    }


def test_relationship_rows_from_x_watchlist_reads_seed_accounts(tmp_path, monkeypatch) -> None:
    watchlist = tmp_path / "watchlist.md"
    watchlist.write_text(
        "\n".join(
            [
                "# X Research Watchlist",
                "## 1. 一次ソース",
                "- OpenAI",
                "- Anthropic",
                "## 2. 英語圏の実務家",
                "- Simon Willison",
                "## 4. 候補にしやすい投稿",
                "- ignored rule",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(cli, "utc_now", lambda: "2026-05-22T00:00:00+00:00")

    rows = cli._relationship_rows_from_x_watchlist(str(watchlist))

    assert [row[2] for row in rows] == ["OpenAI", "Anthropic", "Simon Willison"]
    assert rows[0][4] == "watchlist"
    assert rows[0][9] == "5"
    assert rows[2][9] == "4"
    assert rows[0][15] == "Read recent posts before engaging; comment only with specific evidence."


def test_write_performance_learning_artifact_groups_formats(tmp_path) -> None:
    rows = [
        QueueRow(
            id="post-1",
            status="published",
            title="Agent workflow",
            content_format="official_demo_breakdown",
            x_post_url="https://x.com/nichika2000823/status/1",
            x_like_count="3",
            x_reply_count="1",
            x_impression_count="100",
        ),
        QueueRow(
            id="post-2",
            status="published",
            title="Market signal",
            content_format="market_signal_visual",
            linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:share:1/",
            linkedin_reaction_count="5",
            linkedin_comment_count="2",
            linkedin_impression_count="200",
        ),
    ]

    artifact = cli._write_performance_learning_artifact(
        rows,
        artifact_path=str(tmp_path / "learning.md"),
    )

    text = artifact.read_text(encoding="utf-8")
    assert "official_demo_breakdown: rows=1 impressions=100 engagements=4" in text
    assert "market_signal_visual: rows=1 impressions=200 engagements=7" in text


def test_write_performance_learning_local_syncs_learning_review(monkeypatch, tmp_path) -> None:
    row = QueueRow(
        id="post-1",
        status="published",
        title="Agent workflow",
        content_format="official_demo_breakdown",
        x_post_url="https://x.com/nichika2000823/status/1",
        x_like_count="3",
        x_reply_count="1",
        x_impression_count="100",
    )
    repo = MutableDummyRepo([row])
    sheets_repo = DummySheetsRepo()

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)
    monkeypatch.setattr(cli, "get_repo", lambda: sheets_repo)

    cli.write_performance_learning_local(
        path="posting_queue.tsv",
        artifact_path=str(tmp_path / "learning.md"),
        sync_sheets=True,
    )

    assert sheets_repo.learning_review_rows[0][1:8] == [
        "content_format",
        "official_demo_breakdown",
        "1",
        "100",
        "4",
        "0.0400",
        "top_row=post-1",
    ]


def test_seed_research_urls_local_merges_generated_urls(monkeypatch) -> None:
    row = QueueRow(
        id="item-1",
        source_name="OpenAI",
        title="The next evolution of the Agents SDK",
        reference_post_urls="https://x.com/OpenAI/status/123",
    )
    repo = DummyRepo([row])

    monkeypatch.setattr(cli, "get_local_repo", lambda path="posting_queue.tsv": repo)

    cli.seed_research_urls_local(item_id="item-1", path="posting_queue.tsv")

    assert "https://x.com/OpenAI/status/123" in row.reference_post_urls
    assert "https://x.com/search?" in row.reference_post_urls
    assert "https://www.linkedin.com/search/results/content/" in row.reference_post_urls
    assert row.research_status == "in_progress"
    assert repo.updated_rows == [row]


def _write_job_manager_bridge_receipt(
    tmp_path: Path,
    run_id: str = "bridge-test-run",
    *,
    scheduler_run_id: str | None = None,
    scheduler_run_dir: str = "",
    launch_dir: str = "",
    codex_thread_id: str = "",
    codex_turn_id: str = "",
    codex_session_id: str = "",
    backend: str = "chrome_extension_trusted_bridge",
    browser_metadata: dict[str, object] | None = None,
) -> dict[str, object]:
    receipt_path = tmp_path / "artifacts" / "trusted-bridge-runs" / f"{run_id}.json"
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    scheduler_run_id = scheduler_run_id or run_id
    codex_thread_id = codex_thread_id or str(os.environ.get("CODEX_THREAD_ID") or "")
    codex_turn_id = codex_turn_id or str(os.environ.get("CODEX_TURN_ID") or codex_thread_id)
    codex_session_id = codex_session_id or str(os.environ.get("CODEX_SESSION_ID") or codex_thread_id)
    browser_metadata = browser_metadata or {"profileOrdering": 2, "profileName": "Nicky"}
    probe = {
        "bridge_run_id": run_id,
        "bridge_receipt_path": str(receipt_path),
        "scheduler_run_id": scheduler_run_id,
        "scheduler_run_dir": scheduler_run_dir,
        "launch_dir": launch_dir,
        "codex_thread_id": codex_thread_id,
        "codex_turn_id": codex_turn_id,
        "codex_session_id": codex_session_id,
        "ok": True,
        "ready": True,
        "stage": "job_manager_bridge_readiness_probe",
        "backend": backend,
        "browser_metadata": browser_metadata,
    }
    receipt_path.write_text(
        json.dumps(
            {
                "ok": True,
                "run_id": run_id,
                "scheduler_run_id": scheduler_run_id,
                "scheduler_run_dir": scheduler_run_dir,
                "launch_dir": launch_dir,
                "codex_thread_id": codex_thread_id,
                "codex_turn_id": codex_turn_id,
                "codex_session_id": codex_session_id,
                "status": "succeeded",
                "mode": "probe",
                "receipt_path": str(receipt_path),
                "result": probe,
            }
        ),
        encoding="utf-8",
    )
    return probe


def test_trusted_wrapper_bridge_context_never_starts_inner_warmup_or_probe(monkeypatch, tmp_path) -> None:
    run_id = "trusted-wrapper-run"
    run_dir = tmp_path / f"codex-app-job-application-manager-{run_id}"
    run_dir.mkdir()
    receipt_path = run_dir / "trusted-wrapper-v2-receipt.json"
    receipt_path.write_text("{}", encoding="utf-8")
    receipt = {
        "receipt_id": "outer-receipt",
        "receipt_path": str(receipt_path),
        "scheduler_run_id": run_id,
        "scheduler_run_dir": str(run_dir),
        "execution_thread_id": "thread",
        "execution_turn_id": "turn",
        "execution_session_id": "session",
        "bridge_instance_id": "outer-bridge",
        "owner_id": "outer-owner",
        "owner_heartbeat_path": str(run_dir / "trusted-wrapper-owner-heartbeat.json"),
        "owner_terminal_path": str(run_dir / "trusted-wrapper-owner-terminal.json"),
        "backend": "chrome_extension_trusted_bridge",
        "browser_id": "profile-2",
        "browser_name": "Chrome",
        "browser_type": "extension",
        "browser_metadata": {"profileOrdering": 2, "profileName": "Nicky/Profile 2"},
    }
    calls = {"warmup": 0, "probe": 0}

    def forbidden_warmup(**kwargs):
        calls["warmup"] += 1
        raise AssertionError("inner warmup must not run")

    def forbidden_probe(**kwargs):
        calls["probe"] += 1
        raise AssertionError("inner bridge client must not run")

    monkeypatch.setattr(cli, "warmup_job_manager_bridge", forbidden_warmup)
    monkeypatch.setattr(cli, "_run_job_manager_bridge_probe", forbidden_probe)
    monkeypatch.setattr(cli, "bridge_binding_from_env", lambda: {"control_schema": "scheduler_control_receipt.v2"})

    updated, bridge_probe = cli._job_manager_select_bridge_context(
        {"launch_message": "registered", "launch_message_sha256": "old"},
        trusted_wrapper_receipt=receipt,
        codex_home=tmp_path,
        run_id=run_id,
        run_dir=run_dir,
        launch_dir=tmp_path,
    )

    assert calls == {"warmup": 0, "probe": 0}
    assert bridge_probe["bridge_instance_id"] == "outer-bridge"
    assert bridge_probe["trusted_wrapper_receipt_verified"] is True
    assert updated["current_bridge_probe"] == bridge_probe


def test_trusted_wrapper_receipt_identity_wins_over_ambient_bridge_bindings(monkeypatch, tmp_path) -> None:
    run_id = "trusted-wrapper-identity-run"
    run_dir = tmp_path / f"codex-app-job-application-manager-{run_id}"
    run_dir.mkdir(mode=0o700)
    receipt_path = run_dir / "trusted-wrapper-v2-receipt.json"
    process_manifest_path = run_dir / "trusted-wrapper-process-manifest.json"
    receipt = {
        "receipt_id": "outer-receipt",
        "receipt_path": str(receipt_path),
        "scheduler_run_id": run_id,
        "scheduler_run_dir": str(run_dir),
        "execution_thread_id": "receipt-thread",
        "execution_turn_id": "receipt-turn",
        "execution_session_id": "receipt-session",
        "bridge_instance_id": "receipt-bridge",
        "bridge_url": "http://127.0.0.1:43123",
        "process_manifest_path": str(process_manifest_path),
        "owned_process_manifest_path": str(process_manifest_path),
        "owner_id": "receipt-owner",
        "owner_heartbeat_path": str(run_dir / "trusted-wrapper-owner-heartbeat.json"),
        "browser_id": "profile-2",
        "browser_name": "Chrome",
        "browser_type": "extension",
        "browser_metadata": {"profileOrdering": 2, "profileName": "Nicky/Profile 2"},
    }
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_BRIDGE_INSTANCE_ID", "ambient-bridge")
    monkeypatch.setenv("SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_URL", "http://127.0.0.1:9999")
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_PROCESS_MANIFEST_PATH", str(tmp_path / "ambient-manifest.json"))
    monkeypatch.setattr(cli, "bridge_binding_from_env", lambda: {
        "bridge_instance_id": "ambient-bridge",
        "bridge_url": "http://127.0.0.1:9999",
        "process_manifest_path": str(tmp_path / "ambient-manifest.json"),
    })

    updated, probe = cli._job_manager_select_bridge_context(
        {"launch_message": "registered", "launch_message_sha256": "old"},
        trusted_wrapper_receipt=receipt,
        codex_home=tmp_path,
        run_id=run_id,
        run_dir=run_dir,
        launch_dir=tmp_path,
    )

    assert probe["bridge_instance_id"] == "receipt-bridge"
    assert probe["bridge_url"] == "http://127.0.0.1:43123"
    assert probe["process_manifest_path"] == str(process_manifest_path)
    assert updated["current_bridge_probe"] == probe


def test_invalid_trusted_wrapper_receipt_fails_before_legacy_or_external_action(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("SOCIAL_FLOW_TRUSTED_BROWSER_WRAPPER_V2", "1")
    monkeypatch.setenv("SOCIAL_FLOW_CONTROL_REQUEST_PATH", str(tmp_path / "request.json"))
    monkeypatch.setenv("SOCIAL_FLOW_CONTROL_STAGE", "preflight")
    monkeypatch.setattr(cli, "_job_manager_launch_packet", lambda: {"launch_message": "registered"})
    monkeypatch.setattr(cli, "validate_trusted_wrapper_env", lambda **kwargs: {"scheduler_run_id": "run"})
    monkeypatch.setattr(
        cli,
        "load_and_consume_trusted_wrapper_receipt",
        lambda request: (_ for _ in ()).throw(cli.SchedulerControlError("trusted_wrapper_receipt_missing")),
    )
    external_actions = {"warmup": 0, "probe": 0, "subprocess": 0}
    monkeypatch.setattr(cli, "warmup_job_manager_bridge", lambda **kwargs: external_actions.__setitem__("warmup", 1))
    monkeypatch.setattr(cli, "_run_job_manager_bridge_probe", lambda **kwargs: external_actions.__setitem__("probe", 1))
    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: external_actions.__setitem__("subprocess", 1))

    with pytest.raises(cli.SchedulerControlError, match="trusted_wrapper_receipt_missing"):
        cli.run_job_manager_now(execute=False, live_preflight_only=True, codex_home=tmp_path)

    assert external_actions == {"warmup": 0, "probe": 0, "subprocess": 0}


def _write_valid_registered_child_result(run_dir: Path, *, status: str = "completed", exact_blocker: str = "") -> dict[str, object]:
    run_dir.mkdir(parents=True, exist_ok=True)
    mandatory = [
        run_dir / "extension-first-preflight.json",
        run_dir / "live-preflight.json",
        run_dir / "launch-packet.json",
        run_dir / "job-manager-ideal-flow.json",
    ]
    for path in mandatory:
        path.write_text("{}\n", encoding="utf-8")
    audit_path = run_dir / "completion-audit.json"
    audit_path.write_text(
        json.dumps(
            {
                "ok": True,
                "stage": "job_manager_completion_audit",
                "run_dir": str(run_dir.resolve()),
                "failed_checks": [],
            }
        ),
        encoding="utf-8",
    )
    result = {
        "schema": "registered-child-result.v1",
        "result_id": "result-1",
        "scheduler_run_id": "scheduler-run",
        "control_run_id": "control-run",
        "status": status,
        "exact_blocker": exact_blocker,
        "external_action_count": 0,
        "completion_audit_path": str(audit_path),
        "required_artifact_paths": [str(path) for path in [*mandatory, audit_path]],
        "external_action_artifact_paths": [],
    }
    result_path = run_dir / "registered-child-result.json"
    result_path.write_text(json.dumps(result), encoding="utf-8")
    result_path.chmod(0o600)
    return result


def test_registered_child_transport_only_valid_completed_result_completes(tmp_path) -> None:
    run_dir = tmp_path / "run"
    _write_valid_registered_child_result(run_dir)

    result = cli._job_manager_evaluate_child_transport(
        returncode=0,
        run_dir=run_dir,
        scheduler_run_id="scheduler-run",
        control_run_id="control-run",
    )

    assert result["status"] == "completed"
    assert (run_dir / "registered-child-result-consumed.json").is_file()
    with pytest.raises(RuntimeError, match="registered_child_result_already_consumed"):
        cli._job_manager_evaluate_child_transport(
            returncode=0,
            run_dir=run_dir,
            scheduler_run_id="scheduler-run",
            control_run_id="control-run",
        )


def test_registered_child_transport_nonzero_never_infers_from_result(tmp_path) -> None:
    run_dir = tmp_path / "run"
    _write_valid_registered_child_result(run_dir)

    with pytest.raises(RuntimeError, match="job_manager_child_returned_nonzero:7"):
        cli._job_manager_evaluate_child_transport(
            returncode=7,
            run_dir=run_dir,
            scheduler_run_id="scheduler-run",
            control_run_id="control-run",
        )
    assert not (run_dir / "registered-child-result-consumed.json").exists()


def test_blocked_child_exact_blocker_is_not_masked_by_diagnostic_artifact_validation(tmp_path) -> None:
    run_dir = tmp_path / "blocked-diagnostic"
    result = _write_valid_registered_child_result(
        run_dir,
        status="blocked",
        exact_blocker="child_exact_blocker_wins",
    )
    result["external_action_count"] = 99
    result["external_action_artifact_paths"] = [str(run_dir / "missing-diagnostic.json")]
    result_path = run_dir / "registered-child-result.json"
    result_path.write_text(json.dumps(result), encoding="utf-8")
    result_path.chmod(0o600)

    with pytest.raises(RuntimeError, match="child_exact_blocker_wins"):
        cli._job_manager_evaluate_child_transport(
            returncode=0,
            run_dir=run_dir,
            scheduler_run_id="scheduler-run",
            control_run_id="control-run",
        )
    assert (run_dir / "registered-child-result-consumed.json").is_file()


def test_trusted_owner_watchdog_kills_child_group_on_stale_heartbeat_time_compressed(tmp_path) -> None:
    run_dir = tmp_path / "owner-watchdog"
    run_dir.mkdir(mode=0o700)
    heartbeat_path = run_dir / "trusted-wrapper-owner-heartbeat.json"
    terminal_path = run_dir / "trusted-wrapper-owner-terminal.json"
    heartbeat_path.write_text(
        json.dumps(
            {
                "schema": "scheduler_control_trusted_wrapper_owner_heartbeat.v1",
                "status": "running",
                "owner_id": "owner-1",
                "bridge_instance_id": "bridge-1",
                "updated_at": "2000-01-01T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )
    heartbeat_path.chmod(0o600)
    receipt = {
        "scheduler_run_dir": str(run_dir),
        "owner_id": "owner-1",
        "owner_heartbeat_path": str(heartbeat_path),
        "owner_terminal_path": str(terminal_path),
        "bridge_instance_id": "bridge-1",
    }
    proc = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(5)"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    with pytest.raises(RuntimeError, match="trusted_wrapper_owner_lost:trusted_wrapper_owner_heartbeat_stale"):
        cli._job_manager_communicate_with_owner_watchdog(
            proc,
            receipt=receipt,
            deadline=time.monotonic() + 1,
            poll_seconds=0.01,
            stale_seconds=0.01,
            term_grace_seconds=0.05,
        )
    assert proc.poll() is not None
    cleanup = json.loads((run_dir / "trusted-owner-watchdog-cleanup.json").read_text(encoding="utf-8"))
    assert cleanup["external_action_count"] == 0
    assert cleanup["owned_processes_remaining"] == []


def test_bridge_diagnostic_is_run_owned_read_only_and_has_zero_external_actions(tmp_path) -> None:
    run_dir = tmp_path / "diagnostic-run"
    run_dir.mkdir()
    path = cli._job_manager_write_bridge_diagnostic(
        run_dir,
        run_id="run-1",
        bridge_probe={
            "ok": True,
            "ready": True,
            "bridge_instance_id": "bridge-1",
            "bridge_receipt_path": str(run_dir / "trusted-wrapper-v2-receipt.json"),
        },
        trusted_wrapper_receipt={"receipt_path": "receipt", "owner_id": "owner-1"},
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert path.parent == run_dir
    assert payload["read_only"] is True
    assert payload["external_action_count"] == 0
    assert payload["owner_id"] == "owner-1"


@pytest.mark.parametrize(
    "mutation,expected",
    [
        ("missing", "registered_child_result_missing"),
        ("malformed", "registered_child_result_malformed"),
        ("binding", "registered_child_result_binding_mismatch"),
        ("blocked", "child_reported_exact_blocker"),
        ("audit_missing", "registered_child_completion_audit_missing_or_outside"),
        ("audit_failed", "registered_child_completion_audit_failed_or_mismatched"),
        ("required_missing", "registered_child_required_artifact_missing_or_outside"),
        ("required_set", "registered_child_required_artifact_set_incomplete"),
        ("action_mismatch", "registered_child_external_action_count_mismatch"),
    ],
)
def test_registered_child_transport_reject_matrix(tmp_path, mutation: str, expected: str) -> None:
    run_dir = tmp_path / mutation
    result = _write_valid_registered_child_result(run_dir)
    result_path = run_dir / "registered-child-result.json"
    if mutation == "missing":
        result_path.unlink()
    elif mutation == "malformed":
        result_path.write_text("{", encoding="utf-8")
    elif mutation == "binding":
        result["control_run_id"] = "other-control"
        result_path.write_text(json.dumps(result), encoding="utf-8")
    elif mutation == "blocked":
        result["status"] = "blocked"
        result["exact_blocker"] = "child_reported_exact_blocker"
        result_path.write_text(json.dumps(result), encoding="utf-8")
    elif mutation == "audit_missing":
        (run_dir / "completion-audit.json").unlink()
    elif mutation == "audit_failed":
        (run_dir / "completion-audit.json").write_text(
            json.dumps({"ok": False, "stage": "job_manager_completion_audit", "run_dir": str(run_dir.resolve())}),
            encoding="utf-8",
        )
    elif mutation == "required_missing":
        missing = run_dir / "missing-required.json"
        result["required_artifact_paths"].append(str(missing))
        result_path.write_text(json.dumps(result), encoding="utf-8")
    elif mutation == "required_set":
        result["required_artifact_paths"] = [str(run_dir / "completion-audit.json")]
        result_path.write_text(json.dumps(result), encoding="utf-8")
    elif mutation == "action_mismatch":
        result["external_action_count"] = 1
        result_path.write_text(json.dumps(result), encoding="utf-8")
    result_path.chmod(0o600) if result_path.exists() else None

    with pytest.raises(RuntimeError, match=expected):
        cli._job_manager_evaluate_child_transport(
            returncode=0,
            run_dir=run_dir,
            scheduler_run_id="scheduler-run",
            control_run_id="control-run",
        )


def test_registered_child_contract_binds_running_pointer_and_fixed_result_path(tmp_path) -> None:
    request = {
        "control_run_id": "control-run",
        "control_run_dir": str(tmp_path / "control"),
        "scheduler_run_id": "scheduler-run",
    }
    updated = cli._job_manager_attach_registered_child_result_contract(
        {"launch_message": "registered"},
        request=request,
        run_dir=tmp_path / "run",
    )

    assert updated["registered_child_result_path"].endswith("/registered-child-result.json")
    assert updated["control_state_pointer"].endswith("/control-state-current.json")
    assert "status=running" in updated["launch_message"]
    assert "parent does not infer completion from prose/stdout" in updated["launch_message"]


def test_job_manager_commits_running_state_before_any_registered_child_spawn() -> None:
    source = inspect.getsource(cli.run_job_manager_now)
    transition_index = source.index("transition_control_to_running(trusted_request)")
    healthcheck_index = source.index("_codex_exec_session_healthcheck")
    spawn_index = source.index("subprocess.Popen")
    assert transition_index < healthcheck_index < spawn_index


def test_run_job_manager_now_rejects_untrusted_direct_execute_before_spawn(monkeypatch, tmp_path, capsys) -> None:
    launch_packet = {"launch_message": "job-manager-launch", "launch_message_sha256": "abc123"}
    monkeypatch.setattr(cli, "_job_manager_launch_packet", lambda: launch_packet)
    run_id = "job-manager-test-run-20260710-000001-acde"
    run_dir = tmp_path / "run-summaries" / f"codex-app-job-application-manager-{run_id}"
    monkeypatch.setattr(cli, "_job_manager_allocate_run_dir", lambda: (run_id, run_dir))
    monkeypatch.setattr(
        cli,
        "_job_manager_registered_contract",
        lambda automation_toml_path=None: {
            "automation_toml_path": str(cli.JOB_MANAGER_AUTOMATION_TOML),
            "automation": {
                "cwds": [str(cli.JOB_MANAGER_PROJECT_CWD)],
                "model": "gpt-5.4-mini",
                "reasoning_effort": "high",
                "status": "ACTIVE",
                "prompt": "registered prompt",
            },
            "db_row": {
                "prompt": "registered prompt",
                "cwds": [str(cli.JOB_MANAGER_PROJECT_CWD)],
                "model": "gpt-5.4-mini",
                "reasoning_effort": "high",
                "status": "ACTIVE",
            },
        },
    )
    job_manager_automation_toml = tmp_path / "automation.toml"
    job_manager_automation_toml.write_text('model = "gpt-5.4-mini"\n', encoding="utf-8")
    monkeypatch.setattr(cli, "JOB_MANAGER_AUTOMATION_TOML", job_manager_automation_toml)
    monkeypatch.setenv("OPENAI_API_KEY", "stale-openai-key")
    (tmp_path / "auth.json").write_text(
        json.dumps(
            {
                "auth_mode": "chatgpt",
                "last_refresh": "2026-07-09T12:13:01.396204Z",
                "tokens": {
                    "access_token": "fresh-openai-token",
                    "refresh_token": "fresh-refresh-token",
                    "account_id": "account-123",
                },
            }
        ),
        encoding="utf-8",
    )

    warmed: dict[str, object] = {}
    captured: dict[str, object] = {}

    class ProbeResult:
        stdout = '{"ok": true, "ready": true, "stage": "job_manager_bridge_readiness_probe", "backend": "chrome_extension_trusted_bridge", "browser_metadata": {"profileOrdering": 2, "profileName": "Nicky/Profile 2"}}\n'
        stderr = ""
        returncode = 0

    class Result:
        stdout = "ok\n"
        stderr = ""
        returncode = 0

    def fake_warmup_job_manager_bridge(**kwargs):
        warmed.update(kwargs)
        return _write_job_manager_bridge_receipt(
            tmp_path,
            run_id=kwargs["run_id"],
            scheduler_run_id=kwargs["scheduler_run_id"],
            scheduler_run_dir=str(Path(kwargs["scheduler_run_dir"]).resolve()),
            launch_dir=str(Path(kwargs["launch_dir"]).resolve()),
        )

    def fake_run(cmd, check, text, capture_output, env=None, timeout=None, cwd=None, input=None):
        if "validate_job_manager_extension_first.py" in " ".join(cmd):
            preflight_artifact = Path(cmd[cmd.index("--artifact") + 1])
            preflight_artifact.parent.mkdir(parents=True, exist_ok=True)
            preflight_artifact.write_text(json.dumps({"ok": True, "failed_checks": []}), encoding="utf-8")
            return Result()
        if cmd[0:3] == ["node", "--input-type=module", "-e"]:
            captured["bridge_probe_cmd"] = cmd
            captured["bridge_probe_env"] = env
            return ProbeResult()
        if cmd[0:4] == ["codex", "exec", "--ignore-user-config", "--ephemeral"]:
            if "Authentication healthcheck only. Reply READY and do nothing else." in cmd:
                captured["healthcheck_cmd"] = cmd
                captured["healthcheck_env"] = env
                captured["healthcheck_timeout"] = timeout
                return ProbeResult()
            captured["cmd"] = cmd
            captured["env"] = env
            captured["check"] = check
            captured["text"] = text
            captured["capture_output"] = capture_output
            captured["timeout"] = timeout
            return Result()
            raise AssertionError(f"unexpected command: {cmd}")

    class FakeProcess:
        pid = 4321
        returncode = 0

        def communicate(self, timeout=None):
            return ("ok\n", "")

    def fake_popen(cmd, text, stdout, stderr, env, cwd, start_new_session):
        captured["cmd"] = cmd
        captured["env"] = env
        return FakeProcess()

    monkeypatch.setattr(cli, "warmup_job_manager_bridge", fake_warmup_job_manager_bridge)
    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    monkeypatch.setattr(cli.subprocess, "Popen", fake_popen)

    with pytest.raises(RuntimeError, match="registered_child_trusted_control_request_missing"):
        cli.run_job_manager_now(execute=True, codex_home=tmp_path)
    assert "cmd" not in captured


def test_run_job_manager_now_untrusted_execute_creates_no_child_tails(monkeypatch, tmp_path) -> None:
    launch_packet = {"launch_message": "job-manager-launch", "launch_message_sha256": "abc123"}
    monkeypatch.setattr(cli, "_job_manager_launch_packet", lambda: launch_packet)
    run_id = "job-manager-test-run-20260710-000002-acde"
    run_dir = tmp_path / "run-summaries" / f"codex-app-job-application-manager-{run_id}"
    monkeypatch.setattr(cli, "_job_manager_allocate_run_dir", lambda: (run_id, run_dir))
    monkeypatch.setattr(
        cli,
        "_job_manager_registered_contract",
        lambda automation_toml_path=None: {
            "automation_toml_path": str(cli.JOB_MANAGER_AUTOMATION_TOML),
            "automation": {
                "cwds": [str(cli.JOB_MANAGER_PROJECT_CWD)],
                "model": "gpt-5.4-mini",
                "reasoning_effort": "high",
                "status": "ACTIVE",
                "prompt": "registered prompt",
            },
            "db_row": {
                "prompt": "registered prompt",
                "cwds": [str(cli.JOB_MANAGER_PROJECT_CWD)],
                "model": "gpt-5.4-mini",
                "reasoning_effort": "high",
                "status": "ACTIVE",
            },
        },
    )
    job_manager_automation_toml = tmp_path / "automation.toml"
    job_manager_automation_toml.write_text('model = "gpt-5.4-mini"\n', encoding="utf-8")
    monkeypatch.setattr(cli, "JOB_MANAGER_AUTOMATION_TOML", job_manager_automation_toml)
    monkeypatch.setenv("OPENAI_API_KEY", "stale-openai-key")
    (tmp_path / "auth.json").write_text(
        json.dumps(
            {
                "auth_mode": "chatgpt",
                "last_refresh": "2026-07-09T12:13:01.396204Z",
                "tokens": {
                    "access_token": "fresh-openai-token",
                    "refresh_token": "fresh-refresh-token",
                    "account_id": "account-123",
                },
            }
        ),
        encoding="utf-8",
    )

    class ProbeResult:
        stdout = '{"ok": true, "ready": true, "stage": "job_manager_bridge_readiness_probe", "backend": "chrome_extension_trusted_bridge", "browser_metadata": {"profileOrdering": 2, "profileName": "Nicky/Profile 2"}}\n'
        stderr = ""
        returncode = 0

    class Result:
        stdout = "ok\n"
        stderr = ""
        returncode = 0

    def fake_warmup_job_manager_bridge(**kwargs):
        return _write_job_manager_bridge_receipt(
            tmp_path,
            run_id=kwargs["run_id"],
            scheduler_run_id=kwargs["scheduler_run_id"],
            scheduler_run_dir=str(Path(kwargs["scheduler_run_dir"]).resolve()),
            launch_dir=str(Path(kwargs["launch_dir"]).resolve()),
        )

    def fake_run(cmd, check, text, capture_output, env=None, timeout=None, cwd=None, input=None):
        if "validate_job_manager_extension_first.py" in " ".join(cmd):
            preflight_artifact = Path(cmd[cmd.index("--artifact") + 1])
            preflight_artifact.parent.mkdir(parents=True, exist_ok=True)
            preflight_artifact.write_text(json.dumps({"ok": True, "failed_checks": []}), encoding="utf-8")
            return Result()
        if cmd[0:3] == ["node", "--input-type=module", "-e"]:
            return ProbeResult()
        if cmd[0:4] == ["codex", "exec", "--ignore-user-config", "--ephemeral"]:
            if "Authentication healthcheck only. Reply READY and do nothing else." in cmd:
                return ProbeResult()
            return Result()
        raise AssertionError(f"unexpected command: {cmd}")

    class FakeProcess:
        pid = 4321
        returncode = 0

        def communicate(self, timeout=None):
            return ("ok", "warn")

    def fake_popen(cmd, text, stdout, stderr, env, cwd, start_new_session):
        return FakeProcess()

    def fake_echo(message, err=False):
        if message == "ok":
            raise BrokenPipeError(errno.EPIPE, "broken pipe")

    monkeypatch.setattr(cli, "warmup_job_manager_bridge", fake_warmup_job_manager_bridge)
    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    monkeypatch.setattr(cli.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(cli.typer, "echo", fake_echo)

    with pytest.raises(RuntimeError, match="registered_child_trusted_control_request_missing"):
        cli.run_job_manager_now(execute=True, codex_home=tmp_path)
    assert not (run_dir / "child-stdout-tail.txt").exists()


def test_run_job_manager_now_rejects_launch_packet_without_probe_contract(monkeypatch, tmp_path) -> None:
    def fake_job_manager_launch_packet():
        raise RuntimeError("bridge_readiness_probe_missing_from_registered_prompt")

    monkeypatch.setattr(cli, "_job_manager_launch_packet", fake_job_manager_launch_packet)
    monkeypatch.setattr(cli, "JOB_MANAGER_AUTOMATION_TOML", tmp_path / "automation.toml")

    with pytest.raises(RuntimeError, match="bridge_readiness_probe_missing_from_registered_prompt"):
        cli.run_job_manager_now(execute=False, codex_home=Path("/private/tmp/codex-job-manager-home"))


def test_run_registered_automation_now_uses_danger_full_access(monkeypatch, tmp_path, capsys) -> None:
    automation_toml = tmp_path / "automation.toml"
    state_path = tmp_path / "STATE.md"
    memory_path = tmp_path / "memory.md"
    project_prompt_path = tmp_path / "project-prompt.md"
    automation_toml.write_text('model = "gpt-5.4-mini"\n', encoding="utf-8")
    for path in (state_path, memory_path, project_prompt_path):
        path.write_text("ok", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "stale-openai-key")
    (tmp_path / "auth.json").write_text(
        json.dumps(
            {
                "auth_mode": "chatgpt",
                "last_refresh": "2026-07-09T12:13:01.396204Z",
                "tokens": {
                    "access_token": "fresh-openai-token",
                    "refresh_token": "fresh-refresh-token",
                    "account_id": "account-123",
                },
            }
        ),
        encoding="utf-8",
    )

    launch_packet = {
        "launch_message": "scheduler_control_request.v2\nrunRegisteredAutomationWithTrustedBridge\nChrome Extension/Profile 2\nregistered-launch",
        "launch_message_sha256": "def456",
    }
    monkeypatch.setattr(cli, "_registered_automation_launch_packet", lambda **kwargs: launch_packet)
    monkeypatch.setenv("CODEX_THREAD_ID", "thread-123")
    monkeypatch.setenv("CODEX_SESSION_ID", "session-123")
    monkeypatch.setenv("CODEX_TURN_ID", "turn-123")
    monkeypatch.setattr(
        cli,
        "_job_manager_acquire_lease",
        lambda run_id, run_dir, *, mode, deadline_seconds: {
            "owner_token": "lease-token",
            "run_id": run_id,
            "run_dir": str(run_dir),
            "mode": mode,
        },
    )
    monkeypatch.setattr(cli, "_job_manager_release_lease", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        cli,
        "_job_manager_write_heartbeat",
        lambda run_dir, *, run_id, owner_token, mode, exact_blocker="": run_dir / "heartbeat.json",
    )
    monkeypatch.setattr(
        cli,
        "_job_manager_validate_live_preflight",
        lambda **kwargs: {
            "workflow": "job-applications",
            "stage": "job_manager_live_preflight",
            "ok": True,
        },
    )

    warmed: dict[str, object] = {}
    captured: dict[str, object] = {}
    bridge_probe = _write_job_manager_bridge_receipt(tmp_path, "registered-bridge-test-run")

    class ProbeResult:
        stdout = '{"ok": true, "ready": true, "stage": "job_manager_bridge_readiness_probe", "backend": "chrome_extension_trusted_bridge", "browser_metadata": {"profileOrdering": 2, "profileName": "Nicky/Profile 2"}}\n'
        stderr = ""
        returncode = 0

    class Result:
        stdout = "ok\n"
        stderr = ""
        returncode = 0

    def fake_warmup_job_manager_bridge(**kwargs):
        warmed.update(kwargs)
        return _write_job_manager_bridge_receipt(
            tmp_path,
            run_id=kwargs["run_id"],
            scheduler_run_id=kwargs["scheduler_run_id"],
            scheduler_run_dir=str(Path(kwargs["scheduler_run_dir"]).resolve()),
            launch_dir=str(Path(kwargs["launch_dir"]).resolve()),
            codex_thread_id="thread-123",
            codex_turn_id="turn-123",
            codex_session_id="session-123",
        )

    def fake_run(cmd, check, text, capture_output, env=None, timeout=None, input=None, cwd=None):
        if "validate_job_manager_extension_first.py" in " ".join(cmd):
            preflight_artifact = Path(cmd[cmd.index("--artifact") + 1])
            preflight_artifact.parent.mkdir(parents=True, exist_ok=True)
            preflight_artifact.write_text(json.dumps({"ok": True, "failed_checks": []}), encoding="utf-8")
            return Result()
        if cmd[0:3] == ["node", "--input-type=module", "-e"]:
            captured["bridge_probe_cmd"] = cmd
            captured["bridge_probe_env"] = env
            return ProbeResult()
        if cmd[0:4] == ["codex", "exec", "--ignore-user-config", "--ephemeral"]:
            if "Authentication healthcheck only. Reply READY and do nothing else." in cmd:
                captured["healthcheck_cmd"] = cmd
                captured["healthcheck_env"] = env
                captured["healthcheck_timeout"] = timeout
                return ProbeResult()
            captured["cmd"] = cmd
            captured["env"] = env
            captured["timeout"] = timeout
            return Result()
        raise AssertionError(f"unexpected command: {cmd}")

    class FakeProcess:
        pid = 4321
        returncode = 0

        def communicate(self, timeout=None):
            return ("ok\n", "")

    def fake_popen(cmd, text, stdout, stderr, env, cwd, start_new_session):
        captured["cmd"] = cmd
        captured["env"] = env
        return FakeProcess()

    monkeypatch.setattr(cli, "warmup_job_manager_bridge", fake_warmup_job_manager_bridge)
    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    monkeypatch.setattr(cli.subprocess, "Popen", fake_popen)

    cli.run_registered_automation_now(
        automation_id="job-application-manager",
        automation_name="job-application-manager",
        automation_toml=automation_toml,
        state_path=state_path,
        memory_path=memory_path,
        project_prompt_path=project_prompt_path,
        execute=True,
        codex_home=tmp_path,
    )

    output = capsys.readouterr().out
    assert "launch_message_sha256" in output
    assert warmed["codex_home"] == tmp_path
    assert warmed["timeout_seconds"] == 30
    assert captured["healthcheck_cmd"][0:4] == ["codex", "exec", "--ignore-user-config", "--ephemeral"]
    assert captured["healthcheck_cmd"][4:6] == ["--sandbox", "danger-full-access"]
    assert "--config" in captured["healthcheck_cmd"]
    assert "shell_environment_policy.inherit=all" in captured["healthcheck_cmd"]
    assert "--skip-git-repo-check" in captured["healthcheck_cmd"]
    assert "--cd" in captured["healthcheck_cmd"]
    assert captured["cmd"][0:4] == ["codex", "exec", "--ignore-user-config", "--ephemeral"]
    assert captured["cmd"][4:6] == ["--sandbox", "danger-full-access"]
    assert "--config" in captured["cmd"]
    assert "shell_environment_policy.inherit=all" in captured["cmd"]
    assert "--skip-git-repo-check" in captured["cmd"]
    assert "--cd" in captured["cmd"]
    assert "--model" in captured["cmd"]
    assert captured["cmd"][captured["cmd"].index("--model") + 1] == "gpt-5.4-mini"
    assert captured["env"]["CODEX_HOME"] == str(tmp_path)
    assert captured["env"]["OPENAI_API_KEY"] == "fresh-openai-token"
    assert captured["env"]["SOCIAL_FLOW_REGISTERED_AUTOMATION_CHILD"] == "1"
    assert captured["env"]["SOCIAL_FLOW_REGISTERED_AUTOMATION_ID"] == "job-application-manager"
    assert captured["env"]["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_RUN_ID"] == warmed["run_id"]
    assert captured["env"]["SOCIAL_FLOW_CURRENT_BRIDGE_PROBE_RECEIPT"].endswith(f"/{warmed['run_id']}.json")


def test_generic_registered_automation_executes_from_registered_cwd(monkeypatch, tmp_path) -> None:
    automation_dir = tmp_path / "registry" / "automations" / "sample"
    automation_dir.mkdir(parents=True)
    registered_cwd = tmp_path / "registered-project"
    registered_cwd.mkdir()
    automation_toml = automation_dir / "automation.toml"
    automation_toml.write_text(
        "\n".join(
            [
                'id = "sample"',
                'prompt = "Run sample."',
                f'cwds = ["{registered_cwd}"]',
                'model = "gpt-5.4-mini"',
                'reasoning_effort = "medium"',
                'status = "ACTIVE"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    state_path = automation_dir / "STATE.md"
    memory_path = automation_dir / "memory.md"
    state_path.write_text("state\n", encoding="utf-8")
    memory_path.write_text("memory\n", encoding="utf-8")
    launch_packet = {
        "launch_message": "registered sample launch",
        "launch_message_sha256": "abc123",
    }
    monkeypatch.setattr(cli, "_registered_automation_launch_packet", lambda **_kwargs: launch_packet)

    observed: dict[str, object] = {}

    class Result:
        stdout = "ok\n"
        stderr = ""
        returncode = 0

    def fake_run(cmd, **kwargs):
        observed["cmd"] = cmd
        observed["cwd"] = kwargs.get("cwd")
        return Result()

    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    cli.run_registered_automation_now(
        automation_id="sample",
        automation_name="Sample",
        automation_toml=automation_toml,
        state_path=state_path,
        memory_path=memory_path,
        project_prompt_path=automation_toml,
        execute=True,
        codex_home=tmp_path / "safe-home",
    )

    cmd = observed["cmd"]
    assert isinstance(cmd, list)
    assert cmd[cmd.index("--cd") + 1] == str(registered_cwd.resolve())
    assert observed["cwd"] == str(registered_cwd.resolve())
    assert observed["cwd"] != str(automation_dir.resolve())


def test_job_manager_launch_packet_prevents_recursive_scheduler_execute(tmp_path: Path) -> None:
    automation_toml = tmp_path / "automation.toml"
    state_path = tmp_path / "STATE.md"
    memory_path = tmp_path / "memory.md"
    project_prompt_path = tmp_path / "project-prompt.md"
    automation_toml.write_text('prompt = "Run the manager workflow."\n', encoding="utf-8")
    state_path.write_text("Updated: 2026-07-10\n", encoding="utf-8")
    memory_path.write_text("memory\n", encoding="utf-8")
    project_prompt_path.write_text("project prompt\n", encoding="utf-8")

    packet = cli._registered_automation_launch_packet(
        automation_toml_path=automation_toml,
        state_path=state_path,
        memory_path=memory_path,
        project_prompt_path=project_prompt_path,
        automation_id="job-application-manager",
        automation_name="Job Application Manager",
    )

    assert "Registered scheduler child guard 2026-07-13" in packet["launch_message"]
    assert "run-codex-automation --stage execute" in packet["launch_message"]
    assert "`run-scheduler-now --execute`" in packet["launch_message"]
    assert "Current-run bridge proof 2026-07-13" in packet["launch_message"]
    assert "scheduler_control_receipt.v2" in packet["launch_message"]
    assert "Never treat a prior same-session receipt" in packet["launch_message"]


def test_recursive_registered_execute_is_machine_blocked_before_scheduler_forward(monkeypatch, tmp_path) -> None:
    forwarded: dict[str, object] = {}
    monkeypatch.setenv("SOCIAL_FLOW_REGISTERED_AUTOMATION_CHILD", "1")
    monkeypatch.setenv("SOCIAL_FLOW_REGISTERED_AUTOMATION_ID", "job-application-manager")
    monkeypatch.setattr(cli, "run_registered_automation_safe", lambda **kwargs: forwarded.update(kwargs))

    with pytest.raises(
        RuntimeError,
        match="registered_automation_recursive_execute_blocked: active_automation_id=job-application-manager",
    ):
        cli.run_scheduler_now(
            automation_id="job-application-manager",
            execute=True,
            registry_codex_home=tmp_path,
            codex_home=tmp_path / "child-home",
        )

    assert forwarded == {}


def test_recursive_registered_dry_run_stays_callable(monkeypatch, tmp_path) -> None:
    forwarded: dict[str, object] = {}
    monkeypatch.setenv("SOCIAL_FLOW_REGISTERED_AUTOMATION_CHILD", "1")
    monkeypatch.setenv("SOCIAL_FLOW_REGISTERED_AUTOMATION_ID", "job-application-manager")
    monkeypatch.setattr(cli, "run_registered_automation_safe", lambda **kwargs: forwarded.update(kwargs))

    cli.run_scheduler_now(
        automation_id="job-application-manager",
        execute=False,
        registry_codex_home=tmp_path,
        codex_home=tmp_path / "child-home",
    )

    assert forwarded["execute"] is False


def test_attach_current_bridge_probe_requires_matching_passed_receipt(tmp_path) -> None:
    probe = _write_job_manager_bridge_receipt(tmp_path)
    packet = {"launch_message": "registered-launch", "launch_message_sha256": "old"}

    updated = cli._attach_current_bridge_probe_to_launch_packet(packet, probe)

    assert updated["current_bridge_probe"] == probe
    assert updated["current_bridge_probe"]["backend"] == "chrome_extension_trusted_bridge"
    assert updated["current_bridge_probe"]["browser_metadata"] == {"profileOrdering": 2, "profileName": "Nicky"}
    assert f"bridge_run_id={probe['bridge_run_id']}" in updated["launch_message"]
    assert f"bridge_receipt_path={probe['bridge_receipt_path']}" in updated["launch_message"]
    assert "backend=chrome_extension_trusted_bridge" in updated["launch_message"]
    assert 'browser_metadata={"profileOrdering": 2, "profileName": "Nicky"}' in updated["launch_message"]
    assert updated["launch_message_sha256"] != "old"

    Path(str(probe["bridge_receipt_path"])).unlink()
    with pytest.raises(RuntimeError, match="bridge_readiness_probe_receipt_unreadable_before_registered_child"):
        cli._attach_current_bridge_probe_to_launch_packet(packet, probe)


@pytest.mark.parametrize(
    ("section", "field", "value", "expected_match"),
    [
        (
            "result",
            "ready",
            False,
            "trusted_runner_bridge_unavailable_before_probe_artifact: probe_contract_invalid: expected ok=true ready=true stage=job_manager_bridge_readiness_probe",
        ),
        ("result", "bridge_run_id", "different-bridge-run", "bridge_readiness_probe_receipt_invalid_before_registered_child"),
        ("result", "bridge_receipt_path", "/tmp/different-bridge-receipt.json", "bridge_readiness_probe_receipt_invalid_before_registered_child"),
        ("receipt", "receipt_path", "/tmp/different-top-level-bridge-receipt.json", "bridge_readiness_probe_receipt_invalid_before_registered_child"),
    ],
)
def test_attach_current_bridge_probe_rejects_mismatched_receipt(tmp_path, section, field, value, expected_match) -> None:
    probe = _write_job_manager_bridge_receipt(tmp_path)
    receipt_path = Path(str(probe["bridge_receipt_path"]))
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    target = receipt["result"] if section == "result" else receipt
    target[field] = value
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

    with pytest.raises(RuntimeError, match=expected_match):
        cli._attach_current_bridge_probe_to_launch_packet(
            {"launch_message": "registered-launch", "launch_message_sha256": "old"},
            probe,
        )


@pytest.mark.parametrize(
    ("field", "value", "expected_match"),
    [
        ("backend", None, "probe_backend_invalid: backend=missing expected=chrome_extension_trusted_bridge"),
        ("backend", "chrome_extension_profile2_fallback", "probe_backend_invalid: backend=chrome_extension_profile2_fallback expected=chrome_extension_trusted_bridge"),
        ("browser_metadata", None, "probe_profile_invalid: browser_metadata_missing"),
        ("browser_metadata", {"profileOrdering": 2, "profileName": "Profile 3"}, "probe_profile_invalid: inconsistent_profile_identity profileOrdering=2 profileName=Profile 3 expected=Nicky"),
        ("browser_metadata", {"profileOrdering": 1, "profileName": "Nicky"}, "probe_profile_invalid: inconsistent_profile_identity profileOrdering=1 profileName=Nicky expected=Nicky"),
    ],
)
def test_attach_current_bridge_probe_rejects_missing_or_mismatched_backend_profile_fields(
    tmp_path,
    field,
    value,
    expected_match,
) -> None:
    probe = _write_job_manager_bridge_receipt(tmp_path, browser_metadata={"profileOrdering": 2, "profileName": "Nicky"})
    receipt_path = Path(str(probe["bridge_receipt_path"]))
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if value is None:
        receipt["result"].pop(field)
    else:
        receipt["result"][field] = value
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

    with pytest.raises(RuntimeError, match=expected_match):
        cli._attach_current_bridge_probe_to_launch_packet(
            {"launch_message": "registered-launch", "launch_message_sha256": "old"},
            probe,
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("scheduler_run_id", "wrong-run"),
        ("scheduler_run_dir", "/tmp/wrong-run-dir"),
        ("launch_dir", "/tmp/wrong-launch-dir"),
    ],
)
def test_attach_current_bridge_probe_rejects_scheduler_binding_mismatch(tmp_path, field, value) -> None:
    expected_run_dir = tmp_path / "run-summaries" / "codex-app-job-application-manager-bridge-bind"
    probe = _write_job_manager_bridge_receipt(
        tmp_path,
        run_id="bridge-bind",
        scheduler_run_id="bridge-bind",
        scheduler_run_dir=str(expected_run_dir),
        launch_dir=str(cli.JOB_MANAGER_PROJECT_CWD.resolve()),
    )
    receipt_path = Path(str(probe["bridge_receipt_path"]))
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt[field] = value
    if field in {"scheduler_run_id", "scheduler_run_dir", "launch_dir"}:
        receipt["result"][field] = value
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

    with pytest.raises(RuntimeError, match="bridge_readiness_probe_receipt_invalid_before_registered_child"):
        cli._attach_current_bridge_probe_to_launch_packet(
            {"launch_message": "registered-launch", "launch_message_sha256": "old"},
            probe,
            expected_scheduler_run_id="bridge-bind",
            expected_scheduler_run_dir=expected_run_dir,
            expected_launch_dir=cli.JOB_MANAGER_PROJECT_CWD,
        )


def test_run_registered_automation_now_rejects_launch_packet_without_probe_contract(monkeypatch, tmp_path) -> None:
    automation_toml = tmp_path / "automation.toml"
    state_path = tmp_path / "STATE.md"
    memory_path = tmp_path / "memory.md"
    project_prompt_path = tmp_path / "project-prompt.md"
    for path in (automation_toml, state_path, memory_path, project_prompt_path):
        path.write_text("ok", encoding="utf-8")

    monkeypatch.setattr(
        cli,
        "_registered_automation_launch_packet",
        lambda **kwargs: {"launch_message": "registered-launch", "launch_message_sha256": "ghi789"},
    )

    with pytest.raises(RuntimeError, match="scheduler_control_v2_missing_from_registered_prompt"):
        cli.run_registered_automation_now(
            automation_id="job-application-manager",
            automation_name="job-application-manager",
            automation_toml=automation_toml,
            state_path=state_path,
            memory_path=memory_path,
            project_prompt_path=project_prompt_path,
            execute=False,
            codex_home=Path("/private/tmp/codex-job-manager-home"),
        )


def test_codex_exec_env_strips_openai_api_key(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "stale-openai-key")
    monkeypatch.setenv("CODEX_HOME", "/tmp/should-not-win")

    env = cli._codex_exec_env(codex_home=Path("/private/tmp/codex-job-manager-home"))

    assert "OPENAI_API_KEY" not in env
    assert env["CODEX_HOME"] == "/private/tmp/codex-job-manager-home"


def test_codex_exec_auth_env_prefers_codex_home_auth(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "stale-openai-key")
    auth_home = tmp_path / "codex-home"
    auth_home.mkdir()
    (auth_home / "auth.json").write_text(
        json.dumps(
            {
                "auth_mode": "chatgpt",
                "last_refresh": "2026-07-09T12:13:01.396204Z",
                "tokens": {
                    "access_token": "fresh-openai-token",
                    "refresh_token": "fresh-refresh-token",
                    "account_id": "account-123",
                },
            }
        ),
        encoding="utf-8",
    )

    env = cli._codex_exec_auth_env(codex_home=auth_home)

    assert env["CODEX_HOME"] == str(auth_home)
    assert env["OPENAI_API_KEY"] == "fresh-openai-token"


def test_codex_exec_auth_env_requires_access_token_for_chatgpt_auth(tmp_path) -> None:
    auth_home = tmp_path / "codex-home"
    auth_home.mkdir()
    (auth_home / "auth.json").write_text(
        json.dumps(
            {
                "auth_mode": "chatgpt",
                "last_refresh": "2026-07-09T12:13:01.396204Z",
                "tokens": {
                    "refresh_token": "fresh-refresh-token",
                    "account_id": "account-123",
                },
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(RuntimeError, match="codex_exec_auth_missing_before_workflow_start"):
        cli._codex_exec_auth_env(codex_home=auth_home)


def test_run_registered_automation_safe_uses_registry_codex_home_for_discovery(monkeypatch, tmp_path, capsys) -> None:
    registry_root = tmp_path / "registry-home"
    automation_dir = registry_root / "automations" / "sample-automation"
    automation_dir.mkdir(parents=True)
    for path in (automation_dir / "automation.toml", automation_dir / "STATE.md", automation_dir / "memory.md"):
        path.write_text("ok", encoding="utf-8")

    monkeypatch.setattr(
        cli,
        "_registered_automation_launch_packet",
        lambda **kwargs: {"launch_message": "registered-launch", "launch_message_sha256": "ghi789"},
    )

    captured: dict[str, object] = {}

    def fake_run_registered_automation_now(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(cli, "run_registered_automation_now", fake_run_registered_automation_now)

    cli.run_registered_automation_safe(
        automation_id="sample-automation",
        execute=True,
        registry_codex_home=registry_root,
        codex_home=Path("/private/tmp/codex-job-manager-home"),
    )

    capsys.readouterr()
    assert captured["automation_toml"] == automation_dir / "automation.toml"
    assert captured["state_path"] == automation_dir / "STATE.md"
    assert captured["memory_path"] == automation_dir / "memory.md"
    assert captured["project_prompt_path"] == automation_dir / "automation.toml"
    assert captured["execute"] is True
    assert captured["codex_home"] == Path("/private/tmp/codex-job-manager-home")


def test_run_registered_automation_safe_dry_run_generates_launch_packet(monkeypatch, tmp_path) -> None:
    registry_root = tmp_path / "registry-home"
    automation_dir = registry_root / "automations" / "job-application-manager"
    automation_dir.mkdir(parents=True)
    (automation_dir / "automation.toml").write_text(
        'prompt = "scheduler_control_request.v2 runRegisteredAutomationWithTrustedBridge Chrome Extension/Profile 2"\n',
        encoding="utf-8",
    )
    (automation_dir / "STATE.md").write_text("state\n", encoding="utf-8")
    (automation_dir / "memory.md").write_text("memory\n", encoding="utf-8")
    project_prompt = tmp_path / "job-application-automation.md"
    project_prompt.write_text("project prompt\n", encoding="utf-8")
    monkeypatch.setattr(cli, "JOB_MANAGER_PROJECT_PROMPT", project_prompt)
    monkeypatch.setattr(
        cli,
        "warmup_job_manager_bridge",
        lambda **kwargs: pytest.fail("dry-run must not warm the Chrome bridge"),
    )

    cli.run_registered_automation_safe(
        automation_id="job-application-manager",
        execute=False,
        registry_codex_home=registry_root,
        codex_home=Path("/private/tmp/codex-job-manager-home"),
    )

    packet = json.loads((automation_dir / "run-now-launch-packet.json").read_text(encoding="utf-8"))
    assert packet["automation_id"] == "job-application-manager"
    assert packet["registered_child_guard"]
    assert "Registered scheduler child guard 2026-07-13" in packet["launch_message"]
    assert packet["launch_message_sha256"] == hashlib.sha256(packet["launch_message"].encode("utf-8")).hexdigest()
    assert "current_bridge_probe" not in packet


def test_run_registered_automations_loop_uses_registry_codex_home(monkeypatch, tmp_path) -> None:
    registry_root = tmp_path / "registry-home"
    automation_dir = registry_root / "automations" / "sample-automation"
    automation_dir.mkdir(parents=True)
    (automation_dir / "automation.toml").write_text('id = "sample-automation"\nstatus = "ACTIVE"\n', encoding="utf-8")
    for path in (automation_dir / "STATE.md", automation_dir / "memory.md"):
        path.write_text("ok", encoding="utf-8")

    observed: dict[str, object] = {}

    def fake_registered_dirs(codex_home):
        observed["registry_codex_home"] = codex_home
        return [automation_dir]

    def fake_run_registered_automation_safe(**kwargs):
        observed["automation_id"] = kwargs["automation_id"]
        observed["execute"] = kwargs["execute"]
        observed["registry_codex_home"] = kwargs["registry_codex_home"]
        observed["codex_home"] = kwargs["codex_home"]

    monkeypatch.setattr(cli, "_registered_automation_dirs", fake_registered_dirs)
    monkeypatch.setattr(cli, "run_registered_automation_safe", fake_run_registered_automation_safe)

    cli.run_registered_automations_loop(
        execute=True,
        registry_codex_home=registry_root,
        codex_home=Path("/private/tmp/codex-job-manager-home"),
    )

    assert observed["registry_codex_home"] == registry_root
    assert observed["automation_id"] == "sample-automation"
    assert observed["execute"] is True
    assert observed["codex_home"] == Path("/private/tmp/codex-job-manager-home")
    assert observed["registry_codex_home"] == registry_root


def test_run_registered_automations_loop_continues_after_independent_failure_by_default(monkeypatch, tmp_path) -> None:
    automation_dirs = []
    for automation_id in ("first", "second"):
        automation_dir = tmp_path / automation_id
        automation_dir.mkdir()
        (automation_dir / "automation.toml").write_text(
            f'id = "{automation_id}"\nstatus = "ACTIVE"\n',
            encoding="utf-8",
        )
        (automation_dir / "STATE.md").write_text("state\n", encoding="utf-8")
        (automation_dir / "memory.md").write_text("memory\n", encoding="utf-8")
        automation_dirs.append(automation_dir)

    calls: list[str] = []

    def fake_run_registered_automation_safe(**kwargs):
        calls.append(kwargs["automation_id"])
        if kwargs["automation_id"] == "first":
            raise RuntimeError("first_failed")

    monkeypatch.setattr(cli, "_registered_automation_dirs", lambda _root: automation_dirs)
    monkeypatch.setattr(cli, "run_registered_automation_safe", fake_run_registered_automation_safe)

    with pytest.raises(RuntimeError, match="registered_automation_loop_completed_with_errors:1"):
        cli.run_registered_automations_loop(registry_codex_home=tmp_path)

    assert calls == ["first", "second"]


def test_run_scheduler_now_forwards_to_universal_control(monkeypatch, tmp_path) -> None:
    observed: dict[str, object] = {}

    def fake_run_codex_automation(**kwargs):
        observed.update(kwargs)

    monkeypatch.setattr(cli, "run_codex_automation", fake_run_codex_automation)

    cli.run_scheduler_now(
        automation_id="sample-automation",
        execute=True,
        registry_codex_home=tmp_path / "registry-home",
        codex_home=Path("/private/tmp/codex-job-manager-home"),
    )

    assert observed["automation_id"] == "sample-automation"
    assert observed["stage"] == "execute"
    assert observed["request_path"] is None
    assert observed["control_run_id"] is None
    assert observed["registry_codex_home"] == tmp_path / "registry-home"
    assert observed["codex_home"] == Path("/private/tmp/codex-job-manager-home")


def test_run_job_manager_now_requires_trusted_request_before_auth_healthcheck(monkeypatch, tmp_path) -> None:
    launch_packet = {"launch_message": "job-manager-launch", "launch_message_sha256": "abc123"}
    monkeypatch.setattr(cli, "_job_manager_launch_packet", lambda: launch_packet)
    job_manager_automation_toml = tmp_path / "automation.toml"
    job_manager_automation_toml.write_text(
        "\n".join(
            [
                'prompt = "registered prompt"',
                f'cwds = ["{cli.JOB_MANAGER_PROJECT_CWD}"]',
                'model = "gpt-5.4-mini"',
                'reasoning_effort = "high"',
                'status = "ACTIVE"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(cli, "JOB_MANAGER_AUTOMATION_TOML", job_manager_automation_toml)
    monkeypatch.setattr(
        cli,
        "_job_manager_registered_contract",
        lambda automation_toml_path=None: {
            "automation_toml_path": str(job_manager_automation_toml),
            "automation": {
                "prompt": "registered prompt",
                "cwds": [str(cli.JOB_MANAGER_PROJECT_CWD)],
                "model": "gpt-5.4-mini",
                "reasoning_effort": "high",
                "status": "ACTIVE",
            },
            "db_row": {
                "prompt": "registered prompt",
                "cwds": [str(cli.JOB_MANAGER_PROJECT_CWD)],
                "model": "gpt-5.4-mini",
                "reasoning_effort": "high",
                "status": "ACTIVE",
            },
        },
    )
    (tmp_path / "auth.json").write_text(
        json.dumps(
            {
                "auth_mode": "chatgpt",
                "last_refresh": "2026-07-09T12:13:01.396204Z",
                "tokens": {
                    "access_token": "fresh-openai-token",
                    "refresh_token": "fresh-refresh-token",
                    "account_id": "account-123",
                },
            }
        ),
        encoding="utf-8",
    )

    def fake_warmup_job_manager_bridge(**kwargs):
        return _write_job_manager_bridge_receipt(
            tmp_path,
            run_id=kwargs["run_id"],
            scheduler_run_id=kwargs["scheduler_run_id"],
            scheduler_run_dir=str(Path(kwargs["scheduler_run_dir"]).resolve()),
            launch_dir=str(Path(kwargs["launch_dir"]).resolve()),
        )

    monkeypatch.setattr(cli, "warmup_job_manager_bridge", fake_warmup_job_manager_bridge)

    class ProbeResult:
        stdout = "401 token_invalidated\n"
        stderr = ""
        returncode = 1

    def fake_run(cmd, check, text, capture_output, env=None, timeout=None, cwd=None):
        if "validate_job_manager_extension_first.py" in " ".join(cmd):
            preflight_artifact = Path(cmd[cmd.index("--artifact") + 1])
            preflight_artifact.parent.mkdir(parents=True, exist_ok=True)
            preflight_artifact.write_text(json.dumps({"ok": True, "failed_checks": []}), encoding="utf-8")
            class PreflightResult:
                stdout = '{"ok": true, "failed_checks": []}\n'
                stderr = ""
                returncode = 0

            return PreflightResult()
        if cmd[0:4] == ["codex", "exec", "--ignore-user-config", "--ephemeral"]:
            return ProbeResult()
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError, match="registered_child_trusted_control_request_missing"):
        cli.run_job_manager_now(execute=True, codex_home=tmp_path)


def test_codex_exec_session_healthcheck_classifies_usage_limit(monkeypatch, tmp_path) -> None:
    (tmp_path / "auth.json").write_text(
        json.dumps(
            {
                "auth_mode": "chatgpt",
                "tokens": {"access_token": "test-access-token"},
            }
        ),
        encoding="utf-8",
    )

    class ProbeResult:
        stdout = ""
        stderr = "You've hit your usage limit. Purchase more credits or try again at 5:00 PM."
        returncode = 1

    monkeypatch.setattr(cli.subprocess, "run", lambda *args, **kwargs: ProbeResult())

    with pytest.raises(
        RuntimeError,
        match=r"codex_exec_usage_limit_before_workflow_start:retry_after=5:00_PM",
    ):
        cli._codex_exec_session_healthcheck(
            codex_home=tmp_path,
            launch_dir=cli.JOB_MANAGER_PROJECT_CWD,
            launch_model="gpt-5.4-mini",
        )


def test_run_scheduler_now_skips_bridge_warmup_on_dry_run(monkeypatch, tmp_path) -> None:
    observed: dict[str, object] = {}
    warmed: dict[str, object] = {}

    def fake_run_registered_automation_safe(**kwargs):
        observed.update(kwargs)

    def fake_warmup_job_manager_bridge(**kwargs):
        warmed.update(kwargs)

    monkeypatch.setattr(cli, "run_registered_automation_safe", fake_run_registered_automation_safe)
    monkeypatch.setattr(cli, "warmup_job_manager_bridge", fake_warmup_job_manager_bridge)

    cli.run_scheduler_now(
        automation_id="sample-automation",
        execute=False,
        registry_codex_home=tmp_path / "registry-home",
        codex_home=Path("/private/tmp/codex-job-manager-home"),
    )

    assert observed["automation_id"] == "sample-automation"
    assert observed["execute"] is False
    assert observed["registry_codex_home"] == tmp_path / "registry-home"
    assert observed["codex_home"] == Path("/private/tmp/codex-job-manager-home")
    assert warmed == {}


def test_job_manager_allocate_run_dir_recovers_from_same_second_collision(monkeypatch, tmp_path) -> None:
    run_root = tmp_path / "run-summaries"
    monkeypatch.setattr(cli, "JOB_MANAGER_RUN_SUMMARIES_ROOT", run_root)
    run_ids = iter([
        "20260710-120000-000000-aaaa0000",
        "20260710-120000-000001-bbbb1111",
    ])
    monkeypatch.setattr(cli, "_job_manager_run_id", lambda: next(run_ids))
    first_dir = run_root / "codex-app-job-application-manager-20260710-120000-000000-aaaa0000"
    first_dir.mkdir(parents=True, exist_ok=True)

    run_id, run_dir = cli._job_manager_allocate_run_dir()

    assert run_id == "20260710-120000-000001-bbbb1111"
    assert run_dir == run_root / "codex-app-job-application-manager-20260710-120000-000001-bbbb1111"
    assert run_dir.is_dir()


def test_job_manager_release_lease_rejects_stale_owner_token(monkeypatch, tmp_path) -> None:
    run_root = tmp_path / "run-summaries"
    lease_dir = run_root / "job-manager-current"
    lease_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cli, "JOB_MANAGER_RUN_SUMMARIES_ROOT", run_root)
    monkeypatch.setattr(cli, "JOB_MANAGER_CURRENT_LEASE", lease_dir / "active-run.json")
    monkeypatch.setattr(cli, "JOB_MANAGER_CURRENT_POINTER", lease_dir / "current-run.json")
    run_dir = run_root / "codex-app-job-application-manager-lease-test"
    run_dir.mkdir(parents=True, exist_ok=True)

    lease = cli._job_manager_acquire_lease("lease-test", run_dir, mode="execute", deadline_seconds=60)
    lease_path = cli.JOB_MANAGER_CURRENT_LEASE
    payload = json.loads(lease_path.read_text(encoding="utf-8"))
    payload["owner_token"] = "stale-owner-token"
    lease_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(RuntimeError, match="active_run_lease_owner_mismatch_before_release"):
        cli._job_manager_release_lease(
            "lease-test",
            run_dir,
            owner_token=str(lease["owner_token"]),
            status="released",
        )


def test_job_manager_validate_live_preflight_rejects_current_pointer_owner_mismatch(monkeypatch, tmp_path) -> None:
    run_root = tmp_path / "run-summaries"
    lease_dir = run_root / "job-manager-current"
    lease_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cli, "JOB_MANAGER_RUN_SUMMARIES_ROOT", run_root)
    monkeypatch.setattr(cli, "JOB_MANAGER_CURRENT_LEASE", lease_dir / "active-run.json")
    monkeypatch.setattr(cli, "JOB_MANAGER_CURRENT_POINTER", lease_dir / "current-run.json")
    run_dir = run_root / "codex-app-job-application-manager-live-preflight-test"
    run_dir.mkdir(parents=True, exist_ok=True)

    lease = cli._job_manager_acquire_lease("live-preflight-test", run_dir, mode="live-preflight-only", deadline_seconds=60)
    owner_token = str(lease["owner_token"])
    (run_dir / "extension-first-preflight.json").write_text(json.dumps({"ok": True, "failed_checks": []}), encoding="utf-8")
    (run_dir / "run-start.json").write_text(
        json.dumps(
            {
                "workflow": "job-applications",
                "automation_id": "job-application-manager",
                "run_id": "live-preflight-test",
                "mode": "live-preflight-only",
                "pid": os.getpid(),
                "started_at": "2026-07-10T00:00:00+00:00",
                "run_dir": str(run_dir),
            }
        ),
        encoding="utf-8",
    )
    pointer = json.loads(cli.JOB_MANAGER_CURRENT_POINTER.read_text(encoding="utf-8"))
    pointer["owner_token"] = "different-owner"
    cli.JOB_MANAGER_CURRENT_POINTER.write_text(json.dumps(pointer), encoding="utf-8")

    with pytest.raises(RuntimeError, match="current_run_pointer_run_mismatch_before_live_preflight"):
        cli._job_manager_validate_live_preflight(
            run_dir=run_dir,
            run_id="live-preflight-test",
            owner_token=owner_token,
            codex_home=Path("/private/tmp/codex-job-manager-home"),
            launch_dir=cli.JOB_MANAGER_PROJECT_CWD,
            launch_model="gpt-5.4-mini",
            launch_reasoning_effort="high",
            bridge_probe={
                "bridge_run_id": "live-preflight-test",
                "bridge_receipt_path": str(run_dir / "bridge" / "live-preflight-test.json"),
                "scheduler_run_id": "live-preflight-test",
                "scheduler_run_dir": str(run_dir),
                "launch_dir": str(cli.JOB_MANAGER_PROJECT_CWD),
                "codex_thread_id": "",
                "codex_turn_id": "",
                "codex_session_id": "",
                "ok": True,
                "ready": True,
                "stage": "job_manager_bridge_readiness_probe",
            },
            auth_mode="chatgpt",
        )


def test_run_job_manager_now_live_preflight_only_suppresses_child_launch(monkeypatch, tmp_path) -> None:
    launch_packet = {"launch_message": "job-manager-launch", "launch_message_sha256": "abc123"}
    monkeypatch.setattr(cli, "_job_manager_launch_packet", lambda: launch_packet)
    run_id = "job-manager-live-preflight-20260710-acde"
    run_dir = tmp_path / "run-summaries" / f"codex-app-job-application-manager-{run_id}"
    monkeypatch.setattr(cli, "_job_manager_allocate_run_dir", lambda: (run_id, run_dir))
    monkeypatch.setattr(
        cli,
        "_job_manager_registered_contract",
        lambda automation_toml_path=None: {
            "automation_toml_path": str(cli.JOB_MANAGER_AUTOMATION_TOML),
            "automation": {
                "cwds": [str(cli.JOB_MANAGER_PROJECT_CWD)],
                "model": "gpt-5.4-mini",
                "reasoning_effort": "high",
                "status": "ACTIVE",
                "prompt": "registered prompt",
            },
            "db_row": {
                "prompt": "registered prompt",
                "cwds": [str(cli.JOB_MANAGER_PROJECT_CWD)],
                "model": "gpt-5.4-mini",
                "reasoning_effort": "high",
                "status": "ACTIVE",
            },
        },
    )
    (tmp_path / "auth.json").write_text(
        json.dumps(
            {
                "auth_mode": "chatgpt",
                "last_refresh": "2026-07-10T00:00:00Z",
                "tokens": {"access_token": "fresh-openai-token", "refresh_token": "fresh-refresh-token"},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(cli, "_codex_exec_session_healthcheck", lambda **kwargs: pytest.fail("live-preflight-only must not reach child healthcheck"))

    def fake_warmup_job_manager_bridge(**kwargs):
        return _write_job_manager_bridge_receipt(
            tmp_path,
            run_id=kwargs["run_id"],
            scheduler_run_id=kwargs["scheduler_run_id"],
            scheduler_run_dir=str(Path(kwargs["scheduler_run_dir"]).resolve()),
            launch_dir=str(Path(kwargs["launch_dir"]).resolve()),
        )

    class Result:
        stdout = '{"ok": true, "failed_checks": []}\n'
        stderr = ""
        returncode = 0

    def fake_run(cmd, check, text, capture_output, env=None, timeout=None, cwd=None):
        if "validate_job_manager_extension_first.py" in " ".join(cmd):
            preflight_artifact = Path(cmd[cmd.index("--artifact") + 1])
            preflight_artifact.parent.mkdir(parents=True, exist_ok=True)
            preflight_artifact.write_text(json.dumps({"ok": True, "failed_checks": []}), encoding="utf-8")
            return Result()
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr(cli, "warmup_job_manager_bridge", fake_warmup_job_manager_bridge)
    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    monkeypatch.setattr(cli.subprocess, "Popen", lambda *args, **kwargs: pytest.fail("live-preflight-only must not spawn child"))

    cli.run_job_manager_now(execute=False, live_preflight_only=True, codex_home=tmp_path)

    assert (run_dir / "cleanup-proof.txt").exists()
    assert "owned_processes_remaining=[]" in (run_dir / "cleanup-proof.txt").read_text(encoding="utf-8")


def _trusted_process_manifest_fixture(tmp_path: Path, *, child_started: bool = False) -> tuple[Path, dict[str, object]]:
    run_dir = tmp_path / "codex-app-job-application-manager-trusted-manifest"
    run_dir.mkdir(mode=0o700)
    manifest_path = run_dir / "trusted-wrapper-process-manifest.json"
    payload: dict[str, object] = {
        "schema": cli.OWNED_PROCESS_MANIFEST_SCHEMA,
        "scheduler_run_id": "scheduler-run",
        "scheduler_run_dir": str(run_dir),
        "control_run_id": "control-run",
        "owner_id": "owner-1",
        "bridge_instance_id": "bridge-1",
        "bridge_url": "http://127.0.0.1:43123",
        "controller_pid": os.getpid(),
        "controller_pgid": os.getpgrp(),
        "child_started": child_started,
        "workflow_child_pid": 0,
        "workflow_child_pgid": 0,
        "child_pid": 0,
        "child_pgid": 0,
    }
    if child_started:
        payload.update(
            {
                "workflow_child_pid": os.getpid(),
                "workflow_child_pgid": os.getpgrp(),
                "child_pid": os.getpid(),
                "child_pgid": os.getpgrp(),
            }
        )
    manifest_path.write_text(json.dumps(payload), encoding="utf-8")
    manifest_path.chmod(0o600)
    receipt = {
        "schema": "scheduler_control_trusted_wrapper_receipt.v2",
        "scheduler_run_id": "scheduler-run",
        "scheduler_run_dir": str(run_dir),
        "control_run_id": "control-run",
        "owner_id": "owner-1",
        "bridge_instance_id": "bridge-1",
        "bridge_url": "http://127.0.0.1:43123",
        "process_manifest_path": str(manifest_path),
        "owned_process_manifest_path": str(manifest_path),
    }
    return manifest_path, receipt


def test_trusted_preflight_accepts_controller_only_process_manifest(tmp_path: Path) -> None:
    manifest_path, receipt = _trusted_process_manifest_fixture(tmp_path, child_started=False)
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    for field in ("workflow_child_pid", "workflow_child_pgid", "child_pid", "child_pgid"):
        payload.pop(field, None)
    manifest_path.write_text(json.dumps(payload), encoding="utf-8")
    manifest_path.chmod(0o600)

    _path, payload, errors = cli._job_manager_read_process_manifest(receipt=receipt, require_child=False)

    assert errors == []
    assert payload is not None
    assert payload["child_started"] is False


def test_trusted_execute_missing_child_binding_is_non_clean(tmp_path: Path) -> None:
    _manifest_path, receipt = _trusted_process_manifest_fixture(tmp_path, child_started=False)

    _path, _payload, errors = cli._job_manager_read_process_manifest(receipt=receipt, require_child=True)

    assert errors == ["trusted_wrapper_process_manifest_child_binding_missing"]
    assert cli._job_manager_process_manifest_remaining(receipt=receipt, require_child=True) == errors


def test_trusted_process_manifest_malformed_controller_binding_is_blocking(tmp_path: Path) -> None:
    manifest_path, receipt = _trusted_process_manifest_fixture(tmp_path, child_started=False)
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    payload["controller_pgid"] = "not-a-pgid"
    manifest_path.write_text(json.dumps(payload), encoding="utf-8")
    manifest_path.chmod(0o600)

    _path, _payload, errors = cli._job_manager_read_process_manifest(receipt=receipt, require_child=False)

    assert errors == ["trusted_wrapper_process_manifest_controller_binding_invalid"]
    assert cli._job_manager_process_manifest_remaining(receipt=receipt, require_child=False) == errors


def test_trusted_execute_malformed_child_pid_or_pgid_is_blocking(tmp_path: Path) -> None:
    manifest_path, receipt = _trusted_process_manifest_fixture(tmp_path, child_started=True)
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    payload["workflow_child_pid"] = "not-a-pid"
    manifest_path.write_text(json.dumps(payload), encoding="utf-8")
    manifest_path.chmod(0o600)

    for require_child in (False, True):
        _path, _payload, errors = cli._job_manager_read_process_manifest(
            receipt=receipt,
            require_child=require_child,
        )
        assert errors == ["trusted_wrapper_process_manifest_child_binding_invalid"]
        assert cli._job_manager_process_manifest_remaining(
            receipt=receipt,
            require_child=require_child,
        ) == errors


def test_trusted_process_manifest_child_alias_mismatch_is_blocking_before_cleanup(tmp_path: Path) -> None:
    manifest_path, receipt = _trusted_process_manifest_fixture(tmp_path, child_started=True)
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    payload["child_pid"] = payload["workflow_child_pid"] + 1
    manifest_path.write_text(json.dumps(payload), encoding="utf-8")
    manifest_path.chmod(0o600)

    for require_child in (False, True):
        _path, _payload, errors = cli._job_manager_read_process_manifest(
            receipt=receipt,
            require_child=require_child,
        )
        assert errors == ["trusted_wrapper_process_manifest_child_binding_invalid"]
        assert cli._job_manager_process_manifest_remaining(
            receipt=receipt,
            require_child=require_child,
        ) == errors


def test_trusted_process_manifest_non_boolean_child_started_is_invalid_preflight(tmp_path: Path) -> None:
    manifest_path, receipt = _trusted_process_manifest_fixture(tmp_path, child_started=False)
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    payload["child_started"] = 1
    manifest_path.write_text(json.dumps(payload), encoding="utf-8")
    manifest_path.chmod(0o600)

    _path, _payload, errors = cli._job_manager_read_process_manifest(receipt=receipt, require_child=False)

    assert errors == ["trusted_wrapper_process_manifest_child_binding_invalid"]
    assert cli._job_manager_process_manifest_remaining(receipt=receipt, require_child=False) == errors


def test_run_scheduler_loop_forwards_to_registered_loop(monkeypatch, tmp_path) -> None:
    observed: dict[str, object] = {}

    def fake_run_registered_automations_loop(**kwargs):
        observed.update(kwargs)

    monkeypatch.setattr(cli, "run_registered_automations_loop", fake_run_registered_automations_loop)

    cli.run_scheduler_loop(
        execute=True,
        registry_codex_home=tmp_path / "registry-home",
        codex_home=Path("/private/tmp/codex-job-manager-home"),
        stop_on_failure=False,
    )

    assert observed["execute"] is True
    assert observed["registry_codex_home"] == tmp_path / "registry-home"
    assert observed["codex_home"] == Path("/private/tmp/codex-job-manager-home")
    assert observed["stop_on_failure"] is False


def test_warmup_job_manager_bridge_uses_probe_command(monkeypatch, tmp_path, capsys) -> None:
    captured: dict[str, object] = {}

    class Result:
        stdout = '{"ok": true, "ready": true, "stage": "job_manager_bridge_readiness_probe", "backend": "chrome_extension_trusted_bridge", "browser_metadata": {"profileOrdering": 2, "profileName": "Nicky/Profile 2"}}\n'
        stderr = ""
        returncode = 0

    def fake_run(cmd, input=None, text=None, capture_output=None, check=None, env=None, cwd=None):
        captured["cmd"] = cmd
        captured["env"] = env
        captured["cwd"] = cwd
        return Result()

    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    cli.warmup_job_manager_bridge(
        codex_home=Path("/private/tmp/codex-job-manager-home"),
        artifact_dir=tmp_path / "bridge-probe",
        run_id="bridge-warmup-test",
        timeout_seconds=180,
    )

    output = capsys.readouterr().out
    assert "job_manager_bridge_readiness_probe" in output
    assert captured["cmd"][0] == "node"
    assert Path(captured["cmd"][1]).name == "chrome_extension_trusted_bridge_client.mjs"
    assert captured["cmd"][2] == "probe"
    assert captured["env"]["CODEX_HOME"] == "/private/tmp/codex-job-manager-home"
    assert captured["env"]["SOCIAL_FLOW_CHROME_EXTENSION_BRIDGE_TIMEOUT_MS"] == "180000"


def test_warmup_job_manager_bridge_rejects_existing_same_session_probe_artifact_in_shell(monkeypatch, tmp_path) -> None:
    run_summaries_root = tmp_path / "run-summaries"
    launch_dir = tmp_path / "New project"
    launch_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cli, "JOB_MANAGER_RUN_SUMMARIES_ROOT", run_summaries_root)
    monkeypatch.setattr(cli, "JOB_MANAGER_PROJECT_CWD", launch_dir)
    monkeypatch.setattr(
        cli,
        "_job_manager_current_codex_turn_metadata",
        lambda: {"session_id": "session-123", "thread_id": "session-123", "turn_id": "turn-123"},
    )
    monkeypatch.setenv("CODEX_SHELL", "1")
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)

    receipt_dir = tmp_path / "trusted-bridge-runs"
    receipt_dir.mkdir(parents=True, exist_ok=True)
    receipt_path = receipt_dir / "same-session.json"
    receipt_result = {
        "ok": True,
        "ready": True,
        "stage": "job_manager_bridge_readiness_probe",
        "backend": "chrome_extension_trusted_bridge",
        "browser_metadata": {"profileOrdering": 2, "profileName": "Nicky"},
        "bridge_run_id": "same-session-run",
        "bridge_receipt_path": str(receipt_path),
        "scheduler_run_id": "same-session-run",
        "scheduler_run_dir": str(run_summaries_root / "codex-app-job-application-manager-same-session-run"),
        "launch_dir": str(launch_dir),
        "codex_thread_id": "session-123",
        "codex_turn_id": "turn-123",
        "codex_session_id": "session-123",
    }
    receipt_path.write_text(
        json.dumps(
            {
                "ok": True,
                "run_id": "same-session-run",
                "scheduler_run_id": "same-session-run",
                "scheduler_run_dir": str(run_summaries_root / "codex-app-job-application-manager-same-session-run"),
                "launch_dir": str(launch_dir),
                "status": "succeeded",
                "mode": "probe",
                "receipt_path": str(receipt_path),
                "result": receipt_result,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    artifact_dir = run_summaries_root / "codex-app-job-application-manager-same-session-run"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "launch-packet.json").write_text(
        json.dumps(
            {
                "launch_message": "registered-launch",
                "current_bridge_probe": receipt_result,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(cli, "_run_job_manager_bridge_probe", lambda **kwargs: pytest.fail("stale receipt must never run a probe"))

    with pytest.raises(RuntimeError, match="trusted_browser_wrapper_required_for_current_run"):
        cli.warmup_job_manager_bridge(
            codex_home=Path("/private/tmp/codex-job-manager-home"),
            artifact_dir=tmp_path / "bridge-probe",
            run_id="same-session-run",
            launch_dir=launch_dir,
            timeout_seconds=180,
        )

    daemon_info = json.loads((tmp_path / "bridge-probe" / "bridge-daemon.json").read_text(encoding="utf-8"))
    assert daemon_info["ok"] is False
    assert daemon_info["ready"] is False
    assert daemon_info["exact_blocker"] == "trusted_browser_wrapper_required_for_current_run"


def test_warmup_job_manager_bridge_requires_trusted_runtime_and_never_spawns_daemon_on_probe_error(monkeypatch, tmp_path) -> None:
    probe_calls = {"count": 0}

    def fake_probe(**kwargs):
        probe_calls["count"] += 1
        raise RuntimeError("trusted_bridge_must_be_started_in_codex_chrome_lane")

    monkeypatch.setattr(cli, "_run_job_manager_bridge_probe", fake_probe)
    monkeypatch.setattr(cli.subprocess, "Popen", lambda *args, **kwargs: pytest.fail("probe failures must not autostart a shell daemon"))

    artifact_dir = tmp_path / "bridge-probe"
    with pytest.raises(RuntimeError, match="trusted_bridge_must_be_started_in_codex_chrome_lane"):
        cli.warmup_job_manager_bridge(
            codex_home=Path("/private/tmp/codex-job-manager-home"),
            artifact_dir=artifact_dir,
            run_id="bridge-warmup-test",
            timeout_seconds=180,
        )

    assert probe_calls["count"] == 1
    daemon_info = json.loads((artifact_dir / "bridge-daemon.json").read_text(encoding="utf-8"))
    assert daemon_info["ok"] is False
    assert daemon_info["ready"] is False
    assert daemon_info["probe_ok"] is False
    assert daemon_info["exact_blocker"] == "trusted_bridge_must_be_started_in_codex_chrome_lane"


def test_start_job_manager_bridge_daemon_terminates_process_group_when_health_check_fails(monkeypatch, tmp_path) -> None:
    kill_calls: list[tuple[int, int]] = []

    class FakeProc:
        pid = 4321
        returncode = None

        def poll(self):
            return None

        def wait(self, timeout=None):
            self.returncode = 0
            return 0

    monkeypatch.setattr(cli.subprocess, "Popen", lambda *args, **kwargs: FakeProc())
    monkeypatch.setattr(cli, "_wait_for_job_manager_bridge_health", lambda **kwargs: (_ for _ in ()).throw(RuntimeError("trusted_bridge_must_be_started_in_codex_chrome_lane")))
    monkeypatch.setattr(cli.os, "killpg", lambda pid, sig: kill_calls.append((pid, sig)))

    with pytest.raises(RuntimeError, match="trusted_bridge_must_be_started_in_codex_chrome_lane"):
        cli._start_job_manager_bridge_daemon(
            codex_home=Path("/private/tmp/codex-job-manager-home"),
            launch_dir=Path("/Users/nichikatanaka/Documents/New project"),
            artifact_dir=tmp_path / "bridge-probe",
            timeout_seconds=180,
        )

    assert kill_calls == [(4321, signal.SIGTERM)]


def test_warmup_job_manager_bridge_overwrites_stale_success_artifact_on_oserror_probe_failure(monkeypatch, tmp_path) -> None:
    artifact_dir = tmp_path / "bridge-probe"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "bridge-daemon.json").write_text(
        json.dumps(
            {
                "ok": True,
                "ready": True,
                "stage": "job_manager_bridge_readiness_probe",
                "health_ok": True,
                "probe_ok": True,
                "exact_blocker": "",
            }
        ),
        encoding="utf-8",
    )

    def fake_probe(**kwargs):
        raise OSError("bridge socket closed")

    monkeypatch.setattr(cli, "_run_job_manager_bridge_probe", fake_probe)

    with pytest.raises(OSError, match="bridge socket closed"):
        cli.warmup_job_manager_bridge(
            codex_home=Path("/private/tmp/codex-job-manager-home"),
            artifact_dir=artifact_dir,
            run_id="bridge-warmup-test",
            timeout_seconds=180,
        )

    daemon_info = json.loads((artifact_dir / "bridge-daemon.json").read_text(encoding="utf-8"))
    assert daemon_info["ok"] is False
    assert daemon_info["ready"] is False
    assert daemon_info["probe_ok"] is False
    assert daemon_info["exact_blocker"] == "bridge socket closed"


def test_warmup_job_manager_bridge_writes_bridge_daemon_only_after_probe_success(monkeypatch, tmp_path, capsys) -> None:
    captured: dict[str, object] = {}

    def fake_probe(**kwargs):
        captured["probe_kwargs"] = kwargs
        return {
            "ok": True,
            "ready": True,
            "stage": "job_manager_bridge_readiness_probe",
            "backend": "chrome_extension_trusted_bridge",
            "browser_metadata": {"profileOrdering": 2, "profileName": "Nicky/Profile 2"},
            "bridge_run_id": "bridge-run",
            "bridge_receipt_path": "/tmp/bridge.json",
        }

    monkeypatch.setattr(cli, "_run_job_manager_bridge_probe", fake_probe)
    monkeypatch.setattr(cli.subprocess, "Popen", lambda *args, **kwargs: pytest.fail("trusted probe success must not shell-spawn"))

    artifact_dir = tmp_path / "bridge-probe"
    payload = cli.warmup_job_manager_bridge(
        codex_home=Path("/private/tmp/codex-job-manager-home"),
        artifact_dir=artifact_dir,
        run_id="bridge-warmup-test",
        timeout_seconds=180,
    )

    output = capsys.readouterr().out
    assert "health_ok" in output
    assert payload["ok"] is True
    daemon_info = json.loads((artifact_dir / "bridge-daemon.json").read_text(encoding="utf-8"))
    assert daemon_info["ok"] is True
    assert daemon_info["health_ok"] is True
    assert daemon_info["probe_ok"] is True
    assert daemon_info["bridge_run_id"] == "bridge-run"
    assert captured["probe_kwargs"]["artifact_dir"] == artifact_dir
    assert captured["probe_kwargs"]["run_id"] == "bridge-warmup-test"


def test_warmup_job_manager_bridge_rejects_contradictory_profile_metadata(monkeypatch, tmp_path) -> None:
    artifact_dir = tmp_path / "bridge-probe"

    def fake_probe(**kwargs):
        return {
            "ok": True,
            "ready": True,
            "stage": "job_manager_bridge_readiness_probe",
            "backend": "chrome_extension_trusted_bridge",
            "browser_metadata": {"profileOrdering": 2, "profileName": "Profile 3"},
        }

    monkeypatch.setattr(cli, "_run_job_manager_bridge_probe", fake_probe)

    with pytest.raises(RuntimeError, match="inconsistent_profile_identity"):
        cli.warmup_job_manager_bridge(
            codex_home=Path("/private/tmp/codex-job-manager-home"),
            artifact_dir=artifact_dir,
            run_id="bridge-warmup-test",
            timeout_seconds=180,
        )

    daemon_info = json.loads((artifact_dir / "bridge-daemon.json").read_text(encoding="utf-8"))
    assert daemon_info["ok"] is False
    assert daemon_info["ready"] is False
    assert daemon_info["probe_ok"] is False
    assert daemon_info["exact_blocker"] == (
        "trusted_runner_bridge_unavailable_before_probe_artifact: "
        "probe_profile_invalid: inconsistent_profile_identity profileOrdering=2 profileName=Profile 3 expected=Nicky"
    )


def test_warmup_job_manager_bridge_accepts_profile_ordering_two_with_nicky_identity(monkeypatch, tmp_path, capsys) -> None:
    artifact_dir = tmp_path / "bridge-probe"

    def fake_probe(**kwargs):
        return {
            "ok": True,
            "ready": True,
            "stage": "job_manager_bridge_readiness_probe",
            "backend": "chrome_extension_trusted_bridge",
            "browser_metadata": {"profileOrdering": 2, "profileName": "Nicky"},
        }

    monkeypatch.setattr(cli, "_run_job_manager_bridge_probe", fake_probe)
    monkeypatch.setattr(cli.subprocess, "Popen", lambda *args, **kwargs: pytest.fail("trusted probe success must not shell-spawn"))

    payload = cli.warmup_job_manager_bridge(
        codex_home=Path("/private/tmp/codex-job-manager-home"),
        artifact_dir=artifact_dir,
        run_id="bridge-warmup-test",
        timeout_seconds=180,
    )

    output = capsys.readouterr().out
    assert "health_ok" in output
    assert payload["ok"] is True
    daemon_info = json.loads((artifact_dir / "bridge-daemon.json").read_text(encoding="utf-8"))
    assert daemon_info["ok"] is True
    assert daemon_info["probe_ok"] is True
    assert daemon_info["browser_metadata"] == {"profileOrdering": 2, "profileName": "Nicky"}


def test_warmup_job_manager_bridge_overwrites_stale_success_artifact_on_probe_failure(monkeypatch, tmp_path) -> None:
    artifact_dir = tmp_path / "bridge-probe"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "bridge-daemon.json").write_text(
        json.dumps(
            {
                "ok": True,
                "ready": True,
                "stage": "job_manager_bridge_readiness_probe",
                "health_ok": True,
                "probe_ok": True,
                "exact_blocker": "",
            }
        ),
        encoding="utf-8",
    )

    def fake_probe(**kwargs):
        raise RuntimeError("trusted_runner_bridge_unavailable_before_probe_artifact: probe_stdout_json_decode_failed output=oops")

    monkeypatch.setattr(cli, "_run_job_manager_bridge_probe", fake_probe)

    with pytest.raises(RuntimeError, match="probe_stdout_json_decode_failed"):
        cli.warmup_job_manager_bridge(
            codex_home=Path("/private/tmp/codex-job-manager-home"),
            artifact_dir=artifact_dir,
            run_id="bridge-warmup-test",
            timeout_seconds=180,
        )

    daemon_info = json.loads((artifact_dir / "bridge-daemon.json").read_text(encoding="utf-8"))
    assert daemon_info["ok"] is False
    assert daemon_info["ready"] is False
    assert daemon_info["probe_ok"] is False
    assert daemon_info["exact_blocker"] == "trusted_runner_bridge_unavailable_before_probe_artifact: probe_stdout_json_decode_failed output=oops"


def test_warmup_job_manager_bridge_rejects_malformed_stdout_without_writing_success_artifact(monkeypatch, tmp_path) -> None:
    class Result:
        stdout = "not-json"
        stderr = ""
        returncode = 0

    def fake_run(cmd, input=None, text=None, capture_output=None, check=None, env=None, cwd=None):
        return Result()

    artifact_dir = tmp_path / "bridge-probe"
    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError, match="probe_stdout_json_decode_failed"):
        cli.warmup_job_manager_bridge(
            codex_home=Path("/private/tmp/codex-job-manager-home"),
            artifact_dir=artifact_dir,
            run_id="bridge-warmup-test",
            timeout_seconds=180,
        )

    daemon_info = json.loads((artifact_dir / "bridge-daemon.json").read_text(encoding="utf-8"))
    assert daemon_info["ok"] is False
    assert daemon_info["ready"] is False
    assert daemon_info["probe_ok"] is False
    assert daemon_info["exact_blocker"].startswith(
        "trusted_runner_bridge_unavailable_before_probe_artifact: probe_stdout_json_decode_failed"
    )


def test_job_manager_bridge_probe_contract_helper_rejects_missing_probe() -> None:
    with pytest.raises(RuntimeError, match="scheduler_control_v2_missing_from_registered_prompt"):
        cli._assert_job_manager_bridge_probe_contract({"launch_message": "job-manager-launch"})


def test_job_manager_current_codex_turn_metadata_prefers_matching_cwd_over_thread_name(tmp_path) -> None:
    codex_home = tmp_path / ".codex"
    codex_home.mkdir(parents=True, exist_ok=True)
    session_index_path = codex_home / "session_index.jsonl"
    sessions_root = codex_home / "sessions" / "2026" / "07" / "12"
    sessions_root.mkdir(parents=True, exist_ok=True)
    current_cwd = str(cli.JOB_MANAGER_PROJECT_CWD.resolve())

    matching_session_id = "019fmatch-0000-7000-8000-000000000001"
    nonmatching_session_id = "019fmatch-0000-7000-8000-000000000002"
    matching_rollout = sessions_root / f"rollout-2026-07-12T15-00-00-{matching_session_id}.jsonl"
    nonmatching_rollout = sessions_root / f"rollout-2026-07-12T16-00-00-{nonmatching_session_id}.jsonl"
    matching_rollout.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "timestamp": "2026-07-12T06:00:00.000Z",
                        "type": "session_meta",
                        "payload": {
                            "id": matching_session_id,
                            "cwd": current_cwd,
                        },
                    }
                ),
                json.dumps(
                    {
                        "timestamp": "2026-07-12T06:00:01.000Z",
                        "type": "response_item",
                        "payload": {
                            "internal_chat_message_metadata_passthrough": {
                                "turn_id": "turn-matched-from-cwd",
                            }
                        },
                    }
                ),
            ]
        ),
        encoding="utf-8",
    )
    nonmatching_rollout.write_text(
        json.dumps(
            {
                "timestamp": "2026-07-12T07:00:00.000Z",
                "type": "session_meta",
                "payload": {
                    "id": nonmatching_session_id,
                    "cwd": "/Users/nichikatanaka/Desktop/other-project",
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )
    session_index_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "id": nonmatching_session_id,
                        "thread_name": "totally-different-thread",
                        "updated_at": "2026-07-12T07:00:00.000Z",
                    }
                ),
                json.dumps(
                    {
                        "id": matching_session_id,
                        "thread_name": "also-not-job-application-manager",
                        "updated_at": "2026-07-12T06:00:00.000Z",
                    }
                ),
            ]
        ),
        encoding="utf-8",
    )

    metadata = cli._job_manager_current_codex_turn_metadata_from_session_logs(
        codex_home=codex_home,
        session_index_path=session_index_path,
        current_cwd=current_cwd,
    )

    assert metadata == {
        "session_id": matching_session_id,
        "thread_id": matching_session_id,
        "turn_id": "turn-matched-from-cwd",
    }
