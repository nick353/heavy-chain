import type { Json } from '../types/database';

export interface SourceContextSummaryRow {
  label: string;
  value: string;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const readString = (record: JsonRecord | null | undefined, key: string) => {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
};

const readNonEmptyString = (record: JsonRecord | null | undefined, key: string) => {
  const value = readString(record, key);
  return value && value.trim() ? value.trim() : undefined;
};

const readStringList = (record: JsonRecord | null | undefined, key: string) => {
  const value = record?.[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return items.length ? items : undefined;
};

const getIntent = (metadata: Json | null | undefined) => {
  if (!isRecord(metadata)) return null;
  return isRecord(metadata.generationIntent) ? metadata.generationIntent : null;
};

const readFromMetadataOrIntent = (metadata: JsonRecord, intent: JsonRecord | null, key: string) => {
  return readNonEmptyString(metadata, key) ?? readNonEmptyString(intent, key);
};

const readListFromMetadataOrIntent = (metadata: JsonRecord, intent: JsonRecord | null, key: string) => {
  return readStringList(metadata, key) ?? readStringList(intent, key);
};

const readRecordFromMetadataOrIntent = (metadata: JsonRecord, intent: JsonRecord | null, key: string) => {
  const metadataValue = metadata[key];
  if (isRecord(metadataValue)) return metadataValue;
  const intentValue = intent?.[key];
  return isRecord(intentValue) ? intentValue : null;
};

const pushIfValue = (rows: SourceContextSummaryRow[], label: string, value: string | undefined) => {
  if (value) rows.push({ label, value });
};

const buildPatternRows = (metadata: JsonRecord, intent: JsonRecord | null) => {
  const rows: SourceContextSummaryRow[] = [];
  const selectedPatternPreview = readRecordFromMetadataOrIntent(metadata, intent, 'selectedPatternPreview');

  pushIfValue(rows, 'パターン', readNonEmptyString(selectedPatternPreview, 'label'));
  pushIfValue(rows, 'モード', readNonEmptyString(selectedPatternPreview, 'mode'));
  pushIfValue(rows, 'リピート設計', readNonEmptyString(selectedPatternPreview, 'repeatSignature'));
  pushIfValue(rows, 'ベクター設計', readNonEmptyString(selectedPatternPreview, 'vectorSignature'));
  pushIfValue(rows, 'パレット設計', readNonEmptyString(selectedPatternPreview, 'paletteSignature'));
  pushIfValue(rows, 'モチーフ', readFromMetadataOrIntent(metadata, intent, 'motifPrompt'));
  pushIfValue(rows, 'リピート', readFromMetadataOrIntent(metadata, intent, 'repeatStyle'));
  pushIfValue(rows, '対象アイテム', readFromMetadataOrIntent(metadata, intent, 'garmentTarget'));
  pushIfValue(rows, 'パレット', readFromMetadataOrIntent(metadata, intent, 'paletteNotes'));
  pushIfValue(rows, 'ベクター化', readFromMetadataOrIntent(metadata, intent, 'vectorIntent'));
  rows.push({ label: '参照素材', value: readFromMetadataOrIntent(metadata, intent, 'referenceAssets') ?? 'なし' });

  return rows;
};

const buildModelRows = (metadata: JsonRecord, intent: JsonRecord | null) => {
  const rows: SourceContextSummaryRow[] = [];
  const selectedModelCandidate = readRecordFromMetadataOrIntent(metadata, intent, 'selectedModelCandidate');
  const candidateLabel = readFromMetadataOrIntent(metadata, intent, 'modelCandidateLabel')
    ?? readNonEmptyString(selectedModelCandidate, 'label');
  const bodyTypes = readListFromMetadataOrIntent(metadata, intent, 'bodyTypes')
    ?? readStringList(selectedModelCandidate, 'modelMatrixBodyTypes');
  const ageGroups = readListFromMetadataOrIntent(metadata, intent, 'ageGroups')
    ?? readStringList(selectedModelCandidate, 'modelMatrixAgeGroups');
  const skinTone = readFromMetadataOrIntent(metadata, intent, 'skinTone')
    ?? readNonEmptyString(selectedModelCandidate, 'modelMatrixSkinTone');
  const hairStyle = readFromMetadataOrIntent(metadata, intent, 'hairStyle')
    ?? readNonEmptyString(selectedModelCandidate, 'modelMatrixHairStyle');
  const matrixValues = [
    bodyTypes?.join('/'),
    ageGroups?.join('/'),
    skinTone,
    hairStyle,
  ].filter((value): value is string => Boolean(value));

  pushIfValue(rows, 'モデル候補', candidateLabel);
  if (matrixValues.length) rows.push({ label: 'モデル条件', value: matrixValues.join(' / ') });

  return rows;
};

const buildStudioRows = (metadata: JsonRecord, intent: JsonRecord | null) => {
  const rows: SourceContextSummaryRow[] = [];
  const selectedStudioSetup = readRecordFromMetadataOrIntent(metadata, intent, 'selectedStudioSetup');
  const model = readRecordFromMetadataOrIntent(selectedStudioSetup ?? {}, null, 'model');
  const pose = readRecordFromMetadataOrIntent(selectedStudioSetup ?? {}, null, 'pose');
  const background = readRecordFromMetadataOrIntent(selectedStudioSetup ?? {}, null, 'background');

  pushIfValue(rows, 'モデル', readNonEmptyString(model, 'value') ?? readNonEmptyString(model, 'label'));
  pushIfValue(rows, 'ポーズ', readNonEmptyString(pose, 'value') ?? readNonEmptyString(pose, 'label'));
  pushIfValue(rows, '背景', readNonEmptyString(background, 'value') ?? readNonEmptyString(background, 'label'));
  pushIfValue(rows, '商品ライン', readFromMetadataOrIntent(metadata, intent, 'productLine'));
  pushIfValue(rows, '小物', readFromMetadataOrIntent(metadata, intent, 'props'));

  return rows;
};

const buildVideoRows = (metadata: JsonRecord, intent: JsonRecord | null) => {
  const rows: SourceContextSummaryRow[] = [];
  const selectedVideoStoryboard = readRecordFromMetadataOrIntent(metadata, intent, 'selectedVideoStoryboard');

  pushIfValue(rows, 'ストーリーボード', readNonEmptyString(selectedVideoStoryboard, 'label'));
  pushIfValue(rows, '尺', readNonEmptyString(selectedVideoStoryboard, 'duration'));
  pushIfValue(rows, '比率', readNonEmptyString(selectedVideoStoryboard, 'format') ?? readFromMetadataOrIntent(metadata, intent, 'aspectRatio'));
  pushIfValue(rows, 'ショット', readNonEmptyString(selectedVideoStoryboard, 'shotOrder'));
  pushIfValue(rows, 'モーション', readNonEmptyString(selectedVideoStoryboard, 'motion'));
  pushIfValue(rows, 'CTA', readNonEmptyString(selectedVideoStoryboard, 'cta'));

  return rows;
};

const buildLabRows = (metadata: JsonRecord, intent: JsonRecord | null) => {
  const rows: SourceContextSummaryRow[] = [];
  const selectedLabExperiment = readRecordFromMetadataOrIntent(metadata, intent, 'selectedLabExperiment');
  const score = selectedLabExperiment?.deterministicScore;

  pushIfValue(rows, '実験', readNonEmptyString(selectedLabExperiment, 'label'));
  pushIfValue(rows, '仮説', readNonEmptyString(selectedLabExperiment, 'hypothesis'));
  pushIfValue(rows, '評価軸', readNonEmptyString(selectedLabExperiment, 'evaluationAxis'));
  pushIfValue(rows, '採用候補', readNonEmptyString(selectedLabExperiment, 'candidate'));
  pushIfValue(rows, '判定', readNonEmptyString(selectedLabExperiment, 'decision'));
  if (typeof score === 'number') rows.push({ label: 'スコア', value: String(score) });

  return rows;
};

export const buildSourceContextSummaryRows = (metadata: Json | null | undefined): SourceContextSummaryRow[] => {
  if (!isRecord(metadata)) return [];
  const intent = getIntent(metadata);
  const sourceWorkspace = readNonEmptyString(metadata, 'sourceWorkspace') ?? readNonEmptyString(intent, 'sourceWorkspace');

  if (sourceWorkspace === 'patterns') return buildPatternRows(metadata, intent);
  if (sourceWorkspace === 'models') return buildModelRows(metadata, intent);
  if (sourceWorkspace === 'studio') return buildStudioRows(metadata, intent);
  if (sourceWorkspace === 'video') return buildVideoRows(metadata, intent);
  if (sourceWorkspace === 'lab') return buildLabRows(metadata, intent);

  return [];
};
