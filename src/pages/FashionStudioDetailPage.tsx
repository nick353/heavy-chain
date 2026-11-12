import {
  BookOpen,
  BookMarked,
  Boxes,
  ChevronDown,
  ChevronRight,
  Download,
  Keyboard,
  LayoutGrid,
  ChevronLeft,
  Hand,
  ImagePlus,
  Magnet,
  MapPinned,
  Maximize2,
  Moon,
  MousePointer2,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Search,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { studioProviderPrompt } from '../lib/studioFunctionPrompt';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { cloudflareDataPlane, type ArtifactPersistenceContext } from '../lib/cloudflareApi';
import { resolveGeneratedImageUrlWithStatus } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import { canSelectConfirmedBrand } from '../lib/authBrandSelection';
import { createFashionStudioThumbnailController, fashionStudioThumbnailScopeKey, type FashionStudioThumbnailState } from '../lib/fashionStudioThumbnails';
import { createFashionStudioDetailHydration, emptyFashionStudioDetail, extractFashionStudioSavedDetail, fashionStudioDetailScopeKey, type FashionStudioDetailHydrationState, type FashionStudioDetailScope } from '../lib/fashionStudioDetailHydration';
import { createFashionStudioInputController, createFashionStudioGenerationAdapters, readFashionStudioUpload, type FashionStudioInputRole, type FashionStudioInputState } from '../lib/fashionStudioDetailAdapter';
import { createFashionStudioDetailGeneration, type FashionStudioGenerationOutcome } from '../lib/fashionStudioDetailGeneration';
import { createStudioAckStore } from '../lib/fashionStudioPendingAck';
import { createCanvasDocument, getCanvasDocument, updateCanvasDocument, type CanvasDocumentRecord } from '../lib/canvasDocumentPersistence';
import { editImageWithPrompt, assertCompletedImageEditResult } from '../lib/imageApi';
import { persistProviderResultArtifact } from '../lib/providerResultPersistence';
import { createStudioViewportInteraction, STUDIO_DEFAULT_VIEWPORT, STUDIO_INTERACTIVE_SELECTOR, studioWorldTransform, type StudioViewportState } from '../lib/studioViewport';
import { arrangeStudioNodes, emptyStudioHistory, fitStudioArrangedView, pushStudioHistory, readStudioLayout, readStudioSnapEnabled, redoStudioHistory,
  sameStudioPositions, steppedStudioZoom, studioEdgePath, studioNodePositions, studioSnap, undoStudioHistory, withStudioLayout, writeStudioSnapEnabled,
  LIGHT_UNITS_PER_HEAVY, STUDIO_ZOOM_LIMITS, type StudioHistory, type StudioNodeSpec, type StudioPoint, type StudioPositions, type StudioRect,
  type StudioSnapLine } from '../lib/studioCanvas';
import { DEFAULT_STUDIO_SETTINGS, STUDIO_ASPECT_RATIOS, STUDIO_EXAMPLES, STUDIO_FLUX_MAX_REFERENCES, STUDIO_QUALITIES, closestStudioAspectRatio, studioFluxRedrawPlan, STUDIO_GARMENT_AREAS, STUDIO_MAX_REGION_POINTS, STUDIO_MAX_TEXT_REFERENCES, STUDIO_PERSPECTIVES, STUDIO_TEXT_SAMPLE_PROMPT,
  STUDIO_UNDERWEAR_NO_MODEL_PROMPT, STUDIO_UNDERWEAR_WITH_MODEL_PROMPT, loadStudioExampleFile, readStudioSettings, studioAspectRatioLabel,
  studioEditOptions, studioFunctionPromptText, writeStudioSettings, type StudioAspectRatio, type StudioFunctionId, type StudioGarmentArea, type StudioQuality, type StudioSettings } from '../lib/fashionStudioExamples';
import { buildRegionGuideUrl, naturalImageSize, regionMaskImageData, regionMaskToDataUrl } from '../lib/fashionStudioRegionGuide';
import { MaskPaintDialog } from '../components/lightchain/MaskPaintDialog';
import { studioExampleHoldUrls, studioExamplePreviewRoles, withStudioExamplePreview, type StudioExamplePreview } from '../lib/fashionStudioExamplePreview';
import { StudioFunctionIcon } from '../components/lightchain/StudioFunctionIcon';
import { StudioHelpDialog, StudioMinimap, StudioShortcutsPanel, StudioZoomControl } from '../components/lightchain/StudioCanvasControls';
import { StudioFeedbackBar } from '../components/lightchain/StudioFeedbackBar';

const FASHION_STUDIO_PROJECT_ICON = '/lightchain-assets/icons/fashion-studio.png';

/** Light's four Fashion Studio entry functions; choosing one loads its example (src/lib/fashionStudioExamples.ts). */
const STUDIO_FUNCTIONS: readonly { id: StudioFunctionId; label: string; badge?: string; banner: string }[] = [
  { id: 'text', label: 'テキストで生成', banner: '指令と参考画像を使ってワンクリック生成' },
  // Light allows up to three fusion points per main image; Heavy's project keeps one reference image, so one point.
  { id: 'region', label: '範囲指定で生成', banner: 'メイン画像1枚につき、最大3か所の定向融合が可能です' },
  { id: 'underwear', label: '下着のフィッティング', badge: 'NEW', banner: 'インナーフィッティング専用ツール' },
  { id: '3d', label: '3D画像に変換', banner: '指定した領域を3D画像に変換する' },
];
const studioFunctionKey = (projectId: string) => `heavy-fashion-studio-function:${projectId}`;
const readStudioFunction = (projectId: string): StudioFunctionId => {
  try {
    const value = projectId ? window.localStorage.getItem(studioFunctionKey(projectId)) : null;
    return STUDIO_FUNCTIONS.some((item) => item.id === value) ? value as StudioFunctionId : 'text';
  } catch { return 'text'; }
};
/** The example's function, settings, instruction and sample mask, written for the project its upload just created, so the
 * first frame of that project already matches the example shown while it was being saved. */
const primeExampleProject = (projectId: string, fn: StudioFunctionId) => {
  try {
    window.localStorage.setItem(studioFunctionKey(projectId), fn);
    const sample = examplePrompt(fn); const draftKey = `heavy-fashion-studio-draft:${projectId}`;
    if (sample && !window.localStorage.getItem(draftKey)) window.localStorage.setItem(draftKey, sample);
    if (fn === 'region' && !window.localStorage.getItem(regionMaskKey(projectId, 0))) window.localStorage.setItem(regionMaskKey(projectId, 0), REGION_EXAMPLE_MASK);
  } catch { /* storage unavailable */ }
  writeStudioSettings(projectId, { ...readStudioSettings(projectId), example: fn });
};
const examplePrompt = (fn: StudioFunctionId) => fn === 'text' ? STUDIO_TEXT_SAMPLE_PROMPT : fn === 'underwear' ? STUDIO_UNDERWEAR_WITH_MODEL_PROMPT : '';
const regionMaskKey = (projectId: string, slot = 0) => `heavy-fashion-studio-region-mask:${projectId}${slot ? `:slot${slot}` : ''}`;
const REGION_EXAMPLE_MASK = '/lightchain-assets/flow-examples/directional-mask.png';
const FLOW_TIP_ICON = '/lightchain-assets/static/flow_tip.png';
const SAVED_PROMPTS_KEY = 'heavy-fashion-studio-saved-prompts';
const STUDIO_EXAMPLE_LOADED = 'サンプルを読み込むと、ノードの構成を変更できます。';
const STUDIO_EXAMPLE_FAILED = 'サンプルの読み込みに失敗しました。もう一度お試しください。';
/** Light's flow (measured at its 45% fit, 2026-11-11): image nodes 448px wide (CSS), the form 310px; the gaps and the
 * free positions live in src/lib/studioCanvas.ts. */
const IMAGE_NODE_WIDTH = 448;
const FORM_NODE_WIDTH = 310;
/** Light's editor setting shared with the design editor (DesignEntryDetailPage): ライトモードに切り替え. */
const EDITOR_THEME_KEY = 'heavy-editor-theme:v1';
const readEditorTheme = (): 'dark' | 'light' => { try { return window.localStorage.getItem(EDITOR_THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
/** A press on these inside a node uses the control instead of dragging the node. */
const NODE_DRAG_BLOCKER = 'input, textarea, select, button, a, label, [contenteditable="true"], [role="button"], [role="listbox"], [role="menu"], [role="option"], [data-studio-chrome]';
const isTypingTarget = (target: EventTarget | null) => target instanceof HTMLElement
  && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
/** React Flow moves a selected node 5 units per arrow press (×4 with Shift); in Heavy units. */
const ARROW_STEP = 5 / LIGHT_UNITS_PER_HEAVY;
const resultNodeKey = (objectId: string | null, index: number) => objectId ? `result:${objectId}` : `result-index:${index}`;
const STUDIO_NEW_PROJECT_FUNCTIONS: readonly StudioFunctionId[] = ['text', 'region', 'underwear', '3d'];

/** Light's marks for 画質: a lightning bolt for 1K (快速), HD for 2K and 4K for 4K, each in the same rounded frame. */
function StudioQualityMark({ quality }: { quality: StudioQuality }) {
  const frame = 'flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[10px] border-[3px] border-current font-bold';
  if (quality === '1k') return <span aria-hidden="true" data-quality-mark="quick" className={frame}><Zap className="h-6 w-6" strokeWidth={2.5} /></span>;
  return <span aria-hidden="true" data-quality-mark={quality} className={`${frame} text-[18px]`}>{quality === '4k' ? '4K' : 'HD'}</span>;
}
function DetailRoleImage({ candidates, scopeKey, role, alt, className, assertContext, onReady, holdUrl }: {
  candidates: readonly string[]; scopeKey: string; role: string; alt: string; className: string; assertContext: () => void; onReady?: (url: string) => void;
  /** Drawn while the saved copy's address is being resolved (the example image it replaces), so the switch does not blink. */
  holdUrl?: string;
}) {
  const imageScope = fashionStudioThumbnailScopeKey(null, `${scopeKey}:${role}`, candidates);
  const currentImageScopeRef = useRef(imageScope);
  currentImageScopeRef.current = imageScope;
  const [image, setImage] = useState<FashionStudioThumbnailState | null>(null);
  const controllerRef = useRef<ReturnType<typeof createFashionStudioThumbnailController> | null>(null);
  const assertRef = useRef(assertContext);
  assertRef.current = assertContext;
  useEffect(() => {
    const [, identity, sources] = JSON.parse(imageScope) as [null, string, string[]];
    const assertAttemptContext = assertRef.current;
    const controller = createFashionStudioThumbnailController(async (source) => {
      assertAttemptContext();
      const result = await resolveGeneratedImageUrlWithStatus(source);
      assertAttemptContext();
      return result;
    }, setImage);
    controllerRef.current = controller;
    controller.reset(null, identity, sources);
    return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; };
  }, [imageScope]);
  const current = image?.scopeKey === imageScope ? image : null;
  const event = (kind: 'load' | 'error') => {
    try {
      if (currentImageScopeRef.current !== imageScope) return;
      assertRef.current();
      if (current) {
        if (kind === 'load') { controllerRef.current?.onLoad(current); onReady?.(current.url!); }
        else { controllerRef.current?.onError(current); onReady?.(''); }
      }
    } catch { /* prior context cannot affect the current image */ }
  };
  return current?.url ? <img key={`${imageScope}:${current.attempt}`} src={current.url} alt={alt} loading="eager"
    className={className} data-image-status={current.status} onLoad={() => event('load')} onError={() => event('error')} />
    : holdUrl ? <img src={holdUrl} alt={alt} className={className} data-image-status="example" />
    : <span className={`${className} inline-flex items-center justify-center text-neutral-400`} role="status">{alt}なし</span>;
}

function FashionStudioImageNode({
  candidates,
  scopeKey,
  role,
  assertContext,
  alt,
  className,
  testId,
  objectId,
  selected,
  label,
  staticUrl,
  onExpand,
  onUrl,
  holdUrl,
}: {
  candidates: readonly string[];
  scopeKey: string;
  role: 'main' | 'result';
  assertContext: () => void;
  alt: string;
  className: string;
  testId: string;
  objectId: string | null;
  selected: boolean;
  /** Light writes 仕上がりのサンプルをご覧ください。 above the example result. */
  label?: string;
  /** A bundled example image instead of a saved role. */
  staticUrl?: string;
  onExpand: (url: string) => void;
  /** The shown image's URL, for the node toolbar (ダウンロード, 新しい機能). */
  onUrl?: (url: string) => void;
  holdUrl?: string;
}) {
  const [url, setUrl] = useState('');
  const shown = staticUrl || url;
  return (
    <>
      {label && <p className="fashion-studio-flow-node-label">{label}</p>}
      <figure className={`fashion-studio-source-image-node ${className}`} data-testid={testId} data-studio-object-id={objectId ?? undefined} data-selected={selected} onDragStart={event => event.preventDefault()}>
        {staticUrl ? <img src={staticUrl} alt={alt} className="block h-auto w-full" draggable={false} />
          : <DetailRoleImage candidates={candidates} scopeKey={scopeKey} role={role} assertContext={assertContext} alt={alt} className="block h-auto min-h-[200px] w-full object-contain" holdUrl={holdUrl} onReady={value => { setUrl(value); onUrl?.(value); }} />}
        <button type="button" className="fashion-studio-source-expand" aria-label="全画面表示です" title="全画面表示" disabled={!shown} onClick={() => shown && onExpand(shown)}>
          <Maximize2 className="h-5 w-5" />
        </button>
      </figure>
    </>
  );
}

/**
 * Light Chain uses the same deep-link for a new file and an existing project,
 * but the existing-project state exposes the image-search workbench. Keep the
 * empty upload canvas for the new-file URL and render the observed project
 * shell when a board project code is present.
 */
const STUDIO_FLUX_REDRAW_NOTICE = 'OpenAI の安全確認で断られたため、FLUX.2 で作り直しています';
/** Readable messages for the task chip's failures (raw codes such as cloudflare_api_403_legal_safety_prompt_blocked). */
export function studioErrorMessage(error: string) {
  if (/legal_safety_prompt_blocked/.test(error)) return '指示テキストに、人物の顔・有名人・ブランドの模倣と判断される言葉が含まれています。言い回しを変えてお試しください。';
  if (/rights_confirmation_required/.test(error)) return '画像の利用権限を確認できませんでした。もう一度お試しください。';
  if (/quota|insufficient|points?_/.test(error)) return 'ポイントが不足しています。';
  if (/timeout|timed_out/.test(error)) return '生成に時間がかかっています。しばらくしてから結果を確認してください。';
  if (/moderation_blocked/.test(error)) return '画像のAIの安全確認で断られました。肌の多い画像は断られることがあります。画像や指示を変えてお試しください。';
  if (/image_provider_transport_uncertain|transport/.test(error)) return '画像のAIとの通信が途中で切れました。もう一度「AI生成」を押してください。';
  // Messages the pipeline already writes for people (e.g. 同じ入力の生成依頼が未照合です) are shown as they are.
  if (/[ぁ-んァ-ヶ一-龠]/.test(error)) return error;
  return '処理に失敗しました。もう一度お試しください。';
}

export function FashionStudioDetailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, currentBrand, brandState } = useAuthStore();
  const [hydration, setHydration] = useState<FashionStudioDetailHydrationState | null>(null);
  const [promptDraft, setPromptDraft] = useState({ scopeKey: '', value: '' });
  const [upload, setUpload] = useState<(FashionStudioInputState & { scopeKey: string }) | null>(null);
  // The upload holds busyRef from the first moment, before its own status says 保存中; the form shows it as busy too, so
  // AI生成 never looks pressable while a click would be ignored (2026-11-12 production: a click 4s after adding a
  // reference did nothing).
  const [uploadingScope, setUploadingScope] = useState('');
  // 下着のフィッティング dresses a real person's photo: the brand declares it may use the photo and has the person's consent.
  const [innerwearConsent, setInnerwearConsent] = useState(false);
  /** The FLUX.2 redraw of a refused テキストで生成 asks for the rights/consent declaration when it sends references. */
  const [fluxConsent, setFluxConsent] = useState<{ trimmed: boolean; checked: boolean } | null>(null);
  const fluxConsentResolveRef = useRef<((value: boolean) => void) | null>(null);
  const askFluxConsent = (trimmed: boolean) => new Promise<boolean>(resolve => {
    fluxConsentResolveRef.current?.(false);
    fluxConsentResolveRef.current = resolve; setFluxConsent({ trimmed, checked: false });
  });
  const answerFluxConsent = (value: boolean) => { const resolve = fluxConsentResolveRef.current; fluxConsentResolveRef.current = null; setFluxConsent(null); resolve?.(value); };
  useEffect(() => () => { fluxConsentResolveRef.current?.(false); fluxConsentResolveRef.current = null; }, []);
  const [generation, setGeneration] = useState<(FashionStudioGenerationOutcome & { scopeKey: string }) | null>(null);
  const [activity, setActivity] = useState({ scopeKey: '', value: '' });
  const [loadedMain, setLoadedMain] = useState({ identity: '', url: '' });
  const mainInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const uploadControllerRef = useRef<ReturnType<typeof createFashionStudioInputController> | null>(null);
  const generationControllerRef = useRef<ReturnType<typeof createFashionStudioDetailGeneration> | null>(null);
  const busyRef = useRef(false);
  const logicalAttemptRef = useRef<{ identity: string; key: string } | null>(null);
  const projectCode = searchParams.get('boardProjectCode') ?? '';
  /** The example being shown while its project is saved (see fashionStudioExamplePreview). */
  const [examplePreview, setExamplePreview] = useState<StudioExamplePreview | null>(null);
  const previewActive = examplePreview?.projectCode === projectCode;
  const previewActiveRef = useRef(previewActive);
  previewActiveRef.current = previewActive;
  const hasProject = Boolean(projectCode) || previewActive;
  const scope: FashionStudioDetailScope | null = user?.id && currentBrand?.id
    && canSelectConfirmedBrand(brandState, user.id, currentBrand.id)
    ? { userId: user.id, brandId: currentBrand.id, documentId: projectCode, generation: brandState.requestGeneration } : null;
  const scopeKey = scope ? fashionStudioDetailScopeKey(scope) : '';
  const currentScopeRef = useRef(scopeKey);
  currentScopeRef.current = scopeKey;
  const viewportRef = useRef<HTMLElement>(null);
  const viewportInteractionRef = useRef<ReturnType<typeof createStudioViewportInteraction> | null>(null);
  const viewportScopeKey = JSON.stringify([scopeKey, projectCode]);
  const [localViewport, setLocalViewport] = useState<{ scopeKey: string; state: StudioViewportState }>({ scopeKey: '', state: {
    view: { ...STUDIO_DEFAULT_VIEWPORT }, mode: 'select', selectedObjectId: null, panning: false,
  } });
  const viewportState: StudioViewportState = localViewport.scopeKey === viewportScopeKey ? localViewport.state : {
    view: { ...STUDIO_DEFAULT_VIEWPORT }, mode: 'select', selectedObjectId: null, panning: false,
  };
  const interactiveTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(STUDIO_INTERACTIVE_SELECTOR));
  const viewportCenter = () => { const bounds = viewportRef.current?.getBoundingClientRect(); return { x: (bounds?.width ?? 0) / 2, y: (bounds?.height ?? 0) / 2 }; };
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!hasProject || !viewport) return;
    const interaction = createStudioViewportInteraction({
      publish: state => setLocalViewport({ scopeKey: viewportScopeKey, state }),
      capture: id => viewport.setPointerCapture(id),
      release: id => { if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id); },
      zoomLimits: STUDIO_ZOOM_LIMITS,
    });
    viewportInteractionRef.current = interaction; interaction.reset();
    // Native non-passive wheel handling permits preventDefault only for canvas navigation.
    const wheel = (event: WheelEvent) => {
      const bounds = viewport.getBoundingClientRect();
      if (interaction.wheel({ ...event, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey, metaKey: event.metaKey, interactive: interactiveTarget(event.target),
        anchor: { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, pageHeight: bounds.height })) event.preventDefault();
    };
    const blur = () => interaction.cancel();
    viewport.addEventListener('wheel', wheel, { passive: false }); window.addEventListener('blur', blur);
    return () => { viewport.removeEventListener('wheel', wheel); window.removeEventListener('blur', blur); interaction.dispose();
      if (viewportInteractionRef.current === interaction) viewportInteractionRef.current = null; };
  }, [viewportScopeKey, hasProject]);
  const assertContext = () => {
    const live = useAuthStore.getState();
    if (!scope || currentScopeRef.current !== scopeKey || live.user?.id !== scope.userId || live.currentBrand?.id !== scope.brandId
      || live.brandState.requestGeneration !== scope.generation
      || !canSelectConfirmedBrand(live.brandState, scope.userId, scope.brandId)) throw new Error('fashion_studio_detail_scope_stale');
  };

  useEffect(() => {
    if (!scopeKey || !projectCode || !cloudflareDataPlane) return;
    const requested = JSON.parse(scopeKey) as FashionStudioDetailScope;
    const loader = createFashionStudioDetailHydration({
      getDocument: (documentId, context) => {
        if (!cloudflareDataPlane) return Promise.reject(new Error('fashion_studio_detail_unavailable'));
        return cloudflareDataPlane.getCanvasDocument(documentId, context);
      },
      getUsage: (brandId) => {
        if (!cloudflareDataPlane) return Promise.reject(new Error('fashion_studio_usage_unavailable'));
        return cloudflareDataPlane.getImageUsage(brandId);
      },
      assertScope: (expected) => {
        const live = useAuthStore.getState();
        if (currentScopeRef.current !== fashionStudioDetailScopeKey(expected) || live.user?.id !== expected.userId || live.currentBrand?.id !== expected.brandId
          || live.brandState.requestGeneration !== expected.generation
          || !canSelectConfirmedBrand(live.brandState, expected.userId, expected.brandId)) throw new Error('fashion_studio_detail_scope_stale');
      },
      publish: setHydration,
    });
    void loader.load(requested);
    return () => loader.dispose();
  }, [scopeKey]);
  const visible = scopeKey && hydration?.scopeKey === scopeKey ? hydration : null;
  const detail = visible?.status === 'success' ? visible.detail : emptyFashionStudioDetail();
  const committedInputsRef = useRef(detail);
  committedInputsRef.current = detail;
  const promptDraftKey = projectCode ? `heavy-fashion-studio-draft:${projectCode}` : '';
  const storedDraft = (() => { try { return promptDraftKey ? window.localStorage.getItem(promptDraftKey) ?? '' : ''; } catch { return ''; } })();
  // The instruction survives reloads per project until a generation records it on the canvas.
  const prompt = promptDraft.scopeKey === scopeKey ? promptDraft.value : (storedDraft || detail.prompt);
  const setPrompt = (value: string) => {
    setPromptDraft({ scopeKey, value });
    try { if (promptDraftKey) window.localStorage.setItem(promptDraftKey, value); } catch { /* storage unavailable */ }
  };
  const [studioFunction, setStudioFunction] = useState<StudioFunctionId>(() => readStudioFunction(projectCode));
  const studioFunctionRef = useRef(studioFunction);
  studioFunctionRef.current = studioFunction;
  const studioFunctionInfo = STUDIO_FUNCTIONS.find((item) => item.id === studioFunction) ?? STUDIO_FUNCTIONS[0];
  const [settingsState, setSettingsState] = useState<{ projectCode: string; value: StudioSettings }>({ projectCode: '', value: DEFAULT_STUDIO_SETTINGS });
  const settings = settingsState.projectCode === projectCode ? settingsState.value : readStudioSettings(projectCode);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const updateSettings = (patch: Partial<StudioSettings>) => {
    const next = { ...settings, ...patch }; writeStudioSettings(projectCode, next); setSettingsState({ projectCode, value: next });
  };
  /** The example chosen on the new-file screen; the project created by its upload picks it up. */
  const pendingExampleRef = useRef<StudioFunctionId | null>(null);
  /** The function a node toolbar button chose; the new project its image creates opens on that function. */
  const pendingFunctionRef = useRef<StudioFunctionId | null>(null);
  const [pendingExample, setPendingExample] = useState<{ projectCode: string; fn: StudioFunctionId } | null>(null);
  const exampleReferenceStartedRef = useRef('');
  const [exampleLoad, setExampleLoad] = useState<{ scopeKey: string; loading: StudioFunctionId | null; failed: StudioFunctionId | null }>({ scopeKey: '', loading: null, failed: null });
  const exampleState = exampleLoad.scopeKey === scopeKey ? exampleLoad : { loading: null, failed: null };
  // Light's 範囲指定で生成 has up to three fusion points; each point is one reference slot (0-2) with its own mask.
  const [regionMaskState, setRegionMaskState] = useState<{ projectCode: string; urls: Record<number, string> }>({ projectCode: '', urls: {} });
  const regionMaskFor = (slot: number) => {
    if (regionMaskState.projectCode === projectCode && slot in regionMaskState.urls) return regionMaskState.urls[slot];
    try { return projectCode ? window.localStorage.getItem(regionMaskKey(projectCode, slot)) ?? '' : ''; } catch { return ''; }
  };
  const regionMaskUrl = regionMaskFor(0);
  const setRegionMask = (url: string, slot = 0) => {
    try { if (url) window.localStorage.setItem(regionMaskKey(projectCode, slot), url); else window.localStorage.removeItem(regionMaskKey(projectCode, slot)); } catch { /* storage unavailable */ }
    setRegionMaskState(current => ({ projectCode, urls: { ...(current.projectCode === projectCode ? current.urls : {}), [slot]: url } }));
  };
  const [maskDialog, setMaskDialog] = useState<{ initial: ImageData | null; slot: number } | null>(null);
  /** Which reference slot the reference file picker writes to (Light: add a reference / a fusion point, or replace one). */
  const referenceTargetRef = useRef<FashionStudioInputRole>('reference');
  const [loadedReference, setLoadedReference] = useState({ identity: '', url: '' });
  const providerContextRef = useRef({ hasReference: false, referenceCount: 0, points: 1 });
  const [lightbox, setLightbox] = useState('');
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<string[]>(() => {
    try { const value = JSON.parse(window.localStorage.getItem(SAVED_PROMPTS_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 50) : []; }
    catch { return []; }
  });
  useEffect(() => {
    if (!projectCode) return;
    const nodeFunction = pendingFunctionRef.current;
    if (nodeFunction) {
      pendingFunctionRef.current = null;
      try { window.localStorage.setItem(studioFunctionKey(projectCode), nodeFunction); } catch { /* storage unavailable */ }
      setStudioFunction(nodeFunction);
      if (nodeFunction === 'underwear') {
        setPromptDraft({ scopeKey, value: STUDIO_UNDERWEAR_NO_MODEL_PROMPT });
        try { window.localStorage.setItem(`heavy-fashion-studio-draft:${projectCode}`, STUDIO_UNDERWEAR_NO_MODEL_PROMPT); } catch { /* storage unavailable */ }
      }
      return;
    }
    const chosen = pendingExampleRef.current;
    if (chosen) {
      pendingExampleRef.current = null;
      try { window.localStorage.setItem(studioFunctionKey(projectCode), chosen); } catch { /* storage unavailable */ }
      setStudioFunction(chosen);
      const next = { ...readStudioSettings(projectCode), example: chosen };
      writeStudioSettings(projectCode, next); setSettingsState({ projectCode, value: next });
      const sample = examplePrompt(chosen);
      if (sample) {
        setPromptDraft((current) => current.value ? current : { scopeKey, value: sample });
        try { if (!window.localStorage.getItem(`heavy-fashion-studio-draft:${projectCode}`)) window.localStorage.setItem(`heavy-fashion-studio-draft:${projectCode}`, sample); } catch { /* storage unavailable */ }
      }
      setPendingExample({ projectCode, fn: chosen });
      return;
    }
    setStudioFunction(readStudioFunction(projectCode));
  }, [projectCode, scopeKey]);
  useEffect(() => {
    if (!scopeKey || !cloudflareDataPlane) return;
    const requested = JSON.parse(scopeKey) as FashionStudioDetailScope;
    const assertAttempt = () => {
      const live = useAuthStore.getState();
      if (currentScopeRef.current !== scopeKey || live.user?.id !== requested.userId || live.currentBrand?.id !== requested.brandId
        || live.brandState.requestGeneration !== requested.generation || !canSelectConfirmedBrand(live.brandState, requested.userId, requested.brandId)) throw new Error('fashion_studio_detail_scope_stale');
    };
    const publishDocument = (document: CanvasDocumentRecord) => {
      assertAttempt();
      setHydration(previous => ({ scopeKey, status: 'success', title: document.title,
        detail: extractFashionStudioSavedDetail(document.snapshot), remainingUnits: previous?.scopeKey === scopeKey ? previous.remainingUnits : null }));
    };
    const uploadContexts = new Map<string, ArtifactPersistenceContext>();
    let inputPersistenceContext: ArtifactPersistenceContext | undefined;
    const assertInputPersistence = async () => {
      assertAttempt(); if (!inputPersistenceContext) throw new Error('fashion_studio_upload_context_missing');
      await inputPersistenceContext.assertCurrent(); assertAttempt();
    };
    const uploads = createFashionStudioInputController({
      assertScope: assertAttempt, readFile: readFashionStudioUpload,
      begin: async (requestId, _scope, context) => {
        if (!cloudflareDataPlane) throw new Error('fashion_studio_upload_unavailable');
        inputPersistenceContext = await cloudflareDataPlane.captureArtifactPersistenceContext(context);
        uploadContexts.set(requestId, inputPersistenceContext);
        await assertInputPersistence();
      },
      saveInput: async (input, context) => {
        assertAttempt();
        if (!cloudflareDataPlane) throw new Error('fashion_studio_upload_unavailable');
        // The shared bridge must capture auth/session before its internal writes.
        const persistenceContext = uploadContexts.get(input.requestId);
        if (!persistenceContext) throw new Error('fashion_studio_upload_context_missing');
        await persistenceContext.assertCurrent();
        context.assertContext();
        const receipt = await cloudflareDataPlane.saveWorkspaceArtifact({ requestId: input.requestId, brandId: requested.brandId,
          featureType: `fashion-studio-detail-${input.role === 'main' ? 'main' : 'reference'}-input`, title: 'Fashion Studio', imageUrl: input.imageUrl, prompt: null,
          metadata: { inputOperationId: input.requestId, layerRole: input.role === 'main' ? 'original-base' : input.role === 'reference' ? 'material-reference' : 'material-reference-extra' },
          // A node's 新しい機能 opens a new project (documentId ''), so the input names the project it belongs to.
          canvasProjectId: input.scope.documentId || null, sourceStoragePath: null }, undefined, persistenceContext);
        context.assertContext();
        if (!receipt.success) throw new Error('fashion_studio_upload_remote_unverified');
        return receipt.remote;
      },
      recoverInput: async (requestId, _inputScope, context) => {
        if (!cloudflareDataPlane) throw new Error('fashion_studio_upload_unavailable');
        const persistenceContext = uploadContexts.get(requestId);
        if (!persistenceContext) throw new Error('fashion_studio_upload_context_missing');
        await persistenceContext.assertCurrent(); context.assertContext();
        const receipt = await cloudflareDataPlane.readWorkspaceArtifact(requestId, undefined, null, persistenceContext);
        context.assertContext(); return receipt.remote;
      },
      getDocument: async (...args) => { await assertInputPersistence(); const document = await getCanvasDocument(...args); await assertInputPersistence(); return document; },
      createDocument: async (...args) => { await assertInputPersistence(); const document = await createCanvasDocument(...args); await assertInputPersistence(); return document; },
      updateDocument: async (...args) => { await assertInputPersistence(); const document = await updateCanvasDocument(...args); await assertInputPersistence(); return document; },
      publish: state => { assertAttempt(); setUpload({ ...state, scopeKey }); setActivity({ scopeKey, value: state.status }); },
      committed: (document, inputScope) => {
        assertAttempt();
        if (!inputScope.documentId) {
          const exampleFn = pendingExampleRef.current;
          if (exampleFn) { primeExampleProject(document.id, exampleFn); setExamplePreview(current => current?.fn === exampleFn ? { fn: exampleFn, projectCode: document.id } : current); }
          const next = new URLSearchParams(searchParams); next.set('boardProjectCode', document.id);
          navigate({ pathname: window.location.pathname, search: next.toString() });
        } else publishDocument(document);
        logicalAttemptRef.current = null;
      },
    });
    const controller = createFashionStudioDetailGeneration(createFashionStudioGenerationAdapters({
      ackStore: createStudioAckStore({ getItem: key => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: key => window.localStorage.removeItem(key) }),
      assertScope: assertAttempt,
      activity: value => { assertAttempt(); setActivity({ scopeKey, value }); },
      committedInputs: () => committedInputsRef.current,
      editImageWithPrompt: (imageUrl, prompt, brandId, options) => editImageWithPrompt(imageUrl, studioProviderPrompt(prompt, studioFunctionRef.current, {
        garment: settingsRef.current.garment, perspective: settingsRef.current.perspective, hasReference: providerContextRef.current.hasReference,
          referenceCount: providerContextRef.current.referenceCount, points: providerContextRef.current.points }), brandId, options),
      assertCompletedImageEditResult, resolveImage: resolveGeneratedImageUrlWithStatus,
      capturePersistenceContext: async context => {
        if (!cloudflareDataPlane) throw new Error('fashion_studio_generation_unavailable');
        return cloudflareDataPlane.captureArtifactPersistenceContext(context);
      },
      persistProviderResultArtifact, getCanvasDocument, updateCanvasDocument,
      acknowledgeImageAction: async (receipt, context) => {
        context.assertContext(); if (!cloudflareDataPlane) throw new Error('fashion_studio_generation_unavailable');
        await cloudflareDataPlane.acknowledgeImageAction(receipt); context.assertContext();
      },
      publishSuccess: outcome => { assertAttempt(); if (outcome.document) publishDocument(outcome.document); },
    }));
    uploadControllerRef.current = uploads; generationControllerRef.current = controller; busyRef.current = false;
    if (requested.documentId) {
      const pending = controller.restorePendingAcknowledgement(requested);
      if (pending) { setGeneration({ ...pending, scopeKey }); setActivity({ scopeKey, value: 'failure' }); }
    }
    return () => { uploads.dispose(); controller.dispose(); if (uploadControllerRef.current === uploads) uploadControllerRef.current = null;
      if (generationControllerRef.current === controller) generationControllerRef.current = null; };
  }, [scopeKey]);
  const activeUpload = upload?.scopeKey === scopeKey ? upload : null;
  const activeGeneration = generation?.scopeKey === scopeKey ? generation : null;
  const activityValue = activity.scopeKey === scopeKey ? activity.value : '';
  const busy = ['preparing', 'generating', 'recovering', 'saving'].includes(activityValue);
  // While the example is still being saved, the form shows it but nothing can be changed or generated yet.
  const formLocked = busy || previewActive;
  // A refused (settled) generation holds nothing, so the form stays editable like Light's; only an unknown result is held.
  const generationHeld = activeGeneration?.status === 'failure' && activeGeneration.settled !== true;
  const recoveryRequired = (activeUpload?.status === 'failure' && activeUpload.recoverable === true) || generationHeld;
  const mainIdentity = JSON.stringify([scopeKey, detail.roles.main.objectId, detail.roles.main.candidates]);
  /** Node positions are saved in the same document; an upload or generation waits for a save in flight so their
   * revision checks never race it (src/lib/studioCanvas.ts withStudioLayout). */
  const layoutSaveRef = useRef<{ timer?: ReturnType<typeof setTimeout>; flight?: Promise<void>;
    pending?: { userId: string; brandId: string; documentId: string; positions: StudioPositions } }>({});
  const waitForLayoutSave = async () => { try { await layoutSaveRef.current.flight; } catch { /* a failed layout save never blocks the work */ } };
  /** True when the input was saved; false when it was not started or failed (the failure is shown as usual). */
  const uploadFile = async (file: File | undefined, role: FashionStudioInputRole, newProject = false): Promise<boolean> => {
    if (!file || !scope || busyRef.current || recoveryRequired) return false;
    const capturedScopeKey = scopeKey;
    try {
      assertContext(); busyRef.current = true; setUploadingScope(capturedScopeKey);
      await waitForLayoutSave(); assertContext();
      if (!uploadControllerRef.current) throw new Error('fashion_studio_upload_unavailable');
      // A node's テキストで生成 etc. starts a new project with that image as its main image (Heavy keeps one form per project).
      const state = await uploadControllerRef.current.start(file, role, newProject ? { ...scope, documentId: '' } : scope);
      return state.status === 'success';
    } catch (error) {
      if (currentScopeRef.current === capturedScopeKey) { setUpload({ scopeKey, status: 'failure', role, error: error instanceof Error ? error.message : String(error) }); setActivity({ scopeKey, value: 'failure' }); }
      return false;
    } finally {
      setUploadingScope(current => current === capturedScopeKey ? '' : current);
      if (currentScopeRef.current === capturedScopeKey) busyRef.current = false;
    }
  };
  const referenceIdentity = JSON.stringify([scopeKey, detail.roles.reference.objectId, detail.roles.reference.candidates]);
  /** Saved copies that have loaded once (hidden preloaders below), so a role leaves the example only when it can draw at once. */
  const [previewLoaded, setPreviewLoaded] = useState({ main: '', reference: '' });
  const previewRoles = previewActive && examplePreview
    ? studioExamplePreviewRoles(detail, examplePreview.fn, { main: previewLoaded.main === mainIdentity, reference: previewLoaded.reference === referenceIdentity })
    : { main: false, reference: false };
  /** What the canvas draws. Saving, generating and every check keep reading the saved `detail`. */
  const view = previewActive && examplePreview ? withStudioExamplePreview(detail, examplePreview.fn, previewRoles, window.location.origin) : detail;
  const exampleHold = previewActive && examplePreview ? studioExampleHoldUrls(examplePreview.fn, window.location.origin) : { main: undefined, reference: undefined };
  const slotRole = (slot: number): FashionStudioInputRole => slot ? `reference-${slot}` : 'reference';
  /** References on the form in slot order (slot 0 = the reference role); removed ones stay saved but hidden. */
  const shownReferences = [
    ...(view.roles.reference.status === 'available' && !settings.referenceOff ? [{ slot: 0, candidates: view.roles.reference.candidates, objectId: view.roles.reference.objectId }] : []),
    ...detail.extraReferences.filter(extra => extra.status === 'available' && !settings.extraOff.includes(extra.slot))
      .map(extra => ({ slot: extra.slot, candidates: extra.candidates, objectId: extra.objectId })),
  ];
  const freeReferenceSlot = (limit: number) => { for (let slot = 0; slot < limit; slot += 1) if (!shownReferences.some(item => item.slot === slot)) return slot; return -1; };
  const regionPoints = shownReferences.filter(item => item.slot < STUDIO_MAX_REGION_POINTS);
  const textReferences = shownReferences.slice(0, STUDIO_MAX_TEXT_REFERENCES);
  const regionGuideRef = useRef<{ key: string; url: string } | null>(null);
  const regionGuideUrl = async (mainUrl: string, maskUrls: string[]) => {
    const key = JSON.stringify([mainUrl, maskUrls]);
    if (regionGuideRef.current?.key === key) return regionGuideRef.current.url;
    const url = await buildRegionGuideUrl(mainUrl, maskUrls);
    regionGuideRef.current = { key, url };
    return url;
  };
  const generate = async (retry = false) => {
    const generationController = generationControllerRef.current;
    if (!scope || busyRef.current || !generationController || previewActiveRef.current) return;
    const fn = studioFunctionRef.current;
    const referenceAvailable = detail.roles.reference.status === 'available' && !settings.referenceOff;
    if (!retry) {
      // Light checks the form when AI生成 is pressed and says what is missing.
      if (detail.roles.main.status !== 'available' || loadedMain.identity !== mainIdentity || !loadedMain.url) { toast.error('メイン画像を追加してください'); return; }
      if ((fn === 'text' || fn === 'underwear') && !prompt.trim()) { toast.error(fn === 'underwear' ? 'フィッティングの説明を入力してください' : '指示テキストを入力してください'); return; }
      if (fn === 'region' && !regionPoints.length) { toast.error('参考画像を追加してください'); return; }
      if (fn === 'underwear' && referenceAvailable && !innerwearConsent) { toast.error('モデル写真の使用許可と、写っている人の同意を確認してください'); return; }
      const unmasked = fn === 'region' ? regionPoints.findIndex(point => !regionMaskFor(point.slot)) : -1;
      if (unmasked >= 0) { toast.error(regionPoints.length > 1 ? `ポイント${unmasked + 1}のマスク調整で範囲を選択してください` : 'マスク調整で範囲を選択してください'); return; }
    }
    const capturedScopeKey = scopeKey;
    try {
      assertContext(); busyRef.current = true; setActivity({ scopeKey, value: retry ? 'recovering' : 'preparing' });
      await waitForLayoutSave(); assertContext();
      let outcome: FashionStudioGenerationOutcome;
      if (retry) outcome = await generationController.retry();
      else {
        if (!detail.roles.main.objectId || detail.roles.reference.status === 'ambiguous') throw new Error('fashion_studio_generation_input_unverified');
        const promptText = studioFunctionPromptText(fn, prompt.trim(), settings, regionPoints.length);
        const sourceOf = (item: { slot: number; candidates: readonly string[] }) => item.slot === 0 && loadedReference.identity === referenceIdentity && loadedReference.url ? loadedReference.url : item.candidates[0];
        // テキストで生成 sends every reference (up to nine); 範囲指定 one per fusion point plus the coloured guide; 下着 the model image.
        const chosen = fn === 'text' ? textReferences : fn === 'region' ? regionPoints : fn === 'underwear' && referenceAvailable ? shownReferences.filter(item => item.slot === 0) : [];
        const references = chosen.map(sourceOf);
        if (fn === 'region') references.push(await regionGuideUrl(loadedMain.url, regionPoints.map(point => regionMaskFor(point.slot))));
        assertContext();
        providerContextRef.current = { hasReference: chosen.length > 0, referenceCount: chosen.length, points: Math.max(1, regionPoints.length) };
        // 範囲指定 has no 生成設定 on Light's form, so it keeps the main image's frame at 2K.
        const editOptions = fn === 'region' ? undefined : studioEditOptions(settings);
        const inputIdentity = JSON.stringify([scopeKey, mainIdentity, fn, promptText, references, editOptions ?? null]);
        if (logicalAttemptRef.current?.identity !== inputIdentity) logicalAttemptRef.current = { identity: inputIdentity, key: crypto.randomUUID() };
        const main = { objectId: detail.roles.main.objectId, imageUrl: loadedMain.url, verified: true };
        outcome = await generationController.start({ scope, logicalAttemptKey: logicalAttemptRef.current.key,
          main, referenceImageUrls: references, prompt: promptText,
          ...(editOptions ? { editOptions } : {}),
          // OpenAI refuses every innerwear-on-model image (2026-11-12), so 下着 goes to the server's FLUX.2 [dev] route.
          ...(fn === 'underwear' ? { route: 'innerwear' as const, ...(chosen.length && innerwearConsent ? { rightsConfirmed: true } : {}) } : {}) });
        // OpenAI's safety check refused テキストで生成 (a settled refusal, nothing pending): the same request is drawn again on
        // FLUX.2 [dev], with at most three references and, when references go, the rights/consent declaration the server needs.
        const redraw = studioFluxRedrawPlan(fn, outcome, references);
        if (redraw) {
          const fluxReferences = redraw.references;
          const rightsConfirmed = redraw.needsConsent && await askFluxConsent(redraw.trimmed);
          assertContext();
          if (!redraw.needsConsent || rightsConfirmed) {
            setActivity({ scopeKey, value: 'generating' }); toast(STUDIO_FLUX_REDRAW_NOTICE);
            providerContextRef.current = { hasReference: fluxReferences.length > 0, referenceCount: fluxReferences.length, points: 1 };
            // Without a ratio that route frames the result like its second image, so 自動 sends the main image's own frame.
            const size = editOptions?.aspectRatio || !fluxReferences.length ? null : await naturalImageSize(loadedMain.url).catch(() => null);
            assertContext();
            const fluxOptions = { ...(editOptions ?? {}), ...(size ? { aspectRatio: closestStudioAspectRatio(size.width, size.height) } : {}) };
            logicalAttemptRef.current = { identity: `${inputIdentity}:flux`, key: crypto.randomUUID() };
            outcome = await generationController.start({ scope, logicalAttemptKey: logicalAttemptRef.current.key,
              main, referenceImageUrls: fluxReferences, prompt: promptText,
              ...(Object.keys(fluxOptions).length ? { editOptions: fluxOptions } : {}),
              route: 'innerwear' as const, ...(rightsConfirmed ? { rightsConfirmed: true } : {}) });
          }
        }
      }
      assertContext();
      // Light makes a new image every time AI生成 is pressed: once this attempt has its image, the next press is a new
      // attempt (production 2026-11-12: four more presses with the same inputs returned the first image and made nothing).
      // A failed or uncertain attempt keeps its key, so pressing again settles it instead of paying twice.
      if (outcome.status === 'success') logicalAttemptRef.current = null;
      if (outcome.status === 'success' && outcome.document) setHydration(previous => ({ scopeKey, status: 'success', title: outcome.document!.title,
        detail: extractFashionStudioSavedDetail(outcome.document!.snapshot), remainingUnits: previous?.scopeKey === scopeKey ? previous.remainingUnits : null }));
      setGeneration({ ...outcome, scopeKey }); setActivity({ scopeKey, value: outcome.status === 'success' ? 'success' : 'failure' });
    } catch (error) {
      if (currentScopeRef.current === capturedScopeKey) { setGeneration({ scopeKey, status: 'failure', stage: 'provider', requestId: '', error: error instanceof Error ? error.message : String(error) }); setActivity({ scopeKey, value: 'failure' }); }
    } finally { if (currentScopeRef.current === capturedScopeKey) busyRef.current = false; }
  };
  const retryUpload = async () => {
    const controller = uploadControllerRef.current;
    if (busyRef.current || !controller) return;
    const captured = scopeKey; busyRef.current = true;
    try { await waitForLayoutSave(); await controller.retry(); } finally { if (currentScopeRef.current === captured) busyRef.current = false; }
  };
  /** Light: choosing a function on the empty canvas loads its example and saves the project. */
  const loadExample = async (fn: StudioFunctionId) => {
    if (!scope || busyRef.current || recoveryRequired || exampleState.loading) return;
    const captured = scopeKey;
    setExampleLoad({ scopeKey: captured, loading: fn, failed: null });
    // Light shows the example at once; the project is created and saved behind it (fashionStudioExamplePreview).
    setStudioFunction(fn); setSettingsState({ projectCode, value: { ...readStudioSettings(projectCode), example: fn } });
    const sample = examplePrompt(fn); if (sample) setPromptDraft({ scopeKey, value: sample });
    if (fn === 'region') setRegionMaskState({ projectCode, urls: { 0: REGION_EXAMPLE_MASK } });
    setExamplePreview({ fn, projectCode }); setPreviewLoaded({ main: '', reference: '' });
    const stopPreview = () => setExamplePreview(current => current?.fn === fn ? null : current);
    let file: File;
    try { file = await loadStudioExampleFile(STUDIO_EXAMPLES[fn].main); }
    catch { stopPreview(); if (currentScopeRef.current === captured) setExampleLoad({ scopeKey: captured, loading: null, failed: fn }); return; }
    pendingExampleRef.current = fn; pendingFunctionRef.current = null;
    // A failed save goes back to the new-file canvas with its error and 保存を再試行, as before.
    if (!await uploadFile(file, 'main')) stopPreview();
    setExampleLoad(current => current.scopeKey === captured ? { scopeKey: captured, loading: null, failed: null } : current);
  };
  const uploadOwnMain = (file: File | undefined) => { pendingExampleRef.current = null; pendingFunctionRef.current = null; void uploadFile(file, 'main'); };
  const uploadReference = (file: File | undefined, role: FashionStudioInputRole = referenceTargetRef.current) => {
    if (!file) return;
    const slot = role === 'reference' ? 0 : Number(role.slice('reference-'.length));
    if (slot === 0 && settings.referenceOff) updateSettings({ referenceOff: false });
    if (slot > 0 && settings.extraOff.includes(slot)) updateSettings({ extraOff: settings.extraOff.filter(value => value !== slot) });
    if (studioFunction === 'underwear' && prompt === STUDIO_UNDERWEAR_NO_MODEL_PROMPT) setPrompt(STUDIO_UNDERWEAR_WITH_MODEL_PROMPT);
    void uploadFile(file, role);
  };
  /** Opens the reference picker for one slot: a free slot adds a reference / fusion point, a shown one is replaced. */
  const pickReference = (slot: number) => { referenceTargetRef.current = slotRole(slot); referenceInputRef.current?.click(); };
  const removeReferenceSlot = (slot: number) => {
    if (slot === 0) updateSettings({ referenceOff: true });
    else updateSettings({ extraOff: [...new Set([...settings.extraOff, slot])] });
    if (slot === 0 && studioFunction === 'underwear' && prompt === STUDIO_UNDERWEAR_WITH_MODEL_PROMPT) setPrompt(STUDIO_UNDERWEAR_NO_MODEL_PROMPT);
  };
  const removeReference = () => removeReferenceSlot(0);
  /** Light's 融合ポイントを追加 → キャンバスから選択: an image already on the canvas becomes the new point's reference. */
  const [canvasPicker, setCanvasPicker] = useState<{ slot: number; images: { key: string; url: string }[] } | null>(null);
  const openCanvasPicker = async (slot: number) => {
    const sources = [...detail.history.map(item => item.candidates[0]), detail.roles.result.candidates[0], detail.roles.main.candidates[0]].filter((value): value is string => Boolean(value));
    const resolved = await Promise.all(sources.map(async source => { const value = await resolveGeneratedImageUrlWithStatus(source).catch(() => null); return value?.ok ? value.url : ''; }));
    const images = [...(settings.example ? [{ key: 'sample', url: STUDIO_EXAMPLES[settings.example].result }] : []), ...resolved.filter(Boolean).map((url, index) => ({ key: `canvas-${index}`, url }))];
    if (!images.length) { toast.error('キャンバスに選べる画像がありません'); return; }
    setCanvasPicker({ slot, images });
  };
  const chooseCanvasImage = async (slot: number, url: string) => {
    setCanvasPicker(null);
    try { uploadReference(await loadStudioExampleFile(url), slotRole(slot)); } catch { toast.error('画像を読み込めませんでした'); }
  };
  const [pointMenu, setPointMenu] = useState(false);
  // The example's main image created the project; add its reference (model / fusion garment) and Light's toast.
  useEffect(() => {
    if (!pendingExample || pendingExample.projectCode !== projectCode || visible?.status !== 'success' || detail.roles.main.status !== 'available') return;
    const example = STUDIO_EXAMPLES[pendingExample.fn];
    if (pendingExample.fn === 'region' && !regionMaskUrl) setRegionMask(REGION_EXAMPLE_MASK);
    if (!example.reference || detail.roles.reference.status === 'available') { setPendingExample(null); toast.success(STUDIO_EXAMPLE_LOADED); return; }
    if (exampleReferenceStartedRef.current === projectCode || busy) return;
    exampleReferenceStartedRef.current = projectCode;
    void loadStudioExampleFile(example.reference).then(file => uploadFile(file, 'reference'))
      .then(saved => { if (!saved) setExamplePreview(null); })
      .catch(() => { setPendingExample(null); setExamplePreview(null); toast.error(STUDIO_EXAMPLE_FAILED); });
  }, [pendingExample, projectCode, visible?.status, detail.roles.main.status, detail.roles.reference.status, busy]);
  // Another project opened before the example finished: the example belongs to its own project only.
  useEffect(() => { setExamplePreview(current => current && current.projectCode !== projectCode ? null : current); }, [projectCode]);
  // The example leaves the canvas once every role draws its saved copy (or the project could not be read).
  useEffect(() => {
    if (!previewActive) return;
    if (visible?.status === 'failure' || (!previewRoles.main && !previewRoles.reference && !pendingExample)) setExamplePreview(null);
  }, [previewActive, previewRoles.main, previewRoles.reference, pendingExample, visible?.status]);
  const openMaskDialog = async (slot = 0) => {
    if (!loadedMain.url) { toast.error('メイン画像を追加してください'); return; }
    let initial: ImageData | null = null;
    const current = regionMaskFor(slot);
    if (current) {
      try { const size = await naturalImageSize(loadedMain.url); initial = await regionMaskImageData(current, size.width, size.height); } catch { initial = null; }
    }
    setMaskDialog({ initial, slot });
  };
  const confirmMask = (mask: ImageData | null) => { const slot = maskDialog?.slot ?? 0; setMaskDialog(null); setRegionMask(mask ? regionMaskToDataUrl(mask) : '', slot); };
  const savePrompt = () => {
    const value = prompt.trim();
    if (!value) { toast.error('保存する指示がありません'); return; }
    const next = [value, ...savedPrompts.filter(item => item !== value)].slice(0, 50);
    setSavedPrompts(next);
    try { window.localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    toast.success('プロンプトを保存しました');
  };
  // Light's canvas (2026-11-12): main → form → results as free nodes joined by curved edges. People drag nodes (Light's
  // snapping on by default), undo / redo moves, キャンバスを整理 re-lays them out; positions are saved in the project.
  const flowRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  // Light keeps the sample (仕上がりのサンプル) and lines every result up to its right, oldest first.
  const showExampleResult = Boolean(settings.example);
  const resultItems = [...detail.history.filter(item => item.status === 'available'), ...(detail.roles.result.status === 'available' ? [detail.roles.result] : [])];
  const hasResultNode = resultItems.length > 0 || showExampleResult;
  const resultKeys = resultItems.map((item, index) => resultNodeKey(item.objectId, index));
  const resultNodeKeys = [...(showExampleResult ? ['sample'] : []), ...resultKeys];
  const nodeKeySignature = resultNodeKeys.join('|');
  const [nodeSizes, setNodeSizes] = useState<{ scopeKey: string; sizes: Record<string, { width: number; height: number }> }>({ scopeKey: '', sizes: {} });
  const sizes = nodeSizes.scopeKey === viewportScopeKey ? nodeSizes.sizes : {};
  useEffect(() => {
    const flow = flowRef.current;
    if (!hasProject || !flow) return;
    const measure = () => {
      const next: Record<string, { width: number; height: number }> = {};
      flow.querySelectorAll<HTMLElement>('[data-studio-node]').forEach(node => { const key = node.dataset.studioNode; if (key) next[key] = { width: node.offsetWidth, height: node.offsetHeight }; });
      setNodeSizes(previous => previous.scopeKey === viewportScopeKey && JSON.stringify(previous.sizes) === JSON.stringify(next) ? previous : { scopeKey: viewportScopeKey, sizes: next });
    };
    const observer = new ResizeObserver(measure);
    flow.querySelectorAll('[data-studio-node]').forEach(node => observer.observe(node));
    measure();
    return () => observer.disconnect();
  }, [hasProject, nodeKeySignature, studioFunction, viewportScopeKey]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!hasProject || !viewport) return;
    const measure = () => setCanvasSize(previous => previous.width === viewport.clientWidth && previous.height === viewport.clientHeight ? previous : { width: viewport.clientWidth, height: viewport.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(viewport); measure();
    return () => observer.disconnect();
  }, [hasProject, viewportScopeKey]);
  const [layoutState, setLayoutState] = useState<{ scopeKey: string; positions: StudioPositions | null; history: StudioHistory }>({ scopeKey: '', positions: null, history: emptyStudioHistory() });
  const layoutCurrent = layoutState.scopeKey === viewportScopeKey ? layoutState : { scopeKey: viewportScopeKey, positions: null, history: emptyStudioHistory() };
  const savedPositions = layoutCurrent.positions ?? detail.layout;
  const nodeSpecs: StudioNodeSpec[] = [
    { key: 'main', kind: 'main', width: sizes.main?.width || IMAGE_NODE_WIDTH },
    { key: 'form', kind: 'form', width: sizes.form?.width || FORM_NODE_WIDTH },
    ...resultNodeKeys.map(key => ({ key, kind: 'result' as const, width: sizes[key]?.width || IMAGE_NODE_WIDTH })),
  ];
  const nodeKeys = nodeSpecs.map(spec => spec.key);
  const basePositions = studioNodePositions(nodeSpecs, savedPositions);
  const [nodeDrag, setNodeDrag] = useState<{ scopeKey: string; key: string; point: StudioPoint } | null>(null);
  const [snapLines, setSnapLines] = useState<StudioSnapLine[]>([]);
  const nodeDragRef = useRef<{ pointerId: number; key: string; startX: number; startY: number; origin: StudioPoint; point: StudioPoint; moved: boolean } | null>(null);
  const liveDrag = nodeDrag?.scopeKey === viewportScopeKey ? nodeDrag : null;
  const shownPositions: StudioPositions = liveDrag ? { ...basePositions, [liveDrag.key]: liveDrag.point } : basePositions;
  const rectOf = (key: string, positions: StudioPositions = shownPositions): StudioRect | null => {
    const size = sizes[key], point = positions[key];
    return size && size.height > 0 && point ? { id: key, x: point.x, y: point.y, width: size.width, height: size.height } : null;
  };
  const nodeRects = nodeKeys.map(key => rectOf(key)).filter((rect): rect is StudioRect => Boolean(rect));
  const allMeasured = nodeKeys.every(key => (sizes[key]?.height ?? 0) > 0);
  const flowEdges = [{ source: 'main', target: 'form' }, ...resultNodeKeys.map(target => ({ source: 'form', target }))];
  const selectedKey = viewportState.selectedObjectId;
  const [snapEnabled, setSnapEnabled] = useState(readStudioSnapEnabled);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Saving positions: debounced, never while an upload / generation runs or an unknown result is held (those compare
  // the document's revision and proof), retried once on a conflict, and flushed when the project changes.
  const recoveryRequiredRef = useRef(false);
  recoveryRequiredRef.current = recoveryRequired;
  const layoutAckPending = (job: { userId: string; brandId: string; documentId: string }) => {
    try { return Boolean(createStudioAckStore(window.localStorage).read({ userId: job.userId, brandId: job.brandId, documentId: job.documentId })); } catch { return true; }
  };
  const runLayoutSave = async (): Promise<void> => {
    const saver = layoutSaveRef.current;
    const job = saver.pending;
    if (saver.flight || !job || busyRef.current || recoveryRequiredRef.current || layoutAckPending(job)) return;
    saver.pending = undefined;
    const live = () => {
      const state = useAuthStore.getState();
      if (state.user?.id !== job.userId || state.currentBrand?.id !== job.brandId) throw new Error('fashion_studio_layout_scope_stale');
    };
    const context = { userId: job.userId, assertContext: live };
    const flight = (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          live();
          const document = await getCanvasDocument(job.documentId, job.brandId, context);
          live();
          if (document.id !== job.documentId || document.ownerId !== job.userId || document.brandId !== job.brandId) return;
          if (sameStudioPositions(readStudioLayout(document.snapshot), job.positions)) return;
          await updateCanvasDocument({ brandId: job.brandId, documentId: job.documentId, title: document.title,
            snapshot: withStudioLayout(document.snapshot, job.positions), expectedRevision: document.revision }, context);
          return;
        } catch (error) {
          // A conflict means another write landed first: read the document again once and put the positions on top.
          if (error instanceof Error && error.message === 'fashion_studio_layout_scope_stale') return;
        }
      }
    })();
    saver.flight = flight;
    try { await flight; } finally { if (saver.flight === flight) saver.flight = undefined; }
    if (saver.pending) scheduleLayoutSave(0);
  };
  const scheduleLayoutSave = (delay = 600) => {
    const saver = layoutSaveRef.current;
    if (saver.timer) clearTimeout(saver.timer);
    saver.timer = setTimeout(() => { saver.timer = undefined; void runLayoutSave(); }, delay);
  };
  const runLayoutSaveRef = useRef(runLayoutSave);
  runLayoutSaveRef.current = runLayoutSave;
  useEffect(() => { if (!busy && !recoveryRequired && layoutSaveRef.current.pending) scheduleLayoutSave(); }, [busy, recoveryRequired]);
  useEffect(() => () => {
    const saver = layoutSaveRef.current;
    if (saver.timer) { clearTimeout(saver.timer); saver.timer = undefined; }
    if (saver.pending) void runLayoutSaveRef.current();
  }, [viewportScopeKey]);
  const queueLayoutSave = (positions: StudioPositions) => {
    if (!scope || !projectCode) return;
    layoutSaveRef.current.pending = { userId: scope.userId, brandId: scope.brandId, documentId: projectCode, positions };
    scheduleLayoutSave();
  };
  const commitPositions = (next: StudioPositions) => {
    if (!scope || !projectCode || sameStudioPositions(next, basePositions)) return;
    setLayoutState({ scopeKey: viewportScopeKey, positions: next, history: pushStudioHistory(layoutCurrent.history, basePositions) });
    queueLayoutSave(next);
  };
  const stepLayoutHistory = (direction: 'undo' | 'redo') => {
    const step = direction === 'undo' ? undoStudioHistory(layoutCurrent.history, basePositions) : redoStudioHistory(layoutCurrent.history, basePositions);
    if (!step) return;
    setLayoutState({ scopeKey: viewportScopeKey, positions: step.positions, history: step.history });
    queueLayoutSave(step.positions);
  };
  const canUndo = layoutCurrent.history.past.length > 0;
  const canRedo = layoutCurrent.history.future.length > 0;
  // The first fit follows the nodes as their images load, until the person moves the view themselves.
  const fittedRef = useRef('');
  const userViewRef = useRef('');
  const markUserView = () => { userViewRef.current = viewportScopeKey; };
  const fitFlow = () => {
    const viewport = viewportRef.current; const interaction = viewportInteractionRef.current;
    if (!viewport || !interaction || !nodeRects.length) return false;
    const bounds = viewport.getBoundingClientRect();
    const minX = Math.min(...nodeRects.map(rect => rect.x)), minY = Math.min(...nodeRects.map(rect => rect.y));
    const spanX = Math.max(1, Math.max(...nodeRects.map(rect => rect.x + rect.width)) - minX);
    const spanY = Math.max(1, Math.max(...nodeRects.map(rect => rect.y + rect.height)) - minY);
    // Light's fitView keeps a margin around the nodes and never enlarges past its fitted size. The flow sits between the
    // node labels above and the canvas toolbar below (2026-11-11 production: the toolbar covered the AI生成 button).
    const top = 40, bottom = 104;
    const scale = Math.min(1, (bounds.width * 0.92) / spanX, (bounds.height - top - bottom) / spanY);
    interaction.set({ zoom: STUDIO_DEFAULT_VIEWPORT.zoom * scale, panX: bounds.width / 2 - scale * (minX + spanX / 2), panY: (bounds.height + top - bottom) / 2 - scale * (minY + spanY / 2) });
    return true;
  };
  useEffect(() => {
    if (!allMeasured) return;
    const key = JSON.stringify([viewportScopeKey, hasResultNode, resultItems.length, studioFunction]);
    if (fittedRef.current === key && userViewRef.current === viewportScopeKey) return;
    if (fittedRef.current !== key) userViewRef.current = '';
    if (fitFlow()) fittedRef.current = key;
  }, [sizes, viewportScopeKey, hasResultNode, resultItems.length, studioFunction, allMeasured]);
  const arrangeCanvas = () => {
    const viewport = viewportRef.current; const interaction = viewportInteractionRef.current;
    if (!viewport || !interaction || !allMeasured) return;
    const rects = nodeKeys.map(key => rectOf(key, basePositions)).filter((rect): rect is StudioRect => Boolean(rect));
    const arranged = arrangeStudioNodes(rects, flowEdges);
    commitPositions({ ...basePositions, ...arranged });
    const bounds = viewport.getBoundingClientRect();
    interaction.set(fitStudioArrangedView(rects.map(rect => ({ ...rect, ...arranged[rect.id] })), bounds.width, bounds.height));
    markUserView();
  };
  const startNodeDrag = (event: ReactPointerEvent<HTMLElement>, key: string) => {
    const point = basePositions[key];
    if (!point) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { return; }
    viewportInteractionRef.current?.select(key);
    nodeDragRef.current = { pointerId: event.pointerId, key, startX: event.clientX, startY: event.clientY, origin: point, point, moved: false };
  };
  const moveNodeDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return true;
    drag.moved = true;
    const scale = viewportState.view.zoom / 0.3;
    let point = { x: drag.origin.x + dx / scale, y: drag.origin.y + dy / scale };
    let lines: StudioSnapLine[] = [];
    const size = sizes[drag.key];
    if (snapEnabled && !event.altKey && size) {
      const others = nodeKeys.filter(key => key !== drag.key).map(key => rectOf(key, basePositions)).filter((rect): rect is StudioRect => Boolean(rect));
      const snap = studioSnap([{ id: drag.key, ...point, ...size }], others, viewportState.view.zoom, drag.key);
      point = { x: point.x + snap.delta.x, y: point.y + snap.delta.y }; lines = snap.lines;
    }
    drag.point = point;
    setNodeDrag({ scopeKey: viewportScopeKey, key: drag.key, point }); setSnapLines(lines);
    return true;
  };
  const endNodeDrag = (pointerId: number, commit: boolean) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return false;
    nodeDragRef.current = null;
    const viewport = viewportRef.current;
    if (viewport?.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    setNodeDrag(null); setSnapLines([]);
    if (commit && drag.moved) { commitPositions({ ...basePositions, [drag.key]: drag.point }); markUserView(); }
    return true;
  };
  const arrowRef = useRef(0);
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyHandlerRef.current = (event: KeyboardEvent) => {
    if (!hasProject || maskDialog || promptExpanded || lightbox || canvasPicker || shortcutsOpen || helpOpen || isTypingTarget(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && event.key.toLowerCase() === 'z') { event.preventDefault(); stepLayoutHistory(event.shiftKey ? 'redo' : 'undo'); return; }
    if (event.key === 'Escape') { viewportInteractionRef.current?.select(null); return; }
    if (mod && event.key === 'Enter') { if (selectedKey === 'form') { event.preventDefault(); void generate(); } return; }
    const arrow = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[event.key];
    const target = event.target as Node | null;
    if (!arrow || !selectedKey || mod || event.altKey || !(target === document.body || viewportRef.current?.contains(target))) return;
    const point = basePositions[selectedKey];
    if (!point) return;
    event.preventDefault();
    const step = ARROW_STEP * (event.shiftKey ? 4 : 1);
    const next = { ...basePositions, [selectedKey]: { x: point.x + arrow[0] * step, y: point.y + arrow[1] * step } };
    // Presses in a row are one undo step.
    const now = Date.now(), joined = now - arrowRef.current < 600 && canUndo; arrowRef.current = now;
    if (joined) { setLayoutState({ scopeKey: viewportScopeKey, positions: next, history: layoutCurrent.history }); queueLayoutSave(next); }
    else commitPositions(next);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  // Light's ライトモードに切り替え in the header (shared with the design editor's setting).
  const [studioTheme, setStudioTheme] = useState(readEditorTheme);
  const [themeSlot, setThemeSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { if (hasProject) setThemeSlot(document.getElementById('lightchain-header-context')); }, [hasProject]);
  useEffect(() => {
    if (!hasProject) return;
    const root = document.documentElement;
    // Only the header and this page turn light (the design editor's data-editor-theme rules would also restyle the dialogs).
    if (studioTheme === 'light') root.dataset.studioTheme = 'light'; else delete root.dataset.studioTheme;
    try { window.localStorage.setItem(EDITOR_THEME_KEY, studioTheme); } catch { /* storage unavailable */ }
    return () => { delete root.dataset.studioTheme; };
  }, [studioTheme, hasProject]);
  // The selected image node's toolbar: a new project on one of the four functions with this image, and ダウンロード.
  const nodeUrlsRef = useRef<Record<string, string>>({});
  const nodeImageUrl = (key: string) => key === 'main' ? (loadedMain.identity === mainIdentity ? loadedMain.url : '')
    : key === 'sample' ? (settings.example ? STUDIO_EXAMPLES[settings.example].result : '') : nodeUrlsRef.current[key] ?? '';
  const imageExtension = (type: string) => type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : type === 'image/avif' ? 'avif' : 'png';
  const downloadNodeImage = async (url: string) => {
    if (!url) return;
    try {
      const file = await loadStudioExampleFile(url);
      const href = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = href; anchor.download = `heavy-chain-${Date.now()}.${imageExtension(file.type)}`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch { window.open(url, '_blank', 'noopener'); }
  };
  const openNodeInNewProject = async (url: string, fn: StudioFunctionId) => {
    if (!url || !scope || busyRef.current || recoveryRequired || previewActiveRef.current) return;
    let file: File;
    try { const loaded = await loadStudioExampleFile(url); file = new File([loaded], `Untitled.${imageExtension(loaded.type)}`, { type: loaded.type }); }
    catch { toast.error('画像を読み込めませんでした'); return; }
    pendingExampleRef.current = null; pendingFunctionRef.current = fn;
    await uploadFile(file, 'main', true);
  };
  const activityText = ({ preparing: '準備中', generating: '生成中', recovering: '復旧中', saving: '保存中', failure: '失敗', success: '完了' } as Record<string, string>)[activityValue] || 'タスク';
  const activityError = activeUpload?.error || activeGeneration?.error || '';
  useEffect(() => { if (activityError) toast.error(studioErrorMessage(activityError), { id: `studio-error:${activityError}` }); }, [activityError]);
  const activityContent = <><span role="status">{activityText}</span>{activityError && <span role="alert" className="sr-only">{studioErrorMessage(activityError)}</span>}{activeUpload?.status === 'failure' && activeUpload.recoverable && <button type="button" disabled={busy} onClick={() => void retryUpload()}>保存を再試行</button>}{generationHeld && <button type="button" disabled={busy} onClick={() => void generate(true)}>保存を再試行</button>}</>;
  const inputControls = <><input ref={mainInputRef} className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" disabled={formLocked || recoveryRequired} aria-label="メイン画像ファイル" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void uploadFile(file, 'main'); }} /><input ref={referenceInputRef} className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" disabled={formLocked || recoveryRequired} aria-label="参考画像ファイル" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; uploadReference(file); }} /></>;
  const lightboxView = lightbox && (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-8" role="dialog" aria-label="全画面表示" onClick={() => setLightbox('')}>
      <img src={lightbox} alt="全画面表示" className="max-h-full max-w-full object-contain" />
      <button type="button" aria-label="閉じる" className="absolute right-6 top-6 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" onClick={() => setLightbox('')}><X className="h-5 w-5" /></button>
    </div>
  );

  if (hasProject) {
    const mainImage = view.roles.main.candidates;
    const referenceShown = view.roles.reference.status === 'available' && !settings.referenceOff;
    const inputsReady = !formLocked && uploadingScope !== scopeKey && !recoveryRequired && visible?.status === 'success';
    /** The selected image node on screen, for Light's toolbar above it and フィードバック bar below it. */
    const selectedImageRect = (() => {
      if (!selectedKey || selectedKey === 'form') return null;
      const rect = rectOf(selectedKey);
      if (!rect) return null;
      const scale = viewportState.view.zoom / 0.3;
      return { left: viewportState.view.panX + rect.x * scale, top: viewportState.view.panY + rect.y * scale, width: rect.width * scale, height: rect.height * scale };
    })();
    /** A file input bound to one reference slot, so the chosen file always lands in that slot (add a reference / point). */
    const slotFileInput = (slot: number, label: string) => <input type="file" className="sr-only" accept=".png,.jpg,.jpeg,.avif,.webp" aria-label={label}
      disabled={!inputsReady || !scope || slot < 0} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; setPointMenu(false); uploadReference(file, slotRole(slot)); }} />;
    const referenceLabel = studioFunction === 'underwear' ? 'モデル図' : '参考画像';
    const sectionLabel = 'mb-5 flex items-center text-[36px] leading-[48px] text-neutral-400';
    const selectBox = 'flex h-[88px] w-full items-center rounded-2xl border border-[#3d4346] bg-[#353a3b] text-[30px] text-neutral-300';
    const referenceTile = referenceShown
      ? <div className="relative size-[120px] shrink-0 rounded-[20px] border border-[#3d4346] bg-[#353a3b]">
          <DetailRoleImage candidates={view.roles.reference.candidates} scopeKey={scopeKey} role="reference" holdUrl={exampleHold.reference} assertContext={assertContext} alt={referenceLabel} className="h-full w-full rounded-[20px] object-cover" onReady={url => setLoadedReference({ identity: referenceIdentity, url })} />
          <button type="button" aria-label={`${referenceLabel}を削除`} disabled={!inputsReady} onClick={removeReference} className="absolute -right-3 -top-3 flex size-10 items-center justify-center rounded-full bg-[#505c5e] text-white"><X className="h-6 w-6" /></button>
        </div>
      : <button type="button" aria-label={`${referenceLabel}を追加`} disabled={!inputsReady || !scope} onClick={() => pickReference(0)} className="flex size-[120px] shrink-0 items-center justify-center rounded-[20px] border border-[#3d4346] bg-[#353a3b] text-neutral-300"><ImagePlus className="h-10 w-10" /></button>;
    // Light's テキストで生成: 参考画像 最大9枚 — one tile per reference, then an add tile while fewer than nine.
    const textReferenceTiles = <>
      {textReferences.map(item => (
        <div key={item.slot} className="relative size-[120px] shrink-0 rounded-[20px] border border-[#3d4346] bg-[#353a3b]" data-testid="fashion-studio-reference-tile">
          <DetailRoleImage candidates={item.candidates} scopeKey={scopeKey} role="reference" assertContext={assertContext} alt={`参考画像${item.slot + 1}`} className="h-full w-full rounded-[20px] object-cover"
            onReady={item.slot === 0 ? url => setLoadedReference({ identity: referenceIdentity, url }) : undefined} />
          <button type="button" aria-label={`参考画像${textReferences.indexOf(item) + 1}を削除`} disabled={!inputsReady} onClick={() => removeReferenceSlot(item.slot)} className="absolute -right-3 -top-3 flex size-10 items-center justify-center rounded-full bg-[#505c5e] text-white"><X className="h-6 w-6" /></button>
        </div>
      ))}
      {textReferences.length < STUDIO_MAX_TEXT_REFERENCES && <label aria-label="参考画像を追加" className={`flex size-[120px] shrink-0 items-center justify-center rounded-[20px] border border-[#3d4346] bg-[#353a3b] text-neutral-300 ${inputsReady && scope ? 'cursor-pointer hover:bg-white/10' : 'opacity-60'}`}>
        <ImagePlus className="h-10 w-10" />{slotFileInput(freeReferenceSlot(STUDIO_MAX_TEXT_REFERENCES), '参考画像ファイル（追加）')}
      </label>}
    </>;
    const promptField = (label: string) => (
      <div className="w-full px-8">
        <label className={sectionLabel} htmlFor="fashion-studio-detail-prompt">{label}<span className="ml-1 text-[#f04438]">*</span></label>
        <div className="relative flex h-[420px] flex-col justify-between gap-5 rounded-[32px] border border-[#3d4346] bg-[#353a3b] p-5">
          <textarea id="fashion-studio-detail-prompt" value={prompt} disabled={formLocked || recoveryRequired} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} className="h-full resize-none border-none bg-transparent p-0 text-[30px] leading-[42px] text-white outline-none" aria-label="指令を入力してください。" />
          <div className="flex items-center gap-4 text-neutral-300">
            <button type="button" aria-label="合成指示を全画面で編集" title="全画面で編集" onClick={() => setPromptExpanded(true)}><Maximize2 className="h-[34px] w-[34px]" /></button>
            <button type="button" aria-label="プロンプトを保存" title="プロンプトを保存" onClick={savePrompt}><Save className="h-[34px] w-[34px]" /></button>
            <button type="button" aria-label="プロンプトライブラリ" title="プロンプトライブラリ" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(open => !open)}><BookMarked className="h-[34px] w-[34px]" /></button>
            <span className="ml-auto text-[30px] text-neutral-400"><span className="text-[#20d0c4]">{prompt.length}</span>/2000</span>
            <button type="button" disabled={formLocked || recoveryRequired} onClick={() => setPrompt('')} className="rounded-xl bg-[#505c5e] px-5 py-2 text-[30px] text-white">全削除</button>
          </div>
          {libraryOpen && <div className="absolute inset-x-5 bottom-[84px] z-10 max-h-[360px] overflow-y-auto rounded-[24px] border border-[#3d4346] bg-[#262a2b] p-3 text-[28px] shadow-xl" role="listbox" aria-label="保存したプロンプト">
            {savedPrompts.length ? savedPrompts.map(item => <button key={item} type="button" role="option" aria-selected={item === prompt} onClick={() => { setPrompt(item); setLibraryOpen(false); }} className="block w-full truncate rounded-xl px-4 py-3 text-left text-neutral-200 hover:bg-white/10">{item}</button>)
              : <p className="px-4 py-3 text-neutral-400">保存したプロンプトはまだありません</p>}
          </div>}
        </div>
      </div>
    );
    const generationSettings = (
      <div className="w-full px-8">
        <div className={sectionLabel}>生成設定</div>
        <div className="flex w-full gap-5" data-testid="fashion-studio-generation-settings">
          <label className={`${selectBox} relative min-w-0 flex-1 gap-3 px-8`}>
            <span aria-hidden="true" className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[10px] border-[3px] border-current text-[14px] font-semibold">Auto</span>
            <span className="truncate">{studioAspectRatioLabel(settings.aspectRatio)}</span>
            <ChevronDown aria-hidden="true" className="ml-auto h-10 w-10 shrink-0 opacity-50" />
            <select aria-label="比率" value={settings.aspectRatio} disabled={formLocked || recoveryRequired} onChange={event => updateSettings({ aspectRatio: event.target.value as StudioAspectRatio })} className="absolute inset-0 cursor-pointer opacity-0">
              {STUDIO_ASPECT_RATIOS.map(value => <option key={value} value={value}>{studioAspectRatioLabel(value)}</option>)}
            </select>
          </label>
          <label className={`${selectBox} relative min-w-0 flex-1 gap-3 px-8`}>
            <StudioQualityMark quality={settings.quality} />
            <span>{STUDIO_QUALITIES.find(item => item.value === settings.quality)?.label}</span>
            <ChevronDown aria-hidden="true" className="ml-auto h-10 w-10 shrink-0 opacity-50" />
            <select aria-label="画質" value={settings.quality} disabled={formLocked || recoveryRequired} onChange={event => updateSettings({ quality: event.target.value as StudioQuality })} className="absolute inset-0 cursor-pointer opacity-0">
              {STUDIO_QUALITIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>
      </div>
    );
    const functionBody = studioFunction === 'region' ? (
      <div className="flex w-full flex-col gap-6 px-8" data-testid="fashion-studio-region-points">
        {regionPoints.map((point, index) => {
          const mask = regionMaskFor(point.slot);
          return (
            <div key={point.slot} className="rounded-[32px] border border-[#3d4346] bg-[#2f3436]" data-testid="fashion-studio-region-point">
              <div className="flex items-center justify-between border-b border-[#3d4346] px-6 py-5 text-[30px] text-neutral-200">
                <span className="flex items-center gap-3">ポイント：{index + 1}<button type="button" aria-label={`ポイント${index + 1}の参考画像を差し替え`} title="参考画像を差し替え" disabled={!inputsReady} onClick={() => pickReference(point.slot)}><RotateCw className="h-8 w-8" /></button></span>
                <button type="button" aria-label={`ポイント${index + 1}を削除`} title="融合ポイントを削除" disabled={!inputsReady} onClick={() => { setRegionMask('', point.slot); removeReferenceSlot(point.slot); }}><Trash2 className="h-8 w-8" /></button>
              </div>
              <div className="flex items-center gap-5 p-6">
                <button type="button" aria-label={`ポイント${index + 1}のマスク調整`} onClick={() => void openMaskDialog(point.slot)} className="relative h-[140px] w-[100px] shrink-0 overflow-hidden rounded-[16px] border border-[#3d4346] bg-[#353a3b]">
                  <DetailRoleImage candidates={mainImage} scopeKey={scopeKey} role="main" holdUrl={exampleHold.main} assertContext={assertContext} alt="メイン画像" className="h-full w-full object-cover" />
                  {/* Light shows the painted mask over the main image at 60% (its baseMaskInBlue thumbnail, opacity-60). */}
                  {mask && <img src={mask} alt="" aria-hidden="true" data-testid="fashion-studio-region-mask-thumb" className="absolute inset-0 h-full w-full object-cover opacity-60" />}
                </button>
                <button type="button" aria-label={`ポイント${index + 1}の参考画像を差し替え`} disabled={!inputsReady} onClick={() => pickReference(point.slot)} className="h-[140px] w-[100px] shrink-0 overflow-hidden rounded-[16px] border border-[#3d4346] bg-[#353a3b]">
                  <DetailRoleImage candidates={point.candidates} scopeKey={scopeKey} role="reference" holdUrl={point.slot === 0 ? exampleHold.reference : undefined} assertContext={assertContext} alt="参考画像" className="h-full w-full object-cover"
                    onReady={point.slot === 0 ? url => setLoadedReference({ identity: referenceIdentity, url }) : undefined} />
                </button>
                <button type="button" onClick={() => void openMaskDialog(point.slot)} className="ml-auto flex items-center gap-1 text-[30px] text-neutral-300">マスク調整<ChevronRight className="h-8 w-8" /></button>
              </div>
            </div>
          );
        })}
        {regionPoints.length < STUDIO_MAX_REGION_POINTS && <div className="relative">
          <button type="button" aria-label="融合ポイントを追加" aria-expanded={pointMenu} disabled={!inputsReady || !scope} onClick={() => setPointMenu(open => !open)} className="flex h-[120px] w-full items-center justify-center gap-2 rounded-[32px] border border-[#3d4346] bg-[#2f3436] text-[30px] text-neutral-200 hover:bg-[#353a3b] disabled:text-neutral-500"><Plus className="h-8 w-8" />融合ポイントを追加</button>
          {pointMenu && <div role="menu" aria-label="融合ポイントを追加" className="absolute left-full top-0 z-20 ml-4 w-[400px] overflow-hidden rounded-[28px] border border-[#3d4346] bg-[#262a2b] py-3 text-[34px] text-neutral-100 shadow-xl">
            <label role="menuitem" className="block w-full cursor-pointer px-8 py-4 text-left hover:bg-white/10">画像をアップロード{slotFileInput(freeReferenceSlot(STUDIO_MAX_REGION_POINTS), '融合ポイントの参考画像ファイル')}</label>
            <button type="button" role="menuitem" className="block w-full px-8 py-4 text-left hover:bg-white/10" onClick={() => { setPointMenu(false); void openCanvasPicker(freeReferenceSlot(STUDIO_MAX_REGION_POINTS)); }}>キャンバスから選択</button>
          </div>}
        </div>}
      </div>
    ) : studioFunction === '3d' ? (
      <>
        <div className="w-full px-8">
          <div className={sectionLabel}>エリアを選択</div>
          <label className={`${selectBox} relative px-10`}>
            <span className="truncate">{STUDIO_GARMENT_AREAS.find(area => area.value === settings.garment)?.label}</span>
            <ChevronDown aria-hidden="true" className="ml-auto h-10 w-10 shrink-0 opacity-50" />
            <select aria-label="エリアを選択" value={settings.garment} disabled={formLocked || recoveryRequired} onChange={event => updateSettings({ garment: event.target.value as StudioGarmentArea })} className="absolute inset-0 cursor-pointer opacity-0">
              {STUDIO_GARMENT_AREAS.map(area => <option key={area.value} value={area.value}>{area.label}</option>)}
            </select>
          </label>
        </div>
        <div className="w-full px-8">
          <div className={sectionLabel}>生成対象</div>
          <div className="flex gap-5" role="group" aria-label="生成対象">
            {STUDIO_PERSPECTIVES.map(value => <button key={value} type="button" aria-pressed={settings.perspective === value} disabled={formLocked || recoveryRequired} onClick={() => updateSettings({ perspective: value })}
              className={`flex h-16 min-w-16 items-center justify-center rounded-2xl px-6 py-2 text-[30px] transition-colors ${settings.perspective === value ? 'bg-[#20d0c4] text-[#111817]' : 'bg-[#353a3b] text-neutral-300 hover:bg-white/10 hover:text-white'}`}>{value}</button>)}
          </div>
        </div>
        {generationSettings}
      </>
    ) : (
      <>
        <div className="w-full px-8">
          <div className={`${sectionLabel} gap-4`}>{referenceLabel}{studioFunction === 'text' && <span className="text-[26px] text-neutral-500" data-testid="fashion-studio-reference-count">最大{STUDIO_MAX_TEXT_REFERENCES}枚、アップロード済み<span className="text-[#20d0c4]">{textReferences.length}</span>/{STUDIO_MAX_TEXT_REFERENCES}</span>}</div>
          <div className="flex flex-wrap items-center gap-5">{studioFunction === 'text' ? textReferenceTiles : referenceTile}</div>
          {studioFunction === 'underwear' && referenceShown && <label className="mt-5 flex items-start gap-4 text-[26px] leading-[36px] text-neutral-300" data-testid="fashion-studio-innerwear-consent">
            <input type="checkbox" checked={innerwearConsent} disabled={formLocked || recoveryRequired} onChange={event => setInnerwearConsent(event.target.checked)} className="mt-1 size-8 shrink-0 accent-[#20d0c4]" />
            <span>モデル写真の使用許可と、写っている人の同意を得ています</span>
          </label>}
        </div>
        {promptField(studioFunction === 'underwear' ? 'フィッティングの説明' : '指示テキスト')}
        {generationSettings}
      </>
    );

    return (
      <main className="fashion-studio-project-detail-parity dark relative min-h-[calc(100vh-50px)] overflow-clip bg-[#171b1c] text-white" data-testid="lightchain-fashion-studio-project-detail" data-lightchain-parity-shell="fashion-studio-project-detail" data-studio-theme={studioTheme}>
        {inputControls}
        <div className="fashion-studio-source-dots pointer-events-none absolute inset-0" />
        <aside className="fashion-studio-source-project-rail absolute left-4 top-6 z-30 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#262a2b] shadow-xl">
          <div className="flex h-10 items-center gap-1.5 border-b border-white/10 px-2 text-sm text-neutral-400"><img src={FASHION_STUDIO_PROJECT_ICON} alt="" className="size-5 object-contain" /><span>ファッションスタジオ</span></div>
          <div className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-300"><Link to="/flow/integration" aria-label="ファッションスタジオへ戻る" className="text-neutral-400 hover:text-white"><ChevronLeft className="h-5 w-5" /></Link><span>{visible?.title || (previewActive ? 'Untitled' : 'プロジェクト未確認')}</span></div>
        </aside>

        <aside className="fashion-studio-source-asset-trigger absolute left-4 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2 overflow-hidden rounded-xl border border-white/10 bg-[#262a2b] p-1 shadow-xl" aria-label="アセット">
          <button type="button" aria-label="アセット" className="flex size-12 cursor-pointer items-center justify-center rounded-lg bg-[#353a3b] text-neutral-200 hover:bg-white/10"><Boxes className="h-5 w-5" /></button>
        </aside>

        <section ref={viewportRef} className="fashion-studio-viewport absolute inset-0 z-10" tabIndex={0} data-mode={viewportState.mode} data-panning={viewportState.panning} data-node-dragging={Boolean(liveDrag)} data-testid="lightchain-fashion-studio-canvas" aria-label="Fashion Studio Canvas"
          onPointerDown={event => {
            const target = event.target instanceof Element ? event.target : null;
            const interaction = viewportInteractionRef.current;
            const nodeKey = target?.closest<HTMLElement>('[data-studio-node]')?.dataset.studioNode;
            // Light drags a node with the select tool; Space / the hand tool / the middle button still pan.
            if (nodeKey && interaction && event.button === 0 && !interaction.wouldPan(0) && !target?.closest(NODE_DRAG_BLOCKER)) { startNodeDrag(event, nodeKey); return; }
            const handled = interaction?.down({ pointerId: event.pointerId, button: event.button, x: event.clientX, y: event.clientY,
              interactive: interactiveTarget(event.target), objectId: nodeKey });
            if (handled) { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); if (interaction?.snapshot().panning) markUserView(); }
          }}
          onPointerMove={event => { if (moveNodeDrag(event) || viewportInteractionRef.current?.move({ pointerId: event.pointerId, x: event.clientX, y: event.clientY })) event.preventDefault(); }}
          onPointerUp={event => { if (!endNodeDrag(event.pointerId, true)) viewportInteractionRef.current?.up(event.pointerId); }}
          onPointerCancel={event => { if (!endNodeDrag(event.pointerId, false)) viewportInteractionRef.current?.cancel(); }}
          onLostPointerCapture={event => { if (!endNodeDrag(event.pointerId, true)) viewportInteractionRef.current?.up(event.pointerId); }}
          onBlur={event => { if (event.target === event.currentTarget || !event.currentTarget.contains(event.relatedTarget)) viewportInteractionRef.current?.cancel(); }}
          onKeyDown={event => { if (viewportInteractionRef.current?.key({ key: event.key, down: true, interactive: interactiveTarget(event.target),
            focused: event.target === event.currentTarget, anchor: viewportCenter() })) { event.preventDefault(); if (event.key !== ' ' && event.key !== 'Spacebar') markUserView(); } }}
          onKeyUp={event => { if (viewportInteractionRef.current?.key({ key: event.key, down: false, interactive: interactiveTarget(event.target),
            focused: event.target === event.currentTarget, anchor: viewportCenter() })) event.preventDefault(); }}>
          <div className="fashion-studio-nav-surface absolute inset-0" aria-hidden="true" />
          <div className="fashion-studio-world absolute inset-0" data-testid="fashion-studio-world" style={{ transform: studioWorldTransform(viewportState.view), transformOrigin: '0 0' }}>
            <div ref={flowRef} className="fashion-studio-flow" data-testid="fashion-studio-flow">
              <svg className="fashion-studio-edges" width={1} height={1} aria-hidden="true" data-testid="fashion-studio-edges">
                {flowEdges.map(edge => {
                  const source = rectOf(edge.source), target = rectOf(edge.target);
                  if (!source || !target) return null;
                  const active = selectedKey === edge.source || selectedKey === edge.target;
                  return <path key={`${edge.source}-${edge.target}`} d={studioEdgePath(source, target)} className={active ? 'fashion-studio-edge is-active' : 'fashion-studio-edge'} />;
                })}
              </svg>
              {(previewRoles.main && detail.roles.main.status === 'available') || (previewRoles.reference && detail.roles.reference.status === 'available') ? <div hidden aria-hidden="true" data-testid="fashion-studio-example-preloader">
                {previewRoles.main && detail.roles.main.status === 'available' && <DetailRoleImage candidates={detail.roles.main.candidates} scopeKey={scopeKey} role="main-preload" assertContext={assertContext} alt="" className="" onReady={() => setPreviewLoaded(current => ({ ...current, main: mainIdentity }))} />}
                {previewRoles.reference && detail.roles.reference.status === 'available' && <DetailRoleImage candidates={detail.roles.reference.candidates} scopeKey={scopeKey} role="reference-preload" assertContext={assertContext} alt="" className="" onReady={() => setPreviewLoaded(current => ({ ...current, reference: referenceIdentity }))} />}
              </div> : null}
              <div className="fashion-studio-node" data-studio-node="main" data-selected={selectedKey === 'main'} style={{ transform: `translate(${shownPositions.main?.x ?? 0}px, ${shownPositions.main?.y ?? 0}px)` }}>
                <FashionStudioImageNode candidates={mainImage} scopeKey={scopeKey} role="main" holdUrl={exampleHold.main} assertContext={assertContext} alt="メイン画像" testId="fashion-studio-saved-main-image" className="fashion-studio-source-main-node" objectId={detail.roles.main.objectId} selected={selectedKey === 'main'} onExpand={setLightbox} />
              </div>
              <div className="fashion-studio-node" data-studio-node="form" data-selected={selectedKey === 'form'} style={{ transform: `translate(${shownPositions.form?.x ?? 0}px, ${shownPositions.form?.y ?? 0}px)` }}>
              <section className="fashion-studio-source-generation-panel" data-studio-composer data-testid="lightchain-fashion-studio-generation-panel">
                <div className="fashion-studio-source-generation-inner">
                  <div className="flex flex-col gap-[26px] p-8">
                    <div className="text-[30px] leading-[42px] text-neutral-400" data-testid="fashion-studio-function-title">{studioFunctionInfo.label}</div>
                    <div className="flex items-center rounded-[32px] bg-gradient-to-r from-[#00a1ff66] to-[#c861ff66] px-5 py-2.5 text-[30px] leading-[42px] text-white"><img src={FLOW_TIP_ICON} alt="" aria-hidden="true" className="mr-2.5 h-[50px] w-[50px] shrink-0" />{studioFunctionInfo.banner}</div>
                  </div>
                  <div className="px-8">
                    <div className="flex items-center justify-between rounded-[32px] border border-[#3d4346] bg-[#2f3436] p-5 text-[30px]">
                      <div className="flex items-center gap-5">
                        <div className="size-[100px] overflow-hidden rounded-[20px] border border-[#3d4346] bg-[#353a3b]"><DetailRoleImage candidates={mainImage} scopeKey={scopeKey} role="main" holdUrl={exampleHold.main} assertContext={assertContext} onReady={url => setLoadedMain({ identity: mainIdentity, url })} alt="メイン画像" className="h-full w-full object-contain" /></div>
                        <span>{studioFunction === 'underwear' ? '衣服の画像' : 'メイン画像'}</span>
                      </div>
                      <button type="button" aria-label="メイン画像を差し替え" title="メイン画像を差し替え" disabled={formLocked || recoveryRequired || !scope || visible?.status !== 'success'} onClick={() => mainInputRef.current?.click()} className="flex size-[72px] items-center justify-center rounded-full border border-white/25 text-neutral-200"><ImagePlus className="h-8 w-8" /></button>
                    </div>
                  </div>
                  <div className="my-6 h-px w-full bg-[#3d4346]" />
                  <div className="flex flex-col gap-10 pb-10">{functionBody}</div>
                  <div className="w-full border-t border-[#3d4346] p-[30px]">
                    <button type="button" disabled={!inputsReady || detail.roles.main.status !== 'available' || loadedMain.identity !== mainIdentity} onClick={() => void generate()} aria-label="AI生成" className="flex h-20 w-full items-center justify-center gap-2 rounded-3xl bg-[#20d0c4] text-[30px] font-medium text-[#111817] disabled:bg-[#3d4346] disabled:text-neutral-500">
                      AI生成<Sparkles aria-hidden="true" className="h-10 w-10" /><span className="font-normal" title="Heavy は生成1回につき1ポイントです">1</span>
                    </button>
                  </div>
                </div>
              </section>
              </div>
              {showExampleResult && settings.example && <div className="fashion-studio-node" data-studio-node="sample" data-selected={selectedKey === 'sample'} style={{ transform: `translate(${shownPositions.sample?.x ?? 0}px, ${shownPositions.sample?.y ?? 0}px)` }}>
                <FashionStudioImageNode candidates={[]} scopeKey={scopeKey} role="result" assertContext={assertContext} alt="仕上がりのサンプル" testId="fashion-studio-example-result-image" className="fashion-studio-source-result-node" objectId={null} selected={selectedKey === 'sample'} label="仕上がりのサンプルをご覧ください。" staticUrl={STUDIO_EXAMPLES[settings.example].result} onExpand={setLightbox} />
              </div>}
              {resultItems.map((item, index) => {
                const key = resultKeys[index];
                return <div key={key} className="fashion-studio-node" data-studio-node={key} data-selected={selectedKey === key} style={{ transform: `translate(${shownPositions[key]?.x ?? 0}px, ${shownPositions[key]?.y ?? 0}px)` }}>
                  <FashionStudioImageNode candidates={item.candidates} scopeKey={scopeKey} role="result" assertContext={assertContext} alt="生成結果"
                    testId={index === resultItems.length - 1 ? 'fashion-studio-saved-result-image' : 'fashion-studio-history-result-image'} className="fashion-studio-source-result-node" objectId={item.objectId}
                    selected={selectedKey === key} onExpand={setLightbox} onUrl={url => { nodeUrlsRef.current[key] = url; }} />
                </div>;
              })}
            </div>
          </div>
          {/* Light's snap guides run across the canvas in #5FB7FB dashes. */}
          {snapLines.length > 0 && <div className="pointer-events-none absolute inset-0 z-[5]" aria-hidden="true">
            {snapLines.map(line => <div key={line.axis} data-testid={`canvas-snap-line-${line.axis}`} className={line.axis === 'x' ? 'fashion-studio-snap-line is-x' : 'fashion-studio-snap-line is-y'}
              style={{ transform: line.axis === 'x' ? `translateX(${line.value * (viewportState.view.zoom / 0.3) + viewportState.view.panX}px)` : `translateY(${line.value * (viewportState.view.zoom / 0.3) + viewportState.view.panY}px)` }} />)}
          </div>}
          {selectedImageRect && !liveDrag && <>
            <div className="fashion-studio-node-toolbar" data-studio-chrome data-testid="fashion-studio-node-toolbar" role="toolbar" aria-label="画像の操作"
              style={{ left: selectedImageRect.left + selectedImageRect.width / 2, top: selectedImageRect.top - 14 }}>
              {STUDIO_NEW_PROJECT_FUNCTIONS.map(fn => {
                const info = STUDIO_FUNCTIONS.find(item => item.id === fn)!;
                return <button key={fn} type="button" title={`この画像をメイン画像にして「${info.label}」の新しいプロジェクトを開きます`} disabled={!inputsReady || !scope}
                  onClick={() => void openNodeInNewProject(nodeImageUrl(selectedKey!), fn)}><StudioFunctionIcon fn={fn} className="h-4 w-4" />{info.label}</button>;
              })}
              <span className="fashion-studio-node-toolbar-divider" aria-hidden="true" />
              <button type="button" aria-label="ダウンロード" title="ダウンロード" onClick={() => void downloadNodeImage(nodeImageUrl(selectedKey!))}><Download className="h-4 w-4" /></button>
            </div>
            {resultKeys.includes(selectedKey!) && <div className="fashion-studio-node-feedback" data-studio-chrome data-testid="fashion-studio-node-feedback"
              style={{ left: selectedImageRect.left + selectedImageRect.width / 2, top: selectedImageRect.top + selectedImageRect.height + 13 }}>
              <StudioFeedbackBar documentId={projectCode} objectId={resultItems[resultKeys.indexOf(selectedKey!)]?.objectId ?? ''} fn={studioFunction}
                regenerateDisabled={!inputsReady || detail.roles.main.status !== 'available' || loadedMain.identity !== mainIdentity} onRegenerate={() => void generate()} />
            </div>}
          </>}
        </section>

        <div className="fashion-studio-source-task" data-studio-chrome aria-label="タスク">{activityContent}<span>{busy ? 1 : 0} <span className="mx-1">進行中</span>⌃</span></div>
        <div className="fashion-studio-source-canvas-toolbar" data-studio-chrome data-testid="lightchain-fashion-studio-canvas-toolbar">
          <button type="button" aria-label="選択" title="選択" aria-pressed={viewportState.mode === 'select'} className={viewportState.mode === 'select' ? 'is-active' : ''} onClick={() => viewportInteractionRef.current?.mode('select')}><MousePointer2 className="h-4 w-4" /></button>
          <button type="button" aria-label="ドラッグ" title="ドラッグ" aria-pressed={viewportState.mode === 'move'} className={viewportState.mode === 'move' ? 'is-active' : ''} onClick={() => viewportInteractionRef.current?.mode('move')}><Hand className="h-4 w-4" /></button>
          <button type="button" aria-label="画像をアップロード" title="画像をアップロード" disabled={formLocked || recoveryRequired || !scope || visible?.status !== 'success'} onClick={() => mainInputRef.current?.click()}><ImagePlus className="h-4 w-4" /></button>
          <button type="button" aria-label="取り消し(ctrl+z)" title="取り消し(ctrl+z)" disabled={!canUndo} onClick={() => stepLayoutHistory('undo')}><Undo2 className="h-4 w-4" /></button>
          <button type="button" aria-label="やり直し(ctrl+shift+z)" title="やり直し(ctrl+shift+z)" disabled={!canRedo} onClick={() => stepLayoutHistory('redo')}><Redo2 className="h-4 w-4" /></button>
        </div>
        {/* Light's bottom right (2026-11-12): zoom pill, then キャンバスを整理 / ミニマップ / グリッドにスナップ under the minimap, then ヘルプ / ショートカット. */}
        <div className="fashion-studio-source-zoom-controls" data-studio-chrome data-testid="lightchain-fashion-studio-zoom-controls">
          <StudioZoomControl zoom={viewportState.view.zoom}
            onStep={direction => { viewportInteractionRef.current?.zoomTo(steppedStudioZoom(viewportState.view.zoom, direction), viewportCenter()); markUserView(); }}
            onZoom={zoom => { viewportInteractionRef.current?.zoomTo(zoom, viewportCenter()); markUserView(); }}
            onFit={() => { fitFlow(); markUserView(); }} />
        </div>
        <div ref={navigationRef} className="fashion-studio-canvas-navigation" data-studio-chrome data-testid="canvas-navigation">
          {minimapOpen && <StudioMinimap nodes={nodeRects} view={viewportState.view} size={canvasSize} canvasRef={viewportRef} navigationRef={navigationRef}
            onView={view => { viewportInteractionRef.current?.set(view); markUserView(); }} />}
          <div className="flex gap-2">
            <button type="button" className="fashion-studio-round-button" aria-label="キャンバスを整理" title="キャンバスを整理" disabled={!allMeasured} onClick={arrangeCanvas}><LayoutGrid className="h-6 w-6" /></button>
            <button type="button" className={`fashion-studio-round-button${minimapOpen ? ' is-on' : ''}`} aria-label="ミニマップ" title="ミニマップ" aria-pressed={minimapOpen} aria-expanded={minimapOpen} onClick={() => setMinimapOpen(open => !open)}><MapPinned className="h-6 w-6" /></button>
            <button type="button" className={`fashion-studio-round-button${snapEnabled ? ' is-on' : ''}`} aria-label="グリッドにスナップ" title="グリッドにスナップ" aria-pressed={snapEnabled}
              onClick={() => setSnapEnabled(enabled => { writeStudioSnapEnabled(!enabled); if (enabled) setSnapLines([]); return !enabled; })}><Magnet className="h-6 w-6" /></button>
          </div>
        </div>
        <div className="fashion-studio-help-buttons" data-studio-chrome>
          <button type="button" className="fashion-studio-round-button" aria-label="ヘルプ" title="ヘルプ" onClick={() => setHelpOpen(true)}><BookOpen className="h-5 w-5" /></button>
          <button type="button" className={`fashion-studio-round-button${shortcutsOpen ? ' is-on' : ''}`} aria-label="ショートカット" title="ショートカット" aria-pressed={shortcutsOpen} onClick={() => setShortcutsOpen(open => !open)}><Keyboard className="h-5 w-5" /></button>
        </div>
        {shortcutsOpen && <StudioShortcutsPanel onClose={() => setShortcutsOpen(false)} />}
        {helpOpen && <StudioHelpDialog onClose={() => setHelpOpen(false)} />}
        {themeSlot && createPortal(<button type="button" data-testid="studio-theme-toggle" aria-label={studioTheme === 'light' ? 'ダークモードに切り替え' : 'ライトモードに切り替え'} title={studioTheme === 'light' ? 'ダークモードに切り替え' : 'ライトモードに切り替え'}
          onClick={() => setStudioTheme(theme => theme === 'light' ? 'dark' : 'light')}
          className="ml-4 flex size-8 items-center justify-center rounded-lg text-neutral-300 transition hover:bg-white/10 hover:text-white">{studioTheme === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>, themeSlot)}

        <div className="fashion-studio-source-points" aria-label="ポイント"><Sparkles className="h-4 w-4" />{visible?.remainingUnits?.toLocaleString('en-US') ?? '未確認'}</div>
        <div className="fashion-studio-source-image-search" aria-label="画像検索"><Search className="h-4 w-4" />画像検索<span className="ml-auto">☷<span className="inline-block w-4" aria-hidden="true" />⇧⌄</span></div>
        {promptExpanded && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-8" role="dialog" aria-label="合成指示を全画面で編集">
          <div className="flex h-[70vh] w-[min(880px,100%)] flex-col gap-4 rounded-2xl border border-[#3d4346] bg-[#262a2b] p-6">
            <div className="flex items-center justify-between text-base text-neutral-200">合成指示<button type="button" aria-label="閉じる" onClick={() => setPromptExpanded(false)}><X className="h-5 w-5" /></button></div>
            <textarea value={prompt} maxLength={2000} disabled={formLocked || recoveryRequired} onChange={event => setPrompt(event.target.value)} className="min-h-0 flex-1 resize-none rounded-xl border border-[#3d4346] bg-[#353a3b] p-4 text-base leading-7 text-white outline-none" aria-label="合成指示" />
            <div className="flex items-center justify-between text-sm text-neutral-400"><span><span className="text-[#20d0c4]">{prompt.length}</span>/2000</span><button type="button" onClick={() => setPromptExpanded(false)} className="rounded-lg bg-[#20d0c4] px-5 py-2 text-sm font-medium text-[#111817]">決定</button></div>
          </div>
        </div>}
        {fluxConsent && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="fashion-studio-flux-consent-title" data-testid="fashion-studio-flux-consent" className="w-full max-w-[440px] rounded-2xl border border-white/10 bg-[#262a2b] p-6 text-sm text-neutral-200 shadow-2xl">
            <h2 id="fashion-studio-flux-consent-title" className="text-base font-semibold text-white">別のモデルで作り直しますか？</h2>
            <p className="mt-3 leading-6 text-neutral-300">OpenAI の安全確認で断られました。FLUX.2 で同じ指示から作り直せます。参考画像も送るため、画像の使用許可と、写っている人の同意が必要です。</p>
            {fluxConsent.trimmed && <p className="mt-2 leading-6 text-neutral-400">FLUX.2 に送れる参考画像は{STUDIO_FLUX_MAX_REFERENCES}枚までのため、最初の{STUDIO_FLUX_MAX_REFERENCES}枚を使います。</p>}
            <label className="mt-4 flex items-start gap-3 leading-6">
              <input type="checkbox" checked={fluxConsent.checked} onChange={event => setFluxConsent(current => current && { ...current, checked: event.target.checked })} className="mt-1 size-4 shrink-0 accent-[#20d0c4]" />
              <span>参考画像の使用許可と、写っている人の同意を得ています</span>
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => answerFluxConsent(false)} className="h-9 rounded-lg px-4 text-neutral-300 hover:bg-white/10">やめる</button>
              <button type="button" disabled={!fluxConsent.checked} onClick={() => answerFluxConsent(true)} className="h-9 rounded-lg bg-[#20d0c4] px-4 font-medium text-[#111817] disabled:opacity-40">作り直す</button>
            </div>
          </div>
        </div>}
        {maskDialog && loadedMain.url && <MaskPaintDialog imageUrl={loadedMain.url} hint={regionPoints.length > 1 ? `範囲指定で生成（ポイント${Math.max(1, regionPoints.findIndex(point => point.slot === maskDialog.slot) + 1)}）` : '範囲指定で生成'} paneTitle="参考画像の服を合わせたい部分をマスクで選択してください" initialMask={maskDialog.initial} onCancel={() => setMaskDialog(null)} onConfirm={confirmMask} />}
        {canvasPicker && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-8" role="dialog" aria-label="キャンバスから選択" onClick={() => setCanvasPicker(null)}>
          <div className="w-[min(720px,100%)] rounded-2xl border border-[#3d4346] bg-[#262a2b] p-6" onClick={event => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between text-base text-neutral-200">キャンバスから選択<button type="button" aria-label="閉じる" onClick={() => setCanvasPicker(null)}><X className="h-5 w-5" /></button></div>
            <div className="grid max-h-[60vh] grid-cols-4 gap-3 overflow-y-auto">
              {canvasPicker.images.map(image => <button key={image.key} type="button" aria-label="この画像を参考画像にする" onClick={() => void chooseCanvasImage(canvasPicker.slot, image.url)} className="aspect-[3/4] overflow-hidden rounded-xl border border-[#3d4346] bg-[#353a3b] hover:border-[#20d0c4]"><img src={image.url} alt="" className="h-full w-full object-cover" /></button>)}
            </div>
          </div>
        </div>}
        {lightboxView}
      </main>
    );
  }

  return (
    <main className="dark relative h-[calc(100vh-50px)] min-h-[620px] overflow-clip bg-[#171b1c] text-white" data-testid="lightchain-fashion-studio-detail" data-lightchain-parity-shell="fashion-studio-detail">
      {inputControls}
      <div className="fashion-studio-source-dots pointer-events-none absolute inset-0" />
      <aside className="absolute left-4 top-6 z-10 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#262a2b]"><div className="flex h-10 items-center gap-1.5 border-b border-white/10 px-2 text-sm text-neutral-400"><img src={FASHION_STUDIO_PROJECT_ICON} alt="" className="size-5 object-contain" /><span>ファッションスタジオ</span></div><Link to="/flow/integration" aria-label="ファッションスタジオへ戻る" className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-300 transition hover:bg-white/5 hover:text-white"><ChevronLeft className="h-5 w-5" /><span>Untitled</span></Link></aside>
      {/* Light (2026-11-11): one centred column — the hint, the four example buttons in one row, the 624×360 drop box, then the loading line. */}
      <section aria-label="サンプル" className="absolute left-1/2 top-1/2 z-[4] flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-8 text-center">
        <p className="text-lg font-medium leading-6 text-neutral-400">下から機能を選んでサンプルを見るか、「画像を追加」をクリックしてください。</p>
        <div className="flex flex-wrap justify-center gap-4" data-testid="fashion-studio-functions">
          {STUDIO_FUNCTIONS.map((item) => <button key={item.id} type="button" disabled={formLocked || recoveryRequired || !scope || Boolean(exampleState.loading)} onClick={() => void loadExample(item.id)}
            className="relative flex h-12 w-auto shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-[#25292b] px-4 text-base text-neutral-300 transition-colors hover:bg-[#2f3436] hover:text-white disabled:cursor-wait disabled:opacity-60">
            <StudioFunctionIcon fn={item.id} className="h-6 w-6" />{item.label}
            {item.badge && <span className="absolute -right-2 -top-2.5 rounded-full bg-[linear-gradient(90deg,#8fe9ff,#d9c2ff)] px-2 text-xs leading-5 text-neutral-900">{item.badge}</span>}
          </button>)}
        </div>
        <label className="flex h-[360px] max-h-[45vh] w-[624px] max-w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-4 backdrop-blur-sm transition-colors hover:border-[#0bcabc] hover:bg-white/[0.06]" data-testid="fashion-studio-detail-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); uploadOwnMain(event.dataTransfer.files?.[0]); }}>
          <ImagePlus aria-hidden="true" className="size-8 text-neutral-300" />
          <span className="text-base font-medium text-neutral-400">ここをクリックまたはドラッグして画像を追加</span>
          <span className="text-sm text-neutral-500">jpg、jpeg、png、webp形式の画像（最大20M）に対応</span>
          <input className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" aria-label="画像を追加" disabled={formLocked || recoveryRequired || !scope} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; uploadOwnMain(file); }} />
          {activeUpload?.preview && busy && <img src={activeUpload.preview} alt="アップロード準備中" className="h-32 w-32 object-contain" />}
        </label>
        <div className="absolute top-full mt-3 min-h-6 text-sm text-neutral-400" role="status" aria-live="polite">
          {exampleState.loading || (busy && pendingExampleRef.current) ? 'サンプルを読み込み中…'
            : exampleState.failed ? <>{STUDIO_EXAMPLE_FAILED} <button type="button" className="text-[#0bcabc] underline" onClick={() => void loadExample(exampleState.failed!)}>再試行</button></> : null}
        </div>
      </section>
      {activityValue && activityValue !== 'success' && <div className="absolute bottom-6 left-1/2 -translate-x-1/2" aria-label="タスク">{activityContent}</div>}
    </main>
  );
}
