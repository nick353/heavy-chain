import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createDesignArtifactScopeKey,
  DESIGN_PROJECT_PAGE_SIZE,
  designEntryHref,
  designHistoryFeatureTypes,
  isCurrentDesignArtifactScope,
  isSyntheticDesignFallback,
  paginate,
  toDesignEntries,
  type DesignProjectEntry,
} from '../src/lib/designProjectArtifacts.ts';
import type { WorkspaceArtifact } from '../src/lib/localWorkspaceArtifacts.ts';

const makeArtifact = (
  id: string,
  overrides: Partial<WorkspaceArtifact> = {},
): WorkspaceArtifact => ({
  id,
  brandId: 'brand-a',
  featureType: 'generate-image',
  title: id,
  imageUrl: '',
  prompt: null,
  createdAt: '2026-09-30T00:00:00.000Z',
  metadata: {},
  ...overrides,
});

test('actual design project pagination handles empty, exact, partial, and many pages', () => {
  assert.equal(DESIGN_PROJECT_PAGE_SIZE, 20);

  for (const [count, pageCount, lastPageLength] of [
    [0, 1, 0],
    [1, 1, 1],
    [20, 1, 20],
    [21, 2, 1],
    [61, 4, 1],
  ] as const) {
    const artifacts = Array.from({ length: count }, (_, index) => `project-${index + 1}`);
    const lastPage = paginate(artifacts, 99);
    assert.equal(lastPage.pageCount, pageCount, `page count for ${count} rows`);
    assert.equal(lastPage.page, pageCount, `clamped last page for ${count} rows`);
    assert.equal(lastPage.items.length, lastPageLength, `last-page size for ${count} rows`);
  }
});

test('pagination clamps lower bounds, separates real pages, and clamps after deletion', () => {
  const artifacts = Array.from({ length: 21 }, (_, index) => `project-${index + 1}`);
  const firstPage = paginate(artifacts, 0);
  const lastPage = paginate(artifacts, 2);

  assert.equal(firstPage.page, 1);
  assert.equal(firstPage.items[0], 'project-1');
  assert.equal(lastPage.items[0], 'project-21');
  assert.notDeepEqual(firstPage.items, lastPage.items);

  const afterDeletingLast = paginate(artifacts.slice(0, 20), lastPage.page);
  assert.equal(afterDeletingLast.pageCount, 1);
  assert.equal(afterDeletingLast.page, 1);
});

test('synthetic design fallbacks are hidden while real supported artifacts remain', () => {
  const actual = makeArtifact('saved-project');
  const syntheticId = makeArtifact('source-design-production-untitled-1');
  const syntheticFeature = makeArtifact('source-like-id', { featureType: 'design-production-source-fallback' });
  const unsupported = makeArtifact('unmapped-feature', { featureType: 'unknown-feature' });
  const stored = [actual, syntheticId, syntheticFeature, unsupported];

  assert.equal(isSyntheticDesignFallback(syntheticId), true);
  assert.equal(isSyntheticDesignFallback(syntheticFeature), true);
  assert.deepEqual(toDesignEntries(stored, []).map(({ artifact }) => artifact.id), ['saved-project']);
  assert.equal(stored.length, 4, 'filtering must not delete stored artifacts');
  assert.equal(designHistoryFeatureTypes.has(actual.featureType), true);
});

test('only producer-grounded current studio and fabric result types join Design history', () => {
  const confirmedTypes = [
    'fashion-studio-detail-generated-result',
    'lightchain-fabric-image',
    'lightchain-fabric-image-provider-result',
  ];
  const unsupportedTypes = [
    'marketing-detail',
    'wear-design-detail',
    'lightchain-printing-image-provider-result',
    'unknown-design-feature',
  ];
  const candidates = [
    ...confirmedTypes.map((featureType) => makeArtifact(`supported-${featureType}`, { featureType })),
    ...unsupportedTypes.map((featureType) => makeArtifact(`unconfirmed-${featureType}`, { featureType })),
  ];

  assert.deepEqual(toDesignEntries(candidates, []).map(({ artifact }) => artifact.featureType), confirmedTypes);
  assert.equal(designHistoryFeatureTypes.has(''), false);
  assert.equal(designHistoryFeatureTypes.has('generate-image'), true);
});

test('local artifacts win canonical remote duplicates and entries sort by date then id', () => {
  const local = makeArtifact('local-copy', {
    createdAt: '2026-09-29T00:00:00.000Z',
    metadata: { remoteImageId: 'image-42' },
  });
  const remote = makeArtifact('image-42', {
    createdAt: '2026-09-30T00:00:00.000Z',
    metadata: { remoteImageId: 'image-42', imageId: 'image-42-alias' },
  });
  const remoteAlias = makeArtifact('image-42-alias-row', {
    metadata: { imageId: 'image-42-alias' },
  });
  const storageLocal = makeArtifact('local-storage-copy', {
    metadata: { remoteStoragePath: 'generated-images/image-43' },
  });
  const storageRemote = makeArtifact('image-43', {
    metadata: { remoteStoragePath: 'generated-images/image-43' },
  });
  const laterZ = makeArtifact('z-later-tie', { createdAt: '2026-09-30T00:00:00.000Z' });
  const laterA = makeArtifact('a-later-tie', { createdAt: '2026-09-30T00:00:00.000Z' });

  const entries = toDesignEntries([local, storageLocal], [remote, remoteAlias, storageRemote, laterZ, laterA]);
  assert.deepEqual(entries.map(({ artifact }) => artifact.id), [
    'a-later-tie',
    'local-storage-copy',
    'z-later-tie',
    'local-copy',
  ]);
  assert.equal(entries.find(({ artifact }) => artifact.id === 'local-copy')?.origin, 'local');
  assert.equal(entries.find(({ artifact }) => artifact.id === 'local-storage-copy')?.origin, 'local');
});

test('design entries use valid local and remote Canvas routes and fail closed without a remote id', () => {
  const local: DesignProjectEntry = {
    artifact: makeArtifact('local project/1'),
    origin: 'local',
  };
  const remote: DesignProjectEntry = {
    artifact: makeArtifact('remote-id', { metadata: { remoteImageId: 'image/2' } }),
    origin: 'remote',
  };
  const missingRemoteId: DesignProjectEntry = {
    artifact: makeArtifact('remote-without-canonical-id'),
    origin: 'remote',
  };

  assert.equal(designEntryHref(local), '/canvas/new?sourceArtifactId=local%20project%2F1');
  assert.equal(designEntryHref(remote), '/canvas/new?galleryImageId=image%2F2');
  assert.equal(designEntryHref(remote)?.includes('sourceArtifactId'), false);
  assert.equal(designEntryHref(missingRemoteId), null);
});

test('design artifact scope key rejects a switched or cancelled synchronous scope', () => {
  const captured = createDesignArtifactScopeKey('user-a', 'brand-a');
  const unchanged = createDesignArtifactScopeKey('user-a', 'brand-a');
  const switchedBrand = createDesignArtifactScopeKey('user-a', 'brand-b');
  const missingUser = createDesignArtifactScopeKey(null, 'brand-b');

  assert.equal(isCurrentDesignArtifactScope(captured, unchanged), true);
  assert.equal(isCurrentDesignArtifactScope(captured, switchedBrand), false);
  assert.equal(isCurrentDesignArtifactScope(captured, unchanged, true), false);
  assert.equal(isCurrentDesignArtifactScope(captured, missingUser), false);
  assert.equal(createDesignArtifactScopeKey(null, null), 'null:null');
});

test('a controlled awaited load cannot commit after live auth becomes null or changes brand', async () => {
  const capturedScope = createDesignArtifactScopeKey('user-a', 'brand-a');

  for (const liveScope of [
    createDesignArtifactScopeKey(null, 'brand-a'),
    createDesignArtifactScopeKey('user-a', 'brand-b'),
  ]) {
    let resolveRead!: (value: string) => void;
    let currentLiveScope = capturedScope;
    let committedValue: string | null = null;
    const pendingRead = new Promise<string>((resolve) => { resolveRead = resolve; });
    const loadAndCommit = pendingRead.then((value) => {
      // This is the same production helper the component calls after each await,
      // before any auth effect can update component scope state.
      if (isCurrentDesignArtifactScope(capturedScope, currentLiveScope)) committedValue = value;
    });

    currentLiveScope = liveScope;
    resolveRead('old-scope-artifacts');
    await loadAndCommit;
    assert.equal(committedValue, null);
  }
});

test('Design page reads scoped real entries, paginates cards, and renders numbered buttons', async () => {
  const source = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');

  assert.match(source, /toDesignEntries\(localArtifacts, remoteArtifacts\)/);
  assert.match(source, /featureType: image\.feature_type \?\? 'generate-image'/);
  assert.match(source, /runDesignProjectArtifactLoad\(/);
  assert.match(source, /isCurrentDesignArtifactLoad\(/);
  assert.match(source, /setDesignArtifactLoadState\(\{ status: 'loading' \}\)/);
  assert.match(source, /data-testid="design-project-remote-error"/);
  assert.match(source, /data-testid="design-project-retry"/);
  assert.match(source, /startDesignArtifactLoad\(designScopeKey, designUserId, designBrandId\)/);
  const retryControl = source.match(/onClick=\{\(\) => \{ startDesignArtifactLoad\(designScopeKey, designUserId, designBrandId\); \}\} data-testid="design-project-retry"/)?.[0] ?? '';
  assert.match(retryControl, /startDesignArtifactLoad\(/);
  assert.doesNotMatch(retryControl, /generate|saveWorkspaceArtifactBestEffort/);
  assert.match(source, /data-testid="design-project-empty"/);
  assert.match(source, /paginate\(displayDesignEntries, projectPage, DESIGN_PROJECT_PAGE_SIZE\)/);
  assert.match(source, /designEntryHref\(entry\)/);
  assert.match(source, /createDesignArtifactScopeKey\(designUserId, designBrandId\)/);
  assert.match(source, /persistedDesignScopeKey === designScopeKey\s*\? designArtifactLoadState\s*:\s*\{ status: 'loading' \}/);
  assert.match(source, /if \(!userId \|\| !brandId \|\| !isCurrentDesignArtifactLoad\(/);
  assert.ok(source.indexOf('if (!userId || !brandId || !isCurrentDesignArtifactLoad(') < source.indexOf('void runDesignProjectArtifactLoad({'));
  assert.match(source, /isCurrentDesignArtifactScope\(scopeKey,/);
  assert.match(source, /data-testid="design-production-pagination"/);
  assert.match(source, /type="button"[\s\S]*aria-current=\{index \+ 1 === page\.page \? 'page' : undefined\}/);
  assert.doesNotMatch(source, /source-design-production-untitled-/);
  assert.doesNotMatch(source, /const projectPageCount = 6/);
  assert.doesNotMatch(source, /visibleProjectArtifacts = displayDesignArtifacts/);
});
