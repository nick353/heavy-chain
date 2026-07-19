export type PrintPlacementLayerState = {
  id: string;
  kind: 'garment' | 'design';
  ready: boolean;
};

export type PrintDesignIdentityInput = {
  url: string;
  galleryImageId?: string;
};

export const printDesignIdentity = (image: PrintDesignIdentityInput): string => {
  const galleryImageId = image.galleryImageId?.trim();
  if (galleryImageId) return `gallery:${galleryImageId}`;
  const url = image.url.trim();
  if (!url) throw new Error('PRINT_DESIGN_IDENTITY_MISSING');
  return `url:${url}`;
};

export const dedupePrintDesignsByIdentity = <Image extends PrintDesignIdentityInput>(
  images: Image[],
): Image[] => {
  const indexByIdentity = new Map<string, number>();
  const deduped: Image[] = [];
  images.forEach((image) => {
    const identity = printDesignIdentity(image);
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex !== undefined) {
      deduped[existingIndex] = image;
      return;
    }
    indexByIdentity.set(identity, deduped.length);
    deduped.push(image);
  });
  return deduped;
};

export const haveSamePrintDesignIdentitySequence = (
  previous: PrintDesignIdentityInput[],
  next: PrintDesignIdentityInput[],
): boolean => previous.length === next.length
  && previous.every((image, index) => (
    printDesignIdentity(image) === printDesignIdentity(next[index])
  ));

export const planPrintDesignInputUpdate = <Image extends PrintDesignIdentityInput>({
  previous,
  incoming,
  cutoutStates,
}: {
  previous: Image[];
  incoming: Image[];
  cutoutStates: Record<number, 'idle' | 'processing' | 'done' | 'error'>;
}) => {
  const nextImages = dedupePrintDesignsByIdentity(incoming);
  const sameIdentitySequence = haveSamePrintDesignIdentitySequence(previous, nextImages);
  const hasRetryableCutout = nextImages.some((_, index) => cutoutStates[index] === 'error');
  const previousIdentities = new Set(previous.map(printDesignIdentity));
  return {
    nextImages,
    duplicateCount: incoming.length - nextImages.length,
    sameIdentitySequence,
    shouldRestartCutout: !sameIdentitySequence || hasRetryableCutout,
    newlyAddedIdentities: nextImages
      .map(printDesignIdentity)
      .filter((identity) => !previousIdentities.has(identity)),
  };
};

export const selectFreshDuplicatePrintDesign = <Image>({
  previous,
  incoming,
}: {
  previous: Array<Image & PrintDesignIdentityInput>;
  incoming: Array<Image & PrintDesignIdentityInput>;
}): (Image & PrintDesignIdentityInput) | null => {
  if (incoming.length <= previous.length) return null;
  const latestAppended = incoming[incoming.length - 1];
  const previousIdentities = new Set(previous.map(printDesignIdentity));
  return previousIdentities.has(printDesignIdentity(latestAppended))
    ? latestAppended
    : null;
};

export const canCommitPrintDesignCutoutRequest = (
  requestId: number,
  currentRequestId: number,
): boolean => requestId === currentRequestId;

export const prunePrintDesignIdentityMap = <Value>(
  identityMap: Map<string, Value>,
  retainedImages: PrintDesignIdentityInput[],
): void => {
  const retainedIdentities = new Set(retainedImages.map(printDesignIdentity));
  identityMap.forEach((_, identity) => {
    if (!retainedIdentities.has(identity)) identityMap.delete(identity);
  });
};

export const resolvePrintDesignMaskEditorIndex = (
  currentLayerIds: string[],
  targetLayerId: string,
): number | null => {
  if (new Set(currentLayerIds).size !== currentLayerIds.length) {
    throw new Error('PRINT_DESIGN_CURRENT_LAYER_ID_DUPLICATE');
  }
  const index = currentLayerIds.indexOf(targetLayerId);
  return index >= 0 ? index : null;
};

export type PrintPlacementSelection = {
  selectedLayerId: string | null;
  pendingLayerId: string | null;
};

export type PrintDesignReturnIntent = {
  targetLayerId: string | null;
  deferred: boolean;
};

export const armPrintDesignReturnIntent = (): PrintDesignReturnIntent => ({
  targetLayerId: null,
  deferred: false,
});

export const bindPrintDesignReturnIntent = (
  intent: PrintDesignReturnIntent | null,
  targetLayerId: string,
): PrintDesignReturnIntent | null => {
  if (!intent) return null;
  if (intent.targetLayerId && intent.targetLayerId !== targetLayerId) return null;
  return intent.targetLayerId ? intent : { targetLayerId, deferred: false };
};

export const deferPrintDesignReturnIntent = (
  intent: PrintDesignReturnIntent | null,
  targetLayerId: string,
): PrintDesignReturnIntent | null => (
  intent?.targetLayerId === targetLayerId
    ? { ...intent, deferred: true }
    : intent
);

export const releasePrintDesignReturnIntent = (
  intent: PrintDesignReturnIntent | null,
  targetLayerId: string,
): PrintDesignReturnIntent | null => (
  intent?.targetLayerId === targetLayerId && intent.deferred
    ? { ...intent, deferred: false }
    : intent
);

export const resolvePrintDesignReturnIntent = ({
  intent,
  activeLayerId,
  expectedLayerIds,
  layers,
}: {
  intent: PrintDesignReturnIntent | null;
  activeLayerId: string | null;
  expectedLayerIds: string[];
  layers: Array<{ id: string; state: 'idle' | 'processing' | 'done' | 'error' }>;
}): { intent: PrintDesignReturnIntent | null; shouldReturn: boolean } => {
  if (!intent || !intent.targetLayerId) return { intent, shouldReturn: false };
  const targetLayerId = intent.targetLayerId;
  if (!expectedLayerIds.includes(targetLayerId) || activeLayerId !== targetLayerId) {
    return { intent: null, shouldReturn: false };
  }
  const targetLayer = layers.find((layer) => layer.id === targetLayerId);
  if (!targetLayer) return { intent, shouldReturn: false };
  if (targetLayer.state === 'error') return { intent: null, shouldReturn: false };
  if (intent.deferred) return { intent, shouldReturn: false };
  if (targetLayer.state !== 'done') return { intent, shouldReturn: false };
  return { intent: null, shouldReturn: true };
};

export const selectPlacedPrintDesignLayers = <Layer extends { id: string }>(
  layers: Layer[],
): Layer[] => {
  if (new Set(layers.map((layer) => layer.id)).size !== layers.length) {
    throw new Error('PRINT_DESIGN_PLACED_LAYER_ID_DUPLICATE');
  }
  return [...layers];
};

export type PrintDesignLayerOrderAction = 'front' | 'forward' | 'backward' | 'back';

const assertUniquePrintDesignLayerIds = <Layer extends { id: string }>(layers: Layer[]) => {
  if (new Set(layers.map((layer) => layer.id)).size !== layers.length) {
    throw new Error('PRINT_DESIGN_LAYER_ORDER_ID_DUPLICATE');
  }
};

export const preservePrintDesignLayerOrder = <Layer extends { id: string }>(
  previousLayers: Layer[],
  materializedLayers: Layer[],
): Layer[] => {
  assertUniquePrintDesignLayerIds(previousLayers);
  assertUniquePrintDesignLayerIds(materializedLayers);
  const nextById = new Map(materializedLayers.map((layer) => [layer.id, layer]));
  const previousIds = new Set(previousLayers.map((layer) => layer.id));
  return [
    ...previousLayers.flatMap((layer) => {
      const current = nextById.get(layer.id);
      return current ? [current] : [];
    }),
    ...materializedLayers.filter((layer) => !previousIds.has(layer.id)),
  ];
};

export const reorderPrintDesignLayers = <Layer extends { id: string }>(
  layers: Layer[],
  layerId: string,
  action: PrintDesignLayerOrderAction,
): Layer[] => {
  assertUniquePrintDesignLayerIds(layers);
  const currentIndex = layers.findIndex((layer) => layer.id === layerId);
  if (currentIndex < 0 || layers.length < 2) return layers;
  const targetIndex = action === 'front'
    ? layers.length - 1
    : action === 'forward'
      ? Math.min(layers.length - 1, currentIndex + 1)
      : action === 'backward'
        ? Math.max(0, currentIndex - 1)
        : 0;
  if (targetIndex === currentIndex) return layers;
  const reordered = [...layers];
  const [layer] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, layer);
  return reordered;
};

export const selectLatestReadyPrintDesignLayerId = (
  layers: PrintPlacementLayerState[],
): string | null => [...layers]
  .reverse()
  .find((layer) => layer.kind === 'design' && layer.ready)?.id ?? null;

export const selectLatestProcessingPrintDesignLayerId = (
  layers: Array<PrintPlacementLayerState & { processing: boolean }>,
): string | null => [...layers]
  .reverse()
  .find((layer) => layer.kind === 'design' && layer.processing)?.id ?? null;

export const isPendingPrintDesignLayerMaterialization = ({
  activeLayerId,
  pendingLayerId,
  expectedLayerIds,
  materializedLayerIds,
}: {
  activeLayerId: string | null;
  pendingLayerId: string | null;
  expectedLayerIds: string[];
  materializedLayerIds: string[];
}): boolean => Boolean(
  activeLayerId
  && activeLayerId === pendingLayerId
  && expectedLayerIds.includes(activeLayerId)
  && !materializedLayerIds.includes(activeLayerId)
);

export type PrintDesignCutoutDescriptor = {
  layerId: string;
  state: 'idle' | 'processing' | 'done' | 'error';
  hasProcessedUrl: boolean;
  hasResult: boolean;
};

export type PrintDesignCutoutReconciliationPlan = {
  previousIndexByNextIndex: Array<number | null>;
  reusablePreviousIndexByNextIndex: Array<number | null>;
  processOrder: number[];
};

export const planPrintDesignCutoutReconciliation = ({
  previous,
  nextLayerIds,
  preferredLayerId,
}: {
  previous: PrintDesignCutoutDescriptor[];
  nextLayerIds: string[];
  preferredLayerId: string | null;
}): PrintDesignCutoutReconciliationPlan => {
  if (new Set(previous.map((entry) => entry.layerId)).size !== previous.length) {
    throw new Error('PRINT_DESIGN_PREVIOUS_LAYER_ID_DUPLICATE');
  }
  if (new Set(nextLayerIds).size !== nextLayerIds.length) {
    throw new Error('PRINT_DESIGN_NEXT_LAYER_ID_DUPLICATE');
  }
  const previousIndexByLayerId = new Map(previous.map((entry, index) => [entry.layerId, index]));
  const previousIndexByNextIndex = nextLayerIds.map(
    (layerId) => previousIndexByLayerId.get(layerId) ?? null,
  );
  const reusablePreviousIndexByNextIndex = previousIndexByNextIndex.map((previousIndex) => {
    if (previousIndex === null) return null;
    const entry = previous[previousIndex];
    return entry.state === 'done' && entry.hasProcessedUrl && entry.hasResult
      ? previousIndex
      : null;
  });
  const unresolved = nextLayerIds
    .map((_, index) => index)
    .filter((index) => reusablePreviousIndexByNextIndex[index] === null);
  const preferredIndex = preferredLayerId ? nextLayerIds.indexOf(preferredLayerId) : -1;
  const processOrder = preferredIndex >= 0 && unresolved.includes(preferredIndex)
    ? [preferredIndex, ...unresolved.filter((index) => index !== preferredIndex)]
    : unresolved;
  return {
    previousIndexByNextIndex,
    reusablePreviousIndexByNextIndex,
    processOrder,
  };
};

export const resolvePrintPlacementSelection = ({
  layers,
  selectedLayerId,
  pendingLayerId,
  pendingLayerExpected,
  userClearedSelection,
}: {
  layers: PrintPlacementLayerState[];
  selectedLayerId: string | null;
  pendingLayerId: string | null;
  pendingLayerExpected: boolean;
  userClearedSelection: boolean;
}): PrintPlacementSelection => {
  if (userClearedSelection) {
    return { selectedLayerId: null, pendingLayerId: null };
  }
  const pendingLayer = pendingLayerId
    ? layers.find((layer) => layer.id === pendingLayerId && layer.kind === 'design')
    : null;
  if (pendingLayer?.ready) {
    return { selectedLayerId: pendingLayer.id, pendingLayerId: null };
  }
  const retainedPendingLayerId = pendingLayer?.id
    ?? (pendingLayerId && pendingLayerExpected ? pendingLayerId : null);

  const currentLayerExists = Boolean(
    selectedLayerId && layers.some((layer) => layer.id === selectedLayerId),
  );
  if (currentLayerExists) {
    return {
      selectedLayerId,
      pendingLayerId: retainedPendingLayerId,
    };
  }
  const latestReadyDesignId = selectLatestReadyPrintDesignLayerId(layers);
  const readyGarment = layers.find((layer) => layer.kind === 'garment' && layer.ready);
  return {
    selectedLayerId: latestReadyDesignId ?? readyGarment?.id ?? null,
    pendingLayerId: retainedPendingLayerId,
  };
};
