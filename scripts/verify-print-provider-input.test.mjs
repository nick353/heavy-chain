import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', configFile: false, envFile: false,
  logLevel: 'silent', server: { middlewareMode: true } });
after(() => vite.close());
const input = await vite.ssrLoadModule('/src/lib/printProviderInput.ts');
const mask = await vite.ssrLoadModule('/src/features/lightchain/providerMask.ts');
const image = await vite.ssrLoadModule('/src/lib/cloudflareImageAI.ts');
const sourceSize = { width: 400, height: 500 };
const crop = { sourceSize, sourceFrameSize: sourceSize, outputSize: { width: 200, height: 250 },
  bounds: { x: 100, y: 150, width: 200, height: 250 } };
const snapshot = { stageSize: { width: 720, height: 900 }, garment: {
  sourceSize: crop.outputSize, containBounds: { x: 0, y: 0, width: 720, height: 900 } } };

test('cropped garment layout is placed back into the original photograph, not the whole output frame', () => {
  assert.deepEqual(mask.resolveGarmentCutoutSourcePlacement(sourceSize, crop), crop.bounds);
  const value = input.resolvePrintProviderPlacement(snapshot, sourceSize, crop);
  assert.deepEqual(value.sourceFramePlacement, { x: 0, y: 0, width: 720, height: 900 });
  assert.deepEqual(value.artworkPlacement, { x: 180, y: 270, width: 360, height: 450 });
  assert.deepEqual(value.stageBounds, snapshot.garment.containBounds);
});

test('full-frame cutouts ignore their content bounding box and share the exact mask mapping', () => {
  const full = { ...crop, outputSize: sourceSize };
  assert.deepEqual(mask.resolveGarmentCutoutSourcePlacement(sourceSize, full), { x: 0, y: 0, ...sourceSize });
  const view = { ...snapshot, garment: { ...snapshot.garment, sourceSize } };
  assert.deepEqual(input.resolvePrintProviderPlacement(view, sourceSize, full).artworkPlacement,
    { x: 0, y: 0, width: 720, height: 900 });
});

test('selected two-times output scales the same crop coordinates without changing framing', () => {
  const larger = { stageSize: { width: 1440, height: 1800 }, garment: {
    ...snapshot.garment, containBounds: { x: 0, y: 0, width: 1440, height: 1800 } } };
  assert.deepEqual(input.resolvePrintProviderPlacement(larger, sourceSize, crop).artworkPlacement,
    { x: 360, y: 540, width: 720, height: 900 });
  const wide = { ...crop, sourceFrameSize: { width: 1000, height: 500 },
    bounds: { x: 400, y: 150, width: 200, height: 250 } };
  const value = input.resolvePrintProviderPlacement(snapshot, { width: 1000, height: 500 }, wide);
  assert.deepEqual(value.sourceFramePlacement, { x: 0, y: 270, width: 720, height: 360 });
  assert.deepEqual(value.artworkPlacement, { x: 288, y: 378, width: 144, height: 180 });
});

test('invalid frames, wrong cutout metadata and out-of-bounds crops fail before allocating a canvas', () => {
  assert.throws(() => input.resolvePrintProviderPlacement({ ...snapshot, stageSize: { width: 4097, height: 900 } }, sourceSize, crop), /frame_dimensions/);
  assert.throws(() => input.resolvePrintProviderPlacement(snapshot, { width: 0, height: 500 }, crop), /frame_dimensions/);
  assert.throws(() => input.resolvePrintProviderPlacement(snapshot, sourceSize, { ...crop, outputSize: { width: 1, height: 1 } }), /cutout_dimensions/);
  assert.throws(() => input.resolvePrintProviderPlacement(snapshot, sourceSize, { ...crop, bounds: { ...crop.bounds, x: 300 } }), /bounds_invalid/);
  assert.throws(() => input.resolvePrintProviderPlacement({ ...snapshot, garment: { ...snapshot.garment,
    containBounds: { x: NaN, y: 0, width: 1, height: 1 } } }, sourceSize, crop), /stage_bounds/);
});

test('print edit footprint keeps partial artwork opacity in the source rather than fading it twice', () => {
  const rgba = new Uint8ClampedArray([4, 5, 6, 0, 20, 30, 40, 1, 10, 20, 30, 128, 3, 4, 5, 255]);
  const result = input.printArtworkFootprintMask(rgba);
  assert.deepEqual([...result.rgba], [255,255,255,255, 255,255,255,0, 255,255,255,0, 255,255,255,0]);
  assert.equal(result.coveragePercent, 75);
  assert.deepEqual([...rgba], [4,5,6,0,20,30,40,1,10,20,30,128,3,4,5,255]);
  assert.throws(() => input.printArtworkFootprintMask(new Uint8ClampedArray(4)), /配置・透明度/);
  assert.throws(() => input.printArtworkFootprintMask(new Uint8ClampedArray(3)), /pixels_invalid/);
});

test('prompt explicitly uses precomposed artwork, original texture and all six designs without claiming semantic validation', () => {
  const prompt = input.printProviderPrompt('Apply the supplied print.', 6);
  for (const text of ['ALL 6', 'Image 0', 'Image 1', 'overlap order', 'opacity', 'not a previous AI result', 'visual review']) {
    assert(prompt.includes(text), text);
  }
  assert(input.CLOUDFLARE_PRINT_INPUT_NOTICE.includes('合成は生成結果ではありません'));
});

test('durable identity binds actual layout bytes and order, while descriptive URL rotation is immaterial', async () => {
  const body = { brandId: 'brand', imageUrls: ['data:actual-layout', 'data:source', 'data:guide'],
    compositionPreview: { printProviderInput: { orderedLayers: [{ id: 'one' }, { id: 'two' }],
      compositionSha256: 'a'.repeat(64), semanticQuality: 'unverified' }, source: 'https://media.test/a?signed=old' } };
  const key = value => image.durableImageRecoveryKey('https://api.test', 'user', 'edit-image', value);
  assert.equal(await key(body), await key({ ...body, compositionPreview: { ...body.compositionPreview, source: 'https://media.test/a?signed=new' } }));
  assert.notEqual(await key(body), await key({ ...body, imageUrls: ['data:different-layout', ...body.imageUrls.slice(1)] }));
  assert.notEqual(await key(body), await key({ ...body, compositionPreview: { ...body.compositionPreview,
    printProviderInput: { ...body.compositionPreview.printProviderInput, orderedLayers: [{ id: 'two' }, { id: 'one' }] } } }));
});

test('actual page passes the composed primary, original reference, footprint and immutable metadata to the existing provider/save flow', () => {
  const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
  assert.match(page, /if \(!cloudflareDataPlane\)[\s\S]*?if \(isPrinting\)[\s\S]*?buildPrintRequestSnapshot\([\s\S]*?renderPrintProviderInput\(/);
  assert.match(page, /printProviderInput\?\.imageUrl \?\? printGarment!\.url/);
  assert.match(page, /referenceImageUrls: printProviderInput\?\.referenceImageUrls \?\? printReferenceUrls/);
  assert.match(page, /printProviderInput\?\.providerMask \?\? await withTimeout/);
  assert.match(page, /printProviderInput: printProviderInput\.metadata/);
  assert.match(page, /generationInputSignature: requestSignature/);
  assert.match(page, /const allPrintReferenceUrls = printDesigns\.map\(\(design\) => design\.url\)/);
  assert.match(page, /if \(nextImages\.length > 6\)/);
  assert.match(page, /reuseCanonicalRemoteArtifact: Boolean\(cloudflareDataPlane && providerResult\.protectedRegionComposited\)/);
  const renderer = fs.readFileSync('src/lib/workspaceMaterialReferences.ts', 'utf8');
  assert.match(renderer, /renderPrintRequestComposition[\s\S]*?await renderPrintRequestArtworkCanvas\(snapshot\)/);
});

test('ready automatic masks permit placement without claiming explicit user review', () => {
  const stage = fs.readFileSync('src/components/workspace/PrintingCompositionStage.tsx', 'utf8');
  const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
  assert.match(stage, /garmentMaskReviewed = garmentMaskConfirmed/);
  assert.match(stage, /garmentMaskReviewed \? '認識範囲を確認済み' : '認識範囲は未確認です'/);
  assert.match(stage, /const hasConfirmedGarmentMask = hasRenderableGarment && garmentMaskConfirmed/);
  assert.match(page, /garmentMaskConfirmed=\{printGarmentCutoutState === 'done'\}\s+garmentMaskReviewed=\{hasConfirmedPrintGarmentMask\}/);
});
