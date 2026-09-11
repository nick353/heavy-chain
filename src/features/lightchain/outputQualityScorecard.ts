export const OUTPUT_QUALITY_SCORECARD_SCHEMA = 'heavy-output-quality-scorecard.v1' as const;

export const OUTPUT_QUALITY_SCORECARD_VERSION = '1' as const;

export const OUTPUT_QUALITY_DIMENSIONS = Object.freeze([
  'apparelFidelity',
  'printPlacement',
  'fittingComposition',
  'composition',
  'artifacts',
  'commercialUsefulness',
] as const);

export type OutputQualityDimension = (typeof OUTPUT_QUALITY_DIMENSIONS)[number];
export type OutputQualityWorkflow = 'fabric-print' | 'ai-fitting' | 'other';
export type OutputQualityScore = 0 | 1 | 2 | 3 | 4;
export type OutputQualityVerdict = 'pass' | 'fail' | 'PENDING_CONFIRMATION';

export interface OutputQualityEvidenceRef {
  readonly surface: 'lightchain' | 'heavy';
  readonly freshness: 'fresh-same-run';
  readonly runId: string;
  readonly inputHash: string;
  readonly artifactPath: string;
}

export interface OutputQualityScorecardInput {
  readonly workflow: OutputQualityWorkflow;
  readonly inputHash: string;
  readonly scores?: Partial<Record<OutputQualityDimension, OutputQualityScore | null>>;
  readonly lightchainEvidence?: OutputQualityEvidenceRef | null;
  readonly heavyEvidence?: OutputQualityEvidenceRef | null;
  readonly reviewedAt?: string | null;
}

export interface OutputQualityScorecard {
  readonly schema: typeof OUTPUT_QUALITY_SCORECARD_SCHEMA;
  readonly version: typeof OUTPUT_QUALITY_SCORECARD_VERSION;
  readonly workflow: OutputQualityWorkflow;
  readonly inputHash: string;
  readonly requiredDimensions: readonly OutputQualityDimension[];
  readonly scores: Readonly<Record<OutputQualityDimension, OutputQualityScore | null>>;
  readonly evidence: Readonly<{
    readonly lightchain: OutputQualityEvidenceRef | null;
    readonly heavy: OutputQualityEvidenceRef | null;
  }>;
  readonly reviewedAt: string | null;
  readonly verdict: OutputQualityVerdict;
}

const REQUIRED_DIMENSIONS: Readonly<Record<OutputQualityWorkflow, readonly OutputQualityDimension[]>> = Object.freeze({
  'fabric-print': Object.freeze([
    'apparelFidelity',
    'printPlacement',
    'composition',
    'artifacts',
    'commercialUsefulness',
  ]) as readonly OutputQualityDimension[],
  'ai-fitting': Object.freeze([
    'apparelFidelity',
    'fittingComposition',
    'composition',
    'artifacts',
    'commercialUsefulness',
  ]) as readonly OutputQualityDimension[],
  other: Object.freeze([
    'apparelFidelity',
    'composition',
    'artifacts',
    'commercialUsefulness',
  ]) as readonly OutputQualityDimension[],
});

const SCORECARD_PASS_THRESHOLD: OutputQualityScore = 3;

function fail(code: string, details?: string): never {
  throw new Error(details ? `${code}:${details}` : code);
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string') fail(code);
  const normalized = value.trim();
  if (!normalized) fail(code);
  return normalized;
}

function isWorkflow(value: unknown): value is OutputQualityWorkflow {
  return value === 'fabric-print' || value === 'ai-fitting' || value === 'other';
}

function isDimension(value: string): value is OutputQualityDimension {
  return (OUTPUT_QUALITY_DIMENSIONS as readonly string[]).includes(value);
}

function isScore(value: unknown): value is OutputQualityScore {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4;
}

function normalizeEvidence(
  evidence: OutputQualityEvidenceRef | null | undefined,
  surface: OutputQualityEvidenceRef['surface'],
  inputHash: string,
): OutputQualityEvidenceRef | null {
  if (evidence == null) return null;
  if (evidence.surface !== surface) fail('output_quality_evidence_surface_mismatch', surface);
  if (evidence.freshness !== 'fresh-same-run') fail('output_quality_evidence_not_fresh_same_run', surface);
  const runId = requiredText(evidence.runId, 'output_quality_evidence_run_id_required');
  const evidenceInputHash = requiredText(evidence.inputHash, 'output_quality_evidence_input_hash_required');
  if (evidenceInputHash !== inputHash) fail('output_quality_evidence_input_hash_mismatch', surface);
  const artifactPath = requiredText(evidence.artifactPath, 'output_quality_evidence_artifact_required');
  return Object.freeze({
    surface,
    freshness: 'fresh-same-run',
    runId,
    inputHash: evidenceInputHash,
    artifactPath,
  });
}

function normalizeScores(
  scores: Partial<Record<OutputQualityDimension, OutputQualityScore | null>> | undefined,
): Readonly<Record<OutputQualityDimension, OutputQualityScore | null>> {
  const source = scores ?? {};
  for (const key of Object.keys(source)) {
    if (!isDimension(key)) fail('output_quality_dimension_unknown', key);
    const value = (source as Record<string, unknown>)[key];
    if (value !== null && value !== undefined && !isScore(value)) {
      fail('output_quality_score_invalid', key);
    }
  }
  const normalized = {} as Record<OutputQualityDimension, OutputQualityScore | null>;
  for (const dimension of OUTPUT_QUALITY_DIMENSIONS) {
    const score = source[dimension];
    normalized[dimension] = score == null ? null : score;
  }
  return Object.freeze(normalized);
}

function normalizeReviewedAt(value: string | null | undefined): string | null {
  if (value == null || value.trim() === '') return null;
  const reviewedAt = requiredText(value, 'output_quality_reviewed_at_invalid');
  if (Number.isNaN(Date.parse(reviewedAt))) fail('output_quality_reviewed_at_invalid');
  return reviewedAt;
}

export function getRequiredOutputQualityDimensions(
  workflow: OutputQualityWorkflow,
): readonly OutputQualityDimension[] {
  if (!isWorkflow(workflow)) fail('output_quality_workflow_invalid');
  return REQUIRED_DIMENSIONS[workflow];
}

export function createOutputQualityScorecard(
  input: OutputQualityScorecardInput,
): OutputQualityScorecard {
  if (!isWorkflow(input?.workflow)) fail('output_quality_workflow_invalid');
  const inputHash = requiredText(input.inputHash, 'output_quality_input_hash_required');
  const requiredDimensions = getRequiredOutputQualityDimensions(input.workflow);
  const scores = normalizeScores(input.scores);
  const lightchain = normalizeEvidence(input.lightchainEvidence, 'lightchain', inputHash);
  const heavy = normalizeEvidence(input.heavyEvidence, 'heavy', inputHash);
  const reviewedAt = normalizeReviewedAt(input.reviewedAt);
  const scoresComplete = requiredDimensions.every((dimension) => isScore(scores[dimension]));
  const evidenceComplete = lightchain !== null && heavy !== null;
  const reviewComplete = reviewedAt !== null;
  const thresholdMet = requiredDimensions.every(
    (dimension) => (scores[dimension] ?? 0) >= SCORECARD_PASS_THRESHOLD,
  );

  let verdict: OutputQualityVerdict = 'PENDING_CONFIRMATION';
  if (scoresComplete && evidenceComplete && reviewComplete) {
    verdict = thresholdMet ? 'pass' : 'fail';
  }

  return Object.freeze({
    schema: OUTPUT_QUALITY_SCORECARD_SCHEMA,
    version: OUTPUT_QUALITY_SCORECARD_VERSION,
    workflow: input.workflow,
    inputHash,
    requiredDimensions,
    scores,
    evidence: Object.freeze({ lightchain, heavy }),
    reviewedAt,
    verdict,
  });
}

export function assertOutputQualityScorecardAccepted(
  scorecard: OutputQualityScorecard,
): OutputQualityScorecard & { readonly verdict: 'pass' } {
  if (!scorecard || scorecard.schema !== OUTPUT_QUALITY_SCORECARD_SCHEMA) {
    fail('output_quality_scorecard_schema_invalid');
  }
  if (scorecard.verdict !== 'pass') fail('output_quality_scorecard_not_accepted', scorecard.verdict);
  return scorecard as OutputQualityScorecard & { readonly verdict: 'pass' };
}
