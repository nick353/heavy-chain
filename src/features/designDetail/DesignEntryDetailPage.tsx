import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown, ChevronLeft, Clapperboard, Download, Hand, ImagePlus, Layers, Lightbulb, LayoutPanelTop, MessageCircleMore,
  MessageSquarePlus, MousePointer2, Palette, PanelRightClose, PanelRightOpen, Redo2, RefreshCw, Shapes, Sparkles,
  Type, Undo2, Upload, X, Boxes, ArrowUp, FileText, Trash2, ZoomIn, ZoomOut, BookOpen, Keyboard, Mouse,
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
import { BEGINNER_GUIDE_TABS, CANVAS_SHORTCUT_GROUPS, applyCanvasPatch, cloneCanvasObjects, diffCanvasObjects, expandGroupSelection, groupObjects, moveCanvasLayer, objectsInRect,
  throughSelect, ungroupObjects, type CanvasLayerMove, type CanvasPatch } from './designCanvasShortcuts';
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

/** A document "has a canvas" when it holds objects and no chat has started on it yet. */
const hasContentNow = (dialogue: DesignDialogueState) => dialogue.document.snapshot.objects.length > 0 && dialogue.attempts.length === 0;

const GUIDE_EMPTY_ICON = '/lightchain-assets/mirror/jp/static/none_list.png';
const INSPIRATION_PLACEHOLDER = '/lightchain-assets/mirror/lightchain-qlxy-prod/persistence/font-end/design-empty-placeholder.png';
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
  // Light's インスピレーション card opens this detail with an upload-first start screen.
  const inspiration = isNewFile && params.get('projectSubType') === 'clothingDesign';
  const identity = JSON.stringify([userId, brandId, projectId, conversationId]);
  const brandReady = Boolean(userId && brandId && (!isHeavyWorkspaceRuntime() || isHeavyWorkspaceBrandName(currentBrand?.name)));
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ViewState>({ identity: '' });
  const [prompt, setPrompt] = useState('');
  // Several objects can be selected (marquee, Shift + click, Ctrl + A, groups); `selected` is the single selection used for edits and layer moves.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selected = selectedIds.length === 1 ? selectedIds[0] : null;
  const setSelected = (id: string | null) => setSelectedIds(id ? [id] : []);
  const [history, setHistory] = useState<{ undo: CanvasPatch[]; redo: CanvasPatch[] }>({ undo: [], redo: [] });
  const [marquee, setMarquee] = useState<{ pointerId: number; x1: number; y1: number; x2: number; y2: number } | null>(null);
  const suppressClick = useRef(false);
  const [move, setMove] = useState(false);
  const [view, setView] = useState<StudioViewport>({ zoom: 0.2, panX: 20, panY: 20 });
  const [fitted, setFitted] = useState('');
  const [panelTab, setPanelTab] = useState<'assistant' | 'layers'>('assistant');
  const [panelOpen, setPanelOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState<'guide' | 'shortcuts' | null>(null);
  const [guideTab, setGuideTab] = useState<string>(BEGINNER_GUIDE_TABS[0]);
  const copiedObjects = useRef<Record<string, unknown>[]>([]);
  const spacePan = useRef(false);
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
  // Selection and undo history belong to the project; saving an edit reloads the document (retry) and must keep them.
  useEffect(() => { setSelectedIds([]); setHistory({ undo: [], redo: [] }); }, [identity]);
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
    setPrompt(''); setTitleDraft(null); setState({ identity, busy: brandReady && !isNewFile });
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
  // Like Light, a project that already has a canvas (and no chat yet) or the inspiration start opens with the assistant collapsed.
  const panelDefaultKey = `${identity}:${inspiration ? 'inspiration' : visible?.dialogue ? (hasContentNow(visible.dialogue) ? 'canvas' : 'empty') : 'loading'}`;
  const appliedPanelDefault = useRef('');
  useEffect(() => {
    if (panelDefaultKey.endsWith(':loading') || appliedPanelDefault.current === panelDefaultKey) return;
    appliedPanelDefault.current = panelDefaultKey;
    setPanelOpen(!(panelDefaultKey.endsWith(':inspiration') || panelDefaultKey.endsWith(':canvas')));
  }, [panelDefaultKey]);
  const singleImageId = isDocumentOnly && imageObjects.length === 1 ? String(imageObjects[0].id) : '';
  useEffect(() => { if (singleImageId) setSelectedIds((current) => current.length ? current : [singleImageId]); }, [singleImageId]);
  const projectTitle = visible?.dialogue?.document.title ?? 'Untitled';
  const hasContent = canvasObjects.length > 0;
  const [shapeMenu, setShapeMenu] = useState(false);
  const [editingText, setEditingText] = useState<{ id: string; text: string } | null>(null);
  const [dragged, setDragged] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
  const objectDrag = useRef<{ ids: string[]; pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const editable = Boolean(projectId && visible?.dialogue && !visible.busy);
  /** Without a chat, re-reads only the document and keeps the canvas on screen; a full reload would briefly show the upload screen. */
  const reloadDocumentInPlace = async () => {
    const assertContext = () => { const auth = useAuthStore.getState(); if (auth.user?.id !== userId || auth.currentBrand?.id !== brandId) throw new Error('design_entry_scope_stale'); };
    try {
      const document = validateOwnedDesignDocument(await client.getDocument(projectId, brandId, { userId, assertContext }), { userId, brandId }, projectId);
      setState((previous) => previous.identity === identity && previous.dialogue ? { ...previous, dialogue: { ...previous.dialogue, document } } : previous);
    } catch { setRetry((value) => value + 1); }
  };
  /** Applies an object change locally, then saves it to the Canvas document (fresh revision) and reloads it. Recorded for undo unless `record` is false. */
  const mutateObjects = async (change: (objects: Record<string, unknown>[]) => Record<string, unknown>[], record = true) => {
    const current = visible?.dialogue?.document;
    if (!current || !editable) return;
    const patch = record ? diffCanvasObjects(current.snapshot.objects, change(current.snapshot.objects)) : null;
    if (patch) setHistory((previous) => ({ undo: [...previous.undo.slice(-49), patch], redo: [] }));
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
    else await reloadDocumentInPlace();
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
    if (!selectedIds.length || !editable) return;
    const ids = selectedIds;
    setSelected(null);
    void mutateObjects((objects) => objects.filter((object) => !ids.includes(String(object.id))));
  };
  const undoRedo = (direction: 'undo' | 'redo') => {
    const entry = history[direction][history[direction].length - 1];
    if (!entry || !editable) return;
    setHistory((previous) => direction === 'undo' ? { undo: previous.undo.slice(0, -1), redo: [...previous.redo, entry] } : { undo: [...previous.undo, entry], redo: previous.redo.slice(0, -1) });
    setSelectedIds((current) => current.filter((id) => (direction === 'undo' ? entry.before : entry.after)[id] !== null));
    void mutateObjects((objects) => applyCanvasPatch(objects, direction === 'undo' ? entry.before : entry.after), false);
  };
  /** 画像としてコピー: puts the selected image on the system clipboard as PNG. */
  const copySelectedAsImage = () => {
    if (!selectedIds.length) return;
    const image = canvasObjects.find((object) => selectedIds.includes(String(object.id)) && object.type === 'image');
    const url = image && typeof image.src === 'string' ? urls[image.src] : undefined;
    if (!url) { setEntryError('画像としてコピーできるのは画像だけです'); return; }
    const png = (async () => {
      const blob = await (await fetch(url)).blob();
      if (blob.type === 'image/png') return blob;
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('design_copy_png_failed')), 'image/png'));
    })();
    navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).catch(() => setEntryError('画像をクリップボードにコピーできませんでした'));
  };
  /** Screen point (relative to the canvas) to canvas coordinates. */
  const toWorld = (clientX: number, clientY: number) => {
    const area = canvasRef.current?.getBoundingClientRect();
    return { x: (clientX - (area?.left ?? 0) - view.panX) / view.zoom, y: (clientY - (area?.top ?? 0) - view.panY) / view.zoom };
  };
  useEffect(() => {
    // Light's canvas shortcuts (see the キーボード panel).
    const onKey = (event: KeyboardEvent) => {
      if (editingText || (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const area = canvasRef.current?.getBoundingClientRect();
      const center = { x: area ? (area.width - (panelOpen ? 435 : 0)) / 2 : 500, y: area ? area.height / 2 : 400 };
      const selectedItems = canvasObjects.filter((object) => selectedIds.includes(String(object.id)));
      const paste = (sources: Record<string, unknown>[]) => {
        const clones = cloneCanvasObjects(sources, nextZ(), () => crypto.randomUUID());
        setSelectedIds(clones.map((clone) => String(clone.id)));
        void mutateObjects((objects) => [...objects, ...clones]);
      };
      if (event.key === ' ' && !mod) { if (!spacePan.current) { spacePan.current = true; setMove(true); } event.preventDefault(); return; }
      if (event.key === 'Escape') { setSelected(null); setShapeMenu(false); setHelpOpen(null); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length) { event.preventDefault(); deleteSelected(); return; }
      if (mod) {
        if (key === '=' || key === '+') { event.preventDefault(); pushView(zoomStudioViewport(view, view.zoom * 1.25, center)); return; }
        if (key === '-') { event.preventDefault(); pushView(zoomStudioViewport(view, view.zoom / 1.25, center)); return; }
        if (key === '1') { event.preventDefault(); const next = fitView(); if (next) pushView(next); return; }
        if (key === '0') { event.preventDefault(); pushView(zoomStudioViewport(view, 1, center)); return; }
        if (key === 'a') { event.preventDefault(); setSelectedIds(canvasObjects.map((object) => String(object.id))); return; }
        if (key === 'c' && event.shiftKey) { event.preventDefault(); copySelectedAsImage(); return; }
        if (!editable) return;
        if (key === 'z' || key === 'y') { event.preventDefault(); undoRedo(key === 'y' || event.shiftKey ? 'redo' : 'undo'); return; }
        if (key === 'c' && selectedItems.length) { event.preventDefault(); copiedObjects.current = structuredClone(selectedItems); return; }
        if (key === 'x' && selectedItems.length) { event.preventDefault(); copiedObjects.current = structuredClone(selectedItems); deleteSelected(); return; }
        if (key === 'v' && copiedObjects.current.length) { event.preventDefault(); paste(copiedObjects.current); return; }
        if (key === 'd' && selectedItems.length) { event.preventDefault(); paste(selectedItems); return; }
        if (key === 'g') {
          event.preventDefault();
          const ids = selectedIds;
          if (event.shiftKey) { if (selectedItems.some((object) => typeof object.groupId === 'string')) void mutateObjects((objects) => ungroupObjects(objects, ids)); }
          else if (ids.length > 1) { const groupId = `group-${crypto.randomUUID()}`; void mutateObjects((objects) => groupObjects(objects, ids, groupId)); }
          return;
        }
        if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && selected) {
          event.preventDefault();
          const move: CanvasLayerMove = event.key === 'ArrowUp' ? (event.shiftKey ? 'front' : 'up') : (event.shiftKey ? 'back' : 'down');
          const id = selected;
          void mutateObjects((objects) => moveCanvasLayer(objects, id, move));
        }
        return;
      }
      if (event.altKey || event.shiftKey) return;
      if (key === 'v') { setMove(false); return; }
      if (!editable) return;
      const tool = ({ t: 'text', r: 'rect', o: 'circle', l: 'line' } as const)[key as 't' | 'r' | 'o' | 'l'];
      if (tool) { event.preventDefault(); addObject(tool); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === ' ' && spacePan.current) { spacePan.current = false; setMove(false); } };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  });

  const pushView = (next: StudioViewport) => setView(next);
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
    if (images.length) { setPanelOpen(true); setPanelTab('assistant'); void references.addFiles(images); }
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
    else await reloadDocumentInPlace();
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

    <section ref={canvasRef} aria-label="デザインCanvas" className="absolute inset-0 select-none" data-testid="design-own-canvas"
      style={{ cursor: move ? 'grab' : 'default' }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button, a, input, textarea')) return;
        if (event.button === 0 && !move) {
          // 複数選択: drag a marquee on empty canvas; a plain click on empty canvas clears the selection.
          if (!event.shiftKey) setSelected(null);
          const point = toWorld(event.clientX, event.clientY);
          setMarquee({ pointerId: event.pointerId, x1: point.x, y1: point.y, x2: point.x, y2: point.y });
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }
        if (event.button !== 1 && !(move && event.button === 0)) return;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
      }} onPointerMove={(event) => {
        if (marquee?.pointerId === event.pointerId) { const point = toWorld(event.clientX, event.clientY); setMarquee({ ...marquee, x2: point.x, y2: point.y }); return; }
        const previous = drag.current; if (!previous || previous.id !== event.pointerId) return;
        setView((current) => panStudioViewport(current, event.clientX - previous.x, event.clientY - previous.y));
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }} onPointerUp={(event) => {
        if (marquee?.pointerId === event.pointerId) {
          setMarquee(null); event.currentTarget.releasePointerCapture(event.pointerId);
          if (Math.hypot(marquee.x2 - marquee.x1, marquee.y2 - marquee.y1) * view.zoom < 4) return;
          const hits = expandGroupSelection(canvasObjects, objectsInRect(canvasObjects, marquee));
          setSelectedIds((current) => event.shiftKey ? [...new Set([...current, ...hits])] : hits);
          return;
        }
        if (drag.current?.id === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }
      }}
      onPointerCancel={() => { drag.current = null; setMarquee(null); }}
      onWheel={(event) => {
        if ((event.target as HTMLElement).closest('aside, textarea')) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setView((current) => event.ctrlKey || event.metaKey ? zoomStudioViewport(current, current.zoom * Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top })
          : panStudioViewport(current, -event.deltaX, -event.deltaY));
      }}>
      <div className="absolute origin-top-left" data-testid="design-canvas-world" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
        {canvasObjects.map((object) => {
          const id = String(object.id);
          const offset = dragged?.ids.includes(id) ? dragged : null;
          const isSelected = selectedIds.includes(id);
          const isImage = object.type === 'image';
          return <button key={id} type="button" data-testid="design-canvas-layer" data-object-id={id} data-object-type={object.type} aria-label={String(object.label ?? (isImage ? 'デザイン画像' : '図形'))}
            aria-pressed={isSelected} data-group-id={typeof object.groupId === 'string' ? object.groupId : undefined}
            onPointerDown={(event) => {
              // 透過選択: Ctrl/⌘ + click picks the object underneath, cycling through the stack at that point.
              // Handled on pointerdown because macOS turns Ctrl + click into a context-menu click without a click event.
              if (!move && event.button === 0 && (event.ctrlKey || event.metaKey)) {
                event.stopPropagation();
                setSelected(throughSelect(canvasObjects, toWorld(event.clientX, event.clientY), selected));
                return;
              }
              if (move || event.button !== 0 || object.locked === true || !editable) return;
              event.stopPropagation();
              // Dragging a selected object moves the whole selection; otherwise its group.
              const ids = isSelected ? selectedIds : expandGroupSelection(canvasObjects, [id]);
              objectDrag.current = { ids, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const active = objectDrag.current;
              if (!active || active.pointerId !== event.pointerId) return;
              const dx = (event.clientX - active.x) / view.zoom; const dy = (event.clientY - active.y) / view.zoom;
              if (!active.moved && Math.hypot(dx * view.zoom, dy * view.zoom) < 4) return;
              active.moved = true;
              setDragged({ ids: active.ids, dx, dy });
            }}
            onPointerUp={(event) => {
              const active = objectDrag.current;
              if (!active || active.pointerId !== event.pointerId) return;
              objectDrag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
              if (!active.moved || !dragged) return;
              const { ids, dx, dy } = dragged;
              setDragged(null);
              suppressClick.current = true;
              setSelectedIds(ids);
              void mutateObjects((objects) => objects.map((item) => ids.includes(String(item.id)) && item.locked !== true ? { ...item, x: (Number(item.x) || 0) + dx, y: (Number(item.y) || 0) + dy } : item));
            }}
            onClick={(event) => {
              if (suppressClick.current) { suppressClick.current = false; return; }
              if (move || event.ctrlKey || event.metaKey) return;
              const group = expandGroupSelection(canvasObjects, [id]);
              if (event.shiftKey) { setSelectedIds((current) => isSelected ? current.filter((item) => !group.includes(item)) : [...new Set([...current, ...group])]); return; }
              setSelectedIds(isSelected && selectedIds.length === group.length ? [] : group);
            }}
            onContextMenu={(event) => { if (event.ctrlKey) event.preventDefault(); }}
            onDoubleClick={() => { if (object.type === 'text' && editable) setEditingText({ id, text: String(object.text ?? '') }); }}
            className={`absolute text-left ${isImage ? 'overflow-hidden bg-white/5' : ''} ${isSelected ? 'outline outline-[6px] outline-[#0bcabc]' : ''} ${editable && !move ? 'cursor-move' : ''}`}
            style={{ left: (Number(object.x) || 0) + (offset?.dx ?? 0), top: (Number(object.y) || 0) + (offset?.dy ?? 0), width: Number(object.width) || 440, height: Number(object.height) || 440,
              transform: `rotate(${Number(object.rotation) || 0}deg) scale(${Number(object.scaleX) || 1}, ${Number(object.scaleY) || 1})`, opacity: typeof object.opacity === 'number' ? object.opacity : 1, zIndex: Number(object.zIndex) || 0 }}>
            {isImage ? (typeof object.src === 'string' && urls[object.src] ? <img src={urls[object.src]} alt={String(object.label ?? 'デザイン画像')} className="h-full w-full object-contain" draggable={false} /> : <span className="text-sm text-neutral-400">画像を読み込んでいます</span>)
              : editingText?.id === id ? <textarea autoFocus value={editingText.text} aria-label="テキストを編集" data-testid="design-text-editor"
                onChange={(event) => setEditingText({ id, text: event.target.value })} onBlur={commitText}
                onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); commitText(); } }}
                onPointerDown={(event) => event.stopPropagation()}
                className="h-full w-full select-text resize-none bg-transparent leading-tight text-white outline-none" style={{ fontSize: Number(object.fontSize) || 80, color: typeof object.fill === 'string' ? object.fill : '#ffffff' }} />
              : <DesignCanvasShape object={object} />}
          </button>;
        })}
      </div>
      {marquee && <div aria-hidden="true" data-testid="design-marquee" className="pointer-events-none absolute border border-[#0bcabc] bg-[#0bcabc]/10"
        style={{ left: Math.min(marquee.x1, marquee.x2) * view.zoom + view.panX, top: Math.min(marquee.y1, marquee.y2) * view.zoom + view.panY,
          width: Math.abs(marquee.x2 - marquee.x1) * view.zoom, height: Math.abs(marquee.y2 - marquee.y1) * view.zoom }} />}
    </section>

    {!hasContent && inspiration && <label data-testid="design-inspiration-start" className={`absolute top-0 flex cursor-pointer flex-col items-center pt-6 text-center ${dragOver ? 'opacity-80' : ''}`}
      style={{ left: `calc((100% - ${panelOpen ? 435 : 0}px) / 2)`, transform: 'translateX(-50%)', width: 'min(960px, calc(100% - 120px))' }}>
      <input type="file" accept={IMAGE_ACCEPT} multiple className="sr-only" onChange={onUpload} aria-label="画像をアップロード" />
      <h1 className="text-[44px] font-semibold leading-tight text-white">Hello！デザインはここから始まります</h1>
      <p className="mt-3 text-lg text-neutral-300">まずは下のボタンから線画画像／デザイン／グラフィック／生地画像をアップロードしてください</p>
      <img src={INSPIRATION_PLACEHOLDER} alt="" className="mt-4 w-full max-w-[798px] object-cover" draggable={false} />
      <p className="mt-2 text-base text-neutral-200">画像をクリックまたはドラッグ＆ドロップでアップロードするか、AIに直接相談してください</p>
      <p className="mt-2 text-sm text-neutral-500">jpg、jpeg、png、webp形式の画像に対応しています。最大20MBまでアップロードできます</p>
    </label>}

    {!hasContent && !inspiration && <label data-testid="design-entry-dropzone" className={`absolute flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed transition ${dragOver ? 'border-[#0bcabc] bg-[#0bcabc]/5' : 'border-white/20 bg-white/[0.015] hover:border-white/35'}`}
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

    {hasContent && <div role="toolbar" aria-label="キャンバスツール" className="absolute bottom-[18px] z-20 flex items-center gap-1 rounded-xl border border-white/10 bg-[#1b2023]/95 p-[3px]" style={{ left: `calc((100% - ${panelOpen ? 435 : 0}px) / 2)`, transform: 'translateX(-50%)' }} data-testid="design-canvas-toolbar">
      <button type="button" aria-label="選択" aria-pressed={!move} onClick={() => setMove(false)} className={`${toolbarButton} ${!move ? 'bg-white/10 text-white' : ''}`}><MousePointer2 className="h-[18px] w-[18px]" /></button>
      <button type="button" aria-label="ドラッグ" aria-pressed={move} onClick={() => setMove(true)} className={`${toolbarButton} ${move ? 'bg-white/10 text-white' : ''}`}><Hand className="h-[18px] w-[18px]" /></button>
      <button type="button" aria-label="取り消し" data-testid="design-undo" disabled={!editable || !history.undo.length} onClick={() => undoRedo('undo')} className={toolbarButton}><Undo2 className="h-[18px] w-[18px]" /></button>
      <button type="button" aria-label="やり直し" data-testid="design-redo" disabled={!editable || !history.redo.length} onClick={() => undoRedo('redo')} className={toolbarButton}><Redo2 className="h-[18px] w-[18px]" /></button>
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
      <span className="mx-[2px] h-5 w-px bg-white/15" />
      <button type="button" aria-label="ダウンロード" onClick={() => void downloadSelected()} className={toolbarButton}><Download className="h-[18px] w-[18px]" /></button>
    </div>}

    {/* Light keeps zoom and its two round help buttons as a separate group at the bottom right of the canvas. */}
    {hasContent && <div className="absolute bottom-[18px] z-20 flex items-center gap-2" style={{ right: panelOpen ? 452 : 24 }} data-testid="design-zoom-group">
      <span className="flex h-12 items-center gap-1 rounded-full border border-white/10 bg-[#1b2023]/95 px-2">
        <button type="button" aria-label="縮小" onClick={() => pushView(zoomStudioViewport(view, view.zoom / 1.25, { x: 500, y: 400 }))} className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-300 hover:text-white"><ZoomOut className="h-[18px] w-[18px]" /></button>
        <label className="relative flex h-8 w-20 items-center justify-between rounded-lg px-2 text-base text-neutral-200">
          <span data-testid="design-zoom">{Math.round(view.zoom * 100)}%</span><ChevronDown className="h-3.5 w-3.5 text-neutral-500" />
          <select aria-label="ズーム" value={Math.round(view.zoom * 100)} onChange={(event) => {
            if (event.target.value === 'fit') { const next = fitView(); if (next) pushView(next); return; }
            pushView(zoomStudioViewport(view, Number(event.target.value) / 100, { x: 500, y: 400 }));
          }} className="absolute inset-0 cursor-pointer opacity-0">
            {[...new Set([10, 20, 25, 50, 75, 100, 150, 200, Math.round(view.zoom * 100)])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{value}%</option>)}
            <option value="fit">全体を表示</option>
          </select>
        </label>
        <button type="button" aria-label="拡大" onClick={() => pushView(zoomStudioViewport(view, view.zoom * 1.25, { x: 500, y: 400 }))} className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-300 hover:text-white"><ZoomIn className="h-[18px] w-[18px]" /></button>
      </span>
      <button type="button" aria-label="初心者ガイド" aria-expanded={helpOpen === 'guide'} onClick={() => setHelpOpen((open) => open === 'guide' ? null : 'guide')}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#1b2023]/95 text-neutral-300 hover:text-white"><BookOpen className="h-[18px] w-[18px]" /></button>
      <button type="button" aria-label="ショートカット" aria-expanded={helpOpen === 'shortcuts'} onClick={() => setHelpOpen((open) => open === 'shortcuts' ? null : 'shortcuts')}
        className={`flex h-10 w-10 items-center justify-center rounded-full border bg-[#1b2023]/95 text-neutral-300 hover:text-white ${helpOpen === 'shortcuts' ? 'border-[#0bcabc]' : 'border-white/10'}`}><Keyboard className="h-[18px] w-[18px]" /></button>
    </div>}

    {/* Light's キーボード button opens this shortcut panel on the right of the canvas. */}
    {helpOpen === 'shortcuts' && <aside role="dialog" aria-label="ショートカット" data-testid="design-shortcuts" className="absolute bottom-[84px] z-40 flex w-[420px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#202628] shadow-2xl"
      style={{ right: panelOpen ? 452 : 28, top: 104 }}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4 text-sm text-neutral-400">ショートカット
        <button type="button" aria-label="閉じる" onClick={() => setHelpOpen(null)} className="text-neutral-400 hover:text-white"><X className="h-4 w-4" /></button></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {CANVAS_SHORTCUT_GROUPS.map((group) => <section key={group.title} className="border-b border-white/10 py-3 last:border-b-0">
          <h3 className="mb-2 text-base font-medium text-white">{group.title}</h3>
          <dl className="flex flex-col gap-2">{group.rows.map((row) => <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <dt className="shrink-0 text-neutral-200">{row.label}</dt>
            <dd className="flex max-w-[60%] items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-right text-neutral-400">{row.keys}{row.mouse && <Mouse className="h-4 w-4 shrink-0" />}</dd>
          </div>)}</dl>
        </section>)}
      </div>
    </aside>}

    {/* Light's 本 button opens the 初心者ガイド; Light's Japanese guide shows データなし on every tab. */}
    {helpOpen === 'guide' && <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-6" onClick={() => setHelpOpen(null)}>
      <div role="dialog" aria-modal="true" aria-label="初心者ガイド" data-testid="design-guide" onClick={(event) => event.stopPropagation()}
        className="flex h-[min(820px,calc(100%-40px))] w-full max-w-[1600px] flex-col rounded-3xl border border-white/10 bg-[#202628] p-8 shadow-2xl">
        <div className="flex items-center justify-between"><h2 className="text-xl font-medium text-white">初心者ガイド</h2>
          <button type="button" aria-label="閉じる" onClick={() => setHelpOpen(null)} className="text-neutral-300 hover:text-white"><X className="h-5 w-5" /></button></div>
        <div role="tablist" aria-label="初心者ガイド" className="mt-6 flex flex-wrap gap-2">{BEGINNER_GUIDE_TABS.map((tab) => <button key={tab} type="button" role="tab" aria-selected={guideTab === tab} onClick={() => setGuideTab(tab)}
          className={`rounded-lg border px-3 py-2 text-base font-medium ${guideTab === tab ? 'border-[#0bcabc]/70 bg-white/10 text-white' : 'border-transparent text-neutral-400 hover:text-white'}`}>{tab}</button>)}</div>
        <div role="tabpanel" className="flex flex-1 flex-col items-center justify-center gap-4 text-base text-neutral-200">
          <img src={GUIDE_EMPTY_ICON} alt="" className="h-32 w-32" />データなし
        </div>
      </div>
    </div>}

    {!panelOpen && <button type="button" aria-label="パネルを開く" title="AIアシスタント" onClick={() => setPanelOpen(true)} className="absolute right-3 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#1b2023] text-neutral-200 shadow-lg hover:text-white"><PanelRightOpen className="h-5 w-5" /></button>}

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
            {(hasContent || inspiration) && workspaceId === 'design' ? <>
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
        <ol>{[...canvasObjects].reverse().map((object) => <li key={String(object.id)} className="group relative"><button type="button" data-testid="design-layer-select" aria-pressed={selectedIds.includes(String(object.id))}
          onClick={() => setSelected(String(object.id))} className={`mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${selectedIds.includes(String(object.id)) ? 'bg-white/10' : 'hover:bg-white/5'}`}>
          <span className="h-10 w-10 shrink-0 overflow-hidden rounded bg-white/5">{typeof object.src === 'string' && urls[object.src] && <img src={urls[object.src]} alt="" className="h-full w-full object-cover" />}</span>
          <span className="truncate">{object.type === 'text' && typeof object.text === 'string' ? object.text : String(object.label ?? 'デザイン画像')}</span></button>
          {editable && <button type="button" data-testid="design-layer-delete" aria-label={`${String(object.label ?? 'レイヤー')}を削除`}
            onClick={() => { const id = String(object.id); setSelectedIds((current) => current.filter((item) => item !== id)); void mutateObjects((objects) => objects.filter((item) => item.id !== id)); }}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-400 opacity-0 transition hover:bg-white/10 hover:text-red-300 focus:opacity-100 group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>}
        </li>)}</ol>
      </div>}
    </aside>}
  </main>;
}
