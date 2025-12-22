import { useState } from 'react';
import { ImageSelector, type SelectedImage } from '../ImageSelector';

const colorOptions = [
  { id: 'red', name: '赤', color: '#ef4444' },
  { id: 'blue', name: '青', color: '#3b82f6' },
  { id: 'green', name: '緑', color: '#22c55e' },
  { id: 'yellow', name: '黄', color: '#eab308' },
  { id: 'purple', name: '紫', color: '#a855f7' },
  { id: 'pink', name: 'ピンク', color: '#ec4899' },
  { id: 'orange', name: 'オレンジ', color: '#f97316' },
  { id: 'black', name: '黒', color: '#171717' },
  { id: 'white', name: '白', color: '#f5f5f5' },
  { id: 'beige', name: 'ベージュ', color: '#d4b896' },
  { id: 'navy', name: 'ネイビー', color: '#1e3a5f' },
  { id: 'gray', name: 'グレー', color: '#6b7280' },
];

const patternOptions = [
  { id: 'solid', name: '無地', icon: '◼' },
  { id: 'stripe', name: 'ストライプ', icon: '▤' },
  { id: 'check', name: 'チェック', icon: '▦' },
  { id: 'dot', name: 'ドット', icon: '⚬' },
  { id: 'floral', name: '花柄', icon: '✿' },
  { id: 'geometric', name: '幾何学', icon: '◆' },
  { id: 'camo', name: '迷彩', icon: '🌿' },
  { id: 'animal', name: 'アニマル', icon: '🐆' },
];

interface ColorizeFormProps {
  referenceImage: SelectedImage | null;
  onReferenceImageChange: (image: SelectedImage | null) => void;
}

export function ColorizeForm({ referenceImage, onReferenceImageChange }: ColorizeFormProps) {
  const [selectedColors, setSelectedColors] = useState<string[]>(['red', 'blue', 'green']);
  const [customColor, setCustomColor] = useState('#000000');
  const [selectedPattern, setSelectedPattern] = useState('solid');

  const toggleColor = (colorId: string) => {
    setSelectedColors(prev =>
      prev.includes(colorId)
        ? prev.filter(c => c !== colorId)
        : [...prev, colorId]
    );
  };

  return (
    <div className="space-y-4">
      <ImageSelector
        label="対象画像"
        required
        value={referenceImage}
        onChange={onReferenceImageChange}
        allowedReferenceTypes={['base']}
        defaultReferenceType="base"
        hint="カラバリや柄を変更する画像"
      />

      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          生成するカラー（複数選択可）
        </label>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {colorOptions.map((color) => (
            <button
              key={color.id}
              type="button"
              onClick={() => toggleColor(color.id)}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                selectedColors.includes(color.id)
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                  : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
              }`}
            >
              <div
                className="w-8 h-8 rounded-full border border-neutral-200"
                style={{ backgroundColor: color.color }}
              />
              <span className="text-xs text-neutral-600 dark:text-neutral-400">{color.name}</span>
            </button>
          ))}
          {/* Custom color */}
          <button
            type="button"
            onClick={() => toggleColor('custom')}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
              selectedColors.includes('custom')
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
            }`}
          >
            <input
              type="color"
              value={customColor}
              onChange={(e) => setCustomColor(e.target.value)}
              className="w-8 h-8 rounded-full cursor-pointer"
            />
            <span className="text-xs text-neutral-600 dark:text-neutral-400">カスタム</span>
          </button>
        </div>
        <p className="text-xs text-neutral-500 mt-2">
          {selectedColors.length}色選択中
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          パターン/柄
        </label>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {patternOptions.map((pattern) => (
            <button
              key={pattern.id}
              type="button"
              onClick={() => setSelectedPattern(pattern.id)}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                selectedPattern === pattern.id
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                  : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
              }`}
            >
              <span className="text-xl">{pattern.icon}</span>
              <span className="text-xs text-neutral-600 dark:text-neutral-400">{pattern.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

