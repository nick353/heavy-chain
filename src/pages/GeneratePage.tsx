import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Wand2, 
  Image, 
  ChevronDown,
  Loader2,
  Download,
  Heart,
  RefreshCw,
  ArrowLeft,
  Sparkles,
  History,
  FolderOpen,
  ExternalLink
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { Button, Textarea, Input, Modal } from '../components/ui';
import { FeatureSelector, FEATURES, type Feature } from '../components/FeatureSelector';
import { PromptHistory, usePromptHistory } from '../components/PromptHistory';
import toast from 'react-hot-toast';

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
  
  // Feature-specific state
  const [productDescription, setProductDescription] = useState('');
  const [headline, setHeadline] = useState('');
  const [subheadline, setSubheadline] = useState('');
  const [selectedLanguages, setSelectedLanguages] = useState(['ja', 'en']);
  const [selectedBodyTypes, setSelectedBodyTypes] = useState(['slim', 'regular', 'plus']);
  const [selectedAgeGroups, setSelectedAgeGroups] = useState(['20s', '30s', '40s']);

  const handleFeatureSelect = (feature: Feature) => {
    setSelectedFeature(feature);
    setGeneratedImages([]);
  };

  const handleBack = () => {
    setSelectedFeature(null);
    setGeneratedImages([]);
  };

  const handleGenerate = async () => {
    if (!currentBrand) {
      toast.error('ブランドを選択してください');
      return;
    }

    setIsGenerating(true);
    
    try {
      let data;
      let error;

      switch (selectedFeature?.id) {
        case 'design-gacha':
          if (!prompt.trim()) {
            toast.error('ブリーフを入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('design-gacha', {
            body: { brief: prompt, brandId: currentBrand.id, directions: 4 }
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
          if (!productDescription.trim()) {
            toast.error('商品説明を入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('product-shots', {
            body: { productDescription, brandId: currentBrand.id }
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
          if (!productDescription.trim()) {
            toast.error('商品説明を入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('model-matrix', {
            body: { 
              productDescription, 
              brandId: currentBrand.id,
              bodyTypes: selectedBodyTypes,
              ageGroups: selectedAgeGroups
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
              headline, 
              subheadline,
              brandId: currentBrand.id,
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
            body: { prompt, style: selectedStyle }
          }));
          if (data?.optimized_prompt) {
            toast.success('プロンプトを最適化しました');
            setPrompt(data.optimized_prompt);
            if (data.negative_prompt) {
              setNegativePrompt(data.negative_prompt);
            }
          }
          break;

        default:
          // Standard image generation
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
              prompt: fullPrompt,
              negativePrompt,
              width: ratio.width,
              height: ratio.height,
              brandId: currentBrand.id
            }
          }));
          if (data?.images) {
            setGeneratedImages(prev => [...data.images, ...prev]);
          }
      }

      if (error) throw error;
      if (selectedFeature?.id !== 'optimize-prompt') {
        // Add to history
        const promptToSave = prompt || productDescription || headline;
        if (promptToSave) {
          addToHistory(promptToSave, selectedFeature?.name);
        }
        setShowSuccessCard(true);
        toast.success('生成が完了しました');
      }
    } catch (error: any) {
      console.error('Generation error:', error);
      toast.error(error.message || '生成に失敗しました');
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

  const renderFeatureForm = () => {
    if (!selectedFeature) return null;

    switch (selectedFeature.id) {
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
            <p className="text-sm text-neutral-500">
              8つのスタイル方向（ミニマル、ラグジュアリー、ストリート等）から4つをランダムに選んで生成します
            </p>
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
            <p className="text-sm text-neutral-500">
              正面・側面・背面・ディテールの4カットを自動生成します
            </p>
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
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">体型</label>
              <div className="flex gap-2">
                {['slim', 'regular', 'plus'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedBodyTypes(prev =>
                      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                    )}
                    className={`px-3 py-1.5 text-sm rounded-full border ${
                      selectedBodyTypes.includes(type)
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200'
                    }`}
                  >
                    {type === 'slim' ? 'スリム' : type === 'regular' ? 'レギュラー' : 'プラス'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">年代</label>
              <div className="flex gap-2">
                {['20s', '30s', '40s', '50s'].map((age) => (
                  <button
                    key={age}
                    onClick={() => setSelectedAgeGroups(prev =>
                      prev.includes(age) ? prev.filter(a => a !== age) : [...prev, age]
                    )}
                    className={`px-3 py-1.5 text-sm rounded-full border ${
                      selectedAgeGroups.includes(age)
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200'
                    }`}
                  >
                    {age}
                  </button>
                ))}
              </div>
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
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">言語</label>
              <div className="flex gap-2">
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
                    className={`px-3 py-1.5 text-sm rounded-full border ${
                      selectedLanguages.includes(lang.code)
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200'
                    }`}
                  >
                    {lang.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">アスペクト比</label>
              <div className="flex gap-2">
                {aspectRatios.map((ratio) => (
                  <button
                    key={ratio.id}
                    onClick={() => setSelectedRatio(ratio.id)}
                    className={`px-3 py-1.5 text-sm rounded-full border ${
                      selectedRatio === ratio.id
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200'
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
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">スタイル</label>
              <div className="flex flex-wrap gap-2">
                {stylePresets.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setSelectedStyle(selectedStyle === style.id ? null : style.id)}
                    className={`px-3 py-1.5 text-sm rounded-full border ${
                      selectedStyle === style.id
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200'
                    }`}
                  >
                    {style.name}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-sm text-neutral-500">
              日本語プロンプトを英語に翻訳し、AI画像生成に最適化します
            </p>
          </div>
        );

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
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">スタイルプリセット</label>
              <div className="flex flex-wrap gap-2">
                {stylePresets.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setSelectedStyle(selectedStyle === style.id ? null : style.id)}
                    className={`px-3 py-1.5 text-sm rounded-full border ${
                      selectedStyle === style.id
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200'
                    }`}
                  >
                    {style.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">アスペクト比</label>
              <div className="flex flex-wrap gap-2">
                {aspectRatios.map((ratio) => (
                  <button
                    key={ratio.id}
                    onClick={() => setSelectedRatio(ratio.id)}
                    className={`px-3 py-1.5 text-sm rounded-full border ${
                      selectedRatio === ratio.id
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200'
                    }`}
                  >
                    {ratio.name}
                  </button>
                ))}
              </div>
            </div>
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-display font-semibold text-neutral-900 mb-2">
            画像生成
          </h1>
          <p className="text-neutral-600">
            生成したい機能を選択してください
          </p>
        </div>

        <FeatureSelector 
          onSelectFeature={handleFeatureSelect}
          selectedFeatureId={selectedFeature}
        />
      </div>
    );
  }

  // Feature detail view
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid lg:grid-cols-[400px,1fr] gap-8">
        {/* Left Panel */}
        <div className="space-y-6">
          <div>
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-neutral-500 hover:text-neutral-700 mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              機能選択に戻る
            </button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
                <selectedFeature.icon className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h1 className="text-xl font-display font-semibold text-neutral-900">
                  {selectedFeature.name}
                </h1>
                <p className="text-sm text-neutral-500">
                  {selectedFeature.description}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            {/* Prompt History Button */}
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowPromptHistory(true)}
                className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                <History className="w-4 h-4" />
                履歴から選ぶ
              </button>
            </div>

            {renderFeatureForm()}

            <Button
              onClick={handleGenerate}
              isLoading={isGenerating}
              disabled={isGenerating}
              className="w-full mt-6"
              size="lg"
              leftIcon={isGenerating ? undefined : <Sparkles className="w-5 h-5" />}
            >
              {isGenerating ? '生成中...' : selectedFeature.id === 'optimize-prompt' ? '最適化' : '生成'}
            </Button>
          </div>
        </div>

        {/* Right Panel - Results */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-neutral-800">
              生成結果
            </h2>
            {generatedImages.length > 0 && (
              <button
                onClick={() => setGeneratedImages([])}
                className="text-sm text-neutral-500 hover:text-neutral-700 flex items-center gap-1"
              >
                <RefreshCw className="w-4 h-4" />
                クリア
              </button>
            )}
          </div>

          {isGenerating && (
            <div className="bg-white rounded-2xl p-12 text-center shadow-soft animate-pulse">
              <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-accent-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
              </div>
              <h3 className="text-lg font-medium text-neutral-700 mb-2">
                生成しています...
              </h3>
              <p className="text-neutral-500">
                {selectedFeature.id === 'model-matrix' ? '複数画像の生成には時間がかかります' : '通常20〜30秒かかります'}
              </p>
            </div>
          )}

          {!isGenerating && generatedImages.length === 0 && (
            <div className="bg-neutral-50 rounded-2xl p-12 text-center border-2 border-dashed border-neutral-200">
              <Image className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-neutral-700 mb-2">
                生成結果がここに表示されます
              </h3>
              <p className="text-neutral-500">
                左のフォームに入力して開始
              </p>
            </div>
          )}

          {generatedImages.length > 0 && (
            <>
              {/* Success Card */}
              {showSuccessCard && (
                <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-green-100 dark:bg-green-800 rounded-full flex items-center justify-center flex-shrink-0">
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
                          <Button size="sm" variant="secondary">
                            <FolderOpen className="w-4 h-4 mr-1.5" />
                            ギャラリーで見る
                          </Button>
                        </Link>
                        <Link to="/canvas">
                          <Button size="sm" variant="ghost">
                            キャンバスで編集
                            <ExternalLink className="w-4 h-4 ml-1.5" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowSuccessCard(false)}
                      className="text-green-600 hover:text-green-800 dark:text-green-400"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              <div className={`grid gap-4 ${
                generatedImages.length === 1 ? 'grid-cols-1' :
                generatedImages.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'
              }`}>
                {generatedImages.map((image, index) => (
                  <div
                    key={image.id || index}
                    className="group relative bg-white dark:bg-neutral-800 rounded-2xl overflow-hidden shadow-soft hover:shadow-elegant transition-all"
                  >
                    {image.label && (
                      <div className="absolute top-2 left-2 z-10 px-2 py-1 bg-black/50 rounded-lg text-white text-xs font-medium">
                        {image.label}
                      </div>
                    )}
                    <img
                      src={image.imageUrl}
                      alt={image.prompt}
                      className="w-full aspect-square object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="absolute bottom-0 left-0 right-0 p-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDownload(image.imageUrl, `${image.label || 'image'}.png`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg text-sm font-medium text-neutral-800 hover:bg-neutral-100 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            保存
                          </button>
                          <button className="p-1.5 bg-white/20 rounded-lg text-white hover:bg-white/30 transition-colors">
                            <Heart className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
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
