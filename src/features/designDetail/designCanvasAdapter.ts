import { namedProjectTitle } from '../../lib/projectNames';
import { getCanvasDocument, updateCanvasDocument, type CanvasDocumentRecord } from '../../lib/canvasDocumentPersistence';
import type { DesignDialogueManifestReference } from '../../lib/designDialogueReferences';
import type { DesignScope, DesignTurn, DesignTurnOutput } from './types';
import { resolveGeneratedImageUrlWithStatus } from '../../lib/storage';

export async function measureDesignImage(storagePath: string) {
  const resolution = await resolveGeneratedImageUrlWithStatus(storagePath);
  if (!resolution.ok) throw new Error('design_image_dimensions_unavailable');
  const image = new Image();
  image.src = resolution.url;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('design_image_dimensions_unavailable');
  return { width: image.naturalWidth, height: image.naturalHeight };
}
export type DesignCanvasClient = { getDocument: typeof getCanvasDocument; updateDocument: typeof updateCanvasDocument;
  measureImage: (storagePath: string) => Promise<{ width: number; height: number }> };
export const designCanvasClient: DesignCanvasClient = { getDocument: getCanvasDocument, updateDocument: updateCanvasDocument, measureImage: measureDesignImage };
export function verifyDesignCanvas(document: CanvasDocumentRecord, scope: DesignScope, projectId: string) {
  if (!document || document.id !== projectId || document.ownerId !== scope.userId || document.brandId !== scope.brandId
    || document.snapshotVersion !== 1 || document.snapshot?.version !== 1
    || (document.snapshot.projectId != null && document.snapshot.projectId !== projectId)
    || !Array.isArray(document.snapshot.objects) || !Number.isSafeInteger(document.revision) || document.revision < 0) throw new Error('design_canvas_scope_unverified');
  const ids = document.snapshot.objects.map((item) => item.id);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('design_canvas_objects_ambiguous');
  return document;
}
const metadata = (object: Record<string, unknown>) => object.metadata && typeof object.metadata === 'object' && !Array.isArray(object.metadata)
  ? object.metadata as Record<string, unknown> : {};
const matchesOutput = (object: Record<string, unknown>, output: DesignTurnOutput) => {
  const meta = metadata(object);
  return object.type === 'image' && object.src === output.storagePath && meta.feature === 'design-dialogue-output'
    && meta.imageId === output.imageId && meta.storagePath === output.storagePath && meta.jobId === output.jobId
    && meta.persistenceStatus === 'completed';
};
export function selectedDesignReference(document: CanvasDocumentRecord, scope: DesignScope, projectId: string,
  objectId: string, outputs: readonly DesignTurnOutput[]): DesignDialogueManifestReference {
  verifyDesignCanvas(document, scope, projectId);
  const object = document.snapshot.objects.find((item) => item.id === objectId);
  const output = outputs.find((item) => object && matchesOutput(object, item));
  if (!object || !output || output.storagePath !== `generated-images/${output.imageId}`) throw new Error('design_selected_output_unverified');
  return { order: 0, kind: 'upload', imageId: output.imageId, storagePath: output.storagePath,
    name: typeof object.label === 'string' && object.label.trim() ? object.label : 'デザイン画像' };
}

export function createDesignCanvasAdapter(options: { scope: DesignScope; projectId: string; conversationId: string;
  assertContext: () => void; client?: DesignCanvasClient; publish?: (document: CanvasDocumentRecord) => void }) {
  const { scope, projectId, conversationId, assertContext } = options;
  const client = options.client ?? designCanvasClient;
  const context = { userId: scope.userId, assertContext };
  const read = async () => { assertContext(); const document = await client.getDocument(projectId, scope.brandId, context); assertContext();
    return verifyDesignCanvas(document, scope, projectId); };
  return {
    read,
    async adoptOutputs(expectedScope: DesignScope, turn: DesignTurn, outputs: readonly DesignTurnOutput[]) {
      assertContext();
      if (expectedScope.userId !== scope.userId || expectedScope.brandId !== scope.brandId || !outputs.length) throw new Error('design_canvas_scope_mismatch');
      const before = await read();
      const identities = outputs.map((output) => `design-${turn.turnId}-${output.candidateIndex}`);
      const retained = before.snapshot.objects;
      const additions: Record<string, unknown>[] = [];
      for (const [index, output] of outputs.entries()) {
        if (output.storagePath !== `generated-images/${output.imageId}` || output.jobId !== turn.jobId) throw new Error('design_canvas_output_invalid');
        const id = identities[index];
        const existing = retained.find((item) => item.id === id);
        if (existing) {
          if (!matchesOutput(existing, output)) throw new Error('design_canvas_output_conflict');
          continue;
        }
        const dimensions = await client.measureImage(output.storagePath); assertContext();
        if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) throw new Error('design_image_dimensions_invalid');
        const scale = Math.min(440 / dimensions.width, 440 / dimensions.height, 1);
        additions.push({ id, type: 'image', src: output.storagePath, label: `デザイン ${retained.filter((item) => item.type === 'image').length + index + 1}`,
          x: 80 + ((retained.length + index) % 3) * 480, y: 80 + Math.floor((retained.length + index) / 3) * 480,
          width: dimensions.width * scale, height: dimensions.height * scale, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, visible: true,
          zIndex: retained.reduce((max, item) => Math.max(max, typeof item.zIndex === 'number' ? item.zIndex : 0), 0) + index + 1,
          metadata: { feature: 'design-dialogue-output', prompt: turn.prompt, imageId: output.imageId, storagePath: output.storagePath,
            jobId: output.jobId, persistenceStatus: 'completed', parameters: { conversationId, turnId: turn.turnId, requestId: turn.requestId, candidateIndex: output.candidateIndex,
              outputWidth: dimensions.width, outputHeight: dimensions.height } } });
      }
      if (additions.length) {
        assertContext();
        try {
          await client.updateDocument({ documentId: projectId, brandId: scope.brandId, title: namedProjectTitle(before.title, turn.prompt),
            expectedRevision: before.revision, snapshot: { ...before.snapshot, objects: [...retained, ...additions] } }, context);
        } catch { assertContext(); /* A lost PATCH or CAS conflict can only be resolved by this exact GET. */ }
      }
      const verified = await read();
      if (!outputs.every((output, index) => {
        const object = verified.snapshot.objects.find((item) => item.id === identities[index]);
        return object && matchesOutput(object, output);
      })) throw new Error('design_canvas_adoption_unverified');
      assertContext(); options.publish?.(verified);
    },
  };
}
