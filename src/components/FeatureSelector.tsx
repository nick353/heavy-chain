import { useState } from 'react';
import {
  Sparkles,
  Palette,
  Users,
  Globe,
  Scissors,
  Maximize2,
  RefreshCw,
  Wand2,
  ShoppingBag,
  Camera,
  LayoutGrid,
  MessageSquare
} from 'lucide-react';

export interface Feature {
  id: string;
  name: string;
  description: string;
  icon: any;
  category: 'marketing' | 'design' | 'ec' | 'utility' | 'workflow';
  apiEndpoint: string;
}

export const FEATURES: Feature[] = [
  // Marketing/SNS
  {
    id: 'campaign-image',
    name: 'キャンペーン画像',
    description: '季節・セール情報からSNS向け画像を生成',
    icon: Sparkles,
    category: 'marketing',
    apiEndpoint: 'generate-image',
  },
  {
    id: 'scene-coordinate',
    name: 'シーン別コーディネート',
    description: '同商品を複数シーンで生成',
    icon: Camera,
    category: 'marketing',
    apiEndpoint: 'generate-variations',
  },
  
  // Design
  {
    id: 'colorize',
    name: 'カラバリ・柄モックアップ',
    description: '色違い・柄違いバリエーション生成',
    icon: Palette,
    category: 'design',
    apiEndpoint: 'colorize',
  },
  {
    id: 'design-gacha',
    name: 'デザインガチャ',
    description: '複数方向性から一気に生成',
    icon: LayoutGrid,
    category: 'design',
    apiEndpoint: 'design-gacha',
  },
  
  // EC
  {
    id: 'product-shots',
    name: '商品ページ標準カット',
    description: '正面/側面/背面/ディテール自動生成',
    icon: ShoppingBag,
    category: 'ec',
    apiEndpoint: 'product-shots',
  },
  {
    id: 'model-matrix',
    name: '体型・年齢違い着用イメージ',
    description: 'S/M/L、20代〜40代のマトリクス生成',
    icon: Users,
    category: 'ec',
    apiEndpoint: 'model-matrix',
  },
  {
    id: 'multilingual-banner',
    name: '多言語ECバナー',
    description: '日/英/中/韓テキスト入りバナー',
    icon: Globe,
    category: 'ec',
    apiEndpoint: 'multilingual-banner',
  },
  
  // Utility
  {
    id: 'remove-bg',
    name: '背景削除・差し替え',
    description: '白背景化、シーン背景合成',
    icon: Scissors,
    category: 'utility',
    apiEndpoint: 'remove-background',
  },
  {
    id: 'upscale',
    name: 'アップスケール',
    description: '高解像度再生成（2x/4x）',
    icon: Maximize2,
    category: 'utility',
    apiEndpoint: 'upscale',
  },
  {
    id: 'variations',
    name: 'バリエーション生成',
    description: '類似画像を複数生成',
    icon: RefreshCw,
    category: 'utility',
    apiEndpoint: 'generate-variations',
  },
  
  // Workflow
  {
    id: 'optimize-prompt',
    name: 'プロンプト最適化',
    description: '日本語→英語変換＆最適化',
    icon: Wand2,
    category: 'workflow',
    apiEndpoint: 'optimize-prompt',
  },
  {
    id: 'chat-edit',
    name: 'チャットベース編集',
    description: '対話形式で画像を編集',
    icon: MessageSquare,
    category: 'workflow',
    apiEndpoint: 'edit-image',
  },
];

const CATEGORIES = [
  { id: 'all', name: 'すべて' },
  { id: 'marketing', name: 'マーケティング・SNS' },
  { id: 'design', name: '商品企画・デザイン' },
  { id: 'ec', name: 'EC' },
  { id: 'utility', name: '編集・ユーティリティ' },
  { id: 'workflow', name: 'ワークフロー' },
];

interface FeatureSelectorProps {
  onSelectFeature: (feature: Feature) => void;
  selectedFeatureId?: string;
}

export function FeatureSelector({ onSelectFeature, selectedFeatureId }: FeatureSelectorProps) {
  const [activeCategory, setActiveCategory] = useState('all');

  const filteredFeatures = activeCategory === 'all'
    ? FEATURES
    : FEATURES.filter(f => f.category === activeCategory);

  return (
    <div className="space-y-4">
      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto pb-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`
              px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-colors
              ${activeCategory === cat.id
                ? 'bg-primary-100 text-primary-700'
                : 'text-neutral-500 hover:bg-neutral-100'
              }
            `}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredFeatures.map((feature) => {
          const Icon = feature.icon;
          const isSelected = selectedFeatureId === feature.id;

          return (
            <button
              key={feature.id}
              onClick={() => onSelectFeature(feature)}
              className={`
                flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all
                ${isSelected
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-neutral-200 hover:border-neutral-300 bg-white'
                }
              `}
            >
              <div className={`
                w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
                ${isSelected ? 'bg-primary-500 text-white' : 'bg-neutral-100 text-neutral-500'}
              `}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-medium text-neutral-800 text-sm mb-0.5">
                  {feature.name}
                </h3>
                <p className="text-xs text-neutral-500 line-clamp-2">
                  {feature.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

