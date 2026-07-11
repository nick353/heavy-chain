import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, ChevronRight, ImagePlus, Palette, Repeat2, Save, Shapes, Shirt, Upload, WandSparkles } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { MaterialWorkbench } from '../components/workspace/MaterialWorkbench';
import {
  buildMaterialReferenceMetadata,
  type MaterialReferenceState,
} from '../lib/workspaceMaterialReferences';
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

const initialMaterialReference: MaterialReferenceState = {
  imageUrl: '',
  fileName: '',
  materialKind: '柄画像',
  maskMode: 'auto',
  activeLayer: 'プリント',
  placement: '胸中央',
  scale: 54,
  note: '柄、ロゴ、服モックを見ながら配置を決める',
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

const materialReferencePlacementFromText = (repeatStyle: string, garmentTarget: string) => {
  if (garmentTarget.includes('キャップ') || garmentTarget.includes('バッグ') || garmentTarget.includes('小物')) {
    return 'small-goods-front-mark';
  }
  if (repeatStyle.includes('全面') || garmentTarget.includes('背面')) {
    return 'large-back-or-all-over-print';
  }
  if (repeatStyle.includes('ワンポイント') || garmentTarget.includes('胸元')) {
    return 'front-chest-one-point';
  }
  return 'front-balanced-print';
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
  const isHoodie = garmentTarget.includes('パーカー');
  const isAccessory = garmentTarget.includes('キャップ') || garmentTarget.includes('バッグ') || garmentTarget.includes('小物');
  const isBackPrint = garmentTarget.includes('背面') || repeatStyle.includes('全面');
  const isOnePoint = repeatStyle.includes('ワンポイント') || garmentTarget.includes('胸元');
  const isLogo = motifPrompt.includes('ロゴ');
  const isJapanesePattern = motifPrompt.includes('和柄') || motifPrompt.includes('波') || motifPrompt.includes('格子');
  const printX = isBackPrint ? 262 : isOnePoint ? 304 : 304;
  const printY = isBackPrint ? 316 : isOnePoint ? 276 : 304;
  const printW = isBackPrint ? 150 : isOnePoint ? 76 : 122;
  const printH = isBackPrint ? 178 : isOnePoint ? 54 : 116;
  const accent = isGraphic ? '#ef4444' : isRepeat ? '#2563eb' : '#111827';
  const secondary = isGraphic ? '#111827' : isRepeat ? '#f8fafc' : '#f59e0b';
  const patternId = `${id}-tile`;
  const motifMark = isLogo
    ? `<text x="304" y="308" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="900" fill="${accent}">HC</text>`
    : isJapanesePattern
      ? `<path d="M270 306c18-22 42-22 60 0s42 22 60 0" fill="none" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>
         <path d="M272 334c18-22 42-22 60 0s42 22 60 0" fill="none" stroke="${secondary}" stroke-width="6" stroke-linecap="round"/>`
      : `<path d="M260 318c28-34 60-34 88 0M260 350c28-34 60-34 88 0" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round"/>
         <circle cx="304" cy="292" r="38" fill="none" stroke="${secondary}" stroke-width="5"/>`;
  const garmentMockup = isAccessory
    ? `<path d="M194 292c16-72 204-72 220 0v34H194v-34Z" fill="#171717" stroke="#404040" stroke-width="4"/>
       <path d="M236 326h136c28 0 54 20 64 48H172c10-28 36-48 64-48Z" fill="#262626" stroke="#404040" stroke-width="4"/>
       <rect x="${printX - printW / 2}" y="${printY - printH / 2}" width="${printW}" height="${printH}" rx="14" fill="#f8fafc" stroke="${accent}" stroke-width="4"/>
       ${motifMark}`
    : isHoodie
      ? `<path d="M228 174c32-46 120-46 152 0l36 72-42 24v214H234V270l-42-24 36-72Z" fill="#171717" stroke="#404040" stroke-width="4"/>
         <path d="M260 184c20-28 68-28 88 0l-18 48h-52l-18-48Z" fill="#262626" stroke="#525252" stroke-width="4"/>
         <path d="M278 236h52" stroke="#737373" stroke-width="5" stroke-linecap="round"/>
         <rect x="${printX - printW / 2}" y="${printY - printH / 2}" width="${printW}" height="${printH}" rx="18" fill="url(#${patternId})" stroke="${accent}" stroke-width="4"/>
         ${motifMark}`
      : `<path d="M210 184l52-38h84l52 38 58 84-50 34-30-42v222H232V260l-30 42-50-34 58-84Z" fill="#171717" stroke="#404040" stroke-width="4"/>
         <path d="M262 146c12 28 72 28 84 0" fill="none" stroke="#525252" stroke-width="5"/>
         <rect x="${printX - printW / 2}" y="${printY - printH / 2}" width="${printW}" height="${printH}" rx="16" fill="url(#${patternId})" stroke="${accent}" stroke-width="4"/>
         ${motifMark}`;

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
      <text x="92" y="94" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="800" fill="#737373">GARMENT MOCKUP</text>
      <rect x="92" y="112" width="424" height="404" rx="24" fill="#f3f4f1" stroke="#d4d4d4"/>
      ${garmentMockup}
      <rect x="${printX - printW / 2}" y="${printY - printH / 2}" width="${printW}" height="${printH}" rx="12" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="9 7" opacity=".88"/>
      <path d="M500 ${printY}h36" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>
      <text x="92" y="548" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="800" fill="#171717">placement:${escapeSvgText(materialReferencePlacementFromText(repeatStyle, garmentTarget))}</text>
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
      <text x="92" y="574" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#171717">selected-pattern-preview:${id}</text>
      <text x="92" y="604" font-family="Inter, Arial, sans-serif" font-size="16" fill="#737373">repeatSignature:${isRepeat ? 'half-drop-bandana-grid' : isGraphic ? 'single-emblem-lockup' : 'vector-path-caps'}</text>
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
  const [materialReference, setMaterialReference] = useState<MaterialReferenceState>(initialMaterialReference);
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
  const primaryInput = `${motifPrompt} / ${garmentTarget}`;
  const nextStep = `${repeatStyle}をpattern-design-briefとして、${vectorIntent}へ進める`;
  const directPatternGenerationHref = buildGenerationIntentHref({
    feature: 'design-gacha',
    prompt: [
      motifPrompt,
      `Repeat style: ${repeatStyle}`,
      `Garment target: ${garmentTarget}`,
      `Palette: ${paletteNotes}`,
      `Vector intent: ${vectorIntent}`,
      `Reference assets: ${referenceAssets}`,
    ].join('\n'),
    patternContext: {
      selectedPatternPreview: {
        id: selectedPreview.id,
        label: selectedPreview.label,
        mode: selectedPreview.mode,
        repeatSignature: selectedPreview.repeatSignature,
        vectorSignature: selectedPreview.vectorSignature,
        paletteSignature: selectedPreview.paletteSignature,
      },
      motifPrompt,
      repeatStyle,
      garmentTarget,
      paletteNotes,
      vectorIntent,
      referenceAssets,
    },
    sourceWorkspace: 'patterns',
    workflowVersion: 'pattern-preview-local-v1',
    sourceLabel: workspaceSourceConfig.patterns.label,
    sourceResumePath: workspaceSourceConfig.patterns.resumePath,
    sourceMode: 'local-workflow-intake',
  });

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
    const materialReferenceMetadata = buildMaterialReferenceMetadata(materialReference);
    const materialReferenceSummary = materialReferenceMetadata.hasImage
      ? `${materialReferenceMetadata.materialKind}: ${materialReferenceMetadata.fileName ?? 'uploaded'} / ${materialReferenceMetadata.activeLayer} / ${materialReferenceMetadata.placement} / ${materialReferenceMetadata.scale}%`
      : '素材を追加するとここに反映されます';
    const generationPrompt = [
      motifPrompt,
      `Repeat style: ${repeatStyle}`,
      `Garment target: ${garmentTarget}`,
      `Palette: ${paletteNotes}`,
      `Vector intent: ${vectorIntent}`,
      `Reference assets: ${referenceAssets}`,
      `Material reference: ${materialReferenceSummary}`,
    ].join('\n');
    const prompt = [
      `Primary input: ${primaryInput}`,
      `Motif prompt: ${motifPrompt}`,
      `Repeat style: ${repeatStyle}`,
      `Garment target: ${garmentTarget}`,
      `Palette notes: ${paletteNotes}`,
      `Vector intent: ${vectorIntent}`,
      `Reference assets: ${referenceAssets}`,
      `Material reference: ${materialReferenceSummary}`,
      `Next step: ${nextStep}`,
    ].join('\n');
    const { projectId } = handoffWorkspaceToCanvas({
      brandId: currentBrand.id,
      featureType: 'graphic-pattern-workspace',
      projectName: `パターン作業台: ${activeMode}`,
      title: `パターン作業台: ${activeMode}`,
	      prompt,
	      imageUrl: materialReference.imageUrl || selectedPreview.imageUrl,
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
	          materialReference: materialReferenceMetadata,
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
	          materialReference: materialReferenceMetadata,
	          nextStep,
          searchTokens: ['pattern-design-brief', activeMode, garmentTarget],
        },
        status: 'planned',
        resumePath: '/patterns/workbench',
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
	            selectedPreviewId: selectedPreview.id,
	            hasUploadedMaterial: Boolean(materialReference.imageUrl),
	          },
	          ...generationSource,
	        },
	      },
	      previewMetadata: {
	        selectedPatternPreview,
	        previewKind: 'deterministic-svg',
	        imageUrl: selectedPreview.imageUrl,
	        materialReference: materialReferenceMetadata,
	      },
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
	        selectedPreviewId: selectedPreview.id,
	        previewKind: materialReference.imageUrl ? 'uploaded-material-reference' : 'deterministic-svg',
	        imageUrl: materialReference.imageUrl || selectedPreview.imageUrl,
	      },
	      metadata: {
	        workspace: 'patterns',
	        searchTokens: ['pattern-design-brief', 'graphic-pattern-workspace', activeMode],
	        selectedPatternPreview,
	        materialReference: materialReferenceMetadata,
	      },
	    });

    toast.success('柄・グラフィックを保存し、Canvasへ渡しました');
    navigate(`/canvas/${projectId}`);
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
              パターン作業台
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              グラフィック、総柄、ベクター化の入口を、Canvas に渡せるローカルワークスペースです。
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
                  ? 'border-cyan-300 bg-cyan-300 text-neutral-950 dark:border-cyan-300 dark:bg-cyan-300 dark:text-neutral-950'
                  : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:border-cyan-300/50 hover:bg-white/[0.07]'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </section>

      <section
        data-testid="pattern-action-panel"
        className="glass-panel rounded-2xl border dark:border-cyan-300/30 border-cyan-300/35 bg-cyan-300/[0.08] p-5 dark:border-cyan-300/30 dark:bg-cyan-300/[0.08]"
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300 dark:text-cyan-300">
              Print flow
            </p>
            <h2 className="mt-2 text-xl font-semibold text-neutral-950 dark:text-white">
              新規ファイル、最近の案件、事例から入って、生成かCanvasへ進む
            </h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                { label: '候補', value: selectedPreview.label },
                { label: '用途', value: activeMode },
                { label: '素材', value: materialReference.imageUrl ? '参照あり' : '参照なしでも開始可' },
              ].map((item) => (
                <div
                  key={item.label}
                  data-testid="pattern-readiness-item"
                  className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm"
                >
                  <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{item.label}</p>
                  <p className="mt-1 font-semibold text-neutral-900 dark:text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
          <div data-testid="pattern-next-actions" className="grid gap-2">
            <Link
              to={directPatternGenerationHref}
              className="btn-primary inline-flex items-center justify-center gap-2 text-sm"
            >
              <WandSparkles className="h-4 w-4" />
              生成へ
              <ChevronRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={handoffToCanvas}
              disabled={!currentBrand}
              className="btn-secondary inline-flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              保存して重ねる
            </button>
            <Link
              to="/gallery"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white/80 px-4 py-2.5 text-sm font-semibold text-neutral-800 transition hover:bg-white dark:border-white/10 dark:bg-surface-900/70 dark:text-neutral-100"
            >
              Galleryで結果を見る
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">制作ボード</h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                素材・柄・配置・色・版下の順に、生成と入稿へ使う条件を組み立てます。
              </p>
            </div>
            <div className="rounded-full bg-cyan-300/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-300/30">
              {activeMode} / {selectedPreview.label}
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1.1fr]">
	              <div className="space-y-4">
	              <MaterialWorkbench
	                title="素材作業台"
	                description="柄画像、ロゴ、服モックをアップロードし、カット、レイヤー、配置を先に決めます。"
	                uploadLabel="柄・ロゴ・服モックをアップロード"
	                emptyLabel="素材を置くと、保存時にCanvasへ実画像レイヤーとして渡せます"
	                state={materialReference}
	                onChange={setMaterialReference}
	                materialKinds={['柄画像', 'ロゴ', '服モック', '刺繍版下', '生地テクスチャ']}
	                layerOptions={['プリント', 'マスク', '服', 'ロゴ', '版下']}
	                placementOptions={['胸中央', '背面大判', '袖', '全面総柄', '小物ワンポイント']}
	              />

              <div className="rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-900/50">
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-cyan-300" />
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
                            ? 'border-cyan-300 bg-cyan-300 text-neutral-950 dark:border-cyan-300 dark:bg-cyan-300 dark:text-neutral-950'
                            : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:border-cyan-300/50 hover:bg-white/[0.07]'
                        }`}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.08] text-cyan-200">
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
                    <Shapes className="h-4 w-4 text-cyan-300" />
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
                    <Repeat2 className="h-4 w-4 text-cyan-300" />
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
                    <Shirt className="h-4 w-4 text-cyan-300" />
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
                    <Palette className="h-4 w-4 text-cyan-300" />
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
                <WandSparkles className="h-4 w-4 text-cyan-300" />
                <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">現在の制作Brief</h3>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  版下
                  <select
                    value={vectorIntent}
                    onChange={(event) => setVectorIntent(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
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
          <div className="mt-4 grid gap-3 md:grid-cols-3" data-testid="pattern-preview-candidates">
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
                      ? 'border-cyan-300 bg-cyan-300 text-neutral-950 dark:border-cyan-300 dark:bg-cyan-300 dark:text-neutral-950'
                      : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:border-cyan-300/50 hover:bg-white/[0.07]'
                  }`}
                >
                  <span className="flex items-center justify-between gap-3 text-sm font-semibold">
                    {candidate.label}
                    {selected && <Check className="h-4 w-4" />}
                  </span>
                  <img
                    src={candidate.imageUrl}
                    alt={`${candidate.label} preview`}
                    data-testid="pattern-preview-image"
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
            <div className="h-full rounded-full bg-cyan-300" style={{ width: `${progress}%` }} />
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
