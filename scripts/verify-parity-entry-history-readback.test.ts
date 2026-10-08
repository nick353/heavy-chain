import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Lightchain parity entry pages read persisted local history without seed records', async () => {
  const source = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');

  assert.match(source, /function PersistedHistoryPanel/);
  assert.match(source, /listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\)/g);
  assert.match(source, /designHistoryFeatureTypes/);
  assert.match(source, /cloudflareDataPlane\.listGeneratedImages\(brandId, \{/);
  assert.match(source, /return remoteRows\.map\(asGeneratedImageListRow\)/);
  assert.match(source, /signRemoteArtifacts: \(rows\) => withSignedImageUrls\(\[\.\.\.rows\]\)/);
  assert.match(source, /generatedImageToWorkspaceArtifact/);
  assert.match(source, /remoteImageId: image\.id/);
  // Saved results are re-read from the server list rather than merged into local state.
  assert.match(source, /deleteGeneratedImage\(remoteImageId/);
  assert.doesNotMatch(source, /setPersistedDesignArtifacts\(listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\)/);
  assert.match(source, /fittingHistoryFeatureTypes/);
  assert.match(source, /data-testid="creator-persisted-history"/);
  assert.match(source, /data-testid="model-persisted-history"/);
  // Wear Design Lab lists saved projects as cards (useFeatureProjects) instead of a history panel.
  assert.match(source, /useFeatureProjects\('wear-design-lab'\)/);
  assert.match(source, /data-testid="design-production-persisted-projects"/);
  assert.match(source, /sourceArtifactId=\$\{encodeURIComponent\(artifact\.id\)\}/);
  assert.match(source, /resumeJob=\$\{encodeURIComponent\(artifact\.sourceJobId \?\? artifact\.id\)\}/);
  assert.doesNotMatch(source, /サンプルプロジェクト/);
  assert.doesNotMatch(source, /2026AW アウター企画/);
});

console.log('parity entry history readback test: 1/1 passed');
