import { expect, test } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173';

test('model-matrix permission affordance never dispatches a generation request while source access is denied', async ({ page }, testInfo) => {
  const mutationRequests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const blockedExternalRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const session = {
    user: {
      id: 'local-proof-user',
      email: 'proof@example.test',
      name: 'Local Proof',
      emailVerified: true,
      createdAt: new Date().toISOString(),
    },
    session: {
      token: 'local-proof-token',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
  };

  await page.route('**/*', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      mutationRequests.push(`${request.method()} ${requestUrl.origin}${requestUrl.pathname}`);
    }
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

    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });

  await page.goto('/model');
  await expect(page).toHaveTitle(/Lightchain AI/);
  const permissionAction = page.getByTestId('lightchain-model-permission');
  await expect(permissionAction).toBeVisible();
  await expect(permissionAction).toHaveText(/権限がありません/);
  await expect(page.getByText('AIフィッティング').first()).toBeVisible();

  const beforeClick = mutationRequests.length;
  await permissionAction.click();
  await expect(page).toHaveURL(`${new URL(baseURL).origin}/model`);
  await expect(permissionAction).toBeVisible();
  expect(mutationRequests.slice(beforeClick)).toEqual([]);
  const screenshotPath = testInfo.outputPath('heavy-model-permission-denied-after-click.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach('heavy-model-permission-denied-after-click', {
    path: screenshotPath,
    contentType: 'image/png',
  });
  const expectedBlockedAssetErrors = consoleErrors.filter((message) => message.includes('net::ERR_BLOCKED_BY_CLIENT'));
  const appConsoleErrors = consoleErrors.filter((message) => !message.includes('net::ERR_BLOCKED_BY_CLIENT'));
  expect(pageErrors).toEqual([]);
  expect(appConsoleErrors).toEqual([]);
  expect(expectedBlockedAssetErrors).toHaveLength(blockedExternalRequests.length);
  testInfo.annotations.push({
    type: 'local-network-isolation',
    description: `Blocked ${blockedExternalRequests.length} external asset requests; matching browser resource errors are expected in this offline fixture.`,
  });
});
