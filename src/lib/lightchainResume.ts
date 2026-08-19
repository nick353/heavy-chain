import type { WorkspaceArtifact } from './localWorkspaceArtifacts';

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

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isResumableImageUrl = (value: unknown): value is string => (
  typeof value === 'string'
  && /^(?:data:image\/|blob:|local:|\/|\.\.?\/)/i.test(value.trim())
);

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
