import type { CanvasObject } from '../stores/canvasStore';

type ExtendedCanvasMetadata = CanvasObject['metadata'] & {
  source?: string;
  maskApplied?: boolean;
};

export const buildCanvasGenerationState = (objects: CanvasObject[]) => {
  const imageObjects = objects
    .filter((object) => object.type === 'image')
    .map((object) => {
      const metadata = object.metadata as ExtendedCanvasMetadata | undefined;
      const parameters = metadata?.parameters && typeof metadata.parameters === 'object'
        ? metadata.parameters as Record<string, unknown>
        : {};
      return {
        objectId: object.id,
        parentObjectId: object.derivedFrom ?? metadata?.parentObjectId ?? null,
        feature: metadata?.feature ?? null,
        generation: typeof metadata?.generation === 'number' ? metadata.generation : null,
        source: metadata?.source ?? null,
        maskApplied: metadata?.maskApplied === true,
        hasBackendJobId: typeof parameters.backendJobId === 'string' && parameters.backendJobId.length > 0,
        hasBackendImageId: typeof parameters.backendImageId === 'string' && parameters.backendImageId.length > 0,
        hasBackendStoragePath: typeof parameters.backendStoragePath === 'string' && parameters.backendStoragePath.length > 0,
        backendProvider: typeof metadata?.backendProvider === 'string'
          ? metadata.backendProvider
          : (typeof parameters.backendProvider === 'string' ? parameters.backendProvider : null),
        provider: typeof metadata?.provider === 'string'
          ? metadata.provider
          : (typeof parameters.provider === 'string' ? parameters.provider : null),
        status: typeof metadata?.status === 'string'
          ? metadata.status
          : (typeof parameters.status === 'string' ? parameters.status : null),
        persistenceStatus: typeof metadata?.persistenceStatus === 'string'
          ? metadata.persistenceStatus
          : (typeof parameters.persistenceStatus === 'string' ? parameters.persistenceStatus : null),
      };
    })
    .sort((left, right) => left.objectId.localeCompare(right.objectId));
  const derivedObjects = imageObjects.filter((object) => object.parentObjectId !== null);
  const partialEditObjects = derivedObjects.filter(
    (object) => object.feature === 'inpaint' && object.maskApplied,
  );

  return {
    schema: 'heavy-chain.canvas-generation-state.v1' as const,
    imageCount: imageObjects.length,
    sourceImageCount: imageObjects.length - derivedObjects.length,
    gallerySourceCount: imageObjects.filter((object) => object.source === 'gallery-selector').length,
    derivedResultCount: derivedObjects.length,
    partialEditResultCount: partialEditObjects.length,
    maxGeneration: imageObjects.reduce(
      (maximum, object) => Math.max(maximum, object.generation ?? 0),
      0,
    ),
    objects: imageObjects,
  };
};
