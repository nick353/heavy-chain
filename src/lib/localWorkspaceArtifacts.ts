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

export type WorkspaceArtifactPersistenceResult =
  | { ok: true; artifact: WorkspaceArtifact }
  | { ok: false; error: Error };

export type WorkspaceArtifactDeleteResult =
  | { ok: true }
  | { ok: false; error: Error };

type RemoteSaveStage = 'function' | 'auth' | 'prepare' | 'storage' | 'job' | 'image' | 'timeout' | 'completed';
type RemoteCleanupStatus = 'none' | 'attempted' | 'failed';
const REMOTE_WORKSPACE_ARTIFACT_TIMEOUT_MS = 8000;

interface RemoteSaveFunctionResult {
  success?: boolean;
  remote?: WorkspaceArtifactBestEffortResult['remote'];
  remoteSaveStage?: RemoteSaveStage;
  remoteCleanupStatus?: RemoteCleanupStatus;
  cleanupError?: unknown;
  error?: unknown;
}

const getStorageKey = (brandId: string) => `${STORE_PREFIX}:${brandId}`;

const isBrowser = () => {
  if (typeof window === 'undefined') return false;
  try {
    return typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
};

const isQuotaExceededError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; code?: number; message?: string };
  return (
    candidate.name === 'QuotaExceededError' ||
    candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    candidate.code === 22 ||
    candidate.code === 1014 ||
    (typeof candidate.message === 'string' && /quota|storage/i.test(candidate.message))
  );
};

const persistArtifactsToLocalStorage = (storageKey: string, artifacts: WorkspaceArtifact[], operation: 'save' | 'delete') => {
  let nextArtifacts = artifacts;
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextArtifacts));
      if (attempt > 0) {
        console.warn(`Local workspace artifact ${operation} recovered after trimming old entries.`, {
          storageKey,
          kept: nextArtifacts.length,
          trimmed: artifacts.length - nextArtifacts.length,
        });
      }
      return true;
    } catch (error) {
      lastError = error;
      if (!isQuotaExceededError(error)) {
        break;
      }
      if (nextArtifacts.length === 1) {
        break;
      }
      nextArtifacts = nextArtifacts.slice(0, Math.max(1, Math.floor(nextArtifacts.length * 0.8)));
    }
  }

  console.warn(`Failed to persist local workspace artifact during ${operation}:`, lastError);
  return false;
};

const toPersistenceError = (operation: 'save' | 'delete', error?: unknown) => {
  if (error instanceof Error) return error;
  return new Error(`Local workspace artifact ${operation} failed.`);
};

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

const withRemoteSaveTimeout = async <T,>(promise: Promise<T>): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Remote workspace artifact save timed out after ${REMOTE_WORKSPACE_ARTIFACT_TIMEOUT_MS}ms.`));
        }, REMOTE_WORKSPACE_ARTIFACT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
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

const readWorkspaceArtifacts = (brandId: string):
  | { ok: true; artifacts: WorkspaceArtifact[] }
  | { ok: false; error: Error } => {
  if (!brandId || !isBrowser()) {
    return { ok: false, error: new Error('Local workspace storage is unavailable.') };
  }
  try {
    return {
      ok: true,
      artifacts: parseArtifacts(window.localStorage.getItem(getStorageKey(brandId)))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, MAX_ARTIFACTS_PER_BRAND),
    };
  } catch (error) {
    return { ok: false, error: toPersistenceError('save', error) };
  }
};

export const listWorkspaceArtifacts = (brandId: string): WorkspaceArtifact[] => {
  const result = readWorkspaceArtifacts(brandId);
  if (result.ok) return result.artifacts;
  console.warn('Failed to read local workspace artifacts:', result.error);
  return [];
};

export const findWorkspaceArtifactPersisted = (
  brandId: string,
  artifactId: string,
): { ok: true; artifact: WorkspaceArtifact | null } | { ok: false; error: Error } => {
  const result = readWorkspaceArtifacts(brandId);
  if (!result.ok) return result;
  return {
    ok: true,
    artifact: result.artifacts.find((artifact) => artifact.id === artifactId) ?? null,
  };
};

export const findWorkspaceArtifact = (brandId: string, artifactId: string): WorkspaceArtifact | null => {
  if (!brandId || !artifactId) return null;
  return listWorkspaceArtifacts(brandId).find((artifact) => artifact.id === artifactId) ?? null;
};

export const saveWorkspaceArtifactPersisted = (
  input: WorkspaceArtifactInput,
): WorkspaceArtifactPersistenceResult => {
  if (!isBrowser()) {
    return { ok: false, error: new Error('Local workspace storage is unavailable.') };
  }

  try {
    const current = readWorkspaceArtifacts(input.brandId);
    if (!current.ok) return current;
    const existingArtifact = input.id
      ? current.artifacts.find((artifact) => artifact.id === input.id) ?? null
      : null;
    const artifact: WorkspaceArtifact = {
      ...existingArtifact,
      ...input,
      id: input.id ?? generateArtifactId(),
      createdAt: input.createdAt ?? existingArtifact?.createdAt ?? new Date().toISOString(),
      prompt: input.prompt ?? existingArtifact?.prompt ?? null,
      metadata: {
        ...existingArtifact?.metadata,
        ...input.metadata,
      },
    };
    const nextArtifacts = [
      artifact,
      ...current.artifacts.filter((item) => item.id !== artifact.id),
    ].slice(0, MAX_ARTIFACTS_PER_BRAND);
    const persisted = persistArtifactsToLocalStorage(getStorageKey(artifact.brandId), nextArtifacts, 'save');
    if (!persisted) {
      return { ok: false, error: toPersistenceError('save') };
    }
    const readback = parseArtifacts(window.localStorage.getItem(getStorageKey(artifact.brandId)))
      .find((item) => item.id === artifact.id);
    const normalizedArtifact = JSON.parse(JSON.stringify(artifact)) as WorkspaceArtifact;
    if (!readback || JSON.stringify(readback) !== JSON.stringify(normalizedArtifact)) {
      return { ok: false, error: new Error('Local workspace artifact save could not be verified.') };
    }
    return { ok: true, artifact: readback };
  } catch (error) {
    return { ok: false, error: toPersistenceError('save', error) };
  }
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

  persistArtifactsToLocalStorage(getStorageKey(artifact.brandId), nextArtifacts, 'save');
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
    const { data, error, response } = await withRemoteSaveTimeout(
      supabase.functions.invoke('marketing-workspace-artifact', {
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
      })
    );

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
    if (error instanceof Error && error.message.includes('timed out')) remoteSaveStage = 'timeout';
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

export const deleteWorkspaceArtifactsPersisted = (
  brandId: string,
  artifactIds: Iterable<string>,
): WorkspaceArtifactDeleteResult => {
  if (!brandId || !isBrowser()) {
    return { ok: false, error: new Error('Local workspace storage is unavailable.') };
  }
  const ids = new Set(Array.from(artifactIds).filter(Boolean));
  if (ids.size === 0) return { ok: true };

  try {
    const current = readWorkspaceArtifacts(brandId);
    if (!current.ok) return current;
    const nextArtifacts = current.artifacts.filter((item) => !ids.has(item.id));
    const persisted = persistArtifactsToLocalStorage(getStorageKey(brandId), nextArtifacts, 'delete');
    if (!persisted) return { ok: false, error: toPersistenceError('delete') };
    const remainingIds = new Set(parseArtifacts(window.localStorage.getItem(getStorageKey(brandId))).map((item) => item.id));
    if (Array.from(ids).some((id) => remainingIds.has(id))) {
      return { ok: false, error: new Error('Local workspace artifact delete could not be verified.') };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toPersistenceError('delete', error) };
  }
};

export const deleteWorkspaceArtifact = (
  brandId: string,
  artifactId: string,
): WorkspaceArtifactDeleteResult => deleteWorkspaceArtifactsPersisted(brandId, [artifactId]);

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
  is_favorite: artifact.metadata.printResultFavorite === true,
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
