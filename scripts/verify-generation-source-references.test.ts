import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as sourceReferenceHelpers from '../src/lib/generationSourceReferences.ts';

type HandoffModule = typeof import('../src/lib/workspaceHandoff.ts');
type SourceReference = sourceReferenceHelpers.GenerationSourceReference;

const handoffSource = await readFile(new URL('../src/lib/workspaceHandoff.ts', import.meta.url), 'utf8');
const compiledHandoff = ts.transpileModule(handoffSource, {
  fileName: 'workspaceHandoff.ts',
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
assert.equal(compiledHandoff.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error).length, 0);

const handoff = (() => {
  const exports: Record<string, unknown> = {};
  const modules: Record<string, unknown> = {
    './localWorkspaceArtifacts': {
      deleteWorkspaceArtifactsPersisted: () => ({ ok: true }),
      listWorkspaceArtifacts: () => [],
      saveWorkspaceArtifactPersisted: () => ({ ok: true, artifact: {} }),
    },
    '../stores/canvasStore': { useCanvasStore: { getState: () => ({}) } },
    './videoWorkspacePersistence.ts': { matchesVideoProjectArtifact: () => false },
    './heavyWorkspace': { isHeavyWorkspaceRuntime: () => false, toHeavyWorkspacePath: (path: string) => path },
    './generationSourceReferences.ts': sourceReferenceHelpers,
  };
  vm.runInNewContext(compiledHandoff.outputText, {
    exports,
    require: (specifier: string) => {
      if (!(specifier in modules)) throw new Error(`unexpected workspaceHandoff import: ${specifier}`);
      return modules[specifier];
    },
    URLSearchParams,
  });
  return exports as HandoffModule;
})();

const source = (overrides: Partial<Parameters<typeof handoff.buildGenerationIntentHref>[0]> = {}) => ({
  feature: 'design-gacha',
  prompt: '同じ服を参照して新しい表現にする',
  sourceWorkspace: 'design-production' as const,
  workflowVersion: 'design-production-brief-local-v1',
  sourceLabel: 'デザインワークスペース',
  sourceResumePath: '/designProduction',
  sourceMode: 'local-workflow-intake' as const,
  ...overrides,
});

const references = (count: number): SourceReference[] => Array.from({ length: count }, (_, index) => ({
  sourceImageId: `img-${String(index + 1).padStart(3, '0')}-7d4f-4c5a-9a31-${String(index + 1).padStart(12, '0')}`,
  sourceStoragePath: `design-gacha/references/参考素材-${index + 1}.jpg`,
  sourceFileName: `春夏の素材-${index + 1}.jpg`,
}));

const queryOf = (href: string) => new URLSearchParams(href.slice(href.indexOf('?') + 1));
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test('helper round-trips ordered five-reference manifests and preserves unicode filenames', () => {
  const ordered = references(5);
  const encoded = sourceReferenceHelpers.encodeGenerationSourceReferences(ordered);
  const decoded = sourceReferenceHelpers.decodeGenerationSourceReferences(encoded);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.references, ordered);
  assert.equal(decoded.references[0].sourceFileName, '春夏の素材-1.jpg');

  const afterDeletion = ordered.filter((_, index) => index !== 2);
  const reindexed = sourceReferenceHelpers.decodeGenerationSourceReferences(
    sourceReferenceHelpers.encodeGenerationSourceReferences(afterDeletion),
  );
  assert.equal(reindexed.ok, true);
  if (reindexed.ok) assert.deepEqual(reindexed.references, [ordered[0], ordered[1], ordered[3], ordered[4]]);
});

test('actual generation href builder and source hydrator preserve manifest order and first-reference aliases', () => {
  const expected = references(5);
  const href = handoff.buildGenerationIntentHref(source({ sourceReferences: expected }));
  const params = queryOf(href);
  assert.equal(params.getAll('sourceReferences').length, 1);
  const hydrated = handoff.hydrateGenerationIntentSource(params);
  assert.ok(hydrated);
  assert.deepEqual(plain(hydrated?.sourceReferences), expected);
  assert.equal(hydrated?.sourceImageId, expected[0].sourceImageId);
  assert.equal(hydrated?.sourceStoragePath, expected[0].sourceStoragePath);
  assert.equal(hydrated?.sourceFileName, expected[0].sourceFileName);
  assert.equal(hydrated?.sourceResumePath, '/designProduction');
});

test('sixteen representative opaque image identities are measured in the actual generation href', (context) => {
  const href = handoff.buildGenerationIntentHref(source({ sourceReferences: references(16) }));
  const query = queryOf(href);
  const hydrated = handoff.hydrateGenerationIntentSource(query);
  assert.equal(hydrated?.sourceReferences?.length, 16);
  assert.ok(href.startsWith('/generate?'));
  context.diagnostic(`16-reference /generate href measured at ${href.length} characters (UUID-like IDs, canonical paths, unicode filenames).`);
});

test('legacy scalar handoff stays compatible and helper can view it as a singleton', () => {
  const legacyReference: SourceReference = {
    sourceImageId: 'gallery-image-42',
    sourceStoragePath: 'tenant/gallery/image-42.png',
    sourceFileName: '試着画像.png',
  };
  const singleton = sourceReferenceHelpers.decodeGenerationSourceReferences(null, legacyReference);
  assert.equal(singleton.ok, true);
  if (singleton.ok) assert.deepEqual(singleton.references, [legacyReference]);

  const href = handoff.buildGenerationIntentHref(source(legacyReference));
  const hydrated = handoff.hydrateGenerationIntentSource(queryOf(href));
  assert.deepEqual(plain(hydrated), {
    sourceWorkspace: 'design-production',
    workflowVersion: 'design-production-brief-local-v1',
    sourceLabel: 'デザインワークスペース',
    sourceResumePath: '/designProduction',
    sourceMode: 'local-workflow-intake',
    sourceImageId: legacyReference.sourceImageId,
    sourceStoragePath: legacyReference.sourceStoragePath,
    sourceFileName: legacyReference.sourceFileName,
  });
  assert.equal(Object.hasOwn(hydrated ?? {}, 'sourceReferences'), false, 'legacy hydration shape remains unchanged');
});

test('new manifest invalid count, malformed data, aliases, and duplicate query values fail closed', () => {
  assert.equal(sourceReferenceHelpers.normalizeGenerationSourceReferences([]).ok, false);
  assert.equal(sourceReferenceHelpers.normalizeGenerationSourceReferences(references(17)).ok, false);
  assert.throws(() => sourceReferenceHelpers.encodeGenerationSourceReferences([]), /invalid_generation_source_references/);
  assert.throws(() => handoff.buildGenerationIntentHref(source({ sourceReferences: references(17) })), /invalid_generation_source_references/);

  for (const manifest of ['', 'not-json', '{}', '[]', JSON.stringify(references(17))]) {
    const params = queryOf(handoff.buildGenerationIntentHref(source()));
    params.set('sourceReferences', manifest);
    assert.equal(handoff.hydrateGenerationIntentSource(params), null, `manifest should fail closed: ${manifest.slice(0, 30)}`);
  }

  const mismatchedAlias = queryOf(handoff.buildGenerationIntentHref(source({ sourceReferences: references(2) })));
  mismatchedAlias.set('sourceImageId', 'some-other-image');
  assert.equal(handoff.hydrateGenerationIntentSource(mismatchedAlias), null);

  const duplicateManifest = queryOf(handoff.buildGenerationIntentHref(source({ sourceReferences: references(2) })));
  duplicateManifest.append('sourceReferences', JSON.stringify(references(2)));
  assert.equal(handoff.hydrateGenerationIntentSource(duplicateManifest), null);
});

test('manifest entries require durable identity and reject URLs, signed data, traversal, and non-contract fields', () => {
  const invalidReferences: unknown[] = [
    [{ sourceFileName: 'identity-missing.jpg' }],
    [{ sourceImageId: 'https://images.example/id' }],
    [{ sourceImageId: 'data:image/png;base64,AAAA' }],
    [{ sourceImageId: 'blob:opaque-id' }],
    [{ sourceImageId: 'safe-id', sourceStoragePath: 'tenant/../other/image.jpg' }],
    [{ sourceImageId: 'safe-id', sourceStoragePath: 'https://example.com/image.jpg' }],
    [{ sourceImageId: 'safe-id', sourceStoragePath: 'tenant/image.jpg?X-Amz-Signature=secret' }],
    [{ sourceImageId: 'safe-id', sourceFileName: 'https://example.com/image.jpg' }],
    [{ sourceImageId: 'safe-id', sourceFileName: '../image.jpg' }],
    [{ sourceImageId: 'safe-id', dataUrl: 'data:image/png;base64,AAAA' }],
  ];
  for (const invalidReference of invalidReferences) {
    assert.equal(sourceReferenceHelpers.normalizeGenerationSourceReferences(invalidReference).ok, false);
  }
  assert.equal(sourceReferenceHelpers.decodeGenerationSourceReferences('null').ok, false);
});

test('existing workspace, workflow-version, label, and resume-path guards remain active for manifests', () => {
  const href = handoff.buildGenerationIntentHref(source({ sourceReferences: references(2) }));
  for (const [key, value] of [
    ['sourceWorkspace', 'unknown'],
    ['workflowVersion', 'unapproved-version'],
    ['sourceLabel', 'wrong label'],
    ['sourceResumePath', '/wrong-path'],
  ] as const) {
    const params = queryOf(href);
    params.set(key, value);
    assert.equal(handoff.hydrateGenerationIntentSource(params), null, `${key} must remain guarded`);
  }
});
