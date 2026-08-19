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
  assert.match(page, /view: restoreCanvasView\(document\.snapshot\)/);
  assert.match(page, /view: restoreCanvasView\(readback\.snapshot\)/);
});

test('Canvas retains the server identity before readback and exposes remote recovery', () => {
  const writeIndex = page.indexOf('const document = remoteDocumentIdRef.current');
  const retainIndex = page.indexOf('remoteDocumentIdRef.current = document.id', writeIndex);
  const verifyIndex = page.indexOf("setCanvasPersistenceStatus('verifying')", retainIndex);
  assert.ok(writeIndex >= 0);
  assert.ok(retainIndex > writeIndex);
  assert.ok(verifyIndex > retainIndex);
  assert.match(page, /const handleReloadRemote = async \(\)/);
  assert.match(page, /data-testid="canvas-reload-remote"/);
  assert.match(page, /getCanvasDocument\(documentId, brandId\)/);
  assert.match(page, /最新のCanvas状態を再読み込みしました/);
});
