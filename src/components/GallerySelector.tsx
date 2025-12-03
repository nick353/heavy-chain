import { useState, useEffect } from 'react';
import { Search, X, Check, Image as ImageIcon, Heart, Clock } from 'lucide-react';
import { Modal } from './ui';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import type { GeneratedImage } from '../types/database';

interface GallerySelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (imageUrl: string, imageId: string) => void;
  multiple?: boolean;
  maxSelect?: number;
  onMultipleSelect?: (images: { url: string; id: string }[]) => void;
}

type FilterType = 'all' | 'recent' | 'favorites';

export function GallerySelector({
  isOpen,
  onClose,
  onSelect,
  multiple = false,
  maxSelect = 5,
  onMultipleSelect,
}: GallerySelectorProps) {
  const { currentBrand } = useAuthStore();
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('recent');
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && currentBrand) {
      fetchImages();
    }
  }, [isOpen, currentBrand, filter]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedImages(new Set());
      setSearchQuery('');
    }
  }, [isOpen]);

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

      if (filter === 'recent') {
        query = query.limit(20);
      } else {
        query = query.limit(50);
      }

      const { data, error } = await query;

      if (error) throw error;
      setImages(data || []);
    } catch (error) {
      console.error('Failed to fetch images:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getImageUrl = (path: string) => {
    const { data } = supabase.storage.from('generated-images').getPublicUrl(path);
    return data.publicUrl;
  };

  const handleImageClick = (image: GeneratedImage) => {
    if (multiple) {
      const imageUrl = getImageUrl(image.storage_path);
      const newSelected = new Set(selectedImages);
      
      if (newSelected.has(image.id)) {
        newSelected.delete(image.id);
      } else if (newSelected.size < maxSelect) {
        newSelected.add(image.id);
      }
      
      setSelectedImages(newSelected);
    } else {
      const imageUrl = getImageUrl(image.storage_path);
      onSelect(imageUrl, image.id);
    }
  };

  const handleConfirmMultiple = () => {
    if (onMultipleSelect) {
      const selected = images
        .filter(img => selectedImages.has(img.id))
        .map(img => ({
          url: getImageUrl(img.storage_path),
          id: img.id,
        }));
      onMultipleSelect(selected);
    }
    onClose();
  };

  const filteredImages = images.filter(image => {
    if (!searchQuery) return true;
    // Search in prompt if available
    return true; // TODO: Add proper search when prompt is stored
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="ギャラリーから画像を選択"
      size="xl"
    >
      <div className="space-y-4">
        {/* Search and Filter */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              type="text"
              placeholder="画像を検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1">
            <button
              onClick={() => setFilter('recent')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                filter === 'recent'
                  ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <Clock className="w-3 h-3" />
              最近
            </button>
            <button
              onClick={() => setFilter('favorites')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                filter === 'favorites'
                  ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <Heart className="w-3 h-3" />
              お気に入り
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                filter === 'all'
                  ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              すべて
            </button>
          </div>
        </div>

        {/* Multiple selection indicator */}
        {multiple && (
          <div className="flex items-center justify-between px-3 py-2 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
            <span className="text-sm text-primary-700 dark:text-primary-300">
              {selectedImages.size}枚選択中（最大{maxSelect}枚）
            </span>
            {selectedImages.size > 0 && (
              <button
                onClick={() => setSelectedImages(new Set())}
                className="text-xs text-primary-600 hover:text-primary-700"
              >
                選択解除
              </button>
            )}
          </div>
        )}

        {/* Image Grid */}
        <div className="max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="spinner" />
            </div>
          ) : filteredImages.length > 0 ? (
            <div className="grid grid-cols-4 gap-3">
              {filteredImages.map((image) => {
                const isSelected = selectedImages.has(image.id);
                return (
                  <button
                    key={image.id}
                    onClick={() => handleImageClick(image)}
                    className={`relative aspect-square rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 transition-all ${
                      isSelected
                        ? 'ring-2 ring-primary-500 ring-offset-2'
                        : 'hover:ring-2 hover:ring-primary-300 hover:ring-offset-1'
                    }`}
                  >
                    <img
                      src={getImageUrl(image.storage_path)}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {isSelected && (
                      <div className="absolute inset-0 bg-primary-500/20 flex items-center justify-center">
                        <div className="w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center">
                          <Check className="w-5 h-5 text-white" />
                        </div>
                      </div>
                    )}
                    {image.is_favorite && (
                      <div className="absolute top-1 right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center">
                        <Heart className="w-3 h-3 text-red-500 fill-current" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-500">
              <ImageIcon className="w-12 h-12 mb-3 text-neutral-300" />
              <p className="text-sm">
                {filter === 'favorites' ? 'お気に入りの画像がありません' : '画像がありません'}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        {multiple && selectedImages.size > 0 && (
          <div className="flex justify-end gap-3 pt-4 border-t border-neutral-200 dark:border-neutral-700">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-800"
            >
              キャンセル
            </button>
            <button
              onClick={handleConfirmMultiple}
              className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 transition-colors"
            >
              {selectedImages.size}枚を選択
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

