import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Clock3,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  Layers,
  Palette,
  FileText,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
} from 'lucide-react';
import { buildGenerationIntentHref, workspaceSourceConfig } from '../lib/workspaceHandoff';
import { deleteWorkspaceArtifactsPersisted, listWorkspaceArtifacts, type WorkspaceArtifact } from '../lib/localWorkspaceArtifacts';
import { downloadValidatedImage } from '../lib/imageDownload';
import { persistPrintInputState, restorePrintInputState } from '../lib/printInputPersistence';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { useAuthStore } from '../stores/authStore';
import {
  getLightchainUnifiedFeatureWorkflowContract,
  UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION,
} from '../features/lightchain/unifiedFeatureWorkflowContract';
import { PermissionLockedButton } from '../components/lightchain/PermissionLockedButton';

const darkPanel = 'rounded-2xl border border-white/10 bg-[#151a1c]';
const mutedButton = 'rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-neutral-300 transition hover:border-cyan-200/50 hover:bg-white/[0.08] hover:text-white';

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
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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

const creatorCategoryGroups = [
  { label: 'トップス', items: ['ニット', 'ルームウェア', 'Tシャツ', 'パーカー', 'シャツ', 'タンクトップ', 'ベスト', 'スーツ', 'ブルゾン', 'トレンチコート', 'オーバーコート', 'ダウン', '下着', 'スイムウェア'] },
  { label: 'ボトムス', items: ['ルームウェア', 'ニットボトムス', 'ハーフスカート', 'パンツ'] },
  { label: 'ワンピース/セットアップ', items: ['ルームウェア', 'ウールワンピース', 'ワンピース', 'つなぎ'] },
] as const;

const creatorCategoryTabs = ['レディース', 'メンズ', '女の子', '男の子'] as const;

function CreatorCategoryPicker({ selectedCategory, onSelect }: { selectedCategory: string; onSelect: (category: string) => void }) {
  const [activeTab, setActiveTab] = useState<(typeof creatorCategoryTabs)[number]>('レディース');
  const [query, setQuery] = useState('');
  const visibleGroups = creatorCategoryGroups
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
        {visibleGroups.map((group) => <div key={group.label} className="mb-4"><button type="button" className="mb-3 flex items-center gap-1 text-xs font-semibold text-neutral-200" aria-expanded="true"><span className="text-neutral-400">▾</span>{group.label}</button><div className="grid grid-cols-4 gap-2 xl:grid-cols-8">{group.items.map((item, index) => <button key={`${group.label}-${item}-${index}`} type="button" aria-pressed={selectedCategory === `${activeTab}・${group.label}・${item}編み`} className={`flex min-h-[52px] items-center justify-center rounded-lg border px-2 py-2 text-center text-xs transition hover:border-cyan-300/70 hover:text-white ${selectedCategory === `${activeTab}・${group.label}・${item}編み` ? 'border-cyan-300 bg-cyan-300/20 text-cyan-100' : 'border-white/10 bg-white/[0.04] text-neutral-300'}`} onClick={() => onSelect(`${activeTab}・${group.label}・${item}編み`)}>{item}</button>)}</div>{selectedCategory.startsWith(`${activeTab}・${group.label}・`) && <div className="mt-2 flex flex-wrap gap-2 rounded-lg bg-white/[0.04] p-2"><span className="rounded-full bg-cyan-300 px-3 py-1 text-[11px] font-semibold text-neutral-950">必ず選択してください</span><button type="button" className="rounded-full bg-cyan-300 px-3 py-1 text-[11px] font-semibold text-neutral-950">{selectedCategory.split('・').at(-1)}</button><button type="button" className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-neutral-300">{group.items[0]}</button></div>}</div>)}
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
    <ParityShell workflowFeature="design-agent" className="bg-[#151a1c] text-white">
      <span className="sr-only" aria-label={`${displayName}さんのデザイン作成`} />
      <div className="mx-auto grid min-h-[calc(100vh-70px)] max-w-[1904px] gap-4 px-4 py-4 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
        <aside className="flex min-h-0 flex-col gap-4">
          <section className="rounded-xl bg-[#252a2d] p-4">
            <div className="flex w-full items-center gap-2"><h6 className="w-full text-sm font-semibold">デザインを選択してください</h6><span className="shrink-0 rounded bg-rose-400 px-2 py-1 text-[11px] font-bold text-white">必須項目</span></div>
            <button type="button" className="mt-4 w-full rounded-lg border border-dashed border-white/30 bg-[#171b1d] px-3 py-2 text-sm text-neutral-300" onClick={() => setCategoryPickerOpen((open) => !open)}>＋ {selectedCategory || 'カテゴリを選択してください'}</button>
            {categoryPickerOpen && <p className="mt-2 text-xs text-neutral-500">中央のカテゴリ一覧から選択してください。</p>}
            {categoryPickerOpen && <div className="fixed inset-x-[352px] bottom-4 top-[67px] z-20"><CreatorCategoryPicker selectedCategory={selectedCategory} onSelect={(category) => setSelectedCategory(category)} /></div>}
          </section>
          <section className="flex min-h-0 flex-1 flex-col rounded-xl bg-[#252a2d] p-4"><div className="flex items-center gap-2"><h6 className="text-sm font-semibold">画像をアップロード</h6><span className="text-xs text-neutral-400">オプション</span></div>{selectedCategory ? <><div className="mt-3 flex overflow-hidden rounded-lg border border-white/10 bg-[#171b1d] text-xs"><button type="button" className="flex-1 bg-cyan-300 px-3 py-2 font-semibold text-neutral-950">画像</button><button type="button" className="flex-1 px-3 py-2 text-neutral-300">生地画像</button></div><div className="mt-4 flex flex-1 items-center justify-center rounded-lg border border-white/10 bg-[#1b2022] text-center text-sm text-neutral-300"><button type="button" className="rounded-lg px-5 py-3" onClick={() => navigate('/asset-center')}><Upload className="mx-auto mb-2 h-6 w-6" />画像をアップロードします</button></div></> : <div className="flex flex-1 items-center justify-center"><button type="button" className="rounded-full bg-white/[0.08] px-5 py-3 text-sm text-neutral-300" onClick={() => navigate('/asset-center')}><Sparkles className="mr-2 inline h-4 w-4" />デザインを先に選択してください。</button></div>}</section>
        </aside>


        <main className="relative min-h-0 rounded-xl bg-[#151a1c] px-2 py-4 lg:px-8"><button type="button" className="absolute right-2 top-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-neutral-200" onClick={() => setHistoryOpen((open) => !open)}><Clock3 className="mr-2 inline h-4 w-4" />生成履歴</button><section className="flex min-h-full flex-col items-center justify-center pt-8"><h5 className="text-xl font-semibold text-cyan-300">インスピレーション</h5><p className="mt-2 text-sm text-neutral-400">AIで素早くデザイン開発、効率向上・コスト削減</p><div className="mt-6 h-[340px] w-full max-w-[1088px] overflow-hidden rounded-lg border border-white/10 bg-[#0d1113]"><video src="https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/tools/ja/%E6%9C%8D%E8%A3%85%E8%AE%BE%E8%AE%A1.mp4" className="h-full w-full object-cover" autoPlay controls playsInline aria-label="インスピレーション動画" /></div></section></main>
        <aside className="flex min-h-0 flex-col gap-4"><section className="min-h-[264px] rounded-xl bg-[#252a2d] p-4"><div className="flex h-full items-center justify-center text-center"><div><WandSparkles className="mx-auto h-12 w-12 text-cyan-300/70" /><p className="mt-4 text-sm text-neutral-300">このモジュールは購入後に使用可能。</p><p className="mt-2 text-xs text-neutral-400">ご担当の営業担当者にご連絡ください</p></div></div></section><section className="flex min-h-0 flex-1 flex-col rounded-xl bg-[#252a2d] p-4"><div className="flex items-center justify-between gap-3"><h6 className="text-sm font-semibold">キーワードを追加</h6><span className="text-xs text-neutral-400">オプション</span></div><textarea value={keywords} onChange={(event) => setKeywords(event.target.value)} className="mt-4 min-h-0 flex-1 resize-y rounded-lg border border-white/10 bg-[#252a2d] p-3 text-sm text-neutral-200 outline-none placeholder:text-neutral-500 focus:border-cyan-300" placeholder="生成画像について細かい指定がある場合は、こちらでキーワードを入力できます\n\n例1：オートミール色、H型カット、チェック柄生地、通勤用ワンピース…" maxLength={1000} aria-label="生成画像について細かい指定がある場合は、こちらでキーワードを入力できます" /><div className="mt-2 flex items-center justify-between text-xs text-neutral-400"><span>文字数: {keywords.length}/1000</span><button type="button" className="rounded border border-white/10 px-3 py-1" onClick={() => setKeywords('')} disabled={!keywords}>全削除</button><button type="button" className="rounded bg-cyan-300 px-3 py-1 font-semibold text-neutral-950" onClick={() => setDictionaryOpen(true)}>キーワード辞典</button></div><PermissionLockedButton testId="creator-permission" marginClass="mt-4" /></section></aside>
      </div>

      {historyOpen && <section className="mx-4 mb-4 rounded-xl border border-white/10 bg-[#252a2d] p-5" data-testid="creator-persisted-history"><h2 className="font-semibold">生成履歴</h2><PersistedHistoryPanel artifacts={historyArtifacts} emptyMessage="保存確認できたデザイン成果物はまだありません。provider生成後に保存すると、ここから再利用できます。" reuseLabel="Canvasへ再利用" onReuse={(artifact) => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(artifact.id)}`)} /></section>}
      {dictionaryOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" role="dialog" aria-modal="true" aria-label="キーワード辞典"><div className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-2xl border border-white/10 bg-[#252a2d] p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">キーワード辞典</h2><button type="button" className="rounded-lg border border-white/10 px-3 py-2 text-sm" onClick={() => setDictionaryOpen(false)}>閉じる</button></div><div className="mt-5 grid gap-2 sm:grid-cols-3">{['シルエット', '素材感', 'カラー', '柄・プリント', 'シーン', 'ディテール', '季節', '雰囲気', 'アイテム'].map((tag) => <button key={tag} type="button" className="rounded-xl border border-white/10 px-3 py-3 text-left text-sm text-neutral-300 hover:border-cyan-300" onClick={() => setKeywords((value) => `${value}${value ? '、' : ''}${tag}`)}>{tag}<ChevronRight className="float-right h-4 w-4 text-neutral-500" /></button>)}</div></div></div>}
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
        <aside className="hidden" aria-label="ツールバー">
          {[
            ['ツールバー', Grid2X2],
            ['デザインツール', WandSparkles],
            ['フィッティングツール', Sparkles],
            ['グラフィックデザインツール', ImageIcon],
            ['衣類生産ツール', FolderOpen],
          ].map(([label, Icon]) => {
            const ToolIcon = Icon as typeof Grid2X2;
            return <div key={label as string} className={`flex min-h-20 flex-col items-center justify-center rounded-xl border border-white/10 bg-[#252a2d] px-1 text-center text-[10px] leading-4 ${label === 'グラフィックデザインツール' ? 'text-cyan-300' : 'text-neutral-400'}`}><ToolIcon className="mb-1 h-7 w-7" /><span>{label as string}</span></div>;
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

        <nav className="absolute left-28 top-4 z-10 grid w-[564px] grid-cols-4 rounded-xl border border-neutral-200 bg-neutral-50 p-[2px]" aria-label="素材ツール">
          {[
            ['生地イメージ', '/tools/fabric'],
            ['プリントイメージ', '/tools/printing'],
            ['線画の実写化', '/tools/line-draft-to-tile'],
            ['平絵生成', '/tools/line'],
          ].map(([label, href]) => (
            <button key={label} type="button" className={`rounded-sm px-1 py-1 text-[15px] leading-[23px] font-medium transition ${href === '/tools/printing' ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-500 hover:text-neutral-900'}`} onClick={() => navigate(href)}>{label}</button>
          ))}
        </nav>

        <div className="mt-0 grid gap-4 lg:grid-cols-[minmax(0,596px)_minmax(0,1fr)]">
          <section className="relative h-[746px] min-h-0 overflow-hidden rounded-2xl bg-white p-4 pt-[68px] shadow-sm">
            {printingBannerVisible && <div className="flex h-16 items-start gap-2 rounded-lg bg-amber-50 px-4 py-[15px] text-sm leading-5 text-amber-900">
              <span className="flex-1">この機能はまもなく終了します。より高機能な画像生成機能はデザイン制作ワークスペースでご利用ください。<button type="button" className="ml-[15px] underline" onClick={() => navigate('/designProduction')}>今すぐ体験</button></span>
              <button type="button" aria-label="告知を閉じる" className="hidden" onClick={() => setPrintingBannerVisible(false)}>×</button>
            </div>}
            <label className="mt-[18px] flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded relative border border-dashed border-transparent bg-neutral-50 p-4 text-center transition hover:border-cyan-300/60">
              <input className="sr-only" type="file" accept="image/*" onChange={(event) => handleFile(event, 'base')} />
              {referenceImage ? <img src={referenceImage.url} alt="参考画像" className="max-h-56 max-w-full rounded-lg object-contain" /> : <><Upload className="h-8 w-8 text-neutral-400" /><span className="mt-2 text-base text-neutral-600">参考画像をアップロードしてください</span><span className="mt-2 text-xs text-neutral-500">20MB以下の画像アップロードしてください</span></>}
            </label>
            <div className="mt-4 flex items-center justify-between"><h2 className="font-semibold">プリントをアップロード</h2><button type="button" className="text-sm text-neutral-500 underline" onClick={() => { setReferenceImage(null); setPrintImage(null); setMessage(''); if (user?.id && currentBrand?.id && persistenceScope) void persistPrintInputState(currentBrand.id, null, [], { garment: null, designs: [] }, { scope: persistenceScope }).catch(() => undefined); }}>リセット</button></div>
            <div className="mt-3 grid w-[244px] grid-cols-2 rounded-xl border border-neutral-200 bg-neutral-50 p-1">
              {(['spot', 'full'] as const).map((value) => <button key={value} type="button" aria-pressed={coverage === value} className={`rounded-lg px-4 py-3 text-sm font-semibold ${coverage === value ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-500'}`} onClick={() => setCoverage(value)}>{value === 'spot' ? 'スポット' : '全体'}</button>)}
            </div>
            <label className="mt-3 flex h-[120px] w-[120px] cursor-pointer flex-col items-center justify-center rounded relative border border-dashed border-transparent bg-neutral-50 p-4 text-center transition hover:border-cyan-300/60">
              <input className="sr-only" type="file" accept="image/*" onChange={(event) => handleFile(event, 'pattern')} />
              {printImage ? <img src={printImage.url} alt="プリント画像" className="h-full w-full rounded-lg object-contain" /> : <><Upload className="h-6 w-6 text-neutral-400" /><span className="mt-2 text-base text-neutral-600">画像をアップロード</span><span className="mt-2 text-xs text-neutral-500">20MB以下の画像アップロードしてください</span></>}
            </label>
            <button type="button" className="absolute bottom-4 right-4 h-10 w-[288px] rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white transition hover:bg-neutral-800" onClick={() => void handleGenerate()}>AI生成</button>
            {message && <p className="mt-3 text-sm text-neutral-600" role="status">{message}</p>}
          </section>

          <aside className="space-y-4">
            <section className="flex min-h-[802px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#151a1c] p-5 text-center shadow-sm"><h2 className="text-xl font-bold text-white">プリントイメージ</h2><p className="mt-2 text-sm leading-[21px] text-neutral-400">プリントイメージを使用し、版下を作成せずに印刷効果を確認できます</p><video src="https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/tools/ja/%E5%8D%B0%E6%9F%93%E4%B8%8A%E8%BA%AB.mp4" className="mt-4 h-[340px] w-[605px] max-w-full rounded-lg object-cover" autoPlay controls muted playsInline aria-label="プリントイメージ動画" /></section>
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
  const [activeTab, setActiveTab] = useState<'通常版' | 'プロフェッショナル版'>('通常版');
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [layerModes, setLayerModes] = useState<Array<'stack' | 'split'>>(['stack']);
  const [usage, setUsage] = useState(7);
  const navigate = useNavigate();

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
    <ParityShell workflowFeature="pattern-vector-pro" className="bg-white text-neutral-900">
      <div className="mx-auto max-w-[1648px] py-3">
        <div className="inline-flex h-[46px] w-[564px] rounded-lg border border-neutral-200 bg-white p-1" role="tablist" aria-label="ベクター化モード">
          <button type="button" role="tab" aria-selected={activeTab === '通常版'} className={`w-[278px] rounded-md px-2 py-2 text-sm font-semibold ${activeTab === '通常版' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-500'}`} onClick={() => setActiveTab('通常版')}>パターンをベクター画像に変換（通常版）</button>
          <button type="button" role="tab" aria-selected={activeTab === 'プロフェッショナル版'} className={`w-[278px] rounded-md px-2 py-2 text-sm font-semibold ${activeTab === 'プロフェッショナル版' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-500'}`} onClick={() => setActiveTab('プロフェッショナル版')}>パターンをベクター画像に変換（プロフェッショナル版）</button>
        </div>
      </div>
      <div className="mx-auto grid max-w-[1648px] gap-10 pb-12 lg:grid-cols-[564px_minmax(0,1fr)]">
        <section className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
          <div className="rounded-lg bg-neutral-50 p-5 text-sm text-neutral-700">
            <p>この機能はまもなく終了します。</p>
            <p>より高機能な画像生成機能はデザイン制作ワークスペースでご利用ください</p>
            <button type="button" className="mt-3 font-semibold text-neutral-950 underline" onClick={() => navigate('/designProduction')}>今すぐ体験</button>
          </div>
          <label className="mt-8 flex min-h-[244px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 text-center">
            <input className="sr-only" type="file" accept="image/*" onChange={handleReferenceImage} />
            {referenceImage ? <img src={referenceImage} alt="参考画像" className="max-h-56 max-w-full rounded-lg object-contain" /> : <><Upload className="h-8 w-8 text-neutral-400" /><span className="mt-3 text-sm font-semibold">参考画像をアップロードしてください</span><span className="mt-1 text-xs text-neutral-500">20MB以下の画像アップロードしてください</span></>}
          </label>
          <div className="mt-6 flex items-center justify-between gap-4 text-sm text-neutral-600"><span>レイヤー分け方法を選択してください（複数選択可）</span><button type="button" className="text-xs font-semibold underline" onClick={reset}>リセット</button></div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {([['stack', '積み重ね'], ['split', '分割']] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={layerModes.includes(mode)}
                className={`rounded-lg px-4 py-3 text-sm font-semibold ${layerModes.includes(mode) ? 'bg-[#737d84] text-white' : 'border border-neutral-200 hover:bg-neutral-50'}`}
                onClick={() => toggleLayerMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-between text-xs text-neutral-500"><span>使用回数 {usage} / 30</span><button type="button" className="w-[288px] rounded-lg bg-neutral-950 px-5 py-3 text-sm font-semibold text-white" onClick={() => { setUsage((count) => Math.min(30, count + 1)); navigate('/tools/pattern-to-vector'); }}>AI生成 1</button></div>
        </section>
        <section className="flex min-h-[620px] flex-col rounded-xl border border-neutral-200 bg-neutral-50 p-8">
          <div className="flex items-center justify-end"><button type="button" className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold" onClick={() => navigate('/history')}>生成履歴</button></div>
          <div className="flex flex-1 flex-col items-center justify-center text-center"><h1 className="text-2xl font-semibold">パターンをベクター画像に変換（{activeTab}）</h1><p className="mt-4 text-sm text-neutral-600">プリントパターンをベクター画像に変換します</p><p className="mt-8 text-sm text-neutral-500">{referenceImage ? '参考画像を確認できます' : '素材選択後に表示'}</p></div>
        </section>
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
    navigate(`/fitting?${params.toString()}#fitting-material-workbench`);
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
              onReuse={(artifact) => navigate(`/fitting?resumeJob=${encodeURIComponent(artifact.sourceJobId ?? artifact.id)}`)}
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
  ['ブリン卜修正', '画像1の要素を参考に、四方連続のプリントパターンをデザインし、画像2をレイアウトの参考にしてください', '印花设计'],
] as const;

type GalleryReferenceAsset = {
  id: string;
  label: string;
  src: string;
};

export function LightchainDesignProductionPage() {
  const [activeTab, setActiveTab] = useState('プロジェクトから開始');
  const [dialoguePrompt, setDialoguePrompt] = useState('');
  const [activeScene, setActiveScene] = useState('');
  const [activeAssetSlot, setActiveAssetSlot] = useState<0 | 1>(0);
  const [galleryReferenceAssets, setGalleryReferenceAssets] = useState<GalleryReferenceAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<[string | null, string | null]>([null, null]);
  const [persistedDesignArtifacts, setPersistedDesignArtifacts] = useState<WorkspaceArtifact[]>([]);
  const { currentBrand, user } = useAuthStore();
  const navigate = useNavigate();

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
    if (!currentBrand?.id) {
      setPersistedDesignArtifacts([]);
      setGalleryReferenceAssets([]);
      setSelectedAssetIds([null, null]);
      return;
    }
    const artifacts = listWorkspaceArtifacts(currentBrand.id, user?.id);
    setPersistedDesignArtifacts(
      artifacts
        .filter((artifact) => designHistoryFeatureTypes.has(artifact.featureType))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    );
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
  }, [currentBrand?.id, user?.id]);
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
    <ParityShell className="bg-[#171b1c] text-white" workflowFeature="print-design-project">
      <div data-testid="design-production-page" className="mx-auto max-w-[1157px] px-5 py-10 sm:px-8 lg:px-0"><div className="text-center"><p className="text-xs font-semibold tracking-[0.25em] text-neutral-400">LIGHTCHAIN AI / DESIGN PRODUCTION</p><h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">デザインワークスペースへようこそ</h1><p className="mt-3 text-sm text-neutral-400">アイデアを形にし、制作をスムーズに</p></div>
        <div role="tablist" aria-label="デザイン制作の開始方法" className="mx-auto mt-8 flex w-fit rounded-2xl border border-white/10 bg-white/10 p-1">{['プロジェクトから開始', '対話から開始'].map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`rounded-xl px-5 py-2.5 text-sm font-medium transition ${activeTab === tab ? 'bg-white/15 text-white shadow-sm' : 'text-neutral-400 hover:text-white'}`}>{tab}</button>)}</div>
        {activeTab === '対話から開始' ? <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-8"><div className="flex items-center gap-3"><WandSparkles className="h-5 w-5" /><h2 className="font-semibold">対話から開始</h2></div><p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400">既存のGallery素材を組み合わせ、作りたい変更内容を対話で指定します。</p><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{dialogueScenes.map(([title, prompt, iconLabel]) => <button key={title} type="button" onClick={() => { setActiveScene(title); setDialoguePrompt(prompt); }} className={`rounded-2xl border bg-white/5 p-4 text-left transition hover:border-white/40 ${activeScene === title ? 'border-white ring-1 ring-white' : 'border-white/10'}`}><div className="flex h-20 items-center justify-center rounded-xl bg-white/10 text-xs font-semibold text-neutral-400">{iconLabel}</div><p className="mt-3 text-sm font-semibold">{title}</p><span className="mt-2 block text-xs text-neutral-400">使ってみる</span></button>)}</div>{activeScene && <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-semibold text-neutral-400">Gallery素材を組み合わせる</p><div className="mt-3 grid gap-3 sm:grid-cols-3">{galleryReferenceAssets.map((asset) => <button key={asset.id} type="button" onClick={() => setSelectedAssets((current) => { const next: [typeof galleryReferenceAssets[number], typeof galleryReferenceAssets[number]] = [...current]; next[activeAssetSlot] = asset; return next; })} className={`overflow-hidden rounded-xl border text-left transition ${selectedAssets[activeAssetSlot].id === asset.id ? 'border-white ring-1 ring-white' : 'border-white/10 hover:border-white/40'}`}><div className="h-24 bg-white/10"><img src={asset.src} alt={asset.label} className="h-full w-full object-cover" loading="lazy" /></div><div className="px-3 py-2 text-xs text-neutral-300">{asset.label}</div></button>)}</div><div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-400"><button type="button" onClick={() => setActiveAssetSlot(0)} className={`rounded-full border px-3 py-1.5 ${activeAssetSlot === 0 ? 'border-white text-white' : 'border-white/10'}`}>画像1を選択</button><button type="button" onClick={() => setActiveAssetSlot(1)} className={`rounded-full border px-3 py-1.5 ${activeAssetSlot === 1 ? 'border-white text-white' : 'border-white/10'}`}>画像2を選択</button></div></div>}{activeScene && <div className="mt-5 grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[180px_180px_minmax(0,1fr)]"><div className="overflow-hidden rounded-xl bg-white/10"><img src={selectedAssets[0].src} alt="画像1" className="h-28 w-full object-cover" loading="lazy" /><p className="px-2 py-1 text-xs text-neutral-400">画像1: {selectedAssets[0].label}</p></div><div className="overflow-hidden rounded-xl bg-white/10"><img src={selectedAssets[1].src} alt="画像2" className="h-28 w-full object-cover" loading="lazy" /><p className="px-2 py-1 text-xs text-neutral-400">画像2: {selectedAssets[1].label}</p></div><div><textarea value={dialoguePrompt} onChange={(event) => setDialoguePrompt(event.target.value)} className="min-h-28 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus:border-white/60" aria-label="商品画像をアップロードして、デザインのリクエストを教えてください" /><div className="mt-2 text-right text-xs text-neutral-500">{dialoguePrompt.length} / 4000</div></div></div>}<div className="mt-5 max-w-2xl"><div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2"><Sparkles className="h-4 w-4 text-neutral-400" /><input value={dialoguePrompt} onChange={(event) => setDialoguePrompt(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-500" placeholder="作りたいデザインを入力してください" /><button type="button" className="rounded-lg bg-white px-4 py-2 text-sm text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canOpenProposal} onClick={openProposal}>提案を見る</button></div>{(!trimmedDialoguePrompt || !hasTwoReferenceAssets) && <div id="design-production-proposal-requirements" className="mt-2 space-y-1 text-xs text-neutral-400" aria-live="polite">{!trimmedDialoguePrompt && <p>依頼文を入力してください。</p>}{!hasTwoReferenceAssets && <div className="flex flex-wrap items-center gap-2"><p>{referenceRequirementMessage}</p>{galleryReferenceAssets.length === 0 && <button type="button" className="rounded-lg border border-white/20 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:border-white/50" onClick={() => navigate('/asset-center')}>ライブラリーを開く</button>}</div>}</div>}</div></section> : <><section className="mt-8 grid gap-4 grid-cols-2 lg:grid-cols-4"><button type="button" className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left hover:border-white/40" onClick={() => navigate('/canvas/new')}><FileCardIcon icon={<Plus />} title="新規ファイル" description="白紙のキャンバスから始める" /></button><button type="button" className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left hover:border-white/40" onClick={() => navigate('/printing')}><FileCardIcon icon={<Palette />} title="ブリン卜修正" description="プリントデザインを始める" /></button><button type="button" className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left hover:border-white/40" onClick={() => navigate('/tools/fabric')}><FileCardIcon icon={<Layers />} title="生地イメージ" description="生地のシミュレーションを始める" /></button><button type="button" className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left hover:border-white/40" onClick={() => navigate('/agent')}><FileCardIcon icon={<FileText />} title="企画提案書" description="企画提案書を作成する" /></button></section><section className="mt-12" data-testid="design-production-persisted-projects"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">マイプロジェクト</h2><span className="text-sm text-neutral-400">{persistedDesignArtifacts.length}件</span></div>{persistedDesignArtifacts.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-5 py-12 text-center text-sm text-neutral-400">保存確認できたデザイン成果物はまだありません。生成結果を保存すると、ここに表示されます。</div> : <div className="mt-4 grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">{persistedDesignArtifacts.slice(0, 12).map((artifact) => <button type="button" key={artifact.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left hover:border-white/40" onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(artifact.id)}`)}><div className="h-36 bg-white/10">{artifact.imageUrl && <img src={artifact.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}</div><div className="p-4"><p className="truncate font-medium">{artifact.title}</p><p className="mt-2 truncate text-xs text-neutral-400">{artifact.featureType} ・ {formatArtifactDate(artifact.createdAt)}</p></div></button>)}</div>}</section></>}
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
      <div className="mx-auto max-w-[1157px] px-5 py-10 sm:px-8 lg:px-0">
        <div className="text-center">
          <p className="text-xs font-semibold tracking-[0.25em] text-neutral-400">LIGHTCHAIN AI / DESIGN PRODUCTION</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">デザインワークスペースへようこそ</h1>
          <p className="mt-3 text-sm text-neutral-400">アイデアを形にし、制作をスムーズに</p>
        </div>
        <div role="tablist" aria-label="デザイン制作の開始方法" className="mx-auto mt-8 flex w-fit rounded-2xl border border-white/10 bg-white/10 p-1">
          <button type="button" role="tab" aria-selected={false} onClick={onProjectStart} className="rounded-xl px-5 py-2.5 text-sm font-medium text-neutral-400 hover:text-white">プロジェクトから開始</button>
          <button type="button" role="tab" aria-selected className="rounded-xl bg-white/15 px-5 py-2.5 text-sm font-medium text-white shadow-sm">対話から開始</button>
        </div>
        <section className="mt-8">
          <div className="flex items-center gap-3">
            <WandSparkles className="h-5 w-5" />
            <h2 className="font-semibold">対話から開始</h2>
          </div>
          <div className="mt-5 flex flex-wrap gap-3" aria-label="デザインシーン">
            {dialogueScenes.map(([title, scenePrompt, iconLabel]) => (
              <button key={title} type="button" onClick={() => { setSelectedScene(title); setPrompt(scenePrompt); setSelectedReferenceImages(Array.from({ length: 5 }, () => true)); }} className={`rounded-2xl border bg-white/5 px-4 py-3 text-left transition hover:border-white/40 ${selectedScene === title ? 'border-white ring-1 ring-white' : 'border-white/10'}`}>
                <span className="block text-xs font-semibold text-neutral-300">{iconLabel}</span>
                <span className="mt-2 block text-xs text-neutral-400">使ってみる</span>
                <span className="mt-1 block text-sm font-semibold">{title}</span>
              </button>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            {selectedScene && <div className="flex flex-wrap gap-2" aria-label="参照画像">
              {selectedReferenceImages.map((isSelected, index) => isSelected && (
                <button key={index} type="button" aria-label={`画像${index + 1}を削除`} onClick={() => setSelectedReferenceImages((current) => current.map((value, currentIndex) => currentIndex === index ? false : value))} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200/60 bg-cyan-200/10 px-2.5 py-1.5 text-xs text-neutral-200 hover:border-cyan-100">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/15">画像{index + 1}</span><span aria-hidden="true">×</span>
                </button>
              ))}
            </div>}
            <textarea aria-label="デザインのリクエスト" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="mt-4 min-h-28 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus:border-white/60" placeholder="デザインのリクエストを入力してください" />
            <div className="mt-2 flex items-center justify-between text-xs text-neutral-500"><span>{prompt.length} / 4000</span><button type="button" disabled={!prompt.trim()} onClick={() => navigate(buildGenerationIntentHref({ feature: 'design-gacha', prompt, sourceWorkspace: 'design-production', workflowVersion: 'design-production-brief-local-v1', sourceLabel: workspaceSourceConfig['design-production'].label, sourceResumePath: workspaceSourceConfig['design-production'].resumePath, sourceMode: 'local-workflow-intake' }))} className="rounded-lg bg-white px-4 py-2 text-sm text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40">送信</button></div>
          </div>
          <p className="mt-5 text-sm text-neutral-400">下からデザインシーンを選択してお試しください</p>
        </section>
        <section className="mt-10" data-testid="design-production-recent-projects">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">最近のプロジェクト</h2><button type="button" onClick={onProjectStart} className="text-sm text-neutral-300 hover:text-white">すべて表示</button></div>
          <p className="mt-3 text-xs text-neutral-400">新規ファイル</p>
          {recentProjects.length > 0 && <div className="mt-3 grid gap-4 grid-cols-2 md:grid-cols-5">{recentProjects.map((artifact) => <button type="button" key={artifact.id} onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(artifact.id)}`)} className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left hover:border-white/40"><div className="h-28 bg-white/10">{artifact.imageUrl && <img src={artifact.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}</div><div className="p-3"><p className="truncate text-sm font-medium">{artifact.title}</p><p className="mt-1 truncate text-xs text-neutral-400">{formatArtifactDate(artifact.createdAt)}</p></div></button>)}</div>}
        </section>
        <section className="mt-10" data-testid="design-production-reference-cases"><h2 className="text-lg font-semibold">参考事例</h2><div className="mt-4 flex min-h-24 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-neutral-500">データなし</div></section>
      </div>
    </ParityShell>
  );
}

function FileCardIcon({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700">{icon}</div><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 text-sm text-neutral-500">{description}</p></>;
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

export function LightchainOrientedDesignPage() {
  const { currentBrand, user } = useAuthStore();
  const [historyArtifacts, setHistoryArtifacts] = useState<WorkspaceArtifact[]>([]);
  const navigate = useNavigate();

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
    <ParityShell workflowFeature="wear-design-lab">
      <div className="mx-auto max-w-[1380px] px-5 py-8 sm:px-8 lg:px-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.25em] text-cyan-200">LIGHTCHAIN AI / LAB</p>
            <h1 className="mt-3 text-3xl font-semibold">ウェアデザインラボ</h1>
            <p className="mt-2 text-sm text-neutral-400">参考素材を組み合わせ、デザイン候補を比較する作業台です。</p>
          </div>
          <Link to="/designProduction" className={mutedButton}>デザインワークスペースへ</Link>
        </div>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {['新しいデザインを作成', '既存プロジェクトを続ける', '参考画像を整理する'].map((title, index) => (
            <Link key={title} to={index === 1 ? '/designProduction' : index === 2 ? '/asset-center' : '/creator'} className={`${darkPanel} group p-5 transition hover:-translate-y-0.5 hover:border-cyan-200/50`}>
              <div className="flex h-28 items-center justify-center rounded-xl bg-[radial-gradient(circle_at_35%_35%,rgba(103,232,249,0.24),transparent_25%),linear-gradient(135deg,#263438,#111719)]"><WandSparkles className="h-9 w-9 text-cyan-100" /></div>
              <h2 className="mt-4 font-semibold">{title}<ArrowRight className="float-right h-4 w-4 text-neutral-500 transition group-hover:translate-x-1" /></h2>
              <p className="mt-2 text-sm text-neutral-500">作業の状態と次のアクションを確認できます。</p>
            </Link>
          ))}
        </div>
        <section className={`${darkPanel} mt-6 p-5`} data-testid="oriented-design-persisted-history">
          <div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-cyan-200" /><h2 className="font-semibold">タスク履歴</h2></div>
          <PersistedHistoryPanel
            artifacts={historyArtifacts}
            emptyMessage="保存確認できたデザインタスクはまだありません。生成結果を保存すると、ここからCanvasへ再利用できます。"
            reuseLabel="Canvasへ再利用"
            onReuse={(artifact) => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(artifact.id)}`)}
          />
        </section>
      </div>
    </ParityShell>
  );
}
