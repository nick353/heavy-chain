from social_flow.models import QueueRow
from social_flow.utils import extract_linkedin_post_id, extract_x_post_id, make_item_id


def test_make_item_id_is_stable() -> None:
    assert make_item_id("https://example.com/post") == make_item_id("https://example.com/post")
    assert len(make_item_id("https://example.com/post")) == 12


def test_extract_x_post_id_from_status_url() -> None:
    assert extract_x_post_id("https://x.com/nichika2000823/status/2052886630349095049") == "2052886630349095049"


def test_extract_linkedin_post_id_decodes_url_segment() -> None:
    assert (
        extract_linkedin_post_id(
            "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7341234567890123456/"
        )
        == "urn:li:share:7341234567890123456"
    )


def test_queue_row_from_sheet_row_supports_current_posting_queue_header() -> None:
    header = [
        "id",
        "source_type",
        "source_name",
        "source_url",
        "title",
        "summary_en",
        "summary_ja",
        "research_status",
        "freshness_checked_at",
        "angle",
        "x_research_notes",
        "linkedin_research_notes",
        "past_post_reference",
        "reference_post_urls",
        "reference_account_handles",
        "reference_media_urls",
        "reference_media_notes",
        "media_plan",
        "quality_score",
        "source_priority_score",
        "specificity_score",
        "discussion_score",
        "quality_notes",
        "status",
        "collected_at",
        "drafted_at",
        "approved_at",
        "scheduled_at",
        "published_at",
        "performance_synced_at",
        "x_text",
        "linkedin_text",
        "x_post_id",
        "x_post_url",
        "x_published_at",
        "x_like_count",
        "x_reply_count",
        "x_repost_count",
        "x_quote_count",
        "x_impression_count",
        "linkedin_post_id",
        "linkedin_post_url",
        "linkedin_published_at",
        "linkedin_impression_count",
        "linkedin_reaction_count",
        "linkedin_comment_count",
        "linkedin_reshare_count",
        "error",
    ]
    values = [""] * len(header)
    values[0] = "item-1"
    values[10] = "x notes"
    values[11] = "li notes"
    values[18] = "12"
    values[30] = "x body"
    values[31] = "li body"
    values[33] = "https://x.com/example/status/1"
    values[41] = "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A1/"

    row = QueueRow.from_sheet_row(values, header)

    assert row.id == "item-1"
    assert row.x_research_notes == "x notes"
    assert row.linkedin_research_notes == "li notes"
    assert row.quality_score == "12"
    assert row.x_text == "x body"
    assert row.linkedin_text == "li body"
    assert row.x_post_url == "https://x.com/example/status/1"
    assert row.linkedin_post_url == "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A1/"
