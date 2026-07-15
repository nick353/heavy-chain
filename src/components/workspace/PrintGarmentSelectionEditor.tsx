import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../ui';
import { Modal } from '../ui/Modal';

type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MAX_CANVAS_EDGE = 1600;
const MIN_SELECTION_EDGE = 16;

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
  const imageRef = useRef<HTMLImageElement | null>(null);
  const scaleRef = useRef(1);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
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
        render(null);
        setReady(true);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('Garment selection editor failed to load', loadError);
        setError('画像を選択画面へ読み込めませんでした。');
      });
    return () => {
      cancelled = true;
      dragStartRef.current = null;
    };
  }, [isOpen, render, sourceUrl]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / rect.width) * canvas.width)),
      y: Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / rect.height) * canvas.height)),
    };
  };

  const updateSelection = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragStartRef.current;
    const end = pointFromEvent(event);
    if (!start || !end) return;
    const nextSelection = normalizeRect(start, end);
    setSelection(nextSelection);
    render(nextSelection);
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
          <Button onClick={apply} disabled={!ready}>選択範囲をAIマスクへ渡す</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-300">
          服全体が入る範囲をドラッグで囲んでください。選択範囲だけを既存のAI切り抜きへ渡すため、背景や別の服が写る画像でも対象を絞れます。
        </p>
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <div className="overflow-auto rounded-2xl border border-cyan-300/20 bg-neutral-950 p-3">
          <canvas
            ref={canvasRef}
            className={`mx-auto h-auto max-h-[62vh] w-full max-w-4xl touch-none object-contain ${ready ? 'cursor-crosshair' : 'opacity-50'}`}
            onPointerDown={(event) => {
              if (!ready) return;
              const start = pointFromEvent(event);
              if (!start) return;
              dragStartRef.current = start;
              event.currentTarget.setPointerCapture(event.pointerId);
              updateSelection(event);
            }}
            onPointerMove={(event) => {
              if (dragStartRef.current) updateSelection(event);
            }}
            onPointerUp={(event) => {
              if (dragStartRef.current) updateSelection(event);
              dragStartRef.current = null;
              event.currentTarget.releasePointerCapture?.(event.pointerId);
            }}
            onPointerCancel={() => {
              dragStartRef.current = null;
            }}
          />
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {selection ? `選択中: ${Math.round(selection.width / scaleRef.current)} × ${Math.round(selection.height / scaleRef.current)}px` : 'まだ範囲が選択されていません'}
        </p>
      </div>
    </Modal>
  );
}
