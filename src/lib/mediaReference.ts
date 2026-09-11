/**
 * Provider-neutral identity for a stored media object.
 *
 * This module only describes and validates references. It deliberately does
 * not import a storage client or perform provider reads/writes.
 */

export const MEDIA_PROVIDERS = ['cloudflare_r2'] as const;
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];

export const DEFAULT_MEDIA_PROVIDER_ORDER: readonly MediaProvider[] = MEDIA_PROVIDERS;

export type MediaReference = {
  provider: MediaProvider;
  bucket: string;
  objectPath: string;
  contentType: string;
  size: number;
  sha256: string;
  version: number;
};

export type MediaReferenceInput = {
  provider: unknown;
  bucket: unknown;
  objectPath: unknown;
  contentType: unknown;
  size: unknown;
  sha256: unknown;
  version: unknown;
};

export type MediaObjectPathValidationCode =
  | 'object_path_invalid_type'
  | 'object_path_empty'
  | 'object_path_malformed_percent_encoding'
  | 'object_path_encoded_separator'
  | 'object_path_traversal'
  | 'object_path_invalid';

export type MediaObjectPathValidation =
  | { ok: true; path: string }
  | { ok: false; code: MediaObjectPathValidationCode };

export type MediaProviderOrderValidationCode =
  | 'provider_order_empty'
  | 'provider_order_invalid_provider'
  | 'provider_order_duplicate';

export type MediaProviderOrderValidation =
  | { ok: true; order: MediaProvider[] }
  | { ok: false; code: MediaProviderOrderValidationCode };

export type MediaReferenceValidationCode =
  | 'invalid_provider'
  | 'invalid_bucket'
  | MediaObjectPathValidationCode
  | 'invalid_content_type'
  | 'invalid_size'
  | 'invalid_sha256'
  | 'invalid_version';

export class MediaReferenceValidationError extends Error {
  readonly code: MediaReferenceValidationCode | MediaProviderOrderValidationCode;

  constructor(code: MediaReferenceValidationCode | MediaProviderOrderValidationCode) {
    super(code);
    this.name = 'MediaReferenceValidationError';
    this.code = code;
  }
}

const MALFORMED_PERCENT_ENCODING = /%(?![0-9a-f]{2})/i;
const ENCODED_PATH_COMPONENT = /%(?:2e|2f|5c)/i;
const PATH_TRAVERSAL_SEGMENT = /(?:^|[/\\])\.\.(?:[/\\]|$)/;
const BUCKET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONTENT_TYPE = /^[^\s/]+\/[^\s;]+(?:\s*;\s*[^\r\n]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/i;

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
};

const decodeObjectPath = (value: string): string | null => {
  let decoded = value;
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

/** Normalize and validate a provider-independent object path. */
export const validateMediaObjectPath = (source: unknown): MediaObjectPathValidation => {
  if (typeof source !== 'string') return { ok: false, code: 'object_path_invalid_type' };

  const trimmed = source.trim().normalize('NFC');
  if (!trimmed) return { ok: false, code: 'object_path_empty' };
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) {
    return { ok: false, code: 'object_path_invalid' };
  }
  if (MALFORMED_PERCENT_ENCODING.test(trimmed)) {
    return { ok: false, code: 'object_path_malformed_percent_encoding' };
  }
  if (ENCODED_PATH_COMPONENT.test(trimmed)) {
    return { ok: false, code: 'object_path_encoded_separator' };
  }

  const decoded = decodeObjectPath(trimmed);
  if (!decoded || hasControlCharacter(decoded) || decoded.includes('\\') || decoded.includes('?') || decoded.includes('#')) {
    return { ok: false, code: 'object_path_invalid' };
  }
  if (decoded.startsWith('/') || decoded.endsWith('/') || PATH_TRAVERSAL_SEGMENT.test(decoded)) {
    return { ok: false, code: 'object_path_traversal' };
  }

  const segments = decoded.split('/');
  if (segments.some((segment) => !segment || segment === '.')) {
    return { ok: false, code: 'object_path_invalid' };
  }
  return { ok: true, path: decoded };
};

export const normalizeMediaObjectPath = (source: unknown): string | null => {
  const result = validateMediaObjectPath(source);
  return result.ok ? result.path : null;
};

/** Normalize and validate an explicit provider read order. */
export const validateMediaProviderOrder = (order: readonly unknown[]): MediaProviderOrderValidation => {
  if (order.length === 0) return { ok: false, code: 'provider_order_empty' };

  const normalized: MediaProvider[] = [];
  for (const provider of order) {
    if (!MEDIA_PROVIDERS.includes(provider as MediaProvider)) {
      return { ok: false, code: 'provider_order_invalid_provider' };
    }
    const typedProvider = provider as MediaProvider;
    if (normalized.includes(typedProvider)) {
      return { ok: false, code: 'provider_order_duplicate' };
    }
    normalized.push(typedProvider);
  }
  return { ok: true, order: normalized };
};

export const normalizeMediaProviderOrder = (order: readonly unknown[]): MediaProvider[] => {
  const result = validateMediaProviderOrder(order);
  if (!result.ok) throw new MediaReferenceValidationError(result.code);
  return result.order;
};

const validateBucket = (source: unknown): string | null => {
  if (typeof source !== 'string') return null;
  const bucket = source.trim().normalize('NFC');
  return BUCKET_NAME.test(bucket) ? bucket : null;
};

const validateContentType = (source: unknown): string | null => {
  if (typeof source !== 'string') return null;
  const contentType = source.trim();
  return CONTENT_TYPE.test(contentType) ? contentType : null;
};

/** Build a validated, normalized media reference without touching storage. */
export const createMediaReference = (input: MediaReferenceInput): MediaReference => {
  if (!MEDIA_PROVIDERS.includes(input.provider as MediaProvider)) {
    throw new MediaReferenceValidationError('invalid_provider');
  }

  const bucket = validateBucket(input.bucket);
  if (!bucket) throw new MediaReferenceValidationError('invalid_bucket');

  const objectPath = validateMediaObjectPath(input.objectPath);
  if (!objectPath.ok) throw new MediaReferenceValidationError(objectPath.code);

  const contentType = validateContentType(input.contentType);
  if (!contentType) throw new MediaReferenceValidationError('invalid_content_type');

  if (typeof input.size !== 'number' || !Number.isSafeInteger(input.size) || input.size < 0) {
    throw new MediaReferenceValidationError('invalid_size');
  }

  if (typeof input.sha256 !== 'string' || !SHA256.test(input.sha256.trim())) {
    throw new MediaReferenceValidationError('invalid_sha256');
  }

  if (typeof input.version !== 'number' || !Number.isSafeInteger(input.version) || input.version < 1) {
    throw new MediaReferenceValidationError('invalid_version');
  }

  return {
    provider: input.provider as MediaProvider,
    bucket,
    objectPath: objectPath.path,
    contentType,
    size: input.size,
    sha256: input.sha256.trim().toLowerCase(),
    version: input.version,
  };
};

/**
 * Select the first available reference in the caller-supplied provider order.
 * Providers absent from the order are intentionally not considered.
 */
export const selectMediaReference = (
  references: readonly MediaReference[],
  providerOrder: readonly unknown[],
): MediaReference | null => {
  const order = normalizeMediaProviderOrder(providerOrder);
  for (const provider of order) {
    const reference = references.find((candidate) => candidate.provider === provider);
    if (reference) return reference;
  }
  return null;
};
