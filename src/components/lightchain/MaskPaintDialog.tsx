import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Brush, ChevronDown, Eraser, MousePointer2, MousePointerClick, Paintbrush, Redo2, ScanSearch, Sparkles, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { buildMaterialCutoutDataUrl, buildPrintGarmentCutoutDataUrl } from '../../lib/workspaceMaterialReferences';
import type { GarmentSegmentationTarget } from '../../features/printing/selection/garmentSegmentationPolicy';
import { ShortcutSheetButton } from './EditorImageTools';
import { cutoutDrawRect, maskBounds, regionAtPoint } from './printPlacement';

/**
 * Light's single-pane mask window (画像修正 → the round button on the source, measured 2026-10-28): hint pill with the
 * repair mode, キャンセル / 決定, a toolbar (AIマスク認識 ▾, 選択範囲にオブジェクトを追加 ▾ (追加 / 取り除く), ブラシ, 消しゴム,
 * 全削除, undo / redo, ショートカット) and one pane titled with what to paint. 決定 returns the painted mask.
 */
type Tool = 'brush' | 'eraser' | 'object-add' | 'object-remove';
const MASK_CANDIDATES = ['トップス', 'ボトムス', '全身'] as const;
const CANDIDATE_TARGET: Record<(typeof MASK_CANDIDATES)[number], GarmentSegmentationTarget> = { トップス: 'upper', ボトムス: 'lower', 全身: 'full' };
const MAX_EDGE = 1024;
const HISTORY_LIMIT = 20;
const MASK_COLOR = 'rgba(101, 211, 207, 0.78)';

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('mask_dialog_image_load_failed'));
  image.src = url;
});

export function MaskPaintDialog({ imageUrl, hint, paneTitle, initialMask, onCancel, onConfirm }: {
  imageUrl: string;
  hint: string;
  paneTitle: string;
  initialMask?: ImageData | null;
  onCancel: () => void;
  /** The painted mask at the working size (alpha > 0 = painted), or null when nothing is painted. */
  onConfirm: (mask: ImageData | null) => void;
}) {
  const [tool, setTool] = useState<Tool>('brush');
  const [maskMenuOpen, setMaskMenuOpen] = useState(false);
  const [objectMenuOpen, setObjectMenuOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const history = useRef<{ undo: ImageData[]; redo: ImageData[] }>({ undo: [], redo: [] });
  const painting = useRef(false);
  const [, setRevision] = useState(0);

  const size = image ? (() => {
    const ratio = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    return { width: Math.round(image.naturalWidth * ratio), height: Math.round(image.naturalHeight * ratio) };
  })() : null;

  useEffect(() => {
    let cancelled = false;
    void loadImage(imageUrl).then((loaded) => { if (!cancelled) setImage(loaded); }).catch(() => { if (!cancelled) toast.error('画像を読み込めませんでした'); });
    return () => { cancelled = true; };
  }, [imageUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useEffect(() => {
    if (!size) return;
    const mask = document.createElement('canvas');
    mask.width = size.width; mask.height = size.height;
    if (initialMask && initialMask.width === size.width && initialMask.height === size.height) mask.getContext('2d')?.putImageData(initialMask, 0, 0);
    maskRef.current = mask;
    history.current = { undo: [], redo: [] };
    setRevision((value) => value + 1);
    // Only a new image size resets the mask.
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

  const maskContext = () => {
    const mask = maskRef.current, context = mask?.getContext('2d');
    return mask && context ? { mask, context } : null;
  };
  const maskIsEmpty = () => {
    const current = maskContext();
    return !current || !maskBounds(current.context.getImageData(0, 0, current.mask.width, current.mask.height));
  };
  const snapshot = () => {
    const current = maskContext();
    if (!current) return;
    history.current.undo.push(current.context.getImageData(0, 0, current.mask.width, current.mask.height));
    if (history.current.undo.length > HISTORY_LIMIT) history.current.undo.shift();
    history.current.redo = [];
  };
  const stepHistory = (direction: 'undo' | 'redo') => {
    const current = maskContext();
    const from = history.current[direction], to = history.current[direction === 'undo' ? 'redo' : 'undo'];
    const target = from.pop();
    if (!current || !target) return;
    to.push(current.context.getImageData(0, 0, current.mask.width, current.mask.height));
    current.context.putImageData(target, 0, 0);
    setRevision((value) => value + 1);
  };
  const clearMask = () => {
    const current = maskContext();
    if (!current) return;
    snapshot();
    current.context.clearRect(0, 0, current.mask.width, current.mask.height);
    setRevision((value) => value + 1);
  };

  const detectMask = async (candidate: (typeof MASK_CANDIDATES)[number]) => {
    setMaskMenuOpen(false);
    const current = maskContext();
    if (!current || detecting) return;
    setDetecting(true);
    try {
      let cutout;
      try {
        cutout = await buildPrintGarmentCutoutDataUrl({ imageUrl, modelName: 'u2net_cloth_seg', segmentationTarget: CANDIDATE_TARGET[candidate] });
      } catch {
        cutout = await buildMaterialCutoutDataUrl({ imageUrl, mode: 'auto', candidate, maxSize: MAX_EDGE, preserveSourceFrame: true });
      }
      const cutoutImage = await loadImage(cutout.dataUrl);
      const rect = cutoutDrawRect(cutout, { width: current.mask.width, height: current.mask.height });
      snapshot();
      current.context.clearRect(0, 0, current.mask.width, current.mask.height);
      current.context.drawImage(cutoutImage, rect.x, rect.y, rect.width, rect.height);
      setRevision((value) => value + 1);
    } catch {
      toast.error('マスクを認識できませんでした。ブラシで範囲を塗ってください');
    } finally {
      setDetecting(false);
    }
  };

  const pointOnMask = (event: ReactPointerEvent<HTMLCanvasElement>, mask: HTMLCanvasElement) => {
    const rect = (overlayRef.current as HTMLCanvasElement).getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * mask.width, y: ((event.clientY - rect.top) / rect.height) * mask.height };
  };
  const selectObjectAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = maskContext();
    if (!current || !image) return;
    const pixels = document.createElement('canvas');
    pixels.width = current.mask.width; pixels.height = current.mask.height;
    const pixelContext = pixels.getContext('2d');
    if (!pixelContext) return;
    pixelContext.drawImage(image, 0, 0, pixels.width, pixels.height);
    const point = pointOnMask(event, current.mask);
    const region = regionAtPoint(pixelContext.getImageData(0, 0, pixels.width, pixels.height), point.x, point.y);
    snapshot();
    const data = current.context.getImageData(0, 0, current.mask.width, current.mask.height);
    for (let index = 0; index < region.length; index += 1) if (region[index]) data.data[index * 4 + 3] = tool === 'object-remove' ? 0 : 255;
    current.context.putImageData(data, 0, 0);
    setRevision((value) => value + 1);
  };
  const paintAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = maskContext();
    if (!current) return;
    const point = pointOnMask(event, current.mask);
    current.context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    current.context.fillStyle = '#000';
    current.context.beginPath();
    current.context.arc(point.x, point.y, Math.max(current.mask.width, current.mask.height) * 0.025, 0, Math.PI * 2);
    current.context.fill();
    current.context.globalCompositeOperation = 'source-over';
    renderOverlay();
  };

  const confirm = () => {
    const current = maskContext();
    if (!current || maskIsEmpty()) { onConfirm(null); return; }
    onConfirm(current.context.getImageData(0, 0, current.mask.width, current.mask.height));
  };

  const toolbarButton = (active: boolean) => `inline-flex h-12 items-center gap-1.5 rounded-lg px-3 text-[13px] transition ${active ? 'bg-[#5fd0c8]/20 text-[#5fd0c8]' : 'text-white/85 hover:bg-white/[0.06]'}`;
  const iconButton = 'inline-flex h-8 w-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.06]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label={hint} data-testid="mask-paint-dialog">
      <div className="relative flex h-[773px] max-h-[calc(100vh-24px)] w-[1296px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg bg-[#232728] text-white shadow-2xl">
        <div className="flex items-center justify-between px-4 pt-3">
          <p className="flex w-[400px] max-w-full items-center gap-2 rounded-full bg-[#2f3442] px-4 py-2 text-xs leading-4 text-[#b9c6ff]"><Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-white" />{hint}</p>
          <div className="flex items-center gap-4">
            <button type="button" onClick={onCancel} className="h-8 rounded-lg border border-white/15 px-4 text-sm text-white/85 hover:bg-white/[0.06]">キャンセル</button>
            <button type="button" onClick={confirm} data-testid="mask-paint-confirm" className="h-8 rounded-lg bg-[#5fd0c8] px-4 text-sm text-slate-950">決定</button>
          </div>
        </div>
        <div className="mt-3 flex h-12 items-center gap-1 bg-[#1b1f20] px-4">
          <div className="relative">
            <button type="button" onClick={() => setMaskMenuOpen((open) => !open)} disabled={detecting} aria-expanded={maskMenuOpen} className={toolbarButton(false)}>
              <ScanSearch aria-hidden="true" className="h-5 w-5" /><ChevronDown aria-hidden="true" className="h-3 w-3" />{detecting ? '認識中…' : 'AIマスク認識'}
            </button>
            {maskMenuOpen && (
              <div role="menu" className="absolute left-0 top-12 z-10 w-40 rounded-lg bg-black p-1.5 shadow-xl">
                {MASK_CANDIDATES.map((candidate) => (
                  <button key={candidate} type="button" role="menuitem" onClick={() => void detectMask(candidate)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-white/10">
                    <span className="inline-block h-4 w-4 rounded-full border border-white/40" />{candidate}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button type="button" onClick={() => setObjectMenuOpen((open) => !open)} aria-expanded={objectMenuOpen} aria-pressed={tool.startsWith('object')} className={toolbarButton(tool.startsWith('object'))}>
              <MousePointerClick aria-hidden="true" className="h-4 w-4" /><ChevronDown aria-hidden="true" className="h-3 w-3" />選択範囲にオブジェクトを追加
            </button>
            {objectMenuOpen && (
              <div role="menu" className="absolute left-0 top-12 z-10 w-40 rounded-lg bg-black p-1.5 shadow-xl">
                <button type="button" role="menuitemradio" aria-checked={tool === 'object-add'} onClick={() => { setTool('object-add'); setObjectMenuOpen(false); }} className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-left text-sm hover:bg-white/10"><MousePointerClick aria-hidden="true" className="h-4 w-4" />追加</button>
                <button type="button" role="menuitemradio" aria-checked={tool === 'object-remove'} disabled={maskIsEmpty()} onClick={() => { setTool('object-remove'); setObjectMenuOpen(false); }} className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-left text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"><MousePointer2 aria-hidden="true" className="h-4 w-4" />取り除く</button>
              </div>
            )}
          </div>
          <button type="button" onClick={() => setTool('brush')} aria-pressed={tool === 'brush'} className={toolbarButton(tool === 'brush')}><Brush aria-hidden="true" className="h-4 w-4" />ブラシ</button>
          <button type="button" onClick={() => setTool('eraser')} aria-pressed={tool === 'eraser'} className={toolbarButton(tool === 'eraser')}><Eraser aria-hidden="true" className="h-4 w-4" />消しゴム</button>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" aria-label="全削除" title="全削除" onClick={clearMask} className={iconButton}><Paintbrush aria-hidden="true" className="h-4 w-4" /></button>
            <button type="button" aria-label="元に戻す" onClick={() => stepHistory('undo')} className={iconButton}><Undo2 aria-hidden="true" className="h-4 w-4" /></button>
            <button type="button" aria-label="やり直し" onClick={() => stepHistory('redo')} className={iconButton}><Redo2 aria-hidden="true" className="h-4 w-4" /></button>
            <ShortcutSheetButton buttonClassName={iconButton} />
          </div>
        </div>
        <h3 className="mt-3 text-center text-sm text-white/90">{paneTitle}</h3>
        <div className="mx-4 mb-4 mt-3 flex min-h-0 flex-1 items-center justify-center rounded-lg bg-[#0b1113]">
          {image && size ? (
            <div className="relative max-h-full max-w-full" style={{ aspectRatio: `${size.width} / ${size.height}`, height: '100%' }}>
              <img src={imageUrl} alt="参考画像" className="absolute inset-0 size-full object-contain" draggable={false} />
              <canvas
                ref={overlayRef}
                data-testid="mask-paint-canvas"
                className="absolute inset-0 size-full cursor-crosshair"
                onPointerDown={(event) => { if (tool.startsWith('object')) { selectObjectAt(event); return; } snapshot(); painting.current = true; event.currentTarget.setPointerCapture(event.pointerId); paintAt(event); }}
                onPointerMove={(event) => { if (painting.current) paintAt(event); }}
                onPointerUp={() => { painting.current = false; setRevision((value) => value + 1); }}
              />
            </div>
          ) : <div className="h-full w-full animate-pulse rounded bg-white/[0.04]" />}
        </div>
      </div>
    </div>
  );
}
