import test from 'node:test';
import assert from 'node:assert/strict';
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

test('local source metadata hashes exact bytes and records safe readback fields', async () => {
  const metadata = await buildLocalUploadSourceMetadata(file(new Uint8Array([1, 2, 3])), { width: 12, height: 8 });

  assert.equal(metadata.sourceIdentity.kind, 'local-upload');
  assert.match(metadata.sourceIdentity.hash, /^[0-9a-f]{64}$/);
  assert.equal(metadata.sourceRevision.revision, `sha256:${metadata.sourceRevision.hash}`);
  assert.deepEqual(metadata.sourceReadback, {
    ...metadata.sourceRevision,
    sourceIdentity: metadata.sourceIdentity,
    status: 'verified',
    provenance: 'unverified',
  });
  assert.equal(metadata.sourceRevision.mimeType, 'image/png');
  assert.equal(metadata.sourceRevision.sizeBytes, 3);
  assert.equal(metadata.sourceRevision.width, 12);
  assert.equal(metadata.sourceRevision.height, 8);
  assert.doesNotMatch(JSON.stringify(metadata), /data:/i);
});

test('source metadata contains no filename, path, object URL, or data URL', () => {
  const input = {
    sourceIdentity: { kind: 'local-upload', hash: 'abc' },
    sourceRevision: { revision: 'sha256:abc', hash: 'abc' },
    sourceReadback: {
      url: 'data:image/png;base64,AAAA',
      fileName: 'secret.png',
      path: '/tmp/secret.png',
      EXIF: { Camera: 'secret-camera' },
      exif_data: { GPSLatitude: 1 },
      ExIfMetadata: { Artist: 'secret-artist' },
      ok: true,
    },
  };
  const sanitized = sanitizeCanvasSourceMetadata(input) as Record<string, any>;
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /secret\.png|\/tmp\/secret|data:image|camera|gpslatitude|artist/i);
  assert.equal(sanitized.sourceIdentity.hash, 'abc');
  assert.equal(sanitized.sourceReadback.ok, true);
});

test('legacy metadata and legal safety metadata remain untouched when source data is added', () => {
  const legacy = {
    feature: 'legacy-upload',
    generation: 0,
    legalSafety: { rightsConfirmed: true },
    parameters: { source: 'legacy' },
  };
  const metadata = {
    ...legacy,
    ...(sanitizeCanvasSourceMetadata({ sourceIdentity: { kind: 'local-upload', hash: 'abc' } }) as object),
  };
  assert.deepEqual(metadata.legalSafety, legacy.legalSafety);
  assert.equal(metadata.feature, legacy.feature);
  assert.equal(metadata.parameters.source, 'legacy');
});

test('changed bytes produce a revision mismatch', async () => {
  const first = await buildLocalUploadSourceMetadata(file(new Uint8Array([1, 2, 3])), { width: 1, height: 1 });
  const changed = await buildLocalUploadSourceMetadata(file(new Uint8Array([1, 2, 4])), { width: 1, height: 1 });
  assert.equal(sourceRevisionMatches(first.sourceRevision, changed.sourceRevision), false);
  assert.equal(sourceRevisionMatches(first.sourceRevision, first.sourceRevision), true);
});

test('metadata generation rejects a file whose declared size changed during read', async () => {
  await assert.rejects(
    buildLocalUploadSourceMetadata({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      size: 4,
      type: 'image/png',
    }, { width: 1, height: 1 }),
    /canvas_source_bytes_changed/,
  );
});

test('Canvas upload persists source metadata and exposes sanitized readback', async () => {
  const [page, properties] = await Promise.all([
    readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/canvas/PropertiesPanel.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /buildLocalUploadSourceMetadata\(\s*new Blob\(\[bytes\]/);
  assert.match(page, /sanitizeCanvasSourceMetadata\(await buildLocalUploadSourceMetadata/);
  assert.match(page, /\.\.\.sourceMetadata/);
  assert.match(page, /from '\.\.\/lib\/legalSafetyGuard'/);
  assert.match(page, /const \{ bytes, dataUrl: source \} = await readLocalUploadFile\(file\)/);
  assert.match(page, /!source\.startsWith\('data:image\/'\)/);
  assert.match(page, /src: source,/);
  assert.match(properties, /data-testid="canvas-source-readback"/);
  assert.match(properties, /権利・所有の証明ではありません/);
});
