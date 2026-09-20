import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  NON_VIDEO_PARITY_ROW_IDS,
  PARITY_BEHAVIOR_LAYERS,
  createPendingParityBehaviorLedger,
  validateParityBehaviorLedger,
} from '../src/features/lightchain/parityBehaviorLedger.ts';

const artifactPath = new URL('../work/lightchain-parity-behavior-ledger-current.json', import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('requires exactly the 31 non-video rows and all eight parity layers', () => {
  const ledger = createPendingParityBehaviorLedger();
  assert.equal(NON_VIDEO_PARITY_ROW_IDS.length, 31);
  assert.equal(ledger.length, 31);
  assert.equal(ledger.every((record) => Object.keys(record.layers).length === 8), true);
  assert.equal(ledger.every((record) => PARITY_BEHAVIOR_LAYERS.every((layer) => record.layers[layer])), true);
  assert.equal(ledger.some((record) => record.rowId.startsWith('video-')), false);
});

test('rejects video rows, missing layers, and incomplete unresolved notes', () => {
  const ledger = [...createPendingParityBehaviorLedger()];
  assert.throws(
    () => validateParityBehaviorLedger([
      ...ledger.slice(0, -1),
      { rowId: 'video-workstation' as never, layers: ledger[0].layers },
    ]),
    /parity_behavior_video_row_forbidden/,
  );
  const missingLayer = { ...ledger[0], layers: { ...ledger[0].layers } } as { rowId: typeof ledger[0]['rowId']; layers: Record<string, unknown> };
  delete missingLayer.layers.screen;
  assert.throws(() => validateParityBehaviorLedger([missingLayer as never, ...ledger.slice(1)]), /parity_behavior_layer_set_invalid/);
  const unresolvedWithoutNote = {
    ...ledger[0],
    layers: {
      ...ledger[0].layers,
      input: { status: 'PENDING_CONFIRMATION', evidence: [], note: '' },
    },
  };
  assert.throws(() => validateParityBehaviorLedger([unresolvedWithoutNote, ...ledger.slice(1)]), /parity_behavior_note_required/);
});

test('accepts the current generated artifact without promoting historical production layers', async () => {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as { records: unknown };
  const records = validateParityBehaviorLedger(artifact.records as never);
  assert.equal(records.length, 31);
  const pendingCount = records.flatMap((record) => Object.values(record.layers))
    .filter((layer) => layer.status === 'PENDING_CONFIRMATION').length;
  assert.ok(pendingCount > 0, 'unverified production layers must remain pending');
  assert.equal(
    records.flatMap((record) => Object.values(record.layers)).some((layer) => layer.status === 'verified-production'),
    false,
    'historical production artifacts must not be current proof',
  );
});

test('keeps the current fresh source readback attached to the ledger artifact', async () => {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as {
    evidenceBoundary?: { sourceReadback?: string };
  };
  assert.equal(
    artifact.evidenceBoundary?.sourceReadback,
    'work/lightchain-source-readback-20260920-r5.md',
  );
});

test('requires every verified layer to point at an existing local evidence artifact', async () => {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as {
    records: Array<{ layers: Record<string, { status: string; evidence: string[] }> }>;
  };
  const records = validateParityBehaviorLedger(artifact.records as never);
  const evidencePaths = records.flatMap((record) => Object.values(record.layers))
    .filter((layer) => layer.status.startsWith('verified'))
    .flatMap((layer) => layer.evidence);
  assert.ok(evidencePaths.length > 0);
  for (const evidencePath of evidencePaths) {
    assert.ok(
      existsSync(path.resolve(repoRoot, evidencePath)),
      `missing parity evidence artifact: ${evidencePath}`,
    );
  }
});

test('keeps the current local input evidence separate from unresolved production layers', async () => {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as {
    records: Array<{ layers: Record<string, { status: string; evidence: string[] }> }>;
  };
  const records = validateParityBehaviorLedger(artifact.records as never);
  const localInputs = records.map((record) => record.layers.input);
  const verifiedLocalInputs = localInputs.filter((layer) => layer.status === 'verified-local');
  assert.equal(verifiedLocalInputs.length, 31);
  assert.equal(verifiedLocalInputs.every((layer) => layer.evidence.includes('work/heavy-local-workflow-lifecycle-retry-readback-20260821-r209.md')), true);
  assert.equal(records.find((record) => record.rowId === 'fabric-image')?.layers.input.status, 'verified-local');
  assert.equal(records.every((record) => record.layers.screen.status === 'verified-local'), true);
  assert.equal(records.every((record) => record.layers.screen.evidence.includes('work/heavy-local-all-feature-verification-20260824-r4.md')), true);
  assert.deepEqual(records.find((record) => record.rowId === 'fabric-image')?.layers.input.evidence, ['work/heavy-local-workflow-lifecycle-retry-readback-20260821-r209.md']);
  for (const rowId of ['fabric-image', 'printing-image', 'ai-fitting']) {
    const record = records.find((candidate) => candidate.rowId === rowId);
    for (const layer of ['generation', 'result', 'save', 'reuse']) {
      assert.equal(record?.layers[layer].status, 'verified-local', `${rowId}:${layer}`);
      const evidence = rowId === 'printing-image'
        ? 'work/heavy-printing-priority-workflow-contracts-20260826-r134.md'
        : 'work/heavy-priority-workflow-contracts-20260826-r132.md';
      assert.deepEqual(record?.layers[layer].evidence, [evidence]);
    }
    assert.equal(record?.layers.error.status, 'verified-local', `${rowId}:error`);
    assert.deepEqual(record?.layers.error.evidence, ['work/heavy-priority-error-recovery-contracts-20260826-r135.md']);
  }
    for (const rowId of ['fabric-image', 'ai-fitting']) {
      const record = records.find((candidate) => candidate.rowId === rowId);
      assert.equal(record?.layers.performance.status, 'verified-local', `${rowId}:performance`);
      assert.deepEqual(record?.layers.performance.evidence, ['work/heavy-local-priority-performance-qa-20260826-r137.md']);
    }
    const printing = records.find((record) => record.rowId === 'printing-image');
    assert.equal(printing?.layers.performance.status, 'verified-local');
    assert.deepEqual(printing?.layers.performance.evidence, ['work/heavy-local-priority-performance-qa-20260826-r138.md']);
});
