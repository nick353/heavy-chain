import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { FolderOpen, Grid2X2, Image as ImageIcon, Plus, Search, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  getWorkspaceArtifactCanonicalStoragePath,
  listWorkspaceArtifacts,
  saveWorkspaceArtifactBestEffort,
  type WorkspaceArtifact,
} from '../lib/localWorkspaceArtifacts';
import { withSignedImageUrls } from '../lib/storage';
import { supabase } from '../lib/supabase';
import type { GeneratedImage } from '../types/database';
import {
  lightchainUnifiedFeatureCatalog,
} from '../lib/lightchainUnifiedFeatureCatalog';

const DEFAULT_LIBRARY_GROUPS = [
  'マイライブラリー',
  '履歴アップロード',
  '生成履歴',
  'ウェアデザインラボ生成結果',
  '2026AW',
  '新規格',
  'ノイズバリュー用ホリゾンカラー',
  'ライブラリー',
] as const;

const darkPanel = 'rounded-2xl border border-white/10 bg-[#151a1c]';
const mutedButton = 'rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-neutral-300 transition hover:border-cyan-200/50 hover:bg-white/[0.08] hover:text-white';
const MAX_LIBRARY_UPLOAD_BYTES = 10 * 1024 * 1024;

type RemoteLibraryAsset = {
  kind: 'remote';
  id: string;
  remoteImageId: string;
  title: string;
  featureType: string;
  imageUrl: string;
  prompt: string | null;
  createdAt: string;
  storagePath: string | null;
  isFavorite: boolean;
};

type LibraryCard =
  | { kind: 'local'; artifact: WorkspaceArtifact }
  | { kind: 'remote'; asset: RemoteLibraryAsset };

type LibraryFeatureDestination =
  | 'none'
  | 'fitting'
  | 'fabric'
  | 'printing'
  | { kind: 'feature'; featureId: string };

const cardTitle = (card: LibraryCard) => card.kind === 'local' ? card.artifact.title : card.asset.title;
const cardFeatureType = (card: LibraryCard) => card.kind === 'local' ? card.artifact.featureType : card.asset.featureType;
const cardImageUrl = (card: LibraryCard) => card.kind === 'local' ? card.artifact.imageUrl : card.asset.imageUrl;
const cardPrompt = (card: LibraryCard) => card.kind === 'local' ? card.artifact.prompt : card.asset.prompt;

const isVideoGeneratedImage = (image: GeneratedImage) => (
  /video|動画/i.test(image.feature_type || '')
);

const remoteAssetFromImage = (image: GeneratedImage): RemoteLibraryAsset | null => {
  if (!image.image_url || isVideoGeneratedImage(image)) return null;
  return {
    kind: 'remote',
    id: `remote-library-${image.id}`,
    remoteImageId: image.id,
    title: image.prompt?.split('\n')[0]?.trim().slice(0, 80) || image.feature_type || '生成画像',
    featureType: image.feature_type || 'generated-image',
    imageUrl: image.image_url,
    prompt: image.prompt,
    createdAt: image.created_at,
    storagePath: image.storage_path || null,
    isFavorite: image.is_favorite,
  };
};

const groupStorageKey = (brandId: string, userId?: string) => (
  `heavy-chain-lightchain-library-groups:v1:${brandId}:${userId || 'anonymous'}`
);

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string'
    ? resolve(reader.result)
    : reject(new Error('library_upload_read_failed'));
  reader.onerror = () => reject(reader.error ?? new Error('library_upload_read_failed'));
  reader.readAsDataURL(file);
});

const artifactGroup = (artifact: WorkspaceArtifact): string => (
  typeof artifact.metadata.libraryGroup === 'string' && artifact.metadata.libraryGroup.trim()
    ? artifact.metadata.libraryGroup
    : 'マイライブラリー'
);

const artifactSource = (artifact: WorkspaceArtifact): string => (
  typeof artifact.metadata.librarySource === 'string' ? artifact.metadata.librarySource : 'generation'
);

const buildLibraryFeatureHref = (feature: typeof lightchainUnifiedFeatureCatalog[number], artifactId: string): string => {
  const pathname = feature.id === 'ai-fitting' || feature.id === 'ai-fitting-reference'
    ? '/fitting'
    : feature.id === 'fabric-image'
      ? '/lightchain/fabric-image'
      : feature.id === 'printing-image'
        ? '/lightchain/printing-image'
        : feature.route;
  const params = new URLSearchParams({ libraryArtifactId: artifactId });
  if (feature.id === 'fabric-image') params.set('librarySlot', 'fabric-design');
  if (feature.id === 'printing-image') params.set('librarySlot', 'printing-design');
  return `${pathname}?${params.toString()}`;
};

export function LightchainLibraryPage() {
  const { currentBrand, user } = useAuthStore();
  const navigate = useNavigate();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [activeGroup, setActiveGroup] = useState<string>('マイライブラリー');
  const [filter, setFilter] = useState<'画像' | 'お気に入り'>('画像');
  const [query, setQuery] = useState('');
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([]);
  const [remoteAssets, setRemoteAssets] = useState<RemoteLibraryAsset[]>([]);
  const [customGroups, setCustomGroups] = useState<string[]>([]);
  const [groupsHydrated, setGroupsHydrated] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState('ai-fitting');

  const groupsKey = currentBrand?.id ? groupStorageKey(currentBrand.id, user?.id) : null;
  const allGroups = useMemo(
    () => [...DEFAULT_LIBRARY_GROUPS, ...customGroups.filter((group) => !DEFAULT_LIBRARY_GROUPS.includes(group as typeof DEFAULT_LIBRARY_GROUPS[number]))],
    [customGroups],
  );

  useEffect(() => {
    if (!currentBrand?.id) {
      setArtifacts([]);
      return;
    }
    let cancelled = false;
    const localArtifacts = listWorkspaceArtifacts(currentBrand.id, user?.id);
    setArtifacts(localArtifacts);

    const imageReferences = localArtifacts.map((artifact) => ({
      storage_path: getWorkspaceArtifactCanonicalStoragePath(artifact.metadata) ?? artifact.imageUrl,
      image_url: artifact.imageUrl,
    }));
    void withSignedImageUrls(imageReferences)
      .then((signedArtifacts) => {
        if (cancelled) return;
        setArtifacts(localArtifacts.map((artifact, index) => ({
          ...artifact,
          imageUrl: (() => {
            const canonicalStoragePath = getWorkspaceArtifactCanonicalStoragePath(artifact.metadata);
            return signedArtifacts[index]?.image_url || (canonicalStoragePath ? '' : artifact.imageUrl);
          })(),
        })));
      })
      .catch(() => {
        // Local data URLs remain usable when remote signing is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [currentBrand?.id, user?.id]);

  useEffect(() => {
    const brandId = currentBrand?.id;
    if (!brandId) {
      setRemoteAssets([]);
      return;
    }

    let cancelled = false;
    const loadRemoteAssets = async () => {
      const { data, error } = await supabase
        .from('generated_images')
        .select('*')
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error || !data) {
        if (!cancelled) setRemoteAssets([]);
        return;
      }

      // A failed signing pass must not re-expose an expired bearer URL.
      const signedImages = await withSignedImageUrls(data).catch(() => []);
      const nextAssets = signedImages
        .map(remoteAssetFromImage)
        .filter((asset): asset is RemoteLibraryAsset => Boolean(asset));
      if (!cancelled) setRemoteAssets(nextAssets);
    };

    void loadRemoteAssets();
    return () => {
      cancelled = true;
    };
  }, [currentBrand?.id]);

  useEffect(() => {
    setGroupsHydrated(false);
    if (!groupsKey) {
      setCustomGroups([]);
      setGroupsHydrated(true);
      return;
    }
    try {
      const parsed = JSON.parse(window.localStorage.getItem(groupsKey) || '[]');
      setCustomGroups(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : []);
    } catch {
      setCustomGroups([]);
    } finally {
      setGroupsHydrated(true);
    }
  }, [groupsKey]);

  useEffect(() => {
    if (!groupsKey || !groupsHydrated) return;
    window.localStorage.setItem(groupsKey, JSON.stringify(customGroups));
  }, [customGroups, groupsHydrated, groupsKey]);

  const importedRemoteImageIds = useMemo(
    () => new Set(
      artifacts
        .map((artifact) => artifact.metadata.remoteImageId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
    [artifacts],
  );

  const libraryCards = useMemo<LibraryCard[]>(
    () => [
      ...artifacts.map((artifact) => ({ kind: 'local' as const, artifact })),
      ...remoteAssets
        .filter((asset) => !importedRemoteImageIds.has(asset.remoteImageId))
        .map((asset) => ({ kind: 'remote' as const, asset })),
    ],
    [artifacts, importedRemoteImageIds, remoteAssets],
  );

  const selectedAsset = libraryCards.find((card) => (
    card.kind === 'local' ? card.artifact.id === selectedAssetId : card.asset.id === selectedAssetId
  )) ?? null;

  const visibleArtifacts = useMemo(() => {
    const groupFiltered = libraryCards.filter((card) => {
      if (card.kind === 'remote') {
        if (customGroups.includes(activeGroup)) return false;
        if (activeGroup === '履歴アップロード') return false;
        if (activeGroup === 'ウェアデザインラボ生成結果') return /wear|design|detail/i.test(card.asset.featureType);
        return activeGroup === '生成履歴' || activeGroup === 'マイライブラリー' || DEFAULT_LIBRARY_GROUPS.includes(activeGroup as typeof DEFAULT_LIBRARY_GROUPS[number]);
      }
      const artifact = card.artifact;
      if (customGroups.includes(activeGroup)) return artifactGroup(artifact) === activeGroup;
      if (activeGroup === '履歴アップロード') return artifactSource(artifact) === 'upload';
      if (activeGroup === '生成履歴') return artifactSource(artifact) !== 'upload';
      if (activeGroup === 'ウェアデザインラボ生成結果') return /wear|design|detail/i.test(artifact.featureType);
      return true;
    });
    const normalizedQuery = query.trim().toLowerCase();
    return groupFiltered.filter((card) => (
      (!normalizedQuery || `${cardTitle(card)} ${cardFeatureType(card)} ${cardPrompt(card) || ''}`.toLowerCase().includes(normalizedQuery))
      && (filter !== 'お気に入り' || (card.kind === 'remote'
        ? card.asset.isFavorite
        : card.artifact.metadata.favorite === true || card.artifact.metadata.isFavorite === true))
    ));
  }, [activeGroup, customGroups, filter, libraryCards, query]);

  const handleImportRemote = async (
    asset: RemoteLibraryAsset,
    destination: LibraryFeatureDestination = 'none',
  ) => {
    if (!currentBrand?.id || !asset.imageUrl) return;
    setUploading(true);
    try {
      const result = await saveWorkspaceArtifactBestEffort({
        brandId: currentBrand.id,
        scopeId: user?.id,
        featureType: asset.featureType || 'lightchain-library-generated',
        title: asset.title,
        imageUrl: asset.imageUrl,
        prompt: asset.prompt,
        createdAt: asset.createdAt,
        metadata: {
          librarySource: 'generation',
          libraryGroup: '生成履歴',
          remoteImageId: asset.remoteImageId,
          sourceImageId: asset.remoteImageId,
          sourceStoragePath: asset.storagePath,
        },
      });
      if (!result.localPersisted) {
        toast.error('生成結果のライブラリー登録確認に失敗しました');
        return;
      }
      setArtifacts((current) => [result.artifact, ...current.filter((artifact) => artifact.id !== result.artifact.id)]);
      setActiveGroup('生成履歴');
      setSelectedAssetId(result.artifact.id);
      toast.success(result.remote ? '生成結果をライブラリーに登録しました' : '生成結果をローカルライブラリーに登録しました');
      if (destination !== 'none') {
        const destinationPath = typeof destination === 'object'
          ? (() => {
            const feature = lightchainUnifiedFeatureCatalog.find((item) => item.id === destination.featureId);
            return feature ? buildLibraryFeatureHref(feature, result.artifact.id) : null;
          })()
          : destination === 'fitting'
            ? `/fitting?libraryArtifactId=${encodeURIComponent(result.artifact.id)}`
            : destination === 'fabric'
              ? `/tools/fabric?libraryArtifactId=${encodeURIComponent(result.artifact.id)}&librarySlot=fabric-design`
              : `/tools/printing?libraryArtifactId=${encodeURIComponent(result.artifact.id)}&librarySlot=printing-design`;
        if (destinationPath) navigate(destinationPath);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成結果の登録に失敗しました');
    } finally {
      setUploading(false);
    }
  };

  const selectedFeature = lightchainUnifiedFeatureCatalog.find((feature) => feature.id === selectedFeatureId)
    ?? lightchainUnifiedFeatureCatalog[0];

  const handleOpenSelectedFeature = async () => {
    if (!selectedAsset || !selectedFeature) return;
    if (selectedAsset.kind === 'remote') {
      await handleImportRemote(selectedAsset.asset, { kind: 'feature', featureId: selectedFeature.id });
      return;
    }
    navigate(buildLibraryFeatureHref(selectedFeature, selectedAsset.artifact.id));
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!currentBrand?.id) {
      toast.error('ブランドが選択されていないため、素材を保存できません');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('画像ファイルを選択してください');
      return;
    }
    if (file.size > MAX_LIBRARY_UPLOAD_BYTES) {
      toast.error('アップロード画像は10MB以下にしてください');
      return;
    }

    setUploading(true);
    try {
      const imageUrl = await readFileAsDataUrl(file);
      const result = await saveWorkspaceArtifactBestEffort({
        brandId: currentBrand.id,
        scopeId: user?.id,
        featureType: 'lightchain-library-upload',
        title: file.name.replace(/\.[^.]+$/u, '') || 'アップロード素材',
        imageUrl,
        prompt: null,
        metadata: {
          librarySource: 'upload',
          libraryGroup: customGroups.includes(activeGroup) ? activeGroup : 'マイライブラリー',
          originalFileName: file.name,
          mimeType: file.type,
        },
      });
      if (!result.localPersisted) {
        toast.error('素材の保存確認に失敗しました');
        return;
      }
      setArtifacts((current) => [result.artifact, ...current.filter((artifact) => artifact.id !== result.artifact.id)]);
      setActiveGroup(customGroups.includes(activeGroup) ? activeGroup : 'マイライブラリー');
      setSelectedAssetId(result.artifact.id);
      toast.success(result.remote ? '素材をライブラリーに保存しました' : '素材をローカルライブラリーに保存しました');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '素材のアップロードに失敗しました');
    } finally {
      setUploading(false);
    }
  };

  const handleCreateGroup = () => {
    const group = newGroupName.trim();
    if (!group) return;
    if (allGroups.includes(group)) {
      setActiveGroup(group);
      setNewGroupName('');
      setNewGroupOpen(false);
      return;
    }
    setCustomGroups((current) => [...current, group]);
    setActiveGroup(group);
    setNewGroupName('');
    setNewGroupOpen(false);
    toast.success(`「${group}」を作成しました`);
  };

  return (
    <div className="min-h-[calc(100vh-70px)] bg-[#050708] text-white">
      <div className="mx-auto flex max-w-[1480px] gap-6 px-5 py-8 sm:px-8 lg:px-10">
        <aside className={`${darkPanel} hidden w-64 shrink-0 p-3 lg:block`}>
          <div className="px-3 py-3 text-xs font-semibold tracking-[0.2em] text-neutral-400">LIBRARY</div>
          {allGroups.map((group) => (
            <button key={group} type="button" onClick={() => { setActiveGroup(group); setSelectedAssetId(null); }} className={`flex w-full items-center rounded-xl px-3 py-3 text-left text-sm transition ${activeGroup === group ? 'bg-white text-neutral-950' : 'text-neutral-400 hover:bg-white/[0.06] hover:text-white'}`}>
              <FolderOpen className="mr-2 h-4 w-4" />{group}
            </button>
          ))}
        </aside>

        <main className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.25em] text-cyan-200">LIGHTCHAIN AI / LIBRARY</p>
              <h1 className="mt-3 text-3xl font-semibold">{activeGroup}</h1>
              <p className="mt-2 text-sm text-neutral-500">生成済みの成果物とアップロード素材を、次のCanvas作業へ同じ系譜で引き継げます。</p>
            </div>
            <div className="flex gap-2">
              <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
              <button type="button" className={mutedButton} onClick={() => uploadInputRef.current?.click()} disabled={uploading}>
                <Upload className="mr-2 inline h-4 w-4" />{uploading ? 'アップロード中…' : 'アップロード'}
              </button>
              <button type="button" className={mutedButton} onClick={() => setNewGroupOpen(true)}>
                <Plus className="mr-2 inline h-4 w-4" />新規グループ作成
              </button>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex gap-2">
              {(['画像', 'お気に入り'] as const).map((value) => (
                <button key={value} type="button" className={`rounded-lg px-3 py-2 text-sm ${filter === value ? 'bg-white text-neutral-950' : 'text-neutral-400'}`} onClick={() => setFilter(value)}>{value}</button>
              ))}
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-neutral-400">
              <Search className="h-4 w-4" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-40 bg-transparent outline-none" placeholder="検索" aria-label="ライブラリー検索" />
            </label>
          </div>

          {visibleArtifacts.length === 0 ? (
            <div className="mt-10 flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-center">
              <Grid2X2 className="h-8 w-8 text-neutral-600" />
              <h2 className="mt-4 font-semibold">まだ素材がありません</h2>
              <p className="mt-2 text-sm text-neutral-500">アップロードまたはワークベンチで保存した素材がここに表示されます。</p>
              <button type="button" className="mt-4 rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-neutral-950" onClick={() => uploadInputRef.current?.click()}>最初の素材を追加</button>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {visibleArtifacts.map((card) => (
                <article key={card.kind === 'local' ? card.artifact.id : card.asset.id} className={`overflow-hidden rounded-2xl border bg-[#151a1c] ${selectedAssetId === (card.kind === 'local' ? card.artifact.id : card.asset.id) ? 'border-cyan-200 ring-1 ring-cyan-200/50' : 'border-white/10'}`}>
                  <button type="button" className="flex h-44 w-full items-center justify-center bg-[radial-gradient(circle_at_35%_35%,rgba(103,232,249,0.22),transparent_24%),linear-gradient(135deg,#263438,#111719)]" onClick={() => setSelectedAssetId(card.kind === 'local' ? card.artifact.id : card.asset.id)} aria-label={`${cardTitle(card)}を選択`}>
                    {cardImageUrl(card) ? <img src={cardImageUrl(card)} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageIcon className="h-10 w-10 text-cyan-100/60" />}
                  </button>
                  <div className="p-4">
                    <p className="truncate text-sm font-medium">{cardTitle(card)}</p>
                    <p className="mt-1 truncate text-xs text-neutral-500">{cardFeatureType(card)}</p>
                    <div className="mt-3 flex gap-2">
                      {card.kind === 'local' ? (
                        <button type="button" className="flex-1 rounded-lg border border-white/10 px-2 py-2 text-xs text-neutral-300 hover:text-white" onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(card.artifact.id)}`)}>ボードにコピー</button>
                      ) : (
                        <button type="button" className="flex-1 rounded-lg border border-cyan-200/30 px-2 py-2 text-xs text-cyan-100 hover:bg-cyan-200/10 disabled:opacity-40" onClick={() => void handleImportRemote(card.asset)} disabled={uploading}>ライブラリーに登録</button>
                      )}
                      <button type="button" className="rounded-lg border border-white/10 px-2 py-2 text-xs text-neutral-300 hover:text-white" onClick={() => setSelectedAssetId(card.kind === 'local' ? card.artifact.id : card.asset.id)}>詳細</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {selectedAsset && (
            <aside className="mt-6 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-5" aria-live="polite">
              <div className="flex items-center justify-between gap-4">
                <div><p className="text-xs font-semibold tracking-[0.2em] text-cyan-200">SELECTED ASSET</p><h2 className="mt-2 font-semibold">{cardTitle(selectedAsset)}</h2></div>
                <button type="button" className="text-sm text-neutral-400 hover:text-white" onClick={() => setSelectedAssetId(null)} aria-label="選択した素材を閉じる"><X className="h-4 w-4" /></button>
              </div>
              <p className="mt-3 text-sm text-neutral-400">{cardPrompt(selectedAsset) || '保存済み素材'}</p>
              {selectedAsset.kind === 'local' ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-neutral-950" onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(selectedAsset.artifact.id)}`)}>Canvasへ送る</button>
                  <button type="button" className="rounded-lg border border-cyan-200/30 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-200/10" onClick={() => navigate(`/fitting?libraryArtifactId=${encodeURIComponent(selectedAsset.artifact.id)}`)}>AIフィッティングへ</button>
                  <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/[0.06] hover:text-white" onClick={() => navigate(`/tools/fabric?libraryArtifactId=${encodeURIComponent(selectedAsset.artifact.id)}&librarySlot=fabric-design`)}>生地イメージへ</button>
                  <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/[0.06] hover:text-white" onClick={() => navigate(`/tools/printing?libraryArtifactId=${encodeURIComponent(selectedAsset.artifact.id)}&librarySlot=printing-design`)}>プリント画像へ</button>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-neutral-950 disabled:opacity-40" onClick={() => void handleImportRemote(selectedAsset.asset)} disabled={uploading}>登録してCanvasへ</button>
                  <button type="button" className="rounded-lg border border-cyan-200/30 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-200/10 disabled:opacity-40" onClick={() => void handleImportRemote(selectedAsset.asset, 'fitting')} disabled={uploading}>登録してAIフィッティングへ</button>
                  <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/[0.06] hover:text-white disabled:opacity-40" onClick={() => void handleImportRemote(selectedAsset.asset, 'fabric')} disabled={uploading}>登録して生地イメージへ</button>
                  <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/[0.06] hover:text-white disabled:opacity-40" onClick={() => void handleImportRemote(selectedAsset.asset, 'printing')} disabled={uploading}>登録してプリント画像へ</button>
                </div>
              )}
              <div className="mt-5 rounded-xl border border-white/10 bg-black/15 p-4" data-testid="library-all-feature-handoff">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-64 flex-1 text-xs font-semibold text-neutral-300">
                    この素材を使う機能
                    <select
                      value={selectedFeature.id}
                      onChange={(event) => setSelectedFeatureId(event.target.value)}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-[#0b1011] px-3 py-2 text-sm font-normal text-white outline-none focus:border-cyan-200/60"
                      aria-label="この素材を使う機能"
                    >
                      {lightchainUnifiedFeatureCatalog.map((feature) => (
                        <option key={feature.id} value={feature.id}>{feature.title}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleOpenSelectedFeature()}
                    disabled={uploading}
                    className="rounded-lg bg-cyan-200 px-4 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
                    data-testid="library-open-selected-feature"
                  >
                    {selectedAsset.kind === 'remote' ? '登録してこの機能で開く' : 'この機能で開く'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-neutral-500">動画を除く{lightchainUnifiedFeatureCatalog.length}機能から選択できます。素材の系譜を保ったままワークベンチへ引き継ぎます。</p>
              </div>
            </aside>
          )}
        </main>
      </div>

      {newGroupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" role="dialog" aria-modal="true" aria-label="新規グループ作成">
          <div className={`${darkPanel} w-full max-w-md p-6`}>
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">新規グループ作成</h2><button type="button" onClick={() => setNewGroupOpen(false)} aria-label="閉じる"><X className="h-5 w-5 text-neutral-400" /></button></div>
            <label className="mt-5 block text-sm text-neutral-300">グループ名<input autoFocus value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') handleCreateGroup(); }} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none focus:border-cyan-200/60" placeholder="例：2026AWサンプル" /></label>
            <div className="mt-5 flex justify-end gap-2"><button type="button" className={mutedButton} onClick={() => setNewGroupOpen(false)}>キャンセル</button><button type="button" className="rounded-xl bg-cyan-200 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-40" disabled={!newGroupName.trim()} onClick={handleCreateGroup}>作成</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
