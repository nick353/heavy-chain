import type { WorkspaceArtifact } from './localWorkspaceArtifacts';
import type { MaterialReferenceState } from './workspaceMaterialReferences';

export type FittingResumeMaterial = {
  artifactId: string;
  materialReference: MaterialReferenceState;
};

export type FittingDraftMaterial = {
  artifactId: string;
  materialReference: MaterialReferenceState;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isResumableImageUrl = (value: unknown): value is string => (
  typeof value === 'string'
  && /^(?:data:image\/|blob:|local:|\/|\.\.?\/)/i.test(value.trim())
);

const readString = (value: unknown, fallback: string) => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const readOptionalString = (value: unknown) => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

const readFirstOptionalString = (value: unknown, keys: readonly string[]) => {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const candidate = readOptionalString(value[key]);
    if (candidate) return candidate;
  }
  return null;
};

const readStringArray = (value: unknown) => (
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
    : []
);

const readMaterialReference = (
  value: unknown,
  options: {
    allowSourceOnly?: boolean;
    fallbackSourceImageId?: string | null;
    fallbackSourceStoragePath?: string | null;
  } = {},
): MaterialReferenceState | null => {
  if (!isRecord(value)) return null;
  const sourceImageId = readOptionalString(value.sourceImageId) ?? options.fallbackSourceImageId ?? null;
  const sourceStoragePath = readOptionalString(value.sourceStoragePath) ?? options.fallbackSourceStoragePath ?? null;
  const sourceImageUrl = isResumableImageUrl(value.imageUrl) ? value.imageUrl.trim() : '';
  const extractedImageUrl = isResumableImageUrl(value.extractedImageUrl)
    ? value.extractedImageUrl.trim()
    : '';
  const hasCutoutEvidence = Boolean(extractedImageUrl)
    && value.extractedLayerReady === true
    && value.nextStepReady === true;
  const sourceOnly = options.allowSourceOnly === true
    && Boolean(sourceStoragePath)
    && !sourceImageUrl
    && !hasCutoutEvidence;
  const canRestoreCutout = hasCutoutEvidence;
  const hasDurableSourceIdentity = Boolean(sourceImageUrl)
    || (options.allowSourceOnly === true && Boolean(sourceStoragePath));
  if (!hasDurableSourceIdentity) return null;
  if (!sourceOnly && !canRestoreCutout) return null;
  const maskEngine = readOptionalString(value.maskEngine);
  if (canRestoreCutout && (!maskEngine || maskEngine.startsWith('browser-canvas-'))) return null;

  return {
    imageUrl: sourceImageUrl,
    fileName: readString(value.fileName, '衣服素材'),
    sourceImageId,
    sourceStoragePath,
    materialKind: readString(value.materialKind, '衣服'),
    maskMode: value.maskMode === 'manual' || value.maskMode === 'keep' ? value.maskMode : 'auto',
    activeLayer: readString(value.activeLayer, 'base'),
    placement: readString(value.placement, '中央'),
    scale: typeof value.scale === 'number' && Number.isFinite(value.scale) ? value.scale : 100,
    note: readString(value.note, ''),
    maskCandidates: readStringArray(value.maskCandidates),
    selectedMaskCandidate: readOptionalString(value.selectedMaskCandidate),
    extractedLayerReady: canRestoreCutout,
    extractedImageUrl: canRestoreCutout ? extractedImageUrl : null,
    cutoutBounds: isRecord(value.cutoutBounds)
      && typeof value.cutoutBounds.x === 'number'
      && typeof value.cutoutBounds.y === 'number'
      && typeof value.cutoutBounds.width === 'number'
      && typeof value.cutoutBounds.height === 'number'
      ? {
        x: value.cutoutBounds.x,
        y: value.cutoutBounds.y,
        width: value.cutoutBounds.width,
        height: value.cutoutBounds.height,
      }
      : null,
    cutoutOutputSize: isRecord(value.cutoutOutputSize)
      && typeof value.cutoutOutputSize.width === 'number'
      && typeof value.cutoutOutputSize.height === 'number'
      ? { width: value.cutoutOutputSize.width, height: value.cutoutOutputSize.height }
      : null,
    cutoutDataUrlBytes: typeof value.cutoutDataUrlBytes === 'number' ? value.cutoutDataUrlBytes : null,
    cutoutMaxDataUrlBytes: typeof value.cutoutMaxDataUrlBytes === 'number' ? value.cutoutMaxDataUrlBytes : null,
    cutoutStoragePolicy: value.cutoutStoragePolicy === 'bounded-local-canvas-data-url-v1'
      || value.cutoutStoragePolicy === 'bounded-local-ai-cutout-data-url-v1'
      ? value.cutoutStoragePolicy
      : null,
    maskEngine: canRestoreCutout ? maskEngine : null,
    nextStepReady: canRestoreCutout,
  };
};

const resumeArtifactMatchesJob = (artifact: WorkspaceArtifact, jobId: string) => (
  artifact.featureType === 'model-matrix'
  && (
    artifact.sourceJobId === jobId
    || artifact.metadata.sourceJobId === jobId
    || artifact.metadata.remoteJobId === jobId
  )
);

/**
 * Recover only a locally durable, high-precision fitting input from the same
 * brand/job. Expiring provider URLs and browser-canvas previews are rejected.
 */
export const readFittingResumeMaterial = (
  artifacts: WorkspaceArtifact[],
  jobId: string | null | undefined,
): FittingResumeMaterial | null => {
  const normalizedJobId = jobId?.trim();
  if (!normalizedJobId) return null;

  const candidates = artifacts
    .filter((artifact) => resumeArtifactMatchesJob(artifact, normalizedJobId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  for (const artifact of candidates) {
    const materialReference = readMaterialReference(artifact.metadata.materialReference);
    if (materialReference) return { artifactId: artifact.id, materialReference };
    const references = artifact.metadata.materialReferences;
    if (Array.isArray(references)) {
      const first = references.map((value) => readMaterialReference(value)).find((item): item is MaterialReferenceState => Boolean(item));
      if (first) return { artifactId: artifact.id, materialReference: first };
    }
  }

  return null;
};

const draftArtifactMatches = (artifact: WorkspaceArtifact) => (
  artifact.featureType === 'fitting-background-draft'
  && artifact.metadata.feature === 'fitting-background-draft'
);

/**
 * Recover the latest local Fitting draft without claiming that a cutout was
 * durable. Source-only drafts are valid and ask the UI to re-sign/re-cutout;
 * only a resumable local/blob cutout is restored as ready for the next step.
 */
export const readFittingDraftMaterial = (
  artifacts: WorkspaceArtifact[],
): FittingDraftMaterial | null => {
  const candidates = artifacts
    .filter(draftArtifactMatches)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  for (const artifact of candidates) {
    const materialReference = readMaterialReference(artifact.metadata.materialReference, {
      allowSourceOnly: true,
      fallbackSourceImageId: readFirstOptionalString(artifact.metadata, ['sourceImageId', 'imageId']),
      fallbackSourceStoragePath: readFirstOptionalString(artifact.metadata, [
        'sourceStoragePath',
        'storagePath',
        'remoteStoragePath',
      ]),
    });
    if (materialReference) return { artifactId: artifact.id, materialReference };
  }

  return null;
};
