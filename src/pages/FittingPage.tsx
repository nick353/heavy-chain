import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  Camera,
  Download,
  Pencil,
  RefreshCw,
  Ruler,
  Shirt,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { generateModelMatrix } from '../lib/imageApi';
import {
  BRAND_LIKENESS_BLOCK_COPY,
  GENERATION_LEGAL_COPY,
  UPLOAD_RIGHTS_CONFIRMATION_LABEL,
  validateLegalSafetyInput,
} from '../lib/legalSafetyGuard';
import { saveWorkspaceArtifact } from '../lib/localWorkspaceArtifacts';
import { useAuthStore } from '../stores/authStore';
import { useCanvasStore } from '../stores/canvasStore';
import { MaterialWorkbench } from '../components/workspace/MaterialWorkbench';
import {
  buildMaterialReferenceMetadata,
  type MaterialReferenceMetadata,
  type MaterialReferenceState,
} from '../lib/workspaceMaterialReferences';
import type { Json } from '../types/database';

type Gender = 'female' | 'male';
type MatrixItem = {
  bodyType: string;
  bodyTypeName: string;
  ageGroup: string;
  ageGroupName: string;
  imageUrl: string;
  storagePath?: string;
  imageId?: string;
  persistenceStatus?: 'completed' | 'failed';
};
type LastRequest = {
  productDescription: string;
  imageUrl?: string;
  sourceMaterialImageUrl?: string;
  bodyTypes: string[];
  ageGroups: string[];
  gender: Gender;
  materialReference?: MaterialReferenceMetadata;
  materialReferences?: MaterialReferenceMetadata[];
  layerPlan?: Record<string, Json | undefined>;
  maskPlan?: Record<string, Json | undefined>;
  compositionPreview?: Record<string, Json | undefined>;
};
type HistoryItem = {
  id: string;
  title: string;
  status: string;
  time: string;
  previewUrl?: string;
  imageUrls?: string[];
  count: number;
  artifactIds?: string[];
  remoteJobId?: string | null;
  remoteImageIds?: Array<string | null>;
  remoteStoragePaths?: Array<string | null>;
  sourceMaterialImageUrl?: string;
  materialReference?: MaterialReferenceMetadata;
  materialReferences?: MaterialReferenceMetadata[];
  layerPlan?: Record<string, Json | undefined>;
  maskPlan?: Record<string, Json | undefined>;
  compositionPreview?: Record<string, Json | undefined>;
};

const bodyTypeOptions = [
  { id: 'slim', label: 'スリム' },
  { id: 'regular', label: '標準' },
  { id: 'plus', label: 'プラス' },
];

const ageGroupOptions = [
  { id: '20s', label: '20代' },
  { id: '30s', label: '30代' },
  { id: '40s', label: '40代' },
];

const genderOptions: Array<{ id: Gender; label: string }> = [
  { id: 'female', label: '女性' },
  { id: 'male', label: '男性' },
];

const fittingWorkflows = [
  {
    id: 'ec-standard',
    title: 'EC標準フィット',
    description: '白背景で正面・側面の購買判断に使う',
    productDescription: 'EC商品ページ向け。自然光、白背景、服のシルエットと素材感が分かる落ち着いたモデル着用画像。',
    bodyTypes: ['slim', 'regular'],
    ageGroups: ['20s', '30s'],
    gender: 'female' as Gender,
    icon: Shirt,
    outputs: ['正面着用', '側面確認', '商品ページ'],
  },
  {
    id: 'size-comparison',
    title: 'サイズ比較',
    description: '体型差を並べて返品リスクを下げる',
    productDescription: '同じ衣服を体型別に比較。ECのサイズ感説明に使える、同一背景・同一ポーズのモデル着用画像。',
    bodyTypes: ['slim', 'regular', 'plus'],
    ageGroups: ['20s', '30s'],
    gender: 'female' as Gender,
    icon: Ruler,
    outputs: ['体型差比較', 'サイズ説明', '一覧画像'],
  },
  {
    id: 'lookbook',
    title: 'ルック確認',
    description: 'SNS・LOOK向けに雰囲気まで確認する',
    productDescription: 'ブランドLOOK向け。自然なポーズ、上品な背景、衣服の雰囲気とコーディネートが伝わるモデル着用画像。',
    bodyTypes: ['regular'],
    ageGroups: ['20s', '30s', '40s'],
    gender: 'female' as Gender,
    icon: Camera,
    outputs: ['LOOK素材', 'SNS候補', '雰囲気確認'],
  },
  {
    id: 'customer-range',
    title: '顧客層確認',
    description: '年代ごとの見え方をまとめて確認する',
    productDescription: 'ターゲット顧客層の違いを確認。年代別に同じ衣服の印象差が分かる、ECと販促の両方に使える着用画像。',
    bodyTypes: ['regular', 'plus'],
    ageGroups: ['20s', '30s', '40s'],
    gender: 'female' as Gender,
    icon: Users,
    outputs: ['年代比較', '販促判断', '顧客層確認'],
  },
];

const seedHistory: HistoryItem[] = [
  { id: 'fit-1042', title: 'リネンシャツ / モデル着用', status: '完了', time: '12分前', count: 4 },
  { id: 'fit-1038', title: 'ワイドパンツ / EC白背景', status: '完了', time: '昨日', count: 3 },
];

const initialMaterialReference: MaterialReferenceState = {
  imageUrl: '',
  fileName: '',
  materialKind: '衣服画像',
  maskMode: 'auto',
  activeLayer: '衣服',
  placement: 'モデル前面',
  scale: 72,
  note: '着用生成に使う衣服素材と、モデル上で効かせるレイヤーを先に決めます。',
};

export function FittingPage() {
  const navigate = useNavigate();
  const { currentBrand } = useAuthStore();
  const { createProject, addObject, saveCurrentProject } = useCanvasStore();
  const [productDescription, setProductDescription] = useState(
    '春夏向けのリネン混シャツ。自然光、EC商品ページのメイン画像として使える落ち着いた構図。'
  );
  const [materialReference, setMaterialReference] = useState<MaterialReferenceState>(initialMaterialReference);
  const [selectedBodyTypes, setSelectedBodyTypes] = useState<string[]>(['slim', 'regular']);
  const [selectedAgeGroups, setSelectedAgeGroups] = useState<string[]>(['20s', '30s']);
  const [gender, setGender] = useState<Gender>('female');
  const [activeWorkflowId, setActiveWorkflowId] = useState(fittingWorkflows[0].id);
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultMatrix, setResultMatrix] = useState<MatrixItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>(seedHistory);
  const [errorMessage, setErrorMessage] = useState('');
  const [lastRequest, setLastRequest] = useState<LastRequest | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const garmentImageUrl = materialReference.imageUrl || undefined;
  const garmentFileName = materialReference.fileName;

  const canGenerate = useMemo(() => {
    return Boolean(currentBrand && rightsConfirmed && !isGenerating && (productDescription.trim() || garmentImageUrl) && selectedBodyTypes.length && selectedAgeGroups.length);
  }, [currentBrand, garmentImageUrl, isGenerating, productDescription, rightsConfirmed, selectedAgeGroups.length, selectedBodyTypes.length]);
  const activeWorkflow = fittingWorkflows.find((workflow) => workflow.id === activeWorkflowId) ?? fittingWorkflows[0];
  const selectedBodyTypeLabels = bodyTypeOptions
    .filter((option) => selectedBodyTypes.includes(option.id))
    .map((option) => option.label);
  const selectedAgeGroupLabels = ageGroupOptions
    .filter((option) => selectedAgeGroups.includes(option.id))
    .map((option) => option.label);

  const applyWorkflow = (workflow: typeof fittingWorkflows[number]) => {
    setActiveWorkflowId(workflow.id);
    setProductDescription(workflow.productDescription);
    setSelectedBodyTypes(workflow.bodyTypes);
    setSelectedAgeGroups(workflow.ageGroups);
    setGender(workflow.gender);
  };

  const toggleBodyType = (id: string) => {
    setSelectedBodyTypes((items) => (
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id]
    ));
  };

  const toggleAgeGroup = (id: string) => {
    setSelectedAgeGroups((items) => (
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id]
    ));
  };

  const runGeneration = async (request: LastRequest) => {
    if (!currentBrand) {
      setErrorMessage('ブランドを読み込んでからもう一度試してください。');
      return;
    }

    setIsGenerating(true);
    setErrorMessage('');
    setResultMatrix([]);
    setLastRequest(request);

    if (!rightsConfirmed) {
      setIsGenerating(false);
      setErrorMessage('素材と生成指示の権利確認にチェックしてください。');
      return;
    }
    const legalSafetyAssessment = validateLegalSafetyInput([
      request.productDescription,
      request.materialReference?.fileName,
      request.materialReference?.note,
      request.layerPlan ? JSON.stringify(request.layerPlan) : undefined,
      request.maskPlan ? JSON.stringify(request.maskPlan) : undefined,
      request.compositionPreview ? JSON.stringify(request.compositionPreview) : undefined,
    ]);
    if (legalSafetyAssessment.blocked) {
      setIsGenerating(false);
      setErrorMessage(BRAND_LIKENESS_BLOCK_COPY);
      return;
    }

    const response = await generateModelMatrix(request.productDescription, currentBrand.id, {
      imageUrl: request.imageUrl,
      bodyTypes: request.bodyTypes,
      ageGroups: request.ageGroups,
      gender: request.gender,
      rightsConfirmed,
    });

    setIsGenerating(false);

    const matrix = response.matrix ?? [];

    if (!response.success || matrix.length === 0) {
      setErrorMessage(response.error || 'モデルセット写真を生成できませんでした。');
      return;
    }

    const artifactIds = matrix.map((item, index) => {
      const title = `${item.bodyTypeName} ${item.ageGroupName} / モデル着用`;
      const artifactId = `local-fit-${Date.now()}-${index}`;
      return saveWorkspaceArtifact({
        id: artifactId,
        brandId: currentBrand.id,
        featureType: 'model-matrix',
        title,
        imageUrl: item.imageUrl,
        prompt: request.productDescription,
        metadata: {
          feature: 'model-matrix',
          bodyType: item.bodyType,
          bodyTypeName: item.bodyTypeName,
          ageGroup: item.ageGroup,
          ageGroupName: item.ageGroupName,
          gender: request.gender,
          remoteSaveStatus: 'succeeded',
          remoteJobId: response.jobId ?? null,
          remoteImageId: item.imageId ?? null,
          remoteStoragePath: item.storagePath ?? null,
          remotePersistenceStatus: item.persistenceStatus ?? response.persistenceStatus ?? null,
          sourceArtifactId: artifactId,
          sourceStoragePath: item.storagePath ?? null,
          materialReference: request.materialReference,
          materialReferences: request.materialReferences,
          layerPlan: request.layerPlan,
          maskPlan: request.maskPlan,
          compositionPreview: request.compositionPreview,
        },
        sourceJobId: response.jobId ?? undefined,
      }).id;
    });

    setResultMatrix(matrix);
    setHistory((items) => [
      {
        id: `fit-${Date.now()}`,
        title: `${request.productDescription.trim().slice(0, 24) || '衣服画像'} / ${matrix.length}枚`,
        status: '完了',
        time: 'たった今',
        previewUrl: matrix[0]?.imageUrl,
        imageUrls: matrix.map((item) => item.imageUrl),
        count: matrix.length,
        artifactIds,
        remoteJobId: response.jobId ?? null,
        remoteImageIds: matrix.map((item) => item.imageId ?? null),
        remoteStoragePaths: matrix.map((item) => item.storagePath ?? null),
        sourceMaterialImageUrl: request.sourceMaterialImageUrl ?? request.imageUrl,
        materialReference: request.materialReference,
        materialReferences: request.materialReferences,
        layerPlan: request.layerPlan,
        maskPlan: request.maskPlan,
        compositionPreview: request.compositionPreview,
      },
      ...items,
    ]);
  };

  const handleGenerate = () => {
    const materialReferenceMetadata = buildMaterialReferenceMetadata(materialReference);
    const materialReferenceSummary = materialReferenceMetadata.hasImage
      ? `${materialReferenceMetadata.materialKind}: ${materialReferenceMetadata.fileName ?? 'uploaded'} / ${materialReferenceMetadata.activeLayer} / ${materialReferenceMetadata.placement} / ${materialReferenceMetadata.scale}%`
      : '衣服素材画像なし';
    const layerPlan = {
      activeLayer: materialReference.activeLayer,
      placement: materialReference.placement,
      scale: materialReference.scale,
    };
    const maskPlan = {
      maskMode: materialReference.maskMode,
    };
    const compositionPreview = {
      workflowId: activeWorkflow.id,
      workflowTitle: activeWorkflow.title,
      previewKind: 'uploaded-fitting-material',
      hasUploadedMaterial: Boolean(garmentImageUrl),
      placement: materialReference.placement,
    };
    const fittingBrief = [
      productDescription.trim(),
      `用途: ${activeWorkflow.title}`,
      `出力: ${activeWorkflow.outputs.join(' / ')}`,
      `体型: ${selectedBodyTypeLabels.join(' / ')}`,
      `年代: ${selectedAgeGroupLabels.join(' / ')}`,
      `素材: ${materialReferenceSummary}`,
    ].filter(Boolean).join('\n');

    void runGeneration({
      productDescription: fittingBrief,
      imageUrl: garmentImageUrl,
      sourceMaterialImageUrl: garmentImageUrl,
      bodyTypes: selectedBodyTypes,
      ageGroups: selectedAgeGroups,
      gender,
      materialReference: materialReferenceMetadata,
      materialReferences: [materialReferenceMetadata],
      layerPlan,
      maskPlan,
      compositionPreview,
    });
  };

  const handleRetry = () => {
    if (!lastRequest) return;
    void runGeneration(lastRequest);
  };

  const handleEditHistory = (item: HistoryItem) => {
    if (!currentBrand || !item.previewUrl) return;

    const projectId = createProject(`Fitting: ${item.title}`, currentBrand.id);
    const imageUrls = item.imageUrls?.length ? item.imageUrls : [item.previewUrl];
    const sourceMaterialImageUrl = item.sourceMaterialImageUrl ?? lastRequest?.sourceMaterialImageUrl ?? lastRequest?.imageUrl;
    if (sourceMaterialImageUrl) {
      addObject({
        type: 'image',
        x: 40,
        y: 64,
        width: 220,
        height: 280,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 0.82,
        locked: false,
        visible: true,
        src: sourceMaterialImageUrl,
        label: `${item.materialReference?.fileName ?? lastRequest?.materialReference?.fileName ?? '衣服素材'} / 参照レイヤー`,
        metadata: {
          feature: 'model-matrix-source-material',
          prompt: lastRequest?.productDescription,
          generation: 0,
          parameters: {
            source: 'fitting-material-reference',
            materialReference: item.materialReference ?? lastRequest?.materialReference,
            materialReferences: item.materialReferences ?? lastRequest?.materialReferences,
            layerPlan: item.layerPlan ?? lastRequest?.layerPlan,
            maskPlan: item.maskPlan ?? lastRequest?.maskPlan,
            compositionPreview: item.compositionPreview ?? lastRequest?.compositionPreview,
          },
        },
      });
    }
    imageUrls.forEach((imageUrl, index) => {
      addObject({
        type: 'image',
        x: 300 + (index % 2) * 390,
        y: 96 + Math.floor(index / 2) * 480,
        width: 360,
        height: 450,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        locked: false,
        visible: true,
        src: imageUrl,
        label: imageUrls.length > 1 ? `${item.title} ${index + 1}` : item.title,
        metadata: {
          feature: 'model-matrix',
          prompt: lastRequest?.productDescription,
          generation: 0,
          parameters: {
            source: 'fitting-history',
            sourceArtifactId: item.artifactIds?.[index],
            sourceArtifactIds: item.artifactIds ?? [],
            remoteJobId: item.remoteJobId ?? null,
            remoteImageId: item.remoteImageIds?.[index] ?? null,
            remoteStoragePath: item.remoteStoragePaths?.[index] ?? null,
            materialReference: item.materialReference ?? lastRequest?.materialReference,
            materialReferences: item.materialReferences ?? lastRequest?.materialReferences,
            layerPlan: item.layerPlan ?? lastRequest?.layerPlan,
            maskPlan: item.maskPlan ?? lastRequest?.maskPlan,
            compositionPreview: item.compositionPreview ?? lastRequest?.compositionPreview,
          },
        },
      });
    });
    saveCurrentProject();
    navigate(`/canvas/${projectId}`);
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="glass-panel rounded-2xl p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
                AIフィッティング
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                衣服画像と商品説明から、体型・年齢別のモデルセット写真を生成します。
              </p>
            </div>
            <Link to="/generate" className="btn-secondary inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm">
              <Sparkles className="h-4 w-4" />
              既存生成へ
            </Link>
          </div>

          <section className="mt-6 rounded-2xl border border-neutral-200 bg-white/55 p-4 dark:border-white/10 dark:bg-surface-900/40">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-neutral-950 dark:text-white">着用ワークフローを選ぶ</h2>
                <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                  Lightchainで用途を選んでいた感覚のまま、モデル条件と出力目的を先に決めます。
                </p>
              </div>
              <span className="w-fit whitespace-nowrap rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-950/50 dark:text-primary-200">
                {selectedBodyTypes.length * selectedAgeGroups.length} パターン
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {fittingWorkflows.map((workflow) => {
                const Icon = workflow.icon;
                const selected = workflow.id === activeWorkflowId;

                return (
                  <button
                    key={workflow.id}
                    type="button"
                    onClick={() => applyWorkflow(workflow)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      selected
                        ? 'border-primary-400 bg-primary-50/70 ring-2 ring-primary-100 dark:border-primary-300 dark:bg-primary-400/10 dark:ring-primary-400/20'
                        : 'border-neutral-200 bg-white/75 hover:border-primary-300 hover:bg-white dark:border-white/10 dark:bg-surface-950/50 dark:hover:border-primary-500/70'
                    }`}
                    aria-pressed={selected}
                  >
                    <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                      selected
                        ? 'bg-primary-600 text-white'
                        : 'bg-surface-100 text-neutral-600 dark:bg-surface-800 dark:text-neutral-300'
                    }`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="mt-3 block text-sm font-semibold text-neutral-950 dark:text-white">{workflow.title}</span>
                    <span className="mt-1 block text-sm leading-6 text-neutral-500 dark:text-neutral-400">{workflow.description}</span>
                    <span className="mt-3 flex flex-wrap gap-1.5">
                      {workflow.outputs.map((output) => (
                        <span key={output} className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-neutral-500 ring-1 ring-neutral-200 dark:bg-surface-900 dark:text-neutral-300 dark:ring-white/10">
                          {output}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <MaterialWorkbench
              title="フィッティング素材作業台"
              description="衣服画像、モデル参照、ポーズ、背景を置き、着用生成へ渡すレイヤーを先に決めます。"
              uploadLabel="衣服・モデル・背景素材をアップロード"
              emptyLabel="素材を置くと、生成リクエストとCanvas履歴へ参照画像として残せます"
              state={materialReference}
              onChange={setMaterialReference}
              materialKinds={['衣服画像', 'モデル参照', 'ポーズ参照', '背景参照', 'サイズ比較']}
              layerOptions={['衣服', 'モデル', 'ポーズ', '背景', 'サイズ表']}
              placementOptions={['モデル前面', '平置き参照', '横並び比較', '背景全面', 'サイズ表横']}
            />

            <div className="rounded-2xl border border-white/60 bg-white/50 p-4 dark:border-white/10 dark:bg-surface-900/40">
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-white/75 p-3 dark:bg-surface-950/60">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">体型</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">{selectedBodyTypeLabels.join(' / ')}</p>
                </div>
                <div className="rounded-xl bg-white/75 p-3 dark:bg-surface-950/60">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">年代</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">{selectedAgeGroupLabels.join(' / ')}</p>
                </div>
                <div className="rounded-xl bg-white/75 p-3 dark:bg-surface-950/60 sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">用途</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">{activeWorkflow.title}</p>
                </div>
                <div className="rounded-xl bg-white/75 p-3 dark:bg-surface-950/60 sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">素材</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                    {garmentFileName || '素材未読込'} / {materialReference.activeLayer} / {materialReference.placement}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-gradient-to-br from-surface-50 to-white p-4 dark:from-surface-950 dark:to-surface-900">
                <label htmlFor="fitting-description" className="text-sm font-semibold text-neutral-900 dark:text-white">
                  生成brief
                </label>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  ワークフローを選ぶと自動で整います。必要なときだけ細部を追記してください。
                </p>
                <textarea
                  id="fitting-description"
                  className="mt-3 min-h-32 w-full rounded-xl border border-neutral-200 bg-white/80 p-4 text-sm leading-6 text-neutral-800 outline-none transition focus:border-primary-400 dark:border-surface-700 dark:bg-surface-950/70 dark:text-neutral-100"
                  value={productDescription}
                  onChange={(event) => setProductDescription(event.target.value)}
                />
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Body types</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {bodyTypeOptions.map((option) => {
                      const selected = selectedBodyTypes.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => toggleBodyType(option.id)}
                          className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                            selected
                              ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                              : 'bg-surface-100 text-neutral-600 hover:bg-primary-50 hover:text-primary-700 dark:bg-surface-800 dark:text-neutral-300'
                          }`}
                          aria-pressed={selected}
                        >
                          {selected && <Check className="h-3.5 w-3.5" />}
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Age groups</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {ageGroupOptions.map((option) => {
                      const selected = selectedAgeGroups.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => toggleAgeGroup(option.id)}
                          className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                            selected
                              ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                              : 'bg-surface-100 text-neutral-600 hover:bg-primary-50 hover:text-primary-700 dark:bg-surface-800 dark:text-neutral-300'
                          }`}
                          aria-pressed={selected}
                        >
                          {selected && <Check className="h-3.5 w-3.5" />}
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex rounded-xl bg-surface-100 p-1 dark:bg-surface-950/70">
                    {genderOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setGender(option.id)}
                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                          gender === option.id
                            ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                            : 'text-neutral-500 dark:text-neutral-400'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <label className="flex max-w-xl items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
                    <input
                      type="checkbox"
                      checked={rightsConfirmed}
                      onChange={(event) => setRightsConfirmed(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                      disabled={isGenerating}
                    />
                    <span>
                      <span className="block font-semibold">{UPLOAD_RIGHTS_CONFIRMATION_LABEL}</span>
                      <span className="mt-1 block leading-5">{GENERATION_LEGAL_COPY}</span>
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    className="btn-primary inline-flex items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {isGenerating ? '生成中' : 'AI生成'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {errorMessage && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 rounded-2xl border border-red-200 bg-red-50/80 p-4 dark:border-red-900/60 dark:bg-red-950/30">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                  <div>
                    <h2 className="text-sm font-semibold text-red-900 dark:text-red-100">生成に失敗しました</h2>
                    <p className="mt-1 text-sm text-red-700 dark:text-red-200">{errorMessage}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={!lastRequest || isGenerating}
                  className="btn-secondary inline-flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  再試行
                </button>
              </div>
            </motion.div>
          )}

          {isGenerating && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 rounded-2xl border border-primary-200 bg-primary-50/70 p-4 dark:border-primary-900/60 dark:bg-primary-950/30">
              <div className="flex items-center gap-3">
                <RefreshCw className="h-5 w-5 animate-spin text-primary-600" />
                <div>
                  <p className="text-sm font-semibold text-primary-900 dark:text-primary-100">モデルセット写真を生成中</p>
                  <p className="text-xs text-primary-700/80 dark:text-primary-200/80">選択した体型と年齢グループの組み合わせを処理しています。</p>
                </div>
              </div>
            </motion.div>
          )}

          {resultMatrix.length > 0 && (
            <section className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">生成結果プレビュー</h2>
                <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-950/40 dark:text-primary-200">
                  {resultMatrix.length}枚
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {resultMatrix.map((item, index) => (
                  <figure key={item.storagePath || item.imageUrl || `${item.bodyType}-${item.ageGroup}-${index}`} className="overflow-hidden rounded-2xl border border-white/60 bg-white/60 dark:border-white/10 dark:bg-surface-900/50">
                    <img src={item.imageUrl} alt={`${item.bodyTypeName} ${item.ageGroupName} のモデル写真`} className="aspect-[4/5] w-full object-cover" />
                    <figcaption className="p-3 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                      {item.bodyTypeName} × {item.ageGroupName}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="glass-panel rounded-2xl p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">ローカル生成履歴</h2>
          <div className="mt-4 space-y-3">
            {history.map((item) => (
              <div key={item.id} className="rounded-2xl border border-white/60 bg-white/55 p-4 dark:border-white/10 dark:bg-surface-900/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-100 text-primary-600 dark:bg-surface-800 dark:text-primary-300">
                      {item.previewUrl ? (
                        <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Shirt className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{item.title}</p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">{item.status} / {item.time} / {item.count}枚</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2">
                  <button type="button" className="flex items-center justify-center gap-1 rounded-lg bg-surface-100 px-2 py-2 text-xs font-medium text-neutral-600 transition hover:bg-primary-50 hover:text-primary-700 dark:bg-surface-800 dark:text-neutral-300 dark:hover:bg-primary-900/30">
                    <Download className="h-3.5 w-3.5" />
                    DL
                  </button>
                  <button type="button" onClick={() => handleEditHistory(item)} disabled={!item.previewUrl} className="flex items-center justify-center gap-1 rounded-lg bg-surface-100 px-2 py-2 text-xs font-medium text-neutral-600 transition hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-surface-800 dark:text-neutral-300 dark:hover:bg-primary-900/30">
                    <Pencil className="h-3.5 w-3.5" />
                    編集
                  </button>
                  <button type="button" onClick={handleRetry} disabled={!lastRequest || isGenerating} className="flex items-center justify-center gap-1 rounded-lg bg-surface-100 px-2 py-2 text-xs font-medium text-neutral-600 transition hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-surface-800 dark:text-neutral-300 dark:hover:bg-primary-900/30">
                    <RefreshCw className="h-3.5 w-3.5" />
                    再生成
                  </button>
                  <button type="button" onClick={() => setHistory((items) => items.filter((historyItem) => historyItem.id !== item.id))} className="flex items-center justify-center gap-1 rounded-lg bg-surface-100 px-2 py-2 text-xs font-medium text-neutral-600 transition hover:bg-primary-50 hover:text-primary-700 dark:bg-surface-800 dark:text-neutral-300 dark:hover:bg-primary-900/30">
                    <Trash2 className="h-3.5 w-3.5" />
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
