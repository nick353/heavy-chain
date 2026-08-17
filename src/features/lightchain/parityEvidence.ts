import {
  PARITY_COMPARATOR_VERSION,
  PARITY_CONTRACT_VERSION,
  type GoalCandidateRowId,
  type ParityInput,
  type ProductCatalogObjectId,
  type NormalizedParityInput,
  createParityComparisonKey,
  normalizeParityInput,
} from './parityContract.ts';
import { assertFeatureParityMapping } from './featureParityMapping.ts';

export const PARITY_EVIDENCE_SCHEMA = 'light-heavy-parity-evidence.v1';

export const PARITY_SURFACES = Object.freeze([
  'entry',
  'input',
  'operation',
  'progress',
  'failure',
  'resume',
  'result',
  'quality',
  'mask',
  'persistence',
  'history',
  'jobs',
  'canvas',
  'download',
  'cleanup',
] as const);

export type ParitySurface = (typeof PARITY_SURFACES)[number];
export type ParityVerdict = 'equal' | 'different' | 'PENDING_CONFIRMATION';

export interface ParityEvidenceRecord {
  readonly schema: typeof PARITY_EVIDENCE_SCHEMA;
  readonly contractVersion: typeof PARITY_CONTRACT_VERSION;
  readonly comparatorVersion: typeof PARITY_COMPARATOR_VERSION;
  readonly featureId: ProductCatalogObjectId;
  readonly rowId: GoalCandidateRowId;
  readonly surface: ParitySurface;
  readonly fixtureId: string;
  readonly inputHash: string;
  readonly inputKey: string;
  readonly lightKey: string | null;
  readonly heavyKey: string | null;
  readonly verdict: ParityVerdict;
  readonly provenance: {
    readonly runId: string;
    readonly source: string;
    readonly recordedAt: string;
  };
}

export interface ParityEvidenceSpec {
  readonly surface: ParitySurface;
  readonly inputHash: string;
  readonly lightKey?: string | null;
  readonly heavyKey?: string | null;
  readonly verdict: ParityVerdict;
  readonly runId: string;
  readonly source: string;
  readonly recordedAt: string;
}

function fail(code: string, details?: string): never {
  throw new Error(details ? `${code}:${details}` : code);
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string') fail(code);
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized) fail(code);
  return normalized;
}

function isSurface(value: unknown): value is ParitySurface {
  return typeof value === 'string' && (PARITY_SURFACES as readonly string[]).includes(value);
}

function isVerdict(value: unknown): value is ParityVerdict {
  return value === 'equal' || value === 'different' || value === 'PENDING_CONFIRMATION';
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  fail('parity_evidence_value_invalid');
}

export function createParityEvidenceRecord(
  input: ParityInput | NormalizedParityInput,
  spec: ParityEvidenceSpec,
): ParityEvidenceRecord {
  const normalized = normalizeParityInput(input);
  assertFeatureParityMapping(normalized.rowId, normalized.featureId);
  if (!isSurface(spec.surface)) fail('parity_surface_invalid');
  if (!isVerdict(spec.verdict)) fail('parity_verdict_invalid');
  const inputHash = requiredText(spec.inputHash, 'parity_input_hash_required');
  const runId = requiredText(spec.runId, 'parity_run_id_required');
  const source = requiredText(spec.source, 'parity_provenance_source_required');
  const recordedAt = requiredText(spec.recordedAt, 'parity_recorded_at_required');
  if (Number.isNaN(Date.parse(recordedAt))) fail('parity_recorded_at_invalid');
  const lightKey = spec.lightKey == null ? null : requiredText(spec.lightKey, 'parity_light_key_invalid');
  const heavyKey = spec.heavyKey == null ? null : requiredText(spec.heavyKey, 'parity_heavy_key_invalid');
  if (spec.verdict === 'PENDING_CONFIRMATION') {
    if (lightKey !== null || heavyKey !== null) fail('parity_pending_keys_must_be_null');
  } else {
    if (lightKey === null || heavyKey === null) fail('parity_resolved_keys_required');
    if (spec.verdict === 'equal' && lightKey !== heavyKey) fail('parity_equal_keys_mismatch');
    if (spec.verdict === 'different' && lightKey === heavyKey) fail('parity_different_keys_match');
  }
  return Object.freeze({
    schema: PARITY_EVIDENCE_SCHEMA,
    contractVersion: PARITY_CONTRACT_VERSION,
    comparatorVersion: PARITY_COMPARATOR_VERSION,
    featureId: normalized.featureId,
    rowId: normalized.rowId,
    surface: spec.surface,
    fixtureId: normalized.fixtureId,
    inputHash,
    inputKey: createParityComparisonKey(normalized),
    lightKey,
    heavyKey,
    verdict: spec.verdict,
    provenance: Object.freeze({ runId, source, recordedAt }),
  });
}

export function serializeParityEvidence(record: ParityEvidenceRecord): string {
  if (!record || record.schema !== PARITY_EVIDENCE_SCHEMA) fail('parity_evidence_schema_invalid');
  return stableJson(record);
}

export function assertParityEvidenceComplete(record: ParityEvidenceRecord): ParityEvidenceRecord {
  if (record.verdict === 'PENDING_CONFIRMATION') fail('parity_evidence_pending');
  if (!record.provenance.runId || !record.provenance.source || !record.provenance.recordedAt) {
    fail('parity_evidence_provenance_incomplete');
  }
  return record;
}
