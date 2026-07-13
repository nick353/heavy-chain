from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote_plus
import re

from social_flow.models import QueueRow


_STOPWORDS = {
    "a",
    "an",
    "and",
    "announcing",
    "class",
    "come",
    "comes",
    "evolution",
    "for",
    "from",
    "how",
    "in",
    "introducing",
    "new",
    "next",
    "now",
    "of",
    "on",
    "our",
    "phase",
    "the",
    "their",
    "this",
    "to",
    "with",
}


@dataclass(frozen=True)
class ResearchPlan:
    primary_query: str
    x_live_url: str
    x_top_url: str
    linkedin_content_url: str
    fallback_queries: list[str]
    fallback_steps: list[str]


def _tokenize_title(title: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9.+-]*", title)
    filtered: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        lowered = token.lower()
        if lowered in _STOPWORDS:
            continue
        if lowered in seen:
            continue
        seen.add(lowered)
        filtered.append(token)
    return filtered


def build_research_queries(row: QueueRow) -> list[str]:
    title = row.title.strip()
    source_name = row.source_name.strip()
    tokens = _tokenize_title(title)

    keyword_query = " ".join(tokens[:6]).strip()
    source_query = " ".join(part for part in [source_name, keyword_query] if part).strip()

    candidates = [title, source_query, keyword_query]
    queries: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = " ".join(candidate.split()).strip()
        if not normalized:
            continue
        lowered = normalized.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        queries.append(normalized)
    return queries or [row.id]


def _x_search_url(query: str, *, live: bool) -> str:
    feed = "live" if live else "top"
    return f"https://x.com/search?q={quote_plus(query)}&src=typed_query&f={feed}"


def _linkedin_content_url(query: str) -> str:
    return f"https://www.linkedin.com/search/results/content/?keywords={quote_plus(query)}"


def build_research_plan(row: QueueRow) -> ResearchPlan:
    queries = build_research_queries(row)
    primary_query = queries[0]
    fallback_steps = [
        "まず直URLで検索結果へ入る。検索欄探しは最初にやらない。",
        "1画面で判断せず、最低3回スクロールして上位以外も見る。",
        "高反応投稿は詳細を開き、本文の長さ、冒頭のフック、画像か動画か、反応数を確認する。",
        "検索欄が必要なら header 全体、placeholder、aria-label、role=searchbox、虫眼鏡アイコンの順で探す。",
        "同じ画面で止まったら、DOM再取得、別セレクタ探索、別クエリ、直URL再入場の順で切り替える。",
        "X は live と top を両方見て、LinkedIn は content 検索を基準にする。",
    ]
    return ResearchPlan(
        primary_query=primary_query,
        x_live_url=_x_search_url(primary_query, live=True),
        x_top_url=_x_search_url(primary_query, live=False),
        linkedin_content_url=_linkedin_content_url(primary_query),
        fallback_queries=queries[1:],
        fallback_steps=fallback_steps,
    )


def format_research_plan_markdown(row: QueueRow) -> str:
    plan = build_research_plan(row)
    lines = [
        f"# Research Plan: {row.id}",
        "",
        f"- Primary query: {plan.primary_query}",
        f"- X live: {plan.x_live_url}",
        f"- X top: {plan.x_top_url}",
        f"- LinkedIn content: {plan.linkedin_content_url}",
    ]
    if plan.fallback_queries:
        lines.append(f"- Fallback queries: {', '.join(plan.fallback_queries)}")
    lines.extend(
        [
            "",
            "## Fallback loop",
            "",
        ]
    )
    for index, step in enumerate(plan.fallback_steps, start=1):
        lines.append(f"{index}. {step}")
    return "\n".join(lines)
