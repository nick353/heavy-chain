import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, ChevronRight, Save } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import type { PatternGenerationContext, PatternPreviewContext } from '../lib/workspaceHandoff';
import { buildGenerationIntentHref, handoffWorkspaceToCanvas, workspaceSourceConfig } from '../lib/workspaceHandoff';

const modes = ['グラフィック', '総柄', 'ベクター化'] as const;
const fieldClass = 'mt-2 w-full rounded-xl border border-neutral-200 bg-white/75 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-white/10 dark:bg-surface-900/70 dark:text-white dark:focus:border-primary-500';

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
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">生成前インテーク</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              モチーフ
              <textarea value={motifPrompt} onChange={(event) => setMotifPrompt(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              リピート
              <textarea value={repeatStyle} onChange={(event) => setRepeatStyle(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              対象アイテム
              <textarea value={garmentTarget} onChange={(event) => setGarmentTarget(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              パレット
              <textarea value={paletteNotes} onChange={(event) => setPaletteNotes(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              ベクター化
              <textarea value={vectorIntent} onChange={(event) => setVectorIntent(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              参照素材
              <textarea value={referenceAssets} onChange={(event) => setReferenceAssets(event.target.value)} rows={3} className={fieldClass} />
            </label>
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
