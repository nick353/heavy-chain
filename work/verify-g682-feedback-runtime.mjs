import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.argv.find((arg) => arg.startsWith('--baseUrl='))?.split('=')[1] || 'http://127.0.0.1:4177';
const outDir = process.argv.find((arg) => arg.startsWith('--out='))?.split('=')[1] || 'output/playwright/g682-feedback-runtime-local';
fs.mkdirSync(outDir, { recursive: true });

const userId = '00000000-0000-4000-8000-000000000682';
const brandId = '11111111-1111-4111-8111-000000000682';
const authKey = 'sb-ghwjymozrwmcrpjqvbmo-auth-token';
const session = {
  access_token: 'g682-runtime-test-token',
  refresh_token: 'g682-runtime-test-refresh',
  expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'g682-runtime@example.com',
    user_metadata: { name: 'G682 Runtime Admin' },
    app_metadata: { provider: 'email' },
    created_at: new Date().toISOString(),
  },
};

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const createRoutes = (page, captured) => page.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());

  if (url.pathname.includes('/auth/v1/token')) {
    return route.fulfill(json({ access_token: session.access_token, refresh_token: session.refresh_token, user: session.user }));
  }

  if (url.pathname.includes('/auth/v1/user')) {
    return route.fulfill(json(session.user));
  }

  if (url.pathname.includes('/rest/v1/users')) {
    const row = {
      id: userId,
      email: 'g682-runtime@example.com',
      name: 'G682 Runtime Admin',
      avatar_url: null,
      is_admin: true,
      created_at: '2026-07-02T00:00:00.000Z',
      updated_at: '2026-07-02T00:00:00.000Z',
    };
    if (request.headers().accept?.includes('application/vnd.pgrst.object+json')) {
      return route.fulfill(json(row));
    }
    return route.fulfill(json([row]));
  }

  if (url.pathname.includes('/rest/v1/brands')) {
    return route.fulfill(json([{
      id: brandId,
      name: 'G682 Runtime Brand',
      owner_id: userId,
      created_at: '2026-07-02T00:00:00.000Z',
      updated_at: '2026-07-02T00:00:00.000Z',
    }]));
  }

  if (url.pathname.includes('/rest/v1/feedback_submissions')) {
    if (request.method() === 'PATCH') {
      captured.adminUpdates.push(JSON.parse(request.postData() || '{}'));
      return route.fulfill(json([{
        id: 'feedback-row-runtime',
        status: 'in_progress',
        admin_note: '確認中',
      }]));
    }
    return route.fulfill(json([{
      id: 'feedback-row-runtime',
      user_id: userId,
      brand_id: brandId,
      type: 'lost',
      message: '右下ボタンの実動作確認です。スクショ付きで収集できるか見ています。',
      email: 'g682-runtime@example.com',
      page_url: `${baseUrl}/dashboard`,
      pathname: '/dashboard',
      viewport: { width: 1366, height: 768, devicePixelRatio: 1 },
      user_agent: 'Playwright G682 runtime',
      screenshot_path: `${userId}/runtime.png`,
      screenshot_capture_status: 'captured',
      status: 'new',
      admin_note: null,
      created_at: '2026-07-02T10:00:00.000Z',
      updated_at: '2026-07-02T10:00:00.000Z',
      resolved_at: null,
      user: { email: 'g682-runtime@example.com', name: 'G682 Runtime Admin' },
      brand: { name: 'G682 Runtime Brand' },
    }]));
  }

  if (url.pathname.includes('/rest/v1/')) {
    return route.fulfill(json([]));
  }

  if (url.pathname.includes('/storage/v1/object/sign/feedback-screenshots/')) {
    return route.fulfill(json({ signedURL: `${baseUrl}/mock-feedback-screenshot.png`, signedUrl: `${baseUrl}/mock-feedback-screenshot.png` }));
  }

  if (url.pathname === '/mock-feedback-screenshot.png') {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    return route.fulfill({ status: 200, contentType: 'image/png', body: png });
  }

  if (url.pathname.includes('/functions/v1/submit-feedback')) {
    captured.submissions.push(JSON.parse(request.postData() || '{}'));
    return route.fulfill(json({
      ok: true,
      feedback: {
        id: 'feedback-row-runtime-submitted',
        screenshot_path: `${userId}/runtime-submitted.png`,
        screenshot_capture_status: 'captured',
      },
    }));
  }

  return route.continue();
});

const run = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: authKey, value: session });

  const captured = { submissions: [], adminUpdates: [], consoleErrors: [], pageErrors: [] };
  const page = await context.newPage();
  await createRoutes(page, captured);
  page.on('console', (message) => {
    if (message.type() === 'error') captured.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => captured.pageErrors.push(error.message));

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await page.getByLabel('フィードバックを送信').click();
  await page.getByText('使いにくかった場所を教えてください').waitFor({ timeout: 15000 });
  await page.getByText('画面スクショ', { exact: true }).waitFor();
  await page.locator('img[alt="送信される画面スクショ"]').waitFor({ timeout: 15000 });
  const noFeedbackCategoryControls = await page.getByText('困ったこと', { exact: true }).count() === 0
    && await page.getByText('動作が遅い', { exact: true }).count() === 0;
  const noEmailInput = await page.getByLabel('メールアドレス（任意）').count() === 0;
  await page.screenshot({ path: path.join(outDir, 'dashboard-feedback-modal.png'), fullPage: true });
  await page.getByRole('button', { name: '再撮影' }).click();
  await page.locator('img[alt="送信される画面スクショ"]').waitFor({ timeout: 15000 });
  await page.getByLabel('コメント').fill('G682 runtime check: screenshot feedback submission.');
  await page.getByRole('button', { name: '送信する' }).click();
  await page.getByText('ありがとうございます！').waitFor({ timeout: 15000 });
  const successVisibleAfterSubmit = await page.getByText('ありがとうございます！').isVisible();

  await page.goto(`${baseUrl}/generate`, { waitUntil: 'networkidle' });
  await page.getByLabel('フィードバックを送信').waitFor({ timeout: 15000 });

  await page.goto(`${baseUrl}/gallery`, { waitUntil: 'networkidle' });
  await page.getByLabel('フィードバックを送信').waitFor({ timeout: 15000 });

  await page.goto(`${baseUrl}/admin?tab=feedback`, { waitUntil: 'networkidle' });
  await page.getByText('社内betaフィードバック').waitFor({ timeout: 15000 });
  await page.getByText('右下ボタンの実動作確認です').waitFor();
  await page.getByRole('button', { name: '開く' }).first().click();
  await page.getByText('フィードバック詳細').waitFor();
  await page.getByText('管理メモ').waitFor();
  await page.screenshot({ path: path.join(outDir, 'admin-feedback-detail.png'), fullPage: true });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mobile.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: authKey, value: session });
  const mobilePage = await mobile.newPage();
  await createRoutes(mobilePage, captured);
  await mobilePage.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  const mobileButton = mobilePage.getByLabel('フィードバックを送信');
  const mobileButtonCount = await mobileButton.count();
  const mobileButtonHidden = await mobileButton.isHidden().catch(() => false);
  const mobileButtonStyle = mobileButtonCount === 1
    ? await mobileButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        display: style.display,
        visibility: style.visibility,
        width: rect.width,
        height: rect.height,
      };
    })
    : null;
  const box = await mobileButton.boundingBox();
  await mobilePage.screenshot({ path: path.join(outDir, 'mobile-dashboard-feedback-button.png'), fullPage: true });
  await mobile.close();

  const submission = captured.submissions[0] || null;
  const assertions = {
    dashboardFeedbackModalVisible: successVisibleAfterSubmit,
    submitFeedbackInvoked: captured.submissions.length === 1,
    submissionUsesOtherType: submission?.type === 'other',
    submissionHasScreenshotDataUrl: typeof submission?.screenshot_data_url === 'string' && submission.screenshot_data_url.startsWith('data:image/png;base64,'),
    submissionHasContext: submission?.page_url?.includes('/dashboard') && submission?.pathname === '/dashboard' && submission?.viewport?.width === 1366 && Boolean(submission?.user_agent),
    noFeedbackCategoryControls,
    noEmailInput,
    mainRoutesButtonVisible: true,
    adminFeedbackDetailVisible: await page.getByText('フィードバック詳細').isVisible(),
    mobileButtonExistsOnce: mobileButtonCount === 1,
    mobileButtonHiddenToAvoidCtaOverlap: mobileButtonCount === 1 && mobileButtonHidden && !box && mobileButtonStyle?.display === 'none',
    noPageErrors: captured.pageErrors.length === 0,
    noRelevantConsoleErrors: captured.consoleErrors.filter((message) => (
      message.includes('submit-feedback')
      || message.includes('feedback_submissions')
      || message.includes('feedback-screenshots')
    )).length === 0,
  };
  const ok = Object.values(assertions).every(Boolean);
  const summary = {
    schema: 'heavy-chain.g682-feedback-runtime.v1',
    capturedAt: new Date().toISOString(),
    baseUrl,
    ok,
    assertions,
    captured: {
      submissions: captured.submissions.map((item) => ({
        ...item,
        screenshot_data_url: item.screenshot_data_url ? `data:image/png;base64,<${item.screenshot_data_url.length} chars>` : null,
      })),
      adminUpdates: captured.adminUpdates,
      consoleErrors: captured.consoleErrors,
      pageErrors: captured.pageErrors,
    },
    screenshots: {
      dashboardFeedbackModal: path.join(outDir, 'dashboard-feedback-modal.png'),
      adminFeedbackDetail: path.join(outDir, 'admin-feedback-detail.png'),
      mobileDashboardFeedbackButton: path.join(outDir, 'mobile-dashboard-feedback-button.png'),
    },
  };
  fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await context.close();
  await browser.close();
  if (!ok) {
    console.error(JSON.stringify(summary, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(summary, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
