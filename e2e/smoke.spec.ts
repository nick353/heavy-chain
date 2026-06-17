import { expect, test } from '@playwright/test';

test('landing shell renders with mocked Supabase requests', async ({ page }) => {
  await page.route('**/auth/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/rest/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('#root')).not.toBeEmpty();
});
