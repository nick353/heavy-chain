import importlib.util
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = PROJECT_ROOT / "scripts/job_applications"
sys.path.insert(0, str(SCRIPTS_DIR))
MODULE_PATH = SCRIPTS_DIR / "run_adaptive_official_job_apply.py"
SPEC = importlib.util.spec_from_file_location("run_adaptive_official_job_apply", MODULE_PATH)
assert SPEC and SPEC.loader
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)
HRMOS_RUNNER_TEXT = (SCRIPTS_DIR / "run_hrmos_detailed_profile_apply.py").read_text(encoding="utf-8")
ADAPTIVE_RUNNER_TEXT = MODULE_PATH.read_text(encoding="utf-8")
HRMOS_MODULE_PATH = SCRIPTS_DIR / "run_hrmos_detailed_profile_apply.py"
HRMOS_SPEC = importlib.util.spec_from_file_location("run_hrmos_detailed_profile_apply", HRMOS_MODULE_PATH)
assert HRMOS_SPEC and HRMOS_SPEC.loader
hrmos_runner = importlib.util.module_from_spec(HRMOS_SPEC)
sys.modules[HRMOS_SPEC.name] = hrmos_runner
HRMOS_SPEC.loader.exec_module(hrmos_runner)


def test_adaptive_runner_records_playwright_video_for_visual_qa_sidecar() -> None:
    assert "record_video_dir" in ADAPTIVE_RUNNER_TEXT
    assert 'Path(args.artifact_dir) / "playwright-video"' in ADAPTIVE_RUNNER_TEXT
    assert "owned_context" in ADAPTIVE_RUNNER_TEXT
    assert "never_close_browser_window" in ADAPTIVE_RUNNER_TEXT


def test_final_pre_submit_review_keeps_prefill_readback_checks() -> None:
    assert "{**checks, **(confirm_checks if confirm_cta else direct_submit_checks)}" in ADAPTIVE_RUNNER_TEXT


def test_adaptive_runner_acquires_browser_context_without_early_context_manager_exit() -> None:
    assert "def acquire_job_browser_context" in ADAPTIVE_RUNNER_TEXT
    assert "context, browser_blocker, owned_context, cdp_browser_handle = acquire_job_browser_context(playwright, args)" in ADAPTIVE_RUNNER_TEXT
    assert "with open_job_browser_context(playwright, args) as (context, browser_blocker, owned_context):" not in ADAPTIVE_RUNNER_TEXT


def test_adaptive_runner_cleans_public_ats_pages_after_incomplete_candidates() -> None:
    assert "reusable_job_working_page(context)" in ADAPTIVE_RUNNER_TEXT
    assert "context.new_page(), True" in ADAPTIVE_RUNNER_TEXT
    assert "close_created_tab_or_blank_reused_tab_on_incomplete_application" in ADAPTIVE_RUNNER_TEXT
    assert 'page_for_cleanup.goto("about:blank"' in ADAPTIVE_RUNNER_TEXT
    assert "page_for_cleanup.close()" in ADAPTIVE_RUNNER_TEXT
    assert "context_for_cleanup.close()" in ADAPTIVE_RUNNER_TEXT
    assert '"99-tab-cleanup-proof.json"' in ADAPTIVE_RUNNER_TEXT


def test_identity_hard_stop_is_deferred_until_after_prefill() -> None:
    blocking, deferred = runner.split_prefill_deferred_hard_stops(["identity_verification"])
    assert blocking == []
    assert deferred == ["identity_verification"]

    blocking, deferred = runner.split_prefill_deferred_hard_stops(["assessment_required", "identity_verification"])
    assert blocking == ["assessment_required"]
    assert deferred == ["identity_verification"]


def test_post_submit_validation_errors_extract_ashby_missing_fields() -> None:
    body = """
    Your form needs corrections
    Missing entry for required field: Which programming language (or library) would you like to use for your interview?
    Missing entry for required field: What is your domain expertise?
    """

    result = runner.post_submit_validation_errors(body)

    assert result["has_validation_error"] is True
    assert result["ok"] is False
    assert result["missing_required_fields"] == [
        "Which programming language (or library) would you like to use for your interview?",
        "What is your domain expertise?",
    ]


def test_lilt_native_speaker_language_field_uses_japanese_known_fact() -> None:
    field = SimpleNamespace(
        key="language",
        index=7,
        tag="input",
        type="text",
        label="What is your language of native speaker fluency?",
        required=True,
    )
    classified = {"language": [field]}

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message", "Japanese language role")

    language_action = next(item for item in plan if item["key"] == "language")
    assert language_action["value"] == "Japanese"
    assert any("Japanese" in option for option in language_action["options"])


def test_lever_japanese_fluency_select_targets_native_option() -> None:
    field = SimpleNamespace(
        key="language",
        index=19,
        tag="select",
        type="select",
        label="Japanese fluency | Select... Elementary - N5 Intermediate - N3 Fluent - N1 Native",
        required=True,
    )
    classified = {"language": [field]}

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message", "Japanese role")

    language_action = next(item for item in plan if item["key"] == "language")
    assert language_action["value"] == "Native"
    assert any("Native" in option for option in language_action["options"])


def test_language_select_readback_uses_selected_option_not_field_label() -> None:
    fields = [
        {
            "index": 0,
            "tag": "select",
            "type": "select",
            "label": "Japanese fluency | Select... Elementary - N5 Intermediate - N3 Fluent - N1 Native",
            "value": "",
            "options": [
                {"label": "Select...", "value": ""},
                {"label": "Native", "value": "native"},
            ],
        }
    ]
    matches = [SimpleNamespace(index=0)]

    assert runner.classified_text_or_select_answer_matches(fields, matches, [r"Japanese", r"日本語", r"native Japanese", r"\bNative\b"]) is False

    fields[0]["value"] = "native"
    assert runner.classified_text_or_select_answer_matches(fields, matches, [r"Japanese", r"日本語", r"native Japanese", r"\bNative\b"]) is True


def test_lilt_education_level_radio_group_uses_bachelors_known_fact() -> None:
    field = SimpleNamespace(
        key="degree",
        index=12,
        tag="input",
        type="radio",
        label="Bachelor's Degree (or equivalent) | Highest level of education completed?",
        required=False,
    )
    classified = {"degree": [field]}

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message", "Japanese language role")

    degree_action = next(item for item in plan if item["key"] == "degree")
    assert degree_action["kind"] == "known_fact"
    assert degree_action["value"] == runner.PROFILE["degree_en"]
    assert any("bachelor" in option.lower() for option in degree_action["options"])


def test_standard_gender_field_uses_male_known_fact() -> None:
    field = SimpleNamespace(
        key="gender",
        index=20,
        tag="input",
        type="radio",
        label="Gender | Male | Female",
        required=True,
    )
    classified = {"gender": [field]}

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message", "Japanese language role")

    gender_action = next(item for item in plan if item["key"] == "gender")
    assert gender_action["value"] == "Male"
    assert any("male" in option.lower() for option in gender_action["options"])


def test_lilt_gender_with_decline_option_still_uses_male_known_fact() -> None:
    field = SimpleNamespace(
        key="gender",
        index=25,
        tag="input",
        type="radio",
        label="Male | U.S. EQUAL EMPLOYMENT OPPORTUNITY INFORMATION (Completion is voluntary)\n\nGender\n\nInput gender\n\nMale\nFemale\nDecline to self-identify | Male | Input gender | Input gender",
        required=False,
    )
    classified = {"gender": [field]}

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message", "Japanese language role")

    gender_action = next(item for item in plan if item["key"] == "gender")
    assert gender_action["value"] == "Male"
    assert any("male" in option.lower() for option in gender_action["options"])


def test_gender_declines_only_for_clear_voluntary_eeoc_context() -> None:
    field = SimpleNamespace(
        key="gender",
        index=25,
        tag="input",
        type="radio",
        label="Gender | Voluntary EEOC demographic self-identification | Male | Female | Decline to self-identify",
        required=False,
    )
    classified = {"gender": [field]}

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message", "Japanese language role")

    gender_action = next(item for item in plan if item["key"] == "gender")
    assert gender_action["value"] == "Decline to self-identify"


def test_degree_readback_accepts_checked_bachelor_radio_group() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "radio",
            "name": "education_level",
            "label": "No formal education | Highest level of education completed?\nNo formal education\nBachelor's Degree",
            "value": "on",
            "checked": False,
        },
        {
            "index": 1,
            "tag": "input",
            "type": "radio",
            "name": "education_level",
            "label": "Bachelor's Degree (or equivalent) | Highest level of education completed?\nNo formal education\nBachelor's Degree",
            "value": "on",
            "checked": True,
        },
    ]
    matches = [
        SimpleNamespace(index=0, tag="input", type="radio", label=fields[0]["label"]),
    ]

    assert runner.degree_readback_matches(fields, matches, [field["value"] for field in fields]) is True


def test_gender_readback_requires_male_for_standard_gender_group() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "radio",
            "name": "gender",
            "label": "Male | Gender\n\nInput gender\n\nMale\nFemale\nDecline to self-identify | Male",
            "checked": True,
            "value": "on",
        },
        {
            "index": 1,
            "tag": "input",
            "type": "radio",
            "name": "gender",
            "label": "Decline to self-identify | Gender\n\nInput gender\n\nMale\nFemale\nDecline to self-identify",
            "checked": False,
            "value": "on",
        },
    ]
    matches = [SimpleNamespace(index=0, tag="input", type="radio", label=fields[0]["label"])]

    assert runner.gender_readback_matches(fields, matches) is True


def test_select_option_noops_when_current_value_already_matches(monkeypatch) -> None:
    field = SimpleNamespace(index=0, tag="select", type="select", label="Age")
    calls: list[str] = []

    class FakeLocator:
        def scroll_into_view_if_needed(self, timeout: int) -> None:
            calls.append("scroll")

        def select_option(self, value: str, timeout: int) -> None:
            calls.append(f"select:{value}")

    class FakeKeyboard:
        def press(self, key: str) -> None:
            calls.append(f"key:{key}")

    page = SimpleNamespace(keyboard=FakeKeyboard(), wait_for_timeout=lambda ms: calls.append(f"wait:{ms}"))
    monkeypatch.setattr(runner, "assert_field_signature_current", lambda page, field: None)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator())
    monkeypatch.setattr(
        runner,
        "capture_controls",
        lambda page: [
            {
                "tag": "select",
                "type": "select",
                "value": "25",
                "options": [{"label": "25 years old", "value": "25"}],
            }
        ],
    )

    runner.select_option(page, field, "25", ["25 years old"])

    assert calls == ["scroll"]


def test_select_first_matching_option_noops_when_current_value_already_matches(monkeypatch) -> None:
    field = SimpleNamespace(index=0, tag="select", type="select", label="Japanese fluency")
    calls: list[str] = []

    class FakeLocator:
        def scroll_into_view_if_needed(self, timeout: int) -> None:
            calls.append("scroll")

        def select_option(self, value: str, timeout: int) -> None:
            calls.append(f"select:{value}")

    page = SimpleNamespace(keyboard=SimpleNamespace(press=lambda key: calls.append(f"key:{key}")), wait_for_timeout=lambda ms: calls.append(f"wait:{ms}"))
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator())
    monkeypatch.setattr(
        runner,
        "capture_controls",
        lambda page: [
            {
                "tag": "select",
                "type": "select",
                "value": "native",
                "options": [{"label": "Native", "value": "native"}],
            }
        ],
    )

    assert runner.select_first_matching_option(page, field, [r"Native", r"Japanese"]) is True
    assert calls == ["scroll"]


def test_incomplete_application_runner_gaps_do_not_preserve_non_auth_tabs() -> None:
    for blocker in (
        "unknown_required_fields_before_mutation",
        "required_readback_missing_before_confirm",
        "required_fields_unfilled_before_confirm",
        "submit_completion_proof_missing",
        "confirm_page_not_verified",
    ):
        assert runner.should_preserve_tab_for_user("retryable", blocker) is False


def test_append_outcome_writes_issue_ledger_and_candidate_issue_record(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "candidate-proof"
    artifact_dir.mkdir()
    args = SimpleNamespace(
        outcomes_jsonl=str(tmp_path / "outcomes.jsonl"),
        discovered_at_jst="2026-07-04T10:00:00+09:00",
        company="OpenArt",
        role="Email Marketing Manager",
        job_url="https://example.com/jobs/openart-email",
        source_platform="official",
        job_key="openart-email-marketing-manager",
        priority_tier="A",
    )
    row = runner.pipeline_row(
        args,
        "needs_user_action",
        "post_submit_completion_proof_missing",
        "Inspect the preserved tab; do not count submitted.",
        f"url=https://example.com/thanks; proof_dir={artifact_dir}; previous_blocker=submit_completion_proof_missing",
    )

    runner.append_outcome(args, row)

    ledger_lines = (tmp_path / "issue-ledger.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(ledger_lines) == 1
    ledger = json.loads(ledger_lines[0])
    assert ledger["schema"] == "automation_issue_record.v1"
    assert ledger["workflow"] == "job_application_manager"
    assert ledger["blocker_reason"] == "post_submit_completion_proof_missing"
    assert ledger["policy"]["resubmit_allowed"] is False
    assert ledger["policy"]["next_safe_action"] == "read_only_reconciliation_then_next_candidate"
    candidate_record = json.loads((artifact_dir / "04-issue-record.json").read_text(encoding="utf-8"))
    assert candidate_record["job_id_or_canonical_key"] == "openart-email-marketing-manager"


def test_submitted_guard_read_failure_issue_policy_disallows_resubmit(tmp_path: Path) -> None:
    args = SimpleNamespace(
        outcomes_jsonl=str(tmp_path / "outcomes.jsonl"),
        discovered_at_jst="2026-07-04T10:00:00+09:00",
        company="Example",
        role="Lifecycle Marketer",
        job_url="https://example.com/jobs/123",
        source_platform="official",
        job_key="example-lifecycle-marketer",
        priority_tier="A",
    )
    row = runner.pipeline_row(
        args,
        "retryable",
        "submitted_confirmed_guard_read_failed",
        "Repair submitted-confirmed source-of-truth readback before retry.",
        "proof_dir=/tmp/missing-proof",
    )

    issue = runner.issue_record_from_outcome(args, row)

    assert issue["policy"]["resubmit_allowed"] is False
    assert issue["policy"]["next_safe_action"] == "restore_submitted_confirmed_readback_before_any_submit_retry"


def test_pre_input_plan_review_blocks_name_value_for_company_field() -> None:
    fields = [
        {
            "index": 36,
            "tag": "input",
            "type": "text",
            "required": False,
            "visible": True,
            "enabled": True,
            "label": "What is the name of your current company?",
            "value": "",
        }
    ]
    input_plan = [
        {
            "key": "name",
            "kind": "text",
            "field": {
                "index": 36,
                "tag": "input",
                "type": "text",
                "label": "What is the name of your current company?",
            },
            "value": "Nichika Tanaka",
        }
    ]

    review = runner.input_plan_review(fields, {"name": []}, input_plan, [], [], [])

    assert review["ok"] is False
    assert review["failures"][0]["type"] == "identity_value_planned_for_company_field_before_mutation"


def test_pre_input_plan_review_blocks_split_name_key_for_company_field() -> None:
    fields = [
        {
            "index": 2,
            "tag": "input",
            "type": "text",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "Current employer",
            "value": "",
        }
    ]
    input_plan = [
        {
            "key": "first_name",
            "kind": "text",
            "field": {"index": 2, "tag": "input", "type": "text", "label": "Current employer"},
            "value": "Nichika",
        }
    ]

    review = runner.input_plan_review(fields, {"first_name": []}, input_plan, [], [], [])

    assert review["ok"] is False
    assert review["failures"][0]["key"] == "first_name"
    assert review["failures"][0]["type"] == "identity_value_planned_for_company_field_before_mutation"


def test_pre_input_plan_review_blocks_identity_value_even_with_company_key() -> None:
    fields = [
        {
            "index": 4,
            "tag": "input",
            "type": "text",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "What is the name of your current company?",
            "value": "",
        }
    ]
    input_plan = [
        {
            "key": "company",
            "kind": "text",
            "field": {"index": 4, "tag": "input", "type": "text", "label": "What is the name of your current company?"},
            "value": "Nichika Tanaka",
        }
    ]

    review = runner.input_plan_review(fields, {"company": []}, input_plan, [], [], [])

    assert review["ok"] is False
    assert review["failures"][0]["key"] == "company"
    assert review["failures"][0]["type"] == "identity_value_planned_for_company_field_before_mutation"


def test_pre_input_plan_review_blocks_japanese_employer_label() -> None:
    fields = [
        {
            "index": 7,
            "tag": "input",
            "type": "text",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "現在の雇用主名",
            "value": "",
        }
    ]
    input_plan = [
        {
            "key": "last_name",
            "kind": "text",
            "field": {"index": 7, "tag": "input", "type": "text", "label": "現在の雇用主名"},
            "value": "Tanaka",
        }
    ]

    review = runner.input_plan_review(fields, {"last_name": []}, input_plan, [], [], [])

    assert review["ok"] is False
    assert review["failures"][0]["key"] == "last_name"
    assert review["failures"][0]["type"] == "identity_value_planned_for_company_field_before_mutation"


def test_adaptive_runner_writes_pre_input_form_survey_gate_before_mutation() -> None:
    assert "00-pre-input-form-survey.png" in ADAPTIVE_RUNNER_TEXT
    assert "00-input-plan-review.json" in ADAPTIVE_RUNNER_TEXT
    assert "pre_input_plan_review_failed_before_mutation" in ADAPTIVE_RUNNER_TEXT


def test_pre_input_plan_review_does_not_hide_existing_required_blockers() -> None:
    survey_index = ADAPTIVE_RUNNER_TEXT.index('write_pre_input_form_survey(page, artifact_dir, fields, classified, pre_input_plan, pre_input_review)')
    unsafe_index = ADAPTIVE_RUNNER_TEXT.index("if unsafe_required:", survey_index)
    user_only_index = ADAPTIVE_RUNNER_TEXT.index("if user_only_required:", unsafe_index)
    plan_review_index = ADAPTIVE_RUNNER_TEXT.index('if not pre_input_review["ok"]:', user_only_index)

    assert survey_index < unsafe_index < user_only_index < plan_review_index
    assert "unknown_required_fields_before_mutation" not in ADAPTIVE_RUNNER_TEXT


def test_build_input_plan_generates_answer_for_unknown_required_free_text() -> None:
    unknown_required = [
        {
            "index": 9,
            "tag": "textarea",
            "type": "textarea",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "Briefly describe a content system or publishing framework you built from scratch. What problem did it solve? (1-5 sentences)",
            "value": "",
        }
    ]

    plan = runner.build_input_plan(
        {},
        Path("/tmp/Nichika Tanaka＿Reume.pdf"),
        Path("/tmp/Nichika Tanaka＿Reume.pdf"),
        "message",
        "Head of Content Marketing",
        unknown_required,
    )

    generated = [item for item in plan if item["key"] == "generated_required_answer"]
    assert len(generated) == 1
    assert generated[0]["field"]["index"] == 9
    assert "content publishing workflow" in generated[0]["value"]
    assert "1.4 million" in generated[0]["value"]


def test_user_only_required_fields_include_jurisdiction_and_portfolio_evidence_gates() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "What is your current state of residence? (Note: We are only hiring U.S.-based employees for this role.)",
            "value": "",
        },
        {
            "index": 2,
            "tag": "textarea",
            "type": "textarea",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "Please provide links to 2-3 examples of marketing content that best represent your work.",
            "value": "",
        },
        {
            "index": 3,
            "tag": "input",
            "type": "checkbox",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "Are you willing to work from the required location?",
            "value": "",
        },
        {
            "index": 4,
            "tag": "input",
            "type": "text",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "Which U.S. state do you currently live in?",
            "value": "",
        },
        {
            "index": 5,
            "tag": "textarea",
            "type": "textarea",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "Please include portfolio links, writing samples, or examples of your work.",
            "value": "",
        },
        {
            "index": 6,
            "tag": "input",
            "type": "text",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "In what US state do you reside/plan to reside in the near future?",
            "value": "",
        },
    ]

    labels = [item["label"] for item in runner.user_only_required_fields(fields)]

    assert labels == [field["label"] for field in fields]


def test_pre_submit_reviewer_reviews_allowed_generated_required_answer() -> None:
    fields = [
        {
            "index": 0,
            "tag": "textarea",
            "type": "textarea",
            "required": True,
            "value": "At Perfect Corp., I helped build a repeatable SEO and content publishing workflow using keyword planning, UTM tracking, AI-assisted drafting, manual review, and performance readbacks. It contributed to monthly page views growing from 800,000 to 1.4 million.",
            "label": "Briefly describe a content system or publishing framework you built from scratch. What problem did it solve?",
        }
    ]

    result = runner.pre_submit_reviewer_result(
        fields,
        {},
        Path("/tmp/Nichika Tanaka＿Reume.pdf"),
        {},
    )

    generated = [review for review in result["question_reviews"] if review["key"] == "generated_required_answer"]
    assert result["ok"] is True
    assert generated[0]["risk_level"] == "medium"
    assert "resume-backed" in generated[0]["evidence_basis"]


def test_pre_submit_reviewer_blocks_unallowlisted_generated_required_answer() -> None:
    fields = [
        {
            "index": 0,
            "tag": "textarea",
            "type": "textarea",
            "required": True,
            "value": "I would investigate the funnel, segment users, and design an experiment.",
            "label": "A campaign is underperforming. What would you investigate first?",
        }
    ]

    result = runner.pre_submit_reviewer_result(
        fields,
        {},
        Path("/tmp/Nichika Tanaka＿Reume.pdf"),
        {},
    )

    assert result["ok"] is False
    assert result["failures"][0]["key"] == "generated_required_answer"
    assert result["failures"][0]["type"] == "high_risk_semantic_question_before_submit"


def test_user_only_blockers_are_closed_and_skipped_for_batch_action() -> None:
    assert runner.should_preserve_tab_for_user("blocked_captcha_ready_for_user", "blocked_captcha_ready_for_user") is False
    assert runner.should_preserve_tab_for_user("needs_user_review", "identity_verification_required") is False
    assert runner.should_preserve_tab_for_user("needs_user_action", "post_submit_auth_or_completion_check_required") is False


def test_hrmos_detailed_runner_records_playwright_video_for_visual_qa_sidecar() -> None:
    assert "connect_over_cdp" not in HRMOS_RUNNER_TEXT
    assert "job_playwright_lane_busy" in HRMOS_RUNNER_TEXT
    assert "record_video_dir" in HRMOS_RUNNER_TEXT
    assert 'artifact_dir / "playwright-video"' in HRMOS_RUNNER_TEXT
    assert "context_for_cleanup = context" in HRMOS_RUNNER_TEXT
    assert "finally:" in HRMOS_RUNNER_TEXT
    assert "context_for_cleanup.close()" in HRMOS_RUNNER_TEXT


class FakePage:
    def __init__(self, url: str, title: str = "応募が完了しました"):
        self.url = url
        self._title = title

    def title(self) -> str:
        return self._title

    def wait_for_timeout(self, timeout: int) -> None:
        return None


def test_completion_proof_accepts_herp_applied_url_without_application_id() -> None:
    page = FakePage("https://herp.careers/v1/example/job/applied")

    proof = runner.completion_proof(page, "応募が完了しました")

    assert proof["ok"] is True
    assert proof["application_id"] == ""
    assert proof["text_success"] is True
    assert proof["url_success"] is True


def test_build_input_plan_fills_english_name_pronunciation() -> None:
    classified = {
        "name_pronunciation": [
            SimpleNamespace(
                key="name_pronunciation",
                index=8,
                tag="input",
                type="text",
                label="So we can pronounce it correctly, what is the phonetic spelling of your name?",
                confidence=92,
            )
        ]
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")

    assert any(item["key"] == "name_pronunciation" and item["value"] == "Nichika Tanaka" for item in plan)


def test_build_input_plan_answers_age_confirmation_yes() -> None:
    classified = {
        "age": [
            SimpleNamespace(
                index=12,
                tag="input",
                type="radio",
                label="Yes | Are you at least 18 years of age?",
                confidence=90,
            )
        ]
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    age_item = next(item for item in plan if item["key"] == "age")
    assert age_item["kind"] == "known_fact"
    assert age_item["value"] == "Yes"


def test_build_input_plan_uses_japan_role_context_for_work_authorization() -> None:
    classified = {
        "work_authorization": [
            SimpleNamespace(
                index=18,
                tag="input",
                type="radio",
                label="Yes | Are you legally authorized to work in the country this role is located in?",
                confidence=90,
            )
        ],
        "visa_sponsorship": [
            SimpleNamespace(
                index=19,
                tag="input",
                type="radio",
                label="Yes | Will you now, or in the future, require sponsorship for employment visa status?",
                confidence=90,
            )
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message", "Japan Growth Lead")

    by_key = {item["key"]: item for item in plan}
    assert by_key["work_authorization"]["value"] == ""
    assert by_key["visa_sponsorship"]["value"] == "No"


def test_build_input_plan_handles_canals_ashby_yes_no_questions() -> None:
    classified = {
        "hubspot_experience": [
            SimpleNamespace(index=7, tag="input", type="checkbox", label="Yes\nNo | Do you have expert, hands-on experience with Hubspot CRM?", confidence=94)
        ],
        "role_experience_b2b_saas": [
            SimpleNamespace(index=8, tag="input", type="checkbox", label="Yes\nNo | Do you have experience in a B2B SaaS early-stage startup?", confidence=88)
        ],
        "role_experience_technical_integration": [
            SimpleNamespace(index=9, tag="input", type="checkbox", label="Yes\nNo | Do you have familiarity with technical integration options, e.g., APIs, webhooks?", confidence=88)
        ],
        "work_authorization": [
            SimpleNamespace(index=10, tag="input", type="checkbox", label="Yes\nNo | Do you currently have the legal right to work in the country where you are applying for this role?", confidence=90)
        ],
        "visa_sponsorship": [
            SimpleNamespace(index=11, tag="input", type="checkbox", label="Yes\nNo | Will you now or in the future require the company to sponsor a visa or work permit in order to work in this location?", confidence=90)
        ],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message", "Marketing Operations Manager")
    by_key = {item["key"]: item for item in plan}

    assert by_key["hubspot_experience"]["value"] == "No"
    assert by_key["role_experience_b2b_saas"]["value"] == "Yes"
    assert by_key["role_experience_technical_integration"]["value"] == "Yes"
    assert by_key["work_authorization"]["value"] == ""
    assert by_key["visa_sponsorship"]["value"] == "No"


def test_build_input_plan_handles_monthly_salary_and_est_hours() -> None:
    classified = {
        "expected_salary": [
            SimpleNamespace(index=36, tag="input", type="number", label="What is your expected monthly salary in USD for a full-time position (40 hours per week)?", confidence=90),
            SimpleNamespace(index=37, tag="input", type="number", label="What is your expected monthly salary in USD for a part-time position (20 hours per week)?", confidence=90),
        ],
        "timezone_us_eu_equivalent": [
            SimpleNamespace(index=39, tag="input", type="checkbox", label="Yes\nNo | Can you work from 9:00 AM to 5:00 PM EST?", confidence=90)
        ],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message", "Marketing Operations Manager")
    by_index = {item["field"]["index"]: item for item in plan}

    assert by_index[36]["value"] == "10000"
    assert by_index[37]["value"] == "5000"
    assert by_index[39]["value"] == "Yes"


def test_expected_salary_uses_usd_month_value_for_monthly_field() -> None:
    field = SimpleNamespace(index=9, tag="input", type="number", label="What is your salary expectation in USD/month?")

    assert runner.expected_salary_value_for_field(field) == "10000"


def test_expected_salary_uses_usd_hour_value_for_hourly_rate_field() -> None:
    field = SimpleNamespace(index=24, tag="input", type="text", label="What is your desired hourly rate in USD?")

    assert runner.expected_salary_value_for_field(field) == "75"


def test_build_input_plan_handles_lilt_prompt_engineering_and_expert_skill_questions() -> None:
    classified = {
        "role_experience_prompt_engineering": [
            SimpleNamespace(index=19, tag="input", type="checkbox", label="Prompt Engineering | Do you have previous work experience in any of the following fields?", confidence=92),
        ],
        "role_experience_expert_cli_python_shell": [
            SimpleNamespace(index=21, tag="input", type="checkbox", label="Yes\nNo | Do you have expert level experience in Python?", confidence=92),
            SimpleNamespace(index=22, tag="input", type="checkbox", label="Yes\nNo | Do you have expert level experience in Shell Scripting?", confidence=92),
            SimpleNamespace(index=23, tag="input", type="checkbox", label="Yes\nNo | Do you have expert level experience in CLI?", confidence=92),
        ],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message", "Japanese language role")
    by_index = {item["field"]["index"]: item for item in plan}

    assert by_index[19]["value"] == "Prompt Engineering"
    assert by_index[21]["value"] == "No"
    assert by_index[22]["value"] == "No"
    assert by_index[23]["value"] == "No"


def test_expected_salary_uses_zar_month_value_without_japanese_text() -> None:
    field = SimpleNamespace(
        index=6,
        tag="input",
        type="text",
        label="Expected Monthly Salary | Please provide your expected gross monthly salary with in ZAR, as this is essential to our selection process.",
    )

    assert runner.expected_salary_value_for_field(field) == "26000"


def test_build_input_plan_uses_english_start_availability() -> None:
    classified = {
        "job_change_timing": [
            SimpleNamespace(
                index=10,
                tag="input",
                type="text",
                label="When would you be available to start upon receiving an offer?",
                confidence=88,
            )
        ]
    }

    plan = runner.build_input_plan(classified, Path("/tmp/Nichika Tanaka＿Reume.pdf"), Path("/tmp/Nichika Tanaka＿Reume.pdf"), "message")

    item = next(item for item in plan if item["key"] == "job_change_timing")
    assert item["value"] == "Flexible / available anytime"


def test_build_input_plan_uses_english_start_availability_for_how_soon_question() -> None:
    classified = {
        "job_change_timing": [
            SimpleNamespace(
                index=7,
                tag="textarea",
                type="textarea",
                label="If you were to join OpenArt, how soon would you be able to start?",
                confidence=88,
            )
        ]
    }

    plan = runner.build_input_plan(classified, Path("/tmp/Nichika Tanaka＿Reume.pdf"), Path("/tmp/Nichika Tanaka＿Reume.pdf"), "message")

    item = next(item for item in plan if item["key"] == "job_change_timing")
    assert item["value"] == "Flexible / available anytime"


def test_build_input_plan_selects_working_hours_radio_as_full_time() -> None:
    classified = {
        "employment": [
            SimpleNamespace(
                index=8,
                tag="input",
                type="radio",
                label="Full time - 40 hours a week | Working Hours | Please share with us your available hours for work.",
                confidence=80,
            )
        ]
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")

    item = next(item for item in plan if item["key"] == "employment")
    assert item["kind"] == "known_fact"
    assert item["value"] == "Full time - 40 hours a week"


def test_build_input_plan_uses_yes_for_yes_no_digital_marketing_question() -> None:
    classified = {
        "role_experience_marketing_years": [
            SimpleNamespace(
                index=12,
                tag="input",
                type="checkbox",
                label="Yes\nNo | Have you got 3 years experience in marketing, overseeing content strategies and executing campaigns?",
                confidence=90,
            )
        ],
        "role_experience_digital_marketing": [
            SimpleNamespace(
                index=13,
                tag="input",
                type="checkbox",
                label="Yes\nNo | Are you proficiency in digital marketing tools, social media platforms, and marketing analytics.",
                confidence=88,
            ),
            SimpleNamespace(
                index=14,
                tag="input",
                type="checkbox",
                label="Yes\nNo | Have you got experience in marketing in the hospitality, food & beverage, or retail industry?",
                confidence=88,
            )
        ]
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")

    by_index = {item["field"]["index"]: item for item in plan}
    assert by_index[12]["value"] == "Yes"
    assert by_index[13]["value"] == "Yes"
    assert by_index[14]["value"] == "No"
    assert by_index[14]["options"][0] == r"^No$"


def test_prefill_checks_accepts_working_hours_radio_readback() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "radio",
            "checked": True,
            "label": "Full time - 40 hours a week | Working Hours | Please share with us your available hours for work.",
            "value": "on",
            "name": "working_hours",
        }
    ]
    classified = {
        "employment": [
            SimpleNamespace(
                index=0,
                tag="input",
                type="radio",
                label="Full time - 40 hours a week | Working Hours | Please share with us your available hours for work.",
            )
        ]
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["employment"] is True


def test_prefill_checks_accept_age_confirmation_yes() -> None:
    fields = [{"index": index, "tag": "input", "type": "text", "label": "", "value": ""} for index in range(13)]
    fields[12] = {
        "index": 12,
        "tag": "input",
        "type": "radio",
        "label": "Yes | Are you at least 18 years of age?",
        "name": "age",
        "checked": True,
        "value": "on",
    }
    classified = {"age": [SimpleNamespace(index=12, tag="input", type="radio", label=fields[12]["label"])]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["age"] is True


def test_prefill_checks_accepts_ashby_over_18_checkbox_readback() -> None:
    fields = [{"index": index, "tag": "input", "type": "text", "label": "", "value": ""} for index in range(7)]
    fields[6] = {
        "index": 6,
        "tag": "input",
        "type": "checkbox",
        "label": "Yes\nNo | Are you over the age of 18? | Are you over the age of 18?",
        "name": "ashby-age-confirmation",
        "checked": True,
        "value": "on",
    }
    classified = {"age": [SimpleNamespace(index=6, tag="input", type="checkbox", label=fields[6]["label"])]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["age"] is True


def test_prefill_checks_do_not_require_optional_demographic_readback() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "radio", "label": "Under 30 | What is your current age?", "checked": False, "required": False},
        {"index": 1, "tag": "input", "type": "radio", "label": "Man | What is your gender identity?", "checked": False, "required": False},
    ]
    classified = {
        "age": [SimpleNamespace(index=0, tag="input", type="radio", label=fields[0]["label"])],
        "gender": [SimpleNamespace(index=1, tag="input", type="radio", label=fields[1]["label"])],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["age"] is True
    assert checks["gender"] is True


def test_prefill_checks_do_not_require_optional_discovery_source_readback() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "text", "label": "How did you hear about this role?", "value": "", "required": False},
    ]
    classified = {"discovery_source": [SimpleNamespace(index=0, tag="input", type="text", label=fields[0]["label"])]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["discovery_source"] is True


def test_completion_proof_accepts_herp_applied_url_without_success_text() -> None:
    page = FakePage("https://herp.careers/v1/emuni/oUEuI0xNTo50/applied")

    proof = runner.completion_proof(page, "ご応募ありがとうございました")

    assert proof["ok"] is True
    assert proof["text_success"] is False
    assert proof["url_success"] is True


def test_completion_proof_accepts_hrmos_apply_thanks_url_without_success_text() -> None:
    page = FakePage("https://hrmos.co/pages/kasanare/jobs/Biz_L3-L4/apply/thanks")

    proof = runner.completion_proof(page, "ご応募ありがとうございました")

    assert proof["ok"] is True
    assert proof["text_success"] is False
    assert proof["url_success"] is True


def test_completion_proof_accepts_ashby_application_success_text() -> None:
    page = FakePage("https://jobs.ashbyhq.com/example/job/application", "Lifecycle Marketing Manager @ Example")

    proof = runner.completion_proof(page, "Application\nSuccess\nThank you for your application.")

    assert proof["ok"] is True
    assert proof["text_success"] is True


def test_completion_proof_accepts_ashby_application_received_text() -> None:
    page = FakePage("https://jobs.ashbyhq.com/example/job/application", "Lifecycle Marketing Manager @ Example")

    proof = runner.completion_proof(page, "Success\nThanks for applying to Example. Your application has been received.")

    assert proof["ok"] is True
    assert proof["text_success"] is True


def test_completion_proof_accepts_ashby_application_is_in_text() -> None:
    page = FakePage("https://jobs.ashbyhq.com/example/job/application", "Email Marketing Manager @ Example")

    proof = runner.completion_proof(page, "Application\nSuccess\nHi there, Your application is in, and we're glad you're here. We'll review it and reach out if there's a match.")

    assert proof["ok"] is True
    assert proof["text_success"] is True


def test_completion_proof_rejects_application_in_progress_text() -> None:
    page = FakePage("https://jobs.ashbyhq.com/example/job/application", "Email Marketing Manager @ Example")

    proof = runner.completion_proof(page, "Application is in progress. Please complete the remaining fields.")

    assert proof["ok"] is False
    assert proof["text_success"] is False


def test_completion_proof_rejects_reach_out_without_success_text() -> None:
    page = FakePage("https://jobs.ashbyhq.com/example/job/application", "Email Marketing Manager @ Example")

    proof = runner.completion_proof(page, "We'll review it and reach out if there's a match.")

    assert proof["ok"] is False
    assert proof["text_success"] is False


def test_completion_proof_rejects_generic_applied_url_without_success_text() -> None:
    page = FakePage("https://example.com/applied")

    proof = runner.completion_proof(page, "ご応募ありがとうございました")

    assert proof["ok"] is False
    assert proof["text_success"] is False
    assert proof["url_success"] is False


def test_completion_proof_rejects_generic_thanks_url_without_success_text() -> None:
    page = FakePage("https://company.example/jobs/thanks")

    proof = runner.completion_proof(page, "Thanks")

    assert proof["ok"] is False
    assert proof["text_success"] is False
    assert proof["url_success"] is False


def test_completion_proof_rejects_hard_stop_after_submit() -> None:
    page = FakePage("https://example.com/applied")

    proof = runner.completion_proof(page, "応募には確認コードが必要です")

    assert proof["ok"] is False


def test_completion_proof_rejects_success_text_with_security_code_marker() -> None:
    page = FakePage("https://example.com/applied")

    proof = runner.completion_proof(page, "応募が完了しました。続けるには確認コードを入力してください。")

    assert proof["ok"] is False
    assert "security_code_or_otp" in proof["hard_stop_markers"]


def test_hard_stop_markers_allow_photo_resume_identity_context() -> None:
    text = "履歴書・職務経歴書 必須 ※本人確認の観点から、写真付の履歴書をご提出ください。"

    assert "identity_verification" not in runner.hard_stop_markers(text)


def test_hard_stop_markers_still_reject_identity_verification_gate() -> None:
    text = "応募を続けるには本人確認と身分証の提出が必要です。"

    assert "identity_verification" in runner.hard_stop_markers(text)


def test_unsafe_required_fields_allow_photo_resume_identity_context() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "file",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "履歴書・職務経歴書 必須 ※本人確認の観点から、写真付の履歴書をご提出ください。",
        }
    ]

    assert runner.unsafe_required_fields(fields) == []


def test_unsafe_required_fields_still_reject_identity_document_gate() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "file",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": "本人確認のため身分証を提出してください。",
        }
    ]

    assert runner.unsafe_required_fields(fields)


def test_classify_job_change_reason_textarea() -> None:
    classified = runner.classify_fields(
        [
            {
                "index": 0,
                "tag": "textarea",
                "type": "textarea",
                "required": True,
                "visible": True,
                "enabled": True,
                "label": "転職検討理由\n必須",
            }
        ]
    )

    assert classified["job_change_reason"][0].index == 0


def test_build_input_plan_fills_job_change_reason() -> None:
    classified = {
        "job_change_reason": [
            SimpleNamespace(
                key="job_change_reason",
                index=0,
                tag="textarea",
                type="textarea",
                label="転職検討理由\n必須",
                confidence=90,
            )
        ]
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")

    assert plan[0]["key"] == "job_change_reason"
    assert plan[0]["value"] == runner.PROFILE["job_change_reason"]


def test_snap_records_snapshot_error_when_page_closes(tmp_path) -> None:
    class ClosedLocator:
        def inner_text(self, timeout: int) -> str:
            raise runner.PlaywrightError("Target page, context or browser has been closed")

    class ClosedPage:
        url = "https://jobs.example/apply"

        def locator(self, selector: str) -> ClosedLocator:
            assert selector == "body"
            return ClosedLocator()

    body = runner.snap(ClosedPage(), tmp_path, "03-after-submit")

    payload = json.loads((tmp_path / "03-after-submit.json").read_text(encoding="utf-8"))
    assert body == ""
    assert payload["snapshot_error"] == "Error"
    assert "Target page, context or browser has been closed" in payload["error"]
    assert payload["body"] == ""


def test_confirm_button_names_include_herp_review_cta() -> None:
    assert "入力内容を確認する" in runner.CONFIRM_BUTTON_NAMES


def test_unsafe_apply_cta_reason_blocks_submit_like_controls() -> None:
    assert runner.unsafe_apply_cta_reason({"tag": "BUTTON", "type": "submit", "text": "応募する"}) == "external_submit_like_cta"
    assert runner.unsafe_apply_cta_reason({"tag": "BUTTON", "in_form": True, "text": "Apply"}) == "external_submit_like_cta"
    assert runner.unsafe_apply_cta_reason({"tag": "A", "href": "mailto:jobs@example.com", "text": "Apply"}) == "unsafe_apply_link_scheme"
    assert runner.unsafe_apply_cta_reason({"tag": "BUTTON", "type": "button", "text": "応募する"}) == ""


def test_checked_option_has_requires_checked_matching_option() -> None:
    fields = [
        {"type": "radio", "checked": True, "label": "Yes", "value": "Yes"},
        {"type": "radio", "checked": False, "label": "No", "value": "No"},
    ]

    assert runner.checked_option_has(fields, [r"Yes"]) is True
    assert runner.checked_option_has(fields, [r"No"]) is False


def test_checked_option_has_uses_checkbox_candidate_not_full_yes_no_label() -> None:
    fields = [
        {"type": "checkbox", "checked": True, "label": "Do you require sponsorship? Yes No | No", "value": "No"},
    ]

    assert runner.checked_option_has(fields, [r"\bNo\b"]) is True
    assert runner.checked_option_has(fields, [r"\bYes\b"]) is False


def test_prefill_checks_require_consent_and_known_radio_readback() -> None:
    fields = [
        {"tag": "input", "type": "checkbox", "checked": False, "label": "個人情報の取り扱いに同意します", "value": "true"},
        {"tag": "input", "type": "radio", "checked": True, "label": "Visa sponsorship Yes", "value": "Yes", "name": "visa"},
        {"tag": "input", "type": "radio", "checked": True, "label": "Gender 女性", "value": "female", "name": "gender"},
    ]
    classified = {
        "consent": [SimpleNamespace(index=0)],
        "visa_sponsorship": [SimpleNamespace(index=1)],
        "gender": [SimpleNamespace(index=2)],
    }

    checks = runner.prefill_checks(fields, "履歴書＿田仲二千.pdf", "career.pdf", "message", classified)

    assert checks["consent"] is False
    assert checks["visa_sponsorship"] is False
    assert checks["gender"] is False


def test_prefill_checks_rejects_non_visible_privacy_consent() -> None:
    fields = [
        {"tag": "input", "type": "checkbox", "checked": False, "visible": False, "enabled": True, "label": "個人情報の取り扱いに同意します", "value": "true"},
    ]
    classified = {"consent": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "履歴書＿田仲二千.pdf", "career.pdf", "message", classified)

    assert checks["consent"] is False


def test_prefill_checks_scope_radio_readback_to_classified_group() -> None:
    fields = [
        {"tag": "input", "type": "radio", "checked": False, "label": "Are you legally authorized to work? Yes", "value": "Yes", "name": "work"},
        {"tag": "input", "type": "radio", "checked": True, "label": "Are you legally authorized to work? No", "value": "No", "name": "work"},
        {"tag": "input", "type": "radio", "checked": True, "label": "Can you start immediately? Yes", "value": "Yes", "name": "start"},
        {"tag": "input", "type": "radio", "checked": True, "label": "Will you require visa sponsorship? Yes", "value": "Yes", "name": "visa"},
        {"tag": "input", "type": "radio", "checked": False, "label": "Will you require visa sponsorship? No", "value": "No", "name": "visa"},
    ]
    classified = {
        "work_authorization": [SimpleNamespace(index=0)],
        "visa_sponsorship": [SimpleNamespace(index=3)],
    }

    checks = runner.prefill_checks(fields, "履歴書＿田仲二千.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is True
    assert checks["visa_sponsorship"] is False


def test_choose_radio_in_group_ignores_mixed_parent_label_for_candidate_match(monkeypatch) -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "radio", "name": "visa", "label": "Will you require visa sponsorship? Yes No", "value": "Yes", "text": ""},
        {"index": 1, "tag": "input", "type": "radio", "name": "visa", "label": "Will you require visa sponsorship? Yes No", "value": "No", "text": ""},
    ]
    checked_indexes: list[int] = []

    class FakeLocator:
        def __init__(self, index: int):
            self.index = index

        def check(self, timeout=None, force=None):
            checked_indexes.append(self.index)

    class FakePageForRadio:
        def wait_for_timeout(self, timeout):
            return None

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator(field.index))
    monkeypatch.setattr(runner, "checked_classified_option_has", lambda current_fields, matches, patterns: True)

    assert runner.choose_radio_in_group(FakePageForRadio(), SimpleNamespace(index=0), [r"No"]) is True
    assert checked_indexes == [1]


def test_radio_candidate_text_prefers_first_value_for_yes_no_pair_label() -> None:
    assert runner.radio_candidate_text({"label": "No | Yes", "value": "on", "text": "", "name": "work"}) == "No"
    assert runner.radio_candidate_text({"label": "Yes | No", "value": "on", "text": "", "name": "work"}) == "Yes"


def test_choose_radio_in_group_uses_hrmos_empty_name_candidate_label(monkeypatch) -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "radio", "name": "", "label": "男性 | 性別\n必須\n\t\n男性\n女性 | 男性", "value": "on", "text": ""},
        {"index": 1, "tag": "input", "type": "radio", "name": "", "label": "女性 | 性別\n必須\n\t\n男性\n女性 | 女性", "value": "on", "text": ""},
    ]
    checked_indexes: list[int] = []

    class FakeLocator:
        def __init__(self, index: int):
            self.index = index

        def check(self, timeout=None, force=None):
            checked_indexes.append(self.index)
            fields[self.index]["checked"] = True

    class FakePageForRadio:
        def wait_for_timeout(self, timeout):
            return None

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator(field.index))

    assert runner.choose_radio_in_group(FakePageForRadio(), SimpleNamespace(index=0), [r"男性", r"\bmale\b", r"男"]) is True
    assert checked_indexes == [0]


def test_fill_text_reacquires_locator_once_when_dom_detaches(monkeypatch) -> None:
    fields = [{"index": 0, "tag": "input", "type": "text", "label": "Name", "visible": True, "enabled": True}]
    calls = {"locator": 0, "wait": 0, "tab": 0}

    class FakeLocator:
        def __init__(self, attempt: int):
            self.attempt = attempt

        def scroll_into_view_if_needed(self, timeout=None):
            if self.attempt == 1:
                raise RuntimeError("Element is not attached to the DOM")

        def fill(self, value, timeout=None):
            assert value == "hello"

    class FakeKeyboard:
        def press(self, key):
            assert key == "Tab"
            calls["tab"] += 1

    class FakePage:
        keyboard = FakeKeyboard()

        def wait_for_timeout(self, timeout):
            calls["wait"] += 1

    def fake_locator(page, field):
        calls["locator"] += 1
        return FakeLocator(calls["locator"])

    monkeypatch.setattr(runner, "PlaywrightError", RuntimeError)
    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", fake_locator)

    runner.fill_text(FakePage(), SimpleNamespace(index=0, tag="input", type="text", label="Name"), "hello")

    assert calls["locator"] == 2
    assert calls["wait"] == 2
    assert calls["tab"] == 1


def test_fill_text_fails_closed_when_planned_label_changes(monkeypatch) -> None:
    fields = [{"index": 0, "tag": "input", "type": "text", "label": "Different field", "visible": True, "enabled": True}]

    class FakePage:
        pass

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)

    try:
        runner.fill_text(FakePage(), SimpleNamespace(index=0, tag="input", type="text", label="Name"), "hello")
    except RuntimeError as exc:
        assert "planned_field_signature_changed" in str(exc)
    else:
        raise AssertionError("fill_text should stop when the planned field label changes")


def test_fill_text_re_resolves_dynamic_greenhouse_index_by_primary_label(monkeypatch) -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "label": "Yes | Please acknowledge that you have read and agree to our Privacy Policy. *",
            "visible": True,
            "enabled": True,
        },
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "label": "LinkedIn Profile* | LinkedIn Profile* | LinkedIn Profile",
            "visible": True,
            "enabled": True,
        },
    ]
    filled: list[tuple[int, str]] = []

    class FakeLocator:
        def __init__(self, index: int):
            self.index = index

        def scroll_into_view_if_needed(self, timeout=None):
            return None

        def fill(self, value, timeout=None):
            filled.append((self.index, value))

    class FakeKeyboard:
        def press(self, key):
            assert key == "Tab"

    class FakePage:
        keyboard = FakeKeyboard()

        def wait_for_timeout(self, timeout):
            return None

    def fake_locator(page, field):
        return FakeLocator(field.index)

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", fake_locator)

    field = SimpleNamespace(
        index=0,
        tag="input",
        type="text",
        label="LinkedIn Profile* | LinkedIn Profile* | LinkedIn Profile* | LinkedIn Profile",
    )
    runner.fill_text(FakePage(), field, runner.PROFILE["linkedin_profile_url"])

    assert field.index == 1
    assert filled == [(1, runner.PROFILE["linkedin_profile_url"])]


def test_fill_known_fact_re_resolves_greenhouse_input_type_change_by_label(monkeypatch) -> None:
    fields = [
        {"index": index, "tag": "input", "type": "text", "label": f"Unrelated field {index}"}
        for index in range(13)
    ]
    fields[11] = {
        "index": 11,
        "tag": "input",
        "type": "text",
        "label": "What are your salary requirements?* | What are your salary requirements?",
        "visible": True,
        "enabled": True,
    }
    fields[12] = {
        "index": 12,
        "tag": "input",
        "type": "text",
        "label": "Are you authorised to work in Japan?* | Are you authorised to work in Japan?* Select...",
        "visible": True,
        "enabled": True,
    }
    chosen: list[tuple[int, list[str]]] = []

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)

    def fake_choose_visible_combobox_option(page, field, text_value, option_labels):
        chosen.append((field.index, list(option_labels)))
        return True

    monkeypatch.setattr(runner, "choose_visible_combobox_option", fake_choose_visible_combobox_option)

    field = SimpleNamespace(
        index=12,
        tag="input",
        type="input",
        label=(
            "Are you authorised to work in Japan?* | Are you authorised to work in Japan?* Select... | "
            "Are you authorised to work in Japan?"
        ),
    )

    assert runner.fill_or_choose_known_fact(object(), field, "Yes", ["Yes", "はい"]) is True
    assert field.index == 12
    assert chosen == [(12, ["Yes", "はい"])]


def test_resolve_current_field_index_uses_meaningful_question_segment_not_select_prefix() -> None:
    fields = [
        {"index": index, "tag": "input", "type": "text", "label": f"Unrelated field {index}"}
        for index in range(19)
    ]
    fields[12] = {
        "index": 12,
        "tag": "input",
        "type": "text",
        "label": "What are your salary requirements?* | What are your salary requirements?* This field is required.",
    }
    fields[17] = {
        "index": 17,
        "tag": "input",
        "type": "text",
        "label": "Are you authorised to work in Japan?* | Are you authorised to work in Japan?* Select...",
    }
    field = SimpleNamespace(
        index=12,
        tag="input",
        type="input",
        label=(
            "Select... | Are you authorised to work in Japan?* | "
            "Are you authorised to work in Japan?* Select... | Are you authorised to work in Japan?*"
        ),
    )

    assert runner.resolve_current_field_index(fields, field) == 17


def test_resolve_current_field_index_prefers_stable_name_over_label_match() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "text",
            "label": "Original label",
            "name": "other-field",
            "id": "",
        },
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "label": "Original label now includes validation text",
            "name": "stable-field",
            "id": "",
        },
    ]
    field = SimpleNamespace(
        index=0,
        tag="input",
        type="input",
        label="Original label",
        name="stable-field",
        id="",
    )

    assert runner.resolve_current_field_index(fields, field) == 1


def test_fill_text_prefers_stable_name_over_same_index_primary_label(monkeypatch) -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "text",
            "label": "Original label",
            "name": "other-field",
            "id": "",
            "visible": True,
            "enabled": True,
        },
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "label": "Original label now includes validation text",
            "name": "stable-field",
            "id": "",
            "visible": True,
            "enabled": True,
        },
    ]
    filled: list[tuple[int, str]] = []

    class FakeLocator:
        def __init__(self, index: int):
            self.index = index

        def scroll_into_view_if_needed(self, timeout=None):
            return None

        def fill(self, value, timeout=None):
            filled.append((self.index, value))

    class FakeKeyboard:
        def press(self, key):
            assert key == "Tab"

    class FakePage:
        keyboard = FakeKeyboard()

        def wait_for_timeout(self, timeout):
            return None

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator(field.index))

    field = SimpleNamespace(
        index=0,
        tag="input",
        type="input",
        label="Original label",
        name="stable-field",
        id="",
    )

    runner.fill_text(FakePage(), field, "safe value")

    assert field.index == 1
    assert filled == [(1, "safe value")]


def test_best_phone_match_prefers_tel_over_country_combobox() -> None:
    classified = {
        "phone": [
            SimpleNamespace(index=3, tag="input", type="text", label="Country | Phone\nCountry\nPhone"),
            SimpleNamespace(index=5, tag="input", type="tel", label="Phone | Phone\nCountry\nPhone"),
        ]
    }

    assert runner.best_phone_match(classified).index == 5


def test_control_locator_prefers_greenhouse_stable_id() -> None:
    calls: list[str] = []

    class FakeLocator:
        def __init__(self, selector: str):
            self.selector = selector

        @property
        def first(self):
            return self

        def count(self):
            return 1 if self.selector.startswith("input#degree--0") else 0

    class FakePage:
        def locator(self, selector: str):
            calls.append(selector)
            return FakeLocator(selector)

    locator = runner.control_locator(FakePage(), SimpleNamespace(index=8, id="degree--0"))

    assert locator.selector.startswith("input#degree--0")
    assert calls == ["input#degree--0, textarea#degree--0, select#degree--0"]


def test_greenhouse_degree_combobox_options_include_visible_bachelors_spelling() -> None:
    text = runner.MODULE_PATH.read_text(encoding="utf-8") if hasattr(runner, "MODULE_PATH") else ""
    assert "Bachelors Degree" in text or "Bachelors Degree" in Path(runner.__file__).read_text(encoding="utf-8")


def test_fill_text_allows_resume_upload_status_only_label_change(monkeypatch) -> None:
    planned_label = (
        "About you | About you To apply, please write something specifically for this position | "
        "Resume Upload File or drag and drop here | Type here..."
    )
    current_label = (
        "About you | About you To apply, please write something specifically for this position | "
        "Resume Nichika Tanaka＿Reume.pdf Replace or drag and drop here | Type here..."
    )
    fields = [{"index": 0, "tag": "textarea", "type": "textarea", "label": current_label, "visible": True, "enabled": True}]
    filled: list[str] = []

    class FakeLocator:
        def scroll_into_view_if_needed(self, timeout=None):
            return None

        def fill(self, value, timeout=None):
            filled.append(value)

    class FakeKeyboard:
        def press(self, key):
            assert key == "Tab"

    class FakePage:
        keyboard = FakeKeyboard()

        def wait_for_timeout(self, timeout):
            return None

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator())

    runner.fill_text(FakePage(), SimpleNamespace(index=0, tag="textarea", type="textarea", label=planned_label), "hello")

    assert filled == ["hello"]


def test_signature_label_preserves_upload_field_identity() -> None:
    assert runner.signature_label("Resume Upload File or drag and drop here") == "Resume"
    assert runner.signature_label("Resume Nichika Tanaka＿Reume.pdf Replace or drag and drop here") == "Resume"
    assert runner.signature_label("Cover Letter Upload File or drag and drop here") == "Cover Letter"


def test_execute_input_plan_tabs_residence_without_autocomplete_options(monkeypatch) -> None:
    fields = [{"index": 0, "tag": "input", "type": "input", "label": "e.g. Ottawa, Canada", "visible": True, "enabled": True}]
    keys: list[str] = []
    filled: list[str] = []

    class FakeLocator:
        def scroll_into_view_if_needed(self, timeout=None):
            return None

        def fill(self, value, timeout=None):
            filled.append(value)

    class FakeOptions:
        def count(self):
            return 0

    class FakeKeyboard:
        def press(self, key):
            keys.append(key)

    class FakePage:
        keyboard = FakeKeyboard()

        def wait_for_timeout(self, timeout):
            return None

        def locator(self, selector):
            return FakeOptions()

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator())

    applied = runner.execute_input_plan(
        FakePage(),
        [{"key": "residence", "kind": "text", "field": {"index": 0, "tag": "input", "type": "input", "label": "e.g. Ottawa, Canada"}, "value": "沖縄県那覇市"}],
    )

    assert applied == ["residence"]
    assert filled == ["沖縄県那覇市"]
    assert keys == ["Tab"]


def test_execute_input_plan_confirms_residence_autocomplete_when_options_visible(monkeypatch) -> None:
    fields = [{"index": 0, "tag": "input", "type": "input", "label": "e.g. Ottawa, Canada", "visible": True, "enabled": True}]
    keys: list[str] = []

    class FakeLocator:
        def scroll_into_view_if_needed(self, timeout=None):
            return None

        def fill(self, value, timeout=None):
            return None

    class FakeOptions:
        def count(self):
            return 1

    class FakeKeyboard:
        def press(self, key):
            keys.append(key)

    class FakePage:
        keyboard = FakeKeyboard()

        def wait_for_timeout(self, timeout):
            return None

        def locator(self, selector):
            return FakeOptions()

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator())

    runner.execute_input_plan(
        FakePage(),
        [{"key": "residence", "kind": "text", "field": {"index": 0, "tag": "input", "type": "input", "label": "e.g. Ottawa, Canada"}, "value": "沖縄県那覇市"}],
    )

    assert keys == ["ArrowDown", "Enter", "Tab"]


def test_build_input_plan_uses_english_residence_for_english_location_field() -> None:
    classified = {
        "residence": [SimpleNamespace(index=10, tag="input", type="input", label="e.g. Ottawa, Canada | Start typing...")]
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    assert plan == [
        {
            "key": "residence",
            "kind": "text",
            "field": {"index": 10, "tag": "input", "type": "input", "label": "e.g. Ottawa, Canada | Start typing..."},
            "value": "Naha, Okinawa, Japan",
        }
    ]


def test_prefill_checks_accepts_english_residence_readback() -> None:
    fields = [{"tag": "input", "type": "input", "value": "Naha, Okinawa, Japan", "label": "Location"}]
    classified = {"residence": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["residence"] is True


def test_prefill_checks_accepts_github_profile_readback() -> None:
    fields = [{"index": 0, "tag": "input", "type": "text", "value": runner.PROFILE["github_profile_url"], "label": "Github Profile"}]
    classified = {"github_profile_url": [SimpleNamespace(index=0, label="Github Profile")]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["github_profile_url"] is True


def test_prefill_checks_accepts_immediately_available_notice_period() -> None:
    fields = [{"index": 0, "tag": "input", "type": "text", "value": "Immediately available", "label": "What is your notice period?"}]
    classified = {"job_change_timing": [SimpleNamespace(index=0, label="What is your notice period?")]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["job_change_timing"] is True


def test_choose_radio_in_group_uses_hrmos_empty_name_discovery_group(monkeypatch) -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "radio", "name": "", "label": "社員のTwitter | 応募のきっかけ\n必須\n\t\n社員のTwitter\n社員以外のSNS\nGoogle検索\nその他 | 社員のTwitter", "value": "on", "text": ""},
        {"index": 1, "tag": "input", "type": "radio", "name": "", "label": "社員以外のSNS | 応募のきっかけ\n必須\n\t\n社員のTwitter\n社員以外のSNS\nGoogle検索\nその他 | 社員以外のSNS", "value": "on", "text": ""},
        {"index": 2, "tag": "input", "type": "radio", "name": "", "label": "Google検索 | 応募のきっかけ\n必須\n\t\n社員のTwitter\n社員以外のSNS\nGoogle検索\nその他 | Google検索", "value": "on", "text": ""},
        {"index": 3, "tag": "input", "type": "radio", "name": "", "label": "その他 | 応募のきっかけ\n必須\n\t\n社員のTwitter\n社員以外のSNS\nGoogle検索\nその他 | その他", "value": "on", "text": ""},
    ]
    checked_indexes: list[int] = []

    class FakeLocator:
        def __init__(self, index: int):
            self.index = index

        def check(self, timeout=None, force=None):
            checked_indexes.append(self.index)
            fields[self.index]["checked"] = True

    class FakePageForRadio:
        def wait_for_timeout(self, timeout):
            return None

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator(field.index))

    assert runner.choose_radio_in_group(FakePageForRadio(), SimpleNamespace(index=0), [r"Google検索", r"検索"]) is True
    assert checked_indexes == [2]


def test_choose_checkbox_in_group_uses_matching_planb_source(monkeypatch) -> None:
    fields = [{"index": index, "tag": "input", "type": "text", "name": "", "label": "", "value": "", "text": ""} for index in range(21)]
    fields[18] = {
        "index": 18,
        "tag": "input",
        "type": "checkbox",
        "name": "",
        "label": "PLAN-B社員からの紹介 | PLAN-Bを知った経緯\n該当項目を選択してください。（複数選択可）\n必須\n\t\nPLAN-B社員からの紹介\nPLAN-B配信コンテンツ（note・YouTube・X）を見て知った\nGreen\nOpenWork\nビズリーチ\nその他 | PLAN-B社員からの紹介",
        "value": "on",
        "text": "",
        "checked": False,
    }
    fields[20] = {
        "index": 20,
        "tag": "input",
        "type": "checkbox",
        "name": "",
        "label": "Green | PLAN-Bを知った経緯\n該当項目を選択してください。（複数選択可）\n必須\n\t\nPLAN-B社員からの紹介\nPLAN-B配信コンテンツ（note・YouTube・X）を見て知った\nGreen\nOpenWork\nビズリーチ\nその他 | Green",
        "value": "on",
        "text": "",
        "checked": False,
    }
    checked_indexes: list[int] = []

    class FakeLocator:
        def __init__(self, index: int):
            self.index = index

        def check(self, timeout=None, force=None):
            checked_indexes.append(self.index)
            fields[self.index]["checked"] = True

    class FakePageForCheckbox:
        def wait_for_timeout(self, timeout):
            return None

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator(field.index))

    assert runner.choose_checkbox_in_group(FakePageForCheckbox(), SimpleNamespace(index=18), [r"Green", r"OpenWork", r"ビズリーチ"]) is True
    assert checked_indexes == [20]


def test_choose_checkbox_in_group_clears_none_of_the_above_when_target_already_checked(monkeypatch) -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "name": "experience",
            "label": "Prompt Engineering | Do you have previous work experience in any of the following fields? | Prompt Engineering",
            "primary_label": "Prompt Engineering",
            "value": "on",
            "text": "",
            "checked": True,
        },
        {
            "index": 1,
            "tag": "input",
            "type": "checkbox",
            "name": "experience",
            "label": "None of the above | Do you have previous work experience in any of the following fields? | None of the above",
            "primary_label": "None of the above",
            "value": "on",
            "text": "",
            "checked": True,
        },
    ]
    cleared_indexes: list[int] = []

    class FakePageForCheckbox:
        def wait_for_timeout(self, timeout):
            return None

    def fake_explicit_set_checked_by_index(page, index, expected_checked):
        fields[index]["checked"] = expected_checked
        if expected_checked is False:
            cleared_indexes.append(index)
        return True

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "explicit_set_checked_by_index", fake_explicit_set_checked_by_index)

    assert runner.choose_checkbox_in_group(FakePageForCheckbox(), SimpleNamespace(index=0), [r"Prompt Engineering"]) is True
    assert cleared_indexes == [1]
    assert fields[0]["checked"] is True
    assert fields[1]["checked"] is False


def test_choose_radio_in_group_clicks_associated_candidate_label_when_check_does_not_reflect(monkeypatch) -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "radio", "name": "", "label": "男性 | 性別\n必須\n\t\n男性\n女性 | 男性", "value": "on", "text": "", "checked": False},
        {"index": 1, "tag": "input", "type": "radio", "name": "", "label": "女性 | 性別\n必須\n\t\n男性\n女性 | 女性", "value": "on", "text": "", "checked": False},
    ]

    class FakeLocator:
        def check(self, timeout=None, force=None):
            return None

    class FakePageForRadio:
        def wait_for_timeout(self, timeout):
            return None

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator())
    monkeypatch.setattr(runner, "click_associated_label_by_index", lambda page, index: fields[index].update({"checked": True}) or True)

    assert runner.choose_radio_in_group(FakePageForRadio(), SimpleNamespace(index=0), [r"男性", r"\bmale\b", r"男"]) is True


def test_choose_radio_in_group_sets_no_name_repeated_consent_by_index(monkeypatch) -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "radio",
            "name": "",
            "label": "同意の上、チェックしてください | 同意する\n必須\n\t\n同意の上、チェックしてください\n採用情報を配信します。 | 同意の上、チェックしてください",
            "value": "on",
            "text": "",
            "checked": True,
        },
        {
            "index": 1,
            "tag": "input",
            "type": "radio",
            "name": "",
            "label": "同意の上、チェックしてください | 同意する\n必須\n\t\n同意の上、チェックしてください\n個人情報の取り扱いをご確認ください。 | 同意の上、チェックしてください",
            "value": "on",
            "text": "",
            "checked": False,
        },
    ]

    class FakeLocator:
        def check(self, timeout=None, force=None):
            return None

    class FakePageForRadio:
        def wait_for_timeout(self, timeout):
            return None

        def evaluate(self, script, index):
            fields[index]["checked"] = True
            return True

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator())
    monkeypatch.setattr(runner, "click_exact_visible_text", lambda page, text: False)

    assert runner.choose_radio_in_group(FakePageForRadio(), SimpleNamespace(index=1), [r"同意"]) is True
    assert fields[1]["checked"] is True


def test_prefill_checks_requires_each_repeated_consent_readback() -> None:
    fields = [
        {"tag": "input", "type": "radio", "checked": True, "label": "採用情報に同意する", "value": "on", "name": ""},
        {"tag": "input", "type": "radio", "checked": False, "label": "個人情報に同意する", "value": "on", "name": ""},
    ]
    classified = {
        "consent": [
            SimpleNamespace(index=0),
            SimpleNamespace(index=1),
        ]
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["consent"] is False


def test_find_button_by_names_falls_back_to_exact_visible_text(monkeypatch) -> None:
    class FakeActionable:
        def evaluate_all(self, script, names):
            return []

    class FakeTextLocator:
        @property
        def last(self):
            return self

        def count(self):
            return 1

        def is_visible(self, timeout=None):
            return True

    class FakePage:
        def locator(self, selector):
            assert selector == runner.ACTIONABLE_SELECTOR
            return FakeActionable()

        def get_by_text(self, name, exact=None):
            assert name == "入力内容を確認する"
            assert exact is True
            return FakeTextLocator()

    assert runner.find_button_by_names(FakePage(), ["入力内容を確認する"]) is not None


def test_form_surface_requires_visible_fillable_controls() -> None:
    assert runner.has_visible_form_controls(
        [
            {"tag": "input", "type": "hidden", "visible": False, "enabled": True},
            {"tag": "a", "type": "", "visible": True, "enabled": True},
        ]
    ) is False
    assert runner.has_visible_form_controls(
        [
            {"tag": "input", "type": "text", "visible": True, "enabled": True},
        ]
    ) is True


def test_ensure_application_form_surface_clicks_apply_when_marker_has_no_controls(monkeypatch, tmp_path) -> None:
    detail_page = SimpleNamespace(url="https://example.com/jobs/1")
    form_page = SimpleNamespace(url="https://example.com/jobs/1/apply")
    clicks = {"apply": 0}

    class FakeApplyCta:
        def click(self, timeout=None):
            clicks["apply"] += 1

    class FakeLocator:
        def nth(self, index):
            assert index == 0
            return FakeApplyCta()

    class FakePopup:
        value = form_page

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class FakeContext:
        def expect_page(self, timeout=None):
            return FakePopup()

    detail_page.context = FakeContext()
    detail_page.locator = lambda selector: FakeLocator()
    form_page.wait_for_load_state = lambda *args, **kwargs: None
    form_page.wait_for_timeout = lambda *args, **kwargs: None

    proofs = iter([
        SimpleNamespace(to_json=lambda: {"stage": "open"}),
        SimpleNamespace(to_json=lambda: {"stage": "detail"}),
        SimpleNamespace(to_json=lambda: {"stage": "form"}),
    ])
    captured = iter([
        [{"tag": "input", "type": "hidden", "visible": False, "enabled": True}],
        [{"tag": "input", "type": "text", "visible": True, "enabled": True}],
    ])
    monkeypatch.setattr(runner, "assert_visible_open", lambda *args, **kwargs: next(proofs))
    monkeypatch.setattr(runner, "capture_controls", lambda page: next(captured))
    monkeypatch.setattr(runner, "visible_action_buttons", lambda page: [{"text": "応募する"}])
    monkeypatch.setattr(runner, "actionable_elements_by_names", lambda page, names: [{"index": 0, "tag": "A", "type": "", "text": "応募する", "href": "https://example.com/jobs/1/apply"}])

    page, proof = runner.ensure_application_form_surface(
        detail_page,
        SimpleNamespace(company="Example", role="CS"),
        tmp_path,
    )

    assert page is form_page
    assert proof.to_json() == {"stage": "form"}
    assert clicks["apply"] == 1


def test_actionable_selector_includes_generic_role_button() -> None:
    assert "[role=button]:visible" in runner.ACTIONABLE_SELECTOR


def test_runner_records_visible_open_failures_as_specific_retryable_blocker() -> None:
    source = MODULE_PATH.read_text(encoding="utf-8")

    assert "visible_open_check_failed_before_form_mutation" in source
    assert "visible_open_check_failed" in source
    assert "playwright_exception_before_completion" in source


def test_flexible_role_marker_tolerates_punctuation_spacing_variants() -> None:
    marker = runner.flexible_role_marker("Growth Marketing Specialist - APAC")

    assert marker.startswith("re:")
    assert re.search(marker[3:], "Growth Marketing Specialist- APAC", re.I)
    assert re.search(marker[3:], "Growth Marketing Specialist, APAC Performance Marketing", re.I)


def test_prefill_checks_reject_mixed_parent_radio_labels() -> None:
    fields = [
        {"tag": "input", "type": "radio", "checked": False, "label": "Are you legally authorized to work? Yes No", "value": "Yes", "name": "work"},
        {"tag": "input", "type": "radio", "checked": True, "label": "Are you legally authorized to work? Yes No", "value": "No", "name": "work"},
        {"tag": "input", "type": "radio", "checked": True, "label": "Will you require visa sponsorship? Yes No", "value": "Yes", "name": "visa"},
        {"tag": "input", "type": "radio", "checked": False, "label": "Will you require visa sponsorship? Yes No", "value": "No", "name": "visa"},
    ]
    classified = {
        "work_authorization": [SimpleNamespace(index=0)],
        "visa_sponsorship": [SimpleNamespace(index=2)],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is True
    assert checks["visa_sponsorship"] is False


def test_prefill_checks_require_safe_flexible_known_fact_readback() -> None:
    fields = [
        {"tag": "input", "type": "radio", "checked": True, "label": "健康状態 良好", "value": "good", "name": "health"},
        {"tag": "input", "type": "radio", "checked": True, "label": "Smoker Yes", "value": "Yes", "name": "smoker"},
    ]
    classified = {
        "health": [SimpleNamespace(index=0)],
        "smoker": [SimpleNamespace(index=1)],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["health"] is True
    assert checks["smoker"] is False


def test_prefill_checks_accepts_hrmos_select_value_suffix_and_postal() -> None:
    fields = [
        {"tag": "input", "type": "tel", "value": runner.PROFILE["postal"]},
        {"tag": "select", "type": "select", "value": f"7: {runner.PROFILE['degree']}"},
    ]
    classified = {
        "postal": [SimpleNamespace(index=0)],
        "degree": [SimpleNamespace(index=1)],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["postal"] is True
    assert checks["degree"] is True


def test_prefill_checks_accepts_selected_employment_option_label() -> None:
    fields = [
        {
            "tag": "select",
            "type": "select",
            "value": "1: FULL",
            "options": [
                {"label": "選択", "value": "0: "},
                {"label": "正社員", "value": "1: FULL"},
                {"label": "契約社員", "value": "2: CONT"},
            ],
        }
    ]
    classified = {"employment": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["employment"] is True


def test_prefill_checks_accepts_split_first_last_name_readback() -> None:
    fields = [
        {"tag": "input", "type": "text", "value": runner.PROFILE["first_name"]},
        {"tag": "input", "type": "text", "value": runner.PROFILE["last_name"]},
        {"tag": "input", "type": "email", "value": runner.PROFILE["email"]},
    ]
    classified = {"name": [SimpleNamespace(index=0), SimpleNamespace(index=1)]}

    checks = runner.prefill_checks(fields, "履歴書＿田仲二千.pdf", "career.pdf", "message", classified)

    assert checks["name"] is True


def test_build_input_plan_uses_english_name_for_english_resume() -> None:
    classified = {
        "first_name": [SimpleNamespace(index=1, tag="input", type="text", label="First Name")],
        "last_name": [SimpleNamespace(index=2, tag="input", type="text", label="Last Name")],
        "name": [SimpleNamespace(index=3, tag="input", type="text", label="Full Name")],
    }

    plan = runner.build_input_plan(
        classified,
        Path("/Users/nichikatanaka/Downloads/Nichika Tanaka＿Reume.pdf"),
        Path("/tmp/career.pdf"),
        "message",
    )

    values = {item["key"]: item["value"] for item in plan}
    assert values["first_name"] == "Nichika"
    assert values["last_name"] == "Tanaka"
    assert values["name"] == "Nichika Tanaka"


def test_build_input_plan_uses_english_name_for_correctly_spelled_resume() -> None:
    classified = {
        "first_name": [SimpleNamespace(index=1, tag="input", type="text", label="First Name")],
        "last_name": [SimpleNamespace(index=2, tag="input", type="text", label="Last Name")],
        "name": [SimpleNamespace(index=3, tag="input", type="text", label="Full Name")],
    }

    plan = runner.build_input_plan(
        classified,
        Path("/Users/nichikatanaka/Downloads/Nichika Tanaka＿Resume.pdf"),
        Path("/tmp/career.pdf"),
        "message",
    )

    values = {item["key"]: item["value"] for item in plan}
    assert values["first_name"] == "Nichika"
    assert values["last_name"] == "Tanaka"
    assert values["name"] == "Nichika Tanaka"


def test_build_input_plan_keeps_japanese_name_for_japanese_resume() -> None:
    classified = {
        "first_name": [SimpleNamespace(index=1, tag="input", type="text", label="名")],
        "last_name": [SimpleNamespace(index=2, tag="input", type="text", label="姓")],
        "name": [SimpleNamespace(index=3, tag="input", type="text", label="氏名")],
    }

    plan = runner.build_input_plan(
        classified,
        Path("/Users/nichikatanaka/Downloads/履歴書＿田仲二千.pdf"),
        Path("/tmp/career.pdf"),
        "message",
    )

    values = {item["key"]: item["value"] for item in plan}
    assert values["first_name"] == runner.PROFILE["first_name"]
    assert values["last_name"] == runner.PROFILE["last_name"]
    assert values["name"] == runner.PROFILE["name"]


def test_prefill_checks_accepts_english_split_name_for_english_resume() -> None:
    fields = [
        {"tag": "input", "type": "text", "value": "Nichika"},
        {"tag": "input", "type": "text", "value": "Tanaka"},
    ]
    classified = {"name": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Reume.pdf", "career.pdf", "message", classified)

    assert checks["name"] is True


def test_prefill_checks_rejects_japanese_split_name_for_english_resume() -> None:
    fields = [
        {"tag": "input", "type": "text", "value": runner.PROFILE["first_name"]},
        {"tag": "input", "type": "text", "value": runner.PROFILE["last_name"]},
    ]
    classified = {"name": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Reume.pdf", "career.pdf", "message", classified)

    assert checks["name"] is False


def test_name_readback_matches_english_full_name_for_english_resume() -> None:
    assert runner.name_readback_matches(["Confirm\nNichika Tanaka\nSubmit"], "Nichika Tanaka＿Reume.pdf") is True
    assert runner.name_readback_matches(["Confirm\n田仲 二千\nSubmit"], "Nichika Tanaka＿Reume.pdf") is False


def test_name_readback_matches_japanese_full_name_for_japanese_resume() -> None:
    assert runner.name_readback_matches(["確認\n田仲 二千\n送信"], "履歴書＿田仲二千.pdf") is True
    assert runner.name_readback_matches(["Confirm\nNichika Tanaka\nSubmit"], "履歴書＿田仲二千.pdf") is False


def test_english_name_canary_accepts_english_name_and_resume_reflection(tmp_path: Path) -> None:
    result = runner.english_name_canary_result(
        [
            {"key": "first_name", "value": "Nichika"},
            {"key": "last_name", "value": "Tanaka"},
        ],
        [
            {"tag": "input", "type": "text", "value": "Nichika", "label": "First Name"},
            {"tag": "input", "type": "text", "value": "Tanaka", "label": "Last Name"},
            {"tag": "input", "type": "file", "value": "Nichika Tanaka＿Reume.pdf", "label": "Resume"},
        ],
        Path("/Users/nichikatanaka/Downloads/Nichika Tanaka＿Reume.pdf"),
        {"resume_file": [SimpleNamespace(index=3)]},
        {"name": True, "resume_file": True},
        tmp_path,
        1,
    )

    assert result["ok"] is True
    assert result["required"] is True


def test_english_name_canary_rejects_resume_filename_without_name_field(tmp_path: Path) -> None:
    result = runner.english_name_canary_result(
        [{"key": "resume_file", "value": "/Users/nichikatanaka/Downloads/Nichika Tanaka＿Resume.pdf"}],
        [
            {"tag": "input", "type": "text", "value": "", "label": "First Name"},
            {"tag": "input", "type": "text", "value": "", "label": "Last Name"},
            {"tag": "input", "type": "file", "value": "Nichika Tanaka＿Resume.pdf", "label": "Resume"},
        ],
        Path("/Users/nichikatanaka/Downloads/Nichika Tanaka＿Resume.pdf"),
        {"resume_file": [SimpleNamespace(index=2)]},
        {"name": False, "resume_file": True},
        tmp_path,
        1,
    )

    assert result["ok"] is False
    assert result["has_expected_name_readback"] is False


def test_english_name_canary_rejects_japanese_name_with_english_resume(tmp_path: Path) -> None:
    result = runner.english_name_canary_result(
        [{"key": "name", "value": runner.PROFILE["name"]}],
        [{"tag": "input", "type": "text", "value": runner.PROFILE["name"], "label": "Full Name"}],
        Path("/Users/nichikatanaka/Downloads/Nichika Tanaka＿Reume.pdf"),
        {"resume_file": [SimpleNamespace(index=3)]},
        {"name": False, "resume_file": True},
        tmp_path,
        1,
    )

    assert result["ok"] is False
    assert result["has_forbidden_japanese_name"] is True


def test_prefill_checks_rejects_unchecked_choice_value_readback() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "Are you legally authorized to work in the United States? Yes No | No",
            "value": "No",
        },
    ]
    classified = {"work_authorization": [SimpleNamespace(index=0, label="Are you legally authorized to work in the United States?")]}

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Resume.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is False


def test_unchecked_yes_no_checkbox_does_not_satisfy_no_for_single_hidden_toggle(monkeypatch) -> None:
    field = SimpleNamespace(index=0, label="Yes\nNo | Will you require sponsorship or support?")
    monkeypatch.setattr(
        runner,
        "capture_controls",
        lambda page: [{"index": 0, "type": "checkbox", "checked": False}],
    )

    assert runner.unchecked_yes_no_checkbox_satisfies_no(object(), field, ["No", "いいえ"]) is False


def test_unchecked_yes_no_checkbox_does_not_satisfy_yes_or_non_choice(monkeypatch) -> None:
    monkeypatch.setattr(
        runner,
        "capture_controls",
        lambda page: [{"index": 0, "type": "checkbox", "checked": False}],
    )

    yes_no_field = SimpleNamespace(index=0, label="Yes\nNo | Have you worked at a startup before?")
    ordinary_field = SimpleNamespace(index=0, label="I agree to the privacy policy")

    assert runner.unchecked_yes_no_checkbox_satisfies_no(object(), yes_no_field, ["Yes"]) is False
    assert runner.unchecked_yes_no_checkbox_satisfies_no(object(), ordinary_field, ["No"]) is False


def test_unchecked_lilt_experience_yes_no_checkbox_does_not_satisfy_no(monkeypatch) -> None:
    field = SimpleNamespace(index=0, label="Yes\nNo | Do you have expert level experience in Python?")
    monkeypatch.setattr(
        runner,
        "capture_controls",
        lambda page: [
            {
                "index": 0,
                "type": "checkbox",
                "checked": False,
                "label": "Yes\nNo | Do you have expert level experience in Python?",
            }
        ],
    )

    assert runner.single_yes_no_checkbox_matches(runner.capture_controls(object()), field, ["No"]) is False
    assert runner.unchecked_yes_no_checkbox_satisfies_no(object(), field, ["No"]) is False


def test_prefill_checks_accepts_visual_no_for_lilt_experience_checkbox() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "Yes\nNo | Do you have expert level experience in Python?",
            "visual_selected_choice": "No",
            "value": "on",
        }
    ]
    classified = {
        "role_experience_expert_cli_python_shell": [
            SimpleNamespace(index=0, label="Yes\nNo | Do you have expert level experience in Python?")
        ]
    }

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Resume.pdf", "career.pdf", "message", classified)

    assert checks["role_experience_expert_cli_python_shell"] is True


def test_prefill_checks_rejects_unchecked_no_for_single_visa_sponsorship_toggle() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "Yes\nNo | Will you require sponsorship or support to be authorized to work from your country of residence?",
            "value": "on",
        },
    ]
    classified = {
        "visa_sponsorship": [
            SimpleNamespace(
                index=0,
                label="Yes\nNo | Will you require sponsorship or support to be authorized to work from your country of residence?",
            )
        ]
    }

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Resume.pdf", "career.pdf", "message", classified)

    assert checks["visa_sponsorship"] is False


def test_prefill_checks_rejects_unchecked_no_for_single_us_work_authorization_toggle() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "Yes\nNo | Are you currently authorized to work lawfully in the U.S.?",
            "value": "on",
        },
    ]
    classified = {
        "work_authorization": [
            SimpleNamespace(
                index=0,
                label="Yes\nNo | Are you currently authorized to work lawfully in the U.S.?",
            )
        ]
    }

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Resume.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is False


def test_prefill_checks_rejects_nylas_unchecked_single_checkbox_authorization() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "Yes\nNo | Are you currently authorized to work in the country in which this role is listed? | Are you currently authorized to work in the country in which this role is listed?",
            "name": "work-auth",
            "value": "on",
        },
        {
            "index": 1,
            "tag": "input",
            "type": "checkbox",
            "checked": True,
            "label": "Yes\nNo | Will you now or ever in the future require work visa sponsorship? | Will you now or ever in the future require work visa sponsorship?",
            "name": "visa-support",
            "value": "on",
        },
    ]
    classified = {
        "work_authorization": [
            SimpleNamespace(
                index=0,
                label="Yes\nNo | Are you currently authorized to work in the country in which this role is listed? | Are you currently authorized to work in the country in which this role is listed?",
            )
        ],
        "visa_sponsorship": [
            SimpleNamespace(
                index=1,
                label="Yes\nNo | Will you now or ever in the future require work visa sponsorship? | Will you now or ever in the future require work visa sponsorship?",
            )
        ],
    }

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Resume.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is False
    assert checks["visa_sponsorship"] is False


def test_fill_known_fact_does_not_treat_unchecked_single_yes_no_checkbox_as_no(monkeypatch) -> None:
    controls = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": True,
            "label": "Yes\nNo | Are you currently authorized to work lawfully in the U.S.?",
            "name": "work-auth",
            "value": "on",
        }
    ]

    class FakePageForSingleCheckbox:
        def evaluate(self, script, payload):
            controls[payload["index"]]["checked"] = payload["expectedChecked"]
            return controls[payload["index"]]["checked"] == payload["expectedChecked"]

        def wait_for_timeout(self, timeout):
            return None

    monkeypatch.setattr(runner, "capture_controls", lambda page: controls)

    ok = runner.fill_or_choose_known_fact(
        FakePageForSingleCheckbox(),
        SimpleNamespace(index=0, tag="input", type="checkbox", label=controls[0]["label"]),
        "No",
        ["No", "いいえ"],
    )

    assert ok is False
    assert controls[0]["checked"] is False


def test_prefill_checks_rejects_unchecked_yes_when_no_choice_is_separate_checkbox() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "Yes | Are you currently authorized to work lawfully in the U.S.?",
            "name": "work-auth",
            "value": "on",
        },
        {
            "index": 1,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "No | Are you currently authorized to work lawfully in the U.S.?",
            "name": "work-auth",
            "value": "on",
        },
    ]
    classified = {
        "work_authorization": [
            SimpleNamespace(
                index=0,
                label="Yes\nNo | Are you currently authorized to work lawfully in the U.S.?",
            )
        ]
    }

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Resume.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is False


def test_prefill_checks_rejects_unchecked_yes_when_no_choice_is_separate_no_name_checkbox() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "Yes | Are you currently authorized to work lawfully in the U.S.?",
            "name": "",
            "value": "on",
        },
        {
            "index": 1,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "No | Are you currently authorized to work lawfully in the U.S.?",
            "name": "",
            "value": "on",
        },
    ]
    classified = {
        "work_authorization": [
            SimpleNamespace(
                index=0,
                label="Yes\nNo | Are you currently authorized to work lawfully in the U.S.?",
            )
        ]
    }

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Resume.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is False


def test_no_answer_on_single_work_authorization_checkbox_is_not_checked(monkeypatch) -> None:
    field = SimpleNamespace(
        index=0,
        tag="input",
        type="checkbox",
        label="Yes\nNo | Are you currently authorized to work lawfully in the U.S.?",
    )
    monkeypatch.setattr(
        runner,
        "capture_controls",
        lambda page: [{"index": 0, "tag": "input", "type": "checkbox", "checked": True, "label": field.label}],
    )
    monkeypatch.setattr(runner, "click_nearby_yes_no_option", lambda page, field, options: False)
    monkeypatch.setattr(runner, "choose_checkbox_in_group", lambda page, field, options: False)

    assert runner.fill_or_choose_known_fact(object(), field, "No", ["No", "いいえ"]) is False


def test_no_answer_does_not_accept_unchecked_yes_when_no_is_separate_checkbox(monkeypatch) -> None:
    label = "Yes\nNo | Are you currently authorized to work lawfully in the U.S.?"
    field = SimpleNamespace(index=0, tag="input", type="checkbox", label=label)
    controls = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": label,
            "name": "work-auth",
        },
        {
            "index": 1,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "No | Are you currently authorized to work lawfully in the U.S.?",
            "name": "work-auth",
        },
    ]
    monkeypatch.setattr(runner, "capture_controls", lambda page: controls)
    monkeypatch.setattr(runner, "click_nearby_yes_no_option", lambda page, field, options: False)
    monkeypatch.setattr(runner, "choose_checkbox_in_group", lambda page, field, options: False)

    assert runner.unchecked_yes_no_checkbox_satisfies_no(object(), field, ["No", "いいえ"]) is False
    assert runner.fill_or_choose_known_fact(object(), field, "No", ["No", "いいえ"]) is False


def test_no_answer_does_not_accept_unchecked_yes_when_no_is_separate_no_name_checkbox(monkeypatch) -> None:
    label = "Yes\nNo | Are you currently authorized to work lawfully in the U.S.?"
    field = SimpleNamespace(index=0, tag="input", type="checkbox", label=label)
    controls = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": label,
            "name": "",
        },
        {
            "index": 1,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "No | Are you currently authorized to work lawfully in the U.S.?",
            "name": "",
        },
    ]
    monkeypatch.setattr(runner, "capture_controls", lambda page: controls)
    monkeypatch.setattr(runner, "click_nearby_yes_no_option", lambda page, field, options: False)
    monkeypatch.setattr(runner, "choose_checkbox_in_group", lambda page, field, options: False)

    assert runner.unchecked_yes_no_checkbox_satisfies_no(object(), field, ["No", "いいえ"]) is False
    assert runner.fill_or_choose_known_fact(object(), field, "No", ["No", "いいえ"]) is False


def test_prefill_checks_rejects_negative_sponsorship_text_readback() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "text",
            "value": "No, I do not require sponsorship",
            "label": "Will you now or in the future require visa sponsorship?",
        },
    ]
    classified = {"visa_sponsorship": [SimpleNamespace(index=0, label="Will you now or in the future require visa sponsorship?")]}

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Resume.pdf", "career.pdf", "message", classified)

    assert checks["visa_sponsorship"] is False


def test_prefill_checks_rejects_hidden_choice_value_readback() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "hidden",
            "value": "No",
            "label": "Are you legally authorized to work in the United States?",
        },
    ]
    classified = {"work_authorization": [SimpleNamespace(index=0, label="Are you legally authorized to work in the United States?")]}

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Resume.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is False


def test_prefill_checks_rejects_yes_negative_sponsorship_sentence() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "text",
            "value": "Yes, I do not require sponsorship",
            "label": "Will you now or in the future require visa sponsorship?",
        },
    ]
    classified = {"visa_sponsorship": [SimpleNamespace(index=0, label="Will you now or in the future require visa sponsorship?")]}

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Resume.pdf", "career.pdf", "message", classified)

    assert checks["visa_sponsorship"] is False


def test_registered_artifact_base_valid_requires_current_run_id() -> None:
    assert runner.registered_artifact_base_valid(
        Path("/Users/nichikatanaka/Documents/New project/artifacts/run-summaries/run_abc123"),
        "run_abc123",
    )
    assert not runner.registered_artifact_base_valid(
        Path("/Users/nichikatanaka/Documents/New project/artifacts/run-summaries/run_old"),
        "run_abc123",
    )
    assert not runner.registered_artifact_base_valid(
        Path("/tmp/run-summaries/anything/run_abc123"),
        "run_abc123",
    )
    assert not runner.registered_artifact_base_valid(
        Path("/Users/nichikatanaka/Documents/New project/artifacts/run-summaries/run_old/run_abc123"),
        "run_abc123",
    )


def test_registered_artifact_base_valid_requires_codex_app_fallback_without_run_id() -> None:
    assert runner.registered_artifact_base_valid(
        Path(
            "/Users/nichikatanaka/Documents/New project/artifacts/run-summaries/"
            "codex-app-job-application-manager-20260626-232500"
        ),
        "",
    )
    assert not runner.registered_artifact_base_valid(
        Path("/Users/nichikatanaka/Documents/New project/artifacts/run-summaries/run_mqtl3930_bd8kdi"),
        "",
    )
    assert not runner.registered_artifact_base_valid(
        Path(
            "/Users/nichikatanaka/Documents/New project/artifacts/run-summaries/"
            "codex-app-job-application-manager-20260626-232500-extra"
        ),
        "",
    )
    assert not runner.registered_artifact_base_valid(
        Path("/Users/nichikatanaka/Documents/New project/artifacts/automation-os-registered-summaries/run_abc123"),
        "",
    )


def test_registered_run_id_ignores_automation_os_summary_path(monkeypatch) -> None:
    monkeypatch.delenv("CODEX_RUN_ID", raising=False)
    monkeypatch.delenv("codex_run_id", raising=False)
    monkeypatch.delenv("CODEX_APP_RUN_ID", raising=False)
    monkeypatch.delenv("AUTOMATION_OS_RUN_ID", raising=False)
    monkeypatch.delenv("automation_os_run_id", raising=False)
    monkeypatch.setenv(
        "AUTOMATION_OS_REGISTERED_SUMMARY_PATH",
        "/Users/nichikatanaka/Documents/New project/artifacts/automation-os-registered-summaries/run_abc123/job_submit_registered-registered-summary.json",
    )

    assert runner.registered_run_id_from_environment() == ""


def test_registered_run_id_prefers_codex_app_env(monkeypatch) -> None:
    monkeypatch.setenv("CODEX_RUN_ID", "codex-app-job-application-manager-20260626-232500")
    monkeypatch.setenv("AUTOMATION_OS_RUN_ID", "run_old")
    monkeypatch.setenv("codex_run_id", "legacy_lowercase")
    monkeypatch.setenv("CODEX_APP_RUN_ID", "legacy_codex_app")

    assert runner.registered_run_id_from_environment() == "codex-app-job-application-manager-20260626-232500"


def test_registered_run_id_ignores_non_contract_codex_aliases(monkeypatch) -> None:
    monkeypatch.delenv("CODEX_RUN_ID", raising=False)
    monkeypatch.setenv("codex_run_id", "legacy_lowercase")
    monkeypatch.setenv("CODEX_APP_RUN_ID", "legacy_codex_app")

    assert runner.registered_run_id_from_environment() == ""


def test_platform_sweep_completion_requires_items_when_platform_indications_exist() -> None:
    assert not runner.platform_sweep_completion_valid(
        {
            "platform_indications_present": True,
            "items": [],
            "artifact_uri": "artifacts/platform-follow-up/sweep.json",
        }
    )
    assert runner.platform_sweep_completion_valid(
        {
            "platform_indications_present": True,
            "items": [
                {
                    "platform": "sukiiki",
                    "company": "Example Inc.",
                    "thread_url": "https://example.test/messages/1",
                    "last_checked_jst": "2026-06-26T23:30:00+09:00",
                    "exact_blocker": "",
                    "artifact_uri": "artifacts/platform-follow-up/sukiiki-example.json",
                    "classification": "reply_needed",
                }
            ],
        }
    )


def test_platform_sweep_completion_rejects_missing_schema_fields() -> None:
    assert not runner.platform_sweep_completion_valid(
        {
            "platform_indications_present": True,
            "items": [
                {
                    "platform": "green",
                    "company": "Example Inc.",
                    "last_checked_jst": "2026-06-26T23:30:00+09:00",
                    "artifact_uri": "artifacts/platform-follow-up/green-example.json",
                    "classification": "needs_reply",
                }
            ],
        }
    )


def test_platform_sweep_completion_allows_verified_no_action_without_indications() -> None:
    assert runner.platform_sweep_completion_valid(
        {
            "platform_indications_present": False,
            "verified_no_action": True,
            "no_platform_indications_evidence_uri": "artifacts/platform-follow-up/no-action.json",
        }
    )


def test_validate_platform_sweep_artifact_exits_on_invalid_payload(tmp_path) -> None:
    artifact = tmp_path / "platform-sweep.json"
    artifact.write_text(json.dumps({"platform_indications_present": True, "items": []}), encoding="utf-8")

    try:
        runner.validate_platform_sweep_artifact(artifact)
    except SystemExit as exc:
        assert str(exc) == "platform_inbox_sweep_completion_invalid"
    else:
        raise AssertionError("invalid platform sweep artifact should stop before completion")


def test_platform_sweep_validate_only_cli_returns_before_browser(monkeypatch, tmp_path, capsys) -> None:
    artifact = tmp_path / "platform-sweep.json"
    artifact.write_text(
        json.dumps(
            {
                "platform_indications_present": False,
                "verified_no_action": True,
                "exact_blocker": "",
                "items": [],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "run_adaptive_official_job_apply.py",
            "--job-url",
            "https://example.invalid/platform-sweep-smoke",
            "--company",
            "PlatformSweepSmoke",
            "--role",
            "FollowUpReadback",
            "--job-key",
            "platform-sweep-smoke",
            "--outcomes-jsonl",
            str(tmp_path / "outcomes.jsonl"),
            "--artifact-dir",
            "/Users/nichikatanaka/Documents/New project/artifacts/run-summaries/codex-app-job-application-manager-20260626-232500",
            "--platform-sweep-artifact",
            str(artifact),
            "--validate-platform-sweep-only",
        ],
    )

    runner.main()

    output = json.loads(capsys.readouterr().out)
    assert output["platform_sweep_valid"] is True
    assert output["artifact_uri"] == str(artifact)


def test_platform_sweep_validate_only_cli_requires_registered_artifact_dir(monkeypatch, tmp_path) -> None:
    artifact = tmp_path / "platform-sweep.json"
    artifact.write_text(json.dumps({"platform_indications_present": False, "verified_no_action": True}), encoding="utf-8")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "run_adaptive_official_job_apply.py",
            "--job-url",
            "https://example.invalid/platform-sweep-smoke",
            "--company",
            "PlatformSweepSmoke",
            "--role",
            "FollowUpReadback",
            "--job-key",
            "platform-sweep-smoke",
            "--outcomes-jsonl",
            str(tmp_path / "outcomes.jsonl"),
            "--artifact-dir",
            str(tmp_path / "run_mqtl3930_bd8kdi"),
            "--platform-sweep-artifact",
            str(artifact),
            "--validate-platform-sweep-only",
        ],
    )

    try:
        runner.main()
    except SystemExit as exc:
        assert str(exc) == "registered_artifact_dir_unavailable_before_submit"
    else:
        raise AssertionError("validate-only must still require a registered Codex app artifact dir")


def test_platform_sweep_validate_only_cli_accepts_prompt_contract_without_job_args(monkeypatch, tmp_path, capsys) -> None:
    artifact = tmp_path / "platform-sweep.json"
    artifact.write_text(
        json.dumps(
            {
                "platform_indications_present": True,
                "items": [
                    {
                        "platform": "Outlier",
                        "company": "Outlier AI",
                        "classification": "read_no_reply_needed",
                        "last_checked_jst": "2026-07-02T07:34:18+09:00",
                        "thread_url": "https://app.outlier.ai/messages/example",
                        "artifact_uri": "/tmp/outlier.json",
                        "exact_blocker": "",
                    }
                ],
                "exact_blocker": "",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "run_adaptive_official_job_apply.py",
            "--artifact-dir",
            "/Users/nichikatanaka/Documents/New project/artifacts/run-summaries/codex-app-job-application-manager-20260702-073418",
            "--platform-sweep-artifact",
            str(artifact),
            "--validate-platform-sweep-only",
        ],
    )

    runner.main()

    output = json.loads(capsys.readouterr().out)
    assert output["platform_sweep_valid"] is True
    assert output["artifact_uri"] == str(artifact)


def test_prefill_checks_accepts_country_only_residence_readback() -> None:
    fields = [
        {"tag": "input", "type": "input", "value": runner.PROFILE["country_en"], "label": "Location"},
    ]
    classified = {"residence": [SimpleNamespace(index=0, label="Location")]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["residence"] is True


def test_prefill_checks_accepts_japan_suffix_residence_readback() -> None:
    fields = [
        {"tag": "input", "type": "input", "value": "Okinawa, Okinawa, Japan", "label": "Location"},
    ]
    classified = {"residence": [SimpleNamespace(index=0, label="Location")]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["residence"] is True


def test_prefill_checks_accepts_lever_hidden_selected_location_country_code() -> None:
    fields = [
        {
            "tag": "input",
            "type": "hidden",
            "label": "Current location",
            "value": '{"name":"","address":{"country":{"code":"JP","description":""},"CountryCode":"JP"}}',
        }
    ]
    classified = {"residence": [SimpleNamespace(index=0, label="Current location")]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["residence"] is True


def test_prefill_checks_does_not_require_optional_location_autocomplete_readback() -> None:
    fields = [
        {"tag": "input", "type": "text", "name": "name", "value": "Nichika Tanaka", "label": "Full name", "required": True},
        {"tag": "input", "type": "email", "name": "email", "value": runner.PROFILE["email"], "label": "Email", "required": True},
        {"tag": "input", "type": "text", "name": "location", "value": "", "label": "Current location", "required": False, "invalid": False},
        {"tag": "input", "type": "hidden", "name": "selectedLocation", "value": "", "label": "Current location", "required": False},
    ]
    classified = {"residence": [SimpleNamespace(index=2, label="Current location")]}

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Reume.pdf", "career.pdf", "message", classified)

    assert checks["residence"] is True


def test_build_input_plan_uses_english_values_for_english_form_facts() -> None:
    classified = {
        "gender": [SimpleNamespace(index=1, tag="input", type="radio", label="Gender\nMale\nFemale")],
        "discovery_source": [SimpleNamespace(index=2, tag="input", type="text", label="How did you hear about this role?")],
        "health": [SimpleNamespace(index=3, tag="input", type="text", label="Health status")],
        "current_working": [SimpleNamespace(index=4, tag="input", type="checkbox", label="Currently employed")],
        "position": [SimpleNamespace(index=5, tag="input", type="text", label="Current position")],
        "work_body": [SimpleNamespace(index=6, tag="textarea", type="textarea", label="Describe your current work")],
        "consent": [SimpleNamespace(index=7, tag="input", type="checkbox", label="I agree to the privacy policy")],
    }

    plan = runner.build_input_plan(classified, Path("Nichika Tanaka＿Reume.pdf"), Path("career.pdf"), "message")
    values = {item["key"]: item["value"] for item in plan}

    assert values["gender"] == "Male"
    assert values["discovery_source"] == "LinkedIn"
    assert values["health"] == "Good"
    assert values["current_working"] == "Currently employed"
    assert values["position"] == "Digital Marketing and AI Content Production for the Japanese market"
    assert "At Perfect Corp." in values["work_body"]
    assert values["consent"] == "I agree"
    assert all(not any(ch in str(value) for ch in "男良好現在当社採用同意日本語") for value in values.values())


def test_build_input_plan_uses_male_for_user_provided_gender_even_in_eeo_context() -> None:
    classified = {
        "gender": [
            SimpleNamespace(
                index=1,
                tag="input",
                type="radio",
                label="Male | Gender\n\nU.S. EQUAL EMPLOYMENT OPPORTUNITY INFORMATION\nInput gender\nMale\nFemale\nDecline to self-identify",
            )
        ],
    }

    plan = runner.build_input_plan(classified, Path("Nichika Tanaka＿Reume.pdf"), Path("career.pdf"), "message")
    values = {item["key"]: item["value"] for item in plan}

    assert values["gender"] == "Male"


def test_build_input_plan_includes_ffg_ai_native_habit_once() -> None:
    classified = {
        "short_intro": [
            SimpleNamespace(index=4, tag="textarea", type="textarea", label="Short Intro | One paragraph, not a cover letter. Tell us why this role.")
        ],
        "ai_native_habit": [
            SimpleNamespace(
                index=6,
                tag="textarea",
                type="textarea",
                label="AI-Native Habit | Describe one AI-native habit you already have. | Short Intro | Name Email Resume",
            )
        ],
        "question_for_us": [
            SimpleNamespace(index=7, tag="input", type="text", label="Question for Us | One question you would ask us if hired.")
        ],
    }

    plan = runner.build_input_plan(classified, Path("Nichika Tanaka＿Reume.pdf"), Path("career.pdf"), "message")
    by_key = {item["key"]: item for item in plan}

    assert by_key["short_intro"]["field"]["index"] == 4
    assert by_key["ai_native_habit"]["field"]["index"] == 6
    assert by_key["question_for_us"]["field"]["index"] == 7
    assert "AI tools daily" in by_key["ai_native_habit"]["value"]
    assert [item["key"] for item in plan].count("ai_native_habit") == 1


def test_prefill_checks_accepts_english_discovery_source_values() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "input",
            "value": "LinkedIn",
            "label": "Where did you first hear about Sanity?",
            "required": False,
        }
    ]
    classified = {"discovery_source": [SimpleNamespace(index=0, tag="input", type="input", label="Where did you first hear about Sanity?")]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["discovery_source"] is True


def test_prefill_checks_do_not_require_github_url_for_discovery_checkbox_option() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "value": "on",
            "label": "Github | How did you find out about us?\nLinkedIn\nGithub\nOther/Not Listed",
            "required": False,
        }
    ]
    classified = {"github_profile_url": [SimpleNamespace(index=0, tag="input", type="checkbox", label=fields[0]["label"])]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["github_profile_url"] is True


def test_prefill_checks_rejects_unselected_employment_option_label() -> None:
    fields = [
        {
            "tag": "select",
            "type": "select",
            "value": "0: ",
            "options": [
                {"label": "選択", "value": "0: "},
                {"label": "正社員", "value": "1: FULL"},
            ],
        }
    ]
    classified = {"employment": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["employment"] is False


def test_selected_value_matches_rejects_wrong_hrmos_select_suffix() -> None:
    assert runner.selected_value_matches(["7: その他"], runner.PROFILE["degree"]) is True
    assert runner.selected_value_matches(["4: 学士"], runner.PROFILE["degree"]) is False


def test_hrmos_detailed_runner_requires_submit_authorization() -> None:
    assert 'parser.add_argument("--submit-authorized", action="store_true")' in HRMOS_RUNNER_TEXT
    assert "submit_authorization_required_prefill_verified" in HRMOS_RUNNER_TEXT
    assert "if args.dry_run or not args.submit_authorized" in HRMOS_RUNNER_TEXT


def test_hrmos_detailed_prefill_checks_accept_select_selected_text_without_rewriting_raw_value() -> None:
    fields = [
        {"tag": "input", "type": "text", "value": hrmos_runner.PROFILE["name"]},
        {"tag": "input", "type": "text", "value": hrmos_runner.PROFILE["kana"]},
        {"tag": "select", "type": "select-one", "value": "y2000", "selectedText": "2000"},
        {"tag": "select", "type": "select-one", "value": "m8", "selectedText": "8"},
        {"tag": "select", "type": "select-one", "value": "d23", "selectedText": "23"},
        {"tag": "input", "type": "email", "value": hrmos_runner.PROFILE["email"]},
        {"tag": "input", "type": "tel", "value": hrmos_runner.PROFILE["phone"]},
        {"tag": "input", "type": "text", "value": hrmos_runner.PROFILE["postal"]},
        {"tag": "input", "type": "text", "value": hrmos_runner.PROFILE["address1"]},
        {"tag": "input", "type": "text", "value": hrmos_runner.PROFILE["address2"]},
        {"tag": "input", "type": "text", "value": hrmos_runner.PROFILE["school"]},
        {"tag": "input", "type": "text", "value": hrmos_runner.PROFILE["department"]},
        {"tag": "select", "type": "select-one", "value": "degree-other", "selectedText": "その他"},
        {"tag": "select", "type": "select-one", "value": "school-start-year", "selectedText": "2020"},
        {"tag": "select", "type": "select-one", "value": "school-start-month", "selectedText": "9"},
        {"tag": "select", "type": "select-one", "value": "school-end-year", "selectedText": "2024"},
        {"tag": "select", "type": "select-one", "value": "school-end-month", "selectedText": "6"},
        {"tag": "input", "type": "text", "value": hrmos_runner.PROFILE["company"]},
        {"tag": "input", "type": "text", "value": hrmos_runner.PROFILE["position"]},
        {"tag": "input", "type": "text", "value": hrmos_runner.PROFILE["job_type"]},
        {"tag": "select", "type": "select-one", "value": "employment-full", "selectedText": "正社員"},
        {"tag": "select", "type": "select-one", "value": "work-start-year", "selectedText": "2024"},
        {"tag": "select", "type": "select-one", "value": "work-start-month", "selectedText": "10"},
        {"tag": "input", "type": "checkbox", "checked": True, "label": "現在働いている"},
        {"tag": "textarea", "type": "textarea", "value": hrmos_runner.PROFILE["work_body"]},
        {"tag": "textarea", "type": "textarea", "value": hrmos_runner.PROFILE["career_note"]},
        {"tag": "select", "type": "select-one", "value": "salary-yearly", "selectedText": "年収"},
        {"tag": "input", "type": "text", "value": hrmos_runner.PROFILE["current_salary"]},
        {"tag": "textarea", "type": "textarea", "value": hrmos_runner.PROFILE["message"]},
        {"tag": "input", "type": "file", "value": "resume.pdf"},
    ]

    checks = hrmos_runner.assert_prefill_ok(
        {"fields": fields, "body": "", "invalidVisibleFields": []},
        "resume.pdf",
        hrmos_runner.PROFILE["message"],
        False,
        True,
        False,
    )

    assert checks["degree"] is True
    assert checks["employment"] is True
    assert checks["current_salary_type"] is True
    assert checks["birth_year"] is False
    assert checks["school_start_year"] is False
    assert checks["work_start_year"] is False


def test_confirm_resume_file_check_only_requires_name_when_upload_field_was_present() -> None:
    assert runner.confirm_resume_file_check("確認画面", "resume.pdf", {}) is True
    assert runner.confirm_resume_file_check("resume.pdf", "resume.pdf", {"resume_file": [SimpleNamespace(index=1)]}) is True
    assert runner.confirm_resume_file_check("確認画面", "resume.pdf", {"resume_file": [SimpleNamespace(index=1)]}) is False
    assert runner.confirm_resume_file_check("resume.pdf", "resume.pdf", {"file": [SimpleNamespace(index=1)]}) is True
    assert runner.confirm_resume_file_check("確認画面", "resume.pdf", {"file": [SimpleNamespace(index=1)]}) is False


def test_build_input_plan_orders_actions_by_visible_field_index() -> None:
    classified = {
        "email": [SimpleNamespace(index=3, tag="input", type="email", label="メール")],
        "name": [SimpleNamespace(index=1, tag="input", type="text", label="氏名")],
        "file": [SimpleNamespace(index=9, tag="input", type="file", label="添付")],
        "consent": [SimpleNamespace(index=8, tag="input", type="checkbox", label="個人情報に同意")],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    assert [item["key"] for item in plan] == ["name", "email", "consent", "resume_file"]
    assert [item["kind"] for item in plan] == ["text", "text", "known_fact", "file"]


def test_build_input_plan_allows_google_search_discovery_source() -> None:
    classified = {
        "discovery_source": [
            SimpleNamespace(
                index=18,
                tag="input",
                type="radio",
                label="社員のTwitter | 応募のきっかけ\n必須\n\t\n社員のTwitter\nGoogle検索\nその他 | 社員のTwitter",
            )
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    discovery_item = next(item for item in plan if item["key"] == "discovery_source")
    assert "Google検索" in discovery_item["options"]
    assert "Green" in discovery_item["options"]


def test_build_input_plan_allows_company_website_discovery_source() -> None:
    classified = {
        "discovery_source": [
            SimpleNamespace(
                index=9,
                tag="select",
                type="select",
                label="応募のきっかけ\n必須\n\t\n選択\n弊社Webサイトを見たから\n求人媒体を見たから\nその他",
            )
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    discovery_item = next(item for item in plan if item["key"] == "discovery_source")
    assert "弊社Webサイト" in discovery_item["options"]
    assert "求人媒体" in discovery_item["options"]


def test_build_input_plan_includes_discovery_source_select_when_radio_scores_higher() -> None:
    classified = {
        "discovery_source": [
            SimpleNamespace(
                index=12,
                tag="input",
                type="radio",
                label="Green | 応募のきっかけ（他社様サービスの場合）\nOpenWork\nWantedly\nGreen\nビズリーチ | Green",
                confidence=96,
            ),
            SimpleNamespace(
                index=9,
                tag="select",
                type="select",
                label="応募のきっかけ\n必須\n\t\n選択\n弊社Webサイトを見たから\n求人媒体を見たから\nその他",
                confidence=90,
            ),
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")
    discovery_indexes = [item["field"]["index"] for item in plan if item["key"] == "discovery_source"]

    assert discovery_indexes == [9, 12]


def test_build_input_plan_allows_other_for_planb_source_group() -> None:
    classified = {
        "discovery_source": [
            SimpleNamespace(
                index=23,
                tag="input",
                type="checkbox",
                label="その他 | 該当項目を選択してください。（複数選択可）\n必須\n\t\nPLAN-B社員からの紹介\nPLAN-B配信コンテンツ（note・YouTube・X）を見て知った\nGreen\nOpenWork\nビズリーチ\nその他 | その他",
            )
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    discovery_item = next(item for item in plan if item["key"] == "discovery_source")
    assert r"^その他$" in discovery_item["options"]


def test_build_input_plan_fills_discovery_source_textarea() -> None:
    classified = {
        "discovery_source": [
            SimpleNamespace(
                index=14,
                tag="textarea",
                type="textarea",
                label="Helpfeelを知ったきっかけについて教えてください\n必須\n⑦その他（具体的なきっかけをご記入ください）",
            )
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    discovery_item = next(item for item in plan if item["key"] == "discovery_source")
    assert discovery_item["kind"] == "known_fact"
    assert discovery_item["value"] == "その他（当社採用サイト）"


def test_build_input_plan_handles_moneyforward_safe_required_options() -> None:
    classified = {
        "preferred_location": [
            SimpleNamespace(index=7, tag="input", type="checkbox", label="東京 | 希望勤務地を教えてください。 | 東京")
        ],
        "referral_notification": [
            SimpleNamespace(
                index=18,
                tag="select",
                type="select",
                label="エントリーしたことを上記社員に伝えますか？ ※社員紹介に該当しない場合はこちらをご選択ください※",
            )
        ],
        "job_search_intent": [
            SimpleNamespace(index=19, tag="select", type="select", label="転職に関する意向 積極的に転職活動中（選考を希望する）")
        ],
        "consent": [
            SimpleNamespace(index=25, tag="input", type="radio", label="以下、メール受信設定についての説明を読みました")
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    location_item = next(item for item in plan if item["key"] == "preferred_location")
    referral_item = next(item for item in plan if item["key"] == "referral_notification")
    intent_item = next(item for item in plan if item["key"] == "job_search_intent")
    consent_item = next(item for item in plan if item["key"] == "consent")

    assert location_item["options"] == [r"^東京$", r"東京"]
    assert referral_item["options"] == [r"社員紹介に該当しない", r"該当しない"]
    assert intent_item["options"] == [r"積極的に転職活動中", r"選考を希望"]
    assert r"読みました" in consent_item["options"]
    assert r"承知" in consent_item["options"]


def test_build_input_plan_uses_global_for_english_applying_location_select() -> None:
    classified = {
        "preferred_location": [
            SimpleNamespace(
                index=0,
                tag="select",
                type="select",
                label="Select...\nGlobal\nDubai\nHong Kong\nSingapore | Which location are you applying for?",
            )
        ]
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")
    item = next(item for item in plan if item["key"] == "preferred_location")

    assert item["value"] == "Global"
    assert item["options"] == [r"^Global$"]


def test_prefill_checks_accept_optional_english_referral_field_left_blank() -> None:
    fields = [
        {
            "index": 13,
            "tag": "input",
            "type": "text",
            "required": False,
            "value": "",
            "label": "If you have discussed this role with a current employee, please enter their full name here. If you have not spoken to anyone, please leave this field blank",
        }
    ]
    classified = {
        "referral_notification": [
            SimpleNamespace(
                index=13,
                tag="input",
                type="text",
                label="If you have discussed this role with a current employee, please enter their full name here. If you have not spoken to anyone, please leave this field blank",
            )
        ]
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["referral_notification"] is True


def test_pre_submit_reviewer_blocks_japanese_name_in_english_application() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "text", "label": "", "value": "", "required": False},
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "value": runner.PROFILE["name"],
            "label": "Name",
        }
    ]

    result = runner.pre_submit_reviewer_result(
        fields,
        {"name": True, "email": True},
        Path("/tmp/Nichika Tanaka＿Reume.pdf"),
        {},
    )

    assert result["ok"] is False
    assert result["failures"][0]["type"] == "english_application_japanese_name_value"


def test_pre_submit_reviewer_blocks_optional_referral_text_when_blank_requested() -> None:
    field = SimpleNamespace(
        index=0,
        label="If you have discussed this role with a current employee, please enter their full name here. If you have not spoken to anyone, please leave this field blank",
    )
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "text",
            "value": "No referral",
            "label": field.label,
        }
    ]

    result = runner.pre_submit_reviewer_result(
        fields,
        {"name": True, "email": True},
        Path("/tmp/Nichika Tanaka＿Reume.pdf"),
        {"referral_notification": [field]},
    )

    assert result["ok"] is False
    assert result["failures"][0]["type"] == "optional_referral_field_should_be_blank"


def test_pre_submit_reviewer_accepts_clean_english_application_values() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "text", "value": runner.PROFILE["name_en"], "label": "Name"},
        {"index": 2, "tag": "input", "type": "text", "value": runner.PROFILE["residence_en"], "label": "Location"},
    ]

    result = runner.pre_submit_reviewer_result(
        fields,
        {"name": True, "email": True},
        Path("/tmp/Nichika Tanaka＿Reume.pdf"),
        {},
    )

    assert result["ok"] is True


def test_pre_submit_reviewer_blocks_replit_english_form_japanese_resume_and_wrong_field_leak() -> None:
    english_context = (
        "Submit your application to Replit. Please complete this application in English. "
        "We review applications for global remote roles and require accurate answers before submission."
    )
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "value": runner.PROFILE["name"],
            "label": f"Full Name {english_context}",
        },
        {
            "index": 2,
            "tag": "input",
            "type": "file",
            "value": "職務経歴書＿田仲二千 .pdf",
            "label": f"Resume/CV {english_context}",
        },
        {
            "index": 3,
            "tag": "textarea",
            "type": "textarea",
            "value": runner.PROFILE["name"],
            "label": (
                "If you want to share something you built with Replit, please include a Replit profile URL. "
                f"{english_context}"
            ),
        },
        {
            "index": 4,
            "tag": "input",
            "type": "text",
            "value": "1000万円",
            "label": f"What is your desired salary range? {english_context}",
        },
    ]

    result = runner.pre_submit_reviewer_result(
        fields,
        {"name": True, "resume_file": True, "expected_salary": True},
        Path("/tmp/職務経歴書＿田仲二千 .pdf"),
        {},
    )

    failure_types = {failure["type"] for failure in result["failures"]}
    assert result["ok"] is False
    assert result["form_language"] == "english"
    assert "english_form_non_english_resume_before_submit" in failure_types
    assert "english_application_japanese_name_value" in failure_types
    assert "english_application_japanese_text_value" in failure_types
    assert "identity_value_in_wrong_field_before_submit" in failure_types


def test_pre_submit_reviewer_blocks_english_confirm_body_japanese_leak_without_controls() -> None:
    body = (
        "Submit your application to Replit. Please review your application before final submission. "
        "Full Name 田仲 二千 Resume/CV 職務経歴書＿田仲二千 .pdf "
        "This global remote application must be completed in English before submission."
    )

    result = runner.pre_submit_reviewer_result(
        [],
        {"name": True, "resume_file": True},
        Path("/tmp/職務経歴書＿田仲二千 .pdf"),
        {},
        body,
    )

    failure_types = {failure["type"] for failure in result["failures"]}
    assert result["ok"] is False
    assert result["form_language"] == "english"
    assert "english_form_non_english_resume_before_submit" in failure_types
    assert "english_application_japanese_name_value" in failure_types
    assert "english_application_japanese_text_value" in failure_types


def test_pre_submit_reviewer_blocks_short_english_confirm_body_japanese_leak_without_controls() -> None:
    body = "Review application\nFull Name 田仲 二千\nResume/CV 職務経歴書＿田仲二千 .pdf\nSubmit"

    result = runner.pre_submit_reviewer_result(
        [],
        {"name": True, "resume_file": True},
        Path("/tmp/職務経歴書＿田仲二千 .pdf"),
        {},
        body,
    )

    failure_types = {failure["type"] for failure in result["failures"]}
    assert result["ok"] is False
    assert result["form_language"] == "english"
    assert "english_form_non_english_resume_before_submit" in failure_types
    assert "english_application_japanese_name_value" in failure_types
    assert "english_application_japanese_text_value" in failure_types


def test_pre_submit_reviewer_blocks_japanese_long_text_in_english_language_prompt() -> None:
    fields = [
        {
            "index": 1,
            "tag": "textarea",
            "type": "textarea",
            "value": "日本語でのSEO記事制作とSNS運用を担当していました。",
            "label": (
                "Japanese language experience. Please describe your experience supporting content quality, "
                "customer communication, localization, and marketing workflows for a global remote role."
            ),
        }
    ]

    result = runner.pre_submit_reviewer_result(
        fields,
        {"application_message": True},
        Path("/tmp/Nichika Tanaka＿Reume.pdf"),
        {},
    )

    assert result["ok"] is False
    assert any(failure["type"] == "english_application_japanese_text_value" for failure in result["failures"])


def test_pre_submit_reviewer_records_semantic_question_reviews() -> None:
    classified = {
        "work_authorization": [
            SimpleNamespace(
                index=0,
                tag="input",
                type="radio",
                label="Are you legally authorized to work in the United States?",
                confidence=92,
            )
        ]
    }
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "radio",
            "required": True,
            "checked": True,
            "value": "Yes",
            "label": "Are you legally authorized to work in the United States?",
        }
    ]

    result = runner.pre_submit_reviewer_result(
        fields,
        {"work_authorization": True},
        Path("/tmp/Nichika Tanaka＿Reume.pdf"),
        classified,
    )

    assert result["ok"] is True
    assert result["question_reviews"][0]["key"] == "work_authorization"
    assert result["question_reviews"][0]["risk_level"] == "medium"
    assert result["question_reviews"][0]["checked"] is True
    assert result["question_reviews"][0]["value_excerpt"].startswith("CHECKED:")
    assert "user-provided" in result["question_reviews"][0]["evidence_basis"]


def test_pre_submit_reviewer_blocks_required_low_confidence_question() -> None:
    classified = {
        "application_message": [
            SimpleNamespace(
                index=0,
                tag="textarea",
                type="textarea",
                label="Tell us something important",
                confidence=70,
            )
        ]
    }
    fields = [
        {
            "index": 0,
            "tag": "textarea",
            "type": "textarea",
            "required": True,
            "value": "I am interested in this role.",
            "label": "Tell us something important",
        }
    ]

    result = runner.pre_submit_reviewer_result(
        fields,
        {"application_message": True},
        Path("/tmp/Nichika Tanaka＿Reume.pdf"),
        classified,
    )

    assert result["ok"] is False
    assert result["failures"][0]["type"] == "high_risk_semantic_question_before_submit"


def test_pre_submit_reviewer_blocks_required_unproven_experience_claim() -> None:
    classified = {
        "role_experience_b2b_saas": [
            SimpleNamespace(
                index=0,
                tag="input",
                type="radio",
                label="Do you have B2B SaaS experience?",
                confidence=88,
            )
        ]
    }
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "radio",
            "required": True,
            "checked": True,
            "value": "Yes",
            "label": "Do you have B2B SaaS experience?",
        }
    ]

    result = runner.pre_submit_reviewer_result(
        fields,
        {"role_experience_b2b_saas": True},
        Path("/tmp/Nichika Tanaka＿Reume.pdf"),
        classified,
    )

    assert result["ok"] is False
    assert result["question_reviews"][0]["risk_level"] == "high"
    assert "explicit user/resume evidence" in result["question_reviews"][0]["review_notes"][-1]


def test_execute_input_plan_rejects_non_numeric_text_for_number_field() -> None:
    plan = [
        {
            "key": "application_message",
            "kind": "text",
            "field": {"index": 0, "tag": "input", "type": "number", "label": "Years of experience"},
            "value": "I am interested in this role.",
        }
    ]

    with pytest.raises(RuntimeError, match="non_numeric_value_for_number_field_before_fill"):
        runner.execute_input_plan(object(), plan)


def test_execute_input_plan_falls_back_to_page_file_inputs(monkeypatch) -> None:
    fields = [{"index": 0, "tag": "input", "type": "file", "label": "Resume/CV", "visible": True, "enabled": True}]
    uploaded: list[str] = []

    class FakeControlLocator:
        def set_input_files(self, value, timeout=None):
            raise RuntimeError("direct file input unavailable")

    class FakeFileInputLocator:
        def count(self):
            return 1

        def nth(self, index):
            return self

        def evaluate(self, expression):
            return ""

        def set_input_files(self, value, timeout=None):
            uploaded.append(value)

    class FakeOtherLocator:
        def count(self):
            return 0

    class FakePage:
        def wait_for_timeout(self, timeout):
            return None

        def locator(self, selector):
            if selector == 'input[type="file"]':
                return FakeFileInputLocator()
            return FakeOtherLocator()

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "assert_field_signature_current", lambda page, field: None)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeControlLocator())

    applied = runner.execute_input_plan(
        FakePage(),
        [
            {
                "key": "resume_file",
                "kind": "file",
                "field": {"index": 0, "tag": "input", "type": "file", "label": "Resume/CV"},
                "value": "/tmp/resume.pdf",
            }
        ],
    )

    assert applied == ["resume_file"]
    assert uploaded == ["/tmp/resume.pdf"]


def test_build_input_plan_handles_disability_certificate_target_outside() -> None:
    classified = {
        "disability_certificate_status": [
            SimpleNamespace(
                index=26,
                tag="input",
                type="radio",
                label="対象外 | 障がい者手帳の有無について\n必須\n\t\n対象外\n身体障がい\n精神障がい\nその他 | 対象外",
            )
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    status_item = next(item for item in plan if item["key"] == "disability_certificate_status")
    assert status_item["value"] == "対象外"
    assert status_item["options"] == [r"^対象外$", r"対象外"]


def test_build_input_plan_handles_application_condition_ack() -> None:
    classified = {
        "application_condition_ack": [
            SimpleNamespace(
                index=28,
                tag="input",
                type="radio",
                label="はい | 応募条件を確認しましたか？\n必須\n\t\nはい | はい",
            )
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    ack_item = next(item for item in plan if item["key"] == "application_condition_ack")
    assert ack_item["value"] == "はい"
    assert ack_item["options"] == [r"^はい$", r"はい"]


def test_moneyforward_safe_option_readback_requires_expected_values() -> None:
    fields = [{"index": index, "tag": "input", "type": "text", "label": "", "value": ""} for index in range(20)]
    fields[7] = {
        "index": 7,
        "tag": "input",
        "type": "checkbox",
        "name": "",
        "label": "東京 | 希望勤務地を教えてください。 | 東京",
        "value": "on",
        "checked": True,
    }
    fields[18] = {
        "index": 18,
        "tag": "select",
        "type": "select",
        "label": "エントリーしたことを上記社員に伝えますか？",
        "value": "4: ※社員紹介に該当しない場合はこちらをご選択ください※",
        "options": [
            {"label": "伝える", "value": "1: 伝える"},
            {"label": "※社員紹介に該当しない場合はこちらをご選択ください※", "value": "4: ※社員紹介に該当しない場合はこちらをご選択ください※"},
        ],
    }
    fields[19] = {
        "index": 19,
        "tag": "select",
        "type": "select",
        "label": "転職に関する意向",
        "value": "3: 積極的に転職活動中（選考を希望する）",
        "options": [
            {"label": "まずはカジュアルに話を聞いてみたい", "value": "1: まずはカジュアルに話を聞いてみたい"},
            {"label": "積極的に転職活動中（選考を希望する）", "value": "3: 積極的に転職活動中（選考を希望する）"},
        ],
    }
    classified = {
        "preferred_location": [SimpleNamespace(index=7)],
        "referral_notification": [SimpleNamespace(index=18)],
        "job_search_intent": [SimpleNamespace(index=19)],
    }

    assert runner.classified_option_matches(fields, classified["preferred_location"], [r"^東京$", r"東京"])
    assert runner.classified_option_matches(fields, classified["referral_notification"], [r"社員紹介に該当しない", r"該当しない"])
    assert runner.classified_option_matches(fields, classified["job_search_intent"], [r"積極的に転職活動中", r"選考を希望"])

    fields[18]["value"] = "1: 伝える"
    assert not runner.classified_option_matches(fields, classified["referral_notification"], [r"社員紹介に該当しない", r"該当しない"])


def test_prefill_checks_require_discovery_source_readback() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "checkbox", "label": "Green | PLAN-Bを知った経緯 | Green", "value": "on", "checked": False},
        {"index": 1, "tag": "input", "type": "checkbox", "label": "その他 | PLAN-Bを知った経緯 | その他", "value": "on", "checked": True},
    ]
    classified = {"discovery_source": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["discovery_source"] is False

    fields[0]["checked"] = True
    fields[1]["checked"] = False
    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)
    assert checks["discovery_source"] is True


def test_prefill_checks_accept_company_website_discovery_source() -> None:
    fields = [
        {
            "index": 0,
            "tag": "select",
            "type": "select",
            "label": "応募のきっかけ",
            "value": "5: 弊社Webサイトを見たから",
            "options": [{"label": "弊社Webサイトを見たから", "value": "5: 弊社Webサイトを見たから"}],
        },
    ]
    classified = {"discovery_source": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["discovery_source"] is True


def test_prefill_checks_accept_textarea_discovery_source() -> None:
    fields = [
        {
            "index": 0,
            "tag": "textarea",
            "type": "textarea",
            "label": "Helpfeelを知ったきっかけについて教えてください",
            "value": "その他（当社採用サイト）",
        },
    ]
    classified = {"discovery_source": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["discovery_source"] is True


def test_prefill_checks_do_not_accept_unscoped_discovery_source_text() -> None:
    fields = [
        {"index": 0, "tag": "textarea", "type": "textarea", "label": "自由記入", "value": "その他（当社採用サイト）"},
        {"index": 1, "tag": "input", "type": "checkbox", "label": "Green | PLAN-Bを知った経緯 | Green", "value": "on", "checked": False},
    ]
    classified = {"discovery_source": [SimpleNamespace(index=1)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["discovery_source"] is False


def test_build_input_plan_uses_select_for_select_age_field() -> None:
    classified = {
        "age": [SimpleNamespace(index=1, tag="select", type="select-one", label="年齢")],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    assert plan == [
        {
            "key": "age",
            "kind": "select",
            "field": {"index": 1, "tag": "select", "type": "select-one", "label": "年齢"},
            "value": "25",
        }
    ]


def test_build_input_plan_includes_optional_education_and_career_fields() -> None:
    classified = {
        "school": [SimpleNamespace(index=1, tag="input", type="text", label="最終学歴")],
        "department": [SimpleNamespace(index=2, tag="input", type="text", label="学部・学科")],
        "degree": [SimpleNamespace(index=3, tag="select", type="select-one", label="学位")],
        "company": [SimpleNamespace(index=4, tag="input", type="text", label="現所属")],
        "employment": [SimpleNamespace(index=5, tag="input", type="text", label="雇用形態")],
        "work_body": [SimpleNamespace(index=6, tag="textarea", type="textarea", label="経歴")],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    assert [item["key"] for item in plan] == ["school", "department", "degree", "company", "employment", "work_body"]
    assert next(item for item in plan if item["key"] == "school")["value"] == runner.PROFILE["school"]
    assert next(item for item in plan if item["key"] == "department")["value"] == runner.PROFILE["department"]
    degree_item = next(item for item in plan if item["key"] == "degree")
    assert degree_item["kind"] == "select"
    assert degree_item["value"] == runner.PROFILE["degree"]
    assert next(item for item in plan if item["key"] == "company")["value"] == runner.PROFILE["company"]
    assert next(item for item in plan if item["key"] == "employment")["value"] == runner.PROFILE["employment"]
    assert next(item for item in plan if item["key"] == "work_body")["value"] == runner.PROFILE["work_body"]


def test_build_input_plan_separates_hope_note_ack_radio_from_textarea() -> None:
    classified = {
        "hope_note": [
            SimpleNamespace(
                index=6,
                tag="input",
                type="radio",
                label="確認しました | 希望記入欄の書き方について\n必須\n\t\n確認しました | 確認しました",
            ),
            SimpleNamespace(
                index=7,
                tag="textarea",
                type="text",
                label="希望記入欄\n必須\n\t\n給与・職種・勤務時間・勤務地などについて希望することがあれば記入してください",
            ),
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    assert plan == [
        {
            "key": "hope_note_ack",
            "kind": "known_fact",
            "field": {
                "index": 6,
                "tag": "input",
                "type": "radio",
                "label": "確認しました | 希望記入欄の書き方について\n必須\n\t\n確認しました | 確認しました",
            },
            "value": "確認しました",
            "options": [r"確認しました", r"確認"],
        },
        {
            "key": "hope_note",
            "kind": "text",
            "field": {
                "index": 7,
                "tag": "textarea",
                "type": "text",
                "label": "希望記入欄\n必須\n\t\n給与・職種・勤務時間・勤務地などについて希望することがあれば記入してください",
            },
            "value": runner.PROFILE["hope_note"],
        },
    ]


def test_build_input_plan_skips_non_fillable_text_classifications() -> None:
    classified = {
        "expected_salary": [
            SimpleNamespace(index=3, tag="input", type="radio", label="希望年収 確認しました"),
            SimpleNamespace(index=4, tag="input", type="checkbox", label="希望年収 確認しました"),
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    assert plan == []


def test_build_input_plan_includes_safe_postal_field() -> None:
    classified = {
        "postal": [SimpleNamespace(index=1, tag="input", type="tel", label="郵便番号")],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    assert plan == [
        {
            "key": "postal",
            "kind": "text",
            "field": {"index": 1, "tag": "input", "type": "tel", "label": "郵便番号"},
            "value": runner.PROFILE["postal"],
        }
    ]


def test_build_input_plan_targets_jlpt_unexamined_for_native_speaker() -> None:
    label = "N1 | 日本語能力試験のランクを教えてください\n必須\nN1\nN2\nN3\nN4\nN5\n未受験\n日本語ネイティブの方は「未受験」を選択してください | N1"
    classified = {
        "language": [SimpleNamespace(index=18, tag="input", type="radio", label=label)],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    language_item = next(item for item in plan if item["key"] == "language")
    assert language_item["value"] == "未受験"
    assert language_item["options"] == [r"^未受験$", r"未受験"]


def test_build_input_plan_does_not_target_jlpt_unexamined_without_native_instruction() -> None:
    label = "N1 | 日本語能力試験のランクを教えてください\n必須\nN1\nN2\nN3\nN4\nN5\n未受験 | N1"
    classified = {
        "language": [SimpleNamespace(index=18, tag="input", type="radio", label=label)],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    language_item = next(item for item in plan if item["key"] == "language")
    assert language_item["value"] == runner.PROFILE["language"]
    assert language_item["options"] == [r"日本語", r"Japanese", r"Business", r"ビジネス"]


def test_choose_radio_in_group_can_reach_jlpt_unexamined_without_radio_name(monkeypatch) -> None:
    fields = [
        {"index": 0, "type": "radio", "tag": "input", "name": "", "value": "on", "text": "", "label": "N1 | 日本語能力試験のランクを教えてください\n未受験\n日本語ネイティブの方は「未受験」を選択してください | N1", "checked": False},
        {"index": 1, "type": "radio", "tag": "input", "name": "", "value": "on", "text": "", "label": "未受験 | 日本語能力試験のランクを教えてください\n未受験\n日本語ネイティブの方は「未受験」を選択してください | 未受験", "checked": False},
    ]

    class FakeLocator:
        def __init__(self, index: int):
            self.index = index

        def check(self, timeout: int, force: bool) -> None:
            fields[self.index]["checked"] = True

    monkeypatch.setattr(runner, "capture_controls", lambda page: fields)
    monkeypatch.setattr(runner, "control_locator", lambda page, field: FakeLocator(field.index))

    ok = runner.choose_radio_in_group(FakePage("https://example.com"), SimpleNamespace(index=0), [r"^未受験$", r"未受験"])

    assert ok is True
    assert fields[0]["checked"] is False
    assert fields[1]["checked"] is True


def test_prefill_checks_accepts_herp_file_names_from_body_text() -> None:
    fields = [
        {"tag": "input", "type": "file", "value": "", "label": "履歴書のアップロード"},
        {"tag": "input", "type": "file", "value": "", "label": "職務経歴書のアップロード"},
    ]
    classified = {
        "resume_file": [SimpleNamespace(index=0)],
        "career_file": [SimpleNamespace(index=1)],
    }

    checks = runner.prefill_checks(
        fields,
        "履歴書＿田仲二千.pdf",
        "職歴書＿田仲二千.pdf",
        "message",
        classified,
        "履歴書＿田仲二千.pdf\n職歴書＿田仲二千.pdf",
    )

    assert checks["resume_file"] is True
    assert checks["career_file"] is True


def test_prefill_checks_detect_remote_preference_in_input_values() -> None:
    fields = [
        {"tag": "input", "type": "text", "value": "田仲 二千"},
        {"tag": "input", "type": "text", "value": "フルリモート勤務を希望します"},
    ]

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", {})

    assert checks["no_remote_preference_in_free_text"] is False


def test_choice_matches_common_select_labels_and_values() -> None:
    assert runner.choice_matches({"label": "25歳", "value": "age_25"}, ["25"]) is True
    assert runner.choice_matches({"label": "2000 年", "value": "2000"}, ["2000"]) is True
    assert runner.choice_matches({"label": "700万円", "value": "salary_700"}, ["700"]) is True


def test_prefill_checks_accepts_classified_consent_checkbox_readback() -> None:
    fields = [
        {"tag": "input", "type": "checkbox", "checked": True, "label": "個人情報の取り扱いに同意します", "value": "true", "name": "privacy"},
        {"tag": "input", "type": "checkbox", "checked": False, "label": "ニュースを受け取る", "value": "true", "name": "newsletter"},
    ]
    classified = {"consent": [SimpleNamespace(index=0, name="privacy")]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["consent"] is True


def test_consent_checkbox_checked_from_controls_matches_privacy_label() -> None:
    fields = [
        {"type": "checkbox", "checked": False, "label": "ニュースを受け取る", "name": "newsletter"},
        {"type": "checkbox", "checked": True, "label": "応募にあたり個人情報の取り扱いに同意します", "name": "privacyPolicy"},
    ]

    assert runner.consent_checkbox_checked_from_controls(fields) is True


def test_prefill_checks_rejects_visible_but_unchecked_privacy_consent() -> None:
    fields = [
        {
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "visible": True,
            "enabled": True,
            "label": "応募にあたり個人情報の取り扱いに同意します",
            "name": "privacyPolicy",
            "value": "true",
        },
    ]
    classified = {"consent": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["consent"] is False


def test_prefill_checks_accepts_radio_privacy_consent() -> None:
    fields = [
        {
            "tag": "input",
            "type": "radio",
            "checked": True,
            "visible": True,
            "enabled": True,
            "label": "同意します | 個人情報の取り扱いについて 必須 | 同意します",
            "name": "",
            "value": "on",
        },
    ]
    classified = {"consent": [SimpleNamespace(index=0, name="")]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["consent"] is True


def test_prefill_checks_normalizes_phone_and_ignores_absent_phone_field() -> None:
    fields = [
        {"tag": "input", "type": "tel", "value": "+81 90-8834-3768", "label": "電話番号"},
    ]
    classified = {"phone": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["phone"] is True

    checks = runner.prefill_checks([], "resume.pdf", "career.pdf", "message", classified)

    assert checks["phone"] is True


def test_prefill_checks_requires_current_working_checkbox_readback() -> None:
    fields = [
        {"tag": "input", "type": "checkbox", "checked": False, "label": "現在働いている | 在籍期間 必須", "value": "on"},
    ]
    classified = {"current_working": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["current_working"] is False

    fields[0]["checked"] = True
    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["current_working"] is True


def test_prefill_checks_accepts_polite_current_working_label() -> None:
    fields = [
        {"tag": "input", "type": "checkbox", "checked": True, "label": "現在働いています | 在籍期間 必須", "value": "on"},
    ]
    classified = {"current_working": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["current_working"] is True


def test_prefill_checks_accepts_current_working_after_dom_index_shift() -> None:
    fields = [
        {"tag": "select", "type": "select", "checked": False, "label": "在籍期間 必須"},
        {"tag": "input", "type": "checkbox", "checked": True, "label": "現在働いている | 現在働いている", "value": "on"},
    ]
    classified = {"current_working": [SimpleNamespace(index=3)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["current_working"] is True


def test_prefill_checks_rejects_unrelated_checked_field_after_current_working_shift() -> None:
    fields = [
        {"tag": "input", "type": "checkbox", "checked": True, "label": "present portfolio materials", "value": "on"},
    ]
    classified = {"current_working": [SimpleNamespace(index=3)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["current_working"] is False


def test_prefill_checks_rejects_same_label_checked_field_far_from_current_working_match() -> None:
    fields = [
        {"tag": "input", "type": "checkbox", "checked": True, "label": "現在働いている | 現在働いている", "value": "on"},
        {"tag": "input", "type": "checkbox", "checked": False, "label": "dummy", "value": "on"},
        {"tag": "input", "type": "checkbox", "checked": False, "label": "dummy", "value": "on"},
        {"tag": "input", "type": "checkbox", "checked": False, "label": "dummy", "value": "on"},
        {"tag": "input", "type": "checkbox", "checked": False, "label": "現在働いている | 現在働いている", "value": "on"},
    ]
    classified = {"current_working": [SimpleNamespace(index=4)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["current_working"] is False


def test_prefill_checks_accepts_broader_safe_job_type_readback() -> None:
    fields = [
        {"tag": "select", "type": "select", "value": "2: カスタマーサクセス", "label": "職種 必須"},
    ]
    classified = {"job_type": [SimpleNamespace(index=0)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["job_type"] is True


def test_prefill_checks_do_not_accept_unscoped_job_type_text() -> None:
    fields = [
        {"tag": "input", "type": "text", "value": "マーケティング経験があります", "label": "自己PR"},
        {"tag": "select", "type": "select", "value": "", "label": "職種 必須"},
    ]
    classified = {"job_type": [SimpleNamespace(index=1)]}

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["job_type"] is False


def test_build_input_plan_fills_repeated_period_and_salary_fields() -> None:
    classified = {
        "education_period": [
            SimpleNamespace(key="education_period", index=index, tag="select", type="select", label="在籍期間", confidence=70)
            for index in range(10, 18)
        ],
        "expected_salary": [
            SimpleNamespace(key="expected_salary", index=30, tag="input", type="text", label="希望年収", confidence=90),
            SimpleNamespace(key="expected_salary", index=31, tag="input", type="text", label="最低希望年収", confidence=90),
        ],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")

    period_actions = [item for item in plan if item["key"] == "education_period"]
    salary_actions = [item for item in plan if item["key"] == "expected_salary"]

    assert [item["value"] for item in period_actions] == ["2020", "9", "2024", "6", "2024", "10", "2026", "6"]
    assert len(salary_actions) == 2


def test_build_input_plan_defers_current_working_checkbox_after_signature_sensitive_fields() -> None:
    classified = {
        "work_body": [SimpleNamespace(key="work_body", index=28, tag="textarea", type="text", label="業務内容", confidence=75)],
        "current_working": [SimpleNamespace(key="current_working", index=27, tag="input", type="checkbox", label="現在働いている", confidence=85)],
        "resume_file": [SimpleNamespace(key="resume_file", index=29, tag="input", type="file", label="ファイルを選択", confidence=90)],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")

    assert [item["key"] for item in plan] == ["work_body", "resume_file", "current_working"]


def test_build_input_plan_fills_all_required_consent_fields() -> None:
    classified = {
        "consent": [
            SimpleNamespace(key="consent", index=12, tag="input", type="radio", label="採用情報の配信に同意する", confidence=85),
            SimpleNamespace(key="consent", index=13, tag="input", type="radio", label="個人情報の取り扱いに同意する", confidence=85),
        ],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")

    consent_actions = [item for item in plan if item["key"] == "consent"]

    assert [item["field"]["index"] for item in consent_actions] == [12, 13]


def test_build_input_plan_uses_english_defaults_for_global_forms() -> None:
    classified = {
        "residence": [SimpleNamespace(key="residence", index=1, tag="input", type="text", label="Where do you live? e.g. City, Country", confidence=90)],
        "job_change_timing": [SimpleNamespace(key="job_change_timing", index=2, tag="input", type="text", label="When can you start? / availability", confidence=90)],
        "country": [SimpleNamespace(key="country", index=3, tag="select", type="select-one", label="Country", confidence=85)],
        "work_authorization": [SimpleNamespace(key="work_authorization", index=4, tag="input", type="radio", label="Are you legally authorized to work in the United States?", confidence=90)],
        "visa_sponsorship": [SimpleNamespace(key="visa_sponsorship", index=5, tag="input", type="radio", label="Will you now or in the future require visa sponsorship?", confidence=90)],
        "expected_salary": [SimpleNamespace(key="expected_salary", index=6, tag="input", type="text", label="What are your salary expectations? Please include your local currency, and a range of minimum to maximum", confidence=90)],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")
    by_key = {item["key"]: item for item in plan}

    assert by_key["residence"]["value"] == runner.PROFILE["residence_en"]
    assert by_key["job_change_timing"]["value"] == runner.PROFILE["job_change_timing_en"]
    assert by_key["country"]["value"] == "Japan"
    assert by_key["work_authorization"]["value"] == ""
    assert by_key["visa_sponsorship"]["value"] == "No"
    assert by_key["expected_salary"]["value"] == runner.PROFILE["expected_salary_en"]


def test_prefill_checks_uses_role_context_for_country_role_work_authorization() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "text", "label": "", "value": "", "required": False},
        {
            "index": 1,
            "tag": "input",
            "type": "radio",
            "label": "Yes | Are you legally authorized to work in the country this role is located in?",
            "checked": True,
            "value": "Yes",
            "required": True,
        },
        {
            "index": 2,
            "tag": "input",
            "type": "radio",
            "label": "No | Will you now, or in the future, require sponsorship for employment visa status?",
            "checked": True,
            "value": "No",
            "required": True,
        },
    ]
    classified = {
        "work_authorization": [
            SimpleNamespace(index=1, tag="input", type="radio", label=fields[1]["label"], confidence=90)
        ],
        "visa_sponsorship": [
            SimpleNamespace(index=2, tag="input", type="radio", label=fields[2]["label"], confidence=90)
        ],
    }

    checks = runner.prefill_checks(
        fields,
        "Nichika Tanaka＿Reume.pdf",
        "career.pdf",
        "message",
        classified,
        role="Japan Growth Lead",
    )

    assert checks["work_authorization"] is True
    assert checks["visa_sponsorship"] is True


def test_build_input_plan_uses_english_salary_for_compensation_expectations() -> None:
    classified = {
        "expected_salary": [
            SimpleNamespace(
                key="expected_salary",
                index=6,
                tag="input",
                type="text",
                label="What are your compensation expectations for your next role?",
                confidence=90,
            )
        ],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")
    by_key = {item["key"]: item for item in plan}

    assert by_key["expected_salary"]["value"] == runner.PROFILE["expected_salary_en"]


def test_build_input_plan_uses_english_salary_for_desired_salary_range() -> None:
    classified = {
        "expected_salary": [
            SimpleNamespace(
                key="expected_salary",
                index=4,
                tag="input",
                type="text",
                label="What is your desired salary range?",
                confidence=90,
            )
        ],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")
    by_key = {item["key"]: item for item in plan}

    assert by_key["expected_salary"]["value"] == runner.PROFILE["expected_salary_en"]


def test_build_input_plan_fills_safe_negative_na_and_signature_fields() -> None:
    classified = {
        "negative_confirmation": [
            SimpleNamespace(key="negative_confirmation", index=11, tag="input", type="text", label="Are you currently an iHerb Core Team Member?*", confidence=90),
        ],
        "not_applicable_text": [
            SimpleNamespace(key="not_applicable_text", index=13, tag="input", type="text", label="Employee ID? (say N/A if you are not currently an iHerb core team member)", confidence=90),
            SimpleNamespace(key="not_applicable_text", index=26, tag="textarea", type="textarea", label='If "Yes" list business activities here. If "No", you can say N/A.', confidence=90),
        ],
        "signature_name": [
            SimpleNamespace(key="signature_name", index=41, tag="input", type="text", label="Employment Application - Certification*", confidence=90)
        ],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")
    by_index = {item["field"]["index"]: item for item in plan}

    assert by_index[11]["value"] == "No"
    assert by_index[13]["value"] == "N/A"
    assert by_index[26]["value"] == "N/A"
    assert by_index[41]["value"] == runner.PROFILE["name_en"]


def test_prefill_checks_accept_safe_negative_na_and_signature_readback() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "text", "label": "", "value": "", "required": False},
        {"index": 1, "tag": "input", "type": "text", "label": "Are you currently an iHerb Core Team Member?*", "value": "No", "required": True},
        {"index": 2, "tag": "input", "type": "text", "label": "Employee ID? (say N/A if you are not currently an iHerb core team member)", "value": "N/A", "required": True},
        {"index": 3, "tag": "input", "type": "text", "label": "Employment Application - Certification*", "value": runner.PROFILE["name_en"], "required": True},
    ]
    classified = {
        "negative_confirmation": [SimpleNamespace(index=1, tag="input", type="text", label=fields[1]["label"], confidence=90)],
        "not_applicable_text": [SimpleNamespace(index=2, tag="input", type="text", label=fields[2]["label"], confidence=90)],
        "signature_name": [SimpleNamespace(index=3, tag="input", type="text", label=fields[3]["label"], confidence=90)],
    }

    checks = runner.prefill_checks(fields, "Nichika Tanaka＿Reume.pdf", "career.pdf", "message", classified)

    assert checks["negative_confirmation"] is True
    assert checks["not_applicable_text"] is True
    assert checks["signature_name"] is True


def test_build_input_plan_uses_japan_authorization_for_japan_context() -> None:
    classified = {
        "work_authorization": [SimpleNamespace(key="work_authorization", index=4, tag="input", type="radio", label="Are you legally authorized to work in Japan?", confidence=90)],
        "visa_sponsorship": [SimpleNamespace(key="visa_sponsorship", index=5, tag="input", type="radio", label="Will you require Japan visa sponsorship?", confidence=90)],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")
    by_key = {item["key"]: item for item in plan}

    assert by_key["work_authorization"]["value"] == "Yes"
    assert by_key["visa_sponsorship"]["value"] == "No"


def test_build_input_plan_treats_country_of_residence_support_as_japan_context() -> None:
    classified = {
        "visa_sponsorship": [
            SimpleNamespace(
                key="visa_sponsorship",
                index=5,
                tag="input",
                type="radio",
                label="Will you require sponsorship or support to be authorized to work from your country of residence?",
                confidence=90,
            )
        ],
    }

    plan = runner.build_input_plan(classified, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")
    by_key = {item["key"]: item for item in plan}

    assert by_key["visa_sponsorship"]["value"] == "No"


def test_visa_sponsorship_yes_no_employment_visa_uses_no_after_us_work_possible_fact() -> None:
    field = SimpleNamespace(
        label="Yes\nNo | Will you now or in the future require sponsorship for employment visa status?",
        type="checkbox",
    )

    value, options = runner.visa_sponsorship_answer(field)

    assert value == "No"
    assert any("No" in option for option in options)


def test_prefill_checks_accept_global_authorization_and_visa_readback() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "radio", "checked": True, "label": "Are you legally authorized to work in the United States? Yes", "value": "Yes", "name": "work"},
        {"index": 1, "tag": "input", "type": "radio", "checked": True, "label": "Will you now or in the future require visa sponsorship? No", "value": "No", "name": "visa"},
        {"index": 2, "tag": "input", "type": "text", "value": runner.PROFILE["job_change_timing_en"], "label": "When can you start?"},
        {"index": 3, "tag": "input", "type": "text", "value": runner.PROFILE["expected_salary_en"], "label": "What are your salary expectations?"},
    ]
    classified = {
        "work_authorization": [SimpleNamespace(index=0, label="Are you legally authorized to work in the United States?")],
        "visa_sponsorship": [SimpleNamespace(index=1, label="Will you now or in the future require visa sponsorship?")],
        "job_change_timing": [SimpleNamespace(index=2)],
        "expected_salary": [SimpleNamespace(index=3, label="What are your salary expectations? Please include your local currency, and a range of minimum to maximum")],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is True
    assert checks["visa_sponsorship"] is True
    assert checks["job_change_timing"] is True
    assert checks["expected_salary"] is True


def test_prefill_checks_use_visual_yes_no_for_ashby_authorization() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "Yes\nNo | Are you legally authorized to work in the country this role is located in?",
            "value": "on",
            "visual_selected_choice": "Yes",
        },
        {
            "index": 1,
            "tag": "input",
            "type": "checkbox",
            "checked": False,
            "label": "Yes\nNo | Will you now, or in the future, require sponsorship for employment visa status?",
            "value": "on",
            "visual_selected_choice": "No",
        },
    ]
    classified = {
        "work_authorization": [
            SimpleNamespace(index=0, label="Are you legally authorized to work in the country this role is located in?")
        ],
        "visa_sponsorship": [
            SimpleNamespace(index=1, label="Will you now, or in the future, require sponsorship for employment visa status?")
        ],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified, role="Japan Growth Lead")

    assert checks["work_authorization"] is True
    assert checks["visa_sponsorship"] is True


def test_prefill_checks_accept_global_authorization_text_readback() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "text",
            "value": "No",
            "label": "If located in the US, are you currently authorized to work in the US?",
        },
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "value": "Yes",
            "label": "Will you now or in the future require visa sponsorship?",
        },
    ]
    classified = {
        "work_authorization": [SimpleNamespace(index=0, label="If located in the US, are you currently authorized to work in the US?")],
        "visa_sponsorship": [SimpleNamespace(index=1, label="Will you now or in the future require visa sponsorship?")],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is True
    assert checks["visa_sponsorship"] is True


def test_prefill_checks_rejects_global_authorization_text_wrong_answers() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "text",
            "value": "Yes",
            "label": "Are you legally authorized to work in the United States?",
        },
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "value": "No",
            "label": "Will you now or in the future require visa sponsorship?",
        },
    ]
    classified = {
        "work_authorization": [SimpleNamespace(index=0, label="Are you legally authorized to work in the United States?")],
        "visa_sponsorship": [SimpleNamespace(index=1, label="Will you now or in the future require visa sponsorship?")],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is False
    assert checks["visa_sponsorship"] is False


def test_prefill_checks_rejects_japanese_salary_in_english_salary_field() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "text", "value": runner.PROFILE["expected_salary"], "label": "What are your salary expectations?"},
    ]
    classified = {
        "expected_salary": [SimpleNamespace(index=0, label="What are your salary expectations? Please include your local currency, and a range of minimum to maximum")],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["expected_salary"] is False


def test_prefill_checks_rejects_english_salary_value_in_wrong_field_only() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "text", "value": runner.PROFILE["expected_salary"], "label": "What are your salary expectations?"},
        {"index": 1, "tag": "input", "type": "text", "value": runner.PROFILE["expected_salary_en"], "label": "Unrelated notes"},
    ]
    classified = {
        "expected_salary": [SimpleNamespace(index=0, label="What are your salary expectations? Please include your local currency, and a range of minimum to maximum")],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["expected_salary"] is False


def test_prefill_checks_accept_number_salary_fields() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "number", "value": "5000000", "label": "Current salary"},
        {"index": 1, "tag": "input", "type": "number", "value": "10000000", "label": "Expected salary"},
    ]
    classified = {
        "current_salary": [SimpleNamespace(index=0, tag="input", type="number", label="Current salary")],
        "expected_salary": [SimpleNamespace(index=1, tag="input", type="number", label="Expected salary")],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)
    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")
    values_by_key = {item["key"]: item["value"] for item in plan}

    assert values_by_key["current_salary"] == "5000000"
    assert values_by_key["expected_salary"] == "10000000"
    assert checks["current_salary"] is True
    assert checks["expected_salary"] is True


def test_build_input_plan_uses_annual_usd_for_target_compensation_number_field() -> None:
    classified = {
        "expected_salary": [SimpleNamespace(index=1, tag="input", type="number", label="Target Compensation")],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")
    values_by_key = {item["key"]: item["value"] for item in plan}

    assert values_by_key["expected_salary"] == "150000"


def test_build_input_plan_fills_duplicate_safe_name_fields_for_english_resume() -> None:
    classified = {
        "name": [
            SimpleNamespace(index=1, tag="input", type="text", label="First and last name (preferred name)"),
            SimpleNamespace(index=2, tag="input", type="text", label="First and last name (legal name)"),
        ],
        "middle_name": [SimpleNamespace(index=3, tag="input", type="text", label="Middle Name")],
    }

    plan = runner.build_input_plan(
        classified,
        Path("/Users/nichikatanaka/Downloads/Nichika Tanaka＿Reume.pdf"),
        Path("career.pdf"),
        "message",
    )

    name_items = [item for item in plan if item["key"] == "name"]
    assert [item["field"]["index"] for item in name_items] == [1, 2]
    assert all(item["value"] == "Nichika Tanaka" for item in name_items)
    assert {item["key"]: item["value"] for item in plan}["middle_name"] == "N/A"


def test_build_input_plan_fills_multiple_required_application_message_fields() -> None:
    classified = {
        "application_message": [
            SimpleNamespace(
                index=8,
                tag="textarea",
                type="textarea",
                label=(
                    "Why do you want to join Umbrel? | Personal Website Optional | "
                    "If you get access to @umbrel X (Twitter) - what's the first thing you're posting?"
                ),
                primary_label="Why do you want to join Umbrel?",
            ),
            SimpleNamespace(
                index=9,
                tag="textarea",
                type="textarea",
                label=(
                    "If you get access to @umbrel X (Twitter) - what's the first thing you're posting? | "
                    "Why do you want to join Umbrel?"
                ),
                primary_label="If you get access to @umbrel X (Twitter) - what's the first thing you're posting?",
            ),
        ],
    }

    plan = runner.build_input_plan(
        classified,
        Path("/Users/nichikatanaka/Downloads/Nichika Tanaka＿Reume.pdf"),
        Path("career.pdf"),
        "Role-specific message",
    )

    message_items = [item for item in plan if item["key"] == "application_message"]
    assert [item["field"]["index"] for item in message_items] == [8, 9]
    assert message_items[0]["value"] == "Role-specific message"
    assert "real user workflow" in message_items[1]["value"]
    assert "home-server setup" in message_items[1]["value"]


def test_current_salary_text_field_with_man_yen_example_uses_numeric_man_yen() -> None:
    classified = {
        "current_salary": [
            SimpleNamespace(index=0, tag="input", type="text", label="現給与 例）1000円、300万円"),
        ],
    }

    plan = runner.build_input_plan(classified, Path("resume.pdf"), Path("career.pdf"), "message")

    assert {item["key"]: item["value"] for item in plan}["current_salary"] == "500"


def test_prefill_checks_accept_japan_authorization_and_visa_readback() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "radio", "checked": True, "label": "Are you legally authorized to work in Japan? Yes", "value": "Yes", "name": "work"},
        {"index": 1, "tag": "input", "type": "radio", "checked": True, "label": "Will you require Japan visa sponsorship? No", "value": "No", "name": "visa"},
    ]
    classified = {
        "work_authorization": [SimpleNamespace(index=0, label="Are you legally authorized to work in Japan?")],
        "visa_sponsorship": [SimpleNamespace(index=1, label="Will you require Japan visa sponsorship?")],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["work_authorization"] is True
    assert checks["visa_sponsorship"] is True


def test_prefill_checks_accept_role_experience_readback() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "radio", "checked": True, "label": "B2B Marketing experience 1 - 3 years", "value": "1 - 3", "name": "b2b"},
        {"index": 1, "tag": "input", "type": "radio", "checked": True, "label": "Regulated industry No regulated industry experience", "value": "No regulated industry experience", "name": "regulated"},
        {"index": 2, "tag": "input", "type": "radio", "checked": True, "label": "Digital marketing Multiple digital marketing channels", "value": "Multiple digital marketing channels", "name": "digital"},
        {"index": 3, "tag": "input", "type": "text", "value": "Yes - AI-focused content marketing, product storytelling, and campaign execution.", "label": "Do you have experience marketing for AI products?"},
        {"index": 4, "tag": "textarea", "type": "textarea", "value": "I translate technical topics into practical user-facing explanations with concrete examples and measurable outcomes.", "label": "Technical Experience"},
    ]
    classified = {
        "role_experience_b2b_marketing": [SimpleNamespace(index=0)],
        "role_experience_regulated_industry": [SimpleNamespace(index=1)],
        "role_experience_digital_marketing": [SimpleNamespace(index=2)],
        "role_experience_ai_product_marketing": [SimpleNamespace(index=3)],
        "role_experience_technical_translation": [SimpleNamespace(index=4)],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["role_experience_b2b_marketing"] is True
    assert checks["role_experience_regulated_industry"] is True
    assert checks["role_experience_digital_marketing"] is True
    assert checks["role_experience_ai_product_marketing"] is True
    assert checks["role_experience_technical_translation"] is True


def test_prefill_checks_reject_role_experience_mismatch() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "radio", "checked": True, "label": "B2B Marketing experience 5+ years", "value": "5+", "name": "b2b"},
    ]
    classified = {
        "role_experience_b2b_marketing": [SimpleNamespace(index=1)],
    }

    checks = runner.prefill_checks(fields, "resume.pdf", "career.pdf", "message", classified)

    assert checks["role_experience_b2b_marketing"] is False


def test_disabled_confirm_diagnostics_captures_disabled_buttons_and_invalid_controls(monkeypatch) -> None:
    class FakePageForDiagnostics:
        pass

    disabled_buttons = [{"text": "入力内容を確認する", "disabled": True, "validation": ""}]
    validation = {"invalidControls": [{"label": "電話番号", "validationMessage": "入力してください"}], "pageValidationText": ["必須項目です"]}
    blocking_state = {
        "matchedConfirmButtons": [{"text": "入力内容を確認する", "disabled": True, "dataAction": "enter"}],
        "requiredLikeEmptyControls": [{"label": "応募先へのメッセージ 必須", "value": ""}],
    }
    monkeypatch.setattr(runner, "disabled_action_buttons", lambda page: disabled_buttons)
    monkeypatch.setattr(runner, "form_validation_diagnostics", lambda page: validation)
    monkeypatch.setattr(runner, "confirm_blocking_state", lambda page, names: blocking_state)
    monkeypatch.setattr(runner, "hidden_human_verification_state", lambda page: {"present": False, "controls": []})

    diagnostics = runner.disabled_confirm_diagnostics(
        FakePageForDiagnostics(),
        {"phone": False},
        [{"index": 5, "label": "電話番号"}],
        TimeoutError("button disabled"),
    )

    assert "TimeoutError" in diagnostics["error"]
    assert diagnostics["disabled_buttons"] == disabled_buttons
    assert diagnostics["validation"] == validation
    assert diagnostics["confirm_blocking_state"] == blocking_state
    assert diagnostics["hidden_human_verification"] == {"present": False, "controls": []}
    assert diagnostics["checks"] == {"phone": False}
    assert diagnostics["unfilled_required"] == [{"index": 5, "label": "電話番号"}]


def test_disabled_confirm_outcome_classifies_hidden_human_verification_as_user_gate() -> None:
    state, blocker_reason, next_action = runner.disabled_confirm_outcome(
        {"hidden_human_verification": {"present": True, "controls": [{"tag": "IFRAME", "title": "reCAPTCHA"}]}}
    )

    assert state == "blocked_captcha_ready_for_user"
    assert blocker_reason == "blocked_captcha_ready_for_user"
    assert "CAPTCHA" in next_action


def test_disabled_confirm_outcome_keeps_hidden_token_only_retryable() -> None:
    state, blocker_reason, next_action = runner.disabled_confirm_outcome(
        {"hidden_human_verification": {"present": True, "controls": [{"name": "g-recaptcha-response", "visible": False}]}}
    )

    assert state == "retryable"
    assert blocker_reason == "herp_hidden_recaptcha_confirm_disabled"
    assert "anti-bot state changes" in next_action


def test_disabled_confirm_outcome_keeps_plain_disabled_button_retryable() -> None:
    state, blocker_reason, next_action = runner.disabled_confirm_outcome(
        {"hidden_human_verification": {"present": False, "controls": []}}
    )

    assert state == "retryable"
    assert blocker_reason == "confirm_button_disabled_before_submit"
    assert "repair" in next_action


def test_prefill_failure_outcome_prioritizes_remote_preference_stop() -> None:
    state, blocker_reason, next_action = runner.prefill_failure_outcome(
        {"no_remote_preference_in_free_text": False},
        [],
        2,
    )

    assert state == "retryable"
    assert blocker_reason == "remote_preference_in_free_text_before_submit"
    assert "remote/full-remote" in next_action


def test_prefill_with_same_candidate_repairs_retries_once_and_succeeds(monkeypatch, tmp_path) -> None:
    class FakePageForRepair:
        def wait_for_timeout(self, timeout):
            return None

    calls = {"execute": 0, "checks": 0}

    monkeypatch.setattr(runner, "build_input_plan", lambda classified, resume_file, career_file, message, role_context="", unknown_required=None: [])
    monkeypatch.setattr(runner, "execute_input_plan", lambda page, plan: calls.__setitem__("execute", calls["execute"] + 1) or [])
    monkeypatch.setattr(runner, "capture_controls", lambda page: [])
    monkeypatch.setattr(runner, "classify_fields", lambda fields: {})
    monkeypatch.setattr(runner, "unsafe_required_fields", lambda fields: [])
    monkeypatch.setattr(runner, "required_unknown_fields", lambda fields, classified, safe_keys: [])
    monkeypatch.setattr(runner, "required_unfilled_fields", lambda fields: [{"index": 1}] if calls["checks"] == 0 else [])
    monkeypatch.setattr(runner, "snap", lambda page, artifact_dir, name: "")

    def fake_prefill_checks(fields, resume_name, career_name, message, classified, body_text="", role=""):
        calls["checks"] += 1
        return {"name": calls["checks"] > 1, "no_remote_preference_in_free_text": True}

    monkeypatch.setattr(runner, "prefill_checks", fake_prefill_checks)

    result = runner.prefill_with_same_candidate_repairs(
        FakePageForRepair(),
        SimpleNamespace(role="カスタマーサクセス"),
        tmp_path,
        {},
        Path("/tmp/履歴書＿田仲二千.pdf"),
        Path("/tmp/career.pdf"),
        "カスタマーサクセスに取り組みたいです。",
    )

    assert result["ok"] is True
    assert result["attempt_no"] == 2
    assert calls["execute"] == 2


def test_prefill_with_same_candidate_repairs_stops_on_user_only_required(monkeypatch, tmp_path) -> None:
    class FakePageForRepair:
        def wait_for_timeout(self, timeout):
            return None

    user_only_field = {
        "index": 9,
        "tag": "input",
        "type": "radio",
        "required": True,
        "label": "独身 | 婚姻歴\n必須\n\t\n独身\n既婚 | 独身",
    }
    captured_fields = iter([[], [user_only_field]])

    monkeypatch.setattr(runner, "build_input_plan", lambda classified, resume_file, career_file, message, role_context="", unknown_required=None: [])
    monkeypatch.setattr(runner, "execute_input_plan", lambda page, plan: [])
    monkeypatch.setattr(runner, "capture_controls", lambda page: next(captured_fields))
    monkeypatch.setattr(runner, "classify_fields", lambda fields: {})
    monkeypatch.setattr(runner, "unsafe_required_fields", lambda fields: [])
    monkeypatch.setattr(runner, "user_only_required_fields", lambda fields: fields)
    monkeypatch.setattr(runner, "required_unknown_fields", lambda fields, classified, safe_keys: [])
    monkeypatch.setattr(runner, "required_unfilled_fields", lambda fields: [{"index": 1}])
    monkeypatch.setattr(runner, "snap", lambda page, artifact_dir, name: "")
    monkeypatch.setattr(runner, "prefill_checks", lambda fields, resume_name, career_name, message, classified, body_text="", role="": {"name": False, "no_remote_preference_in_free_text": True})

    result = runner.prefill_with_same_candidate_repairs(
        FakePageForRepair(),
        SimpleNamespace(role="広報・PR"),
        tmp_path,
        {},
        Path("/tmp/履歴書＿田仲二千.pdf"),
        Path("/tmp/career.pdf"),
        "広報・PRに取り組みたいです。",
    )

    assert result["ok"] is False
    assert result["state"] == "needs_user_review"
    assert result["blocker_reason"] == "user_only_required_fields_after_repair"
    assert result["unfilled_required"] == [user_only_field]


def test_submitted_url_match_ignores_tracking_query_and_www() -> None:
    assert runner.submitted_url_match(
        "https://www.example.com/jobs/123?utm_source=x&ref=y",
        {"https://example.com/jobs/123"},
    )


def test_existing_submitted_guard_stops_before_browser(monkeypatch, tmp_path) -> None:
    outcomes = tmp_path / "outcomes.jsonl"
    args = SimpleNamespace(
        submit_authorized=True,
        job_url="https://www.example.com/jobs/123?utm_source=x",
        outcomes_jsonl=str(outcomes),
        discovered_at_jst="",
        company="Example",
        role="CS",
        source_platform="official",
        job_key="official-example-123",
        priority_tier="test",
    )

    monkeypatch.setattr(runner, "submitted_confirmed_application_urls", lambda: {"https://example.com/jobs/123"})

    try:
        runner.stop_if_existing_submitted_confirmed(args, tmp_path)
    except SystemExit as exc:
        assert str(exc) == "existing_submitted_confirmed_before_submit"
    else:
        raise AssertionError("expected existing submitted guard to stop")

    payload = json.loads(outcomes.read_text(encoding="utf-8"))
    assert payload["pipelineRow"]["state"] == "retryable"
    assert payload["pipelineRow"]["blocker_reason"] == "existing_submitted_confirmed_before_submit"


def test_confirm_remote_preference_check_only_uses_applicant_entered_sections() -> None:
    body = "\n".join(
        [
            "求人タイトル",
            "AIコンサルタント フルリモート可",
            "応募先へのメッセージ",
            "貴社規定に従います。",
            "確認して応募",
        ]
    )

    applicant_text = runner.applicant_entered_sections_text(body)

    assert "フルリモート可" not in applicant_text
    assert runner.has_remote_preference(applicant_text) is False


def test_confirm_remote_preference_check_detects_applicant_entered_remote_text() -> None:
    body = "\n".join(
        [
            "求人タイトル",
            "AIコンサルタント",
            "応募先へのメッセージ",
            "フルリモート勤務を希望します",
            "確認して応募",
        ]
    )

    applicant_text = runner.applicant_entered_sections_text(body)

    assert runner.has_remote_preference(applicant_text) is True


def test_hrmos_detailed_remote_preference_ignores_non_remote_location() -> None:
    assert hrmos_runner.REMOTE_PREFERENCE_RE.search("勤務地は東京を希望します") is None
    assert hrmos_runner.REMOTE_PREFERENCE_RE.search("勤務地はリモート希望です") is not None


def test_role_specific_message_passes_human_voice_gate() -> None:
    message = runner.build_role_specific_message("Example", "CS/カスタマーサクセス")

    gate = runner.human_voice_message_gate(message, "CS/カスタマーサクセス")

    assert gate["ok"] is True
    assert "カスタマーサクセス" in gate["role_hints"]
    assert "Perfect Corp" not in message
    assert "80万" not in message
    assert "140万" not in message


def test_role_specific_message_uses_short_english_for_english_roles() -> None:
    message = runner.build_role_specific_message("RevenueCat", "Senior Content Marketing Manager, Narrative & Comms")

    gate = runner.human_voice_message_gate(message, "Senior Content Marketing Manager, Narrative & Comms")

    assert gate["ok"] is True
    assert len(message) <= 360
    assert "Content" in gate["role_hints"]
    assert not any("\u3040" <= char <= "\u9fff" for char in message)


def test_compact_application_message_shortens_long_english_seo_message() -> None:
    long_message = (
        "I am interested in Firecrawl because the product sits directly at the intersection of AI, web data, and growth workflows. "
        "In my current digital marketing work for Perfect Corp., I improved monthly page views from 800,000 to 1.4 million and app downloads from 120,000 to 200,000 through SEO, content planning, UTM analysis, and AI-assisted creative production. "
        "I would bring that same structured SEO execution and data-driven experimentation to help Firecrawl expand qualified discovery and demand among technical teams."
    )

    message = runner.compact_application_message(long_message, "Firecrawl", "Off-Page SEO Specialist")
    gate = runner.human_voice_message_gate(message, "Off-Page SEO Specialist")

    assert gate["ok"] is True
    assert len(message) <= 360
    assert "SEO" in gate["role_hints"]
    assert "Firecrawl" in message


def test_compact_application_message_does_not_add_missing_numeric_claims() -> None:
    long_message = (
        "I am interested in this Off-Page SEO Specialist role because it connects SEO, content partnerships, and growth. "
        "I have worked on marketing planning, search content, campaign analysis, and AI-assisted production. "
        "I want to apply that structured execution to improve qualified discovery and demand. "
    ) * 3

    message = runner.compact_application_message(long_message, "Firecrawl", "Off-Page SEO Specialist")
    gate = runner.human_voice_message_gate(message, "Off-Page SEO Specialist")

    assert gate["ok"] is True
    assert len(message) <= 360
    assert "800,000" not in message
    assert "1.4 million" not in message
    assert runner.has_remote_preference(message) is False
    assert not any("\u3040" <= char <= "\u9fff" for char in message)


def test_compact_application_message_does_not_infer_numbers_from_page_views_only() -> None:
    long_message = (
        "I am interested in this Off-Page SEO Specialist role because it connects SEO, content partnerships, and growth. "
        "At Perfect Corp., I improved monthly page views through SEO, content planning, UTM analysis, and AI-assisted production. "
        "I want to apply that structured execution to improve qualified discovery and demand. "
    ) * 3

    message = runner.compact_application_message(long_message, "Firecrawl", "Off-Page SEO Specialist")

    assert "800,000" not in message
    assert "1.4 million" not in message


def test_human_voice_gate_rejects_generic_ai_style_message() -> None:
    message = "貴社の理念に深く共感し、強く関心があり応募いたしました。高いコミュニケーション力で貢献したいです。"

    gate = runner.human_voice_message_gate(message, "カスタマーサクセス")

    assert gate["ok"] is False
    assert "generic_ai_style_phrase" in gate["failures"]
    assert "missing_specific_motivation" in gate["failures"]


def test_human_voice_gate_accepts_specific_english_marketing_message() -> None:
    message = (
        "I am interested in this Product Marketing Manager role because it connects "
        "customer insight, positioning, and go-to-market execution. I would like to "
        "apply my SEO, content, and campaign analysis experience while learning the "
        "product deeply and improving how the team communicates value to customers."
    )

    gate = runner.human_voice_message_gate(message, "Product Marketing Manager")

    assert gate["ok"] is True
    assert "Product" in gate["role_hints"]
    assert "Marketing" in gate["role_hints"]


def test_role_experience_answer_handles_sales_development_prompts() -> None:
    customer_facing, customer_patterns = runner.role_experience_answer("role_experience_customer_facing")
    saas, saas_patterns = runner.role_experience_answer("role_experience_saas")
    achievement, achievement_patterns = runner.role_experience_answer("role_key_achievement")

    assert customer_facing == "Yes"
    assert saas == "Yes"
    assert "Perfect Corp." in achievement
    assert "800,000" in achievement
    assert any("Perfect Corp" in pattern for pattern in achievement_patterns)
    assert any("Yes" in pattern for pattern in customer_patterns)
    assert any("Yes" in pattern for pattern in saas_patterns)


def test_single_yes_no_radio_matches_checked_ashby_on_value() -> None:
    field = SimpleNamespace(index=0)
    fields = [
        {
            "index": 0,
            "type": "radio",
            "label": "Yes\nNo | Do you have experience working in or selling SaaS products?",
            "value": "on",
            "checked": True,
        }
    ]

    assert runner.single_yes_no_radio_matches(fields, field, [r"^Yes$"])


def test_build_input_plan_uses_yes_for_yes_no_consent() -> None:
    consent = SimpleNamespace(
        key="consent",
        index=0,
        tag="input",
        type="checkbox",
        label="Yes\nNo | By selecting Yes, I am consenting to the use of AI for evaluating my candidacy.",
        confidence=90,
    )

    plan = runner.build_input_plan({"consent": [consent]}, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")

    consent_action = next(item for item in plan if item["key"] == "consent")
    assert consent_action["value"] == "Yes"
    assert any("Yes" in pattern for pattern in consent_action["options"])


def test_checked_option_has_matches_radio_primary_label() -> None:
    fields = [
        {
            "index": 10,
            "type": "radio",
            "label": "5+ years | How many years of hands-on marketing experience do you have?",
            "primary_label": "5+ years",
            "value": "on",
            "checked": True,
        }
    ]

    assert runner.checked_option_has(fields, [r"5\+ years"])


def test_radio_candidate_text_prefers_primary_label_for_ashby_options() -> None:
    field = {
        "type": "radio",
        "primary_label": "5+ years",
        "label": "5+ years | How many years of hands-on marketing experience do you have? | 5+ years | 3-5 years",
        "value": "on",
    }

    assert runner.radio_candidate_text(field) == "5+ years"


def test_build_input_plan_uses_yes_for_acknowledge_consent() -> None:
    consent = SimpleNamespace(
        key="consent",
        index=40,
        tag="input",
        type="radio",
        label="Yes, I acknowledge Sift's Global Recruitment Privacy Notice",
        confidence=85,
    )

    plan = runner.build_input_plan({"consent": [consent]}, Path("/tmp/resume.pdf"), Path("/tmp/career.pdf"), "message")

    consent_action = next(item for item in plan if item["key"] == "consent")
    assert consent_action["value"] == "Yes"
    assert any("Yes" in pattern for pattern in consent_action["options"])


def test_human_voice_gate_still_rejects_english_remote_preference() -> None:
    message = (
        "I am interested in this Product Marketing Manager role because it connects "
        "customer insight and SEO content. I would like to work remotely and improve "
        "campaign messaging for customers."
    )

    gate = runner.human_voice_message_gate(message, "Product Marketing Manager")

    assert gate["ok"] is False
    assert "remote_preference" in gate["failures"]


def test_prefill_checks_require_human_voice_application_message_when_role_given() -> None:
    fields = [
        {"tag": "input", "type": "text", "value": runner.PROFILE["name"]},
        {"tag": "input", "type": "email", "value": runner.PROFILE["email"]},
        {"tag": "input", "type": "text", "value": runner.PROFILE["phone"]},
        {"tag": "textarea", "type": "textarea", "value": "強く関心があり応募いたしました。貢献したいです。"},
    ]
    classified = {"application_message": [SimpleNamespace(index=3)]}

    checks = runner.prefill_checks(
        fields,
        "resume.pdf",
        "career.pdf",
        "強く関心があり応募いたしました。貢献したいです。",
        classified,
        role="AIコンサルタント",
    )

    assert checks["application_message"] is True
    assert checks["human_voice_application_message"] is False


def test_runner_requires_final_pre_submit_screenshot_gate() -> None:
    source = Path(runner.__file__).read_text(encoding="utf-8")

    assert "def final_pre_submit_review" in source
    assert "02-pre-submit-final-review.png" in source
    assert "pre_submit_screenshot_missing_before_submit" in source
    assert source.index("final_pre_submit_review(") < source.index("submit_button.click(timeout=15000)")
