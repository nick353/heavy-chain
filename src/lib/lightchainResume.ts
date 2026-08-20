import type { WorkspaceArtifact } from './localWorkspaceArtifacts';
import { normalizeGeneratedImageStoragePath } from './storagePathSafety.ts';
import type { Json } from '../types/database';

export type LightchainResumeSlot = {
  key: 'primary' | 'secondary';
  name: string;
  kind: string;
  imageUrl: string;
};

export type LightchainResumeInput = {
  artifactId: string;
  slots: LightchainResumeSlot[];
  modelFormState: Record<string, string | number> | null;
};

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

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isResumableImageUrl = (value: unknown): value is string => (
  typeof value === 'string'
  && /^(?:data:image\/|blob:|local:|\/|\.\.?\/)/i.test(value.trim())
);

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
      const normalized = normalizeGeneratedImageStoragePath(child);
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
  const imageUrl = value.imageUrl;
  if (!key || !isResumableImageUrl(imageUrl)) return null;
  return {
    key,
    name: name || key,
    kind: kind || '素材',
    imageUrl: imageUrl.trim(),
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

/**
 * Recover only local, non-expiring source inputs from the same brand's saved
 * workbench artifact. Remote signed URLs are intentionally excluded; a retry
 * must ask for a fresh selectable source rather than replaying stale access.
 */
export const readLightchainResumeInput = (
  artifacts: WorkspaceArtifact[],
  jobId: string | null | undefined,
): LightchainResumeInput | null => {
  const normalizedJobId = jobId?.trim();
  if (!normalizedJobId) return null;

  const candidates = artifacts
    .filter((artifact) => resumeArtifactMatchesJob(artifact, normalizedJobId))
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
    const slots = readSlotCollection(rawSlotSource)
      .map(readSlot)
      .filter((slot): slot is LightchainResumeSlot => Boolean(slot));
    const modelFormState = readModelFormState(state.modelFormState ?? artifact.metadata.modelFormState);
    if (slots.length === 0 && !modelFormState) continue;
    return {
      artifactId: artifact.id,
      slots,
      modelFormState,
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
): LightchainResumeResult | null => {
  const normalizedJobId = jobId?.trim();
  if (!normalizedJobId) return null;

  const candidates = artifacts
    .filter((artifact) => resumeArtifactMatchesJob(artifact, normalizedJobId) && isProviderResultArtifact(artifact))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  for (const artifact of candidates) {
    const toolId = readProviderResultToolId(artifact);
    if (!toolId) continue;
    const storagePath = readCanonicalStoragePath(artifact.metadata);
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
