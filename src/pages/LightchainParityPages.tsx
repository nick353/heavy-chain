import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useCanonicalImageWorkspace } from '../hooks/useCanonicalImageWorkspace';
import { useHeavyWorkspaceBrandGate } from '../hooks/useHeavyWorkspaceBrandGate';
import { CanonicalImageWorkspaceControls } from '../components/CanonicalImageWorkspaceControls';
import { createEntryDraftStore } from '../features/designDetail/entryDraftStore';
import { listDesignConversationProjects, type DesignProjectListClient, type DesignConversationProject } from '../features/designDetail/designProjectList';
import { DIALOGUE_WORKSPACES, type DialogueWorkspaceId } from '../features/designDetail/designEntryCoordinator';
import { useDialogueReferences } from '../features/designDetail/useDialogueReferences';
import { getCanvasDocument, updateCanvasDocument } from '../lib/canvasDocumentPersistence';
import { createDesignEntryCoordinator, type DesignEntryClient } from '../features/designDetail/designEntryCoordinator';
import { DesignCreationCard } from '../components/design/DesignCreationCard';
import {
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Megaphone,
  MessageCircle,
  MoreVertical,
  Palette,
  FileText,
  Plus,
  Radio,
  RotateCw,
  Search,
  Shirt,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react';
import { buildGenerationIntentHref, workspaceSourceConfig } from '../lib/workspaceHandoff';
import { deleteWorkspaceArtifactsPersisted, listWorkspaceArtifacts, saveWorkspaceArtifactBestEffort, type WorkspaceArtifact } from '../lib/localWorkspaceArtifacts';
import { DesignArtifactThumbnail, DESIGN_PROJECT_DEFAULT_COVER } from '../components/DesignArtifactThumbnail';
import { formatProjectAge, ProjectThumbnail, useFeatureProjects } from './PatternProjectDashboardPage';
import { downloadValidatedImage } from '../lib/imageDownload';
import { persistPrintInputState, restorePrintInputState, updatePrintInputCoverage } from '../lib/printInputPersistence';
import { PrintDraftSafetyControls } from '../components/PrintDraftSafetyControls';
import { LIGHTCHAIN_SVG_CONVERT_TABS, LIGHTCHAIN_VECTOR_TOOL_TABS, LightchainDesignToolEmptyState, LightchainDesignToolFrame } from '../components/lightchain/LightchainDesignToolFrame';
import { SvgExportPanel } from '../components/lightchain/SvgExportPanel';
import { asGeneratedImageListRow, cloudflareDataPlane } from '../lib/cloudflareApi';
import { withSignedImageUrls } from '../lib/storage';
import type { Json } from '../types/database';
import { useAuthStore } from '../stores/authStore';
import { captureAuthBrandFence, assertAuthBrandFence } from '../lib/authBrandSelection';
import { normalizeCloudflareGeneratedImageStoragePath } from '../lib/storagePathSafety';
import {
  getLightchainUnifiedFeatureWorkflowContract,
  UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION,
} from '../features/lightchain/unifiedFeatureWorkflowContract';
import { isHeavyWorkspaceRuntime } from '../lib/heavyWorkspace';
import {
  createDesignDialogueReferenceController,
  createSameOriginDesignSceneAssetLoader,
  type DesignDialogueReferenceClient,
  type DesignDialogueReferenceFile,
  type DesignDialogueReferenceState,
} from '../lib/designDialogueReferences';
import {
  createDesignArtifactScopeKey,
  DESIGN_PROJECT_PAGE_SIZE,
  designEntryHref,
  designHistoryFeatureTypes,
  isCurrentDesignArtifactLoad,
  isCurrentDesignArtifactScope,
  mergeDesignProjectGridItems,
  paginate,
  toDesignEntries,
  type DesignProjectEntry,
} from '../lib/designProjectArtifacts';
import {
  entriesForDesignProjectLoad,
  runDesignProjectArtifactLoad,
  type DesignProjectArtifactLoadState,
} from '../lib/designProjectLoader';

const darkPanel = 'rounded-2xl border border-white/10 bg-[#151a1c]';
const mutedButton = 'rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-neutral-300 transition hover:border-cyan-200/50 hover:bg-white/[0.08] hover:text-white';

function ParityPermissionGate({ testId, marginClass = '' }: { testId: string; marginClass?: string }) {
  return <button type="button" disabled aria-label="この機能は未実装です" data-testid={testId} className={`${marginClass} h-10 w-full rounded-lg bg-[#434a4c] px-4 py-0 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40`}>この機能は未実装です</button>;
}

const fittingHistoryFeatureTypes = new Set(['model-matrix', 'model-matrix-local-preview']);

const formatArtifactDate = (createdAt: string) => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '日時未確認';
  const daysSinceEdit = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (daysSinceEdit === 0) return '今日 修正';
  if (daysSinceEdit < 30) return `${daysSinceEdit}日前 修正`;
  return `${Math.max(1, Math.floor(daysSinceEdit / 30))}ヶ月前 修正`;
};

const designProjectPinsStorageKey = (userId: string, brandId: string) => (
  `heavy-design-production-pins:v2:${encodeURIComponent(JSON.stringify([userId, brandId]))}`
);

export function DesignRecentProjectEntryCard({
  entry,
  userId,
  brandId,
  heavyRuntime,
  pinned,
  menuOpen,
  onOpen,
  onToggleMenu,
  onTogglePin,
  onSaveToLibrary,
  onDelete,
}: {
  entry: DesignProjectEntry;
  userId?: string;
  brandId?: string;
  heavyRuntime: boolean;
  pinned: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onToggleMenu: () => void;
  onTogglePin: () => void;
  onSaveToLibrary: () => void;
  onDelete: () => void;
}) {
  const { artifact } = entry;
  const href = designEntryHref(entry);
  return (
    <article key={artifact.id} data-design-project-origin={entry.origin} className="relative h-60 overflow-visible rounded-2xl border border-white/10 bg-white/5 text-left hover:border-white/40">
      <DesignArtifactThumbnail artifact={artifact} userId={userId} brandId={brandId} href={href} onOpen={onOpen} />
      <button
        type="button"
        disabled={!href}
        title={!href ? 'Canvasで開くためのリモート画像IDがありません' : undefined}
        className="block h-[96px] w-full cursor-pointer overflow-hidden rounded-b-2xl p-4 pr-12 text-left disabled:cursor-not-allowed"
        aria-label={`${artifact.title}をCanvasで開く`}
        data-design-card-title=""
        onClick={onOpen}
      >
        <p data-design-card-name="" className="truncate font-medium">{pinned ? '📌 ' : ''}{artifact.title}</p>
        <p data-design-card-date="" className="mt-2 truncate text-xs text-neutral-400">{heavyRuntime ? formatArtifactDate(artifact.createdAt) : `${artifact.featureType} ・ ${formatArtifactDate(artifact.createdAt)}`}</p>
      </button>
      <div className="absolute right-2 top-2 z-20" data-design-card-menu="">
        <button type="button" aria-label={`${artifact.title}のメニュー`} aria-expanded={menuOpen} className="rounded-lg bg-black/45 p-2 text-neutral-200 hover:bg-black/70" onClick={(event) => { event.stopPropagation(); onToggleMenu(); }}><MoreVertical className="h-4 w-4" /></button>
        {menuOpen && <div role="menu" className="absolute right-0 top-full z-30 mt-2 min-w-48 rounded-lg border border-white/10 bg-[#202627] p-1 shadow-2xl">
          <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={onTogglePin}>ピン留め</button>
          <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={onSaveToLibrary}>アセットライブラリに保存</button>
          <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-red-300 hover:bg-white/10" onClick={onDelete}>削除</button>
        </div>}
      </div>
    </article>
  );
}

function PersistedHistoryPanel({
  artifacts,
  emptyMessage,
  reuseLabel,
  onReuse,
}: {
  artifacts: WorkspaceArtifact[];
  emptyMessage: string;
  reuseLabel: string;
  onReuse: (artifact: WorkspaceArtifact) => void;
}) {
  if (artifacts.length === 0) {
    return <p className="mt-3 text-sm text-neutral-500">{emptyMessage}</p>;
  }

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {artifacts.slice(0, 8).map((artifact) => (
        <article key={artifact.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-start gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white/[0.06]">
              {artifact.imageUrl ? (
                <img src={artifact.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <ImageIcon className="m-5 h-6 w-6 text-neutral-500" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{artifact.title}</p>
              <p className="mt-1 truncate text-xs text-neutral-500">{artifact.featureType}</p>
              <p className="mt-1 text-xs text-neutral-500">{formatArtifactDate(artifact.createdAt)}</p>
            </div>
          </div>
          <button
            type="button"
            className="mt-3 w-full rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-neutral-300 transition hover:border-cyan-200/50 hover:text-white"
            onClick={() => onReuse(artifact)}
            data-testid={`persisted-history-reuse-${artifact.id}`}
          >
            {reuseLabel}
          </button>
        </article>
      ))}
    </div>
  );
}

function ParityShell({
  children,
  className = '',
  workflowFeature,
}: {
  children: ReactNode;
  className?: string;
  workflowFeature?: string;
}) {
  const workflowContract = workflowFeature
    ? getLightchainUnifiedFeatureWorkflowContract(workflowFeature)
    : null;

  return (
    <div
      className={`min-h-[calc(100vh-70px)] bg-[#050708] text-white ${className}`}
      data-testid="lightchain-parity-shell"
      data-lightchain-parity-shell={workflowFeature ?? 'support'}
      data-workflow-contract={workflowContract ? UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION : undefined}
      data-workflow-feature={workflowContract?.rowId ?? undefined}
      data-workflow-input-roles={workflowContract?.inputRoles.join(',') ?? undefined}
      data-workflow-result-destinations={workflowContract?.resultDestinations.join(',') ?? undefined}
      data-workflow-lifecycle={workflowContract?.lifecycle.join(',') ?? undefined}
      data-workflow-source-input-mode={workflowContract?.sourceInputMode ?? undefined}
      data-workflow-retry-policy={workflowContract?.retry.retainsLastCompletedResult && workflowContract.retry.preservesInputLineage && workflowContract.retry.blocksDuplicateSubmit ? 'retains-last-completed-result,preserves-input-lineage,blocks-duplicate-submit' : undefined}
      data-workflow-rights-gate={workflowContract?.rightsGate ?? undefined}
    >
      {children}
    </div>
  );
}

function SegmentedTabs({
  items,
  active,
  onChange,
}: {
  items: readonly string[];
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.04] p-1" role="tablist">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          role="tab"
          aria-selected={active === item}
          onClick={() => onChange(item)}
          className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${active === item ? 'bg-white text-neutral-950' : 'text-neutral-400 hover:text-white'}`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

type CreatorCategoryGroup = { label: string; items: readonly string[] };

const creatorCategoryGroups: readonly CreatorCategoryGroup[] = [
  { label: 'トップス', items: ['ニット', 'ルームウェア', 'Tシャツ', 'パーカー', 'シャツ', 'タンクトップ', 'ベスト', 'スーツ', 'ブルゾン', 'トレンチコート', 'オーバーコート', 'ダウン', '下着', 'スイムウェア'] },
  { label: 'ボトムス', items: ['ルームウェア', 'ニットボトムス', 'ハーフスカート', 'パンツ'] },
  { label: 'ワンピース/セットアップ', items: ['ルームウェア', 'ウールワンピース', 'ワンピース', 'つなぎ'] },
] as const;

const creatorCategoryTabs = ['レディース', 'メンズ', '女の子', '男の子'] as const;

const creatorCategoryGroupsByTab: Record<(typeof creatorCategoryTabs)[number], readonly CreatorCategoryGroup[]> = {
  レディース: creatorCategoryGroups,
  女の子: creatorCategoryGroups,
  メンズ: [
    { label: 'トップス', items: ['ニット', 'ルームウェア', 'Tシャツ', 'パーカー', 'シャツ', 'タンクトップ', 'ベスト', 'スーツ', 'ブルゾン', 'トレンチコート', 'オーバーコート', 'ダウン'] },
    { label: 'ボトムス', items: ['ルームウェア', 'スイムウェア', 'パンツ'] },
    { label: 'ワンピース/セットアップ', items: ['つなぎ'] },
  ],
  男の子: [
    { label: 'トップス', items: ['ニット', 'ルームウェア', 'Tシャツ', 'パーカー', 'シャツ', 'タンクトップ', 'ベスト', 'スーツ', 'ブルゾン', 'トレンチコート', 'オーバーコート', 'ダウン'] },
    { label: 'ボトムス', items: ['ルームウェア', 'スイムウェア', 'パンツ'] },
    { label: 'ワンピース/セットアップ', items: ['つなぎ'] },
  ],
};

function CreatorCategoryPicker({ selectedCategory, onSelect }: { selectedCategory: string; onSelect: (category: string) => void }) {
  const [activeTab, setActiveTab] = useState<(typeof creatorCategoryTabs)[number]>('レディース');
  const [query, setQuery] = useState('');
  const visibleGroups = creatorCategoryGroupsByTab[activeTab]
    .map((group) => ({ ...group, items: group.items.filter((item) => !query.trim() || item.includes(query.trim())) }))
    .filter((group) => group.items.length > 0);

  return (
    <section className="flex min-h-full flex-col rounded-xl border border-cyan-300/70 bg-[#252a2d] p-4" data-testid="creator-category-picker">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-xs text-neutral-300">
          <Sparkles className="h-4 w-4 text-cyan-300" />
          <span>カテゴリを選択してください</span>
        </div>
        <div className="flex items-center gap-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-44 border-b border-white/20 bg-transparent px-2 py-2 text-xs text-neutral-200 outline-none placeholder:text-neutral-500" placeholder="カテゴリー名を入力..." aria-label="カテゴリー名を入力" />
          <button type="button" className="rounded-lg border border-white/10 bg-white/[0.05] p-2 text-neutral-300" aria-label="カテゴリーを検索"><Search className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="mt-5 flex gap-7 border-b border-white/10 text-xs text-neutral-400" role="tablist" aria-label="カテゴリ対象">
        {creatorCategoryTabs.map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={`relative pb-3 ${activeTab === tab ? 'font-semibold text-cyan-300 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-1 after:rounded-full after:bg-cyan-300' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>)}
      </div>
      <div className="mt-4 flex-1 overflow-auto pr-1">
        {visibleGroups.map((group) => <div key={group.label} className="mb-4"><button type="button" className="mb-3 flex items-center gap-1 text-xs font-semibold text-neutral-200" aria-expanded="true"><span className="text-neutral-400">▾</span>{group.label}</button><div className="grid grid-cols-4 gap-2 xl:grid-cols-8">{group.items.map((item, index) => <button key={`${group.label}-${item}-${index}`} type="button" aria-pressed={selectedCategory === `${activeTab}・${group.label}・${item}編み`} className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-center text-xs transition hover:border-cyan-300/70 hover:text-white ${selectedCategory === `${activeTab}・${group.label}・${item}編み` ? 'border-cyan-300 bg-cyan-300/20 text-cyan-100' : 'border-white/10 bg-white/[0.04] text-neutral-300'}`} onClick={() => onSelect(`${activeTab}・${group.label}・${item}編み`)}><><Shirt aria-hidden="true" className="h-7 w-7 text-cyan-200/75" /><span>{item}</span></></button>)}</div>{selectedCategory.startsWith(`${activeTab}・${group.label}・`) && <div className="mt-2 flex flex-wrap gap-2 rounded-lg bg-white/[0.04] p-2"><span className="rounded-full bg-cyan-300 px-3 py-1 text-[11px] font-semibold text-neutral-950">必ず選択してください</span><button type="button" className="rounded-full bg-cyan-300 px-3 py-1 text-[11px] font-semibold text-neutral-950">{selectedCategory.split('・').at(-1)}</button><button type="button" className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-neutral-300">{group.items[0]}</button></div>}</div>)}
        {visibleGroups.length === 0 && <p className="py-10 text-center text-sm text-neutral-500">該当するカテゴリがありません。</p>}
      </div>
    </section>
  );
}

const creatorKeywordPlaceholder = '生成画像について細かい指定がある場合は、こちらでキーワードを入力できます\n\n例1：オートミール色、H型カット、チェック柄生地、通勤用ワンピース…\n\n例2：18歳のヨーロッパ系モデルが両手を後ろに組んでオートミール色のワンピースを着用。ワンピースはチェック柄生地で作られ、U字型襟のデザイン、パフスリーブ、H型カットが特徴。隠しポケット付きで、通勤スタイルを演出';

export function LightchainCreatorPage() {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [keywords, setKeywords] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [historyArtifacts, setHistoryArtifacts] = useState<WorkspaceArtifact[]>([]);
  const { currentBrand, profile, user } = useAuthStore();
  const navigate = useNavigate();
  const heavyRuntime = isHeavyWorkspaceRuntime();
  const metadataName = user?.user_metadata?.full_name;
  const displayName = profile?.name?.trim() || (typeof metadataName === 'string' ? metadataName.trim() : '') || user?.email?.split('@')[0] || 'ユーザー';
  const heavyGenerationHref = (() => {
    const params = new URLSearchParams({
      feature: 'design-gacha',
      prompt: [
        'インスピレーションデザイン',
        selectedCategory ? `カテゴリ: ${selectedCategory}` : 'カテゴリ: 未選択',
        keywords.trim() ? `キーワード: ${keywords.trim()}` : 'キーワード: なし',
      ].join('\n'),
    });
    return `/generate?${params.toString()}`;
  })();

  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>('video[aria-label="インスピレーション動画"]');
    if (video) video.muted = true;
  }, []);

  useEffect(() => {
    if (!currentBrand?.id) {
      setHistoryArtifacts([]);
      return;
    }
    setHistoryArtifacts(
      listWorkspaceArtifacts(currentBrand.id, user?.id)
        .filter((artifact) => designHistoryFeatureTypes.has(artifact.featureType))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    );
  }, [currentBrand?.id, user?.id]);

  return (
    <ParityShell workflowFeature="design-agent" className="lightchain-creator-parity bg-[#151a1c] text-white">
      <span className="sr-only" aria-label={`${displayName}さんのデザイン作成`} />
      <div
        className="mx-auto grid min-h-[calc(100vh-50px)] max-w-[1904px] gap-4 px-4 py-4 lg:grid-cols-[320px_minmax(0,1fr)_320px]"
        style={{ fontFamily: '-apple-system, "system-ui", "Segoe UI", "PingFang SC", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif' }}
      >
        <aside className="flex min-h-0 flex-col gap-4">
          <section className="h-[104px] shrink-0 rounded-xl bg-[#262a2b] p-4">
            <div className="flex w-full items-center gap-2"><h6 aria-label="デザインを選択してください 必須項目" className="w-full text-base font-medium leading-4">デザインを選択してください</h6><span className="shrink-0 rounded bg-rose-400 px-2 py-1 text-[11px] font-bold text-white">必須項目</span></div>
            <button type="button" className="mt-4 flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-white/30 bg-[#171b1d] px-3 text-[13px] text-neutral-300" onClick={() => setCategoryPickerOpen((open) => !open)}><Plus aria-hidden="true" className="h-3.5 w-3.5 text-cyan-300" />{selectedCategory || 'カテゴリを選択してください'}</button>
            {categoryPickerOpen && <p className="mt-2 text-xs text-neutral-500">中央のカテゴリ一覧から選択してください。</p>}
            {categoryPickerOpen && <div className="fixed inset-x-[352px] bottom-4 top-[67px] z-20"><CreatorCategoryPicker selectedCategory={selectedCategory} onSelect={(category) => setSelectedCategory(category)} /></div>}
          </section>
          <section className="flex min-h-0 flex-1 flex-col rounded-xl bg-[#262a2b] p-4"><div className="flex items-center gap-2"><h6 aria-label="画像をアップロード オプション" className="text-base font-medium leading-4">画像をアップロード</h6><span data-creator-option-badge="" className="rounded bg-white/10 px-1.5 py-0.5 text-xs leading-4 text-neutral-400">オプション</span></div>{selectedCategory ? <><div className="mt-3 flex overflow-hidden rounded-lg border border-white/10 bg-[#171b1d] text-xs"><button type="button" className="flex-1 bg-cyan-300 px-3 py-2 font-semibold text-neutral-950">画像</button><button type="button" className="flex-1 px-3 py-2 text-neutral-300">生地画像</button></div><div className="mt-4 flex flex-1 items-center justify-center rounded-lg border border-white/10 bg-[#1b2022] text-center text-sm text-neutral-300"><button type="button" className="rounded-lg px-5 py-3" onClick={() => navigate('/asset-center')}><Upload className="mx-auto mb-2 h-6 w-6" />画像をアップロードします</button></div></> : <div className="flex flex-1 items-center justify-center"><button type="button" className="rounded-full bg-white/[0.08] px-5 py-3 text-sm text-neutral-300" onClick={() => navigate('/asset-center')}><Sparkles className="mr-2 inline h-4 w-4" />デザインを先に選択してください。</button></div>}</section>
        </aside>


        <main className="relative min-h-0 rounded-xl bg-[#151a1c] px-2 py-4 lg:px-8"><button type="button" className="absolute right-2 top-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-neutral-200" onClick={() => setHistoryOpen((open) => !open)}><Clock3 className="mr-2 inline h-4 w-4" />生成履歴</button><section className="flex min-h-full flex-col items-center justify-center pt-8"><h5 className="text-xl font-semibold text-cyan-300">インスピレーション</h5><p className="mt-2 text-sm text-neutral-400">AIで素早くデザイン開発、効率向上・コスト削減</p><div className="mt-[1px] h-[340px] w-full max-w-[624px] overflow-hidden rounded-lg bg-[#0d1113]"><video src="https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/tools/ja/%E6%9C%8D%E8%A3%85%E8%AE%BE%E8%AE%A1.mp4" className="size-full" autoPlay controls playsInline aria-label="インスピレーション動画" /></div></section></main>
        <aside className="flex min-h-0 flex-col gap-4">{heavyRuntime
          ? <section className="flex min-h-[264px] flex-col rounded-xl bg-[#262a2b] p-4" data-testid="creator-style-panel"><div className="flex items-center gap-2"><h6 aria-label="スタイルを選択してください オプション" className="text-base font-medium leading-4">スタイルを選択してください</h6><span data-creator-option-badge="" className="rounded bg-white/10 px-1.5 py-0.5 text-xs leading-4 text-neutral-400">オプション</span></div>{!selectedCategory && <div className="flex flex-1 items-center justify-center"><span className="rounded-full bg-white/[0.08] px-5 py-3 text-sm text-neutral-300"><Sparkles className="mr-2 inline h-4 w-4" />デザインを先に選択してください。</span></div>}</section>
          : <section className="min-h-[264px] rounded-xl bg-[#262a2b] p-4"><div className="flex h-full items-center justify-center text-center"><div><WandSparkles className="mx-auto h-12 w-12 text-cyan-300/70" /><h6 className="mt-4 text-xs font-semibold leading-[1.4286] text-neutral-300">このモジュールは購入後に使用可能。</h6><p className="mt-2 text-xs text-neutral-400">ご担当の営業担当者にご連絡ください</p></div></div></section>}<section className="flex min-h-0 flex-1 flex-col rounded-xl bg-[#262a2b] p-4"><div className="flex items-center gap-2"><h6 aria-label="キーワードを追加 オプション" className="text-base font-medium leading-4">キーワードを追加</h6><span data-creator-option-badge="" className="rounded bg-white/10 px-1.5 py-0.5 text-xs leading-4 text-neutral-400">オプション</span></div><div className="relative mt-4 flex h-[401px] min-h-0 flex-col gap-1 rounded-lg border border-white/10 pb-1"><textarea value={keywords} onChange={(event) => setKeywords(event.target.value)} className="min-h-0 flex-1 resize-none rounded-md border border-white/10 bg-[#262a2b] px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-500 focus:border-cyan-300" placeholder={creatorKeywordPlaceholder} maxLength={1000} aria-label="生成画像について細かい指定がある場合は、こちらでキーワードを入力できます" /><div className="flex h-6 w-full items-center justify-between bg-transparent px-2 text-xs text-neutral-400"><span>文字数 <span className="text-cyan-300">{keywords.length}</span>/1000</span><button type="button" className="rounded border border-white/10 px-3 py-1" onClick={() => setKeywords('')} disabled={!keywords}>全削除</button><button type="button" className="rounded bg-cyan-300 px-3 py-1 font-semibold text-neutral-950" onClick={() => setDictionaryOpen(true)}>キーワード辞典</button></div></div>{heavyRuntime ? <button type="button" data-testid="heavy-creator-generate" onClick={() => navigate(heavyGenerationHref)} disabled={!selectedCategory} className="mt-8 inline-flex h-10 w-full items-center justify-center rounded-lg bg-cyan-300 px-4 py-0 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">AI生成</button> : <ParityPermissionGate testId="creator-permission" marginClass="mt-8" />}</section></aside>
      </div>

      {historyOpen && <section className="fixed inset-x-4 bottom-4 top-[67px] z-20 overflow-auto rounded-xl border border-white/10 bg-[#262a2b] p-5 shadow-2xl" data-testid="creator-persisted-history"><h2 className="font-semibold">生成履歴</h2><PersistedHistoryPanel artifacts={historyArtifacts} emptyMessage="保存確認できたデザイン成果物はまだありません。provider生成後に保存すると、ここから再利用できます。" reuseLabel="Canvasへ再利用" onReuse={(artifact) => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(artifact.id)}`)} /></section>}
      {dictionaryOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" role="dialog" aria-modal="true" aria-label="キーワード辞典"><div className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-2xl border border-white/10 bg-[#262a2b] p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">キーワード辞典</h2><button type="button" className="rounded-lg border border-white/10 px-3 py-2 text-sm" onClick={() => setDictionaryOpen(false)}>閉じる</button></div><div className="mt-5 grid gap-2 sm:grid-cols-3">{['シルエット', '素材感', 'カラー', '柄・プリント', 'シーン', 'ディテール', '季節', '雰囲気', 'アイテム'].map((tag) => <button key={tag} type="button" className="rounded-xl border border-white/10 px-3 py-3 text-left text-sm text-neutral-300 hover:border-cyan-300" onClick={() => setKeywords((value) => `${value}${value ? '、' : ''}${tag}`)}>{tag}<ChevronRight className="float-right h-4 w-4 text-neutral-500" /></button>)}</div></div></div>}
    </ParityShell>
  );
}

/**
 * The canonical Light production route is intentionally a compact print-image
 * surface.  Keep the richer placement/mask workbench available at the legacy
 * Heavy compatibility route, while matching the production entry point here.
 */
export function printImageBrief(coverage: 'spot' | 'full'): string {
  return [
    'プリントイメージ: 1枚目の参考画像の衣服に、2枚目のプリント画像を印刷した仕上がりを作成してください。',
    coverage === 'full'
      ? '配置: 全体（衣服の生地全面に柄として繰り返し印刷）'
      : '配置: スポット（胸元などにワンポイントで印刷）',
    '衣服の形・色・シワ・陰影と背景は元の参考画像を保ち、プリントは布の質感と陰影に沿って自然に馴染ませてください。',
  ].join('\n');
}

export function LightchainPrintingPage() {
  const { user, currentBrand } = useAuthStore();
  return <LightchainPrintingWorkspace key={JSON.stringify([currentBrand?.id, user?.id])} />;
}

function LightchainPrintingWorkspace() {
  const workspace=useCanonicalImageWorkspace('printing-image',{requiredSources:2,title:'プリントイメージ',initialInputState:{coverage:'spot'}});
  const referenceImage=workspace.slots.primary?{url:workspace.slots.primary.imageUrl,referenceType:'base' as const,
    ...(workspace.slots.primary.sourceImageId?{galleryImageId:workspace.slots.primary.sourceImageId,fromGallery:true}:{}),
    ...(workspace.slots.primary.sourceStoragePath?{storagePath:workspace.slots.primary.sourceStoragePath}:{})}:null;
  const printImage=workspace.slots.secondary?{url:workspace.slots.secondary.imageUrl,referenceType:'pattern' as const,
    ...(workspace.slots.secondary.sourceImageId?{galleryImageId:workspace.slots.secondary.sourceImageId,fromGallery:true}:{}),
    ...(workspace.slots.secondary.sourceStoragePath?{storagePath:workspace.slots.secondary.sourceStoragePath}:{})}:null;
  const coverage=workspace.inputState.coverage==='full'?'full':workspace.inputState.coverage==='spot'?'spot':null;
  const setCoverage=(value:'spot'|'full')=>{beginDraftEdit('coverage');workspace.setInputState({...workspace.inputState,coverage:value});};
  const [historyOpen,setHistoryOpen]=useState(false),[message,setMessage]=useState('');
  const {user,currentBrand}=useAuthStore(),navigate=useNavigate(),location=useLocation();
  const heavyBrand=useHeavyWorkspaceBrandGate();
  const locked=heavyBrand.pending||workspace.status==='running'||workspace.status==='loading'||Boolean(workspace.pendingId);
  const persistenceScope=useMemo(()=>user?.id?{origin:cloudflareDataPlane?.origin??window.location.origin,userId:user.id}:undefined,[user?.id]);
  const libraryQuery=new URLSearchParams(location.search);
  const explicitLibrary=libraryQuery.has('libraryArtifactId');
  const libraryIdentity=explicitLibrary?JSON.stringify([libraryQuery.get('libraryArtifactId'),libraryQuery.get('librarySlot')]):null;
  const draftContext=JSON.stringify([libraryIdentity,workspace.jobId,workspace.pendingId,user?.id,currentBrand?.id,persistenceScope?.origin,persistenceScope?.userId]);
  const draftContextRef=useRef(draftContext);
  const draftReady=useRef(false),draftEdited=useRef(false),draftSourceEdited=useRef(false),draftReadyContext=useRef<string|null>(null),draftRestoreGeneration=useRef(0);
  if(draftContextRef.current!==draftContext){draftRestoreGeneration.current++;draftReady.current=false;draftEdited.current=false;draftSourceEdited.current=false;draftReadyContext.current=null;}
  draftContextRef.current=draftContext;
  const beginDraftEdit=(kind:'sources'|'coverage'='sources')=>{draftRestoreGeneration.current++;draftReady.current=true;draftEdited.current=true;if(kind==='sources')draftSourceEdited.current=true;draftReadyContext.current=draftContext;};
  useEffect(()=>{draftReady.current=false;draftReadyContext.current=null;const generation=++draftRestoreGeneration.current;
    if(explicitLibrary||workspace.jobId||workspace.pendingId||!user?.id||!currentBrand?.id||!persistenceScope)return;
    let cancelled=false;
    const current=()=>!cancelled&&generation===draftRestoreGeneration.current&&draftContextRef.current===draftContext;
    void restorePrintInputState(currentBrand.id,{scope:persistenceScope}).then(async snapshot=>{
      if(!current())return;let missingSource=false;
      for(const [key,image] of [['primary',snapshot.garment],['secondary',snapshot.designs[0]]] as const){
        if(!current())return;if(!image)continue;
        try{let url=image.url;if(image.storagePath){const [signed]=await withSignedImageUrls([{storage_path:image.storagePath,image_url:''}]);if(!current())return;if(!signed?.image_url)throw new Error('print_draft_source_unavailable');url=signed.image_url;}
          if(!current())return;const response=await fetch(url);if(!current())return;if(!response.ok)throw new Error('print_draft_source_unavailable');
          const blob=await response.blob();if(!current())return;await workspace.upload(key,new File([blob],key==='primary'?'参考画像':'プリント画像',{type:blob.type}),current,
            image.galleryImageId||image.storagePath?{...(image.galleryImageId?{sourceImageId:image.galleryImageId}:{}),...(image.storagePath?{sourceStoragePath:image.storagePath}:{})}:undefined);
          if(!current())return;
        }catch{if(!current())return;missingSource=true;}
      }
      if(current()){if(snapshot.editorState)workspace.setInputState({coverage:snapshot.editorState.coverageMode});draftReady.current=!missingSource;draftReadyContext.current=missingSource?null:draftContext;if(missingSource)setMessage('保存済みの入力画像を取得できません。元の保存状態を保持しています。素材を選び直してください。');}
    }).catch(()=>{if(current()){draftReady.current=false;draftReadyContext.current=null;setMessage('保存済みの入力を取得できません。元の保存状態を保持しています。素材を選び直してください。');}});return()=>{cancelled=true;};
  },[draftContext,explicitLibrary,workspace.jobId,workspace.pendingId,user?.id,currentBrand?.id,persistenceScope]);
  useEffect(()=>{if(workspace.jobId||workspace.pendingId||!draftReady.current||!draftEdited.current||draftReadyContext.current!==draftContext||draftContextRef.current!==draftContext||!user?.id||!currentBrand?.id||(!referenceImage&&!printImage))return;
    const generation=draftRestoreGeneration.current,userId=user.id,brandId=currentBrand.id,auth=useAuthStore.getState(),brandState=auth.brandState;
    const assertContext=()=>{const latest=useAuthStore.getState();if(draftContextRef.current!==draftContext||draftRestoreGeneration.current!==generation||latest.user?.id!==userId||latest.currentBrand?.id!==brandId||latest.brandState!==brandState)throw new Error('print_draft_context_changed');};
    if(!draftSourceEdited.current&&!explicitLibrary&&persistenceScope){
      void updatePrintInputCoverage(currentBrand.id,coverage??'spot',{scope:persistenceScope,assertContext}).then(()=>{if(draftContextRef.current===draftContext&&draftRestoreGeneration.current===generation)setMessage('');}).catch(()=>{if(draftContextRef.current===draftContext&&draftRestoreGeneration.current===generation)setMessage('保存済み配置を確認できないため、範囲を保存できません。元の下書きは保持しています。');});
      return;
    }
    void persistPrintInputState(currentBrand.id,referenceImage,printImage?[printImage]:[],{garment:null,designs:[]},{scope:persistenceScope,assertContext,
      editorState: { version:1, coverageMode:coverage??'spot', outputScale:1, placementConfirmed:false, printableSurfaceEnabled:false,
        layers:printImage?[{designIndex:0,layerId:'print-design-1',transform:{x:0,y:0,scale:1,rotation:0,opacity:1,flipX:false,flipY:false}}]:[] },
    }).catch(()=>undefined);
  },[draftContext,workspace.jobId,workspace.pendingId,user?.id,currentBrand?.id,persistenceScope,workspace.slots.primary,workspace.slots.secondary,coverage]);
  const handleFile=(event:ChangeEvent<HTMLInputElement>,kind:'base'|'pattern')=>{const file=event.target.files?.[0];if(file){beginDraftEdit();void workspace.upload(kind==='base'?'primary':'secondary',file);setMessage('');}};
  const handleCanonicalFiles=(event:ChangeEvent<HTMLInputElement>)=>{const [base,pattern]=Array.from(event.target.files??[]).slice(0,2);if(base||pattern){beginDraftEdit();setMessage('');}if(base)void workspace.upload('primary',base);if(pattern)void workspace.upload('secondary',pattern);};
  const reset=()=>{if(locked)return;beginDraftEdit();workspace.clearSource('primary');workspace.clearSource('secondary');setMessage('');
    if(!workspace.jobId&&user?.id&&currentBrand?.id&&persistenceScope)void persistPrintInputState(currentBrand.id,null,[],{garment:null,designs:[]},{scope:persistenceScope}).catch(()=>undefined);};
  const handleGenerate=()=>workspace.generate({brief:workspace.brief||printImageBrief(coverage==='full'?'full':'spot')});
  const [printingResultUrl,setPrintingResultUrl]=useState<string|null>(null);
  useEffect(()=>{const result=workspace.result;let cancelled=false;
    if(!result){setPrintingResultUrl(null);return;}
    if(result.imageUrl){setPrintingResultUrl(result.imageUrl);return;}
    if(!result.storagePath){setPrintingResultUrl(null);return;}
    void withSignedImageUrls([{storage_path:result.storagePath,image_url:''}]).then(([signed])=>{if(!cancelled)setPrintingResultUrl(signed?.image_url||null);}).catch(()=>{if(!cancelled)setPrintingResultUrl(null);});
    return()=>{cancelled=true;};
  },[workspace.result]);

  const [canvasHandoffPending,setCanvasHandoffPending]=useState(false),[canvasHandoffMessage,setCanvasHandoffMessage]=useState('');
  const canvasHandoffInFlight=useRef(false),canvasHandoffMounted=useRef(true);
  const printingCanvasScope=JSON.stringify([location.pathname,location.search,workspace.toolId,workspace.jobId]);
  const printingCanvasContext=useRef({workspace,userId:user?.id,brandId:currentBrand?.id,scope:printingCanvasScope});
  printingCanvasContext.current={workspace,userId:user?.id,brandId:currentBrand?.id,scope:printingCanvasScope};
  useEffect(()=>{canvasHandoffMounted.current=true;return()=>{canvasHandoffMounted.current=false;};},[]);
  const canvasHandoffDisabled=canvasHandoffPending||locked||workspace.status==='unknown'||!user?.id||!currentBrand?.id||!cloudflareDataPlane
    ||!workspace.result?.imageId||!workspace.result.jobId
    ||normalizeCloudflareGeneratedImageStoragePath(workspace.result.storagePath)!==`generated-images/${workspace.result.imageId}`;
  const handlePrintingCanvasHandoff=async()=>{
    if(canvasHandoffInFlight.current||canvasHandoffDisabled)return;
    const result=workspace.result,client=cloudflareDataPlane;
    if(!result?.imageId||!result.jobId||!user?.id||!currentBrand?.id||!client)return;
    const captured=Object.freeze({imageId:result.imageId,storagePath:result.storagePath,jobId:result.jobId,userId:user.id,brandId:currentBrand.id,scope:printingCanvasScope});
    const auth=useAuthStore.getState();
    const fence=captureAuthBrandFence(auth.brandState,auth.user?.id??null,auth.currentBrand?.id??null);
    const assertCurrent=()=>{
      const latest=printingCanvasContext.current,current=useAuthStore.getState(),output=latest.workspace.result;
      assertAuthBrandFence(fence,captureAuthBrandFence(current.brandState,current.user?.id??null,current.currentBrand?.id??null),'printing_canvas_handoff');
      if(!canvasHandoffMounted.current||current.user?.id!==captured.userId||current.currentBrand?.id!==captured.brandId
        ||latest.userId!==captured.userId||latest.brandId!==captured.brandId||latest.scope!==captured.scope||output!==result
        ||output?.imageId!==captured.imageId||output.storagePath!==captured.storagePath||output.jobId!==captured.jobId
        ||latest.workspace.pendingId||['loading','running','unknown'].includes(latest.workspace.status)
        ||cloudflareDataPlane!==client)throw new Error('printing_canvas_handoff_context_changed');
    };
    canvasHandoffInFlight.current=true;setCanvasHandoffPending(true);setCanvasHandoffMessage('');
    let handedOff=false;
    try{
      assertCurrent();
      if(normalizeCloudflareGeneratedImageStoragePath(captured.storagePath)!==`generated-images/${captured.imageId}`)throw new Error('printing_canvas_handoff_identity_invalid');
      const images=await client.listGeneratedImages(captured.brandId,{limit:100,order:'newest'});
      assertCurrent();
      const matches=images.filter(image=>image.id===captured.imageId);
      if(matches.length!==1||matches[0].brand_id!==captured.brandId||matches[0].user_id!==captured.userId
        ||matches[0].job_id!==captured.jobId||matches[0].storage_path!==captured.storagePath)throw new Error('printing_canvas_handoff_saved_image_mismatch');
      navigate(`/canvas/new?galleryImageId=${encodeURIComponent(captured.imageId)}`);
      handedOff=true;
    }catch{
      if(canvasHandoffMounted.current)setCanvasHandoffMessage('保存済み画像と現在の作業範囲を確認できません。Canvasには移動していません。');
    }finally{
      if(!handedOff){canvasHandoffInFlight.current=false;if(canvasHandoffMounted.current)setCanvasHandoffPending(false);}
    }
  };


  if (window.location.pathname === '/printing') {
    return (
      <ParityShell workflowFeature="printing-image" className="bg-[#151a1c] text-white">
        <div className="mx-auto grid min-h-[calc(100vh-70px)] max-w-[1904px] gap-4 px-4 py-4 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
          <section className="flex min-h-[780px] flex-col rounded-xl bg-[#252a2d] p-4">
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-neutral-400" />
              <h1 className="text-base font-semibold">画像をアップロード</h1>
            </div>
            <label className="mt-4 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-[#171b1d] px-5 text-center transition hover:border-cyan-300/60">
              <Upload className="h-10 w-10 text-neutral-500" />
              <span className="mt-4 text-sm font-semibold text-neutral-200">画像をアップロードします</span>
              <span className="mt-3 max-w-[250px] text-xs leading-5 text-neutral-400">jpg、jpeg、png、webpに対応しています。サイズ20M以内の画像を2枚までアップロードできます</span>
              <input className="sr-only" disabled={locked} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleCanonicalFiles} />
            </label>
            {(referenceImage || printImage) && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[referenceImage, printImage].map((image, index) => image ? (
                  <img key={`${image.referenceType}-${index}`} src={image.url} alt={index === 0 ? '参考画像' : 'プリント画像'} className="h-24 w-full rounded-lg object-cover" />
                ) : <div key={`empty-${index}`} className="h-24 rounded-lg border border-dashed border-white/10" />)}
                <button type="button" className="col-span-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300" onClick={() => { reset(); }}>リセット</button>
              </div>
            )}
          </section>

          <main data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId??''} data-resume-state={workspace.status} className="relative flex min-h-[780px] flex-col rounded-xl bg-[#252a2d] p-4 sm:p-6">
            <button type="button" className="absolute right-4 top-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-neutral-200" onClick={() => setHistoryOpen((open) => !open)}>
              <Clock3 className="mr-2 inline h-4 w-4" />生成履歴
            </button>
            <section className="flex flex-1 flex-col items-center justify-center">
              <h2 className="text-2xl font-semibold text-neutral-100">AIグラフィックデザイン</h2>
              <p className="mt-2 text-sm text-neutral-400">AIでグラフィックを作成</p>
              <div className="mt-6 h-[340px] w-full max-w-[1056px] overflow-hidden rounded-lg bg-[#0d1113]">
                <video src="https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/tools/ja/%E5%8D%B0%E6%9F%93%E4%B8%8A%E8%BA%AB.mp4" className="h-full w-full object-cover" autoPlay controls muted playsInline aria-label="AIグラフィックデザイン動画" />
              </div>
              {(referenceImage || printImage) && <button type="button" className="mt-6 rounded-xl bg-cyan-300 px-6 py-3 text-sm font-semibold text-neutral-950" disabled={locked||!workspace.slots.primary||!workspace.slots.secondary} onClick={() => void handleGenerate()}>AI生成</button>}
              {message && <p className="mt-3 text-sm text-neutral-300" role="status">{message}</p>}
            </section>
          </main>

          <aside className="relative min-h-[780px] rounded-xl bg-[#252a2d] p-4" aria-label="生成結果"><CanonicalImageWorkspaceControls workspace={workspace} onSourceEdit={beginDraftEdit} />{workspace.result?<div className="relative z-10 space-y-2" data-testid="printing-canvas-handoff">
    <button type="button" className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-40" disabled={canvasHandoffDisabled} onClick={()=>void handlePrintingCanvasHandoff()}>Canvasで再編集</button>
    {canvasHandoffMessage&&<p className="text-sm text-neutral-400" role="status">{canvasHandoffMessage}</p>}
  </div>:null}
            {historyOpen && (
              <section className="rounded-xl border border-white/10 bg-[#171b1d] p-5" aria-label="生成履歴">
                <h2 className="font-semibold">生成履歴</h2>
                <p className="mt-3 text-sm text-neutral-400">生成履歴はここに表示されます。</p>
                <button type="button" className="mt-3 text-sm font-semibold text-neutral-200 underline" onClick={() => navigate('/history')}>履歴を開く</button>
              </section>
            )}
          </aside>
        </div>
      </ParityShell>
    );
  }

  // Light /tools/printing (プリントイメージ), measured at 1440×900: shared デザインツール frame, 564×280 reference box,
  // プリントをアップロード + リセット, 244px スポット／全体 toggle, 120px print tile, 288×40 AI生成 pinned bottom-right.
  const printingControls = (
    <div className="flex flex-1 flex-col">
      <label data-testid="print-image-garment-input" className="mt-[18px] flex h-[280px] shrink-0 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-transparent bg-[#33393b] text-center transition hover:border-[#20d0c4]">
        <input className="sr-only" disabled={locked} type="file" accept="image/*" aria-label="参考画像をアップロードしてください" onChange={(event) => handleFile(event, 'base')} />
        {referenceImage ? <>
          <img src={referenceImage.url} alt="参考画像" data-source-slot="primary" data-source-image-id={workspace.slots.primary?.sourceImageId??''} data-source-storage-path={workspace.slots.primary?.sourceStoragePath??''} className="max-h-full max-w-full object-contain" />
          <span className="sr-only" data-testid="print-image-file-name">{workspace.slots.primary?.name}</span>
        </> : <>
          <ImagePlus aria-hidden="true" className="h-6 w-6 text-neutral-200" />
          <span className="mt-2 text-base text-neutral-200">参考画像をアップロードしてください</span>
          <span className="mt-1 text-xs text-neutral-400">20MB以下の画像アップロードしてください</span>
        </>}
      </label>
      <div className="mt-[18px] flex h-5 items-center justify-between">
        <h2 className="text-base font-normal text-white/90">プリントをアップロード</h2>
        <button type="button" disabled={locked} className="inline-flex items-center gap-1 text-sm text-white/80 hover:text-white" onClick={() => { reset(); }}><RotateCw aria-hidden="true" className="h-3 w-3" />リセット</button>
      </div>
      <div role="group" aria-label="プリント範囲" className="mt-[18px] grid h-[30px] w-[244px] grid-cols-2 rounded-full bg-[#2b3133] p-[2px]">
        {(['spot', 'full'] as const).map((value) => <button key={value} type="button" aria-pressed={coverage === value} disabled={locked} onClick={() => setCoverage(value)} className={`rounded-full text-sm transition ${coverage === value ? 'bg-[#4b5153] text-white' : 'text-white/70 hover:text-white'}`}>{value === 'spot' ? 'スポット' : '全体'}</button>)}
      </div>
      <label data-testid="print-image-print-input" className="mt-[18px] flex h-[120px] w-[120px] shrink-0 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-transparent bg-[#33393b] p-2 text-center transition hover:border-[#20d0c4]">
        <input className="sr-only" disabled={locked} type="file" accept="image/*" aria-label="プリント画像をアップロード" onChange={(event) => handleFile(event, 'pattern')} />
        {printImage ? <>
          <img src={printImage.url} alt="プリント画像" data-source-slot="secondary" data-source-image-id={workspace.slots.secondary?.sourceImageId??''} data-source-storage-path={workspace.slots.secondary?.sourceStoragePath??''} className="h-full w-full object-contain" />
          <span className="sr-only" data-testid="print-image-file-name">{workspace.slots.secondary?.name}</span>
        </> : <>
          <span className="text-sm leading-[21px] text-neutral-200">画像をアップロード</span>
          <span className="mt-1 text-xs leading-[17px] text-neutral-400">20MB以下の画像アップロードしてください</span>
        </>}
      </label>
      {heavyBrand.failed && <p role="alert" className="mt-3 text-sm text-rose-200">ワークスペースを準備できません。ページを再読み込みしてください。</p>}
      {message && <p className="mt-3 text-sm text-white/70" role="status">{message}</p>}
      {workspace.error && <p role="alert" className="mt-3 text-sm text-rose-200">{workspace.error}</p>}
      {workspace.pendingId && workspace.status !== 'running' && <button type="button" onClick={()=>void workspace.reconcile()} className="mt-3 self-start rounded-lg border border-white/15 px-3 py-2 text-sm text-white/85 disabled:opacity-40">同じ依頼を照合</button>}
      <div className="mt-auto flex justify-end pt-6">
        <button type="submit" data-testid="print-image-generate" className="inline-flex h-10 w-[288px] items-center justify-center gap-1 rounded-lg bg-[#5fd0c8] text-sm font-medium text-slate-950 transition hover:brightness-105 disabled:opacity-60" disabled={locked||!workspace.slots.primary||!workspace.slots.secondary} onClick={() => void handleGenerate()}>AI生成<Sparkles aria-hidden="true" className="h-4 w-4" /></button>
      </div>
    </div>
  );
  const printingResult = (
    <div className="flex h-full flex-col" data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId??''} data-resume-state={workspace.status}>
      {workspace.result ? (
        <div data-testid="print-image-result" className="flex h-full flex-col items-center justify-center gap-4 px-10 pb-6 pt-16">
          {printingResultUrl && <img src={printingResultUrl} alt="プリントイメージ AI生成" className="min-h-0 max-w-full flex-1 rounded-lg object-contain" />}
          <div className="space-y-2" data-testid="printing-canvas-handoff">
            <button type="button" className="rounded-lg bg-[#5fd0c8] px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-40" disabled={canvasHandoffDisabled} onClick={()=>void handlePrintingCanvasHandoff()}>Canvasで再編集</button>
            {canvasHandoffMessage&&<p className="text-sm text-neutral-400" role="status">{canvasHandoffMessage}</p>}
          </div>
        </div>
      ) : workspace.status === 'running' ? (
        <div className="flex h-full items-center justify-center text-sm text-white/70" role="status">生成中…</div>
      ) : (
        <LightchainDesignToolEmptyState title="プリントイメージ" description="プリントイメージを使用し、版下を作成せずに印刷効果を確認できます" videoUrl="https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/tools/ja/%E5%8D%B0%E6%9F%93%E4%B8%8A%E8%BA%AB.mp4" videoTestId="print-image-empty-video" />
      )}
      {libraryQuery.get('debug') === '1' && user?.id && currentBrand?.id && persistenceScope && <PrintDraftSafetyControls brandId={currentBrand.id} userId={user.id} origin={persistenceScope.origin} disabled={locked || explicitLibrary || Boolean(workspace.jobId) || Boolean(workspace.pendingId)} />}
    </div>
  );
  return (
    <ParityShell workflowFeature="printing-image" className="lightchain-printing-parity bg-[#0b1113] text-white">
      <LightchainDesignToolFrame active="printing" testId="print-image-page" navigationLocked={locked}>{printingControls}{printingResult}</LightchainDesignToolFrame>
    </ParityShell>
  );
}

export function svgConvertBrief(): string {
  return [
    '平絵をベクター化: アップロードした平絵（技術画）やプリントを、生産用のベクターファイルにそのまま変換できるクリーンな版に描き直してください。',
    '輪郭線・縫い目・パーツの位置と形は元画像と同じに保ち、線は均一な太さの単色、面ははっきりした境界の単色の塗りにしてください。',
    'グラデーション・陰影・質感・ノイズ・人物・背景の装飾は入れず、白い無地の背景に正面から配置してください。',
  ].join('\n');
}

export function vectorBrief(professional: boolean, layerModes: readonly ('stack' | 'split')[]): string {
  return [
    `パターンをベクター画像に変換（${professional ? 'プロフェッショナル版' : '通常版'}）: アップロードしたプリントパターン/グラフィックそのものを、ベクター化しやすいフラットな版に描き直してください。`,
    '元のモチーフ・配色・構図・比率はそのまま保ち、各色をはっきりした境界の単色の塗りにしてください。グラデーション・ノイズ・質感・影・ぼかしは入れないでください。',
    '衣服・人物・モックアップ・枠・背景の装飾は追加せず、パターンだけを白い無地の背景に正面から配置してください。画像内の文字は読み取れる範囲で同じ形を保ってください。',
    professional && layerModes.length > 0 ? `レイヤー分け: ${layerModes.map((mode) => mode === 'stack' ? '積み重ね（重なり順を保つ）' : '分割（色ごとに重ならない領域に分ける）').join('、')}` : '',
  ].filter(Boolean).join('\n');
}

export function LightchainVectorSpecialPage() {
  const location=useLocation();
  const isSvgConvert=location.pathname==='/tools/svg-convert';
  const isProfessionalFlow=location.pathname==='/tools/vector-special',activeTab=isProfessionalFlow?'プロフェッショナル版':'通常版';
  const toolTitle=isSvgConvert?'平絵をベクター化':`パターンをベクター画像に変換（${activeTab}）`;
  const toolDescription=isSvgConvert?'平絵やプリントを編集可能なベクターファイルに変換し生産に直結':'プリントパターンをベクター画像に変換します';
  const workspace=useCanonicalImageWorkspace(isSvgConvert?'svg-convert':isProfessionalFlow?'pattern-vector-pro':'pattern-vector',{requiredSources:1,title:toolTitle,initialInputState:{layerModes:['stack']}});
  const referenceImage=workspace.slots.primary?.imageUrl??null;
  const layerModes=Array.isArray(workspace.inputState.layerModes)?workspace.inputState.layerModes.filter((value):value is 'stack'|'split'=>value==='stack'||value==='split'):[];
  const heavyBrand=useHeavyWorkspaceBrandGate();
  const usage=7,locked=heavyBrand.pending||workspace.status==='running'||workspace.status==='loading'||Boolean(workspace.pendingId);
  const [vectorResultUrl,setVectorResultUrl]=useState<string|null>(null);
  useEffect(()=>{const result=workspace.result;let cancelled=false;
    if(!result){setVectorResultUrl(null);return;}
    if(result.imageUrl){setVectorResultUrl(result.imageUrl);return;}
    if(!result.storagePath){setVectorResultUrl(null);return;}
    void withSignedImageUrls([{storage_path:result.storagePath,image_url:''}]).then(([signed])=>{if(!cancelled)setVectorResultUrl(signed?.image_url||null);}).catch(()=>{if(!cancelled)setVectorResultUrl(null);});
    return()=>{cancelled=true;};
  },[workspace.result]);
  const handleReferenceImage=(event:ChangeEvent<HTMLInputElement>)=>{const file=event.target.files?.[0];event.target.value='';if(file)void workspace.upload('primary',file);};
  const toggleLayerMode=(mode:'stack'|'split')=>{if(locked)return;workspace.setInputState({...workspace.inputState,layerModes:layerModes.includes(mode)?(layerModes.length>1?layerModes.filter(value=>value!==mode):layerModes):[...layerModes,mode]});};
  const generate=()=>workspace.generate({brief:workspace.brief||(isSvgConvert?svgConvertBrief():vectorBrief(isProfessionalFlow,layerModes))});

  // Light /tools/pattern-to-vector & /tools/vector-special, measured at 1440×900: shared デザインツール frame with the
  // two 278px ベクター tabs, 564×280 dashed upload box, (pro) 160×165 積み重ね/分割 cards, 使用回数 and AI生成 at (404,828).
  const vectorControls = (
    <div className="flex flex-1 flex-col">
      <label data-testid="vector-source-input" className="mt-[18px] flex h-[280px] shrink-0 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-white/20 bg-[#33393b] text-center transition hover:border-[#20d0c4]">
        <input className="sr-only" disabled={locked} type="file" accept="image/*" aria-label="参考画像をアップロードしてください" onChange={handleReferenceImage} />
        {referenceImage ? <>
          <img src={referenceImage} alt="参考画像" className="max-h-full max-w-full object-contain" />
          <span className="sr-only" data-testid="vector-file-name">{workspace.slots.primary?.name}</span>
        </> : <>
          <ImagePlus aria-hidden="true" className="h-6 w-6 text-neutral-200" />
          <span className="mt-2 text-base text-neutral-200">参考画像をアップロードしてください</span>
          <span className="mt-1 text-xs text-neutral-400">20MB以下の画像アップロードしてください</span>
        </>}
      </label>
      {isProfessionalFlow && <>
        <h6 className="mt-[18px] text-base font-normal leading-5 text-white/90">レイヤー分け方法を選択してください（複数選択可）</h6>
        <div className="mt-3 flex gap-4">
          {([['stack', '積み重ね', 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/persistence/font-end/pileUp.png'], ['split', '分割', 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/persistence/font-end/carveUp.png']] as const).map(([mode, label, imageUrl]) => {
            const selected = layerModes.includes(mode);
            return (
              <button key={mode} type="button" aria-pressed={selected} disabled={locked} onClick={() => toggleLayerMode(mode)} className={`relative flex h-[165px] w-[160px] flex-col items-center justify-end rounded-lg border pb-3 text-sm transition ${selected ? 'border-[#20d0c4] bg-[#1f2a2b] font-semibold text-white' : 'border-dashed border-white/15 text-white/70 hover:border-white/30'}`}>
                {selected && <span aria-hidden="true" className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-[#20d0c4] text-[10px] leading-none text-[#0b1113]">✓</span>}
                <img src={imageUrl} alt="" className="absolute left-1/2 top-3 h-[110px] w-[130px] -translate-x-1/2 object-contain" />
                <span className="relative">{label}</span>
              </button>
            );
          })}
        </div>
      </>}
      {workspace.error && <p role="alert" className="mt-3 text-sm text-rose-200">{workspace.error}</p>}
      {workspace.pendingId && workspace.status !== 'running' && <button type="button" onClick={()=>void workspace.reconcile()} className="mt-3 self-start rounded-lg border border-white/15 px-3 py-2 text-sm text-white/85 disabled:opacity-40">同じ依頼を照合</button>}
      <div className="mt-auto flex flex-col items-end gap-3 pt-4">
        {isProfessionalFlow && <span className="pr-4 text-base text-white/70">使用回数 {usage}/30</span>}
        <button type="button" data-testid={isProfessionalFlow ? 'heavy-pattern-vector-pro-generate' : 'heavy-pattern-vector-generate'} className="inline-flex h-10 w-[288px] items-center justify-center gap-1.5 rounded-lg bg-[#5fd0c8] text-sm font-medium text-slate-950 transition hover:brightness-105 disabled:opacity-60" disabled={locked||!referenceImage} onClick={()=>void generate()}>
          AI生成{isProfessionalFlow && <span className="inline-flex items-center gap-0.5"><span aria-hidden="true" className="inline-block size-3.5 rounded-full bg-slate-950" />1</span>}
        </button>
      </div>
    </div>
  );
  const vectorResult = (
    <div className="flex h-full flex-col" data-workspace-feature={workspace.toolId} data-resume-job={workspace.jobId??''} data-resume-state={workspace.status}>
      {workspace.result ? (
        <div data-testid="vector-result" className="flex h-full flex-col items-center justify-center gap-3 px-10 pb-6 pt-16">
          {vectorResultUrl && <img src={vectorResultUrl} alt={toolTitle} className={`min-h-0 max-w-full flex-1 rounded-lg object-contain ${isSvgConvert ? 'bg-white' : ''}`} />}
          {vectorResultUrl && <SvgExportPanel imageUrl={vectorResultUrl} fileName={isSvgConvert ? 'flat-drawing-vector' : 'pattern-vector'} colors={isSvgConvert ? 6 : 8} />}
          <p className="text-xs text-neutral-300">保存された結果はラスター画像です。</p>
        </div>
      ) : workspace.status === 'running' ? (
        <div className="flex h-full items-center justify-center text-sm text-white/70" role="status">生成中…</div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center px-14 text-center"><h5 className="text-[20px] font-bold leading-[25.2px] text-white">{toolTitle}</h5><p className="mt-2 text-sm leading-[21px] text-neutral-400">{toolDescription}</p></div>
      )}
    </div>
  );
  return (
    <ParityShell workflowFeature="pattern-vector-pro" className="bg-[#0b1113] text-white">
      <LightchainDesignToolFrame active={isSvgConvert ? 'svg-convert' : isProfessionalFlow ? 'pattern-vector-pro' : 'pattern-vector'} tabs={isSvgConvert ? LIGHTCHAIN_SVG_CONVERT_TABS : LIGHTCHAIN_VECTOR_TOOL_TABS} railGroup={isSvgConvert ? 3 : 2} testId={isSvgConvert ? 'svg-convert-page' : 'vector-tool-page'} navigationLocked={locked}>{vectorControls}{vectorResult}</LightchainDesignToolFrame>
    </ParityShell>
  );
}

const modelTabs = ['説明生成', '参考画像', 'モデルのセット写真'] as const;

export function LightchainModelPage() {
  const [mode, setMode] = useState('シングルタスク');
  const [activeTab, setActiveTab] = useState<string>('説明生成');
  const [prompt, setPrompt] = useState('');
  const [autoFlatlay, setAutoFlatlay] = useState(true);
  const [modelPreset, setModelPreset] = useState('Smart');
  const [posePreset, setPosePreset] = useState('正面');
  const [lightingPreset, setLightingPreset] = useState('自然光');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyArtifacts, setHistoryArtifacts] = useState<WorkspaceArtifact[]>([]);
  const { currentBrand, user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!currentBrand?.id) {
      setHistoryArtifacts([]);
      return;
    }
    setHistoryArtifacts(
      listWorkspaceArtifacts(currentBrand.id, user?.id)
        .filter((artifact) => fittingHistoryFeatureTypes.has(artifact.featureType))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    );
  }, [currentBrand?.id, user?.id]);

  const openFittingWorkspace = (entryPoint: 'material' | 'reference' | 'permission') => {
    const params = new URLSearchParams({
      source: 'lightchain-model-heavy-fallback',
      entryPoint,
      mode,
      tab: activeTab,
      modelPreset,
      posePreset,
      lightingPreset,
      autoFlatlay: String(autoFlatlay),
      selectGallery: '1',
    });
    if (prompt.trim()) params.set('prompt', prompt.trim());
    navigate(`/model?${params.toString()}#fitting-material-workbench`);
  };

  return (
    <ParityShell workflowFeature="ai-fitting">
      <div className="mx-auto max-w-[1420px] px-5 py-8 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.25em] text-cyan-200">HEAVY CHAIN / FITTING</p><h1 className="mt-3 text-3xl font-semibold">AIフィッティング</h1><p className="mt-2 text-sm text-neutral-400">服、モデル、背景を組み合わせて着用イメージを作成します。</p></div><button type="button" className={mutedButton} onClick={() => setHistoryOpen((open) => !open)}><Clock3 className="mr-2 inline h-4 w-4" />生成履歴</button></div>
        <div className="mt-7"><SegmentedTabs items={['シングルタスク', 'マルチタスク']} active={mode} onChange={setMode} /></div>
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className={`${darkPanel} p-5 sm:p-7`}>
            <div className="flex items-center justify-between"><h2 className="font-semibold">衣服画像 <span className="text-rose-300">0/4</span></h2><button type="button" className="text-xs text-cyan-200 hover:text-white" onClick={() => openFittingWorkspace('material')}>既存素材を選択</button></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">{[1, 2, 3, 4].map((slot) => <div key={slot} className="flex h-36 items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.025] text-center text-xs text-neutral-600"><ImageIcon className="mb-2 h-6 w-6" /><span>画像 {slot}</span></div>)}</div>
            <div className="mt-6 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"><div><p className="text-sm font-medium">自動平置き画像</p><p className="mt-1 text-xs text-neutral-500">入力画像から平置き表示を補助します。</p></div><button type="button" aria-pressed={autoFlatlay} onClick={() => setAutoFlatlay((value) => !value)} className={`h-6 w-11 rounded-full p-1 transition ${autoFlatlay ? 'bg-cyan-300' : 'bg-white/15'}`}><span className={`block h-4 w-4 rounded-full bg-neutral-950 transition ${autoFlatlay ? 'translate-x-5' : ''}`} /></button></div>
            <div className="mt-6"><SegmentedTabs items={modelTabs} active={activeTab} onChange={setActiveTab} /></div>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="mt-4 min-h-32 w-full rounded-xl border border-white/10 bg-black/20 p-4 text-sm outline-none focus:border-cyan-200/60" placeholder="白背景、正面立ち、自然光、EC用商品画像" />
          </section>
          <aside className="space-y-6"><section className={`${darkPanel} p-5`}><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-200" /><h2 className="font-semibold">モデル条件</h2></div><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" aria-pressed={modelPreset === 'Smart'} onClick={() => setModelPreset('Smart')} className={`rounded-xl border px-3 py-3 text-sm transition ${modelPreset === 'Smart' ? 'border-cyan-200 bg-cyan-200/10 text-white' : 'border-white/10 text-neutral-300 hover:border-cyan-200/50'}`}>Smart</button><button type="button" aria-pressed={modelPreset === '1K'} onClick={() => setModelPreset('1K')} className={`rounded-xl border px-3 py-3 text-sm transition ${modelPreset === '1K' ? 'border-cyan-200 bg-cyan-200/10 text-white' : 'border-white/10 text-neutral-300 hover:border-cyan-200/50'}`}>1K</button><button type="button" aria-pressed={posePreset === '正面'} onClick={() => setPosePreset('正面')} className={`rounded-xl border px-3 py-3 text-sm transition ${posePreset === '正面' ? 'border-cyan-200 bg-cyan-200/10 text-white' : 'border-white/10 text-neutral-300 hover:border-cyan-200/50'}`}>正面</button><button type="button" aria-pressed={lightingPreset === '自然光'} onClick={() => setLightingPreset('自然光')} className={`rounded-xl border px-3 py-3 text-sm transition ${lightingPreset === '自然光' ? 'border-cyan-200 bg-cyan-200/10 text-white' : 'border-white/10 text-neutral-300 hover:border-cyan-200/50'}`}>自然光</button></div><button type="button" className="mt-3 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200" onClick={() => openFittingWorkspace('permission')}>AIフィッティングを開く <ArrowRight className="ml-1 inline h-4 w-4" /></button></section><section className={`${darkPanel} p-5`}><h2 className="font-semibold">参考画像</h2><p className="mt-2 text-sm leading-6 text-neutral-500">顔、ポーズ、背景の参考画像を追加できます。</p><button type="button" className={`${mutedButton} mt-4`} onClick={() => openFittingWorkspace('reference')}><Plus className="mr-2 inline h-4 w-4" />追加</button></section></aside>
        </div>
        {historyOpen && (
          <section className={`${darkPanel} mt-6 p-5`} data-testid="model-persisted-history">
            <h2 className="font-semibold">生成履歴</h2>
            <PersistedHistoryPanel
              artifacts={historyArtifacts}
              emptyMessage="保存確認できたフィッティング成果物はまだありません。AI生成後に保存すると、ここから再利用できます。"
              reuseLabel="フィッティングへ再利用"
              onReuse={(artifact) => navigate(`/model?resumeJob=${encodeURIComponent(artifact.sourceJobId ?? artifact.id)}`)}
            />
          </section>
        )}
      </div>
    </ParityShell>
  );
}

const dialogueScenes = [
  ['生地パターン適用', '服装のデザインを変更せず、異なる生地を服装に適用してください', '面料套版'],
  ['線画から実写化', 'シャツを白黒線稿の服装デザイン図に変換し、白背景にしてください', '转线稿'],
  ['デザインミックス', '画像1の色と生地を変更せず、襟型を画像2の襟型に変更してください', '款式融合'],
  ['プリント修正', '画像1のアジサイ要素を参考に、四方連続のプリントパターンをデザインし、レイアウトとスタイルは画像2を参考にしてください', '印花设计'],
] as const;

const dialogueSceneCoverByTitle: Record<string, string> = {
  生地パターン適用: '/scene-assets/fabric.png',
  線画から実写化: '/scene-assets/draft.png',
  デザインミックス: '/scene-assets/multi.png',
  プリント修正: '/scene-assets/print.png',
};

const dialogueSceneReferenceAssets: Record<string, Array<{ key: string; name: string }>> = {
  生地パターン適用: [
    { key: 'fabric1.jpg', name: 'fabric1.jpg' },
    { key: 'fabric2.jpg', name: 'fabric2.jpg' },
    { key: 'fabric3.jpg', name: 'fabric3.jpg' },
    { key: 'fabric4.jpg', name: 'fabric4.jpg' },
    { key: 'fabric5.png', name: 'fabric5.png' },
  ],
  線画から実写化: [{ key: 'draft1.png', name: 'draft1.png' }],
  デザインミックス: [
    { key: 'multi1.jpg', name: 'multi1.jpg' },
    { key: 'multi2.jpg', name: 'multi2.jpg' },
  ],
  プリント修正: [
    { key: 'print1.png', name: 'print1.png' },
    { key: 'print2.jpg', name: 'print2.jpg' },
  ],
};

const DESIGN_DIALOGUE_SELECTION_ID = 'design-production-dialogue';
const EMPTY_DESIGN_DIALOGUE_REFERENCES: DesignDialogueReferenceState = {
  scopeKey: '',
  references: [],
  ready: true,
};
const designDialogueReferenceStatusLabel: Record<string, string> = {
  pending: '準備中',
  saving: '保存中',
  recovering: '保存状態を確認中',
  ready: '準備完了',
  failure: '保存に失敗',
};

type GalleryReferenceAsset = {
  id: string;
  label: string;
  src: string;
};

const asArtifactMetadata = (metadata: Json | null): Record<string, Json | undefined> => (
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, Json | undefined>
    : {}
);

const generatedImageToWorkspaceArtifact = (image: ReturnType<typeof asGeneratedImageListRow>): WorkspaceArtifact => {
  const metadata = asArtifactMetadata(image.metadata);
  const titleCandidate = [metadata.title, metadata.projectName, metadata.name]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return {
    id: image.id,
    brandId: image.brand_id,
    featureType: image.feature_type ?? 'generate-image',
    title: titleCandidate?.trim() ?? 'Untitled',
    imageUrl: image.image_url ?? '',
    prompt: image.prompt,
    createdAt: image.created_at,
    metadata: { ...metadata, remoteImageId: image.id, remoteStoragePath: image.storage_path },
    sourceJobId: image.job_id ?? undefined,
  };
};

const marketingSceneCards = [
  {
    label: 'EC',
    icon: ShoppingBag,
    prompt: 'ECサイト向けに、商品の特徴が伝わる販促ビジュアルを作成してください。',
  },
  {
    label: 'SNS',
    icon: MessageCircle,
    prompt: 'SNS向けに、ブランドの雰囲気が伝わる縦長の投稿ビジュアルを作成してください。',
  },
  {
    label: 'ブランド',
    icon: Palette,
    prompt: 'ブランドの世界観を表現するキャンペーンビジュアルを作成してください。',
  },
  {
    label: '店舗・オフライン',
    icon: Store,
    prompt: '店舗や展示会で使える、商品が見やすい販促パネルを作成してください。',
  },
  {
    label: 'ライブ配信',
    icon: Radio,
    prompt: 'ライブ配信の商品紹介で使える、視認性の高い告知ビジュアルを作成してください。',
  },
  {
    label: 'プロモーション',
    icon: Megaphone,
    prompt: '新商品のプロモーション用に、印象的なキャンペーンビジュアルを作成してください。',
  },
] as const;

const MARKETING_TUTORIAL_STORAGE_KEY = 'heavy-chain-lightchain-marketing-tutorial-dismissed-v1';

const MARKETING_TUTORIAL_STEPS = [
  { target: 'input', text: 'ここで参考画像のアップロードや、アイデア（プロンプト）の入力ができます。' },
  { target: 'send', text: '入力が終わったら、ここから送信してデザインを始めます。' },
  { target: 'scenes', text: 'おすすめのシーンを選ぶと、用途に合わせて提案します。' },
  { target: 'projects', text: '作成したプロジェクトはマイプロジェクトから再開できます。' },
] as const;
const marketingProjectStorageKey = (kind: 'pins' | 'hidden', userId: string, brandId: string) => (
  `heavy-marketing-${kind}:${encodeURIComponent(JSON.stringify([userId, brandId]))}`
);
const readStoredIds = (key: string) => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return new Set<string>(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch { return new Set<string>(); }
};
const writeStoredIds = (key: string, ids: Set<string>) => {
  try { window.localStorage.setItem(key, JSON.stringify([...ids])); } catch { /* convenience only */ }
};

/**
 * Light Chain's marketing landing surface: the prompt starts a real marketing
 * project (canvas document + assistant conversation) and マイプロジェクト lists
 * only those projects, never every generated image of the brand.
 */
export function LightchainMarketingHomePage() {
  const { currentBrand, user } = useAuthStore();
  const navigate = useNavigate();
  const userId = user?.id ?? '';
  const brandId = currentBrand?.id ?? '';
  const [prompt, setPrompt] = useState('');
  const [scene, setScene] = useState<string | null>(null);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingUnits, setRemainingUnits] = useState<number | null>(null);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ projectId: string; value: string } | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [covers, setCovers] = useState<Record<string, string>>({});
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const projectsView = useDesignConversationProjects(undefined, 'marketing');
  const references = useDialogueReferences({ userId, brandId, selectionId: 'marketing-home' });

  useEffect(() => {
    try { setTutorialStep(window.localStorage.getItem(MARKETING_TUTORIAL_STORAGE_KEY) === '1' ? 0 : 1); } catch { setTutorialStep(1); }
  }, []);
  useEffect(() => {
    if (!userId || !brandId) { setPinnedIds(new Set()); setHiddenIds(new Set()); return; }
    setPinnedIds(readStoredIds(marketingProjectStorageKey('pins', userId, brandId)));
    setHiddenIds(readStoredIds(marketingProjectStorageKey('hidden', userId, brandId)));
  }, [brandId, userId]);
  useEffect(() => {
    let cancelled = false;
    if (!brandId || !cloudflareDataPlane) { setRemainingUnits(null); return () => { cancelled = true; }; }
    void cloudflareDataPlane.getImageUsage(brandId).then((summary) => {
      if (!cancelled) setRemainingUnits(Number.isSafeInteger(summary.remainingUnits) && summary.remainingUnits >= 0 ? summary.remainingUnits : null);
    }).catch(() => { if (!cancelled) setRemainingUnits(null); });
    return () => { cancelled = true; };
  }, [brandId]);

  const projects = useMemo(() => projectsView.entries
    .filter((entry) => !hiddenIds.has(entry.projectId))
    .sort((left, right) => Number(pinnedIds.has(right.projectId)) - Number(pinnedIds.has(left.projectId))),
  [hiddenIds, pinnedIds, projectsView.entries]);
  const coverKey = JSON.stringify(projects.map((entry) => entry.coverPath ?? ''));
  useEffect(() => {
    let cancelled = false;
    const paths = (JSON.parse(coverKey) as string[]).filter(Boolean);
    if (!paths.length) return () => { cancelled = true; };
    void withSignedImageUrls(paths.map((path) => ({ storage_path: path, image_url: '' }))).then((rows) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      rows.forEach((row, index) => { if (typeof row.image_url === 'string' && row.image_url) next[paths[index]] = row.image_url; });
      setCovers(next);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [coverKey]);

  const dismissTutorial = () => {
    setTutorialStep(0);
    try { window.localStorage.setItem(MARKETING_TUTORIAL_STORAGE_KEY, '1'); } catch { /* convenience only */ }
  };
  const nextTutorial = () => { if (tutorialStep >= MARKETING_TUTORIAL_STEPS.length) dismissTutorial(); else setTutorialStep((step) => step + 1); };
  const tutorial = tutorialStep > 0 ? MARKETING_TUTORIAL_STEPS[tutorialStep - 1] : null;

  const addFiles = (files: File[]) => {
    const images = files.filter((file) => /^image\/(png|jpe?g|webp|avif)$/.test(file.type) && file.size <= 20 * 1024 * 1024);
    if (images.length !== files.length) setError('jpg、jpeg、png、webp（最大20MBまで）の画像を選択してください');
    if (images.length) void references.addFiles(images);
  };
  const send = async () => {
    const text = prompt.trim();
    if (!text || sending || !userId || !brandId) return;
    setError(null);
    let manifest;
    try { manifest = references.manifest(); }
    catch { setError('参考画像の保存が終わるまでお待ちください'); return; }
    setSending(true);
    const coordinator = createDesignEntryCoordinator({ scope: { userId, brandId }, workspace: DIALOGUE_WORKSPACES.marketing,
      assertScope: () => { const live = useAuthStore.getState(); if (live.user?.id !== userId || live.currentBrand?.id !== brandId) throw new Error('design_entry_scope_stale'); } });
    try {
      const href = await coordinator.prepare(scene ? `シーン：${scene}。${text}` : text, manifest);
      references.clear();
      navigate(href);
    } catch (cause) {
      const code = cause instanceof Error && /^[a-z0-9_:-]{1,96}$/i.test(cause.message) ? cause.message : 'design_entry_readback_failed';
      setError(`プロジェクトを作成できませんでした（${code}）`);
    } finally {
      coordinator.dispose();
      setSending(false);
    }
  };
  const togglePin = (projectId: string) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      writeStoredIds(marketingProjectStorageKey('pins', userId, brandId), next);
      return next;
    });
    setOpenProjectMenuId(null);
  };
  const hideProject = (entry: DesignConversationProject) => {
    if (!window.confirm(`「${entry.title}」を削除しますか？`)) return;
    setHiddenIds((current) => {
      const next = new Set(current).add(entry.projectId);
      writeStoredIds(marketingProjectStorageKey('hidden', userId, brandId), next);
      return next;
    });
    setOpenProjectMenuId(null);
  };
  const renameProject = async () => {
    const target = renaming;
    setRenaming(null);
    const title = target?.value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 160);
    if (!target || !title || !cloudflareDataPlane) return;
    const context = { userId, assertContext: () => { const live = useAuthStore.getState(); if (live.user?.id !== userId || live.currentBrand?.id !== brandId) throw new Error('design_entry_scope_stale'); } };
    try {
      const fresh = await getCanvasDocument(target.projectId, brandId, context);
      if (fresh.title !== title) await updateCanvasDocument({ documentId: target.projectId, brandId, title, expectedRevision: fresh.revision, snapshot: fresh.snapshot }, context);
      projectsView.retry();
    } catch {
      toast.error('名前を変更できませんでした');
    }
  };

  const tourRing = (target: string) => tutorial?.target === target ? 'relative z-20 ring-2 ring-[#0bcabc] ring-offset-4 ring-offset-[#171b1c]' : '';
  const tutorialBubble = tutorial && <div role="alertdialog" aria-label={tutorial.text} data-testid="lightchain-marketing-tutorial" className="pointer-events-auto flex items-center gap-0 text-left text-sm text-neutral-100">
    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#0bcabc] shadow-[0_0_0_5px_rgba(11,202,188,0.25)]" />
    <span className="h-px w-[38px] bg-[#0bcabc]" />
    <span className="flex h-6 items-center gap-3 whitespace-nowrap rounded-full border border-white/15 bg-[#1f2426] px-[22px] leading-6">
      <span>{tutorial.text}{tutorialStep}/{MARKETING_TUTORIAL_STEPS.length}</span>
      <button type="button" onClick={nextTutorial} data-testid="lightchain-marketing-tutorial-next" className="text-[#0bcabc] underline underline-offset-2">{tutorialStep >= MARKETING_TUTORIAL_STEPS.length ? '完了' : '次へ'}</button>
      <button type="button" onClick={dismissTutorial} data-testid="lightchain-marketing-tutorial-skip" className="text-[#0bcabc] underline underline-offset-2">スキップ</button>
    </span>
  </div>;

  return (
    <ParityShell className="relative h-full overflow-y-auto overflow-x-hidden bg-[#171b1c] pr-1 text-white" workflowFeature="marketing-home">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[170px] bg-[radial-gradient(ellipse_40%_100%_at_6%_0%,rgba(72,186,160,0.34),transparent_70%),radial-gradient(ellipse_45%_90%_at_96%_0%,rgba(74,84,214,0.42),transparent_70%),radial-gradient(ellipse_30%_70%_at_62%_0%,rgba(120,70,160,0.16),transparent_70%)]" />
      {remainingUnits !== null && <div aria-label="残りクレジット" className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-[#202527] p-2.5 text-base leading-4 text-neutral-300"><Sparkles className="h-4 w-4" />{remainingUnits.toLocaleString()}</div>}
      <div data-testid="lightchain-marketing-home" className="relative z-[2] mx-auto flex w-[1392px] max-w-full flex-col items-center gap-y-6 pt-[70px]">
        <div className="flex w-full flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3">
            <h1 className="w-full text-center text-[34px] font-medium leading-10">マーケティングワークスペースへようこそ</h1>
            <p className="w-full text-center text-base leading-6 text-neutral-400">今日は何を作りますか？リクエストを聞かせてください。一緒に始めましょう！</p>
          </div>
          <div className={`relative w-[960px] max-w-full rounded-[32px] ${tourRing('input')}`} data-tour="marketing-input">
            <input ref={uploadRef} type="file" accept=".png,.jpg,.jpeg,.avif,.webp" multiple className="hidden" aria-label="参考画像を選択" onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
            <div className="flex min-h-[216px] w-full flex-col overflow-hidden rounded-[32px] border-2 border-white/10 bg-[#25292c]">
              <div className="flex min-h-0 w-full flex-1 items-center px-2">
                <button type="button" aria-label="参考画像を追加" onClick={() => uploadRef.current?.click()} className="group relative flex h-[120px] w-[120px] shrink-0 items-center justify-center">
                  {references.references.length ? <span className="flex -space-x-8">{references.references.slice(0, 3).map((reference, index) => <span key={reference.id} className="relative block h-24 w-20 overflow-hidden rounded-xl border border-white/20 bg-[#1b2023] shadow-lg" style={{ transform: `rotate(${(index - 1) * 6}deg)` }}>
                    {references.previews[reference.id] && <img src={references.previews[reference.id]} alt={reference.name} className="h-full w-full object-cover" />}
                    {reference.status !== 'ready' && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px]">{reference.status === 'failure' ? '失敗' : '保存中'}</span>}
                  </span>)}</span>
                    : <span className="block h-24 w-20 -rotate-6 overflow-hidden rounded-xl opacity-70 transition duration-300 group-hover:rotate-0 group-hover:opacity-100"><img src="/lightchain-assets/marketing/upload-placeholder.png" alt="" className="h-full w-full object-cover" draggable={false} /></span>}
                </button>
                <div className="flex h-full min-w-0 flex-1 flex-col gap-2 overflow-hidden px-3.5 py-5">
                  <textarea value={prompt} onChange={(event) => setPrompt(event.target.value.slice(0, 4000))} maxLength={4000} aria-label="マーケティングのリクエスト"
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
                    placeholder="商品画像をアップロードして、デザインのリクエストを教えてください"
                    className="min-h-20 max-h-50 w-full flex-1 resize-none border-0 bg-transparent p-0 text-base leading-6 text-white caret-[#0bcabc] outline-none placeholder:text-neutral-500" />
                </div>
              </div>
              <div className="flex h-[72px] w-full shrink-0 items-center gap-3 p-4">
                {scene && <span className="flex h-10 items-center gap-2 rounded-xl bg-[#0bcabc]/10 px-4 text-base text-neutral-100" data-testid="marketing-selected-scene">{scene}<button type="button" aria-label={`${scene}を解除`} onClick={() => setScene(null)}><X className="h-4 w-4" /></button></span>}
                {references.references.length > 0 && <span className="text-xs text-neutral-500" role="status">{references.references.map((reference) => reference.name).join('、')}</span>}
                <div className="flex min-w-0 flex-1 items-center justify-end gap-4">
                  <span className="whitespace-nowrap text-base leading-4 text-neutral-500">{prompt.length} / 4000</span>
                  <button type="button" aria-label="送信" data-tour="marketing-send" disabled={!prompt.trim() || sending || !references.ready} onClick={() => void send()}
                    className={`flex h-10 min-w-10 items-center justify-center rounded-full bg-[#0bcabc] text-neutral-950 transition hover:bg-[linear-gradient(45deg,#61fff4,#ccb2ff)] disabled:bg-white/10 disabled:text-neutral-500 ${tourRing('send')}`}><ArrowUp className="h-6 w-6" /></button>
                </div>
              </div>
            </div>
            {(error || references.error) && <p role="alert" className="mt-2 text-sm text-red-300">{error ?? references.error}</p>}
            {tutorial?.target === 'input' && <div className="absolute left-[169px] top-[64px] z-30">{tutorialBubble}</div>}
            {tutorial?.target === 'send' && <div className="absolute right-[64px] top-[180px] z-30">{tutorialBubble}</div>}
          </div>
        </div>
        <div className="relative flex w-full flex-col items-center gap-4 overflow-hidden" aria-label="おすすめのシーン">
          <div className={`flex w-full items-center justify-center gap-4 rounded-xl ${tourRing('scenes')}`} data-tour="marketing-scenes">
            <span className="whitespace-nowrap text-base font-medium text-neutral-500">おすすめのシーン 👉</span>
            <div className="flex items-center gap-2">
              {marketingSceneCards.map((sceneCard) => (
                <button key={sceneCard.label} type="button" aria-pressed={scene === sceneCard.label} onClick={() => setScene((current) => current === sceneCard.label ? null : sceneCard.label)}
                  className={`group flex h-10 w-fit items-center gap-1 overflow-hidden rounded-xl px-4 transition-all duration-300 ${scene === sceneCard.label ? 'bg-[#0bcabc]/15' : 'bg-[#25292c] hover:bg-[#30363a]'}`}>
                  <span className="h-5 w-5 shrink-0 overflow-hidden transition-all duration-300 group-hover:w-[0.1px]"><sceneCard.icon className="h-5 w-5 text-neutral-300" /></span>
                  <span className="whitespace-nowrap text-base font-medium leading-5 text-white">{sceneCard.label}</span>
                  <span className="h-[0.1px] w-[0.1px] shrink-0 overflow-hidden transition-all duration-300 group-hover:h-5 group-hover:w-5"><ArrowRight className="h-5 w-5 -rotate-45 text-neutral-300 transition-transform duration-300 group-hover:rotate-0" /></span>
                </button>
              ))}
            </div>
          </div>
          {tutorial?.target === 'scenes' && <div className="z-30">{tutorialBubble}</div>}
        </div>
        <div className="w-full rounded-2xl p-4" data-testid="lightchain-marketing-projects">
          <h2 className="mb-4 text-xl font-normal leading-7">マイプロジェクト</h2>
          {tutorial?.target === 'projects' && <div className="relative z-30 mb-3">{tutorialBubble}</div>}
          <DesignConversationProjectStatus view={projectsView} />
          <div className={`flex flex-wrap gap-2 rounded-2xl ${tourRing('projects')}`}>
            <button type="button" onClick={() => navigate('/marketing/detail')} className="group relative h-60 w-[220px] overflow-hidden rounded-2xl bg-[#202527] text-white transition hover:bg-[#283033]" data-testid="marketing-new-file">
              <span className="flex h-full flex-col items-center justify-center">
                <span className="relative h-20 w-20 overflow-hidden rounded-2xl bg-[linear-gradient(145deg,#6fd7cf_0%,#3d6475_42%,#9964ac_100%)] shadow-[inset_8px_8px_18px_rgba(255,255,255,0.28),inset_-10px_-10px_20px_rgba(20,25,35,0.3)]"><span className="absolute inset-3 flex items-center justify-center rounded-lg border border-white/20 bg-black/10 text-[8px] font-bold tracking-[0.12em] text-white/90 shadow-inner">PROJECT</span><span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-neutral-900 shadow-md"><Plus className="h-4 w-4" /></span></span>
                <span className="mt-3 text-base">新規ファイル</span>
              </span>
            </button>
            {projects.map((entry) => {
              const cover = entry.coverPath ? covers[entry.coverPath] : undefined;
              return <article key={entry.projectId} className="group relative h-60 w-[220px] overflow-hidden rounded-2xl bg-[#202527] text-left hover:bg-[#283033]" data-testid="marketing-project-card" data-project-id={entry.projectId}>
                <Link to={entry.href} aria-label={`${entry.title}を開く`} className="absolute inset-0 flex flex-col">
                  <span className="flex h-[176px] items-center justify-center overflow-hidden bg-white/[0.04]">{cover ? <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" /> : <img src="/lightchain-assets/static/project_default_cover.png" alt="" className="h-12 w-12 object-contain" loading="lazy" />}</span>
                  <span className="block px-3 py-2"><span className="block truncate text-base">{pinnedIds.has(entry.projectId) ? '📌 ' : ''}{entry.title}</span><span className="mt-1 block truncate text-xs text-neutral-500">{formatArtifactDate(entry.updatedAt)}</span></span>
                </Link>
                {renaming?.projectId === entry.projectId && <input autoFocus aria-label="プロジェクト名" value={renaming.value} maxLength={160} onChange={(event) => setRenaming({ projectId: entry.projectId, value: event.target.value })}
                  onBlur={() => void renameProject()} onKeyDown={(event) => { if (event.key === 'Enter') void renameProject(); if (event.key === 'Escape') setRenaming(null); }}
                  className="absolute bottom-8 left-2 right-2 z-20 rounded border border-[#0bcabc] bg-[#171b1c] px-2 py-1 text-sm outline-none" />}
                <div className="absolute right-2 top-2 z-20"><button type="button" aria-label={`${entry.title}のメニュー`} aria-expanded={openProjectMenuId === entry.projectId} className="rounded-lg bg-black/45 p-2 text-neutral-200 opacity-0 transition hover:bg-black/70 focus:opacity-100 group-hover:opacity-100" onClick={(event) => { event.stopPropagation(); setOpenProjectMenuId((current) => current === entry.projectId ? null : entry.projectId); }}><MoreVertical className="h-4 w-4" /></button>
                  {openProjectMenuId === entry.projectId && <div role="menu" className="absolute right-0 top-full z-30 mt-2 min-w-40 rounded-lg border border-white/10 bg-[#202627] p-1 shadow-2xl">
                    <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={() => togglePin(entry.projectId)}>{pinnedIds.has(entry.projectId) ? 'ピン留めを解除' : 'ピン留め'}</button>
                    <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={() => { setRenaming({ projectId: entry.projectId, value: entry.title }); setOpenProjectMenuId(null); }}>名前を変更</button>
                    <button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10" onClick={() => hideProject(entry)}>削除</button>
                  </div>}
                </div>
              </article>;
            })}
          </div>
        </div>
        <section className="w-full rounded-2xl p-4" data-testid="lightchain-marketing-reference-cases">
          <h2 className="mb-4 text-xl font-normal leading-7">参考事例</h2>
          <div className="flex min-h-24 flex-col items-center justify-center text-sm text-neutral-500"><img src="/lightchain-assets/static/searchEmpty.png" alt="search empty" className="h-12 w-12 object-contain opacity-70" /><span className="mt-2">データなし</span></div>
        </section>
      </div>
    </ParityShell>
  );
}

/** Read-only conversation cards, separate from the existing generated-image artifacts. */
type DesignConversationProjectsView = {
  status: 'loading' | 'ready' | 'error';
  entries: DesignConversationProject[];
  error?: string;
  retry: () => void;
};

/** Loads verified conversation projects for the current scope; the page merges them into Light's single project grid. */
export function useDesignConversationProjects(client?: DesignProjectListClient, workspaceId: DialogueWorkspaceId = 'design'): DesignConversationProjectsView {
  const workspace = DIALOGUE_WORKSPACES[workspaceId];
  const { user, currentBrand } = useAuthStore();
  const userId = user?.id ?? '';
  const brandId = currentBrand?.id ?? '';
  const scopeKey = JSON.stringify([userId, brandId]);
  const stores = useMemo(() => createEntryDraftStore({ idb: window.indexedDB, dbName: workspace.draftDb }), [workspace.draftDb]);
  const [retryCount, setRetry] = useState(0);
  const [state, setState] = useState<{ scopeKey: string; status: 'loading' | 'ready' | 'error'; entries: DesignConversationProject[]; error?: string }>({ scopeKey: '', status: 'loading', entries: [] });
  const epochRef = useRef(0);
  useEffect(() => {
    const epoch = ++epochRef.current;
    const assertContext = () => {
      const live = useAuthStore.getState();
      if (epochRef.current !== epoch || live.user?.id !== userId || live.currentBrand?.id !== brandId) throw new Error('design_project_list_scope_stale');
    };
    setState((current) => ({ scopeKey, status: 'loading', entries: current.scopeKey === scopeKey ? current.entries : [] }));
    if (userId && brandId) {
      void listDesignConversationProjects({ scope: { userId, brandId }, drafts: stores, client, assertContext, detailPath: workspace.detailPath })
        .then((entries) => { assertContext(); setState({ scopeKey, status: 'ready', entries }); })
        .catch((error: unknown) => {
          try {
            assertContext();
            const code = error instanceof Error && /^[a-z0-9_:-]{1,96}$/i.test(error.message) ? error.message : 'design_project_list_failed';
            setState((current) => ({ scopeKey, status: 'error', entries: current.scopeKey === scopeKey ? current.entries : [], error: code }));
          } catch { /* old scope cannot publish */ }
        });
    } else setState({ scopeKey, status: 'ready', entries: [] });
    return () => { if (epochRef.current === epoch) epochRef.current += 1; };
  }, [brandId, client, retryCount, scopeKey, stores, userId, workspace.detailPath]);
  const visible = state.scopeKey === scopeKey ? state : { status: 'loading' as const, entries: [] };
  const retry = useCallback(() => setRetry((value) => value + 1), []);
  return { status: visible.status, entries: visible.entries, error: state.scopeKey === scopeKey ? state.error : undefined, retry };
}

/** Light shows no visible loader for conversation rows; only a confirmed failure is surfaced with its retry. */
export function DesignConversationProjectStatus({ view }: { view: DesignConversationProjectsView }) {
  if (view.status === 'loading') return <p role="status" className="sr-only">対話プロジェクトを確認しています。</p>;
  if (view.status !== 'error') return null;
  return <div role="alert" data-testid="design-conversation-project-error" className="mb-3 text-sm text-amber-100">
    <span>対話プロジェクトの保存状態を確認できませんでした。{view.error}</span>
    <button type="button" data-testid="design-conversation-project-retry" onClick={view.retry} className="ml-3 underline">再確認</button>
  </div>;
}

/** Same 220x240 card as a saved design project; a conversation has no cover, so Light's default cover is shown. */
export function DesignConversationProjectCard({ entry }: { entry: DesignConversationProject }) {
  return (
    <article data-design-project-origin="conversation" className="relative h-60 overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left hover:border-white/40">
      <Link to={entry.href} data-testid="design-conversation-project-card" data-project-id={entry.projectId} data-conversation-id={entry.conversationId} aria-label={`${entry.title}を開く`} className="block h-full w-full">
        <div data-design-conversation-cover="" className="flex h-[167px] w-full items-center justify-center bg-white/10">
          <img src={DESIGN_PROJECT_DEFAULT_COVER} alt="" className="h-12 w-12 object-contain" loading="lazy" />
        </div>
        <div data-design-card-title="" className="block w-full overflow-hidden text-left">
          <p data-design-card-name="" className="truncate font-medium">{entry.title}</p>
          <p data-design-card-date="" className="mt-2 truncate text-xs text-neutral-400">{formatArtifactDate(entry.updatedAt)}</p>
        </div>
      </Link>
    </article>
  );
}

export function DesignConversationProjectList({ recent = false, client }: { recent?: boolean; client?: DesignProjectListClient }) {
  const view = useDesignConversationProjects(client);
  const entries = recent ? view.entries.slice(0, 5) : view.entries;
  return <section data-testid="design-conversation-project-list" className="mt-4" aria-label="対話プロジェクト">
    <DesignConversationProjectStatus view={view} />
    <div className="grid gap-2 grid-cols-2 sm:grid-cols-5">{entries.map((entry) => <DesignConversationProjectCard key={JSON.stringify([entry.projectId, entry.conversationId])} entry={entry} />)}</div>
  </section>;
}

export function LightchainDesignProductionPage() {
  const [activeTab, setActiveTab] = useState('プロジェクトから開始');
  const [dialoguePrompt, setDialoguePrompt] = useState('');
  const [activeScene, setActiveScene] = useState('');
  const [activeAssetSlot, setActiveAssetSlot] = useState<0 | 1>(0);
  const [galleryReferenceAssets, setGalleryReferenceAssets] = useState<GalleryReferenceAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<[string | null, string | null]>([null, null]);
  const [designArtifactLoadState, setDesignArtifactLoadState] = useState<DesignProjectArtifactLoadState<DesignProjectEntry>>({ status: 'loading' });
  const [persistedDesignScopeKey, setPersistedDesignScopeKey] = useState<string | null>(null);
  const designLoadRequestTokenRef = useRef(0);
  const [projectPage, setProjectPage] = useState(1);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [designPinState, setDesignPinState] = useState<{ scopeKey: string; ids: Set<string>; hydrated: boolean }>({ scopeKey: '', ids: new Set(), hydrated: false });
  const [remainingUnits, setRemainingUnits] = useState<number | null>(null);
  const { currentBrand, user } = useAuthStore();
  const navigate = useNavigate();
  const heavyRuntime = isHeavyWorkspaceRuntime();
  const designBrandId = currentBrand?.id;
  const designUserId = user?.id;
  const designScopeKey = createDesignArtifactScopeKey(designUserId, designBrandId);
  const pinnedProjectIds = designPinState.scopeKey === designScopeKey ? designPinState.ids : new Set<string>();
  const pinsHydrated = designPinState.scopeKey === designScopeKey && designPinState.hydrated;
  const displayedDesignLoadState: DesignProjectArtifactLoadState<DesignProjectEntry> = persistedDesignScopeKey === designScopeKey
    ? designArtifactLoadState
    : { status: 'loading' };
  const displayedEntries = entriesForDesignProjectLoad(displayedDesignLoadState);
  const scopedGalleryReferenceAssets = persistedDesignScopeKey === designScopeKey ? galleryReferenceAssets : [];
  const scopedSelectedAssetIds = persistedDesignScopeKey === designScopeKey ? selectedAssetIds : [null, null];

  const startDesignArtifactLoad = useCallback((scopeKey: string, userId?: string, brandId?: string) => {
    const requestToken = ++designLoadRequestTokenRef.current;
    setPersistedDesignScopeKey(scopeKey);
    setDesignArtifactLoadState({ status: 'loading' });
    setGalleryReferenceAssets([]);
    setSelectedAssetIds([null, null]);
    setProjectPage(1);
    setOpenProjectMenuId(null);

    const liveAuth = useAuthStore.getState();
    const liveScopeKey = createDesignArtifactScopeKey(liveAuth.user?.id, liveAuth.currentBrand?.id);
    if (!userId || !brandId || !isCurrentDesignArtifactLoad(
      scopeKey,
      liveScopeKey,
      requestToken,
      designLoadRequestTokenRef.current,
    )) {
      setDesignArtifactLoadState({ status: 'loading' });
      return requestToken;
    }

    const isCurrent = () => {
      const currentAuth = useAuthStore.getState();
      return isCurrentDesignArtifactLoad(
        scopeKey,
        createDesignArtifactScopeKey(currentAuth.user?.id, currentAuth.currentBrand?.id),
        requestToken,
        designLoadRequestTokenRef.current,
      );
    };

    void runDesignProjectArtifactLoad({
      readLocalArtifacts: () => listWorkspaceArtifacts(brandId, userId)
        .filter((artifact) => designHistoryFeatureTypes.has(artifact.featureType)),
      readRemoteArtifacts: async () => {
        if (!isCurrent()) throw new Error('design_artifact_load_stale');
        if (!cloudflareDataPlane) throw new Error('remote_data_plane_unavailable');
        const remoteRows = await cloudflareDataPlane.listGeneratedImages(brandId, {
          limit: 100,
          offset: 0,
          order: 'newest',
        });
        if (!isCurrent()) throw new Error('design_artifact_load_stale');
        return remoteRows.map(asGeneratedImageListRow);
      },
      signRemoteArtifacts: (rows) => withSignedImageUrls([...rows]),
      toEntries: (localArtifacts, signedRows) => {
        const remoteArtifacts = signedRows
          .map(generatedImageToWorkspaceArtifact)
          .filter((artifact) => designHistoryFeatureTypes.has(artifact.featureType));
        return toDesignEntries(localArtifacts, remoteArtifacts);
      },
      isCurrent,
      setState: (state) => {
        if (!isCurrent()) return;
        setDesignArtifactLoadState(state);
        const entries = entriesForDesignProjectLoad(state);
        const nextReferenceAssets = entries
          .map(({ artifact }) => artifact)
          .filter((artifact) => Boolean(artifact.imageUrl))
          .slice(0, 12)
          .map((artifact) => ({ id: artifact.id, label: artifact.title, src: artifact.imageUrl }));
        setGalleryReferenceAssets(nextReferenceAssets);
        setSelectedAssetIds([nextReferenceAssets[0]?.id ?? null, nextReferenceAssets[1]?.id ?? null]);
      },
    });
    return requestToken;
  }, []);

  const selectedAssets = useMemo(
    () => scopedSelectedAssetIds.map((id) => scopedGalleryReferenceAssets.find((asset) => asset.id === id) ?? {
      id: '',
      label: 'ライブラリーから素材を選択',
      src: '',
    }) as [GalleryReferenceAsset, GalleryReferenceAsset],
    [scopedGalleryReferenceAssets, scopedSelectedAssetIds],
  );
  const resolvedSelectedAssets = useMemo(
    () => scopedSelectedAssetIds
      .map((id) => scopedGalleryReferenceAssets.find((asset) => asset.id === id))
      .filter((asset): asset is GalleryReferenceAsset => Boolean(asset)),
    [scopedGalleryReferenceAssets, scopedSelectedAssetIds],
  );
  const trimmedDialoguePrompt = dialoguePrompt.trim();
  const hasUnresolvableSelectedAssetId = scopedSelectedAssetIds.some(
    (id) => Boolean(id) && !scopedGalleryReferenceAssets.some((asset) => asset.id === id),
  );
  const hasTwoReferenceAssets = resolvedSelectedAssets.length === 2;
  const canOpenProposal = Boolean(trimmedDialoguePrompt) && hasTwoReferenceAssets;
  const referenceRequirementMessage = scopedGalleryReferenceAssets.length === 0
    ? '参考素材を2件選択してください。素材がない場合はライブラリーから追加してください。'
    : hasUnresolvableSelectedAssetId
      ? '選択中の参考素材をライブラリーから確認できません。参考素材を2件選択し直してください。'
      : resolvedSelectedAssets.length === 0
        ? '参考素材を2件選択してください。'
        : '参考素材をあと1件選択してください。';
  const setSelectedAssets = (update: (current: [GalleryReferenceAsset, GalleryReferenceAsset]) => [GalleryReferenceAsset, GalleryReferenceAsset]) => {
    const next = update(selectedAssets);
    setSelectedAssetIds([next[0].id || null, next[1].id || null]);
  };

  useEffect(() => {
    const requestToken = startDesignArtifactLoad(designScopeKey, designUserId, designBrandId);
    return () => {
      if (designLoadRequestTokenRef.current === requestToken) designLoadRequestTokenRef.current += 1;
    };
  }, [designBrandId, designScopeKey, designUserId, startDesignArtifactLoad]);

  useEffect(() => {
    let cancelled = false;
    const brandId = currentBrand?.id;
    if (!brandId || !cloudflareDataPlane) {
      setRemainingUnits(null);
      return () => { cancelled = true; };
    }
    void cloudflareDataPlane.getImageUsage(brandId).then((summary) => {
      if (cancelled) return;
      setRemainingUnits(Number.isSafeInteger(summary.remainingUnits) && summary.remainingUnits >= 0 ? summary.remainingUnits : null);
    }).catch(() => {
      if (!cancelled) setRemainingUnits(null);
    });
    return () => { cancelled = true; };
  }, [currentBrand?.id]);

  const displayDesignEntries = designUserId && designBrandId ? displayedEntries : [];
  const conversationProjects = useDesignConversationProjects();
  const visibleConversationProjects = designUserId && designBrandId ? conversationProjects.entries : [];
  // Light renders conversation and saved design projects in one paged "マイプロジェクト" grid.
  const projectGridItems = mergeDesignProjectGridItems(visibleConversationProjects, displayDesignEntries);
  const page = paginate(projectGridItems, projectPage, DESIGN_PROJECT_PAGE_SIZE);
  const visibleProjectItems = page.items;

  useEffect(() => {
    if (projectPage !== page.page) setProjectPage(page.page);
  }, [page.page, projectPage]);

  useEffect(() => {
    if (!designUserId || !designBrandId) {
      setDesignPinState({ scopeKey: designScopeKey, ids: new Set(), hydrated: false });
      return;
    }
    let ids = new Set<string>();
    try {
      const saved = window.localStorage.getItem(designProjectPinsStorageKey(designUserId, designBrandId));
      const parsed = saved ? JSON.parse(saved) : [];
      ids = new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
    } catch {
      ids = new Set();
    }
    const liveAuth = useAuthStore.getState();
    const liveScopeKey = createDesignArtifactScopeKey(liveAuth.user?.id, liveAuth.currentBrand?.id);
    if (isCurrentDesignArtifactScope(designScopeKey, liveScopeKey)) {
      setDesignPinState({ scopeKey: designScopeKey, ids, hydrated: true });
    }
  }, [designBrandId, designScopeKey, designUserId]);

  useEffect(() => {
    if (!designUserId || !designBrandId || !pinsHydrated || designPinState.scopeKey !== designScopeKey) return;
    const liveAuth = useAuthStore.getState();
    const liveScopeKey = createDesignArtifactScopeKey(liveAuth.user?.id, liveAuth.currentBrand?.id);
    if (!isCurrentDesignArtifactScope(designScopeKey, liveScopeKey)) return;
    try {
      window.localStorage.setItem(designProjectPinsStorageKey(designUserId, designBrandId), JSON.stringify([...designPinState.ids]));
    } catch {
      // Pin display remains usable for this view when browser storage is unavailable.
    }
  }, [designBrandId, designPinState, designScopeKey, designUserId, pinsHydrated]);
  const toggleDesignProjectPin = (artifactId: string) => {
    const liveAuth = useAuthStore.getState();
    const liveScopeKey = createDesignArtifactScopeKey(liveAuth.user?.id, liveAuth.currentBrand?.id);
    if (!designUserId || !designBrandId || !isCurrentDesignArtifactScope(designScopeKey, liveScopeKey)) return;
    setDesignPinState((current) => {
      const nextIds = new Set(current.scopeKey === designScopeKey ? current.ids : []);
      if (nextIds.has(artifactId)) nextIds.delete(artifactId);
      else nextIds.add(artifactId);
      return {
        scopeKey: designScopeKey,
        ids: nextIds,
        hydrated: current.scopeKey === designScopeKey && current.hydrated,
      };
    });
  };
  const saveDesignArtifactToLibrary = async (artifact: WorkspaceArtifact) => {
    if (!currentBrand?.id) return toast.error('ブランドが選択されていないため、ライブラリーへ保存できません');
    const scopeKey = designScopeKey;
    const result = await saveWorkspaceArtifactBestEffort({
      ...artifact,
      id: undefined,
      brandId: currentBrand.id,
      scopeId: user?.id,
      metadata: { ...artifact.metadata, librarySource: 'design-production-card-menu', libraryGroup: 'マイライブラリー', copiedFromArtifactId: artifact.id },
    });
    const liveAuth = useAuthStore.getState();
    if (!isCurrentDesignArtifactScope(
      scopeKey,
      createDesignArtifactScopeKey(liveAuth.user?.id, liveAuth.currentBrand?.id),
    )) return;
    if (!result.localPersisted) return toast.error('ライブラリー保存の確認に失敗しました');
    if (cloudflareDataPlane && !result.remote) {
      toast.error('リモート保存の確認に失敗しました。再送せず、同じ保存依頼を照合してください');
      return;
    }
    setDesignArtifactLoadState((current) => {
      const scopedCurrent = persistedDesignScopeKey === scopeKey ? entriesForDesignProjectLoad(current) : [];
      const nextEntries = toDesignEntries(
        [...scopedCurrent.filter((entry) => entry.origin === 'local').map((entry) => entry.artifact), result.artifact],
        scopedCurrent.filter((entry) => entry.origin === 'remote').map((entry) => entry.artifact),
      );
      return current.status === 'error'
        ? { ...current, localEntries: toDesignEntries([...current.localEntries.map((entry) => entry.artifact), result.artifact], []).filter((entry) => entry.origin === 'local') }
        : nextEntries.length > 0 ? { status: 'ready', entries: nextEntries } : { status: 'empty' };
    });
    if (result.artifact.imageUrl) {
      setGalleryReferenceAssets((current) => [{
        id: result.artifact.id,
        label: result.artifact.title,
        src: result.artifact.imageUrl,
      }, ...current.filter((asset) => asset.id !== result.artifact.id)].slice(0, 12));
    }
    toast.success('アセットライブラリーに保存しました');
  };
  const deleteDesignArtifact = async (artifact: WorkspaceArtifact) => {
    const brandId = designBrandId;
    const userId = designUserId;
    const scopeKey = designScopeKey;
    if (!brandId || !window.confirm(`「${artifact.title}」を削除しますか？`)) return;
    const remoteImageId = typeof artifact.metadata.remoteImageId === 'string'
      ? artifact.metadata.remoteImageId
      : null;
    const isRemoteArtifact = Boolean(
      cloudflareDataPlane && remoteImageId && !artifact.id.startsWith('local-'),
    );
    if (isRemoteArtifact) {
      try {
        await cloudflareDataPlane!.deleteGeneratedImage(remoteImageId!);
      } catch {
        const liveAuth = useAuthStore.getState();
        if (isCurrentDesignArtifactScope(scopeKey, createDesignArtifactScopeKey(liveAuth.user?.id, liveAuth.currentBrand?.id))) {
          toast.error('削除に失敗しました');
        }
        return;
      }
    }
    const result = deleteWorkspaceArtifactsPersisted(brandId, [artifact.id], userId);
    if (!result.ok) return toast.error('成果物を削除できませんでした');
    const liveAuth = useAuthStore.getState();
    if (!isCurrentDesignArtifactScope(scopeKey, createDesignArtifactScopeKey(liveAuth.user?.id, liveAuth.currentBrand?.id))) return;
    setDesignArtifactLoadState((current) => {
      const currentEntries = entriesForDesignProjectLoad(current).filter((entry) => entry.artifact.id !== artifact.id);
      if (current.status === 'error') {
        const localEntries = current.localEntries.filter((entry) => entry.artifact.id !== artifact.id);
        return { ...current, localEntries };
      }
      return currentEntries.length > 0 ? { status: 'ready', entries: currentEntries } : { status: 'empty' };
    });
    setGalleryReferenceAssets((current) => current.filter((asset) => asset.id !== artifact.id));
    setOpenProjectMenuId(null);
    toast.success(isRemoteArtifact ? '画像を削除しました' : 'ローカル成果物を削除しました');
  };
  const openProposal = () => {
    if (!canOpenProposal) return;
    const referenceLabels = resolvedSelectedAssets.map((asset) => asset.label).join('、');
    navigate(buildGenerationIntentHref({
      feature: 'design-gacha',
      prompt: `${trimmedDialoguePrompt}\n参考素材: ${referenceLabels}`,
      sourceWorkspace: 'design-production',
      workflowVersion: 'design-production-brief-local-v1',
      sourceLabel: workspaceSourceConfig['design-production'].label,
      sourceResumePath: workspaceSourceConfig['design-production'].resumePath,
      sourceMode: 'local-workflow-intake',
    }));
  };
  const renderDesignProjectEntry = (entry: DesignProjectEntry) => {
    const { artifact } = entry;
    const href = designEntryHref(entry);
    return (
      <DesignRecentProjectEntryCard
        key={artifact.id}
        entry={entry}
        userId={designUserId}
        brandId={designBrandId}
        heavyRuntime={heavyRuntime}
        pinned={pinnedProjectIds.has(artifact.id)}
        menuOpen={openProjectMenuId === artifact.id}
        onOpen={() => { if (href) navigate(href); }}
        onToggleMenu={() => setOpenProjectMenuId((current) => current === artifact.id ? null : artifact.id)}
        onTogglePin={() => { toggleDesignProjectPin(artifact.id); setOpenProjectMenuId(null); }}
        onSaveToLibrary={() => { void saveDesignArtifactToLibrary(artifact); setOpenProjectMenuId(null); }}
        onDelete={() => { void deleteDesignArtifact(artifact); }}
      />
    );
  };
  if (activeTab === '対話から開始') {
    return <LightchainDialogueParityPanel
      onProjectStart={() => setActiveTab('プロジェクトから開始')}
      remainingUnits={remainingUnits}
      recentProjectScopeKey={designScopeKey}
      recentProjectEntries={displayDesignEntries}
      recentConversationProjects={conversationProjects}
      recentProjectLoadState={displayedDesignLoadState}
      onRetryRecentProjects={() => { startDesignArtifactLoad(designScopeKey, designUserId, designBrandId); }}
      renderRecentProjectEntry={renderDesignProjectEntry}
    />;
  }
  return (
    <ParityShell className="design-production-parity relative overflow-hidden bg-[#171b1c] text-white" workflowFeature="print-design-project">
      <div aria-hidden="true" className="design-production-hero-glow pointer-events-none absolute inset-x-0 top-0" />
      {remainingUnits !== null && <div aria-label="残りクレジット" className="absolute right-5 top-4 flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs text-white"><Sparkles className="h-3.5 w-3.5" />{remainingUnits.toLocaleString()}</div>}
      <div data-testid="design-production-page" className="relative z-10 mx-auto max-w-[1157px] px-6 py-7 lg:px-0"><div className="text-center"><h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">デザインワークスペースへようこそ</h1><p className="mt-3 text-sm text-neutral-400">アイデアを形にし、制作をスムーズに</p></div>
        <div role="tablist" data-design-tablist="" className="mx-auto mt-8 flex w-fit rounded-2xl border border-white/10 bg-white/10 p-1">{['プロジェクトから開始', '対話から開始'].map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`h-10 ${tab === 'プロジェクトから開始' ? 'w-[210px]' : 'w-[146px]'} rounded-xl px-0 py-1 text-lg font-medium transition ${activeTab === tab ? 'shadow-sm' : 'text-neutral-400 hover:text-white'}`}>{tab}</button>)}</div>
        {activeTab === '対話から開始' ? (
          <div role="tabpanel" aria-label="対話から開始">
            <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8">
              <div className="flex items-center gap-3"><WandSparkles className="h-5 w-5" /><h2 className="font-semibold">対話から開始</h2></div>
              <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400">既存のGallery素材を組み合わせ、作りたい変更内容を対話で指定します。</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {dialogueScenes.map(([title, prompt, iconLabel]) => <button key={title} type="button" onClick={() => { setActiveScene(title); setDialoguePrompt(prompt); }} className={`rounded-2xl border bg-white/5 p-4 text-left transition hover:border-white/40 ${activeScene === title ? 'border-white ring-1 ring-white' : 'border-white/10'}`}><div className="flex h-20 items-center justify-center rounded-xl bg-white/10 text-xs font-semibold text-neutral-400">{iconLabel}</div><p className="mt-3 text-sm font-semibold">{title}</p><span className="mt-2 block text-xs text-neutral-400">使ってみる</span></button>)}
              </div>
              {activeScene && <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-semibold text-neutral-400">Gallery素材を組み合わせる</p><div className="mt-3 grid gap-3 sm:grid-cols-3">{scopedGalleryReferenceAssets.map((asset) => <button key={asset.id} type="button" onClick={() => setSelectedAssets((current) => { const next: [GalleryReferenceAsset, GalleryReferenceAsset] = [...current]; next[activeAssetSlot] = asset; return next; })} className={`overflow-hidden rounded-xl border text-left transition ${selectedAssets[activeAssetSlot].id === asset.id ? 'border-white ring-1 ring-white' : 'border-white/10 hover:border-white/40'}`}><div className="h-24 bg-white/10"><img src={asset.src} alt={asset.label} className="h-full w-full object-cover" loading="lazy" /></div><div className="px-3 py-2 text-xs text-neutral-300">{asset.label}</div></button>)}</div><div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-400"><button type="button" onClick={() => setActiveAssetSlot(0)} className={`rounded-full border px-3 py-1.5 ${activeAssetSlot === 0 ? 'border-white text-white' : 'border-white/10'}`}>画像1を選択</button><button type="button" onClick={() => setActiveAssetSlot(1)} className={`rounded-full border px-3 py-1.5 ${activeAssetSlot === 1 ? 'border-white text-white' : 'border-white/10'}`}>画像2を選択</button></div></div>}
              {activeScene && <div className="mt-5 grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[180px_180px_minmax(0,1fr)]"><div className="overflow-hidden rounded-xl bg-white/10"><img src={selectedAssets[0].src} alt="画像1" className="h-28 w-full object-cover" loading="lazy" /><p className="px-2 py-1 text-xs text-neutral-400">画像1: {selectedAssets[0].label}</p></div><div className="overflow-hidden rounded-xl bg-white/10"><img src={selectedAssets[1].src} alt="画像2" className="h-28 w-full object-cover" loading="lazy" /><p className="px-2 py-1 text-xs text-neutral-400">画像2: {selectedAssets[1].label}</p></div><div><textarea value={dialoguePrompt} onChange={(event) => setDialoguePrompt(event.target.value)} className="min-h-28 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus:border-white/60" aria-label="商品画像をアップロードして、デザインのリクエストを教えてください" /><div className="mt-2 text-right text-xs text-neutral-500">{dialoguePrompt.length} / 4000</div></div></div>}
              <div className="mt-5 max-w-2xl"><div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2"><Sparkles className="h-4 w-4 text-neutral-400" /><input value={dialoguePrompt} onChange={(event) => setDialoguePrompt(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-500" placeholder="作りたいデザインを入力してください" /><button type="button" className="rounded-lg bg-white px-4 py-2 text-sm text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canOpenProposal} onClick={openProposal}>提案を見る</button></div>{(!trimmedDialoguePrompt || !hasTwoReferenceAssets) && <div id="design-production-proposal-requirements" className="mt-2 space-y-1 text-xs text-neutral-400" aria-live="polite">{!trimmedDialoguePrompt && <p>依頼文を入力してください。</p>}{!hasTwoReferenceAssets && <div className="flex flex-wrap items-center gap-2"><p>{referenceRequirementMessage}</p>{scopedGalleryReferenceAssets.length === 0 && <button type="button" className="rounded-lg border border-white/20 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:border-white/50" onClick={() => navigate('/asset-center')}>ライブラリーを開く</button>}</div>}</div>}</div>
            </section>
          </div>
        ) : (
          <div role="tabpanel" aria-label="プロジェクトから開始">
            <section className="mt-6 grid gap-2 grid-cols-2 sm:grid-cols-5" aria-label="新規ファイル">
              <DesignNewFileCard />
              <CreationCard icon={<Shirt />} title="インスピレーション" actionLabel="デザインプロジェクトを新規作成" onClick={() => navigate('/creator')} />
              <CreationCard icon={<Palette />} title="ブリン卜修正" actionLabel="プリントプロジェクトを新規作成" onClick={() => navigate('/printing')} />
              <CreationCard icon={<Layers />} title="生地イメージ" actionLabel="生地プロジェクトを新規作成" onClick={() => navigate('/tools/fabric')} />
              <CreationCard icon={<FileText />} title="企画提案書" actionLabel="企画提案書を新規作成" onClick={() => navigate('/agent')} />
            </section>
            <section className="mt-12" data-testid="design-production-persisted-projects">
              <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">マイプロジェクト</h2></div>
              {displayedDesignLoadState.status === 'loading' && <p className="mt-4 rounded-2xl border border-white/10 px-5 py-8 text-center text-sm text-neutral-400" role="status" data-testid="design-project-loading">デザイン成果物を読み込んでいます。</p>}
              {displayedDesignLoadState.status === 'error' && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/30 bg-amber-200/5 px-4 py-3 text-sm text-amber-100" role="alert" data-testid="design-project-remote-error"><span>リモートのデザイン成果物を読み込めませんでした。{displayedDesignLoadState.remoteError}</span><button type="button" className="rounded-lg border border-amber-100/30 px-3 py-1.5 text-xs font-semibold hover:bg-white/10" onClick={() => { startDesignArtifactLoad(designScopeKey, designUserId, designBrandId); }} data-testid="design-project-retry">再試行</button></div>}
              <DesignConversationProjectStatus view={conversationProjects} />
              {projectGridItems.length === 0
                ? displayedDesignLoadState.status === 'empty' && conversationProjects.status === 'ready'
                  ? <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-5 py-12 text-center text-sm text-neutral-400" data-testid="design-project-empty">保存確認できたデザイン成果物はまだありません。生成結果を保存すると、ここに表示されます。</div>
                  : null
                : <><div className="mt-4 grid gap-4 grid-cols-2 sm:grid-cols-5" data-testid="design-production-project-grid">{visibleProjectItems.map((item) => item.kind === 'conversation'
                  ? <DesignConversationProjectCard key={JSON.stringify([item.entry.projectId, item.entry.conversationId])} entry={item.entry} />
                  : renderDesignProjectEntry(item.entry))}</div><div className="mt-5 flex flex-wrap items-center justify-end gap-2" data-testid="design-production-pagination" aria-label="マイプロジェクトページング"><button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-300 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setProjectPage(Math.max(1, page.page - 1))} disabled={page.page === 1} aria-label="前のページ"><span role="img" aria-label="left"><ChevronLeft className="h-3 w-3" /></span></button>{Array.from({ length: page.pageCount }, (_, index) => <button key={index} type="button" aria-current={index + 1 === page.page ? 'page' : undefined} onClick={() => setProjectPage(index + 1)} className={`px-1.5 text-xs ${index + 1 === page.page ? 'text-white' : 'text-neutral-500'}`}>{index + 1}</button>)}<button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-300 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setProjectPage(Math.min(page.pageCount, page.page + 1))} disabled={page.page === page.pageCount} aria-label="次のページ"><span role="img" aria-label="right"><ChevronRight className="h-3 w-3" /></span></button></div></>}
            </section>
          </div>
        )}
      </div>
    </ParityShell>
  );
}

export function LightchainDialogueParityPanel({
  onProjectStart,
  remainingUnits,
  referenceClient: referenceClientOverride,
  entryClient,
  recentProjectScopeKey: recentProjectScopeKeyProp,
  recentProjectEntries = [],
  recentProjectLoadState,
  onRetryRecentProjects,
  renderRecentProjectEntry,
  recentConversationProjects,
}: {
  onProjectStart: () => void;
  remainingUnits: number | null;
  /** Narrow adapter seam used by rendered behavioral tests; production uses the configured data plane. */
  referenceClient?: DesignDialogueReferenceClient;
  entryClient?: DesignEntryClient;
  /** Canonical parent-load snapshot. A captured scope key prevents old tenant cards from flashing during auth changes. */
  recentProjectScopeKey?: string;
  recentProjectEntries?: readonly DesignProjectEntry[];
  recentProjectLoadState?: DesignProjectArtifactLoadState<DesignProjectEntry>;
  onRetryRecentProjects?: () => void;
  renderRecentProjectEntry?: (entry: DesignProjectEntry) => ReactNode;
  /** Parent-owned conversation rows, merged ahead of saved designs in Light's single recent grid. */
  recentConversationProjects?: DesignConversationProjectsView;
}) {
  type ReferenceController = ReturnType<typeof createDesignDialogueReferenceController>;
  const { currentBrand, user } = useAuthStore();
  const navigate = useNavigate();
  const userId = user?.id ?? null;
  const currentBrandId = currentBrand?.id ?? null;
  const scopeIdentity = userId && currentBrandId
    ? JSON.stringify([userId, currentBrandId, DESIGN_DIALOGUE_SELECTION_ID])
    : '';
  const client = referenceClientOverride ?? cloudflareDataPlane;
  const [promptState, setPromptState] = useState({ scopeIdentity: '', value: '' });
  const [selectedSceneState, setSelectedSceneState] = useState<{ scopeIdentity: string; value: string | null }>({ scopeIdentity: '', value: null });
  const [referenceState, setReferenceState] = useState<{ scopeIdentity: string; value: DesignDialogueReferenceState }>({
    scopeIdentity: '',
    value: EMPTY_DESIGN_DIALOGUE_REFERENCES,
  });
  const [referenceActionError, setReferenceActionError] = useState<{ scopeIdentity: string; message: string } | null>(null);
  const [thumbnailState, setThumbnailState] = useState<{ scopeIdentity: string; urls: Record<string, string> }>({ scopeIdentity: '', urls: {} });
  const scopeGenerationRef = useRef(0);
  const entryCoordinatorRef = useRef<ReturnType<typeof createDesignEntryCoordinator> | null>(null);
  const [entrySending, setEntrySending] = useState(false);
  const previewRequestGenerationRef = useRef(0);
  const referenceControllerRef = useRef<{ scopeIdentity: string; generation: number; controller: ReferenceController } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const retryUploadIdRef = useRef<string | null>(null);
  const localFilesByReferenceIdRef = useRef(new Map<string, DesignDialogueReferenceFile>());
  const localPreviewUrlsRef = useRef(new Map<string, string>());
  const prompt = promptState.scopeIdentity === scopeIdentity ? promptState.value : '';
  const selectedScene = selectedSceneState.scopeIdentity === scopeIdentity ? selectedSceneState.value : null;
  const visibleReferenceSnapshot = referenceState.scopeIdentity === scopeIdentity
    ? referenceState.value
    : EMPTY_DESIGN_DIALOGUE_REFERENCES;
  const visibleReferences = visibleReferenceSnapshot.references;
  const thumbnailUrls = thumbnailState.scopeIdentity === scopeIdentity ? thumbnailState.urls : {};
  const visibleActionError = referenceActionError?.scopeIdentity === scopeIdentity ? referenceActionError.message : null;
  const recentScopeIsCurrent = Boolean(
    recentProjectScopeKeyProp !== undefined
      && userId
      && currentBrandId
      && recentProjectScopeKeyProp === createDesignArtifactScopeKey(userId, currentBrandId),
  );
  const visibleRecentProjectLoadState = recentProjectScopeKeyProp === undefined || !userId || !currentBrandId
    ? { status: 'empty' as const }
    : recentScopeIsCurrent
      ? recentProjectLoadState ?? { status: 'loading' as const }
      : { status: 'loading' as const };
  const visibleRecentItems = recentScopeIsCurrent
    ? mergeDesignProjectGridItems(recentConversationProjects?.entries ?? [], recentProjectEntries).slice(0, 5)
    : [];

  const reportReferenceError = useCallback((error: unknown) => {
    const code = error instanceof Error && /^[a-z0-9_:-]{1,96}$/i.test(error.message)
      ? error.message
      : 'design_dialogue_reference_failed';
    setReferenceActionError({ scopeIdentity, message: `参照画像を保存できませんでした（${code}）` });
  }, [scopeIdentity]);

  const getCurrentController = useCallback(() => {
    const current = referenceControllerRef.current;
    if (!current || !scopeIdentity || current.scopeIdentity !== scopeIdentity || current.generation !== scopeGenerationRef.current) return null;
    const liveAuth = useAuthStore.getState();
    if (liveAuth.user?.id !== userId || liveAuth.currentBrand?.id !== currentBrandId) return null;
    return current.controller;
  }, [currentBrandId, scopeIdentity, userId]);

  useEffect(() => {
    entryCoordinatorRef.current?.dispose();
    entryCoordinatorRef.current = null;
    setEntrySending(false);
    referenceControllerRef.current?.controller.dispose();
    referenceControllerRef.current = null;
    scopeGenerationRef.current += 1;
    const generation = scopeGenerationRef.current;
    if (!userId || !currentBrandId || !client) {
      setReferenceState({ scopeIdentity, value: EMPTY_DESIGN_DIALOGUE_REFERENCES });
      return () => {
        if (scopeGenerationRef.current === generation) scopeGenerationRef.current += 1;
      };
    }

    entryCoordinatorRef.current = createDesignEntryCoordinator({
      scope: { userId, brandId: currentBrandId },
      client: entryClient,
      assertScope: () => {
        const liveAuth = useAuthStore.getState();
        if (scopeGenerationRef.current !== generation || liveAuth.user?.id !== userId || liveAuth.currentBrand?.id !== currentBrandId) {
          throw new Error('design_entry_scope_stale');
        }
      },
    });
    const scope = {
      userId,
      brandId: currentBrandId,
      selectionId: DESIGN_DIALOGUE_SELECTION_ID,
      generation,
    };
    let controllerInstance: ReferenceController | null = null;
    const controller = createDesignDialogueReferenceController({
      client,
      storage: window.localStorage,
      loadSceneAsset: createSameOriginDesignSceneAssetLoader(),
      getCurrentScope: () => {
        if (scopeGenerationRef.current !== generation) return null;
        const liveAuth = useAuthStore.getState();
        if (liveAuth.user?.id !== userId || liveAuth.currentBrand?.id !== currentBrandId) return null;
        return scope;
      },
      publish: (snapshot) => {
        if (scopeGenerationRef.current !== generation) return;
        const liveAuth = useAuthStore.getState();
        if (liveAuth.user?.id !== userId || liveAuth.currentBrand?.id !== currentBrandId) return;
        if (referenceControllerRef.current?.controller !== controllerInstance) return;
        setReferenceState({ scopeIdentity, value: snapshot });
      },
    });
    controllerInstance = controller;
    referenceControllerRef.current = { scopeIdentity, generation, controller };
    try {
      setReferenceState({ scopeIdentity, value: controller.activate(scope) });
      void controller.restore().catch((error: unknown) => {
        if (scopeGenerationRef.current === generation) reportReferenceError(error);
      });
    } catch (error) {
      reportReferenceError(error);
    }

    return () => {
      if (scopeGenerationRef.current === generation) scopeGenerationRef.current += 1;
      entryCoordinatorRef.current?.dispose();
      entryCoordinatorRef.current = null;
      controller.dispose();
      if (referenceControllerRef.current?.controller === controller) referenceControllerRef.current = null;
      previewRequestGenerationRef.current += 1;
      for (const url of localPreviewUrlsRef.current.values()) URL.revokeObjectURL(url);
      localPreviewUrlsRef.current.clear();
      localFilesByReferenceIdRef.current.clear();
    };
  }, [client, currentBrandId, entryClient, reportReferenceError, scopeIdentity, userId]);

  useEffect(() => {
    const requestGeneration = ++previewRequestGenerationRef.current;
    let cancelled = false;
    const urls: Record<string, string> = {};
    const needsSignedPreview: Array<{ id: string; storagePath: string }> = [];
    for (const reference of visibleReferences) {
      const sceneUrl = reference.sceneAssetKey
        ? `/scene-assets/${encodeURIComponent(reference.sceneAssetKey)}`
        : null;
      const localUrl = localPreviewUrlsRef.current.get(reference.id);
      if (sceneUrl || localUrl) {
        urls[reference.id] = sceneUrl ?? localUrl!;
      } else if (reference.kind === 'upload' && reference.status === 'ready' && reference.receipt?.storagePath) {
        needsSignedPreview.push({ id: reference.id, storagePath: reference.receipt.storagePath });
      }
    }
    setThumbnailState({ scopeIdentity, urls });
    const isCurrent = () => {
      if (cancelled || previewRequestGenerationRef.current !== requestGeneration) return false;
      const liveAuth = useAuthStore.getState();
      return Boolean(scopeIdentity && liveAuth.user?.id === userId && liveAuth.currentBrand?.id === currentBrandId);
    };
    if (needsSignedPreview.length > 0) {
      void withSignedImageUrls(needsSignedPreview.map(({ storagePath }) => ({ storage_path: storagePath, image_url: '' })))
        .then((resolved) => {
          if (!isCurrent()) return;
          const next = { ...urls };
          for (const [index, reference] of needsSignedPreview.entries()) {
            const url = resolved[index]?.image_url;
            if (typeof url === 'string' && url) next[reference.id] = url;
          }
          setThumbnailState({ scopeIdentity, urls: next });
        })
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [currentBrandId, scopeIdentity, userId, visibleReferenceSnapshot]);

  const replaceLocalFilePreview = (referenceId: string, file: DesignDialogueReferenceFile) => {
    const previous = localPreviewUrlsRef.current.get(referenceId);
    if (previous) URL.revokeObjectURL(previous);
    localFilesByReferenceIdRef.current.set(referenceId, file);
    localPreviewUrlsRef.current.set(referenceId, URL.createObjectURL(file));
  };

  const handleUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []) as DesignDialogueReferenceFile[];
    input.value = '';
    input.multiple = true;
    const controller = getCurrentController();
    if (!controller) {
      if (files.length > 0) reportReferenceError(new Error('design_dialogue_reference_scope_missing'));
      return;
    }

    const retryId = retryUploadIdRef.current;
    retryUploadIdRef.current = null;
    if (retryId) {
      const replacement = files[0];
      if (!replacement) return;
      try {
        replaceLocalFilePreview(retryId, replacement);
        const retry = controller.retry(retryId, replacement);
        setReferenceState({ scopeIdentity, value: controller.snapshot() });
        await retry;
      } catch (error) {
        reportReferenceError(error);
      }
      return;
    }

    const operations: Promise<unknown>[] = [];
    for (const file of files) {
      try {
        const position = controller.snapshot().references.length;
        const operation = controller.addFile(file);
        const added = controller.snapshot().references[position];
        if (added?.kind === 'upload' && added.name === file.name) {
          replaceLocalFilePreview(added.id, file);
          setReferenceState({ scopeIdentity, value: controller.snapshot() });
        }
        operations.push(operation.catch((error: unknown) => { reportReferenceError(error); }));
      } catch (error) {
        reportReferenceError(error);
      }
    }
    await Promise.all(operations);
  };

  const removeReference = (referenceId: string) => {
    try {
      const controller = getCurrentController();
      if (!controller) throw new Error('design_dialogue_reference_scope_stale');
      controller.remove(referenceId);
      const localUrl = localPreviewUrlsRef.current.get(referenceId);
      if (localUrl) URL.revokeObjectURL(localUrl);
      localPreviewUrlsRef.current.delete(referenceId);
      localFilesByReferenceIdRef.current.delete(referenceId);
      setReferenceState({ scopeIdentity, value: controller.snapshot() });
      setReferenceActionError(null);
    } catch (error) {
      reportReferenceError(error);
    }
  };

  const retryReference = (reference: DesignDialogueReferenceState['references'][number]) => {
    const controller = getCurrentController();
    if (!controller) {
      reportReferenceError(new Error('design_dialogue_reference_scope_stale'));
      return;
    }
    if (reference.kind === 'upload' && !localFilesByReferenceIdRef.current.has(reference.id)) {
      retryUploadIdRef.current = reference.id;
      if (uploadInputRef.current) {
        uploadInputRef.current.multiple = false;
        uploadInputRef.current.click();
      }
      return;
    }
    void controller.retry(reference.id).catch(reportReferenceError);
  };

  const selectScene = (title: string, scenePrompt: string) => {
    setSelectedSceneState({ scopeIdentity, value: title });
    setPromptState({ scopeIdentity, value: scenePrompt });
    setReferenceActionError(null);
    const controller = getCurrentController();
    if (!controller) {
      reportReferenceError(new Error('design_dialogue_reference_scope_missing'));
      return;
    }
    for (const reference of controller.snapshot().references) {
      controller.remove(reference.id);
      const localUrl = localPreviewUrlsRef.current.get(reference.id);
      if (localUrl) URL.revokeObjectURL(localUrl);
      localPreviewUrlsRef.current.delete(reference.id);
      localFilesByReferenceIdRef.current.delete(reference.id);
    }
    setReferenceState({ scopeIdentity, value: controller.snapshot() });
    const assets = dialogueSceneReferenceAssets[title] ?? [];
    const operations = assets.map(({ key, name }) => controller.addSceneAsset(key, name)
      .catch((error: unknown) => { reportReferenceError(error); }));
    void Promise.all(operations);
  };

  const sendPrompt = async () => {
    if (!prompt.trim()) return;
    const generation = scopeGenerationRef.current;
    try {
      const controller = getCurrentController();
      const coordinator = entryCoordinatorRef.current;
      if (!controller || !coordinator) throw new Error('design_entry_scope_missing');
      const manifest = controller.prepareForSend();
      setEntrySending(true);
      const href = await coordinator.prepare(prompt, manifest);
      const liveAuth = useAuthStore.getState();
      if (scopeGenerationRef.current !== generation || liveAuth.user?.id !== userId || liveAuth.currentBrand?.id !== currentBrandId) return;
      navigate(href);
    } catch (error) {
      if (scopeGenerationRef.current === generation) {
        const code = error instanceof Error && /^[a-z0-9_:-]{1,96}$/i.test(error.message) ? error.message : 'design_entry_readback_failed';
        setReferenceActionError({ scopeIdentity, message: `デザインの保存状態を確認できませんでした（${code}）` });
      }
    } finally {
      if (scopeGenerationRef.current === generation) setEntrySending(false);
    }
  };

  const referencesReady = visibleReferences.every((reference) => reference.status === 'ready' && Boolean(reference.receipt));
  return (
    <ParityShell className="design-production-parity bg-[#171b1c] relative overflow-hidden text-white" workflowFeature="print-design-project">
      <div aria-hidden="true" className="design-production-hero-glow pointer-events-none absolute inset-x-0 top-0" />
      {remainingUnits !== null && <div aria-label="残りクレジット" className="absolute right-5 top-4 flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs text-white"><Sparkles className="h-3.5 w-3.5" />{remainingUnits.toLocaleString()}</div>}
      <div data-testid="design-production-page" className="relative z-10 mx-auto max-w-[1157px] px-6 py-7 lg:px-0">
        <div className="text-center">
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">デザインワークスペースへようこそ</h1>
          <p className="mt-3 text-sm text-neutral-400">アイデアを形にし、制作をスムーズに</p>
        </div>
        <div role="tablist" data-design-tablist="" className="mx-auto mt-8 flex w-fit rounded-2xl border border-white/10 bg-white/10 p-1">
          <button type="button" role="tab" aria-selected={false} onClick={onProjectStart} className="h-10 w-[210px] rounded-xl px-0 py-1 text-lg font-medium text-neutral-400 hover:text-white">プロジェクトから開始</button>
          <button type="button" role="tab" aria-selected={true} className="h-10 w-[146px] rounded-xl px-0 py-1 text-lg font-medium shadow-sm">対話から開始</button>
        </div>
        <div role="tabpanel" aria-label="対話から開始" data-testid="design-dialogue-tabpanel" className="relative left-1/2 mt-6 w-[960px] -translate-x-1/2">
          <section data-design-dialogue-editor="" data-testid="design-dialogue-editor" aria-label="対話エディター">
            <img data-design-dialogue-upload-illustration="" src="/scene-assets/upload-placeholder.png" alt="" aria-hidden="true" />
            <button data-design-dialogue-upload-trigger="" type="button" aria-label="参考画像をアップロード" onClick={() => uploadInputRef.current?.click()} />
            <input
              ref={uploadInputRef}
              data-testid="design-dialogue-file-input"
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              multiple
              aria-label="参考画像ファイル"
              onChange={(event) => { void handleUploadChange(event); }}
            />
            <div data-design-dialogue-references="" data-testid="design-dialogue-references" aria-label="選択した参考画像">
              {visibleReferences.map((reference) => (
                <div key={reference.id} data-design-dialogue-reference="" data-testid="design-dialogue-reference-chip" data-reference-id={reference.id}>
                  {thumbnailUrls[reference.id]
                    ? <img data-design-dialogue-reference-thumbnail="" src={thumbnailUrls[reference.id]} alt="" />
                    : <span data-design-dialogue-reference-thumbnail-placeholder="" aria-hidden="true"><ImageIcon className="h-4 w-4" /></span>}
                  <span data-design-dialogue-reference-name="" title={reference.name}>{reference.name}</span>
                  <span data-design-dialogue-reference-status="" aria-live="polite">{designDialogueReferenceStatusLabel[reference.status] ?? reference.status}</span>
                  {reference.status === 'failure' && <button type="button" data-testid="design-dialogue-reference-retry" aria-label={`${reference.name}を再試行`} onClick={() => retryReference(reference)}>再試行</button>}
                  <button type="button" data-testid="design-dialogue-reference-remove" aria-label={`${reference.name}を削除`} onClick={() => removeReference(reference.id)}><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <textarea
              data-design-dialogue-prompt=""
              data-testid="design-dialogue-prompt"
              data-has-references={visibleReferences.length > 0 ? 'true' : 'false'}
              aria-label="商品画像をアップロードして、デザインのリクエストを教えてください"
              value={prompt}
              onChange={(event) => setPromptState({ scopeIdentity, value: event.target.value })}
              maxLength={4000}
              placeholder="商品画像をアップロードして、デザインのリクエストを教えてください"
            />
            {visibleActionError && <span data-design-dialogue-error="" data-testid="design-dialogue-error" role="alert">{visibleActionError}</span>}
            <span data-design-dialogue-counter="" data-testid="design-dialogue-counter" aria-live="polite">{prompt.length} / 4000</span>
            <button data-design-dialogue-send="" data-testid="design-dialogue-send" type="button" disabled={!prompt.trim() || !referencesReady || entrySending} aria-label="送信" onClick={sendPrompt}><ArrowRight aria-hidden="true" /></button>
          </section>
          <p className="mt-[45px] text-sm text-neutral-400">下からデザインシーンを選択してお試しください <span aria-hidden="true">↘</span></p>
          <div className="mt-3 grid w-[960px] grid-cols-4 gap-2" aria-label="デザインシーン" data-testid="design-dialogue-scenes">
            {dialogueScenes.map(([title, scenePrompt]) => (
              <button key={title} data-testid={`design-dialogue-scene-${title}`} type="button" aria-label={`使ってみる ${title}`} aria-pressed={selectedScene === title} onClick={() => selectScene(title, scenePrompt)} className={`group relative h-[120px] w-[234px] overflow-hidden rounded-2xl border text-left transition hover:border-white/40 ${selectedScene === title ? 'border-white ring-1 ring-white' : 'border-white/10'}`}>
                <img data-design-dialogue-scene-cover="" src={dialogueSceneCoverByTitle[title]} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover transition-all duration-200 group-hover:blur-[8px]" loading="lazy" />
                <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
                <span className="absolute inset-x-3 bottom-2 flex items-end justify-between gap-2 text-left"><span><span className="block text-[10px] leading-4 text-white/80 opacity-0 transition-opacity group-hover:opacity-100">使ってみる</span><span className="block truncate text-base font-medium leading-5 text-white">{title}</span></span><ArrowRight aria-hidden="true" className="mb-0.5 h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" /></span>
              </button>
            ))}
          </div>
          <section className="design-dialogue-recent-projects mt-10 flex flex-col gap-4" data-testid="design-production-recent-projects">
            <div className="flex h-8 items-center">
              <h2 className="flex-1 text-lg font-medium leading-7">最近のプロジェクト</h2>
              <button type="button" onClick={onProjectStart} className="flex h-8 w-[108px] shrink-0 items-center justify-end gap-0.5 rounded-lg py-1 pl-3 pr-2 text-neutral-300 hover:bg-white/10" data-testid="design-dialogue-recent-projects-all">
                <span className="whitespace-nowrap text-sm font-medium">すべて表示</span><ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {visibleRecentProjectLoadState.status === 'loading' && <p className="rounded-2xl border border-white/10 px-5 py-8 text-center text-sm text-neutral-400" role="status" data-testid="design-dialogue-recent-projects-loading">デザイン成果物を読み込んでいます。</p>}
            {visibleRecentProjectLoadState.status === 'error' && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/30 bg-amber-200/5 px-4 py-3 text-sm text-amber-100" role="alert" data-testid="design-dialogue-recent-projects-error"><span>リモートのデザイン成果物を読み込めませんでした。{visibleRecentProjectLoadState.remoteError}</span><button type="button" className="rounded-lg border border-amber-100/30 px-3 py-1.5 text-xs font-semibold hover:bg-white/10" onClick={onRetryRecentProjects} data-testid="design-dialogue-recent-projects-retry">再試行</button></div>}
            {visibleRecentProjectLoadState.status === 'empty' && visibleRecentItems.length === 0 && (recentConversationProjects?.status ?? 'ready') === 'ready' && <div className="rounded-2xl border border-dashed border-white/10 px-5 py-8 text-center text-sm text-neutral-400" data-testid="design-dialogue-recent-projects-empty">保存確認できたデザイン成果物はまだありません。</div>}
            {recentConversationProjects && <DesignConversationProjectStatus view={recentConversationProjects} />}
            <div className="grid" data-testid="design-dialogue-recent-project-grid" aria-label="最近のプロジェクト">
              <button type="button" className="flex h-60 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/5 text-neutral-300 transition hover:border-white/30 hover:bg-white/10" onClick={onProjectStart} data-testid="design-dialogue-new-file">
                <Plus className="h-6 w-6" /><span className="mt-2 text-base font-medium">新規ファイル</span>
              </button>
              {visibleRecentItems.map((item) => item.kind === 'conversation'
                ? <DesignConversationProjectCard key={JSON.stringify([item.entry.projectId, item.entry.conversationId])} entry={item.entry} />
                : renderRecentProjectEntry?.(item.entry))}
            </div>
          </section>
          <section className="mt-10 min-h-[calc(100vh-60px)] w-full" data-testid="design-production-reference-cases"><h2 className="mb-4 text-lg font-medium leading-7">参考事例</h2><div className="flex min-h-[70vh] flex-col items-center justify-center gap-2 text-sm text-neutral-500"><div className="flex min-h-[70vh] w-full items-center justify-center rounded-2xl border border-dashed border-white/10">データなし</div></div></section>
        </div>
      </div>
    </ParityShell>
  );
}

export function FileCardIcon({ icon, title }: { icon: ReactNode; title: string; description?: string }) {
  return <div className="flex flex-col items-center text-center"><div className="flex h-12 w-12 items-center justify-center text-white">{icon}</div><h2 className="mt-4 text-sm font-semibold">{title}</h2></div>;
}

export function DesignNewFileCard() {
  return (
    <div data-design-creation-card="" className="relative flex min-h-[160px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/5 p-5 text-center">
      <div data-creation-card-content="">
        <div data-creation-card-icon=""><Plus className="h-6 w-6" /></div>
        <span data-creation-card-label="">新規ファイル</span>
      </div>
    </div>
  );
}

export function CreationCard({
  icon,
  title,
  actionLabel,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return <DesignCreationCard icon={icon} title={title} actionLabel={actionLabel} onClick={onClick} />;
}

const libraryGroups = ['マイライブラリー', '履歴アップロード', '生成履歴', 'ウェアデザインラボ生成結果', '2026AW', '新規格', 'ノイズバリュー用ホリゾンカラー', 'ライブラリー'] as const;

export function LightchainAssetCenterPage() {
  const [activeGroup, setActiveGroup] = useState<string>('マイライブラリー');
  const [filter, setFilter] = useState('画像／動画');
  const [query, setQuery] = useState('');
  const [persistedArtifacts, setPersistedArtifacts] = useState<WorkspaceArtifact[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<WorkspaceArtifact | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { currentBrand, user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!currentBrand?.id) {
      setPersistedArtifacts([]);
      return;
    }
    setPersistedArtifacts(listWorkspaceArtifacts(currentBrand.id, user?.id));
  }, [currentBrand?.id, user?.id]);

  const assets = useMemo(() => {
    const seeded: Array<{
      id: string;
      title: string;
      imageUrl: string;
      featureType: string;
      persisted: boolean;
      favorite: boolean;
    }> = [];
    const matchingArtifacts = persistedArtifacts
      .filter((artifact) => activeGroup !== 'ウェアデザインラボ生成結果' || /wear|design|detail/i.test(artifact.featureType));
    const combined = [
      ...matchingArtifacts.map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        imageUrl: artifact.imageUrl,
        featureType: artifact.featureType,
        persisted: true,
        favorite: artifact.metadata.favorite === true || artifact.metadata.isFavorite === true,
      })),
      ...seeded,
    ];
    const normalizedQuery = query.trim().toLowerCase();
    return combined.filter((asset) => (
      (!normalizedQuery || `${asset.title} ${asset.featureType}`.toLowerCase().includes(normalizedQuery))
      && (filter !== 'お気に入り' || asset.favorite)
    ));
  }, [activeGroup, filter, persistedArtifacts, query]);

  const toggleSelectedAsset = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkCopy = () => {
    const firstId = [...selectedIds][0];
    if (firstId) navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(firstId)}`);
  };

  const handleBulkDownload = async () => {
    const selected = persistedArtifacts.filter((artifact) => selectedIds.has(artifact.id) && artifact.imageUrl);
    await Promise.all(selected.map((artifact) => downloadValidatedImage(artifact.imageUrl, `${artifact.title || artifact.id}.png`, 'library_bulk_download')));
  };

  const handleBulkDelete = () => {
    if (!currentBrand?.id || selectedIds.size === 0) return;
    if (!window.confirm(`${selectedIds.size}件の素材を削除しますか？`)) return;
    const result = deleteWorkspaceArtifactsPersisted(currentBrand.id, [...selectedIds], user?.id);
    if (!result.ok) return;
    setPersistedArtifacts(listWorkspaceArtifacts(currentBrand.id, user?.id));
    setSelectedIds(new Set());
    setSelectMode(false);
  };


  return <ParityShell><div className="mx-auto flex max-w-[1480px] gap-6 px-5 py-8 sm:px-8 lg:px-10"><aside className={`${darkPanel} hidden w-64 shrink-0 p-3 lg:block`}><div className="px-3 py-3 text-xs font-semibold tracking-[0.2em] text-neutral-400">LIBRARY</div>{libraryGroups.map((group) => <button key={group} type="button" onClick={() => { setActiveGroup(group); setSelectedAsset(null); }} className={`flex w-full items-center rounded-xl px-3 py-3 text-left text-sm transition ${activeGroup === group ? 'bg-white text-neutral-950' : 'text-neutral-400 hover:bg-white/[0.06] hover:text-white'}`}><FolderOpen className="mr-2 h-4 w-4" />{group}</button>)}</aside><main className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.25em] text-cyan-200">HEAVY CHAIN / LIBRARY</p><h1 className="mt-3 text-3xl font-semibold">{activeGroup}</h1><p className="mt-2 text-sm text-neutral-500">生成済みの成果物は、次のCanvas作業へ同じ系譜で引き継げます。</p></div><div className="flex gap-2"><button type="button" className={`${mutedButton} opacity-60`} disabled title="素材の登録は各ワークベンチから行います"><Upload className="mr-2 inline h-4 w-4" />アップロード</button><button type="button" className={`${mutedButton} opacity-60`} disabled title="グループ管理はβ版で準備中"><Plus className="mr-2 inline h-4 w-4" />新規グループ作成</button></div></div><div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4"><div className="flex gap-2"><button type="button" className={`rounded-lg px-3 py-2 text-sm ${filter === '画像／動画' ? 'bg-white text-neutral-950' : 'text-neutral-400'}`} onClick={() => setFilter('画像／動画')}>画像／動画</button><button type="button" className={`rounded-lg px-3 py-2 text-sm ${filter === 'お気に入り' ? 'bg-white text-neutral-950' : 'text-neutral-400'}`} onClick={() => setFilter('お気に入り')}>お気に入り</button></div><label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-neutral-400"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-40 bg-transparent outline-none" placeholder="検索" aria-label="ライブラリー検索" /></label></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-neutral-400">選択済み ： {selectedIds.size} / {assets.length}</span>{selectMode ? <div className="flex flex-wrap gap-2"><button type="button" className={`${mutedButton} disabled:opacity-40`} disabled={selectedIds.size === 0} onClick={handleBulkCopy}>キャンバスをコピー</button><button type="button" className={`${mutedButton} disabled:opacity-40`} disabled={selectedIds.size === 0} onClick={() => void handleBulkDownload()}>ダウンロード</button><button type="button" className={`${mutedButton} disabled:opacity-40`} disabled={selectedIds.size === 0} onClick={handleBulkDelete}><Trash2 className="mr-2 inline h-4 w-4" />削除</button><button type="button" className={mutedButton} onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}>一括操作を閉じる</button></div> : <button type="button" className={mutedButton} onClick={() => setSelectMode(true)}>一括操作</button>}</div>{selectMode && <button type="button" className="mt-2 text-sm text-neutral-300 underline" onClick={() => setSelectedIds(new Set(assets.filter((asset) => asset.persisted).map((asset) => asset.id)))}>全選択</button>}{assets.length === 0 ? <div className="mt-10 flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-center"><Grid2X2 className="h-8 w-8 text-neutral-600" /><h2 className="mt-4 font-semibold">まだ素材がありません</h2><p className="mt-2 text-sm text-neutral-500">このグループに保存された生成結果はありません。</p></div> : <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{assets.map((asset) => <article key={asset.id} className={`overflow-hidden rounded-2xl border bg-[#151a1c] ${selectedAsset?.id === asset.id ? 'border-cyan-200 ring-1 ring-cyan-200/50' : 'border-white/10'}`}>{selectMode && <button type="button" className="w-full border-b border-white/10 px-3 py-2 text-left text-xs text-neutral-300 disabled:opacity-40" disabled={!asset.persisted} onClick={() => toggleSelectedAsset(asset.id)} aria-pressed={selectedIds.has(asset.id)}>{selectedIds.has(asset.id) ? "✓ 選択中" : "選択"}</button>}<button type="button" className="flex h-44 w-full items-center justify-center bg-[radial-gradient(circle_at_35%_35%,rgba(103,232,249,0.22),transparent_24%),linear-gradient(135deg,#263438,#111719)]" onClick={() => asset.persisted && setSelectedAsset(persistedArtifacts.find((candidate) => candidate.id === asset.id) ?? null)} aria-label={`${asset.title}を選択`}>{asset.imageUrl ? <img src={asset.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageIcon className="h-10 w-10 text-cyan-100/60" />}</button><div className="p-4"><p className="truncate text-sm font-medium">{asset.title}</p><p className="mt-1 truncate text-xs text-neutral-500">{asset.featureType}</p><div className="mt-3 flex gap-2"><button type="button" className="flex-1 rounded-lg border border-white/10 px-2 py-2 text-xs text-neutral-400 hover:text-white disabled:opacity-40" disabled={!asset.persisted} onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(asset.id)}`)}>ボードにコピー</button><button type="button" className="rounded-lg border border-white/10 px-2 py-2 text-xs text-neutral-400 hover:text-white disabled:opacity-40" disabled={!asset.persisted} onClick={() => setSelectedAsset(persistedArtifacts.find((candidate) => candidate.id === asset.id) ?? null)}>詳細</button></div></div></article>)}</div>}{selectedAsset && <aside className="mt-6 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-5" aria-live="polite"><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.2em] text-cyan-200">SELECTED ASSET</p><h2 className="mt-2 font-semibold">{selectedAsset.title}</h2></div><button type="button" className="text-sm text-neutral-400 hover:text-white" onClick={() => setSelectedAsset(null)}>閉じる</button></div><p className="mt-3 text-sm text-neutral-400">{selectedAsset.prompt || '保存済み成果物'}</p><button type="button" className="mt-4 rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-neutral-950" onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(selectedAsset.id)}`)}>Canvasへ送る</button></aside>}</main></div></ParityShell>;
}

// Self-hosted copies of Light's two reference-case covers (デザイン要素融合 / ディテール変更).
const orientedDesignReferenceImages = [
  '/lightchain-assets/oriented-design/reference-1.webp',
  '/lightchain-assets/oriented-design/reference-2.webp',
] as const;

function orientedDesignLabHref(
  location: { search: string; hash: string },
  pathname: string,
  index?: { key: 'project' | 'reference'; value: number },
) {
  const params = new URLSearchParams(location.search);
  if (!params.has('workspaceFeature')) params.set('workspaceFeature', 'wear-design-lab');
  if (index) params.set(index.key, String(index.value));
  return `${pathname}?${params.toString()}${location.hash}`;
}

export function LightchainOrientedDesignPage() {
  const navigate = useNavigate(),location=useLocation();
  const explicitFeature=new URLSearchParams(location.search).get('workspaceFeature');
  const libraryArtifactId = new URLSearchParams(location.search).get('libraryArtifactId');
  const workspace=useCanonicalImageWorkspace('wear-design-lab',{identityConflict:explicitFeature!==null&&explicitFeature!=='wear-design-lab'});
  const { projects } = useFeatureProjects('wear-design-lab');
  const navigateToDetail = (index?: { key: 'project' | 'reference'; value: number }) => {
    if (explicitFeature !== null && explicitFeature !== 'wear-design-lab') return;
    navigate(orientedDesignLabHref(location, '/flow/orientedDesign/detail', index));
  };
  // A saved project reopens its own job: the previous job's candidate and card indexes do not carry over.
  const openProject = (savedJobId: string) => {
    if (explicitFeature !== null && explicitFeature !== 'wear-design-lab') return;
    const params = new URLSearchParams(location.search);
    for (const key of ['candidate', 'project', 'reference']) params.delete(key);
    params.set('resumeJob', savedJobId);
    navigate(orientedDesignLabHref({ search: `?${params.toString()}`, hash: location.hash }, '/flow/orientedDesign/detail'));
  };
  const canContinueLibrary = Boolean(
    libraryArtifactId &&
    !workspace.jobId &&
    !workspace.pendingId &&
    workspace.status === 'ready' &&
    workspace.error === null &&
    workspace.originalInputsAvailable &&
    workspace.slots.primary?.sourceImageId === libraryArtifactId
  );

  return (
    <ParityShell workflowFeature="wear-design-lab" className="oriented-design-parity">
      <div className="oriented-design-content">
        <h6 className="oriented-design-title">ウェアデザインラボ</h6>
        {workspace.jobId&&<main className="mb-6 rounded-xl border border-white/10 bg-[#202426] p-4" data-testid="oriented-design-resume"
          data-resume-job={workspace.result?.jobId??''} data-resume-state={workspace.status} data-resume-feature={workspace.toolId} data-resume-inputs={String(workspace.originalInputsAvailable)}>
          {workspace.result&&<img src={workspace.result.imageUrl} alt="保存されたウェア画像" className="h-40 w-full object-contain" />}
          {workspace.status==='loading'&&<p role="status">保存された画像を取得しています。</p>}
          {workspace.error&&<p role="alert">{workspace.error}</p>}
          {workspace.result&&<button type="button" className="mt-3 rounded-lg bg-cyan-700 px-4 py-2" onClick={()=>navigate(workspace.continueHref)}>編集を続ける</button>}
        </main>}
        {canContinueLibrary && <section className="mb-6 rounded-xl border border-white/10 bg-[#202426] p-4" aria-label="Libraryの元画像">
          <button type="button" className="rounded-lg bg-cyan-700 px-4 py-2" data-testid="lightchain-wear-library-continue" onClick={() => navigate(workspace.continueHref)}>Libraryの元画像で続ける</button>
        </section>}
        <section>
          <div className="oriented-design-card-grid">
            <div className="oriented-design-new-card" onClick={() => navigateToDetail()}>
              <div className="oriented-design-new-card-inner">
                <img className="oriented-design-project-mark-image" src="/lightchain-oriented-design-icon.svg" alt="" aria-hidden="true" />
                <svg className="oriented-design-project-mark" width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">
                  <defs>
                    <clipPath id="oriented-design-clip-1"><path d={" M0,0 C0,0 44,0 44,0 C44,0 44,58.5 44,58.5 C44,58.5 0,58.5 0,58.5 C0,58.5 0,0 0,0 C0,0 0,0 0,0z"} /></clipPath>
                    <clipPath id="oriented-design-clip-2"><path d={" M0,0 C0,0 58.5,0 58.5,0 C58.5,0 58.5,65.5 58.5,65.5 C58.5,65.5 0,65.5 0,65.5 C0,65.5 0,0 0,0 C0,0 0,0 0,0z"} /></clipPath>
                    <clipPath id="oriented-design-clip-3"><path d={" M0,0 C0,0 40.5,0 40.5,0 C40.5,0 40.5,40.5 40.5,40.5 C40.5,40.5 0,40.5 0,40.5 C0,40.5 0,0 0,0 C0,0 0,0 0,0z"} /></clipPath>
                    <clipPath id="oriented-design-clip-4"><path d={" M0,0 C0,0 68,0 68,0 C68,0 68,41 68,41 C68,41 0,41 0,41 C0,41 0,0 0,0 C0,0 0,0 0,0z"} /></clipPath>
                    <clipPath id="oriented-design-clip-5"><path d={" M0,0 C0,0 12,0 12,0 C12,0 12,12 12,12 C12,12 0,12 0,12 C0,12 0,0 0,0 C0,0 0,0 0,0z"} /></clipPath>
                  </defs>
                  <g transform="matrix(1,0,0,1,6.25,18.25)"><path d={" M0,9.910714149475098 C0,4.440000057220459 4.44705867767334,0 9.926470756530762,0 C9.926470756530762,0 57.57352828979492,0 57.57352828979492,0 C63.052940368652344,0 67.5,4.440000057220459 67.5,9.910714149475098 C67.5,9.910714149475098 67.5,45.58928680419922 67.5,45.58928680419922 C67.5,51.060001373291016 63.052940368652344,55.5 57.57352828979492,55.5 C57.57352828979492,55.5 9.926470756530762,55.5 9.926470756530762,55.5 C4.44705867767334,55.5 0,51.060001373291016 0,45.58928680419922 C0,45.58928680419922 0,9.910714149475098 0,9.910714149475098 C0,9.910714149475098 0,9.910714149475098 0,9.910714149475098z"} fill="rgb(47,50,51)" /></g>
                  <g clipPath="url(#oriented-design-clip-1)" transform="matrix(0.5,0,0,0.5,9,9)"><image width="88px" height="117px" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFgAAAB1CAYAAADKpybcAAAACXBIWXMAABYlAAAWJQFJUiTwAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAChbSURBVHgB5X1NjyRJcp1ZZO1idOraP6Cp+QVcAQuBx+adWrZ00RyHggToxtUv2N1/MLzxtkMdqDkOdBAWumyDEghBFw1/AbNvuk01IAiN2a4whbu998w8uyprhsISEpmY6cqMjHA3f2727PlHRLr9PX+9fPXy1uzd7c17u9v3h7s86ne7+cfzbex3YXbn7rcWdht5wtfH/3+ze/zH0w9Pr19/9d/O9rd8uf1/+Hr56vfvfvDtdhvbt7e+D7DshZv/aLf4eLMDqAOwA6gDrPj4AM73AGzmx6GjzUer69Dxf8z/9Io6zCOfb3H609e//v5A/z8B8KvDy94dXrZ9+3D7/rTfbQ9xu9v2sR1eFbYdgO13BzR3A5kDxDvikeDthmZMXIRVoG3uB5gx/87D+OA4TsRjNWmeNP7OOvYYV5zf++mf/9V/+quv7Xu8fmcAvzq8bPx99/793bbvd7adXhz2/uiw9OM4ALTt8LI4APTj/fC62dg0aWBxNGo2LkEgoNv8bGj4eLMfJ/qWxxO0rH/8GWBux3c8r8p3j+a2BHf83TzBjh0Fopy8xu7tIf74v/zn//6VfcfX9wJ4gPatPdzGw+FRFrebb3cPD/ZiuzmA2veD07ZPjr92NPiOgLk8J2sbh30GqSc48wSfnkTvmghHEKsEKBuZ4KDxQUercPeg/+KIwPE8T8Vm58HEjcenZezcqh3efvy3bfb2vZ3+4Lt68lWA//APf/LyqOaPDjNfHbDcjYbv8hSCYSItOWGGKmClFxwlwD326Vk+weAZ8qIJyOYJeD82ywGi2QFpiOFM996BgA5GkT0QHtOGnRESbrO+1qAqs9Vt7IGw/Xz64T/6J6+/en1vz7xuHgX21QHsg//8COOXCM5AmxRyQZYa324Zmocj5Hd7NRIYGCGcXtjSSF5LX/VEAF7D3p9nb9PL3AkcPXCbruzj+31+JLjy/wSw8XB20cbg8RZes7wE3Sc7lyM0r7bt7v237/7kePNLe+a1XR746U9/8vMt/DcDXERyNmYYOrguGzy8LEGY4ZUA8NgksnEJzp+YDUvHuePa7eT7uGrbwITj3FOC6ZZUMDt1AmmjU3f2wiabDNwbBLc6w+EU0z6f18AvWKacY7w/rp/cA+cZ1wwb04HRIeO78RnOfHz+mX2H10IRP331k58fLPOLgVPMFiXn1dnN2/AZIVpJ+/h/gJdcmSl6vYTZG+9bMuFrl7ekl2daM6b/BLI5HU8K0iaTI1w5P++lJMykHMjJlHONIqz1QlJNdMSOfjvZH7z+6r++tisvUcRP/8U//flhyi+YM0K5xiYtsMJqIPJwAZGghE2PiyFttpRNxdQM6w2Eepxz2jyKMdIzM59BQOXFs/GhTg5GloM0pgJAEYaIYqJIPLbqR7ItwoedvmUkhIvIkA+S2OksQRWyP/gfHaW9fhbgKancfiEnwZcDh6EBY9bl3hwxG8D0mtnLl/yT3xsPwu7ZD2arFkVID5OzX31jJwa4FpXOsNeFI1K2mRCPyuF87BcCAXMDXzqT6Owom5TLspljkFzzvIyyw8lgB8vM8uLOnnmlB9/4r9SVbPQImVHJaZIehkDDgIM/970EhMPSaTRstdKj2TzrvBfZF94iHq52lE1Hntw7O8MYohIHAR18grwzeEWW4d6lMk3a+0HmljZAGSZsp5OX4Ejod1SffF6UiIN39hzArz79/Tt/7y/DK82XBMweFE2yF08bbZo9O77YYxl82uTxCSU6h/2ONpNisrKteoQdh+GT2DK9OmMF0TDrz55qQiwDxaMGLjbhSiukiykVM3Ri0hmgXpRMRqPyyAyVcPL5rT0HsD/c/OxwFTV9GTZGNdjIdUXyTYwPby" /></g>
                  <g clipPath="url(#oriented-design-clip-2)" transform="matrix(0.49969542026519775,-0.017449747771024704,0.017449747771024704,0.49969542026519775,12.874879837036133,7.0400390625)"><image width="117px" height="131px" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHUAAACDCAYAAACzz1S4AAAACXBIWXMAABYlAAAWJQFJUiTwAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAACi1SURBVHgB7X3dsmXVdd4Y6zQy8Q3NE3CUF+D4CfrYV65UqujItkxRJLQccCjbJY4kQEjG6tNJVRAg3KQqF6lUqpoKKNZNgnwT2jdu8gTkDdw8gZBBf9B7Ds85x/eNMdbu05KQ6T96T+iz9157/cw5vzm+8Y0x51pbZVfuyvLo2af3TT+5ZCIPS/+je8vf6mbvwg9++N+uquzKXVce/cMnD1uzt83kNLdZ/6Ci/7An9/3enuzKXVX++A+eeqYD+oP+9n4hll6GvZ5u0g52oN5F5ctfevJ8R/G7/NxRFO1lwuqv490Dp2RX7ory5S/9ycUO6FH/Z6qL2oRUtFkbeI7N4+MEdgfqHV7Onj06fZ9+OPznIbd1QMf/k3bdOEnBHVjTDxbZlTu2DIV7n350pUN4ZsDVhjW6WU6jHLY5/jW3UrddkQ92lnqHlgHoJ/LxlUWWfdrhcJvk2WGrk4bNylEqrYO6s9Q7sDz2R08dbPST9zqIDwWxunnKNFFsHJsc0mGlALf72B2od1j58h/86RMfb9oVXZYZg5JqXRyJ46cevxDb8dq/n1gvulzdgXoHlRGydDV7qVvo6QhXJtMKjHS+cepdfAP2cauF5e586h1SvvyHfzpi0PMTJDIpcJtKaMF2HSGNqn8/TNazD02BusnVHah3QPnjP/oPI4d7DlgBUyOetuw59ap/p26QQB5qOETUsrPU21pmDHrqZ1e6xR2IpdRxb7lMkJZFNQTuhHYZZKuiKZZ02ZPWmstjkfd3oN6m8uijfZbFfn6lm9Y+XGUmcvG+i56RMRr+U1ub5ji/DfUrTsWeZQLKi+3U7+0ojz321EFH6EoH6aGZsl0cp2VZZPrOuW2+d+PryhbCSHN/dZDnd4tbbv+32N7Op97q8vjjf3G46dNmvf8fYFAymReW5r7R950WuOzBEnsaYpnZoyDjebiHr5GIuGY7n3pLy2OPf/WZjdlFU7e5meabwEWqiOwr/ur7SE6vQSzpNGSrKWCPZ03u012a8FaVx/7dV8+r6fGQrXvDV04BO4TQgpSfmypkLSx4fjJ+MxVUP4lR7nrx/Z3B9f72hQ92Kx9uQfm3575+sQueI9oZCRQgrgqS9lLUsFvzNEPj58CYIsl8jMj//pv/upt6u5nl3NHx6c0//uOl3tdnlbMo3dCGthFgIx6oeIzS3y22eB5X6S8VOaXBsC0TTcQV77WY5w7Um1TOPf3Cvn30k7d7dz/sQoYxi6vb6QyBswLYyaILlZLHpON9ExfFXdnGvOk0XvOchLtVG28+GO92oN6EMgEdSXld9ke0YaDcLm6cJsdO6pgWf6opaxGHIjbdm8e5rHJ57HsvgrlVl89j2w7Um1GeeurbBxuxt9uy7BOUEEHMH8A5OtAZmZBvZy6377y3N5IP4XUz59v/74dpo+W3mQYeA+bq+H4H6mdY/v2f/+UTPV13sQPz4PR0C8DSCEUyFyR0jqFeJ1CccVlmhqHGMgSbABpVsemprqCbCQKgHaifVXnqq995xlp7vccokLeZTBjFfIEYcrULQ5ZJpPSxdYImVNQMeawys1IhmUX0M7NM/fOOfj+r8vTRhfOtbY65bihmzAYvYkaFiQQmkXxee6khSSwH9JGAQSA0dNo6ThKhT/w/pNQO1M+iPP3185e6hZ7zTxovAHAC1iBmNL/jqjHEJJBJsGrfD2l5N22NlJGtkg3FVifiPx5vdqD+huXo+Pj0Lz7ce7tL1MNIE4wcu2FRGGBCIk+lZALndwqv6sk+ReEKBosU4SpDyCQhKR1hKgRTZ/gfje07UH+DcvTC8f7HP1mudFvaHzHk7OLh01rm5aljI6NbMj9cTI/lJ1vpA81V93VKLSQWi5" /></g>
                  <g clipPath="url(#oriented-design-clip-3)" transform="matrix(0.5,0,0,0.5,24,15)"><image width="81px" height="81px" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFEAAABRCAYAAACqj0o2AAAACXBIWXMAABYlAAAWJQFJUiTwAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAABTXSURBVHgB7V3Njh3Hdf6q50qRd+Mn8NUTiM4quww3SeCNRkCCJE4AkUAAxwkSiksjAXgZSSYTE5ohgvwhi2G8iBIEBsUYcSQnAGeZRWCOn8DXT+BZGLZE3lvH1d11zvlO9Z3hDDmkNi77zu3uqq4656vv/HR1XSrhcyx79+9vP976+U45nCekN5BlnhPmAumr5zJ8yfB/JByX82WpO04pLWWdfyhdOlpjdbR46+oxPseS8BJLD9pq9umlnNKbKctuwWY+VAw4SW1FRyJ2rwIqeizeLud81CUcPV7Lg9mrOHzZoL4UEL/13Q93ErprRe2d8tnur4n9UbAETDwHUOxvwghgru0Le8txHq5JBVVyLtdwr7R5cOurf/QRXkJ5YSCOrHt8raj1TvlsG6eUdRUVoXPnloMYAd1QV0DrOxpA1E8e2xQwl8X0b77adYeL37+6xAsqFw5iD15+9fE1yfKOEHhCrEsDpSqjkl/fBJazc7NpD2Zd64fvrIwUqysDFjC37n3zD67exAsoFwrinf/89110sleUnyuDepMbFdTjyqQKpIJj7OqrEgPI3hI2G2N779vcQK71udbXumHAAmb53Cxg3sMFlgsBce+/P5yvVumgHO6gMgKqnCnq7R1ENlk90janmXma9A9JBGY16drlMHlK+jJDxcQ/mnVy/aJMvMNzljvf/bdrqyfpUZF2B+SXcgUoszaD4nm43vsywWjSI2sk+rUhYIgDKcQ4NVNimvvJEdCxdgBsAI/ZUpruPlnh0V/868E7uIDyzEwcAsfWZzf6wGHKmpDMEGKSfTkzuc5N2xtL6JOKeIsarGGRqjJPXYiBPYAKA3loDuy//4dXruM5yjOBuHf/w/mTTu4XES5xwFA/N5w3gExAs7qGReNBAyH5yHi5BvlEZg4H1ZOAepxYRGtbgD1ar/DW7avPZt7nBnEAMOWHSOMTxYQhAAIzG0BEpuwztmVxiRpmKqtTIu8waJCchXZdzTyZPC6btmwtpTwF5XT5WYA8F4gKYB99TV7EoFGvRJOUGEyElIl9tCas34Kni17BrKC6icP9KHeO6WT2QEK6cwN5ZhBvFQA7FAaiT19kA8PorDHx6eObs3UEMlVw1fg48nKHGEFS0Yf+a2wUUkVIDmKxsJyacklwMP35skuvnAvIM4E4Arh+qPlflUKHrd/+R60y18RahIWE30cKet5IvTbY9Q8nXUpB/KTMC+bcsLgB0JPwCKqNVZ50um5dgPz6EmcoZ0pxElb31YTrY8GgZnhuzZqWqJAjDThlyRtSGUVL06KhXe3PGCkjgKrsWJPMLQR24hQAadxB/pzN1E21Xo5ibSvZur84ONjGGcpTQbx9/9t7RaFLo5LZgcsOgIODEUiICa5BQQisVqEcrsGYmYPp+ZSqmcYgQkxjhmE6jskPVJ1GHQbZc227Xl/6ae5TuKeXU8351ne+faV0eGAt2fzQmIiKLEBMbwANJr3pOUPtDpBjj/0lz/ssCveHZe5TokASxtK5FbcSswxmp4+TeUzykcPkCa5/8LU/2QeeAcRb9w/mkrtHpaft6J+EfFe9Epwz+x74Sg2zJIe7WX667iJqSqIAWkdUH3GolpCrTeRoGeYmEj1bJ9jiBeLfY6y7L+9//WT/eKI5p7zVm/G2mRnIFFTjcE5C6jHcH4r+L9tRdQ3MlOmE2MnAvMToWupcrdqBgo8P86Eki7Jy8InqrzOsZXQ525LWBzilbATx/e8cXFnn9S6s2ygUqn9REMwfqU8UmQDLDl3nAOD6aP42MMYgwlQThOoqHwxQDlr9OQdAHTMzuHVMOeFT2u782T/83RWcB8TiB264YmJBxKKaDa+gEdN08ByZBmYoOX" /></g>
                  <g transform="matrix(0.9659258127212524,-0.258819043636322,0.258819043636322,0.9659258127212524,3.3741302490234375,22.974552154541016)"><path d={" M4.980000019073486,0.33000001311302185 C5.099999904632568,-0.10999999940395355 5.71999979019165,-0.10999999940395355 5.840000152587891,0.33000001311302185 C5.840000152587891,0.33000001311302185 6.489999771118164,2.75 6.489999771118164,2.75 C6.699999809265137,3.5199999809265137 7.289999961853027,4.110000133514404 8.0600004196167,4.320000171661377 C8.0600004196167,4.320000171661377 10.479999542236328,4.980000019073486 10.479999542236328,4.980000019073486 C10.920000076293945,5.099999904632568 10.920000076293945,5.71999979019165 10.479999542236328,5.840000152587891 C10.479999542236328,5.840000152587891 8.0600004196167,6.489999771118164 8.0600004196167,6.489999771118164 C7.289999961853027,6.699999809265137 6.699999809265137,7.289999961853027 6.489999771118164,8.0600004196167 C6.489999771118164,8.0600004196167 5.840000152587891,10.479999542236328 5.840000152587891,10.479999542236328 C5.71999979019165,10.920000076293945 5.099999904632568,10.920000076293945 4.980000019073486,10.479999542236328 C4.980000019073486,10.479999542236328 4.320000171661377,8.0600004196167 4.320000171661377,8.0600004196167 C4.110000133514404,7.289999961853027 3.5199999809265137,6.699999809265137 2.75,6.489999771118164 C2.75,6.489999771118164 0.33000001311302185,5.840000152587891 0.33000001311302185,5.840000152587891 C-0.10999999940395355,5.71999979019165 -0.10999999940395355,5.099999904632568 0.33000001311302185,4.980000019073486 C0.33000001311302185,4.980000019073486 2.75,4.320000171661377 2.75,4.320000171661377 C3.5199999809265137,4.110000133514404 4.110000133514404,3.5199999809265137 4.320000171661377,2.75 C4.320000171661377,2.75 4.980000019073486,0.33000001311302185 4.980000019073486,0.33000001311302185 C4.980000019073486,0.33000001311302185 4.980000019073486,0.33000001311302185 4.980000019073486,0.33000001311302185z"} fill="rgb(201,197,165)" /></g>
                  <g clipPath="url(#oriented-design-clip-4)" transform="matrix(0.5,0,0,0.5,6,33)"><image width="136px" height="82px" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIgAAABSCAYAAACPH5wbAAAACXBIWXMAABYlAAAWJQFJUiTwAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAADpISURBVHgB5X1ptF3VcWbVuVczICEkRiEEiBkzCMxoDBjbDZgQx0OAleA4HTt24tjudOIkHafTdGel071IVnenEyfpNO50sLMghCEGG0MwYTSTBELMILAQo9A8PT299+6u3rvqq9r7PoTj/Om1gh9c3XvPuM+ub3/1Ve065zL903+8+ILFU2/8qxvndFvHLhgM5OyO5IS8eFHHNJvzB+L8v26Z3yW/d0O7Dx1M/HvZUFj3IXws74S38jXFPp2tEntJc2TbphveR7eTt507CQ1/p3rO8iHpJcimJLw87/6tmTN3u+nzl1325gMPPDDabvnj9Mc/bOU555wz/RvXXbVww6aNn9u+ddOla95YOXv92lX9TRvX9EZGNvQGE2NqiK5jgwjjkOwgKEvZQKGLumyk/KErmGIRyf/kFalsop+zofP6BIMPRPcVSR0PqBi0y5+J8zHye9lOX5xSaUV+x7kKNoqxUyootOUKLDEcibcp/+XjGZ7YwDtt6lTZe8+9BocsPGh88YIDR+fsPueGAw888L+cf8YZq5966qkx+jH72yVAiuXWjazb97XVq76yddvaz7z4/CPTfrDysakT4yNq+2KW0s09UXuyLmMzejF0HBXLBHuJbajAsKOwNqEarDOji70MLOW909GfALBBPosCLSNtkEi3KcvKcRU8pMZmP4aIkw8DJIbgFIzETk5odml3R9yxvGfxEYPTTzxx7dw951z5y5de/hfLli0boR+jv97kBVdccUV30LEHHb5q1XO3rlh+5/kP3X/DjHXrVvfSYFS7sdNxTvqeOzD/b92dP+aDsS7IfavfSweX9Z0xBmunu0PK/3bYWZeTfw7EiX3oyOzcqdEFoGJmMIE2yiDqSMVZiAwMZVFhojoaWD1hbKqLfI19SBluKSNszfp13TMrV+7e7/fP/Owv/RI/fM+9S9esWTNOPyZ/QwAp4Pj4L358ySs/eOHv7rnjG4e/8dqzPZZB3iiRGjoPzj4AoXygxtcPBRfKHf49zMQMazEZHliw2BjHIAEsMFyNn6RAEWiBC/D1AIuIuw8DgbXMgEEAAhjLTxIwYXc5FMyCz8pZjjCmsYlx+sGrr07NB3jvr3zxy/TwvT8+IAmAlF4szPHisyv+7vv3X3/Ytm3rOKOjMEB5B2voQC9jmXs9SEyM1S6vNXDo4dToXecjWBnFqV0HdAx35tiprJPOXYD5JuiDbDOlIV3p4HCRIzIZHB0LjE0gCGUQsX3JUCJAi0iARDj2qlpZ3zOb0Ctvvj41t/fHCiQeb6jmeP6Fp256+MGbF2/fmsFhK1m7mlxCknQwRUfNS92F+BjlXleA1bgiPZOE16gaVqj1Js4lWEvcILCQCaiFwjMUbJGhz8mBudVALjEgSJvlcSDiCgnGxZa/ZlNsJYMseO5d9vCs+5Y/8ht/ee21v37cccfNonf5nzLIggULZpx27sn//oF7rjt/69Z1/V4Z/Y3eKF3e10CBVHMUAIAKwA5U9QP0gdKMChJya5oG6TTuYUOe7iROJkIuajsLfswpte6EPaQ1+JaIxhjHhaaxTCNGOcQIRSzu31u6UD8U/Ket1mOgJS57ii5Z/ebr/dy0U7/4xS/Lu51JCkD4waceXPTosju+9sbrL8wsQWexHdxLAYl+h87wUW/SshnhHTsWwhNAR7om7epYjPfOw2BwElxIuKOOXJTC8CFSm8jHdAY3y6rAIXgkdzl+bqphOTImrk7dARE2i5iHwEXmil554/UpuZNO+XIGyUPvYpD0Fi1aNP3ks0/4gyceu+O9ksZ7PTBCyyC9zmztgOjBNZfBzjVHZqDoPMIgW8xgDHMHbDTeOacbL7mldI/qmGyVA0dKiGsKqK" /></g>
                  <g clipPath="url(#oriented-design-clip-5)" transform="matrix(0.5,0,0,0.5,55,55)"><image width="24px" height="24px" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAABYlAAAWJQFJUiTwAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAC3SURBVHgB7ZQxCsIwFIbfn9RdcBbipDhlFgS9gLRH8AiexKNUvEALXsDJOeeoJDGWDur01NCh5IOQ9yB//iH5H4iJXuX6Lv3xWY8k9tf6ZDi6jJg0mSvJk2pr66uwzTg6QVy6yzsUU/WFwY8kg2TwP9CbXDXOVR//PAYGVhRyMp2XodEUnzEELXp4A4sDAYaiA2PDUAT3+HK986/97XJmaVMOksGgDN7CyA8m28AJbEGo22VRcHUPpFcn06D4xcsAAAAASUVORK5CYII=" /></g>
                </svg>
                <h6>新規ファイル</h6>
              </div>
            </div>
            {projects.map((project) => (
              <div key={project.id} className="oriented-design-project-card" data-testid={`oriented-design-project-${project.id}`} onClick={() => openProject(project.jobId)}>
                <div className="oriented-design-project-media">
                  <ProjectThumbnail url={project.imageUrl} fallback={<img src={DESIGN_PROJECT_DEFAULT_COVER} alt="coverImg" className="oriented-design-project-default-cover" />} />
                </div>
                <div className="oriented-design-project-meta">
                  <div className="oriented-design-project-name">{project.title}</div>
                  <div className="oriented-design-project-date">{formatProjectAge(project.updatedAt)} 修正</div>
                </div>
                <button type="button" aria-label="プロジェクトメニュー" className="oriented-design-project-menu" onClick={(event) => event.stopPropagation()}><MoreVertical className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="oriented-design-reference-cases">
          <h6 id="oriented-design-reference-cases" className="oriented-design-section-title">参考事例</h6>
          <div className="oriented-design-reference-grid">
            {orientedDesignReferenceImages.map((image, index) => (
              <div key={image} className="oriented-design-project-card" onClick={() => navigateToDetail({ key: 'reference', value: index + 1 })}>
                <div className="oriented-design-project-media"><img src={image} alt="coverImg" loading="lazy" /></div>
                <div className="oriented-design-project-meta">
                  <div className="oriented-design-project-name">{index === 0 ? 'デザイン要素融合' : 'ディテール変更'}</div>
                  <div className="oriented-design-project-date">8ヶ月前 修正</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ParityShell>
  );
}

export function LightchainOrientedDesignDetailPage() {
  const location=useLocation(),explicitFeature=new URLSearchParams(location.search).get('workspaceFeature');
  const toolId=explicitFeature==='wear-design-lab'?'wear-design-lab':'wear-design-detail';
  const workspace = useCanonicalImageWorkspace(toolId,{identityConflict:explicitFeature!==null&&explicitFeature!=='wear-design-lab'&&explicitFeature!=='wear-design-detail'});
  const imageUrl = workspace.result?.imageUrl ?? workspace.slots.primary?.imageUrl;
  const navigate = useNavigate();

  return (
    <main className="dark min-h-[calc(100vh-50px)] overflow-hidden bg-[#181a1d] text-white" data-testid="oriented-design-detail" data-lightchain-parity-shell="oriented-design-detail"
      data-resume-feature={workspace.toolId} data-resume-job={workspace.result?.jobId ?? ''} data-resume-state={workspace.status} data-resume-inputs={String(workspace.originalInputsAvailable)} data-current-inputs={String(workspace.inputsAvailable)}
      data-primary-source={workspace.slots.primary?.sourceImageId ?? workspace.slots.primary?.localAssetRef ?? ''}
      data-secondary-source={workspace.slots.secondary?.sourceImageId ?? workspace.slots.secondary?.localAssetRef ?? ''}>
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ backgroundImage: 'radial-gradient(#464b50 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
      <aside className="absolute left-4 top-[74px] z-10 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#202426] shadow-xl">
        <div className="flex h-10 items-center gap-2 border-b border-white/10 px-2 text-sm text-neutral-400">
          <img src={DESIGN_PROJECT_DEFAULT_COVER} alt="PROJECT" className="h-6 w-6 rounded-md object-cover" />
          <span>ウェアデザインラボ</span>
        </div>
        <button type="button" onClick={() => navigate(explicitFeature === null || explicitFeature === 'wear-design-detail' ? '/flow/orientedDesign' : orientedDesignLabHref(location, '/flow/orientedDesign'))} className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm text-neutral-400 transition hover:bg-white/5 hover:text-white">
          <ChevronLeft className="h-5 w-5" />
          <span>Untitled</span>
        </button>
      </aside>
      <label className="absolute left-1/2 top-[190.93px] flex h-[496.14px] w-[min(781.59px,calc(100vw-40px))] -translate-x-1/2 cursor-pointer flex-col items-center justify-center rounded-xl bg-[#25292b] text-center transition hover:bg-[#2a2e30]" data-testid="oriented-design-detail-upload">
        {imageUrl ? (
          <img src={imageUrl} alt="アップロードしたデザイン素材" className="h-full w-full rounded-xl object-contain" />
        ) : (
          <>
            <Upload className="h-8 w-8 text-white" />
            <p className="relative top-[8px] mt-5 text-sm leading-[21px] text-neutral-300">ここをクリックまたはドラッグして画像を追加</p>
            <p className="relative top-[8px] mt-1 text-xs leading-[17.14px] text-neutral-500">jpg、jpeg、png、webp形式の画像（最大20M）に対応</p>
          </>
        )}
        <input disabled={workspace.status==='loading'||workspace.status==='running'||Boolean(workspace.pendingId)} className="sr-only" type="file" aria-label="主素材画像" accept=".png,.jpg,.jpeg,.avif,.webp" onChange={event=>{const file=event.target.files?.[0];if(file)void workspace.upload('primary',file);event.target.value='';}} />
      </label>
      <CanonicalImageWorkspaceControls workspace={workspace} />
    </main>
  );
}
