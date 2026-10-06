import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractFashionStudioThumbnailCandidates,
  extractFashionStudioThumbnailEvidence,
  fashionStudioThumbnailScopeKey,
} from '../src/lib/fashionStudioThumbnails.ts';

test('malformed snapshots and non-image objects yield no candidates', () => {
  for (const snapshot of [null, undefined, '', [], {}, { objects: null }, { objects: {} },
    { objects: [null, 12, {}, { type: 'text', src: 'https://text' }, { type: 'image', src: 42 }] }]) {
    assert.deepEqual(extractFashionStudioThumbnailCandidates(snapshot), []);
  }
});

test('image order is preserved, with canonical metadata before each src', () => {
  const snapshot = { objects: [
    { type: 'image', src: 'https://input-first' },
    { type: 'text' },
    { type: 'image', metadata: { storagePath: 'brand/result.png', galleryStoragePath: 'generated-images/image_123' }, src: 'https://stale-result' },
    { type: 'image', metadata: { storagePath: '  brand/last.png  ' }, src: 'blob:last' },
  ] };
  assert.deepEqual(extractFashionStudioThumbnailCandidates(snapshot), [
    'https://input-first', 'brand/result.png', 'generated-images/image_123', 'https://stale-result',
    '  brand/last.png  ', 'blob:last',
  ]);
});

test('unsupported metadata paths and IDs do not invent URL candidates', () => {
  for (const path of ['https://invalid-metadata', '/leading.png', 'trailing/', '../traversal',
    'path?query=1', 'path#fragment', 'encoded%2Fpath', 'public/generated-images/x', 'local:workspace']) {
    const snapshot = { objects: [{ type: 'image', metadata: {
      storagePath: path, galleryStoragePath: path, galleryImageUrl: 'https://unsupported', galleryImageId: 'image-id', jobId: 'job-id',
    } }] };
    assert.deepEqual(extractFashionStudioThumbnailCandidates(snapshot), [], path);
  }
  assert.deepEqual(extractFashionStudioThumbnailCandidates({ objects: [{ type: 'image', src: '  ' }] }), []);
});

test('candidate evidence keeps original object index and artifact identity without reordering input/result', () => {
  const evidence = extractFashionStudioThumbnailEvidence({ objects: [
    { type: 'image', src: 'https://input' },
    { type: 'image', src: 'https://result', metadata: {
      storagePath: 'brand/vector.svg', feature: 'lightchain-svg-convert-generated-result',
      galleryImageId: 'gallery-id', parameters: { artifactId: 'artifact-id' },
    } },
  ] });
  assert.deepEqual(evidence.map(({ source, objectIndex, sourceKind }) => ({ source, objectIndex, sourceKind })), [
    { source: 'https://input', objectIndex: 0, sourceKind: 'src' },
    { source: 'brand/vector.svg', objectIndex: 1, sourceKind: 'storagePath' },
    { source: 'https://result', objectIndex: 1, sourceKind: 'src' },
  ]);
  assert.equal(evidence[1].feature, 'lightchain-svg-convert-generated-result');
  assert.equal(evidence[1].artifactId, 'artifact-id');
  assert.equal(evidence[1].galleryImageId, 'gallery-id');
});

test('scope identity resets for brand, project or candidate content but not array identity', () => {
  const key = fashionStudioThumbnailScopeKey('A', 'p', ['one', 'two']);
  assert.equal(key, fashionStudioThumbnailScopeKey('A', 'p', ['one', 'two']));
  assert.notEqual(key, fashionStudioThumbnailScopeKey('B', 'p', ['one', 'two']));
  assert.notEqual(key, fashionStudioThumbnailScopeKey('A', 'q', ['one', 'two']));
  assert.notEqual(key, fashionStudioThumbnailScopeKey('A', 'p', ['one', 'changed']));
});
