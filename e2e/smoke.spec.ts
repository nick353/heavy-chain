import { expect, test, type Page } from '@playwright/test';

const mockUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'tester@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: { name: 'Test User' },
  created_at: '2026-06-18T00:00:00.000Z',
};

const mockBrand = {
  id: '00000000-0000-4000-8000-000000000002',
  owner_id: mockUser.id,
  name: 'Smoke Test Brand',
  logo_url: null,
  brand_colors: null,
  tone_description: null,
  target_audience: null,
  created_at: '2026-06-18T00:00:00.000Z',
  updated_at: '2026-06-18T00:00:00.000Z',
};

const authToken = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_at: 4102444800,
  expires_in: 3600,
  token_type: 'bearer',
  user: mockUser,
};

const configuredProjectRef = process.env.VITE_SUPABASE_URL?.match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1];
const authStorageKeys = Array.from(new Set([
  'ghwjymozrwmcrpjqvbmo',
  'jprhgmxszvtomrqnolxn',
  configuredProjectRef,
].filter(Boolean).map((projectRef) => `sb-${projectRef}-auth-token`)));

async function mockSupabase(page: Page, options: {
  optimizePromptSucceeds?: boolean;
  generationFails?: boolean;
} = {}) {
  await page.addInitScript(({ keys, token }) => {
    keys.forEach((key) => localStorage.setItem(key, JSON.stringify(token)));
  }, { keys: authStorageKeys, token: authToken });

  await page.route('**/auth/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: mockUser }) });
  });

  await page.route('**/rest/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    let body: unknown = [];

    if (pathname.endsWith('/rest/v1/rpc/get_brand_usage_summary')) {
      body = {
        plan_code: 'free',
        monthly_quota: 25,
        used_units: 0,
        reserved_units: 0,
        remaining_units: 25,
      };
    } else if (pathname.endsWith('/rest/v1/users')) {
      body = { ...mockUser, name: 'Test User', avatar_url: null, language: 'ja', is_admin: false };
    } else if (pathname.endsWith('/rest/v1/brands')) {
      body = [mockBrand];
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route('**/functions/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());

    if (pathname === '/functions/v1/optimize-prompt') {
      if (options.optimizePromptSucceeds) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            optimized_prompt: 'Premium studio product photo of a white cotton T-shirt on a model',
            negative_prompt: 'blurry, low quality',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'テスト用の最適化失敗' }),
      });
      return;
    }

    if (options.generationFails) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'テスト用の生成失敗' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ images: [] }),
    });
  });
}

async function selectFeature(page: Page, featureId: string) {
  const featureCard = page.getByTestId(`feature-card-${featureId}`);
  await featureCard.scrollIntoViewIfNeeded();
  await featureCard.click();
}

test('landing shell renders with mocked Supabase requests', async ({ page }) => {
  await mockSupabase(page);

  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('#root')).not.toBeEmpty();
});

test.describe('static legal pages', () => {
  test('terms page renders', async ({ page }) => {
    await mockSupabase(page);

    await page.goto('/terms');

    await expect(page.getByRole('heading', { name: '利用規約' })).toBeVisible();
    await expect(page.getByText('サービスの利用')).toBeVisible();
    await expect(page.getByText('生成物と責任')).toBeVisible();
  });

  test('privacy page renders', async ({ page }) => {
    await mockSupabase(page);

    await page.goto('/privacy');

    await expect(page.getByRole('heading', { name: 'プライバシーポリシー' })).toBeVisible();
    await expect(page.getByText('取得する情報')).toBeVisible();
    await expect(page.getByText('秘密情報の扱い')).toBeVisible();
  });

  test('legal page renders', async ({ page }) => {
    await mockSupabase(page);

    await page.goto('/legal');

    await expect(page.getByRole('heading', { name: '特商法表記' })).toBeVisible();
    await expect(page.getByText('提供サービス')).toBeVisible();
    await expect(page.getByRole('heading', { name: '問い合わせ' })).toBeVisible();
  });
});

test('optimize-prompt success renders the result panel', async ({ page }) => {
  await mockSupabase(page, { optimizePromptSucceeds: true });

  await page.goto('/generate');
  await selectFeature(page, 'optimize-prompt');
  await page.getByPlaceholder('例: 白いTシャツを着たモデル、スタジオ撮影').fill('白いTシャツを着たモデル、スタジオ撮影');
  await page.getByRole('button', { name: '最適化' }).click();

  await expect(page.getByRole('heading', { name: 'プロンプトを最適化しました' })).toBeVisible();
  const resultPanel = page.locator('.glass-panel').filter({
    has: page.getByRole('heading', { name: 'プロンプトを最適化しました' }),
  });
  await expect(resultPanel.locator('p.whitespace-pre-wrap').filter({
    hasText: 'Premium studio product photo of a white cotton T-shirt on a model',
  })).toBeVisible();
  await expect(page.getByText('避ける要素')).toBeVisible();
  await expect(page.getByText('blurry, low quality')).toBeVisible();
});

test('generation failure renders the error card', async ({ page }) => {
  await mockSupabase(page, { generationFails: true });

  await page.goto('/generate');
  await selectFeature(page, 'campaign-image');
  await page.getByPlaceholder('例: 夏のサマーセール告知、爽やかな海辺の雰囲気').fill('夏のサマーセール告知');
  await page.getByRole('button', { name: '生成' }).click();

  await expect(page.getByRole('heading', { name: '生成に失敗しました' })).toBeVisible();
  await expect(page.getByText('入力内容を確認し、少し待ってからもう一度試してください。')).toBeVisible();
});
