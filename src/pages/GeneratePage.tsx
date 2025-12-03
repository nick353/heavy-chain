import { useState } from 'react';
import { 
  Wand2, 
  Image, 
  ChevronDown,
  Loader2,
  Download,
  Heart,
  RefreshCw
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { Button, Textarea } from '../components/ui';
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
}

export function GeneratePage() {
  const { currentBrand } = useAuthStore();
  
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [selectedRatio, setSelectedRatio] = useState('1:1');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedResult[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error('プロンプトを入力してください');
      return;
    }

    if (!currentBrand) {
      toast.error('ブランドを選択してください');
      return;
    }

    setIsGenerating(true);
    
    try {
      // Build the full prompt
      let fullPrompt = prompt;
      if (selectedStyle) {
        const style = stylePresets.find(s => s.id === selectedStyle);
        if (style) {
          fullPrompt = `${prompt}, ${style.prompt}`;
        }
      }

      const ratio = aspectRatios.find(r => r.id === selectedRatio) || aspectRatios[0];

      // Call the Edge Function
      const { data, error } = await supabase.functions.invoke('generate-image', {
        body: {
          prompt: fullPrompt,
          negativePrompt,
          width: ratio.width,
          height: ratio.height,
          brandId: currentBrand.id
        }
      });

      if (error) throw error;

      if (data.images && data.images.length > 0) {
        setGeneratedImages(prev => [...data.images, ...prev]);
        toast.success('画像を生成しました');
      }
    } catch (error: any) {
      console.error('Generation error:', error);
      toast.error(error.message || '画像の生成に失敗しました');
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
    } catch (error) {
      toast.error('ダウンロードに失敗しました');
    }
  };

  const handleFavorite = async (imageId: string) => {
    try {
      await supabase
        .from('generated_images')
        .update({ is_favorite: true })
        .eq('id', imageId);
      toast.success('お気に入りに追加しました');
    } catch (error) {
      toast.error('お気に入りの追加に失敗しました');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid lg:grid-cols-[400px,1fr] gap-8">
        {/* Left Panel - Controls */}
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-display font-semibold text-neutral-900 mb-2">
              画像生成
            </h1>
            <p className="text-neutral-600">
              プロンプトを入力して、AIで画像を生成します
            </p>
          </div>

          {/* Prompt Input */}
          <div className="card">
            <Textarea
              label="プロンプト"
              placeholder="生成したい画像を日本語で説明してください。例: 白いTシャツを着たモデル、スタジオ撮影、シンプルな背景"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
            />
            
            {/* Style Presets */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                スタイルプリセット
              </label>
              <div className="flex flex-wrap gap-2">
                {stylePresets.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setSelectedStyle(
                      selectedStyle === style.id ? null : style.id
                    )}
                    className={`
                      px-3 py-1.5 text-sm rounded-full border transition-all
                      ${selectedStyle === style.id
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:border-primary-200'
                      }
                    `}
                  >
                    {style.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                アスペクト比
              </label>
              <div className="flex flex-wrap gap-2">
                {aspectRatios.map((ratio) => (
                  <button
                    key={ratio.id}
                    onClick={() => setSelectedRatio(ratio.id)}
                    className={`
                      px-3 py-1.5 text-sm rounded-full border transition-all
                      ${selectedRatio === ratio.id
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:border-primary-200'
                      }
                    `}
                  >
                    {ratio.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced Options */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 mt-4 text-sm text-neutral-500 hover:text-neutral-700"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              詳細オプション
            </button>

            {showAdvanced && (
              <div className="mt-4 pt-4 border-t border-neutral-100">
                <Textarea
                  label="ネガティブプロンプト"
                  placeholder="生成したくない要素（例: ぼやけた, 低品質）"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  rows={2}
                />
              </div>
            )}

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              isLoading={isGenerating}
              disabled={!prompt.trim() || isGenerating}
              className="w-full mt-6"
              size="lg"
              leftIcon={isGenerating ? undefined : <Wand2 className="w-5 h-5" />}
            >
              {isGenerating ? '生成中...' : '画像を生成'}
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
                画像を生成しています...
              </h3>
              <p className="text-neutral-500">
                通常20〜30秒かかります
              </p>
            </div>
          )}

          {!isGenerating && generatedImages.length === 0 && (
            <div className="bg-neutral-50 rounded-2xl p-12 text-center border-2 border-dashed border-neutral-200">
              <Image className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-neutral-700 mb-2">
                生成された画像がここに表示されます
              </h3>
              <p className="text-neutral-500">
                左のフォームにプロンプトを入力して開始
              </p>
            </div>
          )}

          {generatedImages.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-6">
              {generatedImages.map((image) => (
                <div
                  key={image.id}
                  className="group relative bg-white rounded-2xl overflow-hidden shadow-soft hover:shadow-elegant transition-all"
                >
                  <img
                    src={image.imageUrl}
                    alt={image.prompt}
                    className="w-full aspect-square object-cover"
                  />
                  
                  {/* Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <p className="text-white text-sm line-clamp-2 mb-3">
                        {image.prompt}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDownload(image.imageUrl)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg text-sm font-medium text-neutral-800 hover:bg-neutral-100 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          保存
                        </button>
                        <button
                          onClick={() => handleFavorite(image.id)}
                          className="p-1.5 bg-white/20 rounded-lg text-white hover:bg-white/30 transition-colors"
                        >
                          <Heart className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

