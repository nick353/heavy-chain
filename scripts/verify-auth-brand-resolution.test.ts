import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const authStore = await readFile(new URL('../src/stores/authStore.ts', import.meta.url), 'utf8');
const workbench = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

test('owner brand resolution uses the current Cloudflare protected list contract', () => {
  assert.match(authStore, /const fetchAccessibleBrandsRequest = async \(userId: string\): Promise<Brand\[\]> =>/);
  assert.match(authStore, /if \(!cloudflareDataPlane\) throw new Error\('cloudflare_api_not_configured'\)/);
  assert.match(authStore, /return cloudflareDataPlane\.listBrands\(\)/);
  assert.match(authStore, /auth_brand_timeout/);
  assert.match(authStore, /failAuthBrandSelection/);
  assert.doesNotMatch(authStore, /BRAND_AUXILIARY_LOOKUP_TIMEOUT_MS|mergeAccessibleBrands|auth_brand_membership_timeout/);
});

test('brand resolution is visible, state-specific, and locks provider generation while unresolved', () => {
  assert.match(workbench, /data-testid="lightchain-brand-resolution-gate"/);
  assert.match(workbench, /const specialProviderGenerationLocked = !lightchainProviderSupported[\s\S]*workspaceStyle\?\.kind === 'agent' && !providerRightsConfirmed/);
  assert.match(workbench, /brandState\.status === 'pending'/);
  assert.match(workbench, /brandState\.status === 'success_empty'/);
  assert.match(workbench, /利用できるブランドがありません/);
  assert.match(workbench, /ブランド情報を取得できませんでした/);
  assert.match(workbench, /data-testid="lightchain-brand-refresh"/);
  assert.match(workbench, /data-testid="lightchain-brand-settings-link"/);
  assert.match(workbench, /const handleBrandRefresh = async/);
});

console.log('auth brand resolution tests: 2/2 passed');
