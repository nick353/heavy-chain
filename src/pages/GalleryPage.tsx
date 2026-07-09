import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  FileText,
  ExternalLink,
  Share2,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { withSignedImageUrls } from '../lib/storage';
import {
  deleteWorkspaceArtifact,
  isLocalWorkspaceImage,
  listWorkspaceGeneratedImages,
} from '../lib/localWorkspaceArtifacts';
import { buildSourceContextSummaryRows } from '../lib/sourceContextSummary';
import { Button, SearchInput } from '../components/ui';
import type { GeneratedImage } from '../types/database';
import type { GenerationIntent } from '../lib/workspaceHandoff';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

type FilterType = 'all' | 'favorites' | 'recent';
type SortType = 'newest' | 'oldest' | 'name';
const INITIAL_VISIBLE_IMAGE_COUNT = 60;
const VISIBLE_IMAGE_INCREMENT = 30;
const GALLERY_REMOTE_TIMEOUT_MS = 10_000;

const isGenerationIntent = (value: unknown): value is GenerationIntent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const intent = value as Partial<GenerationIntent>;
  return Boolean(intent.href && typeof intent.href === 'string');
};

const getGenerationIntent = (image: GeneratedImage | null) => {
  const metadata = image?.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return isGenerationIntent(metadata.generationIntent) ? metadata.generationIntent : null;
};

const getMetadataString = (image: GeneratedImage | null, key: string) => {
  const metadata = image?.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

export function GalleryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, currentBrand, refreshCurrentBrand } = useAuthStore();

  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingStalled, setIsLoadingStalled] = useState(false);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortBy, setSortBy] = useState<SortType>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [gridSize, setGridSize] = useState<'small' | 'large'>('large');
  const [visibleImageCount, setVisibleImageCount] = useState(INITIAL_VISIBLE_IMAGE_COUNT);
  const fetchImagesSeqRef = useRef(0);
  const selectedGenerationIntent = getGenerationIntent(selectedImage);
  const selectedSourceLabel = getMetadataString(selectedImage, 'sourceLabel');
  const selectedSourceResumePath = getMetadataString(selectedImage, 'sourceResumePath');
  const selectedSourceSummaryRows = buildSourceContextSummaryRows(selectedImage?.metadata);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(new Set());

  // Multi-select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Recent searches
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('gallery_recent_searches');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  });

  const getImageUrl = useCallback((image: GeneratedImage | string) => {
    // 文字列の場合（レガシーコードサポート）
    if (typeof image === 'string') {
      const path = image;
      if (!path) return '';
      if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path;
      }
      try {
        return '';
      } catch {
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
      return '';
    }
    try {
      // storage_pathがすでに完全なURLの場合はそのまま返す
      if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path;
      }
      return '';
    } catch {
      return '';
    }
  }, []);

  const fetchImages = useCallback(async () => {
    if (!currentBrand) {
      setIsLoading(false);
      setIsLoadingStalled(false);
      return;
    }

    const brandId = currentBrand.id;
    const requestSeq = ++fetchImagesSeqRef.current;
    const isCurrentRequest = () => (
      fetchImagesSeqRef.current === requestSeq &&
      useAuthStore.getState().currentBrand?.id === brandId
    );
    setIsLoading(true);
    setIsLoadingStalled(false);
    setLoadWarning(null);
    setFailedImageIds(new Set());
    try {
      const localImages = filter === 'favorites' ? [] : listWorkspaceGeneratedImages(brandId);
      let query = supabase
        .from('generated_images')
        .select('*')
        .eq('brand_id', brandId);

      if (filter === 'favorites') {
        query = query.eq('is_favorite', true);
      }

      if (sortBy === 'newest') {
        query = query.order('created_at', { ascending: false });
      } else if (sortBy === 'oldest') {
        query = query.order('created_at', { ascending: true });
      }

      const { data, error } = await withTimeout(
        query,
        GALLERY_REMOTE_TIMEOUT_MS,
        'gallery_remote_images_timeout',
      );

      let remoteImages: GeneratedImage[] = [];
      if (error) {
        if (!isCurrentRequest()) return;
        setLoadWarning('保存済み画像の取得に失敗しました。ローカル成果物だけを表示しています。');
      } else {
        const remoteRows = data || [];
        try {
          remoteImages = await withTimeout(
            withSignedImageUrls(remoteRows),
            GALLERY_REMOTE_TIMEOUT_MS,
            'gallery_signed_urls_timeout',
          );
        } catch {
          if (!isCurrentRequest()) return;
          remoteImages = remoteRows;
          setLoadWarning('画像プレビューURLの取得に時間がかかっています。成果物一覧は表示しています。');
        }
      }

      const mergedImages = [...remoteImages, ...localImages]
        .sort((a, b) => {
          if (sortBy === 'oldest') {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          }
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
      if (!isCurrentRequest()) return;
      setImages(mergedImages);
    } catch {
      const localImages = filter === 'favorites' ? [] : listWorkspaceGeneratedImages(brandId);
      if (!isCurrentRequest()) return;
      setLoadWarning('保存済み画像の取得に時間がかかっています。ローカル成果物だけを表示しています。');
      setImages(localImages);
    } finally {
      if (isCurrentRequest()) {
        setIsLoading(false);
        setIsLoadingStalled(false);
      }
    }
  }, [currentBrand, filter, sortBy]);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      if (!currentBrand && user) {
        const refreshedBrand = await refreshCurrentBrand();
        if (refreshedBrand) return;
      }

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
  }, [currentBrand, fetchImages, refreshCurrentBrand, user]);

  useEffect(() => {
    if (!isLoading) {
      setIsLoadingStalled(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setIsLoadingStalled(true);
    }, GALLERY_REMOTE_TIMEOUT_MS + 2_000);

    return () => window.clearTimeout(timeoutId);
  }, [isLoading]);

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
    } catch {
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

  const handleToggleFavorite = useCallback(async (image: GeneratedImage) => {
    if (isLocalWorkspaceImage(image)) {
      toast('ローカル成果物のお気に入りは次のスライスで対応します');
      return;
    }

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
    } catch {
      toast.error('操作に失敗しました');
    }
  }, [selectedImage]);

  const handleDelete = async (image: GeneratedImage) => {
    if (!confirm('この画像を削除しますか？')) return;

    if (isLocalWorkspaceImage(image)) {
      deleteWorkspaceArtifact(image.brand_id, image.id);
      setImages(prev => prev.filter(img => img.id !== image.id));
      setSelectedImage(null);
      toast.success('ローカル成果物を削除しました');
      return;
    }

    try {
      const { error: storageError } = await supabase.storage
        .from('generated-images')
        .remove([image.storage_path]);
      if (storageError) throw storageError;

      const { error: deleteError } = await supabase
        .from('generated_images')
        .delete()
        .eq('id', image.id);
      if (deleteError) throw deleteError;

      setImages(prev => prev.filter(img => img.id !== image.id));
      setSelectedImage(null);
      toast.success('画像を削除しました');
    } catch {
      toast.error('削除に失敗しました');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size}枚の画像を削除しますか？`)) return;

    try {
      const imagesToDelete = images.filter(img => selectedIds.has(img.id));
      const remoteImagesToDelete = imagesToDelete.filter((image) => !isLocalWorkspaceImage(image));
      const localImagesToDelete = imagesToDelete.filter(isLocalWorkspaceImage);

      localImagesToDelete.forEach((image) => deleteWorkspaceArtifact(image.brand_id, image.id));

      if (remoteImagesToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('generated-images')
          .remove(remoteImagesToDelete.map(img => img.storage_path));
        if (storageError) throw storageError;

        const { error: deleteError } = await supabase
          .from('generated_images')
          .delete()
          .in('id', remoteImagesToDelete.map((image) => image.id));
        if (deleteError) throw deleteError;
      }

      setImages(prev => prev.filter(img => !selectedIds.has(img.id)));
      setSelectedIds(new Set());
      setSelectMode(false);
      toast.success('削除しました');
    } catch {
      toast.error('削除に失敗しました');
    }
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
    setSelectedIds(new Set(galleryImages.map(img => img.id)));
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
      try {
        localStorage.setItem('gallery_recent_searches', JSON.stringify(newRecent));
      } catch (error) {
        console.warn('Failed to persist gallery recent searches:', error);
      }
    }
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    try {
      localStorage.removeItem('gallery_recent_searches');
    } catch (error) {
      console.warn('Failed to clear gallery recent searches:', error);
    }
  };

  // Copy prompt to clipboard
  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    toast.success('プロンプトをコピーしました');
  };

  const copyText = async (text: string, message: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  };

  const handleCreateShareLink = async (image: GeneratedImage) => {
    if (isLocalWorkspaceImage(image)) {
      const imageUrl = getImageUrl(image);
      if (!imageUrl) {
        toast.error('共有できる画像URLがありません');
        return;
      }
      await copyText(imageUrl, 'ローカル画像URLをコピーしました');
      return;
    }

    toast.error('共有リンク作成は公開範囲と責任分界が確定するまで無効です');
  };

  // Get unique feature types for suggestions
  const featureSuggestions = useMemo(() => {
    const features = new Set<string>();
    images.forEach(img => {
      if (img.feature_type) features.add(img.feature_type);
    });
    return Array.from(features);
  }, [images]);
  const imageSearchIndex = useMemo(() => {
    const index = new Map<string, string>();
    images.forEach((image) => {
      index.set(
        image.id,
        [
          image.prompt,
          image.feature_type,
          image.style_preset,
          image.id,
          image.storage_path,
          JSON.stringify(image.metadata ?? {}),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
      );
    });
    return index;
  }, [images]);

  const filteredImages = useMemo(() => {
    if (!searchQuery) return images;

    const searchLower = searchQuery.toLowerCase();
    return images.filter(image => imageSearchIndex.get(image.id)?.includes(searchLower));
  }, [imageSearchIndex, images, searchQuery]);
  const galleryImages = useMemo(
    () => filteredImages.filter((image) => !failedImageIds.has(image.id)),
    [failedImageIds, filteredImages]
  );

  useEffect(() => {
    if (selectedImage && failedImageIds.has(selectedImage.id)) {
      setSelectedImage(null);
      setSearchParams({});
    }
  }, [failedImageIds, selectedImage, setSearchParams]);

  const visibleImages = useMemo(
    () => galleryImages.slice(0, visibleImageCount),
    [galleryImages, visibleImageCount]
  );
  const favoriteCount = images.filter((image) => image.is_favorite).length;
  const localWorkspaceCount = images.filter(isLocalWorkspaceImage).length;

  useEffect(() => {
    setVisibleImageCount(INITIAL_VISIBLE_IMAGE_COUNT);
  }, [filter, sortBy, searchQuery, gridSize]);

  const navigateImage = useCallback((direction: 'prev' | 'next') => {
    if (!selectedImage) return;
    if (galleryImages.length === 0) return;

    const currentIndex = galleryImages.findIndex(img => img.id === selectedImage.id);
    let newIndex = currentIndex;

    if (currentIndex < 0) {
      newIndex = direction === 'next' ? 0 : galleryImages.length - 1;
    } else {
      newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
      if (newIndex < 0) newIndex = galleryImages.length - 1;
      if (newIndex >= galleryImages.length) newIndex = 0;
    }

    const newImage = galleryImages[newIndex];
    setSelectedImage(newImage);

    // Update URL
    setSearchParams({ image: newImage.id });
  }, [galleryImages, selectedImage, setSearchParams]);

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
  }, [selectedImage, navigateImage, setSearchParams, handleToggleFavorite]);

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
            <h1 className="mb-1 text-2xl font-display font-semibold text-white">
              ギャラリー
            </h1>
            <p className="text-neutral-400">
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
            <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.04] p-1 backdrop-blur-sm">
              <button
                onClick={() => setGridSize('large')}
                className={`rounded p-1.5 transition-colors ${gridSize === 'large' ? 'bg-cyan-300 text-neutral-950' : 'text-neutral-400 hover:text-white'}`}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setGridSize('small')}
                className={`rounded p-1.5 transition-colors ${gridSize === 'small' ? 'bg-cyan-300 text-neutral-950' : 'text-neutral-400 hover:text-white'}`}
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
                ? 'bg-cyan-300 text-neutral-950'
                  : 'border border-white/10 bg-white/[0.04] text-neutral-300 hover:border-cyan-300/40 hover:bg-white/[0.07]'
              }`}
            >
              {selectMode ? '選択解除' : '選択'}
            </button>
          </div>
        </motion.div>

        {isLoading ? (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-neutral-200 backdrop-blur-sm">
            <div className="spinner h-5 w-5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">ギャラリーを読み込み中</p>
              <p className="mt-1 text-xs text-neutral-400">
                {isLoadingStalled
                  ? '画像の読み込みに時間がかかっています。待ちながら次の作業へ進めます。'
                  : '保存済み画像とローカル成果物を確認しています。'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={fetchImages}
                className="inline-flex rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/40 hover:bg-cyan-300/10"
              >
                再読み込み
              </button>
              <Link
                to="/lightchain"
                className="inline-flex rounded-lg bg-cyan-300 px-3 py-1.5 text-xs font-semibold text-neutral-950 transition hover:bg-cyan-200"
              >
                新しく生成
              </Link>
            </div>
          </div>
        ) : null}

        {loadWarning && !isLoading ? (
          <div className="mb-6 rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] p-4 text-sm text-amber-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>{loadWarning}</p>
              <button
                type="button"
                onClick={fetchImages}
                className="inline-flex w-fit items-center rounded-lg border border-amber-300/30 px-3 py-1.5 text-xs font-semibold transition hover:bg-amber-300/10"
              >
                再読み込み
              </button>
            </div>
          </div>
        ) : null}

        {!isLoading && failedImageIds.size > 0 ? (
          <div className="mb-6 rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] p-4 text-sm text-amber-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>{failedImageIds.size}件の画像プレビューを確認中です。読込に失敗した画像は一覧から外しています。</p>
              <button
                type="button"
                onClick={fetchImages}
                className="inline-flex w-fit items-center rounded-lg border border-amber-300/30 px-3 py-1.5 text-xs font-semibold transition hover:bg-amber-300/10"
              >
                再読み込み
              </button>
            </div>
          </div>
        ) : null}

        <section className="mb-6 grid gap-3 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => {
              setSelectMode(true);
              setSelectedIds(new Set());
            }}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left shadow-sm transition hover:border-cyan-300/40 hover:bg-white/[0.07] backdrop-blur-sm"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              <CheckSquare className="h-4 w-4 text-cyan-300" />
              成果物を選ぶ
            </span>
            <p className="mt-2 text-xs leading-5 text-neutral-400">
              複数画像を選択して、一括ダウンロードや整理に進みます。
            </p>
            <span className="mt-3 inline-flex rounded-full bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">
              {selectedIds.size}枚選択中
            </span>
          </button>

          <Link
            to="/canvas/new"
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left shadow-sm transition hover:border-cyan-300/40 hover:bg-white/[0.07] backdrop-blur-sm"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles className="h-4 w-4 text-cyan-300" />
              Canvasで再編集
            </span>
            <p className="mt-2 text-xs leading-5 text-neutral-400">
              保存済み画像を開いて、背景削除、色変更、派生生成へつなげます。
            </p>
            <span className="mt-3 inline-flex rounded-full bg-white/[0.05] px-2.5 py-1 text-xs font-semibold text-neutral-300">
              ローカル成果物 {localWorkspaceCount}件
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setFilter('favorites')}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left shadow-sm transition hover:border-cyan-300/40 hover:bg-white/[0.07] backdrop-blur-sm"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              <Heart className="h-4 w-4 text-cyan-300" />
              採用候補を見る
            </span>
            <p className="mt-2 text-xs leading-5 text-neutral-400">
              お気に入りにした画像だけを絞り込み、共有やダウンロードへ進みます。
            </p>
            <span className="mt-3 inline-flex rounded-full bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">
              お気に入り {favoriteCount}件
            </span>
          </button>
        </section>

        {/* Select Mode Actions */}
        <AnimatePresence>
          {selectMode && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 overflow-hidden"
            >
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
                <span className="text-sm text-cyan-100">
                  {selectedIds.size}枚選択中
                </span>
                <button onClick={selectAll} className="text-sm text-cyan-300 hover:text-cyan-200">
                  すべて選択
                </button>
                <button onClick={deselectAll} className="text-sm text-cyan-300 hover:text-cyan-200">
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
                  ? 'bg-cyan-300 text-neutral-950 shadow-sm'
                  : 'hover:bg-white/[0.06] text-neutral-400'
              }`}
            >
              すべて
            </button>
            <button
              onClick={() => setFilter('favorites')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                filter === 'favorites'
                  ? 'bg-cyan-300 text-neutral-950 shadow-sm'
                  : 'hover:bg-white/[0.06] text-neutral-400'
              }`}
            >
              <Heart className="w-4 h-4" />
              お気に入り
            </button>
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortType)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-neutral-200 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
          >
            <option value="newest">新しい順</option>
            <option value="oldest">古い順</option>
          </select>
        </div>

        {/* Gallery Grid */}
        {isLoading ? null : galleryImages.length > 0 ? (
          <>
            <motion.div
              layout
              className={`grid gap-4 ${
                gridSize === 'large'
                  ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4'
                  : 'grid-cols-3 sm:grid-cols-4 xl:grid-cols-6'
              }`}
            >
              <AnimatePresence mode="popLayout">
                {visibleImages.map((image) => (
                  <motion.div
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.3 }}
                    key={image.id}
                    className={`group relative aspect-square overflow-hidden rounded-xl bg-white/[0.04] cursor-pointer transition-all shadow-sm hover:shadow-lg backdrop-blur-sm ${
                      selectMode && selectedIds.has(image.id) ? 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-[#050607]' : 'hover:ring-2 hover:ring-cyan-300'
                    }`}
                    onClick={() => selectMode ? toggleSelectImage(image.id) : setSelectedImage(image)}
                  >
                    {getImageUrl(image) ? (
                      <img
                        src={getImageUrl(image)}
                        alt=""
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                        onError={() => {
                          setFailedImageIds((previous) => {
                            if (previous.has(image.id)) return previous;
                            const next = new Set(previous);
                            next.add(image.id);
                            return next;
                          });
                          setSelectedIds((previous) => {
                            if (!previous.has(image.id)) return previous;
                            const next = new Set(previous);
                            next.delete(image.id);
                            return next;
                          });
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-neutral-950/70">
                        <span className="text-neutral-400 text-sm">プレビュー準備中</span>
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
                      <div className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-950/80 backdrop-blur-sm shadow-sm">
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
            {visibleImages.length < galleryImages.length && (
              <div className="mt-6 flex justify-center">
                <Button
                  variant="secondary"
                  onClick={() => setVisibleImageCount((count) => count + VISIBLE_IMAGE_INCREMENT)}
                >
                  さらに表示 ({visibleImages.length}/{galleryImages.length})
                </Button>
              </div>
            )}
          </>
        ) : filteredImages.length > 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-12 text-center backdrop-blur-sm"
          >
            <div className="w-24 h-24 bg-gradient-to-br from-amber-200/30 to-neutral-700/30 dark:from-amber-500/20 dark:to-neutral-800 rounded-3xl flex items-center justify-center mx-auto mb-8">
              <Image className="w-10 h-10 text-amber-200/80 dark:text-amber-300" />
            </div>
            <h3 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-4 font-display">
              画像プレビューを確認中です
            </h3>
            <p className="text-neutral-600 dark:text-neutral-400 mb-8 max-w-md mx-auto leading-relaxed">
              {failedImageIds.size}件の画像が読み込みに失敗しました。再読み込みするか、Jobsから状態を確認できます。
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                className="rounded-full shadow-glow hover:shadow-glow-lg"
                onClick={fetchImages}
              >
                再読み込み
              </Button>
              <Link to="/jobs">
                <Button
                  size="lg"
                  variant="secondary"
                  className="rounded-full"
                  leftIcon={<Clock className="w-5 h-5" size={20} />}
                >
                  Jobsを見る
                </Button>
              </Link>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-12 text-center backdrop-blur-sm"
          >
            <Image className="w-12 h-12 text-neutral-300 dark:text-neutral-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-neutral-700 dark:text-neutral-200 mb-2">
              {filter === 'favorites' ? 'お気に入りはまだありません' : 'まだ画像はありません'}
            </h3>
            <p className="mb-6 text-neutral-400">
              {filter === 'favorites'
                ? 'ハートアイコンをクリックしてお気に入りに追加しましょう'
                : '画像を生成すると、ここに表示されます'
              }
            </p>
            <Link to="/lightchain">
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
                  {(() => {
                    const currentIndex = galleryImages.findIndex((img) => img.id === selectedImage.id);
                    return currentIndex >= 0 ? `${currentIndex + 1} / ${galleryImages.length}` : `— / ${galleryImages.length}`;
                  })()}
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

                  {selectedSourceSummaryRows.length > 0 && (
                    <div className="mb-8">
                      <h4 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Sparkles className="w-3 h-3" />
                        生成条件
                      </h4>
                      <dl className="space-y-2 rounded-xl bg-white/5 p-4">
                        {selectedSourceSummaryRows.map((row) => (
                          <div key={`${row.label}-${row.value}`} className="grid grid-cols-[88px_1fr] gap-3 text-sm">
                            <dt className="text-white/45">{row.label}:</dt>
                            <dd className="min-w-0 break-words text-white/85">{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}

                  {/* Download Options */}
                  <div className="space-y-3 mb-8">
                    <h4 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">ダウンロード</h4>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => handleDownload(selectedImage, 'png')}
                        className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-medium text-neutral-950 transition-colors hover:bg-cyan-200"
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
                        onClick={() => handleCreateShareLink(selectedImage)}
                      disabled={!isLocalWorkspaceImage(selectedImage)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-white/10 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-all"
                    >
                      <Share2 className="w-4 h-4" />
                      {isLocalWorkspaceImage(selectedImage) ? 'ローカルURLをコピー' : '共有リンクは未有効'}
                    </button>
                    {selectedSourceLabel && selectedSourceResumePath && (
                      <Link
                        to={selectedSourceResumePath}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-semibold transition-all"
                      >
                        <ExternalLink className="w-4 h-4" />
                        元ワークスペースへ戻る: {selectedSourceLabel}
                      </Link>
                    )}
                    {selectedGenerationIntent?.href && (
                      <Link
                        to={selectedGenerationIntent.href}
                        className="flex w-full items-center gap-3 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-neutral-950 transition-all hover:bg-cyan-200"
                      >
                        <Sparkles className="w-4 h-4" />
                        この内容で生成
                      </Link>
                    )}
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

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
