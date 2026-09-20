import {
  GOAL_CANDIDATE_ROW_IDS,
  type GoalCandidateRowId,
} from './parityContract.ts';
import {
  PARITY_BEHAVIOR_LAYERS,
  type ParityBehaviorLayer,
  type ParityBehaviorLayerRecord,
  type ParityBehaviorStatus,
} from './parityBehaviorLedger.ts';

export const VIDEO_PARITY_BEHAVIOR_LEDGER_SCHEMA = 'light-heavy-video-parity-behavior-ledger.v1';

export type VideoParityRowId = Extract<GoalCandidateRowId, 'video-workstation' | 'video-detail'>;

export const VIDEO_PARITY_ROW_IDS = Object.freeze(
  GOAL_CANDIDATE_ROW_IDS.filter(
    (rowId): rowId is VideoParityRowId => rowId === 'video-workstation' || rowId === 'video-detail',
  ),
);

export interface VideoParityBehaviorLedgerRecord {
  readonly rowId: VideoParityRowId;
  readonly layers: Readonly<Record<ParityBehaviorLayer, ParityBehaviorLayerRecord>>;
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

function validateLayer(rowId: string, layer: ParityBehaviorLayer, value: unknown): ParityBehaviorLayerRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('video_parity_behavior_layer_record_invalid', `${rowId}:${layer}`);
  }
  const candidate = value as Record<string, unknown>;
  if (!isStatus(candidate.status)) fail('video_parity_behavior_status_invalid', `${rowId}:${layer}`);
  if (!Array.isArray(candidate.evidence) || candidate.evidence.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    fail('video_parity_behavior_evidence_invalid', `${rowId}:${layer}`);
  }
  const evidence = Object.freeze(candidate.evidence.map((entry) => String(entry).trim()));
  const note = requireNonEmptyString(candidate.note, 'video_parity_behavior_note_required');
  if (['verified', 'verified-local', 'verified-production'].includes(candidate.status) && evidence.length === 0) {
    fail('video_parity_behavior_verified_evidence_required', `${rowId}:${layer}`);
  }
  return Object.freeze({ status: candidate.status, evidence, note }) as ParityBehaviorLayerRecord;
}

export function validateVideoParityBehaviorLedger(
  records: readonly VideoParityBehaviorLedgerRecord[],
): readonly VideoParityBehaviorLedgerRecord[] {
  if (!Array.isArray(records) || records.length !== VIDEO_PARITY_ROW_IDS.length) {
    fail('video_parity_behavior_row_count_invalid');
  }
  const seen = new Set<string>();
  const validated = records.map((record) => {
    const rowId = requireNonEmptyString(record?.rowId, 'video_parity_behavior_row_required');
    if (!(VIDEO_PARITY_ROW_IDS as readonly string[]).includes(rowId)) {
      if ((GOAL_CANDIDATE_ROW_IDS as readonly string[]).includes(rowId)) {
        fail('video_parity_behavior_non_video_row_forbidden', rowId);
      }
      fail('video_parity_behavior_row_unknown', rowId);
    }
    if (seen.has(rowId)) fail('video_parity_behavior_row_duplicate', rowId);
    seen.add(rowId);
    if (!record.layers || typeof record.layers !== 'object' || Array.isArray(record.layers)) {
      fail('video_parity_behavior_layers_required', rowId);
    }
    const layerKeys = Object.keys(record.layers);
    if (layerKeys.length !== PARITY_BEHAVIOR_LAYERS.length || layerKeys.some((layer) => !isLayer(layer))) {
      fail('video_parity_behavior_layer_set_invalid', rowId);
    }
    const layers = {} as Record<ParityBehaviorLayer, ParityBehaviorLayerRecord>;
    for (const layer of PARITY_BEHAVIOR_LAYERS) {
      layers[layer] = validateLayer(rowId, layer, record.layers[layer]);
    }
    return Object.freeze({ rowId: rowId as VideoParityRowId, layers: Object.freeze(layers) });
  });
  for (const rowId of VIDEO_PARITY_ROW_IDS) {
    if (!seen.has(rowId)) fail('video_parity_behavior_row_missing', rowId);
  }
  return Object.freeze(validated);
}

export function createPendingVideoParityBehaviorLedger(): readonly VideoParityBehaviorLedgerRecord[] {
  return validateVideoParityBehaviorLedger(
    VIDEO_PARITY_ROW_IDS.map((rowId) => {
      const layers = {} as Record<ParityBehaviorLayer, ParityBehaviorLayerRecord>;
      for (const layer of PARITY_BEHAVIOR_LAYERS) {
        layers[layer] = {
          status: 'PENDING_CONFIRMATION',
          evidence: [],
          note: 'Current same-run Lightchain↔Heavy video evidence is not yet available for this layer.',
        };
      }
      return { rowId, layers: Object.freeze(layers) };
    }),
  );
}
