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
  const gate = await server.ssrLoadModule('/src/features/lightchain/preSourceEvidenceGate.ts');
  const artifacts = await server.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
  const { buildLightchainLibraryFeatureHref } = await server.ssrLoadModule('/src/lib/lightchainLibraryHandoff.ts');
  const storage = new LocalMapStorage();
  const evidenceStore = new LocalMapStorage();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  let downstreamStarts = 0;

  globalThis.window = { localStorage: storage };
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network must not be used by the local evidence canary');
  };

  try {
    const brandId = 'brand-local-r195';
    const scopeId = 'user-local-r195';
    const artifactId = 'fixture-lightchain-local-result-r195';
    const runId = 'run_heavy_chain_lightchain_evidence_continuity_20260831_r195';
    const sourceHash = `sha256:${'a'.repeat(64)}`;
    const semanticHash = `sha256:${'b'.repeat(64)}`;
    const visualHash = `sha256:${'c'.repeat(64)}`;
    const selector = {
      backend: 'chrome_plugin',
      browserSurface: 'signed_chrome_extension_profile2',
      selectorRevision: 'selector-r195',
    };
    const expected = {
      expectedRunId: runId,
      expectedSourceHash: sourceHash,
      expectedVisualArtifactHash: visualHash,
      expectedBackend: selector.backend,
      expectedBrowserSurface: selector.browserSurface,
      expectedSelectorRevision: selector.selectorRevision,
    };
    const snapshot = gate.createLightchainPreSourceSnapshot({
      runId,
      capturedAt: '2026-08-31T00:00:00.000Z',
      route: '/tools/fabric',
      title: 'Lightchain AI',
      normalizedSourceHash: sourceHash,
      semanticState: 'present',
      semanticHash,
      visualState: 'present',
      visualArtifactHash: visualHash,
      ...selector,
    });
    const snapshotKey = 'pre-source:r195';
    const written = gate.writeLightchainPreSourceSnapshotOnce(evidenceStore, snapshotKey, snapshot);
    assert.equal(written.ok, true);
    assert.equal(evidenceStore.setItemCalls, 1);
    const admitted = gate.admitLightchainLocalStub({
      snapshot: gate.readLightchainPreSourceSnapshot(evidenceStore, snapshotKey),
      ...expected,
    });
    assert.equal(admitted.ok, true);
    if (!admitted.ok) throw new Error('valid synthetic snapshot was not admitted');
    const evidenceIdentity = gate.buildLightchainPreSourceEvidenceIdentity(admitted.snapshot);
    const persistedEvidence = {
      evidenceIdentity,
      runId: admitted.snapshot.runId,
      sourceHash: admitted.snapshot.source.normalizedSourceHash,
      visualArtifactHash: admitted.snapshot.readback.visualArtifactHash,
      selectorRevision: admitted.snapshot.selector.revision,
    };

    const admitForDownstream = (snapshotForCheck, candidate) => {
      const result = gate.verifyLightchainPreSourceEvidenceContinuity({
        snapshot: snapshotForCheck,
        persistedEvidence: candidate,
        ...expected,
      });
      if (result.ok) downstreamStarts += 1;
      return result;
    };
    const continuity = admitForDownstream(admitted.snapshot, persistedEvidence);
    assert.deepEqual(continuity, {
      ok: true,
      snapshot: admitted.snapshot,
      evidenceIdentity,
    });
    assert.equal(downstreamStarts, 1);

    const generatedResult = {
      id: artifactId,
      brandId,
      scopeId,
      featureType: 'lightchain-fabric-image-local-preview',
      title: '生地画像 証跡継続ローカルプレビュー',
      imageUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      prompt: 'local-only evidence continuity fixture',
      createdAt: '2026-08-31T00:00:00.000Z',
      metadata: {
        toolId: 'fabric-image',
        generationMode: 'preview',
        resultKind: 'local-preview',
        generationJobId: runId,
        preSourceEvidenceIdentity: persistedEvidence.evidenceIdentity,
        preSourceRunId: persistedEvidence.runId,
        preSourceSourceHash: persistedEvidence.sourceHash,
        preSourceVisualHash: persistedEvidence.visualArtifactHash,
        preSourceSelectorRevision: persistedEvidence.selectorRevision,
        providerAttempted: false,
        externalActionExecuted: false,
        destinations: ['Gallery', 'Canvas', 'History', 'Jobs'],
      },
    };

    const saved = artifacts.saveWorkspaceArtifactPersisted(generatedResult);
    assert.equal(saved.ok, true);
    assert.equal(storage.setItemCalls, 1, 'the accepted result is saved once');
    const reloaded = artifacts.listWorkspaceArtifacts(brandId, scopeId);
    assert.equal(reloaded.length, 1);
    const reloadedArtifact = reloaded[0];
    assert.ok(reloadedArtifact);
    assert.equal(reloadedArtifact.metadata.preSourceEvidenceIdentity, evidenceIdentity);
    assert.equal(reloadedArtifact.metadata.preSourceRunId, runId);
    assert.equal(reloadedArtifact.metadata.preSourceSourceHash, sourceHash);
    assert.equal(reloadedArtifact.metadata.preSourceVisualHash, visualHash);
    assert.deepEqual(artifacts.findWorkspaceArtifactPersisted(brandId, artifactId, scopeId), {
      ok: true,
      artifact: reloadedArtifact,
    });

    const reloadedEvidence = {
      evidenceIdentity: reloadedArtifact.metadata.preSourceEvidenceIdentity,
      runId: reloadedArtifact.metadata.preSourceRunId,
      sourceHash: reloadedArtifact.metadata.preSourceSourceHash,
      visualArtifactHash: reloadedArtifact.metadata.preSourceVisualHash,
      selectorRevision: reloadedArtifact.metadata.preSourceSelectorRevision,
    };
    const reloadedContinuity = gate.verifyLightchainPreSourceEvidenceContinuity({
      snapshot: admitted.snapshot,
      persistedEvidence: reloadedEvidence,
      ...expected,
    });
    assert.equal(reloadedContinuity.ok, true);

    const reuseHref = buildLightchainLibraryFeatureHref(
      { id: 'fabric-image', route: '/tools/fabric' },
      artifactId,
    );
    const reuseUrl = new URL(reuseHref, 'https://heavy-chain.local');
    assert.equal(reuseUrl.pathname, '/tools/fabric');
    assert.equal(reuseUrl.searchParams.get('libraryArtifactId'), artifactId);
    assert.equal(reuseUrl.searchParams.get('librarySlot'), 'fabric-design');
    assert.equal(fetchCalls, 0);

    const negative = (label, candidate, blocker, snapshotForCheck = admitted.snapshot) => {
      const before = downstreamStarts;
      const result = admitForDownstream(snapshotForCheck, candidate);
      assert.deepEqual(result, { ok: false, blocker }, label);
      assert.equal(downstreamStarts, before, `${label} must not start downstream lifecycle`);
    };
    negative('missing persisted evidence', null, 'lightchain_pre_source_evidence_missing');
    negative(
      'tampered identity',
      { ...persistedEvidence, evidenceIdentity: `${evidenceIdentity}-tampered` },
      'lightchain_pre_source_evidence_identity_mismatch',
    );
    negative(
      'identity run mismatch',
      { ...persistedEvidence, runId: 'run_heavy_chain_lightchain_other' },
      'lightchain_pre_source_evidence_run_mismatch',
    );
    negative(
      'save evidence loss',
      { ...persistedEvidence, visualArtifactHash: undefined },
      'lightchain_pre_source_evidence_missing',
    );
    const crossRunSnapshot = {
      ...admitted.snapshot,
      runId: 'run_heavy_chain_lightchain_other',
    };
    negative(
      'cross-run snapshot',
      persistedEvidence,
      'lightchain_pre_source_run_mismatch',
      crossRunSnapshot,
    );

    const deleted = artifacts.deleteWorkspaceArtifact(brandId, artifactId, scopeId);
    assert.deepEqual(deleted, { ok: true });
    assert.deepEqual(artifacts.listWorkspaceArtifacts(brandId, scopeId), []);
    assert.equal(fetchCalls, 0);
    assert.equal(downstreamStarts, 1);
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
  runId: 'run_heavy_chain_lightchain_evidence_continuity_20260831_r195',
  scope: 'lightchain_local_evidence_continuity',
  stages: ['pre-source-admission', 'result', 'save-once', 'reload-readback', 'library-reuse', 'negative-gates', 'cleanup'],
  negativeCases: 5,
  downstreamStarts: 1,
  externalActionExecuted: false,
  networkCalls: 0,
}));
