#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';

const LOCAL_SYNTHETIC_AUTH_PATHS = new Set(['/api/auth/ok', '/api/auth/get-session']);
const LOCAL_BLOCKED_ENDPOINT_PATTERNS = [
  /\/api\/auth(?:\/|$)/iu,
  /\/v1\/(?:provider-actions|image-ai|generate|generation)(?:\/|$)/iu,
  /\/(?:publish|payment|payments|billing|identity|secret|secrets)(?:\/|$)/iu,
];
const LOCAL_SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const args = parseArgs(process.argv.slice(2));
const requestedMode = String(args.mode ?? args['verify-mode'] ?? process.env.HEAVY_CHAIN_VERIFY_MODE ?? '').trim().toLowerCase();
const requestedBaseUrl = args.baseUrl ?? args['base-url'] ?? process.env.HEAVY_CHAIN_BASE_URL ?? 'http://127.0.0.1:4183';
if (typeof requestedBaseUrl !== 'string' || requestedBaseUrl.trim() === '') throw new Error('base_url_must_be_a_non_empty_string');
const baseUrl = trimTrailingSlash(requestedBaseUrl);
const lightchainHomeRoute = '/designProduction';
const requestedAuthStatePath = args.authState ?? args['auth-state'] ?? process.env.HEAVY_CHAIN_AUTH_STATE ?? null;
const authStatePath = requestedAuthStatePath || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const requestedDistDir = args.distDir ?? args['dist-dir'] ?? process.env.HEAVY_CHAIN_VERIFY_DIST_DIR ?? null;
if (requestedDistDir !== null && (typeof requestedDistDir !== 'string' || requestedDistDir.trim() === '')) {
  throw new Error('dist_path_must_be_a_non_empty_string');
}
const distDir = path.resolve(requestedDistDir || 'dist');
const localPreview = requestedMode === 'local';
const productionMode = requestedMode === 'production';
if (!localPreview && !productionMode) {
  throw new Error('verification_mode_must_be_explicit:use_--mode=local_or_--mode=production');
}
if (localPreview) {
  assertLocalExecutionBoundary(baseUrl, requestedAuthStatePath);
} else if (isLoopbackUrl(baseUrl)) {
  throw new Error('production_mode_rejects_loopback_base_url');
}
if (args.maxFeatures !== undefined || args['max-features'] !== undefined || args.skipMobile !== undefined || args['skip-mobile'] !== undefined) {
  throw new Error('full_31_feature_desktop_mobile_coverage_cannot_be_reduced');
}
if (localPreview && requestedDistDir === null) throw new Error('local_mode_requires_isolated_dist_dir');
if (localPreview && distDir === path.resolve('dist')) throw new Error('local_mode_rejects_shared_dist_dir');
const sourceReadbackPath = path.resolve(
  args.sourceReadback
    ?? args['source-readback']
    ?? process.env.HEAVY_CHAIN_SOURCE_READBACK
    ?? 'work/lightchain-source-readback-20260920-r4.json',
);
if (!fs.existsSync(sourceReadbackPath)) throw new Error(`source_readback_missing:${sourceReadbackPath}`);
const sourceReadback = JSON.parse(fs.readFileSync(sourceReadbackPath, 'utf8'));
if (sourceReadback?.schema !== 'light-heavy-source-readback.v1') {
  throw new Error(`source_readback_schema_invalid:${sourceReadback?.schema ?? 'missing'}`);
}
const outDir = createFreshOutputDirectory(args.out);
const canvasStoreKey = 'heavy-chain-canvas';
const desktopViewport = { width: 1440, height: 1050 };
const mobileViewport = { width: 390, height: 844 };
const fittingHandoffToolIds = new Set(['ai-fitting', 'ai-fitting-reference']);
const fixturePng =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAIAAADrOSKFAAABfklEQVR4nO3VwQ2DMBQFQYp2/6mOBtYiHhSg2R+TR6VJ4FD3Yh8nAAAAAAAAAAAAAAAAAAAAAACwq3n7vQG8Lr3f93nP8xz7B2z67bLvG7BXn8z3/V6f8yP4nff4+v0G7NVd9j7f6wN4u9QzAAAAAAAAAAAAAAAAAADgT2EDAiwIsCDAggALAiysx8O+vV6vR3e73V6vV6vR6fP5/PL5fL1eL5fL5fL5fL5fK9Xq9Xq9Xq9Xq9Xq9Xq8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLw8Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Px8fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fAAAAAAAAAAAAAAAAAAAAAAD4O8EGAiwIsCDAggALAiysQw4oEJQ4AAAAAElFTkSuQmCC';

fs.mkdirSync(outDir, { recursive: true });
const uploadPath = path.join(outDir, 'all-feature-upload.png');
fs.writeFileSync(uploadPath, Buffer.from(fixturePng, 'base64'), { flag: 'wx' });

const skippedToolIds = new Set(['video-workstation', 'video-detail']);
const catalog = readLightchainCatalog();
const featureLimit = null;
const toolsToVerify = catalog.tools;
const skipMobile = false;
const evidence = {
  workflow: 'lightchain-all-feature-workflows',
  capturedAt: new Date().toISOString(),
  mode: localPreview ? 'local' : 'production',
  baseUrl,
  authState: localPreview ? 'local-proof-jwt' : authStatePath,
  build: {
    distDir,
    isolated: localPreview && requestedDistDir !== null && distDir !== path.resolve('dist'),
  },
  outDir,
  featureCount: catalog.tools.length,
  scope: {
    featureLimit,
    verifiedFeatureCount: toolsToVerify.length,
    skipMobile,
  },
  uploadPath,
  screenshots: {},
  featureResults: [],
  videoResults: [],
  assertions: [],
  consoleMessages: [],
  pageErrors: [],
  requestFailures: [],
  boundaryDecisions: [],
  sourceReadback: {
    path: sourceReadbackPath,
    schema: sourceReadback.schema,
    observedAt: sourceReadback.observedAt,
    comparison: {
      semantic: 'verified-local-against-source-contract',
      interaction: 'verified-local-against-source-contract',
      pixel: 'PENDING_CONFIRMATION',
      reason: 'Current authenticated Light Chain screenshot baseline is not supplied; Heavy screenshots must not be mislabeled as source captures.',
    },
    results: [],
  },
  cleanup: {
    contextClosed: false,
    browserClosed: false,
    previewStopped: false,
  },
};

let interruptionRequested = false;
function reportProgress(phase, details = {}) {
  const event = { at: new Date().toISOString(), phase, ...details };
  evidence.progress ??= [];
  evidence.progress.push(event);
  process.stdout.write(`[lightchain-verifier] ${JSON.stringify(event)}\n`);
}

function throwIfInterrupted() {
  if (interruptionRequested) throw new Error('verification_interrupted_by_signal');
}

process.once('SIGINT', () => {
  interruptionRequested = true;
  reportProgress('interrupt_requested', { signal: 'SIGINT' });
});

let previewProcess = null;
let browser = null;
let context = null;

try {
  reportProgress('verification_started', {
    baseUrl,
    featureCount: catalog.tools.length,
    verifiedFeatureCount: toolsToVerify.length,
    skipMobile,
  });
  if (localPreview) previewProcess = await startPreviewServer(baseUrl, distDir);
  if (!localPreview && !fs.existsSync(authStatePath)) throw new Error(`auth_state_missing:${authStatePath}`);
  addAssertion('feature_catalog_loaded', catalog.tools.length === 31, {
    count: catalog.tools.length,
    skippedToolIds: [...skippedToolIds],
    skippedCount: skippedToolIds.size,
  });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext(localPreview
    ? { viewport: desktopViewport, serviceWorkers: 'block' }
    : {
      storageState: buildStorageStateForBaseUrl(authStatePath, baseUrl),
      viewport: desktopViewport,
    });
  if (localPreview) {
    await installLocalProofAuth(context);
    await installLocalCloudflareMocks(context);
    await installLocalContextGuard(context, baseUrl);
  }

  let page = await context.newPage();
  page.setDefaultNavigationTimeout(15_000);
  page.setDefaultTimeout(15_000);
  wirePageDiagnostics(page, 'desktop');

  await page.goto(`${baseUrl}${lightchainHomeRoute}`, { waitUntil: 'networkidle' });
  await dismissBlockingOverlays(page);
  await screenshot(page, 'desktop-index');
  await verifyGenerateEntrypointUsesFeatureDetail(page);
  reportProgress('desktop_entrypoint_complete');
  await page.close();
  for (const tool of toolsToVerify) {
    throwIfInterrupted();
    reportProgress('desktop_feature_started', { featureId: tool.id, title: tool.title });
    const routePage = await context.newPage();
    routePage.setDefaultNavigationTimeout(15_000);
    routePage.setDefaultTimeout(15_000);
    wirePageDiagnostics(routePage, `desktop:${tool.id}`);
    let result;
    try {
      result = await verifyFeatureWorkflow(routePage, tool);
    } catch (error) {
      result = {
        id: tool.id,
        category: tool.category,
        title: tool.title,
        assertions: [{
          id: `${tool.id}:route_readback`,
          ok: false,
          details: { exactBlocker: error.message },
        }],
        exactBlocker: error.message,
      };
      addAssertion(`${tool.id}:route_readback`, false, { exactBlocker: error.message });
    }
    evidence.featureResults.push(result);
    reportProgress(result.exactBlocker ? 'desktop_feature_failed' : 'desktop_feature_completed', {
      featureId: tool.id,
      assertionCount: result.assertions.length,
      exactBlocker: result.exactBlocker ?? null,
    });
    await routePage.close().catch(() => {});
  }

  reportProgress('desktop_phase_complete', { verifiedFeatureCount: toolsToVerify.length });

  evidence.videoResults.push(await verifyVideoSurface(context, desktopViewport, '/flow/GenerateShortVideo', 'desktop-video-dashboard'));
  evidence.videoResults.push(await verifyVideoSurface(context, desktopViewport, '/flow/GenerateShortVideo/detail?project=new', 'desktop-video-detail'));
  reportProgress('desktop_video_phase_complete', { verifiedRouteCount: evidence.videoResults.length });

  await verifySourceRouteParity(context, desktopViewport);
  reportProgress('source_route_parity_complete', {
    verifiedRouteCount: evidence.sourceReadback.results.length,
  });

  await context.close();
  evidence.cleanup.contextClosed = true;
  context = null;
  await browser.close();
  evidence.cleanup.browserClosed = true;
  browser = null;

  if (skipMobile) {
    reportProgress('mobile_phase_skipped');
    throwIfInterrupted();
  } else {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext(localPreview
      ? { viewport: mobileViewport, serviceWorkers: 'block' }
      : {
        storageState: buildStorageStateForBaseUrl(authStatePath, baseUrl),
        viewport: mobileViewport,
      });
    if (localPreview) {
      await installLocalProofAuth(context);
      await installLocalCloudflareMocks(context);
      await installLocalContextGuard(context, baseUrl);
    }
    const mobilePage = await context.newPage();
    mobilePage.setDefaultNavigationTimeout(15_000);
    mobilePage.setDefaultTimeout(15_000);
    wirePageDiagnostics(mobilePage, 'mobile');
    await mobilePage.setViewportSize(mobileViewport);
    await mobilePage.goto(`${baseUrl}${lightchainHomeRoute}`, { waitUntil: 'networkidle' });
    await screenshot(mobilePage, 'mobile-index');
    await mobilePage.close();
    for (const tool of toolsToVerify) {
      throwIfInterrupted();
      reportProgress('mobile_feature_started', { featureId: tool.id, title: tool.title });
      const routePage = await context.newPage();
      routePage.setDefaultNavigationTimeout(15_000);
      routePage.setDefaultTimeout(15_000);
      wirePageDiagnostics(routePage, `mobile:${tool.id}`);
      await routePage.setViewportSize(mobileViewport);
      try {
        await verifyMobileFeatureScreen(routePage, tool);
      } catch (error) {
        addAssertion(`mobile_screen:${tool.id}:route_readback`, false, { exactBlocker: error.message });
      }
      reportProgress('mobile_feature_completed', { featureId: tool.id });
      await routePage.close().catch(() => {});
    }

    evidence.videoResults.push(await verifyVideoSurface(context, mobileViewport, '/flow/GenerateShortVideo', 'mobile-video-dashboard'));
    evidence.videoResults.push(await verifyVideoSurface(context, mobileViewport, '/flow/GenerateShortVideo/detail?project=new', 'mobile-video-detail'));
    reportProgress('mobile_video_phase_complete', { verifiedRouteCount: evidence.videoResults.length });

    const invalidPage = await context.newPage();
    invalidPage.setDefaultNavigationTimeout(15_000);
    invalidPage.setDefaultTimeout(15_000);
    wirePageDiagnostics(invalidPage, 'mobile:invalid');
    await invalidPage.setViewportSize(mobileViewport);
    await invalidPage.goto(`${baseUrl}/lightchain/not-a-real-feature`, { waitUntil: 'networkidle' });
    if (!invalidPage.url().endsWith(lightchainHomeRoute)) {
      await invalidPage.waitForURL(/\/designProduction$/, { timeout: 10_000 });
    }
    addAssertion('invalid_feature_redirects_to_canonical_home', invalidPage.url().endsWith(lightchainHomeRoute), { url: invalidPage.url() });
    await invalidPage.close();
    reportProgress('mobile_phase_complete', { verifiedFeatureCount: toolsToVerify.length });
  }
} catch (error) {
  evidence.exactBlocker = error.message;
  reportProgress('verification_failed', { exactBlocker: error.message });
  addAssertion('route_exception_free', false, { error: error.message });
} finally {
  reportProgress('cleanup_started');
  if (context) {
    await withTimeout(context.close(), 10000).then(() => {
      evidence.cleanup.contextClosed = true;
    }).catch((error) => {
      evidence.cleanup.contextCloseBlocker = error.message;
    });
  }
  if (browser) {
    await withTimeout(browser.close(), 60000).then(() => {
      evidence.cleanup.browserClosed = true;
      if (!evidence.cleanup.contextClosed) {
        evidence.cleanup.contextClosed = true;
        evidence.cleanup.contextClosedByBrowser = true;
        delete evidence.cleanup.contextCloseBlocker;
      }
    }).catch((error) => {
      evidence.cleanup.browserCloseBlocker = error.message;
    });
  }
  if (previewProcess) {
    await stopPreviewServer(previewProcess).then(() => {
      evidence.cleanup.previewStopped = true;
    }).catch((error) => {
      evidence.cleanup.previewStopBlocker = error.message;
    });
  } else if (!localPreview) {
    evidence.cleanup.previewStopped = true;
  }
  reportProgress('cleanup_complete', evidence.cleanup);
}

const diagnosticFailures = [
  ...evidence.consoleMessages.map((message) => `console_${message.type}:${message.text}`),
  ...evidence.pageErrors.map((message) => `page_error:${message}`),
  ...evidence.requestFailures.map((failure) => `request_failed:${failure.url}:${failure.failure}`),
];
if (!evidence.cleanup.contextClosed) diagnosticFailures.push(`context_cleanup:${evidence.cleanup.contextCloseBlocker ?? 'not_closed'}`);
if (!evidence.cleanup.browserClosed) diagnosticFailures.push(`browser_cleanup:${evidence.cleanup.browserCloseBlocker ?? 'not_closed'}`);
if (!evidence.cleanup.previewStopped) diagnosticFailures.push('preview_cleanup:not_stopped');
for (const failure of diagnosticFailures) addAssertion(failure, false);

evidence.ok = evidence.assertions.every((assertion) => assertion.ok);
evidence.failed = evidence.assertions.filter((assertion) => !assertion.ok).map((assertion) => assertion.id);
fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({
  ok: evidence.ok,
  failed: evidence.failed,
  featureCount: catalog.tools.length,
  summaryPath: path.join(outDir, 'SUMMARY.json'),
}, null, 2));
process.exit(evidence.ok ? 0 : 1);

async function verifyFeatureWorkflow(page, tool) {
  const result = { id: tool.id, category: tool.category, title: tool.title, assertions: [] };
  await page.goto(`${baseUrl}/lightchain/${tool.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  await waitForSettledRoute(page, tool);
  // The marketing entry can briefly remount its shared Lightchain loading
  // shell after the lazy page has resolved. Wait for the route-owned heading
  // before taking the signature/readback so a transient fallback is not
  // recorded as a product parity failure.
  if (tool.id === 'marketing-home') {
    await page.waitForFunction(
      () => document.body?.innerText.includes('マーケティングワークスペース'),
      undefined,
      { timeout: 15_000 },
    );
  }
  const body = await bodyText(page);
  const workflowRoots = page.locator('[data-workflow-feature]');
  const workflowRootCount = await workflowRoots.count();
    const workflowContractReadback = workflowRootCount > 0
    ? await workflowRoots.first().evaluate((element) => ({
      feature: element.getAttribute('data-workflow-feature'),
      contract: element.getAttribute('data-workflow-contract'),
      inputRoles: element.getAttribute('data-workflow-input-roles'),
      resultDestinations: element.getAttribute('data-workflow-result-destinations'),
      lifecycle: element.getAttribute('data-workflow-lifecycle'),
      sourceInputMode: element.getAttribute('data-workflow-source-input-mode'),
      retryPolicy: element.getAttribute('data-workflow-retry-policy'),
      rightsGate: element.getAttribute('data-workflow-rights-gate'),
    }))
    : { error: 'shared_workflow_contract_root_missing' };
  recordFeatureAssertion(result, 'shared_workflow_contract_readback',
    workflowContractReadback.feature === tool.id
      && workflowContractReadback.contract === 'lightchain-unified-workflow.v1'
      && Boolean(workflowContractReadback.inputRoles)
      && workflowContractReadback.resultDestinations === 'gallery,canvas,history,jobs'
      && workflowContractReadback.lifecycle === 'draft,ready,generating,completed,failed,retry'
      && workflowContractReadback.sourceInputMode === 'library-or-upload'
      && workflowContractReadback.retryPolicy === 'retains-last-completed-result,preserves-input-lineage,blocks-duplicate-submit'
      && workflowContractReadback.rightsGate === 'source-admitted-generation',
  {
    workflowContractReadback,
    expected: {
      feature: tool.id,
      contract: 'lightchain-unified-workflow.v1',
      resultDestinations: 'gallery,canvas,history,jobs',
      lifecycle: 'draft,ready,generating,completed,failed,retry',
      sourceInputMode: 'library-or-upload',
      retryPolicy: 'retains-last-completed-result,preserves-input-lineage,blocks-duplicate-submit',
      rightsGate: 'source-admitted-generation',
    },
  });
  recordFeatureAssertion(result, 'route_loaded_without_login', !page.url().includes('/login') && !body.includes('ログイン'), {
    url: page.url(),
    bodyExcerpt: body.slice(0, 600),
  });
  recordFeatureAssertion(result, 'heavy_brand_reference_absent', !body.includes('HEAVY CHAIN') && !body.includes('HEAVYCHAIN'), {
    bodyExcerpt: body.slice(0, 300),
  });
  recordFeatureAssertion(result, 'lightchain_screen_signature_visible', matchesLightchainSignature(tool, body), {
    expectedTitle: tool.title,
    bodyExcerpt: body.slice(0, 900),
  });
  if (tool.id === 'fabric-image') {
    const fabricParityView = page.getByTestId('lightchain-fabric-parity-view');
    const fabricUploadControlCount = await fabricParityView
      .getByRole('button', { name: '参考画像をアップロードしてください' })
      .count()
      .catch(() => -1);
    const fabricPermissionVisible = await fabricParityView
      .getByRole('button', { name: '権限がありません' })
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    recordFeatureAssertion(result, 'fabric_source_input_and_permission_surface_matches_readback',
      fabricUploadControlCount === 2 && fabricPermissionVisible,
      {
        fabricUploadControlCount,
        fabricPermissionVisible,
        sourceReadback: {
          visibleUploadControls: 2,
          permissionLabel: '権限がありません',
        },
      });
  }
  await verifyActiveSourceToolbar(page, tool, result);
  await verifyVisibleTabInteractions(page, tool, result);
  await verifyAllVisibleTabsRespond(page, tool, result);
  await verifyToolSpecificChoiceControls(page, tool, result);
  await verifyVisibleRangeControlsRespond(page, tool, result);
  result.controlInventory = await auditVisibleControls(page);

  // Fitting's multi-task surface exposes a local "追加" action instead of a
  // provider-generation button. Treat that bounded local action as a valid
  // workspace affordance while keeping provider/rights gates separate.
  const generateButton = page.getByRole('button', { name: /AI生成|更新|保存|開始|追加/ }).first();
  const hasSafeLocalAction = await generateButton.isVisible({ timeout: 1000 }).catch(() => false);
  const rightsGateVisible = await page.getByRole('button', { name: /権利を確認してAI生成|権限がありません/ }).first().isVisible({ timeout: 1000 }).catch(() => false);
  recordFeatureAssertion(result, 'safe_local_action_or_workspace_visible', hasSafeLocalAction || rightsGateVisible || isReadOnlyWorkspaceTool(tool.id), {
    hasSafeLocalAction,
    rightsGateVisible,
    toolId: tool.id,
  });

  await screenshot(page, `desktop-${tool.id}`);
  return result;
}

async function verifyVideoSurface(browserContext, viewport, route, key) {
  const page = await browserContext.newPage();
  page.setDefaultNavigationTimeout(15_000);
  page.setDefaultTimeout(15_000);
  wirePageDiagnostics(page, `video:${key}`);
  const result = { id: key, route, viewport, assertions: [], screenshot: null, url: null, observed: {} };
  const check = (id, ok, details = {}) => {
    const assertion = { id: `${key}:${id}`, ok: Boolean(ok), details };
    result.assertions.push(assertion);
    addAssertion(assertion.id, assertion.ok, details);
  };
  try {
    await page.setViewportSize(viewport);
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
    await waitForSourceRouteSettled(page);
    result.url = page.url();
    let body = await bodyText(page);
    if (route.includes('/detail')) {
      const guideButton = page.getByTestId('video-guide-skip');
      const guideVisible = await guideButton.isVisible({ timeout: 1000 }).catch(() => false);
      result.observed.guideVisible = guideVisible;
      check('guide_choice_present', guideVisible, { guideVisible });
      if (guideVisible) {
        await guideButton.click();
        await page.waitForTimeout(150);
        body = await bodyText(page);
      }
      const detailMarkers = ['動画ワークステーション', 'Untitled', 'ここをクリックまたはドラッグして画像を追加', '最大20M'];
      check('detail_markers_visible', detailMarkers.every((marker) => body.includes(marker)), { detailMarkers, bodyExcerpt: body.slice(0, 1000) });
      check('detail_file_input_present', await page.locator('input[type="file"]').count() > 0);
      const blockedButton = page.getByTestId('video-generation-blocked');
      check('detail_provider_generation_fail_closed', await blockedButton.isVisible().catch(() => false) === false || await blockedButton.isDisabled().catch(() => true));
    } else {
      const dashboard = page.getByTestId('lightchain-video-project-dashboard');
      const projectSection = page.getByTestId('video-recent-projects');
      const referenceSection = page.locator('section[aria-labelledby="video-reference-heading"]');
      const projectCount = await projectSection.getByRole('button').count().catch(() => 0);
      const referenceCount = await referenceSection.getByRole('button').count().catch(() => 0);
      const editLabelCount = await page.getByTestId('video-project-edit-label').count().catch(() => 0);
      result.observed.projectCount = projectCount;
      result.observed.referenceCount = referenceCount;
      result.observed.editLabelCount = editLabelCount;
      check('dashboard_present', await dashboard.isVisible().catch(() => false));
      check('dashboard_markers_visible', ['動画ワークステーション', '新規ファイル', 'Untitled', '参考事例', '修正'].every((marker) => body.includes(marker)), { bodyExcerpt: body.slice(0, 1000) });
      check('dashboard_recent_project_count', projectCount === 6, { projectCount });
      check('dashboard_reference_count', referenceCount === 5, { referenceCount });
      check('dashboard_new_file_action_present', await page.getByRole('button', { name: '新規ファイル', exact: true }).isVisible().catch(() => false));
      check('dashboard_edit_labels_match_source_count', editLabelCount === 11, { editLabelCount });
    }
    const checkboxCount = await page.locator('input[type="checkbox"]:visible, [role="checkbox"]:visible').count().catch(() => 0);
    result.observed.visibleCheckboxCount = checkboxCount;
    check('rights_checkbox_absent', checkboxCount === 0, { checkboxCount });
    result.screenshot = await screenshot(page, `video-${key}`);
  } catch (error) {
    check('route_readback_completed', false, { exactBlocker: error.message });
    result.exactBlocker = error.message;
  } finally {
    await page.close().catch(() => undefined);
  }
  return result;
}

async function verifySourceRouteParity(browserContext, viewport) {
  const routeSpecs = [
    {
      key: 'designProduction',
      route: '/designProduction',
      source: sourceReadback.routes['/designProduction'],
      verify: verifyDesignProductionSourceSurface,
    },
    {
      key: 'creator',
      route: '/creator',
      source: sourceReadback.routes['/creator'],
      verify: verifyCreatorSourceSurface,
    },
    {
      key: 'tools-fabric',
      route: '/tools/fabric',
      source: sourceReadback.routes['/tools/fabric'],
      verify: verifyFabricSourceSurface,
    },
    {
      key: 'model',
      route: '/model',
      source: sourceReadback.routes['/model'],
      verify: verifyModelSourceSurface,
    },
  ];

  for (const spec of routeSpecs) {
    const page = await browserContext.newPage();
    page.setDefaultNavigationTimeout(15_000);
    page.setDefaultTimeout(15_000);
    wirePageDiagnostics(page, `source:${spec.key}`);
    const result = {
      key: spec.key,
      route: spec.route,
      viewport,
      url: null,
      screenshot: null,
      screenshotRole: 'heavy-observed-source-contract',
      sourceScreenshot: null,
      visualDiff: {
        status: 'PENDING_CONFIRMATION',
        reason: 'Current authenticated Light Chain screenshot baseline is not supplied.',
      },
      assertions: [],
      observed: {},
      source: spec.source,
    };
    try {
      await page.setViewportSize(viewport);
      await page.goto(`${baseUrl}${spec.route}`, { waitUntil: 'domcontentloaded' });
      await waitForSourceRouteSettled(page);
      result.url = page.url();
      result.observed.bodyExcerpt = (await bodyText(page)).slice(0, 2200);
      await spec.verify(page, result);
      await screenshot(page, `source-parity-${spec.key}`);
      result.screenshot = evidence.screenshots[`source-parity-${spec.key}`];
    } catch (error) {
      sourceParityAssertion(result, 'route_readback_completed', false, { exactBlocker: error.message });
    } finally {
      evidence.sourceReadback.results.push(result);
      await page.close().catch(() => undefined);
    }
  }
}

async function waitForSourceRouteSettled(page) {
  await page.waitForFunction(() => document.body?.innerText.trim().length > 0, null, { timeout: 10_000 });
  await page.waitForTimeout(350);
  await page.waitForFunction(
    () => !/読み込み中\.\.\.|準備しています/.test(document.body?.innerText ?? ''),
    null,
    { timeout: 15_000 },
  ).catch(() => undefined);
}

async function verifyDesignProductionSourceSurface(page, result) {
  const expected = sourceReadback.routes['/designProduction'].source;
  const body = await bodyText(page);
  const titleMatches = expected.creationTitles.every((title) => body.includes(title));
  const actionCounts = Object.fromEntries(await Promise.all(expected.creationActions.map(async (label) => [
    label,
    await page.getByRole('button', { name: exactText(label) }).count(),
  ])));
  const actionMatches = Object.values(actionCounts).every((count) => count === 1);
  const extraNewFileCardCount = await page.getByRole('button', { name: exactText('新規ファイル') }).count();
  result.observed.creationTitles = expected.creationTitles.filter((title) => body.includes(title));
  result.observed.creationActionCounts = actionCounts;
  result.observed.extraNewFileCardCount = extraNewFileCardCount;
  sourceParityAssertion(result, 'source_creation_titles_match', titleMatches, { expected: expected.creationTitles });
  sourceParityAssertion(result, 'source_creation_actions_match', actionMatches, { expected: expected.creationActions, observed: result.observed.creationActionCounts });
  sourceParityAssertion(result, 'source_extra_new_file_card_absent', extraNewFileCardCount === 0, { extraNewFileCardCount });
  sourceParityAssertion(result, 'source_design_production_tabs_present', expected.tabs.every((tab) => body.includes(tab)), { expected: expected.tabs });
  sourceParityAssertion(result, 'source_design_production_has_no_checkbox', await visibleCheckboxCount(page) === expected.checkboxCount, { expected: expected.checkboxCount });
}

async function verifyCreatorSourceSurface(page, result) {
  const expected = sourceReadback.routes['/creator'].source;
  const body = await bodyText(page);
  const headings = await page.getByRole('heading').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') || node.textContent?.trim() || ''));
  result.observed.headings = headings;
  for (const heading of expected.headings) {
    sourceParityAssertion(result, `source_creator_heading:${heading}`, headings.includes(heading) || body.includes(heading), { heading });
  }
  sourceParityAssertion(result, 'source_creator_permission_label_present', body.includes(expected.permissionLabel), { permissionLabel: expected.permissionLabel });
  sourceParityAssertion(result, 'source_creator_has_no_checkbox', await visibleCheckboxCount(page) === expected.checkboxCount, { expected: expected.checkboxCount });
}

async function verifyFabricSourceSurface(page, result) {
  const expected = sourceReadback.routes['/tools/fabric'].source;
  const body = await bodyText(page);
  const tabsMatch = expected.tabs.every((tab) => body.includes(tab));
  const headingsMatch = expected.headings.every((heading) => body.includes(heading));
  // ImageSelector keeps the native file input visually hidden and exposes the
  // Lightchain upload affordance through its labeled drop surface. Count the
  // accessible Lightchain controls, not the hidden-input implementation detail.
  const uploadControls = await page
    .getByRole('button', { name: '参考画像をアップロードしてください' })
    .count()
    .catch(() => 0);
  const permission = page.getByRole('button', { name: exactText(expected.permissionLabel) }).first();
  const permissionVisible = await permission.isVisible().catch(() => false);
  result.observed.visibleUploadControls = uploadControls;
  result.observed.permissionVisible = permissionVisible;
  sourceParityAssertion(result, 'source_fabric_tabs_match', tabsMatch, { expected: expected.tabs });
  sourceParityAssertion(result, 'source_fabric_headings_match', headingsMatch, { expected: expected.headings });
  sourceParityAssertion(result, 'source_fabric_permission_surface_match', uploadControls === expected.visibleUploadControls && permissionVisible, { uploadControls, permissionVisible });
  sourceParityAssertion(result, 'source_fabric_has_no_checkbox', await visibleCheckboxCount(page) === expected.checkboxCount, { expected: expected.checkboxCount });
}

async function verifyModelSourceSurface(page, result) {
  const expected = sourceReadback.routes['/model'].source;
  const body = await bodyText(page);
  const tabsMatch = expected.tabs.every((tab) => body.includes(tab));
  const labelsMatch = expected.labels.every((label) => body.includes(label));
  const checkboxCount = await visibleCheckboxCount(page);
  const resultCards = await page.locator('[data-testid*="result" i], [data-testid*="history" i] article, img[alt*="生成"]').count().catch(() => 0);
  result.observed.resultCards = resultCards;
  result.observed.visibleCheckboxCount = checkboxCount;
  sourceParityAssertion(result, 'source_model_tabs_match', tabsMatch, { expected: expected.tabs });
  sourceParityAssertion(result, 'source_model_labels_match', labelsMatch, { expected: expected.labels });
  sourceParityAssertion(result, 'source_model_has_no_checkbox', checkboxCount === expected.checkboxCount, { expected: expected.checkboxCount, checkboxCount });
  // Result rows are user-scoped data, not a source entitlement or rights UI.
  // Record the difference without deleting/hiding a user's persisted result.
  result.observed.sourceResultCards = expected.resultCards;
  result.observed.resultCardState = resultCards === expected.resultCards ? 'same' : 'user-scoped-difference';
}

async function visibleCheckboxCount(page) {
  return page.locator('input[type="checkbox"]:visible, [role="checkbox"]:visible').count();
}

function sourceParityAssertion(result, id, ok, details = {}) {
  result.assertions.push({ id, ok: Boolean(ok), details });
  addAssertion(`source_readback:${result.key}:${id}`, ok, details);
}

async function verifyActiveSourceToolbar(page, tool, result) {
  const toolbar = page.locator('[data-testid="lightchain-source-toolbar"]').first();
  const visible = await toolbar.isVisible({ timeout: 1000 }).catch(() => false);
  if (!visible) {
    recordFeatureAssertion(result, 'source_toolbar_active_category_not_applicable', true, {
      toolId: tool.id,
      reason: 'route does not render the shared source toolbar',
    });
    return;
  }

  const expectedLabels = {
    recommended: 'おすすめ',
    planning: '企画デザインツール',
    fitting: 'AIフィッティング',
    graphics: 'グラフィックツール',
  };
  const expectedCategory = getExpectedVisibleCategoryId(tool.category);
  const currentLinks = toolbar.locator('a[aria-current="page"]');
  const currentCount = await currentLinks.count();
  const currentLabel = currentCount === 1
    ? (await currentLinks.first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    : '';
  const expectedLabel = expectedLabels[expectedCategory] ?? '';
  recordFeatureAssertion(result, 'source_toolbar_active_category', currentCount === 1 && currentLabel === expectedLabel, {
    toolId: tool.id,
    rawCategory: tool.category,
    expectedCategory,
    expectedLabel,
    currentCount,
    currentLabel,
  });
}

// The catalog retains internal workflow classifications, while the shared
// Lightchain toolbar exposes four visible buckets. Keep this verifier aligned
// with the product's source-category mapping instead of comparing raw labels.
function getExpectedVisibleCategoryId(category) {
  if (category === 'planning' || category === 'fitting' || category === 'graphics') {
    return category;
  }
  if (category === 'model' || category === 'lab') return 'fitting';
  return 'recommended';
}

async function verifyVisibleTabInteractions(page, tool, result) {
  const tabChecks = {
    'fashion-studio': [
      { tab: 'コーディネート', expected: 'コーディネート履歴', promptValue: 'ボトムス、靴、バッグ', helper: '服と小物、靴、バッグを合わせたコーディネート案を作ります。', example: 'ワイドデニム、シルバースニーカー', placeholder: '黒のチェーン柄フーディーに合わせるボトムス、靴、バッグ、小物の方向性を入力してください。' },
      { tab: '360度表示', expected: '360度表示履歴', promptValue: '360度表示で見せたい角度', helper: '正面、背面、横、ディテールなど多角度の見せ方を作ります。', example: '正面、左斜め、背面', placeholder: '360度表示で見せたい角度、ディテール、背景、回転順を入力してください。' },
      { tab: 'スタジオ案', expected: 'スタジオ案履歴', promptValue: 'モデル、背景、小物', helper: '商品、モデル、背景、小物を組み合わせた撮影案を作ります。', example: '平置き商品画像', placeholder: '黒のチェーン柄フーディーを、モデル、背景、小物と組み合わせてEC/SNS向けの撮影案にしてください。' },
    ],
    'design-agent': [
      { tab: '商品企画', expected: '商品企画', promptValue: '', helper: '', example: 'ZIMMERMANN', placeholder: '調査したい市場、カテゴリ、スタイル方向を入力してください…' },
      { tab: '顧客提案', expected: '顧客提案', promptValue: '顧客要望', helper: '', example: '顧客向けに、ブランドの強みと商品企画の提案書を作成する。', placeholder: '顧客要望を入力するか、brief、メール、議事録をアップロードしてください…' },
      { tab: 'インスピレーション', expected: 'インスピレーション', promptValue: 'デザインしたい服のスタイル', helper: '', example: 'メタリック素材', placeholder: 'デザインしたい服のスタイルを入力するか、参考画像をアップロードしてください…' },
      { tab: 'AIグラフィックデザイン', expected: 'AIグラフィックデザイン', promptValue: '生成したい柄のスタイル', helper: '', example: 'チェーンモチーフ', placeholder: '生成したい柄のスタイル、要素、使用シーンを入力してください…' },
    ],
  }[tool.id] ?? [];

  for (const check of tabChecks) {
    const tabButton = page.getByRole('tab', { name: exactText(check.tab) });
    await tabButton.click();
    await page.waitForTimeout(100);
    const body = await bodyText(page);
    const textareaValue = await page.locator('textarea').first().inputValue().catch(() => '');
    const ariaSelected = await tabButton.getAttribute('aria-selected').catch(() => null);
    const placeholder = await page.locator('textarea').first().getAttribute('placeholder').catch(() => null);
    recordFeatureAssertion(result, `tab_click_updates_state:${check.tab}`, ariaSelected === 'true' && body.includes(check.expected) && body.includes(check.helper) && body.includes(check.example) && textareaValue.includes(check.promptValue) && placeholder === check.placeholder, {
      expected: check.expected,
      ariaSelected,
      helper: check.helper,
      example: check.example,
      placeholder,
      expectedPlaceholder: check.placeholder,
      promptValue: check.promptValue,
      textareaValue,
      bodyExcerpt: body.slice(0, 700),
    });
  }

  if (['ai-fitting', 'ai-fitting-reference', 'fitting-clothing-reference', 'fitting-background-reference'].includes(tool.id)) {
    const fittingChecks = [
      {
        tab: 'マルチタスク',
        expected: '複数のコーディネートのアップロードに対応',
        headline: '複数のコーディネートのアップロードに対応',
      },
      {
        tab: 'シングルタスク',
        expected: '複数のコーディネートのアップロードに対応',
        headline: '複数のコーディネートのアップロードに対応',
      },
      {
        tab: '参考画像',
        expected: '参考画像',
        placeholder: '参考画像で残したい雰囲気や衣服の条件を記入してください',
        helper: '衣服と一緒に使う参考画像の条件を指定します。',
      },
      {
        tab: 'モデルのセット写真',
        expected: 'モデルのセット写真',
        placeholder: 'モデルセット写真で合わせたいポーズ、背景、小物を記入してください',
        helper: 'モデルのセット写真に合わせた条件を指定します。',
      },
      {
        tab: '説明生成',
        expected: '説明生成',
        placeholder: '背景の説明をここに記入してください',
        helper: 'ここをクリック/ドラッグしてアイテムを追加します。',
      },
    ];
    for (const check of fittingChecks) {
      const tabButton = page.getByRole('tab', { name: exactText(check.tab) }).first();
      await tabButton.click();
      await page.waitForTimeout(100);
      const body = await bodyText(page);
      const ariaSelected = await tabButton.getAttribute('aria-selected').catch(() => null);
      const placeholder = await page.locator('textarea').first().getAttribute('placeholder').catch(() => null);
      const placeholderOk = !check.placeholder || placeholder === check.placeholder;
      const headlineOk = !check.headline || body.includes(check.headline);
      const helperOk = !check.helper || body.includes(check.helper);
      recordFeatureAssertion(result, `fitting_tab_click_updates_state:${check.tab}`, ariaSelected === 'true' && body.includes(check.expected) && placeholderOk && headlineOk && helperOk, {
        expected: check.expected,
        ariaSelected,
        placeholder,
        expectedPlaceholder: check.placeholder ?? null,
        expectedHeadline: check.headline ?? null,
        expectedHelper: check.helper ?? null,
        bodyExcerpt: body.slice(0, 700),
      });
    }
  }
}

async function verifyAllVisibleTabsRespond(page, tool, result) {
  const initialUrl = page.url();
  const tabs = await page.locator('[role="tab"]:visible').evaluateAll((nodes) => nodes.map((node, index) => ({
    index,
    text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  })).filter((item) => item.text));
  recordFeatureAssertion(result, 'visible_tabs_have_click_targets', tabs.length > 0 || !expectsInteractiveTabs(tool.id), {
    tabCount: tabs.length,
    tabs,
  });
  for (const tab of tabs) {
    if (page.url() !== initialUrl || await page.locator('[role="tab"]:visible').count() === 0) {
      await page.goto(initialUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(150);
      await waitForSettledRoute(page, tool);
    }
    const candidates = page.getByRole('tab', { name: exactText(tab.text) });
    let tabButton = null;
    for (let index = 0; index < await candidates.count(); index += 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
        tabButton = candidate;
        break;
      }
    }
    if (!tabButton) {
      recordFeatureAssertion(result, `visible_tab_responds:${tab.index}:${tab.text}`, false, {
        text: tab.text,
        exactBlocker: 'visible_tab_target_missing_after_route_rebind',
      });
      continue;
    }
    const before = await interactionSnapshot(page);
    const beforeUrl = page.url();
    const wasSelected = before.selectedTabs.some((entry) => entry.text === tab.text && entry.selected === 'true');
    await tabButton.click();
    await page.waitForTimeout(150);
    const after = await interactionSnapshot(page);
    const ariaSelected = await tabButton.getAttribute('aria-selected').catch(() => null);
    const selectedOk = ariaSelected === 'true' || page.url() !== beforeUrl;
    const changedOk = before.fingerprint !== after.fingerprint || page.url() !== beforeUrl;
    recordFeatureAssertion(result, `visible_tab_responds:${tab.index}:${tab.text}`, selectedOk && (changedOk || wasSelected), {
      text: tab.text,
      beforeUrl,
      afterUrl: page.url(),
      ariaSelected,
      wasSelected,
      before,
      after,
    });
  }
  if (page.url() !== initialUrl) {
    await page.goto(initialUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);
    await waitForSettledRoute(page, tool);
  }
}

async function verifyToolSpecificChoiceControls(page, tool, result) {
  const checksByTool = {
    'printing-image': [
      { name: 'print_mode_overall', button: '全体', expectBody: '全体', expectSelectedClass: 'bg-[#737d84]' },
      { name: 'print_mode_spot', button: 'スポット', expectBody: 'スポット', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'line-to-real': [
      { name: 'line_draft_monochrome', button: 'モノクロ線画', expectBody: 'モノクロ線画', expectSelectedClass: 'bg-[#737d84]' },
      { name: 'line_draft_color', button: 'カラー線画', expectBody: 'カラー線画', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'line-generation': [
      { name: 'flat_image_type_model', button: 'モデル図', expectBody: 'モデル図', expectSelectedClass: 'bg-[#737d84]' },
      { name: 'flat_image_type_flatlay', button: '平置き画像', expectBody: '平置き画像', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'image-repair': [
      { name: 'repair_mask_tool', button: 'マスクツール', expectBody: 'マスクツール」を使用して手足の部分をマスクで選択してください', expectSelectedClass: 'bg-[#737d84]' },
      { name: 'repair_deformation', button: '手足の変形を修正', expectBody: '手足の変形を修正', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'pattern-vector': [
      { name: 'pattern_vector_split', button: '分割', expectBody: '分割', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'pattern-vector-pro': [
      { name: 'pattern_vector_pro_split', button: '分割', expectBody: '分割', expectSelectedClass: 'bg-[#737d84]' },
    ],
    'model-change': [
      { name: 'model_change_keep_size_toggle', button: 'サイズを維持する', expectBody: 'サイズを維持する', expectStateChange: true },
    ],
    'pose-change': [
      { name: 'pose_mode_custom', button: 'カスタム', expectBody: 'カスタム', expectSelectedClass: 'bg-[#747e85]' },
    ],
    'background-change': [
      { name: 'background_mode_custom', button: 'カスタム', expectBody: 'カスタム', expectSelectedClass: 'bg-[#747e85]' },
    ],
    'body-shape': [
      { name: 'body_gender_women', button: '女性', expectBody: '女性', expectSelectedClass: 'bg-[#747e85]' },
      { name: 'body_type_toggle', button: '体型', expectBody: '体型', expectStateChange: true },
      { name: 'body_custom_toggle', button: 'カスタムボディ', expectBody: 'カスタムボディ', expectStateChange: true },
    ],
    'clothing-size': [
      { name: 'garment_type_full', button: '全身', expectBody: '全身', expectSelectedClass: 'bg-[#747e85]' },
      { name: 'source_size_toggle', button: '元のサイズ', expectBody: '元のサイズ', expectStateChange: true },
      { name: 'target_size_toggle', button: '変更サイズ', expectBody: '変更サイズ', expectStateChange: true },
    ],
    'angle-change': [
      { name: 'back_view_toggle', button: '背面', expectBody: '背面', expectStateChange: true },
    ],
    'model-custom': [
      { name: 'custom_mode_custom', button: 'カスタム', expectBody: 'カスタム', expectSelectedClass: 'bg-[#747e85]' },
      { name: 'custom_gender_women', button: '女性', expectBody: '女性', expectSelectedClass: 'bg-[#747e85]' },
      { name: 'custom_age_toggle', button: '年齢', expectBody: '年齢', expectStateChange: true },
      { name: 'custom_nationality_toggle', button: '国籍', expectBody: '国籍', expectStateChange: true },
      { name: 'custom_skin_tone_toggle', button: '肌の色', expectBody: '肌の色', expectStateChange: true },
      { name: 'custom_body_type_toggle', button: '体型', expectBody: '体型', expectStateChange: true },
      { name: 'custom_half_toggle', button: 'ハーフ', expectBody: 'ハーフ', expectStateChange: true },
    ],
  };
  const checks = checksByTool[tool.id] ?? [];
  for (const check of checks) {
    const button = await buttonByText(page, check.button);
    const visible = await button.isVisible({ timeout: 1000 }).catch(() => false);
    const before = await interactionSnapshot(page);
    const classNameBefore = visible ? await button.getAttribute('class').catch(() => '') : '';
    if (visible) await button.click();
    await page.waitForTimeout(150);
    const after = await interactionSnapshot(page);
    const className = visible ? await button.getAttribute('class').catch(() => '') : '';
    const selectedOk = check.expectSelectedClass ? className?.includes(check.expectSelectedClass) : true;
    const wasAlreadySelected = check.expectSelectedClass ? classNameBefore?.includes(check.expectSelectedClass) : false;
    const changedOk = check.expectStateChange || !wasAlreadySelected ? before.fingerprint !== after.fingerprint : true;
    const bodyOk = !check.expectBody || after.body.includes(check.expectBody);
    recordFeatureAssertion(result, `choice_control_responds:${check.name}`, visible && selectedOk && changedOk && bodyOk, {
      button: check.button,
      visible,
      classNameBefore,
      className,
      expectSelectedClass: check.expectSelectedClass ?? null,
      expectStateChange: Boolean(check.expectStateChange),
      before,
      after,
    });
  }
  await verifyToolSpecificRangeControls(page, tool, result);
}

async function verifyToolSpecificRangeControls(page, tool, result) {
  const rangeChecksByTool = {
    'angle-change': [
      { name: 'angle_horizontal', label: '左視⇔右視', value: '82' },
      { name: 'angle_vertical', label: '見上げる⇔見下ろす', value: '18' },
      { name: 'angle_zoom', label: 'ズームイン⇔ズームアウト', value: '76' },
    ],
  };
  const checks = rangeChecksByTool[tool.id] ?? [];
  for (const check of checks) {
    const range = page.getByRole('slider', { name: exactText(check.label) }).first();
    const visible = await range.isVisible({ timeout: 1000 }).catch(() => false);
    const before = await interactionSnapshot(page);
    if (visible) {
      await range.fill(check.value);
      await range.dispatchEvent('change');
    }
    await page.waitForTimeout(150);
    const after = await interactionSnapshot(page);
    const value = visible ? await range.inputValue().catch(() => '') : '';
    recordFeatureAssertion(result, `range_control_responds:${check.name}`, visible && value === check.value && before.fingerprint !== after.fingerprint, {
      label: check.label,
      visible,
      expectedValue: check.value,
      value,
      before,
      after,
    });
  }
}

async function verifyVisibleRangeControlsRespond(page, tool, result) {
  const ranges = await page.locator('input[type="range"]:visible').evaluateAll((nodes) => nodes.map((node, index) => ({
    index,
    label: node.getAttribute('aria-label') || node.closest('label')?.innerText?.replace(/\s+/g, ' ').trim() || `range-${index}`,
    value: node.value,
    min: node.getAttribute('min') ?? '0',
    max: node.getAttribute('max') ?? '100',
  })));
  for (const rangeInfo of ranges) {
    const range = page.locator('input[type="range"]:visible').nth(rangeInfo.index);
    const min = Number(rangeInfo.min);
    const max = Number(rangeInfo.max);
    const current = Number(rangeInfo.value);
    const next = Number.isFinite(min) && Number.isFinite(max) && max > min
      ? String(current === max ? min : max)
      : '75';
    const before = await interactionSnapshot(page);
    await range.fill(next);
    await range.dispatchEvent('change');
    await page.waitForTimeout(150);
    const after = await interactionSnapshot(page);
    const value = await range.inputValue().catch(() => '');
    recordFeatureAssertion(result, `visible_range_control_responds:${rangeInfo.index}:${rangeInfo.label}`, value === next && before.fingerprint !== after.fingerprint, {
      label: rangeInfo.label,
      beforeValue: rangeInfo.value,
      expectedValue: next,
      value,
      before,
      after,
    });
  }
}

function getControlAuditSelector() {
  return [
    'button:visible',
    'a[href]:visible',
    '[role="button"]:visible',
    '[role="tab"]:visible',
    '[role="menuitem"]:visible',
    '[role="checkbox"]:visible',
    '[role="switch"]:visible',
    '[role="radio"]:visible',
    'input:not([type="file"]):visible',
    'select:visible',
    'textarea:visible',
  ].join(', ');
}

function classifyVisibleControl(control) {
  const label = `${control.name} ${control.href ?? ''}`.replace(/\s+/g, ' ').trim();
  if (control.disabled || control.ariaDisabled === 'true' || /権利を確認してAI生成|権限がありません/.test(label)) return 'permission_blocked';
  if (/生成|開始|保存|削除|ダウンロード|再試行|アップロード|ログアウト|ログイン|購入|課金|支払い|OpenAI|Runway|動画|送信|確定|決定|作成/.test(label)) return 'effectful_or_provider';
  if (control.role === 'tab') return 'safe_tab';
  if (control.role === 'checkbox' || control.role === 'switch' || control.role === 'radio' || control.type === 'checkbox' || control.type === 'radio' || control.ariaPressed != null) return 'safe_toggle';
  if (control.hasPopup) return 'safe_menu';
  if (/検索|ヘルプ|ガイド/.test(label)) return 'safe_lookup';
  return 'read_only_or_navigation';
}

async function auditVisibleControls(page) {
  const selector = getControlAuditSelector();
  const controls = await page.locator(selector).evaluateAll((nodes) => nodes.map((node, index) => {
    const element = node;
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const name = element.getAttribute('aria-label')
      || element.getAttribute('title')
      || element.textContent?.replace(/\s+/g, ' ').trim()
      || element.getAttribute('placeholder')
      || '';
    return {
      index,
      tag: element.tagName.toLowerCase(),
      role,
      name: name.slice(0, 180),
      href: element.getAttribute('href'),
      type: element.getAttribute('type'),
      disabled: element.hasAttribute('disabled'),
      ariaDisabled: element.getAttribute('aria-disabled'),
      ariaPressed: element.getAttribute('aria-pressed'),
      hasPopup: element.getAttribute('aria-haspopup'),
      checked: element.getAttribute('aria-checked') ?? (element instanceof HTMLInputElement ? String(element.checked) : null),
    };
  }));
  const classified = controls.map((control) => ({ ...control, classification: classifyVisibleControl(control) }));
  const interactionResults = [];

  const menus = page.locator('button[aria-haspopup]:visible, [role="button"][aria-haspopup]:visible');
  for (let index = 0; index < await menus.count(); index += 1) {
    const menu = menus.nth(index);
    if (!(await menu.isEnabled().catch(() => false))) continue;
    const name = await menu.getAttribute('aria-label').catch(() => null) || await menu.innerText().catch(() => '');
    if (classifyVisibleControl({ name, href: null, role: 'button', disabled: false, ariaDisabled: null, ariaPressed: null, hasPopup: 'true', type: null }) !== 'safe_menu') continue;
    try {
      await menu.click();
      const menuVisible = await page.locator('[role="menu"]:visible, [role="listbox"]:visible, [role="dialog"]:visible').count() > 0;
      await page.keyboard.press('Escape').catch(() => {});
      interactionResults.push({ type: 'menu_open_close', index, name: String(name).trim().slice(0, 120), menuVisible });
    } catch (error) {
      interactionResults.push({ type: 'menu_open_close', index, name: String(name).trim().slice(0, 120), status: 'not_completed', exactBlocker: error.message });
    }
  }

  return {
    selector,
    visibleCount: classified.length,
    precedingInteractionCoverage: ['role=tab', 'tool-specific choice controls', 'input[type=range]'],
    countsByClassification: classified.reduce((counts, control) => {
      counts[control.classification] = (counts[control.classification] ?? 0) + 1;
      return counts;
    }, {}),
    controls: classified,
    nonDestructiveInteractionResults: interactionResults,
    effectfulOrProviderControlsNotClicked: classified.filter((control) => control.classification === 'effectful_or_provider'),
    permissionControlsNotClicked: classified.filter((control) => control.classification === 'permission_blocked'),
  };
}

async function interactionSnapshot(page) {
  return page.evaluate(() => {
    const textareas = Array.from(document.querySelectorAll('textarea')).map((node) => ({
      value: node.value,
      placeholder: node.getAttribute('placeholder') ?? '',
    }));
    const inputs = Array.from(document.querySelectorAll('input')).map((node) => ({
      type: node.getAttribute('type') ?? '',
      label: node.getAttribute('aria-label') ?? '',
      value: node.value,
      checked: node.checked,
    })).filter((item) => item.type !== 'file');
    const selectedTabs = Array.from(document.querySelectorAll('[role="tab"]')).map((node) => ({
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      selected: node.getAttribute('aria-selected') ?? '',
      className: node.getAttribute('class') ?? '',
    }));
    const highlightedButtons = Array.from(document.querySelectorAll('button')).map((node) => ({
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      className: node.getAttribute('class') ?? '',
      ariaPressed: node.getAttribute('aria-pressed') ?? '',
      childClasses: Array.from(node.querySelectorAll('*')).map((child) => child.getAttribute('class') ?? '').filter(Boolean),
    })).filter((item) => item.className.includes('bg-[#737d84]') || item.className.includes('bg-[#747e85]') || item.className.includes('bg-[#65d3cf]') || item.ariaPressed === 'true');
    const body = document.body.innerText.replace(/\s+/g, ' ').trim();
    const fingerprint = JSON.stringify({
      body: body.slice(0, 10000),
      textareas,
      inputs,
      selectedTabs,
      highlightedButtons,
    });
    return {
      body: body.slice(0, 900),
      textareas,
      inputs,
      selectedTabs,
      highlightedButtons,
      fingerprint,
    };
  });
}

function expectsInteractiveTabs(toolId) {
  return [
    'fashion-studio',
    'design-agent',
    'ai-fitting',
    'ai-fitting-reference',
    'fitting-clothing-reference',
    'fitting-background-reference',
  ].includes(toolId);
}

async function buttonByText(page, text) {
  const firstVisible = async (locator) => {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible({ timeout: 300 }).catch(() => false)) return candidate;
    }
    return null;
  };
  const panelCandidates = page.locator(
    '[data-testid="lightchain-model-panel"] button, [data-testid="lightchain-fitting-input-flow"] button',
  ).filter({ hasText: new RegExp(`^\\s*${escapeRegExp(text)}`) });
  const panelButton = await firstVisible(panelCandidates);
  if (panelButton) return panelButton;
  const exactCandidates = page.getByRole('button', { name: exactText(text) });
  const exactButton = await firstVisible(exactCandidates);
  if (exactButton) return exactButton;
  const fallbackCandidates = page.locator('button').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(text)}`) });
  return (await firstVisible(fallbackCandidates)) ?? exactCandidates.first();
}

async function verifyGenerateEntrypointUsesFeatureDetail(page) {
  const generateCategoryIds = ['recommended', 'planning', 'fitting', 'graphics'];
  // `/designProduction` is the source-shaped production entry and does not
  // expose the compatibility launcher tabs. The authenticated `/dashboard`
  // alias intentionally retains that launcher for direct feature-link checks.
  const launcherRoute = '/dashboard';
  const featureLinkEntries = [];
  for (const categoryId of generateCategoryIds) {
    await page.goto(`${baseUrl}${launcherRoute}?category=${categoryId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 10_000 });
    await waitForLightchainCategory(page, categoryId);
    await dismissBlockingOverlays(page);
    // Gallery thumbnails hydrate independently of the category tabs. Give a
    // late-rendered example dialog one bounded pass before exercising the
    // launcher card itself.
    await page.waitForTimeout(500);
    await dismissBlockingOverlays(page);
    await page.locator('[data-testid="lightchain-tool-card"]').first().waitFor({ state: 'visible', timeout: 10_000 });
    const linksForCategory = await page
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')).filter(Boolean));
    featureLinkEntries.push(...linksForCategory.map((href) => ({ categoryId, href })));
  }
  const skippedVideoHrefs = featureLinkEntries
    .map((entry) => entry.href)
    .filter((href) => isVideoHref(href));
  // Keep the first category in which a link is rendered. Some routes are also
  // exposed from shared case/navigation surfaces, so letting a Map overwrite
  // earlier entries can associate a recommended card with a later category
  // and make the click assertion inspect the wrong screen.
  const uniqueFeatureLinkEntries = [];
  const seenFeatureHrefs = new Set();
  for (const entry of featureLinkEntries) {
    if (!isFeatureEntrypointHref(entry.href) || isVideoHref(entry.href) || seenFeatureHrefs.has(entry.href)) continue;
    seenFeatureHrefs.add(entry.href);
    uniqueFeatureLinkEntries.push(entry);
  }
  const clickableFeatureDetailEntries = uniqueFeatureLinkEntries
    // The current Lightchain launcher uses the same direct product routes as
    // production (/marketing, /model, /flow/*, ...); only the old verifier
    // required every card to be rewritten as /lightchain/*.
    .filter((entry) => (
      entry.href.startsWith('/lightchain/')
      || (isDirectFeatureHref(entry.href) && !entry.href.startsWith('/generate?category='))
    ))
    .slice(0, 3);
  addAssertion('generate_entrypoint_has_direct_feature_links', clickableFeatureDetailEntries.length >= 3, {
    count: clickableFeatureDetailEntries.length,
    featureLinks: clickableFeatureDetailEntries.map((entry) => entry.href),
    allEntrypointLinks: uniqueFeatureLinkEntries.map((entry) => entry.href),
    skippedVideoHrefs,
  });
  for (const { categoryId, href } of clickableFeatureDetailEntries) {
    await page.goto(`${baseUrl}${launcherRoute}?category=${categoryId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 10_000 });
    await waitForLightchainCategory(page, categoryId);
    await dismissBlockingOverlays(page);
    await page.locator('[data-testid="lightchain-tool-card"]').first().waitFor({ state: 'visible', timeout: 10_000 });
    const link = page.locator(`a[href="${href}"]`).first();
    const visible = await link.isVisible({ timeout: 1500 }).catch(() => false);
    if (visible) {
      const explicitCloseButton = page.locator('[role="dialog"]:visible button[aria-label="閉じる"]');
      if (await explicitCloseButton.count() > 0) {
        await explicitCloseButton.first().click({ force: true }).catch(() => {});
        await page.waitForTimeout(250);
      }
      await dismissBlockingOverlays(page);
      const residualDialogCount = await page.locator('[role="dialog"]:visible').count();
      if (residualDialogCount > 0) throw new Error(`blocking_dialog_before_feature_link:${href}`);
      await link.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await waitForDirectFeatureDestination(page, href);
    }
    const targetBody = await bodyText(page);
    addAssertion(`generate_entrypoint_click:${href}`, visible && urlMatchesHref(page.url(), href) && directFeatureDestinationLoaded(href, targetBody), {
      url: page.url(),
      bodyExcerpt: targetBody.slice(0, 500),
    });
  }
  await page.goto(`${baseUrl}${lightchainHomeRoute}`, { waitUntil: 'networkidle' });
}

async function verifyMobileFeatureScreen(page, tool) {
  await page.goto(`${baseUrl}/lightchain/${tool.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  await waitForSettledRoute(page, tool);
  const body = await bodyText(page);
  addAssertion(`mobile_screen:${tool.id}`, (
    !page.url().includes('/login')
    && !body.includes('ログイン')
    && matchesLightchainSignature(tool, body)
  ), {
    url: page.url(),
    bodyExcerpt: body.slice(0, 600),
  });
}

function recordFeatureAssertion(result, name, ok, details = {}) {
  const id = `${result.id}:${name}`;
  result.assertions.push({ id, ok: Boolean(ok), details });
  addAssertion(id, ok, details);
}

async function uploadMaterialAndWaitForMaskControls(page, filePath) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator('input[type="file"]').first().setInputFiles(filePath);
    await page.waitForTimeout(500);
    const ready = await page.getByRole('button', { name: 'AIマスク認識' }).first().isEnabled({ timeout: 3000 }).catch(() => false);
    if (ready) return;
  }
  throw new Error('material_upload_did_not_enable_mask_controls');
}

async function selectLastPlacement(page) {
  await openDetails(page, 'レイヤー詳細');
  const select = page.locator('select').first();
  if (!(await select.isVisible({ timeout: 1000 }).catch(() => false))) throw new Error('placement_select_missing_after_opening_layer_details');
  const labels = await select.locator('option').evaluateAll((options) => options.map((option) => option.textContent || '').filter(Boolean));
  if (labels.length === 0) throw new Error('placement_options_missing');
  const expectedPlacement = labels[labels.length - 1];
  await select.selectOption({ label: expectedPlacement });
  return expectedPlacement;
}

async function selectMaskCandidate(page, candidate) {
  const panel = page
    .getByText('保存したい範囲を選択してください')
    .first()
    .locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]');
  await panel.getByRole('button', { name: exactText(candidate) }).click();
}

function firstLayerLabelForCategory(category) {
  return catalog.categoryLayerLabels[category]?.[0] ?? '素材ベース';
}

function isReadOnlyWorkspaceTool(toolId) {
  return ['marketing-home', 'design-agent', 'lab', 'fashion-studio', 'print-design-project', 'wear-design-lab', 'custom-style'].includes(toolId);
}

function matchesLightchainSignature(tool, body) {
  const hasGenerationAndHistory = (body.includes('AI生成') || body.includes('権限がありません')) && /履歴/.test(body);
  if (tool.id === 'fashion-studio') return body.includes('ファッションスタジオ') && body.includes('スタジオ案履歴') && body.includes('360度表示');
  if (tool.id === 'marketing-home') return body.includes('マーケティングワークスペース') && body.includes('おすすめのシーン');
  if (tool.id === 'design-agent') return body.includes('今日は何から始めますか') && body.includes('商品企画') && body.includes('AIグラフィックデザイン');
  if (tool.id === 'lab') return body.includes('ラボ') && body.includes('参考事例');
  if (tool.id === 'wear-design-lab') return body.includes('新規ファイル') && body.includes('参考事例');
  if (tool.id === 'wear-design-detail') return body.includes('ガイドを見る') && body.includes('ガイドを表示しない');
  if (tool.id === 'print-design-project') return body.includes('柄・グラフィック') && body.includes('新規ファイル');
  if (tool.id === 'print-design-detail') return body.includes('ガイドを見る') && body.includes('ガイドを表示しない');
  if (tool.id === 'custom-style') return body.includes('カスタムスタイル') && body.includes('ラーニング素材');
  if (tool.id === 'marketing-detail') return body.includes('マーケティングワークスペース') && body.includes('AIアシスタント');
  if (['ai-fitting', 'ai-fitting-reference', 'fitting-clothing-reference', 'fitting-background-reference'].includes(tool.id)) {
    return body.includes('AIフィッティング') && hasGenerationAndHistory;
  }
  if (tool.id === 'model-library') return body.includes('モデルカスタマイズ') && body.includes('ラベル') && body.includes('性別');
  if (['model-face', 'model-change', 'body-shape', 'clothing-size', 'pose-change', 'background-change', 'angle-change', 'model-custom'].includes(tool.id)) {
    return body.includes(tool.title) && hasGenerationAndHistory;
  }
  if (tool.id === 'pattern-vector-pro') {
    return body.includes('パターンをベクター画像に変換（プロフェッショナル版）') && hasGenerationAndHistory;
  }
  if (['fabric-image', 'printing-image', 'line-generation', 'line-to-real', 'pattern-vector', 'image-repair', 'svg-convert'].includes(tool.id)) {
    return body.includes(tool.title) && hasGenerationAndHistory;
  }
  return body.includes(tool.title);
}

function isDirectFeatureHref(href) {
  if (!href || href.startsWith('/lightchain/')) return false;
  return [
    '/generate',
    '/designProduction',
    '/marketing',
    '/model',
    '/model-library',
    '/fitting',
    '/flow',
    '/agent',
    '/lab',
    '/model-library',
    '/studio',
    '/patterns',
    '/tools',
    '/editor',
    '/printing',
    '/brand/settings',
    '/canvas',
    '/workflows',
  ].some((prefix) => href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`));
}

function isFeatureEntrypointHref(href) {
  return href?.startsWith('/lightchain/') || isDirectFeatureHref(href);
}

function isVideoHref(href) {
  return href === '/flow/GenerateShortVideo'
    || href.startsWith('/flow/GenerateShortVideo/')
    || href.startsWith('/flow/GenerateShortVideo?');
}

function urlMatchesHref(url, href) {
  const parsed = new URL(url);
  const actual = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return actual === href || actual.startsWith(href);
}

function directFeatureDestinationLoaded(href, body) {
  if (href.startsWith('/generate?feature=')) {
    const params = new URLSearchParams(href.split('?')[1] || '');
    const lcTitle = params.get('lcTitle');
    return body.includes('生成') && (!lcTitle || body.includes(lcTitle) || body.includes('制作条件'));
  }
  if (href.startsWith('/lightchain/')) {
    const toolId = href.split('/').pop();
    const tool = catalog.tools.find((item) => item.id === toolId);
    return tool ? matchesLightchainSignature(tool, body) : body.trim().length > 0 && !body.includes('ログイン');
  }
  if (href.startsWith('/generate?category=')) return body.includes('HEAVY CHAIN AI') || body.includes('おすすめ');
  if (href === '/canvas/new') return body.includes('プロパティ') || body.includes('キャンバス');
  if (href.startsWith('/workflows/')) return body.includes('ワークフロー') || body.includes('生成');
  return body.trim().length > 0 && !body.includes('ログイン');
}

async function waitForDirectFeatureDestination(page, href) {
  if (href.startsWith('/lightchain/')) {
    // React Router keeps the unified shell mounted while the lazy feature
    // page resolves. Wait for the feature-owned DOM before reading the body;
    // otherwise a fast click can be judged against the shell-only frame.
    await page.locator('[data-testid^="lightchain-"]').first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => undefined);
    return;
  }
  if (href === '/canvas/new') {
    await page.getByText('画像を置いて、機能を選ぶ').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    return;
  }
  if (href === '/model' || href.startsWith('/model#') || href === '/fitting' || href.startsWith('/fitting#')) {
    await page.getByText(/高精度AI(で)?切り抜き?/).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    return;
  }
  if (href.startsWith('/generate?feature=')) {
    await page.getByText('生成').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  }
}

async function openDetails(page, summaryText) {
  const summary = page.locator('summary').filter({ hasText: summaryText }).first();
  if (await summary.isVisible({ timeout: 1000 }).catch(() => false)) {
    const isOpen = await summary.evaluate((node) => node.parentElement?.hasAttribute('open') ?? false);
    if (!isOpen) await summary.click();
  }
}

async function screenshot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, timeout: 30_000 });
  evidence.screenshots[name] = file;
}

function addAssertion(id, ok, details = {}) {
  evidence.assertions.push({ id, ok: Boolean(ok), details });
}

function wirePageDiagnostics(page, route) {
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      if (localPreview && /Failed to load resource: the server responded with a status of 401/.test(message.text())) return;
      if (localPreview && /Failed to load resource:.*fonts\.gstatic\.com/iu.test(message.text())) return;
      if (localPreview && /blocked by client|ERR_BLOCKED_BY_CLIENT|Failed to load resource:.*(?:blocked|ERR_FAILED)/iu.test(message.text())) return;
      if (/Remote workspace artifact save failed; falling back to localStorage/.test(message.text())) return;
      if (/Falling back to table usage summary/.test(message.text())) return;
      evidence.consoleMessages.push({ route, type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => evidence.pageErrors.push({ route, message: error.message }));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    if (failure === 'net::ERR_ABORTED') return;
    if (localPreview && /ERR_BLOCKED_BY_CLIENT|blockedbyclient/iu.test(failure)) return;
    if (localPreview && request.url().startsWith('https://fonts.gstatic.com/')) return;
    evidence.requestFailures.push({
      route,
      url: request.url(),
      failure,
    });
  });
}

async function dismissBlockingOverlays(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialogs = page.locator('[role="dialog"]:visible');
    const dialogCount = await dialogs.count();
    if (dialogCount === 0) break;
    let dismissed = false;
    for (let index = 0; index < dialogCount; index += 1) {
      const dialog = dialogs.nth(index);
      // Light Chain's case dialog uses an icon-only close control. Prefer its
      // explicit accessible contract over a broad role/name lookup, which can
      // miss the control while React is settling the dialog subtree.
      const closeButton = dialog.locator('button[aria-label="閉じる"], button').first();
      if (await closeButton.isVisible({ timeout: 500 }).catch(() => false)) {
        await closeButton.click({ force: true }).catch(() => {});
        dismissed = true;
        await page.waitForTimeout(150);
      }
    }
    await page.keyboard.press('Escape').catch(() => {});
    if (!dismissed) break;
    await page.waitForTimeout(150);
  }
  for (const text of ['スキップ', '閉じる', 'あとで', '完了', 'OK']) {
    const button = page.getByRole('button', { name: text }).first();
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(250);
    }
  }
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

async function waitForSettledRoute(page, toolOrId) {
  const tool = typeof toolOrId === 'string'
    ? catalog.tools.find((candidate) => candidate.id === toolOrId) ?? { id: toolOrId, title: toolOrId }
    : toolOrId;
  await page.waitForFunction(() => document.body?.innerText.trim().length > 0, null, { timeout: 10_000 });

  // React.lazy may expose a short loading shell, or briefly leave that shell
  // in the visible text while the route-owned component mounts. Poll the same
  // signature used by the actual assertion from Node, so this gate cannot
  // pass on a non-empty fallback and cannot hang without a bounded error.
  const deadline = Date.now() + 45_000;
  let lastBody = '';
  while (Date.now() < deadline) {
    lastBody = await bodyText(page);
    if (matchesLightchainSignature(tool, lastBody)) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`lightchain_route_signature_timeout:${tool.id}:${lastBody.slice(0, 240)}`);
}

async function waitForLightchainCategory(page, categoryId) {
  const expectedLabels = {
    recommended: 'おすすめ',
    planning: '企画デザインツール',
    fitting: 'AIフィッティング',
    graphics: 'グラフィックツール',
  };
  await page.waitForFunction((expectedLabel) => {
    const selectedTab = document.querySelector('[role="tablist"][aria-label="Light Chainカテゴリ"] [role="tab"][aria-selected="true"]');
    return selectedTab?.textContent?.includes(expectedLabel) ?? false;
  }, expectedLabels[categoryId], { timeout: 15_000 });
}

function readLightchainCatalog() {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/LightchainWorkbenchPage.tsx'), 'utf8');
  const toolsBlock = source.match(/const tools: CompatTool\[] = \[([\s\S]+?)\];\n\nconst statusLabel/)
    ?? source.match(/const tools: CompatTool\[] = \[([\s\S]+?)\];\n\nfor \(const \[index, tool\] of tools\.entries\(\)/);
  const categoryBlock = source.match(/const categoryWorkbenchLabels:[\s\S]+?= \{([\s\S]+?)\n\};\n\nconst encodeSvgDataUrl/);
  const tools = [];
  if (toolsBlock) {
    for (const match of toolsBlock[1].matchAll(/\{\s*id: '([^']+)'[\s\S]+?title: '([^']+)'[\s\S]+?category: '([^']+)'/g)) {
      if (skippedToolIds.has(match[1])) continue;
      tools.push({ id: match[1], title: match[2], category: match[3] });
    }
  }
  const categoryLayers = {};
  const categoryLayerLabels = {};
  if (categoryBlock) {
    const categories = ['home', 'marketing', 'fitting', 'planning', 'graphics', 'model', 'video', 'lab'];
    for (const category of categories) {
      const block = extractObjectBlock(categoryBlock[1], category);
      const layersLine = block?.match(/layers: \[(.+)\],/)?.[1] ?? '';
      const layerPairs = [...layersLine.matchAll(/\['([^']+)', '([^']+)'\]/g)];
      categoryLayers[category] = layerPairs.map((pair) => pair[1]);
      categoryLayerLabels[category] = layerPairs.map((pair) => pair[2]);
    }
  }
  return { tools, categoryLayers, categoryLayerLabels };
}

function extractObjectBlock(source, key) {
  const start = source.indexOf(`${key}: {`);
  if (start === -1) return null;
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  return null;
}

async function startPreviewServer(targetBaseUrl, distDir) {
  const { port } = new URL(targetBaseUrl);
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', targetBaseUrl);
    const pathname = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
    const candidatePath = path.resolve(distDir, pathname);
    const safePath = candidatePath.startsWith(`${distDir}${path.sep}`) || candidatePath === distDir
      ? candidatePath
      : path.join(distDir, 'index.html');
    const filePath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
      ? safePath
      : path.join(distDir, 'index.html');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', contentTypeForPath(filePath));
    fs.readFile(filePath, (error, data) => {
      if (!error) {
        response.end(data);
        return;
      }
      const fallbackPath = path.join(distDir, 'index.html');
      response.setHeader('Content-Type', contentTypeForPath(fallbackPath));
      fs.readFile(fallbackPath, (fallbackError, fallbackData) => {
        if (fallbackError) {
          response.statusCode = 500;
          response.end(`static_server_read_error:${fallbackError.code || fallbackError.message}`);
          return;
        }
        response.end(fallbackData);
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port || '4173'), '127.0.0.1', resolve);
  });
  return server;
}

async function stopPreviewServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function contentTypeForPath(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

async function waitForUrl(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok || response.status < 500) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`preview_server_unavailable:${url}`);
}

function buildStorageStateForBaseUrl(storageStatePath, targetBaseUrl) {
  const raw = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
  const targetOrigin = new URL(targetBaseUrl).origin;
  const origins = Array.isArray(raw.origins)
    ? raw.origins.map((origin) => ({ ...origin, origin: targetOrigin }))
    : [];
  return { ...raw, origins };
}

async function installLocalProofAuth(browserContext) {
  const userId = '00000000-0000-4000-8000-000000000033';
  const email = 'lightchain-all-feature-local-proof@example.test';
  const token = 'local-cloudflare-proof-token';
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const localProofPayload = {
    user: { id: userId, email, name: 'Local Proof User', emailVerified: true, createdAt: new Date(0).toISOString() },
    session: { token, expiresAt },
  };

  // Keep local preview auth on the same-origin Cloudflare contract. This never
  // talks to a provider or adopts an external identity.
  await browserContext.route('**/api/auth/ok', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  });
  await browserContext.route('**/api/auth/get-session', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(localProofPayload),
    });
  });
  await browserContext.route('**/api/auth/**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(localProofPayload),
    });
  });

  await browserContext.addInitScript(() => window.localStorage.clear());
}

async function installLocalCloudflareMocks(browserContext) {
  const userId = '00000000-0000-4000-8000-000000000033';
  const brandId = '00000000-0000-4000-8000-000000000133';
  const now = new Date().toISOString();
  const profile = {
    id: userId,
    email: 'lightchain-all-feature-local-proof@example.test',
    name: 'Local Proof User',
    avatar_url: null,
    created_at: now,
    updated_at: now,
    language: 'ja',
    is_admin: false,
  };
  const brand = {
    id: brandId,
    owner_id: userId,
    name: 'Heavy Chain Local Proof',
    slug: 'heavy-chain-local-proof',
    logo_url: null,
    tone_description: 'Heavy Chain parity proof brand',
    target_audience: 'Proof users',
    brand_colors: { primary: '#65d3cf', secondary: '#111719' },
    created_at: now,
    updated_at: now,
  };

  // Local feature coverage must remain on the synthetic Cloudflare contract.
  // Without this route, the public VITE API origin leaks into the local
  // browser and turns an otherwise successful fixture run into a CORS failure.
  await browserContext.route('**/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/v1/profile')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) });
      return;
    }
    if (/\/v1\/brands(?:\/.*)?$/.test(pathname)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([brand]) });
      return;
    }
    if (/\/v1\/(?:image-folders|folders|tags|style-presets|generated-images|generation-jobs|workspace-execution-steps)(?:\/|$)/.test(pathname)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function installLocalContextGuard(browserContext, targetBaseUrl) {
  const target = new URL(targetBaseUrl);
  const targetOrigin = target.origin;

  // Register the context-wide guard after fixture handlers so allowed requests
  // can fall through to synthetic handlers, while this newest handler remains
  // the fail-closed decision point for every request before a page is created.
  await browserContext.route('**/*', async (route) => {
    const request = route.request();
    const decision = classifyLocalHttpRequest(request.url(), request.method(), request.resourceType(), targetOrigin);
    recordBoundaryDecision({ kind: 'http', ...decision });
    if (decision.action === 'block') {
      await route.abort('blockedbyclient');
      return;
    }
    await route.fallback();
  });

  await browserContext.routeWebSocket('**/*', async (webSocket) => {
    const decision = classifyLocalWebSocketRequest(webSocket.url(), target);
    recordBoundaryDecision({ kind: 'websocket', ...decision });
    if (decision.action === 'block') {
      await webSocket.close({ code: 1008, reason: 'local_boundary_blocked' });
      return;
    }
    webSocket.connectToServer();
  });
}

function classifyLocalHttpRequest(requestUrl, method, resourceType, targetOrigin) {
  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return { action: 'block', reason: 'invalid_request_url', url: requestUrl, method, resourceType };
  }
  if (['data:', 'blob:', 'about:'].includes(parsed.protocol)) {
    return { action: 'allow', reason: 'local_safe_resource_scheme', url: requestUrl, method, resourceType };
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== targetOrigin || !isLoopbackUrl(parsed.toString())) {
    return { action: 'block', reason: 'non_loopback_http_or_https', url: requestUrl, method, resourceType };
  }
  if (LOCAL_SYNTHETIC_AUTH_PATHS.has(parsed.pathname) && LOCAL_SAFE_HTTP_METHODS.has(method.toUpperCase())) {
    return { action: 'allow', reason: 'synthetic_local_proof_auth', url: requestUrl, method, resourceType };
  }
  if (isLocalBlockedEndpoint(parsed.pathname)) {
    return { action: 'block', reason: 'local_provider_submit_mutation_fail_closed', url: requestUrl, method, resourceType };
  }
  if (!LOCAL_SAFE_HTTP_METHODS.has(method.toUpperCase())) {
    return { action: 'block', reason: 'local_mutation_method_fail_closed', url: requestUrl, method, resourceType };
  }
  return { action: 'allow', reason: 'same_loopback_app_traffic', url: requestUrl, method, resourceType };
}

function classifyLocalWebSocketRequest(requestUrl, target) {
  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return { action: 'block', reason: 'invalid_websocket_url', url: requestUrl };
  }
  const sameLoopbackApp = ['ws:', 'wss:'].includes(parsed.protocol)
    && isLoopbackHostname(parsed.hostname)
    && parsed.hostname === target.hostname
    && parsed.port === target.port;
  if (!sameLoopbackApp) return { action: 'block', reason: 'external_websocket_fail_closed', url: requestUrl };
  if (isLocalBlockedEndpoint(parsed.pathname)) {
    return { action: 'block', reason: 'local_provider_submit_mutation_fail_closed', url: requestUrl };
  }
  return { action: 'allow', reason: 'same_loopback_app_websocket', url: requestUrl };
}

function isLocalBlockedEndpoint(pathname) {
  if (LOCAL_SYNTHETIC_AUTH_PATHS.has(pathname)) return false;
  return LOCAL_BLOCKED_ENDPOINT_PATTERNS.some((pattern) => pattern.test(pathname));
}

function recordBoundaryDecision(decision) {
  evidence.boundaryDecisions.push({ at: new Date().toISOString(), ...decision });
}

function assertLocalExecutionBoundary(targetBaseUrl, rawAuthStatePath) {
  let parsed;
  try {
    parsed = new URL(targetBaseUrl);
  } catch {
    throw new Error('local_mode_requires_loopback_base_url');
  }
  if (!isLoopbackUrl(targetBaseUrl) || parsed.username || parsed.password) {
    throw new Error('local_mode_requires_explicit_loopback_base_url');
  }
  if (rawAuthStatePath !== null) throw new Error('local_mode_rejects_auth_state_use');
}

function createFreshOutputDirectory(requestedPath) {
  if (requestedPath !== undefined && typeof requestedPath !== 'string') {
    throw new Error('output_path_must_be_a_string');
  }
  if (requestedPath) {
    const directory = path.resolve(requestedPath);
    if (fs.existsSync(directory)) throw new Error(`output_directory_already_exists:${directory}`);
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    fs.mkdirSync(directory);
    if (fs.existsSync(path.join(directory, 'SUMMARY.json'))) {
      throw new Error(`output_summary_already_exists:${path.join(directory, 'SUMMARY.json')}`);
    }
    return directory;
  }
  const root = path.resolve('output/playwright');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, `lightchain-all-feature-workflows-${dateStamp()}-`));
}

function isLoopbackUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '::1' || /^127\./.test(normalized);
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, '');
}

function dateStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
}

function exactText(value) {
  return new RegExp(`^${escapeRegExp(value)}$`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const inlineAssignment = arg.indexOf('=');
    const key = arg.slice(2, inlineAssignment === -1 ? undefined : inlineAssignment);
    if (inlineAssignment !== -1) {
      parsed[key] = arg.slice(inlineAssignment + 1);
      continue;
    }
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

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ]);
}
