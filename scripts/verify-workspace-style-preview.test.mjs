import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

test('fashion studio preview is scoped to the fashion-studio workspace', () => {
  const start = source.indexOf('const handleWorkspaceStyleGenerate = async () => {');
  const end = source.indexOf('const handleProjectHomeGenerate', start);
  assert.notEqual(start, -1, 'workspace style handler is required');
  const handler = source.slice(start, end === -1 ? source.length : end);
  assert.match(handler, /selectedTool\.id === 'fashion-studio'/);
  assert.match(handler, /workspaceSummary/);
  assert.match(handler, /activeWorkspaceTab/);
  assert.match(handler, /await handleLightchainPreviewGenerate/);
  assert.doesNotMatch(handler, /buildFashionStudioPreviewDataUrl/);
  assert.doesNotMatch(handler, /buildGenericWorkspacePreviewDataUrl/);
});
