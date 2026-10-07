/**
 * Explicit client-side primitive for carrying a Heavy preparation proof.
 * This helper does not accept terms, attest rights, or submit a generation.
 */

export type HeavyGenerationPreflight = {
  preparationId: string;
  inputDigest: string;
  expiresAt: string;
  termsVersion: string | null;
  termsDocumentVersion: string | null;
  termsDocumentDigest: string | null;
  rightsVersion: string | null;
  rightsDocumentVersion: string | null;
  rightsDocumentDigest: string | null;
};

export type HeavyGenerationProof = Pick<HeavyGenerationPreflight, 'preparationId' | 'inputDigest'>;
export type HeavyGenerationInput = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;

export function validateHeavyGenerationPreflight(value: unknown): HeavyGenerationPreflight {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('heavy_preparation_invalid');
  const candidate = value as Partial<HeavyGenerationPreflight>;
  if (typeof candidate.preparationId !== 'string' || !UUID.test(candidate.preparationId) ||
      typeof candidate.inputDigest !== 'string' || !DIGEST.test(candidate.inputDigest) ||
      typeof candidate.expiresAt !== 'string' || !Number.isFinite(Date.parse(candidate.expiresAt)) ||
      Date.parse(candidate.expiresAt) <= Date.now()) {
    throw new Error('heavy_preparation_invalid');
  }
  return {
    preparationId: candidate.preparationId,
    inputDigest: candidate.inputDigest.toLowerCase(),
    expiresAt: candidate.expiresAt,
    termsVersion: typeof candidate.termsVersion === 'string' ? candidate.termsVersion : null,
    termsDocumentVersion: typeof candidate.termsDocumentVersion === 'string' ? candidate.termsDocumentVersion : null,
    termsDocumentDigest: typeof candidate.termsDocumentDigest === 'string' ? candidate.termsDocumentDigest.toLowerCase() : null,
    rightsVersion: typeof candidate.rightsVersion === 'string' ? candidate.rightsVersion : null,
    rightsDocumentVersion: typeof candidate.rightsDocumentVersion === 'string' ? candidate.rightsDocumentVersion : null,
    rightsDocumentDigest: typeof candidate.rightsDocumentDigest === 'string' ? candidate.rightsDocumentDigest.toLowerCase() : null,
  };
}

/** Attach only the opaque proof fields required by the Heavy generation API. */
export function attachHeavyGenerationPreflight<T extends HeavyGenerationInput>(
  input: T,
  preflight: HeavyGenerationPreflight,
): T & { preparationId: string; inputDigest: string } {
  const proof = validateHeavyGenerationPreflight(preflight);
  return { ...input, preparationId: proof.preparationId, inputDigest: proof.inputDigest };
}

/** Readable alias for callers that prefer an immutable proof-oriented name. */
export const withHeavyGenerationPreflight = attachHeavyGenerationPreflight;
