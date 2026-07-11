import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CANVAS_HANDOFF_BASE_URL || 'http://127.0.0.1:4173';
const outDir = process.env.CANVAS_HANDOFF_OUT_DIR || 'output/playwright/lightchain-product-excellence-20260626';
const authStatePath = process.env.CANVAS_HANDOFF_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const targetOrigin = new URL(baseUrl).origin;
const canvasStoreKey = 'heavy-chain-canvas';
const requestText = '黒のチェーン柄フーディーを、ECとSNSで使える高級ストリート系キャンペーン画像にしてください。商品が主役で、文字やロゴは入れず、背景はシンプル、質感が分かる構図。';
const proofImage =
  'iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAIAAADrOSKFAAABfklEQVR4nO3VwQ2DMBQFQYp2/6mOBtYiHhSg2R+TR6VJ4FD3Yh8nAAAAAAAAAAAAAAAAAAAAAACwq3n7vQG8Lr3f93nP8xz7B2z67bLvG7BXn8z3/V6f8yP4nff4+v0G7NVd9j7f6wN4u9QzAAAAAAAAAAAAAAAAAADgT2EDAiwIsCDAggALAiysx8O+vV6vR3e73V6vV6vR6fP5/PL5fL1eL5fL5fL5fL5fK9Xq9Xq9Xq9Xq9Xq9Xq8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLw8Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Px8fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fAAAAAAAAAAAAAAAAAAAAAAD4O8EGAiwIsCDAggALAiysQw4oEJQ4AAAAAElFTkSuQmCC';

async function deriveAuthState() {
  try {
    const raw = await fs.readFile(authStatePath, 'utf8');
    const parsed = JSON.parse(raw);
    const origins = Array.isArray(parsed.origins) ? parsed.origins : [];
    const sourceOrigin = origins.find((origin) => Array.isArray(origin.localStorage) && origin.localStorage.length);
    if (!sourceOrigin) return undefined;
    const derived = {
      ...parsed,
      origins: [
        ...origins.filter((origin) => origin.origin !== targetOrigin),
        { origin: targetOrigin, localStorage: sourceOrigin.localStorage },
      ],
    };
    const derivedPath = path.join(outDir, 'canvas-handoff-derived-auth-state.json');
    await fs.writeFile(derivedPath, JSON.stringify(derived, null, 2));
    return derivedPath;
  } catch {
    return undefined;
  }
}

async function dismissBlockingOverlays(page) {
  await page.keyboard.press('Escape').catch(() => {});
  for (const text of ['スキップ', '閉じる', 'あとで', '完了']) {
    const button = page.getByRole('button', { name: text }).first();
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(250);
    }
  }
}

await fs.mkdir(outDir, { recursive: true });
const uploadPath = path.join(outDir, 'canvas-handoff-proof.png');
await fs.writeFile(uploadPath, Buffer.from(proofImage, 'base64'));

const derivedAuthState = await deriveAuthState();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: derivedAuthState,
  viewport: { width: 1440, height: 980 },
  recordVideo: { dir: path.join(outDir, 'videos'), size: { width: 1440, height: 980 } },
});
const page = await context.newPage();
const errors = [];

page.on('pageerror', (error) => errors.push({ type: 'pageerror', message: error.message }));
page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) {
    errors.push({ type: `console:${message.type()}`, message: message.text() });
  }
});

await page.goto(`${baseUrl}/generate?feature=campaign-image`, { waitUntil: 'networkidle' });
await dismissBlockingOverlays(page);
await page.evaluate((key) => window.localStorage.removeItem(key), canvasStoreKey);

const materialInput = page
  .locator('section')
  .filter({ hasText: '販促素材作業台' })
  .locator('input[type="file"]')
  .first();
await materialInput.setInputFiles(uploadPath);
await page.getByLabel('素材メモ').fill('Canvas handoff material proof');

const assistantTextarea = page.locator('textarea[placeholder="商品画像をアップロードして、デザインのリクエストを教えてください"]').first();
await assistantTextarea.fill(requestText);
await page.getByRole('button', { name: '生成計画を作る' }).click();
await page.getByText('確認済み', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
await page.getByRole('button', { name: 'フォームへ反映' }).click();

const saveButton = page.getByRole('button', { name: /企画書を保存|生成する/ }).first();
await saveButton.click();
await page.getByText('保存した企画', { exact: false }).waitFor({ state: 'visible', timeout: 30_000 });
await page.screenshot({ path: path.join(outDir, 'g002-generate-before-canvas-click.png'), fullPage: true });
await page.getByRole('button', { name: 'Canvasへ' }).first().click();
await page.waitForURL(/\/canvas\/new\?handoff=generated/, { timeout: 15_000 });
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(outDir, 'g002-canvas-handoff.png'), fullPage: true });

const bodyText = await page.locator('body').innerText();
const storage = await page.evaluate((key) => window.localStorage.getItem(key), canvasStoreKey);
const parsedStorage = storage ? JSON.parse(storage) : null;
const storageText = JSON.stringify(parsedStorage);
const canvasObjects = Array.isArray(parsedStorage?.state?.objects) ? parsedStorage.state.objects : [];
const handoffObject = canvasObjects.find((object) => {
  const parameters = object?.metadata?.parameters;
  return object?.type === 'image'
    && parameters?.source === 'generate-results'
    && object?.metadata?.feature === 'campaign-image';
});
const handoffParameters = handoffObject?.metadata?.parameters ?? {};
const materialReferences = Array.isArray(handoffParameters.materialReferences)
  ? handoffParameters.materialReferences
  : [];
const primaryMaterial = materialReferences[0] ?? {};
const hasStructuredCanvasObject =
  Boolean(handoffObject?.id)
  && materialReferences.length > 0
  && primaryMaterial.fileName === 'canvas-handoff-proof.png'
  && primaryMaterial.materialKind === '商品画像'
  && primaryMaterial.placement === '中央大きめ'
  && primaryMaterial.activeLayer === '商品'
  && primaryMaterial.note?.includes('黒のチェーン柄フーディー')
  && handoffParameters.layerPlan?.activeLayer === '商品'
  && handoffParameters.layerPlan?.placement === '中央大きめ'
  && handoffParameters.maskPlan?.mode === 'auto'
  && handoffParameters.compositionPreview?.fileName === 'canvas-handoff-proof.png';
const ok =
  (bodyText.includes('キャンバス') || bodyText.includes('Canvas')) &&
  bodyText.includes('素材・レイヤー情報') &&
  bodyText.includes('生成元') &&
  bodyText.includes('認識素材') &&
  bodyText.includes('商品画像') &&
  bodyText.includes('中央大きめ') &&
  bodyText.includes('編集設計') &&
  storageText.includes('generate-results') &&
  storageText.includes('campaign-image') &&
  storageText.includes('materialReferences') &&
  storageText.includes('layerPlan') &&
  storageText.includes('maskPlan') &&
  storageText.includes('compositionPreview') &&
  storageText.includes('canvas-handoff-proof.png') &&
  storageText.includes('黒のチェーン柄フーディー') &&
  hasStructuredCanvasObject;

await fs.writeFile(path.join(outDir, 'g002-canvas-handoff.txt'), bodyText);
await fs.writeFile(path.join(outDir, 'g002-canvas-handoff-storage.json'), JSON.stringify(parsedStorage, null, 2));

await context.close();
await browser.close();

const summary = {
  ok,
  baseUrl,
  url: `${baseUrl}/canvas/new?handoff=generated`,
  generateScreenshot: path.join(outDir, 'g002-generate-before-canvas-click.png'),
  canvasScreenshot: path.join(outDir, 'g002-canvas-handoff.png'),
  bodyText: path.join(outDir, 'g002-canvas-handoff.txt'),
  storage: path.join(outDir, 'g002-canvas-handoff-storage.json'),
  errors,
  assertions: {
    usedGenerateUiButton: true,
    hasCanvasRouteText: bodyText.includes('キャンバス') || bodyText.includes('Canvas'),
    hasSelectedObjectProperties: bodyText.includes('素材・レイヤー情報') && bodyText.includes('生成元'),
    hasMaterialProperties: bodyText.includes('認識素材') && bodyText.includes('商品画像') && bodyText.includes('中央大きめ') && bodyText.includes('編集設計'),
    hasFeatureMetadata: storageText.includes('campaign-image'),
    hasSourceMetadata: storageText.includes('generate-results'),
    hasMaterialMetadata: storageText.includes('materialReferences') && storageText.includes('layerPlan') && storageText.includes('maskPlan') && storageText.includes('compositionPreview'),
    hasMaterialNote: storageText.includes('黒のチェーン柄フーディー') && storageText.includes('canvas-handoff-proof.png'),
    hasStructuredCanvasObject,
    selectedGeneratedObject: bodyText.includes('素材・レイヤー情報') && bodyText.includes('生成元') && bodyText.includes('generate-results'),
    materialReferenceShape: {
      count: materialReferences.length,
      fileName: primaryMaterial.fileName || null,
      materialKind: primaryMaterial.materialKind || null,
      placement: primaryMaterial.placement || null,
      activeLayer: primaryMaterial.activeLayer || null,
      hasPromptNote: Boolean(primaryMaterial.note?.includes('黒のチェーン柄フーディー')),
    },
    layerPlanShape: {
      activeLayer: handoffParameters.layerPlan?.activeLayer || null,
      placement: handoffParameters.layerPlan?.placement || null,
    },
    maskPlanShape: {
      mode: handoffParameters.maskPlan?.mode || null,
    },
    compositionPreviewShape: {
      fileName: handoffParameters.compositionPreview?.fileName || null,
    },
  },
};
await fs.writeFile(path.join(outDir, 'g002-canvas-handoff-summary.json'), JSON.stringify(summary, null, 2));

if (!ok || errors.length) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
