#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'https://heavy-chain.zeabur.app');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/mass-market-qa-${dateStamp()}`;
const imagePath = args.image || process.env.HEAVY_CHAIN_QA_IMAGE || '/Users/nichikatanaka/Downloads/S__4235312(1).jpg';
const mockFunctions = args.mockFunctions === 'true' || args.mockFunctions === true || process.env.HEAVY_CHAIN_QA_MOCK_FUNCTIONS === 'true';
const browserPath = args.browserPath || 'in-app Browser unavailable: iab; Playwright recordVideo fallback';

const desktopViewport = { width: 1440, height: 1050 };
const mobileViewport = { width: 390, height: 844 };

const routeSpecs = [
  { key: 'dashboard', path: '/dashboard', expected: ['DASHBOARD', '制作ワークフロー'] },
  { key: 'lightchain', path: '/lightchain', expected: ['Lightchain互換'], upload: true },
  { key: 'generate-home', path: '/generate', expected: ['Lightchain'] },
  { key: 'generate-campaign', path: '/generate?feature=campaign-image', expected: ['キャンペーン画像'], upload: true, generateReady: true },
  { key: 'marketing', path: '/marketing', expected: ['マーケティング'], upload: true },
  { key: 'fitting', path: '/fitting', expected: ['AIフィッティング'], upload: true },
  { key: 'studio', path: '/studio', expected: ['Fashion Studio'], upload: true },
  { key: 'models', path: '/models', expected: ['モデル'], upload: true },
  { key: 'patterns', path: '/patterns', expected: ['柄'], upload: true },
  { key: 'video', path: '/video', expected: ['動画'], upload: true },
  { key: 'lab', path: '/lab', expected: ['Lab'], upload: true },
  { key: 'jobs', path: '/jobs', expected: ['制作キュー'], jobsToggle: true },
  { key: 'history', path: '/history', expected: ['生成履歴'] },
  { key: 'gallery', path: '/gallery', expected: ['ギャラリー'], galleryDetail: true },
  { key: 'canvas', path: '/canvas/new', expected: ['画像を置く', 'Galleryから追加'], upload: true, canvasGallery: true, minBodyLength: 40 },
  { key: 'brand-settings', path: '/brand/settings', expected: ['ブランド'] },
  { key: 'credits', path: '/credits', expected: ['利用状況'] },
];

const mobileSpecs = [
  'dashboard',
  'generate-campaign',
  'lightchain',
  'marketing',
  'fitting',
  'jobs',
  'history',
  'gallery',
  'canvas',
];

const evidence = {
  workflow: 'mass-market-user-journey-qa',
  capturedAt: new Date().toISOString(),
  baseUrl,
  authState: authStatePath,
  imagePath,
  outDir,
  browserPath,
  mockFunctions,
  irreversibleActions: {
    generationSubmit: 'not_clicked',
    purchasePaymentCheckout: 'not_touched',
    externalPublish: 'not_touched',
    destructiveDelete: 'not_touched',
  },
  routeCount: routeSpecs.length,
  routes: [],
  mobile: [],
  consoleMessages: [],
  pageErrors: [],
  requestFailures: [],
  cleanup: {
    localStorageMutationsOnly: true,
    serverRowsCreated: false,
    contextClosed: false,
    browserClosed: false,
  },
};

fs.mkdirSync(outDir, { recursive: true });

if (!fs.existsSync(authStatePath)) {
  failEarly(`auth_state_missing:${authStatePath}`);
}
if (!fs.existsSync(imagePath)) {
  failEarly(`qa_image_missing:${imagePath}`);
}

const browser = await chromium.launch({ headless: true });
let context;

try {
  const storageState = buildStorageStateForBaseUrl(authStatePath, baseUrl);
  context = await browser.newContext({
    storageState,
    viewport: desktopViewport,
    recordVideo: {
      dir: path.join(outDir, 'videos'),
      size: desktopViewport,
    },
  });
  await installSafeMocks(context);

  for (const spec of routeSpecs) {
    evidence.routes.push(await runRoute(spec, context, desktopViewport));
  }

  for (const key of mobileSpecs) {
    const spec = routeSpecs.find((item) => item.key === key);
    if (spec) {
      evidence.mobile.push(await runRoute({ ...spec, key: `mobile-${spec.key}`, mobile: true }, context, mobileViewport));
    }
  }
} finally {
  if (context) {
    await withTimeout(context.close(), 10000, 'context_close_timeout')
      .then(() => {
        evidence.cleanup.contextClosed = true;
      })
      .catch((error) => {
        evidence.cleanup.contextClosed = false;
        evidence.cleanup.closeBlocker = error.message;
      });
  }
  await withTimeout(browser.close(), 10000, 'browser_close_timeout')
    .then(() => {
      evidence.cleanup.browserClosed = true;
    })
    .catch((error) => {
      evidence.cleanup.browserClosed = false;
      evidence.cleanup.browserCloseBlocker = error.message;
    });
}

evidence.ok = computeOk(evidence);
evidence.failed = collectFailures(evidence);
const summaryPath = path.join(outDir, 'SUMMARY.json');
fs.writeFileSync(summaryPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: evidence.ok, summaryPath, failed: evidence.failed }, null, 2));
process.exit(evidence.ok ? 0 : 1);

async function runRoute(spec, context, viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  const routeEvidence = {
    key: spec.key,
    path: spec.path,
    viewport,
    url: null,
    title: null,
    expected: spec.expected,
    screenshot: null,
    video: null,
    domExcerpt: null,
    assertions: [],
    interactions: [],
    exactBlocker: null,
  };

  page.on('console', (message) => recordConsole(message, spec.key));
  page.on('pageerror', (error) => evidence.pageErrors.push({ route: spec.key, message: error.message }));
  page.on('requestfailed', (request) => recordRequestFailure(request, spec.key));

  try {
    await page.goto(`${baseUrl}${spec.path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    await page.waitForFunction(() => !document.body.innerText.includes('読み込み中...'), null, { timeout: 15000 }).catch(() => undefined);
    await dismissBlockingGuides(page, routeEvidence);
    routeEvidence.url = page.url();
    routeEvidence.title = await page.title();
    const body = await bodyText(page);
    routeEvidence.domExcerpt = body.slice(0, 1400);
    addAssertion(routeEvidence, 'meaningful_page_content', body.trim().length > (spec.minBodyLength ?? 80) && !isLoginBody(body), {
      bodyLength: body.trim().length,
      minBodyLength: spec.minBodyLength ?? 80,
    });
    addAssertion(routeEvidence, 'expected_text_visible', spec.expected.every((text) => body.includes(text)), {
      expected: spec.expected,
    });
    addAssertion(routeEvidence, 'no_framework_overlay', !hasFrameworkOverlay(body));
    addAssertion(routeEvidence, 'no_horizontal_overflow', await hasNoHorizontalOverflow(page));
    if (spec.key === 'gallery' || spec.key === 'mobile-gallery') {
      addAssertion(routeEvidence, 'gallery_no_scary_remote_failure_toast', !body.includes('画像の読み込みに失敗しました'), {
        toastTextVisible: body.includes('画像の読み込みに失敗しました'),
      });
    }
    if (spec.key === 'credits') {
      const workspacePanelVisible = await page.locator('[data-testid="credits-workspace-panel"]').isVisible().catch(() => false);
      const nextActionsVisible = await page.locator('[data-testid="credits-next-actions"]').isVisible().catch(() => false);
      const nextActionLinks = await page
        .locator('[data-testid="credits-next-actions"] a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
        .catch(() => []);
      addAssertion(routeEvidence, 'credits_has_actionable_workspace_panel', workspacePanelVisible && nextActionsVisible && nextActionLinks.includes('/generate') && nextActionLinks.includes('/jobs'), {
        workspacePanelVisible,
        nextActionsVisible,
        nextActionLinks,
      });
    }
    if (spec.key === 'history' || spec.key === 'mobile-history') {
      const actionPanelVisible = await page.locator('[data-testid="history-action-panel"]').isVisible().catch(() => false);
      const timelinePanelVisible = await page.locator('[data-testid="history-timeline-panel"]').isVisible().catch(() => false);
      const actionLinks = await page
        .locator('[data-testid="history-action-panel"] a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
        .catch(() => []);
      addAssertion(routeEvidence, 'history_has_reuse_action_panel', actionPanelVisible && timelinePanelVisible && actionLinks.includes('/gallery') && actionLinks.length >= 3, {
        actionPanelVisible,
        timelinePanelVisible,
        actionLinks,
      });
      if (spec.key === 'history') {
        const visibleTimelineCount = await page
          .locator('[data-testid="activity-timeline-item"]')
          .evaluateAll((items) =>
            items.filter((item) => {
              const style = window.getComputedStyle(item);
              const rect = item.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            }).length,
          )
          .catch(() => 0);
        const showAllVisible = await page.locator('[data-testid="desktop-history-show-all"]').isVisible().catch(() => false);
        addAssertion(routeEvidence, 'desktop_history_timeline_is_bounded', visibleTimelineCount <= 12 && (showAllVisible || visibleTimelineCount < 12), {
          visibleTimelineCount,
          showAllVisible,
        });
      }
      if (spec.key === 'mobile-history') {
        const visibleTimelineCount = await page
          .locator('[data-testid="activity-timeline-item"]')
          .evaluateAll((items) =>
            items.filter((item) => {
              const style = window.getComputedStyle(item);
              const rect = item.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            }).length,
          )
          .catch(() => 0);
        const showAllVisible = await page.locator('[data-testid="mobile-history-show-all"]').isVisible().catch(() => false);
        addAssertion(routeEvidence, 'mobile_history_timeline_is_bounded', visibleTimelineCount <= 8 && (showAllVisible || visibleTimelineCount < 8), {
          visibleTimelineCount,
          showAllVisible,
        });
      }
    }
    if (spec.key === 'brand-settings') {
      const readinessPanelVisible = await page
        .locator('[data-testid="brand-settings-readiness-panel"]')
        .isVisible()
        .catch(() => false);
      const readinessItemCount = await page
        .locator('[data-testid="brand-settings-readiness-item"]')
        .count()
        .catch(() => 0);
      const nextActionLinks = await page
        .locator('[data-testid="brand-settings-next-actions"] a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
        .catch(() => []);
      addAssertion(
        routeEvidence,
        'brand_settings_has_readiness_and_safe_next_actions',
        readinessPanelVisible &&
          readinessItemCount >= 4 &&
          nextActionLinks.includes('/generate?feature=campaign-image') &&
          nextActionLinks.includes('/gallery') &&
          nextActionLinks.includes('/credits') &&
          !nextActionLinks.some((href) => href && /checkout|payment|billing\/checkout/.test(href)),
        {
          readinessPanelVisible,
          readinessItemCount,
          nextActionLinks,
        },
      );
    }
    if (spec.key === 'models') {
      const actionPanelVisible = await page
        .locator('[data-testid="model-library-action-panel"]')
        .isVisible()
        .catch(() => false);
      const readinessItemCount = await page
        .locator('[data-testid="model-library-readiness-item"]')
        .count()
        .catch(() => 0);
      const nextActionLinks = await page
        .locator('[data-testid="model-library-next-actions"] a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
        .catch(() => []);
      addAssertion(
        routeEvidence,
        'model_library_has_clear_generation_flow',
        actionPanelVisible &&
          readinessItemCount >= 3 &&
          nextActionLinks.some((href) => href?.startsWith('/generate?feature=model-matrix')) &&
          nextActionLinks.includes('/gallery') &&
          !nextActionLinks.some((href) => href && /checkout|payment|billing\/checkout/.test(href)),
        {
          actionPanelVisible,
          readinessItemCount,
          nextActionLinks,
        },
      );
    }
    if (spec.key === 'patterns') {
      const actionPanelVisible = await page
        .locator('[data-testid="pattern-action-panel"]')
        .isVisible()
        .catch(() => false);
      const readinessItemCount = await page
        .locator('[data-testid="pattern-readiness-item"]')
        .count()
        .catch(() => 0);
      const nextActionLinks = await page
        .locator('[data-testid="pattern-next-actions"] a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
        .catch(() => []);
      const previewSources = await page
        .locator('[data-testid="pattern-preview-image"]')
        .evaluateAll((images) => images.map((image) => image.getAttribute('src') || ''))
        .catch(() => []);
      addAssertion(
        routeEvidence,
        'pattern_workspace_has_clear_generation_flow',
        actionPanelVisible &&
          readinessItemCount >= 3 &&
          nextActionLinks.some((href) => href?.startsWith('/generate?feature=design-gacha')) &&
          nextActionLinks.includes('/gallery') &&
          !nextActionLinks.some((href) => href && /checkout|payment|billing\/checkout/.test(href)),
        {
          actionPanelVisible,
          readinessItemCount,
          nextActionLinks,
        },
      );
      addAssertion(
        routeEvidence,
        'pattern_preview_uses_garment_mockup_context',
        previewSources.length >= 3 &&
          previewSources.every((src) => src.includes('GARMENT%20MOCKUP') && src.includes('placement%3A')),
        {
          previewCount: previewSources.length,
          garmentMockupPreviewCount: previewSources.filter((src) => src.includes('GARMENT%20MOCKUP')).length,
          placementPreviewCount: previewSources.filter((src) => src.includes('placement%3A')).length,
        },
      );
    }
    if (spec.key === 'video') {
      const actionPanelVisible = await page
        .locator('[data-testid="video-action-panel"]')
        .isVisible()
        .catch(() => false);
      const readinessItemCount = await page
        .locator('[data-testid="video-readiness-item"]')
        .count()
        .catch(() => 0);
      const nextActionLinks = await page
        .locator('[data-testid="video-next-actions"] a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
        .catch(() => []);
      const previewSource = await page
        .locator('[data-testid="video-storyboard-preview-image"]')
        .first()
        .getAttribute('src')
        .catch(() => '');
      addAssertion(
        routeEvidence,
        'video_workspace_has_clear_generation_flow',
        actionPanelVisible &&
          readinessItemCount >= 3 &&
          nextActionLinks.some((href) => href?.startsWith('/generate?feature=campaign-image')) &&
          nextActionLinks.includes('/gallery') &&
          !nextActionLinks.some((href) => href && /checkout|payment|billing\/checkout/.test(href)),
        {
          actionPanelVisible,
          readinessItemCount,
          nextActionLinks,
        },
      );
      addAssertion(
        routeEvidence,
        'video_storyboard_preview_has_shot_context',
        Boolean(previewSource) &&
          previewSource.includes('video-storyboard-local-v1') &&
          previewSource.includes('selected-video-storyboard') &&
          previewSource.includes('motionSignature%3A') &&
          previewSource.includes('framingSignature%3A'),
        {
          hasPreviewSource: Boolean(previewSource),
          hasWorkflowMarker: previewSource?.includes('video-storyboard-local-v1') ?? false,
          hasSelectedStoryboard: previewSource?.includes('selected-video-storyboard') ?? false,
          hasMotionSignature: previewSource?.includes('motionSignature%3A') ?? false,
          hasFramingSignature: previewSource?.includes('framingSignature%3A') ?? false,
        },
      );
    }
    if (spec.mobile) {
      const intrusiveFixedButtons = await visibleIntrusiveFixedButtons(page);
      addAssertion(routeEvidence, 'mobile_no_intrusive_floating_help_buttons', intrusiveFixedButtons.length === 0, {
        intrusiveFixedButtons,
      });
      if (spec.key === 'mobile-generate-campaign') {
        const toolbarVisible = await page.locator('[data-testid="lightchain-canvas-toolbar"]').isVisible().catch(() => false);
        const assistantPromptBarVisible = await page
          .locator('[data-testid="mobile-generate-assistant-prompt-bar"]')
          .isVisible()
          .catch(() => false);
        const projectPanelVisible = await page.locator('[data-testid="lightchain-project-panel"]').isVisible().catch(() => false);
        const inputMaterialPanelVisible = await page
          .locator('[data-testid="lightchain-input-material-panel"]')
          .isVisible()
          .catch(() => false);
        addAssertion(routeEvidence, 'mobile_generate_hides_canvas_toolbar', !toolbarVisible, {
          toolbarVisible,
        });
        addAssertion(
          routeEvidence,
          'mobile_generate_starts_at_material_form',
          !assistantPromptBarVisible && !projectPanelVisible && inputMaterialPanelVisible,
          {
            assistantPromptBarVisible,
            projectPanelVisible,
            inputMaterialPanelVisible,
          },
        );
      }
      if (spec.key === 'mobile-dashboard') {
        const quickStart = page.locator('[data-testid="mobile-dashboard-quick-start"]');
        const quickStartVisible = await quickStart.isVisible().catch(() => false);
        const desktopQuickActionsVisible = await page
          .locator('[data-testid="dashboard-desktop-quick-actions"]')
          .isVisible()
          .catch(() => false);
        const dashboardLightchainVisibleFeatureCount = await page
          .locator('[data-testid="dashboard-lightchain-feature-list"] > button')
          .evaluateAll((buttons) =>
            buttons.filter((button) => {
              const style = window.getComputedStyle(button);
              const rect = button.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            }).length,
          )
          .catch(() => 0);
        const allToolsLinkVisible = await page
          .locator('[data-testid="dashboard-lightchain-all-tools-link"]')
          .isVisible()
          .catch(() => false);
        const allToolsHref = await page
          .locator('[data-testid="dashboard-lightchain-all-tools-link"]')
          .getAttribute('href')
          .catch(() => null);
        const activitySummaryVisible = await page
          .locator('[data-testid="mobile-dashboard-activity-summary"]')
          .isVisible()
          .catch(() => false);
        const activityDetailVisible = await page
          .locator('[data-testid="dashboard-workspace-activity-detail"]')
          .isVisible()
          .catch(() => false);
        const activityDetailHref = await page
          .locator('[data-testid="mobile-dashboard-activity-detail-link"]')
          .getAttribute('href')
          .catch(() => null);
        const nextActionVisible = await page
          .locator('[data-testid="mobile-dashboard-next-action"]')
          .isVisible()
          .catch(() => false);
        const nextActionPrimaryHref = await page
          .locator('[data-testid="mobile-dashboard-next-action"] a[href="/generate?feature=campaign-image"]')
          .getAttribute('href')
          .catch(() => null);
        const managementLinks = await page
          .locator('[data-testid="mobile-dashboard-management-links"] a')
          .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
          .catch(() => []);
        const lowPriorityDesktopPanelsVisible = await page
          .locator([
            '[data-testid="dashboard-desktop-workflows"]',
            '[data-testid="dashboard-desktop-projects"]',
            '[data-testid="dashboard-desktop-recent-images"]',
            '[data-testid="dashboard-desktop-usage"]',
          ].join(', '))
          .evaluateAll((panels) => panels.some((panel) => {
            const style = window.getComputedStyle(panel);
            const rect = panel.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          }))
          .catch(() => true);
        const quickStartLinks = await quickStart.locator('a').evaluateAll((links) =>
          links.map((link) => ({
            text: link.textContent?.replace(/\s+/g, ' ').trim(),
            href: link.getAttribute('href'),
          })),
        ).catch(() => []);
        addAssertion(routeEvidence, 'mobile_dashboard_has_above_fold_quick_start', (
          quickStartVisible &&
          quickStartLinks.length >= 3 &&
          quickStartLinks.some((link) => link.href === '/generate') &&
          quickStartLinks.some((link) => link.href === '/canvas/new') &&
          quickStartLinks.some((link) => link.href === '/gallery')
        ), {
          quickStartVisible,
          quickStartLinks,
        });
        addAssertion(routeEvidence, 'mobile_dashboard_hides_duplicate_quick_action_cards', !desktopQuickActionsVisible, {
          desktopQuickActionsVisible,
        });
        addAssertion(
          routeEvidence,
          'mobile_dashboard_lightchain_has_all_tools_link',
          dashboardLightchainVisibleFeatureCount > 0 &&
            dashboardLightchainVisibleFeatureCount <= 4 &&
            allToolsLinkVisible &&
            allToolsHref === '/lightchain',
          {
            dashboardLightchainVisibleFeatureCount,
            allToolsLinkVisible,
            allToolsHref,
          },
        );
        addAssertion(
          routeEvidence,
          'mobile_dashboard_activity_uses_compact_summary',
          activitySummaryVisible && !activityDetailVisible && activityDetailHref === '/jobs',
          {
            activitySummaryVisible,
            activityDetailVisible,
            activityDetailHref,
          },
        );
        addAssertion(
          routeEvidence,
          'mobile_dashboard_has_single_primary_next_action',
          nextActionVisible &&
            nextActionPrimaryHref === '/generate?feature=campaign-image' &&
            managementLinks.includes('/history') &&
            managementLinks.includes('/canvas') &&
            managementLinks.includes('/credits'),
          {
            nextActionVisible,
            nextActionPrimaryHref,
            managementLinks,
          },
        );
        addAssertion(
          routeEvidence,
          'mobile_dashboard_hides_low_priority_desktop_panels',
          !lowPriorityDesktopPanelsVisible,
          {
            lowPriorityDesktopPanelsVisible,
          },
        );
      }
      if (spec.key === 'mobile-jobs') {
        const visibleJobCount = await page
          .locator('[data-testid="jobs-list-item"]')
          .evaluateAll((items) =>
            items.filter((item) => {
              const style = window.getComputedStyle(item);
              const rect = item.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            }).length,
          )
          .catch(() => 0);
        const showAllVisible = await page.locator('[data-testid="mobile-jobs-show-all"]').isVisible().catch(() => false);
        addAssertion(routeEvidence, 'mobile_jobs_initial_list_is_bounded', visibleJobCount <= 5 && (showAllVisible || visibleJobCount < 5), {
          visibleJobCount,
          showAllVisible,
        });
      }
      if (spec.key === 'mobile-lightchain') {
        const visibleToolCount = await page
          .locator('[data-testid="lightchain-tool-card"]')
          .evaluateAll((items) =>
            items.filter((item) => {
              const style = window.getComputedStyle(item);
              const rect = item.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            }).length,
          )
          .catch(() => 0);
        const showAllVisible = await page.locator('[data-testid="mobile-lightchain-show-all-tools"]').isVisible().catch(() => false);
        addAssertion(routeEvidence, 'mobile_lightchain_tool_list_is_bounded', visibleToolCount <= 6 && showAllVisible, {
          visibleToolCount,
          showAllVisible,
        });
      }
      if (spec.key === 'mobile-canvas') {
        await page.waitForTimeout(350);
        const mobileCanvasFit = await readMobileCanvasFit(page);
        addAssertion(routeEvidence, 'mobile_canvas_content_fits_initial_view', mobileCanvasFit.passed, mobileCanvasFit);
      }
    }
    if (spec.generateReady) {
      const visibleButtons = await visibleButtonTexts(page);
      addAssertion(routeEvidence, 'upload_first_generation_screen_hides_advanced_controls', (
        body.includes('素材を置くと編集を始められます') &&
        !visibleButtons.some((text) => /AIマスク認識|抽出|Canvasに注文票を保存/.test(text)) &&
        !body.includes('Canvas保存時の構造')
      ), {
        visibleButtons,
        bodyExcerpt: body.slice(0, 1200),
      });
    }

    routeEvidence.screenshot = await screenshot(page, `${spec.key}.png`);

    if (spec.upload) {
      await interactUpload(page, routeEvidence);
    }
    if (spec.generateReady) {
      await interactGenerateReady(page, routeEvidence);
    }
    if (spec.jobsToggle) {
      await interactJobsToggle(page, routeEvidence);
    }
    if (spec.galleryDetail) {
      await interactGalleryDetail(page, routeEvidence);
    }
    if (spec.canvasGallery) {
      await interactCanvasGallery(page, routeEvidence);
    }
  } catch (error) {
    routeEvidence.exactBlocker = `route_exception:${error.message}`;
    addAssertion(routeEvidence, 'route_exception_free', false, { error: error.message });
  } finally {
    routeEvidence.video = await closePageAndGetVideo(page);
  }

  return routeEvidence;
}

async function interactUpload(page, routeEvidence) {
  const upload = page.locator('input[accept="image/*"]').first();
  const count = await upload.count();
  if (!count) {
    routeEvidence.interactions.push({ type: 'upload-image', skipped: 'no_image_input' });
    addAssertion(routeEvidence, 'upload_input_visible', false, { reason: 'no_image_input' });
    return;
  }
  addAssertion(routeEvidence, 'upload_input_visible', true);
  const previewSelector = 'img[src^="blob:"], img[src^="data:"], img[alt*="preview" i], img[alt*="プレビュー"]';
  const previewCountBefore = await page.locator(previewSelector).count().catch(() => 0);
  const canvasObjectCountBefore = await readCanvasObjectCount(page);
  await upload.setInputFiles(imagePath);
  await page.waitForTimeout(500);
  const body = await bodyText(page);
  const selectedFile = await upload.evaluate((input) => input.files?.[0]?.name || null).catch(() => null);
  const previewCountAfter = await page.locator(previewSelector).count().catch(() => 0);
  const canvasObjectCountAfter = await readCanvasObjectCount(page);
  const stateTextReflected = /読込済み|素材認識済み|アップロード済み|選択済み|プレビュー|S__4235312/.test(body);
  const canvasObjectReflected = routeEvidence.key.includes('canvas') && canvasObjectCountAfter > canvasObjectCountBefore;
  const reflected = Boolean(selectedFile) && (stateTextReflected || previewCountAfter > previewCountBefore || canvasObjectReflected);
  routeEvidence.interactions.push({
    type: 'upload-image',
    reflected,
    selectedFile,
    previewCountBefore,
    previewCountAfter,
    canvasObjectCountBefore,
    canvasObjectCountAfter,
    canvasObjectReflected,
    stateTextReflected,
  });
  addAssertion(routeEvidence, 'upload_reflected_in_ui', reflected, {
    selectedFile,
    previewCountBefore,
    previewCountAfter,
    canvasObjectCountBefore,
    canvasObjectCountAfter,
    canvasObjectReflected,
    stateTextReflected,
  });
  routeEvidence.uploadScreenshot = await screenshot(page, `${routeEvidence.key}-uploaded.png`);
}

async function interactGenerateReady(page, routeEvidence) {
  await page.getByPlaceholder(/夏のサマーセール/).fill('Mass-market QA: uploaded apparel reference should drive campaign output.').catch(() => undefined);
  await page.getByPlaceholder(/SUMMER SALE/).fill('MASS MARKET QA').catch(() => undefined);
  await page.getByPlaceholder(/最大50% OFF/).fill('Visual workflow proof').catch(() => undefined);
  const rightsCheckbox = page.getByRole('checkbox').first();
  const rightsCheckboxVisible = await rightsCheckbox.isVisible().catch(() => false);
  if (rightsCheckboxVisible) {
    await rightsCheckbox.check().catch(() => undefined);
  }
  const body = await bodyText(page);
  const button = page.getByRole('button', { name: /Runway workerで生成/ }).first();
  const visible = await button.isVisible().catch(() => false);
  const enabled = await button.isEnabled().catch(() => false);
  const h601CopyVisible = /権利・許可|商用デザイン制作|商標クリアランス/.test(body);
  routeEvidence.interactions.push({
    type: 'generate-ready-no-submit',
    visible,
    enabled,
    rightsCheckboxVisible,
    h601CopyVisible,
  });
  addAssertion(routeEvidence, 'h601_rights_confirmation_visible', rightsCheckboxVisible && h601CopyVisible, {
    rightsCheckboxVisible,
    h601CopyVisible,
  });
  addAssertion(routeEvidence, 'generate_button_ready_without_submit', visible && enabled);
}

async function interactJobsToggle(page, routeEvidence) {
  const button = page.getByRole('button', { name: /要確認 .*件を表示|失敗を隠す/ }).first();
  const present = await button.count().then(Boolean);
  routeEvidence.interactions.push({ type: 'jobs-failed-toggle-present', present });
  if (!present) return;
  await button.click();
  await page.waitForTimeout(500);
  const body = await bodyText(page);
  const expanded = /失敗を隠す|入力を直して再開|Runway承認状態|workerとRunway/.test(body);
  routeEvidence.interactions.push({ type: 'jobs-failed-toggle-expanded', expanded });
  addAssertion(routeEvidence, 'jobs_failed_toggle_expands', expanded);
}

async function interactGalleryDetail(page, routeEvidence) {
  const detail = page.getByText('詳細を見る').first();
  const present = await detail.count().then(Boolean);
  routeEvidence.interactions.push({ type: 'gallery-detail-present', present });
  if (!present) return;
  await detail.click();
  await page.waitForTimeout(700);
  const body = await bodyText(page);
  const detailOpen = /PNG|JPEG|WebP|共有リンク|お気に入り|Canvas/.test(body);
  routeEvidence.interactions.push({ type: 'gallery-detail-opened', detailOpen });
  addAssertion(routeEvidence, 'gallery_detail_actions_visible', detailOpen);
  routeEvidence.detailScreenshot = await screenshot(page, `${routeEvidence.key}-detail.png`);
}

async function interactCanvasGallery(page, routeEvidence) {
  await dismissBlockingGuides(page, routeEvidence);
  const button = page.getByRole('button', { name: /Galleryから追加/ }).first();
  const present = await button.count().then(Boolean);
  routeEvidence.interactions.push({ type: 'canvas-gallery-button-present', present });
  if (!present) {
    addAssertion(routeEvidence, 'canvas_gallery_button_visible', false);
    return;
  }
  await button.click();
  await page.waitForTimeout(1000);
  const body = await bodyText(page);
  const selectorOpen = /Gallery|画像を選択|素材|追加|検索/.test(body);
  routeEvidence.interactions.push({ type: 'canvas-gallery-selector-opened', selectorOpen });
  addAssertion(routeEvidence, 'canvas_gallery_selector_opens', selectorOpen);
  routeEvidence.gallerySelectorScreenshot = await screenshot(page, `${routeEvidence.key}-gallery-selector.png`);
}

async function dismissBlockingGuides(page, routeEvidence) {
  const skip = page.getByRole('button', { name: /^スキップ$/ }).first();
  const visible = await skip.isVisible().catch(() => false);
  if (!visible) return;
  await skip.click();
  await page.waitForTimeout(400);
  routeEvidence.interactions.push({ type: 'dismiss-guide', label: 'スキップ' });
}

async function visibleButtonTexts(page) {
  return page.getByRole('button').evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      })
      .map((button) => button.textContent?.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );
}

async function visibleIntrusiveFixedButtons(page) {
  return page.evaluate(() => {
    const labels = ['キーボードショートカットを表示', 'フィードバックを送信'];
    return labels.flatMap((label) => {
      const element = document.querySelector(`button[aria-label="${label}"]`);
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      return visible ? [{ label, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }] : [];
    });
  }).catch(() => []);
}

async function installSafeMocks(context) {
  if (!mockFunctions) return;
  await context.route('**/functions/v1/generate-image', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'mock-mass-market-job', status: 'pending' }, message: 'mocked by verify-mass-market-qa' }),
    });
  });
  await context.route('**/functions/v1/marketing-workspace-artifact', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, artifact: { id: 'mock-marketing-artifact' } }),
    });
  });
}

function buildStorageStateForBaseUrl(filePath, targetBaseUrl) {
  const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const targetOrigin = new URL(targetBaseUrl).origin;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(targetOrigin)) {
    const prodOrigin = state.origins?.find((origin) => origin.origin === 'https://heavy-chain.zeabur.app')
      ?? state.origins?.[0];
    if (prodOrigin?.localStorage) {
      state.origins = [
        ...(state.origins ?? []).filter((origin) => origin.origin !== targetOrigin),
        { origin: targetOrigin, localStorage: prodOrigin.localStorage },
      ];
    }
  }
  return state;
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 8000 }).catch(() => '');
}

async function readCanvasObjectCount(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('heavy-chain-canvas');
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    const objects = parsed?.state?.objects;
    return Array.isArray(objects) ? objects.length : 0;
  }).catch(() => 0);
}

async function readMobileCanvasFit(page) {
  return page.evaluate(() => {
    const proofElement = document.querySelector('[data-testid="mobile-canvas-fit-proof"]');
    const proofPayload = proofElement?.getAttribute('data-proof');
    if (proofPayload) return JSON.parse(proofPayload);

    const raw = window.localStorage.getItem('heavy-chain-canvas');
    if (!raw) return { passed: true, reason: 'empty_canvas_state' };
    const parsed = JSON.parse(raw);
    const state = parsed?.state ?? {};
    const objects = Array.isArray(state.objects) ? state.objects.filter((obj) => obj?.visible !== false) : [];
    if (objects.length === 0) return { passed: true, reason: 'no_visible_objects' };

    const zoom = Number.isFinite(state.zoom) ? state.zoom : 1;
    const panX = Number.isFinite(state.panX) ? state.panX : 0;
    const panY = Number.isFinite(state.panY) ? state.panY : 0;
    const bounds = objects.reduce((acc, obj) => {
      const width = Math.max(1, Number(obj.width || 0) * Number(obj.scaleX || 1));
      const height = Math.max(1, Number(obj.height || 0) * Number(obj.scaleY || 1));
      const x = Number(obj.x || 0);
      const y = Number(obj.y || 0);
      return {
        minX: Math.min(acc.minX, x),
        minY: Math.min(acc.minY, y),
        maxX: Math.max(acc.maxX, x + width),
        maxY: Math.max(acc.maxY, y + height),
      };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

    const screenBounds = {
      left: bounds.minX * zoom + panX,
      top: bounds.minY * zoom + panY,
      right: bounds.maxX * zoom + panX,
      bottom: bounds.maxY * zoom + panY,
    };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const allowed = { left: 8, top: 52, right: viewport.width - 8, bottom: viewport.height - 92 };
    const passed =
      screenBounds.left >= allowed.left &&
      screenBounds.top >= allowed.top &&
      screenBounds.right <= allowed.right &&
      screenBounds.bottom <= allowed.bottom;

    return { passed, zoom, panX, panY, bounds, screenBounds, viewport, allowed, objectCount: objects.length };
  }).catch((error) => ({ passed: false, reason: error.message }));
}

async function hasNoHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2).catch(() => false);
}

async function screenshot(page, fileName) {
  const filePath = path.join(outDir, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function closePageAndGetVideo(page) {
  const video = page.video();
  await withTimeout(page.close(), 8000, 'page_close_timeout').catch(() => undefined);
  if (!video) return null;
  return withTimeout(video.path(), 8000, 'video_path_timeout').catch(() => null);
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function addAssertion(routeEvidence, name, passed, details = {}) {
  routeEvidence.assertions.push({ name, passed: Boolean(passed), details });
  if (!passed && !routeEvidence.exactBlocker) {
    routeEvidence.exactBlocker = name;
  }
}

function recordConsole(message, route) {
  if (!['error', 'warning'].includes(message.type())) return;
  evidence.consoleMessages.push({ route, type: message.type(), text: message.text() });
}

function recordRequestFailure(request, route) {
  const url = request.url();
  if (url.includes('favicon')) return;
  const failureText = request.failure()?.errorText ?? null;
  if (failureText === 'net::ERR_ABORTED' && url.includes('/storage/v1/object/sign/')) return;
  evidence.requestFailures.push({ route, url, failure: failureText });
}

function computeOk(result) {
  const allRoutes = [...result.routes, ...result.mobile];
  return result.routes.every((route) => route.assertions.every((assertion) => assertion.passed))
    && result.mobile.every((route) => route.assertions.every((assertion) => assertion.passed))
    && allRoutes.every((route) => Boolean(route.video))
    && result.cleanup.contextClosed === true
    && result.cleanup.browserClosed === true
    && !result.cleanup.closeBlocker
    && !result.cleanup.browserCloseBlocker
    && result.consoleMessages.length === 0
    && result.pageErrors.length === 0
    && result.requestFailures.length === 0;
}

function collectFailures(result) {
  const allRoutes = [...result.routes, ...result.mobile];
  const routeFailures = allRoutes
    .flatMap((route) => route.assertions
      .filter((assertion) => !assertion.passed)
      .map((assertion) => `${route.key}:${assertion.name}`));
  return [
    ...routeFailures,
    ...allRoutes.filter((route) => !route.video).map((route) => `${route.key}:video_missing`),
    ...(result.cleanup.contextClosed ? [] : ['cleanup:context_close_failed']),
    ...(result.cleanup.browserClosed ? [] : ['cleanup:browser_close_failed']),
    ...(result.cleanup.closeBlocker ? [`cleanup:${result.cleanup.closeBlocker}`] : []),
    ...(result.cleanup.browserCloseBlocker ? [`cleanup:${result.cleanup.browserCloseBlocker}`] : []),
    ...result.consoleMessages.map((message) => `${message.route}:console:${message.text}`),
    ...result.pageErrors.map((error) => `${error.route}:pageerror:${error.message}`),
    ...result.requestFailures.map((failure) => `${failure.route}:requestfailed:${failure.url}`),
  ];
}

function isLoginBody(body) {
  return /アカウントにログインしてください|Googleでログイン|メールアドレス\nパスワード/.test(body);
}

function hasFrameworkOverlay(body) {
  return /Internal Server Error|Unhandled Runtime Error|ReferenceError|TypeError|Vite Error|Something went wrong/i.test(body);
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, '');
}

function dateStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function failEarly(message) {
  fs.mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, 'SUMMARY.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify({
    workflow: 'mass-market-user-journey-qa',
    capturedAt: new Date().toISOString(),
    ok: false,
    exactBlocker: message,
    baseUrl,
    authState: authStatePath,
    outDir,
  }, null, 2)}\n`);
  console.error(message);
  process.exit(1);
}
