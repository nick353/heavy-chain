from __future__ import annotations

from social_flow.models import QueueRow
from social_flow.research_plan import build_research_plan, build_research_queries, format_research_plan_markdown


def test_build_research_queries_prefers_title_then_shorter_keywords() -> None:
    row = QueueRow(
        id="item-1",
        source_name="OpenAI",
        title="The next evolution of the Agents SDK",
    )

    queries = build_research_queries(row)

    assert queries[0] == "The next evolution of the Agents SDK"
    assert "OpenAI Agents SDK" in queries[1]
    assert "Agents SDK" in queries[2]


def test_build_research_plan_generates_direct_platform_urls() -> None:
    row = QueueRow(
        id="item-1",
        source_name="OpenAI",
        title="OpenAI models, Codex, and Managed Agents come to AWS",
    )

    plan = build_research_plan(row)

    assert "x.com/search" in plan.x_live_url
    assert "f=live" in plan.x_live_url
    assert "f=top" in plan.x_top_url
    assert "linkedin.com/search/results/content" in plan.linkedin_content_url
    assert plan.fallback_queries
    assert any("直URL" in step for step in plan.fallback_steps)


def test_format_research_plan_markdown_contains_fallback_loop() -> None:
    row = QueueRow(
        id="item-1",
        source_name="OpenAI",
        title="Introducing Advanced Account Security",
    )

    output = format_research_plan_markdown(row)

    assert "# Research Plan: item-1" in output
    assert "Fallback loop" in output
    assert "X live:" in output
