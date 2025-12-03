import { 
  Upload, 
  Wand2, 
  Type, 
  Square, 
  FolderOpen,
  Sparkles,
  MousePointer2,
  Move,
  ZoomIn
} from 'lucide-react';

interface EmptyCanvasGuideProps {
  onAddImage: () => void;
  onGenerateImage: () => void;
  onAddText: () => void;
  onAddShape: () => void;
  onOpenGallery: () => void;
}

export function EmptyCanvasGuide({
  onAddImage,
  onGenerateImage,
  onAddText,
  onAddShape,
  onOpenGallery,
}: EmptyCanvasGuideProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="max-w-lg text-center pointer-events-auto">
        {/* Main CTA */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-xl p-8 mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/50 dark:to-accent-900/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-primary-600 dark:text-primary-400" />
          </div>
          
          <h2 className="text-xl font-display font-semibold text-neutral-800 dark:text-white mb-2">
            キャンバスを始めましょう
          </h2>
          <p className="text-neutral-600 dark:text-neutral-400 mb-6">
            画像を追加するか、AIで新しい画像を生成してください
          </p>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onGenerateImage}
              className="flex flex-col items-center gap-2 p-4 bg-primary-50 dark:bg-primary-900/30 hover:bg-primary-100 dark:hover:bg-primary-900/50 rounded-xl transition-colors"
            >
              <div className="w-10 h-10 bg-primary-500 rounded-lg flex items-center justify-center">
                <Wand2 className="w-5 h-5 text-white" />
              </div>
              <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                AI生成
              </span>
            </button>

            <button
              onClick={onAddImage}
              className="flex flex-col items-center gap-2 p-4 bg-neutral-50 dark:bg-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-600 rounded-xl transition-colors"
            >
              <div className="w-10 h-10 bg-neutral-200 dark:bg-neutral-600 rounded-lg flex items-center justify-center">
                <Upload className="w-5 h-5 text-neutral-600 dark:text-neutral-300" />
              </div>
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                アップロード
              </span>
            </button>

            <button
              onClick={onOpenGallery}
              className="flex flex-col items-center gap-2 p-4 bg-neutral-50 dark:bg-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-600 rounded-xl transition-colors"
            >
              <div className="w-10 h-10 bg-neutral-200 dark:bg-neutral-600 rounded-lg flex items-center justify-center">
                <FolderOpen className="w-5 h-5 text-neutral-600 dark:text-neutral-300" />
              </div>
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                ギャラリーから
              </span>
            </button>

            <button
              onClick={onAddText}
              className="flex flex-col items-center gap-2 p-4 bg-neutral-50 dark:bg-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-600 rounded-xl transition-colors"
            >
              <div className="w-10 h-10 bg-neutral-200 dark:bg-neutral-600 rounded-lg flex items-center justify-center">
                <Type className="w-5 h-5 text-neutral-600 dark:text-neutral-300" />
              </div>
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                テキスト
              </span>
            </button>
          </div>
        </div>

        {/* Tips */}
        <div className="bg-white/80 dark:bg-neutral-800/80 backdrop-blur rounded-xl p-4">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3">
            💡 操作のヒント
          </p>
          <div className="flex items-center justify-center gap-6 text-xs text-neutral-600 dark:text-neutral-400">
            <div className="flex items-center gap-1.5">
              <MousePointer2 className="w-3.5 h-3.5" />
              <span>クリックで選択</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Move className="w-3.5 h-3.5" />
              <span>ドラッグで移動</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ZoomIn className="w-3.5 h-3.5" />
              <span>スクロールでズーム</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

