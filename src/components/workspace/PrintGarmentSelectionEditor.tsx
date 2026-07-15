import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../ui';
import { Modal } from '../ui/Modal';

type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type SelectionInteraction =
  | { mode: 'create'; start: { x: number; y: number } }
  | { mode: 'move'; start: { x: number; y: number }; origin: SelectionRect }
  | { mode: 'resize'; start: { x: number; y: number }; origin: SelectionRect; handle: ResizeHandle };

const MAX_CANVAS_EDGE = 1600;
const MIN_SELECTION_EDGE = 16;

const resizeHandleDetails: Array<{ id: ResizeHandle; left: number; top: number; cursor: string; label: string }> = [
  { id: 'nw', left: 0, top: 0, cursor: 'nwse-resize', label: '左上' },
  { id: 'n', left: 50, top: 0, cursor: 'ns-resize', label: '上辺' },
  { id: 'ne', left: 100, top: 0, cursor: 'nesw-resize', label: '右上' },
  { id: 'e', left: 100, top: 50, cursor: 'ew-resize', label: '右辺' },
  { id: 'se', left: 100, top: 100, cursor: 'nwse-resize', label: '右下' },
  { id: 's', left: 50, top: 100, cursor: 'ns-resize', label: '下辺' },
  { id: 'sw', left: 0, top: 100, cursor: 'nesw-resize', label: '左下' },
  { id: 'w', left: 0, top: 50, cursor: 'ew-resize', label: '左辺' },
];

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('garment_selection_image_load_failed'));
  image.src = url;
});

const normalizeRect = (start: { x: number; y: number }, end: { x: number; y: number }): SelectionRect => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const resizeRect = ({
  origin,
  handle,
  point,
  canvasWidth,
  canvasHeight,
}: {
  origin: SelectionRect;
  handle: ResizeHandle;
  point: { x: number; y: number };
  canvasWidth: number;
  canvasHeight: number;
}): SelectionRect => {
  let left = origin.x;
  let right = origin.x + origin.width;
  let top = origin.y;
  let bottom = origin.y + origin.height;

  if (handle.includes('w')) left = clamp(point.x, 0, right - MIN_SELECTION_EDGE);
  if (handle.includes('e')) right = clamp(point.x, left + MIN_SELECTION_EDGE, canvasWidth);
  if (handle.includes('n')) top = clamp(point.y, 0, bottom - MIN_SELECTION_EDGE);
  if (handle.includes('s')) bottom = clamp(point.y, top + MIN_SELECTION_EDGE, canvasHeight);

  return { x: left, y: top, width: right - left, height: bottom - top };
};

export function PrintGarmentSelectionEditor({
  isOpen,
  sourceUrl,
  onClose,
  onApply,
}: {
  isOpen: boolean;
  sourceUrl: string;
  onClose: () => void;
  onApply: (selectedImageUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const scaleRef = useRef(1);
  const interactionRef = useRef<SelectionInteraction | null>(null);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const render = useCallback((nextSelection: SelectionRect | null) => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (!nextSelection) return;

    context.save();
    context.fillStyle = 'rgba(0, 0, 0, 0.48)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.beginPath();
    context.rect(nextSelection.x, nextSelection.y, nextSelection.width, nextSelection.height);
    context.clip();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.restore();

    context.save();
    context.strokeStyle = '#67e8f9';
    context.lineWidth = Math.max(2, canvas.width / 500);
    context.setLineDash([10, 8]);
    context.strokeRect(nextSelection.x, nextSelection.y, nextSelection.width, nextSelection.height);
    context.restore();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setReady(false);
    setSelection(null);
    setCanvasSize({ width: 0, height: 0 });
    setError(null);
    void loadImage(sourceUrl)
      .then((image) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('garment_selection_canvas_missing');
        const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = longestEdge > MAX_CANVAS_EDGE ? MAX_CANVAS_EDGE / longestEdge : 1;
        scaleRef.current = scale;
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        imageRef.current = image;
        const initialSelection = { x: 0, y: 0, width: canvas.width, height: canvas.height };
        setCanvasSize({ width: canvas.width, height: canvas.height });
        setSelection(initialSelection);
        render(initialSelection);
        setReady(true);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('Garment selection editor failed to load', loadError);
        setError('画像を選択画面へ読み込めませんでした。');
      });
    return () => {
      cancelled = true;
      interactionRef.current = null;
    };
  }, [isOpen, render, sourceUrl]);

  const pointFromEvent = (event: React.PointerEvent<HTMLElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / rect.width) * canvas.width)),
      y: Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / rect.height) * canvas.height)),
    };
  };

  const setNextSelection = (nextSelection: SelectionRect) => {
    setSelection(nextSelection);
    render(nextSelection);
  };

  const updateSelection = (event: React.PointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    const point = pointFromEvent(event);
    if (!interaction || !point || !canvasSize.width || !canvasSize.height) return;
    let nextSelection: SelectionRect;
    if (interaction.mode === 'create') {
      nextSelection = normalizeRect(interaction.start, point);
    } else if (interaction.mode === 'move') {
      nextSelection = {
        ...interaction.origin,
        x: clamp(point.x - (interaction.start.x - interaction.origin.x), 0, canvasSize.width - interaction.origin.width),
        y: clamp(point.y - (interaction.start.y - interaction.origin.y), 0, canvasSize.height - interaction.origin.height),
      };
    } else {
      nextSelection = resizeRect({
        origin: interaction.origin,
        handle: interaction.handle,
        point,
        canvasWidth: canvasSize.width,
        canvasHeight: canvasSize.height,
      });
    }
    setNextSelection(nextSelection);
  };

  const capturePointer = (event: React.PointerEvent<HTMLElement>) => {
    canvasWrapRef.current?.setPointerCapture(event.pointerId);
  };

  const beginCreate = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || event.button !== 0) return;
    const start = pointFromEvent(event);
    if (!start) return;
    interactionRef.current = { mode: 'create', start };
    capturePointer(event);
    setNextSelection({ x: start.x, y: start.y, width: 1, height: 1 });
  };

  const beginMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || !selection || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = pointFromEvent(event);
    if (!start) return;
    interactionRef.current = { mode: 'move', start, origin: selection };
    capturePointer(event);
  };

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    if (!ready || !selection || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = pointFromEvent(event);
    if (!start) return;
    interactionRef.current = { mode: 'resize', start, origin: selection, handle };
    capturePointer(event);
  };

  const endInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    interactionRef.current = null;
    canvasWrapRef.current?.releasePointerCapture?.(event.pointerId);
  };

  const selectWholeCanvas = () => {
    if (!ready || !canvasSize.width || !canvasSize.height) return;
    setNextSelection({ x: 0, y: 0, width: canvasSize.width, height: canvasSize.height });
  };

  const clearSelection = () => {
    interactionRef.current = null;
    setSelection(null);
    render(null);
  };

  const apply = () => {
    const image = imageRef.current;
    const currentSelection = selection;
    if (!image || !currentSelection || currentSelection.width < MIN_SELECTION_EDGE || currentSelection.height < MIN_SELECTION_EDGE) {
      setError('服全体が入るように、16px以上の範囲をドラッグで選択してください。');
      return;
    }
    try {
      const scale = scaleRef.current;
      const sourceX = currentSelection.x / scale;
      const sourceY = currentSelection.y / scale;
      const sourceWidth = currentSelection.width / scale;
      const sourceHeight = currentSelection.height / scale;
      const output = document.createElement('canvas');
      output.width = Math.max(1, Math.round(sourceWidth));
      output.height = Math.max(1, Math.round(sourceHeight));
      const context = output.getContext('2d');
      if (!context) throw new Error('garment_selection_output_context_missing');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
      onApply(output.toDataURL('image/png'));
    } catch (applyError) {
      console.error('Garment selection export failed', applyError);
      setError('選択範囲をAIマスクへ渡せませんでした。別の範囲で再試行してください。');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="範囲を選んでAIマスク"
      size="xl"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>キャンセル</Button>
          <Button onClick={apply} disabled={!ready || !selection}>選択範囲をAIマスクへ渡す</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-300">
          初期範囲は画像全体です。四隅・四辺の丸いハンドルで調整し、選択枠の中央をドラッグして移動できます。外側をドラッグすると範囲を作り直せます。
        </p>
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <div className="overflow-auto rounded-2xl border border-cyan-300/20 bg-neutral-950 p-3">
          <div
            ref={canvasWrapRef}
            className={`relative mx-auto w-fit max-w-full ${ready ? 'cursor-crosshair' : 'opacity-50'}`}
            onPointerDown={beginCreate}
            onPointerMove={updateSelection}
            onPointerUp={endInteraction}
            onPointerCancel={() => { interactionRef.current = null; }}
          >
            <canvas
              ref={canvasRef}
              className="block h-auto max-h-[62vh] max-w-full touch-none object-contain"
            />
            {ready && selection && canvasSize.width > 0 && canvasSize.height > 0 && (
              <div className="pointer-events-none absolute inset-0">
                <div
                  className="pointer-events-auto absolute border-2 border-cyan-300 bg-cyan-300/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.16)]"
                  style={{
                    left: `${(selection.x / canvasSize.width) * 100}%`,
                    top: `${(selection.y / canvasSize.height) * 100}%`,
                    width: `${(selection.width / canvasSize.width) * 100}%`,
                    height: `${(selection.height / canvasSize.height) * 100}%`,
                  }}
                  onPointerDown={beginMove}
                >
                  <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/65 px-2 py-1 text-[10px] font-medium text-white">
                    中央をドラッグして移動
                  </span>
                  {resizeHandleDetails.map((handle) => (
                    <button
                      key={handle.id}
                      type="button"
                      aria-label={`選択範囲の${handle.label}を調整`}
                      className="pointer-events-auto absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-400 shadow-lg shadow-cyan-950/50"
                      style={{ left: `${handle.left}%`, top: `${handle.top}%`, cursor: handle.cursor }}
                      onPointerDown={(event) => beginResize(event, handle.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectWholeCanvas}
            disabled={!ready}
            className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            画像全体を選択
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={!ready}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            選択をやり直す
          </button>
        </div>
        <p role="status" aria-live="polite" className="text-xs text-neutral-500 dark:text-neutral-400">
          {selection ? `選択中: ${Math.round(selection.width / scaleRef.current)} × ${Math.round(selection.height / scaleRef.current)}px` : '選択範囲がありません。画像上をドラッグして選択してください。'}
        </p>
      </div>
    </Modal>
  );
}
