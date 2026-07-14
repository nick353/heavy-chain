import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, Move, RefreshCw, RotateCw } from 'lucide-react';

export type PrintArtworkTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export const defaultPrintArtworkTransform: PrintArtworkTransform = {
  x: 0.5,
  y: 0.48,
  width: 0.34,
  height: 0.24,
  rotation: -6,
};

type PrintingImageComposerProps = {
  garmentImageUrl: string | null;
  garmentMaskUrl: string | null;
  printImageUrl: string | null;
  garmentCategory: string;
  printMode: 'スポット' | '全体';
  printLabel: string;
  transform: PrintArtworkTransform;
  onTransformChange: (next: PrintArtworkTransform) => void;
  onResetTransform: () => void;
  isProcessing?: boolean;
  processingLabel?: string;
};

type InteractionMode = 'move' | 'resize' | 'rotate';

type ActiveInteraction = {
  mode: InteractionMode;
  pointerId: number;
  startX: number;
  startY: number;
  start: PrintArtworkTransform;
  centerX: number;
  centerY: number;
  startAngle: number;
  resizeVector: { x: number; y: number };
  startProjection: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeRotation = (rotation: number) => {
  let next = rotation % 360;
  if (next > 180) next -= 360;
  if (next < -180) next += 360;
  return next;
};

const normalizeAngleDelta = (delta: number) => {
  let next = delta % 360;
  if (next > 180) next -= 360;
  if (next < -180) next += 360;
  return next;
};

const escapeSvgText = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const encodeSvgDataUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const buildGarmentSilhouetteMaskDataUrl = (garmentCategory: string) => {
  const category = garmentCategory.toLowerCase();
  const isOuter = /ジャケット|ブルゾン|アウター|コート/.test(garmentCategory);
  const isHoodie = /フーディ|パーカー|hood/i.test(category);
  const isTee = /tシャツ|tee|トップス|シャツ/i.test(category) && !isOuter && !isHoodie;

  const bodyPath = isOuter
    ? 'M246 142c42-44 170-44 212 0l42 74 52 26v384c0 58-48 104-106 104H258c-58 0-106-46-106-104V242l52-26z'
    : isHoodie
      ? 'M238 152c36-48 168-48 204 0l44 70 46 24v378c0 58-46 104-104 104H252c-58 0-104-46-104-104V246l46-24z'
      : isTee
        ? 'M234 174l60-44h112l60 44 52 88-50 36-28-44v310H260V254l-28 44-50-36 52-88z'
        : 'M234 164l56-40h120l56 40 54 86-48 34-28-42v322H256V242l-28 42-48-34 54-86z';

  return encodeSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">
      <rect width="900" height="900" fill="black" fill-opacity="0"/>
      <path d="${bodyPath}" fill="white"/>
      <path d="M350 160c24-28 76-28 100 0l-18 52h-64l-18-52z" fill="white" opacity="0.96"/>
      <path d="M316 316c46-28 222-28 268 0v12H316z" fill="white" opacity="0.18"/>
    </svg>
  `);
};

export const describePrintPlacement = (transform: PrintArtworkTransform) => {
  const x = transform.x;
  const y = transform.y;
  if (y < 0.34) return x < 0.45 ? '左胸上' : x > 0.55 ? '右胸上' : '胸上';
  if (y > 0.66) return '裾下';
  if (x < 0.35) return '左寄せ';
  if (x > 0.65) return '右寄せ';
  return '胸中央';
};

export const describePrintScale = (transform: PrintArtworkTransform) => {
  return Math.round(clamp(Math.max(transform.width, transform.height) * 120, 20, 90));
};

const getTransformAnchor = (transform: PrintArtworkTransform) => {
  return {
    x: transform.x * 100,
    y: transform.y * 100,
    width: transform.width * 100,
    height: transform.height * 100,
  };
};

export const buildPrintingImagePreviewDataUrl = ({
  garmentImageUrl,
  garmentMaskUrl,
  printImageUrl,
  garmentCategory,
  printMode,
  printLabel,
  transform,
}: {
  garmentImageUrl: string | null;
  garmentMaskUrl: string | null;
  printImageUrl: string | null;
  garmentCategory: string;
  printMode: 'スポット' | '全体';
  printLabel: string;
  transform: PrintArtworkTransform;
}) => {
  const maskUrl = garmentMaskUrl || buildGarmentSilhouetteMaskDataUrl(garmentCategory);
  const anchor = getTransformAnchor(transform);
  const printOpacity = printMode === '全体' ? 0.88 : 0.96;
  const printImageMarkup = printImageUrl
    ? `<image href="${escapeSvgText(printImageUrl)}" x="${anchor.x - anchor.width / 2}" y="${anchor.y - anchor.height / 2}" width="${anchor.width}" height="${anchor.height}" preserveAspectRatio="xMidYMid meet" opacity="${printOpacity}"/>`
    : `<rect x="${anchor.x - anchor.width / 2}" y="${anchor.y - anchor.height / 2}" width="${anchor.width}" height="${anchor.height}" rx="18" fill="#65d3cf" opacity=".75"/>`;
  const garmentMarkup = garmentImageUrl
    ? `<image href="${escapeSvgText(garmentImageUrl)}" x="156" y="106" width="588" height="618" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect x="156" y="106" width="588" height="618" rx="36" fill="#171f22" stroke="#2b3a3e" stroke-width="3"/>`;

  return encodeSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
      <defs>
        <mask id="garment-mask">
          <rect width="1200" height="900" fill="black"/>
          <image href="${escapeSvgText(maskUrl)}" x="156" y="106" width="588" height="618" preserveAspectRatio="xMidYMid meet"/>
        </mask>
        <radialGradient id="bgGlow" cx="50%" cy="28%" r="72%">
          <stop offset="0%" stop-color="#0f5f5d" stop-opacity="0.22"/>
          <stop offset="55%" stop-color="#0a1113" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#050708" stop-opacity="0.02"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="900" fill="#070b0d"/>
      <rect x="56" y="56" width="1088" height="788" rx="34" fill="#0f1517" stroke="#233033" stroke-width="3"/>
      <rect x="72" y="72" width="1056" height="756" rx="30" fill="url(#bgGlow)"/>
      <rect x="88" y="88" width="586" height="724" rx="30" fill="#11181b" stroke="#263337" stroke-width="2"/>
      <rect x="708" y="88" width="304" height="724" rx="30" fill="#12181b" stroke="#263337" stroke-width="2"/>
      <text x="124" y="136" fill="#65d3cf" font-family="Arial, sans-serif" font-size="24" font-weight="800">PRINTING IMAGE</text>
      <text x="124" y="180" fill="#e5e7eb" font-family="Arial, sans-serif" font-size="36" font-weight="800">Canva-style mockup</text>
      <text x="124" y="216" fill="#94a3b8" font-family="Arial, sans-serif" font-size="18">Drag / resize / rotate directly on the canvas</text>
      <g mask="url(#garment-mask)">
        ${printImageMarkup}
      </g>
      ${garmentMarkup}
      <rect x="156" y="106" width="588" height="618" rx="36" fill="none" stroke="#2c3b3f" stroke-width="2"/>
      <rect x="770" y="148" width="184" height="38" rx="19" fill="#65d3cf" opacity="0.18"/>
      <text x="862" y="174" text-anchor="middle" fill="#9fe7e2" font-family="Arial, sans-serif" font-size="17" font-weight="700">${escapeSvgText(printMode)}</text>
      <text x="760" y="260" fill="#65d3cf" font-family="Arial, sans-serif" font-size="22" font-weight="800">Artwork</text>
      <text x="760" y="304" fill="#e5e7eb" font-family="Arial, sans-serif" font-size="28" font-weight="800">${escapeSvgText(printLabel)}</text>
      <text x="760" y="360" fill="#94a3b8" font-family="Arial, sans-serif" font-size="18">garment: ${escapeSvgText(garmentCategory)}</text>
      <text x="760" y="398" fill="#94a3b8" font-family="Arial, sans-serif" font-size="18">position: ${escapeSvgText(describePrintPlacement(transform))}</text>
      <text x="760" y="436" fill="#94a3b8" font-family="Arial, sans-serif" font-size="18">scale: ${describePrintScale(transform)}%</text>
      <text x="760" y="474" fill="#94a3b8" font-family="Arial, sans-serif" font-size="18">rotation: ${Math.round(transform.rotation)}°</text>
      <text x="760" y="556" fill="#e5e7eb" font-family="Arial, sans-serif" font-size="16" font-weight="700">Result</text>
      <text x="760" y="590" fill="#94a3b8" font-family="Arial, sans-serif" font-size="16">Clipped to the garment silhouette</text>
      <text x="124" y="790" fill="#64748b" font-family="Arial, sans-serif" font-size="16">Heavy Chain / printing-image / direct canvas manipulation</text>
    </svg>
  `);
};

export function PrintingImageComposer({
  garmentImageUrl,
  garmentMaskUrl,
  printImageUrl,
  garmentCategory,
  printMode,
  printLabel,
  transform,
  onTransformChange,
  onResetTransform,
  isProcessing = false,
  processingLabel = '生成中...',
}: PrintingImageComposerProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<ActiveInteraction | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingTransformRef = useRef<PrintArtworkTransform | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode | null>(null);

  const maskUrl = garmentMaskUrl || buildGarmentSilhouetteMaskDataUrl(garmentCategory);
  const placementLabel = useMemo(() => describePrintPlacement(transform), [transform]);
  const scaleLabel = useMemo(() => describePrintScale(transform), [transform]);
  const printOpacity = printMode === '全体' ? 0.88 : 0.96;

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const scheduleTransform = useCallback((next: PrintArtworkTransform) => {
    pendingTransformRef.current = next;
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      if (!pendingTransformRef.current) return;
      onTransformChange(pendingTransformRef.current);
      pendingTransformRef.current = null;
    });
  }, [onTransformChange]);

  const endInteraction = useCallback(() => {
    interactionRef.current = null;
    setInteractionMode(null);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      const preview = previewRef.current;
      if (!interaction || !preview || event.pointerId !== interaction.pointerId) return;

      const rect = preview.getBoundingClientRect();
      const pointerX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const pointerY = clamp((event.clientY - rect.top) / rect.height, 0, 1);

      if (interaction.mode === 'move') {
        const dx = pointerX - interaction.startX;
        const dy = pointerY - interaction.startY;
        scheduleTransform({
          ...interaction.start,
          x: clamp(interaction.start.x + dx, 0.16, 0.84),
          y: clamp(interaction.start.y + dy, 0.12, 0.88),
        });
        return;
      }

      if (interaction.mode === 'resize') {
        const currentProjection = Math.max(
          0.0001,
          (pointerX - interaction.centerX) * interaction.resizeVector.x + (pointerY - interaction.centerY) * interaction.resizeVector.y,
        );
        const scale = clamp(currentProjection / interaction.startProjection, 0.45, 2.25);
        scheduleTransform({
          ...interaction.start,
          width: clamp(interaction.start.width * scale, 0.16, 0.78),
          height: clamp(interaction.start.height * scale, 0.12, 0.56),
        });
        return;
      }

      const angle = Math.atan2(pointerY - interaction.centerY, pointerX - interaction.centerX);
      const delta = normalizeAngleDelta(((angle - interaction.startAngle) * 180) / Math.PI);
      scheduleTransform({
        ...interaction.start,
        rotation: normalizeRotation(interaction.start.rotation + delta),
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (interactionRef.current && event.pointerId === interactionRef.current.pointerId) {
        endInteraction();
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [scheduleTransform]);

  const startInteraction = (mode: InteractionMode) => (event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>) => {
    if (!printImageUrl || isProcessing) return;
    event.preventDefault();
    event.stopPropagation();

    const preview = previewRef.current;
    if (!preview) return;
    const rect = preview.getBoundingClientRect();
    const pointerX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const pointerY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const centerX = transform.x;
    const centerY = transform.y;
    const resizeMagnitude = Math.max(0.0001, Math.hypot(pointerX - centerX, pointerY - centerY));
    const startAngle = Math.atan2(pointerY - centerY, pointerX - centerX);
    const resizeVector = {
      x: (pointerX - centerX) / resizeMagnitude,
      y: (pointerY - centerY) / resizeMagnitude,
    };

    interactionRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: pointerX,
      startY: pointerY,
      start: transform,
      centerX,
      centerY,
      startAngle,
      resizeVector,
      startProjection: resizeMagnitude,
    };
    setInteractionMode(mode);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const boxStyle = {
    left: `${transform.x * 100}%`,
    top: `${transform.y * 100}%`,
    width: `${transform.width * 100}%`,
    height: `${transform.height * 100}%`,
    transform: `translate(-50%, -50%) rotate(${transform.rotation}deg)`,
  } as const;

  return (
    <section className="min-w-0 overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,13,0.98),rgba(10,14,16,0.96))] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">Canva-style canvas</p>
          <h3 className="mt-1 text-sm font-semibold text-white">印刷位置を直接調整</h3>
        </div>
        <button
          type="button"
          onClick={onResetTransform}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/40 hover:text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          リセット
        </button>
      </div>

      <div className="grid min-w-0 gap-4 p-4">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.16em] text-neutral-400">
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-cyan-100">ドラッグで移動</span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">角ハンドルで拡大縮小</span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">上ハンドルで回転</span>
          </div>

          <div
            ref={previewRef}
            className="relative min-h-[700px] touch-none overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_50%_28%,rgba(101,211,207,0.16),transparent_34%),linear-gradient(180deg,#0b1012,#050708)]"
          >
            <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(148,163,184,0.06)_25%,transparent_25%),linear-gradient(-45deg,rgba(148,163,184,0.06)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(148,163,184,0.06)_75%),linear-gradient(-45deg,transparent_75%,rgba(148,163,184,0.06)_75%)] bg-[length:28px_28px] bg-[position:0_0,0_14px,14px_-14px,-14px_0] opacity-30" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_52%,transparent_0,rgba(0,0,0,0.12)_48%,rgba(0,0,0,0.5)_100%)]" />

            {garmentImageUrl ? (
              <div className="absolute inset-0 flex items-center justify-center p-10">
                <img
                  src={garmentImageUrl}
                  alt="ガーメントプレビュー"
                  className="max-h-[88%] max-w-[88%] select-none object-contain drop-shadow-[0_22px_44px_rgba(0,0,0,0.5)]"
                  draggable={false}
                />
              </div>
            ) : (
              <div className="absolute inset-0 grid place-items-center px-8 text-center">
                <div className="max-w-sm rounded-3xl border border-white/10 bg-white/[0.03] px-6 py-8">
                  <p className="text-sm font-semibold text-white">参考画像をアップロードしてください</p>
                  <p className="mt-2 text-xs leading-5 text-neutral-400">ここに garment が入ると、Canva のように直接動かせるキャンバスが表示されます。</p>
                </div>
              </div>
            )}

            {printImageUrl && (
              <div
                className={`absolute inset-0 ${interactionMode === 'move' ? 'cursor-grabbing' : 'cursor-grab'}`}
                style={{
                  WebkitMaskImage: `url("${maskUrl}")`,
                  maskImage: `url("${maskUrl}")`,
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                }}
              >
                <div
                  className="absolute left-0 top-0"
                  style={boxStyle}
                >
                  <img
                    src={printImageUrl}
                    alt={printLabel}
                    className="pointer-events-none h-full w-full select-none object-contain"
                    draggable={false}
                    style={{ opacity: printOpacity, filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.34))' }}
                  />
                </div>
              </div>
            )}

            {printImageUrl && (
              <div
                className="absolute left-0 top-0"
                style={boxStyle}
              >
                <div
                  onPointerDown={startInteraction('move')}
                  className={`absolute inset-0 rounded-3xl border border-cyan-300/55 bg-cyan-300/5 shadow-[0_0_0_1px_rgba(101,211,207,0.14)] ${interactionMode === 'move' ? 'ring-2 ring-cyan-300/30' : ''}`}
                >
                  <div className="absolute inset-0 rounded-3xl border border-white/15" />
                  <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[130%]">
                    <button
                      type="button"
                      onPointerDown={startInteraction('rotate')}
                      className="grid h-9 w-9 place-items-center rounded-full border border-cyan-200/40 bg-[#081618] text-cyan-100 shadow-lg transition hover:border-cyan-200/70"
                      aria-label="回転"
                    >
                      <RotateCw className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="absolute -left-2.5 -top-2.5">
                    <button
                      type="button"
                      onPointerDown={startInteraction('resize')}
                      className="grid h-5 w-5 place-items-center rounded-full border border-cyan-200/60 bg-cyan-200 text-[#041214] shadow-md"
                      aria-label="左上でリサイズ"
                    >
                      <Maximize2 className="h-2.5 w-2.5 -rotate-90" />
                    </button>
                  </div>
                  <div className="absolute -right-2.5 -top-2.5">
                    <button
                      type="button"
                      onPointerDown={startInteraction('resize')}
                      className="grid h-5 w-5 place-items-center rounded-full border border-cyan-200/60 bg-cyan-200 text-[#041214] shadow-md"
                      aria-label="右上でリサイズ"
                    >
                      <Maximize2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                  <div className="absolute -left-2.5 -bottom-2.5">
                    <button
                      type="button"
                      onPointerDown={startInteraction('resize')}
                      className="grid h-5 w-5 place-items-center rounded-full border border-cyan-200/60 bg-cyan-200 text-[#041214] shadow-md"
                      aria-label="左下でリサイズ"
                    >
                      <Maximize2 className="h-2.5 w-2.5 rotate-180" />
                    </button>
                  </div>
                  <div className="absolute -right-2.5 -bottom-2.5">
                    <button
                      type="button"
                      onPointerDown={startInteraction('resize')}
                      className="grid h-5 w-5 place-items-center rounded-full border border-cyan-200/60 bg-cyan-200 text-[#041214] shadow-md"
                      aria-label="右下でリサイズ"
                    >
                      <Maximize2 className="h-2.5 w-2.5 rotate-90" />
                    </button>
                  </div>
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    <div className="rounded-full border border-white/15 bg-[#050708]/45 px-2.5 py-1 text-[10px] font-semibold tracking-[0.2em] text-cyan-100/80">
                      MOVE
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isProcessing && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-950/60 backdrop-blur-sm">
                <div className="rounded-[24px] border border-cyan-300/20 bg-[#071114]/92 px-5 py-4 text-center shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
                  <RefreshCw className="mx-auto h-5 w-5 animate-spin text-cyan-100" />
                  <p className="mt-2 text-sm font-semibold text-white">{processingLabel}</p>
                  <p className="mt-1 text-xs text-neutral-400">完了まで操作を止めています</p>
                </div>
              </div>
            )}

            <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] font-semibold text-neutral-200">位置 {placementLabel}</span>
                <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] font-semibold text-neutral-200">サイズ {scaleLabel}%</span>
                <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] font-semibold text-neutral-200">回転 {Math.round(transform.rotation)}°</span>
              </div>
              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold text-cyan-100/90">
                {printMode}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-2 rounded-[26px] border border-white/10 bg-white/[0.025] p-4 text-sm text-neutral-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">Selection</span>
            <Move className="h-4 w-4 text-cyan-200/80" />
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="text-xs font-semibold text-neutral-400">Asset</p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{printLabel}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="text-xs font-semibold text-neutral-400">Garment</p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{garmentCategory}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="text-xs font-semibold text-neutral-400">Mask</p>
            <p className="mt-1 text-sm font-semibold text-white">Overflow outside the silhouette stays hidden</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="text-xs font-semibold text-neutral-400">Mode</p>
            <p className="mt-1 text-sm font-semibold text-white">{printMode === 'スポット' ? 'スポットプリント' : '全面プリント'}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="text-xs font-semibold text-neutral-400">Movement</p>
            <p className="mt-1 text-sm leading-6 text-neutral-300">ドラッグで移動、角でサイズ変更、上ハンドルで回転。UI はスライダーよりもキャンバス操作を優先しています。</p>
          </div>
        </div>
      </div>
    </section>
  );
}
