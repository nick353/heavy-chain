import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createServer } from 'vite';
import { WORKSPACE_UPLOAD_MAX_BYTES } from '../src/lib/workspaceUploadLimits.ts';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalFileReader = globalThis.FileReader;
globalThis.window = { location: { origin: 'https://upload-web.test' } };
const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, define: {
  'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"',
  'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://upload-api.test"',
} });
const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
const { cloudflareDataPlane: client, ArtifactPersistenceContextError } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
after(async () => {
  auth.dispose(); globalThis.fetch = originalFetch;
  globalThis.window = originalWindow; globalThis.FileReader = originalFileReader;
  await vite.close();
});
let session;
let encodes;
const setup = () => {
  session = { user: { id: 'alice' }, access_token: 'captured-upload-token' }; encodes = 0;
  auth.getSession = async () => ({ data: { session }, error: null });
  auth.refreshSession = async () => { throw new Error('unexpected_refresh'); };
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      encodes++;
      blob.arrayBuffer().then(bytes => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      }, error => { this.error = error; this.onerror(); });
    }
  };
};
const input = () => ({ requestId: crypto.randomUUID(), brandId: 'brand', featureType: 'edit-image', title: 'Upload',
  imageUrl: 'blob:actual-raster-fixture', prompt: 'edit', metadata: {}, sourceStoragePath: null });
const receipt = requestId => ({ success: true, remote: { jobId: `wa-${requestId}`, imageId: `wa-${requestId}`, storagePath: `generated-images/wa-${requestId}` } });

/** APP15 segments are legitimate JPEG metadata, preserving a decodable image. */
async function jpegOfSize(size: number): Promise<Buffer> {
  const source = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#123456' } }).jpeg().toBuffer();
  let remaining = size - source.length;
  assert(remaining >= 4);
  const parts: Buffer[] = [source.subarray(0, 2)];
  while (remaining > 0) {
    let length = Math.min(remaining, 65537);
    if (remaining > length && remaining - length < 4) length -= 4 - (remaining - length);
    const segment = Buffer.alloc(length);
    segment[0] = 0xff; segment[1] = 0xef; segment.writeUInt16BE(length - 2, 2);
    parts.push(segment); remaining -= length;
  }
  parts.push(source.subarray(2));
  const result = Buffer.concat(parts);
  assert.equal(result.length, size);
  assert.equal((await sharp(result).raw().toBuffer({ resolveWithObject: true })).info.width, 1);
  return result;
}

test('client materializes actual raster blobs above 10 MiB and exactly 20 MiB preserving bytes and identity', async () => {
  for (const size of [10 * 1024 * 1024 + 1, WORKSPACE_UPLOAD_MAX_BYTES]) {
    setup(); const bytes = await jpegOfSize(size); const request = input(); let posts = 0;
    const context = await client.captureArtifactPersistenceContext();
    globalThis.fetch = async (url, init) => {
      if (url.startsWith('blob:')) return new Response(new Blob([bytes], { type: 'image/jpeg' }));
      posts++; assert.equal(init.method, 'POST'); assert.equal(url, `${client.origin}/v1/workspace-artifacts`);
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer captured-upload-token');
      const saved = JSON.parse(init.body);
      assert.equal(saved.requestId, request.requestId);
      assert.deepEqual(Buffer.from(saved.imageUrl.split(',')[1], 'base64'), bytes);
      return Response.json(receipt(saved.requestId));
    };
    assert.deepEqual(await client.saveWorkspaceArtifact(request, undefined, context), receipt(request.requestId));
    assert.equal(posts, 1); assert.equal(encodes, 1);
  }
});

test('client rejects an actual 20 MiB plus one byte blob before encoding or persistence POST', async () => {
  setup(); const bytes = await jpegOfSize(WORKSPACE_UPLOAD_MAX_BYTES + 1); let posts = 0;
  const context = await client.captureArtifactPersistenceContext();
  globalThis.fetch = async url => {
    if (url.startsWith('blob:')) return new Response(new Blob([bytes], { type: 'image/jpeg' }));
    posts++; throw new Error('unexpected_persistence_post');
  };
  await assert.rejects(client.saveWorkspaceArtifact(input(), undefined, context), /workspace_image_too_large/);
  assert.equal(posts, 0); assert.equal(encodes, 0);
});

test('canonical reuse still skips blob materialization and keeps captured-context admission', async () => {
  setup(); let blobFetches = 0, posts = 0;
  const request = { ...input(), sourceStoragePath: 'generated-images/existing-owned-artifact' };
  const context = await client.captureArtifactPersistenceContext();
  globalThis.fetch = async (url, init) => {
    if (url.startsWith('blob:')) { blobFetches++; throw new Error('must_not_materialize_canonical_source'); }
    posts++; assert.equal(JSON.parse(init.body).sourceStoragePath, request.sourceStoragePath);
    return Response.json({ success: true, remote: { jobId: 'existing-job', imageId: 'existing-owned-artifact', storagePath: request.sourceStoragePath } });
  };
  assert.equal((await client.saveWorkspaceArtifact(request, undefined, context)).remote.storagePath, request.sourceStoragePath);
  assert.equal(posts, 1); assert.equal(blobFetches, 0); assert.equal(encodes, 0);
  session.user.id = 'bob';
  await assert.rejects(client.saveWorkspaceArtifact(request, undefined, context), error => error instanceof ArtifactPersistenceContextError);
  assert.equal(posts, 1);
});

test('shared input ceiling preserves Worker envelope and independent 10 MiB generated output default', async () => {
  assert.equal(WORKSPACE_UPLOAD_MAX_BYTES, 20 * 1024 * 1024);
  const [clientSource, workerSource, coreSource] = await Promise.all([
    readFile(new URL('../src/lib/cloudflareApi.ts', import.meta.url), 'utf8'),
    readFile(new URL('../cloudflare/heavy-api/src/workspace.ts', import.meta.url), 'utf8'),
    readFile(new URL('../cloudflare/heavy-api/src/core.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(clientSource, /blob\.size > WORKSPACE_UPLOAD_MAX_BYTES/);
  assert.match(workerSource, /Math\.min\(WORKSPACE_UPLOAD_MAX_BYTES, Number\(env\.MAX_MEDIA_BYTES\) > 0/);
  assert.match(workerSource, /Math\.ceil\(maxBytes \/ 3\) \* 4 \+ MAX_METADATA_BYTES \+ 64 \* 1024/);
  assert.match(workerSource, /bytes\.length > max/);
  assert.match(coreSource, /DEFAULT_GENERATED_IMAGE_BYTES = 10 \* 1024 \* 1024/);
});
