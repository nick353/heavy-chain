import importlib.util
import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PROJECT_ROOT / "scripts/job_applications/normalize_user_action_artifacts.py"
SPEC = importlib.util.spec_from_file_location("normalize_user_action_artifacts", MODULE_PATH)
assert SPEC and SPEC.loader
normalizer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(normalizer)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def test_normalizer_resolves_security_and_non_auth_artifacts_without_user_tabs(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    _write_json(
        run_dir / "unresolved-user-action-tab-classification.json",
        {
            "items": [
                {
                    "path": str(run_dir / "captcha" / "02-user-action-tab-manifest.json"),
                    "state": "blocked_captcha_ready_for_user",
                    "markers": ["captcha", '"tab_policy": "preserve_for_user"'],
                },
                {
                    "path": str(run_dir / "unknown" / "02-user-action-tab-manifest.json"),
                    "state": "retryable",
                    "blocker": "unknown_required_fields_before_mutation",
                    "markers": ['"tab_policy": "preserve_for_user"', "unknown_required"],
                },
            ]
        },
    )

    result = normalizer.normalize(run_dir)

    assert result["final_user_action_count"] == 0
    assert result["resolved_non_user_action_count"] == 2
    final_manifest = json.loads((run_dir / "final-user-action-manifest.json").read_text(encoding="utf-8"))
    resolved_manifest = json.loads((run_dir / "resolved_non_user_action_artifacts.json").read_text(encoding="utf-8"))
    assert final_manifest["items"] == []
    resolutions = {item["resolution"] for item in resolved_manifest["items"]}
    assert "auth_or_verification_candidate_skip_not_user_action" in resolutions
    assert "non_auth_form_or_proof_blocker_not_user_action" in resolutions
