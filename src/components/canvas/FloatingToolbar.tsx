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
  ImagePlus
} from 'lucide-react';
import { useState } from 'react';
import { useCanvasStore, type CanvasObject } from '../../stores/canvasStore';

interface FloatingToolbarProps {
  selectedObject: CanvasObject | null;
  position: { x: number; y: number };
  onAction: (action: string, params?: any) => void;
}

export function FloatingToolbar({ selectedObject, position, onAction }: FloatingToolbarProps) {
  const [showMore, setShowMore] = useState(false);
  const { deleteSelected } = useCanvasStore();

  if (!selectedObject) return null;

  const isImage = selectedObject.type === 'image';

  const primaryActions = isImage ? [
    { id: 'remove-bg', icon: Scissors, label: '背景削除', color: 'text-purple-600' },
    { id: 'colorize', icon: Palette, label: 'カラバリ', color: 'text-blue-600' },
    { id: 'upscale', icon: Maximize2, label: 'アップスケール', color: 'text-green-600' },
    { id: 'variations', icon: RefreshCw, label: 'バリエーション', color: 'text-orange-600' },
  ] : [];

  return (
    <div
      className="fixed z-50 animate-scale-in"
      style={{
        left: position.x,
        top: position.y - 60,
        transform: 'translateX(-50%)',
      }}
    >
      <div className="flex items-center gap-1 p-1.5 bg-white rounded-xl shadow-elegant border border-neutral-100">
        {/* Primary AI actions for images */}
        {primaryActions.map((action) => (
          <button
            key={action.id}
            onClick={() => onAction(action.id)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg
              text-sm font-medium transition-all
              hover:bg-neutral-100 ${action.color}
            `}
            title={action.label}
          >
            <action.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{action.label}</span>
          </button>
        ))}

        {primaryActions.length > 0 && (
          <div className="w-px h-6 bg-neutral-200 mx-1" />
        )}

        {/* Secondary actions */}
        <button
          onClick={() => onAction('duplicate')}
          className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg transition-all"
          title="複製"
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          onClick={() => onAction('download')}
          className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg transition-all"
          title="ダウンロード"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          onClick={deleteSelected}
          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-all"
          title="削除"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        {/* More menu */}
        <div className="relative">
          <button
            onClick={() => setShowMore(!showMore)}
            className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg transition-all"
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
              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-elegant border border-neutral-100 py-1 z-10">
                {isImage && (
                  <>
                    <button
                      onClick={() => {
                        onAction('edit-prompt');
                        setShowMore(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                    >
                      <Wand2 className="w-4 h-4" />
                      プロンプト編集
                    </button>
                    <button
                      onClick={() => {
                        onAction('derive');
                        setShowMore(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                    >
                      <ImagePlus className="w-4 h-4" />
                      派生画像を生成
                    </button>
                    <div className="h-px bg-neutral-100 my-1" />
                  </>
                )}
                <button
                  onClick={() => {
                    onAction('favorite');
                    setShowMore(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
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

