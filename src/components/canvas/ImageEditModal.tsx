import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { 
  Brush,
  Eraser,
  Scissors, 
  Palette, 
  Maximize2, 
  RefreshCw,
  Redo2,
  Trash2,
  Undo2,
  Wand2
} from 'lucide-react';
import { Modal, Button, Textarea } from '../ui';
import toast from 'react-hot-toast';
import { resolveGeneratedImageUrl } from '../../lib/storage';
import { hasEditableMaskPixels } from './inpaintMask';

interface ImageEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onEdit: (action: string, params: { prompt?: string; maskDataUrl?: string }) => Promise<boolean>;
}

type EditMode = 'prompt' | 'remove-bg' | 'colorize' | 'upscale' | 'variations' | 'inpaint';
type MaskPoint = { x: number; y: number };
type MaskStroke = { points: MaskPoint[]; size: number; erase: boolean };

export function ImageEditModal({ isOpen, onClose, imageUrl, onEdit }: ImageEditModalProps) {
  const [mode, setMode] = useState<EditMode>('prompt');
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(imageUrl);
  const [brushSize, setBrushSize] = useState(36);
  const [isErasing, setIsErasing] = useState(false);
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [redoStrokes, setRedoStrokes] = useState<MaskStroke[]>([]);
  const [maskDimensions, setMaskDimensions] = useState({ width: 1024, height: 1024 });
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const resolvePreview = async () => {
      try {
        const resolved = await resolveGeneratedImageUrl(imageUrl);
        if (!cancelled) {
          setPreviewUrl(resolved);
        }
      } catch {
        if (!cancelled) {
          setPreviewUrl(imageUrl);
        }
      }
    };

    void resolvePreview();
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  useEffect(() => {
    if (!isOpen) return;
    setMode('prompt');
    setPrompt('');
    setIsErasing(false);
    setStrokes([]);
    setRedoStrokes([]);
  }, [imageUrl, isOpen]);

  const drawStroke = useCallback((
    context: CanvasRenderingContext2D,
    stroke: MaskStroke,
    maskOutput = false,
  ) => {
    if (stroke.points.length === 0) return;
    context.save();
    context.globalCompositeOperation = maskOutput
      ? (stroke.erase ? 'source-over' : 'destination-out')
      : (stroke.erase ? 'destination-out' : 'source-over');
    const color = maskOutput ? '#000' : 'rgba(239, 68, 68, 0.58)';
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = stroke.size;
    if (stroke.points.length === 1) {
      const [point] = stroke.points;
      context.beginPath();
      context.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
    }
    context.restore();
  }, []);

  const renderMaskOverlay = useCallback(() => {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach((stroke) => drawStroke(context, stroke));
  }, [drawStroke, strokes]);

  useEffect(() => {
    renderMaskOverlay();
  }, [renderMaskOverlay]);

  const maskPointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      point: {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height,
      },
      size: (brushSize / rect.width) * canvas.width,
    };
  };

  const handleMaskPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const next = maskPointFromEvent(event);
    if (!next) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    setRedoStrokes([]);
    setStrokes((current) => [...current, { points: [next.point], size: next.size, erase: isErasing }]);
  };

  const handleMaskPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const next = maskPointFromEvent(event);
    if (!next) return;
    setStrokes((current) => current.map((stroke, index) => (
      index === current.length - 1
        ? { ...stroke, points: [...stroke.points, next.point] }
        : stroke
    )));
  };

  const finishMaskStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const buildMaskDataUrl = () => {
    const overlay = maskCanvasRef.current;
    if (!overlay?.width || !overlay.height || !strokes.some((stroke) => !stroke.erase && stroke.points.length > 0)) {
      return null;
    }
    const mask = document.createElement('canvas');
    mask.width = overlay.width;
    mask.height = overlay.height;
    const context = mask.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#000';
    context.fillRect(0, 0, mask.width, mask.height);
    strokes.forEach((stroke) => drawStroke(context, stroke, true));
    if (!hasEditableMaskPixels(context.getImageData(0, 0, mask.width, mask.height).data)) {
      return null;
    }
    return mask.toDataURL('image/png');
  };

  const editModes = [
    { id: 'prompt', icon: Wand2, label: 'プロンプト編集', description: 'テキストで画像を編集' },
    { id: 'inpaint', icon: Brush, label: '部分編集', description: 'ブラシで範囲を指定' },
    { id: 'remove-bg', icon: Scissors, label: '背景削除', description: '背景を透明に' },
    { id: 'colorize', icon: Palette, label: '色変更', description: '色違いを作成' },
    { id: 'upscale', icon: Maximize2, label: 'アップスケール', description: '高解像度化' },
    { id: 'variations', icon: RefreshCw, label: 'バリエーション', description: '類似画像を生成' },
  ] as const;

  const handleSubmit = async () => {
    setIsProcessing(true);
    try {
      const maskDataUrl = mode === 'inpaint' ? buildMaskDataUrl() : undefined;
      if (mode === 'inpaint' && !maskDataUrl) {
        toast.error('編集する範囲をブラシで塗ってください');
        return;
      }
      const completed = await onEdit(mode, { prompt, maskDataUrl: maskDataUrl || undefined });
      if (completed) onClose();
    } catch (error) {
      console.error('Edit failed:', error);
      toast.error(error instanceof Error ? error.message : '画像編集に失敗しました');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="画像を編集"
      size="lg"
    >
      <div className="flex gap-6">
        {/* Preview */}
        <div className="w-72 flex-shrink-0">
          <div className="relative aspect-square rounded-xl overflow-hidden bg-neutral-100 mb-4">
            <img
              src={previewUrl}
              alt="編集対象"
              className="w-full h-full object-contain"
              crossOrigin="anonymous"
              onLoad={(event) => {
                setMaskDimensions({
                  width: event.currentTarget.naturalWidth || 1024,
                  height: event.currentTarget.naturalHeight || 1024,
                });
              }}
            />
            {mode === 'inpaint' && (
              <canvas
                ref={maskCanvasRef}
                width={maskDimensions.width}
                height={maskDimensions.height}
                data-testid="canvas-inpaint-mask"
                className="absolute left-1/2 top-1/2 max-h-full max-w-full -translate-x-1/2 -translate-y-1/2 touch-none cursor-crosshair"
                style={{
                  aspectRatio: `${maskDimensions.width} / ${maskDimensions.height}`,
                  width: maskDimensions.width >= maskDimensions.height ? '100%' : 'auto',
                  height: maskDimensions.height > maskDimensions.width ? '100%' : 'auto',
                }}
                onPointerDown={handleMaskPointerDown}
                onPointerMove={handleMaskPointerMove}
                onPointerUp={finishMaskStroke}
                onPointerCancel={finishMaskStroke}
              />
            )}
          </div>
          <p className="text-xs text-neutral-500 text-center">
            {mode === 'inpaint' ? '赤い範囲だけを編集します' : '元の画像'}
          </p>
          {mode === 'inpaint' && (
            <div className="mt-3 space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsErasing(false)}
                  aria-pressed={!isErasing}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-medium ${!isErasing ? 'bg-cyan-300 text-neutral-950' : 'bg-white text-neutral-600'}`}
                >
                  <Brush className="h-4 w-4" /> ブラシ
                </button>
                <button
                  type="button"
                  onClick={() => setIsErasing(true)}
                  aria-pressed={isErasing}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-medium ${isErasing ? 'bg-cyan-300 text-neutral-950' : 'bg-white text-neutral-600'}`}
                >
                  <Eraser className="h-4 w-4" /> 消しゴム
                </button>
              </div>
              <label className="block text-xs text-neutral-600">
                ブラシサイズ {brushSize}px
                <input
                  className="mt-1 w-full"
                  type="range"
                  min="8"
                  max="96"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="範囲指定を元に戻す"
                  disabled={strokes.length === 0}
                  onClick={() => setStrokes((current) => {
                    const last = current[current.length - 1];
                    if (last) setRedoStrokes((redo) => [...redo, last]);
                    return current.slice(0, -1);
                  })}
                  className="rounded-lg bg-white p-2 text-neutral-600 disabled:opacity-40"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="範囲指定をやり直す"
                  disabled={redoStrokes.length === 0}
                  onClick={() => setRedoStrokes((current) => {
                    const last = current[current.length - 1];
                    if (last) setStrokes((drawn) => [...drawn, last]);
                    return current.slice(0, -1);
                  })}
                  className="rounded-lg bg-white p-2 text-neutral-600 disabled:opacity-40"
                >
                  <Redo2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => { setStrokes([]); setRedoStrokes([]); }}
                  className="ml-auto flex items-center gap-1 rounded-lg bg-white px-2 py-2 text-xs text-red-600"
                >
                  <Trash2 className="h-4 w-4" /> クリア
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Edit options */}
        <div className="flex-1">
          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-2 mb-6">
            {editModes.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id as EditMode)}
                className={`
                  flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all
                  ${mode === m.id
                    ? 'border-cyan-300 bg-cyan-300/15'
                    : 'border-neutral-200 hover:border-neutral-300'
                  }
                `}
              >
                <div className={`
                  w-10 h-10 rounded-lg flex items-center justify-center
                  ${mode === m.id ? 'bg-cyan-300 text-white' : 'bg-neutral-100 text-neutral-500'}
                `}>
                  <m.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium text-sm text-neutral-800">{m.label}</p>
                  <p className="text-xs text-neutral-500">{m.description}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Mode-specific inputs */}
          {(mode === 'prompt' || mode === 'inpaint' || mode === 'colorize' || mode === 'variations') && (
            <div className="mb-6">
              <Textarea
                label={
                  mode === 'prompt' || mode === 'inpaint' ? '編集プロンプト' :
                  mode === 'colorize' ? '希望の色' :
                  'バリエーションの方向性'
                }
                placeholder={
                  mode === 'inpaint' ? '例: 選択した服を虎柄に変更して' :
                  mode === 'prompt' ? '例: 背景を青空に変更して' :
                  mode === 'colorize' ? '例: 赤、青、緑の3色' :
                  '例: よりカジュアルに'
                }
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
              />
            </div>
          )}

          {mode === 'upscale' && (
            <div className="mb-6 p-4 bg-neutral-50 rounded-xl">
              <p className="text-sm text-neutral-600 mb-2">
                アップスケール設定
              </p>
              <div className="flex gap-3">
                <button className="flex-1 py-2 px-4 bg-white border-2 border-primary-500 rounded-lg text-sm font-medium text-primary-700">
                  2x (2048px)
                </button>
                <button className="flex-1 py-2 px-4 bg-white border border-neutral-200 rounded-lg text-sm font-medium text-neutral-600 hover:border-neutral-300">
                  4x (4096px)
                </button>
              </div>
            </div>
          )}

          {mode === 'remove-bg' && (
            <div className="mb-6 p-4 bg-neutral-50 rounded-xl">
              <p className="text-sm text-neutral-600">
                AIが自動で背景を検出し、被写体のみを残します。
                処理後は透明背景のPNG形式で出力されます。
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>
              キャンセル
            </Button>
            <Button
              onClick={handleSubmit}
              isLoading={isProcessing}
            >
              {mode === 'remove-bg' ? '背景を削除' :
               mode === 'upscale' ? 'アップスケール' :
               mode === 'colorize' ? '色変更を作成' :
               mode === 'variations' ? 'バリエーションを生成' :
               mode === 'inpaint' ? '部分編集を実行' :
               '編集を適用'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
