import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FolderHeart,
  Heart,
  History,
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
import { useUnifiedWorkspaceFlow } from '../components/workspace/LightchainUnifiedWorkspaceShell';
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
  listPrintResultFavoriteIds,
  savePrintResultFavorite,
} from '../features/printing/history/printResultFavorite';
import { useAuthStore } from '../stores/authStore';
import { useCanvasStore } from '../stores/canvasStore';
import {
  deleteWorkspaceArtifactsPersisted,
  listWorkspaceGeneratedImages,
  saveWorkspaceArtifactPersisted,
} from '../lib/localWorkspaceArtifacts';
import { persistProviderResultArtifact } from '../lib/providerResultPersistence';
import { withSignedImageUrls } from '../lib/storage';
import {
  buildDerivedPrintGarmentMaskCandidates,
  buildPrintGarmentCutoutDataUrl,
  buildHighPrecisionMaterialCutoutDataUrl,
  buildWhiteBackgroundGarmentCutoutDataUrl,
  buildPortraitGarmentPriorCutoutDataUrl,
  buildEncodedManualPrintableSurface,
  buildPrintableSurfaceStageMaskDataUrl,
  buildPrintDesignCutoutDataUrl,
  buildPrintRequestSignature,
  preparePrintGarmentClothModel,
  renderExperimentalSurfaceComposition,
  isPrintGarmentModnetModelConfigured,
  isPrintGarmentBen2ModelConfigured,
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
import { refineCoarseGarmentMask } from '../features/printing/selection/refineCoarseGarmentMask';
import {
  applyFabricMaterialResponse,
  type FabricMaterialProfile,
} from '../features/printing/fabricMaterialSynthesis';
import {
  canCommitPrintableSurfaceEditorOperation,
  canCommitPrintableSuggestion,
  type PrintableSuggestionCommitToken,
} from '../features/printing/surface/printableSuggestionRequest';
import {
  persistPrintResultHistory,
  releaseRestoredPrintResult,
  restorePrintResultHistory,
} from '../lib/printResultHistoryPersistence';
import {
  persistPrintInputState,
  releaseRestoredPrintInput,
  restorePrintInputState,
  type RestoredPrintInputImage,
  type PrintInputProcessedState,
} from '../lib/printInputPersistence';
import {
  canExplicitlyConfirmProcessedGarmentMask,
  DEFAULT_GARMENT_SEGMENTATION_TARGET,
  garmentSelectionModelStatus,
  isCurrentGarmentMaskEditorTarget,
  isGarmentMaskExplicitlyConfirmed,
  type GarmentSegmentationTarget,
  type GarmentSelectionSource,
} from '../features/printing/selection/garmentSegmentationPolicy';
import type { ClothModelWarmupProgress } from '../features/printing/selection/clothModelWarmup';
import {
  canConfirmPlacementEdit,
  createPlacementEditBaseline,
  restorePlacementEditBaseline,
  type PlacementEditBaseline,
} from '../features/printing/selection/placementEditSession';
import {
  LIGHTCHAIN_MATERIAL_INPUTS,
  LIGHTCHAIN_MATERIAL_TABS,
  getLightchainMaterialTab,
} from '../lib/lightchainMaterialContract';
import { buildLightchainProviderPrompt } from '../features/lightchain/providerAdapter';
import { deriveUnifiedWorkspaceFlowState, unifiedWorkspaceFlowLabels } from '../lib/unifiedWorkspaceFlow';
import {
  buildLightchainParityRuntime,
  serializeLightchainParityRuntime,
} from '../features/lightchain/parityRuntime';
import {
  buildProviderGarmentEditMask,
  composeProviderProtectedResult,
} from '../features/lightchain/providerMask';
import { assertCompletedImageEditResult, editImageWithPrompt } from '../lib/imageApi';
import { downloadValidatedImage } from '../lib/imageDownload';
import type { GeneratedImage, Json } from '../types/database';

type WorkbenchMode = 'fabric' | 'printing';
type PrintCoverageMode = 'spot' | 'full';

const MATERIAL_TOOLBAR_ROUTES: Record<string, string> = {
  'デザインツール': '/lightchain?category=planning',
  'フィッティングツール': '/lightchain?category=fitting',
  'グラフィックデザインツール': '/lightchain?category=graphics',
  '衣類生産ツール': '/designProduction',
};

const LIGHTCHAIN_MATERIAL_TOOLBAR_ITEMS = [
  { label: 'デザインツール', icon: Laptop },
  { label: 'フィッティングツール', icon: Users },
  { label: 'グラフィックデザインツール', icon: Layers3 },
  { label: '衣類生産ツール', icon: Scissors },
] as const;

function LightchainMaterialToolbar() {
  const navigate = useNavigate();

  return (
    <nav
      aria-label="Lightchainツールバー"
      data-testid="lightchain-material-toolbar"
      className="mb-4 flex flex-wrap items-center gap-4 border-b border-white/10 px-1 pb-4 text-white/60"
    >
      <span className="shrink-0 text-xs font-semibold tracking-[0.16em] text-white/80">ツールバー</span>
      {LIGHTCHAIN_MATERIAL_TOOLBAR_ITEMS.map(({ label, icon: Icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => navigate(MATERIAL_TOOLBAR_ROUTES[label] ?? '/lightchain')}
          data-testid={`lightchain-material-toolbar-${String(label)}`}
          className="inline-flex items-center gap-2 text-xs font-semibold transition hover:text-white sm:text-sm"
        >
          <Icon className="h-4 w-4 text-white/45" aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
const PRINT_COVERAGE_OPTIONS: Array<{ value: PrintCoverageMode; label: string }> = [
  { value: 'spot', label: 'スポット' },
  { value: 'full', label: '全体' },
];
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
  filter?: string;
  tint?: string;
  blendMode?: GlobalCompositeOperation;
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
  resultKind?: 'exact' | 'fabric' | 'surface' | 'provider';
  generatedAt?: number;
  title: string;
  note: string;
  imageUrl: string;
  outputSize?: { width: number; height: number };
  assetRef?: string;
  generationMode?: 'provider' | 'preview';
  provider?: string | null;
  backendProvider?: string | null;
  jobId?: string | null;
  imageId?: string | null;
  storagePath?: string | null;
  inputImageCount?: number;
  maskApplied?: boolean;
  maskCoveragePercent?: number | null;
  maskWidth?: number | null;
  maskHeight?: number | null;
  providerModel?: string | null;
  inputFidelity?: 'low' | 'high' | null;
  quality?: 'low' | 'medium' | 'high' | 'auto' | null;
  protectedRegionComposited?: boolean;
  persistenceStatus?: string | null;
  artifactId?: string | null;
  inputLineage?: MaterialInputLineage[];
  parityRuntime?: ReturnType<typeof serializeLightchainParityRuntime>;
};

type MaterialInputLineage = {
  role: 'garment' | 'print-artwork' | 'model-or-design' | 'textile';
  sourceImageId: string | null;
  sourceStoragePath: string | null;
  referenceType: string | null;
};

const FABRIC_PROVIDER_RESULT_FEATURE_TYPE = 'lightchain-fabric-image-provider-result';

const jsonRecord = (value: Json | null | undefined): Record<string, Json | undefined> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {}
);

const jsonString = (value: Json | undefined): string | null => (
  typeof value === 'string' && value.trim() ? value : null
);

const jsonNumber = (value: Json | undefined): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

const jsonBoolean = (value: Json | undefined): boolean | null => (
  typeof value === 'boolean' ? value : null
);

const restoredMaterialInputLineage = (value: Json | undefined): MaterialInputLineage[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = jsonRecord(item);
    const role = jsonString(record.role);
    if (role !== 'garment' && role !== 'print-artwork' && role !== 'model-or-design' && role !== 'textile') {
      return [];
    }
    return [{
      role,
      sourceImageId: jsonString(record.sourceImageId),
      sourceStoragePath: jsonString(record.sourceStoragePath),
      referenceType: jsonString(record.referenceType),
    }];
  });
};

const restoredMaterialOutputSize = (value: Json | undefined): { width: number; height: number } | undefined => {
  const record = jsonRecord(value);
  const width = jsonNumber(record.width);
  const height = jsonNumber(record.height);
  return width && height && width > 0 && height > 0
    ? { width, height }
    : undefined;
};

const restoredMaterialQuality = (value: Json | undefined): WorkbenchResult['quality'] => {
  const quality = jsonString(value);
  return quality === 'low' || quality === 'medium' || quality === 'high' || quality === 'auto'
    ? quality
    : null;
};

const restoredMaterialInputFidelity = (value: Json | undefined): WorkbenchResult['inputFidelity'] => {
  const fidelity = jsonString(value);
  return fidelity === 'low' || fidelity === 'high' ? fidelity : null;
};

const restoredFabricProviderResult = (image: GeneratedImage): WorkbenchResult | null => {
  if (image.feature_type !== FABRIC_PROVIDER_RESULT_FEATURE_TYPE) return null;
  const metadata = jsonRecord(image.metadata);
  if (metadata.providerResultArtifact !== true) return null;
  const imageUrl = image.image_url?.trim();
  if (!imageUrl) return null;

  const generatedAt = Date.parse(image.created_at);
  return {
    id: image.id,
    brandId: image.brand_id,
    runId: jsonString(metadata.providerJobId) ?? image.job_id ?? undefined,
    resultKind: 'provider',
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : undefined,
    title: jsonString(metadata.title) ?? '生地イメージ AI生成',
    note: image.prompt ?? jsonString(metadata.brief) ?? '生地画像を衣服領域へ反映',
    imageUrl,
    outputSize: restoredMaterialOutputSize(metadata.outputSize),
    generationMode: 'provider',
    provider: jsonString(metadata.provider),
    backendProvider: jsonString(metadata.backendProvider),
    jobId: jsonString(metadata.providerJobId) ?? image.job_id,
    imageId: jsonString(metadata.remoteImageId) ?? jsonString(metadata.providerImageId),
    storagePath: image.storage_path,
    inputImageCount: jsonNumber(metadata.inputImageCount) ?? undefined,
    maskApplied: jsonBoolean(metadata.maskApplied) ?? false,
    maskCoveragePercent: jsonNumber(metadata.maskCoveragePercent),
    maskWidth: jsonNumber(metadata.maskWidth),
    maskHeight: jsonNumber(metadata.maskHeight),
    providerModel: jsonString(metadata.providerModel),
    inputFidelity: restoredMaterialInputFidelity(metadata.inputFidelity),
    quality: restoredMaterialQuality(metadata.quality),
    protectedRegionComposited: jsonBoolean(metadata.protectedRegionComposited) ?? false,
    persistenceStatus: jsonString(metadata.persistenceStatus),
    artifactId: image.id,
    inputLineage: restoredMaterialInputLineage(metadata.inputLineage),
    parityRuntime: metadata.parityRuntime,
  };
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

const downloadWorkbenchResult = async (result: WorkbenchResult) => {
  await downloadValidatedImage(
    result.imageUrl,
    `heavy-chain-${result.id}-${result.outputSize?.width ?? 'result'}x${result.outputSize?.height ?? 'image'}.png`,
    'print_result_download',
  );
};

function WorkbenchResultCard({
  result,
  onOpen,
  onFavorite,
  onDeleteRun,
  onSaveToCanvas,
  isFavorite = false,
}: {
  result: WorkbenchResult;
  onOpen: (result: WorkbenchResult) => void;
  onFavorite?: (result: WorkbenchResult) => void;
  onDeleteRun?: (result: WorkbenchResult) => void;
  onSaveToCanvas?: (result: WorkbenchResult) => void;
  isFavorite?: boolean;
}) {
  const surfaceBadge = result.resultKind === 'exact'
    ? { eyebrow: 'EXACT', label: '配置そのまま', className: 'border-cyan-200/35 bg-cyan-950/85 text-cyan-50' }
    : result.resultKind === 'fabric'
      ? { eyebrow: 'FABRIC', label: '布になじませる', className: 'border-fuchsia-200/35 bg-fuchsia-950/85 text-fuchsia-50' }
      : result.resultKind === 'surface'
        ? { eyebrow: 'SURFACE', label: '布面追従（試験）', className: 'border-amber-200/35 bg-amber-950/85 text-amber-50' }
        : result.resultKind === 'provider'
          ? { eyebrow: 'PROVIDER', label: 'AI生成', className: 'border-emerald-200/35 bg-emerald-950/85 text-emerald-50' }
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
          {result.generationMode === 'provider' && (
            <p data-testid={`provider-result-provenance-${result.id}`} className="mt-1 text-[11px] leading-relaxed text-emerald-200/80">
              {result.provider ?? 'provider'} / {result.backendProvider ?? 'edge-function'}
              {result.inputImageCount ? ` / 入力${result.inputImageCount}枚` : ''}
              {result.providerModel ? ` / ${result.providerModel}` : ''}
              {result.inputFidelity ? ` / fidelity=${result.inputFidelity}` : ''}
              {result.quality ? ` / quality=${result.quality}` : ''}
              {result.maskApplied ? ` / mask=${result.maskCoveragePercent?.toFixed(1) ?? '?'}%` : ''}
              {result.protectedRegionComposited ? ' / protected=source-outside-mask' : ''}
              {result.jobId ? ` / job ${result.jobId}` : ''}
            </p>
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
            <button
              type="button"
              onClick={() => void downloadWorkbenchResult(result).catch(() => toast.error('ダウンロードに失敗しました'))}
              data-testid={`print-result-download-${result.id}`}
              aria-label={`${result.title}のPNGをダウンロード`}
              className="inline-flex rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-cyan-300/40 hover:text-cyan-100"
            >
              PNGをダウンロード
            </button>
          )}
          {onSaveToCanvas && (
            <button
              type="button"
              onClick={() => onSaveToCanvas(result)}
              data-testid={`result-save-to-canvas-${result.id}`}
              className="inline-flex rounded-lg border border-emerald-300/30 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:border-emerald-200/60 hover:bg-emerald-300/10"
            >
              Canvasへ保存
            </button>
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
    profile: {
      tintColor: [245, 245, 240],
      tintStrength: 0.08,
      sourceTextureStrength: 0.92,
      weaveStrength: 0.018,
      sheenStrength: 0.02,
      drapeStrength: 0.11,
    } satisfies FabricMaterialProfile,
  },
  {
    id: 'denim',
    name: 'デニム',
    profile: {
      tintColor: [46, 72, 108],
      tintStrength: 0.78,
      sourceTextureStrength: 0.75,
      weaveStrength: 0.035,
      sheenStrength: 0.03,
      drapeStrength: 0.14,
    } satisfies FabricMaterialProfile,
  },
  {
    id: 'satin',
    name: 'サテン',
    profile: {
      tintColor: [245, 232, 224],
      tintStrength: 0.18,
      sourceTextureStrength: 0.82,
      weaveStrength: 0.008,
      sheenStrength: 0.18,
      drapeStrength: 0.05,
    } satisfies FabricMaterialProfile,
  },
  {
    id: 'linen',
    name: 'リネン',
    profile: {
      tintColor: [194, 176, 145],
      tintStrength: 0.46,
      sourceTextureStrength: 0.84,
      weaveStrength: 0.028,
      sheenStrength: 0.01,
      drapeStrength: 0.1,
    } satisfies FabricMaterialProfile,
  },
];

const FABRIC_OUTPUT_BACKGROUND = '#0b1113';

const printPreviewStageSize = { width: 720, height: 900 };
const IMAGE_LOAD_TIMEOUT_MS = 30_000;
const CUTOUT_TIMEOUT_MS = 75_000;
const CLOTH_CUTOUT_TIMEOUT_MS = 105_000;
const FABRIC_MODEL_MASK_TIMEOUT_MS = 150_000;
const MODNET_CUTOUT_TIMEOUT_MS = 60_000;
const BEN2_CUTOUT_TIMEOUT_MS = 180_000;
const PROVIDER_GENERATION_TIMEOUT_MS = 180_000;
const imageLoadCache = new Map<string, Promise<HTMLImageElement>>();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageLoadCache.get(url);
  if (cached) return cached;

  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
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
    // Uploaded assets are blob/data URLs and must not be forced through a
    // CORS fetch. Remote assets still opt into anonymous CORS so their pixels
    // remain exportable to Canvas when the host allows it.
    if (/^https?:\/\//i.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => settle(() => resolve(img));
    img.onerror = () => settle(() => reject(new Error('image load failed')));
    img.src = url;
  });

  imageLoadCache.set(url, pending);
  try {
    return await pending;
  } catch (error) {
    if (imageLoadCache.get(url) === pending) imageLoadCache.delete(url);
    throw error;
  }
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

async function buildFabricReferenceOverlay(imageUrl: string): Promise<string> {
  try {
    const garmentResult = await withTimeout(
      buildPrintGarmentCutoutDataUrl({
        imageUrl,
        modelName: resolvePrintGarmentCutoutModel({ selectionSource: 'automatic' }),
        segmentationTarget: 'full',
      }),
      CLOTH_CUTOUT_TIMEOUT_MS,
      '生地画像の服領域分離がタイムアウトしました。画像を確認して再試行してください',
    );
    return garmentResult.dataUrl;
  } catch (garmentError) {
    try {
      const artworkResult = await withTimeout(
        buildPrintDesignCutoutDataUrl({ imageUrl, backgroundProfile: 'strict' }),
        CUTOUT_TIMEOUT_MS,
        '生地画像の背景分離がタイムアウトしました。画像を確認して再試行してください',
      );
      return artworkResult.dataUrl;
    } catch (artworkError) {
      console.warn('Fabric reference overlay cutout failed.', { garmentError, artworkError });
      // A fabric reference is often a flat pattern swatch rather than a
      // photographed garment. Both cutout models are intentionally best
      // effort here: forcing a textile swatch through garment segmentation
      // made the provider route fail before generation. The raw texture is a
      // valid reference for the provider and for the masked local preview;
      // keep it as the terminal fallback instead of converting a valid input
      // into a false generation blocker.
      return imageUrl;
    }
  }
}

type ImageAlphaBounds = {
  image: HTMLImageElement;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  averageColor: string;
};

async function loadImageAlphaBounds(imageUrl: string): Promise<ImageAlphaBounds> {
  const image = await loadImage(imageUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('画像の寸法を取得できませんでした');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('画像マスク用Canvasを初期化できませんでした');
  context.drawImage(image, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let red = 0;
  let green = 0;
  let blue = 0;
  let opaquePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const alpha = rgba[offset + 3];
      if (alpha < 24) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      red += rgba[offset];
      green += rgba[offset + 1];
      blue += rgba[offset + 2];
      opaquePixels += 1;
    }
  }
  if (right < left || bottom < top) throw new Error('衣服領域を認識できませんでした');
  const averageColor = `rgb(${Math.round(red / Math.max(1, opaquePixels))},${Math.round(green / Math.max(1, opaquePixels))},${Math.round(blue / Math.max(1, opaquePixels))})`;
  return { image, width, height, left, top, right, bottom, averageColor };
}

function keepCentralGarmentMaskComponent(
  maskContext: CanvasRenderingContext2D,
  width: number,
  height: number,
  modelBounds: { left: number; top: number; right: number; bottom: number },
) {
  const mask = maskContext.getImageData(0, 0, width, height);
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const bestComponent = new Uint8Array(pixelCount);
  const component = new Int32Array(pixelCount);
  let bestScore = -1;
  const centerX = (modelBounds.left + modelBounds.right) / 2;
  const centerY = modelBounds.top + (modelBounds.bottom - modelBounds.top) * 0.42;

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || mask.data[(start * 4) + 3] < 24) continue;
    let componentSize = 0;
    let queueHead = 0;
    component[componentSize++] = start;
    visited[start] = 1;
    let sumX = 0;
    let sumY = 0;
    while (queueHead < componentSize) {
      const current = component[queueHead++];
      const x = current % width;
      const y = Math.floor(current / width);
      sumX += x;
      sumY += y;
      const neighbours = [
        x > 0 ? current - 1 : -1,
        x < width - 1 ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y < height - 1 ? current + width : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || next >= pixelCount || visited[next]) continue;
        if (mask.data[(next * 4) + 3] < 24) continue;
        visited[next] = 1;
        component[componentSize++] = next;
      }
    }
    const componentCenterX = sumX / componentSize;
    const componentCenterY = sumY / componentSize;
    const distance = Math.hypot(componentCenterX - centerX, componentCenterY - centerY);
    const centrality = 1 / (1 + distance / Math.max(width, height));
    const score = componentSize * centrality;
    if (score <= bestScore) continue;
    bestScore = score;
    bestComponent.fill(0);
    for (let index = 0; index < componentSize; index += 1) bestComponent[component[index]] = 1;
  }

  for (let index = 0; index < pixelCount; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (
      !bestComponent[index]
      || x < modelBounds.left
      || x > modelBounds.right
      || y < modelBounds.top
      || y > modelBounds.bottom
    ) {
      mask.data[(index * 4) + 3] = 0;
    }
  }
  maskContext.putImageData(mask, 0, 0);
}

async function buildFabricModelGarmentMask(imageUrl: string): Promise<MaterialCutoutResult> {
  let result: MaterialCutoutResult;
  let deterministicError: unknown;
  try {
    // The current fabric fixture is a white-background garment image. Prefer
    // the bounded local cutout for that known input shape so a cold/blocked
    // semantic ONNX asset cannot stall the provider request. The semantic
    // model remains an opt-in secondary lane for non-uniform backgrounds.
    result = await withTimeout(
      buildWhiteBackgroundGarmentCutoutDataUrl({
        imageUrl,
        preserveSourceFrame: true,
      }),
      FABRIC_MODEL_MASK_TIMEOUT_MS,
      'モデル画像の白背景衣服マスク生成がタイムアウトしました。背景が単色の画像で再試行してください',
    );
  } catch (error) {
    deterministicError = error;
    try {
      result = await withTimeout(
        buildPortraitGarmentPriorCutoutDataUrl({
          imageUrl,
          preserveSourceFrame: true,
        }),
        FABRIC_MODEL_MASK_TIMEOUT_MS,
        'モデル画像から衣服領域を確定できませんでした。柄が見える縦長画像で再試行してください',
      );
    } catch (semanticError) {
      deterministicError = { deterministicError, portraitPriorError: semanticError };
      if (!isPrintGarmentClothModelConfigured()) throw semanticError;
      try {
        result = await withTimeout(
          buildHighPrecisionMaterialCutoutDataUrl({
            imageUrl,
            modelName: 'u2net_cloth_seg',
            segmentationTarget: 'upper',
            postProcessMask: false,
            preserveSourceFrame: true,
          }),
          FABRIC_MODEL_MASK_TIMEOUT_MS,
          'モデル画像の衣服領域認識がタイムアウトしました。別の画像で再試行してください',
        );
      } catch (semanticModelError) {
        console.warn('Fabric provider mask generation failed in deterministic, portrait-prior, and semantic lanes.', {
          deterministicError,
          semanticModelError,
        });
        throw semanticModelError;
      }
    }
  }
  const isDedicatedClothResult = result.engine === 'browser-ai-u2net_cloth_seg-v1'
    && result.segmentationTarget === 'upper';
  const isSafeWhiteBackgroundFallback = result.engine === 'browser-local-white-background-garment-cutout-v1'
    && result.hasTransparentPixels;
  const isSafePortraitPriorFallback = result.engine === 'browser-local-portrait-garment-prior-v1'
    && result.hasTransparentPixels;
  if (!isDedicatedClothResult && !isSafeWhiteBackgroundFallback && !isSafePortraitPriorFallback) {
    throw new Error('モデル画像の衣服領域を専用AIで確定できませんでした。服が見える画像で再試行してください');
  }
  return result;
}

async function renderFabricTryOnComposition({
  stageWidth,
  stageHeight,
  modelUrl,
  fabricOverlayUrl,
  garmentMaskUrl,
  backgroundColor,
  variant,
}: {
  stageWidth: number;
  stageHeight: number;
  modelUrl: string;
  fabricOverlayUrl: string;
  garmentMaskUrl: string;
  backgroundColor: string;
  variant: { profile: FabricMaterialProfile };
}) {
  const [model, fabric, garmentMask] = await Promise.all([
    loadImage(modelUrl),
    loadImageAlphaBounds(fabricOverlayUrl),
    loadImageAlphaBounds(garmentMaskUrl),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = stageWidth;
  canvas.height = stageHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('生地合成用Canvasを初期化できませんでした');

  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, stageWidth, stageHeight);
  const modelWidth = Math.min(stageWidth * 0.92, stageHeight * (model.width / model.height));
  const modelHeight = modelWidth * (model.height / model.width);
  const modelX = (stageWidth - modelWidth) / 2;
  const modelY = (stageHeight - modelHeight) / 2;
  context.drawImage(model, modelX, modelY, modelWidth, modelHeight);
  const modelImageData = context.getImageData(0, 0, stageWidth, stageHeight);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = stageWidth;
  maskCanvas.height = stageHeight;
  const maskContext = maskCanvas.getContext('2d');
  if (!maskContext) throw new Error('衣服領域マスク用Canvasを初期化できませんでした');
  const maskWidth = Math.min(stageWidth * 0.92, stageHeight * (garmentMask.width / garmentMask.height));
  const maskHeight = maskWidth * (garmentMask.height / garmentMask.width);
  const maskX = (stageWidth - maskWidth) / 2;
  const maskY = (stageHeight - maskHeight) / 2;
  maskContext.drawImage(garmentMask.image, maskX, maskY, maskWidth, maskHeight);

  // Cloth segmentation can produce small disconnected false positives in
  // foliage/background regions. Keep only the central garment component and
  // hard-clip it to the opaque model rectangle before any texture is drawn.
  keepCentralGarmentMaskComponent(maskContext, stageWidth, stageHeight, {
    left: Math.floor(modelX),
    top: Math.floor(modelY),
    right: Math.ceil(modelX + modelWidth),
    bottom: Math.ceil(modelY + modelHeight),
  });

  const maskImageData = maskContext.getImageData(0, 0, stageWidth, stageHeight);
  const maskRgba = maskImageData.data;
  const refinedMask = refineCoarseGarmentMask({
    mask: maskRgba,
    source: modelImageData.data,
    width: stageWidth,
    height: stageHeight,
    modelBounds: {
      left: modelX,
      top: modelY,
      right: modelX + modelWidth,
      bottom: modelY + modelHeight,
    },
  });
  if (refinedMask.coarseMaskWasRectangular) {
    if (!refinedMask.refined) {
      throw new Error('モデル画像の衣服輪郭を精密化できませんでした。服全体が見える画像で再試行してください');
    }
    for (let index = 0; index < refinedMask.alpha.length; index += 1) {
      maskRgba[(index * 4) + 3] = refinedMask.alpha[index];
    }
    maskContext.putImageData(maskImageData, 0, 0);
  }
  let targetLeft = stageWidth;
  let targetTop = stageHeight;
  let targetRight = -1;
  let targetBottom = -1;
  for (let y = 0; y < stageHeight; y += 1) {
    for (let x = 0; x < stageWidth; x += 1) {
      if (maskRgba[((y * stageWidth) + x) * 4 + 3] < 24) continue;
      targetLeft = Math.min(targetLeft, x);
      targetTop = Math.min(targetTop, y);
      targetRight = Math.max(targetRight, x);
      targetBottom = Math.max(targetBottom, y);
    }
  }
  if (targetRight < targetLeft || targetBottom < targetTop) {
    throw new Error('モデル画像の衣服領域を認識できませんでした');
  }

  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = stageWidth;
  textureCanvas.height = stageHeight;
  const textureContext = textureCanvas.getContext('2d');
  if (!textureContext) throw new Error('生地テクスチャ用Canvasを初期化できませんでした');
  // A flat-lay garment photo contains structural edges (sleeves, placket,
  // collar) that are not material texture. Sampling its centered interior
  // keeps the fabric's tone/weave while preventing those garment boundaries
  // from being stretched across the model garment as artificial seams.
  const fabricBoundsWidth = fabric.right - fabric.left + 1;
  const fabricBoundsHeight = fabric.bottom - fabric.top + 1;
  const coreInsetX = Math.floor(fabricBoundsWidth * 0.28);
  const coreInsetY = Math.floor(fabricBoundsHeight * 0.2);
  const fabricCoreLeft = fabric.left + coreInsetX;
  const fabricCoreTop = fabric.top + coreInsetY;
  const sourceWidth = Math.max(1, fabricBoundsWidth - (coreInsetX * 2));
  const sourceHeight = Math.max(1, fabricBoundsHeight - (coreInsetY * 2));
  const fabricPatchCanvas = document.createElement('canvas');
  fabricPatchCanvas.width = sourceWidth;
  fabricPatchCanvas.height = sourceHeight;
  const fabricPatchContext = fabricPatchCanvas.getContext('2d');
  if (!fabricPatchContext) throw new Error('生地テクスチャ用パッチを初期化できませんでした');
  // The reference garment's alpha is only a spatial hint. Fill any remaining
  // transparent pixels in the interior sample with the sampled fabric color
  // so a small neckline/button gap cannot punch a hole in the target garment.
  fabricPatchContext.fillStyle = fabric.averageColor;
  fabricPatchContext.fillRect(0, 0, sourceWidth, sourceHeight);
  fabricPatchContext.drawImage(
    fabric.image,
    fabricCoreLeft,
    fabricCoreTop,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
  const targetWidth = targetRight - targetLeft + 1;
  const targetHeight = targetBottom - targetTop + 1;
  textureContext.drawImage(
    fabricPatchCanvas,
    0,
    0,
    sourceWidth,
    sourceHeight,
    targetLeft,
    targetTop,
    targetWidth,
    targetHeight,
  );
  // A multiply-only overlay cannot transfer a bright/white reference onto a
  // darker model garment: white multiplied by the cardigan is still the
  // cardigan. Resolve RGB from the reference plus the model's photographed
  // luminance before masking, so cotton/satin also visibly replace the source
  // garment while denim/linen retain their intended tone.
  const materialImageData = textureContext.getImageData(0, 0, stageWidth, stageHeight);
  materialImageData.data.set(applyFabricMaterialResponse({
    materialRgba: materialImageData.data,
    garmentRgba: modelImageData.data,
    width: stageWidth,
    height: stageHeight,
    profile: variant.profile,
  }));
  textureContext.putImageData(materialImageData, 0, 0);
  textureContext.globalCompositeOperation = 'destination-in';
  textureContext.globalAlpha = 1;
  textureContext.drawImage(maskCanvas, 0, 0);

  // The fabric is applied only inside the model's detected upper-garment mask.
  // This is the key invariant that prevents the source shirt silhouette from
  // appearing as a floating rectangle or a second garment around the model.
  context.save();
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 0.96;
  context.drawImage(textureCanvas, 0, 0);
  context.globalCompositeOperation = 'soft-light';
  context.globalAlpha = 0.12;
  context.drawImage(textureCanvas, 0, 0);
  context.restore();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error('生地合成画像の書き出しに失敗しました'));
    }, 'image/png');
  });
  return URL.createObjectURL(blob);
}

// Kept for the legacy editor branch, which still relies on the generic layer
// renderer for print placement previews. Fabric generation intentionally uses
// renderFabricTryOnComposition so a source garment can never escape its target
// model-garment mask.
async function _renderComposition(
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
        ? mode === 'fabric'
          ? Math.min(stageWidth * 0.92, stageHeight * (image.width / image.height))
          : stageWidth * 0.84
        : stageWidth * stageBase * transform.scale * scaleBump;
      const drawWidth = baseWidth;
      const drawHeight = drawWidth * (image.height / image.width);
      const centerX = stageWidth * (transform.x / 100);
      const centerY = stageHeight * (transform.y / 100);

      ctx.save();
      ctx.globalAlpha = transform.opacity;
      ctx.globalCompositeOperation = layer.blendMode ?? 'source-over';
      ctx.filter = layer.filter ?? 'none';
      ctx.translate(centerX, centerY);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
      ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      if (layer.tint) {
        ctx.globalAlpha = transform.opacity * 0.35;
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = layer.tint;
        ctx.fillRect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      }
      ctx.restore();
    } catch {
      // Keep exporting even if one layer fails to load.
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error('Canvas画像の書き出しに失敗しました'));
    }, 'image/png');
  });
  return URL.createObjectURL(blob);
}

// Keep the legacy renderer type-checked for the print editor compatibility
// path even when the active material routes use the masked fabric renderer.
void _renderComposition;

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
  const { setFlowState } = useUnifiedWorkspaceFlow();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, currentBrand, isInitialized: isAuthInitialized, isLoading: isAuthLoading } = useAuthStore();
  const { createProject, deleteProject, addObject, selectObject, saveCurrentProject } = useCanvasStore();
  const mode: WorkbenchMode = location.pathname.includes('printing') ? 'printing' : 'fabric';
  const isPrinting = mode === 'printing';
  // The recorded Light Chain print flow is intentionally direct: reference image
  // -> print upload -> spot/full -> AI generation. Heavy's mask/placement editor
  // remains available as an explicit advanced editor, but it must not become a
  // mandatory extra step in the parity path.
  const lightchainPrintParity = isPrinting;
  const [printCoverageMode, setPrintCoverageMode] = useState<PrintCoverageMode>('spot');
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
  const [providerRightsConfirmed, setProviderRightsConfirmed] = useState(false);
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
  const [fabricPreviewOverlayUrl, setFabricPreviewOverlayUrl] = useState<string | null>(null);
  const [fabricModelGarmentMaskResult, setFabricModelGarmentMaskResult] = useState<MaterialCutoutResult | null>(null);
  const [fabricTryOnPreviewUrl, setFabricTryOnPreviewUrl] = useState<string | null>(null);
  const [fabricPreviewState, setFabricPreviewState] = useState<CutoutState>('idle');
  const [fabricPreviewError, setFabricPreviewError] = useState<string | null>(null);
  const [fabricLayer, setFabricLayer] = useState<AssetLayer | null>(null);
  const [fabricPresetIds, setFabricPresetIds] = useState<string[]>(['cotton', 'denim', 'satin']);
  const [fabricPrompt, setFabricPrompt] = useState('');
  const [fabricImageRatio, setFabricImageRatio] = useState('画像比率自動');
  const [printGarment, setPrintGarment] = useState<SelectedImage | null>(null);
  const [printGarmentCutoutSourceUrl, setPrintGarmentCutoutSourceUrl] = useState<string | null>(null);
  const [printGarmentSelectionMaskUrl, setPrintGarmentSelectionMaskUrl] = useState<string | null>(null);
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
  const [clothModelWarmupStatus, setClothModelWarmupStatus] = useState<'idle' | 'warming' | 'ready' | 'unconfigured' | 'unavailable' | 'error'>('idle');
  const [clothModelWarmupProgress, setClothModelWarmupProgress] = useState<ClothModelWarmupProgress | null>(null);
  const [clothModelWarmupError, setClothModelWarmupError] = useState<string | null>(null);
  const [printDesigns, setPrintDesigns] = useState<SelectedImage[]>([]);
  const [printDesignLayers, setPrintDesignLayers] = useState<AssetLayer[]>([]);
  const [printPlacementSessionOpen, setPrintPlacementSessionOpen] = useState(false);
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
  const fabricPreviewRequestRef = useRef(0);
  const printDesignCutoutRequestRef = useRef(0);
  const printDesignLayerIdsRef = useRef(new Map<string, string>());
  const currentPrintDesignLayerIdsRef = useRef<string[]>([]);
  const printDesignLayerSequenceRef = useRef(0);
  const printPlacementBaselineRef = useRef<PlacementEditBaseline<Transform> | null>(null);
  const printPlacementSessionOpenRef = useRef(false);
  const pendingActivePrintDesignLayerIdRef = useRef<string | null>(null);
  const printDesignReturnIntentRef = useRef<PrintDesignReturnIntent | null>(null);
  const printDesignReturnFrameRef = useRef<number | null>(null);
  const printRequestRevisionRef = useRef(0);
  const generationSequenceRef = useRef(0);
  const fabricHistoryHydrationGenerationRef = useRef(0);
  const surfaceJobSequenceRef = useRef(0);
  const generationRequestRef = useRef<number | null>(null);
  const generationRequestSignatureRef = useRef<string | null>(null);
  const printHistoryHydrationGenerationRef = useRef(0);
  const printHistoryHydratedBrandRef = useRef<string | null>(null);
  const restoredPrintResultUrlsRef = useRef(new Map<string, string>());
  const printHistoryPersistenceGenerationRef = useRef(0);
  const printInputHydrationGenerationRef = useRef(0);
  const printInputHydratedBrandRef = useRef<string | null>(null);
  const restoredPrintInputImagesRef = useRef<RestoredPrintInputImage[]>([]);
  const restoredPrintGarmentArtifactsRef = useRef<RestoredPrintInputImage | null>(null);
  const printInputPersistenceGenerationRef = useRef(0);
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
  const modnetModelConfigured = isPrintGarmentModnetModelConfigured();
  const ben2ModelConfigured = isPrintGarmentBen2ModelConfigured();
  const printGarmentSegmentationStatus = useMemo(() => garmentSelectionModelStatus({
    selectionSource: printGarmentSelectionSource,
    clothModelConfigured,
    modnetModelConfigured,
    ben2ModelConfigured,
    resultEngine: selectedPrintGarmentMaskCandidate?.result.engine,
    requestedTarget: printGarmentSegmentationTarget,
    resultTarget: selectedPrintGarmentMaskCandidate?.result.segmentationTarget,
  }), [ben2ModelConfigured, clothModelConfigured, modnetModelConfigured, printGarmentSegmentationTarget, printGarmentSelectionSource, selectedPrintGarmentMaskCandidate]);
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
  const lightchainPrintReady = lightchainPrintParity
    && Boolean(printGarmentProcessed)
    && printGarmentCutoutState === 'done'
    && printDesignsReady;
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
    fabricPrompt,
    fabricImageRatio,
    printGarmentUrl: printGarment?.url ?? null,
    printGarmentSelectionSource,
    printGarmentSegmentationTarget,
    printGarmentProcessed,
    printGarmentMaskCandidateId: selectedPrintGarmentMaskCandidateId,
    printGarmentMaskRevision,
    printGarmentMaskExplicitlyConfirmed,
    printGarmentCutoutState,
    printCoverageMode,
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
    fabricImageRatio,
    fabricPrompt,
    fabricPresetIds,
    mode,
    placedPrintDesignLayers,
    printGarment?.url,
    printGarmentSelectionSource,
    printGarmentSegmentationTarget,
    printGarmentCutoutState,
    printCoverageMode,
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
    if (!isAuthInitialized || isAuthLoading || currentBrand?.id) return;
    void useAuthStore.getState().refreshCurrentBrand();
  }, [currentBrand?.id, isAuthInitialized, isAuthLoading]);

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
    setProviderRightsConfirmed(false);
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

  useEffect(() => {
    if (!isPrinting || !currentBrand?.id) return;
    const brandId = currentBrand.id;
    const hydrationGeneration = ++printHistoryHydrationGenerationRef.current;
    printHistoryHydratedBrandRef.current = null;
    restoredPrintResultUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    restoredPrintResultUrlsRef.current.clear();
    setGeneratedResults((current) => current.filter(
      (result) => !result.id.startsWith('print-') || result.brandId === brandId,
    ));
    let cancelled = false;
    void restorePrintResultHistory(brandId)
      .then((restoredResults) => {
        if (cancelled || hydrationGeneration !== printHistoryHydrationGenerationRef.current) {
          restoredResults.forEach(releaseRestoredPrintResult);
          return;
        }
        restoredResults.forEach((result) => {
          restoredPrintResultUrlsRef.current.set(result.id, result.imageUrl);
        });
        printHistoryHydratedBrandRef.current = brandId;
        if (restoredResults.length) setGeneratedResultsStale(true);
        setGeneratedResults((current) => {
          if (current.some((result) => result.id.startsWith('print-'))) return current;
          return restoredResults.length ? restoredResults : current;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Printing result history restore skipped.', error);
      });
    return () => {
      cancelled = true;
    };
  }, [currentBrand?.id, isPrinting]);

  useEffect(() => () => {
    restoredPrintResultUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    restoredPrintResultUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!isPrinting || !currentBrand?.id || printHistoryHydratedBrandRef.current !== currentBrand.id) return;
    const brandId = currentBrand.id;
    const persistenceGeneration = ++printHistoryPersistenceGenerationRef.current;
    const results = generatedResults.filter((result) => result.id.startsWith('print-'));
    void persistPrintResultHistory(brandId, results)
      .then(({ assetRefs }) => {
        if (persistenceGeneration !== printHistoryPersistenceGenerationRef.current) return;
        setGeneratedResults((current) => {
          let changed = false;
          const next = current.map((result) => {
          const assetRef = assetRefs[result.id];
            if (assetRef && result.assetRef !== assetRef) {
              changed = true;
              return { ...result, assetRef };
            }
            return result;
          });
          return changed ? next : current;
        });
      })
      .catch((error) => {
        console.warn('Printing result history persistence skipped.', error);
      });
  }, [currentBrand?.id, generatedResults, isPrinting]);

  useEffect(() => {
    if (isPrinting || !currentBrand?.id) return;
    const brandId = currentBrand.id;
    const hydrationGeneration = ++fabricHistoryHydrationGenerationRef.current;
    let cancelled = false;
    setGeneratedResults((current) => current.filter(
      (result) => result.id.startsWith('print-') || result.brandId === brandId,
    ));

    const hydrateFabricHistory = async () => {
      const persistedImages = listWorkspaceGeneratedImages(brandId, user?.id)
        .filter((image) => image.feature_type === FABRIC_PROVIDER_RESULT_FEATURE_TYPE);
      const signedImages = await withSignedImageUrls(persistedImages).catch(() => persistedImages);
      const restoredResults = signedImages
        .map(restoredFabricProviderResult)
        .filter((result): result is WorkbenchResult => Boolean(result));
      if (cancelled || hydrationGeneration !== fabricHistoryHydrationGenerationRef.current) return;
      if (restoredResults.length > 0) {
        setGeneratedResultsStale(true);
        setGeneratedResults((current) => {
          const currentFabricResults = current.filter((result) => !result.id.startsWith('print-'));
          if (currentFabricResults.length > 0) return current;
          return [...restoredResults, ...current.filter((result) => result.id.startsWith('print-'))];
        });
      }
    };

    void hydrateFabricHistory().catch((error) => {
      if (!cancelled) console.warn('Fabric result history restore skipped.', error);
    });
    return () => {
      cancelled = true;
    };
  }, [currentBrand?.id, isPrinting, user?.id]);

  const printSnapshotSignature = useMemo(() => {
    if (!currentBrand?.id || !printGarmentProcessed) return '';
    return buildPrintRequestSignature({
      brandId: currentBrand.id,
      brandName: currentBrand.name || 'brand',
      coverageMode: printCoverageMode,
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
      ...(printableSurfaceEnabled && manualPrintableSurface?.occluder
        ? { surfaceOccluderContentHash: manualPrintableSurface.occluder.contentHash }
        : {}),
      designs: placedPrintDesignLayers.map((layer) => ({
        id: layer.id,
        sourceUrl: layer.originalUrl,
        maskRevision: layer.maskRevision,
        transform: layer.transform,
      })),
    });
  }, [placedPrintDesignLayers, currentBrand?.id, currentBrand?.name, manualPrintableSurface, printableSurfaceEnabled, printCoverageMode, printGarment?.referenceType, printGarmentProcessed, printGarmentMaskRevision, printOutputStageSize, selectedPrintGarmentMaskCandidateId]);

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

  useEffect(() => {
    const requestId = ++fabricPreviewRequestRef.current;
    if (!fabricBase?.url || !fabricDesign?.url) {
      setFabricPreviewOverlayUrl(null);
      setFabricModelGarmentMaskResult(null);
      setFabricTryOnPreviewUrl(null);
      setFabricPreviewState('idle');
      setFabricPreviewError(null);
      return;
    }

    let cancelled = false;
    setFabricPreviewOverlayUrl(null);
    setFabricModelGarmentMaskResult(null);
    setFabricTryOnPreviewUrl(null);
    setFabricPreviewState('processing');
    setFabricPreviewError(null);
    const previewVariant = fabricVariants.find((variant) => fabricPresetIds.includes(variant.id)) ?? fabricVariants[0];
    const previewSize = fabricImageRatio === '正方形 1:1'
      ? { width: 900, height: 900 }
      : fabricImageRatio === '横長 16:9'
        ? { width: 1280, height: 720 }
        : { width: 900, height: 1125 };
    void (async () => {
      // The provider receives the original model and textile references. The
      // browser-side cutout is only a convenience preview and must not turn a
      // valid provider input into a hard generation blocker when a white
      // background or flat swatch defeats the optional segmentation model.
      let overlayUrl = fabricBase.url;
      try {
        overlayUrl = await buildFabricReferenceOverlay(fabricBase.url);
      } catch (error) {
        console.warn('Fabric reference preview cutout unavailable; using raw textile reference.', error);
      }

      try {
        const modelGarmentMaskResult = await buildFabricModelGarmentMask(fabricDesign.url);
        const previewUrl = await renderFabricTryOnComposition({
          stageWidth: previewSize.width,
          stageHeight: previewSize.height,
          modelUrl: fabricDesign.url,
          fabricOverlayUrl: overlayUrl,
          garmentMaskUrl: modelGarmentMaskResult.dataUrl,
          backgroundColor: FABRIC_OUTPUT_BACKGROUND,
          variant: previewVariant,
        });
        return { overlayUrl, modelGarmentMaskResult, previewUrl };
      } catch (error) {
        console.warn('Fabric local try-on preview unavailable; keeping the uploaded model visible.', error);
        return { overlayUrl, modelGarmentMaskResult: null, previewUrl: fabricDesign.url };
      }
    })()
      .then(({ overlayUrl, modelGarmentMaskResult, previewUrl }) => {
        if (cancelled || fabricPreviewRequestRef.current !== requestId) return;
        setFabricPreviewOverlayUrl(overlayUrl);
        setFabricModelGarmentMaskResult(modelGarmentMaskResult);
        setFabricTryOnPreviewUrl(previewUrl);
        setFabricPreviewState('done');
      })
      .catch((error) => {
        if (cancelled || fabricPreviewRequestRef.current !== requestId) return;
        setFabricPreviewOverlayUrl(null);
        setFabricPreviewState('error');
        setFabricPreviewError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [fabricBase?.url, fabricDesign?.url, fabricImageRatio, fabricPresetIds]);

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
      setPrintGarmentSelectionMaskUrl(null);
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
    const restoredArtifact = restoredPrintGarmentArtifactsRef.current;
    if (restoredArtifact?.processedUrl && restoredArtifact.url === printGarment.url) {
      restoredPrintGarmentArtifactsRef.current = null;
      setPrintGarmentCutoutSourceUrl(null);
      setPrintGarmentSelectionMaskUrl(null);
      setPrintGarmentSelectionSource(restoredArtifact.selectionSource ?? 'automatic');
      setPrintGarmentSegmentationTarget(
        restoredArtifact.segmentationTarget ?? DEFAULT_GARMENT_SEGMENTATION_TARGET,
      );
      setPrintGarmentMaskCandidates(
        restoredArtifact.maskCandidates?.length
          ? restoredArtifact.maskCandidates
          : restoredArtifact.processedResult
            ? [{
                candidateId: 'auto',
                label: '復元済み',
                description: '保存済みの切り抜き結果です',
                result: restoredArtifact.processedResult,
              }]
            : [],
      );
      setSelectedPrintGarmentMaskCandidateId(
        (
          restoredArtifact.selectedMaskCandidateId
            ?? restoredArtifact.maskCandidates?.[0]?.candidateId
            ?? 'auto'
        ) as PrintGarmentMaskCandidateId,
      );
      setPrintGarmentMaskRevision(restoredArtifact.maskRevision ?? 0);
      setPrintGarmentMaskExplicitlyConfirmed(restoredArtifact.maskExplicitlyConfirmed ?? false);
      setPrintGarmentProcessed(restoredArtifact.processedUrl);
      setPrintGarmentCutoutState('done');
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
    const cutoutTimeoutMilliseconds = cutoutModel === 'modnet'
      ? MODNET_CUTOUT_TIMEOUT_MS
      : cutoutModel === 'ben2'
      ? BEN2_CUTOUT_TIMEOUT_MS
      : cutoutModel === 'u2net_cloth_seg'
      ? CLOTH_CUTOUT_TIMEOUT_MS
      : CUTOUT_TIMEOUT_MS;
    void withTimeout(
      buildPrintGarmentCutoutDataUrl({
        imageUrl: cutoutSourceUrl,
        modelName: cutoutModel,
        segmentationTarget: printGarmentSegmentationTarget,
        selectionMaskUrl: printGarmentSelectionMaskUrl ?? undefined,
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
  }, [clearManualPrintableSurface, invalidatePrintableSuggestion, printGarment, printGarmentCutoutSourceUrl, printGarmentSelectionMaskUrl, printGarmentSegmentationTarget, printGarmentSelectionSource]);

  useEffect(() => {
    let cancelled = false;
    if (!isPrinting || !printGarment?.url || printGarmentCutoutState !== 'done') {
      setClothModelWarmupStatus('idle');
      setClothModelWarmupProgress(null);
      setClothModelWarmupError(null);
      return () => {
        cancelled = true;
      };
    }
    if (!clothModelConfigured) {
      setClothModelWarmupStatus('unconfigured');
      setClothModelWarmupProgress(null);
      setClothModelWarmupError(null);
      return () => {
        cancelled = true;
      };
    }

    setClothModelWarmupStatus('warming');
    setClothModelWarmupProgress(null);
    setClothModelWarmupError(null);
    void preparePrintGarmentClothModel((progress) => {
      if (cancelled) return;
      setClothModelWarmupProgress(progress);
    })
      .then((result) => {
        if (cancelled) return;
        setClothModelWarmupStatus(result.status);
      })
      .catch((error) => {
        if (cancelled) return;
        setClothModelWarmupStatus('error');
        setClothModelWarmupError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [clothModelConfigured, isPrinting, printGarment?.url, printGarmentCutoutState]);

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

  const handleLegacyPreviewGenerate = async () => {
    return;
    /*
    if (isPrinting) invalidatePrintableSuggestion();
    if (!stageRef.current && !isPrinting) return;
    let generationBrand = currentBrand;
    if (!generationBrand?.id) {
      if (!isAuthInitialized || isAuthLoading) {
        const message = 'ブランド情報を読み込み中です。少し待ってから再試行してください';
        setGenerationError(message);
        toast.error(message);
        return;
      }
      generationBrand = await useAuthStore.getState().refreshCurrentBrand();
    }
    if (!generationBrand?.id) {
      const message = '保存先ブランドを取得できませんでした。ブランド設定を確認して再試行してください';
      setGenerationError(message);
      toast.error(message);
      return;
    }

    if (!providerRightsConfirmed) {
      const message = 'rights_confirmation_required';
      setGenerationError(message);
      toast.error('AI生成前に、アップロード素材の権利・利用許諾を確認してください');
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
    if (isPrinting && !lightchainPrintParity && !hasConfirmedPrintGarmentMask) {
      setPrintGarmentSelectionOpen(true);
      toast.error('青い認識範囲を確認し、「決定」を押してください');
      return;
    }
    if (isPrinting && !lightchainPrintParity && (printPlacementSessionOpen || !printPlacementConfirmed)) {
      toast.error('デザイン配置を「決定」してから生成してください');
      if (printPlacementSessionOpen) focusPrintPlacementPane();
      else openPrintPlacementSession();
      return;
    }
    if (isPrinting && !lightchainPrintParity && !canConfirmPrintPlacement) {
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
      const stageWidth = Math.max(720, Math.round(rect?.width || 960));
      const stageHeight = Math.max(720, Math.round(rect?.height || 960));
      const width = isPrinting
        ? stageWidth
        : fabricImageRatio === '正方形 1:1'
          ? 900
          : fabricImageRatio === '横長 16:9'
            ? 1280
            : 900;
      const height = isPrinting
        ? stageHeight
        : fabricImageRatio === '正方形 1:1'
          ? 900
          : fabricImageRatio === '横長 16:9'
            ? 720
            : 1125;

      if (!isPrinting) {
        const fabricOverlayUrl = fabricPreviewOverlayUrl ?? await buildFabricReferenceOverlay(fabricBase!.url);
        const fabricModelMaskResult = fabricModelGarmentMaskResult ?? await buildFabricModelGarmentMask(fabricDesign!.url);
        if (!isCurrentRequest()) return;

        const variantResults: WorkbenchResult[] = [];
        for (const preset of fabricVariants.filter((variant) => fabricPresetIds.includes(variant.id))) {
          await yieldToBrowser();
          const imageUrl = await withTimeout(
            renderFabricTryOnComposition({
              stageWidth: width,
              stageHeight: height,
              modelUrl: fabricDesign!.url,
              fabricOverlayUrl: fabricOverlayUrl,
              garmentMaskUrl: fabricModelMaskResult.dataUrl,
              backgroundColor: FABRIC_OUTPUT_BACKGROUND,
              variant: preset,
            }),
            COMPOSITION_TIMEOUT_MS,
            '生地プレビューの描画がタイムアウトしました。素材を確認して再試行してください',
          );
          if (!isCurrentRequest()) return;
          variantResults.push({
            id: `${preset.id}-${Date.now()}`,
            brandId: generationBrand.id,
            title: `生地バリエーション: ${preset.name}`,
            note: `${preset.name} の質感で重ねた見本${fabricPrompt.trim() ? ` / ${fabricPrompt.trim()}` : ''}`,
            imageUrl,
            outputSize: { width, height },
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
          brandId: generationBrand.id,
          brandName: generationBrand.name || 'brand',
          coverageMode: printCoverageMode,
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
        brandId: generationBrand.id,
        runId,
        resultKind: 'exact',
        generatedAt,
        title: '配置そのまま',
        note: `${PRINT_COVERAGE_OPTIONS.find((option) => option.value === printCoverageMode)?.label ?? 'スポット'}範囲 / AI再描画なし / 元デザインの色・形・透明度を保持`,
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
        brandId: generationBrand.id,
        runId,
        resultKind: 'fabric',
        generatedAt,
        title: '布になじませる',
        note: `${PRINT_COVERAGE_OPTIONS.find((option) => option.value === printCoverageMode)?.label ?? 'スポット'}範囲 / 輪郭と透明度は固定 / Tシャツの明暗だけをデザインのRGBへ反映`,
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

      if (printCoverageMode === 'full' || !printableSurfaceEnabled || !manualPrintableSurface) {
        setSurfaceConformStatus(printCoverageMode === 'full'
          ? '全体範囲ではスポット専用の布面追従（試験）を省略しました。'
          : '手動の印刷可能面を有効にすると「布面追従（試験）」を追加できます。');
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
        brandId: generationBrand.id,
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
    */
  };

  void handleLegacyPreviewGenerate;

  const handleGenerate = async () => {
    if (isPrinting) invalidatePrintableSuggestion();
    let generationBrand = currentBrand;
    if (!generationBrand?.id) {
      if (!isAuthInitialized || isAuthLoading) {
        const message = 'ブランド情報を読み込み中です。少し待ってから再試行してください';
        setGenerationError(message);
        toast.error(message);
        return;
      }
      generationBrand = await useAuthStore.getState().refreshCurrentBrand();
    }
    if (!generationBrand?.id) {
      const message = '保存先ブランドを取得できませんでした。ブランド設定を確認して再試行してください';
      setGenerationError(message);
      toast.error(message);
      return;
    }
    if (!providerRightsConfirmed) {
      const message = 'rights_confirmation_required';
      setGenerationError(message);
      toast.error('AI生成前に、アップロード素材の権利・利用許諾を確認してください');
      return;
    }
    if (!isPrinting && (!fabricBase || !fabricDesign)) {
      toast.error('生地画像とデザイン画像を入れてください');
      return;
    }
    if (isPrinting && (!printGarment || !printGarmentProcessed || printGarmentCutoutState !== 'done')) {
      toast.error(printGarmentCutoutState === 'processing'
        ? '背景の透明化が完了するまでお待ちください'
        : '参考画像の透明化を完了してください');
      return;
    }
    if (isPrinting && !printDesigns.length) {
      toast.error('プリント画像を1つ以上選択してください');
      return;
    }
    if (isPrinting && printDesignsProcessing) {
      toast.error('プリント画像の透明化が完了するまでお待ちください');
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
      const printReferenceUrls = printDesigns.map((design) => design.url).filter(Boolean).slice(0, 15);
      const printPlacementSummary = placedPrintDesignLayers.map((layer, index) => ({
        index,
        layerId: layer.id,
        x: layer.transform.x,
        y: layer.transform.y,
        scale: layer.transform.scale,
        rotation: layer.transform.rotation,
        opacity: layer.transform.opacity,
        flipX: layer.transform.flipX,
        flipY: layer.transform.flipY,
      }));
      const providerGarmentCutout = isPrinting
        ? selectedPrintGarmentMaskCandidate?.result ?? null
        : fabricModelGarmentMaskResult ?? null;
      if (!providerGarmentCutout) {
        throw new Error('provider_garment_mask_required');
      }
      const providerGarmentMask = await withTimeout(
        buildProviderGarmentEditMask({
          sourceImageUrl: isPrinting ? printGarment!.url : fabricDesign!.url,
          garmentCutout: providerGarmentCutout,
        }),
        FABRIC_MODEL_MASK_TIMEOUT_MS,
        '衣服領域マスクの生成がタイムアウトしました。画像を確認して再試行してください',
      );
      if (!isCurrentRequest()) return;
      const providerPrompt = isPrinting
        ? buildLightchainProviderPrompt({
            toolId: 'printing-image',
            toolTitle: 'プリントイメージ',
            summary: `${PRINT_COVERAGE_OPTIONS.find((option) => option.value === printCoverageMode)?.label ?? 'スポット'}範囲 / ${printPlacementSummary.length}件 / 出力倍率${printOutputScale}x`,
            primaryName: printGarment?.file?.name ?? '参考画像',
            secondaryName: printDesigns[0]?.file?.name ?? 'プリント画像',
            brief: '参考画像の服の形・縫製・明暗を保ったまま、プリント画像を指定範囲へ自然に配置する',
            referenceNote: '服の外側や無関係な背景をデザインとして扱わず、プリントの輪郭・色・向き・透明度を保持する',
          })
        : buildLightchainProviderPrompt({
            toolId: 'fabric-image',
            toolTitle: '生地イメージ',
            summary: `${fabricImageRatio} / ${fabricPresetIds.map((id) => fabricVariants.find((variant) => variant.id === id)?.name ?? id).join('・')}`,
            primaryName: fabricDesign?.file?.name ?? 'モデル/デザイン画像',
            secondaryName: fabricBase?.file?.name ?? '生地画像',
            brief: fabricPrompt.trim() || '白い衣服に指定した生地の質感と柄を自然に反映する',
            referenceNote: 'モデル/デザイン画像を主画像、生地画像を質感・柄の参照として扱い、衣服の形・構造・人物を変更しない',
          });
      const parityRuntime = buildLightchainParityRuntime({
        rowId: isPrinting ? 'printing-image' : 'fabric-image',
        inputRoles: isPrinting ? ['garment', 'print-artwork'] : ['model-or-design', 'textile'],
        fixtureId: [
          isPrinting ? printGarment!.url : fabricDesign!.url,
          ...(isPrinting ? printReferenceUrls : [fabricBase!.url]),
        ].join('|'),
        settings: {
          mode,
          coverage: isPrinting ? printCoverageMode : null,
          outputScale: isPrinting ? printOutputScale : null,
          fabricImageRatio: isPrinting ? null : fabricImageRatio,
          fabricPresetIds: isPrinting ? [] : fabricPresetIds,
          placement: isPrinting ? printPlacementSummary : [],
        },
      });
      const parityRuntimeJson = serializeLightchainParityRuntime(parityRuntime);
      const inputLineage: MaterialInputLineage[] = isPrinting
        ? [
            {
              role: 'garment',
              sourceImageId: printGarment?.galleryImageId ?? null,
              sourceStoragePath: printGarment?.storagePath ?? null,
              referenceType: printGarment?.referenceType ?? null,
            },
            ...printDesigns.map((design) => ({
              role: 'print-artwork' as const,
              sourceImageId: design.galleryImageId ?? null,
              sourceStoragePath: design.storagePath ?? null,
              referenceType: design.referenceType ?? null,
            })),
          ]
        : [
            {
              role: 'model-or-design',
              sourceImageId: fabricDesign?.galleryImageId ?? null,
              sourceStoragePath: fabricDesign?.storagePath ?? null,
              referenceType: fabricDesign?.referenceType ?? null,
            },
            {
              role: 'textile',
              sourceImageId: fabricBase?.galleryImageId ?? null,
              sourceStoragePath: fabricBase?.storagePath ?? null,
              referenceType: fabricBase?.referenceType ?? null,
            },
          ];
      const providerResult = await withTimeout(
        isPrinting
          ? editImageWithPrompt(
              printGarment!.url,
              providerPrompt,
              generationBrand.id,
              {
                referenceImageUrls: printReferenceUrls,
                maskDataUrl: providerGarmentMask.dataUrl,
                maskApplied: true,
                maskCoveragePercent: providerGarmentMask.coveragePercent,
                maskWidth: providerGarmentMask.width,
                maskHeight: providerGarmentMask.height,
                providerModel: 'gpt-image-1',
                inputFidelity: 'high',
                quality: 'high',
                rightsConfirmed: providerRightsConfirmed,
                lightchainCompat: {
                  lightchainFeatureId: 'printing-image',
                  lightchainFeatureTitle: 'プリントイメージ',
                  lightchainTaskCodes: ['printing_image', 'print_artwork_transfer'],
                },
                generationIntent: {
                  feature: 'printing-image',
                  coverageMode: printCoverageMode,
                  designCount: printReferenceUrls.length,
                },
                materialReferences: [
                  { role: 'garment', referenceType: printGarment?.referenceType ?? null, hasImage: true },
                  ...printDesigns.map((design, index) => ({
                    role: 'print-artwork',
                    index,
                    referenceType: design.referenceType,
                    hasImage: true,
                  })),
                ],
                layerPlan: {
                  primary: 'garment',
                  secondary: 'print-artwork',
                  placement: printPlacementSummary,
                },
                maskPlan: {
                  garmentCutoutReady: Boolean(printGarmentProcessed),
                  garmentMaskCandidate: selectedPrintGarmentMaskCandidateId,
                  garmentMaskRevision: printGarmentMaskRevision,
                  providerMaskReady: true,
                  providerMaskOrientation: providerGarmentMask.orientation,
                  providerMaskCoveragePercent: providerGarmentMask.coveragePercent,
                  providerMaskSourceEngine: providerGarmentMask.sourceEngine,
                },
                compositionPreview: {
                  coverageMode: printCoverageMode,
                  outputScale: printOutputScale,
                  placement: printPlacementSummary,
                  parityRuntime: parityRuntimeJson,
                },
              },
            )
          : editImageWithPrompt(
              fabricDesign!.url,
              providerPrompt,
              generationBrand.id,
              {
                referenceImageUrls: [fabricBase!.url],
                maskDataUrl: providerGarmentMask.dataUrl,
                maskApplied: true,
                maskCoveragePercent: providerGarmentMask.coveragePercent,
                maskWidth: providerGarmentMask.width,
                maskHeight: providerGarmentMask.height,
                providerModel: 'gpt-image-1',
                inputFidelity: 'high',
                quality: 'high',
                rightsConfirmed: providerRightsConfirmed,
                lightchainCompat: {
                  lightchainFeatureId: 'fabric-image',
                  lightchainFeatureTitle: '生地イメージ',
                  lightchainTaskCodes: ['fabric_image', 'fabric_material_transfer'],
                },
                generationIntent: {
                  feature: 'fabric-image',
                  imageRatio: fabricImageRatio,
                  selectedPresets: fabricPresetIds,
                },
                materialReferences: [
                  { role: 'model-or-design', referenceType: fabricDesign?.referenceType ?? null, hasImage: true },
                  { role: 'textile', referenceType: fabricBase?.referenceType ?? null, hasImage: true },
                ],
                layerPlan: {
                  primary: 'model-or-design',
                  secondary: 'textile',
                  materialTransfer: 'garment-only',
                },
                maskPlan: {
                  modelGarmentMaskReady: true,
                  textileReferenceMaskReady: Boolean(fabricPreviewOverlayUrl),
                  providerMaskReady: true,
                  providerMaskOrientation: providerGarmentMask.orientation,
                  providerMaskCoveragePercent: providerGarmentMask.coveragePercent,
                  providerMaskSourceEngine: providerGarmentMask.sourceEngine,
                },
                compositionPreview: {
                  imageRatio: fabricImageRatio,
                  selectedPresets: fabricPresetIds,
                  source: 'uploaded-reference-pair',
                  parityRuntime: parityRuntimeJson,
                },
              },
            ),
        PROVIDER_GENERATION_TIMEOUT_MS,
        isPrinting ? 'プリント画像のAI生成がタイムアウトしました。素材を確認して再試行してください' : '生地画像のAI生成がタイムアウトしました。素材を確認して再試行してください',
      );
      if (!isCurrentRequest()) return;
      assertCompletedImageEditResult(providerResult, `provider_${mode}_result`);
      const protectedComposite = await withTimeout(
        composeProviderProtectedResult({
          sourceImageUrl: isPrinting ? printGarment!.url : fabricDesign!.url,
          providerImageUrl: providerResult.imageUrl,
          maskDataUrl: providerGarmentMask.dataUrl,
        }),
        30_000,
        'AI生成結果の衣服外領域を元画像へ戻せませんでした。画像を確認して再試行してください',
      );
      const outputImage = await loadImage(protectedComposite.dataUrl);
      if (!isCurrentRequest()) return;
      const generatedAt = Date.now();
      const runId = isPrinting ? `print-provider-${generatedAt}` : `fabric-provider-${generatedAt}`;
      const result: WorkbenchResult = {
        id: `${runId}-result`,
        brandId: generationBrand.id,
        runId,
        resultKind: 'provider',
        generatedAt,
        title: isPrinting ? 'プリントイメージ AI生成' : '生地イメージ AI生成',
        note: isPrinting
          ? `${PRINT_COVERAGE_OPTIONS.find((option) => option.value === printCoverageMode)?.label ?? 'スポット'}範囲 / OpenAI画像編集 / 服の形状を保持`
          : `${fabricImageRatio} / OpenAI画像編集 / 選択した生地参照を衣服領域へ反映`,
        imageUrl: protectedComposite.dataUrl,
        outputSize: {
          width: Math.max(1, outputImage.naturalWidth || outputImage.width),
          height: Math.max(1, outputImage.naturalHeight || outputImage.height),
        },
        generationMode: 'provider',
        provider: providerResult.provider ?? 'openai',
        backendProvider: providerResult.backendProvider ?? 'supabase-edge-function:edit-image',
        jobId: providerResult.jobId ?? null,
        imageId: providerResult.imageId ?? null,
        storagePath: providerResult.storagePath ?? null,
        inputImageCount: providerResult.inputImageCount ?? (1 + (isPrinting ? printReferenceUrls.length : 1)),
        maskApplied: providerResult.maskApplied === true,
        maskCoveragePercent: providerResult.maskCoveragePercent ?? providerGarmentMask.coveragePercent,
        maskWidth: providerResult.maskWidth ?? providerGarmentMask.width,
        maskHeight: providerResult.maskHeight ?? providerGarmentMask.height,
        providerModel: providerResult.providerModel ?? 'gpt-image-1',
        inputFidelity: providerResult.inputFidelity ?? 'high',
        quality: providerResult.quality ?? 'high',
        protectedRegionComposited: true,
        persistenceStatus: providerResult.persistenceStatus ?? null,
        inputLineage,
        parityRuntime: parityRuntimeJson,
      };
      const persistedProviderArtifact = await persistProviderResultArtifact({
        brandId: generationBrand.id,
        scopeId: user?.id,
        featureType: `lightchain-${isPrinting ? 'printing-image' : 'fabric-image'}-provider-result`,
        title: result.title,
        imageUrl: result.imageUrl,
        prompt: providerPrompt,
        sourceJobId: result.jobId,
        storagePath: result.storagePath,
        requireRemote: true,
        reuseCanonicalRemoteArtifact: false,
        metadata: {
          sourceWorkspace: 'lightchain-material-workbench-provider-result',
          resultKind: result.resultKind ?? 'provider',
          toolId: isPrinting ? 'printing-image' : 'fabric-image',
          toolTitle: result.title,
          brief: isPrinting
            ? `${PRINT_COVERAGE_OPTIONS.find((option) => option.value === printCoverageMode)?.label ?? 'スポット'}範囲でプリントを配置する`
            : fabricPrompt.trim() || '白い衣服に指定した生地の質感と柄を自然に反映する',
          referenceNote: isPrinting
            ? '服の外側や無関係な背景をデザインとして扱わず、プリントの輪郭・色・向き・透明度を保持する'
            : 'モデル/デザイン画像を主画像、生地画像を質感・柄の参照として扱い、衣服の形・構造・人物を変更しない',
          sourceLabel: result.title,
          sourceResumePath: `/lightchain/${isPrinting ? 'printing-image' : 'fabric-image'}`,
          mode,
          providerJobId: result.jobId ?? null,
          providerImageId: result.imageId ?? null,
          providerStoragePath: result.storagePath ?? null,
          provider: result.provider ?? null,
          backendProvider: result.backendProvider ?? null,
          imageId: result.imageId ?? null,
          providerModel: result.providerModel ?? null,
          inputFidelity: result.inputFidelity ?? null,
          quality: result.quality ?? null,
          inputImageCount: result.inputImageCount ?? null,
          outputSize: result.outputSize ?? null,
          generatedAt: result.generatedAt ?? null,
          persistenceStatus: result.persistenceStatus ?? null,
          protectedRegionComposited: result.protectedRegionComposited ?? false,
          maskApplied: result.maskApplied ?? false,
          maskCoveragePercent: result.maskCoveragePercent ?? null,
          generationInputSignature: generationInputSignatureRef.current,
          generationIntent: isPrinting
            ? {
                feature: 'printing-image',
                coverageMode: printCoverageMode,
                designCount: printReferenceUrls.length,
              }
            : {
                feature: 'fabric-image',
                imageRatio: fabricImageRatio,
                selectedPresets: fabricPresetIds,
              },
          materialReferences: isPrinting
            ? [
                { role: 'garment', referenceType: printGarment?.referenceType ?? null, hasImage: true },
                ...printDesigns.map((design, index) => ({
                  role: 'print-artwork',
                  index,
                  referenceType: design.referenceType,
                  hasImage: true,
                })),
              ]
            : [
                { role: 'model-or-design', referenceType: fabricDesign?.referenceType ?? null, hasImage: true },
                { role: 'textile', referenceType: fabricBase?.referenceType ?? null, hasImage: true },
              ],
          layerPlan: isPrinting
            ? {
                primary: 'garment',
                secondary: 'print-artwork',
                placement: printPlacementSummary,
              }
            : {
                primary: 'model-or-design',
                secondary: 'textile',
                materialTransfer: 'garment-only',
              },
          maskPlan: isPrinting
            ? {
                garmentCutoutReady: Boolean(printGarmentProcessed),
                garmentMaskCandidate: selectedPrintGarmentMaskCandidateId,
                garmentMaskRevision: printGarmentMaskRevision,
                providerMaskReady: true,
                providerMaskOrientation: providerGarmentMask.orientation,
                providerMaskCoveragePercent: providerGarmentMask.coveragePercent,
                providerMaskSourceEngine: providerGarmentMask.sourceEngine,
              }
            : {
                modelGarmentMaskReady: true,
                textileReferenceMaskReady: Boolean(fabricPreviewOverlayUrl),
                providerMaskReady: true,
                providerMaskOrientation: providerGarmentMask.orientation,
                providerMaskCoveragePercent: providerGarmentMask.coveragePercent,
                providerMaskSourceEngine: providerGarmentMask.sourceEngine,
              },
          inputLineage: result.inputLineage ?? [],
          parityRuntime: parityRuntimeJson,
        },
      });
      let persistedResult: WorkbenchResult = {
        ...result,
        jobId: persistedProviderArtifact.remote?.jobId ?? result.jobId,
        imageId: persistedProviderArtifact.remote?.imageId ?? result.imageId,
        storagePath: persistedProviderArtifact.remote?.storagePath ?? result.storagePath,
        artifactId: persistedProviderArtifact.artifact.id,
      };
      if (isPrinting) {
        const { assetRefs } = await persistPrintResultHistory(generationBrand.id, [persistedResult]);
        const assetRef = assetRefs[persistedResult.id];
        if (!assetRef) throw new Error('print_result_history_persistence_unverified');
        persistedResult = { ...persistedResult, assetRef };
      }
      setGeneratedResults((previous) => isPrinting
        ? mergePrintResultHistory([persistedResult], previous.filter((candidate) => candidate.id.startsWith('print-')))
        : [persistedResult, ...previous.filter((candidate) => !candidate.id.startsWith('print-'))]);
      setProgressivePrintRun(null);
      setPendingSurfaceJob(null);
      setSurfaceConformStatus(null);
      setGeneratedResultsStale(false);
      setGenerationError(null);
      toast.success('OpenAI画像編集の生成結果を履歴に追加しました');
    } catch (error: any) {
      console.error('Provider generation failed', error);
      if (isCurrentRequest()) {
        const message = error?.message || 'provider_generation_failed';
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
      if (lightchainPrintParity) {
        setPrintPlacementSessionOpen(false);
        printPlacementSessionOpenRef.current = false;
      } else {
        openPrintPlacementSession();
      }
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
    const restoredProcessedIndexes = new Set<number>();
    nextImages.forEach((image, index) => {
      const restoredImage = image as SelectedImage & RestoredPrintInputImage;
      if (!restoredImage.processedUrl) return;
      restoredProcessedIndexes.add(index);
      initialStates[index] = 'done';
      processedUrls[index] = restoredImage.processedUrl;
      if (restoredImage.processedResult) {
        processedResults[index] = restoredImage.processedResult;
      }
      initialMaskRevisions[index] = restoredImage.maskRevision ?? 0;
    });
    setPrintDesignProcessedUrls({ ...processedUrls });
    setPrintDesignCutoutResults({ ...processedResults });
    setPrintDesignMaskRevisions(initialMaskRevisions);
    setPrintDesignCutoutStates(initialStates);
    setPrintDesignCutoutErrors({});
    if (duplicateTargetLayerId) scheduleDeferredPrintDesignReturn(duplicateTargetLayerId);

    for (const index of reconciliation.processOrder) {
      if (restoredProcessedIndexes.has(index)) continue;
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

  const resetPrintingInputs = useCallback(() => {
    if (!isPrinting) return;
    setPrintGarment(null);
    setPrintDesigns([]);
    setPrintDesignLayers([]);
    setPrintDesignProcessedUrls({});
    setPrintDesignCutoutResults({});
    setPrintDesignMaskRevisions({});
    setPrintDesignCutoutStates({});
    setPrintDesignCutoutErrors({});
    setPrintGarmentMaskExplicitlyConfirmed(false);
    setPrintGarmentSelectionSource('automatic');
    setPrintGarmentCutoutSourceUrl(null);
    setPrintGarmentSelectionMaskUrl(null);
    setPrintGarmentCutoutState('idle');
    setPrintGarmentProcessed(null);
    setPrintPlacementConfirmed(false);
    setPrintPlacementSessionOpen(false);
    printPlacementSessionOpenRef.current = false;
    setPrintCoverageMode('spot');
    setPrintOutputScale(1);
    setGenerationError(null);
    setSurfaceConformStatus(null);
  }, [isPrinting]);

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
      ...(handoff.design.storagePath ? { storagePath: handoff.design.storagePath } : {}),
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

  const selectPrintGarment = (
    image: SelectedImage | null,
    restoredArtifact: RestoredPrintInputImage | null = null,
  ) => {
    cancelScheduledPrintDesignReturn();
    printDesignReturnIntentRef.current = null;
    invalidatePrintableSuggestion();
    setPrintPlacementConfirmed(false);
    if (placedPrintDesignLayers.length > 0) openPrintPlacementSession();
    setPrintGarmentCutoutSourceUrl(null);
    setPrintGarmentSelectionMaskUrl(null);
    setPrintGarmentSelectionSource('automatic');
    setPrintGarmentMaskExplicitlyConfirmed(false);
    setPrintGarmentSegmentationTarget(DEFAULT_GARMENT_SEGMENTATION_TARGET);
    restoredPrintGarmentArtifactsRef.current = restoredArtifact?.processedUrl ? restoredArtifact : null;
    setPrintGarment(image);
  };

  useEffect(() => {
    if (!isPrinting || !isAuthInitialized || isAuthLoading || !currentBrand?.id) return;
    const brandId = currentBrand.id;
    const hydrationGeneration = ++printInputHydrationGenerationRef.current;
    printInputHydratedBrandRef.current = null;
    restoredPrintInputImagesRef.current.forEach((image) => releaseRestoredPrintInput(image));
    restoredPrintInputImagesRef.current = [];
    let cancelled = false;

    void restorePrintInputState(brandId)
      .then(async (restored) => {
        const restoredImages = [
          ...(restored.garment ? [restored.garment] : []),
          ...restored.designs,
        ];
        if (cancelled || hydrationGeneration !== printInputHydrationGenerationRef.current) {
          restoredImages.forEach((image) => releaseRestoredPrintInput(image));
          return;
        }
        restoredPrintInputImagesRef.current = restoredImages;
        if (restored.garment) selectPrintGarment(restored.garment, restored.garment);
        if (restored.designs.length > 0) {
          const result = await addDesigns(restored.designs);
          if (!result.ok) {
            toast.error(`保存済みデザインの復元に失敗しました: ${result.reason}`);
          }
        }
        if (!cancelled && hydrationGeneration === printInputHydrationGenerationRef.current) {
          printInputHydratedBrandRef.current = brandId;
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Printing input restore skipped.', error);
        printInputHydratedBrandRef.current = brandId;
      });

    return () => {
      cancelled = true;
    };
    // addDesigns/selectPrintGarment intentionally bind to the current workbench session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBrand?.id, isAuthInitialized, isAuthLoading, isPrinting]);

  useEffect(() => () => {
    restoredPrintInputImagesRef.current.forEach((image) => releaseRestoredPrintInput(image));
    restoredPrintInputImagesRef.current = [];
  }, []);

  useEffect(() => {
    if (!isPrinting || !currentBrand?.id || printInputHydratedBrandRef.current !== currentBrand.id) return;
    const brandId = currentBrand.id;
    const persistenceGeneration = ++printInputPersistenceGenerationRef.current;
    const processedState: PrintInputProcessedState = {
      garment: printGarment
        ? {
            processedUrl: printGarmentProcessed,
            processedResult: selectedPrintGarmentMaskCandidate?.result ?? null,
            maskCandidates: printGarmentMaskCandidates,
            selectedMaskCandidateId: selectedPrintGarmentMaskCandidateId,
            maskRevision: printGarmentMaskRevision,
            maskExplicitlyConfirmed: printGarmentMaskExplicitlyConfirmed,
            selectionSource: printGarmentSelectionSource,
            segmentationTarget: printGarmentSegmentationTarget,
          }
        : null,
      designs: printDesigns.map((_, index) => ({
        processedUrl: printDesignProcessedUrls[index] ?? null,
        processedResult: printDesignCutoutResults[index] ?? null,
        maskRevision: printDesignMaskRevisions[index] ?? 0,
      })),
    };
    void persistPrintInputState(brandId, printGarment, printDesigns, processedState)
      .catch((error) => {
        if (persistenceGeneration !== printInputPersistenceGenerationRef.current) return;
        console.warn('Printing input persistence skipped.', error);
      });
  }, [
    currentBrand?.id,
    isPrinting,
    printDesigns,
    printGarment,
    printGarmentMaskCandidates,
    printGarmentMaskExplicitlyConfirmed,
    printGarmentMaskRevision,
    printGarmentProcessed,
    printGarmentSelectionSource,
    printGarmentSegmentationTarget,
    printDesignCutoutResults,
    printDesignMaskRevisions,
    printDesignProcessedUrls,
    selectedPrintGarmentMaskCandidate,
    selectedPrintGarmentMaskCandidateId,
  ]);

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
    selectionMaskUrl?: string,
  ) => {
    invalidatePrintableSuggestion();
    setPrintGarmentSelectionOpen(false);
    setPrintGarmentCutoutSourceUrl(selectedImageUrl);
    setPrintGarmentSelectionMaskUrl(selectionMaskUrl ?? null);
    setPrintGarmentSelectionSource(selectionSource);
    setPrintGarmentMaskExplicitlyConfirmed(selectionSource === 'tap');
    setPrintGarmentSegmentationTarget(segmentationTarget);
    setPrintGarmentCutoutState('processing');
    setPrintGarmentCutoutError(null);
    setPrintGarmentProcessed(null);
    setPrintMaskEditorTarget(null);
    toast.success(selectionSource === 'tap'
      ? '元画像に衣服カテゴリAIを適用し、確認マスクで範囲を制約しています'
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

  const openDesignMaskEditor = async (index: number) => {
    const design = printDesigns[index];
    const maskUrl = printDesignProcessedUrls[index];
    if (!design || !maskUrl) return;
    invalidatePrintableSuggestion();
    setPrintMaskEditorError(null);
    let result = printDesignCutoutResults[index];
    if (!result) {
      try {
        // Restored print inputs may retain the processed preview URL before
        // the richer cutout metadata has been rehydrated. Rebuild a bounded
        // manual-mask result from the exact visible preview instead of
        // silently making the Light Chain adjustment control inert.
        result = await buildManualMaskSourceResult(maskUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'プリント画像のマスク編集を開始できませんでした';
        setPrintMaskEditorError(message);
        toast.error(message);
        return;
      }
    }
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

  const fabricStageBackground = 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(59,130,246,0.15), rgba(15,23,42,0.8))';

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
      scopeId: user?.id,
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

  const saveResultToCanvas = (result: WorkbenchResult) => {
    if (!currentBrand?.id || result.brandId !== currentBrand.id) {
      toast.error('ブランドが変わったためCanvasへ保存できません。現在のブランドで再生成してください');
      return;
    }
    const projectId = createProject(`Lightchain: ${result.title}`, currentBrand.id);
    // Provider results are rendered from the protected in-memory composite,
    // which is intentionally a data URL. Once the provider artifact has been
    // persisted, keep only its canonical Storage path in the local artifact
    // ledger so a large PNG cannot exhaust localStorage before Canvas opens.
    // The Canvas object below still receives result.imageUrl for the active
    // session and carries the same path for remote/local readback.
    const canvasArtifactImageUrl = result.storagePath ? '' : result.imageUrl;
    const parityRuntimeJson = result.parityRuntime ?? serializeLightchainParityRuntime(buildLightchainParityRuntime({
      rowId: isPrinting ? 'printing-image' : 'fabric-image',
      inputRoles: isPrinting ? ['garment', 'print-artwork'] : ['model-or-design', 'textile'],
      fixtureId: `${result.id}:${result.jobId ?? 'unknown'}`,
    }));
    const artifact = saveWorkspaceArtifactPersisted({
      id: result.id,
      brandId: currentBrand.id,
      scopeId: user?.id,
      featureType: 'lightchain-material-result',
      title: result.title,
      imageUrl: canvasArtifactImageUrl,
      prompt: result.note,
      canvasProjectId: projectId,
      sourceJobId: result.jobId ?? undefined,
      metadata: {
        title: result.title,
        source: 'lightchain-material-provider-v1',
        sourceProviderResultArtifactId: result.artifactId ?? null,
        generationMode: result.generationMode ?? 'provider',
        provider: result.provider ?? null,
        backendProvider: result.backendProvider ?? null,
        jobId: result.jobId ?? null,
        imageId: result.imageId ?? null,
        storagePath: result.storagePath ?? null,
        remoteStoragePath: result.storagePath ?? null,
        inputImageCount: result.inputImageCount ?? null,
        maskApplied: result.maskApplied ?? false,
        maskCoveragePercent: result.maskCoveragePercent ?? null,
        maskWidth: result.maskWidth ?? null,
        maskHeight: result.maskHeight ?? null,
        providerModel: result.providerModel ?? null,
        inputFidelity: result.inputFidelity ?? null,
        quality: result.quality ?? null,
        protectedRegionComposited: result.protectedRegionComposited ?? false,
        inputLineage: result.inputLineage ?? [],
        printResultKind: result.resultKind ?? null,
        printResultNote: result.note,
        printResultOutputSize: result.outputSize ?? null,
        printResultGeneratedAt: result.generatedAt ?? null,
        parityRuntime: parityRuntimeJson,
      },
    });
    if (!artifact.ok) {
      deleteProject(projectId);
      toast.error('Canvas保存に失敗しました。生成結果の保存先証跡を確認してください');
      return;
    }
    const objectId = addObject({
      type: 'image',
      x: 96,
      y: 96,
      width: 720,
      height: 720,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      visible: true,
      src: result.imageUrl,
      label: result.title,
      metadata: {
        feature: 'lightchain-material-provider',
        prompt: result.note,
        generation: 1,
        provider: result.provider ?? null,
        backendProvider: result.backendProvider ?? null,
        jobId: result.jobId ?? null,
        imageId: result.imageId ?? null,
        storagePath: result.storagePath ?? null,
        galleryStoragePath: result.storagePath ?? undefined,
        galleryImageId: result.imageId ?? undefined,
        galleryImageUrl: result.imageUrl,
        status: 'completed',
        protectedRegionComposited: result.protectedRegionComposited ?? false,
        inputLineage: result.inputLineage ?? [],
        parityRuntime: parityRuntimeJson,
        lightchainCompat: {
          lightchainFeatureId: isPrinting ? 'printing-image' : 'fabric-image',
          lightchainFeatureTitle: isPrinting ? 'プリントイメージ' : '生地イメージ',
          lightchainTaskCodes: [isPrinting ? 'printing_image' : 'fabric_image'],
        },
        parameters: {
          sourceProviderResultArtifactId: result.artifactId ?? null,
        },
        legalSafety: { rightsConfirmed: true },
        timestamp: new Date().toISOString(),
      },
    });
    selectObject(objectId);
    saveCurrentProject();
    toast.success('生成結果をCanvasへ保存しました');
    navigate(`/canvas/${projectId}`);
  };

  const favoriteResultIds = useMemo(
    () => {
      void favoriteRevision;
      return new Set(currentBrand?.id ? listPrintResultFavoriteIds(currentBrand.id, user?.id) : []);
    },
    [currentBrand?.id, favoriteRevision, user?.id],
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

  const clearFabricResultHistory = () => {
    const fabricResults = generatedResults
      .filter((result) => !result.id.startsWith('print-'));
    if (fabricResults.length === 0) return;
    const artifactIds = fabricResults
      .map((result) => result.artifactId)
      .filter((artifactId): artifactId is string => Boolean(artifactId));
    if (currentBrand?.id && artifactIds.length > 0) {
      const deleted = deleteWorkspaceArtifactsPersisted(currentBrand.id, artifactIds, user?.id);
      if (!deleted.ok) {
        toast.error('生地生成履歴の保存証跡を削除できませんでした');
        return;
      }
    }
    const fabricResultIds = new Set(fabricResults.map((result) => result.id));
    setGeneratedResults((current) => current.filter((result) => !fabricResultIds.has(result.id)));
    setSelectedResult((current) => current && fabricResultIds.has(current.id) ? null : current);
    setGeneratedResultsStale(false);
    toast.success('生地生成履歴をすべて削除しました');
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
  const materialFlowState = deriveUnifiedWorkspaceFlowState({
    inputReady: isPrinting
      ? printingReadinessCompleteCount === printingReadinessSteps.length
      : Boolean(fabricDesign && fabricBase),
    rightsReady: Boolean(providerRightsConfirmed),
    generating: isGenerating,
    completed: generatedResults.length > 0,
    failed: Boolean(generationError),
    persisted: generatedResults.some((result) => result.persistenceStatus === 'completed'),
  });

  useEffect(() => {
    setFlowState(materialFlowState);
  }, [materialFlowState, setFlowState]);
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
  const activeMaterialTab = getLightchainMaterialTab(isPrinting ? 'printing-image' : 'fabric-image');
  const activeMaterialInputs = LIGHTCHAIN_MATERIAL_INPUTS[isPrinting ? 'printing-image' : 'fabric-image'];

  return (
    <div
      data-testid="lightchain-material-workbench"
      data-workbench-mode={isPrinting ? 'printing' : 'fabric'}
      data-workbench-state="hydrated"
      className="min-h-screen bg-[#0b1113] text-white"
    >
      <div className="hidden">
        <aside
          aria-label="Light Chainグラフィックツール"
          className="hidden rounded-2xl border border-white/10 bg-[#111719] p-2 shadow-2xl shadow-black/20 lg:block"
        >
          <div className="sticky top-[88px] flex flex-col items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-300/15 text-cyan-200" aria-hidden="true">
              <Layers3 className="h-5 w-5" />
            </div>
            {LIGHTCHAIN_MATERIAL_TABS.map((tab) => {
              const active = tab.id === activeMaterialTab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => navigate(tab.route)}
                  aria-label={tab.label}
                  aria-pressed={active}
                  className={`flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold leading-4 transition ${active
                    ? 'bg-cyan-300/15 text-cyan-100 ring-1 ring-cyan-200/30'
                    : 'text-white/45 hover:bg-white/[0.06] hover:text-white/80'}`}
                >
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${active ? 'bg-cyan-200 shadow-[0_0_10px_rgba(165,243,252,0.8)]' : 'bg-white/20'}`} />
                  <span className="text-center">{tab.label.replace('イメージ', '').replace('の実写化', '実写')}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0" data-flow-state={materialFlowState} data-flow-state-label={unifiedWorkspaceFlowLabels[materialFlowState]}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <button
            onClick={() => navigate('/generate')}
            className="mb-3 inline-flex items-center gap-2 text-sm text-white/45 transition hover:text-white/80"
          >
            <ArrowLeft className="w-4 h-4" />
            生成一覧へ
          </button>
          <h1 className="mt-2 text-2xl font-display font-semibold text-white sm:text-3xl">
            {activeMaterialTab.label}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-white/55">{activeMaterialTab.description}</p>
          <div className="mt-3 flex flex-wrap gap-2" data-testid="lightchain-material-input-contract">
            {activeMaterialInputs.map((slot, index) => (
              <span key={slot.id} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/55">
                {index + 1}. {slot.label}{slot.required ? ' *' : ''}
              </span>
            ))}
          </div>
          <Link
            to="/history"
            className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-cyan-200 transition hover:text-cyan-100"
          >
            生成履歴を確認
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <nav className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/10 bg-[#111719] p-1" aria-label="素材ツール">
          {LIGHTCHAIN_MATERIAL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigate(tab.route)}
              aria-current={tab.id === activeMaterialTab.id ? 'page' : undefined}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition sm:px-4 sm:text-sm ${tab.id === activeMaterialTab.id
                ? 'bg-[#737d84] text-white shadow-lg shadow-black/20'
                : 'text-white/45 hover:bg-white/[0.06] hover:text-white/80'}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
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
              <h2 className="text-lg font-semibold">{isPrinting ? 'プリントをアップロード' : '生地の上に重ねる'}</h2>
              <p className="text-sm text-white/60">
                {isPrinting ? '服を選び、スポット／全体のプリント効果を確認します。' : '素材を選び、質感違いの見本をまとめて出せます。'}
              </p>
            </div>
          </div>

          {!isPrinting ? (
            <div className="space-y-4">
              <ImageSelector
                label={activeMaterialInputs[0].label}
                required
                galleryTitle="素材を選択"
                value={fabricDesign}
                onChange={setFabricDesign}
                allowedReferenceTypes={['base', 'pattern']}
                defaultReferenceType="base"
                platformAssetRole="garment"
                hint="柄やロゴをそのまま重ねるか、切り抜いて重ねます"
              />
              <ImageSelector
                label={activeMaterialInputs[1].label}
                required
                galleryTitle="素材を選択"
                value={fabricBase}
                onChange={setFabricBase}
                allowedReferenceTypes={['base']}
                defaultReferenceType="base"
                platformAssetRole="textile"
                hint="土台となる生地の写真を入れます"
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
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <p className="mb-3 text-sm font-semibold text-white">{activeMaterialInputs[0].label}</p>
                <ImageSelector
                  label={activeMaterialInputs[0].label}
                  required
                  value={printGarment}
                  galleryTitle="素材を選択"
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
              </div>
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
                          : '元画像から衣服カテゴリAIマスクを作成しました。確認範囲の外側は除外しています。自動候補へ戻すには別の画像を選び直してください。'
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
                  {printGarmentCutoutState === 'done' && clothModelConfigured && (
                    <div
                      role="status"
                      data-testid="cloth-model-warmup-status"
                      data-fallback-status="confirmed-mask fallback remains available"
                      className="mt-3 rounded-lg border border-violet-300/25 bg-violet-950/25 px-3 py-2 text-[11px] leading-relaxed text-violet-50"
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        {clothModelWarmupStatus === 'warming' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        衣服専用AIの準備
                      </div>
                      {clothModelWarmupStatus === 'warming' && (
                        <>
                          <p className="mt-1 text-violet-100/75">
                            {clothModelWarmupProgress?.message ?? '次のAIマスク生成で再利用するモデルを準備しています。'}
                            {clothModelWarmupProgress ? ` (${clothModelWarmupProgress.progress}%)` : ''}
                          </p>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                            <div
                              className="h-full rounded-full bg-violet-300 transition-[width]"
                              style={{ width: `${Math.min(100, Math.max(0, clothModelWarmupProgress?.progress ?? 0))}%` }}
                            />
                          </div>
                        </>
                      )}
                      {clothModelWarmupStatus === 'ready' && (
                        <p className="mt-1 text-violet-100/75">準備済みです。次のAIマスク生成で同じセッションを再利用します。</p>
                      )}
                      {clothModelWarmupStatus === 'error' && (
                        <p className="mt-1 text-amber-100/85">
                          準備に失敗しました（{clothModelWarmupError ?? 'unknown'}）。確定済みマスクの代替経路は利用できます。
                        </p>
                      )}
                      {clothModelWarmupStatus === 'unavailable' && (
                        <p className="mt-1 text-amber-100/85">この環境では衣服専用AIを利用できません。確定済みマスクの代替経路は利用できます。</p>
                      )}
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
                  label={activeMaterialInputs[1].label}
                  multiple
                  required
                  value={null}
                  galleryTitle="素材を選択"
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
            <div
              data-testid="print-coverage-controls"
              data-ready={printingReadinessCompleteCount === printingReadinessSteps.length ? 'true' : 'false'}
              data-selected-coverage={printCoverageMode}
              className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70"
            >
              <div>
                <span className="mb-2 block font-semibold text-white">プリント範囲</span>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-900 p-1" role="group" aria-label="プリント範囲">
                  {PRINT_COVERAGE_OPTIONS.map((coverage) => (
                    <button
                      key={coverage.value}
                      type="button"
                      data-testid={`print-coverage-${coverage.value}`}
                      data-selected={printCoverageMode === coverage.value ? 'true' : 'false'}
                      aria-label={`プリント範囲: ${coverage.label}`}
                      aria-pressed={printCoverageMode === coverage.value}
                      onClick={() => setPrintCoverageMode(coverage.value)}
                      className={`rounded-md px-3 py-2 text-sm font-semibold transition ${printCoverageMode === coverage.value ? 'bg-[#737d84] text-white' : 'text-neutral-400 hover:text-white'}`}
                    >
                      {coverage.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
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
            </div>
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
            {isGenerating ? '生成中...' : 'AI生成して結果を出す'}
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
                      data-testid="compare-print-results"
                      aria-label="生成結果を比較"
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
                            {run.results.some((result) => result.resultKind === 'provider')
                              ? 'provider / OpenAI画像編集'
                              : `exact / fabric${run.results.some((result) => result.resultKind === 'surface') ? ' / experimental' : ''}`}
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
                            onSaveToCanvas={saveResultToCanvas}
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
                      onSaveToCanvas={saveResultToCanvas}
                      isFavorite={Boolean(isPrinting && favoriteResultIds.has(result.id))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
        </main>
      </div>

      {isPrinting && (
        <div
          data-testid="lightchain-print-parity-view"
          className="min-h-screen bg-[#0b1113] px-3 py-4 text-white sm:px-5 lg:px-6 lg:py-6"
        >
          <div className="mx-auto max-w-[1680px]">
            <LightchainMaterialToolbar />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">

            <section className="min-w-0 rounded-2xl border border-white/10 bg-[#171d20] p-4 shadow-2xl shadow-black/20 lg:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/70">プリントイメージ</p>
                  <p className="mt-1 text-sm text-white/60">プリントイメージを使用し、版下を作成せずに印刷効果を確認できます</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/history')}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-white/75 transition hover:border-cyan-300/40 hover:text-cyan-100"
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                  生成履歴
                </button>
              </div>

              <nav className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-[#111719] p-1 sm:grid-cols-4" aria-label="素材ツール">
                {LIGHTCHAIN_MATERIAL_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => navigate(tab.route)}
                    aria-current={tab.id === activeMaterialTab.id ? 'page' : undefined}
                    className={`rounded-lg px-2 py-2 text-xs font-semibold transition sm:px-3 sm:text-sm ${tab.id === activeMaterialTab.id
                      ? 'bg-[#737d84] text-white shadow-lg shadow-black/20'
                      : 'text-white/45 hover:bg-white/[0.06] hover:text-white/80'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>

              <div className="space-y-4">
                <div data-testid="lightchain-print-reference-input" className="rounded-xl border border-white/10 bg-[#202629] p-3">
                  <p className="mb-2 text-sm font-semibold text-white">参考画像をアップロード</p>
                  <p className="mb-3 text-xs text-white/50">20MB以下の画像アップロードしてください</p>
                  <ImageSelector
                    label="参考画像"
                    required
                    value={printGarment}
                    galleryTitle="素材を選択"
                    confirmGallerySelection
                    galleryConfirmLabel="適用"
                    selectionTestId="print-garment-selector"
                    onChange={selectPrintGarment}
                    allowedReferenceTypes={['base']}
                    defaultReferenceType="base"
                    platformAssetRole="garment"
                    hint="服・商品画像をプリントの基準にします"
                    processing={printGarmentCutoutState === 'processing'}
                    hideSelectedPreviewWhileProcessing
                    previewUrl={printGarmentCutoutState === 'done' ? printGarmentProcessed : null}
                    processingLabel="画像を処理中"
                  />
                  {printGarment && printGarmentCutoutState === 'done' && (
                    <button
                      type="button"
                      onClick={() => setPrintGarmentSelectionOpen(true)}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      画像のプリント領域を調整
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-white/10 bg-[#202629] p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">プリントをアップロード</p>
                    <button
                      type="button"
                      onClick={resetPrintingInputs}
                      className="text-xs text-white/55 transition hover:text-cyan-100"
                    >
                      ↻ リセット
                    </button>
                  </div>
                  <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-neutral-900 p-1" role="group" aria-label="プリント範囲">
                    {PRINT_COVERAGE_OPTIONS.map((coverage) => (
                      <button
                        key={coverage.value}
                        type="button"
                        data-testid={`print-coverage-${coverage.value}`}
                        data-selected={printCoverageMode === coverage.value ? 'true' : 'false'}
                        aria-pressed={printCoverageMode === coverage.value}
                        onClick={() => setPrintCoverageMode(coverage.value)}
                        className={`rounded-md px-3 py-2 text-sm font-semibold transition ${printCoverageMode === coverage.value ? 'bg-[#737d84] text-white' : 'text-neutral-400 hover:text-white'}`}
                      >
                        {coverage.label}
                      </button>
                    ))}
                  </div>
                  <ImageSelector
                    label="画像をアップロード"
                    required
                    value={printDesigns[0] ?? null}
                    galleryTitle="素材を選択"
                    confirmGallerySelection
                    galleryConfirmLabel="適用"
                    selectionTestId="print-design-selector"
                    galleryAssetPurpose="print-design"
                    onChange={(image) => {
                      if (image) void addDesigns([image]);
                      else setPrintDesigns([]);
                    }}
                    allowedReferenceTypes={['pattern']}
                    defaultReferenceType="pattern"
                    hint="20MB以下の画像アップロードしてください"
                    processing={printDesignsProcessing}
                    hideSelectedPreviewWhileProcessing
                    previewUrl={printDesignCutoutStates[0] === 'done' ? printDesignProcessedUrls[0] : null}
                    processingLabel="プリントを処理中"
                  />
                  {printDesigns[0] && printDesignCutoutStates[0] === 'done' && (
                    <button
                      type="button"
                      onClick={() => openDesignMaskEditor(0)}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10"
                      data-testid="lightchain-print-design-mask-editor"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      画像のプリント領域を調整
                    </button>
                  )}
                </div>

                <label data-testid="lightchain-material-provider-gate" className="flex items-start gap-3 rounded-xl border border-emerald-300/25 bg-emerald-300/[0.06] px-3 py-3 text-xs leading-relaxed text-emerald-50">
                  <input
                    type="checkbox"
                    data-testid="lightchain-material-rights-confirmation"
                    checked={providerRightsConfirmed}
                    onChange={(event) => setProviderRightsConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-400"
                  />
                  <span>入力素材の利用権限を確認しました。AIプロバイダーへ送信して生成します。</span>
                </label>

                <Button
                  onClick={handleGenerate}
                  isLoading={isGenerating}
                  disabled={isGenerating || !lightchainPrintReady || !providerRightsConfirmed}
                  className="w-full bg-gradient-to-r from-cyan-300 via-teal-300 to-violet-300 text-slate-950 hover:brightness-105"
                  size="lg"
                  leftIcon={isGenerating ? undefined : <Sparkles className="h-5 w-5" />}
                >
                  {isGenerating ? '生成中…' : 'AI生成'}
                </Button>

                {generationError && (
                  <p role="alert" className="rounded-xl border border-rose-300/25 bg-rose-950/30 px-3 py-2 text-xs leading-relaxed text-rose-100">
                    {generationError}
                  </p>
                )}
                {surfaceConformStatus && (
                  <p role="status" className="rounded-xl border border-cyan-300/20 bg-cyan-950/25 px-3 py-2 text-xs leading-relaxed text-cyan-100">
                    {surfaceConformStatus}
                  </p>
                )}
                <p className="rounded-lg border border-amber-300/20 bg-amber-950/20 px-3 py-2 text-[11px] leading-relaxed text-amber-100/80">
                  この機能はまもなく終了します。より高機能な画像生成機能はデザイン制作ワークスペースでご利用ください{' '}
                  <Link to="/designProduction" className="font-semibold underline underline-offset-2 hover:text-white">
                    今すぐ体験
                  </Link>
                </p>
              </div>
            </section>

            <aside className="min-w-0 rounded-2xl border border-white/10 bg-[#111719] p-4 shadow-2xl shadow-black/20 lg:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-white">生成履歴</h2>
                  <span className="text-xs text-white/45">ⓘ</span>
                </div>
                {printResultRuns.length > 0 && (
                  <button
                    type="button"
                    onClick={clearPrintResultHistory}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-2 text-xs font-semibold text-white/65 transition hover:border-red-300/35 hover:text-red-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    全削除
                  </button>
                )}
              </div>

              <div data-testid="print-result-run-history" className="space-y-4">
                {progressivePrintRun && (
                  <section data-testid="progressive-print-run" className="rounded-xl border border-cyan-300/25 bg-cyan-300/[0.035] p-3" aria-busy={progressivePrintRun.fabric.status === 'rendering'}>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-cyan-50">現在の生成</p>
                      <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-100">
                        {progressivePrintRun.fabric.status === 'ready' ? '2/2' : progressivePrintRun.exact.status === 'ready' ? '1/2' : '0/2'}
                      </span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      <ProgressivePrintSurfaceCard label="配置そのまま" surface={progressivePrintRun.exact} onOpen={setSelectedResult} onFavorite={openFavoriteDialog} isFavorite={Boolean(progressivePrintRun.exact.result && favoriteResultIds.has(progressivePrintRun.exact.result.id))} />
                      <ProgressivePrintSurfaceCard label="布になじませる" surface={progressivePrintRun.fabric} onOpen={setSelectedResult} onFavorite={openFavoriteDialog} isFavorite={Boolean(progressivePrintRun.fabric.result && favoriteResultIds.has(progressivePrintRun.fabric.result.id))} />
                    </div>
                  </section>
                )}

                {printResultRuns.length === 0 && !progressivePrintRun && (
                  <div className="flex min-h-[20rem] items-center justify-center rounded-xl border border-dashed border-white/10 px-5 text-center text-sm text-white/40">
                    生成履歴はここに表示されます
                  </div>
                )}
                {printResultRuns.map((run, runIndex) => (
                  <section key={run.runId} data-testid="print-result-run" className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-white/80">プリントイメージ {runIndex + 1}{runIndex === 0 && !progressivePrintRun ? '（最新）' : ''}</p>
                        <p className="mt-1 text-[10px] text-white/40">
                          {run.results.some((result) => result.resultKind === 'provider') ? 'provider / OpenAI画像編集' : 'スポット／全体の生成結果'}
                        </p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/45">{run.results.length}結果</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      {run.results.map((result) => (
                        <WorkbenchResultCard
                          key={result.id}
                          result={result}
                          onOpen={setSelectedResult}
                          onFavorite={openFavoriteDialog}
                          onDeleteRun={deletePrintResultRun}
                          onSaveToCanvas={saveResultToCanvas}
                          isFavorite={favoriteResultIds.has(result.id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </aside>
            </div>
          </div>
        </div>
      )}

      {!isPrinting && (
        <div
          data-testid="lightchain-fabric-parity-view"
          className="min-h-screen bg-[#0b1113] px-3 py-4 text-white sm:px-5 lg:px-6 lg:py-6"
        >
          <div className="mx-auto max-w-[1680px]">
            <LightchainMaterialToolbar />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">

            <section className="min-w-0 rounded-2xl border border-white/10 bg-[#171d20] p-4 shadow-2xl shadow-black/20 lg:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/70">生地イメージ</p>
                  <p className="mt-1 text-sm text-white/60">異なる生地の質感を商品画像で確認できます</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/history')}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-white/75 transition hover:border-cyan-300/40 hover:text-cyan-100"
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                  生成履歴
                </button>
              </div>

              <nav className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-[#111719] p-1 sm:grid-cols-4" aria-label="素材ツール">
                {LIGHTCHAIN_MATERIAL_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => navigate(tab.route)}
                    aria-current={tab.id === activeMaterialTab.id ? 'page' : undefined}
                    className={`rounded-lg px-2 py-2 text-xs font-semibold transition sm:px-3 sm:text-sm ${tab.id === activeMaterialTab.id
                      ? 'bg-[#737d84] text-white shadow-lg shadow-black/20'
                      : 'text-white/45 hover:bg-white/[0.06] hover:text-white/80'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>

              <div className="space-y-4">
                <p className="rounded-xl border border-emerald-300/25 bg-emerald-300/[0.08] px-3 py-2 text-[11px] leading-relaxed text-emerald-100">
                  この機能はまもなく終了します。より高機能な画像生成機能はデザイン制作ワークスペースでご利用ください{' '}
                  <Link to="/designProduction" className="font-semibold underline underline-offset-2 hover:text-white">
                    今すぐ体験
                  </Link>
                </p>

                <section data-testid="lightchain-fabric-design-input" className="rounded-xl border border-white/10 bg-[#202629] p-3">
                  <p className="mb-2 text-sm font-semibold text-white">モデル/デザイン画像 *</p>
                  <p className="mb-3 text-xs text-white/50">20MB以下の画像アップロードしてください</p>
                  <ImageSelector
                    label="モデル/デザイン画像"
                    required
                    value={fabricDesign}
                    galleryTitle="素材を選択"
                    confirmGallerySelection
                    galleryConfirmLabel="適用"
                    selectionTestId="fabric-design-selector"
                    onChange={setFabricDesign}
                    allowedReferenceTypes={['base', 'pattern']}
                    defaultReferenceType="base"
                    platformAssetRole="garment"
                    hint="商品・モデル・デザインの基準画像を入れます"
                  />
                </section>

                <section data-testid="lightchain-fabric-input" className="rounded-xl border border-white/10 bg-[#202629] p-3">
                  <p className="mb-2 text-sm font-semibold text-white">生地画像 *</p>
                  <p className="mb-3 text-xs text-white/50">質感を反映する生地の参照画像をアップロードしてください</p>
                  <ImageSelector
                    label="生地画像"
                    required
                    value={fabricBase}
                    galleryTitle="素材を選択"
                    confirmGallerySelection
                    galleryConfirmLabel="適用"
                    selectionTestId="fabric-base-selector"
                    onChange={setFabricBase}
                    allowedReferenceTypes={['base']}
                    defaultReferenceType="base"
                    platformAssetRole="textile"
                    hint="布・編地・光沢などの質感素材を入れます"
                  />
                </section>

                <label className="block rounded-xl border border-white/10 bg-[#202629] p-3" htmlFor="lightchain-fabric-prompt">
                  <span className="text-sm font-semibold text-white">キーワードを追加してください（任意）</span>
                  <textarea
                    id="lightchain-fabric-prompt"
                    value={fabricPrompt}
                    onChange={(event) => setFabricPrompt(event.target.value)}
                    placeholder="白い衣服に指定した生地の質感を自然に反映"
                    rows={3}
                    className="mt-3 w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/50"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="rounded-xl border border-white/10 bg-[#202629] p-3">
                    <span className="block text-xs font-semibold text-white/75">画像比率</span>
                    <select
                      value={fabricImageRatio}
                      onChange={(event) => setFabricImageRatio(event.target.value)}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-[#111719] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
                    >
                      <option>画像比率自動</option>
                      <option>正方形 1:1</option>
                      <option>縦長 4:5</option>
                      <option>横長 16:9</option>
                    </select>
                  </label>
                  <div className="rounded-xl border border-white/10 bg-[#202629] p-3">
                    <span className="block text-xs font-semibold text-white/75">生地バリエーション</span>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {fabricVariants.map((variant) => (
                        <button
                          key={variant.id}
                          type="button"
                          onClick={() => updateFabricPreset(variant.id)}
                          aria-pressed={fabricPresetIds.includes(variant.id)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition ${fabricPresetIds.includes(variant.id)
                            ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-50'
                            : 'border-white/10 text-white/55 hover:text-white'}`}
                        >
                          {variant.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div ref={stageRef} data-testid="lightchain-fabric-preview" className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-neutral-900">
                  {fabricTryOnPreviewUrl ? (
                    <img src={fabricTryOnPreviewUrl} alt="生地を衣服領域へ適用したプレビュー" className="absolute inset-0 h-full w-full object-contain bg-black/10" />
                  ) : fabricDesign ? (
                    <img src={fabricDesign.url} alt="モデル/デザインプレビュー" className="absolute inset-0 h-full w-full object-contain bg-black/10" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">モデル/デザイン画像をアップロードしてください</div>
                  )}
                  {fabricBase && fabricPreviewState === 'processing' && (
                    <div className="absolute inset-x-3 top-3 rounded-lg border border-cyan-200/20 bg-slate-950/60 px-3 py-2 text-center text-[11px] text-cyan-100 backdrop-blur">
                      生地の背景を分離しています…
                    </div>
                  )}
                  {fabricBase && fabricPreviewState === 'error' && (
                    <div role="alert" className="absolute inset-x-3 top-3 rounded-lg border border-rose-200/25 bg-rose-950/70 px-3 py-2 text-center text-[11px] text-rose-100 backdrop-blur">
                      {fabricPreviewError ?? '生地の背景を分離できませんでした'}
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-10 text-xs text-white/75">
                    {fabricDesign && fabricBase ? '入力内容を確認してAI生成へ進みます' : '2つの画像を追加するとプレビューできます'}
                  </div>
                </div>

                  <label data-testid="lightchain-material-provider-gate" className="flex items-start gap-3 rounded-xl border border-emerald-300/25 bg-emerald-300/[0.06] px-3 py-3 text-xs leading-relaxed text-emerald-50">
                    <input
                      type="checkbox"
                      data-testid="lightchain-material-rights-confirmation"
                      checked={providerRightsConfirmed}
                      onChange={(event) => setProviderRightsConfirmed(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-400"
                    />
                    <span>入力素材の利用権限を確認しました。AIプロバイダーへ送信して生成します。</span>
                  </label>

                  <Button
                    data-testid="lightchain-fabric-generate"
                    onClick={handleGenerate}
                    isLoading={isGenerating}
                    disabled={isGenerating || fabricPreviewState !== 'done' || !fabricBase || !fabricDesign || fabricPresetIds.length === 0 || !providerRightsConfirmed}
                  className="w-full bg-gradient-to-r from-cyan-300 via-teal-300 to-violet-300 text-slate-950 hover:brightness-105"
                  size="lg"
                  leftIcon={isGenerating ? undefined : <Sparkles className="h-5 w-5" />}
                >
                  {isGenerating ? '生成中…' : 'AI生成'}
                </Button>
                {!isAuthInitialized || isAuthLoading ? (
                  <p role="status" className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-xs leading-relaxed text-cyan-100">
                    ブランド情報を読み込んでいます…
                  </p>
                ) : !currentBrand?.id ? (
                  <p role="status" className="rounded-xl border border-amber-300/20 bg-amber-950/20 px-3 py-2 text-xs leading-relaxed text-amber-100">
                    ブランド情報を確認中です。生成時に保存先を再取得します。
                  </p>
                ) : null}
                {generationError && (
                  <p role="alert" className="rounded-xl border border-rose-300/25 bg-rose-950/30 px-3 py-2 text-xs leading-relaxed text-rose-100">
                    {generationError}
                  </p>
                )}
              </div>
            </section>

            <aside className="min-w-0 rounded-2xl border border-white/10 bg-[#111719] p-4 shadow-2xl shadow-black/20 lg:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-white">生成履歴</h2>
                  <span className="text-xs text-white/45">ⓘ</span>
                </div>
                {visibleGeneratedResults.length > 0 && (
                  <button
                    type="button"
                    onClick={clearFabricResultHistory}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-2 text-xs font-semibold text-white/65 transition hover:border-red-300/35 hover:text-red-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    全削除
                  </button>
                )}
              </div>

              <div className="mb-4 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.05] p-3">
                <p className="text-sm font-semibold text-cyan-100">生地イメージ</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/50">異なる生地の質感を生成して比較できます</p>
                <div className="mt-3 aspect-video overflow-hidden rounded-lg bg-black/30">
                  {fabricDesign && fabricBase ? (
                    <div className="relative h-full w-full">
                      <img src={fabricTryOnPreviewUrl ?? fabricDesign.url} alt="切り抜き済み生地を衣服領域へ適用した参考" className="absolute inset-0 h-full w-full object-contain bg-black/10" />
                      {fabricPreviewState === 'processing' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/35 text-[11px] text-cyan-100 backdrop-blur-[1px]">
                          生地の背景を分離しています…
                        </div>
                      )}
                      {fabricPreviewState === 'error' && (
                        <div role="alert" className="absolute inset-0 flex items-center justify-center bg-rose-950/45 px-4 text-center text-[11px] text-rose-100">
                          {fabricPreviewError ?? '生地の背景を分離できませんでした'}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-white/35">入力待ち</div>
                  )}
                </div>
              </div>

              {visibleGeneratedResults.length === 0 ? (
                <div className="flex min-h-[20rem] items-center justify-center rounded-xl border border-dashed border-white/10 px-5 text-center text-sm text-white/40">
                  生成履歴はここに表示されます
                </div>
              ) : (
                <div data-testid="fabric-result-history" className="space-y-3">
                  {[...visibleGeneratedResults].reverse().map((result) => (
                    <WorkbenchResultCard
                      key={result.id}
                      result={result}
                      onOpen={setSelectedResult}
                      onSaveToCanvas={saveResultToCanvas}
                    />
                  ))}
                </div>
              )}
            </aside>
            </div>
          </div>
        </div>
      )}

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
              <button
                type="button"
                onClick={() => void downloadWorkbenchResult(selectedResult).catch(() => toast.error('ダウンロードに失敗しました'))}
                data-testid="selected-print-result-download"
                aria-label={`${selectedResult.title}のPNGをダウンロード`}
                className="inline-flex rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 dark:border-white/15 dark:text-white"
              >
                {selectedResult.outputSize.width} × {selectedResult.outputSize.height}px PNGをダウンロード
              </button>
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
