import { useState, useEffect, useCallback } from 'react';
import { Search, Check, Image as ImageIcon, Heart, Clock } from 'lucide-react';
import { Modal } from './ui';
import { supabase } from '../lib/supabase';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import type { GeneratedImage } from '../types/database';

interface GallerySelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (imageUrl: string, imageId: string, storagePath?: string, imageElement?: HTMLImageElement | null) => void;
  title?: string;
  multiple?: boolean;
  maxSelect?: number;
  onMultipleSelect?: (images: { url: string; id: string }[]) => void;
}

type FilterType = 'all' | 'recent' | 'favorites';

const normalizeSearchText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).toLowerCase();

  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return '';
  }
};

const getImageSearchText = (image: GeneratedImage) => [
  image.prompt,
  image.negative_prompt,
  image.feature_type,
  image.storage_path,
  image.generation_params,
  image.metadata,
].map(normalizeSearchText).join(' ');

export function GallerySelector({
  isOpen,
  onClose,
  onSelect,
  title = 'ギャラリーから画像を選択',
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

  const fetchImages = useCallback(async () => {
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
      setImages(await withSignedImageUrls(data || []));
    } catch (error) {
      console.error('Failed to fetch images:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentBrand, filter]);

  useEffect(() => {
    if (isOpen && currentBrand) {
      fetchImages();
    }
  }, [isOpen, currentBrand, filter, fetchImages]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedImages(new Set());
      setSearchQuery('');
    }
  }, [isOpen]);

  const getImageUrl = (image: GeneratedImage) => {
    if (image.image_url) return image.image_url;
    const path = image.storage_path;
    if (/^(https?:|data:)/.test(path)) return path;
    return '';
  };

  const handleImageClick = (image: GeneratedImage, event: React.MouseEvent<HTMLButtonElement>) => {
    if (multiple) {
      const newSelected = new Set(selectedImages);
      
      if (newSelected.has(image.id)) {
        newSelected.delete(image.id);
      } else if (newSelected.size < maxSelect) {
        newSelected.add(image.id);
      }
      
      setSelectedImages(newSelected);
    } else {
      const imageUrl = getImageUrl(image);
      const imageElement = event.currentTarget.querySelector('img') as HTMLImageElement | null;
      onSelect(imageUrl, image.id, image.storage_path, imageElement);
    }
  };

  const handleConfirmMultiple = () => {
    if (onMultipleSelect) {
      const selected = images
        .filter(img => selectedImages.has(img.id))
        .map(img => ({
          url: getImageUrl(img),
          id: img.id,
        }));
      onMultipleSelect(selected);
    }
    onClose();
  };

  const filteredImages = images.filter((image) => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return getImageSearchText(image).includes(normalizedQuery);
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="xl"
    >
      <div className="space-y-4">
        {/* Search and Filter */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setFilter('recent')}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs rounded-md transition-colors ${
                filter === 'recent'
                  ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <Clock className="w-3 h-3" />
              最近
            </button>
            <button
              type="button"
              onClick={() => setFilter('favorites')}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs rounded-md transition-colors ${
                filter === 'favorites'
                  ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <Heart className="w-3 h-3" />
              お気に入り
            </button>
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs rounded-md transition-colors ${
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
        <div className="min-h-32 max-h-[min(400px,calc(100dvh-16rem))] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="spinner" />
            </div>
          ) : filteredImages.length > 0 ? (
            <div className="grid grid-cols-4 gap-3">
              {filteredImages.map((image, index) => {
                const isSelected = selectedImages.has(image.id);
                const imageLabel = image.feature_type || image.prompt?.trim().slice(0, 48) || `ギャラリー画像 ${index + 1}`;
                return (
                  <button
                    key={image.id}
                    type="button"
                    onClick={(event) => handleImageClick(image, event)}
                    aria-label={`${imageLabel}を選択`}
                    title={imageLabel}
                    className={`relative aspect-square rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 transition-all ${
                      isSelected
                        ? 'ring-2 ring-primary-500 ring-offset-2'
                        : 'hover:ring-2 hover:ring-primary-300 hover:ring-offset-1'
                    }`}
                  >
                    <img
                      src={getImageUrl(image)}
                      alt={imageLabel}
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
                {filter === 'favorites' ? 'お気に入りはまだありません' : 'まだ画像はありません'}
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
