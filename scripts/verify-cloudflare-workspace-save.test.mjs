import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = { location: { origin: 'https://heavy-web.example.test' } };
const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, define: {
  'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"',
  'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://heavy-api.example.test"',
  'import.meta.env.VITE_MEDIA_PROVIDER_ORDER': '"cloudflare_r2"',
  'import.meta.env.VITE_MEDIA_GATEWAY_URL': '"https://heavy-api.example.test"',
} });
const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
const { cloudflareDataPlane } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
assert(cloudflareDataPlane, 'test must exercise the enabled Cloudflare path');
auth.getSession = async () => ({ data: { session: { user: { id: 'alice' }, access_token: 'local-test-token' } }, error: null });
const { saveWorkspaceArtifactBestEffort, findWorkspaceArtifact } = await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
const originalFetch = globalThis.fetch;
after(async () => { auth.dispose(); globalThis.fetch = originalFetch; globalThis.window = originalWindow; await vite.close(); });
function storage() {
  const data = new Map();
  globalThis.window = { localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) } };
}
const input = () => ({ brandId: 'brand-1', featureType: 'ai-fitting', title: 'Saved result',
  imageUrl: 'data:image/png;base64,aW1hZ2U=', prompt: 'shirt', scopeId: 'alice', metadata: { source: 'canvas' } });
function success(request) {
  const id = `wa-${request.requestId}`;
  return Response.json({ success: true, remote: { jobId: id, imageId: id, storagePath: `generated-images/${id}` } });
}

test('enabled workspace save goes to Cloudflare and local record retains canonical R2 identity', async () => {
  storage(); const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://heavy-api.example.test/v1/workspace-artifacts');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer local-test-token');
    const request = JSON.parse(init.body); calls.push(request); return success(request);
  };
  const result = await saveWorkspaceArtifactBestEffort(input());
  assert.equal(result.localPersisted, true);
  assert(result.remote);
  assert.equal(calls.length, 1);
  const persisted = findWorkspaceArtifact('brand-1', result.artifact.id, 'alice');
  assert.equal(persisted.metadata.remoteStoragePath, result.remote.storagePath);
  assert.equal(persisted.metadata.cloudflareWorkspaceRequestId, calls[0].requestId);
});

test('uncertain save is locally retained and retry uses the same ID without Supabase fallback', async () => {
  storage(); const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://heavy-api.example.test/v1/workspace-artifacts');
    const request = JSON.parse(init.body); calls.push(request);
    if (calls.length === 1) throw new TypeError('Network response lost');
    return success(request);
  };
  const first = await saveWorkspaceArtifactBestEffort(input());
  assert(first.remoteError); assert.equal(first.localPersisted, true);
  assert.equal(first.remote, undefined);
  const saved = findWorkspaceArtifact('brand-1', first.artifact.id, 'alice');
  const second = await saveWorkspaceArtifactBestEffort(saved);
  assert(second.remote); assert.equal(second.localPersisted, true);
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.deepEqual(calls[0].metadata, calls[1].metadata);
});

test('canonical reuse sends only its source path and does not download an arbitrary remote URL', async () => {
  storage(); let calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://heavy-api.example.test/v1/workspace-artifacts'); calls++;
    const request = JSON.parse(init.body);
    assert.equal(request.sourceStoragePath, 'generated-images/original-image');
    return success(request);
  };
  const result = await saveWorkspaceArtifactBestEffort({ ...input(), imageUrl: 'https://external.invalid/secret', metadata: { storagePath: 'generated-images/original-image' } });
  assert(result.remote); assert.equal(calls, 1);
});

test('R2 image signing and Gallery readback use the gateway and never fall back to Supabase', async () => {
  let fail = false;
  let reads = 0;
  let active = 0, peak = 0;
  globalThis.fetch = async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://heavy-api.example.test');
    assert.equal(target.pathname, '/v1/media/read');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer local-test-token');
    reads++;
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 0)); active--;
    if (fail || target.searchParams.get('path') === 'generated-images/wa-missing') return Response.json({ error: 'unavailable' }, { status: 503 });
    return Response.json({ provider: 'cloudflare_r2', bucket: 'generated-images',
      objectPath: target.searchParams.get('path'), url: 'https://heavy-api.example.test/read?token=short-lived' });
  };
  const { resolveGeneratedImageUrl, withSignedImageUrls } = await vite.ssrLoadModule('/src/lib/storage.ts');
  const path = 'generated-images/wa-image-1';
  assert.equal(await resolveGeneratedImageUrl(path), 'https://heavy-api.example.test/read?token=short-lived');
  const rows = await withSignedImageUrls([{ storage_path: path, image_url: null }]);
  assert.equal(rows[0].image_url, 'https://heavy-api.example.test/read?token=short-lived');
  fail = true;
  const failed = await withSignedImageUrls([{ storage_path: path, image_url: 'https://old.invalid/?token=stale' }]);
  assert.equal(failed[0].image_url, null);
  assert.equal(reads, 3);
  await assert.rejects(resolveGeneratedImageUrl('generated-images/../private'));
  assert.equal(reads, 3);
  fail = false;
  const batch = Array.from({ length: 12 }, (_, i) => ({ storage_path: 'generated-images/wa-batch-' + i, image_url: null }));
  const mixed = await withSignedImageUrls([...batch, batch[0], { storage_path: 'generated-images/wa-missing', image_url: 'https://old.invalid/stale' }]);
  assert.equal(reads, 16); // deduplicated twelve valid paths plus one missing path
  assert.equal(peak, 4);
  assert(mixed.slice(0, 13).every(row => row.image_url === 'https://heavy-api.example.test/read?token=short-lived'));
  assert.equal(mixed[13].image_url, null);
});
