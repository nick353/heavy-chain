export type PlacementEditBaseline<TTransform> = Array<{
  id: string;
  transform: TTransform;
}>;

export type PlacementConfirmLayer = {
  cutoutState: 'idle' | 'processing' | 'done' | 'error';
  originalUrl: string;
  displayUrl: string;
};

export function canConfirmPlacementEdit({
  garmentMaskConfirmed,
  layers,
}: {
  garmentMaskConfirmed: boolean;
  layers: PlacementConfirmLayer[];
}) {
  return garmentMaskConfirmed
    && layers.length > 0
    && layers.every((layer) => (
      layer.cutoutState === 'done'
      && Boolean(layer.originalUrl)
      && Boolean(layer.displayUrl)
    ));
}

function assertUniqueLayerIds(layers: Array<{ id: string }>, label: string) {
  const seen = new Set<string>();
  for (const layer of layers) {
    if (seen.has(layer.id)) {
      throw new Error(`duplicate_${label}_placement_layer_id:${layer.id}`);
    }
    seen.add(layer.id);
  }
}

export function createPlacementEditBaseline<TTransform>(
  layers: Array<{ id: string; transform: TTransform }>,
): PlacementEditBaseline<TTransform> {
  assertUniqueLayerIds(layers, 'current');
  return layers.map((layer) => ({ id: layer.id, transform: layer.transform }));
}

export function restorePlacementEditBaseline<TLayer extends { id: string; transform: TTransform }, TTransform>({
  baseline,
  currentLayers,
}: {
  baseline: PlacementEditBaseline<TTransform>;
  currentLayers: TLayer[];
}): TLayer[] {
  assertUniqueLayerIds(baseline, 'baseline');
  assertUniqueLayerIds(currentLayers, 'current');

  const currentById = new Map(currentLayers.map((layer) => [layer.id, layer]));
  const baselineIds = new Set(baseline.map((layer) => layer.id));
  const restored = baseline.flatMap((snapshot) => {
    const current = currentById.get(snapshot.id);
    return current ? [{ ...current, transform: snapshot.transform }] : [];
  });
  const addedDuringSession = currentLayers.filter((layer) => !baselineIds.has(layer.id));
  return [...restored, ...addedDuringSession];
}
