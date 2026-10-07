import type { FashionStudioGenerationScope } from './fashionStudioDetailGeneration';
import type { CanvasDocumentRecord } from './canvasDocumentPersistence';

export type StudioPendingAck = {
  version: 1;
  scope: Pick<FashionStudioGenerationScope, 'userId' | 'brandId' | 'documentId'>;
  requestId: string;
  documentProof: string;
  receipt: { requestId: string; clientRecoveryKey: string; jobId: string; imageId: string; storagePath: string };
};
export type StudioAckStore = {
  read(scope: StudioPendingAck['scope']): StudioPendingAck | null;
  save(value: StudioPendingAck): void;
  clear(value: StudioPendingAck): void;
};
const key = (scope: StudioPendingAck['scope']) => `heavy:studio-pending-ack:v1:${JSON.stringify([scope.userId, scope.brandId, scope.documentId])}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const studioDocumentProof = async (document: CanvasDocumentRecord) => {
  const bytes = new TextEncoder().encode(JSON.stringify([document.id, document.ownerId, document.brandId, document.revision, document.snapshot]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
};
export const createStudioAckStore = (storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): StudioAckStore => {
  const read = (scope: StudioPendingAck['scope']): StudioPendingAck | null => {
    const raw = storage.getItem(key(scope));
    if (raw === null) return null;
    const value = JSON.parse(raw) as StudioPendingAck;
    if (value?.version !== 1 || !value.scope || ![value.scope.userId, value.scope.brandId, value.scope.documentId,
      value.requestId, value.receipt?.clientRecoveryKey, value.receipt?.jobId, value.receipt?.imageId, value.receipt?.storagePath]
        .every(field => typeof field === 'string' && field.trim().length > 0)
      || key(value.scope) !== key(scope) || !uuid.test(value.requestId)
      || value.receipt?.requestId !== value.requestId || !value.receipt.clientRecoveryKey
      || !value.receipt.jobId || !value.receipt.imageId || !value.receipt.storagePath
      || /^(?:https?:|blob:|data:)/i.test(value.receipt.storagePath) || !/^[0-9a-f]{64}$/.test(value.documentProof)) {
      throw new Error('fashion_studio_ack_checkpoint_invalid');
    }
    return value;
  };
  return {
    read,
    save(value) {
      const existing = read(value.scope);
      if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('fashion_studio_ack_checkpoint_conflict');
      storage.setItem(key(value.scope), JSON.stringify(value));
      if (JSON.stringify(read(value.scope)) !== JSON.stringify(value)) throw new Error('fashion_studio_ack_checkpoint_write_failed');
    },
    clear(value) {
      const existing = read(value.scope);
      if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('fashion_studio_ack_checkpoint_conflict');
      if (existing) storage.removeItem(key(value.scope));
      if (storage.getItem(key(value.scope)) !== null) throw new Error('fashion_studio_ack_checkpoint_clear_failed');
    },
  };
};
