import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

process.env.VITE_SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.VITE_SUPABASE_ANON_KEY ||= 'local-test-key';

class MemoryStorage {
  values = new Map();
  failWrites = false;
  failReads = false;
  failReadCount = 0;
  ignoreWrites = false;

  getItem(key) {
    if (this.failReads || this.failReadCount > 0) {
      if (this.failReadCount > 0) this.failReadCount -= 1;
      const error = new Error('access denied');
      error.name = 'SecurityError';
      throw error;
    }
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.failWrites) {
      const error = new Error('quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    if (this.ignoreWrites) return;
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
const favoriteModule = await vite.ssrLoadModule('/src/features/printing/history/printResultFavorite.ts');
const artifactModule = await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
const favorites = { ...artifactModule, ...favoriteModule };
after(async () => vite.close());

const makeResult = (overrides = {}) => ({
  id: 'result-1',
  title: 'Exact print',
  note: 'Keep the source note',
  imageUrl: 'data:image/png;base64,AA==',
  outputSize: { width: 720, height: 960 },
  generatedAt: 1_700_000_000_000,
  resultKind: 'exact',
  ...overrides,
});

test('favorite save deterministically upserts one result while preserving metadata and brand isolation', () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };

  const initial = favorites.saveWorkspaceArtifactPersisted({
    id: 'result-1',
    brandId: 'brand-a',
    featureType: 'printing-result',
    title: 'Original title',
    imageUrl: 'data:image/png;base64,AA==',
    prompt: 'Original prompt',
    createdAt: '2025-01-01T00:00:00.000Z',
    metadata: { sourceLabel: 'Original source' },
  });
  assert.equal(initial.ok, true);

  const first = favorites.savePrintResultFavorite({
    brandId: 'brand-a',
    result: makeResult(),
    destinationLabel: 'Gallery',
  });
  assert.equal(first.ok, true);
  assert.equal(first.artifact.id, 'result-1');
  assert.equal(first.artifact.createdAt, '2025-01-01T00:00:00.000Z');
  assert.equal(first.artifact.metadata.sourceLabel, 'Original source');
  assert.equal(first.artifact.metadata.printResultFavorite, true);

  const second = favorites.savePrintResultFavorite({
    brandId: 'brand-a',
    result: makeResult({ title: 'Updated exact print' }),
  });
  assert.equal(second.ok, true);
  assert.equal(favorites.listWorkspaceArtifacts('brand-a').length, 1);
  assert.equal(favorites.listWorkspaceArtifacts('brand-a')[0].title, 'Updated exact print');
  assert.equal(favorites.listWorkspaceArtifacts('brand-a')[0].metadata.printResultDestinationLabel, 'Gallery');
  assert.equal(favorites.listWorkspaceArtifacts('brand-b').length, 0);
  assert.equal(favorites.isPrintResultFavorite('brand-a', 'result-1'), true);
});

test('favorite maps to GeneratedImage and persistent toggle removes favorite state without deleting the artifact', () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };
  const saved = favorites.savePrintResultFavorite({ brandId: 'brand-a', result: makeResult() });
  assert.equal(saved.ok, true);
  assert.equal(favorites.workspaceArtifactToGeneratedImage(saved.artifact).is_favorite, true);

  const removed = favorites.setPrintResultFavorite({ brandId: 'brand-a', result: makeResult() }, false);
  assert.equal(removed.ok, true);
  assert.equal(favorites.isPrintResultFavorite('brand-a', 'result-1'), false);
  assert.equal(favorites.listWorkspaceArtifacts('brand-a').length, 1);
  assert.equal(favorites.workspaceArtifactToGeneratedImage(removed.artifact).is_favorite, false);
});

test('quota failure is reported and never returned as a successful favorite', () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  globalThis.window = { localStorage: storage };

  const result = favorites.savePrintResultFavorite({ brandId: 'brand-a', result: makeResult() });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /failed/i);
  assert.equal(favorites.isPrintResultFavorite('brand-a', 'result-1'), false);
});

test('missing browser storage is reported as a persistence failure', () => {
  delete globalThis.window;
  const result = favorites.savePrintResultFavorite({ brandId: 'brand-a', result: makeResult() });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /unavailable/i);
});

test('a write without matching readback is not reported as success', () => {
  const storage = new MemoryStorage();
  storage.ignoreWrites = true;
  globalThis.window = { localStorage: storage };
  const result = favorites.savePrintResultFavorite({ brandId: 'brand-a', result: makeResult() });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /verified/i);
});

test('deleting the final local artifact persists an empty list and survives readback', () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };
  const saved = favorites.savePrintResultFavorite({ brandId: 'brand-a', result: makeResult() });
  assert.equal(saved.ok, true);

  const deleted = favorites.deleteWorkspaceArtifact('brand-a', 'result-1');
  assert.equal(deleted.ok, true);
  assert.deepEqual(JSON.parse(storage.getItem('heavy-chain-workspace-artifacts:v1:brand-a')), []);
  assert.equal(favorites.listWorkspaceArtifacts('brand-a').length, 0);
});

test('unverified deletion is reported without a false success', () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };
  const saved = favorites.savePrintResultFavorite({ brandId: 'brand-a', result: makeResult() });
  assert.equal(saved.ok, true);
  storage.ignoreWrites = true;

  const deleted = favorites.deleteWorkspaceArtifact('brand-a', 'result-1');
  assert.equal(deleted.ok, false);
  assert.match(deleted.error.message, /verified/i);
  assert.equal(favorites.listWorkspaceArtifacts('brand-a').length, 1);
});

test('storage read denial degrades to an empty favorite set instead of crashing render', () => {
  const storage = new MemoryStorage();
  storage.failReads = true;
  globalThis.window = { localStorage: storage };
  assert.deepEqual(favorites.listWorkspaceArtifacts('brand-a'), []);
  assert.deepEqual(favorites.listPrintResultFavoriteIds('brand-a'), []);
  assert.equal(favorites.isPrintResultFavorite('brand-a', 'result-1'), false);
});

test('a transient read failure cannot overwrite or delete pre-existing artifacts', () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };
  const original = favorites.savePrintResultFavorite({ brandId: 'brand-a', result: makeResult() });
  assert.equal(original.ok, true);
  const storageKey = 'heavy-chain-workspace-artifacts:v1:brand-a';
  const before = storage.getItem(storageKey);

  storage.failReadCount = 1;
  const save = favorites.savePrintResultFavorite({
    brandId: 'brand-a',
    result: makeResult({ id: 'result-2' }),
  });
  assert.equal(save.ok, false);
  assert.equal(storage.getItem(storageKey), before);

  storage.failReadCount = 1;
  const deleted = favorites.deleteWorkspaceArtifact('brand-a', 'result-1');
  assert.equal(deleted.ok, false);
  assert.equal(storage.getItem(storageKey), before);
});
