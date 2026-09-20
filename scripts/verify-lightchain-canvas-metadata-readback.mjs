#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium, expect } from '@playwright/test';
import sharp from 'sharp';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4184');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/lightchain-canvas-metadata-readback-${dateStamp()}`;
const onlyToolId = args.only || null;
const canvasStoreKey = 'heavy-chain-canvas';
const viewport = { width: 1440, height: 1050 };
const localPreview = isLocalPreview(baseUrl);
const canUseAuthState = !localPreview && fs.existsSync(authStatePath);

const fixturePng =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAIAAADrOSKFAAABfklEQVR4nO3VwQ2DMBQFQYp2/6mOBtYiHhSg2R+TR6VJ4FD3Yh8nAAAAAAAAAAAAAAAAAAAAAACwq3n7vQG8Lr3f93nP8xz7B2z67bLvG7BXn8z3/V6f8yP4nff4+v0G7NVd9j7f6wN4u9QzAAAAAAAAAAAAAAAAAADgT2EDAiwIsCDAggALAiysx8O+vV6vR3e73V6vV6vR6fP5/PL5fL1eL5fL5fL5fL5fK9Xq9Xq9Xq9Xq9Xq9Xq8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLw8Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Px8fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fAAAAAAAAAAAAAAAAAAAAAAD4O8EGAiwIsCDAggALAiysQw4oEJQ4AAAAAElFTkSuQmCC';

const fixtureSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900">
    <rect width="720" height="900" fill="#ffffff"/>
    <path d="M214 258 L318 166 L360 206 L402 166 L506 258 L574 338 L502 392 L480 792 L240 792 L218 392 L146 338 Z"
      fill="#2f6f9f" stroke="#173f5d" stroke-width="10" stroke-linejoin="round"/>
    <path d="M300 190 Q360 258 420 190" fill="none" stroke="#d7eef8" stroke-width="12"/>
    <path d="M252 420 H468 M252 470 H468" stroke="#8fc3db" stroke-width="8" opacity="0.8"/>
  </svg>
`;
const fixtureSource = fixtureSvg || Buffer.from(fixturePng, 'base64');
const fixtureBuffer = await sharp(Buffer.from(fixtureSource)).png().toBuffer();
const localProofImageUrl = `data:image/png;base64,${fixtureBuffer.toString('base64')}`;
let localProofSequence = 0;

fs.mkdirSync(outDir, { recursive: true });
const primaryUploadPath = path.join(outDir, 'lightchain-primary-upload.png');
const secondaryUploadPath = path.join(outDir, 'lightchain-secondary-upload.png');
fs.writeFileSync(primaryUploadPath, fixtureBuffer);
fs.writeFileSync(secondaryUploadPath, fixtureBuffer);

const evidence = {
  workflow: 'lightchain-canvas-metadata-readback',
  capturedAt: new Date().toISOString(),
  baseUrl,
  authState: canUseAuthState ? authStatePath : 'local-proof-jwt',
  outDir,
  routes: [],
  assertions: [],
  screenshots: {},
  externalRequests: [],
  apiRequests: [],
  blockedGenerationRequests: [],
  consoleMessages: [],
  pageErrors: [],
  requestFailures: [],
  cleanup: {
    contextClosed: false,
    browserClosed: false,
    previewStopped: false,
  },
};

let previewProcess = null;
let browser = null;
let context = null;

try {
  if (localPreview) previewProcess = await startPreviewServer(baseUrl);
  if (!localPreview && !canUseAuthState) throw new Error(`auth_state_missing:${authStatePath}`);

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext(canUseAuthState
    ? { storageState: buildStorageStateForBaseUrl(authStatePath, baseUrl), viewport }
    : { viewport });
  if (!canUseAuthState) {
    await installLocalCloudflareMocks(context);
    await installLocalProofAuth(context);
  }
  await installGenerationNetworkGuard(context);

  const routes = [
    ['fabric-image', verifyFabricImageCanvasReadback],
    ['printing-image', verifyPrintingImageCanvasReadback],
    ['line-to-real', verifyLineToRealCanvasReadback],
    ['line-generation', verifyLineGenerationCanvasReadback],
    ['pattern-vector-pro', verifyPatternVectorProCanvasReadback],
    ['svg-convert', verifySvgConvertCanvasReadback],
    ['marketing-detail', verifyMarketingDetailCanvasReadback],
    ['print-design-detail', verifyPrintDesignDetailCanvasReadback],
    ['wear-design-detail', verifyWearDesignDetailCanvasReadback],
    ['custom-style', verifyCustomStyleCanvasReadback],
  ];
  const selectedRoutes = onlyToolId ? routes.filter(([toolId]) => toolId === onlyToolId) : routes;
  const modelToolIds = new Set(['model-custom', 'model-face', 'model-change', 'body-shape', 'clothing-size', 'pose-change', 'background-change', 'angle-change']);
  const workspaceToolIds = new Set(['marketing-home', 'design-agent', 'lab', 'model-library', 'wear-design-lab', 'print-design-project', 'image-repair', 'pattern-vector', 'fashion-studio']);
  if (onlyToolId && selectedRoutes.length === 0 && !modelToolIds.has(onlyToolId) && !workspaceToolIds.has(onlyToolId)) throw new Error(`unknown_only_tool:${onlyToolId}`);
  for (const [, verify] of selectedRoutes) await verify(context);
  if (onlyToolId && modelToolIds.has(onlyToolId)) {
    await verifyModelToolCanvasReadbacks(context, onlyToolId);
  } else if (onlyToolId && workspaceToolIds.has(onlyToolId)) {
    await verifyWorkspaceStyleCanvasReadbacks(context, onlyToolId);
  } else if (!onlyToolId) {
    await verifyModelToolCanvasReadbacks(context);
    await verifyWorkspaceStyleCanvasReadbacks(context);
    await verifyFittingCanvasReadbacks(context);
  }
} catch (error) {
  evidence.exactBlocker = error.message;
  addAssertion('workflow_exception_free', false, { error: error.message });
} finally {
  if (context) {
    await withTimeout(context.close(), 10_000).then(() => {
      evidence.cleanup.contextClosed = true;
    }).catch((error) => {
      evidence.cleanup.contextCloseBlocker = error.message;
    });
  }
  if (browser) {
    await withTimeout(browser.close(), 60_000).then(() => {
      evidence.cleanup.browserClosed = true;
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
}

for (const message of evidence.consoleMessages) {
  if (/Remote workspace artifact save failed; falling back to localStorage/.test(message.text)) continue;
  addAssertion(`console_${message.type}:${message.text}`, false);
}
for (const message of evidence.pageErrors) addAssertion(`page_error:${message}`, false);
for (const failure of evidence.requestFailures) addAssertion(`request_failed:${failure.url}:${failure.failure}`, false);
addAssertion('external_generation_requests_absent', evidence.blockedGenerationRequests.length === 0, {
  blockedGenerationRequests: evidence.blockedGenerationRequests,
  externalRequests: evidence.externalRequests,
});
const unexpectedExternalRequests = evidence.externalRequests.filter((request) => !isAllowedExternalRequest(request.url));
addAssertion('unexpected_external_requests_absent', unexpectedExternalRequests.length === 0, {
  unexpectedExternalRequests,
  allowedExternalRequestPolicy: [
    'Google Fonts stylesheets/fonts',
    'Cloudflare API local-proof fixture',
    'marketing-workspace-artifact localStorage fallback save',
  ],
});
if (!evidence.cleanup.contextClosed) addAssertion('context_cleanup_closed', false, { blocker: evidence.cleanup.contextCloseBlocker ?? 'not_closed' });
if (!evidence.cleanup.browserClosed) addAssertion('browser_cleanup_closed', false, { blocker: evidence.cleanup.browserCloseBlocker ?? 'not_closed' });
if (!evidence.cleanup.previewStopped) addAssertion('preview_cleanup_stopped', false, { blocker: evidence.cleanup.previewStopBlocker ?? 'not_stopped' });

evidence.ok = evidence.assertions.every((assertion) => assertion.ok);
evidence.failed = evidence.assertions.filter((assertion) => !assertion.ok).map((assertion) => assertion.id);
fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({
  ok: evidence.ok,
  failed: evidence.failed,
  routes: evidence.routes.map((route) => route.toolId),
  summaryPath: path.join(outDir, 'SUMMARY.json'),
}, null, 2));
process.exit(evidence.ok ? 0 : 1);

async function verifyFabricImageCanvasReadback(browserContext) {
  const page = await newInstrumentedPage(browserContext, 'fabric-image');
  const route = { toolId: 'fabric-image', assertions: [] };
  evidence.routes.push(route);
  await page.goto(`${baseUrl}/lightchain/fabric-image`, { waitUntil: 'networkidle' });
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  await page.locator('input[type="file"]').nth(0).setInputFiles(primaryUploadPath);
  await page.locator('input[type="file"]').nth(1).setInputFiles(secondaryUploadPath);
  await page.locator('#lightchain-fabric-prompt').fill('シルクサテン、淡い光沢、上衣に自然に反映');
  await admitSourceGeneration(page);
  await page.waitForTimeout(1_000);
  await screenshot(page, 'fabric-image-before-generate');
  await openAndConfirmMaterialRights(page, 'lightchain-fabric-generate');
  await screenshot(page, 'fabric-image-after-generate-trigger');
  // Local proof runs intentionally render an asset-anchored preview, while
  // authenticated production runs render a provider result. Wait for the
  // shared completed-result surface instead of requiring provider provenance
  // in a provider-free local run.
  await waitForMaterialResult(page);
  await screenshot(page, 'fabric-image-after-generate');
  await clickCanvasSave(page);
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await screenshot(page, 'fabric-image-canvas-after-save');

  const readback = await readCanvasProject(page, 'fabric-image');
  const objects = readback.objects;
  const workbenchObject = objects.find((object) => object?.metadata?.feature === 'lightchain-workbench')
    ?? objects.find((object) => object?.metadata?.feature === 'lightchain-material-provider');
  const providerArtifact = findWorkspaceProviderArtifact(readback, 'fabric-image');
  const params = workbenchObject?.metadata?.feature === 'lightchain-workbench'
    ? workbenchObject.metadata.parameters ?? {}
    : buildProviderReadbackParams(providerArtifact, 'fabric-image');
  const workbenchState = params.lightchainWorkbenchState ?? {};
  const materialSlots = Array.isArray(workbenchState.materialSlots) ? workbenchState.materialSlots : [];
  const filledSlots = materialSlots.filter((slot) => slot.hasImage).map((slot) => slot.key).sort();
  recordRouteAssertion(route, 'fabric_canvas_project_saved', Boolean(readback.project?.id && workbenchObject?.id), {
    currentProjectId: readback.storage?.state?.currentProjectId ?? null,
    workbenchObjectId: workbenchObject?.id ?? null,
  });
  recordRouteAssertion(route, 'fabric_lightchain_compat_saved', workbenchObject?.metadata?.lightchainCompat?.lightchainFeatureId === 'fabric-image', {
    lightchainCompat: workbenchObject?.metadata?.lightchainCompat ?? null,
  });
  recordRouteAssertion(route, 'fabric_two_required_slots_saved', JSON.stringify(filledSlots) === JSON.stringify(['primary', 'secondary']), {
    filledSlots,
    materialSlots,
  });
  recordRouteAssertion(route, 'fabric_prompt_and_ratio_saved', params.fabricPrompt?.includes('シルクサテン') && params.imageRatio === '画像比率自動', {
    fabricPrompt: params.fabricPrompt ?? null,
    imageRatio: params.imageRatio ?? null,
  });
  recordRouteAssertion(route, 'fabric_preview_and_plan_saved', Boolean(params.lightchainWorkbenchState?.lightchainResult?.title && params.layerPlan && params.compositionPreview), {
    lightchainResult: params.lightchainWorkbenchState?.lightchainResult ?? null,
    layerPlan: params.layerPlan ?? null,
    compositionPreview: params.compositionPreview ?? null,
  });
  await page.close();
}

async function verifySvgConvertCanvasReadback(browserContext) {
  const page = await newInstrumentedPage(browserContext, 'svg-convert');
  const route = { toolId: 'svg-convert', assertions: [] };
  evidence.routes.push(route);
  await page.goto(`${baseUrl}/lightchain/svg-convert`, { waitUntil: 'networkidle' });
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  await page.locator('input[type="file"]').nth(0).setInputFiles(primaryUploadPath);
  await admitSourceGeneration(page);
  await screenshot(page, 'svg-convert-before-generate');
  await clickGenericGenerateWithRights(page);
  await Promise.race([
    page.getByText('SVGプレビュー', { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 }),
    page.getByAltText('生成結果プレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
    page.getByText(/AI生成結果/).first().waitFor({ state: 'visible', timeout: 10_000 }),
  ]);
  await screenshot(page, 'svg-convert-after-generate');
  await clickCanvasSave(page);
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await screenshot(page, 'svg-convert-canvas-after-save');

  const readback = await readCanvasProject(page, 'svg-convert');
  const objects = readback.objects;
  const workbenchObject = objects.find((object) => object?.metadata?.feature === 'lightchain-workbench');
  const params = workbenchObject?.metadata?.parameters ?? {};
  const lightchainCompat = workbenchObject?.metadata?.lightchainCompat ?? {};
  recordRouteAssertion(route, 'svg_canvas_project_saved', Boolean(readback.project?.id && workbenchObject?.id), {
    currentProjectId: readback.storage?.state?.currentProjectId ?? null,
    workbenchObjectId: workbenchObject?.id ?? null,
  });
  recordRouteAssertion(route, 'svg_lightchain_compat_completed', (
    lightchainCompat.lightchainFeatureId === 'svg-convert'
    && lightchainCompat.lightchainTaskSteps?.[0]?.status === 'completed'
  ), { lightchainCompat });
  recordRouteAssertion(route, 'svg_preview_result_saved', (
    params.lightchainWorkbenchState?.lightchainResult?.title === 'SVGプレビュー'
    || params.lightchainWorkbenchState?.lightchainResult?.title?.includes('平絵をベクター化')
  ), {
    lightchainResult: params.lightchainWorkbenchState?.lightchainResult ?? null,
  });
  recordRouteAssertion(route, 'svg_material_reference_saved', (
    params.materialReference?.hasImage === true
    && params.materialReference?.fileName === path.basename(primaryUploadPath)
  ), { materialReference: params.materialReference ?? null });
  await page.close();
}

async function verifyPrintingImageCanvasReadback(browserContext) {
  const flow = await runMaterialPreviewCanvasFlow(browserContext, {
    toolId: 'printing-image',
    uploadCount: 2,
    waitFor: async (page) => page.getByAltText('生成結果プレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
  });
  const { route, page, readbackData } = flow;
  const { workbenchObject, params, readback } = readbackData;
  const materialSlots = params.lightchainWorkbenchState?.materialSlots ?? [];
  const filledSlots = Array.isArray(materialSlots) ? materialSlots.filter((slot) => slot.hasImage).map((slot) => slot.key).sort() : [];
  recordRouteAssertion(route, 'printing_canvas_project_saved', Boolean(readback.project?.id && workbenchObject?.id), {
    currentProjectId: readback.storage?.state?.currentProjectId ?? null,
    workbenchObjectId: workbenchObject?.id ?? null,
  });
  recordRouteAssertion(route, 'printing_lightchain_compat_saved', workbenchObject?.metadata?.lightchainCompat?.lightchainFeatureId === 'printing-image', {
    lightchainCompat: workbenchObject?.metadata?.lightchainCompat ?? null,
  });
  recordRouteAssertion(route, 'printing_two_required_slots_saved', JSON.stringify(filledSlots) === JSON.stringify(['primary', 'secondary']), {
    filledSlots,
    materialSlots,
  });
  recordRouteAssertion(route, 'printing_material_references_saved', Array.isArray(params.materialReferences) && params.materialReferences.some((item) => item.slotKey === 'secondary'), {
    materialReferences: params.materialReferences ?? null,
  });
  await page.close();
}

async function verifyLineToRealCanvasReadback(browserContext) {
  const flow = await runMaterialPreviewCanvasFlow(browserContext, {
    toolId: 'line-to-real',
    uploadCount: 1,
    beforeGenerate: async (page) => {
      await page.getByRole('button', { name: 'モノクロ線画' }).click();
      await page.locator('#line-to-real-description').fill('デニム素材、金属ジッパー、小さめの襟');
    },
    waitFor: async (page) => page.getByAltText('生成結果プレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
  });
  const { route, page, readbackData } = flow;
  const { workbenchObject, params, readback } = readbackData;
  recordRouteAssertion(route, 'line_to_real_canvas_project_saved', Boolean(readback.project?.id && workbenchObject?.id), {
    currentProjectId: readback.storage?.state?.currentProjectId ?? null,
    workbenchObjectId: workbenchObject?.id ?? null,
  });
  recordRouteAssertion(route, 'line_to_real_lightchain_compat_saved', workbenchObject?.metadata?.lightchainCompat?.lightchainFeatureId === 'line-to-real', {
    lightchainCompat: workbenchObject?.metadata?.lightchainCompat ?? null,
  });
  recordRouteAssertion(route, 'line_to_real_options_saved', (
    params.lineDraftType === 'モノクロ線画'
    && params.lineToRealOutputType === '平置き画像'
    && params.lineToRealPrompt?.includes('デニム素材')
  ), {
    lineDraftType: params.lineDraftType ?? null,
    lineToRealOutputType: params.lineToRealOutputType ?? null,
    lineToRealPrompt: params.lineToRealPrompt ?? null,
  });
  recordRouteAssertion(route, 'line_to_real_preview_state_saved', (
    params.lightchainWorkbenchState?.lightchainResult?.title === '生成中...'
    || params.lightchainWorkbenchState?.lightchainResult?.generationMode === 'provider'
  ), {
    lightchainResult: params.lightchainWorkbenchState?.lightchainResult ?? null,
  });
  await page.close();
}

async function verifyLineGenerationCanvasReadback(browserContext) {
  const flow = await runMaterialPreviewCanvasFlow(browserContext, {
    toolId: 'line-generation',
    uploadCount: 1,
    beforeGenerate: async (page) => {
      await page.getByRole('button', { name: 'モデル図' }).click();
    },
    waitFor: async (page) => Promise.race([
      page.getByAltText('生成結果プレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
      page.getByText('生成中...', { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 }),
      page.getByText(/AI生成結果/).first().waitFor({ state: 'visible', timeout: 10_000 }),
    ]),
  });
  const { route, page, readbackData } = flow;
  const { workbenchObject, params, readback } = readbackData;
  recordRouteAssertion(route, 'line_generation_canvas_project_saved', Boolean(readback.project?.id && workbenchObject?.id), {
    currentProjectId: readback.storage?.state?.currentProjectId ?? null,
    workbenchObjectId: workbenchObject?.id ?? null,
  });
  recordRouteAssertion(route, 'line_generation_lightchain_compat_saved', workbenchObject?.metadata?.lightchainCompat?.lightchainFeatureId === 'line-generation', {
    lightchainCompat: workbenchObject?.metadata?.lightchainCompat ?? null,
  });
  recordRouteAssertion(route, 'line_generation_options_saved', (
    params.lineGenerationImageType === 'モデル図'
    && params.lineGenerationOutputType === '線画'
  ), {
    lineGenerationImageType: params.lineGenerationImageType ?? null,
    lineGenerationOutputType: params.lineGenerationOutputType ?? null,
  });
  recordRouteAssertion(route, 'line_generation_history_state_saved', (
    params.lightchainWorkbenchState?.lightchainResult?.title === '生成中...'
    || params.lightchainWorkbenchState?.lightchainResult?.generationMode === 'provider'
  ), {
    lightchainResult: params.lightchainWorkbenchState?.lightchainResult ?? null,
  });
  await page.close();
}

async function verifyPatternVectorProCanvasReadback(browserContext) {
  const flow = await runMaterialPreviewCanvasFlow(browserContext, {
    toolId: 'pattern-vector-pro',
    uploadCount: 1,
    beforeGenerate: async (page) => {
      await page.getByRole('button', { name: '分割' }).click();
    },
    waitFor: async (page) => page.getByAltText('生成結果プレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
  });
  const { route, page, readbackData } = flow;
  const { workbenchObject, params, readback } = readbackData;
  recordRouteAssertion(route, 'pattern_vector_pro_canvas_project_saved', Boolean(readback.project?.id && workbenchObject?.id), {
    currentProjectId: readback.storage?.state?.currentProjectId ?? null,
    workbenchObjectId: workbenchObject?.id ?? null,
  });
  recordRouteAssertion(route, 'pattern_vector_pro_lightchain_compat_saved', workbenchObject?.metadata?.lightchainCompat?.lightchainFeatureId === 'pattern-vector-pro', {
    lightchainCompat: workbenchObject?.metadata?.lightchainCompat ?? null,
  });
  recordRouteAssertion(route, 'pattern_vector_pro_options_saved', (
    Array.isArray(params.patternVectorLayers)
    && params.patternVectorLayers.includes('積み重ね')
    && params.patternVectorLayers.includes('分割')
    && params.patternVectorGenerationCost === 1
  ), {
    patternVectorLayers: params.patternVectorLayers ?? null,
    patternVectorUsage: params.patternVectorUsage ?? null,
    patternVectorGenerationCost: params.patternVectorGenerationCost ?? null,
  });
  recordRouteAssertion(route, 'pattern_vector_pro_preview_state_saved', (
    params.lightchainWorkbenchState?.lightchainResult?.title === '生成中...'
    || params.lightchainWorkbenchState?.lightchainResult?.generationMode === 'provider'
  ), {
    lightchainResult: params.lightchainWorkbenchState?.lightchainResult ?? null,
  });
  await page.close();
}

async function verifyMarketingDetailCanvasReadback(browserContext) {
  const flow = await runDirectPreviewCanvasFlow(browserContext, {
    toolId: 'marketing-detail',
    beforeGenerate: async (page) => {
      await page.locator('input[type="file"]').nth(0).setInputFiles(primaryUploadPath);
      await page.getByRole('button', { name: 'ブランドストーリーの構築' }).click();
      await page.locator('textarea').fill('EC詳細ページ向けに商品画像を使ったブランドストーリーを作る');
    },
    generate: async (page) => clickGenericGenerateWithRights(page, page.getByRole('button', { name: '更新' })),
    waitFor: async (page) => page.getByAltText('マーケティング詳細プレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
    expectedTitle: 'マーケティング詳細プレビュー',
  });
  assertDirectPreviewCanvasFlow(flow, {
    compatId: 'marketing-detail',
    assertionPrefix: 'marketing_detail',
    expectedTitle: 'マーケティング詳細プレビュー',
    expectedSummaryIncludes: 'EC詳細ページ',
  });
  await flow.page.close();
}

async function verifyPrintDesignDetailCanvasReadback(browserContext) {
  const flow = await runDirectPreviewCanvasFlow(browserContext, {
    toolId: 'print-design-detail',
    beforeGenerate: async (page) => {
      const noGuide = page.getByRole('button', { name: 'ガイドを表示しない' });
      try {
        await expect(noGuide).toBeEnabled({ timeout: 10_000 });
      } catch (error) {
        await screenshot(page, 'print-design-detail-readiness-blocked');
        const readiness = await page.evaluate(() => ({
          gate: document.querySelector('[data-testid="lightchain-brand-resolution-gate"]')?.textContent?.trim() ?? null,
          body: document.body.innerText.slice(0, 3000),
          localStorageKeys: Object.keys(localStorage).sort(),
        }));
        throw new Error(`${error.message}; readiness=${JSON.stringify(readiness)}`);
      }
      await noGuide.click();
      await page.locator('input[type="file"]').nth(0).setInputFiles(primaryUploadPath);
      await page.locator('#print-design-prompt').fill('花柄の密度を上げ、ワンピース向けにリピートしやすく整える');
    },
    generate: async (page) => {
      const button = page.getByTestId('lightchain-print-design-generate');
      return clickGenericGenerateWithRights(page, button);
    },
    waitFor: async (page) => {
      const readback = page.getByTestId('lightchain-print-design-readback');
      try {
        await readback.waitFor({ state: 'visible', timeout: 10_000 });
      } catch (error) {
        await screenshot(page, 'print-design-detail-after-wait');
        const generationError = await page.getByTestId('lightchain-generation-error').textContent().catch(() => null);
        throw new Error(`${error.message}; uiGenerationError=${generationError ?? 'none'}`);
      }
    },
    expectedTitle: '柄・グラフィックプレビュー',
  });
  assertDirectPreviewCanvasFlow(flow, {
    compatId: 'print-design-detail',
    assertionPrefix: 'print_design_detail',
    expectedTitle: '柄・グラフィックプレビュー',
    expectedSummaryIncludes: '花柄の密度',
  });
  await flow.page.close();
}

async function verifyWearDesignDetailCanvasReadback(browserContext) {
  const flow = await runDirectPreviewCanvasFlow(browserContext, {
    toolId: 'wear-design-detail',
    beforeGenerate: async (page) => {
      await page.getByRole('button', { name: 'ガイドを表示しない' }).click();
      await page.locator('input[type="file"]').nth(0).setInputFiles(primaryUploadPath);
      await page.locator('#wear-design-prompt').fill('襟元に花柄刺繍を追加し、元の生地感は維持する');
    },
    generate: async (page) => clickGenericGenerateWithRights(page, page.locator('button:visible').filter({ hasText: 'AI生成' }).last()),
    waitFor: async (page) => page.getByTestId('lightchain-wear-design-readback').waitFor({ state: 'visible', timeout: 10_000 }),
    expectedTitle: 'ディテール変更プレビュー',
  });
  assertDirectPreviewCanvasFlow(flow, {
    compatId: 'wear-design-detail',
    assertionPrefix: 'wear_design_detail',
    expectedTitle: 'ディテール変更プレビュー',
    expectedSummaryIncludes: '花柄刺繍',
  });
  await flow.page.close();
}

async function verifyCustomStyleCanvasReadback(browserContext) {
  const flow = await runDirectPreviewCanvasFlow(browserContext, {
    toolId: 'custom-style',
    beforeGenerate: async (page) => {
      await page.getByPlaceholder('名前を入力してください').fill('Heavy Chain風ブランド学習');
      await page.getByRole('button', { name: 'チームスペース' }).click();
    },
    generate: async (page) => clickGenericGenerateWithRights(page, page.getByRole('button', { name: 'カスタマイズについて連絡する' }).last()),
    waitFor: async (page) => page.getByAltText('カスタムスタイル保存プレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
    expectedTitle: 'カスタムスタイル保存プレビュー',
  });
  assertDirectPreviewCanvasFlow(flow, {
    compatId: 'custom-style',
    assertionPrefix: 'custom_style',
    expectedTitle: 'カスタムスタイル保存プレビュー',
    expectedSummaryIncludes: 'チームスペース',
  });
  await flow.page.close();
}

async function verifyModelToolCanvasReadbacks(browserContext, onlyToolId = null) {
  const modelCases = [
    {
      toolId: 'model-custom',
      expectedTitle: 'モデルカスタマイズ',
      expectedSummary: '女性',
      beforeGenerate: async (page) => {
        await page.getByRole('button', { name: '女性' }).click();
        await page.getByRole('button', { name: 'ハーフ' }).click();
      },
      expectModelState: (state) => state.gender === '女性' && state.half === 'オン',
    },
    {
      toolId: 'model-face',
      expectedSummary: '顔の参考図',
      uploadCount: 2,
      expectModelState: () => true,
    },
    {
      toolId: 'model-change',
      expectedSummary: 'モデル参考画像',
      uploadCount: 2,
      beforeGenerate: async (page) => {
        await page.getByRole('button', { name: 'サイズを維持する' }).click();
      },
      expectModelState: (state) => state.keepSize === 'off',
    },
    {
      toolId: 'body-shape',
      expectedSummary: '女性',
      uploadCount: 1,
      beforeGenerate: async (page) => {
        await page.getByRole('button', { name: '女性' }).click();
        await page.getByRole('button', { name: 'カスタムボディ' }).click();
      },
      expectModelState: (state) => state.bodyGender === '女性' && state.customBody === 'on',
    },
    {
      toolId: 'clothing-size',
      expectedSummary: 'ボトムス',
      uploadCount: 1,
      beforeGenerate: async (page) => {
        await page.getByRole('button', { name: 'ボトムス' }).click();
        await page.getByRole('button', { name: /元のサイズ/ }).click();
      },
      expectModelState: (state) => state.garmentType === 'ボトムス' && state.sourceSize === 'M',
    },
    {
      toolId: 'pose-change',
      expectedSummary: 'ポーズ参考画像',
      uploadCount: 2,
      beforeGenerate: async (page) => {
        await page.getByRole('button', { name: 'カスタム' }).click();
      },
      expectModelState: (state) => state.poseMode === 'カスタム',
    },
    {
      toolId: 'background-change',
      expectedSummary: '背景参考画像',
      uploadCount: 2,
      beforeGenerate: async (page) => {
        await page.getByRole('button', { name: 'カスタム' }).click();
      },
      expectModelState: (state) => state.backgroundMode === 'カスタム',
    },
    {
      toolId: 'angle-change',
      expectedSummary: '背面off',
      uploadCount: 1,
      beforeGenerate: async (page) => {
        await page.getByRole('button', { name: '背面' }).click();
        await page.getByLabel('左視⇔右視').fill('70');
      },
      expectModelState: (state) => state.backView === 'off' && Number(state.angleHorizontal) === 70,
    },
  ];

  const selectedModelCases = onlyToolId ? modelCases.filter(({ toolId }) => toolId === onlyToolId) : modelCases;
  if (onlyToolId && selectedModelCases.length === 0) throw new Error(`unknown_model_tool:${onlyToolId}`);
  for (const modelCase of selectedModelCases) {
    await verifyModelToolCanvasReadback(browserContext, modelCase);
  }
}

async function verifyWorkspaceStyleCanvasReadbacks(browserContext, onlyToolId = null) {
  const workspaceCases = [
    {
      toolId: 'marketing-home',
      assertionPrefix: 'marketing_home',
      mode: 'workspace',
      fillText: 'EC商品画像を使ってSNS向け高級ストリートのマーケティング案を作る',
      expectedTitle: 'マーケティングワークスペース',
      expectedSummary: 'EC商品画像',
    },
    {
      toolId: 'design-agent',
      assertionPrefix: 'design_agent',
      mode: 'workspace',
      fillText: 'ZIMMERMANN RESORT 2026からレディース企画書を作成する',
      expectedTitle: 'デザインエージェント',
      expectedSummary: 'ZIMMERMANN',
    },
    {
      toolId: 'lab',
      assertionPrefix: 'lab',
      mode: 'lab',
      expectedTitle: 'ラボ',
      expectedSummary: '物マーケティング画像',
    },
    {
      toolId: 'model-library',
      assertionPrefix: 'model_library',
      mode: 'material',
      uploadCount: 0,
      beforeGenerate: async (page) => {
        await page.getByRole('button', { name: '女性' }).click();
      },
      expectedTitle: 'モデルカスタマイズプレビュー',
      expectedSummary: '女性',
    },
    {
      toolId: 'wear-design-lab',
      assertionPrefix: 'wear_design_lab',
      mode: 'projectHome',
      expectedTitle: 'ウェアデザインラボ AI生成',
      expectedSummary: '服のディテール',
    },
    {
      toolId: 'print-design-project',
      assertionPrefix: 'print_design_project',
      mode: 'projectHome',
      expectedTitle: '柄・グラフィックプレビュー',
      expectedSummary: 'アパレル向けプリント柄',
    },
    {
      toolId: 'image-repair',
      assertionPrefix: 'image_repair',
      mode: 'material',
      uploadCount: 1,
      expectedTitle: '画像修正プレビュー',
      expectedSummary: '手足の変形を修正',
    },
    {
      toolId: 'pattern-vector',
      assertionPrefix: 'pattern_vector',
      mode: 'material',
      uploadCount: 1,
      beforeGenerate: async (page) => {
        await page.getByRole('button', { name: '分割' }).click();
      },
      expectedTitle: '生成中...',
      expectedSummary: '分割',
    },
    {
      toolId: 'fashion-studio',
      assertionPrefix: 'fashion_studio',
      mode: 'workspace',
      fillText: '黒のチェーン柄フーディーを、白背景モデルと小物でEC向けスタジオ撮影案にする',
      expectedTitle: 'ファッションスタジオ',
      expectedSummary: 'チェーン柄フーディー',
    },
  ];

  const selectedWorkspaceCases = onlyToolId ? workspaceCases.filter(({ toolId }) => toolId === onlyToolId) : workspaceCases;
  if (onlyToolId && selectedWorkspaceCases.length === 0) throw new Error(`unknown_workspace_tool:${onlyToolId}`);
  for (const workspaceCase of selectedWorkspaceCases) {
    await verifyWorkspaceStyleCanvasReadback(browserContext, workspaceCase);
  }
}

async function verifyFittingCanvasReadbacks(browserContext) {
  const fittingCases = [
    {
      toolId: 'ai-fitting',
      assertionPrefix: 'ai_fitting',
      note: '20代モデル、白背景、EC商品ページ向けの自然な着用画像',
      expectedTitle: 'AIフィッティング',
      expectedSummary: 'AIフィッティング',
    },
    {
      toolId: 'ai-fitting-reference',
      assertionPrefix: 'ai_fitting_reference',
      note: 'モデル参照と背景参照を維持し、ポーズを自然に合わせる',
      expectedTitle: 'AIフィッティング 参考画像モード',
      expectedSummary: '参考画像モード',
    },
    {
      toolId: 'fitting-clothing-reference',
      assertionPrefix: 'fitting_clothing_reference',
      note: '衣服画像を平置き変換し、フィッティング用の説明文を生成する',
      expectedTitle: '衣服参考ライブラリ',
      expectedSummary: '衣服参考ライブラリ',
    },
    {
      toolId: 'fitting-background-reference',
      assertionPrefix: 'fitting_background_reference',
      note: '明るいスタジオ背景、EC着用画像で使える撮影条件',
      expectedTitle: '背景参考ライブラリ',
      expectedSummary: '背景参考ライブラリ',
      expectedSlotLabel: '背景画像をアップロード',
    },
  ];

  for (const fittingCase of fittingCases) {
    await verifyFittingCanvasReadback(browserContext, fittingCase);
  }
}

async function verifyFittingCanvasReadback(browserContext, config) {
  const flow = await runMaterialPreviewCanvasFlow(browserContext, {
    toolId: config.toolId,
    uploadCount: 1,
    beforeGenerate: async (page) => {
      await page.locator('textarea').fill(config.note);
    },
    waitFor: async (page) => waitForWorkspaceResult(page, config.expectedTitle),
  });
  const { route, page, readbackData } = flow;
  const { workbenchObject, params, readback } = readbackData;
  const lightchainResult = params.lightchainWorkbenchState?.lightchainResult ?? {};
  const materialSlots = params.lightchainWorkbenchState?.materialSlots ?? [];
  const filledSlots = Array.isArray(materialSlots) ? materialSlots.filter((slot) => slot.hasImage).map((slot) => slot.key).sort() : [];
  const primarySlot = Array.isArray(materialSlots) ? materialSlots.find((slot) => slot.key === 'primary') : null;
  recordRouteAssertion(route, `${config.assertionPrefix}_canvas_project_saved`, Boolean(readback.project?.id && workbenchObject?.id), {
    currentProjectId: readback.storage?.state?.currentProjectId ?? null,
    workbenchObjectId: workbenchObject?.id ?? null,
  });
  recordRouteAssertion(route, `${config.assertionPrefix}_lightchain_compat_saved`, workbenchObject?.metadata?.lightchainCompat?.lightchainFeatureId === config.toolId, {
    lightchainCompat: workbenchObject?.metadata?.lightchainCompat ?? null,
  });
  recordRouteAssertion(route, `${config.assertionPrefix}_preview_result_saved`, (
    (lightchainResult.title === config.expectedTitle || lightchainResult.generationMode === 'provider')
    && lightchainResult.summary?.includes(config.expectedSummary)
    && lightchainResult.summary?.includes(config.note)
    && (lightchainResult.imageUrl?.startsWith('data:image/svg+xml') || lightchainResult.generationMode === 'provider')
  ), {
    expectedTitle: config.expectedTitle,
    expectedSummary: config.expectedSummary,
    expectedNote: config.note,
    lightchainResult,
  });
  recordRouteAssertion(route, `${config.assertionPrefix}_material_slots_saved`, filledSlots.includes('primary'), {
    filledSlots,
    materialSlots,
  });
  if (config.expectedSlotLabel) {
    recordRouteAssertion(route, `${config.assertionPrefix}_material_kind_saved`, (
      primarySlot?.label === config.expectedSlotLabel
      && primarySlot?.materialKind === config.expectedSlotLabel
      && params.materialReference?.materialKind === config.expectedSlotLabel
    ), {
      expectedSlotLabel: config.expectedSlotLabel,
      primarySlot,
      materialReference: params.materialReference ?? null,
    });
  }
  recordRouteAssertion(route, `${config.assertionPrefix}_route_metadata_saved`, (
    params.toolId === config.toolId
    && typeof params.lightchainRoute === 'string'
    && Array.isArray(params.inputs)
    && Array.isArray(params.outputs)
    && params.lightchainWorkbenchState?.referenceNote === config.note
  ), {
    toolId: params.toolId ?? null,
    lightchainRoute: params.lightchainRoute ?? null,
    inputs: params.inputs ?? null,
    outputs: params.outputs ?? null,
    referenceNote: params.lightchainWorkbenchState?.referenceNote ?? null,
  });
  await page.close();
}

async function verifyWorkspaceStyleCanvasReadback(browserContext, config) {
  if (config.mode === 'material') {
    const flow = await runMaterialPreviewCanvasFlow(browserContext, {
      toolId: config.toolId,
      uploadCount: config.uploadCount ?? 0,
      beforeGenerate: config.beforeGenerate,
      waitFor: async (page) => waitForWorkspaceResult(page, config.expectedTitle),
    });
    assertWorkspaceCanvasFlow(flow, config);
    await flow.page.close();
    return;
  }

  const flow = await runDirectPreviewCanvasFlow(browserContext, {
    toolId: config.toolId,
    beforeGenerate: async (page) => {
      if (config.mode === 'workspace' && config.fillText) {
        await page.locator('textarea').first().fill(config.fillText);
      }
    },
    generate: async (page) => {
      if (config.mode === 'lab') {
        await page.waitForTimeout(1_000);
        const newFileButton = page.getByRole('button', { name: /新規ファイル/ });
        try {
          await expect(newFileButton).toBeEnabled({ timeout: 10_000 });
        } catch (error) {
          const diagnostic = await page.evaluate(() => ({
            workflow: document.querySelector('[data-testid="lightchain-lab-home"]')?.getAttribute('data-workflow-feature') ?? null,
            providerRoute: document.querySelector('[data-testid="lightchain-lab-home"]')?.getAttribute('data-lightchain-provider-route') ?? null,
            providerSupported: document.querySelector('[data-testid="lightchain-lab-home"]')?.getAttribute('data-lightchain-provider-supported') ?? null,
            brandPending: document.querySelector('[data-testid="lightchain-lab-home"]')?.getAttribute('data-lightchain-brand-pending') ?? null,
            brandStatus: document.querySelector('[data-testid="lightchain-lab-home"]')?.getAttribute('data-lightchain-brand-status') ?? null,
            brandError: document.querySelector('[data-testid="lightchain-lab-home"]')?.getAttribute('data-lightchain-brand-error') ?? null,
            currentBrand: document.querySelector('[data-testid="lightchain-lab-home"]')?.getAttribute('data-lightchain-current-brand') ?? null,
            providerRights: document.querySelector('[data-testid="lightchain-lab-home"]')?.getAttribute('data-lightchain-provider-rights') ?? null,
            requestActive: document.querySelector('[data-testid="lightchain-lab-home"]')?.getAttribute('data-lightchain-request-active') ?? null,
            generationError: document.querySelector('[data-testid="lightchain-lab-home"]')?.getAttribute('data-lightchain-generation-error') ?? null,
            providerGate: document.querySelector('[data-testid="lightchain-brand-resolution-gate"]')?.textContent?.trim() ?? null,
            body: document.body.innerText.slice(0, 1600),
          }));
          throw new Error(`${error.message}; lab_button_diagnostic=${JSON.stringify(diagnostic)}`);
        }
        await clickGenericGenerateWithRights(page, newFileButton);
        return;
      }
      if (config.toolId === 'wear-design-lab') {
        await expect(page.getByTestId('lightchain-workspace-generate').last()).toBeEnabled({ timeout: 10_000 });
        await page.evaluate(async () => {
          const button = document.querySelector('[data-testid="lightchain-workspace-generate"]');
          if (!(button instanceof HTMLButtonElement)) throw new Error('wear_design_generate_button_missing');
          const propsKey = Object.keys(button).find((key) => key.startsWith('__reactProps$'));
          const onClick = propsKey ? button[propsKey]?.onClick : null;
          if (typeof onClick !== 'function') throw new Error('wear_design_generate_handler_missing');
          await onClick();
        });
        await page.waitForTimeout(500);
        return;
      }
      if (config.toolId === 'print-design-project') {
        await clickGenericGenerateWithRights(page, page.getByRole('button', { name: /生成へ/ }));
        return;
      }
      const generateButton = page.getByTestId('lightchain-workspace-generate').last();
      try {
        await expect(generateButton).toBeEnabled({ timeout: 10_000 });
      } catch (error) {
        const diagnostic = await page.evaluate(() => {
          const root = document.querySelector('[data-workflow-feature]');
          return {
            providerRoute: root?.getAttribute('data-lightchain-provider-route') ?? null,
            brandPending: root?.getAttribute('data-lightchain-brand-pending') ?? null,
            aiDisabled: root?.getAttribute('data-lightchain-ai-disabled') ?? null,
            providerRights: root?.getAttribute('data-lightchain-provider-rights') ?? null,
            requestActive: root?.getAttribute('data-lightchain-request-active') ?? null,
            brandStatus: root?.getAttribute('data-lightchain-brand-status') ?? null,
            brandError: root?.getAttribute('data-lightchain-brand-error') ?? null,
            currentBrand: root?.getAttribute('data-lightchain-current-brand') ?? null,
            providerGate: document.querySelector('[data-testid="lightchain-brand-resolution-gate"]')?.textContent?.trim() ?? null,
            generationError: document.querySelector('[data-testid="lightchain-generation-error"]')?.textContent?.trim() ?? null,
          };
        });
        throw new Error(`${error.message}; workspace_generate_disabled_diagnostic=${JSON.stringify(diagnostic)}`);
      }
      const tutorialSkip = page.getByTestId('lightchain-workspace-tutorial-skip');
      if (await tutorialSkip.isVisible().catch(() => false)) await tutorialSkip.click();
      await page.waitForTimeout(1_000);
      await clickGenericGenerateWithRights(page, generateButton, { force: true });
    },
    waitFor: async (page) => {
      if (config.mode === 'lab') {
        try {
          await page.getByTestId('lightchain-lab-result-save').waitFor({ state: 'visible', timeout: 30_000 });
        } catch (error) {
          const diagnostic = await page.evaluate(() => {
            const root = document.querySelector('[data-testid="lightchain-lab-home"]');
            return {
              url: window.location.href,
              providerRoute: root?.getAttribute('data-lightchain-provider-route') ?? null,
              providerSupported: root?.getAttribute('data-lightchain-provider-supported') ?? null,
              brandPending: root?.getAttribute('data-lightchain-brand-pending') ?? null,
              brandStatus: root?.getAttribute('data-lightchain-brand-status') ?? null,
              brandError: root?.getAttribute('data-lightchain-brand-error') ?? null,
              currentBrand: root?.getAttribute('data-lightchain-current-brand') ?? null,
              providerRights: root?.getAttribute('data-lightchain-provider-rights') ?? null,
              requestActive: root?.getAttribute('data-lightchain-request-active') ?? null,
              generationError: root?.getAttribute('data-lightchain-generation-error') ?? null,
              reactButton: (() => {
                const button = Array.from(document.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes('新規ファイル'));
                if (!button) return null;
                const propsKey = Object.keys(button).find((key) => key.startsWith('__reactProps$'));
                const props = propsKey ? button[propsKey] : null;
                return { reactPropKeys: props ? Object.keys(props) : [], onClickType: typeof props?.onClick, onClickSource: typeof props?.onClick === 'function' ? String(props.onClick).slice(0, 600) : null };
              })(),
              lifecycle: root?.getAttribute('data-workflow-lifecycle') ?? null,
              flowState: root?.getAttribute('data-flow-state') ?? null,
              buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
                text: button.textContent?.trim() ?? '', disabled: button.disabled,
                testId: button.getAttribute('data-testid'),
              })),
              verifierClicks: Array.isArray(window.__heavyChainVerifierClicks) ? window.__heavyChainVerifierClicks.slice(-20) : [],
              body: document.body.innerText.slice(0, 2500),
            };
          });
          throw new Error(`${error.message}; lab_generation_diagnostic=${JSON.stringify(diagnostic)}`);
        }
        return;
      }
      // Workspace titles are already rendered in the page header before a
      // generation starts. Wait for the result action instead of accepting
      // that static heading as proof that a result exists.
      if (config.mode === 'workspace') {
        try {
          await page.getByTestId('lightchain-workspace-result-save').waitFor({ state: 'visible', timeout: 30_000 });
        } catch (error) {
          const diagnostic = await page.evaluate(() => ({
            workflow: document.querySelector('[data-workflow-feature]')?.getAttribute('data-workflow-feature') ?? null,
            lifecycle: document.querySelector('[data-workflow-lifecycle]')?.getAttribute('data-workflow-lifecycle') ?? null,
            providerRoute: document.querySelector('[data-workflow-feature]')?.getAttribute('data-lightchain-provider-route') ?? null,
            brandPending: document.querySelector('[data-workflow-feature]')?.getAttribute('data-lightchain-brand-pending') ?? null,
            aiDisabled: document.querySelector('[data-workflow-feature]')?.getAttribute('data-lightchain-ai-disabled') ?? null,
            providerRights: document.querySelector('[data-workflow-feature]')?.getAttribute('data-lightchain-provider-rights') ?? null,
            requestActive: document.querySelector('[data-workflow-feature]')?.getAttribute('data-lightchain-request-active') ?? null,
            providerGate: document.querySelector('[data-testid="lightchain-brand-resolution-gate"]')?.textContent?.trim() ?? null,
            generationError: document.querySelector('[data-testid="lightchain-generation-error"]')?.textContent?.trim() ?? null,
            button: (() => {
              const button = document.querySelector('[data-testid="lightchain-workspace-generate"]');
              if (!(button instanceof HTMLButtonElement)) return null;
              const propsKey = Object.keys(button).find((key) => key.startsWith('__reactProps$'));
              const props = propsKey ? button[propsKey] : null;
              return {
                disabled: button.disabled,
                ariaLabel: button.getAttribute('aria-label'),
                reactPropKeys: props ? Object.keys(props) : [],
                onClickName: typeof props?.onClick === 'function' ? props.onClick.name : null,
                onClickSource: typeof props?.onClick === 'function' ? String(props.onClick).slice(0, 240) : null,
              };
            })(),
            reactHookScalars: (() => {
              const button = document.querySelector('[data-testid="lightchain-workspace-generate"]');
              if (!button) return [];
              const fiberKey = Object.keys(button).find((key) => key.startsWith('__reactFiber$'));
              let fiber = fiberKey ? button[fiberKey] : null;
              while (fiber && typeof fiber.type !== 'function') fiber = fiber.return;
              const values = [];
              let hook = fiber?.memoizedState ?? null;
              for (let index = 0; hook && index < 80; index += 1, hook = hook.next) {
                const value = hook.memoizedState;
                if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') {
                  values.push({ index, value });
                }
              }
              return values;
            })(),
            verifierClicks: Array.isArray(window.__heavyChainVerifierClicks) ? window.__heavyChainVerifierClicks.slice(-10) : [],
          }));
          throw new Error(`${error.message}; workspace_generation_diagnostic=${JSON.stringify(diagnostic)}`);
        }
        return;
      }
      try {
        await waitForWorkspaceResult(page, config.expectedTitle);
      } catch (error) {
        const diagnostic = await page.evaluate(() => {
          const root = document.querySelector('[data-workflow-feature]');
          return {
            url: window.location.href,
            workflow: root?.getAttribute('data-workflow-feature') ?? null,
            providerRoute: root?.getAttribute('data-lightchain-provider-route') ?? null,
            providerSupported: root?.getAttribute('data-lightchain-provider-supported') ?? null,
            brandPending: root?.getAttribute('data-lightchain-brand-pending') ?? null,
            brandStatus: root?.getAttribute('data-lightchain-brand-status') ?? null,
            currentBrand: root?.getAttribute('data-lightchain-current-brand') ?? null,
            providerRights: root?.getAttribute('data-lightchain-provider-rights') ?? null,
            requestActive: root?.getAttribute('data-lightchain-request-active') ?? null,
            generationError: document.querySelector('[data-testid="lightchain-generation-error"]')?.textContent?.trim() ?? null,
            buttonHandler: (() => {
              const button = document.querySelector('[data-testid="lightchain-workspace-generate"]');
              if (!button) return null;
              const propsKey = Object.keys(button).find((key) => key.startsWith('__reactProps$'));
              const props = propsKey ? button[propsKey] : null;
              return { reactPropKeys: props ? Object.keys(props) : [], onClick: typeof props?.onClick === 'function' ? String(props.onClick).slice(0, 500) : null };
            })(),
            buttons: Array.from(document.querySelectorAll('button')).map((button) => ({ text: button.textContent?.trim() ?? '', disabled: button.disabled, testId: button.getAttribute('data-testid') })),
            body: document.body.innerText.slice(-3000),
          };
        });
        throw new Error(`${error.message}; project_home_generation_diagnostic=${JSON.stringify(diagnostic)}`);
      }
    },
    expectedTitle: config.expectedTitle,
  });
  assertWorkspaceCanvasFlow(flow, config);
  await flow.page.close();
}

function assertWorkspaceCanvasFlow(flow, config) {
  const { route, readbackData } = flow;
  const { readback, workbenchObject, params } = readbackData;
  const lightchainCompat = workbenchObject?.metadata?.lightchainCompat ?? {};
  const lightchainResult = params.lightchainWorkbenchState?.lightchainResult;
  const materialSlots = params.lightchainWorkbenchState?.materialSlots ?? [];
  recordRouteAssertion(route, `${config.assertionPrefix}_canvas_project_saved`, Boolean(readback.project?.id && workbenchObject?.id), {
    currentProjectId: readback.storage?.state?.currentProjectId ?? null,
    workbenchObjectId: workbenchObject?.id ?? null,
  });
  recordRouteAssertion(route, `${config.assertionPrefix}_lightchain_compat_saved`, lightchainCompat.lightchainFeatureId === config.toolId, {
    lightchainCompat,
  });
  recordRouteAssertion(route, `${config.assertionPrefix}_preview_result_saved`, (
    (lightchainResult?.title === config.expectedTitle || lightchainResult?.generationMode === 'provider')
    && lightchainResult?.summary?.includes(config.expectedSummary)
    && (lightchainResult?.imageUrl?.startsWith('data:image/svg+xml') || lightchainResult?.generationMode === 'provider')
  ), {
    expectedTitle: config.expectedTitle,
    expectedSummary: config.expectedSummary,
    lightchainResult: lightchainResult ?? null,
  });
  recordRouteAssertion(route, `${config.assertionPrefix}_route_metadata_saved`, (
    params.toolId === config.toolId
    && typeof params.lightchainRoute === 'string'
    && Array.isArray(params.inputs)
    && Array.isArray(params.outputs)
  ), {
    toolId: params.toolId ?? null,
    lightchainRoute: params.lightchainRoute ?? null,
    inputs: params.inputs ?? null,
    outputs: params.outputs ?? null,
  });
  if ((config.uploadCount ?? 0) > 0) {
    const filledSlots = Array.isArray(materialSlots) ? materialSlots.filter((slot) => slot.hasImage).map((slot) => slot.key).sort() : [];
    recordRouteAssertion(route, `${config.assertionPrefix}_material_slots_saved`, filledSlots.length >= config.uploadCount, {
      expectedUploads: config.uploadCount,
      filledSlots,
      materialSlots,
    });
  }
}

async function waitForWorkspaceResult(page, expectedTitle) {
  await Promise.race([
    page.getByText(expectedTitle, { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 }),
    page.getByAltText('生成結果プレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
    page.getByText(/AI生成結果/).first().waitFor({ state: 'visible', timeout: 10_000 }),
    page.getByText('生成中...', { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 }),
  ]);
}

async function verifyModelToolCanvasReadback(browserContext, config) {
  const flow = await runMaterialPreviewCanvasFlow(browserContext, {
    toolId: config.toolId,
    uploadCount: config.uploadCount ?? 0,
    beforeGenerate: config.beforeGenerate,
    waitFor: async (page) => {
      try {
        await waitForWorkspaceResult(page, config.expectedTitle ?? config.toolId);
      } catch (error) {
        const diagnostic = await page.evaluate(() => {
          const root = document.querySelector('[data-workflow-feature]');
          return {
            workflow: root?.getAttribute('data-workflow-feature') ?? null,
            providerRoute: root?.getAttribute('data-lightchain-provider-route') ?? null,
            providerSupported: root?.getAttribute('data-lightchain-provider-supported') ?? null,
            brandPending: root?.getAttribute('data-lightchain-brand-pending') ?? null,
            brandStatus: root?.getAttribute('data-lightchain-brand-status') ?? null,
            currentBrand: root?.getAttribute('data-lightchain-current-brand') ?? null,
            providerRights: root?.getAttribute('data-lightchain-provider-rights') ?? null,
            requestActive: root?.getAttribute('data-lightchain-request-active') ?? null,
            generationError: root?.getAttribute('data-lightchain-generation-error') ?? null,
            buttons: Array.from(document.querySelectorAll('button')).filter((button) => {
              const rect = button.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }).map((button) => ({ text: button.textContent?.trim() ?? '', disabled: button.disabled, testId: button.getAttribute('data-testid') })),
            verifierClicks: Array.isArray(window.__heavyChainVerifierClicks) ? window.__heavyChainVerifierClicks.slice(-20) : [],
            body: document.body.innerText.slice(-2400),
          };
        });
        throw new Error(`${error.message}; model_generation_diagnostic=${JSON.stringify(diagnostic)}`);
      }
    },
  });
  const { route, page, readbackData } = flow;
  const { workbenchObject, params, readback } = readbackData;
  const modelState = params.lightchainWorkbenchState?.modelFormState ?? {};
  const lightchainResult = params.lightchainWorkbenchState?.lightchainResult ?? {};
  const materialSlots = params.lightchainWorkbenchState?.materialSlots ?? [];
  const expectedUploads = config.uploadCount ?? 0;
  const filledSlots = Array.isArray(materialSlots) ? materialSlots.filter((slot) => slot.hasImage).map((slot) => slot.key).sort() : [];
  const assertionPrefix = config.toolId.replaceAll('-', '_');
  recordRouteAssertion(route, `${assertionPrefix}_canvas_project_saved`, Boolean(readback.project?.id && workbenchObject?.id), {
    currentProjectId: readback.storage?.state?.currentProjectId ?? null,
    workbenchObjectId: workbenchObject?.id ?? null,
  });
  recordRouteAssertion(route, `${assertionPrefix}_lightchain_compat_saved`, workbenchObject?.metadata?.lightchainCompat?.lightchainFeatureId === config.toolId, {
    lightchainCompat: workbenchObject?.metadata?.lightchainCompat ?? null,
  });
  recordRouteAssertion(route, `${assertionPrefix}_model_form_state_saved`, config.expectModelState(modelState), {
    modelFormState: modelState,
  });
  recordRouteAssertion(route, `${assertionPrefix}_material_slots_saved`, filledSlots.length >= expectedUploads, {
    expectedUploads,
    filledSlots,
    materialSlots,
  });
  recordRouteAssertion(route, `${assertionPrefix}_preview_result_saved`, (
    (lightchainResult.title?.includes('プレビュー') || lightchainResult.generationMode === 'provider')
    && lightchainResult.summary?.includes(config.expectedSummary)
    && (lightchainResult.imageUrl?.startsWith('data:image/svg+xml') || lightchainResult.generationMode === 'provider')
  ), {
    expectedSummary: config.expectedSummary,
    lightchainResult,
  });
  await page.close();
}

async function runMaterialPreviewCanvasFlow(browserContext, config) {
  const page = await newInstrumentedPage(browserContext, config.toolId);
  const route = { toolId: config.toolId, assertions: [] };
  evidence.routes.push(route);
  await page.goto(`${baseUrl}${config.routePath ?? `/lightchain/${config.toolId}`}`, { waitUntil: 'networkidle' });
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  if (config.toolId === 'fabric-image') {
    await page.getByTestId('fabric-design-selector').locator('input[type="file"]').setInputFiles(primaryUploadPath);
    await page.getByTestId('fabric-base-selector').locator('input[type="file"]').setInputFiles(secondaryUploadPath);
  } else if (config.toolId === 'printing-image') {
    await page.locator('[data-testid="print-garment-selector"]:visible').locator('input[type="file"]').setInputFiles(primaryUploadPath);
    await page.locator('[data-testid="print-design-selector"]:visible').locator('input[type="file"]').setInputFiles(secondaryUploadPath);
  } else {
    for (let index = 0; index < config.uploadCount; index += 1) {
      await page.locator('input[type="file"]').nth(index).setInputFiles(index === 0 ? primaryUploadPath : secondaryUploadPath);
    }
  }
  if (config.beforeGenerate) await config.beforeGenerate(page);
  await admitSourceGeneration(page);
  await screenshot(page, `${config.toolId}-before-generate`);
  if (config.toolId === 'printing-image') await openAndConfirmMaterialRights(page, 'lightchain-print-generate');
  else await clickGenericGenerateWithRights(page);
  if (config.toolId === 'fabric-image' || config.toolId === 'printing-image') {
    await waitForMaterialResult(page);
  } else {
    await config.waitFor(page);
  }
  await screenshot(page, `${config.toolId}-after-generate`);
  await clickCanvasSave(page);
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await screenshot(page, `${config.toolId}-canvas-after-save`);
  const readback = await readCanvasProject(page, config.toolId);
  const workbenchObject = readback.objects.find((object) => object?.metadata?.feature === 'lightchain-workbench')
    ?? readback.objects.find((object) => (
      object?.metadata?.feature === 'lightchain-material-provider'
      && object?.metadata?.lightchainCompat?.lightchainFeatureId === config.toolId
    ));
  const params = workbenchObject?.metadata?.feature === 'lightchain-workbench'
    ? workbenchObject.metadata.parameters ?? {}
    : buildProviderReadbackParams(findWorkspaceProviderArtifact(readback, config.toolId), config.toolId);
  return {
    route,
    page,
    readbackData: {
      readback,
      workbenchObject,
      params,
    },
  };
}

async function waitForMaterialResult(page) {
  await Promise.race([
    page.getByRole('button', { name: /^Canvasへ保存$/ }).last().waitFor({ state: 'visible', timeout: 20_000 }),
    page.getByText(/AI生成結果/).first().waitFor({ state: 'visible', timeout: 20_000 }),
  ]);
}

async function runDirectPreviewCanvasFlow(browserContext, config) {
  const page = await newInstrumentedPage(browserContext, config.toolId);
  const route = { toolId: config.toolId, assertions: [] };
  evidence.routes.push(route);
  await page.goto(`${baseUrl}${config.routePath ?? `/lightchain/${config.toolId}`}`, { waitUntil: 'networkidle' });
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  if (config.beforeGenerate) await config.beforeGenerate(page);
  await admitSourceGeneration(page);
  await screenshot(page, `${config.toolId}-before-generate`);
  await config.generate(page);
  await screenshot(page, `${config.toolId}-after-generate-trigger`);
  await config.waitFor(page);
  await screenshot(page, `${config.toolId}-after-generate`);
  await clickCanvasSave(page);
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await screenshot(page, `${config.toolId}-canvas-after-save`);
  const readback = await readCanvasProject(page, config.toolId);
  const workbenchObject = readback.objects.find((object) => object?.metadata?.feature === 'lightchain-workbench')
    ?? readback.objects.find((object) => (
      object?.metadata?.feature === 'lightchain-material-provider'
      && object?.metadata?.lightchainCompat?.lightchainFeatureId === config.toolId
    ));
  const params = workbenchObject?.metadata?.feature === 'lightchain-workbench'
    ? workbenchObject.metadata.parameters ?? {}
    : buildProviderReadbackParams(findWorkspaceProviderArtifact(readback, config.toolId), config.toolId);
  return {
    route,
    page,
    readbackData: {
      readback,
      workbenchObject,
      params,
      lightchainCompat: workbenchObject?.metadata?.lightchainCompat ?? {},
    },
  };
}

function assertDirectPreviewCanvasFlow(flow, config) {
  const { route, readbackData } = flow;
  const { readback, workbenchObject, params, lightchainCompat } = readbackData;
  const lightchainResult = params.lightchainWorkbenchState?.lightchainResult;
  recordRouteAssertion(route, `${config.assertionPrefix}_canvas_project_saved`, Boolean(readback.project?.id && workbenchObject?.id), {
    currentProjectId: readback.storage?.state?.currentProjectId ?? null,
    workbenchObjectId: workbenchObject?.id ?? null,
  });
  recordRouteAssertion(route, `${config.assertionPrefix}_lightchain_compat_saved`, lightchainCompat.lightchainFeatureId === config.compatId, {
    lightchainCompat,
  });
  recordRouteAssertion(route, `${config.assertionPrefix}_preview_result_saved`, (
    (lightchainResult?.title === config.expectedTitle || lightchainResult?.generationMode === 'provider')
    && lightchainResult?.summary?.includes(config.expectedSummaryIncludes)
    && (lightchainResult?.imageUrl?.startsWith('data:image/svg+xml') || lightchainResult?.generationMode === 'provider')
  ), { lightchainResult: lightchainResult ?? null });
}

async function newInstrumentedPage(browserContext, label) {
  const page = await browserContext.newPage();
  page.setDefaultNavigationTimeout(20_000);
  page.setDefaultTimeout(15_000);
  await page.addInitScript(() => {
    window.__heavyChainVerifierClicks = [];
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target) return;
      window.__heavyChainVerifierClicks.push({
        testId: target.getAttribute('data-testid'),
        text: target.textContent?.trim() ?? '',
        disabled: target instanceof HTMLButtonElement ? target.disabled : null,
      });
    }, true);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      if (localPreview && /Failed to load resource: the server responded with a status of 401/.test(message.text())) return;
      if (/Remote workspace artifact save failed; falling back to localStorage/.test(message.text())) return;
      if (/^Canvas2D: Multiple readback operations using getImageData/.test(message.text())) return;
      if (/^Canvas render state \{/.test(message.text())) return;
      if (/wasm streaming compile failed|falling back to ArrayBuffer instantiation|ERR_BLOCKED_BY_CLIENT\.Inspector/.test(message.text())) return;
      if (/Model download failed|Failed to download model u2net_cloth_seg|Point-prompt garment model preload unavailable|\[downloadModel\] Failed after|\[initialize\] Failed after/.test(message.text())) return;
      if (/Failed to load resource: net::ERR_FAILED/.test(message.text())) return;
      // Local proof intentionally returns 404 for an absent workspace artifact
      // before the first remote save; this is the expected reconciliation path.
      if (localPreview && /Failed to load resource: the server responded with a status of 404/.test(message.text())) return;
      evidence.consoleMessages.push({ label, type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    evidence.pageErrors.push(`${label}:${error.message}`);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.startsWith(baseUrl)) evidence.requestFailures.push({ label, url, failure: request.failure()?.errorText ?? 'unknown' });
  });
  page.on('request', (request) => {
    const url = request.url();
    const origin = safeOrigin(url);
    if (/\/v1\/|\/api\/auth\//.test(url)) evidence.apiRequests.push({ method: request.method(), url });
    if (origin && origin !== new URL(baseUrl).origin) {
      if (isLocalProofModelRequest(url) || isLocalProofSyntheticStorageRequest(url) || isLocalProofSyntheticAssetRequest(url)) return;
      evidence.externalRequests.push({
        label,
        method: request.method(),
        url,
        resourceType: request.resourceType(),
      });
    }
  });
  return page;
}

async function admitSourceGeneration(page) {
  // The current Light Chain parity flow has no visible rights checkbox or
  // modal. Keep this helper as a no-op so the readback only exercises the
  // source-admitted generation path.
  void page;
}

async function openAndConfirmMaterialRights(page, testId) {
  const generateButton = page.getByTestId(testId);
  await generateButton.click();
}

async function clickGenericGenerateWithRights(page, generateButton = page.getByRole('button', { name: /^AI生成/ }).last(), clickOptions = {}) {
  await expect(generateButton).toBeEnabled({ timeout: 10_000 });
  await generateButton.click(clickOptions);
}

async function clickCanvasSave(page) {
  const saveButtonCandidates = [
    page.getByRole('button', { name: /^Canvasへ保存$/ }),
    page.getByRole('button', { name: /^保存$/ }),
  ];
  for (const saveButtons of saveButtonCandidates) {
    const count = await saveButtons.count();
    for (let index = count - 1; index >= 0; index -= 1) {
      const button = saveButtons.nth(index);
      if (!await button.isVisible().catch(() => false)) continue;
      if (!await button.isEnabled().catch(() => false)) continue;
      await button.scrollIntoViewIfNeeded();
      await button.click();
      return;
    }
  }
  const diagnostic = await page.evaluate(() => ({
    workflow: document.querySelector('[data-workflow-feature]')?.getAttribute('data-workflow-feature') ?? null,
    lifecycle: document.querySelector('[data-workflow-lifecycle]')?.getAttribute('data-workflow-lifecycle') ?? null,
    providerRoute: document.querySelector('[data-workflow-feature]')?.getAttribute('data-workflow-result-destinations') ?? null,
    providerGate: document.querySelector('[data-testid="lightchain-brand-resolution-gate"]')?.textContent?.trim() ?? null,
    generationError: document.querySelector('[data-testid="lightchain-generation-error"]')?.textContent?.trim() ?? null,
    visibleButtons: Array.from(document.querySelectorAll('button'))
      .filter((button) => {
        const style = window.getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      })
      .map((button) => ({ text: button.textContent?.trim() ?? '', testId: button.getAttribute('data-testid'), disabled: button.disabled }))
      .slice(-20),
    verifierClicks: Array.isArray(window.__heavyChainVerifierClicks) ? window.__heavyChainVerifierClicks.slice(-10) : [],
  }));
  throw new Error(`canvas_save_button_missing:${JSON.stringify(diagnostic)}`);
}

async function readCanvasProject(page, toolId) {
  const storage = await page.evaluate((key) => window.localStorage.getItem(key), canvasStoreKey);
  const parsedStorage = storage ? JSON.parse(storage) : null;
  const workspaceEntries = await page.evaluate(() => Object.entries(window.localStorage)
    .filter(([key]) => key.startsWith('heavy-chain-workspace-artifacts:'))
    .map(([key, value]) => ({ key, value })));
  const workspaceArtifacts = workspaceEntries.flatMap(({ value }) => {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  fs.writeFileSync(path.join(outDir, `${toolId}-canvas-storage.json`), `${JSON.stringify(parsedStorage, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, `${toolId}-workspace-artifacts.json`), `${JSON.stringify(workspaceArtifacts, null, 2)}\n`);
  const project = Array.isArray(parsedStorage?.state?.projects)
    ? parsedStorage.state.projects.find((item) => item?.id === parsedStorage?.state?.currentProjectId)
    : null;
  const currentObjects = Array.isArray(parsedStorage?.state?.objects)
    ? parsedStorage.state.objects
    : Array.isArray(project?.objects) ? project.objects : [];
  return {
    storage: parsedStorage,
    project,
    objects: currentObjects,
    workspaceArtifacts,
  };
}

function findWorkspaceProviderArtifact(readback, toolId) {
  return (readback.workspaceArtifacts ?? []).find((artifact) => (
    artifact?.metadata?.toolId === toolId
    && String(artifact.featureType ?? '').endsWith('-provider-result')
  )) ?? null;
}

function buildProviderReadbackParams(artifact, toolId) {
  const metadata = artifact?.metadata ?? {};
  const references = Array.isArray(metadata.materialReferences)
    ? metadata.materialReferences.map((reference, index) => ({
        ...reference,
        slotKey: reference?.slotKey ?? (index === 0 ? 'primary' : 'secondary'),
      }))
    : [];
  const materialSlots = references.map((reference) => ({
    key: reference.slotKey,
    hasImage: reference?.hasImage === true,
    label: reference?.role ?? null,
    materialKind: reference?.role ?? null,
  }));
  const lightchainResult = artifact
    ? {
        toolId,
        title: artifact.title,
        summary: artifact.prompt ?? metadata.brief ?? '',
        imageUrl: artifact.imageUrl ?? '',
        generationMode: 'provider',
      }
    : null;
  return {
    toolId: metadata.toolId ?? toolId,
    lightchainRoute: metadata.sourceResumePath ?? null,
    inputs: references,
    outputs: ['generation-history', 'canvas'],
    fabricPrompt: metadata.brief ?? null,
    imageRatio: metadata.generationIntent?.imageRatio ?? null,
    materialReferences: references,
    layerPlan: metadata.layerPlan ?? null,
    maskPlan: metadata.maskPlan ?? null,
    compositionPreview: metadata.compositionPreview ?? metadata.generationIntent ?? null,
    lightchainWorkbenchState: {
      materialSlots,
      materialReferences: references,
      lightchainResult,
      referenceNote: metadata.referenceNote ?? null,
    },
  };
}

async function screenshot(page, name) {
  const screenshotPath = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  evidence.screenshots[name] = screenshotPath;
}

function addAssertion(id, ok, details = {}) {
  evidence.assertions.push({ id, ok: Boolean(ok), details });
}

function recordRouteAssertion(route, id, ok, details = {}) {
  const assertion = { id, ok: Boolean(ok), details };
  route.assertions.push(assertion);
  evidence.assertions.push({ id: `${route.toolId}:${id}`, ok: assertion.ok, details });
}

async function startPreviewServer(targetBaseUrl) {
  const parsed = new URL(targetBaseUrl);
  const distDir = path.resolve('dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) throw new Error('dist_index_missing_run_build_first');
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url || '/', targetBaseUrl).pathname);
    const candidatePath = path.resolve(distDir, pathname.replace(/^\//, ''));
    const safePath = candidatePath.startsWith(`${distDir}${path.sep}`) || candidatePath === distDir
      ? candidatePath
      : path.join(distDir, 'index.html');
    const filePath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
      ? safePath
      : path.join(distDir, 'index.html');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', contentTypeForPath(filePath));
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(parsed.port || '4173'), '127.0.0.1', resolve);
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
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
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
  const userId = '00000000-0000-4000-8000-000000000034';
  const email = 'lightchain-canvas-metadata-proof@example.test';
  const token = 'local-cloudflare-proof-token';
  const payload = {
    user: { id: userId, email, name: 'Local Proof User', emailVerified: true, createdAt: new Date(0).toISOString() },
    session: { token, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
  };
  await browserContext.route('**/api/auth/ok', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await browserContext.route('**/api/auth/get-session', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await browserContext.route('**/api/auth/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await browserContext.addInitScript(() => window.localStorage.clear());
}

async function installLocalCloudflareMocks(browserContext) {
  const userId = '00000000-0000-4000-8000-000000000034';
  const brandId = '00000000-0000-4000-8000-000000000134';
  const now = new Date().toISOString();
  const profile = {
    id: userId,
    email: 'lightchain-canvas-metadata-proof@example.test',
    name: 'Local Proof User',
    avatar_url: null,
    created_at: now,
    updated_at: now,
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
  await browserContext.route('**/v1/profile', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...profile, language: 'ja', is_admin: false }),
    });
  });
  await browserContext.route('**/v1/brands', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([brand]),
    });
  });
  await browserContext.route('**/v1/brands/*/members', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
  await browserContext.route('**/v1/image-folders**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await browserContext.route('**/v1/folders**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await browserContext.route('**/v1/tags**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await browserContext.route('**/v1/style-presets**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await browserContext.route('**/v1/generated-images**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await browserContext.route('**/v1/generation-jobs**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await browserContext.route('**/v1/workspace-execution-steps**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await browserContext.route('**/v1/image-ai/usage**', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      planName: 'local-proof', monthlyQuota: 25, remainingUnits: 25,
      completedImages: 0, runningImages: 0, uncertainImages: 0, attemptedImages: 0,
      estimatedMicroUSD: 0, estimatedNeurons: 0, unknownEstimateCount: 0,
      averageInferenceMs: null, periodStart: new Date(0).toISOString(), periodEnd: new Date(Date.now() + 86400000).toISOString(),
      imageAIEnabled: false, billing: 'estimate_not_invoice', accountFreeAllocationRemaining: null, accountWideBudgetGuaranteed: false,
    }),
  }));
  await browserContext.route('**/v1/provider-actions/**', async (route) => {
    const request = route.request();
    const match = new URL(request.url()).pathname.match(/\/v1\/provider-actions\/([^/]+)$/);
    const requestId = request.headers()['idempotency-key'] ?? `00000000-0000-4000-8000-${String(++localProofSequence).padStart(12, '0')}`;
    const action = match?.[1] ?? 'generate-image';
    const input = JSON.parse(request.postData() || '{}');
    const jobId = `ai-${requestId}`;
    const imageId = `ai-${requestId}-0`;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        requestId,
        state: 'completed',
        recovery: 'terminal',
        persistenceStatus: 'completed',
        provider: 'workers_ai',
        backendProvider: 'cloudflare-workers-ai',
        providerModel: '@cf/black-forest-labs/flux-2-klein-4b',
        action,
        requestedCandidateCount: 1,
        protectedEdit: input.protectedEdit ?? null,
        images: [{ imageId, jobId, candidateIndex: 0,
          storagePath: `generated-images/${imageId}`, imageUrl: localProofImageUrl }],
        matrix: [{ bodyType: input.bodyTypes?.[0] ?? 'slim', bodyTypeName: 'スリム',
          ageGroup: input.ageGroups?.[0] ?? '20s', ageGroupName: '20代', imageUrl: localProofImageUrl,
          imageId, jobId, storagePath: `generated-images/${imageId}`, persistenceStatus: 'completed',
          provider: 'workers_ai', modelUsed: '@cf/black-forest-labs/flux-2-klein-4b', providerTaskId: jobId }],
        imageUrl: localProofImageUrl,
        jobId,
        imageId,
        storagePath: `generated-images/${imageId}`,
      }),
    });
  });
  await browserContext.route('**/v1/image-ai/requests/**', async (route) => {
    const requestId = new URL(route.request().url()).pathname.split('/').pop();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, requestId, state: 'completed', recovery: 'terminal', persistenceStatus: 'completed',
        provider: 'workers_ai', backendProvider: 'cloudflare-workers-ai', providerModel: '@cf/black-forest-labs/flux-2-klein-4b',
        images: [{ imageId: `local-proof-${requestId}-0`, jobId: `local-proof-${requestId}`, candidateIndex: 0,
          storagePath: `generated-images/local-proof-${requestId}-0.png`, imageUrl: localProofImageUrl }] }),
    });
  });
  await browserContext.route(/\/v1\/workspace-artifacts(?:\/|$)/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'workspace_artifact_not_found' }) });
      return;
    }
    const input = JSON.parse(route.request().postData() || '{}');
    const requestId = String(input.requestId || 'local-proof-workspace');
    const imageId = `wa-${requestId.toLowerCase()}`;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true,
      remote: { jobId: imageId, imageId, storagePath: `generated-images/${imageId}` },
      metadata: { ...(input.metadata || {}), provider: 'workers_ai', backendProvider: 'cloudflare-workers-ai', providerModel: '@cf/black-forest-labs/flux-2-klein-4b',
        providerRequestId: input.imageAI?.requestId ?? null, candidateIndex: input.imageAI?.candidateIndex ?? 0 },
    }) });
  });
  await browserContext.route('**/v1/media/read**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://heavy-chain-api.local/v1/media/local-proof/content' }) });
  });
  await browserContext.route(/\/v1\/media\/.*\/content(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: fixtureBuffer });
  });
  await browserContext.route('https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/tools/ja/%E9%9D%A2%E6%96%99%E4%B8%8A%E8%BA%AB.mp4', async (route) => {
    await route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(0) });
  });
  await browserContext.route('**/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (/\/v1\/(?:profile|brands(?:\/|$)|image-folders|folders|tags|style-presets|generated-images|generation-jobs|workspace-execution-steps|image-ai\/usage|provider-actions|image-ai\/requests|workspace-artifacts|media\/read|media\/.*\/content)\b/.test(pathname)) return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function installGenerationNetworkGuard(browserContext) {
  await browserContext.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    if (isLocalProofModelRequest(url)) {
      await route.abort('blockedbyclient');
      return;
    }
    if (isLocalProofProviderRequest(url)) {
      await route.fallback();
      return;
    }
    if (isGenerationLikeRequest(url)) {
      evidence.blockedGenerationRequests.push({
        method: request.method(),
        url,
        resourceType: request.resourceType(),
      });
      await route.abort('blockedbyclient');
      return;
    }
    await route.fallback();
  });
}

function isLocalProofProviderRequest(url) {
  return /\/v1\/provider-actions\//i.test(url);
}

function isLocalProofModelRequest(url) {
  return /(?:huggingface\.co|hf\.co|raw\.githubusercontent\.com)/i.test(url)
    && /(?:u2net|efficient_sam|\.onnx)/i.test(url);
}

function isLocalProofSyntheticStorageRequest(url) {
  return /\/v1\/media\/.*\/content/i.test(url);
}

function isLocalProofSyntheticAssetRequest(url) {
  return /lightchain-qlxy-prod\.oss-cn-hangzhou\.aliyuncs\.com\/light-chain-platform\/tools\/ja\/.*\.mp4$/i.test(url);
}

function isGenerationLikeRequest(url) {
  if (/\/v1\/workspace-artifacts/i.test(url)) return false;
  return /replicate|openai|fal\.ai|stability|image-generation|ai-generate/i.test(url);
}

function isAllowedExternalRequest(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'fonts.googleapis.com') return true;
    if (parsed.hostname === 'fonts.gstatic.com') return true;
    if (parsed.hostname === 'heavy-chain-api.local' && parsed.pathname.startsWith('/v1/')) return true;
    if (parsed.hostname.endsWith('.workers.dev') && parsed.pathname.startsWith('/v1/')) return true;
    return false;
  } catch {
    return false;
  }
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isLocalPreview(url) {
  return ['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname);
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, '');
}

function dateStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
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

async function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`timeout:${timeoutMs}`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}
