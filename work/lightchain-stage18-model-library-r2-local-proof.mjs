import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.LIGHTCHAIN_BASE_URL || 'http://127.0.0.1:4205';
const outDir = path.resolve('output/playwright/lightchain-stage18-model-library-preview-20260707-r2-local-auth-helper');
const route = `${baseUrl}/lightchain/model-library`;

async function readEnvValue(name) {
  if (process.env[name]) return process.env[name];
  for (const file of ['.env.local', '.env.production.local', '.env']) {
    try {
      const text = await readFile(file, 'utf8');
      const line = text.split(/\r?\n/).filter((entry) => entry.startsWith(`${name}=`)).pop();
      if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
    } catch {
      // Try the next conventional Vite env file.
    }
  }
  return null;
}

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
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

async function main() {
  const supabaseUrl = await readEnvValue('VITE_SUPABASE_URL');
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is required for local auth helper proof');
  }
  const projectRef = new URL(supabaseUrl).host.split('.')[0];
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const events = [];
  page.on('console', (message) => {
    events.push({ type: 'console', level: message.type(), text: message.text() });
  });
  page.on('pageerror', (error) => {
    events.push({ type: 'pageerror', text: error.message, stack: error.stack });
  });
  page.on('requestfailed', (request) => {
    events.push({
      type: 'requestfailed',
      url: request.url(),
      failure: request.failure()?.errorText ?? null,
    });
  });
  const userId = '00000000-0000-4000-8000-000000000018';
  const email = 'stage18-local-proof@example.test';
  const token = makeLocalJwt(userId, email);

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ userId, email, projectRef, token }) => {
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

  await page.addInitScript(({ userId, email, projectRef, token }) => {
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

  const summary = {
    ok: false,
    exactBlocker: null,
    route,
    checks: {},
    screenshots: {},
    readbackPath: path.join(outDir, 'model-library-dom-readback.json'),
    timestamp: new Date().toISOString(),
  };

  try {
    await page.goto(route, { waitUntil: 'networkidle' });
    await page.locator('#root').waitFor({ timeout: 15_000 });
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 15_000 });
    await page.getByRole('heading', { name: 'モデルカスタマイズ' }).first().waitFor({ timeout: 15_000 });
    await page.screenshot({ path: path.join(outDir, 'model-library-initial.png'), fullPage: true });
    summary.screenshots.initial = path.join(outDir, 'model-library-initial.png');

    await page.getByRole('button', { name: /AI生成/ }).last().click();
    await page.getByText('モデルカスタマイズプレビュー').waitFor({ timeout: 15_000 });
    await page.screenshot({ path: path.join(outDir, 'model-library-after-ai.png'), fullPage: true });
    summary.screenshots.afterAi = path.join(outDir, 'model-library-after-ai.png');

    const readback = await page.evaluate(() => {
      const controls = Array.from(document.querySelectorAll('button,a,input,textarea,[role]')).map((element, i) => {
        const rect = element.getBoundingClientRect();
        return {
          i,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role'),
          text: element.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '',
          disabled: element.disabled || element.getAttribute('aria-disabled') === 'true',
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      });
      return {
        url: window.location.href,
        title: document.title,
        bodyText: document.body.innerText,
        controls,
      };
    });

    summary.checks = {
      stayedOnRoute: readback.url.endsWith('/lightchain/model-library'),
      hasDefaultFormTitle: readback.bodyText.includes('モデルカスタマイズ'),
      hasCustomFormControls: ['ラベル', 'カスタム', '性別', '男性', '女性', '年齢', '国籍', '肌の色', '体型', 'ハーフ', 'AI生成', '生成履歴'].every((text) => readback.bodyText.includes(text)),
      hasPreviewTitle: readback.bodyText.includes('モデルカスタマイズプレビュー'),
      removedLibraryRightCopy: !readback.bodyText.includes('モデル企画ライブラリ'),
      hidesCanvasSave: !readback.bodyText.includes('Canvasへ保存'),
      keepsHeavyChainLogo: readback.bodyText.includes('HEAVYCHAIN'),
    };
    summary.ok = Object.values(summary.checks).every(Boolean);
    if (!summary.ok) summary.exactBlocker = 'stage18_model_library_local_readback_failed';
    await writeFile(summary.readbackPath, JSON.stringify(readback, null, 2));
  } catch (error) {
    summary.exactBlocker = error instanceof Error ? error.message : String(error);
    const blockerScreenshot = path.join(outDir, 'model-library-blocker.png');
    await page.screenshot({ path: blockerScreenshot, fullPage: true }).catch(() => undefined);
    summary.screenshots.blocker = blockerScreenshot;
    const blockerReadback = await page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      bodyText: document.body.innerText,
    })).catch((readError) => ({ readError: readError instanceof Error ? readError.message : String(readError) }));
    await writeFile(path.join(outDir, 'model-library-blocker-readback.json'), JSON.stringify(blockerReadback, null, 2));
  } finally {
    await writeFile(path.join(outDir, 'browser-events.json'), JSON.stringify(events, null, 2));
    await writeFile(path.join(outDir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
    await browser.close();
  }

  if (!summary.ok) {
    console.error(JSON.stringify(summary, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(summary, null, 2));
}

main();
