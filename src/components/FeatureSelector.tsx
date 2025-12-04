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
  Zap,
  Upload,
  Type,
  ArrowRight
} from 'lucide-react';
import { motion } from 'framer-motion';

export interface Feature {
  id: string;
  name: string;
  description: string;
  icon: any;
  category: 'marketing' | 'design' | 'ec' | 'utility' | 'workflow';
  apiEndpoint: string;
  badge?: 'recommended' | 'popular' | 'new';
  examplePrompt?: string;
  requiresImage?: boolean;
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
    examplePrompt: '商品画像をアップロード → シーンを選択',
    requiresImage: true,
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
    examplePrompt: '画像をアップロード → カラーを選択',
    requiresImage: true,
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
    examplePrompt: '画像をアップロード → 背景を選択',
    requiresImage: true,
  },
  {
    id: 'upscale',
    name: 'アップスケール',
    description: '高解像度再生成（2x/4x）',
    icon: Maximize2,
    category: 'utility',
    apiEndpoint: 'upscale',
    examplePrompt: '画像をアップロード → 倍率を選択',
    requiresImage: true,
  },
  {
    id: 'variations',
    name: 'バリエーション生成',
    description: '類似画像を複数生成',
    icon: RefreshCw,
    category: 'utility',
    apiEndpoint: 'generate-variations',
    examplePrompt: '画像をアップロード → バリエーション数を選択',
    requiresImage: true,
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

const BADGE_CONFIG = {
  recommended: {
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-800',
    icon: Star,
    label: 'おすすめ',
  },
  popular: {
    bg: 'bg-rose-50 dark:bg-rose-900/30',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-200 dark:border-rose-800',
    icon: TrendingUp,
    label: '人気',
  },
  new: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-800',
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

  const filteredFeatures = activeCategory === 'all'
    ? FEATURES
    : FEATURES.filter(f => f.category === activeCategory);

  const sortedFeatures = [...filteredFeatures].sort((a, b) => {
    const priority = { recommended: 0, popular: 1, new: 2 };
    const aPriority = a.badge ? priority[a.badge] : 3;
    const bPriority = b.badge ? priority[b.badge] : 3;
    return aPriority - bPriority;
  });

  return (
    <div className="space-y-8">
      {/* Quick start section */}
      {activeCategory === 'all' && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden bg-gradient-to-br from-primary-500 to-primary-700 dark:from-primary-600 dark:to-primary-800 rounded-2xl p-6 text-white"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <div className="relative z-10 flex items-start gap-5">
            <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold mb-2">
                🚀 まずはこれから始めよう
              </h3>
              <p className="text-white/80 text-sm mb-4 leading-relaxed">
                初めての方は「デザインガチャ」がおすすめ。1つのコンセプトから4つのスタイルを一気に生成できます。
              </p>
              <button
                onClick={() => onSelectFeature(FEATURES.find(f => f.id === 'design-gacha')!)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-primary-700 text-sm font-semibold rounded-xl hover:bg-white/90 transition-colors shadow-lg"
              >
                デザインガチャを試す
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`
              px-4 py-2.5 text-sm font-medium rounded-xl whitespace-nowrap transition-all duration-200
              ${activeCategory === cat.id
                ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-md'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }
            `}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sortedFeatures.map((feature, index) => {
          const Icon = feature.icon;
          const isSelected = selectedFeatureId === feature.id;
          const badge = feature.badge ? BADGE_CONFIG[feature.badge] : null;

          return (
            <motion.button
              key={feature.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => onSelectFeature(feature)}
              className={`
                group relative text-left p-5 rounded-2xl border-2 transition-all duration-300
                ${isSelected
                  ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/20 ring-4 ring-primary-500/10'
                  : 'border-neutral-200 dark:border-neutral-700/50 bg-white dark:bg-neutral-800/50 hover:border-neutral-300 dark:hover:border-neutral-600 hover:shadow-lg'
                }
              `}
            >
              {/* Header row with icon and badges */}
              <div className="flex items-start justify-between gap-3 mb-4">
                {/* Icon */}
                <div className={`
                  w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300
                  ${isSelected 
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/30' 
                    : 'bg-neutral-100 dark:bg-neutral-700/50 text-neutral-500 dark:text-neutral-400 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/30 group-hover:text-primary-600 dark:group-hover:text-primary-400'
                  }
                `}>
                  <Icon className="w-5 h-5" />
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Input type badge */}
                  <span className={`
                    inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-wide
                    ${feature.requiresImage 
                      ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                      : 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300'
                    }
                  `}>
                    {feature.requiresImage ? (
                      <>
                        <Upload className="w-3 h-3" />
                        画像
                      </>
                    ) : (
                      <>
                        <Type className="w-3 h-3" />
                        テキスト
                      </>
                    )}
                  </span>

                  {/* Status badge */}
                  {badge && (
                    <span className={`
                      inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold
                      ${badge.bg} ${badge.text}
                    `}>
                      <badge.icon className="w-3 h-3" />
                      {badge.label}
                    </span>
                  )}
                </div>
              </div>

              {/* Content */}
              <div>
                <h3 className={`
                  text-base font-semibold mb-1.5 transition-colors
                  ${isSelected 
                    ? 'text-primary-700 dark:text-primary-300' 
                    : 'text-neutral-800 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400'
                  }
                `}>
                  {feature.name}
                </h3>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                  {feature.description}
                </p>
              </div>

              {/* Hover arrow indicator */}
              <div className={`
                absolute right-4 bottom-4 w-8 h-8 rounded-full flex items-center justify-center
                transition-all duration-300 opacity-0 translate-x-2
                ${isSelected 
                  ? 'opacity-100 translate-x-0 bg-primary-500 text-white' 
                  : 'group-hover:opacity-100 group-hover:translate-x-0 bg-neutral-100 dark:bg-neutral-700 text-neutral-400'
                }
              `}>
                <ArrowRight className="w-4 h-4" />
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Stats footer */}
      <div className="flex items-center justify-center gap-8 pt-6 border-t border-neutral-100 dark:border-neutral-800">
        <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <div className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Star className="w-3 h-3 text-amber-600 dark:text-amber-400" />
          </div>
          <span>{FEATURES.filter(f => f.badge === 'recommended').length} おすすめ</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <div className="w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
            <TrendingUp className="w-3 h-3 text-rose-600 dark:text-rose-400" />
          </div>
          <span>{FEATURES.filter(f => f.badge === 'popular').length} 人気</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Zap className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          </div>
          <span>{FEATURES.filter(f => f.badge === 'new').length} 新機能</span>
        </div>
      </div>
    </div>
  );
}
