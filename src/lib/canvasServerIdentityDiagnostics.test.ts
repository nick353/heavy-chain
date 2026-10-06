import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { CanvasSaveScopeDiagnosticEntry } from './canvasSaveScopeDiagnostics.ts';
import {
  canvasSnapshotsStructurallyEqual,
  inspectCanvasServerIdentity,
  inspectCanvasCandidateLineage,
  CANVAS_LINEAGE_CANDIDATE_IDS,
  isExactCanvasLineageCandidateSet,
  type CanvasServerIdentityDiagnosticOptions,
} from './canvasServerIdentityDiagnostics.ts';

const userId = 'diagnostic-user';
const brandId = 'diagnostic-brand';
const anchor = {
  version: 1,
  objects: [
    { id: 'anchor-object-a', type: 'image', x: 10, src: 'generated-images/image-a', metadata: { imageId: 'image-a', storagePath: 'generated-images/image-a' } },
    { id: 'anchor-object-b', type: 'image', x: 20, src: 'generated-images/image-b', metadata: { imageId: 'image-b', storagePath: 'generated-images/image-b' } },
  ],
};

const idFor = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const cacheEntry = (
  documentId: string,
  workingMatch: CanvasSaveScopeDiagnosticEntry['workingMatch'] = 'partial',
  pendingMatch: CanvasSaveScopeDiagnosticEntry['pendingMatch'] = 'not_present',
): CanvasSaveScopeDiagnosticEntry => ({
  documentId,
  valid: true,
  pending: pendingMatch !== 'not_present',
  revision: 0,
  workingMatch,
  workingObjectIdsEqual: workingMatch === 'full' ? true : null,
  pendingMatch,
  pendingObjectIdsEqual: null,
});

const otherSnapshot = {
  version: 1,
  objects: [{ id: 'unrelated', type: 'image', src: 'generated-images/unrelated', metadata: { imageId: 'unrelated' } }],
};

const row = (id: string, snapshot: unknown = anchor, overrides: Record<string, unknown> = {}) => ({
  id,
  owner_id: userId,
  brand_id: brandId,
  title: 'private server title',
  snapshot_version: 1,
  revision: 2,
  created_at: '2026-09-30T10:00:00.000Z',
  updated_at: '2026-09-30T11:00:00.000Z',
  snapshot: structuredClone(snapshot),
  ...overrides,
});

function fixture(options: {
  cacheEntries?: CanvasSaveScopeDiagnosticEntry[];
  rows?: unknown[];
  getRows?: Map<string, unknown>;
  missingIds?: Set<string>;
  assertCurrent?: () => void | Promise<void>;
  getHook?: (id: string) => void | Promise<void>;
  listHook?: (offset: number) => void | Promise<void>;
} = {}) {
  const calls = { get: [] as string[], list: [] as number[] };
  const rows = options.rows ?? [];
  const getRows = options.getRows ?? new Map(rows.flatMap((value) => {
    const raw = value as { id?: string };
    return typeof raw?.id === 'string' ? [[raw.id, value] as const] : [];
  }));
  const args: CanvasServerIdentityDiagnosticOptions = {
    anchorSnapshot: anchor,
    currentCacheEntries: options.cacheEntries ?? [],
    userId,
    brandId,
    assertCurrent: options.assertCurrent ?? (() => {}),
    getDocument: async (id) => {
      calls.get.push(id);
      await options.getHook?.(id);
      if (options.missingIds?.has(id)) throw new Error('cloudflare_api_404_not_found');
      if (!getRows.has(id)) throw new Error('cloudflare_api_404_not_found');
      return getRows.get(id);
    },
    listDocumentsPage: async (_brand, limit, offset) => {
      calls.list.push(offset);
      assert.equal(limit, 100);
      await options.listHook?.(offset);
      return rows.slice(offset, offset + limit);
    },
  };
  return { args, calls };
}

const run = (value: ReturnType<typeof fixture>) => inspectCanvasServerIdentity(value.args);

function lineageFixture(overrides: Partial<Parameters<typeof inspectCanvasCandidateLineage>[0]> = {}) {
  const calls: string[] = [];
  const args: Parameters<typeof inspectCanvasCandidateLineage>[0] = {
    anchorSnapshot: anchor, candidateIds: CANVAS_LINEAGE_CANDIDATE_IDS, userId, brandId,
    assertCurrent: () => {},
    getDocument: async (id, context) => {
      calls.push(id);
      assert.equal(context.userId, userId);
      return row(id);
    },
    ...overrides,
  };
  return { args, calls };
}

test('candidate lineage reads only the frozen three IDs in fixed sequential order and redacts output', async () => {
  assert.equal(Object.isFrozen(CANVAS_LINEAGE_CANDIDATE_IDS), true);
  assert.equal(isExactCanvasLineageCandidateSet([...CANVAS_LINEAGE_CANDIDATE_IDS].reverse()), true);
  let active = false;
  const value = lineageFixture();
  value.args.candidateIds = [...CANVAS_LINEAGE_CANDIDATE_IDS].reverse();
  value.args.getDocument = async (id) => {
    assert.equal(active, false);
    active = true;
    value.calls.push(id);
    await Promise.resolve();
    active = false;
    return row(id);
  };
  const result = await inspectCanvasCandidateLineage(value.args);
  assert.deepEqual(value.calls, [...CANVAS_LINEAGE_CANDIDATE_IDS]);
  assert.equal(result.status, 'complete');
  if (result.status !== 'complete') throw new Error('unexpected fixture stop');
  assert.equal(result.getCount, 3);
  for (const entry of result.candidates) {
    assert.equal(entry.fetch, 'ok');
    assert.equal(entry.revision, 2);
    assert.equal(entry.snapshotVersion, 1);
    assert.equal(entry.createdAt, '2026-09-30T10:00:00.000Z');
    assert.equal(entry.updatedAt, '2026-09-30T11:00:00.000Z');
    assert.equal(entry.routeMetadata, 'unknown');
    assert.equal(entry.deletedMetadata, 'unknown');
    assert.equal(entry.priorSaveProof, 'unknown');
    assert.equal(entry.adoptable, false);
    assert.equal(entry.saveAllowed, false);
  }
  const output = JSON.stringify(result);
  for (const secret of [userId, brandId, 'private server title', '"snapshot":', 'storagePath', 'generated-images', 'anchor-object-a', 'image-a', 'token']) {
    assert.equal(output.includes(secret), false, `candidate output leaked ${secret}`);
  }
});

test('invalid candidate sets and malformed or oversized anchors make zero GET requests', async () => {
  for (const candidateIds of [null, 'not-an-array', CANVAS_LINEAGE_CANDIDATE_IDS.slice(0, 2),
    [...CANVAS_LINEAGE_CANDIDATE_IDS, idFor(50)],
    [CANVAS_LINEAGE_CANDIDATE_IDS[0], CANVAS_LINEAGE_CANDIDATE_IDS[0], CANVAS_LINEAGE_CANDIDATE_IDS[2]],
    [CANVAS_LINEAGE_CANDIDATE_IDS[0], CANVAS_LINEAGE_CANDIDATE_IDS[1], idFor(50)]]) {
    assert.equal(isExactCanvasLineageCandidateSet(candidateIds), false);
    const value = lineageFixture({ candidateIds });
    assert.deepEqual(await inspectCanvasCandidateLineage(value.args), { status: 'rejected', code: 'candidate_set_invalid' });
    assert.deepEqual(value.calls, []);
  }
  for (const [anchorSnapshot, code] of [
    [null, 'anchor_malformed'],
    [{ version: 1, objects: Array.from({ length: 513 }, (_, index) => ({ id: String(index), type: 'text' })) }, 'anchor_object_limit'],
  ] as const) {
    const value = lineageFixture({ anchorSnapshot });
    assert.deepEqual(await inspectCanvasCandidateLineage(value.args), { status: 'rejected', code });
    assert.deepEqual(value.calls, []);
  }
});

test('owner, brand, ID and malformed candidate responses stop immediately and discard prior details', async () => {
  for (const [overrides, code] of [
    [{ owner_id: 'other-private-owner' }, 'owner_scope_mismatch'],
    [{ brand_id: 'other-private-brand' }, 'owner_scope_mismatch'],
    [{ id: idFor(99) }, 'id_mismatch'],
    [{ title: null }, 'record_invalid'],
    [{ snapshot: { version: 1, objects: [{ id: 'bad', type: 'unknown' }] } }, 'candidate_malformed'],
  ] as const) {
    for (const failureIndex of [0, 1]) {
      const value = lineageFixture();
      value.args.getDocument = async (id) => {
        value.calls.push(id);
        return row(id, anchor, value.calls.length === failureIndex + 1 ? overrides : {});
      };
      assert.deepEqual(await inspectCanvasCandidateLineage(value.args), { status: 'stopped', code, getCount: failureIndex + 1 });
      assert.equal(value.calls.length, failureIndex + 1);
    }
  }
});

test('stale fences before and after GET discard all detail without continuing', async () => {
  for (const failureCheck of [1, 2, 3, 7]) {
    let checks = 0;
    const value = lineageFixture({ assertCurrent: () => { if (++checks === failureCheck) throw new Error('private-token'); } });
    const expectedGets = failureCheck === 1 ? 0 : failureCheck === 2 || failureCheck === 3 ? 1 : 3;
    assert.deepEqual(await inspectCanvasCandidateLineage(value.args), { status: 'stale', getCount: expectedGets });
    assert.equal(value.calls.length, expectedGets);
  }
});

test('definite 404, request errors and object limits remain per-ID evidence with no retries', async () => {
  const value = lineageFixture();
  value.args.getDocument = async (id) => {
    value.calls.push(id);
    if (value.calls.length === 1) throw new Error('cloudflare_api_404_not_found');
    if (value.calls.length === 2) throw new Error('private-auth-request-failure');
    return row(id, { version: 1, objects: Array.from({ length: 513 }, (_, index) => ({ id: String(index), type: 'text' })) });
  };
  const result = await inspectCanvasCandidateLineage(value.args);
  assert.equal(result.status, 'complete');
  if (result.status !== 'complete') throw new Error('unexpected fixture stop');
  assert.deepEqual(result.candidates.map((entry) => entry.fetch), ['not_found', 'request_failed', 'object_limit']);
  assert.deepEqual(value.calls, [...CANVAS_LINEAGE_CANDIDATE_IDS]);
  for (const entry of result.candidates) {
    assert.equal(entry.lineage, undefined);
    assert.equal(entry.priorSaveProof, 'unknown');
    assert.equal(entry.saveAllowed, false);
  }
  assert.equal(JSON.stringify(result).includes('private-auth'), false);
});

const pageSource = readFileSync(new URL('../pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');
const handlerStart = pageSource.indexOf('  const handleReadCanvasCandidateLineage = async () => {');
const handlerEnd = pageSource.indexOf('\n  useEffect(() => {', handlerStart);
const candidateHandlerSource = pageSource.slice(handlerStart, handlerEnd);

function pageLineageFixture(options: { storageFailed?: boolean; consumed?: boolean; getHook?: (state: { currentProjectId: string | null; objects: typeof anchor.objects }) => void } = {}) {
  const values = new Map<string, string>(options.consumed ? [['heavy.canvas.candidateLineage.r1031', 'consumed']] : []);
  const snapshot = structuredClone(anchor);
  const context = { snapshot, userId, brandId, origin: 'https://diagnostic.example', routeId: undefined,
    authStatus: 'ready', authUserId: userId, authGeneration: 1, authConfirmedBrandIds: [brandId] };
  const canvas = { currentProjectId: null as string | null, currentProjectName: 'private-name', objects: snapshot.objects, zoom: 1, panX: 0, panY: 0 };
  const currentAuth = { user: { id: userId }, currentBrand: { id: brandId },
    brandState: { status: context.authStatus, userId, requestGeneration: 1, confirmedBrandIds: [brandId] } };
  const session = { data: { session: { user: { id: userId }, access_token: 'private-token' } }, error: null };
  const results: unknown[] = [];
  const calls: string[] = [];
  let consumed = false;
  const refs = { candidateLineageConsumedRef: { current: false }, candidateLineageGenerationRef: { current: 0 },
    canvasSaveScopeDiagnosticContextRef: { current: context }, imageEditEpochRef: { current: 1 }, imageEditRouteRef: { current: undefined },
    isMountedRef: { current: true } };
  const api = { origin: context.origin, getCanvasDocument: async (id: string) => {
    assert.equal(values.get('heavy.canvas.candidateLineage.r1031'), 'consumed', 'durable gate must precede GET');
    calls.push(id);
    options.getHook?.(canvas);
    return row(id);
  } };
  const environment = {
    ...refs, canvasSaveScopeDiagnosticContext: context, canvasSaveScopeDiagnosticState: { context, result: { readiness: 'ready', complete: true } },
    canvasDebugEnabled: true, candidateLineageBusy: false, canvasServerIdentityDiagnosticBusy: false,
    cloudflareDataPlane: api, CANVAS_LINEAGE_CANDIDATE_IDS, inspectCanvasCandidateLineage,
    setCandidateLineageConsumed: (value: boolean) => { consumed = value; },
    setCandidateLineageBusy: () => {}, setCandidateLineageResult: (value: unknown) => results.push(value),
    useAuthStore: { getState: () => currentAuth }, useCanvasStore: { getState: () => canvas },
    captureAuthBrandFence: () => ({}), isAuthBrandFenceValid: () => true,
    buildCanvasDocumentSnapshot: () => ({ ...snapshot, objects: canvas.objects }), canvasSourceProjectIdsRef: { current: [] },
    auth: { getSession: async () => session },
    window: { sessionStorage: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { if (options.storageFailed) throw new Error('private-storage-error'); values.set(key, value); } } },
    activate: undefined as undefined | (() => Promise<void>),
  };
  const compiled = ts.transpileModule(candidateHandlerSource.replace('const handleReadCanvasCandidateLineage =', 'globalThis.activate ='),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  runInNewContext(compiled, environment);
  assert.ok(environment.activate);
  return { activate: environment.activate, calls, results, values, refs, currentAuth, canvas, session, api, get consumed() { return consumed; } };
}

test('page candidate handler consumes synchronously, allows one activation and stays consumed on error/reload', async () => {
  const value = pageLineageFixture();
  assert.deepEqual(value.calls, []);
  const first = value.activate();
  const second = value.activate();
  assert.equal(value.consumed, true);
  assert.equal(value.values.get('heavy.canvas.candidateLineage.r1031'), 'consumed');
  await Promise.all([first, second]);
  assert.deepEqual(value.calls, [...CANVAS_LINEAGE_CANDIDATE_IDS]);
  await value.activate();
  assert.equal(value.calls.length, 3);
  const failed = pageLineageFixture({ storageFailed: true });
  await failed.activate();
  await failed.activate();
  assert.equal(failed.calls.length, 0);
  assert.equal(failed.consumed, true);
  assert.equal(JSON.stringify(failed.results).includes('once_gate_unavailable'), true);
  const reload = pageLineageFixture({ consumed: true });
  await reload.activate();
  assert.equal(reload.calls.length, 0);
});

test('page copied fences discard result on auth, route, epoch, generation, mount and serialized snapshot changes', async () => {
  const mutations = [
    (value: ReturnType<typeof pageLineageFixture>) => { value.currentAuth.user.id = 'other-user'; },
    (value: ReturnType<typeof pageLineageFixture>) => { value.currentAuth.currentBrand.id = 'other-brand'; },
    (value: ReturnType<typeof pageLineageFixture>) => { value.currentAuth.brandState.requestGeneration += 1; },
    (value: ReturnType<typeof pageLineageFixture>) => { value.session.data.session.access_token = 'changed-token'; },
    (value: ReturnType<typeof pageLineageFixture>) => { value.api.origin = 'https://changed.example'; },
    (value: ReturnType<typeof pageLineageFixture>) => { value.refs.imageEditEpochRef.current += 1; },
    (value: ReturnType<typeof pageLineageFixture>) => { value.refs.imageEditRouteRef.current = 'other-route' as unknown as undefined; },
    (value: ReturnType<typeof pageLineageFixture>) => { value.refs.candidateLineageGenerationRef.current += 1; },
    (value: ReturnType<typeof pageLineageFixture>) => { value.canvas.objects[0].x += 1; },
    (value: ReturnType<typeof pageLineageFixture>) => { value.canvas.currentProjectId = 'adopted'; },
    (value: ReturnType<typeof pageLineageFixture>) => { value.refs.isMountedRef.current = false; },
  ];
  for (const mutate of mutations) {
    let value: ReturnType<typeof pageLineageFixture>;
    value = pageLineageFixture({ getHook: () => mutate(value) });
    await value.activate();
    assert.equal(value.calls.length, 1);
    assert.ok(value.results.every((result) => result === null || JSON.stringify(result) === '{"status":"stale"}'));
    await value.activate();
    assert.equal(value.calls.length, 1);
  }
});

test('page candidate source exposes debug-only controls without automatic requests or mutation paths', () => {
  assert.ok(handlerStart > 0 && handlerEnd > handlerStart);
  assert.equal(pageSource.match(/inspectCanvasCandidateLineage\(/g)?.length, 1);
  assert.ok(pageSource.includes('{canvasDebugEnabled && (\n        <div data-testid="canvas-server-identity-diagnostic"'));
  assert.ok(pageSource.includes('data-testid="canvas-candidate-lineage-readback"'));
  assert.ok(pageSource.includes('data-testid="canvas-candidate-lineage-result"'));
  assert.ok(pageSource.includes('candidateLineageConsumed || candidateLineageSessionConsumed'));
  assert.equal(pageSource.match(/candidateLineageConsumedRef\.current = false/g), null);
  for (const forbidden of ['listCanvasDocuments', 'hydrateProject', 'saveCurrentProject', 'handleSave', 'retainCanvasSaveDraft', '.setState(']) {
    assert.equal(candidateHandlerSource.includes(forbidden), false, `candidate handler contains ${forbidden}`);
  }
});

test('lineage can be full while geometry changes make whole-snapshot equality false', async () => {
  const candidate = structuredClone(anchor);
  candidate.objects[0].id = 'new-object-a';
  candidate.objects[1].id = 'new-object-b';
  candidate.objects[0].x = 900;
  const value = fixture({ rows: [row(idFor(1), candidate)] });
  const result = await run(value);
  assert.equal(result.counts.full, 1);
  assert.equal(result.observations[0].match, 'full');
  assert.equal(result.observations[0].objectIdsEqual, false);
  assert.equal(result.observations[0].snapshotEqual, false);
  assert.equal(result.code, 'unique_owned_full_match_observed');
  assert.equal(result.priorSaveEffectProven, false);
});

test('structural equality ignores object-key order but retains geometry, metadata, and array order', () => {
  assert.equal(canvasSnapshotsStructurallyEqual({ x: 1, nested: { b: 2, a: 1 } }, { nested: { a: 1, b: 2 }, x: 1 }), true);
  assert.equal(canvasSnapshotsStructurallyEqual(anchor, { ...anchor, objects: anchor.objects.map((object) => ({ ...object, x: object.x + 1 })) }), false);
  assert.equal(canvasSnapshotsStructurallyEqual(anchor, { ...anchor, objects: [...anchor.objects].reverse() }), false);
  assert.equal(canvasSnapshotsStructurallyEqual(anchor, { ...anchor, objects: anchor.objects.map((object) => ({ ...object, metadata: { ...object.metadata, extra: true } })) }), false);
});

test('partial and ambiguous cache entries allow a read-only diagnosis and remain competitors', async () => {
  const partial = { version: 1, objects: [structuredClone(anchor.objects[0])] };
  const ambiguousObjects = structuredClone(anchor.objects);
  ambiguousObjects[0].metadata.imageId = 'contradictory-image';
  const partialId = idFor(1);
  const ambiguousId = idFor(2);
  const value = fixture({
    cacheEntries: [cacheEntry(partialId, 'partial'), cacheEntry(ambiguousId, 'ambiguous')],
    rows: [row(partialId, partial), row(ambiguousId, { version: 1, objects: ambiguousObjects })],
  });
  const result = await run(value);
  assert.equal(result.status, 'complete');
  assert.equal(result.complete, true);
  assert.equal(result.code, 'competing_matches');
  assert.equal(result.counts.partial, 1);
  assert.equal(result.counts.ambiguous, 1);
  assert.equal(result.uniqueOwnedFullMatchObserved, false);
  assert.equal(result.priorSaveEffectProven, false);
  assert.equal(value.calls.get.length, 2);
  assert.equal(value.calls.list.length, 1);
  const output = JSON.stringify(result);
  for (const secret of ['private server title', 'diagnostic-user', 'diagnostic-brand', 'generated-images/image-a', 'image-a']) {
    assert.equal(output.includes(secret), false, `diagnostic output leaked ${secret}`);
  }
});

test('an immutable pending partial match triggers one deduped GET when working is also a candidate', async () => {
  const id = idFor(3);
  const partial = { version: 1, objects: [structuredClone(anchor.objects[0])] };
  const value = fixture({
    cacheEntries: [cacheEntry(id, 'none', 'partial')],
    rows: [row(id, partial)],
  });
  const result = await run(value);
  assert.deepEqual(value.calls.get, [id]);
  assert.equal(result.observations[0].match, 'partial');
  assert.equal(result.code, 'competing_matches');

  const sameRecord = fixture({
    cacheEntries: [cacheEntry(id, 'partial', 'partial')],
    rows: [row(id, partial)],
  });
  await run(sameRecord);
  assert.deepEqual(sameRecord.calls.get, [id]);
});

test('raw rows require the actual supported snapshot, version, revision, and timestamps', async (t) => {
  const invalidRows = [
    { snapshot: undefined },
    { snapshot_version: 2 },
    { snapshot: { version: 1, objects: [{ id: 'invalid-object', type: 'unsupported' }] } },
    { snapshot: { version: 1, objects: Array.from({ length: 513 }, (_, index) => ({
      ...structuredClone(anchor.objects[index % 2]), id: `over-limit-${index}`,
    })) } },
    { revision: -1 },
    { revision: 1.5 },
    { created_at: '' },
    { updated_at: 'not-a-timestamp' },
  ];
  for (const [index, invalid] of invalidRows.entries()) {
    await t.test(`invalid raw row ${index + 1}`, async () => {
      const value = fixture({ rows: [row(idFor(index + 1), anchor, invalid)] });
      const result = await run(value);
      assert.equal(result.status, 'stopped');
      assert.ok(['list_response_invalid', 'record_invalid'].includes(result.code));
      assert.equal(result.complete, false);
    });
  }
});

test('same-brand foreign-owner matches are visible as competitors and cannot be selected as the user document', async () => {
  const foreignPartial = { version: 1, objects: [structuredClone(anchor.objects[0])] };
  const value = fixture({ rows: [
    row(idFor(1), anchor),
    row(idFor(2), foreignPartial, { owner_id: 'another-user', updated_at: '2026-09-30T10:59:00.000Z' }),
  ] });
  const result = await run(value);
  assert.equal(result.code, 'competing_matches');
  assert.equal(result.uniqueOwnedFullMatchObserved, false);
  assert.equal(result.observations.find((item) => item.documentId === idFor(2))?.ownedByCurrentUser, false);
  assert.equal(result.observations.find((item) => item.documentId === idFor(2))?.scopeCurrent, true);
});

test('short and empty pages establish only observational exhaustion', async () => {
  const short = fixture({ rows: [row(idFor(1), otherSnapshot)] });
  const shortResult = await run(short);
  assert.equal(shortResult.complete, true);
  assert.equal(shortResult.listExhausted, true);
  assert.equal(shortResult.code, 'no_full_match');

  const empty = fixture({ rows: [] });
  const emptyResult = await run(empty);
  assert.equal(emptyResult.complete, true);
  assert.equal(emptyResult.listExhausted, true);
  assert.equal(emptyResult.rowsObserved, 0);
});

test('ten full pages stop at the bounded offset cap without claiming exhaustion', async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => row(idFor(index + 1), otherSnapshot, {
    updated_at: new Date(Date.parse('2026-09-30T11:00:00.000Z') - index * 1000).toISOString(),
  }));
  const value = fixture({ rows });
  const result = await run(value);
  assert.equal(result.status, 'stopped');
  assert.equal(result.code, 'page_cap');
  assert.equal(result.pagesRead, 10);
  assert.equal(result.requests, 10);
  assert.equal(result.complete, false);
  assert.equal(result.truncated, true);
  assert.equal(result.listExhausted, false);
});

test('duplicate IDs and out-of-order pages stop with bounded findings', async (t) => {
  await t.test('duplicate ID', async () => {
    const duplicate = row(idFor(1), otherSnapshot);
    const value = fixture({ rows: [duplicate, structuredClone(duplicate)] });
    const result = await run(value);
    assert.equal(result.code, 'duplicate_id');
    assert.equal(result.consistent, false);
    assert.equal(result.requests, 1);
    assert.equal(result.counts.none, 1);
  });
  await t.test('order violation', async () => {
    const value = fixture({ rows: [
      row(idFor(1), otherSnapshot, { updated_at: '2026-09-30T10:00:00.000Z' }),
      row(idFor(2), otherSnapshot, { updated_at: '2026-09-30T10:01:00.000Z' }),
    ] });
    const result = await run(value);
    assert.equal(result.code, 'order_violation');
    assert.equal(result.consistent, false);
  });
});

test('GET/list and confirmation disagreements stop instead of reconciling a changed row', async (t) => {
  await t.test('cached GET differs from list', async () => {
    const id = idFor(1);
    const cachedGet = row(id, anchor, { revision: 1 });
    const listed = row(id, anchor, { revision: 2 });
    const value = fixture({ cacheEntries: [cacheEntry(id, 'full')], rows: [listed], getRows: new Map([[id, cachedGet]]) });
    const result = await run(value);
    assert.equal(result.code, 'get_list_disagreement');
    assert.equal(result.consistent, false);
  });
  await t.test('post-list confirmation differs', async () => {
    const id = idFor(2);
    const listed = row(id, anchor);
    const changed = row(id, anchor, { title: 'different private title' });
    const value = fixture({ rows: [listed], getRows: new Map([[id, changed]]) });
    const result = await run(value);
    assert.equal(result.code, 'get_list_disagreement');
    assert.deepEqual(value.calls.get, [id]);
    assert.equal(result.confirmationRequests, 1);
  });
  await t.test('GET id and brand fences', async () => {
    const id = idFor(3);
    const wrongId = fixture({ cacheEntries: [cacheEntry(id, 'full')], getRows: new Map([[id, row(idFor(4))]]) });
    assert.equal((await run(wrongId)).code, 'get_id_mismatch');
    const wrongBrand = fixture({ rows: [row(id, anchor, { brand_id: 'another-brand' })] });
    assert.equal((await run(wrongBrand)).code, 'brand_scope_mismatch');
  });
});

test('a definitive 404 is an observation; a later listed ID is an inconsistency', async () => {
  const absentId = idFor(1);
  const absent = fixture({ cacheEntries: [cacheEntry(absentId, 'partial')], missingIds: new Set([absentId]), rows: [] });
  const absentResult = await run(absent);
  assert.equal(absentResult.complete, true);
  assert.equal(absentResult.code, 'no_full_match');
  assert.equal(absentResult.uniqueOwnedFullMatchObserved, false);

  const listedAfter404 = fixture({ cacheEntries: [cacheEntry(absentId, 'partial')], missingIds: new Set([absentId]), rows: [row(absentId)] });
  const disagreement = await run(listedAfter404);
  assert.equal(disagreement.code, 'get_list_disagreement');
  assert.equal(disagreement.consistent, false);
});

test('a cache GET absent from an exhausted list is inconsistent and cache inputs are capped', async () => {
  const id = idFor(1);
  const missingFromList = fixture({ cacheEntries: [cacheEntry(id, 'partial')], rows: [row(idFor(2), otherSnapshot)], getRows: new Map([[id, row(id)]]) });
  assert.equal((await run(missingFromList)).code, 'get_candidate_missing_from_list');

  const tooMany = fixture({ cacheEntries: Array.from({ length: 9 }, (_, index) => cacheEntry(idFor(index + 1), 'partial')) });
  const limited = await run(tooMany);
  assert.equal(limited.code, 'cache_candidate_limit');
  assert.equal(limited.requests, 0);
  const tooManyNone = fixture({ cacheEntries: Array.from({ length: 9 }, (_, index) => cacheEntry(idFor(index + 11), 'none')) });
  assert.equal((await run(tooManyNone)).code, 'cache_candidate_limit');
  assert.equal(tooManyNone.calls.get.length, 0);
});

test('no retry, fixed redacted errors, and the full request budget stay bounded', async () => {
  const broken = fixture({
    cacheEntries: [cacheEntry(idFor(1), 'partial')],
    getHook: () => { throw new Error('private title token=do-not-leak'); },
  });
  const brokenResult = await run(broken);
  assert.equal(brokenResult.code, 'request_failed');
  assert.equal(brokenResult.requests, 1);
  assert.equal(broken.calls.list.length, 0);
  assert.equal(JSON.stringify(brokenResult).includes('do-not-leak'), false);

  const genericNotFound = fixture({
    cacheEntries: [cacheEntry(idFor(2), 'partial')],
    getHook: () => { throw new Error('generic 404 transport detail'); },
  });
  const genericNotFoundResult = await run(genericNotFound);
  assert.equal(genericNotFoundResult.code, 'request_failed');
  assert.equal(genericNotFound.calls.get.length, 1);
  assert.equal(genericNotFound.calls.list.length, 0);

  const cachedEntries = Array.from({ length: 8 }, (_, index) => cacheEntry(idFor(index + 1), 'partial'));
  const rows = Array.from({ length: 902 }, (_, index) => row(idFor(index + 1), index === 900 ? anchor : otherSnapshot, {
    updated_at: new Date(Date.parse('2026-09-30T11:00:00.000Z') - index * 1000).toISOString(),
  }));
  const allGets = new Map(rows.slice(0, 8).map((value) => [value.id, value]));
  allGets.set(idFor(901), rows[900]);
  const bounded = fixture({ cacheEntries: cachedEntries, rows, getRows: allGets });
  const boundedResult = await run(bounded);
  assert.equal(boundedResult.code, 'unique_owned_full_match_observed');
  assert.equal(boundedResult.requests, 19);
  assert.equal(boundedResult.getRequests, 8);
  assert.equal(boundedResult.cacheCandidatesRead, 8);
  assert.equal(boundedResult.listRequests, 10);
  assert.equal(boundedResult.confirmationRequests, 1);
  assert.equal(boundedResult.complete, true);
});

test('token, brand, snapshot, cancellation, and late-response fences prevent subsequent calls', async (t) => {
  for (const changedFence of ['token', 'brand', 'snapshot', 'cancelled'] as const) {
    await t.test(changedFence, async () => {
      let current = true;
      const value = fixture({
        cacheEntries: [cacheEntry(idFor(1), 'partial')],
        rows: [row(idFor(1))],
        assertCurrent: () => { if (!current) throw new Error('private fence detail'); },
        getHook: () => { current = false; },
      });
      const result = await run(value);
      assert.equal(result.status, 'stale');
      assert.equal(result.code, 'context_changed');
      assert.equal(value.calls.get.length, 1);
      assert.equal(value.calls.list.length, 0);
      assert.equal(result.uniqueOwnedFullMatchObserved, false);
      assert.equal(JSON.stringify(result).includes('private fence detail'), false);
    });
  }
});

test('the real contextual list client pins auth, checks caller fences, and keeps legacy calls working', async () => {
  const previousFetch = globalThis.fetch;
  let currentToken = 'fixture-token-one';
  const requestLog: Array<{ url: string; authorization: string | null; timeout: boolean }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://fixture.example');
    if (url.pathname === '/api/auth/get-session') {
      return new Response(JSON.stringify({
        user: { id: 'fixture-user', email: 'fixture@example.test', name: 'Fixture', emailVerified: true, createdAt: '2026-09-30T00:00:00.000Z' },
        session: { token: currentToken, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/v1/canvas-documents') {
      requestLog.push({
        url: `${url.pathname}${url.search}`,
        authorization: new Headers(init?.headers).get('authorization'),
        timeout: init?.signal instanceof AbortSignal,
      });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected_fixture_network_path');
  }) as typeof fetch;

  let closeVite: (() => Promise<void>) | null = null;
  try {
    const vite = await createServer({
      configFile: false,
      root: process.cwd(),
      logLevel: 'silent',
      appType: 'custom',
      server: { middlewareMode: true },
      define: {
        'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': JSON.stringify('https://fixture.example'),
        'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': JSON.stringify('1'),
      },
    });
    closeVite = () => vite.close();
    const { cloudflareDataPlane } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
    const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
    assert.ok(cloudflareDataPlane);
    assert.equal(cloudflareDataPlane.origin, 'https://fixture.example');
    const expectedToken = currentToken;
    let currentBrand = brandId;
    const assertContext = async () => {
      const session = await auth.getSession();
      if (currentBrand !== brandId || session.error || session.data.session?.user?.id !== 'fixture-user'
        || session.data.session?.access_token !== expectedToken) throw new Error('fixture_context_changed');
    };

    assert.deepEqual(await cloudflareDataPlane.listCanvasDocumentsPage(brandId, 100, 0, {
      userId: 'fixture-user', assertContext,
    }), []);
    assert.equal(requestLog.length, 1);
    assert.equal(requestLog[0].authorization, 'Bearer fixture-token-one');
    assert.equal(requestLog[0].timeout, true);
    const firstUrl = new URL(`https://fixture.example${requestLog[0].url}`);
    assert.equal(firstUrl.searchParams.get('brand_id'), brandId);
    assert.equal(firstUrl.searchParams.get('limit'), '100');
    assert.equal(firstUrl.searchParams.get('offset'), '0');

    currentBrand = 'changed-brand';
    await assert.rejects(cloudflareDataPlane.listCanvasDocumentsPage(brandId, 100, 0, {
      userId: 'fixture-user', assertContext,
    }));
    assert.equal(requestLog.length, 1);

    currentBrand = brandId;
    currentToken = 'fixture-token-two';
    await auth.refreshSession();
    await assert.rejects(cloudflareDataPlane.listCanvasDocumentsPage(brandId, 100, 0, {
      userId: 'fixture-user', assertContext,
    }));
    assert.equal(requestLog.length, 1);

    await cloudflareDataPlane.listCanvasDocumentsPage(brandId, 100, 0);
    assert.equal(requestLog.length, 2);
    assert.equal(requestLog[1].authorization, 'Bearer fixture-token-two');
  } finally {
    await closeVite?.();
    globalThis.fetch = previousFetch;
  }
});
