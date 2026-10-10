export const clampFloatingToolbarPosition = ({
  anchorX,
  anchorY,
  toolbarWidth,
  toolbarHeight,
  viewportWidth,
  viewportHeight,
  margin = 8,
  verticalGap = 12,
  minTop = 0,
}: {
  anchorX: number;
  anchorY: number;
  toolbarWidth: number;
  toolbarHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
  verticalGap?: number;
  /** Top edge of the canvas area; keeps the toolbar off the header and any banner above it. */
  minTop?: number;
}) => {
  const maximumLeft = Math.max(margin, viewportWidth - toolbarWidth - margin);
  const minimumTop = Math.max(margin, minTop + margin);
  const maximumTop = Math.max(minimumTop, viewportHeight - toolbarHeight - margin);
  return {
    left: Math.min(Math.max(margin, anchorX - toolbarWidth / 2), maximumLeft),
    top: Math.min(Math.max(minimumTop, anchorY - toolbarHeight - verticalGap), maximumTop),
  };
};
