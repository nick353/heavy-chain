import {
  findWorkspaceArtifactPersisted,
  deleteWorkspaceArtifact,
  deleteWorkspaceArtifactWithContext,
  saveWorkspaceArtifactBestEffort,
  type WorkspaceArtifactBestEffortResult,
} from './localWorkspaceArtifacts';
import { validateMaterialCompositeArtifact } from './materialProtectedComposite';
import type { Json } from '../types/database';
import type { ArtifactPersistenceContext } from './cloudflareApi';

export type ProviderResultArtifactInput = {
  id?: string;
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
  options: { persistenceContext?: ArtifactPersistenceContext } = {},
): Promise<WorkspaceArtifactBestEffortResult> => {
  const reuseCanonicalRemoteArtifact = input.reuseCanonicalRemoteArtifact !== false;
  const providerStoragePath = input.storagePath ?? input.metadata?.storagePath ?? null;
  // Explicit stable IDs permit ACK recovery without replacing or deleting a
  // previously verified save when the workspace service is temporarily down.
  if (input.id && input.requireRemote && reuseCanonicalRemoteArtifact && providerStoragePath
    && input.metadata?.cloudflareWorkspaceRequestId) {
    await options.persistenceContext?.assertCurrent();
    const saved = findWorkspaceArtifactPersisted(input.brandId, input.id, input.scopeId);
    if (!saved.ok) throw saved.error;
    const artifact = saved.artifact;
    if (artifact?.metadata.remoteSaveStatus === 'succeeded') {
      const remote = { jobId: String(artifact.metadata.remoteJobId ?? ''),
        imageId: String(artifact.metadata.remoteImageId ?? ''), storagePath: String(artifact.metadata.remoteStoragePath ?? '') };
      if (artifact.featureType !== input.featureType || artifact.sourceJobId !== input.sourceJobId
        || artifact.metadata.cloudflareWorkspaceRequestId !== input.metadata.cloudflareWorkspaceRequestId
        || artifact.metadata.providerRequestId !== input.metadata.providerRequestId
        || remote.jobId !== input.sourceJobId || remote.imageId !== input.metadata.imageId
        || remote.storagePath !== providerStoragePath || remote.storagePath !== `generated-images/${remote.imageId}`) {
        throw new Error('provider_result_saved_identity_changed');
      }
      await options.persistenceContext?.assertCurrent();
      return { artifact, remote, localPersisted: true };
    }
  }

  const result = await saveWorkspaceArtifactBestEffort({
    id: input.id,
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
    persistenceContext: options.persistenceContext,
  });

  if (!result.remote && !result.localPersisted) {
    throw new Error(`provider_result_persistence_unverified:${describePersistenceFailure(result)}`);
  }
  if (input.requireRemote && !result.remote) {
    await options.persistenceContext?.assertCurrent();
    // Retain only the exact locally verified protected composite and its inputs.
    // Other provider-result failures keep the existing cleanup behavior.
    if (input.id && input.reuseCanonicalRemoteArtifact === false && result.localPersisted
      && input.metadata?.protectedMaterialComposite) {
      const retained = findWorkspaceArtifactPersisted(input.brandId, input.id, input.scopeId);
      if (!retained.ok) throw retained.error;
      if (retained.artifact && retained.artifact.featureType === input.featureType
        && retained.artifact.imageUrl === input.imageUrl
        && retained.artifact.brandId === input.brandId && retained.artifact.scopeId === input.scopeId) {
        let validated = false;
        try { await validateMaterialCompositeArtifact(retained.artifact); validated = true; } catch { /* Invalid records retain the existing cleanup path. */ }
        await options.persistenceContext?.assertCurrent();
        if (validated) throw new Error(`provider_result_remote_persistence_unverified:${describePersistenceFailure(result)}:protected_composite_retained`);
      }
    }
    const cleanup = options.persistenceContext
      ? await deleteWorkspaceArtifactWithContext(input.brandId, result.artifact.id, input.scopeId, options.persistenceContext)
      : deleteWorkspaceArtifact(input.brandId, result.artifact.id, input.scopeId);
    await options.persistenceContext?.assertCurrent();
    const cleanupMessage = cleanup.ok ? '' : `:cleanup_failed:${cleanup.error.message}`;
    throw new Error(`provider_result_remote_persistence_unverified:${describePersistenceFailure(result)}${cleanupMessage}`);
  }
  return result;
};
