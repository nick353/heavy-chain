import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function fixture(t) {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: 'https://image-web.test' } };
  const vite = await createServer({
    configFile: false,
    envFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
    define: {
      'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"',
      'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://image-api.test"',
    },
  });
  const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
  const { cloudflareDataPlane: api } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
  const image = await vite.ssrLoadModule('/src/lib/imageApi.ts');
  t.after(async () => {
    auth.dispose();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    await vite.close();
  });
  return { api, image };
}

test('generateImage forwards the three run controls outside the provider body', async (t) => {
  const { api, image } = await fixture(t);
  const calls = [];
  api.invokeProviderAction = async (...args) => {
    calls.push(args);
    return {
      success: true,
      requestId: 'request-one',
      state: 'completed',
      status: 'completed',
      persistenceStatus: 'completed',
      images: [{ imageUrl: 'https://media.example/image.png', imageId: 'image-one', jobId: 'job-one', storagePath: 'generated-images/image-one' }],
    };
  };

  const assertContext = async () => {};
  const heavyPreparation = { preparationId: 'prep-one' };
  const heavyConsent = { termsAccepted: true, rightsAttested: true };
  const result = await image.generateImage(' exact prompt ', 'brand-one', {
    providerAction: 'edit-image',
    generationProvider: 'openai',
    imageUrls: ['reference-one', 'reference-two'],
    generationModel: 'model-one',
    featureType: 'design-detail',
    rightsConfirmed: true,
    idempotencyKey: 'same-request-id',
    assertContext,
    retainUntilAcknowledged: true,
    heavyPreparation,
    heavyConsent,
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  const [action, body, options] = calls[0];
  assert.equal(action, 'edit-image');
  assert.deepEqual(body, {
    prompt: ' exact prompt ',
    brandId: 'brand-one',
    providerAction: 'edit-image',
    generationProvider: 'openai',
    imageUrls: ['reference-one', 'reference-two'],
    generationModel: 'model-one',
    featureType: 'design-detail',
    rightsConfirmed: true,
    heavyPreparation,
    heavyConsent,
    legalSafety: { rightsConfirmed: true },
  });
  assert.deepEqual(options, {
    heavyPreparation,
    heavyConsent,
    idempotencyKey: 'same-request-id',
    assertContext,
    retainUntilAcknowledged: true,
  });
  for (const control of ['idempotencyKey', 'assertContext', 'retainUntilAcknowledged']) {
    assert.equal(Object.hasOwn(body, control), false);
  }
});

test('generateImage keeps the default body and does not add undefined run controls', async (t) => {
  const { api, image } = await fixture(t);
  const calls = [];
  api.invokeProviderAction = async (...args) => {
    calls.push(args);
    return { success: true, imageUrl: 'https://media.example/default.png' };
  };

  await image.generateImage('default prompt', 'brand-default');

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'generate-image');
  assert.deepEqual(calls[0][1], {
    prompt: 'default prompt',
    brandId: 'brand-default',
    legalSafety: { rightsConfirmed: false },
  });
  assert.deepEqual(calls[0][2], {
    heavyPreparation: undefined,
    heavyConsent: undefined,
  });
  for (const control of ['idempotencyKey', 'assertContext', 'retainUntilAcknowledged']) {
    assert.equal(Object.hasOwn(calls[0][1], control), false);
    assert.equal(Object.hasOwn(calls[0][2], control), false);
  }
});
