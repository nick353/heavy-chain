import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, ChevronRight, Save } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { buildGenerationIntentHref, handoffWorkspaceToCanvas, workspaceSourceConfig } from '../lib/workspaceHandoff';

const choices = ['ライン企画', '素材確認', 'EC準備'];
const fieldClass = 'mt-2 w-full rounded-xl border border-neutral-200 bg-white/75 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-white/10 dark:bg-surface-900/70 dark:text-white dark:focus:border-primary-500';
const optionCardClass = 'rounded-xl border px-4 py-3 text-left text-sm transition';

type StudioOption = {
  id: string;
  label: string;
  value: string;
  supportingText: string;
};
type StudioSetup = {
  model: StudioOption;
  pose: StudioOption;
  background: StudioOption;
};
type HistoryItem = {
  id: string;
  label: string;
};

const initialHistory: HistoryItem[] = [
  { id: 'fashion-history-1', label: 'シルエット候補を整理' },
  { id: 'fashion-history-2', label: '素材メモを更新' },
];

const modelOptions: StudioOption[] = [
  {
    id: 'editorial-clean-20s',
    label: 'Clean 20s',
    value: '20代女性 / 168cm / クリーンなECモデル',
    supportingText: 'EC標準の正確な着用感',
  },
  {
    id: 'street-neutral-30s',
    label: 'Street 30s',
    value: '30代ユニセックス / 175cm / 都市的なストリートモデル',
    supportingText: 'Heavy Chain の日常着トーン',
  },
  {
    id: 'mature-premium-40s',
    label: 'Premium 40s',
    value: '40代女性 / 165cm / 落ち着いたプレミアムモデル',
    supportingText: '上質感と購買判断を重視',
  },
];

const poseOptions: StudioOption[] = [
  {
    id: 'front-pocket-natural',
    label: 'Front Pocket',
    value: '正面立ち、片手をポケット、自然な肩線',
    supportingText: '商品形状を読みやすくする',
  },
  {
    id: 'three-quarter-walk',
    label: '3/4 Walk',
    value: '斜め45度の歩き姿、裾の動き、視線はカメラ外',
    supportingText: 'SNS向けに動きを足す',
  },
  {
    id: 'seated-detail',
    label: 'Seated Detail',
    value: '腰掛け、袖と襟元を見せる、手元は軽く重ねる',
    supportingText: '素材とディテール確認向け',
  },
];

const backgroundOptions: StudioOption[] = [
  {
    id: 'white-natural-light',
    label: 'White Studio',
    value: '白背景の自然光スタジオ、薄い影',
    supportingText: 'EC商品ページの基準背景',
  },
  {
    id: 'concrete-gallery',
    label: 'Concrete Gallery',
    value: '淡いグレーのコンクリート壁、ギャラリー照明、床に柔らかい反射',
    supportingText: 'LOOKとブランド感の両立',
  },
  {
    id: 'warm-retail-corner',
    label: 'Retail Corner',
    value: '温かい店舗什器の前、木目とメタルラック、夕方の間接光',
    supportingText: '店頭展開の仮説確認',
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

const buildStudioPreviewSvg = ({
  activeChoice,
  modelProfile,
  pose,
  background,
  props,
  productLine,
  selectedStudioSetup,
}: {
  activeChoice: string;
  modelProfile: string;
  pose: string;
  background: string;
  props: string;
  productLine: string;
  selectedStudioSetup: StudioSetup;
}) => {
  const safeChoice = escapeSvgText(activeChoice);
  const safeModel = escapeSvgText(modelProfile.slice(0, 62));
  const safePose = escapeSvgText(pose.slice(0, 62));
  const safeBackground = escapeSvgText(background.slice(0, 62));
  const safeProps = escapeSvgText(props.slice(0, 62));
  const safeProduct = escapeSvgText(productLine.slice(0, 62));
  const safeModelLabel = escapeSvgText(selectedStudioSetup.model.label);
  const safePoseLabel = escapeSvgText(selectedStudioSetup.pose.label);
  const safeBackgroundLabel = escapeSvgText(selectedStudioSetup.background.label);
  const safePrimaryInput = escapeSvgText(`${productLine} / ${modelProfile}`.slice(0, 74));
  const fullNextStep = `${pose}で${background}の生成プロンプトへ進む`;
  const safeNextStep = escapeSvgText(fullNextStep.slice(0, 74));
  const safeFullNextStep = escapeSvgText(fullNextStep);
  const backgroundFill = selectedStudioSetup.background.id === 'concrete-gallery'
    ? '#d8dde0'
    : selectedStudioSetup.background.id === 'warm-retail-corner'
      ? '#ead6bd'
      : '#f8fafc';
  const accent = selectedStudioSetup.model.id === 'street-neutral-30s'
    ? '#111827'
    : selectedStudioSetup.model.id === 'mature-premium-40s'
      ? '#7c3aed'
      : '#16a34a';
  const poseTilt = selectedStudioSetup.pose.id === 'three-quarter-walk' ? 'rotate(-4 304 314)' : selectedStudioSetup.pose.id === 'seated-detail' ? 'rotate(2 304 340)' : '';

  return encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640" data-studio-preview="studio-selection-local-v1">
      <metadata>
        <studio-selection workflowVersion="studio-selection-local-v1" nextStep="${safeFullNextStep}" selectedStudioSetup="${selectedStudioSetup.model.id}/${selectedStudioSetup.pose.id}/${selectedStudioSetup.background.id}" />
      </metadata>
      <rect width="960" height="640" rx="36" fill="#f7f7f5"/>
      <rect x="54" y="54" width="852" height="532" rx="30" fill="#ffffff" stroke="#e5e5e5"/>
      <rect x="92" y="98" width="420" height="420" rx="26" fill="${backgroundFill}" stroke="#d4d4d4"/>
      <path d="M120 438h360" stroke="#a3a3a3" stroke-width="8" stroke-linecap="round" opacity=".45"/>
      <g transform="${poseTilt}">
        <circle cx="304" cy="184" r="42" fill="#f1d1b5" stroke="#262626" stroke-width="4"/>
        <path d="M270 244h68l38 154h-144z" fill="${accent}" opacity=".94"/>
        <path d="M270 252c-30 38-44 78-42 122M338 252c34 34 52 74 58 120" fill="none" stroke="#262626" stroke-width="13" stroke-linecap="round"/>
        <path d="M268 398l-24 82M340 398l26 82" fill="none" stroke="#262626" stroke-width="16" stroke-linecap="round"/>
        <path d="M252 302h104" stroke="#ffffff" stroke-width="7" opacity=".72"/>
      </g>
      <rect x="150" y="132" width="128" height="24" rx="12" fill="#ffffff" opacity=".72"/>
      <text x="560" y="138" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="${accent}">${safeChoice}</text>
      <text x="560" y="188" font-family="Inter, Arial, sans-serif" font-size="40" font-weight="800" fill="#171717">Studio setup</text>
      <text x="560" y="244" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#171717">model: ${safeModelLabel}</text>
      <text x="560" y="274" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">${safeModel}</text>
      <text x="560" y="324" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#171717">pose: ${safePoseLabel}</text>
      <text x="560" y="354" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">${safePose}</text>
      <text x="560" y="404" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#171717">background: ${safeBackgroundLabel}</text>
      <text x="560" y="434" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">${safeBackground}</text>
      <text x="560" y="484" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">product: ${safeProduct}</text>
      <text x="560" y="524" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">props: ${safeProps}</text>
      <text x="92" y="472" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#171717">Primary input</text>
      <text x="92" y="498" font-family="Inter, Arial, sans-serif" font-size="16" fill="#525252">${safePrimaryInput}</text>
      <text x="92" y="526" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#171717">Next step</text>
      <text x="92" y="552" font-family="Inter, Arial, sans-serif" font-size="16" fill="#525252">${safeNextStep}</text>
      <text x="92" y="582" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#171717">selected-studio-setup:${selectedStudioSetup.model.id}/${selectedStudioSetup.pose.id}/${selectedStudioSetup.background.id}</text>
      <text x="92" y="610" font-family="Inter, Arial, sans-serif" font-size="16" fill="#737373">workflowVersion:studio-selection-local-v1</text>
    </svg>
  `);
};

export function FashionStudioPage() {
  const navigate = useNavigate();
  const { currentBrand } = useAuthStore();
  const [activeChoice, setActiveChoice] = useState(choices[0]);
  const [progress, setProgress] = useState(35);
  const [history, setHistory] = useState(initialHistory);
  const [selectedModelId, setSelectedModelId] = useState(modelOptions[0].id);
  const [selectedPoseId, setSelectedPoseId] = useState(poseOptions[0].id);
  const [selectedBackgroundId, setSelectedBackgroundId] = useState(backgroundOptions[0].id);
  const [modelProfile, setModelProfile] = useState('20代女性 / 168cm / クリーンなECモデル');
  const [pose, setPose] = useState('正面立ち、片手をポケット、自然な肩線');
  const [background, setBackground] = useState('白背景の自然光スタジオ、薄い影');
  const [props, setProps] = useState('シルバーアクセサリー、ミニバッグ');
  const [productLine, setProductLine] = useState('Heavy Chain 2026 SS シアージャケット');
  const [referenceImage, setReferenceImage] = useState('参照画像: lookbook_ref_01.jpg / fabric_ref_02.png');
  const nextHistoryId = useRef(3);
  const selectedStudioSetup = useMemo<StudioSetup>(() => ({
    model: modelOptions.find((option) => option.id === selectedModelId) ?? modelOptions[0],
    pose: poseOptions.find((option) => option.id === selectedPoseId) ?? poseOptions[0],
    background: backgroundOptions.find((option) => option.id === selectedBackgroundId) ?? backgroundOptions[0],
  }), [selectedBackgroundId, selectedModelId, selectedPoseId]);
  const previewImageUrl = useMemo(() => buildStudioPreviewSvg({
    activeChoice,
    modelProfile,
    pose,
    background,
    props,
    productLine,
    selectedStudioSetup,
  }), [activeChoice, background, modelProfile, pose, productLine, props, selectedStudioSetup]);

  const recordProgress = (choice: string) => {
    const historyItem = {
      id: `fashion-history-${nextHistoryId.current++}`,
      label: `${choice}をローカル履歴に追加`,
    };

    setActiveChoice(choice);
    setProgress((current) => Math.min(current + 15, 95));
    setHistory((items) => [historyItem, ...items].slice(0, 4));
  };

  const selectModel = (option: StudioOption) => {
    setSelectedModelId(option.id);
    setModelProfile(option.value);
  };

  const selectPose = (option: StudioOption) => {
    setSelectedPoseId(option.id);
    setPose(option.value);
  };

  const selectBackground = (option: StudioOption) => {
    setSelectedBackgroundId(option.id);
    setBackground(option.value);
  };

  const handoffToCanvas = () => {
    if (!currentBrand) {
      toast.error('ブランドを読み込んでからもう一度試してください');
      return;
    }

    const note = history[0]?.label ?? 'ローカルメモなし';
    const primaryInput = `${productLine} / ${modelProfile}`;
    const nextStep = `${pose}で${background}の生成プロンプトへ進む`;
    const generationSource = {
      sourceWorkspace: 'studio' as const,
      workflowVersion: 'studio-selection-local-v1',
      sourceLabel: workspaceSourceConfig.studio.label,
      sourceResumePath: workspaceSourceConfig.studio.resumePath,
      sourceMode: 'local-workflow-intake' as const,
    };
    const selectedStudioSetupMetadata = {
      model: {
        id: selectedStudioSetup.model.id,
        label: selectedStudioSetup.model.label,
        value: modelProfile,
      },
      pose: {
        id: selectedStudioSetup.pose.id,
        label: selectedStudioSetup.pose.label,
        value: pose,
      },
      background: {
        id: selectedStudioSetup.background.id,
        label: selectedStudioSetup.background.label,
        value: background,
      },
    };
    const generationPrompt = [
      productLine,
      modelProfile,
      pose,
      background,
      props,
      referenceImage,
    ].join('\n');
    const prompt = [
      `Primary input: ${primaryInput}`,
      `Model: ${modelProfile}`,
      `Pose: ${pose}`,
      `Background: ${background}`,
      `Props: ${props}`,
      `Product line: ${productLine}`,
      `Reference: ${referenceImage}`,
      `Next step: ${nextStep}`,
    ].join('\n');
    const { projectId } = handoffWorkspaceToCanvas({
      brandId: currentBrand.id,
      featureType: 'fashion-studio',
      projectName: `Fashion Studio: ${activeChoice}`,
      title: `Fashion Studio: ${activeChoice}`,
      prompt,
      imageUrl: previewImageUrl,
      summary: `${activeChoice}の進捗 ${progress}%`,
      note,
      activeChoice,
      progress,
      history: history.map((item) => item.label),
      workflow: {
        workflowVersion: 'studio-selection-local-v1',
        inputs: {
          modelProfile,
          pose,
          background,
          props,
          productLine,
          referenceImage,
          selectedStudioSetup: selectedStudioSetupMetadata,
        },
        plan: {
          modelLibrary: 'studio-model-library',
          scene: background,
          selectedStudioSetup: selectedStudioSetupMetadata,
          preview: {
            previewKind: 'deterministic-svg',
            marker: 'selected-studio-setup',
            imageUrl: previewImageUrl,
          },
          nextStep,
          searchTokens: ['studio-model-library', activeChoice, productLine],
        },
        status: 'planned',
        resumePath: '/studio',
        handoffKind: 'local-workflow-intake',
        primaryInput,
        nextStep,
        generationIntent: {
          feature: 'model-matrix',
          prompt: generationPrompt,
          href: buildGenerationIntentHref({
            feature: 'model-matrix',
            prompt: generationPrompt,
            ...generationSource,
          }),
          label: 'モデルマトリクスで生成',
          ...generationSource,
        },
      },
      previewMetadata: {
        selectedStudioSetup: selectedStudioSetupMetadata,
        previewKind: 'deterministic-svg',
        marker: 'selected-studio-setup',
        imageUrl: previewImageUrl,
      },
      selectedStudioSetup: selectedStudioSetupMetadata,
      metadata: {
        workspace: 'studio',
        searchTokens: ['studio-model-library', 'fashion-studio', activeChoice],
        selectedStudioSetup: selectedStudioSetupMetadata,
      },
    });

    toast.success('Fashion StudioをGallery/Historyに保存し、Canvasへ渡しました');
    navigate(`/canvas/${projectId}`);
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
              Fashion Studio
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              商品企画の切り口と進捗メモを、Gallery/History と Canvas に渡せるスタジオワークスペースです。
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
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => recordProgress(choice)}
              className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                activeChoice === choice
                  ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                  : 'border-white/60 bg-white/55 text-neutral-700 hover:bg-white dark:border-white/10 dark:bg-surface-900/50 dark:text-neutral-300'
              }`}
            >
              {choice}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">生成前スタジオ設定</h2>
              <div className="mt-4 space-y-5">
                <div>
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">モデル候補</p>
                  <div className="mt-2 grid gap-3 md:grid-cols-3">
                    {modelOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selectedModelId === option.id}
                        onClick={() => selectModel(option)}
                        className={`${optionCardClass} ${
                          selectedModelId === option.id
                            ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                            : 'border-white/60 bg-white/55 text-neutral-700 hover:bg-white dark:border-white/10 dark:bg-surface-900/50 dark:text-neutral-300'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2 font-semibold">
                          {option.label}
                          {selectedModelId === option.id && <Check className="h-4 w-4" aria-hidden="true" />}
                        </span>
                        <span className="mt-2 block text-xs leading-5 opacity-75">{option.supportingText}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">ポーズ候補</p>
                  <div className="mt-2 grid gap-3 md:grid-cols-3">
                    {poseOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selectedPoseId === option.id}
                        onClick={() => selectPose(option)}
                        className={`${optionCardClass} ${
                          selectedPoseId === option.id
                            ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                            : 'border-white/60 bg-white/55 text-neutral-700 hover:bg-white dark:border-white/10 dark:bg-surface-900/50 dark:text-neutral-300'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2 font-semibold">
                          {option.label}
                          {selectedPoseId === option.id && <Check className="h-4 w-4" aria-hidden="true" />}
                        </span>
                        <span className="mt-2 block text-xs leading-5 opacity-75">{option.supportingText}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">背景候補</p>
                  <div className="mt-2 grid gap-3 md:grid-cols-3">
                    {backgroundOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selectedBackgroundId === option.id}
                        onClick={() => selectBackground(option)}
                        className={`${optionCardClass} ${
                          selectedBackgroundId === option.id
                            ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                            : 'border-white/60 bg-white/55 text-neutral-700 hover:bg-white dark:border-white/10 dark:bg-surface-900/50 dark:text-neutral-300'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2 font-semibold">
                          {option.label}
                          {selectedBackgroundId === option.id && <Check className="h-4 w-4" aria-hidden="true" />}
                        </span>
                        <span className="mt-2 block text-xs leading-5 opacity-75">{option.supportingText}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <figure>
              <img
                src={previewImageUrl}
                alt="Studio setup preview"
                className="aspect-[3/2] w-full rounded-xl border border-neutral-200 bg-white object-cover dark:border-white/10 dark:bg-surface-900"
              />
              <figcaption className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                選択内容をモデルマトリクスへ渡すためのローカルプレビューです。
              </figcaption>
            </figure>
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">生成前インテーク</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              モデル
              <input value={modelProfile} onChange={(event) => setModelProfile(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              ポーズ
              <input value={pose} onChange={(event) => setPose(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              背景
              <input value={background} onChange={(event) => setBackground(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              小物
              <input value={props} onChange={(event) => setProps(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              商品ライン
              <input value={productLine} onChange={(event) => setProductLine(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              参照画像
              <input value={referenceImage} onChange={(event) => setReferenceImage(event.target.value)} className={fieldClass} />
            </label>
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">ローカル進捗</h2>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{activeChoice} / {progress}%</p>
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
