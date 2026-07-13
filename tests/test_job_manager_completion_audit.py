import importlib.util
import json
import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PROJECT_ROOT / "scripts/job_applications/validate_job_manager_completion_audit.py"
SPEC = importlib.util.spec_from_file_location("validate_job_manager_completion_audit", MODULE_PATH)
assert SPEC and SPEC.loader
completion_audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(completion_audit)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")


def _write_gmail_full_sweep(path: Path, count: int = 100) -> None:
    _write_json(
        path,
        {
            "workflow": "job-applications",
            "stage": "follow_up_gmail_full_sweep",
            "query_scope": "newer_than:14d -in:spam -in:trash latest 100 messages",
            "days": 14,
            "messages_read_count": count,
            "items": [
                {
                    "message_id": f"msg-{idx}",
                    "thread_id": f"thread-{idx}",
                    "classification": "noise",
                    "artifact_uri": str(path),
                }
                for idx in range(count)
            ],
        },
    )


def _write_full_target_summary(path: Path) -> None:
    _write_json(
        path,
        {
            "counts_scope": "fresh_submit_delta",
            "fresh_submitted_count_by_bucket": {"japan_targeted": 20, "overseas_global": 20},
            "submitted_count_by_bucket": {"japan_targeted": 41, "overseas_global": 40},
        },
    )


def _write_candidate_supply_proof(run_dir: Path) -> None:
    _write_json(
        run_dir / "candidate-supply" / "fresh-candidate-supply-summary.json",
        {
            "stage": "job_manager_candidate_supply_buffer_refresh",
            "ok": True,
            "bucket": "overseas_global",
            "supply_run_id": "test-supply-run",
            "source_existing_keys_sha256": "abc123",
            "existing_keys_count": 100,
            "buffer_ready_count": 17,
            "min_buffer_after_dedupe": 10,
            "duplicate_skipped_count": 4,
        },
    )


def _write_fresh_packet_validation_proof(run_dir: Path) -> None:
    _write_json(
        run_dir / "next-overseas-extension-resume-packet-validation.json",
        {
            "stage": "next_overseas_extension_resume_packet_validation",
            "ok": True,
            "failed_checks": [],
            "checks": [
                {"name": "fresh_supply_metadata_present", "ok": True},
                {"name": "source_existing_keys_sha256_matches", "ok": True},
                {"name": "candidate_keys_present_unique_and_not_in_latest_existing_keys", "ok": True},
            ],
        },
    )
    _write_json(
        run_dir / "current-overseas-packet-manifest.json",
        {"workflow": "job-applications", "stage": "current_overseas_packet_manifest"},
    )
    _write_json(
        run_dir / "current-overseas-packet-manifest-validation.json",
        {
            "stage": "job_manager_current_packet_manifest_validation",
            "ok": True,
            "failed_checks": [],
            "manifest_path": str(run_dir / "current-overseas-packet-manifest.json"),
            "checks": [
                {"name": "manifest_points_to_latest_existing_keys", "ok": True},
                {"name": "packet_generated_for_current_run", "ok": True},
                {"name": "candidate_keys_not_in_latest_existing_keys", "ok": True},
            ],
        },
    )
    (run_dir / "candidate-supply" / "skip-forward-outcomes.jsonl").write_text(
        '{"pipelineRow":{"state":"retryable","blocker_reason":"required_fields_unfilled_before_confirm","notes":"candidate_level_blocker; skip_forward=true"}}\n',
        encoding="utf-8",
    )


def test_completion_audit_accepts_extension_first_complete_run(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(
        run_dir / "extension-first-preflight.json",
        {"ok": True, "failed_checks": [], "checks": [{"name": "official_bridge_success_sync_contract", "ok": True}]},
    )
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed", "platform": "gmail", "exact_blocker": "none"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"submitted_confirmed","blocker_reason":"visible_submission_success"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10, "existing_keys": 8})
    _write_candidate_supply_proof(run_dir)
    _write_fresh_packet_validation_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_full_target_summary(run_dir / "summary.json")

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is True
    assert not result["failed_checks"]


def test_completion_audit_rejects_newer_preflight_failure_over_older_pass(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(
        run_dir / "extension-first-preflight-old.json",
        {"ok": True, "failed_checks": [], "checks": [{"name": "official_bridge_success_sync_contract", "ok": True}]},
    )
    _write_json(
        run_dir / "extension-first-preflight-new.json",
        {
            "ok": False,
            "failed_checks": [{"name": "official_bridge_success_sync_contract", "ok": False, "detail": "newer failure"}],
            "checks": [{"name": "official_bridge_success_sync_contract", "ok": False}],
        },
    )
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed", "platform": "gmail", "exact_blocker": "none"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"submitted_confirmed","blocker_reason":"visible_submission_success"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10, "existing_keys": 8})
    _write_candidate_supply_proof(run_dir)
    _write_fresh_packet_validation_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_full_target_summary(run_dir / "summary.json")

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is False
    assert any(check["name"] == "extension_first_preflight_ok" for check in result["failed_checks"])


def test_completion_audit_rejects_full_success_with_unresolved_user_action_tab(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"submitted_confirmed","blocker_reason":"visible_submission_success"}}\n',
        encoding="utf-8",
    )
    _write_json(
        run_dir / "receipts" / "user-action-lever" / "02-user-action-tab-manifest.json",
        {
            "stage": "official_job_trusted_bridge_user_action",
            "state": "needs_user_action",
            "tab_policy": "preserve_for_user",
        },
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10, "existing_keys": 8})
    _write_candidate_supply_proof(run_dir)
    _write_fresh_packet_validation_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_full_target_summary(run_dir / "summary.json")

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is False
    assert any(check["name"] == "no_unresolved_user_action_tabs_for_full_success" for check in result["failed_checks"])


def test_completion_audit_rejects_final_manifest_with_security_user_actions(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"submitted_confirmed","blocker_reason":"visible_submission_success"}}\n',
        encoding="utf-8",
    )
    _write_json(
        run_dir / "old" / "02-user-action-tab-manifest.json",
        {"state": "retryable", "tab_policy": "preserve_for_user", "blocker_reason": "unknown_required_fields_before_mutation"},
    )
    _write_json(
        run_dir / "final-user-action-manifest.json",
        {"ok": True, "items": [{"state": "needs_user_action", "blocker_reason": "blocked_captcha_ready_for_user"}]},
    )
    _write_json(
        run_dir / "resolved_non_user_action_artifacts.json",
        {"ok": True, "items": [{"resolution": "non_auth_form_or_proof_blocker_not_user_action"}]},
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10, "existing_keys": 8})
    _write_candidate_supply_proof(run_dir)
    _write_fresh_packet_validation_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_full_target_summary(run_dir / "summary.json")

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is False
    assert any(check["name"] == "no_unresolved_user_action_tabs_for_full_success" for check in result["failed_checks"])


def test_completion_audit_rejects_final_manifest_with_non_security_user_action(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"submitted_confirmed","blocker_reason":"visible_submission_success"}}\n',
        encoding="utf-8",
    )
    _write_json(
        run_dir / "old" / "02-user-action-tab-manifest.json",
        {"state": "retryable", "tab_policy": "preserve_for_user", "blocker_reason": "unknown_required_fields_before_mutation"},
    )
    _write_json(
        run_dir / "final-user-action-manifest.json",
        {"ok": True, "items": [{"state": "retryable", "blocker_reason": "unknown_required_fields_before_mutation"}]},
    )
    _write_json(run_dir / "resolved_non_user_action_artifacts.json", {"ok": True, "items": []})
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10, "existing_keys": 8})
    _write_candidate_supply_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_full_target_summary(run_dir / "summary.json")

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is False
    assert any(check["name"] == "no_unresolved_user_action_tabs_for_full_success" for check in result["failed_checks"])


def test_completion_audit_rejects_missing_extension_receipt(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10})
    _write_candidate_supply_proof(run_dir)
    _write_fresh_packet_validation_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")

    result = completion_audit.validate(run_dir)

    assert result["ok"] is False
    assert any(check["name"] == "extension_official_job_receipt_or_exact_blocker" for check in result["failed_checks"])


def test_completion_audit_rejects_smoke_extension_artifacts_as_live_proof(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "trusted-command-no-agent-smoke" / "outcomes.jsonl").parent.mkdir(parents=True, exist_ok=True)
    (run_dir / "trusted-command-no-agent-smoke" / "outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"retryable","job_url":"https://example.com/jobs/smoke"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10})
    _write_candidate_supply_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")

    result = completion_audit.validate(run_dir)

    assert result["ok"] is False
    assert any(check["name"] == "extension_official_job_receipt_or_exact_blocker" for check in result["failed_checks"])


def test_completion_audit_rejects_full_target_with_only_exact_blocker_extension_proof(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-playwright-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_site_playwright_cli_real_chrome_adaptive","state":"retryable","blocker_reason":"required_fields_unfilled_before_confirm"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10})
    _write_candidate_supply_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_full_target_summary(run_dir / "summary.json")
    _write_json(
        run_dir / "next-overseas-extension-resume-packet-validation.json",
        {
            "stage": "next_overseas_extension_resume_packet_validation",
            "ok": True,
            "failed_checks": [],
            "checks": [
                {"name": "fresh_supply_metadata_present", "ok": True},
                {"name": "source_existing_keys_sha256_matches", "ok": True},
                {"name": "candidate_keys_present_unique_and_not_in_latest_existing_keys", "ok": True},
            ],
        },
    )
    _write_json(
        run_dir / "current-overseas-packet-manifest.json",
        {"workflow": "job-applications", "stage": "current_overseas_packet_manifest"},
    )
    _write_json(
        run_dir / "current-overseas-packet-manifest-validation.json",
        {
            "stage": "job_manager_current_packet_manifest_validation",
            "ok": True,
            "failed_checks": [],
            "manifest_path": str(run_dir / "current-overseas-packet-manifest.json"),
            "checks": [
                {"name": "manifest_points_to_latest_existing_keys", "ok": True},
                {"name": "packet_generated_for_current_run", "ok": True},
                {"name": "candidate_keys_not_in_latest_existing_keys", "ok": True},
            ],
        },
    )

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is False
    assert any(check["name"] == "extension_official_job_receipt_or_exact_blocker" for check in result["failed_checks"])


def test_completion_audit_rejects_trusted_no_agent_smoke_even_without_smoke_name(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "receipts").mkdir(parents=True, exist_ok=True)
    (run_dir / "receipts" / "outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"submitted_confirmed","blocker_reason":"visible_submission_success","job_url":"https://example.invalid/jobs/123","notes":"trusted-command-no-agent"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10})
    _write_candidate_supply_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_full_target_summary(run_dir / "summary.json")

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is False
    assert any(check["name"] == "extension_official_job_receipt_or_exact_blocker" for check in result["failed_checks"])


def test_completion_audit_accepts_real_success_proof_with_non_smoker_text(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_site_playwright_cli_real_chrome_adaptive","state":"submitted_confirmed","blocker_reason":"visible_submission_success","job_url":"https://job-boards.greenhouse.io/company/jobs/123","notes":"submitted with verified completion; non-smoker question answered safely"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10})
    _write_candidate_supply_proof(run_dir)
    _write_fresh_packet_validation_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_full_target_summary(run_dir / "summary.json")
    _write_json(run_dir / "final-user-action-manifest.json", {"ok": True, "items": []})
    _write_json(run_dir / "resolved_non_user_action_artifacts.json", {"ok": True, "items": []})

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is True


def test_completion_audit_accepts_resume_packet_validation_for_partial_run(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"retryable","blocker_reason":"trusted_chrome_runtime_unavailable"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10})
    _write_candidate_supply_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_json(
        run_dir / "next-overseas-extension-resume-packet-validation.json",
        {
            "stage": "next_overseas_extension_resume_packet_validation",
            "ok": True,
            "failed_checks": [],
            "checks": [
                {"name": "fresh_supply_metadata_present", "ok": True},
                {"name": "source_existing_keys_sha256_matches", "ok": True},
                {"name": "candidate_keys_present_unique_and_not_in_latest_existing_keys", "ok": True},
            ],
        },
    )
    _write_json(
        run_dir / "current-overseas-packet-manifest.json",
        {"workflow": "job-applications", "stage": "current_overseas_packet_manifest"},
    )
    _write_json(
        run_dir / "current-overseas-packet-manifest-validation.json",
        {
            "stage": "job_manager_current_packet_manifest_validation",
            "ok": True,
            "failed_checks": [],
            "manifest_path": str(run_dir / "current-overseas-packet-manifest.json"),
            "checks": [
                {"name": "manifest_points_to_latest_existing_keys", "ok": True},
                {"name": "packet_generated_for_current_run", "ok": True},
                {"name": "candidate_keys_not_in_latest_existing_keys", "ok": True},
            ],
        },
    )

    result = completion_audit.validate(run_dir)

    assert any(
        check["name"] == "overseas_resume_packet_validated_for_partial" and check["ok"]
        for check in result["checks"]
    )
    assert any(
        check["name"] == "current_overseas_packet_manifest_validated_for_partial" and check["ok"]
        for check in result["checks"]
    )


def test_completion_audit_rejects_missing_current_packet_manifest_for_partial_run(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"retryable","blocker_reason":"trusted_chrome_runtime_unavailable"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10})
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_json(
        run_dir / "next-overseas-extension-resume-packet-validation.json",
        {"stage": "next_overseas_extension_resume_packet_validation", "ok": True, "failed_checks": []},
    )

    result = completion_audit.validate(run_dir)

    assert result["ok"] is False
    assert any(
        check["name"] == "current_overseas_packet_manifest_validated_for_partial"
        for check in result["failed_checks"]
    )


def test_completion_audit_rejects_missing_gmail_full_sweep_artifact(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"submitted_confirmed","blocker_reason":"visible_submission_success"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10})
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_full_target_summary(run_dir / "summary.json")

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is False
    assert any(check["name"] == "gmail_full_sweep_min_100_or_exact_blocker" for check in result["failed_checks"])


def test_completion_audit_accepts_gmail_full_sweep_exact_blocker(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "follow-up" / "gmail-full-sweep-summary.json",
        {
            "workflow": "job-applications",
            "stage": "follow_up_gmail_full_sweep",
            "exact_blocker": "gmail_connector_quota_exhausted",
        },
    )

    result = completion_audit.validate(run_dir)

    assert any(
        check["name"] == "gmail_full_sweep_min_100_or_exact_blocker" and check["ok"]
        for check in result["checks"]
    )


def test_completion_audit_rejects_summary_only_follow_up_readback_gmail_scope(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "follow-up-readback-20260704.json",
        {
            "workflow": "job-applications",
            "stage": "follow_up_readback",
            "gmail_scope": {
                "query": "-in:spam -in:trash newer_than:14d",
                "pages_read": 4,
                "messages_read": 100,
                "cross_check": "newer_than:30d performed",
            },
        },
    )

    result = completion_audit.validate(run_dir)

    assert any(
        check["name"] == "gmail_full_sweep_min_100_or_exact_blocker" and not check["ok"]
        for check in result["checks"]
    )


def test_completion_audit_rejects_summary_only_follow_up_readback_even_when_marked_sweep(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "follow-up-readback-20260704.json",
        {
            "workflow": "job-applications",
            "stage": "follow_up_readback",
            "artifact_type": "gmail_full_sweep",
            "gmail_scope": {
                "query": "-in:spam -in:trash newer_than:14d latest 100 full sweep",
                "messages_read": 100,
            },
        },
    )

    result = completion_audit.validate(run_dir)

    assert any(
        check["name"] == "gmail_full_sweep_min_100_or_exact_blocker" and not check["ok"]
        for check in result["checks"]
    )


def test_completion_audit_accepts_follow_up_readback_with_100_classified_gmail_items(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "follow-up-readback-20260704.json",
        {
            "workflow": "job-applications",
            "stage": "follow_up_readback",
            "gmail_scope": {
                "query": "-in:spam -in:trash newer_than:14d",
                "pages_read": 4,
                "messages_read": 100,
            },
            "items": [
                {
                    "message_id": f"msg-{idx}",
                    "thread_id": f"thread-{idx}",
                    "sender": "sender@example.com",
                    "subject": f"subject {idx}",
                    "timestamp": "2026-07-04T00:00:00+00:00",
                    "classification": "noise",
                    "reason": "classified during bounded full sweep",
                    "artifact_uri": str(run_dir / "follow-up-readback-20260704.json"),
                }
                for idx in range(100)
            ],
        },
    )

    result = completion_audit.validate(run_dir)

    assert any(
        check["name"] == "gmail_full_sweep_min_100_or_exact_blocker" and check["ok"]
        for check in result["checks"]
    )


def test_completion_audit_rejects_follow_up_readback_with_unclassified_gmail_items(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "follow-up-readback-20260704.json",
        {
            "workflow": "job-applications",
            "stage": "follow_up_readback",
            "gmail_scope": {
                "query": "-in:spam -in:trash newer_than:14d",
                "messages_read": 100,
            },
            "items": [{} for _ in range(100)],
        },
    )

    result = completion_audit.validate(run_dir)

    assert any(
        check["name"] == "gmail_full_sweep_min_100_or_exact_blocker" and not check["ok"]
        for check in result["checks"]
    )


def test_completion_audit_rejects_follow_up_readback_without_thread_ids(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "follow-up-readback-20260704.json",
        {
            "workflow": "job-applications",
            "stage": "follow_up_readback",
            "gmail_scope": {
                "query": "-in:spam -in:trash newer_than:14d",
                "messages_read": 100,
            },
            "items": [
                {"message_id": f"msg-{idx}", "classification": "noise"}
                for idx in range(100)
            ],
        },
    )

    result = completion_audit.validate(run_dir)

    assert any(
        check["name"] == "gmail_full_sweep_min_100_or_exact_blocker" and not check["ok"]
        for check in result["checks"]
    )


def test_completion_audit_rejects_follow_up_readback_with_unknown_classification(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "follow-up-readback-20260704.json",
        {
            "workflow": "job-applications",
            "stage": "follow_up_readback",
            "gmail_scope": {
                "query": "-in:spam -in:trash newer_than:14d",
                "messages_read": 100,
            },
            "items": [
                {"message_id": f"msg-{idx}", "thread_id": f"thread-{idx}", "classification": "unknown"}
                for idx in range(100)
            ],
        },
    )

    result = completion_audit.validate(run_dir)

    assert any(
        check["name"] == "gmail_full_sweep_min_100_or_exact_blocker" and not check["ok"]
        for check in result["checks"]
    )


def test_completion_audit_rejects_inherited_counts_without_fresh_submit_delta(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"submitted_confirmed","blocker_reason":"visible_submission_success"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10, "existing_keys": 8})
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_json(
        run_dir / "summary.json",
        {"submitted_count_by_bucket": {"japan_targeted": 21, "overseas_global": 20}},
    )

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is False
    assert any(check["name"] == "split_target_20_20_proven" for check in result["failed_checks"])


def test_completion_audit_prefers_newest_packet_validation_failure_over_older_pass(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": []})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}]},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"submitted_confirmed","blocker_reason":"visible_submission_success"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10, "existing_keys": 8})
    _write_candidate_supply_proof(run_dir)
    _write_json(run_dir / "current-overseas-packet-manifest.json", {"workflow": "job-applications", "stage": "current_overseas_packet_manifest"})
    older_validation = run_dir / "current-overseas-packet-manifest-validation-old.json"
    newer_validation = run_dir / "current-overseas-packet-manifest-validation-new.json"
    _write_json(
        older_validation,
        {
            "stage": "job_manager_current_packet_manifest_validation",
            "ok": True,
            "failed_checks": [],
            "manifest_path": str(run_dir / "current-overseas-packet-manifest.json"),
            "checks": [
                {"name": "manifest_points_to_latest_existing_keys", "ok": True},
                {"name": "packet_generated_for_current_run", "ok": True},
                {"name": "candidate_keys_not_in_latest_existing_keys", "ok": True},
            ],
        },
    )
    _write_json(
        newer_validation,
        {
            "stage": "job_manager_current_packet_manifest_validation",
            "ok": False,
            "failed_checks": [{"name": "candidate_keys_not_in_latest_existing_keys", "ok": False}],
            "manifest_path": str(run_dir / "current-overseas-packet-manifest.json"),
            "checks": [
                {"name": "manifest_points_to_latest_existing_keys", "ok": True},
                {"name": "packet_generated_for_current_run", "ok": True},
                {"name": "candidate_keys_not_in_latest_existing_keys", "ok": False},
            ],
        },
    )
    os.utime(older_validation, (1, 1))
    os.utime(newer_validation, (2, 2))
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_full_target_summary(run_dir / "summary.json")

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is False
    assert any(check["name"] == "current_overseas_packet_manifest_validated_for_partial" for check in result["failed_checks"])


def test_completion_audit_rejects_cross_run_artifact_run_id_mismatch(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(run_dir / "extension-first-preflight.json", {"ok": True, "failed_checks": [], "run_id": "other-run"})
    _write_json(
        run_dir / "platform-follow-up" / "platform-sweep-summary.json",
        {"items": [{"classification": "read_no_reply_needed"}], "run_id": "other-run"},
    )
    _write_gmail_full_sweep(run_dir / "follow-up" / "gmail-full-sweep-summary.json")
    (run_dir / "official-bridge-outcomes.jsonl").write_text(
        '{"pipelineRow":{"application_channel":"official_trusted_bridge","state":"submitted_confirmed","blocker_reason":"visible_submission_success"}}\n',
        encoding="utf-8",
    )
    _write_json(run_dir / "source-of-truth" / "existing-keys-final.json", {"pipeline_rows": 10, "existing_keys": 8, "run_id": "other-run"})
    _write_candidate_supply_proof(run_dir)
    _write_fresh_packet_validation_proof(run_dir)
    (run_dir / "cleanup-proof-final.txt").write_text("cleanup proof: no job-owned residual process remained\n", encoding="utf-8")
    _write_full_target_summary(run_dir / "summary.json")

    result = completion_audit.validate(run_dir, require_full_target=True)

    assert result["ok"] is False
    assert any(check["name"] == "run_artifacts_isolated_to_run_dir" for check in result["failed_checks"])
