import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readOptionalWorkspaceValue } from '../src/lib/workspaceReadRecovery.ts';
import { withSupabaseSessionRecovery } from '../src/lib/supabaseSessionRecovery.ts';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('workspace activity unwraps artifact metadata for shared Jobs and History readback', async () => {
  const source = await read('../src/lib/workspaceActivity.ts');
  assert.match(source, /getWorkspaceActivityMetadata/);
  assert.match(source, /const embedded = root\.metadata/);
  assert.match(source, /return \{ \.\.\.root, \.\.\.\(embedded as Record<string, Json \| undefined>\) \} as Json/);
  assert.match(source, /buildSourceContextSummaryRows\(getWorkspaceActivityMetadata\(metadata\)\)/);
});

test('workspace activity recovers each settled Supabase read before aggregating failures', async () => {
  const source = await read('../src/lib/workspaceActivity.ts');
  const recovery = await read('../src/lib/workspaceReadRecovery.ts');
  assert.match(source, /withSupabaseSessionRecovery\(\(\) => fetchCreditSummary\(brandId\)\)/);
  assert.match(source, /withSupabaseSessionRecovery\(\(\) => fetchJobs\(brandId\)\)/);
  assert.match(source, /withSupabaseSessionRecovery\(\(\) => fetchOutputs\(brandId\)\)/);
  assert.match(source, /withSupabaseSessionRecovery\(\(\) => fetchLightchainTaskSteps\(brandId\)\)/);
  assert.match(source, /Promise\.allSettled\(\[[\s\S]*original 401\/expired-token signal/);
  assert.match(recovery, /if \(isSupabaseAuthFailure\(error\)\) throw error/);
});

test('optional task-step reads preserve auth failures for one coordinated refresh and retry', async () => {
  let operationCalls = 0;
  let refreshCalls = 0;
  const logged: unknown[] = [];

  const result = await withSupabaseSessionRecovery(
    () => readOptionalWorkspaceValue(
      async () => {
        operationCalls += 1;
        if (operationCalls === 1) throw { status: 401, message: 'JWT expired' };
        return [{ id: 'step-after-refresh' }];
      },
      [],
      (error) => logged.push(error),
    ),
    async () => {
      refreshCalls += 1;
      return { access_token: 'refreshed' };
    },
  );

  assert.deepEqual(result, [{ id: 'step-after-refresh' }]);
  assert.equal(operationCalls, 2);
  assert.equal(refreshCalls, 1);
  assert.equal(logged.length, 1);
});

test('optional workspace reads still use their fallback for non-auth failures', async () => {
  const logged: unknown[] = [];
  const result = await readOptionalWorkspaceValue(
    async () => {
      throw new Error('temporary network failure');
    },
    [],
    (error) => logged.push(error),
  );

  assert.deepEqual(result, []);
  assert.equal(logged.length, 1);
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

test('provider artifacts reconstruct a completed Jobs entry when no generation_jobs row exists', async () => {
  const activity = await read('../src/lib/workspaceActivity.ts');
  assert.match(activity, /const buildLocalWorkspaceJobs =/);
  assert.match(activity, /listWorkspaceArtifacts\(brandId, scopeId\)/);
  assert.match(activity, /artifact\.sourceJobId \?\? getMetadataString\(artifact\.metadata, 'remoteJobId'\)/);
  assert.match(activity, /const localJobs = buildLocalWorkspaceJobs\(localArtifacts, new Set\(jobs\.map\(\(job\) => job\.id\)\)\)/);
  assert.match(activity, /\[\.\.\.jobs, \.\.\.localJobs\]\.map/);
});

test('Lightchain workbench accepts a resumeJob readback without a legacy source handoff', async () => {
  const source = await read('../src/pages/LightchainWorkbenchPage.tsx');
  assert.match(source, /const resumeJob = searchParams\.get\('resumeJob'\)/);
  assert.match(source, /if \(!briefParam && !resumeJob\) \{[\s\S]{0,180}cancelled = true/);
  assert.match(source, /const artifacts = listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\)/);
  assert.match(source, /readLightchainResumeInput\(artifacts, resumeJob\)/);
  assert.match(source, /readLightchainResumeResult\(artifacts, resumeJob\)/);
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
