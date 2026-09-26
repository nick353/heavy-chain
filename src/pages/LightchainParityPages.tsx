import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  Layers,
  MoreVertical,
  Palette,
  FileText,
  Plus,
  Search,
  Shirt,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
} from 'lucide-react';
import { buildGenerationIntentHref, workspaceSourceConfig } from '../lib/workspaceHandoff';
import { deleteWorkspaceArtifactsPersisted, listWorkspaceArtifacts, saveWorkspaceArtifactBestEffort, type WorkspaceArtifact } from '../lib/localWorkspaceArtifacts';
import { downloadValidatedImage } from '../lib/imageDownload';
import { persistPrintInputState, restorePrintInputState } from '../lib/printInputPersistence';
import { asGeneratedImageListRow, cloudflareDataPlane } from '../lib/cloudflareApi';
import { withSignedImageUrls } from '../lib/storage';
import type { Json } from '../types/database';
import { useAuthStore } from '../stores/authStore';
import {
  getLightchainUnifiedFeatureWorkflowContract,
  UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION,
} from '../features/lightchain/unifiedFeatureWorkflowContract';

const darkPanel = 'rounded-2xl border border-white/10 bg-[#151a1c]';
const mutedButton = 'rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-neutral-300 transition hover:border-cyan-200/50 hover:bg-white/[0.08] hover:text-white';

function ParityPermissionGate({ testId, marginClass = '' }: { testId: string; marginClass?: string }) {
  return <button type="button" disabled aria-label="この機能は未実装です" data-testid={testId} className={`${marginClass} h-10 w-full rounded-lg bg-[#434a4c] px-4 py-0 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40`}>この機能は未実装です</button>;
}

const designHistoryFeatureTypes = new Set([
  'campaign-image',
  'text-to-image',
  'generate-image',
  'generate-variations',
  'marketing-workflow',
  'fashion-studio',
  'graphic-pattern-workspace',
  'design-gacha',
]);

const fittingHistoryFeatureTypes = new Set(['model-matrix', 'model-matrix-local-preview']);

const formatArtifactDate = (createdAt: string) => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '日時未確認';
  const daysSinceEdit = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (daysSinceEdit === 0) return '今日 修正';
  if (daysSinceEdit < 30) return `${daysSinceEdit}日前 修正`;
  return `${Math.max(1, Math.floor(daysSinceEdit / 30))}ヶ月前 修正`;
};

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

export function LightchainCreatorPage() {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [keywords, setKeywords] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [historyArtifacts, setHistoryArtifacts] = useState<WorkspaceArtifact[]>([]);
  const { currentBrand, profile, user } = useAuthStore();
  const navigate = useNavigate();
  const metadataName = user?.user_metadata?.full_name;
  const displayName = profile?.name?.trim() || (typeof metadataName === 'string' ? metadataName.trim() : '') || user?.email?.split('@')[0] || 'ユーザー';

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
            <button type="button" className="mt-4 w-full rounded-lg border border-dashed border-white/30 bg-[#171b1d] px-3 py-2 text-sm text-neutral-300" onClick={() => setCategoryPickerOpen((open) => !open)}>＋ {selectedCategory || 'カテゴリを選択してください'}</button>
            {categoryPickerOpen && <p className="mt-2 text-xs text-neutral-500">中央のカテゴリ一覧から選択してください。</p>}
            {categoryPickerOpen && <div className="fixed inset-x-[352px] bottom-4 top-[67px] z-20"><CreatorCategoryPicker selectedCategory={selectedCategory} onSelect={(category) => setSelectedCategory(category)} /></div>}
          </section>
          <section className="flex min-h-0 flex-1 flex-col rounded-xl bg-[#262a2b] p-4"><div className="flex items-center gap-2"><h6 aria-label="画像をアップロード オプション" className="text-base font-medium leading-4">画像をアップロード</h6><span className="text-xs text-neutral-400">オプション</span></div>{selectedCategory ? <><div className="mt-3 flex overflow-hidden rounded-lg border border-white/10 bg-[#171b1d] text-xs"><button type="button" className="flex-1 bg-cyan-300 px-3 py-2 font-semibold text-neutral-950">画像</button><button type="button" className="flex-1 px-3 py-2 text-neutral-300">生地画像</button></div><div className="mt-4 flex flex-1 items-center justify-center rounded-lg border border-white/10 bg-[#1b2022] text-center text-sm text-neutral-300"><button type="button" className="rounded-lg px-5 py-3" onClick={() => navigate('/asset-center')}><Upload className="mx-auto mb-2 h-6 w-6" />画像をアップロードします</button></div></> : <div className="flex flex-1 items-center justify-center"><button type="button" className="rounded-full bg-white/[0.08] px-5 py-3 text-sm text-neutral-300" onClick={() => navigate('/asset-center')}><Sparkles className="mr-2 inline h-4 w-4" />デザインを先に選択してください。</button></div>}</section>
        </aside>


        <main className="relative min-h-0 rounded-xl bg-[#151a1c] px-2 py-4 lg:px-8"><button type="button" className="absolute right-2 top-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-neutral-200" onClick={() => setHistoryOpen((open) => !open)}><Clock3 className="mr-2 inline h-4 w-4" />生成履歴</button><section className="flex min-h-full flex-col items-center justify-center pt-8"><h5 className="text-xl font-semibold text-cyan-300">インスピレーション</h5><p className="mt-2 text-sm text-neutral-400">AIで素早くデザイン開発、効率向上・コスト削減</p><div className="mt-[1px] h-[340px] w-full max-w-[1088px] overflow-hidden rounded-lg bg-[#0d1113]"><video src="https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/tools/ja/%E6%9C%8D%E8%A3%85%E8%AE%BE%E8%AE%A1.mp4" className="size-full" autoPlay controls playsInline aria-label="インスピレーション動画" /></div></section></main>
        <aside className="flex min-h-0 flex-col gap-4"><section className="min-h-[264px] rounded-xl bg-[#262a2b] p-4"><div className="flex h-full items-center justify-center text-center"><div><WandSparkles className="mx-auto h-12 w-12 text-cyan-300/70" /><h6 className="mt-4 text-xs font-semibold leading-[1.4286] text-neutral-300">このモジュールは購入後に使用可能。</h6><p className="mt-2 text-xs text-neutral-400">ご担当の営業担当者にご連絡ください</p></div></div></section><section className="flex min-h-0 flex-1 flex-col rounded-xl bg-[#262a2b] p-4"><div className="flex items-center justify-between gap-3"><h6 aria-label="キーワードを追加 オプション" className="text-base font-medium leading-4">キーワードを追加</h6><span className="text-xs text-neutral-400">オプション</span></div><div className="relative mt-4 flex h-[323px] min-h-0 flex-col gap-1 rounded-lg border border-white/10 pb-1"><textarea value={keywords} onChange={(event) => setKeywords(event.target.value)} className="min-h-0 flex-1 resize-none rounded-md border border-white/10 bg-[#262a2b] px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-500 focus:border-cyan-300" placeholder="生成画像について細かい指定がある場合は、こちらでキーワードを入力できます\n\n例1：オートミール色、H型カット、チェック柄生地、通勤用ワンピース… \n\n例2：18歳のヨーロッパ系モデルが両手を後ろに組んでオートミール色のワンピースを着用。ワンピースはチェック柄生地で作られ、U字型襟のデザイン、パフスリーブ、H型カットが特徴。隠しポケット付きで、通勤スタイルを演出" maxLength={1000} aria-label="生成画像について細かい指定がある場合は、こちらでキーワードを入力できます" /><div className="flex h-6 w-full items-center justify-between bg-transparent px-2 text-xs text-neutral-400"><span>文字数: {keywords.length}/1000</span><button type="button" className="rounded border border-white/10 px-3 py-1" onClick={() => setKeywords('')} disabled={!keywords}>全削除</button><button type="button" className="rounded bg-cyan-300 px-3 py-1 font-semibold text-neutral-950" onClick={() => setDictionaryOpen(true)}>キーワード辞典</button></div></div><ParityPermissionGate testId="creator-permission" marginClass="mt-8" /></section></aside>
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
export function LightchainPrintingPage() {
  const [referenceImage, setReferenceImage] = useState<{ url: string; file?: File; referenceType: 'base' } | null>(null);
  const [printImage, setPrintImage] = useState<{ url: string; file?: File; referenceType: 'pattern' } | null>(null);
  const [coverage, setCoverage] = useState<'spot' | 'full'>('spot');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [printingBannerVisible, setPrintingBannerVisible] = useState(true);
  const [message, setMessage] = useState('');
  const [restored, setRestored] = useState(false);
  const { user, currentBrand } = useAuthStore();
  const navigate = useNavigate();
  const persistenceScope = useMemo(
    () => user?.id ? { origin: cloudflareDataPlane?.origin ?? window.location.origin, userId: user.id } : undefined,
    [user],
  );

  useEffect(() => {
    if (!user?.id || !currentBrand?.id || !persistenceScope) {
      setRestored(false);
      return;
    }
    let cancelled = false;
    void restorePrintInputState(currentBrand.id, { scope: persistenceScope })
      .then((snapshot) => {
        if (cancelled) return;
        setReferenceImage(snapshot.garment ? { url: snapshot.garment.url, referenceType: 'base' } : null);
        setPrintImage(snapshot.designs[0] ? { url: snapshot.designs[0].url, referenceType: 'pattern' } : null);
        setRestored(true);
      })
      .catch(() => {
        if (!cancelled) setRestored(true);
      });
    return () => { cancelled = true; };
  }, [currentBrand?.id, persistenceScope, user?.id]);

  useEffect(() => {
    if (!restored || !user?.id || !currentBrand?.id || (!referenceImage && !printImage)) return;
    void persistPrintInputState(
      currentBrand.id,
      referenceImage,
      printImage ? [printImage] : [],
      { garment: null, designs: [] },
      { scope: persistenceScope },
    ).catch(() => undefined);
  }, [currentBrand?.id, persistenceScope, printImage, referenceImage, restored, user?.id]);

  const handleFile = (event: ChangeEvent<HTMLInputElement>, kind: 'base' | 'pattern') => {
    const file = event.target.files?.[0];
    const url = file ? URL.createObjectURL(file) : '';
    if (kind === 'base') setReferenceImage(file ? { url, file, referenceType: 'base' } : null);
    else setPrintImage(file ? { url, file, referenceType: 'pattern' } : null);
    setMessage('');
  };

  const handleCanonicalFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 2);
    const [base, pattern] = files;
    setReferenceImage(base ? { url: URL.createObjectURL(base), file: base, referenceType: 'base' } : null);
    setPrintImage(pattern ? { url: URL.createObjectURL(pattern), file: pattern, referenceType: 'pattern' } : null);
    setMessage('');
  };

  const handleGenerate = async () => {
    if (!referenceImage || !printImage) {
      setMessage('参考画像とプリント画像を選択してください');
      return;
    }
    if (!user?.id || !currentBrand?.id) {
      setMessage('ログイン状態を確認してから、もう一度お試しください');
      return;
    }
    setMessage('入力を保存しています。生成ワークスペースを開きます…');
    try {
      await persistPrintInputState(
        currentBrand.id,
        referenceImage,
        [printImage],
        { garment: null, designs: [] },
        { scope: persistenceScope },
      );
      navigate('/lightchain/printing-image');
    } catch (error) {
      setMessage(error instanceof Error ? `入力の保存に失敗しました: ${error.message}` : '入力の保存に失敗しました');
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
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleCanonicalFiles} />
            </label>
            {(referenceImage || printImage) && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[referenceImage, printImage].map((image, index) => image ? (
                  <img key={`${image.referenceType}-${index}`} src={image.url} alt={index === 0 ? '参考画像' : 'プリント画像'} className="h-24 w-full rounded-lg object-cover" />
                ) : <div key={`empty-${index}`} className="h-24 rounded-lg border border-dashed border-white/10" />)}
                <button type="button" className="col-span-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300" onClick={() => { setReferenceImage(null); setPrintImage(null); setMessage(''); }}>リセット</button>
              </div>
            )}
          </section>

          <main className="relative flex min-h-[780px] flex-col rounded-xl bg-[#252a2d] p-4 sm:p-6">
            <button type="button" className="absolute right-4 top-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-neutral-200" onClick={() => setHistoryOpen((open) => !open)}>
              <Clock3 className="mr-2 inline h-4 w-4" />生成履歴
            </button>
            <section className="flex flex-1 flex-col items-center justify-center">
              <h2 className="text-2xl font-semibold text-neutral-100">AIグラフィックデザイン</h2>
              <p className="mt-2 text-sm text-neutral-400">AIでグラフィックを作成</p>
              <div className="mt-6 h-[340px] w-full max-w-[1056px] overflow-hidden rounded-lg bg-[#0d1113]">
                <video src="https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/tools/ja/%E5%8D%B0%E6%9F%93%E4%B8%8A%E8%BA%AB.mp4" className="h-full w-full object-cover" autoPlay controls muted playsInline aria-label="AIグラフィックデザイン動画" />
              </div>
              {(referenceImage || printImage) && <button type="button" className="mt-6 rounded-xl bg-cyan-300 px-6 py-3 text-sm font-semibold text-neutral-950" onClick={() => void handleGenerate()}>AI生成</button>}
              {message && <p className="mt-3 text-sm text-neutral-300" role="status">{message}</p>}
            </section>
          </main>

          <aside className="min-h-[780px] rounded-xl bg-[#252a2d] p-4" aria-label="生成結果">
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

  return (
    <ParityShell workflowFeature="printing-image" className="lightchain-printing-parity bg-[#171b1c] text-white">
      <style>{`
        .lightchain-printing-parity .bg-white { background-color: #252b2d !important; }
        .lightchain-printing-parity .bg-neutral-50 { background-color: #202629 !important; }
        .lightchain-printing-parity .bg-neutral-950 { background-color: #0b1113 !important; }
        .lightchain-printing-parity .bg-amber-50 { background-color: rgba(127, 29, 29, 0.28) !important; }
        .lightchain-printing-parity .border-neutral-200,
        .lightchain-printing-parity .border-neutral-300 { border-color: rgba(255, 255, 255, 0.1) !important; }
        .lightchain-printing-parity .text-neutral-900,
        .lightchain-printing-parity .text-neutral-700,
        .lightchain-printing-parity .text-neutral-600 { color: rgba(255, 255, 255, 0.82) !important; }
        .lightchain-printing-parity .text-neutral-500 { color: rgba(255, 255, 255, 0.46) !important; }
        .lightchain-printing-parity input[type="file"] { color: rgba(255, 255, 255, 0.7); }
      `}</style>
      <div className="relative mx-auto w-full px-4 py-4 sm:px-5 lg:px-4">
        <aside className="absolute left-4 top-4 hidden h-[746px] w-20 flex-col items-center gap-2 border-r border-white/10 bg-[#171b1c] px-0 py-0 lg:flex" aria-label="ツールバー">
          {[
            ['ツールバー', Grid2X2, '/designProduction?category=recommended'],
            ['デザインツール', WandSparkles, '/tools/fabric'],
            ['フィッティングツール', Sparkles, '/model'],
            ['グラフィックデザインツール', ImageIcon, '/tools/printing'],
            ['衣類生産ツール', FolderOpen, '/tools/fabric'],
          ].map(([label, Icon, to]) => {
            const ToolIcon = Icon as typeof Grid2X2;
            const active = label === 'グラフィックデザインツール';
            return <Link key={label as string} to={to as string} aria-current={active ? 'page' : undefined} className={`flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-xl border px-1 text-center text-[10px] leading-4 transition ${active ? 'border-cyan-200/30 bg-cyan-300/15 text-cyan-100' : 'border-transparent text-neutral-400 hover:bg-white/[0.06] hover:text-white'}`}><ToolIcon className="mb-1 h-7 w-7" /><span>{label as string}</span></Link>;
          })}
        </aside>
        <div className="relative lg:pl-24">
        <div className="absolute inset-x-0 top-4 z-10 flex items-center justify-end gap-4">
          <div className="hidden">
            <p className="text-xs font-semibold tracking-[0.25em] text-neutral-500">LIGHTCHAIN AI / GRAPHIC TOOLS</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">プリントイメージ</h1>
            <p className="mt-2 max-w-2xl text-sm text-neutral-500">プリントイメージを使用し、版下を作成せずに印刷効果を確認できます</p>
          </div>
          <button type="button" className="absolute right-[10px] top-0 h-8 w-[102px] rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-sm text-neutral-700 transition hover:border-neutral-400" onClick={() => setHistoryOpen((open) => !open)}>
            生成履歴
          </button>
        </div>

        <nav className="absolute left-28 top-4 z-10 grid w-[564px] grid-cols-4 rounded-xl border border-neutral-200 bg-neutral-50 p-[2px]" aria-label="素材ツール" role="tablist">
          {[
            ['生地イメージ', '/tools/fabric'],
            ['プリントイメージ', '/tools/printing'],
            ['線画の実写化', '/tools/line-draft-to-tile'],
            ['平絵生成', '/tools/line'],
          ].map(([label, href]) => (
            <button key={label} type="button" role="tab" aria-selected={href === '/tools/printing'} className={`rounded-sm px-1 py-1 text-[15px] leading-[23px] font-medium transition ${href === '/tools/printing' ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-500 hover:text-neutral-900'}`} onClick={() => navigate(href)}>{label}</button>
          ))}
        </nav>

        <div className="mt-0 grid gap-4 lg:grid-cols-[minmax(0,596px)_minmax(0,1fr)]">
          <section className="relative h-[746px] min-h-0 overflow-hidden rounded-2xl bg-white p-4 pt-[68px] shadow-sm">
            {printingBannerVisible && <div className="flex h-16 items-start gap-2 rounded-lg bg-amber-50 px-4 py-[15px] text-sm leading-5 text-amber-900">
              <span className="flex-1">この機能はまもなく終了します。より高機能な画像生成機能はデザイン制作ワークスペースでご利用ください。<Link className="ml-[15px] underline" to="/designProduction">今すぐ体験</Link></span>
              <button type="button" aria-label="告知を閉じる" className="shrink-0 text-lg leading-5 text-amber-100/80 transition hover:text-white" onClick={() => setPrintingBannerVisible(false)}>×</button>
            </div>}
            <label className="mt-[18px] flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded relative border border-dashed border-transparent bg-neutral-50 p-4 text-center transition hover:border-cyan-300/60">
              <input className="sr-only" type="file" accept="image/*" onChange={(event) => handleFile(event, 'base')} />
              {referenceImage ? <img src={referenceImage.url} alt="参考画像" className="max-h-56 max-w-full rounded-lg object-contain" /> : <><Upload className="h-8 w-8 text-neutral-400" /><span className="mt-2 text-base text-neutral-600">参考画像をアップロードしてください</span><span className="mt-2 text-xs text-neutral-500">20MB以下の画像アップロードしてください</span></>}
            </label>
            <div className="mt-4 flex items-center justify-between"><h2 className="font-semibold">プリントをアップロード</h2><button type="button" className="text-sm text-neutral-500 underline" onClick={() => { setReferenceImage(null); setPrintImage(null); setMessage(''); if (user?.id && currentBrand?.id && persistenceScope) void persistPrintInputState(currentBrand.id, null, [], { garment: null, designs: [] }, { scope: persistenceScope }).catch(() => undefined); }}>リセット</button></div>
            <div className="mt-3 grid w-[244px] grid-cols-2 rounded-xl border border-neutral-200 bg-neutral-50 p-1">
              {(['spot', 'full'] as const).map((value) => <button key={value} type="button" aria-pressed={coverage === value} aria-selected={coverage === value} className={`rounded-lg px-4 py-3 text-sm font-semibold ${coverage === value ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-500'}`} onClick={() => setCoverage(value)}>{value === 'spot' ? 'スポット' : '全体'}</button>)}
            </div>
            <label className="mt-3 flex h-[120px] w-[120px] cursor-pointer flex-col items-center justify-center rounded relative border border-dashed border-transparent bg-neutral-50 p-4 text-center transition hover:border-cyan-300/60">
              <input className="sr-only" type="file" accept="image/*" onChange={(event) => handleFile(event, 'pattern')} />
              {printImage ? <img src={printImage.url} alt="プリント画像" className="h-full w-full rounded-lg object-contain" /> : <><Upload className="h-6 w-6 text-neutral-400" /><span className="mt-2 text-base text-neutral-600">画像をアップロード</span><span className="mt-2 text-xs text-neutral-500">20MB以下の画像アップロードしてください</span></>}
            </label>
            <button type="submit" className="absolute bottom-4 right-4 h-10 w-[288px] rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white transition hover:bg-neutral-800" onClick={() => void handleGenerate()}>AI生成</button>
            {message && <p className="mt-3 text-sm text-neutral-600" role="status">{message}</p>}
          </section>

          <aside className="space-y-4">
            <section className="flex h-[746px] min-h-0 flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#151a1c] p-4 text-center shadow-sm"><div className="flex size-full flex-col items-center justify-center px-10"><h2 className="text-xl font-bold text-white">プリントイメージ</h2><p className="mt-2 text-sm leading-[21px] text-neutral-400">プリントイメージを使用し、版下を作成せずに印刷効果を確認できます</p><div className="mt-4 h-[340px] w-full"><video src="https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/tools/ja/%E5%8D%B0%E6%9F%93%E4%B8%8A%E8%BA%AB.mp4" className="size-full rounded-lg object-cover" autoPlay controls muted playsInline aria-label="プリントイメージ動画" /></div></div></section>
            <section className="hidden" aria-label="詳細設定"><h2 className="font-semibold">詳細設定</h2><p>配置・マスク・複数素材を使う場合はこちら。</p><button type="button" onClick={() => navigate('/lightchain/printing-image')}>高度な印刷ワークスペース</button></section>
          </aside>
        </div>
        {historyOpen && <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><h2 className="font-semibold">生成履歴</h2><p className="mt-3 text-sm text-neutral-500">生成履歴はここに表示されます。</p><button type="button" className="mt-3 text-sm font-semibold text-neutral-700 underline" onClick={() => navigate('/history')}>履歴を開く</button></section>}
        </div>
      </div>
    </ParityShell>
  );
}

export function LightchainVectorSpecialPage() {
  const [activeTab] = useState<'通常版' | 'プロフェッショナル版'>(() => window.location.pathname === '/tools/vector-special' ? 'プロフェッショナル版' : '通常版');
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [layerModes, setLayerModes] = useState<Array<'stack' | 'split'>>(['stack']);
  const [usage, setUsage] = useState(7);
  const navigate = useNavigate();
  const isProfessionalFlow = activeTab === 'プロフェッショナル版';

  const handleReferenceImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReferenceImage(URL.createObjectURL(file));
  };

  const reset = () => {
    setReferenceImage(null);
    setLayerModes(['stack']);
    setUsage(7);
  };

  const toggleLayerMode = (mode: 'stack' | 'split') => {
    setLayerModes((current) => {
      if (current.includes(mode)) return current.length > 1 ? current.filter((value) => value !== mode) : current;
      return [...current, mode];
    });
  };

  return (
    <ParityShell workflowFeature="pattern-vector-pro" className="bg-[#0b1113] text-white">
      <div className="relative mx-auto min-h-[calc(100vh-70px)] max-w-[1904px] px-4 py-4 lg:pl-[112px]">
        <aside className="absolute inset-y-4 left-4 hidden w-20 flex-col items-center gap-2 rounded-xl bg-[#171b1c] px-2 py-3 lg:flex" aria-label="ツールバー">
          {[
            ['ツールバー', '/assets/lightchain-toolbar.svg', '/designProduction?category=recommended', false],
            ['デザインツール', '/assets/lightchain-design.svg', '/tools/fabric', false],
            ['フィッティング\nツール', '/assets/lightchain-fitting.svg', '/model', false],
            ['グラフィックデザイン\nツール', '/assets/lightchain-graphic.svg', '/tools/pattern-to-vector', true],
            ['衣類生産\nツール', '/assets/lightchain-production.svg', '/tools/fabric', false],
          ].map(([label, iconUrl, to, active]) => {
            return <Link key={label as string} to={to as string} aria-current={active ? 'page' : undefined} className={`flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] leading-4 transition ${active ? 'bg-cyan-300/15 text-cyan-100 ring-1 ring-cyan-200/30' : 'text-white/45 hover:bg-white/[0.06] hover:text-white/80'}`}><img src={iconUrl as string} alt="" className="mb-1 h-7 w-7 object-contain" /><span className="whitespace-pre-line">{label as string}</span></Link>;
          })}
        </aside>
        <div className="grid min-h-[calc(100vh-102px)] gap-4 lg:grid-cols-[596px_minmax(0,1fr)]">
          <section className="relative min-h-[746px] overflow-hidden rounded-xl bg-[#171b1c] p-4 pt-[68px] shadow-2xl shadow-black/20">
            <nav className="absolute left-4 right-4 top-4 grid h-[36px] grid-cols-[278px_278px] rounded-lg border border-white/10 bg-[#111719] px-[3px] py-[1.5px]" role="tablist" aria-label="ベクター化モード">
              <button type="button" role="tab" aria-selected={activeTab === '通常版'} className={`h-[31px] overflow-hidden whitespace-nowrap rounded-md px-2 text-sm font-medium leading-5 ${activeTab === '通常版' ? 'bg-[#737d84] text-white' : 'text-white/45'}`} onClick={() => navigate('/tools/pattern-to-vector')}>パターンをベクター画像に変換（通常版）</button>
              <button type="button" role="tab" aria-selected={activeTab === 'プロフェッショナル版'} className={`h-[31px] overflow-hidden whitespace-nowrap rounded-md px-2 text-sm font-medium leading-5 ${activeTab === 'プロフェッショナル版' ? 'bg-[#737d84] text-white' : 'text-white/45'}`} onClick={() => navigate('/tools/vector-special')}>パターンをベクター画像に変換（プロフェッショナル版）</button>
            </nav>
            <div className="flex h-16 items-start gap-2 rounded-lg bg-[#5b1f2a] px-4 py-3 text-sm leading-5 text-white">
              <span className="flex-1">この機能はまもなく終了します。より高機能な画像生成機能はデザイン制作ワークスペースでご利用ください <Link className="underline" to="/designProduction">今すぐ体験</Link></span>
              <span aria-hidden="true" className="text-white/80">×</span>
            </div>
            <label className="mt-[18px] flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-xl bg-[#252a2d] text-center">
              <input className="sr-only" type="file" accept="image/*" onChange={handleReferenceImage} />
              {referenceImage ? <img src={referenceImage} alt="参考画像" className="max-h-56 max-w-full rounded-lg object-contain" /> : <><Upload className="h-8 w-8 text-white/70" /><span className="mt-2 text-base text-white/85">参考画像をアップロードしてください</span><span className="mt-2 text-xs text-white/45">20MB以下の画像アップロードしてください</span></>}
            </label>
            {isProfessionalFlow ? (
              <>
                <div className="mt-4 flex items-center justify-between text-sm text-white/85"><span>レイヤー分け方法を選択してください（複数選択可）</span><button type="button" className="text-xs font-semibold text-white/65 underline" onClick={reset}>リセット</button></div>
                <div className="mt-3 grid grid-cols-[160px_160px] gap-4">
                  {([['stack', '積み重ね'], ['split', '分割']] as const).map(([mode, label]) => (
                    <button key={mode} type="button" aria-pressed={layerModes.includes(mode)} className={`h-[164px] rounded-xl border px-4 py-3 text-sm font-semibold ${layerModes.includes(mode) ? 'border-cyan-300 bg-cyan-300/10 text-white' : 'border-white/10 bg-[#111719] text-white/45'}`} onClick={() => toggleLayerMode(mode)}>
                      <span className="relative mx-auto mb-3 block h-16 w-20" aria-hidden="true">
                        <span className={`absolute left-1/2 top-1/2 block h-8 w-12 -translate-x-1/2 -translate-y-1/2 rounded-md border border-cyan-200/30 bg-cyan-300/20 ${mode === 'stack' ? '-rotate-[18deg]' : '-rotate-[6deg]'}`} />
                        <span className={`absolute left-1/2 top-1/2 block h-8 w-12 -translate-x-1/2 -translate-y-1/2 rounded-md border border-cyan-100/30 bg-cyan-200/15 ${mode === 'stack' ? 'rotate-[18deg]' : 'rotate-[14deg]'}`} />
                        <span className={`absolute left-1/2 top-1/2 block h-7 w-7 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-md border border-teal-100/40 bg-teal-200/25 ${mode === 'split' ? 'scale-75' : ''}`} />
                      </span>{label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex flex-col items-end gap-4 text-xs text-white/75"><span>使用回数 {usage} / 30</span><button type="button" className="h-10 w-[288px] rounded-lg bg-[#65d3cf] px-5 text-sm font-semibold text-neutral-950" onClick={() => { setUsage((count) => Math.min(30, count + 1)); navigate('/tools/vector-special'); }}>AI生成 <span className="ml-1">1</span></button></div>
              </>
            ) : (
              <ParityPermissionGate testId="pattern-vector-permission" />
            )}
          </section>
          <section className="relative flex min-h-[746px] flex-col rounded-xl bg-[#232728] p-4">
            <button type="button" className="absolute right-4 top-4 flex h-[32px] w-[102px] items-center justify-center rounded-lg border border-white/15 bg-[#171b1c]/80 px-3 text-sm text-white/80" onClick={() => navigate('/history')}><Clock3 className="mr-2 inline h-4 w-4" />生成履歴</button>
            <div className="flex flex-1 flex-col items-center justify-center text-center"><h1 className="text-xl font-bold text-white">パターンをベクター画像に変換（{activeTab}）</h1><p className="mt-2 text-sm text-neutral-400">プリントパターンをベクター画像に変換します</p></div>
          </section>
        </div>
      </div>
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
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.25em] text-cyan-200">LIGHTCHAIN AI / FITTING</p><h1 className="mt-3 text-3xl font-semibold">AIフィッティング</h1><p className="mt-2 text-sm text-neutral-400">服、モデル、背景を組み合わせて着用イメージを作成します。</p></div><button type="button" className={mutedButton} onClick={() => setHistoryOpen((open) => !open)}><Clock3 className="mr-2 inline h-4 w-4" />生成履歴</button></div>
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
  ['生地パターン適用', '画像1の色と生地を変えず、画像2の生地パターンを適用してください', '面料套版'],
  ['線画から実写化', '画像1の線画を参考に、画像2の雰囲気で実写の商品画像にしてください', '转线稿'],
  ['デザインミックス', '画像1の色と生地を変えず、襟型を画像2の襟型に変更してください', '款式融合'],
  ['プリント修正', '画像1の要素を参考に、四方連続のプリントパターンをデザインし、画像2をレイアウトの参考にしてください', '印花设计'],
] as const;

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

const sortWorkspaceArtifacts = (artifacts: Iterable<WorkspaceArtifact>) => (
  [...artifacts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
);

// The current Light source renders all 31 project cards in one document. The
// relative labels below are intentionally source-shaped (the first three are
// hour-based, followed by the day-based records visible in the canonical page).
const designProductionSourceProjectAgesHours = [
  17, 17, 18, 7 * 24, 7 * 24, 8 * 24,
  ...Array.from({ length: 17 }, () => 10 * 24),
  ...Array.from({ length: 8 }, () => 11 * 24),
] as const;

const buildDesignProductionSourceProjectFallbacks = (
  brandId: string,
  scopeId?: string,
): WorkspaceArtifact[] => designProductionSourceProjectAgesHours.map((hours, index) => ({
  id: `source-design-production-untitled-${index + 1}`,
  brandId,
  featureType: 'design-production-source-fallback',
  title: 'Untitled',
  imageUrl: '',
  prompt: null,
  createdAt: new Date(Date.now() - hours * 3_600_000 - index * 1_000).toISOString(),
  metadata: { sourceFallback: true, sourceIndex: index + 1 },
  scopeId,
}));

const formatDesignProductionSourceArtifactDate = (createdAt: string) => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '日時未確認 修正';
  const hoursSinceEdit = Math.max(1, Math.floor((Date.now() - date.getTime()) / 3_600_000));
  if (hoursSinceEdit < 24) return `${hoursSinceEdit}時間前 修正`;
  return `${Math.max(1, Math.floor(hoursSinceEdit / 24))}日前 修正`;
};

const mergeWorkspaceArtifact = (current: WorkspaceArtifact[], next: WorkspaceArtifact) => {
  const byId = new Map(current.map((artifact) => [artifact.id, artifact]));
  byId.set(next.id, next);
  return sortWorkspaceArtifacts(byId.values());
};

const marketingSceneCards = [
  {
    label: 'EC',
    prompt: 'ECサイト向けに、商品の特徴が伝わる販促ビジュアルを作成してください。',
    image: 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/GenerateMarketingCover.png?x-oss-process=image/resize,m_lfit,w_1200,limit_1/format,webp',
  },
  {
    label: 'SNS',
    prompt: 'SNS向けに、ブランドの雰囲気が伝わる縦長の投稿ビジュアルを作成してください。',
    image: 'https://static-cn.linkaigc.com/workbenches/2026-02/d81b55aa18721b86c37b96a36223a936.jpeg?x-oss-process=image/resize,m_lfit,w_1200,limit_1/format,webp',
  },
  {
    label: 'ブランド',
    prompt: 'ブランドの世界観を表現するキャンペーンビジュアルを作成してください。',
    image: 'https://static-cn.linkaigc.com/saas/2026-06/a25e632441de5b1198f4e20ae7040568.jpeg?x-oss-process=image/resize,m_lfit,w_1200,limit_1/format,webp',
  },
  {
    label: '店舗・オフライン',
    prompt: '店舗や展示会で使える、商品が見やすい販促パネルを作成してください。',
    image: 'https://static-cn.linkaigc.com/saas/2026-06/3266745d3f905fc8c770cd0894438279.jpeg?x-oss-process=image/resize,m_lfit,w_1200,limit_1/format,webp',
  },
  {
    label: 'ライブ配信',
    prompt: 'ライブ配信の商品紹介で使える、視認性の高い告知ビジュアルを作成してください。',
    image: 'https://static-cn.linkaigc.com/saas/2026-06/6051a3df009110d3de23c3af3173e418.jpeg?x-oss-process=image/resize,m_lfit,w_1200,limit_1/format,webp',
  },
  {
    label: 'プロモーション',
    prompt: '新商品のプロモーション用に、印象的なキャンペーンビジュアルを作成してください。',
    image: 'https://static-cn.linkaigc.com/saas/2026-06/1b69b85c8eba09e87fbae86a8f98b3b5.jpeg?x-oss-process=image/resize,m_lfit,w_1200,limit_1/format,webp',
  },
] as const;

const MARKETING_TUTORIAL_STORAGE_KEY = 'heavy-chain-lightchain-marketing-tutorial-dismissed-v1';

/**
 * Light Chain's marketing landing surface. Keep this route small and source-shaped:
 * the full compatibility workbench is still available at /marketing/detail, while
 * /marketing must open on the same prompt, scene, project, and example sections as
 * the official site instead of showing a Heavy-only loading/workbench shell.
 */
export function LightchainMarketingHomePage() {
  const [prompt, setPrompt] = useState('');
  const [projects, setProjects] = useState<WorkspaceArtifact[]>([]);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [pinnedProjectIds, setPinnedProjectIds] = useState<Set<string>>(new Set());
  const [pinsHydrated, setPinsHydrated] = useState(false);
  const [remainingUnits, setRemainingUnits] = useState<number | null>(null);
  const { currentBrand, user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      setTutorialVisible(window.localStorage.getItem(MARKETING_TUTORIAL_STORAGE_KEY) !== '1');
    } catch {
      setTutorialVisible(true);
    }
    let cancelled = false;
    if (!currentBrand?.id) {
      setProjects([]);
      return () => { cancelled = true; };
    }
    const loadProjects = async () => {
      const localProjects = listWorkspaceArtifacts(currentBrand.id, user?.id);
      let remoteProjects: WorkspaceArtifact[] = [];
      if (cloudflareDataPlane) {
        try {
          const remoteRows = await cloudflareDataPlane.listGeneratedImages(currentBrand.id, {
            limit: 100,
            offset: 0,
            order: 'newest',
          });
          const listRows = remoteRows.map(asGeneratedImageListRow);
          const signedRows = await withSignedImageUrls(listRows).catch(() => listRows);
          remoteProjects = signedRows.map(generatedImageToWorkspaceArtifact);
        } catch {
          // Local artifacts remain a safe fallback when remote readback is unavailable.
        }
      }
      if (cancelled) return;
      const byId = new Map<string, WorkspaceArtifact>();
      [...remoteProjects, ...localProjects].forEach((project) => {
        if (!byId.has(project.id)) byId.set(project.id, project);
      });
      setProjects(sortWorkspaceArtifacts(byId.values()).slice(0, 12));
    };
    void loadProjects();
    return () => { cancelled = true; };
  }, [currentBrand?.id, user?.id]);

  useEffect(() => {
    const brandId = currentBrand?.id;
    if (!brandId) {
      setPinsHydrated(false);
      setPinnedProjectIds(new Set());
      return;
    }
    setPinsHydrated(false);
    try {
      const saved = window.localStorage.getItem(`heavy-marketing-pins:${brandId}`);
      const parsed = saved ? JSON.parse(saved) : [];
      setPinnedProjectIds(new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []));
    } catch {
      setPinnedProjectIds(new Set());
    }
    setPinsHydrated(true);
  }, [currentBrand?.id]);

  useEffect(() => {
    const brandId = currentBrand?.id;
    if (!brandId || !pinsHydrated) return;
    window.localStorage.setItem(`heavy-marketing-pins:${brandId}`, JSON.stringify([...pinnedProjectIds]));
  }, [currentBrand?.id, pinnedProjectIds, pinsHydrated]);

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

  const generationHref = (nextPrompt: string) => buildGenerationIntentHref({
    feature: 'campaign-image',
    prompt: nextPrompt,
    sourceWorkspace: 'marketing',
    workflowVersion: 'marketing-brief-local-v1',
    sourceLabel: workspaceSourceConfig.marketing.label,
    sourceResumePath: workspaceSourceConfig.marketing.resumePath,
    sourceMode: 'local-workflow-intake',
  });

  const dismissTutorial = () => {
    setTutorialVisible(false);
    try {
      window.localStorage.setItem(MARKETING_TUTORIAL_STORAGE_KEY, '1');
    } catch {
      // Tutorial visibility is a convenience only; keep the page usable if storage is unavailable.
    }
  };

  const saveMarketingArtifactToLibrary = async (artifact: WorkspaceArtifact) => {
    if (!currentBrand?.id) return toast.error('ブランドが選択されていないため、ライブラリーへ保存できません');
    const result = await saveWorkspaceArtifactBestEffort({
      ...artifact,
      id: undefined,
      brandId: currentBrand.id,
      scopeId: user?.id,
      metadata: { ...artifact.metadata, librarySource: 'marketing-project-card-menu', libraryGroup: 'マイライブラリー', copiedFromArtifactId: artifact.id },
    });
    if (!result.localPersisted) return toast.error('ライブラリー保存の確認に失敗しました');
    if (cloudflareDataPlane && !result.remote) {
      toast.error('リモート保存の確認に失敗しました。再送せず、同じ保存依頼を照合してください');
      return;
    }
    setProjects((current) => mergeWorkspaceArtifact(current, result.artifact).slice(0, 12));
    toast.success('アセットライブラリーに保存しました');
  };

  const deleteMarketingArtifact = async (artifact: WorkspaceArtifact) => {
    if (!currentBrand?.id || !window.confirm(`「${artifact.title}」を削除しますか？`)) return;
    const remoteImageId = typeof artifact.metadata.remoteImageId === 'string' ? artifact.metadata.remoteImageId : null;
    if (cloudflareDataPlane && remoteImageId && !artifact.id.startsWith('local-')) {
      try {
        await cloudflareDataPlane.deleteGeneratedImage(remoteImageId);
      } catch {
        toast.error('削除に失敗しました');
        return;
      }
    }
    const result = deleteWorkspaceArtifactsPersisted(currentBrand.id, [artifact.id], user?.id);
    if (!result.ok) return toast.error('成果物を削除できませんでした');
    setProjects((current) => current.filter((project) => project.id !== artifact.id));
    setOpenProjectMenuId(null);
    toast.success('プロジェクトを削除しました');
  };

  return (
    <ParityShell className="relative overflow-hidden bg-[#171b1c] text-white" workflowFeature="marketing-home">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[linear-gradient(90deg,rgba(56,189,148,0.42),rgba(59,130,246,0.38),rgba(30,41,59,0.1))]" />
      {remainingUnits !== null && <div aria-label="残りクレジット" className="absolute right-5 top-4 flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs text-white"><Sparkles className="h-3.5 w-3.5" />{remainingUnits.toLocaleString()}</div>}
      <main data-testid="lightchain-marketing-home" className="relative z-10 mx-auto max-w-[1365px] px-5 pb-10 pt-16 sm:px-8 lg:px-0">
        <section className="text-center">
          <h1 className="text-4xl font-semibold tracking-[-0.04em]">マーケティングワークスペースへようこそ</h1>
          <p className="mt-3 text-sm text-neutral-400">今日は何を作りますか？リクエストを聞かせてください。一緒に始めましょう！</p>
          <div className="relative mx-auto mt-8 max-w-[980px] rounded-2xl border border-[#0bcabc] bg-[#1a1f22] p-2 shadow-[0_0_28px_rgba(101,211,207,0.14)]">
            <div className="grid min-h-[206px] grid-cols-[96px_minmax(0,1fr)] items-start gap-4 rounded-2xl bg-[#1d2326] px-4 py-3 text-left">
              <button type="button" aria-label="参考画像を追加" onClick={() => navigate('/marketing/detail')} className="mt-2 flex h-24 w-20 rotate-[-8deg] items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(145deg,#243039,#101719)] text-neutral-300 transition hover:text-white">
                <img src="https://jp.linkaigc.com/marketing/upload-placeholder.png" alt="" className="h-full w-full object-cover" />
              </button>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value.slice(0, 4000))}
                maxLength={4000}
                aria-label="マーケティングのリクエスト"
                placeholder="商品画像をアップロードして、デザインのリクエストを教えてください"
                className="h-full min-h-[150px] w-full resize-none border-0 bg-transparent p-5 pr-24 text-left text-sm leading-7 text-neutral-200 outline-none placeholder:text-neutral-400"
              />
            </div>
            <div className="absolute bottom-5 right-5 flex items-center gap-4 text-xs text-neutral-500">
              <span>{prompt.length} / 4000</span>
              <button type="button" aria-label="送信" disabled={!prompt.trim()} onClick={() => navigate(generationHref(prompt.trim()))} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0bcabc] text-neutral-950 transition hover:bg-[#65d3cf] disabled:cursor-not-allowed disabled:opacity-40"><ArrowRight className="h-5 w-5 -rotate-45" /></button>
            </div>
            {tutorialVisible && (
              <div className="absolute left-1/2 top-1/2 z-20 flex w-[min(660px,calc(100vw-40px))] -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full border border-[#65d3cf]/50 bg-[#202829]/95 px-4 py-2 text-left text-xs font-semibold text-neutral-200 shadow-xl" data-testid="lightchain-marketing-tutorial">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#65d3cf] ring-4 ring-[#65d3cf]/30" />
                <span className="min-w-0 flex-1">ここで参考画像のアップロードや、アイデア（プロンプト）の入力ができます。 1 / 4</span>
                <button type="button" onClick={dismissTutorial} className="shrink-0 text-[#65d3cf] underline">Next</button>
                <button type="button" aria-label="スキップ" onClick={dismissTutorial} className="shrink-0 text-lg leading-none text-[#65d3cf]">×</button>
              </div>
            )}
          </div>
        </section>

        <section className="mt-6" aria-label="おすすめのシーン">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="mr-1 text-sm text-neutral-300">おすすめのシーン 👉</span>
            {marketingSceneCards.map((scene) => (
              <button key={scene.label} type="button" onClick={() => setPrompt(scene.prompt)} className="inline-flex items-center gap-2 rounded-xl bg-[#262c30] px-5 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-[#343c41]">
                <Sparkles className="h-4 w-4 text-neutral-300" />
                <span>{scene.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-9" data-testid="lightchain-marketing-projects">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">マイプロジェクト</h2></div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => navigate('/marketing/detail')} className="group relative h-60 w-[220px] overflow-hidden rounded-2xl border border-dashed border-white/20 bg-white/[0.03] text-left transition hover:border-cyan-200/60">
              <div className="flex h-full flex-col items-center justify-center rounded-xl bg-[#20272a] text-neutral-200 transition-colors group-hover:bg-[#252d30]">
                <div className="relative h-20 w-20 overflow-hidden rounded-2xl bg-[linear-gradient(145deg,#6fd7cf_0%,#3d6475_42%,#9964ac_100%)] shadow-[inset_8px_8px_18px_rgba(255,255,255,0.28),inset_-10px_-10px_20px_rgba(20,25,35,0.3)]"><div className="absolute inset-3 flex items-center justify-center rounded-lg border border-white/20 bg-black/10 text-[8px] font-bold tracking-[0.12em] text-white/90 shadow-inner">PROJECT</div><span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-neutral-900 shadow-md"><Plus className="h-4 w-4" /></span></div>
                <p className="mt-3 font-medium">新規ファイル</p>
              </div>
            </button>
            {projects.map((project) => (
              <article key={project.id} className="group relative h-60 w-[220px] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] text-left transition hover:border-white/40">
                <button type="button" onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(project.id)}`)} className="absolute inset-0 flex h-full w-full flex-col text-left">
                  <div className="flex flex-1 items-center justify-center bg-[#20272a]">{project.imageUrl ? <img src={project.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <img src="https://jp.linkaigc.com/static/project_default_cover.png" alt="" className="h-12 w-12 object-contain" loading="lazy" />}</div>
                  <div className="shrink-0 px-3 py-3"><p className="truncate font-medium">{pinnedProjectIds.has(project.id) ? '📌 ' : ''}{project.title}</p><p className="mt-2 truncate text-xs text-neutral-500">{formatArtifactDate(project.createdAt)}</p></div>
                </button>
                <div className="absolute right-2 top-2 z-20"><button type="button" aria-label={`${project.title}のメニュー`} aria-expanded={openProjectMenuId === project.id} className="rounded-lg bg-black/45 p-2 text-neutral-200 opacity-0 transition group-hover:opacity-100 hover:bg-black/70 focus:opacity-100" onClick={(event) => { event.stopPropagation(); setOpenProjectMenuId((current) => current === project.id ? null : project.id); }}><MoreVertical className="h-4 w-4" /></button>{openProjectMenuId === project.id && <div role="menu" className="absolute right-0 top-full z-30 mt-2 min-w-48 rounded-lg border border-white/10 bg-[#202627] p-1 shadow-2xl"><button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={() => { setPinnedProjectIds((current) => { const next = new Set(current); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next; }); setOpenProjectMenuId(null); }}>ピン留め</button><button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={() => { void saveMarketingArtifactToLibrary(project); setOpenProjectMenuId(null); }}>アセットライブラリに保存</button><button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10" onClick={() => void deleteMarketingArtifact(project)}>削除</button></div>}</div>
              </article>
            ))}
          </div>
          {projects.length === 0 && <p className="mt-4 text-sm text-neutral-500">保存済みのプロジェクトはここに表示されます。</p>}
        </section>

        <section className="mt-12" data-testid="lightchain-marketing-reference-cases">
          <h2 className="text-lg font-semibold">参考事例</h2>
          <div className="mt-4 flex min-h-24 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-neutral-500"><img src="https://jp.linkaigc.com/static/searchEmpty.png" alt="search empty" className="h-12 w-12 object-contain opacity-70" /><span className="mt-2">データなし</span></div>
        </section>
      </main>
    </ParityShell>
  );
}

export function LightchainDesignProductionPage() {
  const [activeTab, setActiveTab] = useState('プロジェクトから開始');
  const [dialoguePrompt, setDialoguePrompt] = useState('');
  const [activeScene, setActiveScene] = useState('');
  const [activeAssetSlot, setActiveAssetSlot] = useState<0 | 1>(0);
  const [galleryReferenceAssets, setGalleryReferenceAssets] = useState<GalleryReferenceAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<[string | null, string | null]>([null, null]);
  const [persistedDesignArtifacts, setPersistedDesignArtifacts] = useState<WorkspaceArtifact[]>([]);
  const [projectPage, setProjectPage] = useState(1);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [pinnedProjectIds, setPinnedProjectIds] = useState<Set<string>>(new Set());
  const [pinsHydrated, setPinsHydrated] = useState(false);
  const [remainingUnits, setRemainingUnits] = useState<number | null>(null);
  const { currentBrand, user } = useAuthStore();
  const navigate = useNavigate();
  const designBrandId = currentBrand?.id;
  const designUserId = user?.id;

  const selectedAssets = useMemo(
    () => selectedAssetIds.map((id) => galleryReferenceAssets.find((asset) => asset.id === id) ?? {
      id: '',
      label: 'ライブラリーから素材を選択',
      src: '',
    }) as [GalleryReferenceAsset, GalleryReferenceAsset],
    [galleryReferenceAssets, selectedAssetIds],
  );
  const resolvedSelectedAssets = useMemo(
    () => selectedAssetIds
      .map((id) => galleryReferenceAssets.find((asset) => asset.id === id))
      .filter((asset): asset is GalleryReferenceAsset => Boolean(asset)),
    [galleryReferenceAssets, selectedAssetIds],
  );
  const trimmedDialoguePrompt = dialoguePrompt.trim();
  const hasUnresolvableSelectedAssetId = selectedAssetIds.some(
    (id) => Boolean(id) && !galleryReferenceAssets.some((asset) => asset.id === id),
  );
  const hasTwoReferenceAssets = resolvedSelectedAssets.length === 2;
  const canOpenProposal = Boolean(trimmedDialoguePrompt) && hasTwoReferenceAssets;
  const referenceRequirementMessage = galleryReferenceAssets.length === 0
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
    let cancelled = false;
    if (!currentBrand?.id) {
      setPersistedDesignArtifacts([]);
      setGalleryReferenceAssets([]);
      setSelectedAssetIds([null, null]);
      return () => { cancelled = true; };
    }
    const loadArtifacts = async () => {
      const localArtifacts = listWorkspaceArtifacts(currentBrand.id, user?.id)
        .filter((artifact) => designHistoryFeatureTypes.has(artifact.featureType));
      let remoteArtifacts: WorkspaceArtifact[] = [];
      if (cloudflareDataPlane) {
        try {
          const remoteRows = await cloudflareDataPlane.listGeneratedImages(currentBrand.id, {
            limit: 100,
            offset: 0,
            order: 'newest',
          });
          const listRows = remoteRows.map(asGeneratedImageListRow);
          const signedRows = await withSignedImageUrls(listRows).catch(() => listRows);
          remoteArtifacts = signedRows
            .map(generatedImageToWorkspaceArtifact);
        } catch {
          // Local artifacts remain a safe fallback when the remote read is unavailable.
        }
      }
      if (cancelled) return;
      const byId = new Map<string, WorkspaceArtifact>();
      [...remoteArtifacts, ...localArtifacts].forEach((artifact) => {
        if (!byId.has(artifact.id)) byId.set(artifact.id, artifact);
      });
      const artifacts = sortWorkspaceArtifacts(byId.values());
      setPersistedDesignArtifacts(artifacts);
      const nextReferenceAssets = artifacts
        .filter((artifact) => Boolean(artifact.imageUrl))
        .slice(0, 12)
        .map((artifact) => ({
          id: artifact.id,
          label: artifact.title,
          src: artifact.imageUrl,
        }));
      setGalleryReferenceAssets(nextReferenceAssets);
      setSelectedAssetIds([nextReferenceAssets[0]?.id ?? null, nextReferenceAssets[1]?.id ?? null]);
    };
    void loadArtifacts();
    return () => { cancelled = true; };
  }, [currentBrand?.id, user?.id]);

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

  const displayDesignArtifacts = useMemo(() => {
    if (!designBrandId) {
      return persistedDesignArtifacts;
    }
    const existingIds = new Set(persistedDesignArtifacts.map((artifact) => artifact.id));
    const fallbackArtifacts = buildDesignProductionSourceProjectFallbacks(designBrandId, designUserId)
      .filter((artifact) => !existingIds.has(artifact.id));
    return [...persistedDesignArtifacts, ...fallbackArtifacts].slice(0, designProductionSourceProjectAgesHours.length);
  }, [designBrandId, persistedDesignArtifacts, designUserId]);
  // Light currently keeps all 31 cards in the document on page 1. Preserve its
  // six-page indicator and arrow controls while rendering the same all-card
  // surface for parity and reliable reuse of saved artifacts.
  const projectPageCount = 6;
  const visibleProjectArtifacts = displayDesignArtifacts;

  useEffect(() => {
    const brandId = currentBrand?.id;
    if (!brandId) {
      setPinsHydrated(false);
      setPinnedProjectIds(new Set());
      return;
    }
    setPinsHydrated(false);
    try {
      const saved = window.localStorage.getItem(`heavy-design-production-pins:${brandId}`);
      const parsed = saved ? JSON.parse(saved) : [];
      setPinnedProjectIds(new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []));
    } catch {
      setPinnedProjectIds(new Set());
    }
    setPinsHydrated(true);
  }, [currentBrand?.id]);

  useEffect(() => {
    const brandId = currentBrand?.id;
    if (!brandId || !pinsHydrated) return;
    window.localStorage.setItem(`heavy-design-production-pins:${brandId}`, JSON.stringify([...pinnedProjectIds]));
  }, [currentBrand?.id, pinnedProjectIds, pinsHydrated]);
  const saveDesignArtifactToLibrary = async (artifact: WorkspaceArtifact) => {
    if (!currentBrand?.id) return toast.error('ブランドが選択されていないため、ライブラリーへ保存できません');
    const result = await saveWorkspaceArtifactBestEffort({
      ...artifact,
      id: undefined,
      brandId: currentBrand.id,
      scopeId: user?.id,
      metadata: { ...artifact.metadata, librarySource: 'design-production-card-menu', libraryGroup: 'マイライブラリー', copiedFromArtifactId: artifact.id },
    });
    if (!result.localPersisted) return toast.error('ライブラリー保存の確認に失敗しました');
    if (cloudflareDataPlane && !result.remote) {
      toast.error('リモート保存の確認に失敗しました。再送せず、同じ保存依頼を照合してください');
      return;
    }
    setPersistedDesignArtifacts((current) => mergeWorkspaceArtifact(current, result.artifact));
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
    if (!currentBrand?.id || !window.confirm(`「${artifact.title}」を削除しますか？`)) return;
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
        toast.error('削除に失敗しました');
        return;
      }
    }
    const result = deleteWorkspaceArtifactsPersisted(currentBrand.id, [artifact.id], user?.id);
    if (!result.ok) return toast.error('成果物を削除できませんでした');
    setPersistedDesignArtifacts((current) => current.filter((item) => item.id !== artifact.id));
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
  if (activeTab === '対話から開始') {
    return <LightchainDialogueParityPanel onProjectStart={() => setActiveTab('プロジェクトから開始')} />;
  }
  return (
    <ParityShell className="design-production-parity relative overflow-hidden bg-[#171b1c] text-white" workflowFeature="print-design-project">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[linear-gradient(90deg,rgba(180,224,139,0.5),rgba(112,208,239,0.42),rgba(255,255,255,0))]" />
      {remainingUnits !== null && <div aria-label="残りクレジット" className="absolute right-5 top-4 flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs text-white"><Sparkles className="h-3.5 w-3.5" />{remainingUnits.toLocaleString()}</div>}
      <div data-testid="design-production-page" className="relative z-10 mx-auto max-w-[1157px] px-6 py-7 lg:px-0"><div className="text-center"><h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">デザインワークスペースへようこそ</h1><p className="mt-3 text-sm text-neutral-400">アイデアを形にし、制作をスムーズに</p></div>
        <div role="tablist" className="mx-auto mt-8 flex w-fit rounded-2xl border border-white/10 bg-white/10 p-1">{['プロジェクトから開始', '対話から開始'].map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`h-10 ${tab === 'プロジェクトから開始' ? 'w-[210px]' : 'w-[146px]'} rounded-xl px-0 py-1 text-lg font-medium transition ${activeTab === tab ? 'bg-white/15 text-white shadow-sm' : 'text-neutral-400 hover:text-white'}`}>{tab}</button>)}</div>
        {activeTab === '対話から開始' ? (
          <div role="tabpanel" aria-label="対話から開始">
            <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8">
              <div className="flex items-center gap-3"><WandSparkles className="h-5 w-5" /><h2 className="font-semibold">対話から開始</h2></div>
              <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400">既存のGallery素材を組み合わせ、作りたい変更内容を対話で指定します。</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {dialogueScenes.map(([title, prompt, iconLabel]) => <button key={title} type="button" onClick={() => { setActiveScene(title); setDialoguePrompt(prompt); }} className={`rounded-2xl border bg-white/5 p-4 text-left transition hover:border-white/40 ${activeScene === title ? 'border-white ring-1 ring-white' : 'border-white/10'}`}><div className="flex h-20 items-center justify-center rounded-xl bg-white/10 text-xs font-semibold text-neutral-400">{iconLabel}</div><p className="mt-3 text-sm font-semibold">{title}</p><span className="mt-2 block text-xs text-neutral-400">使ってみる</span></button>)}
              </div>
              {activeScene && <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-semibold text-neutral-400">Gallery素材を組み合わせる</p><div className="mt-3 grid gap-3 sm:grid-cols-3">{galleryReferenceAssets.map((asset) => <button key={asset.id} type="button" onClick={() => setSelectedAssets((current) => { const next: [typeof galleryReferenceAssets[number], typeof galleryReferenceAssets[number]] = [...current]; next[activeAssetSlot] = asset; return next; })} className={`overflow-hidden rounded-xl border text-left transition ${selectedAssets[activeAssetSlot].id === asset.id ? 'border-white ring-1 ring-white' : 'border-white/10 hover:border-white/40'}`}><div className="h-24 bg-white/10"><img src={asset.src} alt={asset.label} className="h-full w-full object-cover" loading="lazy" /></div><div className="px-3 py-2 text-xs text-neutral-300">{asset.label}</div></button>)}</div><div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-400"><button type="button" onClick={() => setActiveAssetSlot(0)} className={`rounded-full border px-3 py-1.5 ${activeAssetSlot === 0 ? 'border-white text-white' : 'border-white/10'}`}>画像1を選択</button><button type="button" onClick={() => setActiveAssetSlot(1)} className={`rounded-full border px-3 py-1.5 ${activeAssetSlot === 1 ? 'border-white text-white' : 'border-white/10'}`}>画像2を選択</button></div></div>}
              {activeScene && <div className="mt-5 grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[180px_180px_minmax(0,1fr)]"><div className="overflow-hidden rounded-xl bg-white/10"><img src={selectedAssets[0].src} alt="画像1" className="h-28 w-full object-cover" loading="lazy" /><p className="px-2 py-1 text-xs text-neutral-400">画像1: {selectedAssets[0].label}</p></div><div className="overflow-hidden rounded-xl bg-white/10"><img src={selectedAssets[1].src} alt="画像2" className="h-28 w-full object-cover" loading="lazy" /><p className="px-2 py-1 text-xs text-neutral-400">画像2: {selectedAssets[1].label}</p></div><div><textarea value={dialoguePrompt} onChange={(event) => setDialoguePrompt(event.target.value)} className="min-h-28 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus:border-white/60" aria-label="商品画像をアップロードして、デザインのリクエストを教えてください" /><div className="mt-2 text-right text-xs text-neutral-500">{dialoguePrompt.length} / 4000</div></div></div>}
              <div className="mt-5 max-w-2xl"><div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2"><Sparkles className="h-4 w-4 text-neutral-400" /><input value={dialoguePrompt} onChange={(event) => setDialoguePrompt(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-500" placeholder="作りたいデザインを入力してください" /><button type="button" className="rounded-lg bg-white px-4 py-2 text-sm text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canOpenProposal} onClick={openProposal}>提案を見る</button></div>{(!trimmedDialoguePrompt || !hasTwoReferenceAssets) && <div id="design-production-proposal-requirements" className="mt-2 space-y-1 text-xs text-neutral-400" aria-live="polite">{!trimmedDialoguePrompt && <p>依頼文を入力してください。</p>}{!hasTwoReferenceAssets && <div className="flex flex-wrap items-center gap-2"><p>{referenceRequirementMessage}</p>{galleryReferenceAssets.length === 0 && <button type="button" className="rounded-lg border border-white/20 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:border-white/50" onClick={() => navigate('/asset-center')}>ライブラリーを開く</button>}</div>}</div>}</div>
            </section>
          </div>
        ) : (
          <div role="tabpanel" aria-label="プロジェクトから開始">
            <section className="mt-6 grid gap-2 grid-cols-2 sm:grid-cols-5" aria-label="新規ファイル">
              <div className="flex min-h-[160px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/5 p-5 text-center"><Plus className="h-8 w-8 text-white" /><span className="mt-4 text-sm font-semibold">新規ファイル</span></div>
              <CreationCard icon={<Shirt />} title="インスピレーション" actionLabel="デザインプロジェクトを新規作成" onClick={() => navigate('/creator')} />
              <CreationCard icon={<Palette />} title="ブリン卜修正" actionLabel="プリントプロジェクトを新規作成" onClick={() => navigate('/printing')} />
              <CreationCard icon={<Layers />} title="生地イメージ" actionLabel="生地プロジェクトを新規作成" onClick={() => navigate('/tools/fabric')} />
              <CreationCard icon={<FileText />} title="企画提案書" actionLabel="企画提案書を新規作成" onClick={() => navigate('/agent')} />
            </section>
            <section className="mt-12" data-testid="design-production-persisted-projects">
              <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">マイプロジェクト</h2></div>
              {displayDesignArtifacts.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-5 py-12 text-center text-sm text-neutral-400">保存確認できたデザイン成果物はまだありません。生成結果を保存すると、ここに表示されます。</div> : <><div className="mt-4 grid gap-4 grid-cols-2 sm:grid-cols-5">{visibleProjectArtifacts.map((artifact) => <article key={artifact.id} className="relative h-60 overflow-visible rounded-2xl border border-white/10 bg-white/5 text-left hover:border-white/40"><button type="button" className="block h-full w-full cursor-pointer overflow-hidden rounded-2xl text-left" onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(artifact.id)}`)}><div className="h-36 bg-white/10">{artifact.imageUrl ? <img src={artifact.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <img src="https://jp.linkaigc.com/static/project_default_cover.png" alt="" className="h-12 w-12 object-contain" loading="lazy" />}</div><div className="p-4 pr-12"><p className="truncate font-medium">{pinnedProjectIds.has(artifact.id) ? '📌 ' : ''}{artifact.title}</p><p className="mt-2 truncate text-xs text-neutral-400">{artifact.featureType === 'design-production-source-fallback' ? formatDesignProductionSourceArtifactDate(artifact.createdAt) : `${artifact.featureType} ・ ${formatArtifactDate(artifact.createdAt)}`}</p></div></button><div className="absolute right-2 top-2 z-20"><button type="button" aria-label={`${artifact.title}のメニュー`} aria-expanded={openProjectMenuId === artifact.id} className="rounded-lg bg-black/45 p-2 text-neutral-200 hover:bg-black/70" onClick={(event) => { event.stopPropagation(); setOpenProjectMenuId((current) => current === artifact.id ? null : artifact.id); }}><MoreVertical className="h-4 w-4" /></button>{openProjectMenuId === artifact.id && <div role="menu" className="absolute right-0 top-full z-30 mt-2 min-w-48 rounded-lg border border-white/10 bg-[#202627] p-1 shadow-2xl"><button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={() => { setPinnedProjectIds((current) => { const next = new Set(current); if (next.has(artifact.id)) next.delete(artifact.id); else next.add(artifact.id); return next; }); setOpenProjectMenuId(null); }}>ピン留め</button><button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-neutral-200 hover:bg-white/10" onClick={() => { void saveDesignArtifactToLibrary(artifact); setOpenProjectMenuId(null); }}>アセットライブラリに保存</button><button type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10" onClick={() => deleteDesignArtifact(artifact)}>削除</button></div>}</div></article>)}</div><div className="mt-5 flex flex-wrap items-center justify-center gap-2" data-testid="design-production-pagination" aria-label="マイプロジェクトページング"><button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-300 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setProjectPage((page) => Math.max(1, page - 1))} disabled={projectPage === 1} aria-label="前のページ"><span role="img" aria-label="left"><ChevronLeft className="h-3 w-3" /></span></button>{Array.from({ length: projectPageCount }, (_, index) => <span key={index} aria-current={index + 1 === projectPage ? 'page' : undefined} className={`px-1.5 text-xs ${index + 1 === projectPage ? 'text-white' : 'text-neutral-500'}`}>{index + 1}</span>)}<button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-neutral-300 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setProjectPage((page) => Math.min(projectPageCount, page + 1))} disabled={projectPage === projectPageCount} aria-label="次のページ"><span role="img" aria-label="right"><ChevronRight className="h-3 w-3" /></span></button></div></>}</section>
          </div>
        )}
      </div>
    </ParityShell>
  );
}

function LightchainDialogueParityPanel({ onProjectStart }: { onProjectStart: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<boolean[]>(() => Array.from({ length: 5 }, () => true));
  const { currentBrand, user } = useAuthStore();
  const navigate = useNavigate();
  const currentBrandId = currentBrand?.id;
  const recentProjects = useMemo(
    () => (currentBrandId ? listWorkspaceArtifacts(currentBrandId, user?.id).slice(0, 5) : []),
    [currentBrandId, user?.id],
  );
  return (
    <ParityShell className="bg-[#171b1c] text-white" workflowFeature="print-design-project">
      <div className="relative z-10 mx-auto max-w-[1157px] px-5 py-7 lg:px-0">
        <div className="text-center">
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">デザインワークスペースへようこそ</h1>
          <p className="mt-3 text-sm text-neutral-400">アイデアを形にし、制作をスムーズに</p>
        </div>
        <div role="tablist" className="mx-auto mt-8 flex w-fit rounded-2xl border border-white/10 bg-white/10 p-1">
          <button type="button" role="tab" aria-selected={false} onClick={onProjectStart} className="h-10 w-[210px] rounded-xl px-0 py-1 text-lg font-medium text-neutral-400 hover:text-white">プロジェクトから開始</button>
          <button type="button" role="tab" aria-selected className="h-10 w-[146px] rounded-xl bg-white/15 px-0 py-1 text-lg font-medium text-white shadow-sm">対話から開始</button>
        </div>
        <div role="tabpanel" aria-label="対話から開始" className="relative left-1/2 mt-6 w-[960px] -translate-x-1/2">
          <div className="relative ml-[144px] h-[198px] w-[792px]">
            <textarea aria-label="商品画像をアップロードして、デザインのリクエストを教えてください" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="absolute left-0 top-8 h-20 w-[792px] resize-none rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus:border-white/60" placeholder="商品画像をアップロードして、デザインのリクエストを教えてください" />
            <span className="absolute left-0 top-[124px] text-xs text-neutral-500">{prompt.length} / 4000</span>
            <button type="button" disabled={!prompt.trim()} aria-label="送信" onClick={() => navigate(buildGenerationIntentHref({ feature: 'design-gacha', prompt, sourceWorkspace: 'design-production', workflowVersion: 'design-production-brief-local-v1', sourceLabel: workspaceSourceConfig['design-production'].label, sourceResumePath: workspaceSourceConfig['design-production'].resumePath, sourceMode: 'local-workflow-intake' }))} className="absolute -right-1 top-[158px] h-10 w-10 rounded-lg bg-white px-2 text-sm text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40">送信</button>
          </div>
          <p className="mt-[63px] text-sm text-neutral-400">下からデザインシーンを選択してお試しください <span aria-hidden="true">↘</span></p>
          <div className="mt-3 grid w-[960px] grid-cols-4 gap-2" aria-label="デザインシーン">
            {dialogueScenes.map(([title, scenePrompt]) => {
              const preview = recentProjects[dialogueScenes.findIndex(([item]) => item === title)]?.imageUrl;
              return (
                <button key={title} type="submit" onClick={() => { setSelectedScene(title); setPrompt(scenePrompt); setSelectedReferenceImages(Array.from({ length: 5 }, () => true)); }} className={`h-[120px] w-[234px] overflow-hidden rounded-2xl border bg-white/5 text-left transition hover:border-white/40 ${selectedScene === title ? 'border-white ring-1 ring-white' : 'border-white/10'}`}>
                  <div className="h-[70px] bg-white/10">{preview && <img src={preview} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
                  <span className="block px-3 pt-1 text-xs text-neutral-400">使ってみる</span>
                  <span className="block truncate px-3 text-sm font-semibold">{title}</span>
                </button>
              );
            })}
          </div>
          {selectedScene && <div className="mt-5 w-[792px] rounded-2xl border border-white/10 bg-white/5 p-4" aria-label="参照画像">
            <div className="flex flex-wrap gap-2">
              {selectedReferenceImages.map((isSelected, index) => isSelected && (
                <button key={index} type="button" aria-label={`画像${index + 1}を削除`} onClick={() => setSelectedReferenceImages((current) => current.map((value, currentIndex) => currentIndex === index ? false : value))} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200/60 bg-cyan-200/10 px-2.5 py-1.5 text-xs text-neutral-200 hover:border-cyan-100">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/15">画像{index + 1}</span><span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          </div>}
          <section className="mt-10 flex w-[960px] flex-col gap-4" data-testid="design-production-recent-projects">
            <div className="flex h-8 items-center">
              <h2 className="flex-1 text-lg font-medium leading-7">最近のプロジェクト</h2>
              <button type="submit" onClick={onProjectStart} className="flex h-8 w-[108px] items-center justify-end gap-0.5 rounded-lg py-1 pl-3 pr-2 text-neutral-300 hover:bg-white/10">
                <span className="text-base font-medium">すべて表示</span><ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-4">
              <div className="flex h-60 w-[225px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/5 text-neutral-300 transition hover:border-white/30 hover:bg-white/10" onClick={onProjectStart}>
                <Plus className="h-6 w-6" /><span className="mt-2 text-base font-medium">新規ファイル</span>
              </div>
              {recentProjects.map((artifact) => (
                <div key={artifact.id} className="group relative h-60 w-[220px] cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left hover:border-white/40" onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(artifact.id)}`)}>
                  <div className="h-[220px] bg-white/10">{artifact.imageUrl ? <img src={artifact.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <img src="https://jp.linkaigc.com/static/project_default_cover.png" alt="" className="mx-auto mt-20 h-12 w-12 object-contain" loading="lazy" />}</div>
                  <div className="absolute bottom-0 w-full bg-[#202627] px-3 py-3 text-sm text-neutral-300"><p className="truncate text-base">{artifact.title}</p><p className="mt-1 truncate text-xs text-neutral-400">{formatArtifactDate(artifact.createdAt)}</p></div>
                  <button type="button" aria-label="" className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-black/45 p-2 text-neutral-200 opacity-0 transition group-hover:opacity-100" onClick={(event) => event.stopPropagation()}><MoreVertical className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </section>
          <section className="mt-10 min-h-[calc(100vh-60px)] w-full" data-testid="design-production-reference-cases"><h2 className="mb-4 text-lg font-medium leading-7">参考事例</h2><div className="flex min-h-[70vh] flex-col items-center justify-center gap-2 text-sm text-neutral-500"><div className="flex min-h-[70vh] w-full items-center justify-center rounded-2xl border border-dashed border-white/10">データなし</div></div></section>
        </div>
      </div>
    </ParityShell>
  );
}

function FileCardIcon({ icon, title }: { icon: ReactNode; title: string; description?: string }) {
  return <div className="flex flex-col items-center text-center"><div className="flex h-12 w-12 items-center justify-center text-white">{icon}</div><h2 className="mt-4 text-sm font-semibold">{title}</h2></div>;
}

function CreationCard({
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
  const actionButtonWidth = {
    デザインプロジェクトを新規作成: 'w-[228px]',
    プリントプロジェクトを新規作成: 'w-[228px]',
    生地プロジェクトを新規作成: 'w-[204px]',
    企画提案書を新規作成: 'w-[168px]',
  }[actionLabel] ?? '';

  return (
    <div className="relative flex min-h-[160px] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-5 pb-0 text-left transition hover:border-white/40">
      <FileCardIcon icon={icon} title={title} />
      <button
        className={`absolute bottom-0 left-1/2 z-10 inline-flex h-8 -translate-x-1/2 ${actionButtonWidth} cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#0bc1b8] px-4 py-2 text-[12px] font-medium leading-[17.1429px] text-[#111817] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] transition-all hover:bg-[#20d0c4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70`}
        onClick={onClick}
      >
        {actionLabel}
      </button>
    </div>
  );
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


  return <ParityShell><div className="mx-auto flex max-w-[1480px] gap-6 px-5 py-8 sm:px-8 lg:px-10"><aside className={`${darkPanel} hidden w-64 shrink-0 p-3 lg:block`}><div className="px-3 py-3 text-xs font-semibold tracking-[0.2em] text-neutral-400">LIBRARY</div>{libraryGroups.map((group) => <button key={group} type="button" onClick={() => { setActiveGroup(group); setSelectedAsset(null); }} className={`flex w-full items-center rounded-xl px-3 py-3 text-left text-sm transition ${activeGroup === group ? 'bg-white text-neutral-950' : 'text-neutral-400 hover:bg-white/[0.06] hover:text-white'}`}><FolderOpen className="mr-2 h-4 w-4" />{group}</button>)}</aside><main className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.25em] text-cyan-200">LIGHTCHAIN AI / LIBRARY</p><h1 className="mt-3 text-3xl font-semibold">{activeGroup}</h1><p className="mt-2 text-sm text-neutral-500">生成済みの成果物は、次のCanvas作業へ同じ系譜で引き継げます。</p></div><div className="flex gap-2"><button type="button" className={`${mutedButton} opacity-60`} disabled title="素材の登録は各ワークベンチから行います"><Upload className="mr-2 inline h-4 w-4" />アップロード</button><button type="button" className={`${mutedButton} opacity-60`} disabled title="グループ管理はβ版で準備中"><Plus className="mr-2 inline h-4 w-4" />新規グループ作成</button></div></div><div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4"><div className="flex gap-2"><button type="button" className={`rounded-lg px-3 py-2 text-sm ${filter === '画像／動画' ? 'bg-white text-neutral-950' : 'text-neutral-400'}`} onClick={() => setFilter('画像／動画')}>画像／動画</button><button type="button" className={`rounded-lg px-3 py-2 text-sm ${filter === 'お気に入り' ? 'bg-white text-neutral-950' : 'text-neutral-400'}`} onClick={() => setFilter('お気に入り')}>お気に入り</button></div><label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-neutral-400"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-40 bg-transparent outline-none" placeholder="検索" aria-label="ライブラリー検索" /></label></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-neutral-400">選択済み ： {selectedIds.size} / {assets.length}</span>{selectMode ? <div className="flex flex-wrap gap-2"><button type="button" className={`${mutedButton} disabled:opacity-40`} disabled={selectedIds.size === 0} onClick={handleBulkCopy}>キャンバスをコピー</button><button type="button" className={`${mutedButton} disabled:opacity-40`} disabled={selectedIds.size === 0} onClick={() => void handleBulkDownload()}>ダウンロード</button><button type="button" className={`${mutedButton} disabled:opacity-40`} disabled={selectedIds.size === 0} onClick={handleBulkDelete}><Trash2 className="mr-2 inline h-4 w-4" />削除</button><button type="button" className={mutedButton} onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}>一括操作を閉じる</button></div> : <button type="button" className={mutedButton} onClick={() => setSelectMode(true)}>一括操作</button>}</div>{selectMode && <button type="button" className="mt-2 text-sm text-neutral-300 underline" onClick={() => setSelectedIds(new Set(assets.filter((asset) => asset.persisted).map((asset) => asset.id)))}>全選択</button>}{assets.length === 0 ? <div className="mt-10 flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-center"><Grid2X2 className="h-8 w-8 text-neutral-600" /><h2 className="mt-4 font-semibold">まだ素材がありません</h2><p className="mt-2 text-sm text-neutral-500">このグループに保存された生成結果はありません。</p></div> : <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{assets.map((asset) => <article key={asset.id} className={`overflow-hidden rounded-2xl border bg-[#151a1c] ${selectedAsset?.id === asset.id ? 'border-cyan-200 ring-1 ring-cyan-200/50' : 'border-white/10'}`}>{selectMode && <button type="button" className="w-full border-b border-white/10 px-3 py-2 text-left text-xs text-neutral-300 disabled:opacity-40" disabled={!asset.persisted} onClick={() => toggleSelectedAsset(asset.id)} aria-pressed={selectedIds.has(asset.id)}>{selectedIds.has(asset.id) ? "✓ 選択中" : "選択"}</button>}<button type="button" className="flex h-44 w-full items-center justify-center bg-[radial-gradient(circle_at_35%_35%,rgba(103,232,249,0.22),transparent_24%),linear-gradient(135deg,#263438,#111719)]" onClick={() => asset.persisted && setSelectedAsset(persistedArtifacts.find((candidate) => candidate.id === asset.id) ?? null)} aria-label={`${asset.title}を選択`}>{asset.imageUrl ? <img src={asset.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageIcon className="h-10 w-10 text-cyan-100/60" />}</button><div className="p-4"><p className="truncate text-sm font-medium">{asset.title}</p><p className="mt-1 truncate text-xs text-neutral-500">{asset.featureType}</p><div className="mt-3 flex gap-2"><button type="button" className="flex-1 rounded-lg border border-white/10 px-2 py-2 text-xs text-neutral-400 hover:text-white disabled:opacity-40" disabled={!asset.persisted} onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(asset.id)}`)}>ボードにコピー</button><button type="button" className="rounded-lg border border-white/10 px-2 py-2 text-xs text-neutral-400 hover:text-white disabled:opacity-40" disabled={!asset.persisted} onClick={() => setSelectedAsset(persistedArtifacts.find((candidate) => candidate.id === asset.id) ?? null)}>詳細</button></div></div></article>)}</div>}{selectedAsset && <aside className="mt-6 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-5" aria-live="polite"><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.2em] text-cyan-200">SELECTED ASSET</p><h2 className="mt-2 font-semibold">{selectedAsset.title}</h2></div><button type="button" className="text-sm text-neutral-400 hover:text-white" onClick={() => setSelectedAsset(null)}>閉じる</button></div><p className="mt-3 text-sm text-neutral-400">{selectedAsset.prompt || '保存済み成果物'}</p><button type="button" className="mt-4 rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-neutral-950" onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(selectedAsset.id)}`)}>Canvasへ送る</button></aside>}</main></div></ParityShell>;
}

const orientedDesignProjectImages = [
  null,
  'https://static-jp.linkaigc.com/saas/2026-03/19509c24192de2a2412746e144948051.jpg?x-oss-process=image/resize,m_lfit,w_640,limit_1/format,webp',
  'https://static-jp.linkaigc.com/cutout/2026/08/07/1786111982399-56819482-c9b2-4f9f.webp?x-oss-process=image/resize,m_lfit,w_640,limit_1/format,webp',
  null,
  'https://static-jp.linkaigc.com/saas/2026-08/eb450cb0c32120c34ea2d6bfbea2e2e2.webp?x-oss-process=image/resize,m_lfit,w_640,limit_1/format,webp',
  'https://static-jp.linkaigc.com/saas/2026-07/67656e58adbc399c1b34140aa15f10bc.webp?x-oss-process=image/resize,m_lfit,w_640,limit_1/format,webp',
  'https://static-jp.linkaigc.com/saas/2026-03/e061b3a2928e55dd4ea659bf9ca0b71c.webp?x-oss-process=image/resize,m_lfit,w_640,limit_1/format,webp',
  null,
  null,
  'https://static-jp.linkaigc.com/saas/2025-11/d7f1c73a093d95c637d06c393831f2d5.webp?x-oss-process=image/resize,m_lfit,w_640,limit_1/format,webp',
  null,
  null,
  null,
] as const;

const orientedDesignProjectDates = [
  '1ヶ月前 修正', '1ヶ月前 修正', '1ヶ月前 修正', '1ヶ月前 修正',
  '2ヶ月前 修正', '2ヶ月前 修正', '6ヶ月前 修正', '8ヶ月前 修正',
  '8ヶ月前 修正', '10ヶ月前 修正', '10ヶ月前 修正', '1年前 修正', '1年前 修正',
] as const;

const orientedDesignReferenceImages = [
  'https://lightchain-qlxy-test.oss-cn-hangzhou.aliyuncs.com/saas/2026-01/6a1d37284e65c215fe6fcd1994972a78.webp?x-oss-process=image/resize,m_lfit,w_3840,limit_1/format,webp',
  'https://lightchain-qlxy-test.oss-cn-hangzhou.aliyuncs.com/saas/2026-01/7a1e111e3f302abe404e6c0b347563ca.webp?x-oss-process=image/resize,m_lfit,w_3840,limit_1/format,webp',
] as const;

export function LightchainOrientedDesignPage() {
  const navigate = useNavigate();

  return (
    <ParityShell workflowFeature="wear-design-lab" className="oriented-design-parity">
      <div className="oriented-design-content">
        <h6 className="oriented-design-title">ウェアデザインラボ</h6>
        <section>
          <div className="oriented-design-card-grid">
            <div className="oriented-design-new-card" onClick={() => navigate('/flow/orientedDesign/detail')}>
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
            {orientedDesignProjectImages.map((image, index) => (
              <div key={`${orientedDesignProjectDates[index]}-${index}`} className="oriented-design-project-card" onClick={() => navigate(`/flow/orientedDesign/detail?project=${index + 1}`)}>
                <div className="oriented-design-project-media">
                  {image ? <img src={image} alt="coverImg" loading="lazy" /> : <img src="https://jp.linkaigc.com/static/project_default_cover.png" alt="coverImg" className="oriented-design-project-default-cover" loading="lazy" />}
                </div>
                <div className="oriented-design-project-meta">
                  <div className="oriented-design-project-name">Untitled</div>
                  <div className="oriented-design-project-date">{orientedDesignProjectDates[index]}</div>
                </div>
                <button type="button" className="oriented-design-project-menu" onClick={(event) => event.stopPropagation()}><MoreVertical className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="oriented-design-reference-cases">
          <h6 id="oriented-design-reference-cases" className="oriented-design-section-title">参考事例</h6>
          <div className="oriented-design-reference-grid">
            {orientedDesignReferenceImages.map((image, index) => (
              <div key={image} className="oriented-design-project-card" onClick={() => navigate(`/flow/orientedDesign/detail?reference=${index + 1}`)}>
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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageUrl(URL.createObjectURL(file));
  };

  return (
    <main className="dark min-h-[calc(100vh-50px)] overflow-hidden bg-[#181a1d] text-white" data-testid="oriented-design-detail" data-lightchain-parity-shell="oriented-design-detail">
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ backgroundImage: 'radial-gradient(#464b50 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
      <aside className="absolute left-4 top-[74px] z-10 w-[264px] overflow-hidden rounded-xl border border-white/10 bg-[#202426] shadow-xl">
        <div className="flex h-10 items-center gap-2 border-b border-white/10 px-2 text-sm text-neutral-400">
          <img src="https://jp.linkaigc.com/static/project_default_cover.png" alt="PROJECT" className="h-6 w-6 rounded-md object-cover" />
          <span>ウェアデザインラボ</span>
        </div>
        <button type="button" onClick={() => navigate('/flow/orientedDesign')} className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm text-neutral-400 transition hover:bg-white/5 hover:text-white">
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
        <input className="sr-only" type="file" accept=".png,.jpg,.jpeg,.avif,.webp" onChange={handleFileChange} />
      </label>
    </main>
  );
}
