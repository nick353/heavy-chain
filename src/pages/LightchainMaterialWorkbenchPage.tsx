import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  FolderHeart,
  Heart,
  Layers3,
  Laptop,
  Loader2,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import { Button, ImageCompare } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { ImageSelector, type SelectedImage } from '../components/ImageSelector';
import { PrintingCompositionStage } from '../components/workspace/PrintingCompositionStage';
import { PrintMaskCandidatePicker } from '../components/workspace/PrintMaskCandidatePicker';
import { PrintMaskEditor } from '../components/workspace/PrintMaskEditor';
import { PrintGarmentSelectionEditor } from '../components/workspace/PrintGarmentSelectionEditor';
import {
  armPrintDesignReturnIntent,
  bindPrintDesignReturnIntent,
  canCommitPrintDesignCutoutRequest,
  deferPrintDesignReturnIntent,
  isPendingPrintDesignLayerMaterialization,
  planPrintDesignInputUpdate,
  planPrintDesignCutoutReconciliation,
  preservePrintDesignLayerOrder,
  printDesignIdentity,
  prunePrintDesignIdentityMap,
  reorderPrintDesignLayers,
  resolvePrintDesignMaskEditorIndex,
  resolvePrintDesignReturnIntent,
  releasePrintDesignReturnIntent,
  resolvePrintPlacementSelection,
  selectPlacedPrintDesignLayers,
  selectFreshDuplicatePrintDesign,
  selectLatestProcessingPrintDesignLayerId,
  selectLatestReadyPrintDesignLayerId,
  type PrintDesignReturnIntent,
  type PrintDesignLayerOrderAction,
} from '../features/printing/selection/designLayerSelection';
import {
  acknowledgePrintDesignHandoff,
  createTrustedBlankGarmentSelection,
  isPrintDesignHandoffAlreadyImported,
  readPrintDesignHandoff,
} from '../features/printing/selection/printDesignHandoff';
import { PRINT_DESIGN_ASSET_PURPOSE } from '../features/printing/selection/printDesignAssetPurpose';
import {
  settleComposition,
  waitForDisplayableImage,
} from '../features/printing/history/progressivePrintGeneration';
import {
  listPrintResultFavoriteIds,
  savePrintResultFavorite,
} from '../features/printing/history/printResultFavorite';
import { useAuthStore } from '../stores/authStore';
import {
  buildDerivedPrintGarmentMaskCandidates,
  buildPrintGarmentCutoutDataUrl,
  buildEncodedManualPrintableSurface,
  buildPrintableSurfaceStageMaskDataUrl,
  buildPrintDesignCutoutDataUrl,
  buildPrintRequestSignature,
  buildPrintRequestSnapshot,
  renderExperimentalSurfaceComposition,
  renderPrintRequestComposition,
  isPrintGarmentClothModelConfigured,
  resolvePrintGarmentCutoutModel,
  suggestPrintableSurfaceDataUrl,
  type MaterialCutoutResult,
  type EncodedManualPrintableSurface,
  type PrintGarmentMaskCandidate,
  type PrintRequestSnapshot,
} from '../lib/workspaceMaterialReferences';
import {
  isOversizedManualPrintMask,
  groupPrintResultHistory,
  mergeDelayedSurfaceResult,
  mergePrintMaskCandidatesById,
  mergePrintResultHistory,
  removePrintResultRun,
  removePrintResultRuns,
  resolvePrintMaskCandidateId,
  selectPrintGarmentMaskCandidateValue,
  withManualPrintMaskResult,
  PRINT_CUTOUT_MAX_DATA_URL_BYTES,
  PRINT_RESULT_HISTORY_MAX_RUNS,
  type PrintGarmentMaskCandidateId,
} from '../lib/printMaskCandidateStrategy';
import {
  canCommitPrintableSurfaceEditorOperation,
  canCommitPrintableSuggestion,
  type PrintableSuggestionCommitToken,
} from '../features/printing/surface/printableSuggestionRequest';
import {
  canExplicitlyConfirmProcessedGarmentMask,
  DEFAULT_GARMENT_SEGMENTATION_TARGET,
  garmentSelectionModelStatus,
  isCurrentGarmentMaskEditorTarget,
  isGarmentMaskExplicitlyConfirmed,
  type GarmentSegmentationTarget,
  type GarmentSelectionSource,
} from '../features/printing/selection/garmentSegmentationPolicy';
import {
  canConfirmPlacementEdit,
  createPlacementEditBaseline,
  restorePlacementEditBaseline,
  type PlacementEditBaseline,
} from '../features/printing/selection/placementEditSession';

type WorkbenchMode = 'fabric' | 'printing';
type CutoutState = 'idle' | 'processing' | 'done' | 'error';
type Transform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
};

type AssetLayer = {
  id: string;
  label: string;
  originalUrl: string;
  displayUrl: string;
  transform: Transform;
  autoCutout: boolean;
  cutoutState: CutoutState;
  maskRevision: number;
};

type PrintMaskEditorTarget = {
  kind: 'garment' | 'design' | 'printable-area';
  capturedDesignLayerId?: string;
  title: string;
  description?: string;
  sourceUrl: string;
  maskUrl: string;
  result: MaterialCutoutResult;
  capturedCandidateId?: PrintGarmentMaskCandidateId;
  capturedGarmentMaskRevision?: number;
  capturedSourceHash?: `sha256:${string}`;
  capturedGarmentCutoutRequestId?: number;
};

type WorkbenchResult = {
  id: string;
  brandId: string;
  runId?: string;
  resultKind?: 'exact' | 'fabric' | 'surface';
  generatedAt?: number;
  title: string;
  note: string;
  imageUrl: string;
  outputSize?: { width: number; height: number };
};

type ProgressivePrintSurface = {
  status: 'rendering' | 'ready' | 'error';
  result: WorkbenchResult | null;
  error: string | null;
};

type ProgressivePrintRun = {
  runId: string;
  generatedAt: number;
  exact: ProgressivePrintSurface;
  fabric: ProgressivePrintSurface;
};

const preferredScrollBehavior = (): ScrollBehavior => (
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
);

function WorkbenchResultCard({
  result,
  onOpen,
  onFavorite,
  onDeleteRun,
  isFavorite = false,
}: {
  result: WorkbenchResult;
  onOpen: (result: WorkbenchResult) => void;
  onFavorite?: (result: WorkbenchResult) => void;
  onDeleteRun?: (result: WorkbenchResult) => void;
  isFavorite?: boolean;
}) {
  const surfaceBadge = result.resultKind === 'exact'
    ? { eyebrow: 'EXACT', label: '配置そのまま', className: 'border-cyan-200/35 bg-cyan-950/85 text-cyan-50' }
    : result.resultKind === 'fabric'
      ? { eyebrow: 'FABRIC', label: '布になじませる', className: 'border-fuchsia-200/35 bg-fuchsia-950/85 text-fuchsia-50' }
      : result.resultKind === 'surface'
        ? { eyebrow: 'SURFACE', label: '布面追従（試験）', className: 'border-amber-200/35 bg-amber-950/85 text-amber-50' }
        : null;
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
      <button
        type="button"
        onClick={() => onOpen(result)}
        className="relative block aspect-[4/5] w-full cursor-zoom-in bg-neutral-900 text-left transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-primary-400/60"
        aria-label={`${result.title} を拡大`}
      >
        <img
          src={result.imageUrl}
          alt={result.title}
          className="h-full w-full object-contain"
          draggable={false}
        />
        {surfaceBadge && (
          <span
            data-testid={`print-result-mode-${result.resultKind}`}
            className={`absolute left-3 top-3 rounded-xl border px-3 py-2 shadow-lg backdrop-blur-md ${surfaceBadge.className}`}
          >
            <span className="block text-[10px] font-bold tracking-[0.18em]">{surfaceBadge.eyebrow}</span>
            <span className="mt-0.5 block text-xs font-semibold">{surfaceBadge.label}</span>
          </span>
        )}
      </button>
      <div className="min-h-[9rem] space-y-2 p-4">
        <div>
          <p className="font-semibold text-white">{result.title}</p>
          <p className="mt-1 text-sm text-white/55">{result.note}</p>
          {result.outputSize && (
            <p className="mt-1 text-xs text-cyan-200">{result.outputSize.width} × {result.outputSize.height}px</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {onFavorite && (
            <button
              type="button"
              onClick={() => onFavorite(result)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-pink-300/40 hover:text-pink-100 focus:outline-none focus:ring-2 focus:ring-pink-300/40"
              aria-label={`${result.title} をお気に入りに追加`}
            >
              <Heart className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current text-pink-200' : ''}`} aria-hidden="true" />
              {isFavorite ? 'お気に入り追加済み' : 'お気に入りに追加'}
            </button>
          )}
          {onDeleteRun && result.runId && (
            <button
              type="button"
              onClick={() => onDeleteRun(result)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/70 transition hover:border-red-300/40 hover:text-red-100 focus:outline-none focus:ring-2 focus:ring-red-300/40"
              aria-label={`${result.title} を含む生成履歴を削除`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              この生成を削除
            </button>
          )}
          {result.outputSize && (
            <a
              href={result.imageUrl}
              download={`heavy-chain-${result.id}-${result.outputSize.width}x${result.outputSize.height}.png`}
              className="inline-flex rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-cyan-300/40 hover:text-cyan-100"
            >
              PNGをダウンロード
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressivePrintSurfaceCard({
  label,
  surface,
  onOpen,
  onFavorite,
  isFavorite,
}: {
  label: string;
  surface: ProgressivePrintSurface;
  onOpen: (result: WorkbenchResult) => void;
  onFavorite: (result: WorkbenchResult) => void;
  isFavorite?: boolean;
}) {
  if (surface.status === 'ready' && surface.result) {
    return <WorkbenchResultCard result={surface.result} onOpen={onOpen} onFavorite={onFavorite} isFavorite={isFavorite} />;
  }
  const failed = surface.status === 'error';
  return (
    <div
      data-testid={`progressive-print-${label}-card`}
      className={`overflow-hidden rounded-2xl border ${failed
        ? 'border-red-300/25 bg-red-950/25'
        : 'border-cyan-300/20 bg-[linear-gradient(145deg,rgba(8,47,73,0.9),rgba(30,41,59,0.88),rgba(88,28,135,0.65))]'}`}
      role="status"
      aria-live="polite"
      aria-busy={surface.status === 'rendering'}
    >
      <div className="flex aspect-[4/5] items-center justify-center">
        <div className="max-w-[15rem] px-5 text-center">
        {failed ? (
          <>
            <p className="text-sm font-semibold text-red-100">{label}の生成に失敗しました</p>
            <p className="mt-2 text-xs leading-relaxed text-red-100/65">{surface.error}</p>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-cyan-200 motion-reduce:animate-none" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-cyan-50">{label}を生成中…</p>
            <div className="mx-auto mt-3 h-1.5 w-28 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-cyan-300 to-violet-300 motion-reduce:animate-none" />
            </div>
          </>
        )}
        </div>
      </div>
      <div className="min-h-[9rem] border-t border-white/10 p-4">
        <p className={`font-semibold ${failed ? 'text-red-100' : 'text-white'}`}>{label}</p>
        <p className={`mt-1 text-sm ${failed ? 'text-red-100/65' : 'text-white/55'}`}>
          {failed ? '生成を完了できませんでした。' : '結果を準備しています。'}
        </p>
      </div>
    </div>
  );
}

const buildManualMaskSourceResult = (sourceUrl: string): Promise<MaterialCutoutResult> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    const width = Math.max(1, image.naturalWidth || image.width);
    const height = Math.max(1, image.naturalHeight || image.height);
    resolve({
      dataUrl: sourceUrl,
      bounds: { x: 0, y: 0, width, height },
      sourceSize: { width, height },
      outputSize: { width, height },
      dataUrlBytes: sourceUrl.length,
      storagePolicy: 'bounded-local-canvas-data-url-v1',
      engine: 'browser-canvas-geometric-mask-v1',
      hasTransparentPixels: false,
    });
  };
  image.onerror = () => reject(new Error('manual_mask_source_image_load_failed'));
  image.src = sourceUrl;
});

type PendingSurfaceJob = {
  id: number;
  snapshot: PrintRequestSnapshot;
  revision: number;
  signature: string;
  inputSignature: string;
  exactId: string;
  fabricId: string;
  runId: string;
  brandId: string;
  generatedAt: number;
};

const surfaceConformStatusMessage = (reason: string) => {
  const messages: Record<string, string> = {
    SOURCE_TOO_SMALL: '布面追従（試験）は元画像の解像度が不足しているため省略しました。',
    DESIGN_NOT_VISIBLE: '布面追従（試験）は、デザインと手動印刷面の重なりが小さいため省略しました。',
    SURFACE_TOO_SMALL: '布面追従（試験）は、手動印刷面が小さいため省略しました。',
    SURFACE_TOUCHES_FRAME: '布面追従（試験）は、印刷面が画像端に接しているため省略しました。',
    LUMINANCE_CLIPPING_EXCESS: '布面追従（試験）は、白飛びまたは黒つぶれが多いため省略しました。',
    HIGH_FREQUENCY_EXCESS: '布面追従（試験）は、細かなノイズが多いため省略しました。',
    SURFACE_CONFORMER_DEADLINE_EXCEEDED: '布面追従（試験）は10秒の処理上限を超えたため省略しました。',
    BOUNDED_SURFACE_CONFORMER_DIMENSION_INVALID: '布面追従（試験）は、高解像度用の範囲寸法が不正なため省略しました。',
    BOUNDED_SURFACE_CONFORMER_PIXEL_LIMIT_EXCEEDED: '布面追従（試験）は、入力が安全な画素上限を超えたため省略しました。',
    BOUNDED_SURFACE_CONFORMER_SOURCE_LENGTH_INVALID: '布面追従（試験）は、元画像データの長さが不正なため省略しました。',
    BOUNDED_SURFACE_CONFORMER_DESIGN_LENGTH_INVALID: '布面追従（試験）は、デザイン画像データの長さが不正なため省略しました。',
    BOUNDED_SURFACE_CONFORMER_GARMENT_LENGTH_INVALID: '布面追従（試験）は、服マスクデータの長さが不正なため省略しました。',
    BOUNDED_SURFACE_CONFORMER_CLIP_LENGTH_INVALID: '布面追従（試験）は、印刷面マスクデータの長さが不正なため省略しました。',
    BOUNDED_SURFACE_CONFORMER_ROI_TOO_LARGE: '布面追従（試験）は、高解像度の切り出し範囲が大きすぎるため省略しました。',
    BOUNDED_SURFACE_CONFORMER_DEADLINE_INVALID: '布面追従（試験）は、処理期限が不正なため省略しました。',
    BOUNDED_SURFACE_CONFORMER_DEADLINE_EXCEEDED: '布面追従（試験）は10秒の高解像度ROI処理上限を超えたため省略しました。',
    BOUNDED_SURFACE_CONFORMER_FRAME_CONTACT_REFERENCE_INVALID: '布面追従（試験）は、フレーム接触参照が不正なため省略しました。',
  };
  return messages[reason] ?? `布面追従（試験）を省略しました: ${reason}`;
};

const waitForCommittedPaint = () => new Promise<void>((resolve) => {
  let settled = false;
  let firstFrame = 0;
  let secondFrame = 0;
  const finish = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(fallbackTimer);
    if (firstFrame) window.cancelAnimationFrame(firstFrame);
    if (secondFrame) window.cancelAnimationFrame(secondFrame);
    resolve();
  };
  const fallbackTimer = window.setTimeout(finish, 250);
  firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(finish);
  });
});

const printableSuggestionStatusMessage = (reason: string) => {
  const messages: Record<string, string> = {
    EMPTY_GARMENT: '服の領域を確認できなかったため、手動指定を使ってください。',
    FRAME_CROPPED: '服が画像端で切れているため、安全な候補を作れませんでした。手動指定を使ってください。',
    MULTIPLE_COMPONENTS: '服以外の大きな領域が含まれるため、安全な候補を作れませんでした。手動指定を使ってください。',
    CENTERLINE_GAP: '前身頃の中央が連続していないため、手動指定を使ってください。',
    PROFILE_UNSTABLE: '服の形が複雑なため、安全な候補を作れませんでした。手動指定を使ってください。',
    PRINTABLE_AREA_TOO_SMALL: '安全に提案できる印刷面が小さすぎるため、手動指定を使ってください。',
    DIMENSION_MISMATCH: '服画像の寸法が切り抜き結果と一致しません。候補を選び直してください。',
    INVALID_RGBA: '服画像のピクセルデータが不正なため、手動指定を使ってください。',
    PIXEL_LIMIT_EXCEEDED: '服画像が安全な画素上限を超えたため、手動指定を使ってください。',
    CAPACITY_EXCEEDED: '提案マスクが保存上限を超えました。手動指定を使ってください。',
  };
  return messages[reason] ?? `印刷面の候補を作れませんでした: ${reason}`;
};

const defaultTransform = (overrides: Partial<Transform> = {}): Transform => ({
  x: overrides.x ?? 50,
  y: overrides.y ?? 50,
  scale: overrides.scale ?? 1,
  rotation: overrides.rotation ?? 0,
  opacity: overrides.opacity ?? 1,
  flipX: overrides.flipX ?? false,
  flipY: overrides.flipY ?? false,
});

const fabricVariants = [
  {
    id: 'cotton',
    name: 'コットン',
    tint: 'rgba(255,255,255,0.06)',
    filter: 'saturate(0.98) contrast(1.02)',
  },
  {
    id: 'denim',
    name: 'デニム',
    tint: 'rgba(30,58,95,0.10)',
    filter: 'saturate(1.2) contrast(1.08)',
  },
  {
    id: 'satin',
    name: 'サテン',
    tint: 'rgba(255,255,255,0.18)',
    filter: 'brightness(1.08) saturate(0.92)',
  },
  {
    id: 'linen',
    name: 'リネン',
    tint: 'rgba(180,140,90,0.09)',
    filter: 'saturate(0.95) contrast(1.05)',
  },
];

const printPreviewStageSize = { width: 720, height: 900 };
const IMAGE_LOAD_TIMEOUT_MS = 30_000;
const CUTOUT_TIMEOUT_MS = 75_000;
const CLOTH_CUTOUT_TIMEOUT_MS = 105_000;
const COMPOSITION_TIMEOUT_MS = 30_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      img.onload = null;
      img.onerror = null;
      img.src = '';
      reject(new Error('画像の読み込みがタイムアウトしました'));
    }, IMAGE_LOAD_TIMEOUT_MS);
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      callback();
    };
    img.crossOrigin = 'anonymous';
    img.onload = () => settle(() => resolve(img));
    img.onerror = () => settle(() => reject(new Error('image load failed')));
    img.src = url;
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

async function renderComposition(
  stageWidth: number,
  stageHeight: number,
  backgroundUrl: string | null,
  backgroundColor: string,
  layers: Array<AssetLayer>,
  mode: WorkbenchMode,
  variantIndex = 0,
) {
  const canvas = document.createElement('canvas');
  canvas.width = stageWidth;
  canvas.height = stageHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, stageWidth, stageHeight);

  if (backgroundUrl) {
    try {
      const background = await loadImage(backgroundUrl);
      const bgRatio = Math.max(stageWidth / background.width, stageHeight / background.height);
      const drawWidth = background.width * bgRatio;
      const drawHeight = background.height * bgRatio;
      const drawX = (stageWidth - drawWidth) / 2;
      const drawY = (stageHeight - drawHeight) / 2;
      ctx.drawImage(background, drawX, drawY, drawWidth, drawHeight);
    } catch {
      // fallback to color background when the image is not CORS-accessible
    }
  }

  const stageBase = mode === 'fabric' ? 0.56 : 0.62;

  for (const [index, layer] of layers.entries()) {
    try {
      const image = await loadImage(layer.displayUrl);
      const transform = layer.transform;
      const scaleBump = mode === 'fabric' ? 1 : 0.9 + variantIndex * 0.08;
      const isBase = index === 0;
      const baseWidth = isBase
        ? stageWidth * (mode === 'fabric' ? 0.96 : 0.84)
        : stageWidth * stageBase * transform.scale * scaleBump;
      const drawWidth = baseWidth;
      const drawHeight = drawWidth * (image.height / image.width);
      const centerX = stageWidth * (transform.x / 100);
      const centerY = stageHeight * (transform.y / 100);

      ctx.save();
      ctx.globalAlpha = transform.opacity;
      ctx.translate(centerX, centerY);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
      ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();
    } catch {
      // Keep exporting even if one layer fails to load.
    }
  }

  return canvas.toDataURL('image/png');
}

function LayerPreview({
  layer,
  selected,
  onSelect,
  onMove,
  mode,
}: {
  layer: AssetLayer;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  mode: WorkbenchMode;
}) {
  const widthClass = mode === 'fabric' ? 'w-[58%]' : 'w-[40%]';
  const style = {
    left: `${layer.transform.x}%`,
    top: `${layer.transform.y}%`,
    opacity: layer.transform.opacity,
    transform: `translate(-50%, -50%) rotate(${layer.transform.rotation}deg) scale(${layer.transform.scale * (layer.transform.flipX ? -1 : 1)}, ${layer.transform.scale * (layer.transform.flipY ? -1 : 1)})`,
  } as CSSProperties;

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect();
        const target = e.currentTarget;
        const pointerMove = (moveEvent: PointerEvent) => {
          const rect = target.parentElement?.getBoundingClientRect();
          if (!rect) return;
          const nextX = clamp(((moveEvent.clientX - rect.left) / rect.width) * 100, 0, 100);
          const nextY = clamp(((moveEvent.clientY - rect.top) / rect.height) * 100, 0, 100);
          onMove(nextX, nextY);
        };
        const pointerUp = () => {
          window.removeEventListener('pointermove', pointerMove);
          window.removeEventListener('pointerup', pointerUp);
        };
        window.addEventListener('pointermove', pointerMove);
        window.addEventListener('pointerup', pointerUp);
      }}
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl border transition-all ${selected ? 'border-primary-400 shadow-2xl shadow-primary-500/20 ring-2 ring-primary-300/40' : 'border-white/20 shadow-xl shadow-black/10'} ${mode === 'fabric' ? 'bg-white/10' : 'bg-white/8'}`}
      style={style}
    >
      <img
        src={layer.displayUrl}
        alt={layer.label}
        className={`${widthClass} max-w-none rounded-xl object-contain pointer-events-none select-none`}
        draggable={false}
      />
      {selected && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-primary-600 text-white text-[10px] font-semibold">
          移動中
        </div>
      )}
    </button>
  );
}

export function LightchainMaterialWorkbenchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentBrand, isInitialized: isAuthInitialized, isLoading: isAuthLoading } = useAuthStore();
  const mode: WorkbenchMode = location.pathname.includes('printing') ? 'printing' : 'fabric';
  const isPrinting = mode === 'printing';
  const [printOutputScale, setPrintOutputScale] = useState<1 | 2>(1);
  const printOutputStageSize = useMemo(() => ({
    width: printPreviewStageSize.width * printOutputScale,
    height: printPreviewStageSize.height * printOutputScale,
  }), [printOutputScale]);
  const stageRef = useRef<HTMLDivElement>(null);
  const printDesignSelectorRef = useRef<HTMLDivElement>(null);
  const printPlacementPaneRef = useRef<HTMLElement>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const userClearedSelectionRef = useRef(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedResults, setGeneratedResults] = useState<WorkbenchResult[]>([]);
  const [progressivePrintRun, setProgressivePrintRun] = useState<ProgressivePrintRun | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [surfaceConformStatus, setSurfaceConformStatus] = useState<string | null>(null);
  const [pendingSurfaceJob, setPendingSurfaceJob] = useState<PendingSurfaceJob | null>(null);
  const [generatedResultsStale, setGeneratedResultsStale] = useState(false);
  const [selectedResult, setSelectedResult] = useState<WorkbenchResult | null>(null);
  const [favoriteTargetResult, setFavoriteTargetResult] = useState<WorkbenchResult | null>(null);
  const [favoriteTargetBrandId, setFavoriteTargetBrandId] = useState<string | null>(null);
  const [favoriteSpace, setFavoriteSpace] = useState<'personal' | 'team'>('personal');
  const [favoriteDestination, setFavoriteDestination] = useState('パーソナルスペース');
  const [isCreatingFavoriteGroup, setIsCreatingFavoriteGroup] = useState(false);
  const [favoriteGroupName, setFavoriteGroupName] = useState('');
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [favoriteRevision, setFavoriteRevision] = useState(0);
  const [showResultComparison, setShowResultComparison] = useState(false);
  const [fabricBase, setFabricBase] = useState<SelectedImage | null>(null);
  const [fabricDesign, setFabricDesign] = useState<SelectedImage | null>(null);
  const [fabricLayer, setFabricLayer] = useState<AssetLayer | null>(null);
  const [fabricPresetIds, setFabricPresetIds] = useState<string[]>(['cotton', 'denim', 'satin']);
  const [printGarment, setPrintGarment] = useState<SelectedImage | null>(null);
  const [printGarmentCutoutSourceUrl, setPrintGarmentCutoutSourceUrl] = useState<string | null>(null);
  const [printGarmentSelectionSource, setPrintGarmentSelectionSource] = useState<GarmentSelectionSource>('automatic');
  const [printGarmentSegmentationTarget, setPrintGarmentSegmentationTarget] = useState<GarmentSegmentationTarget>(
    DEFAULT_GARMENT_SEGMENTATION_TARGET,
  );
  const [printGarmentProcessed, setPrintGarmentProcessed] = useState<string | null>(null);
  const [printGarmentMaskCandidates, setPrintGarmentMaskCandidates] = useState<PrintGarmentMaskCandidate[]>([]);
  const [selectedPrintGarmentMaskCandidateId, setSelectedPrintGarmentMaskCandidateId] = useState<PrintGarmentMaskCandidateId>('auto');
  const [printGarmentMaskRevision, setPrintGarmentMaskRevision] = useState(0);
  const [printGarmentMaskExplicitlyConfirmed, setPrintGarmentMaskExplicitlyConfirmed] = useState(false);
  const [printGarmentCutoutState, setPrintGarmentCutoutState] = useState<CutoutState>('idle');
  const [printGarmentCutoutError, setPrintGarmentCutoutError] = useState<string | null>(null);
  const [printDesigns, setPrintDesigns] = useState<SelectedImage[]>([]);
  const [printDesignLayers, setPrintDesignLayers] = useState<AssetLayer[]>([]);
  const [printPlacementSessionOpen, setPrintPlacementSessionOpen] = useState(true);
  const [printPlacementConfirmed, setPrintPlacementConfirmed] = useState(false);
  const [printPlacementSessionDirty, setPrintPlacementSessionDirty] = useState(false);
  const [printPlacementSessionRevision, setPrintPlacementSessionRevision] = useState(0);
  const [activePrintDesignLayerId, setActivePrintDesignLayerId] = useState<string | null>(null);
  const [printDesignProcessedUrls, setPrintDesignProcessedUrls] = useState<Record<number, string>>({});
  const [printDesignCutoutResults, setPrintDesignCutoutResults] = useState<Record<number, MaterialCutoutResult>>({});
  const [printDesignMaskRevisions, setPrintDesignMaskRevisions] = useState<Record<number, number>>({});
  const [printDesignCutoutStates, setPrintDesignCutoutStates] = useState<Record<number, CutoutState>>({});
  const [printDesignCutoutErrors, setPrintDesignCutoutErrors] = useState<Record<number, string>>({});
  const printDesignHandoffConsumedRef = useRef(false);
  const printDesignHandoffImportingRef = useRef<string | null>(null);
  const [printGarmentSelectionOpen, setPrintGarmentSelectionOpen] = useState(false);
  const [printMaskEditorTarget, setPrintMaskEditorTarget] = useState<PrintMaskEditorTarget | null>(null);
  const [printMaskEditorError, setPrintMaskEditorError] = useState<string | null>(null);
  const [manualPrintableSurface, setManualPrintableSurface] = useState<EncodedManualPrintableSurface | null>(null);
  const [printableSurfaceEnabled, setPrintableSurfaceEnabled] = useState(false);
  const [printableSurfaceStageMaskUrl, setPrintableSurfaceStageMaskUrl] = useState<string | null>(null);
  const [printableSurfaceResetNotice, setPrintableSurfaceResetNotice] = useState<string | null>(null);
  const [printableSuggestionPending, setPrintableSuggestionPending] = useState(false);
  const [printableSuggestionStatus, setPrintableSuggestionStatus] = useState<string | null>(null);
  const printableSurfaceRevisionRef = useRef(0);
  const manualPrintableSurfaceRef = useRef<EncodedManualPrintableSurface | null>(null);
  const printableSuggestionRequestRef = useRef(0);
  const printableSurfaceEditorOperationRef = useRef(0);
  const printGarmentCutoutRequestRef = useRef(0);
  const printDesignCutoutRequestRef = useRef(0);
  const printDesignLayerIdsRef = useRef(new Map<string, string>());
  const currentPrintDesignLayerIdsRef = useRef<string[]>([]);
  const printDesignLayerSequenceRef = useRef(0);
  const printPlacementBaselineRef = useRef<PlacementEditBaseline<Transform> | null>(null);
  const printPlacementSessionOpenRef = useRef(true);
  const pendingActivePrintDesignLayerIdRef = useRef<string | null>(null);
  const printDesignReturnIntentRef = useRef<PrintDesignReturnIntent | null>(null);
  const printDesignReturnFrameRef = useRef<number | null>(null);
  const printRequestRevisionRef = useRef(0);
  const generationSequenceRef = useRef(0);
  const surfaceJobSequenceRef = useRef(0);
  const generationRequestRef = useRef<number | null>(null);
  const generationRequestSignatureRef = useRef<string | null>(null);
  const selectedPrintGarmentMaskCandidateIdRef = useRef(selectedPrintGarmentMaskCandidateId);
  const printGarmentMaskRevisionRef = useRef(printGarmentMaskRevision);
  const printGarmentProcessedRef = useRef(printGarmentProcessed);
  const selectedPrintGarmentOutputSizeRef = useRef<{ width: number; height: number } | null>(null);
  const selectedPrintGarmentMaskCandidate = useMemo(
    () => printGarmentMaskCandidates.find(
      (candidate) => candidate.candidateId === selectedPrintGarmentMaskCandidateId,
    ) ?? null,
    [printGarmentMaskCandidates, selectedPrintGarmentMaskCandidateId],
  );
  const clothModelConfigured = isPrintGarmentClothModelConfigured();
  const printGarmentSegmentationStatus = useMemo(() => garmentSelectionModelStatus({
    selectionSource: printGarmentSelectionSource,
    clothModelConfigured,
    resultEngine: selectedPrintGarmentMaskCandidate?.result.engine,
    requestedTarget: printGarmentSegmentationTarget,
    resultTarget: selectedPrintGarmentMaskCandidate?.result.segmentationTarget,
  }), [clothModelConfigured, printGarmentSegmentationTarget, printGarmentSelectionSource, selectedPrintGarmentMaskCandidate]);
  const hasConfirmedPrintGarmentMask = isGarmentMaskExplicitlyConfirmed({
    selectionSource: printGarmentSelectionSource,
    maskCandidateId: selectedPrintGarmentMaskCandidateId,
    cutoutDone: printGarmentCutoutState === 'done',
    hasProcessedMask: Boolean(printGarmentProcessed),
    explicitlyConfirmed: printGarmentMaskExplicitlyConfirmed,
  });
  const visibleGeneratedResults = useMemo(
    () => isPrinting
      ? generatedResults.filter((result) => result.id.startsWith('print-'))
      : generatedResults.filter((result) => !result.id.startsWith('print-')),
    [generatedResults, isPrinting],
  );
  const printResultRuns = useMemo(
    () => groupPrintResultHistory(visibleGeneratedResults),
    [visibleGeneratedResults],
  );
  const placedPrintDesignLayers = useMemo(
    () => selectPlacedPrintDesignLayers(printDesignLayers),
    [printDesignLayers],
  );
  const canConfirmPrintPlacement = canConfirmPlacementEdit({
    garmentMaskConfirmed: hasConfirmedPrintGarmentMask,
    layers: placedPrintDesignLayers,
  });
  const printDesignsReady = placedPrintDesignLayers.length > 0
    && placedPrintDesignLayers.every((layer) => (
      layer.cutoutState === 'done'
      && Boolean(layer.originalUrl)
      && Boolean(layer.displayUrl)
    ));
  const printDesignsProcessing = placedPrintDesignLayers.some((layer) => layer.cutoutState === 'processing');
  const printDesignsErrored = placedPrintDesignLayers.some((layer) => layer.cutoutState === 'error');
  const printPlacementConfirmationStatus = !hasConfirmedPrintGarmentMask
    ? '青い服の認識範囲を確定してください'
    : placedPrintDesignLayers.length === 0
      ? '配置するプリント画像を1つ以上選択してください'
      : placedPrintDesignLayers.some((layer) => layer.cutoutState === 'processing')
        ? 'デザインの透明化完了後に決定できます'
        : placedPrintDesignLayers.some((layer) => layer.cutoutState === 'error')
          ? '透明化に失敗したデザインを削除または再選択してください'
          : 'すべてのデザイン表示が揃うまで決定できません';

  const getPrintDesignLayerId = useCallback((design: SelectedImage) => {
    const identity = printDesignIdentity(design);
    const existing = printDesignLayerIdsRef.current.get(identity);
    if (existing) return existing;
    printDesignLayerSequenceRef.current += 1;
    const layerId = `print-design-${printDesignLayerSequenceRef.current}`;
    printDesignLayerIdsRef.current.set(identity, layerId);
    return layerId;
  }, []);

  const invalidatePrintableSuggestion = useCallback(() => {
    printableSuggestionRequestRef.current += 1;
    printableSurfaceEditorOperationRef.current += 1;
    setPrintableSuggestionPending(false);
    setPrintableSuggestionStatus(null);
  }, []);

  const generationInputSignature = useMemo(() => JSON.stringify({
    mode,
    brandId: currentBrand?.id ?? null,
    fabricBaseUrl: fabricBase?.url ?? null,
    fabricDesignUrl: fabricDesign?.url ?? null,
    fabricPresetIds,
    printGarmentUrl: printGarment?.url ?? null,
    printGarmentSelectionSource,
    printGarmentSegmentationTarget,
    printGarmentProcessed,
    printGarmentMaskCandidateId: selectedPrintGarmentMaskCandidateId,
    printGarmentMaskRevision,
    printGarmentMaskExplicitlyConfirmed,
    printGarmentCutoutState,
    printOutputScale,
    printableSurfaceIdentity: printableSurfaceEnabled ? manualPrintableSurface?.identity : undefined,
    printDesignLayers: placedPrintDesignLayers.map((layer) => ({
      id: layer.id,
      sourceUrl: layer.originalUrl,
      displayUrl: layer.displayUrl,
      transform: layer.transform,
      cutoutState: layer.cutoutState,
      maskRevision: layer.maskRevision,
    })),
  }), [
    currentBrand?.id,
    fabricBase?.url,
    fabricDesign?.url,
    fabricPresetIds,
    mode,
    placedPrintDesignLayers,
    printGarment?.url,
    printGarmentSelectionSource,
    printGarmentSegmentationTarget,
    printGarmentCutoutState,
    printGarmentProcessed,
    printGarmentMaskRevision,
    printGarmentMaskExplicitlyConfirmed,
    printOutputScale,
    manualPrintableSurface?.identity,
    printableSurfaceEnabled,
    selectedPrintGarmentMaskCandidateId,
  ]);
  const generationInputSignatureRef = useRef(generationInputSignature);
  if (generationInputSignatureRef.current !== generationInputSignature) {
    generationInputSignatureRef.current = generationInputSignature;
    generationSequenceRef.current += 1;
  }
  const generationInputEffectSignatureRef = useRef(generationInputSignature);

  useEffect(() => {
    selectedPrintGarmentMaskCandidateIdRef.current = selectedPrintGarmentMaskCandidateId;
  }, [selectedPrintGarmentMaskCandidateId]);

  useEffect(() => {
    printGarmentMaskRevisionRef.current = printGarmentMaskRevision;
    printGarmentProcessedRef.current = printGarmentProcessed;
  }, [printGarmentMaskRevision, printGarmentProcessed]);

  useEffect(() => {
    selectedPrintGarmentOutputSizeRef.current = printGarmentMaskCandidates.find(
      (candidate) => candidate.candidateId === selectedPrintGarmentMaskCandidateId,
    )?.result.outputSize ?? null;
  }, [printGarmentMaskCandidates, selectedPrintGarmentMaskCandidateId]);

  useEffect(() => () => {
    printableSuggestionRequestRef.current += 1;
    printableSurfaceEditorOperationRef.current += 1;
    generationSequenceRef.current += 1;
    generationRequestRef.current = null;
    generationRequestSignatureRef.current = null;
    if (printDesignReturnFrameRef.current !== null) {
      cancelAnimationFrame(printDesignReturnFrameRef.current);
      printDesignReturnFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (generationInputEffectSignatureRef.current === generationInputSignature) return;
    generationInputEffectSignatureRef.current = generationInputSignature;
    if (generatedResults.length > 0) setGeneratedResultsStale(true);
    setPendingSurfaceJob(null);
    setProgressivePrintRun(null);
    const activeRequest = generationRequestRef.current;
    if (activeRequest === null || generationRequestSignatureRef.current === generationInputSignature) return;
    generationRequestRef.current = null;
    generationRequestSignatureRef.current = null;
    setIsGenerating(false);
    setGenerationError('素材が変更されたため、進行中の生成結果を無効化しました。内容を確認して再生成してください。');
  }, [generatedResults.length, generationInputSignature]);

  const printSnapshotSignature = useMemo(() => {
    if (!currentBrand?.id || !printGarmentProcessed) return '';
    return buildPrintRequestSignature({
      brandId: currentBrand.id,
      brandName: currentBrand.name || 'brand',
      stageSize: printOutputStageSize,
      garment: {
        sourceUrl: printGarmentProcessed,
        referenceType: printGarment?.referenceType ?? null,
        maskCandidateId: selectedPrintGarmentMaskCandidateId,
        maskRevision: printGarmentMaskRevision,
      },
      ...(printableSurfaceEnabled && manualPrintableSurface
        ? { surfaceIdentity: manualPrintableSurface.identity }
        : {}),
      designs: placedPrintDesignLayers.map((layer) => ({
        id: layer.id,
        sourceUrl: layer.originalUrl,
        maskRevision: layer.maskRevision,
        transform: layer.transform,
      })),
    });
  }, [placedPrintDesignLayers, currentBrand?.id, currentBrand?.name, manualPrintableSurface, printableSurfaceEnabled, printGarment?.referenceType, printGarmentProcessed, printGarmentMaskRevision, printOutputStageSize, selectedPrintGarmentMaskCandidateId]);

  const currentPrintStateRef = useRef<{ revision: number; signature: string }>({ revision: 0, signature: printSnapshotSignature });

  if (currentPrintStateRef.current.signature !== printSnapshotSignature) {
    printRequestRevisionRef.current += 1;
    currentPrintStateRef.current = {
      revision: printRequestRevisionRef.current,
      signature: printSnapshotSignature,
    };
  }

  useEffect(() => {
    const job = pendingSurfaceJob;
    if (!job) return;
    let cancelled = false;
    const isCurrentSurfaceJob = () => (
      !cancelled
      && surfaceJobSequenceRef.current === job.id
      && generationInputSignatureRef.current === job.inputSignature
      && currentPrintStateRef.current.revision === job.revision
      && currentPrintStateRef.current.signature === job.signature
    );
    const run = async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => window.setTimeout(resolve, 0));
      });
      if (!isCurrentSurfaceJob()) return;
      try {
        const surfaceComposition = await renderExperimentalSurfaceComposition(job.snapshot, {
          deadlineAtMs: Date.now() + 10_000,
        });
        if (!isCurrentSurfaceJob()) return;
        if (surfaceComposition.kind === 'ood') {
          setSurfaceConformStatus(surfaceConformStatusMessage(surfaceComposition.domain));
          return;
        }
        const surfaceResult: WorkbenchResult = {
          id: `print-${job.revision}-${job.generatedAt}-surface`,
          brandId: job.brandId,
          runId: job.runId,
          resultKind: 'surface',
          generatedAt: job.generatedAt,
          title: '布面メッシュ追従（試験）',
          note: '手動指定面 / 適応行メッシュ＋局所シェーディング / 3D・自動衣服認識ではありません',
          imageUrl: surfaceComposition.dataUrl,
          outputSize: { ...job.snapshot.stageSize },
        };
        setGeneratedResults((current) => mergeDelayedSurfaceResult({
          currentResults: current,
          exactId: job.exactId,
          fabricId: job.fabricId,
          surfaceResult,
        }));
        setSurfaceConformStatus('布面メッシュ追従（試験）を追加しました。印刷面の形状・折り目を2D画像から安全範囲で反映しています。');
      } catch (surfaceError) {
        if (!isCurrentSurfaceJob()) return;
        const reason = surfaceError instanceof Error ? surfaceError.message : 'SURFACE_CONFORM_FAILED';
        console.warn('Experimental surface composition skipped.', surfaceError);
        setSurfaceConformStatus(surfaceConformStatusMessage(reason));
      } finally {
        if (!cancelled) {
          setPendingSurfaceJob((current) => current?.id === job.id ? null : current);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [pendingSurfaceJob]);

  const activeLayers = useMemo(() => {
    if (isPrinting) {
      return [
        ...((printGarment || printGarmentProcessed || printGarmentCutoutState === 'processing' || printGarmentCutoutState === 'error') ? [{
          id: 'print-garment',
          label: '参考画像',
          originalUrl: printGarmentCutoutState === 'done' ? (printGarmentProcessed || '') : '',
          displayUrl: printGarmentCutoutState === 'done' ? (printGarmentProcessed || '') : '',
          transform: defaultTransform({ x: 50, y: 52, scale: 1, opacity: 1 }),
          autoCutout: true,
          cutoutState: printGarmentCutoutState,
          maskRevision: printGarmentMaskRevision,
        } as const] : []),
        ...printDesignLayers,
      ];
    }
    return fabricLayer ? [fabricLayer] : [];
  }, [fabricLayer, isPrinting, printDesignLayers, printGarment, printGarmentCutoutState, printGarmentMaskRevision, printGarmentProcessed]);

  const focusPrintPlacementPane = useCallback(() => {
    const pane = printPlacementPaneRef.current;
    if (!pane) return;
    pane.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' });
    pane.focus({ preventScroll: true });
  }, []);

  const openPrintPlacementSession = useCallback(() => {
    if (printPlacementSessionOpenRef.current) {
      requestAnimationFrame(() => focusPrintPlacementPane());
      return;
    }
    printPlacementBaselineRef.current = null;
    setPrintPlacementSessionDirty(false);
    printPlacementSessionOpenRef.current = true;
    setPrintPlacementSessionOpen(true);
    setPrintPlacementSessionRevision((current) => current + 1);
    requestAnimationFrame(() => focusPrintPlacementPane());
  }, [focusPrintPlacementPane]);

  const beginPrintPlacementSessionEdit = useCallback(() => {
    if (!printPlacementBaselineRef.current) {
      printPlacementBaselineRef.current = createPlacementEditBaseline(printDesignLayers);
    }
    setPrintPlacementSessionDirty(true);
  }, [printDesignLayers]);

  const confirmPrintPlacementSession = useCallback(() => {
    if (!canConfirmPrintPlacement) {
      toast.error(printPlacementConfirmationStatus);
      focusPrintPlacementPane();
      return;
    }
    printPlacementBaselineRef.current = null;
    setPrintPlacementSessionDirty(false);
    setPrintPlacementConfirmed(true);
    printPlacementSessionOpenRef.current = false;
    setPrintPlacementSessionOpen(false);
    setPrintPlacementSessionRevision((current) => current + 1);
    toast.success('デザイン配置を決定しました');
  }, [canConfirmPrintPlacement, focusPrintPlacementPane, printPlacementConfirmationStatus]);

  const cancelPrintPlacementSession = useCallback(() => {
    const baseline = printPlacementBaselineRef.current;
    if (baseline) {
      setPrintDesignLayers((current) => restorePlacementEditBaseline({ baseline, currentLayers: current }));
    }
    printPlacementBaselineRef.current = null;
    setPrintPlacementSessionDirty(false);
    printPlacementSessionOpenRef.current = false;
    setPrintPlacementSessionOpen(false);
    setPrintPlacementSessionRevision((current) => current + 1);
    userClearedSelectionRef.current = true;
    setSelectedLayerId(null);
    toast('配置の変更を取り消しました');
  }, []);

  const consumeReadyPrintDesignReturn = (targetLayerId: string) => {
    const resolution = resolvePrintDesignReturnIntent({
      intent: printDesignReturnIntentRef.current,
      activeLayerId: targetLayerId,
      expectedLayerIds: printDesigns.map(getPrintDesignLayerId),
      layers: printDesignLayers.map((layer) => ({ id: layer.id, state: layer.cutoutState })),
    });
    printDesignReturnIntentRef.current = resolution.intent;
    if (resolution.shouldReturn) openPrintPlacementSession();
  };

  const cancelScheduledPrintDesignReturn = () => {
    if (printDesignReturnFrameRef.current === null) return;
    cancelAnimationFrame(printDesignReturnFrameRef.current);
    printDesignReturnFrameRef.current = null;
  };

  const scheduleDeferredPrintDesignReturn = (targetLayerId: string) => {
    cancelScheduledPrintDesignReturn();
    printDesignReturnFrameRef.current = requestAnimationFrame(() => {
      printDesignReturnFrameRef.current = requestAnimationFrame(() => {
        printDesignReturnFrameRef.current = null;
        printDesignReturnIntentRef.current = releasePrintDesignReturnIntent(
          printDesignReturnIntentRef.current,
          targetLayerId,
        );
        consumeReadyPrintDesignReturn(targetLayerId);
      });
    });
  };

  useEffect(() => {
    if (!isPrinting) {
      if (!fabricLayer) {
        if (selectedLayerId) setSelectedLayerId(null);
        return;
      }
      if (selectedLayerId !== fabricLayer.id && !userClearedSelectionRef.current) {
        setSelectedLayerId(fabricLayer.id);
      }
      return;
    }
    const next = resolvePrintPlacementSelection({
      layers: activeLayers.map((layer) => ({
        id: layer.id,
        kind: layer.id === 'print-garment' ? 'garment' : 'design',
        ready: layer.cutoutState === 'done',
      })),
      selectedLayerId,
      pendingLayerId: pendingActivePrintDesignLayerIdRef.current,
      pendingLayerExpected: Boolean(
        pendingActivePrintDesignLayerIdRef.current
        && printDesigns.some(
          (design) => getPrintDesignLayerId(design) === pendingActivePrintDesignLayerIdRef.current,
        )
      ),
      userClearedSelection: userClearedSelectionRef.current,
    });
    pendingActivePrintDesignLayerIdRef.current = next.pendingLayerId;
    if (next.selectedLayerId !== selectedLayerId) {
      setSelectedLayerId(next.selectedLayerId);
    }
  }, [activeLayers, fabricLayer, getPrintDesignLayerId, isPrinting, printDesigns, selectedLayerId]);

  useEffect(() => {
    if (!isPrinting || printDesignLayers.length === 0) return;
    const activeLayer = activePrintDesignLayerId
      ? printDesignLayers.find((layer) => layer.id === activePrintDesignLayerId)
      : null;
    const activeLayerExpected = isPendingPrintDesignLayerMaterialization({
      activeLayerId: activePrintDesignLayerId,
      pendingLayerId: pendingActivePrintDesignLayerIdRef.current,
      expectedLayerIds: printDesigns.map(getPrintDesignLayerId),
      materializedLayerIds: printDesignLayers.map((layer) => layer.id),
    });
    if (!activeLayer && activeLayerExpected) return;
    if (activeLayer && activeLayer.cutoutState !== 'error') return;

    const fallbackLayers = printDesignLayers.map((layer) => ({
        id: layer.id,
        kind: 'design' as const,
        ready: layer.cutoutState === 'done',
        processing: layer.cutoutState === 'processing',
      }));
    const readyFallbackLayerId = selectLatestReadyPrintDesignLayerId(fallbackLayers);
    const processingFallbackLayerId = selectLatestProcessingPrintDesignLayerId(fallbackLayers);
    const fallbackLayerId = readyFallbackLayerId ?? processingFallbackLayerId;
    if (fallbackLayerId === activePrintDesignLayerId) return;
    pendingActivePrintDesignLayerIdRef.current = readyFallbackLayerId
      ? null
      : processingFallbackLayerId;
    setActivePrintDesignLayerId(fallbackLayerId);
    if (!userClearedSelectionRef.current) {
      setSelectedLayerId((current) => (
        !current || current === activePrintDesignLayerId ? readyFallbackLayerId : current
      ));
    }
  }, [activePrintDesignLayerId, getPrintDesignLayerId, isPrinting, printDesignLayers, printDesigns]);

  useEffect(() => {
    const resolution = resolvePrintDesignReturnIntent({
      intent: printDesignReturnIntentRef.current,
      activeLayerId: activePrintDesignLayerId,
      expectedLayerIds: printDesigns.map(getPrintDesignLayerId),
      layers: printDesignLayers.map((layer) => ({ id: layer.id, state: layer.cutoutState })),
    });
    printDesignReturnIntentRef.current = resolution.intent;
    if (!resolution.shouldReturn) return;
    openPrintPlacementSession();
  }, [activePrintDesignLayerId, getPrintDesignLayerId, openPrintPlacementSession, printDesignLayers, printDesigns]);

  useEffect(() => {
    const onPointerUp = () => {
      // Pointer tracking is driven directly from the stage element.
    };
    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  }, []);

  const selectLayer = (layerId: string) => {
    pendingActivePrintDesignLayerIdRef.current = null;
    userClearedSelectionRef.current = false;
    if (layerId.startsWith('print-design-')) {
      printDesignReturnIntentRef.current = bindPrintDesignReturnIntent(
        printDesignReturnIntentRef.current,
        layerId,
      );
      consumeReadyPrintDesignReturn(layerId);
      setActivePrintDesignLayerId(layerId);
    }
    setSelectedLayerId(layerId);
  };

  const clearSelectedLayer = () => {
    cancelScheduledPrintDesignReturn();
    printDesignReturnIntentRef.current = null;
    pendingActivePrintDesignLayerIdRef.current = null;
    userClearedSelectionRef.current = true;
    setSelectedLayerId(null);
  };

  useEffect(() => {
    if (!fabricBase || !fabricDesign) {
      setFabricLayer(null);
      return;
    }
    setFabricLayer((prev) => ({
      id: 'fabric-design',
      label: '重ねるデザイン',
      originalUrl: fabricDesign.url,
      displayUrl: fabricDesign.url,
      transform: prev?.transform ?? defaultTransform({ x: 54, y: 47, scale: 1, rotation: -8 }),
      autoCutout: false,
      cutoutState: 'idle',
      maskRevision: 0,
    }));
  }, [fabricBase, fabricDesign]);

  const clearManualPrintableSurface = useCallback((reason?: string) => {
    manualPrintableSurfaceRef.current = null;
    setManualPrintableSurface(null);
    setPrintableSurfaceEnabled(false);
    setPrintableSurfaceStageMaskUrl(null);
    setPrintableSurfaceResetNotice(reason ?? null);
  }, []);

  useEffect(() => {
    invalidatePrintableSuggestion();
    const requestId = ++printGarmentCutoutRequestRef.current;
    setPrintMaskEditorTarget(null);
    setPrintGarmentMaskRevision(0);
    clearManualPrintableSurface();
    if (!printGarment) {
      setPrintGarmentCutoutSourceUrl(null);
      setPrintGarmentSelectionSource('automatic');
      setPrintGarmentSegmentationTarget(DEFAULT_GARMENT_SEGMENTATION_TARGET);
      setPrintGarmentProcessed(null);
      setPrintGarmentMaskCandidates([]);
      setSelectedPrintGarmentMaskCandidateId('auto');
      setPrintGarmentMaskExplicitlyConfirmed(false);
      setPrintGarmentCutoutState('idle');
      setPrintGarmentCutoutError(null);
      return;
    }
    let cancelled = false;
    setPrintGarmentCutoutState('processing');
    setPrintGarmentCutoutError(null);
    setPrintGarmentProcessed(null);
    setPrintGarmentMaskCandidates([]);
    setSelectedPrintGarmentMaskCandidateId('auto');
    const cutoutSourceUrl = printGarmentCutoutSourceUrl ?? printGarment.url;
    const cutoutModel = resolvePrintGarmentCutoutModel({ selectionSource: printGarmentSelectionSource });
    const cutoutTimeoutMilliseconds = cutoutModel === 'u2net_cloth_seg'
      ? CLOTH_CUTOUT_TIMEOUT_MS
      : CUTOUT_TIMEOUT_MS;
    void withTimeout(
      buildPrintGarmentCutoutDataUrl({
        imageUrl: cutoutSourceUrl,
        modelName: cutoutModel,
        segmentationTarget: printGarmentSegmentationTarget,
      }),
      cutoutTimeoutMilliseconds,
      '参考画像の透明化がタイムアウトしました。元画像を確認して再試行してください',
    )
      .then((automaticResult) => {
        if (cancelled || printGarmentCutoutRequestRef.current !== requestId) return;
        const automaticCandidate: PrintGarmentMaskCandidate = {
          candidateId: 'auto',
          label: '自動（推奨）',
          description: '高精度の自動切り抜きです',
          result: automaticResult,
        };
        setPrintGarmentMaskCandidates([automaticCandidate]);
        setSelectedPrintGarmentMaskCandidateId('auto');
        setPrintGarmentProcessed(automaticResult.dataUrl);
        setPrintGarmentCutoutState('done');
        void buildDerivedPrintGarmentMaskCandidates({ baseResult: automaticResult })
          .then((candidates) => {
            if (cancelled || printGarmentCutoutRequestRef.current !== requestId) return;
            setPrintGarmentMaskCandidates((currentCandidates) => {
              const mergedCandidates = mergePrintMaskCandidatesById(currentCandidates, candidates);
              const currentSelectedCandidateId = selectedPrintGarmentMaskCandidateIdRef.current;
              const nextSelectedCandidateId = resolvePrintMaskCandidateId(mergedCandidates, currentSelectedCandidateId) as PrintGarmentMaskCandidateId;
              if (nextSelectedCandidateId !== currentSelectedCandidateId) {
                const nextSelection = selectPrintGarmentMaskCandidateValue(mergedCandidates, nextSelectedCandidateId);
                if (manualPrintableSurfaceRef.current) {
                  clearManualPrintableSurface('服の切り抜き候補が変わったため、手動の印刷可能面をリセットしました。');
                }
                setSelectedPrintGarmentMaskCandidateId(nextSelection.candidateId);
                setPrintGarmentProcessed(nextSelection.dataUrl);
                setPrintGarmentMaskExplicitlyConfirmed(nextSelection.candidateId === 'manual');
              }
              return mergedCandidates;
            });
          })
          .catch((candidateError) => {
            console.warn('Optional garment mask candidates could not be prepared.', candidateError);
          });
      })
      .catch((error) => {
        if (cancelled || printGarmentCutoutRequestRef.current !== requestId) return;
        console.error('Print garment cutout failed', error);
        setPrintGarmentProcessed(null);
        setPrintGarmentCutoutState('error');
        setPrintGarmentCutoutError(error instanceof Error ? error.message : '参考画像の背景を透明化できませんでした');
      });
    return () => {
      cancelled = true;
      if (printGarmentCutoutRequestRef.current === requestId) {
        printGarmentCutoutRequestRef.current += 1;
      }
    };
  }, [clearManualPrintableSurface, invalidatePrintableSuggestion, printGarment, printGarmentCutoutSourceUrl, printGarmentSegmentationTarget, printGarmentSelectionSource]);

  const selectPrintGarmentMaskCandidate = (candidateId: PrintGarmentMaskCandidateId) => {
    if (candidateId === selectedPrintGarmentMaskCandidateId) return;
    invalidatePrintableSuggestion();
    const selection = selectPrintGarmentMaskCandidateValue(printGarmentMaskCandidates, candidateId);
    if (manualPrintableSurfaceRef.current) {
      clearManualPrintableSurface('服の切り抜き候補が変わったため、手動の印刷可能面をリセットしました。');
    }
    setSelectedPrintGarmentMaskCandidateId(selection.candidateId);
    setPrintGarmentProcessed(selection.dataUrl);
    setPrintGarmentMaskExplicitlyConfirmed(selection.candidateId === 'manual');
    setPrintGarmentMaskRevision((current) => current + 1);
    setPrintMaskEditorTarget(null);
    toast.success(`${selection.candidate.label}をステージへ反映しました`);
  };

  useEffect(() => {
    if (!printDesigns.length) {
      setPrintDesignLayers([]);
      pendingActivePrintDesignLayerIdRef.current = null;
      setActivePrintDesignLayerId(null);
      return;
    }
    setPrintDesignLayers((previousLayers) => {
      const materializedLayers = printDesigns.map((design, index) => {
        const layerId = getPrintDesignLayerId(design);
        const previousLayer = previousLayers.find((layer) => layer.id === layerId);
        const cutoutState = printDesignCutoutStates[index] ?? 'processing';
        const processedUrl = cutoutState === 'done' ? (printDesignProcessedUrls[index] || '') : '';
        const displayUrl = processedUrl || design.url;
        return {
          id: layerId,
          label: `デザイン ${index + 1}`,
          originalUrl: processedUrl,
          displayUrl,
          transform: defaultTransform({
            x: previousLayer?.transform.x ?? 50 + ((index % 3) - 1) * 8,
            y: previousLayer?.transform.y ?? 44 + Math.floor(index / 3) * 14,
            scale: previousLayer?.transform.scale ?? (index === 0 ? 1 : 0.88),
            rotation: previousLayer?.transform.rotation ?? (index % 2 === 0 ? -6 : 6) * (index % 3),
            opacity: previousLayer?.transform.opacity ?? 1,
            flipX: previousLayer?.transform.flipX ?? false,
            flipY: previousLayer?.transform.flipY ?? false,
          }),
          autoCutout: true,
          cutoutState,
          maskRevision: printDesignMaskRevisions[index] ?? 0,
        };
      });
      return preservePrintDesignLayerOrder(previousLayers, materializedLayers);
    });
  }, [getPrintDesignLayerId, printDesignCutoutStates, printDesignMaskRevisions, printDesignProcessedUrls, printDesigns]);

  const stageLayers = useMemo(() => {
    if (isPrinting) {
      const garments = (printGarment || printGarmentProcessed || printGarmentCutoutState === 'processing' || printGarmentCutoutState === 'error')
        ? [{
            id: 'print-garment',
            label: '参考画像',
            originalUrl: printGarmentCutoutState === 'done' ? (printGarmentProcessed || '') : '',
            displayUrl: printGarmentCutoutState === 'done' ? (printGarmentProcessed || '') : '',
            transform: defaultTransform({ x: 50, y: 52, scale: 1, opacity: 1 }),
            autoCutout: true,
            cutoutState: printGarmentCutoutState,
            maskRevision: printGarmentMaskRevision,
          } as const]
        : [];
      return [...garments, ...placedPrintDesignLayers];
    }

    return fabricLayer ? [fabricLayer] : [];
  }, [fabricLayer, isPrinting, placedPrintDesignLayers, printGarment, printGarmentCutoutState, printGarmentMaskRevision, printGarmentProcessed]);

  useEffect(() => {
    if (!fabricBase || !fabricDesign) {
      setFabricLayer(null);
      return;
    }
    setFabricLayer((prev) => ({
      id: 'fabric-design',
      label: '重ねるデザイン',
      originalUrl: fabricDesign.url,
      displayUrl: fabricDesign.url,
      transform: prev?.transform ?? defaultTransform({ x: 54, y: 47, scale: 1, rotation: -8 }),
      autoCutout: false,
      cutoutState: 'idle',
      maskRevision: 0,
    }));
  }, [fabricBase, fabricDesign]);

  const handleGenerate = async () => {
    if (isPrinting) invalidatePrintableSuggestion();
    if (!stageRef.current && !isPrinting) return;
    if (!currentBrand?.id) {
      toast.error('ブランドを選択してください');
      return;
    }

    if (!isPrinting && (!fabricBase || !fabricDesign)) {
      toast.error('生地画像とデザイン画像を入れてください');
      return;
    }
    if (isPrinting && (!printGarmentProcessed || printGarmentCutoutState !== 'done')) {
      toast.error(printGarmentCutoutState === 'processing'
        ? '背景の透明化が完了するまでお待ちください'
        : '参考画像の透明化を完了してください');
      return;
    }
    if (isPrinting && !hasConfirmedPrintGarmentMask) {
      setPrintGarmentSelectionOpen(true);
      toast.error('青い認識範囲を確認し、「決定」を押してください');
      return;
    }
    if (isPrinting && (printPlacementSessionOpen || !printPlacementConfirmed)) {
      toast.error('デザイン配置を「決定」してから生成してください');
      if (printPlacementSessionOpen) focusPrintPlacementPane();
      else openPrintPlacementSession();
      return;
    }
    if (isPrinting && !canConfirmPrintPlacement) {
      toast.error(placedPrintDesignLayers.some((layer) => layer.cutoutState === 'processing')
        ? '配置中デザインの透明化が完了するまでお待ちください'
        : printPlacementConfirmationStatus);
      return;
    }
    if (isPrinting && printableSurfaceEnabled && !manualPrintableSurface) {
      toast.error('印刷可能面が見つかりません。手動で指定し直してください');
      return;
    }

    const requestId = ++generationSequenceRef.current;
    const requestSignature = generationInputSignatureRef.current;
    generationRequestRef.current = requestId;
    generationRequestSignatureRef.current = requestSignature;
    setIsGenerating(true);
    setGenerationError(null);
    setSurfaceConformStatus(null);
    setPendingSurfaceJob(null);
    setProgressivePrintRun(null);
    if (generatedResults.length > 0) setGeneratedResultsStale(true);
    const isCurrentRequest = () => (
      generationRequestRef.current === requestId
      && generationSequenceRef.current === requestId
      && generationInputSignatureRef.current === requestSignature
    );
    try {
      const rect = stageRef.current?.getBoundingClientRect();
      const width = Math.max(720, Math.round(rect?.width || 960));
      const height = Math.max(720, Math.round(rect?.height || 960));

      if (!isPrinting) {
        const baseLayers: AssetLayer[] = [{
          id: 'fabric-base',
          label: '生地画像',
          originalUrl: fabricBase!.url,
          displayUrl: fabricBase!.url,
          transform: defaultTransform({ x: 50, y: 50, scale: 1, opacity: 1 }),
          autoCutout: false,
          cutoutState: 'done',
          maskRevision: 0,
        }, {
          id: 'fabric-design',
          label: 'デザイン',
          originalUrl: fabricDesign!.url,
          displayUrl: fabricDesign!.url,
          transform: fabricLayer?.transform || defaultTransform({ x: 54, y: 47, scale: 1, rotation: -8 }),
          autoCutout: false,
          cutoutState: 'idle',
          maskRevision: 0,
        }];

        const variantResults: WorkbenchResult[] = [];
        for (const preset of fabricVariants.filter((variant) => fabricPresetIds.includes(variant.id))) {
          const imageUrl = await withTimeout(
            renderComposition(width, height, fabricBase?.url || null, preset.tint, baseLayers, 'fabric'),
            COMPOSITION_TIMEOUT_MS,
            '生地プレビューの描画がタイムアウトしました。素材を確認して再試行してください',
          );
          if (!isCurrentRequest()) return;
          variantResults.push({
            id: `${preset.id}-${Date.now()}`,
            brandId: currentBrand.id,
            title: `生地バリエーション: ${preset.name}`,
            note: `${preset.name} の質感で重ねた見本`,
            imageUrl,
          });
        }
        if (!variantResults.length) {
          throw new Error('生地バリエーションを1つ以上選択してください');
        }
        if (!isCurrentRequest()) return;
        setGeneratedResults(variantResults);
        setGeneratedResultsStale(false);
        setGenerationError(null);
        toast.success('生地バリエーションを生成しました');
        return;
      }

      const requestState = { ...currentPrintStateRef.current };
      const nextRevision = requestState.revision;
      const nextSnapshot = await withTimeout(
        buildPrintRequestSnapshot({
          revision: nextRevision,
          brandId: currentBrand.id,
          brandName: currentBrand.name || 'brand',
          garmentUrl: printGarmentProcessed!,
          garmentReferenceType: printGarment?.referenceType ?? null,
          garmentMaskCandidateId: selectedPrintGarmentMaskCandidateId,
          garmentMaskRevision: printGarmentMaskRevision,
          ...(printableSurfaceEnabled && manualPrintableSurface
            ? { printableSurface: manualPrintableSurface }
            : {}),
          designs: placedPrintDesignLayers.map((layer) => ({
            id: layer.id,
            sourceUrl: layer.originalUrl,
            maskRevision: layer.maskRevision,
            transform: {
              x: layer.transform.x,
              y: layer.transform.y,
              scale: layer.transform.scale,
              rotation: layer.transform.rotation,
              opacity: layer.transform.opacity,
              flipX: layer.transform.flipX,
              flipY: layer.transform.flipY,
            },
          })),
          stageSize: printOutputStageSize,
        }),
        COMPOSITION_TIMEOUT_MS,
        'プリント構成の準備がタイムアウトしました。素材を確認して再試行してください',
      );
      if (
        !isCurrentRequest()
        || currentPrintStateRef.current.revision !== requestState.revision
        || currentPrintStateRef.current.signature !== requestState.signature
        || requestState.signature !== nextSnapshot.signature
      ) {
        return;
      }

      const generatedAt = Date.now();
      const runId = `print-${nextRevision}-${generatedAt}`;
      setProgressivePrintRun({
        runId,
        generatedAt,
        exact: { status: 'rendering', result: null, error: null },
        fabric: { status: 'rendering', result: null, error: null },
      });
      const exactCompositionPromise = settleComposition(withTimeout(
          renderPrintRequestComposition(nextSnapshot, 'exact'),
          COMPOSITION_TIMEOUT_MS,
          '配置そのままの描画がタイムアウトしました。素材を確認して再試行してください',
      ));
      const fabricCompositionPromise = settleComposition(withTimeout(
          renderPrintRequestComposition(nextSnapshot, 'fabric'),
          COMPOSITION_TIMEOUT_MS,
          '布になじませる描画がタイムアウトしました。素材を確認して再試行してください',
      ));
      const exactComposition = await exactCompositionPromise;
      if (
        !isCurrentRequest()
        ||
        currentPrintStateRef.current.revision !== requestState.revision
        || currentPrintStateRef.current.signature !== requestState.signature
      ) {
        return;
      }
      if (!exactComposition.ok) {
        setProgressivePrintRun((current) => current?.runId === runId
          ? {
            ...current,
            exact: { status: 'error', result: null, error: exactComposition.error.message },
            fabric: {
              status: 'error',
              result: null,
              error: '配置そのままの生成に失敗したため、このペアは確定されませんでした。',
            },
          }
          : current);
        throw exactComposition.error;
      }
      try {
        await waitForDisplayableImage(exactComposition.imageUrl);
      } catch (decodeError) {
        if (!isCurrentRequest()) return;
        const error = decodeError instanceof Error ? decodeError : new Error(String(decodeError));
        setProgressivePrintRun((current) => current?.runId === runId
          ? {
            ...current,
            exact: { status: 'error', result: null, error: error.message },
            fabric: {
              status: 'error',
              result: null,
              error: '配置そのままを表示できないため、このペアは確定されませんでした。',
            },
          }
          : current);
        throw error;
      }
      if (!isCurrentRequest()) return;
      const exactResult: WorkbenchResult = {
        id: `${runId}-exact`,
        brandId: currentBrand.id,
        runId,
        resultKind: 'exact',
        generatedAt,
        title: '配置そのまま',
        note: 'AI再描画なし / 元デザインの色・形・透明度を保持',
        imageUrl: exactComposition.imageUrl,
        outputSize: { ...printOutputStageSize },
      };
      setProgressivePrintRun((current) => current?.runId === runId
        ? { ...current, exact: { status: 'ready', result: exactResult, error: null } }
        : current);
      await waitForCommittedPaint();
      if (!isCurrentRequest()) return;
      const fabricComposition = await fabricCompositionPromise;
      if (!isCurrentRequest()) return;
      if (!fabricComposition.ok) {
        setProgressivePrintRun((current) => current?.runId === runId
          ? {
            ...current,
            fabric: { status: 'error', result: null, error: fabricComposition.error.message },
          }
          : current);
        throw fabricComposition.error;
      }
      try {
        await waitForDisplayableImage(fabricComposition.imageUrl);
      } catch (decodeError) {
        if (!isCurrentRequest()) return;
        const error = decodeError instanceof Error ? decodeError : new Error(String(decodeError));
        setProgressivePrintRun((current) => current?.runId === runId
          ? {
            ...current,
            fabric: { status: 'error', result: null, error: error.message },
          }
          : current);
        throw error;
      }
      if (!isCurrentRequest()) return;
      const fabricResult: WorkbenchResult = {
        id: `${runId}-fabric`,
        brandId: currentBrand.id,
        runId,
        resultKind: 'fabric',
        generatedAt,
        title: '布になじませる',
        note: '輪郭と透明度は固定 / Tシャツの明暗だけをデザインのRGBへ反映',
        imageUrl: fabricComposition.imageUrl,
        outputSize: { ...printOutputStageSize },
      };
      const nextResults: WorkbenchResult[] = [exactResult, fabricResult];
      setGeneratedResults((previous) => mergePrintResultHistory(
        nextResults,
        previous.filter((result) => result.id.startsWith('print-')),
      ));
      setProgressivePrintRun(null);
      setGeneratedResultsStale(false);
      setGenerationError(null);
      toast.success('2種類のプリント結果を作成しました');

      if (!printableSurfaceEnabled || !manualPrintableSurface) {
        setSurfaceConformStatus('手動の印刷可能面を有効にすると「布面追従（試験）」を追加できます。');
        return;
      }
      const surfaceJobId = surfaceJobSequenceRef.current + 1;
      surfaceJobSequenceRef.current = surfaceJobId;
      setPendingSurfaceJob({
        id: surfaceJobId,
        snapshot: nextSnapshot,
        revision: requestState.revision,
        signature: requestState.signature,
        inputSignature: requestSignature,
        exactId: nextResults[0].id,
        fabricId: nextResults[1].id,
        runId,
        brandId: currentBrand.id,
        generatedAt,
      });
    } catch (error: any) {
      console.error('Workbench generation failed', error);
      if (isCurrentRequest()) {
        const message = error?.message || '生成に失敗しました';
        setGenerationError(message);
        if (generatedResults.length > 0) setGeneratedResultsStale(true);
        toast.error(message);
      }
    } finally {
      if (generationRequestRef.current === requestId) {
        generationRequestRef.current = null;
        generationRequestSignatureRef.current = null;
        setIsGenerating(false);
      }
    }
  };

  const updateFabricPreset = (presetId: string) => {
    setFabricPresetIds((prev) =>
      prev.includes(presetId)
        ? prev.filter((id) => id !== presetId)
        : [...prev, presetId]
    );
  };

  const addDesigns = async (images: SelectedImage[]): Promise<{
    ok: true;
  } | {
    ok: false;
    reason: string;
  }> => {
    let inputPlan: ReturnType<typeof planPrintDesignInputUpdate<SelectedImage>>;
    try {
      inputPlan = planPrintDesignInputUpdate({
        previous: printDesigns,
        incoming: images,
        cutoutStates: printDesignCutoutStates,
      });
    } catch (error) {
      console.error('Print design input identity failed', error);
      toast.error('デザイン候補の識別に失敗しました。画像を選び直してください');
      return { ok: false, reason: 'input_identity_failed' };
    }
    const { nextImages } = inputPlan;
    const placementMembershipChanged = nextImages.length !== printDesigns.length
      || nextImages.some((design, index) => (
        printDesignIdentity(design) !== printDesignIdentity(printDesigns[index])
      ));
    if (placementMembershipChanged) {
      setPrintPlacementConfirmed(false);
      openPrintPlacementSession();
    }
    if (inputPlan.duplicateCount > 0) {
      toast(`同じデザインの重複を${inputPlan.duplicateCount}件まとめました`);
    }
    if (nextImages.length > 6) {
      toast.error('デザインは6つまでです');
      return { ok: false, reason: 'design_limit_exceeded' };
    }
    const duplicateSelection = selectFreshDuplicatePrintDesign({
      previous: printDesigns,
      incoming: images,
    });
    const duplicateTargetLayerId = duplicateSelection && printDesignReturnIntentRef.current
      ? getPrintDesignLayerId(duplicateSelection)
      : null;
    if (duplicateTargetLayerId) {
      printDesignReturnIntentRef.current = bindPrintDesignReturnIntent(
        printDesignReturnIntentRef.current,
        duplicateTargetLayerId,
      );
      printDesignReturnIntentRef.current = deferPrintDesignReturnIntent(
        printDesignReturnIntentRef.current,
        duplicateTargetLayerId,
      );
    } else if (images.length < printDesigns.length) {
      cancelScheduledPrintDesignReturn();
      printDesignReturnIntentRef.current = null;
    }
    if (!inputPlan.shouldRestartCutout) {
      if (duplicateTargetLayerId) {
        pendingActivePrintDesignLayerIdRef.current = null;
        userClearedSelectionRef.current = false;
        setActivePrintDesignLayerId(duplicateTargetLayerId);
        setSelectedLayerId(duplicateTargetLayerId);
      }
      prunePrintDesignIdentityMap(printDesignLayerIdsRef.current, nextImages);
      currentPrintDesignLayerIdsRef.current = nextImages.map(getPrintDesignLayerId);
      if (duplicateTargetLayerId) scheduleDeferredPrintDesignReturn(duplicateTargetLayerId);
      setPrintDesigns(nextImages);
      return { ok: true };
    }

    const newlyAddedIdentitySet = new Set(inputPlan.newlyAddedIdentities);
    const newlyAddedDesigns = nextImages.filter(
      (design) => newlyAddedIdentitySet.has(printDesignIdentity(design)),
    );
    const newlyAddedDesign = newlyAddedDesigns[newlyAddedDesigns.length - 1];
    let preferredLayerId = activePrintDesignLayerId;
    let nextActiveLayerId = activePrintDesignLayerId;
    let nextPendingLayerId = pendingActivePrintDesignLayerIdRef.current;
    let resetUserClearedSelection = false;
    if (duplicateTargetLayerId) {
      nextActiveLayerId = duplicateTargetLayerId;
      preferredLayerId = duplicateTargetLayerId;
      nextPendingLayerId = null;
      resetUserClearedSelection = true;
    } else if (newlyAddedDesign) {
      nextActiveLayerId = getPrintDesignLayerId(newlyAddedDesign);
      printDesignReturnIntentRef.current = bindPrintDesignReturnIntent(
        printDesignReturnIntentRef.current,
        nextActiveLayerId,
      );
      preferredLayerId = nextActiveLayerId;
      nextPendingLayerId = nextActiveLayerId;
      resetUserClearedSelection = true;
    } else if (
      !activePrintDesignLayerId
      || !nextImages.some((design) => getPrintDesignLayerId(design) === activePrintDesignLayerId)
    ) {
      const survivingLayerIds = new Set(nextImages.map(getPrintDesignLayerId));
      const survivingLayers = printDesignLayers
        .filter((layer) => survivingLayerIds.has(layer.id))
        .map((layer) => ({
          id: layer.id,
          kind: 'design' as const,
          ready: layer.cutoutState === 'done',
          processing: layer.cutoutState === 'processing',
        }));
      const readyFallbackLayerId = selectLatestReadyPrintDesignLayerId(survivingLayers);
      const processingFallbackLayerId = selectLatestProcessingPrintDesignLayerId(survivingLayers);
      const fallbackLayerId = readyFallbackLayerId ?? processingFallbackLayerId;
      preferredLayerId = fallbackLayerId;
      nextActiveLayerId = fallbackLayerId;
      nextPendingLayerId = readyFallbackLayerId
        ? null
        : processingFallbackLayerId;
      resetUserClearedSelection = true;
    }
    const nextLayerIds = nextImages.map(getPrintDesignLayerId);
    let reconciliation: ReturnType<typeof planPrintDesignCutoutReconciliation>;
    try {
      reconciliation = planPrintDesignCutoutReconciliation({
        previous: printDesigns.map((design, index) => ({
          layerId: getPrintDesignLayerId(design),
          state: printDesignCutoutStates[index] ?? 'processing',
          hasProcessedUrl: Boolean(printDesignProcessedUrls[index]),
          hasResult: Boolean(printDesignCutoutResults[index]),
        })),
        nextLayerIds,
        preferredLayerId,
      });
    } catch (error) {
      console.error('Print design identity reconciliation failed', error);
      toast.error('デザイン候補の識別に失敗しました。候補を選び直してください');
      return { ok: false, reason: 'identity_reconciliation_failed' };
    }
    prunePrintDesignIdentityMap(printDesignLayerIdsRef.current, nextImages);
    currentPrintDesignLayerIdsRef.current = nextLayerIds;
    pendingActivePrintDesignLayerIdRef.current = nextPendingLayerId;
    if (nextActiveLayerId !== activePrintDesignLayerId) {
      setActivePrintDesignLayerId(nextActiveLayerId);
    }
    if (resetUserClearedSelection) userClearedSelectionRef.current = false;
    setPrintDesigns(nextImages);
    setPrintMaskEditorTarget(null);
    const requestId = ++printDesignCutoutRequestRef.current;
    const initialStates: Record<number, CutoutState> = {};
    const processedUrls: Record<number, string> = {};
    const processedResults: Record<number, MaterialCutoutResult> = {};
    const initialMaskRevisions: Record<number, number> = {};
    reconciliation.reusablePreviousIndexByNextIndex.forEach((previousIndex, nextIndex) => {
      if (previousIndex === null) {
        initialStates[nextIndex] = 'processing';
        initialMaskRevisions[nextIndex] = 0;
        return;
      }
      initialStates[nextIndex] = 'done';
      processedUrls[nextIndex] = printDesignProcessedUrls[previousIndex];
      processedResults[nextIndex] = printDesignCutoutResults[previousIndex];
      initialMaskRevisions[nextIndex] = printDesignMaskRevisions[previousIndex] ?? 0;
    });
    setPrintDesignProcessedUrls({ ...processedUrls });
    setPrintDesignCutoutResults({ ...processedResults });
    setPrintDesignMaskRevisions(initialMaskRevisions);
    setPrintDesignCutoutStates(initialStates);
    setPrintDesignCutoutErrors({});
    if (duplicateTargetLayerId) scheduleDeferredPrintDesignReturn(duplicateTargetLayerId);

    for (const index of reconciliation.processOrder) {
      const design = nextImages[index];
      try {
        const result = await withTimeout(
          buildPrintDesignCutoutDataUrl({
            imageUrl: design.url,
            backgroundProfile: design.printDesignAssetPurpose === PRINT_DESIGN_ASSET_PURPOSE
              ? 'generated-near-white-v1'
              : 'strict',
          }),
          CUTOUT_TIMEOUT_MS,
          `デザイン${index + 1}の透明化がタイムアウトしました。元画像を確認して再試行してください`,
        );
        if (!canCommitPrintDesignCutoutRequest(requestId, printDesignCutoutRequestRef.current)) {
          return { ok: true };
        }
        setPrintDesignProcessedUrls((current) => ({ ...current, [index]: result.dataUrl }));
        setPrintDesignCutoutResults((current) => ({ ...current, [index]: result }));
        setPrintDesignCutoutStates((current) => ({ ...current, [index]: 'done' }));
      } catch (error) {
        if (!canCommitPrintDesignCutoutRequest(requestId, printDesignCutoutRequestRef.current)) {
          return { ok: true };
        }
        const message = error instanceof Error ? error.message : 'プリント画像の背景を透明化できませんでした';
        setPrintDesignCutoutStates((current) => ({ ...current, [index]: 'error' }));
        setPrintDesignCutoutErrors((current) => ({ ...current, [index]: message }));
        console.error('Print design cutout failed', { index, error });
      }
    }
    return { ok: true };
  };

  useEffect(() => {
    if (
      !isPrinting
      || !isAuthInitialized
      || isAuthLoading
      || !currentBrand?.id
      || printDesignHandoffConsumedRef.current
    ) return;
    const handoff = readPrintDesignHandoff(window.sessionStorage, currentBrand.id);
    if (handoff.status === 'rejected') {
      if (!handoff.ackToken) {
        console.error(`print_design_handoff_read_failed:${handoff.reason}`);
        return;
      }
      console.warn(`print_design_handoff_rejected:${handoff.reason}`);
      const ack = acknowledgePrintDesignHandoff(
        window.sessionStorage,
        handoff.ackToken,
        `rejected:${handoff.reason}`,
      );
      if (ack.ok) {
        printDesignHandoffConsumedRef.current = true;
      } else {
        console.error(`print_design_handoff_reject_ack_failed:${ack.reason}`);
      }
      return;
    }
    if (handoff.status !== 'accepted') return;
    if (isPrintDesignHandoffAlreadyImported(printDesigns, handoff)) {
      const ack = acknowledgePrintDesignHandoff(
        window.sessionStorage,
        handoff.ackToken,
        'import_committed',
      );
      if (ack.ok) {
        printDesignHandoffConsumedRef.current = true;
        printDesignHandoffImportingRef.current = null;
        toast.success('Patternsの生成結果をプリント画像に追加しました');
      } else {
        printDesignHandoffImportingRef.current = null;
        console.error(`print_design_handoff_ack_failed:${ack.reason}`);
        toast.error(`Patternsの引き継ぎ確認に失敗しました: ${ack.reason}`);
      }
      return;
    }
    if (printDesignHandoffImportingRef.current === handoff.ackToken) return;
    printDesignHandoffImportingRef.current = handoff.ackToken;
    const importedDesign: SelectedImage = {
      url: handoff.design.imageUrl,
      referenceType: 'pattern',
      printDesignAssetPurpose: PRINT_DESIGN_ASSET_PURPOSE,
    };
    void addDesigns([...printDesigns, importedDesign]).then((result) => {
      if (result.ok) return;
      printDesignHandoffImportingRef.current = null;
      console.error(`print_design_handoff_import_failed:${result.reason}`);
      toast.error(`Patternsの引き継ぎに失敗しました: ${result.reason}`);
    }).catch((error) => {
      printDesignHandoffImportingRef.current = null;
      const reason = error instanceof Error ? error.message : 'unknown_error';
      console.error(`print_design_handoff_import_failed:${reason}`, error);
      toast.error(`Patternsの引き継ぎに失敗しました: ${reason}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBrand?.id, isAuthInitialized, isAuthLoading, isPrinting, printDesigns]);

  const selectPrintGarment = (image: SelectedImage | null) => {
    cancelScheduledPrintDesignReturn();
    printDesignReturnIntentRef.current = null;
    invalidatePrintableSuggestion();
    setPrintPlacementConfirmed(false);
    if (placedPrintDesignLayers.length > 0) openPrintPlacementSession();
    setPrintGarmentCutoutSourceUrl(null);
    setPrintGarmentSelectionSource('automatic');
    setPrintGarmentMaskExplicitlyConfirmed(false);
    setPrintGarmentSegmentationTarget(DEFAULT_GARMENT_SEGMENTATION_TARGET);
    setPrintGarment(image);
  };

  const openGarmentMaskEditor = async () => {
    if (!printGarment) return;
    invalidatePrintableSuggestion();
    const capturedCandidateId = selectedPrintGarmentMaskCandidateIdRef.current;
    const capturedMaskRevision = printGarmentMaskRevisionRef.current;
    const capturedCutoutRequestId = printGarmentCutoutRequestRef.current;
    const selectedCandidate = printGarmentMaskCandidates.find((candidate) => candidate.candidateId === selectedPrintGarmentMaskCandidateId);
    const sourceUrl = printGarmentCutoutSourceUrl ?? printGarment.url;
    if (!selectedCandidate) {
      if (printGarmentCutoutState !== 'error') return;
      try {
        const fallbackResult = await buildManualMaskSourceResult(sourceUrl);
        if (!isCurrentGarmentMaskEditorTarget({
          capturedCandidateId,
          currentCandidateId: selectedPrintGarmentMaskCandidateIdRef.current,
          capturedMaskRevision,
          currentMaskRevision: printGarmentMaskRevisionRef.current,
          capturedCutoutRequestId,
          currentCutoutRequestId: printGarmentCutoutRequestRef.current,
        })) return;
        setPrintMaskEditorError(null);
        setPrintMaskEditorTarget({
          kind: 'garment',
          title: 'AI失敗後の手動マスク',
          description: 'AI透明化に失敗したため、元画像を全体マスクとして開いています。「消す」で背景や人物部分を除去し、「残す」で衣服を戻してから適用してください。',
          sourceUrl,
          maskUrl: sourceUrl,
          result: fallbackResult,
          capturedCandidateId,
          capturedGarmentMaskRevision: capturedMaskRevision,
          capturedGarmentCutoutRequestId: capturedCutoutRequestId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '元画像を手動マスクへ読み込めませんでした';
        setPrintMaskEditorError(message);
        toast.error('元画像を手動マスクへ読み込めませんでした');
      }
      return;
    }
    if (!printGarmentProcessed) return;
    setPrintMaskEditorError(null);
    setPrintMaskEditorTarget({
      kind: 'garment',
      title: '服の切り抜きマスクを調整',
      sourceUrl,
      maskUrl: printGarmentProcessed,
      result: selectedCandidate.result,
      capturedCandidateId,
      capturedGarmentMaskRevision: capturedMaskRevision,
      capturedGarmentCutoutRequestId: capturedCutoutRequestId,
    });
  };

  const applyGarmentSelection = (
    selectedImageUrl: string,
    selectionSource: Exclude<GarmentSelectionSource, 'automatic'>,
    segmentationTarget: GarmentSegmentationTarget,
  ) => {
    invalidatePrintableSuggestion();
    setPrintGarmentSelectionOpen(false);
    setPrintGarmentCutoutSourceUrl(selectedImageUrl);
    setPrintGarmentSelectionSource(selectionSource);
    setPrintGarmentMaskExplicitlyConfirmed(selectionSource === 'tap');
    setPrintGarmentSegmentationTarget(segmentationTarget);
    setPrintGarmentCutoutState('processing');
    setPrintGarmentCutoutError(null);
    setPrintGarmentProcessed(null);
    setPrintMaskEditorTarget(null);
    toast.success(selectionSource === 'tap'
      ? '確認した青いタップマスクを適用しています'
      : '選択範囲をAIマスクへ渡しました');
  };

  const confirmProcessedGarmentMask = () => {
    if (!canExplicitlyConfirmProcessedGarmentMask({
      selectionSource: printGarmentSelectionSource,
      cutoutDone: printGarmentCutoutState === 'done',
      hasProcessedMask: Boolean(printGarmentProcessed),
    })) return;
    invalidatePrintableSuggestion();
    setPrintGarmentMaskExplicitlyConfirmed(true);
    toast.success('青いAIマスクを確定しました');
  };

  const openPrintableSurfaceEditor = async () => {
    if (!printGarmentProcessed) return;
    invalidatePrintableSuggestion();
    const editorRequestId = printableSuggestionRequestRef.current;
    const editorOperationId = printableSurfaceEditorOperationRef.current;
    const selectedCandidate = printGarmentMaskCandidates.find((candidate) => candidate.candidateId === selectedPrintGarmentMaskCandidateId);
    if (!selectedCandidate) return;
    setPrintMaskEditorError(null);
    const capturedCandidateId = selectedPrintGarmentMaskCandidateId;
    const capturedGarmentMaskRevision = printGarmentMaskRevision;
    const capturedGarmentUrl = printGarmentProcessed;
    try {
      const identityProbe = await buildEncodedManualPrintableSurface({
        garmentUrl: capturedGarmentUrl,
        editedMaskUrl: capturedGarmentUrl,
        manualRevision: printableSurfaceRevisionRef.current,
      });
      if (
        printableSuggestionRequestRef.current !== editorRequestId
        || !canCommitPrintableSurfaceEditorOperation(editorOperationId, printableSurfaceEditorOperationRef.current)
        ||
        printGarmentProcessedRef.current !== capturedGarmentUrl
        || selectedPrintGarmentMaskCandidateIdRef.current !== capturedCandidateId
        || printGarmentMaskRevisionRef.current !== capturedGarmentMaskRevision
      ) {
        throw new Error('PRINTABLE_SURFACE_STALE_TARGET');
      }
      const outputSize = selectedCandidate.result.outputSize;
      setPrintMaskEditorTarget({
        kind: 'printable-area',
        title: '印刷可能面を手動で指定',
        sourceUrl: capturedGarmentUrl,
        maskUrl: manualPrintableSurface?.plane.dataUrl ?? capturedGarmentUrl,
        result: {
          ...selectedCandidate.result,
          bounds: { x: 0, y: 0, width: outputSize.width, height: outputSize.height },
          sourceSize: outputSize,
          outputSize,
        },
        capturedCandidateId,
        capturedGarmentMaskRevision,
        capturedSourceHash: identityProbe.identity.sourceHash,
        capturedGarmentCutoutRequestId: printGarmentCutoutRequestRef.current,
      });
    } catch (error) {
      if (
        printableSuggestionRequestRef.current !== editorRequestId
        || !canCommitPrintableSurfaceEditorOperation(editorOperationId, printableSurfaceEditorOperationRef.current)
      ) return;
      const message = error instanceof Error ? error.message : '印刷可能面の編集を開始できませんでした';
      setPrintMaskEditorError(message);
      toast.error(message);
    }
  };

  const openSuggestedPrintableSurfaceEditor = async () => {
    if (!printGarmentProcessed) return;
    const selectedCandidate = printGarmentMaskCandidates.find((candidate) => candidate.candidateId === selectedPrintGarmentMaskCandidateId);
    if (!selectedCandidate) return;

    const requestId = ++printableSuggestionRequestRef.current;
    const editorOperationId = ++printableSurfaceEditorOperationRef.current;
    const capturedSize = { ...selectedCandidate.result.outputSize };
    const captured: PrintableSuggestionCommitToken = {
      requestId,
      garmentUrl: printGarmentProcessed,
      candidateId: selectedPrintGarmentMaskCandidateId,
      garmentMaskRevision: printGarmentMaskRevision,
      cutoutRequestId: printGarmentCutoutRequestRef.current,
      outputWidth: capturedSize.width,
      outputHeight: capturedSize.height,
    };
    const currentToken = (): PrintableSuggestionCommitToken => ({
      requestId: printableSuggestionRequestRef.current,
      garmentUrl: printGarmentProcessedRef.current ?? '',
      candidateId: selectedPrintGarmentMaskCandidateIdRef.current,
      garmentMaskRevision: printGarmentMaskRevisionRef.current,
      cutoutRequestId: printGarmentCutoutRequestRef.current,
      outputWidth: selectedPrintGarmentOutputSizeRef.current?.width ?? 0,
      outputHeight: selectedPrintGarmentOutputSizeRef.current?.height ?? 0,
    });

    setPrintableSuggestionPending(true);
    setPrintableSuggestionStatus(null);
    setPrintMaskEditorError(null);
    try {
      const suggestion = await suggestPrintableSurfaceDataUrl({
        garmentUrl: captured.garmentUrl,
        expectedSize: capturedSize,
        maxDataUrlBytes: PRINT_CUTOUT_MAX_DATA_URL_BYTES,
        sourceAlphaAlreadyRefined: captured.candidateId === 'refined',
      });
      if (
        !canCommitPrintableSuggestion(captured, currentToken())
        || !canCommitPrintableSurfaceEditorOperation(editorOperationId, printableSurfaceEditorOperationRef.current)
      ) return;
      if (suggestion.kind === 'fallback-required') {
        const message = printableSuggestionStatusMessage(suggestion.reason);
        setPrintableSuggestionStatus(message);
        toast.error(message);
        return;
      }
      const identityProbe = await buildEncodedManualPrintableSurface({
        garmentUrl: captured.garmentUrl,
        editedMaskUrl: suggestion.dataUrl,
        manualRevision: printableSurfaceRevisionRef.current,
      });
      if (
        !canCommitPrintableSuggestion(captured, currentToken())
        || !canCommitPrintableSurfaceEditorOperation(editorOperationId, printableSurfaceEditorOperationRef.current)
      ) return;
      setPrintMaskEditorTarget({
        kind: 'printable-area',
        title: '印刷可能面の候補を確認・修正',
        description: '元画像の解像度で輪郭を再計算し、襟・袖・裾を避けた中央前身頃の服表面マップ候補です。AI分割モデルの確定結果ではないため、右側の「残す」「消す」ブラシで必ず確認・修正してから保存してください。',
        sourceUrl: captured.garmentUrl,
        maskUrl: suggestion.dataUrl,
        result: {
          ...selectedCandidate.result,
          bounds: { x: 0, y: 0, width: suggestion.width, height: suggestion.height },
          sourceSize: capturedSize,
          outputSize: capturedSize,
        },
        capturedCandidateId: captured.candidateId as PrintGarmentMaskCandidateId,
        capturedGarmentMaskRevision: captured.garmentMaskRevision,
        capturedSourceHash: identityProbe.identity.sourceHash,
        capturedGarmentCutoutRequestId: captured.cutoutRequestId,
      });
      setPrintableSuggestionStatus(`服表面マップ候補を作成しました（信頼度 ${Math.round(suggestion.diagnostics.confidence * 100)}%）。ブラシで確認・修正し、「印刷可能面を保存」を押すまで反映されません。`);
    } catch (error) {
      if (
        !canCommitPrintableSuggestion(captured, currentToken())
        || !canCommitPrintableSurfaceEditorOperation(editorOperationId, printableSurfaceEditorOperationRef.current)
      ) return;
      const message = error instanceof Error ? error.message : '印刷面の候補を作成できませんでした';
      setPrintableSuggestionStatus(message);
      toast.error(message);
    } finally {
      if (printableSuggestionRequestRef.current === requestId) {
        setPrintableSuggestionPending(false);
      }
    }
  };

  const openDesignMaskEditor = (index: number) => {
    const design = printDesigns[index];
    const result = printDesignCutoutResults[index];
    const maskUrl = printDesignProcessedUrls[index];
    if (!design || !result || !maskUrl) return;
    invalidatePrintableSuggestion();
    setPrintMaskEditorError(null);
    setPrintMaskEditorTarget({
      kind: 'design',
      capturedDesignLayerId: getPrintDesignLayerId(design),
      title: `デザイン ${index + 1} のマスクを調整`,
      sourceUrl: design.url,
      maskUrl,
      result,
    });
  };

  const applyEditedPrintMask = async (dataUrl: string, outputSize: { width: number; height: number }) => {
    const target = printMaskEditorTarget;
    if (!target) return;
    if (target.kind === 'printable-area') {
      const applyOperationId = ++printableSurfaceEditorOperationRef.current;
      const currentGarmentUrl = printGarmentProcessedRef.current;
      if (
        !currentGarmentUrl
        || target.capturedCandidateId !== selectedPrintGarmentMaskCandidateIdRef.current
        || target.capturedGarmentMaskRevision !== printGarmentMaskRevisionRef.current
        || outputSize.width !== target.result.outputSize.width
        || outputSize.height !== target.result.outputSize.height
      ) {
        setPrintMaskEditorError('PRINTABLE_SURFACE_STALE_TARGET');
        toast.error('服の状態が変わったため、印刷可能面をもう一度開いてください');
        return;
      }
      try {
        const nextRevision = printableSurfaceRevisionRef.current + 1;
        const surface = await buildEncodedManualPrintableSurface({
          garmentUrl: currentGarmentUrl,
          editedMaskUrl: dataUrl,
          manualRevision: nextRevision,
        });
        if (!canCommitPrintableSurfaceEditorOperation(applyOperationId, printableSurfaceEditorOperationRef.current)) return;
        if (surface.identity.sourceHash !== target.capturedSourceHash) {
          throw new Error('PRINTABLE_SURFACE_STALE_TARGET');
        }
        const stageMaskUrl = await buildPrintableSurfaceStageMaskDataUrl({
          surface,
          garmentUrl: currentGarmentUrl,
          stageSize: printPreviewStageSize,
        });
        if (
          !canCommitPrintableSurfaceEditorOperation(applyOperationId, printableSurfaceEditorOperationRef.current)
          ||
          printGarmentProcessedRef.current !== currentGarmentUrl
          || target.capturedGarmentCutoutRequestId !== printGarmentCutoutRequestRef.current
          || target.capturedCandidateId !== selectedPrintGarmentMaskCandidateIdRef.current
          || target.capturedGarmentMaskRevision !== printGarmentMaskRevisionRef.current
        ) {
          throw new Error('PRINTABLE_SURFACE_STALE_TARGET');
        }
        printableSurfaceRevisionRef.current = nextRevision;
        manualPrintableSurfaceRef.current = surface;
        setManualPrintableSurface(surface);
        setPrintableSurfaceStageMaskUrl(stageMaskUrl);
        setPrintableSurfaceEnabled(false);
        setPrintableSurfaceResetNotice(null);
        setPrintMaskEditorTarget(null);
        setPrintMaskEditorError(null);
        printableSurfaceEditorOperationRef.current += 1;
        toast.success('手動の印刷可能面を保存しました。使用するには切り抜きを有効にしてください');
      } catch (error) {
        if (!canCommitPrintableSurfaceEditorOperation(applyOperationId, printableSurfaceEditorOperationRef.current)) return;
        const message = error instanceof Error ? error.message : '印刷可能面を保存できませんでした';
        setPrintMaskEditorError(message);
        toast.error(message);
      }
      return;
    }
    if (target.kind === 'garment') {
      invalidatePrintableSuggestion();
      if (!isCurrentGarmentMaskEditorTarget({
        capturedCandidateId: target.capturedCandidateId,
        currentCandidateId: selectedPrintGarmentMaskCandidateIdRef.current,
        capturedMaskRevision: target.capturedGarmentMaskRevision,
        currentMaskRevision: printGarmentMaskRevisionRef.current,
        capturedCutoutRequestId: target.capturedGarmentCutoutRequestId,
        currentCutoutRequestId: printGarmentCutoutRequestRef.current,
      })) {
        setPrintMaskEditorError('GARMENT_MASK_EDITOR_STALE_TARGET');
        toast.error('服の状態が変わったため、マスクをもう一度開いてください');
        return;
      }
      if (isOversizedManualPrintMask(dataUrl)) {
        setPrintMaskEditorError('手動補正データが保存上限を超えました。自動縮小して再適用してください。');
        toast.error('手動補正データが保存上限を超えました');
        return;
      }
      const manualResult = withManualPrintMaskResult(target.result, dataUrl, outputSize);
      setPrintGarmentProcessed(dataUrl);
      setPrintGarmentCutoutState('done');
      setPrintGarmentMaskCandidates((current) => [
        ...current.filter((candidate) => candidate.candidateId !== 'manual'),
        {
          candidateId: 'manual',
          label: '手動補正',
          description: '残す／消すブラシで補正したマスクです',
          result: manualResult,
        },
      ]);
      setSelectedPrintGarmentMaskCandidateId('manual');
      setPrintGarmentMaskExplicitlyConfirmed(true);
      setPrintGarmentMaskRevision((current) => current + 1);
      clearManualPrintableSurface('服の輪郭を補正したため、手動の印刷可能面をリセットしました。');
      setPrintMaskEditorError(null);
    } else if (target.kind === 'design' && target.capturedDesignLayerId) {
      let index: number | null;
      try {
        index = resolvePrintDesignMaskEditorIndex(
          currentPrintDesignLayerIdsRef.current,
          target.capturedDesignLayerId,
        );
      } catch (error) {
        console.error('Print design mask editor identity failed', error);
        index = null;
      }
      if (index === null) {
        setPrintMaskEditorError('DESIGN_MASK_EDITOR_STALE_TARGET');
        toast.error('デザイン候補が変わったため、マスクをもう一度開いてください');
        return;
      }
      setPrintDesignProcessedUrls((current) => ({ ...current, [index]: dataUrl }));
      setPrintDesignCutoutResults((current) => ({
        ...current,
        [index]: withManualPrintMaskResult(target.result, dataUrl, outputSize),
      }));
      setPrintDesignMaskRevisions((current) => ({ ...current, [index]: (current[index] ?? 0) + 1 }));
    }
    setPrintMaskEditorTarget(null);
    setPrintMaskEditorError(null);
    toast.success('マスク補正をステージへ反映しました');
  };

  const fabricStageBackground = fabricBase?.url
    ? `url(${fabricBase.url})`
    : 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(59,130,246,0.15), rgba(15,23,42,0.8))';

  const printStageBackground = 'linear-gradient(180deg, rgba(248,250,252,0.08), rgba(148,163,184,0.10))';

  const openFavoriteDialog = (result: WorkbenchResult) => {
    if (!currentBrand?.id || result.brandId !== currentBrand.id) {
      toast.error('素材またはブランド変更前の結果は保存できません。現在の内容で再生成してください');
      return;
    }
    setFavoriteTargetResult(result);
    setFavoriteTargetBrandId(result.brandId);
    setFavoriteSpace('personal');
    setFavoriteDestination('パーソナルスペース');
    setIsCreatingFavoriteGroup(false);
    setFavoriteGroupName('');
  };

  const closeFavoriteDialog = () => {
    if (favoriteSaving) return;
    setFavoriteTargetResult(null);
    setFavoriteTargetBrandId(null);
    setIsCreatingFavoriteGroup(false);
    setFavoriteGroupName('');
  };

  const handleSaveFavorite = () => {
    if (!favoriteTargetResult
      || !favoriteTargetBrandId
      || !currentBrand?.id
      || favoriteTargetBrandId !== currentBrand.id
      || favoriteTargetResult.brandId !== favoriteTargetBrandId
      || favoriteSpace !== 'personal') return;
    const destinationLabel = isCreatingFavoriteGroup
      ? favoriteGroupName.trim()
      : favoriteDestination;
    if (!destinationLabel) return;

    setFavoriteSaving(true);
    const saved = savePrintResultFavorite({
      brandId: favoriteTargetBrandId,
      result: favoriteTargetResult,
      destinationLabel,
    });
    setFavoriteSaving(false);

    if (!saved.ok) {
      toast.error('この端末に保存できませんでした。空き容量を確認して、もう一度お試しください');
      return;
    }
    setFavoriteTargetResult(null);
    setFavoriteTargetBrandId(null);
    setIsCreatingFavoriteGroup(false);
    setFavoriteGroupName('');
    setFavoriteRevision((current) => current + 1);
    toast.success(`「${destinationLabel}」へお気に入り保存しました`);
  };

  const favoriteResultIds = useMemo(
    () => {
      void favoriteRevision;
      return new Set(currentBrand?.id ? listPrintResultFavoriteIds(currentBrand.id) : []);
    },
    [currentBrand?.id, favoriteRevision],
  );

  const closeDeletedResultSurfaces = (deletedIds: ReadonlySet<string>) => {
    setSelectedResult((current) => current && deletedIds.has(current.id) ? null : current);
    setFavoriteTargetResult((current) => current && deletedIds.has(current.id) ? null : current);
    setFavoriteTargetBrandId((current) => favoriteTargetResult && deletedIds.has(favoriteTargetResult.id)
      ? null
      : current);
    setShowResultComparison(false);
  };

  const deletePrintResultRun = (result: WorkbenchResult) => {
    const runId = result.runId?.trim();
    if (!runId) return;
    const deletedIds = new Set(generatedResults
      .filter((candidate) => candidate.runId?.trim() === runId)
      .map((candidate) => candidate.id));
    if (deletedIds.size === 0) return;
    if (pendingSurfaceJob?.runId === runId) {
      surfaceJobSequenceRef.current += 1;
      setPendingSurfaceJob(null);
      setSurfaceConformStatus(null);
    }
    setGeneratedResults((current) => removePrintResultRun(current, runId));
    closeDeletedResultSurfaces(deletedIds);
    if (printResultRuns.length <= 1) setGeneratedResultsStale(false);
    toast.success('生成履歴を1件削除しました');
  };

  const clearPrintResultHistory = () => {
    const completedRunIds = new Set(printResultRuns.map((run) => run.runId));
    if (completedRunIds.size === 0) return;
    const deletedIds = new Set(generatedResults
      .filter((result) => result.runId && completedRunIds.has(result.runId.trim()))
      .map((result) => result.id));
    if (pendingSurfaceJob && completedRunIds.has(pendingSurfaceJob.runId)) {
      surfaceJobSequenceRef.current += 1;
      setPendingSurfaceJob(null);
      setSurfaceConformStatus(null);
    }
    setGeneratedResults((current) => removePrintResultRuns(current, completedRunIds));
    setGeneratedResultsStale(false);
    closeDeletedResultSurfaces(deletedIds);
    toast.success('プリント生成履歴をすべて削除しました');
  };

  const returnToPrintDesignSelection = () => {
    const selector = printDesignSelectorRef.current;
    if (!selector) return;
    cancelScheduledPrintDesignReturn();
    printDesignReturnIntentRef.current = armPrintDesignReturnIntent();
    selector.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' });
    const focusTarget = selector.querySelector<HTMLButtonElement>('button[aria-label="ギャラリーから画像を選択"]')
      ?? selector.querySelector<HTMLButtonElement>('button[aria-label^="デザイン "]:not([disabled])')
      ?? selector;
    focusTarget.focus({ preventScroll: true });
  };

  const printingReadinessSteps = isPrinting ? [
    {
      id: 'brand',
      label: 'ブランド',
      complete: Boolean(currentBrand?.id),
      detail: currentBrand ? `${currentBrand.name || 'ブランド'}を選択済み` : '保存先ブランドを選択',
    },
    {
      id: 'garment',
      label: '参考画像',
      complete: Boolean(printGarmentProcessed && printGarmentCutoutState === 'done'),
      detail: printGarmentProcessed && printGarmentCutoutState === 'done'
        ? '服の画像を確認済み'
        : printGarment ? '服を切り抜いて認識範囲を確認' : '参考画像または無地Tシャツを追加',
    },
    {
      id: 'design',
      label: 'デザイン',
      complete: printDesignsReady,
      detail: printDesignsReady
        ? `${placedPrintDesignLayers.length}件のデザインを確認済み`
        : printDesignsProcessing
          ? 'デザインの透明化が完了するまで待機'
          : printDesignsErrored
            ? '透明化に失敗したデザインを削除または再選択'
            : printDesignLayers.length > 0
              ? 'デザインの表示準備を完了してください'
              : 'デザイン画像を追加',
    },
    {
      id: 'mask',
      label: '認識範囲',
      complete: hasConfirmedPrintGarmentMask,
      detail: hasConfirmedPrintGarmentMask ? '青い認識範囲を確定済み' : '青い認識範囲を確認して確定',
    },
    {
      id: 'placement',
      label: '配置',
      complete: printPlacementConfirmed && !printPlacementSessionOpen,
      detail: printPlacementConfirmed && !printPlacementSessionOpen ? 'デザイン配置を決定済み' : '配置を開いて決定',
    },
  ] : [];
  const printingReadinessCompleteCount = printingReadinessSteps.filter((step) => step.complete).length;
  const printingNextAction = !currentBrand?.id
    ? 'ブランドを選択してください'
    : !printGarment
      ? '参考画像を追加してください'
      : printGarmentCutoutState === 'processing'
        ? '服の認識範囲を作成中です'
          : (!printGarmentProcessed || printGarmentCutoutState !== 'done')
            ? '服を選択してAIマスクを確認してください'
          : printDesignLayers.length === 0
            ? 'デザイン画像を追加してください'
            : !printDesignsReady
              ? printDesignsProcessing
                ? 'デザインの透明化完了を待ってください'
                : printDesignsErrored
                  ? '透明化に失敗したデザインを削除または再選択してください'
                  : 'デザインの表示準備を完了してください'
            : !hasConfirmedPrintGarmentMask
              ? '青い認識範囲を確認して確定してください'
              : (!printPlacementConfirmed || printPlacementSessionOpen)
                ? '配置を開いて「決定」を押してください'
                : '生成できます';

  return (
    <div className={`${isPrinting ? 'max-w-[1600px]' : 'max-w-7xl'} mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8`}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            onClick={() => navigate('/generate')}
            className="mb-3 inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            <ArrowLeft className="w-4 h-4" />
            生成一覧へ
          </button>
          <h1 className="text-2xl font-display font-semibold text-neutral-900 dark:text-white">
            {isPrinting ? 'プリントイメージ' : '生地イメージ'}
          </h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {isPrinting
              ? '参考画像とデザインを高精度マスクで透明合成し、元の色・形・配置を保ちます。'
              : '生地画像にデザインを重ね、色味の違う複数生地をまとめて確認できます。'}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 p-1 backdrop-blur-md">
          <button
            onClick={() => navigate('/lightchain/fabric-image')}
            className={`rounded-full px-4 py-2 text-sm transition-all ${!isPrinting ? 'bg-primary-500 text-white shadow-lg' : 'text-neutral-300 hover:text-white'}`}
          >
            生地イメージ
          </button>
          <button
            onClick={() => navigate('/lightchain/printing-image')}
            className={`rounded-full px-4 py-2 text-sm transition-all ${isPrinting ? 'bg-primary-500 text-white shadow-lg' : 'text-neutral-300 hover:text-white'}`}
          >
            プリントイメージ
          </button>
        </div>
      </div>

      <div className={`grid gap-6 ${isPrinting
        ? 'xl:grid-cols-[360px_minmax(0,1fr)]'
        : 'xl:grid-cols-[420px_1fr]'}`}>
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          data-testid={isPrinting ? 'printing-control-rail' : undefined}
          className={`space-y-5 rounded-3xl border border-white/10 bg-neutral-950/70 p-5 text-white shadow-2xl shadow-black/20 backdrop-blur-xl ${isPrinting
            ? 'xl:sticky xl:top-[86px] xl:flex xl:max-h-[calc(100dvh-102px)] xl:self-start xl:flex-col xl:overflow-hidden'
            : ''}`}
        >
          <div
            data-testid={isPrinting ? 'printing-control-rail-details' : undefined}
            role={isPrinting ? 'region' : undefined}
            aria-label={isPrinting ? 'プリント素材と詳細設定' : undefined}
            className={`space-y-5 ${isPrinting
              ? 'xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain xl:pr-1 xl:[scrollbar-gutter:stable]'
              : ''}`}
          >
          {isPrinting && (
            <section
              data-testid="printing-readiness-summary"
              aria-label="プリント生成前の準備状況"
              className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/75">生成前の準備</p>
                  <p className="mt-1 text-sm font-semibold text-white">入力 → マスク → 配置 → 生成</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-cyan-100/65">Lightchainの入口と同じ順番で、未完了の手順を一つにまとめています。</p>
                </div>
                <span
                  data-testid="printing-readiness-count"
                  className="shrink-0 rounded-full border border-cyan-200/30 bg-cyan-200/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-50"
                >
                  {printingReadinessCompleteCount}/{printingReadinessSteps.length} 完了
                </span>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {printingReadinessSteps.map((step, index) => (
                  <div
                    key={step.id}
                    className={`flex items-start gap-2 rounded-xl border px-2.5 py-2 ${step.complete ? 'border-emerald-300/25 bg-emerald-300/[0.08]' : 'border-white/10 bg-black/15'}`}
                  >
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${step.complete ? 'bg-emerald-300 text-emerald-950' : 'border border-white/20 text-white/55'}`}>
                      {step.complete ? <Check className="h-3 w-3" /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-xs font-semibold text-white">
                        {step.label}
                        <span className={step.complete ? 'text-emerald-200' : 'text-white/45'}>{step.complete ? '完了' : '未完了'}</span>
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-white/55">{step.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p data-testid="printing-next-action" role="status" className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-relaxed text-cyan-50">
                次の操作: <span className="font-semibold">{printingNextAction}</span>
              </p>
            </section>
          )}

          <div className="flex items-start gap-3">
            <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/20 text-primary-200">
              {isPrinting ? <Scissors className="h-5 w-5" /> : <Layers3 className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{isPrinting ? 'プリント画像を積み上げる' : '生地の上に重ねる'}</h2>
              <p className="text-sm text-white/60">
                {isPrinting ? '服や参考画像を切り抜いて、デザインを自由に置けます。' : '素材を選び、質感違いの見本をまとめて出せます。'}
              </p>
            </div>
          </div>

          {!isPrinting ? (
            <div className="space-y-4">
              <ImageSelector
                label="生地画像"
                required
                value={fabricBase}
                onChange={setFabricBase}
                allowedReferenceTypes={['base']}
                defaultReferenceType="base"
                hint="土台となる生地の写真を入れます"
              />
              <ImageSelector
                label="デザイン画像"
                required
                value={fabricDesign}
                onChange={setFabricDesign}
                allowedReferenceTypes={['base', 'pattern']}
                defaultReferenceType="base"
                hint="柄やロゴをそのまま重ねるか、切り抜いて重ねます"
              />
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">生地バリエーション</p>
                    <p className="text-xs text-white/50">出したい生地だけを選んで生成します。</p>
                  </div>
                  <Sparkles className="h-4 w-4 text-primary-200" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {fabricVariants.map((variant) => (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => updateFabricPreset(variant.id)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-all ${fabricPresetIds.includes(variant.id) ? 'border-primary-400 bg-primary-500/20 text-white' : 'border-white/10 bg-white/5 text-white/70 hover:text-white'}`}
                    >
                      {variant.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => selectPrintGarment(createTrustedBlankGarmentSelection())}
                className="flex w-full items-center gap-3 rounded-2xl border border-cyan-300/35 bg-gradient-to-r from-cyan-300/15 to-blue-400/10 p-3 text-left text-cyan-50 transition hover:border-cyan-200/60 hover:from-cyan-300/20 hover:to-blue-400/15"
                data-testid="use-trusted-blank-garment"
              >
                <img
                  src="/assets/printing/blank-white-tshirt.svg"
                  alt="無地の白いTシャツ"
                  className="h-16 w-14 rounded-lg border border-white/15 bg-slate-200 object-cover"
                />
                <span>
                  <span className="block text-sm font-semibold">無地Tシャツを使う（推奨）</span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-cyan-100/65">装飾のない同梱素材です。ギャラリーやアップロードも引き続き選べます。</span>
                </span>
              </button>
              <ImageSelector
                label="参考画像をアップロードしてください"
                required
                value={printGarment}
                galleryTitle="参考画像を選択"
                confirmGallerySelection
                galleryConfirmLabel="素材を追加"
                selectionTestId="print-garment-selector"
                onChange={selectPrintGarment}
                allowedReferenceTypes={['base']}
                defaultReferenceType="base"
                hint="服・Tシャツ・パーカーなどの参考画像を入れます"
                processing={printGarmentCutoutState === 'processing'}
                hideSelectedPreviewWhileProcessing
                previewUrl={printGarmentCutoutState === 'done' ? printGarmentProcessed : null}
                processingLabel="服を切り抜き中"
              />
              {printGarment && (
                <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
                  <button
                    type="button"
                    onClick={() => setPrintGarmentSelectionOpen(true)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-200/30 bg-cyan-200/15 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-200/20"
                  >
                    <Scissors className="h-4 w-4" />
                    {printGarmentCutoutSourceUrl ? '服の選択をやり直してAIマスク' : '服をタップしてAIマスク'}
                  </button>
                  <p className="mt-2 text-[11px] leading-relaxed text-cyan-100/65">
                    {printGarmentCutoutSourceUrl
                      ? printGarmentCutoutState === 'processing'
                        ? '選択範囲からAIマスクを作成中です。自動候補へ戻すには別の画像を選び直してください。'
                        : printGarmentCutoutState === 'error'
                          ? '選択範囲のAIマスクに失敗しました。範囲を少し広げるか、範囲調整へ切り替えて再試行してください。'
                          : '選択範囲からAIマスクを作成しました。自動候補へ戻すには別の画像を選び直してください。'
                      : '服をタップすると、その服の候補範囲だけをAI切り抜きへ渡せます。細かい指定は範囲調整へ切り替えます。'}
                  </p>
                  {printGarmentCutoutState === 'done' && hasConfirmedPrintGarmentMask && (
                    <div role="status" className="mt-3 rounded-lg border border-blue-300/30 bg-blue-950/35 px-3 py-2 text-[11px] leading-relaxed text-blue-50">
                      <div className="flex items-center gap-2 font-semibold">
                        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm border border-cyan-100 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.75)]" />
                        認識範囲を確定済み
                      </div>
                      <p className="mt-1 text-blue-100/75">確定した服の内側だけにデザインを適用します。必要なら「服の選択をやり直す」で再確認できます。</p>
                      <p className="mt-1 text-blue-100/75">
                        {selectedPrintGarmentMaskCandidateId === 'manual'
                          ? '残す／消すブラシで補正した手動マスクを確定面として使用します。'
                          : printGarmentSegmentationStatus.message}
                      </p>
                    </div>
                  )}
                  {printGarmentCutoutState === 'done' && !hasConfirmedPrintGarmentMask && (
                    <div role="status" className="mt-3 rounded-lg border border-amber-300/30 bg-amber-950/30 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
                      {printGarmentSelectionSource !== 'automatic'
                        ? '選択したAIマスクはまだ未確定です。下の青い認識範囲を確認し、「このAIマスクで確定」を押すまでデザインは適用されません。'
                        : '自動切り抜きはまだ未確定です。服をタップして青い認識範囲を確認し、「決定」を押すまでデザインは適用されません。'}
                    </div>
                  )}
                </div>
              )}
              {printGarmentCutoutState === 'error' && (
                <div className="space-y-2">
                  <p className="text-xs text-red-300">{printGarmentCutoutError || '背景を分離できませんでした。透明背景または白背景の服画像で再試行してください。'}</p>
                  <button
                    type="button"
                    onClick={() => { void openGarmentMaskEditor(); }}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200/30 bg-amber-200/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-200/15"
                  >
                    AI失敗時に手動マスクを使う
                  </button>
                </div>
              )}
              {printGarmentCutoutState === 'done' && (
                <div className="space-y-2">
                  <PrintMaskCandidatePicker
                    candidates={printGarmentMaskCandidates}
                    selectedCandidateId={selectedPrintGarmentMaskCandidateId}
                    onSelect={selectPrintGarmentMaskCandidate}
                  />
                  <button
                    type="button"
                    onClick={openGarmentMaskEditor}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
                  >
                    <Scissors className="h-4 w-4" />
                    服の輪郭を手動で調整
                  </button>
                  <div className="space-y-2 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] p-3">
                    <button
                      type="button"
                      disabled={printableSuggestionPending}
                      onClick={() => { void openSuggestedPrintableSurfaceEditor(); }}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200/30 bg-emerald-200/15 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-200/20 disabled:cursor-wait disabled:opacity-50"
                    >
                      <Sparkles className="h-4 w-4" />
                      {printableSuggestionPending ? '印刷面の候補を作成中…' : '印刷面の候補を作る（試験）'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { void openPrintableSurfaceEditor(); }}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-300/15"
                    >
                      <Scissors className="h-4 w-4" />
                      {manualPrintableSurface ? '印刷可能面を再調整' : '印刷可能面を手動で指定'}
                    </button>
                    <label className="flex items-center justify-between gap-3 text-xs text-white/75">
                      <span>
                        この面でデザインを切り抜く
                        <span className="mt-0.5 block text-[10px] text-white/45">自動認識ではなく、ブラシで指定した範囲です。</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={printableSurfaceEnabled}
                        disabled={!manualPrintableSurface || !printableSurfaceStageMaskUrl}
                        onChange={(event) => {
                          setPrintableSurfaceEnabled(event.target.checked);
                          setPrintableSurfaceResetNotice(null);
                        }}
                        aria-label="手動の印刷可能面でデザインを切り抜く"
                        className="h-4 w-4 accent-emerald-400 disabled:opacity-40"
                      />
                    </label>
                    {manualPrintableSurface ? (
                      <div className="flex items-center justify-between gap-3 text-[11px]">
                        <span className="text-emerald-200">手動指定済み / revision {manualPrintableSurface.identity.manualRevision}</span>
                        <button
                          type="button"
                          onClick={() => clearManualPrintableSurface('服全体を印刷範囲として使います。')}
                          className="text-white/55 underline decoration-white/20 underline-offset-2 hover:text-white"
                        >
                          服全体に戻す
                        </button>
                      </div>
                    ) : null}
                    {printableSurfaceResetNotice ? (
                      <p role="status" className="text-[11px] leading-relaxed text-amber-200">{printableSurfaceResetNotice}</p>
                    ) : null}
                    {printableSuggestionStatus ? (
                      <p role="status" className="text-[11px] leading-relaxed text-emerald-100/80">{printableSuggestionStatus}</p>
                    ) : null}
                  </div>
                </div>
              )}
              <div ref={printDesignSelectorRef} data-testid="print-design-selection-anchor" tabIndex={-1}>
                <ImageSelector
                  label="プリント画像を追加"
                  multiple
                  required
                  value={null}
                  galleryTitle="プリントデザインを選択"
                  galleryAssetPurpose="print-design"
                  selectionTestId="print-design-selector"
                  onChange={() => {}}
                  multipleValue={printDesigns}
                  onMultipleChange={addDesigns}
                  maxImages={6}
                  allowedReferenceTypes={['pattern']}
                  defaultReferenceType="pattern"
                  hint="柄・ロゴ・図案を6つまで追加できます"
                  processing={printDesigns.some((_, index) => (printDesignCutoutStates[index] ?? 'processing') === 'processing')}
                  hideSelectedPreviewWhileProcessing
                  multiplePreviewUrls={printDesigns.map((_, index) => (
                    (printDesignCutoutStates[index] ?? 'processing') === 'done'
                      ? printDesignProcessedUrls[index] ?? null
                      : null
                  ))}
                  multipleProcessingStates={printDesigns.map((_, index) => (
                    (printDesignCutoutStates[index] ?? 'processing') === 'processing'
                  ))}
                  processingLabel="プリント画像を透明化中"
                />
                {printDesigns.length > 0 && (
                  <div className="space-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                    {printDesigns.map((design, index) => {
                      const state = printDesignCutoutStates[index] ?? 'processing';
                      return (
                      <div
                        key={getPrintDesignLayerId(design)}
                        data-testid="print-design-placement-row"
                        className={`flex items-center justify-between gap-3 rounded-lg border px-2 py-1.5 ${activePrintDesignLayerId === getPrintDesignLayerId(design)
                          ? 'border-cyan-300/35 bg-cyan-300/10'
                          : 'border-transparent'}`}
                      >
                        <button
                          type="button"
                          disabled={state !== 'done'}
                          aria-pressed={activePrintDesignLayerId === getPrintDesignLayerId(design)}
                          aria-label={`デザイン ${index + 1} を配置`}
                          onClick={() => selectLayer(getPrintDesignLayerId(design))}
                          className="min-w-0 truncate text-left text-white/70 transition hover:text-cyan-100 disabled:cursor-wait disabled:opacity-60"
                        >
                          デザイン {index + 1}
                        </button>
                        <div className="flex items-center gap-2">
                          {state === 'done' && activePrintDesignLayerId === getPrintDesignLayerId(design) && (
                            <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                              選択中
                            </span>
                          )}
                          <span className={state === 'error' ? 'text-red-300' : state === 'done' ? 'text-emerald-300' : 'text-cyan-200'}>
                            {state === 'processing' ? '背景を透明化中…' : state === 'done' ? '透明化済み' : state === 'error' ? (printDesignCutoutErrors[index] || '透明化失敗') : '待機中'}
                          </span>
                          {state === 'done' && (
                            <button
                              type="button"
                              onClick={() => openDesignMaskEditor(index)}
                              className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/75 transition hover:border-cyan-300/40 hover:text-cyan-100"
                            >
                              マスク調整
                            </button>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {isPrinting && (
            <label className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
              <span className="mb-2 block font-semibold text-white">出力解像度</span>
              <select
                value={printOutputScale}
                disabled={isGenerating}
                onChange={(event) => setPrintOutputScale(Number(event.target.value) === 2 ? 2 : 1)}
                className="w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-white disabled:opacity-50"
                aria-label="プリント結果の出力解像度"
              >
                <option value={1}>720 × 900（標準）</option>
                <option value={2}>1440 × 1800（高解像度）</option>
              </select>
            </label>
          )}
          </div>

          <div
            data-testid={isPrinting ? 'printing-control-rail-primary' : undefined}
            className="space-y-5 xl:shrink-0"
          >

          {isPrinting && printPlacementConfirmed && placedPrintDesignLayers.length > 0 && (
            <section
              data-testid="confirmed-print-composition-preview"
              aria-label="確定したプリント配置"
              className="rounded-2xl border border-emerald-300/20 bg-white/[0.03] p-3"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">現在のプリント配置</p>
                  <p className="mt-0.5 text-[11px] text-white/50">生成前に服・重なり・位置を確認できます。</p>
                </div>
                <button
                  type="button"
                  data-testid="edit-confirmed-print-composition"
                  onClick={openPrintPlacementSession}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-cyan-200/35 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/15"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  配置を編集
                </button>
              </div>
              <div
                data-testid="confirmed-print-composition-canvas"
                className="mx-auto w-full overflow-hidden rounded-2xl border border-white/10 bg-neutral-900"
                style={{ maxWidth: 'clamp(96px, calc((100dvh - 520px) * 0.8), 220px)' }}
              >
                <PrintingCompositionStage
                  key={`confirmed-print-composition-${printPlacementSessionRevision}`}
                  garmentUrl={printGarmentCutoutState === 'done' ? printGarmentProcessed : null}
                  garmentMaskUrl={printGarmentCutoutState === 'done' ? printGarmentProcessed : null}
                  garmentMaskConfirmed={hasConfirmedPrintGarmentMask}
                  designClipMaskUrl={printableSurfaceEnabled ? printableSurfaceStageMaskUrl : null}
                  layers={stageLayers as Array<{
                    id: string;
                    label: string;
                    displayUrl: string;
                    transform: Transform;
                    cutoutState: 'idle' | 'processing' | 'done' | 'error';
                  }>}
                  selectedLayerId={null}
                  onSelectLayer={() => {}}
                  onCommitLayer={() => {}}
                  onReorderLayer={() => {}}
                  interactive={false}
                />
              </div>
            </section>
          )}

          <Button
            onClick={handleGenerate}
            isLoading={isGenerating}
            disabled={isGenerating || (!isPrinting
              ? !(fabricBase && fabricDesign)
              : !(canConfirmPrintPlacement
                && printGarmentProcessed
                && printGarmentCutoutState === 'done'
                && !printPlacementSessionOpen
                && printPlacementConfirmed
                ))}
            className="w-full"
            size="lg"
            leftIcon={isGenerating ? undefined : <Sparkles className="w-5 h-5" />}
          >
            {isGenerating ? '生成中...' : '生成して結果を出す'}
          </Button>

          {generationError && (
            <p className="rounded-xl border border-rose-300/20 bg-rose-950/30 px-3 py-2 text-xs leading-relaxed text-rose-200">
              {generationError}
            </p>
          )}
          {surfaceConformStatus && (
            <p role="status" className="rounded-xl border border-cyan-300/20 bg-cyan-950/25 px-3 py-2 text-xs leading-relaxed text-cyan-100">
              {surfaceConformStatus}
            </p>
          )}
          {generatedResultsStale && visibleGeneratedResults.length > 0 && (
            <p className="rounded-xl border border-amber-300/20 bg-amber-950/25 px-3 py-2 text-xs leading-relaxed text-amber-100">
              以下は素材変更前または直前の生成結果です。新しい結果としては扱わず、生成を再実行してください。
            </p>
          )}

          <p className="text-xs leading-relaxed text-white/45">
            {isPrinting
              ? 'AIで描き直さず、配置そのままと布になじませる結果を同じマスク・座標で作成します。履歴は最大4回分です。'
              : '生地画像にデザインを重ね、複数の生地質感バリエーションを一度に確認できます。'}
          </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-5"
        >
          {isPrinting && printPlacementSessionOpen && (
            <div
              data-testid="print-focused-workspace"
              className="rounded-3xl border border-cyan-300/20 bg-neutral-950/85 p-4 shadow-2xl shadow-black/20"
            >
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/70">集中編集</p>
                  <h3 className="mt-1 text-lg font-semibold text-white">服の認識範囲とデザイン配置</h3>
                  <p className="mt-1 text-xs leading-relaxed text-white/50">
                    左で確定面を確認し、右でデザインをそのまま移動・拡大・回転できます。
                    {printPlacementSessionDirty ? ' 変更があります。決定またはキャンセルしてください。' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="mr-1 flex items-center gap-2 text-xs text-white/50">
                    <Check className="h-4 w-4 text-emerald-300" />
                    {currentBrand ? 'ブランド選択済み' : 'ブランド未選択'}
                  </div>
                  <button
                    type="button"
                    data-testid="cancel-print-placement"
                    onClick={cancelPrintPlacementSession}
                    className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/70 transition hover:border-white/30 hover:text-white"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    data-testid="confirm-print-placement"
                    onClick={confirmPrintPlacementSession}
                    disabled={!canConfirmPrintPlacement}
                    aria-describedby={!canConfirmPrintPlacement ? 'print-placement-confirmation-status' : undefined}
                    className="rounded-xl border border-cyan-200/40 bg-cyan-300/15 px-4 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    決定
                  </button>
                </div>
              </div>
              {!canConfirmPrintPlacement && (
                <p
                  id="print-placement-confirmation-status"
                  role="status"
                  className="mb-4 rounded-xl border border-amber-300/25 bg-amber-950/25 px-3 py-2 text-xs leading-relaxed text-amber-100"
                >
                  {printPlacementConfirmationStatus}
                </p>
              )}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-start">
                <section
                  data-testid="confirmed-garment-mask-pane"
                  aria-label="服の認識範囲"
                  className="rounded-2xl border border-cyan-300/20 bg-[#07131e] p-3"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-white/50">ステップ1</p>
                      <h4 className="mt-1 font-semibold text-white">服の認識範囲</h4>
                    </div>
                    <span className="rounded-full border border-cyan-200/30 bg-cyan-300/10 px-2 py-1 text-[10px] font-semibold text-cyan-100">
                      {hasConfirmedPrintGarmentMask
                        ? selectedPrintGarmentMaskCandidateId === 'manual'
                          ? '手動確定'
                          : printGarmentSelectionSource === 'range' ? '範囲確定' : 'タップ確定'
                        : '未確定候補'}
                    </span>
                  </div>
                  <div className="relative flex min-h-[18rem] items-center justify-center overflow-hidden rounded-xl border border-cyan-300/20 bg-neutral-950/80 p-3">
                    <div
                      aria-hidden="true"
                      className="absolute inset-3 opacity-50"
                      style={{
                        backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.07) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.07) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.07) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.07) 75%)',
                        backgroundSize: '18px 18px',
                        backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0px',
                      }}
                    />
                    {printGarmentCutoutState === 'done' && printGarmentProcessed ? (
                      <div className="relative z-10 flex h-full w-full items-center justify-center">
                        <img
                          src={printGarmentProcessed}
                          alt="服の青い認識範囲"
                          className="max-h-[17rem] w-full object-contain"
                          style={{
                            filter: 'brightness(0) saturate(100%) invert(68%) sepia(86%) saturate(1800%) hue-rotate(167deg) brightness(101%) contrast(98%)',
                            opacity: 0.9,
                          }}
                          draggable={false}
                        />
                        <img
                          src={printGarmentProcessed}
                          alt=""
                          className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-25"
                          draggable={false}
                        />
                        <div className="pointer-events-none absolute inset-4 rounded-xl border border-cyan-100/80 shadow-[0_0_24px_rgba(34,211,238,0.22)]" />
                      </div>
                    ) : (
                      <div className="relative z-10 rounded-xl border border-white/10 bg-black/30 px-4 py-5 text-center text-xs text-white/55">
                        服を選択すると、確定面がここに表示されます。
                      </div>
                    )}
                  </div>
                  <div
                    role="status"
                    data-testid="confirmed-garment-mask-status"
                    className="mt-3 rounded-xl border border-blue-300/25 bg-blue-950/35 px-3 py-2 text-[11px] leading-relaxed text-blue-50"
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm border border-cyan-100 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.75)]" />
                      {hasConfirmedPrintGarmentMask ? '認識範囲を確認済み' : '服の候補を確認してください'}
                    </div>
                    <p className="mt-1 text-blue-100/75">
                      {hasConfirmedPrintGarmentMask
                        ? 'デザインは確定した服の内側だけに適用されます。'
                        : printGarmentSelectionSource !== 'automatic' && printGarmentCutoutState === 'done'
                          ? 'この青いAIマスクを確認し、下のボタンで確定してください。'
                          : '服をタップして候補を確認すると、ここに青い確定面が残ります。'}
                    </p>
                    {!hasConfirmedPrintGarmentMask
                      && printGarmentSelectionSource !== 'automatic'
                      && printGarmentCutoutState === 'done'
                      && printGarmentProcessed && (
                        <button
                          type="button"
                          data-testid="confirm-processed-garment-mask"
                          onClick={confirmProcessedGarmentMask}
                          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-200/40 bg-cyan-300/15 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/20"
                        >
                          <Check className="h-4 w-4" />
                          このAIマスクで確定
                        </button>
                      )}
                  </div>
                </section>

                <section
                  ref={printPlacementPaneRef}
                  tabIndex={-1}
                  data-testid="design-placement-pane"
                  aria-label="デザイン配置"
                  className="rounded-2xl border border-white/10 bg-[#0b1114] p-3"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-white/50">ステップ2</p>
                      <h4 className="mt-1 font-semibold text-white">デザインの配置と調整</h4>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-white/60">
                      {printDesignLayers.length
                        ? `${placedPrintDesignLayers.length}件配置中`
                        : 'デザイン未選択'}
                    </span>
                  </div>
                  <div
                    ref={stageRef}
                    onPointerDown={clearSelectedLayer}
                    className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-neutral-900"
                    style={{
                      background: printStageBackground,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  >
                    <PrintingCompositionStage
                      key={`print-placement-${printPlacementSessionRevision}`}
                      garmentUrl={printGarmentCutoutState === 'done' ? printGarmentProcessed : null}
                      garmentMaskUrl={printGarmentCutoutState === 'done' ? printGarmentProcessed : null}
                      garmentMaskConfirmed={hasConfirmedPrintGarmentMask}
                      designClipMaskUrl={printableSurfaceEnabled ? printableSurfaceStageMaskUrl : null}
                      layers={stageLayers as Array<{
                        id: string;
                        label: string;
                        displayUrl: string;
                        transform: Transform;
                        cutoutState: 'idle' | 'processing' | 'done' | 'error';
                      }>}
                      selectedLayerId={selectedLayerId}
                      onSelectLayer={selectLayer}
                      onCommitLayer={({ id, transform }) => {
                        beginPrintPlacementSessionEdit();
                        setPrintDesignLayers((prev) => prev.map((layer) => (layer.id === id ? { ...layer, transform } : layer)));
                      }}
                      onReorderLayer={({ id, action }: { id: string; action: PrintDesignLayerOrderAction }) => {
                        beginPrintPlacementSessionEdit();
                        setPrintDesignLayers((prev) => reorderPrintDesignLayers(prev, id, action));
                      }}
                    />
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-white/50">
                    デザインを選択後、表示された枠をドラッグ、角のハンドルで拡大、上のハンドルで回転できます。
                  </p>
                </section>
              </div>
            </div>
          )}
          {isPrinting && !printPlacementSessionOpen && (
            <div
              data-testid="confirmed-print-placement-summary"
              className="rounded-3xl border border-emerald-300/20 bg-neutral-950/85 p-4 shadow-2xl shadow-black/20"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200/70">
                    {printPlacementConfirmed ? '配置確定済み' : '配置未確定'}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-white">
                    {printPlacementConfirmed ? 'デザイン配置を決定しました' : 'デザイン配置を決定してください'}
                  </h3>
                  <p className="mt-1 text-xs text-white/50">
                    {printPlacementConfirmed
                      ? `${placedPrintDesignLayers.length}件のデザインを、確定した服の内側へ配置します。`
                      : '配置を開き、「決定」を押すまで生成は開始できません。'}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="reopen-print-placement"
                  onClick={openPrintPlacementSession}
                  className="rounded-xl border border-cyan-200/35 bg-cyan-300/10 px-4 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/15"
                >
                  配置を再調整
                </button>
              </div>
            </div>
          )}
          <div className={`rounded-3xl border border-white/10 bg-neutral-950/80 p-4 shadow-2xl shadow-black/20 ${isPrinting ? 'hidden' : ''}`}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-white/60">ライブプレビュー</p>
                  <h3 className="text-lg font-semibold text-white">{isPrinting ? 'プリント重ねの調整' : '生地とデザインの重なり'}</h3>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <Check className="h-4 w-4 text-emerald-300" />
                  {currentBrand ? 'ブランド選択済み' : 'ブランド未選択'}
                </div>
              </div>
            </div>
            <div
              ref={isPrinting ? undefined : stageRef}
              onPointerDown={clearSelectedLayer}
              className={`relative aspect-[4/5] overflow-hidden rounded-3xl border border-white/10 bg-neutral-900 ${isPrinting ? 'hidden' : ''}`}
              style={{
                background: isPrinting ? printStageBackground : fabricStageBackground,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {!isPrinting && (
                <>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.14),transparent_55%)]" />
                  {!fabricBase && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="rounded-2xl border border-white/10 bg-black/40 px-5 py-4 text-center text-white/70 backdrop-blur">
                        <Upload className="mx-auto mb-2 h-5 w-5" />
                        <p className="text-sm">生地画像をアップロードしてください</p>
                      </div>
                    </div>
                  )}
                  {stageLayers.map((layer) => (
                    <LayerPreview
                      key={layer.id}
                      layer={layer}
                      selected={selectedLayerId === layer.id}
                      onSelect={() => selectLayer(layer.id)}
                      onMove={(x, y) => {
                        if (layer.id === 'fabric-design' && fabricLayer) {
                          setFabricLayer({ ...fabricLayer, transform: { ...fabricLayer.transform, x, y } });
                        }
                      }}
                      mode={mode}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
          {(visibleGeneratedResults.length > 0 || (isPrinting && progressivePrintRun)) && (
            <div className="rounded-3xl border border-white/10 bg-neutral-950/80 p-4 shadow-2xl shadow-black/20">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white/60">生成結果</p>
                  <h3 className="text-lg font-semibold text-white">
                    {isPrinting ? 'プリント結果' : '生地バリエーション'}
                  </h3>
                  {isPrinting && (
                    <p className="mt-1 text-xs text-white/45">
                      生成履歴 {printResultRuns.length}/{PRINT_RESULT_HISTORY_MAX_RUNS}
                    </p>
                  )}
                  {generatedResultsStale && (
                    <p className="mt-1 text-xs text-amber-200">前回結果（未更新）</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isPrinting && printResultRuns.length > 0 && (
                    <button
                      type="button"
                      data-testid="clear-print-result-history"
                      onClick={clearPrintResultHistory}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/65 transition hover:border-red-300/35 hover:text-red-100 focus:outline-none focus:ring-2 focus:ring-red-300/35"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      全削除
                    </button>
                  )}
                  {isPrinting && !isGenerating && printResultRuns.length > 0 && (
                    <button
                      type="button"
                      data-testid="try-next-print-design"
                      onClick={returnToPrintDesignSelection}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-cyan-300/35 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/35"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      次のデザインを試す
                    </button>
                  )}
                  {isPrinting && visibleGeneratedResults.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => setShowResultComparison(true)}
                      className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
                    >
                      結果を比較
                    </button>
                  )}
                  <Layers3 className="h-5 w-5 text-primary-200" />
                </div>
              </div>
              {isPrinting ? (
                <div data-testid="print-result-run-history" className="space-y-4">
                  {progressivePrintRun && (
                    <section
                      data-testid="progressive-print-run"
                      className="rounded-2xl border border-cyan-300/25 bg-cyan-300/[0.035] p-3"
                      aria-busy={progressivePrintRun.exact.status === 'rendering' || progressivePrintRun.fabric.status === 'rendering'}
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-cyan-50">現在の生成（最新）</p>
                          <p className="mt-1 text-[10px] text-cyan-100/55">
                            配置そのままを先に表示し、布になじませる結果を続けて追加します。
                          </p>
                        </div>
                        <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-100">
                          {progressivePrintRun.fabric.status === 'ready' ? '2/2' : progressivePrintRun.exact.status === 'ready' ? '1/2' : '0/2'}
                        </span>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <ProgressivePrintSurfaceCard
                          label="配置そのまま"
                          surface={progressivePrintRun.exact}
                          onOpen={setSelectedResult}
                          onFavorite={openFavoriteDialog}
                          isFavorite={Boolean(progressivePrintRun.exact.result
                            && favoriteResultIds.has(progressivePrintRun.exact.result.id))}
                        />
                        <ProgressivePrintSurfaceCard
                          label="布になじませる"
                          surface={progressivePrintRun.fabric}
                          onOpen={setSelectedResult}
                          onFavorite={openFavoriteDialog}
                          isFavorite={Boolean(progressivePrintRun.fabric.result
                            && favoriteResultIds.has(progressivePrintRun.fabric.result.id))}
                        />
                      </div>
                    </section>
                  )}
                  {printResultRuns.map((run, runIndex) => (
                    <section
                      key={run.runId}
                      data-testid="print-result-run"
                      className="rounded-2xl border border-white/10 bg-white/[0.025] p-3"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-white/80">
                            生成履歴 {runIndex + 1}{runIndex === 0 && !progressivePrintRun ? '（最新）' : ''}
                          </p>
                          <p className="mt-1 text-[10px] text-white/40">
                            exact / fabric{run.results.some((result) => result.resultKind === 'surface') ? ' / experimental' : ''}
                          </p>
                        </div>
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/45">
                          {run.results.length}結果
                        </span>
                      </div>
                      <div className={`grid gap-4 sm:grid-cols-2 ${run.results.length > 2 ? 'xl:grid-cols-3' : ''}`}>
                        {run.results.map((result) => (
                          <WorkbenchResultCard
                            key={result.id}
                            result={result}
                            onOpen={setSelectedResult}
                            onFavorite={openFavoriteDialog}
                            onDeleteRun={deletePrintResultRun}
                            isFavorite={favoriteResultIds.has(result.id)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleGeneratedResults.map((result) => (
                    <WorkbenchResultCard
                      key={result.id}
                      result={result}
                      onOpen={setSelectedResult}
                      onFavorite={isPrinting ? openFavoriteDialog : undefined}
                      isFavorite={Boolean(isPrinting && favoriteResultIds.has(result.id))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>

      <Modal
        isOpen={favoriteTargetResult !== null}
        onClose={closeFavoriteDialog}
        title="お気に入りに追加"
        size="lg"
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="ghost" onClick={closeFavoriteDialog} disabled={favoriteSaving}>
              キャンセル
            </Button>
            <Button
              onClick={handleSaveFavorite}
              disabled={favoriteSaving
                || favoriteSpace !== 'personal'
                || !currentBrand?.id
                || !favoriteTargetBrandId
                || favoriteTargetBrandId !== currentBrand.id
                || favoriteTargetResult?.brandId !== favoriteTargetBrandId
                || (isCreatingFavoriteGroup && favoriteGroupName.trim().length === 0)}
            >
              {favoriteSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Heart className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              この端末に保存
            </Button>
          </div>
        )}
      >
        <div className="space-y-5" data-testid="print-result-favorite-dialog">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-neutral-100 p-1 dark:bg-white/5" role="tablist" aria-label="保存スペース">
            <button
              type="button"
              role="tab"
              aria-selected={favoriteSpace === 'personal'}
              onClick={() => setFavoriteSpace('personal')}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${favoriteSpace === 'personal'
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-white/10 dark:text-white'
                : 'text-neutral-500 hover:text-neutral-800 dark:text-white/50 dark:hover:text-white/80'}`}
            >
              <Laptop className="h-4 w-4" aria-hidden="true" />
              パーソナルスペース
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={favoriteSpace === 'team'}
              onClick={() => setFavoriteSpace('team')}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${favoriteSpace === 'team'
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-white/10 dark:text-white'
                : 'text-neutral-500 hover:text-neutral-800 dark:text-white/50 dark:hover:text-white/80'}`}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              チームスペース
            </button>
          </div>

          {favoriteSpace === 'personal' ? (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-neutral-600 dark:text-white/60">
                この端末のギャラリーへ保存します。保存後はギャラリーの「お気に入り」から確認できます。
              </p>
              <button
                type="button"
                onClick={() => {
                  setFavoriteDestination('パーソナルスペース');
                  setIsCreatingFavoriteGroup(false);
                }}
                aria-pressed={!isCreatingFavoriteGroup && favoriteDestination === 'パーソナルスペース'}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition ${!isCreatingFavoriteGroup && favoriteDestination === 'パーソナルスペース'
                  ? 'border-pink-300/60 bg-pink-50 text-pink-950 dark:border-pink-300/30 dark:bg-pink-400/10 dark:text-pink-50'
                  : 'border-neutral-200 hover:border-neutral-300 dark:border-white/10 dark:hover:border-white/20'}`}
              >
                <FolderHeart className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold">パーソナルスペース</span>
                  <span className="mt-0.5 block text-xs opacity-65">このブランドのローカルお気に入り</span>
                </span>
              </button>

              {isCreatingFavoriteGroup ? (
                <label className="block rounded-xl border border-neutral-200 p-4 dark:border-white/10">
                  <span className="text-xs font-semibold text-neutral-500 dark:text-white/55">新しいグループ名</span>
                  <input
                    value={favoriteGroupName}
                    onChange={(event) => setFavoriteGroupName(event.target.value)}
                    autoFocus
                    maxLength={60}
                    placeholder="例：夏のTシャツ"
                    className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-pink-400 dark:border-white/10 dark:bg-black/20 dark:text-white"
                  />
                </label>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingFavoriteGroup(true);
                    setFavoriteDestination('');
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm font-semibold text-neutral-600 transition hover:border-pink-300 hover:text-pink-600 dark:border-white/15 dark:text-white/60 dark:hover:text-pink-200"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  新しいグループ
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-amber-300/30 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 dark:bg-amber-400/10 dark:text-amber-100">
              チーム共有用の保存先モデルはまだ接続されていません。この画面では共有済みと扱わず、パーソナルスペースだけを保存できます。
            </div>
          )}

          {!currentBrand?.id && (
            <p className="rounded-xl border border-red-300/30 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-400/10 dark:text-red-100">
              保存するにはブランドを選択してください。
            </p>
          )}
          {favoriteTargetBrandId && currentBrand?.id && favoriteTargetBrandId !== currentBrand.id && (
            <p className="rounded-xl border border-red-300/30 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-400/10 dark:text-red-100">
              ブランドが変更されたため、この結果は保存できません。現在のブランドで再生成してください。
            </p>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={selectedResult !== null}
        onClose={() => setSelectedResult(null)}
        title={selectedResult?.title || '生成結果'}
        size="xl"
      >
        {selectedResult && (
          <div className="space-y-4">
            <div className="flex justify-center rounded-2xl bg-black/50 p-4">
              <img
                src={selectedResult.imageUrl}
                alt={selectedResult.title}
                className="max-h-[75vh] w-full rounded-xl object-contain"
              />
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {selectedResult.note}
            </p>
            {selectedResult.outputSize && (
              <a
                href={selectedResult.imageUrl}
                download={`heavy-chain-${selectedResult.id}-${selectedResult.outputSize.width}x${selectedResult.outputSize.height}.png`}
                className="inline-flex rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 dark:border-white/15 dark:text-white"
              >
                {selectedResult.outputSize.width} × {selectedResult.outputSize.height}px PNGをダウンロード
              </a>
            )}
          </div>
        )}
      </Modal>
      {showResultComparison && visibleGeneratedResults.length >= 2 && (
        <ImageCompare
          images={visibleGeneratedResults.map((result) => ({
            url: result.imageUrl,
            label: result.title,
            prompt: result.note,
          }))}
          onClose={() => setShowResultComparison(false)}
        />
      )}
      {printGarment && (
        <PrintGarmentSelectionEditor
          isOpen={printGarmentSelectionOpen}
          sourceUrl={printGarment.url}
          onClose={() => setPrintGarmentSelectionOpen(false)}
          onApply={applyGarmentSelection}
        />
      )}
      {printMaskEditorTarget && (
        <PrintMaskEditor
          isOpen
          title={printMaskEditorTarget.title}
          sourceUrl={printMaskEditorTarget.sourceUrl}
          maskUrl={printMaskEditorTarget.maskUrl}
          sourceBounds={printMaskEditorTarget.result.bounds}
          outputSize={printMaskEditorTarget.result.outputSize}
          description={printMaskEditorTarget.description ?? (printMaskEditorTarget.kind === 'printable-area'
            ? '右側で、印刷する範囲を「残す」、印刷しない範囲を「消す」ブラシで指定してください。服の外側は自動的に除外されます。'
            : undefined)}
          applyLabel={printMaskEditorTarget.kind === 'printable-area' ? '印刷可能面を保存' : undefined}
          preserveOutputSize={printMaskEditorTarget.kind === 'printable-area'}
          noticeMessage={printMaskEditorError}
          onClearNotice={() => setPrintMaskEditorError(null)}
          onClose={() => {
            invalidatePrintableSuggestion();
            setPrintMaskEditorError(null);
            setPrintMaskEditorTarget(null);
          }}
          onApply={applyEditedPrintMask}
        />
      )}
    </div>
  );
}
