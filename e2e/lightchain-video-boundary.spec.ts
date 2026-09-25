import { expect, test, type Page, type TestInfo } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173';

function installLocalVideoBoundary(page: Page) {
  const unsafeRequests: string[] = [];
  const blockedExternalRequests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const session = {
    user: {
      id: 'local-video-proof-user',
      email: 'video-proof@example.test',
      name: 'Local Video Proof',
      emailVerified: true,
      createdAt: new Date().toISOString(),
    },
    session: {
      token: 'local-video-proof-token',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
  };

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const routeInstalled = page.route('**/*', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const safeMethod = request.method() === 'GET' || request.method() === 'HEAD' || request.method() === 'OPTIONS';
    if (!safeMethod) unsafeRequests.push(`${request.method()} ${requestUrl.origin}${requestUrl.pathname}`);

    if (requestUrl.origin !== new URL(baseURL).origin) {
      blockedExternalRequests.push(request.resourceType());
      await route.abort('blockedbyclient');
      return;
    }

    if (requestUrl.pathname === '/api/auth/ok') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (requestUrl.pathname === '/api/auth/get-session') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
      return;
    }
    if (requestUrl.pathname.startsWith('/api/auth/')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    if (!safeMethod) {
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });

  return { routeInstalled, unsafeRequests, blockedExternalRequests, consoleErrors, pageErrors };
}

function assertNoApplicationErrors(
  testInfo: TestInfo,
  boundary: ReturnType<typeof installLocalVideoBoundary>,
) {
  const expectedBlockedAssetErrors = boundary.consoleErrors.filter((message) => message.includes('net::ERR_BLOCKED_BY_CLIENT'));
  const appConsoleErrors = boundary.consoleErrors.filter((message) => !message.includes('net::ERR_BLOCKED_BY_CLIENT'));
  expect(boundary.unsafeRequests).toEqual([]);
  expect(boundary.pageErrors).toEqual([]);
  expect(appConsoleErrors).toEqual([]);
  expect(expectedBlockedAssetErrors).toHaveLength(boundary.blockedExternalRequests.length);
  testInfo.annotations.push({
    type: 'local-network-isolation',
    description: `Blocked ${boundary.blockedExternalRequests.length} external asset requests; matching browser resource errors are expected in this offline fixture.`,
  });
}

test('Lightchain homepage video card opens the new-project flow', async ({ page }, testInfo) => {
  const boundary = installLocalVideoBoundary(page);
  await boundary.routeInstalled;

  await page.goto('/');
  await expect(page).toHaveTitle(/Lightchain AI/);
  const videoCard = page.getByTestId('lightchain-tool-card').filter({ hasText: '動画ワークステーション' });
  await expect(videoCard).toHaveCount(1);
  await expect(videoCard).toHaveAttribute('href', '/flow/GenerateShortVideo');
  await videoCard.click();
  await expect(page).toHaveURL(`${new URL(baseURL).origin}/flow/GenerateShortVideo`);
  await expect(page.getByTestId('lightchain-video-project-dashboard')).toBeVisible();
  await page.getByRole('button', { name: '新規ファイル' }).click();
  await expect(page).toHaveURL(/\/flow\/GenerateShortVideo\/detail/);
  await expect(page.getByTestId('video-guide-skip')).toBeVisible();
  expect(boundary.unsafeRequests).toEqual([]);

  const screenshotPath = testInfo.outputPath('heavy-video-home-to-new-project.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach('heavy-video-home-to-new-project', { path: screenshotPath, contentType: 'image/png' });
  assertNoApplicationErrors(testInfo, boundary);
});

test('video editor retains its local image after settings change via the homepage route', async ({ page }, testInfo) => {
  test.setTimeout(15_000);
  const boundary = installLocalVideoBoundary(page);
  await boundary.routeInstalled;

  await page.goto('/');
  await page.getByTestId('lightchain-tool-card').filter({ hasText: '動画ワークステーション' }).click();
  await expect(page.getByTestId('lightchain-video-project-dashboard')).toBeVisible();
  await page.getByRole('button', { name: '新規ファイル' }).click();
  await expect(page.getByTestId('video-guide-skip')).toBeVisible();
  await page.getByTestId('video-guide-skip').click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'local-product.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3x8AAAAASUVORK5CYII=', 'base64'),
  });

  const editor = page.getByTestId('video-source-editor-parity');
  await expect(editor).toBeVisible();
  const selects = editor.locator('select');
  await selects.nth(0).selectOption('10秒');
  await expect(editor).toBeVisible();
  await expect(selects.nth(0)).toHaveValue('10秒');
  await selects.nth(1).selectOption('1080P', { timeout: 3_000 });
  await expect(editor).toBeVisible();
  await expect(selects.nth(0)).toHaveValue('10秒');
  await expect(selects.nth(1)).toHaveValue('1080P');
  await expect(editor.locator('img[alt="videoResult"]').last()).toHaveAttribute('src', /^data:image\/png;base64,/);
  const screenshotPath = testInfo.outputPath('heavy-video-integrated-route-editor.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach('heavy-video-integrated-route-editor', { path: screenshotPath, contentType: 'image/png' });
  assertNoApplicationErrors(testInfo, boundary);
});

test('Lightchain video detail accepts a local reference and keeps generation fail-closed', async ({ page }, testInfo) => {
  const boundary = installLocalVideoBoundary(page);
  await boundary.routeInstalled;

  await page.goto('/flow/GenerateShortVideo/detail?boardProjectCode=&boardProjectType=');
  await expect(page.getByTestId('video-guide-skip')).toBeVisible();
  await page.getByTestId('video-guide-skip').click();
  await expect(page.getByTestId('video-initial-image-dropzone')).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'local-product.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3x8AAAAASUVORK5CYII=', 'base64'),
  });

  const editor = page.getByTestId('video-source-editor-parity');
  await expect(editor).toBeVisible();
  const prompt = page.getByLabel('修正指示');
  await prompt.fill('Local-only video edit smoke test');
  await expect(prompt).toHaveValue('Local-only video edit smoke test');
  await expect(page.getByText('32/1000')).toBeVisible();

  const selects = editor.locator('select');
  await selects.nth(0).selectOption('10秒');
  await expect(editor).toBeVisible();
  await selects.nth(1).selectOption('1080P');
  await expect(editor).toBeVisible();
  await expect(selects.nth(0)).toHaveValue('10秒');
  await expect(selects.nth(1)).toHaveValue('1080P');

  const generate = page.getByTestId('video-generation-blocked');
  await expect(generate).toBeDisabled();
  await expect(generate).toHaveAttribute('data-lightchain-provider-route', 'unsupported');
  await expect(generate).toHaveAttribute('title', /video_provider_not_admitted/);

  const screenshotPath = testInfo.outputPath('heavy-video-detail-local-reference-and-provider-gate.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach('heavy-video-detail-local-reference-and-provider-gate', {
    path: screenshotPath,
    contentType: 'image/png',
  });
  assertNoApplicationErrors(testInfo, boundary);
});

test('video editor keeps source controls interactive without admitting a provider', async ({ page }, testInfo) => {
  const boundary = installLocalVideoBoundary(page);
  await boundary.routeInstalled;

  await page.goto('/flow/GenerateShortVideo/detail?boardProjectCode=&boardProjectType=');
  await page.getByTestId('video-guide-skip').click();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'local-product.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3x8AAAAASUVORK5CYII=', 'base64'),
  });

  const editor = page.getByTestId('video-source-editor-parity');
  await expect(editor).toBeVisible();
  const prompt = page.getByLabel('修正指示');
  const initialPrompt = await prompt.inputValue();
  await prompt.fill('interactive local editor change');
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(prompt).toHaveValue(initialPrompt);
  await page.getByRole('button', { name: 'やり直す' }).click();
  await expect(prompt).toHaveValue('interactive local editor change');

  await page.locator('#video-reference-upload').setInputFiles({
    name: 'local-reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3x8AAAAASUVORK5CYII=', 'base64'),
  });
  await expect(editor.locator('img[alt="参考画像"]')).toHaveAttribute('src', /^data:image\/png;base64,/);

  await page.locator('select').nth(0).selectOption('10秒');
  await expect(editor.locator('.video-source-existing-video-controls')).toContainText('00:10');
  await page.getByRole('button', { name: '拡大' }).click();
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '移動' }).click();
  await expect(page.getByRole('button', { name: '移動' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByRole('complementary', { name: '動画の修正' })).toHaveCount(0);
  await page.getByRole('button', { name: 'パネル' }).click();
  await expect(page.getByRole('complementary', { name: '動画の修正' })).toBeVisible();
  await page.getByRole('button', { name: 'ハンドブック', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'ハンドブック' })).toBeVisible();
  await page.getByRole('button', { name: 'ハンドブックを閉じる' }).click();
  await page.getByRole('button', { name: '動画を開く' }).click();
  await expect(page.getByRole('dialog', { name: '動画プレビュー' })).toBeVisible();
  await page.getByRole('button', { name: '動画プレビューを閉じる' }).click();
  await expect(page.getByRole('dialog', { name: '動画プレビュー' })).toHaveCount(0);
  await expect(page.getByTestId('video-generation-blocked')).toBeDisabled();
  assertNoApplicationErrors(testInfo, boundary);
});
