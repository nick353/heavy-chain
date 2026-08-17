import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('GeneratePage does not report success without a materialized result', async () => {
  const source = await readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const assertMaterializedGeneratedImages = \(images: readonly GeneratedResult\[\]\) => \{/);
  assert.match(source, /if \(images\.length === 0\) throw new Error\('generation_result_missing'\)/);
  assert.match(source, /generation_result_image_url_missing/);
  assert.match(source, /if \(selectedFeature\?\.id !== 'optimize-prompt'\) \{\s*assertGeneratedResponseAccepted\(data\);\s*assertMaterializedGeneratedImages\(newGeneratedImages\);/);
  assert.match(source, /assertMaterializedGeneratedImages\(newGeneratedImages\);/);
  assert.match(source, /assertGeneratedResponseAccepted\(result\);/);
});

test('GeneratePage fails closed for incomplete backend persistence', async () => {
  const source = await readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  assert.match(source, /response\?\.persistenceStatus === 'failed' \|\| response\?\.persistenceStatus === 'partial'/);
  assert.match(source, /generation_persisted_candidate_count_incomplete/);
  assert.match(source, /response\.persistedCandidateCount < response\.requestedCandidateCount/);
});

test('GeneratePage requires local artifact readback before history or success promotion', async () => {
  const source = await readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  assert.match(source, /saveWorkspaceArtifactPersisted/);
  assert.match(source, /deleteWorkspaceArtifactsPersisted\(currentBrand\.id, attemptedArtifactIds, user\?\.id\)/);
  assert.match(source, /workspace_artifact_persistence_unverified/);

  const persistenceGate = source.indexOf('const saveLocalArtifactsWithReadback');
  const historyPromotion = source.lastIndexOf('addToHistory(promptToSave');
  const successPromotion = source.lastIndexOf("setShowSuccessCard(true);\n        toast.success('生成が完了しました');");
  assert.ok(persistenceGate >= 0);
  assert.ok(historyPromotion > persistenceGate);
  assert.ok(successPromotion > persistenceGate);
});

test('GeneratePage stages generated images and commits them only after artifact readback', async () => {
  const source = await readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  const replaceStart = source.indexOf('const replaceGeneratedImages =');
  const prependStart = source.indexOf('const prependGeneratedImages =', replaceStart);
  const commitStart = source.indexOf('const commitGeneratedImagesAfterReadback =');
  const persistenceStart = source.indexOf('const saveLocalArtifactsWithReadback =');

  assert.ok(replaceStart >= 0);
  assert.ok(prependStart > replaceStart);
  assert.ok(commitStart > persistenceStart);
  assert.doesNotMatch(source.slice(replaceStart, prependStart), /setGeneratedImages/);
  assert.match(source.slice(commitStart, commitStart + 700), /setGeneratedImages/);
  assert.match(source, /saveLocalArtifactsWithReadback\(geminiResults\.map/);
  assert.match(source, /saveLocalArtifactsWithReadback\(newGeneratedImages\.map/);
  assert.match(source, /saveLocalArtifactsWithReadback\(newGeneratedImages\.map/);
  assert.match(source, /commitGeneratedImagesAfterReadback\(\);/);
});
