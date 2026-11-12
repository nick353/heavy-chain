/**
 * Raster → real vector SVG (SVGにする / ベクター化の SVG ダウンロード).
 *
 * The outlines are traced by VTracer (visioncortex, MIT), compiled to WebAssembly by vtracer-wasm (MIT), in the
 * browser: no server, no cost. Before tracing, the image is reduced to the chosen number of colours with the
 * k-means of rasterToSvg (line art is split into ink and paper instead), so every path is one flat print colour and
 * anti-aliased edges do not become hundreds of thin slivers. VTracer fits curves (C segments) around each colour
 * region and stacks the regions, so the SVG stays sharp at any zoom and opens in Illustrator / Figma as shapes.
 *
 * This module is the pure part (settings, colour flattening, finishing and checking the SVG); the worker and the
 * browser client call it.
 */
import { binarizeLineArt, quantize, type RasterPixels } from './rasterToSvg.ts';

export type VectorDetail = 'coarse' | 'normal' | 'fine';
export type VectorTraceOptions = { colors: number; detail: VectorDetail; lineArt?: boolean };
/** width/height: the SVG's size (the original image's, so it opens at the size of the picture); trace*: the traced pixels (the viewBox). */
export type VectorTraceResult = { svg: string; pathCount: number; curveCount: number; colors: string[]; width: number; height: number; traceWidth: number; traceHeight: number };
type Rgb = [number, number, number];

export const VECTOR_COLOR_CHOICES = [4, 6, 8, 12, 16] as const;
export const VECTOR_DETAILS: ReadonlyArray<{ id: VectorDetail; label: string }> = [
  { id: 'coarse', label: '粗い' },
  { id: 'normal', label: 'ふつう' },
  { id: 'fine', label: '細かい' },
];

/** Long edge the image is traced at, and the smallest region (in traced pixels) that is kept as its own shape. */
const DETAIL: Record<VectorDetail, { side: number; speckle: number }> = {
  coarse: { side: 768, speckle: 36 },
  normal: { side: 1024, speckle: 16 },
  fine: { side: 1600, speckle: 4 },
};
/** Thin strokes of a 平絵 break apart below this size (10/29), whatever the chosen detail. */
const LINE_ART_SIDE = 1600;

export const traceSide = (options: VectorTraceOptions) => (options.lineArt ? Math.max(LINE_ART_SIDE, DETAIL[options.detail].side) : DETAIL[options.detail].side);

/**
 * The configuration object for vtracer-wasm's `to_svg`. The wrapper passes the numbers straight to visioncortex, so
 * they are in its units, not the VTracer CLI's: angles in radians, `filterSpeckle` as an area, `colorPrecision` as the
 * number of dropped bits (0 = keep every colour, which our flattened palette needs) and `layerDifference` 0 merges
 * nothing (the palette already decided the colours).
 */
export function vtracerConfig(options: VectorTraceOptions) {
  return {
    binary: false,
    mode: 'spline',
    hierarchical: 'stacked',
    cornerThreshold: (60 * Math.PI) / 180,
    lengthThreshold: 4,
    maxIterations: 10,
    spliceThreshold: (45 * Math.PI) / 180,
    filterSpeckle: DETAIL[options.detail].speckle,
    colorPrecision: 0,
    layerDifference: 0,
    pathPrecision: 2,
  };
}

/** Every pixel replaced by its palette colour (opaque), plus the palette itself. */
export function flattenToPalette(pixels: RasterPixels, options: VectorTraceOptions): { rgba: Uint8Array; palette: Rgb[] } {
  const { palette, labels } = options.lineArt ? binarizeLineArt(pixels) : quantize(pixels, options.colors);
  const rgba = new Uint8Array(labels.length * 4);
  for (let i = 0; i < labels.length; i++) {
    const color = palette[labels[i]];
    rgba[i * 4] = Math.round(color[0]); rgba[i * 4 + 1] = Math.round(color[1]); rgba[i * 4 + 2] = Math.round(color[2]); rgba[i * 4 + 3] = 255;
  }
  return { rgba, palette };
}

const hex = (color: Rgb) => `#${color.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (value: string): Rgb => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
const nearest = (palette: Rgb[], color: Rgb) => palette.reduce((best, entry) => (
  (entry[0] - color[0]) ** 2 + (entry[1] - color[1]) ** 2 + (entry[2] - color[2]) ** 2
  < (best[0] - color[0]) ** 2 + (best[1] - color[1]) ** 2 + (best[2] - color[2]) ** 2 ? entry : best), palette[0]);

/**
 * VTracer's output made ready to hand over: a viewBox of the traced pixels so it scales instead of cropping, the
 * original image's size as width/height (it opens at the picture's size), each fill snapped back to the palette
 * (VTracer averages a region with the specks it absorbed, so #abb7de and #acb8dd would otherwise both appear) and no
 * generator comment.
 */
export function finishVectorSvg(raw: string, traceWidth: number, traceHeight: number, palette: Rgb[], size = { width: traceWidth, height: traceHeight }): string {
  const body = raw.slice(raw.indexOf('<path'), raw.lastIndexOf('</svg>'));
  const snapped = body.replace(/fill="(#[0-9a-fA-F]{6})"/g, (_, color: string) => `fill="${hex(nearest(palette, fromHex(color)))}"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${traceWidth} ${traceHeight}" width="${size.width}" height="${size.height}">\n${snapped.trim()}\n</svg>\n`;
}

/** What the SVG actually holds: shapes, curves, colours, and whether a raster image hides inside. */
export function inspectVectorSvg(svg: string): { pathCount: number; curveCount: number; colors: string[]; embeddedImages: number } {
  return {
    pathCount: (svg.match(/<path\b/g) ?? []).length,
    curveCount: (svg.match(/[Cc]\s*-?\d/g) ?? []).length,
    colors: [...new Set((svg.match(/fill="(#[0-9a-fA-F]{6})"/g) ?? []).map((fill) => fill.slice(6, 13).toLowerCase()))],
    embeddedImages: (svg.match(/<image\b/g) ?? []).length,
  };
}

/** Traces pixels with an initialised vtracer `to_svg` (the worker passes the WebAssembly export; tests load it from disk). */
export function traceWithVtracer(
  toSvg: (pixels: Uint8Array, width: number, height: number, config: unknown) => string,
  pixels: RasterPixels,
  options: VectorTraceOptions,
  size = { width: pixels.width, height: pixels.height },
): VectorTraceResult {
  const { rgba, palette } = flattenToPalette(pixels, options);
  const svg = finishVectorSvg(toSvg(rgba, pixels.width, pixels.height, vtracerConfig(options)), pixels.width, pixels.height, palette, size);
  const inspected = inspectVectorSvg(svg);
  if (inspected.pathCount === 0 || inspected.embeddedImages > 0) throw new Error('vector_trace_empty');
  return { svg, pathCount: inspected.pathCount, curveCount: inspected.curveCount, colors: inspected.colors, ...size, traceWidth: pixels.width, traceHeight: pixels.height };
}
