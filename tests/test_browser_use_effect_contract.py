from __future__ import annotations

import importlib.machinery
import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

import pytest


HELPER = Path(__file__).resolve().parents[1] / "browser-use-cli/bin/codex-browser-use"
LOADER = importlib.machinery.SourceFileLoader("codex_browser_use_effect_contract", str(HELPER))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def descriptor() -> dict:
    return {
        "run_id": "run-effect-contract",
        "session": "session-effect-contract",
        "target_origins": ["https://example.com"],
        "tab_inventory": {"working_target_id": "target-working"},
        "navigation_epoch": 3,
        "effect_evidence": [],
        "effect_states": {},
    }


def test_effect_evidence_is_allowlisted_and_secret_free() -> None:
    value = descriptor()
    with patch.object(MODULE, "_write_recording_descriptor"):
        MODULE.persist_effect_evidence(
            {}, value, "/tmp/descriptor.json", "a" * 32, ["upload", "/private/secret/resume.pdf"],
            phase="intent_recorded", effect_state="pre-dispatch", target_text="Private form label",
        )
    entry = value["effect_evidence"][0]
    assert set(entry) == MODULE.EFFECT_EVIDENCE_ALLOWED_FIELDS
    encoded = json.dumps(value, sort_keys=True)
    assert "Private form label" not in encoded
    assert "/private/secret/resume.pdf" not in encoded
    assert "cookie" not in encoded.lower()
    assert "token" not in encoded.lower()
    assert entry["action_type"] == "upload"
    assert entry["effect_state"] == "pre-dispatch"


def test_dispatch_state_is_irreversible_and_ack_requires_same_binding() -> None:
    value = descriptor()
    operation_id = "b" * 32
    command = ["upload", "/tmp/resume.pdf"]
    with patch.object(MODULE, "_write_recording_descriptor"):
        MODULE.persist_effect_evidence(
            {}, value, "/tmp/descriptor.json", operation_id, command,
            phase="intent_recorded", effect_state="pre-dispatch",
        )
        MODULE.persist_effect_evidence(
            {}, value, "/tmp/descriptor.json", operation_id, command,
            phase="dispatch_started", effect_state="dispatch-started", ack_status="pending",
        )
        assert MODULE.effect_evidence_binding_matches(value, operation_id, command)
        value["navigation_epoch"] = 4
        assert not MODULE.effect_evidence_binding_matches(value, operation_id, command)
        with pytest.raises(MODULE.Blocker, match="browser_use_effect_ack_binding_mismatch"):
            MODULE.persist_effect_evidence(
                {}, value, "/tmp/descriptor.json", operation_id, command,
                phase="acknowledged", effect_state="acknowledged", ack_status="validated",
            )
        value["navigation_epoch"] = 3
        MODULE.persist_effect_evidence(
            {}, value, "/tmp/descriptor.json", operation_id, command,
            phase="unknown_effect", effect_state="unknown-effect", ack_status="missing",
            error_code="browser_use_recording_command_failed",
        )
        with pytest.raises(MODULE.Blocker, match="browser_use_effect_dispatch_start_replay"):
            MODULE.persist_effect_evidence(
                {}, value, "/tmp/descriptor.json", operation_id, command,
                phase="dispatch_started", effect_state="dispatch-started",
            )


def test_unknown_effect_cannot_be_acknowledged_or_replayed() -> None:
    value = descriptor()
    operation_id = "c" * 32
    with patch.object(MODULE, "_write_recording_descriptor"):
        MODULE.persist_effect_evidence(
            {}, value, "/tmp/descriptor.json", operation_id, ["click", "0"],
            phase="intent_recorded", effect_state="pre-dispatch",
        )
        MODULE.persist_effect_evidence(
            {}, value, "/tmp/descriptor.json", operation_id, ["click", "0"],
            phase="dispatch_started", effect_state="dispatch-started",
        )
        MODULE.persist_effect_evidence(
            {}, value, "/tmp/descriptor.json", operation_id, ["click", "0"],
            phase="unknown_effect", effect_state="unknown-effect", error_code="ack_timeout",
        )
        with pytest.raises(MODULE.Blocker, match="browser_use_effect_ack_without_dispatch"):
            MODULE.persist_effect_evidence(
                {}, value, "/tmp/descriptor.json", operation_id, ["click", "0"],
                phase="acknowledged", effect_state="acknowledged",
            )
