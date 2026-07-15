import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, Redo2, RotateCcw, Undo2 } from 'lucide-react';

import type { MaterialCutoutBounds } from '../../lib/workspaceMaterialReferences';
import {
  estimatePrintMaskDataUrlBytes,
  nextPrintMaskDownscaleSize,
  PRINT_CUTOUT_MAX_DATA_URL_BYTES,
} from '../../lib/printMaskCandidateStrategy';
import {
  mapPrintMaskPointerToImage,
  mergePrintMaskAlpha,
  paintPrintMaskAlpha,
  type PrintMaskBrushMode,
} from '../../lib/printArtworkMaskStrategy';
import { Button } from '../ui';
import { Modal } from '../ui/Modal';

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('mask_editor_image_load_failed'));
  image.src = url;
});

const readAlpha = (rgba: Uint8ClampedArray) => {
  const alpha = new Uint8ClampedArray(rgba.length / 4);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[(index * 4) + 3];
  return alpha;
};

const MAX_MASK_UNDO_STEPS = 12;

export function PrintMaskEditor({
  isOpen,
  title,
  sourceUrl,
  maskUrl,
  sourceBounds,
  outputSize,
  description,
  applyLabel,
  preserveOutputSize = false,
  noticeMessage,
  onClearNotice,
  onClose,
  onApply,
}: {
  isOpen: boolean;
  title: string;
  sourceUrl: string;
  maskUrl: string;
  sourceBounds: MaterialCutoutBounds;
  outputSize: { width: number; height: number };
  description?: string;
  applyLabel?: string;
  preserveOutputSize?: boolean;
  noticeMessage?: string | null;
  onClearNotice?: () => void;
  onClose: () => void;
  onApply: (dataUrl: string, outputSize: { width: number; height: number }) => void;
}) {
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const editorCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRgbaRef = useRef<Uint8ClampedArray | null>(null);
  const sourceAlphaRef = useRef<Uint8ClampedArray | null>(null);
  const baseAlphaRef = useRef<Uint8ClampedArray | null>(null);
  const alphaRef = useRef<Uint8ClampedArray | null>(null);
  const undoRef = useRef<Uint8ClampedArray[]>([]);
  const pointerActiveRef = useRef(false);
  const [mode, setMode] = useState<PrintMaskBrushMode>('remove');
  const [brushSize, setBrushSize] = useState(24);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoCount, setUndoCount] = useState(0);

  const renderEditor = useCallback(() => {
    const canvas = editorCanvasRef.current;
    const sourceRgba = sourceRgbaRef.current;
    const alpha = alphaRef.current;
    if (!canvas || !sourceRgba || !alpha) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const rgba = mergePrintMaskAlpha(sourceRgba, alpha);
    context.putImageData(new ImageData(rgba, canvas.width, canvas.height), 0, 0);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    setMode('remove');
    setZoom(1);
    undoRef.current = [];
    setUndoCount(0);
    void Promise.all([loadImage(sourceUrl), loadImage(maskUrl)])
      .then(([sourceImage, maskImage]) => {
        if (cancelled) return;
        const width = Math.max(1, outputSize.width);
        const height = Math.max(1, outputSize.height);
        const sourceCanvas = sourceCanvasRef.current;
        const editorCanvas = editorCanvasRef.current;
        if (!sourceCanvas || !editorCanvas) throw new Error('mask_editor_canvas_missing');
        sourceCanvas.width = width;
        sourceCanvas.height = height;
        editorCanvas.width = width;
        editorCanvas.height = height;
        const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
        const editorContext = editorCanvas.getContext('2d', { willReadFrequently: true });
        if (!sourceContext || !editorContext) throw new Error('mask_editor_context_missing');
        sourceContext.clearRect(0, 0, width, height);
        sourceContext.drawImage(
          sourceImage,
          sourceBounds.x,
          sourceBounds.y,
          sourceBounds.width,
          sourceBounds.height,
          0,
          0,
          width,
          height,
        );
        editorContext.clearRect(0, 0, width, height);
        editorContext.drawImage(maskImage, 0, 0, width, height);
        const sourceData = sourceContext.getImageData(0, 0, width, height);
        const maskData = editorContext.getImageData(0, 0, width, height);
        const editableSource = new Uint8ClampedArray(sourceData.data);
        for (let index = 0; index < width * height; index += 1) {
          const rgbaIndex = index * 4;
          if (maskData.data[rgbaIndex + 3] > 0) {
            editableSource[rgbaIndex] = maskData.data[rgbaIndex];
            editableSource[rgbaIndex + 1] = maskData.data[rgbaIndex + 1];
            editableSource[rgbaIndex + 2] = maskData.data[rgbaIndex + 2];
          }
        }
        sourceRgbaRef.current = editableSource;
        sourceAlphaRef.current = readAlpha(sourceData.data);
        baseAlphaRef.current = readAlpha(maskData.data);
        alphaRef.current = new Uint8ClampedArray(baseAlphaRef.current);
        renderEditor();
        setReady(true);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('Print mask editor failed to load', loadError);
        setError('画像を編集画面へ読み込めませんでした。');
      });
    return () => {
      cancelled = true;
      pointerActiveRef.current = false;
    };
  }, [isOpen, maskUrl, outputSize.height, outputSize.width, renderEditor, sourceBounds.height, sourceBounds.width, sourceBounds.x, sourceBounds.y, sourceUrl]);

  const pushUndo = () => {
    if (!alphaRef.current) return;
    undoRef.current = [
      ...undoRef.current.slice(-(MAX_MASK_UNDO_STEPS - 1)),
      new Uint8ClampedArray(alphaRef.current),
    ];
    setUndoCount(undoRef.current.length);
  };

  const paintAtPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = editorCanvasRef.current;
    const alpha = alphaRef.current;
    const sourceAlpha = sourceAlphaRef.current;
    if (!canvas || !alpha || !sourceAlpha) return;
    const rect = canvas.getBoundingClientRect();
    const point = mapPrintMaskPointerToImage({
      clientX: event.clientX,
      clientY: event.clientY,
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
      imageWidth: canvas.width,
      imageHeight: canvas.height,
    });
    alphaRef.current = paintPrintMaskAlpha({
      alpha,
      sourceAlpha,
      width: canvas.width,
      height: canvas.height,
      centerX: point.x,
      centerY: point.y,
      radius: brushSize / 2,
      mode,
    });
    renderEditor();
  };

  const undo = () => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    alphaRef.current = previous;
    setUndoCount(undoRef.current.length);
    renderEditor();
  };

  const reset = () => {
    if (!baseAlphaRef.current || !alphaRef.current) return;
    pushUndo();
    alphaRef.current = new Uint8ClampedArray(baseAlphaRef.current);
    renderEditor();
    onClearNotice?.();
  };

  const apply = () => {
    const canvas = editorCanvasRef.current;
    if (!canvas || !ready) return;
    renderEditor();
    let outputCanvas = canvas;
    let dataUrl = outputCanvas.toDataURL('image/png');
    while (
      !preserveOutputSize
      &&
      estimatePrintMaskDataUrlBytes(dataUrl) > PRINT_CUTOUT_MAX_DATA_URL_BYTES
      && (outputCanvas.width > 1 || outputCanvas.height > 1)
    ) {
      const resized = document.createElement('canvas');
      const nextSize = nextPrintMaskDownscaleSize(outputCanvas);
      resized.width = nextSize.width;
      resized.height = nextSize.height;
      const context = resized.getContext('2d');
      if (!context) {
        setError('手動補正データを保存用に縮小できませんでした。');
        return;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(outputCanvas, 0, 0, resized.width, resized.height);
      outputCanvas = resized;
      dataUrl = outputCanvas.toDataURL('image/png');
    }
    if (estimatePrintMaskDataUrlBytes(dataUrl) > PRINT_CUTOUT_MAX_DATA_URL_BYTES) {
      setError(preserveOutputSize
        ? '印刷可能面は元画像と同じ解像度で保存する必要があります。範囲を単純にして再試行してください。'
        : '手動補正データを保存上限内にできませんでした。');
      return;
    }
    onApply(dataUrl, { width: outputCanvas.width, height: outputCanvas.height });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="xl"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>キャンセル</Button>
          <Button onClick={apply} disabled={!ready}>{applyLabel ?? 'マスクを適用'}</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-300">
          {description ?? '左の元画像と見比べながら、右のマスクを「残す」「消す」ブラシで補正します。'}
        </p>
        {noticeMessage ? (
          <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {noticeMessage}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 p-2 dark:border-white/10">
          <button type="button" onClick={() => setMode('keep')} aria-pressed={mode === 'keep'} className={`rounded-lg px-3 py-2 text-sm ${mode === 'keep' ? 'bg-cyan-500 text-white' : 'bg-neutral-100 dark:bg-white/5'}`}>
            <Redo2 className="mr-1 inline h-4 w-4" />残す
          </button>
          <button type="button" onClick={() => setMode('remove')} aria-pressed={mode === 'remove'} className={`rounded-lg px-3 py-2 text-sm ${mode === 'remove' ? 'bg-rose-500 text-white' : 'bg-neutral-100 dark:bg-white/5'}`}>
            <Eraser className="mr-1 inline h-4 w-4" />消す
          </button>
          <label className="ml-2 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-300">
            ブラシ
            <input type="range" min="4" max="80" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
            {brushSize}px
          </label>
          <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-300">
            ズーム
            <input type="range" min="1" max="4" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            {zoom.toFixed(2)}x
          </label>
          <button type="button" onClick={undo} disabled={undoCount === 0} className="rounded-lg p-2 disabled:opacity-40" aria-label="元に戻す"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={reset} disabled={!ready} className="rounded-lg p-2 disabled:opacity-40" aria-label="リセット"><RotateCcw className="h-4 w-4" /></button>
        </div>
        {error && <p className="text-sm text-rose-500">{error}</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold text-neutral-500 dark:text-neutral-300">元画像</p>
            <div className="overflow-auto rounded-xl bg-neutral-900/90 p-2">
              <canvas ref={sourceCanvasRef} className="h-auto max-h-[55vh] w-full object-contain" />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-neutral-500 dark:text-neutral-300">編集するマスク</p>
            <div className="max-h-[58vh] overflow-auto rounded-xl bg-[linear-gradient(45deg,#303030_25%,transparent_25%),linear-gradient(-45deg,#303030_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#303030_75%),linear-gradient(-45deg,transparent_75%,#303030_75%)] bg-[length:20px_20px] p-2">
              <canvas
                ref={editorCanvasRef}
                className="h-auto w-full cursor-crosshair touch-none"
                style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                onPointerDown={(event) => {
                  if (!ready) return;
                  pushUndo();
                  pointerActiveRef.current = true;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  paintAtPointer(event);
                }}
                onPointerMove={(event) => {
                  if (pointerActiveRef.current) paintAtPointer(event);
                }}
                onPointerUp={(event) => {
                  pointerActiveRef.current = false;
                  event.currentTarget.releasePointerCapture?.(event.pointerId);
                }}
                onPointerCancel={() => { pointerActiveRef.current = false; }}
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
