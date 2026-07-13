from __future__ import annotations

import json

import requests

from social_flow.sources import (
    collect_from_google_drive_folder,
    collect_from_rss,
    collect_from_url_list,
    collect_from_source_configs,
    extract_google_drive_folder_id,
    extract_google_drive_file_id,
    load_source_configs,
)


def test_load_source_configs_supports_rss_and_url_list(tmp_path) -> None:
    config_path = tmp_path / "sources.json"
    url_list_path = tmp_path / "urls.txt"
    url_list_path.write_text("https://example.com/post\n", encoding="utf-8")
    config_path.write_text(
        json.dumps(
            [
                {
                    "source_type": "rss",
                    "source_name": "OpenAI",
                    "feed_url": "https://openai.com/news/rss.xml",
                    "limit": 5,
                    "include_keywords": ["agent", "model"],
                },
                {
                    "source_type": "url_list",
                    "source_name": "manual",
                    "path": "urls.txt",
                },
            ]
        ),
        encoding="utf-8",
    )

    configs = load_source_configs(str(config_path))

    assert [config.source_type for config in configs] == ["rss", "url_list"]
    assert configs[0].limit == 5
    assert configs[0].include_keywords == ("agent", "model")
    assert str((tmp_path / configs[1].path).resolve()).endswith("urls.txt")


def test_collect_from_source_configs_rejects_unknown_type(tmp_path) -> None:
    config_path = tmp_path / "sources.json"
    config_path.write_text(
        json.dumps([{"source_type": "unknown", "source_name": "bad"}]),
        encoding="utf-8",
    )

    try:
        collect_from_source_configs(str(config_path))
    except ValueError as exc:
        assert "Unsupported source_type" in str(exc)
    else:
        raise AssertionError("Expected ValueError")


def test_collect_from_rss_filters_by_include_and_exclude_keywords(monkeypatch) -> None:
    class DummyFeed:
        entries = [
            {"title": "New model release", "link": "https://example.com/model", "summary": "agent support"},
            {"title": "Gardening tips", "link": "https://example.com/garden", "summary": "consumer tips"},
            {"title": "Agent benchmark", "link": "https://example.com/agent", "summary": "enterprise eval"},
        ]

    monkeypatch.setattr("social_flow.sources.feedparser.parse", lambda _: DummyFeed())

    docs = collect_from_rss(
        source_name="Test",
        feed_url="https://example.com/rss",
        limit=5,
        include_keywords=("model", "agent"),
        exclude_keywords=("gardening",),
    )

    assert [doc.title for doc in docs] == ["New model release", "Agent benchmark"]


def test_collect_from_url_list_preserves_timeout_urls(monkeypatch, tmp_path) -> None:
    url_list_path = tmp_path / "urls.txt"
    url_list_path.write_text(
        "https://example.com/working-post\nhttps://example.com/slow-post\n",
        encoding="utf-8",
    )

    class DummyResponse:
        text = "<html><head><title>Working post</title></head><body>Useful source body.</body></html>"

        def raise_for_status(self) -> None:
            return None

    def fake_get(url: str, **kwargs):
        if "slow-post" in url:
            raise requests.Timeout("read timed out")
        return DummyResponse()

    monkeypatch.setattr("social_flow.sources.requests.get", fake_get)

    docs = collect_from_url_list(str(url_list_path), source_name="manual")

    assert [doc.url for doc in docs] == ["https://example.com/working-post", "https://example.com/slow-post"]
    assert docs[1].source_type == "url_fetch_failed"
    assert "read timed out" in docs[1].summary_en


def test_extract_google_drive_ids() -> None:
    folder_url = "https://drive.google.com/drive/folders/1abcDEF_ghiJKL?usp=sharing"
    file_url = "https://drive.google.com/file/d/1fileABC_123/view?usp=drive_link"

    assert extract_google_drive_folder_id(folder_url) == "1abcDEF_ghiJKL"
    assert extract_google_drive_file_id(file_url) == "1fileABC_123"


def test_collect_from_google_drive_folder_filters_video_links(monkeypatch) -> None:
    html = """
    <html><body>
      <a href="https://drive.google.com/file/d/video123/view">demo-video.mp4</a>
      <a href="https://drive.google.com/file/d/doc456/view">notes.txt</a>
      <a href="https://drive.google.com/file/d/video789/view">clip.mov</a>
    </body></html>
    """

    class DummyResponse:
        text = html

        def raise_for_status(self) -> None:
            return None

    monkeypatch.setattr("social_flow.sources.requests.get", lambda *args, **kwargs: DummyResponse())

    docs = collect_from_google_drive_folder(
        "https://drive.google.com/drive/folders/1abcDEF_ghiJKL?usp=sharing"
    )

    assert [doc.title for doc in docs] == ["demo-video.mp4", "clip.mov"]
    assert docs[0].source_type == "google_drive"


def test_collect_from_url_list_preserves_timed_out_urls(monkeypatch, tmp_path) -> None:
    url = "https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/new-and-improved-computer-using-agents/"
    url_list_path = tmp_path / "urls.txt"
    url_list_path.write_text(url + "\n", encoding="utf-8")

    def raise_timeout(*args, **kwargs):
        raise requests.Timeout("read timed out")

    monkeypatch.setattr("social_flow.sources.requests.get", raise_timeout)

    docs = collect_from_url_list(str(url_list_path), source_name="manual")

    assert len(docs) == 1
    assert docs[0].url == url
    assert docs[0].source_type == "url_fetch_failed"
    assert "New and improved computer using agents" in docs[0].title
    assert "fetch_error=Timeout" in docs[0].summary_en
