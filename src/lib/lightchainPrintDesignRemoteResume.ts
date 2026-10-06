import type { GeneratedImage, Json } from '../types/database';
import type { WorkspaceArtifact } from './localWorkspaceArtifacts';
import { readLightchainResumeInput, readLightchainResumeResult, type LightchainResumeScope } from './lightchainResume';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Adopt one exact owned canonical result. No writes, inference or bearer URL reuse. */
export function readPrintDesignRemoteResume(rows: GeneratedImage[], jobId: string, scope: LightchainResumeScope) {
  if (!['print-design-project','print-design-detail'].includes(scope.toolId) || rows.length !== 1) return null;
  const row = rows[0];
  const metadata = row.metadata;
  if (!record(metadata) || row.user_id !== scope.scopeId || row.brand_id !== scope.brandId || row.job_id !== jobId
    || row.feature_type !== `lightchain-${scope.toolId}` || metadata.persistenceStatus !== 'completed'
    || typeof metadata.requestId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(metadata.requestId)
    || jobId !== `ai-${metadata.requestId}` || row.id !== `ai-${metadata.requestId}-0`
    || row.storage_path !== `generated-images/${row.id}` || !record(metadata.compositionPreview)) return null;
  const composition = metadata.compositionPreview;
  const snapshot = composition.printDesignInput;
  if (!record(snapshot) || snapshot.version !== 1 || !Array.isArray(snapshot.materialSlots)) return null;
  const artifact: WorkspaceArtifact = {
    id:`print-design:${metadata.requestId}`,brandId:scope.brandId,scopeId:scope.scopeId,
    featureType:`lightchain-${scope.toolId}-provider-result`,title:scope.toolId,imageUrl:'',prompt:row.prompt,
    createdAt:row.created_at,sourceJobId:jobId,
    metadata:{...metadata,toolId:scope.toolId,providerResultArtifact:true,remoteStoragePath:row.storage_path,imageId:row.id,
      cloudflareWorkspaceRequestId:metadata.requestId,providerRequestId:metadata.requestId,
      printDesignState:composition.printDesignState as Json,materialSlots:snapshot.materialSlots as Json,
      brief:snapshot.brief as Json,referenceNote:snapshot.referenceNote as Json},
  };
  const input = readLightchainResumeInput([artifact],jobId,scope);
  const result = readLightchainResumeResult([artifact],jobId,scope);
  if (!input?.printDesignState || input.unavailableSources || !result
    || (input.printDesignState.mode === 'guide' && !input.slots.some(slot => slot.key === 'primary'))) return null;
  return {input,result};
}
