from __future__ import annotations

import json
from pathlib import Path
import re
import time
from typing import Any

import requests

from social_flow.models import QueueRow


GEMINI_SYSTEM_PROMPT = """You are a Japanese short-video social media strategist.
Return valid JSON only.
Keep the writing natural and concise.
Assume the same source asset will be repurposed for TikTok, Instagram Reels, YouTube Shorts, and Facebook Reels.
Write for an individual creator account, not a corporate PR team.
Do not use markdown bold.
Avoid filler phrases such as "話題です", "注目されています", "以下がポイントです", or "まとめました".
"""


def build_video_generation_prompt(row: QueueRow) -> str:
    return f"""
Video file name:
{row.drive_file_name or row.title}

Drive URL:
{row.drive_web_url or row.source_url}

Current title:
{row.title or "(not set)"}

Existing summary:
{row.summary_en or "(none)"}

Preferred angle:
{row.angle or "(not set)"}

Research notes:
{row.research_notes or "(none)"}

Past post reference:
{row.past_post_reference or "(none)"}

Reference media notes:
{row.reference_media_notes or "(none)"}

Please produce JSON with this schema:
{{
  "content_summary": "Japanese summary in 120 characters or less",
  "hook_candidates": "3 short hook ideas separated by |",
  "key_points": "3 short key points separated by |",
  "cta_suggestion": "One short CTA in Japanese",
  "recommended_platforms": "Recommended platforms as a comma-separated list",
  "hashtag_candidates": "Common hashtags as a space-separated string",
  "thumbnail_text_idea": "Short thumbnail text idea in Japanese",
  "media_plan": "One short Japanese sentence describing the best posting format",
  "best_platform": "One of TikTok, Instagram Reels, YouTube Shorts, Facebook Reels",
  "best_hook": "One short hook in Japanese",
  "tiktok_caption": "Japanese TikTok caption under 140 characters",
  "tiktok_hashtags": "Space-separated hashtags for TikTok",
  "instagram_caption": "Japanese Instagram Reels caption under 220 characters",
  "instagram_hashtags": "Space-separated hashtags for Instagram",
  "youtube_title": "Japanese YouTube Shorts title under 60 characters",
  "youtube_description": "Japanese YouTube Shorts description under 300 characters",
  "youtube_hashtags": "Space-separated hashtags for YouTube Shorts",
  "facebook_caption": "Japanese Facebook Reels caption under 220 characters",
  "facebook_hashtags": "Space-separated hashtags for Facebook Reels"
}}
"""


def browser_video_qa_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": ["timeline", "step_matches", "anomalies", "recommendation"],
        "properties": {
            "timeline": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["timecode", "observation", "evidence", "confidence"],
                    "properties": {
                        "timecode": {"type": "string"},
                        "observation": {"type": "string"},
                        "evidence": {"type": "string"},
                        "confidence": {"type": "number"},
                    },
                },
            },
            "step_matches": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["expected_step", "matched", "timecode", "evidence", "confidence"],
                    "properties": {
                        "expected_step": {"type": "string"},
                        "matched": {"type": "boolean"},
                        "timecode": {"type": "string"},
                        "evidence": {"type": "string"},
                        "confidence": {"type": "number"},
                    },
                },
            },
            "anomalies": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["rule", "detected", "timecode", "evidence", "severity"],
                    "properties": {
                        "rule": {"type": "string"},
                        "detected": {"type": "boolean"},
                        "timecode": {"type": "string"},
                        "evidence": {"type": "string"},
                        "severity": {"type": "string", "enum": ["none", "low", "medium", "high"]},
                    },
                },
            },
            "recommendation": {
                "type": "object",
                "required": ["status", "summary", "next_action"],
                "properties": {
                    "status": {"type": "string", "enum": ["pass", "investigate", "fail"]},
                    "summary": {"type": "string"},
                    "next_action": {"type": "string"},
                },
            },
        },
    }


def build_browser_video_qa_prompt(
    *,
    expected_steps: list[str],
    anomaly_rules: list[str],
    schema: dict[str, Any] | None = None,
) -> str:
    qa_schema = schema or browser_video_qa_schema()
    return f"""
You are reviewing a screen recording of a browser automation run.
Return valid JSON only. Do not include markdown or commentary outside JSON.

Expected steps:
{json.dumps(expected_steps, ensure_ascii=False, indent=2)}

Anomaly rules:
{json.dumps(anomaly_rules, ensure_ascii=False, indent=2)}

Output schema:
{json.dumps(qa_schema, ensure_ascii=False, indent=2)}

Assess the video timeline, match each expected step, flag anomalies according to the rules, and give one recommendation.
Use concise evidence with visible UI or motion references. If a timecode is uncertain, use an approximate timecode.
"""


def _guess_video_mime_type(video_path: str | Path) -> str:
    suffix = Path(video_path).suffix.lower()
    mime_types = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
    }
    mime_type = mime_types.get(suffix)
    if not mime_type:
        raise ValueError("Unsupported video format. Supported formats: mp4, webm, mov.")
    return mime_type


def _strip_code_fences(text: str) -> str:
    if text.strip().startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text, flags=re.IGNORECASE)
    return text


def _file_state_name(file_obj: Any) -> str:
    state = getattr(file_obj, "state", "")
    if hasattr(state, "name"):
        return str(state.name).upper()
    return str(state or "").upper()


def _wait_for_uploaded_file_ready(
    client: Any,
    uploaded_file: Any,
    *,
    timeout_seconds: float = 300,
    poll_interval_seconds: float = 2,
) -> Any:
    deadline = time.monotonic() + timeout_seconds
    current_file = uploaded_file
    while True:
        state = _file_state_name(current_file)
        if state in {"", "ACTIVE", "READY", "SUCCEEDED"}:
            return current_file
        if state in {"FAILED", "ERROR"}:
            name = getattr(current_file, "name", "uploaded file")
            raise ValueError(f"Gemini File API processing failed for {name}.")
        if time.monotonic() >= deadline:
            name = getattr(current_file, "name", "uploaded file")
            raise TimeoutError(f"Timed out waiting for Gemini File API processing: {name}.")
        time.sleep(max(poll_interval_seconds, 0.1))
        name = getattr(current_file, "name", "")
        if not name:
            return current_file
        current_file = client.files.get(name=name)


def _extract_generate_content_text(response: Any) -> str:
    text = getattr(response, "text", "")
    if text:
        return str(text).strip()
    candidates = getattr(response, "candidates", None)
    if candidates is None and isinstance(response, dict):
        candidates = response.get("candidates")
    if not candidates:
        return ""
    first = candidates[0]
    content = getattr(first, "content", None)
    if content is None and isinstance(first, dict):
        content = first.get("content", {})
    parts = getattr(content, "parts", None)
    if parts is None and isinstance(content, dict):
        parts = content.get("parts", [])
    extracted: list[str] = []
    for part in parts or []:
        part_text = getattr(part, "text", None)
        if part_text is None and isinstance(part, dict):
            part_text = part.get("text")
        if part_text:
            extracted.append(str(part_text))
    return "".join(extracted).strip()


def _validate_browser_video_qa_result(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Gemini returned JSON that is not an object.")
    required_keys = {"timeline", "step_matches", "anomalies", "recommendation"}
    missing = sorted(required_keys - set(payload))
    if missing:
        raise ValueError(f"Gemini QA JSON is missing required keys: {', '.join(missing)}")
    if not isinstance(payload["timeline"], list):
        raise ValueError("Gemini QA JSON field `timeline` must be a list.")
    if not isinstance(payload["step_matches"], list):
        raise ValueError("Gemini QA JSON field `step_matches` must be a list.")
    if not isinstance(payload["anomalies"], list):
        raise ValueError("Gemini QA JSON field `anomalies` must be a list.")
    if not isinstance(payload["recommendation"], dict):
        raise ValueError("Gemini QA JSON field `recommendation` must be an object.")
    return payload


def analyze_browser_automation_video(
    *,
    api_key: str,
    model: str,
    video_path: str | Path,
    expected_steps: list[str],
    anomaly_rules: list[str],
    timeout_seconds: float = 300,
    client: Any | None = None,
    poll_interval_seconds: float = 2,
) -> dict[str, Any]:
    if not api_key.strip():
        raise ValueError("GEMINI_API_KEY is required.")
    path = Path(video_path).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"Video file not found: {path}")

    mime_type = _guess_video_mime_type(path)
    schema = browser_video_qa_schema()
    prompt = build_browser_video_qa_prompt(
        expected_steps=expected_steps,
        anomaly_rules=anomaly_rules,
        schema=schema,
    )

    upload_config: Any = {"mime_type": mime_type}
    generation_config: Any = {
        "temperature": 0,
        "response_mime_type": "application/json",
        "response_schema": schema,
    }
    if client is None:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        upload_config = types.UploadFileConfig(mime_type=mime_type)
        generation_config = types.GenerateContentConfig(
            temperature=0,
            response_mime_type="application/json",
            response_schema=schema,
        )

    uploaded_file = client.files.upload(file=str(path), config=upload_config)
    ready_file = _wait_for_uploaded_file_ready(
        client,
        uploaded_file,
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
    )
    response = client.models.generate_content(
        model=model,
        contents=[ready_file, prompt],
        config=generation_config,
    )
    text = _extract_generate_content_text(response)
    if not text:
        raise ValueError("Gemini returned an empty QA response.")
    payload = json.loads(_strip_code_fences(text))
    return _validate_browser_video_qa_result(payload)


def generate_video_social_copy(*, api_key: str, model: str, row: QueueRow) -> dict[str, str]:
    if not api_key.strip():
        raise ValueError("GEMINI_API_KEY is required.")

    response = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        params={"key": api_key},
        timeout=60,
        headers={"Content-Type": "application/json"},
        json={
            "system_instruction": {"parts": [{"text": GEMINI_SYSTEM_PROMPT}]},
            "contents": [{"parts": [{"text": build_video_generation_prompt(row)}]}],
            "generationConfig": {
                "temperature": 0.8,
                "responseMimeType": "application/json",
            },
        },
    )
    response.raise_for_status()
    payload = response.json()
    candidates = payload.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini returned no candidates.")

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise ValueError("Gemini returned an empty response.")
    return json.loads(_strip_code_fences(text))
