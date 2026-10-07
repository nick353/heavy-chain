import type { FittingBatchReceipt, FittingBatchScope, FittingBatchTask } from './fittingBatch';
import type { ArtifactPersistenceContext } from './cloudflareApi';
import { saveWorkspaceArtifactBestEffort, findWorkspaceArtifactPersisted, type WorkspaceArtifactInput } from './localWorkspaceArtifacts';
import { buildCanvasDocumentSnapshot } from './canvasDocumentPersistence';
import { initialCanvasDocumentId, readCanvasSaveRecovery, saveCanvasDocumentRecoverably, inspectCanvasSaveRecovery, type CanvasSaveTransport } from './canvasDocumentSaveRecovery';
import type { CanvasObject } from '../stores/canvasStore';

type Options = {
  origin: string;
  scope: FittingBatchScope;
  transport: CanvasSaveTransport;
  assertCurrent: () => void;
  persistenceContext: ArtifactPersistenceContext;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canvasScope = (options: Options) => ({ origin: options.origin, userId: options.scope.userId, brandId: options.scope.brandId });
export const fittingBatchDocumentId = (options: Options, task: FittingBatchTask) =>
  initialCanvasDocumentId(canvasScope(options), `fitting-batch:${options.scope.featureId}:${task.id}`);

/** Uses the existing workspace and Canvas save contracts. No global Canvas draft is mounted/replaced. */
export function createFittingBatchHandoff(options: Options) {
  return async (task: FittingBatchTask, receipt: FittingBatchReceipt): Promise<void> => {
    options.assertCurrent();
    if (!uuid.test(task.id) || !uuid.test(task.requestId) || receipt.requestId !== task.requestId
      || !receipt.jobId || receipt.state !== 'completed' || !receipt.success
      || receipt.persistenceStatus !== 'completed' || !receipt.clientRecoveryKey || receipt.images?.length !== 1) {
      throw new Error('fitting_batch_handoff_identity_invalid');
    }
    const image = receipt.images[0];
    if (!image.imageId || image.storagePath !== `generated-images/${image.imageId}` || !image.imageUrl) {
      throw new Error('fitting_batch_handoff_result_invalid');
    }
    const documentId = await fittingBatchDocumentId(options, task);
    options.assertCurrent();
    const featureType = `lightchain-${options.scope.featureId}`;
    const title = `試着 ${task.input.garmentName}`.slice(0, 160);
    const persist = async (input: WorkspaceArtifactInput, reuseCanonicalRemoteArtifact: boolean) => {
      options.assertCurrent();
      const result = await saveWorkspaceArtifactBestEffort(input, {
        reuseCanonicalRemoteArtifact, persistenceContext: options.persistenceContext,
      });
      options.assertCurrent();
      if (!result.remote || !result.localPersisted || result.remoteError || result.localError) {
        throw new Error('fitting_batch_workspace_not_saved');
      }
      const remote = result.remote;
      const readback = findWorkspaceArtifactPersisted(options.scope.brandId, input.id!, options.scope.userId);
      if (!readback.ok || !readback.artifact || readback.artifact.canvasProjectId !== documentId
        || readback.artifact.sourceJobId !== remote.jobId || readback.artifact.metadata.remoteImageId !== remote.imageId
        || readback.artifact.metadata.remoteStoragePath !== remote.storagePath
        || remote.storagePath !== `generated-images/${remote.imageId}`) {
        throw new Error('fitting_batch_workspace_readback_mismatch');
      }
      return remote;
    };
    const sourceId = `fitting-batch:${task.id}:source`;
    const resultId = `fitting-batch:${task.id}:result`;
    const common = { brandId: options.scope.brandId, scopeId: options.scope.userId, featureType, canvasProjectId: documentId };
    const source = await persist({ ...common, id: sourceId, title: `${title} 素材`, imageUrl: task.input.garment,
      prompt: null, metadata: { cloudflareWorkspaceRequestId: task.id, fittingBatchTaskId: task.id,
        fittingBatchRequestId: task.requestId, fittingBatchRole: 'source' } }, false);
    const result = await persist({ ...common, id: resultId, title, imageUrl: image.imageUrl,
      prompt: task.input.prompt, sourceJobId: receipt.jobId,
      metadata: { cloudflareWorkspaceRequestId: task.requestId, fittingBatchTaskId: task.id,
        fittingBatchRequestId: task.requestId, fittingBatchRole: 'result', imageId: image.imageId,
        storagePath: image.storagePath, jobId: receipt.jobId, persistenceStatus: 'completed',
        inputLineage: [{ role: 'garment', sourceImageId: source.imageId, sourceStoragePath: source.storagePath }] } }, true);
    if (result.jobId !== receipt.jobId || result.imageId !== image.imageId || result.storagePath !== image.storagePath) {
      throw new Error('fitting_batch_result_identity_changed');
    }
    const object = (id: string, x: number, saved: typeof source, generation: number): CanvasObject => ({
      id, type: 'image', x, y: 0, width: 512, height: 512, rotation: 0, scaleX: 1, scaleY: 1,
      opacity: 1, locked: false, visible: true, zIndex: generation, src: saved.storagePath,
      metadata: { feature: featureType, generation, jobId: saved.jobId, imageId: saved.imageId,
        storagePath: saved.storagePath, persistenceStatus: 'completed',
        parameters: { fittingBatchTaskId: task.id, fittingBatchRequestId: task.requestId } },
    });
    const sourceObject = object(sourceId, 0, source, 0);
    const resultObject = { ...object(resultId, 544, result, 1), derivedFrom: sourceId };
    const snapshot = buildCanvasDocumentSnapshot({ projectId: documentId, name: title,
      objects: [sourceObject, resultObject], view: { zoom: 1, panX: 0, panY: 0 } });
    options.assertCurrent();
    await saveCanvasDocumentRecoverably({ scope: canvasScope(options), documentId, ownerId: options.scope.userId,
      expectedRevision: readCanvasSaveRecovery(canvasScope(options), documentId)?.revision ?? null,
      content: { title, snapshot }, transport: options.transport, assertCurrent: options.assertCurrent });
    const readback = await inspectCanvasSaveRecovery({ scope: canvasScope(options), documentId,
      transport: options.transport, assertCurrent: options.assertCurrent });
    if (readback.state !== 'saved') throw new Error('fitting_batch_canvas_not_saved');
    options.assertCurrent();
  };
}

/** Reload inspection is GET-only and never invokes the provider or a save. */
export async function readFittingBatchHandoff(options: Options, task: FittingBatchTask) {
  options.assertCurrent();
  return inspectCanvasSaveRecovery({ scope: canvasScope(options), documentId: await fittingBatchDocumentId(options, task),
    transport: options.transport, assertCurrent: options.assertCurrent });
}
