import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createFashionStudioDetailHydration,
  extractFashionStudioSavedDetail,
  fashionStudioDetailScopeKey,
  fashionStudioRemainingUnits,
  validateFashionStudioDetailDocument,
  type FashionStudioDetailHydrationState,
  type FashionStudioDetailScope,
} from '../src/lib/fashionStudioDetailHydration.ts';
import { createFashionStudioThumbnailController, type FashionStudioThumbnailState } from '../src/lib/fashionStudioThumbnails.ts';

const scope: FashionStudioDetailScope = {
  userId: 'owner', brandId: 'brand', documentId: '78bcea8d-aa0a-4e34-b08a-2ab11106d603', generation: 1,
};
const fixture = {
  id: scope.documentId, ownerId: scope.userId, brandId: scope.brandId, title: '制作: 平絵をベクター化', revision: 0,
  snapshot: { objects: [
    { id: 'trrso3l547a', type: 'image', src: 'https://example.test/original.png', metadata: {
      feature: 'lightchain-svg-convert-material-reference', parameters: {
        layerRole: 'material-reference', artifactId: 'local-f0280dd1-a912-4524-ab78-f052a534c39d',
      },
    } },
    { id: 'overlaylayer', type: 'text', text: 'overlay' },
    { id: 'j2thevevg3', type: 'image', src: 'https://example.test/result-stale.svg', metadata: {
      feature: 'lightchain-svg-convert-generated-result', status: 'completed',
      imageId: 'ai-f82fde9b-e8a5-4704-ba50-fc44b6ff79af-0', galleryImageId: 'ai-f82fde9b-e8a5-4704-ba50-fc44b6ff79af-0',
      storagePath: 'generated-images/ai-f82fde9b-e8a5-4704-ba50-fc44b6ff79af-0',
      parameters: { artifactId: 'local-f0280dd1-a912-4524-ab78-f052a534c39d' },
    } },
    { id: 'workbench', type: 'text', metadata: { prompt: 'unassociated text is not the generation prompt' } },
  ] },
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

test('supplied fixture assigns reference/result explicitly and leaves main and prompt missing', () => {
  const detail = extractFashionStudioSavedDetail(fixture.snapshot);
  assert.equal(detail.roles.main.status, 'missing');
  assert.equal(detail.roles.main.candidates.length, 0);
  assert.equal(detail.roles.reference.objectId, 'trrso3l547a');
  assert.deepEqual(detail.roles.reference.candidates, ['https://example.test/original.png']);
  assert.equal(detail.roles.result.objectId, 'j2thevevg3');
  assert.deepEqual(detail.roles.result.candidates, [
    'generated-images/ai-f82fde9b-e8a5-4704-ba50-fc44b6ff79af-0', 'https://example.test/result-stale.svg',
  ]);
  assert.equal(detail.prompt, '');
});

test('reordered objects do not change role assignments', () => {
  assert.deepEqual(extractFashionStudioSavedDetail({ objects: [...fixture.snapshot.objects].reverse() }),
    extractFashionStudioSavedDetail(fixture.snapshot));
});

test('only explicit original-base maps main; an unlabelled image is never assigned by position', () => {
  const missing = extractFashionStudioSavedDetail({ objects: [{ type: 'image', src: 'https://unlabelled' }] });
  assert.ok(Object.values(missing.roles).every((asset) => asset.status === 'missing'));
  const detail = extractFashionStudioSavedDetail({ objects: [{ id: 'base', type: 'image', src: 'https://base', metadata: {
    feature: 'lightchain-x-original-base-layer', parameters: { layerRole: 'original-base' },
  } }] });
  assert.equal(detail.roles.main.objectId, 'base');
  assert.equal(detail.roles.reference.status, 'missing');
});

test('duplicate and conflicting roles remain ambiguous with no candidates', () => {
  const reference = fixture.snapshot.objects[0];
  const duplicate = extractFashionStudioSavedDetail({ objects: [reference, { ...reference, id: 'second' }] });
  assert.equal(duplicate.roles.reference.status, 'ambiguous');
  assert.deepEqual(duplicate.roles.reference.candidates, []);
  const conflict = extractFashionStudioSavedDetail({ objects: [{ type: 'image', src: 'https://conflict', metadata: {
    feature: 'lightchain-x-generated-result', parameters: { layerRole: 'material-reference' },
  } }] });
  assert.equal(conflict.roles.reference.status, 'ambiguous');
  assert.equal(conflict.roles.result.status, 'ambiguous');
});

test('prompt requires one explicitly associated metadata value, never demo/text/ambiguous values', () => {
  const image = { type: 'image', src: 'https://result', metadata: {
    feature: 'lightchain-x-generated-result', prompt: 'actual prompt', parameters: { prompt: 'actual prompt' },
  } };
  assert.equal(extractFashionStudioSavedDetail({ objects: [image] }).prompt, 'actual prompt');
  assert.equal(extractFashionStudioSavedDetail({ objects: [image, { ...image }] }).prompt, '');
  assert.equal(extractFashionStudioSavedDetail({ objects: [{ ...image, metadata: {
    ...image.metadata, parameters: { prompt: 'different prompt' },
  } }] }).prompt, '');
});

test('owner, brand and document IDs are verified for wire and normalized records', () => {
  assert.equal(validateFashionStudioDetailDocument(fixture, scope), true);
  assert.equal(validateFashionStudioDetailDocument({ id: scope.documentId, owner_id: scope.userId, brand_id: scope.brandId }, scope), true);
  for (const field of ['id', 'ownerId', 'brandId']) {
    assert.equal(validateFashionStudioDetailDocument({ ...fixture, [field]: 'other' }, scope), false);
  }
  assert.equal(validateFashionStudioDetailDocument({ ...fixture, owner_id: 'conflicting' }, scope), false);
});

test('credits accept only a nonnegative safe integer from actual remainingUnits', () => {
  for (const value of [0, 42, Number.MAX_SAFE_INTEGER]) assert.equal(fashionStudioRemainingUnits({ remainingUnits: value }), value);
  for (const value of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '42', null, undefined]) {
    assert.equal(fashionStudioRemainingUnits({ remainingUnits: value }), null);
  }
  assert.equal(fashionStudioRemainingUnits(null), null);
});

test('async hydration sends owner context, shows actual title/roles and reads brand usage', async () => {
  const states: FashionStudioDetailHydrationState[] = [];
  let usageBrand = '';
  const loader = createFashionStudioDetailHydration({
    getDocument: async (id, context) => {
      assert.equal(id, scope.documentId); assert.equal(context.userId, scope.userId); context.assertContext(); return fixture;
    },
    getUsage: async (brandId) => { usageBrand = brandId; return { remainingUnits: 27 }; },
    assertScope: (expected) => assert.deepEqual(expected, scope), publish: (state) => states.push(state),
  });
  await loader.load(scope);
  assert.equal(states[0].status, 'pending');
  assert.equal(states[0].title, '');
  assert.equal(states.at(-1)?.title, fixture.title);
  assert.equal(states.at(-1)?.detail.roles.main.status, 'missing');
  assert.equal(states.at(-1)?.remainingUnits, 27);
  assert.equal(usageBrand, scope.brandId);
});

test('mismatched document clears roles/title rather than using local or demo fallback', async () => {
  const states: FashionStudioDetailHydrationState[] = [];
  const loader = createFashionStudioDetailHydration({
    getDocument: async () => ({ ...fixture, ownerId: 'wrong' }), getUsage: async () => ({}),
    assertScope: () => {}, publish: (state) => states.push(state),
  });
  await loader.load(scope);
  assert.equal(states.at(-1)?.status, 'failure');
  assert.equal(states.at(-1)?.title, '');
  assert.ok(Object.values(states.at(-1)!.detail.roles).every((asset) => asset.candidates.length === 0));
});

test('stale async hydration and usage cannot replace a newly selected scope', async () => {
  const oldDocument = deferred<unknown>();
  const oldUsage = deferred<unknown>();
  const states: FashionStudioDetailHydrationState[] = [];
  const next = { ...scope, brandId: 'next', documentId: 'next-document', generation: 2 };
  const loader = createFashionStudioDetailHydration({
    getDocument: (id) => id === scope.documentId ? oldDocument.promise : Promise.resolve({ ...fixture, id: next.documentId, brandId: next.brandId, title: 'next' }),
    getUsage: (brandId) => brandId === scope.brandId ? oldUsage.promise : Promise.resolve({ remainingUnits: 9 }),
    assertScope: () => {}, publish: (state) => states.push(state),
  });
  const old = loader.load(scope);
  await loader.load(next);
  const count = states.length;
  oldDocument.resolve(fixture); oldUsage.resolve({ remainingUnits: 100 }); await old;
  assert.equal(states.length, count);
  assert.equal(states.at(-1)?.scopeKey, fashionStudioDetailScopeKey(next));
  assert.equal(states.at(-1)?.remainingUnits, 9);
});

test('context failure and disposal fence late hydration completion', async () => {
  for (const dispose of [false, true]) {
    const pending = deferred<unknown>();
    const states: FashionStudioDetailHydrationState[] = [];
    let valid = true;
    const loader = createFashionStudioDetailHydration({
      getDocument: () => pending.promise, getUsage: async () => ({ remainingUnits: 0 }),
      assertScope: () => { if (!valid) throw new Error('stale'); }, publish: (state) => states.push(state),
    });
    const loading = loader.load(scope); await flush();
    const count = states.length;
    if (dispose) loader.dispose(); else valid = false;
    pending.resolve(fixture); await loading;
    assert.equal(states.length, count);
  }
});

test('role fallback stays within its role and distinguishes URL resolution from image load', async () => {
  const detail = extractFashionStudioSavedDetail(fixture.snapshot);
  const states: FashionStudioThumbnailState[] = [];
  const calls: string[] = [];
  const controller = createFashionStudioThumbnailController(async (source) => {
    calls.push(source); return source.startsWith('generated-images/') ? { ok: false } : { ok: true, url: source };
  }, (state) => states.push(state));
  controller.reset(scope.brandId, `${scope.documentId}:result`, detail.roles.result.candidates);
  await flush();
  assert.equal(states.at(-1)?.status, 'loading');
  assert.equal(calls.includes(detail.roles.reference.candidates[0]), false);
  const pendingImage = states.at(-1)!;
  controller.onLoad(pendingImage);
  assert.equal(states.at(-1)?.status, 'loaded');
  controller.reset(scope.brandId, `${scope.documentId}:main`, detail.roles.main.candidates);
  assert.equal(states.at(-1)?.status, 'failure');
  controller.onError(pendingImage); controller.onLoad(pendingImage);
  assert.equal(states.at(-1)?.status, 'failure');
});

test('page keeps geometry and guards scopes without demo values, ID-derived paths or fake generation success', () => {
  const page = readFileSync(new URL('../src/pages/FashionStudioDetailPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /const \{ user, currentBrand, brandState \} = useAuthStore\(\)/);
  assert.match(page, /cloudflareDataPlane\.getCanvasDocument\(documentId, context\)/);
  assert.match(page, /cloudflareDataPlane\.getImageUsage\(brandId\)/);
  assert.match(page, /hydration\?\.scopeKey === scopeKey/);
  assert.match(page, /currentScopeRef\.current !== scopeKey/);
  assert.match(page, /currentImageScopeRef\.current !== imageScope/);
  assert.match(page, /assertAttemptContext\(\)/);
  assert.match(page, /key=\{`\$\{imageScope\}:\$\{current\.attempt\}`\}/);
  assert.match(page, /data-image-status=\{current\.status\}/);
  assert.doesNotMatch(page, /static-jp|REFERENCE_ASSETS|375731|setNotice|listWorkspaceArtifacts|generated-images\//);
  for (const marker of ['fashion-studio-source-main-node', 'fashion-studio-source-reference-node', 'fashion-studio-source-result-node',
    'fashion-studio-source-generation-panel', 'size-[100px]', 'size-[140px]', 'h-[420px]', 'h-20 w-full rounded-3xl']) assert.ok(page.includes(marker));
});
