from __future__ import annotations

from dataclasses import asdict, dataclass


LEGACY_QUEUE_COLUMNS = [
    "id",
    "source_type",
    "source_name",
    "source_url",
    "title",
    "summary_en",
    "summary_ja",
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


RESEARCH_QUEUE_COLUMNS = [
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


QUEUE_COLUMNS = [
    "id",
    "status",
    "error",
    "drive_file_id",
    "drive_file_name",
    "drive_folder_id",
    "drive_web_url",
    "drive_download_url",
    "mime_type",
    "duration_sec",
    "video_width",
    "video_height",
    "video_fps",
    "file_size_bytes",
    "thumbnail_url",
    "source_type",
    "source_name",
    "source_url",
    "title",
    "summary_en",
    "summary_ja",
    "angle",
    "gemini_analysis_status",
    "gemini_model",
    "gemini_analyzed_at",
    "content_summary",
    "hook_candidates",
    "key_points",
    "cta_suggestion",
    "sensitive_content_notes",
    "recommended_platforms",
    "hashtag_candidates",
    "thumbnail_text_idea",
    "research_status",
    "freshness_checked_at",
    "research_notes",
    "x_research_notes",
    "linkedin_research_notes",
    "past_post_reference",
    "reference_post_urls",
    "reference_account_handles",
    "reference_media_urls",
    "reference_media_notes",
    "media_receipt",
    "media_plan",
    "engagement_targets",
    "engagement_action",
    "engagement_reason",
    "comment_draft",
    "engagement_status",
    "engaged_at",
    "content_format",
    "publish_strategy",
    "trend_window",
    "drop_reason",
    "keep_priority",
    "quality_score",
    "source_priority_score",
    "specificity_score",
    "discussion_score",
    "quality_notes",
    "review_status",
    "review_notes",
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
    "tiktok_enabled",
    "tiktok_caption",
    "tiktok_hashtags",
    "tiktok_privacy",
    "tiktok_post_status",
    "tiktok_post_id",
    "tiktok_post_url",
    "tiktok_published_at",
    "tiktok_view_count",
    "tiktok_like_count",
    "tiktok_comment_count",
    "tiktok_share_count",
    "tiktok_save_count",
    "instagram_enabled",
    "instagram_caption",
    "instagram_hashtags",
    "instagram_collab_account",
    "instagram_post_status",
    "instagram_post_id",
    "instagram_post_url",
    "instagram_published_at",
    "instagram_view_count",
    "instagram_like_count",
    "instagram_comment_count",
    "instagram_share_count",
    "instagram_save_count",
    "instagram_reach_count",
    "youtube_shorts_enabled",
    "youtube_title",
    "youtube_description",
    "youtube_hashtags",
    "youtube_visibility",
    "youtube_post_status",
    "youtube_video_id",
    "youtube_video_url",
    "youtube_published_at",
    "youtube_view_count",
    "youtube_like_count",
    "youtube_comment_count",
    "youtube_share_count",
    "youtube_subscriber_gain",
    "facebook_reels_enabled",
    "facebook_caption",
    "facebook_hashtags",
    "facebook_page_id",
    "facebook_post_status",
    "facebook_post_id",
    "facebook_post_url",
    "facebook_published_at",
    "facebook_view_count",
    "facebook_like_count",
    "facebook_comment_count",
    "facebook_share_count",
    "facebook_reach_count",
    "best_platform",
    "best_hook",
    "best_caption_variant",
    "next_action",
    "owner",
]


SHEETS_QUEUE_COLUMNS = [
    "id",
    "status",
    "quality_score",
    "keep_priority",
    "content_format",
    "publish_strategy",
    "media_plan",
    "media_receipt",
    "title",
    "angle",
    "x_text",
    "linkedin_text",
    "x_post_url",
    "linkedin_post_url",
    "drop_reason",
    "source_url",
    "source_name",
    "x_research_notes",
    "linkedin_research_notes",
    "error",
    "engagement_action",
    "engagement_status",
    "engagement_reason",
    "comment_draft",
    "engagement_targets",
    "review_status",
    "review_notes",
    "next_action",
    "freshness_checked_at",
    "collected_at",
    "drafted_at",
    "approved_at",
    "scheduled_at",
    "published_at",
    "x_published_at",
    "linkedin_published_at",
]


RUN_SUMMARY_COLUMNS = [
    "run_at",
    "researched_count",
    "feed_study_count",
    "external_posts_read",
    "feed_research_receipt",
    "refreshed_count",
    "selected_count",
    "posted_count",
    "quoted_count",
    "engagement_candidates_created",
    "external_engagement_candidates",
    "own_post_engagement_candidates",
    "media_receipt",
    "sheets_synced_count",
    "stop_reason",
    "ship_now_buffer_count",
    "ship_now_buffer_refreshed_count",
    "usable_publish_candidate_count",
]


FEED_READ_LOG_COLUMNS = [
    "recorded_at",
    "queue_id",
    "platform",
    "url",
    "author",
    "topic",
    "evidence",
    "engagement_action",
    "candidate_created",
]


LEARNING_REVIEW_COLUMNS = [
    "generated_at",
    "signal_type",
    "key",
    "rows",
    "impressions",
    "engagements",
    "engagement_rate",
    "notes",
]


ENGAGEMENT_RELATIONSHIP_COLUMNS = [
    "updated_at",
    "platform",
    "handle",
    "profile_url",
    "relationship_stage",
    "last_seen_at",
    "last_engaged_at",
    "last_action",
    "topic_tags",
    "affinity_score",
    "reply_priority",
    "evidence_count",
    "last_evidence",
    "source_queue_ids",
    "source_post_urls",
    "next_action",
    "notes",
]


PERFORMANCE_DAILY_COLUMNS = [
    "snapshot_date",
    "content_id",
    "platform",
    "post_id",
    "post_url",
    "published_at",
    "days_since_publish",
    "views",
    "likes",
    "comments",
    "shares",
    "saves",
    "reach",
    "impressions",
    "engagement_rate",
    "watch_time_sec",
    "avg_watch_time_sec",
    "completion_rate",
    "subscriber_gain",
    "synced_at",
    "sync_status",
    "sync_error",
]


@dataclass
class QueueRow:
    id: str = ""
    status: str = ""
    error: str = ""
    drive_file_id: str = ""
    drive_file_name: str = ""
    drive_folder_id: str = ""
    drive_web_url: str = ""
    drive_download_url: str = ""
    mime_type: str = ""
    duration_sec: str = ""
    video_width: str = ""
    video_height: str = ""
    video_fps: str = ""
    file_size_bytes: str = ""
    thumbnail_url: str = ""
    source_type: str = ""
    source_name: str = ""
    source_url: str = ""
    title: str = ""
    summary_en: str = ""
    summary_ja: str = ""
    angle: str = ""
    gemini_analysis_status: str = ""
    gemini_model: str = ""
    gemini_analyzed_at: str = ""
    content_summary: str = ""
    hook_candidates: str = ""
    key_points: str = ""
    cta_suggestion: str = ""
    sensitive_content_notes: str = ""
    recommended_platforms: str = ""
    hashtag_candidates: str = ""
    thumbnail_text_idea: str = ""
    research_status: str = ""
    freshness_checked_at: str = ""
    research_notes: str = ""
    x_research_notes: str = ""
    linkedin_research_notes: str = ""
    past_post_reference: str = ""
    reference_post_urls: str = ""
    reference_account_handles: str = ""
    reference_media_urls: str = ""
    reference_media_notes: str = ""
    media_receipt: str = ""
    media_plan: str = ""
    engagement_targets: str = ""
    engagement_action: str = ""
    engagement_reason: str = ""
    comment_draft: str = ""
    engagement_status: str = ""
    engaged_at: str = ""
    content_format: str = ""
    publish_strategy: str = ""
    trend_window: str = ""
    drop_reason: str = ""
    keep_priority: str = ""
    quality_score: str = ""
    source_priority_score: str = ""
    specificity_score: str = ""
    discussion_score: str = ""
    quality_notes: str = ""
    review_status: str = ""
    review_notes: str = ""
    collected_at: str = ""
    drafted_at: str = ""
    approved_at: str = ""
    scheduled_at: str = ""
    published_at: str = ""
    performance_synced_at: str = ""
    x_text: str = ""
    linkedin_text: str = ""
    x_post_id: str = ""
    x_post_url: str = ""
    x_published_at: str = ""
    x_like_count: str = ""
    x_reply_count: str = ""
    x_repost_count: str = ""
    x_quote_count: str = ""
    x_impression_count: str = ""
    linkedin_post_id: str = ""
    linkedin_post_url: str = ""
    linkedin_published_at: str = ""
    linkedin_impression_count: str = ""
    linkedin_reaction_count: str = ""
    linkedin_comment_count: str = ""
    linkedin_reshare_count: str = ""
    tiktok_enabled: str = ""
    tiktok_caption: str = ""
    tiktok_hashtags: str = ""
    tiktok_privacy: str = ""
    tiktok_post_status: str = ""
    tiktok_post_id: str = ""
    tiktok_post_url: str = ""
    tiktok_published_at: str = ""
    tiktok_view_count: str = ""
    tiktok_like_count: str = ""
    tiktok_comment_count: str = ""
    tiktok_share_count: str = ""
    tiktok_save_count: str = ""
    instagram_enabled: str = ""
    instagram_caption: str = ""
    instagram_hashtags: str = ""
    instagram_collab_account: str = ""
    instagram_post_status: str = ""
    instagram_post_id: str = ""
    instagram_post_url: str = ""
    instagram_published_at: str = ""
    instagram_view_count: str = ""
    instagram_like_count: str = ""
    instagram_comment_count: str = ""
    instagram_share_count: str = ""
    instagram_save_count: str = ""
    instagram_reach_count: str = ""
    youtube_shorts_enabled: str = ""
    youtube_title: str = ""
    youtube_description: str = ""
    youtube_hashtags: str = ""
    youtube_visibility: str = ""
    youtube_post_status: str = ""
    youtube_video_id: str = ""
    youtube_video_url: str = ""
    youtube_published_at: str = ""
    youtube_view_count: str = ""
    youtube_like_count: str = ""
    youtube_comment_count: str = ""
    youtube_share_count: str = ""
    youtube_subscriber_gain: str = ""
    facebook_reels_enabled: str = ""
    facebook_caption: str = ""
    facebook_hashtags: str = ""
    facebook_page_id: str = ""
    facebook_post_status: str = ""
    facebook_post_id: str = ""
    facebook_post_url: str = ""
    facebook_published_at: str = ""
    facebook_view_count: str = ""
    facebook_like_count: str = ""
    facebook_comment_count: str = ""
    facebook_share_count: str = ""
    facebook_reach_count: str = ""
    best_platform: str = ""
    best_hook: str = ""
    best_caption_variant: str = ""
    next_action: str = ""
    owner: str = ""

    def as_row(self) -> list[str]:
        data = asdict(self)
        return [str(data.get(column, "")) for column in QUEUE_COLUMNS]

    def as_row_for_columns(self, columns: list[str]) -> list[str]:
        data = asdict(self)
        return [str(data.get(column, "")) for column in columns]

    @classmethod
    def from_sheet_row(cls, values: list[str], header: list[str]) -> "QueueRow":
        # Support old rows that were written before research columns existed.
        if len(values) == len(LEGACY_QUEUE_COLUMNS) and len(header) == len(QUEUE_COLUMNS):
            mapping = dict(zip(LEGACY_QUEUE_COLUMNS, values))
        elif len(values) == len(RESEARCH_QUEUE_COLUMNS) and len(header) == len(QUEUE_COLUMNS):
            mapping = dict(zip(RESEARCH_QUEUE_COLUMNS, values))
        else:
            mapping = dict(zip(header, values))
        return cls(**{column: mapping.get(column, "") for column in QUEUE_COLUMNS})
