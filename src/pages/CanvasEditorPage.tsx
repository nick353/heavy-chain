import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
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
  Grid3x3
} from 'lucide-react';
import {
  InfiniteCanvas,
  CanvasToolbar,
  FloatingToolbar,
  Minimap,
  PropertiesPanel,
  DerivationTree,
  ImageEditModal,
  CanvasGuide,
  useCanvasGuide,
} from '../components/canvas';
import { useCanvasStore } from '../stores/canvasStore';
import { ChatEditor } from '../components/ChatEditor';
import { TemplateSelector } from '../components/TemplateSelector';
import { Button, Modal, Textarea, Input } from '../components/ui';
import { ImageSelector, type SelectedImage } from '../components/ImageSelector';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

type ViewMode = 'canvas' | 'tree';
type SidePanel = 'properties' | 'chat' | 'templates' | null;
type GenerateMode = 'basic' | 'gacha' | 'product-shots' | 'model-matrix' | 'multilingual';

const GENERATE_MODES = [
  { id: 'basic', name: '基本生成', icon: Image, description: 'テキストから画像を生成' },
  { id: 'gacha', name: 'デザインガチャ', icon: Sparkles, description: '複数スタイルを一括生成' },
  { id: 'product-shots', name: '商品カット', icon: Grid3x3, description: '4方向の商品画像' },
  { id: 'model-matrix', name: 'モデルマトリクス', icon: Users, description: '体型×年齢の組み合わせ' },
  { id: 'multilingual', name: '多言語バナー', icon: Globe, description: '日/英/中/韓バナー' },
] as const;

export function CanvasEditorPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const { currentBrand, user, profile } = useAuthStore();
  const { showGuide, completeGuide } = useCanvasGuide();
  
  const [viewMode, setViewMode] = useState<ViewMode>('canvas');
  // Start with no side panel on mobile, properties on desktop
  const [sidePanel, setSidePanel] = useState<SidePanel>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return null;
    }
    return 'properties';
  });
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [selectedPosition, setSelectedPosition] = useState({ x: 0, y: 0 });
  const [isEditingName, setIsEditingName] = useState(false);
  
  // Generate modal states
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateMode, setGenerateMode] = useState<GenerateMode>('basic');
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [headline, setHeadline] = useState('');
  const [subheadline, setSubheadline] = useState('');
  const [selectedBodyTypes, setSelectedBodyTypes] = useState(['slim', 'regular', 'plus']);
  const [selectedAgeGroups, setSelectedAgeGroups] = useState(['20s', '30s', '40s']);
  const [selectedLanguages, setSelectedLanguages] = useState(['ja', 'en']);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Reference image states for generate modal
  const [referenceImage, setReferenceImage] = useState<SelectedImage | null>(null);
  
  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingImage, setEditingImage] = useState<string | null>(null);
  
  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  
  const {
    objects,
    selectedIds,
    addObject,
    undo,
    redo,
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

  const addImageToCanvas = (imageUrl: string, label?: string, metadata?: any, parentId?: string) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const newId = addObject({
        type: 'image',
        x: 100 + Math.random() * 300,
        y: 100 + Math.random() * 200,
        width: Math.min(img.width, 300),
        height: Math.min(img.height, 300),
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        locked: false,
        visible: true,
        src: imageUrl,
        label,
        derivedFrom: parentId || null,
        metadata: metadata ? {
          ...metadata,
          timestamp: new Date().toISOString(),
          parentId: parentId || undefined,
        } : undefined,
      });
      return newId;
    };
    img.src = imageUrl;
  };

  const handleGenerate = async () => {
    if (!currentBrand) {
      toast.error('ブランドを選択してください');
      return;
    }
    
    setIsGenerating(true);
    try {
      let data;
      let error;

      // 共通のベースボディ（参照画像を含む）
      const baseBody = {
        brandId: currentBrand.id,
        referenceImage: referenceImage?.url,
        referenceType: referenceImage?.referenceType,
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
              addImageToCanvas(v.imageUrl, v.directionName, {
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
              addImageToCanvas(s.imageUrl, s.shotName, {
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
          ({ data, error } = await supabase.functions.invoke('model-matrix', {
            body: { 
              ...baseBody,
              productDescription, 
              imageUrl: referenceImage?.url,
              bodyTypes: selectedBodyTypes,
              ageGroups: selectedAgeGroups
            }
          }));
          if (data?.matrix) {
            data.matrix.forEach((m: any) => {
              addImageToCanvas(m.imageUrl, `${m.bodyTypeName} × ${m.ageGroupName}`, {
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
              addImageToCanvas(b.imageUrl, b.languageName, {
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
            }
          }));
          if (data?.images && data.images.length > 0) {
            data.images.forEach((img: any) => {
              addImageToCanvas(img.imageUrl, undefined, {
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
            const response = await fetch(obj.src);
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

    switch (action) {
      case 'removeBackground':
      case 'remove-bg':
        toast.loading('背景削除を実行中...', { id: 'remove-bg' });
        try {
          const { data, error } = await supabase.functions.invoke('remove-background', {
            body: { imageUrl: imageSrc, brandId: currentBrand?.id }
          });
          if (error) throw error;
          if (data?.resultUrl) {
            addImageToCanvas(data.resultUrl, '背景削除', {
              feature: 'remove-background',
              parentId: objectId,
              generation: (obj.metadata?.generation || 0) + 1,
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
            body: { imageUrl: imageSrc, brandId: currentBrand?.id, colors: ['red', 'blue', 'green', 'yellow'] }
          });
          if (error) throw error;
          if (data?.variations) {
            data.variations.forEach((v: any) => {
              addImageToCanvas(v.imageUrl, v.colorName, {
                feature: 'colorize',
                parentId: objectId,
                generation: (obj.metadata?.generation || 0) + 1,
                parameters: { color: v.colorName },
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
            body: { imageUrl: imageSrc, brandId: currentBrand?.id, scale: 2 }
          });
          if (error) throw error;
          if (data?.resultUrl) {
            addImageToCanvas(data.resultUrl, '高解像度');
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
            body: { imageUrl: imageSrc, brandId: currentBrand?.id, count: 4 }
          });
          if (error) throw error;
          if (data?.variations) {
            data.variations.forEach((v: any, i: number) => {
              addImageToCanvas(v.imageUrl, `バリエーション ${i + 1}`);
            });
            toast.success('バリエーションを生成しました', { id: 'variations' });
          }
        } catch (err: any) {
          toast.error(err.message || 'バリエーション生成に失敗しました', { id: 'variations' });
        }
        break;

      case 'edit':
        setEditingImage(imageSrc);
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

  // Handle chat edit result
  const handleChatEditResult = (imageUrl: string) => {
    addImageToCanvas(imageUrl, '編集結果');
  };

  // Handle template select
  const handleTemplateSelect = (template: any) => {
    // Add template as frame with preset size
    addObject({
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
    });
    toast.success(`${template.name}を追加しました`);
    setSidePanel('properties');
  };

  // Handle image edit modal result
  const handleEditModalResult = (imageUrl: string) => {
    addImageToCanvas(imageUrl, '編集結果');
    setShowEditModal(false);
    setEditingImage(null);
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
    <div className="h-screen flex flex-col bg-neutral-50 dark:bg-neutral-950">
      {/* Header */}
      <header className="glass-nav h-12 sm:h-14 flex items-center justify-between px-2 sm:px-4 z-20">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
          <button
            onClick={() => navigate('/dashboard')}
            className="p-1.5 sm:p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors text-neutral-600 dark:text-neutral-400 flex-shrink-0"
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
                className="text-sm sm:text-base font-semibold text-neutral-800 dark:text-white bg-transparent border-b border-primary-500 outline-none px-0 py-0.5 w-full max-w-[150px] sm:max-w-[200px]"
              />
            ) : (
              <h1
                onClick={() => setIsEditingName(true)}
                className="text-sm sm:text-base font-semibold text-neutral-800 dark:text-white cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 transition-colors truncate"
              >
                {currentProjectName || '無題'}
              </h1>
            )}
            <p className="text-[10px] sm:text-xs text-neutral-500 dark:text-neutral-400">
              {currentProjectId ? '自動保存' : '未保存'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          {/* View mode toggle - hidden on mobile */}
          <div className="hidden sm:flex items-center bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1 border border-neutral-200 dark:border-neutral-700">
            <button
              onClick={() => setViewMode('canvas')}
              className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                viewMode === 'canvas'
                  ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                  : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block sm:mr-1.5" />
              <span className="hidden sm:inline">キャンバス</span>
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                viewMode === 'tree'
                  ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                  : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block sm:mr-1.5" />
              <span className="hidden sm:inline">派生ツリー</span>
            </button>
          </div>

          <div className="hidden sm:block w-px h-6 bg-neutral-200 dark:bg-neutral-700 mx-1 sm:mx-2" />

          {/* Active user avatar - shows current logged in user */}
          <div className="hidden md:flex -space-x-2 items-center">
            <div 
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 border-2 border-white dark:border-neutral-800 flex items-center justify-center overflow-hidden shadow-sm"
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
        <aside className="w-10 sm:w-14 glass-panel border-r border-white/20 dark:border-white/5 flex flex-col items-center py-2 sm:py-4 gap-1 sm:gap-2 z-10">
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
            className="p-2 sm:p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg sm:rounded-xl cursor-pointer transition-colors text-neutral-600 dark:text-neutral-400"
            title="画像をアップロード"
          >
            <Upload className="w-4 h-4 sm:w-5 sm:h-5" />
          </label>
          
          <button
            onClick={() => setShowGenerateModal(true)}
            className="p-2 sm:p-3 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 rounded-lg sm:rounded-xl transition-colors text-primary-600 dark:text-primary-400"
            title="AI画像生成"
          >
            <Wand2 className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <div className="w-6 sm:w-8 h-px bg-neutral-200 dark:bg-neutral-700 my-1 sm:my-2" />

          {/* Side panel toggles */}
          <button
            onClick={() => setSidePanel(sidePanel === 'chat' ? null : 'chat')}
            className={`p-2 sm:p-3 rounded-lg sm:rounded-xl transition-colors ${
              sidePanel === 'chat' 
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
            }`}
            title="チャットエディター"
          >
            <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <button
            onClick={() => setSidePanel(sidePanel === 'templates' ? null : 'templates')}
            className={`p-2 sm:p-3 rounded-lg sm:rounded-xl transition-colors ${
              sidePanel === 'templates' 
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
            }`}
            title="テンプレート"
          >
            <Layout className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <button
            onClick={() => setSidePanel(sidePanel === 'properties' ? null : 'properties')}
            className={`p-2 sm:p-3 rounded-lg sm:rounded-xl transition-colors ${
              sidePanel === 'properties' 
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
            }`}
            title="プロパティ"
          >
            <Settings2 className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </aside>

        {/* Canvas area */}
        <main className="flex-1 flex flex-col relative overflow-hidden">
          {/* Toolbar container - centered on desktop, full width on mobile */}
          <div className="absolute top-2 sm:top-4 inset-x-2 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-10 flex justify-center pointer-events-none">
            <div className="pointer-events-auto glass-panel rounded-lg sm:rounded-xl p-0 sm:p-1 shadow-lg border border-white/40 dark:border-white/10">
              <CanvasToolbar
                onAddText={handleAddText}
                onAddShape={handleAddShape}
                onAddFrame={handleAddFrame}
              />
            </div>
          </div>

          <div ref={containerRef} className="flex-1 relative bg-neutral-50/50 dark:bg-neutral-950/50">
            {/* 背景パターン - position:fixedで固定し、サイドパネル開閉時に動かない */}
            <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(200,200,200,0.1)_1px,transparent_1px)] bg-[length:20px_20px] dark:bg-[radial-gradient(circle_at_center,rgba(50,50,50,0.3)_1px,transparent_1px)]" />
            </div>

            {viewMode === 'canvas' ? (
              <>
                <InfiniteCanvas
                  width={canvasSize.width}
                  height={canvasSize.height}
                  onObjectSelect={handleObjectSelect}
                  onContextAction={handleContextAction}
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
                  <div className="glass-panel rounded-lg sm:rounded-xl overflow-hidden border border-white/40 dark:border-white/10 shadow-lg">
                    <Minimap
                      canvasWidth={canvasSize.width}
                      canvasHeight={canvasSize.height}
                    />
                  </div>
                </div>
              </>
            ) : (
              <DerivationTree />
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
                className="fixed right-0 top-12 sm:top-14 bottom-0 w-[85vw] max-w-[320px] md:w-80 glass-panel border-l border-white/20 dark:border-white/5 flex flex-col overflow-hidden z-30"
              >
                <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-neutral-100 dark:border-neutral-800">
                  <h2 className="font-semibold text-sm sm:text-base text-neutral-800 dark:text-white">
                    {sidePanel === 'properties' && 'プロパティ'}
                    {sidePanel === 'chat' && 'チャット'}
                    {sidePanel === 'templates' && 'テンプレート'}
                  </h2>
                  <button
                    onClick={() => setSidePanel(null)}
                    className="p-1.5 sm:p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded transition-colors text-neutral-500 dark:text-neutral-400"
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
                  <TemplateSelector 
                    mode="size" 
                    onSelectSize={handleTemplateSelect} 
                  />
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
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                      : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600'
                  }`}
                >
                  <mode.icon className={`w-5 h-5 mb-2 ${
                    generateMode === mode.id ? 'text-primary-600 dark:text-primary-400' : 'text-neutral-500 dark:text-neutral-400'
                  }`} />
                  <div className="font-medium text-sm text-neutral-800 dark:text-white">{mode.name}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{mode.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic form */}
          {renderGenerateForm()}

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
              disabled={isGenerating}
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
          }}
          imageUrl={editingImage}
          onEdit={async (action, _params) => {
            // Handle the edit result
            if (action === 'prompt') {
              // The modal handles showing result, we just need to add to canvas
              handleEditModalResult(editingImage);
            }
          }}
        />
      )}

      {/* Canvas Guide for first-time users */}
      {showGuide && <CanvasGuide onComplete={completeGuide} />}
    </div>
  );
}
