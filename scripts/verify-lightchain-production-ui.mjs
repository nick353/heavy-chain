import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.LIGHTCHAIN_UI_BASE_URL || 'https://heavy-chain.zeabur.app';
const storageState = process.env.LIGHTCHAIN_UI_AUTH_STATE || 'output/playwright/prod-auth-dashboard-20260623/auth-state-after-tutorial.json';
const outDir = process.env.LIGHTCHAIN_UI_OUT_DIR || `output/playwright/lightchain-production-ui-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;

const viewports = [
  { name: 'desktop', width: 1440, height: 1100 },
  { name: 'mobile', width: 390, height: 900 },
];

const pages = [
  {
    name: 'dashboard',
    path: '/dashboard',
    expected: ['制作ワークフロー', '必要なもの', '作れるもの'],
  },
  {
    name: 'generate',
    path: '/generate',
    expected: ['制作レーンから始める', '制作ワークフローへ戻る', 'Runway生成前チェック'],
  },
  {
    name: 'fitting',
    path: '/fitting',
    expected: ['着用ワークフローを選ぶ', '衣服画像'],
  },
  {
    name: 'marketing',
    path: '/marketing',
    expected: ['マーケティングワークスペース', 'キャンバスへ渡す'],
  },
  {
    name: 'studio',
    path: '/studio',
    expected: ['生成前スタジオ設定', 'Canvas'],
  },
  {
    name: 'models',
    path: '/models',
    expected: ['モデル候補を選ぶ', '条件プレビュー', 'Canvasへ保存'],
  },
  {
    name: 'patterns',
    path: '/patterns',
    expected: ['制作ボード', 'Canvas'],
  },
  {
    name: 'video',
    path: '/video',
    expected: ['動画レーンを選ぶ', '素材ファイル'],
  },
  {
    name: 'lab',
    path: '/lab',
    expected: ['実験レーンを選ぶ', '評価プレビュー'],
  },
  {
    name: 'gallery',
    path: '/gallery',
    expected: ['成果物を選ぶ', 'Canvasで再編集', '採用候補を見る'],
  },
  {
    name: 'history',
    path: '/history',
    expected: ['続きから再開', '失敗を確認', '保存済みを見る'],
  },
  {
    name: 'canvas',
    path: '/canvas/new',
    expected: ['画像を置く', '生成する', '素材を見る'],
  },
  {
    name: 'brand-settings',
    path: '/brand/settings',
    expected: ['Runway MCP接続', '承認済み', '生成可否', 'サブスク条件が未達です'],
  },
  {
    name: 'admin-runway',
    path: '/admin?tab=runway',
    expected: ['Runway MCP', '承認', '本番生成 readiness', 'プラン未達'],
  },
];

mkdirSync(outDir, { recursive: true });

const redact = (value) => String(value)
  .replaceAll(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[redacted-jwt]')
  .replaceAll(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [redacted]')
  .replaceAll(/access_token["=:]\s*["']?[^"',\s}]+/gi, 'access_token=[redacted]')
  .replaceAll(/refresh_token["=:]\s*["']?[^"',\s}]+/gi, 'refresh_token=[redacted]');

async function dismissBlockingOverlays(page) {
  const buttonTexts = [
    'スキップ',
    '閉じる',
    'あとで',
    'はじめる',
    '完了',
  ];

  for (const text of buttonTexts) {
    const button = page.getByRole('button', { name: text }).first();
    if (await button.isVisible({ timeout: 750 }).catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

async function waitForExpectedText(page, expected) {
  await Promise.race([
    ...expected.map((text) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 30_000 })),
    page.waitForTimeout(30_000),
  ]).catch(() => {});
}

async function verifyPage(page, viewport, pageSpec, errorsByPage) {
  const consoleErrors = [];
  const pageErrors = [];

  const requestedUrl = new URL(pageSpec.path, baseUrl).toString();
  await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await dismissBlockingOverlays(page);
  await waitForExpectedText(page, pageSpec.expected);
  await dismissBlockingOverlays(page);
  await page.waitForTimeout(1000);

  const bodyText = await page.locator('body').innerText({ timeout: 15_000 }).catch(() => '');
  const finalUrl = page.url();
  const missingText = pageSpec.expected.filter((expectedText) => !bodyText.includes(expectedText));
  const redirectedToLogin = /\/login(?:$|[?#])/.test(new URL(finalUrl).pathname);
  const screenshotPath = path.join(outDir, `${viewport.name}-${pageSpec.name}.png`);
  const textPath = path.join(outDir, `${viewport.name}-${pageSpec.name}.txt`);
  const consolePath = path.join(outDir, `${viewport.name}-${pageSpec.name}.console.json`);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  writeFileSync(textPath, redact(bodyText));
  writeFileSync(consolePath, JSON.stringify({ consoleErrors, pageErrors }, null, 2));
  for (const entry of errorsByPage.get(pageSpec.name) || []) {
    if (entry.kind === 'console') consoleErrors.push(entry.payload);
    if (entry.kind === 'pageerror') pageErrors.push(entry.payload);
  }

  return {
    viewport: viewport.name,
    page: pageSpec.name,
    requestedUrl,
    finalUrl,
    screenshotPath,
    textPath,
    consolePath,
    expected: pageSpec.expected,
    missingText,
    redirectedToLogin,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    passed: !redirectedToLogin && missingText.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0,
  };
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
    let activePageName = 'bootstrap';
    const errorsByPage = new Map();

    const addError = (pageName, entry) => {
      const list = errorsByPage.get(pageName) || [];
      list.push(entry);
      errorsByPage.set(pageName, list);
    };

    page.on('console', (message) => {
      if (message.type() === 'error') {
        addError(activePageName, {
          kind: 'console',
          payload: {
            text: redact(message.text()).slice(0, 1000),
            location: message.location(),
          },
        });
      }
    });
    page.on('pageerror', (error) => {
      addError(activePageName, {
        kind: 'pageerror',
        payload: {
          message: redact(error.message),
          stack: redact(error.stack || ''),
        },
      });
    });

    for (const pageSpec of pages) {
      activePageName = pageSpec.name;
      results.push(await verifyPage(page, viewport, pageSpec, errorsByPage));
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
  pages: pages.map(({ name, path, expected }) => ({ name, path, expected })),
  viewports,
  resultCount: results.length,
  failureCount: failures.length,
  results,
};

writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

if (failures.length > 0) {
  console.error('Lightchain production UI verification failed. Secret values were not printed.');
  for (const failure of failures) {
    console.error(`- ${failure.viewport}/${failure.page}: missing=${failure.missingText.join('|') || 'none'} login=${failure.redirectedToLogin} consoleErrors=${failure.consoleErrorCount} pageErrors=${failure.pageErrorCount}`);
  }
  process.exit(1);
}

console.log(`Lightchain production UI verification passed. Proof: ${path.join(outDir, 'summary.json')}`);
