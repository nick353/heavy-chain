import assert from 'node:assert/strict';
import { createServer } from 'vite';

class LocalMapStorage {
  values = new Map();
  setItemCalls = 0;

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key) {
    this.values.delete(key);
  }

  setItem(key, value) {
    this.setItemCalls += 1;
    this.values.set(key, value);
  }
}

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  define: {
    'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': JSON.stringify('https://local-api-only.invalid'),
    'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': JSON.stringify('true'),
    'import.meta.env.VITE_MEDIA_PROVIDER_ORDER': JSON.stringify('cloudflare_r2'),
  },
});

try {
  const artifacts = await server.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
  const { buildLightchainLibraryFeatureHref } = await server.ssrLoadModule('/src/lib/lightchainLibraryHandoff.ts');
  const storage = new LocalMapStorage();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;

  globalThis.window = { localStorage: storage };
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network must not be used by the local lifecycle canary');
  };

  try {
    const brandId = 'brand-local-r193';
    const scopeId = 'user-local-r193';
    const artifactId = 'fixture-lightchain-local-result-r193';
    const runId = 'run_heavy_chain_lightchain_local_lifecycle_20260831_r193';
    const imageUrl = 'data:image/svg+xml;base64,PHN2Zy8+';
    // Deterministic local preview result; no provider or browser generation is invoked.
    const generatedResult = {
      id: artifactId,
      brandId,
      scopeId,
      featureType: 'lightchain-fabric-image-local-preview',
      title: '生地画像 ローカルプレビュー',
      imageUrl,
      prompt: 'local-only lifecycle fixture',
      createdAt: '2026-08-31T00:00:00.000Z',
      metadata: {
        toolId: 'fabric-image',
        generationMode: 'preview',
        resultKind: 'local-preview',
        generationJobId: runId,
        providerAttempted: false,
        externalActionExecuted: false,
        destinations: ['Gallery', 'Canvas', 'History', 'Jobs'],
      },
    };

    const saved = artifacts.saveWorkspaceArtifactPersisted(generatedResult);
    assert.equal(saved.ok, true);
    assert.equal(storage.setItemCalls, 1, 'the fixture result is written exactly once');

    const storageKey = artifacts.getWorkspaceArtifactStorageKey(brandId, scopeId);
    const stored = JSON.parse(storage.values.get(storageKey) ?? 'null');
    assert.equal(stored.filter((item) => item.id === artifactId).length, 1);

    // Reload boundary: reconstruct only from localStorage, not the in-memory result.
    const reloaded = artifacts.listWorkspaceArtifacts(brandId, scopeId);
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0]?.id, artifactId);
    assert.equal(reloaded[0]?.imageUrl, imageUrl);
    assert.equal(reloaded[0]?.metadata.generationMode, 'preview');
    assert.equal(reloaded[0]?.metadata.externalActionExecuted, false);
    assert.deepEqual(artifacts.findWorkspaceArtifactPersisted(brandId, artifactId, scopeId), {
      ok: true,
      artifact: reloaded[0],
    });

    // Reuse boundary: construct the canonical library handoff without submitting or navigating.
    const reuseHref = buildLightchainLibraryFeatureHref(
      { id: 'fabric-image', route: '/tools/fabric' },
      artifactId,
    );
    const reuseUrl = new URL(reuseHref, 'https://heavy-chain.local');
    assert.equal(reuseUrl.pathname, '/tools/fabric');
    assert.equal(reuseUrl.searchParams.get('libraryArtifactId'), artifactId);
    assert.equal(reuseUrl.searchParams.get('librarySlot'), 'fabric-design');
    assert.equal(fetchCalls, 0);

    const deleted = artifacts.deleteWorkspaceArtifact(brandId, artifactId, scopeId);
    assert.deepEqual(deleted, { ok: true });
    assert.deepEqual(artifacts.listWorkspaceArtifacts(brandId, scopeId), []);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
} finally {
  await server.close();
}

console.log(JSON.stringify({
  ok: true,
  runId: 'run_heavy_chain_lightchain_local_lifecycle_20260831_r193',
  scope: 'lightchain_local_offline_lifecycle',
  stages: ['deterministic-local-result', 'save-once', 'reload-readback', 'library-reuse-handoff', 'cleanup'],
  externalActionExecuted: false,
  networkCalls: 0,
}));
