import type { RuntimeAlphaPlane } from '../domain/types.ts';
import {
  composePrintableSurface,
  type ComposedPrintableSurface,
} from './semanticSurfaceMap.ts';
import {
  suggestPrintableSurface,
  type PrintableSurfaceSuggestionDiagnostics,
  type PrintableSurfaceSuggestionFallbackReason,
} from './suggestPrintableSurface.ts';

export type SemanticGarmentRegionId =
  | 'torso'
  | 'sleeve-left'
  | 'sleeve-right'
  | 'collar'
  | 'hem';

export type SemanticGarmentRegionPlanes = Readonly<{
  torso: RuntimeAlphaPlane;
  sleeveLeft: RuntimeAlphaPlane;
  sleeveRight: RuntimeAlphaPlane;
  collar: RuntimeAlphaPlane;
  hem: RuntimeAlphaPlane;
}>;

export type SemanticGarmentSurfaceDiagnostics = PrintableSurfaceSuggestionDiagnostics & Readonly<{
  regionPixels: Readonly<Record<SemanticGarmentRegionId, number>>;
  forbiddenPixels: number;
}>;

export type SemanticGarmentSurfaceProposal =
  | Readonly<{
      kind: 'success';
      provenance: 'deterministic-alpha-structure-v1';
      surface: ComposedPrintableSurface;
      regions: SemanticGarmentRegionPlanes;
      diagnostics: SemanticGarmentSurfaceDiagnostics;
    }>
  | Readonly<{
      kind: 'fallback-required';
      reason: PrintableSurfaceSuggestionFallbackReason;
      diagnostics?: PrintableSurfaceSuggestionDiagnostics;
    }>;

const countVisible = (alpha: Uint8ClampedArray) => {
  let pixels = 0;
  for (const value of alpha) if (value > 0) pixels += 1;
  return pixels;
};

const emptyPlane = (width: number, height: number): RuntimeAlphaPlane => ({
  width,
  height,
  alpha: new Uint8ClampedArray(width * height),
});

/**
 * Turns a stable garment alpha into an explicit, conservative surface proposal.
 *
 * This is intentionally deterministic and alpha-only: it is a bounded
 * printable-area proposal, not a claim that a full semantic segmentation
 * model ran. The central torso is printable; the remaining garment pixels are
 * classified into collar, hem, and left/right peripheral regions so the UI
 * can show why those areas are excluded. This alpha-only proposal is not a
 * model-backed garment-part segmentation result; it is deliberately marked
 * manual-ready until the user reviews it in the existing editor. Any
 * uncertain input is delegated to the existing manual/whole-garment fallback
 * by returning `fallback-required`.
 */
export const buildSemanticGarmentSurface = ({
  width,
  height,
  garmentAlpha,
}: {
  width: number;
  height: number;
  garmentAlpha: Uint8ClampedArray;
}): SemanticGarmentSurfaceProposal => {
  const suggestion = suggestPrintableSurface({ width, height, garmentAlpha });
  if (suggestion.kind === 'fallback-required') return suggestion;

  const bounds = suggestion.diagnostics.garmentBounds;
  if (!bounds) return { kind: 'fallback-required', reason: 'EMPTY_GARMENT' };

  const regions = {
    torso: emptyPlane(width, height),
    sleeveLeft: emptyPlane(width, height),
    sleeveRight: emptyPlane(width, height),
    collar: emptyPlane(width, height),
    hem: emptyPlane(width, height),
  };
  const forbidden = new Uint8ClampedArray(width * height);
  const regionPixels: Record<SemanticGarmentRegionId, number> = {
    torso: 0,
    'sleeve-left': 0,
    'sleeve-right': 0,
    collar: 0,
    hem: 0,
  };
  let forbiddenPixels = 0;
  const centerX = bounds.x + (bounds.width / 2);
  const collarEnd = bounds.y + Math.round(bounds.height * 0.2);
  const hemStart = bounds.y + Math.round(bounds.height * 0.86);

  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const index = (y * width) + x;
      const garment = garmentAlpha[index];
      if (garment === 0) continue;
      const printable = suggestion.alpha[index];
      if (printable > 0) {
        regions.torso.alpha[index] = printable;
        regionPixels.torso += 1;
        continue;
      }

      forbidden[index] = 255;
      forbiddenPixels += 1;
      let region: SemanticGarmentRegionId;
      if (y <= collarEnd) region = 'collar';
      else if (y >= hemStart) region = 'hem';
      else if (x < centerX) region = 'sleeve-left';
      else region = 'sleeve-right';
      const plane = region === 'sleeve-left'
        ? regions.sleeveLeft
        : region === 'sleeve-right'
          ? regions.sleeveRight
          : regions[region];
      plane.alpha[index] = garment;
      regionPixels[region] += 1;
    }
  }

  const surface = composePrintableSurface({
    planes: {
      garment: { width, height, alpha: garmentAlpha },
      printable: regions.torso,
      forbidden: { width, height, alpha: forbidden },
    },
    confidence: suggestion.diagnostics.confidence,
  });
  // The geometry is a deterministic prefill for the manual editor, not a
  // parser/model result. Keep the honesty boundary explicit in the surface
  // status so downstream approval code cannot treat it as semantic-ready.
  surface.status = 'manual-ready';
  return {
    kind: 'success',
    provenance: 'deterministic-alpha-structure-v1',
    surface,
    regions,
    diagnostics: {
      ...suggestion.diagnostics,
      regionPixels: Object.freeze(regionPixels),
      forbiddenPixels,
    },
  };
};

export const semanticRegionPixelCounts = (regions: SemanticGarmentRegionPlanes) => ({
  torso: countVisible(regions.torso.alpha),
  'sleeve-left': countVisible(regions.sleeveLeft.alpha),
  'sleeve-right': countVisible(regions.sleeveRight.alpha),
  collar: countVisible(regions.collar.alpha),
  hem: countVisible(regions.hem.alpha),
});
