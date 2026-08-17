import {
  PARITY_COMPARATOR_VERSION,
  PARITY_CONTRACT_VERSION,
  createParityComparisonKey,
  isGoalCandidateRowId,
  type GoalCandidateRowId,
  type ParityJsonValue,
  type ProductCatalogObjectId,
} from './parityContract.ts';
import { getFeatureParityMapping } from './featureParityMapping.ts';
import type { Json } from '../../types/database';

export const PARITY_RUNTIME_SCHEMA = 'light-heavy-parity-runtime.v1';

export type ParityRuntimeDisposition = 'source_identity_exact' | 'catalog_mapping_semantic' | 'PENDING_CONFIRMATION';

export interface ParityRuntimeEnvelope {
  readonly schema: typeof PARITY_RUNTIME_SCHEMA;
  readonly contractVersion: typeof PARITY_CONTRACT_VERSION;
  readonly comparatorVersion: typeof PARITY_COMPARATOR_VERSION;
  readonly rowId: GoalCandidateRowId;
  readonly featureId: ProductCatalogObjectId | null;
  readonly disposition: ParityRuntimeDisposition;
  readonly liveVerdict: 'PENDING_CONFIRMATION';
  readonly inputKey: string | null;
  readonly inputRoles: readonly string[];
  readonly source: 'heavy-runtime';
  readonly reason: 'live_light_heavy_readback_pending' | 'row_to_product_catalog_mapping_pending';
}

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const ALLOWED_INPUT_ROLES = new Set([
  'brief',
  'primary',
  'secondary',
  'garment',
  'print-artwork',
  'model-or-design',
  'textile',
  'source',
  'mask',
  'background',
  'model',
  'design',
  'material',
  'reference',
  'prompt',
  'output',
  'settings',
]);

const freezeFixtureRoles = (...roles: string[]): readonly string[] => Object.freeze(roles);

export const LIGHTCHAIN_PARITY_SLOT_FIXTURES: Readonly<Record<GoalCandidateRowId, readonly string[]>> = Object.freeze({
  'marketing-home': freezeFixtureRoles('primary'),
  'marketing-detail': freezeFixtureRoles('primary'),
  'ai-fitting': freezeFixtureRoles('primary'),
  'ai-fitting-reference': freezeFixtureRoles('primary'),
  'fitting-clothing-reference': freezeFixtureRoles('primary'),
  'fitting-background-reference': freezeFixtureRoles('primary'),
  'wear-design-lab': freezeFixtureRoles('primary'),
  'wear-design-detail': freezeFixtureRoles('primary'),
  'video-workstation': freezeFixtureRoles('primary'),
  'video-detail': freezeFixtureRoles('primary'),
  'model-library': freezeFixtureRoles(),
  'fashion-studio': freezeFixtureRoles('primary'),
  'design-agent': freezeFixtureRoles('primary'),
  lab: freezeFixtureRoles('primary'),
  'print-design-project': freezeFixtureRoles('primary'),
  'print-design-detail': freezeFixtureRoles('primary'),
  'fabric-image': freezeFixtureRoles('primary', 'secondary'),
  'line-generation': freezeFixtureRoles('primary'),
  'line-to-real': freezeFixtureRoles('primary'),
  'pattern-vector': freezeFixtureRoles('primary'),
  'pattern-vector-pro': freezeFixtureRoles('primary'),
  'printing-image': freezeFixtureRoles('primary', 'secondary'),
  'image-repair': freezeFixtureRoles('primary'),
  'svg-convert': freezeFixtureRoles('primary'),
  'model-face': freezeFixtureRoles('primary', 'secondary'),
  'model-change': freezeFixtureRoles('primary', 'secondary'),
  'body-shape': freezeFixtureRoles('primary'),
  'clothing-size': freezeFixtureRoles('primary'),
  'pose-change': freezeFixtureRoles('primary', 'secondary'),
  'background-change': freezeFixtureRoles('primary', 'secondary'),
  'angle-change': freezeFixtureRoles('primary'),
  'model-custom': freezeFixtureRoles(),
  'custom-style': freezeFixtureRoles('primary'),
});

/**
 * The Workbench stores generic slot keys, while the material Workbench uses
 * semantic roles. Keep one canonical runtime sequence so both entry points
 * produce the same comparison key for the same feature/input contract.
 */
const CANONICAL_ROLE_BY_ROW_AND_SLOT: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  'fabric-image': Object.freeze({ primary: 'model-or-design', secondary: 'textile' }),
  'printing-image': Object.freeze({ primary: 'garment', secondary: 'print-artwork' }),
});

function canonicalRuntimeRole(rowId: GoalCandidateRowId, role: string): string {
  return CANONICAL_ROLE_BY_ROW_AND_SLOT[rowId]?.[role] ?? role;
}

function expectedRuntimeRoles(rowId: GoalCandidateRowId): readonly string[] {
  const fixtureRoles = LIGHTCHAIN_PARITY_SLOT_FIXTURES[rowId];
  return fixtureRoles.length > 0
    ? Object.freeze(fixtureRoles.map((role) => canonicalRuntimeRole(rowId, role)))
    : Object.freeze(['brief']);
}

function fail(code: string, details?: string): never {
  throw new Error(details ? `${code}:${details}` : code);
}

function normalizeIdentifier(value: unknown, code: string, includeDetails = true): string {
  if (typeof value !== 'string') fail(code);
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (!normalized || !IDENTIFIER_PATTERN.test(normalized)) {
    fail(code, includeDetails ? normalized || 'empty' : undefined);
  }
  if (['http', 'https', 'data', 'blob', 'url', 'uri'].includes(normalized)) {
    fail(code, includeDetails ? normalized : undefined);
  }
  return normalized;
}

function normalizeInputRole(value: unknown, index: number): string {
  const normalized = normalizeIdentifier(value, `parity_runtime_input_role_invalid_${index}`, false);
  if (normalized.length > 32) fail('parity_runtime_input_role_too_long');
  if (!ALLOWED_INPUT_ROLES.has(normalized)) fail('parity_runtime_input_role_unknown');
  return normalized;
}

function hasSameRoleSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((role, index) => role === right[index]);
}

function hasExpectedRolePrefix(observed: readonly string[], expected: readonly string[]): boolean {
  return observed.length <= expected.length && observed.every((role, index) => role === expected[index]);
}

export function buildLightchainParityInputRoles(input: {
  readonly rowId: string;
  readonly slots: ReadonlyArray<{
    readonly role: string;
    readonly required: boolean;
    readonly present: boolean;
  }>;
}): readonly string[] {
  if (!input || typeof input !== 'object' || !Array.isArray(input.slots)) {
    fail('parity_runtime_slots_required');
  }
  const rowId = normalizeIdentifier(input.rowId, 'parity_runtime_row_id_required');
  if (!isGoalCandidateRowId(rowId)) fail('parity_runtime_row_id_unknown', rowId);
  const observedRoles = input.slots
    .map((slot, index) => {
      if (!slot || typeof slot !== 'object' || typeof slot.required !== 'boolean' || typeof slot.present !== 'boolean') {
        fail('parity_runtime_slot_state_invalid');
      }
      return canonicalRuntimeRole(rowId, normalizeInputRole(slot.role, index));
    });
  if (new Set(observedRoles).size !== observedRoles.length) fail('parity_runtime_input_roles_ambiguous');
  const expectedRoles = expectedRuntimeRoles(rowId);
  // Brief-only model entries intentionally have no material slots. Their
  // runtime contract is the synthetic-but-explicit `brief` role, not an
  // absent input contract.
  if (observedRoles.length > 0 && !hasSameRoleSequence(observedRoles, expectedRoles)) {
    fail('parity_runtime_slot_contract_mismatch');
  }
  const roles = input.slots
    .filter((slot) => {
      if (!slot || typeof slot !== 'object' || typeof slot.required !== 'boolean' || typeof slot.present !== 'boolean') {
        fail('parity_runtime_slot_state_invalid');
      }
      return slot.required || slot.present;
    })
    .map((slot, index) => canonicalRuntimeRole(rowId, normalizeInputRole(slot.role, index)));
  if (new Set(roles).size !== roles.length) fail('parity_runtime_input_roles_ambiguous');
  if (roles.length > 0) return Object.freeze(roles);
  if (rowId === 'model-library' || rowId === 'model-custom') return Object.freeze(['brief']);
  fail('parity_runtime_input_roles_missing', rowId);
}

export function buildLightchainParityRuntime(input: {
  readonly rowId: string;
  readonly inputRoles: readonly string[];
  readonly fixtureId?: string | null;
  readonly settings?: Readonly<Record<string, ParityJsonValue>>;
}): ParityRuntimeEnvelope {
  if (!input || typeof input !== 'object') fail('parity_runtime_input_required');
  const rowId = normalizeIdentifier(input.rowId, 'parity_runtime_row_id_required');
  if (!isGoalCandidateRowId(rowId)) fail('parity_runtime_row_id_unknown', rowId);
  if (!Array.isArray(input.inputRoles) || input.inputRoles.length === 0 || input.inputRoles.length > 16) {
    fail('parity_runtime_input_roles_invalid');
  }
  const inputRoles = input.inputRoles.map((role, index) => normalizeInputRole(role, index));
  if (new Set(inputRoles).size !== inputRoles.length) fail('parity_runtime_input_roles_ambiguous');
  const expectedRoles = expectedRuntimeRoles(rowId);
  // Optional reference slots are omitted from the runtime projection until a
  // user selects them. Keep the declared order strict while allowing a
  // required primary-only execution (for example model-change with its
  // optional model reference left empty).
  if (!hasExpectedRolePrefix(inputRoles, expectedRoles)) {
    fail('parity_runtime_input_role_contract_mismatch', rowId);
  }

  const mapping = getFeatureParityMapping(rowId);
  const featureId = mapping?.productObjectId ?? null;
  const disposition = mapping?.status === 'exact'
    ? 'source_identity_exact'
    : mapping?.status === 'semantic'
      ? 'catalog_mapping_semantic'
      : 'PENDING_CONFIRMATION';
  const reason = featureId
    ? 'live_light_heavy_readback_pending'
    : 'row_to_product_catalog_mapping_pending';
  const inputKey = featureId && input.fixtureId
    ? createParityComparisonKey({
      featureId,
      rowId,
      fixtureId: input.fixtureId,
      inputOrder: inputRoles,
      settings: input.settings ?? {},
    })
    : null;

  return Object.freeze({
    schema: PARITY_RUNTIME_SCHEMA,
    contractVersion: PARITY_CONTRACT_VERSION,
    comparatorVersion: PARITY_COMPARATOR_VERSION,
    rowId,
    featureId,
    disposition,
    liveVerdict: 'PENDING_CONFIRMATION',
    inputKey,
    inputRoles: Object.freeze(inputRoles),
    source: 'heavy-runtime',
    reason,
  });
}

export function serializeLightchainParityRuntime(envelope: ParityRuntimeEnvelope): Json {
  return {
    schema: envelope.schema,
    contractVersion: envelope.contractVersion,
    comparatorVersion: envelope.comparatorVersion,
    rowId: envelope.rowId,
    featureId: envelope.featureId,
    disposition: envelope.disposition,
    liveVerdict: envelope.liveVerdict,
    inputKey: envelope.inputKey,
    inputRoles: [...envelope.inputRoles],
    source: envelope.source,
    reason: envelope.reason,
  };
}
