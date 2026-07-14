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
import { Button } from '../components/ui';
import { ImageSelector, type SelectedImage } from '../components/ImageSelector';
import { PrintingCompositionStage } from '../components/workspace/PrintingCompositionStage';
import { useAuthStore } from '../stores/authStore';
import {
  buildPrintGarmentCutoutDataUrl,
  buildPrintRequestSignature,
  buildPrintRequestSnapshot,
  renderPrintRequestComposition,
  restorePrintResultToStageDataUrl,
} from '../lib/workspaceMaterialReferences';
import { editImageWithPrompt } from '../lib/imageApi';

type WorkbenchMode = 'fabric' | 'printing';

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
  cutoutState: 'idle' | 'processing' | 'done' | 'error';
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
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
  const [fabricBase, setFabricBase] = useState<SelectedImage | null>(null);
  const [fabricDesign, setFabricDesign] = useState<SelectedImage | null>(null);
  const [fabricLayer, setFabricLayer] = useState<AssetLayer | null>(null);
  const [fabricPresetIds, setFabricPresetIds] = useState<string[]>(['cotton', 'denim', 'satin']);
  const [printGarment, setPrintGarment] = useState<SelectedImage | null>(null);
  const [printGarmentProcessed, setPrintGarmentProcessed] = useState<string | null>(null);
  const [printGarmentCutoutState, setPrintGarmentCutoutState] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [printDesigns, setPrintDesigns] = useState<SelectedImage[]>([]);
  const [printDesignLayers, setPrintDesignLayers] = useState<AssetLayer[]>([]);
  const printRequestRevisionRef = useRef(0);

  const printSnapshotSignature = useMemo(() => {
    if (!currentBrand?.id || !printGarmentProcessed) return '';
    return buildPrintRequestSignature({
      brandId: currentBrand.id,
      brandName: currentBrand.name || 'brand',
      stageSize: printStageSize,
      garment: {
        sourceUrl: printGarmentProcessed,
        referenceType: printGarment?.referenceType ?? null,
      },
      designs: printDesignLayers.map((layer) => ({
        id: layer.id,
        sourceUrl: layer.originalUrl,
        transform: layer.transform,
      })),
    });
  }, [currentBrand?.id, currentBrand?.name, printGarment?.referenceType, printGarmentProcessed, printDesignLayers]);

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
        ...(printGarmentProcessed ? [{
          id: 'print-garment',
          label: '参考画像',
          originalUrl: printGarment?.url || printGarmentProcessed,
          displayUrl: printGarmentProcessed,
          transform: defaultTransform({ x: 50, y: 52, scale: 1, opacity: 1 }),
          autoCutout: true,
          cutoutState: 'done' as const,
        }] : []),
        ...printDesignLayers,
      ];
    }
    return fabricLayer ? [fabricLayer] : [];
  }, [fabricLayer, isPrinting, printDesignLayers, printGarment, printGarmentProcessed]);

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
    }));
  }, [fabricBase, fabricDesign]);

  useEffect(() => {
    if (!printGarment) {
      setPrintGarmentProcessed(null);
      setPrintGarmentCutoutState('idle');
      return;
    }
    let cancelled = false;
    setPrintGarmentCutoutState('processing');
    setPrintGarmentProcessed(null);
    void buildPrintGarmentCutoutDataUrl({ imageUrl: printGarment.url })
      .then((result) => {
        if (cancelled) return;
        setPrintGarmentProcessed(result.dataUrl);
        setPrintGarmentCutoutState('done');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Print garment cutout failed', error);
        setPrintGarmentProcessed(null);
        setPrintGarmentCutoutState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [printGarment]);

  useEffect(() => {
    if (!printDesigns.length) {
      setPrintDesignLayers([]);
      return;
    }
    const previousLayers = printDesignLayers;
    setPrintDesignLayers(printDesigns.map((design, index) => {
      const layerId = `print-design-${index}`;
      const previousLayer = previousLayers.find((layer) => layer.id === layerId);
      return {
        id: layerId,
        label: `デザイン ${index + 1}`,
        originalUrl: design.url,
        displayUrl: design.url,
        transform: defaultTransform({
          x: previousLayer?.transform.x ?? 50 + ((index % 3) - 1) * 8,
          y: previousLayer?.transform.y ?? 44 + Math.floor(index / 3) * 14,
          scale: previousLayer?.transform.scale ?? (index === 0 ? 1 : 0.88),
          rotation: previousLayer?.transform.rotation ?? (index % 2 === 0 ? -6 : 6) * (index % 3),
          opacity: previousLayer?.transform.opacity ?? 1,
        }),
        autoCutout: false,
        cutoutState: 'done',
      };
    }));
  }, [printDesigns]);

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
      const garments = printGarmentProcessed
        ? [{
            id: 'print-garment',
            label: '参考画像',
            originalUrl: printGarment?.url || printGarmentProcessed,
            displayUrl: printGarmentProcessed,
            transform: defaultTransform({ x: 50, y: 52, scale: 1, opacity: 1 }),
            autoCutout: true,
            cutoutState: 'done' as const,
          }]
        : [];
      return [...garments, ...printDesignLayers];
    }

    return fabricLayer ? [fabricLayer] : [];
  }, [fabricLayer, isPrinting, printDesignLayers, printGarment, printGarmentProcessed]);

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
    if (isPrinting && (!printGarmentProcessed || !printDesignLayers.length)) {
      toast.error('参考画像とプリント画像を入れてください');
      return;
    }

    setIsGenerating(true);
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
        }, {
          id: 'fabric-design',
          label: 'デザイン',
          originalUrl: fabricDesign!.url,
          displayUrl: fabricDesign!.url,
          transform: fabricLayer?.transform || defaultTransform({ x: 54, y: 47, scale: 1, rotation: -8 }),
          autoCutout: false,
          cutoutState: 'idle',
        }];

        const variantResults: WorkbenchResult[] = [];
        for (const preset of fabricVariants.filter((variant) => fabricPresetIds.includes(variant.id))) {
          const imageUrl = await renderComposition(width, height, fabricBase?.url || null, preset.tint, baseLayers, 'fabric');
          variantResults.push({
            id: `${preset.id}-${Date.now()}`,
            title: `生地バリエーション: ${preset.name}`,
            note: `${preset.name} の質感で重ねた見本`,
            imageUrl,
          });
        }
        setGeneratedResults(variantResults);
        toast.success('生地バリエーションを生成しました');
        return;
      }

      const requestState = { ...currentPrintStateRef.current };
      const nextRevision = requestState.revision;
      const nextSnapshot = await buildPrintRequestSnapshot({
        revision: nextRevision,
        brandId: currentBrand.id,
        brandName: currentBrand.name || 'brand',
        garmentUrl: printGarmentProcessed!,
        garmentReferenceType: printGarment?.referenceType ?? null,
        designs: printDesignLayers.map((layer) => ({
          id: layer.id,
          sourceUrl: layer.originalUrl,
          transform: {
            x: layer.transform.x,
            y: layer.transform.y,
            scale: layer.transform.scale,
            rotation: layer.transform.rotation,
            opacity: layer.transform.opacity,
          },
        })),
        stageSize: printStageSize,
      });
      if (
        currentPrintStateRef.current.revision !== requestState.revision
        || currentPrintStateRef.current.signature !== requestState.signature
        || requestState.signature !== nextSnapshot.signature
      ) {
        return;
      }

      const composedInput = await renderPrintRequestComposition(nextSnapshot);
      if (
        currentPrintStateRef.current.revision !== requestState.revision
        || currentPrintStateRef.current.signature !== requestState.signature
      ) {
        return;
      }

      const editPrompt = [
        'Preserve the placed graphic exactly as captured.',
        'Keep the same position, scale, rotation, and opacity.',
        'Keep the result in the same 720x900 coordinate system.',
        'Keep the background transparent.',
        'Return one result only.',
      ].join(' ');

      const editResult = await editImageWithPrompt(composedInput, editPrompt, currentBrand.id, {
        rightsConfirmed: true,
        outputBackground: 'transparent',
      });
      if (
        currentPrintStateRef.current.revision !== requestState.revision
        || currentPrintStateRef.current.signature !== requestState.signature
      ) {
        return;
      }
      if (!editResult.success || !editResult.imageUrl) {
        throw new Error(editResult.error || '画像編集に失敗しました');
      }

      const normalizedResultUrl = await restorePrintResultToStageDataUrl({
        imageUrl: editResult.imageUrl,
        snapshot: nextSnapshot,
      });
      if (
        currentPrintStateRef.current.revision !== requestState.revision
        || currentPrintStateRef.current.signature !== requestState.signature
      ) {
        return;
      }

      setGeneratedResults([{
        id: `print-${nextRevision}`,
        title: 'プリント結果',
        note: '透明背景 / 1件のみ',
        imageUrl: normalizedResultUrl,
      }]);
      toast.success('プリント結果を生成しました');
    } catch (error: any) {
      console.error('Workbench generation failed', error);
      toast.error(error?.message || '生成に失敗しました');
    } finally {
      setIsGenerating(false);
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
              ? '参考画像とデザインを透明合成して、同じ配置のままAIで微調整します。'
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
                hideSelectedPreviewWhileProcessing={false}
                processingLabel="服を切り抜き中"
              />
              {printGarmentCutoutState === 'error' && (
                <p className="text-xs text-red-300">背景を分離できませんでした。透明背景または白背景の服画像で再試行してください。</p>
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
                processing={false}
                hideSelectedPreviewWhileProcessing={false}
                processingLabel="読み込み中"
              />
            </div>
          )}

          <Button
            onClick={handleGenerate}
            isLoading={isGenerating}
            disabled={isGenerating || (!isPrinting ? !(fabricBase && fabricDesign) : !(printGarmentProcessed && printDesignLayers.length))}
            className="w-full"
            size="lg"
            leftIcon={isGenerating ? undefined : <Sparkles className="w-5 h-5" />}
          >
            {isGenerating ? '生成中...' : '生成して結果を出す'}
          </Button>

          <p className="text-xs leading-relaxed text-white/45">
            {isPrinting
              ? '透明合成した1枚だけをAIに送り、生成結果は同じ座標系で1件だけ返します。'
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
                  garmentUrl={printGarmentProcessed}
                  garmentMaskUrl={printGarmentProcessed}
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
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white/60">生成結果</p>
                  <h3 className="text-lg font-semibold text-white">
                    {isPrinting ? 'プリント結果' : '生地バリエーション'}
                  </h3>
                </div>
                <Layers3 className="h-5 w-5 text-primary-200" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {generatedResults.map((result) => (
                  <div key={result.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                    <div className="aspect-[4/5] bg-neutral-900">
                      <img
                        src={result.imageUrl}
                        alt={result.title}
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                    </div>
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
    </div>
  );
}
