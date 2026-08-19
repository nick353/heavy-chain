import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceArtifactLineage } from '../src/lib/workspaceArtifactLineage.ts';
import { buildSourceContextSummaryRows } from '../src/lib/sourceContextSummary.ts';
import type { Json } from '../src/types/database.ts';

const roundTripJson = <T extends Json>(value: T): T => (
  JSON.parse(JSON.stringify(value)) as T
);

test('provider artifact lineage survives local persistence readback with shared destination IDs', () => {
  const metadata: Record<string, Json | undefined> = {
    providerResultArtifact: true,
    workflowVersion: 'fabric-provider-v1',
    sourceArtifactId: 'fabric-source-1',
    sourceStoragePath: 'brand-a/fabric-source.png',
    remoteStoragePath: 'brand-a/fabric-result.png',
    canvasProjectId: 'canvas-fabric-1',
    sourceJobId: 'job-fabric-1',
    signedPreviewUrl: 'https://signed.example.test/preview.png?token=ephemeral',
  };
  const lineage = buildWorkspaceArtifactLineage({
    id: 'fabric-result-1',
    featureType: 'lightchain-fabric-image-provider-result',
    canvasProjectId: 'canvas-fabric-1',
    sourceJobId: 'job-fabric-1',
    canonicalStoragePath: 'brand-a/fabric-result.png',
    metadata,
  });
  const persistedMetadata = roundTripJson({
    ...metadata,
    workspaceLineage: lineage,
  });
  const rows = buildSourceContextSummaryRows(persistedMetadata);

  assert.equal(persistedMetadata.workspaceLineage?.schemaVersion, 'heavy-chain-workspace-lineage.v1');
  assert.equal(persistedMetadata.workspaceLineage?.role, 'generated-result');
  assert.equal(persistedMetadata.workspaceLineage?.providerGeneration, 'completed');
  assert.equal(persistedMetadata.workspaceLineage?.canonicalStoragePath, 'brand-a/fabric-result.png');
  assert.equal(persistedMetadata.workspaceLineage?.destinations?.galleryArtifactId, 'fabric-result-1');
  assert.equal(persistedMetadata.workspaceLineage?.destinations?.historyArtifactId, 'fabric-result-1');
  assert.equal(persistedMetadata.workspaceLineage?.destinations?.jobsJobId, 'job-fabric-1');
  assert.equal(persistedMetadata.workspaceLineage?.destinations?.canvasProjectId, 'canvas-fabric-1');
  assert.deepEqual(
    rows.filter((row) => ['成果物系譜', '生成状態', '再利用先'].includes(row.label)),
    [
      { label: '成果物系譜', value: 'provider結果' },
      { label: '生成状態', value: '実provider結果' },
      { label: '再利用先', value: 'Gallery / History / Canvas / Jobs' },
    ],
  );
  assert.equal(JSON.stringify(persistedMetadata).includes('signed.example.test'), true);
  assert.equal(JSON.stringify(persistedMetadata.workspaceLineage).includes('signed.example.test'), false);
});

test('local workspace handoff remains explicitly provider-unexecuted after readback', () => {
  const lineage = buildWorkspaceArtifactLineage({
    id: 'fitting-handoff-1',
    featureType: 'ai-fitting',
    canvasProjectId: 'canvas-fitting-1',
    metadata: {
      handoffKind: 'local-workflow-intake',
      providerBlocker: 'permission_required',
      workflowVersion: 'ai-fitting-local-v1',
      selectedModelCandidate: { label: 'Model A' },
    },
  });
  const persistedMetadata = roundTripJson({
    sourceWorkspace: 'models',
    selectedModelCandidate: { label: 'Model A' },
    workspaceLineage: lineage,
  });
  const rows = buildSourceContextSummaryRows(persistedMetadata);

  assert.equal(persistedMetadata.workspaceLineage?.role, 'workspace-handoff');
  assert.equal(persistedMetadata.workspaceLineage?.providerGeneration, 'not-run');
  assert.equal(persistedMetadata.workspaceLineage?.destinations?.jobsJobId, null);
  assert.deepEqual(
    rows.filter((row) => ['成果物系譜', '生成状態', '再利用先'].includes(row.label)),
    [
      { label: '成果物系譜', value: 'workspace handoff' },
      { label: '生成状態', value: 'provider未実行' },
      { label: '再利用先', value: 'Gallery / History / Canvas' },
    ],
  );
});

test('fitting and material provider summaries expose reusable conditions without signed source URLs', () => {
  const fittingRows = buildSourceContextSummaryRows(roundTripJson({
    sourceWorkspace: 'fitting',
    sourceReadback: { sourceWorkspace: 'fitting', workflowVersion: 'fitting-brief-local-v1' },
    materialReference: {
      hasImage: true,
      imageUrl: 'https://signed.example.test/garment.png?token=ephemeral',
      fileName: 'linen-shirt.png',
      materialKind: '衣服',
      activeLayer: '衣服全体',
      placement: '正面中央',
      extractedLayerReady: true,
      nextStepReady: true,
      sourceStoragePath: 'brand-a/private/garment.png',
    },
    modelReferenceFileName: 'model-reference.png',
    bodyTypes: ['regular', 'plus'],
    ageGroups: ['20s', '30s'],
    gender: 'female',
  }));

  assert.deepEqual(
    fittingRows.filter((row) => ['衣服素材', '素材レイヤー', '切り抜き', 'モデル参照', 'モデル条件'].includes(row.label)),
    [
      { label: '衣服素材', value: 'linen-shirt.png' },
      { label: '素材レイヤー', value: '衣服全体 / 正面中央' },
      { label: '切り抜き', value: '生成準備完了' },
      { label: 'モデル参照', value: 'model-reference.png' },
      { label: 'モデル条件', value: 'regular/plus / 20s/30s / 女性' },
    ],
  );
  assert.equal(fittingRows.some((row) => row.value.includes('signed.example.test')), false);
  assert.equal(fittingRows.some((row) => row.value.includes('brand-a/private')), false);

  const materialRows = buildSourceContextSummaryRows(roundTripJson({
    sourceWorkspace: 'lightchain-material-workbench-provider-result',
    toolId: 'printing-image',
    generationIntent: { coverageMode: 'front', designCount: 2 },
    materialReferences: [
      { role: 'garment', hasImage: true, sourceStoragePath: 'brand-a/private/garment.png' },
      { role: 'print-artwork', hasImage: true, sourceStoragePath: 'brand-a/private/print.png' },
    ],
    maskPlan: { providerMaskReady: true, garmentCutoutReady: true },
  }));

  assert.deepEqual(
    materialRows.filter((row) => ['対象', '入力素材', '配置範囲', 'プリント数', '衣服領域', '切り抜き'].includes(row.label)),
    [
      { label: '対象', value: 'プリントイメージ' },
      { label: '入力素材', value: '衣服素材 / プリント素材' },
      { label: '配置範囲', value: 'front' },
      { label: 'プリント数', value: '2' },
      { label: '衣服領域', value: 'providerマスク確認済み' },
      { label: '切り抜き', value: '確認済み' },
    ],
  );
  assert.equal(materialRows.some((row) => row.value.includes('brand-a/private')), false);
});

test('generic non-video workbench provider summaries expose tool inputs and conditions', () => {
  const rows = buildSourceContextSummaryRows(roundTripJson({
    sourceWorkspace: 'lightchain-workbench-provider-result',
    toolTitle: '画像修正',
    generationSummary: '顔の歪み / 自動補正',
    brief: '自然な補正結果を作る',
    materialReferences: [
      { slotKey: 'primary', fileName: 'model-shot.png', hasImage: true, imageUrl: 'https://signed.example.test/image.png' },
      { slotKey: 'secondary', fileName: 'pose-reference.png', hasImage: true },
    ],
    modelFormState: { gender: '女性', age: '20代', bodyType: 'レギュラー' },
  }));

  assert.deepEqual(
    rows.filter((row) => ['ツール', '生成条件', '依頼', '入力素材', 'モデル条件'].includes(row.label)),
    [
      { label: 'ツール', value: '画像修正' },
      { label: '生成条件', value: '顔の歪み / 自動補正' },
      { label: '依頼', value: '自然な補正結果を作る' },
      { label: '入力素材', value: 'model-shot.png / pose-reference.png' },
      { label: 'モデル条件', value: '女性 / 20代 / レギュラー' },
    ],
  );
  assert.equal(rows.some((row) => row.value.includes('signed.example.test')), false);
});
