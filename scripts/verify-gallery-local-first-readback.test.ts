import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canClearMissingGallerySelection,
  resolveGallerySource,
  type GallerySourceRequest,
  type GallerySourceResolution,
  type GallerySourceRow,
} from '../src/lib/gallerySourceResolution.ts';

const galleryPage = await readFile(new URL('../src/pages/GalleryPage.tsx', import.meta.url), 'utf8');

type TestRow = GallerySourceRow & { brand_id: string; created_at: string; prompt: string };

const request: GallerySourceRequest = {
  sequence: 1,
  scope: { userId: 'user-1', brandId: 'brand-1', favoriteFilter: 'all', sortOrder: 'newest' },
};
const localRow: TestRow = {
  id: 'local-canvas-result',
  storage_path: 'generated-images/local-canvas-result',
  image_url: null,
  user_id: 'local-workspace',
  brand_id: 'brand-1',
  created_at: '2026-09-30T00:00:00.000Z',
  prompt: 'canvas output',
  metadata: { canvasProjectId: 'canvas-1' },
};

test('Gallery commits the local persisted snapshot through the production resolver before remote completion', async () => {
  let finishRemote!: (rows: TestRow[]) => void;
  let remoteStarted = false;
  const remote = new Promise<TestRow[]>((resolve) => { finishRemote = resolve; });
  const states: GallerySourceResolution<TestRow>[] = [];
  const run = resolveGallerySource({
    request,
    previous: { status: 'pending', scope: null, sequence: 0, rows: [], unavailablePreviewIds: [] },
    getCurrentContext: () => ({
      sequence: request.sequence,
      scope: request.scope,
      liveUserId: request.scope.userId,
      liveBrandId: request.scope.brandId,
    }),
    readLocalRows: () => [localRow],
    fetchRemoteRows: () => { remoteStarted = true; return remote; },
    signRows: async (rows) => rows,
    onState: (state) => states.push(state),
  });

  while (!remoteStarted) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(states[0].status, 'pending');
  assert.equal(states[0].rows[0].id, localRow.id);
  assert.ok(states.some((state) => state.status === 'pending' && state.rows.some((item) => item.id === localRow.id)));

  finishRemote([]);
  const final = await run;
  assert.equal(final?.status, 'resolved-rows');
  assert.equal(final?.rows[0].metadata?.canvasProjectId, 'canvas-1');
});

test('Gallery selection clearing waits for a successful resolution of the exact source scope', () => {
  const sourceBlock = galleryPage.slice(galleryPage.indexOf('const image = images.find'), galleryPage.indexOf('const handleDownload'));
  assert.match(sourceBlock, /canClearMissingGallerySelection\(sourceResolution, currentSourceScope\)/);
  assert.match(galleryPage, /const sourceFailed = sourceStatus === 'failed';/);

  const failed: GallerySourceResolution<TestRow> = {
    status: 'failed',
    scope: request.scope,
    sequence: request.sequence,
    rows: [localRow],
    unavailablePreviewIds: [],
  };
  assert.equal(canClearMissingGallerySelection(failed, request.scope), false);
  assert.equal(canClearMissingGallerySelection({ ...failed, status: 'resolved-empty', rows: [] }, request.scope), true);
  assert.equal(canClearMissingGallerySelection({ ...failed, status: 'resolved-empty', rows: [] }, {
    ...request.scope,
    favoriteFilter: 'favorites',
  }), false);
});

test('a null user cannot start Gallery local or remote source reads', async () => {
  const nullUserRequest: GallerySourceRequest = {
    sequence: 3,
    scope: { userId: null, brandId: 'brand-1', favoriteFilter: 'all', sortOrder: 'newest' },
  };
  let localReads = 0;
  let remoteReads = 0;
  let stateCommits = 0;
  let finallyCalls = 0;
  const result = await resolveGallerySource({
    request: nullUserRequest,
    previous: { status: 'pending', scope: null, sequence: 0, rows: [], unavailablePreviewIds: [] },
    getCurrentContext: () => ({
      sequence: nullUserRequest.sequence,
      scope: nullUserRequest.scope,
      liveUserId: null,
      liveBrandId: nullUserRequest.scope.brandId,
    }),
    readLocalRows: () => { localReads += 1; return [localRow]; },
    fetchRemoteRows: async () => { remoteReads += 1; return []; },
    signRows: async (rows) => rows,
    onState: () => { stateCommits += 1; },
    onFinally: () => { finallyCalls += 1; },
  });

  const fetchStart = galleryPage.indexOf('const fetchImages = useCallback');
  const localReadStart = galleryPage.indexOf('listWorkspaceGeneratedImages(', fetchStart);
  const remoteReadStart = galleryPage.indexOf('cloudflare.listGeneratedImages(', fetchStart);
  const nullUserGuard = galleryPage.indexOf('if (!brandOverride || !user?.id)', fetchStart);
  assert.ok(nullUserGuard >= 0 && nullUserGuard < localReadStart && nullUserGuard < remoteReadStart);
  assert.equal(result, null);
  assert.equal(localReads, 0);
  assert.equal(remoteReads, 0);
  assert.equal(stateCommits, 0);
  assert.equal(finallyCalls, 0);
});

test('source failure UI offers read-only retry and avoids the genuine-empty Generate call to action', () => {
  const errorStart = galleryPage.indexOf('{sourceFailed ? (');
  const errorEnd = galleryPage.indexOf(') : null}', errorStart);
  assert.ok(errorStart >= 0 && errorEnd > errorStart);
  const errorPanel = galleryPage.slice(errorStart, errorEnd);
  assert.match(errorPanel, /再試行/);
  assert.match(errorPanel, /void fetchImages\(\)/);
  assert.doesNotMatch(errorPanel, /designProduction|画像を生成する|生成/);
  assert.match(galleryPage, /画像がないとは確認できていません/);
  assert.match(galleryPage, /プレビューを利用できません/);
});
