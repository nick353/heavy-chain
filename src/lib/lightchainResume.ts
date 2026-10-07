import type { WorkspaceArtifact } from './localWorkspaceArtifacts';
import { normalizeCloudflareGeneratedImageStoragePath, normalizeGeneratedImageStoragePath } from './storagePathSafety.ts';
import type { Json } from '../types/database';
import { isLocalCanvasAssetReference } from './canvasLocalAssets.ts';
import { sanitizeCanvasSourceMetadata, type CanvasSourceMetadata } from '../features/canvasSourceMetadata.ts';

export type LightchainResumeSlot = {
  key: 'primary' | 'secondary';
  name: string;
  kind: string;
  imageUrl: string;
  sourceImageId?: string | null;
  sourceStoragePath?: string | null;
  sourceMetadata?: CanvasSourceMetadata;
  persistenceStatus?: 'persistent' | 'session-only' | 'unknown';
};

export type LightchainPrintDesignState = { version: 1; mode: 'guide' | 'no-guide'; style: string; prompt: string };

export type LightchainResumeInput = {
  artifactId: string;
  slots: LightchainResumeSlot[];
  modelFormState: Record<string, string | number> | null;
  brief?: string;
  referenceNote?: string;
  unavailableSources?: boolean;
  printDesignState?: LightchainPrintDesignState;
  /** AI fitting 参考画像 tab picks (model / pose / background). */
  fittingReferences?: { key: 'model' | 'pose' | 'background'; name: string; imageUrl: string }[];
};

const readFittingReferences = (value: unknown) => (Array.isArray(value) ? value : []).flatMap((entry) => {
  if (!isRecord(entry) || !['model', 'pose', 'background'].includes(String(entry.key))) return [];
  const imageUrl = typeof entry.imageUrl === 'string' ? entry.imageUrl.trim() : '';
  if (!isLocalCanvasAssetReference(imageUrl) && !/^\/(?!\/)[^?#]*$/.test(imageUrl)) return [];
  return [{ key: entry.key as 'model' | 'pose' | 'background', name: typeof entry.name === 'string' ? entry.name.slice(0, 200) : String(entry.key), imageUrl }];
});

export type LightchainResumeScope = { brandId: string; scopeId: string; toolId: string };

export type LightchainResumeResult = {
  artifactId: string;
  toolId: string;
  title: string;
  summary: string;
  /** Local/data/blob URL only. Remote results must be re-signed by the caller. */
  imageUrl: string;
  storagePath: string | null;
  generationMode: 'provider' | 'preview';
  provider: string | null;
  backendProvider: string | null;
  jobId: string | null;
  imageId: string | null;
  parityRuntime?: Json;
};

export type LightchainMaterialImageRef = {
  name: string;
  referenceType: string | null;
  galleryImageId: string | null;
  storagePath: string | null;
};

export type LightchainMaterialResumeState = {
  version: 1;
  mode: 'fabric' | 'printing';
  fabricBase: LightchainMaterialImageRef | null;
  fabricDesign: LightchainMaterialImageRef | null;
  printGarment: LightchainMaterialImageRef | null;
  printDesigns: LightchainMaterialImageRef[];
  fabricPrompt: string;
  fabricImageRatio: string;
  printCoverageMode: 'spot' | 'full';
  printOutputScale: 1 | 2;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const normalizeResumeStoragePath = (value: unknown) => normalizeCloudflareGeneratedImageStoragePath(value) ?? normalizeGeneratedImageStoragePath(value);

const isResumableImageUrl = (value: unknown): value is string => (
  typeof value === 'string'
  && !/[?&](?:token|signature|authorization|x-amz-signature)=/i.test(value)
  && /^(?:local-canvas-asset:\/\/|data:image\/|blob:|local:|\/(?!\/)|\.\.?\/)/i.test(value.trim())
);

const readSourceMetadata = (value: unknown): CanvasSourceMetadata | undefined => {
  const safe = sanitizeCanvasSourceMetadata(value);
  if (!isRecord(safe) || !isRecord(safe.sourceRevision) || !isRecord(safe.sourceIdentity)) return undefined;
  const revision = safe.sourceRevision;
  if (revision.algorithm !== 'sha-256' || typeof revision.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(revision.hash)
    || revision.revision !== `sha256:${revision.hash}` || typeof revision.mimeType !== 'string'
    || !/^image\/[a-zA-Z0-9.+-]+$/.test(revision.mimeType)
    || ![revision.width,revision.height,revision.sizeBytes].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)) return undefined;
  const sourceRevision = { algorithm: 'sha-256' as const, hash: revision.hash, revision: revision.revision,
    mimeType: revision.mimeType, width: revision.width as number, height: revision.height as number, sizeBytes: revision.sizeBytes as number };
  const sourceIdentity = { kind: 'local-upload', hash: revision.hash };
  return { sourceIdentity, sourceRevision, sourceReadback: { ...sourceRevision, sourceIdentity,
    status: isRecord(safe.sourceReadback) && ['verified','mismatch'].includes(String(safe.sourceReadback.status))
      ? safe.sourceReadback.status as 'verified' | 'mismatch' : 'unavailable', provenance: 'unverified' } };
};

/** New durable inputs contain identities, never inline bytes or bearer URLs. */
export const serializeLightchainResumeSlots = (slots: Record<string, {
  name: string; kind: string; imageUrl: string; sourceImageId?: string | null; sourceStoragePath?: string | null;
  sourceMetadata?: CanvasSourceMetadata; persistenceStatus?: 'persistent' | 'session-only' | 'unknown'; localAssetRef?: string;
} | null>) => Object.entries(slots).flatMap(([key,slot]) => {
  if (!slot) return [];
  const sourceStoragePath = normalizeResumeStoragePath(slot.sourceStoragePath);
  const localAssetRef = isLocalCanvasAssetReference(slot.localAssetRef) ? slot.localAssetRef :
    isLocalCanvasAssetReference(slot.imageUrl) ? slot.imageUrl : '';
  return [{ key, fileName: slot.name, materialKind: slot.kind, imageUrl: sourceStoragePath ? '' : localAssetRef,
    sourceImageId: slot.sourceImageId ?? null, sourceStoragePath, sourceMetadata: (readSourceMetadata(slot.sourceMetadata) ?? null) as unknown as Json,
    persistenceStatus: sourceStoragePath || localAssetRef ? 'persistent' as const : 'session-only' as const, hasImage: true }];
});

const CANONICAL_STORAGE_PATH_KEYS = new Set([
  'remoteStoragePath',
  'storagePath',
  'storage_path',
  'sourceStoragePath',
  'backendStoragePath',
]);

const readCanonicalStoragePath = (value: unknown, depth = 0): string | null => {
  if (depth > 6 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const nested = readCanonicalStoragePath(child, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (CANONICAL_STORAGE_PATH_KEYS.has(key)) {
      const normalized = normalizeResumeStoragePath(child);
      if (normalized) return normalized;
    }
    const nested = readCanonicalStoragePath(child, depth + 1);
    if (nested) return nested;
  }
  return null;
};

const readSlot = (value: unknown): LightchainResumeSlot | null => {
  if (!isRecord(value)) return null;
  const key = value.key === 'primary' || value.key === 'secondary' ? value.key : null;
  const name = typeof value.fileName === 'string' ? value.fileName.trim() : '';
  const kind = typeof value.materialKind === 'string' ? value.materialKind.trim() : '';
  const sourceStoragePath = normalizeResumeStoragePath(value.sourceStoragePath);
  const sourceImageId = typeof value.sourceImageId === 'string' ? value.sourceImageId : null;
  const imageUrl = isLocalCanvasAssetReference(value.localAssetRef) ? value.localAssetRef : value.imageUrl;
  if (!key || (!sourceStoragePath && !isResumableImageUrl(imageUrl))) return null;
  return {
    key,
    name: name || key,
    kind: kind || '素材',
    imageUrl: sourceStoragePath ? '' : String(imageUrl).trim(),
    ...(sourceStoragePath || sourceImageId ? {sourceStoragePath,sourceImageId} : {}),
    ...(readSourceMetadata(value.sourceMetadata) ? {sourceMetadata:readSourceMetadata(value.sourceMetadata)} : {}),
    ...(['persistent','session-only','unknown'].includes(String(value.persistenceStatus)) ? {persistenceStatus:value.persistenceStatus as LightchainResumeSlot['persistenceStatus']} : {}),
  };
};

const readModelFormState = (value: unknown): Record<string, string | number> | null => {
  if (!isRecord(value)) return null;
  const result: Record<string, string | number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'number') result[key] = item;
  }
  return Object.keys(result).length > 0 ? result : null;
};

const readPrintDesignState = (value: unknown): LightchainPrintDesignState | null => {
  if (!isRecord(value) || value.version !== 1 || !['guide','no-guide'].includes(String(value.mode))
    || !['ファッション','ホーム','総柄','ワンポイント'].includes(String(value.style))
    || typeof value.prompt !== 'string' || value.prompt.length > 200) return null;
  return { version:1, mode:value.mode as LightchainPrintDesignState['mode'], style:String(value.style), prompt:value.prompt };
};

const readSlotCollection = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, slot]) => {
    if (!isRecord(slot)) return [];
    return [{
      ...slot,
      key: slot.key ?? key,
      fileName: slot.fileName ?? slot.name,
      materialKind: slot.materialKind ?? slot.kind,
    }];
  });
};

const resumeArtifactMatchesJob = (artifact: WorkspaceArtifact, jobId: string) => (
  artifact.sourceJobId === jobId
  || artifact.metadata.sourceJobId === jobId
  || artifact.metadata.remoteJobId === jobId
);

const resumeArtifactMatchesScope = (artifact: WorkspaceArtifact, scope?: LightchainResumeScope) => !scope || (
  artifact.brandId === scope.brandId && artifact.scopeId === scope.scopeId &&
  (artifact.metadata.toolId ?? (isRecord(artifact.metadata.lightchainWorkbenchState) ? artifact.metadata.lightchainWorkbenchState.toolId : undefined)
    ?? artifact.featureType.replace(/^lightchain-/, '').replace(/-provider-result$/, '')) === scope.toolId
);

const readString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

const readProviderResultToolId = (artifact: WorkspaceArtifact): string | null => {
  const metadataToolId = readString(artifact.metadata.toolId);
  if (metadataToolId) return metadataToolId;
  const match = artifact.featureType.match(/^lightchain-(.+)-provider-result$/);
  return match?.[1] ?? null;
};

const isProviderResultArtifact = (artifact: WorkspaceArtifact) => (
  artifact.metadata.providerResultArtifact === true
  || artifact.metadata.resultKind === 'provider'
  || artifact.featureType.endsWith('-provider-result')
);

const readMaterialImageRef = (value: unknown): LightchainMaterialImageRef | null => {
  if (!isRecord(value)) return null;
  const storagePath = readCanonicalStoragePath(value);
  const galleryImageId = readString(value.galleryImageId) ?? readString(value.sourceImageId);
  const referenceType = readString(value.referenceType);
  const name = readString(value.name) ?? readString(value.fileName) ?? '素材';
  if (!storagePath && !galleryImageId) return null;
  return { name, referenceType, galleryImageId, storagePath };
};

const readMaterialImageRefs = (value: unknown): LightchainMaterialImageRef[] => (
  Array.isArray(value)
    ? value.map(readMaterialImageRef).filter((item): item is LightchainMaterialImageRef => Boolean(item))
    : []
);

const readMaterialResumeState = (artifact: WorkspaceArtifact): LightchainMaterialResumeState | null => {
  const raw = artifact.metadata.lightchainMaterialState;
  if (!isRecord(raw) || raw.version !== 1) return null;
  const mode = raw.mode === 'printing' ? 'printing' : raw.mode === 'fabric' ? 'fabric' : null;
  if (!mode) return null;
  const printCoverageMode = raw.printCoverageMode === 'full' ? 'full' : 'spot';
  const printOutputScale = raw.printOutputScale === 2 ? 2 : 1;
  const state: LightchainMaterialResumeState = {
    version: 1,
    mode,
    fabricBase: readMaterialImageRef(raw.fabricBase),
    fabricDesign: readMaterialImageRef(raw.fabricDesign),
    printGarment: readMaterialImageRef(raw.printGarment),
    printDesigns: readMaterialImageRefs(raw.printDesigns),
    fabricPrompt: readString(raw.fabricPrompt) ?? '',
    fabricImageRatio: readString(raw.fabricImageRatio) ?? '画像比率自動',
    printCoverageMode,
    printOutputScale,
  };
  return state.fabricBase || state.fabricDesign || state.printGarment || state.printDesigns.length > 0
    ? state
    : null;
};

/**
 * Read same-job material sources using only durable identities. Signed URLs and
 * data/blob previews are deliberately excluded; callers must resolve each
 * canonical path through the current authenticated media gateway.
 */
export const readLightchainMaterialResumeState = (
  artifacts: WorkspaceArtifact[],
  jobId: string | null | undefined,
): LightchainMaterialResumeState | null => {
  const normalizedJobId = jobId?.trim();
  if (!normalizedJobId) return null;
  const candidates = artifacts
    .filter((artifact) => resumeArtifactMatchesJob(artifact, normalizedJobId) && isProviderResultArtifact(artifact))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  for (const artifact of candidates) {
    const state = readMaterialResumeState(artifact);
    if (state) return state;
  }
  return null;
};

/**
 * Recover only local, non-expiring source inputs from the same brand's saved
 * workbench artifact. Remote signed URLs are intentionally excluded; a retry
 * must ask for a fresh selectable source rather than replaying stale access.
 */
export const readLightchainResumeInput = (
  artifacts: WorkspaceArtifact[],
  jobId: string | null | undefined,
  scope?: LightchainResumeScope,
): LightchainResumeInput | null => {
  const normalizedJobId = jobId?.trim();
  if (!normalizedJobId) return null;

  const candidates = artifacts
    .filter((artifact) => resumeArtifactMatchesJob(artifact, normalizedJobId) && resumeArtifactMatchesScope(artifact,scope))
    .sort((left, right) => {
      const leftHasState = isRecord(left.metadata.lightchainWorkbenchState) ? 1 : 0;
      const rightHasState = isRecord(right.metadata.lightchainWorkbenchState) ? 1 : 0;
      return rightHasState - leftHasState;
    });

  for (const artifact of candidates) {
    const state = isRecord(artifact.metadata.lightchainWorkbenchState)
      ? artifact.metadata.lightchainWorkbenchState
      : artifact.metadata;
    const rawSlotSource = state.materialSlots
      ?? artifact.metadata.materialSlots
      ?? state.materialSlotFiles
      ?? artifact.metadata.materialSlotFiles;
    const rawSlots = readSlotCollection(rawSlotSource).filter(slot => isRecord(slot) && slot.hasImage !== false);
    const slots = rawSlots
      .map(readSlot)
      .filter((slot): slot is LightchainResumeSlot => Boolean(slot));
    const modelFormState = readModelFormState(state.modelFormState ?? artifact.metadata.modelFormState);
    // A legacy Canvas snapshot may be preferred for its input slots while
    // missing dedicated settings. Recover those only from the same scoped job.
    const printDesignState = readPrintDesignState(state.printDesignState ?? artifact.metadata.printDesignState)
      ?? candidates.map(candidate => readPrintDesignState(isRecord(candidate.metadata.lightchainWorkbenchState)
        ? candidate.metadata.lightchainWorkbenchState.printDesignState ?? candidate.metadata.printDesignState
        : candidate.metadata.printDesignState)).find(Boolean) ?? null;
    const brief = typeof state.brief === 'string' ? state.brief : typeof artifact.metadata.brief === 'string' ? artifact.metadata.brief : undefined;
    const referenceNote = typeof state.referenceNote === 'string' ? state.referenceNote : typeof artifact.metadata.referenceNote === 'string' ? artifact.metadata.referenceNote : undefined;
    const fittingReferences = readFittingReferences(state.fittingReferenceSlots ?? artifact.metadata.fittingReferenceSlots);
    if (slots.length === 0 && !modelFormState && brief === undefined && referenceNote === undefined && rawSlots.length === 0) continue;
    return {
      artifactId: artifact.id,
      slots,
      modelFormState,
      ...(printDesignState ? {printDesignState} : {}),
      ...(brief !== undefined ? {brief} : {}), ...(referenceNote !== undefined ? {referenceNote} : {}),
      ...(fittingReferences.length ? {fittingReferences} : {}),
      ...(rawSlots.length !== slots.length ? {unavailableSources:true} : {}),
    };
  }

  return null;
};

/**
 * Read a same-job provider result without treating an old bearer URL as a
 * durable image. The caller must resolve `storagePath` through the current
 * signed-URL path before putting the result back into active UI state.
 */
export const readLightchainResumeResult = (
  artifacts: WorkspaceArtifact[],
  jobId: string | null | undefined,
  scope?: LightchainResumeScope,
): LightchainResumeResult | null => {
  const normalizedJobId = jobId?.trim();
  if (!normalizedJobId) return null;

  const candidates = artifacts
    .filter((artifact) => resumeArtifactMatchesJob(artifact, normalizedJobId) && isProviderResultArtifact(artifact) && resumeArtifactMatchesScope(artifact,scope))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  for (const artifact of candidates) {
    const toolId = readProviderResultToolId(artifact);
    if (!toolId) continue;
    // Input source paths must never be mistaken for this job's result path.
    const storagePath = readCanonicalStoragePath({ remoteStoragePath:artifact.metadata.remoteStoragePath,
      storagePath:artifact.metadata.storagePath, storage_path:artifact.metadata.storage_path, backendStoragePath:artifact.metadata.backendStoragePath,
      lightchainResult:isRecord(artifact.metadata.lightchainWorkbenchState) ? artifact.metadata.lightchainWorkbenchState.lightchainResult : undefined });
    const localImageUrl = isResumableImageUrl(artifact.imageUrl) ? artifact.imageUrl.trim() : '';
    if (!storagePath && !localImageUrl) continue;

    return {
      artifactId: artifact.id,
      toolId,
      title: artifact.title,
      summary: readString(artifact.metadata.generationSummary)
        ?? readString(artifact.metadata.resultSummary)
        ?? artifact.prompt
        ?? artifact.title,
      imageUrl: localImageUrl,
      storagePath,
      generationMode: 'provider',
      provider: readString(artifact.metadata.provider),
      backendProvider: readString(artifact.metadata.backendProvider),
      jobId: artifact.sourceJobId
        ?? readString(artifact.metadata.remoteJobId)
        ?? readString(artifact.metadata.generationJobId),
      imageId: readString(artifact.metadata.imageId)
        ?? readString(artifact.metadata.remoteImageId)
        ?? readString(artifact.metadata.generatedImageId),
      parityRuntime: artifact.metadata.parityRuntime,
    };
  }

  return null;
};
