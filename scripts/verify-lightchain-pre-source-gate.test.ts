import assert from 'node:assert/strict';
import test from 'node:test';
import {
  admitLightchainLocalStub,
  createLightchainPreSourceSnapshot,
  readLightchainPreSourceSnapshot,
  serializeLightchainPreSourceSnapshot,
  writeLightchainPreSourceSnapshotOnce,
} from '../src/features/lightchain/preSourceEvidenceGate.ts';

class MapStore {
  readonly values = new Map<string, string>();
  writes = 0;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.writes += 1;
    this.values.set(key, value);
  }
}

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const runId = 'run_heavy_chain_lightchain_pre_source_20260831_r194';
const sourceHash = hash('a');
const semanticHash = hash('b');
const visualHash = hash('c');
const selector = {
  backend: 'chrome_plugin',
  browserSurface: 'signed_chrome_extension_profile2',
  selectorRevision: 'selector-r194',
};

const makeSnapshot = (overrides: Record<string, unknown> = {}) => createLightchainPreSourceSnapshot({
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
  ...overrides,
} as Parameters<typeof createLightchainPreSourceSnapshot>[0]);

const expected = {
  expectedRunId: runId,
  expectedSourceHash: sourceHash,
  expectedVisualArtifactHash: visualHash,
  expectedBackend: selector.backend,
  expectedBrowserSurface: selector.browserSurface,
  expectedSelectorRevision: selector.selectorRevision,
};

test('pre-source snapshot captures, saves once, reloads, hashes, and admits local stub', () => {
  const store = new MapStore();
  const snapshot = makeSnapshot();
  const firstWrite = writeLightchainPreSourceSnapshotOnce(store, 'pre-source:r194', snapshot);

  assert.deepEqual(firstWrite, {
    ok: true,
    wrote: true,
    serialized: serializeLightchainPreSourceSnapshot(snapshot),
  });
  assert.equal(store.writes, 1);

  const repeatedWrite = writeLightchainPreSourceSnapshotOnce(store, 'pre-source:r194', snapshot);
  assert.equal(repeatedWrite.ok, true);
  if (repeatedWrite.ok) assert.equal(repeatedWrite.wrote, false);
  assert.equal(store.writes, 1, 'same snapshot is idempotent and does not rewrite');

  const reloaded = readLightchainPreSourceSnapshot(store, 'pre-source:r194');
  const admission = admitLightchainLocalStub({ snapshot: reloaded, ...expected });
  assert.equal(admission.ok, true);
  if (admission.ok) assert.equal(admission.decision, 'local_stub_admitted');
});

test('pre-source snapshot rejects a changed second write instead of overwriting', () => {
  const store = new MapStore();
  const key = 'pre-source:r194-conflict';
  assert.equal(writeLightchainPreSourceSnapshotOnce(store, key, makeSnapshot()).ok, true);
  const changed = makeSnapshot({ route: '/tools/printing' });
  assert.deepEqual(writeLightchainPreSourceSnapshotOnce(store, key, changed), {
    ok: false,
    blocker: 'lightchain_pre_source_snapshot_conflict',
  });
  assert.equal(store.writes, 1);
});

test('pre-source admission rejects missing, malformed, hash-mismatched, and cross-run snapshots', () => {
  const emptyStore = new MapStore();
  const missing = admitLightchainLocalStub({ snapshot: readLightchainPreSourceSnapshot(emptyStore, 'missing'), ...expected });
  assert.deepEqual(missing, { ok: false, blocker: 'lightchain_pre_source_snapshot_missing' });

  emptyStore.values.set('malformed', '{not-json');
  const malformed = admitLightchainLocalStub({ snapshot: readLightchainPreSourceSnapshot(emptyStore, 'malformed'), ...expected });
  assert.deepEqual(malformed, { ok: false, blocker: 'lightchain_pre_source_snapshot_missing' });

  const hashMismatch = admitLightchainLocalStub({
    snapshot: makeSnapshot(),
    ...expected,
    expectedVisualArtifactHash: hash('d'),
  });
  assert.deepEqual(hashMismatch, { ok: false, blocker: 'lightchain_pre_source_snapshot_hash_mismatch' });

  const runMismatch = admitLightchainLocalStub({
    snapshot: makeSnapshot(),
    ...expected,
    expectedRunId: 'run_heavy_chain_lightchain_pre_source_other',
  });
  assert.deepEqual(runMismatch, { ok: false, blocker: 'lightchain_pre_source_run_mismatch' });
});

test('pre-source admission rejects semantic-empty and visual-blank readback', () => {
  const admission = admitLightchainLocalStub({
    snapshot: makeSnapshot({ semanticState: 'empty', visualState: 'blank' }),
    ...expected,
  });
  assert.deepEqual(admission, { ok: false, blocker: 'lightchain_pre_source_surface_blank' });
});

test('pre-source admission rejects selector drift and external-effect snapshots', () => {
  const selectorMismatch = admitLightchainLocalStub({
    snapshot: makeSnapshot(),
    ...expected,
    expectedSelectorRevision: 'selector-other',
  });
  assert.deepEqual(selectorMismatch, { ok: false, blocker: 'lightchain_pre_source_selector_mismatch' });

  assert.throws(
    () => createLightchainPreSourceSnapshot({
      ...makeSnapshot(),
      externalActionExecuted: true,
    } as unknown as Parameters<typeof createLightchainPreSourceSnapshot>[0]),
    /lightchain_pre_source_external_effect_present/,
  );
});
