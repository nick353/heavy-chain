import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  PARITY_BEHAVIOR_LAYERS,
} from '../src/features/lightchain/parityBehaviorLedger.ts';
import {
  createPendingVideoParityBehaviorLedger,
  validateVideoParityBehaviorLedger,
  VIDEO_PARITY_ROW_IDS,
} from '../src/features/lightchain/videoParityBehaviorLedger.ts';

const artifactPath = new URL('../work/lightchain-video-parity-behavior-ledger-current.json', import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('covers exactly the two canonical video rows and all parity layers', () => {
  const ledger = createPendingVideoParityBehaviorLedger();
  assert.deepEqual(VIDEO_PARITY_ROW_IDS, ['video-workstation', 'video-detail']);
  assert.equal(ledger.length, 2);
  assert.equal(ledger.every((record) => Object.keys(record.layers).length === PARITY_BEHAVIOR_LAYERS.length), true);
});

test('rejects non-video rows and incomplete layer sets', () => {
  const ledger = [...createPendingVideoParityBehaviorLedger()];
  assert.throws(
    () => validateVideoParityBehaviorLedger([
      ...ledger.slice(0, -1),
      { rowId: 'marketing-home' as never, layers: ledger[0].layers },
    ]),
    /video_parity_behavior_non_video_row_forbidden/,
  );
  const missingLayer = { ...ledger[0], layers: { ...ledger[0].layers } };
  delete missingLayer.layers.screen;
  assert.throws(
    () => validateVideoParityBehaviorLedger([missingLayer as never, ledger[1]]),
    /video_parity_behavior_layer_set_invalid/,
  );
});

test('accepts the current video artifact without promoting provider completion', async () => {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as {
    records: unknown;
    evidenceBoundary?: { sourceReadback?: string };
  };
  const records = validateVideoParityBehaviorLedger(artifact.records as never);
  assert.equal(records.length, 2);
  assert.equal(artifact.evidenceBoundary?.sourceReadback, 'work/lightchain-video-route-readback-20260920.md');
  assert.equal(
    records.flatMap((record) => Object.values(record.layers)).some((layer) => layer.status === 'verified-production'),
    false,
  );
  for (const rowId of VIDEO_PARITY_ROW_IDS) {
    const record = records.find((candidate) => candidate.rowId === rowId);
    assert.equal(record?.layers.input.status, 'verified-local');
    assert.equal(record?.layers.screen.status, 'verified-local');
    assert.equal(record?.layers.error.status, 'verified-local');
    for (const layer of ['generation', 'result', 'save', 'reuse', 'performance'] as const) {
      assert.equal(record?.layers[layer].status, 'PENDING_CONFIRMATION', `${rowId}:${layer}`);
    }
  }
});

test('requires every verified video layer to point at an existing evidence artifact', async () => {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as {
    records: Array<{ layers: Record<string, { status: string; evidence: string[] }> }>;
  };
  const records = validateVideoParityBehaviorLedger(artifact.records as never);
  for (const evidencePath of records.flatMap((record) => Object.values(record.layers))
    .filter((layer) => layer.status.startsWith('verified'))
    .flatMap((layer) => layer.evidence)) {
    assert.ok(existsSync(path.resolve(repoRoot, evidencePath)), `missing video parity evidence: ${evidencePath}`);
  }
});
