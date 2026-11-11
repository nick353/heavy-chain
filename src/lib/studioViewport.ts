export type StudioViewport = { zoom: number; panX: number; panY: number };
export type StudioViewportState = { view: StudioViewport; mode: 'select' | 'move'; selectedObjectId: string | null; panning: boolean };
export const STUDIO_DEFAULT_VIEWPORT: StudioViewport = { zoom: 0.3, panX: 0, panY: 0 };
export const STUDIO_INTERACTIVE_SELECTOR = 'input, textarea, select, button, a, [contenteditable="true"], [role="button"], [data-studio-composer], [data-studio-chrome]';
export type StudioZoomLimits = { min: number; max: number };
const DEFAULT_ZOOM_LIMITS: StudioZoomLimits = { min: 0.1, max: 2 };
export const clampStudioZoom = (zoom: number, limits: StudioZoomLimits = DEFAULT_ZOOM_LIMITS) => Math.min(limits.max, Math.max(limits.min, Number.isFinite(zoom) ? zoom : 0.3));
export const panStudioViewport = (view: StudioViewport, dx: number, dy: number): StudioViewport => ({ ...view,
  panX: view.panX + (Number.isFinite(dx) ? dx : 0), panY: view.panY + (Number.isFinite(dy) ? dy : 0) });
export const zoomStudioViewport = (view: StudioViewport, zoom: number, anchor: { x: number; y: number }, limits: StudioZoomLimits = DEFAULT_ZOOM_LIMITS): StudioViewport => {
  const nextZoom = clampStudioZoom(zoom, limits);
  const ratio = nextZoom / clampStudioZoom(view.zoom, limits);
  return { zoom: nextZoom, panX: anchor.x - (anchor.x - view.panX) * ratio, panY: anchor.y - (anchor.y - view.panY) * ratio };
};
export const studioWorldTransform = (view: StudioViewport) => `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom / 0.3})`;
export const normalizedStudioWheel = (event: { deltaX: number; deltaY: number; deltaMode: number }, pageHeight: number) => {
  const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  return { x: event.deltaX * factor, y: event.deltaY * factor };
};
type PointerInput = { pointerId: number; button: number; x: number; y: number; interactive: boolean; objectId?: string | null };
/** Local navigation only; ports never read or mutate a Canvas document. */
export const createStudioViewportInteraction = (ports: {
  publish(state: StudioViewportState): void;
  capture(pointerId: number): void;
  release(pointerId: number): void;
  /** Fashion Studio follows Light's 3%–400%; other callers keep 0.1–2. */
  zoomLimits?: StudioZoomLimits;
}) => {
  const limits = ports.zoomLimits ?? DEFAULT_ZOOM_LIMITS;
  let state: StudioViewportState = { view: { ...STUDIO_DEFAULT_VIEWPORT }, mode: 'select', selectedObjectId: null, panning: false };
  let space = false;
  let drag: { id: number; x: number; y: number } | null = null;
  let disposed = false;
  const emit = (patch: Partial<StudioViewportState>) => { state = { ...state, ...patch }; if (!disposed) ports.publish(state); };
  const cancel = () => {
    const previous = drag; drag = null; space = false;
    if (previous) { try { ports.release(previous.id); } catch { /* already released/lost capture */ } }
    if (state.panning) emit({ panning: false });
  };
  return {
    snapshot: () => ({ ...state, view: { ...state.view } }),
    mode(mode: StudioViewportState['mode']) { if (!disposed) { cancel(); emit({ mode }); } },
    /** Whether a press with this button pans the canvas (hand tool, Space held, or the middle button). */
    wouldPan(button: number) { return button === 1 || (button === 0 && (state.mode === 'move' || space)); },
    /** Node selection made by the page (node drag, Escape). */
    select(selectedObjectId: string | null) { if (!disposed && state.selectedObjectId !== selectedObjectId) emit({ selectedObjectId }); },
    down(event: PointerInput) {
      if (disposed || event.interactive || drag) return false;
      const pan = event.button === 1 || (event.button === 0 && (state.mode === 'move' || space));
      if (pan) {
        drag = { id: event.pointerId, x: event.x, y: event.y };
        try { ports.capture(event.pointerId); } catch { drag = null; return false; }
        emit({ panning: true }); return true;
      }
      if (event.button === 0 && state.mode === 'select') { emit({ selectedObjectId: event.objectId || null }); return true; }
      return false;
    },
    move(event: { pointerId: number; x: number; y: number }) {
      if (disposed || !drag || drag.id !== event.pointerId) return false;
      const view = panStudioViewport(state.view, event.x - drag.x, event.y - drag.y);
      drag = { id: drag.id, x: event.x, y: event.y }; emit({ view }); return true;
    },
    up(pointerId: number) { if (!drag || drag.id !== pointerId) return false; cancel(); return true; },
    cancel,
    wheel(event: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; interactive: boolean; anchor: { x: number; y: number }; pageHeight: number }) {
      if (disposed || event.interactive) return false;
      const delta = normalizedStudioWheel(event, event.pageHeight);
      emit({ view: event.ctrlKey || event.metaKey ? zoomStudioViewport(state.view, state.view.zoom * Math.exp(-delta.y * 0.002), event.anchor, limits)
        : panStudioViewport(state.view, -delta.x, -delta.y) }); return true;
    },
    zoom(direction: -1 | 1, anchor: { x: number; y: number }) { if (!disposed) emit({ view: zoomStudioViewport(state.view, state.view.zoom * (direction > 0 ? 1.2 : 1 / 1.2), anchor, limits) }); },
    /** Zoom to an exact level around an anchor (Light's zoom buttons and preset menu). */
    zoomTo(zoom: number, anchor: { x: number; y: number }) { if (!disposed) emit({ view: zoomStudioViewport(state.view, zoom, anchor, limits) }); },
    key(event: { key: string; down: boolean; interactive: boolean; focused: boolean; anchor: { x: number; y: number } }) {
      if (disposed || !event.focused || event.interactive) return false;
      if (event.key === ' ' || event.key === 'Spacebar') { space = event.down; return true; }
      if (event.down && ['+', '=', '-', '_'].includes(event.key)) {
        const direction = event.key === '+' || event.key === '=' ? 1 : -1;
        emit({ view: zoomStudioViewport(state.view, state.view.zoom * (direction > 0 ? 1.2 : 1 / 1.2), event.anchor, limits) }); return true;
      }
      return false;
    },
    reset() { if (!disposed) { cancel(); emit({ view: { ...STUDIO_DEFAULT_VIEWPORT }, mode: 'select', selectedObjectId: null }); } },
    /** Light fits the nodes into view (fitView); the page passes the fitted view here. */
    set(view: StudioViewport) { if (!disposed) emit({ view: { zoom: clampStudioZoom(view.zoom, limits), panX: Number.isFinite(view.panX) ? view.panX : 0, panY: Number.isFinite(view.panY) ? view.panY : 0 } }); },
    dispose() { cancel(); disposed = true; },
  };
};
