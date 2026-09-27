import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  HEAVY_CAPABILITY_ACTIONS,
  HEAVY_OWNED_FEATURE_IDS,
  HEAVY_UNIMPLEMENTED_ACTION,
  canSubmitHeavyCapability,
  classifyHeavyEntitlementError,
  hasHeavyTermsAndRightsPolicy,
  isHeavyOwnedFeature,
  resolveHeavyCapability,
  resolveHeavyEntitlementState,
} from '../src/lib/heavyCapability.ts';

const readyPolicy = {
  allowed: false,
  reason: 'terms_acceptance_required',
  termsVersion: 'terms-v1',
  termsDocumentVersion: 'terms-doc-v1',
  termsDocumentDigest: 'sha256:terms',
  rightsVersion: 'rights-v1',
  rightsDocumentVersion: 'rights-doc-v1',
  rightsDocumentDigest: 'sha256:rights',
};

test('Heavy capability map is explicit and default-deny', () => {
  assert.deepEqual(HEAVY_CAPABILITY_ACTIONS, {
    'campaign-image': 'generate-image',
    'model-matrix': 'model-matrix',
    'design-gacha': HEAVY_UNIMPLEMENTED_ACTION,
    'product-shots': HEAVY_UNIMPLEMENTED_ACTION,
    'scene-coordinate': HEAVY_UNIMPLEMENTED_ACTION,
  });
  assert.deepEqual(resolveHeavyCapability('campaign-image'), {
    featureId: 'campaign-image', action: 'generate-image', supported: true,
  });
  assert.deepEqual(resolveHeavyCapability('model-matrix'), {
    featureId: 'model-matrix', action: 'model-matrix', supported: true,
  });
  for (const featureId of ['design-gacha', 'product-shots', 'scene-coordinate', 'future-feature', null, undefined]) {
    const capability = resolveHeavyCapability(featureId);
    assert.equal(capability.action, HEAVY_UNIMPLEMENTED_ACTION, String(featureId));
    assert.equal(capability.supported, false, String(featureId));
  }
});

test('Heavy ownership is explicit and Light or unknown ids stay outside the Heavy lane', () => {
  assert.deepEqual([...HEAVY_OWNED_FEATURE_IDS], [
    'campaign-image',
    'model-matrix',
    'design-gacha',
    'product-shots',
    'scene-coordinate',
  ]);
  for (const featureId of [...HEAVY_OWNED_FEATURE_IDS]) {
    assert.equal(isHeavyOwnedFeature(featureId), true, featureId);
  }
  for (const featureId of ['remove-bg', 'chat-edit', 'optimize-prompt', 'future-feature', null, undefined]) {
    assert.equal(isHeavyOwnedFeature(featureId), false, String(featureId));
  }
  assert.equal(isHeavyOwnedFeature(' campaign-image '), true);
});

test('supported entitlement state is hydrating or ready, and ready requires both policies', () => {
  const capability = resolveHeavyCapability('campaign-image');
  assert.equal(resolveHeavyEntitlementState(capability, null, true), 'hydrating');
  assert.equal(resolveHeavyEntitlementState(capability, readyPolicy, false), 'ready');
  assert.equal(resolveHeavyEntitlementState(capability, { ...readyPolicy, rightsDocumentDigest: null }, false), '5xx');
  assert.equal(hasHeavyTermsAndRightsPolicy(readyPolicy), true);
  assert.equal(hasHeavyTermsAndRightsPolicy({ ...readyPolicy, rightsDocumentDigest: null }), false);
  assert.equal(hasHeavyTermsAndRightsPolicy({ ...readyPolicy, reason: 'heavy_generation_disabled' }), false);
  assert.equal(resolveHeavyEntitlementState(resolveHeavyCapability('design-gacha'), readyPolicy, false), 'unsupported');
});

test('401, 403, and 5xx entitlement failures remain closed', () => {
  assert.equal(classifyHeavyEntitlementError(new Error('cloudflare_api_401_unauthorized')), '401');
  assert.equal(classifyHeavyEntitlementError(new Error('cloudflare_api_403_forbidden')), '403');
  assert.equal(classifyHeavyEntitlementError(new Error('cloudflare_api_503_image_action_not_implemented')), '5xx');
  assert.equal(classifyHeavyEntitlementError({ status: 502 }), '5xx');
});

test('unsupported UI path has no entitlement or provider side effect', async () => {
  let entitlementCalls = 0;
  let providerActionCalls = 0;
  const guardedHeavyPath = async (featureId) => {
    if (!isHeavyOwnedFeature(featureId)) return { skipped: true, action: HEAVY_UNIMPLEMENTED_ACTION };
    const capability = resolveHeavyCapability(featureId);
    if (!capability.supported) return { skipped: true, action: capability.action };
    entitlementCalls += 1;
    providerActionCalls += 1;
    return { skipped: false, action: capability.action };
  };

  const result = await guardedHeavyPath('design-gacha');
  assert.deepEqual(result, { skipped: true, action: HEAVY_UNIMPLEMENTED_ACTION });
  assert.equal(entitlementCalls, 0);
  assert.equal(providerActionCalls, 0);

  for (const featureId of ['remove-bg', 'chat-edit', 'optimize-prompt', 'future-feature']) {
    assert.deepEqual(await guardedHeavyPath(featureId), {
      skipped: true,
      action: HEAVY_UNIMPLEMENTED_ACTION,
    }, featureId);
  }
  assert.equal(entitlementCalls, 0);
  assert.equal(providerActionCalls, 0);

  assert.equal(canSubmitHeavyCapability({
    featureId: 'design-gacha',
    entitlementState: 'ready',
    termsAccepted: true,
    rightsAttested: true,
    userId: 'user-1',
    brandId: 'brand-1',
  }), false);
});

test('direct unsupported HTTP 503 is classified without a provider call', async () => {
  let requestSpyCalls = 0;
  let providerSpyCalls = 0;
  const directUnsupportedHttp = async (_url, _init) => {
    requestSpyCalls += 1;
    return new Response(
      JSON.stringify({ error: 'image_action_not_implemented' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  };

  const response = await directUnsupportedHttp('/v1/provider-actions/design-gacha', { method: 'POST' });
  assert.equal(response.status, 503);
  assert.equal(classifyHeavyEntitlementError(new Error('cloudflare_api_503_image_action_not_implemented')), '5xx');
  assert.equal(requestSpyCalls, 1);
  assert.equal(providerSpyCalls, 0);
});

test('GeneratePage renders unsupported copy, hydrates only supported capabilities, and guards stale responses', async () => {
  const page = await readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  assert.match(page, /isHeavyOwnedFeature\(selectedFeature\?\.id\)/);
  assert.match(page, /const heavySurface = isHeavyOwnedFeature\(selectedFeature\?\.id\);/);
  assert.doesNotMatch(page, /const heavySurface = selectedFeature\?\.id !== 'chat-edit'/);
  assert.doesNotMatch(page, /const heavySurface = selectedFeature\?\.id !== 'optimize-prompt'/);
  assert.match(page, /resolveHeavyCapability\(selectedFeature\?\.id\)/);
  assert.match(page, /if \(noImageGenerationMode \|\| !heavySurface \|\| !heavyCapabilitySupported\)/);
  assert.match(page, /heavyEntitlementState === 'ready' && heavyPolicyConfigured/);
  assert.match(page, /HEAVY_UNIMPLEMENTED_MESSAGE/);
  assert.match(page, /canSubmitHeavyCapability\(/);
  assert.match(page, /const requestIdentity = heavyEntitlementContextRef\.current/);
  assert.match(page, /!cancelled/);
  assert.match(page, /heavyEntitlementRequestRef\.current === requestId/);
  assert.match(page, /user\?\.id === requestIdentity\.userId/);
  assert.match(page, /currentBrand\?\.id === requestIdentity\.brandId/);
  assert.match(page, /selectedFeatureId === requestIdentity\.featureId/);
  assert.match(page, /heavyEntitlementAction === requestIdentity\.action/);
  assert.match(page, /const heavyConsent = noImageGenerationMode \|\| !heavySurface \? undefined : \{/);

  const effectStart = page.indexOf('useEffect(() => {', page.indexOf('heavyEntitlementContextRef'));
  const unsupportedGuard = page.indexOf('if (noImageGenerationMode || !heavySurface || !heavyCapabilitySupported)', effectStart);
  const authGuard = page.indexOf('if (!userId || !brandId)', effectStart);
  const dataPlaneGuard = page.indexOf('if (!cloudflareDataPlane)', effectStart);
  const entitlementCall = page.indexOf('cloudflareDataPlane.getHeavyEntitlement(brandId, heavyEntitlementAction)', effectStart);
  assert.ok(effectStart >= 0, 'entitlement effect must exist');
  assert.ok(unsupportedGuard > effectStart, 'unsupported capability guard must be inside entitlement effect');
  assert.ok(unsupportedGuard < authGuard, 'unsupported capability guard must precede auth hydration');
  assert.ok(authGuard < dataPlaneGuard, 'auth guard must precede data-plane access');
  assert.ok(dataPlaneGuard < entitlementCall, 'data-plane guard must precede entitlement GET');
});

test('Lightchain Workbench keeps Heavy entitlement out of known Light features', async () => {
  const page = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /isHeavyOwnedFeature\(selectedTool\.id\)/);
  assert.match(page, /const heavyEntitlementAction = heavyOwnedFeature && lightchainProviderSupported/);
  assert.match(page, /const heavyEntitlementReady = !heavyOwnedFeature \|\|/);
  assert.match(page, /const providerRightsConfirmed = !heavyOwnedFeature \|\| heavyEntitlementReady/);
  assert.match(page, /rightsReady: !lightchainProviderSupported \|\| !heavyOwnedFeature \|\| heavyEntitlementReady/);
  assert.doesNotMatch(page, /const heavyEntitlementAction = lightchainProviderSupported\s*\n\s*\? lightchainProviderRoute/);
  assert.match(page, /cloudflareDataPlane\.getHeavyEntitlement\(brandId, heavyEntitlementAction\)/);
  assert.match(page, /if \(!brandId \|\| !heavyEntitlementAction\)/);
});

test('Lightchain material workbench keeps Heavy entitlement out of known material features', async () => {
  const page = await readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /const materialFeatureId = isPrinting \? 'printing-image' : 'fabric-image';/);
  assert.match(page, /const heavyOwnedFeature = isHeavyOwnedFeature\(materialFeatureId\);/);
  assert.match(page, /const heavyEntitlementReady = !heavyOwnedFeature \|\|/);
  assert.match(page, /const providerRightsConfirmed = !heavyOwnedFeature \|\| heavyEntitlementReady/);
  assert.match(page, /rightsReady: !heavyOwnedFeature \|\| heavyEntitlementReady/);

  const effectStart = page.indexOf('useEffect(() => {', page.indexOf('const heavyEntitlementReady'));
  const heavyGuard = page.indexOf('if (!heavyOwnedFeature || !brandId)', effectStart);
  const entitlementCall = page.indexOf("cloudflareDataPlane.getHeavyEntitlement(brandId, 'edit-image')", effectStart);
  assert.ok(effectStart >= 0, 'material entitlement effect must exist for future Heavy-owned branches');
  assert.ok(heavyGuard > effectStart, 'material effect must guard known Light features');
  assert.ok(heavyGuard < entitlementCall, 'Heavy entitlement GET must follow the ownership guard');
});
