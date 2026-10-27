import type { MaterialCutoutResult } from '../../lib/workspaceMaterialReferences';

/** One print placed on the garment; x / y are the centre as a fraction of the garment, scale the width fraction. */
export type PrintPlacement = { id: string; printId: string; x: number; y: number; scale: number; rotation: number; flipX: boolean; flipY: boolean };
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

