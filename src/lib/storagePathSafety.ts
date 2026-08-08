/**
 * Pure helpers for generated-image storage references.
 *
 * These checks are intentionally independent of Supabase so callers can
 * validate an untrusted path before URL parsing or any storage request.
 */

export type GeneratedImageStoragePathFailureCode =
  | 'empty_path'
  | 'malformed_percent_encoding'
  | 'path_traversal'
  | 'alternate_bucket_prefix'
  | 'invalid_path';

export type GeneratedImageStoragePathResolution =
  | { ok: true; path: string }
  | { ok: false; code: GeneratedImageStoragePathFailureCode };

const MALFORMED_PERCENT_ENCODING = /%(?![0-9a-f]{2})/i;
const ENCODED_PATH_COMPONENT = /%(?:2e|2f|5c)/i;
const PATH_TRAVERSAL_SEGMENT = /(?:^|[/\\])\.\.(?:[/\\]|$)/;
const ALTERNATE_BUCKET_PREFIX = /^(?:generated-images(?:\/|$)|public\/generated-images(?:\/|$)|storage\/v1\/object\/)/i;
const SIGNED_IMAGE_ROUTE = /\/storage\/v1\/object\/sign\/generated-images(?:\/([^?#]*))?(?=$)/i;
const HAS_SIGNED_IMAGE_ROUTE = /\/storage\/v1\/object\/sign\/generated-images(?:\/|$)/i;
const OPAQUE_IMAGE_SCHEME = /^(?:data|blob):/i;

/**
 * Return the raw URL pathname without invoking URL parsing. This keeps dot
 * segments intact while ensuring a signed-route marker in query/fragment
 * data cannot be mistaken for the actual image pathname.
 */
const extractRawPathname = (source: string): string => {
  const scheme = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i.exec(source);
  const authorityEnd = scheme ? scheme[0].length : source.startsWith('//')
    ? (() => {
      const end = source.slice(2).search(/[/?#]/);
      return end < 0 ? source.length : end + 2;
    })()
    : 0;
  const remainder = source.slice(authorityEnd);
  const delimiter = remainder.search(/[?#]/);
  return delimiter < 0 ? remainder : remainder.slice(0, delimiter);
};

const decodeStoragePath = (value: string): string | null => {
  let decoded = value;
  // Decode repeatedly so nested encoding cannot evade the check.
  for (let index = 0; index < 8; index += 1) {
    if (MALFORMED_PERCENT_ENCODING.test(decoded) || ENCODED_PATH_COMPONENT.test(decoded)) return null;
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  return /%[0-9a-f]{2}/i.test(decoded) ? null : decoded;
};

/** Normalize a generated-images object path for local use. */
export const resolveGeneratedImageStoragePath = (source: unknown): GeneratedImageStoragePathResolution => {
  if (typeof source !== 'string') return { ok: false, code: 'invalid_path' };
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, code: 'empty_path' };
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) {
    return { ok: false, code: 'invalid_path' };
  }
  if (MALFORMED_PERCENT_ENCODING.test(trimmed)) {
    return { ok: false, code: 'malformed_percent_encoding' };
  }
  if (ALTERNATE_BUCKET_PREFIX.test(trimmed)) {
    return { ok: false, code: 'alternate_bucket_prefix' };
  }
  // Encoded separators are ambiguous after URL decoding and can turn a safe
  // segment into traversal, so reject them instead of guessing.
  if (ENCODED_PATH_COMPONENT.test(trimmed)) {
    return { ok: false, code: 'path_traversal' };
  }
  const decoded = decodeStoragePath(trimmed);
  if (!decoded || decoded.includes('\\') || decoded.includes('?') || decoded.includes('#')) {
    return { ok: false, code: 'invalid_path' };
  }
  if (PATH_TRAVERSAL_SEGMENT.test(decoded) || decoded.startsWith('/') || decoded.endsWith('/')) {
    return { ok: false, code: 'path_traversal' };
  }
  if (ALTERNATE_BUCKET_PREFIX.test(decoded)) {
    return { ok: false, code: 'alternate_bucket_prefix' };
  }
  const segments = decoded.split('/');
  if (segments.some((segment) => !segment || segment === '.')) {
    return { ok: false, code: 'invalid_path' };
  }
  return { ok: true, path: decoded };
};

export const normalizeGeneratedImageStoragePath = (source: unknown): string | null => {
  const result = resolveGeneratedImageStoragePath(source);
  return result.ok ? result.path : null;
};

export const isSafeGeneratedImageStoragePath = (source: unknown): boolean => (
  resolveGeneratedImageStoragePath(source).ok
);

export const isLocalWorkspaceStoragePath = (source: unknown): boolean => (
  typeof source === 'string' && /^(?:local[/:])/i.test(source.trim())
);

export const isDirectImageUrl = (source: unknown): boolean => (
  typeof source === 'string' && /^(?:https?:|data:)/i.test(source.trim())
);

export const isBlobImageUrl = (source: unknown): boolean => (
  typeof source === 'string' && /^blob:/i.test(source.trim())
);

export const isPreservableImageUrl = (source: unknown): boolean => (
  isDirectImageUrl(source) || isBlobImageUrl(source)
);

/**
 * Extract a canonical path from a signed route without first constructing a
 * URL. URL parsers normalize dot segments, so validating the raw capture is
 * required to reject `tenant/../other` safely.
 */
export const extractGeneratedImageStoragePath = (source: unknown): string | null => {
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  if (!trimmed) return null;
  if (OPAQUE_IMAGE_SCHEME.test(trimmed)) return null;
  const match = SIGNED_IMAGE_ROUTE.exec(extractRawPathname(trimmed));
  if (!match?.[1]) return null;
  return normalizeGeneratedImageStoragePath(match[1]);
};

export const hasGeneratedImageSignedRoute = (source: unknown): boolean => (
  typeof source === 'string'
  && !OPAQUE_IMAGE_SCHEME.test(source.trim())
  && HAS_SIGNED_IMAGE_ROUTE.test(extractRawPathname(source.trim()))
);

export const hasGeneratedImageSignedPathCapture = (source: unknown): boolean => (
  typeof source === 'string'
  && !OPAQUE_IMAGE_SCHEME.test(source.trim())
  && Boolean(SIGNED_IMAGE_ROUTE.exec(extractRawPathname(source.trim()))?.[1])
);

export type GeneratedImageReferenceKind =
  | 'empty'
  | 'local'
  | 'data'
  | 'blob'
  | 'direct'
  | 'signed'
  | 'storage_path'
  | 'legacy';

export type GeneratedImageReference = {
  kind: GeneratedImageReferenceKind;
  canonicalPath: string | null;
};

/** Classify a storage_path/image_url-style reference without side effects. */
export const classifyGeneratedImageReference = (source: unknown): GeneratedImageReference => {
  if (typeof source !== 'string' || !source.trim()) return { kind: 'empty', canonicalPath: null };
  const value = source.trim();
  if (isLocalWorkspaceStoragePath(value)) return { kind: 'local', canonicalPath: null };
  if (/^data:/i.test(value)) return { kind: 'data', canonicalPath: null };
  if (isBlobImageUrl(value)) return { kind: 'blob', canonicalPath: null };
  if (hasGeneratedImageSignedRoute(value)) {
    return { kind: 'signed', canonicalPath: extractGeneratedImageStoragePath(value) };
  }
  if (/^(?:https?:|\/\/)/i.test(value)) return { kind: 'direct', canonicalPath: null };
  const canonicalPath = normalizeGeneratedImageStoragePath(value);
  return canonicalPath ? { kind: 'storage_path', canonicalPath } : { kind: 'legacy', canonicalPath: null };
};

export type ImageUrlCarrier = {
  storage_path?: unknown;
  image_url?: string | null;
};

/**
 * Remove stale signed URLs only when a row retains a validated canonical
 * remote storage path. Local, legacy, data, blob, and direct references stay
 * untouched so Gallery fallback remains backward-compatible.
 */
export const clearCanonicalRemoteImageUrls = <T extends ImageUrlCarrier>(images: readonly T[]): T[] => (
  images.map((image) => {
    const storageReference = classifyGeneratedImageReference(image.storage_path);
    const imageUrlReference = classifyGeneratedImageReference(image.image_url);
    const shouldClear = storageReference.kind === 'signed'
      || (storageReference.kind !== 'empty' && imageUrlReference.kind === 'signed');
    return shouldClear
      ? { ...image, image_url: null }
      : image;
  })
);
