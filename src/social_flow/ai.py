from __future__ import annotations

import json
import re

from openai import OpenAI

from social_flow.models import QueueRow


SYSTEM_PROMPT = """You are a Japanese social media editor.
Return valid JSON only.
Write natural Japanese.
Keep facts faithful to the source.
Use available social research notes to choose a timely angle for the post.
Write like an individual creator account, not a corporate press release.
Avoid stiff or overly formal wording.
Treat post formats as loose editorial lenses, not templates. Do not force a fixed section order or reusable sentence skeleton.
For X, make the first line stop the scroll with a concrete noun, number, or product name before explanation.
For LinkedIn, write in English and sound like a person sharing what changed in practice, what stood out, and what they would watch next.
Do not open LinkedIn with generic safety phrases such as "One practical way to read this update..." or "One thing I noticed..." unless the rest of the sentence is unmistakably source-specific.
Do not use markdown bold.
Create concise copy for X and a personal but professional copy for LinkedIn.
Avoid generic AI-sounding summary phrases such as "話題です", "注目されています", "〜をまとめました", or "以下がポイントです" unless the source itself requires that wording.
Prefer observation-first writing over headline-first writing.
Include a small amount of honest uncertainty or nuance when the fact pattern is still evolving.
Vary the opening logic across posts. Do not rely on stock openings, even if they sound natural, unless they are genuinely the most natural wording for this specific post.
Never treat examples of natural voice as reusable hooks. Derive the first sentence from the source-specific detail, work scene, tension, number, or unanswered question.
If the copy could be moved to another AI news item without changing much, rewrite it around the specific work scene, source detail, or tension that only this item has.
"""


def humanize_post_for_publish(text: str, platform: str) -> str:
    normalized = text.strip()
    if not normalized:
        return normalized

    replacements = [
        (r"^要点は日本語で", ""),
        (r"^(.+?)。要点は日本語で", r"\1。"),
        (r"背景と実務への影響を短く整理しました。?", ""),
        (r"以下がポイントです。?", ""),
        (r"注目されています。?", ""),
        (r"話題です。?", ""),
        (r"^まず気になったのは[、,]?\s*", ""),
        (r"^最初に気になったのは[、,]?\s*", ""),
        (r"^実務目線だとここが気になりました。?\s*", ""),
    ]
    for pattern, repl in replacements:
        normalized = re.sub(pattern, repl, normalized)

    normalized = re.sub(r"^(まず気になったのは[、,]?\s*)+", "", normalized)
    normalized = re.sub(r"^(最初に気になったのは[、,]?\s*)+", "", normalized)
    normalized = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", normalized)
    normalized = re.sub(r"。{2,}", "。", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()
    return normalized


def build_generation_prompt(row: QueueRow) -> str:
    research_status = row.research_status.strip() or "not_started"
    freshness_checked_at = row.freshness_checked_at.strip() or "not_checked"
    angle = row.angle.strip() or "(not set)"
    x_research_notes = row.x_research_notes.strip() or "(none)"
    linkedin_research_notes = row.linkedin_research_notes.strip() or "(none)"
    past_post_reference = row.past_post_reference.strip() or "(none)"
    reference_post_urls = row.reference_post_urls.strip() or "(none)"
    reference_account_handles = row.reference_account_handles.strip() or "(none)"
    reference_media_urls = row.reference_media_urls.strip() or "(none)"
    reference_media_notes = row.reference_media_notes.strip() or "(none)"
    media_plan = row.media_plan.strip() or "(not set)"
    content_format = row.content_format.strip() or "(not set)"
    publish_strategy = row.publish_strategy.strip() or "(not set)"
    return f"""
Source title:
{row.title}

Source URL:
{row.source_url}

Source summary:
{row.summary_en}

Research status:
{research_status}

Freshness checked at:
{freshness_checked_at}

Preferred angle:
{angle}

X research notes:
{x_research_notes}

LinkedIn research notes:
{linkedin_research_notes}

Past post reference:
{past_post_reference}

Reference post URLs:
{reference_post_urls}

Reference account handles:
{reference_account_handles}

Reference media URLs:
{reference_media_urls}

Reference media notes:
{reference_media_notes}

Current media plan:
{media_plan}

Content format editorial lens:
{content_format}

Publish strategy:
{publish_strategy}

Please produce JSON with this schema:
{{
  "summary_ja": "200 characters or less",
  "angle": "One short Japanese sentence describing the recommended sharing angle",
  "x_text": "X post in Japanese, under 280 characters. Do not default to text + URL; assume quote cards, source cards, or self-made media are attached separately when the surface plan calls for them. If X本文+URL型 is explicitly chosen, include the source URL naturally.",
  "linkedin_text": "LinkedIn post in English, personal creator tone, practical and readable. Do not make this a translation of the X post, and do not rely on a bare URL as the visual surface; URL-based LinkedIn posts must use LinkedInリンクカード型.",
  "media_plan": "One short Japanese sentence that names one of the visible posting surfaces: X引用解釈カード型, X自作判断カード型, LinkedIn正方形1枚画像型, LinkedInカルーセル型, LinkedInリンクカード型, X本文+URL型, or a deliberate no-media exception with a specific reason"
}}

Writing guidance:
- Prefer first-person or direct personal observation when it fits.
- Do not sound like a company announcement.
- Keep the energy of a smart individual account that shares useful AI updates daily.
- Each post should focus on one main point, not a full news recap.
- Start from the source-specific observation, concrete work scene, tension, number, or unanswered question before explaining the news.
- Use at least one concrete noun, number, or product name from the source.
- Do not reuse the same opening pattern across posts. Avoid defaulting to familiar natural-sounding hooks just because they worked before.
- Avoid generic LinkedIn openers such as "One practical way to read this update..." or "One thing I noticed..." when they could fit many AI announcements. Start with the source-specific noun, number, integration, workflow friction, or concrete buyer/user scene instead.
- Do not reuse old x_text or linkedin_text verbatim. Treat prior copy as reference only and write a fresh source-specific body for the selected row.
- Use content format, publish strategy, and media plan as a visible posting-surface contract and editorial direction, not a formula. Avoid forced section order when the source calls for a different shape.
    - Avoid making every preview look like the same text-only composer. Choose and name one user-facing surface: X引用解釈カード型 (native X quote from the source post's repost menu plus a generated Japanese interpretation card), X自作判断カード型 (self-made card with no quote, using a generated Japanese decision/judgment card), LinkedIn正方形1枚画像型 (one square generated English explanatory image), LinkedInカルーセル型 (LinkedIn carousel / square carousel with 3 square generated English slides), LinkedInリンクカード型 (official source URL preview/link card visible), or X本文+URL型 (plain X copy plus the original source URL).
    - X本文+URL型 is allowed only when a simple source URL is the clearest surface for that item. It is not the default and must not be used to avoid making a needed card, quote, or carousel. LinkedIn URL posts should use LinkedInリンクカード型, not a separate text+URL surface.
    - If the chosen surface is a quote, write X as commentary above the quoted post, require the source post URL in reference_post_urls, and use the native repost menu's Quote / 引用する composer rather than a plain URL composer. If the chosen surface is a card or carousel, make the text add context instead of repeating the visual.
- For X, strong source posts should usually become quote_repost_commentary via the reference post URL. For media-required formats, use only self-made media or clearly permitted media; do not re-upload third-party images or videos.
    - For LinkedIn, choose the visible surface per source rather than fixing one default. Use LinkedInリンクカード型 when the official source preview/link card is the strongest surface and can be mechanically verified in the composer. If the URL preview is unstable, disappears, or cannot be verified, LinkedIn正方形1枚画像型 is an allowed fallback: one source-specific square image that explains the point at a glance, with the official source URL still included in the body. This square format is a fallback option, not a forced default. Use LinkedInカルーセル型 only when the idea truly needs a sequence, comparison, checklist, or before/after flow; carousel slides should also stay square. LinkedIn image/carousel surfaces must be uploaded through the feed Photo/写真 div[role=button] route, not through shareActive=true or Start a post as the media upload entry. Self-made image/card/carousel media should be newly generated for the current row with Runway MCP `gpt-image-2`, saved as artifacts/generated-media/YYYY-MM-DD-<queue_id>-...png, recorded with `provider=runway_mcp`, and referenced in the media notes before publishing. No-media LinkedIn posts are allowed only when the media plan explicitly names a no-media surface with a reason; do not let a media-required plan degrade into plain text.
- Generated media must be production media for the actual source, not a demo, placeholder, or operation-verification card, and not a generic white-background text card. When the source is a layout or placement workflow, the prompt must preserve the saved placed state rather than redrawing a floating product mockup: ask for the already positioned design to remain at the intended location, with the surrounding canvas reduced or removed, transparent or backgroundless if the surface calls for it, and no alternate comparison composition. The image prompt should ask for a high-impact square visual with a source-specific visual metaphor, one mobile-legible headline, at most 2-3 short supporting elements, strong spacing, and a crop-safe centered composition for LinkedIn previews. The media notes should include the source-specific visual prompt, model name, size, saved path, and whether the preview looked high-impact rather than cropped, generic, or layout-breaking.
- Before finalizing, do an anti-template pass: remove generic or repeated openings, replace abstract benefit language with a concrete work scene, and make sure the first sentence could not fit any other AI news item.
- If research notes suggest a strong community reaction, reflect that in your angle without copying the crowd's wording.
- On X, make the first line hooky and easy to repost by leading with a concrete number, product name, or surprising practical change before explanation.
- On X, short fragments and line breaks are fine if they make the first point clearer, but keep it human and avoid spammy hype.
- On LinkedIn, open with a concrete observation, workflow change, or number that stood out, then explain why it matters in real work.
- On LinkedIn, use short paragraphs of one or two sentences. End with one light nuance, hesitation, or watchpoint instead of wrapping everything up like a summary article.
- Leave a little texture in the voice. A short reaction, hesitation, or practical caveat is welcome if it fits the facts.
"""


def generate_localized_copy(client: OpenAI, model: str, row: QueueRow) -> dict[str, str]:
    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_generation_prompt(row)},
        ],
        text={"format": {"type": "json_object"}},
        max_output_tokens=1200,
    )
    raw_text = response.output_text or ""
    if raw_text.strip().startswith("```"):
        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text.strip(), flags=re.IGNORECASE)
        raw_text = re.sub(r"\s*```$", "", raw_text, flags=re.IGNORECASE)
    return json.loads(raw_text)
