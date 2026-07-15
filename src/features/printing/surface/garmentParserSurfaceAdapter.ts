import type { ComposedPrintableSurface } from './semanticSurfaceMap.ts';
import { composePrintableSurface } from './semanticSurfaceMap.ts';
import {
  suggestPrintableSurface,
  type PrintableSurfaceSuggestionDiagnostics,
  type PrintableSurfaceSuggestionFallbackReason,
} from './suggestPrintableSurface.ts';

const MAX_PIXELS = 16_000_000;
const MIN_GARMENT_PIXELS = 64;
const MIN_GARMENT_RATIO = 0.005;

export type GarmentParserClassDefinition = Readonly<{
  id: number;
  label: string;
  role: 'garment' | 'occluder' | 'ignore';
}>;

export type GarmentParserCandidate = Readonly<{
  classId: number;
  label: string;
  pixels: number;
  imageRatio: number;
}>;

export type GarmentParserSurfaceFallbackReason =
  | 'NO_GARMENT_CLASS_PIXELS'
  | 'GARMENT_CLASS_TOO_SMALL'
  | 'PREFERRED_CLASS_NOT_PRESENT'
  | `SURFACE_${PrintableSurfaceSuggestionFallbackReason}`;

export type GarmentParserSurfaceProposal =
  | Readonly<{
      kind: 'success';
      selected: GarmentParserCandidate;
      candidates: readonly GarmentParserCandidate[];
      garmentAlpha: Uint8ClampedArray;
      printableAlpha: Uint8ClampedArray;
      occluderAlpha: Uint8ClampedArray;
      surface: ComposedPrintableSurface;
      suggestionDiagnostics: PrintableSurfaceSuggestionDiagnostics;
      confidence: number;
    }>
  | Readonly<{
      kind: 'selection-required';
      candidates: readonly GarmentParserCandidate[];
    }>
  | Readonly<{
      kind: 'fallback-required';
      reason: GarmentParserSurfaceFallbackReason;
      candidates: readonly GarmentParserCandidate[];
      suggestionDiagnostics?: PrintableSurfaceSuggestionDiagnostics;
    }>;

export class GarmentParserSurfaceValidationError extends Error {
  readonly code:
    | 'PARSER_SURFACE_DIMENSIONS_INVALID'
    | 'PARSER_SURFACE_PIXEL_LIMIT_EXCEEDED'
    | 'PARSER_SURFACE_LABEL_LENGTH_INVALID'
    | 'PARSER_SURFACE_SCHEMA_INVALID'
    | 'PARSER_SURFACE_UNDECLARED_LABEL';

  constructor(code: GarmentParserSurfaceValidationError['code']) {
    super(code);
    this.name = 'GarmentParserSurfaceValidationError';
    this.code = code;
  }
}

const validateClassDefinitions = (classes: readonly GarmentParserClassDefinition[]) => {
  const seen = new Set<number>();
  for (const definition of classes) {
    if (
      !Number.isSafeInteger(definition.id)
      || definition.id < 0
      || definition.id > 255
      || !definition.label.trim()
      || seen.has(definition.id)
    ) {
      throw new GarmentParserSurfaceValidationError('PARSER_SURFACE_SCHEMA_INVALID');
    }
    seen.add(definition.id);
  }
};

/**
 * Converts a categorical parser result into a semantic printable-surface
 * proposal. Multiple garment classes require explicit caller selection; this
 * adapter never guesses which worn item the user intends to print.
 */
export const prepareGarmentParserSurfaceProposal = ({
  width,
  height,
  labels,
  classes,
  preferredClassId,
}: {
  width: number;
  height: number;
  labels: Uint8Array | Uint8ClampedArray;
  classes: readonly GarmentParserClassDefinition[];
  preferredClassId?: number;
}): GarmentParserSurfaceProposal => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new GarmentParserSurfaceValidationError('PARSER_SURFACE_DIMENSIONS_INVALID');
  }
  if (width > MAX_PIXELS / height) {
    throw new GarmentParserSurfaceValidationError('PARSER_SURFACE_PIXEL_LIMIT_EXCEEDED');
  }
  if (labels.length !== width * height) {
    throw new GarmentParserSurfaceValidationError('PARSER_SURFACE_LABEL_LENGTH_INVALID');
  }
  validateClassDefinitions(classes);

  const classById = new Map(classes.map((definition) => [definition.id, definition]));
  const counts = new Uint32Array(256);
  for (const label of labels) {
    if (!classById.has(label)) {
      throw new GarmentParserSurfaceValidationError('PARSER_SURFACE_UNDECLARED_LABEL');
    }
    counts[label] += 1;
  }
  const minimumPixels = Math.max(MIN_GARMENT_PIXELS, Math.ceil(width * height * MIN_GARMENT_RATIO));
  const allGarmentCandidates = classes
    .filter((definition) => definition.role === 'garment' && counts[definition.id] > 0)
    .map((definition) => Object.freeze({
      classId: definition.id,
      label: definition.label,
      pixels: counts[definition.id],
      imageRatio: counts[definition.id] / (width * height),
    }))
    .sort((left, right) => right.pixels - left.pixels || left.classId - right.classId);
  if (allGarmentCandidates.length === 0) {
    return { kind: 'fallback-required', reason: 'NO_GARMENT_CLASS_PIXELS', candidates: Object.freeze([]) };
  }
  const candidates = Object.freeze(allGarmentCandidates.filter((candidate) => candidate.pixels >= minimumPixels));
  if (candidates.length === 0) {
    return { kind: 'fallback-required', reason: 'GARMENT_CLASS_TOO_SMALL', candidates: Object.freeze(allGarmentCandidates) };
  }

  let selected: GarmentParserCandidate | undefined;
  if (preferredClassId !== undefined) {
    const preferredDefinition = classById.get(preferredClassId);
    if (!preferredDefinition || preferredDefinition.role !== 'garment') {
      throw new GarmentParserSurfaceValidationError('PARSER_SURFACE_SCHEMA_INVALID');
    }
    selected = candidates.find((candidate) => candidate.classId === preferredClassId);
    if (!selected) {
      return { kind: 'fallback-required', reason: 'PREFERRED_CLASS_NOT_PRESENT', candidates };
    }
  } else if (candidates.length === 1) {
    [selected] = candidates;
  } else {
    return { kind: 'selection-required', candidates };
  }

  const garmentAlpha = new Uint8ClampedArray(width * height);
  const occluderAlpha = new Uint8ClampedArray(width * height);
  const occluderIds = new Set(classes.filter((definition) => definition.role === 'occluder').map((definition) => definition.id));
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] === selected.classId) garmentAlpha[index] = 255;
    if (occluderIds.has(labels[index])) occluderAlpha[index] = 255;
  }

  const suggestion = suggestPrintableSurface({ width, height, garmentAlpha });
  if (suggestion.kind === 'fallback-required') {
    return {
      kind: 'fallback-required',
      reason: `SURFACE_${suggestion.reason}`,
      candidates,
      suggestionDiagnostics: suggestion.diagnostics,
    };
  }
  const classDominance = selected.pixels / candidates.reduce((sum, candidate) => sum + candidate.pixels, 0);
  const confidence = Math.min(suggestion.diagnostics.confidence, classDominance);
  const surface = composePrintableSurface({
    planes: {
      garment: { width, height, alpha: garmentAlpha },
      printable: { width, height, alpha: suggestion.alpha },
      occluder: { width, height, alpha: occluderAlpha },
    },
    confidence,
  });
  return {
    kind: 'success',
    selected,
    candidates,
    garmentAlpha,
    printableAlpha: surface.printableAlpha,
    occluderAlpha: surface.occluderAlpha,
    surface,
    suggestionDiagnostics: suggestion.diagnostics,
    confidence,
  };
};
