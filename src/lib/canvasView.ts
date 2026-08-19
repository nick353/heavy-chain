export interface CanvasView {
  zoom: number;
  panX: number;
  panY: number;
}

export const normalizeCanvasView = (view?: Partial<CanvasView> | null): CanvasView => {
  const zoom = typeof view?.zoom === 'number' && Number.isFinite(view.zoom) ? view.zoom : 1;
  const panX = typeof view?.panX === 'number' && Number.isFinite(view.panX) ? view.panX : 0;
  const panY = typeof view?.panY === 'number' && Number.isFinite(view.panY) ? view.panY : 0;

  return {
    zoom: Math.max(0.1, Math.min(5, zoom)),
    panX,
    panY,
  };
};
