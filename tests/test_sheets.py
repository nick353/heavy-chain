from __future__ import annotations

from string import ascii_uppercase

from social_flow.models import (
    ENGAGEMENT_RELATIONSHIP_COLUMNS,
    FEED_READ_LOG_COLUMNS,
    LEARNING_REVIEW_COLUMNS,
    PERFORMANCE_DAILY_COLUMNS,
    QueueRow,
    RUN_SUMMARY_COLUMNS,
    SHEETS_QUEUE_COLUMNS,
)
from social_flow.sheets import SheetsRepository, _sheet_queue_column


def _column_range(count: int) -> str:
    result = ""
    while count > 0:
        count, remainder = divmod(count - 1, 26)
        result = ascii_uppercase[remainder] + result
    return result


class DummyValuesAPI:
    def __init__(self) -> None:
        self.updates: list[dict[str, object]] = []
        self.clears: list[dict[str, object]] = []
        self.appends: list[dict[str, object]] = []
        self.batch_updates: list[dict[str, object]] = []
        self.gets: list[dict[str, object]] = []
        self.get_response: dict[str, object] = {}

    def update(self, *, spreadsheetId: str, range: str, valueInputOption: str, body: dict[str, object]):
        self.updates.append(
            {
                "spreadsheetId": spreadsheetId,
                "range": range,
                "valueInputOption": valueInputOption,
                "body": body,
            }
        )
        return self

    def execute(self) -> dict[str, object]:
        return self.get_response if self.gets else {}

    def get(self, *, spreadsheetId: str, range: str):
        self.gets.append({"spreadsheetId": spreadsheetId, "range": range})
        return self

    def clear(self, *, spreadsheetId: str, range: str, body: dict[str, object]):
        self.clears.append(
            {
                "spreadsheetId": spreadsheetId,
                "range": range,
                "body": body,
            }
        )
        return self

    def append(
        self,
        *,
        spreadsheetId: str,
        range: str,
        valueInputOption: str,
        insertDataOption: str,
        body: dict[str, object],
    ):
        self.appends.append(
            {
                "spreadsheetId": spreadsheetId,
                "range": range,
                "valueInputOption": valueInputOption,
                "insertDataOption": insertDataOption,
                "body": body,
            }
        )
        return self

    def batchUpdate(self, *, spreadsheetId: str, body: dict[str, object]):
        self.batch_updates.append(
            {
                "spreadsheetId": spreadsheetId,
                "body": body,
            }
        )
        return self


class DummySpreadsheetsAPI:
    def __init__(self) -> None:
        self.values_api = DummyValuesAPI()
        self.batch_updates: list[dict[str, object]] = []
        self.sheets: list[dict[str, object]] = []

    def get(self, *, spreadsheetId: str):
        self.spreadsheet_id = spreadsheetId
        return self

    def batchUpdate(self, *, spreadsheetId: str, body: dict[str, object]):
        self.batch_updates.append({"spreadsheetId": spreadsheetId, "body": body})
        return self

    def values(self) -> DummyValuesAPI:
        return self.values_api

    def execute(self) -> dict[str, object]:
        return {"sheets": self.sheets}


class DummyService:
    def __init__(self) -> None:
        self.spreadsheets_api = DummySpreadsheetsAPI()

    def spreadsheets(self) -> DummySpreadsheetsAPI:
        return self.spreadsheets_api


def test_bootstrap_queue_sheet_creates_queue_views_and_run_summary(monkeypatch, tmp_path) -> None:
    service = DummyService()
    credentials_path = tmp_path / "service-account.json"
    credentials_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "social_flow.sheets.Credentials.from_service_account_file",
        lambda filename, scopes: object(),
    )
    monkeypatch.setattr("social_flow.sheets.build", lambda *args, **kwargs: service)

    repo = SheetsRepository(
        service_account_json=str(credentials_path),
        spreadsheet_id="spreadsheet-id",
        tab_name="queue",
    )

    repo.bootstrap_queue_sheet()

    requests = service.spreadsheets_api.batch_updates[0]["body"]["requests"]
    assert requests == [
        {"addSheet": {"properties": {"title": "dashboard"}}},
        {"addSheet": {"properties": {"title": "queue"}}},
        {"addSheet": {"properties": {"title": "publish_today"}}},
        {"addSheet": {"properties": {"title": "engagement_review"}}},
        {"addSheet": {"properties": {"title": "backlog_review"}}},
        {"addSheet": {"properties": {"title": "published_log"}}},
        {"addSheet": {"properties": {"title": "run_summary"}}},
        {"addSheet": {"properties": {"title": "feed_read_log"}}},
        {"addSheet": {"properties": {"title": "learning_review"}}},
        {"addSheet": {"properties": {"title": "performance_daily"}}},
        {"addSheet": {"properties": {"title": "engagement_relationship_map"}}},
    ]
    assert service.spreadsheets_api.values_api.updates[0]["range"] == f"queue!A1:{_column_range(len(SHEETS_QUEUE_COLUMNS))}1"
    assert service.spreadsheets_api.values_api.updates[0]["body"] == {"values": [SHEETS_QUEUE_COLUMNS]}
    assert "media_plan" in SHEETS_QUEUE_COLUMNS
    assert "media_receipt" in SHEETS_QUEUE_COLUMNS
    assert [item["range"] for item in service.spreadsheets_api.values_api.clears] == [
        "dashboard!A:Z",
        "publish_today!A:Z",
        "engagement_review!A:Z",
        "backlog_review!A:Z",
        "published_log!A:Z",
    ]
    assert service.spreadsheets_api.values_api.updates[1]["range"] == "publish_today!A1"
    assert service.spreadsheets_api.values_api.updates[1]["valueInputOption"] == "USER_ENTERED"
    ready_formula = service.spreadsheets_api.values_api.updates[1]["body"]["values"][0][0]
    assert f"queue!{_sheet_queue_column('keep_priority')}2:{_sheet_queue_column('keep_priority')}" in ready_formula
    assert f"queue!{_sheet_queue_column('quality_score')}2:{_sheet_queue_column('quality_score')}" in ready_formula
    assert f'(queue!{_sheet_queue_column("status")}2:{_sheet_queue_column("status")}="partially_published")+' in ready_formula
    assert f"IFERROR(VALUE(queue!{_sheet_queue_column('quality_score')}2:{_sheet_queue_column('quality_score')}),0)>=10" in ready_formula
    assert f'COUNTIF(queue!{_sheet_queue_column("status")}2:{_sheet_queue_column("status")},"partially_published")>0' in ready_formula
    assert f"queue!{_sheet_queue_column('x_published_at')}2:{_sheet_queue_column('x_published_at')}" in ready_formula
    assert f"queue!{_sheet_queue_column('linkedin_published_at')}2:{_sheet_queue_column('linkedin_published_at')}" in ready_formula
    assert f"queue!{_sheet_queue_column('published_at')}2:{_sheet_queue_column('published_at')}" in ready_formula
    assert f"queue!{_sheet_queue_column('freshness_checked_at')}2:{_sheet_queue_column('freshness_checked_at')}" in ready_formula
    assert f"queue!{_sheet_queue_column('x_post_url')}2:{_sheet_queue_column('x_post_url')}" in ready_formula
    assert f"queue!{_sheet_queue_column('linkedin_post_url')}2:{_sheet_queue_column('linkedin_post_url')}" in ready_formula
    assert f'(queue!{_sheet_queue_column("keep_priority")}2:{_sheet_queue_column("keep_priority")}="ship_now")+' in ready_formula
    assert "partially_published" in ready_formula
    assert "ARRAY_CONSTRAIN" in ready_formula
    assert "CHOOSECOLS" in ready_formula
    assert "partially_published\",1" in ready_formula
    assert "),17,TRUE,18,TRUE,3,FALSE,16,TRUE)" in ready_formula
    assert "),3,16)" in ready_formula
    assert "do not repost" in ready_formula
    assert service.spreadsheets_api.values_api.updates[2]["range"] == "dashboard!A1"
    dashboard_formula = service.spreadsheets_api.values_api.updates[2]["body"]["values"][0][0]
    assert "ready_count" in dashboard_formula
    assert "engagement_review" in dashboard_formula
    assert "recent_posts" in dashboard_formula
    assert "publish_today!A2:A" in dashboard_formula
    assert "published_log!A2:A" in dashboard_formula
    assert service.spreadsheets_api.values_api.updates[3]["range"] == "engagement_review!A1"
    engagement_formula = service.spreadsheets_api.values_api.updates[3]["body"]["values"][0][0]
    assert f"queue!{_sheet_queue_column('engagement_status')}2:{_sheet_queue_column('engagement_status')}" in engagement_formula
    assert f"queue!{_sheet_queue_column('comment_draft')}2:{_sheet_queue_column('comment_draft')}" in engagement_formula
    assert f'queue!{_sheet_queue_column("engagement_status")}2:{_sheet_queue_column("engagement_status")}="approved"' in engagement_formula
    assert service.spreadsheets_api.values_api.updates[4]["range"] == "backlog_review!A1"
    backlog_formula = service.spreadsheets_api.values_api.updates[4]["body"]["values"][0][0]
    assert f"queue!{_sheet_queue_column('drop_reason')}2:{_sheet_queue_column('drop_reason')}" in backlog_formula
    assert f"queue!{_sheet_queue_column('publish_strategy')}2:{_sheet_queue_column('publish_strategy')}" in backlog_formula
    assert "hold|drop" in backlog_formula
    assert service.spreadsheets_api.values_api.updates[5]["range"] == "published_log!A1"
    assert service.spreadsheets_api.values_api.updates[5]["valueInputOption"] == "USER_ENTERED"
    published_formula = service.spreadsheets_api.values_api.updates[5]["body"]["values"][0][0]
    assert f"queue!{_sheet_queue_column('published_at')}2:{_sheet_queue_column('published_at')}" in published_formula
    assert f"queue!{_sheet_queue_column('x_post_url')}2:{_sheet_queue_column('x_post_url')}" in published_formula
    assert f"queue!{_sheet_queue_column('linkedin_post_url')}2:{_sheet_queue_column('linkedin_post_url')}" in published_formula
    assert f"queue!{_sheet_queue_column('content_format')}2:{_sheet_queue_column('content_format')}" in published_formula
    assert '="published"' in published_formula
    assert service.spreadsheets_api.values_api.updates[6]["range"] == f"run_summary!A1:{_column_range(len(RUN_SUMMARY_COLUMNS))}1"
    assert service.spreadsheets_api.values_api.updates[6]["body"] == {"values": [RUN_SUMMARY_COLUMNS]}
    assert "feed_research_receipt" in RUN_SUMMARY_COLUMNS
    assert "media_receipt" in RUN_SUMMARY_COLUMNS
    assert "ship_now_buffer_count" in RUN_SUMMARY_COLUMNS
    assert "ship_now_buffer_refreshed_count" in RUN_SUMMARY_COLUMNS
    assert "usable_publish_candidate_count" in RUN_SUMMARY_COLUMNS
    assert service.spreadsheets_api.values_api.updates[7]["range"] == f"feed_read_log!A1:{_column_range(len(FEED_READ_LOG_COLUMNS))}1"
    assert service.spreadsheets_api.values_api.updates[7]["body"] == {"values": [FEED_READ_LOG_COLUMNS]}
    assert service.spreadsheets_api.values_api.updates[8]["range"] == f"learning_review!A1:{_column_range(len(LEARNING_REVIEW_COLUMNS))}1"
    assert service.spreadsheets_api.values_api.updates[8]["body"] == {"values": [LEARNING_REVIEW_COLUMNS]}
    assert service.spreadsheets_api.values_api.updates[9]["range"] == f"performance_daily!A1:{_column_range(len(PERFORMANCE_DAILY_COLUMNS))}1"
    assert service.spreadsheets_api.values_api.updates[9]["body"] == {"values": [PERFORMANCE_DAILY_COLUMNS]}
    assert service.spreadsheets_api.values_api.updates[10]["range"] == f"engagement_relationship_map!A1:{_column_range(len(ENGAGEMENT_RELATIONSHIP_COLUMNS))}1"
    assert service.spreadsheets_api.values_api.updates[10]["body"] == {"values": [ENGAGEMENT_RELATIONSHIP_COLUMNS]}


def test_publish_today_values_requires_quality_score_ten_but_prioritizes_partial(monkeypatch, tmp_path) -> None:
    service = DummyService()
    credentials_path = tmp_path / "service-account.json"
    credentials_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "social_flow.sheets.Credentials.from_service_account_file",
        lambda filename, scopes: object(),
    )
    monkeypatch.setattr("social_flow.sheets.build", lambda *args, **kwargs: service)

    repo = SheetsRepository(
        service_account_json=str(credentials_path),
        spreadsheet_id="spreadsheet-id",
        tab_name="queue",
    )
    low_score = QueueRow(
        id="low",
        status="approved",
        keep_priority="ship_now",
        quality_score="8",
        title="Low score",
        x_text="x",
    )
    high_score = QueueRow(
        id="high",
        status="approved",
        keep_priority="ship_now",
        quality_score="10",
        title="High score",
        x_text="x",
    )
    partial = QueueRow(
        id="partial",
        status="partially_published",
        keep_priority="ship_now",
        quality_score="8",
        title="Partial resume",
        x_post_url="https://x.com/nichika2000823/status/123",
        x_published_at="2026-06-01T23:04:54+00:00",
        linkedin_text="linkedin",
    )
    newer_partial = QueueRow(
        id="newer-partial",
        status="partially_published",
        keep_priority="ship_now",
        quality_score="12",
        title="Newer partial resume",
        x_post_url="https://x.com/nichika2000823/status/456",
        x_published_at="2026-06-01T23:29:35+00:00",
        linkedin_text="linkedin",
    )
    blank_priority_partial = QueueRow(
        id="blank-priority-partial",
        status="partially_published",
        keep_priority="",
        quality_score="7",
        title="Blank priority partial resume",
        x_post_url="https://x.com/nichika2000823/status/789",
        x_published_at="2026-06-01T23:10:35+00:00",
        linkedin_text="linkedin",
    )

    values = repo._publish_today_values([low_score, high_score])

    assert values[0][-1] == "freshness_checked_at"
    assert all(len(row) == 16 for row in values)
    assert [row[0] for row in values[1:]] == ["high"]

    values_with_partial = repo._publish_today_values(
        [low_score, high_score, newer_partial, blank_priority_partial, partial]
    )

    assert [row[0] for row in values_with_partial[1:]] == [
        "partial",
        "blank-priority-partial",
        "newer-partial",
    ]
    assert all(len(row) == 16 for row in values_with_partial)


def test_bootstrap_queue_sheet_hides_deprecated_ready_to_post(monkeypatch, tmp_path) -> None:
    service = DummyService()
    service.spreadsheets_api.sheets = [
        {"properties": {"title": "ready_to_post", "sheetId": 123, "hidden": False}},
    ]
    credentials_path = tmp_path / "service-account.json"
    credentials_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "social_flow.sheets.Credentials.from_service_account_file",
        lambda filename, scopes: object(),
    )
    monkeypatch.setattr("social_flow.sheets.build", lambda *args, **kwargs: service)

    repo = SheetsRepository(
        service_account_json=str(credentials_path),
        spreadsheet_id="spreadsheet-id",
        tab_name="queue",
    )

    repo.bootstrap_queue_sheet()

    requests = service.spreadsheets_api.batch_updates[0]["body"]["requests"]
    assert {
        "updateSheetProperties": {
            "properties": {
                "sheetId": 123,
                "hidden": True,
            },
            "fields": "hidden",
        }
    } in requests


def test_upsert_many_repairs_stale_queue_header_before_writing_urls(monkeypatch, tmp_path) -> None:
    service = DummyService()
    stale_header = [
        "id",
        "status",
        "quality_score",
        "keep_priority",
        "content_format",
        "publish_strategy",
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
    ]
    service.spreadsheets_api.values_api.get_response = {
        "values": [
            stale_header,
            ["item-1", "approved"],
            [
                "item-2",
                "published",
                "",
                "",
                "",
                "",
                "title",
                "angle",
                "x body 2",
                "linkedin body 2",
                "https://x.com/nichika2000823/status/2",
                "https://www.linkedin.com/feed/update/urn:li:activity:2/",
                "",
                "https://example.com/source",
            ],
        ]
    }
    credentials_path = tmp_path / "service-account.json"
    credentials_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "social_flow.sheets.Credentials.from_service_account_file",
        lambda filename, scopes: object(),
    )
    monkeypatch.setattr("social_flow.sheets.build", lambda *args, **kwargs: service)

    repo = SheetsRepository(
        service_account_json=str(credentials_path),
        spreadsheet_id="spreadsheet-id",
        tab_name="queue",
    )
    row = QueueRow(
        id="item-1",
        status="published",
        x_text="x body",
        linkedin_text="linkedin body",
        x_post_url="https://x.com/nichika2000823/status/1",
        linkedin_post_url="https://www.linkedin.com/feed/update/urn:li:activity:1/",
    )

    assert repo.upsert_many([row]) == 1

    header_update = service.spreadsheets_api.values_api.updates[0]
    assert header_update["range"] == f"queue!A1:{_column_range(len(SHEETS_QUEUE_COLUMNS))}1"
    assert header_update["body"] == {"values": [SHEETS_QUEUE_COLUMNS]}

    repaired_existing_rows = service.spreadsheets_api.values_api.updates[1]["body"]["values"]
    assert service.spreadsheets_api.values_api.updates[1]["range"] == (
        f"queue!A2:{_column_range(len(SHEETS_QUEUE_COLUMNS))}3"
    )
    repaired_item_2 = repaired_existing_rows[1]
    assert repaired_item_2[SHEETS_QUEUE_COLUMNS.index("id")] == "item-2"
    assert repaired_item_2[SHEETS_QUEUE_COLUMNS.index("x_text")] == "x body 2"
    assert repaired_item_2[SHEETS_QUEUE_COLUMNS.index("linkedin_text")] == "linkedin body 2"
    assert repaired_item_2[SHEETS_QUEUE_COLUMNS.index("x_post_url")] == "https://x.com/nichika2000823/status/2"
    assert (
        repaired_item_2[SHEETS_QUEUE_COLUMNS.index("linkedin_post_url")]
        == "https://www.linkedin.com/feed/update/urn:li:activity:2/"
    )

    updated_row = service.spreadsheets_api.values_api.batch_updates[0]["body"]["data"][0]["values"][0]
    assert updated_row[SHEETS_QUEUE_COLUMNS.index("x_text")] == "x body"
    assert updated_row[SHEETS_QUEUE_COLUMNS.index("linkedin_text")] == "linkedin body"
    assert updated_row[SHEETS_QUEUE_COLUMNS.index("x_post_url")] == "https://x.com/nichika2000823/status/1"
    assert (
        updated_row[SHEETS_QUEUE_COLUMNS.index("linkedin_post_url")]
        == "https://www.linkedin.com/feed/update/urn:li:activity:1/"
    )


def test_append_run_summary_repairs_stale_header_before_append(monkeypatch, tmp_path) -> None:
    service = DummyService()
    service.spreadsheets_api.values_api.get_response = {
        "values": [
            ["run_at", "researched_count", "refreshed_count", "posted_count", "media_receipt"],
            ["old-now", "1", "2", "3", "old receipt"],
        ]
    }
    credentials_path = tmp_path / "service-account.json"
    credentials_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "social_flow.sheets.Credentials.from_service_account_file",
        lambda filename, scopes: object(),
    )
    monkeypatch.setattr("social_flow.sheets.build", lambda *args, **kwargs: service)

    repo = SheetsRepository(
        service_account_json=str(credentials_path),
        spreadsheet_id="spreadsheet-id",
        tab_name="queue",
    )

    repo.append_run_summary(
        run_at="now",
        researched_count=1,
        refreshed_count=2,
        posted_count=3,
        media_receipt="receipt",
        sheets_synced_count=4,
        stop_reason="",
        usable_publish_candidate_count=5,
    )

    header_update = service.spreadsheets_api.values_api.updates[0]
    assert header_update["range"] == f"run_summary!A1:{_column_range(len(RUN_SUMMARY_COLUMNS))}1"
    assert header_update["body"] == {"values": [RUN_SUMMARY_COLUMNS]}
    repaired_update = service.spreadsheets_api.values_api.updates[1]
    assert repaired_update["range"] == f"run_summary!A2:{_column_range(len(RUN_SUMMARY_COLUMNS))}2"
    repaired_row = repaired_update["body"]["values"][0]
    assert repaired_row[RUN_SUMMARY_COLUMNS.index("run_at")] == "old-now"
    assert repaired_row[RUN_SUMMARY_COLUMNS.index("refreshed_count")] == "2"
    assert repaired_row[RUN_SUMMARY_COLUMNS.index("posted_count")] == "3"
    assert repaired_row[RUN_SUMMARY_COLUMNS.index("media_receipt")] == "old receipt"
    assert repaired_row[RUN_SUMMARY_COLUMNS.index("usable_publish_candidate_count")] == ""
    appended = service.spreadsheets_api.values_api.appends[0]
    assert appended["range"] == f"run_summary!A:{_column_range(len(RUN_SUMMARY_COLUMNS))}"
    assert appended["body"]["values"][0][RUN_SUMMARY_COLUMNS.index("media_receipt")] == "receipt"
    assert appended["body"]["values"][0][RUN_SUMMARY_COLUMNS.index("usable_publish_candidate_count")] == "5"


def test_append_feed_read_log_learning_review_and_relationship_map(monkeypatch, tmp_path) -> None:
    service = DummyService()
    credentials_path = tmp_path / "service-account.json"
    credentials_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "social_flow.sheets.Credentials.from_service_account_file",
        lambda filename, scopes: object(),
    )
    monkeypatch.setattr("social_flow.sheets.build", lambda *args, **kwargs: service)

    repo = SheetsRepository(
        service_account_json=str(credentials_path),
        spreadsheet_id="spreadsheet-id",
        tab_name="queue",
    )

    repo.append_feed_read_log([["now", "item-1", "x", "https://x.com/a/status/1", "A", "topic", "evidence", "comment_candidate", "true"]])
    repo.append_learning_review([["now", "content_format", "official_demo_breakdown", "2", "100", "5", "0.0500", "top_row=item-1"]])
    repo.upsert_relationship_map(
        [
            [
                "now",
                "x",
                "@example",
                "",
                "candidate",
                "now",
                "",
                "comment_candidate",
                "topic",
                "3",
                "high",
                "1",
                "evidence",
                "item-1",
                "https://x.com/example/status/1",
                "Send approved engagement.",
                "notes",
            ]
        ]
    )

    assert service.spreadsheets_api.values_api.appends[0]["range"] == f"feed_read_log!A:{_column_range(len(FEED_READ_LOG_COLUMNS))}"
    assert service.spreadsheets_api.values_api.appends[0]["body"]["values"][0][1] == "item-1"
    assert service.spreadsheets_api.values_api.appends[1]["range"] == f"learning_review!A:{_column_range(len(LEARNING_REVIEW_COLUMNS))}"
    assert service.spreadsheets_api.values_api.appends[1]["body"]["values"][0][2] == "official_demo_breakdown"
    assert service.spreadsheets_api.values_api.updates[0]["range"] == f"engagement_relationship_map!A1:{_column_range(len(ENGAGEMENT_RELATIONSHIP_COLUMNS))}1"
    assert service.spreadsheets_api.values_api.appends[2]["range"] == f"engagement_relationship_map!A:{_column_range(len(ENGAGEMENT_RELATIONSHIP_COLUMNS))}"
    assert service.spreadsheets_api.values_api.appends[2]["body"]["values"][0][2] == "@example"


def test_upsert_relationship_map_merges_duplicate_batch_rows(monkeypatch, tmp_path) -> None:
    service = DummyService()
    credentials_path = tmp_path / "service-account.json"
    credentials_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "social_flow.sheets.Credentials.from_service_account_file",
        lambda filename, scopes: object(),
    )
    monkeypatch.setattr("social_flow.sheets.build", lambda *args, **kwargs: service)

    repo = SheetsRepository(
        service_account_json=str(credentials_path),
        spreadsheet_id="spreadsheet-id",
        tab_name="queue",
    )
    row_base = [
        "now",
        "x",
        "@example",
        "",
        "read",
        "now",
        "",
        "",
        "agents",
        "3",
        "low",
        "1",
        "first evidence",
        "item-1",
        "https://x.com/example/status/1",
        "Watch for a more specific future reply opportunity.",
        "notes",
    ]
    row_second = row_base[:]
    row_second[12] = "second evidence"
    row_second[13] = "item-2"
    row_second[14] = "https://x.com/example/status/2"

    repo.upsert_relationship_map([row_base, row_second])

    appended = service.spreadsheets_api.values_api.appends[0]["body"]["values"]
    assert len(appended) == 1
    assert appended[0][11] == "2"
    assert appended[0][13] == "item-1 | item-2"
    assert appended[0][14] == "https://x.com/example/status/1 | https://x.com/example/status/2"


def test_upsert_relationship_map_does_not_double_count_existing_source_url(monkeypatch, tmp_path) -> None:
    service = DummyService()
    service.spreadsheets_api.values_api.get_response = {
        "values": [
            ENGAGEMENT_RELATIONSHIP_COLUMNS,
            [
                "old",
                "x",
                "@example",
                "",
                "read",
                "old",
                "",
                "",
                "agents",
                "3",
                "low",
                "1",
                "old evidence",
                "item-1",
                "https://x.com/example/status/1",
                "Watch.",
                "old notes",
            ],
        ]
    }
    credentials_path = tmp_path / "service-account.json"
    credentials_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "social_flow.sheets.Credentials.from_service_account_file",
        lambda filename, scopes: object(),
    )
    monkeypatch.setattr("social_flow.sheets.build", lambda *args, **kwargs: service)

    repo = SheetsRepository(
        service_account_json=str(credentials_path),
        spreadsheet_id="spreadsheet-id",
        tab_name="queue",
    )

    repo.upsert_relationship_map(
        [
            [
                "now",
                "x",
                "@example",
                "",
                "read",
                "now",
                "",
                "",
                "agents",
                "3",
                "low",
                "1",
                "same evidence",
                "item-1",
                "https://x.com/example/status/1",
                "Watch.",
                "new notes",
            ]
        ]
    )

    updated = service.spreadsheets_api.values_api.batch_updates[0]["body"]["data"][0]["values"][0]
    assert updated[11] == "1"
    assert updated[14] == "https://x.com/example/status/1"
