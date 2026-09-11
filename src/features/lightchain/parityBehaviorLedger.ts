import {
  GOAL_CANDIDATE_ROW_IDS,
  type GoalCandidateRowId,
} from './parityContract.ts';

export const PARITY_BEHAVIOR_LEDGER_SCHEMA = 'light-heavy-parity-behavior-ledger.v2';

export const PARITY_BEHAVIOR_LAYERS = Object.freeze([
  'input',
  'screen',
  'generation',
  'result',
  'save',
  'reuse',
  'error',
  'performance',
] as const);

export type ParityBehaviorLayer = (typeof PARITY_BEHAVIOR_LAYERS)[number];
export type ParityBehaviorStatus =
  | 'verified'
  | 'verified-local'
  | 'verified-production'
  | 'PENDING_CONFIRMATION'
  | 'unknown';

export type NonVideoGoalCandidateRowId = Exclude<GoalCandidateRowId, 'video-workstation' | 'video-detail'>;

export const NON_VIDEO_PARITY_ROW_IDS = Object.freeze(
  GOAL_CANDIDATE_ROW_IDS.filter(
    (rowId): rowId is NonVideoGoalCandidateRowId => !rowId.startsWith('video-'),
  ),
);

export interface ParityBehaviorLayerRecord {
  readonly status: ParityBehaviorStatus;
  readonly evidence: readonly string[];
  readonly note: string;
}

export type ParityBehaviorLayers = Readonly<Record<ParityBehaviorLayer, ParityBehaviorLayerRecord>>;

export interface ParityBehaviorLedgerRecord {
  readonly rowId: NonVideoGoalCandidateRowId;
  readonly layers: ParityBehaviorLayers;
}

const VALID_STATUSES: readonly ParityBehaviorStatus[] = Object.freeze([
  'verified',
  'verified-local',
  'verified-production',
  'PENDING_CONFIRMATION',
  'unknown',
]);

function fail(code: string, details?: string): never {
  throw new Error(details ? `${code}:${details}` : code);
}

function isLayer(value: string): value is ParityBehaviorLayer {
  return (PARITY_BEHAVIOR_LAYERS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is ParityBehaviorStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value as ParityBehaviorStatus);
}

function requireNonEmptyString(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(code);
  return value.trim();
}

function validateLayer(rowId: string, layer: ParityBehaviorLayer, record: unknown): ParityBehaviorLayerRecord {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('parity_behavior_layer_record_invalid', `${rowId}:${layer}`);
  }
  const candidate = record as Record<string, unknown>;
  if (!isStatus(candidate.status)) fail('parity_behavior_status_invalid', `${rowId}:${layer}`);
  if (!Array.isArray(candidate.evidence) || candidate.evidence.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    fail('parity_behavior_evidence_invalid', `${rowId}:${layer}`);
  }
  const evidence = Object.freeze(candidate.evidence.map((entry) => String(entry).trim()));
  const note = requireNonEmptyString(candidate.note, 'parity_behavior_note_required');
  if (['verified', 'verified-local', 'verified-production'].includes(candidate.status) && evidence.length === 0) {
    fail('parity_behavior_verified_evidence_required', `${rowId}:${layer}`);
  }
  if (['PENDING_CONFIRMATION', 'unknown'].includes(candidate.status) && evidence.length === 0 && !note) {
    fail('parity_behavior_unresolved_note_required', `${rowId}:${layer}`);
  }
  return Object.freeze({
    status: candidate.status,
    evidence,
    note,
  }) as ParityBehaviorLayerRecord;
}

export function validateParityBehaviorLedger(
  records: readonly ParityBehaviorLedgerRecord[],
): readonly ParityBehaviorLedgerRecord[] {
  if (!Array.isArray(records) || records.length !== NON_VIDEO_PARITY_ROW_IDS.length) {
    fail('parity_behavior_row_count_invalid');
  }
  const seen = new Set<string>();
  const validated = records.map((record) => {
    const rowId = requireNonEmptyString(record?.rowId, 'parity_behavior_row_required');
    if (!(NON_VIDEO_PARITY_ROW_IDS as readonly string[]).includes(rowId)) {
      if ((GOAL_CANDIDATE_ROW_IDS as readonly string[]).includes(rowId)) {
        fail('parity_behavior_video_row_forbidden', rowId);
      }
      fail('parity_behavior_row_unknown', rowId);
    }
    if (seen.has(rowId)) fail('parity_behavior_row_duplicate', rowId);
    seen.add(rowId);
    if (!record.layers || typeof record.layers !== 'object' || Array.isArray(record.layers)) {
      fail('parity_behavior_layers_required', rowId);
    }
    const layerKeys = Object.keys(record.layers);
    if (layerKeys.length !== PARITY_BEHAVIOR_LAYERS.length || layerKeys.some((layer) => !isLayer(layer))) {
      fail('parity_behavior_layer_set_invalid', rowId);
    }
    const layers = {} as Record<ParityBehaviorLayer, ParityBehaviorLayerRecord>;
    for (const layer of PARITY_BEHAVIOR_LAYERS) {
      layers[layer] = validateLayer(rowId, layer, record.layers[layer]);
    }
    return Object.freeze({
      rowId: rowId as NonVideoGoalCandidateRowId,
      layers: Object.freeze(layers),
    });
  });
  for (const rowId of NON_VIDEO_PARITY_ROW_IDS) {
    if (!seen.has(rowId)) fail('parity_behavior_row_missing', rowId);
  }
  return Object.freeze(validated);
}

export function createPendingParityBehaviorLedger(): readonly ParityBehaviorLedgerRecord[] {
  return validateParityBehaviorLedger(
    NON_VIDEO_PARITY_ROW_IDS.map((rowId): ParityBehaviorLedgerRecord => {
      const layers = {} as Record<ParityBehaviorLayer, ParityBehaviorLayerRecord>;
      for (const layer of PARITY_BEHAVIOR_LAYERS) {
        layers[layer] = {
        status: 'PENDING_CONFIRMATION',
        evidence: [],
        note: 'Current same-run Lightchain↔Heavy evidence is not yet available for this layer.',
        };
      }
      return {
        rowId,
        layers: Object.freeze(layers),
      };
    }),
  );
}
