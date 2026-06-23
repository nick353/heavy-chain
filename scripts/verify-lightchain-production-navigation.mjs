import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.LIGHTCHAIN_UI_BASE_URL || 'https://heavy-chain.zeabur.app';
const storageState = process.env.LIGHTCHAIN_UI_AUTH_STATE || 'output/playwright/prod-auth-dashboard-20260623/auth-state-after-tutorial.json';
const outDir = process.env.LIGHTCHAIN_NAV_OUT_DIR || `output/playwright/lightchain-production-navigation-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;

const viewports = [
  { name: 'desktop', width: 1440, height: 1100 },
  { name: 'mobile', width: 390, height: 900 },
];

const flows = [
  {
    name: 'jobs-new-generation',
    startPath: '/jobs',
    clickText: '新しく作る',
    expectedPath: '/generate',
    expectedText: '制作レーンから始める',
  },
  {
    name: 'jobs-completed-gallery',
    startPath: '/jobs',
    clickText: '完了した成果物',
    expectedPath: '/gallery',
    expectedText: 'Canvasで再編集',
  },
  {
    name: 'gallery-to-canvas',
    startPath: '/gallery',
    clickText: 'Canvasで再編集',
    expectedPath: '/canvas/new',
    expectedText: '画像を置く',
  },
  {
    name: 'canvas-to-gallery',
    startPath: '/canvas/new',
    clickText: '素材を見る',
    expectedPath: '/gallery',
    expectedText: '採用候補を見る',
  },
  {
    name: 'history-to-gallery',
    startPath: '/history',
    clickText: '保存済みを見る',
    expectedPath: '/gallery',
    expectedText: '成果物を選ぶ',
  },
  {
    name: 'generate-to-dashboard',
    startPath: '/generate',
    clickText: '制作ワークフローへ戻る',
    expectedPath: '/dashboard',
    expectedText: '制作ワークフロー',
  },
];

mkdirSync(outDir, { recursive: true });

const redact = (value) => String(value)
  .replaceAll(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[redacted-jwt]')
  .replaceAll(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [redacted]')
  .replaceAll(/access_token["=:]\s*["']?[^"',\s}]+/gi, 'access_token=[redacted]')
  .replaceAll(/refresh_token["=:]\s*["']?[^"',\s}]+/gi, 'refresh_token=[redacted]');

async function dismissBlockingOverlays(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    for (const text of ['スキップ', '閉じる', 'あとで', '完了']) {
      const button = page.getByRole('button', { name: text }).first();
      if (await button.isVisible({ timeout: 750 }).catch(() => false)) {
        await button.click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }
    const blockingOverlayVisible = await page.locator('.fixed.inset-0.z-50').first().isVisible({ timeout: 500 }).catch(() => false);
    if (!blockingOverlayVisible) return;
    await page.waitForTimeout(500);
  }
}

async function runFlow(page, viewport, flow, errorsByFlow) {
  const startUrl = new URL(flow.startPath, baseUrl).toString();
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1000);
  await dismissBlockingOverlays(page);
  const clickTarget = clickableByText(page, flow.clickText);
  await clickTarget.waitFor({ state: 'visible', timeout: 30_000 });
  await page.screenshot({ path: path.join(outDir, `${viewport.name}-${flow.name}-before.png`), fullPage: true });
  await dismissBlockingOverlays(page);
  await clickableByText(page, flow.clickText).click();
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  await dismissBlockingOverlays(page);
  await page.getByText(flow.expectedText, { exact: false }).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(750);

  const finalUrl = page.url();
  const bodyText = await page.locator('body').innerText({ timeout: 15_000 }).catch(() => '');
  const finalPath = new URL(finalUrl).pathname;
  const screenshotPath = path.join(outDir, `${viewport.name}-${flow.name}-after.png`);
  const textPath = path.join(outDir, `${viewport.name}-${flow.name}.txt`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  writeFileSync(textPath, redact(bodyText));

  const flowErrors = errorsByFlow.get(flow.name) || [];
  const consoleErrors = flowErrors.filter((entry) => entry.kind === 'console');
  const pageErrors = flowErrors.filter((entry) => entry.kind === 'pageerror');
  const passed = finalPath === flow.expectedPath
    && bodyText.includes(flow.expectedText)
    && consoleErrors.length === 0
    && pageErrors.length === 0;

  return {
    viewport: viewport.name,
    flow: flow.name,
    startUrl,
    clickText: flow.clickText,
    expectedPath: flow.expectedPath,
    expectedText: flow.expectedText,
    finalUrl,
    finalPath,
    expectedTextFound: bodyText.includes(flow.expectedText),
    screenshotPath,
    textPath,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    passed,
  };
}

function clickableByText(page, text) {
  const pattern = new RegExp(escapeRegExp(text));
  return page
    .getByRole('link', { name: pattern })
    .or(page.getByRole('button', { name: pattern }))
    .first();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const startedAt = new Date().toISOString();
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      storageState,
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    let activeFlow = 'bootstrap';
    const errorsByFlow = new Map();

    const addError = (flowName, entry) => {
      const list = errorsByFlow.get(flowName) || [];
      list.push(entry);
      errorsByFlow.set(flowName, list);
    };

    page.on('console', (message) => {
      if (message.type() === 'error') {
        addError(activeFlow, {
          kind: 'console',
          text: redact(message.text()).slice(0, 1000),
          location: message.location(),
        });
      }
    });
    page.on('pageerror', (error) => {
      addError(activeFlow, {
        kind: 'pageerror',
        message: redact(error.message),
        stack: redact(error.stack || ''),
      });
    });

    for (const flow of flows) {
      activeFlow = flow.name;
      results.push(await runFlow(page, viewport, flow, errorsByFlow));
    }

    await page.close();
    await context.close();
  }
} finally {
  await browser.close();
}

const failures = results.filter((result) => !result.passed);
const summary = {
  startedAt,
  finishedAt: new Date().toISOString(),
  baseUrl,
  storageState,
  outDir,
  viewports,
  flows,
  resultCount: results.length,
  failureCount: failures.length,
  results,
};

writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

if (failures.length > 0) {
  console.error('Lightchain production navigation verification failed. Secret values were not printed.');
  for (const failure of failures) {
    console.error(`- ${failure.viewport}/${failure.flow}: finalPath=${failure.finalPath} expectedPath=${failure.expectedPath} text=${failure.expectedTextFound} consoleErrors=${failure.consoleErrorCount} pageErrors=${failure.pageErrorCount}`);
  }
  process.exit(1);
}

console.log(`Lightchain production navigation verification passed. Proof: ${path.join(outDir, 'summary.json')}`);
