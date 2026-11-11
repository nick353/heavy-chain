import type { MaterialCutoutResult } from '../../lib/workspaceMaterialReferences';

/** One print placed on the garment; x / y are the centre as a fraction of the garment, scale the width fraction. */
export type PrintPlacement = {
  id: string; printId: string; x: number; y: number; scale: number; rotation: number; flipX: boolean; flipY: boolean;
  /** 透過度 0..1; missing means opaque. */ opacity?: number;
  /** Extra height factor from Light's side handles (1 keeps the print's own aspect); missing means 1. */ stretch?: number;
};
export type LayerMove = 'top' | 'up' | 'down' | 'bottom';

/** The placed print's height as a fraction of the garment width (the CSS box uses the same aspect). */
export const placementAspect = (placement: Pick<PrintPlacement, 'stretch'>, printAspect: number) => printAspect * (placement.stretch ?? 1);

/**
 * Where Light drops a print picked in ステップ2 (re-measured 2026-11-11 on jp.linkaigc.com): at the centre of the
 * painted mask, its width about 0.28 of the mask's shorter side (a square RED logo on a shirt came out at 26% of
 * the image width). Without a mask it sits in the middle at a quarter of the width. Exported for tests.
 */
export function initialPlacementGeometry(bounds: { x: number; y: number; width: number; height: number } | null, size: { width: number; height: number }) {
  if (!bounds) return { x: 0.5, y: 0.5, scale: 0.25 };
  return {
    x: (bounds.x + bounds.width / 2) / size.width,
    y: (bounds.y + bounds.height / 2) / size.height,
    scale: Math.max(0.05, Math.min(1.2, (Math.min(bounds.width, bounds.height) * 0.28) / size.width)),
  };
}

/** Prefix sums of a 0/1 grid, for O(1) box queries. */
const integral = (grid: Float32Array | Uint8Array, width: number, height: number) => {
  const sums = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += grid[y * width + x];
      sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row;
    }
  }
  return sums;
};
const boxSum = (sums: Float64Array, width: number, height: number, x: number, y: number, radius: number) => {
  const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius), x1 = Math.min(width, x + radius + 1), y1 = Math.min(height, y + radius + 1);
  const stride = width + 1;
  return { sum: sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0], area: (x1 - x0) * (y1 - y0) };
};

/**
 * The area the image model may change when the placed prints are turned into a printed look: every print pixel
 * grown by `grow` pixels and softened by `feather`, limited to the painted garment mask when there is one.
 * Returned in the protected-edit mask format (alpha 0 = editable, 255 = keep the composite's pixels), so the
 * buttons, pockets and background outside the prints stay exactly as placed and nothing can spill off the
 * garment (2026-11-11: a star placed past the sleeve came back drawn over the background). Exported for tests.
 */
export function printEditRegionMask(printAlpha: Uint8ClampedArray, width: number, height: number, options: { grow: number; feather: number; garmentAlpha?: Uint8ClampedArray | null }) {
  const pixels = width * height;
  if (printAlpha.length !== pixels * 4) throw new Error('print_edit_region_dimensions_invalid');
  const footprint = new Uint8Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel += 1) footprint[pixel] = printAlpha[pixel * 4 + 3] > 0 ? 1 : 0;
  const grown = new Float32Array(pixels);
  const footprintSums = integral(footprint, width, height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) grown[y * width + x] = boxSum(footprintSums, width, height, x, y, options.grow).sum > 0 ? 1 : 0;
  const grownSums = integral(grown, width, height);
  const mask = new Uint8ClampedArray(pixels * 4);
  let editable = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const box = options.feather > 0 ? boxSum(grownSums, width, height, x, y, options.feather) : { sum: grown[pixel], area: 1 };
      let amount = box.sum / box.area;
      if (options.garmentAlpha) amount *= options.garmentAlpha[pixel * 4 + 3] / 255;
      const at = pixel * 4;
      mask[at] = mask[at + 1] = mask[at + 2] = 255;
      mask[at + 3] = Math.round(255 * (1 - amount));
      if (amount > 0) editable += 1;
    }
  }
  if (!editable) throw new Error('プリントが服の範囲内に表示されていません。配置を確認してください。');
  return mask;
}

/**
 * The composite's size: the garment's own resolution, its long edge capped at OUTPUT_MAX_EDGE (Light-class 1696×2528, and
 * inside the protected edit's 4096 px / 10 MB source limits), never smaller than the editor's working size. Exported for tests.
 */
export const OUTPUT_MAX_EDGE = 2528;
export function outputSize(naturalWidth: number, naturalHeight: number, working: { width: number; height: number }) {
  const scale = Math.min(1, OUTPUT_MAX_EDGE / Math.max(naturalWidth, naturalHeight));
  const width = Math.round(naturalWidth * scale), height = Math.round(naturalHeight * scale);
  return width >= working.width && height >= working.height ? { width, height } : { width: working.width, height: working.height };
}

/** Reorders the stack (index 0 is the bottom layer). Exported for tests. */
export function movePlacementLayer(placements: PrintPlacement[], id: string, move: LayerMove): PrintPlacement[] {
  const index = placements.findIndex((item) => item.id === id);
  if (index < 0) return placements;
  const next = placements.slice();
  const [item] = next.splice(index, 1);
  const target = move === 'top' ? next.length : move === 'bottom' ? 0 : move === 'up' ? Math.min(next.length, index + 1) : Math.max(0, index - 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * Where a cutout's pixels sit on the source frame. A cloth-model cutout can come back cropped to the garment's
 * bounds; then it is drawn into those bounds, otherwise it covers the whole frame. Exported for tests.
 */
export function cutoutDrawRect(result: Pick<MaterialCutoutResult, 'bounds' | 'sourceSize' | 'sourceFrameSize' | 'outputSize'>, size: { width: number; height: number }) {
  const frame = result.sourceFrameSize ?? result.sourceSize;
  const { bounds, outputSize } = result;
  const cropped = (bounds.width < frame.width - 1 || bounds.height < frame.height - 1)
    && Math.abs(outputSize.width / outputSize.height - bounds.width / bounds.height) < 0.02;
  if (!cropped) return { x: 0, y: 0, width: size.width, height: size.height };
  const sx = size.width / frame.width, sy = size.height / frame.height;
  return { x: bounds.x * sx, y: bounds.y * sy, width: bounds.width * sx, height: bounds.height * sy };
}


/** The painted part of a mask (any alpha above 0), or null when nothing is painted. Exported for tests. */
export function maskBounds(mask: { width: number; height: number; data: Uint8ClampedArray }) {
  let minX = mask.width, minY = mask.height, maxX = -1, maxY = -1;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[(y * mask.width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Light's ワンクリックでトリミング: centres the print on the painted area and sizes it to fit inside, keeping its
 * aspect, rotation and flips. Exported for tests.
 */
export function fitPlacementToBounds(placement: PrintPlacement, bounds: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }, printAspect: number): PrintPlacement {
  const widthFraction = Math.min(bounds.width / size.width, (bounds.height / size.height) * (size.height / size.width) / printAspect);
  return {
    ...placement,
    x: (bounds.x + bounds.width / 2) / size.width,
    y: (bounds.y + bounds.height / 2) / size.height,
    scale: Math.max(0.05, Math.min(1.2, widthFraction)),
  };
}

/**
 * Light's 選択範囲にオブジェクトを追加: the connected area around a clicked point whose colour stays within the
 * tolerance of that point's colour (4-neighbour fill). Returns one byte per pixel (1 = inside). Exported for tests.
 */
export function regionAtPoint(image: { width: number; height: number; data: Uint8ClampedArray }, startX: number, startY: number, tolerance = 32) {
  const { width, height, data } = image;
  const region = new Uint8Array(width * height);
  const sx = Math.round(startX), sy = Math.round(startY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return region;
  const start = (sy * width + sx) * 4;
  const [r0, g0, b0] = [data[start], data[start + 1], data[start + 2]];
  const stack = [sy * width + sx];
  region[sy * width + sx] = 1;
  while (stack.length) {
    const index = stack.pop() as number;
    const x = index % width, y = (index - x) / width;
    for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
      if (next < 0 || region[next]) continue;
      const offset = next * 4;
      if (Math.abs(data[offset] - r0) + Math.abs(data[offset + 1] - g0) + Math.abs(data[offset + 2] - b0) > tolerance * 3) continue;
      region[next] = 1;
      stack.push(next);
    }
  }
  return region;
}
