import type { FittingBatchReceipt, FittingBatchScope, FittingBatchTask } from './fittingBatch';
import type { FittingBatchExecution } from './fittingBatchRunner';
import { listPendingIdentities } from './cloudflareImagePendingStore.ts';
type Client = {
  origin: string;
  invokeProviderAction<T>(action: string, body: Record<string, unknown>, options: {
    idempotencyKey: string; retainUntilAcknowledged: boolean; assertContext: () => void | Promise<void>;
  }): Promise<T>;
  readImageAIRequest(requestId: string): Promise<Record<string, unknown>>;
  acknowledgeImageAction(receipt: FittingBatchReceipt): Promise<void>;
};
/** Uses the raw durable API, preserving unknown/running receipts rather than the single wrapper's error flattening. */
export function createFittingBatchExecution(client: Client, scope: FittingBatchScope,
  persist: FittingBatchExecution['persist'], assertCurrent: FittingBatchExecution['assertCurrent']): FittingBatchExecution {
  return {
    assertCurrent,
    async submit(task: FittingBatchTask) {
      const settings = task.input.settings ?? {};
      return client.invokeProviderAction<FittingBatchReceipt>('model-matrix', {
        brandId: scope.brandId, generationProvider: 'openai', featureType: `lightchain-${scope.featureId}`,
        productDescription: task.input.prompt || task.input.garmentName,
        imageUrl: task.input.garment, modelReferenceImageUrl: task.input.model ?? undefined,
        bodyTypes: [String(settings.bodyType ?? '').includes('スマート') ? 'slim' : String(settings.bodyType ?? '').includes('プラス') ? 'plus' : 'regular'],
        ageGroups: [String(settings.ageGroup ?? '').match(/30|40|50/)?.[0] ? `${String(settings.ageGroup).match(/30|40|50/)![0]}s` : '20s'],
        gender: String(settings.gender ?? '').includes('男') ? 'male' : 'female',
        // Existing single uses these internal fields, without new user-facing approval gates.
        rightsConfirmed: true, legalSafety: { rightsConfirmed: true },
        lightchainCompat: { lightchainFeatureId: scope.featureId, lightchainTaskCodes: [scope.featureId] },
        compositionPreview: { fittingBatchTaskId: task.id, mode: task.input.mode, settings },
      }, { idempotencyKey: task.requestId, retainUntilAcknowledged: true, assertContext: assertCurrent });
    },
    async read(requestId) {
      const receipt = await client.readImageAIRequest(requestId) as FittingBatchReceipt;
      if (receipt.state !== 'completed') return receipt;
      const prefix = `heavy:image-ai:v1:${client.origin}:${scope.userId}:${scope.brandId}:`;
      const pending = await listPendingIdentities(prefix);
      if (pending.state !== 'complete') throw new Error('fitting_batch_recovery_identity_unavailable');
      const identities = pending.identities.filter(identity => identity.requestId === requestId);
      if (identities.length !== 1) throw new Error('fitting_batch_recovery_identity_mismatch');
      return { ...receipt, clientRecoveryKey: identities[0].key };
    },
    persist,
    acknowledge: receipt => client.acknowledgeImageAction(receipt),
  };
}
