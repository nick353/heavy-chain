import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSourcePath = new URL('../src/pages/MarketingWorkspacePage.tsx', import.meta.url);
const workbenchSourcePath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);

test('marketing workspace project cards are persisted and resumable', async () => {
  const source = await readFile(pageSourcePath, 'utf8');

  assert.match(source, /listWorkspaceArtifacts/);
  assert.match(source, /artifact\.featureType === 'marketing-workflow'/);
  assert.match(source, /data-testid="marketing-project-card"/);
  assert.match(source, /buildMarketingProjectHref/);
  assert.match(source, /projectName: artifact\.title/);
  assert.match(source, /data-testid="marketing-project-empty"/);
  assert.doesNotMatch(source, /24SS Linen Launch/);
  assert.doesNotMatch(source, /Holiday Capsule Poster/);
  assert.doesNotMatch(source, /Live Commerce Kit/);
});

test('marketing-detail restores persisted project name and brief from the card route', async () => {
  const source = await readFile(workbenchSourcePath, 'utf8');

  assert.match(source, /searchParams\.get\('projectName'\)/);
  assert.match(source, /setMarketingProjectName\(projectNameParam\.slice\(0, 80\)\)/);
  assert.match(source, /if \(toolId === 'marketing-detail'\) setMarketingDetailPrompt\(briefParam\)/);
});
