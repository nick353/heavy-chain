import type {
  PrintableSurfaceSuggestionDiagnostics,
  PrintableSurfaceSuggestionFallbackReason,
} from './suggestPrintableSurface.ts';
import { refineAlphaEdge } from '../matte/refineAlphaEdge.ts';
import { buildSemanticGarmentSurface } from './semanticGarmentSurface.ts';

export type PrintableSurfaceAdapterFallbackReason =
  | PrintableSurfaceSuggestionFallbackReason
  | 'DIMENSION_MISMATCH'
  | 'CAPACITY_EXCEEDED';

export type PreparedPrintableSurfaceSuggestion =
  | {
      kind: 'success';
      width: number;
      height: number;
      rgba: Uint8ClampedArray;
      diagnostics: PrintableSurfaceSuggestionDiagnostics;
      provenance: 'deterministic-alpha-structure-v1';
    }
  | {
      kind: 'fallback-required';
      reason: PrintableSurfaceAdapterFallbackReason;
      width: number;
      height: number;
      diagnostics?: PrintableSurfaceSuggestionDiagnostics;
    };

export const preparePrintableSurfaceSuggestion = ({
  expectedSize,
  decoded,
}: {
  expectedSize: { width: number; height: number };
  decoded: { width: number; height: number; rgba: Uint8ClampedArray };
}): PreparedPrintableSurfaceSuggestion => {
  if (decoded.width !== expectedSize.width || decoded.height !== expectedSize.height) {
    return {
      kind: 'fallback-required',
      reason: 'DIMENSION_MISMATCH',
      width: decoded.width,
      height: decoded.height,
    };
  }
  // Refine at the decoded cutout's source resolution before deriving the
  // printable surface. The exact/manual garment paths remain unchanged; this
  // only improves the optional surface proposal's partial-alpha boundary.
  const refinedRgba = refineAlphaEdge({
    rgba: decoded.rgba,
    width: decoded.width,
    height: decoded.height,
  });
  const garmentAlpha = new Uint8ClampedArray(decoded.width * decoded.height);
  for (let index = 0; index < garmentAlpha.length; index += 1) {
    garmentAlpha[index] = refinedRgba[(index * 4) + 3];
  }
  const suggestion = buildSemanticGarmentSurface({
    width: decoded.width,
    height: decoded.height,
    garmentAlpha,
  });
  if (suggestion.kind === 'fallback-required') {
    return {
      kind: 'fallback-required',
      reason: suggestion.reason,
      width: decoded.width,
      height: decoded.height,
      diagnostics: suggestion.diagnostics,
    };
  }

  const rgba = new Uint8ClampedArray(decoded.width * decoded.height * 4);
  for (let index = 0; index < suggestion.surface.printableAlpha.length; index += 1) {
    const offset = index * 4;
    rgba[offset] = 255;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 255;
    rgba[offset + 3] = suggestion.surface.printableAlpha[index];
  }
  return {
    kind: 'success',
    width: suggestion.surface.width,
    height: suggestion.surface.height,
    rgba,
    diagnostics: suggestion.diagnostics,
    provenance: suggestion.provenance,
  };
};

export const enforcePrintableSuggestionCapacity = ({
  dataUrl,
  dataUrlBytes,
  maxDataUrlBytes,
  suggestion,
}: {
  dataUrl: string;
  dataUrlBytes: number;
  maxDataUrlBytes: number;
  suggestion: Extract<PreparedPrintableSurfaceSuggestion, { kind: 'success' }>;
}) => {
  if (dataUrlBytes > maxDataUrlBytes) {
    return {
      kind: 'fallback-required' as const,
      reason: 'CAPACITY_EXCEEDED' as const,
      width: suggestion.width,
      height: suggestion.height,
      diagnostics: suggestion.diagnostics,
    };
  }
  return {
    kind: 'success' as const,
    width: suggestion.width,
    height: suggestion.height,
    dataUrl,
    diagnostics: suggestion.diagnostics,
  };
};
