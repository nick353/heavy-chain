import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  hydrateGenerationSourceReferences,
  isGenerationReferenceHydrationScopeCurrent,
  type GenerationReferenceHydrationScope,
} from '../src/lib/generationReferenceHydration.ts';
import type { GenerationSourceReference } from '../src/lib/generationSourceReferences.ts';

const makeReferences = (count: number): GenerationSourceReference[] => Array.from({ length: count }, (_, index) => ({
  sourceImageId: `reference-${index + 1}`,
  sourceStoragePath: `generated-images/reference-${index + 1}`,
  sourceFileName: `fabric-${index + 1}.jpg`,
}));

const createScope = (): GenerationReferenceHydrationScope => ({
  userId: 'user-a',
  brandId: 'brand-a',
  featureId: 'design-gacha',
  navigationKey: 'feature=design-gacha&sourceReferences=manifest-a',
  requestGeneration: 12,
});

const encode = (references: GenerationSourceReference[]) => JSON.stringify(references);

test('hydrates five and sixteen source references in their original manifest order', async (t) => {
  for (const count of [5, 16]) {
    await t.test(`${count} references`, async () => {
      const scope = createScope();
      const manifest = makeReferences(count);
      const resolvedPaths: string[] = [];
      const result = await hydrateGenerationSourceReferences({
        manifestValues: [encode(manifest)],
        scope,
        getCurrentScope: () => scope,
        resolveImageUrl: async (path) => {
          resolvedPaths.push(path);
          return `https://media.example/${path.split('/').at(-1)}`;
        },
      });

      assert.equal(result.status, 'resolved');
      if (result.status !== 'resolved') return;
      assert.deepEqual(resolvedPaths, manifest.map((reference) => reference.sourceStoragePath));
      assert.deepEqual(result.references.map((reference) => reference.order), manifest.map((_, index) => index));
      assert.deepEqual(
        result.references.map((reference) => reference.imageUrl),
        manifest.map((reference) => `https://media.example/${reference.sourceImageId}`),
      );
    });
  }
});

test('a fifth-reference resolution failure returns no partial references', async () => {
  const scope = createScope();
  const manifest = makeReferences(5);
  const result = await hydrateGenerationSourceReferences({
    manifestValues: [encode(manifest)],
    scope,
    getCurrentScope: () => scope,
    resolveImageUrl: async (path) => {
      if (path.endsWith('reference-5')) throw new Error('ownership/read failure');
      return `https://media.example/${path.split('/').at(-1)}`;
    },
  });

  assert.deepEqual(result, {
    status: 'failed',
    reason: 'image_resolution_failed',
    failedIndex: 4,
  });
  assert.equal('references' in result, false);
});

test('legacy scalar source hydrates as a single-reference manifest', async () => {
  const scope = createScope();
  const legacyReference = makeReferences(1)[0];
  const result = await hydrateGenerationSourceReferences({
    manifestValues: [],
    legacyReference,
    scope,
    getCurrentScope: () => scope,
    resolveImageUrl: async (path) => `https://media.example/${path.split('/').at(-1)}`,
  });

  assert.equal(result.status, 'resolved');
  if (result.status !== 'resolved') return;
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].sourceImageId, 'reference-1');
  assert.equal(result.references[0].order, 0);
});

test('malformed or duplicated manifests fail closed without resolving a URL', async () => {
  const scope = createScope();
  let resolverCalls = 0;
  for (const manifestValues of [['{'], ['[]', '[]']]) {
    const result = await hydrateGenerationSourceReferences({
      manifestValues,
      scope,
      getCurrentScope: () => scope,
      resolveImageUrl: async () => {
        resolverCalls += 1;
        return 'https://media.example/unexpected';
      },
    });
    assert.equal(result.status, 'failed');
  }
  assert.equal(resolverCalls, 0);
});

test('an incomplete user/brand scope cannot start an authenticated reference read', async () => {
  const scope = { ...createScope(), userId: null };
  let resolverCalls = 0;
  const result = await hydrateGenerationSourceReferences({
    manifestValues: [encode(makeReferences(1))],
    scope,
    getCurrentScope: () => scope,
    resolveImageUrl: async () => {
      resolverCalls += 1;
      return 'https://media.example/unexpected';
    },
  });

  assert.deepEqual(result, { status: 'failed', reason: 'generation_reference_scope_unavailable' });
  assert.equal(resolverCalls, 0);
});

test('user, brand, feature, navigation, and request-generation changes discard late results', async (t) => {
  const mutations: Array<[string, (scope: GenerationReferenceHydrationScope) => void]> = [
    ['user switch', (scope) => { scope.userId = 'user-b'; }],
    ['brand switch', (scope) => { scope.brandId = 'brand-b'; }],
    ['feature switch', (scope) => { scope.featureId = 'model-matrix'; }],
    ['navigation switch', (scope) => { scope.navigationKey = 'feature=design-gacha&prompt=other'; }],
    ['request-generation switch', (scope) => { scope.requestGeneration += 1; }],
  ];

  for (const [label, mutate] of mutations) {
    await t.test(label, async () => {
      const captured = createScope();
      const live = { ...captured };
      let resolveRead!: (value: string) => void;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      const pendingRead = new Promise<string>((resolve) => { resolveRead = resolve; });
      const hydration = hydrateGenerationSourceReferences({
        manifestValues: [encode(makeReferences(1))],
        scope: captured,
        getCurrentScope: () => live,
        resolveImageUrl: async () => {
          markStarted();
          return pendingRead;
        },
      });

      await started;
      mutate(live);
      resolveRead('https://media.example/late');
      assert.deepEqual(await hydration, { status: 'stale' });
    });
  }
});

test('logout is an independent auth fence before sequence or brand state changes', async () => {
  const captured = createScope();
  const live = { ...captured };
  let resolveRead!: (value: string) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const pendingRead = new Promise<string>((resolve) => { resolveRead = resolve; });
  const hydration = hydrateGenerationSourceReferences({
    manifestValues: [encode(makeReferences(1))],
    scope: captured,
    getCurrentScope: () => live,
    resolveImageUrl: async () => {
      markStarted();
      return pendingRead;
    },
  });

  await started;
  live.userId = null;
  // Model the render gap: the old brand and request sequence have not changed.
  assert.equal(live.brandId, captured.brandId);
  assert.equal(live.requestGeneration, captured.requestGeneration);
  assert.equal(isGenerationReferenceHydrationScopeCurrent(captured, live), false);
  resolveRead('https://media.example/late');
  assert.deepEqual(await hydration, { status: 'stale' });
});

test('the active design-gacha branch passes all hydrated URLs through generateImage', () => {
  const page = readFileSync(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  const start = page.indexOf("case 'design-gacha':", page.indexOf('const handleGenerate'));
  const end = page.indexOf("case 'product-shots':", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const branch = page.slice(start, end);

  assert.match(branch, /await generateImage\(designGachaPrompt, generationBrand\.id/);
  assert.match(branch, /imageUrls:\s*designGachaImageUrls/);
  assert.match(branch, /hydratedSourceReferences\.map\(\(reference\) => reference\.imageUrl\)/);
  assert.match(branch, /processedImageUrl\s*\?\s*\[processedImageUrl\]\s*:\s*\[\]/);
  assert.match(page, /const firstReference = result\.references\[0\]/);
  assert.match(page, /url: firstReference\.imageUrl/);
  assert.match(page, /setGenerationError\(message\)/);
  assert.ok(page.indexOf('if (!scope.userId || !scope.brandId)') < page.indexOf('resolveImageUrl: resolveGeneratedImageUrl'));
});
