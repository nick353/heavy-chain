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
