import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readFittingDraftMaterial, readFittingResumeMaterial } from '../src/lib/fittingResume.ts';

const artifact = (overrides: Record<string, unknown> = {}) => ({
  id: 'fit-artifact-1',
  brandId: 'brand-1',
  featureType: 'model-matrix',
  title: 'Fitting result',
  imageUrl: 'data:image/png;base64,result',
  prompt: 'fitting',
  createdAt: '2026-08-14T00:00:00.000Z',
  metadata: {},
  sourceJobId: 'job-fit-1',
  ...overrides,
});

test('fitting resume restores same-job local high-precision material metadata', () => {
  const result = readFittingResumeMaterial([
    artifact({
      metadata: {
        materialReference: {
          imageUrl: 'data:image/png;base64,garment',
          extractedImageUrl: 'blob:https://example.test/cutout',
          fileName: 'garment.png',
          materialKind: 'シャツ',
          maskMode: 'auto',
          activeLayer: 'base',
          placement: '中央',
          scale: 96,
          note: 'AI cutout',
          extractedLayerReady: true,
          nextStepReady: true,
          maskEngine: 'browser-ai-cloth-seg-v1',
        },
      },
    }),
  ], 'job-fit-1');

  assert.equal(result?.artifactId, 'fit-artifact-1');
  assert.equal(result?.materialReference.fileName, 'garment.png');
  assert.equal(result?.materialReference.extractedImageUrl, 'blob:https://example.test/cutout');
  assert.equal(result?.materialReference.nextStepReady, true);
});

test('fitting resume rejects stale remote URLs, browser previews, and unrelated jobs', () => {
  const result = readFittingResumeMaterial([
    artifact({
      sourceJobId: 'other-job',
      metadata: {
        materialReference: {
          imageUrl: 'https://example.test/signed-source.png?token=stale',
          extractedImageUrl: 'https://example.test/signed-cutout.png?token=stale',
          extractedLayerReady: true,
          nextStepReady: true,
        },
      },
    }),
    artifact({
      metadata: {
        materialReference: {
          imageUrl: 'data:image/png;base64,garment',
          extractedImageUrl: 'data:image/png;base64,preview',
          extractedLayerReady: true,
          nextStepReady: true,
          maskEngine: 'browser-canvas-background-flood-cutout-v2',
        },
      },
    }),
  ], 'job-fit-1');

  assert.equal(result, null);
});

test('fitting draft restores a canonical source path without falsely claiming cutout readiness', () => {
  const result = readFittingDraftMaterial([
    artifact({
      id: 'fitting-draft-brand-1',
      featureType: 'fitting-background-draft',
      metadata: {
        feature: 'fitting-background-draft',
        materialReference: {
          imageUrl: null,
          sourceImageId: 'gallery-image-1',
          sourceStoragePath: 'user-a/brand-1/gallery-image-1.png',
          fileName: 'Gallery素材-gallery-image-1',
          materialKind: '衣服画像',
          maskMode: 'auto',
          activeLayer: '衣服',
          placement: 'モデル前面',
          scale: 72,
          note: 'draft',
          extractedImageUrl: null,
          extractedLayerReady: false,
          nextStepReady: false,
        },
      },
    }),
  ]);

  assert.equal(result?.artifactId, 'fitting-draft-brand-1');
  assert.equal(result?.materialReference.imageUrl, '');
  assert.equal(result?.materialReference.sourceStoragePath, 'user-a/brand-1/gallery-image-1.png');
  assert.equal(result?.materialReference.extractedLayerReady, false);
  assert.equal(result?.materialReference.nextStepReady, false);
});

test('fitting draft restores a small durable cutout when its source and extraction are local', () => {
  const result = readFittingDraftMaterial([
    artifact({
      id: 'fitting-draft-local',
      featureType: 'fitting-background-draft',
      metadata: {
        feature: 'fitting-background-draft',
        materialReference: {
          imageUrl: 'data:image/png;base64,source',
          sourceStoragePath: null,
          fileName: 'local.png',
          materialKind: '衣服画像',
          maskMode: 'auto',
          activeLayer: '衣服',
          placement: 'モデル前面',
          scale: 72,
          note: 'local draft',
          extractedImageUrl: 'data:image/png;base64,cutout',
          extractedLayerReady: true,
          nextStepReady: true,
          maskEngine: 'browser-local-white-background-garment-cutout-v1',
        },
      },
    }),
  ]);

  assert.equal(result?.materialReference.extractedLayerReady, true);
  assert.equal(result?.materialReference.nextStepReady, true);
  assert.equal(result?.materialReference.extractedImageUrl, 'data:image/png;base64,cutout');
});

test('Fitting exposes explicit resume readback states', async () => {
  const source = await readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /sourceImageId: imageId/);
  assert.match(source, /sourceStoragePath: storagePath \?\? null/);
  assert.match(source, /data-testid="fitting-resume-input-restored"/);
  assert.match(source, /data-testid="fitting-resume-input-unavailable"/);
  assert.match(source, /remote URLは再利用せず/);
});
