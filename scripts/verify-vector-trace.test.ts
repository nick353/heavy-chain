import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { initSync, to_svg } from 'vtracer-wasm';
import { finishVectorSvg, flattenToPalette, inspectVectorSvg, traceSide, traceWithVtracer, vtracerConfig, VECTOR_COLOR_CHOICES, type VectorTraceOptions } from '../src/lib/vectorTrace.ts';

// SVGにする (AIグラフィックデザイン) and the ベクター化 tools' SVG download. Before 2026-11-12 the SVG was 640px
// pixel-edge polygons (no curves; stems of a floral print broke into steps), and the result view only sent the image to
// the AI ベクター化 tool. Now VTracer (MIT, WebAssembly) traces curves around each colour of a k-means-flattened image.

const require = createRequire(import.meta.url);
initSync({ module: readFileSync(require.resolve('vtracer-wasm/vtracer.wasm')) });

async function pixelsOf(file: string, side: number) {
  const { data, info } = await sharp(file).resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

test('a floral print becomes curved vector shapes in the chosen number of colours, with no raster image inside', async () => {
  const options: VectorTraceOptions = { colors: 8, detail: 'normal' };
  const pixels = await pixelsOf('public/scene-assets/print2.jpg', traceSide(options));
  const result = traceWithVtracer(to_svg, pixels, options);
  assert.equal(result.width, 736);
  assert.equal(result.traceWidth, 736);
  assert.ok(result.pathCount >= 100, `paths ${result.pathCount}`);
  assert.ok(result.curveCount > result.pathCount * 4, `curves ${result.curveCount}`);
  assert.ok(result.colors.length >= 4 && result.colors.length <= 8, result.colors.join(','));
  const inspected = inspectVectorSvg(result.svg);
  assert.equal(inspected.embeddedImages, 0);
  assert.doesNotMatch(result.svg, /<image|data:image|base64/);
  // A viewBox, so the SVG scales when shown or placed larger instead of being cropped.
  assert.match(result.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 736 923" width="736" height="923">/);
  // Traced smaller than the original, the SVG still opens at the original size (the viewBox keeps the traced units).
  const small = traceWithVtracer(to_svg, await pixelsOf('public/scene-assets/print2.jpg', 400), options, { width: 736, height: 923 });
  assert.match(small.svg, /viewBox="0 0 319 400" width="736" height="923"/);
  assert.deepEqual([small.width, small.height, small.traceWidth, small.traceHeight], [736, 923, 319, 400]);
  // Fewer colours → fewer shapes: the colour choice really reaches the tracer.
  const four = traceWithVtracer(to_svg, pixels, { colors: 4, detail: 'normal' });
  assert.ok(four.colors.length <= 4 && four.pathCount < result.pathCount, `${four.colors.length} colours, ${four.pathCount} paths`);
});

test('every fill is one of the palette colours (VTracer averages specks into near-duplicates otherwise)', () => {
  const raw = '<?xml version="1.0"?>\n<!-- Generator: visioncortex VTracer -->\n<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="10" height="5">\n<path d="M0 0 C1 1 2 2 3 3 Z" fill="#ABB7DE" transform="translate(0,0)"/>\n<path d="M0 0 C1 1 2 2 3 3 Z" fill="#acb8dd" transform="translate(1,1)"/>\n<path d="M0 0 C1 1 2 2 3 3 Z" fill="#687A74" transform="translate(2,2)"/>\n</svg>';
  const svg = finishVectorSvg(raw, 10, 5, [[171, 183, 222], [104, 122, 116], [255, 255, 255]]);
  assert.deepEqual(inspectVectorSvg(svg).colors, ['#abb7de', '#687a74']);
  assert.doesNotMatch(svg, /Generator|<\?xml/);
  assert.match(svg, /viewBox="0 0 10 5"/);
  assert.equal(inspectVectorSvg(svg).pathCount, 3);
});

test('the tracer settings are in vtracer-wasm\'s units, and the detail choices change the traced size and speckle', () => {
  const normal = vtracerConfig({ colors: 8, detail: 'normal' });
  // The wrapper hands the numbers to visioncortex directly: radians, an area, dropped bits (CLI defaults 60°/45°/4px/6 bits).
  assert.ok(normal.cornerThreshold > 1 && normal.cornerThreshold < 1.1);
  assert.ok(normal.spliceThreshold > 0.7 && normal.spliceThreshold < 0.8);
  assert.equal(normal.colorPrecision, 0);
  assert.equal(normal.mode, 'spline');
  assert.equal(normal.hierarchical, 'stacked');
  assert.ok(vtracerConfig({ colors: 8, detail: 'fine' }).filterSpeckle < normal.filterSpeckle);
  assert.ok(vtracerConfig({ colors: 8, detail: 'coarse' }).filterSpeckle > normal.filterSpeckle);
  assert.ok(traceSide({ colors: 8, detail: 'fine' }) > traceSide({ colors: 8, detail: 'normal' }));
  // A 平絵 is traced at 1600px whatever the detail, or its thin strokes break apart.
  assert.equal(traceSide({ colors: 8, detail: 'coarse', lineArt: true }), 1600);
  assert.deepEqual([...VECTOR_COLOR_CHOICES], [4, 6, 8, 12, 16]);
});

test('line art is flattened to one ink colour on paper, so strokes trace whole', () => {
  const width = 100; const height = 100;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 19; y <= 81; y++) for (let x = 19; x <= 81; x++) {
    const edge = Math.min(Math.abs(x - 20), Math.abs(x - 80), Math.abs(y - 20), Math.abs(y - 80));
    if (edge <= 1) data.set(edge === 0 ? [20, 20, 20, 255] : [150, 150, 150, 255], (y * width + x) * 4);
  }
  const { palette } = flattenToPalette({ width, height, data }, { colors: 6, detail: 'normal', lineArt: true });
  assert.equal(palette.length, 2);
  const traced = traceWithVtracer(to_svg, { width, height, data }, { colors: 6, detail: 'normal', lineArt: true });
  assert.equal(traced.colors.length, 2); // paper + ink
  assert.ok(traced.pathCount >= 2 && traced.pathCount <= 4, `paths ${traced.pathCount}`);
});

test('the result view traces in a worker and saves the SVG as vector data (the image download would turn it into a PNG)', () => {
  const view = readFileSync('src/components/lightchain/GraphicResultView.tsx', 'utf8');
  // 4倍に拡大: the zoomed picture neither shrinks nor stretches to the stage's height (it did not grow on production).
  assert.match(view, /zoomed \? 'h-auto max-w-none shrink-0 self-start'/);
  assert.match(view, /style=\{zoomed \? \{ width: `\$\{ready\.result\.traceWidth \* 4\}px` \} : undefined\}/);
  for (const text of ['SVGにする', 'traceImageUrlToVector(candidate.image_url, { colors, detail, lineArt: false })', "saveSvgFile(ready.result.svg, graphicFileName(index, 'ベクター', 'svg'))", '4倍に拡大して見る', 'aria-label="色数"', 'aria-label="細かさ"'])
    assert.ok(view.includes(text), text);
  const client = readFileSync('src/lib/vectorTraceClient.ts', 'utf8');
  assert.match(client, /new Worker\(new URL\('\.\/vectorTrace\.worker\.ts', import\.meta\.url\)/);
  assert.match(client, /new Blob\(\[svg\], \{ type: 'image\/svg\+xml' \}\)/);
  const worker = readFileSync('src/lib/vectorTrace.worker.ts', 'utf8');
  // vtracer-wasm's default URL (vtracer_bg.wasm) is not in the package, so the shipped file is passed explicitly.
  assert.match(worker, /import vtracerWasmUrl from 'vtracer-wasm\/vtracer\.wasm\?url'/);
  assert.match(worker, /initVtracer\(\{ module_or_path: vtracerWasmUrl \}\)/);
});
