import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Layers3,
  Scissors,
  Sparkles,
  Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import { Button, ImageCompare } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { ImageSelector, type SelectedImage } from '../components/ImageSelector';
import { PrintingCompositionStage } from '../components/workspace/PrintingCompositionStage';
import { PrintMaskCandidatePicker } from '../components/workspace/PrintMaskCandidatePicker';
import { PrintMaskEditor } from '../components/workspace/PrintMaskEditor';
import { useAuthStore } from '../stores/authStore';
import {
  buildPrintGarmentMaskCandidates,
  buildPrintDesignCutoutDataUrl,
  buildPrintRequestSignature,
  buildPrintRequestSnapshot,
  renderPrintRequestComposition,
  type MaterialCutoutResult,
  type PrintGarmentMaskCandidate,
} from '../lib/workspaceMaterialReferences';
import {
  mergePrintResultHistory,
  selectPrintGarmentMaskCandidateValue,
  type PrintGarmentMaskCandidateId,
} from '../lib/printMaskCandidateStrategy';

type WorkbenchMode = 'fabric' | 'printing';
type CutoutState = 'idle' | 'processing' | 'done' | 'error';

type Transform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
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
  kind: 'garment' | 'design';
  index?: number;
  title: string;
  sourceUrl: string;
  maskUrl: string;
  result: MaterialCutoutResult;
};

type WorkbenchResult = {
  id: string;
  title: string;
  note: string;
  imageUrl: string;
};

const defaultTransform = (overrides: Partial<Transform> = {}): Transform => ({
  x: overrides.x ?? 50,
  y: overrides.y ?? 50,
  scale: overrides.scale ?? 1,
  rotation: overrides.rotation ?? 0,
  opacity: overrides.opacity ?? 1,
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

const printStageSize = { width: 720, height: 900 };
const CUTOUT_TIMEOUT_MS = 30_000;
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
    }, CUTOUT_TIMEOUT_MS);
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

const estimateDataUrlBytes = (dataUrl: string) => {
  const base64 = dataUrl.split(',', 2)[1] ?? '';
  return Math.max(0, Math.floor((base64.length * 3) / 4));
};

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
    transform: `translate(-50%, -50%) rotate(${layer.transform.rotation}deg) scale(${layer.transform.scale})`,
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
  const { currentBrand } = useAuthStore();
  const mode: WorkbenchMode = location.pathname.includes('printing') ? 'printing' : 'fabric';
  const isPrinting = mode === 'printing';
  const stageRef = useRef<HTMLDivElement>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const userClearedSelectionRef = useRef(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedResults, setGeneratedResults] = useState<WorkbenchResult[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedResultsStale, setGeneratedResultsStale] = useState(false);
  const [selectedResult, setSelectedResult] = useState<WorkbenchResult | null>(null);
  const [showResultComparison, setShowResultComparison] = useState(false);
  const [fabricBase, setFabricBase] = useState<SelectedImage | null>(null);
  const [fabricDesign, setFabricDesign] = useState<SelectedImage | null>(null);
  const [fabricLayer, setFabricLayer] = useState<AssetLayer | null>(null);
  const [fabricPresetIds, setFabricPresetIds] = useState<string[]>(['cotton', 'denim', 'satin']);
  const [printGarment, setPrintGarment] = useState<SelectedImage | null>(null);
  const [printGarmentProcessed, setPrintGarmentProcessed] = useState<string | null>(null);
  const [printGarmentMaskCandidates, setPrintGarmentMaskCandidates] = useState<PrintGarmentMaskCandidate[]>([]);
  const [selectedPrintGarmentMaskCandidateId, setSelectedPrintGarmentMaskCandidateId] = useState<PrintGarmentMaskCandidateId>('auto');
  const [printGarmentMaskRevision, setPrintGarmentMaskRevision] = useState(0);
  const [printGarmentCutoutState, setPrintGarmentCutoutState] = useState<CutoutState>('idle');
  const [printGarmentCutoutError, setPrintGarmentCutoutError] = useState<string | null>(null);
  const [printDesigns, setPrintDesigns] = useState<SelectedImage[]>([]);
  const [printDesignLayers, setPrintDesignLayers] = useState<AssetLayer[]>([]);
  const [printDesignProcessedUrls, setPrintDesignProcessedUrls] = useState<Record<number, string>>({});
  const [printDesignCutoutResults, setPrintDesignCutoutResults] = useState<Record<number, MaterialCutoutResult>>({});
  const [printDesignMaskRevisions, setPrintDesignMaskRevisions] = useState<Record<number, number>>({});
  const [printDesignCutoutStates, setPrintDesignCutoutStates] = useState<Record<number, CutoutState>>({});
  const [printDesignCutoutErrors, setPrintDesignCutoutErrors] = useState<Record<number, string>>({});
  const [printMaskEditorTarget, setPrintMaskEditorTarget] = useState<PrintMaskEditorTarget | null>(null);
  const printGarmentCutoutRequestRef = useRef(0);
  const printDesignCutoutRequestRef = useRef(0);
  const printRequestRevisionRef = useRef(0);
  const generationSequenceRef = useRef(0);
  const generationRequestRef = useRef<number | null>(null);
  const generationRequestSignatureRef = useRef<string | null>(null);

  const generationInputSignature = useMemo(() => JSON.stringify({
    mode,
    brandId: currentBrand?.id ?? null,
    fabricBaseUrl: fabricBase?.url ?? null,
    fabricDesignUrl: fabricDesign?.url ?? null,
    fabricPresetIds,
    printGarmentUrl: printGarment?.url ?? null,
    printGarmentProcessed,
    printGarmentMaskCandidateId: selectedPrintGarmentMaskCandidateId,
    printGarmentMaskRevision,
    printGarmentCutoutState,
    printDesigns: printDesigns.map((design) => design.url),
    printDesignProcessedUrls,
    printDesignMaskRevisions,
    printDesignCutoutStates,
    printDesignLayers: printDesignLayers.map((layer) => ({
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
    printDesignCutoutStates,
    printDesignLayers,
    printDesignProcessedUrls,
    printDesignMaskRevisions,
    printDesigns,
    printGarment?.url,
    printGarmentCutoutState,
    printGarmentProcessed,
    printGarmentMaskRevision,
    selectedPrintGarmentMaskCandidateId,
  ]);
  const generationInputSignatureRef = useRef(generationInputSignature);
  if (generationInputSignatureRef.current !== generationInputSignature) {
    generationInputSignatureRef.current = generationInputSignature;
    generationSequenceRef.current += 1;
  }
  const generationInputEffectSignatureRef = useRef(generationInputSignature);

  useEffect(() => {
    if (generationInputEffectSignatureRef.current === generationInputSignature) return;
    generationInputEffectSignatureRef.current = generationInputSignature;
    if (generatedResults.length > 0) setGeneratedResultsStale(true);
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
      stageSize: printStageSize,
      garment: {
        sourceUrl: printGarmentProcessed,
        referenceType: printGarment?.referenceType ?? null,
        maskCandidateId: selectedPrintGarmentMaskCandidateId,
        maskRevision: printGarmentMaskRevision,
      },
      designs: printDesignLayers.map((layer) => ({
        id: layer.id,
        sourceUrl: layer.originalUrl,
        maskRevision: layer.maskRevision,
        transform: layer.transform,
      })),
    });
  }, [currentBrand?.id, currentBrand?.name, printGarment?.referenceType, printGarmentProcessed, printDesignLayers, printGarmentMaskRevision, selectedPrintGarmentMaskCandidateId]);

  const currentPrintStateRef = useRef<{ revision: number; signature: string }>({ revision: 0, signature: printSnapshotSignature });

  if (currentPrintStateRef.current.signature !== printSnapshotSignature) {
    printRequestRevisionRef.current += 1;
    currentPrintStateRef.current = {
      revision: printRequestRevisionRef.current,
      signature: printSnapshotSignature,
    };
  }

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

  useEffect(() => {
    if (userClearedSelectionRef.current) {
      return;
    }
    if (!selectedLayerId && activeLayers.length > 0) {
      setSelectedLayerId(activeLayers[activeLayers.length - 1].id);
    }
  }, [activeLayers, selectedLayerId]);

  useEffect(() => {
    const onPointerUp = () => {
      // Pointer tracking is driven directly from the stage element.
    };
    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  }, []);

  const selectLayer = (layerId: string) => {
    userClearedSelectionRef.current = false;
    setSelectedLayerId(layerId);
  };

  const clearSelectedLayer = () => {
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
    const requestId = ++printGarmentCutoutRequestRef.current;
    setPrintMaskEditorTarget(null);
    setPrintGarmentMaskRevision(0);
    if (!printGarment) {
      setPrintGarmentProcessed(null);
      setPrintGarmentMaskCandidates([]);
      setSelectedPrintGarmentMaskCandidateId('auto');
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
    void withTimeout(
      buildPrintGarmentMaskCandidates({ imageUrl: printGarment.url }),
      CUTOUT_TIMEOUT_MS,
      '参考画像の透明化がタイムアウトしました。元画像を確認して再試行してください',
    )
      .then((candidates) => {
        if (cancelled || printGarmentCutoutRequestRef.current !== requestId) return;
        const selection = selectPrintGarmentMaskCandidateValue(candidates, 'auto');
        setPrintGarmentMaskCandidates(candidates);
        setSelectedPrintGarmentMaskCandidateId(selection.candidateId);
        setPrintGarmentProcessed(selection.dataUrl);
        setPrintGarmentCutoutState('done');
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
  }, [printGarment]);

  const selectPrintGarmentMaskCandidate = (candidateId: PrintGarmentMaskCandidateId) => {
    const selection = selectPrintGarmentMaskCandidateValue(printGarmentMaskCandidates, candidateId);
    setSelectedPrintGarmentMaskCandidateId(selection.candidateId);
    setPrintGarmentProcessed(selection.dataUrl);
    setPrintGarmentMaskRevision((current) => current + 1);
    setPrintMaskEditorTarget(null);
    toast.success(`${selection.candidate.label}をステージへ反映しました`);
  };

  useEffect(() => {
    if (!printDesigns.length) {
      setPrintDesignLayers([]);
      return;
    }
    setPrintDesignLayers((previousLayers) => printDesigns.map((_, index) => {
      const layerId = `print-design-${index}`;
      const previousLayer = previousLayers.find((layer) => layer.id === layerId);
      const cutoutState = printDesignCutoutStates[index] ?? 'processing';
      const processedUrl = cutoutState === 'done' ? (printDesignProcessedUrls[index] || '') : '';
      return {
        id: layerId,
        label: `デザイン ${index + 1}`,
        originalUrl: processedUrl,
        displayUrl: processedUrl,
        transform: defaultTransform({
          x: previousLayer?.transform.x ?? 50 + ((index % 3) - 1) * 8,
          y: previousLayer?.transform.y ?? 44 + Math.floor(index / 3) * 14,
          scale: previousLayer?.transform.scale ?? (index === 0 ? 1 : 0.88),
          rotation: previousLayer?.transform.rotation ?? (index % 2 === 0 ? -6 : 6) * (index % 3),
          opacity: previousLayer?.transform.opacity ?? 1,
        }),
        autoCutout: true,
        cutoutState,
        maskRevision: printDesignMaskRevisions[index] ?? 0,
      };
    }));
  }, [printDesignCutoutStates, printDesignMaskRevisions, printDesignProcessedUrls, printDesigns]);

  useEffect(() => {
    if (userClearedSelectionRef.current) {
      return;
    }
    if (fabricBase || fabricDesign || printGarment || printDesigns.length > 0) {
      const firstLayer =
        (isPrinting ? printDesignLayers[0]?.id : fabricLayer?.id) ||
        (isPrinting ? (printGarmentProcessed ? 'print-garment' : null) : fabricLayer?.id);
      setSelectedLayerId(firstLayer || null);
    }
  }, [fabricBase, fabricDesign, fabricLayer, isPrinting, printDesignLayers, printGarment, printGarmentProcessed, printDesigns.length]);

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
      return [...garments, ...printDesignLayers];
    }

    return fabricLayer ? [fabricLayer] : [];
  }, [fabricLayer, isPrinting, printDesignLayers, printGarment, printGarmentCutoutState, printGarmentMaskRevision, printGarmentProcessed]);

  useEffect(() => {
    if (isPrinting) {
      if (printGarmentProcessed && !selectedLayerId && !userClearedSelectionRef.current) {
        setSelectedLayerId('print-garment');
      }
    } else if (fabricLayer && !selectedLayerId && !userClearedSelectionRef.current) {
      setSelectedLayerId(fabricLayer.id);
    }
  }, [fabricLayer, isPrinting, printGarmentProcessed, selectedLayerId]);

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
    if (!stageRef.current) return;
    if (!currentBrand?.id) {
      toast.error('ブランドを選択してください');
      return;
    }

    if (!isPrinting && (!fabricBase || !fabricDesign)) {
      toast.error('生地画像とデザイン画像を入れてください');
      return;
    }
    if (isPrinting && (
      !printGarmentProcessed
      || printGarmentCutoutState !== 'done'
      || !printDesignLayers.length
      || printDesignLayers.some((layer) => layer.cutoutState !== 'done' || !layer.displayUrl)
    )) {
      toast.error(printGarmentCutoutState === 'processing' || printDesignLayers.some((layer) => layer.cutoutState === 'processing')
        ? '背景の透明化が完了するまでお待ちください'
        : '参考画像とプリント画像の透明化を完了してください');
      return;
    }

    const requestId = ++generationSequenceRef.current;
    const requestSignature = generationInputSignatureRef.current;
    generationRequestRef.current = requestId;
    generationRequestSignatureRef.current = requestSignature;
    setIsGenerating(true);
    setGenerationError(null);
    if (generatedResults.length > 0) setGeneratedResultsStale(true);
    const isCurrentRequest = () => (
      generationRequestRef.current === requestId
      && generationSequenceRef.current === requestId
      && generationInputSignatureRef.current === requestSignature
    );
    try {
      const rect = stageRef.current.getBoundingClientRect();
      const width = Math.max(720, Math.round(rect.width || 960));
      const height = Math.max(720, Math.round(rect.height || 960));

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
          designs: printDesignLayers.map((layer) => ({
            id: layer.id,
            sourceUrl: layer.originalUrl,
            maskRevision: layer.maskRevision,
            transform: {
              x: layer.transform.x,
              y: layer.transform.y,
              scale: layer.transform.scale,
              rotation: layer.transform.rotation,
              opacity: layer.transform.opacity,
            },
          })),
          stageSize: printStageSize,
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

      const [exactComposition, fabricComposition] = await Promise.all([
        withTimeout(
          renderPrintRequestComposition(nextSnapshot, 'exact'),
          COMPOSITION_TIMEOUT_MS,
          '配置そのままの描画がタイムアウトしました。素材を確認して再試行してください',
        ),
        withTimeout(
          renderPrintRequestComposition(nextSnapshot, 'fabric'),
          COMPOSITION_TIMEOUT_MS,
          '布になじませる描画がタイムアウトしました。素材を確認して再試行してください',
        ),
      ]);
      if (
        !isCurrentRequest()
        ||
        currentPrintStateRef.current.revision !== requestState.revision
        || currentPrintStateRef.current.signature !== requestState.signature
      ) {
        return;
      }

      const generatedAt = Date.now();
      const nextResults: WorkbenchResult[] = [{
        id: `print-${nextRevision}-${generatedAt}-exact`,
        title: '配置そのまま',
        note: 'AI再描画なし / 元デザインの色・形・透明度を保持',
        imageUrl: exactComposition,
      }, {
        id: `print-${nextRevision}-${generatedAt}-fabric`,
        title: '布になじませる',
        note: '輪郭と透明度は固定 / Tシャツの明暗だけをデザインのRGBへ反映',
        imageUrl: fabricComposition,
      }];
      setGeneratedResults((previous) => mergePrintResultHistory(
        nextResults,
        previous.filter((result) => result.id.startsWith('print-')),
      ));
      setGeneratedResultsStale(false);
      setGenerationError(null);
      toast.success('2種類のプリント結果を作成しました');
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

  const addDesigns = async (images: SelectedImage[]) => {
    if (images.length > 6) {
      toast.error('デザインは6つまでです');
      return;
    }
    setPrintDesigns(images);
    setPrintMaskEditorTarget(null);
    const requestId = ++printDesignCutoutRequestRef.current;
    const initialStates = Object.fromEntries(images.map((_, index) => [index, 'processing' as CutoutState]));
    setPrintDesignProcessedUrls({});
    setPrintDesignCutoutResults({});
    setPrintDesignMaskRevisions(Object.fromEntries(images.map((_, index) => [index, 0])));
    setPrintDesignCutoutStates(initialStates);
    setPrintDesignCutoutErrors({});

    const processedUrls: Record<number, string> = {};
    const processedResults: Record<number, MaterialCutoutResult> = {};
    for (const [index, design] of images.entries()) {
      try {
        const result = await withTimeout(
          buildPrintDesignCutoutDataUrl({ imageUrl: design.url }),
          CUTOUT_TIMEOUT_MS,
          `デザイン${index + 1}の透明化がタイムアウトしました。元画像を確認して再試行してください`,
        );
        if (printDesignCutoutRequestRef.current !== requestId) return;
        processedUrls[index] = result.dataUrl;
        processedResults[index] = result;
        setPrintDesignProcessedUrls({ ...processedUrls });
        setPrintDesignCutoutResults({ ...processedResults });
        setPrintDesignCutoutStates((current) => ({ ...current, [index]: 'done' }));
      } catch (error) {
        if (printDesignCutoutRequestRef.current !== requestId) return;
        const message = error instanceof Error ? error.message : 'プリント画像の背景を透明化できませんでした';
        setPrintDesignCutoutStates((current) => ({ ...current, [index]: 'error' }));
        setPrintDesignCutoutErrors((current) => ({ ...current, [index]: message }));
        console.error('Print design cutout failed', { index, error });
      }
    }
  };

  const openGarmentMaskEditor = () => {
    if (!printGarment || !printGarmentProcessed) return;
    const selectedCandidate = printGarmentMaskCandidates.find((candidate) => candidate.candidateId === selectedPrintGarmentMaskCandidateId);
    if (!selectedCandidate) return;
    setPrintMaskEditorTarget({
      kind: 'garment',
      title: '服の切り抜きマスクを調整',
      sourceUrl: printGarment.url,
      maskUrl: printGarmentProcessed,
      result: selectedCandidate.result,
    });
  };

  const openDesignMaskEditor = (index: number) => {
    const design = printDesigns[index];
    const result = printDesignCutoutResults[index];
    const maskUrl = printDesignProcessedUrls[index];
    if (!design || !result || !maskUrl) return;
    setPrintMaskEditorTarget({
      kind: 'design',
      index,
      title: `デザイン ${index + 1} のマスクを調整`,
      sourceUrl: design.url,
      maskUrl,
      result,
    });
  };

  const applyEditedPrintMask = (dataUrl: string) => {
    const target = printMaskEditorTarget;
    if (!target) return;
    if (target.kind === 'garment') {
      const manualResult: MaterialCutoutResult = {
        ...target.result,
        dataUrl,
        dataUrlBytes: estimateDataUrlBytes(dataUrl),
      };
      setPrintGarmentProcessed(dataUrl);
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
      setPrintGarmentMaskRevision((current) => current + 1);
    } else if (target.index !== undefined) {
      const index = target.index;
      setPrintDesignProcessedUrls((current) => ({ ...current, [index]: dataUrl }));
      setPrintDesignCutoutResults((current) => ({
        ...current,
        [index]: {
          ...target.result,
          dataUrl,
          dataUrlBytes: estimateDataUrlBytes(dataUrl),
        },
      }));
      setPrintDesignMaskRevisions((current) => ({ ...current, [index]: (current[index] ?? 0) + 1 }));
    }
    setPrintMaskEditorTarget(null);
    toast.success('マスク補正をステージへ反映しました');
  };

  const fabricStageBackground = fabricBase?.url
    ? `url(${fabricBase.url})`
    : 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(59,130,246,0.15), rgba(15,23,42,0.8))';

  const printStageBackground = 'linear-gradient(180deg, rgba(248,250,252,0.08), rgba(148,163,184,0.10))';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
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

      <div className="grid gap-6 xl:grid-cols-[420px,1fr]">
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-5 rounded-3xl border border-white/10 bg-neutral-950/70 p-5 text-white shadow-2xl shadow-black/20 backdrop-blur-xl"
        >
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
              <ImageSelector
                label="参考画像をアップロードしてください"
                required
                value={printGarment}
                onChange={setPrintGarment}
                allowedReferenceTypes={['base']}
                defaultReferenceType="base"
                hint="服・Tシャツ・パーカーなどの参考画像を入れます"
                processing={printGarmentCutoutState === 'processing'}
                hideSelectedPreviewWhileProcessing
                previewUrl={printGarmentCutoutState === 'done' ? printGarmentProcessed : null}
                processingLabel="服を切り抜き中"
              />
              {printGarmentCutoutState === 'error' && (
                <p className="text-xs text-red-300">{printGarmentCutoutError || '背景を分離できませんでした。透明背景または白背景の服画像で再試行してください。'}</p>
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
                </div>
              )}
              <ImageSelector
                label="プリント画像を追加"
                multiple
                required
                value={null}
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
                processingLabel="プリント画像を透明化中"
              />
              {printDesigns.length > 0 && (
                <div className="space-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                  {printDesigns.map((design, index) => {
                    const state = printDesignCutoutStates[index] ?? 'processing';
                    return (
                      <div key={`${design.url}-${index}`} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-white/70">デザイン {index + 1}</span>
                        <div className="flex items-center gap-2">
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
          )}

          <Button
            onClick={handleGenerate}
            isLoading={isGenerating}
            disabled={isGenerating || (!isPrinting
              ? !(fabricBase && fabricDesign)
              : !(printGarmentProcessed
                && printGarmentCutoutState === 'done'
                && printDesignLayers.length
                && printDesignLayers.every((layer) => layer.cutoutState === 'done' && Boolean(layer.displayUrl))))}
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
          {generatedResultsStale && generatedResults.length > 0 && (
            <p className="rounded-xl border border-amber-300/20 bg-amber-950/25 px-3 py-2 text-xs leading-relaxed text-amber-100">
              以下は素材変更前または直前の生成結果です。新しい結果としては扱わず、生成を再実行してください。
            </p>
          )}

          <p className="text-xs leading-relaxed text-white/45">
            {isPrinting
              ? 'AIで描き直さず、配置そのままと布になじませる結果を同じマスク・座標で作成します。履歴は最大8件です。'
              : '生地画像にデザインを重ね、複数の生地質感バリエーションを一度に確認できます。'}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-5"
        >
          <div className="rounded-3xl border border-white/10 bg-neutral-950/80 p-4 shadow-2xl shadow-black/20">
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
              ref={stageRef}
              onPointerDown={clearSelectedLayer}
              className="relative aspect-[4/5] overflow-hidden rounded-3xl border border-white/10 bg-neutral-900"
              style={{
                background: isPrinting ? printStageBackground : fabricStageBackground,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {isPrinting ? (
              <PrintingCompositionStage
                  garmentUrl={printGarmentCutoutState === 'done' ? printGarmentProcessed : null}
                  garmentMaskUrl={printGarmentCutoutState === 'done' ? printGarmentProcessed : null}
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
                    setPrintDesignLayers((prev) => prev.map((layer) => (layer.id === id ? { ...layer, transform } : layer)));
                  }}
                />
              ) : (
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
          {generatedResults.length > 0 && (
            <div className="rounded-3xl border border-white/10 bg-neutral-950/80 p-4 shadow-2xl shadow-black/20">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white/60">生成結果</p>
                  <h3 className="text-lg font-semibold text-white">
                    {isPrinting ? 'プリント結果' : '生地バリエーション'}
                  </h3>
                  {isPrinting && (
                    <p className="mt-1 text-xs text-white/45">比較・履歴 {generatedResults.length}/8</p>
                  )}
                  {generatedResultsStale && (
                    <p className="mt-1 text-xs text-amber-200">前回結果（未更新）</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isPrinting && generatedResults.length >= 2 && (
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
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {generatedResults.map((result) => (
                  <div key={result.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                    <button
                      type="button"
                      onClick={() => setSelectedResult(result)}
                      className="block aspect-[4/5] w-full cursor-zoom-in bg-neutral-900 text-left transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-primary-400/60"
                      aria-label={`${result.title} を拡大`}
                    >
                      <img
                        src={result.imageUrl}
                        alt={result.title}
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                    </button>
                    <div className="space-y-2 p-4">
                      <div>
                        <p className="font-semibold text-white">{result.title}</p>
                        <p className="mt-1 text-sm text-white/55">{result.note}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </div>

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
          </div>
        )}
      </Modal>
      {showResultComparison && generatedResults.length >= 2 && (
        <ImageCompare
          images={generatedResults.map((result) => ({
            url: result.imageUrl,
            label: result.title,
            prompt: result.note,
          }))}
          onClose={() => setShowResultComparison(false)}
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
          onClose={() => setPrintMaskEditorTarget(null)}
          onApply={applyEditedPrintMask}
        />
      )}
    </div>
  );
}
