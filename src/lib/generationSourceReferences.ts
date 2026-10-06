import {
  normalizeCloudflareGeneratedImageStoragePath,
  normalizeGeneratedImageStoragePath,
} from './storagePathSafety.ts';
import type { Json } from '../types/database';

/** Opaque, durable identifiers only; never place image bytes or URLs here. */
export interface GenerationSourceReference extends Record<string, Json | undefined> {
  sourceImageId?: string;
  sourceStoragePath?: string;
  sourceFileName?: string;
}

export type GenerationSourceReferencesResult =
  | { ok: true; references: GenerationSourceReference[] }
  | { ok: false; reason: string };

export const GENERATION_SOURCE_REFERENCE_LIMIT = 16;

const SAFE_IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_STORAGE_PATH_LENGTH = 2048;
const MAX_FILE_NAME_LENGTH = 512;
const ALLOWED_FIELDS = new Set(['sourceImageId', 'sourceStoragePath', 'sourceFileName']);
const URL_OR_BYTES_SCHEME = /(?:https?:|data:|blob:)/i;

const invalid = (reason: string): GenerationSourceReferencesResult => ({ ok: false, reason });

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const normalizeReference = (value: unknown): GenerationSourceReference | null => {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !ALLOWED_FIELDS.has(key))) return null;

  const reference: GenerationSourceReference = {};
  if ('sourceImageId' in value) {
    if (typeof value.sourceImageId !== 'string' || !SAFE_IMAGE_ID.test(value.sourceImageId)) return null;
    reference.sourceImageId = value.sourceImageId;
  }
  if ('sourceStoragePath' in value) {
    if (
      typeof value.sourceStoragePath !== 'string'
      || value.sourceStoragePath.length > MAX_STORAGE_PATH_LENGTH
      || URL_OR_BYTES_SCHEME.test(value.sourceStoragePath)
    ) return null;
    const path = normalizeCloudflareGeneratedImageStoragePath(value.sourceStoragePath)
      ?? normalizeGeneratedImageStoragePath(value.sourceStoragePath);
    if (!path || path !== value.sourceStoragePath) return null;
    reference.sourceStoragePath = path;
  }
  if ('sourceFileName' in value) {
    if (
      typeof value.sourceFileName !== 'string'
      || value.sourceFileName.length === 0
      || value.sourceFileName.length > MAX_FILE_NAME_LENGTH
      || value.sourceFileName.trim() !== value.sourceFileName
      || /[\\/\u0000-\u001f\u007f?#]/u.test(value.sourceFileName)
      || URL_OR_BYTES_SCHEME.test(value.sourceFileName)
      || /(?:^|\.)\.{1,2}(?:$|\.)/.test(value.sourceFileName)
    ) return null;
    reference.sourceFileName = value.sourceFileName;
  }

  if (!reference.sourceImageId && !reference.sourceStoragePath) return null;
  return reference;
};

/** Validate and clone an ordered manifest without silently discarding entries. */
export const normalizeGenerationSourceReferences = (value: unknown): GenerationSourceReferencesResult => {
  if (!Array.isArray(value) || value.length < 1 || value.length > GENERATION_SOURCE_REFERENCE_LIMIT) {
    return invalid('invalid_reference_count');
  }
  const references: GenerationSourceReference[] = [];
  for (const item of value) {
    const reference = normalizeReference(item);
    if (!reference) return invalid('invalid_reference');
    references.push(reference);
  }
  return { ok: true, references };
};

/** Encode only a validated manifest. Invalid input is an explicit caller error. */
export const encodeGenerationSourceReferences = (value: unknown): string => {
  const result = normalizeGenerationSourceReferences(value);
  if (!result.ok) throw new Error(`invalid_generation_source_references:${result.reason}`);
  return JSON.stringify(result.references);
};

/**
 * Decode a new manifest, or interpret a legacy scalar source as a singleton.
 * A null manifest means the query predates multi-reference handoff; an empty
 * string is present-but-invalid and therefore fails closed.
 */
export const decodeGenerationSourceReferences = (
  manifest: string | null,
  legacy?: GenerationSourceReference,
): GenerationSourceReferencesResult => {
  if (manifest !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifest);
    } catch {
      return invalid('invalid_manifest_json');
    }
    return normalizeGenerationSourceReferences(parsed);
  }
  if (!legacy || (!legacy.sourceImageId && !legacy.sourceStoragePath)) {
    return { ok: true, references: [] };
  }
  return normalizeGenerationSourceReferences([legacy]);
};
