import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { hasEditableMaskPixels } from '../src/components/canvas/inpaintMask.ts';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('canvas image actions route every visible prompt-edit and variation action', async () => {
  const source = await read('../src/pages/CanvasEditorPage.tsx');
  assert.match(source, /case 'variations':\s*case 'generateVariations':\s*case 'derive':/);
  assert.match(source, /case 'edit':\s*case 'editWithPrompt':\s*case 'edit-prompt':/);
});

test('partial edit UI provides a precise reversible PNG mask', async () => {
  const source = await read('../src/components/canvas/ImageEditModal.tsx');
  assert.match(source, /id: 'inpaint'.*label: '部分編集'/);
  assert.match(source, /data-testid="canvas-inpaint-mask"/);
  assert.match(source, /stroke\.erase \? 'source-over' : 'destination-out'/);
  assert.match(source, /mask\.toDataURL\('image\/png'\)/);
  assert.match(source, /範囲指定を元に戻す/);
  assert.match(source, /範囲指定をやり直す/);
  assert.match(source, /編集する範囲をブラシで塗ってください/);
  assert.match(source, /const completed = await onEdit\(mode,[\s\S]*if \(completed\) onClose\(\)/);
});

test('partial edit mask is sent through the client and edge function without storing raw mask data', async () => {
  const [client, edge, openAi] = await Promise.all([
    read('../src/lib/imageApi.ts'),
    read('../supabase/functions/edit-image/index.ts'),
    read('../supabase/functions/_shared/openaiImage.ts'),
  ]);
  assert.match(client, /maskDataUrl: options\?\.maskDataUrl/);
  assert.match(client, /options\?\.maskDataUrl\s*\? await imageBlobToPngDataUrl\(imageBlob\)/);
  assert.match(edge, /mask: maskDataUrl \? \{ imageUrl: maskDataUrl \} : undefined/);
  assert.match(edge, /Edit mask dimensions must match input image/);
  assert.match(edge, /Edit mask must contain an alpha channel/);
  assert.match(edge, /maskApplied: true/);
  assert.doesNotMatch(edge, /input_params:[\s\S]{0,500}maskDataUrl[,}]/);
  assert.match(openAi, /formData\.append\('mask', mask\.blob, 'mask\.png'\)/);
  assert.match(openAi, /openai_image_edit_mask_not_png/);
});

test('partial edit result remains a parent-linked derived canvas object', async () => {
  const source = await read('../src/pages/CanvasEditorPage.tsx');
  assert.match(source, /if \(action === 'inpaint'\)/);
  assert.match(source, /feature: 'inpaint'/);
  assert.match(source, /maskApplied: true/);
  assert.match(source, /addImageToCanvasSafely\(result\.imageUrl, '部分編集結果',[\s\S]*editingObjectId \?\? undefined\)/);
});

test('a fully erased mask is rejected while a painted selection remains editable', () => {
  const painted = new Uint8ClampedArray([
    0, 0, 0, 255,
    0, 0, 0, 0,
  ]);
  const erasedBackToOpaque = new Uint8ClampedArray([
    0, 0, 0, 255,
    0, 0, 0, 255,
  ]);
  assert.equal(hasEditableMaskPixels(painted), true);
  assert.equal(hasEditableMaskPixels(erasedBackToOpaque), false);
});
