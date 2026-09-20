import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const helperPath = new URL('../src/lib/canvasLocalAssets.ts', import.meta.url);
const storePath = new URL('../src/stores/canvasStore.ts', import.meta.url);
const pagePath = new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url);
const canvasPath = new URL('../src/components/canvas/InfiniteCanvas.tsx', import.meta.url);

const [helper, store, page, canvas] = await Promise.all([
  readFile(helperPath, 'utf8'),
  readFile(storePath, 'utf8'),
  readFile(pagePath, 'utf8'),
  readFile(canvasPath, 'utf8'),
]);

test('local Canvas assets use an IndexedDB reference instead of persisting image bytes', () => {
  assert.match(helper, /heavy-chain-canvas-assets/);
  assert.match(helper, /createObjectStore\(STORE_NAME/);
  assert.match(helper, /putLocalCanvasAsset/);
  assert.match(helper, /URL\.createObjectURL\(blob\)/);
  assert.match(helper, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(helper, /canvas_local_asset_write_readback_failed/);
  assert.match(helper, /hasLocalCanvasAsset/);
  assert.match(store, /buildLocalCanvasAssetReference\(revision\)/);
  assert.match(store, /hasLocalCanvasAsset\(revision\)/);
  assert.match(store, /version: 3/);
  assert.doesNotMatch(store, /src: dataUrl/);
});

test('persistent local uploads retain their revision reference without synchronous Set membership', () => {
  const start = store.indexOf('const sanitizePersistedObject =');
  const end = store.indexOf('const sanitizePersistedObjects =', start);
  assert.ok(start >= 0, 'Canvas object sanitizer must exist');
  assert.ok(end > start, 'Canvas object sanitizer must precede the object collection sanitizer');
  const sanitizer = store.slice(start, end);

  assert.match(sanitizer, /const sourceRevision = obj\.metadata\?\.sourceRevision\?\.revision;/);
  assert.match(sanitizer, /obj\.metadata\?\.sourceIdentity\?\.kind === 'local-upload'/);
  assert.match(sanitizer, /obj\.metadata\?\.persistenceStatus === 'persistent'/);
  assert.match(sanitizer, /typeof sourceRevision === 'string'/);
  assert.match(sanitizer, /sourceRevision\.length > 0/);
  assert.match(sanitizer, /hasPersistentLocalUploadRevision \|\| \(revision && hasLocalCanvasAsset\(revision\)\)/);
  assert.match(sanitizer, /hasPersistentLocalUploadRevision \|\|[\s\S]*?\? \{ \.\.\.obj, src: buildLocalCanvasAssetReference\(revision\) \}/);
});

test('session-only uploads, missing revisions, and non-local images keep fail-closed behavior', () => {
  const start = store.indexOf('const sanitizePersistedObject =');
  const end = store.indexOf('const sanitizePersistedObjects =', start);
  const sanitizer = store.slice(start, end);

  assert.doesNotMatch(sanitizer, /persistenceStatus === 'session-only'.*buildLocalCanvasAssetReference/s);
  assert.match(sanitizer, /hasPersistentLocalUploadRevision \|\| \(revision && hasLocalCanvasAsset\(revision\)\)/);
  assert.match(sanitizer, /: \{ \.\.\.obj, src: '' \};/);
  assert.match(sanitizer, /if \(obj\.type === 'image' && typeof obj\.src === 'string' && obj\.src\.startsWith\('data:'\)\)/);
  assert.match(sanitizer, /if \(galleryStoragePath\)/);
});

test('upload writes the source blob before adding the active data URL object', () => {
  assert.match(page, /await putLocalCanvasAsset\(\s*sourceMetadata\.sourceRevision\.revision/);
  assert.match(page, /persistenceStatus = 'session-only'/);
  assert.match(page, /data-persistence-status=\{localUploadState\.persistenceStatus\}/);
  assert.match(page, /resolveLocalCanvasAsset\(source\)/);
  assert.match(canvas, /resolveLocalCanvasAsset\(source\)/);
});

test('missing IndexedDB remains an explicit session-only fallback', () => {
  assert.match(helper, /canvas_local_asset_indexeddb_unavailable/);
  assert.match(page, /keeping this upload session-scoped/);
});

test('saving a Canvas writes and verifies the server snapshot before route update', () => {
  const start = page.indexOf('const handleSave = async () =>');
  const end = page.indexOf('const handleObjectSelect', start);
  assert.ok(start >= 0, 'canvas save handler must exist');
  assert.ok(end > start, 'canvas object handlers must follow the save handler');
  const saveHandler = page.slice(start, end);
  assert.match(saveHandler, /if \(!currentBrand\?\.id \|\| !user\?\.id\)/);
  assert.match(saveHandler, /createCanvasDocument\(\{ brandId, title, snapshot \}\)/);
  assert.match(saveHandler, /getCanvasDocument\(document\.id, brandId\)/);
  assert.match(saveHandler, /hydrateProject\(/);
  assert.match(saveHandler, /setCanvasPersistenceStatus\('saved'\)/);
  assert.doesNotMatch(saveHandler, /createProject\(currentProjectName/);
});

test('new project creation carries current canvas objects into the routed project', () => {
  assert.match(store, /createProject: \(name: string, brandId\?: string, initialObjects\?: CanvasObject\[\]\) => string/);
  assert.match(store, /createProject: \(name, brandId, initialObjects = \[\]\) =>/);
  assert.match(store, /objects: initialObjects,/);
  assert.match(store, /history: \[initialObjects\]/);
  assert.match(store, /currentProjectName: name,\n\s+objects: initialObjects,/);
});

test('adding an object keeps the routed project snapshot in sync before navigation', () => {
  assert.match(store, /const nextObjects = \[\.\.\.objects, newObject\];/);
  assert.match(store, /projects: state\.currentProjectId/);
  assert.match(store, /objects: nextObjects,/);
  assert.match(store, /updatedAt: new Date\(\)\.toISOString\(\)/);
});

test('routed Canvas reload keeps the active working set when the persisted index is lightweight', () => {
  assert.match(store, /const \{ projects, currentProjectId, objects: activeObjects \} = get\(\);/);
  assert.match(store, /currentProjectId === projectId && activeObjects\.length > 0/);
  assert.match(store, /objects: projectObjects,/);
  assert.match(store, /history: \[projectObjects\]/);
});

test('provider Canvas handoff localizes data-only results before persistence', async () => {
  const materialPage = await readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(materialPage, /prepareProviderCanvasSource/);
  assert.match(materialPage, /buildLocalUploadSourceMetadata/);
  assert.match(materialPage, /putLocalCanvasAsset/);
  assert.match(materialPage, /buildLocalCanvasAssetReference/);
  assert.match(materialPage, /canvas_provider_result_fetch_failed/);
  assert.match(materialPage, /src: canvasSource,/);
});
