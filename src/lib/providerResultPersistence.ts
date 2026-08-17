import {
  deleteWorkspaceArtifact,
  saveWorkspaceArtifactBestEffort,
  type WorkspaceArtifactBestEffortResult,
} from './localWorkspaceArtifacts';
import type { Json } from '../types/database';

export type ProviderResultArtifactInput = {
  brandId: string;
  scopeId?: string;
  featureType: string;
  title: string;
  imageUrl: string;
  prompt?: string | null;
  sourceJobId?: string | null;
  storagePath?: string | null;
  requireRemote?: boolean;
  /** Set false when imageUrl is a derived client-side output, not the provider source object. */
  reuseCanonicalRemoteArtifact?: boolean;
  metadata?: Record<string, Json | undefined>;
};

const describePersistenceFailure = (result: WorkspaceArtifactBestEffortResult) => {
  const localMessage = result.localError instanceof Error ? result.localError.message : null;
  const remoteMessage = result.remoteError instanceof Error ? result.remoteError.message : null;
  return localMessage || remoteMessage || 'provider_result_persistence_unverified';
};

/**
 * A provider response is not promoted to a result/history card until its
 * durable workspace artifact has either a remote receipt or a local
 * persistence readback. The provider's own persistenceStatus is checked by
 * the caller; this helper closes the client-side history boundary.
 */
export const persistProviderResultArtifact = async (
  input: ProviderResultArtifactInput,
): Promise<WorkspaceArtifactBestEffortResult> => {
  const reuseCanonicalRemoteArtifact = input.reuseCanonicalRemoteArtifact !== false;
  const providerStoragePath = input.storagePath ?? input.metadata?.storagePath ?? null;
  const result = await saveWorkspaceArtifactBestEffort({
    brandId: input.brandId,
    scopeId: input.scopeId,
    featureType: input.featureType,
    title: input.title,
    imageUrl: input.imageUrl,
    prompt: input.prompt ?? null,
    sourceJobId: input.sourceJobId ?? undefined,
    metadata: {
      ...input.metadata,
      providerResultArtifact: true,
      // A derived output (for example the protected material composite) must
      // receive its own remote object. Keep the provider path as provenance,
      // but do not let it become the Gallery/Download identity.
      providerStoragePath: reuseCanonicalRemoteArtifact ? input.metadata?.providerStoragePath ?? null : providerStoragePath,
      storagePath: reuseCanonicalRemoteArtifact ? providerStoragePath : null,
    },
  }, {
    reuseCanonicalRemoteArtifact,
  });

  if (!result.remote && !result.localPersisted) {
    throw new Error(`provider_result_persistence_unverified:${describePersistenceFailure(result)}`);
  }
  if (input.requireRemote && !result.remote) {
    const cleanup = deleteWorkspaceArtifact(input.brandId, result.artifact.id, input.scopeId);
    const cleanupMessage = cleanup.ok ? '' : `:cleanup_failed:${cleanup.error.message}`;
    throw new Error(`provider_result_remote_persistence_unverified:${describePersistenceFailure(result)}${cleanupMessage}`);
  }
  return result;
};
