import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readLightchainResumeInput } from '../src/lib/lightchainResume.ts';

const artifact = (overrides: Record<string, unknown> = {}) => ({
  id: 'artifact-1',
  brandId: 'brand-1',
  featureType: 'lightchain-model-change',
  title: 'Model change',
  imageUrl: '',
  prompt: null,
  createdAt: '2026-08-14T00:00:00.000Z',
  metadata: {},
  sourceJobId: 'job-1',
  ...overrides,
});

test('resume input restores only same-job local source slots and model settings', () => {
  const result = readLightchainResumeInput([
    artifact({
      metadata: {
        lightchainWorkbenchState: {
          materialSlots: [
            { key: 'primary', fileName: 'garment.png', materialKind: 'シャツ', imageUrl: 'data:image/png;base64,AAAA' },
            { key: 'secondary', fileName: 'reference.png', materialKind: '参考', imageUrl: 'blob:https://example.test/reference' },
          ],
          modelFormState: { bodyType: 'regular', angleZoom: 2 },
        },
      },
    }),
  ], 'job-1');

  assert.deepEqual(result, {
    artifactId: 'artifact-1',
    slots: [
      { key: 'primary', name: 'garment.png', kind: 'シャツ', imageUrl: 'data:image/png;base64,AAAA' },
      { key: 'secondary', name: 'reference.png', kind: '参考', imageUrl: 'blob:https://example.test/reference' },
    ],
    modelFormState: { bodyType: 'regular', angleZoom: 2 },
  });
});

test('resume input rejects remote signed URLs and unrelated jobs', () => {
  const result = readLightchainResumeInput([
    artifact({
      sourceJobId: 'other-job',
      metadata: {
        materialSlots: [
          { key: 'primary', fileName: 'remote.png', materialKind: '素材', imageUrl: 'https://example.test/signed.png?token=stale' },
        ],
      },
    }),
    artifact({
      metadata: {
        materialSlots: [
          { key: 'primary', fileName: 'remote.png', materialKind: '素材', imageUrl: 'https://example.test/signed.png?token=stale' },
        ],
      },
    }),
  ], 'job-1');

  assert.equal(result, null);
});

test('resume input restores local slots from provider result materialSlotFiles', () => {
  const result = readLightchainResumeInput([
    artifact({
      featureType: 'lightchain-printing-image-provider-result',
      metadata: {
        providerResultArtifact: true,
        materialSlotFiles: {
          primary: {
            name: 'garment.png',
            kind: 'フーディー',
            imageUrl: 'data:image/png;base64,AAAA',
          },
          secondary: {
            name: 'print.png',
            kind: 'プリント',
            imageUrl: 'blob:https://example.test/print',
          },
        },
      },
    }),
  ], 'job-1');

  assert.deepEqual(result?.slots, [
    { key: 'primary', name: 'garment.png', kind: 'フーディー', imageUrl: 'data:image/png;base64,AAAA' },
    { key: 'secondary', name: 'print.png', kind: 'プリント', imageUrl: 'blob:https://example.test/print' },
  ]);
});

test('resume hydration is declared after the tool reset effect', async () => {
  const source = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const resetIndex = source.indexOf("setMaterialSlotFiles({ primary: null, secondary: null });");
  const restoredIndex = source.indexOf("setResumeInputReadback('restored');");

  assert.ok(resetIndex >= 0, 'tool reset effect must clear material slots');
  assert.ok(restoredIndex > resetIndex, 'resume hydration must run after tool reset so restored slots are not cleared');
});
