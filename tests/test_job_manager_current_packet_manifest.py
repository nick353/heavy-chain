import importlib.util
import hashlib
import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PROJECT_ROOT / "scripts/job_applications/validate_job_manager_current_packet_manifest.py"
SPEC = importlib.util.spec_from_file_location("validate_job_manager_current_packet_manifest", MODULE_PATH)
assert SPEC and SPEC.loader
manifest_validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(manifest_validator)


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _base_files(tmp_path: Path) -> Path:
    run_id = "20260710-133000-000000-feedbeef"
    run_dir = tmp_path / f"codex-app-job-application-manager-{run_id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    packet = run_dir / "packet.json"
    validation = run_dir / "packet-validation.json"
    preflight = run_dir / "preflight.json"
    cleanup = run_dir / "cleanup-proof.txt"
    manifest = run_dir / "manifest.json"
    existing_keys = run_dir / "existing-keys.json"
    _write_json(existing_keys, {"keys": ["official-existing"]})
    existing_sha = hashlib.sha256(existing_keys.read_bytes()).hexdigest()

    _write_json(
        packet,
        {
            "run_id": run_id,
            "generated_at_jst": "2026-07-04T20:00:00",
            "bucket": "overseas_global",
            "source_existing_keys_sha256": existing_sha,
            "source_of_truth_readback": {"latest_existing_keys_artifact": str(existing_keys)},
            "priority_retry_order": [
                {"rank": 1, "company": "Fresh Co", "job_id_or_canonical_key": "official-fresh-1"}
            ],
            "current_counts": {"japan_targeted": 0, "overseas_global": 0, "overseas_global_remaining": 1, "full_success": False},
        },
    )
    _write_json(
        validation,
        {
            "run_id": run_id,
            "ok": True,
            "failed_checks": [],
            "packet_path": str(packet.resolve()),
        },
    )
    _write_json(
        preflight,
        {
            "run_id": run_id,
            "checks": [
                {"name": "registered_store_matches_automation_toml", "ok": True},
                {"name": "overseas_resume_packet_validation_required", "ok": True},
                {"name": "ashby_chrome_plugin_profile2_primary", "ok": True},
                {"name": "public_official_ats_chrome_plugin_profile2_primary", "ok": True},
            ]
        },
    )
    cleanup.write_text("cleanup proof\nowned_processes_remaining=[]\n", encoding="utf-8")
    _write_json(
        manifest,
        {
            "run_id": run_id,
            "workflow": "job-applications",
            "stage": "current_overseas_packet_manifest",
            "current_packet": str(packet),
            "current_packet_validation": str(validation),
            "extension_first_preflight": str(preflight),
            "cleanup_proof": str(cleanup),
        },
    )
    return manifest


def test_current_packet_manifest_validates(tmp_path: Path) -> None:
    manifest = _base_files(tmp_path)

    result = manifest_validator.validate(manifest)

    assert result["ok"] is True
    assert not result["failed_checks"]


def test_current_packet_manifest_rejects_stale_existing_key_candidate(tmp_path: Path) -> None:
    manifest = _base_files(tmp_path)
    packet = manifest.parent / "packet.json"
    payload = json.loads(packet.read_text(encoding="utf-8"))
    payload["priority_retry_order"] = [{"rank": 1, "company": "Fresh Co", "job_id_or_canonical_key": "official-existing"}]
    _write_json(packet, payload)

    result = manifest_validator.validate(manifest)

    assert result["ok"] is False
    assert any(check["name"] == "candidate_keys_not_in_latest_existing_keys" for check in result["failed_checks"])


def test_current_packet_manifest_allows_proven_exhausted_partial_stop_only_with_flag(tmp_path: Path) -> None:
    manifest = _base_files(tmp_path)
    packet = manifest.parent / "packet.json"
    validation = manifest.parent / "packet-validation.json"
    payload = json.loads(packet.read_text(encoding="utf-8"))
    payload["priority_retry_order"] = [
        {"rank": 1, "company": "Fresh Co", "job_id_or_canonical_key": "official-fresh-1"},
        {"rank": 2, "company": "Fresh Two", "job_id_or_canonical_key": "official-fresh-2"},
        {"rank": 3, "company": "Fresh Three", "job_id_or_canonical_key": "official-fresh-3"},
    ]
    payload["current_counts"]["overseas_global_remaining"] = 17
    payload["buffer_refresh_summary"] = {
        "bucket": "overseas_global",
        "buffer_ready_count": 3,
        "candidate_supply_exhausted_by_bucket": True,
        "stop_reason": "candidate_supply_exhausted_after_discovery:overseas_global",
    }
    payload["exact_blocker"] = "candidate_supply_exhausted_after_discovery:overseas_global"
    _write_json(packet, payload)
    _write_json(
        validation,
        {
            "run_id": "20260710-133000-000000-feedbeef",
            "ok": True,
            "failed_checks": [],
            "packet_path": str(packet.resolve()),
        },
    )

    strict_result = manifest_validator.validate(manifest)
    partial_result = manifest_validator.validate(manifest, allow_exhausted_partial=True)

    assert strict_result["ok"] is False
    assert any(check["name"] == "packet_bucket_buffer_ready" for check in strict_result["failed_checks"])
    assert partial_result["ok"] is True
    assert not partial_result["failed_checks"]


def test_current_packet_manifest_rejects_unreadable_existing_keys_artifact(tmp_path: Path) -> None:
    manifest = _base_files(tmp_path)
    existing_keys = manifest.parent / "existing-keys.json"
    existing_keys.write_text("{not-json", encoding="utf-8")

    result = manifest_validator.validate(manifest)

    assert result["ok"] is False
    assert any(check["name"] == "manifest_points_to_latest_existing_keys" for check in result["failed_checks"])
    assert any(check["name"] == "candidate_keys_not_in_latest_existing_keys" for check in result["failed_checks"])


def test_current_packet_manifest_rejects_path_escape_reference(tmp_path: Path) -> None:
    manifest = _base_files(tmp_path)
    outside_packet = manifest.parent.parent / "escaped-packet.json"
    _write_json(
        outside_packet,
        {
            "run_id": "20260710-133000-000000-feedbeef",
            "generated_at_jst": "2026-07-04T20:00:00",
            "bucket": "overseas_global",
            "source_existing_keys_sha256": "deadbeef",
            "source_of_truth_readback": {"latest_existing_keys_artifact": str(manifest.parent / "existing-keys.json")},
            "priority_retry_order": [],
            "current_counts": {"japan_targeted": 0, "overseas_global": 0, "overseas_global_remaining": 1, "full_success": False},
        },
    )
    _write_json(
        manifest,
        {
                "workflow": "job-applications",
                "stage": "current_overseas_packet_manifest",
                "current_packet": str(outside_packet),
                "current_packet_validation": str(manifest.parent / "packet-validation.json"),
                "extension_first_preflight": str(manifest.parent / "preflight.json"),
                "cleanup_proof": str(manifest.parent / "cleanup-proof.txt"),
            },
        )

    result = manifest_validator.validate(manifest)

    assert result["ok"] is False
    assert any(
        check["name"] in {"manifest_references_stay_within_run_dir", "manifest_points_to_latest_existing_keys"}
        for check in result["failed_checks"]
    )


def test_current_packet_manifest_rejects_external_existing_keys_artifact(tmp_path: Path) -> None:
    manifest = _base_files(tmp_path)
    packet = manifest.parent / "packet.json"
    payload = json.loads(packet.read_text(encoding="utf-8"))
    outside_existing_keys = manifest.parent.parent / "escaped-existing-keys.json"
    _write_json(outside_existing_keys, {"keys": ["official-existing"]})
    payload["source_of_truth_readback"] = {"latest_existing_keys_artifact": str(outside_existing_keys)}
    payload["source_existing_keys_sha256"] = hashlib.sha256(outside_existing_keys.read_bytes()).hexdigest()
    _write_json(packet, payload)

    result = manifest_validator.validate(manifest)

    assert result["ok"] is False
    assert any(check["name"] == "manifest_references_stay_within_run_dir" for check in result["failed_checks"])


def test_current_packet_manifest_rejects_identity_free_artifact(tmp_path: Path) -> None:
    manifest = _base_files(tmp_path)
    packet = manifest.parent / "packet.json"
    payload = json.loads(packet.read_text(encoding="utf-8"))
    payload.pop("run_id", None)
    _write_json(packet, payload)

    result = manifest_validator.validate(manifest)

    assert result["ok"] is False
    assert any(check["name"] == "manifest_artifacts_share_expected_run_id" for check in result["failed_checks"])
