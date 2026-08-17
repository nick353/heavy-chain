import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspacePages = [
  '../src/pages/FashionStudioPage.tsx',
  '../src/pages/ModelLibraryPage.tsx',
  '../src/pages/VideoWorkstationPage.tsx',
  '../src/pages/PatternWorkspacePage.tsx',
  '../src/pages/LabPage.tsx',
] as const;

test('workspace History never uses fixed seed rows after reload', async () => {
  const [handoff, ...pages] = await Promise.all([
    readFile(new URL('../src/lib/workspaceHandoff.ts', import.meta.url), 'utf8'),
    ...workspacePages.map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
  ]);

  assert.match(handoff, /listWorkspaceArtifacts\(brandId(?:,\s*scopeId)?\)/);
  assert.match(handoff, /candidate\.featureType === featureType/);
  assert.match(handoff, /const history = artifact\?\.metadata\.history/);
  assert.match(handoff, /export const restoreWorkspaceHandoffHistory/);
  for (const page of pages) {
    assert.doesNotMatch(page, /const initialHistory/);
    assert.match(page, /restoreWorkspaceHandoffHistory\(currentBrand\?\.id/);
    assert.match(page, /useState<HistoryItem\[\]>\(\[\]\)/);
  }
});

test('video History restoration remains separate from unsupported provider admission', async () => {
  const video = await readFile(new URL('../src/pages/VideoWorkstationPage.tsx', import.meta.url), 'utf8');
  assert.match(video, /video_provider_not_admitted: 動画providerの利用可能状態が未確認です/);
  assert.match(video, /providerRoute: 'unsupported'/);
  assert.match(video, /restoreWorkspaceHandoffHistory\(currentBrand\?\.id, 'video-workstation'(?:,\s*user\?\.id)?\)/);
  assert.doesNotMatch(video, /setHistory\(initialHistory\)/);
});
