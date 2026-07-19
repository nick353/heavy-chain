export const PRINT_DESIGN_HANDOFF_STORAGE_KEY = 'heavy-chain:printing:design-handoff:v1';
export const PRINT_DESIGN_HANDOFF_SCHEMA = 'heavy-chain.print-design-handoff.v1';
export const PRINT_DESIGN_HANDOFF_MAX_BYTES = 16 * 1024;
export const PRINT_DESIGN_HANDOFF_MAX_AGE_MS = 15 * 60 * 1000;
export const PRINT_DESIGN_HANDOFF_MAX_LABEL_LENGTH = 160;
export const PRINT_DESIGN_HANDOFF_MAX_PROMPT_LENGTH = 1_000;

export const TRUSTED_BLANK_GARMENT = Object.freeze({
  url: '/assets/printing/blank-white-tshirt.svg',
  referenceType: 'base' as const,
  assetId: 'bundled-blank-white-tshirt-v1',
});

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface PrintDesignHandoffInput {
  brandId: string;
  resultProvenance: unknown;
  artifactKind?: string;
  imageUrl: string;
  label?: string;
  prompt?: string;
  resultId?: string;
  jobId?: string;
  imageId?: string;
  storagePath?: string;
  createdAt?: number;
}

export interface TrustedPatternsResultProvenance {
  generationLane: 'hosted-gemini' | 'edge-design-gacha';
  originFeature: 'design-gacha';
  sourceWorkspace: 'patterns';
  workflowVersion: 'pattern-preview-local-v1';
  sourceResumePath: '/patterns/workbench';
  sourceMode: 'local-workflow-intake';
  generationStartedAt: number;
}

export interface AcceptedPrintDesignHandoff {
  imageUrl: string;
  label: string;
  prompt: string;
  resultId: string;
  jobId: string;
  imageId?: string;
  storagePath?: string;
}

type WriteResult = { ok: true } | { ok: false; reason: string };
export type ConsumePrintDesignHandoffResult =
  | { status: 'empty'; reason: 'missing' }
  | { status: 'rejected'; reason: string }
  | { status: 'accepted'; design: AcceptedPrintDesignHandoff };

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown, maxLength: number): value is string => (
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
);

const isOptionalString = (value: unknown, maxLength: number): value is string | undefined => (
  value === undefined || (typeof value === 'string' && value.length <= maxLength)
);

/**
 * Patterns may retain a long generation recipe for auditability. The print
 * handoff only needs a human-readable summary, so its producer explicitly
 * bounds those display-only fields before the strict handoff validator runs.
 */
export const normalizePrintDesignHandoffDisplayText = (
  value: string | undefined,
  maxLength: number,
) => value?.slice(0, maxLength);

const isTrustedRemoteImageUrl = (value: unknown): value is string => {
  if (!isNonEmptyString(value, 4_096)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

export const isTrustedPatternsOrigin = (value: unknown): value is Record<string, unknown> & {
  sourceWorkspace: 'patterns';
  workflowVersion: 'pattern-preview-local-v1';
  sourceResumePath: '/patterns/workbench';
  sourceMode: 'local-workflow-intake';
} => (
  isRecord(value)
  && value.sourceWorkspace === 'patterns'
  && value.workflowVersion === 'pattern-preview-local-v1'
  && value.sourceResumePath === '/patterns/workbench'
  && value.sourceMode === 'local-workflow-intake'
);

export const createTrustedPatternsResultProvenance = ({
  featureId,
  sourceReadback,
  generationStartedAt,
  generationLane,
}: {
  featureId: string | undefined;
  sourceReadback: unknown;
  generationStartedAt: number;
  generationLane: unknown;
}): TrustedPatternsResultProvenance | undefined => {
  if (featureId !== 'design-gacha' || !isTrustedPatternsOrigin(sourceReadback)) return undefined;
  if (generationLane !== 'hosted-gemini' && generationLane !== 'edge-design-gacha') return undefined;
  if (!Number.isFinite(generationStartedAt) || generationStartedAt <= 0) return undefined;
  return {
    generationLane,
    originFeature: 'design-gacha',
    sourceWorkspace: sourceReadback.sourceWorkspace,
    workflowVersion: sourceReadback.workflowVersion,
    sourceResumePath: sourceReadback.sourceResumePath,
    sourceMode: sourceReadback.sourceMode,
    generationStartedAt,
  };
};

export const isTrustedPatternsResultProvenance = (
  value: unknown,
): value is TrustedPatternsResultProvenance => (
  isRecord(value)
  && (value.generationLane === 'hosted-gemini' || value.generationLane === 'edge-design-gacha')
  && value.originFeature === 'design-gacha'
  && isTrustedPatternsOrigin(value)
  && typeof value.generationStartedAt === 'number'
  && Number.isFinite(value.generationStartedAt)
  && value.generationStartedAt > 0
);

export const resolveCompletedPatternsResultProvenance = ({
  startedProvenance,
  currentFeatureId,
  currentSourceReadback,
}: {
  startedProvenance: unknown;
  currentFeatureId: string | undefined;
  currentSourceReadback: unknown;
}): TrustedPatternsResultProvenance | undefined => {
  if (!isTrustedPatternsResultProvenance(startedProvenance)) return undefined;
  const current = createTrustedPatternsResultProvenance({
    featureId: currentFeatureId,
    sourceReadback: currentSourceReadback,
    generationStartedAt: startedProvenance.generationStartedAt,
    generationLane: startedProvenance.generationLane,
  });
  return current ? startedProvenance : undefined;
};

export function createTrustedBlankGarmentSelection() {
  return {
    url: TRUSTED_BLANK_GARMENT.url,
    referenceType: TRUSTED_BLANK_GARMENT.referenceType,
  };
}

export function writePrintDesignHandoff(
  storage: StorageLike,
  input: PrintDesignHandoffInput,
  now = Date.now(),
): WriteResult {
  try {
    storage.removeItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY);
  } catch {
    return { ok: false, reason: 'storage_unavailable' };
  }
  if (!isNonEmptyString(input.brandId, 128)) return { ok: false, reason: 'brand_missing' };
  if (!isTrustedPatternsResultProvenance(input.resultProvenance)) {
    return { ok: false, reason: 'origin_invalid' };
  }
  if (input.artifactKind !== undefined && input.artifactKind !== 'image') {
    return { ok: false, reason: 'artifact_invalid' };
  }
  if (!isTrustedRemoteImageUrl(input.imageUrl)) return { ok: false, reason: 'image_url_invalid' };
  if (!isNonEmptyString(input.jobId, 256)) return { ok: false, reason: 'job_id_missing' };
  if (!isNonEmptyString(input.imageId, 256) && !isNonEmptyString(input.storagePath, 1_024)) {
    return { ok: false, reason: 'generated_asset_identity_missing' };
  }
  if (!isOptionalString(input.label, PRINT_DESIGN_HANDOFF_MAX_LABEL_LENGTH)
    || !isOptionalString(input.prompt, PRINT_DESIGN_HANDOFF_MAX_PROMPT_LENGTH)
    || !isOptionalString(input.resultId, 256)) {
    return { ok: false, reason: 'field_oversized' };
  }

  const createdAt = input.createdAt ?? now;
  if (!Number.isFinite(createdAt) || Math.abs(now - createdAt) > 60_000) {
    return { ok: false, reason: 'created_at_invalid' };
  }
  const payload = {
    schema: PRINT_DESIGN_HANDOFF_SCHEMA,
    schemaVersion: 1,
    sourceApp: 'heavy-chain',
    generationLane: input.resultProvenance.generationLane,
    sourceWorkspace: input.resultProvenance.sourceWorkspace,
    workflowVersion: input.resultProvenance.workflowVersion,
    sourceResumePath: input.resultProvenance.sourceResumePath,
    sourceMode: input.resultProvenance.sourceMode,
    originFeature: input.resultProvenance.originFeature,
    generationStartedAt: input.resultProvenance.generationStartedAt,
    brandId: input.brandId,
    createdAt,
    design: {
      imageUrl: input.imageUrl,
      label: input.label || 'Patterns デザイン',
      prompt: input.prompt || '',
      resultId: input.resultId || input.imageId || input.storagePath,
      jobId: input.jobId,
      ...(input.imageId ? { imageId: input.imageId } : {}),
      ...(input.storagePath ? { storagePath: input.storagePath } : {}),
    },
  };
  const raw = JSON.stringify(payload);
  if (new TextEncoder().encode(raw).byteLength > PRINT_DESIGN_HANDOFF_MAX_BYTES) {
    return { ok: false, reason: 'payload_oversized' };
  }
  try {
    storage.setItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY, raw);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'storage_unavailable' };
  }
}

export function consumePrintDesignHandoff(
  storage: StorageLike,
  currentBrandId: string,
  now = Date.now(),
): ConsumePrintDesignHandoffResult {
  let raw: string | null = null;
  try {
    raw = storage.getItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY);
    storage.removeItem(PRINT_DESIGN_HANDOFF_STORAGE_KEY);
  } catch {
    return { status: 'rejected', reason: 'storage_unavailable' };
  }
  if (!raw) return { status: 'empty', reason: 'missing' };
  if (new TextEncoder().encode(raw).byteLength > PRINT_DESIGN_HANDOFF_MAX_BYTES) {
    return { status: 'rejected', reason: 'payload_oversized' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { status: 'rejected', reason: 'payload_invalid' };
  }
  if (!isRecord(payload)
    || payload.schema !== PRINT_DESIGN_HANDOFF_SCHEMA
    || payload.schemaVersion !== 1
    || payload.sourceApp !== 'heavy-chain'
    || (payload.generationLane !== 'hosted-gemini' && payload.generationLane !== 'edge-design-gacha')
    || payload.sourceWorkspace !== 'patterns'
    || payload.workflowVersion !== 'pattern-preview-local-v1'
    || payload.sourceResumePath !== '/patterns/workbench'
    || payload.sourceMode !== 'local-workflow-intake'
    || payload.originFeature !== 'design-gacha'
    || typeof payload.generationStartedAt !== 'number'
    || !Number.isFinite(payload.generationStartedAt)
    || payload.generationStartedAt <= 0) {
    return { status: 'rejected', reason: 'origin_invalid' };
  }
  if (!isNonEmptyString(currentBrandId, 128) || payload.brandId !== currentBrandId) {
    return { status: 'rejected', reason: 'brand_mismatch' };
  }
  if (typeof payload.createdAt !== 'number'
    || !Number.isFinite(payload.createdAt)
    || payload.createdAt > now + 60_000
    || now - payload.createdAt > PRINT_DESIGN_HANDOFF_MAX_AGE_MS) {
    return { status: 'rejected', reason: 'stale' };
  }
  if (!isRecord(payload.design)) return { status: 'rejected', reason: 'design_invalid' };
  const design = payload.design;
  if (!isTrustedRemoteImageUrl(design.imageUrl)
    || !isNonEmptyString(design.label, 160)
    || !isOptionalString(design.prompt, 1_000)
    || !isNonEmptyString(design.resultId, 256)
    || !isNonEmptyString(design.jobId, 256)
    || (!isNonEmptyString(design.imageId, 256) && !isNonEmptyString(design.storagePath, 1_024))) {
    return { status: 'rejected', reason: 'design_invalid' };
  }
  return {
    status: 'accepted',
    design: {
      imageUrl: design.imageUrl,
      label: design.label,
      prompt: design.prompt || '',
      resultId: design.resultId,
      jobId: design.jobId,
      ...(isNonEmptyString(design.imageId, 256) ? { imageId: design.imageId } : {}),
      ...(isNonEmptyString(design.storagePath, 1_024) ? { storagePath: design.storagePath } : {}),
    },
  };
}
