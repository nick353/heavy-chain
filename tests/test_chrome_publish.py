import json
from unittest.mock import patch

import pytest
from playwright.sync_api import sync_playwright

from social_flow.chrome_publish import (
    ChromeLaunchConfig,
    ChromePublisher,
    LINKEDIN_COMPOSE_ENTRY_LABELS,
    LINKEDIN_EDITOR_CANDIDATE_SELECTORS,
    LINKEDIN_POST_BUTTON_LABELS,
    LINKEDIN_COMPOSE_URL,
    X_EDITOR_CANDIDATE_SELECTORS,
    _applescript_string,
    _build_activate_linkedin_compose_applescript,
    _build_activate_x_compose_applescript,
    _build_linkedin_compose_seed,
    _build_linkedin_compose_url,
    _build_linkedin_compose_click_point_javascript,
    _build_linkedin_compose_dom_click_javascript,
    _build_cleanup_automation_tabs_applescript,
    _build_linkedin_editor_click_point_javascript,
    _build_linkedin_editor_html,
    _build_linkedin_editor_injection_javascript,
    _build_linkedin_post_click_point_javascript,
    _build_linkedin_post_state_javascript,
    _build_linkedin_post_submit_javascript,
    _build_x_editor_click_point_javascript,
    _build_x_editor_injection_javascript,
    _build_x_post_capture_javascript,
    _build_x_post_state_javascript,
    _format_live_chrome_error,
)


def _new_headless_chromium_page_or_skip(playwright):
    try:
        browser = playwright.chromium.launch(headless=True)
    except Exception as exc:
        pytest.skip(f"headless Chromium unavailable in this environment: {exc}")
    return browser, browser.new_page()


def test_build_linkedin_editor_html_preserves_blank_lines() -> None:
    html = _build_linkedin_editor_html("first line\n\nthird line")
    assert html == "<p>first line</p><p><br></p><p>third line</p>"


def test_build_linkedin_editor_html_escapes_html() -> None:
    html = _build_linkedin_editor_html("<b>safe</b>")
    assert html == "<p>&lt;b&gt;safe&lt;/b&gt;</p>"


def test_localized_linkedin_labels_cover_english_and_japanese() -> None:
    assert "Start a post" in LINKEDIN_COMPOSE_ENTRY_LABELS
    assert "投稿を開始" in LINKEDIN_COMPOSE_ENTRY_LABELS
    assert "Post" in LINKEDIN_POST_BUTTON_LABELS
    assert "投稿" in LINKEDIN_POST_BUTTON_LABELS


def test_editor_candidate_selectors_include_localized_and_generic_hooks() -> None:
    assert '[contenteditable="true"][role="textbox"]' in LINKEDIN_EDITOR_CANDIDATE_SELECTORS
    assert any("テキストエディタ" in selector for selector in LINKEDIN_EDITOR_CANDIDATE_SELECTORS)
    assert any("data-placeholder" in selector or "投稿" in selector for selector in LINKEDIN_EDITOR_CANDIDATE_SELECTORS)


def test_applescript_string_escapes_quotes_and_backslashes() -> None:
    rendered = _applescript_string('say "hi" \\ ok')
    assert rendered == '"say \\"hi\\" \\\\ ok"'


def test_activate_linkedin_compose_applescript_targets_compose_url() -> None:
    script = _build_activate_linkedin_compose_applescript()
    assert LINKEDIN_COMPOSE_URL in script
    assert "preferredWindowIndex" in script
    assert "existingComposeWindowIndex" in script
    assert "existingFeedWindowIndex" in script
    assert 'currentUrl contains "https://www.linkedin.com/feed/"' in script
    assert "set active tab index to existingComposeTabIndex" in script
    assert "if existingComposeWindowIndex is not 0 then" in script
    assert "if existingFeedWindowIndex is not 0 then" in script
    assert "make new tab with properties" in script


def test_activate_compose_applescripts_can_restrict_to_profile_label() -> None:
    linkedin_script = _build_activate_linkedin_compose_applescript(profile_label="二千 (Nicky)")
    x_script = _build_activate_x_compose_applescript(profile_label="二千 (Nicky)")

    for script in (linkedin_script, x_script):
        assert 'set profileLabel to "二千 (Nicky)"' in script
        assert 'tell process "Google Chrome"' in script
        assert "allowedProfileWindowIndexes" in script
        assert "profile_window_not_found:" in script


def test_build_linkedin_compose_url_prefills_text() -> None:
    url = _build_linkedin_compose_url("hello world\nnext line")
    assert url.startswith(LINKEDIN_COMPOSE_URL)
    assert "&text=" in url
    assert "hello%20world%0Anext%20line" in url


def test_build_linkedin_compose_seed_uses_short_single_line() -> None:
    seed = _build_linkedin_compose_seed(" first line \n\nsecond line")
    assert seed == "first line second line"


def test_linkedin_post_submit_requires_editor_and_primary_post_button() -> None:
    script = _build_linkedin_post_submit_javascript()

    assert "editor_text_missing" in script
    assert "post_button_unavailable" in script
    assert "share-actions__primary-action" in script
    assert "share-box_actions-post-button" in script
    assert "Text editor" in script
    assert "テキストエディタ" in script
    assert "投稿" in script
    assert "containerRoots" in script
    assert "aria-disabled" in script
    assert "isVisible(editor)" in script
    assert "isVisible(button)" in script


def test_linkedin_post_submit_clicks_only_visible_editor_primary_post_button() -> None:
    script = _build_linkedin_post_submit_javascript()

    with sync_playwright() as playwright:
        browser, page = _new_headless_chromium_page_or_skip(playwright)
        page.set_content(
            """
            <html>
              <body>
                <div role="dialog" style="display:none">
                  <div class="ql-editor" contenteditable="true">stale hidden text</div>
                  <button class="share-actions__primary-action" onclick="window.hiddenClicked = true">Post</button>
                </div>
                <div role="dialog">
                  <div class="ql-editor" contenteditable="true">ready visible text</div>
                  <button class="artdeco-button" onclick="window.audienceClicked = true">Post</button>
                  <button class="share-actions__primary-action" onclick="window.primaryClicked = true">Post</button>
                </div>
              </body>
            </html>
            """
        )
        result = json.loads(page.evaluate(script))
        clicked = page.evaluate(
            "() => ({ hidden: Boolean(window.hiddenClicked), audience: Boolean(window.audienceClicked), primary: Boolean(window.primaryClicked) })"
        )
        browser.close()

    assert result == {"clicked": True}
    assert clicked == {"hidden": False, "audience": False, "primary": True}


def test_linkedin_post_click_point_ignores_audience_post_without_primary_editor_button() -> None:
    script = _build_linkedin_post_click_point_javascript()

    with sync_playwright() as playwright:
        browser, page = _new_headless_chromium_page_or_skip(playwright)
        page.set_content(
            """
            <html>
              <body>
                <div role="dialog">
                  <div class="ql-editor" contenteditable="true">ready visible text</div>
                  <button class="artdeco-button">Post</button>
                </div>
              </body>
            </html>
            """
        )
        result = json.loads(page.evaluate(script))
        browser.close()

    assert result == {"found": False, "reason": "post_button_unavailable"}


def test_linkedin_post_state_scopes_to_active_editor_and_primary_post_button() -> None:
    script = _build_linkedin_post_state_javascript()

    assert "closest('[role=\"dialog\"], .share-box, .share-creation-state, .artdeco-modal')" in script
    assert "share-actions__primary-action" in script
    assert "share-box_actions-post-button" in script
    assert "aria-disabled" in script
    assert "trim().length > 0" in script


def test_cleanup_automation_tabs_applescript_targets_compose_urls() -> None:
    script = _build_cleanup_automation_tabs_applescript(keep_linkedin_tabs=1, keep_x_tabs=1)
    assert "shareActive=true" in script
    assert "https://x.com/compose/post" in script
    assert "close currentTab" in script


def test_cleanup_automation_tabs_applescript_can_restrict_to_profile_label() -> None:
    script = _build_cleanup_automation_tabs_applescript(
        keep_linkedin_tabs=1,
        keep_x_tabs=1,
        profile_label="二千 (Nicky)",
    )

    assert 'set profileLabel to "二千 (Nicky)"' in script
    assert "allowedProfileWindowIndexes" in script
    assert "Skip non-target Chrome profile windows." in script


def test_prime_live_chrome_window_opens_configured_profile() -> None:
    calls: list[list[str]] = []
    publisher = ChromePublisher(
        ChromeLaunchConfig(
            executable_path="/bin/echo",
            user_data_dir="/Users/example/Library/Application Support/Google/Chrome",
            profile_directory="Profile 2",
        )
    )

    with patch("social_flow.chrome_publish.subprocess.Popen") as popen, patch(
        "social_flow.chrome_publish.time.sleep"
    ) as sleep:
        popen.side_effect = lambda args, **_: calls.append(args)
        publisher._prime_live_chrome_window("https://x.com/compose/post")

    assert calls == [
        [
            "/bin/echo",
            "--user-data-dir=/Users/example/Library/Application Support/Google/Chrome",
            "--profile-directory=Profile 2",
            "https://x.com/compose/post",
        ]
    ]
    sleep.assert_called_once_with(1.5)


def test_editor_injection_javascript_embeds_text_and_linkedin_hooks() -> None:
    script = _build_linkedin_editor_injection_javascript("hello\nworld")
    assert "document.execCommand('insertText'" in script
    assert '"hello\\nworld"' in script
    assert "collectRoots" in script
    assert "shadowRoot" in script
    assert "share-actions__primary-action" in script
    assert "share-box_actions-post-button" in script
    assert "deepQueryWithin" in script
    assert "aria-disabled" in script


def test_compose_click_point_javascript_returns_screen_coordinates() -> None:
    script = _build_linkedin_compose_click_point_javascript()
    assert "window.screenX" in script
    assert "window.outerHeight - window.innerHeight" in script
    assert "Start a post" in script
    assert "collectRoots" in script
    assert "shadowRoot" in script


def test_compose_dom_click_javascript_supports_deep_div_role_button() -> None:
    script = _build_linkedin_compose_dom_click_javascript()
    assert 'div[role="button"]' in script
    assert "Start a post" in script
    assert "target.click()" in script
    assert "collectRoots" in script
    assert "shadowRoot" in script


def test_linkedin_editor_click_point_javascript_returns_screen_coordinates() -> None:
    script = _build_linkedin_editor_click_point_javascript()
    assert 'contenteditable="true"' in script
    assert 'aria-label*="投稿"' in script
    assert "window.screenX" in script
    assert "window.outerHeight - window.innerHeight" in script


def test_linkedin_post_click_point_javascript_returns_screen_coordinates() -> None:
    script = _build_linkedin_post_click_point_javascript()
    assert "button" in script
    assert "Post" in script
    assert "editor_text_missing" in script
    assert "post_button_unavailable" in script
    assert "share-actions__primary-action" in script
    assert "share-box_actions-post-button" in script
    assert "collectRoots" in script
    assert "shadowRoot" in script
    assert "Text editor" in script
    assert "テキストエディタ" in script
    assert "containerRoots" in script
    assert "aria-disabled" in script
    assert "window.screenX" in script
    assert "window.outerHeight - window.innerHeight" in script


def test_x_editor_click_point_javascript_returns_screen_coordinates() -> None:
    script = _build_x_editor_click_point_javascript()
    assert "tweetTextarea_0" in script
    assert "collectRoots" in script
    assert "window.screenX" in script
    assert "window.outerHeight - window.innerHeight" in script


def test_x_editor_candidate_selectors_cover_current_compose_variants() -> None:
    assert 'div[data-testid="tweetTextarea_0"][role="textbox"]' in X_EDITOR_CANDIDATE_SELECTORS
    assert '[data-testid="tweetTextarea_0"][contenteditable="true"]' in X_EDITOR_CANDIDATE_SELECTORS
    assert any("What is happening" in selector for selector in X_EDITOR_CANDIDATE_SELECTORS)
    assert any("いまどうしてる" in selector for selector in X_EDITOR_CANDIDATE_SELECTORS)


def test_x_editor_injection_javascript_uses_deep_search_and_generic_buttons() -> None:
    script = _build_x_editor_injection_javascript("hello world")
    assert "collectRoots" in script
    assert "shadowRoot" in script
    assert "tweetButtonInline" in script
    assert 'button[aria-label="投稿する"]' in script


def test_x_post_state_javascript_reports_editor_not_found_reason() -> None:
    script = _build_x_post_state_javascript()
    assert "editor_not_found" in script
    assert "aria-label=\"投稿する\"" in script
    assert "login_required" in script


def test_format_live_chrome_error_guides_relaunch_when_applescript_js_is_off() -> None:
    message = _format_live_chrome_error(
        "Google Chromeでエラーが起きました: AppleScript からの JavaScript の実行がオフになっています。"
    )
    assert "fully quit and reopen Google Chrome once" in message
    assert "Allow JavaScript from Apple Events" in message


def test_publish_linkedin_is_disabled_in_soy_safe_mode() -> None:
    publisher = ChromePublisher(
        ChromeLaunchConfig(
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            user_data_dir="/Users/example/Library/Application Support/Google/Chrome",
            profile_directory="Profile 2",
            profile_label="二千 (Nicky)",
        )
    )

    with patch.object(publisher, "_try_publish_linkedin_via_live_chrome_tab") as live_publish, patch(
        "social_flow.chrome_publish.sync_playwright"
    ) as mock_sync_playwright:
        result = publisher.publish_linkedin("hello", dry_run=True)

    assert not result.ok
    assert result.mode == "browser_use_lane_required"
    assert "Legacy foreground Chrome publishing is disabled" in result.error
    assert "Chrome plugin registered runner" in result.error
    assert "Do not fall back to Playwright" in result.error
    assert "Use a Chrome Extension backend claimed Profile 2 tab" not in result.error
    live_publish.assert_not_called()
    mock_sync_playwright.assert_not_called()


def test_publish_x_is_disabled_in_soy_safe_mode() -> None:
    publisher = ChromePublisher(
        ChromeLaunchConfig(
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            user_data_dir="/Users/example/Library/Application Support/Google/Chrome",
            profile_directory="Profile 2",
            profile_label="二千 (Nicky)",
        )
    )

    with patch.object(publisher, "_try_publish_x_via_live_chrome_tab") as live_publish:
        result = publisher.publish_x("hello", dry_run=True)

    assert not result.ok
    assert result.mode == "browser_use_lane_required"
    assert "Legacy foreground Chrome publishing is disabled" in result.error
    assert "Chrome plugin registered runner" in result.error
    assert "Do not fall back to Playwright" in result.error
    assert "Use a Chrome Extension backend claimed Profile 2 tab" not in result.error
    live_publish.assert_not_called()


def test_x_post_capture_javascript_allows_profile_and_web_status_urls() -> None:
    script = _build_x_post_capture_javascript("snippet", handle="nichika2000823")

    assert "href.includes('/' + handle + '/status/')" in script
    assert "href.includes('/i/web/status/')" in script
    assert "if (handle)" in script


def test_focus_linkedin_editor_real_click_targets_selected_tab() -> None:
    publisher = ChromePublisher(
        ChromeLaunchConfig(
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            user_data_dir="/tmp/social-flow-test",
            profile_directory="Profile 2",
        )
    )

    with patch("social_flow.chrome_publish._command_exists", return_value=True), patch.object(
        publisher,
        "_activate_chrome_tab",
    ) as mock_activate_tab, patch.object(
        publisher,
        "_run_chrome_javascript",
        return_value={"found": True, "screenX": 120, "screenY": 240},
    ) as mock_run_js, patch("social_flow.chrome_publish.subprocess.run") as mock_subprocess_run:
        assert publisher._focus_linkedin_editor_with_real_click(3, 7)

    mock_activate_tab.assert_called_once_with(3, 7)
    mock_run_js.assert_called_once_with(
        _build_linkedin_editor_click_point_javascript(),
        window_index=3,
        tab_index=7,
    )
    mock_subprocess_run.assert_called_once()


def test_click_linkedin_post_real_click_targets_selected_tab() -> None:
    publisher = ChromePublisher(
        ChromeLaunchConfig(
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            user_data_dir="/tmp/social-flow-test",
            profile_directory="Profile 2",
        )
    )

    with patch("social_flow.chrome_publish._command_exists", return_value=True), patch.object(
        publisher,
        "_activate_chrome_tab",
    ) as mock_activate_tab, patch.object(
        publisher,
        "_run_chrome_javascript",
        return_value={"found": True, "screenX": 180, "screenY": 280},
    ) as mock_run_js, patch("social_flow.chrome_publish.subprocess.run") as mock_subprocess_run:
        assert publisher._click_linkedin_post_with_real_click(4, 9)

    mock_activate_tab.assert_called_once_with(4, 9)
    mock_run_js.assert_called_once_with(
        _build_linkedin_post_click_point_javascript(),
        window_index=4,
        tab_index=9,
    )
    mock_subprocess_run.assert_called_once()


def test_open_linkedin_compose_javascript_click_targets_selected_tab() -> None:
    publisher = ChromePublisher(
        ChromeLaunchConfig(
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            user_data_dir="/tmp/social-flow-test",
            profile_directory="Profile 2",
        )
    )

    with patch.object(
        publisher,
        "_run_chrome_javascript",
        return_value={"clicked": True},
    ) as mock_run_js:
        assert publisher._open_linkedin_compose_with_javascript_click(5, 11)

    mock_run_js.assert_called_once_with(
        _build_linkedin_compose_dom_click_javascript(),
        window_index=5,
        tab_index=11,
    )
