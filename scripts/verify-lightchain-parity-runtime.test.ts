import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GOAL_CANDIDATE_ROW_IDS } from '../src/features/lightchain/parityContract.ts';
import {
  LIGHTCHAIN_PARITY_SLOT_FIXTURES,
  PARITY_RUNTIME_SCHEMA,
  buildLightchainParityInputRoles,
  buildLightchainParityRuntime,
  serializeLightchainParityRuntime,
} from '../src/features/lightchain/parityRuntime.ts';
import {
  LIGHTCHAIN_ROW_TO_PRODUCT_MAPPING,
  assertFeatureParityMapping,
  getSourceFeatureMappings,
} from '../src/features/lightchain/featureParityMapping.ts';
import {
  HEAVY_PRODUCT_ROUTE_BY_FEATURE_ID,
  resolveHeavyRouteForRow,
} from '../src/features/lightchain/heavyRouteMapping.ts';
import { PRODUCT_CATALOG_OBJECT_IDS } from '../src/features/lightchain/parityContract.ts';

test('accepts every current candidate row without claiming live parity', () => {
  for (const rowId of GOAL_CANDIDATE_ROW_IDS) {
    const fixtureRoles = LIGHTCHAIN_PARITY_SLOT_FIXTURES[rowId];
    const inputRoles = fixtureRoles.length > 0
      ? fixtureRoles.map((role) => rowId === 'fabric-image' && role === 'primary'
        ? 'model-or-design'
        : rowId === 'fabric-image' && role === 'secondary'
          ? 'textile'
          : rowId === 'printing-image' && role === 'primary'
            ? 'garment'
            : rowId === 'printing-image' && role === 'secondary'
              ? 'print-artwork'
              : role)
      : ['brief'];
    const envelope = buildLightchainParityRuntime({ rowId, inputRoles });
    assert.equal(envelope.schema, PARITY_RUNTIME_SCHEMA);
    assert.equal(envelope.rowId, rowId);
    assert.equal(envelope.liveVerdict, 'PENDING_CONFIRMATION');
    assert.equal(envelope.inputKey, null);
    assert.equal(Object.isFrozen(envelope), true);
    assert.equal(Object.isFrozen(envelope.inputRoles), true);
  }
});

test('keeps an exact catalog identity separate from live parity proof', () => {
  const envelope = buildLightchainParityRuntime({
    rowId: 'printing-image',
    inputRoles: ['garment', 'print-artwork'],
  });
  assert.equal(envelope.featureId, 'printing-image');
  assert.equal(envelope.disposition, 'source_identity_exact');
  assert.equal(envelope.reason, 'live_light_heavy_readback_pending');
});

test('uses the explicit feature mapping while keeping live parity pending', () => {
  const envelope = buildLightchainParityRuntime({
    rowId: 'marketing-home',
    inputRoles: ['primary'],
  });
  assert.equal(envelope.featureId, 'marketing-workspace');
  assert.equal(envelope.disposition, 'catalog_mapping_semantic');
  assert.equal(envelope.reason, 'live_light_heavy_readback_pending');
  assert.equal(envelope.liveVerdict, 'PENDING_CONFIRMATION');
  const fittingBackground = buildLightchainParityRuntime({
    rowId: 'fitting-background-reference',
    inputRoles: ['primary'],
  });
  assert.equal(fittingBackground.featureId, 'virtual-fitting');
});

test('creates a deterministic input key only when a mapped fixture is supplied', () => {
  const input = {
    rowId: 'printing-image',
    inputRoles: ['garment', 'print-artwork'],
    fixtureId: 'fixture-printing-001',
    settings: { placement: 'spot', scale: 1 },
  } as const;
  const first = buildLightchainParityRuntime(input);
  const second = buildLightchainParityRuntime({ ...input, settings: { scale: 1, placement: 'spot' } });
  assert.match(first.inputKey ?? '', /^stable-comparison-key\.v1:/);
  assert.equal(first.inputKey, second.inputKey);
  assert.equal(first.liveVerdict, 'PENDING_CONFIRMATION');
  assert.equal(buildLightchainParityRuntime({ rowId: 'model-change', inputRoles: ['primary', 'secondary'], fixtureId: 'fixture-model-change-001' }).inputKey, null);
  assert.equal(buildLightchainParityRuntime({ rowId: 'model-custom', inputRoles: ['brief'], fixtureId: null }).inputKey, null);
});

test('keeps genuinely ambiguous source rows pending instead of inventing a Heavy target', () => {
  const envelope = buildLightchainParityRuntime({
    rowId: 'model-change',
    inputRoles: ['primary', 'secondary'],
  });
  assert.equal(envelope.featureId, null);
  assert.equal(envelope.disposition, 'PENDING_CONFIRMATION');
  assert.equal(envelope.reason, 'row_to_product_catalog_mapping_pending');
});

test('covers every candidate row with a validated mapping record', () => {
  assert.deepEqual(Object.keys(LIGHTCHAIN_ROW_TO_PRODUCT_MAPPING), [...GOAL_CANDIDATE_ROW_IDS]);
  for (const rowId of GOAL_CANDIDATE_ROW_IDS) {
    assert.equal(LIGHTCHAIN_ROW_TO_PRODUCT_MAPPING[rowId].rowId, rowId);
  }
});

test('keeps reverse feature mapping explicit and rejects cross-feature evidence', () => {
  assert.deepEqual(
    getSourceFeatureMappings('marketing-workspace').map((mapping) => mapping.rowId),
    ['marketing-home', 'marketing-detail'],
  );
  assert.deepEqual(getSourceFeatureMappings('change-color'), []);
  assert.equal(assertFeatureParityMapping('marketing-home', 'marketing-workspace').status, 'semantic');
  assert.throws(
    () => assertFeatureParityMapping('marketing-home', 'virtual-fitting'),
    /parity_feature_mapping_mismatch/,
  );
  assert.throws(
    () => assertFeatureParityMapping('model-change', 'model-library'),
    /parity_feature_mapping_pending/,
  );
});

test('derives Heavy entry routes from the mapped product catalog', () => {
  assert.deepEqual(Object.keys(HEAVY_PRODUCT_ROUTE_BY_FEATURE_ID), [...PRODUCT_CATALOG_OBJECT_IDS]);
  assert.equal(resolveHeavyRouteForRow('marketing-home', '/invalid'), '/marketing');
  assert.equal(resolveHeavyRouteForRow('line-generation', '/invalid'), '/generate?feature=design-gacha');
  assert.equal(resolveHeavyRouteForRow('pattern-vector', '/invalid'), '/patterns/workbench');
  assert.equal(resolveHeavyRouteForRow('custom-style', '/invalid'), '/brand/settings');
  assert.match(resolveHeavyRouteForRow('model-library', '/invalid'), /^\/generate\?feature=model-matrix/);
  assert.equal(resolveHeavyRouteForRow('model-change', '/models'), '/models');
  assert.equal(resolveHeavyRouteForRow('angle-change', '/studio'), '/studio');
  assert.equal(resolveHeavyRouteForRow('unknown-row', '/safe-fallback'), '/safe-fallback');
});

test('rejects unknown rows and unsafe or ambiguous input roles', () => {
  assert.throws(
    () => buildLightchainParityRuntime({ rowId: 'invented-row', inputRoles: ['primary'] }),
    /parity_runtime_row_id_unknown/,
  );
  assert.throws(
    () => buildLightchainParityRuntime({ rowId: 'printing-image', inputRoles: [''] }),
    /parity_runtime_input_role_invalid/,
  );
  assert.throws(
    () => buildLightchainParityRuntime({ rowId: 'printing-image', inputRoles: ['primary', 'primary'] }),
    /parity_runtime_input_roles_ambiguous/,
  );
  assert.throws(
    () => buildLightchainParityRuntime({ rowId: 'printing-image', inputRoles: ['https'] }),
    (error) => {
      assert.match((error as Error).message, /parity_runtime_input_role_invalid/);
      assert.doesNotMatch((error as Error).message, /https/);
      return true;
    },
  );
  assert.throws(
    () => buildLightchainParityRuntime({ rowId: 'printing-image', inputRoles: ['primary'.repeat(7)] }),
    (error) => {
      assert.match((error as Error).message, /parity_runtime_input_role_too_long/);
      assert.doesNotMatch((error as Error).message, /primary/);
      return true;
    },
  );
  assert.throws(
    () => buildLightchainParityRuntime({ rowId: 'printing-image', inputRoles: [42 as unknown as string] }),
    /parity_runtime_input_role_invalid/,
  );
  assert.throws(
    () => buildLightchainParityRuntime({ rowId: 'printing-image', inputRoles: [] }),
    /parity_runtime_input_roles_invalid/,
  );
  assert.throws(
    () => buildLightchainParityRuntime({ rowId: 'printing-image', inputRoles: ['Primary', 'primary'] }),
    /parity_runtime_input_roles_ambiguous/,
  );
  assert.throws(
    () => buildLightchainParityRuntime({
      rowId: 'printing-image',
      inputRoles: ['brief', 'primary', 'secondary', 'garment', 'print-artwork', 'model-or-design', 'textile', 'source', 'mask', 'background', 'model', 'design', 'material', 'reference', 'prompt', 'output', 'settings'],
    }),
    /parity_runtime_input_roles_invalid/,
  );
});

test('projects only static slots and has one explicit brief-only row', () => {
  assert.deepEqual(
    buildLightchainParityInputRoles({ rowId: 'model-custom', slots: [] }),
    ['brief'],
  );
  assert.deepEqual(
    buildLightchainParityInputRoles({ rowId: 'model-library', slots: [] }),
    ['brief'],
  );
  assert.deepEqual(
    buildLightchainParityInputRoles({
      rowId: 'printing-image',
      slots: [
        { role: 'primary', required: true, present: false },
        { role: 'secondary', required: false, present: true },
      ],
    }),
    ['garment', 'print-artwork'],
  );
  assert.throws(
    () => buildLightchainParityInputRoles({
      rowId: 'printing-image',
      slots: [
        { role: 'primary', required: false, present: false },
        { role: 'secondary', required: false, present: false },
      ],
    }),
    /parity_runtime_input_roles_missing/,
  );
  assert.deepEqual(
    buildLightchainParityInputRoles({
      rowId: 'model-change',
      slots: [
        { role: 'primary', required: true, present: true },
        { role: 'secondary', required: false, present: false },
      ],
    }),
    ['primary'],
  );
  assert.equal(
    buildLightchainParityRuntime({ rowId: 'model-change', inputRoles: ['primary'] }).rowId,
    'model-change',
  );
  assert.throws(
    () => buildLightchainParityRuntime({ rowId: 'model-change', inputRoles: ['secondary'] }),
    /parity_runtime_input_role_contract_mismatch/,
  );
});

test('keeps the runtime role projection non-empty for every current row shape', () => {
  assert.equal(Object.keys(LIGHTCHAIN_PARITY_SLOT_FIXTURES).length, 33);
  for (const rowId of GOAL_CANDIDATE_ROW_IDS) {
    const fixtureRoles = LIGHTCHAIN_PARITY_SLOT_FIXTURES[rowId];
    assert.equal(Object.isFrozen(fixtureRoles), true, rowId);
    const roles = buildLightchainParityInputRoles({
      rowId,
      slots: fixtureRoles.length === 0
        ? []
        : fixtureRoles.map((role, index) => ({
          role,
          required: index === 0,
          present: false,
        })),
    });
    assert.ok(roles.length > 0, rowId);
  }
  const before = [...LIGHTCHAIN_PARITY_SLOT_FIXTURES['printing-image']];
  try {
    (LIGHTCHAIN_PARITY_SLOT_FIXTURES['printing-image'] as string[]).push('prompt');
  } catch {
    // Frozen arrays may throw in strict mode; either way the value must not change.
  }
  assert.deepEqual(LIGHTCHAIN_PARITY_SLOT_FIXTURES['printing-image'], before);
});

test('rejects row-local input role drift instead of accepting a cross-entry schema', () => {
  assert.throws(
    () => buildLightchainParityRuntime({ rowId: 'printing-image', inputRoles: ['primary', 'secondary'] }),
    /parity_runtime_input_role_contract_mismatch/,
  );
  assert.throws(
    () => buildLightchainParityRuntime({ rowId: 'fabric-image', inputRoles: ['garment', 'print-artwork'] }),
    /parity_runtime_input_role_contract_mismatch/,
  );
  assert.deepEqual(
    buildLightchainParityInputRoles({
      rowId: 'fabric-image',
      slots: [
        { role: 'primary', required: true, present: true },
        { role: 'secondary', required: true, present: true },
      ],
    }),
    ['model-or-design', 'textile'],
  );
});

test('keeps the current Workbench tool source and parity contract in exact row order', () => {
  const source = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const tools: CompatTool[] = [');
  const end = source.indexOf('\n];', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const toolSource = source.slice(start, end);
  const sourceIds = [...toolSource.matchAll(/\n\x20{4}id: '([^']+)',/gu)].map((match) => match[1]);
  assert.deepEqual(sourceIds, [...GOAL_CANDIDATE_ROW_IDS]);
  assert.deepEqual(Object.keys(LIGHTCHAIN_PARITY_SLOT_FIXTURES), [...GOAL_CANDIDATE_ROW_IDS]);
  assert.match(source, /const fixtureId = hasAuthoritativeInput\s*\n\s*\? \[\s*selectedTool\.id,\s*materialSlotFiles\.primary\?\.imageUrl/);
  const routeRows = [...toolSource.matchAll(/\n\x20{2}\{\n([\s\S]*?)\n\x20{2}\},/gu)].map((match) => match[1]);
  const routeMismatches = routeRows.flatMap((block) => {
    const rowId = block.match(/^\x20{4}id: '([^']+)',/mu)?.[1];
    const href = block.match(/^\x20{4}heavyChainHref: '([^']+)',/mu)?.[1];
    if (!rowId || !href) return [`missing_heavy_route:${rowId ?? 'unknown'}`];
    return resolveHeavyRouteForRow(rowId, href) === href ? [] : [rowId];
  });
  assert.deepEqual(routeMismatches, []);
});

test('serializes only fixed JSON metadata and keeps the live verdict pending', () => {
  const envelope = buildLightchainParityRuntime({
    rowId: 'printing-image',
    inputRoles: ['garment', 'print-artwork'],
  });
  const serialized = serializeLightchainParityRuntime(envelope);
  assert.deepEqual(Object.keys(serialized).sort(), [
    'comparatorVersion',
    'contractVersion',
    'disposition',
    'featureId',
    'inputKey',
    'inputRoles',
    'liveVerdict',
    'reason',
    'rowId',
    'schema',
    'source',
  ]);
  assert.deepEqual(serialized.inputRoles, ['garment', 'print-artwork']);
  assert.notEqual(serialized.inputRoles, envelope.inputRoles);
  assert.equal(serialized.liveVerdict, 'PENDING_CONFIRMATION');
  assert.equal(serialized.inputKey, null);
  assert.deepEqual(JSON.parse(JSON.stringify(serialized)), serialized);
});
