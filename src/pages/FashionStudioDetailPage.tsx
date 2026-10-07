import {
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  Hand,
  ImageIcon,
  ImagePlus,
  Layers,
  MousePointer2,
  Redo2,
  Search,
  Sparkles,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

const FASHION_STUDIO_PROJECT_ICON = '/lightchain-assets/icons/fashion-studio.png';

/** Light's four Fashion Studio entry functions. Heavy seeds its own sample instruction for each. */
type StudioFunctionId = 'text' | 'region' | 'underwear' | '3d';
const STUDIO_FUNCTIONS: readonly { id: StudioFunctionId; label: string; width: number; badge?: string; sample: string }[] = [
  { id: 'text', label: 'テキストで生成', width: 164, sample: '高級ファッション誌の誌面のような雰囲気で、自然光の入るスタジオに座ったモデルがこの服を着ている写真にしてください。' },
  { id: 'region', label: '範囲指定で生成', width: 164, sample: '服の形と柄はそのままに、指定した部分だけを生成し直してください。周囲の質感と光を合わせてください。' },
  { id: 'underwear', label: '下着のフィッティング', width: 206, badge: 'NEW', sample: 'この下着をモデルに自然に着用させ、柔らかい光のベッドルームで撮影した写真にしてください。' },
  { id: '3d', label: '3D画像に変換', width: 155, sample: 'この服を立体感のある3Dレンダリング画像に変換してください。正面からの視点、柔らかなスタジオライト。' },
];
const STUDIO_PENDING_FUNCTION_KEY = 'heavy-fashion-studio-pending-function';
const studioFunctionKey = (projectId: string) => `heavy-fashion-studio-function:${projectId}`;
const readStudioFunction = (projectId: string): StudioFunctionId => {
  try {
    const value = projectId ? window.localStorage.getItem(studioFunctionKey(projectId)) : null;
    return STUDIO_FUNCTIONS.some((item) => item.id === value) ? value as StudioFunctionId : 'text';
  } catch { return 'text'; }
};

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
    : <span className={`${className} inline-flex items-center justify-center text-neutral-400`} role="status">{alt} 未確認</span>;
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
}: {
  candidates: readonly string[];
  scopeKey: string;
  role: string;
  assertContext: () => void;
  alt: string;
  className: string;
  testId: string;
  objectId: string | null;
  selected: boolean;
}) {
  return (
    <figure className={`fashion-studio-source-image-node ${className}`} data-testid={testId} data-studio-object-id={objectId ?? undefined} data-selected={selected} onDragStart={event => event.preventDefault()}>
      <DetailRoleImage candidates={candidates} scopeKey={scopeKey} role={role} assertContext={assertContext} alt={alt} className="h-full w-full object-cover" />
      <button type="button" className="fashion-studio-source-expand" aria-label={`${alt}を拡大`}>
        <ArrowUpRight className="h-5 w-5" />
      </button>
    </figure>
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
  const [studioFunction, setStudioFunctionState] = useState<StudioFunctionId>(() => readStudioFunction(projectCode));
  const [studioFunctionChosen, setStudioFunctionChosen] = useState(false);
  const setStudioFunction = (id: StudioFunctionId) => { setStudioFunctionState(id); setStudioFunctionChosen(true); };
  const studioFunctionLabel = STUDIO_FUNCTIONS.find((item) => item.id === studioFunction)?.label ?? 'テキストで生成';
  // A function chosen on the new-file screen belongs to the project created by the first upload.
  useEffect(() => {
    if (!projectCode) return;
    let pending: string | null = null;
    try { pending = window.sessionStorage.getItem(STUDIO_PENDING_FUNCTION_KEY); } catch { /* storage unavailable */ }
    const chosen = STUDIO_FUNCTIONS.find((item) => item.id === pending);
    if (chosen) {
      try {
        window.sessionStorage.removeItem(STUDIO_PENDING_FUNCTION_KEY);
        window.localStorage.setItem(studioFunctionKey(projectCode), chosen.id);
      } catch { /* storage unavailable */ }
      setStudioFunction(chosen.id);
      setPromptDraft((current) => current.value ? current : { scopeKey, value: chosen.sample });
      try { if (!window.localStorage.getItem(`heavy-fashion-studio-draft:${projectCode}`)) window.localStorage.setItem(`heavy-fashion-studio-draft:${projectCode}`, chosen.sample); } catch { /* storage unavailable */ }
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
      editImageWithPrompt, assertCompletedImageEditResult, resolveImage: resolveGeneratedImageUrlWithStatus,
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
  const generate = async (retry = false) => {
    if (!scope || busyRef.current || !generationControllerRef.current) return;
    const capturedScopeKey = scopeKey;
    try {
      assertContext(); busyRef.current = true; setActivity({ scopeKey, value: retry ? 'recovering' : 'preparing' });
      let outcome: FashionStudioGenerationOutcome;
      if (retry) outcome = await generationControllerRef.current.retry();
      else {
        if (detail.roles.main.status !== 'available' || !detail.roles.main.objectId || loadedMain.identity !== mainIdentity || !loadedMain.url
          || detail.roles.reference.status === 'ambiguous' || !prompt.trim()) throw new Error('fashion_studio_generation_input_unverified');
        const inputIdentity = JSON.stringify([scopeKey, mainIdentity, prompt.trim(), detail.roles.reference.candidates]);
        if (logicalAttemptRef.current?.identity !== inputIdentity) logicalAttemptRef.current = { identity: inputIdentity, key: crypto.randomUUID() };
        outcome = await generationControllerRef.current.start({ scope, logicalAttemptKey: logicalAttemptRef.current.key,
          main: { objectId: detail.roles.main.objectId, imageUrl: loadedMain.url, verified: true }, referenceImageUrls: detail.roles.reference.candidates, prompt });
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
  const activityText = ({ preparing: '準備中', generating: '生成中', recovering: '復旧中', saving: '保存中', failure: '失敗', success: '完了' } as Record<string, string>)[activityValue] || 'タスク';
  const activityContent = <><span role="status">{activityText}</span>{(activeUpload?.error || activeGeneration?.error) && <span role="alert">{activeUpload?.error || activeGeneration?.error}</span>}{activeUpload?.status === 'failure' && activeUpload.recoverable && <button type="button" disabled={busy} onClick={() => void retryUpload()}>保存を再試行</button>}{activeGeneration?.status === 'failure' && <button type="button" disabled={busy} onClick={() => void generate(true)}>保存を再試行</button>}</>;
  const inputControls = <><input ref={mainInputRef} className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" disabled={busy || recoveryRequired} aria-label="メイン画像ファイル" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void uploadFile(file, 'main'); }} /><input ref={referenceInputRef} className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" disabled={busy || recoveryRequired} aria-label="参考画像ファイル" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void uploadFile(file, 'reference'); }} /></>;

  if (hasProject) {
    const mainImage = detail.roles.main.candidates;
    const referenceImage = detail.roles.reference.candidates;
    const resultImage = detail.roles.result.candidates;

    return (
      <main className="fashion-studio-project-detail-parity dark relative min-h-[calc(100vh-50px)] overflow-hidden bg-[#171b1c] text-white" data-testid="lightchain-fashion-studio-project-detail" data-lightchain-parity-shell="fashion-studio-project-detail">
        {inputControls}
        <div className="fashion-studio-source-dots pointer-events-none absolute inset-0" />
        <aside className="fashion-studio-source-project-rail absolute left-4 top-6 z-30 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#262a2b] shadow-xl">
          <div className="flex h-10 items-center gap-1.5 border-b border-white/10 px-2 text-sm text-neutral-400"><img src={FASHION_STUDIO_PROJECT_ICON} alt="" className="size-5 object-contain" /><span>ファッションスタジオ</span></div>
          <div className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-300"><Link to="/flow/integration" aria-label="ファッションスタジオへ戻る" className="text-neutral-400 hover:text-white"><ChevronLeft className="h-5 w-5" /></Link><span>{visible?.title || 'プロジェクト未確認'}</span></div>
        </aside>

        <aside className="fashion-studio-source-asset-trigger absolute left-4 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2 overflow-hidden rounded-xl border border-white/10 bg-[#262a2b] p-1 shadow-xl" aria-label="アセット">
          <button type="button" aria-label="アセット" className="flex size-12 cursor-pointer items-center justify-center rounded-lg bg-[#353a3b] text-neutral-200 hover:bg-white/10"><Layers className="h-5 w-5" /></button>
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
          <svg className="fashion-studio-source-edges pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1904 771" preserveAspectRatio="none" aria-hidden="true">
            <defs><marker id="fashion-studio-arrow" markerWidth="12" markerHeight="12" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="#5e6263" strokeWidth="1.5" /></marker></defs>
            <path d="M430 515 C520 500 545 390 577 340" fill="none" stroke="#5e6263" strokeWidth="1.75" markerEnd="url(#fashion-studio-arrow)" />
            <path d="M930 340 C1000 320 1050 280 1122 285" fill="none" stroke="#5e6263" strokeWidth="1.75" markerEnd="url(#fashion-studio-arrow)" />
            <path d="M430 520 C690 520 850 560 1072 635" fill="none" stroke="#5e6263" strokeWidth="1.75" markerEnd="url(#fashion-studio-arrow)" />
          </svg>
          <FashionStudioImageNode candidates={mainImage} scopeKey={scopeKey} role="main" assertContext={assertContext} alt="メイン画像" testId="fashion-studio-saved-main-image" className="fashion-studio-source-main-node" objectId={detail.roles.main.objectId} selected={Boolean(detail.roles.main.objectId && viewportState.selectedObjectId === detail.roles.main.objectId)} />
          <FashionStudioImageNode candidates={referenceImage} scopeKey={scopeKey} role="reference" assertContext={assertContext} alt="参考画像" testId="fashion-studio-saved-reference-image" className="fashion-studio-source-reference-node" objectId={detail.roles.reference.objectId} selected={Boolean(detail.roles.reference.objectId && viewportState.selectedObjectId === detail.roles.reference.objectId)} />
          <FashionStudioImageNode candidates={resultImage} scopeKey={scopeKey} role="result" assertContext={assertContext} alt="生成結果" testId="fashion-studio-saved-result-image" className="fashion-studio-source-result-node" objectId={detail.roles.result.objectId} selected={Boolean(detail.roles.result.objectId && viewportState.selectedObjectId === detail.roles.result.objectId)} />

        <section className="fashion-studio-source-generation-panel" data-studio-composer data-testid="lightchain-fashion-studio-generation-panel">
          <div className="fashion-studio-source-generation-inner">
            <div className="flex items-center justify-between"><div className="text-[30px] text-neutral-400" data-testid="fashion-studio-function-title">{studioFunctionLabel}</div><div className="flex items-center gap-3 text-[30px] text-neutral-300"><ImageIcon className="h-8 w-8" />画像検索</div></div>
            <div className="flex items-center rounded-[32px] bg-gradient-to-r from-[#00a1ff66] to-[#c861ff66] px-5 py-2.5 text-[30px] text-white"><Sparkles className="mr-2.5 h-[30px] w-[30px]" />指令と参考画像を使ってワンクリック生成</div>
            <div className="flex items-center justify-between rounded-[32px] border border-white/10 bg-[#353a3b] p-5 text-[30px]"><div className="flex items-center gap-5"><DetailRoleImage candidates={mainImage} scopeKey={scopeKey} role="main" assertContext={assertContext} onReady={url => setLoadedMain({ identity: mainIdentity, url })} alt="メイン画像" className="size-[100px] rounded-[20px] object-contain" /><span>メイン画像</span></div><button type="button" aria-label="メイン画像を差し替え" disabled={busy || recoveryRequired || !scope || visible?.status !== 'success'} onClick={() => mainInputRef.current?.click()}><ImagePlus className="h-8 w-8" /></button></div>
            <div className="text-[30px] text-neutral-400">参考画像</div>
            <div className="flex items-center gap-5"><DetailRoleImage candidates={referenceImage} scopeKey={scopeKey} role="reference" assertContext={assertContext} alt="参考画像" className="size-[140px] rounded-[20px] object-contain" /><button type="button" aria-label="参考画像を追加" disabled={busy || recoveryRequired || !scope || visible?.status !== 'success'} onClick={() => referenceInputRef.current?.click()} className="flex size-[100px] items-center justify-center rounded-[20px] border border-white/10 bg-[#353a3b]"><ImagePlus className="h-8 w-8" /></button></div>
            {activeUpload?.preview && busy && <img src={activeUpload.preview} className="size-[100px] rounded-[20px] object-contain" alt="アップロード準備中" />}
            <div className="flex flex-col gap-5">
              <label className="flex items-center text-[30px] text-neutral-400" htmlFor="fashion-studio-detail-prompt">指示テキスト *</label>
              <div className="flex h-[420px] flex-col justify-between gap-5 rounded-[32px] border border-white/15 bg-[#353a3b] p-5"><textarea id="fashion-studio-detail-prompt" value={prompt} disabled={busy || recoveryRequired} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} className="h-full resize-none border-none bg-transparent p-0 text-[30px] leading-6 text-white outline-none" aria-label="指令を入力してください。" /><div className="flex items-center justify-between"><div className="flex gap-2 text-[30px] text-neutral-300"><button type="button" aria-label="プロンプト補助"><Sparkles className="h-5 w-5" /></button><button type="button" aria-label="入力画像"><ImageIcon className="h-5 w-5" /></button></div><span className="text-[30px] text-neutral-400">文字数：{prompt.length}/2000</span><button type="button" disabled={busy || recoveryRequired} onClick={() => setPrompt('')} className="rounded-xl bg-[#505c5e] px-5 py-2 text-[30px] text-white">全削除</button></div></div>
            </div>
            <div className="flex gap-2"><select id="fashion-studio-generation-mode" aria-label="生成設定" className="h-20 flex-1 rounded-2xl border border-white/10 bg-[#353a3b] px-10 py-5 text-[30px] text-neutral-300"><option>自動</option></select><select id="fashion-studio-generation-quality" aria-label="画像品質" className="h-20 flex-1 rounded-2xl border border-white/10 bg-[#353a3b] px-10 py-5 text-[30px] text-neutral-300"><option>1K</option></select></div>
            <button type="button" disabled={busy || recoveryRequired || visible?.status !== 'success' || detail.roles.main.status !== 'available' || detail.roles.reference.status === 'ambiguous' || loadedMain.identity !== mainIdentity || !prompt.trim()} onClick={() => void generate()} aria-label="AI生成" className="h-20 w-full rounded-3xl bg-[#0bc1b8] text-[30px] font-medium text-[#111817]">AI生成</button>
          </div>
        </section>
          </div>
        </section>

        <div className="fashion-studio-source-task" data-studio-chrome aria-label="タスク">{activityContent}<span>{busy ? 1 : 0} <span className="mx-1">進行中</span>⌃</span></div>
        <div className="fashion-studio-source-canvas-toolbar" data-studio-chrome data-testid="lightchain-fashion-studio-canvas-toolbar">
          <button type="button" aria-label="選択" aria-pressed={viewportState.mode === 'select'} className={viewportState.mode === 'select' ? 'is-active' : ''} onClick={() => viewportInteractionRef.current?.mode('select')}><MousePointer2 className="h-4 w-4" /></button>
          <button type="button" aria-label="移動" aria-pressed={viewportState.mode === 'move'} className={viewportState.mode === 'move' ? 'is-active' : ''} onClick={() => viewportInteractionRef.current?.mode('move')}><Hand className="h-4 w-4" /></button>
          <button type="button" aria-label="画像を追加" disabled={busy || recoveryRequired || !scope || visible?.status !== 'success'} onClick={() => mainInputRef.current?.click()}><ImagePlus className="h-4 w-4" /></button>
          <button type="button" aria-label="元に戻す" disabled title="履歴操作は未接続"><Undo2 className="h-4 w-4" /></button><button type="button" aria-label="やり直す" disabled title="履歴操作は未接続"><Redo2 className="h-4 w-4" /></button>
        </div>
        <div className="fashion-studio-source-zoom-controls" data-studio-chrome data-testid="lightchain-fashion-studio-zoom-controls"><button type="button" aria-label="ズームアウト" disabled={viewportState.view.zoom <= 0.1} onClick={() => viewportInteractionRef.current?.zoom(-1, viewportCenter())}><ZoomOut className="h-4 w-4" /></button><span>{Math.round(viewportState.view.zoom * 100)}%</span><button type="button" aria-label="ズームイン" disabled={viewportState.view.zoom >= 2} onClick={() => viewportInteractionRef.current?.zoom(1, viewportCenter())}><ZoomIn className="h-4 w-4" /></button></div>
        <button type="button" className="fashion-studio-source-handbook" aria-label="操作ガイド"><BookOpen className="h-5 w-5" /></button>
        <button type="button" className="fashion-studio-source-panel-toggle" aria-label="パネルを開く"><Layers className="h-5 w-5" /></button>

        <div className="fashion-studio-source-points" aria-label="ポイント"><Sparkles className="h-4 w-4" />{visible?.remainingUnits ?? '未確認'}</div>
        <div className="fashion-studio-source-image-search" aria-label="画像検索"><Search className="h-4 w-4" />画像検索<span className="ml-auto">☷<span className="inline-block w-4" aria-hidden="true" />⇧⌄</span></div>
      </main>
    );
  }

  const chooseFunction = (id: StudioFunctionId) => {
    try { window.sessionStorage.setItem(STUDIO_PENDING_FUNCTION_KEY, id); } catch { /* storage unavailable */ }
    setStudioFunction(id);
  };
  const pendingFunction = STUDIO_FUNCTIONS.find((item) => item.id === studioFunction && studioFunctionChosen);
  return (
    <main className="dark relative h-[calc(100vh-50px)] min-h-[620px] overflow-hidden bg-[#171b1c] text-white" data-testid="lightchain-fashion-studio-detail" data-lightchain-parity-shell="fashion-studio-detail">
      {inputControls}
      <div className="fashion-studio-source-dots pointer-events-none absolute inset-0" />
      <aside className="absolute left-4 top-6 z-10 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#262a2b]"><div className="flex h-10 items-center gap-1.5 border-b border-white/10 px-2 text-sm text-neutral-400"><img src={FASHION_STUDIO_PROJECT_ICON} alt="" className="size-5 object-contain" /><span>ファッションスタジオ</span></div><Link to="/flow/integration" aria-label="ファッションスタジオへ戻る" className="flex h-11 items-center gap-3 px-3 text-sm text-neutral-300 transition hover:bg-white/5 hover:text-white"><ChevronLeft className="h-5 w-5" /><span>Untitled</span></Link></aside>
      <p className="absolute left-1/2 top-[178px] -translate-x-1/2 whitespace-nowrap text-base text-neutral-300">下から機能を選んでサンプルを見るか、「画像を追加」をクリックしてください。</p>
      <div className="absolute left-1/2 top-[233px] flex -translate-x-1/2 gap-4" data-testid="fashion-studio-functions">
        {STUDIO_FUNCTIONS.map((item) => <button key={item.id} type="button" aria-pressed={pendingFunction?.id === item.id} disabled={busy || recoveryRequired || !scope} onClick={() => chooseFunction(item.id)}
          className={`relative flex h-12 items-center justify-center gap-2 rounded-xl border text-base text-neutral-100 transition hover:bg-[#2f3436] disabled:opacity-50 ${pendingFunction?.id === item.id ? 'border-[#0bcabc] bg-[#0bcabc]/10' : 'border-white/10 bg-[#25292b]'}`} style={{ width: item.width }}>
          <Sparkles className="h-5 w-5 text-neutral-200" />{item.label}
          {item.badge && <span className="absolute -right-2 -top-2.5 rounded-full bg-[linear-gradient(90deg,#8fe9ff,#d9c2ff)] px-2 text-xs leading-5 text-neutral-900">{item.badge}</span>}
        </button>)}
      </div>
      <label className="absolute left-1/2 top-[313px] flex h-[360px] w-[624px] -translate-x-1/2 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-[#25292b] text-center transition hover:bg-[#2a2e30]" data-testid="fashion-studio-detail-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void uploadFile(event.dataTransfer.files?.[0], 'main'); }}><ImagePlus className="h-8 w-8 text-white" /><p className="mt-4 text-sm leading-[21px] text-neutral-300">{pendingFunction ? `「${pendingFunction.label}」で使う画像をクリックまたはドラッグして追加` : 'ここをクリックまたはドラッグして画像を追加'}</p><p className="mt-1 text-xs leading-[17.14px] text-neutral-500">jpg、jpeg、png、webp形式の画像（最大20M）に対応</p><input className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" aria-label="画像を追加" disabled={busy || recoveryRequired || !scope} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void uploadFile(file, 'main'); }} />{activeUpload?.preview && busy && <img src={activeUpload.preview} alt="アップロード準備中" className="h-32 w-32 object-contain" />}</label>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2" aria-label="タスク">{activityContent}</div>
    </main>
  );
}
