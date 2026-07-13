from __future__ import annotations

from social_flow.computer_use import (
    build_computer_call_output,
    extract_computer_calls,
    extract_output_text,
    normalize_drag_path,
    normalize_key,
)


def test_extract_computer_calls_filters_output_items() -> None:
    payload = {
        "output": [
            {"type": "reasoning"},
            {"type": "computer_call", "call_id": "call_123", "action": {"type": "wait"}},
            {"type": "message"},
        ]
    }

    calls = extract_computer_calls(payload)

    assert len(calls) == 1
    assert calls[0]["call_id"] == "call_123"


def test_extract_output_text_uses_message_content_when_needed() -> None:
    payload = {
        "output": [
            {
                "type": "message",
                "content": [
                    {"type": "output_text", "text": "done"},
                ],
            }
        ]
    }

    assert extract_output_text(payload) == "done"


def test_build_computer_call_output_includes_current_url() -> None:
    item = build_computer_call_output(
        model="computer-use-preview",
        call_id="call_123",
        screenshot_bytes=b"png-bytes",
        current_url="https://example.com",
    )

    assert item["type"] == "computer_call_output"
    assert item["call_id"] == "call_123"
    assert item["current_url"] == "https://example.com"
    assert item["output"]["type"] == "computer_screenshot"
    assert item["output"]["image_url"].startswith("data:image/png;base64,")


def test_normalize_key_maps_common_aliases() -> None:
    assert normalize_key("cmd") == "Meta"
    assert normalize_key("enter") == "Enter"
    assert normalize_key("ArrowLeft") == "ArrowLeft"


def test_normalize_drag_path_accepts_pairs_and_dicts() -> None:
    assert normalize_drag_path([[1, 2], {"x": 3, "y": 4}]) == [(1.0, 2.0), (3.0, 4.0)]
