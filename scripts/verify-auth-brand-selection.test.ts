import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { Brand } from '../src/types/database';
import {
  assertAuthBrandFence,
  beginAuthBrandSelection,
  captureAuthBrandFence,
  failAuthBrandSelection,
  INITIAL_AUTH_BRAND_SELECTION_STATE,
  isAuthBrandFenceValid,
  resolveAuthBrandSelection,
  selectCurrentBrand,
} from '../src/lib/authBrandSelection.ts';

const brand = (id: string, name = id): Brand => ({
  id,
  owner_id: 'owner-1',
  name,
  logo_url: null,
  brand_colors: null,
  tone_description: null,
  target_audience: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

test('empty confirmation is fail-closed and never preserves an unconfirmed selection', () => {
  const selected = brand('brand-1', 'NiSEN');
  assert.equal(selectCurrentBrand(selected, []), null);
});

test('keeps the selected brand when it remains accessible', () => {
  const selected = brand('brand-1', 'NiSEN');
  assert.equal(selectCurrentBrand(selected, [brand('brand-2'), selected]), selected);
});

test('moves to the first accessible brand after a non-empty membership refresh', () => {
  const selected = brand('brand-1', 'Old');
  const next = brand('brand-2', 'New');
  assert.equal(selectCurrentBrand(selected, [next]), next);
});

test('returns null when no brand has ever been selected and none is accessible', () => {
  assert.equal(selectCurrentBrand(null, []), null);
});

test('brand resolution state carries user, generation, and confirmed IDs', () => {
  const pending = beginAuthBrandSelection(INITIAL_AUTH_BRAND_SELECTION_STATE, 'user-1');
  assert.deepEqual(pending, {
    status: 'pending',
    userId: 'user-1',
    requestGeneration: 1,
    confirmedBrandIds: [],
    error: null,
  });
  const resolved = resolveAuthBrandSelection(pending, 'user-1', pending.requestGeneration, [brand('brand-1')]);
  assert.equal(resolved.status, 'success_nonempty');
  assert.deepEqual(resolved.confirmedBrandIds, ['brand-1']);
  const empty = resolveAuthBrandSelection(resolved, 'user-1', resolved.requestGeneration, []);
  assert.equal(empty.status, 'success_empty');
  assert.deepEqual(empty.confirmedBrandIds, []);
  const failed = failAuthBrandSelection(empty, 'user-1', empty.requestGeneration, new Error('denied'));
  assert.equal(failed.status, 'failure');
  assert.deepEqual(failed.confirmedBrandIds, []);
});

test('stale brand responses cannot win a deterministic refresh race', () => {
  const first = beginAuthBrandSelection(INITIAL_AUTH_BRAND_SELECTION_STATE, 'user-1');
  const second = beginAuthBrandSelection(first, 'user-1');
  const stale = resolveAuthBrandSelection(first, 'user-1', first.requestGeneration, [brand('old')]);
  assert.equal(stale.status, 'success_nonempty');
  const stillPending = resolveAuthBrandSelection(second, 'user-1', first.requestGeneration, [brand('old')]);
  assert.equal(stillPending.status, 'pending');
  assert.equal(stillPending.requestGeneration, second.requestGeneration);
  const winner = resolveAuthBrandSelection(second, 'user-1', second.requestGeneration, [brand('new')]);
  assert.deepEqual(winner.confirmedBrandIds, ['new']);
});

test('only a confirmed current-user brand can cross the access fence', () => {
  const pending = beginAuthBrandSelection(INITIAL_AUTH_BRAND_SELECTION_STATE, 'user-1');
  const resolved = resolveAuthBrandSelection(pending, 'user-1', pending.requestGeneration, [brand('brand-1')]);
  const captured = captureAuthBrandFence(resolved, 'user-1', 'brand-1');
  assert.ok(captured);
  assert.equal(captureAuthBrandFence(resolved, 'user-2', 'brand-1'), null);
  assert.equal(isAuthBrandFenceValid(captured, captured), true);
  const revoked = beginAuthBrandSelection(resolved, 'user-1');
  assert.equal(isAuthBrandFenceValid(captured, captureAuthBrandFence(revoked, 'user-1', 'brand-1')), false);
  const changedAllowlist = resolveAuthBrandSelection(
    resolved,
    'user-1',
    resolved.requestGeneration,
    [brand('brand-2')],
  );
  assert.equal(captureAuthBrandFence(changedAllowlist, 'user-1', 'brand-1'), null);
  assert.equal(isAuthBrandFenceValid(captured, captureAuthBrandFence(changedAllowlist, 'user-1', 'brand-2')), false);
  assert.throws(
    () => assertAuthBrandFence(captured, null, 'after-await'),
    /auth_brand_access_fence_revoked:after-await/,
  );
});

test('Fitting model-matrix generation fences provider and result commits', async () => {
  const source = await readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /type AuthBrandFenceSnapshot/);
  assert.match(source, /const state = useAuthStore\.getState\(\);[\s\S]*captureAuthBrandFence\(state\.brandState, state\.user\?\.id \?\? null, state\.currentBrand\?\.id \?\? null\)/);

  const runStart = source.indexOf('const runGeneration = async');
  const runEnd = source.indexOf('const handleGenerate = async', runStart);
  assert.ok(runStart >= 0 && runEnd > runStart);
  const runSource = source.slice(runStart, runEnd);

  const capture = runSource.indexOf('const authBrandFence = captureCurrentAuthBrandFence()');
  const beforeProvider = runSource.indexOf("assertCurrentAuthBrandFence(authBrandFence, 'before_provider')");
  const provider = runSource.indexOf('generateModelMatrix(');
  const afterProvider = runSource.indexOf("assertCurrentAuthBrandFence(authBrandFence, 'after_provider')");
  const setGeneratingFalse = runSource.indexOf('setIsGenerating(false)', afterProvider);
  const resultValidation = runSource.indexOf('assertCompletedModelMatrixResult(response', afterProvider);
  const beforePersistence = runSource.indexOf("assertCurrentAuthBrandFence(authBrandFence, 'before_persistence')");
  const persistence = runSource.indexOf('saveWorkspaceArtifactPersisted({');
  const beforeUiCommit = runSource.indexOf("assertCurrentAuthBrandFence(authBrandFence, 'before_ui_commit')");
  const resultCommit = runSource.indexOf('setResultMatrix(matrix)');

  assert.ok(capture >= 0);
  assert.ok(capture < beforeProvider && beforeProvider < provider);
  assert.ok(provider < afterProvider);
  assert.ok(afterProvider < setGeneratingFalse);
  assert.ok(afterProvider < resultValidation);
  assert.ok(beforePersistence < persistence);
  assert.ok(beforeUiCommit < resultCommit);
  assert.equal(runSource.slice(0, beforeUiCommit).includes('setResultMatrix(matrix)'), false);
  assert.match(runSource, /const generationBrandId = authBrandFence\.brandId/);
  assert.match(runSource, /generateModelMatrix\(request\.productDescription, generationBrandId,/);
  assert.match(runSource, /brandId: generationBrandId/);
  assert.doesNotMatch(runSource, /generateModelMatrix\(request\.productDescription, currentBrand\.id,/);
});

test('LightchainWorkbench provider paths bind provider and persistence to the captured brand fence', async () => {
  const source = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const printingStart = source.indexOf('const handlePrintingImageGenerate = async');
  const printingEnd = source.indexOf('const handleMaterialSlotUpload = async', printingStart);
  const genericStart = source.indexOf('const handleLightchainPreviewGenerate = async');
  const genericEnd = source.indexOf('const handleWorkspaceStyleGenerate = async', genericStart);
  assert.ok(printingStart >= 0 && printingEnd > printingStart);
  assert.ok(genericStart >= 0 && genericEnd > genericStart);

  const providerSources = [source.slice(printingStart, printingEnd), source.slice(genericStart, genericEnd)];
  for (const runSource of providerSources) {
    assert.match(runSource, /(?:const|let) authBrandFence = captureCurrentAuthBrandFence\(generationBrand\.id\)/);
    assert.match(runSource, /const generationBrandId = authBrandFence\.brandId/);
    assert.match(runSource, /assertCurrentAuthBrandFence\(authBrandFence, '[^']+before_provider/);
    assert.match(runSource, /assertCurrentAuthBrandFence\(authBrandFence, '[^']+after_provider/);
    assert.match(runSource, /brandId: generationBrandId/);
    assert.doesNotMatch(runSource, /(?:generateModelMatrix|editImageWithPrompt|generateImage)\([\s\S]*?generationBrand\.id/);
    assert.doesNotMatch(runSource, /persistProviderResultArtifact\([\s\S]*?brandId: generationBrand\.id/);
  }
});

test('UI entrypoints use authStore authority instead of direct brand reads', async () => {
  const [dashboard, switcher, workbench] = await Promise.all([
    readFile(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/BrandSwitcher.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8'),
  ]);
  for (const source of [dashboard, switcher, workbench]) {
    assert.doesNotMatch(source, /fetchAccessibleBrandsForCurrentUser/);
  }
  assert.match(dashboard, /refreshCurrentBrand\(\)/);
  assert.match(switcher, /refreshCurrentBrand\(\)/);
  assert.match(workbench, /useAuthStore\.getState\(\)\.refreshCurrentBrand\(\)/);
});

test('BrandSwitcher uses the confirmed store selection boundary', async () => {
  const source = await readFile(new URL('../src/components/BrandSwitcher.tsx', import.meta.url), 'utf8');
  assert.match(source, /brandState\.status === 'success_nonempty'/);
  assert.match(source, /setCurrentBrand\(brand\)/);
});

test('sign-out revokes brand authority before awaiting the auth provider', async () => {
  const source = await readFile(new URL('../src/stores/authStore.ts', import.meta.url), 'utf8');
  const signOutStart = source.indexOf('signOut: async () => {');
  const signOutEnd = source.indexOf('\n  },', signOutStart);
  assert.ok(signOutStart >= 0 && signOutEnd > signOutStart);
  const signOutSource = source.slice(signOutStart, signOutEnd);
  assert.ok(signOutSource.indexOf('clearBrandAuthority(null)') < signOutSource.indexOf('auth.signOut()'));
});

test('brand creation confirms and selects the created ID from the refreshed allowlist', async () => {
  const source = await readFile(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const createdBrand = await cloudflareDataPlane\.createBrand\(/);
  assert.match(source, /state\.accessibleBrands\.find\(\(brand\) => brand\.id === createdBrand\.id\)/);
  assert.match(source, /setCurrentBrand\(confirmedCreatedBrand\)/);
});

test('brand refresh preserves only a previously confirmed selection', async () => {
  const source = await readFile(new URL('../src/stores/authStore.ts', import.meta.url), 'utf8');
  assert.match(source, /const previousState = get\(\);/);
  assert.match(source, /canSelectConfirmedBrand\(\s*previousState\.brandState/);
  assert.match(source, /const currentBrand = selectCurrentBrand\(previousBrand, brands\)/);
  assert.doesNotMatch(source, /selectCurrentBrand\(state\.currentBrand, brands\)/);
});

test('BrandSettingsPage distinguishes pending, failure, empty, and nonempty brand states', async () => {
  const source = await readFile(new URL('../src/pages/BrandSettingsPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /brandState\.status === 'pending'/);
  assert.match(source, /brandState\.status === 'failure'/);
  assert.match(source, /brandState\.status === 'success_empty'/);
  assert.match(source, /if \(currentBrand\) \{/);

  const noBrandSource = source.slice(source.indexOf('const isEmptyBrandState'));
  assert.match(noBrandSource, /brandState\.status === 'pending'[\s\S]*?ブランド情報を確認中です/);
  assert.match(noBrandSource, /brandState\.status === 'failure'[\s\S]*?ブランド情報を取得できませんでした/);
  assert.match(noBrandSource, /brandState\.status === 'failure'[\s\S]*?再試行/);
  assert.match(noBrandSource, /ブランドを設定してください/);
  assert.match(source, /const isEmptyBrandState = brandState\.status === 'success_empty'/);
  assert.match(source, /if \(!currentBrand && !isEmptyBrandState\)/);
  assert.match(source, /if \(!currentBrand\) \{/);
});

test('BrandSettingsPage retry is single-flight and reflects the refresh result', async () => {
  const source = await readFile(new URL('../src/pages/BrandSettingsPage.tsx', import.meta.url), 'utf8');
  const retryStart = source.indexOf('const handleRetryBrand = useCallback');
  const retryEnd = source.indexOf('\n\n  if (!currentBrand)', retryStart);
  assert.ok(retryStart >= 0 && retryEnd > retryStart);
  const retrySource = source.slice(retryStart, retryEnd);
  assert.match(retrySource, /if \(brandRetryInFlightRef\.current\) return;/);
  assert.match(retrySource, /brandRetryInFlightRef\.current = true;/);
  assert.match(retrySource, /await refreshCurrentBrand\(\)/);
  assert.match(retrySource, /brandRetryInFlightRef\.current = false;/);
  assert.match(source, /onClick=\{\(\) => void handleRetryBrand\(\)\} disabled=\{isRetryingBrand\} isLoading=\{isRetryingBrand\}/);
});
