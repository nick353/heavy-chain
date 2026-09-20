import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import {
  buildLocalUploadSourceMetadata,
  sanitizeCanvasSourceMetadata,
  sourceRevisionMatches,
} from '../src/features/canvasSourceMetadata.ts';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const file = (bytes: Uint8Array, type = 'image/png') => ({
  arrayBuffer: async () => bytes.slice().buffer,
  size: bytes.byteLength,
  type,
});

test('Canvas source readback hashes exact bytes and remains ownership-neutral', async () => {
  const metadata = await buildLocalUploadSourceMetadata(file(new Uint8Array([1, 2, 3])), { width: 12, height: 8 });

  assert.equal(metadata.sourceIdentity.kind, 'local-upload');
  assert.match(metadata.sourceIdentity.hash, /^[0-9a-f]{64}$/);
  assert.equal(metadata.sourceRevision.revision, `sha256:${metadata.sourceRevision.hash}`);
  assert.equal(metadata.sourceRevision.mimeType, 'image/png');
  assert.equal(metadata.sourceRevision.sizeBytes, 3);
  assert.equal(metadata.sourceReadback.status, 'verified');
  assert.equal(metadata.sourceReadback.provenance, 'unverified');
  assert.doesNotMatch(JSON.stringify(metadata), /data:|objecturl|\/tmp\//i);
});

test('Canvas source sanitizer removes local and inline payload fields without touching safety metadata', () => {
  const sanitized = sanitizeCanvasSourceMetadata({
    sourceIdentity: { kind: 'local-upload', hash: 'abc' },
    sourceReadback: {
      url: 'data:image/png;base64,AAAA',
      fileName: 'secret.png',
      path: '/tmp/secret.png',
      exif_data: { GPSLatitude: 1 },
      ok: true,
    },
    legalSafety: { rightsConfirmed: true },
  }) as Record<string, any>;

  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /secret\.png|\/tmp\/secret|data:image|gpslatitude/i);
  assert.equal(sanitized.sourceIdentity.hash, 'abc');
  assert.equal(sanitized.sourceReadback.ok, true);
  assert.deepEqual(sanitized.legalSafety, { rightsConfirmed: true });
});

test('Changed Canvas bytes produce a revision mismatch and size drift fails closed', async () => {
  const first = await buildLocalUploadSourceMetadata(file(new Uint8Array([1, 2, 3])), { width: 1, height: 1 });
  const changed = await buildLocalUploadSourceMetadata(file(new Uint8Array([1, 2, 4])), { width: 1, height: 1 });
  assert.equal(sourceRevisionMatches(first.sourceRevision, changed.sourceRevision), false);
  assert.equal(sourceRevisionMatches(first.sourceRevision, first.sourceRevision), true);
  await assert.rejects(
    buildLocalUploadSourceMetadata({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      size: 4,
      type: 'image/png',
    }, { width: 1, height: 1 }),
    /canvas_source_bytes_changed/,
  );
});

test('Canvas and generation pages carry source metadata into the Cloudflare request boundary', async () => {
  const [canvasPage, generatePage, imageAI, imageContracts] = await Promise.all([
    readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/cloudflareImageAI.ts', import.meta.url), 'utf8'),
    readFile(new URL('../cloudflare/heavy-api/src/image-ai-contracts.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(canvasPage, /const sourceReadback = image\.sourceReadback/);
  assert.match(canvasPage, /\.\.\.\(sourceReadback \? \{ sourceReadback \} : \{\}\)/);
  assert.match(generatePage, /sourceReadback,/);
  assert.match(generatePage, /generationIntent/);
  assert.match(imageAI, /canonicalCloudflareImageBody/);
  assert.match(imageAI, /sourceReadback/);
  assert.match(imageContracts, /sourceReadback/);
  assert.match(imageContracts, /generationIntent/);
  assert.doesNotMatch(imageAI, /supabase|\/functions\/v1/i);
  assert.doesNotMatch(imageContracts, /supabase|\/functions\/v1/i);
});

test('Fitting-to-generation handoff preserves canonical Cloudflare media identity', async () => {
  const [handoff, fitting, generate] = await Promise.all([
    readFile(new URL('../src/lib/workspaceHandoff.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(handoff, /sourceImageId\?: string/);
  assert.match(handoff, /sourceStoragePath\?: string/);
  assert.match(handoff, /params\.set\('sourceImageId', sourceImageId\)/);
  assert.match(handoff, /params\.set\('sourceStoragePath', sourceStoragePath\)/);
  assert.match(handoff, /params\.get\('sourceStoragePath'\)/);
  assert.match(fitting, /const fittingGenerationHref = useMemo\(\(\) => buildGenerationIntentHref/);
  assert.match(fitting, /sourceImageId: materialReference\.sourceImageId/);
  assert.match(fitting, /sourceStoragePath: materialReference\.sourceStoragePath/);
  assert.match(fitting, /to=\{fittingGenerationHref\}/);
  assert.doesNotMatch(fitting, /storage:\$\{storagePath\}/);
  assert.match(generate, /resolveGeneratedImageUrl\(sourceReadback\.sourceStoragePath/);
  assert.match(generate, /galleryImageId: sourceReadback\.sourceImageId/);
  assert.match(generate, /sourceStoragePath: sourceReadback\.sourceStoragePath/);
});
