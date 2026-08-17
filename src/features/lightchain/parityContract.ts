/**
 * Root-owned Lightchain/Heavy Chain parity contract.
 *
 * This module is intentionally pure. It does not know about providers,
 * browsers, persistence, Canvas, Download, or network state. A later wave
 * may adapt its records to those surfaces without weakening the contract.
 */

export const PARITY_CONTRACT_VERSION = 'light-heavy-parity.v1';
export const PARITY_COMPARATOR_VERSION = 'stable-comparison-key.v1';

export const GOAL_CANDIDATE_ROW_IDS = Object.freeze([
  'marketing-home',
  'marketing-detail',
  'ai-fitting',
  'ai-fitting-reference',
  'fitting-clothing-reference',
  'fitting-background-reference',
  'wear-design-lab',
  'wear-design-detail',
  'video-workstation',
  'video-detail',
  'model-library',
  'fashion-studio',
  'design-agent',
  'lab',
  'print-design-project',
  'print-design-detail',
  'fabric-image',
  'line-generation',
  'line-to-real',
  'pattern-vector',
  'pattern-vector-pro',
  'printing-image',
  'image-repair',
  'svg-convert',
  'model-face',
  'model-change',
  'body-shape',
  'clothing-size',
  'pose-change',
  'background-change',
  'angle-change',
  'model-custom',
  'custom-style',
] as const);

export const PRODUCT_CATALOG_OBJECT_IDS = Object.freeze([
  'marketing-workspace',
  'virtual-fitting',
  'wear-design-lab',
  'video-workstation',
  'model-library',
  'fashion-studio',
  'design-agent',
  'heavychain-lab',
  'inspiration-design',
  'fabric-simulation',
  'printing-image',
  'lineart-to-real',
  'change-color',
  'flat-vector',
  'custom-style',
  'model-change-background',
  'model-body-shape',
  'flat-to-model',
  'graphic-design',
  'pattern-vector-pro',
  'design-arrange',
  'print-design',
  'remove-background',
  'upscale-image',
  'image-variations',
  'partial-fix',
  'canvas-editing',
  'case-series-design',
  'case-ec-fusion',
  'case-sns-video',
] as const);

export type GoalCandidateRowId = (typeof GOAL_CANDIDATE_ROW_IDS)[number];
export type ProductCatalogObjectId = (typeof PRODUCT_CATALOG_OBJECT_IDS)[number];

export type ParityJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly ParityJsonValue[]
  | { readonly [key: string]: ParityJsonValue };

export type RowDisposition =
  | 'confirmed'
  | 'rejected'
  | 'merged'
  | 'deferred'
  | 'PENDING_CONFIRMATION';

export interface ParityInput {
  readonly featureId: string;
  readonly rowId: string;
  readonly fixtureId: string;
  /** Semantic input roles in their required order; do not sort this array. */
  readonly inputOrder: readonly string[];
  readonly settings: Readonly<Record<string, ParityJsonValue>>;
}

export interface NormalizedParityInput {
  readonly featureId: ProductCatalogObjectId;
  readonly rowId: GoalCandidateRowId;
  readonly fixtureId: string;
  readonly inputOrder: readonly string[];
  readonly settings: Readonly<Record<string, ParityJsonValue>>;
}

export interface RowDispositionRecord {
  readonly rowId: string;
  readonly disposition: RowDisposition;
  readonly productObjectId?: string;
  readonly note?: string;
}

export type ValidatedRowDispositionRecord = {
  readonly rowId: GoalCandidateRowId;
  readonly disposition: RowDisposition;
  readonly productObjectId?: ProductCatalogObjectId;
  readonly note?: string;
};

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

function fail(code: string, details?: string): never {
  throw new Error(details ? `${code}:${details}` : code);
}

function normalizeIdentifier(value: unknown, missingCode: string): string {
  if (typeof value !== 'string') fail(missingCode);
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (!normalized) fail(missingCode);
  if (!IDENTIFIER_PATTERN.test(normalized)) fail('parity_identifier_invalid', normalized);
  return normalized;
}

function normalizeText(value: unknown, code: string): string {
  if (typeof value !== 'string') fail(code);
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized) fail(code);
  return normalized;
}

function normalizeJsonValue(value: unknown, path: string): ParityJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return typeof value === 'string'
      ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
      : value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('parity_setting_number_invalid', path);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeJsonValue(entry, `${path}[${index}]`));
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => {
        const normalizedKey = normalizeIdentifier(key, 'parity_setting_key_required');
        return [normalizedKey, normalizeJsonValue(entry, `${path}.${normalizedKey}`)] as const;
      });
    const result: Record<string, ParityJsonValue> = {};
    for (const [key, entry] of entries) {
      if (key in result) fail('parity_setting_key_collision', key);
      result[key] = entry;
    }
    return result;
  }
  fail('parity_setting_value_invalid', path);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  fail('parity_canonical_value_invalid');
}

function stableHash(value: string): string {
  // This is a deterministic comparison key, not a cryptographic digest.
  // Content-addressed SHA-256 hashes belong to the fixture/evidence layer.
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function isGoalCandidateRowId(value: string): value is GoalCandidateRowId {
  return (GOAL_CANDIDATE_ROW_IDS as readonly string[]).includes(value);
}

export function isProductCatalogObjectId(value: string): value is ProductCatalogObjectId {
  return (PRODUCT_CATALOG_OBJECT_IDS as readonly string[]).includes(value);
}

export function normalizeParityInput(input: ParityInput): NormalizedParityInput {
  if (!input || typeof input !== 'object') fail('parity_input_required');
  const featureId = normalizeIdentifier(input.featureId, 'parity_feature_id_required');
  const rowId = normalizeIdentifier(input.rowId, 'parity_row_id_required');
  const fixtureId = normalizeText(input.fixtureId, 'parity_fixture_id_required');
  if (!isProductCatalogObjectId(featureId)) fail('parity_feature_id_unknown', featureId);
  if (!isGoalCandidateRowId(rowId)) fail('parity_row_id_unknown', rowId);
  if (!Array.isArray(input.inputOrder) || input.inputOrder.length === 0) {
    fail('parity_input_order_required');
  }
  const inputOrder = input.inputOrder.map((entry, index) => normalizeIdentifier(entry, `parity_input_role_required_${index}`));
  if (new Set(inputOrder).size !== inputOrder.length) fail('parity_input_order_ambiguous');
  if (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) {
    fail('parity_settings_object_required');
  }
  const settings = normalizeJsonValue(input.settings, 'settings') as Record<string, ParityJsonValue>;
  return Object.freeze({
    featureId,
    rowId,
    fixtureId,
    inputOrder: Object.freeze(inputOrder),
    settings: Object.freeze(settings),
  }) as NormalizedParityInput;
}

export function canonicalizeParityInput(input: ParityInput | NormalizedParityInput): string {
  const normalized = normalizeParityInput(input);
  return canonicalJson({
    contractVersion: PARITY_CONTRACT_VERSION,
    featureId: normalized.featureId,
    rowId: normalized.rowId,
    fixtureId: normalized.fixtureId,
    inputOrder: normalized.inputOrder,
    settings: normalized.settings,
  });
}

export function createParityComparisonKey(input: ParityInput | NormalizedParityInput): string {
  return `${PARITY_COMPARATOR_VERSION}:${stableHash(canonicalizeParityInput(input))}`;
}

export function validateRowDispositionTable(
  rows: readonly RowDispositionRecord[],
): readonly ValidatedRowDispositionRecord[] {
  if (!Array.isArray(rows) || rows.length !== GOAL_CANDIDATE_ROW_IDS.length) {
    fail('parity_row_disposition_count_invalid');
  }
  const seen = new Set<string>();
  const validated = rows.map((row) => {
    const rowId = normalizeIdentifier(row?.rowId, 'parity_row_disposition_row_required');
    if (!isGoalCandidateRowId(rowId)) fail('parity_row_disposition_row_unknown', rowId);
    if (seen.has(rowId)) fail('parity_row_disposition_duplicate', rowId);
    seen.add(rowId);
    const disposition = row?.disposition;
    if (!['confirmed', 'rejected', 'merged', 'deferred', 'PENDING_CONFIRMATION'].includes(disposition)) {
      fail('parity_row_disposition_invalid', rowId);
    }
    const productObjectId = row?.productObjectId == null
      ? undefined
      : normalizeIdentifier(row.productObjectId, 'parity_product_object_id_required');
    if (disposition === 'merged' && !productObjectId) {
      fail('parity_merged_target_required', rowId);
    }
    if (productObjectId && !isProductCatalogObjectId(productObjectId)) {
      fail('parity_product_object_id_unknown', productObjectId);
    }
    const note = row?.note == null ? undefined : normalizeText(row.note, 'parity_row_note_invalid');
    return {
      rowId,
      disposition,
      ...(productObjectId ? { productObjectId } : {}),
      ...(note ? { note } : {}),
    } as ValidatedRowDispositionRecord;
  });
  for (const expected of GOAL_CANDIDATE_ROW_IDS) {
    if (!seen.has(expected)) fail('parity_row_disposition_missing', expected);
  }
  return Object.freeze(validated);
}
