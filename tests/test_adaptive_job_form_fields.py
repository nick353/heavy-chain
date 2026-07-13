import importlib.util
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PROJECT_ROOT / "scripts/job_applications/adaptive_form_fields.py"
SPEC = importlib.util.spec_from_file_location("adaptive_form_fields", MODULE_PATH)
assert SPEC and SPEC.loader
adaptive_form_fields = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = adaptive_form_fields
SPEC.loader.exec_module(adaptive_form_fields)


def load_fields(path: str) -> list[dict[str, object]]:
    return json.loads((PROJECT_ROOT / path).read_text(encoding="utf-8"))


def test_adaptive_classifier_handles_cloud_ace_shortform_artifact() -> None:
    fields = load_fields("artifacts/job-playwright-cli-runs/2026-06-04-cloud-ace-ai-creator-shortform-submit-rerun/01-prefill-state.json")

    classified = adaptive_form_fields.classify_fields(fields)

    for key in [
        "name",
        "kana",
        "email",
        "phone",
        "current_salary_type",
        "current_salary",
        "hope_note",
        "resume_file",
        "application_message",
    ]:
        assert adaptive_form_fields.best_match(classified, key) is not None
    assert adaptive_form_fields.best_match(classified, "email").type == "email"
    assert "現給与" in adaptive_form_fields.best_match(classified, "current_salary_type").label
    assert not adaptive_form_fields.has_remote_preference("貴社規定に従います。")


def test_ashby_adjacent_authorization_questions_classify_separately() -> None:
    fields = [
        {
            "index": 18,
            "tag": "input",
            "type": "checkbox",
            "primary_label": "Yes No",
            "label": "Yes\nNo | Are you legally authorized to work in the country this role is located in? | Are you legally authorized to work in the country this role is located in?\nYes\nNo | Are you at least 18 years of age?\nYes\nNo",
        },
        {
            "index": 19,
            "tag": "input",
            "type": "checkbox",
            "primary_label": "Yes No",
            "label": "Yes\nNo | Will you now, or in the future, require sponsorship for employment visa status (e.g. H-1B visa status)? | Will you now, or in the future, require sponsorship for employment visa status (e.g. H-1B visa status)?\nYes\nNo | Are you legally authorized to work in the country this role is located in?\nYes\nNo",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "work_authorization").index == 18
    assert adaptive_form_fields.best_match(classified, "visa_sponsorship").index == 19


def test_adaptive_classifier_handles_kasanare_detailed_artifact() -> None:
    fields = json.loads(
        (PROJECT_ROOT / "artifacts/job-playwright-cli-runs/2026-06-04-kasanare-ai-dx-consultant-hrmos-detailed-submit/01-prefill-state.json").read_text(encoding="utf-8")
    )["fields"]

    classified = adaptive_form_fields.classify_fields(fields)

    for key in [
        "name",
        "kana",
        "gender",
        "email",
        "phone",
        "school",
        "company",
        "resume_file",
        "application_message",
    ]:
        assert adaptive_form_fields.best_match(classified, key) is not None
    assert "メールアドレス" in adaptive_form_fields.best_match(classified, "email").label
    assert "ファイル" in adaptive_form_fields.best_match(classified, "resume_file").label


def test_remote_preference_detection_rejects_bad_free_text() -> None:
    assert adaptive_form_fields.has_remote_preference("フルリモート勤務を希望します")
    assert adaptive_form_fields.has_remote_preference("勤務地はリモート希望です")
    assert adaptive_form_fields.has_remote_preference("I would like to work remotely.")
    assert adaptive_form_fields.has_remote_preference("I prefer remote work.")
    assert not adaptive_form_fields.has_remote_preference("勤務地は東京を希望します")
    assert not adaptive_form_fields.has_remote_preference("The role supports remote customer research.")


def test_classifier_treats_postal_before_tel_type_phone_fallback() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "電話番号\n必須 | 電話番号"},
        {"index": 1, "tag": "input", "type": "tel", "visible": True, "enabled": True, "required": True, "label": "住所\n必須 | 郵便番号から住所を入力 | 例）150-0002"},
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "phone").index == 0
    assert adaptive_form_fields.best_match(classified, "postal").index == 1


def test_classifier_prefers_tel_over_nearby_email_label_and_handles_pronunciation() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "tel",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Phone | Phone | Email | Email | 1-415-555-1234...",
        },
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "So we can pronounce it correctly, what is the phonetic spelling of your name?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "phone").index == 0
    assert adaptive_form_fields.best_match(classified, "name_pronunciation").index == 1


def test_classifier_treats_first_and_last_name_as_full_name() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "First and Last Name | First and Last Name | First and Last Name | Type here...",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "name").index == 1
    assert "last_name" not in classified


def test_classifier_treats_first_name_and_surname_as_full_name() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Name | First Name & Surname | Name\n\nFirst Name & Surname | Type here...",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "name").index == 1
    assert "first_name" not in classified


def test_classifier_treats_preferred_first_name_as_first_name() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Preferred First Name | Preferred First Name | Full Name\n\nLegal first and last name | Type here...",
            "primary_label": "Preferred First Name",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "first_name").index == 1


def test_classifier_treats_most_recent_title_as_position() -> None:
    fields = [
        {
            "index": 7,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Most recent title | Most recent title | Most recent company | Type here...",
            "primary_label": "Most recent title",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "position").index == 7


def test_classifier_maps_github_field_to_github_profile_url_not_portfolio() -> None:
    fields = [
        {
            "index": 3,
            "tag": "input",
            "type": "url",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "GitHub URL | GitHub URL | Type here...",
            "primary_label": "GitHub URL",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "github_profile_url").index == 3
    assert "portfolio" not in classified


def test_classifier_maps_domain_expertise_to_safe_profile_answer() -> None:
    fields = [
        {
            "index": 8,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What is your domain expertise? | What is your domain expertise?",
            "primary_label": "What is your domain expertise?",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "domain_expertise").index == 8
    assert adaptive_form_fields.required_unknown_fields(fields, classified, adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS) == []


def test_freelancer_vat_questions_are_user_only_not_unsafe() -> None:
    fields = [
        {
            "index": 9,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Are you a Freelancer or Private Individual with official tax registration (e.g., VAT)?",
            "primary_label": "Are you a Freelancer or Private Individual with official tax registration (e.g., VAT)?",
            "value": "",
        },
    ]

    assert adaptive_form_fields.user_only_required_fields(fields) == fields
    assert adaptive_form_fields.unsafe_required_fields(fields) == []


def test_lilt_education_level_radio_group_maps_to_degree_not_school() -> None:
    fields = [
        {
            "index": 12,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": False,
            "checked": False,
            "label": "Bachelor's Degree (or equivalent) | Highest level of education completed?\nNo formal education\nHigh School\nBachelor's Degree (or equivalent)",
            "primary_label": "Bachelor's Degree (or equivalent)",
            "value": "on",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "degree").index == 12
    assert "school" not in classified


def test_lilt_native_speaker_fluency_text_maps_to_language() -> None:
    fields = [
        {
            "index": 7,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What is your language of native speaker fluency? | What is your language of native speaker fluency?",
            "primary_label": "What is your language of native speaker fluency?",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "language").index == 7
    assert adaptive_form_fields.required_unknown_fields(fields, classified, adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS) == []


def test_hard_stop_markers_do_not_flag_hiring_ai_verification_signals() -> None:
    body = "We use hiring AI to evaluate job-related verification signals and improve candidate matching."

    assert "security_code_or_otp" not in adaptive_form_fields.hard_stop_markers(body)


def test_lever_current_location_classifies_as_residence() -> None:
    fields = [
        {
            "index": 4,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Current location | Current location | Type here...",
            "primary_label": "Current location",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "residence").index == 4


def test_lever_japanese_fluency_select_classifies_as_language() -> None:
    fields = [
        {
            "index": 19,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Japanese fluency | Select... Elementary - N5 Intermediate - N3 Fluent - N1 Native",
            "primary_label": "Japanese fluency",
            "value": "",
            "options": [
                {"label": "Select...", "value": ""},
                {"label": "Elementary - N5", "value": "n5"},
                {"label": "Fluent - N1", "value": "n1"},
                {"label": "Native", "value": "native"},
            ],
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "language").index == 19
    assert "school" not in classified


def test_lever_source_select_does_not_classify_as_school() -> None:
    fields = [
        {
            "index": 20,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "How did you hear about this job? | Select... Built in Boston CareerCross CIC Job Page Craigslist Daijob Diversity Jobs Erasmus University job page",
            "primary_label": "How did you hear about this job?",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "discovery_source").index == 20
    assert "school" not in classified


def test_lilt_native_speaker_fluency_wins_over_nearby_current_location_context() -> None:
    fields = [
        {
            "index": 7,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What is your language of native speaker fluency? | What is your language of native speaker fluency? | What is your current location? | Type here...",
            "primary_label": "What is your language of native speaker fluency?",
            "section_context": "What is your language of native speaker fluency?",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "language").index == 7
    assert "residence" not in classified


def test_lilt_surrounding_native_speaker_context_does_not_override_phone_field() -> None:
    fields = [
        {
            "index": 3,
            "tag": "input",
            "type": "tel",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Phone Number | Phone Number | Email | Candidate Information\nFirst and Last Name\nEmail\nPhone Number\nResume\nLinkedIn Profile\nWhat is your current location?\nWhat is your language of native speaker fluency?",
            "primary_label": "Phone Number",
            "value": "",
        },
        {
            "index": 7,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What is your language of native speaker fluency? | What is your current location? | Type here...",
            "primary_label": "What is your language of native speaker fluency?",
            "section_context": "What is your language of native speaker fluency?",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "phone").index == 3
    assert adaptive_form_fields.best_match(classified, "language").index == 7


def test_openart_current_city_and_start_timing_do_not_become_sponsorship() -> None:
    fields = [
        {
            "index": 4,
            "tag": "input",
            "type": "input",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "If you do not provide the city you are currently based in, your application may be automatically rejected. | What city are you currently located in? (MANDATORY) | Start typing...",
            "primary_label": "If you do not provide the city you are currently based in, your application may be automatically rejected.",
            "section_context": "If you do not provide the city you are currently based in, your application may be automatically rejected. | What city are you currently located in? (MANDATORY)",
            "value": "",
        },
        {
            "index": 6,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "If necessary, are you open to relocating? Yes No | Do you require sponsorship? Yes No",
            "primary_label": "Yes",
            "section_context": "If necessary, are you open to relocating? Yes No | Do you require sponsorship? Yes No",
            "choice_question_context": "If necessary, are you open to relocating?",
            "value": "",
        },
        {
            "index": 7,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "If you were to join OpenArt, how soon would you be able to start? | If you were to join OpenArt, how soon would you be able to start? Feel free to also explain any special circumstances you may have. | If necessary, are you open to relocating? Yes No | Do you require sponsorship? Yes No",
            "primary_label": "If you were to join OpenArt, how soon would you be able to start?",
            "section_context": "If you were to join OpenArt, how soon would you be able to start? Feel free to also explain any special circumstances you may have. | If necessary, are you open to relocating? Yes No",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "residence").index == 4
    assert adaptive_form_fields.best_match(classified, "onsite_office_availability").index == 6
    assert adaptive_form_fields.best_match(classified, "job_change_timing").index == 7
    assert "visa_sponsorship" not in classified


def test_classifier_treats_legal_first_and_last_name_as_full_name() -> None:
    fields = [
        {
            "index": 2,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "First and last name (legal name) | First and last name (preferred name) | Type here...",
            "primary_label": "First and last name (legal name)",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "name").index == 2


def test_classifier_does_not_treat_ashby_long_questions_as_name() -> None:
    fields = [
        {
            "index": 7,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "primary_label": "Tell us about a time you took a complex or technical topic (e.g. medical, product, or scientific) and turned it into something clear and compelling. What was the topic, who was the audience, and how did you approach it?",
            "label": "Tell us about a time you took a complex or technical topic (e.g. medical, product, or scientific) and turned it into something clear and compelling. What was the topic, who was the audience, and how did you approach it? | Portfolio | Apply now\nName\nEmail",
        },
        {
            "index": 8,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "primary_label": "Walk us through a piece of work where your goal was to drive action (e.g. sign-ups, purchases). What was your approach and what made it effective?",
            "label": "Walk us through a piece of work where your goal was to drive action (e.g. sign-ups, purchases). What was your approach and what made it effective? | Tell us about a time | Apply now\nName\nEmail",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "role_experience_technical_translation").index == 7
    assert adaptive_form_fields.best_match(classified, "role_key_achievement").index == 8
    assert "name" not in classified


def test_classifier_handles_english_start_availability_question() -> None:
    fields = [
        {
            "index": 10,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "primary_label": "When would you be available to start upon receiving an offer?",
            "label": "When would you be available to start upon receiving an offer? | Type here...",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "job_change_timing").index == 10


def test_classifier_treats_middle_name_as_middle_name() -> None:
    fields = [
        {
            "index": 3,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Middle Name | Please write N/A if you do not have a middle name.",
            "primary_label": "Middle Name",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "middle_name").index == 3


def test_classifier_treats_country_work_status_radio_as_work_authorization() -> None:
    fields = [
        {
            "index": 4,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "I am a citizen / permanent resident of the country where I plan to live & work from. | If you are eligible, please select the status that allows you to work and live in that Country",
            "primary_label": "I am a citizen / permanent resident of the country where I plan to live & work from.",
            "section_context": "If you are eligible, please select the status that allows you to work and live in that Country",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "work_authorization").index == 4


def test_classifier_treats_salary_requirement_number_as_expected_salary() -> None:
    fields = [
        {
            "index": 7,
            "tag": "input",
            "type": "number",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Salary Requirement: | Salary Requirement:\n\nState your desired salary | Name\nEmail\nResume",
            "primary_label": "Salary Requirement:",
            "section_context": "Salary Requirement:\n\nState your desired salary",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 7
    assert "name" not in classified


def test_classifier_treats_desired_hourly_rate_usd_as_expected_salary() -> None:
    fields = [
        {
            "index": 24,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What is your desired hourly rate in USD? | What is your desired hourly rate in USD? | Type here...",
            "primary_label": "What is your desired hourly rate in USD?",
            "section_context": "Do you have expert level experience in CLI?\nYes\nNo\nWhat is your desired hourly rate in USD?",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 24
    assert "hope_note" not in classified


def test_classifier_treats_lilt_prompt_engineering_checkbox_as_safe_experience() -> None:
    fields = [
        {
            "index": 19,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Prompt Engineering | Do you have previous work experience in any of the following fields?\n\nSelect all that apply\n\nComputer Science\nSoftware Engineering\nData Scientist\nPrompt Engineering\nNone of the above | Prompt Engineering | Data Scientist | Data Scientist",
            "primary_label": "Prompt Engineering",
            "section_context": "Do you have previous work experience in any of the following fields?\n\nSelect all that apply\n\nComputer Science\nSoftware Engineering\nData Scientist\nPrompt Engineering\nNone of the above",
            "value": "on",
        },
        {
            "index": 20,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "None of the above | Do you have previous work experience in any of the following fields?\n\nSelect all that apply\n\nComputer Science\nSoftware Engineering\nData Scientist\nPrompt Engineering\nNone of the above | None of the above | Prompt Engineering | Prompt Engineering",
            "primary_label": "None of the above",
            "section_context": "Do you have previous work experience in any of the following fields?\n\nSelect all that apply\n\nComputer Science\nSoftware Engineering\nData Scientist\nPrompt Engineering\nNone of the above",
            "value": "on",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "role_experience_prompt_engineering").index == 19
    assert [match.index for match in classified["role_experience_prompt_engineering"]] == [19]


def test_classifier_treats_lilt_expert_python_shell_cli_as_conservative_experience() -> None:
    fields = [
        {
            "index": 21,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Yes\nNo | Do you have expert level experience in Python? | Do you have expert level experience in Python?\nYes\nNo",
            "primary_label": "Yes\nNo",
            "section_context": "Do you have expert level experience in Python?\nYes\nNo",
            "value": "on",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "role_experience_expert_cli_python_shell").index == 21


def test_classifier_does_not_treat_unrelated_number_input_as_name_from_nearby_context() -> None:
    fields = [
        {
            "index": 11,
            "tag": "input",
            "type": "number",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "How many years of lifecycle marketing experience do you have? | Name\nEmail\nResume",
            "primary_label": "How many years of lifecycle marketing experience do you have?",
            "section_context": "Name\nEmail\nResume",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert "name" not in classified


def test_classifier_treats_applying_location_select_as_preferred_location() -> None:
    fields = [
        {
            "index": 0,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Select...\nGlobal\nDubai\nHong Kong\nSingapore | Which location are you applying for?",
            "primary_label": "Select...",
            "section_context": "Which location are you applying for?",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "preferred_location").index == 0


def test_classifier_does_not_fill_referral_employee_name_as_applicant_name() -> None:
    fields = [
        {
            "index": 5,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "If you have discussed this role with a current Camunda employee, please enter their full name here. If you have not spoken to anyone at Camunda, please leave this field blank",
            "primary_label": "If you have discussed this role with a current Camunda employee, please enter their full name here",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "referral_notification").index == 5
    assert "name" not in classified


def test_classifier_treats_ai_product_marketing_experience_as_safe_role_fact() -> None:
    fields = [
        {
            "index": 11,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Do you have experience marketing for AI products? If yes, please specify:",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "role_experience_ai_product_marketing").index == 11
    assert unknown == []


def test_classifier_treats_company_mission_prompt_as_application_message() -> None:
    fields = [
        {
            "index": 6,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Why Probably Genetic? In a few sentences, what about our mission resonates with you...",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "application_message").index == 6


def test_classifier_handles_sales_development_experience_prompts() -> None:
    fields = [
        {
            "index": 11,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Have you completed an internship or work experience in sales, business development, marketing, recruitment, real estate, or another customer-facing role?",
        },
        {
            "index": 12,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Do you have experience working in or selling SaaS products?",
        },
        {
            "index": 13,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Can you provide a specific example of a key achievement in academics, athletics, work, or internships (e.g., awards, promotions, top performance rankings)?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "role_experience_customer_facing").index == 11
    assert adaptive_form_fields.best_match(classified, "role_experience_saas").index == 12
    assert adaptive_form_fields.best_match(classified, "role_key_achievement").index == 13
    assert unknown == []


def test_classifier_does_not_treat_work_authorization_job_location_as_residence() -> None:
    fields = [
        {
            "index": 4,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Are you currently legally authorized to work in the job location?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "work_authorization").index == 4
    assert "residence" not in classified


def test_classifier_treats_expected_compensation_as_expected_salary() -> None:
    fields = [
        {
            "index": 19,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What is your expected compensation for this role?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 19
    assert unknown == []


def test_classifier_treats_us_location_eligibility_as_us_state_if_based_in_us() -> None:
    fields = [
        {
            "index": 13,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Yes | Are you currently located in the United States?",
        },
        {
            "index": 33,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "California (CA) | US PAYROLL STATES HighLevel is registered to payroll employees in the following states. Do you currently live in any of these states?",
        },
        {
            "index": 27,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Please confirm the US state you reside in Alabama Alaska Arizona California",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert [match.index for match in classified["us_state_if_based_in_us"]] == [13, 27, 33]


def test_classifier_treats_developer_audience_prompt_as_technical_translation() -> None:
    fields = [
        {
            "index": 45,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Please briefly describe your experience writing content for developer audiences — you understand the difference between marketing to a core user and marketing to the engineer who evaluates and implements the tool.",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "role_experience_technical_translation").index == 45
    assert unknown == []


def test_classifier_treats_b2b_saas_company_experience_as_role_experience() -> None:
    fields = [
        {
            "index": 12,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Do you have experience working for a B2B SaaS company?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "role_experience_b2b_saas").index == 12
    assert "company" not in classified


def test_required_situational_judgment_prompt_is_hard_stop() -> None:
    fields = [
        {
            "index": 9,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "You're three months into a partner relationship and engagement metrics are declining. The partner's leadership team is frustrated. How do you handle it?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert unknown
    assert "How do you handle it" in unknown[0]["label"]


def test_classifier_allows_passport_country_but_not_passport_number() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "Passport Country"},
        {"index": 1, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "Passport Number"},
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unsafe = adaptive_form_fields.unsafe_required_fields(fields)

    assert adaptive_form_fields.best_match(classified, "country").index == 0
    assert [field["index"] for field in unsafe] == [1]


def test_classifier_treats_eligible_to_work_country_prompt_as_work_authorization() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Yes\nNo | Are you eligible to work in the country in which you are applying?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "work_authorization").index == 0
    assert adaptive_form_fields.best_match(classified, "country") is None


def test_classifier_treats_compensation_requirements_as_expected_salary() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Compensation Requirements",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 0


def test_classifier_treats_github_profile_and_async_remote_as_safe_facts() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "Github Profile"},
        {
            "index": 1,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Tell us about your experience working in an async and/or remote environment.",
        },
        {
            "index": 2,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Describe a situation where you helped bridge the gap between a technical topic and non-technical users.",
        },
        {
            "index": 3,
            "tag": "input",
            "type": "checkbox",
            "visible": False,
            "enabled": True,
            "required": False,
            "label": "Yes\nNo | Are you based in a US or EU equivalent timezone?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "github_profile_url").index == 0
    assert adaptive_form_fields.best_match(classified, "role_experience_async_remote").index == 1
    assert adaptive_form_fields.best_match(classified, "role_experience_technical_translation").index == 2
    assert adaptive_form_fields.best_match(classified, "timezone_us_eu_equivalent").index == 3
    assert unknown == []


def test_classifier_treats_discovery_source_as_safe_known_fact() -> None:
    fields = [
        {
            "index": 18,
            "tag": "textarea",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "例：知り合いの紹介 など\n必須",
        },
        {
            "index": 19,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "当社のHP/採用サイト | 本求人を知ったきっかけ\n必須 | 当社のHP/採用サイト",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert [match.index for match in classified["discovery_source"]] == [19, 18]
    assert unknown == []


def test_classifier_treats_scribe_product_and_hubspot_questions_as_safe_known_facts() -> None:
    fields = [
        {
            "index": 8,
            "tag": "textarea",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What is your favorite Scribe feature? Why?",
        },
        {
            "index": 9,
            "tag": "textarea",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Do you have HubSpot experience? If so, how many years?",
        },
        {
            "index": 10,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Company website | How did you hear about Scribe?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "favorite_product_feature").index == 8
    assert adaptive_form_fields.best_match(classified, "hubspot_experience").index == 9
    assert adaptive_form_fields.best_match(classified, "discovery_source").index == 10
    assert unknown == []


def test_classifier_treats_short_intro_and_ai_native_habit_as_safe_free_text() -> None:
    fields = [
        {
            "index": 4,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Short Intro | One paragraph, not a cover letter. Tell us why this role.",
        },
        {
            "index": 6,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "AI-Native Habit | Describe one AI-native habit you already have. A tool, a workflow, a screenshot, a description of something you automated or sped up.",
        },
        {
            "index": 7,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Question for Us | One question you would ask us if hired. | AI-Native Habit\n\nDescribe one AI-native habit you already have.",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "short_intro").index == 4
    assert adaptive_form_fields.best_match(classified, "ai_native_habit").index == 6
    assert adaptive_form_fields.best_match(classified, "question_for_us").index == 7
    assert [match.index for match in classified["short_intro"]] == [4]
    assert unknown == []


def test_classifier_prefers_ashby_custom_question_head_over_parent_email_context() -> None:
    fields = [
        {
            "index": 4,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Short Intro | Short Intro\n\nOne paragraph, not a cover letter. Tell us why this role. | Resume\nUpload File | Name\nEmail\nResume\n\nShort Intro",
        },
        {
            "index": 6,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "AI-Native Habit | AI-Native Habit\n\nDescribe one AI-native habit you already have. | Work Samples | Name\nEmail\nResume",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "short_intro").index == 4
    assert adaptive_form_fields.best_match(classified, "ai_native_habit").index == 6
    assert "email" not in classified


def test_classifier_prefers_primary_label_over_section_email_context() -> None:
    fields = [
        {
            "index": 4,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "primary_label": "Short Intro",
            "section_context": "Name | Email | Resume | Work Samples",
            "label": "Short Intro | Name\nEmail\nResume\nWork Samples",
        },
        {
            "index": 6,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "primary_label": "AI-Native Habit",
            "section_context": "Name | Email | Resume | Short Intro",
            "label": "AI-Native Habit | Name\nEmail\nResume\nShort Intro",
        },
        {
            "index": 7,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "primary_label": "Question for Us",
            "section_context": "Name | Email | Resume | AI-Native Habit",
            "label": "Question for Us | Name\nEmail\nResume\nAI-Native Habit",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "short_intro").index == 4
    assert adaptive_form_fields.best_match(classified, "ai_native_habit").index == 6
    assert adaptive_form_fields.best_match(classified, "question_for_us").index == 7
    assert "email" not in classified


def test_classifier_uses_direct_label_for_ashby_based_location_and_source() -> None:
    fields = [
        {
            "index": 4,
            "tag": "input",
            "type": "input",
            "visible": True,
            "enabled": True,
            "required": False,
            "primary_label": "Where are you based?",
            "section_context": "Preferred Name | Email | Phone Number",
            "label": "Where are you based? | Phone Number | Start typing...",
        },
        {
            "index": 7,
            "tag": "input",
            "type": "input",
            "visible": True,
            "enabled": True,
            "required": False,
            "primary_label": "Where did you first hear about Sanity?",
            "section_context": "Resume | LinkedIn Profile",
            "label": "Where did you first hear about Sanity? | Start typing...",
        },
        {
            "index": 8,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "primary_label": "LinkedIn Profile",
            "section_context": "Where did you first hear about Sanity?",
            "label": "LinkedIn Profile | Where did you first hear about Sanity? | Type here...",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "residence").index == 4
    assert adaptive_form_fields.best_match(classified, "discovery_source").index == 7
    assert adaptive_form_fields.best_match(classified, "linkedin_profile_url").index == 8
    assert "phone" not in classified


def test_classifier_does_not_misclassify_question_for_us_as_ai_native_habit() -> None:
    field = {
        "index": 7,
        "tag": "input",
        "type": "text",
        "visible": True,
        "enabled": True,
        "required": True,
        "label": "Question for Us | One question you would ask us if hired. | AI-Native Habit\n\nDescribe one AI-native habit you already have.",
    }

    classified = adaptive_form_fields.classify_fields([field])

    assert "ai_native_habit" not in classified
    assert adaptive_form_fields.best_match(classified, "question_for_us").index == 7
    assert adaptive_form_fields.required_unknown_fields(
        [field],
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    ) == []


def test_classifier_treats_ashby_country_and_english_discovery_source_as_safe() -> None:
    fields = [
        {
            "index": 3,
            "tag": "input",
            "type": "input",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Country you're currently residing in | Country you're currently residing in | Start typing...",
        },
        {
            "index": 5,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "I'm a user | How did you hear about ElevenLabs?",
        },
        {
            "index": 7,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Job board | News article",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "country").index == 3
    assert adaptive_form_fields.best_match(classified, "discovery_source").index == 5
    assert unknown == []


def test_classifier_treats_overseas_office_availability_as_safe_no_answer() -> None:
    fields = [
        {
            "index": 7,
            "tag": "input",
            "type": "checkbox",
            "visible": False,
            "enabled": True,
            "required": False,
            "label": "Yes\nNo | Are you able to work in our San Francisco office 3 - 5 days a week?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "onsite_office_availability").index == 7
    assert unknown == []


def test_classifier_treats_apply_reason_as_discovery_source() -> None:
    fields = [
        {
            "index": 14,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "コーポレートサイト | リーディングマークに応募するきっかけをお知らせください。（複数回答可）\n必須\n\t\nコーポレートサイト\nWantedly\nその他 | コーポレートサイト",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "discovery_source").index == 14
    assert unknown == []


def test_classifier_prefers_helpfeel_discovery_textarea_over_referral_name() -> None:
    fields = [
        {
            "index": 14,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "value": "",
            "label": (
                "Helpfeelを知ったきっかけについて教えてください\n必須 | "
                "Helpfeelを知ったきっかけについて教えてください\n必須\n\n"
                "①転職サイト\n②お知り合いからの紹介（紹介者の名前をご記入ください）\n"
                "⑦その他（具体的なきっかけをご記入ください）\n"
                "⑨ChatGPTやGeminiなどの対話型生成AIサービス"
            ),
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "discovery_source").index == 14
    assert "name" not in classified
    assert unknown == []


def test_classifier_treats_planb_known_reason_as_discovery_source() -> None:
    fields = [
        {
            "index": 25,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "Green | PLAN-Bを知った経緯\n該当項目を選択してください。（複数選択可）\n必須\n\t\nPLAN-B社員からの紹介\nPLAN-B配信コンテンツ（note・YouTube・X）を見て知った\nGreen\nOpenWork\nビズリーチ\nその他 | Green",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "discovery_source").index == 25
    assert unknown == []


def test_classifier_handles_hidden_ashby_sponsorship_checkbox() -> None:
    fields = [
        {
            "index": 5,
            "tag": "input",
            "type": "checkbox",
            "visible": False,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": (
                "Yes\nNo | If you’ll require Vivian to commence, i.e., “sponsor,” "
                "an immigration or work permit case in order to employ you"
            ),
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "visa_sponsorship").index == 5
    assert unknown == []


def test_classifier_handles_us_based_hidden_checkbox_as_safe_authorization_fact() -> None:
    fields = [
        {
            "index": 7,
            "tag": "input",
            "type": "checkbox",
            "visible": False,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "Yes\nNo | Are you based in the U.S?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "work_authorization").index == 7
    assert unknown == []


def test_classifier_prefers_sponsorship_over_country_wording() -> None:
    fields = [
        {
            "index": 7,
            "tag": "input",
            "type": "checkbox",
            "visible": False,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "Yes\nNo | Will you require sponsorship or support to be authorized to work from your country of residence?",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "visa_sponsorship").index == 7
    assert adaptive_form_fields.best_match(classified, "country") is None
    assert unknown == []


def test_classifier_treats_disability_certificate_status_as_safe_known_fact() -> None:
    fields = [
        {
            "index": 26,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "対象外 | 障がい者手帳の有無について\n必須\n\t\n対象外\n身体障がい\n精神障がい\nその他 | 対象外",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "disability_certificate_status").index == 26
    assert unknown == []


def test_classifier_keeps_contextless_pick_date_unknown() -> None:
    fields = [
        {
            "index": 6,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Pick date...",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "job_change_timing") is None
    assert [field["index"] for field in unknown] == [6]


def test_classifier_treats_start_date_context_as_start_availability() -> None:
    fields = [
        {
            "index": 6,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "When are you available to start? | Pick date...",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "job_change_timing").index == 6
    assert unknown == []


def test_required_unfilled_treats_disability_certificate_checkbox_as_group() -> None:
    fields = [
        {
            "index": 26,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": True,
            "label": "対象外 | 障がい者手帳の有無について\n必須\n\t\n対象外\n身体障がい\n精神障がい\nその他 | 対象外",
        },
        {
            "index": 27,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "身体障がい | 障がい者手帳の有無について\n必須\n\t\n対象外\n身体障がい\n精神障がい\nその他 | 身体障がい",
        },
        {
            "index": 28,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "精神障がい | 障がい者手帳の有無について\n必須\n\t\n対象外\n身体障がい\n精神障がい\nその他 | 精神障がい",
        },
    ]

    assert adaptive_form_fields.required_unfilled_fields(fields) == []


def test_classifier_treats_application_condition_confirmation_as_safe_ack() -> None:
    fields = [
        {
            "index": 28,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "はい | 応募条件を確認しましたか？\n必須\n\t\nはい | はい",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "application_condition_ack").index == 28
    assert unknown == []


def test_classifier_prefers_discovery_source_over_social_portfolio_labels() -> None:
    fields = [
        {
            "index": 19,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "LinkedIn | 本求人を知ったきっかけ\n必須\n\t\n当社のHP/採用サイト\nLinkedIn\nその他SNS | LinkedIn",
            "checked": False,
        },
        {
            "index": 20,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "当社のHP/採用サイト | 本求人を知ったきっかけ\n必須\n\t\n当社のHP/採用サイト\nLinkedIn\nその他SNS | 当社のHP/採用サイト",
            "checked": True,
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert [match.index for match in classified["discovery_source"]] == [20, 19]
    assert "portfolio" not in classified
    assert adaptive_form_fields.required_unfilled_fields(fields) == []


def test_required_unfilled_treats_named_discovery_checkbox_as_group() -> None:
    fields = [
        {
            "index": 3,
            "tag": "input",
            "type": "checkbox",
            "name": "source",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "LinkedIn",
            "checked": False,
        },
        {
            "index": 4,
            "tag": "input",
            "type": "checkbox",
            "name": "source",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "当社のHP/採用サイト | 本求人を知ったきっかけ",
            "checked": True,
        },
    ]

    assert adaptive_form_fields.required_unfilled_fields(fields) == []


def test_classifier_handles_medley_hrmos_discovery_checkbox_group_before_portfolio_urls() -> None:
    fields = [
        {
            "index": 9,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "当社のHP/採用サイト | 本求人を知ったきっかけ\n必須\n\t\n当社のHP/採用サイト\n友人・知人の紹介\n外部イベント（転職フェア、勉強会など）\nLinkedIn\nその他SNS（Facebook、Xなど）\nその他\n複数選択可 | 当社のHP/採用サイト",
        },
        {
            "index": 10,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "友人・知人の紹介 | 本求人を知ったきっかけ\n必須\n\t\n当社のHP/採用サイト\n友人・知人の紹介\n外部イベント（転職フェア、勉強会など）\nLinkedIn\nその他SNS（Facebook、Xなど）\nその他\n複数選択可 | 友人・知人の紹介",
        },
        {
            "index": 11,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "外部イベント（転職フェア、勉強会など） | 本求人を知ったきっかけ\n必須\n\t\n当社のHP/採用サイト\n友人・知人の紹介\n外部イベント（転職フェア、勉強会など）\nLinkedIn\nその他SNS（Facebook、Xなど）\nその他\n複数選択可 | 外部イベント（転職フェア、勉強会など）",
        },
        {
            "index": 12,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "LinkedIn | 本求人を知ったきっかけ\n必須\n\t\n当社のHP/採用サイト\n友人・知人の紹介\n外部イベント（転職フェア、勉強会など）\nLinkedIn\nその他SNS（Facebook、Xなど）\nその他\n複数選択可 | LinkedIn",
        },
        {
            "index": 13,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "その他SNS（Facebook、Xなど） | 本求人を知ったきっかけ\n必須\n\t\n当社のHP/採用サイト\n友人・知人の紹介\n外部イベント（転職フェア、勉強会など）\nLinkedIn\nその他SNS（Facebook、Xなど）\nその他\n複数選択可 | その他SNS（Facebook、Xなど）",
        },
        {
            "index": 14,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "その他 | 本求人を知ったきっかけ\n必須\n\t\n当社のHP/採用サイト\n友人・知人の紹介\n外部イベント（転職フェア、勉強会など）\nLinkedIn\nその他SNS（Facebook、Xなど）\nその他\n複数選択可 | その他",
        },
        {
            "index": 16,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Facebook\t\nプロフィールURLを教えてください。",
        },
        {
            "index": 20,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "LinkedIn\t\nプロフィールURLを教えてください。",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert [match.index for match in classified["discovery_source"]] == [9, 10, 11, 12, 13, 14]
    assert [match.index for match in classified["portfolio"]] == [16]
    assert [match.index for match in classified["linkedin_profile_url"]] == [20]
    assert unknown == []

    filled_fields = [dict(field, checked=(field["index"] == 9)) for field in fields]
    assert adaptive_form_fields.required_unfilled_fields(filled_fields) == []


def test_classifier_treats_fillable_linkedin_label_as_linkedin_profile_url_only() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "LinkedIn | Type here...", "value": ""},
        {"index": 2, "tag": "textarea", "type": "textarea", "visible": True, "enabled": True, "required": True, "label": "LinkedIn", "value": ""},
        {"index": 3, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "GitHub URL", "value": ""},
        {"index": 4, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "Facebook プロフィールURL", "value": ""},
        {"index": 5, "tag": "input", "type": "checkbox", "visible": True, "enabled": True, "required": True, "label": "LinkedIn", "checked": False},
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert [match.index for match in classified["linkedin_profile_url"]] == [1, 2]
    assert [match.index for match in classified["github_profile_url"]] == [3]
    assert [match.index for match in classified["portfolio"]] == [4, 5]
    assert [field["index"] for field in unknown] == [4, 5]


def test_classifier_uses_linkedin_for_identity_portfolio_url_field() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": (
                "Portfolio, GitHub, or Personal Site | We ask for your LinkedIn "
                "or personal website and your GitHub/code portfolio to help verify "
                "that you're a real person, not to evaluate or rank your work."
            ),
            "value": "",
        },
        {
            "index": 2,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Portfolio or writing sample URL",
            "value": "",
        },
        {
            "index": 3,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Portfolio, GitHub, or Personal Site URL",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert [match.index for match in classified["linkedin_profile_url"]] == [1]
    assert [match.index for match in classified["portfolio"]] == [2, 3]


def test_classifier_does_not_treat_content_system_textarea_as_linkedin_from_surrounding_context() -> None:
    fields = [
        {
            "index": 9,
            "tag": "textarea",
            "type": "textarea",
            "required": True,
            "visible": True,
            "enabled": True,
            "label": (
                "Briefly describe a content system or publishing framework you built from scratch. "
                "What problem did it solve? (1-5 sentences) | In what US state do you reside/plan to reside "
                "in the near future? | Please share your Linkedin Profile"
            ),
            "primary_label": "Briefly describe a content system or publishing framework you built from scratch. What problem did it solve? (1-5 sentences)",
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert "linkedin_profile_url" not in classified
    assert "portfolio" not in classified


def test_planb_discovery_source_checkbox_group_counts_single_checked_option() -> None:
    fields = [
        {
            "index": 18,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "PLAN-B社員からの紹介 | 該当項目を選択してください。（複数選択可）\n必須\n\t\nPLAN-B社員からの紹介\nPLAN-B配信コンテンツ（note・YouTube・X）を見て知った\nGreen\nOpenWork\nビズリーチ\nその他 | PLAN-B社員からの紹介",
        },
        {
            "index": 20,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": True,
            "label": "Green | 該当項目を選択してください。（複数選択可）\n必須\n\t\nPLAN-B社員からの紹介\nPLAN-B配信コンテンツ（note・YouTube・X）を見て知った\nGreen\nOpenWork\nビズリーチ\nその他 | Green",
        },
        {
            "index": 23,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "その他 | 該当項目を選択してください。（複数選択可）\n必須\n\t\nPLAN-B社員からの紹介\nPLAN-B配信コンテンツ（note・YouTube・X）を見て知った\nGreen\nOpenWork\nビズリーチ\nその他 | その他",
        },
    ]

    assert adaptive_form_fields.required_unfilled_fields(fields) == []


def test_required_unfilled_and_hard_stop_helpers() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "value": ""},
        {"index": 2, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "value": "0: undefined"},
        {"index": 3, "tag": "input", "type": "file", "visible": True, "enabled": True, "required": True, "value": "resume.pdf"},
        {"index": 4, "tag": "input", "type": "radio", "visible": True, "enabled": True, "required": True, "name": "gender", "label": "Gender Male", "value": "male", "checked": True},
        {"index": 5, "tag": "input", "type": "radio", "visible": True, "enabled": True, "required": True, "name": "gender", "label": "Gender Female", "value": "female", "checked": False},
    ]

    missing = adaptive_form_fields.required_unfilled_fields(fields)

    assert [field["index"] for field in missing] == [1, 2]
    assert "assessment_or_test" in adaptive_form_fields.hard_stop_markers("応募後に適性検査があります")
    assert "identity_verification" in adaptive_form_fields.hard_stop_markers("Government ID required before continuing")
    assert "anti_bot_or_human_verification" in adaptive_form_fields.hard_stop_markers("Anti-bot verification required")
    assert "unsupported_language_requirement" in adaptive_form_fields.hard_stop_markers(
        "Important: if you do not speak Ukrainian, please do not apply."
    )


def test_assessment_hard_stop_does_not_match_customer_problem_context() -> None:
    assert "assessment_or_test" not in adaptive_form_fields.hard_stop_markers("顧客課題の整理と解決を支援します")

    positives = [
        "応募後に選考課題の提出が必要です",
        "課題提出があります",
        "take-home assignment required",
        "If you are a match, we will ask you to record a video interview within the next 24 hours.",
        "Web適性検査があります",
        "コーディングテストを受けてください",
    ]

    for text in positives:
        assert "assessment_or_test" in adaptive_form_fields.hard_stop_markers(text)


def test_required_unfilled_treats_empty_name_gender_radio_as_group() -> None:
    fields = [
        {"index": 0, "tag": "input", "type": "radio", "visible": True, "enabled": True, "required": True, "name": "", "label": "男性 | 性別\n必須\n\t\n男性\n女性 | 男性", "value": "on", "checked": True},
        {"index": 1, "tag": "input", "type": "radio", "visible": True, "enabled": True, "required": True, "name": "", "label": "女性 | 性別\n必須\n\t\n男性\n女性 | 女性", "value": "on", "checked": False},
    ]

    assert adaptive_form_fields.required_unfilled_fields(fields) == []


def test_required_unfilled_treats_hrmos_duplicated_gender_radio_as_group() -> None:
    fields = [
        {
            "index": 5,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "name": "",
            "label": "男性 | 性別\n必須\n\t\n男性\n女性 | 男性 | 男性",
            "value": "on",
            "checked": True,
        },
        {
            "index": 6,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "name": "",
            "label": "女性 | 性別\n必須\n\t\n男性\n女性 | 女性 | 女性 | 男性",
            "value": "on",
            "checked": False,
        },
    ]

    assert adaptive_form_fields.required_unfilled_fields(fields) == []


def test_required_unfilled_treats_empty_name_jlpt_radio_as_group() -> None:
    fields = [
        {"index": 18, "tag": "input", "type": "radio", "visible": True, "enabled": True, "required": True, "name": "", "label": "N1 | 日本語能力試験のランクを教えてください\n必須\n\t\nN1\nN2\nN3\nN4\nN5\n未受験 | N1", "value": "on", "checked": False},
        {"index": 19, "tag": "input", "type": "radio", "visible": True, "enabled": True, "required": True, "name": "", "label": "N2 | 日本語能力試験のランクを教えてください\n必須\n\t\nN1\nN2\nN3\nN4\nN5\n未受験 | N2", "value": "on", "checked": False},
        {"index": 23, "tag": "input", "type": "radio", "visible": True, "enabled": True, "required": True, "name": "", "label": "未受験 | 日本語能力試験のランクを教えてください\n必須\n\t\nN1\nN2\nN3\nN4\nN5\n未受験 | 未受験", "value": "on", "checked": True},
    ]

    assert adaptive_form_fields.required_unfilled_fields(fields) == []


def test_adaptive_classifier_handles_herp_required_location_timing_and_split_files() -> None:
    fields = [
        {"index": 10, "tag": "input", "type": "file", "visible": True, "enabled": True, "required": True, "label": "履歴書 必須", "value": "履歴書＿田仲二千.pdf"},
        {"index": 11, "tag": "input", "type": "file", "visible": True, "enabled": True, "required": True, "label": "職務経歴書 必須", "value": "職歴書＿田仲二千.pdf"},
        {"index": 13, "tag": "textarea", "type": "textarea", "visible": True, "enabled": True, "required": True, "label": "居住地 必須 現在お住まいの国や都道府県をご記入ください。", "value": "沖縄県那覇市"},
        {"index": 15, "tag": "textarea", "type": "textarea", "visible": True, "enabled": True, "required": True, "label": "転職希望時期 必須 希望する転職時期や入社時期をご記入ください。", "value": "内定後、相談のうえ調整可能です。"},
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "resume_file").index == 10
    assert adaptive_form_fields.best_match(classified, "career_file").index == 11
    assert adaptive_form_fields.best_match(classified, "residence").index == 13
    assert adaptive_form_fields.best_match(classified, "job_change_timing").index == 15
    assert adaptive_form_fields.required_unfilled_fields(fields) == []


def test_adaptive_classifier_treats_address_example_as_residence() -> None:
    fields = [
        {
            "index": 10,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "必須 | 例）東京都渋谷区渋谷2-15-1",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "residence").index == 10
    assert unknown == []


def test_adaptive_classifier_avoids_phone_false_positive_in_about_you_copy() -> None:
    fields = [
        {
            "index": 5,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": (
                "About you | About you To apply, please write something specifically "
                "for this position that tells us why we're a great fit for each other. | Type here..."
            ),
            "value": "",
        },
        {
            "index": 6,
            "tag": "input",
            "type": "tel",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Phone",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "application_message").index == 5
    assert adaptive_form_fields.best_match(classified, "phone").index == 6


def test_adaptive_classifier_treats_why_interested_textarea_as_application_message() -> None:
    fields = [
        {
            "index": 4,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Please add your LinkedIn profile. | Type here...",
            "value": "",
        },
        {
            "index": 5,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": (
                "Why are you interested in Reedsy and this role? | "
                "Please add your LinkedIn profile. | Type here..."
            ),
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "linkedin_profile_url").index == 4
    assert adaptive_form_fields.best_match(classified, "application_message").index == 5


def test_adaptive_classifier_treats_why_join_great_fit_textarea_as_application_message() -> None:
    fields = [
        {
            "index": 10,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": (
                "In your own words, why do you want to join Canals specifically "
                "and what makes you a great fit? | Name\nEmail\nPhone\nLinkedIn\n"
                "Location\nResume\nDo you currently have the legal right to work "
                "in the country where you are applying for this role?\nYes\nNo | Type here..."
            ),
            "primary_label": "In your own words, why do you want to join Canals specifically and what makes you a great fit?",
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "application_message").index == 10


def test_classifier_handles_social_media_and_location_required_fields() -> None:
    fields = [
        {
            "index": 5,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Add your Social Media: Linkedin, X, Telegram, YouTube or Discord.",
            "primary_label": "Add your Social Media: Linkedin, X, Telegram, YouTube or Discord.",
            "value": "",
        },
        {
            "index": 6,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What is your location?",
            "primary_label": "What is your location?",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "linkedin_profile_url").index == 5
    assert adaptive_form_fields.best_match(classified, "residence").index == 6


def test_adaptive_classifier_handles_ashby_hidden_canals_yes_no_questions() -> None:
    fields = [
        {
            "index": 7,
            "tag": "input",
            "type": "checkbox",
            "visible": False,
            "enabled": True,
            "required": False,
            "label": "Yes\nNo | Do you have expert, hands-on experience with Hubspot CRM?",
            "value": "on",
        },
        {
            "index": 8,
            "tag": "input",
            "type": "checkbox",
            "visible": False,
            "enabled": True,
            "required": False,
            "label": "Yes\nNo | Do you have experience in a B2B SaaS early-stage startup?",
            "value": "on",
        },
        {
            "index": 9,
            "tag": "input",
            "type": "checkbox",
            "visible": False,
            "enabled": True,
            "required": False,
            "label": "Yes\nNo | Do you have familiarity with technical integration options, e.g., APIs, webhooks?",
            "value": "on",
        },
        {
            "index": 11,
            "tag": "input",
            "type": "checkbox",
            "visible": False,
            "enabled": True,
            "required": False,
            "label": "Yes\nNo | Will you now or in the future require the company to sponsor a visa or work permit in order to work in this location?",
            "value": "on",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "hubspot_experience").index == 7
    assert adaptive_form_fields.best_match(classified, "role_experience_b2b_saas").index == 8
    assert adaptive_form_fields.best_match(classified, "role_experience_technical_integration").index == 9
    assert adaptive_form_fields.best_match(classified, "visa_sponsorship").index == 11


def test_adaptive_classifier_handles_monthly_salary_and_est_work_hours() -> None:
    fields = [
        {
            "index": 36,
            "tag": "input",
            "type": "number",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What is your expected monthly salary in USD for a full-time position (40 hours per week)?",
            "value": "",
        },
        {
            "index": 39,
            "tag": "input",
            "type": "checkbox",
            "visible": False,
            "enabled": True,
            "required": False,
            "label": "Yes\nNo | Can you work from 9:00 AM to 5:00 PM EST?",
            "value": "on",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 36
    assert adaptive_form_fields.best_match(classified, "timezone_us_eu_equivalent").index == 39


def test_adaptive_classifier_treats_what_excites_textarea_as_application_message() -> None:
    fields = [
        {
            "index": 5,
            "tag": "textarea",
            "type": "textarea",
            "label": "What excites you about Replit? | Questions | Type here...",
            "required": True,
            "visible": True,
            "enabled": True,
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "application_message").index == 5


def test_adaptive_classifier_treats_about_yourself_fit_textarea_as_application_message() -> None:
    fields = [
        {
            "index": 8,
            "tag": "textarea",
            "type": "textarea",
            "label": "Tell us a little bit about yourself and why you're a fit for this position. | Type here...",
            "required": False,
            "visible": True,
            "enabled": True,
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "application_message").index == 8


def test_adaptive_classifier_treats_bullet_point_why_work_textarea_as_application_message() -> None:
    fields = [
        {
            "index": 5,
            "tag": "textarea",
            "type": "textarea",
            "label": "In 3-5 bullet points, please describe why you'd like to work at Runway.",
            "required": True,
            "visible": True,
            "enabled": True,
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "application_message").index == 5


def test_adaptive_classifier_treats_runway_bilingual_and_travel_as_safe_known_facts() -> None:
    fields = [
        {
            "index": 5,
            "tag": "input",
            "type": "radio",
            "label": "Are you professionally bilingual in Japanese and English? | Yes",
            "required": True,
            "visible": True,
            "enabled": True,
            "value": "",
        },
        {
            "index": 6,
            "tag": "input",
            "type": "radio",
            "label": "Are you willing to travel to Japan at least once per quarter? | Yes",
            "required": True,
            "visible": True,
            "enabled": True,
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "language").index == 5
    assert adaptive_form_fields.best_match(classified, "application_condition_ack").index == 6


def test_adaptive_classifier_treats_city_country_placeholder_as_residence() -> None:
    fields = [
        {
            "index": 10,
            "tag": "input",
            "type": "input",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "e.g. Ottawa, Canada | e.g. Ottawa, Canada | Start typing...",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "residence").index == 10


def test_adaptive_classifier_ignores_ashby_optional_resume_autofill_helper() -> None:
    fields = [
        {
            "index": 0,
            "tag": "input",
            "type": "file",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Autofill from resume\n\nUpload your resume here to autofill key application fields.\n\nUpload file",
            "value": "",
        },
        {
            "index": 4,
            "tag": "input",
            "type": "file",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Resume | Upload File\n\nor drag and drop here | Resume | Resume",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert [match.index for match in classified["resume_file"]] == [4]
    assert "career_file" not in classified


def test_adaptive_classifier_ignores_optional_english_cover_letter_upload() -> None:
    fields = [
        {
            "index": 9,
            "tag": "input",
            "type": "file",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Cover Letter | Upload File\n\nor drag and drop here | Cover Letter",
            "value": "",
        },
        {
            "index": 10,
            "tag": "input",
            "type": "file",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Resume | Upload File\n\nor drag and drop here | Resume",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "resume_file").index == 10
    assert "career_file" not in classified
    assert "file" not in classified


def test_adaptive_classifier_does_not_treat_discovery_followup_as_github_profile() -> None:
    fields = [
        {
            "index": 22,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": (
                "If you selected Colleague/Friend, please list who shared this opportunity with you: | "
                "How did you find out about us?\nLinkedIn\nGithub\nOther/Not Listed | Type here..."
            ),
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert "github_profile_url" not in classified


def test_adaptive_classifier_treats_find_out_about_us_checkbox_as_discovery_source() -> None:
    fields = [
        {
            "index": 16,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Github | How did you find out about us?\nLinkedIn\nGithub\nOther/Not Listed | Github",
            "value": "on",
            "checked": False,
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "discovery_source").index == 16
    assert "github_profile_url" not in classified


def test_adaptive_classifier_prioritizes_currently_authorized_work_question_over_visa_words() -> None:
    fields = [
        {
            "index": 24,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": (
                "I am authorized to work in the United States without sponsorship, now or in the future | "
                "This role requires working from within the United States. Are you currently authorized to work in the US?"
            ),
            "value": "on",
            "checked": False,
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "work_authorization").index == 24
    assert "visa_sponsorship" not in classified


def test_user_only_required_fields_catches_us_current_address_and_state_residence() -> None:
    fields = [
        {
            "index": 27,
            "tag": "input",
            "type": "input",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "In which city and state do you currently reside? This information helps us align with our pre-determined pay bands based on location.",
            "value": "",
        },
        {
            "index": 31,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What is your current physical address where you will be working out of should you work here?",
            "value": "",
        },
        {
            "index": 32,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "In what US state do you reside/plan to reside in the near future?",
            "value": "",
        },
    ]

    user_only = adaptive_form_fields.user_only_required_fields(fields)

    assert [field["index"] for field in user_only] == [27, 31, 32]


def test_unsafe_required_fields_catches_marketing_ops_scenario_questions() -> None:
    fields = [
        {
            "index": 40,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "You launch a webinar campaign and registration volume is strong, but attendee-to-MQL conversion is significantly lower than previous events. What would you investigate first?",
            "value": "on",
            "checked": False,
        },
        {
            "index": 41,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Briefly describe one automated lifecycle journey or workflow you built. What audience was it for, what triggered it, and what result did it drive?",
            "value": "",
        },
    ]

    unsafe = adaptive_form_fields.unsafe_required_fields(fields)

    assert [field["index"] for field in unsafe] == [40, 41]


def test_adaptive_classifier_handles_legal_name_and_w2_proceed_ack() -> None:
    fields = [
        {
            "index": 13,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Please confirm your legal first and last name*",
            "value": "",
        },
        {
            "index": 14,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "This is a full-time, W2 position - do you wish to proceed with your application? *",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "name").index == 13
    assert adaptive_form_fields.best_match(classified, "application_condition_ack").index == 14


def test_adaptive_classifier_handles_common_human_like_required_fields() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "checkbox", "visible": True, "enabled": True, "required": True, "label": "個人情報の取り扱いに同意します", "value": "", "checked": False},
        {"index": 2, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "label": "Country 国または地域", "value": "", "options": [{"label": "Japan", "value": "JP"}]},
        {"index": 3, "tag": "input", "type": "radio", "visible": True, "enabled": True, "required": True, "label": "Are you legally authorized to work?", "value": "", "checked": False},
        {"index": 4, "tag": "input", "type": "radio", "visible": True, "enabled": True, "required": True, "label": "Will you now or in the future require visa sponsorship?", "value": "", "checked": False},
        {"index": 5, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "Desired compensation / 希望年収", "value": ""},
        {"index": 6, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "label": "Language / 語学", "value": ""},
        {"index": 7, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "Nationality / 国籍", "value": ""},
        {"index": 8, "tag": "input", "type": "radio", "visible": True, "enabled": True, "required": True, "label": "健康状態", "value": "", "checked": False},
        {"index": 9, "tag": "input", "type": "radio", "visible": True, "enabled": True, "required": True, "label": "Smoker / 喫煙", "value": "", "checked": False},
        {"index": 10, "tag": "input", "type": "number", "visible": True, "enabled": True, "required": True, "label": "年齢", "value": ""},
        {"index": 11, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": False, "label": "最終学歴", "value": ""},
        {"index": 12, "tag": "textarea", "type": "textarea", "visible": True, "enabled": True, "required": False, "label": "経歴", "value": ""},
        {"index": 13, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": False, "label": "学部・学科", "value": ""},
        {"index": 14, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": False, "label": "学位", "value": ""},
        {"index": 15, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": False, "label": "雇用形態", "value": ""},
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "consent").index == 1
    assert adaptive_form_fields.best_match(classified, "country").index == 2
    assert adaptive_form_fields.best_match(classified, "work_authorization").index == 3
    assert adaptive_form_fields.best_match(classified, "visa_sponsorship").index == 4
    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 5
    assert adaptive_form_fields.best_match(classified, "language").index == 6
    assert adaptive_form_fields.best_match(classified, "country").index == 2
    assert adaptive_form_fields.best_match(classified, "health").index == 8
    assert adaptive_form_fields.best_match(classified, "smoker").index == 9
    assert adaptive_form_fields.best_match(classified, "age").index == 10
    assert adaptive_form_fields.best_match(classified, "school").index == 11
    assert adaptive_form_fields.best_match(classified, "work_body").index == 12
    assert adaptive_form_fields.best_match(classified, "department").index == 13
    assert adaptive_form_fields.best_match(classified, "degree").index == 14
    assert adaptive_form_fields.best_match(classified, "employment").index == 15


def test_classifier_treats_hrmos_acknowledgement_radios_as_consent() -> None:
    fields = [
        {
            "index": 19,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "承知しました | メールアドレスはPCのメールアドレスをを記載ください。\n必須\n\t\n承知しました\n貴社・ご担当者様のメールアドレスではなく、候補者様のメールアドレスをご記入くださいませ。 | 承知しました",
            "value": "on",
        },
        {
            "index": 20,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "承知しました | 候補者様の電話番号を必ずご記入ください。\n必須\n\t\n承知しました\n面接当日の緊急連絡先として、電話番号をご記入ください。 | 承知しました",
            "value": "on",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert [match.index for match in classified["consent"]] == [19, 20]
    assert unknown == []


def test_unsafe_required_fields_stop_sensitive_or_assessment_inputs() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "Passport number", "value": ""},
        {"index": 2, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "Bank account", "value": ""},
        {"index": 3, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": False, "label": "Optional certificate number", "value": ""},
        {"index": 4, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "希望年収", "value": ""},
    ]

    unsafe = adaptive_form_fields.unsafe_required_fields(fields)

    assert [field["index"] for field in unsafe] == [1, 2]


def test_user_only_required_fields_stop_personal_history_inputs() -> None:
    fields = [
        {
            "index": 9,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "独身 | 婚姻歴\n必須\n\t\n独身\n既婚 | 独身",
        },
        {
            "index": 30,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "いいえ | 採用説明会に参加したことがありますか\n必須\n\t\nはい\nいいえ | いいえ",
        },
    ]

    user_only = adaptive_form_fields.user_only_required_fields(fields)

    assert [field["index"] for field in user_only] == [9, 30]


def test_unsafe_required_fields_do_not_treat_customer_problem_as_assessment() -> None:
    fields = [
        {"index": 1, "tag": "textarea", "type": "textarea", "visible": True, "enabled": True, "required": True, "label": "顧客課題の整理経験", "value": "AI導入やマーケティング改善で顧客課題を整理しました。"},
        {"index": 2, "tag": "textarea", "type": "textarea", "visible": True, "enabled": True, "required": True, "label": "選考課題の提出", "value": ""},
    ]

    unsafe = adaptive_form_fields.unsafe_required_fields(fields)

    assert [field["index"] for field in unsafe] == [2]


def test_unsafe_required_fields_do_not_treat_softbank_email_hint_as_bank() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "email",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "メールアドレス 必須 キャリアメール（docomo.ne.jp、softbank.ne.jp、au.com 等）は非推奨です。",
            "value": "",
        },
    ]

    assert adaptive_form_fields.unsafe_required_fields(fields) == []


def test_required_unknown_uses_only_autofill_safe_classifications_before_mutation() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "Portfolio URL 必須", "value": ""},
        {"index": 2, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "資格 必須", "value": ""},
        {"index": 3, "tag": "input", "type": "email", "visible": True, "enabled": True, "required": True, "label": "Email", "value": ""},
        {"index": 4, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "label": "Country", "value": ""},
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert [field["index"] for field in unknown] == [1, 2]


def test_hrmos_period_and_start_timing_fields_are_safe_autofill() -> None:
    fields = [
        {
            "index": 10,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "内定から入社までの期間 必須 ※例）内定承諾から〇ヵ月後／2025年〇月入社可能",
            "value": "",
        },
        {
            "index": 15,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "在籍期間 必須 2026 2025 2024 年 1 2 3 月 〜 2026 2025 2024 年 1 2 3 月",
            "value": "0: undefined",
        },
        {
            "index": 27,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "現在働いている | 在籍期間 必須",
            "value": "on",
            "checked": False,
        },
        {
            "index": 30,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "最低希望年収 必須",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "job_change_timing").index == 10
    assert adaptive_form_fields.best_match(classified, "education_period").index == 15
    assert adaptive_form_fields.best_match(classified, "current_working").index == 27
    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 30
    assert unknown == []


def test_required_unfilled_accepts_finished_work_period_without_current_working_checkbox() -> None:
    fields = [
        {
            "index": 23,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "在籍期間 必須 開始年",
            "value": "2024",
        },
        {
            "index": 24,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "在籍期間 必須 開始月",
            "value": "10",
        },
        {
            "index": 25,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "在籍期間 必須 終了年",
            "value": "2026",
        },
        {
            "index": 26,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "在籍期間 必須 終了月",
            "value": "6",
        },
        {
            "index": 27,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "現在働いている | 在籍期間 必須",
            "value": "on",
            "checked": False,
        },
    ]

    assert adaptive_form_fields.required_unfilled_fields(fields) == []


def test_moneyforward_hrmos_location_referral_and_intent_are_safe_autofill() -> None:
    fields = [
        {
            "index": 7,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "東京 | 希望勤務地を教えてください。\n必須\n\t\n東京\n北海道\n大阪 | 東京",
        },
        {
            "index": 8,
            "tag": "input",
            "type": "checkbox",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "北海道 | 希望勤務地を教えてください。\n必須\n\t\n東京\n北海道\n大阪 | 北海道",
        },
        {
            "index": 18,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "エントリーしたことを上記社員に伝えますか？\n必須\n\t\n選択\n伝える\n伝えない\n※社員紹介に該当しない場合はこちらをご選択ください※",
            "value": "",
        },
        {
            "index": 19,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "転職に関する意向\n必須\n\t\n選択\nまずはカジュアルに話を聞いてみたい\n積極的に転職活動中（選考を希望する）",
            "value": "",
        },
        {
            "index": 25,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "checked": False,
            "label": "以下、メール受信設定についての説明を読みました | メール受信設定の確認\n必須\n\t\n以下、メール受信設定についての説明を読みました",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert [match.index for match in classified["preferred_location"]] == [7, 8]
    assert adaptive_form_fields.best_match(classified, "referral_notification").index == 18
    assert adaptive_form_fields.best_match(classified, "job_search_intent").index == 19
    assert adaptive_form_fields.best_match(classified, "consent").index == 25
    assert unknown == []

    filled_fields = [dict(field, checked=(field["index"] in {7, 25})) for field in fields]
    filled_fields[2]["value"] = "4: ※社員紹介に該当しない場合はこちらをご選択ください※"
    filled_fields[3]["value"] = "3: 積極的に転職活動中（選考を希望する）"
    assert adaptive_form_fields.required_unfilled_fields(filled_fields) == []


def test_greenhouse_ai_trainer_education_and_us_state_fields_are_safe_autofill() -> None:
    fields = [
        {"index": 8, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "Degree* | Select... | Select...", "value": ""},
        {"index": 10, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "Discipline* | Select... | Select...", "value": ""},
        {"index": 12, "tag": "input", "type": "number", "visible": True, "enabled": True, "required": True, "id": "start-year--0", "label": "Start date year* | Start date year* | Start date year", "value": ""},
        {"index": 13, "tag": "input", "type": "number", "visible": True, "enabled": True, "required": True, "id": "end-year--0", "label": "End date year* | End date year* | End date year", "value": ""},
        {"index": 16, "tag": "input", "type": "text", "visible": True, "enabled": True, "required": True, "label": "If you are currently based in United States, please confirm your current state of residence. If you are based outside of the United States, select \"I am not located in the United States\".* | Select... | Select...", "value": ""},
        {"index": 19, "tag": "input", "type": "checkbox", "visible": True, "enabled": True, "required": True, "label": "Please acknowledge that you have read and agree to our Privacy Policy. * | Yes", "value": ""},
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "degree").index == 8
    assert adaptive_form_fields.best_match(classified, "discipline").index == 10
    assert adaptive_form_fields.best_match(classified, "education_start_year").index == 12
    assert adaptive_form_fields.best_match(classified, "education_end_year").index == 13
    assert adaptive_form_fields.best_match(classified, "us_state_if_based_in_us").index == 16
    assert adaptive_form_fields.best_match(classified, "consent").index == 19
    assert unknown == []


def test_privacy_policy_footer_text_alone_is_not_consent() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "checkbox", "visible": True, "enabled": True, "required": True, "label": "Read our footer links: Privacy Policy Terms Cookies", "value": ""},
        {"index": 2, "tag": "input", "type": "checkbox", "visible": True, "enabled": True, "required": True, "label": "I agree to the Recruiting Privacy Policy", "value": ""},
        {"index": 3, "tag": "input", "type": "checkbox", "visible": True, "enabled": True, "required": True, "label": "CPRA Notice acknowledgement", "value": ""},
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert [match.index for match in classified["consent"]] == [2, 3]


def test_referral_names_and_desired_position_text_are_not_safe_autofill() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "社員紹介者名\n必須",
            "value": "",
        },
        {
            "index": 2,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "面談または選考を希望する部門・ポジション（あれば）\n必須",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert "referral_notification" not in classified
    assert "job_search_intent" not in classified
    assert [field["index"] for field in unknown] == [1, 2]


def test_classifier_treats_hrmos_desired_salary_and_start_date_as_safe() -> None:
    fields = [
        {
            "index": 1,
            "tag": "textarea",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "ご希望の年収\n必須",
            "value": "",
        },
        {
            "index": 2,
            "tag": "textarea",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "最短の入社可能日\n必須",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 1
    assert adaptive_form_fields.best_match(classified, "job_change_timing").index == 2
    assert unknown == []


def test_classifier_does_not_treat_replit_project_prompt_as_name() -> None:
    fields = [
        {
            "index": 1,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "If you want to share something you built with Replit, please include a Replit profile URL.",
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert "name" not in classified
    assert "first_name" not in classified
    assert "last_name" not in classified


def test_classifier_treats_future_employment_visa_sponsorship_as_sponsorship_not_authorization() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Will you now, or in the future, require sponsorship for employment visa status (e.g. H-1B visa status)?",
            "value": "Yes",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "visa_sponsorship").index == 1
    assert "work_authorization" not in classified


def test_classifier_resolves_nex_japan_authorization_and_native_japanese_required_fields() -> None:
    fields = [
        {
            "index": 11,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Are you authorised to work in Japan?* | Select...",
            "value": "",
        },
        {
            "index": 17,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Do you speak native or near-native Japanese?* | Select...",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "work_authorization").index == 11
    assert adaptive_form_fields.best_match(classified, "language").index == 17
    assert unknown == []


def test_classifier_resolves_iherb_safe_disclosure_and_signature_fields() -> None:
    fields = [
        {
            "index": 11,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Are you currently an iHerb Core Team Member?* | Select...",
            "value": "",
        },
        {
            "index": 13,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "If you answered \"Yes\" that you are currently an iHerb core team member, what is your Employee ID? (say N/A if you are not currently an iHerb core team member)*",
            "value": "",
        },
        {
            "index": 24,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Are you engaged in any business activities that would be in direct conflict with iHerb's business or customers?* | Select...",
            "value": "",
        },
        {
            "index": 26,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "If \"Yes\" list business activities here. If \"No\", you can say N/A.*",
            "value": "",
        },
        {
            "index": 41,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Employment Application - Certification*",
            "value": "",
        },
        {
            "index": 27,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Are you 18 or older?* | Select...",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "negative_confirmation").index == 11
    assert [match.index for match in classified["not_applicable_text"]] == [13, 26]
    assert adaptive_form_fields.best_match(classified, "signature_name").index == 41
    assert adaptive_form_fields.best_match(classified, "age").index == 27
    assert unknown == []


def test_classifier_does_not_treat_iherb_current_company_as_name() -> None:
    fields = [
        {
            "index": 36,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "What is the name of your current company? | What is the name of your current company?",
            "value": "",
        },
        {
            "index": 37,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "What is your current job title? | What is your current job title?",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert "name" not in classified
    assert adaptive_form_fields.best_match(classified, "company").index == 36
    assert adaptive_form_fields.best_match(classified, "position").index == 37


def test_classifier_resolves_iherb_discovery_and_referral_without_name_or_position_leak() -> None:
    fields = [
        {
            "index": 15,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "How did you first hear about this position?* | Select...",
            "value": "",
        },
        {
            "index": 18,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Were you referred to this position by a current iHerb employee? If \"Yes\", please note that person's name below. If \"No\", you can say N/A.*",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "discovery_source").index == 15
    assert adaptive_form_fields.best_match(classified, "not_applicable_text").index == 18
    assert "position" not in classified
    assert "name" not in classified


def test_classifier_treats_unlabeled_file_input_as_generic_file() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "file", "visible": True, "enabled": True, "required": False, "label": "", "value": ""},
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "file").index == 1


def test_classifier_treats_hidden_file_input_as_generic_file() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "file", "visible": False, "enabled": True, "required": False, "label": "", "value": ""},
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "file").index == 1


def test_classifier_treats_role_experience_selectors_as_safe_known_facts() -> None:
    fields = [
        {"index": 1, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "label": "How many years of B2B Marketing experience do you have?", "value": ""},
        {"index": 2, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "label": "Do you have product marketing and GTM experience?", "value": ""},
        {"index": 3, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "label": "Do you have life sciences or regulated industry experience?", "value": ""},
        {"index": 4, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "label": "How many years of cross-functional marketing initiatives have you led?", "value": ""},
        {"index": 5, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "label": "Do you have centralized marketing experience?", "value": ""},
        {"index": 6, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "label": "Select your digital marketing channels: SEO/SEM, content marketing, social media marketing", "value": ""},
        {"index": 7, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "label": "How much demand generation experience do you have?", "value": ""},
        {"index": 8, "tag": "select", "type": "select-one", "visible": True, "enabled": True, "required": True, "label": "Have you created sales enablement collateral or product guides?", "value": ""},
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "role_experience_b2b_marketing").index == 1
    assert adaptive_form_fields.best_match(classified, "role_experience_product_marketing").index == 2
    assert adaptive_form_fields.best_match(classified, "role_experience_regulated_industry").index == 3
    assert adaptive_form_fields.best_match(classified, "role_experience_cross_functional").index == 4
    assert adaptive_form_fields.best_match(classified, "role_experience_corporate_marketing").index == 5
    assert adaptive_form_fields.best_match(classified, "role_experience_digital_marketing").index == 6
    assert adaptive_form_fields.best_match(classified, "role_experience_demand_generation").index == 7
    assert adaptive_form_fields.best_match(classified, "role_experience_sales_enablement").index == 8
    assert unknown == []


def test_classifier_treats_gaming_industry_yes_no_as_specific_safe_role_experience() -> None:
    fields = [
        {
            "index": 17,
            "tag": "select",
            "type": "select",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Select...\nYes\nNo | Do you have prior work experience in the Gaming industry?\n✱",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "role_experience_gaming_industry").index == 17
    assert "work_body" not in classified
    assert unknown == []


def test_classifier_treats_lilt_ai_data_project_experience_as_safe_known_fact() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Do you have previous experience in AI Data-related projects? If yes, please expand",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "ai_data_project_experience").index == 1
    assert unknown == []


def test_classifier_treats_native_japanese_segmented_control_as_language() -> None:
    fields = [
        {
            "index": 6,
            "tag": "input",
            "type": "checkbox",
            "visible": False,
            "enabled": True,
            "required": False,
            "label": "Yes\nNo | Are you a native speaker of Japanese? | Are you a native speaker of Japanese?\nYes\nNo",
            "value": "on",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "language").index == 6


def test_classifier_treats_salary_expectations_as_expected_salary() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What are your salary expectations? Please include your local currency, and a range of minimum to maximum",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 1


def test_classifier_treats_expected_monthly_salary_with_nearby_location_as_expected_salary() -> None:
    fields = [
        {
            "index": 6,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Expected Monthly Salary | Please provide us with your gross monthly salary expectations in USD or ZAR, as this is essential to our selection process. | Location | Type here...",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 6
    assert "residence" not in classified


def test_classifier_keeps_location_field_as_residence_when_near_salary_context() -> None:
    fields = [
        {
            "index": 4,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Salary Expectations? | Salary Expectations? | Type here...",
            "primary_label": "Salary Expectations?",
            "value": "",
        },
        {
            "index": 5,
            "tag": "input",
            "type": "input",
            "visible": True,
            "enabled": True,
            "required": False,
            "label": "Location | Location | Salary Expectations? | Location | Start typing...",
            "primary_label": "Location",
            "value": "",
        },
    ]

    classified = adaptive_form_fields.classify_fields(fields)

    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 4
    assert adaptive_form_fields.best_match(classified, "residence").index == 5


def test_classifier_treats_compensation_expectations_as_expected_salary() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What are your compensation expectations for your next role?",
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 1
    assert unknown == []


def test_classifier_treats_target_compensation_as_expected_salary() -> None:
    fields = [
        {
            "index": 9,
            "tag": "input",
            "type": "number",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Target Compensation | Target Compensation | LinkedIn Profile | Type here...",
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "expected_salary").index == 9
    assert unknown == []


def test_classifier_accepts_linkedin_typo_as_linkedin_profile() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "Linkedln",
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "linkedin_profile_url").index == 1
    assert unknown == []


def test_classifier_treats_hands_on_marketing_years_as_safe_role_experience() -> None:
    fields = [
        {
            "index": 1,
            "tag": "input",
            "type": "radio",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": (
                "How many years of hands-on marketing experience do you have? "
                "Less than 1 year 1-2 years 2-3 years 3-5 years 5+ years"
            ),
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "role_experience_marketing_years").index == 1
    assert unknown == []


def test_classifier_treats_about_you_great_fit_prompt_as_application_message() -> None:
    fields = [
        {
            "index": 1,
            "tag": "textarea",
            "type": "textarea",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": (
                "About you | About you\n\nTo apply, please write something specifically for this position "
                "that tells us why we're a great fit for each other, and what you see the future "
                "being like if we work together. Is there a project or feature you'd love for us to build together?"
            ),
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "application_message").index == 1
    assert unknown == []


def test_classifier_treats_what_made_you_apply_as_application_message() -> None:
    fields = [
        {
            "index": 10,
            "tag": "input",
            "type": "text",
            "visible": True,
            "enabled": True,
            "required": True,
            "label": "What is it about Gamma or this specific role that made you apply?",
            "value": "",
        }
    ]

    classified = adaptive_form_fields.classify_fields(fields)
    unknown = adaptive_form_fields.required_unknown_fields(
        fields,
        classified,
        adaptive_form_fields.AUTOFILL_SAFE_FIELD_KEYS,
    )

    assert adaptive_form_fields.best_match(classified, "application_message").index == 10
    assert unknown == []
