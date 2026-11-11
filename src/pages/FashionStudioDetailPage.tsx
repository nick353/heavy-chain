import {
  BookOpen,
  BookMarked,
  Boxes,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  ChevronLeft,
  Hand,
  ImagePlus,
  Maximize2,
  MousePointer2,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { studioProviderPrompt } from '../lib/studioFunctionPrompt';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { cloudflareDataPlane, type ArtifactPersistenceContext } from '../lib/cloudflareApi';
import { resolveGeneratedImageUrlWithStatus } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import { canSelectConfirmedBrand } from '../lib/authBrandSelection';
import { createFashionStudioThumbnailController, fashionStudioThumbnailScopeKey, type FashionStudioThumbnailState } from '../lib/fashionStudioThumbnails';
import { createFashionStudioDetailHydration, emptyFashionStudioDetail, extractFashionStudioSavedDetail, fashionStudioDetailScopeKey, type FashionStudioDetailHydrationState, type FashionStudioDetailScope } from '../lib/fashionStudioDetailHydration';
import { createFashionStudioInputController, createFashionStudioGenerationAdapters, readFashionStudioUpload, type FashionStudioInputState } from '../lib/fashionStudioDetailAdapter';
import { createFashionStudioDetailGeneration, type FashionStudioGenerationOutcome } from '../lib/fashionStudioDetailGeneration';
import { createStudioAckStore } from '../lib/fashionStudioPendingAck';
import { createCanvasDocument, getCanvasDocument, updateCanvasDocument, type CanvasDocumentRecord } from '../lib/canvasDocumentPersistence';
import { editImageWithPrompt, assertCompletedImageEditResult } from '../lib/imageApi';
import { persistProviderResultArtifact } from '../lib/providerResultPersistence';
import { createStudioViewportInteraction, STUDIO_DEFAULT_VIEWPORT, STUDIO_INTERACTIVE_SELECTOR, studioWorldTransform, type StudioViewportState } from '../lib/studioViewport';
import { DEFAULT_STUDIO_SETTINGS, STUDIO_ASPECT_RATIOS, STUDIO_EXAMPLES, STUDIO_GARMENT_AREAS, STUDIO_PERSPECTIVES, STUDIO_TEXT_SAMPLE_PROMPT,
  STUDIO_UNDERWEAR_NO_MODEL_PROMPT, STUDIO_UNDERWEAR_WITH_MODEL_PROMPT, loadStudioExampleFile, readStudioSettings, studioAspectRatioLabel,
  studioFunctionPromptText, writeStudioSettings, type StudioAspectRatio, type StudioFunctionId, type StudioGarmentArea, type StudioSettings } from '../lib/fashionStudioExamples';
import { buildRegionGuideUrl, naturalImageSize, regionMaskImageData, regionMaskToDataUrl } from '../lib/fashionStudioRegionGuide';
import { MaskPaintDialog } from '../components/lightchain/MaskPaintDialog';
import { StudioFunctionIcon } from '../components/lightchain/StudioFunctionIcon';

const FASHION_STUDIO_PROJECT_ICON = '/lightchain-assets/icons/fashion-studio.png';

/** Light's four Fashion Studio entry functions; choosing one loads its example (src/lib/fashionStudioExamples.ts). */
const STUDIO_FUNCTIONS: readonly { id: StudioFunctionId; label: string; badge?: string; banner: string }[] = [
  { id: 'text', label: 'テキストで生成', banner: '指令と参考画像を使ってワンクリック生成' },
  // Light allows up to three fusion points per main image; Heavy's project keeps one reference image, so one point.
  { id: 'region', label: '範囲指定で生成', banner: 'メイン画像1枚につき、1か所の定向融合が可能です' },
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
const examplePrompt = (fn: StudioFunctionId) => fn === 'text' ? STUDIO_TEXT_SAMPLE_PROMPT : fn === 'underwear' ? STUDIO_UNDERWEAR_WITH_MODEL_PROMPT : '';
const regionMaskKey = (projectId: string) => `heavy-fashion-studio-region-mask:${projectId}`;
const REGION_EXAMPLE_MASK = '/lightchain-assets/flow-examples/directional-mask.png';
const FLOW_TIP_ICON = '/lightchain-assets/static/flow_tip.png';
const SAVED_PROMPTS_KEY = 'heavy-fashion-studio-saved-prompts';
const STUDIO_EXAMPLE_LOADED = 'サンプルを読み込むと、ノードの構成を変更できます。';
const STUDIO_EXAMPLE_FAILED = 'サンプルの読み込みに失敗しました。もう一度お試しください。';
/** Light's flow (measured at its 45% fit, 2026-11-11): image nodes 448px wide (CSS), the form 310px, gaps 83px and 89px. */
const FLOW_GAP_IN = 83;
const FLOW_GAP_OUT = 89;
/** Heavy's zoom 0.3 shows the flow at Light's fitted size, which Light labels 45%. */
const zoomPercent = (zoom: number) => Math.round(zoom / 0.3 * 45);

function FlowEdge({ width, from, to, height }: { width: number; from: number; to: number; height: number }) {
  const mid = width / 2;
  return (
    <svg className="fashion-studio-flow-edge" width={width} height={Math.max(height, 1)} aria-hidden="true">
      <path d={`M0 ${from} C ${mid} ${from}, ${mid} ${to}, ${width} ${to}`} fill="none" stroke="#5e6263" strokeWidth={1.5} />
    </svg>
  );
}

function DetailRoleImage({ candidates, scopeKey, role, alt, className, assertContext, onReady }: {
  candidates: readonly string[]; scopeKey: string; role: string; alt: string; className: string; assertContext: () => void; onReady?: (url: string) => void;
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
}) {
  const [url, setUrl] = useState('');
  const shown = staticUrl || url;
  return (
    <div className="fashion-studio-flow-node" data-flow-node={role}>
      {label && <p className="fashion-studio-flow-node-label">{label}</p>}
      <figure className={`fashion-studio-source-image-node ${className}`} data-testid={testId} data-studio-object-id={objectId ?? undefined} data-selected={selected} onDragStart={event => event.preventDefault()}>
        {staticUrl ? <img src={staticUrl} alt={alt} className="block h-auto w-full" draggable={false} />
          : <DetailRoleImage candidates={candidates} scopeKey={scopeKey} role={role} assertContext={assertContext} alt={alt} className="block h-auto min-h-[200px] w-full object-contain" onReady={setUrl} />}
        <button type="button" className="fashion-studio-source-expand" aria-label="全画面表示です" title="全画面表示" disabled={!shown} onClick={() => shown && onExpand(shown)}>
          <Maximize2 className="h-5 w-5" />
        </button>
      </figure>
    </div>
  );
}

/**
 * Light Chain uses the same deep-link for a new file and an existing project,
 * but the existing-project state exposes the image-search workbench. Keep the
 * empty upload canvas for the new-file URL and render the observed project
 * shell when a board project code is present.
 */
export function FashionStudioDetailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, currentBrand, brandState } = useAuthStore();
  const [hydration, setHydration] = useState<FashionStudioDetailHydrationState | null>(null);
  const [promptDraft, setPromptDraft] = useState({ scopeKey: '', value: '' });
  const [upload, setUpload] = useState<(FashionStudioInputState & { scopeKey: string }) | null>(null);
  const [generation, setGeneration] = useState<(FashionStudioGenerationOutcome & { scopeKey: string }) | null>(null);
  const [activity, setActivity] = useState({ scopeKey: '', value: '' });
  const [loadedMain, setLoadedMain] = useState({ identity: '', url: '' });
  const mainInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const uploadControllerRef = useRef<ReturnType<typeof createFashionStudioInputController> | null>(null);
  const generationControllerRef = useRef<ReturnType<typeof createFashionStudioDetailGeneration> | null>(null);
  const busyRef = useRef(false);
  const logicalAttemptRef = useRef<{ identity: string; key: string } | null>(null);
  const hasProject = Boolean(searchParams.get('boardProjectCode'));
  const projectCode = searchParams.get('boardProjectCode') ?? '';
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
  const [pendingExample, setPendingExample] = useState<{ projectCode: string; fn: StudioFunctionId } | null>(null);
  const exampleReferenceStartedRef = useRef('');
  const [exampleLoad, setExampleLoad] = useState<{ scopeKey: string; loading: StudioFunctionId | null; failed: StudioFunctionId | null }>({ scopeKey: '', loading: null, failed: null });
  const exampleState = exampleLoad.scopeKey === scopeKey ? exampleLoad : { loading: null, failed: null };
  const [regionMaskState, setRegionMaskState] = useState<{ projectCode: string; url: string } | null>(null);
  const storedRegionMask = (() => { try { return projectCode ? window.localStorage.getItem(regionMaskKey(projectCode)) ?? '' : ''; } catch { return ''; } })();
  const regionMaskUrl = regionMaskState?.projectCode === projectCode ? regionMaskState.url : storedRegionMask;
  const setRegionMask = (url: string) => {
    try { if (url) window.localStorage.setItem(regionMaskKey(projectCode), url); else window.localStorage.removeItem(regionMaskKey(projectCode)); } catch { /* storage unavailable */ }
    setRegionMaskState({ projectCode, url });
  };
  const [maskDialog, setMaskDialog] = useState<{ initial: ImageData | null } | null>(null);
  const [loadedReference, setLoadedReference] = useState({ identity: '', url: '' });
  const providerContextRef = useRef({ hasReference: false });
  const [lightbox, setLightbox] = useState('');
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<string[]>(() => {
    try { const value = JSON.parse(window.localStorage.getItem(SAVED_PROMPTS_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 50) : []; }
    catch { return []; }
  });
  useEffect(() => {
    if (!projectCode) return;
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
          featureType: `fashion-studio-detail-${input.role}-input`, title: 'Fashion Studio', imageUrl: input.imageUrl, prompt: null,
          metadata: { inputOperationId: input.requestId, layerRole: input.role === 'main' ? 'original-base' : 'material-reference' },
          canvasProjectId: requested.documentId || null, sourceStoragePath: null }, undefined, persistenceContext);
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
        garment: settingsRef.current.garment, perspective: settingsRef.current.perspective, hasReference: providerContextRef.current.hasReference }), brandId, options),
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
  const recoveryRequired = (activeUpload?.status === 'failure' && activeUpload.recoverable === true) || activeGeneration?.status === 'failure';
  const mainIdentity = JSON.stringify([scopeKey, detail.roles.main.objectId, detail.roles.main.candidates]);
  const uploadFile = async (file: File | undefined, role: 'main' | 'reference') => {
    if (!file || !scope || busyRef.current || recoveryRequired) return;
    const capturedScopeKey = scopeKey;
    try {
      assertContext(); busyRef.current = true;
      if (!uploadControllerRef.current) throw new Error('fashion_studio_upload_unavailable');
      await uploadControllerRef.current.start(file, role, scope);
    } catch (error) {
      if (currentScopeRef.current === capturedScopeKey) { setUpload({ scopeKey, status: 'failure', role, error: error instanceof Error ? error.message : String(error) }); setActivity({ scopeKey, value: 'failure' }); }
    } finally { if (currentScopeRef.current === capturedScopeKey) busyRef.current = false; }
  };
  const referenceIdentity = JSON.stringify([scopeKey, detail.roles.reference.objectId, detail.roles.reference.candidates]);
  const regionGuideRef = useRef<{ key: string; url: string } | null>(null);
  const regionGuideUrl = async (mainUrl: string, maskUrl: string) => {
    const key = JSON.stringify([mainUrl, maskUrl]);
    if (regionGuideRef.current?.key === key) return regionGuideRef.current.url;
    const url = await buildRegionGuideUrl(mainUrl, maskUrl);
    regionGuideRef.current = { key, url };
    return url;
  };
  const generate = async (retry = false) => {
    if (!scope || busyRef.current || !generationControllerRef.current) return;
    const fn = studioFunctionRef.current;
    const referenceAvailable = detail.roles.reference.status === 'available' && !settings.referenceOff;
    if (!retry) {
      // Light checks the form when AI生成 is pressed and says what is missing.
      if (detail.roles.main.status !== 'available' || loadedMain.identity !== mainIdentity || !loadedMain.url) { toast.error('メイン画像を追加してください'); return; }
      if ((fn === 'text' || fn === 'underwear') && !prompt.trim()) { toast.error(fn === 'underwear' ? 'フィッティングの説明を入力してください' : '指示テキストを入力してください'); return; }
      if (fn === 'region' && !referenceAvailable) { toast.error('参考画像を追加してください'); return; }
      if (fn === 'region' && !regionMaskUrl) { toast.error('マスク調整で範囲を選択してください'); return; }
    }
    const capturedScopeKey = scopeKey;
    try {
      assertContext(); busyRef.current = true; setActivity({ scopeKey, value: retry ? 'recovering' : 'preparing' });
      let outcome: FashionStudioGenerationOutcome;
      if (retry) outcome = await generationControllerRef.current.retry();
      else {
        if (!detail.roles.main.objectId || detail.roles.reference.status === 'ambiguous') throw new Error('fashion_studio_generation_input_unverified');
        const promptText = studioFunctionPromptText(fn, prompt.trim(), settings);
        const references = referenceAvailable
          ? [loadedReference.identity === referenceIdentity && loadedReference.url ? loadedReference.url : detail.roles.reference.candidates[0]] : [];
        if (fn === 'region') references.push(await regionGuideUrl(loadedMain.url, regionMaskUrl));
        assertContext();
        providerContextRef.current = { hasReference: referenceAvailable };
        const editOptions = fn !== 'region' && settings.aspectRatio !== 'auto' ? { aspectRatio: settings.aspectRatio } : undefined;
        const inputIdentity = JSON.stringify([scopeKey, mainIdentity, fn, promptText, references, editOptions ?? null]);
        if (logicalAttemptRef.current?.identity !== inputIdentity) logicalAttemptRef.current = { identity: inputIdentity, key: crypto.randomUUID() };
        outcome = await generationControllerRef.current.start({ scope, logicalAttemptKey: logicalAttemptRef.current.key,
          main: { objectId: detail.roles.main.objectId, imageUrl: loadedMain.url, verified: true }, referenceImageUrls: references, prompt: promptText,
          ...(editOptions ? { editOptions } : {}) });
      }
      assertContext();
      if (outcome.status === 'success' && outcome.document) setHydration(previous => ({ scopeKey, status: 'success', title: outcome.document!.title,
        detail: extractFashionStudioSavedDetail(outcome.document!.snapshot), remainingUnits: previous?.scopeKey === scopeKey ? previous.remainingUnits : null }));
      setGeneration({ ...outcome, scopeKey }); setActivity({ scopeKey, value: outcome.status === 'success' ? 'success' : 'failure' });
    } catch (error) {
      if (currentScopeRef.current === capturedScopeKey) { setGeneration({ scopeKey, status: 'failure', stage: 'provider', requestId: '', error: error instanceof Error ? error.message : String(error) }); setActivity({ scopeKey, value: 'failure' }); }
    } finally { if (currentScopeRef.current === capturedScopeKey) busyRef.current = false; }
  };
  const retryUpload = async () => {
    if (busyRef.current || !uploadControllerRef.current) return;
    const captured = scopeKey; busyRef.current = true;
    try { await uploadControllerRef.current.retry(); } finally { if (currentScopeRef.current === captured) busyRef.current = false; }
  };
  /** Light: choosing a function on the empty canvas loads its example and saves the project. */
  const loadExample = async (fn: StudioFunctionId) => {
    if (!scope || busyRef.current || recoveryRequired || exampleState.loading) return;
    const captured = scopeKey;
    setExampleLoad({ scopeKey: captured, loading: fn, failed: null });
    let file: File;
    try { file = await loadStudioExampleFile(STUDIO_EXAMPLES[fn].main); }
    catch { if (currentScopeRef.current === captured) setExampleLoad({ scopeKey: captured, loading: null, failed: fn }); return; }
    pendingExampleRef.current = fn;
    await uploadFile(file, 'main');
    setExampleLoad(current => current.scopeKey === captured ? { scopeKey: captured, loading: null, failed: null } : current);
  };
  const uploadOwnMain = (file: File | undefined) => { pendingExampleRef.current = null; void uploadFile(file, 'main'); };
  const uploadReference = (file: File | undefined) => {
    if (!file) return;
    if (settings.referenceOff) updateSettings({ referenceOff: false });
    if (studioFunction === 'underwear' && prompt === STUDIO_UNDERWEAR_NO_MODEL_PROMPT) setPrompt(STUDIO_UNDERWEAR_WITH_MODEL_PROMPT);
    void uploadFile(file, 'reference');
  };
  const removeReference = () => {
    updateSettings({ referenceOff: true });
    if (studioFunction === 'underwear' && prompt === STUDIO_UNDERWEAR_WITH_MODEL_PROMPT) setPrompt(STUDIO_UNDERWEAR_NO_MODEL_PROMPT);
  };
  // The example's main image created the project; add its reference (model / fusion garment) and Light's toast.
  useEffect(() => {
    if (!pendingExample || pendingExample.projectCode !== projectCode || visible?.status !== 'success' || detail.roles.main.status !== 'available') return;
    const example = STUDIO_EXAMPLES[pendingExample.fn];
    if (pendingExample.fn === 'region' && !regionMaskUrl) setRegionMask(REGION_EXAMPLE_MASK);
    if (!example.reference || detail.roles.reference.status === 'available') { setPendingExample(null); toast.success(STUDIO_EXAMPLE_LOADED); return; }
    if (exampleReferenceStartedRef.current === projectCode || busy) return;
    exampleReferenceStartedRef.current = projectCode;
    void loadStudioExampleFile(example.reference).then(file => uploadFile(file, 'reference')).catch(() => { setPendingExample(null); toast.error(STUDIO_EXAMPLE_FAILED); });
  }, [pendingExample, projectCode, visible?.status, detail.roles.main.status, detail.roles.reference.status, busy]);
  const openMaskDialog = async () => {
    if (!loadedMain.url) { toast.error('メイン画像を追加してください'); return; }
    let initial: ImageData | null = null;
    if (regionMaskUrl) {
      try { const size = await naturalImageSize(loadedMain.url); initial = await regionMaskImageData(regionMaskUrl, size.width, size.height); } catch { initial = null; }
    }
    setMaskDialog({ initial });
  };
  const confirmMask = (mask: ImageData | null) => { setMaskDialog(null); setRegionMask(mask ? regionMaskToDataUrl(mask) : ''); };
  const savePrompt = () => {
    const value = prompt.trim();
    if (!value) { toast.error('保存する指示がありません'); return; }
    const next = [value, ...savedPrompts.filter(item => item !== value)].slice(0, 50);
    setSavedPrompts(next);
    try { window.localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    toast.success('プロンプトを保存しました');
  };
  // Light's flow: main → form → result side by side, joined by curved edges, fitted into view.
  const flowRef = useRef<HTMLDivElement>(null);
  const [flowSize, setFlowSize] = useState({ main: 0, form: 0, result: 0, width: 0, height: 0 });
  const showExampleResult = Boolean(settings.example) && detail.roles.result.status !== 'available';
  const hasResultNode = detail.roles.result.status === 'available' || showExampleResult;
  useEffect(() => {
    const flow = flowRef.current;
    if (!hasProject || !flow) return;
    const measure = () => {
      const height = (role: string) => flow.querySelector<HTMLElement>(`[data-flow-node="${role}"]`)?.offsetHeight ?? 0;
      const next = { main: height('main'), form: height('form'), result: height('result'), width: flow.offsetWidth, height: flow.offsetHeight };
      setFlowSize(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(flow); flow.querySelectorAll('[data-flow-node]').forEach(node => observer.observe(node));
    measure();
    return () => observer.disconnect();
  }, [hasProject, hasResultNode, studioFunction, viewportScopeKey]);
  const fittedRef = useRef('');
  const fitFlow = () => {
    const viewport = viewportRef.current; const interaction = viewportInteractionRef.current;
    if (!viewport || !interaction || !flowSize.width || !flowSize.height) return false;
    const bounds = viewport.getBoundingClientRect();
    // Light's fitView keeps a margin around the nodes and never enlarges past its fitted size.
    const scale = Math.min(1, (bounds.width * 0.92) / flowSize.width, (bounds.height * 0.86) / flowSize.height);
    interaction.set({ zoom: STUDIO_DEFAULT_VIEWPORT.zoom * scale, panX: (1 - scale) * bounds.width / 2, panY: (1 - scale) * bounds.height / 2 });
    return true;
  };
  useEffect(() => {
    const key = JSON.stringify([viewportScopeKey, hasResultNode, studioFunction]);
    if (fittedRef.current === key || !flowSize.width) return;
    if (fitFlow()) fittedRef.current = key;
  }, [flowSize, viewportScopeKey, hasResultNode, studioFunction]);
  const activityText = ({ preparing: '準備中', generating: '生成中', recovering: '復旧中', saving: '保存中', failure: '失敗', success: '完了' } as Record<string, string>)[activityValue] || 'タスク';
  const activityContent = <><span role="status">{activityText}</span>{(activeUpload?.error || activeGeneration?.error) && <span role="alert">{activeUpload?.error || activeGeneration?.error}</span>}{activeUpload?.status === 'failure' && activeUpload.recoverable && <button type="button" disabled={busy} onClick={() => void retryUpload()}>保存を再試行</button>}{activeGeneration?.status === 'failure' && <button type="button" disabled={busy} onClick={() => void generate(true)}>保存を再試行</button>}</>;
  const inputControls = <><input ref={mainInputRef} className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" disabled={busy || recoveryRequired} aria-label="メイン画像ファイル" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void uploadFile(file, 'main'); }} /><input ref={referenceInputRef} className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" disabled={busy || recoveryRequired} aria-label="参考画像ファイル" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; uploadReference(file); }} /></>;
  const lightboxView = lightbox && (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-8" role="dialog" aria-label="全画面表示" onClick={() => setLightbox('')}>
      <img src={lightbox} alt="全画面表示" className="max-h-full max-w-full object-contain" />
      <button type="button" aria-label="閉じる" className="absolute right-6 top-6 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" onClick={() => setLightbox('')}><X className="h-5 w-5" /></button>
    </div>
  );

  if (hasProject) {
    const mainImage = detail.roles.main.candidates;
    const resultImage = detail.roles.result.candidates;
    const referenceShown = detail.roles.reference.status === 'available' && !settings.referenceOff;
    const inputsReady = !busy && !recoveryRequired && visible?.status === 'success';
    const referenceLabel = studioFunction === 'underwear' ? 'モデル図' : '参考画像';
    const sectionLabel = 'mb-5 flex items-center text-[36px] leading-[48px] text-neutral-400';
    const selectBox = 'flex h-[88px] w-full items-center rounded-2xl border border-[#3d4346] bg-[#353a3b] text-[30px] text-neutral-300';
    const referenceTile = referenceShown
      ? <div className="relative size-[120px] shrink-0 rounded-[20px] border border-[#3d4346] bg-[#353a3b]">
          <DetailRoleImage candidates={detail.roles.reference.candidates} scopeKey={scopeKey} role="reference" assertContext={assertContext} alt={referenceLabel} className="h-full w-full rounded-[20px] object-cover" onReady={url => setLoadedReference({ identity: referenceIdentity, url })} />
          <button type="button" aria-label={`${referenceLabel}を削除`} disabled={!inputsReady} onClick={removeReference} className="absolute -right-3 -top-3 flex size-10 items-center justify-center rounded-full bg-[#505c5e] text-white"><X className="h-6 w-6" /></button>
        </div>
      : <button type="button" aria-label={`${referenceLabel}を追加`} disabled={!inputsReady || !scope} onClick={() => referenceInputRef.current?.click()} className="flex size-[120px] shrink-0 items-center justify-center rounded-[20px] border border-[#3d4346] bg-[#353a3b] text-neutral-300"><ImagePlus className="h-10 w-10" /></button>;
    const promptField = (label: string) => (
      <div className="w-full px-8">
        <label className={sectionLabel} htmlFor="fashion-studio-detail-prompt">{label}<span className="ml-1 text-[#f04438]">*</span></label>
        <div className="relative flex h-[420px] flex-col justify-between gap-5 rounded-[32px] border border-[#3d4346] bg-[#353a3b] p-5">
          <textarea id="fashion-studio-detail-prompt" value={prompt} disabled={busy || recoveryRequired} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} className="h-full resize-none border-none bg-transparent p-0 text-[30px] leading-[42px] text-white outline-none" aria-label="指令を入力してください。" />
          <div className="flex items-center gap-4 text-neutral-300">
            <button type="button" aria-label="合成指示を全画面で編集" title="全画面で編集" onClick={() => setPromptExpanded(true)}><Maximize2 className="h-[34px] w-[34px]" /></button>
            <button type="button" aria-label="プロンプトを保存" title="プロンプトを保存" onClick={savePrompt}><Save className="h-[34px] w-[34px]" /></button>
            <button type="button" aria-label="プロンプトライブラリ" title="プロンプトライブラリ" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(open => !open)}><BookMarked className="h-[34px] w-[34px]" /></button>
            <span className="ml-auto text-[30px] text-neutral-400"><span className="text-[#20d0c4]">{prompt.length}</span>/2000</span>
            <button type="button" disabled={busy || recoveryRequired} onClick={() => setPrompt('')} className="rounded-xl bg-[#505c5e] px-5 py-2 text-[30px] text-white">全削除</button>
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
            <select aria-label="比率" value={settings.aspectRatio} disabled={busy || recoveryRequired} onChange={event => updateSettings({ aspectRatio: event.target.value as StudioAspectRatio })} className="absolute inset-0 cursor-pointer opacity-0">
              {STUDIO_ASPECT_RATIOS.map(value => <option key={value} value={value}>{studioAspectRatioLabel(value)}</option>)}
            </select>
          </label>
          <label className={`${selectBox} relative min-w-0 flex-1 gap-3 px-8`}>
            <span aria-hidden="true" className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[10px] border-[3px] border-current text-[18px] font-bold">HD</span>
            <span>2K</span>
            <ChevronDown aria-hidden="true" className="ml-auto h-10 w-10 shrink-0 opacity-50" />
            {/* Heavy stores every studio result at Light's 2K size (2048px class); 1K/4K are not offered. */}
            <select aria-label="画質" value="2k" disabled={busy || recoveryRequired} onChange={() => undefined} className="absolute inset-0 cursor-pointer opacity-0"><option value="2k">2K</option></select>
          </label>
        </div>
      </div>
    );
    const functionBody = studioFunction === 'region' ? (
      <div className="flex w-full flex-col gap-6 px-8" data-testid="fashion-studio-region-points">
        <div className="rounded-[32px] border border-[#3d4346] bg-[#2f3436]">
          <div className="flex items-center justify-between border-b border-[#3d4346] px-6 py-5 text-[30px] text-neutral-200">
            <span className="flex items-center gap-3">ポイント：1<button type="button" aria-label="参考画像を差し替え" title="参考画像を差し替え" disabled={!inputsReady} onClick={() => referenceInputRef.current?.click()}><RotateCw className="h-8 w-8" /></button></span>
            <button type="button" aria-label="融合ポイントを削除" title="融合ポイントを削除" disabled={!inputsReady} onClick={() => { setRegionMask(''); removeReference(); }}><Trash2 className="h-8 w-8" /></button>
          </div>
          <div className="flex items-center gap-5 p-6">
            <button type="button" aria-label="マスク調整" onClick={() => void openMaskDialog()} className="relative h-[140px] w-[100px] shrink-0 overflow-hidden rounded-[16px] border border-[#3d4346] bg-[#353a3b]">
              <DetailRoleImage candidates={mainImage} scopeKey={scopeKey} role="main" assertContext={assertContext} alt="メイン画像" className="h-full w-full object-cover" />
              {regionMaskUrl && <img src={regionMaskUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />}
            </button>
            {referenceShown
              ? <button type="button" aria-label="参考画像を差し替え" disabled={!inputsReady} onClick={() => referenceInputRef.current?.click()} className="h-[140px] w-[100px] shrink-0 overflow-hidden rounded-[16px] border border-[#3d4346] bg-[#353a3b]">
                  <DetailRoleImage candidates={detail.roles.reference.candidates} scopeKey={scopeKey} role="reference" assertContext={assertContext} alt="参考画像" className="h-full w-full object-cover" onReady={url => setLoadedReference({ identity: referenceIdentity, url })} />
                </button>
              : <button type="button" aria-label="参考画像を追加" disabled={!inputsReady || !scope} onClick={() => referenceInputRef.current?.click()} className="flex h-[140px] w-[100px] shrink-0 items-center justify-center rounded-[16px] border border-[#3d4346] bg-[#353a3b] text-neutral-300"><ImagePlus className="h-10 w-10" /></button>}
            <button type="button" onClick={() => void openMaskDialog()} className="ml-auto flex items-center gap-1 text-[30px] text-neutral-300">マスク調整<ChevronRight className="h-8 w-8" /></button>
          </div>
        </div>
        <button type="button" disabled title="融合ポイントは1か所まで追加できます" className="flex h-[120px] items-center justify-center gap-2 rounded-[32px] border border-[#3d4346] bg-[#2f3436] text-[30px] text-neutral-500"><Plus className="h-8 w-8" />融合ポイントを追加</button>
      </div>
    ) : studioFunction === '3d' ? (
      <>
        <div className="w-full px-8">
          <div className={sectionLabel}>エリアを選択</div>
          <label className={`${selectBox} relative px-10`}>
            <span className="truncate">{STUDIO_GARMENT_AREAS.find(area => area.value === settings.garment)?.label}</span>
            <ChevronDown aria-hidden="true" className="ml-auto h-10 w-10 shrink-0 opacity-50" />
            <select aria-label="エリアを選択" value={settings.garment} disabled={busy || recoveryRequired} onChange={event => updateSettings({ garment: event.target.value as StudioGarmentArea })} className="absolute inset-0 cursor-pointer opacity-0">
              {STUDIO_GARMENT_AREAS.map(area => <option key={area.value} value={area.value}>{area.label}</option>)}
            </select>
          </label>
        </div>
        <div className="w-full px-8">
          <div className={sectionLabel}>生成対象</div>
          <div className="flex gap-5" role="group" aria-label="生成対象">
            {STUDIO_PERSPECTIVES.map(value => <button key={value} type="button" aria-pressed={settings.perspective === value} disabled={busy || recoveryRequired} onClick={() => updateSettings({ perspective: value })}
              className={`flex h-16 min-w-16 items-center justify-center rounded-2xl px-6 py-2 text-[30px] transition-colors ${settings.perspective === value ? 'bg-[#20d0c4] text-[#111817]' : 'bg-[#353a3b] text-neutral-300 hover:bg-white/10 hover:text-white'}`}>{value}</button>)}
          </div>
        </div>
        {generationSettings}
      </>
    ) : (
      <>
        <div className="w-full px-8">
          <div className={`${sectionLabel} gap-4`}>{referenceLabel}{studioFunction === 'text' && <span className="text-[26px] text-neutral-500" data-testid="fashion-studio-reference-count">最大1枚、アップロード済み<span className="text-[#20d0c4]">{referenceShown ? 1 : 0}</span>/1</span>}</div>
          <div className="flex items-center gap-5">{referenceTile}</div>
        </div>
        {promptField(studioFunction === 'underwear' ? 'フィッティングの説明' : '指示テキスト')}
        {generationSettings}
      </>
    );

    return (
      <main className="fashion-studio-project-detail-parity dark relative min-h-[calc(100vh-50px)] overflow-clip bg-[#171b1c] text-white" data-testid="lightchain-fashion-studio-project-detail" data-lightchain-parity-shell="fashion-studio-project-detail">
        {inputControls}
        <div className="fashion-studio-source-dots pointer-events-none absolute inset-0" />
        <aside className="fashion-studio-source-project-rail absolute left-4 top-6 z-30 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#262a2b] shadow-xl">
          <div className="flex h-10 items-center gap-1.5 border-b border-white/10 px-2 text-sm text-neutral-400"><img src={FASHION_STUDIO_PROJECT_ICON} alt="" className="size-5 object-contain" /><span>ファッションスタジオ</span></div>
          <div className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-300"><Link to="/flow/integration" aria-label="ファッションスタジオへ戻る" className="text-neutral-400 hover:text-white"><ChevronLeft className="h-5 w-5" /></Link><span>{visible?.title || 'プロジェクト未確認'}</span></div>
        </aside>

        <aside className="fashion-studio-source-asset-trigger absolute left-4 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2 overflow-hidden rounded-xl border border-white/10 bg-[#262a2b] p-1 shadow-xl" aria-label="アセット">
          <button type="button" aria-label="アセット" className="flex size-12 cursor-pointer items-center justify-center rounded-lg bg-[#353a3b] text-neutral-200 hover:bg-white/10"><Boxes className="h-5 w-5" /></button>
        </aside>

        <section ref={viewportRef} className="fashion-studio-viewport absolute inset-0 z-10" tabIndex={0} data-mode={viewportState.mode} data-panning={viewportState.panning} data-testid="lightchain-fashion-studio-canvas" aria-label="Fashion Studio Canvas"
          onPointerDown={event => {
            const target = event.target instanceof Element ? event.target : null;
            const handled = viewportInteractionRef.current?.down({ pointerId: event.pointerId, button: event.button, x: event.clientX, y: event.clientY,
              interactive: interactiveTarget(event.target), objectId: target?.closest<HTMLElement>('[data-studio-object-id]')?.dataset.studioObjectId });
            if (handled) { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); }
          }}
          onPointerMove={event => { if (viewportInteractionRef.current?.move({ pointerId: event.pointerId, x: event.clientX, y: event.clientY })) event.preventDefault(); }}
          onPointerUp={event => { viewportInteractionRef.current?.up(event.pointerId); }}
          onPointerCancel={() => viewportInteractionRef.current?.cancel()}
          onLostPointerCapture={event => { viewportInteractionRef.current?.up(event.pointerId); }}
          onBlur={event => { if (event.target === event.currentTarget || !event.currentTarget.contains(event.relatedTarget)) viewportInteractionRef.current?.cancel(); }}
          onKeyDown={event => { if (viewportInteractionRef.current?.key({ key: event.key, down: true, interactive: interactiveTarget(event.target),
            focused: event.target === event.currentTarget, anchor: viewportCenter() })) event.preventDefault(); }}
          onKeyUp={event => { if (viewportInteractionRef.current?.key({ key: event.key, down: false, interactive: interactiveTarget(event.target),
            focused: event.target === event.currentTarget, anchor: viewportCenter() })) event.preventDefault(); }}>
          <div className="fashion-studio-nav-surface absolute inset-0" aria-hidden="true" />
          <div className="fashion-studio-world absolute inset-0" data-testid="fashion-studio-world" style={{ transform: studioWorldTransform(viewportState.view), transformOrigin: '0 0' }}>
            <div ref={flowRef} className="fashion-studio-flow" data-testid="fashion-studio-flow">
              <FashionStudioImageNode candidates={mainImage} scopeKey={scopeKey} role="main" assertContext={assertContext} alt="メイン画像" testId="fashion-studio-saved-main-image" className="fashion-studio-source-main-node" objectId={detail.roles.main.objectId} selected={Boolean(detail.roles.main.objectId && viewportState.selectedObjectId === detail.roles.main.objectId)} onExpand={setLightbox} />
              <FlowEdge width={FLOW_GAP_IN} from={flowSize.main / 2} to={flowSize.form / 2} height={flowSize.height} />
              <section className="fashion-studio-source-generation-panel" data-flow-node="form" data-studio-composer data-testid="lightchain-fashion-studio-generation-panel">
                <div className="fashion-studio-source-generation-inner">
                  <div className="flex flex-col gap-[26px] p-8">
                    <div className="text-[30px] leading-[42px] text-neutral-400" data-testid="fashion-studio-function-title">{studioFunctionInfo.label}</div>
                    <div className="flex items-center rounded-[32px] bg-gradient-to-r from-[#00a1ff66] to-[#c861ff66] px-5 py-2.5 text-[30px] leading-[42px] text-white"><img src={FLOW_TIP_ICON} alt="" aria-hidden="true" className="mr-2.5 h-[50px] w-[50px] shrink-0" />{studioFunctionInfo.banner}</div>
                  </div>
                  <div className="px-8">
                    <div className="flex items-center justify-between rounded-[32px] border border-[#3d4346] bg-[#2f3436] p-5 text-[30px]">
                      <div className="flex items-center gap-5">
                        <div className="size-[100px] overflow-hidden rounded-[20px] border border-[#3d4346] bg-[#353a3b]"><DetailRoleImage candidates={mainImage} scopeKey={scopeKey} role="main" assertContext={assertContext} onReady={url => setLoadedMain({ identity: mainIdentity, url })} alt="メイン画像" className="h-full w-full object-contain" /></div>
                        <span>{studioFunction === 'underwear' ? '衣服の画像' : 'メイン画像'}</span>
                      </div>
                      <button type="button" aria-label="メイン画像を差し替え" title="メイン画像を差し替え" disabled={busy || recoveryRequired || !scope || visible?.status !== 'success'} onClick={() => mainInputRef.current?.click()} className="flex size-[72px] items-center justify-center rounded-full border border-white/25 text-neutral-200"><ImagePlus className="h-8 w-8" /></button>
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
              {hasResultNode && <FlowEdge width={FLOW_GAP_OUT} from={flowSize.form / 2} to={flowSize.result / 2} height={flowSize.height} />}
              {detail.roles.result.status === 'available'
                ? <FashionStudioImageNode candidates={resultImage} scopeKey={scopeKey} role="result" assertContext={assertContext} alt="生成結果" testId="fashion-studio-saved-result-image" className="fashion-studio-source-result-node" objectId={detail.roles.result.objectId} selected={Boolean(detail.roles.result.objectId && viewportState.selectedObjectId === detail.roles.result.objectId)} onExpand={setLightbox} />
                : showExampleResult && settings.example && <FashionStudioImageNode candidates={[]} scopeKey={scopeKey} role="result" assertContext={assertContext} alt="仕上がりのサンプル" testId="fashion-studio-example-result-image" className="fashion-studio-source-result-node" objectId={null} selected={false} label="仕上がりのサンプルをご覧ください。" staticUrl={STUDIO_EXAMPLES[settings.example].result} onExpand={setLightbox} />}
            </div>
          </div>
        </section>

        <div className="fashion-studio-source-task" data-studio-chrome aria-label="タスク">{activityContent}<span>{busy ? 1 : 0} <span className="mx-1">進行中</span>⌃</span></div>
        <div className="fashion-studio-source-canvas-toolbar" data-studio-chrome data-testid="lightchain-fashion-studio-canvas-toolbar">
          <button type="button" aria-label="選択" aria-pressed={viewportState.mode === 'select'} className={viewportState.mode === 'select' ? 'is-active' : ''} onClick={() => viewportInteractionRef.current?.mode('select')}><MousePointer2 className="h-4 w-4" /></button>
          <button type="button" aria-label="ドラッグ" aria-pressed={viewportState.mode === 'move'} className={viewportState.mode === 'move' ? 'is-active' : ''} onClick={() => viewportInteractionRef.current?.mode('move')}><Hand className="h-4 w-4" /></button>
          <button type="button" aria-label="画像をアップロード" disabled={busy || recoveryRequired || !scope || visible?.status !== 'success'} onClick={() => mainInputRef.current?.click()}><ImagePlus className="h-4 w-4" /></button>
          <button type="button" aria-label="取り消し(ctrl+z)" disabled title="履歴操作は未接続"><Undo2 className="h-4 w-4" /></button><button type="button" aria-label="やり直し(ctrl+shift+z)" disabled title="履歴操作は未接続"><Redo2 className="h-4 w-4" /></button>
        </div>
        <div className="fashion-studio-source-zoom-controls" data-studio-chrome data-testid="lightchain-fashion-studio-zoom-controls"><button type="button" aria-label="キャンバスを縮小" disabled={viewportState.view.zoom <= 0.1} onClick={() => viewportInteractionRef.current?.zoom(-1, viewportCenter())}><ZoomOut className="h-4 w-4" /></button><span aria-label="キャンバスの拡大率">{zoomPercent(viewportState.view.zoom)}%</span><button type="button" aria-label="キャンバスを拡大" disabled={viewportState.view.zoom >= 2} onClick={() => viewportInteractionRef.current?.zoom(1, viewportCenter())}><ZoomIn className="h-4 w-4" /></button></div>
        <button type="button" className="fashion-studio-source-panel-toggle" aria-label="キャンバスを整理" title="キャンバスを整理" onClick={() => { if (!fitFlow()) viewportInteractionRef.current?.reset(); }}><LayoutGrid className="h-5 w-5" /></button>
        <button type="button" className="fashion-studio-source-handbook" aria-label="操作ガイド"><BookOpen className="h-5 w-5" /></button>

        <div className="fashion-studio-source-points" aria-label="ポイント"><Sparkles className="h-4 w-4" />{visible?.remainingUnits?.toLocaleString('en-US') ?? '未確認'}</div>
        <div className="fashion-studio-source-image-search" aria-label="画像検索"><Search className="h-4 w-4" />画像検索<span className="ml-auto">☷<span className="inline-block w-4" aria-hidden="true" />⇧⌄</span></div>
        {promptExpanded && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-8" role="dialog" aria-label="合成指示を全画面で編集">
          <div className="flex h-[70vh] w-[min(880px,100%)] flex-col gap-4 rounded-2xl border border-[#3d4346] bg-[#262a2b] p-6">
            <div className="flex items-center justify-between text-base text-neutral-200">合成指示<button type="button" aria-label="閉じる" onClick={() => setPromptExpanded(false)}><X className="h-5 w-5" /></button></div>
            <textarea value={prompt} maxLength={2000} disabled={busy || recoveryRequired} onChange={event => setPrompt(event.target.value)} className="min-h-0 flex-1 resize-none rounded-xl border border-[#3d4346] bg-[#353a3b] p-4 text-base leading-7 text-white outline-none" aria-label="合成指示" />
            <div className="flex items-center justify-between text-sm text-neutral-400"><span><span className="text-[#20d0c4]">{prompt.length}</span>/2000</span><button type="button" onClick={() => setPromptExpanded(false)} className="rounded-lg bg-[#20d0c4] px-5 py-2 text-sm font-medium text-[#111817]">決定</button></div>
          </div>
        </div>}
        {maskDialog && loadedMain.url && <MaskPaintDialog imageUrl={loadedMain.url} hint="範囲指定で生成" paneTitle="参考画像の服を合わせたい部分をマスクで選択してください" initialMask={maskDialog.initial} onCancel={() => setMaskDialog(null)} onConfirm={confirmMask} />}
        {lightboxView}
      </main>
    );
  }

  return (
    <main className="dark relative h-[calc(100vh-50px)] min-h-[620px] overflow-clip bg-[#171b1c] text-white" data-testid="lightchain-fashion-studio-detail" data-lightchain-parity-shell="fashion-studio-detail">
      {inputControls}
      <div className="fashion-studio-source-dots pointer-events-none absolute inset-0" />
      <aside className="absolute left-4 top-6 z-10 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#262a2b]"><div className="flex h-10 items-center gap-1.5 border-b border-white/10 px-2 text-sm text-neutral-400"><img src={FASHION_STUDIO_PROJECT_ICON} alt="" className="size-5 object-contain" /><span>ファッションスタジオ</span></div><Link to="/flow/integration" aria-label="ファッションスタジオへ戻る" className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-300 transition hover:bg-white/5 hover:text-white"><ChevronLeft className="h-5 w-5" /><span>Untitled</span></Link></aside>
      {/* Light (2026-11-11): one centred column — the hint, the four example buttons, the 624×360 drop box, then the loading line. */}
      <section aria-label="サンプル" className="absolute left-1/2 top-1/2 z-[4] flex w-[784px] max-w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-8 text-center">
        <p className="text-lg font-medium leading-6 text-neutral-400">下から機能を選んでサンプルを見るか、「画像を追加」をクリックしてください。</p>
        <div className="flex flex-wrap justify-center gap-4" data-testid="fashion-studio-functions">
          {STUDIO_FUNCTIONS.map((item) => <button key={item.id} type="button" disabled={busy || recoveryRequired || !scope || Boolean(exampleState.loading)} onClick={() => void loadExample(item.id)}
            className="relative flex h-12 w-auto shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-[#25292b] px-4 text-base text-neutral-300 transition-colors hover:bg-[#2f3436] hover:text-white disabled:cursor-wait disabled:opacity-60">
            <StudioFunctionIcon fn={item.id} className="h-6 w-6" />{item.label}
            {item.badge && <span className="absolute -right-2 -top-2.5 rounded-full bg-[linear-gradient(90deg,#8fe9ff,#d9c2ff)] px-2 text-xs leading-5 text-neutral-900">{item.badge}</span>}
          </button>)}
        </div>
        <label className="flex h-[360px] max-h-[45vh] w-[624px] max-w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-4 backdrop-blur-sm transition-colors hover:border-[#0bcabc] hover:bg-white/[0.06]" data-testid="fashion-studio-detail-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); uploadOwnMain(event.dataTransfer.files?.[0]); }}>
          <ImagePlus aria-hidden="true" className="size-8 text-neutral-300" />
          <span className="text-base font-medium text-neutral-400">ここをクリックまたはドラッグして画像を追加</span>
          <span className="text-sm text-neutral-500">jpg、jpeg、png、webp形式の画像（最大20M）に対応</span>
          <input className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" aria-label="画像を追加" disabled={busy || recoveryRequired || !scope} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; uploadOwnMain(file); }} />
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
