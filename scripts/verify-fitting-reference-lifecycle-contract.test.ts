import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  GOAL_CANDIDATE_ROW_IDS,
} from '../src/features/lightchain/parityContract.ts';
import {
  LIGHTCHAIN_PARITY_SLOT_FIXTURES,
  buildLightchainParityInputRoles,
  buildLightchainParityRuntime,
  getLightchainParityExpectedInputRoles,
} from '../src/features/lightchain/parityRuntime.ts';
import {
  getFeatureParityMapping,
} from '../src/features/lightchain/featureParityMapping.ts';
import {
  getLightchainProviderRoute,
} from '../src/features/lightchain/providerAdapter.ts';
import {
  resolveHeavyRouteForRow,
} from '../src/features/lightchain/heavyRouteMapping.ts';
import {
  LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT,
  UNIFIED_RESULT_DESTINATIONS,
  UNIFIED_RIGHTS_GATE,
  UNIFIED_WORKFLOW_LIFECYCLE,
} from '../src/features/lightchain/unifiedFeatureWorkflowContract.ts';
import {
  NON_VIDEO_PARITY_ROW_IDS,
  PARITY_BEHAVIOR_LAYERS,
  validateParityBehaviorLedger,
} from '../src/features/lightchain/parityBehaviorLedger.ts';
import {
  buildLightchainLibraryFeatureHref,
} from '../src/lib/lightchainLibraryHandoff.ts';
import {
  lightchainUnifiedFeatureCatalog,
} from '../src/lib/lightchainUnifiedFeatureCatalog.ts';
import {
  buildLightchainProviderPrompt,
} from '../src/features/lightchain/providerAdapter.ts';

const TARGET_ROWS = [
  'ai-fitting-reference',
  'fitting-clothing-reference',
  'fitting-background-reference',
] as const;

const EXPECTED_ROWS = {
  'ai-fitting-reference': {
    productObjectId: 'virtual-fitting',
    deepRoute: '/model?tab=参考図',
    providerRoute: 'model-matrix',
  },
  'fitting-clothing-reference': {
    productObjectId: 'flat-to-model',
    deepRoute: '/model/clothing',
    providerRoute: 'edit-image',
  },
  'fitting-background-reference': {
    productObjectId: 'virtual-fitting',
    deepRoute: '/model/background-reference',
    providerRoute: 'edit-image',
  },
} as const;

const workbenchSource = await readFile(
  new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url),
  'utf8',
);

test('freezes the current catalog IDs for exactly the three fitting-reference rows', () => {
  const catalogIds = lightchainUnifiedFeatureCatalog.map((feature) => feature.id);

  assert.deepEqual(
    TARGET_ROWS.filter((rowId) => (GOAL_CANDIDATE_ROW_IDS as readonly string[]).includes(rowId)),
    TARGET_ROWS,
  );
  assert.equal(new Set(catalogIds).size, catalogIds.length);

  for (const rowId of TARGET_ROWS) {
    const feature = lightchainUnifiedFeatureCatalog.find((candidate) => candidate.id === rowId);
    assert.ok(feature, rowId);
    assert.equal(feature.route, `/lightchain/${rowId}`);
    assert.equal(feature.category, 'fitting');
  }
});

test('keeps the three canonical deep-route contexts distinct from the fitting fallback', () => {
  for (const rowId of TARGET_ROWS) {
    const expected = EXPECTED_ROWS[rowId];
    assert.equal(resolveHeavyRouteForRow(rowId, '/fitting'), expected.deepRoute, rowId);
    assert.notEqual(expected.deepRoute, '/fitting', rowId);
  }

  assert.match(workbenchSource, /lightchainRoute: '\/model\?tab=参考図'/);
  assert.match(workbenchSource, /lightchainRoute: '\/model\/clothing'/);
  assert.match(workbenchSource, /lightchainRoute: '\/model\/background-reference'/);
  assert.match(workbenchSource, /const isModelReferenceRoute = isModelRoute && searchParams\.get\('tab'\) === '参考図'/);
  assert.match(workbenchSource, /'\/model\/clothing': 'fitting-clothing-reference'/);
  assert.match(workbenchSource, /'\/model\/background-reference': 'fitting-background-reference'/);
});

test('keeps semantic catalog mappings and provider routes explicit', () => {
  for (const rowId of TARGET_ROWS) {
    const expected = EXPECTED_ROWS[rowId];
    const mapping = getFeatureParityMapping(rowId);

    assert.ok(mapping, rowId);
    assert.equal(mapping.status, 'semantic', rowId);
    assert.equal(mapping.productObjectId, expected.productObjectId, rowId);
    assert.equal(getLightchainProviderRoute(rowId), expected.providerRoute, rowId);
    assert.notEqual(getLightchainProviderRoute(rowId), 'unsupported', rowId);
  }
});

test('uses one primary input fixture and preserves its runtime lineage', () => {
  const fixtureId = 'fixture-fitting-reference-primary-v1';

  for (const rowId of TARGET_ROWS) {
    const expected = EXPECTED_ROWS[rowId];
    const mapping = getFeatureParityMapping(rowId);
    assert.ok(mapping?.productObjectId, rowId);

    assert.deepEqual(LIGHTCHAIN_PARITY_SLOT_FIXTURES[rowId], ['primary'], rowId);
    assert.deepEqual(getLightchainParityExpectedInputRoles(rowId), ['primary'], rowId);
    assert.deepEqual(buildLightchainParityInputRoles({
      rowId,
      slots: [{ role: 'primary', required: true, present: true }],
    }), ['primary'], rowId);

    const runtime = buildLightchainParityRuntime({
      rowId,
      inputRoles: ['primary'],
      fixtureId,
      settings: { source: 'primary-fixture' },
    });
    assert.equal(runtime.rowId, rowId);
    assert.equal(runtime.featureId, expected.productObjectId);
    assert.equal(runtime.disposition, 'catalog_mapping_semantic');
    assert.equal(runtime.liveVerdict, 'PENDING_CONFIRMATION');
    assert.ok(runtime.inputKey, rowId);

    const prompt = buildLightchainProviderPrompt({
      toolId: rowId,
      toolTitle: rowId,
      summary: 'fitting reference fixture contract',
      primaryName: fixtureId,
    });
    assert.match(prompt, new RegExp(`LIGHTCHAIN ROUTE: ${rowId}`));
    assert.match(prompt, new RegExp(`PRIMARY INPUT: ${fixtureId}`));
  }
});

test('shares lifecycle, destinations, rights, and retry invariants across the target rows', () => {
  for (const rowId of TARGET_ROWS) {
    const contract = LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT[rowId];
    assert.ok(contract, rowId);
    assert.deepEqual(contract.lifecycle, UNIFIED_WORKFLOW_LIFECYCLE, rowId);
    assert.deepEqual(contract.resultDestinations, UNIFIED_RESULT_DESTINATIONS, rowId);
    assert.equal(contract.sourceInputMode, 'library-or-upload', rowId);
    assert.equal(contract.rightsGate, UNIFIED_RIGHTS_GATE, rowId);
    assert.deepEqual(contract.retry, {
      retainsLastCompletedResult: true,
      preservesInputLineage: true,
      blocksDuplicateSubmit: true,
    }, rowId);
  }
});

test('keeps the generation-time rights gate request-local and fail-closed', () => {
  assert.match(workbenchSource, /data-workflow-rights-gate=\{workflowRightsGate\}/);
  assert.match(
    workbenchSource,
    /const rightsConfirmedForRequest = providerRightsConfirmed \|\| options\?\.rightsAlreadyConfirmed === true;/,
  );
  assert.match(workbenchSource, /const \[providerRightsConfirmed, setProviderRightsConfirmed\] = useState\(true\)/);
  assert.doesNotMatch(workbenchSource, /rightsConfirmationOpen|pendingRightsGenerationRef|権利を確認してAI生成/);
});

test('retains completed results, input lineage, and duplicate-submit protection on retry', () => {
  const handlerStart = workbenchSource.indexOf('const handleLightchainPreviewGenerate = async');
  const handler = workbenchSource.slice(handlerStart, handlerStart + 20_000);
  const requestStart = handler.indexOf('const requestId = ++lightchainGenerationSequenceRef.current;');

  assert.ok(handlerStart >= 0, 'shared provider generation handler must remain discoverable');
  assert.ok(requestStart >= 0, 'request sequence must remain discoverable');
  assert.match(handler, /if \(lightchainGenerationRequestRef\.current !== null \|\| lightchainGenerationRunning\) return;/);
  assert.match(handler, /const requestId = \+\+lightchainGenerationSequenceRef\.current;/);
  assert.match(handler, /lightchainGenerationRequestRef\.current = requestId;/);
  assert.doesNotMatch(handler.slice(0, requestStart), /setLightchainResult\(null\)/);
  assert.match(handler, /buildCurrentParityRuntime\(\)/);
  assert.match(handler, /lightchainCompat = \{/);
  assert.match(handler, /lightchainFeatureId: selectedTool\.id/);
  assert.match(handler, /lightchainGenerationRequestRef\.current = null;\s*setLightchainGenerationRunning\(false\)/);
});

test('excludes video rows from the unified catalog and provider contract', () => {
  assert.ok((GOAL_CANDIDATE_ROW_IDS as readonly string[]).includes('video-workstation'));
  assert.ok((GOAL_CANDIDATE_ROW_IDS as readonly string[]).includes('video-detail'));
  assert.equal(NON_VIDEO_PARITY_ROW_IDS.length, 31);
  assert.equal(NON_VIDEO_PARITY_ROW_IDS.some((rowId) => rowId.startsWith('video-')), false);
  assert.equal(lightchainUnifiedFeatureCatalog.some((feature) => feature.id.startsWith('video-')), false);
  assert.equal(LIGHTCHAIN_UNIFIED_FEATURE_WORKFLOW_CONTRACT['video-workstation' as never], undefined);
  assert.equal(getLightchainProviderRoute('video-workstation'), 'unsupported');
  assert.equal(getLightchainProviderRoute('video-detail'), 'unsupported');
  assert.match(workbenchSource, /const visibleTools = tools\.filter\(\(tool\) => !tool\.id\.startsWith\('video-'\)\);/);
});

test('keeps the current ledger at 31 records, 31 non-video rows, eight layers, and zero verified production', async () => {
  const artifact = JSON.parse(await readFile(
    new URL('../work/lightchain-parity-behavior-ledger-current.json', import.meta.url),
    'utf8',
  )) as {
    scope: {
      sourceCandidateRows: number;
      nonVideoRows: number;
      excludedVideoRows: string[];
      layers: string[];
    };
    records: unknown;
  };
  const records = validateParityBehaviorLedger(artifact.records as never);

  assert.equal(artifact.scope.sourceCandidateRows, 33);
  assert.equal(artifact.scope.nonVideoRows, 31);
  assert.deepEqual(artifact.scope.excludedVideoRows, ['video-workstation', 'video-detail']);
  assert.deepEqual(artifact.scope.layers, PARITY_BEHAVIOR_LAYERS);
  assert.equal(records.length, 31);
  assert.equal(records.every((record) => Object.keys(record.layers).length === 8), true);

  const layers = records.flatMap((record) => Object.values(record.layers));
  assert.equal(layers.filter((layer) => layer.status === 'verified-production').length, 0);
  assert.equal(layers.filter((layer) => layer.status === 'verified-local').length, 80);
  assert.equal(layers.filter((layer) => layer.status === 'PENDING_CONFIRMATION').length, 168);

  const priorityRows = new Set(['ai-fitting', 'fabric-image', 'printing-image']);
  for (const record of records) {
    assert.equal(record.layers.input.status, 'verified-local', record.rowId);
    assert.equal(record.layers.screen.status, 'verified-local', record.rowId);
    for (const layer of ['generation', 'result', 'save', 'reuse', 'error', 'performance'] as const) {
      const expectedStatus = priorityRows.has(record.rowId) ? 'verified-local' : 'PENDING_CONFIRMATION';
      assert.equal(record.layers[layer].status, expectedStatus, `${record.rowId}:${layer}`);
    }
  }
});

test('keeps deep-route and library-handoff contexts distinct while retaining libraryArtifactId', () => {
  const artifactId = 'library-artifact-fitting-reference-001';

  for (const rowId of TARGET_ROWS) {
    const feature = lightchainUnifiedFeatureCatalog.find((candidate) => candidate.id === rowId);
    assert.ok(feature, rowId);
    const handoff = buildLightchainLibraryFeatureHref(feature, artifactId);
    const parsed = new URL(handoff, 'https://heavy-chain.local');

    assert.equal(parsed.searchParams.get('libraryArtifactId'), artifactId, rowId);
    assert.notEqual(handoff, EXPECTED_ROWS[rowId].deepRoute, rowId);
  }

  const referenceFeature = lightchainUnifiedFeatureCatalog.find((feature) => feature.id === 'ai-fitting-reference');
  assert.ok(referenceFeature);
  assert.equal(
    buildLightchainLibraryFeatureHref(referenceFeature, artifactId),
    `/fitting?libraryArtifactId=${artifactId}`,
  );
  assert.equal(resolveHeavyRouteForRow('ai-fitting-reference', '/fitting'), '/model?tab=参考図');
  assert.notEqual('/model?tab=参考図', '/fitting');

  const clothingFeature = lightchainUnifiedFeatureCatalog.find((feature) => feature.id === 'fitting-clothing-reference');
  const backgroundFeature = lightchainUnifiedFeatureCatalog.find((feature) => feature.id === 'fitting-background-reference');
  assert.ok(clothingFeature);
  assert.ok(backgroundFeature);
  assert.equal(
    buildLightchainLibraryFeatureHref(clothingFeature, artifactId),
    `/lightchain/fitting-clothing-reference?libraryArtifactId=${artifactId}`,
  );
  assert.equal(
    buildLightchainLibraryFeatureHref(backgroundFeature, artifactId),
    `/lightchain/fitting-background-reference?libraryArtifactId=${artifactId}`,
  );
  assert.match(workbenchSource, /const libraryArtifactId = searchParams\.get\('libraryArtifactId'\);/);
  assert.match(workbenchSource, /candidate\.id === libraryArtifactId/);
  assert.match(workbenchSource, /setMaterialSlotFiles\(\{ primary: nextItem, secondary: null \}\)/);
});
