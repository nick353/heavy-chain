import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { 
  Image, 
  Heart, 
  Trash2, 
  X,
  Grid,
  LayoutGrid,
  Search,
  ChevronLeft,
  ChevronRight,
  Edit3,
  RefreshCw,
  Info,
  Clock,
  Palette,
  Wand2,
  CheckSquare,
  Square,
  DownloadCloud
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui';
import type { GeneratedImage } from '../types/database';
import toast from 'react-hot-toast';

type FilterType = 'all' | 'favorites' | 'recent';
type SortType = 'newest' | 'oldest' | 'name';

export function GalleryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentBrand } = useAuthStore();
  
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortBy, setSortBy] = useState<SortType>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [gridSize, setGridSize] = useState<'small' | 'large'>('large');
  
  // Multi-select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (currentBrand) {
      fetchImages();
    }
  }, [currentBrand, filter, sortBy]);

  useEffect(() => {
    // Check for image ID in URL
    const imageId = searchParams.get('image');
    if (imageId && images.length > 0) {
      const image = images.find(img => img.id === imageId);
      if (image) {
        setSelectedImage(image);
      }
    }
  }, [searchParams, images]);

  const fetchImages = async () => {
    if (!currentBrand) return;
    
    setIsLoading(true);
    try {
      let query = supabase
        .from('generated_images')
        .select('*')
        .eq('brand_id', currentBrand.id);

      if (filter === 'favorites') {
        query = query.eq('is_favorite', true);
      }

      if (sortBy === 'newest') {
        query = query.order('created_at', { ascending: false });
      } else if (sortBy === 'oldest') {
        query = query.order('created_at', { ascending: true });
      }

      const { data, error } = await query;

      if (error) throw error;
      setImages(data || []);
    } catch (error) {
      console.error('Failed to fetch images:', error);
      toast.error('画像の読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const getImageUrl = (path: string) => {
    const { data } = supabase.storage.from('generated-images').getPublicUrl(path);
    return data.publicUrl;
  };

  const handleDownload = async (image: GeneratedImage, format: 'png' | 'jpeg' | 'webp' = 'png') => {
    try {
      const imageUrl = getImageUrl(image.storage_path);
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `heavy-chain-${image.id}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast.success('ダウンロードしました');
    } catch (error) {
      toast.error('ダウンロードに失敗しました');
    }
  };

  const handleBulkDownload = async () => {
    if (selectedIds.size === 0) return;
    
    toast.loading(`${selectedIds.size}枚の画像を準備中...`);
    
    // In a real implementation, this would call the bulk-download Edge Function
    // For now, download each image individually
    for (const id of selectedIds) {
      const image = images.find(img => img.id === id);
      if (image) {
        await handleDownload(image, 'png');
      }
    }
    
    toast.dismiss();
    toast.success('ダウンロード完了');
  };

  const handleToggleFavorite = async (image: GeneratedImage) => {
    try {
      const newValue = !image.is_favorite;
      await supabase
        .from('generated_images')
        .update({ is_favorite: newValue })
        .eq('id', image.id);

      setImages(prev => 
        prev.map(img => 
          img.id === image.id ? { ...img, is_favorite: newValue } : img
        )
      );

      if (selectedImage?.id === image.id) {
        setSelectedImage({ ...image, is_favorite: newValue });
      }

      toast.success(newValue ? 'お気に入りに追加しました' : 'お気に入りから削除しました');
    } catch (error) {
      toast.error('操作に失敗しました');
    }
  };

  const handleDelete = async (image: GeneratedImage) => {
    if (!confirm('この画像を削除しますか？')) return;

    try {
      await supabase.storage
        .from('generated-images')
        .remove([image.storage_path]);

      await supabase
        .from('generated_images')
        .delete()
        .eq('id', image.id);

      setImages(prev => prev.filter(img => img.id !== image.id));
      setSelectedImage(null);
      toast.success('画像を削除しました');
    } catch (error) {
      toast.error('削除に失敗しました');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size}枚の画像を削除しますか？`)) return;

    try {
      const imagesToDelete = images.filter(img => selectedIds.has(img.id));
      
      await supabase.storage
        .from('generated-images')
        .remove(imagesToDelete.map(img => img.storage_path));

      await supabase
        .from('generated_images')
        .delete()
        .in('id', Array.from(selectedIds));

      setImages(prev => prev.filter(img => !selectedIds.has(img.id)));
      setSelectedIds(new Set());
      setSelectMode(false);
      toast.success('削除しました');
    } catch (error) {
      toast.error('削除に失敗しました');
    }
  };

  const navigateImage = (direction: 'prev' | 'next') => {
    if (!selectedImage) return;
    
    const currentIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
    let newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    
    if (newIndex < 0) newIndex = filteredImages.length - 1;
    if (newIndex >= filteredImages.length) newIndex = 0;
    
    setSelectedImage(filteredImages[newIndex]);
  };

  const handleEditInCanvas = (image: GeneratedImage) => {
    // Store the image URL in sessionStorage for the canvas to pick up
    sessionStorage.setItem('canvas_load_image', getImageUrl(image.storage_path));
    navigate('/canvas');
  };

  const handleEditWithFeature = (featureId: string, image: GeneratedImage) => {
    sessionStorage.setItem('generate_load_image', JSON.stringify({
      url: getImageUrl(image.storage_path),
      id: image.id,
    }));
    navigate(`/generate?feature=${featureId}`);
  };

  const toggleSelectImage = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredImages.map(img => img.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const filteredImages = images.filter(image => {
    if (!searchQuery) return true;
    // Search in any available metadata
    const searchLower = searchQuery.toLowerCase();
    return (
      image.id.toLowerCase().includes(searchLower) ||
      image.storage_path.toLowerCase().includes(searchLower)
    );
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-display font-semibold text-neutral-900 dark:text-white mb-1">
              ギャラリー
            </h1>
            <p className="text-neutral-600 dark:text-neutral-400">
              {images.length}枚の画像
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                type="text"
                placeholder="検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-48"
              />
            </div>

            {/* Grid Size Toggle */}
            <div className="flex items-center bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg p-1">
              <button
                onClick={() => setGridSize('large')}
                className={`p-1.5 rounded ${gridSize === 'large' ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300' : 'text-neutral-400 hover:text-neutral-600'}`}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setGridSize('small')}
                className={`p-1.5 rounded ${gridSize === 'small' ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300' : 'text-neutral-400 hover:text-neutral-600'}`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>

            {/* Select Mode Toggle */}
            <button
              onClick={() => {
                setSelectMode(!selectMode);
                setSelectedIds(new Set());
              }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectMode
                  ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300'
                  : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50'
              }`}
            >
              {selectMode ? '選択解除' : '選択'}
            </button>
          </div>
        </div>

        {/* Select Mode Actions */}
        {selectMode && (
          <div className="flex items-center gap-3 mb-6 p-4 bg-primary-50 dark:bg-primary-900/20 rounded-xl">
            <span className="text-sm text-primary-700 dark:text-primary-300">
              {selectedIds.size}枚選択中
            </span>
            <button
              onClick={selectAll}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              すべて選択
            </button>
            <button
              onClick={deselectAll}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              選択解除
            </button>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleBulkDownload}
              disabled={selectedIds.size === 0}
              leftIcon={<DownloadCloud className="w-4 h-4" />}
            >
              一括ダウンロード
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleBulkDelete}
              disabled={selectedIds.size === 0}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              leftIcon={<Trash2 className="w-4 h-4" />}
            >
              削除
            </Button>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center justify-between gap-2 mb-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300'
                  : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50'
              }`}
            >
              すべて
            </button>
            <button
              onClick={() => setFilter('favorites')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                filter === 'favorites'
                  ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300'
                  : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50'
              }`}
            >
              <Heart className="w-4 h-4" />
              お気に入り
            </button>
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortType)}
            className="px-3 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm text-neutral-600 dark:text-neutral-400"
          >
            <option value="newest">新しい順</option>
            <option value="oldest">古い順</option>
          </select>
        </div>

        {/* Gallery Grid */}
        {filteredImages.length > 0 ? (
          <div className={`grid gap-4 ${
            gridSize === 'large' 
              ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4' 
              : 'grid-cols-3 sm:grid-cols-4 xl:grid-cols-6'
          }`}>
            {filteredImages.map((image) => (
              <div
                key={image.id}
                className={`group relative aspect-square rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 cursor-pointer transition-all ${
                  selectMode && selectedIds.has(image.id) ? 'ring-2 ring-primary-500 ring-offset-2' : 'hover:ring-2 hover:ring-primary-500'
                }`}
                onClick={() => selectMode ? toggleSelectImage(image.id) : setSelectedImage(image)}
              >
                <img
                  src={getImageUrl(image.storage_path)}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                
                {/* Select checkbox */}
                {selectMode && (
                  <div className="absolute top-2 left-2">
                    {selectedIds.has(image.id) ? (
                      <CheckSquare className="w-6 h-6 text-primary-500" />
                    ) : (
                      <Square className="w-6 h-6 text-white drop-shadow" />
                    )}
                  </div>
                )}
                
                {/* Favorite Badge */}
                {image.is_favorite && !selectMode && (
                  <div className="absolute top-2 right-2 w-7 h-7 bg-white dark:bg-neutral-800 rounded-full flex items-center justify-center shadow-md">
                    <Heart className="w-4 h-4 text-red-500 fill-current" />
                  </div>
                )}

                {/* Hover Overlay */}
                {!selectMode && (
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-white text-sm font-medium">詳細を見る</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-neutral-50 dark:bg-neutral-800 rounded-2xl p-12 text-center">
            <Image className="w-12 h-12 text-neutral-300 dark:text-neutral-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-neutral-700 dark:text-neutral-200 mb-2">
              {filter === 'favorites' ? 'お気に入りの画像がありません' : '画像がありません'}
            </h3>
            <p className="text-neutral-500 dark:text-neutral-400 mb-6">
              {filter === 'favorites' 
                ? 'ハートアイコンをクリックしてお気に入りに追加しましょう'
                : '画像を生成すると、ここに表示されます'
              }
            </p>
            <Link to="/generate">
              <Button>画像を生成する</Button>
            </Link>
          </div>
        )}
      </div>

      {/* Image Detail Modal */}
      {selectedImage && (
        <div className="fixed inset-0 z-50 bg-black/90 flex">
          {/* Close Button */}
          <button
            onClick={() => {
              setSelectedImage(null);
              setSearchParams({});
            }}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors z-10"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Navigation */}
          <button
            onClick={() => navigateImage('prev')}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>
          <button
            onClick={() => navigateImage('next')}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-white/70 hover:text-white transition-colors"
          >
            <ChevronRight className="w-8 h-8" />
          </button>

          {/* Main Content */}
          <div className="flex-1 flex items-center justify-center p-16">
            <img
              src={getImageUrl(selectedImage.storage_path)}
              alt=""
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          </div>

          {/* Side Panel */}
          <div className="w-80 bg-neutral-900 border-l border-neutral-800 p-6 overflow-y-auto">
            <h3 className="text-white font-semibold mb-4">画像の詳細</h3>
            
            {/* Info */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <Clock className="w-4 h-4" />
                <span>{new Date(selectedImage.created_at).toLocaleString('ja-JP')}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <Info className="w-4 h-4" />
                <span>ID: {selectedImage.id.slice(0, 8)}...</span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="space-y-2 mb-6">
              <h4 className="text-sm font-medium text-neutral-500 mb-2">クイックアクション</h4>
              <button
                onClick={() => handleEditInCanvas(selectedImage)}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm transition-colors"
              >
                <Edit3 className="w-4 h-4" />
                キャンバスで編集
              </button>
              <button
                onClick={() => handleEditWithFeature('variations', selectedImage)}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                バリエーションを生成
              </button>
              <button
                onClick={() => handleEditWithFeature('colorize', selectedImage)}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm transition-colors"
              >
                <Palette className="w-4 h-4" />
                カラバリを生成
              </button>
              <button
                onClick={() => handleEditWithFeature('remove-bg', selectedImage)}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm transition-colors"
              >
                <Wand2 className="w-4 h-4" />
                背景を変更
              </button>
            </div>

            {/* Download Options */}
            <div className="space-y-2 mb-6">
              <h4 className="text-sm font-medium text-neutral-500 mb-2">ダウンロード</h4>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleDownload(selectedImage, 'png')}
                  className="px-3 py-2 bg-white text-neutral-800 rounded-lg text-sm font-medium hover:bg-neutral-100 transition-colors"
                >
                  PNG
                </button>
                <button
                  onClick={() => handleDownload(selectedImage, 'jpeg')}
                  className="px-3 py-2 bg-neutral-800 text-white rounded-lg text-sm font-medium hover:bg-neutral-700 transition-colors"
                >
                  JPEG
                </button>
                <button
                  onClick={() => handleDownload(selectedImage, 'webp')}
                  className="px-3 py-2 bg-neutral-800 text-white rounded-lg text-sm font-medium hover:bg-neutral-700 transition-colors"
                >
                  WebP
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <button
                onClick={() => handleToggleFavorite(selectedImage)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-colors ${
                  selectedImage.is_favorite
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-neutral-800 hover:bg-neutral-700 text-white'
                }`}
              >
                <Heart className={`w-4 h-4 ${selectedImage.is_favorite ? 'fill-current' : ''}`} />
                {selectedImage.is_favorite ? 'お気に入りから削除' : 'お気に入りに追加'}
              </button>
              <button
                onClick={() => handleDelete(selectedImage)}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-neutral-800 hover:bg-red-900/50 text-neutral-400 hover:text-red-400 rounded-lg text-sm transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
