import importlib.util
import subprocess
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PROJECT_ROOT / "scripts/job_applications/sync_job_pipeline_outcomes.py"
SPEC = importlib.util.spec_from_file_location("sync_job_pipeline_outcomes", MODULE_PATH)
assert SPEC and SPEC.loader
sync_job_pipeline_outcomes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync_job_pipeline_outcomes)

ENGLISH_RESUME_FILE = sync_job_pipeline_outcomes.ENGLISH_RESUME_FILE
JAPANESE_APPLICATION_FILES = sync_job_pipeline_outcomes.JAPANESE_APPLICATION_FILES
_application_row_from_pipeline_row = sync_job_pipeline_outcomes._application_row_from_pipeline_row
_existing_application_rows = sync_job_pipeline_outcomes._existing_application_rows
_existing_pipeline_rows = sync_job_pipeline_outcomes._existing_pipeline_rows
_load_application_row_updates = sync_job_pipeline_outcomes._load_application_row_updates
_load_outcome_rows = sync_job_pipeline_outcomes._load_outcome_rows
_resume_files_for_pipeline_row = sync_job_pipeline_outcomes._resume_files_for_pipeline_row


def test_japanese_application_uses_japanese_resume_and_career_history() -> None:
    row = {
        "company": "資生堂",
        "role": "デジタルマーケティングスペシャリスト",
        "job_url": "https://example.co.jp/careers/123",
        "application_channel": "Mynavi",
        "notes": "",
    }

    assert _resume_files_for_pipeline_row(row) == JAPANESE_APPLICATION_FILES
    assert _application_row_from_pipeline_row(row)[11] == JAPANESE_APPLICATION_FILES


def test_english_linkedin_application_keeps_english_resume() -> None:
    row = {
        "company": "Canva",
        "role": "Japan Marketing Specialist",
        "job_url": "https://www.linkedin.com/jobs/view/123/",
        "application_channel": "LinkedIn Easy Apply",
        "notes": "query=Canva Japan marketing",
    }

    assert _resume_files_for_pipeline_row(row) == ENGLISH_RESUME_FILE


def test_explicit_resume_files_note_takes_precedence() -> None:
    row = {
        "company": "LINEヤフー",
        "role": "マーケティング",
        "notes": "resume_files=/tmp/custom-a.pdf | /tmp/custom-b.pdf; query=manual",
    }

    assert _resume_files_for_pipeline_row(row) == "/tmp/custom-a.pdf | /tmp/custom-b.pdf"


def test_romanized_large_japanese_company_uses_japanese_materials() -> None:
    row = {
        "company": "",
        "role": "Digital Marketing Specialist",
        "job_url": "https://www.linkedin.com/jobs/view/456/",
        "application_channel": "LinkedIn Easy Apply",
        "notes": "query=Rakuten marketing; search_url=https://www.linkedin.com/jobs/search/",
    }

    assert _resume_files_for_pipeline_row(row) == JAPANESE_APPLICATION_FILES


def test_existing_pipeline_rows_dedupes_url_only_official_jobs() -> None:
    class ExecuteResult:
        def __init__(self, payload):
            self.payload = payload

        def execute(self):
            return self.payload

    class Values:
        def get(self, **_kwargs):
            return ExecuteResult(
                {
                    "values": [
                        sync_job_pipeline_outcomes.JOB_PIPELINE_HEADERS,
                        [
                            "2026-06-02T12:00:00+09:00",
                            "Example Official",
                            "Marketing Specialist",
                            "https://www.example.com/jobs/123/?utm_source=x#frag",
                            "Official Careers",
                            "Company Official Careers",
                            "",
                            "P1",
                            "retryable",
                            "",
                            "",
                            "",
                            "",
                        ],
                    ]
                }
            )

    class Spreadsheets:
        def values(self):
            return Values()

    class Service:
        def spreadsheets(self):
            return Spreadsheets()

    rows = _existing_pipeline_rows(Service(), "spreadsheet-id")

    assert "official-9bd90e620890c8ab" in rows
    assert rows["official-9bd90e620890c8ab"]["row_number"] == 2


def test_tailor_success_outcome_is_forced_to_pending_external_proof(tmp_path) -> None:
    outcomes = tmp_path / "tailor.jsonl"
    outcomes.write_text(
        (
            '{"pipelineRow":{"discovered_at_jst":"2026-06-03T00:31:10+09:00",'
            '"company":"Tailor","role":"Product Marketing Manager",'
            '"job_url":"https://jobs.ashbyhq.com/tailor/9b9153c8-d762-4841-911f-da9aa4b14f73/application",'
            '"source_platform":"official_careers","application_channel":"official_ashby_apply",'
            '"job_id_or_canonical_key":"official-tailor-product-marketing-manager-9b9153c8-d762-4841-911f-da9aa4b14f73",'
            '"priority_tier":"P1","state":"submitted_confirmed",'
            '"last_attempt_at_jst":"2026-06-03T01:20:00+09:00",'
            '"blocker_reason":"visible_submission_success","next_action":"old success",'
            '"notes":"simulated stale success outcome"}}\n'
        ),
        encoding="utf-8",
    )

    rows = _load_outcome_rows(outcomes)

    assert len(rows) == 1
    assert rows[0]["state"] == "needs_user_review"
    assert rows[0]["blocker_reason"] == sync_job_pipeline_outcomes.NO_RESUBMIT_PENDING_EXTERNAL_PROOF_REASON
    assert "Do not re-submit Tailor" in rows[0]["next_action"]


def test_blocked_captcha_ready_for_user_is_synced_as_pipeline_only(tmp_path) -> None:
    outcomes = tmp_path / "captcha-ready.jsonl"
    outcomes.write_text(
        (
            '{"pipelineRow":{"discovered_at_jst":"2026-06-24T07:30:00+09:00",'
            '"company":"Example AI","role":"Customer Success",'
            '"job_url":"https://herp.careers/v1/example/abc123",'
            '"source_platform":"official_herp","application_channel":"official_site_playwright_cli_real_chrome_adaptive",'
            '"job_id_or_canonical_key":"official-example-herp-cs-abc123",'
            '"priority_tier":"P1","state":"blocked_captcha_ready_for_user",'
            '"last_attempt_at_jst":"2026-06-24T07:35:00+09:00",'
            '"blocker_reason":"blocked_captcha_ready_for_user",'
            '"next_action":"Do not solve CAPTCHA in automation; artifact and skip to the next candidate.",'
            '"notes":"tab_policy=closed_user_only_skip; proof_dir=artifacts/job-playwright-cli-runs/run/example"}}\n'
        ),
        encoding="utf-8",
    )

    rows = _load_outcome_rows(outcomes)

    assert len(rows) == 1
    assert rows[0]["state"] == "blocked_captcha_ready_for_user"
    assert rows[0]["blocker_reason"] == "blocked_captcha_ready_for_user"
    assert "closed_user_only_skip" in rows[0]["notes"]


def test_latest_outcome_for_same_job_key_wins_over_prior_retryable(tmp_path) -> None:
    outcomes = tmp_path / "same-key-latest-wins.jsonl"
    outcomes.write_text(
        (
            '{"pipelineRow":{"discovered_at_jst":"2026-07-02T14:45:00+09:00",'
            '"company":"Scribe","role":"Marketing Automation Specialist",'
            '"job_url":"https://jobs.ashbyhq.com/scribe/8068efa5-68f5-4bc1-b6f9-63d875efb160/application",'
            '"source_platform":"official_ashby","application_channel":"official_site_playwright_cli_real_chrome_adaptive",'
            '"job_id_or_canonical_key":"scribe-marketing-automation-specialist",'
            '"priority_tier":"P1","state":"retryable",'
            '"last_attempt_at_jst":"2026-07-02T14:19:15+09:00",'
            '"blocker_reason":"required_fields_unfilled_before_confirm",'
            '"next_action":"repair","notes":"old retryable"}}\n'
            '{"pipelineRow":{"discovered_at_jst":"2026-07-02T14:55:00+09:00",'
            '"company":"Scribe","role":"Marketing Automation Specialist",'
            '"job_url":"https://jobs.ashbyhq.com/scribe/8068efa5-68f5-4bc1-b6f9-63d875efb160/application",'
            '"source_platform":"official_ashby","application_channel":"official_site_playwright_cli_real_chrome_adaptive",'
            '"job_id_or_canonical_key":"scribe-marketing-automation-specialist",'
            '"priority_tier":"P1","state":"submitted_confirmed",'
            '"last_attempt_at_jst":"2026-07-02T14:22:47+09:00",'
            '"blocker_reason":"visible_submission_success",'
            '"next_action":"Monitor","notes":"new submitted"}}\n'
        ),
        encoding="utf-8",
    )

    rows = _load_outcome_rows(outcomes)

    assert len(rows) == 1
    assert rows[0]["state"] == "submitted_confirmed"
    assert rows[0]["blocker_reason"] == "visible_submission_success"
    assert rows[0]["notes"] == "new submitted"


def test_official_trusted_bridge_success_appends_job_application(tmp_path, monkeypatch) -> None:
    outcomes = tmp_path / "official-bridge-success.jsonl"
    outcomes.write_text(
        (
            '{"pipelineRow":{"discovered_at_jst":"2026-07-02T08:00:00+09:00",'
            '"company":"Bridge Co","role":"Product Marketing Manager",'
            '"job_url":"https://jobs.ashbyhq.com/bridge/abc/application",'
            '"source_platform":"official_careers","application_channel":"official_trusted_bridge",'
            '"job_id_or_canonical_key":"official-bridge-co-pmm-20260702",'
            '"priority_tier":"P1","state":"submitted_confirmed",'
            '"last_attempt_at_jst":"2026-07-02T08:05:00+09:00",'
            '"blocker_reason":"visible_submission_success",'
            '"next_action":"Synced from trusted Chrome Extension official-job route.",'
            '"notes":"run_id=extension-first-sync-test; language=en; resume_file=/Users/nichikatanaka/Downloads/Nichika Tanaka＿Reume.pdf"}}\n'
        ),
        encoding="utf-8",
    )

    calls: list[tuple[str, str, object]] = []

    class ExecuteResult:
        def __init__(self, payload=None):
            self.payload = payload or {}

        def execute(self):
            return self.payload

    class Values:
        def get(self, **kwargs):
            if kwargs["range"] == "job_pipeline!A:M":
                return ExecuteResult({"values": [sync_job_pipeline_outcomes.JOB_PIPELINE_HEADERS]})
            if kwargs["range"] == "job_applications!A:M":
                return ExecuteResult({"values": [sync_job_pipeline_outcomes.JOB_APPLICATIONS_HEADERS]})
            raise AssertionError(kwargs["range"])

        def append(self, **kwargs):
            calls.append(("append", kwargs["range"], kwargs["body"]["values"]))
            return ExecuteResult({})

        def batchUpdate(self, **kwargs):
            calls.append(("batchUpdate", "batch", kwargs["body"]["data"]))
            return ExecuteResult({})

    class Spreadsheets:
        def values(self):
            return Values()

    class Service:
        def spreadsheets(self):
            return Spreadsheets()

    monkeypatch.setattr(sync_job_pipeline_outcomes, "_service", lambda _path: Service())

    result = sync_job_pipeline_outcomes.sync_rows(outcomes_path=outcomes, service_account_json="/unused.json")

    assert result == {
        "rows": 1,
        "updates": 0,
        "appends": 1,
        "application_appends": 1,
        "application_updates": 0,
    }
    application_append = [call for call in calls if call[1] == "job_applications!A:M"]
    assert len(application_append) == 1
    appended_row = application_append[0][2][0]
    assert appended_row[1:6] == [
        "Bridge Co",
        "Product Marketing Manager",
        "https://jobs.ashbyhq.com/bridge/abc/application",
        "official_trusted_bridge",
        "submitted_confirmed",
    ]
    assert appended_row[8].startswith("run_id=extension-first-sync-test")
    assert appended_row[11] == sync_job_pipeline_outcomes.ENGLISH_RESUME_FILE
    assert appended_row[12] == "official_careers"


def test_application_row_updates_load_and_merge_notes(tmp_path) -> None:
    outcomes = tmp_path / "rejections.jsonl"
    outcomes.write_text(
        (
            '{"pipelineRow":{"job_id_or_canonical_key":"gmail-rws-rejection","state":"blocked"}}\n'
            '{"applicationRowUpdate":{"match_job_url":"https://jobs.example.com/apply/123","application_status":"rejected","notes_append":"Rejection email received."}}\n'
        ),
        encoding="utf-8",
    )

    updates = _load_application_row_updates(outcomes)

    assert updates == [
        {
            "match_job_url": "https://jobs.example.com/apply/123",
            "application_status": "rejected",
            "notes_append": "Rejection email received.",
        }
    ]


def test_existing_application_rows_indexes_job_url() -> None:
    class ExecuteResult:
        def __init__(self, payload):
            self.payload = payload

        def execute(self):
            return self.payload

    class Values:
        def get(self, **_kwargs):
            return ExecuteResult(
                {
                    "values": [
                        sync_job_pipeline_outcomes.JOB_APPLICATIONS_HEADERS,
                        [
                            "2026-06-04T10:23:35+09:00",
                            "Example Co",
                            "Marketing Manager",
                            "https://jobs.example.com/apply/123",
                            "Ashby",
                            "submitted_confirmed",
                            "Remote",
                            "Tokyo",
                            "Original note",
                            "nichika2000823@gmail.com",
                            "+81 090-8834-3768",
                            "/tmp/resume.pdf",
                            "Official Careers",
                        ],
                    ]
                }
            )

    class Spreadsheets:
        def values(self):
            return Values()

    class Service:
        def spreadsheets(self):
            return Spreadsheets()

    rows = _existing_application_rows(Service(), "spreadsheet-id")

    assert rows["https://jobs.example.com/apply/123"]["row_number"] == 2
    assert rows["https://jobs.example.com/apply/123"]["values"]["notes"] == "Original note"


def test_tailor_submitted_confirmed_row_can_be_corrected_to_pending_external_proof() -> None:
    row = {
        "company": "Tailor",
        "role": "Product Marketing Manager",
        "job_url": "https://jobs.ashbyhq.com/tailor/9b9153c8-d762-4841-911f-da9aa4b14f73/application",
        "job_id_or_canonical_key": "official-tailor-product-marketing-manager-9b9153c8-d762-4841-911f-da9aa4b14f73",
        "state": "needs_user_review",
    }

    should_skip = (
        True
        and "submitted_confirmed" == sync_job_pipeline_outcomes.SUBMITTED_CONFIRMED_STATE
        and row.get("state") != sync_job_pipeline_outcomes.SUBMITTED_CONFIRMED_STATE
        and not sync_job_pipeline_outcomes._is_tailor_product_marketing_row(row)
    )

    assert not should_skip


def test_runner_prioritizes_large_company_queries_and_requires_both_japanese_files() -> None:
    script = """
      import {
        DEFAULT_QUERY_FAMILIES,
        hasVisibleJapaneseMaterials,
        needsJapaneseMaterials,
        processLinkedInCandidate,
      } from './scripts/job_applications/run_iab_linkedin_easy_apply_batch.mjs';
      import {
        connectIab,
        buildLinkedInSearchUrl,
        guessCompany,
        isExcludedCompanyOrRole,
        isGoodFitCandidate,
        isWeakFitTitle,
        hasSecurityGateSignal,
        isControllableTab,
        linkedInUrlMatchesJobId,
      } from './scripts/job_applications/iab_linkedin_easy_apply_helpers.mjs';
      const checks = [
        new URL(buildLinkedInSearchUrl('Japan marketing', '123')).searchParams.get('location') === 'Worldwide',
        new URL(buildLinkedInSearchUrl('Japan marketing', '123')).searchParams.get('f_WT') === '2',
        new URL(buildLinkedInSearchUrl('Japan marketing', '123')).searchParams.get('f_AL') === 'true',
        DEFAULT_QUERY_FAMILIES[0] === '楽天 マーケティング',
        DEFAULT_QUERY_FAMILIES.indexOf('Amazon Japan marketing') < DEFAULT_QUERY_FAMILIES.indexOf('Japanese remote'),
        needsJapaneseMaterials({ query: 'Rakuten marketing', title: 'Digital Marketing Specialist' }),
        needsJapaneseMaterials({ company: 'Recruit Holdings', title: 'Digital Marketing Specialist' }),
        !needsJapaneseMaterials({ company: 'Connexus Recruit', query: 'SEO marketing remote', title: 'Paid Social Specialist' }),
        !hasVisibleJapaneseMaterials('履歴書＿田仲二千.pdf'),
        hasVisibleJapaneseMaterials('履歴書＿田仲二千.pdf\\n職務経歴書＿田仲二千 .pdf'),
        isWeakFitTitle('Office Director, Community & Operations Coordinator'),
        isWeakFitTitle('Photographer &/or Videographer for California Sports Sunglass Brand'),
        isWeakFitTitle('Psychology Content Reviewer'),
        isWeakFitTitle('Job Search Specialist - Work From Home | Return to Work Opportunity'),
        isWeakFitTitle('Research Quality Specialist Computational Math'),
        !isWeakFitTitle('Digital Marketing Specialist'),
        guessCompany('Digital Marketing Specialist', 'Digital Marketing Specialist\\nRakuten Group\\nTokyo') === 'Rakuten Group',
        isExcludedCompanyOrRole('Digital Marketing Specialist', 'Dentsu Digital', 'marketing'),
        !isGoodFitCandidate('Photographer &/or Videographer for California Sports Sunglass Brand', 'SUPACAZ'),
        isGoodFitCandidate('Digital Marketing Specialist', 'Rakuten Group'),
        linkedInUrlMatchesJobId('https://www.linkedin.com/jobs/search/?currentJobId=123', '123'),
        linkedInUrlMatchesJobId('https://www.linkedin.com/jobs/view/123/', '123'),
        !linkedInUrlMatchesJobId('https://www.linkedin.com/jobs/search/?currentJobId=12345', '123'),
        !linkedInUrlMatchesJobId('https://www.linkedin.com/jobs/view/12345/', '123'),
        hasSecurityGateSignal('dialog "Verification"\\n  textbox "Enter security code"'),
        hasSecurityGateSignal('dialog "Apply"\\n  CAPTCHA required'),
        !hasSecurityGateSignal('dialog "Apply"\\n  button "Submit application"'),
        isControllableTab({ goto() {}, playwright: {}, dom_cua: {} }),
        !isControllableTab({ goto() {}, playwright: {} }),
      ];
      const freshTab = { goto() {}, playwright: {}, dom_cua: {} };
      let selectedCalled = false;
      const connectedTab = await connectIab({
        agent: {},
        browser: {
          async nameSession() {},
          tabs: {
            async selected() {
              selectedCalled = true;
              return { goto() {}, playwright: {}, dom_cua: {}, selected: true };
            },
            async list() { return []; },
            async new() { return { goto() {}, playwright: {}, dom_cua: {}, created: true }; },
          },
        },
        tab: freshTab,
      });
      checks.push(connectedTab === freshTab, !selectedCalled);
      let missingBrowserStopped = false;
      try {
        await connectIab({
          agent: {
            browsers: {
              async get() {
                throw new Error('in-app should not be requested by default');
              },
            },
          },
        });
      } catch (error) {
        missingBrowserStopped = String(error.message || error).includes('browser_lane_required');
      }
      checks.push(missingBrowserStopped);
      const missingProofOutcome = await processLinkedInCandidate({}, {
        key: 'linkedin-123',
        jobId: '123',
        query: 'remote SEO content marketing',
        title: 'SEO Content Marketing Manager',
        company: 'Example Co',
      });
      checks.push(
        missingProofOutcome.state === 'retryable',
        missingProofOutcome.blockerReason === 'linkedin_remote_search_proof_missing',
        missingProofOutcome.pipelineRow.notes.includes('linkedin_remote_search_proof_missing'),
        !missingProofOutcome.pipelineRow.notes.includes('linkedin_remote_filter=f_WT=2'),
      );
      if (checks.some((value) => !value)) {
        process.exit(1);
      }
    """

    subprocess.run(["node", "--input-type=module", "-e", script], cwd=PROJECT_ROOT, check=True)


def test_linkedin_easy_apply_fast_lane_uses_visible_click_and_upload_controls() -> None:
    helper = (PROJECT_ROOT / "scripts/job_applications/iab_linkedin_easy_apply_helpers.mjs").read_text()
    runner = (PROJECT_ROOT / "scripts/job_applications/run_iab_linkedin_easy_apply_batch.mjs").read_text()

    click_body = helper.split("export async function clickEasyApplyWithFallback", 1)[1]
    assert "dom-visible-button" in click_body
    assert "visible_easy_apply_button_not_found" in click_body
    assert 'buttonNames.push("Easy Apply to this job", "LinkedIn Apply", "Easy Apply", "簡単応募", "応募する")' in click_body
    assert "break;" not in click_body.split("const linkedInOwnedApplyButton", 1)[0]

    upload_body = runner.split("async function tryUploadViaFileChooser", 1)[1].split(
        "async function tryUploadFiles",
        1,
    )[0]
    assert "clickVisibleUploadControl" in runner
    assert "input.click" not in upload_body
    assert "getComputedStyle(element)" in runner
    assert "if (!visible) return false" in runner
    assert "allowGenericUploadButton ? await clickVisibleUploadControl(tab) : false" in upload_body
    assert "captcha_or_security_code_required" in runner
    assert "easyApplyProgressSignature" in runner
    assert "currentEasyApplyProgressSignature" in runner
    assert "headings: textOf" in runner
    assert "advanced_no_progress" in runner
    assert "easy_apply_step_no_progress" in runner
    assert runner.index("easy_apply_step_no_progress") < runner.index("easy_apply_step_limit_reached")
