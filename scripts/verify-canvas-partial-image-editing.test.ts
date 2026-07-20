import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { hasEditableMaskPixels } from '../src/components/canvas/inpaintMask.ts';
import { buildCanvasGenerationState } from '../src/features/canvasGenerationState.ts';
import type { CanvasObject } from '../src/stores/canvasStore.ts';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('canvas image actions route every visible prompt-edit and variation action', async () => {
  const source = await read('../src/pages/CanvasEditorPage.tsx');
  assert.match(source, /case 'variations':\s*case 'generateVariations':\s*case 'derive':/);
  assert.match(source, /action === 'edit' \|\| action === 'editWithPrompt' \|\| action === 'edit-prompt'/);
  assert.match(source, /setEditingImage\(obj\.src\)[\s\S]*setShowEditModal\(true\)[\s\S]*const imageSrc = await resolveCanvasObjectImageUrl\(obj\)/);
  assert.match(source, /const editSource = sourceObject\s*\? await resolveCanvasObjectImageUrl\(sourceObject\)\s*: await resolveGeneratedImageUrl\(editingImage\)/);
  assert.match(source, /editImageWithPrompt\(editSource, params\.prompt/);
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
  assert.match(source, /backendJobId: result\.jobId \?\? result\.images\?\.\[0\]\?\.jobId \?\? null/);
  assert.match(source, /backendImageId: result\.imageId \?\? result\.images\?\.\[0\]\?\.imageId \?\? null/);
  assert.match(source, /backendStoragePath: result\.storagePath \?\? result\.images\?\.\[0\]\?\.storagePath \?\? null/);
  assert.match(source, /addImageToCanvasSafely\(result\.imageUrl, '部分編集結果',[\s\S]*editingObjectId \?\? undefined\)/);
});

test('canvas exposes deterministic generation provenance without counting source images as results', async () => {
  const source = await read('../src/pages/CanvasEditorPage.tsx');
  assert.match(source, /data-testid="canvas-generation-state"/);
  assert.match(source, /buildCanvasGenerationState\(objects\)/);
  assert.match(source, /data-partial-edit-result-count=\{canvasGenerationState\.partialEditResultCount\}/);
  assert.match(source, /data-derived-result-count=\{canvasGenerationState\.derivedResultCount\}/);

  const object = (input: Partial<CanvasObject> & Pick<CanvasObject, 'id'>): CanvasObject => ({
    type: 'image', x: 0, y: 0, width: 10, height: 10, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, locked: false, visible: true, zIndex: 0, ...input,
  });
  const proof = buildCanvasGenerationState([
    object({ id: 'source', metadata: { feature: 'gallery-import', generation: 0, source: 'gallery-selector' } as CanvasObject['metadata'] }),
    object({
      id: 'result',
      derivedFrom: 'source',
      metadata: {
        feature: 'inpaint', generation: 1, maskApplied: true,
        parameters: {
          backendJobId: 'private-job', backendImageId: 'private-image',
          backendStoragePath: 'private/brand/path.png', backendProvider: 'openai', persistenceStatus: 'completed',
        },
      } as CanvasObject['metadata'],
    }),
    object({ id: 'derived', derivedFrom: 'source', metadata: { feature: 'upscale', generation: 2 } }),
  ]);
  assert.deepEqual(
    { imageCount: proof.imageCount, sourceImageCount: proof.sourceImageCount, gallerySourceCount: proof.gallerySourceCount,
      derivedResultCount: proof.derivedResultCount, partialEditResultCount: proof.partialEditResultCount, maxGeneration: proof.maxGeneration },
    { imageCount: 3, sourceImageCount: 1, gallerySourceCount: 1, derivedResultCount: 2, partialEditResultCount: 1, maxGeneration: 2 },
  );
  const serialized = JSON.stringify(proof);
  assert.doesNotMatch(serialized, /private-job|private-image|private\/brand\/path/);
  assert.equal(proof.objects.find((item) => item.objectId === 'result')?.hasBackendStoragePath, true);
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
