export type StageRect = { left: number; top: number; width: number; height: number };
export type PrintingFlipAxis = 'horizontal' | 'vertical';
export type PrintingTransformValue = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
};
export type PrintingTransformHistoryEntry<Transform extends PrintingTransformValue> = {
  layerId: string;
  before: Transform;
  after: Transform;
};
export type PrintingTransformHistoryState<Transform extends PrintingTransformValue> = {
  past: Array<PrintingTransformHistoryEntry<Transform>>;
  future: Array<PrintingTransformHistoryEntry<Transform>>;
};
export type PrintingTransformHistoryDirection = 'undo' | 'redo';

export const createPrintingTransformHistory = <Transform extends PrintingTransformValue>(): PrintingTransformHistoryState<Transform> => ({
  past: [],
  future: [],
});

export const isSamePrintingTransform = (
  left: PrintingTransformValue,
  right: PrintingTransformValue,
) => left.x === right.x
  && left.y === right.y
  && left.scale === right.scale
  && left.rotation === right.rotation
  && left.opacity === right.opacity
  && left.flipX === right.flipX
  && left.flipY === right.flipY;

export const recordPrintingTransformHistory = <Transform extends PrintingTransformValue>(
  state: PrintingTransformHistoryState<Transform>,
  entry: PrintingTransformHistoryEntry<Transform>,
  limit = 20,
): PrintingTransformHistoryState<Transform> => {
  if (!entry.layerId.trim() || !Number.isInteger(limit) || limit < 1 || isSamePrintingTransform(entry.before, entry.after)) {
    return state;
  }
  return {
    past: [...state.past, entry].slice(-limit),
    future: [],
  };
};

export const prunePrintingTransformHistory = <Transform extends PrintingTransformValue>(
  state: PrintingTransformHistoryState<Transform>,
  activeLayerIds: Iterable<string>,
): PrintingTransformHistoryState<Transform> => {
  const active = new Set(activeLayerIds);
  const past = state.past.filter((entry) => active.has(entry.layerId));
  const future = state.future.filter((entry) => active.has(entry.layerId));
  return past.length === state.past.length && future.length === state.future.length
    ? state
    : { past, future };
};

export const hasPrintingTransformHistoryStep = <Transform extends PrintingTransformValue>(
  state: PrintingTransformHistoryState<Transform>,
  direction: PrintingTransformHistoryDirection,
  activeLayerIds: Iterable<string>,
) => {
  const active = new Set(activeLayerIds);
  const entries = direction === 'undo' ? state.past : state.future;
  return entries.some((entry) => active.has(entry.layerId));
};

export const stepPrintingTransformHistory = <Transform extends PrintingTransformValue>(
  state: PrintingTransformHistoryState<Transform>,
  direction: PrintingTransformHistoryDirection,
  activeLayerIds: Iterable<string>,
): {
  state: PrintingTransformHistoryState<Transform>;
  command: { layerId: string; transform: Transform } | null;
} => {
  const active = new Set(activeLayerIds);
  const source = direction === 'undo' ? state.past : state.future;
  const destination = direction === 'undo' ? state.future : state.past;
  const remaining = [...source];
  let entry: PrintingTransformHistoryEntry<Transform> | undefined;
  while (remaining.length > 0 && !entry) {
    const candidate = remaining.pop();
    if (candidate && active.has(candidate.layerId)) entry = candidate;
  }
  if (!entry) {
    return {
      state: direction === 'undo'
        ? { past: [], future: destination.filter((candidate) => active.has(candidate.layerId)) }
        : { past: destination.filter((candidate) => active.has(candidate.layerId)), future: [] },
      command: null,
    };
  }
  const activeRemaining = remaining.filter((candidate) => active.has(candidate.layerId));
  const nextDestination = [...destination.filter((candidate) => active.has(candidate.layerId)), entry];
  return {
    state: direction === 'undo'
      ? { past: activeRemaining, future: nextDestination }
      : { past: nextDestination, future: activeRemaining },
    command: {
      layerId: entry.layerId,
      transform: direction === 'undo' ? entry.before : entry.after,
    },
  };
};

export const togglePrintingFlip = <T extends { flipX: boolean; flipY: boolean }>(
  transform: T,
  axis: PrintingFlipAxis,
): T => axis === 'horizontal'
  ? { ...transform, flipX: !transform.flipX }
  : { ...transform, flipY: !transform.flipY };

export const reconcilePrintingLayersAfterDrag = <
  Transform,
  Layer extends { id: string; transform: Transform },
>({
  currentLayers,
  incomingLayers,
  layerId,
  transform,
}: {
  currentLayers: Layer[];
  incomingLayers: Layer[] | null;
  layerId: string;
  transform: Transform;
}): Layer[] => (incomingLayers ?? currentLayers).map((layer) => (
  layer.id === layerId ? { ...layer, transform } : layer
));

export const getStageLocalPoint = (
  rect: Pick<StageRect, 'left' | 'top'>,
  clientX: number,
  clientY: number,
) => ({
  x: clientX - rect.left,
  y: clientY - rect.top,
});

export const getStageDragPosition = ({
  startPosition,
  startPointer,
  currentPointer,
  stageSize,
}: {
  startPosition: { x: number; y: number };
  startPointer: { x: number; y: number };
  currentPointer: { x: number; y: number };
  stageSize: { width: number; height: number };
}) => {
  const width = Math.max(1, stageSize.width);
  const height = Math.max(1, stageSize.height);
  const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
  return {
    x: clampPercent(startPosition.x + ((currentPointer.x - startPointer.x) / width) * 100),
    y: clampPercent(startPosition.y + ((currentPointer.y - startPointer.y) / height) * 100),
  };
};

export const isOwnedPointerEvent = (
  activePointerId: number,
  eventPointerId: number,
) => activePointerId === eventPointerId;

export const getStageLocalCenterPoint = (
  rect: Pick<StageRect, 'width' | 'height'>,
) => ({
  x: rect.width / 2,
  y: rect.height / 2,
});

export const getContainedStageBounds = (
  stageSize: { width: number; height: number },
  sourceSize: { width: number; height: number },
  maxHeightRatio = 0.92,
) => {
  const maxHeight = Math.round(stageSize.height * maxHeightRatio);
  const ratio = Math.min(stageSize.width / sourceSize.width, maxHeight / sourceSize.height);
  const width = Math.max(1, Math.round(sourceSize.width * ratio));
  const height = Math.max(1, Math.round(sourceSize.height * ratio));
  return {
    x: Math.round((stageSize.width - width) / 2),
    y: Math.round((stageSize.height - height) / 2),
    width,
    height,
  };
};

export const getIntegerStageScale = (
  stageSize: { width: number; height: number },
  baseSize: { width: number; height: number },
) => {
  const widthScale = stageSize.width / baseSize.width;
  const heightScale = stageSize.height / baseSize.height;
  return Number.isSafeInteger(widthScale) && widthScale >= 1 && widthScale === heightScale
    ? widthScale
    : 1;
};

export const scaleStageBounds = <T extends { x: number; y: number; width: number; height: number }>(
  bounds: T,
  scale: number,
) => ({
  ...bounds,
  x: bounds.x * scale,
  y: bounds.y * scale,
  width: bounds.width * scale,
  height: bounds.height * scale,
});

export const getInnerContainedBounds = (
  bounds: { x: number; y: number; width: number; height: number },
  sourceSize: { width: number; height: number },
  geometryScale = 1,
) => {
  const baseBounds = geometryScale > 1
    ? {
        x: bounds.x / geometryScale,
        y: bounds.y / geometryScale,
        width: bounds.width / geometryScale,
        height: bounds.height / geometryScale,
      }
    : bounds;
  const sourceRatio = sourceSize.width / Math.max(1, sourceSize.height);
  const boundsRatio = baseBounds.width / Math.max(1, baseBounds.height);
  let width = baseBounds.width;
  let height = baseBounds.height;
  let x = baseBounds.x;
  let y = baseBounds.y;
  if (sourceRatio > boundsRatio) {
    height = Math.max(1, Math.round(baseBounds.width / sourceRatio));
    y = baseBounds.y + Math.round((baseBounds.height - height) / 2);
  } else {
    width = Math.max(1, Math.round(baseBounds.height * sourceRatio));
    x = baseBounds.x + Math.round((baseBounds.width - width) / 2);
  }
  return scaleStageBounds({ x, y, width, height }, geometryScale);
};
