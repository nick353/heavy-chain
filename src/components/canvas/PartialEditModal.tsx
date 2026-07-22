import { useEffect, useRef, useState } from 'react';
import { Eraser, Paintbrush, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal, Button, Textarea } from '../ui';
import { resolveGeneratedImageUrl } from '../../lib/storage';

export interface PartialEditPayload {
  prompt: string;
  maskDataUrl: string;
  maskCoveragePercent: number;
  maskWidth: number;
  maskHeight: number;
}

interface PartialEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onSubmit: (payload: PartialEditPayload) => Promise<void>;
}

type MaskTool = 'brush' | 'eraser';

const DEFAULT_BRUSH_SIZE = 72;

export function PartialEditModal({ isOpen, onClose, imageUrl, onSubmit }: PartialEditModalProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const visualMaskRef = useRef<HTMLCanvasElement>(null);
  const apiMaskRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState(imageUrl);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [prompt, setPrompt] = useState('');
  const [tool, setTool] = useState<MaskTool>('brush');
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [hasMask, setHasMask] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isOpen) return undefined;

    setPrompt('');
    setTool('brush');
    setBrushSize(DEFAULT_BRUSH_SIZE);
    setHasMask(false);
    setDimensions({ width: 0, height: 0 });

    const resolvePreview = async () => {
      try {
        const resolved = await resolveGeneratedImageUrl(imageUrl);
        if (!cancelled) setPreviewUrl(resolved);
      } catch {
        if (!cancelled) setPreviewUrl(imageUrl);
      }
    };
    void resolvePreview();

    return () => {
      cancelled = true;
    };
  }, [imageUrl, isOpen]);

  const resetCanvases = (width: number, height: number) => {
    const visualCanvas = visualMaskRef.current;
    const apiCanvas = apiMaskRef.current;
    if (!visualCanvas || !apiCanvas || width <= 0 || height <= 0) return;

    visualCanvas.width = width;
    visualCanvas.height = height;
    apiCanvas.width = width;
    apiCanvas.height = height;

    const visualContext = visualCanvas.getContext('2d');
    const apiContext = apiCanvas.getContext('2d');
    if (!visualContext || !apiContext) return;

    visualContext.clearRect(0, 0, width, height);
    apiContext.globalCompositeOperation = 'source-over';
    apiContext.fillStyle = 'rgba(0, 0, 0, 1)';
    apiContext.fillRect(0, 0, width, height);
    setDimensions({ width, height });
    setHasMask(false);
  };

  const handleImageLoad = () => {
    const image = imageRef.current;
    if (!image) return;
    resetCanvases(image.naturalWidth || image.width, image.naturalHeight || image.height);
  };

  const getCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = visualMaskRef.current;
    if (!canvas || !dimensions.width || !dimensions.height) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.max(0, Math.min(dimensions.width, ((event.clientX - rect.left) / rect.width) * dimensions.width)),
      y: Math.max(0, Math.min(dimensions.height, ((event.clientY - rect.top) / rect.height) * dimensions.height)),
      scaleX: dimensions.width / rect.width,
      scaleY: dimensions.height / rect.height,
    };
  };

  const drawAt = (point: { x: number; y: number; scaleX: number; scaleY: number }) => {
    const visualCanvas = visualMaskRef.current;
    const apiCanvas = apiMaskRef.current;
    if (!visualCanvas || !apiCanvas) return;
    const visualContext = visualCanvas.getContext('2d');
    const apiContext = apiCanvas.getContext('2d');
    if (!visualContext || !apiContext) return;

    const radiusX = Math.max(2, (brushSize / 2) * point.scaleX);
    const radiusY = Math.max(2, (brushSize / 2) * point.scaleY);
    const paintCircle = (context: CanvasRenderingContext2D) => {
      context.beginPath();
      context.ellipse(point.x, point.y, radiusX, radiusY, 0, 0, Math.PI * 2);
      context.fill();
    };

    if (tool === 'brush') {
      visualContext.globalCompositeOperation = 'source-over';
      visualContext.fillStyle = 'rgba(37, 99, 235, 0.66)';
      paintCircle(visualContext);
      apiContext.globalCompositeOperation = 'destination-out';
      paintCircle(apiContext);
      setHasMask(true);
    } else {
      visualContext.globalCompositeOperation = 'destination-out';
      paintCircle(visualContext);
      apiContext.globalCompositeOperation = 'source-over';
      apiContext.fillStyle = 'rgba(0, 0, 0, 1)';
      paintCircle(apiContext);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getCanvasPoint(event);
    if (!point) return;
    drawingRef.current = true;
    lastPointRef.current = point;
    drawAt(point);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const point = getCanvasPoint(event);
    if (!point) return;
    drawAt(point);
    lastPointRef.current = point;
  };

  const stopDrawing = (event?: React.PointerEvent<HTMLCanvasElement>) => {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const resetMask = () => {
    if (!dimensions.width || !dimensions.height) return;
    resetCanvases(dimensions.width, dimensions.height);
  };

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();
    const apiCanvas = apiMaskRef.current;
    if (!trimmedPrompt) {
      toast.error('部分編集の指示を入力してください');
      return;
    }
    if (!hasMask || !apiCanvas || !dimensions.width || !dimensions.height) {
      toast.error('青いマスクで編集範囲を指定してください');
      return;
    }

    const apiContext = apiCanvas.getContext('2d');
    if (!apiContext) {
      toast.error('マスクの読み込みに失敗しました');
      return;
    }

    const alpha = apiContext.getImageData(0, 0, dimensions.width, dimensions.height).data;
    let transparentPixels = 0;
    for (let index = 3; index < alpha.length; index += 4) {
      if (alpha[index] < 240) transparentPixels += 1;
    }
    const maskCoveragePercent = (transparentPixels / (dimensions.width * dimensions.height)) * 100;
    if (maskCoveragePercent <= 0) {
      toast.error('編集範囲が空です。青いマスクを描いてください');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        prompt: trimmedPrompt,
        maskDataUrl: apiCanvas.toDataURL('image/png'),
        maskCoveragePercent: Number(maskCoveragePercent.toFixed(2)),
        maskWidth: dimensions.width,
        maskHeight: dimensions.height,
      });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '部分編集に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="部分編集（Inpaint）" size="xl">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-white">編集範囲を青く塗る</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">透明になるmask領域だけがAI編集の対象です。</p>
            </div>
            <span
              data-testid="partial-edit-mask-status"
              className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
            >
              {hasMask ? 'マスク指定済み' : 'マスク未指定'}
            </span>
          </div>

          <div
            data-testid="partial-edit-mask-stage"
            className="relative mx-auto flex max-h-[58vh] min-h-[260px] items-center justify-center overflow-hidden rounded-2xl border border-blue-200 bg-slate-100 shadow-inner dark:border-blue-400/30 dark:bg-slate-900"
          >
            <img
              ref={imageRef}
              src={previewUrl}
              alt="部分編集の対象画像"
              onLoad={handleImageLoad}
              className="block max-h-[58vh] max-w-full object-contain"
            />
            <canvas
              ref={visualMaskRef}
              data-testid="partial-edit-mask-canvas"
              aria-label="部分編集マスク。ドラッグして青い編集範囲を指定"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDrawing}
              onPointerCancel={stopDrawing}
              onPointerLeave={stopDrawing}
              className="absolute max-h-[58vh] max-w-full cursor-crosshair touch-none"
              style={{ width: imageRef.current?.clientWidth || '100%', height: imageRef.current?.clientHeight || '100%' }}
            />
            <canvas
              ref={apiMaskRef}
              data-testid="partial-edit-api-mask-canvas"
              aria-hidden="true"
              className="hidden"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="partial-edit-brush"
              aria-pressed={tool === 'brush'}
              onClick={() => setTool('brush')}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${tool === 'brush' ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-white/10 dark:text-neutral-200'}`}
            >
              <Paintbrush className="h-4 w-4" />
              塗る
            </button>
            <button
              type="button"
              data-testid="partial-edit-eraser"
              aria-pressed={tool === 'eraser'}
              onClick={() => setTool('eraser')}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${tool === 'eraser' ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-white/10 dark:text-neutral-200'}`}
            >
              <Eraser className="h-4 w-4" />
              消す
            </button>
            <button
              type="button"
              data-testid="partial-edit-reset"
              onClick={resetMask}
              className="inline-flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-200 dark:bg-white/10 dark:text-neutral-200"
            >
              <RotateCcw className="h-4 w-4" />
              リセット
            </button>
            <label className="ml-auto flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              ブラシサイズ
              <input
                data-testid="partial-edit-brush-size"
                type="range"
                min="20"
                max="160"
                step="4"
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                className="accent-blue-600"
              />
              <span className="w-9 text-right">{brushSize}px</span>
            </label>
          </div>
        </div>

        <div className="flex flex-col">
          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-400/20 dark:bg-blue-500/10">
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">Inpaint指示</p>
            <p className="mt-1 text-xs leading-5 text-blue-800/80 dark:text-blue-100/80">
              青い範囲だけを自然に変更する内容を短く入力してください。
            </p>
          </div>
          <div className="mt-4">
            <Textarea
              data-testid="partial-edit-prompt"
              label="部分編集プロンプト"
              placeholder="例: ベージュTシャツを深いネイビーに変更し、人物と背景はそのまま"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
            />
          </div>
          <div className="mt-auto flex justify-end gap-3 pt-6">
            <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
              キャンセル
            </Button>
            <Button
              data-testid="partial-edit-submit"
              onClick={handleSubmit}
              isLoading={isSubmitting}
              disabled={isSubmitting}
            >
              部分編集を実行
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
