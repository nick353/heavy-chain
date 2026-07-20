import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { hasEditableMaskPixels } from '../src/components/canvas/inpaintMask.ts';
import { buildCanvasGenerationState } from '../src/features/canvasGenerationState.ts';
import {
  addCanvasImageEditCandidatesSequentially,
  buildCanvasImageEditBatchProof,
  normalizeCanvasImageEditCandidates,
  settleCanvasImageEditCandidatesSequentially,
} from '../src/lib/canvasImageEditResults.ts';
import type { ImageEditResult } from '../src/lib/imageApi.ts';
import type { CanvasObject } from '../src/stores/canvasStore.ts';
import { resolveImageEditCleanupStatus } from '../supabase/functions/_shared/openaiImage.ts';

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
  assert.match(edge, /count: maskDataUrl \? 4 : 1/);
  assert.match(openAi, /formData\.set\('n', String\(requestedCount\)\)/);
  assert.equal((edge.match(/await editOpenAiImage\(/g) ?? []).length, 1);
});

test('partial edit result remains a parent-linked derived canvas object', async () => {
  const source = await read('../src/pages/CanvasEditorPage.tsx');
  assert.match(source, /if \(action === 'inpaint'\)/);
  assert.match(source, /feature: 'inpaint'/);
  assert.match(source, /maskApplied: true/);
  assert.match(source, /normalizeCanvasImageEditCandidates\(result\)/);
  assert.match(source, /settleCanvasImageEditCandidatesSequentially\(candidates/);
  assert.match(source, /backendJobId: candidate\.jobId/);
  assert.match(source, /backendImageId: candidate\.imageId/);
  assert.match(source, /backendStoragePath: candidate\.storagePath/);
  assert.match(source, /candidateIndex: candidate\.candidateIndex/);
  assert.match(source, /await addImageToCanvas\(candidate\.imageUrl,[\s\S]*editingObjectId \?\? undefined/);
  assert.match(source, /candidates: placement\.placed\.map\(\(\{ candidate \}\) => candidate\)/);
  assert.match(source, /updateObject\(objectId,[\s\S]*batchProof/);
});

test('multi-inpaint normalizes only unique persisted candidates and preserves backend indices', () => {
  const result: ImageEditResult = {
    success: true,
    jobId: 'job-1',
    imageId: 'image-0',
    imageUrl: 'https://example.test/0.png',
    storagePath: 'brand/0.png',
    persistenceStatus: 'partial',
    images: [
      { imageUrl: 'https://example.test/0.png', jobId: 'job-1', imageId: 'image-0', storagePath: 'brand/0.png', persistenceStatus: 'completed', candidateIndex: 0 },
      { imageUrl: 'https://example.test/1.png', jobId: 'job-1', imageId: 'image-1', storagePath: 'brand/1.png', persistenceStatus: 'completed', candidateIndex: 2 },
      { imageUrl: 'https://example.test/duplicate.png', jobId: 'job-1', imageId: 'image-1', storagePath: 'brand/duplicate.png', persistenceStatus: 'completed', candidateIndex: 3 },
      { imageUrl: '', jobId: 'job-1', imageId: 'image-4', storagePath: 'brand/4.png', persistenceStatus: 'completed', candidateIndex: 4 },
    ],
  };
  const candidates = normalizeCanvasImageEditCandidates(result);
  assert.deepEqual(candidates.map(({ imageId, candidateIndex }) => ({ imageId, candidateIndex })), [
    { imageId: 'image-0', candidateIndex: 0 },
    { imageId: 'image-1', candidateIndex: 2 },
  ]);
});

test('multi-inpaint proof is deterministic and candidates are placed sequentially', async () => {
  const candidates = normalizeCanvasImageEditCandidates({
    success: true,
    images: [
      { imageUrl: 'https://example.test/a.png', jobId: 'job-1', imageId: 'image-a', storagePath: 'brand/a.png', persistenceStatus: 'completed', candidateIndex: 1 },
      { imageUrl: 'https://example.test/b.png', jobId: 'job-1', imageId: 'image-b', storagePath: 'brand/b.png', persistenceStatus: 'completed', candidateIndex: 3 },
    ],
  });
  const proof = buildCanvasImageEditBatchProof({ batchId: 'job-1', parentObjectId: 'source', preResultCount: 0, candidates });
  assert.deepEqual(proof, {
    schema: 'heavy-chain.canvas-image-edit-batch.v1', batchId: 'job-1', parentObjectId: 'source',
    preZero: true, preResultCount: 0, postResultCount: 2, postDelta: 2, indices: [1, 3],
    edges: [
      { from: 'source', to: 'image-a', candidateIndex: 1 },
      { from: 'source', to: 'image-b', candidateIndex: 3 },
    ],
  });
  const order: string[] = [];
  const added = await addCanvasImageEditCandidatesSequentially(candidates, async (candidate, placementIndex) => {
    order.push(`start:${candidate.imageId}:${placementIndex}`);
    await Promise.resolve();
    order.push(`end:${candidate.imageId}:${placementIndex}`);
    return candidate.imageId;
  });
  assert.deepEqual(added, ['image-a', 'image-b']);
  assert.deepEqual(order, ['start:image-a:0', 'end:image-a:0', 'start:image-b:1', 'end:image-b:1']);
});

test('partial Canvas placement records proof for actual successes and keeps trying later candidates', async () => {
  const candidates = normalizeCanvasImageEditCandidates({
    success: true,
    images: [
      { imageUrl: 'https://example.test/a.png', jobId: 'job-1', imageId: 'image-a', storagePath: 'brand/a.png', persistenceStatus: 'completed', candidateIndex: 0 },
      { imageUrl: 'https://example.test/b.png', jobId: 'job-1', imageId: 'image-b', storagePath: 'brand/b.png', persistenceStatus: 'completed', candidateIndex: 1 },
      { imageUrl: 'https://example.test/c.png', jobId: 'job-1', imageId: 'image-c', storagePath: 'brand/c.png', persistenceStatus: 'completed', candidateIndex: 2 },
    ],
  });
  const attempted: number[] = [];
  const placement = await settleCanvasImageEditCandidatesSequentially(candidates, async (candidate) => {
    attempted.push(candidate.candidateIndex);
    if (candidate.candidateIndex === 1) throw new Error('candidate-load-failed');
    return `canvas-${candidate.imageId}`;
  });
  const proof = buildCanvasImageEditBatchProof({
    batchId: 'job-1', parentObjectId: 'source', preResultCount: 0,
    candidates: placement.placed.map(({ candidate }) => candidate),
  });
  assert.deepEqual(attempted, [0, 1, 2]);
  assert.deepEqual(placement.placed.map(({ value }) => value), ['canvas-image-a', 'canvas-image-c']);
  assert.deepEqual(placement.failed.map(({ candidate }) => candidate.imageId), ['image-b']);
  assert.deepEqual(
    { preZero: proof.preZero, postResultCount: proof.postResultCount, postDelta: proof.postDelta, indices: proof.indices, edges: proof.edges },
    {
      preZero: true, postResultCount: 2, postDelta: 2, indices: [0, 2],
      edges: [
        { from: 'source', to: 'image-a', candidateIndex: 0 },
        { from: 'source', to: 'image-c', candidateIndex: 2 },
      ],
    },
  );
});

test('provider and all-upload zero-persist failures report no cleanup when no cleanup target existed', async () => {
  assert.equal(resolveImageEditCleanupStatus(false, []), 'none');
  assert.equal(resolveImageEditCleanupStatus(true, []), 'completed');
  assert.equal(resolveImageEditCleanupStatus(true, ['storage-remove-failed']), 'failed');
  const edge = await read('../supabase/functions/edit-image/index.ts');
  assert.match(edge, /let cleanupAttempted = false/);
  assert.match(edge, /if \(telemetryClient && insertedImageIds\.length\) \{\s*cleanupAttempted = true/);
  assert.match(edge, /if \(telemetryClient && uploadedStoragePaths\.length\) \{\s*cleanupAttempted = true/);
  assert.match(edge, /cleanupStatus: resolveImageEditCleanupStatus\(cleanupAttempted, cleanupErrors\)/);
});

test('edit-image persists each candidate under one job and keeps first-candidate response fields', async () => {
  const edge = await read('../supabase/functions/edit-image/index.ts');
  assert.match(edge, /const persistedImages:/);
  assert.match(edge, /for \(const \[fallbackIndex, candidate\] of generatedCandidates\.entries\(\)\)/);
  assert.match(edge, /job_id: job\.id/);
  assert.match(edge, /batchId: job\.id/);
  assert.match(edge, /persistenceStatus === 'partial'/);
  assert.match(edge, /edit_image_zero_persisted_candidates/);
  assert.match(edge, /imageId: firstImage\.imageId/);
  assert.match(edge, /storagePath: firstImage\.storagePath/);
  assert.match(edge, /imageUrl: firstImage\.imageUrl/);
  assert.match(edge, /\.remove\(uploadedStoragePaths\)/);
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
