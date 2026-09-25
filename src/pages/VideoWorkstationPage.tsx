import { useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clapperboard,
  Film,
  Hand,
  ImageIcon,
  ImagePlus,
  Layers,
  MousePointer2,
  Redo2,
  Save,
  Smartphone,
  Sparkles,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { MaterialWorkbench } from '../components/workspace/MaterialWorkbench';
import { WorkspaceReadinessStrip } from '../components/workspace/WorkspaceReadinessStrip';
import {
  buildMaterialReferenceMetadata,
  type MaterialReferenceState,
} from '../lib/workspaceMaterialReferences';
import {
  handoffWorkspaceToCanvas,
  restoreWorkspaceHandoffHistory,
  type GenerationIntent,
} from '../lib/workspaceHandoff';
import {
  listWorkspaceArtifacts,
  saveWorkspaceArtifactBestEffort,
  type WorkspaceArtifact,
  type WorkspaceArtifactInput,
  type WorkspaceArtifactPersistenceResult,
} from '../lib/localWorkspaceArtifacts';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { matchesVideoProjectArtifact, shouldHydrateVideoSourceImage } from '../lib/videoWorkspacePersistence';

const choices = ['構成', '編集', '書き出し'];
const fieldClass = 'mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20';
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

type VideoSourceEditorValues = {
  editPrompt: string;
  duration: string;
  resolution: string;
};

type VideoSourceEditorPersistedState = VideoSourceEditorValues & {
  referenceName: string;
  referencePreview: string;
};

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

const VIDEO_GUIDE_DISMISSED_STORAGE_KEY = 'heavy-chain-video-guide-dismissed';
const VIDEO_SOURCE_EDITOR_VERSION = 'video-source-editor-parity-v1';
const VIDEO_PERSISTED_DATA_URL_LIMIT = 1_500_000;
const LIGHTCHAIN_VIDEO_MAIN_IMAGE = 'https://static-jp.linkaigc.com/saas/2026-06/c914c5010e17ca8f3bdbdb93ae2088fc.jpeg?x-oss-process=image/resize,m_lfit,w_3840,limit_1/format,webp';
const LIGHTCHAIN_VIDEO_REFERENCE_IMAGE = 'https://static-jp.linkaigc.com/saas/2026-06/73e4af273bd3f306c8ed549efd3a7cb5.png?x-oss-process=image/resize,m_lfit,w_3840,limit_1/format,webp';
const LIGHTCHAIN_VIDEO_SOURCE_RESULT = 'https://static-jp.linkaigc.com/saas/2026-02/c44b4aecfba3ddee5a37d94925b4f40d.mp4?x-oss-process=video/snapshot,t_1000,m_fast,ar_auto';
const LIGHTCHAIN_VIDEO_SOURCE_NODE_IMAGE = 'https://static-jp.linkaigc.com/saas/2026-02/dbe43f25eadaf147c9ffefc1d609c4eb.webp';

function LightchainVideoImage({
  src,
  alt,
  className,
  fallbackLabel = '画像を読み込めません',
  testId,
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
  testId?: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setLoadFailed(false);
  }, [src]);

  if (loadFailed || !src.trim()) {
    return (
      <div
        className={`${className ?? ''} flex items-center justify-center gap-1 bg-[#2b3234] px-2 text-[10px] text-neutral-400`}
        role="img"
        aria-label={alt || fallbackLabel}
        data-testid={testId}
      >
        <ImageIcon aria-hidden="true" className="size-4 shrink-0 opacity-75" />
        <span className="truncate">{fallbackLabel}</span>
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} data-testid={testId} onError={() => setLoadFailed(true)} />;
}

const readVideoMetadataString = (artifact: WorkspaceArtifact | null | undefined, key: string) => {
  const value = artifact?.metadata[key];
  return typeof value === 'string' ? value : '';
};

const readVideoEditorState = (artifact: WorkspaceArtifact | null | undefined): VideoSourceEditorPersistedState | undefined => {
  if (!artifact) return undefined;
  const duration = readVideoMetadataString(artifact, 'videoDuration');
  const resolution = readVideoMetadataString(artifact, 'videoResolution');
  return {
    editPrompt: readVideoMetadataString(artifact, 'videoEditPrompt') || INITIAL_VIDEO_EDIT_PROMPT,
    duration: duration === '5秒' || duration === '10秒' || duration === '15秒' ? duration : '5秒',
    resolution: resolution === '720P' || resolution === '1080P' ? resolution : '720P',
    referenceName: readVideoMetadataString(artifact, 'videoReferenceName'),
    referencePreview: readVideoMetadataString(artifact, 'videoReferencePreview'),
  };
};

const buildVideoEditorHref = (projectCode: string) => (
  `/flow/GenerateShortVideo/detail?boardProjectCode=${encodeURIComponent(projectCode)}&boardProjectType=GenerateShortVideoCustom`
);

const buildVideoEditorGenerationIntent = (projectCode: string, prompt: string): GenerationIntent => ({
  feature: 'video-workstation',
  prompt,
  href: buildVideoEditorHref(projectCode),
  label: '動画を再利用',
  sourceWorkspace: 'video',
  workflowVersion: 'video-storyboard-local-v1',
  sourceLabel: 'Video Workstation',
  sourceResumePath: '/flow/GenerateShortVideo/detail',
  sourceMode: 'local-workflow-intake',
});

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
  const location = useLocation();
  const { user, currentBrand } = useAuthStore();
  const routeParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const boardProjectCode = routeParams.get('boardProjectCode');
  const legacyProjectCode = routeParams.get('project');
  const hasExistingVideoProject = Boolean(boardProjectCode || (legacyProjectCode && legacyProjectCode !== 'new'));
  const [newVideoDraftId] = useState(() => {
    try {
      return `local-video-draft-${crypto.randomUUID()}`;
    } catch {
      return `local-video-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
  });
  const videoProjectCode = boardProjectCode?.trim()
    || (legacyProjectCode && legacyProjectCode !== 'new' ? legacyProjectCode : '')
    || newVideoDraftId;
  const [videoDraftArtifactId, setVideoDraftArtifactId] = useState<string | undefined>();
  const persistedVideoDraft = useMemo(() => {
    if (!currentBrand?.id) return null;
    const artifacts = listWorkspaceArtifacts(currentBrand.id, user?.id);
    return artifacts.find((artifact) => matchesVideoProjectArtifact(artifact, videoProjectCode, videoDraftArtifactId)) ?? null;
  }, [currentBrand?.id, user?.id, videoDraftArtifactId, videoProjectCode]);
  const persistedVideoEditorState = useMemo(
    () => readVideoEditorState(persistedVideoDraft),
    [persistedVideoDraft],
  );
  const [showVideoGuide, setShowVideoGuide] = useState(() => {
    try {
      return window.localStorage.getItem(VIDEO_GUIDE_DISMISSED_STORAGE_KEY) !== 'true';
    } catch {
      return true;
    }
  });
  const [activeChoice, setActiveChoice] = useState(choices[0]);
  const [progress, setProgress] = useState(40);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedStoryboardId, setSelectedStoryboardId] = useState(storyboardCandidates[0].id);
  const [duration, setDuration] = useState(storyboardCandidates[0].duration);
  const [aspectRatio, setAspectRatio] = useState(storyboardCandidates[0].aspectRatio);
  const [shotPlan, setShotPlan] = useState(storyboardCandidates[0].shotOrder);
  const [subtitleCta, setSubtitleCta] = useState(storyboardCandidates[0].cta);
  const [materials, setMaterials] = useState(storyboardCandidates[0].materials);
  const [materialReference, setMaterialReference] = useState<MaterialReferenceState>(() => {
    const project = boardProjectCode || legacyProjectCode;
    return project && project !== 'new'
      ? { ...initialMaterialReference, imageUrl: LIGHTCHAIN_VIDEO_MAIN_IMAGE, fileName: project }
      : initialMaterialReference;
  });
  const previousVideoProjectCode = useRef(videoProjectCode);
  const nextHistoryId = useRef(1);
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
  const nextStep = `${shotPlan}をvideo-shot-planとして保存し、動画providerの利用可能確認後にレンダーへ進める`;
  const videoProviderBlocker = 'video_provider_not_admitted: 動画providerの利用可能状態が未確認です';

  // React Router can update only the query string when a saved project is
  // opened from the dashboard.  Keep route-owned state fenced to that
  // project so a previous project's source image, progress, or storyboard
  // cannot bleed into the next detail view before its artifact is hydrated.
  useEffect(() => {
    if (previousVideoProjectCode.current === videoProjectCode) return;
    previousVideoProjectCode.current = videoProjectCode;
    setVideoDraftArtifactId(undefined);
    setActiveChoice(choices[0]);
    setProgress(40);
    setHistory([]);
    nextHistoryId.current = 1;
    setSelectedStoryboardId(storyboardCandidates[0].id);
    setDuration(storyboardCandidates[0].duration);
    setAspectRatio(storyboardCandidates[0].aspectRatio);
    setShotPlan(storyboardCandidates[0].shotOrder);
    setSubtitleCta(storyboardCandidates[0].cta);
    setMaterials(storyboardCandidates[0].materials);
    const project = boardProjectCode || legacyProjectCode;
    setMaterialReference(project && project !== 'new'
      ? { ...initialMaterialReference, imageUrl: LIGHTCHAIN_VIDEO_MAIN_IMAGE, fileName: project }
      : initialMaterialReference);
  }, [boardProjectCode, legacyProjectCode, videoProjectCode]);

  useEffect(() => {
    setHistory(restoreWorkspaceHandoffHistory(
      currentBrand?.id,
      'video-workstation',
      user?.id,
      videoProjectCode,
      videoDraftArtifactId,
    ));
  }, [currentBrand?.id, user?.id, videoDraftArtifactId, videoProjectCode]);

  useEffect(() => {
    const savedSourceImage = readVideoMetadataString(persistedVideoDraft, 'videoSourceImageUrl');
    if (!shouldHydrateVideoSourceImage(materialReference.imageUrl, savedSourceImage, LIGHTCHAIN_VIDEO_MAIN_IMAGE)) return;
    setMaterialReference((current) => ({
      ...current,
      imageUrl: savedSourceImage,
      fileName: readVideoMetadataString(persistedVideoDraft, 'videoSourceFileName') || current.fileName,
    }));
  }, [materialReference.imageUrl, persistedVideoDraft]);

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
      : '素材を追加するとここに反映されます';
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
    try {
    const { projectId } = handoffWorkspaceToCanvas({
      brandId: currentBrand.id,
      scopeId: user?.id,
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
        resumePath: '/flow/GenerateShortVideo/detail',
        handoffKind: 'local-workflow-intake',
        primaryInput,
        nextStep,
        providerRoute: 'unsupported',
        providerBlocker: videoProviderBlocker,
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
        providerRoute: 'unsupported',
        providerBlocker: videoProviderBlocker,
        searchTokens: ['video-shot-plan', 'video-workstation', 'video-storyboard-local-v1', activeChoice, selectedStoryboard.id],
        selectedVideoStoryboard: selectedVideoStoryboardMetadata,
        materialReferences: [materialReferenceMetadata],
      },
    });

    toast.success('Video Workstationを保存し、Canvasへ渡しました');
    navigate(`/canvas/${projectId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Canvas保存に失敗しました';
      console.error('Failed to persist Video Workstation handoff:', error);
      toast.error(message);
    }
  };

  const buildVideoEditorArtifactInput = (values: VideoSourceEditorPersistedState): WorkspaceArtifactInput | null => {
    if (!currentBrand?.id) return null;
    const generationIntent = buildVideoEditorGenerationIntent(videoProjectCode, values.editPrompt);
    const persistedReferencePreview = values.referencePreview.startsWith('data:')
      && values.referencePreview.length <= VIDEO_PERSISTED_DATA_URL_LIMIT
      ? values.referencePreview
      : '';
    const persistedSourceImage = materialReference.imageUrl.startsWith('data:')
      && materialReference.imageUrl.length > VIDEO_PERSISTED_DATA_URL_LIMIT
      ? ''
      : materialReference.imageUrl;
    const artifactId = videoDraftArtifactId
      ?? persistedVideoDraft?.id
      ?? (!hasExistingVideoProject ? newVideoDraftId : undefined);
    return {
      id: artifactId,
      brandId: currentBrand.id,
      scopeId: user?.id,
      featureType: 'video-workstation',
      title: 'Untitled',
      imageUrl: previewImageUrl,
      prompt: values.editPrompt,
      metadata: {
        ...(persistedVideoDraft?.metadata ?? {}),
        feature: 'video-workstation',
        videoProjectCode,
        videoSourceEditorVersion: VIDEO_SOURCE_EDITOR_VERSION,
        videoEditPrompt: values.editPrompt,
        videoDuration: values.duration,
        videoResolution: values.resolution,
        videoReferenceName: values.referenceName,
        videoReferencePreview: persistedReferencePreview,
        videoReferencePreviewTruncated: Boolean(values.referencePreview && !persistedReferencePreview),
        videoSourceImageUrl: persistedSourceImage,
        videoSourceFileName: materialReference.fileName,
        sourceWorkspace: 'video',
        sourceLabel: 'Video Workstation',
        sourceResumePath: '/flow/GenerateShortVideo/detail',
        sourceMode: 'local-workflow-intake',
        workflowVersion: 'video-storyboard-local-v1',
        resumePath: '/flow/GenerateShortVideo/detail',
        providerRoute: 'unsupported',
        providerBlocker: videoProviderBlocker,
        generationIntent,
        searchTokens: ['video-workstation', 'video-source-editor-parity', videoProjectCode, values.duration, values.resolution],
      },
    };
  };

  /**
   * Save the source-editor draft through the same durable Cloudflare boundary
   * used by provider results. Local storage remains the offline fallback, but
   * an enabled Cloudflare data plane never reports success without its
   * request-id/readback receipt.
   */
  const persistVideoEditorBestEffort = async (
    values: VideoSourceEditorPersistedState,
  ): Promise<WorkspaceArtifactPersistenceResult> => {
    const input = buildVideoEditorArtifactInput(values);
    if (!input) return { ok: false, error: new Error('video_workspace_brand_not_ready') };
    const result = await saveWorkspaceArtifactBestEffort(input);
    if (!result.localPersisted) {
      return {
        ok: false,
        error: result.localError instanceof Error
          ? result.localError
          : new Error('video_workspace_local_persistence_unverified'),
      };
    }
    if (cloudflareDataPlane && !result.remote) {
      const remoteReason = result.remoteError instanceof Error ? result.remoteError.message : 'remote_receipt_missing';
      return { ok: false, error: new Error(`video_workspace_remote_persistence_unverified:${remoteReason}`) };
    }
    setVideoDraftArtifactId(result.artifact.id);
    return { ok: true, artifact: result.artifact };
  };

  const handoffVideoEditorToCanvas = async (values: VideoSourceEditorPersistedState) => {
    if (!currentBrand) {
      toast.error('ブランドを読み込んでからもう一度試してください');
      return;
    }

    const persisted = await persistVideoEditorBestEffort(values);
    if (!persisted.ok) {
      toast.error('動画編集内容の保存確認に失敗しました');
      return;
    }

    const selectedVideoStoryboardMetadata = {
      id: selectedStoryboard.id,
      label: selectedStoryboard.label,
      shotOrder: shotPlan,
      motion: selectedStoryboard.motion,
      framing: selectedStoryboard.framing,
      cta: subtitleCta,
      materials,
      format: aspectRatio,
      duration: values.duration,
      resolution: values.resolution,
      editPrompt: values.editPrompt,
      motionSignature: selectedStoryboard.motionSignature,
      framingSignature: selectedStoryboard.framingSignature,
      workflowMode: selectedStoryboard.workflowMode,
    };
    const generationIntent = buildVideoEditorGenerationIntent(videoProjectCode, values.editPrompt);
    const materialReferenceMetadata = buildMaterialReferenceMetadata(materialReference);
    const primaryInput = `${values.duration} / ${values.resolution} / ${values.editPrompt}`;
    const nextStep = `${videoProjectCode}を動画ワークステーションで再利用し、動画providerの利用可能確認後にレンダーへ進める`;

    try {
      const { projectId } = handoffWorkspaceToCanvas({
        brandId: currentBrand.id,
        scopeId: user?.id,
        featureType: 'video-workstation',
        projectName: `Video Workstation: ${videoProjectCode}`,
        title: `Video Workstation: ${videoProjectCode}`,
        prompt: values.editPrompt,
        imageUrl: previewImageUrl,
        summary: `動画修正 ${values.duration} / ${values.resolution}`,
        note: values.referenceName ? `参考画像: ${values.referenceName}` : '参考画像なし',
        activeChoice: '編集',
        progress: Math.max(progress, 68),
        history: [`動画編集内容を保存: ${values.duration} / ${values.resolution}`],
        workflow: {
          workflowVersion: 'video-storyboard-local-v1',
          inputs: {
            videoProjectCode,
            editPrompt: values.editPrompt,
            duration: values.duration,
            resolution: values.resolution,
            referenceName: values.referenceName,
            selectedVideoStoryboard: selectedVideoStoryboardMetadata,
            materialReference: materialReferenceMetadata,
          },
          plan: {
            videoEditor: 'video-source-editor-parity',
            selectedVideoStoryboard: selectedVideoStoryboardMetadata,
            materialReference: materialReferenceMetadata,
            preview: {
              previewKind: 'deterministic-svg',
              marker: 'video-source-editor-parity',
              imageUrl: previewImageUrl,
            },
            nextStep,
            searchTokens: ['video-source-editor-parity', videoProjectCode, values.duration, values.resolution],
          },
          status: 'planned',
          resumePath: '/flow/GenerateShortVideo/detail',
          handoffKind: 'local-workflow-intake',
          primaryInput,
          nextStep,
          providerRoute: 'unsupported',
          providerBlocker: videoProviderBlocker,
          generationIntent,
        },
        previewMetadata: {
          previewKind: 'deterministic-svg',
          marker: 'video-source-editor-parity',
          imageUrl: previewImageUrl,
          videoProjectCode,
          videoEditor: {
            editPrompt: values.editPrompt,
            duration: values.duration,
            resolution: values.resolution,
            referenceName: values.referenceName,
          },
          generationIntent,
        },
        selectedVideoStoryboard: selectedVideoStoryboardMetadata,
        materialReferences: [materialReferenceMetadata],
        metadata: {
          workspace: 'video',
          providerRoute: 'unsupported',
          providerBlocker: videoProviderBlocker,
          videoDraftArtifactId: persisted.artifact.id,
          generationIntent,
          searchTokens: ['video-source-editor-parity', 'video-workstation', videoProjectCode],
        },
      });
      toast.success('動画編集内容を保存し、Canvasへ渡しました');
      navigate(`/canvas/${projectId}`);
    } catch (error) {
      console.error('Failed to persist Video Source Editor handoff:', error);
      toast.error(error instanceof Error ? error.message : 'Canvas保存に失敗しました');
    }
  };

  const dismissVideoGuide = () => {
    try {
      window.localStorage.setItem(VIDEO_GUIDE_DISMISSED_STORAGE_KEY, 'true');
    } catch {
      // The source flow still works when local preference storage is unavailable.
    }
    setShowVideoGuide(false);
  };

  const handleInitialImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!imageUrl) return;
      setMaterialReference((current) => ({
        ...current,
        imageUrl,
        fileName: file.name,
      }));
    };
    reader.readAsDataURL(file);
  };

  if (showVideoGuide) {
    return (
      <div className="min-h-[calc(100vh-5rem)] bg-[#111719] px-4 py-10 text-white sm:px-8">
        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          <button
            type="button"
            data-testid="video-guide-show"
            onClick={dismissVideoGuide}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-left transition hover:border-cyan-300/60 hover:bg-white/[0.08]"
          >
            <span className="block text-lg font-semibold">ガイドを見る</span>
            <span className="mt-2 block text-sm text-neutral-400">ガイドを表示する</span>
          </button>
          <button
            type="button"
            data-testid="video-guide-skip"
            onClick={dismissVideoGuide}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-left transition hover:border-cyan-300/60 hover:bg-white/[0.08]"
          >
            <span className="block text-lg font-semibold">ガイドを表示しない</span>
            <span className="mt-2 block text-sm text-neutral-400">ガイド無しで開始します</span>
          </button>
        </div>
      </div>
    );
  }

  if (!materialReference.imageUrl) {
    return (
      <main className="video-source-empty-page relative dark min-h-[calc(100vh-50px)] overflow-hidden bg-[#171b1c] text-white">
        <div className="video-source-empty-dots pointer-events-none absolute inset-0" />
        <div className="video-source-empty-project-rail absolute left-4 top-6 z-10 flex w-[264px] flex-col gap-2 rounded-xl border border-white/10 bg-[#262a2b] p-2 text-neutral-200 shadow-xl">
          <div className="flex h-5 items-center text-sm text-neutral-400">動画ワークステーション</div>
          <div className="h-px w-full bg-white/10" />
          <Link to="/flow/GenerateShortVideo" aria-label="動画ワークステーションへ戻る" className="flex w-fit items-center gap-2 text-base text-neutral-400 hover:text-white"><ChevronRight className="h-5 w-5 rotate-180" />Untitled</Link>
        </div>
        <label
          data-testid="video-initial-image-dropzone"
          className="video-source-empty-upload absolute left-1/2 top-1/2 z-10 flex h-[534.28px] w-[768px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-[#262a2b] px-6 text-center transition hover:border-cyan-300/60"
        >
          <Upload className="h-10 w-10 text-white" />
          <span className="mt-5 text-sm text-neutral-200">ここをクリックまたはドラッグして画像を追加</span>
          <span className="mt-2 text-xs text-neutral-500">jpg、jpeg、png、webp形式の画像（最大20M）に対応</span>
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={handleInitialImage}
          />
        </label>
      </main>
    );
  }

  return (
    <VideoSourceEditorParity
      key={`${videoDraftArtifactId ?? persistedVideoDraft?.id ?? videoProjectCode}:${persistedVideoDraft?.createdAt ?? 'new'}`}
      imageUrl={materialReference.imageUrl}
      secondaryImageUrl={hasExistingVideoProject ? LIGHTCHAIN_VIDEO_REFERENCE_IMAGE : undefined}
      onImageChange={handleInitialImage}
      onBack={() => navigate('/flow/GenerateShortVideo')}
      initialValues={persistedVideoEditorState}
      onPersist={persistVideoEditorBestEffort}
      onHandoffToCanvas={handoffVideoEditorToCanvas}
    />
  );

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
              Video Workstation
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              商品動画の構成、編集、書き出し状態を、Canvas に渡せる動画ワークスペースです。
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
                  ? 'border-cyan-300 bg-cyan-300 text-neutral-950 dark:border-cyan-300 dark:bg-cyan-300 dark:text-neutral-950'
                  : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:border-cyan-300/50 hover:bg-white/[0.07]'
              }`}
            >
              {choice}
            </button>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">動画レーンを選ぶ</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                尺・比率・ショット順・CTAをまとめて決めます。動画providerがadmittedされるまで、生成はfail-closedです。
              </p>
            </div>
            <span className="w-fit rounded-full bg-cyan-300/15 px-3 py-1 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-300/30">
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
                      ? 'border-cyan-300 bg-cyan-300 text-neutral-950 ring-2 ring-cyan-300/20 dark:border-cyan-300 dark:bg-cyan-300 dark:ring-cyan-300/20'
                      : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:border-cyan-300/50 hover:bg-white/[0.07]'
                  }`}
                >
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    selected
                      ? 'bg-cyan-300 text-neutral-950'
                      : 'bg-white/[0.06] text-neutral-300'
                  }`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="mt-3 flex items-center justify-between gap-3 text-sm font-semibold text-neutral-950 dark:text-white">
                    {candidate.label}
                    {selected && <Check className="h-4 w-4 text-cyan-300 dark:text-cyan-300" />}
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
        data-testid="video-readiness-entry"
        className="mb-5"
      >
        <WorkspaceReadinessStrip
          eyebrow="LIGHTCHAIN PARITY / VIDEO START"
          title="ショット構成を決めてから、素材と書き出しへ進みます"
          description="動画は最初にストーリーボードを選び、比率・尺・CTAを確認します。素材が未選択でも構成の保存とCanvas handoffを先に進められます。"
            nextAction="構成 → 素材 → provider admission待ち / Canvas保存"
          steps={[
            { label: 'ストーリーボード', detail: selectedStoryboard.label, ready: Boolean(selectedStoryboard.id) },
            { label: '尺・比率', detail: `${duration} / ${aspectRatio}`, ready: Boolean(duration && aspectRatio) },
            { label: '素材', detail: materialReference.imageUrl ? '参照素材を選択済み' : '素材なしでも構成を保存できます', ready: Boolean(materialReference.imageUrl) },
            { label: '次の操作', detail: 'provider admission待ち / Canvasへ保存', ready: Boolean(currentBrand) },
          ]}
        />
      </section>
      <section
        data-testid="video-action-panel"
        className="glass-panel rounded-2xl border dark:border-cyan-300/30 border-cyan-300/35 bg-cyan-300/[0.08] p-5 dark:border-cyan-300/30 dark:bg-cyan-300/[0.08]"
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300 dark:text-cyan-300">
              Video flow
            </p>
            <h2 className="mt-2 text-xl font-semibold text-neutral-950 dark:text-white">
              ショット順、尺、CTAを決めて、provider admission待ちまたはCanvas仕上げへ進む
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
                  className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm"
                >
                  <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{item.label}</p>
                  <p className="mt-1 font-semibold text-neutral-900 dark:text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
          <div data-testid="video-next-actions" className="grid gap-2">
            <button
              type="button"
              disabled
              data-testid="video-generation-blocked"
              aria-disabled="true"
              title={videoProviderBlocker}
              className="btn-primary inline-flex cursor-not-allowed items-center justify-center gap-2 text-sm opacity-60"
            >
              <Film className="h-4 w-4" />
              動画生成（provider未接続）
              <ChevronRight className="h-4 w-4" />
            </button>
            <p data-testid="video-provider-blocker" className="rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs leading-5 text-amber-100">
              {videoProviderBlocker}。画像生成への代替は行いません。
            </p>
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
            title="動画ワークベンチ"
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
            <LightchainVideoImage
              src={previewImageUrl}
              alt="Video storyboard preview"
              testId="video-storyboard-preview-image"
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

type VideoSourceEditorHistory = {
  past: VideoSourceEditorValues[];
  present: VideoSourceEditorValues;
  future: VideoSourceEditorValues[];
};

type VideoSourceEditorAction =
  | { type: 'patch'; patch: Partial<VideoSourceEditorValues> }
  | { type: 'undo' }
  | { type: 'redo' };

const INITIAL_VIDEO_EDIT_PROMPT = '男性は歩かずそのままの位置で男女が目を見つめあい１回うなずく。そして正面を向いて笑顔で３秒微笑む';
const INITIAL_VIDEO_SOURCE_EDITOR_VALUES: VideoSourceEditorValues = {
  editPrompt: INITIAL_VIDEO_EDIT_PROMPT,
  duration: '5秒',
  resolution: '720P',
};

function videoSourceEditorReducer(
  state: VideoSourceEditorHistory,
  action: VideoSourceEditorAction,
): VideoSourceEditorHistory {
  if (action.type === 'patch') {
    const present = { ...state.present, ...action.patch };
    if (
      present.editPrompt === state.present.editPrompt
      && present.duration === state.present.duration
      && present.resolution === state.present.resolution
    ) {
      return state;
    }
    return {
      past: [...state.past, state.present].slice(-20),
      present,
      future: [],
    };
  }

  if (action.type === 'undo' && state.past.length > 0) {
    const previous = state.past[state.past.length - 1];
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future].slice(0, 20),
    };
  }

  if (action.type === 'redo' && state.future.length > 0) {
    const next = state.future[0];
    return {
      past: [...state.past, state.present].slice(-20),
      present: next,
      future: state.future.slice(1),
    };
  }

  return state;
}

function VideoSourceEditorParity({
  imageUrl,
  secondaryImageUrl,
  onImageChange,
  onBack,
  initialValues,
  onPersist,
  onHandoffToCanvas,
}: {
  imageUrl: string;
  secondaryImageUrl?: string;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBack: () => void;
  initialValues?: VideoSourceEditorPersistedState;
  onPersist?: (values: VideoSourceEditorPersistedState) => WorkspaceArtifactPersistenceResult | Promise<WorkspaceArtifactPersistenceResult>;
  onHandoffToCanvas?: (values: VideoSourceEditorPersistedState) => void | Promise<void>;
}) {
  const [editorHistory, dispatchEditor] = useReducer(videoSourceEditorReducer, {
    past: [],
    present: initialValues ?? INITIAL_VIDEO_SOURCE_EDITOR_VALUES,
    future: [],
  });
  const [referenceName, setReferenceName] = useState(initialValues?.referenceName ?? '');
  const [referencePreview, setReferencePreview] = useState(initialValues?.referencePreview ?? '');
  const [activeTool, setActiveTool] = useState<'select' | 'pan'>('select');
  const [zoom, setZoom] = useState(40);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isHandbookOpen, setIsHandbookOpen] = useState(false);
  const [isVideoExpanded, setIsVideoExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const mainImageInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const { editPrompt, duration, resolution } = editorHistory.present;
  const displayVideo = imageUrl && imageUrl !== LIGHTCHAIN_VIDEO_MAIN_IMAGE ? imageUrl : LIGHTCHAIN_VIDEO_SOURCE_RESULT;
  const displayReference = referencePreview || secondaryImageUrl || LIGHTCHAIN_VIDEO_SOURCE_NODE_IMAGE;
  const durationLabel = duration === '15秒' ? '00:15' : duration === '10秒' ? '00:10' : '00:05';
  const currentValues: VideoSourceEditorPersistedState = {
    editPrompt,
    duration,
    resolution,
    referenceName,
    referencePreview,
  };

  const handleReferenceChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReferenceName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const preview = typeof reader.result === 'string' ? reader.result : '';
      if (preview) setReferencePreview(preview);
    };
    reader.readAsDataURL(file);
  };

  const changeZoom = (direction: 'in' | 'out') => {
    setZoom((current) => Math.min(100, Math.max(20, current + (direction === 'in' ? 10 : -10))));
  };

  const handleSave = async () => {
    if (!onPersist || isSaving) return;
    setIsSaving(true);
    try {
      const result = await onPersist(currentValues);
      if (!result.ok) {
        toast.error('動画編集内容の保存確認に失敗しました');
        return;
      }
      toast.success('動画編集内容を保存しました');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="dark video-source-existing-page relative min-h-[calc(100vh-56px)] overflow-hidden bg-[#171b1c] text-white" data-testid="video-source-editor-parity">
      <div className="video-source-existing-dots pointer-events-none absolute inset-0" />
      <div className="video-source-existing-canvas absolute inset-0">
        <svg className="video-source-existing-edges pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <path d="M644 352 C700 352 705 300 748 300" />
          <path d="M643 565 C700 565 705 444 748 444" />
          <path d="M1150 310 C1085 310 1060 280 1030 280" />
        </svg>

        <div className="video-source-existing-node video-source-existing-upper-node"><LightchainVideoImage src={LIGHTCHAIN_VIDEO_SOURCE_NODE_IMAGE} alt="imgResult" fallbackLabel="参照素材" /></div>
        <div className="video-source-existing-node video-source-existing-right-node"><LightchainVideoImage src={LIGHTCHAIN_VIDEO_SOURCE_NODE_IMAGE} alt="imgResult" fallbackLabel="参照素材" /></div>
        <div className="video-source-existing-node video-source-existing-left-node"><LightchainVideoImage src={LIGHTCHAIN_VIDEO_SOURCE_RESULT} alt="videoResult" fallbackLabel="動画素材" /></div>
        <div className="video-source-existing-node video-source-existing-main-node" style={{ transform: `scale(${zoom / 40})`, transformOrigin: 'top center' }}>
          <LightchainVideoImage src={displayVideo} alt="videoResult" fallbackLabel="動画プレビュー" />
          <button type="button" aria-label="動画を開く" className="video-source-existing-expand" onClick={() => setIsVideoExpanded(true)}><ArrowUpRight size={16} /></button>
          <div className="video-source-existing-video-controls" aria-hidden="true"><span>▶</span><span>00:00 / {durationLabel}</span></div>
        </div>

        {isPanelOpen && <aside className="video-source-existing-edit-panel" aria-label="動画の修正">
          <div className="video-source-existing-edit-inner">
            <div className="video-source-existing-edit-heading">
              <div><p className="text-[16px] font-semibold text-white">動画の修正</p><p className="mt-1 text-[11px] text-[#a8b0b1]">AI動画のブラッシュアップで、動画のスタイル変更が簡単に実現できます</p></div>
              <button type="button" aria-label="閉じる" className="text-[#9da6a7]" onClick={() => setIsPanelOpen(false)}>×</button>
            </div>
            <div className="video-source-existing-tip"><Sparkles size={14} /> 参考動画をアップロードすると、動きとスタイルを再現できます</div>
            <div className="video-source-existing-preview-row"><LightchainVideoImage src={displayVideo} alt="動画の修正プレビュー" fallbackLabel="動画プレビュー" /><div><p className="text-[12px] text-white">Untitled</p><p className="mt-1 text-[10px] text-[#9da6a7]">動画を修正</p></div></div>
            <div className="video-source-existing-duration-row"><span>動画の長さ</span><span>{duration} · 00:00–{durationLabel}</span></div>
            <label className="video-source-existing-label" htmlFor="video-reference-upload">参考画像</label>
            <label htmlFor="video-reference-upload" className="video-source-existing-reference-upload"><LightchainVideoImage src={displayReference} alt="参考画像" fallbackLabel="参考画像" /><span>{referenceName || '画像を追加'}</span><ImagePlus size={15} /></label>
            <input ref={referenceInputRef} id="video-reference-upload" type="file" accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="sr-only" onChange={handleReferenceChange} />
            <div className="video-source-existing-label-row"><label className="video-source-existing-label" htmlFor="video-edit-prompt">修正指示</label><span>{editPrompt.length}/1000</span></div>
            <textarea id="video-edit-prompt" value={editPrompt} onChange={(event) => dispatchEditor({ type: 'patch', patch: { editPrompt: event.target.value } })} maxLength={1000} className="video-source-existing-prompt" />
            <div className="video-source-existing-select-row">
              <label>動画の長さ<select value={duration} onChange={(event) => dispatchEditor({ type: 'patch', patch: { duration: event.target.value } })}><option>5秒</option><option>10秒</option><option>15秒</option></select></label>
              <label>解像度<select value={resolution} onChange={(event) => dispatchEditor({ type: 'patch', patch: { resolution: event.target.value } })}><option>720P</option><option>1080P</option></select></label>
            </div>
            <button type="button" disabled data-testid="video-generation-blocked" aria-disabled="true" title="video_provider_not_admitted: 動画providerの利用可能状態が未確認です" data-lightchain-provider-route="unsupported" className="video-source-existing-generate">AI生成 <span>600</span></button>
            {(onPersist || onHandoffToCanvas) && <div className="video-source-existing-actions" aria-label="動画編集の保存操作">
              {onPersist && <button type="button" data-testid="video-draft-save" disabled={isSaving} onClick={() => void handleSave()}>保存</button>}
              {onHandoffToCanvas && <button type="button" data-testid="video-canvas-handoff" disabled={isSaving} onClick={() => void onHandoffToCanvas(currentValues)}>Canvasへ</button>}
            </div>}
          </div>
        </aside>}

        <aside className="video-source-existing-project-rail absolute left-4 top-6 z-30 w-[264px] overflow-hidden rounded-xl border bg-[#252b2d] text-sm text-neutral-200 shadow-xl">
          <div className="flex h-[35px] items-center border-b border-white/10 px-3 text-xs text-neutral-300">動画ワークステーション</div>
          <button type="button" onClick={onBack} className="flex h-[48px] w-full items-center px-3 text-left hover:bg-white/5"><span aria-hidden="true" className="mr-5 text-lg">‹</span>Untitled</button>
        </aside>

        <label htmlFor="video-main-image-upload" aria-label="アセット" title="アセット" className="video-source-existing-asset-trigger absolute left-4 top-[356px] z-30 flex size-12 cursor-pointer items-center justify-center rounded-lg border bg-[#252b2d] text-neutral-200 hover:bg-[#30383a]"><Layers size={19} /></label>
        <input ref={mainImageInputRef} id="video-main-image-upload" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="sr-only" onChange={onImageChange} />
        <div className="video-source-existing-points"><Sparkles size={14} /> 残り生成回数 <strong>9</strong></div>
        <div className="video-source-existing-task"><span><Layers size={14} /> タスク</span><span>0&nbsp;&nbsp;進行中⌃</span></div>
        <div className="video-source-existing-canvas-toolbar" role="toolbar" aria-label="キャンバスツール">
          <button type="button" aria-label="選択" aria-pressed={activeTool === 'select'} className={activeTool === 'select' ? 'is-active' : ''} onClick={() => setActiveTool('select')}><MousePointer2 size={17} /></button><button type="button" aria-label="移動" aria-pressed={activeTool === 'pan'} className={activeTool === 'pan' ? 'is-active' : ''} onClick={() => setActiveTool('pan')}><Hand size={17} /></button><button type="button" aria-label="画像を追加" onClick={() => mainImageInputRef.current?.click()}><ImagePlus size={17} /></button><button type="button" aria-label="元に戻す" onClick={() => dispatchEditor({ type: 'undo' })}><Undo2 size={17} /></button><button type="button" aria-label="やり直す" onClick={() => dispatchEditor({ type: 'redo' })}><Redo2 size={17} /></button>
        </div>
        <div className="video-source-existing-zoom-controls"><button type="button" aria-label="縮小" onClick={() => changeZoom('out')}><ZoomOut size={15} /></button><span>{zoom}%</span><button type="button" aria-label="拡大" onClick={() => changeZoom('in')}><ZoomIn size={15} /></button></div>
        <button type="button" aria-label="ハンドブック" className="video-source-existing-handbook" onClick={() => setIsHandbookOpen((open) => !open)}><BookOpen size={17} /></button><button type="button" aria-label="パネル" className="video-source-existing-panel-toggle" onClick={() => setIsPanelOpen(true)}><ImageIcon size={17} /></button>
        {isHandbookOpen && <div className="video-source-existing-handbook-popover" role="dialog" aria-label="ハンドブック">
          <div className="flex items-center justify-between gap-4"><strong>動画ワークステーション</strong><button type="button" aria-label="ハンドブックを閉じる" onClick={() => setIsHandbookOpen(false)}>×</button></div>
          <p className="mt-2">画像を追加し、修正指示と動画設定を確認してから生成へ進みます。</p>
        </div>}
      </div>
      {isVideoExpanded && <div className="video-source-existing-lightbox" role="dialog" aria-label="動画プレビュー">
        <button type="button" aria-label="動画プレビューを閉じる" className="video-source-existing-lightbox-close" onClick={() => setIsVideoExpanded(false)}>×</button>
        <LightchainVideoImage src={displayVideo} alt="動画プレビュー" fallbackLabel="動画プレビュー" />
        <p>{duration} · {resolution}</p>
      </div>}
    </main>
  );
}

export function VideoSourceEditorParityLegacy({
  imageUrl,
  secondaryImageUrl,
  onImageChange,
  onBack,
}: {
  imageUrl: string;
  secondaryImageUrl?: string;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBack: () => void;
}) {
  const [garmentReference, setGarmentReference] = useState('main');
  const [modelReference, setModelReference] = useState('main');
  const [referenceVideoName, setReferenceVideoName] = useState('');
  const [videoSettings, setVideoSettings] = useState('5s ｜ 720p ｜ Auto');

  return (
    <main
      className="dark relative min-h-[calc(100vh-56px)] overflow-hidden bg-[#101516] text-white"
      data-testid="video-source-editor-parity"
    >
      <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:radial-gradient(#4b5b5f_0.7px,transparent_0.7px)] [background-size:22px_22px]" />
      <div className="relative z-10 min-h-[calc(100vh-56px)] px-4 py-5">
        <div className="absolute left-4 top-5 z-20 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#252b2d] text-sm text-neutral-200 shadow-xl">
          <div className="border-b border-white/10 px-3 py-2 text-xs text-neutral-300">
            <span aria-hidden="true" className="mr-2 inline-block rounded bg-cyan-500/80 px-1.5 py-1 text-[10px] leading-none">🎬</span>
            動画ワークステーション
          </div>
          <button type="button" onClick={onBack} className="w-full px-3 py-4 text-left hover:bg-white/5">
            <span aria-hidden="true" className="mr-5 text-lg">‹</span>
            Untitled
          </button>
        </div>

        <div className="absolute right-4 top-5 rounded-xl border border-white/10 bg-[#252b2d] px-4 py-3 text-xs text-neutral-300 shadow-xl">
          ✨ 残り生成回数 <span className="ml-2 font-semibold text-white">9</span>
        </div>

        <div className="relative mt-[80px] min-h-[660px] rounded-2xl">
          {secondaryImageUrl && (
            <div className="absolute left-[29.7%] top-[239px] h-[375px] w-[300px] overflow-hidden rounded-[40px] bg-[#22282a] shadow-2xl">
              <LightchainVideoImage src={secondaryImageUrl} alt="imgResult" className="h-full w-full object-cover" fallbackLabel="参照素材" />
            </div>
          )}
          <div className="absolute left-[18.4%] top-0 z-10 h-[300px] w-[375px] overflow-hidden rounded-[40px] bg-[#202627] shadow-2xl">
            <LightchainVideoImage src={imageUrl} alt="imgResult" className="h-full w-full object-cover" fallbackLabel="メイン画像" />
            <span className="absolute right-3 top-3 rounded bg-black/35 px-2 py-1 text-sm text-white">↗</span>
          </div>

          <aside className="absolute left-[40.15%] top-[52px] z-20 w-[210px] origin-top scale-y-[0.87] rounded-[40px] border border-white/10 bg-[#252b2d] p-3 text-xs text-neutral-300 shadow-2xl">
            <p className="text-[11px] text-neutral-400">参考画像モード</p>
            <p className="mt-2 rounded-lg bg-gradient-to-r from-cyan-500/80 to-fuchsia-500/70 px-2 py-2 text-[11px] font-semibold text-white">
              ✨ 参考動画をアップロードしてワンクリックで再現
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-white/10 p-2">
              <LightchainVideoImage src={imageUrl} alt="メイン画像" className="h-7 w-7 rounded object-cover" fallbackLabel="素材" />
              <span>メイン画像</span>
            </div>
            <p className="mt-3 text-[11px] text-neutral-400">参照動画<span className="text-cyan-300">*</span></p>
            <label htmlFor="video-reference-upload" className="mt-1 flex min-h-[108px] cursor-pointer flex-col items-center justify-center rounded-lg bg-white/[0.06] px-2 text-center hover:bg-white/10">
              <span className="text-xl">♧</span>
              <span className="mt-2 text-[11px]">動画をアップロード</span>
              <span className="mt-1 text-[9px] text-neutral-500">MP4/MOV対応、2〜15秒、200MB以内</span>
              {referenceVideoName && <span className="mt-1 max-w-full truncate text-[9px] text-cyan-200">{referenceVideoName}</span>}
            </label>
            <input
              id="video-reference-upload"
              type="file"
              accept=".mp4,.mov,video/mp4,video/quicktime"
              className="sr-only"
              onChange={(event) => setReferenceVideoName(event.target.files?.[0]?.name ?? '')}
            />
            <p className="mt-3 text-[11px] text-neutral-400">参考画像設定</p>
            <fieldset className="mt-1 rounded-lg bg-white/[0.04] p-2">
              <legend className="text-[10px] text-neutral-400">商品画像参考</legend>
              <label className="mr-3 inline-flex items-center gap-1.5"><input type="radio" name="garment-reference" checked={garmentReference === 'main'} onChange={() => setGarmentReference('main')} />メイン画像</label>
              <label className="inline-flex items-center gap-1.5"><input type="radio" name="garment-reference" checked={garmentReference === 'video'} onChange={() => setGarmentReference('video')} />動画</label>
            </fieldset>
            <fieldset className="mt-2 rounded-lg bg-white/[0.04] p-2">
              <legend className="text-[10px] text-neutral-400">モデル参考</legend>
              <label className="mr-2 inline-flex items-center gap-1.5"><input type="radio" name="model-reference" checked={modelReference === 'main'} onChange={() => setModelReference('main')} />メイン画像</label>
              <label className="mr-2 inline-flex items-center gap-1.5"><input type="radio" name="model-reference" checked={modelReference === 'video'} onChange={() => setModelReference('video')} />動画</label>
              <label className="inline-flex items-center gap-1.5"><input type="radio" name="model-reference" checked={modelReference === 'none'} onChange={() => setModelReference('none')} />なし</label>
            </fieldset>
            <p className="mt-3 text-[11px] text-neutral-400">動画設定</p>
            <select value={videoSettings} onChange={(event) => setVideoSettings(event.target.value)} className="mt-1 w-full appearance-none rounded-lg bg-white/[0.05] px-2 py-2 text-[10px] text-neutral-200 outline-none">
              <option>5s ｜ 720p ｜ Auto</option>
              <option>10s ｜ 720p ｜ Auto</option>
              <option>15s ｜ 1080p ｜ Auto</option>
            </select>
            <button
              type="button"
              disabled
              data-testid="video-generation-blocked"
              aria-disabled="true"
              title="video_provider_not_admitted: 動画providerの利用可能状態が未確認です"
              data-lightchain-provider-route="unsupported"
              className="mt-3 w-full rounded-lg bg-cyan-300/85 px-2 py-2 text-[11px] font-semibold text-neutral-950 disabled:cursor-not-allowed"
            >
              AI生成 <span>600</span>
            </button>
          </aside>
        </div>

        <label htmlFor="video-main-image-upload" aria-label="アセット" title="アセット" className="absolute left-[21px] top-[361.5px] z-20 flex size-12 cursor-pointer items-center justify-center rounded-lg bg-[#252b2d] text-neutral-200 hover:bg-[#30383a]">
          <svg aria-hidden="true" className="size-5" viewBox="0 0 20 20" fill="none">
            <path d="M12.5289 1.08738C12.9681 0.648381 13.6641 0.621208 14.1353 1.00535L14.2271 1.08738L18.7583 5.61863C19.2267 6.08702 19.2263 6.84721 18.7583 7.31589L16.3228 9.75046L18.1988 11.6255C19.0186 12.4455 19.0175 13.7751 18.1978 14.5952L15.0865 17.7075C14.2664 18.5276 12.9359 18.5276 12.1158 17.7075L10.2408 15.8325L8.08257 17.9917L7.98393 18.0815C7.74135 18.2754 7.43025 18.3687 7.11772 18.3384L2.98784 17.936L2.88139 17.9214C2.39651 17.8301 2.01543 17.4483 1.92436 16.9634L1.91069 16.8579L1.50737 12.728C1.4771 12.4156 1.57138 12.1053 1.76518 11.8628L1.85405 11.7632L4.01225 9.60398L2.07475 7.66648C1.25497 6.84635 1.25476 5.51577 2.07475 4.69578L5.18706 1.58445C6.00718 0.764651 7.33776 0.764449 8.15776 1.58445L10.0943 3.52097L12.5289 1.08738ZM11.5142 14.5591L13.3892 16.4341C13.5064 16.5512 13.6959 16.5512 13.813 16.4341L16.9253 13.3227C17.0422 13.2056 17.0423 13.015 16.9253 12.8979L15.0503 11.0229L11.5142 14.5591ZM3.32768 12.8354L3.65385 16.1919L7.0103 16.518L13.2925 10.2368L9.60893 6.5532L3.32768 12.8354ZM10.8824 5.27976L14.566 8.96335L17.0611 6.46726L13.3785 2.78464L10.8824 5.27976ZM6.88432 2.85691C6.76714 2.74084 6.57657 2.74084 6.45952 2.85789L3.34819 5.96921C3.23114 6.08626 3.23136 6.27586 3.34819 6.39304L5.28569 8.33054L8.82182 4.79441L6.88432 2.85691Z" fill="currentColor" />
          </svg>
        </label>
        <input id="video-main-image-upload" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="sr-only" onChange={onImageChange} />
        <div className="absolute bottom-5 left-4 rounded-xl border border-white/10 bg-[#252b2d] px-4 py-3 text-xs text-neutral-300 shadow-xl">
          ▣ タスク <span className="ml-20">0 進行中⌃</span>
        </div>
        <div className="absolute bottom-[49px] left-1/2 flex -translate-x-1/2 gap-1 rounded-xl border border-white/10 bg-[#252b2d] p-2 text-2xl text-neutral-300 shadow-xl">
          <button type="button" aria-label="選択" className="size-9 rounded-lg bg-white/10 p-2 text-sm">▷</button>
          <button type="button" aria-label="移動" className="size-9 rounded-lg p-2 text-sm hover:bg-white/10">✋</button>
          <button type="button" aria-label="画像を追加" className="size-9 rounded-lg p-2 text-sm hover:bg-white/10">▧</button>
          <button type="button" aria-label="元に戻す" className="size-9 rounded-lg p-2 text-sm hover:bg-white/10">↶</button>
          <button type="button" aria-label="やり直す" className="size-9 rounded-lg p-2 text-sm hover:bg-white/10">↷</button>
        </div>
        <div className="absolute bottom-5 right-4 rounded-xl border border-white/10 bg-[#252b2d] px-4 py-3 text-xs text-neutral-300 shadow-xl">⌕ 30% ⌄ ⌕</div>
      </div>
    </main>
  );
}
