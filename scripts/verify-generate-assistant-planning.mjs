import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.GENERATE_ASSISTANT_BASE_URL || 'http://127.0.0.1:4173';
const storageState = process.env.GENERATE_ASSISTANT_AUTH_STATE || 'output/playwright/prod-auth-refresh-20260625/auth-state.json';
const outDir = process.env.GENERATE_ASSISTANT_OUT_DIR || 'output/playwright/lightchain-product-excellence-20260626';

const features = [
  { id: 'campaign-image', fieldAssertions: [{ field: 'materialNote', includes: ['主役カット'] }, { field: 'allFormValues', includes: ['生成計画'] }] },
  { id: 'product-shots', fieldAssertions: [{ field: 'productDescription', includes: ['生成計画', '商品全体'] }] },
  { id: 'model-matrix', fieldAssertions: [{ field: 'productDescription', includes: ['生成計画', '着用モデル軸'] }] },
  { id: 'design-gacha', fieldAssertions: [{ field: 'materialNote', includes: ['固定要素'] }, { field: 'allFormValues', includes: ['生成計画'] }], chips: ['商品/構図', 'テキスト', '色/配色', 'レイアウト', '質感/背景'] },
  { id: 'scene-coordinate', fieldAssertions: [{ field: 'materialNote', includes: ['商品切り抜き'] }] },
  { id: 'multilingual-banner', fieldAssertions: [{ field: 'headline', includes: ['黒のチェーン柄フーディー'] }, { field: 'subheadline', includes: ['言語バリエーション'] }] },
  { id: 'remove-bg', fieldAssertions: [{ field: 'materialNote', includes: ['対象認識'] }] },
  { id: 'colorize', fieldAssertions: [{ field: 'materialNote', includes: ['変更対象'] }] },
  { id: 'upscale', fieldAssertions: [{ field: 'materialNote', includes: ['解像度改善'] }] },
  { id: 'variations', fieldAssertions: [{ field: 'materialNote', includes: ['元画像の保持'] }, { field: 'allFormValues', includes: ['生成計画'] }] },
];

const requestText = '黒のチェーン柄フーディーを、ECとSNSで使える高級ストリート系キャンペーン画像にしてください。商品が主役で、文字やロゴは入れず、背景はシンプル、質感が分かる構図。';

mkdirSync(outDir, { recursive: true });

const redact = (value) => String(value)
  .replaceAll(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[redacted-jwt]')
  .replaceAll(/refresh_token["=:]\s*["']?[^"',\s}]+/gi, 'refresh_token=[redacted]');

function buildStorageStateForBaseUrl(sourcePath, targetBaseUrl) {
  if (!existsSync(sourcePath)) return sourcePath;
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const targetOrigin = new URL(targetBaseUrl).origin;
  const sourceOrigin = source.origins?.find((origin) =>
    origin.localStorage?.some((item) => item.name.startsWith('sb-') && item.name.endsWith('-auth-token'))
  ) || source.origins?.[0];
  const localStorage = sourceOrigin?.localStorage || [];
  const derived = {
    cookies: source.cookies || [],
    origins: [
      {
        origin: targetOrigin,
        localStorage,
      },
    ],
  };
  const derivedPath = path.join(outDir, 'derived-auth-state.json');
  writeFileSync(derivedPath, JSON.stringify(derived, null, 2));
  return derivedPath;
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

async function inputValueAfterLabel(page, labelText) {
  return page.evaluate((label) => {
    const labels = [...document.querySelectorAll('label')];
    const found = labels.find((node) => node.textContent?.includes(label));
    const root = found?.parentElement;
    const field = root?.querySelector('textarea,input');
    return field && 'value' in field ? field.value : '';
  }, labelText);
}

async function collectValues(page) {
  return {
    prompt: await inputValueAfterLabel(page, 'プロンプト').catch(() => ''),
    productDescription: await inputValueAfterLabel(page, '商品説明').catch(() => ''),
    headline: await inputValueAfterLabel(page, 'ヘッドライン').catch(() => ''),
    subheadline: await inputValueAfterLabel(page, 'サブヘッドライン').catch(() => ''),
    materialNote: await inputValueAfterLabel(page, 'メモ').catch(() => ''),
    allTextareas: await page.locator('textarea').evaluateAll((nodes) => nodes.map((node) => node.value)).catch(() => []),
    allInputs: await page.locator('input').evaluateAll((nodes) => nodes.map((node) => node.value)).catch(() => []),
  };
}

function valueForAssertion(values, field) {
  if (field === 'allFormValues') {
    return [
      values.prompt,
      values.productDescription,
      values.headline,
      values.subheadline,
      values.materialNote,
      ...(values.allTextareas || []),
      ...(values.allInputs || []),
    ].filter(Boolean).join('\n');
  }
  return String(values[field] || '');
}

async function verifyFeature(page, feature) {
  const requestedUrl = `${baseUrl}/generate?feature=${feature.id}`;
  await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await dismissBlockingOverlays(page);
  await page.getByText('AIアシスタント', { exact: false }).first().waitFor({ state: 'visible', timeout: 30_000 });

  const beforeScreenshotPath = path.join(outDir, `assistant-${feature.id}-before.png`);
  await page.screenshot({ path: beforeScreenshotPath, fullPage: true });

  const assistantTextarea = page.locator('textarea[placeholder="商品画像をアップロードして、デザインのリクエストを教えてください"]').first();
  await assistantTextarea.fill(requestText);
  await page.getByRole('button', { name: '生成計画を作る' }).click();
  await page.getByText('確認済み', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: 'フォームへ反映' }).click();
  await page.waitForTimeout(500);

  const afterScreenshotPath = path.join(outDir, `assistant-${feature.id}-after.png`);
  await page.screenshot({ path: afterScreenshotPath, fullPage: true });

  const bodyText = await page.locator('body').innerText({ timeout: 10_000 });
  const values = await collectValues(page);
  const fieldResults = (feature.fieldAssertions || []).map((assertion) => {
    const value = valueForAssertion(values, assertion.field);
    const missing = assertion.includes.filter((text) => !value.includes(text));
    return {
      field: assertion.field,
      includes: assertion.includes,
      value,
      missing,
      passed: missing.length === 0,
    };
  });
  const missing = fieldResults.flatMap((result) => result.missing.map((text) => `${result.field}:${text}`));
  const chipMissing = (feature.chips || []).filter((label) => !bodyText.includes(label));
  const redirectedToLogin = new URL(page.url()).pathname === '/login';
  const summaryPath = path.join(outDir, `assistant-${feature.id}.json`);

  const result = {
    feature: feature.id,
    requestedUrl,
    finalUrl: redact(page.url()),
    beforeScreenshotPath,
    afterScreenshotPath,
    bodyTextPath: path.join(outDir, `assistant-${feature.id}.txt`),
    values,
    fieldResults,
    missing,
    chipMissing,
    redirectedToLogin,
    passed: !redirectedToLogin && missing.length === 0 && chipMissing.length === 0,
  };
  writeFileSync(result.bodyTextPath, redact(bodyText));
  writeFileSync(summaryPath, JSON.stringify(result, null, 2));
  return result;
}

const browser = await chromium.launch({ headless: true });
const results = [];
const consoleErrors = [];
const pageErrors = [];
const effectiveStorageState = buildStorageStateForBaseUrl(storageState, baseUrl);

try {
  const context = await browser.newContext({
    storageState: effectiveStorageState,
    viewport: { width: 1440, height: 1100 },
    recordVideo: { dir: path.join(outDir, 'videos'), size: { width: 1440, height: 1100 } },
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push({ text: redact(message.text()).slice(0, 1000), location: message.location() });
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push({ message: redact(error.message), stack: redact(error.stack || '') });
  });

  for (const feature of features) {
    results.push(await verifyFeature(page, feature));
  }

  await page.close();
  await context.close();
} finally {
  await browser.close();
}

const failures = results.filter((result) => !result.passed);
const summary = {
  baseUrl,
  storageState,
  effectiveStorageState,
  outDir,
  requestText,
  resultCount: results.length,
  passed: failures.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0,
  failures,
  consoleErrorCount: consoleErrors.length,
  pageErrorCount: pageErrors.length,
  consoleErrors,
  pageErrors,
  results,
};

writeFileSync(path.join(outDir, 'generate-assistant-planning-summary.json'), JSON.stringify(summary, null, 2));

if (!summary.passed) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
