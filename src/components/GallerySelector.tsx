import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Search, Check, Image as ImageIcon, Heart, Clock, Folder as FolderIcon, ChevronRight, House } from 'lucide-react';
import { Modal } from './ui';
import { supabase } from '../lib/supabase';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';
import type { Folder, GeneratedImage } from '../types/database';
import {
  getGalleryPendingImageUrl,
  resolveGalleryPendingSelection,
} from '../features/printing/selection/galleryPendingSelection';
import {
  createGalleryFolderNavigation,
  getGalleryFolderImageIds,
  getGalleryFolderPath,
  type GalleryFolderMembership,
} from '../features/printing/selection/galleryFolderNavigation';
import {
  PRINT_DESIGN_ASSET_PURPOSE,
  type PrintDesignAssetPurpose,
} from '../features/printing/selection/printDesignAssetPurpose';
import { shouldShowPrintDesignCreationCta } from '../features/printing/selection/galleryPrintDesignCta';

interface GallerySelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (imageUrl: string, imageId: string, storagePath?: string, imageElement?: HTMLImageElement | null) => void;
  title?: string;
  multiple?: boolean;
  confirmedSingle?: boolean;
  confirmLabel?: string;
  maxSelect?: number;
  onMultipleSelect?: (images: { url: string; id: string }[]) => void;
  assetPurpose?: PrintDesignAssetPurpose;
}

type FilterType = 'all' | 'recent' | 'favorites';

const GALLERY_SKELETON_TILE_COUNT = 12;

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
  confirmedSingle = false,
  confirmLabel = '素材を追加',
  maxSelect = 5,
  onMultipleSelect,
  assetPurpose,
}: GallerySelectorProps) {
  const { currentBrand } = useAuthStore();
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderMemberships, setFolderMemberships] = useState<GalleryFolderMembership[]>([]);
  const [loadedBrandId, setLoadedBrandId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('recent');
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [loadedImageIds, setLoadedImageIds] = useState<Set<string>>(new Set());
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(new Set());
  const fetchRequestRevisionRef = useRef(0);
  const singleCommitInFlightRef = useRef(false);

  const clearGalleryState = useCallback(() => {
    fetchRequestRevisionRef.current += 1;
    singleCommitInFlightRef.current = false;
    setSelectedImages(new Set());
    setLoadedImageIds(new Set());
    setFailedImageIds(new Set());
    setImages([]);
    setFolders([]);
    setFolderMemberships([]);
    setLoadedBrandId(null);
    setSearchQuery('');
    setCurrentFolderId(null);
    setLoadError(null);
    setIsLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    clearGalleryState();
    onClose();
  }, [clearGalleryState, onClose]);

  const fetchImages = useCallback(async () => {
    const requestRevision = fetchRequestRevisionRef.current + 1;
    fetchRequestRevisionRef.current = requestRevision;
    setSelectedImages(new Set());
    setLoadedImageIds(new Set());
    setFailedImageIds(new Set());
    setImages([]);
    setFolders([]);
    setFolderMemberships([]);
    setLoadedBrandId(null);
    setLoadError(null);
    setIsLoading(true);
    if (!currentBrand) {
      setLoadError('ブランドを選択してからギャラリーを開いてください。');
      setIsLoading(false);
      return;
    }
    try {
      let imageQuery = supabase
        .from('generated_images')
        .select('*')
        .eq('brand_id', currentBrand.id)
        .order('created_at', { ascending: false });

      if (assetPurpose === PRINT_DESIGN_ASSET_PURPOSE) {
        imageQuery = imageQuery.contains('metadata', { assetPurpose: PRINT_DESIGN_ASSET_PURPOSE });
      }

      if (filter === 'favorites') {
        imageQuery = imageQuery.eq('is_favorite', true);
      }

      if (filter === 'recent') {
        imageQuery = imageQuery.limit(20);
      } else {
        imageQuery = imageQuery.limit(50);
      }

      const [imageResult, folderResult] = await Promise.all([
        imageQuery,
        supabase
          .from('folders')
          .select('*')
          .eq('brand_id', currentBrand.id)
          .order('name', { ascending: true }),
      ]);

      if (requestRevision !== fetchRequestRevisionRef.current) return;
      if (imageResult.error) throw imageResult.error;
      if (folderResult.error) throw folderResult.error;

      const nextFolders = folderResult.data || [];
      const folderNavigation = createGalleryFolderNavigation(nextFolders);
      const folderIds = Array.from(folderNavigation.foldersById.keys());
      let nextMemberships: GalleryFolderMembership[] = [];
      if (folderIds.length > 0) {
        const membershipResult = await supabase
          .from('image_folders')
          .select('image_id,folder_id')
          .in('folder_id', folderIds);
        if (requestRevision !== fetchRequestRevisionRef.current) return;
        if (membershipResult.error) throw membershipResult.error;
        nextMemberships = membershipResult.data || [];
      }

      const signedImages = await withSignedImageUrls(imageResult.data || []);
      if (requestRevision !== fetchRequestRevisionRef.current) return;
      setImages(signedImages);
      setFolders(nextFolders);
      setFolderMemberships(nextMemberships);
      setLoadedBrandId(currentBrand.id);
      setCurrentFolderId((folderId) => (
        folderId && getGalleryFolderPath(folderNavigation, folderId) == null ? null : folderId
      ));
    } catch (error) {
      if (requestRevision === fetchRequestRevisionRef.current) {
        console.error('Failed to fetch images:', error);
        setLoadError('ギャラリーを読み込めませんでした。時間をおいて再度お試しください。');
      }
    } finally {
      if (requestRevision === fetchRequestRevisionRef.current) {
        setIsLoading(false);
      }
    }
  }, [assetPurpose, currentBrand, filter]);

  useEffect(() => {
    if (isOpen) {
      fetchImages();
    }
  }, [isOpen, filter, fetchImages]);

  useEffect(() => {
    if (!isOpen) {
      clearGalleryState();
    }
  }, [clearGalleryState, isOpen]);

  const handleFilterChange = (nextFilter: FilterType) => {
    if (nextFilter === filter) return;
    fetchRequestRevisionRef.current += 1;
    setSelectedImages(new Set());
    setLoadedImageIds(new Set());
    setFailedImageIds(new Set());
    singleCommitInFlightRef.current = false;
    setImages([]);
    setFolders([]);
    setFolderMemberships([]);
    setLoadedBrandId(null);
    setLoadError(null);
    setIsLoading(true);
    setFilter(nextFilter);
  };

  const hasCurrentBrandData = Boolean(currentBrand && loadedBrandId === currentBrand.id);
  const visibleFolders = hasCurrentBrandData ? folders : [];
  const visibleMemberships = hasCurrentBrandData ? folderMemberships : [];
  const visibleImages = hasCurrentBrandData ? images : [];
  const displayLoading = isLoading || Boolean(isOpen && currentBrand && !hasCurrentBrandData && !loadError);
  const folderNavigation = createGalleryFolderNavigation(visibleFolders);
  const folderPath = getGalleryFolderPath(folderNavigation, currentFolderId) ?? [];
  const childFolders = folderNavigation.childrenByParentId.get(currentFolderId) ?? [];

  const handleFolderChange = (folderId: string | null) => {
    if (getGalleryFolderPath(folderNavigation, folderId) == null) return;
    setSelectedImages(new Set());
    singleCommitInFlightRef.current = false;
    setCurrentFolderId(folderId);
  };

  const getImageUrl = getGalleryPendingImageUrl;

  const handleImageLoad = (imageId: string) => {
    setFailedImageIds((current) => {
      if (!current.has(imageId)) return current;
      const next = new Set(current);
      next.delete(imageId);
      return next;
    });
    setLoadedImageIds((current) => {
      if (current.has(imageId)) return current;
      const next = new Set(current);
      next.add(imageId);
      return next;
    });
  };

  const handleImageError = (imageId: string) => {
    singleCommitInFlightRef.current = false;
    setSelectedImages((current) => {
      if (!current.has(imageId)) return current;
      const next = new Set(current);
      next.delete(imageId);
      return next;
    });
    setLoadedImageIds((current) => {
      if (!current.has(imageId)) return current;
      const next = new Set(current);
      next.delete(imageId);
      return next;
    });
    setFailedImageIds((current) => {
      if (current.has(imageId)) return current;
      const next = new Set(current);
      next.add(imageId);
      return next;
    });
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
    } else if (confirmedSingle) {
      setSelectedImages(new Set([image.id]));
    } else {
      const imageUrl = getImageUrl(image);
      const imageElement = event.currentTarget.querySelector('img') as HTMLImageElement | null;
      onSelect(imageUrl, image.id, image.storage_path, imageElement);
    }
  };

  const pendingSingleSelectionCandidate = confirmedSingle
    ? resolveGalleryPendingSelection(visibleImages, selectedImages.values().next().value)
    : null;
  const pendingSingleSelection = pendingSingleSelectionCandidate
    && loadedImageIds.has(pendingSingleSelectionCandidate.image.id)
    && !failedImageIds.has(pendingSingleSelectionCandidate.image.id)
    ? pendingSingleSelectionCandidate
    : null;

  const handleConfirmSingle = () => {
    if (displayLoading || !pendingSingleSelection || singleCommitInFlightRef.current) return;
    singleCommitInFlightRef.current = true;
    const { image, imageUrl } = pendingSingleSelection;
    onSelect(imageUrl, image.id, image.storage_path, null);
    handleClose();
  };

  const handleConfirmMultiple = () => {
    if (displayLoading) return;
    if (onMultipleSelect) {
      const selected = visibleImages
        .filter(img => selectedImages.has(img.id))
        .map(img => ({
          url: getImageUrl(img),
          id: img.id,
        }));
      onMultipleSelect(selected);
    }
    handleClose();
  };

  const currentFolderImageIds = getGalleryFolderImageIds(visibleMemberships, currentFolderId);
  const filteredImages = visibleImages.filter((image) => {
    if (currentFolderImageIds && !currentFolderImageIds.has(image.id)) return false;
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return getImageSearchText(image).includes(normalizedQuery);
  });
  const normalizedSearchQuery = searchQuery.trim();
  const showPrintDesignCreationCta = shouldShowPrintDesignCreationCta({
    assetPurpose,
    normalizedSearchQuery,
    filter,
    currentFolderId,
    visibleImageCount: filteredImages.length,
  });
  const printDesignCreationCta = showPrintDesignCreationCta ? (
    <Link
      to="/patterns"
      onClick={handleClose}
      className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
    >
      プリントデザインを作る
    </Link>
  ) : null;
  const emptyMessage = normalizedSearchQuery
    ? '検索条件に一致する画像はありません'
    : currentFolderId && filter === 'favorites'
      ? 'このフォルダにお気に入り画像はありません'
      : currentFolderId
        ? 'このフォルダに画像はありません'
        : filter === 'favorites'
          ? 'お気に入りはまだありません'
          : assetPurpose === PRINT_DESIGN_ASSET_PURPOSE
            ? 'プリントデザインはまだありません。ローカル画像は選択画面からアップロードできます'
            : 'まだ画像はありません';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
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
              onClick={() => handleFilterChange('recent')}
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
              onClick={() => handleFilterChange('favorites')}
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
              onClick={() => handleFilterChange('all')}
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

        {/* Read-only folder path */}
        {(visibleFolders.length > 0 || currentFolderId) && (
          <nav aria-label="ギャラリーフォルダ" data-testid="gallery-folder-breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-neutral-500 dark:text-neutral-300">
            <button
              type="button"
              onClick={() => handleFolderChange(null)}
              aria-current={currentFolderId == null ? 'page' : undefined}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <House className="h-3.5 w-3.5" />
              すべての素材
            </button>
            {folderPath.map((folder) => (
              <span key={folder.id} className="inline-flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => handleFolderChange(folder.id)}
                  aria-current={folder.id === currentFolderId ? 'page' : undefined}
                  className="rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {folder.name}
                </button>
              </span>
            ))}
          </nav>
        )}

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
        <div
          aria-busy={displayLoading}
          className="h-[min(400px,calc(100dvh-16rem))] min-h-64 overflow-y-auto"
        >
          {displayLoading ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="gallery-loading-grid"
              className="grid grid-cols-4 gap-3"
            >
              <span className="sr-only">ギャラリーを読み込み中</span>
              {Array.from({ length: GALLERY_SKELETON_TILE_COUNT }, (_, index) => (
                <div
                  key={index}
                  aria-hidden="true"
                  className="aspect-square animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800 motion-reduce:animate-none"
                />
              ))}
            </div>
          ) : loadError ? (
            <div role="alert" className="flex min-h-32 items-center justify-center px-6 text-center text-sm text-red-600 dark:text-red-300">
              {loadError}
            </div>
          ) : childFolders.length > 0 || filteredImages.length > 0 ? (
            <div className="space-y-4">
              {showPrintDesignCreationCta && (
                <div className="flex items-center justify-between gap-4 rounded-xl border border-primary-300/40 bg-primary-50 p-4 dark:border-primary-500/30 dark:bg-primary-900/20">
                  <p className="text-sm text-neutral-700 dark:text-neutral-200">
                    このブランドには、選択できるプリントデザインがまだありません。
                  </p>
                  {printDesignCreationCta}
                </div>
              )}
              {childFolders.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="gallery-folder-grid">
                  {childFolders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => handleFolderChange(folder.id)}
                      className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-center text-sm font-medium text-neutral-700 transition hover:border-primary-300 hover:bg-primary-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:border-primary-500/60 dark:hover:bg-primary-900/20"
                    >
                      <FolderIcon className="h-8 w-8 text-primary-500" />
                      <span className="line-clamp-2">{folder.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {filteredImages.length > 0 && <div className="grid grid-cols-4 gap-3">
              {filteredImages.map((image, index) => {
                const isSelected = selectedImages.has(image.id);
                const isImageLoaded = loadedImageIds.has(image.id);
                const hasImageLoadFailed = failedImageIds.has(image.id);
                const imageLabel = image.feature_type || image.prompt?.trim().slice(0, 48) || `ギャラリー画像 ${index + 1}`;
                return (
                  <button
                    key={image.id}
                    type="button"
                    onClick={(event) => handleImageClick(image, event)}
                    aria-pressed={multiple || confirmedSingle ? isSelected : undefined}
                    aria-busy={!isImageLoaded && !hasImageLoadFailed}
                    aria-label={`${imageLabel}を選択`}
                    title={imageLabel}
                    disabled={!isImageLoaded || hasImageLoadFailed}
                    className={`relative aspect-square rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 transition-all ${
                      isSelected
                        ? 'ring-2 ring-primary-500 ring-offset-2'
                        : 'hover:ring-2 hover:ring-primary-300 hover:ring-offset-1'
                    } disabled:cursor-not-allowed disabled:hover:ring-0`}
                  >
                    {!isImageLoaded && !hasImageLoadFailed && (
                      <span
                        data-testid="gallery-image-skeleton"
                        aria-hidden="true"
                        className="absolute inset-0 animate-pulse bg-neutral-200 dark:bg-neutral-800 motion-reduce:animate-none"
                      />
                    )}
                    <img
                      src={getImageUrl(image)}
                      alt={imageLabel}
                      className={`h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none ${
                        isImageLoaded ? 'opacity-100' : 'opacity-0'
                      }`}
                      loading="lazy"
                      onLoad={() => handleImageLoad(image.id)}
                      onError={() => handleImageError(image.id)}
                    />
                    {hasImageLoadFailed && (
                      <span
                        role="alert"
                        className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-neutral-100 px-2 text-center text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300"
                      >
                        <ImageIcon className="h-6 w-6" aria-hidden="true" />
                        画像を表示できません
                      </span>
                    )}
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
              </div>}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-500">
              <ImageIcon className="w-12 h-12 mb-3 text-neutral-300" />
              <p className="text-sm">
                {emptyMessage}
              </p>
              {showPrintDesignCreationCta && <div className="mt-4">{printDesignCreationCta}</div>}
            </div>
          )}
        </div>

        {/* Actions */}
        {multiple && selectedImages.size > 0 && (
          <div className="flex justify-end gap-3 pt-4 border-t border-neutral-200 dark:border-neutral-700">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-800"
            >
              キャンセル
            </button>
            <button
              onClick={handleConfirmMultiple}
              disabled={displayLoading}
              className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              {selectedImages.size}枚を選択
            </button>
          </div>
        )}
        {confirmedSingle && !multiple && (
          <div className="flex justify-end gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-700">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-800 dark:text-neutral-300 dark:hover:text-white"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleConfirmSingle}
              disabled={displayLoading || !pendingSingleSelection}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {confirmLabel}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
