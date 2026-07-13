export type ModelMatrixVerifierVerdict = 'yes' | 'no';

export interface ModelMatrixSemanticVerification {
  verdict: ModelMatrixVerifierVerdict;
  reason: string;
  model: string;
  checkedAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isVerdict = (value: unknown): value is ModelMatrixVerifierVerdict =>
  value === 'yes' || value === 'no';

export function normalizeModelMatrixSemanticVerification(
  value: unknown
): ModelMatrixSemanticVerification | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate =
    isRecord(value.semanticVerification)
      ? value.semanticVerification
      : isRecord(value.verifier)
        ? value.verifier
        : isRecord(value.verification)
          ? value.verification
          : value;

  const verdict = candidate.verdict;
  const reason = candidate.reason;
  const model = candidate.model;
  const checkedAt = candidate.checkedAt;

  if (!isVerdict(verdict) || typeof reason !== 'string' || typeof model !== 'string' || typeof checkedAt !== 'string') {
    return null;
  }

  return {
    verdict,
    reason,
    model,
    checkedAt,
  };
}
