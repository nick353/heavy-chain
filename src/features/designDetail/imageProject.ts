import type { CanvasDocumentRecord } from '../../lib/canvasDocumentPersistence';
import type { DesignDialogueManifestReference } from '../../lib/designDialogueReferences';
import type { DesignEntryClient } from './designEntryCoordinator';
import type { DesignScope } from './types';

const IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** One Canvas project per (user, brand, image): reopening the same image card opens the same project, like Light's project cards. */
export async function imageProjectId(scope: DesignScope, imageId: string) {
  const bytes = new TextEncoder().encode(JSON.stringify([scope.userId, scope.brandId, imageId]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `imgp-${[...digest.slice(0, 20)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Returns the project for this image, creating it with the image placed on the canvas the first time. */
export async function openImageProject(options: { scope: DesignScope; imageId: string; assertContext: () => void;
  client: Pick<DesignEntryClient, 'createDocument' | 'getDocument'>; measure: (storagePath: string) => Promise<{ width: number; height: number }> }): Promise<CanvasDocumentRecord> {
  const { scope, imageId, assertContext, client } = options;
  if (!IMAGE_ID.test(imageId)) throw new Error('design_image_project_invalid');
  const context = { userId: scope.userId, assertContext };
  const projectId = await imageProjectId(scope, imageId); assertContext();
  const read = async () => {
    const document = await client.getDocument(projectId, scope.brandId, context);
    if (!document || document.id !== projectId || document.ownerId !== scope.userId || document.brandId !== scope.brandId
      || document.snapshot?.version !== 1 || !Array.isArray(document.snapshot.objects)) throw new Error('design_image_project_unverified');
    return document;
  };
  try { return await read(); } catch { assertContext(); }
  const storagePath = `generated-images/${imageId}`;
  const dimensions = await options.measure(storagePath); assertContext();
  const scale = Math.min(440 / dimensions.width, 440 / dimensions.height, 1);
  try {
    await client.createDocument({ documentId: projectId, brandId: scope.brandId, title: 'Untitled', snapshot: { version: 1, projectId, objects: [{
      id: `image-${imageId}`, type: 'image', src: storagePath, label: 'デザイン 1', x: 80, y: 80,
      width: dimensions.width * scale, height: dimensions.height * scale, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, visible: true, zIndex: 1,
      metadata: { feature: 'library-import', imageId, storagePath, galleryImageId: imageId, galleryStoragePath: storagePath },
    }] } }, context);
  } catch { assertContext(); /* unknown effect: the same deterministic ID is read back below */ }
  const document = await read(); assertContext();
  return document;
}

/** A canvas image saved in generated-images can be sent as a reference even when it did not come from this chat. */
export function canvasImageReference(object: Record<string, unknown> | undefined): DesignDialogueManifestReference | null {
  const src = typeof object?.src === 'string' ? object.src : '';
  const match = /^generated-images\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(src);
  if (!match) return null;
  const label = typeof object?.label === 'string' ? object.label.replace(/[\\/?#\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 120) : '';
  return { order: 0, kind: 'upload', imageId: match[1], storagePath: src, name: label || 'デザイン画像' };
}
