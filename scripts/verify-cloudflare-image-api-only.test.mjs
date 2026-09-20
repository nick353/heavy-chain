import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

async function fixture(t, enabled = true) {
  const previous = { window: globalThis.window, fetch: globalThis.fetch };
  globalThis.window = { location: { origin: 'https://image-web.test' } };
  const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, define: {
    'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': JSON.stringify(String(enabled)),
    'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://image-api.test"',
  } });
  const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
  const { cloudflareDataPlane: api } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
  const image = await vite.ssrLoadModule('/src/lib/imageApi.ts');
  const canvas = await vite.ssrLoadModule('/src/lib/canvasDocumentPersistence.ts');
  t.after(async () => { auth.dispose(); Object.assign(globalThis, previous); await vite.close(); });
  return { auth, api, image, canvas };
}

test('image actions retain the actual Cloudflare adapter and error result contract', async t => {
  const { api, image } = await fixture(t);
  const calls = [];
  api.invokeProviderAction = async (...args) => { calls.push(args); return { success: true, imageUrl: 'synthetic-result' }; };
  assert.equal((await image.removeBackground('data:image/png;base64,AA==', 'brand', undefined, { rightsConfirmed: true })).success, true);
  assert.equal(calls[0][0], 'remove-background');
  assert.equal(calls[0][1].brandId, 'brand');
  assert.deepEqual(calls[0][1].legalSafety, { rightsConfirmed: true });
  api.invokeProviderAction = async () => { throw new Error('cloudflare_api_503_provider_unavailable'); };
  assert.equal((await image.bulkDownload('brand')).success, false);
});

test('share creation is authenticated, shared reads are public and tokens are validated before transport', async t => {
  const { auth, image } = await fixture(t);
  auth.getSession = async () => ({ data: { session: { user: { id: 'alice' }, access_token: 'fixture-token' } }, error: null });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://image-api.test');
    calls.push({ path: parsed.pathname, headers: new Headers(init?.headers), body: init?.body });
    return Response.json({ success: true });
  };
  assert.equal((await image.createShareLink('image-one', 3)).success, true);
  assert.equal(calls[0].path, '/v1/share-links');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer fixture-token');
  assert.deepEqual(JSON.parse(calls[0].body), { imageId: 'image-one', expiresInDays: 3 });
  assert.equal((await image.getSharedImage('a'.repeat(32))).success, true);
  assert.equal(calls[1].path, '/v1/shared-images');
  assert.equal(calls[1].headers.has('authorization'), false);
  assert.equal(calls[1].headers.has('apikey'), false);
  assert.equal((await image.getSharedImage('../bad')).success, false);
  assert.equal(calls.length, 2);
});

test('missing Cloudflare config fails without legacy or image-input network access', async t => {
  const { image, canvas } = await fixture(t, false);
  let requests = 0; globalThis.fetch = async () => { requests++; throw new Error('unexpected_fetch'); };
  for (const result of await Promise.all([image.removeBackground('https://input.test/image.png', 'brand'), image.editImageWithPrompt('https://input.test/image.png', 'edit', 'brand'), image.createShareLink('image'), image.getSharedImage('a'.repeat(32))])) {
    assert.equal(result.success, false); assert.match(result.error, /cloudflare_api_not_configured/);
  }
  assert.equal(requests, 0);
  await assert.rejects(canvas.getCanvasDocument('doc', 'brand'), /cloudflare_api_not_configured/);
  for (const file of ['src/lib/imageApi.ts', 'src/lib/canvasDocumentPersistence.ts', 'src/pages/CanvasEditorPage.tsx', 'src/pages/GeneratePage.tsx']) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /supabase|VITE_SUPABASE|functions\/v1/);
  }
});

test('Canvas retains exact document ID, revision and context with no wrapper-level write retry', async t => {
  const { api, canvas } = await fixture(t);
  const context = { userId: 'alice', assertContext() {} };
  const snapshot = { version: 1, objects: [] };
  const doc = { id: 'doc-one', ownerId: 'alice', brandId: 'brand', title: 'Test', snapshot, snapshotVersion: 1, revision: 7, createdAt: 'now', updatedAt: 'now' };
  const calls = [];
  for (const method of ['getCanvasDocument', 'createCanvasDocument', 'updateCanvasDocument']) api[method] = async (...args) => { calls.push({ method, args }); return doc; };
  assert.equal((await canvas.getCanvasDocument('doc-one', 'brand', context)).revision, 7);
  await canvas.createCanvasDocument({ documentId: 'doc-one', brandId: 'brand', title: 'Test', snapshot }, context);
  await canvas.updateCanvasDocument({ documentId: 'doc-one', brandId: 'brand', title: 'Test', snapshot, expectedRevision: 7 }, context);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].args[0].id, 'doc-one'); assert.equal(calls[2].args[0].expected_revision, 7);
  for (const call of calls) assert.equal(call.args[1], context);
  let writes = 0; api.updateCanvasDocument = async () => { writes++; throw new Error('cloudflare_api_409_revision_conflict'); };
  await assert.rejects(canvas.updateCanvasDocument({ documentId: 'doc-one', brandId: 'brand', title: 'Test', snapshot, expectedRevision: 7 }, context), /revision_conflict/);
  assert.equal(writes, 1);
});
