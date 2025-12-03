import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Image, 
  Download, 
  Heart, 
  Trash2, 
  X,
  Grid,
  LayoutGrid,
  Search,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
// import { Button, Input, Modal } from '../components/ui';
import type { GeneratedImage } from '../types/database';
import toast from 'react-hot-toast';

type FilterType = 'all' | 'favorites';

export function GalleryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentBrand } = useAuthStore();
  
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [gridSize, setGridSize] = useState<'small' | 'large'>('large');

  useEffect(() => {
    if (currentBrand) {
      fetchImages();
    }
  }, [currentBrand, filter]);

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
        .eq('brand_id', currentBrand.id)
        .order('created_at', { ascending: false });

      if (filter === 'favorites') {
        query = query.eq('is_favorite', true);
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
      
      // Convert to desired format if needed
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
      // Delete from storage
      await supabase.storage
        .from('generated-images')
        .remove([image.storage_path]);

      // Delete from database
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

  const navigateImage = (direction: 'prev' | 'next') => {
    if (!selectedImage) return;
    
    const currentIndex = images.findIndex(img => img.id === selectedImage.id);
    let newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    
    if (newIndex < 0) newIndex = images.length - 1;
    if (newIndex >= images.length) newIndex = 0;
    
    setSelectedImage(images[newIndex]);
  };

  const filteredImages = images.filter(_image => {
    if (!searchQuery) return true;
    // You could add more search logic here based on tags, prompts, etc.
    return true;
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
            <h1 className="text-2xl font-display font-semibold text-neutral-900 mb-1">
              ギャラリー
            </h1>
            <p className="text-neutral-600">
              生成した画像を管理・ダウンロード
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
                className="pl-9 pr-4 py-2 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-48"
              />
            </div>

            {/* Grid Size Toggle */}
            <div className="flex items-center bg-white border border-neutral-200 rounded-lg p-1">
              <button
                onClick={() => setGridSize('large')}
                className={`p-1.5 rounded ${gridSize === 'large' ? 'bg-primary-100 text-primary-700' : 'text-neutral-400 hover:text-neutral-600'}`}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setGridSize('small')}
                className={`p-1.5 rounded ${gridSize === 'small' ? 'bg-primary-100 text-primary-700' : 'text-neutral-400 hover:text-neutral-600'}`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-primary-100 text-primary-700'
                : 'bg-white text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            すべて
          </button>
          <button
            onClick={() => setFilter('favorites')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              filter === 'favorites'
                ? 'bg-primary-100 text-primary-700'
                : 'bg-white text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            <Heart className="w-4 h-4" />
            お気に入り
          </button>
        </div>

        {/* Gallery Grid */}
        {filteredImages.length > 0 ? (
          <div className={`grid gap-4 ${
            gridSize === 'large' 
              ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' 
              : 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6'
          }`}>
            {filteredImages.map((image) => (
              <div
                key={image.id}
                onClick={() => setSelectedImage(image)}
                className="group relative aspect-square rounded-xl overflow-hidden bg-neutral-100 cursor-pointer hover:ring-2 hover:ring-primary-500 transition-all"
              >
                <img
                  src={getImageUrl(image.storage_path)}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                
                {/* Favorite Badge */}
                {image.is_favorite && (
                  <div className="absolute top-2 right-2 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-md">
                    <Heart className="w-4 h-4 text-red-500 fill-current" />
                  </div>
                )}

                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-sm font-medium">表示</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-neutral-50 rounded-2xl p-12 text-center">
            <Image className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-neutral-700 mb-2">
              {filter === 'favorites' ? 'お気に入りの画像がありません' : '画像がありません'}
            </h3>
            <p className="text-neutral-500">
              {filter === 'favorites' 
                ? 'ハートアイコンをクリックしてお気に入りに追加しましょう'
                : '画像を生成すると、ここに表示されます'
              }
            </p>
          </div>
        )}
      </div>

      {/* Image Detail Modal */}
      {selectedImage && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
          {/* Close Button */}
          <button
            onClick={() => {
              setSelectedImage(null);
              setSearchParams({});
            }}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Navigation */}
          <button
            onClick={() => navigateImage('prev')}
            className="absolute left-4 p-2 text-white/70 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>
          <button
            onClick={() => navigateImage('next')}
            className="absolute right-4 p-2 text-white/70 hover:text-white transition-colors"
          >
            <ChevronRight className="w-8 h-8" />
          </button>

          {/* Image */}
          <div className="max-w-4xl max-h-[80vh] mx-auto px-16">
            <img
              src={getImageUrl(selectedImage.storage_path)}
              alt=""
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
          </div>

          {/* Actions */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3">
            <div className="bg-white/10 backdrop-blur-lg rounded-xl p-2 flex items-center gap-2">
              <button
                onClick={() => handleDownload(selectedImage, 'png')}
                className="px-4 py-2 bg-white rounded-lg text-sm font-medium text-neutral-800 hover:bg-neutral-100 transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                PNG
              </button>
              <button
                onClick={() => handleDownload(selectedImage, 'jpeg')}
                className="px-4 py-2 bg-white/20 text-white rounded-lg text-sm font-medium hover:bg-white/30 transition-colors"
              >
                JPEG
              </button>
              <button
                onClick={() => handleDownload(selectedImage, 'webp')}
                className="px-4 py-2 bg-white/20 text-white rounded-lg text-sm font-medium hover:bg-white/30 transition-colors"
              >
                WebP
              </button>
            </div>

            <button
              onClick={() => handleToggleFavorite(selectedImage)}
              className={`p-3 rounded-xl transition-colors ${
                selectedImage.is_favorite
                  ? 'bg-red-500 text-white'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {selectedImage.is_favorite ? (
                <Heart className="w-5 h-5 fill-current" />
              ) : (
                <Heart className="w-5 h-5" />
              )}
            </button>

            <button
              onClick={() => handleDelete(selectedImage)}
              className="p-3 bg-white/10 text-white rounded-xl hover:bg-red-500 transition-colors"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

