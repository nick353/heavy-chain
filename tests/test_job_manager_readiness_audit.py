import importlib.util
import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PROJECT_ROOT / "scripts/job_applications/validate_job_manager_readiness_audit.py"
SPEC = importlib.util.spec_from_file_location("validate_job_manager_readiness_audit", MODULE_PATH)
assert SPEC and SPEC.loader
readiness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readiness)


def _touch(path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}\n", encoding="utf-8")
    return str(path)


def _audit(tmp_path: Path) -> dict:
    return {
        "workflow": "job-applications",
        "stage": "job_manager_extension_readiness_audit",
        "ready_for_next_run": True,
        "goal_complete": False,
        "exact_blocker": "chrome_plugin_public_ats_proof_obtained_but_overseas_global_20_20_missing",
        "confirmed": {
            "registered_automation_active": True,
            "registered_automation_cwd": "/Users/nichikatanaka/Documents/New project",
            "registered_prompt_contains_ashby_chrome_plugin_primary": True,
            "registered_prompt_contains_public_official_ats_chrome_plugin_primary": True,
            "registered_prompt_contains_preflight": True,
            "registered_prompt_contains_completion_audit": True,
            "registered_prompt_contains_resume_packet_validator": True,
            "registered_prompt_contains_readiness_validator": True,
            "extension_first_preflight_ok": True,
            "completion_audit_present": True,
            "resume_packet_validation_ok": True,
            "source_of_truth_readback_present": True,
            "cleanup_proof_present": True,
            "lever_prior_application_handled": True,
            "chrome_plugin_public_ats_candidate_proof_present": True,
        },
        "counts": {
            "japan_targeted": 21,
            "japan_target": 20,
            "overseas_global": 3,
            "overseas_global_target": 20,
            "overseas_global_remaining": 17,
        },
        "latest_artifacts": {
            "preflight": _touch(tmp_path / "preflight.json"),
            "completion_audit": _touch(tmp_path / "completion.json"),
            "resume_packet": _touch(tmp_path / "packet.json"),
            "resume_packet_validation": _touch(tmp_path / "packet-validation.json"),
            "source_of_truth_readback": _touch(tmp_path / "source.json"),
        },
        "completion_audit_failed_checks": [
            "split_target_20_20_proven",
        ],
        "next_run_order": [
            "follow-up readback first, including Gmail/Calendar and platform-internal inbox sweep validation",
            "run lane-separation scheduled preflight",
            "validate next overseas/global resume packet if used",
            "export/read back source-of-truth for dedupe",
            "continue overseas/global via public official ATS Chrome Plugin/Profile 2 primary; Gmail plugin for mail reading; Playwright diagnostic/fallback only",
            "run completion audit before final report",
            "write cleanup proof",
        ],
        "priority_retry_order": ["WGSN Japanese Language Specialist", "RWS TrainAI AI Data Specialist - Japanese", "Anyone AI"],
        "non_completion_reason": "Chrome Plugin public ATS proof is now present; overseas/global 20/20 is still missing, and unresolved user-action tab clearance remains non-completion proof.",
    }


def test_readiness_audit_validates_ready_not_complete_state(tmp_path: Path) -> None:
    path = tmp_path / "readiness.json"
    path.write_text(json.dumps(_audit(tmp_path), ensure_ascii=False), encoding="utf-8")

    result = readiness.validate(path)

    assert result["ok"] is True
    assert not result["failed_checks"]


def test_readiness_audit_rejects_goal_complete_without_required_state(tmp_path: Path) -> None:
    payload = _audit(tmp_path)
    payload["goal_complete"] = True
    path = tmp_path / "readiness.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    result = readiness.validate(path)

    assert result["ok"] is False
    assert any(check["name"] == "goal_complete_false" for check in result["failed_checks"])
