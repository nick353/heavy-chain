import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

process.env.VITE_SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.VITE_SUPABASE_ANON_KEY ||= 'local-test-key';

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const persistence = await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
const fittingPersistence = await vite.ssrLoadModule('/src/lib/fittingPersistence.ts');
const fittingResume = await vite.ssrLoadModule('/src/lib/fittingResume.ts');
const errorMessages = await vite.ssrLoadModule('/src/lib/errorMessages.ts');
after(async () => vite.close());

const makeInput = (overrides = {}) => ({
  id: 'fitting-result-1',
  brandId: 'brand-a',
  featureType: 'fitting-background',
  title: 'Fitting result',
  imageUrl: 'https://signed.example.test/fitting-result.png?token=ephemeral',
  prompt: null,
  metadata: {},
  ...overrides,
});

test('fitting persistence keeps only the canonical path while verifying local readback', () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };

  const result = persistence.saveWorkspaceArtifactPersisted(makeInput({
    metadata: { remoteStoragePath: 'user-a/brand-a/job-1/fitting-result.png' },
  }));

  assert.equal(result.ok, true);
  const stored = JSON.parse(storage.getItem(
    persistence.getWorkspaceArtifactStorageKey('brand-a'),
  ));
  assert.equal(stored[0].imageUrl, '');
  assert.equal(stored[0].metadata.remoteStoragePath, 'user-a/brand-a/job-1/fitting-result.png');
  assert.equal(persistence.listWorkspaceArtifacts('brand-a')[0].imageUrl, '');
});

test('fitting persistence rejects a remote URL without canonical storage metadata', () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };

  const result = persistence.saveWorkspaceArtifactPersisted(makeInput());

  assert.equal(result.ok, false);
  assert.equal(
    result.error.message,
    'Remote image URL requires canonical storage path metadata for local persistence.',
  );
  assert.equal(result.error.code, 'LOCAL_WORKSPACE_REMOTE_PATH_MISSING');
  assert.match(
    errorMessages.getErrorMessage(result.error),
    /永続Storage pathがないため/,
  );
  assert.equal(storage.getItem(persistence.getWorkspaceArtifactStorageKey('brand-a')), null);
});

test('fitting persistence reports browser storage quota as a stable diagnostic code', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      const error = new Error('quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    },
    removeItem: () => {},
  };
  globalThis.window = { localStorage: storage };

  const result = persistence.saveWorkspaceArtifactPersisted(makeInput({
    imageUrl: 'data:image/png;base64,AA==',
  }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'LOCAL_WORKSPACE_QUOTA_EXCEEDED');
  assert.match(errorMessages.getErrorMessage(result.error), /保存容量が不足/);
});

test('fitting persistence reports a write/readback mismatch separately from quota', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  globalThis.window = { localStorage: storage };

  const result = persistence.saveWorkspaceArtifactPersisted(makeInput({
    imageUrl: 'data:image/png;base64,AA==',
  }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'LOCAL_WORKSPACE_SAVE_READBACK_FAILED');
  assert.match(errorMessages.getErrorMessage(result.error), /再読込確認に失敗/);
});

test('fitting persistence accepts a path-only artifact when the canonical path is durable', () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };

  const result = persistence.saveWorkspaceArtifactPersisted(makeInput({
    imageUrl: '',
    metadata: { storagePath: 'user-a/brand-a/job-1/fitting-result.png' },
  }));

  assert.equal(result.ok, true);
  assert.equal(persistence.listWorkspaceArtifacts('brand-a')[0].imageUrl, '');
});

test('fitting draft save and readback keeps a canonical Gallery source without a signed URL', () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };
  const reference = fittingPersistence.prepareFittingDraftMaterialReferenceForPersistence({
    hasImage: true,
    imageUrl: 'https://signed.example.test/gallery.png?token=ephemeral',
    sourceImageId: 'gallery-image-1',
    sourceStoragePath: 'user-a/brand-a/gallery-image-1.png',
    fileName: 'Gallery素材-gallery-image-1',
    materialKind: '衣服画像',
    maskMode: 'auto',
    activeLayer: '衣服',
    placement: 'モデル前面',
    scale: 72,
    note: 'draft',
    extractedLayerReady: false,
    extractedImageUrl: null,
    nextStepReady: false,
  }, 'https://signed.example.test/gallery.png?token=ephemeral');

  const saved = persistence.saveWorkspaceArtifactPersisted({
    id: 'fitting-draft-brand-a',
    brandId: 'brand-a',
    scopeId: 'user-a',
    featureType: 'fitting-background-draft',
    title: 'AIフィッティング入力',
    imageUrl: reference.imageUrl ?? '',
    prompt: 'draft',
    metadata: {
      feature: 'fitting-background-draft',
      sourceStoragePath: reference.sourceStoragePath,
      materialReference: reference,
    },
  });

  assert.equal(saved.ok, true);
  const restored = fittingResume.readFittingDraftMaterial(
    persistence.listWorkspaceArtifacts('brand-a', 'user-a'),
  );
  assert.equal(restored?.materialReference.imageUrl, '');
  assert.equal(restored?.materialReference.sourceStoragePath, 'user-a/brand-a/gallery-image-1.png');
  assert.equal(restored?.materialReference.nextStepReady, false);
  assert.equal(JSON.parse(storage.getItem(persistence.getWorkspaceArtifactStorageKey('brand-a', 'user-a')))[0].imageUrl, '');
});

test('fitting draft save and readback restores a bounded remote cutout', () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };
  const cutout = `data:image/png;base64,${'A'.repeat(120_000)}`;
  const reference = fittingPersistence.prepareFittingDraftMaterialReferenceForPersistence({
    hasImage: true,
    imageUrl: 'https://signed.example.test/gallery.png?token=ephemeral',
    sourceStoragePath: 'user-a/brand-a/gallery-image-1.png',
    fileName: 'Gallery素材-gallery-image-1',
    materialKind: '衣服画像',
    maskMode: 'auto',
    activeLayer: '衣服',
    placement: 'モデル前面',
    scale: 72,
    note: 'draft with cutout',
    extractedLayerReady: true,
    extractedImageUrl: cutout,
    cutoutMaxDataUrlBytes: 750_000,
    nextStepReady: true,
    maskEngine: 'browser-local-white-background-garment-cutout-v1',
  }, 'https://signed.example.test/gallery.png?token=ephemeral');

  const saved = persistence.saveWorkspaceArtifactPersisted({
    id: 'fitting-draft-with-cutout',
    brandId: 'brand-a',
    scopeId: 'user-a',
    featureType: 'fitting-background-draft',
    title: 'AIフィッティング入力',
    imageUrl: reference.imageUrl ?? '',
    prompt: 'draft',
    metadata: {
      feature: 'fitting-background-draft',
      sourceStoragePath: reference.sourceStoragePath,
      materialReference: reference,
    },
  });

  assert.equal(saved.ok, true);
  const restored = fittingResume.readFittingDraftMaterial(
    persistence.listWorkspaceArtifacts('brand-a', 'user-a'),
  );
  assert.equal(restored?.materialReference.nextStepReady, true);
  assert.equal(restored?.materialReference.extractedImageUrl, cutout);
});
