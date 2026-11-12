/**
 * AIグラフィックデザインの生成後の道具（独自）。本家はこのアカウントで生成が「権限がありません」のため生成後の画面を
 * 比べられず、本家の説明動画（4案・サムネイルの列・戻る・☆・デザインドキュメントの作成・ダウンロード）を手がかりに、
 * 服の柄を作る人が生成のあとにしたいこと（配色替え・くり返し柄の確認・背景を消す）を画面の中の処理で作った。
 * ここは画素だけを扱う純粋な関数（試験で直接呼ぶ）。描画とダウンロードは graphicToolsCanvas.ts。
 */
export type Rgb = [number, number, number];
export type PaletteColor = { color: Rgb; share: number };

const distance2 = (a: ArrayLike<number>, ai: number, b: Rgb) => {
  const dr = a[ai] - b[0]; const dg = a[ai + 1] - b[1]; const db = a[ai + 2] - b[2];
  return dr * dr + dg * dg + db * db;
};
const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));

export const rgbToHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * The main colors of a print (k-means on up to 40,000 opaque pixels, seeded from the most frequent 4-bit color boxes so
 * the same image always gives the same palette). Sorted by share; colors closer than ~18 levels are merged.
 */
export function extractPalette(data: ArrayLike<number>, width: number, height: number, count = 6): PaletteColor[] {
  const total = width * height;
  const step = Math.max(1, Math.floor(total / 40_000));
  const samples: number[] = [];
  for (let p = 0; p < total; p += step) { const i = p * 4; if (data[i + 3] >= 128) samples.push(i); }
  if (samples.length === 0) return [];
  const boxes = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const i of samples) {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const box = boxes.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    box.n += 1; box.r += data[i]; box.g += data[i + 1]; box.b += data[i + 2];
    boxes.set(key, box);
  }
  const seeds: Rgb[] = [];
  for (const box of [...boxes.values()].sort((a, b) => b.n - a.n)) {
    const color: Rgb = [box.r / box.n, box.g / box.n, box.b / box.n];
    // Seeds at least ~40 levels apart, so a big white ground does not take every seed.
    if (seeds.every((seed) => distance2(color, 0, seed) > 1600)) seeds.push(color);
    if (seeds.length >= count) break;
  }
  let centers = seeds;
  const assigned = new Int32Array(samples.length);
  for (let round = 0; round < 8; round++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    samples.forEach((i, s) => {
      let best = 0; let bestD = Infinity;
      centers.forEach((center, c) => { const d = distance2(data, i, center); if (d < bestD) { bestD = d; best = c; } });
      assigned[s] = best; const sum = sums[best]; sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; sum[3] += 1;
    });
    centers = centers.map((center, c) => (sums[c][3] ? [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]] as Rgb : center));
  }
  const counts = centers.map(() => 0);
  assigned.forEach((c) => { counts[c] += 1; });
  const palette: PaletteColor[] = [];
  centers.map((color, c) => ({ color: color.map(clamp) as Rgb, share: counts[c] / samples.length }))
    .filter((entry) => entry.share > 0).sort((a, b) => b.share - a.share)
    .forEach((entry) => {
      const near = palette.find((kept) => distance2(entry.color, 0, kept.color) < 324);
      if (near) near.share += entry.share; else palette.push(entry);
    });
  return palette;
}

/**
 * 配色を替える: each pixel moves by the change of its nearest palette colors (the two nearest, weighted by closeness),
 * so shading, line work and anti-aliased edges keep their shape while the color changes. Alpha is kept.
 */
export function recolorPixels(data: Uint8ClampedArray, palette: readonly Rgb[], replacements: ReadonlyArray<Rgb | null>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  const deltas = palette.map((color, index) => {
    const next = replacements[index];
    return next ? [next[0] - color[0], next[1] - color[1], next[2] - color[2]] : [0, 0, 0];
  });
  if (palette.length === 0 || deltas.every((d) => d[0] === 0 && d[1] === 0 && d[2] === 0)) return out;
  for (let i = 0; i < data.length; i += 4) {
    let first = 0; let firstD = Infinity; let second = -1; let secondD = Infinity;
    for (let c = 0; c < palette.length; c++) {
      const d = distance2(data, i, palette[c]);
      if (d < firstD) { second = first; secondD = firstD; first = c; firstD = d; } else if (d < secondD) { second = c; secondD = d; }
    }
    let dr = deltas[first][0]; let dg = deltas[first][1]; let db = deltas[first][2];
    if (second >= 0 && Number.isFinite(secondD) && firstD > 0) {
      // Between two palette colors (an edge): blend both changes, by inverse distance.
      const w1 = 1 / Math.sqrt(firstD); const w2 = 1 / Math.sqrt(secondD); const t = w2 / (w1 + w2);
      dr = dr * (1 - t) + deltas[second][0] * t; dg = dg * (1 - t) + deltas[second][1] * t; db = db * (1 - t) + deltas[second][2] * t;
    }
    out[i] = clamp(data[i] + dr); out[i + 1] = clamp(data[i + 1] + dg); out[i + 2] = clamp(data[i + 2] + db);
  }
  return out;
}

/** Half the width of the soft edge along a cut (px). */
const SEAM_FEATHER = 2;

/**
 * The cheapest connected cut through a band: one position per line (positions of neighbouring lines differ by at most
 * one), minimizing the summed cost. The first and last lines are neighbours across the tile's other edge, so a second
 * pass starts where the free path ended and must end within one pixel of it.
 */
function cheapestCut(cost: Float64Array, lines: number, span: number): Int32Array {
  const run = (start: number) => {
    const total = new Float64Array(lines * span); const from = new Int32Array(lines * span);
    for (let p = 0; p < span; p++) total[p] = start < 0 || p === start ? cost[p] : Infinity;
    for (let t = 1; t < lines; t++) {
      const row = t * span; const prev = row - span;
      for (let p = 0; p < span; p++) {
        let best = total[prev + p]; let at = p;
        if (p > 0 && total[prev + p - 1] < best) { best = total[prev + p - 1]; at = p - 1; }
        if (p + 1 < span && total[prev + p + 1] < best) { best = total[prev + p + 1]; at = p + 1; }
        total[row + p] = best + cost[row + p]; from[row + p] = at;
      }
    }
    return { total, from };
  };
  const last = (lines - 1) * span;
  const free = run(-1);
  let end = 0;
  for (let p = 1; p < span; p++) if (free.total[last + p] < free.total[last + end]) end = p;
  const loop = run(end);
  let finish = end;
  for (const p of [end - 1, end + 1]) if (p >= 0 && p < span && loop.total[last + p] < loop.total[last + finish]) finish = p;
  const cut = new Int32Array(lines);
  for (let t = lines - 1, p = finish; t >= 0; t--) { cut[t] = p; p = loop.from[t * span + p]; }
  return cut;
}

/**
 * つなぎ目をなじませる: makes the tile repeat without a visible seam. Pass 1 replaces a strip at the left and right edges
 * with the copy shifted by half the width; pass 2 does the same at the top and bottom. At an edge the pixel comes from
 * the shifted copy, whose neighbours across the tile boundary are neighbours in the image, so the repeat is continuous;
 * the copy's own seam sits in the middle, where the original is kept. Where the strip ends, each line switches at the
 * place the two images differ least (a minimum-error cut, as in image quilting), with only a 4px soft edge: on a print
 * the cut runs through the ground between motifs, so no motif is faded into a half-transparent double, which a
 * crossfade over the whole band leaves (seen on production 2026-11-12). band is the share of each side the cut may
 * use (0.25 = the outer quarter).
 */
export function makeSeamless(data: Uint8ClampedArray, width: number, height: number, band = 0.25): Uint8ClampedArray {
  const F = SEAM_FEATHER;
  const cutAxis = (source: Uint8ClampedArray, horizontal: boolean) => {
    const size = horizontal ? width : height; const lines = horizontal ? height : width;
    const half = Math.floor(size / 2); const edge = Math.floor(size * band);
    if (edge < 2 * F + 3 || lines < 1) return source;
    const at = (line: number, along: number) => (horizontal ? line * width + along : along * width + line) * 4;
    const shifted = (line: number, along: number) => at(line, (along + half) % size);
    const diff = (line: number, along: number) => {
      const i = at(line, along); const j = shifted(line, along);
      return Math.abs(source[i] - source[j]) + Math.abs(source[i + 1] - source[j + 1]) + Math.abs(source[i + 2] - source[j + 2]) + Math.abs(source[i + 3] - source[j + 3]);
    };
    // The cut's cost is the difference over its soft edge, so a cut never fades a motif in it.
    const bandCut = (lo: number, hi: number) => {
      const span = hi - lo + 1; const cost = new Float64Array(lines * span);
      for (let line = 0; line < lines; line++) {
        for (let p = 0; p < span; p++) {
          let sum = 0;
          for (let k = -F; k <= F; k++) sum += diff(line, lo + p + k);
          cost[line * span + p] = sum;
        }
      }
      return cheapestCut(cost, lines, span).map((p) => p + lo);
    };
    // Left: the shifted copy left of the cut (x = 0 always). Right: the shifted copy right of the cut (x = size - 1 always).
    const left = bandCut(F + 1, edge - F - 1);
    const right = bandCut(size - edge + F, size - F - 2);
    const out = new Uint8ClampedArray(source);
    for (let line = 0; line < lines; line++) {
      for (let along = 0; along < size; along++) {
        if (along === edge) along = size - edge;
        const toCut = along < edge ? left[line] - along : along - right[line];
        const weight = Math.min(1, Math.max(0, toCut / (2 * F) + 0.5));
        if (weight === 0) continue;
        const i = at(line, along); const j = shifted(line, along);
        for (let c = 0; c < 4; c++) out[i + c] = Math.round(source[i + c] * (1 - weight) + source[j + c] * weight);
      }
    }
    return out;
  };
  return cutAxis(cutAxis(data, true), false);
}

/** How far a repeat jumps at the tile's edges: the mean color difference across the right/left and bottom/top edges. */
export function seamScore(data: ArrayLike<number>, width: number, height: number): number {
  let sum = 0; let n = 0;
  for (let y = 0; y < height; y++) {
    const a = (y * width + width - 1) * 4; const b = (y * width) * 4;
    for (let c = 0; c < 3; c++) sum += Math.abs(data[a + c] - data[b + c]);
    n += 3;
  }
  for (let x = 0; x < width; x++) {
    const a = ((height - 1) * width + x) * 4; const b = x * 4;
    for (let c = 0; c < 3; c++) sum += Math.abs(data[a + c] - data[b + c]);
    n += 3;
  }
  return n ? sum / n : 0;
}

export type RepeatLayout = 'straight' | 'halfDrop' | 'mirror';
export const REPEAT_LAYOUTS: ReadonlyArray<{ id: RepeatLayout; label: string }> = [
  { id: 'straight', label: 'そのまま' }, { id: 'halfDrop', label: 'ハーフドロップ' }, { id: 'mirror', label: 'ミラー' },
];
/** One placement of the tile inside the repeat unit: where it goes and whether it is flipped. */
export type TilePlacement = { x: number; y: number; flipX: boolean; flipY: boolean };

/**
 * The repeat unit the preview tiles with CSS (in tile units): そのまま is the tile itself; ハーフドロップ is two columns with
 * the second dropped by half a tile (a textile repeat); ミラー is 2×2 with the copies flipped, which never shows a seam.
 */
export function repeatUnit(layout: RepeatLayout): { columns: number; rows: number; placements: TilePlacement[] } {
  if (layout === 'halfDrop') return { columns: 2, rows: 1, placements: [
    { x: 0, y: 0, flipX: false, flipY: false }, { x: 1, y: -0.5, flipX: false, flipY: false }, { x: 1, y: 0.5, flipX: false, flipY: false },
  ] };
  if (layout === 'mirror') return { columns: 2, rows: 2, placements: [
    { x: 0, y: 0, flipX: false, flipY: false }, { x: 1, y: 0, flipX: true, flipY: false },
    { x: 0, y: 1, flipX: false, flipY: true }, { x: 1, y: 1, flipX: true, flipY: true },
  ] };
  return { columns: 1, rows: 1, placements: [{ x: 0, y: 0, flipX: false, flipY: false }] };
}

/**
 * 背景を消す: the flat ground of a print (the color all around the edges, white for these graphics) becomes transparent.
 * Only ground connected to the edges is removed, so white inside a motif stays. Pixels at the motif's edge get partial
 * alpha and lose the ground's tint, so the cut-out has no white halo on a dark garment. tolerance is in color levels.
 */
export function removeBackground(data: Uint8ClampedArray, width: number, height: number, tolerance = 48): { pixels: Uint8ClampedArray; ground: Rgb | null; removed: number } {
  const out = new Uint8ClampedArray(data);
  const border: Rgb[] = [];
  const pushBorder = (x: number, y: number) => { const i = (y * width + x) * 4; if (data[i + 3] > 200) border.push([data[i], data[i + 1], data[i + 2]]); };
  for (let x = 0; x < width; x++) { pushBorder(x, 0); pushBorder(x, height - 1); }
  for (let y = 0; y < height; y++) { pushBorder(0, y); pushBorder(width - 1, y); }
  if (border.length === 0) return { pixels: out, ground: null, removed: 0 };
  const ground = [0, 1, 2].map((c) => border.map((p) => p[c]).sort((a, b) => a - b)[Math.floor(border.length / 2)]) as Rgb;
  // A ground that is not shared by most of the edge (a photo, an all-over pattern) is left alone.
  if (border.filter((p) => distance2(p, 0, ground) <= tolerance * tolerance).length / border.length < 0.6) return { pixels: out, ground: null, removed: 0 };
  const limit = tolerance * tolerance; const solid = (tolerance * 0.5) ** 2;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height); let head = 0; let tail = 0;
  const seed = (p: number) => { if (!visited[p] && distance2(data, p * 4, ground) <= limit) { visited[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  let removed = 0;
  while (head < tail) {
    const p = queue[head++]; const x = p % width; const y = (p - x) / width; const i = p * 4;
    const d = Math.sqrt(distance2(data, i, ground));
    const alpha = d * d <= solid ? 0 : Math.min(1, (d - tolerance * 0.5) / (tolerance * 0.5));
    if (alpha === 0) { out[i + 3] = 0; removed += 1; }
    else {
      // Take the ground's share out of the color (un-blend), then keep the rest as partial alpha.
      for (let c = 0; c < 3; c++) out[i + c] = clamp((data[i + c] - ground[c] * (1 - alpha)) / alpha);
      out[i + 3] = clamp(data[i + 3] * alpha);
    }
    if (x > 0) seed(p - 1); if (x < width - 1) seed(p + 1); if (y > 0) seed(p - width); if (y < height - 1) seed(p + width);
  }
  return { pixels: out, ground, removed };
}

/** Light's demo draws four proposals per run; the server plans at most 4 candidates per request. */
export const GRAPHIC_CANDIDATE_COUNT = 4;

/** The request text for the two AI tools: they redraw the chosen proposal (image 0) with the original references. */
export function graphicFollowUpBrief(kind: 'variations' | 'repeat', base: string): string {
  const lead = kind === 'variations'
    ? '別案: 画像0（選んだ案）のモチーフ・配色・描き方を保ったまま、モチーフの配置・向き・大きさを変えた別案を描いてください。'
    : '総柄: 画像0（選んだ案）のモチーフと配色で、上下左右につなげても継ぎ目が出ないくり返し柄（総柄）を、画面いっぱいに描いてください。画面の端で切れたモチーフは反対側の端に続く形にし、余白の量を全体で均一にしてください。';
  return [lead, base].filter(Boolean).join('\n');
}
