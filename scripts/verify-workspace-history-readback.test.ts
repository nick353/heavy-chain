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

test('History waits for auth and resolves a late brand before showing the empty state', async () => {
  const history = await readFile(new URL('../src/pages/HistoryPage.tsx', import.meta.url), 'utf8');

  assert.match(history, /isInitialized: authInitialized/);
  assert.match(history, /isLoading: authLoading/);
  assert.match(history, /if \(!authInitialized \|\| authLoading\)/);
  assert.match(history, /brand = await refreshCurrentBrand\(\)/);
  assert.match(history, /const brandId = brand\.id/);
  assert.match(history, /data-testid="history-brand-loading"/);
});

test('Jobs waits for auth and resolves a late brand before showing the empty state', async () => {
  const jobs = await readFile(new URL('../src/pages/JobsPage.tsx', import.meta.url), 'utf8');

  assert.match(jobs, /isInitialized: authInitialized/);
  assert.match(jobs, /isLoading: authLoading/);
  assert.match(jobs, /if \(!authInitialized \|\| authLoading\)/);
  assert.match(jobs, /brand = await refreshCurrentBrand\(\)/);
  assert.match(jobs, /const brandId = brand\.id/);
  assert.match(jobs, /data-testid="jobs-brand-loading"/);
});

test('Gallery waits for auth and resolves a late brand before showing an empty state', async () => {
  const gallery = await readFile(new URL('../src/pages/GalleryPage.tsx', import.meta.url), 'utf8');

  assert.match(gallery, /isInitialized: authInitialized/);
  assert.match(gallery, /isLoading: authLoading/);
  assert.match(gallery, /if \(!authInitialized \|\| authLoading\)/);
  assert.match(gallery, /brand = await refreshCurrentBrand\(\)/);
  assert.match(gallery, /fetchImages\(brand\)/);
  assert.match(gallery, /brandResolutionAttempted/);
});
