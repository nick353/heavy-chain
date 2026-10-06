/**
 * Raster → editable SVG for the ベクター化 / 平絵をベクター化 tools.
 *
 * The image is colour-quantised (k-means on a pixel sample), the dominant border colour is treated as the
 * background, and every remaining colour region is traced along pixel edges into closed polygons that are
 * simplified with Douglas–Peucker. The result is a plain SVG of filled paths (one <path> per colour) that
 * opens in Illustrator/Figma as separate, editable shapes.
 */
export type RasterPixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
export type TraceOptions = { colors?: number; simplify?: number; minArea?: number; keepBackground?: boolean };
type Rgb = [number, number, number];
type Point = [number, number];

const DEFAULT_COLORS = 8;
const DEFAULT_SIMPLIFY = 0.8;
const DEFAULT_MIN_AREA = 6;

const distance2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Flattens transparent pixels onto white so they quantise as background. */
function pixelAt(data: RasterPixels['data'], index: number): Rgb {
  const alpha = data[index + 3] / 255;
  return [
    data[index] * alpha + 255 * (1 - alpha),
    data[index + 1] * alpha + 255 * (1 - alpha),
    data[index + 2] * alpha + 255 * (1 - alpha),
  ];
}

export function quantize(pixels: RasterPixels, colorCount = DEFAULT_COLORS): { palette: Rgb[]; labels: Uint8Array } {
  const { width, height, data } = pixels;
  const total = width * height;
  const step = Math.max(1, Math.floor(total / 4096));
  const sample: Rgb[] = [];
  for (let i = 0; i < total; i += step) sample.push(pixelAt(data, i * 4));
  // k-means++-style seeding: start from the first sample, then repeatedly take the farthest sample.
  const palette: Rgb[] = [sample[0]];
  while (palette.length < Math.min(colorCount, sample.length)) {
    let best = sample[0];
    let bestDistance = -1;
    for (const color of sample) {
      const nearest = Math.min(...palette.map((p) => distance2(p, color)));
      if (nearest > bestDistance) { bestDistance = nearest; best = color; }
    }
    if (bestDistance < 64) break; // remaining colours are near-duplicates
    palette.push(best);
  }
  for (let iteration = 0; iteration < 8; iteration++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const color of sample) {
      let nearest = 0;
      for (let k = 1; k < palette.length; k++) if (distance2(palette[k], color) < distance2(palette[nearest], color)) nearest = k;
      sums[nearest][0] += color[0]; sums[nearest][1] += color[1]; sums[nearest][2] += color[2]; sums[nearest][3] += 1;
    }
    sums.forEach((sum, k) => { if (sum[3] > 0) palette[k] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]]; });
  }
  const labels = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const color = pixelAt(data, i * 4);
    let nearest = 0;
    for (let k = 1; k < palette.length; k++) if (distance2(palette[k], color) < distance2(palette[nearest], color)) nearest = k;
    labels[i] = nearest;
  }
  return { palette, labels };
}

/** Most frequent label along the image border = background. */
function borderLabel(labels: Uint8Array, width: number, height: number): number {
  const counts = new Map<number, number>();
  const add = (i: number) => counts.set(labels[i], (counts.get(labels[i]) ?? 0) + 1);
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

/**
 * Traces every region of `label` into closed loops along pixel edges. Edges are directed with the region on
 * the left, so outer boundaries run one way and holes the other; `fill-rule="evenodd"` renders both correctly.
 */
export function traceLabel(labels: Uint8Array, width: number, height: number, label: number): Point[][] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === label;
  const outgoing = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (width + 1) + x;
  const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const from = key(x1, y1);
    const list = outgoing.get(from);
    if (list) list.push(key(x2, y2)); else outgoing.set(from, [key(x2, y2)]);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!inside(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }
  const loops: Point[][] = [];
  for (const [start, targets] of outgoing) {
    while (targets.length > 0) {
      const loop: Point[] = [];
      let current = start;
      do {
        loop.push([current % (width + 1), Math.floor(current / (width + 1))]);
        const next = outgoing.get(current)?.pop();
        if (next === undefined) break;
        current = next;
      } while (current !== start);
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/** Drops vertices that lie on a straight run, then Douglas–Peucker with `epsilon` pixels. */
export function simplifyLoop(loop: Point[], epsilon = DEFAULT_SIMPLIFY): Point[] {
  const corners = loop.filter((point, index) => {
    const prev = loop[(index - 1 + loop.length) % loop.length];
    const next = loop[(index + 1) % loop.length];
    return (point[0] - prev[0]) * (next[1] - point[1]) !== (point[1] - prev[1]) * (next[0] - point[0]);
  });
  if (corners.length < 4 || epsilon <= 0) return corners;
  const keep = new Uint8Array(corners.length);
  const reduce = (from: number, to: number) => {
    const [ax, ay] = corners[from];
    const [bx, by] = corners[to];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let farthest = -1;
    let farthestDistance = epsilon;
    for (let i = from + 1; i < to; i++) {
      const d = Math.abs((bx - ax) * (ay - corners[i][1]) - (ax - corners[i][0]) * (by - ay)) / length;
      if (d > farthestDistance) { farthestDistance = d; farthest = i; }
    }
    if (farthest >= 0) { keep[farthest] = 1; reduce(from, farthest); reduce(farthest, to); }
  };
  const half = Math.floor(corners.length / 2);
  keep[0] = 1; keep[half] = 1;
  reduce(0, half);
  reduce(half, corners.length - 1);
  keep[corners.length - 1] = 1;
  return corners.filter((_, index) => keep[index]);
}

const loopArea = (loop: Point[]) => Math.abs(loop.reduce((sum, [x, y], i) => {
  const [nx, ny] = loop[(i + 1) % loop.length];
  return sum + x * ny - nx * y;
}, 0) / 2);

export function tracePixelsToSvg(pixels: RasterPixels, options: TraceOptions = {}): { svg: string; colors: string[]; pathCount: number } {
  const { width, height } = pixels;
  const { palette, labels } = quantize(pixels, options.colors ?? DEFAULT_COLORS);
  const background = borderLabel(labels, width, height);
  const minArea = options.minArea ?? DEFAULT_MIN_AREA;
  const paths: string[] = [];
  const colors: string[] = [];
  if (options.keepBackground) paths.push(`<rect width="${width}" height="${height}" fill="${hex(palette[background])}"/>`);
  palette.forEach((color, label) => {
    if (label === background) return;
    const loops = traceLabel(labels, width, height, label)
      .map((loop) => simplifyLoop(loop, options.simplify ?? DEFAULT_SIMPLIFY))
      .filter((loop) => loop.length >= 3 && loopArea(loop) >= minArea);
    if (loops.length === 0) return;
    const d = loops.map((loop) => `M${loop.map(([x, y]) => `${x} ${y}`).join('L')}Z`).join('');
    colors.push(hex(color));
    paths.push(`<path fill="${hex(color)}" fill-rule="evenodd" d="${d}"/>`);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${paths.join('')}</svg>`;
  return { svg, colors, pathCount: paths.length - (options.keepBackground ? 1 : 0) };
}

/** Browser helper: fetches an image (blob/data/https), downsizes it to `maxSide` and traces it. */
export async function traceImageUrlToSvg(url: string, options: TraceOptions & { maxSide?: number } = {}): Promise<{ svg: string; colors: string[]; pathCount: number }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('svg_source_unavailable');
  const bitmap = await createImageBitmap(await response.blob());
  const maxSide = options.maxSide ?? 640;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('svg_canvas_unavailable');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return tracePixelsToSvg(context.getImageData(0, 0, width, height), options);
}
