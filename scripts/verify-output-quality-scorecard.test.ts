import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertOutputQualityScorecardAccepted,
  createOutputQualityScorecard,
  getRequiredOutputQualityDimensions,
} from '../src/features/lightchain/outputQualityScorecard.ts';

const inputHash = 'input-sha256:fixture-priority-001';
const evidence = {
  lightchain: {
    surface: 'lightchain' as const,
    freshness: 'fresh-same-run' as const,
    runId: 'lightchain-run-001',
    inputHash,
    artifactPath: '/absolute/lightchain-readback.json',
  },
  heavy: {
    surface: 'heavy' as const,
    freshness: 'fresh-same-run' as const,
    runId: 'heavy-run-001',
    inputHash,
    artifactPath: '/absolute/heavy-readback.json',
  },
};

test('keeps a scorecard pending until same-input fresh evidence and review exist', () => {
  const scorecard = createOutputQualityScorecard({
    workflow: 'fabric-print',
    inputHash,
    scores: { apparelFidelity: 4, printPlacement: 4 },
  });
  assert.equal(scorecard.verdict, 'PENDING_CONFIRMATION');
  assert.deepEqual(getRequiredOutputQualityDimensions('fabric-print'), [
    'apparelFidelity',
    'printPlacement',
    'composition',
    'artifacts',
    'commercialUsefulness',
  ]);
});

test('accepts a fabric-print scorecard only when every required dimension clears the threshold', () => {
  const scorecard = createOutputQualityScorecard({
    workflow: 'fabric-print',
    inputHash,
    scores: {
      apparelFidelity: 4,
      printPlacement: 3,
      composition: 3,
      artifacts: 4,
      commercialUsefulness: 3,
    },
    lightchainEvidence: evidence.lightchain,
    heavyEvidence: evidence.heavy,
    reviewedAt: '2026-08-24T12:00:00.000Z',
  });
  assert.equal(scorecard.verdict, 'pass');
  assert.equal(assertOutputQualityScorecardAccepted(scorecard).verdict, 'pass');
});

test('fails rather than hides a weak fitting dimension once evidence is complete', () => {
  const scorecard = createOutputQualityScorecard({
    workflow: 'ai-fitting',
    inputHash,
    scores: {
      apparelFidelity: 4,
      fittingComposition: 2,
      composition: 4,
      artifacts: 4,
      commercialUsefulness: 4,
    },
    lightchainEvidence: evidence.lightchain,
    heavyEvidence: evidence.heavy,
    reviewedAt: '2026-08-24T12:00:00.000Z',
  });
  assert.equal(scorecard.verdict, 'fail');
  assert.throws(() => assertOutputQualityScorecardAccepted(scorecard), /output_quality_scorecard_not_accepted:fail/);
});

test('rejects stale or mismatched evidence instead of promoting it to parity', () => {
  assert.throws(
    () => createOutputQualityScorecard({
      workflow: 'fabric-print',
      inputHash,
      lightchainEvidence: { ...evidence.lightchain, inputHash: 'different-input' },
    }),
    /output_quality_evidence_input_hash_mismatch:lightchain/,
  );
  assert.throws(
    () => createOutputQualityScorecard({
      workflow: 'ai-fitting',
      inputHash,
      heavyEvidence: { ...evidence.heavy, freshness: 'historical' as 'fresh-same-run' },
    }),
    /output_quality_evidence_not_fresh_same_run:heavy/,
  );
});

test('rejects out-of-range scores and unknown dimensions', () => {
  assert.throws(
    () => createOutputQualityScorecard({
      workflow: 'other',
      inputHash,
      scores: { apparelFidelity: 5 as never },
    }),
    /output_quality_score_invalid:apparelFidelity/,
  );
  assert.throws(
    () => createOutputQualityScorecard({
      workflow: 'other',
      inputHash,
      scores: { unknown: 3 } as never,
    }),
    /output_quality_dimension_unknown:unknown/,
  );
});
