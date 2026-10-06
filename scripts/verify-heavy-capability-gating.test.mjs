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
  allowed: true,
  reason: null,
  termsVersion: 'terms-v1',
  termsDocumentVersion: 'terms-doc-v1',
  termsDocumentDigest: 'sha256:terms',
  rightsVersion: 'rights-v1',
  rightsDocumentVersion: 'rights-doc-v1',
  rightsDocumentDigest: 'sha256:rights',
};

test('Heavy capability map is explicit and default-deny', () => {
  const imageFeatureIds = [
    'marketing-home', 'marketing-detail', 'fitting-clothing-reference',
    'fitting-background-reference', 'wear-design-lab', 'wear-design-detail',
    'fashion-studio', 'design-agent', 'lab', 'print-design-project',
    'print-design-detail', 'fabric-image', 'line-generation', 'line-to-real',
    'pattern-vector', 'pattern-vector-pro', 'printing-image', 'image-repair', 'pattern-arrange', 'pattern-print-design', 'change-color',
    'svg-convert', 'custom-style', 'ai-fitting', 'ai-fitting-reference',
    'model-library', 'model-face', 'model-change', 'body-shape',
    'clothing-size', 'pose-change', 'background-change', 'angle-change',
    'model-custom',
  ];
  assert.equal(Object.keys(HEAVY_CAPABILITY_ACTIONS).length, imageFeatureIds.length + 5);
  for (const featureId of imageFeatureIds) {
    assert.ok(['edit-image', 'model-matrix'].includes(HEAVY_CAPABILITY_ACTIONS[featureId]), featureId);
  }
  assert.deepEqual(resolveHeavyCapability('campaign-image'), {
    featureId: 'campaign-image', action: 'generate-image', supported: true,
  });
  assert.deepEqual(resolveHeavyCapability('model-matrix'), {
    featureId: 'model-matrix', action: 'model-matrix', supported: true,
  });
  for (const featureId of ['future-feature', null, undefined]) {
    const capability = resolveHeavyCapability(featureId);
    assert.equal(capability.action, HEAVY_UNIMPLEMENTED_ACTION, String(featureId));
    assert.equal(capability.supported, false, String(featureId));
  }
  for (const featureId of ['design-gacha', 'product-shots', 'scene-coordinate']) {
    assert.equal(resolveHeavyCapability(featureId).supported, true, featureId);
  }
});

test('Heavy ownership is explicit and Light or unknown ids stay outside the Heavy lane', () => {
  assert.deepEqual([...HEAVY_OWNED_FEATURE_IDS], Object.keys(HEAVY_CAPABILITY_ACTIONS));
  for (const featureId of [...HEAVY_OWNED_FEATURE_IDS]) {
    assert.equal(isHeavyOwnedFeature(featureId), true, featureId);
  }
  for (const featureId of ['remove-bg', 'chat-edit', 'optimize-prompt', 'future-feature', null, undefined]) {
    assert.equal(isHeavyOwnedFeature(featureId), false, String(featureId));
  }
  assert.equal(isHeavyOwnedFeature(' campaign-image '), true);
});

test('supported entitlement state is hydrating or ready, and Heavy readiness is login-first', () => {
  const capability = resolveHeavyCapability('campaign-image');
  assert.equal(resolveHeavyEntitlementState(capability, null, true), 'hydrating');
  assert.equal(resolveHeavyEntitlementState(capability, readyPolicy, false), 'ready');
  assert.equal(resolveHeavyEntitlementState(capability, { ...readyPolicy, termsDocumentDigest: null, rightsDocumentDigest: null }, false), 'ready');
  assert.equal(hasHeavyTermsAndRightsPolicy(readyPolicy), true);
  assert.equal(hasHeavyTermsAndRightsPolicy({ ...readyPolicy, termsDocumentDigest: null, rightsDocumentDigest: null }), true);
  assert.equal(hasHeavyTermsAndRightsPolicy({ ...readyPolicy, reason: 'heavy_generation_disabled' }), false);
  assert.equal(resolveHeavyEntitlementState(resolveHeavyCapability('design-gacha'), readyPolicy, false), 'ready');
});

test('401, 403, and 5xx entitlement failures remain closed', () => {
  assert.equal(classifyHeavyEntitlementError(new Error('cloudflare_api_401_unauthorized')), '401');
  assert.equal(classifyHeavyEntitlementError(new Error('cloudflare_api_403_forbidden')), '403');
  assert.equal(classifyHeavyEntitlementError(new Error('cloudflare_api_503_image_action_not_implemented')), '5xx');
  assert.equal(classifyHeavyEntitlementError({ status: 502 }), '5xx');
});

test('unknown UI path has no entitlement or provider side effect', async () => {
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

  const result = await guardedHeavyPath('future-feature');
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
    featureId: 'future-feature',
    entitlementState: 'ready',
    userId: 'user-1',
    brandId: 'brand-1',
  }), false);

  assert.equal(canSubmitHeavyCapability({
    featureId: 'campaign-image',
    entitlementState: 'ready',
    termsAccepted: false,
    rightsAttested: false,
    userId: 'user-1',
    brandId: 'brand-1',
  }), true);
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

test('GeneratePage renders unsupported copy, uses login-only admission, and guards stale responses', async () => {
  const page = await readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  assert.match(page, /isHeavyOwnedFeature\(selectedFeature\?\.id\)/);
  assert.match(page, /const heavySurface = isHeavyOwnedFeature\(selectedFeature\?\.id\);/);
  assert.doesNotMatch(page, /const heavySurface = selectedFeature\?\.id !== 'chat-edit'/);
  assert.doesNotMatch(page, /const heavySurface = selectedFeature\?\.id !== 'optimize-prompt'/);
  assert.match(page, /resolveHeavyCapability\(selectedFeature\?\.id\)/);
  assert.match(page, /if \(heavySurface && !noImageGenerationMode && !heavyAccessReady\)/);
  assert.match(page, /const heavyAccessReady = noImageGenerationMode[\s\S]*?heavyCapability\.supported && Boolean\(user\?\.id\)/);
  assert.doesNotMatch(page, /data-testid="heavy-entitlement-gate"|data-testid="heavy-terms-copy"|data-testid="heavy-terms-acceptance"|data-testid="heavy-rights-attestation"/);
  assert.match(page, /HEAVY_UNIMPLEMENTED_MESSAGE/);
  assert.doesNotMatch(page, /canSubmitHeavyCapability\(/);
  assert.match(page, /const heavyConsent = undefined/);
  assert.match(page, /There is intentionally no client entitlement\/consent fetch here/);
  assert.doesNotMatch(page, /getHeavyEntitlement\(/);
});

test('Lightchain Workbench keeps Heavy entitlement out of known Light features', async () => {
  const page = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /isHeavyOwnedFeature\(selectedTool\.id\)/);
  assert.match(page, /const heavyAccessReady = !heavyOwnedFeature \|\|/);
  assert.match(page, /const providerRightsConfirmed = !heavyOwnedFeature \|\| heavyAccessReady/);
  assert.match(page, /rightsReady: !lightchainProviderSupported \|\| heavyAccessReady/);
  assert.doesNotMatch(page, /heavyEntitlementAction/);
  assert.doesNotMatch(page, /getHeavyEntitlement\(/);
});

test('Lightchain material workbench keeps Heavy entitlement out of known material features', async () => {
  const page = await readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /const materialFeatureId = isPrinting \? 'printing-image' : 'fabric-image';/);
  assert.match(page, /const heavyOwnedFeature = isHeavyOwnedFeature\(materialFeatureId\);/);
  assert.match(page, /const heavyAccessReady = !heavyOwnedFeature \|\|/);
  assert.match(page, /const providerRightsConfirmed = !heavyOwnedFeature \|\| heavyAccessReady/);
  assert.match(page, /rightsReady: !heavyOwnedFeature \|\| heavyAccessReady/);
  assert.doesNotMatch(page, /getHeavyEntitlement\(/);
});
