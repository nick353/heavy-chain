import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');

test('fabric local previews persist with explicit preview provenance and restore with the same result contract', () => {
  assert.match(page, /FABRIC_LOCAL_RESULT_FEATURE_TYPE = 'lightchain-fabric-image-local-result'/);
  assert.match(page, /localPreviewArtifact: true/);
  assert.match(page, /generationMode: 'preview'/);
  assert.match(page, /backendProvider: 'browser-local-fabric-composition-v1'/);
  assert.match(page, /saveWorkspaceArtifactPersisted\(/);
  assert.match(page, /const localJobId = `local-fabric-preview-job-\$\{Date\.now\(\)\}`/);
  assert.match(page, /sourceJobId: localJobId/);
  assert.match(page, /localJobId,/);
  assert.match(page, /jobId: localJobId/);
  assert.match(page, /deleteWorkspaceArtifactsPersisted\(\s*generationBrand\.id/);
  assert.match(page, /FABRIC_RESULT_FEATURE_TYPES\.has\(image\.feature_type\)/);
  assert.match(page, /resultKind: isLocalPreview \? 'fabric' : 'provider'/);
  assert.match(page, /persistenceStatus: jsonString\(metadata\.persistenceStatus\) \?\? \(isLocalPreview \? 'completed' : null\)/);
  assert.match(page, /inputLineage: localInputLineage/);
  assert.match(page, /parityRuntime: localParityRuntime/);
  assert.match(page, /const isLocalFabricPreview = result\.generationMode === 'preview'/);
  assert.match(page, /const canvasArtifactFeatureType = isLocalFabricPreview/);
  assert.match(page, /featureType: canvasArtifactFeatureType/);
  assert.match(page, /lightchain-material-local-preview-v1/);
  assert.match(page, /sourceLocalPreviewArtifactId/);
});

test('local preview restoration keeps provider artifacts distinct', () => {
  assert.match(page, /if \(!isLocalPreview && metadata\.providerResultArtifact !== true\) return null/);
  assert.match(page, /isLocalPreview \? 'preview' : 'provider'/);
  assert.match(page, /isLocalPreview \? 'browser-local-fabric-composition-v1' : jsonString\(metadata\.backendProvider\)/);
});

test('local preview results expose a completed Jobs lineage without provider provenance', async () => {
  const activity = await readFile(new URL('../src/lib/workspaceActivity.ts', import.meta.url), 'utf8');
  assert.match(activity, /'lightchain-fabric-image-local-result': '生地イメージ（ローカルプレビュー）'/);
  assert.match(activity, /const jobId = artifact\.sourceJobId \?\? getMetadataString\(artifact\.metadata, 'remoteJobId'\)/);
  assert.match(activity, /status: 'completed'/);
});
