from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlparse

from bs4 import BeautifulSoup
import feedparser
import requests
import trafilatura


@dataclass
class SourceDocument:
    title: str
    url: str
    summary_en: str
    source_name: str
    source_type: str


@dataclass(frozen=True)
class SourceConfig:
    source_type: str
    source_name: str
    feed_url: str = ""
    path: str = ""
    limit: int = 10
    include_keywords: tuple[str, ...] = ()
    exclude_keywords: tuple[str, ...] = ()


VIDEO_EXTENSIONS = (".mp4", ".mov", ".m4v", ".webm", ".avi")


def _matches_keywords(text: str, include_keywords: tuple[str, ...], exclude_keywords: tuple[str, ...]) -> bool:
    normalized = text.lower()
    if include_keywords and not any(keyword.lower() in normalized for keyword in include_keywords):
        return False
    if exclude_keywords and any(keyword.lower() in normalized for keyword in exclude_keywords):
        return False
    return True


def collect_from_rss(
    source_name: str,
    feed_url: str,
    limit: int = 10,
    include_keywords: tuple[str, ...] = (),
    exclude_keywords: tuple[str, ...] = (),
) -> list[SourceDocument]:
    feed = feedparser.parse(feed_url)
    items: list[SourceDocument] = []
    for entry in feed.entries:
        summary = (entry.get("summary") or entry.get("description") or "").strip()
        title = (entry.get("title") or "").strip()
        if not _matches_keywords(f"{title}\n{summary}", include_keywords, exclude_keywords):
            continue
        summary = (entry.get("summary") or entry.get("description") or "").strip()
        items.append(
            SourceDocument(
                title=title,
                url=(entry.get("link") or "").strip(),
                summary_en=summary,
                source_name=source_name,
                source_type="rss",
            )
        )
        if len(items) >= limit:
            break
    return items


def collect_from_url(url: str, source_name: str) -> SourceDocument:
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
    except requests.RequestException as exc:
        return _fallback_url_document(url=url, source_name=source_name, error=exc)
    metadata = trafilatura.extract_metadata(response.text)
    extracted = trafilatura.extract(
        response.text,
        include_links=False,
        include_images=False,
        favor_precision=True,
    )
    text = (extracted or "").strip()
    summary = "\n".join(text.splitlines()[:12]).strip()
    title = metadata.title if metadata and metadata.title else ""
    return SourceDocument(
        title=(title or url).strip(),
        url=url,
        summary_en=summary,
        source_name=source_name,
        source_type="url",
    )


def _fallback_url_document(url: str, source_name: str, error: Exception) -> SourceDocument:
    parsed = urlparse(url)
    title_parts = [part for part in unquote(parsed.path).strip("/").split("/") if part]
    title = title_parts[-1].replace("-", " ").replace("_", " ").strip() if title_parts else parsed.netloc
    if title:
        title = title[:1].upper() + title[1:]
    summary = (
        "URL fetch failed during collection, but the official source URL was preserved so the Daily AI "
        "workflow can keep this candidate in the local queue for later drafting, verification, and media "
        f"gates. fetch_error={type(error).__name__}: {error}"
    )
    return SourceDocument(
        title=(title or url).strip(),
        url=url,
        summary_en=summary,
        source_name=source_name,
        source_type="url_fetch_failed",
    )


def collect_from_url_list(path: str, source_name: str) -> list[SourceDocument]:
    documents: list[SourceDocument] = []
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        url = raw.strip()
        if not url:
            continue
        documents.append(collect_from_url(url, source_name=source_name))
    return documents


def extract_google_drive_folder_id(folder_url: str) -> str:
    patterns = [
        r"/folders/([a-zA-Z0-9_-]+)",
        r"[?&]id=([a-zA-Z0-9_-]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, folder_url)
        if match:
            return match.group(1)
    raise ValueError(f"Could not extract Google Drive folder id from: {folder_url}")


def extract_google_drive_file_id(file_url: str) -> str:
    patterns = [
        r"/file/d/([a-zA-Z0-9_-]+)",
        r"[?&]id=([a-zA-Z0-9_-]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, file_url)
        if match:
            return match.group(1)
    return ""


def collect_from_google_drive_folder(folder_url: str, source_name: str = "Google Drive") -> list[SourceDocument]:
    folder_id = extract_google_drive_folder_id(folder_url)
    embedded_url = f"https://drive.google.com/embeddedfolderview?id={folder_id}#list"
    response = requests.get(embedded_url, timeout=30)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    documents: list[SourceDocument] = []
    seen_urls: set[str] = set()
    for anchor in soup.select("a[href]"):
        href = str(anchor.get("href", "")).strip()
        title = anchor.get_text(" ", strip=True)
        if not href or not title:
            continue
        if "/file/d/" not in href and "drive.google.com/open" not in href:
            continue
        if not title.lower().endswith(VIDEO_EXTENSIONS):
            continue
        if href in seen_urls:
            continue
        seen_urls.add(href)
        documents.append(
            SourceDocument(
                title=title,
                url=href,
                summary_en=f"Video discovered in shared Google Drive folder `{source_name}`.",
                source_name=source_name,
                source_type="google_drive",
            )
        )
    return documents


def load_source_configs(path: str) -> list[SourceConfig]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("Source config JSON must be an array.")
    configs: list[SourceConfig] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Each source config entry must be an object.")
        source_type = str(item.get("source_type", "")).strip()
        source_name = str(item.get("source_name", "")).strip()
        if source_type not in {"rss", "url_list"}:
            raise ValueError(f"Unsupported source_type: {source_type}")
        if not source_name:
            raise ValueError("source_name is required.")
        configs.append(
            SourceConfig(
                source_type=source_type,
                source_name=source_name,
                feed_url=str(item.get("feed_url", "")).strip(),
                path=str(item.get("path", "")).strip(),
                limit=int(item.get("limit", 10)),
                include_keywords=tuple(str(keyword).strip() for keyword in item.get("include_keywords", []) if str(keyword).strip()),
                exclude_keywords=tuple(str(keyword).strip() for keyword in item.get("exclude_keywords", []) if str(keyword).strip()),
            )
        )
    return configs


def collect_from_source_configs(path: str) -> list[SourceDocument]:
    documents: list[SourceDocument] = []
    base_dir = Path(path).resolve().parent
    for config in load_source_configs(path):
        if config.source_type == "rss":
            if not config.feed_url:
                raise ValueError(f"feed_url is required for source `{config.source_name}`.")
            documents.extend(
                collect_from_rss(
                    source_name=config.source_name,
                    feed_url=config.feed_url,
                    limit=config.limit,
                    include_keywords=config.include_keywords,
                    exclude_keywords=config.exclude_keywords,
                )
            )
            continue
        if not config.path:
            raise ValueError(f"path is required for source `{config.source_name}`.")
        documents.extend(
            collect_from_url_list(
                path=str((base_dir / config.path).resolve()),
                source_name=config.source_name,
            )
        )
    return documents
