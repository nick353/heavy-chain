import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workbenchSourcePath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);



test('marketing-detail restores persisted project name and brief from the card route', async () => {
  const source = await readFile(workbenchSourcePath, 'utf8');

  assert.match(source, /searchParams\.get\('projectName'\)/);
  assert.match(source, /setMarketingProjectName\(projectNameParam\.slice\(0, ?80\)\)/);
  assert.match(source, /if \(selectedTool\.id === 'marketing-detail'\) setMarketingDetailPrompt\(briefParam\)/);
});
