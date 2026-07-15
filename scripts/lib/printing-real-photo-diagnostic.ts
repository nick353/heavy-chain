import { stableCanonicalJson } from '../../src/features/printing/quality/printingApprovalSchema.ts';
import { sha256Hex } from './printing-offline-model-diagnostic.ts';

export const PRINTING_REAL_PHOTO_DIAGNOSTIC_SCHEMA_VERSION =
  'printing-real-photo-offline-diagnostic-v1' as const;
export const PRINTING_REAL_PHOTO_DIAGNOSTIC_CASE_SCHEMA_VERSION =
  'printing-real-photo-offline-diagnostic-case-v1' as const;
export const PRINTING_REAL_PHOTO_DIAGNOSTIC_REPORT_SCHEMA_VERSION =
  'printing-real-photo-offline-diagnostic-report-v1' as const;
export const PRINTING_REAL_PHOTO_DIAGNOSTIC_BANNER_TEXT =
  'REAL PHOTO OFFLINE DIAGNOSTIC / NOT BROWSER / NOT APPROVAL / NOT QUALITY CERTIFICATION / cutoutParity=false' as const;

export const PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS = Object.freeze({
  synthetic: false,
  realPhoto: true,
  browserParity: false,
  cutoutPipelineParity: false,
  userApproval: false,
  approvalEligible: false,
} as const);

export const PRINTING_REAL_PHOTO_GUARDED_RISK_TAGS = Object.freeze([
  'multiple-garments',
  'two-piece',
  'small-printable-area',
  'frame-crop',
  'extreme-crop',
  'garment-detail',
  'reflective',
  'specular',
] as const);

export type PrintingRealPhotoRiskTag =
  | (typeof PRINTING_REAL_PHOTO_GUARDED_RISK_TAGS)[number]
  | 'on-model'
  | 'drape'
  | 'pleats'
  | 'texture'
  | 'occlusion';

export type PrintingRealPhotoManifestCase = Readonly<{
  id: string;
  label: string;
  category: string;
  view: string;
  challenge: string;
  pageUrl: string;
  author: string;
  license: string;
  normalizedPath: string;
  normalizedBytes: number;
  normalizedWidth: number;
  normalizedHeight: number;
  normalizedSha256: string;
  originalPath: string;
  originalBytes: number;
  originalWidth: number;
  originalHeight: number;
  originalSha256: string;
  riskTags: readonly PrintingRealPhotoRiskTag[];
  expectedSafeOutcome: 'manual-review-required' | 'fallback-required';
}>;

export type PrintingRealPhotoExecutionManifest = Readonly<{
  schemaVersion: 'printing-real-photo-execution-manifest-v1';
  status: 'immutable-input-snapshot';
  requestedCaseCount: 12;
  availableCaseCount: 10;
  sourceManifestPath: string;
  sourceManifestSha256: string;
  downloadReadbackPath: string;
  downloadReadbackSha256: string;
  pending: readonly Readonly<{ id: string; exactBlocker: string }>[];
  cases: readonly PrintingRealPhotoManifestCase[];
}>;

const guardedRiskTags = new Set<string>(PRINTING_REAL_PHOTO_GUARDED_RISK_TAGS);

export const classifyRealPhotoSafety = ({
  riskTags,
  suggestionKind,
  surfaceKind,
}: {
  riskTags: readonly string[];
  suggestionKind: 'success' | 'fallback-required';
  surfaceKind: 'success' | 'ood' | 'not-run';
}) => {
  const pipelineSuccess = suggestionKind === 'success' && surfaceKind === 'success';
  const triggeringRiskTags = riskTags.filter((tag) => guardedRiskTags.has(tag));
  if (pipelineSuccess && triggeringRiskTags.length > 0) {
    return Object.freeze({
      pipelineSuccess,
      falseSuccess: true,
      safetyDisposition: 'unsafe-silent-success' as const,
      falseSuccessReasons: Object.freeze(triggeringRiskTags.map((tag) => `guarded-risk:${tag}`)),
    });
  }
  if (suggestionKind === 'fallback-required') {
    return Object.freeze({
      pipelineSuccess: false,
      falseSuccess: false,
      safetyDisposition: 'fallback-required' as const,
      falseSuccessReasons: Object.freeze([] as string[]),
    });
  }
  if (surfaceKind === 'ood') {
    return Object.freeze({
      pipelineSuccess: false,
      falseSuccess: false,
      safetyDisposition: 'ood-review-required' as const,
      falseSuccessReasons: Object.freeze([] as string[]),
    });
  }
  return Object.freeze({
    pipelineSuccess,
    falseSuccess: false,
    safetyDisposition: 'manual-review-required' as const,
    falseSuccessReasons: Object.freeze([] as string[]),
  });
};

export const realPhotoManifestDigest = (manifest: PrintingRealPhotoExecutionManifest) =>
  sha256Hex(stableCanonicalJson(manifest));

export const buildRealPhotoDiagnosticBannerSvg = () => Buffer.from(
  `<svg width="1440" height="128" xmlns="http://www.w3.org/2000/svg">
    <rect width="1440" height="128" fill="#12306b"/>
    <rect x="16" y="16" width="1408" height="96" rx="20" fill="#1d4ed8" stroke="#60a5fa" stroke-width="2"/>
    <text x="44" y="76" fill="white" font-family="Arial" font-size="20" font-weight="700" textLength="1340" lengthAdjust="spacingAndGlyphs">${PRINTING_REAL_PHOTO_DIAGNOSTIC_BANNER_TEXT}</text>
  </svg>`,
);

export const buildRealPhotoCaseDigest = (result: Record<string, unknown>) =>
  sha256Hex(stableCanonicalJson(result));
