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
  assert.match(store, /version: 2/);
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
