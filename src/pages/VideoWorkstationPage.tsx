import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Check, ChevronRight, Clapperboard, Film, Save, Smartphone } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { MaterialWorkbench } from '../components/workspace/MaterialWorkbench';
import {
  buildMaterialReferenceMetadata,
  type MaterialReferenceState,
} from '../lib/workspaceMaterialReferences';
import { buildGenerationIntentHref, handoffWorkspaceToCanvas, workspaceSourceConfig } from '../lib/workspaceHandoff';

const choices = ['構成', '編集', '書き出し'];
const fieldClass = 'mt-2 w-full rounded-xl border border-neutral-200 bg-white/75 px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-white/10 dark:bg-surface-900/70 dark:text-white dark:focus:border-primary-500';
type VideoStoryboardCandidate = {
  id: string;
  label: string;
  shotOrder: string;
  motion: string;
  framing: string;
  cta: string;
  duration: string;
  aspectRatio: string;
  materials: string;
  motionSignature: string;
  framingSignature: string;
  workflowMode: string;
};
type HistoryItem = {
  id: string;
  label: string;
};

const initialHistory: HistoryItem[] = [
  { id: 'video-history-1', label: '15秒リール構成を保存' },
  { id: 'video-history-2', label: '字幕チェックを完了' },
];

const storyboardCandidates: VideoStoryboardCandidate[] = [
  {
    id: 'launch-reel',
    label: 'Launch Reel',
    shotOrder: '1. Logo flash / 2. Product hero spin / 3. Model stride / 4. CTA end frame',
    motion: 'fast ramp, whip transition, subtle cloth sway',
    framing: 'vertical hero crop, center product, end card lower-third',
    cta: 'Drop starts Friday',
    duration: '15秒',
    aspectRatio: '9:16',
    materials: 'product_hero.png, logo.svg, launch_music_ref.mp3',
    motionSignature: 'fast-ramp-whip-cloth-sway',
    framingSignature: 'vertical-hero-center-lower-third',
    workflowMode: 'launch-campaign',
  },
  {
    id: 'texture-close-up',
    label: 'Texture Close-up',
    shotOrder: '1. Sleeve macro / 2. Stitch pan / 3. Fabric pull / 4. Logo tag CTA',
    motion: 'slow push-in, lateral macro pan, tactile fabric pull',
    framing: 'macro crop, shallow focus, detail-first CTA',
    cta: 'Feel the heavyweight texture',
    duration: '12秒',
    aspectRatio: '4:5',
    materials: 'texture_macro.png, stitch_ref.mov, woven_label.svg',
    motionSignature: 'slow-push-lateral-macro-pull',
    framingSignature: 'macro-shallow-focus-detail-cta',
    workflowMode: 'material-detail',
  },
  {
    id: 'fit-check-cta',
    label: 'Fit Check CTA',
    shotOrder: '1. Mirror fit check / 2. Side silhouette / 3. Walking loop / 4. Swipe CTA',
    motion: 'mirror tilt, side turn, three-step walking loop',
    framing: 'full-body 4:5, garment fit readable, CTA safe area top',
    cta: 'Check your size before it sells out',
    duration: '18秒',
    aspectRatio: '4:5',
    materials: 'fit_model_ref.png, garment_front.png, size_badge.svg',
    motionSignature: 'mirror-tilt-side-turn-walk-loop',
    framingSignature: 'full-body-fit-readable-top-safe-area',
    workflowMode: 'fit-conversion',
  },
];

const storyboardOutputLabels: Record<string, string[]> = {
  'launch-reel': ['縦型リール', '商品ヒーロー', 'CTAエンド'],
  'texture-close-up': ['素材マクロ', '縫製ディテール', 'タグCTA'],
  'fit-check-cta': ['着用ループ', 'サイズ確認', 'Swipe CTA'],
};

const storyboardIcons: Record<string, typeof Film> = {
  'launch-reel': Smartphone,
  'texture-close-up': Film,
  'fit-check-cta': Clapperboard,
};

const initialMaterialReference: MaterialReferenceState = {
  imageUrl: '',
  fileName: '',
  materialKind: '商品カット',
  maskMode: 'auto',
  activeLayer: '商品',
  placement: '1カット目',
  scale: 64,
  note: '動画のどのショットに使う素材かを先に決めます。',
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

const getShotVisual = (step: string, index: number) => {
  const lower = step.toLowerCase();
  if (lower.includes('logo') || step.includes('ロゴ')) {
    return { label: 'LOGO', sublabel: 'Brand flash', tone: 'blue' };
  }
  if (lower.includes('product') || lower.includes('hero') || step.includes('商品')) {
    return { label: 'PRODUCT', sublabel: 'Hero detail', tone: 'amber' };
  }
  if (lower.includes('model') || lower.includes('stride') || lower.includes('fit') || step.includes('モデル') || step.includes('着用')) {
    return { label: 'MODEL', sublabel: 'Fit motion', tone: 'green' };
  }
  if (lower.includes('cta') || lower.includes('swipe') || step.includes('CTA')) {
    return { label: 'CTA', sublabel: 'End frame', tone: 'dark' };
  }
  return { label: `SHOT ${index + 1}`, sublabel: 'Storyboard', tone: 'neutral' };
};

const buildVideoStoryboardPreviewSvg = ({
  activeChoice,
  selectedStoryboard,
  duration,
  aspectRatio,
  shotPlan,
  subtitleCta,
  materials,
}: {
  activeChoice: string;
  selectedStoryboard: VideoStoryboardCandidate;
  duration: string;
  aspectRatio: string;
  shotPlan: string;
  subtitleCta: string;
  materials: string;
}) => {
  const safeChoice = escapeSvgText(activeChoice);
  const safeLabel = escapeSvgText(selectedStoryboard.label);
  const safeShotOrder = escapeSvgText(shotPlan.slice(0, 82));
  const safeMotion = escapeSvgText(selectedStoryboard.motion.slice(0, 70));
  const safeFraming = escapeSvgText(selectedStoryboard.framing.slice(0, 70));
  const safeCta = escapeSvgText(subtitleCta.slice(0, 64));
  const safeMaterials = escapeSvgText(materials.slice(0, 72));
  const primaryInput = `${duration} / ${aspectRatio} / ${shotPlan}`;
  const safePrimaryInput = escapeSvgText(primaryInput.slice(0, 78));
  const nextStep = `${shotPlan}をvideo-shot-planとしてレンダー指示へ進める`;
  const safeNextStep = escapeSvgText(nextStep.slice(0, 78));
  const safeFullPrimaryInput = escapeSvgText(primaryInput);
  const safeFullNextStep = escapeSvgText(nextStep);
  const accent = selectedStoryboard.id === 'launch-reel'
    ? '#0ea5e9'
    : selectedStoryboard.id === 'texture-close-up'
      ? '#a16207'
      : '#16a34a';
  const panelFill = selectedStoryboard.id === 'texture-close-up'
    ? '#f5efe4'
    : selectedStoryboard.id === 'fit-check-cta'
      ? '#eef7f0'
      : '#eef6ff';

  return encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640" data-video-storyboard="video-storyboard-local-v1">
      <metadata>
        <video-storyboard workflowVersion="video-storyboard-local-v1" selectedVideoStoryboard="${selectedStoryboard.id}" motionSignature="${selectedStoryboard.motionSignature}" framingSignature="${selectedStoryboard.framingSignature}" primaryInput="${safeFullPrimaryInput}" nextStep="${safeFullNextStep}" />
      </metadata>
      <rect width="960" height="640" rx="36" fill="#f7f7f5"/>
      <rect x="54" y="54" width="852" height="532" rx="30" fill="#ffffff" stroke="#e5e5e5"/>
      <rect x="92" y="104" width="150" height="268" rx="22" fill="${panelFill}" stroke="${accent}" stroke-width="5"/>
      <rect x="270" y="104" width="150" height="268" rx="22" fill="#fafafa" stroke="#d4d4d4" stroke-width="4"/>
      <rect x="448" y="104" width="150" height="268" rx="22" fill="#fafafa" stroke="#d4d4d4" stroke-width="4"/>
      <rect x="626" y="104" width="150" height="268" rx="22" fill="#171717" stroke="${accent}" stroke-width="5"/>
      <circle cx="167" cy="192" r="42" fill="${accent}" opacity=".88"/>
      <path d="M130 262h74M130 292h94M130 322h58" stroke="#171717" stroke-width="10" stroke-linecap="round" opacity=".74"/>
      <path d="M312 186h70M306 224h84M318 262h58" stroke="${accent}" stroke-width="13" stroke-linecap="round"/>
      <path d="M500 158c30 22 48 54 50 96M500 334c30-22 48-54 50-96" fill="none" stroke="#171717" stroke-width="12" stroke-linecap="round"/>
      <path d="M674 214h54M674 252h70M674 290h42" stroke="#ffffff" stroke-width="12" stroke-linecap="round"/>
      <text x="92" y="414" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#171717">selected-video-storyboard:${selectedStoryboard.id}</text>
      <text x="92" y="442" font-family="Inter, Arial, sans-serif" font-size="15" fill="#737373">workflowVersion:video-storyboard-local-v1</text>
      <text x="92" y="468" font-family="Inter, Arial, sans-serif" font-size="15" fill="#737373">motionSignature:${selectedStoryboard.motionSignature}</text>
      <text x="92" y="494" font-family="Inter, Arial, sans-serif" font-size="15" fill="#737373">framingSignature:${selectedStoryboard.framingSignature}</text>
      <text x="560" y="138" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="${accent}">${safeChoice}</text>
      <text x="560" y="188" font-family="Inter, Arial, sans-serif" font-size="40" font-weight="800" fill="#171717">${safeLabel}</text>
      <text x="560" y="244" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">shotOrder: ${safeShotOrder}</text>
      <text x="560" y="288" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">motion: ${safeMotion}</text>
      <text x="560" y="332" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">framing: ${safeFraming}</text>
      <text x="560" y="376" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">CTA: ${safeCta}</text>
      <text x="560" y="420" font-family="Inter, Arial, sans-serif" font-size="18" fill="#525252">materials: ${safeMaterials}</text>
      <text x="560" y="478" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#171717">Primary input</text>
      <text x="560" y="504" font-family="Inter, Arial, sans-serif" font-size="16" fill="#525252">${safePrimaryInput}</text>
      <text x="560" y="534" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" fill="#171717">Next step</text>
      <text x="560" y="560" font-family="Inter, Arial, sans-serif" font-size="16" fill="#525252">${safeNextStep}</text>
    </svg>
  `);
};

export function VideoWorkstationPage() {
  const navigate = useNavigate();
  const { currentBrand } = useAuthStore();
  const [activeChoice, setActiveChoice] = useState(choices[0]);
  const [progress, setProgress] = useState(40);
  const [history, setHistory] = useState(initialHistory);
  const [selectedStoryboardId, setSelectedStoryboardId] = useState(storyboardCandidates[0].id);
  const [duration, setDuration] = useState(storyboardCandidates[0].duration);
  const [aspectRatio, setAspectRatio] = useState(storyboardCandidates[0].aspectRatio);
  const [shotPlan, setShotPlan] = useState(storyboardCandidates[0].shotOrder);
  const [subtitleCta, setSubtitleCta] = useState(storyboardCandidates[0].cta);
  const [materials, setMaterials] = useState(storyboardCandidates[0].materials);
  const [materialReference, setMaterialReference] = useState<MaterialReferenceState>(initialMaterialReference);
  const nextHistoryId = useRef(3);
  const selectedStoryboard = storyboardCandidates.find((candidate) => candidate.id === selectedStoryboardId) ?? storyboardCandidates[0];
  const shotSteps = shotPlan
    .split('/')
    .map((step) => step.trim())
    .filter(Boolean);
  const previewImageUrl = useMemo(() => buildVideoStoryboardPreviewSvg({
    activeChoice,
    selectedStoryboard,
    duration,
    aspectRatio,
    shotPlan,
    subtitleCta,
    materials,
  }), [activeChoice, aspectRatio, duration, materials, selectedStoryboard, shotPlan, subtitleCta]);
  const primaryInput = `${duration} / ${aspectRatio} / ${shotPlan}`;
  const nextStep = `${shotPlan}をvideo-shot-planとしてレンダー指示へ進める`;
  const directVideoGenerationHref = buildGenerationIntentHref({
    feature: 'campaign-image',
    prompt: [
      `Storyboard: ${selectedStoryboard.label}`,
      `Shot order: ${shotPlan}`,
      `Motion: ${selectedStoryboard.motion}`,
      `Framing: ${selectedStoryboard.framing}`,
      `CTA: ${subtitleCta}`,
      `Materials: ${materials}`,
      `Format: ${aspectRatio}`,
    ].join('\n'),
    aspectRatio,
    sourceWorkspace: 'video',
    workflowVersion: 'video-storyboard-local-v1',
    sourceLabel: workspaceSourceConfig.video.label,
    sourceResumePath: workspaceSourceConfig.video.resumePath,
    sourceMode: 'local-workflow-intake',
  });

  const recordProgress = (choice: string) => {
    const historyItem = {
      id: `video-history-${nextHistoryId.current++}`,
      label: `${choice}をローカル履歴に追加`,
    };

    setActiveChoice(choice);
    setProgress((current) => Math.min(current + 12, 96));
    setHistory((items) => [historyItem, ...items].slice(0, 4));
  };

  const selectStoryboard = (candidate: VideoStoryboardCandidate) => {
    setSelectedStoryboardId(candidate.id);
    setDuration(candidate.duration);
    setAspectRatio(candidate.aspectRatio);
    setShotPlan(candidate.shotOrder);
    setSubtitleCta(candidate.cta);
    setMaterials(candidate.materials);
  };

  const handoffToCanvas = () => {
    if (!currentBrand) {
      toast.error('ブランドを読み込んでからもう一度試してください');
      return;
    }

    const note = history[0]?.label ?? 'ローカルメモなし';
    const generationSource = {
      sourceWorkspace: 'video' as const,
      workflowVersion: 'video-storyboard-local-v1',
      sourceLabel: workspaceSourceConfig.video.label,
      sourceResumePath: workspaceSourceConfig.video.resumePath,
      sourceMode: 'local-workflow-intake' as const,
    };
    const selectedVideoStoryboardMetadata = {
      id: selectedStoryboard.id,
      label: selectedStoryboard.label,
      shotOrder: shotPlan,
      motion: selectedStoryboard.motion,
      framing: selectedStoryboard.framing,
      cta: subtitleCta,
      materials,
      format: aspectRatio,
      duration,
      motionSignature: selectedStoryboard.motionSignature,
      framingSignature: selectedStoryboard.framingSignature,
      workflowMode: selectedStoryboard.workflowMode,
    };
    const materialReferenceMetadata = buildMaterialReferenceMetadata(materialReference);
    const materialReferenceSummary = materialReferenceMetadata.hasImage
      ? `${materialReferenceMetadata.materialKind}: ${materialReferenceMetadata.fileName ?? 'uploaded'} / ${materialReferenceMetadata.activeLayer} / ${materialReferenceMetadata.placement} / ${materialReferenceMetadata.scale}%`
      : '動画素材画像なし';
    const generationPrompt = [
      `Storyboard: ${selectedStoryboard.label}`,
      `Shot order: ${shotPlan}`,
      `Motion: ${selectedStoryboard.motion}`,
      `Framing: ${selectedStoryboard.framing}`,
      `CTA: ${subtitleCta}`,
      `Materials: ${materials}`,
      `Material reference: ${materialReferenceSummary}`,
      `Format: ${aspectRatio}`,
    ].join('\n');
    const prompt = [
      `Primary input: ${primaryInput}`,
      `Duration: ${duration}`,
      `Aspect ratio: ${aspectRatio}`,
      `Storyboard: ${selectedStoryboard.label}`,
      `Shot plan: ${shotPlan}`,
      `Motion: ${selectedStoryboard.motion}`,
      `Framing: ${selectedStoryboard.framing}`,
      `Subtitle CTA: ${subtitleCta}`,
      `Materials: ${materials}`,
      `Material reference: ${materialReferenceSummary}`,
      `Format: ${aspectRatio}`,
      `Next step: ${nextStep}`,
    ].join('\n');
    const { projectId } = handoffWorkspaceToCanvas({
      brandId: currentBrand.id,
      featureType: 'video-workstation',
      projectName: `Video Workstation: ${activeChoice}`,
      title: `Video Workstation: ${activeChoice}`,
      prompt,
      imageUrl: materialReference.imageUrl || previewImageUrl,
      summary: `${activeChoice}の進捗 ${progress}%`,
      note,
      activeChoice,
      progress,
      history: history.map((item) => item.label),
      workflow: {
        workflowVersion: 'video-storyboard-local-v1',
        inputs: {
          duration,
          aspectRatio,
          shotPlan,
          subtitleCta,
          materials,
          selectedVideoStoryboard: selectedVideoStoryboardMetadata,
          materialReference: materialReferenceMetadata,
        },
        plan: {
          videoShotPlan: 'video-shot-plan',
          renderTarget: aspectRatio,
          selectedVideoStoryboard: selectedVideoStoryboardMetadata,
          materialReference: materialReferenceMetadata,
          preview: {
            previewKind: 'deterministic-svg',
            marker: 'selected-video-storyboard',
            imageUrl: previewImageUrl,
          },
          nextStep,
          searchTokens: ['video-shot-plan', 'video-storyboard-local-v1', activeChoice, selectedStoryboard.id, duration],
        },
        status: 'planned',
        resumePath: '/video',
        handoffKind: 'local-workflow-intake',
        primaryInput,
        nextStep,
        generationIntent: {
          feature: 'campaign-image',
          prompt: generationPrompt,
          href: buildGenerationIntentHref({
            feature: 'campaign-image',
            prompt: generationPrompt,
            aspectRatio,
            ...generationSource,
          }),
          label: 'キャンペーン画像で生成',
          ...generationSource,
          aspectRatio,
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
            selectedStoryboardId: selectedStoryboard.id,
            hasUploadedMaterial: Boolean(materialReference.imageUrl),
            placement: materialReference.placement,
          },
        },
      },
      previewMetadata: {
        selectedVideoStoryboard: selectedVideoStoryboardMetadata,
        previewKind: 'deterministic-svg',
        marker: 'selected-video-storyboard',
        imageUrl: previewImageUrl,
        materialReference: materialReferenceMetadata,
      },
      selectedVideoStoryboard: selectedVideoStoryboardMetadata,
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
        selectedStoryboardId: selectedStoryboard.id,
        hasUploadedMaterial: Boolean(materialReference.imageUrl),
        placement: materialReference.placement,
      },
      metadata: {
        workspace: 'video',
        searchTokens: ['video-shot-plan', 'video-workstation', 'video-storyboard-local-v1', activeChoice, selectedStoryboard.id],
        selectedVideoStoryboard: selectedVideoStoryboardMetadata,
        materialReferences: [materialReferenceMetadata],
      },
    });

    toast.success('Video WorkstationをGallery/Historyに保存し、Canvasへ渡しました');
    navigate(`/canvas/${projectId}`);
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
              Video Workstation
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              商品動画の構成、編集、書き出し状態を、Gallery/History と Canvas に渡せる動画ワークスペースです。
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

        <div className="mt-6 rounded-2xl border border-neutral-200 bg-white/55 p-4 dark:border-white/10 dark:bg-surface-900/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">動画レーンを選ぶ</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                Lightchainで動画用途を選んでいた流れに合わせて、尺・比率・ショット順・CTAをまとめて決めます。
              </p>
            </div>
            <span className="w-fit rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-950/50 dark:text-primary-200">
              {selectedStoryboard.duration} / {selectedStoryboard.aspectRatio}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {storyboardCandidates.map((candidate) => {
              const selected = candidate.id === selectedStoryboard.id;
              const Icon = storyboardIcons[candidate.id] ?? Film;

              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => selectStoryboard(candidate)}
                  aria-pressed={selected}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selected
                      ? 'border-primary-400 bg-primary-50/70 ring-2 ring-primary-100 dark:border-primary-300 dark:bg-primary-400/10 dark:ring-primary-400/20'
                      : 'border-neutral-200 bg-white/75 hover:border-primary-300 hover:bg-white dark:border-white/10 dark:bg-surface-950/50 dark:hover:border-primary-500/70'
                  }`}
                >
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    selected
                      ? 'bg-primary-600 text-white'
                      : 'bg-surface-100 text-neutral-600 dark:bg-surface-800 dark:text-neutral-300'
                  }`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="mt-3 flex items-center justify-between gap-3 text-sm font-semibold text-neutral-950 dark:text-white">
                    {candidate.label}
                    {selected && <Check className="h-4 w-4 text-primary-600 dark:text-primary-200" />}
                  </span>
                  <span className="mt-2 block text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                    {candidate.duration} / {candidate.aspectRatio} / {candidate.workflowMode}
                  </span>
                  <span className="mt-3 flex flex-wrap gap-1.5">
                    {(storyboardOutputLabels[candidate.id] ?? []).map((output) => (
                      <span key={output} className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-neutral-500 ring-1 ring-neutral-200 dark:bg-surface-900 dark:text-neutral-300 dark:ring-white/10">
                        {output}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section
        data-testid="video-action-panel"
        className="glass-panel rounded-2xl border border-primary-200/70 bg-primary-50/70 p-5 dark:border-primary-400/20 dark:bg-primary-950/20"
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-700 dark:text-primary-200">
              Video flow
            </p>
            <h2 className="mt-2 text-xl font-semibold text-neutral-950 dark:text-white">
              ショット順、尺、CTAを決めて、生成指示かCanvas仕上げへ進む
            </h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                { label: '構成', value: selectedStoryboard.label },
                { label: '比率', value: aspectRatio },
                { label: '素材', value: materialReference.imageUrl ? '参照あり' : '参照なしでも開始可' },
              ].map((item) => (
                <div
                  key={item.label}
                  data-testid="video-readiness-item"
                  className="rounded-xl bg-white/75 p-3 text-sm dark:bg-surface-900/60"
                >
                  <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{item.label}</p>
                  <p className="mt-1 font-semibold text-neutral-900 dark:text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
          <div data-testid="video-next-actions" className="grid gap-2">
            <Link
              to={directVideoGenerationHref}
              className="btn-primary inline-flex items-center justify-center gap-2 text-sm"
            >
              <Film className="h-4 w-4" />
              生成指示へ送る
              <ChevronRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={handoffToCanvas}
              disabled={!currentBrand}
              className="btn-secondary inline-flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Canvasへ保存して構成する
            </button>
            <Link
              to="/gallery"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white/80 px-4 py-2.5 text-sm font-semibold text-neutral-800 transition hover:bg-white dark:border-white/10 dark:bg-surface-900/70 dark:text-neutral-100"
            >
              Galleryで素材を見る
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <MaterialWorkbench
            title="動画素材作業台"
            description="商品カット、モデル動画の静止画、ロゴ、字幕カードを置き、どのショットレイヤーへ使うかを先に決めます。"
            uploadLabel="商品・モデル・ロゴ素材をアップロード"
            emptyLabel="素材を置くと、Canvasへ動画ショット用の実画像レイヤーとして渡せます"
            state={materialReference}
            onChange={setMaterialReference}
            materialKinds={['商品カット', 'モデル参照', 'ロゴ', '字幕カード', '背景']}
            layerOptions={['商品', 'モデル', '背景', '字幕', 'CTA']}
            placementOptions={['1カット目', '2カット目', '3カット目', 'エンドカード', '全ショット共通']}
          />
        </div>
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">素材と尺を整える</h2>
          <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            選んだ動画レーンをもとに、素材ファイル、字幕CTA、ショット順だけを調整します。
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              尺
              <input value={duration} onChange={(event) => setDuration(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              比率
              <input value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white md:col-span-2">
              ショット構成
              <textarea value={shotPlan} onChange={(event) => setShotPlan(event.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              字幕CTA
              <input value={subtitleCta} onChange={(event) => setSubtitleCta(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-sm font-semibold text-neutral-900 dark:text-white">
              素材
              <input value={materials} onChange={(event) => setMaterials(event.target.value)} className={fieldClass} />
            </label>
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">Storyboardプレビュー</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{selectedStoryboard.label} / {selectedStoryboard.motionSignature}</p>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[420px_1fr]">
            <img
              src={previewImageUrl}
              alt="Video storyboard preview"
              data-testid="video-storyboard-preview-image"
              className="aspect-[3/2] w-full rounded-2xl border border-neutral-200 bg-white object-cover dark:border-white/10 dark:bg-surface-900"
            />
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-xl bg-white/60 p-3 dark:bg-surface-900/50">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Motion</p>
                <p className="mt-1 text-sm leading-6 text-neutral-700 dark:text-neutral-200">{selectedStoryboard.motion}</p>
              </div>
              <div className="rounded-xl bg-white/60 p-3 dark:bg-surface-900/50">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Framing</p>
                <p className="mt-1 text-sm leading-6 text-neutral-700 dark:text-neutral-200">{selectedStoryboard.framing}</p>
              </div>
              <div className="rounded-xl bg-white/60 p-3 dark:bg-surface-900/50">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Output</p>
                <p className="mt-1 text-sm leading-6 text-neutral-700 dark:text-neutral-200">{(storyboardOutputLabels[selectedStoryboard.id] ?? []).join(' / ')}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-neutral-200 bg-white/70 p-4 dark:border-white/10 dark:bg-surface-950/40">
            <div className="grid gap-3 md:grid-cols-4">
              {shotSteps.slice(0, 4).map((step, index) => {
                const shotVisual = getShotVisual(step, index);
                return (
                  <div key={`${step}-${index}`} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-surface-900/70">
                    <div
                      data-testid="video-shot-preview-card"
                      data-shot-tone={shotVisual.tone}
                      className={`flex aspect-[9/14] flex-col justify-between rounded-lg p-4 text-left ${
                        shotVisual.tone === 'blue'
                          ? 'bg-sky-50 text-sky-950 dark:bg-sky-950/35 dark:text-sky-100'
                          : shotVisual.tone === 'amber'
                            ? 'bg-amber-50 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100'
                            : shotVisual.tone === 'green'
                              ? 'bg-emerald-50 text-emerald-950 dark:bg-emerald-950/35 dark:text-emerald-100'
                              : shotVisual.tone === 'dark'
                                ? 'bg-neutral-950 text-white dark:bg-black'
                                : 'bg-surface-100 text-neutral-800 dark:bg-surface-800 dark:text-neutral-100'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="rounded-full bg-white/75 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-neutral-700 dark:bg-white/15 dark:text-white">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <Film className="h-4 w-4 opacity-75" />
                      </div>
                      <div>
                        <p className="text-lg font-black leading-tight">{shotVisual.label}</p>
                        <p className="mt-1 text-xs font-semibold opacity-75">{shotVisual.sublabel}</p>
                      </div>
                      <div className="space-y-1">
                        <div className="h-1.5 rounded-full bg-current opacity-40" />
                        <div className="h-1.5 w-2/3 rounded-full bg-current opacity-25" />
                      </div>
                    </div>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Shot {index + 1}</p>
                    <p className="mt-1 text-sm font-semibold leading-6 text-neutral-800 dark:text-neutral-100">{step}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl bg-surface-50 p-3 dark:bg-surface-900/60">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">字幕CTA</p>
                <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200">{subtitleCta}</p>
              </div>
              <div className="rounded-xl bg-surface-50 p-3 dark:bg-surface-900/60">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">素材</p>
                <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200">{materials}</p>
              </div>
              <div className="rounded-xl bg-surface-50 p-3 dark:bg-surface-900/60">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">次に行く場所</p>
                <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200">Canvas / 生成指示へ handoff</p>
              </div>
            </div>
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
