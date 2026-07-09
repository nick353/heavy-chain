import { lazy, Suspense, useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  CircleHelp,
  Palette,
  Maximize2,
  CopyPlus
} from 'lucide-react';
import { InfiniteCanvas } from '../components/canvas/InfiniteCanvas';
import { CanvasToolbar } from '../components/canvas/CanvasToolbar';
import { FloatingToolbar } from '../components/canvas/FloatingToolbar';
import { Minimap } from '../components/canvas/Minimap';
import { PropertiesPanel } from '../components/canvas/PropertiesPanel';
import { ImageEditModal } from '../components/canvas/ImageEditModal';
import { CanvasGuide, useCanvasGuide } from '../components/canvas/CanvasGuide';
import { useCanvasStore } from '../stores/canvasStore';
import { ChatEditor } from '../components/ChatEditor';
import { GallerySelector } from '../components/GallerySelector';
import { TemplateSelector, type DesignTemplate, type SizeTemplate } from '../components/TemplateSelector';
import { Button, Modal, Textarea, Input } from '../components/ui';
import { ImageSelector, type SelectedImage } from '../components/ImageSelector';
import { supabase } from '../lib/supabase';
import { resolveGeneratedImageUrl } from '../lib/storage';
import { editImageWithPrompt } from '../lib/imageApi';
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

type ViewMode = 'canvas' | 'tree';
type SidePanel = 'properties' | 'chat' | 'templates' | null;
type GenerateMode = 'basic' | 'gacha' | 'product-shots' | 'model-matrix' | 'multilingual';
type LightchainEditAction = 'remove-background' | 'colorize' | 'upscale' | 'generate-variations' | 'prompt-edit';
type CanvasTemplateMode = 'size' | 'design';
type CanvasRenderState = { totalImageObjects: number; loadedImageObjects: number; renderAllObjects: boolean };
const GENERATED_CANVAS_HANDOFF_KEY = 'heavy-chain-generated-canvas-handoff';
const MAX_MODEL_MATRIX_PATTERNS = 3;
const DerivationTree = lazy(() =>
  import('../components/canvas/DerivationTree').then((module) => ({ default: module.DerivationTree }))
);

const LIGHTCHAIN_EDIT_ACTION_LABELS: Record<LightchainEditAction, string> = {
  'remove-background': '背景削除・切り抜き',
  colorize: '色変更',
  upscale: '高解像度化',
  'generate-variations': 'デザインアレンジ',
  'prompt-edit': 'プロンプト編集',
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
  { id: 'generate', label: '新しく生成', description: 'Lightchain生成', icon: Sparkles, requiresSelection: false },
];

const isUsableLoadedImage = (image?: HTMLImageElement | null) => (
  Boolean(image?.complete) &&
  Boolean(image?.naturalWidth && image?.naturalHeight)
);

export function CanvasEditorPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const canvasStageRef = useRef<Konva.Stage | null>(null);
  const canvasRenderStateRef = useRef<CanvasRenderState>({ totalImageObjects: 0, loadedImageObjects: 0, renderAllObjects: false });
  const lastMobileFitKeyRef = useRef<string | null>(null);
  const { currentBrand, user, profile } = useAuthStore();
  const { showGuide, completeGuide, resetGuide } = useCanvasGuide(user?.id);

  const [viewMode, setViewMode] = useState<ViewMode>('canvas');
  // Start with no side panel on mobile, properties on desktop
  const [sidePanel, setSidePanel] = useState<SidePanel>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return null;
    }
    return 'properties';
  });
  const [templateMode, setTemplateMode] = useState<CanvasTemplateMode>('size');
  const [selectedSizeTemplateId, setSelectedSizeTemplateId] = useState<string | undefined>();
  const [selectedDesignTemplateId, setSelectedDesignTemplateId] = useState<string | undefined>();
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [selectedPosition, setSelectedPosition] = useState({ x: 0, y: 0 });
  const [isEditingName, setIsEditingName] = useState(false);
  const [isExportRenderingAll, setIsExportRenderingAll] = useState(false);
  const preloadedGalleryImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

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

  // Reference image states for generate modal
  const [referenceImage, setReferenceImage] = useState<SelectedImage | null>(null);
  const [modelReferenceImage, setModelReferenceImage] = useState<SelectedImage | null>(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingImage, setEditingImage] = useState<string | null>(null);
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);

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
    projects,
    loadProject,
    createProject,
    saveCurrentProject,
    renameProject,
    clearCanvas,
  } = useCanvasStore();

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (canvasSize.width >= 640 || canvasSize.width <= 0 || canvasSize.height <= 0 || objects.length === 0) return;

    const fitKey = `${currentProjectId || 'draft'}:${objects.map((obj) => `${obj.id}:${Math.round(obj.x)},${Math.round(obj.y)},${Math.round(obj.width * (obj.scaleX || 1))},${Math.round(obj.height * (obj.scaleY || 1))}`).join('|')}`;
    if (lastMobileFitKeyRef.current === fitKey) return;

    const visibleObjects = objects.filter((obj) => obj.visible !== false);
    if (visibleObjects.length === 0) return;

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
  }, [canvasSize.height, canvasSize.width, currentProjectId, objects, setPan, setZoom]);

  // Load project when projectId changes
  useEffect(() => {
    if (projectId && projectId !== 'new' && projectId !== currentProjectId) {
      const project = projects.find(p => p.id === projectId);
      if (project) {
        loadProject(projectId);
      } else {
        // Project not found, redirect to new
        navigate('/canvas/new', { replace: true });
      }
    } else if (projectId === 'new' && currentProjectId) {
      // Starting fresh
      clearCanvas();
    }
  }, [projectId, currentProjectId, projects, loadProject, clearCanvas, navigate]);

  const selectedObject = selectedIds.length === 1
    ? objects.find((obj) => obj.id === selectedIds[0]) || null
    : null;
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

  const getLightchainCompatForObject = (objectId: string | null) => {
    if (!objectId) return undefined;
    const object = objects.find((item) => item.id === objectId);
    return object?.metadata?.lightchainCompat;
  };

  const buildLightchainEditMetadata = (objectId: string | null) => {
    const lightchainCompat = getLightchainCompatForObject(objectId);
    return lightchainCompat ? { lightchainCompat } : {};
  };

  const buildDerivedLightchainMetadata = (
    sourceObject: typeof selectedObject,
    action: LightchainEditAction,
    options: { prompt?: string; parameters?: any } = {},
  ) => {
    const previousStages = Array.isArray(sourceObject?.metadata?.lightchainEditStages)
      ? sourceObject.metadata.lightchainEditStages
      : [];
    const lightchainCompat = sourceObject?.metadata?.lightchainCompat;
    if (!lightchainCompat && previousStages.length === 0) return {};

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
      toast.success(`プロジェクト名を更新しました`);
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

  const handleSave = () => {
    if (!currentProjectId && !currentProjectName) {
      // Need to create a project first
      const newId = createProject('無題のプロジェクト', currentBrand?.id);
      navigate(`/canvas/${newId}`, { replace: true });
      toast.success('プロジェクトを作成しました');
    } else {
      saveCurrentProject();
      toast.success('保存しました');
    }
  };

  const handleObjectSelect = useCallback((id: string | null) => {
    if (id && containerRef.current) {
      const obj = objects.find((o) => o.id === id);
      if (obj) {
        const { zoom, panX, panY } = useCanvasStore.getState();
        const x = obj.x * zoom + panX + (obj.width * zoom) / 2;
        const y = obj.y * zoom + panY;
        setSelectedPosition({ x, y });
      }
    }
  }, [objects]);

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new window.Image();
          img.onload = () => {
            addObject({
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
              src: event.target?.result as string,
            });
          };
          img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const loadCanvasImage = useCallback(async (imageUrl: string) => {
    const source = imageUrl.trim();

    if (!source) {
      return Promise.reject(new Error('画像URLが空です'));
    }

    const resolvedSource = await resolveGeneratedImageUrl(source);
    const loadDirect = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
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
      const objectUrl = window.URL.createObjectURL(blob);

      try {
        console.debug('Canvas image blob fallback object URL', { source, resolvedSource, objectUrl });
        return await loadDirect(objectUrl);
      } finally {
        window.URL.revokeObjectURL(objectUrl);
      }
    };

    if (!/^https?:/i.test(resolvedSource)) {
      return loadDirect(resolvedSource);
    }

    return loadDirect(resolvedSource).catch((error) => {
      console.warn('Canvas image direct path failed, trying blob fallback', { source, resolvedSource, error: String(error) });
      return loadViaBlob();
    }).catch((error) => {
      console.error('Canvas image load final failure', { source, resolvedSource, error: String(error) });
      throw error;
    });
  }, []);

  const addImageToCanvas = useCallback(async (imageUrl: string, label?: string, metadata?: any, parentId?: string, preloadedImage?: HTMLImageElement | null) => {
    const usablePreloadedImage = isUsableLoadedImage(preloadedImage) ? preloadedImage : null;
    const isGalleryImport = metadata?.source === 'gallery-selector';
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
      setZoom(1);
      setPan(0, 0);
    }
    return newId;
  }, [addObject, loadCanvasImage, selectObject, setPan, setZoom]);

  const addImageToCanvasSafely = useCallback((imageUrl: string, label?: string, metadata?: any, parentId?: string) => {
    void addImageToCanvas(imageUrl, label, metadata, parentId).catch((error: any) => {
      console.error('Canvas image load error:', error);
      toast.error(error?.message || '画像をCanvasへ配置できませんでした');
    });
  }, [addImageToCanvas]);

  const handleSelectGalleryImage = useCallback(async (imageUrl: string, imageId: string, storagePath?: string, imageElement?: HTMLImageElement | null) => {
    try {
      const usableImageElement = isUsableLoadedImage(imageElement) ? imageElement : null;
      if (usableImageElement) {
        preloadedGalleryImagesRef.current.set(imageUrl, usableImageElement);
        if (storagePath) {
          preloadedGalleryImagesRef.current.set(storagePath, usableImageElement);
        }
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
      images.forEach((image: any, index: number) => {
        if (typeof image?.imageUrl !== 'string' || !image.imageUrl) return;
        addImageToCanvasSafely(image.imageUrl, image.label || `生成結果 ${index + 1}`, {
          feature: image.feature || 'generate-image',
          prompt: image.prompt || '',
          generation: 0,
          parameters: {
            source: payload?.source || 'generate-results',
            resultId: image.resultId || null,
            jobId: image.jobId || null,
            imageId: image.imageId || null,
            storagePath: image.storagePath || null,
            artifactKind: image.artifactKind || null,
            handoffCreatedAt: payload?.createdAt || null,
            materialReferences: image.materialReferences || null,
            layerPlan: image.layerPlan || null,
            maskPlan: image.maskPlan || null,
            compositionPreview: image.compositionPreview || null,
          },
        });
      });
      if (images.length) {
        toast.success(`${images.length}件の生成結果をCanvasへ配置しました`);
      }
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
          if (data?.variations) {
            data.variations.forEach((v: any) => {
              addImageToCanvasSafely(v.imageUrl, v.directionName, {
                feature: 'design-gacha',
                prompt: generatePrompt,
                generation: 0,
                parameters: { direction: v.directionName },
              });
            });
            toast.success(`${data.variations.length}つのデザインを生成しました`);
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
          if (data?.shots) {
            data.shots.forEach((s: any) => {
              addImageToCanvasSafely(s.imageUrl, s.shotName, {
                feature: 'product-shots',
                prompt: productDescription,
                generation: 0,
                parameters: { shotType: s.shotType },
              });
            });
            toast.success('商品カット（4方向）を生成しました');
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
          if (data?.matrix) {
            data.matrix.forEach((m: any) => {
              addImageToCanvasSafely(m.imageUrl, `${m.bodyTypeName} × ${m.ageGroupName}`, {
                feature: 'model-matrix',
                prompt: productDescription,
                generation: 0,
                parameters: { bodyType: m.bodyType, ageGroup: m.ageGroup },
              });
            });
            toast.success(`${data.matrix.length}パターンのモデル画像を生成しました`);
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
          if (data?.banners) {
            data.banners.forEach((b: any) => {
              addImageToCanvasSafely(b.imageUrl, b.languageName, {
                feature: 'multilingual-banner',
                prompt: headline,
                generation: 0,
                parameters: { language: b.language, subheadline },
              });
            });
            toast.success(`${data.banners.length}言語のバナーを生成しました`);
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
          if (data?.images && data.images.length > 0) {
            data.images.forEach((img: any) => {
              addImageToCanvasSafely(img.imageUrl, undefined, {
                feature: 'generate-image',
                prompt: generatePrompt,
                generation: 0,
              });
            });
            toast.success('画像を生成しました');
          }
      }

      if (error) throw error;

      setShowGenerateModal(false);
      setGeneratePrompt('');
      setProductDescription('');
      setHeadline('');
      setSubheadline('');
      setReferenceImage(null);
    } catch (error: any) {
      console.error('Generation error:', error);
      toast.error(error.message || '画像生成に失敗しました');
    } finally {
      setIsGenerating(false);
    }
  };

  // Context menu and floating toolbar action handler - now with real API calls
  const handleContextAction = async (action: string, objectId: string | null) => {
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
        break;
      case 'delete':
        useCanvasStore.getState().deleteObject(objectId);
        toast.success('削除しました');
        break;
      case 'bringToFront':
        useCanvasStore.getState().bringToFront(objectId);
        break;
      case 'sendToBack':
        useCanvasStore.getState().sendToBack(objectId);
        break;
      case 'lock':
        updateObject(objectId, { locked: true });
        toast.success('ロックしました');
        break;
      case 'unlock':
        updateObject(objectId, { locked: false });
        toast.success('ロック解除しました');
        break;
      case 'hide':
        updateObject(objectId, { visible: false });
        toast.success('非表示にしました');
        break;
      case 'show':
        updateObject(objectId, { visible: true });
        toast.success('表示しました');
        break;
      case 'download':
        if (obj.type === 'image' && obj.src) {
          try {
            const resolvedSrc = await resolveGeneratedImageUrl(obj.metadata?.galleryStoragePath || obj.src);
            const response = await fetch(resolvedSrc);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${obj.label || 'image'}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            toast.success('ダウンロードしました');
          } catch {
            toast.error('ダウンロードに失敗しました');
          }
        }
        break;
    }

    // Handle AI actions for images
    if (obj.type !== 'image' || !obj.src) {
      if (action.startsWith('edit') || action.startsWith('remove') || action.startsWith('color') || action.startsWith('upscale') || action.startsWith('generate') || action.startsWith('design') || action.startsWith('product') || action.startsWith('model') || action.startsWith('multilingual') || action.startsWith('scene')) {
        toast.error('画像を選択してください');
      }
      return;
    }

    const imageSrc = obj.src;
    const lightchainEditMetadata = buildLightchainEditMetadata(objectId);
    if (!currentBrand?.id) {
      toast.error('ブランドを選択してから実行してください');
      return;
    }
    if (!rightsConfirmed) {
      toast.error('素材の利用権利を確認してください');
      return;
    }

    switch (action) {
      case 'removeBackground':
      case 'remove-bg':
        toast.loading('背景削除を実行中...', { id: 'remove-bg' });
        try {
          const { data, error } = await supabase.functions.invoke('remove-background', {
            body: { imageUrl: imageSrc, brandId: currentBrand.id, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata }
          });
          if (error) throw error;
          if (data?.resultUrl) {
            addImageToCanvasSafely(data.resultUrl, '背景削除', {
              feature: 'remove-background',
              parentId: objectId,
              generation: (obj.metadata?.generation || 0) + 1,
              ...buildDerivedLightchainMetadata(obj, 'remove-background'),
            }, objectId);
            toast.success('背景を削除しました', { id: 'remove-bg' });
          }
        } catch (err: any) {
          toast.error(err.message || '背景削除に失敗しました', { id: 'remove-bg' });
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
          if (data?.variations) {
            data.variations.forEach((v: any) => {
              const parameters = { color: v.colorName };
              addImageToCanvasSafely(v.imageUrl, v.colorName, {
                feature: 'colorize',
                parentId: objectId,
                generation: (obj.metadata?.generation || 0) + 1,
                parameters,
                ...buildDerivedLightchainMetadata(obj, 'colorize', { parameters }),
              }, objectId);
            });
            toast.success('カラバリを生成しました', { id: 'colorize' });
          }
        } catch (err: any) {
          toast.error(err.message || 'カラバリ生成に失敗しました', { id: 'colorize' });
        }
        break;

      case 'upscale':
        toast.loading('アップスケール中...', { id: 'upscale' });
        try {
          const { data, error } = await supabase.functions.invoke('upscale', {
            body: { imageUrl: imageSrc, brandId: currentBrand.id, scale: 2, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata }
          });
          if (error) throw error;
          if (data?.resultUrl) {
            addImageToCanvasSafely(data.resultUrl, '高解像度', {
              feature: 'upscale',
              parentId: objectId,
              generation: (obj.metadata?.generation || 0) + 1,
              ...buildDerivedLightchainMetadata(obj, 'upscale', { parameters: { scale: 2 } }),
            }, objectId);
            toast.success('アップスケールしました', { id: 'upscale' });
          }
        } catch (err: any) {
          toast.error(err.message || 'アップスケールに失敗しました', { id: 'upscale' });
        }
        break;

      case 'variations':
        toast.loading('バリエーションを生成中...', { id: 'variations' });
        try {
          const { data, error } = await supabase.functions.invoke('generate-variations', {
            body: { imageUrl: imageSrc, brandId: currentBrand.id, count: 4, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata }
          });
          if (error) throw error;
          if (data?.variations) {
            data.variations.forEach((v: any, i: number) => {
              addImageToCanvasSafely(v.imageUrl, `バリエーション ${i + 1}`, {
                feature: 'generate-variations',
                parentId: objectId,
                generation: (obj.metadata?.generation || 0) + 1,
                ...buildDerivedLightchainMetadata(obj, 'generate-variations', { parameters: { index: i + 1 } }),
              }, objectId);
            });
            toast.success('バリエーションを生成しました', { id: 'variations' });
          }
        } catch (err: any) {
          toast.error(err.message || 'バリエーション生成に失敗しました', { id: 'variations' });
        }
        break;

      case 'edit':
        setEditingImage(imageSrc);
        setEditingObjectId(objectId);
        setShowEditModal(true);
        break;

      case 'download':
        try {
          const response = await fetch(imageSrc);
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'image.png';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
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
    const stage = canvasStageRef.current;
    if (!stage) {
      toast.error('キャンバスの準備が完了していません');
      return;
    }
    const previousScale = stage.scale();
    const previousPosition = stage.position();
    try {
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

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${(currentProjectName || 'heavy-chain-canvas').replace(/[\\/:*?"<>|]+/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('CanvasをPNGで書き出しました');
    } catch (error) {
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

  const handleEditModalAction = async (action: string, params: { prompt?: string }) => {
    if (!editingImage) return;
    if (!currentBrand?.id) {
      toast.error('ブランドを選択してから実行してください');
      return;
    }
    if (!rightsConfirmed) {
      toast.error('素材の利用権利を確認してください');
      return;
    }
    const sourceObject = editingObjectId
      ? objects.find((item) => item.id === editingObjectId) ?? null
      : null;
    const lightchainEditMetadata = buildLightchainEditMetadata(editingObjectId);
    const baseMetadata = {
      parentId: editingObjectId ?? undefined,
      generation: (sourceObject?.metadata?.generation || 0) + 1,
    };

    if (action === 'prompt') {
      if (!params.prompt?.trim()) {
        toast.error('編集したい内容を入力してください');
        return;
      }
      if (validateLegalSafetyInput([params.prompt]).blocked) {
        toast.error(BRAND_LIKENESS_BLOCK_COPY);
        return;
      }
      const result = await editImageWithPrompt(editingImage, params.prompt, currentBrand.id, { rightsConfirmed });
      if (!result.success || !result.imageUrl) {
        throw new Error(result.error || '画像編集に失敗しました');
      }
      addImageToCanvasSafely(result.imageUrl, '編集結果', {
        ...baseMetadata,
        feature: 'prompt-edit',
        prompt: params.prompt,
        ...buildDerivedLightchainMetadata(sourceObject, 'prompt-edit', { prompt: params.prompt }),
      }, editingObjectId ?? undefined);
      setShowEditModal(false);
      setEditingImage(null);
      setEditingObjectId(null);
      return;
    }

    if (action === 'remove-bg') {
      const { data, error } = await supabase.functions.invoke('remove-background', {
        body: { imageUrl: editingImage, brandId: currentBrand.id, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata },
      });
      if (error) throw error;
      if (data?.resultUrl) {
        addImageToCanvasSafely(data.resultUrl, '背景削除', {
          ...baseMetadata,
          feature: 'remove-background',
          ...buildDerivedLightchainMetadata(sourceObject, 'remove-background'),
        }, editingObjectId ?? undefined);
      }
      return;
    }

    if (action === 'colorize') {
      if (params.prompt && validateLegalSafetyInput([params.prompt]).blocked) {
        toast.error(BRAND_LIKENESS_BLOCK_COPY);
        return;
      }
      const colors = params.prompt?.split(/[、,\\s]+/).map((item) => item.trim()).filter(Boolean);
      const { data, error } = await supabase.functions.invoke('colorize', {
        body: { imageUrl: editingImage, brandId: currentBrand.id, colors: colors?.length ? colors : undefined, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata },
      });
      if (error) throw error;
      data?.variations?.forEach((variation: any) => {
        const parameters = { color: variation.colorName || variation.color };
        addImageToCanvasSafely(variation.imageUrl, variation.colorName || variation.color || 'カラバリ', {
          ...baseMetadata,
          feature: 'colorize',
          parameters,
          ...buildDerivedLightchainMetadata(sourceObject, 'colorize', { parameters }),
        }, editingObjectId ?? undefined);
      });
      return;
    }

    if (action === 'upscale') {
      const { data, error } = await supabase.functions.invoke('upscale', {
        body: { imageUrl: editingImage, brandId: currentBrand.id, scale: 2, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata },
      });
      if (error) throw error;
      if (data?.resultUrl) {
        addImageToCanvasSafely(data.resultUrl, '高解像度', {
          ...baseMetadata,
          feature: 'upscale',
          ...buildDerivedLightchainMetadata(sourceObject, 'upscale', { parameters: { scale: 2 } }),
        }, editingObjectId ?? undefined);
      }
      return;
    }

    if (action === 'variations') {
      if (params.prompt && validateLegalSafetyInput([params.prompt]).blocked) {
        toast.error(BRAND_LIKENESS_BLOCK_COPY);
        return;
      }
      const { data, error } = await supabase.functions.invoke('generate-variations', {
        body: { imageUrl: editingImage, brandId: currentBrand.id, prompt: params.prompt || undefined, count: 4, legalSafety: { rightsConfirmed }, ...lightchainEditMetadata },
      });
      if (error) throw error;
      data?.variations?.forEach((variation: any, index: number) => {
        addImageToCanvasSafely(variation.imageUrl, `バリエーション ${index + 1}`, {
          ...baseMetadata,
          feature: 'generate-variations',
          prompt: params.prompt,
          ...buildDerivedLightchainMetadata(sourceObject, 'generate-variations', {
            prompt: params.prompt,
            parameters: { index: index + 1 },
          }),
        }, editingObjectId ?? undefined);
      });
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
            <p className="text-[10px] sm:text-xs text-neutral-400">
              キャンバス · {currentProjectId ? '自動保存' : '未保存'}
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

          <Button
            variant="secondary"
            size="sm"
            className="shadow-sm text-xs sm:text-sm px-2 sm:px-3"
            onClick={resetGuide}
            title="キャンバスガイドを開く"
          >
            <CircleHelp className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
            <span className="hidden lg:inline">ガイド</span>
          </Button>

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

          <Button size="sm" className="shadow-glow hover:shadow-glow-lg text-xs sm:text-sm px-2 sm:px-3" onClick={handleSave}>
            <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">保存</span>
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Tools */}
        <aside className="w-10 sm:w-14 border-r border-white/10 bg-[#070b0b] flex flex-col items-center py-2 sm:py-4 gap-1 sm:gap-2 z-10">
          <input
            type="file"
            id="file-upload"
            accept="image/*"
            multiple
            onChange={handleFileUpload}
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

            <div className="absolute left-2 right-2 top-16 z-10 mx-auto max-w-5xl rounded-2xl border border-white/10 bg-[#0f1212]/95 p-2 shadow-[0_18px_70px_rgba(0,0,0,0.4)] backdrop-blur sm:left-20 sm:right-auto sm:w-[720px]">
              <div className="grid gap-2 sm:grid-cols-6">
                {canvasImageActions.map((action) => {
                  const Icon = action.icon;
                  const disabled = action.requiresSelection && (!selectedObject || selectedObject.type !== 'image');
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
              {!selectedObject && (
                <p className="mt-2 px-1 text-xs text-neutral-500">画像を選択すると、背景削除・色変更・派生などを直接かけられます。</p>
              )}
              <label className="mt-3 flex items-start gap-3 rounded-xl border border-cyan-300/30 bg-cyan-300/[0.08] p-3 text-xs text-cyan-100">
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
            </div>

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
              <>
                <InfiniteCanvas
                  width={canvasSize.width}
                  height={canvasSize.height}
                  onObjectSelect={handleObjectSelect}
                  onContextAction={handleContextAction}
											onStageReady={(stage) => {
												canvasStageRef.current = stage;
											}}
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
