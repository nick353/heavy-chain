from __future__ import annotations

from social_flow.ai import build_generation_prompt, humanize_post_for_publish
from social_flow.models import LEGACY_QUEUE_COLUMNS, QUEUE_COLUMNS, QueueRow


def test_build_generation_prompt_includes_research_context() -> None:
    row = QueueRow(
        title="OpenAI models, Codex, and Managed Agents come to AWS",
        source_url="https://openai.com/index/openai-on-aws/",
        summary_en="OpenAI expanded AWS availability.",
        research_status="done",
        freshness_checked_at="2026-05-09T00:00:00+00:00",
        angle="既存AWS運用のまま導入しやすくなった点",
        x_research_notes="Xでは Bedrock 経由の導入しやすさが話題。",
        linkedin_research_notes="LinkedInではガバナンスと既存運用への接続が関心事。",
        past_post_reference="SaaS導入実務の観点をよく使う。",
        reference_post_urls="https://x.com/OpenAI/status/1",
        reference_account_handles="@OpenAI, @awscloud",
        reference_media_urls="https://pbs.twimg.com/media/example.jpg",
        reference_media_notes="公式はプロダクトUIのスクリーンショットと短いデモ動画を使っている。",
        media_plan="UIスクリーンショット1枚",
        content_format="official_demo_breakdown",
        publish_strategy="tooling_update",
    )

    prompt = build_generation_prompt(row)

    assert "Research status:" in prompt
    assert "done" in prompt
    assert "Bedrock" in prompt
    assert "ガバナンス" in prompt
    assert '"angle": "One short Japanese sentence' in prompt
    assert "Reference media notes:" in prompt
    assert '"media_plan": "One short Japanese sentence' in prompt
    assert "Content format editorial lens:" in prompt
    assert "official_demo_breakdown" in prompt
    assert "Publish strategy:" in prompt
    assert "tooling_update" in prompt
    assert "direction, not a formula" in prompt
    assert "Avoid forced section order" in prompt
    assert '"linkedin_text": "LinkedIn post in English' in prompt
    assert "source-specific observation" in prompt
    assert "familiar natural-sounding hooks" in prompt
    assert "One practical way to read this update" in prompt
    assert "source-specific noun, number, integration, workflow friction" in prompt
    assert "Do not default to text + URL" in prompt
    assert "visible posting-surface contract" in prompt
    assert "native X quote" in prompt
    assert "self-made card" in prompt
    assert "LinkedIn carousel" in prompt
    assert "X引用解釈カード型" in prompt
    assert "X自作判断カード型" in prompt
    assert "LinkedIn正方形1枚画像型" in prompt
    assert "LinkedInカルーセル型" in prompt
    assert "LinkedInリンクカード型" in prompt
    assert "X本文+URL型" in prompt
    assert "LinkedIn本文+URL型" not in prompt
    assert "native X quote from the source post's repost menu" in prompt
    assert "YYYY-MM-DD-<queue_id>" in prompt
    assert "square carousel" in prompt
    assert "one source-specific square image" in prompt
    assert "square format" in prompt
    assert "feed Photo/写真 div[role=button] route" in prompt
    assert "not through shareActive=true or Start a post as the media upload entry" in prompt
    assert "Runway MCP `gpt-image-2`" in prompt
    assert "provider=runway_mcp" in prompt
    assert "not a demo, placeholder, or operation-verification card" in prompt
    assert "No-media LinkedIn posts are allowed only when the media plan explicitly names a no-media surface" in prompt
    assert "do not let a media-required plan degrade into plain text" in prompt


def test_queue_row_supports_legacy_row_values_under_new_header() -> None:
    legacy_values = [
        "item-1",
        "rss",
        "OpenAI",
        "https://example.com/post",
        "Title",
        "Summary EN",
        "Summary JA",
        "approved",
        "2026-05-09T00:00:00+00:00",
        "",
        "",
        "",
        "",
        "",
        "x text",
        "linkedin text",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
    ]

    row = QueueRow.from_sheet_row(legacy_values, QUEUE_COLUMNS)

    assert len(legacy_values) == len(LEGACY_QUEUE_COLUMNS)
    assert row.status == "approved"
    assert row.research_status == ""
    assert row.x_text == "x text"


def test_humanize_post_for_publish_softens_template_phrases() -> None:
    text = "OpenAIのThe next phase of the Microsoft OpenAI partnership。背景と実務への影響を短く整理しました。"

    result = humanize_post_for_publish(text, "linkedin")

    assert result == "OpenAIのThe next phase of the Microsoft OpenAI partnership。"
    assert "背景と実務への影響を短く整理しました。" not in result


def test_humanize_post_for_publish_keeps_existing_personal_x_copy() -> None:
    text = "ChatGPTのWorkspace Agents、触ってみた正直な感想。Slack連携は便利だけど、初期設定は思ったより重い。"

    result = humanize_post_for_publish(text, "x")

    assert result == text


def test_humanize_post_for_publish_removes_repeated_generic_openers() -> None:
    text = "まず気になったのは、OpenAIのAWS対応でBedrockの選択肢が増えるところ。"

    result = humanize_post_for_publish(text, "x")

    assert result == "OpenAIのAWS対応でBedrockの選択肢が増えるところ。"
    assert not result.startswith("まず気になった")
