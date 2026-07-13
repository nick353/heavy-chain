from __future__ import annotations

import base64
from dataclasses import dataclass
import json
from os import getenv
from pathlib import Path
import time
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI


DEFAULT_COMPUTER_USE_MODEL = "gpt-5.4-mini"


@dataclass(frozen=True)
class BrowserComputerConfig:
    model: str
    display_width: int = 1280
    display_height: int = 800
    headless: bool = True
    slow_mo_ms: int = 0
    max_turns: int = 12
    wait_after_action_seconds: float = 1.0
    acknowledge_safety_checks: bool = False


def load_openai_api_key() -> str:
    load_dotenv()
    api_key = getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("Environment variable `OPENAI_API_KEY` is required.")
    return api_key


def load_computer_use_model() -> str:
    load_dotenv()
    return (
        getenv("OPENAI_COMPUTER_USE_MODEL", "").strip()
        or getenv("OPENAI_MODEL", "").strip()
        or DEFAULT_COMPUTER_USE_MODEL
    )


def response_to_dict(response: Any) -> dict[str, Any]:
    if isinstance(response, dict):
        return response
    if hasattr(response, "model_dump"):
        return response.model_dump()
    raise TypeError("Unsupported response object.")


def extract_computer_calls(response_payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        item
        for item in response_payload.get("output", [])
        if isinstance(item, dict) and item.get("type") == "computer_call"
    ]


def extract_output_text(response_payload: dict[str, Any]) -> str:
    if isinstance(response_payload.get("output_text"), str) and response_payload["output_text"].strip():
        return response_payload["output_text"].strip()

    parts: list[str] = []
    for item in response_payload.get("output", []):
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if isinstance(content, dict) and content.get("type") == "output_text":
                text = str(content.get("text", "")).strip()
                if text:
                    parts.append(text)
    return "\n".join(parts).strip()


def build_computer_call_output(
    *,
    model: str,
    call_id: str,
    screenshot_bytes: bytes,
    current_url: str,
    acknowledged_safety_checks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    screenshot_base64 = base64.b64encode(screenshot_bytes).decode("utf-8")
    item: dict[str, Any] = {
        "type": "computer_call_output",
        "call_id": call_id,
        "output": {
            "type": "computer_screenshot",
            "image_url": f"data:image/png;base64,{screenshot_base64}",
        },
    }
    if model == "computer-use-preview":
        item["current_url"] = current_url
    if acknowledged_safety_checks:
        item["acknowledged_safety_checks"] = acknowledged_safety_checks
    return item


def normalize_key(key: str) -> str:
    key_map = {
        "ENTER": "Enter",
        "RETURN": "Enter",
        "TAB": "Tab",
        "SPACE": " ",
        "ESC": "Escape",
        "ESCAPE": "Escape",
        "BACKSPACE": "Backspace",
        "DELETE": "Delete",
        "LEFT": "ArrowLeft",
        "RIGHT": "ArrowRight",
        "UP": "ArrowUp",
        "DOWN": "ArrowDown",
        "ARROWLEFT": "ArrowLeft",
        "ARROWRIGHT": "ArrowRight",
        "ARROWUP": "ArrowUp",
        "ARROWDOWN": "ArrowDown",
        "CMD": "Meta",
        "COMMAND": "Meta",
        "CTRL": "Control",
        "CONTROL": "Control",
        "OPTION": "Alt",
    }
    return key_map.get(key.upper(), key)


def normalize_drag_path(path: Any) -> list[tuple[float, float]]:
    if not isinstance(path, list):
        raise ValueError("drag action requires a path array")

    normalized: list[tuple[float, float]] = []
    for point in path:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            normalized.append((float(point[0]), float(point[1])))
        elif isinstance(point, dict) and "x" in point and "y" in point:
            normalized.append((float(point["x"]), float(point["y"])))
        else:
            raise ValueError("drag path entries must be coordinate pairs or {x, y} objects")
    return normalized


def _openai_computer_tool(config: BrowserComputerConfig) -> dict[str, Any]:
    if config.model == "computer-use-preview":
        return {
            "type": "computer_use_preview",
            "display_width": config.display_width,
            "display_height": config.display_height,
            "environment": "browser",
        }
    return {
        "type": "computer",
    }


def _initial_input(task: str, start_url: str) -> list[dict[str, Any]]:
    return [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        f"Start URL: {start_url}\n"
                        f"Task: {task}\n"
                        "Use the computer tool for browser interaction. "
                        "Stay within the browser and finish by explaining what you completed."
                    ),
                }
            ],
        }
    ]


def run_browser_computer_task(
    *,
    task: str,
    start_url: str,
    config: BrowserComputerConfig,
    output_dir: str | None = None,
) -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    api_key = load_openai_api_key()
    client = OpenAI(api_key=api_key)

    artifacts_dir = Path(output_dir) if output_dir else None
    if artifacts_dir is not None:
        artifacts_dir.mkdir(parents=True, exist_ok=True)

    response_payload: dict[str, Any]
    action_log: list[dict[str, Any]] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=config.headless, slow_mo=config.slow_mo_ms)
        page = browser.new_page(viewport={"width": config.display_width, "height": config.display_height})
        page.goto(start_url, wait_until="domcontentloaded")

        response = client.responses.create(
            model=config.model,
            tools=[_openai_computer_tool(config)],
            input=_initial_input(task, start_url),
            truncation="auto",
            store=True,
        )
        response_payload = response_to_dict(response)

        for turn_index in range(config.max_turns):
            computer_calls = extract_computer_calls(response_payload)
            if not computer_calls:
                break

            computer_call = computer_calls[0]
            pending_safety_checks = computer_call.get("pending_safety_checks", [])
            if pending_safety_checks and not config.acknowledge_safety_checks:
                raise RuntimeError(
                    "Computer use safety checks require acknowledgement. "
                    "Re-run with acknowledge_safety_checks enabled if you want to proceed.\n"
                    + json.dumps(pending_safety_checks, ensure_ascii=False, indent=2)
                )

            actions = extract_actions(computer_call)
            for action in actions:
                execute_browser_action(page, action)
            action_log.append(computer_call)
            time.sleep(config.wait_after_action_seconds)

            screenshot_bytes = page.screenshot(full_page=False, type="png")
            if artifacts_dir is not None:
                (artifacts_dir / f"turn-{turn_index:02d}.png").write_bytes(screenshot_bytes)

            response = client.responses.create(
                model=config.model,
                previous_response_id=response_payload["id"],
                tools=[_openai_computer_tool(config)],
                input=[
                    build_computer_call_output(
                        model=config.model,
                        call_id=str(computer_call["call_id"]),
                        screenshot_bytes=screenshot_bytes,
                        current_url=page.url,
                        acknowledged_safety_checks=pending_safety_checks or None,
                    )
                ],
                truncation="auto",
                store=True,
            )
            response_payload = response_to_dict(response)

        final_text = extract_output_text(response_payload)
        if artifacts_dir is not None:
            summary = {
                "final_text": final_text,
                "response_id": response_payload.get("id"),
                "actions": action_log,
            }
            (artifacts_dir / "summary.json").write_text(
                json.dumps(summary, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        browser.close()

    return {
        "response_id": response_payload.get("id", ""),
        "final_text": final_text,
        "actions": action_log,
        "raw_response": response_payload,
    }


def execute_browser_action(page: Any, action: dict[str, Any]) -> None:
    action_type = action.get("type")

    if action_type == "click":
        x = float(action["x"])
        y = float(action["y"])
        page.mouse.move(x, y)
        clicks = int(action.get("num_clicks", action.get("clicks", 1)))
        page.mouse.click(x, y, button=str(action.get("button", "left")), click_count=clicks)
        return

    if action_type == "double_click":
        page.mouse.dblclick(
            float(action["x"]),
            float(action["y"]),
            button=str(action.get("button", "left")),
        )
        return

    if action_type == "drag":
        path = normalize_drag_path(action.get("path"))
        if len(path) < 2:
            raise ValueError("drag action requires at least two path points")
        start_x, start_y = path[0]
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        for x, y in path[1:]:
            page.mouse.move(x, y)
        page.mouse.up()
        return

    if action_type == "move":
        page.mouse.move(float(action["x"]), float(action["y"]))
        return

    if action_type == "scroll":
        page.mouse.move(float(action["x"]), float(action["y"]))
        page.mouse.wheel(
            float(action.get("scroll_x", action.get("scrollX", 0))),
            float(action.get("scroll_y", action.get("scrollY", 0))),
        )
        return

    if action_type == "keypress":
        for key in action.get("keys", []):
            page.keyboard.press(normalize_key(str(key)))
        return

    if action_type == "type":
        page.keyboard.type(str(action.get("text", "")))
        return

    if action_type == "wait":
        time.sleep(1.0)
        return

    if action_type == "screenshot":
        return

    raise ValueError(f"Unsupported computer action: {action_type}")


def extract_actions(computer_call: dict[str, Any]) -> list[dict[str, Any]]:
    actions = computer_call.get("actions")
    if isinstance(actions, list) and actions:
        return [action for action in actions if isinstance(action, dict) and action.get("type")]

    action = computer_call.get("action")
    if isinstance(action, dict) and action.get("type"):
        return [action]

    return [{"type": "screenshot"}]
