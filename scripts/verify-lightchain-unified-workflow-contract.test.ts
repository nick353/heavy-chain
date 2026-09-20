import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GOAL_CANDIDATE_ROW_IDS,
} from '../src/features/lightchain/parityContract.ts';
import {
  lightchainUnifiedFeatureCatalog,
} from '../src/lib/lightchainUnifiedFeatureCatalog.ts';
import {
  LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT,
  UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION,
  UNIFIED_RIGHTS_GATE,
  UNIFIED_RESULT_DESTINATIONS,
  UNIFIED_WORKFLOW_LIFECYCLE,
} from '../src/features/lightchain/unifiedFeatureWorkflowContract.ts';
import {
  deriveUnifiedWorkspaceFlowState,
  unifiedWorkspaceFlowLabels,
} from '../src/lib/unifiedWorkspaceFlow.ts';

const videoRows = new Set(['video-workstation', 'video-detail']);
const nonVideoRows = GOAL_CANDIDATE_ROW_IDS.filter((rowId) => !videoRows.has(rowId));

test('defines one common workflow contract for every video-excluded feature', () => {
  assert.equal(nonVideoRows.length, 31);
  assert.equal(lightchainUnifiedFeatureCatalog.length, 31);
  assert.deepEqual(
    Object.keys(LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT),
    lightchainUnifiedFeatureCatalog.map((feature) => feature.id),
  );

  for (const rowId of nonVideoRows) {
    const contract = LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT[rowId];
    assert.ok(contract, rowId);
    assert.equal(contract.contractVersion, UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION, rowId);
    assert.notEqual(contract.providerRoute, 'unsupported', rowId);
    assert.ok(contract.inputRoles.length > 0, rowId);
    assert.deepEqual(contract.resultDestinations, UNIFIED_RESULT_DESTINATIONS, rowId);
    assert.deepEqual(contract.lifecycle, UNIFIED_WORKFLOW_LIFECYCLE, rowId);
    assert.equal(contract.sourceInputMode, 'library-or-upload', rowId);
    assert.equal(contract.rightsGate, UNIFIED_RIGHTS_GATE, rowId);
    assert.deepEqual(contract.retry, {
      retainsLastCompletedResult: true,
      preservesInputLineage: true,
      blocksDuplicateSubmit: true,
    }, rowId);
  }
});

test('keeps priority input roles semantic and stable', () => {
  assert.deepEqual(
    LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT['fabric-image'].inputRoles,
    ['model-or-design', 'textile'],
  );
  assert.deepEqual(
    LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT['printing-image'].inputRoles,
    ['garment', 'print-artwork'],
  );
  assert.deepEqual(
    LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT['ai-fitting'].inputRoles,
    ['primary'],
  );
  assert.deepEqual(
    LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT['model-library'].inputRoles,
    ['brief'],
  );
});

test('applies the same deterministic lifecycle vocabulary to every non-video row', () => {
  const lifecycleCases = [
    [{ inputReady: false, rightsReady: false, generating: false, completed: false, failed: false }, 'draft'],
    [{ inputReady: true, rightsReady: true, generating: false, completed: false, failed: false }, 'ready'],
    [{ inputReady: true, rightsReady: true, generating: true, completed: false, failed: false }, 'generating'],
    [{ inputReady: true, rightsReady: true, generating: false, completed: true, failed: false }, 'completed'],
    [{ inputReady: true, rightsReady: true, generating: false, completed: true, failed: true }, 'failed'],
  ] as const;

  for (const rowId of nonVideoRows) {
    const contract = LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT[rowId];
    assert.ok(contract, rowId);
    assert.deepEqual(contract.lifecycle, UNIFIED_WORKFLOW_LIFECYCLE, rowId);
    for (const [signals, expected] of lifecycleCases) {
      assert.equal(deriveUnifiedWorkspaceFlowState(signals), expected, rowId);
      assert.ok(unifiedWorkspaceFlowLabels[expected], rowId);
    }
  }
});

test('does not promote historical production readbacks into current feature evidence', () => {
  for (const rowId of ['ai-fitting', 'fabric-image', 'printing-image']) {
    const feature = lightchainUnifiedFeatureCatalog.find((candidate) => candidate.id === rowId);
    assert.ok(feature, rowId);
    assert.match(feature.evidence, /PENDING_CONFIRMATION/);
    assert.doesNotMatch(feature.evidence, /production.*readback\s+r\d+/i);
  }
});

test('makes the Workbench consume the shared contract instead of a route fallback', () => {
  const workbench = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(workbench, /getLightchainUnifiedFeatureWorkflowContract\(selectedTool\.id\)/);
  assert.match(workbench, /data-workflow-contract=\{UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION\}/);
  assert.match(workbench, /data-workflow-input-roles=\{selectedFeatureWorkflow\?\.inputRoles\.join\(','\) \?\? ''\}/);
  assert.match(workbench, /data-workflow-result-destinations=\{selectedFeatureWorkflow\?\.resultDestinations\.join\(','\) \?\? ''\}/);
  assert.match(workbench, /data-workflow-rights-gate=\{workflowRightsGate\}/);
  assert.doesNotMatch(workbench, /const lightchainProviderRoute = getLightchainProviderRoute\(selectedTool\.id\)/);
});

test('keeps video definitions out of the visible unified beta workbench', () => {
  const workbench = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

  assert.match(
    workbench,
    /const visibleTools = tools\.filter\(\(tool\) => !tool\.id\.startsWith\('video-'\)\);/,
  );
  assert.match(workbench, /const selectedTool = routeTool \?\? visibleTools\.find/);
  assert.match(workbench, /visibleTools\.filter\(\(tool\) => tool\.category/);
  assert.match(workbench, /\{filteredTools\.map\(\(tool, index\) =>/);
  assert.match(workbench, /video-workstation.*video-detail/);
});
