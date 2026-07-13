#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4184');
const authStatePath = args.authState || process.env.HEAVY_CHAIN_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = args.out || `output/playwright/lightchain-canvas-metadata-readback-${dateStamp()}`;
const canvasStoreKey = 'heavy-chain-canvas';
const viewport = { width: 1440, height: 1050 };
const localPreview = isLocalPreview(baseUrl);
const canUseAuthState = !localPreview && fs.existsSync(authStatePath);

const fixturePng =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAIAAADrOSKFAAABfklEQVR4nO3VwQ2DMBQFQYp2/6mOBtYiHhSg2R+TR6VJ4FD3Yh8nAAAAAAAAAAAAAAAAAAAAAACwq3n7vQG8Lr3f93nP8xz7B2z67bLvG7BXn8z3/V6f8yP4nff4+v0G7NVd9j7f6wN4u9QzAAAAAAAAAAAAAAAAAADgT2EDAiwIsCDAggALAiysx8O+vV6vR3e73V6vV6vR6fP5/PL5fL1eL5fL5fL5fL5fK9Xq9Xq9Xq9Xq9Xq9Xq8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLw8Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Px8fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fAAAAAAAAAAAAAAAAAAAAAAD4O8EGAiwIsCDAggALAiysQw4oEJQ4AAAAAElFTkSuQmCC';

fs.mkdirSync(outDir, { recursive: true });
const primaryUploadPath = path.join(outDir, 'lightchain-primary-upload.png');
const secondaryUploadPath = path.join(outDir, 'lightchain-secondary-upload.png');
fs.writeFileSync(primaryUploadPath, Buffer.from(fixturePng, 'base64'));
fs.writeFileSync(secondaryUploadPath, Buffer.from(fixturePng, 'base64'));

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
    await installLocalSupabaseMocks(context);
    await installLocalProofAuth(context);
  }
  await installGenerationNetworkGuard(context);

  await verifyFabricImageCanvasReadback(context);
  await verifyPrintingImageCanvasReadback(context);
  await verifyLineToRealCanvasReadback(context);
  await verifyLineGenerationCanvasReadback(context);
  await verifyPatternVectorProCanvasReadback(context);
  await verifySvgConvertCanvasReadback(context);
  await verifyMarketingDetailCanvasReadback(context);
  await verifyPrintDesignDetailCanvasReadback(context);
  await verifyWearDesignDetailCanvasReadback(context);
  await verifyCustomStyleCanvasReadback(context);
  await verifyModelToolCanvasReadbacks(context);
  await verifyWorkspaceStyleCanvasReadbacks(context);
  await verifyFittingCanvasReadbacks(context);
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
    'Supabase REST readback/mocked auth tables',
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
  await page.locator('#fabric-keywords').fill('シルクサテン、淡い光沢、上衣に自然に反映');
  await screenshot(page, 'fabric-image-before-generate');
  await page.getByRole('button', { name: /AI生成/ }).click();
  await page.getByAltText('生成結果プレビュー').waitFor({ state: 'visible', timeout: 10_000 });
  await screenshot(page, 'fabric-image-after-generate');
  await clickCanvasSave(page);
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await screenshot(page, 'fabric-image-canvas-after-save');

  const readback = await readCanvasProject(page, 'fabric-image');
  const objects = readback.objects;
  const workbenchObject = objects.find((object) => object?.metadata?.feature === 'lightchain-workbench');
  const params = workbenchObject?.metadata?.parameters ?? {};
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
  await screenshot(page, 'svg-convert-before-generate');
  await page.getByRole('button', { name: /AI生成/ }).click();
  await page.getByText('SVGプレビュー', { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 });
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
  recordRouteAssertion(route, 'svg_preview_result_saved', params.lightchainWorkbenchState?.lightchainResult?.title === 'SVGプレビュー', {
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
  recordRouteAssertion(route, 'line_to_real_loading_preview_state_saved', (
    params.lightchainWorkbenchState?.lightchainResult?.title === '生成中...'
    && params.lightchainWorkbenchState?.lightchainResult?.imageUrl?.startsWith('data:image/svg+xml')
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
    waitFor: async (page) => page.getByText('生成中...', { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 }),
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
  recordRouteAssertion(route, 'line_generation_loading_history_state_saved', (
    params.lightchainWorkbenchState?.lightchainResult?.title === '生成中...'
    && params.lightchainWorkbenchState?.lightchainResult?.imageUrl?.startsWith('data:image/svg+xml')
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
  recordRouteAssertion(route, 'pattern_vector_pro_loading_preview_state_saved', (
    params.lightchainWorkbenchState?.lightchainResult?.title === '生成中...'
    && params.lightchainWorkbenchState?.lightchainResult?.imageUrl?.startsWith('data:image/svg+xml')
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
    generate: async (page) => page.getByRole('button', { name: '更新' }).click(),
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
      await page.getByRole('button', { name: 'ガイドを表示しない' }).click();
      await page.locator('input[type="file"]').nth(0).setInputFiles(primaryUploadPath);
      await page.locator('#print-design-prompt').fill('花柄の密度を上げ、ワンピース向けにリピートしやすく整える');
    },
    generate: async (page) => page.getByRole('button', { name: /AI生成/ }).click(),
    waitFor: async (page) => page.getByAltText('柄・グラフィックプレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
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
    generate: async (page) => page.getByRole('button', { name: /AI生成/ }).click(),
    waitFor: async (page) => page.getByAltText('ディテール変更プレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
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
    generate: async (page) => page.getByRole('button', { name: 'カスタマイズについて連絡する' }).last().click(),
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

async function verifyModelToolCanvasReadbacks(browserContext) {
  const modelCases = [
    {
      toolId: 'model-custom',
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

  for (const modelCase of modelCases) {
    await verifyModelToolCanvasReadback(browserContext, modelCase);
  }
}

async function verifyWorkspaceStyleCanvasReadbacks(browserContext) {
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
      expectedTitle: 'Heavy Chain Lab',
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
      expectedTitle: 'ウェアデザインラボプレビュー',
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

  for (const workspaceCase of workspaceCases) {
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
    waitFor: async (page) => page.getByAltText('生成結果プレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
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
    lightchainResult.title === config.expectedTitle
    && lightchainResult.summary?.includes(config.expectedSummary)
    && lightchainResult.summary?.includes(config.note)
    && lightchainResult.imageUrl?.startsWith('data:image/svg+xml')
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
      waitFor: async (page) => page.getByText(config.expectedTitle, { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 }),
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
        await page.getByRole('button', { name: /新規ファイル/ }).click();
        return;
      }
      await page.getByRole('button', { name: /AI生成/ }).click();
    },
    waitFor: async (page) => page.getByText(config.expectedTitle, { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 }),
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
    lightchainResult?.title === config.expectedTitle
    && lightchainResult?.summary?.includes(config.expectedSummary)
    && lightchainResult?.imageUrl?.startsWith('data:image/svg+xml')
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

async function verifyModelToolCanvasReadback(browserContext, config) {
  const flow = await runMaterialPreviewCanvasFlow(browserContext, {
    toolId: config.toolId,
    uploadCount: config.uploadCount ?? 0,
    beforeGenerate: config.beforeGenerate,
    waitFor: async (page) => page.getByAltText('生成結果プレビュー').waitFor({ state: 'visible', timeout: 10_000 }),
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
    lightchainResult.title?.includes('プレビュー')
    && lightchainResult.summary?.includes(config.expectedSummary)
    && lightchainResult.imageUrl?.startsWith('data:image/svg+xml')
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
  await page.goto(`${baseUrl}/lightchain/${config.toolId}`, { waitUntil: 'networkidle' });
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  for (let index = 0; index < config.uploadCount; index += 1) {
    await page.locator('input[type="file"]').nth(index).setInputFiles(index === 0 ? primaryUploadPath : secondaryUploadPath);
  }
  if (config.beforeGenerate) await config.beforeGenerate(page);
  await screenshot(page, `${config.toolId}-before-generate`);
  await page.getByRole('button', { name: /AI生成/ }).click();
  await config.waitFor(page);
  await screenshot(page, `${config.toolId}-after-generate`);
  await clickCanvasSave(page);
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await screenshot(page, `${config.toolId}-canvas-after-save`);
  const readback = await readCanvasProject(page, config.toolId);
  const workbenchObject = readback.objects.find((object) => object?.metadata?.feature === 'lightchain-workbench');
  return {
    route,
    page,
    readbackData: {
    readback,
    workbenchObject,
    params: workbenchObject?.metadata?.parameters ?? {},
    },
  };
}

async function runDirectPreviewCanvasFlow(browserContext, config) {
  const page = await newInstrumentedPage(browserContext, config.toolId);
  const route = { toolId: config.toolId, assertions: [] };
  evidence.routes.push(route);
  await page.goto(`${baseUrl}/lightchain/${config.toolId}`, { waitUntil: 'networkidle' });
  await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);
  if (config.beforeGenerate) await config.beforeGenerate(page);
  await screenshot(page, `${config.toolId}-before-generate`);
  await config.generate(page);
  await config.waitFor(page);
  await screenshot(page, `${config.toolId}-after-generate`);
  await clickCanvasSave(page);
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await screenshot(page, `${config.toolId}-canvas-after-save`);
  const readback = await readCanvasProject(page, config.toolId);
  const workbenchObject = readback.objects.find((object) => object?.metadata?.feature === 'lightchain-workbench');
  return {
    route,
    page,
    readbackData: {
      readback,
      workbenchObject,
      params: workbenchObject?.metadata?.parameters ?? {},
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
    lightchainResult?.title === config.expectedTitle
    && lightchainResult?.summary?.includes(config.expectedSummaryIncludes)
    && lightchainResult?.imageUrl?.startsWith('data:image/svg+xml')
  ), { lightchainResult: lightchainResult ?? null });
}

async function newInstrumentedPage(browserContext, label) {
  const page = await browserContext.newPage();
  page.setDefaultNavigationTimeout(20_000);
  page.setDefaultTimeout(15_000);
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      if (localPreview && /Failed to load resource: the server responded with a status of 401/.test(message.text())) return;
      if (/Remote workspace artifact save failed; falling back to localStorage/.test(message.text())) return;
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
    if (origin && origin !== new URL(baseUrl).origin) {
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

async function clickCanvasSave(page) {
  const saveButtons = page.getByRole('button', { name: /^Canvasへ保存$/ });
  const count = await saveButtons.count();
  if (!count) throw new Error('canvas_save_button_missing');
  for (let index = count - 1; index >= 0; index -= 1) {
    const button = saveButtons.nth(index);
    if (!await button.isVisible().catch(() => false)) continue;
    await button.scrollIntoViewIfNeeded();
    await button.click();
    return;
  }
  throw new Error('canvas_save_button_not_visible');
}

async function readCanvasProject(page, toolId) {
  const storage = await page.evaluate((key) => window.localStorage.getItem(key), canvasStoreKey);
  const parsedStorage = storage ? JSON.parse(storage) : null;
  fs.writeFileSync(path.join(outDir, `${toolId}-canvas-storage.json`), `${JSON.stringify(parsedStorage, null, 2)}\n`);
  const project = Array.isArray(parsedStorage?.state?.projects)
    ? parsedStorage.state.projects.find((item) => item?.id === parsedStorage?.state?.currentProjectId)
    : null;
  return {
    storage: parsedStorage,
    project,
    objects: Array.isArray(project?.objects) ? project.objects : [],
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
  const supabaseUrl = readEnvValue('VITE_SUPABASE_URL');
  if (!supabaseUrl) throw new Error('local_proof_supabase_url_missing');
  const projectRef = new URL(supabaseUrl).host.split('.')[0];
  const userId = '00000000-0000-4000-8000-000000000034';
  const email = 'lightchain-canvas-metadata-proof@example.test';
  const token = makeLocalJwt(userId, email);
  await browserContext.addInitScript(({ userId, email, projectRef, token }) => {
    const key = `sb-${projectRef}-auth-token`;
    window.localStorage.setItem(key, JSON.stringify({
      access_token: token,
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      expires_in: 60 * 60,
      refresh_token: 'local-proof-refresh',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email,
        user_metadata: { name: 'Local Proof User' },
        app_metadata: {},
      },
    }));
  }, { userId, email, projectRef, token });
}

async function installLocalSupabaseMocks(browserContext) {
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
  await browserContext.route('**/rest/v1/users*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/1' },
      body: JSON.stringify([profile]),
    });
  });
  await browserContext.route('**/rest/v1/brands*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/1' },
      body: JSON.stringify([brand]),
    });
  });
  await browserContext.route('**/rest/v1/brand_members*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0--1/0' },
      body: JSON.stringify([]),
    });
  });
}

async function installGenerationNetworkGuard(browserContext) {
  await browserContext.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
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

function isGenerationLikeRequest(url) {
  if (/marketing-workspace-artifact/i.test(url)) return false;
  return /\/functions\/v1\/(?:generate|.*generation|runway|replicate|openai|image|video)|runway|replicate|openai|fal\.ai|stability|image-generation|generate-image|ai-generate/i.test(url);
}

function isAllowedExternalRequest(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'fonts.googleapis.com') return true;
    if (parsed.hostname === 'fonts.gstatic.com') return true;
    if (/\.supabase\.co$/.test(parsed.hostname)) {
      if (parsed.pathname.startsWith('/rest/v1/users')) return true;
      if (parsed.pathname.startsWith('/rest/v1/brands')) return true;
      if (parsed.pathname.startsWith('/rest/v1/brand_members')) return true;
      if (parsed.pathname === '/functions/v1/marketing-workspace-artifact') return true;
    }
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

function readEnvValue(name) {
  if (process.env[name]) return process.env[name];
  for (const file of ['.env.local', '.env.production.local', '.env']) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const line = text.split(/\r?\n/).filter((entry) => entry.startsWith(`${name}=`)).pop();
      if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
    } catch {
      // Try the next env file.
    }
  }
  return null;
}

function makeLocalJwt(userId, email) {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url({
      aud: 'authenticated',
      exp: now + 60 * 60,
      iat: now,
      role: 'authenticated',
      sub: userId,
      email,
      user_metadata: { name: 'Local Proof User' },
      app_metadata: {},
    }),
    'local-proof',
  ].join('.');
}

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
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
