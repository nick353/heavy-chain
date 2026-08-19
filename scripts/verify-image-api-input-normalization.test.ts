import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('provider input normalization rasterizes SVG/XML when createImageBitmap cannot decode it', async () => {
  const source = await readFile(new URL('../src/lib/imageApi.ts', import.meta.url), 'utf8');

  assert.match(source, /typeof createImageBitmap === 'function'/);
  assert.match(source, /createImageBitmap\(blob\)/);
  assert.match(source, /URL\.createObjectURL\(blob\)/);
  assert.match(source, /new Image\(\)/);
  assert.match(source, /image_edit_svg_rasterize_failed/);
  assert.match(source, /return await rasterSourceToPngDataUrl\(/);
  assert.match(source, /URL\.revokeObjectURL\(objectUrl\)/);
});
