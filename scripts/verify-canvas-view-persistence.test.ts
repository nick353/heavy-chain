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
