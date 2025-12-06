import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Wand2, 
  Image as ImageIcon, 
  ChevronDown,
  Loader2,
  Download,
  Heart,
  RefreshCw,
  ArrowLeft,
  Sparkles,
  History,
  FolderOpen,
  ExternalLink,
  Plus,
  Minus,
  Sliders
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { Button, Textarea, Input } from '../components/ui';
import { FeatureSelector, type Feature } from '../components/FeatureSelector';
import { PromptHistory, usePromptHistory } from '../components/PromptHistory';
import { ImageSelector, type SelectedImage, type ReferenceType } from '../components/ImageSelector';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

const stylePresets = [
  { id: 'minimal', name: 'ミニマル', prompt: 'minimalist, clean, simple' },
  { id: 'luxury', name: 'ラグジュアリー', prompt: 'luxury, premium, elegant' },
  { id: 'street', name: 'ストリート', prompt: 'street fashion, urban, casual' },
  { id: 'vintage', name: 'ヴィンテージ', prompt: 'vintage, retro, classic' },
  { id: 'modern', name: 'モダン', prompt: 'modern, contemporary, sleek' },
  { id: 'natural', name: 'ナチュラル', prompt: 'natural, organic, soft' }
];

const aspectRatios = [
  { id: '1:1', name: '正方形', width: 1024, height: 1024 },
  { id: '4:3', name: '横長', width: 1024, height: 768 },
  { id: '3:4', name: '縦長', width: 768, height: 1024 },
  { id: '16:9', name: 'ワイド', width: 1024, height: 576 },
  { id: '9:16', name: 'ストーリー', width: 576, height: 1024 }
];

const backgroundOptions = [
  { id: 'white', name: '白背景', prompt: 'white background, studio lighting' },
  { id: 'transparent', name: '透明', prompt: 'transparent background' },
  { id: 'studio', name: 'スタジオ', prompt: 'professional studio background, soft lighting' },
  { id: 'outdoor', name: '屋外', prompt: 'outdoor natural background, daylight' },
  { id: 'urban', name: '都市', prompt: 'urban city background, street scene' },
  { id: 'nature', name: '自然', prompt: 'nature background, forest or garden' },
  { id: 'custom', name: 'カスタム', prompt: '' },
  { id: 'reference', name: '参考画像から', prompt: '' },
];

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
  { id: 'custom', name: 'カスタム', icon: '📷' },
];

const sceneOptions = [
  { id: 'cafe', name: 'カフェ', prompt: 'in a cozy cafe, warm lighting' },
  { id: 'street', name: 'ストリート', prompt: 'on urban street, city background' },
  { id: 'office', name: 'オフィス', prompt: 'in modern office, professional setting' },
  { id: 'outdoor', name: 'アウトドア', prompt: 'outdoor nature, park or garden' },
  { id: 'beach', name: 'ビーチ', prompt: 'beach seaside, summer vibe' },
  { id: 'studio', name: 'スタジオ', prompt: 'professional studio, clean background' },
];

// Feature configuration for reference images
const FEATURE_CONFIG: Record<string, {
  requiresImage: boolean;
  allowedReferenceTypes: ReferenceType[];
  defaultReferenceType: ReferenceType;
  referenceLabel: string;
  referenceHint: string;
}> = {
  'campaign-image': {
    requiresImage: false,
    allowedReferenceTypes: ['style', 'composition'],
    defaultReferenceType: 'style',
    referenceLabel: '参考画像（任意）',
    referenceHint: 'スタイルや構図の参考として使用されます',
  },
  'scene-coordinate': {
    requiresImage: true,
    allowedReferenceTypes: ['base'],
    defaultReferenceType: 'base',
    referenceLabel: '商品画像',
    referenceHint: 'この商品を様々なシーンに配置します',
  },
  'colorize': {
    requiresImage: true,
    allowedReferenceTypes: ['base', 'pattern'],
    defaultReferenceType: 'base',
    referenceLabel: '対象画像',
    referenceHint: 'カラバリや柄を変更する画像',
  },
  'design-gacha': {
    requiresImage: false,
    allowedReferenceTypes: ['style', 'base'],
    defaultReferenceType: 'style',
    referenceLabel: '参考画像（任意）',
    referenceHint: 'スタイルの参考またはベース画像として使用',
  },
  'product-shots': {
    requiresImage: false,
    allowedReferenceTypes: ['base', 'style'],
    defaultReferenceType: 'base',
    referenceLabel: '実物商品画像（任意）',
    referenceHint: 'アップロードすると、この画像を元に4方向のカットを生成します',
  },
  'model-matrix': {
    requiresImage: false,
    allowedReferenceTypes: ['base', 'style'],
    defaultReferenceType: 'base',
    referenceLabel: '商品画像（任意）',
    referenceHint: 'モデルに着用させる商品の参考画像',
  },
  'multilingual-banner': {
    requiresImage: false,
    allowedReferenceTypes: ['base', 'style'],
    defaultReferenceType: 'base',
    referenceLabel: 'ベース画像（任意）',
    referenceHint: 'バナーの背景やベースとして使用',
  },
  'remove-bg': {
    requiresImage: true,
    allowedReferenceTypes: ['base'],
    defaultReferenceType: 'base',
    referenceLabel: '対象画像',
    referenceHint: '背景を削除する画像',
  },
  'upscale': {
    requiresImage: true,
    allowedReferenceTypes: ['base'],
    defaultReferenceType: 'base',
    referenceLabel: '対象画像',
    referenceHint: '高解像度化する画像',
  },
  'variations': {
    requiresImage: true,
    allowedReferenceTypes: ['base'],
    defaultReferenceType: 'base',
    referenceLabel: '元画像',
    referenceHint: 'この画像のバリエーションを生成します',
  },
  'optimize-prompt': {
    requiresImage: false,
    allowedReferenceTypes: ['style'],
    defaultReferenceType: 'style',
    referenceLabel: '参考画像（任意）',
    referenceHint: 'この画像のスタイルを参考にプロンプトを最適化',
  },
};

interface GeneratedResult {
  id: string;
  imageUrl: string;
  prompt: string;
  label?: string;
}

export function GeneratePage() {
  const { currentBrand } = useAuthStore();
  const { addToHistory } = usePromptHistory();
  
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [prompt, setPrompt] = useState('');
  const [showPromptHistory, setShowPromptHistory] = useState(false);
  const [showSuccessCard, setShowSuccessCard] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [selectedRatio, setSelectedRatio] = useState('1:1');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedResult[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generateCount, setGenerateCount] = useState(1);
  
  // Reference image state
  const [referenceImage, setReferenceImage] = useState<SelectedImage | null>(null);
  const [backgroundReferenceImage, setBackgroundReferenceImage] = useState<SelectedImage | null>(null);
  const [patternReferenceImage, setPatternReferenceImage] = useState<SelectedImage | null>(null);
  
  // Feature-specific state
  const [productDescription, setProductDescription] = useState('');
  const [headline, setHeadline] = useState('');
  const [subheadline, setSubheadline] = useState('');
  const [selectedLanguages, setSelectedLanguages] = useState(['ja', 'en']);
  const [selectedBodyTypes, setSelectedBodyTypes] = useState(['slim', 'regular', 'plus']);
  const [selectedAgeGroups, setSelectedAgeGroups] = useState(['20s', '30s', '40s']);
  const [selectedScenes, setSelectedScenes] = useState(['cafe', 'street', 'office']);
  
  // Background & Color options
  const [selectedBackground, setSelectedBackground] = useState('white');
  const [customBackground, setCustomBackground] = useState('');
  const [selectedColors, setSelectedColors] = useState<string[]>(['red', 'blue', 'green']);
  const [customColor, setCustomColor] = useState('#000000');
  const [selectedPattern, setSelectedPattern] = useState('solid');
  const [upscaleScale, setUpscaleScale] = useState<2 | 4>(2);
  const [variationStrength, setVariationStrength] = useState(50);
  
  // Upscale options
  const [denoiseLevel, setDenoiseLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const [sharpness, setSharpness] = useState(50);
  
  // Model options
  const [skinTone, setSkinTone] = useState<'light' | 'medium' | 'dark'>('medium');
  const [hairStyle, setHairStyle] = useState<'short' | 'medium' | 'long'>('medium');

  const featureConfig = selectedFeature ? FEATURE_CONFIG[selectedFeature.id] : null;

  const handleFeatureSelect = (feature: Feature) => {
    setSelectedFeature(feature);
    setGeneratedImages([]);
    setReferenceImage(null);
    setBackgroundReferenceImage(null);
    setPatternReferenceImage(null);
    setShowSuccessCard(false);
  };

  const handleBack = () => {
    setSelectedFeature(null);
    setGeneratedImages([]);
    setReferenceImage(null);
    setBackgroundReferenceImage(null);
    setPatternReferenceImage(null);
    setShowSuccessCard(false);
  };

  const handleGenerate = async () => {
    if (!currentBrand) {
      toast.error('ブランドを選択してください');
      return;
    }

    // Validate required image
    if (featureConfig?.requiresImage && !referenceImage) {
      toast.error('画像をアップロードしてください');
      return;
    }

    setIsGenerating(true);
    
    try {
      let data: any;
      let error: any;

      const baseBody = {
        brandId: currentBrand.id,
        referenceImage: referenceImage?.url,
        referenceType: referenceImage?.referenceType,
      };

      switch (selectedFeature?.id) {
        case 'remove-bg':
          const bgPrompt = selectedBackground === 'custom' ? customBackground : 
            selectedBackground === 'reference' && backgroundReferenceImage ? 'use reference image' :
            backgroundOptions.find(b => b.id === selectedBackground)?.prompt || '';
          
          ({ data, error } = await supabase.functions.invoke('remove-background', {
            body: { 
              ...baseBody,
              imageUrl: referenceImage?.url, 
              newBackground: bgPrompt,
              backgroundReferenceImage: backgroundReferenceImage?.url,
            }
          }));
          if (data?.resultUrl) {
            setGeneratedImages([{
              id: Date.now().toString(),
              imageUrl: data.resultUrl,
              prompt: `背景: ${backgroundOptions.find(b => b.id === selectedBackground)?.name || customBackground}`,
              label: '背景変更'
            }]);
          }
          break;

        case 'colorize':
          ({ data, error } = await supabase.functions.invoke('colorize', {
            body: { 
              ...baseBody,
              imageUrl: referenceImage?.url, 
              colors: selectedColors.includes('custom') ? [...selectedColors.filter(c => c !== 'custom'), customColor] : selectedColors,
              pattern: selectedPattern,
              patternReferenceImage: patternReferenceImage?.url,
              count: generateCount,
            }
          }));
          if (data?.variations) {
            setGeneratedImages(data.variations.map((v: any) => ({
              id: v.storagePath || Date.now().toString(),
              imageUrl: v.imageUrl,
              prompt: v.colorName,
              label: v.colorName
            })));
          }
          break;

        case 'upscale':
          ({ data, error } = await supabase.functions.invoke('upscale', {
            body: { 
              ...baseBody,
              imageUrl: referenceImage?.url, 
              scale: upscaleScale,
              denoiseLevel,
              sharpness,
            }
          }));
          if (data?.resultUrl) {
            setGeneratedImages([{
              id: Date.now().toString(),
              imageUrl: data.resultUrl,
              prompt: `${upscaleScale}倍アップスケール`,
              label: `${upscaleScale}x 高解像度`
            }]);
          }
          break;

        case 'variations':
          ({ data, error } = await supabase.functions.invoke('generate-variations', {
            body: { 
              ...baseBody,
              imageUrl: referenceImage?.url, 
              count: generateCount,
              strength: variationStrength / 100,
              prompt: prompt || undefined
            }
          }));
          if (data?.variations) {
            setGeneratedImages(data.variations.map((v: any, i: number) => ({
              id: v.storagePath || Date.now().toString() + i,
              imageUrl: v.imageUrl,
              prompt: prompt || 'バリエーション',
              label: `バリエーション ${i + 1}`
            })));
          }
          break;

        case 'scene-coordinate':
          if (!referenceImage) {
            toast.error('商品画像をアップロードしてください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('generate-variations', {
            body: { 
              ...baseBody,
              imageUrl: referenceImage.url,
              scenes: selectedScenes.map(s => sceneOptions.find(sc => sc.id === s)?.prompt),
              count: selectedScenes.length,
            }
          }));
          if (data?.variations) {
            setGeneratedImages(data.variations.map((v: any, i: number) => ({
              id: v.storagePath || Date.now().toString() + i,
              imageUrl: v.imageUrl,
              prompt: selectedScenes[i],
              label: sceneOptions.find(s => s.id === selectedScenes[i])?.name || `シーン ${i + 1}`
            })));
          }
          break;

        case 'design-gacha':
          if (!prompt.trim()) {
            toast.error('ブリーフを入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('design-gacha', {
            body: { 
              ...baseBody,
              brief: prompt, 
              directions: generateCount 
            }
          }));
          if (data?.variations) {
            setGeneratedImages(data.variations.map((v: any) => ({
              id: v.storagePath,
              imageUrl: v.imageUrl,
              prompt: v.prompt,
              label: v.directionName
            })));
          }
          break;

        case 'product-shots':
          if (!productDescription.trim() && !referenceImage) {
            toast.error('商品説明または商品画像を入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('product-shots', {
            body: { 
              ...baseBody,
              productDescription,
              selectedShots: ['front', 'side', 'back', 'detail'].slice(0, generateCount),
              background: selectedBackground,
            }
          }));
          if (data?.shots) {
            setGeneratedImages(data.shots.map((s: any) => ({
              id: s.storagePath,
              imageUrl: s.imageUrl,
              prompt: productDescription,
              label: s.shotName
            })));
          }
          break;

        case 'model-matrix':
          if (!productDescription.trim() && !referenceImage) {
            toast.error('商品説明または商品画像を入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('model-matrix', {
            body: { 
              ...baseBody,
              productDescription, 
              bodyTypes: selectedBodyTypes,
              ageGroups: selectedAgeGroups,
              skinTone,
              hairStyle,
            }
          }));
          if (data?.matrix) {
            setGeneratedImages(data.matrix.map((m: any) => ({
              id: m.storagePath,
              imageUrl: m.imageUrl,
              prompt: productDescription,
              label: `${m.bodyTypeName} × ${m.ageGroupName}`
            })));
          }
          break;

        case 'multilingual-banner':
          if (!headline.trim()) {
            toast.error('ヘッドラインを入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('multilingual-banner', {
            body: { 
              ...baseBody,
              headline, 
              subheadline,
              languages: selectedLanguages,
              aspectRatio: selectedRatio
            }
          }));
          if (data?.banners) {
            setGeneratedImages(data.banners.map((b: any) => ({
              id: b.storagePath,
              imageUrl: b.imageUrl,
              prompt: b.headline,
              label: b.languageName
            })));
          }
          break;

        case 'optimize-prompt':
          if (!prompt.trim()) {
            toast.error('プロンプトを入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('optimize-prompt', {
            body: { 
              prompt, 
              style: selectedStyle,
              referenceImageUrl: referenceImage?.url,
            }
          }));
          if (data?.optimized_prompt) {
            toast.success('プロンプトを最適化しました');
            setPrompt(data.optimized_prompt);
            if (data.negative_prompt) {
              setNegativePrompt(data.negative_prompt);
            }
          }
          break;

        case 'campaign-image':
        default:
          if (!prompt.trim()) {
            toast.error('プロンプトを入力してください');
            setIsGenerating(false);
            return;
          }
          let fullPrompt = prompt;
          if (selectedStyle) {
            const style = stylePresets.find(s => s.id === selectedStyle);
            if (style) {
              fullPrompt = `${prompt}, ${style.prompt}`;
            }
          }
          const ratio = aspectRatios.find(r => r.id === selectedRatio) || aspectRatios[0];
          ({ data, error } = await supabase.functions.invoke('generate-image', {
            body: {
              ...baseBody,
              prompt: fullPrompt,
              negativePrompt,
              width: ratio.width,
              height: ratio.height,
              count: generateCount,
            }
          }));
          if (data?.images) {
            setGeneratedImages(prev => [...data.images, ...prev]);
          }
      }

      if (error) throw error;
      
      if (selectedFeature?.id !== 'optimize-prompt') {
        const promptToSave = prompt || productDescription || headline;
        if (promptToSave) {
          addToHistory(promptToSave, selectedFeature?.name);
        }
        setShowSuccessCard(true);
        toast.success('生成が完了しました');
      }
    } catch (error: any) {
      console.error('Generation error:', error);
      // Try to get detailed error from response
      let errorMessage = error.message || '生成に失敗しました';
      if (error.context?.body) {
        try {
          const body = JSON.parse(error.context.body);
          errorMessage = body.error || body.details || errorMessage;
          console.error('Error details:', body);
        } catch {}
      }
      toast.error(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async (imageUrl: string, filename: string = 'generated-image.png') => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('ダウンロードしました');
    } catch {
      toast.error('ダウンロードに失敗しました');
    }
  };

  // Render generation count selector
  const renderCountSelector = (label: string = '生成数', min: number = 1, max: number = 8) => (
    <div className="mb-4">
      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setGenerateCount(Math.max(min, generateCount - 1))}
          disabled={generateCount <= min}
          className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50"
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="w-12 text-center font-semibold text-lg">{generateCount}</span>
        <button
          onClick={() => setGenerateCount(Math.min(max, generateCount + 1))}
          disabled={generateCount >= max}
          className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
        </button>
        <span className="text-sm text-neutral-500">枚</span>
      </div>
    </div>
  );

  const renderFeatureForm = () => {
    if (!selectedFeature) return null;

    const config = FEATURE_CONFIG[selectedFeature.id];

    switch (selectedFeature.id) {
      // === IMAGE REQUIRED FEATURES ===
      
      case 'remove-bg':
        return (
          <div className="space-y-4">
            <ImageSelector
              label={config?.referenceLabel || '対象画像'}
              required
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base']}
              defaultReferenceType="base"
              hint={config?.referenceHint}
            />
            
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                新しい背景
              </label>
              <div className="grid grid-cols-4 gap-2">
                {backgroundOptions.map((bg) => (
                  <button
                    key={bg.id}
                    onClick={() => setSelectedBackground(bg.id)}
                    className={`px-3 py-2 text-sm rounded-lg border-2 transition-all ${
                      selectedBackground === bg.id
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {bg.name}
                  </button>
                ))}
              </div>
              
              {selectedBackground === 'custom' && (
                <Input
                  className="mt-3"
                  placeholder="カスタム背景の説明（例: 海辺のビーチ）"
                  value={customBackground}
                  onChange={(e) => setCustomBackground(e.target.value)}
                />
              )}

              {selectedBackground === 'reference' && (
                <div className="mt-3">
                  <ImageSelector
                    label="背景参考画像"
                    value={backgroundReferenceImage}
                    onChange={setBackgroundReferenceImage}
                    allowedReferenceTypes={['base']}
                    defaultReferenceType="base"
                    hint="この画像を背景として合成します"
                  />
                </div>
              )}
            </div>
          </div>
        );

      case 'colorize':
        return (
          <div className="space-y-4">
            <ImageSelector
              label={config?.referenceLabel || '対象画像'}
              required
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base']}
              defaultReferenceType="base"
              hint={config?.referenceHint}
            />
            
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                生成するカラー（複数選択可）
              </label>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color.id}
                    onClick={() => {
                      setSelectedColors(prev => 
                        prev.includes(color.id)
                          ? prev.filter(c => c !== color.id)
                          : [...prev, color.id]
                      );
                    }}
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
                  onClick={() => {
                    setSelectedColors(prev => 
                      prev.includes('custom')
                        ? prev.filter(c => c !== 'custom')
                        : [...prev, 'custom']
                    );
                  }}
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
              <div className="grid grid-cols-5 gap-2">
                {patternOptions.map((pattern) => (
                  <button
                    key={pattern.id}
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

              {selectedPattern === 'custom' && (
                <div className="mt-3">
                  <ImageSelector
                    label="パターン参考画像"
                    value={patternReferenceImage}
                    onChange={setPatternReferenceImage}
                    allowedReferenceTypes={['pattern']}
                    defaultReferenceType="pattern"
                    hint="この柄・テクスチャを適用します"
                  />
                </div>
              )}
            </div>

            {renderCountSelector('生成数', 1, 12)}
          </div>
        );

      case 'upscale':
        return (
          <div className="space-y-4">
            <ImageSelector
              label={config?.referenceLabel || '対象画像'}
              required
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base']}
              defaultReferenceType="base"
              hint={config?.referenceHint}
            />
            
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                アップスケール倍率
              </label>
              <div className="flex gap-3">
                {([2, 4] as const).map((scale) => (
                  <button
                    key={scale}
                    onClick={() => setUpscaleScale(scale)}
                    className={`flex-1 py-4 rounded-xl border-2 transition-all ${
                      upscaleScale === scale
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <div className="text-2xl font-bold text-neutral-800 dark:text-white">{scale}x</div>
                    <div className="text-sm text-neutral-500 dark:text-neutral-400">
                      {scale === 2 ? '2048×2048' : '4096×4096'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                <Sliders className="w-4 h-4 inline mr-1" />
                品質オプション
              </label>
              <div className="space-y-3 p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-neutral-600 dark:text-neutral-400">ノイズ除去</span>
                    <span className="text-neutral-800 dark:text-neutral-200">{denoiseLevel === 'low' ? '弱' : denoiseLevel === 'medium' ? '中' : '強'}</span>
                  </div>
                  <div className="flex gap-2">
                    {(['low', 'medium', 'high'] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => setDenoiseLevel(level)}
                        className={`flex-1 py-1.5 text-xs rounded-lg transition-all ${
                          denoiseLevel === level
                            ? 'bg-primary-500 text-white'
                            : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        {level === 'low' ? '弱' : level === 'medium' ? '中' : '強'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-neutral-600 dark:text-neutral-400">シャープネス</span>
                    <span className="text-neutral-800 dark:text-neutral-200">{sharpness}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sharpness}
                    onChange={(e) => setSharpness(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case 'variations':
        return (
          <div className="space-y-4">
            <ImageSelector
              label={config?.referenceLabel || '元画像'}
              required
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base']}
              defaultReferenceType="base"
              hint={config?.referenceHint}
            />
            
            {renderCountSelector('生成数', 2, 8)}

            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">類似度</span>
                <span className="text-neutral-500">{variationStrength}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="90"
                value={variationStrength}
                onChange={(e) => setVariationStrength(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-neutral-500 mt-1">
                <span>大きく変化</span>
                <span>ほぼ同じ</span>
              </div>
            </div>
            
            <Textarea
              label="追加の指示（任意）"
              placeholder="例: 色味を少し明るくして、背景をぼかして"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
            />
          </div>
        );

      case 'scene-coordinate':
        return (
          <div className="space-y-4">
            <ImageSelector
              label="商品画像"
              required
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base']}
              defaultReferenceType="base"
              hint="この商品を様々なシーンに配置します"
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                シーン選択（複数選択可）
              </label>
              <div className="grid grid-cols-3 gap-2">
                {sceneOptions.map((scene) => (
                  <button
                    key={scene.id}
                    onClick={() => {
                      setSelectedScenes(prev =>
                        prev.includes(scene.id)
                          ? prev.filter(s => s !== scene.id)
                          : [...prev, scene.id]
                      );
                    }}
                    className={`px-3 py-2 text-sm rounded-lg border-2 transition-all ${
                      selectedScenes.includes(scene.id)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {scene.name}
                  </button>
                ))}
              </div>
              <p className="text-xs text-neutral-500 mt-2">
                {selectedScenes.length}シーンを生成します
              </p>
            </div>
          </div>
        );

      // === TEXT-TO-IMAGE FEATURES WITH OPTIONAL REFERENCE ===

      case 'design-gacha':
        return (
          <div className="space-y-4">
            <Textarea
              label="ブリーフ（商品コンセプト）"
              placeholder="例: 20代女性向けのカジュアルなサマードレス"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />

            <ImageSelector
              label={config?.referenceLabel || '参考画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['style', 'base']}
              defaultReferenceType={config?.defaultReferenceType || 'style'}
              hint={config?.referenceHint}
            />

            {renderCountSelector('スタイル数', 2, 8)}

            <div className="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-4">
              <p className="text-sm text-primary-800 dark:text-primary-200">
                💡 {generateCount}つのスタイル方向（ミニマル、ラグジュアリー、ストリート等）から生成します
              </p>
            </div>
          </div>
        );

      case 'product-shots':
        return (
          <div className="space-y-4">
            <Textarea
              label="商品説明"
              placeholder="例: 白いコットンTシャツ、クルーネック、シンプルなデザイン"
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={3}
            />

            <ImageSelector
              label={config?.referenceLabel || '実物商品画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['base', 'style']}
              defaultReferenceType={config?.defaultReferenceType || 'base'}
              hint={config?.referenceHint}
            />

            {renderCountSelector('カット数', 1, 4)}

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                背景
              </label>
              <div className="flex gap-2 flex-wrap">
                {['white', 'studio', 'transparent'].map((bg) => (
                  <button
                    key={bg}
                    onClick={() => setSelectedBackground(bg)}
                    className={`px-4 py-2 text-sm rounded-lg border-2 transition-all ${
                      selectedBackground === bg
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {backgroundOptions.find(b => b.id === bg)?.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                📸 正面・側面・背面・ディテールの{generateCount}カットを生成します
              </p>
            </div>
          </div>
        );

      case 'model-matrix':
        return (
          <div className="space-y-4">
            <Textarea
              label="商品説明"
              placeholder="例: ネイビーのスリムフィットジーンズ"
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={3}
            />

            <ImageSelector
              label={config?.referenceLabel || '商品画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['base', 'style']}
              defaultReferenceType={config?.defaultReferenceType || 'base'}
              hint={config?.referenceHint}
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">体型</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { id: 'slim', name: 'スリム' },
                  { id: 'regular', name: 'レギュラー' },
                  { id: 'plus', name: 'プラス' }
                ].map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setSelectedBodyTypes(prev =>
                      prev.includes(type.id) ? prev.filter(t => t !== type.id) : [...prev, type.id]
                    )}
                    className={`px-4 py-2 rounded-lg border-2 transition-all ${
                      selectedBodyTypes.includes(type.id)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {type.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">年代</label>
              <div className="flex gap-2 flex-wrap">
                {['20s', '30s', '40s', '50s'].map((age) => (
                  <button
                    key={age}
                    onClick={() => setSelectedAgeGroups(prev =>
                      prev.includes(age) ? prev.filter(a => a !== age) : [...prev, age]
                    )}
                    className={`px-4 py-2 rounded-lg border-2 transition-all ${
                      selectedAgeGroups.includes(age)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {age}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              モデル詳細オプション
            </button>

            {showAdvanced && (
              <div className="space-y-3 p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl">
                <div>
                  <label className="block text-xs text-neutral-600 dark:text-neutral-400 mb-1">肌トーン</label>
                  <div className="flex gap-2">
                    {(['light', 'medium', 'dark'] as const).map((tone) => (
                      <button
                        key={tone}
                        onClick={() => setSkinTone(tone)}
                        className={`flex-1 py-1.5 text-xs rounded-lg transition-all ${
                          skinTone === tone
                            ? 'bg-primary-500 text-white'
                            : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        {tone === 'light' ? '明るめ' : tone === 'medium' ? '中間' : '暗め'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-neutral-600 dark:text-neutral-400 mb-1">髪の長さ</label>
                  <div className="flex gap-2">
                    {(['short', 'medium', 'long'] as const).map((style) => (
                      <button
                        key={style}
                        onClick={() => setHairStyle(style)}
                        className={`flex-1 py-1.5 text-xs rounded-lg transition-all ${
                          hairStyle === style
                            ? 'bg-primary-500 text-white'
                            : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        {style === 'short' ? 'ショート' : style === 'medium' ? 'ミディアム' : 'ロング'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                ⚠️ {selectedBodyTypes.length * selectedAgeGroups.length}パターンを生成します
                {selectedBodyTypes.length * selectedAgeGroups.length > 6 && '（生成に時間がかかる場合があります）'}
              </p>
            </div>
          </div>
        );

      case 'multilingual-banner':
        return (
          <div className="space-y-4">
            <Input
              label="ヘッドライン"
              placeholder="例: SUMMER SALE"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
            <Input
              label="サブヘッドライン（任意）"
              placeholder="例: 最大50%OFF"
              value={subheadline}
              onChange={(e) => setSubheadline(e.target.value)}
            />

            <ImageSelector
              label={config?.referenceLabel || 'ベース画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['base', 'style']}
              defaultReferenceType={config?.defaultReferenceType || 'base'}
              hint={config?.referenceHint}
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">言語</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { code: 'ja', name: '日本語' },
                  { code: 'en', name: 'English' },
                  { code: 'zh', name: '中文' },
                  { code: 'ko', name: '한국어' }
                ].map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => setSelectedLanguages(prev =>
                      prev.includes(lang.code) ? prev.filter(l => l !== lang.code) : [...prev, lang.code]
                    )}
                    className={`px-4 py-2 rounded-lg border-2 transition-all ${
                      selectedLanguages.includes(lang.code)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {lang.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">サイズ</label>
              <div className="flex gap-2 flex-wrap">
                {aspectRatios.map((ratio) => (
                  <button
                    key={ratio.id}
                    onClick={() => setSelectedRatio(ratio.id)}
                    className={`px-4 py-2 rounded-lg border-2 transition-all ${
                      selectedRatio === ratio.id
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {ratio.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      case 'optimize-prompt':
        return (
          <div className="space-y-4">
            <Textarea
              label="日本語プロンプト"
              placeholder="例: 白いTシャツを着たモデル、スタジオ撮影"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />

            <ImageSelector
              label={config?.referenceLabel || '参考画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['style']}
              defaultReferenceType={config?.defaultReferenceType || 'style'}
              hint={config?.referenceHint}
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">スタイル</label>
              <div className="flex flex-wrap gap-2">
                {stylePresets.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setSelectedStyle(selectedStyle === style.id ? null : style.id)}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
                      selectedStyle === style.id
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {style.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                ✨ 日本語プロンプトを英語に翻訳し、AI画像生成に最適化します
              </p>
            </div>
          </div>
        );

      case 'chat-edit':
        return (
          <div className="space-y-4">
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-6 text-center">
              <Wand2 className="w-12 h-12 text-purple-500 mx-auto mb-3" />
              <h3 className="font-semibold text-neutral-800 dark:text-white mb-2">
                チャットベース編集
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-4">
                対話形式で画像を編集できます。キャンバスエディターでお使いください。
              </p>
              <Link to="/canvas">
                <Button>
                  キャンバスを開く
                  <ExternalLink className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        );

      // === DEFAULT TEXT-TO-IMAGE ===
      default:
        return (
          <div className="space-y-4">
            <Textarea
              label="プロンプト"
              placeholder="生成したい画像を日本語で説明してください"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
            />

            <ImageSelector
              label={config?.referenceLabel || '参考画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['style', 'composition']}
              defaultReferenceType={config?.defaultReferenceType || 'style'}
              hint={config?.referenceHint}
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">スタイルプリセット</label>
              <div className="flex flex-wrap gap-2">
                {stylePresets.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setSelectedStyle(selectedStyle === style.id ? null : style.id)}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
                      selectedStyle === style.id
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {style.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">アスペクト比</label>
              <div className="flex flex-wrap gap-2">
                {aspectRatios.map((ratio) => (
                  <button
                    key={ratio.id}
                    onClick={() => setSelectedRatio(ratio.id)}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
                      selectedRatio === ratio.id
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {ratio.name}
                  </button>
                ))}
              </div>
            </div>

            {renderCountSelector('生成数', 1, 4)}

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              詳細オプション
            </button>
            {showAdvanced && (
              <Textarea
                label="ネガティブプロンプト"
                placeholder="生成したくない要素"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={2}
              />
            )}
          </div>
        );
    }
  };

  // Feature selection view
  if (!selectedFeature) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8"
      >
        <div className="mb-4 sm:mb-6 lg:mb-8">
          <h1 className="text-lg sm:text-xl lg:text-2xl font-display font-semibold text-neutral-900 dark:text-white mb-1 sm:mb-2">
            画像生成
          </h1>
          <p className="text-sm sm:text-base text-neutral-600 dark:text-neutral-400">
            生成したい機能を選択してください
          </p>
        </div>

        <FeatureSelector 
          onSelectFeature={handleFeatureSelect}
          selectedFeatureId={selectedFeature}
        />
      </motion.div>
    );
  }

  // Feature detail view
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
      <div className="grid xl:grid-cols-[400px,1fr] lg:grid-cols-1 gap-4 sm:gap-6 lg:gap-8">
        {/* Left Panel */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          <div>
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 mb-4 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              機能選択に戻る
            </button>
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-md ${
                featureConfig?.requiresImage 
                  ? 'bg-purple-100 dark:bg-purple-900/50' 
                  : 'bg-primary-100 dark:bg-primary-900/50'
              }`}>
                <selectedFeature.icon className={`w-6 h-6 ${
                  featureConfig?.requiresImage 
                    ? 'text-purple-600 dark:text-purple-400' 
                    : 'text-primary-600 dark:text-primary-400'
                }`} />
              </div>
              <div>
                <h1 className="text-xl font-display font-semibold text-neutral-900 dark:text-white">
                  {selectedFeature.name}
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {selectedFeature.description}
                </p>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-2xl dark:bg-neutral-800/50 dark:border-neutral-700/50">
            {/* Prompt History Button */}
            {!featureConfig?.requiresImage && selectedFeature.id !== 'chat-edit' && (
              <div className="flex justify-end mb-4">
                <button
                  onClick={() => setShowPromptHistory(true)}
                  className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
                >
                  <History className="w-4 h-4" />
                  履歴から選ぶ
                </button>
              </div>
            )}

            {renderFeatureForm()}

            {selectedFeature.id !== 'chat-edit' && (
              <Button
                onClick={handleGenerate}
                isLoading={isGenerating}
                disabled={isGenerating || (featureConfig?.requiresImage && !referenceImage)}
                className="w-full mt-6 shadow-glow hover:shadow-glow-lg transition-all duration-300"
                size="lg"
                leftIcon={isGenerating ? undefined : <Sparkles className="w-5 h-5" />}
              >
                {isGenerating ? '生成中...' : selectedFeature.id === 'optimize-prompt' ? '最適化' : '生成'}
              </Button>
            )}
          </div>
        </motion.div>

        {/* Right Panel - Results */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-neutral-800 dark:text-white flex items-center gap-2">
              生成結果
              {generatedImages.length > 0 && (
                <span className="text-xs font-normal text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">
                  {generatedImages.length}枚
                </span>
              )}
            </h2>
            {generatedImages.length > 0 && (
              <button
                onClick={() => {
                  setGeneratedImages([]);
                  setShowSuccessCard(false);
                }}
                className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                クリア
              </button>
            )}
          </div>

          {isGenerating && (
            <div className="glass-panel rounded-2xl p-12 text-center shadow-soft min-h-[400px] flex flex-col items-center justify-center">
              <div className="w-20 h-20 bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/50 dark:to-accent-900/50 rounded-2xl flex items-center justify-center mb-6 relative">
                <Loader2 className="w-10 h-10 text-primary-600 animate-spin relative z-10" />
                <div className="absolute inset-0 bg-primary-400/20 blur-xl animate-pulse-slow" />
              </div>
              <h3 className="text-xl font-medium text-neutral-700 dark:text-neutral-200 mb-2 font-display">
                生成しています...
              </h3>
              <p className="text-neutral-500 dark:text-neutral-400 max-w-xs mx-auto mb-8">
                {selectedFeature.id === 'model-matrix' ? '複数画像の生成には時間がかかります' : 'AIが画像を生成中です。通常20〜30秒ほどかかります。'}
              </p>
              <div className="w-64 h-1.5 bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-gradient-to-r from-primary-400 to-accent-400 rounded-full" 
                  initial={{ x: '-100%' }}
                  animate={{ x: '100%' }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                />
              </div>
            </div>
          )}

          {!isGenerating && generatedImages.length === 0 && (
            <div className="glass-panel rounded-2xl p-12 text-center border-2 border-dashed border-neutral-200/50 dark:border-neutral-700/50 min-h-[400px] flex flex-col items-center justify-center">
              <div className="w-20 h-20 bg-neutral-50 dark:bg-neutral-800/50 rounded-full flex items-center justify-center mb-6">
                <ImageIcon className="w-10 h-10 text-neutral-300 dark:text-neutral-600" />
              </div>
              <h3 className="text-lg font-medium text-neutral-700 dark:text-neutral-200 mb-2">
                生成結果がここに表示されます
              </h3>
              <p className="text-neutral-500 dark:text-neutral-400">
                {featureConfig?.requiresImage 
                  ? '画像をアップロードして開始' 
                  : '左のフォームに入力して開始'
                }
              </p>
            </div>
          )}

          {generatedImages.length > 0 && (
            <AnimatePresence>
              {/* Success Card */}
              {showSuccessCard && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6 bg-green-50/50 dark:bg-green-900/20 border border-green-200/50 dark:border-green-800/50 rounded-2xl p-4 backdrop-blur-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-green-100 dark:bg-green-800/50 rounded-full flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-green-800 dark:text-green-200 mb-1">
                        生成が完了しました！
                      </h3>
                      <p className="text-sm text-green-700 dark:text-green-300 mb-3">
                        {generatedImages.length}枚の画像がギャラリーに保存されました。
                      </p>
                      <div className="flex items-center gap-3">
                        <Link to="/gallery">
                          <Button size="sm" variant="secondary" className="bg-white/50 dark:bg-black/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 hover:bg-white/80">
                            <FolderOpen className="w-4 h-4 mr-1.5" />
                            ギャラリーで見る
                          </Button>
                        </Link>
                        <Link to="/canvas">
                          <Button size="sm" variant="ghost" className="text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30">
                            キャンバスで編集
                            <ExternalLink className="w-4 h-4 ml-1.5" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowSuccessCard(false)}
                      className="text-green-600 hover:text-green-800 dark:text-green-400 p-1 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </motion.div>
              )}

              <div className={`grid gap-6 ${
                generatedImages.length === 1 ? 'grid-cols-1' :
                generatedImages.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'
              }`}>
                {generatedImages.map((image, index) => (
                  <motion.div
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.1 }}
                    key={image.id || index}
                    className="group relative glass-card overflow-hidden hover:shadow-elegant transition-all duration-500 hover:-translate-y-1"
                  >
                    {image.label && (
                      <div className="absolute top-3 left-3 z-10 px-3 py-1 bg-black/50 backdrop-blur-md rounded-full text-white text-xs font-medium border border-white/10">
                        {image.label}
                      </div>
                    )}
                    <img
                      src={image.imageUrl}
                      alt={image.prompt}
                      className="w-full aspect-square object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300">
                      <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                        <p className="text-white text-sm line-clamp-2 mb-3 opacity-90">
                          {image.prompt}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDownload(image.imageUrl, `${image.label || 'image'}.png`)}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-white rounded-lg text-sm font-medium text-neutral-900 hover:bg-neutral-100 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            保存
                          </button>
                          <button className="p-2 bg-white/20 backdrop-blur-sm border border-white/30 rounded-lg text-white hover:bg-white/30 transition-colors">
                            <Heart className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          )}
        </motion.div>
      </div>

      {/* Prompt History Modal */}
      <PromptHistory
        isOpen={showPromptHistory}
        onClose={() => setShowPromptHistory(false)}
        onSelect={(selectedPrompt) => setPrompt(selectedPrompt)}
      />
    </div>
  );
}
