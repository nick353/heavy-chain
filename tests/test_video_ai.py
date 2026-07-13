from __future__ import annotations

import json
from pathlib import Path

import pytest

from social_flow.video_ai import (
    _guess_video_mime_type,
    _wait_for_uploaded_file_ready,
    analyze_browser_automation_video,
    browser_video_qa_schema,
    build_browser_video_qa_prompt,
)


class FakeState:
    def __init__(self, name: str) -> None:
        self.name = name


class FakeFile:
    def __init__(self, name: str, state: str = "ACTIVE") -> None:
        self.name = name
        self.state = FakeState(state)


class FakeFiles:
    def __init__(self) -> None:
        self.upload_config = None
        self.uploaded_path = ""
        self.get_calls = 0

    def upload(self, *, file: str, config):
        self.uploaded_path = file
        self.upload_config = config
        return FakeFile("files/browser-video", "ACTIVE")

    def get(self, *, name: str):
        self.get_calls += 1
        return FakeFile(name, "ACTIVE")


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.text = json.dumps(payload)


class FakeModels:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.request = {}

    def generate_content(self, *, model: str, contents, config):
        self.request = {"model": model, "contents": contents, "config": config}
        return FakeResponse(self.payload)


class FakeClient:
    def __init__(self, payload: dict) -> None:
        self.files = FakeFiles()
        self.models = FakeModels(payload)


def _qa_payload() -> dict:
    return {
        "timeline": [
            {
                "timecode": "00:01",
                "observation": "Login page appears.",
                "evidence": "Visible email input.",
                "confidence": 0.9,
            }
        ],
        "step_matches": [
            {
                "expected_step": "Open login page",
                "matched": True,
                "timecode": "00:01",
                "evidence": "Login form is visible.",
                "confidence": 0.9,
            }
        ],
        "anomalies": [
            {
                "rule": "No reload loop",
                "detected": False,
                "timecode": "",
                "evidence": "No repeated reloads observed.",
                "severity": "none",
            }
        ],
        "recommendation": {
            "status": "pass",
            "summary": "The automation reached the expected page.",
            "next_action": "Keep this as a baseline QA sample.",
        },
    }


def _assert_no_additional_properties(value, path: str = "$") -> None:
    if isinstance(value, dict):
        assert "additionalProperties" not in value, f"{path} contains additionalProperties"
        for key, child in value.items():
            _assert_no_additional_properties(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _assert_no_additional_properties(child, f"{path}[{index}]")


def test_browser_video_qa_schema_has_no_additional_properties() -> None:
    schema = browser_video_qa_schema()

    _assert_no_additional_properties(schema)
    assert schema["required"] == ["timeline", "step_matches", "anomalies", "recommendation"]
    assert set(schema["properties"]) == {"timeline", "step_matches", "anomalies", "recommendation"}


def test_browser_video_qa_prompt_includes_steps_rules_and_schema() -> None:
    schema = browser_video_qa_schema()
    prompt = build_browser_video_qa_prompt(
        expected_steps=["Open login page", "Submit form"],
        anomaly_rules=["No reload loop"],
        schema=schema,
    )

    assert "Open login page" in prompt
    assert "No reload loop" in prompt
    assert "timeline" in prompt
    assert "step_matches" in prompt
    assert "recommendation" in prompt


def test_guess_video_mime_type_accepts_supported_video_formats() -> None:
    assert _guess_video_mime_type("demo.mp4") == "video/mp4"
    assert _guess_video_mime_type("demo.webm") == "video/webm"
    assert _guess_video_mime_type("demo.mov") == "video/quicktime"

    with pytest.raises(ValueError, match="Unsupported video format"):
        _guess_video_mime_type("demo.avi")


def test_wait_for_uploaded_file_ready_polls_until_active(monkeypatch) -> None:
    class Files:
        def __init__(self) -> None:
            self.calls = 0

        def get(self, *, name: str):
            self.calls += 1
            return FakeFile(name, "ACTIVE")

    class Client:
        def __init__(self) -> None:
            self.files = Files()

    monkeypatch.setattr("social_flow.video_ai.time.sleep", lambda seconds: None)
    client = Client()
    ready = _wait_for_uploaded_file_ready(
        client,
        FakeFile("files/browser-video", "PROCESSING"),
        timeout_seconds=1,
        poll_interval_seconds=0.01,
    )

    assert ready.name == "files/browser-video"
    assert client.files.calls == 1


def test_analyze_browser_automation_video_uses_file_api_and_returns_valid_json(tmp_path: Path) -> None:
    video = tmp_path / "run.mp4"
    video.write_bytes(b"fake mp4")
    client = FakeClient(_qa_payload())

    result = analyze_browser_automation_video(
        api_key="secret-gemini-key",
        model="gemini-2.5-pro",
        video_path=video,
        expected_steps=["Open login page"],
        anomaly_rules=["No reload loop"],
        timeout_seconds=1,
        client=client,
    )

    assert result["recommendation"]["status"] == "pass"
    assert client.files.uploaded_path == str(video)
    assert client.files.upload_config["mime_type"] == "video/mp4"
    assert client.models.request["model"] == "gemini-2.5-pro"
    assert client.models.request["contents"][0].name == "files/browser-video"
    assert "Open login page" in client.models.request["contents"][1]
    assert client.models.request["config"]["response_schema"]["required"] == [
        "timeline",
        "step_matches",
        "anomalies",
        "recommendation",
    ]
