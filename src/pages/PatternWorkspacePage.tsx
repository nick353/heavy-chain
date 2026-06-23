import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, ChevronRight, ImagePlus, Palette, Repeat2, Save, Shapes, Shirt, Upload, WandSparkles } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import type { PatternGenerationContext, PatternPreviewContext } from '../lib/workspaceHandoff';
import { buildGenerationIntentHref, handoffWorkspaceToCanvas, workspaceSourceConfig } from '../lib/workspaceHandoff';

const modes = ['グラフィック', '総柄', 'ベクター化'] as const;

type Mode = (typeof modes)[number];
type PatternPreviewCandidate = {
  id: string;
  label: string;
  mode: Mode;
  repeatSignature: string;
  vectorSignature: string;
  paletteSignature: string;
  imageUrl: string;
};
type HistoryItem = {
  id: string;
  label: string;
};

const initialHistory: HistoryItem[] = [
  { id: 'pattern-history-1', label: 'ブランドモチーフ案を整理' },
  { id: 'pattern-history-2', label: '総柄リピート条件を保存' },
];

const motifPresets = [
  {
    label: '鎖モチーフ',
    value: 'Heavy Chainの鎖モチーフ、細い線画、Tシャツ胸元向けの静かなグラフィック',
  },
  {
    label: 'ロゴ中心',
    value: 'Heavy Chainロゴを中心にした単色エンブレム、刺繍とシルクスクリーン向け',
  },
  {
    label: '和柄ミックス',
    value: '鎖、波、格子を組み合わせた和柄ミックス、アパレル総柄向け',
  },
];

const repeatPresets = [
  {
    label: '余白あり',
    value: 'ハーフドロップ、余白多め、遠目でうるさくならない密度',
  },
  {
    label: '全面総柄',
    value: 'シームレスリピート、全面配置、EC画像でも柄が読みやすい密度',
  },
  {
    label: 'ワンポイント',
    value: '単体ロックアップ、胸元と背面に展開しやすい中央配置',
  },
];

const targetPresets = [
  {
    label: 'Tシャツ',
    value: 'ブラックのヘビーウェイトTシャツ / 胸元ワンポイントと背面総柄',
  },
  {
    label: 'パーカー',
    value: 'オーバーサイズパーカー / 胸元刺繍と袖のリピート柄',
  },
  {
    label: '小物',
    value: 'キャップ、バッグ、ステッカーに展開できる小さなロゴ配置',
  },
];

const palettePresets = [
  {
    label: '黒赤',
    value: '墨黒、オフホワイト、くすんだシルバー、差し色に深い赤',
  },
  {
    label: '藍白',
    value: '濃藍、生成り、淡いグレー、細い線だけに銀色',
  },
  {
    label: '単色',
    value: 'ブラック1色、刺繍と箔押しに転用しやすい高コントラスト',
  },
];

const vectorPresets = [
  {
    label: '2色版下',
    value: '刺繍とシルクスクリーンに使える2色ベクターへ整理',
  },
  {
    label: 'パス整理',
    value: '角丸パス、線幅統一、カットラインを分けたベクターへ整理',
  },
  {
    label: '総柄タイル',
    value: 'リピート境界がつながるタイルと、単体モチーフを分けて整理',
  },
];

const referenceSlots = [
  { label: 'ロゴ', value: 'chain_mark_ref.svg' },
  { label: '柄参考', value: 'vintage_bandana_grid.png' },
  { label: '服モック', value: 'tee_mockup_front.jpg' },
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

const buildPatternPreviewSvg = ({
  id,
  label,
  mode,
  motifPrompt,
  repeatStyle,
  garmentTarget,
  paletteNotes,
  vectorIntent,
}: {
  id: string;
  label: string;
  mode: Mode;
  motifPrompt: string;
  repeatStyle: string;
  garmentTarget: string;
  paletteNotes: string;
  vectorIntent: string;
}) => {
  const safeLabel = escapeSvgText(label);
  const safeMode = escapeSvgText(mode);
  const safeMotif = escapeSvgText(motifPrompt.slice(0, 64));
  const safeRepeat = escapeSvgText(repeatStyle.slice(0, 58));
  const safeGarment = escapeSvgText(garmentTarget.slice(0, 58));
  const safePalette = escapeSvgText(paletteNotes.slice(0, 58));
  const safeVector = escapeSvgText(vectorIntent.slice(0, 58));
  const safePrimaryInput = escapeSvgText(`${motifPrompt} / ${garmentTarget}`.slice(0, 74));
  const safeNextStep = escapeSvgText(`${repeatStyle}をpattern-design-briefとして、${vectorIntent}へ進める`.slice(0, 74));
  const isGraphic = id === 'graphic-emblem';
  const isRepeat = id === 'bandana-grid';
  const accent = isGraphic ? '#ef4444' : isRepeat ? '#2563eb' : '#111827';
  const secondary = isGraphic ? '#111827' : isRepeat ? '#f8fafc' : '#f59e0b';
  const patternId = `${id}-tile`;

  return encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640" data-pattern-preview="${id}">
      <defs>
        <pattern id="${patternId}" width="${isRepeat ? 112 : 160}" height="${isRepeat ? 112 : 160}" patternUnits="userSpaceOnUse">
          <rect width="180" height="180" fill="${isRepeat ? '#171717' : '#fbfbfb'}"/>
          ${
            isRepeat
              ? `<path d="M0 56H112M56 0V112M18 18l76 76M94 18L18 94" stroke="#f8fafc" stroke-width="3" opacity=".72"/>
                 <circle cx="56" cy="56" r="18" fill="none" stroke="${accent}" stroke-width="5"/>
                 <circle cx="0" cy="0" r="11" fill="${accent}"/><circle cx="112" cy="112" r="11" fill="${accent}"/>`
              : isGraphic
                ? `<circle cx="80" cy="80" r="42" fill="none" stroke="${accent}" stroke-width="7"/>
                   <path d="M40 84c26-28 54-28 80 0M40 104c26-28 54-28 80 0" fill="none" stroke="${secondary}" stroke-width="10" stroke-linecap="round"/>`
                : `<path d="M30 118 C70 34 110 34 150 118" fill="none" stroke="#111827" stroke-width="9" stroke-linecap="round"/>
                   <path d="M50 118 L80 52 L110 118 M70 86 H96" fill="none" stroke="${secondary}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
                   <circle cx="80" cy="80" r="50" fill="none" stroke="#111827" stroke-width="3" stroke-dasharray="10 10"/>`
          }
        </pattern>
      </defs>
      <rect width="960" height="640" rx="36" fill="#f7f7f5"/>
      <rect x="54" y="54" width="852" height="532" rx="30" fill="#ffffff" stroke="#e5e5e5"/>
      <rect x="92" y="98" width="420" height="420" rx="24" fill="url(#${patternId})" stroke="#d4d4d4"/>
      <rect x="138" y="144" width="328" height="328" rx="${isGraphic ? 164 : 22}" fill="none" stroke="${accent}" stroke-width="${isRepeat ? 2 : 6}" opacity=".9"/>
      ${
        isRepeat
          ? `<path d="M170 190h264M170 256h264M170 322h264M170 388h264" stroke="#ffffff" stroke-width="6" opacity=".72"/>
             <path d="M204 158v296M270 158v296M336 158v296M402 158v296" stroke="${accent}" stroke-width="4" opacity=".86"/>`
          : isGraphic
            ? `<path d="M208 312c64-70 128-70 192 0M208 360c64-70 128-70 192 0" fill="none" stroke="#111827" stroke-width="24" stroke-linecap="round"/>
               <text x="304" y="236" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800" fill="${accent}">HC</text>`
            : `<path d="M214 406 C258 202 350 202 394 406" fill="none" stroke="#111827" stroke-width="18" stroke-linecap="round"/>
               <path d="M256 404 L304 236 L352 404 M282 330 H330" fill="none" stroke="${secondary}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`
      }
      <text x="560" y="140" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="${accent}">${safeMode}</text>
      <text x="560" y="190" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="800" fill="#171717">${safeLabel}</text>
      <text x="560" y="252" font-family="Inter, Arial, sans-serif" font-size="20" fill="#525252">motif: ${safeMotif}</text>
      <text x="560" y="296" font-family="Inter, Arial, sans-serif" font-size="20" fill="#525252">repeat: ${safeRepeat}</text>
      <text x="560" y="340" font-family="Inter, Arial, sans-serif" font-size="20" fill="#525252">target: ${safeGarment}</text>
      <text x="560" y="384" font-family="Inter, Arial, sans-serif" font-size="20" fill="#525252">palette: ${safePalette}</text>
      <text x="560" y="428" font-family="Inter, Arial, sans-serif" font-size="20" fill="#525252">vector: ${safeVector}</text>
      <text x="560" y="474" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#171717">Primary input</text>
      <text x="560" y="500" font-family="Inter, Arial, sans-serif" font-size="16" fill="#525252">${safePrimaryInput}</text>
      <text x="560" y="530" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#171717">Next step</text>
      <text x="560" y="556" font-family="Inter, Arial, sans-serif" font-size="16" fill="#525252">${safeNextStep}</text>
      <text x="92" y="552" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#171717">selected-pattern-preview:${id}</text>
      <text x="92" y="580" font-family="Inter, Arial, sans-serif" font-size="16" fill="#737373">repeatSignature:${isRepeat ? 'half-drop-bandana-grid' : isGraphic ? 'single-emblem-lockup' : 'vector-path-caps'}</text>
    </svg>
  `);
};

export function PatternWorkspacePage() {
  const navigate = useNavigate();
  const { currentBrand } = useAuthStore();
  const [activeMode, setActiveMode] = useState<Mode>(modes[0]);
  const [selectedPreviewId, setSelectedPreviewId] = useState('graphic-emblem');
  const [progress, setProgress] = useState(32);
  const [history, setHistory] = useState(initialHistory);
  const [motifPrompt, setMotifPrompt] = useState('Heavy Chainの鎖モチーフ、細い線画、Tシャツ胸元向けの静かなグラフィック');
  const [repeatStyle, setRepeatStyle] = useState('ハーフドロップ、余白多め、遠目でうるさくならない密度');
  const [garmentTarget, setGarmentTarget] = useState('ブラックのヘビーウェイトTシャツ / 胸元ワンポイントと背面総柄');
  const [paletteNotes, setPaletteNotes] = useState('墨黒、オフホワイト、くすんだシルバー、差し色に深い赤');
  const [vectorIntent, setVectorIntent] = useState('刺繍とシルクスクリーンに使える2色ベクターへ整理');
  const [referenceAssets, setReferenceAssets] = useState('chain_mark_ref.svg, vintage_bandana_grid.png, tee_mockup_front.jpg');
  const nextHistoryId = useRef(3);
  const previewCandidates = useMemo<PatternPreviewCandidate[]>(() => {
    const candidates = [
      {
        id: 'graphic-emblem',
        label: 'Emblem Lockup',
        mode: 'グラフィック' as const,
        repeatSignature: 'single-emblem-lockup',
        vectorSignature: 'two-color-screenprint-lines',
        paletteSignature: 'black-ivory-red-accent',
      },
      {
        id: 'bandana-grid',
        label: 'Bandana Grid',
        mode: '総柄' as const,
        repeatSignature: 'half-drop-bandana-grid',
        vectorSignature: 'repeat-tile-vector-cleanup',
        paletteSignature: 'black-ivory-blue-grid',
      },
      {
        id: 'vector-path-caps',
        label: 'Vector Path Caps',
        mode: 'ベクター化' as const,
        repeatSignature: 'isolated-vector-mark',
        vectorSignature: 'rounded-path-caps-two-color',
        paletteSignature: 'charcoal-silver-amber',
      },
    ];

    return candidates.map((candidate) => ({
      ...candidate,
      imageUrl: buildPatternPreviewSvg({
        id: candidate.id,
        label: candidate.label,
        mode: candidate.mode,
        motifPrompt,
        repeatStyle,
        garmentTarget,
        paletteNotes,
        vectorIntent,
      }),
    }));
  }, [garmentTarget, motifPrompt, paletteNotes, repeatStyle, vectorIntent]);
  const selectedPreview = previewCandidates.find((candidate) => candidate.id === selectedPreviewId) ?? previewCandidates[0];

  const recordProgress = (mode: Mode) => {
    const historyItem = {
      id: `pattern-history-${nextHistoryId.current++}`,
      label: `${mode}をローカル履歴に追加`,
    };

    setActiveMode(mode);
    const nextPreview = previewCandidates.find((candidate) => candidate.mode === mode);
    if (nextPreview) setSelectedPreviewId(nextPreview.id);
    setProgress((current) => Math.min(current + 14, 96));
    setHistory((items) => [historyItem, ...items].slice(0, 4));
  };

  const toggleReferenceAsset = (asset: string) => {
    const currentAssets = referenceAssets
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const nextAssets = currentAssets.includes(asset)
      ? currentAssets.filter((item) => item !== asset)
      : [...currentAssets, asset];
    setReferenceAssets(nextAssets.join(', '));
  };

  const handoffToCanvas = () => {
    if (!currentBrand) {
      toast.error('ブランドを読み込んでからもう一度試してください');
      return;
    }

    const note = history[0]?.label ?? 'ローカルメモなし';
    const primaryInput = `${motifPrompt} / ${garmentTarget}`;
    const nextStep = `${repeatStyle}をpattern-design-briefとして、${vectorIntent}へ進める`;
    const generationSource = {
      sourceWorkspace: 'patterns' as const,
      workflowVersion: 'pattern-preview-local-v1',
      sourceLabel: workspaceSourceConfig.patterns.label,
      sourceResumePath: workspaceSourceConfig.patterns.resumePath,
      sourceMode: 'local-workflow-intake' as const,
    };
    const selectedPatternPreview: PatternPreviewContext = {
      id: selectedPreview.id,
      label: selectedPreview.label,
      mode: selectedPreview.mode,
      repeatSignature: selectedPreview.repeatSignature,
      vectorSignature: selectedPreview.vectorSignature,
      paletteSignature: selectedPreview.paletteSignature,
    };
    const patternContext: PatternGenerationContext = {
      selectedPatternPreview,
      motifPrompt,
      repeatStyle,
      garmentTarget,
      paletteNotes,
      vectorIntent,
      referenceAssets,
    };
    const generationPrompt = [
      motifPrompt,
      `Repeat style: ${repeatStyle}`,
      `Garment target: ${garmentTarget}`,
      `Palette: ${paletteNotes}`,
      `Vector intent: ${vectorIntent}`,
      `Reference assets: ${referenceAssets}`,
    ].join('\n');
    const prompt = [
      `Primary input: ${primaryInput}`,
      `Motif prompt: ${motifPrompt}`,
      `Repeat style: ${repeatStyle}`,
      `Garment target: ${garmentTarget}`,
      `Palette notes: ${paletteNotes}`,
      `Vector intent: ${vectorIntent}`,
      `Reference assets: ${referenceAssets}`,
      `Next step: ${nextStep}`,
    ].join('\n');
    const { projectId } = handoffWorkspaceToCanvas({
      brandId: currentBrand.id,
      featureType: 'graphic-pattern-workspace',
      projectName: `柄・グラフィック: ${activeMode}`,
      title: `柄・グラフィック: ${activeMode}`,
      prompt,
      imageUrl: selectedPreview.imageUrl,
      summary: `${activeMode}の進捗 ${progress}%`,
      note,
      activeChoice: activeMode,
      progress,
      history: history.map((item) => item.label),
      workflow: {
        workflowVersion: 'pattern-preview-local-v1',
        inputs: {
          motifPrompt,
          repeatStyle,
          garmentTarget,
          paletteNotes,
          vectorIntent,
          referenceAssets,
        },
        plan: {
          patternBrief: 'pattern-design-brief',
          repeatStyle,
          vectorIntent,
          selectedPatternPreview: {
            id: selectedPreview.id,
            label: selectedPreview.label,
            mode: selectedPreview.mode,
            repeatSignature: selectedPreview.repeatSignature,
            vectorSignature: selectedPreview.vectorSignature,
            paletteSignature: selectedPreview.paletteSignature,
          },
          nextStep,
          searchTokens: ['pattern-design-brief', activeMode, garmentTarget],
        },
        status: 'planned',
        resumePath: '/patterns',
        handoffKind: 'local-workflow-intake',
        primaryInput,
        nextStep,
        generationIntent: {
          feature: 'design-gacha',
          prompt: generationPrompt,
          href: buildGenerationIntentHref({
            feature: 'design-gacha',
            prompt: generationPrompt,
            patternContext,
            ...generationSource,
          }),
          label: 'デザインガチャで生成',
          ...patternContext,
          ...generationSource,
        },
      },
      previewMetadata: {
        selectedPatternPreview,
        previewKind: 'deterministic-svg',
        imageUrl: selectedPreview.imageUrl,
      },
      metadata: {
        workspace: 'patterns',
        searchTokens: ['pattern-design-brief', 'graphic-pattern-workspace', activeMode],
        selectedPatternPreview,
      },
    });

    toast.success('柄・グラフィックをGallery/Historyに保存し、Canvasへ渡しました');
    navigate(`/canvas/${projectId}`);
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
              柄・グラフィック
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              グラフィック、総柄、ベクター化のインテークを、Gallery/History と Canvas に渡せるローカルワークスペースです。
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
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => recordProgress(mode)}
              className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                activeMode === mode
                  ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                  : 'border-white/60 bg-white/55 text-neutral-700 hover:bg-white dark:border-white/10 dark:bg-surface-900/50 dark:text-neutral-300'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">制作ボード</h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Lightchainで選んでいた条件を、素材・柄・配置・色・版下の順に組み立てます。
              </p>
            </div>
            <div className="rounded-full bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-800 dark:bg-primary-950/40 dark:text-primary-100">
              {activeMode} / {selectedPreview.label}
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1.1fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-900/50">
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary-600" />
                  <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">素材スロット</h3>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {referenceSlots.map((slot) => {
                    const active = referenceAssets.includes(slot.value);
                    return (
                      <button
                        key={slot.value}
                        type="button"
                        onClick={() => toggleReferenceAsset(slot.value)}
                        className={`rounded-xl border px-3 py-3 text-left transition ${
                          active
                            ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                            : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-200 dark:border-white/10 dark:bg-surface-950/40 dark:text-neutral-300'
                        }`}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-primary-700 dark:bg-surface-800 dark:text-primary-200">
                          <ImagePlus className="h-4 w-4" />
                        </span>
                        <span className="mt-2 block text-sm font-semibold">{slot.label}</span>
                        <span className="mt-1 block text-xs text-neutral-400">{slot.value}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-900/50">
                  <div className="flex items-center gap-2">
                    <Shapes className="h-4 w-4 text-primary-600" />
                    <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">モチーフ</h3>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {motifPresets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setMotifPrompt(preset.value)}
                        className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                          motifPrompt === preset.value
                            ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-surface-800 dark:text-neutral-300'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-900/50">
                  <div className="flex items-center gap-2">
                    <Repeat2 className="h-4 w-4 text-primary-600" />
                    <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">配置</h3>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {repeatPresets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setRepeatStyle(preset.value)}
                        className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                          repeatStyle === preset.value
                            ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-surface-800 dark:text-neutral-300'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-900/50">
                  <div className="flex items-center gap-2">
                    <Shirt className="h-4 w-4 text-primary-600" />
                    <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">対象アイテム</h3>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {targetPresets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setGarmentTarget(preset.value)}
                        className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                          garmentTarget === preset.value
                            ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-surface-800 dark:text-neutral-300'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-900/50">
                  <div className="flex items-center gap-2">
                    <Palette className="h-4 w-4 text-primary-600" />
                    <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">配色</h3>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {palettePresets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setPaletteNotes(preset.value)}
                        className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                          paletteNotes === preset.value
                            ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-surface-800 dark:text-neutral-300'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-900/50">
              <div className="flex items-center gap-2">
                <WandSparkles className="h-4 w-4 text-primary-600" />
                <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">現在の制作Brief</h3>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  版下
                  <select
                    value={vectorIntent}
                    onChange={(event) => setVectorIntent(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-white/10 dark:bg-surface-950/50 dark:text-white"
                  >
                    {vectorPresets.map((preset) => (
                      <option key={preset.label} value={preset.value}>{preset.label}</option>
                    ))}
                  </select>
                </label>
                {[
                  ['モチーフ', motifPrompt],
                  ['配置', repeatStyle],
                  ['対象', garmentTarget],
                  ['配色', paletteNotes],
                  ['素材', referenceAssets],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-neutral-50 p-3 dark:bg-surface-950/50">
                    <p className="text-xs font-semibold text-neutral-400">{label}</p>
                    <p className="mt-1 text-sm leading-6 text-neutral-700 dark:text-neutral-200">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">プレビュー候補</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{selectedPreview.label} / {selectedPreview.repeatSignature}</p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {previewCandidates.map((candidate) => {
              const selected = candidate.id === selectedPreview.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => {
                    setSelectedPreviewId(candidate.id);
                    setActiveMode(candidate.mode);
                  }}
                  aria-pressed={selected}
                  className={`group rounded-xl border p-3 text-left transition ${
                    selected
                      ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100'
                      : 'border-white/60 bg-white/55 text-neutral-700 hover:bg-white dark:border-white/10 dark:bg-surface-900/50 dark:text-neutral-300'
                  }`}
                >
                  <span className="flex items-center justify-between gap-3 text-sm font-semibold">
                    {candidate.label}
                    {selected && <Check className="h-4 w-4" />}
                  </span>
                  <img
                    src={candidate.imageUrl}
                    alt={`${candidate.label} preview`}
                    className="mt-3 aspect-[3/2] w-full rounded-lg border border-black/5 object-cover dark:border-white/10"
                  />
                  <span className="mt-3 block text-xs text-neutral-500 dark:text-neutral-400">
                    {candidate.mode} / {candidate.vectorSignature}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">ローカル進捗</h2>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{activeMode} / {progress}%</p>
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
