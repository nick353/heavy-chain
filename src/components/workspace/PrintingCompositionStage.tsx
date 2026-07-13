import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { Move3D, RotateCw, Square } from 'lucide-react';

export type PrintingTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
};

export type PrintingLayer = {
  id: string;
  label: string;
  displayUrl: string;
  transform: PrintingTransform;
  cutoutState: 'idle' | 'processing' | 'done' | 'error';
};

type StageSize = { width: number; height: number };
type DragMode = 'move' | 'resize' | 'rotate';

type DragSession = {
  id: string;
  mode: DragMode;
  pointerId: number;
  startTransform: PrintingTransform;
  startDistance: number;
  startAngle: number;
};

const defaultStageSize: StageSize = { width: 0, height: 0 };
const minScale = 0.24;
const maxScale = 2.3;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getAngleDegrees(centerX: number, centerY: number, clientX: number, clientY: number) {
  return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
}

function getDistance(centerX: number, centerY: number, clientX: number, clientY: number) {
  return Math.hypot(clientX - centerX, clientY - centerY);
}

function useResizeObserverSize<T extends HTMLElement>(ref: RefObject<T | null>) {
  const [size, setSize] = useState<StageSize>(defaultStageSize);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function designBaseWidth(size: StageSize) {
  return clamp(size.width * 0.38, 140, 320);
}

function garmentWidth(size: StageSize) {
  return clamp(size.width * 0.92, 300, 680);
}

function garmentCenterY(size: StageSize) {
  return size.height * 0.52;
}

function designBoxSize(size: StageSize, scale: number) {
  const width = designBaseWidth(size) * scale;
  return { width, height: width };
}

function getLayerCenterPx(size: StageSize, transform: PrintingTransform) {
  return {
    x: (transform.x / 100) * size.width,
    y: (transform.y / 100) * size.height,
  };
}

function getFrameMaskStyle(maskUrl: string | null, size: StageSize): CSSProperties {
  return {
    WebkitMaskImage: maskUrl ? `url(${maskUrl})` : undefined,
    maskImage: maskUrl ? `url(${maskUrl})` : undefined,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskSize: `${garmentWidth(size)}px auto`,
    maskSize: `${garmentWidth(size)}px auto`,
  };
}

export function PrintingCompositionStage({
  garmentUrl,
  garmentMaskUrl,
  layers,
  selectedLayerId,
  onSelectLayer,
  onCommitLayer,
}: {
  garmentUrl: string | null;
  garmentMaskUrl: string | null;
  layers: PrintingLayer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string) => void;
  onCommitLayer: (payload: { id: string; transform: PrintingTransform }) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useResizeObserverSize(stageRef);
  const [draftLayers, setDraftLayers] = useState<PrintingLayer[]>(layers);
  const draftLayersRef = useRef(draftLayers);
  const dragRef = useRef<DragSession | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    draftLayersRef.current = draftLayers;
  }, [draftLayers]);

  useEffect(() => {
    setDraftLayers(layers);
  }, [layers]);

  const selectedLayer = useMemo(
    () => draftLayers.find((layer) => layer.id === selectedLayerId) || null,
    [draftLayers, selectedLayerId],
  );

  const finishDrag = () => {
    const session = dragRef.current;
    dragRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (!session) return;
    const current = draftLayersRef.current.find((layer) => layer.id === session.id);
    if (current) {
      onCommitLayer({ id: current.id, transform: current.transform });
    }
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const session = dragRef.current;
      if (!session || !stageRef.current) return;
      event.preventDefault();
      const rect = stageRef.current.getBoundingClientRect();
      const center = getLayerCenterPx(size, session.startTransform);
      const nextLayers = draftLayersRef.current.map((layer) => {
        if (layer.id !== session.id) return layer;
        if (session.mode === 'move') {
          const nextX = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
          const nextY = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);
          return { ...layer, transform: { ...layer.transform, x: nextX, y: nextY } };
        }
        if (session.mode === 'resize') {
          const currentDistance = Math.max(20, getDistance(center.x, center.y, event.clientX, event.clientY));
          const ratio = currentDistance / Math.max(20, session.startDistance);
          const nextScale = clamp(session.startTransform.scale * ratio, minScale, maxScale);
          return { ...layer, transform: { ...layer.transform, scale: nextScale } };
        }
        const nextAngle = getAngleDegrees(center.x, center.y, event.clientX, event.clientY);
        const delta = nextAngle - session.startAngle;
        return { ...layer, transform: { ...layer.transform, rotation: clamp(session.startTransform.rotation + delta, -72, 72) } };
      });
      draftLayersRef.current = nextLayers;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setDraftLayers(draftLayersRef.current);
        });
      }
    };

    const onUp = () => {
      if (!dragRef.current) return;
      finishDrag();
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [size]);

  const beginDrag = (layer: PrintingLayer, mode: DragMode, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectLayer(layer.id);
    const center = getLayerCenterPx(size, layer.transform);
    dragRef.current = {
      id: layer.id,
      mode,
      pointerId: event.pointerId,
      startTransform: layer.transform,
      startDistance: getDistance(center.x, center.y, event.clientX, event.clientY),
      startAngle: getAngleDegrees(center.x, center.y, event.clientX, event.clientY),
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const garmentStyle: CSSProperties = {
    width: `${garmentWidth(size)}px`,
    left: '50%',
    top: `${garmentCenterY(size)}px`,
    transform: 'translate(-50%, -50%)',
  };

  return (
    <div
      ref={stageRef}
      className="relative aspect-[4/5] overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(7,10,11,1),rgba(17,23,25,1))]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_55%)]" />
      <div className="absolute left-1/2 top-[52%] h-[82%] w-[92%] -translate-x-1/2 -translate-y-1/2 rounded-[34px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_55%)] blur-[1px]" />

      {garmentUrl && (
        <img
          src={garmentUrl}
          alt="参考画像"
          className="pointer-events-none absolute left-1/2 top-[54%] z-0 max-w-none select-none"
          style={{
            ...garmentStyle,
            mixBlendMode: 'normal',
            opacity: 0.94,
            filter: 'brightness(1.08) contrast(1.04) saturate(0.96) drop-shadow(0 10px 30px rgba(0,0,0,0.28))',
          }}
          draggable={false}
        />
      )}

      {garmentMaskUrl ? (
        <div className="absolute inset-0 z-10" style={getFrameMaskStyle(garmentMaskUrl, size)}>
          <div className="absolute inset-[4.5%] rounded-[32px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.98),rgba(244,246,248,0.96) 58%,rgba(232,236,240,0.9))] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)]" />
          {draftLayers
            .filter((layer) => layer.id !== 'print-garment')
            .map((layer) => {
              const center = getLayerCenterPx(size, layer.transform);
              const box = designBoxSize(size, layer.transform.scale);
              const selected = layer.id === selectedLayerId;
              const transform = `translate(-50%, -50%) rotate(${layer.transform.rotation}deg)`;
              return (
                <button
                  key={layer.id}
                  type="button"
                  onPointerDown={(event) => beginDrag(layer, 'move', event)}
                  onClick={() => onSelectLayer(layer.id)}
                  className={`absolute cursor-grab select-none rounded-[22px] border transition-[box-shadow,border-color,transform] duration-150 active:cursor-grabbing ${selected ? 'border-[#6d8784] shadow-[0_0_0_1px_rgba(109,135,132,0.35),0_0_26px_rgba(109,135,132,0.1)]' : 'border-white/15 shadow-[0_10px_30px_rgba(0,0,0,0.2)]'}`}
                  style={{
                    left: `${center.x}px`,
                    top: `${center.y}px`,
                    width: `${box.width}px`,
                    height: `${box.height}px`,
                    opacity: layer.transform.opacity,
                    transform,
                    willChange: 'transform',
                    touchAction: 'none',
                    background: selected ? 'rgba(7,10,11,0.12)' : 'transparent',
                  }}
                  >
                  <img
                    src={layer.displayUrl}
                    alt={layer.label}
                    className="h-full w-full rounded-[22px] object-contain pointer-events-none select-none"
                    style={{ mixBlendMode: 'normal', opacity: 0.98 }}
                    draggable={false}
                  />
                  {selected && (
                    <>
                      <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full rounded-full border border-[#6d8784]/45 bg-[#0f1718]/90 px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em] text-[#d9e2e0] backdrop-blur-sm">
                        移動中
                      </div>
                      <span className="absolute -left-2 -top-2 h-4 w-4 rounded-full border border-[#6d8784] bg-[#0f1718] shadow-[0_0_0_4px_rgba(109,135,132,0.08)]" />
                      <span className="absolute -right-2 -top-2 h-4 w-4 rounded-full border border-[#6d8784] bg-[#0f1718] shadow-[0_0_0_4px_rgba(109,135,132,0.08)]" />
                      <span className="absolute -left-2 -bottom-2 h-4 w-4 rounded-full border border-[#6d8784] bg-[#0f1718] shadow-[0_0_0_4px_rgba(109,135,132,0.08)]" />
                      <span className="absolute -right-2 -bottom-2 h-4 w-4 rounded-full border border-[#6d8784] bg-[#0f1718] shadow-[0_0_0_4px_rgba(109,135,132,0.08)]" />
                      <div
                        role="presentation"
                        onPointerDown={(event) => beginDrag(layer, 'resize', event)}
                        className="absolute -right-5 -bottom-5 grid h-8 w-8 place-items-center rounded-full border border-[#6d8784]/40 bg-[#0d1314]/90 text-[#d9e2e0] shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-transform hover:scale-105"
                        style={{ touchAction: 'none' }}
                        title="サイズ変更"
                      >
                        <Square className="h-3.5 w-3.5" />
                      </div>
                      <div
                        role="presentation"
                        onPointerDown={(event) => beginDrag(layer, 'rotate', event)}
                        className="absolute left-1/2 top-[-3.2rem] grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border border-[#6d8784]/40 bg-[#0d1314]/90 text-[#d9e2e0] shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-transform hover:scale-105"
                        style={{ touchAction: 'none' }}
                        title="回転"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </div>
                    </>
                  )}
                </button>
              );
            })}
        </div>
      ) : null}

      <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] font-medium tracking-[0.22em] text-neutral-300 backdrop-blur-md">
        Canva-style direct edit
      </div>
      <div className="pointer-events-none absolute bottom-4 right-4 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] leading-relaxed text-neutral-300 backdrop-blur-md">
        <div className="flex items-center gap-2"><Move3D className="h-3.5 w-3.5 text-[#a1b9b5]" /> ドラッグ</div>
        <div className="flex items-center gap-2"><Square className="h-3.5 w-3.5 text-[#a1b9b5]" /> 拡大</div>
        <div className="flex items-center gap-2"><RotateCw className="h-3.5 w-3.5 text-[#a1b9b5]" /> 回転</div>
      </div>

      {!garmentMaskUrl && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-white/10 bg-black/40 px-5 py-4 text-center text-white/70 backdrop-blur">
            <p className="text-sm">参考画像をアップロードしてください</p>
          </div>
        </div>
      )}

      {selectedLayer && (
        <div className="absolute left-4 top-4 hidden md:block rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/70 backdrop-blur-md">
          <div className="font-semibold text-white">{selectedLayer.label}</div>
          <div className="mt-1 text-neutral-400">
            {selectedLayer.cutoutState === 'processing'
              ? '切り抜き処理中'
              : selectedLayer.cutoutState === 'done'
                ? '切り抜き済み'
                : selectedLayer.cutoutState === 'error'
                  ? '切り抜き失敗'
                  : 'そのまま使用'}
          </div>
        </div>
      )}
    </div>
  );
}
