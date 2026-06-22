import type { GeneratedImage, Json } from '../types/database';
import { supabase } from './supabase';

const STORE_PREFIX = 'heavy-chain-workspace-artifacts:v1';
const MAX_ARTIFACTS_PER_BRAND = 30;
const LOCAL_USER_ID = 'local-workspace';

export interface WorkspaceArtifact {
  id: string;
  brandId: string;
  featureType: string;
  title: string;
  imageUrl: string;
  prompt: string | null;
  createdAt: string;
  metadata: Record<string, Json | undefined>;
  canvasProjectId?: string;
  sourceJobId?: string;
}

export type WorkspaceArtifactInput = Omit<WorkspaceArtifact, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};

export interface WorkspaceArtifactBestEffortResult {
  artifact: WorkspaceArtifact;
  remote?: {
    jobId: string;
    imageId: string;
    storagePath: string;
  };
  remoteError?: unknown;
  cleanupError?: unknown;
}

type RemoteSaveStage = 'function' | 'auth' | 'prepare' | 'storage' | 'job' | 'image' | 'completed';
type RemoteCleanupStatus = 'none' | 'attempted' | 'failed';

interface RemoteSaveFunctionResult {
  success?: boolean;
  remote?: WorkspaceArtifactBestEffortResult['remote'];
  remoteSaveStage?: RemoteSaveStage;
  remoteCleanupStatus?: RemoteCleanupStatus;
  cleanupError?: unknown;
  error?: unknown;
}

const getStorageKey = (brandId: string) => `${STORE_PREFIX}:${brandId}`;

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const generateArtifactId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const readRemoteSaveErrorBody = async (response?: Response): Promise<RemoteSaveFunctionResult | null> => {
  if (!response) return null;
  try {
    return await response.clone().json() as RemoteSaveFunctionResult;
  } catch {
    return null;
  }
};

const parseArtifacts = (value: string | null): WorkspaceArtifact[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isWorkspaceArtifact) : [];
  } catch {
    return [];
  }
};

const isWorkspaceArtifact = (value: unknown): value is WorkspaceArtifact => {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<WorkspaceArtifact>;
  return Boolean(
    artifact.id &&
    artifact.brandId &&
    artifact.featureType &&
    artifact.title &&
    artifact.imageUrl &&
    artifact.createdAt
  );
};

export const isLocalWorkspaceImage = (image: GeneratedImage) => {
  return image.storage_path.startsWith('local/') || image.user_id === LOCAL_USER_ID;
};

export const listWorkspaceArtifacts = (brandId: string): WorkspaceArtifact[] => {
  if (!brandId || !isBrowser()) return [];
  return parseArtifacts(window.localStorage.getItem(getStorageKey(brandId)))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_ARTIFACTS_PER_BRAND);
};

export const saveWorkspaceArtifact = (input: WorkspaceArtifactInput): WorkspaceArtifact => {
  const artifact: WorkspaceArtifact = {
    ...input,
    id: input.id ?? generateArtifactId(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    prompt: input.prompt ?? null,
    metadata: input.metadata ?? {},
  };

  if (!isBrowser()) return artifact;

  const nextArtifacts = [
    artifact,
    ...listWorkspaceArtifacts(artifact.brandId).filter((item) => item.id !== artifact.id),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_ARTIFACTS_PER_BRAND);

  try {
    window.localStorage.setItem(getStorageKey(artifact.brandId), JSON.stringify(nextArtifacts));
  } catch (error) {
    console.warn('Failed to persist local workspace artifact:', error);
  }
  return artifact;
};

export const saveWorkspaceArtifactBestEffort = async (
  input: WorkspaceArtifactInput
): Promise<WorkspaceArtifactBestEffortResult> => {
  let remote: WorkspaceArtifactBestEffortResult['remote'];
  let remoteError: unknown;
  let cleanupError: unknown;
  let remoteSaveStage: RemoteSaveStage = 'function';
  let remoteCleanupStatus: RemoteCleanupStatus = 'none';

  try {
    const { data, error, response } = await supabase.functions.invoke('marketing-workspace-artifact', {
      body: {
        brandId: input.brandId,
        featureType: input.featureType,
        title: input.title,
        imageUrl: input.imageUrl,
        prompt: input.prompt ?? null,
        createdAt: input.createdAt ?? new Date().toISOString(),
        metadata: input.metadata ?? {},
        canvasProjectId: input.canvasProjectId ?? null,
        sourceJobId: input.sourceJobId ?? null,
      },
    });

    const result = (data ?? await readRemoteSaveErrorBody(response)) as RemoteSaveFunctionResult | null;

    remoteSaveStage = result?.remoteSaveStage ?? remoteSaveStage;
    remoteCleanupStatus = result?.remoteCleanupStatus ?? remoteCleanupStatus;
    cleanupError = result?.cleanupError ?? cleanupError;

    if (error || !result?.success || !result.remote) {
      throw error ?? result?.error ?? new Error('Remote workspace artifact function failed.');
    }

    remoteSaveStage = 'completed';
    remote = result.remote;
  } catch (error) {
    remoteError = error;
    console.warn('Remote workspace artifact save failed; falling back to localStorage:', error);
  }

  const artifact = saveWorkspaceArtifact({
    ...input,
    metadata: {
      ...input.metadata,
      remoteSaveStatus: remote ? 'succeeded' : 'failed',
      remoteSaveStage,
      remoteJobId: remote?.jobId ?? null,
      remoteImageId: remote?.imageId ?? null,
      remoteStoragePath: remote?.storagePath ?? null,
      remoteCleanupStatus: cleanupError ? 'failed' : remoteCleanupStatus,
    },
    sourceJobId: remote?.jobId ?? input.sourceJobId,
  });

  return {
    artifact,
    remote,
    remoteError,
    cleanupError,
  };
};

export const deleteWorkspaceArtifact = (brandId: string, artifactId: string) => {
  if (!brandId || !artifactId || !isBrowser()) return;
  const nextArtifacts = listWorkspaceArtifacts(brandId).filter((item) => item.id !== artifactId);
  try {
    window.localStorage.setItem(getStorageKey(brandId), JSON.stringify(nextArtifacts));
  } catch (error) {
    console.warn('Failed to delete local workspace artifact:', error);
  }
};

export const workspaceArtifactToGeneratedImage = (artifact: WorkspaceArtifact): GeneratedImage => ({
  id: artifact.id,
  job_id: artifact.sourceJobId ?? null,
  brand_id: artifact.brandId,
  user_id: LOCAL_USER_ID,
  storage_path: `local/${artifact.id}`,
  image_url: artifact.imageUrl,
  thumbnail_path: null,
  version: 1,
  parent_image_id: null,
  is_favorite: false,
  created_at: artifact.createdAt,
  expires_at: null,
  prompt: artifact.prompt,
  negative_prompt: null,
  feature_type: artifact.featureType,
  style_preset: null,
  model_used: 'local-workspace',
  generation_params: {
    canvasProjectId: artifact.canvasProjectId ?? null,
    sourceJobId: artifact.sourceJobId ?? null,
  },
  metadata: {
    ...artifact.metadata,
    title: artifact.title,
    localWorkspaceArtifact: true,
    canvasProjectId: artifact.canvasProjectId ?? null,
    sourceJobId: artifact.sourceJobId ?? null,
  },
});

export const listWorkspaceGeneratedImages = (brandId: string): GeneratedImage[] => {
  return listWorkspaceArtifacts(brandId)
    .filter((artifact) => artifact.metadata.remoteSaveStatus !== 'succeeded')
    .map(workspaceArtifactToGeneratedImage);
};
