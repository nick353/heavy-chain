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
  MessageSquare,
  Star,
  TrendingUp,
  Zap
} from 'lucide-react';

export interface Feature {
  id: string;
  name: string;
  description: string;
  icon: any;
  category: 'marketing' | 'design' | 'ec' | 'utility' | 'workflow';
  apiEndpoint: string;
  badge?: 'recommended' | 'popular' | 'new';
  examplePrompt?: string;
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
    badge: 'recommended',
    examplePrompt: 'サマーセール、ビーチリゾート風、爽やかな青空',
  },
  {
    id: 'scene-coordinate',
    name: 'シーン別コーディネート',
    description: '同商品を複数シーンで生成',
    icon: Camera,
    category: 'marketing',
    apiEndpoint: 'generate-variations',
    examplePrompt: '白いTシャツ × カフェ/ストリート/オフィス',
  },
  
  // Design
  {
    id: 'colorize',
    name: 'カラバリ・柄モックアップ',
    description: '色違い・柄違いバリエーション生成',
    icon: Palette,
    category: 'design',
    apiEndpoint: 'colorize',
    badge: 'popular',
    examplePrompt: 'ネイビー/ベージュ/グレーのカラー展開',
  },
  {
    id: 'design-gacha',
    name: 'デザインガチャ',
    description: '複数スタイルから一気に4案生成',
    icon: LayoutGrid,
    category: 'design',
    apiEndpoint: 'design-gacha',
    badge: 'recommended',
    examplePrompt: '20代女性向けカジュアルドレス',
  },
  
  // EC
  {
    id: 'product-shots',
    name: '商品ページ標準カット',
    description: '正面/側面/背面/ディテール自動生成',
    icon: ShoppingBag,
    category: 'ec',
    apiEndpoint: 'product-shots',
    badge: 'popular',
    examplePrompt: '白いコットンTシャツ、クルーネック',
  },
  {
    id: 'model-matrix',
    name: '体型・年齢違い着用イメージ',
    description: 'S/M/L、20代〜40代のマトリクス生成',
    icon: Users,
    category: 'ec',
    apiEndpoint: 'model-matrix',
    badge: 'new',
    examplePrompt: 'スリムフィットジーンズの着用イメージ',
  },
  {
    id: 'multilingual-banner',
    name: '多言語ECバナー',
    description: '日/英/中/韓テキスト入りバナー',
    icon: Globe,
    category: 'ec',
    apiEndpoint: 'multilingual-banner',
    examplePrompt: 'SUMMER SALE 最大50%OFF',
  },
  
  // Utility
  {
    id: 'remove-bg',
    name: '背景削除・差し替え',
    description: '白背景化、シーン背景合成',
    icon: Scissors,
    category: 'utility',
    apiEndpoint: 'remove-background',
    badge: 'popular',
    examplePrompt: '商品写真の背景を白に変更',
  },
  {
    id: 'upscale',
    name: 'アップスケール',
    description: '高解像度再生成（2x/4x）',
    icon: Maximize2,
    category: 'utility',
    apiEndpoint: 'upscale',
    examplePrompt: '画像を2倍に高解像度化',
  },
  {
    id: 'variations',
    name: 'バリエーション生成',
    description: '類似画像を複数生成',
    icon: RefreshCw,
    category: 'utility',
    apiEndpoint: 'generate-variations',
    examplePrompt: '似たスタイルで4パターン生成',
  },
  
  // Workflow
  {
    id: 'optimize-prompt',
    name: 'プロンプト最適化',
    description: '日本語→英語変換＆最適化',
    icon: Wand2,
    category: 'workflow',
    apiEndpoint: 'optimize-prompt',
    badge: 'recommended',
    examplePrompt: '「白Tシャツ」→ 最適化されたプロンプト',
  },
  {
    id: 'chat-edit',
    name: 'チャットベース編集',
    description: '対話形式で画像を編集',
    icon: MessageSquare,
    category: 'workflow',
    apiEndpoint: 'edit-image',
    badge: 'new',
    examplePrompt: '「もっと明るく」「背景を青に」',
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

const BADGE_STYLES = {
  recommended: {
    bg: 'bg-primary-100 dark:bg-primary-900/50',
    text: 'text-primary-700 dark:text-primary-300',
    icon: Star,
    label: 'おすすめ',
  },
  popular: {
    bg: 'bg-orange-100 dark:bg-orange-900/50',
    text: 'text-orange-700 dark:text-orange-300',
    icon: TrendingUp,
    label: '人気',
  },
  new: {
    bg: 'bg-green-100 dark:bg-green-900/50',
    text: 'text-green-700 dark:text-green-300',
    icon: Zap,
    label: '新機能',
  },
};

interface FeatureSelectorProps {
  onSelectFeature: (feature: Feature) => void;
  selectedFeatureId?: string | null;
}

export function FeatureSelector({ onSelectFeature, selectedFeatureId }: FeatureSelectorProps) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [hoveredFeature, setHoveredFeature] = useState<string | null>(null);

  const filteredFeatures = activeCategory === 'all'
    ? FEATURES
    : FEATURES.filter(f => f.category === activeCategory);

  // Sort to show recommended first, then popular, then new
  const sortedFeatures = [...filteredFeatures].sort((a, b) => {
    const priority = { recommended: 0, popular: 1, new: 2 };
    const aPriority = a.badge ? priority[a.badge] : 3;
    const bPriority = b.badge ? priority[b.badge] : 3;
    return aPriority - bPriority;
  });

  return (
    <div className="space-y-6">
      {/* Quick start section */}
      {activeCategory === 'all' && (
        <div className="bg-gradient-to-r from-primary-50 to-accent-50 dark:from-primary-900/30 dark:to-accent-900/30 rounded-2xl p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-white dark:bg-neutral-800 rounded-xl flex items-center justify-center shadow-sm">
              <Sparkles className="w-6 h-6 text-primary-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-neutral-800 dark:text-white mb-1">
                🚀 まずはこれから始めよう
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
                初めての方は「デザインガチャ」がおすすめ。1つのコンセプトから4つのスタイルを一気に生成できます。
              </p>
              <button
                onClick={() => onSelectFeature(FEATURES.find(f => f.id === 'design-gacha')!)}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                デザインガチャを試す →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto pb-2 -mx-1 px-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`
              px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors
              ${activeCategory === cat.id
                ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300'
                : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }
            `}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sortedFeatures.map((feature) => {
          const Icon = feature.icon;
          const isSelected = selectedFeatureId === feature.id;
          const isHovered = hoveredFeature === feature.id;
          const badge = feature.badge ? BADGE_STYLES[feature.badge] : null;

          return (
            <button
              key={feature.id}
              onClick={() => onSelectFeature(feature)}
              onMouseEnter={() => setHoveredFeature(feature.id)}
              onMouseLeave={() => setHoveredFeature(null)}
              className={`
                relative flex flex-col p-5 rounded-2xl border-2 text-left transition-all duration-200
                ${isSelected
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 shadow-lg shadow-primary-500/10'
                  : 'border-neutral-200 dark:border-neutral-700 hover:border-primary-300 dark:hover:border-primary-600 bg-white dark:bg-neutral-800'
                }
              `}
            >
              {/* Badge */}
              {badge && (
                <div className={`absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                  <badge.icon className="w-3 h-3" />
                  {badge.label}
                </div>
              )}

              <div className="flex items-start gap-4 mb-3">
                <div className={`
                  w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors
                  ${isSelected 
                    ? 'bg-primary-500 text-white' 
                    : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'
                  }
                `}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-neutral-800 dark:text-white mb-1">
                    {feature.name}
                  </h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {feature.description}
                  </p>
                </div>
              </div>

              {/* Example prompt (shown on hover or select) */}
              {feature.examplePrompt && (isHovered || isSelected) && (
                <div className="mt-2 pt-3 border-t border-neutral-100 dark:border-neutral-700">
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-1">例:</p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300 italic">
                    "{feature.examplePrompt}"
                  </p>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Stats footer */}
      <div className="flex items-center justify-center gap-6 pt-4 text-sm text-neutral-500 dark:text-neutral-400">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-primary-500" />
          <span>{FEATURES.filter(f => f.badge === 'recommended').length}件のおすすめ</span>
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-orange-500" />
          <span>{FEATURES.filter(f => f.badge === 'popular').length}件の人気機能</span>
        </div>
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-green-500" />
          <span>{FEATURES.filter(f => f.badge === 'new').length}件の新機能</span>
        </div>
      </div>
    </div>
  );
}
