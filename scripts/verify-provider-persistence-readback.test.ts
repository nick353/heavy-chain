import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertCompletedImageEditResult,
  assertCompletedModelMatrixResult,
} from '../src/lib/providerResultReadback.ts';

const completedImage = {
  success: true,
  imageUrl: 'https://example.test/generated.png',
  persistenceStatus: 'completed' as const,
  requestedCandidateCount: 1,
  persistedCandidateCount: 1,
  images: [{ imageUrl: 'https://example.test/generated.png', persistenceStatus: 'completed' as const }],
};

test('image-edit promotion requires completed persistence and a materialized image', () => {
  assert.doesNotThrow(() => assertCompletedImageEditResult(completedImage));
  assert.throws(
    () => assertCompletedImageEditResult({ ...completedImage, persistenceStatus: 'partial' }),
    /persistence_incomplete:partial/,
  );
  assert.throws(
    () => assertCompletedImageEditResult({ ...completedImage, imageUrl: '' }),
    /image_missing/,
  );
  assert.throws(
    () => assertCompletedImageEditResult({ ...completedImage, requestedCandidateCount: 4, persistedCandidateCount: 1 }),
    /persisted_candidate_count_incomplete/,
  );
});

test('model-matrix promotion requires completed persistence for every matrix item', () => {
  const result = {
    success: true,
    persistenceStatus: 'completed' as const,
    matrix: [{
      bodyType: 'regular',
      bodyTypeName: '標準',
      ageGroup: '20s',
      ageGroupName: '20代',
      imageUrl: 'https://example.test/model.png',
      storagePath: 'user-a/brand-a/model-matrix-1.png',
      persistenceStatus: 'completed' as const,
    }],
  };
  assert.doesNotThrow(() => assertCompletedModelMatrixResult(result));
  assert.throws(
    () => assertCompletedModelMatrixResult({ ...result, persistenceStatus: 'processing' }),
    /persistence_incomplete:processing/,
  );
  assert.throws(
    () => assertCompletedModelMatrixResult({
      ...result,
      matrix: [{ ...result.matrix[0], persistenceStatus: 'failed' as const }],
    }),
    /matrix_incomplete/,
  );
  assert.throws(
    () => assertCompletedModelMatrixResult({
      ...result,
      matrix: [{ ...result.matrix[0], storagePath: null }],
    }),
    /storage_path_missing/,
  );
});

test('all direct provider promotion paths use the shared readback guards', async () => {
  const [workbench, material, fitting, canvas] = await Promise.all([
    readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(workbench, /assertCompletedImageEditResult/);
  assert.match(workbench, /assertCompletedModelMatrixResult/);
  assert.match(material, /assertCompletedImageEditResult/);
  assert.match(fitting, /assertCompletedModelMatrixResult/);
  assert.match(canvas, /assertCompletedImageEditResult/);
});

test('direct provider result history promotion requires a durable artifact readback first', async () => {
  const [workbench, material, persistence] = await Promise.all([
    readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/providerResultPersistence.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(workbench, /persistProviderResultArtifact/);
  assert.match(material, /persistProviderResultArtifact/);
  assert.match(workbench, /sourceProviderResultArtifactId: lightchainResult\?\.artifactId/);
  assert.match(material, /sourceProviderResultArtifactId: result\.artifactId/);
  assert.match(persistence, /saveWorkspaceArtifactBestEffort/);
  assert.match(persistence, /!result\.remote && !result\.localPersisted/);

  const workbenchPersistence = workbench.lastIndexOf('persistProviderResultArtifact({');
  const workbenchPromotion = workbench.lastIndexOf('setLightchainResult({');
  const materialPersistence = material.lastIndexOf('persistProviderResultArtifact({');
  const materialPromotion = material.lastIndexOf('setGeneratedResults((previous)');
  assert.ok(workbenchPersistence >= 0 && workbenchPromotion > workbenchPersistence);
  assert.ok(materialPersistence >= 0 && materialPromotion > materialPersistence);
});

test('provider persistence reuses an owned canonical storage path and fails closed when remote persistence is required', async () => {
  const [artifacts, persistence, edge, workbench, material] = await Promise.all([
    readFile(new URL('../src/lib/localWorkspaceArtifacts.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/providerResultPersistence.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/marketing-workspace-artifact/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(artifacts, /sourceStoragePath:/);
  assert.match(artifacts, /getWorkspaceArtifactCanonicalStoragePath/);
  assert.match(artifacts, /findNestedCanonicalStoragePath/);
  assert.match(artifacts, /depth > 6/);
  assert.match(persistence, /requireRemote\?: boolean/);
  assert.match(persistence, /provider_result_remote_persistence_unverified/);
  assert.match(persistence, /deleteWorkspaceArtifact/);
  assert.match(persistence, /reuseCanonicalRemoteArtifact\?: boolean/);
  assert.match(persistence, /providerStoragePath/);
  assert.match(artifacts, /reuseCanonicalRemoteArtifact === false/);
  assert.match(edge, /normalizeGeneratedImageStoragePath/);
  assert.match(edge, /Source storage path is outside the current brand scope/);
  assert.match(edge, /existingImage/);
  assert.match(edge, /storagePath:\s*canonicalSourceStoragePath/);
  assert.match(edge, /storage_path:\s*storagePath/);
  assert.match(edge, /\.eq\('id', generatedImageId\)/);
  assert.match(edge, /if \(storageUploaded && storagePath\)/);
  assert.doesNotMatch(edge, /if \(storageUploaded && storagePath\)\s*\{[\s\S]*\.from\('generation_jobs'\)/);
  assert.equal((workbench.match(/requireRemote: true/g) ?? []).length, 2);
  assert.match(material, /requireRemote: true/);
  assert.match(material, /reuseCanonicalRemoteArtifact: false/);
  assert.match(material, /jobId: persistedProviderArtifact\.remote\?\.jobId/);
  assert.match(material, /storagePath: persistedProviderArtifact\.remote\?\.storagePath/);
  assert.match(material, /const canvasArtifactImageUrl = result\.storagePath \? '' : result\.imageUrl/);
  assert.match(material, /imageUrl: canvasArtifactImageUrl/);
  assert.match(material, /remoteStoragePath: result\.storagePath \?\? null/);
  assert.match(workbench, /jobId: persistedResult\.remote\?\.jobId/);
  assert.match(workbench, /storagePath: persistedResult\.remote\?\.storagePath/);
  assert.match(workbench, /remoteStoragePath: lightchainResult\?\.storagePath/);
  assert.match(workbench, /remoteImageId: lightchainResult\?\.imageId/);
  assert.match(workbench, /galleryStoragePath:\s*lightchainResult\.storagePath/);
  assert.match(workbench, /galleryImageId:\s*lightchainResult\.imageId/);
});

test('derived protected composites keep provider provenance separate from Gallery identity', async () => {
  const [artifacts, persistence] = await Promise.all([
    readFile(new URL('../src/lib/localWorkspaceArtifacts.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/providerResultPersistence.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(artifacts, /'remoteStoragePath',\s*'storagePath'/);
  assert.match(persistence, /providerStoragePath: reuseCanonicalRemoteArtifact \? input\.metadata\?\.providerStoragePath \?\? null : providerStoragePath/);
  assert.match(persistence, /storagePath: reuseCanonicalRemoteArtifact \? providerStoragePath : null/);
});

test('material provider parity runtime survives result, remote artifact, History, and Canvas promotion', async () => {
  const material = await readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');
  const history = await readFile(new URL('../src/lib/printResultHistoryPersistence.ts', import.meta.url), 'utf8');
  assert.match(material, /parityRuntime\?: ReturnType<typeof serializeLightchainParityRuntime>/);
  assert.match(material, /const parityRuntimeJson = serializeLightchainParityRuntime\(parityRuntime\)/);
  assert.match(material, /fixtureId: \[\s*isPrinting \? printGarment!\.url : fabricDesign!\.url/);
  assert.match(material, /parityRuntime: parityRuntimeJson/);
  assert.match(material, /const inputLineage: MaterialInputLineage\[\] = isPrinting/);
  assert.match(material, /sourceImageId: printGarment\?\.galleryImageId \?\? null/);
  assert.match(material, /sourceStoragePath: fabricBase\?\.storagePath \?\? null/);
  assert.match(material, /inputLineage: result\.inputLineage \?\? \[\]/);
  assert.match(material, /const parityRuntimeJson = result\.parityRuntime \?\?/);
  const canvasPromotion = material.lastIndexOf("feature: 'lightchain-material-provider'");
  assert.ok(canvasPromotion >= 0);
  assert.match(material.slice(canvasPromotion, canvasPromotion + 1800), /parityRuntime: parityRuntimeJson/);
  assert.match(history, /parityRuntime\?: PersistedParityRuntime/);
});

test('fabric provider artifacts restore the same result contract into History and can be cleared durably', async () => {
  const material = await readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(material, /FABRIC_PROVIDER_RESULT_FEATURE_TYPE = 'lightchain-fabric-image-provider-result'/);
  assert.match(material, /listWorkspaceGeneratedImages\(brandId, user\?\.id\)/);
  assert.match(material, /withSignedImageUrls\(persistedImages\)/);
  assert.match(material, /metadata\.providerResultArtifact !== true/);
  assert.match(material, /resultKind: 'provider'/);
  assert.match(material, /outputSize: restoredMaterialOutputSize\(metadata\.outputSize\)/);
  assert.match(material, /artifactId: image\.id/);
  assert.match(material, /deleteWorkspaceArtifactsPersisted\(currentBrand\.id, artifactIds, user\?\.id\)/);
  assert.match(
    material,
    /inputImageCount: result\.inputImageCount \?\? null,[\s\S]{0,180}outputSize: result\.outputSize \?\? null,/,
  );
});

test('main Workbench provider parity runtime survives result and later Canvas promotion', async () => {
  const workbench = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(workbench, /parityRuntime\?: ReturnType<typeof serializeLightchainParityRuntime>/);
  assert.match(workbench, /const parityRuntime = buildCurrentParityRuntime\(\)/);
  assert.match(workbench, /parityRuntime: serializeLightchainParityRuntime\(parityRuntime\)/);
  assert.match(workbench, /const parityRuntimeJson = lightchainResult\?\.parityRuntime/);
  assert.match(workbench, /parityRuntime: lightchainResult\.parityRuntime \?\? parityRuntimeJson/);
});

test('fitting and Canvas derived edits preserve the captured parity runtime', async () => {
  const [fitting, canvas] = await Promise.all([
    readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(fitting, /rowId: 'ai-fitting'/);
  assert.match(fitting, /const parityRuntimeJson = serializeLightchainParityRuntime/);
  assert.match(fitting, /const providerCompositionPreview =/);
  assert.match(fitting, /compositionPreview: providerCompositionPreview/);
  assert.match(canvas, /const parityRuntime = getParityRuntimeForObject/);
  assert.match(canvas, /const parityRuntime = sourceObject\?\.metadata\?\.parityRuntime/);
  assert.match(canvas, /\.\.\.\(parityRuntime \? \{ parityRuntime \} : \{\}\)/);
  assert.match(canvas, /\.\.\.\(parityRuntime \? \{ parityRuntime \} : \{\}\),\n\s{6}lightchainEditStages/);
});

test('GeneratePage direct provider results preserve the provider receipt into artifacts and Canvas', async () => {
  const [generate, canvas] = await Promise.all([
    readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(generate, /const getGeneratedProviderReceipt =/);
  assert.match(generate, /const getGeneratedResultReceiptMetadata =/);
  assert.match(generate, /getGeneratedProviderReceipt\(data, image\)/);
  assert.match(generate, /providerModel: image\.providerModel \?\? null/);
  assert.match(generate, /persistenceStatus: image\.persistenceStatus \?\? null/);
  assert.match(generate, /\.\.\.getGeneratedResultReceiptMetadata\(image\),\n\s+\.\.\.materialHandoffMetadata/);
  assert.match(canvas, /provider: image\.provider \|\| null/);
  assert.match(canvas, /persistenceStatus: image\.persistenceStatus \|\| null/);
});

test('fitting model-matrix promotion requires local artifact readback before result or history promotion', async () => {
  const fitting = await readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');
  assert.match(fitting, /saveWorkspaceArtifactPersisted/);
  assert.match(fitting, /deleteWorkspaceArtifactsPersisted\(currentBrand\.id, attemptedArtifactIds, user\?\.id\)/);
  assert.match(fitting, /if \(!persisted\.ok\)/);

  const persistenceGate = fitting.indexOf('if (!persisted.ok)');
  const resultPromotion = fitting.indexOf('setResultMatrix(matrix)');
  const historyPromotion = fitting.indexOf('setHistory((items)');
  assert.ok(persistenceGate >= 0);
  assert.ok(resultPromotion > persistenceGate);
  assert.ok(historyPromotion > persistenceGate);
});
