import { expect, test } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173';

function installLocalAuthStub(
  page: import('@playwright/test').Page,
  options: { initialAuthenticated?: boolean; sessionProbeFailures?: number } = {},
) {
  let authenticated = options.initialAuthenticated ?? false;
  let sessionProbeFailures = options.sessionProbeFailures ?? 0;
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

  return page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== new URL(baseURL).origin) {
      await route.abort('blockedbyclient');
      return;
    }

    if (requestUrl.pathname === '/api/auth/ok') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (requestUrl.pathname === '/api/auth/get-session') {
      if (sessionProbeFailures > 0) {
        sessionProbeFailures -= 1;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'auth_unavailable' }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authenticated ? session : null),
      });
      return;
    }
    if (requestUrl.pathname === '/api/auth/sign-in/email' && route.request().method() === 'POST') {
      authenticated = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (requestUrl.pathname.startsWith('/api/auth/')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.continue();
  });
}

async function completeSyntheticLogin(page: import('@playwright/test').Page) {
  await page.getByLabel('アカウントを入力').fill('proof@example.test');
  await page.getByLabel('パスワードを入力する').fill('local-only-password');
  await page.getByRole('button', { name: 'ログイン' }).click();
}

test('unauthenticated protected route returns to its original path, query, and fragment after login', async ({ page }) => {
  await installLocalAuthStub(page);
  await page.goto('/model?mode=multi#history');

  await expect(page).toHaveURL(/\/login\?redirect=/);
  await completeSyntheticLogin(page);
  await expect(page).toHaveURL(`${new URL(baseURL).origin}/model?mode=multi#history`);
});

test('one authenticated browser session survives protected route changes and a reload', async ({ page }) => {
  await installLocalAuthStub(page);
  await page.goto('/login');
  await completeSyntheticLogin(page);

  await page.goto('/dashboard');
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'LIGHTCHAIN AI' })).toBeVisible();

  await page.reload();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'LIGHTCHAIN AI' })).toBeVisible();

  await page.goto('/flow/GenerateShortVideo');
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: '動画ワークステーション' })).toBeVisible();
});

test('a valid cookie session silently reconnects after a transient auth outage', async ({ page }) => {
  await installLocalAuthStub(page, { initialAuthenticated: true, sessionProbeFailures: 1 });
  await page.goto('/dashboard');

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByTestId('workspace-loading-fallback')).toHaveAttribute('data-loading-state', 'auth-service-unavailable');
  await expect(page.getByRole('heading', { name: 'LIGHTCHAIN AI' })).toBeVisible({ timeout: 12_000 });

  await page.goto('/gallery');
  await expect(page).not.toHaveURL(/\/login/);
});

test('one authenticated browser session stays admitted across the canonical workspace routes', async ({ page }) => {
  await installLocalAuthStub(page);
  await page.goto('/login');
  await completeSyntheticLogin(page);

  const routes = [
    '/designProduction',
    '/model',
    '/gallery',
    '/history',
    '/jobs',
    '/board',
    '/canvas/new',
    '/flow/GenerateShortVideo',
  ];

  for (const route of routes) {
    await page.goto(route);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await expect(page).not.toHaveURL(/\/auth\/callback/);
    await page.reload();
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await expect(page).not.toHaveURL(/\/auth\/callback/);
  }
});

test('login rejects an external redirect and uses the canonical Heavy workspace', async ({ page }) => {
  await installLocalAuthStub(page);
  await page.goto('/login?redirect=https%3A%2F%2Fevil.invalid%2Fsteal');

  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  await completeSyntheticLogin(page);
  await expect(page).toHaveURL(`${new URL(baseURL).origin}/designProduction`);
});

test('public login remains usable when session hydration is slow', async ({ page }) => {
  await page.route('**/api/auth/get-session', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
  });
  await page.route('**/api/auth/ok', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/login');

  // The browser auth adapter performs one bounded same-cookie re-read after
  // an empty session. Keep the login form behind that hydration boundary so a
  // slow but valid source-style session never looks like a per-screen logout.
  await expect(page.getByTestId('workspace-loading-fallback')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible({ timeout: 35_000 });
  await expect(page.getByLabel('アカウントを入力')).toBeVisible();
});
