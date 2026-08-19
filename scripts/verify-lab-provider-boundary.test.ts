import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Lab workspace hands off to its admitted Lightchain provider route', async () => {
  const labPage = await readFile(new URL('../src/pages/LabPage.tsx', import.meta.url), 'utf8');
  const handoff = await readFile(new URL('../src/lib/workspaceHandoff.ts', import.meta.url), 'utf8');
  const workbench = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

  assert.match(labPage, /buildLightchainToolHref/);
  assert.match(labPage, /toolId: 'lab'/);
  assert.match(labPage, /feature: 'lab'/);
  assert.match(labPage, /ラボで試す/);
  assert.doesNotMatch(labPage, /buildGenerationIntentHref/);
  assert.doesNotMatch(labPage, /feature:\s*'campaign-image'/);
  assert.doesNotMatch(labPage, /campaign-image/);
  assert.match(handoff, /export const buildLightchainToolHref/);
  assert.match(handoff, /return `\/lightchain\/\$\{encodeURIComponent\(toolId\)\}\?/);
  assert.match(workbench, /hydrateGenerationIntentSource\(searchParams\)/);
  assert.match(workbench, /setWorkspaceText\(briefParam\)/);
});
