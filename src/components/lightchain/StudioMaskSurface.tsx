import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { buildHighPrecisionMaterialCutoutDataUrl, buildMaterialCutoutDataUrl, buildPrintGarmentCutoutDataUrl, type MaterialCutoutResult } from '../../lib/workspaceMaterialReferences';
import type { GarmentSegmentationTarget } from '../../features/printing/selection/garmentSegmentationPolicy';
import { cutoutDrawRect } from './printPlacement';
import { refreshSignedImageUrl } from '../../lib/storage';
import {
  ERASE_GUIDE_COLOR, studioAlphaBounds, studioApplyMaskAlpha, studioAutoClip, studioDataUrlToFile, studioFillRectAlpha, studioPenHit, studioPenPathD, studioPenTrace,
  studioRectFromDrag, studioScaleRect, type StudioPenMode, type StudioPenPoint, type StudioRect, type StudioRgba,
} from '../../lib/studioImageEdit';

/**
 * 本家の簡易エディター・クリッピング・AI削除・部分編集で共通の「1枚の画像にマスクを塗る面」。
 * 本家（0enochg71jvs-.js）は Konva の画像の層とマスクの層（不透明度 0.6）で、ブラシ・投げ縄・矩形・パス・AIマスク認識を持ち、
 * ホイールで 1.05 倍ずつ拡大縮小、Space を押しながらドラッグで動かす。ここでは canvas 2 枚と SVG で同じ動きにした。
 * マスクは長い辺 1024 の作業用の大きさ（MaskPaintDialog・範囲指定の案内図と同じ）で持ち、書き出すときだけ元の大きさにする。
 */
export type StudioMaskTool = 'brush' | 'eraser' | 'lasso' | 'rect' | 'pen' | 'none';
export type StudioMaskMode = 'add' | 'remove';
export const STUDIO_MASK_CANDIDATES = ['トップス', 'ボトムス', '全身'] as const;
export type StudioMaskCandidate = (typeof STUDIO_MASK_CANDIDATES)[number];
const CANDIDATE_TARGET: Record<StudioMaskCandidate, GarmentSegmentationTarget> = { トップス: 'upper', ボトムス: 'lower', 全身: 'full' };
const MAX_EDGE = 1024;
const HISTORY_LIMIT = 30;
const GUIDE_MAX_EDGE = 1536;
const WHEEL_STEP = 1.05;
const BUTTON_STEP = 1.2;
const ZOOM_MIN = 0.05, ZOOM_MAX = 8;
/** 本家のマスクの層は不透明度 0.6。色は MaskPaintDialog と同じティール。 */
export const STUDIO_MASK_OVERLAY = 'rgba(101, 211, 207, 0.6)';

export type StudioMaskSurfaceHandle = {
  isEmpty: () => boolean;
  /** 作業用の大きさのマスク（alpha > 0 が塗った所）。MaskPaintDialog の onConfirm と同じ形。何も無ければ null。 */
  getMaskImageData: () => ImageData | null;
  /** 元の大きさのマスク画像（塗った所が白・ほかは透明の PNG）。 */
  getMask: (name?: string) => Promise<File | null>;
  /** 抽出（本家 getSynthesis）: 元の大きさのまま、選択の外を透明にした PNG。 */
  getCutout: (name?: string) => Promise<File | null>;
  /** お気に入り（本家 imageAutoClip）: 選択の外接矩形で切り出した透明 PNG。 */
  getClip: (name?: string) => Promise<File | null>;
  /** 生成の窓口に渡す案内画像（元画像に塗りを重ねた PNG。長い辺 1536 まで）。部分編集はマーカーの色のまま、ほかはティール。 */
  getGuide: (name?: string) => Promise<File | null>;
  /** 部分編集で使った色。 */
  usedColors: () => string[];
  undo: () => void;
  redo: () => void;
  clear: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** AIマスク認識（端末内の服の切り抜き）。add は足し、remove は引く。失敗したら投げる。 */
  recognize: (candidate: StudioMaskCandidate, mode?: StudioMaskMode) => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
};

// A node's signed URL may have expired while the page was open: sign it again before reading (refreshSignedImageUrl).
const loadImage = async (url: string) => {
  const source = await refreshSignedImageUrl(url);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('studio_mask_image_load_failed'));
    image.src = source;
  });
};
const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('studio_mask_canvas_unavailable');
  return { canvas, context };
};
const toPngFile = async (canvas: HTMLCanvasElement, name: string) => {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('studio_mask_encode_failed');
  return new File([blob], name, { type: 'image/png' });
};
const rgbaOf = (data: ImageData): StudioRgba => ({ width: data.width, height: data.height, data: data.data });

/** 矩形の中を端末内の被写体の切り抜きで認識する。認識できなければ null（呼び出し側が矩形を塗る）。 */
async function recognizeInRect(image: HTMLImageElement, rect: StudioRect): Promise<HTMLCanvasElement | null> {
  const width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
  if (width < 8 || height < 8) return null;
  const crop = canvasOf(width, height);
  crop.context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
  let cutout: MaterialCutoutResult;
  try {
    cutout = await buildHighPrecisionMaterialCutoutDataUrl({ imageUrl: crop.canvas.toDataURL('image/png'), modelName: 'isnet-general-use', preserveSourceFrame: true, maxDataUrlBytes: 12 * 1024 * 1024 });
  } catch {
    return null;
  }
  const cutoutImage = await loadImage(cutout.dataUrl);
  const layer = canvasOf(width, height);
  const at = cutoutDrawRect(cutout, { width, height });
  layer.context.drawImage(cutoutImage, at.x, at.y, at.width, at.height);
  const bounds = studioAlphaBounds(rgbaOf(layer.context.getImageData(0, 0, width, height)));
  // ほぼ空なら認識できなかったとみなす（呼び出し側が矩形そのものを塗る）。
  if (!bounds || bounds.width * bounds.height < width * height * 0.02) return null;
  return layer.canvas;
}

export const StudioMaskSurface = forwardRef<StudioMaskSurfaceHandle, {
  imageUrl: string;
  tool: StudioMaskTool;
  mode?: StudioMaskMode;
  /** ブラシの太さ（作業用マスクの画素）。 */
  brushSize?: number;
  /** 部分編集のマーカー: 色を付けて塗り、そのままの色で見せる。指定が無ければティールのマスク。 */
  markerColor?: string | null;
  /** 矩形選択で中の物を認識する（簡易エディター）。false なら矩形をそのまま塗る。 */
  recognizeRect?: boolean;
  /** パスツールの動き方（本家: 描画＝点を置く・削除＝点を消す・選択＝点を動かす・曲線＝点から引いて曲げる）。 */
  penMode?: StudioPenMode;
  initialMask?: ImageData | null;
  active?: boolean;
  onChange?: () => void;
  onZoomChange?: (percent: number) => void;
  onBusyChange?: (busy: string | null) => void;
  onPointerActivate?: () => void;
  /** 履歴に1手積んだとき（塗る・消す・認識・全部消す）。2面の履歴の順番に使う。 */
  onStroke?: () => void;
  className?: string;
  testId?: string;
}>(function StudioMaskSurface({
  imageUrl, tool, mode = 'add', brushSize = 40, markerColor = null, recognizeRect = false, penMode = 'draw', initialMask = null, active = true,
  onChange, onZoomChange, onBusyChange, onPointerActivate, onStroke, className = '', testId = 'studio-mask-surface',
}, ref) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [draft, setDraft] = useState<{ kind: 'lasso'; points: Array<{ x: number; y: number }> } | { kind: 'pen'; points: StudioPenPoint[] } | { kind: 'rect'; rect: StudioRect } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const history = useRef<{ undo: ImageData[]; redo: ImageData[] }>({ undo: [], redo: [] });
  const usedColorsRef = useRef<Set<string>>(new Set());
  const gesture = useRef<{ kind: 'paint' | 'lasso' | 'rect' | 'pan' | 'pen-move' | 'pen-curve'; last?: { x: number; y: number }; start?: { x: number; y: number }; client?: { x: number; y: number }; origin?: { x: number; y: number };
    index?: number; moved?: boolean } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const size = useMemo(() => {
    if (!image) return null;
    const ratio = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    return { width: Math.round(image.naturalWidth * ratio), height: Math.round(image.naturalHeight * ratio) };
  }, [image]);

  useEffect(() => {
    let cancelled = false;
    setImage(null); setLoadFailed(false);
    void loadImage(imageUrl).then(loaded => { if (!cancelled) setImage(loaded); }).catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [imageUrl]);

  const renderOverlay = useCallback(() => {
    const overlay = overlayRef.current, mask = maskRef.current;
    if (!overlay || !mask) return;
    if (overlay.width !== mask.width) overlay.width = mask.width;
    if (overlay.height !== mask.height) overlay.height = mask.height;
    const context = overlay.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, overlay.width, overlay.height);
    if (markerColor !== null || usedColorsRef.current.size) {
      context.globalAlpha = 0.85;
      context.drawImage(mask, 0, 0);
      context.globalAlpha = 1;
      return;
    }
    context.drawImage(mask, 0, 0);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = STUDIO_MASK_OVERLAY;
    context.fillRect(0, 0, overlay.width, overlay.height);
    context.globalCompositeOperation = 'source-over';
  }, [markerColor]);

  const changed = useCallback(() => { renderOverlay(); onChange?.(); }, [renderOverlay, onChange]);

  useEffect(() => {
    if (!size) return;
    const { canvas, context } = canvasOf(size.width, size.height);
    if (initialMask && initialMask.width === size.width && initialMask.height === size.height) context.putImageData(initialMask, 0, 0);
    maskRef.current = canvas;
    history.current = { undo: [], redo: [] };
    usedColorsRef.current = new Set();
    changed();
    // 新しい画像の大きさのときだけ作り直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size?.width, size?.height]);

  useEffect(() => { renderOverlay(); }, [renderOverlay, view]);

  // ---- 拡大縮小と移動 -------------------------------------------------------------------------------------
  const fitView = useCallback(() => {
    const container = containerRef.current;
    if (!container || !image) return;
    const box = container.getBoundingClientRect();
    const pad = 24;
    const scale = Math.min(1, Math.max(ZOOM_MIN, Math.min((box.width - pad * 2) / image.naturalWidth, (box.height - pad * 2) / image.naturalHeight)));
    setView({ scale, x: (box.width - image.naturalWidth * scale) / 2, y: (box.height - image.naturalHeight * scale) / 2 });
  }, [image]);
  useEffect(() => {
    fitView();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fitView());
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitView]);
  useEffect(() => { onZoomChange?.(Math.round(view.scale * 100)); }, [view.scale, onZoomChange]);

  const zoomAround = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const container = containerRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const px = clientX === undefined ? box.width / 2 : clientX - box.left;
    const py = clientY === undefined ? box.height / 2 : clientY - box.top;
    setView(current => {
      const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current.scale * factor));
      const k = scale / current.scale;
      return { scale, x: px - (px - current.x) * k, y: py - (py - current.y) * k };
    });
  }, []);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => { event.preventDefault(); zoomAround(event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, event.clientX, event.clientY); };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [zoomAround]);
  useEffect(() => {
    if (!active) return;
    const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const down = (event: KeyboardEvent) => { if (event.code === 'Space' && !typing(event.target)) { event.preventDefault(); setSpaceDown(true); } };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [active]);

  // ---- 塗り ---------------------------------------------------------------------------------------------
  const maskContext = () => {
    const mask = maskRef.current, context = mask?.getContext('2d', { willReadFrequently: true });
    return mask && context ? { mask, context } : null;
  };
  const snapshot = () => {
    const current = maskContext();
    if (!current) return;
    history.current.undo.push(current.context.getImageData(0, 0, current.mask.width, current.mask.height));
    if (history.current.undo.length > HISTORY_LIMIT) history.current.undo.shift();
    history.current.redo = [];
    onStroke?.();
  };
  const stepHistory = (direction: 'undo' | 'redo') => {
    const current = maskContext();
    const from = history.current[direction], to = history.current[direction === 'undo' ? 'redo' : 'undo'];
    const target = from.pop();
    if (!current || !target) return;
    to.push(current.context.getImageData(0, 0, current.mask.width, current.mask.height));
    current.context.putImageData(target, 0, 0);
    changed();
  };
  const removing = () => tool === 'eraser' || (mode === 'remove' && markerColor === null);
  const paintStyle = (context: CanvasRenderingContext2D) => {
    context.globalCompositeOperation = removing() ? 'destination-out' : 'source-over';
    const color = markerColor ?? '#000';
    context.fillStyle = color; context.strokeStyle = color;
  };
  const pointOnMask = (event: { clientX: number; clientY: number }) => {
    const overlay = overlayRef.current, mask = maskRef.current;
    if (!overlay || !mask) return { x: 0, y: 0 };
    const rect = overlay.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * mask.width, y: ((event.clientY - rect.top) / rect.height) * mask.height };
  };
  const strokeTo = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const current = maskContext();
    if (!current) return;
    paintStyle(current.context);
    current.context.lineCap = 'round'; current.context.lineJoin = 'round';
    current.context.lineWidth = brushSize;
    current.context.beginPath();
    current.context.moveTo(from.x, from.y);
    current.context.lineTo(to.x + 0.01, to.y + 0.01);
    current.context.stroke();
    current.context.globalCompositeOperation = 'source-over';
    if (markerColor && !removing()) usedColorsRef.current.add(markerColor);
    renderOverlay();
  };
  const fillPolygon = (points: Array<{ x: number; y: number }>) => {
    const current = maskContext();
    if (!current || points.length < 3) return;
    snapshot();
    paintStyle(current.context);
    current.context.beginPath();
    current.context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => current.context.lineTo(point.x, point.y));
    current.context.closePath();
    current.context.fill();
    current.context.globalCompositeOperation = 'source-over';
    if (markerColor && !removing()) usedColorsRef.current.add(markerColor);
    changed();
  };
  const applyRect = async (rect: StudioRect) => {
    const current = maskContext();
    if (!current || !image || rect.width < 2 || rect.height < 2) return;
    snapshot();
    const add = !removing();
    let recognized: HTMLCanvasElement | null = null;
    if (recognizeRect && markerColor === null) {
      onBusyChange?.('スマート認識中です。しばらくお待ちください...');
      try { recognized = await recognizeInRect(image, studioScaleRect(rect, current.mask, { width: image.naturalWidth, height: image.naturalHeight })); }
      finally { onBusyChange?.(null); }
    }
    if (recognized) {
      current.context.globalCompositeOperation = add ? 'source-over' : 'destination-out';
      current.context.drawImage(recognized, rect.x, rect.y, rect.width, rect.height);
      current.context.globalCompositeOperation = 'source-over';
    } else if (markerColor) {
      current.context.fillStyle = markerColor;
      current.context.globalCompositeOperation = add ? 'source-over' : 'destination-out';
      current.context.fillRect(rect.x, rect.y, rect.width, rect.height);
      current.context.globalCompositeOperation = 'source-over';
      if (add) usedColorsRef.current.add(markerColor);
    } else {
      const data = current.context.getImageData(0, 0, current.mask.width, current.mask.height);
      studioFillRectAlpha(rgbaOf(data), rect, add);
      current.context.putImageData(data, 0, 0);
    }
    changed();
  };
  const closePen = () => {
    if (draft?.kind !== 'pen') return;
    const points = draft.points;
    setDraft(null);
    const current = maskContext();
    if (!current || points.length < 3) return;
    snapshot();
    paintStyle(current.context);
    current.context.beginPath();
    studioPenTrace(current.context, points);
    current.context.fill();
    current.context.globalCompositeOperation = 'source-over';
    if (markerColor && !removing()) usedColorsRef.current.add(markerColor);
    changed();
  };
  useEffect(() => {
    if (draft?.kind !== 'pen') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') { event.preventDefault(); closePen(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setDraft(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => { if (tool !== 'pen') setDraft(current => (current?.kind === 'pen' ? null : current)); }, [tool]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerActivate?.();
    if (!size) return;
    if (spaceDown || event.button === 1) {
      gesture.current = { kind: 'pan', client: { x: event.clientX, y: event.clientY }, origin: { x: viewRef.current.x, y: viewRef.current.y } };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || tool === 'none') return;
    const point = pointOnMask(event);
    if (tool === 'pen') {
      const points = draft?.kind === 'pen' ? draft.points : [];
      const overlay = overlayRef.current;
      const perScreen = overlay && maskRef.current ? maskRef.current.width / overlay.getBoundingClientRect().width : 1;
      const hit = studioPenHit(points, point, 10 * perScreen);
      if (penMode === 'delete') { if (hit >= 0) setDraft({ kind: 'pen', points: points.filter((_, index) => index !== hit) }); return; }
      if (penMode === 'select' || penMode === 'curve') {
        if (hit < 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { kind: penMode === 'select' ? 'pen-move' : 'pen-curve', index: hit, moved: false };
        return;
      }
      if (hit === 0 && points.length >= 3) { closePen(); return; }
      setDraft({ kind: 'pen', points: [...points, point] });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'brush' || tool === 'eraser') {
      snapshot();
      gesture.current = { kind: 'paint', last: point };
      strokeTo(point, point);
    } else if (tool === 'lasso') {
      gesture.current = { kind: 'lasso' };
      setDraft({ kind: 'lasso', points: [point] });
    } else if (tool === 'rect') {
      gesture.current = { kind: 'rect', start: point };
      setDraft({ kind: 'rect', rect: { x: point.x, y: point.y, width: 0, height: 0 } });
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || !size) return;
    if (current.kind === 'pan' && current.client && current.origin) {
      const origin = current.origin, client = current.client;
      setView(view => ({ ...view, x: origin.x + event.clientX - client.x, y: origin.y + event.clientY - client.y }));
      return;
    }
    const point = pointOnMask(event);
    if ((current.kind === 'pen-move' || current.kind === 'pen-curve') && current.index !== undefined) {
      const index = current.index, curve = current.kind === 'pen-curve';
      current.moved = true;
      setDraft(previous => {
        if (previous?.kind !== 'pen' || !previous.points[index]) return previous;
        const points = previous.points.map((item, at) => {
          if (at !== index) return item;
          // 選択: 点を動かす（曲線の取っ手も一緒に）。曲線: 点から引いた所が取っ手（反対側は点を挟んで同じ長さ）。
          if (curve) return { ...item, handle: { x: point.x, y: point.y } };
          const dx = point.x - item.x, dy = point.y - item.y;
          return { x: point.x, y: point.y, ...(item.handle ? { handle: { x: item.handle.x + dx, y: item.handle.y + dy } } : {}) };
        });
        return { kind: 'pen', points };
      });
      return;
    }
    if (current.kind === 'paint' && current.last) { strokeTo(current.last, point); current.last = point; }
    else if (current.kind === 'lasso') setDraft(previous => (previous?.kind === 'lasso' ? { kind: 'lasso', points: [...previous.points, point] } : previous));
    else if (current.kind === 'rect' && current.start) setDraft({ kind: 'rect', rect: studioRectFromDrag(current.start, point, size) });
  };
  const onPointerUp = () => {
    const current = gesture.current;
    gesture.current = null;
    if (!current) return;
    if (current.kind === 'paint') changed();
    // 曲線で引かずに押しただけなら、その点を角に戻す。
    if (current.kind === 'pen-curve' && !current.moved && current.index !== undefined) {
      const index = current.index;
      setDraft(previous => (previous?.kind === 'pen' ? { kind: 'pen', points: previous.points.map((item, at) => (at === index ? { x: item.x, y: item.y } : item)) } : previous));
    }
    if (current.kind === 'lasso' && draft?.kind === 'lasso') { const points = draft.points; setDraft(null); fillPolygon(points); }
    if (current.kind === 'rect' && draft?.kind === 'rect') { const rect = draft.rect; setDraft(null); void applyRect(rect); }
  };

  // ---- 書き出し -------------------------------------------------------------------------------------------
  const isEmpty = () => {
    const current = maskContext();
    return !current || !studioAlphaBounds(rgbaOf(current.context.getImageData(0, 0, current.mask.width, current.mask.height)));
  };
  /** マスクを元の大きさへ伸ばした RGBA。 */
  const naturalMask = () => {
    const current = maskContext();
    if (!current || !image) return null;
    const layer = canvasOf(image.naturalWidth, image.naturalHeight);
    layer.context.imageSmoothingEnabled = true;
    layer.context.drawImage(current.mask, 0, 0, image.naturalWidth, image.naturalHeight);
    return layer.context.getImageData(0, 0, image.naturalWidth, image.naturalHeight);
  };
  const cutoutImageData = () => {
    if (!image || isEmpty()) return null;
    const mask = naturalMask();
    if (!mask) return null;
    const source = canvasOf(image.naturalWidth, image.naturalHeight);
    source.context.drawImage(image, 0, 0);
    const pixels = source.context.getImageData(0, 0, image.naturalWidth, image.naturalHeight);
    return new ImageData(studioApplyMaskAlpha(rgbaOf(pixels), rgbaOf(mask)), image.naturalWidth, image.naturalHeight);
  };

  useImperativeHandle(ref, () => ({
    isEmpty,
    getMaskImageData: () => {
      const current = maskContext();
      if (!current || isEmpty()) return null;
      return current.context.getImageData(0, 0, current.mask.width, current.mask.height);
    },
    getMask: async (name = 'mask.png') => {
      if (isEmpty()) return null;
      const mask = naturalMask();
      if (!mask) return null;
      for (let at = 0; at < mask.data.length; at += 4) { if (mask.data[at + 3] === 0) continue; mask.data[at] = 255; mask.data[at + 1] = 255; mask.data[at + 2] = 255; }
      const out = canvasOf(mask.width, mask.height);
      out.context.putImageData(mask, 0, 0);
      return toPngFile(out.canvas, name);
    },
    getCutout: async (name = 'cutout.png') => {
      const data = cutoutImageData();
      if (!data) return null;
      const out = canvasOf(data.width, data.height);
      out.context.putImageData(data, 0, 0);
      return toPngFile(out.canvas, name);
    },
    getClip: async (name = 'clip.png') => {
      const data = cutoutImageData();
      if (!data) return null;
      const clip = studioAutoClip(rgbaOf(data));
      if (!clip) return null;
      const out = canvasOf(clip.width, clip.height);
      out.context.putImageData(new ImageData(Uint8ClampedArray.from(clip.data), clip.width, clip.height), 0, 0);
      return toPngFile(out.canvas, name);
    },
    getGuide: async (name = 'guide.png') => {
      const current = maskContext();
      if (!current || !image || isEmpty()) return null;
      const ratio = Math.min(1, GUIDE_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.round(image.naturalWidth * ratio), height = Math.round(image.naturalHeight * ratio);
      const out = canvasOf(width, height);
      out.context.drawImage(image, 0, 0, width, height);
      const layer = canvasOf(width, height);
      layer.context.drawImage(current.mask, 0, 0, width, height);
      if (!usedColorsRef.current.size) {
        // AI削除などの1色の案内: 塗った所をティールの不透明な色にする（範囲指定の案内図と同じ）。
        layer.context.globalCompositeOperation = 'source-in';
        layer.context.fillStyle = ERASE_GUIDE_COLOR;
        layer.context.fillRect(0, 0, width, height);
      }
      out.context.drawImage(layer.canvas, 0, 0);
      return toPngFile(out.canvas, name);
    },
    usedColors: () => [...usedColorsRef.current],
    undo: () => stepHistory('undo'),
    redo: () => stepHistory('redo'),
    clear: () => {
      const current = maskContext();
      if (!current || isEmpty()) return;
      snapshot();
      current.context.clearRect(0, 0, current.mask.width, current.mask.height);
      usedColorsRef.current = new Set();
      changed();
    },
    canUndo: () => history.current.undo.length > 0,
    canRedo: () => history.current.redo.length > 0,
    recognize: async (candidate, recognizeMode = 'add') => {
      const current = maskContext();
      if (!current) throw new Error('studio_mask_not_ready');
      onBusyChange?.('スマート認識中です。しばらくお待ちください...');
      try {
        let cutout: MaterialCutoutResult;
        try {
          cutout = await buildPrintGarmentCutoutDataUrl({ imageUrl, modelName: 'u2net_cloth_seg', segmentationTarget: CANDIDATE_TARGET[candidate] });
        } catch {
          cutout = await buildMaterialCutoutDataUrl({ imageUrl, mode: 'auto', candidate, maxSize: MAX_EDGE, preserveSourceFrame: true });
        }
        const cutoutImage = await loadImage(cutout.dataUrl);
        const at = cutoutDrawRect(cutout, { width: current.mask.width, height: current.mask.height });
        snapshot();
        current.context.globalCompositeOperation = recognizeMode === 'remove' ? 'destination-out' : 'source-over';
        current.context.drawImage(cutoutImage, at.x, at.y, at.width, at.height);
        current.context.globalCompositeOperation = 'source-over';
        changed();
      } finally {
        onBusyChange?.(null);
      }
    },
    zoomIn: () => zoomAround(BUTTON_STEP),
    zoomOut: () => zoomAround(1 / BUTTON_STEP),
    fit: fitView,
  }));

  const cursor = spaceDown ? 'cursor-grab' : tool === 'none' ? 'cursor-default' : 'cursor-crosshair';
  return (
    <div
      ref={containerRef}
      data-testid={testId}
      className={`relative h-full w-full touch-none select-none overflow-hidden ${cursor} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => { if (tool === 'pen') closePen(); }}
    >
      {loadFailed && <p className="absolute inset-0 flex items-center justify-center text-sm text-white/60">画像を読み込めませんでした</p>}
      {image && size ? (
        <div className="absolute left-0 top-0" style={{ width: image.naturalWidth * view.scale, height: image.naturalHeight * view.scale, transform: `translate(${view.x}px, ${view.y}px)` }}>
          <img src={image.src} alt="編集する画像" className="absolute inset-0 size-full" draggable={false} />
          <canvas ref={overlayRef} data-testid={`${testId}-mask`} className="absolute inset-0 size-full" />
          <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
            {draft?.kind === 'rect' && <rect x={draft.rect.x} y={draft.rect.y} width={draft.rect.width} height={draft.rect.height} fill="rgba(101,211,207,0.18)" stroke="#5fd0c8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />}
            {draft?.kind === 'lasso' && <polyline points={draft.points.map(point => `${point.x},${point.y}`).join(' ')} fill="rgba(101,211,207,0.18)" stroke="#5fd0c8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />}
            {draft?.kind === 'pen' && (
              <>
                <path d={studioPenPathD(draft.points, false)} data-testid={`${testId}-pen-path`} fill="none" stroke="#5fd0c8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />
                {draft.points.map((point, index) => point.handle && <g key={`h${index}`}>
                  <line x1={2 * point.x - point.handle.x} y1={2 * point.y - point.handle.y} x2={point.handle.x} y2={point.handle.y} stroke="#5fd0c8" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  <circle cx={point.handle.x} cy={point.handle.y} r={Math.max(size.width, size.height) * 0.004} fill="#5fd0c8" />
                  <circle cx={2 * point.x - point.handle.x} cy={2 * point.y - point.handle.y} r={Math.max(size.width, size.height) * 0.004} fill="#5fd0c8" />
                </g>)}
                {draft.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={Math.max(size.width, size.height) * 0.006} fill={index === 0 ? '#5fd0c8' : '#fff'} stroke="#5fd0c8" vectorEffect="non-scaling-stroke" />)}
              </>
            )}
          </svg>
        </div>
      ) : !loadFailed && <div className="absolute inset-6 animate-pulse rounded bg-white/[0.04]" />}
    </div>
  );
});

/** 画像の URL を File に（取れなければ canvas に描いて書き出す）。生成の窓口に元画像を渡すときに使う。 */
export async function studioImageUrlToFile(url: string, name: string): Promise<File> {
  if (url.startsWith('data:')) return studioDataUrlToFile(url, name);
  try {
    const response = await fetch(await refreshSignedImageUrl(url));
    if (response.ok) {
      const blob = await response.blob();
      if (blob.type.startsWith('image/')) return new File([blob], name, { type: blob.type });
    }
  } catch { /* 下の canvas で書き出す */ }
  const image = await loadImage(url);
  const out = canvasOf(image.naturalWidth, image.naturalHeight);
  out.context.drawImage(image, 0, 0);
  return toPngFile(out.canvas, name.replace(/\.[a-z0-9]+$/i, '') + '.png');
}
