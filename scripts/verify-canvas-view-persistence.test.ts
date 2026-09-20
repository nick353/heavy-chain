import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeCanvasView } from '../src/lib/canvasView.ts';

const page = await readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');

test('Canvas view normalization preserves finite values and clamps zoom', () => {
  assert.deepEqual(normalizeCanvasView(), { zoom: 1, panX: 0, panY: 0 });
  assert.deepEqual(normalizeCanvasView({ zoom: 12, panX: 140, panY: -80 }), { zoom: 5, panX: 140, panY: -80 });
  assert.deepEqual(normalizeCanvasView({ zoom: 0, panX: Number.NaN, panY: Number.POSITIVE_INFINITY }), { zoom: 0.1, panX: 0, panY: 0 });
});

test('remote Canvas load and verified save readback restore the persisted view', () => {
  assert.match(page, /const restoreCanvasView = \(snapshot: unknown\)/);
  assert.match(page, /const restoredView=restoreCanvasView\(document\.snapshot\)/);
  assert.match(page, /view:\s*restoredView/);
  assert.match(page, /const restoredView=restoreCanvasView\(readback\.snapshot\)/);
  assert.match(page, /view:\s*restoredView/);
});

test('saved Canvas dirty tracking includes persisted view changes', () => {
  assert.match(page, /const observedCanvasContentRef = useRef\(\{objects,name:currentProjectName,zoom,panX,panY\}\)/);
  assert.match(page, /observedCanvasContentRef\.current = \{objects,name:currentProjectName,zoom,panX,panY\}/);
  assert.match(page, /previous\.zoom === zoom/);
  assert.match(page, /previous\.panX === panX/);
  assert.match(page, /previous\.panY === panY/);
  assert.match(page, /\[canvasPersistenceStatus, currentProjectName, objects, zoom, panX, panY\]/);
});

test('Canvas retains scoped identity before recoverable save and exposes context-bound remote recovery', () => {
  const saveIndex = page.indexOf('const handleSave = async');
  const draftIndex = page.indexOf('const entry=retainCanvasSaveDraft(scope,documentId',saveIndex);
  const identityIndex = page.indexOf('remoteDocumentIdRef.current=documentId',draftIndex);
  const writeIndex = page.indexOf('document=await saveCanvasDocumentRecoverably',identityIndex);
  const retainIndex = page.indexOf('remoteDocumentIdRef.current = document.id', writeIndex);
  const verifyIndex = page.indexOf("setCanvasPersistenceStatus('verifying')", retainIndex);
  assert.ok(saveIndex >= 0);
  assert.ok(draftIndex > saveIndex);
  assert.ok(identityIndex > draftIndex);
  assert.ok(writeIndex > identityIndex);
  assert.ok(retainIndex > writeIndex);
  assert.ok(verifyIndex > retainIndex);
  assert.match(page, /const handleReloadRemote = async \(\)/);
  assert.match(page, /data-testid="canvas-reload-remote"/);
  assert.match(page, /getCanvasDocument\(documentId, brandId,\s*\{userId:user\.id,assertContext\}\)/);
  assert.match(page, /最新のCanvas状態を再読み込みしました/);
});

test('old local bookmarks resolve only the same app-user-brand save identity',()=>{
  assert.match(page,/initialCanvasDocumentId\(scope,projectId\)\.then\(id=>\{\s*assertLocalRoute\(\)/);
  assert.match(page,/if\(readCanvasSaveRecovery\(scope,id\)\)\{navigate\(`\/canvas\/\$\{id\}`/);
  assert.match(page,/localProject\.brandId!==scope\.brandId/);
});
