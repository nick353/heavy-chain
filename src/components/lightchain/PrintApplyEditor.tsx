import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BringToFront, Brush, ChevronDown, ChevronsDown, ChevronsUp, Contrast, Copy, Crop, Eraser, FlipHorizontal2, FlipVertical2, Layers, MousePointer2, MousePointerClick, Paintbrush, Redo2, RefreshCw, Repeat, ScanSearch, SendToBack, Sparkles, Trash2, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { buildMaterialCutoutDataUrl, buildPrintGarmentCutoutDataUrl } from '../../lib/workspaceMaterialReferences';
import { cutoutDrawRect, fitPlacementToBounds, maskBounds, movePlacementLayer, regionAtPoint, type LayerMove, type PrintPlacement } from './printPlacement';
import { ShortcutSheetButton } from './EditorImageTools';

export type { PrintPlacement } from './printPlacement';
import type { GarmentSegmentationTarget } from '../../features/printing/selection/garmentSegmentationPolicy';

/**
 * Light's プリントイメージ 「適用」 dialog (re-measured signed in on jp.linkaigc.com, 2026-10-28):
 * hint pill + キャンセル / 決定, a toolbar (AIマスク認識 ▾, 選択範囲にオブジェクトを追加 ▾ (追加 / 取り除く), ブラシ, 消しゴム,
 * ワンクリックでトリミング, 切り替え, 全削除, undo / redo, ショートカット) and two panes.
 * ステップ1 paints the print area as a teal mask on the garment; AIマスク認識 segments the garment part with the
 * cloth model. ステップ2 lists every uploaded print (up to 5) beside the garment: clicking a thumbnail places it,
 * any number can be stacked, the selected one moves / resizes / rotates, and the side tools are 透過度, レイヤー
 * (トップに移動 / 上に移動 / 下に移動 / 一番下に移動), 左右反転, 上下反転, 複製, 削除.
 * 決定 returns the garment with every print composited in stacking order inside the mask.
 */
type Step = 1 | 2;
type Tool = 'brush' | 'eraser' | 'object-add' | 'object-remove';
export type PrintEditorPrint = { id: string; url: string };
export type PrintApplyEditorState = { placements: PrintPlacement[]; mask: ImageData | null; maskCandidate: string | null };
const MASK_CANDIDATES = ['トップス', 'ボトムス', '全身'] as const;
const CANDIDATE_TARGET: Record<(typeof MASK_CANDIDATES)[number], GarmentSegmentationTarget> = { トップス: 'upper', ボトムス: 'lower', 全身: 'full' };
const LAYER_MOVES: Array<{ move: LayerMove; label: string }> = [
  { move: 'top', label: 'トップに移動' },
  { move: 'up', label: '上に移動' },
  { move: 'down', label: '下に移動' },
  { move: 'bottom', label: '一番下に移動' },
];
export const MAX_PRINTS = 5;
const MAX_EDGE = 1024;
const HISTORY_LIMIT = 20;
const MASK_COLOR = 'rgba(101, 211, 207, 0.78)';
const DEFAULT_PLACEMENT = { x: 0.5, y: 0.42, scale: 0.32, rotation: 0, flipX: false, flipY: false };

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('print_apply_image_load_failed'));
  image.src = url;
});

/** Draws every print onto the garment in stacking order, clipped to the mask when one is painted. Exported for tests. */
export function composePrintsOnGarment(
  context: CanvasRenderingContext2D,
  garment: CanvasImageSource,
  prints: ReadonlyMap<string, HTMLImageElement>,
  mask: HTMLCanvasElement | null,
  placements: PrintPlacement[],
  size: { width: number; height: number },
) {
  context.drawImage(garment, 0, 0, size.width, size.height);
  const layer = document.createElement('canvas');
  layer.width = size.width; layer.height = size.height;
  const layerContext = layer.getContext('2d');
  if (!layerContext) return;
  for (const placement of placements) {
    const print = prints.get(placement.printId);
    if (!print) continue;
    const printWidth = size.width * placement.scale;
    const printHeight = printWidth * (print.naturalHeight / print.naturalWidth);
    layerContext.setTransform(1, 0, 0, 1, 0, 0);
    layerContext.translate(placement.x * size.width, placement.y * size.height);
    layerContext.rotate((placement.rotation * Math.PI) / 180);
    layerContext.scale(placement.flipX ? -1 : 1, placement.flipY ? -1 : 1);
    layerContext.globalAlpha = placement.opacity ?? 1;
    layerContext.drawImage(print, -printWidth / 2, -printHeight / 2, printWidth, printHeight);
  }
  layerContext.globalAlpha = 1;
  layerContext.setTransform(1, 0, 0, 1, 0, 0);
  if (mask) {
    layerContext.globalCompositeOperation = 'destination-in';
    layerContext.drawImage(mask, 0, 0, size.width, size.height);
  }
  context.drawImage(layer, 0, 0);
}

let placementSequence = 0;
const newPlacementId = () => `placement-${Date.now().toString(36)}-${(placementSequence += 1)}`;

export function PrintApplyEditor({ garmentUrl, prints, initialPrintId, initialState, onCancel, onConfirm }: {
  garmentUrl: string;
  prints: PrintEditorPrint[];
  /** The print whose 適用 opened the dialog; placed once when nothing is placed yet. */
  initialPrintId?: string | null;
  initialState?: PrintApplyEditorState | null;
  onCancel: () => void;
  onConfirm: (composite: Blob, state: PrintApplyEditorState) => void;
}) {
  const [step, setStep] = useState<Step>(initialState?.placements.length ? 2 : 1);
  const [tool, setTool] = useState<Tool>('brush');
  const [maskMenuOpen, setMaskMenuOpen] = useState(false);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [objectMenuOpen, setObjectMenuOpen] = useState(false);
  const [opacityOpen, setOpacityOpen] = useState(false);
  const [maskCandidate, setMaskCandidate] = useState<string | null>(initialState?.maskCandidate ?? null);
  const [detecting, setDetecting] = useState(false);
  const [garment, setGarment] = useState<HTMLImageElement | null>(null);
  const [printImages, setPrintImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [placements, setPlacements] = useState<PrintPlacement[]>(() => (initialState?.placements ?? []).filter((item) => prints.some((print) => print.id === item.printId)));
  const [selectedId, setSelectedId] = useState<string | null>(() => placements[placements.length - 1]?.id ?? null);
  const [saving, setSaving] = useState(false);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const history = useRef<{ undo: ImageData[]; redo: ImageData[] }>({ undo: [], redo: [] });
  const painting = useRef(false);
  const initialPlaced = useRef(false);
  const drag = useRef<{ mode: 'move' | 'resize' | 'rotate'; id: string; startX: number; startY: number; start: PrintPlacement } | null>(null);
  const [, setRevision] = useState(0);
  const printKey = prints.map((print) => `${print.id}:${print.url}`).join('|');

  const size = garment ? (() => {
    const ratio = Math.min(1, MAX_EDGE / Math.max(garment.naturalWidth, garment.naturalHeight));
    return { width: Math.round(garment.naturalWidth * ratio), height: Math.round(garment.naturalHeight * ratio) };
  })() : null;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadImage(garmentUrl), ...prints.map((print) => loadImage(print.url).then((image) => [print.id, image] as const))]).then(([garmentImage, ...loaded]) => {
      if (cancelled) return;
      setGarment(garmentImage as HTMLImageElement);
      setPrintImages(new Map(loaded as Array<readonly [string, HTMLImageElement]>));
    }).catch(() => { if (!cancelled) toast.error('画像を読み込めませんでした'); });
    return () => { cancelled = true; };
    // printKey covers the print list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garmentUrl, printKey]);

  useEffect(() => {
    if (!size) return;
    const mask = document.createElement('canvas');
    mask.width = size.width; mask.height = size.height;
    const saved = initialState?.mask;
    if (saved && saved.width === size.width && saved.height === size.height) mask.getContext('2d')?.putImageData(saved, 0, 0);
    maskRef.current = mask;
    history.current = { undo: [], redo: [] };
    setRevision((value) => value + 1);
    // Only a new garment size resets the mask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size?.width, size?.height]);

  const renderOverlay = useCallback(() => {
    const overlay = overlayRef.current, mask = maskRef.current;
    if (!overlay || !mask) return;
    overlay.width = mask.width; overlay.height = mask.height;
    const context = overlay.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, overlay.width, overlay.height);
    context.drawImage(mask, 0, 0);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = MASK_COLOR;
    context.fillRect(0, 0, overlay.width, overlay.height);
    context.globalCompositeOperation = 'source-over';
  }, []);

  useEffect(() => { renderOverlay(); });

  const snapshot = () => {
    const mask = maskRef.current, context = mask?.getContext('2d');
    if (!mask || !context) return;
    history.current.undo.push(context.getImageData(0, 0, mask.width, mask.height));
    if (history.current.undo.length > HISTORY_LIMIT) history.current.undo.shift();
    history.current.redo = [];
  };

  const stepHistory = (direction: 'undo' | 'redo') => {
    const mask = maskRef.current, context = mask?.getContext('2d');
    const from = history.current[direction], to = history.current[direction === 'undo' ? 'redo' : 'undo'];
    const target = from.pop();
    if (!mask || !context || !target) return;
    to.push(context.getImageData(0, 0, mask.width, mask.height));
    context.putImageData(target, 0, 0);
    setRevision((value) => value + 1);
  };

  const segmentGarment = async (candidate: (typeof MASK_CANDIDATES)[number]) => {
    // The cloth model (u2net_cloth_seg) follows the garment outline; the colour heuristic is only a fallback.
    try {
      return await buildPrintGarmentCutoutDataUrl({ imageUrl: garmentUrl, modelName: 'u2net_cloth_seg', segmentationTarget: CANDIDATE_TARGET[candidate] });
    } catch {
      return buildMaterialCutoutDataUrl({ imageUrl: garmentUrl, mode: 'auto', candidate, maxSize: MAX_EDGE, preserveSourceFrame: true });
    }
  };

  const detectMask = async (candidate: (typeof MASK_CANDIDATES)[number]) => {
    setMaskMenuOpen(false);
    const mask = maskRef.current, context = mask?.getContext('2d');
    if (!mask || !context || detecting) return;
    setDetecting(true);
    try {
      const cutout = await segmentGarment(candidate);
      const cutoutImage = await loadImage(cutout.dataUrl);
      const rect = cutoutDrawRect(cutout, { width: mask.width, height: mask.height });
      snapshot();
      context.clearRect(0, 0, mask.width, mask.height);
      context.drawImage(cutoutImage, rect.x, rect.y, rect.width, rect.height);
      setMaskCandidate(candidate);
      setRevision((value) => value + 1);
    } catch {
      toast.error('マスクを認識できませんでした。ブラシで範囲を塗ってください');
    } finally {
      setDetecting(false);
    }
  };

  const invertMask = () => {
    const mask = maskRef.current, context = mask?.getContext('2d');
    if (!mask || !context) return;
    snapshot();
    const data = context.getImageData(0, 0, mask.width, mask.height);
    for (let index = 3; index < data.data.length; index += 4) {
      const alpha = data.data[index];
      data.data[index - 3] = 0; data.data[index - 2] = 0; data.data[index - 1] = 0; data.data[index] = 255 - alpha;
    }
    context.putImageData(data, 0, 0);
    setRevision((value) => value + 1);
  };

  const clearMask = () => {
    const mask = maskRef.current, context = mask?.getContext('2d');
    if (!mask || !context) return;
    snapshot();
    context.clearRect(0, 0, mask.width, mask.height);
    setMaskCandidate(null);
    setRevision((value) => value + 1);
  };

  const maskIsEmpty = () => {
    const mask = maskRef.current, context = mask?.getContext('2d');
    return !mask || !context || !maskBounds(context.getImageData(0, 0, mask.width, mask.height));
  };

  // 選択範囲にオブジェクトを追加: a click adds (or removes) the connected area of similar colour on the garment.
  const selectObjectAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const overlay = overlayRef.current, mask = maskRef.current, context = mask?.getContext('2d');
    if (!overlay || !mask || !context || !garment) return;
    const pixels = document.createElement('canvas');
    pixels.width = mask.width; pixels.height = mask.height;
    const pixelContext = pixels.getContext('2d');
    if (!pixelContext) return;
    pixelContext.drawImage(garment, 0, 0, mask.width, mask.height);
    const rect = overlay.getBoundingClientRect();
    const region = regionAtPoint(pixelContext.getImageData(0, 0, mask.width, mask.height), ((event.clientX - rect.left) / rect.width) * mask.width, ((event.clientY - rect.top) / rect.height) * mask.height);
    snapshot();
    const data = context.getImageData(0, 0, mask.width, mask.height);
    for (let index = 0; index < region.length; index += 1) {
      if (!region[index]) continue;
      data.data[index * 4 + 3] = tool === 'object-remove' ? 0 : 255;
    }
    context.putImageData(data, 0, 0);
    setRevision((value) => value + 1);
  };

  // ワンクリックでトリミング: fits the selected print (or the top one) inside the painted area.
  const trimToMask = () => {
    const mask = maskRef.current, context = mask?.getContext('2d');
    const bounds = mask && context ? maskBounds(context.getImageData(0, 0, mask.width, mask.height)) : null;
    if (!bounds || !size) { toast.error('マスクを塗ってください。'); return; }
    const target = selected ?? placements[placements.length - 1];
    if (!target) { toast.error('まず図案を追加してください'); return; }
    const image = printImages.get(target.printId);
    const aspect = image ? image.naturalHeight / image.naturalWidth : 1;
    const fitted = fitPlacementToBounds(target, bounds, size, aspect);
    setPlacements((current) => current.map((item) => item.id === target.id ? fitted : item));
    setSelectedId(target.id);
    setStep(2);
  };

  const paintAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const overlay = overlayRef.current, mask = maskRef.current, context = mask?.getContext('2d');
    if (!overlay || !mask || !context) return;
    const rect = overlay.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * mask.width;
    const y = ((event.clientY - rect.top) / rect.height) * mask.height;
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    context.fillStyle = '#000';
    context.beginPath();
    context.arc(x, y, Math.max(mask.width, mask.height) * 0.025, 0, Math.PI * 2);
    context.fill();
    context.globalCompositeOperation = 'source-over';
    renderOverlay();
  };

  const addPrint = useCallback((printId: string) => {
    setStep(2);
    const placement: PrintPlacement = { id: newPlacementId(), printId, ...DEFAULT_PLACEMENT };
    setPlacements((current) => [...current, placement]);
    setSelectedId(placement.id);
  }, []);

  useEffect(() => {
    if (initialPlaced.current || !initialPrintId) return;
    initialPlaced.current = true;
    const placed = [...placements].reverse().find((item) => item.printId === initialPrintId);
    if (placed) { setStep(2); setSelectedId(placed.id); } else addPrint(initialPrintId);
  }, [addPrint, initialPrintId, placements]);

  const selected = placements.find((item) => item.id === selectedId) ?? null;
  const updateSelected = (patch: Partial<PrintPlacement>) => {
    if (!selected) return;
    setPlacements((current) => current.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  };
  const duplicateSelected = () => {
    if (!selected) return;
    const copy = { ...selected, id: newPlacementId(), x: Math.min(1, selected.x + 0.04), y: Math.min(1, selected.y + 0.04) };
    setPlacements((current) => {
      const index = current.findIndex((item) => item.id === selected.id);
      const next = current.slice();
      next.splice(index + 1, 0, copy);
      return next;
    });
    setSelectedId(copy.id);
  };
  const deleteSelected = () => {
    if (!selected) return;
    setPlacements((current) => {
      const next = current.filter((item) => item.id !== selected.id);
      setSelectedId(next[next.length - 1]?.id ?? null);
      return next;
    });
  };
  const moveLayer = (move: LayerMove) => {
    setLayerMenuOpen(false);
    if (!selected) return;
    setPlacements((current) => movePlacementLayer(current, selected.id, move));
  };

  const startDrag = (mode: 'move' | 'resize' | 'rotate', placement: PrintPlacement) => (event: ReactPointerEvent) => {
    event.stopPropagation();
    setStep(2);
    setSelectedId(placement.id);
    (event.target as Element).setPointerCapture?.(event.pointerId);
    drag.current = { mode, id: placement.id, startX: event.clientX, startY: event.clientY, start: placement };
  };

  const onStageMove = (event: ReactPointerEvent) => {
    const current = drag.current, stage = stageRef.current;
    if (!current || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = (event.clientX - current.startX) / rect.width;
    const dy = (event.clientY - current.startY) / rect.height;
    let patch: Partial<PrintPlacement>;
    if (current.mode === 'move') {
      patch = { x: Math.min(1, Math.max(0, current.start.x + dx)), y: Math.min(1, Math.max(0, current.start.y + dy)) };
    } else if (current.mode === 'resize') {
      patch = { scale: Math.min(1.2, Math.max(0.05, current.start.scale + dx * 2)) };
    } else {
      const centerX = rect.left + current.start.x * rect.width, centerY = rect.top + current.start.y * rect.height;
      patch = { rotation: Math.round((Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI + 90) };
    }
    setPlacements((items) => items.map((item) => item.id === current.id ? { ...item, ...patch } : item));
  };

  const confirm = async () => {
    if (!placements.length) { toast.error('まず図案を追加してください'); return; }
    if (!garment || !size) return;
    setSaving(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('print_apply_canvas_unavailable');
      const mask = maskRef.current;
      const maskData = mask?.getContext('2d')?.getImageData(0, 0, mask.width, mask.height) ?? null;
      const hasMask = Boolean(maskData?.data.some((value, index) => index % 4 === 3 && value > 0));
      composePrintsOnGarment(context, garment, printImages, hasMask ? mask : null, placements, size);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('print_apply_encode_failed'))), 'image/png'));
      onConfirm(blob, { placements, mask: hasMask ? maskData : null, maskCandidate });
    } catch {
      toast.error('プリントを合成できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const urlById = useMemo(() => new Map(prints.map((print) => [print.id, print.url])), [prints]);
  const toolbarButton = (active: boolean) => `inline-flex h-12 items-center gap-1.5 rounded-lg px-3 text-[13px] transition ${active ? 'bg-[#5fd0c8]/20 text-[#5fd0c8]' : 'text-white/85 hover:bg-white/[0.06]'}`;
  const sideButton = 'inline-flex h-7 w-7 items-center justify-center rounded text-white/80 hover:bg-white/10 disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="プリントを適用" data-testid="print-apply-editor">
      <div className="relative flex h-[773px] max-h-[calc(100vh-24px)] w-[1296px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg bg-[#232728] text-white shadow-2xl">
        <div className="flex items-center justify-between px-4 pt-3">
          <p className="flex max-w-[400px] items-center gap-2 rounded-full bg-[#2f3442] px-4 py-2 text-xs leading-4 text-[#b9c6ff]"><Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-white" />画像の生成位置をマスクで選択して、角度とサイズを調整してください</p>
          <div className="flex items-center gap-4">
            <button type="button" onClick={onCancel} className="h-8 rounded-lg border border-white/15 px-4 text-sm text-white/85 hover:bg-white/[0.06]">キャンセル</button>
            <button type="button" onClick={() => void confirm()} disabled={saving} data-testid="print-apply-confirm" className="h-8 rounded-lg bg-[#5fd0c8] px-4 text-sm text-slate-950 disabled:opacity-50">決定</button>
          </div>
        </div>
        <div className="mt-3 flex h-12 items-center gap-1 bg-[#1b1f20] px-4">
          <div className="relative">
            <button type="button" onClick={() => { setStep(1); setMaskMenuOpen((open) => !open); }} disabled={detecting} aria-expanded={maskMenuOpen} className={toolbarButton(Boolean(maskCandidate))}>
              <ScanSearch aria-hidden="true" className="h-5 w-5" /><ChevronDown aria-hidden="true" className="h-3 w-3" />{detecting ? '認識中…' : 'AIマスク認識'}
            </button>
            {maskMenuOpen && (
              <div role="menu" className="absolute left-0 top-12 z-10 w-40 rounded-lg bg-black p-1.5 shadow-xl">
                {MASK_CANDIDATES.map((candidate) => (
                  <button key={candidate} type="button" role="menuitemradio" aria-checked={maskCandidate === candidate} onClick={() => void detectMask(candidate)} className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${maskCandidate === candidate ? 'bg-white/10' : 'hover:bg-white/10'}`}>
                    <span className={`inline-block h-4 w-4 rounded-full border ${maskCandidate === candidate ? 'border-[#5fd0c8] bg-[#5fd0c8]' : 'border-white/40'}`} />{candidate}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button type="button" onClick={() => { setStep(1); setObjectMenuOpen((open) => !open); }} aria-expanded={objectMenuOpen} aria-pressed={step === 1 && tool.startsWith('object')} className={toolbarButton(step === 1 && tool.startsWith('object'))}>
              <MousePointerClick aria-hidden="true" className="h-4 w-4" /><ChevronDown aria-hidden="true" className="h-3 w-3" />選択範囲にオブジェクトを追加
            </button>
            {objectMenuOpen && (
              <div role="menu" className="absolute left-0 top-12 z-10 w-40 rounded-lg bg-black p-1.5 shadow-xl" data-testid="print-apply-object-menu">
                <button type="button" role="menuitemradio" aria-checked={tool === 'object-add'} onClick={() => { setTool('object-add'); setObjectMenuOpen(false); }} className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-left text-sm hover:bg-white/10"><MousePointerClick aria-hidden="true" className="h-4 w-4" />追加</button>
                <button type="button" role="menuitemradio" aria-checked={tool === 'object-remove'} disabled={maskIsEmpty()} onClick={() => { setTool('object-remove'); setObjectMenuOpen(false); }} className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-left text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"><MousePointer2 aria-hidden="true" className="h-4 w-4" />取り除く</button>
              </div>
            )}
          </div>
          <button type="button" onClick={() => { setStep(1); setTool('brush'); }} aria-pressed={step === 1 && tool === 'brush'} className={toolbarButton(step === 1 && tool === 'brush')}><Brush aria-hidden="true" className="h-4 w-4" />ブラシ</button>
          <button type="button" onClick={() => { setStep(1); setTool('eraser'); }} aria-pressed={step === 1 && tool === 'eraser'} className={toolbarButton(step === 1 && tool === 'eraser')}><Eraser aria-hidden="true" className="h-4 w-4" />消しゴム</button>
          <button type="button" onClick={trimToMask} data-testid="print-apply-trim" className={toolbarButton(false)}><Crop aria-hidden="true" className="h-4 w-4" />ワンクリックでトリミング</button>
          <button type="button" onClick={invertMask} className={toolbarButton(false)}><Repeat aria-hidden="true" className="h-4 w-4" />切り替え</button>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" aria-label="全削除" title="全削除" onClick={clearMask} className="inline-flex h-8 w-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.06]"><Paintbrush aria-hidden="true" className="h-4 w-4" /></button>
            <button type="button" aria-label="元に戻す" onClick={() => stepHistory('undo')} className="inline-flex h-8 w-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.06]"><Undo2 aria-hidden="true" className="h-4 w-4" /></button>
            <button type="button" aria-label="やり直し" onClick={() => stepHistory('redo')} className="inline-flex h-8 w-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.06]"><Redo2 aria-hidden="true" className="h-4 w-4" /></button>
            <ShortcutSheetButton buttonClassName="inline-flex h-8 w-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.06]" />
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-[42px] px-[18px] pb-4 pt-4">
          {([1, 2] as const).map((paneStep) => (
            <section key={paneStep} className="flex min-h-0 flex-col items-center">
              <h3 className={`text-sm ${step === paneStep ? 'text-[#5fd0c8]' : 'text-white/85'}`}>{paneStep === 1 ? 'ステップ1：画像のプリント領域をマスクで選択してください' : 'ステップ2：プリントの角度とサイズを選択して調整'}</h3>
              <div onPointerDown={() => setStep(paneStep)} className={`relative mt-4 flex min-h-0 w-full flex-1 items-center justify-center rounded-lg border-2 p-4 ${step === paneStep ? 'border-[#5fd0c8]' : 'border-transparent'}`}>
                {paneStep === 2 && (
                  <div className="absolute left-3 top-3 z-10 flex flex-col gap-2" data-testid="print-apply-thumbnails">
                    {prints.map((print) => (
                      <button key={print.id} type="button" aria-label="プリントを追加" title="クリックして配置" onClick={(event) => { event.stopPropagation(); addPrint(print.id); }} className={`h-[62px] w-[62px] overflow-hidden rounded-lg border-2 bg-white/80 ${selected?.printId === print.id ? 'border-[#5fd0c8]' : 'border-white/40'}`}>
                        <img src={print.url} alt="プリント" className="size-full object-contain" draggable={false} />
                      </button>
                    ))}
                  </div>
                )}
                {garment && size ? (
                  <div
                    ref={paneStep === 2 ? stageRef : undefined}
                    className="relative max-h-full max-w-full"
                    style={{ aspectRatio: `${size.width} / ${size.height}`, height: '100%' }}
                    onPointerMove={paneStep === 2 ? onStageMove : undefined}
                    onPointerUp={paneStep === 2 ? () => { drag.current = null; } : undefined}
                    onPointerDown={paneStep === 2 ? () => setSelectedId(null) : undefined}
                  >
                    <img src={garmentUrl} alt={paneStep === 1 ? '参考画像' : ''} className="absolute inset-0 size-full object-contain" draggable={false} />
                    {paneStep === 1 ? (
                      <canvas
                        ref={overlayRef}
                        data-testid="print-apply-mask"
                        className={`absolute inset-0 size-full ${step === 1 ? 'cursor-crosshair' : 'opacity-60'}`}
                        onPointerDown={(event) => { if (step !== 1) return; if (tool.startsWith('object')) { selectObjectAt(event); return; } snapshot(); painting.current = true; event.currentTarget.setPointerCapture(event.pointerId); paintAt(event); }}
                        onPointerMove={(event) => { if (painting.current) paintAt(event); }}
                        onPointerUp={() => { painting.current = false; setRevision((value) => value + 1); }}
                      />
                    ) : (
                      <>
                        {step !== 2 && <div className="pointer-events-none absolute inset-0 bg-black/30" />}
                        {placements.map((placement) => {
                          const image = printImages.get(placement.printId);
                          const aspect = image ? image.naturalHeight / image.naturalWidth : 1;
                          const active = placement.id === selectedId;
                          return (
                            <div
                              key={placement.id}
                              data-testid="print-apply-placement"
                              data-print-id={placement.printId}
                              className={`absolute cursor-move ${active ? 'outline outline-1 outline-[#8fb3ff]' : ''}`}
                              style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, width: `${placement.scale * 100}%`, aspectRatio: `1 / ${aspect}`, transform: `translate(-50%, -50%) rotate(${placement.rotation}deg)` }}
                              onPointerDown={startDrag('move', placement)}
                            >
                              <img src={urlById.get(placement.printId)} alt="" className="size-full object-contain" style={{ transform: `scale(${placement.flipX ? -1 : 1}, ${placement.flipY ? -1 : 1})`, opacity: placement.opacity ?? 1 }} draggable={false} />
                              {active && <>
                                <span onPointerDown={startDrag('rotate', placement)} className="absolute -top-8 left-1/2 flex h-6 w-6 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border border-white/60 bg-white text-slate-800"><RefreshCw aria-hidden="true" className="h-3 w-3" /></span>
                                <span onPointerDown={startDrag('resize', placement)} className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-[#8fb3ff] bg-white" />
                              </>}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                ) : <div className="h-full w-full animate-pulse rounded bg-white/[0.04]" />}
                {paneStep === 2 && (
                  <div className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-lg bg-[#1b1f20]/95 p-1" onPointerDown={(event) => event.stopPropagation()} data-testid="print-apply-tools">
                    <div className="relative">
                      <button type="button" aria-label="透過度" title="透過度" aria-expanded={opacityOpen} disabled={!selected} onClick={() => setOpacityOpen((open) => !open)} className={sideButton}><Contrast aria-hidden="true" className="h-4 w-4" /></button>
                      {opacityOpen && selected && (
                        <div className="absolute right-9 top-0 z-20 flex w-48 items-center gap-2 rounded-lg bg-[#2b3133] px-3 py-2 shadow-xl" data-testid="print-apply-opacity">
                          <input type="range" min={0} max={100} value={Math.round((selected.opacity ?? 1) * 100)} aria-label="透過度" onChange={(event) => updateSelected({ opacity: Number(event.target.value) / 100 })} className="min-w-0 flex-1 accent-[#5fd0c8]" />
                          <span className="w-9 text-right text-xs text-white/80">{Math.round((selected.opacity ?? 1) * 100)}%</span>
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <button type="button" aria-label="レイヤー" title="レイヤー" aria-expanded={layerMenuOpen} disabled={!selected} onClick={() => setLayerMenuOpen((open) => !open)} className={sideButton}><Layers aria-hidden="true" className="h-4 w-4" /></button>
                      {layerMenuOpen && selected && (
                        <div role="menu" className="absolute right-9 top-0 z-20 flex w-[96px] flex-col gap-1 rounded-lg bg-[#2b3133] p-1.5 shadow-xl">
                          {LAYER_MOVES.map(({ move, label }) => {
                            const Icon = move === 'top' ? BringToFront : move === 'up' ? ChevronsUp : move === 'down' ? ChevronsDown : SendToBack;
                            return (
                              <button key={move} type="button" role="menuitem" onClick={() => moveLayer(move)} className="flex flex-col items-center gap-1 rounded px-1 py-2 text-[11px] text-white/80 hover:bg-white/10">
                                <Icon aria-hidden="true" className="h-4 w-4" />{label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <button type="button" aria-label="左右反転" title="左右反転" disabled={!selected} onClick={() => selected && updateSelected({ flipX: !selected.flipX })} className={sideButton}><FlipHorizontal2 aria-hidden="true" className="h-4 w-4" /></button>
                    <button type="button" aria-label="上下反転" title="上下反転" disabled={!selected} onClick={() => selected && updateSelected({ flipY: !selected.flipY })} className={sideButton}><FlipVertical2 aria-hidden="true" className="h-4 w-4" /></button>
                    <button type="button" aria-label="複製" title="複製" disabled={!selected} onClick={duplicateSelected} className={sideButton}><Copy aria-hidden="true" className="h-4 w-4" /></button>
                    <button type="button" aria-label="プリントを削除" title="削除" disabled={!selected} onClick={deleteSelected} className={sideButton}><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
