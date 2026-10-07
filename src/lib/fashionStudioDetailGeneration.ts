import type { ImageEditResult } from './imageApi';
import type { ProviderResultArtifactInput } from './providerResultPersistence';
import type { WorkspaceArtifactBestEffortResult } from './localWorkspaceArtifacts';
import type { CanvasDocumentRecord, CanvasDocumentSnapshot, CanvasDocumentRequestContext } from './canvasDocumentPersistence';
import { studioDocumentProof, type StudioAckStore, type StudioPendingAck } from './fashionStudioPendingAck.ts';

export type FashionStudioGenerationScope = {
  userId: string;
  brandId: string;
  documentId: string;
  /** Page/auth hydration generation; a changed session must invalidate this fence. */
  generation: number;
};
export type FashionStudioGenerationInput = {
  scope: FashionStudioGenerationScope;
  /** Retain for duplicate clicks/recovery; change only for a new logical attempt. */
  logicalAttemptKey: string;
  main: { objectId: string; imageUrl: string; verified: boolean };
  referenceImageUrls?: readonly string[];
  prompt: string;
};
export type FashionStudioGenerationStage = 'provider' | 'persistence' | 'canvas' | 'acknowledgement' | 'completed';
export type FashionStudioGenerationOutcome = {
  status: 'success' | 'failure' | 'stale';
  requestId: string;
  stage: FashionStudioGenerationStage;
  error?: string;
  artifact?: WorkspaceArtifactBestEffortResult['artifact'];
  document?: CanvasDocumentRecord;
  imageUrl?: string;
};
export type FashionStudioGenerationHandoff = {
  input: FashionStudioGenerationInput;
  requestId: string;
  provider: ImageEditResult;
  persisted: WorkspaceArtifactBestEffortResult & { remote: NonNullable<WorkspaceArtifactBestEffortResult['remote']> };
  /** Initial Canvas role identity for conflict checks; never reset by retry. */
  baseDocument: CanvasDocumentRecord;
};
export type FashionStudioGenerationAdapters = {
  ackStore?: StudioAckStore;
  prepareAcknowledgement?(scope: FashionStudioGenerationScope, requestId: string, context: CanvasDocumentRequestContext): Promise<CanvasDocumentRecord>;
  assertScope(scope: FashionStudioGenerationScope): void;
  requestId?: () => string;
  editImageWithPrompt(imageUrl: string, prompt: string, brandId: string, options: {
    idempotencyKey: string; assertContext: () => void; canvasProjectId: string;
    parentObjectId: string; referenceImageUrls: string[]; featureType: string;
  }): Promise<ImageEditResult>;
  assertCompletedImageEditResult(result: ImageEditResult): void;
  /** Adapters must also fence their internal async mutations using context. */
  persistProviderResultArtifact(input: ProviderResultArtifactInput, context: CanvasDocumentRequestContext): Promise<WorkspaceArtifactBestEffortResult>;
  getCanvasDocument(documentId: string, brandId: string, context: CanvasDocumentRequestContext): Promise<CanvasDocumentRecord>;
  updateCanvasDocument(input: {
    brandId: string; documentId: string; title: string;
    snapshot: CanvasDocumentSnapshot; expectedRevision: number;
  }, context: CanvasDocumentRequestContext): Promise<CanvasDocumentRecord>;
  /** Page owns result-layer replacement; preserve unrelated objects and view. */
  buildUpdatedSnapshot(document: CanvasDocumentRecord, handoff: FashionStudioGenerationHandoff): CanvasDocumentSnapshot;
  /** Return the exact operation result; throw on ambiguous/duplicate matches. */
  findOperationResult(snapshot: CanvasDocumentSnapshot, operationId: string): Record<string, unknown> | undefined;
  acknowledgeImageAction(receipt: Pick<ImageEditResult, 'requestId' | 'clientRecoveryKey'>, context: CanvasDocumentRequestContext): Promise<void>;
  /** Presentation runs only after remote artifact + Canvas readback + acknowledgement. */
  publishSuccess?(outcome: FashionStudioGenerationOutcome, input: FashionStudioGenerationInput): void;
};
type Attempt = {
  input: FashionStudioGenerationInput;
  identity: string;
  requestId: string;
  stage: FashionStudioGenerationStage;
  provider?: ImageEditResult;
  persisted?: WorkspaceArtifactBestEffortResult;
  document?: CanvasDocumentRecord;
  baseDocument?: CanvasDocumentRecord;
  outcome?: FashionStudioGenerationOutcome;
  flight?: Promise<FashionStudioGenerationOutcome>;
};
const feature = 'fashion-studio-detail-generated-result';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const scopeKey = (scope: FashionStudioGenerationScope) => JSON.stringify([scope.userId, scope.brandId, scope.documentId, scope.generation]);

/** No provider protocol here: recovery calls the existing edit adapter with the
 * exact UUID. Its durable image transport owns GET/definite-404/POST decisions. */
export const createFashionStudioDetailGeneration = (adapters: FashionStudioGenerationAdapters) => {
  let active = true;
  let current: Attempt | undefined;
  const completed = new Map<string, { identity: string; outcome: FashionStudioGenerationOutcome }>();
  let recovery: { checkpoint: StudioPendingAck; scope: FashionStudioGenerationScope; flight?: Promise<FashionStudioGenerationOutcome> } | undefined;
  let recoveryError = false;
  const assertContext = (attempt: Attempt) => {
    if (!active || current !== attempt) throw new Error('fashion_studio_generation_scope_stale');
    adapters.assertScope(attempt.input.scope);
  };
  const contextFor = (attempt: Attempt): CanvasDocumentRequestContext => ({
    userId: attempt.input.scope.userId, assertContext: () => assertContext(attempt),
  });
  const validateDocument = (attempt: Attempt, document: CanvasDocumentRecord) => {
    const scope = attempt.input.scope;
    if (document.id !== scope.documentId || document.ownerId !== scope.userId || document.brandId !== scope.brandId) {
      throw new Error('fashion_studio_generation_document_scope_mismatch');
    }
    if (!Number.isSafeInteger(document.revision) || document.revision < 0 || !Array.isArray(document.snapshot?.objects)) {
      throw new Error('fashion_studio_generation_document_invalid');
    }
    return document;
  };
  const readDocument = async (attempt: Attempt) => {
    assertContext(attempt);
    const scope = attempt.input.scope;
    const document = await adapters.getCanvasDocument(scope.documentId, scope.brandId, contextFor(attempt));
    assertContext(attempt);
    return validateDocument(attempt, document);
  };
  const hasOperation = (attempt: Attempt, document: CanvasDocumentRecord) => {
    const result = adapters.findOperationResult(document.snapshot, attempt.requestId);
    if (!result) return false;
    const remote = attempt.persisted?.remote;
    const metadata = record(result.metadata);
    if (!remote || result.type !== 'image' || metadata.imageId !== remote.imageId
      || metadata.jobId !== remote.jobId || metadata.storagePath !== remote.storagePath
      || result.src !== remote.storagePath) throw new Error('fashion_studio_generation_operation_identity_mismatch');
    return true;
  };
  const execute = async (attempt: Attempt): Promise<FashionStudioGenerationOutcome> => {
    try {
      assertContext(attempt);
      if (attempt.outcome?.status === 'success') return attempt.outcome;
      if (!attempt.provider) {
        attempt.stage = 'provider';
        const result = await adapters.editImageWithPrompt(attempt.input.main.imageUrl, attempt.input.prompt, attempt.input.scope.brandId, {
          idempotencyKey: attempt.requestId, assertContext: () => assertContext(attempt),
          canvasProjectId: attempt.input.scope.documentId, parentObjectId: attempt.input.main.objectId,
          referenceImageUrls: [...(attempt.input.referenceImageUrls ?? [])], featureType: feature,
        });
        assertContext(attempt);
        adapters.assertCompletedImageEditResult(result);
        if (result.requestId !== attempt.requestId || !result.imageUrl?.trim()) throw new Error('fashion_studio_generation_provider_identity_mismatch');
        // Hold completed inference before any persistence; subsequent retries skip it.
        attempt.provider = result;
      }
      if (!attempt.persisted) {
        attempt.stage = 'persistence';
        assertContext(attempt);
        const provider = attempt.provider;
        const persisted = await adapters.persistProviderResultArtifact({
          brandId: attempt.input.scope.brandId, scopeId: attempt.input.scope.userId,
          featureType: feature, title: 'Fashion Studio', imageUrl: provider.imageUrl!,
          prompt: attempt.input.prompt, sourceJobId: provider.jobId, storagePath: provider.storagePath,
          requireRemote: true, reuseCanonicalRemoteArtifact: true,
          metadata: {
            generationOperationId: attempt.requestId, requestId: attempt.requestId,
            canvasProjectId: attempt.input.scope.documentId, parentObjectId: attempt.input.main.objectId,
            jobId: provider.jobId, imageId: provider.imageId, storagePath: provider.storagePath,
          },
        }, contextFor(attempt));
        assertContext(attempt);
        const remote = persisted.remote;
        if (!remote?.jobId || !remote.imageId || !remote.storagePath || !persisted.artifact.id
          || persisted.artifact.brandId !== attempt.input.scope.brandId
          || persisted.artifact.scopeId !== attempt.input.scope.userId) throw new Error('fashion_studio_generation_remote_artifact_unverified');
        if ((provider.jobId && provider.jobId !== remote.jobId) || (provider.imageId && provider.imageId !== remote.imageId)
          || (provider.storagePath && provider.storagePath !== remote.storagePath)) throw new Error('fashion_studio_generation_canonical_identity_mismatch');
        attempt.persisted = persisted;
      }
      if (!attempt.document) {
        attempt.stage = 'canvas';
        const document = await readDocument(attempt);
        attempt.baseDocument ??= structuredClone(document);
        if (hasOperation(attempt, document)) attempt.document = document;
        else {
          const snapshot = adapters.buildUpdatedSnapshot(document, {
            input: attempt.input, requestId: attempt.requestId, provider: attempt.provider,
            persisted: attempt.persisted as FashionStudioGenerationHandoff['persisted'],
            baseDocument: attempt.baseDocument,
          });
          assertContext(attempt);
          try {
            const updated = await adapters.updateCanvasDocument({
              brandId: attempt.input.scope.brandId, documentId: document.id, title: document.title,
              snapshot, expectedRevision: document.revision,
            }, contextFor(attempt));
            assertContext(attempt);
            validateDocument(attempt, updated);
          } catch (error) {
            assertContext(attempt);
            // A conflict/lost PUT response may already have committed this exact operation.
            const recovered = await readDocument(attempt);
            if (!hasOperation(attempt, recovered)) throw new Error(`fashion_studio_generation_canvas_reconciliation_required:${message(error)}`);
            attempt.document = recovered;
          }
          if (!attempt.document) {
            const readback = await readDocument(attempt);
            if (!hasOperation(attempt, readback)) throw new Error('fashion_studio_generation_canvas_readback_unverified');
            attempt.document = readback;
          }
        }
      }
      attempt.stage = 'acknowledgement';
      assertContext(attempt);
      let checkpoint: StudioPendingAck | undefined;
      if (adapters.ackStore) {
        const remote = attempt.persisted.remote!;
        if (!attempt.provider.clientRecoveryKey) throw new Error('fashion_studio_ack_receipt_missing');
        checkpoint = { version: 1, scope: { userId: attempt.input.scope.userId, brandId: attempt.input.scope.brandId, documentId: attempt.input.scope.documentId },
          requestId: attempt.requestId, documentProof: await studioDocumentProof(attempt.document),
          receipt: { requestId: attempt.requestId, clientRecoveryKey: attempt.provider.clientRecoveryKey,
            jobId: remote.jobId, imageId: remote.imageId, storagePath: remote.storagePath } };
        assertContext(attempt); adapters.ackStore.save(checkpoint);
      }
      await adapters.acknowledgeImageAction(attempt.provider, contextFor(attempt));
      assertContext(attempt);
      if (checkpoint) adapters.ackStore!.clear(checkpoint);
      attempt.stage = 'completed';
      const outcome: FashionStudioGenerationOutcome = {
        status: 'success', requestId: attempt.requestId, stage: attempt.stage,
        artifact: attempt.persisted.artifact, document: attempt.document, imageUrl: attempt.provider.imageUrl,
      };
      attempt.outcome = outcome;
      completed.set(JSON.stringify([scopeKey(attempt.input.scope), attempt.input.logicalAttemptKey]), { identity: attempt.identity, outcome });
      adapters.publishSuccess?.(outcome, attempt.input);
      return outcome;
    } catch (error) {
      let stale = false;
      try { assertContext(attempt); } catch { stale = true; }
      const outcome: FashionStudioGenerationOutcome = {
        status: stale ? 'stale' : 'failure', requestId: attempt.requestId,
        stage: attempt.stage, error: message(error),
      };
      if (!stale) attempt.outcome = outcome;
      return outcome;
    }
  };
  const run = (attempt: Attempt) => {
    if (attempt.flight) return attempt.flight;
    // Schedule after assigning flight, including adapters that throw synchronously.
    const flight = Promise.resolve().then(() => execute(attempt));
    attempt.flight = flight;
    void flight.finally(() => { if (attempt.flight === flight) attempt.flight = undefined; });
    return flight;
  };
  return {
    restorePendingAcknowledgement(scope: FashionStudioGenerationScope): FashionStudioGenerationOutcome | null {
      if (!active) throw new Error('fashion_studio_generation_scope_stale');
      adapters.assertScope(scope);
      try {
        const checkpoint = adapters.ackStore?.read(scope);
        if (!checkpoint) return null;
        recovery = { checkpoint, scope: { ...scope } };
        return { status: 'failure', requestId: checkpoint.requestId, stage: 'acknowledgement', error: '保存の確認を再試行してください。' };
      } catch (error) {
        recoveryError = true;
        return { status: 'failure', requestId: '', stage: 'acknowledgement', error: message(error) };
      }
    },
    start(input: FashionStudioGenerationInput): Promise<FashionStudioGenerationOutcome> {
      if (recovery || recoveryError) return Promise.reject(new Error('fashion_studio_generation_attempt_unreconciled'));
      if (!active) return Promise.reject(new Error('fashion_studio_generation_scope_stale'));
      adapters.assertScope(input.scope);
      if (!input.scope.userId || !input.scope.brandId || !input.scope.documentId || !input.logicalAttemptKey.trim()
        || !input.main.verified || !input.main.objectId || !input.main.imageUrl.trim() || !input.prompt.trim()
        || input.referenceImageUrls?.some(url => !url.trim())) return Promise.reject(new Error('fashion_studio_generation_input_unverified'));
      const captured: FashionStudioGenerationInput = {
        ...input, scope: { ...input.scope }, main: { ...input.main }, prompt: input.prompt.trim(),
        referenceImageUrls: [...(input.referenceImageUrls ?? [])],
      };
      const identity = JSON.stringify(captured);
      const completedAttempt = completed.get(JSON.stringify([scopeKey(captured.scope), captured.logicalAttemptKey]));
      if (completedAttempt) {
        if (completedAttempt.identity !== identity) return Promise.reject(new Error('fashion_studio_generation_attempt_input_changed'));
        return Promise.resolve(completedAttempt.outcome);
      }
      if (current && scopeKey(current.input.scope) === scopeKey(captured.scope)) {
        if (current.input.logicalAttemptKey === captured.logicalAttemptKey) {
          if (current.identity !== identity) return Promise.reject(new Error('fashion_studio_generation_attempt_input_changed'));
          return run(current);
        }
        if (current.outcome?.status !== 'success') return Promise.reject(new Error('fashion_studio_generation_attempt_unreconciled'));
      }
      // Another page can commit an ACK checkpoint after this page mounted.
      // Re-read before allocating a new request instead of relying on mount-time hydration.
      try {
        const checkpoint = adapters.ackStore?.read(captured.scope);
        if (checkpoint) {
          recovery = { checkpoint, scope: { ...captured.scope } };
          return Promise.reject(new Error('fashion_studio_generation_attempt_unreconciled'));
        }
      } catch (error) { recoveryError = true; return Promise.reject(error); }
      const requestId = (adapters.requestId ?? (() => crypto.randomUUID()))();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return Promise.reject(new Error('image_request_id_invalid'));
      current = { input: captured, identity, requestId, stage: 'provider' };
      return run(current);
    },
    retry(): Promise<FashionStudioGenerationOutcome> {
      if (recovery) {
        const captured = recovery;
        if (captured.flight) return captured.flight;
        const check = () => {
          if (!active || recovery !== captured) throw new Error('fashion_studio_generation_scope_stale');
          adapters.assertScope(captured.scope);
        };
        const flight = Promise.resolve().then(async (): Promise<FashionStudioGenerationOutcome> => {
          try {
            check();
            if (!adapters.prepareAcknowledgement || !adapters.ackStore) throw new Error('fashion_studio_ack_restore_unavailable');
            const stored = adapters.ackStore.read(captured.scope);
            if (JSON.stringify(stored) !== JSON.stringify(captured.checkpoint)) throw new Error('fashion_studio_ack_checkpoint_conflict');
            const context = { userId: captured.scope.userId, assertContext: check };
            const document = await adapters.prepareAcknowledgement(captured.scope, captured.checkpoint.requestId, context);
            check();
            if (document.id !== captured.scope.documentId || document.ownerId !== captured.scope.userId || document.brandId !== captured.scope.brandId
              || await studioDocumentProof(document) !== captured.checkpoint.documentProof) throw new Error('fashion_studio_ack_document_changed');
            check();
            const object = adapters.findOperationResult(document.snapshot, captured.checkpoint.requestId);
            const metadata = record(object?.metadata), receipt = captured.checkpoint.receipt;
            if (!object || object.type !== 'image' || object.src !== receipt.storagePath || metadata.jobId !== receipt.jobId
              || metadata.imageId !== receipt.imageId || metadata.storagePath !== receipt.storagePath) throw new Error('fashion_studio_ack_identity_mismatch');
            if (JSON.stringify(adapters.ackStore.read(captured.scope)) !== JSON.stringify(captured.checkpoint)) throw new Error('fashion_studio_ack_checkpoint_conflict');
            await adapters.acknowledgeImageAction(receipt, context); check();
            adapters.ackStore.clear(captured.checkpoint);
            const outcome: FashionStudioGenerationOutcome = { status: 'success', requestId: receipt.requestId, stage: 'completed', document };
            recovery = undefined;
            return outcome;
          } catch (error) {
            return { status: active ? 'failure' : 'stale', requestId: captured.checkpoint.requestId, stage: 'acknowledgement', error: message(error) };
          }
        });
        captured.flight = flight;
        void flight.finally(() => { if (captured.flight === flight) captured.flight = undefined; });
        return flight;
      }
      if (recoveryError) return Promise.reject(new Error('fashion_studio_ack_checkpoint_invalid'));
      if (!current) return Promise.reject(new Error('fashion_studio_generation_attempt_missing'));
      return run(current);
    },
    dispose() { active = false; },
  };
};
