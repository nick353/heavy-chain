from scripts.job_applications import ats_form_intelligence_core as core


PROFILE = {
    "firstName": "Nichika",
    "lastName": "Tanaka",
    "email": "nichika2000823@gmail.com",
    "phone": "+81 90-8834-3768",
    "school": "Shih Chien University",
    "degree": "Bachelor's degree",
    "discipline": "International Business and Administration",
    "currentCompany": "Perfect Corp. - AI/AR Beauty Tech",
    "currentTitle": "Digital Marketing & Blog Specialist",
    "workAuthorization": "Yes",
    "visaSponsorship": "No",
}


def test_universal_plan_allows_databricks_style_japan_work_authorization_only_with_japan_role() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "text", "required": True, "label": "First name"},
        {
            "index": 2,
            "tag": "input",
            "type": "radio",
            "required": True,
            "label": "Are you legally authorized to work in the country in which you are applying?",
        },
    ]

    japan_plan = core.build_universal_input_plan(
        fields,
        ats="greenhouse",
        role_context="Head of Marketing - Japan",
        profile=PROFILE,
    )
    non_japan_plan = core.build_universal_input_plan(
        fields,
        ats="greenhouse",
        role_context="Marketing Operations Manager",
        profile=PROFILE,
    )

    assert japan_plan["answer_map"]["work_authorization"] == "Yes"
    assert japan_plan["human_required_count"] == 0
    assert "work_authorization" not in non_japan_plan["answer_map"]
    assert any(
        item["key"] == "work_authorization" and item["reason"] == "generic_or_non_japan_work_authorization"
        for item in non_japan_plan["items"]
    )


def test_universal_plan_blocks_salary_signature_and_non_japan_sponsorship() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "text", "required": True, "label": "Expected compensation"},
        {"index": 2, "tag": "input", "type": "text", "required": True, "label": "Signature / I certify"},
        {
            "index": 3,
            "tag": "input",
            "type": "radio",
            "required": True,
            "label": "Will you now or in the future require visa sponsorship?",
        },
    ]

    plan = core.build_universal_input_plan(
        fields,
        ats="ashby",
        role_context="Lifecycle Marketing Manager",
        profile=PROFILE,
    )

    assert plan["hard_stop_count"] >= 2
    assert "visa_sponsorship" not in plan["answer_map"]
    assert any(item["key"] == "visa_sponsorship" and item["status"] == "human_required" for item in plan["items"])


def test_universal_plan_uses_resume_profile_safe_facts_across_ats() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "text", "required": True, "label": "School / University"},
        {"index": 2, "tag": "input", "type": "text", "required": True, "label": "Degree"},
        {"index": 3, "tag": "input", "type": "text", "required": True, "label": "Current company"},
        {"index": 4, "tag": "input", "type": "text", "required": True, "label": "Current title"},
    ]

    plan = core.build_universal_input_plan(fields, ats="lever", role_context="Japan Marketing Lead", profile=PROFILE)

    assert plan["answer_map"]["school"] == "Shih Chien University"
    assert plan["answer_map"]["degree"] == "Bachelor's degree"
    assert plan["answer_map"]["company"] == "Perfect Corp. - AI/AR Beauty Tech"
    assert plan["answer_map"]["position"] == "Digital Marketing & Blog Specialist"


def test_universal_plan_treats_required_location_as_resume_safe_fact() -> None:
    fields = [
        {"index": 1, "tag": "input", "type": "text", "required": True, "label": "Location"},
        {"index": 2, "tag": "input", "type": "text", "required": True, "label": "Current location"},
    ]
    profile = {**PROFILE, "currentLocation": "Naha, Okinawa, Japan"}

    plan = core.build_universal_input_plan(fields, ats="ashby", role_context="Product Marketing Manager", profile=profile)

    assert plan["answer_map"]["residence"] == "Naha, Okinawa, Japan"
    assert plan["human_required_count"] == 0
    assert all(item["status"] == "planned" for item in plan["items"])
