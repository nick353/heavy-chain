from __future__ import annotations

import json
import os
import subprocess
import sqlite3
import tomllib
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


def _read_abs(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def test_daily_automation_prompt_delegates_current_rules_to_skill() -> None:
    prompt = _read(".codex/prompts/daily-ai-account-automation.md")
    readme = _read("README.md")
    automation = _read_abs("/Users/nichikatanaka/.codex/automations/daily-ai-research-publish-run/automation.toml")
    state = _read_abs("/Users/nichikatanaka/.codex/automations/daily-ai-research-publish-run/STATE.md")
    skill = _read_abs("/Users/nichikatanaka/.agents/skills/daily-ai-research-publish-run/SKILL.md")
    contract = _read_abs(
        "/Users/nichikatanaka/.agents/skills/daily-ai-research-publish-run/references/current-run-contract.md"
    )
    automation_prompt = tomllib.loads(automation)["prompt"]

    assert "Chrome Extension backend" in prompt
    assert "/Users/nichikatanaka/.codex/automations/_shared/RUNBOOK.md" in prompt
    assert "/Users/nichikatanaka/.codex/automations/daily-ai-research-publish-run/STATE.md" in prompt
    assert len(automation_prompt) < 2000
    assert "daily-ai-research-publish-run" in automation_prompt
    assert "/Users/nichikatanaka/.agents/skills/daily-ai-research-publish-run/SKILL.md" in automation_prompt
    assert "references/current-run-contract.md" in automation_prompt
    assert "/Users/nichikatanaka/.codex/automations/daily-ai-research-publish-run/STATE.md" in automation
    assert "/Users/nichikatanaka/.codex/automations/_shared/RUNBOOK.md" in automation
    assert "Playwright CLI" in automation_prompt
    assert "node scripts/run_daily_ai_playwright_cli.mjs" in automation_prompt
    assert "playwright_cli_callable_surface_missing" in automation_prompt
    assert "posting_queue.tsv" in automation_prompt
    assert "Do not start Browser Use" in automation_prompt
    assert "X Japanese + LinkedIn English body/media gate" in automation_prompt
    assert "Latest registered artifact" in state
    assert "Playwright CLI" in state
    assert "engagement_platform_feed_study_missing:linkedin` is not completion proof" in state
    assert "ship_now_buffer_count=2/2" in state
    assert "Runway MCP `gpt-image-2`" in state

    for text in (skill, contract):
        assert "Playwright CLI" in text
        assert "scripts/run_daily_ai_playwright_cli.mjs" in text
        assert "playwright_cli_callable_surface_missing" in text
        assert "posting_queue.tsv" in text
        assert "reconciliation_only" in text
        assert "Sheets sync" in text
        assert "cleanup proof" in text
    assert "zero-read LinkedIn feed-study blocker alone must not make `full_flow_completion.ok=true`" in contract
    assert "attach-runway-mcp-result-local" in contract

    current_instruction_text = "\n".join((automation_prompt, skill, contract))
    for deprecated_route_term in ("Profile 2", "Nicky", "Soy", "Chrome Extension"):
        assert deprecated_route_term not in current_instruction_text
    assert "Playwright CLI" in prompt
    assert "Codex in-app Browser Use" in prompt
    assert "Browser Use daemon" in prompt
    assert "Do not launch Browser Use" in prompt
    assert "Playwright CLI route だけ" in prompt
    assert "playwright_cli_callable_surface_missing" in prompt
    assert "local_profile2_lane_unavailable" in prompt
    assert "chrome_extension_profile2_fallback" in prompt
    assert "Chrome Extension + 既存 real Chrome Profile 2 のみ" in prompt
    assert "Playwright + Nicky automation profile、persistent profile、isolated Playwright" in prompt
    assert "期待アカウント、本文 readback、送信ボタン活性化" in prompt
    assert "認証付き操作では Profile 2 Extension lane の意味として扱います" in readme
    assert "期待アカウント、本文 readback、送信ボタン活性化" in readme
    assert "Soy" in prompt
    assert "完全自動承認モード" in prompt
    assert "action-time user confirmation" in prompt
    assert "送信直前の機械確認" in prompt
    assert "自動投稿まで進める" in prompt
    assert "それ自体では外部投稿しない" in prompt
    assert "Do not repost" in prompt
    assert "URL capture pending" in prompt
    assert "投稿対象行に `Do not repost`" in prompt
    assert "engagement_targets" in prompt
    assert "少数 engagement 自動送信を許可済み" in prompt
    assert "X like 5 / comment 2 and LinkedIn like 5 / comment 1" in prompt
    assert "UI fragments" in prompt
    assert "prepare-engagement-candidates-local" in prompt
    assert "reply_to_own_post" in prompt
    assert "codex_review_auth_unavailable" in prompt
    assert "run-engagement-flow-local" in prompt
    assert "API mode 用の別経路" in prompt
    assert "Codex in-app Browser Use が callable でも、投稿・engagement 用の Playwright CLI registered runner と stage artifacts が揃わなければ送信には進まない" in prompt
    assert "Chrome Extension / 既存Chrome Profile 2 fallback" in prompt
    assert "locator-first lite mode" in prompt
    assert "dom_snapshot_timeout" in prompt
    assert "`dom_snapshot_timeout` は単体では hard stop にしない" in prompt
    assert "no_ship_now_candidates" in prompt
    assert "service account 経路" in prompt
    assert "Google Drive connector の 403 / 429" in prompt
    assert "service account 経路の同期成功を上書きする失敗扱いにしない" in prompt
    assert "record-feed-study-local" in prompt
    assert "feed_study_count" in prompt
    assert "external_posts_read" in prompt
    assert "feed_research_receipt" in prompt
    assert "代表的に読んだ投稿 3〜5 件" in prompt
    assert "engagement_candidates_created" in prompt
    assert "write-performance-learning-local" in prompt
    assert "run_mode=daily_normal" in prompt
    assert "run_mode=deep_research_voice" in prompt
    assert "run_mode=performance_review" in prompt
    assert "nicky-voice-fingerprint.md" in prompt
    assert "uv run social-flow run-daily-ai-automation --owner sns-daily-ai-publish-run --sync-sheets" in prompt
    assert "uv run social-flow run-daily-ai-automation --owner sns-daily-ai-publish-run --sync-sheets" in readme
    assert "未設定なら `DRAFT_API_KEY` は既存の `OPENAI_API_KEY`、`DRAFT_MODEL` は `OPENAI_MODEL` を使います。" in readme
    assert "DRAFT_MODEL` は下書き生成用の別系統" in readme
    assert "AI修復ループ" in prompt
    assert "同じ registered entrypoint shape で再実行" in prompt
    assert "実行ログ、local run summary、automation memory、live UI gate" in prompt
    assert "AI修復ループ" in readme
    assert "同じ登録済み entrypoint shape で再実行" in readme


def test_job_application_manager_requires_japan_and_overseas_20_for_full_success() -> None:
    automation = _read_abs("/Users/nichikatanaka/.codex/automations/job-application-manager/automation.toml")
    manager_state = _read_abs("/Users/nichikatanaka/.codex/automations/job-application-manager/STATE.md")
    manager_memory = _read_abs("/Users/nichikatanaka/.codex/automations/job-application-manager/memory.md")
    project_prompt = _read(".codex/prompts/job-application-automation.md")
    automation_prompt = tomllib.loads(automation)["prompt"]

    assert "20 Japan-targeted and 20 overseas/global" in automation_prompt
    assert "same-run fresh `submitted_confirmed` proof" in automation_prompt or "submitted_confirmed" in automation_prompt
    assert "Current target: same-run fresh `submitted_confirmed` proof for 20 Japan-targeted and 20 overseas/global applications" in project_prompt
    assert "registered launcher" in manager_state
    assert "run-owned evidence root" in manager_memory
    assert "cleanup proof" in manager_memory
    assert "same-run source-of-truth readback" in automation_prompt
    assert "current packet manifest validation" in automation_prompt
    assert "completion audit pass" in automation_prompt
    assert "exact blocker" in automation_prompt

    for retry_contract in (
        "retry the exact export once",
        "If that retry succeeds",
        "produced existing-keys and duplicate-report artifacts",
        "If both ordinary and network-capable export fail",
        "source_of_truth_export_blocked_oauth_dns_after_retry",
    ):
        assert retry_contract in automation_prompt

    for project_retry_contract in (
        "1回だけ network-capable local Codex shell",
        "成功した existing keys / duplicate report",
        "両方失敗した場合だけ",
        "source_of_truth_export_blocked_oauth_dns_after_retry",
    ):
        assert project_retry_contract in project_prompt


def test_job_application_manager_gmail_followup_uses_full_sweep_before_keyword_search() -> None:
    automation = _read_abs("/Users/nichikatanaka/.codex/automations/job-application-manager/automation.toml")
    manager_state = _read_abs("/Users/nichikatanaka/.codex/automations/job-application-manager/STATE.md")
    manager_memory = _read_abs("/Users/nichikatanaka/.codex/automations/job-application-manager/memory.md")
    project_state = _read("STATE.md")
    project_prompt = _read(".codex/prompts/job-application-automation.md")
    automation_prompt = tomllib.loads(automation)["prompt"]

    for text in (automation_prompt, manager_state, manager_memory, project_prompt):
        assert "full sweep" in text or "全件" in text
        assert "14d" in text
        assert "30d" in text
        assert "100" in text
        assert (
            "Keyword search is only supplemental" in text
            or "Keyword search is only a supplemental" in text
            or "キーワード検索は full sweep の補助" in text
        )
    for text in (automation_prompt, manager_state, project_prompt):
        assert "reply_needed" in text
        assert "interview_or_schedule" in text
        assert "opportunity_signal_handoff" in text
        assert "earning_signal" in text

    assert "Gmail follow-up sweep 2026-07-03" in automation_prompt
    assert "must not rely on keyword search as the primary method" in automation_prompt
    assert "latest 100 messages" in automation_prompt
    assert "Carla Manantan/Specialized Group-style interview invites are not missed" in automation_prompt
    assert "Do not include ordinary payment/billing/checkout notices" in automation_prompt
    assert "重要アクション:" in automation_prompt
    assert "お金になりそうな候補:" in automation_prompt
    assert "返信・対応候補:" in automation_prompt
    assert "Japanese ・ bullets" in automation_prompt
    assert "one item per line" in automation_prompt
    assert "証跡:" in automation_prompt
    assert "Do not report Gmail no-action success unless the full sweep artifact exists" in automation_prompt
    assert "Gmail full inbox sweep rule 2026-07-03" in project_prompt
    assert "最新100件以上分類" in project_prompt
    assert "支払い・決済通知は原則本文から省き" in project_prompt
    assert "日本語の中黒 `・`" in project_prompt
    assert "人名・採用担当者名・招待メール・返信済みスレッド" in project_prompt
    assert "full sweep なしで「該当なし」と結論しない" in project_prompt
    assert "scheduled_followup_gmail_full_sweep_required" in project_state
    assert "Suppress ordinary payment/billing/checkout notices" in project_state
    assert "visual_format" in project_state
    assert "followup_keyword_search_no_longer_primary" in manager_state
    assert "after the 100-message sweep" in manager_state
    assert "visual_format" in manager_state
    assert "No-action Gmail reporting requires a full-sweep artifact" in manager_memory
    assert "Visual preference" in manager_memory
    assert "Preferred user-facing format after the run" in manager_memory


def test_job_application_manager_uses_ashby_chrome_plugin_primary_and_preserves_user_action_tabs() -> None:
    manager_state = _read_abs("/Users/nichikatanaka/.codex/automations/job-application-manager/STATE.md")
    manager_memory = _read_abs("/Users/nichikatanaka/.codex/automations/job-application-manager/memory.md")
    runbook = _read_abs("/Users/nichikatanaka/.codex/automations/_shared/RUNBOOK.md")
    automation = _read_abs("/Users/nichikatanaka/.codex/automations/job-application-manager/automation.toml")
    automation_prompt = tomllib.loads(automation)["prompt"]
    project_prompt = _read(".codex/prompts/job-application-automation.md")
    submit_skill = _read_abs("/Users/nichikatanaka/.codex/skills/job-application-daily-submit-queue/SKILL.md")
    bridge_client = _read("scripts/browser_use/chrome_extension_trusted_bridge_client.mjs")

    durable_text = "\n".join((manager_state, manager_memory, project_prompt, submit_skill))
    assert "Chrome Plugin public ATS primary official submit override 2026-07-05T16:30+09:00" in project_prompt
    assert "Chrome Plugin public ATS primary 2026-07-05" in automation_prompt
    assert "Chrome Plugin Public ATS Primary 2026-07-05T21:20+09:00" in submit_skill
    assert "Keep the browser window/session open and reused during the run" in automation_prompt
    assert "Ashby public forms use Chrome Plugin/Profile 2 first" in automation_prompt
    assert "public official ATS forms use Chrome Plugin/Profile 2 first" in automation_prompt
    assert "Playwright is discovery/diagnostic only and is not accepted as live submit proof" in automation_prompt
    assert "Chrome Plugin/Profile 2 primary for public official ATS" in automation_prompt
    assert "/official-job" in durable_text
    assert "runChromeExtensionTrustedBridgeCommand(...)" in project_prompt
    assert "scripts/browser_use/chrome_extension_trusted_bridge_client.mjs official-job" in project_prompt
    assert "Chrome Plugin/Profile 2 route" in project_prompt
    assert "input: JSON.stringify(payload)" in project_prompt
    assert "trusted_bridge_payload_not_passed_via_stdin" in project_prompt
    assert "payload JSON through the wrapper `input`/stdin path" in submit_skill
    assert "validate_job_manager_extension_first.py" in project_prompt
    assert "validate_job_manager_extension_first.py" in submit_skill
    assert "registered_store_matches_automation_toml" in project_prompt
    assert "registered_store_matches_automation_toml" in submit_skill
    assert "automation_reasoning_effort_high" in submit_skill
    assert "stale packet" in project_prompt
    assert "WGSN Japanese Language Specialist を先頭" in project_prompt
    assert "skip Welo Global prior-application candidates and start with WGSN" in submit_skill
    assert "validate_job_manager_current_packet_manifest.py" in project_prompt
    assert "current-overseas-packet-manifest.json" in project_prompt
    assert "validate_job_manager_current_packet_manifest.py" in submit_skill
    assert "validate_job_manager_completion_audit.py" in project_prompt
    assert "validate_job_manager_completion_audit.py" in submit_skill
    assert "validate_next_overseas_extension_resume_packet.py" in project_prompt
    assert "validate_next_overseas_extension_resume_packet.py" in submit_skill
    assert "candidate_buffer_covers_overseas_remaining" in project_prompt
    assert "candidate_buffer_covers_overseas_remaining" in submit_skill
    assert "candidate_buffer_covers_overseas_remaining" in automation_prompt
    assert "overseas_resume_packet_buffer_required" in automation_prompt
    assert "current-overseas-packet-manifest.json" in automation_prompt
    assert "validate_job_manager_readiness_audit.py" in project_prompt
    assert "validate_job_manager_readiness_audit.py" in submit_skill
    assert "job-manager-extension-readiness-audit-validation.json" in project_prompt
    assert "job-manager-extension-readiness-audit-validation.json" in submit_skill
    assert "job-manager-extension-readiness-audit-current.json" in project_prompt
    assert "job-manager-extension-readiness-audit-current.json" in submit_skill
    assert "job-manager-extension-readiness-audit-current-validation.json" in project_prompt
    assert "job-manager-extension-readiness-audit-current-validation.json" in submit_skill
    assert "Readiness is not completion" in submit_skill
    assert "nohup caffeinate -disu" in project_prompt
    assert "nohup caffeinate -disu" in submit_skill
    assert "caffeinate_option_unsupported" in project_prompt
    assert "Bridge readiness probe 2026-07-09" in project_prompt
    assert "chrome_extension_trusted_bridge_client.mjs probe" in project_prompt
    assert "trusted_runner_bridge_unavailable_before_probe_artifact" in project_prompt
    assert "Chrome/Profile 2 Bridge Readiness Gate" in runbook
    assert "fresh_visible_codex_chrome_runtime_required" in runbook
    assert "trusted_runner_bridge_unavailable_before_probe_artifact" in submit_skill
    assert "PreventSystemSleep=1" in project_prompt
    assert "lane_separation_preflight_failed_before_submit" in project_prompt
    assert "extension_first_preflight_failed_before_submit" in submit_skill
    assert "split_target_20_20_proven" in project_prompt
    assert "extension_official_job_receipt_or_exact_blocker" in project_prompt
    assert "no_unresolved_user_action_tabs_for_full_success" in project_prompt
    assert "Tab preservation narrowing 2026-07-02T13:10+09:00" in project_prompt
    assert "Tab Preservation Narrowing 2026-07-02T13:10+09:00" in submit_skill
    assert "runner_tab_policy_repaired_auth_only" in manager_state
    assert "user-only gates are not user-action tabs by default" in automation_prompt
    assert "close the tab when safe, skip-forward to the next candidate/platform" in automation_prompt
    assert "At the end, leave visible only authentication/security tabs for the user" not in automation_prompt
    assert "assessment/test/AI interview, tax/bank/contract, unknown personal facts, and final human confirmation screens must be left open" not in automation_prompt
    assert "Public ATS Chrome Plugin primary 2026-07-05" in project_prompt
    assert "Lever locator autofill / Welo prior-application lesson 2026-07-02" in project_prompt
    assert "runOfficialLeverApplicationChromeExtension" in project_prompt
    assert "公開公式ATSは Chrome Plugin/Profile 2 を第一経路" in project_prompt
    assert "Playwright は候補発見/診断/非認証preflightのみに限定し、live submit fallback として扱わない" in project_prompt
    assert "candidate-level blocker として artifact/outcomes に残し" in project_prompt
    assert "prior_application_already_received" in project_prompt
    assert "Your application was already submitted" in project_prompt
    assert "WGSN Japanese Language Specialist" in project_prompt
    assert "autofillLeverKnownFactsWithLocators" in submit_skill
    assert "candidate-level blocker として artifact/outcomes に残し" in project_prompt
    assert "trusted Chrome runtime" in durable_text
    assert "Profile 2 Extension" in durable_text
    assert "公開公式ATSでは Chrome Plugin / real Chrome Profile 2 を production lane にする" in project_prompt
    assert "ユーザー操作タブとして残さない" in project_prompt
    assert "該当タブを安全に閉じて次候補へ skip-forward" in project_prompt
    assert "CAPTCHA/human verification" in durable_text
    assert "closed_retryable_non_auth" in _read("scripts/browser_use/chrome_extension_trusted_bridge_server.mjs")
    assert "adapter gap" in project_prompt
    assert "trusted_chrome_runtime_unavailable" in project_prompt

    assert 'mode === "probe"' in bridge_client
    assert 'mode === "official-job" || mode === "job"' in bridge_client
    assert "official_job_trusted_bridge" in bridge_client
    assert "trusted_runner_bridge_unavailable_before_official_job_artifact" in bridge_client
    assert "trusted_runner_bridge_unavailable_before_probe_artifact" in bridge_client
    assert "official_trusted_bridge" in bridge_client


def test_job_application_manager_extension_first_preflight_script_passes(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            "python3",
            "scripts/job_applications/validate_job_manager_extension_first.py",
            "--artifact",
            str(tmp_path / "extension-first-preflight.json"),
        ],
        cwd=REPO_ROOT,
        check=False,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads((tmp_path / "extension-first-preflight.json").read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["stage"] == "job_manager_lane_separation_preflight"
    assert not payload["failed_checks"]
    assert any(check["name"] == "automation_reasoning_effort_high" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "registered_store_matches_automation_toml" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "command_wrapper_required" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "official_bridge_payload_stdin_required" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "ashby_chrome_plugin_profile2_primary" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "public_official_ats_chrome_plugin_profile2_primary" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "ashby_chrome_plugin_uses_profile2_and_fresh_tabs" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "ashby_chrome_plugin_pre_submit_review_gate_required" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "official_bridge_user_action_manifest" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "lever_public_ats_chrome_plugin_primary_closes_user_only_stops" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "official_bridge_success_sync_contract" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "completion_audit_gate_required" and check["ok"] for check in payload["checks"])
    assert any(
        check["name"] == "completion_audit_rejects_unresolved_user_action_full_success" and check["ok"]
        for check in payload["checks"]
    )
    assert any(check["name"] == "completion_audit_gmail_full_sweep_required" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "overseas_resume_packet_validation_required" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "readiness_audit_validation_required" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "caffeinate_disu_compatibility_required" and check["ok"] for check in payload["checks"])
    assert any(check["name"] == "bridge_readiness_probe_required" and check["ok"] for check in payload["checks"])


def test_chrome_core_docs_match_publish_safety_rules() -> None:
    doc = _read("docs/chrome-core-flow-automation.md")

    assert "Chrome Extension backend" in doc
    assert "ユーザーが普通に「Browser Useで」「Playwrightで」と言った場合" in doc
    assert "Codex in-app Browser Use" in doc
    assert "Codex in-app Browser Use 単体は投稿 / engagement lane として使わない" in doc
    assert "social-flow resolve-browser-lane --purpose <publish|engagement> --json" in doc
    assert "local_profile2_lane_unavailable" in doc
    assert "chrome_extension_profile2_fallback" in doc
    assert "Chrome Extension + 既存 real Chrome Profile 2 のみを production lane" in doc
    assert "chrome_extension_profile2_unavailable" in doc
    assert "Soy" in doc
    assert "自動投稿" in doc
    assert "実送信は期待アカウント、本文反映、Post ボタン活性化、投稿 URL / completion state、URL/DOM/screenshot/attempt JSON、cleanup proof を確認してから行う" in doc
    assert "送信直前の機械確認" in doc
    assert "人手承認ではなく automation" in doc
    assert "Do not repost" in doc
    assert "URL capture pending" in doc
    assert "engagement_review" in doc
    assert "大量リポスト、同文返信、読んでいない投稿への反応はしない" in doc
    assert "自動送信" in doc
    assert "prepare-engagement-candidates-local" in doc
    assert "codex_review_auth_unavailable" in doc
    assert "run-engagement-flow-local" in doc
    assert "Chrome Extension / Profile 2 で対象ページを制御できる場合だけ" in doc
    assert "Codex in-app Browser Use 単体、isolated `ms-playwright`、`open-automation-chrome` の隔離ウィンドウへ切り替えない" in doc
    assert "locator-first lite mode" in doc
    assert "dom_snapshot_timeout" in doc
    assert "no_ship_now_candidates" in doc
    assert "service account 経路" in doc
    assert "Google Drive connector の 403 / 429" in doc
    assert "Google Drive connector は補助確認" in doc
    assert "record-feed-study-local" in doc
    assert "feed_study_count" in doc
    assert "external_posts_read" in doc
    assert "feed_research_receipt" in doc
    assert "実読件数" in doc
    assert "engagement_candidates_created" in doc
    assert "write-performance-learning-local" in doc
    assert "run_mode=daily_normal" in doc
    assert "run_mode=deep_research_voice" in doc
    assert "run_mode=performance_review" in doc
    assert "nicky-voice-fingerprint.md" in doc


def test_daily_research_mix_is_not_official_rss_only() -> None:
    prompt = _read(".codex/prompts/daily-ai-account-automation.md")
    core_doc = _read("docs/chrome-core-flow-automation.md")
    readme = _read("README.md")
    playbook = _read("docs/ai-discovery-playbook.md")
    watchlist = _read("docs/x-research-watchlist.md")

    for text in (prompt, core_doc, readme):
        assert "daily_discovery_mix" in text
        assert "公式発表の要約" in text
        assert "Web / ニュース横断" in text or "Web/ニュース横断" in text
        assert "X / LinkedIn おすすめフィード" in text or "X/LinkedInおすすめフィード" in text
        assert "AI実務家" in text or "インフルエンサー" in text
        assert "OpenAI / Codex" in text
        assert "非OpenAI" in text
        assert "discovered_items" in text

    assert "AI Discovery Playbook" in playbook
    assert "Source chain" in playbook
    assert "Do not copy their framing" in playbook
    assert "100+ recommended-feed posts" in playbook
    assert "not base the voice study on search results" in playbook
    assert "at most one publish slot" in playbook
    assert "元ソース" in watchlist
    assert "投稿型" in watchlist
    assert "伸びている理由" in watchlist


def test_deep_research_voice_requires_100_recommended_feed_posts() -> None:
    prompt = _read(".codex/prompts/daily-ai-account-automation.md")
    core_doc = _read("docs/chrome-core-flow-automation.md")
    readme = _read("README.md")

    for text in (prompt, core_doc, readme):
        assert "deep_research_voice" in text
        assert "100 件以上" in text
        assert "検索結果ではなく" in text
        assert "おすすめフィード" in text


def test_recommended_feed_voice_artifact_counts_match_raw_json() -> None:
    analysis = _read("artifacts/feed-study/2026-05-26-recommended-feed-voice-100-analysis.md")
    raw = json.loads(_read("artifacts/feed-study/2026-05-26T042730Z-recommended-feed-voice-100.json"))

    assert raw["target_count"] == 100
    assert raw["total_collected"] == 115
    assert raw["platform_counts"] == {"x": 115, "linkedin": 0}
    assert raw["method"] == "local Chrome 二千 CDP, recommended/home feeds only, no search URLs or query pages"
    assert len(raw["read_posts"]) == raw["total_collected"]
    assert raw["feed_research_receipt"].startswith(
        "target=100+ recommended-feed posts; actual=115; external=115; x=115; linkedin=0"
    )
    assert f"Total collected: {raw['total_collected']} recommended-feed posts" in analysis
    assert f"AI-related flag in raw artifact: {raw['ai_related_count']}" in analysis


def test_daily_engagement_comments_are_sent_in_browser_use_lane_when_verified() -> None:
    prompt = _read(".codex/prompts/daily-ai-account-automation.md")
    doc = _read("docs/chrome-core-flow-automation.md")
    readme = _read("README.md")

    for text in (prompt, doc, readme):
        assert "comment_candidate" in text
        assert "候補作成だけで" in text
        assert "本番 run で送信" in text
        assert "reply composer" in text
        assert "comment editor" in text
        assert "本文反映" in text
        assert "送信ボタン enabled" in text
        assert "send-engagement-candidates-local" in text
        assert "Playwright CLI" in text
        assert ("recording" in text) or ("stage artifacts" in text)
        assert ("Record & Replay / Playwright QA" in text) or ("Record & Replay / Playwright no-post preflight" in text) or ("stage artifacts" in text)
        assert ("X like 5 / comment 2" in text) or ("X いいね5件・コメント2件" in text)

    assert "target post の author/body/evidence" in prompt
    assert "公開コメントだからという理由だけで" in prompt
    assert "composer が閉じただけ" in prompt
    assert "comment_not_reflected" in prompt
    assert "送信済みに数えない" in doc


def test_daily_ai_browser_use_linkedin_publish_runner_is_documented() -> None:
    prompt = _read(".codex/prompts/daily-ai-account-automation.md")
    doc = _read("docs/chrome-core-flow-automation.md")
    runner = _read("/Users/nichikatanaka/Documents/Codex/2026-06-03/playwight-mcp-playwirhgt-cli/lib/daily-ai-direct-cli.mjs")

    assert "Playwright CLI registered runner only" in prompt
    assert "Record & Replay / Playwright no-post preflight" in prompt
    assert "登録済み Daily AI / X / LinkedIn の投稿・engagement は Playwright CLI" in doc
    assert "Playwright CLI registered runner" in prompt
    assert "Playwright CLI" in doc
    for text in (prompt, doc):
        assert "legacy" in text or "historical" in text
        assert "LinkedInリンクカード型" in text
        assert "LinkedIn正方形1枚画像型" in text
        assert "LinkedInカルーセル型" in text
        assert "completion" in text

    assert "publishLinkedInCandidateDirect" in runner
    assert "uploadLinkedInMediaViaPhotoRoute" in runner
    assert "resolveLinkedInMediaPaths" in runner
    assert "resolveLinkedInPostComposerRoot" in runner
    assert "resolveLinkedInMediaUploadRoot" in runner
    assert "isLinkedInMediaUploadRoot" in runner
    assert "requirePostButtonDisabledAfterClear = true" in runner
    assert "requirePostButtonDisabledAfterClear: false" in runner
    assert "media_upload_permission_blocked: linkedin_media_upload_root_missing" in runner
    assert "const uploadScope = uploadRoot || page" not in runner
    assert "LINKEDIN_POST_EDITOR_SELECTOR" in runner
    assert "isLinkedInPostComposerRoot" in runner
    assert "linkedin_post_composer_root_missing" in runner
    assert "Write a message" in runner
    assert ':not([aria-label*="Write a message"])' in runner
    assert "clickLinkedInControl" in runner
    assert "dom_focus_click" in runner
    assert "switchLinkedInLinkCardToSquareImageAfterReflectionFailureLocal" in runner
    assert "receipt.fallback_surface = 'LinkedIn正方形1枚画像型'" in runner
    assert "link_card_not_reflected" in runner
    assert "body_not_reflected" in runner
    assert "disabled_submit" in runner
    assert "capture_failed" in runner


def test_legacy_daily_ai_runner_is_historical_diagnostic_only() -> None:
    runner = _read("scripts/run_daily_ai_playwright_cli.mjs")
    skip_policy = _read("scripts/daily_ai_core_flow_skip_policy.mjs")

    assert "function latestPublishPrepCandidateIds()" in runner
    assert "function linkedinNoApiFallbackTargets()" in runner
    assert "function isLinkedInComposerControlFailure(value)" in runner
    assert "linkedin_post_composer_root_missing" in runner
    assert "locator\\.click" in runner
    assert "element is outside of viewport" in runner
    assert "Write a message" in runner
    assert "linkedin_composer_control_failure" in runner
    assert "runLinkedInNoApiTextFallbackIfNeeded" in runner
    assert "publish-linkedin-text-url-fallback-local" in runner
    assert "DAILY_AI_CLI_ALLOW_NO_API_LINKEDIN_TEXT_FALLBACK" in runner
    assert "const allowNoApiLinkedInTextFallback = process.env.DAILY_AI_CLI_ALLOW_NO_API_LINKEDIN_TEXT_FALLBACK === 'true';" in runner
    assert "image_generation_unavailable|billing_hard_limit_reached" in runner
    assert "platform_feed_study_missing_is_not_completion_proof" in runner
    assert "runway_mcp_repair" in runner
    assert "DAILY_AI_RUNWAY_MCP_RESULT" in runner
    assert "attach-runway-mcp-result-local" in runner
    assert "runway_mcp_connector_unavailable" in runner
    assert "feed_study_platform_missing:" in runner
    assert "entry.name === 'publish_prep'" in runner
    assert "step.stdout_json || parseLastStdoutJson(step.stdout_tail)" in runner
    assert "payload.candidate_ids" in runner
    assert "function publishTargetIdsForDirectSender()" in runner
    assert "return candidateIds.length > 0 ? [candidateIds[0]] : [];" in runner
    assert "const publishOnlyIds = publishTargetIdsForDirectSender();" in runner
    assert "DAILY_AI_CLI_PUBLISH_ONLY_IDS: JSON.stringify(publishOnlyIds)" in runner
    assert "const onlyIds = JSON.parse(process.env.DAILY_AI_CLI_PUBLISH_ONLY_IDS || '[]');" in runner
    assert "onlyIds," in runner
    assert "async function checkShipNowBufferStep" in runner
    assert "return step.stdout_json || {};" in runner
    assert "DAILY_AI_CLI_SKIP_CORE_FLOW_IF_BUFFER_READY !== 'false'" in runner
    assert "const shouldSkipCoreFlowIfBufferReady = skipCoreFlowIfBufferReady && !testStubSteps;" in runner
    assert "shouldSkipCoreFlowForReadyBuffer" in runner
    assert "recordSkippedStep('core_flow', summary.core_flow)" in runner
    assert "initial_buffer_check" in runner
    assert "usablePublishCandidateCount >= target" in skip_policy
    assert "reason: 'ship_now_buffer_ready'" in runner
    assert runner.index("initial_buffer_check") < runner.index("await runStep('publish_prep'")
    assert "buffer_replenish: null" in runner
    assert "summary.buffer_replenish = { skipped: true, reason: 'dry_run' };" in runner
    assert "summary.buffer_replenish = { skipped: true, reason: 'disabled_by_env' };" in runner
    assert "ship_now_buffer_ready_before_replenish" in runner
    assert "replenish-ship-now-buffer-local" in runner
    assert "--repair-generated-media" in runner
    assert "const replenishBufferTimeoutMs = Number(process.env.DAILY_AI_CLI_REPLENISH_BUFFER_TIMEOUT_MS || 900_000);" in runner
    assert "timeoutMs: replenishBufferTimeoutMs" in runner
    assert "DAILY_AI_RUNWAY_MCP_TIMEOUT_SECONDS: process.env.DAILY_AI_RUNWAY_MCP_TIMEOUT_SECONDS || '240'" in runner
    assert "const replenishPayloads = [];" in runner
    assert "const replenishErrors = [];" in runner
    assert "DAILY_AI_CLI_REPLENISH_BUFFER_MAX_ATTEMPTS || 3" in runner
    assert "for (let attemptNo = 1; attemptNo <= maxReplenishAttempts; attemptNo += 1)" in runner
    assert "`replenish_ship_now_buffer_${attemptNo}`" in runner
    assert "const lastReplenishPayload = replenishPayloads[replenishPayloads.length - 1] || {};" in runner
    assert "String(lastReplenishPayload.stop_reason || '')" in runner
    assert "...replenishErrors" in runner
    assert runner.index("replenish_ship_now_buffer") < runner.index("replenish-ship-now-buffer-local")
    assert "failures.push('buffer_replenish_missing')" in runner
    assert "buffer_replenish_skipped:" in runner
    assert "failures.push('dry_run_not_live_completion')" in runner
    assert "ship_now_buffer_gate_enforced: bufferGateEnforced" in runner
    assert "failures.push(bufferFailure)" in runner
    assert "buffer_replenish_stop_reason:${bufferReplenishStopReason}" in runner
    assert "buffer_replenish_completed" in runner


def test_daily_ai_feed_study_supplemental_own_post_does_not_cover_external_linkedin_gap() -> None:
    runner = _read("scripts/run_daily_ai_playwright_cli.mjs")
    helper_block = runner[
        runner.index("function isVerifiedEngagementReceipt")
        : runner.index("function fullFlowCompletionGate")
    ]
    node_script = f"""
let summary = {{}};
const requiredEngagementPlatforms = ["x", "linkedin"];
const engagementTargets = {{
  x: {{ like_candidate: 5, comment_candidate: 2 }},
  linkedin: {{ like_candidate: 5, comment_candidate: 1 }},
}};

function missingEngagementTargets(counts) {{
  const missing = [];
  for (const [platform, target] of Object.entries(engagementTargets)) {{
    for (const [action, expected] of Object.entries(target)) {{
      const actual = Number(counts?.[platform]?.[action] || 0);
      if (actual < Number(expected || 0)) {{
        missing.push(`${{platform}}:${{action}}:${{actual}}/${{expected}}`);
      }}
    }}
  }}
  return missing;
}}

function missingRequiredEngagementPlatforms(platforms) {{
  return requiredEngagementPlatforms.filter((platform) => !platforms.has(platform));
}}

{helper_block}
const publishedUrl = "https://www.linkedin.com/feed/update/urn:li:activity:999/";

function linkedinPublishReceipt(url = publishedUrl) {{
  return {{ platform: "linkedin", post_url: url }};
}}

function supplementalReceipt(overrides = {{}}) {{
  return {{
    source: "supplemental_own_post_engagement",
    platform: "linkedin",
    action: "like_candidate",
    completion: "like_reflected",
    url: publishedUrl,
    target_url: publishedUrl,
    like_proof: {{
      source: "reaction_state_after_click",
      before_state: "Reaction button state: no reaction",
      after_state: "Reaction button state: liked",
      state_changed: true,
      reflected: true,
      target_url: publishedUrl,
    }},
    ...overrides,
  }};
}}

function externalReceipt(platform, action, index) {{
  if (platform === "x" && action === "like_candidate") {{
    return {{
      platform,
      action,
      completion: "like_reflected",
      url: `https://x.com/example/status/${{index}}`,
      target_url: `https://x.com/example/status/${{index}}`,
    }};
  }}
  if (platform === "x" && action === "comment_candidate") {{
    return {{
      platform,
      action,
      completion: "comment_post_url_captured",
      url: `https://x.com/nichika2000823/status/${{index}}`,
      target_url: `https://x.com/example/status/${{index}}`,
    }};
  }}
  if (platform === "linkedin" && action === "like_candidate") {{
    return supplementalReceipt({{
      source: "",
      action,
      url: `https://www.linkedin.com/feed/update/urn:li:activity:${{index}}/`,
      target_url: `https://www.linkedin.com/feed/update/urn:li:activity:${{index}}/`,
      likeProof: {{
        source: "linkedin_reaction_button_state_after_click",
        reflected: true,
        stateChanged: true,
        targetUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${{index}}/`,
      }},
    }});
  }}
  return {{
    platform,
    action,
    completion: "comment_reflected",
    url: `https://www.linkedin.com/feed/update/urn:li:activity:${{index}}/`,
    target_url: `https://www.linkedin.com/feed/update/urn:li:activity:${{index}}/`,
    commentProof: {{
      source: "body_after_submit",
      editorCleared: true,
      postedCommentVisible: true,
      visibleBeforeSubmit: false,
      targetUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${{index}}/`,
    }},
  }};
}}

function fullTargetReceipts() {{
  return [
    ...Array.from({{ length: 5 }}, (_, index) => externalReceipt("x", "like_candidate", 100 + index)),
    ...Array.from({{ length: 2 }}, (_, index) => externalReceipt("x", "comment_candidate", 200 + index)),
    ...Array.from({{ length: 5 }}, (_, index) => externalReceipt("linkedin", "like_candidate", 300 + index)),
    externalReceipt("linkedin", "comment_candidate", 400),
  ];
}}

function covered(stopReason, directReceipts, supplementalPayloads, scope = {{}}) {{
  summary = {{
    direct_publish: {{ receipts: directReceipts }},
    direct_engagement: {{
      receipts: supplementalPayloads.flatMap((payload) => payload.receipts || []),
      supplemental_own_post_engagement: supplementalPayloads,
    }},
    engagement_candidate_scope: {{
      missing_target_actions: scope.missing_target_actions || [],
      missing_required_platforms: scope.missing_required_platforms || [],
    }},
  }};
  return isFeedStudyStopReasonCoveredBySupplementalEngagement(stopReason);
}}

const cases = [
  {{
    name: "same-run supplemental LinkedIn own-post engagement does not cover",
    expected: false,
    actual: covered("engagement_platform_feed_study_missing:linkedin", [linkedinPublishReceipt()], [
      {{ receipts: [supplementalReceipt()] }},
    ]),
  }},
  {{
    name: "x-only supplemental engagement does not cover LinkedIn feed-study",
    expected: false,
    actual: covered("engagement_platform_feed_study_missing:linkedin", [linkedinPublishReceipt()], [
      {{ receipts: [supplementalReceipt({{ platform: "x", url: "https://x.com/nichika2000823/status/1" }})] }},
    ]),
  }},
  {{
    name: "external LinkedIn URL does not cover the just-published URL",
    expected: false,
    actual: covered("engagement_platform_feed_study_missing:linkedin", [linkedinPublishReceipt()], [
      {{ receipts: [supplementalReceipt({{ url: "https://www.linkedin.com/feed/update/urn:li:activity:111/", target_url: "https://www.linkedin.com/feed/update/urn:li:activity:111/" }})] }},
    ]),
  }},
  {{
    name: "old LinkedIn URL does not cover the just-published URL",
    expected: false,
    actual: covered("engagement_platform_feed_study_missing:linkedin", [linkedinPublishReceipt()], [
      {{ receipts: [supplementalReceipt({{ url: "https://www.linkedin.com/feed/update/urn:li:activity:123/", target_url: "https://www.linkedin.com/feed/update/urn:li:activity:123/" }})] }},
    ]),
  }},
  {{
    name: "non-linkedin URL does not cover",
    expected: false,
    actual: covered("engagement_platform_feed_study_missing:linkedin", [linkedinPublishReceipt()], [
      {{ receipts: [supplementalReceipt({{ url: "https://example.com/post/999", target_url: "https://example.com/post/999" }})] }},
    ]),
  }},
  {{
    name: "same-run LinkedIn URL without like proof does not cover",
    expected: false,
    actual: covered("engagement_platform_feed_study_missing:linkedin", [linkedinPublishReceipt()], [
      {{ receipts: [supplementalReceipt({{ like_proof: {{}} }})] }},
    ]),
  }},
  {{
    name: "candidate pool insufficiency is covered only after verified target receipts",
    expected: true,
    actual: covered("engagement_candidate_pool_insufficient:10/13", [linkedinPublishReceipt()], [
      {{ receipts: fullTargetReceipts() }},
    ]),
  }},
  {{
    name: "candidate pool insufficiency does not cover missing verified targets",
    expected: false,
    actual: covered("engagement_candidate_pool_insufficient:10/13", [linkedinPublishReceipt()], [
      {{ receipts: fullTargetReceipts().slice(0, 8) }},
    ]),
  }},
  {{
    name: "candidate pool insufficiency does not cover selected target deficit",
    expected: false,
    actual: covered("engagement_candidate_pool_insufficient:10/13", [linkedinPublishReceipt()], [
      {{ receipts: fullTargetReceipts() }},
    ], {{ missing_target_actions: ["linkedin:like_candidate:3/5"] }}),
  }},
  {{
    name: "compound stop reason does not cover",
    expected: false,
    actual: covered("post_publish_feed_study_insufficient_external_posts:1/15; engagement_platform_feed_study_missing:linkedin", [linkedinPublishReceipt()], [
      {{ receipts: [supplementalReceipt()] }},
    ]),
  }},
];

for (const testCase of cases) {{
  if (testCase.actual !== testCase.expected) {{
    throw new Error(`${{testCase.name}}: expected ${{testCase.expected}} got ${{testCase.actual}}`);
  }}
}}
"""
    subprocess.run(["node", "-e", node_script], check=True, text=True, capture_output=True)


def test_daily_ai_runner_stdout_json_parser_skips_bad_trailing_json_like_logs() -> None:
    runner = _read("scripts/run_daily_ai_playwright_cli.mjs")
    helper_block = runner[
        runner.index("function parseLastStdoutJson")
        : runner.index("function safeSlug")
    ]
    node_script = f"""
{helper_block}
const payload = parseLastStdoutJson([
  "startup log",
  JSON.stringify({{ stop_reason: "image_generation_unavailable: runway_mcp_wrapper_failed", ok: false }}),
  "{{not valid json}}",
  "shutdown log",
].join("\\n"));
if (!payload || payload.stop_reason !== "image_generation_unavailable: runway_mcp_wrapper_failed") {{
  throw new Error(`unexpected parser payload: ${{JSON.stringify(payload)}}`);
}}
"""
    subprocess.run(["node", "-e", node_script], check=True, text=True, capture_output=True)


def test_daily_ai_feed_study_exact_platform_blocker_proof_requires_enough_external_reads() -> None:
    runner = _read("scripts/run_daily_ai_playwright_cli.mjs")
    helper_block = runner[
        runner.index("function exactFeedStudyPlatformBlockerProof")
        : runner.index("function fullFlowCompletionGate")
    ]
    node_script = f"""
const requiredEngagementPlatforms = ["x", "linkedin"];
const minExternalFeedReads = 15;
{helper_block}

const covered = exactFeedStudyPlatformBlockerProof("engagement_platform_feed_study_missing:linkedin", 15, minExternalFeedReads);
if (covered.ok || !covered.diagnostic_only || covered.platforms.join(",") !== "linkedin") {{
  throw new Error("expected diagnostic-only linkedin platform blocker proof");
}}

const insufficient = exactFeedStudyPlatformBlockerProof("engagement_platform_feed_study_missing:linkedin", 14, minExternalFeedReads);
if (insufficient.ok) {{
  throw new Error("insufficient external reads must not cover platform blocker");
}}

const compound = exactFeedStudyPlatformBlockerProof("post_publish_feed_study_insufficient_external_posts:1/15; engagement_platform_feed_study_missing:linkedin", 15, minExternalFeedReads);
if (compound.ok) {{
  throw new Error("compound stop reason must remain a blocker");
}}
"""
    subprocess.run(["node", "-e", node_script], check=True, text=True, capture_output=True)


def test_daily_ai_read_only_feed_study_creates_platform_no_candidate_proof(tmp_path: Path) -> None:
    runner = _read("scripts/run_daily_ai_playwright_cli.mjs")
    helper_block = runner[
        runner.index("function feedStudyReadOnlyNoCandidateProofs")
        : runner.index("function fullFlowCompletionGate")
    ]
    artifact = tmp_path / "feed-study.json"
    node_script = f"""
const fs = require("fs");
const path = require("path");
const projectRoot = {json.dumps(str(REPO_ROOT))};
{helper_block}

function writeArtifact(entries) {{
  fs.writeFileSync({json.dumps(str(artifact))}, JSON.stringify({{ read_posts: entries }}));
}}

const linkedinRows = Array.from({{ length: 4 }}, (_, index) => ({{
  platform: "linkedin",
  url: `https://www.linkedin.com/in/example-${{index}}/`,
  evidence: `read-only LinkedIn feed evidence ${{index}}`,
  engagement_action: "comment_candidate",
  candidate_eligible: false,
}}));

writeArtifact(linkedinRows);
const proof = feedStudyReadOnlyNoCandidateProofs(
  {{ artifact: {json.dumps(str(artifact))}, platform_reads: {{ linkedin: 4 }} }},
  ["linkedin"]
);
if (proof.length !== 1 || proof[0].platform !== "linkedin" || proof[0].read_count !== 4 || proof[0].eligible_count !== 0) {{
  throw new Error(`expected linkedin no-candidate proof, got ${{JSON.stringify(proof)}}`);
}}

writeArtifact([...linkedinRows.slice(0, 3), {{ ...linkedinRows[3], candidate_eligible: true }}]);
const eligibleProof = feedStudyReadOnlyNoCandidateProofs(
  {{ artifact: {json.dumps(str(artifact))}, platform_reads: {{ linkedin: 4 }} }},
  ["linkedin"]
);
if (eligibleProof.length !== 0) {{
  throw new Error("eligible LinkedIn feed entry must prevent no-candidate proof");
}}

writeArtifact(linkedinRows.slice(0, 3));
const shortProof = feedStudyReadOnlyNoCandidateProofs(
  {{ artifact: {json.dumps(str(artifact))}, platform_reads: {{ linkedin: 4 }} }},
  ["linkedin"]
);
if (shortProof.length !== 0) {{
  throw new Error("artifact count below platform_reads must prevent no-candidate proof");
}}
"""
    subprocess.run(["node", "-e", node_script], check=True, text=True, capture_output=True)


def test_daily_ai_engagement_completion_requires_post_send_proof() -> None:
    runner = _read("/Users/nichikatanaka/Documents/Codex/2026-06-03/playwight-mcp-playwirhgt-cli/lib/daily-ai-direct-cli.mjs")
    wrapper = _read("scripts/run_daily_ai_playwright_cli.mjs")
    cli_source = _read("src/social_flow/cli.py")

    assert "resolveXReplyComposer(page)" in runner
    assert "scope: 'inline'" in runner
    assert "composerScope: composer.scope" in runner
    assert "resolveEnabledXReplySubmitButton(page, composerRoot)" in runner
    assert "const isSubmit =" in runner
    assert "/^(Reply|返信|Post|ポスト|ポストする)$/i.test(label)" in runner
    assert "isSubmit && visible" in runner
    assert "clickXReplySubmitButton" in runner
    assert "submitXReplyAndCaptureUrl(page, composerRoot, submit, beforeIds, replyBody, targetUrl)" in runner
    assert "captureXThreadStatusIds(page, targetUrl)" in runner
    assert "captureXReplyUrlFromThread(page, targetUrl, beforeIds, replyBody" in runner
    assert "resolveXTargetArticle(page, targetUrl)" in runner
    assert 'article:has(a[href*="/status/${statusId}"])' in runner
    assert "proof.threadCapture = await captureXReplyUrlFromThread" in runner
    assert "runXReplyDialogKeyboardFallback(page, targetUrl, beforeIds, replyBody)" in runner
    assert "keyboardFallback.postUrl" in runner
    assert "keyboard_fallback_error" in runner
    assert "const reply = articleAfterBaseline.locator('[data-testid=\"reply\"]').first();" in runner
    assert "replyComposerStillOpen" in runner
    assert "coordinate_click" in runner
    assert "meta_enter" in runner
    assert "comment_post_url_captured" in runner
    assert "comment_not_sent: X reply completion URL was not visible after submit" in runner
    assert "reply_composer_still_open" in runner
    assert "comment_reflected_without_url" in runner
    assert "recoverXReplyUrlAfterReflectedSubmit(page, replyBody, beforeIds, {" in runner
    assert "targetUrl," in runner
    assert "submittedAfterMs: replySubmittedAfterMs" in runner
    assert "xStatusIdTimestampMs(id) < minCreatedAtMs" in runner
    assert "targetMatchMode = 'required'" in runner
    assert "const hasSubmittedAfter = Number(submittedAfterMs || 0) > 0" in runner
    assert "targetPattern && targetMatchMode !== 'preferred' && !targetMatched" in runner
    assert "targetPattern && targetMatchMode === 'preferred' && !targetMatched && !hasSubmittedAfter" in runner
    assert "targetMatchMode: targetStatusId ? 'preferred' : 'required'" in runner
    assert "receipt.gates.xReplyUrlRecovery = replyUrlRecovery" in runner
    assert "replyUrlRecovery.postUrl" in runner
    assert "submit_reflected_without_url_no_resend" in runner
    assert runner.index("let reflectedWithoutUrl = Boolean(submitProof.threadCapture?.reflectedWithoutUrl)") < runner.index(
        "const keyboardFallback = reflectedWithoutUrl"
    )
    assert "method = 'profile_with_replies'" in runner
    assert "method = 'search_live'" in runner
    assert "reply_url_recovery_failed" in runner
    assert "attempts: 4, waitMs: 2_000" in runner
    assert "isVerifiedEngagementCompletion(receipt)" in runner
    assert "engagement_completion_unverified" in runner
    assert "['like_reflected', 'bookmark_reflected'].includes(completion)" in runner
    assert "target_root_after_submit" in runner
    assert "editorCleared" in runner
    assert "postedCommentVisible" in runner
    assert "visibleBeforeSubmit" in runner
    assert "editor_cleared" in wrapper
    assert "posted_comment_visible" in wrapper
    assert "visible_before" in wrapper
    assert "commentProof" in runner
    assert "like_already_reflected" in runner
    assert "bookmark_already_reflected" in runner
    assert "unlike_button_visible" not in runner
    assert "remove_bookmark_button_visible" not in runner
    assert "reaction_state" not in runner
    assert "return { url: page.url(), completion: 'comment_reflected', queueUpdated: true, replyClickProof }" not in runner
    assert "updatedEngagementSummary.sent <= 0" in wrapper
    assert "function isVerifiedEngagementReceipt(receipt)" in wrapper
    assert "engagement_comment_reply_failed:" in wrapper
    assert "failed_comment_reply_receipts" in wrapper
    assert "!['x', 'linkedin'].includes(platform)" in wrapper
    assert "invalid_engagement_receipts" in wrapper
    assert "verified_engagement_receipt(receipt)" in wrapper
    assert "const requiredEngagementPlatforms = ['x', 'linkedin'];" in wrapper
    assert "candidate_pool_ids" in wrapper
    assert "selected_platforms" in wrapper
    assert "missing_required_platforms" in wrapper
    assert "engagement_platform_missing:" in wrapper
    assert "verified_engagement_platforms" in wrapper
    assert "feedStudyReadOnlyNoCandidateProofs" in wrapper
    assert "read_only_no_candidate_platforms" in wrapper
    assert "platform_no_candidate_proofs" in wrapper
    assert "read_only_or_unsupported_feed_entries" in wrapper
    assert "isExternalEngagementReceipt(receipt)" in wrapper
    assert "own_post_engagement_receipts_excluded" in wrapper
    assert "await runSupplementalMissingPlatformEngagement();" not in wrapper
    assert "comment_posted_toast" not in cli_source


def test_daily_ai_linkedin_publish_recovers_recent_activity_url_after_capture_delay() -> None:
    runner = _read("/Users/nichikatanaka/Documents/Codex/2026-06-03/playwight-mcp-playwirhgt-cli/lib/daily-ai-direct-cli.mjs")

    assert "recoverLinkedInPostUrlFromRecentActivity(page, body, row.source_url" in runner
    assert "playwright_cli_direct_linkedin_post_url_recovered_from_recent_activity" in runner
    assert "linkedInBodySnippets(body, sourceUrl" in runner
    assert "attempts: 20, waitMs: 3_000" in runner
    assert "receipt.gates.linkedinRecentActivityRecovery" in runner
    assert "capture_failed: LinkedIn completion URL was not visible after submit" in runner


def test_daily_prompt_and_docs_require_automation_health_receipt() -> None:
    prompt = _read(".codex/prompts/daily-ai-account-automation.md")
    doc = _read("docs/chrome-core-flow-automation.md")

    for text in (prompt, doc):
        assert "automation_health=stage:<stage>|lane:<lane>|source:posting_queue.tsv" in text
        assert "completion:external_publish_completion_required" in text
        assert "completion:engagement_completion_required" in text
        assert "stop_reason の代替" in text
        assert "pytest / dry-run / doc check だけで" in text
        assert "future scheduled run: not yet guaranteed" in text
        assert "AI修復ループ" in text
        assert "同じ registered entrypoint shape で再実行" in text


def test_daily_ai_buffer_replenish_is_registered_completion_step() -> None:
    runner = _read("scripts/run_daily_ai_playwright_cli.mjs")
    prompt = _read(".codex/prompts/daily-ai-account-automation.md")
    doc = _read("docs/chrome-core-flow-automation.md")
    readme = _read("README.md")
    skill = _read_abs("/Users/nichikatanaka/.agents/skills/daily-ai-research-publish-run/SKILL.md")
    contract = _read_abs(
        "/Users/nichikatanaka/.agents/skills/daily-ai-research-publish-run/references/current-run-contract.md"
    )

    assert "buffer_replenish: null" in runner
    assert "buffer_replenish_missing" in runner
    assert "buffer_replenish_skipped:" in runner
    assert "ship_now_buffer_ready_before_replenish" in runner
    assert "replenish-ship-now-buffer-local" in runner
    assert "--repair-generated-media" in runner
    assert "const replenishPayloads = [];" in runner
    assert "DAILY_AI_CLI_REPLENISH_BUFFER_MAX_ATTEMPTS || 3" in runner
    assert "String(lastReplenishPayload.stop_reason || '')" in runner
    assert "...replenishErrors" in runner
    assert "runSupplementalMissingActionEngagement" in runner
    assert "supplemental_missing_action_engagement_" in runner
    assert "engagement_supplemental_skipped:no_primary_engagement_receipts" in runner
    assert "engagement_supplemental_artifact_read_failed" in runner
    assert "supplemental-missing-action-engagement-${attemptNo}.json" in runner
    assert "ensureBrowserPreflightForStage(`supplemental_missing_action_engagement_${attemptNo}`)" in runner
    assert "Number(currentTargetAudit.managed_page_targets || 0) > 0" in runner
    assert "if (!engagementCandidateTargetMissing)" in runner
    assert "engagement_supplemental_candidate_missing" in runner
    assert "dry_run_not_live_completion" in runner
    assert "ship_now_buffer_gate_enforced: bufferGateEnforced" in runner
    assert "ship_now_buffer_below_target:${latestShipNowBuffer}/${targetShipNowBuffer}" in runner
    assert "usable_publish_candidate_buffer_below_target:${latestUsablePublishCandidateCount}/${targetShipNowBuffer}" in runner
    assert "usable_publish_candidate_count: latestUsablePublishCandidateCount" in runner
    assert "failures.push(bufferFailure)" in runner
    assert "buffer_replenish_stop_reason:${bufferReplenishStopReason}" in runner
    assert "buffer_replenish_completed" in runner
    assert "issue_ledger: []" in runner
    assert "issue-ledger.jsonl" in runner
    assert "read_only_url_reconciliation_before_repost" in runner
    assert "attach_authorized_media_result_then_rerun_buffer_replenish" in runner
    assert "appendIssueRecordsFromFailures('full_flow_completion', failures)" in runner
    assert runner.index("await runPostPublishBufferReplenish();") < runner.index("await runFinalBufferRefresh();")
    assert runner.index("await runDirectEngagementStep(") < runner.index("await runSupplementalMissingActionEngagement(")
    assert runner.index("await runSupplementalMissingActionEngagement(") < runner.index("await runActualTabVideoQaIfNeeded();")
    assert runner.index("await runFinalBufferRefresh();") < runner.index("await runPostflightSync();")
    assert runner.index("await runPostflightSync();") < runner.index("cleanupDailyAiChromeProcesses('completed');")
    assert runner.index("collectCleanupProof('completed'") < runner.index("fullFlowCompletionGate();")

    for text in (prompt, doc, readme, skill, contract):
        assert "buffer replenish" in text or "buffer が target 未達" in text
        assert "ship_now_buffer_below_target" in text


def test_daily_ai_active_lock_stop_writes_issue_ledger(tmp_path: Path) -> None:
    output_dir = tmp_path / "daily-ai-lock-run"
    lock_path = tmp_path / "daily-ai.lock.json"
    lock_path.write_text(
        json.dumps(
            {
                "pid": os.getpid(),
                "run_id": "active-run",
                "summary_path": str(tmp_path / "active-summary.json"),
                "started_at": "2026-07-04T10:00:00.000Z",
            }
        ),
        encoding="utf-8",
    )

    result = subprocess.run(
        ["node", str(REPO_ROOT / "scripts/run_daily_ai_playwright_cli.mjs")],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        timeout=15,
        env={
            **os.environ,
            "DAILY_AI_CLI_OUTPUT_DIR": str(output_dir),
            "DAILY_AI_CLI_LOCK_PATH": str(lock_path),
            "DAILY_AI_CLI_RUN_ID": "lock-issue-ledger-test",
        },
    )

    assert result.returncode == 1
    summary = json.loads((output_dir / "registered-playwright-cli-summary.json").read_text(encoding="utf-8"))
    assert summary["current_stage"] == "single_flight_lock"
    assert summary["issue_ledger"][0]["stage"] == "single_flight_lock"
    assert summary["issue_ledger"][0]["blocker_reason"].startswith("daily_ai_runner_already_active:")
    ledger_line = (output_dir / "issue-ledger.jsonl").read_text(encoding="utf-8").strip()
    assert json.loads(ledger_line)["policy"]["next_safe_action"] == "wait_for_active_runner_or_clear_stale_lock"


def test_daily_ai_post_body_language_gate_is_durable() -> None:
    prompt = _read(".codex/prompts/daily-ai-account-automation.md")
    doc = _read("docs/chrome-core-flow-automation.md")
    readme = _read("README.md")
    agents = _read("AGENTS.md")
    direct_cli = _read_abs(
        "/Users/nichikatanaka/Documents/Codex/2026-06-03/playwight-mcp-playwirhgt-cli/lib/daily-ai-direct-cli.mjs"
    )
    skill = _read_abs("/Users/nichikatanaka/.agents/skills/daily-ai-research-publish-run/SKILL.md")
    contract = _read_abs(
        "/Users/nichikatanaka/.agents/skills/daily-ai-research-publish-run/references/current-run-contract.md"
    )

    for text in (prompt, doc, readme, agents, skill, contract):
        assert "language_mismatch:<platform>" in text
        assert "composer readback" in text

    assert "X post body must be Japanese" in prompt
    assert "LinkedIn post body must be English" in prompt
    assert "X body/copy must be Japanese" in contract
    assert "LinkedIn body/copy must be English" in contract
    assert "X post body and generated media must be Japanese" in skill
    assert "LinkedIn post body and square/carousel media must be English" in skill
    assert "X は日本語、LinkedIn は英語" in agents
    assert "X は日本語、LinkedIn は英語" in readme
    assert "投稿本文は X が日本語、LinkedIn が英語" in doc
    assert "assertDailyAiPlatformBodyLanguage('x', body)" in direct_cli
    assert "assertDailyAiPlatformBodyLanguage('linkedin', body)" in direct_cli
    assert "throw new Error('language_mismatch:x')" in direct_cli
    assert "throw new Error('language_mismatch:linkedin')" in direct_cli


def test_recurring_automation_prompts_promote_success_paths_to_durable_rules() -> None:
    texts = [
        _read(".codex/prompts/daily-ai-account-automation.md"),
        _read(".codex/prompts/job-application-automation.md"),
        _read("docs/chrome-core-flow-automation.md"),
        _read("README.md"),
        _read_abs("/Users/nichikatanaka/Documents/Etsy/AGENTS.md"),
        _read_abs("/Users/nichikatanaka/Documents/Etsy/docs/daily_product_creation_flow.md"),
        _read_abs("/Users/nichikatanaka/Documents/Etsy/.Codex/skills/nisenprints-daily-product-flow/SKILL.md"),
        _read_abs("/Users/nichikatanaka/Documents/Etsy/.Codex/skills/runway-cat-art-prompter/SKILL.md"),
    ]

    for text in texts:
        assert "success_path_regression" in text
        assert "automation memory" in text
        assert "artifact path" in text

    for automation_id in (
        "automation-live-supervisor",
        "confirmed-job-applications-daily-queue",
        "job-application-manager",
        "nisenprints-daily-product-canva-printify-etsy-pinterest",
        "daily-ai-research-publish-run",
        "sns-daily-ai-publish-run",
    ):
        automation = _read_abs(f"/Users/nichikatanaka/.codex/automations/{automation_id}/automation.toml")
        has_inline_success_path_rule = (
            "Success-path stabilization rule (global user requirement)" in automation
            and "success_path_regression" in automation
            and "without loosening strict completion proof" in automation
            and "all current and future recurring automations" in automation
        )
        has_compact_runbook_entrypoint = (
            "/Users/nichikatanaka/.codex/automations/_shared/RUNBOOK.md" in automation
            and "STATE.md" in automation
        )
        has_skill_entrypoint = (
            "using the Codex skill" in automation
            and "The skill is the durable workflow" in automation
            and "STATE.md is the current source of queue state" in automation
        )
        has_local_success_path_rule = (
            "success_path_regression" in automation
            and "Success-path stabilization rule" in automation
            and "artifact" in automation
        )
        is_inactive_alias = 'status = "INACTIVE"' in automation and "Legacy alias" in automation
        is_inactive_historical = (
            'status = "INACTIVE"' in automation
            and (
                "historical" in automation.lower()
                or "confirmed-job-applications-daily-queue" in automation
            )
        )
        assert (
            has_inline_success_path_rule
            or has_compact_runbook_entrypoint
            or has_skill_entrypoint
            or has_local_success_path_rule
            or is_inactive_alias
            or is_inactive_historical
            or "Skill/docs own the flow" in automation
        )

    runbook = _read_abs("/Users/nichikatanaka/.codex/automations/_shared/RUNBOOK.md")
    assert "Success Path Stabilization" in runbook
    assert "success_path_regression" in runbook


def test_shared_video_qa_visual_audit_contract_is_referenced_by_recurring_workflows() -> None:
    schema = _read_abs("/Users/nichikatanaka/.codex/automations/_shared/STAGE_OBSERVATION_SCHEMA.md")
    automation_os_doc = _read_abs("/Users/nichikatanaka/Documents/Codex/automation-os/docs/13-gemini-video-qa.md")
    daily_skill = _read_abs("/Users/nichikatanaka/.agents/skills/daily-ai-research-publish-run/SKILL.md")
    daily_automation = _read_abs("/Users/nichikatanaka/.codex/automations/daily-ai-research-publish-run/automation.toml")
    job_skill = _read_abs("/Users/nichikatanaka/.codex/skills/job-application-daily-submit-queue/SKILL.md")
    job_automation = _read_abs("/Users/nichikatanaka/.codex/automations/job-application-manager/automation.toml")
    nisen_automation = _read_abs(
        "/Users/nichikatanaka/.codex/automations/nisenprints-daily-product-canva-printify-etsy-pinterest/automation.toml"
    )
    nisen_docs = "\n".join(
        [
            _read_abs("/Users/nichikatanaka/Documents/Etsy/AGENTS.md"),
            _read_abs("/Users/nichikatanaka/Documents/Etsy/docs/daily_product_creation_flow.md"),
            _read_abs("/Users/nichikatanaka/Documents/Etsy/.Codex/skills/nisenprints-daily-product-flow/SKILL.md"),
        ]
    )

    for text in (schema, automation_os_doc):
        assert "auxiliary proof" in text
        assert "completion veto" in text
        assert "stage_visual_audits" in text
        assert "gemini_video_qa" in text
        assert "must not" in text

    assert "Playwright CLI" in daily_skill
    assert "playwright_cli_callable_surface_missing" in daily_skill
    assert "current-run-contract.md" in daily_automation
    assert "Playwright CLI only" in daily_automation
    assert "playwright_cli_callable_surface_missing" in daily_automation
    daily_runner = _read("scripts/run_daily_ai_playwright_cli.mjs")
    assert "stage_visual_audits" in daily_runner
    assert "browser_video_qa" in daily_runner
    assert "browserVideoQaAuditFromStageObservation" in daily_runner
    assert "visualAuditCompletionFailures" in daily_runner
    assert "persistVisualAuditBlockedCompletion" in daily_runner
    assert "browser_video_qa_completion_gate_matches_false" in daily_runner
    assert "browser_video_qa_visual_audit_missing" in daily_runner
    assert "visual_audit_failures: visualAuditFailures" in daily_runner
    assert "browser_video_qa_completion_veto" in daily_runner
    assert "observedStatus = lowerValue(observation.status)" in daily_runner
    assert "observedAlignment = lowerValue(" in daily_runner
    assert "booleanFalse(observedCompletionMatches)" in daily_runner
    assert "observationContradictsCompletion" in daily_runner
    assert "browser_video_qa_completion_gate_matches_false" in daily_runner

    assert "AUTOMATION_OS_REGISTERED_SUMMARY_PATH" in job_skill
    assert "auxiliary proof plus completion veto only" in job_skill
    assert "STAGE_OBSERVATION_SCHEMA.md" in job_automation
    assert "source-of-truth proof" in job_automation
    assert "redaction-receipt-path" in job_skill

    assert "Video QA visual audits follow the shared schema" in nisen_automation
    assert "Video QA / Visual Audit Extension" in nisen_docs
    assert "auxiliary proof plus completion veto only" in nisen_docs
    assert "gemini_video_qa_completion_alignment" in nisen_docs
    assert "verify_nisenprints_completion.py" in nisen_docs


def test_daily_prompt_and_docs_reject_stale_trusted_bridge_receipts() -> None:
    prompt = _read(".codex/prompts/daily-ai-account-automation.md")
    doc = _read("docs/chrome-core-flow-automation.md")
    readme = _read("README.md")

    for text in (prompt, doc, readme):
        assert "trusted_runner_bridge_runtime_boundary" in text
        assert "trusted_runner_bridge_running_receipt_stale" in text
        assert "stale `running` receipt" in text or "stale `running` receipts" in text
        assert "成功扱いしません" in text or "成功として数えません" in text or "completion として数えず" in text
        assert "120秒境界" in text


def test_x_linkedin_prompt_checks_no_repost_before_posting() -> None:
    prompt = _read(".codex/prompts/x-linkedin-chrome-core-flow.md")

    assert "Playwright CLI registered runner" in prompt
    assert "Record & Replay / Playwright no-post preflight" in prompt
    assert "chrome_extension_profile2_fallback" in prompt
    assert "local_profile2_lane_unavailable" in prompt
    assert "legacy 診断用" in prompt
    assert "Playwright + Nicky automation profile" in prompt
    assert "Codex in-app Browser Use" in prompt
    assert "Do not repost" in prompt
    assert "URL capture pending" in prompt


def test_linkedin_notes_match_fallback_and_anti_template_rules() -> None:
    doc = _read("docs/linkedin-chrome-publish.md")

    assert "ユーザーが普通に「Browser Useで」「Playwrightで」と指定した場合" in doc
    assert "Playwright CLI registered runner" in doc
    assert "legacy 診断用" in doc
    assert "Codex in-app Browser Use" in doc
    assert "fallback にしません" in doc
    assert "local_profile2_lane_unavailable" in doc
    assert "Chrome Extension / Profile 2 と Playwright + Nicky automation profile は production lane に戻さない" in doc
    assert "Playwright + Nicky automation profile へは戻さない" in doc
    assert "固定の段落順ではなく品質チェック" in doc
    assert "chrome_extension_profile2_fallback" in doc
    assert "chrome_extension_profile2_unavailable" in doc
    assert "social-flow resolve-browser-lane --purpose publish --json" in doc


def test_daily_automation_prompt_uses_natural_tone_study() -> None:
    prompt = _read(".codex/prompts/daily-ai-account-automation.md")
    doc = _read("docs/chrome-core-flow-automation.md")
    study = _read("artifacts/feed-study/2026-05-21-natural-tone-study.md")
    voice = _read("artifacts/feed-study/nicky-voice-fingerprint.md")

    assert "artifacts/feed-study/2026-05-21-natural-tone-study.md" in prompt
    assert "artifacts/feed-study/nicky-voice-fingerprint.md" in prompt
    assert "artifacts/feed-study/2026-05-26-recommended-feed-voice-100-analysis.md" in prompt
    assert "artifacts/feed-study/2026-05-26-recommended-feed-voice-100-analysis.md" in doc
    assert "自然な出だしの例文を hook 集として再利用しない" in prompt
    assert "source 固有の数字" in prompt
    assert "LinkedIn は英語" in prompt
    assert "発表されました" in prompt
    assert "workflow layer" in prompt
    assert "具体的な仕事の場面" in doc
    assert "テンプレートではなく編集レンズ" in prompt
    assert "anti-template pass" in prompt
    assert "品質チェックであり、固定の段落テンプレートではない" in prompt
    assert "順番は固定しない" in prompt
    assert "文章テンプレートではなく、何を見せるか・何を検証するかを決める編集レンズ" in doc
    assert "別のAIニュースにも流用できる冒頭" in doc
    assert "自然に見えるが繰り返されている hook" in doc
    assert "summary bot" in study
    assert "マーケの現場" in study
    assert "This is not an opening-template file" in voice
    assert "Do not copy phrases" in voice


def test_posting_surface_gate_prevents_text_only_fallback() -> None:
    prompt = _read(".codex/prompts/daily-ai-account-automation.md")
    core_doc = _read("docs/chrome-core-flow-automation.md")
    linkedin_doc = _read("docs/linkedin-chrome-publish.md")
    chrome_prompt = _read(".codex/prompts/x-linkedin-chrome-core-flow.md")
    readme = _read("README.md")
    agents = _read("AGENTS.md")

    for text in (prompt, core_doc, chrome_prompt):
        assert "投稿面" in text
        assert "X引用解釈カード型" in text
        assert "X自作判断カード型" in text
        assert "LinkedIn正方形1枚画像型" in text
        assert "LinkedInカルーセル型" in text
        assert "LinkedInリンクカード型" in text
        assert "X本文+URL型" in text
        assert "LinkedIn本文+URL型" not in text
        assert "official_demo_breakdown" in text
        assert "X本文+URL型" in text
        assert "引用カード" in text
        assert "引用する" in text or "Quote" in text
        assert "自作日本語画像" in text
        assert "X は日本語" in text or "X 用の生成画像は必ず日本語" in text
        assert "LinkedIn は英語" in text or "LinkedIn 用の生成画像とカルーセルは必ず英語" in text
        assert "source/link card" in text
        assert "正方形カルーセル" in text
        assert "YYYY-MM-DD-<queue_id>" in text
        assert "Runway MCP" in text
        assert "gpt-image-2" in text
        assert "provider=runway_mcp" in text
        assert "generated_media_latest_model_missing" in text
        assert "high-impact" in text
        assert "白背景" in text or "white-background" in text
        assert "generated_media_low_impact" in text
        assert "generated_media_cropped_in_preview" in text
        assert "crop-safe" in text or "中央" in text
        assert "モバイル" in text or "mobile" in text
        assert "image_generation_unavailable" in text
        assert "surface_missing" in text
        assert "media_upload_permission_blocked" in text
        assert "quote_card_not_reflected" in text
        assert "link_card_not_reflected" in text
        assert "本文だけ" in text
        assert "fileChooser.setFiles" in text
        assert "preflight-linkedin-media-upload-local" in text
        assert "file_chooser.set_files" in text
        assert "setInputFiles" in text
        assert "expect_file_chooser" in text or "先に armed" in text
        assert "クリックしてから file chooser を待たない" in text
        assert "absolutePaths" in text
        assert "Photo` / `写真`" in text or "Photo / 写真" in text
        assert "div[role=button]" in text
        assert "shareActive=true" in text
        assert "Start a post" in text
        assert "メディアアップロード入口にしない" in text or "メディアアップロード入口にせず" in text
        assert "linkedin_photo_route_unavailable" in text
        assert "linkedin_photo_editor_preview_missing" in text
        assert "Finder ダイアログ" in text or "Finder ファイル選択ダイアログ" in text
        assert "CDP Accessibility tree" in text
        assert "Create post modal" in text
        assert "AX" in text
        assert "enabled `Post`" in text or "enabled Post" in text
        assert "completion URL capture" in text
        assert "generated_media_demo_placeholder" in text
        assert "One practical way to read this update" in text

    assert "表示面" in linkedin_doc
    assert "LinkedIn正方形1枚画像型" in linkedin_doc
    assert "LinkedInカルーセル型" in linkedin_doc
    assert "LinkedInリンクカード型" in linkedin_doc
    assert "LinkedIn本文+URL型" not in linkedin_doc
    assert "正方形カルーセル" in linkedin_doc
    assert "通常の画像投稿は正方形1枚を優先" in linkedin_doc
    assert "media_receipt" in linkedin_doc
    assert "Runway MCP `gpt-image-2`" in linkedin_doc
    assert "provider=runway_mcp" in linkedin_doc
    assert "generated_media_latest_model_missing" in linkedin_doc
    assert "high-impact" in linkedin_doc
    assert "generated_media_low_impact" in linkedin_doc
    assert "generated_media_cropped_in_preview" in linkedin_doc
    assert "fileChooser.setFiles" in linkedin_doc
    assert "preflight-linkedin-media-upload-local" in linkedin_doc
    assert "file_chooser.set_files" in linkedin_doc
    assert "setInputFiles" in linkedin_doc
    assert "expect_file_chooser" in linkedin_doc
    assert "Photo` / `写真`" in linkedin_doc
    assert "div[role=button]" in linkedin_doc
    assert "Start a post` や `shareActive=true` をメディアアップロード入口にしません" in linkedin_doc
    assert "linkedin_photo_route_unavailable" in linkedin_doc
    assert "linkedin_photo_editor_preview_missing" in linkedin_doc
    assert "クリックしてから file chooser を待たない" in linkedin_doc
    assert "Finder ダイアログが残ったまま" in linkedin_doc
    assert "One practical way to read this update" in linkedin_doc
    assert "link card が反映されない場合は本文だけで投稿せず" in linkedin_doc
    assert "surface_missing" in linkedin_doc

    for text in (readme, agents):
        assert "定期実行・新規プロジェクトチャット" in text or "新しいチャットや定期実行" in text
        assert "visual_style" in text
        assert "AIツール比較カード" in text
        assert "スキル/用語ロードマップ表" in text
        assert "7〜9ステップの実行手順カード" in text
        assert "レイヤー/成熟度/能力階層の解説図" in text
        assert "ノート写真・チートシート・プロンプト集" in text
        assert "gpt-image-2" in text
        assert "media_receipt" in text
        assert "X 用の生成画像は必ず日本語" in text or "Xは日本語" in text
        assert "LinkedIn 用の正方形画像とカルーセルは必ず英語" in text or "LinkedInは英語" in text
        assert "本文だけに劣化" in text

    automation_prompt = _read("/Users/nichikatanaka/.codex/automations/sns-daily-ai-publish-run/automation.toml")
    assert "Playwright CLI registered runner" in automation_prompt
    assert "daily-ai-research-publish-run" in automation_prompt
    assert "no duplicate posts" in automation_prompt


def test_job_application_prompt_blocks_tailor_resubmission_after_user_report() -> None:
    prompt = _read(".codex/prompts/job-application-automation.md")

    assert "もうTailorは送りました" in prompt
    assert "古い `retryable` artifact" in prompt
    assert "user_reported_submitted_pending_external_proof" in prompt
    assert "`job_applications` へ昇格しない" in prompt
    assert "Tailor 公式応募URLをワークスペース起動タブに含めない" in prompt


def test_job_application_prompt_requires_single_candidate_timeout_proof() -> None:
    prompt = _read(".codex/prompts/job-application-automation.md")
    submit_automation_path = "/Users/nichikatanaka/.codex/automations/job-application-manager/automation.toml"
    submit_automation = _read_abs(submit_automation_path)
    submit_automation_toml = tomllib.loads(submit_automation)
    deleted_followup_automation_path = Path(
        "/Users/nichikatanaka/.codex/automations/job-application-follow-up-inbox-2/automation.toml"
    )
    historical_automation = _read_abs("/Users/nichikatanaka/.codex/automations/confirmed-job-applications-daily-queue/automation.toml")
    historical_automation_toml = tomllib.loads(historical_automation)
    state = _read_abs("/Users/nichikatanaka/.codex/automations/job-application-manager/STATE.md")
    historical_state = _read_abs("/Users/nichikatanaka/.codex/automations/confirmed-job-applications-daily-queue/STATE.md")
    skill = _read_abs("/Users/nichikatanaka/.codex/skills/job-application-daily-submit-queue/SKILL.md")
    historical_skill = _read_abs("/Users/nichikatanaka/.codex/skills/confirmed-job-applications-daily-queue/SKILL.md")
    runbook = _read_abs("/Users/nichikatanaka/.codex/automations/_shared/RUNBOOK.md")
    readme = _read("README.md")

    assert "Context budget / Context Rot hardening" in prompt
    assert "compact entrypoint" in prompt
    assert "job-application-manager/STATE.md" in prompt
    assert "削除済みなので読みに行かない" in prompt
    assert "/Users/nichikatanaka/.codex/automations/job-application-follow-up-inbox-2/" in prompt
    assert "`confirmed-job-applications-daily-queue` は inactive historical proof only" in prompt
    assert "Job Application Manager" in submit_automation
    assert "only active user-facing job automation" in submit_automation
    assert "internal manager lane" in submit_automation
    assert "job-application-follow-up-inbox-2 automation were deleted" in submit_automation
    assert "do not read their deleted STATE.md, memory.md, or automation.toml paths" in submit_automation
    assert "must not send recruiter replies, process inbox triage" in submit_automation
    assert not deleted_followup_automation_path.exists()
    assert "Follow-up lane owns post-application management only as an internal manager lane" in submit_automation
    assert "It must not initiate new applications" in submit_automation
    assert historical_automation_toml["status"] == "INACTIVE"
    assert "Current active job work is owned by Job Application Manager" in historical_automation
    assert "job-application-manager/STATE.md" in historical_automation
    assert "historical proof only" in historical_skill
    assert "Historical Proof Lookup" in historical_skill
    assert "This inactive skill is read-only" in historical_skill
    assert "Do not open Gmail, Calendar, Sheets, job platforms, or browser lanes from this skill" in historical_skill
    assert "Do not load old full `memory.md` history unless" in skill
    assert "Context Budget Rule" in runbook
    assert "End-to-End Stability Contract" in runbook
    assert "current queue state, last checked artifact, blockers, and resume triggers in the automation-specific `STATE.md`" in runbook
    assert "A numeric target is an operating target, not permission to bypass safety gates" in runbook
    assert "Every blocker that remains at the end of a run needs an exact resume trigger" in runbook
    assert "Hard Stops" in state
    assert "job-application-daily-submit-queue` skill rules" in state
    assert "Lane Boundaries" in state
    assert "official or trusted application surfaces" in state
    assert "Follow-up owns Gmail/Calendar deltas" in state
    assert "do not read the deleted standalone submit automation path" in state
    assert "inactive and superseded" in historical_state
    assert "new application submissions are owned by `Job Application Manager` internal lanes" in historical_state
    assert "Inactive Manual-Open Contract" in historical_state
    assert "Do not open Gmail, Calendar, Sheets, job platforms, Chrome Extension lanes, or Playwright lanes from this inactive queue" in historical_state

    assert "定期実行 completion hardening 2026-06-03" in prompt
    assert "Daily application target 2026-06-25" in prompt
    assert "`Japan-targeted submitted_confirmed` 20件" in prompt
    assert "`overseas/global submitted_confirmed` 20件" in prompt
    assert "最大 30 件の `submitted_confirmed` を目指す" not in prompt
    assert "日本向け20件または海外/グローバル20件のどちらか未満" in prompt
    assert "`User action only`" in prompt
    assert "ユーザーが今やるべき未完了タスクだけ" in prompt
    assert "今あなたがやることはありません" in prompt
    assert "User-Facing Report" in skill
    assert "Report only what the user still needs to do now" in skill
    assert "今あなたがやることはありません" in skill
    assert "20 Japan-targeted and 20 overseas/global safe `submitted_confirmed` job applications" in skill
    assert "Tailor PMM no-resubmit" in skill
    assert "security-code/CAPTCHA bodies" in skill
    assert "Stable end-to-end flow 2026-06-04" in prompt
    assert "新規応募送信 run は `preflight -> candidate supply -> company/role research -> safe apply loop -> source-of-truth sync/readback -> cleanup -> success-path promotion`" in prompt
    assert "応募後管理 run は `preflight -> evidence delta -> confirmation/rejection/interview/deadline/user-only extraction -> opportunity-signal extraction -> source-of-truth sync/readback -> cleanup -> success-path promotion`" in prompt
    assert "recruiter outreach、LinkedIn InMail、jobs recommended for you、similar jobs、platform recommendation digest" in prompt
    assert "submit queue へ handoff" in prompt
    assert "Opportunity handoff from Follow-up to Submit is never submit authorization" in state
    assert "may consume opportunity signals from follow-up after dedupe" in submit_automation
    assert "opportunity-signal handoff" in state
    assert "read-only discovery of recruiter/recommendation opportunity mails that should be handed off here as candidate leads" in skill
    assert "`1 candidate = 1 browser call = 1 outcomes JSONL = 1 sync`" in prompt
    assert "chrome_node_tool_timeout_before_artifact" in prompt
    assert "sync_job_pipeline_outcomes.py" in prompt
    assert "`application_appends>0`" in prompt
    assert "retry queue order" in prompt
    assert "owned process/tab cleanup proof" in prompt
    assert '"target":1' in prompt
    assert '"maxSelectedTotal":1' in prompt
    assert '"maxCandidatesPerBrowserChunk":1' in prompt
    assert "1 candidate = 1 browser call = 1 outcomes JSONL = 1 sync" in skill
    assert "Submit 20 Japan-targeted and 20 overseas/global safe `submitted_confirmed` job applications per run" in skill
    assert "user action items" in submit_automation
    assert "今あなたがやることはありません" in submit_automation
    assert "application_appends>0" in skill
    assert "cleanup proof" in submit_automation
    assert "chrome_node_tool_timeout_before_artifact" in state
    assert "source-of-truth update or verified no-action proof" in runbook
    assert "current scheduled-run behavior treats this as superseded by the 2026-06-25 Japan/overseas split target" in state
    assert "Fewer than 20 in either bucket is partial/safe-stopped" in state
    assert "Start with current user action items only" in state
    assert "今あなたがやることはありません" in state

    for text in (prompt, skill, state, readme):
        assert "/Users/nichikatanaka/.job-research-playwright-chrome" in text
        assert "9334" in text
    for text in (prompt, skill, state, readme):
        assert "artifacts/job-playwright-cli-runs/" in text
    assert "Daily AI publish / engagement" in readme
    assert "/Users/nichikatanaka/.daily-ai-playwright-chrome" in readme
    assert "9333" in readme
    assert "Etsy / NisenPrints" in readme
    assert "/Users/nichikatanaka/.nisenprints-playwright-chrome" in readme
    assert "9335" in readme
    assert "/Users/nichikatanaka/Documents/Etsy/artifacts/playlite-runs/" in readme
    assert "最終 `Submit`" in prompt
    assert "Sheets/Calendar write" in prompt
    assert "Chrome Extension + real Chrome Profile 2 production lane と write lock" in prompt
    assert "public official-form final Submit" in state
    assert "`Job Application Manager` の内部 Follow-up lane が Chrome Extension + real Chrome Profile 2 lane と write lock" in readme
    assert "Human-like adaptive operation rule" in prompt
    assert "固定文言や固定URLに合わないだけで諦めない" in prompt
    assert "stage, attempt_no, exact blocker" in submit_automation
    assert "cleanup proof" in submit_automation
    assert "durable artifact_uri" in submit_automation

    assert submit_automation_toml["cwds"] == ["/Users/nichikatanaka/Documents/New project"]
    assert submit_automation_toml["model"]
    assert "pro" not in submit_automation_toml["model"].lower()
    assert submit_automation_toml["reasoning_effort"] == "high"
    assert submit_automation_toml["execution_environment"] == "local"

    con = sqlite3.connect("/Users/nichikatanaka/.codex/sqlite/codex-dev.db")
    submit_db_row = con.execute(
        "select prompt, cwds, model, reasoning_effort, status from automations where id=?",
        ("job-application-manager",),
    ).fetchone()
    assert submit_db_row is not None
    assert submit_db_row[0] == submit_automation_toml["prompt"]
    assert "/Users/nichikatanaka/Documents/New project" in submit_db_row[0]
    assert json.loads(submit_db_row[1]) == submit_automation_toml["cwds"]
    assert submit_db_row[2] == submit_automation_toml["model"]
    assert submit_db_row[3] == submit_automation_toml["reasoning_effort"]
    assert submit_db_row[4] == "ACTIVE"

    followup_db_row = con.execute(
        "select id from automations where id=?",
        ("job-application-follow-up-inbox-2",),
    ).fetchone()
    assert followup_db_row is None

    historical_db_row = con.execute(
        "select prompt, status from automations where id=?",
        ("confirmed-job-applications-daily-queue",),
    ).fetchone()
    assert historical_db_row is not None
    assert historical_db_row[0] == historical_automation_toml["prompt"]
    assert historical_db_row[1] == "INACTIVE"
    assert "Inactive historical proof only" in historical_db_row[0]
    assert "Do not run post-application management" in historical_db_row[0]

    for text in (skill, state, readme):
        assert "/Users/nichikatanaka/Documents/New\\ project/.venv/bin/social-flow write-job-registered-video-qa-sidecar" in text
        assert '--video-path "$REDACTED_JOB_VIDEO_PATH"' in text
        assert '--redaction-receipt-path "$REDACTED_JOB_VIDEO_RECEIPT_PATH"' in text
        assert "auxiliary proof plus completion veto only" in text


def test_job_application_prompt_fixed_scheduler_loop_is_documented() -> None:
    prompt = _read(".codex/prompts/job-application-automation.md")
    automation_prompt = _read("/Users/nichikatanaka/.codex/automations/job-application-manager/automation.toml")
    universal_launcher = _read("/Users/nichikatanaka/.local/bin/run-job-manager-scheduler")

    assert len(tomllib.loads(automation_prompt)["prompt"]) < 3072
    assert "/Users/nichikatanaka/.local/bin/run-job-manager-scheduler" in prompt
    assert "--live-preflight-only" in prompt
    assert "registered cwd" in prompt
    assert "same-launch bridge receipt" in prompt
    assert "never recurse into `run-scheduler-now --execute`" in prompt
    for expected in (
        '#!/bin/sh',
        'python3 - "$AUTOMATION_TOML"',
        "job_manager_registered_cwd_mismatch",
        'cd "$REGISTERED_CWD"',
        '--project "$REGISTERED_CWD"',
        "social-flow run-scheduler-now",
        "--automation-id job-application-manager",
        "--registry-codex-home /Users/nichikatanaka/.codex",
        "--codex-home /private/tmp/codex-job-manager-home",
        '"$@"',
    ):
        assert expected in universal_launcher
    assert "--execute" not in universal_launcher
    for text in (prompt, automation_prompt):
        assert "/Users/nichikatanaka/.local/bin/run-job-manager-scheduler" in text
        assert "live-preflight-only" in text
        assert "registered cwd" in text
        assert "same-launch bridge receipt" in text
        assert "Chrome Extension/Profile 2-primary" in text
        assert "Do not store passwords or security codes" in text


def test_job_application_manager_account_backed_surfaces_keep_secret_boundaries() -> None:
    automation_prompt = _read("/Users/nichikatanaka/.codex/automations/job-application-manager/automation.toml")
    manager_state = _read("/Users/nichikatanaka/.codex/automations/job-application-manager/STATE.md")
    manager_memory = _read("/Users/nichikatanaka/.codex/automations/job-application-manager/memory.md")
    project_prompt = _read(".codex/prompts/job-application-automation.md")

    for text in (automation_prompt, manager_state, manager_memory, project_prompt):
        assert "nichika2000823@gmail.com" in text
        assert "LinkedIn" in text
        assert "Profile 2" in text
        assert "write lock" in text or "write-lock" in text
        assert "Do not store" in text or "保存しない" in text

    assert "LinkedIn/account-backed surfaces stay in scope" in automation_prompt
    assert "all live browser work for this automation stays Chrome Extension/Profile 2-primary" in automation_prompt
    assert "Live-preflight-only" in manager_state or "live-preflight-only" in manager_state
    assert "Keep the shared write lock" in manager_memory
    assert "platform_signup_runner_missing" in automation_prompt
    assert "all live browser work stays Chrome Extension/Profile 2-primary" in manager_state
    assert "Read Gmail through the Gmail plugin" in project_prompt
    assert "Chrome Extension/Profile 2 only" in project_prompt


def test_job_application_manager_distinguishes_trusted_runtime_from_profile2_logout() -> None:
    manager_state = _read("/Users/nichikatanaka/.codex/automations/job-application-manager/STATE.md")
    manager_memory = _read("/Users/nichikatanaka/.codex/automations/job-application-manager/memory.md")
    project_prompt = _read(".codex/prompts/job-application-automation.md")

    for text in (manager_state, manager_memory, project_prompt):
        assert "trusted_chrome_runtime_unavailable" in text
        assert "browser_client_not_trusted_or_missing" in text
        assert "official/trusted ATS fallback" in text or "official_trusted_ats" in text

    assert "not LinkedIn logout/authwall" in manager_state
    assert "not Profile 2 missing" in manager_memory
    assert "Profile 2 自体の不在を主張できるのは trusted runtime 内" in project_prompt


def test_job_application_manager_linkedin_uses_one_candidate_bridge_chunks() -> None:
    manager_state = _read("/Users/nichikatanaka/.codex/automations/job-application-manager/STATE.md")
    project_prompt = _read(".codex/prompts/job-application-automation.md")
    bridge_client = _read("scripts/browser_use/chrome_extension_trusted_bridge_client.mjs")
    bridge_server = _read("scripts/browser_use/chrome_extension_trusted_bridge_server.mjs")

    for text in (manager_state, project_prompt):
        assert "target=1" in text
        assert "maxCandidatesPerBrowserChunk=1" in text
        assert "maxSelectedTotal=1" in text
        assert "deadlineSeconds<=180" in text
        assert "visible_submission_success" in text
        assert "chrome_node_tool_timeout_before_artifact" in text

    assert "writeJobBridgeFallbackArtifact" in bridge_client
    assert "trusted_runner_bridge_unavailable_before_job_artifact" in bridge_client
    assert "AbortError" in bridge_client
    assert "runtimeSetupTimeoutMs" in bridge_server
    assert "Math.min(1, positiveNumber(payload.targetReadyOrSubmitted || payload.target, 1))" in bridge_server
    assert "Math.min(1, positiveNumber(payload.maxCandidatesPerBrowserChunk, 1))" in bridge_server
    assert "Math.min(1, positiveNumber(payload.maxSelectedTotal, 1))" in bridge_server
    assert "appendLinkedInJobUnexpectedFailureOutcome" in bridge_server
