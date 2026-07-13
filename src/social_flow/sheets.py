from __future__ import annotations

from pathlib import Path
import re
from string import ascii_uppercase

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

from social_flow.models import (
    ENGAGEMENT_RELATIONSHIP_COLUMNS,
    FEED_READ_LOG_COLUMNS,
    LEARNING_REVIEW_COLUMNS,
    PERFORMANCE_DAILY_COLUMNS,
    QUEUE_COLUMNS,
    RUN_SUMMARY_COLUMNS,
    SHEETS_QUEUE_COLUMNS,
    QueueRow,
)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _column_letter(count: int) -> str:
    result = ""
    while count > 0:
        count, remainder = divmod(count - 1, 26)
        result = ascii_uppercase[remainder] + result
    return result


def _column_range(columns: list[str]) -> str:
    return _column_letter(len(columns))


def _reorder_sheet_rows(
    rows: list[list[str]],
    *,
    source_columns: list[str],
    target_columns: list[str],
) -> list[list[str]]:
    reordered: list[list[str]] = []
    for row in rows:
        values_by_column = {
            column: row[index] if index < len(row) else ""
            for index, column in enumerate(source_columns)
            if column
        }
        reordered.append([values_by_column.get(column, "") for column in target_columns])
    return reordered


def _queue_column(column_name: str) -> str:
    return _column_letter(QUEUE_COLUMNS.index(column_name) + 1)


def _sheet_queue_column(column_name: str) -> str:
    return _column_letter(SHEETS_QUEUE_COLUMNS.index(column_name) + 1)


def _merge_unique_parts(existing: str, incoming: str) -> str:
    return " | ".join(_unique_parts(existing, incoming))


def _unique_parts(*values: str) -> list[str]:
    parts: list[str] = []
    seen: set[str] = set()
    for value in values:
        for part in re.split(r"[\n|]+", value):
            normalized = part.strip()
            if normalized and normalized.lower() not in seen:
                parts.append(normalized)
                seen.add(normalized.lower())
    return parts


def _safe_int_value(value: str) -> int:
    try:
        return int(value or "0")
    except ValueError:
        return 0


def create_spreadsheet(service_account_json: str, title: str) -> tuple[str, str]:
    credentials = Credentials.from_service_account_file(
        filename=Path(service_account_json),
        scopes=SCOPES,
    )
    service = build("sheets", "v4", credentials=credentials)
    response = (
        service.spreadsheets()
        .create(body={"properties": {"title": title}}, fields="spreadsheetId,spreadsheetUrl")
        .execute()
    )
    return response["spreadsheetId"], response["spreadsheetUrl"]


class SheetsRepository:
    DASHBOARD_TAB = "dashboard"
    PUBLISH_TODAY_TAB = "publish_today"
    ENGAGEMENT_REVIEW_TAB = "engagement_review"
    BACKLOG_REVIEW_TAB = "backlog_review"
    PUBLISHED_LOG_TAB = "published_log"
    RUN_SUMMARY_TAB = "run_summary"
    FEED_READ_LOG_TAB = "feed_read_log"
    LEARNING_REVIEW_TAB = "learning_review"
    PERFORMANCE_DAILY_TAB = "performance_daily"
    ENGAGEMENT_RELATIONSHIP_TAB = "engagement_relationship_map"
    DEPRECATED_VIEW_TABS = {"ready_to_post"}

    def __init__(self, service_account_json: str, spreadsheet_id: str, tab_name: str) -> None:
        credentials = Credentials.from_service_account_file(
            filename=Path(service_account_json),
            scopes=SCOPES,
        )
        self._service = build("sheets", "v4", credentials=credentials)
        self._spreadsheet_id = spreadsheet_id
        self._tab_name = tab_name

    @property
    def tab_name(self) -> str:
        return self._tab_name

    def bootstrap_queue_sheet(self) -> None:
        tabs = self._service.spreadsheets().get(spreadsheetId=self._spreadsheet_id).execute()
        existing_properties = {
            sheet["properties"]["title"]: sheet["properties"]
            for sheet in tabs.get("sheets", [])
        }
        existing = set(existing_properties)
        requests: list[dict[str, object]] = []
        if self.DASHBOARD_TAB not in existing:
            requests.append({"addSheet": {"properties": {"title": self.DASHBOARD_TAB}}})
        if self._tab_name not in existing:
            requests.append({"addSheet": {"properties": {"title": self._tab_name}}})
        if self.PUBLISH_TODAY_TAB not in existing:
            requests.append({"addSheet": {"properties": {"title": self.PUBLISH_TODAY_TAB}}})
        if self.ENGAGEMENT_REVIEW_TAB not in existing:
            requests.append({"addSheet": {"properties": {"title": self.ENGAGEMENT_REVIEW_TAB}}})
        if self.BACKLOG_REVIEW_TAB not in existing:
            requests.append({"addSheet": {"properties": {"title": self.BACKLOG_REVIEW_TAB}}})
        if self.PUBLISHED_LOG_TAB not in existing:
            requests.append({"addSheet": {"properties": {"title": self.PUBLISHED_LOG_TAB}}})
        if self.RUN_SUMMARY_TAB not in existing:
            requests.append({"addSheet": {"properties": {"title": self.RUN_SUMMARY_TAB}}})
        if self.FEED_READ_LOG_TAB not in existing:
            requests.append({"addSheet": {"properties": {"title": self.FEED_READ_LOG_TAB}}})
        if self.LEARNING_REVIEW_TAB not in existing:
            requests.append({"addSheet": {"properties": {"title": self.LEARNING_REVIEW_TAB}}})
        if self.PERFORMANCE_DAILY_TAB not in existing:
            requests.append({"addSheet": {"properties": {"title": self.PERFORMANCE_DAILY_TAB}}})
        if self.ENGAGEMENT_RELATIONSHIP_TAB not in existing:
            requests.append({"addSheet": {"properties": {"title": self.ENGAGEMENT_RELATIONSHIP_TAB}}})

        for tab_name in sorted(self.DEPRECATED_VIEW_TABS):
            properties = existing_properties.get(tab_name)
            if properties and not properties.get("hidden"):
                requests.append(
                    {
                        "updateSheetProperties": {
                            "properties": {
                                "sheetId": properties["sheetId"],
                                "hidden": True,
                            },
                            "fields": "hidden",
                        }
                    }
                )

        if requests:
            self._service.spreadsheets().batchUpdate(
                spreadsheetId=self._spreadsheet_id,
                body={"requests": requests},
            ).execute()

        end_column = _column_range(SHEETS_QUEUE_COLUMNS)
        header_range = f"{self._tab_name}!A1:{end_column}1"
        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=header_range,
            valueInputOption="RAW",
            body={"values": [SHEETS_QUEUE_COLUMNS]},
        ).execute()

        for tab_name in [
            self.DASHBOARD_TAB,
            self.PUBLISH_TODAY_TAB,
            self.ENGAGEMENT_REVIEW_TAB,
            self.BACKLOG_REVIEW_TAB,
            self.PUBLISHED_LOG_TAB,
        ]:
            self._service.spreadsheets().values().clear(
                spreadsheetId=self._spreadsheet_id,
                range=f"{tab_name}!A:Z",
                body={},
            ).execute()

        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.PUBLISH_TODAY_TAB}!A1",
            valueInputOption="USER_ENTERED",
            body={"values": [[self._publish_today_formula()]]},
        ).execute()

        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.DASHBOARD_TAB}!A1",
            valueInputOption="USER_ENTERED",
            body={"values": [[self._dashboard_formula()]]},
        ).execute()

        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.ENGAGEMENT_REVIEW_TAB}!A1",
            valueInputOption="USER_ENTERED",
            body={"values": [[self._engagement_review_formula()]]},
        ).execute()

        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.BACKLOG_REVIEW_TAB}!A1",
            valueInputOption="USER_ENTERED",
            body={"values": [[self._backlog_review_formula()]]},
        ).execute()

        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.PUBLISHED_LOG_TAB}!A1",
            valueInputOption="USER_ENTERED",
            body={"values": [[self._published_log_formula()]]},
        ).execute()

        run_summary_end_column = _column_range(RUN_SUMMARY_COLUMNS)
        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.RUN_SUMMARY_TAB}!A1:{run_summary_end_column}1",
            valueInputOption="RAW",
            body={"values": [RUN_SUMMARY_COLUMNS]},
        ).execute()

        feed_log_end_column = _column_range(FEED_READ_LOG_COLUMNS)
        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.FEED_READ_LOG_TAB}!A1:{feed_log_end_column}1",
            valueInputOption="RAW",
            body={"values": [FEED_READ_LOG_COLUMNS]},
        ).execute()

        learning_end_column = _column_range(LEARNING_REVIEW_COLUMNS)
        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.LEARNING_REVIEW_TAB}!A1:{learning_end_column}1",
            valueInputOption="RAW",
            body={"values": [LEARNING_REVIEW_COLUMNS]},
        ).execute()

        performance_end_column = _column_range(PERFORMANCE_DAILY_COLUMNS)
        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.PERFORMANCE_DAILY_TAB}!A1:{performance_end_column}1",
            valueInputOption="RAW",
            body={"values": [PERFORMANCE_DAILY_COLUMNS]},
        ).execute()

        relationship_end_column = _column_range(ENGAGEMENT_RELATIONSHIP_COLUMNS)
        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.ENGAGEMENT_RELATIONSHIP_TAB}!A1:{relationship_end_column}1",
            valueInputOption="RAW",
            body={"values": [ENGAGEMENT_RELATIONSHIP_COLUMNS]},
        ).execute()

    def _dashboard_formula(self) -> str:
        publish = self.PUBLISH_TODAY_TAB
        engagement = self.ENGAGEMENT_REVIEW_TAB
        published = self.PUBLISHED_LOG_TAB
        return (
            '= { '
            '{"section","status","quality_or_time","title","next_step"}; '
            '{"tomorrow","ready_count",COUNTIF('
            f'{publish}!A2:A,"?*"),'
            'IF(COUNTIF('
            f'{publish}!A2:A,"?*")=0,'
            '"No ready posts yet","Open publish_today"),""}; '
            '{"engagement","auto_approved",COUNTIF('
            f'{engagement}!A2:A,"?*"),'
            'IF(COUNTIF('
            f'{engagement}!A2:A,"?*")=0,'
            '"No engagement candidates yet","Open engagement_review"),"Auto-send target X 5 likes/2 comments + LinkedIn 5 likes/1 comment"}; '
            '{"tomorrow","","","",""}; '
            '{"id","status","quality_score","title","next_action"}; '
            'IFERROR(ARRAY_CONSTRAIN(FILTER({'
            f'{publish}!A2:A,{publish}!B2:B,{publish}!C2:C,{publish}!G2:G,{publish}!O2:O'
            f'}},{publish}!A2:A<>""),3,5),{{"","","","",""}}); '
            '{"recent_posts","","","",""}; '
            '{"id","published_at","status","title","urls"}; '
            'IFERROR(ARRAY_CONSTRAIN(FILTER({'
            f'{published}!A2:A,{published}!E2:E,{published}!B2:B,{published}!D2:D,'
            f'{published}!F2:F&" | "&{published}!G2:G'
            f'}},{published}!A2:A<>""),5,5),{{"","","","",""}}) '
            '}'
        )

    def _publish_today_formula(self) -> str:
        tab = self._tab_name
        quality_score = _sheet_queue_column("quality_score")
        keep_priority = _sheet_queue_column("keep_priority")
        status = _sheet_queue_column("status")
        freshness_checked_at = _sheet_queue_column("freshness_checked_at")
        title = _sheet_queue_column("title")
        angle = _sheet_queue_column("angle")
        x_text = _sheet_queue_column("x_text")
        linkedin_text = _sheet_queue_column("linkedin_text")
        x_post_url = _sheet_queue_column("x_post_url")
        linkedin_post_url = _sheet_queue_column("linkedin_post_url")
        published_at = _sheet_queue_column("published_at")
        x_published_at = _sheet_queue_column("x_published_at")
        linkedin_published_at = _sheet_queue_column("linkedin_published_at")
        error = _sheet_queue_column("error")
        next_action = _sheet_queue_column("next_action")
        review_notes = _sheet_queue_column("review_notes")
        content_format = _sheet_queue_column("content_format")
        publish_strategy = _sheet_queue_column("publish_strategy")
        drop_reason = _sheet_queue_column("drop_reason")
        return (
            '= { {"id","status","quality_score","keep_priority","content_format","publish_strategy","title","angle","x_text","linkedin_text",'
            '"x_post_url","linkedin_post_url","drop_reason","error","next_action","freshness_checked_at"}; '
            f'IFERROR(ARRAY_CONSTRAIN(CHOOSECOLS(SORT(FILTER({{{tab}!A2:A,{tab}!{status}2:{status},'
            f'IFERROR(VALUE({tab}!{quality_score}2:{quality_score}),0),'
            f'{tab}!{keep_priority}2:{keep_priority},{tab}!{content_format}2:{content_format},'
            f'{tab}!{publish_strategy}2:{publish_strategy},{tab}!{title}2:{title},{tab}!{angle}2:{angle},'
            f'{tab}!{x_text}2:{x_text},{tab}!{linkedin_text}2:{linkedin_text},'
            f'{tab}!{x_post_url}2:{x_post_url},{tab}!{linkedin_post_url}2:{linkedin_post_url},'
            f'{tab}!{drop_reason}2:{drop_reason},{tab}!{error}2:{error},{tab}!{next_action}2:{next_action},'
            f'{tab}!{freshness_checked_at}2:{freshness_checked_at},'
            f'IF({tab}!{status}2:{status}="partially_published",1,'
            f'IF({tab}!{status}2:{status}="approved",2,'
            f'IF({tab}!{status}2:{status}="scheduled",3,'
            f'IF({tab}!{status}2:{status}="drafted",4,99)))),'
            f'IF({tab}!{x_published_at}2:{x_published_at}<>"",{tab}!{x_published_at}2:{x_published_at},'
            f'IF({tab}!{linkedin_published_at}2:{linkedin_published_at}<>"",{tab}!{linkedin_published_at}2:{linkedin_published_at},'
            f'IF({tab}!{published_at}2:{published_at}<>"",{tab}!{published_at}2:{published_at},'
            f'{tab}!{freshness_checked_at}2:{freshness_checked_at})))}}}},'
            f'{tab}!A2:A<>"",'
            f'(({tab}!{keep_priority}2:{keep_priority}="ship_now")+({tab}!{status}2:{status}="partially_published"))>0,'
            f'(({tab}!{status}2:{status}="partially_published")+(IFERROR(VALUE({tab}!{quality_score}2:{quality_score}),0)>=10))>0,'
            f'IF(COUNTIF({tab}!{status}2:{status},"partially_published")>0,'
            f'{tab}!{status}2:{status}="partially_published",'
            f'REGEXMATCH({tab}!{status}2:{status},"^(drafted|approved|scheduled|partially_published)$")),'
            f'LEN({tab}!{x_text}2:{x_text}&{tab}!{linkedin_text}2:{linkedin_text})>0,'
            f'NOT(REGEXMATCH(LOWER({tab}!{error}2:{error}&" "&{tab}!{review_notes}2:{review_notes}&" "&{tab}!{next_action}2:{next_action}),'
            '"do not repost|再投稿禁止|url capture pending")),'
            f'NOT(({tab}!{status}2:{status}="partially_published")*({tab}!{x_post_url}2:{x_post_url}<>"")*({tab}!{linkedin_post_url}2:{linkedin_post_url}<>""))'
            '),17,TRUE,18,TRUE,3,FALSE,16,TRUE),1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16),3,16),{"","","","","","","","","","","","","","","",""}) }'
        )

    def _engagement_review_formula(self) -> str:
        tab = self._tab_name
        status = _sheet_queue_column("status")
        title = _sheet_queue_column("title")
        x_post_url = _sheet_queue_column("x_post_url")
        linkedin_post_url = _sheet_queue_column("linkedin_post_url")
        engagement_action = _sheet_queue_column("engagement_action")
        engagement_status = _sheet_queue_column("engagement_status")
        engagement_reason = _sheet_queue_column("engagement_reason")
        comment_draft = _sheet_queue_column("comment_draft")
        engagement_targets = _sheet_queue_column("engagement_targets")
        published_at = _sheet_queue_column("published_at")
        return (
            '= { {"id","status","title","engagement_action","engagement_status","engagement_reason",'
            '"comment_draft","engagement_targets","x_post_url","linkedin_post_url","published_at"}; '
            f'IFERROR(SORT(FILTER({{{tab}!A2:A,{tab}!{status}2:{status},{tab}!{title}2:{title},'
            f'{tab}!{engagement_action}2:{engagement_action},{tab}!{engagement_status}2:{engagement_status},'
            f'{tab}!{engagement_reason}2:{engagement_reason},{tab}!{comment_draft}2:{comment_draft},'
            f'{tab}!{engagement_targets}2:{engagement_targets},{tab}!{x_post_url}2:{x_post_url},'
            f'{tab}!{linkedin_post_url}2:{linkedin_post_url},{tab}!{published_at}2:{published_at}}},'
            f'{tab}!A2:A<>"",'
            f'{tab}!{engagement_status}2:{engagement_status}="approved",'
            f'LEN({tab}!{engagement_action}2:{engagement_action}&{tab}!{comment_draft}2:{comment_draft}&{tab}!{engagement_targets}2:{engagement_targets})>0'
            '),5,TRUE,11,FALSE),{"","","","","","","","","","",""}) }'
        )

    def _backlog_review_formula(self) -> str:
        tab = self._tab_name
        quality_score = _sheet_queue_column("quality_score")
        keep_priority = _sheet_queue_column("keep_priority")
        content_format = _sheet_queue_column("content_format")
        publish_strategy = _sheet_queue_column("publish_strategy")
        title = _sheet_queue_column("title")
        angle = _sheet_queue_column("angle")
        drop_reason = _sheet_queue_column("drop_reason")
        next_action = _sheet_queue_column("next_action")
        status = _sheet_queue_column("status")
        freshness_checked_at = _sheet_queue_column("freshness_checked_at")
        return (
            '= { {"id","status","quality_score","keep_priority","publish_strategy","content_format","title","angle","drop_reason","next_action","freshness_checked_at"}; '
            f'SORT(FILTER({{{tab}!A2:A,{tab}!{status}2:{status},'
            f'IFERROR(VALUE({tab}!{quality_score}2:{quality_score}),0),'
            f'{tab}!{keep_priority}2:{keep_priority},{tab}!{publish_strategy}2:{publish_strategy},'
            f'{tab}!{content_format}2:{content_format},{tab}!{title}2:{title},{tab}!{angle}2:{angle},'
            f'{tab}!{drop_reason}2:{drop_reason},{tab}!{next_action}2:{next_action},'
            f'{tab}!{freshness_checked_at}2:{freshness_checked_at}}},'
            f'{tab}!A2:A<>"",'
            f'REGEXMATCH({tab}!{keep_priority}2:{keep_priority},"^(hold|drop)$"),'
            f'{tab}!{status}2:{status}<>"published"'
            '),4,TRUE,3,FALSE,11,FALSE) }'
        )

    def _published_log_formula(self) -> str:
        tab = self._tab_name
        status = _sheet_queue_column("status")
        content_format = _sheet_queue_column("content_format")
        title = _sheet_queue_column("title")
        published_at = _sheet_queue_column("published_at")
        x_post_url = _sheet_queue_column("x_post_url")
        linkedin_post_url = _sheet_queue_column("linkedin_post_url")
        x_published_at = _sheet_queue_column("x_published_at")
        linkedin_published_at = _sheet_queue_column("linkedin_published_at")
        return (
            '= { {"id","status","content_format","title","published_at","x_post_url","linkedin_post_url",'
            '"x_published_at","linkedin_published_at"}; '
            f'SORT(FILTER({{{tab}!A2:A,{tab}!{status}2:{status},{tab}!{content_format}2:{content_format},{tab}!{title}2:{title},'
            f'{tab}!{published_at}2:{published_at},{tab}!{x_post_url}2:{x_post_url},'
            f'{tab}!{linkedin_post_url}2:{linkedin_post_url},{tab}!{x_published_at}2:{x_published_at},'
            f'{tab}!{linkedin_published_at}2:{linkedin_published_at}}},'
            f'{tab}!A2:A<>"",'
            f'((({tab}!{status}2:{status}="published") + (LEN({tab}!{x_post_url}2:{x_post_url}&{tab}!{linkedin_post_url}2:{linkedin_post_url})>0))>0)'
            '),5,FALSE) }'
        )

    def _write_values(self, tab_name: str, values: list[list[str]]) -> None:
        width = max((len(row) for row in values), default=1)
        end_column = _column_letter(width)
        self._service.spreadsheets().values().clear(
            spreadsheetId=self._spreadsheet_id,
            range=f"{tab_name}!A:Z",
            body={},
        ).execute()
        self._service.spreadsheets().values().update(
            spreadsheetId=self._spreadsheet_id,
            range=f"{tab_name}!A1:{end_column}{max(len(values), 1)}",
            valueInputOption="RAW",
            body={"values": values or [[""]]},
        ).execute()

    def _publish_today_values(self, queue_rows: list[QueueRow]) -> list[list[str]]:
        header = [
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
            "error",
            "next_action",
            "freshness_checked_at",
        ]

        def has_no_repost_marker(row: QueueRow) -> bool:
            text = " ".join((row.error, row.review_notes, row.next_action)).lower()
            return bool(re.search(r"do not repost|再投稿禁止|url capture pending", text))

        status_rank = {
            "partially_published": 0,
            "approved": 1,
            "scheduled": 2,
            "drafted": 3,
        }
        filtered = [
            row
            for row in queue_rows
            if row.id
            and (row.keep_priority == "ship_now" or row.status == "partially_published")
            and (row.status == "partially_published" or _safe_int_value(row.quality_score) >= 10)
            and row.status in status_rank
            and bool((row.x_text or "").strip() or (row.linkedin_text or "").strip())
            and not has_no_repost_marker(row)
            and not (
                row.status == "partially_published"
                and bool(row.x_post_url.strip())
                and bool(row.linkedin_post_url.strip())
            )
        ]
        partial_filtered = [row for row in filtered if row.status == "partially_published"]
        if partial_filtered:
            filtered = partial_filtered
        filtered.sort(
            key=lambda row: (
                status_rank.get(row.status, 99),
                row.x_published_at or row.linkedin_published_at or row.published_at or row.freshness_checked_at or "",
                -int(row.quality_score or "0"),
                row.freshness_checked_at or "",
            )
        )

        values = [header]
        for row in filtered[:3]:
            values.append(
                [
                    row.id,
                    row.status,
                    row.quality_score,
                    row.keep_priority,
                    row.content_format,
                    row.publish_strategy,
                    row.title,
                    row.angle,
                    row.x_text,
                    row.linkedin_text,
                    row.x_post_url,
                    row.linkedin_post_url,
                    row.drop_reason,
                    row.error,
                    row.next_action,
                    row.freshness_checked_at,
                ]
            )
        return values

    def _dashboard_values(self, queue_rows: list[QueueRow]) -> list[list[str]]:
        publish_today = self._publish_today_values(queue_rows)[1:]
        engagement_review = self._engagement_review_values(queue_rows)[1:]
        published = [
            row
            for row in queue_rows
            if row.id and (row.status == "published" or bool(row.x_post_url.strip()) or bool(row.linkedin_post_url.strip()))
        ]
        published.sort(
            key=lambda row: row.published_at or row.x_published_at or row.linkedin_published_at or "",
            reverse=True,
        )

        values = [
            ["section", "status", "quality_or_time", "title", "next_step"],
            ["tomorrow", "ready_count", str(len(publish_today)), "No ready posts yet" if not publish_today else "Open publish_today", ""],
            ["engagement", "auto_approved", str(len(engagement_review)), "No engagement candidates yet" if not engagement_review else "Open engagement_review", "Auto-send target X 5 likes/2 comments + LinkedIn 5 likes/1 comment"],
            ["tomorrow"],
            ["id", "status", "quality_score", "title", "next_action"],
        ]
        values.extend([[row[0], row[1], row[2], row[6], row[14]] for row in publish_today[:3]])
        if not publish_today:
            values.append(["", "", "", "", ""])
        values.append(["recent_posts"])
        values.append(["id", "published_at", "status", "title", "urls"])
        for row in published[:5]:
            values.append(
                [
                    row.id,
                    row.published_at,
                    row.status,
                    row.title,
                    f"{row.x_post_url} | {row.linkedin_post_url}".strip(" |"),
                ]
            )
        return values

    def _engagement_review_values(self, queue_rows: list[QueueRow]) -> list[list[str]]:
        header = [
            "id",
            "status",
            "title",
            "engagement_action",
            "engagement_status",
            "engagement_reason",
            "comment_draft",
            "engagement_targets",
            "x_post_url",
            "linkedin_post_url",
            "published_at",
        ]
        filtered = [
            row
            for row in queue_rows
            if row.id
            and row.engagement_status == "approved"
            and bool((row.engagement_action + row.comment_draft + row.engagement_targets).strip())
        ]
        filtered.sort(key=lambda row: (row.engagement_status != "approved", row.published_at or ""), reverse=False)
        values = [header]
        for row in filtered[:10]:
            values.append(
                [
                    row.id,
                    row.status,
                    row.title,
                    row.engagement_action,
                    row.engagement_status,
                    row.engagement_reason,
                    row.comment_draft,
                    row.engagement_targets,
                    row.x_post_url,
                    row.linkedin_post_url,
                    row.published_at,
                ]
            )
        return values

    def _refresh_manual_views(self, queue_rows: list[QueueRow]) -> None:
        self._write_values(self.PUBLISH_TODAY_TAB, self._publish_today_values(queue_rows))
        self._write_values(self.ENGAGEMENT_REVIEW_TAB, self._engagement_review_values(queue_rows))
        self._write_values(self.DASHBOARD_TAB, self._dashboard_values(queue_rows))

    def read_all(self) -> list[QueueRow]:
        end_column = _column_range(SHEETS_QUEUE_COLUMNS)
        response = self._service.spreadsheets().values().get(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self._tab_name}!A:{end_column}",
        ).execute()
        values = response.get("values", [])
        if not values:
            return []
        header = values[0]
        return [QueueRow.from_sheet_row(row, header) for row in values[1:]]

    def append(self, queue_row: QueueRow) -> None:
        end_column = _column_range(SHEETS_QUEUE_COLUMNS)
        self._service.spreadsheets().values().append(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self._tab_name}!A:{end_column}",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": [queue_row.as_row_for_columns(SHEETS_QUEUE_COLUMNS)]},
        ).execute()
        self._refresh_manual_views(self.read_all())

    def update(self, queue_row: QueueRow) -> None:
        end_column = _column_range(SHEETS_QUEUE_COLUMNS)
        rows = self.read_all()
        for index, existing in enumerate(rows, start=2):
            if existing.id == queue_row.id:
                self._service.spreadsheets().values().update(
                    spreadsheetId=self._spreadsheet_id,
                    range=f"{self._tab_name}!A{index}:{end_column}{index}",
                    valueInputOption="RAW",
                    body={"values": [queue_row.as_row_for_columns(SHEETS_QUEUE_COLUMNS)]},
                ).execute()
                self._refresh_manual_views(self.read_all())
                return
        raise KeyError(f"Queue row not found: {queue_row.id}")

    def upsert_many(self, queue_rows: list[QueueRow]) -> int:
        end_column = _column_range(SHEETS_QUEUE_COLUMNS)
        response = self._service.spreadsheets().values().get(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self._tab_name}!A:{end_column}",
        ).execute()
        values = response.get("values", [])
        if not values:
            self._service.spreadsheets().values().update(
                spreadsheetId=self._spreadsheet_id,
                range=f"{self._tab_name}!A1:{end_column}1",
                valueInputOption="RAW",
                body={"values": [SHEETS_QUEUE_COLUMNS]},
            ).execute()
            values = [SHEETS_QUEUE_COLUMNS]
        elif values[0] != SHEETS_QUEUE_COLUMNS:
            stale_header = values[0]
            repaired_rows = [
                QueueRow.from_sheet_row(value_row, stale_header).as_row_for_columns(SHEETS_QUEUE_COLUMNS)
                for value_row in values[1:]
            ]
            self._service.spreadsheets().values().update(
                spreadsheetId=self._spreadsheet_id,
                range=f"{self._tab_name}!A1:{end_column}1",
                valueInputOption="RAW",
                body={"values": [SHEETS_QUEUE_COLUMNS]},
            ).execute()
            if repaired_rows:
                self._service.spreadsheets().values().update(
                    spreadsheetId=self._spreadsheet_id,
                    range=f"{self._tab_name}!A2:{end_column}{len(repaired_rows) + 1}",
                    valueInputOption="RAW",
                    body={"values": repaired_rows},
                ).execute()
            values = [SHEETS_QUEUE_COLUMNS, *repaired_rows]

        header = values[0]
        existing_row_numbers: dict[str, int] = {}
        for row_number, value_row in enumerate(values[1:], start=2):
            queue_row = QueueRow.from_sheet_row(value_row, header)
            if queue_row.id:
                existing_row_numbers[queue_row.id] = row_number

        updates: list[dict[str, object]] = []
        appends: list[list[str]] = []
        for queue_row in queue_rows:
            row_values = queue_row.as_row_for_columns(SHEETS_QUEUE_COLUMNS)
            row_number = existing_row_numbers.get(queue_row.id)
            if row_number is None:
                appends.append(row_values)
            else:
                updates.append(
                    {
                        "range": f"{self._tab_name}!A{row_number}:{end_column}{row_number}",
                        "values": [row_values],
                    }
                )

        if updates:
            self._service.spreadsheets().values().batchUpdate(
                spreadsheetId=self._spreadsheet_id,
                body={"valueInputOption": "RAW", "data": updates},
            ).execute()
        if appends:
            self._service.spreadsheets().values().append(
                spreadsheetId=self._spreadsheet_id,
                range=f"{self._tab_name}!A:{end_column}",
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": appends},
            ).execute()
        self._refresh_manual_views(queue_rows)
        return len(queue_rows)

    def append_run_summary(
        self,
        *,
        run_at: str,
        researched_count: int,
        feed_study_count: int = 0,
        external_posts_read: int = 0,
        feed_research_receipt: str = "",
        refreshed_count: int = 0,
        selected_count: int = 0,
        posted_count: int = 0,
        quoted_count: int = 0,
        engagement_candidates_created: int = 0,
        external_engagement_candidates: int = 0,
        own_post_engagement_candidates: int = 0,
        media_receipt: str = "",
        sheets_synced_count: int = 0,
        stop_reason: str = "",
        ship_now_buffer_count: int | str = "",
        ship_now_buffer_refreshed_count: int | str = "",
        usable_publish_candidate_count: int | str = "",
    ) -> None:
        end_column = _column_range(RUN_SUMMARY_COLUMNS)
        response = self._service.spreadsheets().values().get(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.RUN_SUMMARY_TAB}!A:{end_column}",
        ).execute()
        values = response.get("values", [])
        if not values or values[0] != RUN_SUMMARY_COLUMNS:
            stale_header = values[0] if values else []
            repaired_rows = _reorder_sheet_rows(
                values[1:],
                source_columns=stale_header,
                target_columns=RUN_SUMMARY_COLUMNS,
            )
            self._service.spreadsheets().values().update(
                spreadsheetId=self._spreadsheet_id,
                range=f"{self.RUN_SUMMARY_TAB}!A1:{end_column}1",
                valueInputOption="RAW",
                body={"values": [RUN_SUMMARY_COLUMNS]},
            ).execute()
            if repaired_rows:
                self._service.spreadsheets().values().update(
                    spreadsheetId=self._spreadsheet_id,
                    range=f"{self.RUN_SUMMARY_TAB}!A2:{end_column}{len(repaired_rows) + 1}",
                    valueInputOption="RAW",
                    body={"values": repaired_rows},
                ).execute()
        self._service.spreadsheets().values().append(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.RUN_SUMMARY_TAB}!A:{end_column}",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={
                "values": [[
                    run_at,
                    str(researched_count),
                    str(feed_study_count),
                    str(external_posts_read),
                    feed_research_receipt,
                    str(refreshed_count),
                    str(selected_count),
                    str(posted_count),
                    str(quoted_count),
                    str(engagement_candidates_created),
                    str(external_engagement_candidates),
                    str(own_post_engagement_candidates),
                    media_receipt,
                    str(sheets_synced_count),
                    stop_reason,
                    str(ship_now_buffer_count),
                    str(ship_now_buffer_refreshed_count),
                    str(usable_publish_candidate_count),
                ]]
            },
        ).execute()

    def append_feed_read_log(self, rows: list[list[str]]) -> None:
        if not rows:
            return
        end_column = _column_range(FEED_READ_LOG_COLUMNS)
        self._service.spreadsheets().values().append(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.FEED_READ_LOG_TAB}!A:{end_column}",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute()

    def append_learning_review(self, rows: list[list[str]]) -> None:
        if not rows:
            return
        end_column = _column_range(LEARNING_REVIEW_COLUMNS)
        self._service.spreadsheets().values().append(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.LEARNING_REVIEW_TAB}!A:{end_column}",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute()

    def upsert_relationship_map(self, rows: list[list[str]]) -> int:
        if not rows:
            return 0
        end_column = _column_range(ENGAGEMENT_RELATIONSHIP_COLUMNS)
        response = self._service.spreadsheets().values().get(
            spreadsheetId=self._spreadsheet_id,
            range=f"{self.ENGAGEMENT_RELATIONSHIP_TAB}!A:{end_column}",
        ).execute()
        values = response.get("values", [])
        if not values:
            self._service.spreadsheets().values().update(
                spreadsheetId=self._spreadsheet_id,
                range=f"{self.ENGAGEMENT_RELATIONSHIP_TAB}!A1:{end_column}1",
                valueInputOption="RAW",
                body={"values": [ENGAGEMENT_RELATIONSHIP_COLUMNS]},
            ).execute()
            values = [ENGAGEMENT_RELATIONSHIP_COLUMNS]

        header = values[0]
        existing_row_numbers: dict[tuple[str, str], int] = {}
        existing_rows: dict[tuple[str, str], list[str]] = {}
        for row_number, value_row in enumerate(values[1:], start=2):
            normalized = self._relationship_row_for_header(value_row, header)
            key = self._relationship_key(normalized)
            if key:
                existing_row_numbers[key] = row_number
                existing_rows[key] = normalized

        incoming_rows: dict[tuple[str, str], list[str]] = {}
        for row in rows:
            normalized = self._relationship_row_for_header(row, ENGAGEMENT_RELATIONSHIP_COLUMNS)
            key = self._relationship_key(normalized)
            if not key:
                continue
            if key in incoming_rows:
                incoming_rows[key] = self._merge_relationship_rows(incoming_rows[key], normalized)
            else:
                incoming_rows[key] = normalized

        updates: list[dict[str, object]] = []
        appends: list[list[str]] = []
        for key, normalized in incoming_rows.items():
            row_number = existing_row_numbers.get(key)
            if row_number is None:
                appends.append(normalized)
            else:
                merged = self._merge_relationship_rows(existing_rows[key], normalized)
                updates.append(
                    {
                        "range": f"{self.ENGAGEMENT_RELATIONSHIP_TAB}!A{row_number}:{end_column}{row_number}",
                        "values": [merged],
                    }
                )

        if updates:
            self._service.spreadsheets().values().batchUpdate(
                spreadsheetId=self._spreadsheet_id,
                body={"valueInputOption": "RAW", "data": updates},
            ).execute()
        if appends:
            self._service.spreadsheets().values().append(
                spreadsheetId=self._spreadsheet_id,
                range=f"{self.ENGAGEMENT_RELATIONSHIP_TAB}!A:{end_column}",
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": appends},
            ).execute()
        return len(updates) + len(appends)

    @staticmethod
    def _relationship_row_for_header(row: list[str], header: list[str]) -> list[str]:
        source = {name: row[index] if index < len(row) else "" for index, name in enumerate(header)}
        return [source.get(column, "") for column in ENGAGEMENT_RELATIONSHIP_COLUMNS]

    @staticmethod
    def _relationship_key(row: list[str]) -> tuple[str, str] | None:
        platform = row[ENGAGEMENT_RELATIONSHIP_COLUMNS.index("platform")].strip().lower()
        handle = row[ENGAGEMENT_RELATIONSHIP_COLUMNS.index("handle")].strip().lower()
        if not platform or not handle:
            return None
        return platform, handle

    @staticmethod
    def _merge_relationship_rows(existing: list[str], incoming: list[str]) -> list[str]:
        merged = existing[:]
        existing_source_urls = set(_unique_parts(existing[ENGAGEMENT_RELATIONSHIP_COLUMNS.index("source_post_urls")]))
        incoming_source_urls = set(_unique_parts(incoming[ENGAGEMENT_RELATIONSHIP_COLUMNS.index("source_post_urls")]))
        for index, column in enumerate(ENGAGEMENT_RELATIONSHIP_COLUMNS):
            new_value = incoming[index].strip()
            if not new_value:
                continue
            if column in {"source_queue_ids", "source_post_urls", "topic_tags", "notes"}:
                merged[index] = _merge_unique_parts(merged[index], new_value)
            elif column == "evidence_count":
                if incoming_source_urls:
                    new_evidence_count = len(incoming_source_urls - existing_source_urls)
                else:
                    new_evidence_count = _safe_int_value(new_value)
                merged[index] = str(_safe_int_value(merged[index]) + new_evidence_count)
            else:
                merged[index] = new_value
        return merged

    def get(self, item_id: str) -> QueueRow | None:
        for row in self.read_all():
            if row.id == item_id:
                return row
        return None
