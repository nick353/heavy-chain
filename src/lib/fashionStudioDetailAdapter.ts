import { extractFashionStudioSavedDetail, type FashionStudioDetailRole, type FashionStudioSavedDetail } from './fashionStudioDetailHydration.ts';
import type { CanvasDocumentRecord, CanvasDocumentSnapshot, CanvasDocumentRequestContext } from './canvasDocumentPersistence';
import type { FashionStudioGenerationHandoff, FashionStudioGenerationAdapters } from './fashionStudioDetailGeneration';
import type { ArtifactPersistenceContext } from './cloudflareApi';
import type { StudioAckStore } from './fashionStudioPendingAck';

export const FASHION_STUDIO_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
export const validateFashionStudioUpload = (file: Pick<File, 'size' | 'type'>) => {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) throw new Error('fashion_studio_upload_format_invalid');
  if (!file.size || file.size > FASHION_STUDIO_UPLOAD_MAX_BYTES) throw new Error('fashion_studio_upload_size_invalid');
};
export const readFashionStudioUpload = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' && /^data:image\//.test(reader.result) ? resolve(reader.result) : reject(new Error('fashion_studio_upload_read_invalid'));
  reader.onerror = () => reject(reader.error ?? new Error('fashion_studio_upload_read_failed'));
  reader.onabort = () => reject(new Error('fashion_studio_upload_cancelled'));
  reader.readAsDataURL(file);
});
const roleObject = (snapshot: CanvasDocumentSnapshot, role: FashionStudioDetailRole) => {
  const asset = extractFashionStudioSavedDetail(snapshot).roles[role];
  if (asset.status === 'ambiguous') throw new Error(`fashion_studio_${role}_role_ambiguous`);
  if (!asset.objectId) {
    // Missing src is still an existing explicit role; hydration retains its ID.
    const labels = { main: ['main', 'main-image', 'original-base'], reference: ['reference', 'material-reference', 'extracted-cutout'], result: ['result', 'generated-result'] };
    const suffix = { main: '-original-base-layer', reference: '-material-reference', result: '-generated-result' };
    if (asset.status === 'available' || snapshot.objects.some(object => {
      const metadata = record(object.metadata);
      return object.type === 'image' && (labels[role].includes(String(record(metadata.parameters).layerRole))
        || (typeof metadata.feature === 'string' && metadata.feature.endsWith(suffix[role])));
    })) throw new Error(`fashion_studio_${role}_identity_invalid`);
    return undefined;
  }
  const matches = snapshot.objects.filter(object => object.id === asset.objectId);
  if (matches.length !== 1) throw new Error(`fashion_studio_${role}_identity_ambiguous`);
  return matches[0];
};
const sameRole = (left: CanvasDocumentSnapshot, right: CanvasDocumentSnapshot, role: FashionStudioDetailRole) => {
  if (JSON.stringify(roleObject(left, role)) !== JSON.stringify(roleObject(right, role))) throw new Error(`fashion_studio_${role}_role_changed`);
};
export const findFashionStudioOperationResult = (snapshot: CanvasDocumentSnapshot, operationId: string) => {
  const matches = snapshot.objects.filter(object => record(record(object.metadata).parameters).generationOperationId === operationId);
  if (matches.length > 1) throw new Error('fashion_studio_operation_ambiguous');
  if (matches.length && roleObject(snapshot, 'result') !== matches[0]) throw new Error('fashion_studio_operation_role_invalid');
  return matches[0];
};
export type FashionStudioCanonicalImage = { jobId: string; imageId: string; storagePath: string };
export const replaceFashionStudioRole = (snapshot: CanvasDocumentSnapshot, role: FashionStudioDetailRole, remote: FashionStudioCanonicalImage, operationId: string, prompt = ''): CanvasDocumentSnapshot => {
  if (!remote.jobId || !remote.imageId || !remote.storagePath || /^(?:blob|data):/i.test(remote.storagePath)) throw new Error('fashion_studio_canonical_image_invalid');
  const previous = roleObject(snapshot, role);
  const metadata = record(previous?.metadata);
  const parameters = record(metadata.parameters);
  const positions = { main: [180, 300], reference: [600, 180], result: [1150, 220] };
  const [x, y] = positions[role];
  const replacement = {
    ...(previous ?? { id: crypto.randomUUID(), type: 'image', x, y, width: 360, height: 480, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, visible: true, locked: false }),
    src: remote.storagePath,
    metadata: { ...metadata, feature: `fashion-studio-detail-${role === 'main' ? 'original-base-layer' : role === 'reference' ? 'material-reference' : 'generated-result'}`,
      prompt, jobId: remote.jobId, imageId: remote.imageId, storagePath: remote.storagePath, persistenceStatus: 'completed',
      parameters: { ...parameters, layerRole: role === 'main' ? 'original-base' : role === 'reference' ? 'material-reference' : 'generated-result',
        ...(role === 'result' ? { generationOperationId: operationId } : { inputOperationId: operationId }), prompt } },
  };
  return { ...snapshot, objects: previous ? snapshot.objects.map(object => object === previous ? replacement : object) : [...snapshot.objects, replacement] };
};
export const buildFashionStudioGeneratedSnapshot = (document: CanvasDocumentRecord, handoff: FashionStudioGenerationHandoff) => {
  sameRole(handoff.baseDocument.snapshot, document.snapshot, 'result');
  const main = roleObject(document.snapshot, 'main');
  if (!main || main.id !== handoff.input.main.objectId) throw new Error('fashion_studio_main_role_changed');
  return replaceFashionStudioRole(document.snapshot, 'result', handoff.persisted.remote, handoff.requestId, handoff.input.prompt);
};
export const createFashionStudioGenerationAdapters = (dependencies: {
  ackStore?: StudioAckStore;
  assertScope: FashionStudioGenerationAdapters['assertScope'];
  capturePersistenceContext(context: CanvasDocumentRequestContext): Promise<ArtifactPersistenceContext>;
  editImageWithPrompt: (imageUrl: string, prompt: string, brandId: string, options: Parameters<FashionStudioGenerationAdapters['editImageWithPrompt']>[3] & { retainUntilAcknowledged: true }) => ReturnType<FashionStudioGenerationAdapters['editImageWithPrompt']>;
  resolveImage(source: string): Promise<{ ok: boolean; url?: string | null }>;
  assertCompletedImageEditResult: FashionStudioGenerationAdapters['assertCompletedImageEditResult'];
  persistProviderResultArtifact: (input: Parameters<FashionStudioGenerationAdapters['persistProviderResultArtifact']>[0], options: { persistenceContext: ArtifactPersistenceContext }) => ReturnType<FashionStudioGenerationAdapters['persistProviderResultArtifact']>;
  getCanvasDocument: FashionStudioGenerationAdapters['getCanvasDocument'];
  updateCanvasDocument: FashionStudioGenerationAdapters['updateCanvasDocument'];
  acknowledgeImageAction: FashionStudioGenerationAdapters['acknowledgeImageAction'];
  activity(stage: 'generating' | 'saving'): void;
  publishSuccess: NonNullable<FashionStudioGenerationAdapters['publishSuccess']>;
  committedInputs(): FashionStudioSavedDetail;
}): FashionStudioGenerationAdapters => {
  let scope: Parameters<FashionStudioGenerationAdapters['assertScope']>[0] | undefined;
  let activeRequestId = '';
  const attempts = new Map<string, { persistenceContext: ArtifactPersistenceContext; document: CanvasDocumentRecord }>();
  return {
  ackStore: dependencies.ackStore,
  prepareAcknowledgement: async (expected, requestId, context) => {
    dependencies.assertScope(expected); context.assertContext();
    const persistenceContext = await dependencies.capturePersistenceContext(context);
    await persistenceContext.assertCurrent(); context.assertContext();
    const document = await dependencies.getCanvasDocument(expected.documentId, expected.brandId, context);
    await persistenceContext.assertCurrent(); context.assertContext();
    if (document.id !== expected.documentId || document.ownerId !== expected.userId || document.brandId !== expected.brandId) throw new Error('fashion_studio_generation_document_scope_mismatch');
    scope = { ...expected }; activeRequestId = requestId;
    attempts.set(requestId, { persistenceContext, document: structuredClone(document) });
    return document;
  },
  assertScope: expected => { dependencies.assertScope(expected); scope = { ...expected }; },
  editImageWithPrompt: async (imageUrl, prompt, brandId, options) => {
    options.assertContext();
    activeRequestId = options.idempotencyKey;
    if (!scope || scope.brandId !== brandId || scope.documentId !== options.canvasProjectId) throw new Error('fashion_studio_generation_scope_invalid');
    let attempt = attempts.get(options.idempotencyKey);
    if (!attempt) {
      const committed = structuredClone(dependencies.committedInputs());
      const context = { userId: scope.userId, assertContext: options.assertContext };
      const persistenceContext = await dependencies.capturePersistenceContext(context);
      await persistenceContext.assertCurrent(); options.assertContext();
      const document = await dependencies.getCanvasDocument(scope.documentId, scope.brandId, context);
      await persistenceContext.assertCurrent(); options.assertContext();
      if (document.id !== scope.documentId || document.ownerId !== scope.userId || document.brandId !== scope.brandId) throw new Error('fashion_studio_generation_document_scope_mismatch');
      const fresh = extractFashionStudioSavedDetail(document.snapshot);
      for (const role of ['main', 'reference'] as const) {
        if (JSON.stringify(fresh.roles[role]) !== JSON.stringify(committed.roles[role])) throw new Error(`fashion_studio_${role}_role_changed`);
        roleObject(document.snapshot, role);
      }
      if (fresh.roles.main.objectId !== options.parentObjectId) throw new Error('fashion_studio_main_role_changed');
      roleObject(document.snapshot, 'result');
      attempt = { persistenceContext, document: structuredClone(document) }; attempts.set(options.idempotencyKey, attempt);
    }
    await attempt.persistenceContext.assertCurrent(); options.assertContext(); dependencies.activity('generating');
    const references = await Promise.all(options.referenceImageUrls.map(async source => {
      const resolved = await dependencies.resolveImage(source); options.assertContext();
      if (!resolved.ok || !resolved.url) throw new Error('fashion_studio_reference_unverified');
      return resolved.url;
    }));
    options.assertContext();
    const result = await dependencies.editImageWithPrompt(imageUrl, prompt, brandId, { ...options, referenceImageUrls: references, retainUntilAcknowledged: true });
    await attempt.persistenceContext.assertCurrent(); options.assertContext(); return result;
  },
  assertCompletedImageEditResult: dependencies.assertCompletedImageEditResult,
  persistProviderResultArtifact: async (input, context) => {
    context.assertContext(); dependencies.activity('saving');
    const requestId = input.metadata?.requestId;
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('fashion_studio_workspace_identity_invalid');
    const attempt = attempts.get(requestId);
    if (!attempt) throw new Error('fashion_studio_generation_attempt_missing');
    const persistenceContext = attempt.persistenceContext;
    await persistenceContext.assertCurrent(); context.assertContext();
    const persisted = await dependencies.persistProviderResultArtifact({ ...input, metadata: { ...input.metadata, cloudflareWorkspaceRequestId: requestId } }, { persistenceContext });
    await persistenceContext.assertCurrent(); context.assertContext(); return persisted;
  },
  getCanvasDocument: async (...args) => {
    const attempt = attempts.get(activeRequestId); if (!attempt) throw new Error('fashion_studio_generation_attempt_missing');
    await attempt.persistenceContext.assertCurrent(); args[2].assertContext();
    const document = await dependencies.getCanvasDocument(...args);
    await attempt.persistenceContext.assertCurrent(); args[2].assertContext(); return document;
  },
  updateCanvasDocument: async (...args) => {
    const attempt = attempts.get(activeRequestId); if (!attempt) throw new Error('fashion_studio_generation_attempt_missing');
    await attempt.persistenceContext.assertCurrent(); args[1].assertContext();
    const document = await dependencies.updateCanvasDocument(...args);
    await attempt.persistenceContext.assertCurrent(); args[1].assertContext(); return document;
  },
  buildUpdatedSnapshot: (document, handoff) => {
    const attempt = attempts.get(handoff.requestId);
    if (!attempt) throw new Error('fashion_studio_generation_attempt_missing');
    for (const role of ['main', 'reference', 'result'] as const) sameRole(attempt.document.snapshot, document.snapshot, role);
    return buildFashionStudioGeneratedSnapshot(document, handoff);
  }, findOperationResult: findFashionStudioOperationResult,
  acknowledgeImageAction: async (...args) => {
    const attempt = attempts.get(String(args[0].requestId)); if (!attempt) throw new Error('fashion_studio_generation_attempt_missing');
    await attempt.persistenceContext.assertCurrent(); args[1].assertContext();
    await dependencies.acknowledgeImageAction(...args);
    await attempt.persistenceContext.assertCurrent(); args[1].assertContext();
  }, publishSuccess: dependencies.publishSuccess,
};
};

export type FashionStudioInputScope = { userId: string; brandId: string; documentId: string; generation: number };
export type FashionStudioInputState = { status: 'preparing' | 'saving' | 'recovering' | 'success' | 'failure'; preview?: string; role: 'main' | 'reference'; error?: string; recoverable?: boolean; document?: CanvasDocumentRecord };
export type FashionStudioInputAdapters = {
  assertScope(scope: FashionStudioInputScope): void;
  readFile(file: Blob): Promise<string>;
  begin?(requestId: string, scope: FashionStudioInputScope, context: CanvasDocumentRequestContext): Promise<void>;
  saveInput(input: { requestId: string; scope: FashionStudioInputScope; imageUrl: string; role: 'main' | 'reference' }, context: CanvasDocumentRequestContext): Promise<FashionStudioCanonicalImage>;
  recoverInput(requestId: string, scope: FashionStudioInputScope, context: CanvasDocumentRequestContext): Promise<FashionStudioCanonicalImage>;
  getDocument(id: string, brandId: string, context: CanvasDocumentRequestContext): Promise<CanvasDocumentRecord>;
  createDocument(input: { documentId: string; brandId: string; title: string; snapshot: CanvasDocumentSnapshot }, context: CanvasDocumentRequestContext): Promise<CanvasDocumentRecord>;
  updateDocument(input: { documentId: string; brandId: string; title: string; snapshot: CanvasDocumentSnapshot; expectedRevision: number }, context: CanvasDocumentRequestContext): Promise<CanvasDocumentRecord>;
  publish(state: FashionStudioInputState): void;
  committed(document: CanvasDocumentRecord, scope: FashionStudioInputScope): void;
  requestId?(): string;
};
/** Retain uncertain writes and recover their exact identities; never repeat a POST. */
export const createFashionStudioInputController = (adapters: FashionStudioInputAdapters) => {
  type Attempt = { scope: FashionStudioInputScope; role: 'main' | 'reference'; file: File; requestId: string; documentId: string; begun?: boolean; remote?: FashionStudioCanonicalImage; preview?: string; uploadSent: boolean; documentSent: boolean; base?: CanvasDocumentRecord; state?: FashionStudioInputState; flight?: Promise<FashionStudioInputState> };
  let active = true;
  let current: Attempt | undefined;
  const execute = async (attempt: Attempt): Promise<FashionStudioInputState> => {
    const assertContext = () => { if (!active || current !== attempt) throw new Error('fashion_studio_upload_scope_stale'); adapters.assertScope(attempt.scope); };
    const context = { userId: attempt.scope.userId, assertContext };
    const emit = (state: FashionStudioInputState) => { assertContext(); attempt.state = state; adapters.publish(state); return state; };
    const verified = (document: CanvasDocumentRecord) => {
      if (document.id !== attempt.documentId || document.ownerId !== attempt.scope.userId || document.brandId !== attempt.scope.brandId
        || !Number.isSafeInteger(document.revision) || !Array.isArray(document.snapshot?.objects)) throw new Error('fashion_studio_upload_document_unverified');
      return document;
    };
    try {
      assertContext();
      if (!attempt.begun) { await adapters.begin?.(attempt.requestId, attempt.scope, context); assertContext(); attempt.begun = true; }
      if (attempt.scope.documentId && !attempt.base) {
        attempt.base = structuredClone(verified(await adapters.getDocument(attempt.documentId, attempt.scope.brandId, context)));
        assertContext(); roleObject(attempt.base.snapshot, attempt.role);
      }
      if (!attempt.preview) {
        emit({ status: 'preparing', role: attempt.role });
        validateFashionStudioUpload(attempt.file);
        attempt.preview = await adapters.readFile(attempt.file); assertContext();
      }
      emit({ status: attempt.uploadSent ? 'recovering' : 'saving', role: attempt.role, preview: attempt.preview });
      if (!attempt.remote) {
        const recover = attempt.uploadSent; attempt.uploadSent = true;
        attempt.remote = recover ? await adapters.recoverInput(attempt.requestId, attempt.scope, context)
          : await adapters.saveInput({ requestId: attempt.requestId, scope: attempt.scope, imageUrl: attempt.preview, role: attempt.role }, context);
        assertContext();
      }
      const remote = attempt.remote;
      if (!remote.jobId || !remote.imageId || !remote.storagePath) throw new Error('fashion_studio_upload_remote_unverified');
      const isCommitted = (document: CanvasDocumentRecord) => {
        const object = roleObject(document.snapshot, attempt.role);
        return object?.src === remote.storagePath && record(record(object?.metadata).parameters).inputOperationId === attempt.requestId
          && record(object?.metadata).imageId === remote.imageId && record(object?.metadata).jobId === remote.jobId;
      };
      let document: CanvasDocumentRecord;
      if (attempt.scope.documentId) {
        document = verified(await adapters.getDocument(attempt.documentId, attempt.scope.brandId, context)); assertContext();
        if (!isCommitted(document)) {
          if (attempt.documentSent) throw new Error('fashion_studio_upload_document_reconciliation_required');
          sameRole(attempt.base!.snapshot, document.snapshot, attempt.role);
          const snapshot = replaceFashionStudioRole(document.snapshot, attempt.role, remote, attempt.requestId);
          attempt.documentSent = true;
          try { await adapters.updateDocument({ documentId: document.id, brandId: document.brandId, title: document.title, expectedRevision: document.revision, snapshot }, context); }
          catch (error) { assertContext(); document = verified(await adapters.getDocument(attempt.documentId, attempt.scope.brandId, context));
            if (!isCommitted(document)) { sameRole(attempt.base!.snapshot, document.snapshot, attempt.role); throw new Error(`fashion_studio_upload_document_reconciliation_required:${errorMessage(error)}`); } }
          assertContext(); document = verified(await adapters.getDocument(attempt.documentId, attempt.scope.brandId, context));
        }
      } else {
        if (!attempt.documentSent) {
          const snapshot = replaceFashionStudioRole({ version: 1, objects: [], view: { zoom: 0.3, panX: 0, panY: 0, gridVisible: false, snapToGrid: false, gridSize: 20 } }, 'main', remote, attempt.requestId);
          attempt.documentSent = true;
          try { await adapters.createDocument({ documentId: attempt.documentId, brandId: attempt.scope.brandId, title: 'Untitled', snapshot }, context); }
          catch { assertContext(); /* uncertain create reconciles the same ID below */ }
        }
        document = verified(await adapters.getDocument(attempt.documentId, attempt.scope.brandId, context));
      }
      assertContext();
      if (!isCommitted(document)) throw new Error('fashion_studio_upload_document_readback_unverified');
      adapters.committed(document, attempt.scope);
      return emit({ status: 'success', role: attempt.role, document });
    } catch (error) {
      const state: FashionStudioInputState = { status: 'failure', role: attempt.role, error: errorMessage(error), recoverable: attempt.uploadSent || attempt.documentSent };
      try { return emit(state); } catch { return state; }
    }
  };
  const run = (attempt: Attempt) => {
    if (attempt.flight) return attempt.flight;
    const flight = Promise.resolve().then(() => execute(attempt)); attempt.flight = flight;
    void flight.then(() => { if (attempt.flight === flight) attempt.flight = undefined; }); return flight;
  };
  return {
    start(file: File, role: 'main' | 'reference', scope: FashionStudioInputScope) {
      if (!active) return Promise.reject(new Error('fashion_studio_upload_scope_stale'));
      adapters.assertScope(scope); validateFashionStudioUpload(file);
      if (current?.flight || (current?.state?.status === 'failure' && (current.uploadSent || current.documentSent))) return Promise.reject(new Error('fashion_studio_upload_recovery_required'));
      current = { scope: { ...scope }, role, file, requestId: adapters.requestId?.() ?? crypto.randomUUID(), documentId: scope.documentId || crypto.randomUUID(), uploadSent: false, documentSent: false };
      return run(current);
    },
    retry() { if (!current) return Promise.reject(new Error('fashion_studio_upload_attempt_missing')); return run(current); },
    dispose() { active = false; },
  };
};
