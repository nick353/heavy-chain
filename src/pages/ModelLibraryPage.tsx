import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, ChevronRight, Save } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { buildGenerationIntentHref, handoffWorkspaceToCanvas, workspaceSourceConfig } from '../lib/workspaceHandoff';

const intents = ['EC標準', 'LOOK確認', '広告検証'] as const;
const fieldClass = 'mt-2 w-full rounded-xl border border-neutral-200 bg-white/75 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-white/10 dark:bg-surface-900/70 dark:text-white dark:focus:border-primary-500';

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
    productDescription: 'Heavy Chain シアージャケット、軽い透け感、ミニマルなEC商品画像',
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
    productDescription: 'Heavy Chain ロングトレンチ、都市的なストリートLOOK、SNS転用しやすい着用画像',
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
    productDescription: 'Heavy Chain プレミアムニット、素材感と購買信頼を強調する広告検証画像',
    accent: '#7c3aed',
    modelMatrixBodyTypes: ['regular'],
    modelMatrixAgeGroups: ['40s'],
    modelMatrixSkinTone: 'dark',
    modelMatrixHairStyle: 'long',
  },
];

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
  const nextHistoryId = useRef(3);
  const selectedCandidate = modelCandidates.find((candidate) => candidate.id === selectedCandidateId) ?? modelCandidates[0];
  const primaryInput = `${face} / ${pose} / ${bodyType} / ${skinTone} / ${ageGroup} / ${usage} / ${productDescription}`;
  const nextStep = `${usage}向けモデル候補 ${selectedCandidate.label} をmodel-library-workspaceとしてモデルマトリクスへ渡す`;
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

  const recordProgress = (intent: Intent) => {
    const historyItem = {
      id: `model-library-history-${nextHistoryId.current++}`,
      label: `${intent}をローカル履歴に追加`,
    };

    setActiveIntent(intent);
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
    const generationPrompt = [
      `Face: ${face}`,
      `Pose: ${pose}`,
      `Body type: ${bodyType}`,
      `Skin tone: ${skinTone}`,
      `Age group: ${ageGroup}`,
      `Usage: ${usage}`,
      `Product description: ${productDescription}`,
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
      `Next step: ${nextStep}`,
    ].join('\n');
    const { projectId } = handoffWorkspaceToCanvas({
      brandId: currentBrand.id,
      featureType: 'model-library-workspace',
      projectName: `モデルライブラリ: ${usage}`,
      title: `モデルライブラリ: ${usage}`,
      prompt,
      imageUrl: previewImageUrl,
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
        },
        plan: {
          modelLibrary: 'model-library-workspace',
          selectedModelCandidate: selectedModelCandidateMetadata,
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
          ...generationSource,
        },
      },
      previewMetadata: {
        selectedModelCandidate: selectedModelCandidateMetadata,
        previewKind: 'deterministic-svg',
        marker: 'selected-model-candidate',
        imageUrl: previewImageUrl,
      },
      selectedModelCandidate: selectedModelCandidateMetadata,
      metadata: {
        workspace: 'models',
        searchTokens: ['model-library-workspace', 'model-matrix', usage],
        sourceLabel: generationSource.sourceLabel,
        sourceResumePath: generationSource.sourceResumePath,
        selectedModelCandidate: selectedModelCandidateMetadata,
      },
    });

    toast.success('モデルライブラリをGallery/Historyに保存し、Canvasへ渡しました');
    navigate(`/canvas/${projectId}`);
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
              モデルライブラリ
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              顔、ポーズ、体型、肌色、年齢層、利用目的を固定候補から選び、モデルマトリクス生成へ渡すローカルワークスペースです。
            </p>
          </div>
          <button
            type="button"
            onClick={handoffToCanvas}
            disabled={!currentBrand}
            className="btn-secondary inline-flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            保存してCanvasへ
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {intents.map((intent) => (
            <button
              key={intent}
              type="button"
              onClick={() => recordProgress(intent)}
              className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                activeIntent === intent
                  ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                  : 'border-white/60 bg-white/55 text-neutral-700 hover:bg-white dark:border-white/10 dark:bg-surface-900/50 dark:text-neutral-300'
              }`}
            >
              {intent}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">固定モデル候補</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
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
                          ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                          : 'border-white/60 bg-white/55 text-neutral-700 hover:bg-white dark:border-white/10 dark:bg-surface-900/50 dark:text-neutral-300'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-3 font-semibold">
                        {candidate.label}
                        {selected && <Check className="h-4 w-4" aria-hidden="true" />}
                      </span>
                      <span className="mt-3 block text-xs leading-5 opacity-80">{candidate.face}</span>
                      <span className="mt-2 block text-xs leading-5 opacity-80">{candidate.pose}</span>
                      <span className="mt-2 block text-xs leading-5 opacity-80">{candidate.bodyType}</span>
                      <span className="mt-3 inline-flex rounded-full bg-white/70 px-2 py-1 text-xs font-semibold text-neutral-700 dark:bg-surface-900/70 dark:text-neutral-200">
                        {candidate.skinTone} / {candidate.ageGroup} / {candidate.usage}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <figure>
              <img
                src={previewImageUrl}
                alt="Model library candidate preview"
                className="aspect-[3/2] w-full rounded-xl border border-neutral-200 bg-white object-cover dark:border-white/10 dark:bg-surface-900"
              />
              <figcaption className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                選択候補をモデルマトリクスへ渡すためのローカルプレビューです。
              </figcaption>
            </figure>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">生成前インテーク</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              顔
              <textarea value={face} onChange={(event) => setFace(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              ポーズ
              <textarea value={pose} onChange={(event) => setPose(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              体型
              <textarea value={bodyType} onChange={(event) => setBodyType(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              肌色
              <input value={skinTone} onChange={(event) => setSkinTone(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              年齢層
              <input value={ageGroup} onChange={(event) => setAgeGroup(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              利用目的
              <input value={usage} onChange={(event) => setUsage(event.target.value as Intent)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white md:col-span-2">
              商品説明
              <textarea value={productDescription} onChange={(event) => setProductDescription(event.target.value)} rows={3} className={fieldClass} />
            </label>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">ローカル進捗</h2>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{activeIntent} / {progress}%</p>
          <div className="mt-4 h-2 rounded-full bg-surface-200 dark:bg-surface-800">
            <div className="h-full rounded-full bg-primary-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">履歴</h2>
          <div className="mt-4 space-y-3">
            {history.map((item) => (
              <div key={item.id} className="rounded-xl bg-white/60 p-3 text-sm text-neutral-700 dark:bg-surface-900/50 dark:text-neutral-300">
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
