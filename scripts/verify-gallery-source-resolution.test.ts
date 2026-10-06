import assert from 'node:assert/strict';
import test from 'node:test';
import { getGeneratedImageSelectionKey } from '../src/lib/generatedImageIdentity.ts';
import {
  canClearMissingGallerySelection,
  isGallerySourceRequestCurrent,
  resolveGallerySource,
  sameGallerySourceScope,
  type GallerySourceLiveContext,
  type GallerySourceRequest,
  type GallerySourceResolution,
  type GallerySourceScope,
  type GallerySourceRow,
} from '../src/lib/gallerySourceResolution.ts';

type TestRow = GallerySourceRow & {
  created_at: string;
  brand_id: string;
  is_favorite: boolean;
  prompt: string;
};

const scope = (overrides: Partial<GallerySourceScope> = {}): GallerySourceScope => ({
  userId: 'user-1',
  brandId: 'brand-1',
  favoriteFilter: 'all',
  sortOrder: 'newest',
  ...overrides,
});

const row = (
  id: string,
  storagePath: string,
  imageUrl: string | null = null,
  overrides: Partial<TestRow> = {},
): TestRow => ({
  id,
  storage_path: storagePath,
  image_url: imageUrl,
  user_id: 'user-1',
  metadata: { title: id, canvasProjectId: 'canvas-1' },
  created_at: '2026-09-30T00:00:00.000Z',
  brand_id: 'brand-1',
  is_favorite: false,
  prompt: `prompt-${id}`,
  ...overrides,
});

const emptyResolution = (): GallerySourceResolution<TestRow> => ({
  status: 'pending',
  scope: null,
  sequence: 0,
  rows: [],
  unavailablePreviewIds: [],
});

const request = (activeScope: GallerySourceScope, sequence = 1): GallerySourceRequest => ({
  scope: activeScope,
  sequence,
});

const currentContext = (activeRequest: GallerySourceRequest): GallerySourceLiveContext => ({
  sequence: activeRequest.sequence,
  scope: activeRequest.scope,
  liveUserId: activeRequest.scope.userId,
  liveBrandId: activeRequest.scope.brandId,
});

const staleSignedUrl = (id: string) => `https://storage.test/storage/v1/object/sign/generated-images/${id}?token=old`;
const freshSignedUrl = (id: string) => `https://storage.test/storage/v1/object/sign/generated-images/${id}?token=fresh`;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test('remote rejection with no local or cached rows is failed, never resolved-empty', async () => {
  const activeRequest = request(scope());
  const observed: string[] = [];
  const result = await resolveGallerySource({
    request: activeRequest,
    previous: emptyResolution(),
    getCurrentContext: () => currentContext(activeRequest),
    readLocalRows: () => [],
    fetchRemoteRows: async () => { throw new Error('remote_list_unavailable'); },
    signRows: async (rows) => rows,
    onState: (next) => observed.push(next.status),
  });

  assert.equal(result?.status, 'failed');
  assert.deepEqual(result?.rows, []);
  assert.ok(observed.includes('pending'));
  assert.ok(observed.includes('failed'));
  assert.ok(!observed.includes('resolved-empty'));
  assert.equal(canClearMissingGallerySelection(result!, activeRequest.scope), false);
});

test('remote rejection retains exact-scope cached and local metadata, clears stale URLs, and deduplicates canonical identity', async () => {
  const activeScope = scope();
  const activeRequest = request(activeScope);
  const cachedRemote = row('remote-image-1', 'generated-images/canonical-1', staleSignedUrl('canonical-1'), {
    metadata: { title: 'cached canonical metadata', canvasProjectId: 'canvas-detail-1' },
  });
  const localDuplicate = row('local-image-1', 'generated-images/canonical-1', staleSignedUrl('canonical-1'), {
    user_id: 'local-workspace',
    metadata: { title: 'local backup metadata', canvasProjectId: 'canvas-detail-1' },
  });
  const localOnly = row('local-image-2', 'generated-images/canonical-2', null, {
    user_id: 'local-workspace',
    metadata: { title: 'local-only metadata', canvasProjectId: 'canvas-detail-2' },
  });
  const previous: GallerySourceResolution<TestRow> = {
    status: 'resolved-rows',
    scope: activeScope,
    sequence: 0,
    rows: [cachedRemote],
    unavailablePreviewIds: [],
  };
  const signInputs: Array<Array<string | null | undefined>> = [];
  const result = await resolveGallerySource({
    request: activeRequest,
    previous,
    getCurrentContext: () => currentContext(activeRequest),
    readLocalRows: () => [localDuplicate, localOnly],
    fetchRemoteRows: async () => { throw new Error('remote_list_unavailable'); },
    signRows: async (rows) => {
      signInputs.push(rows.map((candidate) => candidate.image_url));
      return rows.map((candidate) => ({
        ...candidate,
        image_url: candidate.storage_path.endsWith('canonical-1')
          ? freshSignedUrl('canonical-1')
          : candidate.image_url,
      }));
    },
    onState: () => undefined,
  });

  assert.equal(result?.status, 'failed');
  assert.equal(result?.rows.length, 2);
  assert.deepEqual(result?.rows.map((candidate) => candidate.id), ['remote-image-1', 'local-image-2']);
  assert.deepEqual(signInputs[0], [null, null]);
  assert.equal(result?.rows[0].image_url, freshSignedUrl('canonical-1'));
  assert.equal(result?.rows[0].metadata?.title, 'cached canonical metadata');
  assert.equal(result?.rows[1].metadata?.title, 'local-only metadata');
  assert.deepEqual(result?.unavailablePreviewIds, ['local-image-2']);
  assert.equal(getGeneratedImageSelectionKey(result!.rows[0]), getGeneratedImageSelectionKey(cachedRemote));
});

test('remote-only cached row is re-signed on retry even when local storage has no copy', async () => {
  const activeScope = scope();
  const activeRequest = request(activeScope, 2);
  const cached = row('remote-only-1', 'generated-images/remote-only-1', staleSignedUrl('remote-only-1'));
  let signingInput: string | null | undefined;
  const result = await resolveGallerySource({
    request: activeRequest,
    previous: {
      status: 'failed',
      scope: activeScope,
      sequence: 1,
      rows: [cached],
      unavailablePreviewIds: [],
    },
    getCurrentContext: () => currentContext(activeRequest),
    readLocalRows: () => [],
    fetchRemoteRows: async () => { throw new Error('remote_list_unavailable'); },
    signRows: async (rows) => {
      signingInput = rows[0]?.image_url;
      return rows.map((candidate) => ({ ...candidate, image_url: freshSignedUrl('remote-only-1') }));
    },
    onState: () => undefined,
  });

  assert.equal(signingInput, null);
  assert.equal(result?.status, 'failed');
  assert.equal(result?.rows[0].metadata?.canvasProjectId, 'canvas-1');
  assert.equal(result?.rows[0].image_url, freshSignedUrl('remote-only-1'));
  assert.equal(getGeneratedImageSelectionKey(result!.rows[0]), getGeneratedImageSelectionKey(cached));
});

test('retry preserves detail and Canvas identity, while a successful exact-scope empty read clears old rows', async () => {
  const activeScope = scope();
  const firstRequest = request(activeScope, 1);
  const cached = row('remote-image-1', 'generated-images/canonical-1', null, {
    metadata: { title: 'cached detail', canvasProjectId: 'canvas-detail-1' },
  });
  const failed = await resolveGallerySource({
    request: firstRequest,
    previous: { ...emptyResolution(), scope: activeScope, rows: [cached] },
    getCurrentContext: () => currentContext(firstRequest),
    readLocalRows: () => [],
    fetchRemoteRows: async () => { throw new Error('temporary_remote_failure'); },
    signRows: async (rows) => rows,
    onState: () => undefined,
  });
  assert.equal(failed?.status, 'failed');
  assert.equal(canClearMissingGallerySelection(failed!, activeScope), false);

  const retryRequest = request(activeScope, 2);
  const calls: string[] = [];
  const restored = await resolveGallerySource({
    request: retryRequest,
    previous: failed!,
    getCurrentContext: () => currentContext(retryRequest),
    readLocalRows: () => [],
    fetchRemoteRows: async () => {
      calls.push('read-source');
      return [row('remote-image-1', 'generated-images/canonical-1', staleSignedUrl('canonical-1'), {
        metadata: { title: 'fresh detail', canvasProjectId: 'canvas-detail-1' },
      })];
    },
    signRows: async (rows) => rows.map((candidate) => ({
      ...candidate,
      image_url: candidate.storage_path.endsWith('canonical-1') ? freshSignedUrl('canonical-1') : candidate.image_url,
    })),
    onState: () => undefined,
  });
  assert.equal(restored?.status, 'resolved-rows');
  assert.equal(restored?.rows.length, 1);
  assert.equal(getGeneratedImageSelectionKey(restored!.rows[0]), getGeneratedImageSelectionKey(cached));
  assert.equal(restored?.rows[0].metadata?.canvasProjectId, 'canvas-detail-1');
  assert.deepEqual(calls, ['read-source']);

  const emptyRequest = request(activeScope, 3);
  const empty = await resolveGallerySource({
    request: emptyRequest,
    previous: restored!,
    getCurrentContext: () => currentContext(emptyRequest),
    readLocalRows: () => [],
    fetchRemoteRows: async () => [],
    signRows: async (rows) => rows,
    onState: () => undefined,
  });
  assert.equal(empty?.status, 'resolved-empty');
  assert.deepEqual(empty?.rows, []);
  assert.equal(canClearMissingGallerySelection(empty!, activeScope), true);
  assert.equal(canClearMissingGallerySelection(empty!, scope({ brandId: 'brand-2' })), false);
});

test('preview signing failure keeps source rows resolved with an unavailable preview', async () => {
  const activeRequest = request(scope());
  const sourceRow = row('remote-image-1', 'generated-images/canonical-1', staleSignedUrl('canonical-1'));
  const result = await resolveGallerySource({
    request: activeRequest,
    previous: emptyResolution(),
    getCurrentContext: () => currentContext(activeRequest),
    readLocalRows: () => [],
    fetchRemoteRows: async () => [sourceRow],
    signRows: async () => { throw new Error('signing_unavailable'); },
    onState: () => undefined,
  });

  assert.equal(result?.status, 'resolved-rows');
  assert.equal(result?.rows.length, 1);
  assert.equal(result?.rows[0].image_url, null);
  assert.deepEqual(result?.unavailablePreviewIds, ['remote-image-1']);
  assert.equal(canClearMissingGallerySelection(result!, activeRequest.scope), true);
});

test('latest request requires unchanged sequence, user, brand, favorite filter, sort, and live auth scope', () => {
  const activeScope = scope();
  const activeRequest = request(activeScope, 7);
  const current = currentContext(activeRequest);
  assert.equal(isGallerySourceRequestCurrent(activeRequest, current), true);
  assert.equal(sameGallerySourceScope(null, null), true);

  const contexts: GallerySourceLiveContext[] = [
    { ...current, sequence: 6 },
    { ...current, scope: scope({ userId: 'user-2' }), liveUserId: 'user-2' },
    { ...current, scope: scope({ brandId: 'brand-2' }), liveBrandId: 'brand-2' },
    { ...current, scope: scope({ favoriteFilter: 'favorites' }) },
    { ...current, scope: scope({ sortOrder: 'oldest' }) },
    { ...current, scope: null, liveUserId: null, liveBrandId: null },
    { ...current, liveUserId: null },
    { ...current, liveBrandId: null },
  ];
  for (const context of contexts) assert.equal(isGallerySourceRequestCurrent(activeRequest, context), false);
});

test('out-of-order remote completion cannot commit rows or run a stale finally callback', async () => {
  const activeScope = scope();
  const firstRequest = request(activeScope, 1);
  const secondRequest = request(activeScope, 2);
  let liveContext = currentContext(firstRequest);
  let rejectFirst!: (reason?: unknown) => void;
  let firstQueryStarted = false;
  const firstQuery = new Promise<TestRow[]>((_resolve, reject) => { rejectFirst = reject; });
  const firstStates: string[] = [];
  let firstFinallyCalls = 0;
  const firstRun = resolveGallerySource({
    request: firstRequest,
    previous: emptyResolution(),
    getCurrentContext: () => liveContext,
    readLocalRows: () => [],
    fetchRemoteRows: () => { firstQueryStarted = true; return firstQuery; },
    signRows: async (rows) => rows,
    onState: (next) => firstStates.push(next.status),
    onFinally: () => { firstFinallyCalls += 1; },
  });
  while (!firstQueryStarted) await new Promise((resolve) => setTimeout(resolve, 0));

  liveContext = currentContext(secondRequest);
  let secondFinallyCalls = 0;
  const secondResult = await resolveGallerySource({
    request: secondRequest,
    previous: emptyResolution(),
    getCurrentContext: () => liveContext,
    readLocalRows: () => [],
    fetchRemoteRows: async () => [row('newest-result', 'generated-images/newest-result')],
    signRows: async (rows) => rows,
    onState: () => undefined,
    onFinally: () => { secondFinallyCalls += 1; },
  });
  rejectFirst(new Error('late_failure'));
  const firstResult = await firstRun;

  assert.equal(secondResult?.status, 'resolved-rows');
  assert.equal(secondResult?.rows[0].id, 'newest-result');
  assert.equal(firstResult, null);
  assert.deepEqual(firstStates, ['pending', 'pending']);
  assert.equal(firstFinallyCalls, 0);
  assert.equal(secondFinallyCalls, 1);
});

const staleScopeCases: Array<{
  name: string;
  nextContext: (request: GallerySourceRequest) => GallerySourceLiveContext;
  rejectRemote?: boolean;
}> = [
  {
    name: 'logout',
    nextContext: (activeRequest) => ({
      sequence: activeRequest.sequence + 1,
      scope: null,
      liveUserId: null,
      liveBrandId: null,
    }),
    rejectRemote: true,
  },
  {
    name: 'user switch',
    nextContext: (activeRequest) => ({
      ...currentContext(activeRequest),
      sequence: activeRequest.sequence + 1,
      scope: scope({ userId: 'user-2' }),
      liveUserId: 'user-2',
    }),
  },
  {
    name: 'brand switch',
    nextContext: (activeRequest) => ({
      ...currentContext(activeRequest),
      sequence: activeRequest.sequence + 1,
      scope: scope({ brandId: 'brand-2' }),
      liveBrandId: 'brand-2',
    }),
  },
  {
    name: 'favorite-filter switch',
    nextContext: (activeRequest) => ({
      ...currentContext(activeRequest),
      sequence: activeRequest.sequence + 1,
      scope: scope({ favoriteFilter: 'favorites' }),
    }),
  },
  {
    name: 'sort switch',
    nextContext: (activeRequest) => ({
      ...currentContext(activeRequest),
      sequence: activeRequest.sequence + 1,
      scope: scope({ sortOrder: 'oldest' }),
    }),
  },
];

for (const staleCase of staleScopeCases) {
  test(`awaited ${staleCase.name} without a replacement fetch suppresses stale commit and finally`, async () => {
    const activeRequest = request(scope(), 11);
    let liveContext = currentContext(activeRequest);
    const query = deferred<TestRow[]>();
    const queryStarted = deferred<void>();
    const states: GallerySourceResolution<TestRow>[] = [];
    let remoteCalls = 0;
    let finallyCalls = 0;

    const run = resolveGallerySource({
      request: activeRequest,
      previous: emptyResolution(),
      getCurrentContext: () => liveContext,
      readLocalRows: () => [],
      fetchRemoteRows: () => {
        remoteCalls += 1;
        queryStarted.resolve();
        return query.promise;
      },
      signRows: async (rows) => rows,
      onState: (next) => states.push(next),
      onFinally: () => { finallyCalls += 1; },
    });
    await queryStarted.promise;

    const stateCountBeforeContextChange = states.length;
    liveContext = staleCase.nextContext(activeRequest);
    if (staleCase.rejectRemote) query.reject(new Error('late_remote_failure'));
    else query.resolve([row('stale-result', 'generated-images/stale-result')]);

    assert.equal(await run, null);
    assert.equal(states.length, stateCountBeforeContextChange, 'stale completion must not commit rows or failure state');
    assert.equal(finallyCalls, 0, 'stale completion must not clear the current request loading state');
    assert.equal(remoteCalls, 1, 'scope invalidation must not depend on a replacement fetch');
  });
}

test('awaited logout during remote preview signing suppresses result commit and finally', async () => {
  const activeRequest = request(scope(), 21);
  let liveContext = currentContext(activeRequest);
  const signing = deferred<TestRow[]>();
  const signingStarted = deferred<void>();
  const states: GallerySourceResolution<TestRow>[] = [];
  let finallyCalls = 0;
  const remoteRow = row('remote-preview', 'generated-images/remote-preview');

  const run = resolveGallerySource({
    request: activeRequest,
    previous: emptyResolution(),
    getCurrentContext: () => liveContext,
    readLocalRows: () => [],
    fetchRemoteRows: async () => [remoteRow],
    signRows: (rows) => {
      if (rows.length === 0) return Promise.resolve(rows);
      signingStarted.resolve();
      return signing.promise;
    },
    onState: (next) => states.push(next),
    onFinally: () => { finallyCalls += 1; },
  });
  await signingStarted.promise;

  const stateCountBeforeLogout = states.length;
  liveContext = {
    sequence: activeRequest.sequence + 1,
    scope: null,
    liveUserId: null,
    liveBrandId: null,
  };
  signing.resolve([remoteRow]);

  assert.equal(await run, null);
  assert.equal(states.length, stateCountBeforeLogout, 'signed rows must not commit after logout');
  assert.equal(finallyCalls, 0, 'stale signing completion must not run finally state updates');
});

test('awaited logout revokes live auth before scope or sequence updates without a replacement fetch', async () => {
  const activeRequest = request(scope(), 31);
  let liveContext = currentContext(activeRequest);
  const query = deferred<TestRow[]>();
  const queryStarted = deferred<void>();
  const states: GallerySourceResolution<TestRow>[] = [];
  let remoteCalls = 0;
  let finallyCalls = 0;

  const run = resolveGallerySource({
    request: activeRequest,
    previous: emptyResolution(),
    getCurrentContext: () => liveContext,
    readLocalRows: () => [],
    fetchRemoteRows: () => {
      remoteCalls += 1;
      queryStarted.resolve();
      return query.promise;
    },
    signRows: async (rows) => rows,
    onState: (next) => states.push(next),
    onFinally: () => { finallyCalls += 1; },
  });
  await queryStarted.promise;

  const stateCountBeforeLogout = states.length;
  liveContext = { ...currentContext(activeRequest), liveUserId: null };
  query.resolve([row('late-after-logout', 'generated-images/late-after-logout')]);

  assert.equal(await run, null);
  assert.equal(states.length, stateCountBeforeLogout, 'live auth revocation must fence a stale row commit');
  assert.equal(finallyCalls, 0, 'live auth revocation must fence stale finally updates');
  assert.equal(remoteCalls, 1, 'auth revocation must not depend on a replacement fetch');
  assert.equal(liveContext.sequence, activeRequest.sequence);
  assert.equal(liveContext.scope?.brandId, activeRequest.scope.brandId);
  assert.equal(liveContext.liveBrandId, activeRequest.scope.brandId);
});
