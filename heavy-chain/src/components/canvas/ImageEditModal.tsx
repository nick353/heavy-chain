import { useState } from 'react';
import { 
  Scissors, 
  Palette, 
  Maximize2, 
  RefreshCw,
  Wand2
} from 'lucide-react';
import { Modal, Button, Textarea } from '../ui';

interface ImageEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onEdit: (action: string, params: any) => Promise<void>;
}

type EditMode = 'prompt' | 'remove-bg' | 'colorize' | 'upscale' | 'variations' | 'inpaint';

export function ImageEditModal({ isOpen, onClose, imageUrl, onEdit }: ImageEditModalProps) {
  const [mode, setMode] = useState<EditMode>('prompt');
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const editModes = [
    { id: 'prompt', icon: Wand2, label: 'プロンプト編集', description: 'テキストで画像を編集' },
    { id: 'remove-bg', icon: Scissors, label: '背景削除', description: '背景を透明に' },
    { id: 'colorize', icon: Palette, label: 'カラバリ', description: '色違いを生成' },
    { id: 'upscale', icon: Maximize2, label: 'アップスケール', description: '高解像度化' },
    { id: 'variations', icon: RefreshCw, label: 'バリエーション', description: '類似画像を生成' },
  ] as const;

  const handleSubmit = async () => {
    setIsProcessing(true);
    try {
      await onEdit(mode, { prompt });
      onClose();
    } catch (error) {
      console.error('Edit failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="画像を編集"
      size="lg"
    >
      <div className="flex gap-6">
        {/* Preview */}
        <div className="w-64 flex-shrink-0">
          <div className="aspect-square rounded-xl overflow-hidden bg-neutral-100 mb-4">
            <img
              src={imageUrl}
              alt="編集対象"
              className="w-full h-full object-cover"
            />
          </div>
          <p className="text-xs text-neutral-500 text-center">
            元の画像
          </p>
        </div>

        {/* Edit options */}
        <div className="flex-1">
          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-2 mb-6">
            {editModes.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id as EditMode)}
                className={`
                  flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all
                  ${mode === m.id
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-neutral-200 hover:border-neutral-300'
                  }
                `}
              >
                <div className={`
                  w-10 h-10 rounded-lg flex items-center justify-center
                  ${mode === m.id ? 'bg-primary-500 text-white' : 'bg-neutral-100 text-neutral-500'}
                `}>
                  <m.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium text-sm text-neutral-800">{m.label}</p>
                  <p className="text-xs text-neutral-500">{m.description}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Mode-specific inputs */}
          {(mode === 'prompt' || mode === 'colorize' || mode === 'variations') && (
            <div className="mb-6">
              <Textarea
                label={
                  mode === 'prompt' ? '編集プロンプト' :
                  mode === 'colorize' ? '希望の色' :
                  'バリエーションの方向性'
                }
                placeholder={
                  mode === 'prompt' ? '例: 背景を青空に変更して' :
                  mode === 'colorize' ? '例: 赤、青、緑の3色' :
                  '例: よりカジュアルに'
                }
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
              />
            </div>
          )}

          {mode === 'upscale' && (
            <div className="mb-6 p-4 bg-neutral-50 rounded-xl">
              <p className="text-sm text-neutral-600 mb-2">
                アップスケール設定
              </p>
              <div className="flex gap-3">
                <button className="flex-1 py-2 px-4 bg-white border-2 border-primary-500 rounded-lg text-sm font-medium text-primary-700">
                  2x (2048px)
                </button>
                <button className="flex-1 py-2 px-4 bg-white border border-neutral-200 rounded-lg text-sm font-medium text-neutral-600 hover:border-neutral-300">
                  4x (4096px)
                </button>
              </div>
            </div>
          )}

          {mode === 'remove-bg' && (
            <div className="mb-6 p-4 bg-neutral-50 rounded-xl">
              <p className="text-sm text-neutral-600">
                AIが自動で背景を検出し、被写体のみを残します。
                処理後は透明背景のPNG形式で出力されます。
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>
              キャンセル
            </Button>
            <Button
              onClick={handleSubmit}
              isLoading={isProcessing}
            >
              {mode === 'remove-bg' ? '背景を削除' :
               mode === 'upscale' ? 'アップスケール' :
               mode === 'colorize' ? 'カラバリを生成' :
               mode === 'variations' ? 'バリエーションを生成' :
               '編集を適用'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

