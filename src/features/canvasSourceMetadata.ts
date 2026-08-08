/**
 * Metadata that lets a Canvas image be traced back to the exact bytes that
 * were uploaded without persisting a local path, filename, object URL, or
 * data URL. Keep this contract deliberately small for local persistence and
 * deterministic readback/tests; the digest remains observational metadata,
 * not proof of ownership or consent.
 */
export interface CanvasSourceIdentity {
  kind: 'local-upload' | string;
  hash: string;
}

export interface CanvasSourceRevision {
  algorithm: 'sha-256';
  hash: string;
  revision: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface CanvasSourceReadback extends CanvasSourceRevision {
  sourceIdentity: CanvasSourceIdentity;
  status: 'verified' | 'mismatch' | 'unavailable';
  /** Hash facts describe bytes only; they are not proof of ownership or consent. */
  provenance: 'unverified';
}

export interface CanvasSourceMetadata {
  sourceIdentity: CanvasSourceIdentity;
  sourceRevision: CanvasSourceRevision;
  sourceReadback: CanvasSourceReadback;
}

const FORBIDDEN_METADATA_KEYS = new Set([
  'path',
  'filepath',
  'filename',
  'name',
  'url',
  'src',
  'dataurl',
  'objecturl',
  'raw',
  'rawbytes',
  'bytes',
  'blob',
  'arraybuffer',
  'content',
  'payload',
  'exif',
  'exifdata',
  'exifmetadata',
]);

const DATA_URL_PATTERN = /^data:/i;

/** Convert an ArrayBuffer to a stable lowercase hex digest. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('canvas_source_hash_unavailable');
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Build source metadata from the exact bytes supplied by the File object.
 * `fileName` is intentionally not accepted, so callers cannot accidentally
 * persist a local filename while constructing the metadata.
 */
export async function buildLocalUploadSourceMetadata(
  file: Pick<Blob, 'arrayBuffer' | 'size' | 'type'>,
  dimensions: { width: number; height: number },
): Promise<CanvasSourceMetadata> {
  const bytes = await file.arrayBuffer();
  if (Number.isFinite(file.size) && file.size !== bytes.byteLength) {
    throw new Error('canvas_source_bytes_changed');
  }
  const hash = await sha256Hex(bytes);
  const candidateMimeType = typeof file.type === 'string' ? file.type.trim().toLowerCase() : '';
  const mimeType = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(candidateMimeType)
    ? candidateMimeType
    : 'application/octet-stream';
  const width = Math.max(1, Math.round(dimensions.width));
  const height = Math.max(1, Math.round(dimensions.height));
  const sizeBytes = bytes.byteLength;
  const revision = `sha256:${hash}`;
  const sourceIdentity: CanvasSourceIdentity = { kind: 'local-upload', hash };
  const sourceRevision: CanvasSourceRevision = {
    algorithm: 'sha-256',
    hash,
    revision,
    mimeType,
    width,
    height,
    sizeBytes,
  };

  return {
    sourceIdentity,
    sourceRevision,
    sourceReadback: {
      ...sourceRevision,
      sourceIdentity,
      status: 'verified',
      provenance: 'unverified',
    },
  };
}

/**
 * Sanitize untrusted source metadata before it is persisted.  Data URLs and
 * forbidden local-file fields are dropped recursively; legal-safety and
 * unrelated Canvas metadata are not passed through this helper and therefore
 * remain untouched by source metadata enrichment.
 */
export function sanitizeCanvasSourceMetadata(value: unknown): unknown {
  if (typeof value === 'string') return DATA_URL_PATTERN.test(value) ? undefined : value;
  if (Array.isArray(value)) return value.map(sanitizeCanvasSourceMetadata).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.replace(/[\s_-]/g, '').toLowerCase();
    if (FORBIDDEN_METADATA_KEYS.has(normalizedKey)) continue;
    const sanitized = sanitizeCanvasSourceMetadata(entry);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

export function sourceRevisionMatches(
  expected: Pick<CanvasSourceRevision, 'revision' | 'hash'> | null | undefined,
  actual: Pick<CanvasSourceRevision, 'revision' | 'hash'> | null | undefined,
): boolean {
  if (!expected || !actual) return false;
  return expected.revision === actual.revision && expected.hash === actual.hash;
}
