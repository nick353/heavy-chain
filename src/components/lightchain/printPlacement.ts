import type { MaterialCutoutResult } from '../../lib/workspaceMaterialReferences';

/** One print placed on the garment; x / y are the centre as a fraction of the garment, scale the width fraction. */
export type PrintPlacement = { id: string; printId: string; x: number; y: number; scale: number; rotation: number; flipX: boolean; flipY: boolean; /** 透過度 0..1; missing means opaque. */ opacity?: number };
export type LayerMove = 'top' | 'up' | 'down' | 'bottom';

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
