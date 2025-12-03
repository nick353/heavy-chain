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
  Users
} from 'lucide-react';
import {
  InfiniteCanvas,
  CanvasToolbar,
  FloatingToolbar,
  Minimap,
  PropertiesPanel,
  DerivationTree,
} from '../components/canvas';
import { useCanvasStore } from '../stores/canvasStore';
import { Button, Modal } from '../components/ui';
import toast from 'react-hot-toast';

type ViewMode = 'canvas' | 'tree';
type SidePanel = 'properties' | 'layers' | null;

export function CanvasEditorPage() {
  useParams(); // projectId for future use
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [viewMode, setViewMode] = useState<ViewMode>('canvas');
  const [sidePanel, setSidePanel] = useState<SidePanel>('properties');
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [selectedPosition, setSelectedPosition] = useState({ x: 0, y: 0 });
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  const {
    objects,
    selectedIds,
    addObject,
    undo,
    redo,
  } = useCanvasStore();

  // Get selected object
  const selectedObject = selectedIds.length === 1
    ? objects.find((obj) => obj.id === selectedIds[0]) || null
    : null;

  // Update canvas size on resize
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

  // Keyboard shortcuts
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

  // Handle object selection for floating toolbar position
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

  // Add text
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

  // Add shape
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

  // Add frame
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

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
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

  // Handle AI generation
  const handleGenerate = async () => {
    if (!generatePrompt.trim()) return;
    
    setIsGenerating(true);
    try {
      // TODO: Call actual AI generation API
      toast.success('画像を生成中...');
      
      // Simulate generation delay
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      // Add placeholder image
      addObject({
        type: 'image',
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
        src: 'https://via.placeholder.com/300',
      });
      
      setShowGenerateModal(false);
      setGeneratePrompt('');
      toast.success('画像を生成しました');
    } catch (error) {
      toast.error('画像生成に失敗しました');
    } finally {
      setIsGenerating(false);
    }
  };

  // Floating toolbar action handler
  const handleFloatingAction = (action: string) => {
    switch (action) {
      case 'remove-bg':
        toast('背景削除を実行中...', { icon: '✂️' });
        break;
      case 'colorize':
        toast('カラバリを生成中...', { icon: '🎨' });
        break;
      case 'upscale':
        toast('アップスケール中...', { icon: '📐' });
        break;
      case 'variations':
        toast('バリエーションを生成中...', { icon: '🔄' });
        break;
      case 'download':
        toast.success('ダウンロードを開始しました');
        break;
      default:
        break;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-neutral-50">
      {/* Header */}
      <header className="h-14 bg-white border-b border-neutral-200 flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="p-2 hover:bg-neutral-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-neutral-600" />
          </button>
          <div>
            <h1 className="font-semibold text-neutral-800">
              プロジェクト名
            </h1>
            <p className="text-xs text-neutral-500">
              最終更新: たった今
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-neutral-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('canvas')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'canvas'
                  ? 'bg-white text-neutral-800 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <Layers className="w-4 h-4 inline-block mr-1.5" />
              キャンバス
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'tree'
                  ? 'bg-white text-neutral-800 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <GitBranch className="w-4 h-4 inline-block mr-1.5" />
              派生ツリー
            </button>
          </div>

          <div className="w-px h-6 bg-neutral-200 mx-2" />

          {/* Collaborators */}
          <div className="flex -space-x-2">
            <div className="w-8 h-8 rounded-full bg-primary-100 border-2 border-white flex items-center justify-center">
              <span className="text-xs font-medium text-primary-700">Y</span>
            </div>
          </div>
          
          <Button variant="secondary" size="sm">
            <Users className="w-4 h-4 mr-1.5" />
            招待
          </Button>

          <Button size="sm">
            <Save className="w-4 h-4 mr-1.5" />
            保存
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Tools */}
        <aside className="w-14 bg-white border-r border-neutral-200 flex flex-col items-center py-4 gap-2">
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
            className="p-3 hover:bg-neutral-100 rounded-xl cursor-pointer transition-colors"
            title="画像をアップロード"
          >
            <Upload className="w-5 h-5 text-neutral-600" />
          </label>
          
          <button
            onClick={() => setShowGenerateModal(true)}
            className="p-3 bg-primary-50 hover:bg-primary-100 rounded-xl transition-colors"
            title="AI画像生成"
          >
            <Wand2 className="w-5 h-5 text-primary-600" />
          </button>
        </aside>

        {/* Canvas area */}
        <main className="flex-1 flex flex-col">
          {/* Toolbar */}
          <div className="p-3 flex justify-center">
            <CanvasToolbar
              onAddText={handleAddText}
              onAddShape={handleAddShape}
              onAddFrame={handleAddFrame}
            />
          </div>

          {/* Canvas/Tree view */}
          <div ref={containerRef} className="flex-1 relative">
            {viewMode === 'canvas' ? (
              <>
                <InfiniteCanvas
                  width={canvasSize.width}
                  height={canvasSize.height}
                  onObjectSelect={handleObjectSelect}
                />
                
                {/* Floating toolbar */}
                {selectedObject && (
                  <FloatingToolbar
                    selectedObject={selectedObject}
                    position={selectedPosition}
                    onAction={handleFloatingAction}
                  />
                )}

                {/* Minimap */}
                <div className="absolute bottom-4 right-4">
                  <Minimap
                    canvasWidth={canvasSize.width}
                    canvasHeight={canvasSize.height}
                  />
                </div>
              </>
            ) : (
              <DerivationTree />
            )}
          </div>
        </main>

        {/* Right sidebar - Properties */}
        {sidePanel && (
          <aside className="w-72 bg-white border-l border-neutral-200 overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
              <h2 className="font-semibold text-neutral-800">
                {sidePanel === 'properties' ? 'プロパティ' : 'レイヤー'}
              </h2>
              <button
                onClick={() => setSidePanel(null)}
                className="p-1 hover:bg-neutral-100 rounded transition-colors"
              >
                <Settings2 className="w-4 h-4 text-neutral-500" />
              </button>
            </div>
            <PropertiesPanel selectedObject={selectedObject} />
          </aside>
        )}
      </div>

      {/* Generate Modal */}
      <Modal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        title="AI画像生成"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              プロンプト
            </label>
            <textarea
              value={generatePrompt}
              onChange={(e) => setGeneratePrompt(e.target.value)}
              placeholder="生成したい画像を日本語で説明してください..."
              className="w-full h-32 px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowGenerateModal(false)}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={!generatePrompt.trim() || isGenerating}
            >
              {isGenerating ? '生成中...' : '生成'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

