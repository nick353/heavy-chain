import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown, ChevronLeft, Clapperboard, Download, Hand, ImagePlus, Layers, Lightbulb, LayoutPanelTop, Maximize, MessageCircleMore,
  MessageSquarePlus, Minus, MousePointer2, Palette, PanelRightClose, PanelRightOpen, Plus, Redo2, RefreshCw, Shapes, Sparkles,
  Type, Undo2, Upload, X, Boxes, ArrowUp, FileText,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { cloudflareDataPlane } from '../../lib/cloudflareApi';
import { generateImage, editImageWithPrompt } from '../../lib/imageApi';
import { resolveGeneratedImageUrlWithStatus } from '../../lib/storage';
import { isHeavyWorkspaceRuntime, isHeavyWorkspaceBrandName } from '../../lib/heavyWorkspace';
import { panStudioViewport, zoomStudioViewport, type StudioViewport } from '../../lib/studioViewport';
import type { DesignDialogueManifestReference } from '../../lib/designDialogueReferences';
import { createSessionStore } from './sessionStore';
import { createEntryDraftStore, type DesignEntryDraft } from './entryDraftStore';
import { createDialogueStore } from './dialogueStore';
import { createDesignDialogueController, type DesignDialogueClient, type DesignDialogueState } from './designDialogueController';
import { designCanvasClient } from './designCanvasAdapter';
import {
  DESIGN_ENTRY_SESSION_DB, DIALOGUE_WORKSPACES, createDesignEntryCoordinator, designEntryClient,
  type DesignEntryClient, type DialogueWorkspaceId, validateOwnedDesignDocument,
} from './designEntryCoordinator';
import { useDialogueReferences } from './useDialogueReferences';
import { DESIGN_ATTACH_ARTIFACT_PARAM, DESIGN_ATTACH_GALLERY_PARAM, designAttachmentName, resolveDesignAttachment } from './canvasHandoff';
import { canvasImageReference, openImageProject } from './imageProject';
import { DESIGN_SHAPES, DesignCanvasShape, createDesignCanvasObject, type DesignCanvasObject, type DesignShapeKind } from './designCanvasObjects';
import { DESIGN_OPEN_IMAGE_PARAM } from '../../lib/legacyCanvasRoute';
import { watermarkImageBlobIfOn } from '../../lib/imageDownload';

const api = () => { if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured'); return cloudflareDataPlane; };
export const createDesignDialogueClient = (featureType: string): DesignDialogueClient => ({
  ...designCanvasClient,
  sendAssistant: (input, context) => api().sendDesignAssistantRequest(input, context),
  readAssistant: (input, context) => api().readDesignAssistantRequest(input, context),
  readImage: (requestId) => api().readImageAIRequest(requestId),
  acknowledgeImage: (receipt) => api().acknowledgeImageAction(receipt),
  resolveImage: resolveGeneratedImageUrlWithStatus,
  async generate(input) {
    input.assertContext();
    const auth = useAuthStore.getState();
    const ready = Boolean(auth.user?.id && auth.currentBrand?.id === input.brandId
      && (!isHeavyWorkspaceRuntime() || isHeavyWorkspaceBrandName(auth.currentBrand.name)));
    if (!ready) throw new Error('design_generation_context_stale');
    const urls: string[] = [];
    for (const reference of input.references) {
      input.assertContext();
      const resolved = await resolveGeneratedImageUrlWithStatus(reference.storagePath); input.assertContext();
      if (!resolved.ok) throw new Error('design_reference_unavailable');
      urls.push(resolved.url);
    }
    const options = { rightsConfirmed: ready, idempotencyKey: input.idempotencyKey, assertContext: input.assertContext,
      retainUntilAcknowledged: input.retainUntilAcknowledged, featureType };
    return urls.length ? editImageWithPrompt(urls[0], input.prompt, input.brandId, { ...options, referenceImageUrls: urls.slice(1) })
      : generateImage(input.prompt, input.brandId, options);
  },
});
export const designDialogueClient: DesignDialogueClient = createDesignDialogueClient('design-dialogue');
const marketingDialogueClient: DesignDialogueClient = createDesignDialogueClient('marketing-dialogue');

type ViewState = { identity: string; draft?: DesignEntryDraft; dialogue?: DesignDialogueState; busy?: boolean; error?: boolean };

// Light rotates three scene presets at a time under 「更新」.
const ASSISTANT_PRESETS: Record<DialogueWorkspaceId, readonly string[]> = {
  marketing: [
    'ブランドストーリーの構築', '展示パネル／リーフレットのインフォグラフィック', 'おすすめ動画／Vlog',
    '商品メイン画像 / 商品サブ画像 / カラー別詳細画像', '招待状 / 電子チケット / 参加登録用画像', 'コーディネートルックブック',
    'SNS投稿用の画像と英文コピー', 'ECセールのバナー', '店頭POP／ポスター',
  ],
  design: [
    'Tシャツのグラフィックデザイン', 'ブランドロゴを使った刺繍デザイン', 'シーズンのカラーパレット提案',
    'ワンピースのデザイン案', 'ストリート系パーカーのデザイン', 'テキスタイル柄のバリエーション',
  ],
};

// Light's scenes for a project that already has a canvas.
const CANVAS_SCENES = ['生地パターン適用', '線画から実写化', 'デザインミックス', 'プリント修正'] as const;

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.avif,.webp';
const FIT_PADDING = 80;

/** Dedicated assistant + canvas project view, shared by Light's design and marketing workspaces. */
export default function DesignEntryDetailPage({ client = designEntryClient, dialogueClient, workspace: workspaceId = 'design' }:
  { client?: DesignEntryClient; dialogueClient?: DesignDialogueClient; workspace?: DialogueWorkspaceId }) {
  const workspace = DIALOGUE_WORKSPACES[workspaceId];
  const activeDialogueClient = dialogueClient ?? (workspaceId === 'marketing' ? marketingDialogueClient : designDialogueClient);
  const { user, currentBrand } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const userId = user?.id ?? '';
  const brandId = currentBrand?.id ?? '';
  const params = new URLSearchParams(location.search);
  const projectId = params.get('projectId') ?? '';
  const conversationId = params.get('conversationId') ?? '';
  const isNewFile = !projectId && !conversationId;
  // A saved Canvas document opened without a chat (old /canvas/:id links): show it, and start a chat on it on first send.
  const isDocumentOnly = Boolean(projectId) && !conversationId;
  const attachImageId = params.get(DESIGN_ATTACH_GALLERY_PARAM);
  const attachArtifactId = params.get(DESIGN_ATTACH_ARTIFACT_PARAM);
  const openImageId = params.get(DESIGN_OPEN_IMAGE_PARAM);
  const identity = JSON.stringify([userId, brandId, projectId, conversationId]);
  const brandReady = Boolean(userId && brandId && (!isHeavyWorkspaceRuntime() || isHeavyWorkspaceBrandName(currentBrand?.name)));
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ViewState>({ identity: '' });
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [move, setMove] = useState(false);
  const [view, setView] = useState<StudioViewport>({ zoom: 0.2, panX: 20, panY: 20 });
  const [viewHistory, setViewHistory] = useState<{ back: StudioViewport[]; forward: StudioViewport[] }>({ back: [], forward: [] });
  const [fitted, setFitted] = useState('');
  const [panelTab, setPanelTab] = useState<'assistant' | 'layers'>('assistant');
  const [panelOpen, setPanelOpen] = useState(true);
  const [presetPage, setPresetPage] = useState(0);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [entrySending, setEntrySending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [remainingUnits, setRemainingUnits] = useState<number | null>(null);
  const [previews, setPreviews] = useState<{ identity: string; urls: Record<string, string> }>({ identity: '', urls: {} });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const controller = useRef<ReturnType<typeof createDesignDialogueController> | null>(null);
  const sending = useRef(false);
  const references = useDialogueReferences({ userId, brandId, selectionId: `${workspace.selectionId}:${projectId || 'new'}` });
  const stores = useMemo(() => ({ sessions: createSessionStore({ idb: window.indexedDB, dbName: DESIGN_ENTRY_SESSION_DB }),
    drafts: createEntryDraftStore({ idb: window.indexedDB, dbName: workspace.draftDb }), dialogues: createDialogueStore({ idb: window.indexedDB }) }), [workspace.draftDb]);
  useEffect(() => {
    if (isHeavyWorkspaceRuntime() && userId && !brandReady) void useAuthStore.getState().ensureHeavyWorkspace();
  }, [brandReady, userId]);
  useEffect(() => {
    let cancelled = false;
    if (!brandId || !cloudflareDataPlane) { setRemainingUnits(null); return () => { cancelled = true; }; }
    void cloudflareDataPlane.getImageUsage(brandId).then((summary) => {
      if (!cancelled) setRemainingUnits(Number.isSafeInteger(summary.remainingUnits) && summary.remainingUnits >= 0 ? summary.remainingUnits : null);
    }).catch(() => { if (!cancelled) setRemainingUnits(null); });
    return () => { cancelled = true; };
  }, [brandId, state.dialogue?.outputs.length]);
  useEffect(() => {
    const epoch = ++generation.current;
    const scope = { userId, brandId };
    // A durable winning dispatch survives StrictMode effect cleanup in the SAME authenticated scope.
    // Publication is separately fenced by epoch; changing user or brand stops every external operation.
    const assertContext = () => {
      const auth = useAuthStore.getState();
      if (auth.user?.id !== userId || auth.currentBrand?.id !== brandId) throw new Error('design_entry_scope_stale');
    };
    const assertView = () => { assertContext(); if (generation.current !== epoch) throw new Error('design_entry_view_stale'); };
    controller.current = null;
    sending.current = false;
    setSelected(null); setPrompt(''); setTitleDraft(null); setState({ identity, busy: brandReady && !isNewFile });
    if (brandReady && isDocumentOnly) {
      void (async () => {
        // Resume this document's latest chat when one exists here; otherwise show the document alone.
        const chats = (await stores.drafts.list(scope, assertView)).filter((draft) => draft.projectId === projectId && draft.ready); assertView();
        const latest = chats[chats.length - 1];
        if (latest) { navigate(`${workspace.detailPath}?${new URLSearchParams({ projectId, conversationId: latest.conversationId })}`, { replace: true }); return; }
        const document = validateOwnedDesignDocument(await client.getDocument(projectId, brandId, { userId, assertContext }), scope, projectId); assertView();
        setState({ identity, busy: false, dialogue: { attempts: [], document, outputs: [], turns: [], recoveryErrors: {} } });
      })().catch(() => {
        try { assertView(); setState({ identity, busy: false, error: true }); } catch { /* obsolete view */ }
      });
      return () => { if (generation.current === epoch) generation.current++; };
    }
    if (!brandReady || !projectId || !conversationId) {
      if (brandReady && !isNewFile) setState({ identity, busy: false, error: true });
      return () => { if (generation.current === epoch) generation.current++; };
    }
    void (async () => {
      const draft = await stores.drafts.get(scope, projectId, conversationId); assertView();
      if (!draft?.ready) throw new Error('design_entry_association_missing');
      const operation = createDesignDialogueController({ scope, projectId, conversationId, ...stores,
        client: { ...activeDialogueClient, getDocument: client.getDocument }, assertContext,
        publish: (dialogue) => { try { assertView(); setState((previous) => ({ ...previous, identity, dialogue })); } catch { /* obsolete view */ } } });
      // Verify remote ownership and the local project/conversation association before exposing any draft text.
      await operation.refresh(); assertView();
      controller.current = operation;
      setState({ identity, draft, busy: true });
      await operation.initialize(draft); assertView();
      setState((previous) => ({ ...previous, busy: false }));
    })().catch(() => {
      try { assertView(); setState((previous) => ({ ...previous, identity, busy: false, error: true })); } catch { /* obsolete view */ }
    });
    return () => { if (generation.current === epoch) generation.current++; };
  }, [activeDialogueClient, brandId, brandReady, client, conversationId, identity, isDocumentOnly, isNewFile, navigate, projectId, retry, stores, userId, workspace.detailPath]);
  // A saved image opens as its own Canvas project with the image placed on it, like Light's project cards.
  const openedImage = useRef('');
  useEffect(() => {
    const key = JSON.stringify([userId, brandId, openImageId]);
    if (!brandReady || !openImageId || openedImage.current === key) return;
    openedImage.current = key;
    const assertContext = () => { const auth = useAuthStore.getState(); if (auth.user?.id !== userId || auth.currentBrand?.id !== brandId) throw new Error('design_entry_scope_stale'); };
    void openImageProject({ scope: { userId, brandId }, imageId: openImageId, assertContext, client, measure: designCanvasClient.measureImage })
      .then((document) => navigate(`${workspace.detailPath}?${new URLSearchParams({ projectId: document.id })}`, { replace: true }))
      .catch(() => setEntryError('画像のプロジェクトを開けませんでした。もう一度お試しください'));
  }, [brandId, brandReady, client, navigate, openImageId, userId, workspace.detailPath]);
  // Images handed over from 「キャンバスで編集」 become the first send's references.
  const addReferenceFiles = references.addFiles;
  const pendingReferences = useRef(references.references);
  pendingReferences.current = references.references;
  const attachedFrom = useRef('');
  useEffect(() => {
    const key = JSON.stringify([userId, brandId, attachImageId, attachArtifactId]);
    if (!brandReady || (!attachImageId && !attachArtifactId) || attachedFrom.current === key) return;
    attachedFrom.current = key;
    const name = designAttachmentName({ galleryImageId: attachImageId, artifactId: attachArtifactId });
    void resolveDesignAttachment({ brandId, userId, galleryImageId: attachImageId, artifactId: attachArtifactId })
      .then((file) => {
        // Reopening the same link while that image is still waiting to be sent must not attach it twice.
        if (pendingReferences.current.some((reference) => reference.name.replace(/\.[a-z]+$/i, '') === name)) return;
        return addReferenceFiles([file]);
      })
      .catch(() => setEntryError('引き継いだ画像を読み込めませんでした。画像を追加し直してください'))
      .finally(() => {
        const next = new URLSearchParams(location.search);
        next.delete(DESIGN_ATTACH_GALLERY_PARAM); next.delete(DESIGN_ATTACH_ARTIFACT_PARAM);
        navigate(`${location.pathname}${next.toString() ? `?${next}` : ''}`, { replace: true });
      });
  }, [attachArtifactId, attachImageId, brandId, brandReady, location.pathname, location.search, navigate, addReferenceFiles, userId]);
  const visible = state.identity === identity ? state : undefined;
  const sources = [...new Set([
    ...(visible?.draft?.references.map((reference) => reference.storagePath) ?? []),
    ...(visible?.dialogue?.document.snapshot.objects.flatMap((object) => object.type === 'image' && typeof object.src === 'string' ? [object.src] : []) ?? []),
    ...(visible?.dialogue?.outputs.map((output) => output.storagePath) ?? []),
    ...(visible?.dialogue?.attempts.flatMap((attempt) => attempt.input.references.map((reference) => reference.storagePath)) ?? []),
  ])];
  const sourceKey = JSON.stringify(sources);
  useEffect(() => {
    let active = true;
    const authMatches = () => { const auth = useAuthStore.getState(); return auth.user?.id === userId && auth.currentBrand?.id === brandId; };
    setPreviews((previous) => previous.identity === identity ? previous : { identity, urls: {} });
    void Promise.all((JSON.parse(sourceKey) as string[]).map(async (source) => {
      if (!authMatches()) return;
      try {
        const resolved = await activeDialogueClient.resolveImage(source);
        if (active && authMatches() && resolved.ok && resolved.url) setPreviews((previous) => ({ identity,
          urls: { ...(previous.identity === identity ? previous.urls : {}), [source]: resolved.url! } }));
      } catch { /* Canonical source remains visible for a subsequent scoped refresh. */ }
    }));
    return () => { active = false; };
  }, [activeDialogueClient, brandId, identity, sourceKey, userId]);
  const urls = previews.identity === identity ? previews.urls : {};
  async function act(operation: (active: NonNullable<typeof controller.current>) => Promise<void>) {
    if (!controller.current || sending.current || visible?.busy) return;
    const active = controller.current;
    const epoch = generation.current;
    sending.current = true;
    setState((previous) => ({ ...previous, busy: true, error: false }));
    try { await operation(active); }
    catch { if (generation.current === epoch) setState((previous) => ({ ...previous, error: true })); }
    finally { if (generation.current === epoch) { sending.current = false; setState((previous) => ({ ...previous, busy: false })); } }
  }
  const imageObjects = useMemo(() => visible?.dialogue?.document.snapshot.objects.filter((object) => object.type === 'image' && object.visible !== false) ?? [],
    [visible?.dialogue?.document]);
  // Every visible object (images, shapes, panels, text) in paint order.
  const canvasObjects = useMemo(() => [...(visible?.dialogue?.document.snapshot.objects ?? [])]
    .filter((object) => object.visible !== false && typeof object.id === 'string')
    .sort((left, right) => (Number(left.zIndex) || 0) - (Number(right.zIndex) || 0)) as DesignCanvasObject[], [visible?.dialogue?.document]);
  const selectedObject = canvasObjects.find((object) => object.id === selected);
  const selectedOutput = selectedObject && visible?.dialogue?.outputs.some((output) => (selectedObject.metadata as Record<string, unknown> | undefined)?.imageId === output.imageId);
  // Any saved image on the canvas (e.g. an opened library image) can be selected and sent as the edit reference.
  const selectedCanvasReference = !selectedOutput ? canvasImageReference(selectedObject as Record<string, unknown> | undefined) : null;
  const withSelectedReference = (manifest: DesignDialogueManifestReference[]) => (selectedCanvasReference
    ? [selectedCanvasReference, ...manifest.filter((reference) => reference.imageId !== selectedCanvasReference.imageId)] : manifest)
    .map((reference, order) => ({ ...reference, order }));
  // A project opened from a single image starts with that image selected, so the first request edits it.
  const singleImageId = isDocumentOnly && imageObjects.length === 1 ? String(imageObjects[0].id) : '';
  useEffect(() => { if (singleImageId) setSelected((current) => current ?? singleImageId); }, [singleImageId]);
  const projectTitle = visible?.dialogue?.document.title ?? 'Untitled';
  const hasContent = canvasObjects.length > 0;
  const [shapeMenu, setShapeMenu] = useState(false);
  const [editingText, setEditingText] = useState<{ id: string; text: string } | null>(null);
  const [dragged, setDragged] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const objectDrag = useRef<{ id: string; pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const editable = Boolean(projectId && visible?.dialogue && !visible.busy);
  /** Applies an object change locally, then saves it to the Canvas document (fresh revision) and reloads it. */
  const mutateObjects = async (change: (objects: Record<string, unknown>[]) => Record<string, unknown>[]) => {
    const current = visible?.dialogue?.document;
    if (!current || !editable) return;
    setState((previous) => previous.dialogue ? { ...previous, dialogue: { ...previous.dialogue,
      document: { ...previous.dialogue.document, snapshot: { ...previous.dialogue.document.snapshot, objects: change(previous.dialogue.document.snapshot.objects) } } } } : previous);
    const assertContext = () => { const auth = useAuthStore.getState(); if (auth.user?.id !== userId || auth.currentBrand?.id !== brandId) throw new Error('design_entry_scope_stale'); };
    const context = { userId, assertContext };
    try {
      const fresh = await activeDialogueClient.getDocument(projectId, brandId, context);
      await activeDialogueClient.updateDocument({ documentId: projectId, brandId, title: fresh.title, expectedRevision: fresh.revision,
        snapshot: { ...fresh.snapshot, objects: change(fresh.snapshot.objects) } }, context);
    } catch { setEntryError('キャンバスの変更を保存できませんでした'); }
    if (controller.current) await controller.current.refresh().catch(() => setRetry((value) => value + 1));
    else setRetry((value) => value + 1);
  };
  const nextZ = () => canvasObjects.reduce((max, object) => Math.max(max, Number(object.zIndex) || 0), 0) + 1;
  const addObject = (tool: DesignShapeKind | 'frame' | 'text') => {
    setShapeMenu(false);
    const area = canvasRef.current?.getBoundingClientRect();
    const cx = ((area ? (area.width - (panelOpen ? 435 : 0)) / 2 : 400) - view.panX) / view.zoom;
    const cy = ((area ? area.height / 2 : 300) - view.panY) / view.zoom;
    // About a quarter of the visible canvas, so a new object is clearly visible but smaller than the view.
    const visibleShort = area ? Math.min(area.width - (panelOpen ? 435 : 0), area.height) : 600;
    const object = createDesignCanvasObject(tool, cx, cy, nextZ(), undefined, (visibleShort * 0.28) / view.zoom);
    setSelected(object.id);
    if (tool === 'text') setEditingText({ id: object.id, text: String(object.text) });
    void mutateObjects((objects) => [...objects, object]);
  };
  const commitText = () => {
    if (!editingText) return;
    const { id, text } = editingText;
    setEditingText(null);
    void mutateObjects((objects) => objects.map((object) => object.id === id ? { ...object, text: text.trim() ? text : 'テキスト' } : object));
  };
  const deleteSelected = () => {
    if (!selected || !editable) return;
    const id = selected;
    setSelected(null);
    void mutateObjects((objects) => objects.filter((object) => object.id !== id));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || editingText) return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return;
      if (selected) { event.preventDefault(); deleteSelected(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pushView = (next: StudioViewport) => {
    setViewHistory((current) => ({ back: [...current.back.slice(-19), view], forward: [] }));
    setView(next);
  };
  const fitView = () => {
    const area = canvasRef.current?.getBoundingClientRect();
    if (!area || !canvasObjects.length) return null;
    const bounds = canvasObjects.reduce<{ left: number; top: number; right: number; bottom: number }>((box, object) => {
      const x = Number(object.x) || 0; const y = Number(object.y) || 0;
      const w = (Number(object.width) || 440) * (Number(object.scaleX) || 1); const h = (Number(object.height) || 440) * (Number(object.scaleY) || 1);
      return { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x + w), bottom: Math.max(box.bottom, y + h) };
    }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    const availableWidth = area.width - (panelOpen ? 435 : 0) - FIT_PADDING * 2;
    const availableHeight = area.height - 140 - FIT_PADDING;
    const zoom = Math.min(1, Math.max(0.1, Math.min(availableWidth / (bounds.right - bounds.left), availableHeight / (bounds.bottom - bounds.top))));
    const panX = FIT_PADDING + (availableWidth - (bounds.right - bounds.left) * zoom) / 2 - bounds.left * zoom;
    const panY = FIT_PADDING + (availableHeight - (bounds.bottom - bounds.top) * zoom) / 2 - bounds.top * zoom;
    return { zoom: Math.round(zoom * 100) / 100, panX, panY };
  };
  const layoutKey = `${identity}:${imageObjects.length}`;
  useEffect(() => {
    if (!imageObjects.length || fitted === layoutKey) return;
    const next = fitView();
    if (next) { setView(next); setFitted(layoutKey); }
    // Fit once per new image so generated results land in view, like Light.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  const presets = ASSISTANT_PRESETS[workspaceId];
  const visiblePresets = [0, 1, 2].map((offset) => presets[(presetPage * 3 + offset) % presets.length]);

  const startProject = async (text: string) => {
    if (!text.trim() || entrySending || !brandReady) return;
    setEntryError(null);
    let manifest: DesignDialogueManifestReference[];
    try { manifest = references.manifest(); }
    catch { setEntryError('参考画像の保存が終わるまでお待ちください'); return; }
    setEntrySending(true);
    const coordinator = createDesignEntryCoordinator({ scope: { userId, brandId }, workspace, client,
      assertScope: () => { const auth = useAuthStore.getState(); if (auth.user?.id !== userId || auth.currentBrand?.id !== brandId) throw new Error('design_entry_scope_stale'); } });
    try {
      const href = await coordinator.prepare(text.trim(), withSelectedReference(manifest), isDocumentOnly ? projectId : undefined);
      references.clear();
      navigate(href, { replace: true });
    } catch (error) {
      const code = error instanceof Error && /^[a-z0-9_:-]{1,96}$/i.test(error.message) ? error.message : 'design_entry_readback_failed';
      setEntryError(`プロジェクトを作成できませんでした（${code}）`);
    } finally {
      coordinator.dispose();
      setEntrySending(false);
    }
  };
  const submit = () => {
    const text = prompt;
    if (!text.trim()) return;
    if (isNewFile || isDocumentOnly) { void startProject(text); return; }
    let manifest: DesignDialogueManifestReference[];
    try { manifest = references.manifest(); }
    catch { setEntryError('参考画像の保存が終わるまでお待ちください'); return; }
    void act(async (active) => {
      await active.send(text, selectedOutput ? manifest : withSelectedReference([...(visible?.draft?.references ?? []), ...manifest]),
        selectedOutput ? selected! : undefined);
      if (generation.current && controller.current === active) { setPrompt(''); references.clear(); }
    });
  };
  const addFiles = (files: File[]) => {
    const images = files.filter((file) => /^image\/(png|jpe?g|webp|avif)$/.test(file.type) && file.size <= 20 * 1024 * 1024);
    if (images.length !== files.length) setEntryError('jpg、jpeg、png、webp（最大20MBまで）の画像を選択してください');
    if (images.length) void references.addFiles(images);
  };
  const onUpload = (event: ChangeEvent<HTMLInputElement>) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; };
  const onDrop = (event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragOver(false); addFiles(Array.from(event.dataTransfer.files ?? [])); };
  const renameProject = async (next: string) => {
    const title = next.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 160);
    setTitleDraft(null);
    const document = visible?.dialogue?.document;
    if (!title || !document || title === document.title || !cloudflareDataPlane) return;
    setTitleError(false);
    const context = { userId, assertContext: () => { const auth = useAuthStore.getState(); if (auth.user?.id !== userId || auth.currentBrand?.id !== brandId) throw new Error('design_entry_scope_stale'); } };
    try {
      const fresh = await activeDialogueClient.getDocument(projectId, brandId, context);
      await activeDialogueClient.updateDocument({ documentId: projectId, brandId, title, expectedRevision: fresh.revision, snapshot: fresh.snapshot }, context);
    } catch { setTitleError(true); }
    if (controller.current) await controller.current.refresh().catch(() => setTitleError(true));
    else setRetry((value) => value + 1);
  };
  const downloadSelected = async () => {
    const object = selectedObject ?? imageObjects[imageObjects.length - 1];
    const url = object && typeof object.src === 'string' ? urls[object.src] : undefined;
    if (!url) return;
    const response = await fetch(url);
    const blob = await watermarkImageBlobIfOn(await response.blob());
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${String(object?.label ?? 'design')}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const referenceTray = references.references.length > 0 && <ol className="mb-2 flex flex-wrap gap-2" aria-label="送信する参考画像" data-testid="design-pending-references">
    {references.references.map((reference) => <li key={reference.id} className="relative h-14 w-14 overflow-hidden rounded-lg bg-white/5" data-status={reference.status}>
      {references.previews[reference.id] && <img src={references.previews[reference.id]} alt={reference.name} className="h-full w-full object-cover" />}
      {reference.status !== 'ready' && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] text-white">{reference.status === 'failure' ? '失敗' : '保存中'}</span>}
      <button type="button" aria-label={`${reference.name}を削除`} onClick={() => references.remove(reference.id)} className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white"><X className="h-3 w-3" /></button>
      <span className="sr-only" role="status">{reference.name}</span>
    </li>)}
  </ol>;

  const toolbarButton = 'flex h-[34px] w-[34px] items-center justify-center rounded-lg text-neutral-300 transition hover:bg-white/10 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent';
  const WorkspaceIcon = workspaceId === 'marketing' ? Clapperboard : Palette;

  return <main className="relative h-[calc(100dvh-50px)] min-h-[620px] overflow-hidden bg-[#0d1113] text-white" data-testid="design-entry-detail"
    data-workspace={workspaceId} onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_62%_8%,rgba(64,140,150,0.16),transparent_42%),radial-gradient(ellipse_at_30%_70%,rgba(110,60,40,0.10),transparent_38%)]" />
    <input ref={uploadRef} type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={onUpload} data-testid="design-entry-upload-input" />

    <section ref={canvasRef} aria-label="デザインCanvas" className="absolute inset-0" data-testid="design-own-canvas"
      style={{ cursor: move ? 'grab' : 'default' }}
      onPointerDown={(event) => {
        if (event.button !== 1 && !(move && event.button === 0)) return;
        if ((event.target as HTMLElement).closest('button, a, input, textarea')) return;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
      }} onPointerMove={(event) => {
        const previous = drag.current; if (!previous || previous.id !== event.pointerId) return;
        setView((current) => panStudioViewport(current, event.clientX - previous.x, event.clientY - previous.y));
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }} onPointerUp={(event) => { if (drag.current?.id === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onPointerCancel={() => { drag.current = null; }}
      onWheel={(event) => {
        if ((event.target as HTMLElement).closest('aside, textarea')) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setView((current) => event.ctrlKey || event.metaKey ? zoomStudioViewport(current, current.zoom * Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top })
          : panStudioViewport(current, -event.deltaX, -event.deltaY));
      }}>
      <div className="absolute origin-top-left" data-testid="design-canvas-world" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
        {canvasObjects.map((object) => {
          const id = String(object.id);
          const offset = dragged?.id === id ? dragged : null;
          const isImage = object.type === 'image';
          return <button key={id} type="button" data-testid="design-canvas-layer" data-object-id={id} data-object-type={object.type} aria-label={String(object.label ?? (isImage ? 'デザイン画像' : '図形'))}
            aria-pressed={id === selected}
            onPointerDown={(event) => {
              if (move || event.button !== 0 || object.locked === true || !editable) return;
              event.stopPropagation();
              objectDrag.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const active = objectDrag.current;
              if (!active || active.pointerId !== event.pointerId) return;
              const dx = (event.clientX - active.x) / view.zoom; const dy = (event.clientY - active.y) / view.zoom;
              if (!active.moved && Math.hypot(dx * view.zoom, dy * view.zoom) < 4) return;
              active.moved = true;
              setDragged({ id, dx, dy });
            }}
            onPointerUp={(event) => {
              const active = objectDrag.current;
              if (!active || active.pointerId !== event.pointerId) return;
              objectDrag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
              if (!active.moved || !dragged || dragged.id !== id) return;
              const { dx, dy } = dragged;
              setDragged(null);
              setSelected(id);
              void mutateObjects((objects) => objects.map((item) => item.id === id ? { ...item, x: (Number(item.x) || 0) + dx, y: (Number(item.y) || 0) + dy } : item));
            }}
            onClick={() => { if (!move && !dragged) setSelected(id === selected ? null : id); }}
            onDoubleClick={() => { if (object.type === 'text' && editable) setEditingText({ id, text: String(object.text ?? '') }); }}
            className={`absolute text-left ${isImage ? 'overflow-hidden bg-white/5' : ''} ${id === selected ? 'outline outline-[6px] outline-[#0bcabc]' : ''} ${editable && !move ? 'cursor-move' : ''}`}
            style={{ left: (Number(object.x) || 0) + (offset?.dx ?? 0), top: (Number(object.y) || 0) + (offset?.dy ?? 0), width: Number(object.width) || 440, height: Number(object.height) || 440,
              transform: `rotate(${Number(object.rotation) || 0}deg) scale(${Number(object.scaleX) || 1}, ${Number(object.scaleY) || 1})`, opacity: typeof object.opacity === 'number' ? object.opacity : 1, zIndex: Number(object.zIndex) || 0 }}>
            {isImage ? (typeof object.src === 'string' && urls[object.src] ? <img src={urls[object.src]} alt={String(object.label ?? 'デザイン画像')} className="h-full w-full object-contain" draggable={false} /> : <span className="text-sm text-neutral-400">画像を読み込んでいます</span>)
              : editingText?.id === id ? <textarea autoFocus value={editingText.text} aria-label="テキストを編集" data-testid="design-text-editor"
                onChange={(event) => setEditingText({ id, text: event.target.value })} onBlur={commitText}
                onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); commitText(); } }}
                onPointerDown={(event) => event.stopPropagation()}
                className="h-full w-full resize-none bg-transparent leading-tight text-white outline-none" style={{ fontSize: Number(object.fontSize) || 80, color: typeof object.fill === 'string' ? object.fill : '#ffffff' }} />
              : <DesignCanvasShape object={object} />}
          </button>;
        })}
      </div>
    </section>

    {!hasContent && <label data-testid="design-entry-dropzone" className={`absolute flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed transition ${dragOver ? 'border-[#0bcabc] bg-[#0bcabc]/5' : 'border-white/20 bg-white/[0.015] hover:border-white/35'}`}
      style={{ left: `calc((100% - ${panelOpen ? 435 : 0}px) / 2 - 384px)`, top: 'calc(50% - 249px)', width: 768, height: 498 }}>
      <input type="file" accept={IMAGE_ACCEPT} multiple className="sr-only" onChange={onUpload} aria-label="画像をアップロード" />
      <Upload className="h-9 w-9 text-neutral-200" strokeWidth={1.75} />
      <p className="mt-5 text-base font-medium text-neutral-100">{visible?.busy ? 'デザインを作成しています' : 'クリック・ドラッグ＆ドロップで画像をアップロード、またはAIとチャット'}</p>
      <p className="mt-2 text-sm text-neutral-500">対応形式：jpg、jpeg、png、webp（最大20MBまで）</p>
    </label>}

    <div className="absolute left-8 top-8 z-20 w-[295px] rounded-xl border border-white/10 bg-[#1b2023]/95 shadow-xl backdrop-blur" data-testid="design-project-card">
      <Link to={workspace.homeHref} className="flex h-5 items-center gap-2 px-[9px] pt-[9px] text-sm text-neutral-400 hover:text-neutral-200" style={{ boxSizing: 'content-box' }} data-testid="design-workspace-home">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-[linear-gradient(135deg,#46c7c3,#4b6fd8)]"><WorkspaceIcon className="h-3.5 w-3.5 text-white" /></span>{workspace.label}
      </Link>
      <div className="mx-2 mt-2 border-t border-white/10" />
      <div className="flex h-[45px] items-center gap-2 px-[9px]">
        <Link to={workspace.homeHref} aria-label="戻る" className="flex h-5 w-5 items-center justify-center text-neutral-300 hover:text-white" data-testid="design-back"><ChevronLeft className="h-5 w-5" /></Link>
        <span className="h-4 w-px bg-white/15" />
        {titleDraft !== null ? <input autoFocus value={titleDraft} maxLength={160} aria-label="プロジェクト名" data-testid="design-project-title-input"
          onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => void renameProject(titleDraft)}
          onKeyDown={(event) => { if (event.key === 'Enter') void renameProject(titleDraft); if (event.key === 'Escape') setTitleDraft(null); }}
          className="h-[29px] min-w-0 flex-1 rounded border border-[#0bcabc]/60 bg-transparent px-1 text-base text-white outline-none" />
          : <button type="button" disabled={!visible?.dialogue} onClick={() => setTitleDraft(projectTitle)} aria-label="プロジェクト名を編集" data-testid="design-project-title"
            className="h-[29px] min-w-0 flex-1 truncate rounded px-1 text-left text-base text-white hover:bg-white/5 disabled:hover:bg-transparent">{projectTitle}</button>}
      </div>
      {titleError && <p role="alert" className="px-3 pb-2 text-xs text-red-300">名前を保存できませんでした</p>}
    </div>

    {remainingUnits !== null && <div aria-label="残りクレジット" className="absolute top-4 z-20 flex h-[37px] items-center gap-1.5 rounded-xl border border-white/10 bg-[#1b2023] px-3 text-sm text-neutral-200"
      style={{ right: panelOpen ? 452 : 64 }}><Sparkles className="h-4 w-4" />{remainingUnits.toLocaleString()}</div>}

    {hasContent && <nav aria-label="キャンバスメニュー" className="absolute left-[13px] z-20 flex flex-col gap-2 rounded-xl border border-white/10 bg-[#1b2023]/95 p-2" style={{ top: 'calc(50% - 109px)' }}>
      <button type="button" aria-label="レイヤー" aria-pressed={panelTab === 'layers' && panelOpen} onClick={() => { setPanelOpen(true); setPanelTab('layers'); }} className="flex h-[47px] w-[47px] items-center justify-center rounded-lg bg-white/[0.06] text-neutral-200 hover:bg-white/10"><Layers className="h-6 w-6" /></button>
      <button type="button" aria-label="アセット" onClick={() => uploadRef.current?.click()} className="flex h-[47px] w-[47px] items-center justify-center rounded-lg text-neutral-200 hover:bg-white/10"><Boxes className="h-6 w-6" /></button>
    </nav>}

    {hasContent && <div role="toolbar" aria-label="キャンバスツール" className="absolute bottom-[18px] z-20 flex items-center gap-1 rounded-xl border border-white/10 bg-[#1b2023]/95 p-[3px]" style={{ left: 'calc(50% - 400px)' }} data-testid="design-canvas-toolbar">
      <button type="button" aria-label="選択" aria-pressed={!move} onClick={() => setMove(false)} className={`${toolbarButton} ${!move ? 'bg-white/10 text-white' : ''}`}><MousePointer2 className="h-[18px] w-[18px]" /></button>
      <button type="button" aria-label="ドラッグ" aria-pressed={move} onClick={() => setMove(true)} className={`${toolbarButton} ${move ? 'bg-white/10 text-white' : ''}`}><Hand className="h-[18px] w-[18px]" /></button>
      <button type="button" aria-label="取り消し" disabled={!viewHistory.back.length} onClick={() => setViewHistory((current) => { const previous = current.back[current.back.length - 1]; if (!previous) return current; setView(previous); return { back: current.back.slice(0, -1), forward: [...current.forward, view] }; })} className={toolbarButton}><Undo2 className="h-[18px] w-[18px]" /></button>
      <button type="button" aria-label="やり直し" disabled={!viewHistory.forward.length} onClick={() => setViewHistory((current) => { const next = current.forward[current.forward.length - 1]; if (!next) return current; setView(next); return { back: [...current.back, view], forward: current.forward.slice(0, -1) }; })} className={toolbarButton}><Redo2 className="h-[18px] w-[18px]" /></button>
      <span className="mx-[2px] h-5 w-px bg-white/15" />
      <span className="relative">
        <button type="button" aria-label="図形" aria-expanded={shapeMenu} disabled={!editable} onClick={() => setShapeMenu((open) => !open)} className={`${toolbarButton} ${shapeMenu ? 'bg-white/10 text-white' : ''}`}><Shapes className="h-[18px] w-[18px]" /></button>
        {shapeMenu && <div role="menu" aria-label="図形" data-testid="design-shape-menu" className="absolute bottom-[48px] left-1/2 flex -translate-x-1/2 gap-1 rounded-xl border border-white/10 bg-[#1b2023] p-2 shadow-2xl">
          {DESIGN_SHAPES.map((shape) => <button key={shape.kind} type="button" role="menuitem" onClick={() => addObject(shape.kind)}
            className="flex w-[60px] flex-col items-center gap-1 rounded-lg py-2 text-xs text-neutral-200 hover:bg-white/10">
            <span className="h-6 w-6"><DesignCanvasShape object={{ ...createDesignCanvasObject(shape.kind, 0, 0, 0, () => 'menu'), width: 24, height: shape.kind === 'line' || shape.kind === 'arrow' ? 24 : 24, fill: 'transparent', stroke: '#d4d4d4', strokeWidth: 2 }} /></span>{shape.label}</button>)}
        </div>}
      </span>
      <button type="button" aria-label="パネル" disabled={!editable} onClick={() => addObject('frame')} className={toolbarButton}><LayoutPanelTop className="h-[18px] w-[18px]" /></button>
      <button type="button" aria-label="テキスト" disabled={!editable} onClick={() => addObject('text')} className={toolbarButton}><Type className="h-[18px] w-[18px]" /></button>
      <button type="button" aria-label="画像/動画を挿入する" onClick={() => uploadRef.current?.click()} className={toolbarButton}><ImagePlus className="h-[18px] w-[18px]" /></button>
      <span className="mx-[2px] h-5 w-px bg-white/15" />
      {/* Light ends the tool group with 企画提案書; Heavy opens its own design documents (/board/edit). */}
      <Link to="/board/edit" aria-label="企画提案書" className={toolbarButton}><FileText className="h-[18px] w-[18px]" /></Link>
      <span className="ml-[64px]" />
      <span className="flex items-center">
      <button type="button" aria-label="縮小" onClick={() => pushView(zoomStudioViewport(view, view.zoom / 1.25, { x: 500, y: 400 }))} className="flex h-7 w-7 items-center justify-center rounded text-neutral-300 hover:text-white"><Minus className="h-4 w-4" /></button>
      <label className="relative flex h-8 w-20 items-center justify-between rounded-lg border border-white/10 bg-[#141819] px-2 text-sm text-neutral-200">
        <span data-testid="design-zoom">{Math.round(view.zoom * 100)}%</span><ChevronDown className="h-3.5 w-3.5 text-neutral-500" />
        <select aria-label="ズーム" value={Math.round(view.zoom * 100)} onChange={(event) => pushView(zoomStudioViewport(view, Number(event.target.value) / 100, { x: 500, y: 400 }))}
          className="absolute inset-0 cursor-pointer opacity-0">
          {[...new Set([10, 20, 25, 50, 75, 100, 150, 200, Math.round(view.zoom * 100)])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{value}%</option>)}
        </select>
      </label>
      <button type="button" aria-label="拡大" onClick={() => pushView(zoomStudioViewport(view, view.zoom * 1.25, { x: 500, y: 400 }))} className="flex h-7 w-7 items-center justify-center rounded text-neutral-300 hover:text-white"><Plus className="h-4 w-4" /></button>
      </span>
      <button type="button" aria-label="全体を表示" onClick={() => { const next = fitView(); if (next) pushView(next); }} className="ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-neutral-300 hover:bg-white/10 hover:text-white"><Maximize className="h-[18px] w-[18px]" /></button>
      <button type="button" aria-label="ダウンロード" onClick={() => void downloadSelected()} className="ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-neutral-300 hover:bg-white/10 hover:text-white"><Download className="h-[18px] w-[18px]" /></button>
    </div>}

    {!panelOpen && <button type="button" aria-label="パネルを開く" onClick={() => setPanelOpen(true)} className="absolute right-3 top-4 z-30 flex h-[37px] items-center gap-2 rounded-xl border border-white/10 bg-[#1b2023] px-3 text-sm text-neutral-200"><PanelRightOpen className="h-4 w-4" />AIアシスタント</button>}

    {panelOpen && <aside className="absolute bottom-3 right-3 top-4 z-30 flex w-[423px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#171c1f]" aria-label="デザインアシスタント" data-testid="design-assistant-panel"
      data-project-id={visible?.draft?.projectId} data-conversation-id={visible?.draft?.conversationId}>
      <div className="flex h-[67px] shrink-0 items-center gap-1 border-b border-white/10 px-[17px]">
        {([['assistant', 'AIアシスタント', MessageCircleMore], ['layers', 'レイヤー設定', Layers]] as const).map(([id, label, Icon]) => <button key={id} type="button" aria-pressed={panelTab === id} onClick={() => setPanelTab(id)}
          className={`flex h-8 items-center gap-1 rounded-full px-3 text-sm font-medium ${panelTab === id ? 'border border-[#0bcabc]/70 bg-[#0bcabc]/10 text-white' : 'text-neutral-400 hover:text-white'}`}><Icon className="h-4 w-4" />{label}</button>)}
        <button type="button" aria-label="パネルを閉じる" onClick={() => setPanelOpen(false)} className="ml-auto text-neutral-400 hover:text-white"><PanelRightClose className="h-4 w-4" /></button>
      </div>
      {panelTab === 'assistant' ? <>
        <div className="flex h-[38px] shrink-0 items-center justify-between px-[11px] pt-3">
          <h2 className="text-base font-medium">{visible?.dialogue?.attempts.length ? 'デザインアシスタント' : '新しいチャット'}</h2>
          <Link to={workspace.detailPath} aria-label="新しいチャット" className="text-neutral-400 hover:text-white" data-testid="design-new-chat"><MessageSquarePlus className="h-5 w-5" /></Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[11px] pb-4" data-testid={visible?.draft ? 'design-entry-draft' : undefined} data-project-id={visible?.draft?.projectId} data-conversation-id={visible?.draft?.conversationId}>
          {(isNewFile || (!visible?.dialogue?.attempts.length && !visible?.draft)) && !visible?.busy && <div data-testid="design-assistant-welcome">
            {hasContent && workspaceId === 'design' ? <>
              {/* Light greets a project that already has a canvas with editing scenes instead of the new-file presets. */}
              <h1 className="mt-[52px] text-[26px] font-medium leading-[34px]">今日は何をデザインしますか？</h1>
              <p className="mt-4 text-sm leading-5 text-neutral-400">下からデザイン要望を入力するか、画像をアップロード／キャンバスから選択して修正・デザインできます</p>
              <div className="mt-[40px] flex flex-col items-start gap-3" data-testid="design-canvas-scenes">
                {CANVAS_SCENES.map((scene) => <button key={scene} type="button" onClick={() => setPrompt(scene)} className="flex h-10 items-center gap-2 rounded-xl px-4 text-left text-base text-neutral-200 hover:bg-white/5"><Lightbulb className="h-5 w-5 shrink-0 text-neutral-300" />{scene}</button>)}
              </div>
            </> : <>
            <h1 className="mt-[52px] text-[26px] font-medium leading-[34px]">こんにちは<br />専属のデザインアシスタントがサポートします。</h1>
            <p className="mt-4 text-sm leading-5 text-neutral-400">具体的なリクエストを入力するか、以下のプリセットから最適なシーンを選択してください。</p>
            <div className="mt-[40px] flex flex-col items-start gap-3">
              {visiblePresets.map((preset) => <button key={preset} type="button" onClick={() => setPrompt(preset)} className="flex h-10 items-center gap-2 rounded-xl px-4 text-left text-base text-neutral-200 hover:bg-white/5"><Lightbulb className="h-5 w-5 shrink-0 text-neutral-300" />{preset}</button>)}
              <button type="button" onClick={() => setPresetPage((page) => page + 1)} className="-mt-1 flex h-8 w-[72px] items-center gap-1.5 rounded-lg px-3 text-sm text-neutral-300 hover:bg-white/5"><RefreshCw className="h-4 w-4" />更新</button>
            </div>
            </>}
          </div>}
          {visible?.draft && !visible?.dialogue?.attempts.length && <p data-testid="design-entry-prompt" className="ml-auto mt-4 w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl bg-white/[0.07] px-4 py-3 text-sm">{visible.draft.prompt}</p>}
          {visible?.dialogue?.attempts.map((attempt, index) => <article key={attempt.input.requestId} className="mt-4" data-testid="design-dialogue-attempt">
            {!!attempt.input.references.length && <div className="mb-2 ml-auto flex w-fit flex-wrap justify-end gap-1.5" aria-label="参考画像">{attempt.input.references.map((reference) => <span key={`${reference.order}-${reference.imageId}`} data-testid="design-entry-reference" data-image-id={reference.imageId} data-storage-path={reference.storagePath} className="block h-14 w-14 overflow-hidden rounded-lg bg-white/5">
              {urls[reference.storagePath] && <img src={urls[reference.storagePath]} alt={reference.name} className="h-full w-full object-cover" />}</span>)}</div>}
            <p data-testid={index === 0 ? 'design-entry-prompt' : 'design-user-message'} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl bg-white/[0.07] px-4 py-3 text-sm">{attempt.input.prompt}</p>
            {attempt.assistant.state === 'completed' ? <p data-testid="design-assistant-message" className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-200">{attempt.assistant.content}</p>
              : <p className="mt-3 text-sm text-neutral-400">{attempt.assistant.state === 'failed' ? '応答を取得できませんでした。指示を編集してもう一度送信できます。' : '応答の状態を確認しています。'}</p>}
            {attempt.imageAttempted && <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="design-image-task">
              <p className="flex items-center gap-2 text-sm text-neutral-300"><Sparkles className="h-4 w-4 text-[#0bcabc]" />画像タスク
                <span className="ml-auto text-xs text-neutral-500">{attempt.imageResult === 'completed' ? '完了' : attempt.imageResult === 'failed' ? '失敗' : '生成中'}</span></p>
              <div className="mt-2 flex flex-wrap gap-2" aria-label="生成画像">{visible.dialogue?.turns.find((turn) => turn.clientRequestKey === attempt.imageClientRequestKey)?.outputs.map((output) =>
                <button key={output.imageId} type="button" data-testid="design-generated-preview" data-image-id={output.imageId} className="w-24" onClick={() => {
                  const object = imageObjects.find((item) => (item.metadata as Record<string, unknown> | undefined)?.imageId === output.imageId);
                  if (object) setSelected(String(object.id));
                }}>
                  {urls[output.storagePath] && <img src={urls[output.storagePath]} alt="生成したデザイン" className="h-28 w-24 rounded-lg bg-white/5 object-contain" />}
                </button>)}</div>
              {attempt.imageResult !== 'completed' && <p className="mt-2 text-xs text-neutral-400">{attempt.imageResult === 'failed' ? '画像を作成できませんでした。以前の画像はそのまま使用できます。'
                : attempt.imageResult === 'ack-deferred' ? '画像を保存しました。生成記録の確認を続けられます。' : '画像の作成・保存状態を確認しています。'}</p>}
            </div>}
            {attempt.assistant.state === 'completed' && !attempt.imageAttempted && <button type="button" disabled={visible.busy} className="mt-3 text-sm text-[#0bcabc]" onClick={() => void act((active) => active.continueImage(attempt.input.requestId))}>画像を作成</button>}
            {(attempt.assistant.state === 'running' || attempt.assistant.state === 'unknown' || (attempt.imageAttempted && !['completed', 'failed'].includes(attempt.imageResult ?? '')))
              && <button type="button" data-testid="design-attempt-reconcile" disabled={visible.busy} className="mt-3 text-sm text-[#0bcabc]" onClick={() => void act((active) => active.reconcile(attempt.input.requestId))}>作成状態を再確認</button>}
          </article>)}
          {visible?.busy && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-neutral-400"><RefreshCw className="h-4 w-4 animate-spin" />{visible?.dialogue ? 'デザインを作成しています' : '保存状態を確認しています。'}</p>}
          {visible?.error && <div role="alert" data-testid="design-entry-recovery" className="my-4 rounded-lg bg-white/5 p-4 text-sm"><p>保存・作成状態を確認できませんでした。入力と以前の画像は保持されています。</p>
            <button type="button" disabled={visible.busy} className="mt-3 text-[#0bcabc]" onClick={() => setRetry((value) => value + 1)}>保存状態を再確認</button></div>}
        </div>
        <form className="mx-[11px] mb-4 shrink-0 rounded-2xl border border-white/10 bg-[#20262a] px-[15px] pb-4 pt-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          {(selectedOutput || selectedCanvasReference) && <div className="mb-2 flex items-center justify-between text-xs text-[#0bcabc]"><span>選択した画像を参考に編集</span><button type="button" onClick={() => setSelected(null)} aria-label="選択を解除">×</button></div>}
          {referenceTray}
          {(entryError || references.error) && <p role="alert" className="mb-2 text-xs text-red-300">{entryError ?? references.error}</p>}
          <textarea data-testid="design-followup-prompt" aria-label="デザインの指示" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={4000}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}
            placeholder="商品画像をアップロードして、デザインのリクエストを教えてください" rows={1} className="block max-h-40 min-h-8 w-full resize-none bg-transparent text-sm leading-6 text-white outline-none placeholder:text-neutral-500" />
          <div className="mt-7 flex items-center justify-between">
            <button type="button" aria-label="画像を追加" onClick={() => uploadRef.current?.click()} className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-300 hover:bg-white/10"><ImagePlus className="h-5 w-5" /></button>
            <button type="submit" aria-label="送信" data-testid="design-followup-send" disabled={!prompt.trim() || Boolean(visible?.busy) || entrySending || !references.ready || (!isNewFile && !visible?.dialogue)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0bcabc] text-neutral-950 transition hover:bg-[#61fff4] disabled:bg-white/10 disabled:text-neutral-500"><ArrowUp className="h-5 w-5" /></button>
          </div>
        </form>
      </> : <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="design-layer-panel">
        {!canvasObjects.length && <p className="text-sm text-neutral-500">レイヤーはまだありません</p>}
        <ol>{[...canvasObjects].reverse().map((object) => <li key={String(object.id)}><button type="button" data-testid="design-layer-select" aria-pressed={selected === object.id}
          onClick={() => setSelected(String(object.id))} className={`mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${selected === object.id ? 'bg-white/10' : 'hover:bg-white/5'}`}>
          <span className="h-10 w-10 shrink-0 overflow-hidden rounded bg-white/5">{typeof object.src === 'string' && urls[object.src] && <img src={urls[object.src]} alt="" className="h-full w-full object-cover" />}</span>
          <span className="truncate">{object.type === 'text' && typeof object.text === 'string' ? object.text : String(object.label ?? 'デザイン画像')}</span></button></li>)}</ol>
      </div>}
    </aside>}
  </main>;
}
