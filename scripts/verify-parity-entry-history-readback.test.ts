import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Lightchain parity entry pages read persisted local history without seed records', async () => {
  const source = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');

  assert.match(source, /function PersistedHistoryPanel/);
  assert.match(source, /listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\)/g);
  assert.match(source, /designHistoryFeatureTypes/);
  assert.match(source, /listGeneratedImages\(currentBrand\.id/);
  assert.match(source, /const listRows = remoteRows\.map\(asGeneratedImageListRow\)/);
  assert.match(source, /withSignedImageUrls\(listRows\)/);
  assert.match(source, /generatedImageToWorkspaceArtifact/);
  assert.match(source, /remoteImageId: image\.id/);
  assert.match(source, /mergeWorkspaceArtifact\(current, result\.artifact\)/);
  assert.match(source, /deleteGeneratedImage\(remoteImageId/);
  assert.doesNotMatch(source, /setPersistedDesignArtifacts\(listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\)/);
  assert.match(source, /fittingHistoryFeatureTypes/);
  assert.match(source, /data-testid="creator-persisted-history"/);
  assert.match(source, /data-testid="model-persisted-history"/);
  assert.match(source, /data-testid="oriented-design-persisted-history"/);
  assert.match(source, /data-testid="design-production-persisted-projects"/);
  assert.match(source, /sourceArtifactId=\$\{encodeURIComponent\(artifact\.id\)\}/);
  assert.match(source, /resumeJob=\$\{encodeURIComponent\(artifact\.sourceJobId \?\? artifact\.id\)\}/);
  assert.doesNotMatch(source, /サンプルプロジェクト/);
  assert.doesNotMatch(source, /2026AW アウター企画/);
});

console.log('parity entry history readback test: 1/1 passed');
