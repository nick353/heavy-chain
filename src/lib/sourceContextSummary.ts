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

const lightchainStepStatusLabels: Record<string, string> = {
  queued: '待機中',
  processing: '処理中',
  completed: '完了',
  failed: '失敗',
  retryable: '失敗・再試行可',
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

const readRecordListFromMetadataOrIntent = (metadata: JsonRecord, intent: JsonRecord | null, key: string) => {
  const metadataValue = metadata[key];
  if (Array.isArray(metadataValue)) return metadataValue.filter(isRecord);
  const intentValue = intent?.[key];
  return Array.isArray(intentValue) ? intentValue.filter(isRecord) : undefined;
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

const fittingGenderLabels: Record<string, string> = {
  female: '女性',
  male: '男性',
};

const fittingRoleLabels: Record<string, string> = {
  garment: '衣服素材',
  'print-artwork': 'プリント素材',
  'model-or-design': 'モデル/デザイン素材',
  textile: '生地素材',
};

const buildFittingRows = (metadata: JsonRecord, intent: JsonRecord | null) => {
  const rows: SourceContextSummaryRow[] = [];
  const materialReference = readRecordFromMetadataOrIntent(metadata, intent, 'materialReference');
  const modelReferenceFileName = readFromMetadataOrIntent(metadata, intent, 'modelReferenceFileName');
  const bodyTypes = readListFromMetadataOrIntent(metadata, intent, 'bodyTypes');
  const ageGroups = readListFromMetadataOrIntent(metadata, intent, 'ageGroups');
  const gender = readFromMetadataOrIntent(metadata, intent, 'gender');
  const modelValues = [
    bodyTypes?.join('/'),
    ageGroups?.join('/'),
    gender ? fittingGenderLabels[gender] ?? gender : undefined,
  ].filter((value): value is string => Boolean(value));

  if (materialReference) {
    pushIfValue(
      rows,
      '衣服素材',
      readNonEmptyString(materialReference, 'fileName')
        ?? readNonEmptyString(materialReference, 'materialKind')
        ?? (materialReference.hasImage === true ? '選択済み' : undefined),
    );
    const layerValues = [
      readNonEmptyString(materialReference, 'activeLayer'),
      readNonEmptyString(materialReference, 'placement'),
    ].filter((value): value is string => Boolean(value));
    if (layerValues.length) rows.push({ label: '素材レイヤー', value: layerValues.join(' / ') });
    if (materialReference.extractedLayerReady === true || materialReference.nextStepReady === true) {
      rows.push({ label: '切り抜き', value: materialReference.nextStepReady === true ? '生成準備完了' : '確認済み' });
    }
  }

  pushIfValue(rows, 'モデル参照', modelReferenceFileName ?? '条件からモデルを生成');
  if (modelValues.length) rows.push({ label: 'モデル条件', value: modelValues.join(' / ') });

  return rows;
};

const buildMaterialWorkbenchRows = (metadata: JsonRecord, intent: JsonRecord | null) => {
  const rows: SourceContextSummaryRow[] = [];
  const toolId = readFromMetadataOrIntent(metadata, intent, 'toolId');
  const materialReferences = readRecordListFromMetadataOrIntent(metadata, intent, 'materialReferences') ?? [];
  const inputLineage = readRecordListFromMetadataOrIntent(metadata, intent, 'inputLineage') ?? [];
  const selectedRoles = [...materialReferences, ...inputLineage]
    .map((reference) => readNonEmptyString(reference, 'role'))
    .filter((role): role is string => Boolean(role))
    .filter((role, index, roles) => roles.indexOf(role) === index)
    .map((role) => fittingRoleLabels[role] ?? role);

  pushIfValue(rows, '対象', toolId === 'printing-image' ? 'プリントイメージ' : toolId === 'fabric-image' ? '生地イメージ' : toolId);
  if (selectedRoles.length) rows.push({ label: '入力素材', value: selectedRoles.join(' / ') });

  const generationIntent = readRecordFromMetadataOrIntent(metadata, intent, 'generationIntent');
  pushIfValue(rows, '配置範囲', readFromMetadataOrIntent(generationIntent ?? {}, null, 'coverageMode'));
  pushIfValue(rows, '生地比率', readFromMetadataOrIntent(generationIntent ?? {}, null, 'imageRatio'));
  const designCount = generationIntent?.designCount;
  if (typeof designCount === 'number') rows.push({ label: 'プリント数', value: String(designCount) });

  const maskPlan = readRecordFromMetadataOrIntent(metadata, intent, 'maskPlan');
  if (maskPlan?.providerMaskReady === true) rows.push({ label: '衣服領域', value: 'providerマスク確認済み' });
  if (maskPlan?.garmentCutoutReady === true || maskPlan?.modelGarmentMaskReady === true) {
    rows.push({ label: '切り抜き', value: '確認済み' });
  }

  return rows;
};

const buildLightchainWorkbenchRows = (metadata: JsonRecord, intent: JsonRecord | null) => {
  const rows: SourceContextSummaryRow[] = [];
  const materialReferences = readRecordListFromMetadataOrIntent(metadata, intent, 'materialReferences') ?? [];
  const modelFormState = readRecordFromMetadataOrIntent(metadata, intent, 'modelFormState');
  const materialLabels = materialReferences
    .map((reference) => (
      readNonEmptyString(reference, 'fileName')
        ?? readNonEmptyString(reference, 'materialKind')
        ?? readNonEmptyString(reference, 'slotKey')
    ))
    .filter((label): label is string => Boolean(label))
    .filter((label, index, labels) => labels.indexOf(label) === index);
  const modelValues = [
    readNonEmptyString(modelFormState, 'gender'),
    readNonEmptyString(modelFormState, 'bodyGender'),
    readNonEmptyString(modelFormState, 'age'),
    readNonEmptyString(modelFormState, 'nationality'),
    readNonEmptyString(modelFormState, 'bodyType'),
    readNonEmptyString(modelFormState, 'garmentType'),
    readNonEmptyString(modelFormState, 'sourceSize') && readNonEmptyString(modelFormState, 'targetSize')
      ? `${readNonEmptyString(modelFormState, 'sourceSize')}→${readNonEmptyString(modelFormState, 'targetSize')}`
      : undefined,
  ].filter((value): value is string => Boolean(value));

  pushIfValue(rows, 'ツール', readFromMetadataOrIntent(metadata, intent, 'toolTitle'));
  pushIfValue(rows, '生成条件', readFromMetadataOrIntent(metadata, intent, 'generationSummary'));
  pushIfValue(rows, '依頼', readFromMetadataOrIntent(metadata, intent, 'brief'));
  if (materialLabels.length) rows.push({ label: '入力素材', value: materialLabels.join(' / ') });
  if (modelValues.length) rows.push({ label: 'モデル条件', value: modelValues.join(' / ') });

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

const buildDesignProductionRows = (metadata: JsonRecord, intent: JsonRecord | null) => {
  const rows: SourceContextSummaryRow[] = [];
  const prompt = readFromMetadataOrIntent(metadata, intent, 'brief')
    ?? readFromMetadataOrIntent(metadata, intent, 'prompt');
  const referenceAssets = readFromMetadataOrIntent(metadata, intent, 'referenceAssets')
    ?? readFromMetadataOrIntent(metadata, intent, 'referenceNote');

  pushIfValue(rows, '制作シーン', readFromMetadataOrIntent(metadata, intent, 'activeScene'));
  pushIfValue(rows, '依頼', prompt);
  pushIfValue(rows, '参考素材', referenceAssets);
  pushIfValue(rows, 'プロジェクト', readFromMetadataOrIntent(metadata, intent, 'projectName'));

  return rows;
};

const buildLightchainRows = (metadata: JsonRecord, intent: JsonRecord | null) => {
  const rows: SourceContextSummaryRow[] = [];
  const lightchainCompat = readRecordFromMetadataOrIntent(metadata, intent, 'lightchainCompat');
  const taskCodes = readStringList(lightchainCompat, 'lightchainTaskCodes');
  const rawTaskSteps = lightchainCompat?.lightchainTaskSteps;
  const taskSteps = Array.isArray(rawTaskSteps)
    ? rawTaskSteps
      .filter(isRecord)
      .map((step) => {
        const taskCode = readNonEmptyString(step, 'taskCode');
        const status = readNonEmptyString(step, 'status');
        if (!taskCode || !status) return null;
        return `${taskCode}=${lightchainStepStatusLabels[status] ?? status}`;
      })
      .filter((step): step is string => Boolean(step))
    : [];

  pushIfValue(rows, 'Lightchain機能', readNonEmptyString(lightchainCompat, 'lightchainFeatureTitle'));
  if (taskCodes) rows.push({ label: 'Lightchain task', value: taskCodes.join(' / ') });
  if (taskSteps.length) rows.push({ label: 'Lightchain steps', value: taskSteps.join(' / ') });

  return rows;
};

const buildWorkspaceLineageRows = (metadata: JsonRecord) => {
  const lineage = metadata.workspaceLineage;
  if (!isRecord(lineage) || readNonEmptyString(lineage, 'schemaVersion') !== 'heavy-chain-workspace-lineage.v1') {
    return [];
  }

  const role = readNonEmptyString(lineage, 'role');
  const providerGeneration = readNonEmptyString(lineage, 'providerGeneration');
  const destinations = isRecord(lineage.destinations) ? lineage.destinations : null;
  const destinationLabels = [
    readNonEmptyString(destinations, 'galleryArtifactId') ? 'Gallery' : null,
    readNonEmptyString(destinations, 'historyArtifactId') ? 'History' : null,
    readNonEmptyString(destinations, 'canvasProjectId') ? 'Canvas' : null,
    readNonEmptyString(destinations, 'jobsJobId') ? 'Jobs' : null,
  ].filter((value): value is string => Boolean(value));

  const roleLabel = role === 'generated-result'
    ? 'provider結果'
    : role === 'workspace-handoff'
      ? 'workspace handoff'
      : role === 'source-material'
        ? '入力素材'
        : role;
  const providerLabel = providerGeneration === 'completed'
    ? '実provider結果'
    : providerGeneration === 'not-run'
      ? 'provider未実行'
      : providerGeneration;

  const rows: SourceContextSummaryRow[] = [];
  pushIfValue(rows, '成果物系譜', roleLabel);
  pushIfValue(rows, '生成状態', providerLabel);
  if (destinationLabels.length) rows.push({ label: '再利用先', value: destinationLabels.join(' / ') });
  return rows;
};

export const buildSourceContextSummaryRows = (metadata: Json | null | undefined): SourceContextSummaryRow[] => {
  if (!isRecord(metadata)) return [];
  const intent = getIntent(metadata);
  const sourceWorkspace = readNonEmptyString(metadata, 'sourceWorkspace') ?? readNonEmptyString(intent, 'sourceWorkspace');
  const lightchainRows = buildLightchainRows(metadata, intent);
  const workspaceLineageRows = buildWorkspaceLineageRows(metadata);

  const withLightchainRows = (rows: SourceContextSummaryRow[]) => [
    ...lightchainRows,
    ...workspaceLineageRows,
    ...rows,
  ];

  if (sourceWorkspace === 'patterns') return withLightchainRows(buildPatternRows(metadata, intent));
  if (sourceWorkspace === 'models') return withLightchainRows(buildModelRows(metadata, intent));
  if (sourceWorkspace === 'fitting') return withLightchainRows(buildFittingRows(metadata, intent));
  if (sourceWorkspace === 'studio') return withLightchainRows(buildStudioRows(metadata, intent));
  if (sourceWorkspace === 'video') return withLightchainRows(buildVideoRows(metadata, intent));
  if (sourceWorkspace === 'lab') return withLightchainRows(buildLabRows(metadata, intent));
  if (sourceWorkspace === 'design-production') return withLightchainRows(buildDesignProductionRows(metadata, intent));
  if (sourceWorkspace === 'lightchain-material-workbench-provider-result') {
    return withLightchainRows(buildMaterialWorkbenchRows(metadata, intent));
  }
  if (sourceWorkspace === 'lightchain-workbench-provider-result' || sourceWorkspace === 'lightchain-workbench') {
    return withLightchainRows(buildLightchainWorkbenchRows(metadata, intent));
  }

  return [...lightchainRows, ...workspaceLineageRows];
};
