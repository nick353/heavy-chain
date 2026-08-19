import { lazy, Suspense, useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Layers,
  GitBranch,
  Settings2,
  Upload,
  Wand2,
  Save,
  Users,
  MessageSquare,
  X,
  Sparkles,
  Image,
  Layout,
  Globe,
  Grid3x3,
  Palette,
  Maximize2,
  CopyPlus
} from 'lucide-react';
import { CanvasToolbar } from '../components/canvas/CanvasToolbar';
import { FloatingToolbar } from '../components/canvas/FloatingToolbar';
import { Minimap } from '../components/canvas/Minimap';
import { PropertiesPanel } from '../components/canvas/PropertiesPanel';
import { ImageEditModal } from '../components/canvas/ImageEditModal';
import { PartialEditModal, type PartialEditPayload } from '../components/canvas/PartialEditModal';
import { CanvasGuide, useCanvasGuide } from '../components/canvas/CanvasGuide';
import { normalizeCanvasView, useCanvasStore, type CanvasObject } from '../stores/canvasStore';
import { ChatEditor } from '../components/ChatEditor';
import { GallerySelector } from '../components/GallerySelector';
import { TemplateSelector, type DesignTemplate, type SizeTemplate } from '../components/TemplateSelector';
import { Button, Modal, Textarea, Input } from '../components/ui';
import { ImageSelector, type SelectedImage } from '../components/ImageSelector';
import { supabase } from '../lib/supabase';
import { resolveGeneratedImageUrl } from '../lib/storage';
import { getWorkspaceArtifactCanonicalStoragePath, listWorkspaceArtifacts } from '../lib/localWorkspaceArtifacts';
import { downloadValidatedImage } from '../lib/imageDownload';
import {
  isLocalCanvasAssetReference,
  putLocalCanvasAsset,
  resolveLocalCanvasAsset,
} from '../lib/canvasLocalAssets';
import { assertCompletedImageEditResult, editImageWithPrompt, edgeFunctionErrorMessage } from '../lib/imageApi';
import {
  buildCanvasImageEditBatchProof,
  normalizeCanvasImageEditCandidates,
  settleCanvasImageEditCandidatesSequentially,
} from '../lib/canvasImageEditResults';
import {
  BRAND_LIKENESS_BLOCK_COPY,
  GENERATION_LEGAL_COPY,
  UPLOAD_RIGHTS_CONFIRMATION_LABEL,
  validateLegalSafetyInput,
} from '../lib/legalSafetyGuard';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import type Konva from 'konva';
import { buildCanvasGenerationState } from '../features/canvasGenerationState';
import {
  buildLocalUploadSourceMetadata,
  sanitizeCanvasSourceMetadata,
  type CanvasSourceMetadata,
} from '../features/canvasSourceMetadata';
import {
  acknowledgeCanvasRemoteReadback,
  buildCanvasDocumentSnapshot,
  captureLegacyCanvasPayload,
  createCanvasDocument,
  getCanvasDocument,
  retainCanvasCacheAfterFailedReadback,
  updateCanvasDocument,
} from '../lib/canvasDocumentPersistence';

type ViewMode = 'canvas' | 'tree';
type SidePanel = 'properties' | 'chat' | 'templates' | null;
type GenerateMode = 'basic' | 'gacha' | 'product-shots' | 'model-matrix' | 'multilingual';
type LightchainEditAction = 'remove-background' | 'colorize' | 'upscale' | 'generate-variations' | 'prompt-edit' | 'inpaint' | 'partial-edit';
type CanvasTemplateMode = 'size' | 'design';
type CanvasRenderState = { totalImageObjects: number; loadedImageObjects: number; renderAllObjects: boolean };
type LocalUploadState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  persistenceStatus: 'persistent' | 'session-only' | 'unknown';
  objectId: string | null;
  sourceRevision: string | null;
  error: string | null;
  errorCode: string | null;
};
type LocalRestoreState = {
  status: 'idle' | 'restoring' | 'restored' | 'missing';
  objectCount: number;
  missingCount: number;
};
const GENERATED_CANVAS_HANDOFF_KEY = 'heavy-chain-generated-canvas-handoff';
const MAX_MODEL_MATRIX_PATTERNS = 3;
const DerivationTree = lazy(() =>
  import('../components/canvas/DerivationTree').then((module) => ({ default: module.DerivationTree }))
);
const InfiniteCanvas = lazy(() =>
  import('../components/canvas/InfiniteCanvas').then((module) => ({ default: module.InfiniteCanvas }))
);

const LIGHTCHAIN_EDIT_ACTION_LABELS: Record<LightchainEditAction, string> = {
  'remove-background': '背景削除・切り抜き',
  colorize: '色変更',
  upscale: '高解像度化',
  'generate-variations': 'デザインアレンジ',
  'prompt-edit': 'プロンプト編集',
  inpaint: '部分編集',
  'partial-edit': '部分編集',
};

const GENERATE_MODES = [
  { id: 'basic', name: '基本生成', icon: Image, description: 'テキストから画像を生成' },
  { id: 'gacha', name: 'デザインガチャ', icon: Sparkles, description: '複数スタイルを一括生成' },
  { id: 'product-shots', name: '商品カット', icon: Grid3x3, description: '4方向の商品画像' },
  { id: 'model-matrix', name: 'モデルマトリクス', icon: Users, description: '体型×年齢の組み合わせ' },
  { id: 'multilingual', name: '多言語バナー', icon: Globe, description: '日/英/中/韓バナー' },
] as const;

const canvasImageActions: Array<{
  id: string;
  label: string;
  description: string;
  icon: typeof Wand2;
  requiresSelection: boolean;
}> = [
  { id: 'removeBackground', label: '背景を消す', description: '選択画像を切り抜く', icon: Wand2, requiresSelection: true },
  { id: 'colorize', label: '色を変える', description: 'カラバリを派生', icon: Palette, requiresSelection: true },
  { id: 'upscale', label: '高解像度', description: '掲載用に拡大', icon: Maximize2, requiresSelection: true },
  { id: 'variations', label: '派生させる', description: '近い案を4つ作る', icon: CopyPlus, requiresSelection: true },
  { id: 'edit', label: '指示で編集', description: '文章で直す', icon: MessageSquare, requiresSelection: true },
  { id: 'generate', label: '新しく生成', description: '生成', icon: Sparkles, requiresSelection: false },
];

const isUsableLoadedImage = (image?: HTMLImageElement | null) => (
  Boolean(image?.complete) &&
  Boolean(image?.naturalWidth && image?.naturalHeight)
);

const CANVAS_DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const restoreCanvasObjects = (snapshot: unknown): CanvasObject[] => {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray((snapshot as any).objects)) return [];
  return (snapshot as any).objects.filter((item: unknown) => item && typeof item === 'object').map((item: any, index: number) => ({
    id: typeof item.id === 'string' && item.id ? item.id : `remote-object-${index}`,
    type: ['image', 'text', 'shape', 'frame'].includes(item.type) ? item.type : 'shape',
    x: Number.isFinite(item.x) ? item.x : 0,
    y: Number.isFinite(item.y) ? item.y : 0,
    width: Number.isFinite(item.width) ? item.width : 100,
    height: Number.isFinite(item.height) ? item.height : 100,
    rotation: Number.isFinite(item.rotation) ? item.rotation : 0,
    scaleX: Number.isFinite(item.scaleX) ? item.scaleX : 1,
    scaleY: Number.isFinite(item.scaleY) ? item.scaleY : 1,
    opacity: Number.isFinite(item.opacity) ? item.opacity : 1,
    locked: item.locked === true,
    visible: item.visible !== false,
    zIndex: Number.isFinite(item.zIndex) ? item.zIndex : index,
    src: typeof item.src === 'string' ? item.src : undefined,
    text: typeof item.text === 'string' ? item.text : undefined,
    fontSize: Number.isFinite(item.fontSize) ? item.fontSize : undefined,
    fontFamily: typeof item.fontFamily === 'string' ? item.fontFamily : undefined,
    fill: typeof item.fill === 'string' ? item.fill : undefined,
    stroke: typeof item.stroke === 'string' ? item.stroke : undefined,
    strokeWidth: Number.isFinite(item.strokeWidth) ? item.strokeWidth : undefined,
    shapeType: item.shapeType,
    parentId: typeof item.parentId === 'string' ? item.parentId : null,
    derivedFrom: typeof item.derivedFrom === 'string' ? item.derivedFrom : null,
    label: typeof item.label === 'string' ? item.label : undefined,
    metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : undefined,
  }));
};

const restoreCanvasView = (snapshot: unknown) => {
  const view = snapshot && typeof snapshot === 'object' ? (snapshot as any).view : undefined;
  return normalizeCanvasView(view);
};

const LOCAL_UPLOAD_READ_TIMEOUT_MS = 15_000;
type LocalUploadPayload = { bytes: ArrayBuffer; dataUrl: string };

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
};

const dataUrlToArrayBuffer = (dataUrl: string) => {
  const match = dataUrl.match(/^data:[^;,]+;base64,(.*)$/s);
  if (!match) throw new Error('canvas_upload_data_url_invalid');

  const binary = window.atob(match[1]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer;
};

const withLocalUploadTimeout = <T,>(promise: Promise<T>, message: string) => (
  new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), LOCAL_UPLOAD_READ_TIMEOUT_MS);
    promise.then((value) => {
      window.clearTimeout(timeoutId);
      resolve(value);
    }).catch((error) => {
      window.clearTimeout(timeoutId);
      reject(error);
    });
  })
);

const readLocalUploadFile = async (file: File): Promise<LocalUploadPayload> => {
  const fromArrayBuffer = withLocalUploadTimeout(
    file.arrayBuffer().then((bytes) => ({
      bytes,
      dataUrl: `data:${file.type};base64,${arrayBufferToBase64(bytes)}`,
    })),
    'canvas_upload_read_timeout',
  );
  const fromFileReader = withLocalUploadTimeout(new Promise<LocalUploadPayload>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('canvas_upload_read_failed'));
    reader.onabort = () => reject(new Error('canvas_upload_read_aborted'));
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        reject(new Error('canvas_upload_data_url_invalid'));
        return;
      }
      try {
        resolve({ dataUrl, bytes: dataUrlToArrayBuffer(dataUrl) });
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsDataURL(file);
  }), 'canvas_upload_read_timeout');

  const payload = await Promise.any([fromArrayBuffer, fromFileReader]);
  if (payload.bytes.byteLength !== file.size) {
    throw new Error('canvas_source_bytes_changed');
  }
  return payload;
};

const loadLocalUploadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new window.Image();
  const timeoutId = window.setTimeout(() => {
    image.onload = null;
    image.onerror = null;
    reject(new Error('canvas_upload_image_timeout'));
  }, LOCAL_UPLOAD_READ_TIMEOUT_MS);
  image.onerror = () => {
    window.clearTimeout(timeoutId);
    reject(new Error('canvas_upload_image_failed'));
  };
  image.onload = () => {
    window.clearTimeout(timeoutId);
    resolve(image);
  };
  image.src = source;
});

export function CanvasEditorPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sourceArtifactId = searchParams.get('sourceArtifactId');
  const containerRef = useRef<HTMLDivElement>(null);
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const localUploadInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const canvasStageRef = useRef<Konva.Stage | null>(null);
  const handleCanvasStageReady = useCallback((stage: Konva.Stage | null) => {
    canvasStageRef.current = stage;
    if (typeof document !== 'undefined') {
      document.body.dataset.canvasStageReady = stage ? 'true' : 'false';
    }
  }, []);
  const canvasRenderStateRef = useRef<CanvasRenderState>({ totalImageObjects: 0, loadedImageObjects: 0, renderAllObjects: false });
  const lastMobileFitKeyRef = useRef<string | null>(null);
  const pendingMobileGalleryFocusRef = useRef<string | null>(null);
  const { currentBrand, user, profile } = useAuthStore();
  const { showGuide, completeGuide } = useCanvasGuide(user?.id);

  const [viewMode, setViewMode] = useState<ViewMode>('canvas');
  // Keep the canvas unobstructed until an object is selected or a tool is opened.
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [templateMode, setTemplateMode] = useState<CanvasTemplateMode>('size');
  const [selectedSizeTemplateId, setSelectedSizeTemplateId] = useState<string | undefined>();
  const [selectedDesignTemplateId, setSelectedDesignTemplateId] = useState<string | undefined>();
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [selectedPosition, setSelectedPosition] = useState({ x: 0, y: 0 });
  const [isEditingName, setIsEditingName] = useState(false);
  const [isExportRenderingAll, setIsExportRenderingAll] = useState(false);
  const preloadedGalleryImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const localAssetReleasesRef = useRef<Map<string, () => void>>(new Map());
  const remoteDocumentIdRef = useRef<string | null>(null);
  const remoteRevisionRef = useRef<number | null>(null);
  const legacyCanvasCapturedRef = useRef(false);
  const suppressPersistenceDirtyRef = useRef(false);
  const [canvasPersistenceStatus, setCanvasPersistenceStatus] = useState<'unsaved' | 'loading' | 'saving' | 'verifying' | 'saved' | 'conflict' | 'failed'>('unsaved');

  // Generate modal states
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showGallerySelector, setShowGallerySelector] = useState(false);
  const [generateMode, setGenerateMode] = useState<GenerateMode>('basic');
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [headline, setHeadline] = useState('');
  const [subheadline, setSubheadline] = useState('');
  const [selectedBodyTypes, setSelectedBodyTypes] = useState(['regular']);
  const [selectedAgeGroups, setSelectedAgeGroups] = useState(['20s']);
  const [selectedLanguages, setSelectedLanguages] = useState(['ja', 'en']);
  const [isGenerating, setIsGenerating] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [localUploadState, setLocalUploadState] = useState<LocalUploadState>({
    status: 'idle',
    persistenceStatus: 'unknown',
    objectId: null,
    sourceRevision: null,
    error: null,
    errorCode: null,
  });
  const [localRestoreState, setLocalRestoreState] = useState<LocalRestoreState>({
    status: 'idle',
    objectCount: 0,
    missingCount: 0,
  });
  const localUploadEventKeysRef = useRef<Set<string>>(new Set());
  const importedLibraryArtifactRef = useRef<string | null>(null);

  // Reference image states for generate modal
  const [referenceImage, setReferenceImage] = useState<SelectedImage | null>(null);
  const [modelReferenceImage, setModelReferenceImage] = useState<SelectedImage | null>(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingImage, setEditingImage] = useState<string | null>(null);
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [showPartialEditModal, setShowPartialEditModal] = useState(false);
  const [partialEditingImage, setPartialEditingImage] = useState<string | null>(null);
  const [partialEditingObjectId, setPartialEditingObjectId] = useState<string | null>(null);
  const partialEditAttemptRef = useRef<{ attempted: boolean; idempotencyKey: string | null }>({ attempted: false, idempotencyKey: null });
  const inpaintAttemptRef = useRef<{ attempted: boolean; idempotencyKey: string | null }>({ attempted: false, idempotencyKey: null });

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');

  const {
    objects,
    selectedIds,
    addObject,
    selectObject,
    undo,
    redo,
    zoom,
    panX,
    panY,
    setZoom,
    setPan,
    updateObject,
    currentProjectId,
    currentProjectName,
    loadProject,
    hydrateProject,
    saveCurrentProject,
    renameProject,
    clearCanvas,
  } = useCanvasStore();

  const localRestoreReferences = useMemo(() => (
    Array.from(new Set(
      objects
        .filter((object) => object.type === 'image' && isLocalCanvasAssetReference(object.src))
        .map((object) => object.src as string),
    ))
  ), [objects]);

  useEffect(() => {
    if (localRestoreReferences.length === 0) {
      setLocalRestoreState({ status: 'idle', objectCount: 0, missingCount: 0 });
      return;
    }

    let cancelled = false;
    setLocalRestoreState({
      status: 'restoring',
      objectCount: localRestoreReferences.length,
      missingCount: 0,
    });

    void (async () => {
      const releases: Array<() => void> = [];
      let missingCount = 0;
      try {
        await Promise.all(localRestoreReferences.map(async (reference) => {
          try {
            const resolution = await resolveLocalCanvasAsset(reference);
            if (!resolution) {
              missingCount += 1;
              return;
            }
            releases.push(resolution.release);
          } catch {
            missingCount += 1;
          }
        }));
      } finally {
        releases.forEach((release) => release());
      }

      if (!cancelled) {
        setLocalRestoreState({
          status: missingCount > 0 ? 'missing' : 'restored',
          objectCount: localRestoreReferences.length,
          missingCount,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [localRestoreReferences]);

  useEffect(() => {
    const releases = localAssetReleasesRef.current;
    return () => {
      isMountedRef.current = false;
      releases.forEach((release) => release());
      releases.clear();
    };
  }, []);

  useLayoutEffect(() => {
    if (canvasSize.width >= 640 || canvasSize.width <= 0 || canvasSize.height <= 0 || objects.length === 0) return;

    const focusObjectId = pendingMobileGalleryFocusRef.current;
    const fitObjects = focusObjectId
      ? objects.filter((obj) => obj.visible !== false && obj.id === focusObjectId)
      : objects.filter((obj) => obj.visible !== false);
    if (fitObjects.length === 0) return;

    const fitKey = `${currentProjectId || 'draft'}:${focusObjectId || 'all'}:${fitObjects.map((obj) => `${obj.id}:${Math.round(obj.x)},${Math.round(obj.y)},${Math.round(obj.width * (obj.scaleX || 1))},${Math.round(obj.height * (obj.scaleY || 1))}`).join('|')}`;
    if (lastMobileFitKeyRef.current === fitKey) return;

    const bounds = fitObjects.reduce(
      (acc, obj) => {
        const objectWidth = Math.max(1, obj.width * (obj.scaleX || 1));
        const objectHeight = Math.max(1, obj.height * (obj.scaleY || 1));
        return {
          minX: Math.min(acc.minX, obj.x),
          minY: Math.min(acc.minY, obj.y),
          maxX: Math.max(acc.maxX, obj.x + objectWidth),
          maxY: Math.max(acc.maxY, obj.y + objectHeight),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );

    const boundsWidth = bounds.maxX - bounds.minX;
    const boundsHeight = bounds.maxY - bounds.minY;
    if (!Number.isFinite(boundsWidth) || !Number.isFinite(boundsHeight) || boundsWidth <= 0 || boundsHeight <= 0) return;

    const margins = { left: 20, right: 20, top: 92, bottom: 124 };
    const availableWidth = Math.max(80, canvasSize.width - margins.left - margins.right);
    const availableHeight = Math.max(120, canvasSize.height - margins.top - margins.bottom);
    const nextZoom = Math.min(1, Math.max(0.18, Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight)));
    const nextPanX = margins.left + (availableWidth - boundsWidth * nextZoom) / 2 - bounds.minX * nextZoom;
    const nextPanY = margins.top + (availableHeight - boundsHeight * nextZoom) / 2 - bounds.minY * nextZoom;

    setZoom(nextZoom);
    setPan(nextPanX, nextPanY);
    lastMobileFitKeyRef.current = fitKey;
    if (focusObjectId) {
      pendingMobileGalleryFocusRef.current = null;
    }
  }, [canvasSize.height, canvasSize.width, currentProjectId, objects, setPan, setZoom]);

  // Load local projects immediately, then replace a remote UUID route with the
  // server snapshot. A missing remote document never deletes the local draft.
  useEffect(() => {
    if (user?.id && currentBrand?.id && !legacyCanvasCapturedRef.current) {
      legacyCanvasCapturedRef.current = captureLegacyCanvasPayload(user.id, currentBrand.id);
    }

    if (!projectId || projectId === 'new') {
      remoteDocumentIdRef.current = null;
      remoteRevisionRef.current = null;
      setCanvasPersistenceStatus('unsaved');
      if (projectId === 'new' && useCanvasStore.getState().currentProjectId) clearCanvas();
      return;
    }

    const localProject = useCanvasStore.getState().projects.find((project) => project.id === projectId);
    if (!CANVAS_DOCUMENT_ID_PATTERN.test(projectId)) {
      remoteDocumentIdRef.current = null;
      remoteRevisionRef.current = null;
      if (localProject) {
        loadProject(projectId);
        setCanvasPersistenceStatus('unsaved');
      }
      return;
    }

    if (!user?.id || !currentBrand?.id) {
      setCanvasPersistenceStatus('failed');
      return;
    }

    let cancelled = false;
    setCanvasPersistenceStatus('loading');
    void getCanvasDocument(projectId, currentBrand.id)
      .then((document) => {
        if (cancelled) return;
        remoteDocumentIdRef.current = document.id;
        remoteRevisionRef.current = document.revision;
        hydrateProject({
          id: document.id,
          name: document.title,
          objects: restoreCanvasObjects(document.snapshot),
          view: restoreCanvasView(document.snapshot),
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          brandId: document.brandId,
        });
        // Hydration is a read operation; it must not be reported as a user edit.
        suppressPersistenceDirtyRef.current = true;
        setCanvasPersistenceStatus('saved');
      })
      .catch(() => {
        if (cancelled) return;
        remoteDocumentIdRef.current = null;
        remoteRevisionRef.current = null;
        if (localProject) {
          loadProject(projectId);
          setCanvasPersistenceStatus('unsaved');
        } else {
          setCanvasPersistenceStatus('failed');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, user?.id, currentBrand?.id, loadProject, hydrateProject, clearCanvas]);

  useEffect(() => {
    if (projectId !== 'new' || !sourceArtifactId || !currentBrand?.id) return;
    if (importedLibraryArtifactRef.current === sourceArtifactId) return;

    const artifact = listWorkspaceArtifacts(currentBrand.id, user?.id)
      .find((candidate) => candidate.id === sourceArtifactId);
    if (!artifact) return;

    importedLibraryArtifactRef.current = sourceArtifactId;
    let cancelled = false;
    const source = artifact.imageUrl || getWorkspaceArtifactCanonicalStoragePath(artifact.metadata);
    if (!source) {
      toast.error('ライブラリー素材の保存先を復元できません');
      return;
    }

    void (async () => {
      try {
        const resolvedSource = await resolveGeneratedImageUrl(source);
        const image = await loadLocalUploadImage(resolvedSource);
        if (cancelled) return;

        const sourceWorkspace = typeof artifact.metadata.sourceWorkspace === 'string'
          ? artifact.metadata.sourceWorkspace
          : undefined;
        const workflowVersion = typeof artifact.metadata.workflowVersion === 'string'
          ? artifact.metadata.workflowVersion
          : undefined;
        const sourceLabel = typeof artifact.metadata.sourceLabel === 'string'
          ? artifact.metadata.sourceLabel
          : undefined;
        const sourceResumePath = typeof artifact.metadata.sourceResumePath === 'string'
          ? artifact.metadata.sourceResumePath
          : undefined;
        const sourceMode = typeof artifact.metadata.sourceMode === 'string'
          ? artifact.metadata.sourceMode
          : undefined;
        const newId = addObject({
          type: 'image',
          x: Math.max(80, canvasSize.width / 2 - 220),
          y: Math.max(100, canvasSize.height / 2 - 220),
          width: Math.min(image.naturalWidth || image.width || 440, 440),
          height: Math.min(image.naturalHeight || image.height || 440, 440),
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          locked: false,
          visible: true,
          src: resolvedSource,
          label: artifact.title,
          metadata: {
            feature: 'library-import',
            generation: 0,
            prompt: artifact.prompt ?? undefined,
            galleryImageId: typeof artifact.metadata.imageId === 'string' ? artifact.metadata.imageId : undefined,
            galleryStoragePath: getWorkspaceArtifactCanonicalStoragePath(artifact.metadata) ?? undefined,
            galleryImageUrl: artifact.imageUrl || undefined,
            sourceWorkspace,
            workflowVersion,
            sourceReadback: sourceWorkspace && workflowVersion && sourceLabel
              ? {
                sourceWorkspace,
                workflowVersion,
                sourceLabel,
                sourceResumePath,
                sourceMode,
              }
              : undefined,
            parameters: {
              sourceArtifactId: artifact.id,
              sourceFeatureType: artifact.featureType,
              sourceCreatedAt: artifact.createdAt,
            },
          },
        });
        selectObject(newId);
        toast.success('ライブラリー素材をCanvasへ追加しました');
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'ライブラリー素材を復元できませんでした');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [addObject, canvasSize.height, canvasSize.width, currentBrand?.id, projectId, selectObject, sourceArtifactId, user?.id]);

  const selectedObject = selectedIds.length === 1
    ? objects.find((obj) => obj.id === selectedIds[0]) || null
    : null;

  useEffect(() => {
    if (!selectedObject && sidePanel === 'properties') {
      setSidePanel(null);
    }
  }, [selectedObject, sidePanel]);

  useEffect(() => {
    const partialEditObjects = objects.filter((object) => (
      object.type === 'image' &&
      (object.metadata?.feature === 'partial-edit' || object.metadata?.feature === 'inpaint')
    ));
    const latest = partialEditObjects[partialEditObjects.length - 1] ?? null;
    const metadata = latest?.metadata;
    const parameters = metadata?.parameters && typeof metadata.parameters === 'object'
      ? metadata.parameters
      : {};
    const marker = {
      partialEditResultCount: partialEditObjects.length,
      parentObjectId: metadata?.parentObjectId ?? metadata?.parentId ?? null,
      generation: metadata?.generation ?? null,
      maskApplied: metadata?.maskApplied ?? parameters.maskApplied ?? false,
      backendProvenance: metadata?.backendProvider ?? parameters.backendProvider ?? null,
      provider: metadata?.provider ?? parameters.provider ?? null,
      status: metadata?.status ?? parameters.status ?? null,
      jobId: metadata?.jobId ?? parameters.jobId ?? null,
      imageId: metadata?.imageId ?? parameters.imageId ?? null,
      storagePath: metadata?.storagePath ?? parameters.storagePath ?? null,
      persistenceStatus: metadata?.persistenceStatus ?? parameters.persistenceStatus ?? null,
      resultObjectId: latest?.id ?? null,
    };
    document.body.dataset.partialEditResultCount = String(marker.partialEditResultCount);
    document.body.dataset.heavyCanvasPartialEditState = JSON.stringify(marker);
    document.body.dataset.heavyCanvasGenerationState = JSON.stringify({
      partialEditResultCount: marker.partialEditResultCount,
      latestPartialEdit: marker,
    });

    return () => {
      delete document.body.dataset.partialEditResultCount;
      delete document.body.dataset.heavyCanvasPartialEditState;
      delete document.body.dataset.heavyCanvasGenerationState;
    };
  }, [objects]);
  const mobileCanvasFitProof = useMemo(() => {
    if (canvasSize.width >= 640 || objects.length === 0) {
      return { passed: true, reason: objects.length === 0 ? 'no_objects' : 'desktop_view' };
    }

    const visibleObjects = objects.filter((obj) => obj.visible !== false);
    if (visibleObjects.length === 0) return { passed: true, reason: 'no_visible_objects' };

    const bounds = visibleObjects.reduce(
      (acc, obj) => {
        const objectWidth = Math.max(1, obj.width * (obj.scaleX || 1));
        const objectHeight = Math.max(1, obj.height * (obj.scaleY || 1));
        return {
          minX: Math.min(acc.minX, obj.x),
          minY: Math.min(acc.minY, obj.y),
          maxX: Math.max(acc.maxX, obj.x + objectWidth),
          maxY: Math.max(acc.maxY, obj.y + objectHeight),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const screenBounds = {
      left: bounds.minX * zoom + panX,
      top: bounds.minY * zoom + panY,
      right: bounds.maxX * zoom + panX,
      bottom: bounds.maxY * zoom + panY,
    };
    const allowed = { left: 8, top: 52, right: canvasSize.width - 8, bottom: canvasSize.height - 92 };
    const passed =
      screenBounds.left >= allowed.left &&
      screenBounds.top >= allowed.top &&
      screenBounds.right <= allowed.right &&
      screenBounds.bottom <= allowed.bottom;

    return { passed, zoom, panX, panY, bounds, screenBounds, allowed, objectCount: visibleObjects.length };
  }, [canvasSize.height, canvasSize.width, objects, panX, panY, zoom]);
  const canvasGenerationState = useMemo(() => buildCanvasGenerationState(objects), [objects]);

  useEffect(() => {
    if (suppressPersistenceDirtyRef.current) {
      suppressPersistenceDirtyRef.current = false;
      return;
    }
    if (remoteDocumentIdRef.current && canvasPersistenceStatus === 'saved') {
      setCanvasPersistenceStatus('unsaved');
    }
  }, [canvasPersistenceStatus, currentProjectName, objects]);

  const getLightchainCompatForObject = (objectId: string | null) => {
    if (!objectId) return undefined;
    const object = objects.find((item) => item.id === objectId);
    return object?.metadata?.lightchainCompat;
  };

  const getParityRuntimeForObject = (objectId: string | null) => {
    if (!objectId) return undefined;
    const object = objects.find((item) => item.id === objectId);
    return object?.metadata?.parityRuntime;
  };

  const buildLightchainEditMetadata = (objectId: string | null) => {
    const object = objectId ? objects.find((item) => item.id === objectId) : null;
    const lightchainCompat = getLightchainCompatForObject(objectId);
    const parityRuntime = getParityRuntimeForObject(objectId);
    const sourceMetadata = object?.metadata;
    const sourceReadback = sourceMetadata?.sourceReadback || (
      sourceMetadata?.sourceWorkspace && sourceMetadata?.workflowVersion && sourceMetadata?.sourceLabel
        ? {
          sourceWorkspace: sourceMetadata.sourceWorkspace,
          workflowVersion: sourceMetadata.workflowVersion,
          sourceLabel: sourceMetadata.sourceLabel,
          sourceResumePath: sourceMetadata.sourceResumePath,
          sourceMode: sourceMetadata.sourceMode,
        }
        : undefined
    );
    const generationIntent = sourceMetadata?.generationIntent;
    return lightchainCompat || parityRuntime || sourceReadback
      ? {
        ...(lightchainCompat ? { lightchainCompat } : {}),
        ...(parityRuntime ? { parityRuntime } : {}),
        ...(sourceReadback ? { sourceReadback } : {}),
        ...(generationIntent ? { generationIntent } : {}),
      }
      : {};
  };

  const resolveCanvasObjectImageUrl = useCallback(async (object: CanvasObject) => {
    const candidates = Array.from(new Set([
      object.metadata?.galleryStoragePath,
      object.src,
      object.metadata?.galleryImageUrl,
    ].filter((source): source is string => Boolean(source))));
    let lastError: unknown;

    for (const source of candidates) {
      try {
        const localResolution = await resolveLocalCanvasAsset(source);
        if (localResolution) {
          localAssetReleasesRef.current.get(source)?.();
          localAssetReleasesRef.current.set(source, localResolution.release);
          return localResolution.source;
        }
        return await resolveGeneratedImageUrl(source);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('画像URLの解決に失敗しました');
  }, []);

  const buildDerivedLightchainMetadata = (
    sourceObject: typeof selectedObject,
    action: LightchainEditAction,
    options: { prompt?: string; parameters?: any } = {},
  ) => {
    const previousStages = Array.isArray(sourceObject?.metadata?.lightchainEditStages)
      ? sourceObject.metadata.lightchainEditStages
      : [];
    const lightchainCompat = sourceObject?.metadata?.lightchainCompat;
    const parityRuntime = sourceObject?.metadata?.parityRuntime;
    if (!lightchainCompat && !parityRuntime && previousStages.length === 0) return {};

    const nextStage = {
      stageId: `${action}-${previousStages.length + 1}`,
      action,
      label: LIGHTCHAIN_EDIT_ACTION_LABELS[action],
      status: 'completed' as const,
      sourceObjectId: sourceObject?.id,
      stepIndex: previousStages.length,
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(options.parameters ? { parameters: options.parameters } : {}),
      createdAt: new Date().toISOString(),
    };

    return {
      ...(lightchainCompat ? { lightchainCompat } : {}),
      ...(parityRuntime ? { parityRuntime } : {}),
      lightchainEditStages: [...previousStages, nextStage],
    };
  };

  // コンテナリサイズを確実に検知（サイドパネル開閉時も）
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize({ width, height });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // フォールバックとして window リサイズ時にも計測
  // サイドパネルはfixed positionなので、開閉時にはサイズ計算不要
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setCanvasSize({
          width: rect.width,
          height: rect.height,
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        useCanvasStore.getState().duplicateSelected();
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        useCanvasStore.getState().deleteSelected();
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        useCanvasStore.getState().selectAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // Focus input when editing name
  useEffect(() => {
    if (isEditingName && projectNameInputRef.current) {
      projectNameInputRef.current.focus();
      projectNameInputRef.current.select();
    }
  }, [isEditingName]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    if (currentProjectId) {
      renameProject(currentProjectId, newName);
    }
  };

  const handleNameBlur = () => {
    setIsEditingName(false);
    if (currentProjectId) {
      setCanvasPersistenceStatus('unsaved');
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
    if (e.key === 'Escape') {
      setIsEditingName(false);
    }
  };

  const handleReloadRemote = async () => {
    if (!remoteDocumentIdRef.current || !currentBrand?.id || !user?.id) {
      setCanvasPersistenceStatus('failed');
      toast.error('再読み込みできる保存済みCanvasがありません');
      return;
    }

    const brandId = currentBrand.id;
    const documentId = remoteDocumentIdRef.current;
    setCanvasPersistenceStatus('loading');
    try {
      const document = await getCanvasDocument(documentId, brandId);
      if (document.id !== documentId || document.brandId !== brandId) {
        throw new Error('canvas_document_readback_mismatch');
      }

      remoteDocumentIdRef.current = document.id;
      remoteRevisionRef.current = document.revision;
      hydrateProject({
        id: document.id,
        name: document.title,
        objects: restoreCanvasObjects(document.snapshot),
        view: restoreCanvasView(document.snapshot),
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        brandId: document.brandId,
      });
      suppressPersistenceDirtyRef.current = true;
      saveCurrentProject();
      acknowledgeCanvasRemoteReadback(user.id, brandId, document.id, document.snapshot);
      if (projectId !== document.id) navigate(`/canvas/${document.id}`, { replace: true });
      setCanvasPersistenceStatus('saved');
      toast.success('最新のCanvas状態を再読み込みしました');
    } catch (error: any) {
      setCanvasPersistenceStatus('failed');
      const message = String(error?.message || error || '');
      toast.error(message === 'canvas_document_readback_mismatch'
        ? 'Canvasの保存先が一致しません。最新状態を確認できませんでした'
        : 'Canvasの最新状態を再読み込みできませんでした');
    }
  };

  const handleSave = async () => {
    if (!currentBrand?.id || !user?.id) {
      setCanvasPersistenceStatus('failed');
      toast.error('ブランドとログイン状態を確認してください');
      return;
    }
    if (canvasPersistenceStatus === 'loading' || canvasPersistenceStatus === 'saving' || canvasPersistenceStatus === 'verifying') {
      return;
    }

    const brandId = currentBrand.id;
    const title = (currentProjectName || '無題のプロジェクト').trim().slice(0, 160);
    const snapshot = buildCanvasDocumentSnapshot({
      projectId: currentProjectId,
      name: title,
      objects,
      view: { zoom, panX, panY },
    });
    setCanvasPersistenceStatus('saving');

    try {
      const document = remoteDocumentIdRef.current && remoteRevisionRef.current !== null
        ? await updateCanvasDocument({
          brandId,
          documentId: remoteDocumentIdRef.current,
          title,
          snapshot,
          expectedRevision: remoteRevisionRef.current,
        })
        : await createCanvasDocument({ brandId, title, snapshot });

      // Retain the server identity before the verification readback. If the
      // write succeeded but the immediate readback fails, retry/reload must
      // update the same document instead of creating a duplicate.
      remoteDocumentIdRef.current = document.id;
      remoteRevisionRef.current = document.revision;
      setCanvasPersistenceStatus('verifying');
      const readback = await getCanvasDocument(document.id, brandId);
      if (readback.id !== document.id || readback.brandId !== brandId || readback.revision !== document.revision) {
        throw new Error('canvas_document_readback_mismatch');
      }

      remoteDocumentIdRef.current = readback.id;
      remoteRevisionRef.current = readback.revision;
      hydrateProject({
        id: readback.id,
        name: readback.title,
        objects: restoreCanvasObjects(readback.snapshot),
        view: restoreCanvasView(readback.snapshot),
        createdAt: readback.createdAt,
        updatedAt: readback.updatedAt,
        brandId: readback.brandId,
      });
      // The object update below is the verified server snapshot, not a local edit.
      suppressPersistenceDirtyRef.current = true;
      saveCurrentProject();
      acknowledgeCanvasRemoteReadback(user.id, brandId, readback.id, readback.snapshot);
      if (projectId !== readback.id) navigate(`/canvas/${readback.id}`, { replace: true });
      setCanvasPersistenceStatus('saved');
      toast.success('Canvasを保存し、サーバーで確認しました');
    } catch (error: any) {
      const documentId = remoteDocumentIdRef.current;
      if (documentId) retainCanvasCacheAfterFailedReadback(user.id, brandId, documentId, snapshot);
      const message = String(error?.message || error || '');
      setCanvasPersistenceStatus(/conflict|revision|409/i.test(message) ? 'conflict' : 'failed');
      const safeServerDetail = message.length > 0
        && message.length <= 160
        && !/[<>\n\r]/.test(message)
        && !/https?:\/\//i.test(message)
        ? message
        : null;
      toast.error(
        /conflict|revision|409/i.test(message)
          ? '他の編集と競合しました。最新状態を読み直してください'
          : safeServerDetail
            ? `Canvasをサーバーへ保存できませんでした（${safeServerDetail}）`
            : 'Canvasをサーバーへ保存できませんでした',
      );
    }
  };

  const handleObjectSelect = useCallback((id: string | null) => {
    if (id && containerRef.current) {
      const obj = useCanvasStore.getState().objects.find((o) => o.id === id);
      if (obj) {
        const { zoom, panX, panY } = useCanvasStore.getState();
        const rect = containerRef.current.getBoundingClientRect();
        const x = rect.left + obj.x * zoom + panX + (obj.width * zoom) / 2;
        const y = rect.top + obj.y * zoom + panY;
        setSelectedPosition({ x, y });
      }
    }
  }, []);

  const handleAddText = () => {
    addObject({
      type: 'text',
      x: canvasSize.width / 2 - 100,
      y: canvasSize.height / 2 - 20,
      width: 200,
      height: 40,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      visible: true,
      text: 'テキストを入力',
      fontSize: 24,
      fontFamily: 'Noto Sans JP',
      fill: '#262626',
    });
  };

  const handleAddShape = (shapeType: 'rect' | 'circle') => {
    addObject({
      type: 'shape',
      x: canvasSize.width / 2 - 50,
      y: canvasSize.height / 2 - 50,
      width: 100,
      height: 100,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      visible: true,
      shapeType,
      fill: '#f5f5f4',
      stroke: '#a3a3a3',
      strokeWidth: 2,
    });
  };

  const handleAddFrame = () => {
    addObject({
      type: 'frame',
      x: canvasSize.width / 2 - 150,
      y: canvasSize.height / 2 - 150,
      width: 300,
      height: 300,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      visible: true,
      stroke: '#806a54',
      strokeWidth: 2,
    });
  };

  const processLocalUploadFiles = useCallback((inputFiles: File[]) => {
    const files = inputFiles.filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;

    // Browsers may deliver both input and change for one file selection. The
    // capture bridge below intentionally handles either event, so coalesce
    // that pair without preventing a later selection of the same file.
    const eventKey = files.map((file) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`).join('|');
    if (localUploadEventKeysRef.current.has(eventKey)) return;
    localUploadEventKeysRef.current.add(eventKey);
    window.setTimeout(() => localUploadEventKeysRef.current.delete(eventKey), 0);

    setLocalUploadState({ status: 'loading', persistenceStatus: 'unknown', objectId: null, sourceRevision: null, error: null, errorCode: null });

    const failUpload = (message: string, errorCode: string) => {
      setLocalUploadState({ status: 'error', persistenceStatus: 'unknown', objectId: null, sourceRevision: null, error: message, errorCode });
      toast.error(message);
    };

    files.forEach((file) => {
      void (async () => {
        try {
          const { bytes, dataUrl: source } = await readLocalUploadFile(file);
          if (!source.startsWith('data:image/')) {
            throw new Error('canvas_upload_data_url_invalid');
          }
          const img = await loadLocalUploadImage(source);
          // Hash the exact bytes captured before the bridge resets the input.
          // The in-memory Blob avoids rereading a bridge-provided File object
          // after its input has been cleared.
          const sourceMetadata = sanitizeCanvasSourceMetadata(await buildLocalUploadSourceMetadata(
            new Blob([bytes], { type: file.type }),
            {
              width: img.naturalWidth || img.width,
              height: img.naturalHeight || img.height,
            },
          )) as CanvasSourceMetadata;

          let persistenceStatus: LocalUploadState['persistenceStatus'] = 'persistent';
          try {
            await putLocalCanvasAsset(
              sourceMetadata.sourceRevision.revision,
              new Blob([bytes], { type: file.type }),
            );
          } catch (persistenceError) {
            persistenceStatus = 'session-only';
            console.warn('Canvas local upload persistence unavailable; keeping this upload session-scoped', persistenceError);
          }

          const newId = addObject({
            type: 'image',
            x: 100 + Math.random() * 200,
            y: 100 + Math.random() * 200,
            width: Math.min(img.width, 400),
            height: Math.min(img.height, 400),
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
            locked: false,
            visible: true,
            src: source,
            metadata: {
              feature: 'local-upload',
              generation: 0,
              persistenceStatus,
              ...sourceMetadata,
            },
          });
          selectObject(newId);
          // Programmatic selection must take the same action/toolbar path as
          // a canvas click, otherwise the selected object's controls start at
          // the stale pre-upload position.
          handleObjectSelect(newId);
          setLocalUploadState({
            status: 'ready',
            persistenceStatus,
            objectId: newId,
            sourceRevision: sourceMetadata.sourceRevision.revision,
            error: null,
            errorCode: null,
          });
          if (persistenceStatus === 'session-only') {
            toast.error('このブラウザでは画像をリロード後に復元できません。現在のタブ内で続けてください');
          }
          setViewMode('canvas');
          setZoom(1);
          setPan(0, 0);
        } catch (error) {
          console.error('Canvas local upload failed:', error);
          failUpload(
            '画像の読み込みに失敗しました。もう一度お試しください',
            error instanceof Error ? error.message : 'canvas_upload_unknown_error',
          );
        }
      })();
    });
  }, [addObject, handleObjectSelect, selectObject, setPan, setZoom]);

  const handleFileUpload = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    // Reset synchronously so choosing the same file emits a new change event.
    input.value = '';
    processLocalUploadFiles(files);
  }, [processLocalUploadFiles]);

  useEffect(() => {
    const input = localUploadInputRef.current;
    if (!input) return;

    // Some automation/file-picker bridges set input.files without dispatching
    // input/change. Detect that narrow state transition and route it through
    // the same guarded upload path as native browser events.
    const pollId = window.setInterval(() => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;
      input.value = '';
      processLocalUploadFiles(files);
    }, 250);

    return () => window.clearInterval(pollId);
  }, [processLocalUploadFiles]);

  const loadCanvasImage = useCallback(async (imageUrl: string) => {
    const source = imageUrl.trim();

    if (!source) {
      return Promise.reject(new Error('画像URLが空です'));
    }

    const localResolution = await resolveLocalCanvasAsset(source);
    const resolvedSource = localResolution?.source || await resolveGeneratedImageUrl(source);
    const loadDirect = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      console.debug('Canvas image direct load start', { source, resolvedSource: src });
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        img.onload = null;
        img.onerror = null;
        img.src = '';
        console.warn('Canvas image direct load timeout', { source, resolvedSource: src });
        reject(new Error('画像の読み込みがタイムアウトしました'));
      }, 8000);
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        img.onload = null;
        img.onerror = null;
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      img.onload = () => {
        console.debug('Canvas image direct load success', { source, resolvedSource: src, width: img.naturalWidth, height: img.naturalHeight });
        finish(() => resolve(img));
      };
      img.onerror = () => {
        console.warn('Canvas image direct load error', { source, resolvedSource: src });
        finish(() => reject(new Error('画像を読み込めませんでした')));
      };
      img.src = src;
    });

    const loadViaBlob = async () => {
      if (!/^https?:/i.test(resolvedSource)) {
        return loadDirect(resolvedSource);
      }

      console.debug('Canvas image blob fallback start', { source, resolvedSource });
      const response = await fetch(resolvedSource);
      if (!response.ok) {
        console.warn('Canvas image blob fallback fetch failed', { source, resolvedSource, status: response.status });
        throw new Error('画像を読み込めませんでした');
      }

      const blob = await response.blob();
      if (/svg|xml/i.test(blob.type || '')) throw new Error('SVG画像はCanvas処理に使用できません');
      const objectUrl = window.URL.createObjectURL(blob);

      try {
        console.debug('Canvas image blob fallback object URL', { source, resolvedSource, objectUrl });
        return await loadDirect(objectUrl);
      } finally {
        window.URL.revokeObjectURL(objectUrl);
      }
    };

    if (!/^https?:/i.test(resolvedSource)) {
      try {
        return await loadDirect(resolvedSource);
      } finally {
        localResolution?.release();
      }
    }

    // Blob-first is required for readable Canvas operations. A successful
    // direct cross-origin image load is not proof that getImageData/export is
    // safe, so never fall back to a taintable remote image.
    return loadViaBlob().catch((error) => {
      console.error('Canvas image load final failure', { source, resolvedSource, error: String(error) });
      throw error;
    }).finally(() => localResolution?.release());
  }, []);

  const addImageToCanvas = useCallback(async (imageUrl: string, label?: string, metadata?: any, parentId?: string, preloadedImage?: HTMLImageElement | null) => {
    const isGalleryImport = metadata?.source === 'gallery-selector';
    // GallerySelector's <img> is optimized for preview and may be a signed
    // cross-origin image that Konva can render but cannot export. Re-resolve
    // Gallery imports through the blob-first loader below so the Canvas never
    // stores a taintable HTMLImageElement.
    const usablePreloadedImage = isGalleryImport
      ? null
      : (isUsableLoadedImage(preloadedImage) ? preloadedImage : null);
    const canvasImageSource = isGalleryImport && metadata?.galleryStoragePath
      ? metadata.galleryStoragePath
      : imageUrl;
    const fallbackImageSource = isGalleryImport && metadata?.galleryImageUrl && metadata.galleryImageUrl !== canvasImageSource
      ? metadata.galleryImageUrl
      : null;
    const img = usablePreloadedImage || await loadCanvasImage(canvasImageSource).catch((error) => {
      if (!fallbackImageSource) throw error;
      console.warn('Canvas gallery storage path load failed, trying signed URL fallback', {
        canvasImageSource,
        fallbackImageSource,
        error: String(error),
      });
      return loadCanvasImage(fallbackImageSource);
    });
    if (!isMountedRef.current) {
      throw new Error('Canvas画面が閉じられたため配置を中止しました');
    }
    const imageWidth = Math.max(1, img.naturalWidth || img.width || 1);
    const imageHeight = Math.max(1, img.naturalHeight || img.height || 1);
    const newId = addObject({
      type: 'image',
      x: isGalleryImport ? Math.max(24, canvasSize.width / 2 - Math.min(imageWidth, 300) / 2) : 100 + Math.random() * 300,
      y: isGalleryImport ? Math.max(24, canvasSize.height / 2 - Math.min(imageHeight, 300) / 2) : 100 + Math.random() * 200,
      width: Math.min(imageWidth, 300),
      height: Math.min(imageHeight, 300),
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      visible: true,
      src: canvasImageSource,
      label,
      derivedFrom: parentId || null,
      metadata: metadata ? {
        ...metadata,
        timestamp: new Date().toISOString(),
        parentId: parentId || undefined,
      } : undefined,
    });
    console.warn('Canvas gallery image added', {
      newId,
      imageUrl,
      canvasImageSource,
      width: imageWidth,
      height: imageHeight,
      preloaded: Boolean(usablePreloadedImage),
      galleryImport: isGalleryImport,
    });
    if (typeof document !== 'undefined') {
      document.body.dataset.canvasLastAdded = JSON.stringify({
        newId,
        imageUrl,
        canvasImageSource,
        width: imageWidth,
        height: imageHeight,
        preloaded: Boolean(usablePreloadedImage),
        ignoredPreload: Boolean(preloadedImage && !usablePreloadedImage),
        galleryImport: isGalleryImport,
      });
    }
    selectObject(newId);
    if (isGalleryImport) {
      pendingMobileGalleryFocusRef.current = newId;
      setZoom(1);
      setPan(0, 0);
    }
    return newId;
  }, [addObject, canvasSize.height, canvasSize.width, loadCanvasImage, selectObject, setPan, setZoom]);

  const addImageToCanvasSafely = useCallback(async (imageUrl: string, label?: string, metadata?: any, parentId?: string): Promise<boolean> => {
    try {
      await addImageToCanvas(imageUrl, label, metadata, parentId);
      return true;
    } catch (error: any) {
      console.error('Canvas image load error:', error);
      toast.error(error?.message || '画像をCanvasへ配置できませんでした');
      return false;
    }
  }, [addImageToCanvas]);

  const placeDerivedImages = useCallback(async (
    entries: ReadonlyArray<{ imageUrl: string; label?: string; metadata?: any; parentId?: string }>,
  ) => {
    const results = await Promise.all(entries.map((entry) => addImageToCanvasSafely(
      entry.imageUrl,
      entry.label,
      entry.metadata,
      entry.parentId,
    )));
    return {
      total: results.length,
      succeeded: results.filter(Boolean).length,
    };
  }, [addImageToCanvasSafely]);

  const assertDerivedImageResult = useCallback((result: any, action: 'removeBackground' | 'colorize' | 'upscale' | 'variations') => {
    if (action === 'removeBackground' || action === 'upscale') {
      if (!result?.resultUrl) {
        throw new Error('派生結果が返りませんでした');
      }
      return;
    }

    if (!Array.isArray(result?.variations) || result.variations.length === 0) {
      throw new Error('派生結果が返りませんでした');
    }
  }, []);

  const handleSelectGalleryImage = useCallback(async (imageUrl: string, imageId: string, storagePath?: string, imageElement?: HTMLImageElement | null) => {
    try {
      const usableImageElement = isUsableLoadedImage(imageElement) ? imageElement : null;
      if (usableImageElement) {
        preloadedGalleryImagesRef.current.set(imageUrl, usableImageElement);
      }
      const canvasSource = storagePath || imageUrl;
      console.warn('Canvas gallery selection', {
        imageId,
        imageUrl,
        storagePath,
        canvasSource,
        hasImageElement: Boolean(usableImageElement),
        ignoredImageElement: Boolean(imageElement && !usableImageElement),
        naturalWidth: imageElement?.naturalWidth || null,
        naturalHeight: imageElement?.naturalHeight || null,
      });
      if (typeof document !== 'undefined') {
        document.body.dataset.canvasGallerySelection = JSON.stringify({
          imageId,
          imageUrl,
          storagePath,
          canvasSource,
          hasImageElement: Boolean(usableImageElement),
          ignoredImageElement: Boolean(imageElement && !usableImageElement),
          naturalWidth: imageElement?.naturalWidth || null,
          naturalHeight: imageElement?.naturalHeight || null,
        });
      }
      await addImageToCanvas(canvasSource, 'Gallery素材', {
        feature: 'gallery-import',
        generation: 0,
        source: 'gallery-selector',
        imageId,
        galleryImageId: imageId,
        galleryStoragePath: storagePath,
        galleryImageUrl: imageUrl,
      }, undefined, usableImageElement);
      setShowGallerySelector(false);
      toast.success('Gallery画像をCanvasへ配置しました');
    } catch (error: any) {
      console.error('Canvas gallery image load error:', error);
      toast.error(error?.message || 'Gallery画像をCanvasへ配置できませんでした');
    }
  }, [addImageToCanvas]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.sessionStorage.getItem(GENERATED_CANVAS_HANDOFF_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(GENERATED_CANVAS_HANDOFF_KEY);

    try {
      const payload = JSON.parse(raw);
      const images = Array.isArray(payload?.images) ? payload.images : [];
      const entries: Array<{ imageUrl: string; label: string; metadata: any }> = [];
      images.forEach((image: any, index: number) => {
        if (typeof image?.imageUrl !== 'string' || !image.imageUrl) return;
        const sourceReadback = image.sourceReadback || (
          image.sourceWorkspace && image.workflowVersion && image.sourceLabel
            ? {
              sourceWorkspace: image.sourceWorkspace,
              workflowVersion: image.workflowVersion,
              sourceLabel: image.sourceLabel,
              sourceResumePath: image.sourceResumePath,
              sourceMode: image.sourceMode,
            }
            : null
        );
        entries.push({
          imageUrl: image.imageUrl,
          label: image.label || `生成結果 ${index + 1}`,
          metadata: {
            feature: image.feature || 'generate-image',
            prompt: image.prompt || '',
            generation: 0,
            parameters: {
              source: payload?.source || 'generate-results',
              resultId: image.resultId || null,
              jobId: image.jobId || null,
              imageId: image.imageId || null,
              storagePath: image.storagePath || null,
              provider: image.provider || null,
              backendProvider: image.backendProvider || null,
              providerModel: image.providerModel || null,
              inputFidelity: image.inputFidelity || null,
              quality: image.quality || null,
              persistenceStatus: image.persistenceStatus || null,
              artifactKind: image.artifactKind || null,
              handoffCreatedAt: payload?.createdAt || null,
              materialReferences: image.materialReferences || null,
              layerPlan: image.layerPlan || null,
              maskPlan: image.maskPlan || null,
              compositionPreview: image.compositionPreview || null,
            },
            ...(sourceReadback ? { sourceReadback, ...sourceReadback } : {}),
            ...(image.generationIntent ? { generationIntent: image.generationIntent } : {}),
          },
        });
      });
      void Promise.all(entries.map((entry) => addImageToCanvasSafely(entry.imageUrl, entry.label, entry.metadata)))
        .then((results) => {
          const succeeded = results.filter(Boolean).length;
          if (succeeded > 0) {
            toast.success(`${succeeded}件の生成結果をCanvasへ配置しました`);
          }
          if (succeeded < entries.length) {
            toast.error(`${entries.length - succeeded}件の生成結果をCanvasへ配置できませんでした`);
          }
        });
    } catch (error) {
      console.error('Generated canvas handoff failed:', error);
      toast.error('生成結果をCanvasへ配置できませんでした');
    }
  }, [addImageToCanvasSafely]);

  const handleGenerate = async () => {
    if (!currentBrand) {
      toast.error('ブランドを選択してください');
      return;
    }

    setIsGenerating(true);
    try {
      let data;
      let error;
      let canvasGenerationResultCount = 0;
      const safetyText = [generatePrompt, productDescription, headline, subheadline].filter(Boolean).join(' ');
      if (!rightsConfirmed) {
        toast.error('素材と生成指示の権利確認にチェックしてください');
        setIsGenerating(false);
        return;
      }
      if (validateLegalSafetyInput([safetyText]).blocked) {
        toast.error(BRAND_LIKENESS_BLOCK_COPY);
        setIsGenerating(false);
        return;
      }

      // 共通のベースボディ（参照画像を含む）
      const baseBody = {
        brandId: currentBrand.id,
        referenceImage: referenceImage?.url,
        referenceType: referenceImage?.referenceType,
        legalSafety: {
          rightsConfirmed,
        },
      };

      switch (generateMode) {
        case 'gacha':
          if (!generatePrompt.trim() && !referenceImage) {
            toast.error('ブリーフまたは参考画像を入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('design-gacha', {
            body: {
              ...baseBody,
              brief: generatePrompt,
              imageUrl: referenceImage?.url,
              directions: 4
            }
          }));
          if (Array.isArray(data?.variations) && data.variations.length > 0) {
            canvasGenerationResultCount = (await Promise.all(data.variations.map((v: any) => addImageToCanvasSafely(v.imageUrl, v.directionName, {
                feature: 'design-gacha',
                prompt: generatePrompt,
                generation: 0,
                parameters: { direction: v.directionName },
              })))).filter(Boolean).length;
            if (canvasGenerationResultCount > 0) toast.success(`${canvasGenerationResultCount}つのデザインをCanvasへ配置しました`);
            if (canvasGenerationResultCount < data.variations.length) toast.error(`${data.variations.length - canvasGenerationResultCount}つのデザインをCanvasへ配置できませんでした`);
          }
          break;

        case 'product-shots':
          if (!productDescription.trim() && !referenceImage) {
            toast.error('商品説明または商品画像を入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('product-shots', {
            body: {
              ...baseBody,
              productDescription,
              imageUrl: referenceImage?.url,
            }
          }));
          if (Array.isArray(data?.shots) && data.shots.length > 0) {
            canvasGenerationResultCount = (await Promise.all(data.shots.map((s: any) => addImageToCanvasSafely(s.imageUrl, s.shotName, {
                feature: 'product-shots',
                prompt: productDescription,
                generation: 0,
                parameters: { shotType: s.shotType },
              })))).filter(Boolean).length;
            if (canvasGenerationResultCount > 0) toast.success(`${canvasGenerationResultCount}件の商品カットをCanvasへ配置しました`);
            if (canvasGenerationResultCount < data.shots.length) toast.error(`${data.shots.length - canvasGenerationResultCount}件の商品カットをCanvasへ配置できませんでした`);
          }
          break;

        case 'model-matrix':
          if (!productDescription.trim() && !referenceImage) {
            toast.error('商品説明または商品画像を入力してください');
            setIsGenerating(false);
            return;
          }
          if (selectedBodyTypes.length * selectedAgeGroups.length > MAX_MODEL_MATRIX_PATTERNS) {
            toast.error(`一度に生成できる着用画像は${MAX_MODEL_MATRIX_PATTERNS}パターンまでです。体型または年代を減らしてください。`);
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('model-matrix', {
            body: {
              ...baseBody,
              productDescription,
              imageUrl: referenceImage?.url,
              modelReferenceImageUrl: referenceImage ? modelReferenceImage?.url : undefined,
              bodyTypes: selectedBodyTypes,
              ageGroups: selectedAgeGroups
            }
          }));
          if (Array.isArray(data?.matrix) && data.matrix.length > 0) {
            canvasGenerationResultCount = (await Promise.all(data.matrix.map((m: any) => addImageToCanvasSafely(m.imageUrl, `${m.bodyTypeName} × ${m.ageGroupName}`, {
                feature: 'model-matrix',
                prompt: productDescription,
                generation: 0,
                parameters: { bodyType: m.bodyType, ageGroup: m.ageGroup },
              })))).filter(Boolean).length;
            if (canvasGenerationResultCount > 0) toast.success(`${canvasGenerationResultCount}パターンのモデル画像をCanvasへ配置しました`);
            if (canvasGenerationResultCount < data.matrix.length) toast.error(`${data.matrix.length - canvasGenerationResultCount}パターンをCanvasへ配置できませんでした`);
          }
          break;

        case 'multilingual':
          if (!headline.trim()) {
            toast.error('ヘッドラインを入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('multilingual-banner', {
            body: {
              ...baseBody,
              headline,
              subheadline,
              imageUrl: referenceImage?.url,
              languages: selectedLanguages,
              aspectRatio: '1:1'
            }
          }));
          if (Array.isArray(data?.banners) && data.banners.length > 0) {
            canvasGenerationResultCount = (await Promise.all(data.banners.map((b: any) => addImageToCanvasSafely(b.imageUrl, b.languageName, {
                feature: 'multilingual-banner',
                prompt: headline,
                generation: 0,
                parameters: { language: b.language, subheadline },
              })))).filter(Boolean).length;
            if (canvasGenerationResultCount > 0) toast.success(`${canvasGenerationResultCount}言語のバナーをCanvasへ配置しました`);
            if (canvasGenerationResultCount < data.banners.length) toast.error(`${data.banners.length - canvasGenerationResultCount}言語のバナーをCanvasへ配置できませんでした`);
          }
          break;

        default:
          if (!generatePrompt.trim()) {
            toast.error('プロンプトを入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('generate-image', {
            body: {
              ...baseBody,
              prompt: generatePrompt,
              width: 1024,
              height: 1024,
              generationProvider: 'openai',
            }
          }));
          if (Array.isArray(data?.images) && data.images.length > 0) {
            canvasGenerationResultCount = (await Promise.all(data.images.map((img: any) => addImageToCanvasSafely(img.imageUrl, undefined, {
                feature: 'generate-image',
                prompt: generatePrompt,
                generation: 0,
              })))).filter(Boolean).length;
            if (canvasGenerationResultCount > 0) toast.success(`${canvasGenerationResultCount}件の画像をCanvasへ配置しました`);
            if (canvasGenerationResultCount < data.images.length) toast.error(`${data.images.length - canvasGenerationResultCount}件の画像をCanvasへ配置できませんでした`);
          }
      }

      if (error) throw error;
      if (canvasGenerationResultCount === 0) throw new Error('canvas_generation_no_results');

      setShowGenerateModal(false);
      setGeneratePrompt('');
      setProductDescription('');
      setHeadline('');
      setSubheadline('');
      setReferenceImage(null);
    } catch (error: any) {
      console.error('Generation error:', error);
          toast.error(await edgeFunctionErrorMessage(error) || '画像生成に失敗しました');
    } finally {
      setIsGenerating(false);
    }
  };

  // Context menu and floating toolbar action handler - now with real API calls
  const handleContextAction = async (action: string, objectId: string | null) => {
    console.warn('Canvas context action invoked', {
      action,
      objectId,
      selectedId: selectedObject?.id ?? null,
      currentBrandId: currentBrand?.id ?? null,
      rightsConfirmed,
    });
    // Handle canvas-level actions
    if (!objectId) {
      switch (action) {
        case 'addImage':
          document.getElementById('file-upload')?.click();
          break;
        case 'addText':
          handleAddText();
          break;
        case 'selectAll':
          useCanvasStore.getState().selectAll();
          break;
        case 'resetView':
          setZoom(1);
          setPan(0, 0);
          toast.success('表示をリセットしました');
          break;
      }
      return;
    }

    const obj = objects.find(o => o.id === objectId);
    if (!obj) return;

    // Handle object-level actions
    switch (action) {
      case 'duplicate':
        useCanvasStore.getState().duplicateSelected();
        toast.success('複製しました');
        return;
      case 'delete':
        useCanvasStore.getState().deleteObject(objectId);
        toast.success('削除しました');
        return;
      case 'bringToFront':
        useCanvasStore.getState().bringToFront(objectId);
        return;
      case 'sendToBack':
        useCanvasStore.getState().sendToBack(objectId);
        return;
      case 'lock':
        updateObject(objectId, { locked: true });
        toast.success('ロックしました');
        return;
      case 'unlock':
        updateObject(objectId, { locked: false });
        toast.success('ロック解除しました');
        return;
      case 'hide':
        updateObject(objectId, { visible: false });
        toast.success('非表示にしました');
        return;
      case 'show':
        updateObject(objectId, { visible: true });
        toast.success('表示しました');
        return;
      case 'download':
        if (obj.type === 'image' && obj.src) {
          try {
            const resolvedSrc = await resolveCanvasObjectImageUrl(obj);
            await downloadValidatedImage(
              resolvedSrc,
              `${obj.label || 'image'}.png`,
              'canvas_image_download',
            );
            toast.success('ダウンロードしました');
          } catch {
            toast.error('ダウンロードに失敗しました');
          }
        }
        return;
    }

    // Handle AI actions for images
    if (obj.type !== 'image' || !obj.src) {
      if (action.startsWith('edit') || action.startsWith('partial') || action.startsWith('remove') || action.startsWith('color') || action.startsWith('upscale') || action.startsWith('generate') || action.startsWith('design') || action.startsWith('product') || action.startsWith('model') || action.startsWith('multilingual') || action.startsWith('scene')) {
        toast.error('画像を選択してください');
      }
      return;
    }

    const lightchainEditMetadata = buildLightchainEditMetadata(objectId);
    if (!currentBrand?.id) {
      toast.error('ブランドを選択してから実行してください');
      return;
    }
    if (!rightsConfirmed) {
      toast.error('素材の利用権利を確認してください');
      return;
    }
    if (action === 'partial-edit' || action === 'inpaint') {
      partialEditAttemptRef.current = { attempted: false, idempotencyKey: null };
      setPartialEditingImage(obj.src);
      setPartialEditingObjectId(objectId);
      setShowPartialEditModal(true);
      return;
    }
    if (action === 'edit' || action === 'editWithPrompt' || action === 'edit-prompt') {
      inpaintAttemptRef.current = { attempted: false, idempotencyKey: null };
      setEditingImage(obj.src);
      setEditingObjectId(objectId);
      setShowEditModal(true);
      return;
    }

    const imageSrc = await resolveCanvasObjectImageUrl(obj);
    console.warn('Canvas image action preflight', {
      action,
      objectId,
      type: obj.type,
      hasSrc: Boolean(obj.src),
      currentBrandId: currentBrand?.id ?? null,
      rightsConfirmed,
      imageSrc,
    });

    switch (action) {
      case 'removeBackground':
      case 'remove-bg':
        toast.loading('背景削除を実行中...', { id: 'remove-bg' });
        try {
          const { data, error } = await supabase.functions.invoke('remove-background', {
            body: { imageUrl: imageSrc, brandId: currentBrand.id, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata }
          });
          if (error) throw error;
          assertDerivedImageResult(data, 'removeBackground');
          const placed = await addImageToCanvasSafely(data.resultUrl, '背景削除', {
            feature: 'remove-background',
            parentId: objectId,
            generation: (obj.metadata?.generation || 0) + 1,
            ...buildDerivedLightchainMetadata(obj, 'remove-background'),
          }, objectId);
          if (!placed) throw new Error('canvas_derived_result_placement_failed');
          toast.success('背景を削除しました', { id: 'remove-bg' });
        } catch (err: any) {
          toast.error(await edgeFunctionErrorMessage(err) || '背景削除に失敗しました', { id: 'remove-bg' });
        }
        break;

      case 'colorVariations':
      case 'colorize':
        toast.loading('カラバリを生成中...', { id: 'colorize' });
        try {
          const { data, error } = await supabase.functions.invoke('colorize', {
            body: { imageUrl: imageSrc, brandId: currentBrand.id, colors: ['red', 'blue', 'green', 'yellow'], legalSafety: { rightsConfirmed }, ...lightchainEditMetadata }
          });
          if (error) throw error;
          assertDerivedImageResult(data, 'colorize');
          const placement = await placeDerivedImages(data.variations.map((v: any) => {
            const parameters = { color: v.colorName };
            return {
              imageUrl: v.imageUrl,
              label: v.colorName,
              parentId: objectId,
              metadata: {
              feature: 'colorize',
              parentId: objectId,
              generation: (obj.metadata?.generation || 0) + 1,
              parameters,
              ...buildDerivedLightchainMetadata(obj, 'colorize', { parameters }),
              },
            };
          }));
          if (placement.succeeded === 0) throw new Error('canvas_derived_result_placement_failed');
          if (placement.succeeded < placement.total) {
            toast.error(`${placement.total - placement.succeeded}件のカラバリをCanvasへ配置できませんでした`, { id: 'colorize' });
          } else {
            toast.success('カラバリを生成しました', { id: 'colorize' });
          }
        } catch (err: any) {
          toast.error(await edgeFunctionErrorMessage(err) || 'カラバリ生成に失敗しました', { id: 'colorize' });
        }
        break;

      case 'upscale':
        toast.loading('アップスケール中...', { id: 'upscale' });
        try {
          const { data, error } = await supabase.functions.invoke('upscale', {
            body: { imageUrl: imageSrc, brandId: currentBrand.id, scale: 2, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata }
          });
          if (error) throw error;
          assertDerivedImageResult(data, 'upscale');
          const placed = await addImageToCanvasSafely(data.resultUrl, '高解像度', {
            feature: 'upscale',
            parentId: objectId,
            generation: (obj.metadata?.generation || 0) + 1,
            ...buildDerivedLightchainMetadata(obj, 'upscale', { parameters: { scale: 2 } }),
          }, objectId);
          if (!placed) throw new Error('canvas_derived_result_placement_failed');
          toast.success('アップスケールしました', { id: 'upscale' });
        } catch (err: any) {
          toast.error(await edgeFunctionErrorMessage(err) || 'アップスケールに失敗しました', { id: 'upscale' });
        }
        break;

      case 'variations':
      case 'generateVariations':
      case 'derive':
        toast.loading('バリエーションを生成中...', { id: 'variations' });
        try {
          const { data, error } = await supabase.functions.invoke('generate-variations', {
            body: { imageUrl: imageSrc, brandId: currentBrand.id, count: 4, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata }
          });
          if (error) throw error;
          assertDerivedImageResult(data, 'variations');
          const placement = await placeDerivedImages(data.variations.map((v: any, i: number) => ({
            imageUrl: v.imageUrl,
            label: `バリエーション ${i + 1}`,
            parentId: objectId,
            metadata: {
              feature: 'generate-variations',
              parentId: objectId,
              generation: (obj.metadata?.generation || 0) + 1,
              ...buildDerivedLightchainMetadata(obj, 'generate-variations', { parameters: { index: i + 1 } }),
            },
          })));
          if (placement.succeeded === 0) throw new Error('canvas_derived_result_placement_failed');
          if (placement.succeeded < placement.total) {
            toast.error(`${placement.total - placement.succeeded}件のバリエーションをCanvasへ配置できませんでした`, { id: 'variations' });
          } else {
            toast.success('バリエーションを生成しました', { id: 'variations' });
          }
        } catch (err: any) {
          toast.error(await edgeFunctionErrorMessage(err) || 'バリエーション生成に失敗しました', { id: 'variations' });
        }
        break;

      case 'download':
        try {
          await downloadValidatedImage(imageSrc, 'image.png', 'canvas_image_download');
          toast.success('ダウンロードしました');
        } catch {
          toast.error('ダウンロードに失敗しました');
        }
        break;

      default:
        break;
    }
  };

  // Keep compatibility with FloatingToolbar actions
  const handleFloatingAction = (action: string) => {
    console.warn('Canvas floating action invoked', {
      action,
      selectedId: selectedObject?.id ?? null,
      selectedType: selectedObject?.type ?? null,
    });
    if (selectedObject) {
      handleContextAction(action, selectedObject.id);
    } else {
      handleContextAction(action, null);
    }
  };

  const waitForExportRenderReady = async () => {
    const deadline = Date.now() + 8000;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    while (Date.now() < deadline) {
      const state = canvasRenderStateRef.current;
      if (
        state.renderAllObjects &&
        state.loadedImageObjects >= state.totalImageObjects
      ) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Canvas export render did not become ready');
  };

  const getCanvasExportBounds = (stage: Konva.Stage) => {
    const rects = objects
      .filter((object) => object.visible !== false)
      .map((object) => stage.findOne(`#${object.id}`)?.getClientRect({ relativeTo: stage }))
      .filter((rect): rect is Konva.Vector2d & { width: number; height: number } => Boolean(rect));
    if (rects.length === 0) {
      return { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height };
    }
    const padding = 24;
    const bounds = rects.reduce((acc, rect) => {
      const right = rect.x + rect.width;
      const bottom = rect.y + rect.height;
      return {
        minX: Math.min(acc.minX, rect.x),
        minY: Math.min(acc.minY, rect.y),
        maxX: Math.max(acc.maxX, right),
        maxY: Math.max(acc.maxY, bottom),
      };
    }, {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    });
    return {
      x: Math.floor(bounds.minX - padding),
      y: Math.floor(bounds.minY - padding),
      width: Math.ceil(bounds.maxX - bounds.minX + padding * 2),
      height: Math.ceil(bounds.maxY - bounds.minY + padding * 2),
    };
  };

  const handleExportCanvas = async () => {
    const setExportReadback = (value: string) => {
      if (typeof document !== 'undefined') {
        document.body.dataset.canvasExportLastResult = value;
      }
    };
    setExportReadback('started');
    let stage = canvasStageRef.current;
    if (!stage) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      stage = canvasStageRef.current;
    }
    if (!stage) {
      setExportReadback('stage_missing');
      toast.error('キャンバスの準備が完了していません');
      return;
    }
    const previousScale = stage.scale();
    const previousPosition = stage.position();
    try {
      setExportReadback('rendering');
      setIsExportRenderingAll(true);
      await waitForExportRenderReady();
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      stage.batchDraw();
      const exportBounds = getCanvasExportBounds(stage);

      const dataUrl = stage.toDataURL({
        x: exportBounds.x,
        y: exportBounds.y,
        width: Math.max(1, exportBounds.width),
        height: Math.max(1, exportBounds.height),
        pixelRatio: 2,
        mimeType: 'image/png',
      });

      // Use a Blob URL for the download. Direct data: URL downloads are
      // treated as the current document by some Chrome extension bridges,
      // which can leave a .png file containing the app HTML instead of the
      // rendered canvas.
      const dataResponse = await fetch(dataUrl);
      const imageBlob = await dataResponse.blob();
      if (imageBlob.size <= 0 || !imageBlob.type.toLowerCase().startsWith('image/')) {
        throw new Error('Canvas export did not produce an image blob');
      }
      const objectUrl = window.URL.createObjectURL(imageBlob);

      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${(currentProjectName || 'heavy-chain-canvas').replace(/[\\/:*?"<>|]+/g, '-')}.png`;
      document.body.appendChild(link);
      try {
        link.click();
        setExportReadback('success');
        toast.success('CanvasをPNGで書き出しました');
      } finally {
        document.body.removeChild(link);
        // Chromium may dispatch the download asynchronously. Revoking the
        // blob URL in the same task can cancel the download event.
        window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch (error) {
      setExportReadback(`error:${error instanceof Error ? error.message : 'unknown'}`);
      console.error('Canvas export failed:', error);
      toast.error('PNG書き出しに失敗しました。外部画像を含む場合は個別画像のダウンロードを使ってください');
    } finally {
      stage.scale(previousScale);
      stage.position(previousPosition);
      stage.batchDraw();
      setIsExportRenderingAll(false);
    }
  };

  // Handle chat edit result
  const handleChatEditResult = (imageUrl: string) => {
    addImageToCanvasSafely(imageUrl, '編集結果');
  };

  // Handle template select
  const handleTemplateSelect = (template: SizeTemplate) => {
    // Add template as frame with preset size
    const templateId = addObject({
      type: 'frame',
      x: canvasSize.width / 2 - template.width / 4,
      y: canvasSize.height / 2 - template.height / 4,
      width: template.width / 2,
      height: template.height / 2,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      visible: true,
      stroke: '#806a54',
      strokeWidth: 2,
      label: template.name,
      metadata: {
        feature: 'canvas-size-template',
        generation: 0,
        parameters: {
          templateId: template.id,
          templateName: template.name,
          originalSize: { width: template.width, height: template.height },
        },
        timestamp: new Date().toISOString(),
      },
    });
    setSelectedSizeTemplateId(template.id);
    selectObject(templateId);
    toast.success(`${template.name}を追加しました`);
    setSidePanel('properties');
  };

  const getTemplateNumber = (value: unknown, fallback: number, maxValue: number) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      if (value === '100%') return maxValue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  };

  const getTemplatePlacement = (
    element: Record<string, unknown>,
    width: number,
    height: number,
    scale: number,
    baseX: number,
    baseY: number,
  ) => {
    const rawX = element.x;
    const rawY = element.y;
    const x = rawX === 'center'
      ? canvasSize.width / 2 - (width * scale) / 2
      : baseX + getTemplateNumber(rawX, 0, 1080) * scale;
    const y = rawY === 'center'
      ? canvasSize.height / 2 - (height * scale) / 2
      : baseY + getTemplateNumber(rawY, 0, 1080) * scale;
    return { x, y };
  };

  const handleDesignTemplateSelect = (template: DesignTemplate) => {
    const baseWidth = 720;
    const baseHeight = 520;
    const baseX = canvasSize.width / 2 - baseWidth / 2;
    const baseY = canvasSize.height / 2 - baseHeight / 2;
    const scale = 0.48;
    const timestamp = new Date().toISOString();
    const createdIds: string[] = [];

    const frameId = addObject({
      type: 'frame',
      x: baseX,
      y: baseY,
      width: baseWidth,
      height: baseHeight,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      locked: false,
      visible: true,
      fill: '#fffaf4',
      stroke: '#c47b45',
      strokeWidth: 2,
      label: `${template.name} キャンバス`,
      metadata: {
        feature: 'canvas-design-template',
        generation: 0,
        parameters: {
          templateId: template.id,
          templateName: template.name,
          templateCategory: template.category,
          role: 'template-root-frame',
        },
        timestamp,
      },
    });
    createdIds.push(frameId);

    template.elements.forEach((element, index) => {
      const type = String(element.type || '');
      const width = Math.max(24, getTemplateNumber(element.width, type === 'text' ? 360 : 360, 1080) * scale);
      const height = Math.max(24, getTemplateNumber(element.height, type === 'text' ? 72 : 300, 1080) * scale);
      const placement = getTemplatePlacement(element, width / scale, height / scale, scale, baseX + 72, baseY + 52);
      const metadata = {
        feature: 'canvas-design-template',
        parentId: frameId,
        generation: 1,
        parameters: {
          templateId: template.id,
          templateName: template.name,
          templateCategory: template.category,
          elementIndex: index,
          elementType: type,
        },
        timestamp,
      };

      if (type === 'text') {
        const textId = addObject({
          type: 'text',
          x: placement.x,
          y: placement.y,
          width,
          height,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          locked: false,
          visible: true,
          text: String(element.content || template.name),
          fontSize: Math.max(12, getTemplateNumber(element.fontSize, 24, 96) * 0.62),
          fontFamily: 'Inter, Noto Sans JP, sans-serif',
          fill: '#171717',
          parentId: frameId,
          derivedFrom: frameId,
          label: `${template.name} テキスト`,
          metadata,
        });
        createdIds.push(textId);
        return;
      }

      if (type === 'shape') {
        const shapeWidth = Math.max(120, width);
        const shapeHeight = Math.max(32, height);
        const shapeId = addObject({
          type: 'shape',
          x: placement.x,
          y: placement.y,
          width: shapeWidth,
          height: shapeHeight,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 0.95,
          locked: false,
          visible: true,
          shapeType: 'rect',
          fill: '#22c9bd',
          stroke: '#16877f',
          strokeWidth: 1,
          parentId: frameId,
          derivedFrom: frameId,
          label: `${template.name} 装飾`,
          metadata,
        });
        createdIds.push(shapeId);
        return;
      }

      const placeholderId = addObject({
        type: 'frame',
        x: placement.x,
        y: placement.y,
        width,
        height,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        locked: false,
        visible: true,
        fill: '#f6f0e8',
        stroke: '#a8a29e',
        strokeWidth: 2,
        parentId: frameId,
        derivedFrom: frameId,
        label: `${template.name} 画像枠`,
        metadata,
      });
      createdIds.push(placeholderId);
    });

    setSelectedDesignTemplateId(template.id);
    selectObject(createdIds[createdIds.length - 1] || frameId);
    toast.success(`${template.name}をCanvasに展開しました`);
    setSidePanel('properties');
  };

  const handlePartialEditSubmit = async (payload: PartialEditPayload) => {
    if (!partialEditingImage) return;
    if (partialEditAttemptRef.current.attempted) {
      throw new Error('partial_edit_retry_blocked_after_external_request');
    }
    if (!currentBrand?.id) {
      throw new Error('ブランドを選択してから実行してください');
    }
    if (!rightsConfirmed) {
      throw new Error('素材の利用権利を確認してください');
    }
    if (validateLegalSafetyInput([payload.prompt]).blocked) {
      throw new Error(BRAND_LIKENESS_BLOCK_COPY);
    }

    const sourceObject = partialEditingObjectId
      ? objects.find((item) => item.id === partialEditingObjectId) ?? null
      : null;
    const generation = (sourceObject?.metadata?.generation || 0) + 1;
    const lightchainEditMetadata = buildLightchainEditMetadata(partialEditingObjectId);
    const editSource = sourceObject
      ? await resolveCanvasObjectImageUrl(sourceObject)
      : await resolveGeneratedImageUrl(partialEditingImage);
    const idempotencyKey = `heavy-canvas-partial-edit-${crypto.randomUUID()}`;
    partialEditAttemptRef.current = { attempted: true, idempotencyKey };
    const result = await editImageWithPrompt(
      editSource,
      payload.prompt,
      currentBrand.id,
      {
        rightsConfirmed,
        maskDataUrl: payload.maskDataUrl,
        parentObjectId: partialEditingObjectId,
        generation,
        maskApplied: true,
        maskCoveragePercent: payload.maskCoveragePercent,
        maskWidth: payload.maskWidth,
        maskHeight: payload.maskHeight,
        idempotencyKey,
        ...lightchainEditMetadata,
      },
    );
    const candidates = normalizeCanvasImageEditCandidates(result);
    const hasCompleteCandidateBatch = result.requestedCandidateCount === 4
      && result.persistedCandidateCount === 4
      && result.persistenceStatus === 'completed'
      && (result.failedCandidates?.length ?? 0) === 0
      && candidates.length === 4;
    if (!result.success || !hasCompleteCandidateBatch) {
      throw new Error([
        'partial_edit_candidate_batch_incomplete',
        `requested=${result.requestedCandidateCount ?? 'unknown'}`,
        `persisted=${result.persistedCandidateCount ?? 'unknown'}`,
        `normalized=${candidates.length}`,
        `status=${result.persistenceStatus ?? 'unknown'}`,
      ].join(':'));
    }

    const batchId = candidates[0].jobId;
    const preloadedImages = await Promise.all(candidates.map(async (candidate) => ({
      candidate,
      image: await loadCanvasImage(candidate.imageUrl),
    })));
    const preloadedImagesById = new Map(preloadedImages.map(({ candidate, image }) => [candidate.imageId, image]));
    const backendProvider = result.backendProvider || 'supabase-edge-function';
    const provider = result.provider || 'openai';
    const status = result.status || result.persistenceStatus || 'completed';
    const placement = await settleCanvasImageEditCandidatesSequentially(candidates, async (candidate, placementIndex) => {
      const resultParameters = {
        editMode: 'inpaint',
        maskApplied: true,
        maskCoveragePercent: payload.maskCoveragePercent,
        maskWidth: payload.maskWidth,
        maskHeight: payload.maskHeight,
        externalInpaintRequestCount: 1,
        requestedCandidateCount: result.requestedCandidateCount,
        persistedCandidateCount: result.persistedCandidateCount,
        backendProvider,
        backendJobId: candidate.jobId,
        backendImageId: candidate.imageId,
        backendStoragePath: candidate.storagePath,
        provider,
        status,
        batchId,
        candidateIndex: candidate.candidateIndex,
        jobId: candidate.jobId,
        imageId: candidate.imageId,
        storagePath: candidate.storagePath,
        persistenceStatus: candidate.persistenceStatus,
      };
      return addImageToCanvas(candidate.imageUrl, `部分編集結果 ${placementIndex + 1}`, {
        parentId: partialEditingObjectId ?? undefined,
        parentObjectId: partialEditingObjectId ?? undefined,
        generation,
        feature: 'partial-edit',
        prompt: payload.prompt,
        maskApplied: true,
        backendProvider,
        provider,
        status,
        jobId: candidate.jobId,
        imageId: candidate.imageId,
        storagePath: candidate.storagePath,
        persistenceStatus: candidate.persistenceStatus,
        parameters: resultParameters,
        ...buildDerivedLightchainMetadata(sourceObject, 'partial-edit', {
          prompt: payload.prompt,
          parameters: resultParameters,
        }),
      }, partialEditingObjectId ?? undefined, preloadedImagesById.get(candidate.imageId));
    });
    if (placement.placed.length !== 4 || placement.failed.length > 0) {
      placement.placed.forEach(({ value: objectId }) => useCanvasStore.getState().deleteObject(objectId));
      throw new Error(`partial_edit_canvas_candidate_placement_incomplete:${placement.placed.length}/4`);
    }
    const batchProof = buildCanvasImageEditBatchProof({
      batchId,
      parentObjectId: partialEditingObjectId,
      preResultCount: canvasGenerationState.partialEditResultCount,
      candidates: placement.placed.map(({ candidate }) => candidate),
    });
    placement.placed.forEach(({ value: objectId }) => {
      const placedObject = useCanvasStore.getState().objects.find((object) => object.id === objectId);
      if (!placedObject?.metadata) return;
      updateObject(objectId, {
        metadata: {
          ...placedObject.metadata,
          parameters: {
            ...placedObject.metadata.parameters,
            batchProof,
          },
        },
      });
    });

    setShowPartialEditModal(false);
    setPartialEditingImage(null);
    setPartialEditingObjectId(null);
  };

  const handleEditModalAction = async (action: string, params: { prompt?: string; maskDataUrl?: string }) => {
    if (!editingImage) return false;
    if (!currentBrand?.id) {
      toast.error('ブランドを選択してから実行してください');
      return false;
    }
    if (!rightsConfirmed) {
      toast.error('素材の利用権利を確認してください');
      return false;
    }
    const sourceObject = editingObjectId
      ? objects.find((item) => item.id === editingObjectId) ?? null
      : null;
    const lightchainEditMetadata = buildLightchainEditMetadata(editingObjectId);
    const baseMetadata = {
      parentId: editingObjectId ?? undefined,
      generation: (sourceObject?.metadata?.generation || 0) + 1,
    };
    try {
      const editSource = sourceObject
        ? await resolveCanvasObjectImageUrl(sourceObject)
        : await resolveGeneratedImageUrl(editingImage);
      if (action === 'prompt') {
        if (!params.prompt?.trim()) {
          toast.error('編集したい内容を入力してください');
          return false;
        }
        if (validateLegalSafetyInput([params.prompt]).blocked) {
          toast.error(BRAND_LIKENESS_BLOCK_COPY);
          return false;
        }
        const result = await editImageWithPrompt(editSource, params.prompt, currentBrand.id, { rightsConfirmed });
        assertCompletedImageEditResult(result, 'canvas_prompt_edit_result');
        const placed = await addImageToCanvasSafely(result.imageUrl, '編集結果', {
          ...baseMetadata,
          feature: 'prompt-edit',
          prompt: params.prompt,
          ...buildDerivedLightchainMetadata(sourceObject, 'prompt-edit', { prompt: params.prompt }),
        }, editingObjectId ?? undefined);
        if (!placed) throw new Error('canvas_derived_result_placement_failed');
        return true;
      }

      if (action === 'inpaint') {
        if (inpaintAttemptRef.current.attempted) {
          throw new Error('inpaint_retry_blocked_after_external_request');
        }
        if (!params.prompt?.trim()) {
          toast.error('編集したい内容を入力してください');
          return false;
        }
        if (!params.maskDataUrl) {
          toast.error('編集する範囲をブラシで指定してください');
          return false;
        }
        if (validateLegalSafetyInput([params.prompt]).blocked) {
          toast.error(BRAND_LIKENESS_BLOCK_COPY);
          return false;
        }
        const idempotencyKey = `heavy-canvas-inpaint-${crypto.randomUUID()}`;
        inpaintAttemptRef.current = { attempted: true, idempotencyKey };
        const result = await editImageWithPrompt(editSource, params.prompt, currentBrand.id, {
          rightsConfirmed,
          maskDataUrl: params.maskDataUrl,
          parentObjectId: editingObjectId,
          generation: baseMetadata.generation,
          maskApplied: true,
          idempotencyKey,
          ...lightchainEditMetadata,
        });
        const candidates = normalizeCanvasImageEditCandidates(result);
        const hasCompleteCandidateBatch = result.requestedCandidateCount === 4
          && result.persistedCandidateCount === 4
          && result.persistenceStatus === 'completed'
          && (result.failedCandidates?.length ?? 0) === 0
          && candidates.length === 4;
        if (!result.success || !hasCompleteCandidateBatch) {
          throw new Error([
            'inpaint_candidate_batch_incomplete',
            `requested=${result.requestedCandidateCount ?? 'unknown'}`,
            `persisted=${result.persistedCandidateCount ?? 'unknown'}`,
            `normalized=${candidates.length}`,
            `status=${result.persistenceStatus ?? 'unknown'}`,
          ].join(':'));
        }
        const batchId = candidates[0].jobId;
        const preloadedImages = await Promise.all(candidates.map(async (candidate) => ({
          candidate,
          image: await loadCanvasImage(candidate.imageUrl),
        })));
        const preloadedImagesById = new Map(preloadedImages.map(({ candidate, image }) => [candidate.imageId, image]));
        const backendProvider = result.backendProvider ?? 'supabase-edge-function';
        const provider = result.provider ?? 'openai';
        const status = result.status ?? result.persistenceStatus ?? 'completed';
        const placement = await settleCanvasImageEditCandidatesSequentially(candidates, async (candidate, placementIndex) => (
          await addImageToCanvas(candidate.imageUrl, `部分編集結果 ${placementIndex + 1}`, {
            ...baseMetadata,
            parentObjectId: editingObjectId ?? null,
            feature: 'inpaint',
            prompt: params.prompt,
            maskApplied: true,
            backendProvider,
            provider,
            status,
            jobId: candidate.jobId,
            imageId: candidate.imageId,
            storagePath: candidate.storagePath,
            persistenceStatus: candidate.persistenceStatus,
            parameters: {
              backendJobId: candidate.jobId,
              backendImageId: candidate.imageId,
              backendStoragePath: candidate.storagePath,
              backendProvider,
              provider,
              status,
              persistenceStatus: candidate.persistenceStatus,
              externalInpaintRequestCount: 1,
              requestedCandidateCount: result.requestedCandidateCount,
              persistedCandidateCount: result.persistedCandidateCount,
              batchId,
              candidateIndex: candidate.candidateIndex,
              idempotencyKey,
            },
            ...buildDerivedLightchainMetadata(sourceObject, 'inpaint', {
              prompt: params.prompt,
              parameters: { batchId, candidateIndex: candidate.candidateIndex, idempotencyKey },
            }),
          }, editingObjectId ?? undefined, preloadedImagesById.get(candidate.imageId))
        ));
        if (placement.placed.length !== 4 || placement.failed.length > 0) {
          placement.placed.forEach(({ value: objectId }) => useCanvasStore.getState().deleteObject(objectId));
          const firstFailure = placement.failed[0]?.error;
          throw firstFailure instanceof Error
            ? firstFailure
            : new Error(`inpaint_canvas_candidate_placement_incomplete:${placement.placed.length}/4`);
        }
        const batchProof = buildCanvasImageEditBatchProof({
          batchId,
          parentObjectId: editingObjectId,
          preResultCount: canvasGenerationState.partialEditResultCount,
          candidates: placement.placed.map(({ candidate }) => candidate),
        });
        placement.placed.forEach(({ value: objectId }) => {
          const placedObject = useCanvasStore.getState().objects.find((object) => object.id === objectId);
          if (!placedObject?.metadata) return;
          updateObject(objectId, {
            metadata: {
              ...placedObject.metadata,
              parameters: {
                ...placedObject.metadata.parameters,
                batchProof,
              },
            },
          });
        });
        if (placement.failed.length > 0) {
          toast.error(`${placement.failed.length}件の候補をCanvasへ配置できませんでした`);
        }
        return true;
      }

      if (action === 'remove-bg') {
        const { data, error } = await supabase.functions.invoke('remove-background', {
          body: { imageUrl: editSource, brandId: currentBrand.id, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata },
        });
        if (error) throw error;
        assertDerivedImageResult(data, 'removeBackground');
        const placed = await addImageToCanvasSafely(data.resultUrl, '背景削除', {
          ...baseMetadata,
          feature: 'remove-background',
          ...buildDerivedLightchainMetadata(sourceObject, 'remove-background'),
        }, editingObjectId ?? undefined);
        if (!placed) throw new Error('canvas_derived_result_placement_failed');
        return true;
      }

      if (action === 'colorize') {
        if (params.prompt && validateLegalSafetyInput([params.prompt]).blocked) {
          toast.error(BRAND_LIKENESS_BLOCK_COPY);
          return false;
        }
        const colors = params.prompt?.split(/[、,\\s]+/).map((item) => item.trim()).filter(Boolean);
        const { data, error } = await supabase.functions.invoke('colorize', {
          body: { imageUrl: editSource, brandId: currentBrand.id, colors: colors?.length ? colors : undefined, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata },
        });
        if (error) throw error;
        assertDerivedImageResult(data, 'colorize');
        const placement = await placeDerivedImages((data?.variations ?? []).map((variation: any) => {
          const parameters = { color: variation.colorName || variation.color };
          return {
            imageUrl: variation.imageUrl,
            label: variation.colorName || variation.color || 'カラバリ',
            parentId: editingObjectId ?? undefined,
            metadata: {
            ...baseMetadata,
            feature: 'colorize',
            parameters,
            ...buildDerivedLightchainMetadata(sourceObject, 'colorize', { parameters }),
            },
          };
        }));
        if (placement.succeeded === 0) throw new Error('canvas_derived_result_placement_failed');
        if (placement.succeeded < placement.total) {
          toast.error(`${placement.total - placement.succeeded}件のカラバリをCanvasへ配置できませんでした`);
        }
        return true;
      }

      if (action === 'upscale') {
        const { data, error } = await supabase.functions.invoke('upscale', {
          body: { imageUrl: editSource, brandId: currentBrand.id, scale: 2, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata },
        });
        if (error) throw error;
        assertDerivedImageResult(data, 'upscale');
        const placed = await addImageToCanvasSafely(data.resultUrl, '高解像度', {
          ...baseMetadata,
          feature: 'upscale',
          ...buildDerivedLightchainMetadata(sourceObject, 'upscale', { parameters: { scale: 2 } }),
        }, editingObjectId ?? undefined);
        if (!placed) throw new Error('canvas_derived_result_placement_failed');
        return true;
      }

      if (action === 'variations') {
        if (params.prompt && validateLegalSafetyInput([params.prompt]).blocked) {
          toast.error(BRAND_LIKENESS_BLOCK_COPY);
          return false;
        }
        const { data, error } = await supabase.functions.invoke('generate-variations', {
          body: { imageUrl: editSource, brandId: currentBrand.id, prompt: params.prompt || undefined, count: 4, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata },
        });
        if (error) throw error;
        assertDerivedImageResult(data, 'variations');
        const placement = await placeDerivedImages((data?.variations ?? []).map((variation: any, index: number) => ({
          imageUrl: variation.imageUrl,
          label: `バリエーション ${index + 1}`,
          parentId: editingObjectId ?? undefined,
          metadata: {
            ...baseMetadata,
            feature: 'generate-variations',
            prompt: params.prompt,
            ...buildDerivedLightchainMetadata(sourceObject, 'generate-variations', {
              prompt: params.prompt,
              parameters: { index: index + 1 },
            }),
          },
        })));
        if (placement.succeeded === 0) throw new Error('canvas_derived_result_placement_failed');
        if (placement.succeeded < placement.total) {
          toast.error(`${placement.total - placement.succeeded}件のバリエーションをCanvasへ配置できませんでした`);
        }
        return true;
      }
      return false;
    } catch (error: any) {
      throw new Error(await edgeFunctionErrorMessage(error));
    }
  };

  const renderGenerateForm = () => {
    switch (generateMode) {
      case 'gacha':
        return (
          <div className="space-y-4">
            <Textarea
              label="ブリーフ（商品コンセプト）"
              placeholder="例: 20代女性向けのカジュアルなサマードレス"
              value={generatePrompt}
              onChange={(e) => setGeneratePrompt(e.target.value)}
              rows={3}
            />
            <ImageSelector
              label="参考画像（任意）"
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['style', 'base']}
              defaultReferenceType="style"
              hint="スタイルの参考またはベース画像として使用します"
            />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              ミニマル、ラグジュアリー、ストリート等の8スタイルから4つを生成します
            </p>
          </div>
        );

      case 'product-shots':
        return (
          <div className="space-y-4">
            <Textarea
              label="商品説明"
              placeholder="例: 白いコットンTシャツ、クルーネック"
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={3}
            />
            <ImageSelector
              label="実物商品画像（任意）"
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base', 'style']}
              defaultReferenceType="base"
              hint="アップロードすると、この画像を元に4方向のカットを生成します"
            />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              正面・側面・背面・ディテールの4カットを生成します
            </p>
          </div>
        );

      case 'model-matrix':
        return (
          <div className="space-y-4">
            <Textarea
              label="商品説明"
              placeholder="例: ネイビーのスリムフィットジーンズ"
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={3}
            />
            <ImageSelector
              label="商品画像（任意）"
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base', 'style']}
              defaultReferenceType="base"
              hint="モデルに着用させる商品の参考画像"
            />
            <ImageSelector
              label="着せたいモデル画像（任意）"
              value={modelReferenceImage}
              onChange={setModelReferenceImage}
              allowedReferenceTypes={['base', 'style']}
              defaultReferenceType="base"
              hint="商品画像も入っている場合、その人物・雰囲気を参照して着用画像を作ります"
            />
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">体型</label>
              <div className="flex gap-2 flex-wrap">
                {['slim', 'regular', 'plus'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedBodyTypes(prev =>
                      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                    )}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      selectedBodyTypes.includes(type)
                        ? 'bg-primary-100 dark:bg-primary-900/30 border-primary-300 text-primary-700 dark:text-primary-300'
                        : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:text-neutral-300'
                    }`}
                  >
                    {type === 'slim' ? 'スリム' : type === 'regular' ? 'レギュラー' : 'プラス'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">年代</label>
              <div className="flex gap-2 flex-wrap">
                {['20s', '30s', '40s', '50s'].map((age) => (
                  <button
                    key={age}
                    onClick={() => setSelectedAgeGroups(prev =>
                      prev.includes(age) ? prev.filter(a => a !== age) : [...prev, age]
                    )}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      selectedAgeGroups.includes(age)
                        ? 'bg-primary-100 dark:bg-primary-900/30 border-primary-300 text-primary-700 dark:text-primary-300'
                        : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:text-neutral-300'
                    }`}
                  >
                    {age}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      case 'multilingual':
        return (
          <div className="space-y-4">
            <Input
              label="ヘッドライン"
              placeholder="例: SUMMER SALE"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
            <Input
              label="サブヘッドライン（任意）"
              placeholder="例: 最大50%OFF"
              value={subheadline}
              onChange={(e) => setSubheadline(e.target.value)}
            />
            <ImageSelector
              label="ベース画像（任意）"
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base', 'style']}
              defaultReferenceType="base"
              hint="バナーの背景やベースとして使用します"
            />
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">言語</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { code: 'ja', name: '日本語' },
                  { code: 'en', name: 'English' },
                  { code: 'zh', name: '中文' },
                  { code: 'ko', name: '한국어' }
                ].map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => setSelectedLanguages(prev =>
                      prev.includes(lang.code) ? prev.filter(l => l !== lang.code) : [...prev, lang.code]
                    )}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      selectedLanguages.includes(lang.code)
                        ? 'bg-primary-100 dark:bg-primary-900/30 border-primary-300 text-primary-700 dark:text-primary-300'
                        : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:text-neutral-300'
                    }`}
                  >
                    {lang.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div className="space-y-4">
            <Textarea
              label="プロンプト"
              placeholder="生成したい画像を日本語で説明してください..."
              value={generatePrompt}
              onChange={(e) => setGeneratePrompt(e.target.value)}
              rows={4}
            />
            <ImageSelector
              label="参考画像（任意）"
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['style', 'composition']}
              defaultReferenceType="style"
              hint="スタイルや構図の参考として使用します"
            />
          </div>
        );
    }
  };

  const canvasPersistenceLabel = {
    unsaved: '未保存の変更',
    loading: 'サーバーから読込中',
    saving: '保存中',
    verifying: '保存を確認中',
    saved: 'サーバー確認済み',
    conflict: '競合: 再読込が必要',
    failed: '保存失敗・再試行',
  }[canvasPersistenceStatus];

  return (
    <div className="h-screen flex flex-col bg-[#050808] text-white">
      {/* Header */}
      <header className="h-12 sm:h-14 flex items-center justify-between border-b border-white/10 bg-[#070b0b]/95 px-2 sm:px-4 z-20 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
          <button
            onClick={() => navigate('/dashboard')}
            className="p-1.5 sm:p-2 hover:bg-white/[0.08] rounded-lg transition-colors text-neutral-300 flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <div className="min-w-0 flex-1">
            {isEditingName ? (
              <input
                ref={projectNameInputRef}
                type="text"
                value={currentProjectName}
                onChange={handleNameChange}
                onBlur={handleNameBlur}
                onKeyDown={handleNameKeyDown}
                className="text-sm sm:text-base font-semibold text-white bg-transparent border-b border-cyan-300 outline-none px-0 py-0.5 w-full max-w-[150px] sm:max-w-[200px]"
              />
            ) : (
              <h1
                onClick={() => setIsEditingName(true)}
                className="text-sm sm:text-base font-semibold text-white cursor-pointer hover:text-cyan-200 transition-colors truncate"
              >
                {currentProjectName || '無題'}
              </h1>
            )}
            <p className="text-[10px] sm:text-xs text-neutral-400 truncate">
              <span data-testid="canvas-persistence-status">キャンバス · {canvasPersistenceLabel}</span>
              <span aria-hidden="true"> · </span>
              <span
                data-testid="canvas-current-brand"
                aria-label={`現在のブランド: ${currentBrand?.name?.trim() || '未選択'}`}
                className={currentBrand?.name?.trim() ? 'text-cyan-200' : 'text-amber-200'}
              >
                ブランド: {currentBrand?.name?.trim() || '未選択'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          {/* View mode toggle - hidden on mobile */}
          <div className="hidden sm:flex items-center rounded-lg border border-white/10 bg-white/[0.06] p-1">
            <button
              onClick={() => setViewMode('canvas')}
              className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                viewMode === 'canvas'
                  ? 'bg-cyan-300 text-neutral-950 shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block sm:mr-1.5" />
              <span className="hidden sm:inline">キャンバス</span>
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                viewMode === 'tree'
                  ? 'bg-cyan-300 text-neutral-950 shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block sm:mr-1.5" />
              <span className="hidden sm:inline">派生ツリー</span>
            </button>
          </div>

          <div className="hidden sm:block w-px h-6 bg-white/10 mx-1 sm:mx-2" />

          {/* Active user avatar - shows current logged in user */}
          <div className="hidden md:flex -space-x-2 items-center">
            <div
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-cyan-300/30 bg-cyan-300/15 flex items-center justify-center overflow-hidden shadow-sm"
              title={profile?.name || user?.email || 'ユーザー'}
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[10px] sm:text-xs font-medium text-white">
                  {profile?.name?.[0] || user?.email?.[0]?.toUpperCase() || 'U'}
                </span>
              )}
            </div>
            {/* Online indicator */}
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-white dark:border-neutral-800 -ml-1 -mt-4" />
          </div>

          {/* Invite button - hidden on mobile */}
          <Button
            variant="secondary"
            size="sm"
            className="hidden md:flex shadow-sm text-xs sm:text-sm px-2 sm:px-3"
            onClick={() => setShowInviteModal(true)}
          >
            <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">招待</span>
          </Button>

          <Button size="sm" className="shadow-glow hover:shadow-glow-lg text-xs sm:text-sm px-2 sm:px-3" onClick={() => void handleSave()} disabled={canvasPersistenceStatus === 'loading' || canvasPersistenceStatus === 'saving' || canvasPersistenceStatus === 'verifying'}>
            <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">保存</span>
          </Button>
          {(canvasPersistenceStatus === 'conflict' || canvasPersistenceStatus === 'failed') && remoteDocumentIdRef.current && (
            <Button
              variant="secondary"
              size="sm"
              data-testid="canvas-reload-remote"
              className="text-xs sm:text-sm px-2 sm:px-3"
              onClick={() => void handleReloadRemote()}
            >
              <span className="hidden sm:inline">最新状態を再読込</span>
              <span className="sm:hidden">再読込</span>
            </Button>
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Tools */}
        <aside className="w-10 sm:w-14 border-r border-white/10 bg-[#070b0b] flex flex-col items-center py-2 sm:py-4 gap-1 sm:gap-2 z-10">
          <input
            ref={localUploadInputRef}
            type="file"
            id="file-upload"
            accept="image/*"
            multiple
            onInputCapture={handleFileUpload}
            onChangeCapture={handleFileUpload}
            className="hidden"
          />
          <label
            htmlFor="file-upload"
            className="p-2 sm:p-3 hover:bg-white/[0.08] rounded-lg sm:rounded-xl cursor-pointer transition-colors text-neutral-300"
            title="画像をアップロード"
          >
            <Upload className="w-4 h-4 sm:w-5 sm:h-5" />
          </label>

          <button
            onClick={() => setShowGenerateModal(true)}
            className="p-2 sm:p-3 bg-cyan-300/15 hover:bg-cyan-300/25 rounded-lg sm:rounded-xl transition-colors text-cyan-200"
            title="AI画像生成"
          >
            <Wand2 className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <div className="w-6 sm:w-8 h-px bg-white/10 my-1 sm:my-2" />

          {/* Side panel toggles */}
          <button
            onClick={() => setSidePanel(sidePanel === 'chat' ? null : 'chat')}
            className={`p-2 sm:p-3 rounded-lg sm:rounded-xl transition-colors ${
              sidePanel === 'chat'
                ? 'bg-cyan-300/15 text-cyan-200'
                : 'hover:bg-white/[0.08] text-neutral-300'
            }`}
            title="チャットエディター"
          >
            <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <button
            onClick={() => setSidePanel(sidePanel === 'templates' ? null : 'templates')}
            className={`p-2 sm:p-3 rounded-lg sm:rounded-xl transition-colors ${
              sidePanel === 'templates'
                ? 'bg-cyan-300/15 text-cyan-200'
                : 'hover:bg-white/[0.08] text-neutral-300'
            }`}
            title="テンプレート"
          >
            <Layout className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {selectedObject && (
            <button
              onClick={() => setSidePanel(sidePanel === 'properties' ? null : 'properties')}
              className={`p-2 sm:p-3 rounded-lg sm:rounded-xl transition-colors ${
                sidePanel === 'properties'
                  ? 'bg-cyan-300/15 text-cyan-200'
                  : 'hover:bg-white/[0.08] text-neutral-300'
              }`}
              title="プロパティ"
            >
              <Settings2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          )}
        </aside>

        {/* Canvas area */}
        <main className="flex-1 flex flex-col relative overflow-hidden">
          {/* Toolbar container - centered on desktop, full width on mobile */}
          <div className="absolute top-2 sm:top-4 inset-x-2 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-10 flex max-w-[calc(100%-1rem)] justify-center pointer-events-none">
            <div className="pointer-events-auto max-w-full rounded-lg sm:rounded-xl border border-white/10 bg-[#101313]/95 p-0 sm:p-1 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur">
              <CanvasToolbar
                onAddText={handleAddText}
                onAddShape={handleAddShape}
                onAddFrame={handleAddFrame}
                onExport={handleExportCanvas}
              />
            </div>
          </div>

          <div ref={containerRef} className="flex-1 relative bg-[#050808]">
            <div
              data-testid="mobile-canvas-fit-proof"
              data-passed={mobileCanvasFitProof.passed ? 'true' : 'false'}
              data-proof={JSON.stringify(mobileCanvasFitProof)}
              className="sr-only"
            />
            <div
              data-testid="canvas-generation-state"
              data-proof={JSON.stringify(canvasGenerationState)}
              data-derived-result-count={canvasGenerationState.derivedResultCount}
              data-partial-edit-result-count={canvasGenerationState.partialEditResultCount}
              data-max-generation={canvasGenerationState.maxGeneration}
              className="sr-only"
            />
            <div
              data-testid="canvas-local-upload-readback"
              data-status={localUploadState.status}
              data-persistence-status={localUploadState.persistenceStatus}
              data-object-id={localUploadState.objectId ?? ''}
              data-source-revision={localUploadState.sourceRevision ?? ''}
              data-error={localUploadState.error ?? ''}
              data-error-code={localUploadState.errorCode ?? ''}
              className="sr-only"
            />
            {localRestoreState.status !== 'idle' && (
              <div
                data-testid="canvas-local-restore-state"
                data-status={localRestoreState.status}
                data-object-count={localRestoreState.objectCount}
                data-missing-count={localRestoreState.missingCount}
                className={`absolute left-2 right-2 top-16 z-20 mx-auto flex max-w-3xl items-center gap-3 rounded-xl border px-3 py-2 text-xs shadow-lg backdrop-blur sm:left-20 sm:right-auto sm:max-w-xl ${
                  localRestoreState.status === 'missing'
                    ? 'border-amber-300/35 bg-amber-950/85 text-amber-100'
                    : localRestoreState.status === 'restoring'
                      ? 'border-cyan-300/25 bg-cyan-950/85 text-cyan-100'
                      : 'border-emerald-300/25 bg-emerald-950/85 text-emerald-100'
                }`}
              >
                <span className="font-semibold">
                  {localRestoreState.status === 'restoring'
                    ? 'ローカル画像を復元中…'
                    : localRestoreState.status === 'missing'
                      ? '一部のローカル画像を復元できません'
                      : 'ローカル画像を復元しました'}
                </span>
                <span className="min-w-0 flex-1 text-[11px] opacity-80">
                  {localRestoreState.status === 'missing'
                    ? '元画像をもう一度アップロードしてください。'
                    : `${localRestoreState.objectCount}件の画像をこのブラウザの保存領域から確認しました。`}
                </span>
                {localRestoreState.status === 'missing' && (
                  <label
                    htmlFor="file-upload"
                    className="shrink-0 cursor-pointer rounded-lg border border-amber-200/40 px-2 py-1 font-semibold hover:bg-amber-200/10"
                  >
                    再アップロード
                  </label>
                )}
              </div>
            )}
            {/* 背景パターン - position:fixedで固定し、サイドパネル開閉時に動かない */}
            <div className="fixed inset-0 pointer-events-none bg-[#050808]" style={{ zIndex: 0 }}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(103,232,249,0.14)_1px,transparent_1px)] bg-[length:24px_24px]" />
              <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:96px_96px]" />
            </div>

            {objects.length === 0 && (
              <div className="pointer-events-none absolute inset-x-4 top-24 z-[1] mx-auto max-w-3xl rounded-[28px] border border-white/10 bg-[#090a0a]/90 p-6 text-center shadow-[0_24px_90px_rgba(0,0,0,0.4)] backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Canvas</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">画像を置いて、機能を選ぶ</h2>
                <p className="mt-3 text-sm leading-6 text-neutral-400">
                  商品画像や生成結果を置くと、背景削除、色変更、高解像度化、派生生成、指示編集を画像に直接かけられます。
                </p>
              </div>
            )}

            {!selectedObject && (
              <div className="absolute left-2 right-2 top-16 z-10 mx-auto max-w-5xl rounded-2xl border border-white/10 bg-[#0f1212]/95 p-2 shadow-[0_18px_70px_rgba(0,0,0,0.4)] backdrop-blur sm:left-20 sm:right-auto sm:w-[720px]">
                <div className="grid gap-2 sm:grid-cols-6">
                  {canvasImageActions.map((action) => {
                    const Icon = action.icon;
                    const disabled = action.requiresSelection;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => {
                          if (action.id === 'generate') {
                            setShowGenerateModal(true);
                            return;
                          }
                          void handleFloatingAction(action.id);
                        }}
                        disabled={disabled}
                        className="group flex min-h-16 flex-col justify-center rounded-xl border border-white/10 bg-white/[0.055] px-3 py-2 text-left transition hover:border-cyan-300/50 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <span className="flex items-center gap-2 text-xs font-semibold text-white">
                          <Icon className="h-4 w-4 text-cyan-300" />
                          {action.label}
                        </span>
                        <span className="mt-1 text-[11px] leading-4 text-neutral-400">{action.description}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 px-1 text-xs text-neutral-500">画像を選択すると、背景削除・色変更・派生などを直接かけられます。</p>
                <label className="mt-2 flex min-w-0 items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.06] px-2.5 py-2 text-xs text-cyan-100">
                  <input
                    type="checkbox"
                    checked={rightsConfirmed}
                    onChange={(event) => setRightsConfirmed(event.target.checked)}
                    className="h-4 w-4 shrink-0 rounded border-cyan-300 text-cyan-300 focus:ring-cyan-300"
                    disabled={isGenerating}
                  />
                  <span className="min-w-0 truncate font-semibold" title={UPLOAD_RIGHTS_CONFIRMATION_LABEL}>
                    {UPLOAD_RIGHTS_CONFIRMATION_LABEL}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-cyan-200/70">生成時にも確認</span>
                </label>
              </div>
            )}

            <div className="absolute bottom-2 left-2 right-2 z-10 grid grid-cols-2 gap-2 sm:bottom-4 sm:left-4 sm:right-auto sm:w-[560px] sm:grid-cols-4">
              <label
                htmlFor="file-upload"
                className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#101313]/95 px-3 py-2 text-xs font-semibold text-neutral-200 shadow-lg backdrop-blur transition hover:border-cyan-300/50 hover:bg-white/[0.08] hover:text-white"
              >
                <Upload className="h-4 w-4" />
                画像を置く
              </label>
              <button
                type="button"
                onClick={() => setShowGenerateModal(true)}
                className="flex items-center justify-center gap-2 rounded-xl border border-cyan-300 bg-cyan-300 px-3 py-2 text-xs font-semibold text-neutral-950 shadow-lg backdrop-blur transition hover:bg-cyan-200"
              >
                <Wand2 className="h-4 w-4" />
                生成する
              </button>
              <button
                type="button"
                onClick={() => navigate('/gallery')}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#101313]/95 px-3 py-2 text-xs font-semibold text-neutral-200 shadow-lg backdrop-blur transition hover:border-cyan-300/50 hover:bg-white/[0.08] hover:text-white"
              >
                <Image className="h-4 w-4" />
                素材を見る
              </button>
              <button
                type="button"
                onClick={() => setShowGallerySelector(true)}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#101313]/95 px-3 py-2 text-xs font-semibold text-neutral-200 shadow-lg backdrop-blur transition hover:border-cyan-300/50 hover:bg-white/[0.08] hover:text-white"
              >
                <Image className="h-4 w-4" />
                Galleryから追加
              </button>
            </div>

            {viewMode === 'canvas' ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
                    キャンバスを読み込み中...
                  </div>
                }
              >
                <>
                <InfiniteCanvas
                  width={canvasSize.width}
                  height={canvasSize.height}
                  onObjectSelect={handleObjectSelect}
                  onContextAction={handleContextAction}
											onStageReady={handleCanvasStageReady}
											preloadedImages={preloadedGalleryImagesRef.current}
											renderAllObjects={isExportRenderingAll}
											exportMode={isExportRenderingAll}
                  onRenderStateChange={(state) => {
                    canvasRenderStateRef.current = state;
                    console.warn('Canvas render state', state);
                    if (typeof document !== 'undefined') {
                      document.body.dataset.canvasRenderState = JSON.stringify(state);
                    }
                  }}
                />

                {selectedObject && (
                  <FloatingToolbar
                    selectedObject={selectedObject}
                    position={selectedPosition}
                    onAction={handleFloatingAction}
                  />
                )}

                {/* Minimap - hidden on mobile */}
                <div className="hidden sm:block absolute bottom-2 sm:bottom-4 right-2 sm:right-4 z-10">
                  <div className="rounded-lg sm:rounded-xl overflow-hidden border border-white/10 bg-[#101313]/95 shadow-lg">
                    <Minimap
                      canvasWidth={canvasSize.width}
                      canvasHeight={canvasSize.height}
                    />
                  </div>
                </div>
                </>
              </Suspense>
            ) : (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
                    派生ツリーを読み込み中...
                  </div>
                }
              >
                <DerivationTree />
              </Suspense>
            )}
          </div>
        </main>

        {/* Right sidebar - overlay on mobile, panel on desktop */}
        <AnimatePresence mode="sync">
          {sidePanel && (
            <>
              {/* Mobile overlay backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setSidePanel(null)}
                className="md:hidden fixed inset-0 bg-black/50 z-20"
              />
              <motion.aside
                initial={{ x: '100%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '100%', opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="fixed right-0 top-12 sm:top-14 bottom-0 w-[85vw] max-w-[320px] md:w-80 border-l border-white/10 bg-[#090a0a]/98 flex flex-col overflow-hidden z-30 shadow-[0_24px_90px_rgba(0,0,0,0.55)]"
              >
                <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-white/10">
                  <h2 className="font-semibold text-sm sm:text-base text-white">
                    {sidePanel === 'properties' && 'プロパティ'}
                    {sidePanel === 'chat' && 'チャット'}
                    {sidePanel === 'templates' && 'テンプレート'}
                  </h2>
                  <button
                    onClick={() => setSidePanel(null)}
                    className="p-1.5 sm:p-1 hover:bg-white/[0.08] rounded transition-colors text-neutral-400"
                  >
                    <X className="w-5 h-5 sm:w-4 sm:h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 sm:p-4">
                  {sidePanel === 'properties' && (
                    <PropertiesPanel selectedObject={selectedObject} />
                  )}
                  {sidePanel === 'chat' && (
                    <ChatEditor
                      selectedImageUrl={selectedObject?.type === 'image' ? (selectedObject as any).src : undefined}
                      onEditResult={handleChatEditResult}
                    />
                  )}
                  {sidePanel === 'templates' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-900">
                        {[
                          { id: 'size' as const, label: 'サイズ' },
                          { id: 'design' as const, label: 'デザイン' },
                        ].map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => setTemplateMode(mode.id)}
                            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                              templateMode === mode.id
                                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white'
                                : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white'
                            }`}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                      <TemplateSelector
                        mode={templateMode}
                        onSelectSize={handleTemplateSelect}
                        onSelectDesign={handleDesignTemplateSelect}
                        selectedSizeId={selectedSizeTemplateId}
                        selectedDesignId={selectedDesignTemplateId}
                      />
                    </div>
                  )}
              </div>
            </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Generate Modal */}
      <Modal
        isOpen={showGenerateModal}
        onClose={() => {
          setShowGenerateModal(false);
          setReferenceImage(null);
        }}
        title="AI画像生成"
        size="lg"
      >
        <div className="space-y-6">
          {/* Mode selector */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
              生成モード
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {GENERATE_MODES.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setGenerateMode(mode.id as GenerateMode)}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                    generateMode === mode.id
                      ? 'border-cyan-300 bg-cyan-300/15'
                      : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600'
                  }`}
                >
                  <mode.icon className={`w-5 h-5 mb-2 ${
                    generateMode === mode.id ? 'text-cyan-300' : 'text-neutral-500 dark:text-neutral-400'
                  }`} />
                  <div className="font-medium text-sm text-neutral-800 dark:text-white">{mode.name}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{mode.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic form */}
          {renderGenerateForm()}
          <label className="flex items-start gap-3 rounded-xl border border-cyan-300/35 bg-cyan-300/[0.08] p-3 text-xs text-cyan-100">
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(event) => setRightsConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-cyan-300 text-cyan-300 focus:ring-cyan-300"
              disabled={isGenerating}
            />
            <span>
              <span className="block font-semibold">{UPLOAD_RIGHTS_CONFIRMATION_LABEL}</span>
              <span className="mt-1 block leading-5">{GENERATION_LEGAL_COPY}</span>
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-4 border-t border-neutral-100 dark:border-neutral-800">
            <Button
              variant="secondary"
              onClick={() => {
                setShowGenerateModal(false);
                setReferenceImage(null);
              }}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || (generateMode === 'model-matrix' && selectedBodyTypes.length * selectedAgeGroups.length > MAX_MODEL_MATRIX_PATTERNS)}
              leftIcon={isGenerating ? undefined : <Sparkles className="w-4 h-4" />}
              className="shadow-glow"
            >
              {isGenerating ? '生成中...' : '生成'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Invite Modal */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="コラボレーターを招待"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            メールアドレスを入力して、このプロジェクトに招待しましょう。
          </p>
          <Input
            label="メールアドレス"
            type="email"
            placeholder="collaborator@example.com"
            autoComplete="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-4 border-t border-neutral-100 dark:border-neutral-800">
            <Button
              variant="secondary"
              onClick={() => setShowInviteModal(false)}
            >
              キャンセル
            </Button>
            <Button
              onClick={() => {
                if (inviteEmail) {
                  toast.success(`${inviteEmail} に招待を送信しました`);
                  setInviteEmail('');
                  setShowInviteModal(false);
                } else {
                  toast.error('メールアドレスを入力してください');
                }
              }}
              leftIcon={<Users className="w-4 h-4" />}
            >
              招待を送信
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      {showEditModal && editingImage && (
        <ImageEditModal
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setEditingImage(null);
            setEditingObjectId(null);
          }}
          imageUrl={editingImage}
          onEdit={handleEditModalAction}
        />
      )}

      {showPartialEditModal && partialEditingImage && (
        <PartialEditModal
          isOpen={showPartialEditModal}
          imageUrl={partialEditingImage}
          onClose={() => {
            setShowPartialEditModal(false);
            setPartialEditingImage(null);
            setPartialEditingObjectId(null);
          }}
          onSubmit={handlePartialEditSubmit}
        />
      )}

      <GallerySelector
        isOpen={showGallerySelector}
        onClose={() => setShowGallerySelector(false)}
        onSelect={handleSelectGalleryImage}
      />

      {/* Canvas Guide for first-time users */}
      {showGuide && <CanvasGuide onComplete={completeGuide} userId={user?.id} />}
    </div>
  );
}
