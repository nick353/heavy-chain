import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = join(root, 'work/heavy-image-acceptance-ledger-20260929-r1.json');
const inventoryPath = join(root, 'work/heavy-image-feature-inventory-20260929-r1.json');
const marketingEvidencePath = join(root, 'work/heavy-marketing-home-live-readback-20260929-r2.json');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('keeps the image-only acceptance ledger complete and video-free', () => {
  assert.equal(existsSync(ledgerPath), true);
  assert.equal(existsSync(inventoryPath), true);
  const ledger = readJson(ledgerPath);
  const inventory = readJson(inventoryPath);
  const expectedIds = Object.values(inventory.featureIdsByProviderRoute).flat();
  assert.equal(ledger.schema, 'heavy_chain.image_acceptance_ledger.v1');
  assert.equal(ledger.scope.imageRows, 31);
  assert.equal(ledger.scope.videoRows, 0);
  assert.deepEqual(ledger.rows.map((row) => row.id), expectedIds);
  assert.equal(ledger.rows.some((row) => row.id.startsWith('video-')), false);
  for (const row of ledger.rows) {
    assert.ok(['edit-image', 'model-matrix'].includes(row.providerRoute), row.id);
    assert.equal(row.status, 'unproven', row.id);
  }
});

test('does not overclaim marketing-home while preserving its cross-surface evidence', () => {
  const ledger = readJson(ledgerPath);
  const evidence = readJson(marketingEvidencePath);
  const row = ledger.rows.find((candidate) => candidate.id === 'marketing-home');
  assert.ok(row);
  assert.equal(row.status, 'unproven');
  assert.equal(row.progress, 'provider_succeeded_cross_surface_persisted_reload_reused');
  assert.equal(evidence.status, 'provider_succeeded_cross_surface_persisted_reload_reused');
  assert.equal(evidence.provider.generationDispatches, 1);
  assert.equal(evidence.crossSurface.canvas.assetReuseWithoutNewGeneration, true);
  assert.deepEqual(evidence.remainingForFullRowAcceptance, [
    'same-row deterministic provider failure boundary and retry/readback evidence',
    'repeat the same evidence for the remaining 30 image rows',
  ]);
});

test('keeps deferred surfaces outside the image acceptance target', () => {
  const ledger = readJson(ledgerPath);
  assert.deepEqual(ledger.deferred, ['video', 'billing', 'publication', 'monitor credential provisioning']);
  assert.equal(ledger.stopConditions.includes('rights/terms/attestation UI appears'), true);
  assert.equal(ledger.stopConditions.includes('billing/publication/video surface is entered'), true);
});
