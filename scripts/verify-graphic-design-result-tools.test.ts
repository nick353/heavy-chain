import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REPEAT_LAYOUTS, extractPalette, graphicFollowUpBrief, hexToRgb, makeSeamless, recolorPixels, removeBackground, repeatUnit, rgbToHex, seamScore,
  GRAPHIC_CANDIDATE_COUNT, GRAPHIC_CANDIDATE_DIRECTIONS, type Rgb,
} from '../src/features/graphicDesign/graphicTools.ts';
import { candidatePlan } from '../src/lib/imageCandidatePlan.ts';
import { candidateGrid, graphicFileName } from '../src/features/graphicDesign/graphicResult.ts';

// 独自（本家で流せないため想像で作った）: Light's AIグラフィックデザイン answers 「権限がありません」 on this account, so its
// result screen cannot be compared. Light's own demo video of the tool (graphic-design.mp4) shows four proposals per run,
// 「‹ 戻る」, ◀ ☆ 「デザインドキュメントの作成」 and a green download button. Heavy drew one image with no tool at all
// (production b902be00, 2026-11-12). These tests pin the result view and the in-browser tools built for print designers.

/** A w×h RGBA image filled by fn(x, y) → [r, g, b, a]. */
function image(width: number, height: number, fn: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(fn(x, y), (y * width + x) * 4);
  return data;
}
const at = (data: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

// A white ground with a navy disc and an orange square, like the flat prints the tool draws.
const W = 64; const H = 64;
const print = image(W, H, (x, y) => {
  if ((x - 20) ** 2 + (y - 20) ** 2 < 100) return [20, 40, 120, 255];
  if (x >= 40 && x < 56 && y >= 36 && y < 52) return [240, 140, 20, 255];
  return [255, 255, 255, 255];
});

test('配色を替える: the palette is the print\'s colors by share, and a replaced color moves while the others stay', () => {
  const palette = extractPalette(print, W, H, 6);
  assert.equal(palette.length, 3);
  assert.deepEqual(palette[0].color, [255, 255, 255]);
  assert.ok(palette[0].share > 0.8);
  const colors = palette.map((entry) => entry.color);
  const navy = colors.findIndex((color) => color[2] > color[0] + 50);
  const replacements: Array<Rgb | null> = colors.map(() => null);
  replacements[navy] = [180, 30, 60];
  const out = recolorPixels(print, colors, replacements);
  assert.deepEqual(at(out, W, 20, 20), [180, 30, 60, 255]);
  assert.deepEqual(at(out, W, 48, 44), [240, 140, 20, 255]);
  assert.deepEqual(at(out, W, 2, 2), [255, 255, 255, 255]);
  // Nothing replaced: the pixels are unchanged.
  assert.deepEqual(recolorPixels(print, colors, colors.map(() => null)), print);
  assert.equal(rgbToHex([180, 30, 60]), '#b41e3c');
  assert.deepEqual(hexToRgb('#B41E3C'), [180, 30, 60]);
  assert.equal(hexToRgb('red'), null);
});

test('リピートで確認: つなぎ目をなじませる removes the jump at the tile\'s edges and keeps the middle', () => {
  // A left-to-right ramp jumps from 255 back to 0 when repeated.
  const ramp = image(W, H, (x, y) => [x * 4, y * 4, 128, 255]);
  const before = seamScore(ramp, W, H);
  const after = makeSeamless(ramp, W, H);
  assert.ok(before > 60, `before ${before}`);
  assert.ok(seamScore(after, W, H) < 8, `after ${seamScore(after, W, H)}`);
  assert.deepEqual(at(after, W, 32, 32), at(ramp, W, 32, 32));
  // The layouts: one tile, a half-drop textile repeat, and a mirror repeat (2×2 flipped).
  assert.deepEqual(REPEAT_LAYOUTS.map((item) => item.label), ['そのまま', 'ハーフドロップ', 'ミラー']);
  assert.deepEqual(repeatUnit('straight'), { columns: 1, rows: 1, placements: [{ x: 0, y: 0, flipX: false, flipY: false }] });
  assert.deepEqual(repeatUnit('halfDrop').placements.map((p) => [p.x, p.y]), [[0, 0], [1, -0.5], [1, 0.5]]);
  assert.deepEqual(repeatUnit('mirror').placements.map((p) => [p.flipX, p.flipY]), [[false, false], [true, false], [false, true], [true, true]]);
});

test('リピートで確認: the seam is a cut through the ground, so no motif is faded into a half-transparent double', () => {
  // 独自: the first version crossfaded the outer quarter with the shifted copy, and on production (2026-11-12, run
  // b40fce55) the half-drop preview showed pale doubled flowers along every tile edge. A print's ground lets the cut
  // pass between the motifs, so every pixel is the ground or a motif color, never a mix.
  const S = 96;
  const discs: Array<[number, number]> = [[10, 24], [86, 60], [40, 40], [28, 78], [66, 14], [58, 88], [14, 50], [80, 34]];
  const dots = image(S, S, (x, y) => (discs.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 < 25) ? [20, 40, 120, 255] : [255, 255, 255, 255]));
  const out = makeSeamless(dots, S, S);
  let mixed = 0; let motif = 0;
  for (let i = 0; i < out.length; i += 4) {
    const px = Array.from(out.slice(i, i + 4)).join(',');
    if (px === '20,40,120,255') motif++;
    else if (px !== '255,255,255,255') mixed++;
  }
  assert.equal(mixed, 0, `${mixed} faded pixels`);
  assert.ok(motif > 0);
  // The tile's edges are neighbours in the image (columns 47 and 48), so the repeat is continuous; the middle rows keep
  // pass 1's result, whose edge columns are the half-shifted copy.
  for (let y = 24; y <= 70; y++) {
    assert.deepEqual(at(out, S, 0, y), at(dots, S, 48, y), `row ${y}`);
    assert.deepEqual(at(out, S, S - 1, y), at(dots, S, 47, y), `row ${y}`);
  }
});

test('背景を消す: the ground around the print becomes transparent, white inside a motif stays, edges lose the white tint', () => {
  // A navy ring with a white hole: the hole is not connected to the edge, so it stays white.
  const ring = image(W, H, (x, y) => {
    const d = Math.hypot(x - 32, y - 32);
    if (d < 6) return [255, 255, 255, 255];
    if (d < 20) return [20, 40, 120, 255];
    if (d < 21) return [138, 148, 188, 255]; // anti-aliased edge: half navy, half white
    return [255, 255, 255, 255];
  });
  const { pixels, ground, removed } = removeBackground(ring, W, H, 48);
  assert.deepEqual(ground, [255, 255, 255]);
  assert.equal(at(pixels, W, 1, 1)[3], 0);
  assert.deepEqual(at(pixels, W, 32, 32), [255, 255, 255, 255]);
  assert.deepEqual(at(pixels, W, 32, 20), [20, 40, 120, 255]);
  assert.ok(removed > W * H * 0.6);
  // A busy photo-like edge is left alone.
  const noisy = image(W, H, (x, y) => [(x * 37 + y * 11) % 256, (x * 13) % 256, (y * 29) % 256, 255]);
  assert.equal(removeBackground(noisy, W, H, 48).ground, null);
});

test('the result view has Light\'s demo layout and the designer tools; a run draws four proposals', () => {
  assert.equal(GRAPHIC_CANDIDATE_COUNT, 4);
  const view = readFileSync('src/components/lightchain/GraphicResultView.tsx', 'utf8');
  for (const text of ['戻る', 'デザインドキュメントの作成', 'ほかのツールに送る', 'お気に入りに追加', 'この案をダウンロード', '2倍の大きさでダウンロード', '案をまとめて（ZIP）',
    '似た案を増やす', '総柄にする', '配色を替える', 'リピートで確認', '背景を消す', 'つなぎ目をなじませる', 'REPEAT_LAYOUTS',
    '透過PNGでダウンロード', 'この配色でダウンロード', '参考画像にして作り直す', '並べた画像（3×3）をダウンロード'])
    assert.ok(view.includes(text), text);
  const actions = readFileSync('src/features/graphicDesign/graphicResultActions.ts', 'utf8');
  for (const text of ['プリントイメージで服に当てる', 'Canvasで一部を修正', 'ベクター化', "listGeneratedImages(brandId, { jobId, order: 'oldest', limit: 8 })", 'setGeneratedImageFavorite', 'createCanvasDocument'])
    assert.ok(actions.includes(text), text);
  const page = readFileSync('src/pages/LightchainGraphicDesignPage.tsx', 'utf8');
  assert.match(page, /candidateCount: GRAPHIC_CANDIDATE_COUNT/);
  assert.match(page, /candidateDirections: GRAPHIC_CANDIDATE_DIRECTIONS/);
  assert.match(page, /workspace\.editResult\(\{ brief: graphicFollowUpBrief\(kind,/);
  assert.match(page, /result: \{ \.\.\.workspace\.result, imageId: candidate\.id, storagePath: candidate\.storage_path \}/);
  const hook = readFileSync('src/hooks/useCanonicalImageWorkspace.ts', 'utf8');
  assert.match(hook, /\.\.\.candidatePlan\(configRef\.current\)\}\);/);
  assert.match(hook, /editResult:\(override\?:RunOverride\)=>run\('edit-result',override\)/);
});

test('the four proposals each get their own layout direction, so they are not near-duplicates', () => {
  // 独自: with one prompt for all four, two of the four production proposals came back with nearly the same layout
  // (run b40fce55, 2026-11-12). The server already takes one direction per candidate (variations).
  assert.equal(GRAPHIC_CANDIDATE_DIRECTIONS.length, GRAPHIC_CANDIDATE_COUNT);
  assert.equal(new Set(GRAPHIC_CANDIDATE_DIRECTIONS).size, GRAPHIC_CANDIDATE_COUNT);
  for (const direction of GRAPHIC_CANDIDATE_DIRECTIONS) assert.ok(direction.length <= 600 && /構成/.test(direction), direction);
  assert.deepEqual(candidatePlan({ candidateCount: 4, candidateDirections: GRAPHIC_CANDIDATE_DIRECTIONS }), { count: 4, variations: [...GRAPHIC_CANDIDATE_DIRECTIONS] });
  // Other tools: one image, or a count without directions, stay as before; a short or blank list is not sent (the server
  // refuses a list whose length differs from the count).
  assert.deepEqual(candidatePlan({}), {});
  assert.deepEqual(candidatePlan({ candidateCount: 1, candidateDirections: ['a'] }), {});
  assert.deepEqual(candidatePlan({ candidateCount: 4 }), { count: 4 });
  assert.deepEqual(candidatePlan({ candidateCount: 4, candidateDirections: ['a', 'b'] }), { count: 4 });
  assert.deepEqual(candidatePlan({ candidateCount: 2, candidateDirections: ['a', ' '] }), { count: 2 });
  assert.deepEqual(candidatePlan({ candidateCount: 9, candidateDirections: ['a', 'b', 'c', 'd', 'e'] }), { count: 4, variations: ['a', 'b', 'c', 'd'] });
  const api = readFileSync('src/lib/imageApi.ts', 'utf8');
  assert.match(api, /variations: options\?\.variations/);
});

test('the follow-up requests, the design document grid and the file names', () => {
  assert.match(graphicFollowUpBrief('variations', 'グラフィックデザイン: 基本'), /^別案: 画像0（選んだ案）.*\nグラフィックデザイン: 基本$/s);
  assert.match(graphicFollowUpBrief('repeat', 'x'), /継ぎ目が出ないくり返し柄（総柄）/);
  const cells = candidateGrid([{ width: 2048, height: 2048 }, { width: 1696, height: 2528 }, { width: 2048, height: 2048 }, { width: 2048, height: 2048 }], 1280, 960);
  assert.equal(cells.length, 4);
  for (const cell of cells) { assert.ok(cell.x >= 48 && cell.y >= 48 && cell.x + cell.width <= 1232 && cell.y + cell.height <= 912, JSON.stringify(cell)); }
  assert.ok(cells[1].x > cells[0].x && cells[2].y > cells[0].y);
  assert.equal(graphicFileName(1, '背景なし'), 'AIグラフィックデザイン-案2-背景なし.png');
  assert.equal(graphicFileName(0), 'AIグラフィックデザイン-案1.png');
});
