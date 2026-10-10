import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Box, ChevronDown, Copy, Download, Eye, FolderOpen, FolderPlus, Grid2X2, History, Image as ImageIcon, LayoutList, MoreVertical, Palette, PanelsTopLeft, Plus, Search, SwatchBook, Trash2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  getWorkspaceArtifactCanonicalStoragePath,
  deleteWorkspaceArtifactsPersisted,
  listWorkspaceArtifacts,
  saveWorkspaceArtifactPersisted,
  saveWorkspaceArtifactBestEffort,
  type WorkspaceArtifact,
} from '../lib/localWorkspaceArtifacts';
import { assertAuthBrandFence, captureAuthBrandFence } from '../lib/authBrandSelection';
import { readWorkspaceArtifactImage } from '../lib/workspaceArtifactImageReadback';
import { withSignedImageUrls } from '../lib/storage';
import { thumbnailImageUrl } from '../lib/mediaThumbnail';
import { asGeneratedImageListRow, cloudflareDataPlane } from '../lib/cloudflareApi';
import type { GeneratedImageListRow } from '../lib/generatedImageQuery';
import {
  lightchainUnifiedFeatureCatalog,
} from '../lib/lightchainUnifiedFeatureCatalog';
import { buildLightchainLibraryFeatureHref } from '../lib/lightchainLibraryHandoff';
import { downloadValidatedImage } from '../lib/imageDownload';
import { copyLibraryCanvasReference } from '../lib/libraryCanvasClipboard';
import { createShareLink } from '../lib/imageApi';

// Fixed views of the library. Light also lists the signed-in user's own asset
// groups below these; Heavy lists the brand's folders from /v1/folders instead
// of copying another account's group names.
const SYSTEM_LIBRARY_GROUPS = ['履歴アップロード', '生成履歴', 'ウェアデザインラボ生成結果'] as const;
const WEAR_DESIGN_LAB_FEATURE_TYPE = 'lightchain-wear-design-lab';
const LIBRARY_GROUP_NAME_LIMIT = 50;
export const LIBRARY_ASSET_TYPES = [
  { id: 'general', label: '汎用' },
  { id: 'media', label: '画像 / 動画' },
  { id: 'fabric', label: '生地' },
  { id: 'color', label: '色' },
  { id: 'canvas', label: 'キャンバスプロジェクト' },
] as const;
export type LibraryAssetType = typeof LIBRARY_ASSET_TYPES[number]['id'];
type LibraryFolder = { id: string; name: string; type: LibraryAssetType };
const folderTypesKey = (brandId: string) => `heavy:library-folder-types:v1:${brandId}`;
const readFolderTypes = (brandId: string): Record<string, LibraryAssetType> => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(folderTypesKey(brandId)) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
};

/** Which library view a saved artifact belongs to. */
export const artifactLibraryView = (metadata: Record<string, unknown>) => (
  metadata.librarySource === 'upload' ? '履歴アップロード' : '生成履歴'
);

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
const cardPrompt = (card: LibraryCard) => card.kind === 'local' ? card.artifact.prompt : card.asset.prompt;
const cardIdentity = (card: LibraryCard) => card.kind === 'local' ? card.artifact.id : card.asset.remoteImageId;

const isVideoGeneratedImage = (image: GeneratedImageListRow) => (
  /video|動画/i.test(image.feature_type || '')
);

const metadataLibraryTitle = (metadata: GeneratedImageListRow['metadata']) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const title = (metadata as Record<string, unknown>).libraryTitle;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
};

const remoteAssetFromImage = (image: GeneratedImageListRow): RemoteLibraryAsset | null => {
  if (!image.image_url || isVideoGeneratedImage(image)) return null;
  return {
    kind: 'remote',
    id: `remote-library-${image.id}`,
    remoteImageId: image.id,
    title: metadataLibraryTitle(image.metadata) || image.prompt?.split('\n')[0]?.trim().slice(0, 80) || image.feature_type || '生成画像',
    featureType: image.feature_type || 'generated-image',
    imageUrl: image.image_url,
    prompt: image.prompt,
    createdAt: image.created_at,
    storagePath: image.storage_path || null,
    isFavorite: image.is_favorite,
  };
};

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string'
    ? resolve(reader.result)
    : reject(new Error('library_upload_read_failed'));
  reader.onerror = () => reject(reader.error ?? new Error('library_upload_read_failed'));
  reader.readAsDataURL(file);
});

function LibraryTypeIcon({ type }: { type: LibraryAssetType }) {
  const className = type === 'general' ? 'h-4 w-4 text-neutral-200' : 'h-4 w-4 text-emerald-400';
  if (type === 'general') return <FolderOpen className={className} aria-hidden="true" />;
  if (type === 'fabric') return <SwatchBook className={className} aria-hidden="true" />;
  if (type === 'color') return <Palette className={className} aria-hidden="true" />;
  if (type === 'canvas') return <PanelsTopLeft className={className} aria-hidden="true" />;
  return <ImageIcon className={className} aria-hidden="true" />;
}

export function LightchainLibraryPage() {
  const { currentBrand, user } = useAuthStore();
  const navigate = useNavigate();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  // /history, /gallery and /jobs redirect here with ?group=生成履歴 so old links land on the generated results.
  const [activeGroup, setActiveGroup] = useState<string>(() => {
    const group = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('group');
    return group && (SYSTEM_LIBRARY_GROUPS as readonly string[]).includes(group) ? group : '履歴アップロード';
  });
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([]);
  const [remoteAssets, setRemoteAssets] = useState<RemoteLibraryAsset[]>([]);
  const libraryScope = currentBrand?.id && user?.id ? JSON.stringify([currentBrand.id,user.id]) : null;
  const boardCopyRef = useRef<symbol | null>(null), boardScopeRef = useRef(libraryScope);
  boardScopeRef.current = libraryScope;
  useEffect(() => () => { boardCopyRef.current = null; }, [libraryScope]);
  const handleCopyToBoard = async (card: LibraryCard) => {
    if (!currentBrand?.id || !user?.id || !libraryScope || boardCopyRef.current) return;
    if (card.kind === 'local' && (card.artifact.brandId !== currentBrand.id || card.artifact.scopeId !== user.id)) return;
    const state = useAuthStore.getState(), fence = captureAuthBrandFence(state.brandState, user.id, currentBrand.id);
    const operation = Symbol('library-board-copy'); boardCopyRef.current = operation;
    const assertCurrent = () => {
      const now = useAuthStore.getState();
      assertAuthBrandFence(fence, captureAuthBrandFence(now.brandState, now.user?.id ?? null, now.currentBrand?.id ?? null), 'library_board_copy');
      if (boardCopyRef.current !== operation || boardScopeRef.current !== libraryScope) throw new Error('library_board_copy_context_changed');
    };
    try {
      await copyLibraryCanvasReference({ origin: cloudflareDataPlane?.origin ?? window.location.origin, userId: user.id, brandId: currentBrand.id },
        card.kind === 'local' ? { kind: 'artifact', id: card.artifact.id } : { kind: 'generated-image', id: card.asset.remoteImageId },
        { assertCurrent, writeText: text => navigator.clipboard.writeText(text) });
      toast.success('コピーしました。Canvasで貼り付けできます');
    } catch {
      try { assertCurrent(); toast.error('素材をコピーできませんでした'); } catch { /* A later scope owns the page. */ }
    } finally { if (boardCopyRef.current === operation) boardCopyRef.current = null; }
  };
  /** Public share links point at a saved generated image; they expire after 7 days. */
  const handleCopyShareLink = async (card: LibraryCard) => {
    const imageId = card.kind === 'remote' ? card.asset.remoteImageId
      : typeof card.artifact.metadata.remoteImageId === 'string' ? card.artifact.metadata.remoteImageId : '';
    if (!imageId) { toast.error('この素材はまだ保存されていないため共有できません'); return; }
    const result = await createShareLink(imageId, 7);
    if (!result.success || !result.shareUrl) {
      toast.error(result.error === 'external_public_sharing_disabled' ? '共有リンクは現在使えません' : '共有リンクを作成できませんでした');
      return;
    }
    try {
      await navigator.clipboard.writeText(result.shareUrl);
      toast.success('共有リンクをコピーしました（7日間有効）');
    } catch {
      toast.success(`共有リンク: ${result.shareUrl}`);
    }
  };
  const saveOperationRef = useRef<symbol | null>(null);
  useEffect(() => {
    saveOperationRef.current = null;
    setUploading(false);
    return () => { saveOperationRef.current = null; };
  }, [libraryScope]);
  const beginLibrarySave = () => {
    if (!currentBrand?.id || !user?.id || saveOperationRef.current) return null;
    const state = useAuthStore.getState();
    const captured = captureAuthBrandFence(state.brandState, user.id, currentBrand.id);
    if (!captured) return null;
    const operation = Symbol('library-save');
    saveOperationRef.current = operation;
    const assertCurrent = () => {
      const now = useAuthStore.getState();
      assertAuthBrandFence(captured, captureAuthBrandFence(now.brandState, now.user?.id ?? null, now.currentBrand?.id ?? null), 'library_save');
      if (saveOperationRef.current !== operation) throw new Error('library_save_scope_changed');
    };
    const isCurrent = () => { try { assertCurrent(); return true; } catch { return false; } };
    setUploading(true);
    return { assertCurrent, isCurrent, finish: () => {
      if (saveOperationRef.current === operation) {
        saveOperationRef.current = null;
        setUploading(false);
      }
    } };
  };
  const [localPreviews, setLocalPreviews] = useState<{scope:string | null;urls:Record<string,string>}>({scope:null,urls:{}});
  const cardImageUrl = (card: LibraryCard) => {
    if (card.kind === 'remote') return card.asset.imageUrl;
    const resolved = localPreviews.scope === libraryScope ? localPreviews.urls[card.artifact.id] : '';
    if (resolved) return resolved;
    return !getWorkspaceArtifactCanonicalStoragePath(card.artifact.metadata) && !card.artifact.metadata.localAssetRef
      && /^(?:data:image\/|blob:|\/assets\/)/i.test(card.artifact.imageUrl) ? card.artifact.imageUrl : '';
  };
  const [remoteAssetsScope, setRemoteAssetsScope] = useState<string | null>(null);
  const [remoteLoadError, setRemoteLoadError] = useState(false);
  const [remoteReload, setRemoteReload] = useState(0);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const customGroups = useMemo(() => folders.map((folder) => folder.id), [folders]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupType, setNewGroupType] = useState<LibraryAssetType | ''>('');
  const [newGroupTypeOpen, setNewGroupTypeOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const pendingFolderId = useRef<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpeg' | 'avif'>('png');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedFeatureId, setSelectedFeatureId] = useState('ai-fitting');
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ card?: LibraryCard; localIds?: string[]; label: string } | null>(null);

  const activeFolder = folders.find((folder) => folder.id === activeGroup) ?? null;
  const activeGroupLabel = activeFolder?.name ?? activeGroup;

  useEffect(() => {
    if (!currentBrand?.id || !user?.id) {
      setArtifacts([]);
      return;
    }
    let cancelled = false;
    const localArtifacts = listWorkspaceArtifacts(currentBrand.id, user?.id);
    setArtifacts(localArtifacts);

    setLocalPreviews({scope:null,urls:{}});
    const scope = {brandId:currentBrand.id,userId:user.id};
    void Promise.allSettled(localArtifacts.map(artifact => readWorkspaceArtifactImage(artifact,scope)))
      .then(results => {
        if (cancelled) return;
        const urls: Record<string,string> = {};
        results.forEach((result,index) => { if (result.status === 'fulfilled') urls[localArtifacts[index].id] = result.value.imageUrl; });
        setLocalPreviews({scope:JSON.stringify([scope.brandId,scope.userId]),urls});
      });

    return () => {
      cancelled = true;
    };
  }, [currentBrand?.id, user?.id]);

  useEffect(() => {
    const brandId = currentBrand?.id;
    setRemoteAssets([]); setRemoteAssetsScope(null); setRemoteLoadError(false);
    if (!brandId || !user?.id || !libraryScope) return;

    let cancelled = false;
    const loadRemoteAssets = async () => {
      if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
      const data = (await cloudflareDataPlane.listGeneratedImages(brandId, { limit: 100, offset: 0 })).map(asGeneratedImageListRow);
      if (cancelled) return;
      if (!data) {
        if (!cancelled) setRemoteAssets([]);
        return;
      }

      // A failed signing pass must not re-expose an expired bearer URL.
      const signedImages = await withSignedImageUrls(data);
      const nextAssets = signedImages
        .map(remoteAssetFromImage)
        .filter((asset): asset is RemoteLibraryAsset => Boolean(asset));
      if (cancelled) return;
      if (data.some(image => !isVideoGeneratedImage(image)) && nextAssets.length === 0) throw new Error('library_media_unavailable');
      setRemoteAssets(nextAssets); setRemoteAssetsScope(libraryScope);
    };

    void loadRemoteAssets().catch(() => {
      if (!cancelled) { setRemoteAssets([]); setRemoteAssetsScope(null); setRemoteLoadError(true); }
    });
    return () => {
      cancelled = true;
    };
  }, [currentBrand?.id,user?.id,libraryScope,remoteReload]);

  useEffect(() => {
    setSelectedAssetId(null); setSelectedIds(new Set()); setPendingDelete(null);
    setDetailMode(false); setRenameOpen(false); setDownloadOpen(false); setOpenMenuId(null);
  }, [libraryScope]);

  useEffect(() => {
    setFolders([]);
    const brandId = currentBrand?.id;
    if (!brandId || !cloudflareDataPlane) return;
    let cancelled = false;
    void cloudflareDataPlane.listFolders(brandId).then((rows) => {
      if (cancelled) return;
      const types = readFolderTypes(brandId);
      setFolders(rows.map((row) => ({ id: row.id, name: row.name, type: types[row.id] ?? 'media' })));
    }).catch(() => { if (!cancelled) toast.error('アセットグループを読み込めませんでした'); });
    return () => { cancelled = true; };
  }, [currentBrand?.id]);

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
      ...artifacts.filter(artifact => Boolean(libraryScope) && artifact.brandId === currentBrand?.id && artifact.scopeId === user?.id).map((artifact) => ({ kind: 'local' as const, artifact })),
      ...(remoteAssetsScope === libraryScope && libraryScope ? remoteAssets : [])
        .filter((asset) => !importedRemoteImageIds.has(asset.remoteImageId))
        .map((asset) => ({ kind: 'remote' as const, asset })),
    ],
    [artifacts, importedRemoteImageIds, remoteAssets, remoteAssetsScope, libraryScope, currentBrand?.id, user?.id],
  );

  const selectedAsset = libraryCards.find((card) => (
    card.kind === 'local' ? card.artifact.id === selectedAssetId : card.asset.id === selectedAssetId
  )) ?? null;

  // Light production's selected-asset panel exposes the copy/name/basic lifecycle
  // actions only. Keep the extended handoff implementation available to the
  // launcher/workbench flows, but do not add Heavy-only controls to this parity
  // surface until Light exposes the same contract.
  const showExtendedLibraryHandoffs = false;

  // ?image=<id> (libraryImageHref, or an old /gallery?image= link) opens that result once it is loaded.
  const deepLinkImageRef = useRef<string | null>(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('image'));
  useEffect(() => {
    const wanted = deepLinkImageRef.current;
    if (!wanted) return;
    const card = libraryCards.find((item) => item.kind === 'local'
      ? item.artifact.id === wanted || item.artifact.metadata.remoteImageId === wanted || item.artifact.metadata.imageId === wanted
      : item.asset.id === wanted || item.asset.remoteImageId === wanted);
    if (!card) return;
    deepLinkImageRef.current = null;
    setSelectedAssetId(card.kind === 'local' ? card.artifact.id : card.asset.id);
  }, [libraryCards]);

  const visibleArtifacts = useMemo(() => {
    const normalizedSearch = librarySearch.trim().toLowerCase();
    return libraryCards.filter((card) => {
      const metadata = card.kind === 'local' ? card.artifact.metadata : {};
      const inView = activeGroup === 'ウェアデザインラボ生成結果'
        ? (card.kind === 'remote' ? card.asset.featureType : card.artifact.featureType) === WEAR_DESIGN_LAB_FEATURE_TYPE
        : customGroups.includes(activeGroup)
          ? metadata.libraryGroup === activeGroup
          : (card.kind === 'remote' ? '生成履歴' : artifactLibraryView(metadata)) === activeGroup;
      const matchesSearch = !normalizedSearch || `${cardTitle(card)} ${cardPrompt(card) || ''}`.toLowerCase().includes(normalizedSearch);
      return inView && matchesSearch;
    });
  }, [activeGroup, customGroups, libraryCards, librarySearch]);

  const handleImportRemote = async (
    asset: RemoteLibraryAsset,
    destination: LibraryFeatureDestination = 'none',
  ) => {
    if (!currentBrand?.id || !asset.imageUrl) return;
    const operation = beginLibrarySave();
    if (!operation) return;
    try {
      operation.assertCurrent();
      const persistenceContext = await cloudflareDataPlane?.captureArtifactPersistenceContext({ assertContext: operation.assertCurrent });
      operation.assertCurrent();
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
      }, { persistenceContext });
      operation.assertCurrent();
      if (!result.localPersisted) {
        toast.error('生成結果のライブラリー登録確認に失敗しました');
        return;
      }
      if (cloudflareDataPlane && !result.remote) {
        toast.error('リモート保存の確認に失敗しました。再送せず、同じ保存依頼を照合してください');
        return;
      }
      setArtifacts((current) => [result.artifact, ...current.filter((artifact) => artifact.id !== result.artifact.id)]);
      setActiveGroup('生成履歴');
      setSelectedAssetId(result.artifact.id);
      toast.success('生成結果をライブラリーに登録しました');
      if (destination !== 'none') {
        const destinationPath = typeof destination === 'object'
          ? (() => {
            const feature = lightchainUnifiedFeatureCatalog.find((item) => item.id === destination.featureId);
            return feature ? buildLightchainLibraryFeatureHref(feature, result.artifact.id) : null;
          })()
          : destination === 'fitting'
            ? `/model?libraryArtifactId=${encodeURIComponent(result.artifact.id)}`
            : destination === 'fabric'
              ? `/tools/fabric?libraryArtifactId=${encodeURIComponent(result.artifact.id)}&librarySlot=fabric-design`
              : `/tools/printing?libraryArtifactId=${encodeURIComponent(result.artifact.id)}&librarySlot=printing-design`;
        if (destinationPath) navigate(destinationPath);
      }
    } catch (error) {
      if (!operation.isCurrent()) return;
      toast.error(error instanceof Error ? error.message : '生成結果の登録に失敗しました');
    } finally {
      operation.finish();
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
    navigate(buildLightchainLibraryFeatureHref(selectedFeature, selectedAsset.artifact.id));
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

    const operation = beginLibrarySave();
    if (!operation) return;
    try {
      operation.assertCurrent();
      const persistenceContext = await cloudflareDataPlane?.captureArtifactPersistenceContext({ assertContext: operation.assertCurrent });
      operation.assertCurrent();
      const imageUrl = await readFileAsDataUrl(file);
      operation.assertCurrent();
      const result = await saveWorkspaceArtifactBestEffort({
        brandId: currentBrand.id,
        scopeId: user?.id,
        featureType: 'lightchain-library-upload',
        title: file.name.replace(/\.[^.]+$/u, '') || 'アップロード素材',
        imageUrl,
        prompt: null,
        metadata: {
          librarySource: 'upload',
          libraryGroup: customGroups.includes(activeGroup) ? activeGroup : '履歴アップロード',
          originalFileName: file.name,
          mimeType: file.type,
        },
      }, { persistenceContext });
      operation.assertCurrent();
      if (!result.localPersisted) {
        toast.error('素材の保存確認に失敗しました');
        return;
      }
      if (cloudflareDataPlane && !result.remote) {
        toast.error('リモート保存の確認に失敗しました。再送せず、同じ保存依頼を照合してください');
        return;
      }
      setArtifacts((current) => [result.artifact, ...current.filter((artifact) => artifact.id !== result.artifact.id)]);
      setActiveGroup(customGroups.includes(activeGroup) ? activeGroup : '履歴アップロード');
      setSelectedAssetId(result.artifact.id);
      toast.success('素材をライブラリーに保存しました');
    } catch (error) {
      if (!operation.isCurrent()) return;
      toast.error(error instanceof Error ? error.message : '素材のアップロードに失敗しました');
    } finally {
      operation.finish();
    }
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    const brandId = currentBrand?.id;
    if (!name || !newGroupType || !brandId || !cloudflareDataPlane || creatingGroup) return;
    // One id per dialog submission: a retry after an unknown result re-sends the
    // same id, and the server answers 409 instead of creating a second group.
    const id = pendingFolderId.current ?? crypto.randomUUID();
    pendingFolderId.current = id;
    setCreatingGroup(true);
    try {
      let created: { id: string; name: string } | undefined;
      try {
        created = await cloudflareDataPlane.createFolder({ id, brand_id: brandId, name });
      } catch {
        created = (await cloudflareDataPlane.listFolders(brandId)).find((folder) => folder.id === id);
        if (!created) throw new Error('library_group_create_failed');
      }
      const types = { ...readFolderTypes(brandId), [created.id]: newGroupType };
      try { window.localStorage.setItem(folderTypesKey(brandId), JSON.stringify(types)); } catch { /* icon only */ }
      setFolders((current) => [...current.filter((folder) => folder.id !== created.id), { id: created.id, name: created.name, type: newGroupType }]);
      pendingFolderId.current = null;
      setActiveGroup(created.id);
      setSelectedAssetId(null);
      setSelectedIds(new Set());
      setNewGroupName('');
      setNewGroupType('');
      setNewGroupOpen(false);
      toast.success(`「${created.name}」を作成しました`);
    } catch {
      toast.error('アセットグループを作成できませんでした');
    } finally {
      setCreatingGroup(false);
    }
  };

  const closeNewGroup = () => {
    pendingFolderId.current = null;
    setNewGroupOpen(false);
    setNewGroupTypeOpen(false);
    setNewGroupName('');
    setNewGroupType('');
  };

  const getCardId = (card: LibraryCard) => card.kind === 'local' ? card.artifact.id : card.asset.id;

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkCopy = async () => {
    const card = visibleArtifacts.find((candidate) => selectedIds.has(getCardId(candidate)));
    if (!card) return;
    if (card.kind === 'remote') await handleImportRemote(card.asset);
    else navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(card.artifact.id)}`);
  };

  const handleBulkDownload = async () => {
    const cards = visibleArtifacts.filter((card) => selectedIds.has(getCardId(card)) && cardImageUrl(card));
    await Promise.all(cards.map((card) => downloadValidatedImage(cardImageUrl(card), `${cardTitle(card) || getCardId(card)}.png`, 'library_bulk_download')));
  };

  const handleBulkDelete = () => {
    if (!currentBrand?.id || selectedIds.size === 0) return;
    const localIds = visibleArtifacts
      .filter((card): card is Extract<LibraryCard, { kind: 'local' }> => card.kind === 'local' && selectedIds.has(getCardId(card)))
      .map((card) => card.artifact.id);
    if (localIds.length === 0) return;
    setPendingDelete({ localIds, label: `${localIds.length}件の素材` });
  };

  const handleRenameSelected = async () => {
    if (!selectedAsset) return;
    const title = renameValue.trim();
    if (!title) return;
    if (selectedAsset.kind === 'remote') {
      const operation = beginLibrarySave();
      if (!operation) return;
      try {
        if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
        const persistenceContext = await cloudflareDataPlane.captureArtifactPersistenceContext({ assertContext: operation.assertCurrent });
        operation.assertCurrent();
        await cloudflareDataPlane.updateGeneratedImageLibraryTitle(selectedAsset.asset.remoteImageId, title, persistenceContext);
        operation.assertCurrent();
        setRemoteAssets((current) => current.map((asset) => asset.id === selectedAsset.asset.id ? { ...asset, title } : asset));
        setRenameOpen(false);
        setSelectedAssetId(selectedAsset.asset.id);
        toast.success('名前を保存しました');
      } catch {
        if (operation.isCurrent()) toast.error('名前の保存に失敗しました');
      } finally { operation.finish(); }
      return;
    }
    if (!currentBrand?.id) return;
    const result = saveWorkspaceArtifactPersisted({
      ...selectedAsset.artifact,
      title,
    });
    if (!result.ok) {
      toast.error('名前の保存確認に失敗しました');
      return;
    }
    setArtifacts(listWorkspaceArtifacts(currentBrand.id, user?.id));
    setRenameOpen(false);
    setSelectedAssetId(result.artifact.id);
    toast.success('名前を保存しました');
  };

  const handleCopySelected = async () => {
    if (!selectedAsset || !currentBrand?.id) return;
    if (selectedAsset.kind === 'remote') {
      await handleImportRemote(selectedAsset.asset);
      return;
    }

    const source = selectedAsset.artifact;
    const result = saveWorkspaceArtifactPersisted({
      brandId: source.brandId,
      scopeId: source.scopeId,
      featureType: source.featureType,
      title: `${source.title} (コピー)`,
      imageUrl: source.imageUrl,
      prompt: source.prompt,
      metadata: {
        ...source.metadata,
        librarySource: 'library-copy',
        copiedFromArtifactId: source.id,
      },
      canvasProjectId: source.canvasProjectId,
      sourceJobId: source.sourceJobId,
    });
    if (!result.ok) {
      toast.error('コピーの保存確認に失敗しました');
      return;
    }
    const nextArtifacts = listWorkspaceArtifacts(currentBrand.id, user?.id);
    setArtifacts(nextArtifacts);
    setSelectedAssetId(result.artifact.id);
    toast.success('コピーを作成しました');
  };

  const handleDownloadSelected = () => {
    if (!selectedAsset) return;
    const imageUrl = cardImageUrl(selectedAsset);
    if (!imageUrl) {
      toast.error('ダウンロード可能な画像がありません');
      return;
    }
    setDownloadFormat('png');
    setDownloadOpen(true);
  };

  const handleConfirmDownloadSelected = async () => {
    if (!selectedAsset) return;
    const imageUrl = cardImageUrl(selectedAsset);
    if (!imageUrl) return;
    const extension = downloadFormat === 'jpeg' ? 'jpg' : downloadFormat;
    try {
      await downloadValidatedImage(imageUrl, `${cardTitle(selectedAsset) || getCardId(selectedAsset)}.${extension}`, 'library_single_download', downloadFormat);
      setDownloadOpen(false);
    } catch {
      toast.error('ダウンロードに失敗しました');
    }
  };

  const handleDeleteSelected = async () => {
    if (!selectedAsset) return;
    setPendingDelete({ card: selectedAsset, label: `「${cardTitle(selectedAsset)}」` });
  };

  const handleDeleteCard = async (card: LibraryCard) => {
    if (card.kind === 'remote') {
      const operation = beginLibrarySave();
      if (!operation) return;
      try {
        if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
        const persistenceContext = await cloudflareDataPlane.captureArtifactPersistenceContext({ assertContext: operation.assertCurrent });
        operation.assertCurrent();
        await cloudflareDataPlane.deleteGeneratedImage(card.asset.remoteImageId, persistenceContext);
        operation.assertCurrent();
        setRemoteAssets((current) => current.filter((asset) => asset.id !== card.asset.id));
        setSelectedAssetId(null);
        toast.success('画像を削除しました');
      } catch {
        if (operation.isCurrent()) toast.error('削除に失敗しました');
      } finally { operation.finish(); }
      return;
    }

    if (!currentBrand?.id) return;
    const result = deleteWorkspaceArtifactsPersisted(currentBrand.id, [card.artifact.id], user?.id);
    if (!result.ok) {
      toast.error('ローカル成果物を削除できませんでした');
      return;
    }
    setArtifacts(listWorkspaceArtifacts(currentBrand.id, user?.id));
    setSelectedAssetId(null);
    setDetailMode(false);
    toast.success('ローカル成果物を削除しました');
  };

  const confirmPendingDelete = async () => {
    if (!pendingDelete) return;
    const request = pendingDelete;
    setPendingDelete(null);
    if (request.card) {
      await handleDeleteCard(request.card);
      return;
    }
    if (!currentBrand?.id || !request.localIds?.length) return;
    const result = deleteWorkspaceArtifactsPersisted(currentBrand.id, request.localIds, user?.id);
    if (!result.ok) {
      toast.error('ローカル成果物を削除できませんでした');
      return;
    }
    setArtifacts(listWorkspaceArtifacts(currentBrand.id, user?.id));
    setSelectedIds(new Set());
    setSelectMode(false);
    setSelectedAssetId(null);
    toast.success('ローカル成果物を削除しました');
  };

  return (
    <div className="asset-center-parity min-h-[calc(100vh-70px)] bg-[#222627] text-white">
      <div className="flex min-h-[calc(100vh-70px)] w-full gap-0">
        <aside className="asset-center-sidebar hidden w-[312px] shrink-0 border-r border-white/10 bg-[#262b2c] lg:block">
          <div className="asset-center-sidebar-header flex items-center justify-between px-4 pb-2 pt-4 text-lg font-semibold text-neutral-100">
            <span>ライブラリー</span>
            <button type="button" aria-label="ライブラリーを検索" aria-expanded={librarySearchOpen} className="rounded p-0.5 text-neutral-200 hover:bg-white/10" onClick={() => setLibrarySearchOpen((current) => !current)}><Search className="h-5 w-5" /></button>
          </div>
          <div className="asset-center-library-root flex items-center justify-between border-b border-white/10 px-4 pb-4 pt-6">
            <button type="button" role="combobox" aria-expanded={false} className="flex items-center gap-2 text-sm text-neutral-100">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-b from-emerald-300 to-emerald-500"><Box className="h-3.5 w-3.5 text-emerald-950" /></span>
              <span>マイライブラリー</span>
              <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
            </button>
            <button type="button" aria-label="アセットグループを新規作成" className="rounded p-0.5 text-neutral-200 hover:bg-white/10" onClick={() => setNewGroupOpen(true)}><FolderPlus className="h-5 w-5" /></button>
          </div>
          <div className="asset-center-library-groups flex flex-col gap-4 px-4 pt-4">
          {[...SYSTEM_LIBRARY_GROUPS.map((group) => ({ id: group, name: group, type: null as LibraryAssetType | null })), ...folders].map((group) => (
            <button key={group.id} type="button" aria-current={activeGroup === group.id ? 'page' : undefined} onClick={() => { setActiveGroup(group.id); setSelectedAssetId(null); setSelectedIds(new Set()); }} className={`asset-center-library-group flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition ${activeGroup === group.id ? 'border-l-2 border-[#5ec4bd] bg-white/[0.12] text-white' : 'text-neutral-200 hover:bg-white/[0.06] hover:text-white'}`}>
              {group.type ? <LibraryTypeIcon type={group.type} /> : group.id === 'ウェアデザインラボ生成結果' ? <LibraryTypeIcon type="media" /> : <History className="h-4 w-4" />}
              <span className="truncate">{group.name}</span>
            </button>
          ))}
          </div>
        </aside>

        <main className="asset-center-main relative min-w-0 flex-1 px-4 py-4 sm:px-4">
          <nav aria-label="パンくずナビゲーション" className="asset-center-breadcrumb mb-5 flex items-center gap-2 text-xs text-neutral-500">
            <span>マイライブラリー</span>
            <span aria-hidden="true">/</span>
            <span className="text-neutral-200">{activeGroupLabel}</span>
          </nav>
          <div className="flex flex-wrap items-center justify-between gap-4 lg:hidden">
            <div>
              <p className="text-xs font-semibold tracking-[0.25em] text-cyan-200">HEAVY CHAIN / LIBRARY</p>
              <h1 className="mt-3 text-3xl font-semibold">{activeGroupLabel}</h1>
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

          <div className="asset-center-toolbar flex flex-wrap items-center justify-between gap-3">
            {librarySearchOpen && <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-neutral-400">
                <span className="sr-only">ライブラリー検索</span>
                <input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} className="w-44 bg-transparent text-white outline-none placeholder:text-neutral-500" placeholder="ライブラリー検索" aria-label="ライブラリー検索" />
              </label>
            </div>}
            {selectMode && <span className="asset-center-selection-count text-sm text-neutral-400">選択済み ： {selectedIds.size} / {visibleArtifacts.length}</span>}
            {selectMode ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={`${mutedButton} disabled:opacity-40`} disabled={selectedIds.size === 0 || uploading} onClick={() => void handleBulkCopy()}>キャンバスをコピー</button>
                <button type="button" className={`${mutedButton} disabled:opacity-40`} disabled={selectedIds.size === 0} onClick={() => void handleBulkDownload()}><Download className="mr-2 inline h-4 w-4" />ダウンロード</button>
                <button type="button" className={`${mutedButton} disabled:opacity-40`} disabled={!visibleArtifacts.some((card) => card.kind === 'local' && selectedIds.has(getCardId(card)))} onClick={handleBulkDelete}><Trash2 className="mr-2 inline h-4 w-4" />削除</button>
                <button type="button" className={mutedButton} onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}>一括操作を閉じる</button>
              </div>
          ) : (
              <div className="flex items-center gap-2">
                {activeFolder && <button type="button" className="asset-center-bulk-button" onClick={() => uploadInputRef.current?.click()} disabled={uploading}><Upload className="h-4 w-4" />{uploading ? 'アップロード中…' : 'アップロード'}</button>}
                <button type="button" className="asset-center-bulk-button" disabled={visibleArtifacts.length === 0} onClick={() => setSelectMode(true)}><LayoutList className="h-4 w-4" />一括操作</button>
              </div>
            )}
          </div>
          {remoteLoadError && libraryScope && (
            <div role="alert" className="mt-3 rounded-lg border border-amber-300/30 px-3 py-2 text-sm text-amber-100">
              保存済み素材を読み込めませんでした。
              <button type="button" className="ml-3 underline" onClick={() => setRemoteReload(value => value + 1)}>再読み込み</button>
            </div>
          )}
          {selectMode && <button type="button" className="mt-2 text-sm text-neutral-300 underline" onClick={() => setSelectedIds(new Set(visibleArtifacts.map(getCardId)))}>全選択</button>}

          {visibleArtifacts.length === 0 ? (!activeFolder ? <div className="mt-5 flex min-h-80 items-center justify-center text-sm text-neutral-500" data-testid="library-empty-view">まだ画像がありません。生成した画像やアップロードした画像がここに表示されます。</div> :
            <div className="mt-10 flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-center">
              <Grid2X2 className="h-8 w-8 text-neutral-600" />
              <h2 className="mt-4 font-semibold">まだ素材がありません</h2>
              <p className="mt-2 text-sm text-neutral-500">アップロードまたはワークベンチで保存した素材がここに表示されます。</p>
              <button type="button" className="mt-4 rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-neutral-950" onClick={() => uploadInputRef.current?.click()}>最初の素材を追加</button>
            </div>
          ) : (
            <div className="asset-center-grid mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
              {visibleArtifacts.map((card) => (
                <article key={card.kind === 'local' ? card.artifact.id : card.asset.id} className={`asset-center-card group relative overflow-hidden rounded-lg border bg-[#151a1c] ${selectedAssetId === (card.kind === 'local' ? card.artifact.id : card.asset.id) || selectedIds.has(getCardId(card)) ? 'border-cyan-200 ring-1 ring-cyan-200/50' : 'border-white/10'}`}>
                  {selectMode && <button type="button" className="w-full border-b border-white/10 px-3 py-2 text-left text-xs text-neutral-300" onClick={() => toggleSelected(getCardId(card))} aria-pressed={selectedIds.has(getCardId(card))}>{selectedIds.has(getCardId(card)) ? '✓ 選択中' : '選択'}</button>}
                  <button type="button" className="asset-center-card-media flex w-full items-center justify-center bg-[linear-gradient(45deg,#1d2324_25%,transparent_25%,transparent_75%,#1d2324_75%),linear-gradient(45deg,#1d2324_25%,transparent_25%,transparent_75%,#1d2324_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px]" onClick={() => setSelectedAssetId(card.kind === 'local' ? card.artifact.id : card.asset.id)} aria-label={`${cardTitle(card)}を選択`}>
                    {cardImageUrl(card) ? <img src={thumbnailImageUrl(cardImageUrl(card))} alt="" className="h-full w-full object-contain" loading="lazy" /> : <ImageIcon className="h-10 w-10 text-cyan-100/60" />}
                  </button>
                  <div className="asset-center-card-actions absolute left-0 top-0 z-10 flex w-full items-center justify-center gap-4 p-2 opacity-0 transition-opacity">
                    <button type="button" aria-label="プレビュー" className="asset-center-card-action" onClick={() => setSelectedAssetId(card.kind === 'local' ? card.artifact.id : card.asset.id)}><Eye className="h-4 w-4" /></button>
                    {card.kind === 'local' ? (
                      <button type="button" aria-label="ボードにコピー" className="asset-center-card-action" onClick={() => void handleCopyToBoard(card)}><Copy className="h-4 w-4" /></button>
                    ) : (
                      <button type="button" aria-label="ボードにコピー" className="asset-center-card-action" onClick={() => void handleCopyToBoard(card)} disabled={uploading}><Copy className="h-4 w-4" /></button>
                    )}
                    <div className="relative">
                      <button type="button" aria-label="詳細" aria-expanded={openMenuId === getCardId(card)} className="asset-center-card-action asset-center-card-menu" onClick={() => setOpenMenuId((current) => current === getCardId(card) ? null : getCardId(card))}><MoreVertical className="h-4 w-4" /></button>
                      {openMenuId === getCardId(card) && <div role="menu" className="absolute right-0 top-full z-30 mt-2 min-w-40 rounded-lg border border-white/10 bg-[#202627] p-1 shadow-2xl">
                          <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={() => { setOpenMenuId(null); setSelectedAssetId(getCardId(card)); setDetailMode(true); setRenameValue(cardTitle(card)); setRenameOpen(true); }}>編集する</button>
                          <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={() => { setOpenMenuId(null); void handleCopyToBoard(card); }}>キャンバスをコピー</button>
                          <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={() => { setOpenMenuId(null); void handleCopyShareLink(card); }}>共有リンクをコピー</button>
                          <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={() => { setOpenMenuId(null); setSelectedAssetId(getCardId(card)); setDownloadFormat('png'); setDownloadOpen(true); }}>ダウンロード</button>
                          <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10" onClick={() => { setOpenMenuId(null); setPendingDelete({ card, label: `「${cardTitle(card)}」` }); }}>削除</button>
                        </div>}
                    </div>
                  </div>
                  <div className="asset-center-card-footer flex items-center justify-between gap-2 px-2">
                    <p className="truncate text-sm font-medium">{cardTitle(card)}</p>
                    <span className="asset-center-card-type shrink-0 rounded-sm bg-white/[0.06] px-1 text-[10px] leading-4 text-neutral-400">画像／動画</span>
                  </div>
                </article>
              ))}
            </div>
          )}

          {selectedAsset && (
            <aside className="mt-6 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-5" aria-live="polite">
              <div className="flex items-center justify-between gap-4">
                <div><p className="text-xs font-semibold tracking-[0.2em] text-cyan-200">SELECTED ASSET</p><h2 className="mt-2 font-semibold">{cardTitle(selectedAsset)}</h2></div>
                <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-neutral-400">
                  <button type="button" className="hover:text-white" onClick={() => setSelectedAssetId(null)}>戻る</button>
                  <button type="button" className="hover:text-white" onClick={() => void handleCopySelected()}>コピーを作成します</button>
                  <button type="button" className="hover:text-white" onClick={() => void handleDownloadSelected()}>ダウンロード</button>
                  <button type="button" className="hover:text-white" onClick={() => void handleDeleteSelected()}>削除</button>
                  <button type="button" className="hover:text-white" onClick={() => { setRenameValue(cardTitle(selectedAsset)); setRenameOpen(true); }}>名前を編集</button>
                  <button type="button" className="hover:text-white" onClick={() => setSelectedAssetId(null)} aria-label="選択した素材を閉じる"><X className="h-4 w-4" /></button>
                </div>
              </div>
              {renameOpen && <div className="mt-4 flex flex-wrap gap-2"><input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="min-w-56 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-200/60" aria-label="素材名" /><button type="button" className="rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-neutral-950 disabled:opacity-40" disabled={!renameValue.trim()} onClick={handleRenameSelected}>保存</button><button type="button" className="rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300" onClick={() => setRenameOpen(false)}>キャンセル</button></div>}
              <p className="mt-3 text-sm text-neutral-400">{cardPrompt(selectedAsset) || '保存済み素材'}</p>
              <p className="mt-2 break-all font-mono text-[11px] text-neutral-500" data-testid="library-selected-asset-id">ID: {cardIdentity(selectedAsset)}</p>
              {showExtendedLibraryHandoffs ? (selectedAsset.kind === 'local' ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-neutral-950" onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(selectedAsset.artifact.id)}`)}>Canvasへ送る</button>
                  <button type="button" className="rounded-lg border border-cyan-200/30 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-200/10" onClick={() => navigate(`/model?libraryArtifactId=${encodeURIComponent(selectedAsset.artifact.id)}`)}>AIフィッティングへ</button>
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
              )) : null}
              {showExtendedLibraryHandoffs && <div className="mt-5 rounded-xl border border-white/10 bg-black/15 p-4" data-testid="library-all-feature-handoff">
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
              </div>}
            </aside>
          )}

          {detailMode && selectedAsset && (
            <section className="fixed inset-y-0 left-0 right-0 z-20 flex bg-[#222627] pt-[70px] lg:left-[312px]" aria-label="ライブラリー素材詳細">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                  <button type="button" className="rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-white/10" onClick={() => { setDetailMode(false); setRenameOpen(false); }}>← 戻る</button>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <button type="button" className={mutedButton} onClick={() => void handleCopySelected()}>コピーを作成します</button>
                    <button type="button" className={mutedButton} onClick={handleDownloadSelected}>ダウンロード</button>
                    <button type="button" className="rounded-xl border border-red-300/30 bg-red-300/10 px-4 py-2 text-sm text-red-200" onClick={() => void handleDeleteSelected()}>削除</button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center p-8">
                  {cardImageUrl(selectedAsset) ? <img src={cardImageUrl(selectedAsset)} alt={cardTitle(selectedAsset)} className="max-h-full max-w-full object-contain" /> : <ImageIcon className="h-16 w-16 text-cyan-100/60" />}
                </div>
              </div>
              <aside className="w-full max-w-md border-l border-white/10 bg-[#262b2c] p-6">
                <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">名前を編集</h2><button type="button" aria-label="閉じる" className="text-neutral-400 hover:text-white" onClick={() => { setDetailMode(false); setRenameOpen(false); }}><X className="h-5 w-5" /></button></div>
                <label className="mt-6 block text-sm text-neutral-300">名前 <span className="text-red-300">*</span><input value={renameValue || cardTitle(selectedAsset)} onChange={(event) => setRenameValue(event.target.value)} className="mt-2 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-cyan-200/60" aria-label="素材名" /></label>
                <div className="mt-5 flex justify-end gap-2"><button type="button" className={mutedButton} onClick={() => { setDetailMode(false); setRenameOpen(false); }}>キャンセル</button><button type="button" className="rounded-xl bg-cyan-200 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-40" disabled={!renameValue.trim()} onClick={() => void handleRenameSelected()}>確認</button></div>
              </aside>
            </section>
          )}
        </main>
      </div>

      {newGroupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="アセットグループを新規作成" data-testid="library-group-create-dialog">
          <div className="w-[358px] max-w-full rounded-lg border border-white/10 bg-[#262b2c] p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-white">アセットグループを新規作成</h2>
            <div className="relative mt-8">
              <button type="button" role="combobox" aria-expanded={newGroupTypeOpen} aria-label="アセットタイプ" className={`flex h-12 w-full items-center justify-between rounded-lg border px-3 text-sm ${newGroupTypeOpen ? 'border-[#5ec4bd]' : 'border-white/20'} ${newGroupType ? 'text-white' : 'text-neutral-400'}`} onClick={() => setNewGroupTypeOpen((open) => !open)}>
                <span className="flex items-center gap-2">{newGroupType && <LibraryTypeIcon type={newGroupType} />}{LIBRARY_ASSET_TYPES.find((type) => type.id === newGroupType)?.label ?? 'アセットタイプ'}</span>
                <ChevronDown className={`h-4 w-4 transition ${newGroupTypeOpen ? 'rotate-180' : ''}`} />
              </button>
              {newGroupTypeOpen && <div role="listbox" className="absolute left-0 top-full z-10 mt-1 w-full rounded-lg border border-white/10 bg-[#262b2c] p-1 shadow-2xl">
                {LIBRARY_ASSET_TYPES.map((type) => (
                  <button key={type.id} type="button" role="option" aria-selected={newGroupType === type.id} className={`flex h-8 w-full items-center gap-2 rounded px-3 text-left text-sm text-neutral-100 hover:bg-white/10 ${newGroupType === type.id ? 'bg-white/10' : ''}`} onClick={() => { setNewGroupType(type.id); setNewGroupTypeOpen(false); }}>
                    <LibraryTypeIcon type={type.id} />{type.label}
                  </button>
                ))}
              </div>}
            </div>
            <input value={newGroupName} maxLength={LIBRARY_GROUP_NAME_LIMIT} onChange={(event) => setNewGroupName(event.target.value.slice(0, LIBRARY_GROUP_NAME_LIMIT))} onKeyDown={(event) => { if (event.key === 'Enter') void handleCreateGroup(); }} className="mt-6 h-12 w-full rounded-lg border border-white/20 bg-transparent px-3 text-sm text-white outline-none placeholder:text-neutral-400 focus:border-[#5ec4bd]" placeholder="グループ名" aria-label="グループ名" />
            <p className="mt-1 text-right text-xs text-neutral-400">{newGroupName.length}/{LIBRARY_GROUP_NAME_LIMIT}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="h-8 rounded-md border border-white/20 px-4 text-sm text-white hover:bg-white/10" onClick={closeNewGroup}>キャンセル</button>
              <button type="button" className="h-8 rounded-md bg-[#5ec4bd] px-4 text-sm font-semibold text-neutral-950 disabled:opacity-40" disabled={!newGroupName.trim() || !newGroupType || creatingGroup} onClick={() => void handleCreateGroup()}>確認</button>
            </div>
          </div>
        </div>
      )}

      {downloadOpen && selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" role="dialog" aria-modal="true" aria-label="ダウンロード">
          <div className={`${darkPanel} w-full max-w-md p-6`}>
            <h2 className="text-lg font-semibold">ダウンロード</h2>
            <p className="mt-2 text-sm text-neutral-400">保存形式を選択してください。</p>
            <div className="mt-5 flex gap-3">
              {(['png', 'jpeg', 'avif'] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  className={`rounded-lg border px-4 py-2 text-sm ${downloadFormat === format ? 'border-cyan-200 bg-cyan-200 text-neutral-950' : 'border-white/10 text-neutral-300'}`}
                  onClick={() => setDownloadFormat(format)}
                >
                  {format === 'jpeg' ? 'JPG' : format.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={mutedButton} onClick={() => setDownloadOpen(false)}>キャンセル</button>
              <button type="button" className="rounded-xl bg-cyan-200 px-4 py-2 text-sm font-semibold text-neutral-950" onClick={() => void handleConfirmDownloadSelected()}>ダウンロードを確認</button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-5" role="dialog" aria-modal="true" aria-labelledby="library-delete-title">
          <div className={`${darkPanel} w-full max-w-md p-6`}>
            <h2 id="library-delete-title" className="text-lg font-semibold">削除確認</h2>
            <p className="mt-3 text-sm text-neutral-300">{pendingDelete.label}を削除しますか？</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={mutedButton} onClick={() => setPendingDelete(null)}>キャンセル</button>
              <button type="button" className="rounded-xl bg-red-300 px-4 py-2 text-sm font-semibold text-neutral-950" onClick={() => void confirmPendingDelete()}>削除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
