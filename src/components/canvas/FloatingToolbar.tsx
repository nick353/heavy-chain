import { 
  Wand2, 
  Palette, 
  Maximize2, 
  Trash2,
  Copy,
  Download,
  Heart,
  MoreHorizontal,
  Scissors,
  RefreshCw,
  ImagePlus,
  Brush
} from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useCanvasStore, type CanvasObject } from '../../stores/canvasStore';
import { clampFloatingToolbarPosition } from './floatingToolbarPosition';

interface FloatingToolbarProps {
  selectedObject: CanvasObject | null;
  position: { x: number; y: number };
  onAction: (action: string, params?: any) => void;
}

export function FloatingToolbar({ selectedObject, position, onAction }: FloatingToolbarProps) {
  const [showMore, setShowMore] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [clampedPosition, setClampedPosition] = useState({ left: 8, top: 8 });
  const { deleteSelected } = useCanvasStore();

  useLayoutEffect(() => {
    const updatePosition = () => {
      const toolbar = toolbarRef.current;
      if (!toolbar || typeof window === 'undefined') return;
      setClampedPosition(clampFloatingToolbarPosition({
        anchorX: position.x,
        anchorY: position.y,
        toolbarWidth: toolbar.offsetWidth,
        toolbarHeight: toolbar.offsetHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }));
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [position.x, position.y, selectedObject?.id]);

  if (!selectedObject) return null;

  const isImage = selectedObject.type === 'image';

  const primaryActions = isImage ? [
    { id: 'remove-bg', icon: Scissors, label: '背景削除', color: 'text-cyan-200' },
    { id: 'colorize', icon: Palette, label: 'カラバリ', color: 'text-cyan-200' },
    { id: 'upscale', icon: Maximize2, label: 'アップスケール', color: 'text-cyan-200' },
    { id: 'variations', icon: RefreshCw, label: 'バリエーション', color: 'text-cyan-200' },
  ] : [];

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 animate-scale-in"
      style={{
        left: clampedPosition.left,
        top: clampedPosition.top,
      }}
    >
      <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#101313]/95 p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur">
        {/* Primary AI actions for images */}
        {primaryActions.map((action) => (
          <button
            key={action.id}
            onClick={() => onAction(action.id)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg
              text-sm font-medium transition-all
              hover:bg-white/[0.08] ${action.color}
            `}
            title={action.label}
          >
            <action.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{action.label}</span>
          </button>
        ))}

        {primaryActions.length > 0 && (
          <div className="w-px h-6 bg-white/10 mx-1" />
        )}

        {/* Secondary actions */}
        <button
          onClick={() => onAction('duplicate')}
          className="p-2 text-neutral-300 hover:bg-white/[0.08] hover:text-white rounded-lg transition-all"
          title="複製"
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          onClick={() => onAction('download')}
          className="p-2 text-neutral-300 hover:bg-white/[0.08] hover:text-white rounded-lg transition-all"
          title="ダウンロード"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          onClick={deleteSelected}
          className="p-2 text-red-300 hover:bg-red-500/10 rounded-lg transition-all"
          title="削除"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        {/* More menu */}
        <div className="relative">
          <button
            onClick={() => setShowMore(!showMore)}
            className="p-2 text-neutral-300 hover:bg-white/[0.08] hover:text-white rounded-lg transition-all"
            title="その他"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {showMore && (
            <>
              <div
                className="fixed inset-0"
                onClick={() => setShowMore(false)}
              />
              <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-xl border border-white/10 bg-[#101313] py-1 shadow-[0_18px_60px_rgba(0,0,0,0.4)]">
                {isImage && (
                  <>
                    <button
                      onClick={() => {
                        onAction('edit-prompt');
                        setShowMore(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-white/[0.08]"
                    >
                      <Wand2 className="w-4 h-4" />
                      プロンプト編集
                    </button>
                    <button
                      onClick={() => {
                        onAction('edit-inpaint');
                        setShowMore(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-white/[0.08]"
                    >
                      <Brush className="w-4 h-4" />
                      部分編集
                    </button>
                    <button
                      onClick={() => {
                        onAction('derive');
                        setShowMore(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-white/[0.08]"
                    >
                      <ImagePlus className="w-4 h-4" />
                      派生画像を生成
                    </button>
                    <div className="h-px bg-white/10 my-1" />
                  </>
                )}
                <button
                  onClick={() => {
                    onAction('favorite');
                    setShowMore(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-white/[0.08]"
                >
                  <Heart className="w-4 h-4" />
                  お気に入りに追加
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
