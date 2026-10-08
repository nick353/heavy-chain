import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Brush, ChevronDown, Eraser, FlipHorizontal2, Redo2, RefreshCw, Repeat, ScanSearch, Sparkles, Trash2, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { buildMaterialCutoutDataUrl } from '../../lib/workspaceMaterialReferences';

/**
 * Light's プリントイメージ 「適用」 dialog, measured at 1440×900 (2026-10-08): a 1296×773 dialog with a hint pill and
 * キャンセル / 決定, a toolbar (AIマスク認識 ▾, ブラシ, 消しゴム, 切り替え, undo / redo) and two 571px panes —
 * ステップ1 paints the print area as a teal mask on the garment, ステップ2 places the print (double-click the
 * thumbnail to add it, drag to move, corner to resize, top handle to rotate). 決定 returns the garment with the
 * print composited inside the mask, which becomes the reference image for AI生成.
 */
type Step = 1 | 2;
type Tool = 'brush' | 'eraser';
type Placement = { x: number; y: number; scale: number; rotation: number; flipX: boolean };
const MASK_CANDIDATES = ['トップス', 'ボトムス', '全身'] as const;
const MAX_EDGE = 1024;
const HISTORY_LIMIT = 20;
const MASK_COLOR = 'rgba(101, 211, 207, 0.78)';

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('print_apply_image_load_failed'));
  image.src = url;
});

/** Draws the print onto the garment, clipped to the mask when one is painted. Exported for tests. */
export function composePrintOnGarment(
  context: CanvasRenderingContext2D,
  garment: CanvasImageSource,
  print: HTMLImageElement,
  mask: HTMLCanvasElement | null,
  placement: Placement,
  size: { width: number; height: number },
) {
  context.drawImage(garment, 0, 0, size.width, size.height);
  const layer = document.createElement('canvas');
  layer.width = size.width; layer.height = size.height;
  const layerContext = layer.getContext('2d');
  if (!layerContext) return;
  const printWidth = size.width * placement.scale;
  const printHeight = printWidth * (print.naturalHeight / print.naturalWidth);
  layerContext.translate(placement.x * size.width, placement.y * size.height);
  layerContext.rotate((placement.rotation * Math.PI) / 180);
  layerContext.scale(placement.flipX ? -1 : 1, 1);
  layerContext.drawImage(print, -printWidth / 2, -printHeight / 2, printWidth, printHeight);
  layerContext.setTransform(1, 0, 0, 1, 0, 0);
  if (mask) {
    layerContext.globalCompositeOperation = 'destination-in';
    layerContext.drawImage(mask, 0, 0, size.width, size.height);
  }
  context.drawImage(layer, 0, 0);
}

export function PrintApplyEditor({ garmentUrl, printUrl, onCancel, onConfirm }: {
  garmentUrl: string;
  printUrl: string;
  onCancel: () => void;
  onConfirm: (composite: Blob) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [tool, setTool] = useState<Tool>('brush');
  const [maskMenuOpen, setMaskMenuOpen] = useState(false);
  const [maskCandidate, setMaskCandidate] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [garment, setGarment] = useState<HTMLImageElement | null>(null);
  const [print, setPrint] = useState<HTMLImageElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [saving, setSaving] = useState(false);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const history = useRef<{ undo: ImageData[]; redo: ImageData[] }>({ undo: [], redo: [] });
  const painting = useRef(false);
  const drag = useRef<{ mode: 'move' | 'resize' | 'rotate'; startX: number; startY: number; start: Placement } | null>(null);
  const [, setRevision] = useState(0);

  const size = garment ? (() => {
    const ratio = Math.min(1, MAX_EDGE / Math.max(garment.naturalWidth, garment.naturalHeight));
    return { width: Math.round(garment.naturalWidth * ratio), height: Math.round(garment.naturalHeight * ratio) };
  })() : null;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadImage(garmentUrl), loadImage(printUrl)]).then(([garmentImage, printImage]) => {
      if (cancelled) return;
      setGarment(garmentImage); setPrint(printImage);
    }).catch(() => { if (!cancelled) toast.error('画像を読み込めませんでした'); });
    return () => { cancelled = true; };
  }, [garmentUrl, printUrl]);

  useEffect(() => {
    if (!size) return;
    const mask = document.createElement('canvas');
    mask.width = size.width; mask.height = size.height;
    maskRef.current = mask;
    history.current = { undo: [], redo: [] };
    setRevision((value) => value + 1);
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

  const detectMask = async (candidate: string) => {
    setMaskMenuOpen(false);
    const mask = maskRef.current, context = mask?.getContext('2d');
    if (!mask || !context || detecting) return;
    setDetecting(true);
    try {
      const cutout = await buildMaterialCutoutDataUrl({ imageUrl: garmentUrl, mode: 'auto', candidate, maxSize: MAX_EDGE, preserveSourceFrame: true });
      const cutoutImage = await loadImage(cutout.dataUrl);
      snapshot();
      context.clearRect(0, 0, mask.width, mask.height);
      context.drawImage(cutoutImage, 0, 0, mask.width, mask.height);
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

  const addPrint = () => {
    setStep(2);
    setPlacement((current) => current ?? { x: 0.5, y: 0.42, scale: 0.32, rotation: 0, flipX: false });
  };

  const startDrag = (mode: 'move' | 'resize' | 'rotate') => (event: ReactPointerEvent) => {
    if (!placement) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    drag.current = { mode, startX: event.clientX, startY: event.clientY, start: placement };
  };

  const onStageMove = (event: ReactPointerEvent) => {
    const current = drag.current, stage = stageRef.current;
    if (!current || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = (event.clientX - current.startX) / rect.width;
    const dy = (event.clientY - current.startY) / rect.height;
    if (current.mode === 'move') {
      setPlacement({ ...current.start, x: Math.min(1, Math.max(0, current.start.x + dx)), y: Math.min(1, Math.max(0, current.start.y + dy)) });
    } else if (current.mode === 'resize') {
      setPlacement({ ...current.start, scale: Math.min(1.2, Math.max(0.05, current.start.scale + dx * 2)) });
    } else {
      const centerX = rect.left + current.start.x * rect.width, centerY = rect.top + current.start.y * rect.height;
      const angle = (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI + 90;
      setPlacement({ ...current.start, rotation: Math.round(angle) });
    }
  };

  const confirm = async () => {
    if (!placement || !print) { toast.error('まず図案を追加してください'); return; }
    if (!garment || !size) return;
    setSaving(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('print_apply_canvas_unavailable');
      const mask = maskRef.current;
      const hasMask = Boolean(mask?.getContext('2d')?.getImageData(0, 0, mask.width, mask.height).data.some((value, index) => index % 4 === 3 && value > 0));
      composePrintOnGarment(context, garment, print, hasMask ? mask : null, placement, size);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('print_apply_encode_failed'))), 'image/png'));
      onConfirm(blob);
    } catch {
      toast.error('プリントを合成できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const printAspect = print ? print.naturalHeight / print.naturalWidth : 1;
  const toolbarButton = (active: boolean) => `inline-flex h-12 items-center gap-1.5 rounded-lg px-3 text-[13px] transition ${active ? 'bg-[#5fd0c8]/20 text-[#5fd0c8]' : 'text-white/85 hover:bg-white/[0.06]'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="プリントを適用" data-testid="print-apply-editor">
      <div className="flex h-[773px] max-h-[calc(100vh-24px)] w-[1296px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg bg-[#232728] text-white shadow-2xl">
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
          <button type="button" onClick={() => { setStep(1); setTool('brush'); }} aria-pressed={step === 1 && tool === 'brush'} className={toolbarButton(step === 1 && tool === 'brush')}><Brush aria-hidden="true" className="h-4 w-4" />ブラシ</button>
          <button type="button" onClick={() => { setStep(1); setTool('eraser'); }} aria-pressed={step === 1 && tool === 'eraser'} className={toolbarButton(step === 1 && tool === 'eraser')}><Eraser aria-hidden="true" className="h-4 w-4" />消しゴム</button>
          <button type="button" onClick={invertMask} className={toolbarButton(false)}><Repeat aria-hidden="true" className="h-4 w-4" />切り替え</button>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" aria-label="元に戻す" onClick={() => stepHistory('undo')} className="inline-flex h-8 w-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.06]"><Undo2 aria-hidden="true" className="h-4 w-4" /></button>
            <button type="button" aria-label="やり直し" onClick={() => stepHistory('redo')} className="inline-flex h-8 w-8 items-center justify-center rounded text-white/80 hover:bg-white/[0.06]"><Redo2 aria-hidden="true" className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-[42px] px-[18px] pb-4 pt-4">
          {([1, 2] as const).map((paneStep) => (
            <section key={paneStep} className="flex min-h-0 flex-col items-center">
              <h3 className={`text-sm ${step === paneStep ? 'text-[#5fd0c8]' : 'text-white/85'}`}>{paneStep === 1 ? 'ステップ1：画像のプリント領域をマスクで選択してください' : 'ステップ2：プリントの角度とサイズを選択して調整'}</h3>
              <div onPointerDown={() => setStep(paneStep)} className={`mt-4 flex min-h-0 w-full flex-1 items-center justify-center rounded-lg border-2 p-4 ${step === paneStep ? 'border-[#5fd0c8]' : 'border-transparent'}`}>
                {garment && size ? (
                  <div
                    ref={paneStep === 2 ? stageRef : undefined}
                    className="relative max-h-full max-w-full"
                    style={{ aspectRatio: `${size.width} / ${size.height}`, height: '100%' }}
                    onPointerMove={paneStep === 2 ? onStageMove : undefined}
                    onPointerUp={paneStep === 2 ? () => { drag.current = null; } : undefined}
                  >
                    <img src={garmentUrl} alt={paneStep === 1 ? '参考画像' : ''} className="absolute inset-0 size-full object-contain" draggable={false} />
                    {paneStep === 1 ? (
                      <canvas
                        ref={overlayRef}
                        data-testid="print-apply-mask"
                        className={`absolute inset-0 size-full ${step === 1 ? 'cursor-crosshair' : 'opacity-60'}`}
                        onPointerDown={(event) => { if (step !== 1) return; snapshot(); painting.current = true; event.currentTarget.setPointerCapture(event.pointerId); paintAt(event); }}
                        onPointerMove={(event) => { if (painting.current) paintAt(event); }}
                        onPointerUp={() => { painting.current = false; setRevision((value) => value + 1); }}
                      />
                    ) : (
                      <>
                        {step !== 2 && <div className="pointer-events-none absolute inset-0 bg-black/30" />}
                        <button type="button" aria-label="プリントを追加" onDoubleClick={addPrint} onClick={addPrint} className={`absolute left-2 top-2 h-[62px] w-[62px] overflow-hidden rounded-lg border-2 bg-white/80 ${placement ? 'border-[#5fd0c8]' : 'border-white/40'}`}>
                          <img src={printUrl} alt="プリント" className="size-full object-contain" draggable={false} />
                        </button>
                        {placement && (
                          <div
                            data-testid="print-apply-placement"
                            className="absolute cursor-move outline outline-1 outline-[#8fb3ff]"
                            style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, width: `${placement.scale * 100}%`, aspectRatio: `1 / ${printAspect}`, transform: `translate(-50%, -50%) rotate(${placement.rotation}deg)` }}
                            onPointerDown={startDrag('move')}
                          >
                            <img src={printUrl} alt="" className="size-full object-contain" style={{ transform: placement.flipX ? 'scaleX(-1)' : undefined }} draggable={false} />
                            <span onPointerDown={startDrag('rotate')} className="absolute -top-8 left-1/2 flex h-6 w-6 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border border-white/60 bg-white text-slate-800"><RefreshCw aria-hidden="true" className="h-3 w-3" /></span>
                            <span onPointerDown={startDrag('resize')} className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-[#8fb3ff] bg-white" />
                          </div>
                        )}
                        <div className="absolute right-2 top-2 flex flex-col gap-1 rounded-lg bg-[#232728]/90 p-1">
                          <button type="button" aria-label="左右反転" disabled={!placement} onClick={() => placement && setPlacement({ ...placement, flipX: !placement.flipX })} className="inline-flex h-7 w-7 items-center justify-center rounded text-white/80 hover:bg-white/10 disabled:opacity-40"><FlipHorizontal2 aria-hidden="true" className="h-4 w-4" /></button>
                          <button type="button" aria-label="配置をリセット" disabled={!placement} onClick={() => setPlacement({ x: 0.5, y: 0.42, scale: 0.32, rotation: 0, flipX: false })} className="inline-flex h-7 w-7 items-center justify-center rounded text-white/80 hover:bg-white/10 disabled:opacity-40"><RefreshCw aria-hidden="true" className="h-4 w-4" /></button>
                          <button type="button" aria-label="プリントを削除" disabled={!placement} onClick={() => setPlacement(null)} className="inline-flex h-7 w-7 items-center justify-center rounded text-white/80 hover:bg-white/10 disabled:opacity-40"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
                        </div>
                      </>
                    )}
                  </div>
                ) : <div className="h-full w-full animate-pulse rounded bg-white/[0.04]" />}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
