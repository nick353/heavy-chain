import importlib.util
import hashlib
import json
import argparse
from pathlib import Path
import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PROJECT_ROOT / "scripts/job_applications/validate_next_overseas_extension_resume_packet.py"
SPEC = importlib.util.spec_from_file_location("validate_next_overseas_extension_resume_packet", MODULE_PATH)
assert SPEC and SPEC.loader
packet_validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packet_validator)

BUILDER_PATH = PROJECT_ROOT / "scripts/job_applications/build_next_overseas_extension_resume_packet.py"
BUILDER_SPEC = importlib.util.spec_from_file_location("build_next_overseas_extension_resume_packet", BUILDER_PATH)
assert BUILDER_SPEC and BUILDER_SPEC.loader
packet_builder = importlib.util.module_from_spec(BUILDER_SPEC)
BUILDER_SPEC.loader.exec_module(packet_builder)


def _base_packet(tmp_path: Path) -> dict:
    source = tmp_path / "existing-keys.json"
    source.write_text(json.dumps({"keys": ["official-existing"]}) + "\n", encoding="utf-8")
    packet = {
        "workflow": "job-applications",
        "stage": "next_overseas_extension_resume_packet",
        "generated_at_jst": "2026-07-04T20:00:00",
        "bucket": "overseas_global",
        "source_existing_keys_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "buffer_refresh_summary": {
            "bucket": "overseas_global",
            "existing_keys_count": 1,
            "buffer_ready_count": 17,
            "duplicate_skipped_count": 2,
        },
        "exact_blocker": "overseas_global_target_unmet_and_chrome_plugin_public_ats_proof_missing",
        "current_counts": {
            "japan_targeted": 21,
            "japan_target": 20,
            "overseas_global": 3,
            "overseas_global_target": 20,
            "overseas_global_remaining": 17,
            "full_success": False,
        },
        "source_of_truth_readback": {
            "latest_existing_keys_artifact": str(source),
            "pipeline_rows": 2217,
            "existing_keys": 1994,
            "duplicate_keys": 88,
        },
        "required_before_live_submit": [
            ".venv/bin/python scripts/job_applications/validate_job_manager_extension_first.py --artifact <run_artifact_dir>/extension-first-preflight.json # Chrome Plugin/Profile 2 primary for public official ATS; Playwright only as discovery/diagnostic, never live submit",
            "follow-up readback first, including Gmail/Calendar and platform-internal inbox sweep validation",
        ],
        "required_for_full_success": [
            "Chrome Plugin public official ATS receipt or exact chrome_plugin_public_ats_unavailable_before_submit blocker for a real candidate",
            "Playwright CLI discovery/diagnostic artifact only; not accepted as live submit proof",
            "auth/account-backed Extension bridge receipt only for LinkedIn/account-backed/signup/login/platform inbox/auth-security handoff",
            "completion audit via validate_job_manager_completion_audit.py --require-full-target",
        ],
        "ashby_chrome_plugin_primary_live_proof_rule": {
            "accepted_markers": [
                "chrome_plugin_ashby_public_official_ats",
                "chrome_plugin_public_official_ats",
                "visible_submission_success",
                "submitted_confirmed",
                "auth_account_backed_extension_bridge",
                "official_job_auth_handoff",
            ],
            "not_accepted_as_live_proof": [
                "trusted-command-no-agent-smoke",
                "https://example.com/jobs/smoke",
                "public official ATS Extension-first without Chrome Plugin trusted runtime proof",
                "playwright_cli_public_official_ats_fallback",
                "Playwright CLI public official ATS diagnostic/fallback receipt",
            ],
        },
        "priority_retry_order": [
            {
                "rank": 1,
                "company": "WGSN",
                "role": "Japanese Language Specialist",
                "url": "https://jobs.lever.co/wgsn/3",
                "job_id_or_canonical_key": "official-wgsn-3",
                "reason": "Remote Japanese language role.",
                "required_lane": "Chrome Plugin public official ATS primary",
                "hard_stops": ["CAPTCHA", "OTP/security-code", "identity", "assessment/test", "unknown personal facts"],
            },
            {
                "rank": 2,
                "company": "RWS TrainAI",
                "role": "AI Data Specialist - Japanese",
                "url": "https://jobs.lever.co/rws/4",
                "job_id_or_canonical_key": "official-rws-4",
                "reason": "Remote Japanese AI data role.",
                "required_lane": "Chrome Plugin public official ATS primary",
                "hard_stops": [
                    "CAPTCHA",
                    "OTP/security-code",
                    "identity",
                    "assessment/test",
                    "tax/payment/contract status",
                    "unknown personal facts",
                ],
            },
            {
                "rank": 3,
                "company": "Anyone AI",
                "role": "Full-Stack Developer (Japan)",
                "url": "https://jobs.ashbyhq.com/anyone-ai/5/application",
                "job_id_or_canonical_key": "official-anyone-5",
                "reason": "High hourly signal, retry only with completion proof.",
                "required_lane": "Chrome Plugin Ashby public official ATS primary",
                "hard_stops": ["CAPTCHA", "OTP/security-code", "identity", "assessment/test", "unknown personal facts"],
            },
        ],
    }
    for rank in range(4, 18):
        packet["priority_retry_order"].append(
            {
                "rank": rank,
                "company": f"Buffer Company {rank}",
                "role": f"Remote Growth Candidate {rank}",
                "url": f"https://jobs.lever.co/buffer/{rank}",
                "job_id_or_canonical_key": f"official-buffer-{rank}",
                "reason": "Buffer candidate keeps the overseas/global continuation from stopping after only three retries.",
                "required_lane": "Chrome Plugin public official ATS primary",
                "hard_stops": ["CAPTCHA", "OTP/security-code", "identity", "assessment/test", "unknown personal facts"],
            }
        )
    return packet


def test_next_overseas_extension_resume_packet_validates(tmp_path: Path) -> None:
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(json.dumps(_base_packet(tmp_path), ensure_ascii=False), encoding="utf-8")

    result = packet_validator.validate(packet_path)

    assert result["ok"] is True
    assert not result["failed_checks"]


def test_next_overseas_extension_resume_packet_rejects_legacy_playwright_primary(tmp_path: Path) -> None:
    packet = _base_packet(tmp_path)
    packet["required_before_live_submit"] = [
        ".venv/bin/python scripts/job_applications/validate_job_manager_extension_first.py --artifact <run_artifact_dir>/extension-first-preflight.json # public official ATS Playwright CLI primary",
        "follow-up readback first, including Gmail/Calendar and platform-internal inbox sweep validation",
    ]
    packet["public_ats_playwright_primary_live_proof_rule"] = packet.pop("ashby_chrome_plugin_primary_live_proof_rule")
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(json.dumps(packet, ensure_ascii=False), encoding="utf-8")

    result = packet_validator.validate(packet_path)

    assert result["ok"] is False
    failed_names = {check["name"] for check in result["failed_checks"]}
    assert "requires_lane_separation_preflight" in failed_names
    assert "proof_rule_has_chrome_plugin_public_ats_primary_markers" in failed_names


def test_next_overseas_extension_resume_packet_rejects_missing_lane_split_primary_lane(tmp_path: Path) -> None:
    packet = _base_packet(tmp_path)
    packet["priority_retry_order"][0]["required_lane"] = "Extension /official-job first"
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(json.dumps(packet, ensure_ascii=False), encoding="utf-8")

    result = packet_validator.validate(packet_path)

    assert result["ok"] is False
    assert any(check["name"] == "priority_candidates_have_chrome_plugin_primary_lane_and_hard_stops" for check in result["failed_checks"])


def test_next_overseas_extension_resume_packet_rejects_stale_welo_prior_application_retry(tmp_path: Path) -> None:
    packet = _base_packet(tmp_path)
    packet["priority_retry_order"].insert(
        0,
        {
            "rank": 1,
            "company": "Welo Global",
            "role": "Japanese Bilingual Audio Specialist",
            "url": "https://jobs.lever.co/weloglobal/9eb47731-b33d-450a-854d-0472b2d2dd08",
            "reason": "Stale candidate that already reached prior_application_already_received.",
            "required_lane": "Chrome Plugin public official ATS primary",
            "hard_stops": ["CAPTCHA", "OTP/security-code", "identity", "assessment/test", "unknown personal facts"],
        },
    )
    for index, candidate in enumerate(packet["priority_retry_order"], start=1):
        candidate["rank"] = index
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(json.dumps(packet, ensure_ascii=False), encoding="utf-8")

    result = packet_validator.validate(packet_path)

    assert result["ok"] is False
    assert any(
        check["name"] == "priority_retry_order_skips_known_prior_applications"
        for check in result["failed_checks"]
    )


def test_next_overseas_extension_resume_packet_rejects_existing_key_candidate(tmp_path: Path) -> None:
    packet = _base_packet(tmp_path)
    packet["priority_retry_order"][0]["job_id_or_canonical_key"] = "official-existing"
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(json.dumps(packet, ensure_ascii=False), encoding="utf-8")

    result = packet_validator.validate(packet_path)

    assert result["ok"] is False
    assert any(
        check["name"] == "candidate_keys_present_unique_and_not_in_latest_existing_keys"
        for check in result["failed_checks"]
    )


def test_next_overseas_extension_resume_packet_allows_proven_exhausted_partial_stop_only_with_flag(tmp_path: Path) -> None:
    packet = _base_packet(tmp_path)
    packet["priority_retry_order"] = packet["priority_retry_order"][:3]
    packet["buffer_refresh_summary"] = {
        "bucket": "overseas_global",
        "existing_keys_count": 1,
        "buffer_ready_count": 3,
        "duplicate_skipped_count": 2,
        "candidate_supply_exhausted_by_bucket": True,
        "stop_reason": "candidate_supply_exhausted_after_discovery:overseas_global",
    }
    packet["exact_blocker"] = (
            "overseas_global_target_unmet_and_chrome_plugin_public_ats_proof_missing;"
        "candidate_supply_exhausted_after_discovery:overseas_global"
    )
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(json.dumps(packet, ensure_ascii=False), encoding="utf-8")

    strict_result = packet_validator.validate(packet_path)
    partial_result = packet_validator.validate(packet_path, allow_exhausted_partial=True)

    assert strict_result["ok"] is False
    assert any(check["name"] == "candidate_buffer_covers_overseas_remaining" for check in strict_result["failed_checks"])
    assert partial_result["ok"] is True
    assert not partial_result["failed_checks"]


def test_build_next_overseas_extension_resume_packet_filters_unavailable_and_routes_ashby_to_chrome(tmp_path: Path) -> None:
    existing = tmp_path / "existing-keys.json"
    existing.write_text(json.dumps(["official-existing"]) + "\n", encoding="utf-8")
    summary = tmp_path / "summary.json"
    summary.write_text(
        json.dumps(
            {
                "candidate_supply_exhausted_by_bucket": True,
                "stop_reason": "candidate_supply_exhausted_after_discovery:overseas_global",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    candidates = tmp_path / "candidates.jsonl"
    candidates.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "pipelineRow": {
                            "company": "Unavailable",
                            "role": "Official careers page unavailable",
                            "job_url": "https://jobs.ashbyhq.com/unavailable",
                            "job_id_or_canonical_key": "official-unavailable",
                            "blocker_reason": "official_careers_page_unavailable",
                        }
                    }
                ),
                json.dumps(
                    {
                        "pipelineRow": {
                            "company": "Fresh Ashby",
                            "role": "Growth Lead",
                            "job_url": "https://jobs.ashbyhq.com/fresh/123",
                            "job_id_or_canonical_key": "official-fresh-ashby",
                            "blocker_reason": "official_application_discovered_needs_form_run",
                        }
                    }
                ),
                json.dumps(
                    {
                        "pipelineRow": {
                            "company": "Fresh Lever",
                            "role": "Content Lead",
                            "job_url": "https://jobs.lever.co/fresh/456",
                            "job_id_or_canonical_key": "official-fresh-lever",
                            "blocker_reason": "official_application_discovered_needs_form_run",
                        }
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    packet = packet_builder.build(
        argparse.Namespace(
            existing_keys_json=existing,
            summary_json=summary,
            candidates_jsonl=candidates,
            japan_submitted=0,
            overseas_submitted=4,
            japan_target=20,
            overseas_target=20,
            pipeline_rows=10,
            duplicate_keys=0,
        )
    )

    assert [candidate["company"] for candidate in packet["priority_retry_order"]] == ["Fresh Ashby", "Fresh Lever"]
    assert packet["priority_retry_order"][0]["required_lane"] == "Chrome Plugin Ashby public official ATS primary"
    assert packet["priority_retry_order"][1]["required_lane"] == "Chrome Plugin public official ATS primary"
    assert packet["current_counts"]["overseas_global_remaining"] == 16


def test_build_next_overseas_extension_resume_packet_dedupes_same_company_role_across_urls(tmp_path: Path) -> None:
    existing = tmp_path / "existing-keys.json"
    existing.write_text(json.dumps([]) + "\n", encoding="utf-8")
    summary = tmp_path / "summary.json"
    summary.write_text(json.dumps({"candidate_supply_exhausted_by_bucket": False}) + "\n", encoding="utf-8")
    candidates = tmp_path / "candidates.jsonl"
    candidates.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "pipelineRow": {
                            "company": "Automattic",
                            "role": "Senior Content Marketing Strategist, WordPress VIPRemote",
                            "job_url": "https://job-boards.greenhouse.io/automatticcareers/jobs/7946400",
                            "job_id_or_canonical_key": "official-greenhouse-automattic-7946400",
                            "blocker_reason": "official_application_discovered_needs_form_run",
                        }
                    }
                ),
                json.dumps(
                    {
                        "pipelineRow": {
                            "company": "Automattic",
                            "role": "Senior Content Marketing Strategist, WordPress VIP",
                            "job_url": "https://automattic.com/work-with-us/job/senior-content-marketing-strategist-wordpress-vip",
                            "job_id_or_canonical_key": "official-automattic-content-marketing",
                            "blocker_reason": "official_application_discovered_needs_form_run",
                        }
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    packet = packet_builder.build(
        argparse.Namespace(
            existing_keys_json=existing,
            summary_json=summary,
            candidates_jsonl=candidates,
            japan_submitted=0,
            overseas_submitted=0,
            japan_target=20,
            overseas_target=20,
            pipeline_rows=2,
            duplicate_keys=0,
        )
    )

    assert len(packet["priority_retry_order"]) == 1


def test_build_next_overseas_extension_resume_packet_fails_when_existing_keys_unreadable(tmp_path: Path) -> None:
    existing = tmp_path / "existing-keys.json"
    existing.write_text("{not-json", encoding="utf-8")
    summary = tmp_path / "summary.json"
    summary.write_text(json.dumps({"candidate_supply_exhausted_by_bucket": True}) + "\n", encoding="utf-8")
    candidates = tmp_path / "candidates.jsonl"
    candidates.write_text("", encoding="utf-8")

    with pytest.raises(json.JSONDecodeError):
        packet_builder.build(
            argparse.Namespace(
                existing_keys_json=existing,
                summary_json=summary,
                candidates_jsonl=candidates,
                japan_submitted=0,
                overseas_submitted=0,
                japan_target=20,
                overseas_target=20,
                pipeline_rows=0,
                duplicate_keys=0,
            )
        )


def test_next_overseas_extension_resume_packet_rejects_unreadable_existing_keys_artifact(tmp_path: Path) -> None:
    packet = _base_packet(tmp_path)
    source = Path(packet["source_of_truth_readback"]["latest_existing_keys_artifact"])
    source.write_text("{not-json", encoding="utf-8")
    packet["source_existing_keys_sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(json.dumps(packet, ensure_ascii=False), encoding="utf-8")

    result = packet_validator.validate(packet_path)

    assert result["ok"] is False
    assert any(check["name"] == "source_of_truth_existing_keys_readable" for check in result["failed_checks"])
    assert any(
        check["name"] == "candidate_keys_present_unique_and_not_in_latest_existing_keys"
        for check in result["failed_checks"]
    )
