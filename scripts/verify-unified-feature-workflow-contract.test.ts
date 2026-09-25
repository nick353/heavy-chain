import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT,
  UNIFIED_RESULT_DESTINATIONS,
  UNIFIED_WORKFLOW_LIFECYCLE,
  UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION,
} from '../src/features/lightchain/unifiedFeatureWorkflowContract.ts';
import { GOAL_CANDIDATE_ROW_IDS } from '../src/features/lightchain/parityContract.ts';

const NON_VIDEO_GOAL_CANDIDATE_ROW_IDS = GOAL_CANDIDATE_ROW_IDS.filter(
  (rowId) => rowId !== 'video-workstation' && rowId !== 'video-detail',
);

test('every non-video Light Chain row has one shared workflow contract', () => {
  const ids = Object.keys(LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT).sort();
  assert.deepEqual(ids, [...NON_VIDEO_GOAL_CANDIDATE_ROW_IDS].sort());
  for (const rowId of NON_VIDEO_GOAL_CANDIDATE_ROW_IDS) {
    const contract = LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT[rowId];
    assert.equal(contract.contractVersion, UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION);
    assert.ok(contract.providerRoute !== 'unsupported');
    assert.ok(contract.inputRoles.length > 0);
    assert.deepEqual(contract.resultDestinations, UNIFIED_RESULT_DESTINATIONS);
    assert.deepEqual(contract.lifecycle, UNIFIED_WORKFLOW_LIFECYCLE);
    assert.equal(contract.sourceInputMode, 'library-or-upload');
    assert.equal(contract.retry.retainsLastCompletedResult, true);
    assert.equal(contract.retry.preservesInputLineage, true);
    assert.equal(contract.retry.blocksDuplicateSubmit, true);
  }
});

test('video rows remain excluded from the non-video shared contract', () => {
  assert.equal('video-workstation' in LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT, false);
  assert.equal('video-detail' in LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT, false);
});
