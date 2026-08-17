import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GOAL_CANDIDATE_ROW_IDS,
  PARITY_COMPARATOR_VERSION,
  PARITY_CONTRACT_VERSION,
  PRODUCT_CATALOG_OBJECT_IDS,
  createParityComparisonKey,
  normalizeParityInput,
  validateRowDispositionTable,
} from '../src/features/lightchain/parityContract.ts';
import {
  PARITY_EVIDENCE_SCHEMA,
  assertParityEvidenceComplete,
  createParityEvidenceRecord,
  serializeParityEvidence,
} from '../src/features/lightchain/parityEvidence.ts';

const input = {
  featureId: 'printing-image',
  rowId: 'printing-image',
  fixtureId: 'fixture-printing-001',
  inputOrder: ['model', 'material'],
  settings: {
    aspectRatio: '  2:3  ',
    preserveSubject: true,
    nested: { strength: 0.75, mode: 'asset' },
  },
} as const;

test('freezes the current 33-row and 30-object source projections', () => {
  assert.equal(GOAL_CANDIDATE_ROW_IDS.length, 33);
  assert.equal(PRODUCT_CATALOG_OBJECT_IDS.length, 30);
  assert.equal(new Set(GOAL_CANDIDATE_ROW_IDS).size, 33);
  assert.equal(new Set(PRODUCT_CATALOG_OBJECT_IDS).size, 30);
  assert.ok(GOAL_CANDIDATE_ROW_IDS.includes('video-detail'));
  assert.ok(PRODUCT_CATALOG_OBJECT_IDS.includes('case-sns-video'));
});

test('normalizes the same semantic input to one deterministic comparison key', () => {
  const normalized = normalizeParityInput(input);
  const equivalent = {
    ...input,
    fixtureId: 'fixture-printing-001',
    settings: { nested: { mode: 'asset', strength: 0.75 }, preserveSubject: true, aspectRatio: '2:3' },
  } as const;
  assert.equal(normalized.settings.aspectratio, '2:3');
  assert.equal(createParityComparisonKey(input), createParityComparisonKey(equivalent));
  assert.match(createParityComparisonKey(input), new RegExp(`^${PARITY_COMPARATOR_VERSION}:`));
  assert.equal(normalized.featureId, 'printing-image');
});

test('keeps input order meaningful and rejects ambiguous or unknown inputs', () => {
  assert.notEqual(
    createParityComparisonKey(input),
    createParityComparisonKey({ ...input, inputOrder: ['material', 'model'] }),
  );
  assert.throws(() => normalizeParityInput({ ...input, rowId: 'invented-row' }), /parity_row_id_unknown/);
  assert.throws(() => normalizeParityInput({ ...input, inputOrder: ['model', 'model'] }), /parity_input_order_ambiguous/);
  assert.throws(() => normalizeParityInput({ ...input, settings: { value: Number.NaN } }), /parity_setting_number_invalid/);
});

test('requires every candidate row and preserves unresolved dispositions', () => {
  const table = GOAL_CANDIDATE_ROW_IDS.map((rowId) => ({
    rowId,
    disposition: 'PENDING_CONFIRMATION' as const,
  }));
  const validated = validateRowDispositionTable(table);
  assert.equal(validated.length, 33);
  assert.equal(validated.every((row) => row.disposition === 'PENDING_CONFIRMATION'), true);
  assert.throws(() => validateRowDispositionTable(table.slice(1)), /parity_row_disposition_count_invalid/);
  assert.throws(
    () => validateRowDispositionTable([...table.slice(0, -1), { rowId: 'invented-row', disposition: 'confirmed' }]),
    /parity_row_disposition_row_unknown/,
  );
});

test('rejects an invented merge target instead of silently creating a mapping', () => {
  const table = GOAL_CANDIDATE_ROW_IDS.map((rowId) => ({ rowId, disposition: 'PENDING_CONFIRMATION' as const }));
  table[0] = { rowId: table[0].rowId, disposition: 'merged', productObjectId: 'invented-object' };
  assert.throws(() => validateRowDispositionTable(table), /parity_product_object_id_unknown/);
});

test('creates a provenance-bearing pending evidence record without claiming parity', () => {
  const record = createParityEvidenceRecord(input, {
    surface: 'result',
    inputHash: 'sha256:fixture-printing-001',
    verdict: 'PENDING_CONFIRMATION',
    runId: 'goal-run-001',
    source: 'local-contract-fixture',
    recordedAt: '2026-08-11T17:00:00Z',
  });
  assert.equal(record.schema, PARITY_EVIDENCE_SCHEMA);
  assert.equal(record.contractVersion, PARITY_CONTRACT_VERSION);
  assert.equal(record.lightKey, null);
  assert.equal(record.heavyKey, null);
  assert.throws(() => assertParityEvidenceComplete(record), /parity_evidence_pending/);
  assert.match(serializeParityEvidence(record), /"verdict":"PENDING_CONFIRMATION"/);
});

test('keeps result quality as an explicit evidence surface', () => {
  const record = createParityEvidenceRecord(input, {
    surface: 'quality',
    inputHash: 'sha256:fixture-printing-001',
    verdict: 'PENDING_CONFIRMATION',
    runId: 'goal-run-quality-pending',
    source: 'same-input-quality-review',
    recordedAt: '2026-08-11T17:05:00Z',
  });
  assert.equal(record.surface, 'quality');
  assert.throws(() => assertParityEvidenceComplete(record), /parity_evidence_pending/);
});

test('does not create evidence for a cross-feature or unresolved row mapping', () => {
  assert.throws(
    () => createParityEvidenceRecord({ ...input, featureId: 'virtual-fitting', rowId: 'marketing-home' }, {
      surface: 'result',
      inputHash: 'sha256:fixture-marketing-001',
      verdict: 'PENDING_CONFIRMATION',
      runId: 'goal-run-mismatch',
      source: 'local-contract-fixture',
      recordedAt: '2026-08-11T17:03:00Z',
    }),
    /parity_feature_mapping_mismatch/,
  );
  assert.throws(
    () => createParityEvidenceRecord({ ...input, featureId: 'model-library', rowId: 'model-change' }, {
      surface: 'result',
      inputHash: 'sha256:fixture-model-change-001',
      verdict: 'PENDING_CONFIRMATION',
      runId: 'goal-run-pending',
      source: 'local-contract-fixture',
      recordedAt: '2026-08-11T17:04:00Z',
    }),
    /parity_feature_mapping_pending/,
  );
});

test('only equal identical keys and different unequal keys can be resolved', () => {
  const equal = createParityEvidenceRecord(input, {
    surface: 'canvas',
    inputHash: 'sha256:fixture-printing-001',
    lightKey: 'light-output-key',
    heavyKey: 'light-output-key',
    verdict: 'equal',
    runId: 'goal-run-002',
    source: 'same-run-readback',
    recordedAt: '2026-08-11T17:01:00Z',
  });
  assert.equal(assertParityEvidenceComplete(equal), equal);
  assert.throws(() => createParityEvidenceRecord(input, {
    surface: 'download', inputHash: 'sha256:x', lightKey: 'a', heavyKey: 'b', verdict: 'equal',
    runId: 'run', source: 'test', recordedAt: '2026-08-11T17:02:00Z',
  }), /parity_equal_keys_mismatch/);
  assert.throws(() => createParityEvidenceRecord(input, {
    surface: 'download', inputHash: 'sha256:x', lightKey: 'a', heavyKey: 'a', verdict: 'different',
    runId: 'run', source: 'test', recordedAt: '2026-08-11T17:02:00Z',
  }), /parity_different_keys_match/);
});
