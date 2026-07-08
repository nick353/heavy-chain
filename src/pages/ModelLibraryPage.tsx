import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, ChevronRight, Save, Shirt, SlidersHorizontal, Sparkles, UserRound } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { MaterialWorkbench } from '../components/workspace/MaterialWorkbench';
import {
  buildMaterialReferenceMetadata,
  type MaterialReferenceState,
} from '../lib/workspaceMaterialReferences';
import { buildGenerationIntentHref, handoffWorkspaceToCanvas, workspaceSourceConfig } from '../lib/workspaceHandoff';

const intents = ['EC標準', 'LOOK確認', '広告検証'] as const;
const fieldClass = 'mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20';

type Intent = (typeof intents)[number];
type ModelCandidate = {
  id: string;
  label: string;
  face: string;
  pose: string;
  bodyType: string;
  skinTone: string;
  ageGroup: string;
  usage: Intent;
  productDescription: string;
  accent: string;
  modelMatrixBodyTypes: string[];
  modelMatrixAgeGroups: string[];
  modelMatrixSkinTone: 'light' | 'medium' | 'dark';
  modelMatrixHairStyle: 'short' | 'medium' | 'long';
};
type HistoryItem = {
  id: string;
  label: string;
};

const initialHistory: HistoryItem[] = [
  { id: 'model-library-history-1', label: 'EC標準モデル候補を整理' },
  { id: 'model-library-history-2', label: '着用目的と商品説明を保存' },
];

const intentMeta: Record<Intent, { label: string; description: string; outputs: string[] }> = {
  EC標準: {
    label: 'EC標準',
    description: '商品ページで使う正面・素材確認向け。服の形、透け感、サイズ感を安定して見せます。',
    outputs: ['白背景', '正面確認', '商品ページ'],
  },
  LOOK確認: {
    label: 'LOOK確認',
    description: '着こなしや雰囲気を見せるLOOK向け。ポーズ、背景、動きを優先します。',
    outputs: ['LOOK画像', 'SNS転用', 'ポーズ確認'],
  },
  広告検証: {
    label: '広告検証',
    description: 'LPや広告で使う信頼感重視のモデル向け。年齢感、表情、購買訴求を合わせます。',
    outputs: ['広告素材', 'LP用', '信頼感'],
  },
};

const modelCandidates: ModelCandidate[] = [
  {
    id: 'clean-ec-20s-warm',
    label: 'Clean EC 20s',
    face: '柔らかい卵型の顔、自然な微笑み、黒髪のショートボブ',
    pose: '正面立ち、肩線をまっすぐ見せる、両腕は自然に下ろす',
    bodyType: '標準体型 / 162cm / S-Mサイズの着用確認',
    skinTone: 'ウォームライト',
    ageGroup: '20代',
    usage: 'EC標準',
    productDescription: 'Lightchain シアージャケット、軽い透け感、ミニマルなEC商品画像',
    accent: '#14b8a6',
    modelMatrixBodyTypes: ['regular'],
    modelMatrixAgeGroups: ['20s'],
    modelMatrixSkinTone: 'light',
    modelMatrixHairStyle: 'short',
  },
  {
    id: 'street-look-30s-neutral',
    label: 'Street LOOK 30s',
    face: 'シャープな輪郭、落ち着いた表情、センターパートのダークヘア',
    pose: '斜め45度の歩き姿、片手をポケット、裾の動きを見せる',
    bodyType: 'やや高身長のユニセックス体型 / 175cm / M-Lサイズの落ち感',
    skinTone: 'ニュートラルミディアム',
    ageGroup: '30代',
    usage: 'LOOK確認',
    productDescription: 'Lightchain ロングトレンチ、都市的なストリートLOOK、SNS転用しやすい着用画像',
    accent: '#111827',
    modelMatrixBodyTypes: ['regular'],
    modelMatrixAgeGroups: ['30s'],
    modelMatrixSkinTone: 'medium',
    modelMatrixHairStyle: 'medium',
  },
  {
    id: 'premium-ad-40s-deep',
    label: 'Premium AD 40s',
    face: '骨格がはっきりした顔、上品な視線、低めに結んだヘア',
    pose: '椅子に浅く腰掛け、襟元と袖口を見せる、手元は軽く重ねる',
    bodyType: '落ち着いた標準体型 / 166cm / 上質なゆとりを確認',
    skinTone: 'ディープブラウン',
    ageGroup: '40代',
    usage: '広告検証',
    productDescription: 'Lightchain プレミアムニット、素材感と購買信頼を強調する広告検証画像',
    accent: '#7c3aed',
    modelMatrixBodyTypes: ['regular'],
    modelMatrixAgeGroups: ['40s'],
    modelMatrixSkinTone: 'dark',
    modelMatrixHairStyle: 'long',
  },
];

const initialModelMaterial: MaterialReferenceState = {
  imageUrl: '',
  fileName: '',
  materialKind: 'モデル参照',
  maskMode: 'keep',
  activeLayer: '顔',
  placement: '正面',
  scale: 58,
  note: '顔、ポーズ、商品写真を置いてモデル条件に反映する',
};

const encodeSvg = (svg: string) => {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const escapeSvgText = (value: string) => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
};

const buildModelLibraryPreviewSvg = ({
  candidate,
  face,
  pose,
  bodyType,
  skinTone,
  ageGroup,
  usage,
  productDescription,
  primaryInput,
  nextStep,
}: {
  candidate: ModelCandidate;
  face: string;
  pose: string;
  bodyType: string;
  skinTone: string;
  ageGroup: string;
  usage: Intent;
  productDescription: string;
  primaryInput: string;
  nextStep: string;
}) => {
  const safeLabel = escapeSvgText(candidate.label);
  const safeFace = escapeSvgText(face.slice(0, 62));
  const safePose = escapeSvgText(pose.slice(0, 62));
  const safeBody = escapeSvgText(bodyType.slice(0, 62));
  const safeSkin = escapeSvgText(skinTone);
  const safeAge = escapeSvgText(ageGroup);
  const safeUsage = escapeSvgText(usage);
  const safeProduct = escapeSvgText(productDescription.slice(0, 62));
  const safePrimaryInput = escapeSvgText(primaryInput.slice(0, 74));
  const safeNextStep = escapeSvgText(nextStep.slice(0, 74));
  const safeFullPrimaryInput = escapeSvgText(primaryInput);
  const safeFullNextStep = escapeSvgText(nextStep);
  const skinFill = candidate.id === 'premium-ad-40s-deep'
    ? '#8b5e46'
    : candidate.id === 'street-look-30s-neutral'
      ? '#c88f6a'
      : '#f0c7a8';
  const poseTransform = candidate.id === 'street-look-30s-neutral'
    ? 'rotate(-4 300 314)'
    : candidate.id === 'premium-ad-40s-deep'
      ? 'translate(0 24) rotate(2 300 340)'
      : '';

  return encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640" data-model-library="model-library-local-v1">
      <metadata>
        <model-library workflowVersion="model-library-local-v1" selectedModelCandidate="${candidate.id}" primaryInput="${safeFullPrimaryInput}" nextStep="${safeFullNextStep}" />
      </metadata>
      <rect width="960" height="640" rx="36" fill="#f7f7f5"/>
      <rect x="54" y="54" width="852" height="532" rx="30" fill="#ffffff" stroke="#e5e5e5"/>
      <rect x="92" y="98" width="420" height="420" rx="26" fill="#eef6f4" stroke="#d4d4d4"/>
      <path d="M130 438h340" stroke="#94a3b8" stroke-width="8" stroke-linecap="round" opacity=".38"/>
      <g transform="${poseTransform}">
        <circle cx="300" cy="184" r="42" fill="${skinFill}" stroke="#262626" stroke-width="4"/>
        <path d="M266 244h68l40 154h-148z" fill="${candidate.accent}" opacity=".94"/>
        <path d="M266 254c-28 36-42 78-42 120M334 254c34 34 52 74 58 120" fill="none" stroke="#262626" stroke-width="13" stroke-linecap="round"/>
        <path d="M264 398l-22 82M336 398l28 82" fill="none" stroke="#262626" stroke-width="16" stroke-linecap="round"/>
        <path d="M252 304h102" stroke="#ffffff" stroke-width="7" opacity=".72"/>
      </g>
      <text x="560" y="138" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="${candidate.accent}">${safeUsage}</text>
      <text x="560" y="188" font-family="Inter, Arial, sans-serif" font-size="40" font-weight="800" fill="#171717">${safeLabel}</text>
      <text x="560" y="244" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">face: ${safeFace}</text>
      <text x="560" y="288" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">pose: ${safePose}</text>
      <text x="560" y="332" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">body: ${safeBody}</text>
      <text x="560" y="376" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">skin: ${safeSkin} / age: ${safeAge}</text>
      <text x="560" y="420" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">product: ${safeProduct}</text>
      <text x="92" y="472" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#171717">Primary input</text>
      <text x="92" y="498" font-family="Inter, Arial, sans-serif" font-size="16" fill="#525252">${safePrimaryInput}</text>
      <text x="92" y="526" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#171717">Next step</text>
      <text x="92" y="552" font-family="Inter, Arial, sans-serif" font-size="16" fill="#525252">${safeNextStep}</text>
      <text x="92" y="582" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#171717">selected-model-candidate:${candidate.id}</text>
      <text x="92" y="610" font-family="Inter, Arial, sans-serif" font-size="16" fill="#737373">workflowVersion:model-library-local-v1</text>
    </svg>
  `);
};

export function ModelLibraryPage() {
  const navigate = useNavigate();
  const { currentBrand } = useAuthStore();
  const [activeIntent, setActiveIntent] = useState<Intent>(intents[0]);
  const [selectedCandidateId, setSelectedCandidateId] = useState(modelCandidates[0].id);
  const [progress, setProgress] = useState(34);
  const [history, setHistory] = useState(initialHistory);
  const [face, setFace] = useState(modelCandidates[0].face);
  const [pose, setPose] = useState(modelCandidates[0].pose);
  const [bodyType, setBodyType] = useState(modelCandidates[0].bodyType);
  const [skinTone, setSkinTone] = useState(modelCandidates[0].skinTone);
  const [ageGroup, setAgeGroup] = useState(modelCandidates[0].ageGroup);
  const [usage, setUsage] = useState<Intent>(modelCandidates[0].usage);
  const [productDescription, setProductDescription] = useState(modelCandidates[0].productDescription);
  const [materialReference, setMaterialReference] = useState<MaterialReferenceState>(initialModelMaterial);
  const nextHistoryId = useRef(3);
  const selectedCandidate = modelCandidates.find((candidate) => candidate.id === selectedCandidateId) ?? modelCandidates[0];
  const primaryInput = `${face} / ${pose} / ${bodyType} / ${skinTone} / ${ageGroup} / ${usage} / ${productDescription}`;
  const nextStep = `${usage}向けモデル候補 ${selectedCandidate.label} をmodel-library-workspaceとしてモデルマトリクスへ渡す`;
  const directModelMatrixHref = buildGenerationIntentHref({
    feature: 'model-matrix',
    prompt: [
      `Face: ${face}`,
      `Pose: ${pose}`,
      `Body type: ${bodyType}`,
      `Skin tone: ${skinTone}`,
      `Age group: ${ageGroup}`,
      `Usage: ${usage}`,
      `Product description: ${productDescription}`,
    ].join('\n'),
    bodyTypes: selectedCandidate.modelMatrixBodyTypes,
    ageGroups: selectedCandidate.modelMatrixAgeGroups,
    skinTone: selectedCandidate.modelMatrixSkinTone,
    hairStyle: selectedCandidate.modelMatrixHairStyle,
    modelCandidateLabel: selectedCandidate.label,
    sourceWorkspace: 'models',
    workflowVersion: 'model-library-local-v1',
    sourceLabel: workspaceSourceConfig.models.label,
    sourceResumePath: workspaceSourceConfig.models.resumePath,
    sourceMode: 'local-workflow-intake',
  });
  const previewImageUrl = useMemo(() => buildModelLibraryPreviewSvg({
    candidate: selectedCandidate,
    face,
    pose,
    bodyType,
    skinTone,
    ageGroup,
    usage,
    productDescription,
    primaryInput,
    nextStep,
  }), [ageGroup, bodyType, face, nextStep, pose, primaryInput, productDescription, selectedCandidate, skinTone, usage]);
  const activeIntentMeta = intentMeta[activeIntent];
  const selectedProfileRows = [
    { label: '顔', value: face },
    { label: 'ポーズ', value: pose },
    { label: '体型', value: bodyType },
    { label: '肌色', value: skinTone },
    { label: '年齢層', value: ageGroup },
  ];

  const recordProgress = (intent: Intent) => {
    const historyItem = {
      id: `model-library-history-${nextHistoryId.current++}`,
      label: `${intent}をローカル履歴に追加`,
    };

    setActiveIntent(intent);
    setUsage(intent);
    setProgress((current) => Math.min(current + 14, 96));
    setHistory((items) => [historyItem, ...items].slice(0, 4));
  };

  const selectCandidate = (candidate: ModelCandidate) => {
    setSelectedCandidateId(candidate.id);
    setActiveIntent(candidate.usage);
    setUsage(candidate.usage);
    setFace(candidate.face);
    setPose(candidate.pose);
    setBodyType(candidate.bodyType);
    setSkinTone(candidate.skinTone);
    setAgeGroup(candidate.ageGroup);
    setProductDescription(candidate.productDescription);
  };

  const handoffToCanvas = () => {
    if (!currentBrand) {
      toast.error('ブランドを読み込んでからもう一度試してください');
      return;
    }

    const note = history[0]?.label ?? 'ローカルメモなし';
    const generationSource = {
      sourceWorkspace: 'models' as const,
      workflowVersion: 'model-library-local-v1',
      sourceLabel: workspaceSourceConfig.models.label,
      sourceResumePath: workspaceSourceConfig.models.resumePath,
      sourceMode: 'local-workflow-intake' as const,
    };
    const selectedModelCandidateMetadata = {
      id: selectedCandidate.id,
      label: selectedCandidate.label,
      face,
      pose,
      bodyType,
      skinTone,
      ageGroup,
      usage,
      productDescription,
      modelMatrixBodyTypes: selectedCandidate.modelMatrixBodyTypes,
      modelMatrixAgeGroups: selectedCandidate.modelMatrixAgeGroups,
      modelMatrixSkinTone: selectedCandidate.modelMatrixSkinTone,
      modelMatrixHairStyle: selectedCandidate.modelMatrixHairStyle,
    };
    const materialReferenceMetadata = buildMaterialReferenceMetadata(materialReference);
    const materialReferenceSummary = materialReferenceMetadata.hasImage
      ? `${materialReferenceMetadata.materialKind}: ${materialReferenceMetadata.fileName ?? 'uploaded'} / ${materialReferenceMetadata.activeLayer} / ${materialReferenceMetadata.placement} / ${materialReferenceMetadata.scale}%`
      : '素材を追加するとここに反映されます';
    const generationPrompt = [
      `Face: ${face}`,
      `Pose: ${pose}`,
      `Body type: ${bodyType}`,
      `Skin tone: ${skinTone}`,
      `Age group: ${ageGroup}`,
      `Usage: ${usage}`,
      `Product description: ${productDescription}`,
      `Material reference: ${materialReferenceSummary}`,
    ].join('\n');
    const prompt = [
      `Primary input: ${primaryInput}`,
      `Face: ${face}`,
      `Pose: ${pose}`,
      `Body type: ${bodyType}`,
      `Skin tone: ${skinTone}`,
      `Age group: ${ageGroup}`,
      `Usage: ${usage}`,
      `Product description: ${productDescription}`,
      `Material reference: ${materialReferenceSummary}`,
      `Next step: ${nextStep}`,
    ].join('\n');
    const { projectId } = handoffWorkspaceToCanvas({
      brandId: currentBrand.id,
      featureType: 'model-library-workspace',
      projectName: `モデルライブラリ: ${usage}`,
      title: `モデルライブラリ: ${usage}`,
      prompt,
      imageUrl: materialReference.imageUrl || previewImageUrl,
      summary: `${usage}の進捗 ${progress}%`,
      note,
      activeChoice: usage,
      progress,
      history: history.map((item) => item.label),
      workflow: {
        workflowVersion: 'model-library-local-v1',
        inputs: {
          face,
          pose,
          bodyType,
          skinTone,
          ageGroup,
          usage,
          productDescription,
          modelMatrixBodyTypes: selectedCandidate.modelMatrixBodyTypes,
          modelMatrixAgeGroups: selectedCandidate.modelMatrixAgeGroups,
          modelMatrixSkinTone: selectedCandidate.modelMatrixSkinTone,
          modelMatrixHairStyle: selectedCandidate.modelMatrixHairStyle,
          selectedModelCandidate: selectedModelCandidateMetadata,
          materialReference: materialReferenceMetadata,
        },
        plan: {
          modelLibrary: 'model-library-workspace',
          selectedModelCandidate: selectedModelCandidateMetadata,
          materialReference: materialReferenceMetadata,
          preview: {
            previewKind: 'deterministic-svg',
            marker: 'selected-model-candidate',
            imageUrl: previewImageUrl,
          },
          nextStep,
          searchTokens: ['model-library-workspace', usage, selectedCandidate.label],
        },
        status: 'planned',
        resumePath: '/models',
        handoffKind: 'local-workflow-intake',
        primaryInput,
        nextStep,
        generationIntent: {
          feature: 'model-matrix',
          prompt: generationPrompt,
          href: buildGenerationIntentHref({
            feature: 'model-matrix',
            prompt: generationPrompt,
            bodyTypes: selectedCandidate.modelMatrixBodyTypes,
            ageGroups: selectedCandidate.modelMatrixAgeGroups,
            skinTone: selectedCandidate.modelMatrixSkinTone,
            hairStyle: selectedCandidate.modelMatrixHairStyle,
            modelCandidateLabel: selectedCandidate.label,
            ...generationSource,
          }),
          label: 'モデルマトリクスで生成',
          bodyTypes: selectedCandidate.modelMatrixBodyTypes,
          ageGroups: selectedCandidate.modelMatrixAgeGroups,
          skinTone: selectedCandidate.modelMatrixSkinTone,
          hairStyle: selectedCandidate.modelMatrixHairStyle,
          modelCandidateLabel: selectedCandidate.label,
          materialReferences: [materialReferenceMetadata],
          layerPlan: {
            activeLayer: materialReference.activeLayer,
            placement: materialReference.placement,
            scale: materialReference.scale,
          },
          maskPlan: {
            maskMode: materialReference.maskMode,
          },
          compositionPreview: {
            selectedModelCandidate: selectedCandidate.id,
            hasUploadedMaterial: Boolean(materialReference.imageUrl),
          },
          ...generationSource,
        },
      },
      previewMetadata: {
        selectedModelCandidate: selectedModelCandidateMetadata,
        previewKind: 'deterministic-svg',
        marker: 'selected-model-candidate',
        imageUrl: previewImageUrl,
        materialReference: materialReferenceMetadata,
      },
      selectedModelCandidate: selectedModelCandidateMetadata,
      materialReferences: [materialReferenceMetadata],
      layerPlan: {
        activeLayer: materialReference.activeLayer,
        placement: materialReference.placement,
        scale: materialReference.scale,
      },
      maskPlan: {
        maskMode: materialReference.maskMode,
      },
      compositionPreview: {
        selectedModelCandidate: selectedCandidate.id,
        previewKind: materialReference.imageUrl ? 'uploaded-material-reference' : 'deterministic-svg',
        imageUrl: materialReference.imageUrl || previewImageUrl,
      },
      metadata: {
        workspace: 'models',
        searchTokens: ['model-library-workspace', 'model-matrix', usage],
        sourceLabel: generationSource.sourceLabel,
        sourceResumePath: generationSource.sourceResumePath,
        selectedModelCandidate: selectedModelCandidateMetadata,
        materialReference: materialReferenceMetadata,
      },
    });

    toast.success('モデルライブラリをGallery/Historyに保存し、Canvasへ渡しました');
    navigate(`/canvas/${projectId}`);
  };

  return (
    <div className="space-y-6 text-white">
      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-soft sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
              LIGHTCHAIN / MODELS
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold text-white">
              モデルライブラリ
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-300">
              用途、モデル候補、出力先を選んでモデルマトリクスへ渡します。
            </p>
          </div>
          <button
            type="button"
            onClick={handoffToCanvas}
            disabled={!currentBrand}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Canvasへ保存
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 grid gap-3 lg:grid-cols-3">
          {intents.map((intent) => (
            <button
              key={intent}
              type="button"
              onClick={() => recordProgress(intent)}
              className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                activeIntent === intent
                  ? 'border-cyan-300 bg-cyan-300 text-neutral-950'
                  : 'border-white/10 bg-white/[0.04] text-neutral-200 hover:border-cyan-300/50 hover:bg-white/[0.07]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                {intentMeta[intent].label}
              </span>
              <span className="mt-2 block text-xs font-normal leading-5 opacity-75">
                {intentMeta[intent].description}
              </span>
              <span className="mt-3 flex flex-wrap gap-1.5">
                {intentMeta[intent].outputs.map((output) => (
                  <span key={output} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-neutral-200">
                    {output}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section
        data-testid="model-library-action-panel"
        className="rounded-[28px] border border-cyan-300/25 bg-cyan-300/[0.08] p-5 shadow-soft"
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300 dark:text-cyan-300">
              Production flow
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              まず候補を選び、必要なら参照素材を置いて、モデルマトリクスへ送る
            </h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                { label: '候補', value: selectedCandidate.label },
                { label: '用途', value: usage },
                { label: '素材', value: materialReference.imageUrl ? '参照あり' : '参照なしでも開始可' },
              ].map((item) => (
                <div
                  key={item.label}
                  data-testid="model-library-readiness-item"
                  className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm"
                >
                  <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{item.label}</p>
                  <p className="mt-1 font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
          <div data-testid="model-library-next-actions" className="grid gap-2">
            <Link
              to={directModelMatrixHref}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-300 bg-cyan-300 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200"
            >
              <Sparkles className="h-4 w-4" />
              モデルマトリクスで生成
              <ChevronRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={handoffToCanvas}
              disabled={!currentBrand}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Canvasへ保存して重ねる
            </button>
            <Link
              to="/gallery"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:border-cyan-300/40 hover:bg-white/[0.07] hover:text-white"
            >
              Galleryで結果を見る
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-soft">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">モデル候補を選ぶ</h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    用途に合う候補を選ぶだけで、顔・ポーズ・体型・肌色・年齢層がそろいます。
                  </p>
                </div>
                <div className="hidden rounded-full bg-cyan-300/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-300/30 sm:block">
                  {activeIntentMeta.label}
                </div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {modelCandidates.map((candidate) => {
                  const selected = candidate.id === selectedCandidate.id;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectCandidate(candidate)}
                      className={`rounded-xl border p-4 text-left text-sm transition ${
                        selected
                          ? 'border-cyan-300 bg-cyan-300 text-neutral-950'
                          : 'border-white/10 bg-white/[0.04] text-neutral-200 hover:border-cyan-300/50 hover:bg-white/[0.07]'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-3 font-semibold">
                        {candidate.label}
                        {selected && <Check className="h-4 w-4" aria-hidden="true" />}
                      </span>
                      <span className="mt-3 flex flex-wrap gap-1.5">
                        {[candidate.ageGroup, candidate.skinTone, candidate.usage].map((item) => (
                          <span key={item} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-neutral-200">
                            {item}
                          </span>
                        ))}
                      </span>
                      <span className="mt-3 block text-xs leading-5 opacity-80">{candidate.pose}</span>
                      <span className="mt-2 block text-xs leading-5 opacity-80">{candidate.bodyType}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

	          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-soft">
	            <div className="flex items-center gap-2">
	              <SlidersHorizontal className="h-5 w-5 text-cyan-300" />
	              <h2 className="text-lg font-semibold text-white">細部を調整</h2>
	            </div>
	            <div className="mt-4">
	              <MaterialWorkbench
	                title="モデル参照素材"
	                description="顔、ポーズ、商品写真をアップロードし、どのレイヤーへ効かせるかを先に決めます。"
	                uploadLabel="顔・ポーズ・商品参照をアップロード"
	                emptyLabel="参照画像を置くとCanvasにモデル条件の実素材として残ります"
	                state={materialReference}
	                onChange={setMaterialReference}
	                materialKinds={['モデル参照', '顔参照', 'ポーズ参照', '商品写真', '背景参照']}
	                layerOptions={['顔', 'ポーズ', '体型', '衣服', '背景']}
	                placementOptions={['正面', '斜め45度', '全身', '上半身', '商品横']}
	              />
	            </div>
	            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold text-white">
                顔
                <textarea value={face} onChange={(event) => setFace(event.target.value)} rows={2} className={fieldClass} />
              </label>
              <label className="text-sm font-semibold text-white">
                ポーズ
                <textarea value={pose} onChange={(event) => setPose(event.target.value)} rows={2} className={fieldClass} />
              </label>
              <label className="text-sm font-semibold text-white">
                体型
                <textarea value={bodyType} onChange={(event) => setBodyType(event.target.value)} rows={2} className={fieldClass} />
              </label>
              <label className="text-sm font-semibold text-white">
                商品説明
                <textarea value={productDescription} onChange={(event) => setProductDescription(event.target.value)} rows={2} className={fieldClass} />
              </label>
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <figure className="rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-soft">
            <img
              src={previewImageUrl}
              alt="Model library candidate preview"
              className="aspect-[3/2] w-full rounded-xl border border-white/10 bg-white object-cover"
            />
            <figcaption className="mt-3 flex items-center gap-2 text-sm font-semibold text-white">
              <UserRound className="h-4 w-4 text-cyan-300" />
              {selectedCandidate.label}
            </figcaption>
            <p className="mt-1 text-sm text-neutral-400">
              {usage}向けモデル候補をCanvasとモデルマトリクスへ渡します。
            </p>
          </figure>

          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-soft">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Shirt className="h-5 w-5 text-cyan-300" />
              条件プレビュー
            </h2>
            <div className="mt-4 space-y-3">
              {selectedProfileRows.map((row) => (
                <div key={row.label} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-xs font-semibold text-neutral-400">{row.label}</p>
                  <p className="mt-1 text-sm leading-5 text-neutral-200">{row.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedCandidate.modelMatrixBodyTypes.map((item) => (
                <span key={item} className="rounded-full bg-cyan-300/15 px-2.5 py-1 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-300/30">
                  {item}
                </span>
              ))}
              {selectedCandidate.modelMatrixAgeGroups.map((item) => (
                <span key={item} className="rounded-full bg-cyan-300/15 px-2.5 py-1 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-300/30">
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-white">保存状態</h2>
            <p className="mt-2 text-sm text-neutral-400">{activeIntent} / {progress}%</p>
            <div className="mt-4 h-2 rounded-full bg-white/10">
              <div className="h-full rounded-full bg-cyan-300" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-4 space-y-2">
              {history.map((item) => (
                <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-neutral-200">
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
