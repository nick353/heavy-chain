import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.baseUrl || process.env.HEAVY_CHAIN_BASE_URL || 'http://127.0.0.1:4178';
const authStatePath = args.authState || process.env.LIGHTCHAIN_UI_AUTH_STATE || 'output/playwright/prod-auth-dashboard-20260623/auth-state-after-tutorial.json';
const outDir = args.out || `output/playwright/no-image-planning-mode-${new Date().toISOString().replace(/[:.]/g, '-')}`;

const blockedFunctionPattern = /\/functions\/v1\/(generate-image|product-shots|model-matrix|multilingual-banner|design-gacha|generate-variations|remove-background|colorize|upscale|bulk-download)\b/;

await mkdir(outDir, { recursive: true });

const proof = {
  baseUrl,
  authStatePath,
  finalUrl: null,
  checks: [],
  blockers: [],
  blockedFunctionRequests: [],
  screenshots: {},
  bodyTextEvidence: {},
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});

await seedLocalStorageFromAuthState(context, authStatePath);

const page = await context.newPage();
page.on('request', (request) => {
  const url = request.url();
  if (blockedFunctionPattern.test(url)) {
    proof.blockedFunctionRequests.push({
      method: request.method(),
      url: redactUrl(url),
    });
  }
});

try {
  await page.goto(`${baseUrl}/generate?feature=campaign-image`, { waitUntil: 'networkidle', timeout: 45000 });
  proof.finalUrl = page.url();
  await page.screenshot({ path: path.join(outDir, '01-generate-initial.png'), fullPage: true });
  proof.screenshots.initial = path.join(outDir, '01-generate-initial.png');

  const bodyText = await page.locator('body').innerText({ timeout: 15000 });
  proof.bodyTextEvidence.initial = pickEvidence(bodyText, [
    'Runway生成前チェック',
    '企画書を保存',
    '保存した企画',
    'ログイン',
  ]);

  if (/ログイン|メールアドレス|パスワード/.test(bodyText) && !bodyText.includes('企画書を保存')) {
    proof.blockers.push({
      code: 'auth_state_unavailable',
      message: 'Saved auth state did not open the generate page.',
      finalUrl: page.url(),
    });
    await finish(1);
  }

  await fillByLabelOrPlaceholder(page, 'ベースコンセプト', 'No image planning verification for Heavy Chain campaign visual.');
  await fillByLabelOrPlaceholder(page, 'タイトル', 'NO IMAGE MODE');
  await fillByLabelOrPlaceholder(page, 'サブタイトル', 'Plan first, generate later.');
  await fillByLabelOrPlaceholder(page, 'CTA', '企画を確認');

  await page.getByRole('button', { name: '企画書を保存' }).click();
  await page.getByRole('heading', { name: '企画書を保存しました' }).waitFor({ timeout: 15000 });
  await page.getByText('保存した企画').waitFor({ timeout: 15000 });
  await page.getByText(/企画書カードをWorkspaceに保存しました/).waitFor({ timeout: 15000 });
  await page.locator('img[src^="data:image/svg+xml"]').first().waitFor({ timeout: 15000 });

  const localStorageReadback = await page.evaluate(() => {
    const keys = Object.keys(window.localStorage).filter((key) => key.startsWith('heavy-chain-workspace-artifacts:v1'));
    return keys.map((key) => {
      const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
      return {
        key,
        count: Array.isArray(parsed) ? parsed.length : 0,
        latest: Array.isArray(parsed) && parsed[0] ? {
          id: parsed[0].id,
          featureType: parsed[0].featureType,
          title: parsed[0].title,
          artifactKind: parsed[0].metadata?.artifactKind,
          generationDisabled: parsed[0].metadata?.generationDisabled,
          imageUrlPrefix: String(parsed[0].imageUrl || '').slice(0, 30),
        } : null,
      };
    });
  });

  proof.checks.push({
    name: 'planning card saved to local workspace artifacts',
    passed: localStorageReadback.some((entry) => entry.latest?.artifactKind === 'planning_brief' && entry.latest?.generationDisabled === true),
    details: localStorageReadback,
  });
  proof.checks.push({
    name: 'no image generation function request observed',
    passed: proof.blockedFunctionRequests.length === 0,
    details: { blockedFunctionRequestCount: proof.blockedFunctionRequests.length },
  });

  await page.screenshot({ path: path.join(outDir, '02-planning-saved.png'), fullPage: true });
  proof.screenshots.saved = path.join(outDir, '02-planning-saved.png');
  proof.bodyTextEvidence.saved = pickEvidence(await page.locator('body').innerText(), [
    'Runway生成前チェック',
    '企画書を保存しました',
    '保存した企画',
    'NO IMAGE MODE',
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(outDir, '03-mobile-saved.png'), fullPage: true });
  proof.screenshots.mobile = path.join(outDir, '03-mobile-saved.png');

  if (proof.checks.some((check) => !check.passed)) {
    proof.blockers.push({ code: 'no_image_planning_check_failed', message: 'One or more no-image checks failed.' });
  }
  await finish(proof.blockers.length ? 1 : 0);
} catch (error) {
  proof.blockers.push({
    code: 'playwright_verification_error',
    message: error?.message || String(error),
    finalUrl: page.url(),
  });
  await page.screenshot({ path: path.join(outDir, 'error.png'), fullPage: true }).catch(() => {});
  await finish(1);
}

async function seedLocalStorageFromAuthState(context, statePath) {
  const raw = await readFile(statePath, 'utf8').catch(() => null);
  if (!raw) return;
  const state = JSON.parse(raw);
  const entries = [];
  for (const origin of state.origins || []) {
    for (const item of origin.localStorage || []) {
      if (item.name.startsWith('sb-') || item.name.startsWith('heavy-chain-')) {
        entries.push({ name: item.name, value: item.value });
      }
    }
  }
  if (!entries.length) return;
  await context.addInitScript((items) => {
    for (const item of items) {
      window.localStorage.setItem(item.name, item.value);
    }
  }, entries);
}

async function fillByLabelOrPlaceholder(page, name, value) {
  const byLabel = page.getByLabel(name, { exact: true });
  if (await byLabel.count()) {
    await byLabel.first().fill(value);
    return;
  }
  const byText = page.locator(`input[placeholder*="${name}"], textarea[placeholder*="${name}"]`);
  if (await byText.count()) {
    await byText.first().fill(value);
    return;
  }
  const fallback = page.locator('input, textarea').filter({ hasNotText: '' });
  await fallback.nth(0).fill(value);
}

function pickEvidence(text, needles) {
  return needles.reduce((acc, needle) => {
    const index = text.indexOf(needle);
    if (index >= 0) {
      acc[needle] = text.slice(Math.max(0, index - 80), Math.min(text.length, index + needle.length + 160));
    }
    return acc;
  }, {});
}

function redactUrl(url) {
  return url.replace(/(apikey|token|authorization)=([^&]+)/gi, '$1=[redacted]');
}

async function finish(code) {
  await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(proof, null, 2)}\n`);
  await browser.close();
  console.log(JSON.stringify({
    ok: code === 0,
    outDir,
    blockers: proof.blockers,
    blockedFunctionRequestCount: proof.blockedFunctionRequests.length,
  }, null, 2));
  process.exit(code);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--base-url' && next) {
      parsed.baseUrl = next;
      i += 1;
    } else if (arg === '--auth-state' && next) {
      parsed.authState = next;
      i += 1;
    } else if (arg === '--out' && next) {
      parsed.out = next;
      i += 1;
    }
  }
  return parsed;
}
