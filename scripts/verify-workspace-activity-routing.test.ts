import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('workspace activity unwraps artifact metadata for shared Jobs and History readback', async () => {
  const source = await read('../src/lib/workspaceActivity.ts');
  assert.match(source, /getWorkspaceActivityMetadata/);
  assert.match(source, /const embedded = root\.metadata/);
  assert.match(source, /return \{ \.\.\.root, \.\.\.\(embedded as Record<string, Json \| undefined>\) \} as Json/);
  assert.match(source, /buildSourceContextSummaryRows\(getWorkspaceActivityMetadata\(metadata\)\)/);
});

test('Lightchain Jobs resume on their tool route with persisted brief and reference note', async () => {
  const source = await read('../src/lib/workspaceActivity.ts');
  assert.match(source, /const lightchainFeature = job\.feature_type\.match\(\/\^lightchain-\(\.\+\?\)\(\?:-provider-result\)\?\$\/\)/);
  assert.match(source, /return `\/lightchain\/\$\{encodeURIComponent\(lightchainFeatureId\)\}\?\$\{params\.toString\(\)\}`/);
  assert.match(source, /params\.set\('brief', brief\)/);
  assert.match(source, /params\.set\('referenceNote', referenceNote\)/);
});

test('generic provider jobs resume through their persisted Lightchain feature identity', async () => {
  const source = await read('../src/lib/workspaceActivity.ts');
  assert.match(source, /const getLightchainCompatFeatureId =/);
  assert.match(source, /metadata\.lightchainCompat/);
  assert.match(source, /getMetadataString\(compat as Json \| null \| undefined, 'lightchainFeatureId'\)/);
  assert.match(source, /const persistedLightchainFeatureId = getLightchainCompatFeatureId\(metadata\)/);
  assert.match(source, /const lightchainFeatureId = persistedLightchainFeatureId/);
  assert.match(source, /encodeURIComponent\(lightchainFeatureId\)/);
});

test('Activity timeline and Dashboard use the same canonical Gallery selection key', async () => {
  const activity = await read('../src/lib/workspaceActivity.ts');
  const dashboard = await read('../src/pages/DashboardPage.tsx');
  assert.match(activity, /getGeneratedImageSelectionKey\(\{[\s\S]*storage_path: output\.storagePath/);
  assert.match(dashboard, /getGeneratedImageSelectionKey\(image\)/);
  assert.match(dashboard, /encodeURIComponent\(getGeneratedImageSelectionKey\(image\)\)/);
});

test('Heavy Chain task steps survive remote-image to local-artifact fallback', async () => {
  const activity = await read('../src/lib/workspaceActivity.ts');
  assert.match(activity, /const mergeLightchainTaskSteps =/);
  assert.match(activity, /const remoteImageId = getMetadataString\(output\.metadata, 'remoteImageId'\)/);
  assert.match(activity, /lightchainStepsByImage\[remoteImageId\]/);
  assert.match(activity, /output\.job_id \? lightchainStepsByJob\[output\.job_id\]/);
  assert.match(activity, /return mapOutput\(output, outputSteps\)/);
});

test('Lightchain workbench accepts a resumeJob readback without a legacy source handoff', async () => {
  const source = await read('../src/pages/LightchainWorkbenchPage.tsx');
  assert.match(source, /const resumeJob = searchParams\.get\('resumeJob'\)/);
  assert.match(source, /if \(!briefParam && !resumeJob\) return/);
  assert.match(source, /readLightchainResumeInput\(listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\), resumeJob\)/);
  assert.match(source, /data-testid="lightchain-resume-input-unavailable"/);
  assert.match(source, /sourceResumePath: `\/lightchain\/\$\{selectedTool\.id\}`/);
});

test('model-matrix Fitting jobs resume to the Fitting lane with saved conditions', async () => {
  const activity = await read('../src/lib/workspaceActivity.ts');
  const fitting = await read('../src/pages/FittingPage.tsx');
  assert.match(activity, /sourceResumePath === '\/fitting'/);
  assert.match(activity, /return `\/fitting\?\$\{params\.toString\(\)\}`/);
  assert.match(activity, /getMetadataStringList\(metadata, 'bodyTypes'\)/);
  assert.match(activity, /getMetadataStringList\(metadata, 'ageGroups'\)/);
  assert.match(fitting, /useSearchParams/);
  assert.match(fitting, /const resumeJob = searchParams\.get\('resumeJob'\)/);
  assert.match(fitting, /sourceResumePath: '\/fitting'/);
});

test('workspace handoff Canvas objects retain the persisted artifact/job identity', async () => {
  const handoff = await read('../src/lib/workspaceHandoff.ts');
  const marketing = await read('../src/pages/MarketingWorkspacePage.tsx');
  assert.match(handoff, /sourceArtifactId: artifact\.id,[\s\S]*sourceJobId: artifact\.sourceJobId \?\? null/);
  assert.match(marketing, /let persistedArtifactId: string \| null = null/);
  assert.match(marketing, /persistedSourceJobId = result\.artifact\.sourceJobId/);
  assert.match(marketing, /sourceArtifactId: persistedArtifactId/);
});
