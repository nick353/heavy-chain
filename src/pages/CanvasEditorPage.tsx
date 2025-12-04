import { useState, useEffect, useCallback, useRef } from 'react';
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
  const { currentBrand } = useAuthStore();
  const { showGuide, completeGuide } = useCanvasGuide();
  
  const [viewMode, setViewMode] = useState<ViewMode>('canvas');
  const [sidePanel, setSidePanel] = useState<SidePanel>('properties');
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
  
  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingImage, setEditingImage] = useState<string | null>(null);
  
  const {
    objects,
    selectedIds,
    addObject,
    undo,
    redo,
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
    return () => window.removeEventListener('resize', updateSize);
  }, [sidePanel]);

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

  const addImageToCanvas = (imageUrl: string, label?: string) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      addObject({
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
      });
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

      switch (generateMode) {
        case 'gacha':
          if (!generatePrompt.trim()) {
            toast.error('ブリーフを入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('design-gacha', {
            body: { brief: generatePrompt, brandId: currentBrand.id, directions: 4 }
          }));
          if (data?.variations) {
            data.variations.forEach((v: any) => {
              addImageToCanvas(v.imageUrl, v.directionName);
            });
            toast.success(`${data.variations.length}つのデザインを生成しました`);
          }
          break;

        case 'product-shots':
          if (!productDescription.trim()) {
            toast.error('商品説明を入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('product-shots', {
            body: { productDescription, brandId: currentBrand.id }
          }));
          if (data?.shots) {
            data.shots.forEach((s: any) => {
              addImageToCanvas(s.imageUrl, s.shotName);
            });
            toast.success('商品カット（4方向）を生成しました');
          }
          break;

        case 'model-matrix':
          if (!productDescription.trim()) {
            toast.error('商品説明を入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('model-matrix', {
            body: { 
              productDescription, 
              brandId: currentBrand.id,
              bodyTypes: selectedBodyTypes,
              ageGroups: selectedAgeGroups
            }
          }));
          if (data?.matrix) {
            data.matrix.forEach((m: any) => {
              addImageToCanvas(m.imageUrl, `${m.bodyTypeName} × ${m.ageGroupName}`);
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
              headline, 
              subheadline,
              brandId: currentBrand.id,
              languages: selectedLanguages,
              aspectRatio: '1:1'
            }
          }));
          if (data?.banners) {
            data.banners.forEach((b: any) => {
              addImageToCanvas(b.imageUrl, b.languageName);
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
              prompt: generatePrompt,
              width: 1024,
              height: 1024,
              brandId: currentBrand.id
            }
          }));
          if (data?.images && data.images.length > 0) {
            data.images.forEach((img: any) => {
              addImageToCanvas(img.imageUrl);
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
    } catch (error: any) {
      console.error('Generation error:', error);
      toast.error(error.message || '画像生成に失敗しました');
    } finally {
      setIsGenerating(false);
    }
  };

  // Floating toolbar action handler - now with real API calls
  const handleFloatingAction = async (action: string) => {
    if (!selectedObject || selectedObject.type !== 'image') {
      toast.error('画像を選択してください');
      return;
    }

    const imageSrc = (selectedObject as any).src;
    if (!imageSrc) return;

    switch (action) {
      case 'remove-bg':
        toast.loading('背景削除を実行中...', { id: 'remove-bg' });
        try {
          const { data, error } = await supabase.functions.invoke('remove-background', {
            body: { imageUrl: imageSrc, brandId: currentBrand?.id }
          });
          if (error) throw error;
          if (data?.resultUrl) {
            addImageToCanvas(data.resultUrl, '背景削除');
            toast.success('背景を削除しました', { id: 'remove-bg' });
          }
        } catch (err: any) {
          toast.error(err.message || '背景削除に失敗しました', { id: 'remove-bg' });
        }
        break;

      case 'colorize':
        toast.loading('カラバリを生成中...', { id: 'colorize' });
        try {
          const { data, error } = await supabase.functions.invoke('colorize', {
            body: { imageUrl: imageSrc, brandId: currentBrand?.id, colors: ['red', 'blue', 'green', 'yellow'] }
          });
          if (error) throw error;
          if (data?.variations) {
            data.variations.forEach((v: any) => {
              addImageToCanvas(v.imageUrl, v.colorName);
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
          <Textarea
            label="プロンプト"
            placeholder="生成したい画像を日本語で説明してください..."
            value={generatePrompt}
            onChange={(e) => setGeneratePrompt(e.target.value)}
            rows={4}
          />
        );
    }
  };

  return (
    <div className="h-screen flex flex-col bg-neutral-50 dark:bg-neutral-950">
      {/* Header */}
      <header className="glass-nav h-14 flex items-center justify-between px-4 z-20">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors text-neutral-600 dark:text-neutral-400"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            {isEditingName ? (
              <input
                ref={projectNameInputRef}
                type="text"
                value={currentProjectName}
                onChange={handleNameChange}
                onBlur={handleNameBlur}
                onKeyDown={handleNameKeyDown}
                className="text-base font-semibold text-neutral-800 dark:text-white bg-transparent border-b border-primary-500 outline-none px-0 py-0.5 min-w-[100px]"
              />
            ) : (
              <h1
                onClick={() => setIsEditingName(true)}
                className="text-base font-semibold text-neutral-800 dark:text-white cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
              >
                {currentProjectName || '無題のプロジェクト'}
              </h1>
            )}
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {currentProjectId ? '自動保存' : '未保存'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1 border border-neutral-200 dark:border-neutral-700">
            <button
              onClick={() => setViewMode('canvas')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'canvas'
                  ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                  : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
              }`}
            >
              <Layers className="w-4 h-4 inline-block mr-1.5" />
              キャンバス
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'tree'
                  ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                  : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
              }`}
            >
              <GitBranch className="w-4 h-4 inline-block mr-1.5" />
              派生ツリー
            </button>
          </div>

          <div className="w-px h-6 bg-neutral-200 dark:bg-neutral-700 mx-2" />

          <div className="flex -space-x-2">
            <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900 border-2 border-white dark:border-neutral-800 flex items-center justify-center">
              <span className="text-xs font-medium text-primary-700 dark:text-primary-300">Y</span>
            </div>
          </div>
          
          <Button variant="secondary" size="sm" className="shadow-sm">
            <Users className="w-4 h-4 mr-1.5" />
            招待
          </Button>

          <Button size="sm" className="shadow-glow hover:shadow-glow-lg" onClick={handleSave}>
            <Save className="w-4 h-4 mr-1.5" />
            保存
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Tools */}
        <aside className="w-14 glass-panel border-r border-white/20 dark:border-white/5 flex flex-col items-center py-4 gap-2 z-10">
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
            className="p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl cursor-pointer transition-colors text-neutral-600 dark:text-neutral-400"
            title="画像をアップロード"
          >
            <Upload className="w-5 h-5" />
          </label>
          
          <button
            onClick={() => setShowGenerateModal(true)}
            className="p-3 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 rounded-xl transition-colors text-primary-600 dark:text-primary-400"
            title="AI画像生成"
          >
            <Wand2 className="w-5 h-5" />
          </button>

          <div className="w-8 h-px bg-neutral-200 dark:bg-neutral-700 my-2" />

          {/* Side panel toggles */}
          <button
            onClick={() => setSidePanel(sidePanel === 'chat' ? null : 'chat')}
            className={`p-3 rounded-xl transition-colors ${
              sidePanel === 'chat' 
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
            }`}
            title="チャットエディター"
          >
            <MessageSquare className="w-5 h-5" />
          </button>

          <button
            onClick={() => setSidePanel(sidePanel === 'templates' ? null : 'templates')}
            className={`p-3 rounded-xl transition-colors ${
              sidePanel === 'templates' 
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
            }`}
            title="テンプレート"
          >
            <Layout className="w-5 h-5" />
          </button>

          <button
            onClick={() => setSidePanel(sidePanel === 'properties' ? null : 'properties')}
            className={`p-3 rounded-xl transition-colors ${
              sidePanel === 'properties' 
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' 
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
            }`}
            title="プロパティ"
          >
            <Settings2 className="w-5 h-5" />
          </button>
        </aside>

        {/* Canvas area */}
        <main className="flex-1 flex flex-col relative">
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
            <div className="glass-panel rounded-xl p-1.5 shadow-lg border border-white/40 dark:border-white/10">
              <CanvasToolbar
                onAddText={handleAddText}
                onAddShape={handleAddShape}
                onAddFrame={handleAddFrame}
              />
            </div>
          </div>

          <div ref={containerRef} className="flex-1 relative bg-neutral-50/50 dark:bg-neutral-950/50">
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,rgba(200,200,200,0.1)_1px,transparent_1px)] bg-[length:20px_20px] dark:bg-[radial-gradient(circle_at_center,rgba(50,50,50,0.3)_1px,transparent_1px)]" />
            </div>

            {viewMode === 'canvas' ? (
              <>
                <InfiniteCanvas
                  width={canvasSize.width}
                  height={canvasSize.height}
                  onObjectSelect={handleObjectSelect}
                />
                
                {selectedObject && (
                  <FloatingToolbar
                    selectedObject={selectedObject}
                    position={selectedPosition}
                    onAction={handleFloatingAction}
                  />
                )}

                <div className="absolute bottom-4 right-4 z-10">
                  <div className="glass-panel rounded-xl overflow-hidden border border-white/40 dark:border-white/10 shadow-lg">
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

        {/* Right sidebar */}
        <AnimatePresence>
          {sidePanel && (
            <motion.aside 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="glass-panel border-l border-white/20 dark:border-white/5 flex flex-col overflow-hidden z-10"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
                <h2 className="font-semibold text-neutral-800 dark:text-white">
                  {sidePanel === 'properties' && 'プロパティ'}
                  {sidePanel === 'chat' && 'チャットエディター'}
                  {sidePanel === 'templates' && 'テンプレート'}
                </h2>
                <button
                  onClick={() => setSidePanel(null)}
                  className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded transition-colors text-neutral-500 dark:text-neutral-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
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
          )}
        </AnimatePresence>
      </div>

      {/* Generate Modal */}
      <Modal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
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
              onClick={() => setShowGenerateModal(false)}
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
