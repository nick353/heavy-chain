/**
 * Colour flattening before vector tracing (lib/vectorTrace): k-means to a few print colours, or ink and paper for
 * black-and-white line art. Until 2026-11-12 this file also traced the regions along pixel edges into straight
 * polygons; VTracer now traces them with curves.
 */
export type RasterPixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
type Rgb = [number, number, number];

const DEFAULT_COLORS = 8;

const distance2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

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

/**
 * Black-and-white line art (a 平絵): almost every pixel is grey. k-means then splits each anti-aliased stroke
 * into several grey bands and the traced lines break into dashes (10/29: a blouse flat came out as 5 greys with
 * most sleeve and hem outlines missing), so such images are split into ink and paper by brightness instead.
 */
export function isLineArt(pixels: RasterPixels): boolean {
  const { width, height, data } = pixels;
  const total = width * height;
  const step = Math.max(1, Math.floor(total / 8192));
  let coloured = 0;
  let inked = 0;
  let paper = 0;
  let count = 0;
  for (let i = 0; i < total; i += step) {
    const [r, g, b] = pixelAt(data, i * 4);
    const level = (r + g + b) / 3;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 28) coloured++;
    if (level < LINE_INK_LEVEL) inked++;
    if (level > 238) paper++;
    count++;
  }
  // A pale cream or grey fabric is not line art: the paper has to be near white too.
  return coloured / count < 0.02 && paper / count > 0.5 && inked / count > 0.002 && inked / count < 0.35;
}

const LINE_INK_LEVEL = 200;
export function binarizeLineArt(pixels: RasterPixels): { palette: Rgb[]; labels: Uint8Array } {
  const { width, height, data } = pixels;
  const labels = new Uint8Array(width * height);
  const ink = [0, 0, 0, 0];
  for (let i = 0; i < labels.length; i++) {
    const [r, g, b] = pixelAt(data, i * 4);
    if ((r + g + b) / 3 < LINE_INK_LEVEL) { labels[i] = 1; ink[0] += r; ink[1] += g; ink[2] += b; ink[3]++; }
  }
  // The ink takes the darkest honest colour of the strokes rather than a mid grey from their soft edges.
  const shade = ink[3] ? Math.min(60, (ink[0] + ink[1] + ink[2]) / 3 / ink[3]) : 0;
  return { palette: [[255, 255, 255], [shade, shade, shade]], labels };
}
