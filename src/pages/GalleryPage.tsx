import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { 
  Image, 
  Heart, 
  Trash2, 
  X,
  Grid,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  Info,
  Clock,
  CheckSquare,
  Square,
  DownloadCloud,
  Copy,
  Sparkles,
  Tag,
  FileText
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { Button, SearchInput } from '../components/ui';
import type { GeneratedImage } from '../types/database';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

type FilterType = 'all' | 'favorites' | 'recent';
type SortType = 'newest' | 'oldest' | 'name';

export function GalleryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
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
  
  // Recent searches
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    const saved = localStorage.getItem('gallery_recent_searches');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      if (!currentBrand) {
        // ブランドがない場合はローディングを解除
        if (mounted) setIsLoading(false);
        return;
      }
      
      await fetchImages();
    };

    loadData();

    return () => {
      mounted = false;
    };
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
    if (!currentBrand) {
      setIsLoading(false);
      return;
    }
    
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

      if (error) {
        console.error('Failed to fetch images:', error);
        toast.error('画像の読み込みに失敗しました');
        setImages([]);
      } else {
        console.log('📊 取得した画像数:', data?.length || 0);
        if (data && data.length > 0) {
          console.log('📷 サンプル画像データ:', {
            id: data[0].id,
            storage_path: data[0].storage_path,
            created_at: data[0].created_at,
            brand_id: data[0].brand_id
          });
          
          // 画像URLを確認
          const sampleUrl = getImageUrl(data[0]);
          console.log('🔗 生成されたURL:', sampleUrl);
          
          // URLにアクセス可能か確認
          if (sampleUrl) {
            fetch(sampleUrl, { method: 'HEAD' })
              .then(response => {
                if (response.ok) {
                  console.log('✅ 画像ファイルにアクセス可能です');
                } else {
                  console.error('❌ 画像ファイルにアクセスできません:', response.status, response.statusText);
                  console.log('💡 ヒント: storage-setup.sql を実行してストレージポリシーを設定してください');
                }
              })
              .catch(err => {
                console.error('❌ ネットワークエラー:', err);
              });
          }
        } else {
          console.log('ℹ️ 画像データがありません');
        }
        setImages(data || []);
      }
    } catch (error) {
      console.error('Failed to fetch images:', error);
      toast.error('画像の読み込みに失敗しました');
      setImages([]);
    } finally {
      setIsLoading(false);
    }
  };

  const getImageUrl = (image: GeneratedImage | string) => {
    // 文字列の場合（レガシーコードサポート）
    if (typeof image === 'string') {
      const path = image;
      if (!path) return '';
      if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path;
      }
      try {
        const { data } = supabase.storage.from('generated-images').getPublicUrl(path);
        return data.publicUrl || '';
      } catch (error) {
        console.error('Failed to get image URL:', error);
        return '';
      }
    }

    // まずimage_urlを確認（直接URL）
    if (image.image_url) {
      return image.image_url;
    }
    
    // storage_pathを使用
    const path = image.storage_path;
    if (!path) {
      console.warn('Image path is empty for image:', image.id);
      return '';
    }
    try {
      // storage_pathがすでに完全なURLの場合はそのまま返す
      if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path;
      }
      const { data } = supabase.storage.from('generated-images').getPublicUrl(path);
      return data.publicUrl || '';
    } catch (error) {
      console.error('Failed to get image URL:', error, 'path:', path);
      return '';
    }
  };

  const handleDownload = async (image: GeneratedImage, format: 'png' | 'jpeg' | 'webp' = 'png') => {
    try {
      const imageUrl = getImageUrl(image);
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
    
    const newImage = filteredImages[newIndex];
    setSelectedImage(newImage);
    
    // Update URL
    setSearchParams({ image: newImage.id });
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

  // Save search to recent searches
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim() && !recentSearches.includes(query.trim())) {
      const newRecent = [query.trim(), ...recentSearches.slice(0, 9)];
      setRecentSearches(newRecent);
      localStorage.setItem('gallery_recent_searches', JSON.stringify(newRecent));
    }
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    localStorage.removeItem('gallery_recent_searches');
  };

  // Copy prompt to clipboard
  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    toast.success('プロンプトをコピーしました');
  };

  // Get unique feature types for suggestions
  const featureSuggestions = useMemo(() => {
    const features = new Set<string>();
    images.forEach(img => {
      if (img.feature_type) features.add(img.feature_type);
    });
    return Array.from(features);
  }, [images]);

  const filteredImages = useMemo(() => {
    if (!searchQuery) return images;
    
    const searchLower = searchQuery.toLowerCase();
    return images.filter(image => {
      // Search in prompt
      if (image.prompt?.toLowerCase().includes(searchLower)) return true;
      // Search in feature type
      if (image.feature_type?.toLowerCase().includes(searchLower)) return true;
      // Search in style preset
      if (image.style_preset?.toLowerCase().includes(searchLower)) return true;
      // Search in ID
      if (image.id.toLowerCase().includes(searchLower)) return true;
      // Search in storage path (fallback)
      if (image.storage_path.toLowerCase().includes(searchLower)) return true;
      return false;
    });
  }, [images, searchQuery]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (!selectedImage) return;
      
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateImage('prev');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateImage('next');
      } else if (e.key === 'Escape') {
        setSelectedImage(null);
        setSearchParams({});
      } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleToggleFavorite(selectedImage);
      }
    };
    
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [selectedImage, filteredImages]);

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
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8"
        >
          <div>
            <h1 className="text-2xl font-display font-semibold text-neutral-900 dark:text-white mb-1">
              ギャラリー
            </h1>
            <p className="text-neutral-600 dark:text-neutral-400">
              {images.length}枚の画像
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Enhanced Search */}
            <SearchInput
              value={searchQuery}
              onChange={handleSearch}
              placeholder="プロンプトで検索..."
              recentSearches={recentSearches}
              suggestions={featureSuggestions}
              onClearRecent={clearRecentSearches}
              showAIHint={true}
              className="w-48 sm:w-64"
            />

            {/* Grid Size Toggle */}
            <div className="flex items-center bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-200 dark:border-neutral-700 rounded-lg p-1">
              <button
                onClick={() => setGridSize('large')}
                className={`p-1.5 rounded transition-colors ${gridSize === 'large' ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300' : 'text-neutral-400 hover:text-neutral-600'}`}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setGridSize('small')}
                className={`p-1.5 rounded transition-colors ${gridSize === 'small' ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300' : 'text-neutral-400 hover:text-neutral-600'}`}
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
                  : 'glass-panel text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800'
              }`}
            >
              {selectMode ? '選択解除' : '選択'}
            </button>
          </div>
        </motion.div>

        {/* Select Mode Actions */}
        <AnimatePresence>
          {selectMode && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 overflow-hidden"
            >
              <div className="flex items-center gap-3 p-4 bg-primary-50/50 dark:bg-primary-900/20 backdrop-blur-sm border border-primary-100 dark:border-primary-800/30 rounded-xl">
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filters */}
        <div className="flex items-center justify-between gap-2 mb-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                filter === 'all'
                  ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 shadow-sm'
                  : 'hover:bg-white/50 dark:hover:bg-white/5 text-neutral-600 dark:text-neutral-400'
              }`}
            >
              すべて
            </button>
            <button
              onClick={() => setFilter('favorites')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                filter === 'favorites'
                  ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 shadow-sm'
                  : 'hover:bg-white/50 dark:hover:bg-white/5 text-neutral-600 dark:text-neutral-400'
              }`}
            >
              <Heart className="w-4 h-4" />
              お気に入り
            </button>
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortType)}
            className="px-3 py-2 bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm text-neutral-600 dark:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="newest">新しい順</option>
            <option value="oldest">古い順</option>
          </select>
        </div>

        {/* Gallery Grid */}
        {filteredImages.length > 0 ? (
          <motion.div 
            layout
            className={`grid gap-4 ${
              gridSize === 'large' 
                ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4' 
                : 'grid-cols-3 sm:grid-cols-4 xl:grid-cols-6'
            }`}
          >
            <AnimatePresence mode="popLayout">
              {filteredImages.map((image) => (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.3 }}
                  key={image.id}
                  className={`group relative aspect-square rounded-xl overflow-hidden bg-white dark:bg-neutral-800 cursor-pointer transition-all shadow-sm hover:shadow-lg ${
                    selectMode && selectedIds.has(image.id) ? 'ring-2 ring-primary-500 ring-offset-2' : 'hover:ring-2 hover:ring-primary-500'
                  }`}
                  onClick={() => selectMode ? toggleSelectImage(image.id) : setSelectedImage(image)}
                >
                  {getImageUrl(image) ? (
                    <img
                      src={getImageUrl(image)}
                      alt=""
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                      onError={(e) => {
                        console.error('Failed to load image:', image.storage_path, 'image_url:', image.image_url);
                        e.currentTarget.style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent) {
                          const errorDiv = document.createElement('div');
                          errorDiv.className = 'w-full h-full flex items-center justify-center bg-neutral-200 dark:bg-neutral-700';
                          errorDiv.innerHTML = '<span class="text-neutral-400 text-sm">読込失敗</span>';
                          parent.appendChild(errorDiv);
                        }
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-neutral-200 dark:bg-neutral-700">
                      <span className="text-neutral-400 text-sm">画像なし</span>
                    </div>
                  )}
                  
                  {/* Select checkbox */}
                  {selectMode && (
                    <div className="absolute top-2 left-2">
                      {selectedIds.has(image.id) ? (
                        <CheckSquare className="w-6 h-6 text-primary-500 bg-white rounded-md" />
                      ) : (
                        <Square className="w-6 h-6 text-white drop-shadow-md" />
                      )}
                    </div>
                  )}
                  
                  {/* Favorite Badge */}
                  {image.is_favorite && !selectMode && (
                    <div className="absolute top-2 right-2 w-7 h-7 bg-white/80 dark:bg-neutral-800/80 backdrop-blur-sm rounded-full flex items-center justify-center shadow-sm">
                      <Heart className="w-4 h-4 text-red-500 fill-current" />
                    </div>
                  )}

                  {/* Hover Overlay */}
                  {!selectMode && (
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                      <span className="text-white text-sm font-medium px-4 py-2 border border-white/50 rounded-lg">詳細を見る</span>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass-panel rounded-2xl p-12 text-center"
          >
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
          </motion.div>
        )}
      </div>

      {/* Image Detail Modal */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex"
          >
            {/* Close Button */}
            <button
              onClick={() => {
                setSelectedImage(null);
                setSearchParams({});
              }}
              className="absolute top-4 right-4 p-3 text-white/70 hover:text-white transition-all z-20 bg-black/30 hover:bg-black/50 rounded-full backdrop-blur-sm hover:scale-110"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Main Content - 2カラムレイアウト */}
            <div className="flex flex-1 h-full">
              {/* Left: Image Display with Navigation */}
              <div className="flex-1 flex items-center justify-center p-8 md:p-16 pt-16 md:pt-20 relative">
                {/* Previous Button - 画像エリア内の左側 */}
                <button
                  onClick={() => navigateImage('prev')}
                  className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 p-4 text-white/90 hover:text-white transition-all bg-black/40 hover:bg-black/60 rounded-full z-10 backdrop-blur-md hover:scale-110 shadow-2xl group"
                  title="前の画像 (←)"
                >
                  <ChevronLeft className="w-8 h-8 md:w-10 md:h-10 group-hover:-translate-x-1 transition-transform" />
                </button>

                {/* Image */}
                <div className="relative max-w-full max-h-full flex items-center justify-center">
                  {getImageUrl(selectedImage) ? (
                    <motion.img
                      key={selectedImage.id}
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.95, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      src={getImageUrl(selectedImage)}
                      alt=""
                      className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                      onError={() => {
                        console.error('Failed to load image in modal:', selectedImage.storage_path, 'image_url:', selectedImage.image_url);
                        toast.error('画像の読み込みに失敗しました');
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-white">
                      <div className="text-6xl mb-4">⚠️</div>
                      <p className="text-xl">画像を読み込めませんでした</p>
                    </div>
                  )}
                </div>

                {/* Next Button - 画像エリア内の右側 */}
                <button
                  onClick={() => navigateImage('next')}
                  className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 p-4 text-white/90 hover:text-white transition-all bg-black/40 hover:bg-black/60 rounded-full z-10 backdrop-blur-md hover:scale-110 shadow-2xl group"
                  title="次の画像 (→)"
                >
                  <ChevronRight className="w-8 h-8 md:w-10 md:h-10 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* 画像カウンター */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/50 backdrop-blur-md rounded-full text-white/90 text-sm font-medium z-10">
                  {filteredImages.findIndex(img => img.id === selectedImage.id) + 1} / {filteredImages.length}
                </div>
              </div>

              {/* Right: Side Panel with Details */}
              <motion.div 
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                className="w-80 md:w-96 bg-white/10 backdrop-blur-md border-l border-white/10 overflow-y-auto"
              >
                <div className="p-6">
                  <h3 className="text-white font-semibold mb-6 text-lg border-b border-white/10 pb-4">画像の詳細</h3>
                  
                  {/* Metadata */}
                  <div className="space-y-4 mb-8">
                    <div className="flex items-center gap-3 text-sm text-white/80">
                      <Clock className="w-4 h-4 flex-shrink-0" />
                      <span>{new Date(selectedImage.created_at).toLocaleString('ja-JP')}</span>
                    </div>
                    
                    {selectedImage.feature_type && (
                      <div className="flex items-center gap-3 text-sm text-white/80">
                        <Sparkles className="w-4 h-4 flex-shrink-0" />
                        <span>{selectedImage.feature_type}</span>
                      </div>
                    )}
                    
                    {selectedImage.style_preset && (
                      <div className="flex items-center gap-3 text-sm text-white/80">
                        <Tag className="w-4 h-4 flex-shrink-0" />
                        <span>{selectedImage.style_preset}</span>
                      </div>
                    )}
                    
                    <div className="flex items-center gap-3 text-sm text-white/80">
                      <Info className="w-4 h-4 flex-shrink-0" />
                      <span className="font-mono text-xs">ID: {selectedImage.id.slice(0, 8)}</span>
                    </div>
                  </div>

                  {/* Prompt Display */}
                  {selectedImage.prompt && (
                    <div className="mb-8">
                      <h4 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <FileText className="w-3 h-3" />
                        プロンプト
                      </h4>
                      <div className="relative group">
                        <p className="text-sm text-white/80 bg-white/5 rounded-xl p-4 leading-relaxed max-h-48 overflow-y-auto">
                          {selectedImage.prompt}
                        </p>
                        <button
                          onClick={() => copyPrompt(selectedImage.prompt!)}
                          className="absolute top-2 right-2 p-2 rounded-lg bg-white/10 hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-all"
                          title="プロンプトをコピー"
                        >
                          <Copy className="w-4 h-4 text-white/70" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Download Options */}
                  <div className="space-y-3 mb-8">
                    <h4 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">ダウンロード</h4>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => handleDownload(selectedImage, 'png')}
                        className="px-3 py-2 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 transition-colors"
                      >
                        PNG
                      </button>
                      <button
                        onClick={() => handleDownload(selectedImage, 'jpeg')}
                        className="px-3 py-2 bg-white/10 text-white rounded-lg text-xs font-medium hover:bg-white/20 transition-colors"
                      >
                        JPEG
                      </button>
                      <button
                        onClick={() => handleDownload(selectedImage, 'webp')}
                        className="px-3 py-2 bg-white/10 text-white rounded-lg text-xs font-medium hover:bg-white/20 transition-colors"
                      >
                        WebP
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="space-y-3">
                    <button
                      onClick={() => handleToggleFavorite(selectedImage)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all ${
                        selectedImage.is_favorite
                          ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                          : 'bg-white/10 hover:bg-white/20 text-white'
                      }`}
                    >
                      <Heart className={`w-4 h-4 ${selectedImage.is_favorite ? 'fill-current' : ''}`} />
                      {selectedImage.is_favorite ? 'お気に入りから削除' : 'お気に入りに追加'}
                    </button>
                    <button
                      onClick={() => handleDelete(selectedImage)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-red-900/30 text-white/70 hover:text-red-400 rounded-xl text-sm transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                      削除
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
