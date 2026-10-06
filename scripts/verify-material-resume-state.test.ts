import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readLightchainMaterialResumeState } from '../src/lib/lightchainResume.ts';

const artifact = (overrides: Record<string, unknown> = {}) => ({
  id: 'artifact-material-1',
  brandId: 'brand-1',
  featureType: 'lightchain-fabric-image-provider-result',
  title: 'Fabric result',
  imageUrl: '',
  prompt: null,
  createdAt: '2026-09-29T00:00:00.000Z',
  metadata: { providerResultArtifact: true },
  sourceJobId: 'job-material-1',
  ...overrides,
});

test('material resume keeps canonical source identity and UI settings', () => {
  const result = readLightchainMaterialResumeState([
    artifact({
      metadata: {
        providerResultArtifact: true,
        lightchainMaterialState: {
          version: 1,
          mode: 'fabric',
          fabricBase: {
            name: 'textile.png',
            referenceType: 'pattern',
            galleryImageId: 'gallery-textile-1',
            storagePath: 'brand-1/textile-1.png',
          },
          fabricDesign: {
            name: 'model.png',
            referenceType: 'base',
            galleryImageId: 'gallery-model-1',
            storagePath: 'brand-1/model-1.png',
          },
          printGarment: null,
          printDesigns: [],
          fabricPrompt: 'natural drape',
          fabricImageRatio: '1:1',
          printCoverageMode: 'spot',
          printOutputScale: 1,
        },
      },
    }),
  ], 'job-material-1');

  assert.deepEqual(result, {
    version: 1,
    mode: 'fabric',
    fabricBase: {
      name: 'textile.png',
      referenceType: 'pattern',
      galleryImageId: 'gallery-textile-1',
      storagePath: 'brand-1/textile-1.png',
    },
    fabricDesign: {
      name: 'model.png',
      referenceType: 'base',
      galleryImageId: 'gallery-model-1',
      storagePath: 'brand-1/model-1.png',
    },
    printGarment: null,
    printDesigns: [],
    fabricPrompt: 'natural drape',
    fabricImageRatio: '1:1',
    printCoverageMode: 'spot',
    printOutputScale: 1,
  });
});

test('material resume ignores stale bearer URLs and unrelated jobs', () => {
  const result = readLightchainMaterialResumeState([
    artifact({
      sourceJobId: 'other-job',
      metadata: {
        providerResultArtifact: true,
        lightchainMaterialState: {
          version: 1,
          mode: 'fabric',
          fabricBase: { name: 'stale', imageUrl: 'https://example.test/signed.png?token=stale' },
          fabricDesign: null,
        },
      },
    }),
    artifact({
      metadata: {
        providerResultArtifact: true,
        lightchainMaterialState: {
          version: 1,
          mode: 'fabric',
          fabricBase: { name: 'stale', imageUrl: 'https://example.test/signed.png?token=stale' },
          fabricDesign: null,
        },
      },
    }),
  ], 'job-material-1');
  assert.equal(result, null);
});

test('material page persists only durable source refs and exposes direct resume readback', async () => {
  const source = await readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /materialImageResumeRef/);
  assert.match(source, /lightchainMaterialState:/);
  assert.match(source, /readLightchainMaterialResumeState/);
  assert.match(source, /readLightchainResumeResult/);
  assert.match(source, /resolveGeneratedImageUrl\(canonicalPath\)/);
  assert.match(source, /listWorkspaceGeneratedImagesForActivity\(brandId, user\?\.id\)/);
  assert.match(source, /cloudflareDataPlane\.listGeneratedImages\(brandId/);
  assert.match(source, /mergeGeneratedImagesByCanonicalIdentity\(remoteImages, localImages\)/);
  assert.match(source, /FABRIC_REMOTE_PROVIDER_FEATURE_TYPE = 'lightchain-fabric-image'/);
  assert.match(source, /restoredMaterialOutputSize\(metadata\)/);
  assert.doesNotMatch(source, /lightchainMaterialState:[\s\S]{0,900}fabricBase[^\n]*url:/);
});
