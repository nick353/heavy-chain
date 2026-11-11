/**
 * Fashion Studio canvas (Light's /flow/integration/detail, read from its scripts on 2026-11-12): free node positions,
 * Light's snapping, its minimap bounds, キャンバスを整理 and the undo history of node moves.
 *
 * Heavy's world unit is the CSS pixel at zoom 0.3, which Light labels 45% (its 1000-unit image node is 448px there),
 * so one Heavy unit is 1/0.45 Light units and Light's zoom is Heavy's zoom × 1.5. Light's own numbers (6px snap
 * distance, the 120-unit grid, 500/100 layout gaps, zoom 3%–400%) are converted with these two factors.
 */
export type StudioPoint = { x: number; y: number };
export type StudioRect = { id: string; x: number; y: number; width: number; height: number };
export type StudioPositions = Record<string, StudioPoint>;
export type StudioEdge = { source: string; target: string };
export type StudioView = { zoom: number; panX: number; panY: number };
export type StudioSnapLine = { axis: 'x' | 'y'; value: number };

export const LIGHT_UNITS_PER_HEAVY = 1 / 0.45;
export const toLightZoom = (zoom: number) => zoom * 1.5;
export const fromLightZoom = (zoom: number) => zoom / 1.5;
/** Light's React Flow allows 3%–400%. */
export const STUDIO_ZOOM_LIMITS = { min: fromLightZoom(0.03), max: fromLightZoom(4) };
/** Light's zoom menu (tY in its script) and 適応 to the screen. */
export const STUDIO_ZOOM_PRESETS = [2, 1, 0.5, 0.3, 0.1, 0.05, 0.03] as const;
export const studioZoomPercent = (zoom: number) => Math.round(toLightZoom(zoom) * 100);
const screenScale = (zoom: number) => zoom / 0.3;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampLightZoom = (zoom: number) => Math.round(clamp(zoom, 0.03, 4) * 1e4) / 1e4;

/** Light's zoom buttons (tK): ±20%, always at least one percentage point, inside 3%–400%. */
export const steppedStudioZoom = (zoom: number, direction: -1 | 1) => {
  const light = toLightZoom(zoom);
  const current = Math.round(light * 100);
  const next = Math.round(clampLightZoom(light * (direction > 0 ? 1.2 : 1 / 1.2)) * 100);
  return fromLightZoom(clampLightZoom((direction > 0 ? Math.max(current + 1, next) : Math.min(current - 1, next)) / 100));
};

// ── Snapping (Light's updateNodePositions replacement next to "snapToGrid:!1") ────────────────────────────────────
/** Light lines a dragged node up with another node's left / centre / right (top / middle / bottom) within 6 screen
 * pixels; with no such line and zoom ≥ 25% it snaps the dragged node's corner to a 120-unit grid within 5 px (≤12
 * units). It returns the shift to apply and the guide lines it drew. Holding Alt turns it off (the caller checks). */
const lightSnap = (moving: StudioRect[], others: StudioRect[], zoom: number, draggedId?: string) => {
  const delta = { x: 0, y: 0 };
  const lines: StudioSnapLine[] = [];
  if (!moving.length || zoom <= 0) return { delta, lines };
  const minX = Math.min(...moving.map(rect => rect.x)), minY = Math.min(...moving.map(rect => rect.y));
  const width = Math.max(...moving.map(rect => rect.x + rect.width)) - minX;
  const height = Math.max(...moving.map(rect => rect.y + rect.height)) - minY;
  const anchor = moving.find(rect => rect.id === draggedId) ?? { x: minX, y: minY };
  const movingIds = new Set(moving.map(rect => rect.id));
  const targets = others.filter(rect => !movingIds.has(rect.id));
  const lineDistance = 6 / zoom;
  const gridDistance = Math.min(5 / zoom, 12);
  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? 'width' : 'height';
    const start = axis === 'x' ? minX : minY, span = axis === 'x' ? width : height;
    let best: { distance: number; value: number; delta: number } | undefined;
    for (const target of targets) {
      for (const value of [target[axis], target[axis] + target[size] / 2, target[axis] + target[size]]) {
        for (const edge of [start, start + span / 2, start + span]) {
          const distance = Math.abs(value - edge);
          if (distance <= lineDistance && (!best || distance < best.distance)) best = { distance, value, delta: value - edge };
        }
      }
    }
    if (best) { delta[axis] = best.delta; lines.push({ axis, value: best.value }); }
  }
  if (!lines.length && zoom >= 0.25) {
    for (const axis of ['x', 'y'] as const) {
      const snapped = 120 * Math.round(anchor[axis] / 120);
      if (Math.abs(snapped - anchor[axis]) <= gridDistance) { delta[axis] = snapped - anchor[axis]; lines.push({ axis, value: snapped }); }
    }
  }
  return { delta, lines };
};

/** Light's snap in Heavy units: `moving` holds the dragged node(s) at their raw new position. */
export const studioSnap = (moving: StudioRect[], others: StudioRect[], zoom: number, draggedId?: string) => {
  const k = LIGHT_UNITS_PER_HEAVY;
  const toLight = (rect: StudioRect): StudioRect => ({ id: rect.id, x: rect.x * k, y: rect.y * k, width: rect.width * k, height: rect.height * k });
  const result = lightSnap(moving.map(toLight), others.map(toLight), toLightZoom(zoom), draggedId);
  return { delta: { x: result.delta.x / k, y: result.delta.y / k }, lines: result.lines.map(line => ({ axis: line.axis, value: line.value / k })) };
};

export const STUDIO_SNAP_STORAGE_KEY = 'integration.canvas.snap.enabled';
/** Light keeps グリッドにスナップ on unless it was turned off (localStorage "false"). */
export const readStudioSnapEnabled = (storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage) => {
  try { return storage?.getItem(STUDIO_SNAP_STORAGE_KEY) !== 'false'; } catch { return true; }
};
export const writeStudioSnapEnabled = (enabled: boolean, storage: Pick<Storage, 'setItem'> | null = typeof window === 'undefined' ? null : window.localStorage) => {
  try { storage?.setItem(STUDIO_SNAP_STORAGE_KEY, String(enabled)); } catch { /* storage unavailable */ }
};

// ── Minimap (Light's "canvas-navigation") ──────────────────────────────────────────────────────────────────────────
/** The world rectangle the canvas shows (Light's viewportRect). */
export const studioViewportRect = (view: StudioView, width: number, height: number) => {
  const scale = screenScale(view.zoom);
  return { x: -view.panX / scale, y: -view.panY / scale, width: width / scale, height: height / scale };
};
/** Light's minimapBounds: every node and the view, fitted into 208×112 of a 240×144 box (a 16-unit margin). */
export const studioMinimapBounds = (nodes: readonly Omit<StudioRect, 'id'>[], viewport: Omit<StudioRect, 'id'>) => {
  const all = [...nodes, viewport];
  const x = Math.min(...all.map(rect => rect.x)), y = Math.min(...all.map(rect => rect.y));
  const width = Math.max(...all.map(rect => rect.x + rect.width)) - x;
  const height = Math.max(...all.map(rect => rect.y + rect.height)) - y;
  const unit = Math.max(width / 208, height / 112, 0.001);
  return { x: x + width / 2 - 120 * unit, y: y + height / 2 - 72 * unit, width: 240 * unit, height: 144 * unit };
};
/** Light centres the clicked world point (minimap click). */
export const studioCenterOn = (view: StudioView, point: StudioPoint, width: number, height: number): StudioView => {
  const scale = screenScale(view.zoom);
  return { ...view, panX: width / 2 - point.x * scale, panY: height / 2 - point.y * scale };
};
/** Light's arrow keys on the minimap move the view by 10% of the canvas. */
export const studioMinimapArrow = (key: string): [number, number] | null => (
  ({ ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] } as Record<string, [number, number]>)[key] ?? null
);

// ── Default positions and edges ──────────────────────────────────────────────────────────────────────────────────
/** Light's flow (measured at its 45% fit, 2026-11-11): the form 83 units right of the main image, results 89 units
 * right of the form, each next result touching the previous one, tops aligned. A node with a saved position keeps it;
 * a node without one is placed after the node before it. */
export const STUDIO_FLOW_GAP_IN = 83;
export const STUDIO_FLOW_GAP_OUT = 89;
export type StudioNodeSpec = { key: string; kind: 'main' | 'form' | 'result'; width: number };
export const studioNodePositions = (nodes: readonly StudioNodeSpec[], saved: StudioPositions): StudioPositions => {
  const positions: StudioPositions = {};
  let previous: { point: StudioPoint; width: number; kind: StudioNodeSpec['kind'] } | null = null;
  for (const node of nodes) {
    const fallback: StudioPoint = !previous ? { x: 0, y: 0 }
      : { x: previous.point.x + previous.width + (previous.kind === 'main' ? STUDIO_FLOW_GAP_IN : previous.kind === 'form' ? STUDIO_FLOW_GAP_OUT : 0), y: previous.point.y };
    const point = saved[node.key] ?? fallback;
    positions[node.key] = { x: point.x, y: point.y };
    previous = { point, width: node.width, kind: node.kind };
  }
  return positions;
};
/** Light's edges run from the source's right middle to the target's left middle. */
export const studioEdgePath = (source: Omit<StudioRect, 'id'>, target: Omit<StudioRect, 'id'>) => {
  const sx = source.x + source.width, sy = source.y + source.height / 2;
  const tx = target.x, ty = target.y + target.height / 2;
  const mid = sx + (tx - sx) / 2;
  return `M${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`;
};

// ── キャンバスを整理 (Light's arrangeCanvas / layoutCompactTree) ─────────────────────────────────────────────────
/** Light: 500 units between columns, 100 between stacked children, 600 between groups. */
export const STUDIO_ARRANGE_GAPS = { horizontal: 500 * 0.45, vertical: 100 * 0.45, group: 600 * 0.45 };
/** Light lays each connected tree out left to right (服 → 入力欄 → 結果), stacks a node's children vertically and centres
 * every parent on its children (and the children on a taller parent). Positions start at (0, 0). */
export const arrangeStudioNodes = (nodes: readonly StudioRect[], edges: readonly StudioEdge[]): StudioPositions => {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>(nodes.map(node => [node.id, []]));
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target || parent.has(edge.target)) continue;
    // Skip an edge that would close a cycle.
    let cursor: string | undefined = edge.source, cycle = false;
    while (cursor) { if (cursor === edge.target) { cycle = true; break; } cursor = parent.get(cursor); }
    if (cycle) continue;
    parent.set(edge.target, edge.source); children.get(edge.source)!.push(edge.target);
  }
  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    const known = depth.get(id); if (known !== undefined) return known;
    const above = parent.get(id); const value = above ? depthOf(above) + 1 : 0; depth.set(id, value); return value;
  };
  nodes.forEach(node => depthOf(node.id));
  const columnWidth: number[] = [];
  nodes.forEach(node => { const d = depth.get(node.id)!; columnWidth[d] = Math.max(columnWidth[d] ?? 0, node.width); });
  const columnX: number[] = [];
  for (let index = 0; index < columnWidth.length; index += 1) columnX[index] = index ? columnX[index - 1] + (columnWidth[index - 1] ?? 0) + STUDIO_ARRANGE_GAPS.horizontal : 0;
  const block = new Map<string, number>();
  const blockOf = (id: string): number => {
    const known = block.get(id); if (known !== undefined) return known;
    const own = byId.get(id)!.height, kids = children.get(id)!;
    const stacked = kids.reduce((sum, kid) => sum + blockOf(kid), 0) + STUDIO_ARRANGE_GAPS.vertical * Math.max(0, kids.length - 1);
    const value = Math.max(own, kids.length ? stacked : 0); block.set(id, value); return value;
  };
  const positions: StudioPositions = {};
  const place = (id: string, top: number) => {
    const node = byId.get(id)!, kids = children.get(id)!, size = blockOf(id);
    positions[id] = { x: columnX[depth.get(id)!], y: top + (size - node.height) / 2 };
    const stacked = kids.reduce((sum, kid) => sum + blockOf(kid), 0) + STUDIO_ARRANGE_GAPS.vertical * Math.max(0, kids.length - 1);
    let cursor = top + (size - stacked) / 2;
    for (const kid of kids) { place(kid, cursor); cursor += blockOf(kid) + STUDIO_ARRANGE_GAPS.vertical; }
  };
  let top = 0;
  for (const node of nodes) {
    if (parent.has(node.id)) continue;
    place(node.id, top); top += blockOf(node.id) + STUDIO_ARRANGE_GAPS.group;
  }
  return positions;
};
/** Light fits the arranged nodes into 64% of the canvas, never past 100%, never below 3%. */
export const fitStudioArrangedView = (rects: readonly Omit<StudioRect, 'id'>[], width: number, height: number): StudioView => {
  if (!rects.length || width <= 0 || height <= 0) return { zoom: 0.3, panX: 0, panY: 0 };
  const minX = Math.min(...rects.map(rect => rect.x)), minY = Math.min(...rects.map(rect => rect.y));
  const spanX = Math.max(1, Math.max(...rects.map(rect => rect.x + rect.width)) - minX);
  const spanY = Math.max(1, Math.max(...rects.map(rect => rect.y + rect.height)) - minY);
  const k = LIGHT_UNITS_PER_HEAVY;
  const light = Math.max(0.03, Math.min(1, (0.64 * width) / (spanX * k), (0.64 * height) / (spanY * k)));
  const zoom = fromLightZoom(light), scale = screenScale(zoom);
  return { zoom, panX: (width - spanX * scale) / 2 - minX * scale, panY: (height - spanY * scale) / 2 - minY * scale };
};

// ── Undo / redo of node positions (Light: 取り消し(ctrl+z) / やり直し(ctrl+shift+z)) ───────────────────────────────
export type StudioHistory = { past: StudioPositions[]; future: StudioPositions[] };
export const STUDIO_HISTORY_LIMIT = 50;
export const emptyStudioHistory = (): StudioHistory => ({ past: [], future: [] });
export const pushStudioHistory = (history: StudioHistory, before: StudioPositions): StudioHistory => ({
  past: [...history.past, before].slice(-STUDIO_HISTORY_LIMIT), future: [],
});
export const undoStudioHistory = (history: StudioHistory, current: StudioPositions) => {
  if (!history.past.length) return null;
  return { positions: history.past[history.past.length - 1], history: { past: history.past.slice(0, -1), future: [current, ...history.future] } };
};
export const redoStudioHistory = (history: StudioHistory, current: StudioPositions) => {
  if (!history.future.length) return null;
  return { positions: history.future[0], history: { past: [...history.past, current].slice(-STUDIO_HISTORY_LIMIT), future: history.future.slice(1) } };
};

// ── Saving positions in the project (canvas document snapshot.studioLayout) ───────────────────────────────────────
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const MAX_SAVED_NODES = 200;
const validPoint = (value: unknown): value is StudioPoint => {
  const point = record(value);
  return typeof point.x === 'number' && typeof point.y === 'number' && Number.isFinite(point.x) && Number.isFinite(point.y)
    && Math.abs(point.x) <= 1e6 && Math.abs(point.y) <= 1e6;
};
/** Node positions saved in the project; anything malformed is ignored (the node falls back to its default place). */
export const readStudioLayout = (snapshot: unknown): StudioPositions => {
  const layout = record(record(snapshot).studioLayout);
  if (layout.version !== 1) return {};
  const positions: StudioPositions = {};
  for (const [key, value] of Object.entries(record(layout.positions)).slice(0, MAX_SAVED_NODES)) {
    if (key.length <= 200 && validPoint(value)) positions[key] = { x: value.x, y: value.y };
  }
  return positions;
};
export const withStudioLayout = <T extends object>(snapshot: T, positions: StudioPositions): T & { studioLayout: { version: 1; positions: StudioPositions } } => ({
  ...snapshot,
  studioLayout: { version: 1, positions: Object.fromEntries(Object.entries(positions).filter(([, point]) => validPoint(point)).slice(0, MAX_SAVED_NODES)
    .map(([key, point]) => [key, { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 }])) },
});
export const sameStudioPositions = (a: StudioPositions, b: StudioPositions) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => b[key] && Math.abs(b[key].x - a[key].x) < 0.05 && Math.abs(b[key].y - a[key].y) < 0.05);
};
