export type StageRect = { left: number; top: number; width: number; height: number };

export const getStageLocalPoint = (
  rect: Pick<StageRect, 'left' | 'top'>,
  clientX: number,
  clientY: number,
) => ({
  x: clientX - rect.left,
  y: clientY - rect.top,
});

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
