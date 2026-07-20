export const clampFloatingToolbarPosition = ({
  anchorX,
  anchorY,
  toolbarWidth,
  toolbarHeight,
  viewportWidth,
  viewportHeight,
  margin = 8,
  verticalGap = 12,
}: {
  anchorX: number;
  anchorY: number;
  toolbarWidth: number;
  toolbarHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
  verticalGap?: number;
}) => {
  const maximumLeft = Math.max(margin, viewportWidth - toolbarWidth - margin);
  const maximumTop = Math.max(margin, viewportHeight - toolbarHeight - margin);
  return {
    left: Math.min(Math.max(margin, anchorX - toolbarWidth / 2), maximumLeft),
    top: Math.min(Math.max(margin, anchorY - toolbarHeight - verticalGap), maximumTop),
  };
};
