export const PRINTING_APPROVAL_SCHEMA_VERSION = 'printing-approval-v1' as const;

export const PRINTING_SCORE_AXES = [
  'garmentEdge',
  'printableSurface',
  'warp',
  'foldIntegration',
  'seamOcclusion',
  'designFidelity',
  'materialPlausibility',
  'commercialRealism',
] as const;

export const PRINTING_CRITICAL_SCORE_AXES = [
  'garmentEdge',
  'printableSurface',
  'seamOcclusion',
  'designFidelity',
] as const;

export type PrintingScoreAxis = (typeof PRINTING_SCORE_AXES)[number];
export type PrintingScores = Record<PrintingScoreAxis, number>;
export type PrintingApprovalStratum = 'S1' | 'S2' | 'S3' | 'S4';
export type PrintingDisposition =
  | 'semantic-success'
  | 'explicit-reject'
  | 'exact-fallback'
  | 'manual-fallback'
  | 'not-run';
export type PrintingSurfaceProvenance =
  | 'automatic-semantic'
  | 'manual-surface'
  | 'whole-garment'
  | 'none';
export type PrintingResultMode = 'exact' | 'fabric' | 'surface-conform' | 'none';
export type PrintingCriticalFailureCode =
  | 'skin-spill'
  | 'hair-spill'
  | 'background-spill'
  | 'wrong-panel-print'
  | 'reversed-occlusion'
  | 'design-corruption'
  | 'other';

export type PrintingCriticalFailure = {
  code: PrintingCriticalFailureCode;
  detail?: string;
};

export type PrintingApprovalAssets = {
  garmentSource: string;
  garmentPreview: string;
  artwork: string;
  result: string | null;
};

export type PrintingApprovalCase = {
  id: string;
  stratum: PrintingApprovalStratum;
  label: string;
  category: string;
  view: string;
  material: string;
  challenge: string;
  expectedDisposition: PrintingDisposition;
  observedDisposition: PrintingDisposition;
  observedReasonCode: string | null;
  surfaceProvenance: PrintingSurfaceProvenance;
  resultMode: PrintingResultMode;
  assets: PrintingApprovalAssets;
  scores: PrintingScores | null;
  reviewStatus: 'unreviewed' | 'reviewed';
  criticalFailures: PrintingCriticalFailure[] | null;
};

export type PrintingApprovalManifest = {
  schemaVersion: typeof PRINTING_APPROVAL_SCHEMA_VERSION;
  title: string;
  cases: PrintingApprovalCase[];
};

export type PrintingApprovalIssue = {
  code: string;
  message: string;
  caseId?: string;
  assetRole?: keyof PrintingApprovalAssets;
};

export type PrintingApprovalValidation = {
  invalidIssues: PrintingApprovalIssue[];
  incompleteIssues: PrintingApprovalIssue[];
  qualityFailures: PrintingApprovalIssue[];
};

const DISPOSITIONS = new Set<PrintingDisposition>([
  'semantic-success',
  'explicit-reject',
  'exact-fallback',
  'manual-fallback',
  'not-run',
]);
const PROVENANCES = new Set<PrintingSurfaceProvenance>([
  'automatic-semantic',
  'manual-surface',
  'whole-garment',
  'none',
]);
const MODES = new Set<PrintingResultMode>(['exact', 'fabric', 'surface-conform', 'none']);
const CRITICAL_CODES = new Set<PrintingCriticalFailureCode>([
  'skin-spill',
  'hair-spill',
  'background-spill',
  'wrong-panel-print',
  'reversed-occlusion',
  'design-corruption',
  'other',
]);

const issue = (code: string, message: string, caseId?: string): PrintingApprovalIssue => ({
  code,
  message,
  ...(caseId ? { caseId } : {}),
});

export const sortPrintingApprovalIssues = (issues: PrintingApprovalIssue[]) =>
  [...issues].sort((left, right) =>
    `${left.caseId ?? ''}\u0000${left.assetRole ?? ''}\u0000${left.code}\u0000${left.message}`.localeCompare(
      `${right.caseId ?? ''}\u0000${right.assetRole ?? ''}\u0000${right.code}\u0000${right.message}`,
    ),
  );

export const stableCanonicalJson = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, child]) => child !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value));
};

const validateDispositionMatrix = (
  candidate: PrintingApprovalCase,
  validation: PrintingApprovalValidation,
) => {
  const { invalidIssues, incompleteIssues } = validation;
  const addInvalid = (code: string, message: string) => invalidIssues.push(issue(code, message, candidate.id));

  switch (candidate.observedDisposition) {
    case 'explicit-reject':
      if (candidate.surfaceProvenance !== 'none' || candidate.resultMode !== 'none') {
        addInvalid('DISPOSITION_MATRIX_INVALID', 'explicit-reject requires provenance none and mode none');
      }
      if (typeof candidate.observedReasonCode !== 'string' || !candidate.observedReasonCode.trim()) {
        addInvalid('REJECT_REASON_REQUIRED', 'explicit-reject requires a non-empty reason code');
      }
      if (candidate.assets.result !== null || candidate.scores !== null || candidate.criticalFailures !== null) {
        addInvalid('REJECT_EVIDENCE_NOT_APPLICABLE', 'explicit-reject requires result, scores, and critical failures to be null');
      }
      break;
    case 'not-run':
      if (candidate.surfaceProvenance !== 'none' || candidate.resultMode !== 'none') {
        addInvalid('DISPOSITION_MATRIX_INVALID', 'not-run requires provenance none and mode none');
      }
      if (candidate.assets.result !== null || candidate.scores !== null || candidate.criticalFailures !== null) {
        addInvalid('NOT_RUN_EVIDENCE_NOT_APPLICABLE', 'not-run requires result, scores, and critical failures to be null');
      }
      incompleteIssues.push(issue('CASE_NOT_RUN', 'case has not been run', candidate.id));
      break;
    case 'exact-fallback':
      if (candidate.surfaceProvenance !== 'whole-garment' || candidate.resultMode !== 'exact') {
        addInvalid('DISPOSITION_MATRIX_INVALID', 'exact-fallback requires whole-garment provenance and exact mode');
      }
      break;
    case 'manual-fallback':
      if (
        candidate.surfaceProvenance !== 'manual-surface' ||
        !new Set<PrintingResultMode>(['exact', 'fabric', 'surface-conform']).has(candidate.resultMode)
      ) {
        addInvalid('DISPOSITION_MATRIX_INVALID', 'manual-fallback requires manual-surface provenance and a rendered mode');
      }
      break;
    case 'semantic-success':
      if (
        candidate.surfaceProvenance !== 'automatic-semantic' ||
        !new Set<PrintingResultMode>(['fabric', 'surface-conform']).has(candidate.resultMode)
      ) {
        addInvalid('DISPOSITION_MATRIX_INVALID', 'semantic-success requires automatic-semantic provenance and semantic rendered mode');
      }
      break;
  }
};

const validateScoredEvidence = (
  candidate: PrintingApprovalCase,
  validation: PrintingApprovalValidation,
) => {
  const rendered = !new Set<PrintingDisposition>(['explicit-reject', 'not-run']).has(candidate.observedDisposition);
  if (candidate.observedDisposition === 'explicit-reject' && candidate.reviewStatus !== 'reviewed') {
    validation.incompleteIssues.push(issue('CASE_UNREVIEWED', 'explicit reject has not been reviewed', candidate.id));
  }
  if (!rendered) return;

  if (typeof candidate.assets.result !== 'string' || !candidate.assets.result.trim()) {
    validation.incompleteIssues.push(issue('RESULT_ASSET_MISSING', 'rendered case has no result asset URI', candidate.id));
  }
  if (candidate.reviewStatus !== 'reviewed') {
    validation.incompleteIssues.push(issue('CASE_UNREVIEWED', 'rendered case has not been reviewed', candidate.id));
  }
  if (!candidate.scores) {
    validation.incompleteIssues.push(issue('SCORES_MISSING', 'rendered case has no scores', candidate.id));
  } else {
    const actualAxes = Object.keys(candidate.scores).sort();
    const expectedAxes = [...PRINTING_SCORE_AXES].sort();
    if (actualAxes.length !== expectedAxes.length || actualAxes.some((axis, index) => axis !== expectedAxes[index])) {
      validation.invalidIssues.push(issue('SCORE_AXES_INVALID', 'scores must contain exactly the fixed eight axes', candidate.id));
    }
    const values: number[] = [];
    for (const axis of PRINTING_SCORE_AXES) {
      const value = candidate.scores[axis];
      if (!Number.isFinite(value) || value < 1 || value > 5) {
        validation.invalidIssues.push(issue('SCORE_INVALID', `${axis} must be between 1 and 5`, candidate.id));
      } else {
        values.push(value);
      }
    }
    if (values.length === PRINTING_SCORE_AXES.length) {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      if (mean < 4.2) {
        validation.qualityFailures.push(issue('MEAN_SCORE_BELOW_GATE', `mean score ${mean.toFixed(3)} is below 4.2`, candidate.id));
      }
      if (values.some((value) => value <= 2)) {
        validation.qualityFailures.push(issue('SCORE_VETO', 'at least one score is 2 or below', candidate.id));
      }
      for (const axis of PRINTING_CRITICAL_SCORE_AXES) {
        if (candidate.scores[axis] < 4) {
          validation.qualityFailures.push(issue('CRITICAL_SCORE_BELOW_GATE', `${axis} is below 4`, candidate.id));
        }
      }
    }
  }

  if (!Array.isArray(candidate.criticalFailures)) {
    validation.incompleteIssues.push(issue('CRITICAL_REVIEW_MISSING', 'criticalFailures must be explicitly reviewed', candidate.id));
  } else {
    for (const failure of candidate.criticalFailures) {
      if (!failure || typeof failure !== 'object' || !CRITICAL_CODES.has(failure.code)) {
        validation.invalidIssues.push(issue('CRITICAL_FAILURE_INVALID', 'critical failure code is invalid', candidate.id));
        continue;
      }
      if (failure.detail !== undefined && typeof failure.detail !== 'string') {
        validation.invalidIssues.push(issue('CRITICAL_FAILURE_DETAIL_INVALID', 'critical failure detail must be a string', candidate.id));
      }
      if (failure.code === 'other' && (typeof failure.detail !== 'string' || !failure.detail.trim())) {
        validation.invalidIssues.push(issue('CRITICAL_OTHER_DETAIL_REQUIRED', 'other critical failure requires detail', candidate.id));
      }
      validation.qualityFailures.push(issue('CRITICAL_FAILURE', `${failure.code}${failure.detail ? `: ${failure.detail}` : ''}`, candidate.id));
    }
  }
};

export const validatePrintingApprovalManifest = (input: unknown): {
  manifest: PrintingApprovalManifest | null;
  validation: PrintingApprovalValidation;
} => {
  const validation: PrintingApprovalValidation = {
    invalidIssues: [],
    incompleteIssues: [],
    qualityFailures: [],
  };
  if (!input || typeof input !== 'object') {
    validation.invalidIssues.push(issue('MANIFEST_INVALID', 'manifest must be an object'));
    return { manifest: null, validation };
  }
  const manifest = input as PrintingApprovalManifest;
  if (manifest.schemaVersion !== PRINTING_APPROVAL_SCHEMA_VERSION) {
    validation.invalidIssues.push(issue('SCHEMA_VERSION_INVALID', `schemaVersion must be ${PRINTING_APPROVAL_SCHEMA_VERSION}`));
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 24) {
    validation.invalidIssues.push(issue('CASE_COUNT_INVALID', 'manifest must contain exactly 24 cases'));
    return { manifest, validation };
  }
  const ids = new Set<string>();
  const stratumCounts = new Map<string, number>();
  for (const candidate of manifest.cases) {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string' || !candidate.id.trim()) {
      validation.invalidIssues.push(issue('CASE_INVALID', 'every case requires a non-empty id'));
      continue;
    }
    if (ids.has(candidate.id)) validation.invalidIssues.push(issue('CASE_ID_DUPLICATE', 'case id must be unique', candidate.id));
    ids.add(candidate.id);
    stratumCounts.set(candidate.stratum, (stratumCounts.get(candidate.stratum) ?? 0) + 1);
    if (!new Set(['S1', 'S2', 'S3', 'S4']).has(candidate.stratum)) {
      validation.invalidIssues.push(issue('STRATUM_INVALID', 'stratum must be S1, S2, S3, or S4', candidate.id));
    }
    if (!DISPOSITIONS.has(candidate.expectedDisposition) || !DISPOSITIONS.has(candidate.observedDisposition)) {
      validation.invalidIssues.push(issue('DISPOSITION_INVALID', 'expected and observed dispositions must be recognized', candidate.id));
      continue;
    }
    if (!PROVENANCES.has(candidate.surfaceProvenance) || !MODES.has(candidate.resultMode)) {
      validation.invalidIssues.push(issue('SURFACE_OR_MODE_INVALID', 'surface provenance and result mode must be recognized', candidate.id));
      continue;
    }
    if (
      !candidate.assets ||
      typeof candidate.assets !== 'object' ||
      typeof candidate.assets.garmentSource !== 'string' ||
      !candidate.assets.garmentSource.trim() ||
      typeof candidate.assets.garmentPreview !== 'string' ||
      !candidate.assets.garmentPreview.trim() ||
      typeof candidate.assets.artwork !== 'string' ||
      !candidate.assets.artwork.trim() ||
      (candidate.assets.result !== null && typeof candidate.assets.result !== 'string')
    ) {
      validation.invalidIssues.push(issue('ASSET_URI_REQUIRED', 'garment source, preview, and artwork URIs are required', candidate.id));
      continue;
    }
    if (candidate.observedReasonCode !== null && typeof candidate.observedReasonCode !== 'string') {
      validation.invalidIssues.push(issue('REASON_CODE_INVALID', 'observed reason code must be a string or null', candidate.id));
      continue;
    }
    if (!new Set(['unreviewed', 'reviewed']).has(candidate.reviewStatus)) {
      validation.invalidIssues.push(issue('REVIEW_STATUS_INVALID', 'review status must be unreviewed or reviewed', candidate.id));
      continue;
    }
    if (candidate.scores !== null && (typeof candidate.scores !== 'object' || Array.isArray(candidate.scores))) {
      validation.invalidIssues.push(issue('SCORES_INVALID', 'scores must be an object or null', candidate.id));
      continue;
    }
    if (candidate.criticalFailures !== null && !Array.isArray(candidate.criticalFailures)) {
      validation.invalidIssues.push(issue('CRITICAL_FAILURES_INVALID', 'criticalFailures must be an array or null', candidate.id));
      continue;
    }
    validateDispositionMatrix(candidate, validation);
    validateScoredEvidence(candidate, validation);
    if (candidate.observedDisposition !== 'not-run' && candidate.observedDisposition !== candidate.expectedDisposition) {
      validation.qualityFailures.push(issue('EXPECTED_DISPOSITION_MISMATCH', `expected ${candidate.expectedDisposition}, observed ${candidate.observedDisposition}`, candidate.id));
    }
  }
  for (const stratum of ['S1', 'S2', 'S3', 'S4']) {
    if (stratumCounts.get(stratum) !== 6) {
      validation.invalidIssues.push(issue('STRATUM_COUNT_INVALID', `${stratum} must contain exactly 6 cases`));
    }
  }
  validation.invalidIssues = sortPrintingApprovalIssues(validation.invalidIssues);
  validation.incompleteIssues = sortPrintingApprovalIssues(validation.incompleteIssues);
  validation.qualityFailures = sortPrintingApprovalIssues(validation.qualityFailures);
  return { manifest, validation };
};
