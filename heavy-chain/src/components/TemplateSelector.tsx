import { useState } from 'react';
import { 
  Image, 
  Square, 
  RectangleHorizontal, 
  RectangleVertical,
  Check
} from 'lucide-react';

export interface SizeTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  category: 'social' | 'ec' | 'banner' | 'custom';
  icon?: any;
}

export interface DesignTemplate {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  category: 'sns' | 'sale' | 'lookbook' | 'product';
  elements: any[];
}

const sizeTemplates: SizeTemplate[] = [
  // Social Media
  { id: 'instagram-post', name: 'Instagram投稿', width: 1080, height: 1080, category: 'social' },
  { id: 'instagram-story', name: 'Instagramストーリー', width: 1080, height: 1920, category: 'social' },
  { id: 'twitter-post', name: 'X/Twitter投稿', width: 1200, height: 675, category: 'social' },
  { id: 'tiktok', name: 'TikTok', width: 1080, height: 1920, category: 'social' },
  { id: 'facebook-post', name: 'Facebook投稿', width: 1200, height: 630, category: 'social' },
  
  // EC
  { id: 'ec-square', name: 'ECサムネイル', width: 1000, height: 1000, category: 'ec' },
  { id: 'ec-wide', name: 'EC横長', width: 1200, height: 800, category: 'ec' },
  { id: 'ec-detail', name: 'EC詳細', width: 800, height: 1200, category: 'ec' },
  
  // Banner
  { id: 'banner-wide', name: 'バナー（横長）', width: 1920, height: 600, category: 'banner' },
  { id: 'banner-medium', name: 'バナー（中）', width: 728, height: 90, category: 'banner' },
  { id: 'banner-square', name: 'バナー（正方形）', width: 300, height: 300, category: 'banner' },
];

const designTemplates: DesignTemplate[] = [
  {
    id: 'sale-banner',
    name: 'セールバナー',
    description: 'シンプルなセール告知用',
    thumbnail: '/templates/sale-banner.png',
    category: 'sale',
    elements: [
      { type: 'text', content: 'SALE', fontSize: 72, fontWeight: 'bold', x: 'center', y: 100 },
      { type: 'text', content: 'UP TO 50% OFF', fontSize: 32, x: 'center', y: 200 },
      { type: 'shape', shapeType: 'rect', fill: 'primary', x: 0, y: 0, width: '100%', height: 80 },
    ],
  },
  {
    id: 'new-arrival',
    name: '新作紹介',
    description: '新商品告知用',
    thumbnail: '/templates/new-arrival.png',
    category: 'sns',
    elements: [
      { type: 'text', content: 'NEW ARRIVAL', fontSize: 48, fontWeight: 'bold', x: 'center', y: 80 },
      { type: 'frame', x: 'center', y: 'center', width: 400, height: 400 },
    ],
  },
  {
    id: 'lookbook-2col',
    name: 'ルックブック（2列）',
    description: '2商品並列レイアウト',
    thumbnail: '/templates/lookbook-2col.png',
    category: 'lookbook',
    elements: [
      { type: 'frame', x: 50, y: 100, width: 450, height: 600 },
      { type: 'frame', x: 550, y: 100, width: 450, height: 600 },
      { type: 'text', content: 'COLLECTION', fontSize: 24, x: 'center', y: 750 },
    ],
  },
  {
    id: 'product-card',
    name: '商品カード',
    description: 'EC用商品紹介',
    thumbnail: '/templates/product-card.png',
    category: 'product',
    elements: [
      { type: 'frame', x: 'center', y: 50, width: 400, height: 400 },
      { type: 'text', content: '商品名', fontSize: 24, fontWeight: 'bold', x: 'center', y: 480 },
      { type: 'text', content: '¥0,000', fontSize: 20, x: 'center', y: 520 },
    ],
  },
  {
    id: 'seasonal',
    name: '季節キャンペーン',
    description: '季節プロモーション用',
    thumbnail: '/templates/seasonal.png',
    category: 'sale',
    elements: [
      { type: 'text', content: 'SPRING', fontSize: 64, fontWeight: 'bold', x: 'center', y: 80 },
      { type: 'text', content: 'COLLECTION 2025', fontSize: 24, x: 'center', y: 160 },
      { type: 'frame', x: 'center', y: 'center', width: 500, height: 350 },
    ],
  },
  {
    id: 'minimal-product',
    name: 'ミニマル商品',
    description: 'シンプルな商品写真',
    thumbnail: '/templates/minimal-product.png',
    category: 'product',
    elements: [
      { type: 'frame', x: 'center', y: 'center', width: 600, height: 600 },
    ],
  },
];

interface TemplateSelectorProps {
  mode: 'size' | 'design';
  onSelectSize?: (template: SizeTemplate) => void;
  onSelectDesign?: (template: DesignTemplate) => void;
  selectedSizeId?: string;
  selectedDesignId?: string;
}

export function TemplateSelector({
  mode,
  onSelectSize,
  onSelectDesign,
  selectedSizeId,
  selectedDesignId,
}: TemplateSelectorProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const sizeCategories = [
    { id: 'all', label: 'すべて' },
    { id: 'social', label: 'SNS' },
    { id: 'ec', label: 'EC' },
    { id: 'banner', label: 'バナー' },
  ];

  const designCategories = [
    { id: 'all', label: 'すべて' },
    { id: 'sns', label: 'SNS' },
    { id: 'sale', label: 'セール' },
    { id: 'lookbook', label: 'ルックブック' },
    { id: 'product', label: '商品' },
  ];

  const categories = mode === 'size' ? sizeCategories : designCategories;
  
  const filteredSizes = activeCategory === 'all' 
    ? sizeTemplates 
    : sizeTemplates.filter(t => t.category === activeCategory);

  const filteredDesigns = activeCategory === 'all'
    ? designTemplates
    : designTemplates.filter(t => t.category === activeCategory);

  const getAspectIcon = (width: number, height: number) => {
    if (width === height) return Square;
    if (width > height) return RectangleHorizontal;
    return RectangleVertical;
  };

  return (
    <div className="space-y-4">
      {/* Category tabs */}
      <div className="flex gap-1 p-1 bg-neutral-100 rounded-lg">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`
              flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors
              ${activeCategory === cat.id
                ? 'bg-white text-neutral-800 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700'
              }
            `}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Size templates */}
      {mode === 'size' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filteredSizes.map((template) => {
            const AspectIcon = getAspectIcon(template.width, template.height);
            const isSelected = selectedSizeId === template.id;

            return (
              <button
                key={template.id}
                onClick={() => onSelectSize?.(template)}
                className={`
                  relative p-4 rounded-xl border-2 text-left transition-all
                  ${isSelected
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-neutral-200 hover:border-neutral-300 bg-white'
                  }
                `}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                
                <div className="flex items-center gap-3 mb-2">
                  <div className={`
                    w-10 h-10 rounded-lg flex items-center justify-center
                    ${isSelected ? 'bg-primary-100' : 'bg-neutral-100'}
                  `}>
                    <AspectIcon className={`w-5 h-5 ${isSelected ? 'text-primary-600' : 'text-neutral-500'}`} />
                  </div>
                </div>
                
                <p className="font-medium text-sm text-neutral-800 mb-0.5">
                  {template.name}
                </p>
                <p className="text-xs text-neutral-500">
                  {template.width} × {template.height}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Design templates */}
      {mode === 'design' && (
        <div className="grid grid-cols-2 gap-4">
          {filteredDesigns.map((template) => {
            const isSelected = selectedDesignId === template.id;

            return (
              <button
                key={template.id}
                onClick={() => onSelectDesign?.(template)}
                className={`
                  relative rounded-xl border-2 overflow-hidden text-left transition-all
                  ${isSelected
                    ? 'border-primary-500'
                    : 'border-neutral-200 hover:border-neutral-300'
                  }
                `}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center z-10">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                
                {/* Thumbnail preview */}
                <div className="aspect-[4/3] bg-neutral-100 flex items-center justify-center">
                  <div className="w-24 h-24 bg-neutral-200 rounded-lg flex items-center justify-center">
                    <Image className="w-8 h-8 text-neutral-400" />
                  </div>
                </div>
                
                <div className="p-3">
                  <p className="font-medium text-sm text-neutral-800 mb-0.5">
                    {template.name}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {template.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Export templates for use elsewhere
export { sizeTemplates, designTemplates };

