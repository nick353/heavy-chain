import importlib.util
import json
import subprocess
import sys
import time
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = PROJECT_ROOT / "scripts/job_applications"
sys.path.insert(0, str(SCRIPT_DIR))
MODULE_PATH = PROJECT_ROOT / "scripts/job_applications/run_official_company_discovery.py"
SPEC = importlib.util.spec_from_file_location("run_official_company_discovery", MODULE_PATH)
assert SPEC and SPEC.loader
discovery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(discovery)


def test_candidate_key_set_includes_canonical_and_official_hash() -> None:
    keys = discovery.candidate_key_set("https://www.example.com/jobs/123/?utm_source=x#fragment", "slug-key")

    assert "slug-key" in keys
    assert "https://example.com/jobs/123" in keys
    assert "official-9bd90e620890c8ab" in keys


def test_ashby_application_url_and_job_url_share_keys() -> None:
    job_url = "https://jobs.ashbyhq.com/3commas/5e67ca9f-8ec0-4805-81a3-f4e691f71f82"
    application_url = f"{job_url}/application"

    assert discovery.candidate_key_set(job_url) == discovery.candidate_key_set(application_url)


def test_public_ats_link_from_official_page_is_allowed() -> None:
    target = {"company": "Example"}
    assert discovery.same_company_domain(
        "https://www.example.com/careers",
        "https://jobs.ashbyhq.com/example/abc123",
        target,
    )
    assert not discovery.same_company_domain(
        "https://www.example.com/careers",
        "https://jobs.ashbyhq.com/other-company/abc123",
        target,
    )
    assert discovery.same_company_domain(
        "https://jobs.ashbyhq.com/example",
        "https://jobs.ashbyhq.com/example/abc123",
    )
    assert discovery.same_company_domain(
        "https://job-boards.greenhouse.io/example",
        "https://job-boards.greenhouse.io/example/jobs/123",
    )
    assert discovery.same_company_domain(
        "https://boards.greenhouse.io/example",
        "https://job-boards.greenhouse.io/example/jobs/123",
    )
    assert not discovery.same_company_domain(
        "https://jobs.ashbyhq.com/example",
        "https://jobs.ashbyhq.com/other-company/abc123",
    )


def test_cooldown_keys_include_user_only_outcome_url_and_key(tmp_path: Path) -> None:
    outcomes = tmp_path / "outcomes.jsonl"
    outcomes.write_text(
        json.dumps(
            {
                "pipelineRow": {
                    "job_id_or_canonical_key": "official-lever-rws-trainai",
                    "job_url": "https://jobs.lever.co/rws/726a3bbc-1a36-48a2-84eb-24a43f5af088?utm_source=x",
                    "state": "needs_user_review",
                    "blocker_reason": "user_only_required_fields_before_mutation",
                }
            }
        )
        + "\n",
        encoding="utf-8",
    )

    keys = discovery.load_cooldown_keys([outcomes])

    assert "official-lever-rws-trainai" in keys
    assert "https://jobs.lever.co/rws/726a3bbc-1a36-48a2-84eb-24a43f5af088" in keys
    assert "official-534088a275015e8b" in keys


def test_existing_key_overlap_detects_submitted_confirmed_hash() -> None:
    existing = {"official-dbfbe0a25e0046f4"}
    candidate_keys = discovery.candidate_key_set("https://jobs.lever.co/wgsn/fdb36bf4-6fcc-4112-aa20-18f89e7a52e6")

    assert candidate_keys & existing


def test_bucket_hints_separate_japan_and_overseas_targets() -> None:
    japan_target = {
        "company": "Amazon Japan / AWS Japan",
        "official_careers_url": "https://www.amazon.jobs/en/search?base_query=marketing&loc_query=Japan",
        "target_keywords": ["marketing", "Japan"],
    }
    overseas_target = {
        "company": "OpenArt",
        "official_careers_url": "https://jobs.ashbyhq.com/OpenArt",
        "target_keywords": ["marketing", "remote", "AI"],
    }

    assert discovery.target_allowed_for_bucket(japan_target, "japan_targeted")
    assert not discovery.target_allowed_for_bucket(japan_target, "overseas_global")
    assert discovery.target_allowed_for_bucket(overseas_target, "overseas_global")
    assert not discovery.target_allowed_for_bucket(overseas_target, "japan_targeted")


def test_candidate_fits_bucket_rejects_cross_bucket_leakage() -> None:
    assert discovery.candidate_fits_bucket(
        "japan_targeted",
        "Marketing Manager, Marketing & Program, Amazon Business",
        "https://www.amazon.jobs/en/jobs/10439965/marketing-manager-marketing-program-amazon-business?loc_query=Japan",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Marketing Manager, Marketing & Program, Amazon Business Japan",
        "https://www.amazon.jobs/en/jobs/10439965/marketing-manager-marketing-program-amazon-business",
    )
    assert discovery.candidate_fits_bucket(
        "overseas_global",
        "Email Marketing Manager Content Marketing San Francisco Hybrid",
        "https://jobs.ashbyhq.com/OpenArt/4946e3b6-9938-440a-8f65-5bba1552fead",
    )
    assert not discovery.candidate_fits_bucket(
        "japan_targeted",
        "Email Marketing Manager Content Marketing San Francisco Hybrid",
        "https://jobs.ashbyhq.com/OpenArt/4946e3b6-9938-440a-8f65-5bba1552fead",
    )


def test_overseas_candidate_fits_bucket_rejects_region_auth_blockers() -> None:
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Product Marketing Manager Marketing Remote - Canada Remote - Toronto, Ontario",
        "https://jobs.ashbyhq.com/nylas/2acb49b8-4e50-4829-830f-dfe773726d57",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Technical Head of Brand San Francisco, CA OR Remote (Americas, UTC-3 to UTC-10)",
        "https://jobs.ashbyhq.com/firecrawl/8e835654-7765-48c0-925e-4a088635514f",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Content Strategist Remote cannot sponsor visas authorized to work for an employer in the United States",
        "https://jobs.ashbyhq.com/victorious/84e9c75c-0176-4e49-b2b8-3b12a0181971",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Content Marketing Manager Remote Canada we do not sponsor visas",
        "https://jobs.ashbyhq.com/example/canada-no-sponsor",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Growth Marketer Remote U.S. unable to sponsor visa sponsorship is not available",
        "https://jobs.ashbyhq.com/example/us-no-sponsorship",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Ecosystem Marketing Lead Marketing • United States • Full time • Remote",
        "https://jobs.ashbyhq.com/trm-labs/29b027c2-d576-4dfe-b4d9-aa397573a919",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Senior Manager, End User Services Remote, North America",
        "https://job-boards.greenhouse.io/gitlab/jobs/8597889002",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Field Marketing Representative Remote — EE Full-TimeUnitedStates",
        "https://jobs.lever.co/gohighlevel/0d91f66d-3cd2-4cf7-816b-15c6a738d846",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Field Marketing RepresentativeRemote — EE Full-TimeUnitedStates",
        "https://jobs.lever.co/gohighlevel/0d91f66d-3cd2-4cf7-816b-15c6a738d846",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Manager, Integrated Marketing Hybrid — EE Full-Time Dallas",
        "https://jobs.lever.co/gohighlevel/51408006-8f3f-47c6-a689-662fac257205",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Marketing Automation Specialist II Remote — Employee IndiaIndia",
        "https://jobs.lever.co/gohighlevel/521ea396-df7c-41a6-8b9f-5d080ec54354",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Talent Community & Growth Manager Marketing • New York City • Full time • Remote",
        "https://jobs.ashbyhq.com/trm-labs/b4fb729a-261d-4d2b-a0b3-1d7b5db91da6",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Sr. Performance Marketing Manager, Meta California, USA",
        "https://job-boards.greenhouse.io/masterclass/jobs/8017915",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Director of Marketing New Fort Lauderdale, FL",
        "https://job-boards.greenhouse.io/crisprecruit/jobs/5176024007",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Director of Marketing Sales & Marketing • Hybrid (Los Angeles, CA) • Full time • Hybrid",
        "https://jobs.ashbyhq.com/ivai/9dec92df-e327-4a97-b904-92e76aca4221",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Head of Marketing McAllen, TX",
        "https://job-boards.greenhouse.io/crisprecruit/jobs/5061813007",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Growth Marketing Associate Contract Remote $1K – $1.2K per month",
        "https://jobs.ashbyhq.com/hirehangar/3745c2c0-71a1-4c8a-ba36-aace7d7ff7d8",
    )
    assert not discovery.candidate_fits_bucket(
        "overseas_global",
        "Sr. Developer Advocate Marketing Remote - Toronto, Ontario; Remote - Denver; Remote - Vancouver",
        "https://jobs.ashbyhq.com/nylas/03b16081-14e0-46b5-adca-5c254b2fc65f",
    )
    assert discovery.candidate_fits_bucket(
        "overseas_global",
        "Content Marketing Manager Remote Worldwide Global",
        "https://jobs.ashbyhq.com/example/remote-worldwide-content-marketing",
    )


def test_weak_non_marketing_roles_do_not_pass_score_threshold() -> None:
    target = {"target_keywords": ["marketing", "content", "remote"]}
    assert discovery.link_score(
        target,
        "Customer Support GTM Remote Full time",
        "https://jobs.ashbyhq.com/example/7759305d-c53c-4d4b-ad66-84fe55b13779",
    ) < 6
    assert discovery.link_score(
        target,
        "Forward Deployed Engineer Marketing San Francisco",
        "https://jobs.ashbyhq.com/example/e1543e63-bc33-48df-a823-24c3241748ee",
    ) < 6
    assert discovery.link_score(
        target,
        "Events & Brand Coordinator Operations Team San Francisco, CA (Hybrid)",
        "https://jobs.ashbyhq.com/example/875020ac-6846-47a3-b39e-e8a55c6ab266",
    ) < 6
    assert discovery.link_score(
        target,
        "Senior Account Manager Accounts Remote Full time",
        "https://jobs.ashbyhq.com/example/9e06be61-dc85-4da7-9af3-f0f6ed375eac",
    ) < 6
    assert discovery.link_score(
        target,
        "Business Development Representative | AI Pentesting Business Team NYC Office Full time Hybrid",
        "https://jobs.ashbyhq.com/example/87c1ee66-3495-4aef-8615-ccd23e8cc6a7",
    ) < 6
    assert discovery.link_score(
        target,
        "Founding AI Success Manager APAC Australia Remote",
        "https://job-boards.greenhouse.io/example/jobs/5112255008",
    ) < 6
    assert discovery.link_score(
        target,
        "Join the Talent Safari Community Talent Safari Anywhere Full time",
        "https://jobs.ashbyhq.com/talentsafari/d74cd42f-b3e1-40d8-ba1f-5725ee3660b3",
    ) < 6
    assert discovery.link_score(
        target,
        "Podcast Editor – Audio & Video (B2B Content) Remote",
        "https://jobs.ashbyhq.com/example/094aa2b1-4309-4d8e-9644-b661f218e9f6",
    ) < 6
    assert discovery.link_score(
        target,
        "Digital Marketing Content Producer (Short-Form Video & Social Media) Remote",
        "https://jobs.ashbyhq.com/example/8a418d35-fe65-404d-9a4d-afe7d7c4a191",
    ) < 6


def test_canonical_company_role_key_dedupes_same_role_across_official_urls() -> None:
    first = discovery.canonical_company_role_key(
        "Automattic",
        "Senior Content Marketing Strategist, WordPress VIPRemote",
        "https://job-boards.greenhouse.io/automatticcareers/jobs/7946400",
    )
    second = discovery.canonical_company_role_key(
        "Automattic",
        "Senior Content Marketing Strategist, WordPress VIPMarketingWordPress VIPOpen positionOpen positionApply",
        "https://automattic.com/work-with-us/job/senior-content-marketing-strategist-wordpress-vip/",
    )

    assert first == second


def test_role_keyword_must_not_be_location_only() -> None:
    target = {"target_keywords": ["marketing", "content", "remote"]}
    assert discovery.has_target_role_keyword(target, "Senior Content Marketing Strategist Remote")
    assert not discovery.has_target_role_keyword(target, "Senior Director Procurement Remote US")


def test_generic_apply_links_are_not_job_candidates() -> None:
    assert discovery.is_generic_apply_link("Apply")
    assert discovery.is_generic_apply_link("Apply for this Job")
    assert not discovery.is_generic_apply_link("Senior Content Marketing Strategist, WordPress VIP")


def test_safe_path_token_sanitizes_supply_run_id_for_run_owned_profile() -> None:
    token = discovery.safe_path_token("job-manager/current overseas 2026/07/05")

    assert token == "job-manager-current-overseas-2026-07-05"
    assert "/" not in token


def test_remaining_timeout_ms_returns_zero_when_deadline_is_too_close() -> None:
    assert discovery.remaining_timeout_ms(time.monotonic() + 1, floor_ms=5000) == 0
    assert 0 < discovery.remaining_timeout_ms(time.monotonic() + 10, floor_ms=1000, cap_ms=3000) <= 3000


def test_skip_navigation_anchors_are_not_job_candidates() -> None:
    assert discovery.is_skip_or_navigation_anchor(
        "Skip to job results",
        "https://www.amazon.jobs/en/search?base_query=marketing&loc_query=Japan#job-listings",
    )
    assert discovery.is_skip_or_navigation_anchor("Skip to main content", "https://example.com/jobs#main")
    assert not discovery.is_skip_or_navigation_anchor(
        "Marketing Manager, Marketing & Program, Amazon Business",
        "https://www.amazon.jobs/en/jobs/10439965/marketing-manager-marketing-program-amazon-business",
    )


def test_non_job_pages_do_not_score_as_candidates() -> None:
    assert discovery.NON_JOB_PAGE_RE.search(
        "https://buffer.com/publish?cta=bufferSite-globalNav-tools-publish-1"
    )
    assert discovery.NON_JOB_PAGE_RE.search(
        "https://careers.veeva.com/job-search-results/?search=&remote=false&ts=Marketing&regions=&office_locations="
    )
    assert discovery.NON_JOB_PAGE_RE.search(
        "https://jobs.lever.co/gohighlevel?department=Marketing&team=Events"
    )
    assert discovery.NON_JOB_PAGE_RE.search(
        "https://www.weloglobal.com/wp-content/uploads/sites/11/2026/03/Welocalize_Ireland-Gender-Pay-Gap-2025.pdf"
    )
    assert discovery.JOB_DETAIL_URL_RE.search("https://job-boards.greenhouse.io/automatticcareers/jobs/7946400")
    assert discovery.JOB_DETAIL_URL_RE.search("https://jobs.lever.co/weloglobal/9ab4914a-ad02-41e1-a697-1e51e25c199b")


def test_discovery_writes_candidate_supply_summary_artifact(tmp_path: Path) -> None:
    targets = tmp_path / "targets.json"
    existing = tmp_path / "existing.json"
    outcomes = tmp_path / "candidate-supply" / "official-discovery.jsonl"
    summary = tmp_path / "candidate-supply" / "candidate-supply-summary.json"
    targets.write_text("[]", encoding="utf-8")
    existing.write_text(json.dumps({"keys": []}), encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            str(MODULE_PATH),
            "--targets-json",
            str(targets),
            "--existing-keys-json",
            str(existing),
            "--outcomes-jsonl",
            str(outcomes),
            "--summary-json",
            str(summary),
            "--bucket",
            "overseas_global",
            "--deadline-seconds",
            "1",
            "--min-buffer-after-dedupe",
            "1",
        ],
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(summary.read_text(encoding="utf-8"))
    assert payload["stage"] == "job_manager_candidate_supply_buffer_refresh"
    assert payload["bucket"] == "overseas_global"
    assert payload["sheets_ready_count"] == 0
    assert payload["buffer_ready_count"] == 0
    assert payload["candidate_supply_exhausted_by_bucket"] is True
    assert payload["stop_reason"] == "candidate_supply_exhausted_after_discovery:overseas_global"
