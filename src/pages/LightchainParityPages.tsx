import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  Plus,
  Search,
  Sparkles,
  Upload,
  WandSparkles,
} from 'lucide-react';
import { buildGenerationIntentHref, workspaceSourceConfig } from '../lib/workspaceHandoff';
import { listWorkspaceArtifacts, type WorkspaceArtifact } from '../lib/localWorkspaceArtifacts';
import { useAuthStore } from '../stores/authStore';
import {
  getLightchainUnifiedFeatureWorkflowContract,
  UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION,
} from '../features/lightchain/unifiedFeatureWorkflowContract';

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

const creatorCategories = [
  ['女性', 'bg-gradient-to-br from-rose-200 to-orange-100'],
  ['男性', 'bg-gradient-to-br from-sky-200 to-indigo-200'],
  ['キッズ', 'bg-gradient-to-br from-lime-200 to-emerald-200'],
  ['ユニセックス', 'bg-gradient-to-br from-neutral-100 to-neutral-300'],
] as const;

export function LightchainCreatorPage() {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [keywords, setKeywords] = useState('');
  const [activeCreatorTab, setActiveCreatorTab] = useState('企画案');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [historyArtifacts, setHistoryArtifacts] = useState<WorkspaceArtifact[]>([]);
  const { currentBrand, user, profile } = useAuthStore();
  const navigate = useNavigate();
  const creatorDisplayName = profile?.name?.trim()
    || String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? '').trim()
    || user?.email?.split('@')[0]
    || 'チームメンバー';

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

  const openGenerationWorkspace = () => {
    const params = new URLSearchParams({
      source: 'lightchain-creator-heavy-fallback',
      prompt: keywords.trim() || 'アパレル新作のデザイン方向性を複数案で比較',
      category: selectedCategory || 'ユニセックス',
    });
    navigate(`/generate?feature=design-gacha&${params.toString()}`);
  };

  return (
    <ParityShell workflowFeature="design-agent">
      <div className="mx-auto max-w-[1420px] px-5 py-8 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.25em] text-cyan-200">LIGHTCHAIN AI / CREATOR</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">Hello, {creatorDisplayName}</h1>
            <p className="mt-2 text-sm text-neutral-400">今日はどんなデザインが必要ですか?</p>
            <SegmentedTabs items={['企画案', 'インスピレーション', 'AIグラフィックデザイン']} active={activeCreatorTab} onChange={setActiveCreatorTab} />
          </div>
          <button type="button" className={mutedButton} onClick={() => setHistoryOpen((open) => !open)}>
            <Clock3 className="mr-2 inline h-4 w-4" />履歴を表示
          </button>
        </div>

        <section className={`${darkPanel} mt-6 p-5 sm:p-7`} data-lightchain-parity-shell="design-agent">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{activeCreatorTab}</h2>
            <span className="text-xs text-neutral-500">{keywords.length} / 4000</span>
          </div>
          <textarea
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            className="mt-4 min-h-32 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-cyan-200/60"
            placeholder="デザインのリクエストを教えてください"
            aria-label="デザインのリクエスト"
            maxLength={4000}
          />
          <div className="mt-3 flex justify-end">
            <button type="button" className="rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200" onClick={openGenerationWorkspace}>
              送信 <ArrowRight className="ml-1 inline h-4 w-4" />
            </button>
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className={`${darkPanel} p-5 sm:p-7`}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">デザインカテゴリ</h2>
              <span className="text-xs text-neutral-500">1つ選択</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {creatorCategories.map(([label, tone]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSelectedCategory(label)}
                  className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition ${selectedCategory === label ? 'border-cyan-200 bg-cyan-200/10' : 'border-white/10 bg-white/[0.03] hover:border-white/30'}`}
                >
                  <div className={`h-28 rounded-xl ${tone} opacity-90 transition group-hover:scale-[1.02]`} />
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-semibold">{label}</span>
                    {selectedCategory === label && <Check className="h-4 w-4 text-cyan-200" />}
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-dashed border-white/20 bg-white/[0.02] p-5">
              <div className="flex items-start gap-3">
                <Upload className="mt-0.5 h-5 w-5 text-cyan-200" />
                <div>
                  <h3 className="font-medium">参考画像をアップロード（任意）</h3>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">既存素材やギャラリーの画像を組み合わせて、デザインの方向性を伝えます。</p>
                </div>
              </div>
              <button type="button" className={`${mutedButton} mt-4`} onClick={() => navigate('/asset-center')}>
                ライブラリーから選択 <ArrowRight className="ml-2 inline h-4 w-4" />
              </button>
            </div>
          </section>

          <aside className="space-y-6">
            <section className={`${darkPanel} p-5`}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">インスピレーション</h2>
              </div>
              <div className="mt-4 h-24 rounded-xl bg-[radial-gradient(circle_at_30%_35%,rgba(103,232,249,0.28),transparent_24%),linear-gradient(135deg,#293536,#131719)]" />
            </section>
            <section className={`${darkPanel} p-5`}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">キーワード</h2>
                <button type="button" className="text-xs text-cyan-200 hover:text-white" onClick={() => setDictionaryOpen(true)}>キーワード辞典</button>
              </div>
              <textarea
                value={keywords}
                onChange={(event) => setKeywords(event.target.value)}
                className="mt-4 min-h-32 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-cyan-200/60"
                placeholder="例：オートミール色、チェック柄、生地感、通勤用ワンピース"
              />
              <button type="button" className="mt-3 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200" onClick={openGenerationWorkspace}>
                生成条件を開く <ArrowRight className="ml-1 inline h-4 w-4" />
              </button>
            </section>
          </aside>
        </div>

        {historyOpen && (
          <section className={`${darkPanel} mt-6 p-5`} data-testid="creator-persisted-history">
            <h2 className="font-semibold">生成履歴</h2>
            <PersistedHistoryPanel
              artifacts={historyArtifacts}
              emptyMessage="保存確認できたデザイン成果物はまだありません。provider生成後に保存すると、ここから再利用できます。"
              reuseLabel="Canvasへ再利用"
              onReuse={(artifact) => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(artifact.id)}`)}
            />
          </section>
        )}
      </div>

      {dictionaryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" role="dialog" aria-modal="true" aria-label="キーワード辞典">
          <div className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-3xl border border-white/15 bg-[#111719] p-6 shadow-2xl">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">キーワード辞典</h2><button type="button" className={mutedButton} onClick={() => setDictionaryOpen(false)}>閉じる</button></div>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">{['シルエット', '素材感', 'カラー', '柄・プリント', 'シーン', 'ディテール', '季節', '雰囲気', 'アイテム'].map((tag) => <button key={tag} type="button" className="rounded-xl border border-white/10 px-3 py-3 text-left text-sm text-neutral-300 hover:border-cyan-200/50 hover:text-white" onClick={() => setKeywords((value) => `${value}${value ? '、' : ''}${tag}`)}>{tag}<ChevronRight className="float-right h-4 w-4 text-neutral-500" /></button>)}</div>
          </div>
        </div>
      )}
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
  ['プリント修正', '画像1の要素を参考に、四方連続のプリントパターンをデザインし、画像2をレイアウトの参考にしてください', '印花设计'],
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
  return (
    <ParityShell className="bg-white text-neutral-900" workflowFeature="print-design-project">
      <div className="mx-auto max-w-[1380px] px-5 py-10 sm:px-8 lg:px-10"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold tracking-[0.25em] text-neutral-400">LIGHTCHAIN AI / DESIGN PRODUCTION</p><h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">デザインワークスペースへようこそ</h1><p className="mt-3 text-sm text-neutral-500">プロジェクトまたは対話から、デザイン制作を開始できます。</p></div><div className="flex gap-2"><button type="button" className="rounded-xl border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50" onClick={() => navigate('/canvas/new')}><Plus className="mr-2 inline h-4 w-4" />新規ファイル</button><button type="button" className="rounded-xl bg-neutral-950 px-4 py-2 text-sm text-white hover:bg-neutral-800" onClick={() => navigate('/designProduction/detail?boardProjectCode=new')}>新規プロジェクト</button></div></div>
        <div className="mt-10 border-b border-neutral-200"><div className="flex gap-6">{['プロジェクトから開始', '対話から開始'].map((tab) => <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`border-b-2 px-1 pb-3 text-sm font-medium ${activeTab === tab ? 'border-neutral-950 text-neutral-950' : 'border-transparent text-neutral-400'}`}>{tab}</button>)}</div></div>
        {activeTab === '対話から開始' ? <section className="mt-8 rounded-3xl border border-neutral-200 bg-neutral-50 p-8"><div className="flex items-center gap-3"><WandSparkles className="h-5 w-5" /><h2 className="font-semibold">対話から開始</h2></div><p className="mt-3 max-w-xl text-sm leading-6 text-neutral-500">既存のGallery素材を組み合わせ、作りたい変更内容を対話で指定します。</p><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{dialogueScenes.map(([title, prompt, iconLabel]) => <button key={title} type="button" onClick={() => { setActiveScene(title); setDialoguePrompt(prompt); }} className={`rounded-2xl border bg-white p-4 text-left transition hover:border-neutral-500 ${activeScene === title ? 'border-neutral-950 ring-1 ring-neutral-950' : 'border-neutral-200'}`}><div className="flex h-20 items-center justify-center rounded-xl bg-neutral-100 text-xs font-semibold text-neutral-500">{iconLabel}</div><p className="mt-3 text-sm font-semibold">{title}</p><span className="mt-2 block text-xs text-neutral-500">使ってみる</span></button>)}</div>{activeScene && <div className="mt-5 rounded-2xl border border-neutral-200 bg-white p-4"><p className="text-xs font-semibold text-neutral-500">Gallery素材を組み合わせる</p><div className="mt-3 grid gap-3 sm:grid-cols-3">{galleryReferenceAssets.map((asset) => <button key={asset.id} type="button" onClick={() => setSelectedAssets((current) => { const next: [typeof galleryReferenceAssets[number], typeof galleryReferenceAssets[number]] = [...current]; next[activeAssetSlot] = asset; return next; })} className={`overflow-hidden rounded-xl border text-left transition ${selectedAssets[activeAssetSlot].id === asset.id ? 'border-neutral-950 ring-1 ring-neutral-950' : 'border-neutral-200 hover:border-neutral-500'}`}><div className="h-24 bg-neutral-100"><img src={asset.src} alt={asset.label} className="h-full w-full object-cover" loading="lazy" /></div><div className="px-3 py-2 text-xs text-neutral-600">{asset.label}</div></button>)}</div><div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-500"><button type="button" onClick={() => setActiveAssetSlot(0)} className={`rounded-full border px-3 py-1.5 ${activeAssetSlot === 0 ? 'border-neutral-950 text-neutral-950' : 'border-neutral-200'}`}>画像1を選択</button><button type="button" onClick={() => setActiveAssetSlot(1)} className={`rounded-full border px-3 py-1.5 ${activeAssetSlot === 1 ? 'border-neutral-950 text-neutral-950' : 'border-neutral-200'}`}>画像2を選択</button></div></div>}{activeScene && <div className="mt-5 grid gap-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:grid-cols-[180px_180px_minmax(0,1fr)]"><div className="overflow-hidden rounded-xl bg-neutral-100"><img src={selectedAssets[0].src} alt="画像1" className="h-28 w-full object-cover" loading="lazy" /><p className="px-2 py-1 text-xs text-neutral-500">画像1: {selectedAssets[0].label}</p></div><div className="overflow-hidden rounded-xl bg-neutral-100"><img src={selectedAssets[1].src} alt="画像2" className="h-28 w-full object-cover" loading="lazy" /><p className="px-2 py-1 text-xs text-neutral-500">画像2: {selectedAssets[1].label}</p></div><div><textarea value={dialoguePrompt} onChange={(event) => setDialoguePrompt(event.target.value)} className="min-h-28 w-full resize-y rounded-xl border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-950" aria-label="商品画像をアップロードして、デザインのリクエストを教えてください" /><div className="mt-2 text-right text-xs text-neutral-400">{dialoguePrompt.length} / 4000</div></div></div>}<div className="mt-5 max-w-2xl"><div className="flex items-center rounded-xl border border-neutral-200 bg-white px-4 py-2"><Sparkles className="h-4 w-4 text-neutral-400" /><input value={dialoguePrompt} onChange={(event) => setDialoguePrompt(event.target.value)} className="min-w-0 flex-1 border-0 px-3 py-2 text-sm outline-none" placeholder="作りたいデザインを入力してください" /><button type="button" className="rounded-lg bg-neutral-950 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={!canOpenProposal} onClick={openProposal}>提案を見る</button></div>{(!trimmedDialoguePrompt || !hasTwoReferenceAssets) && <div id="design-production-proposal-requirements" className="mt-2 space-y-1 text-xs text-neutral-500" aria-live="polite">{!trimmedDialoguePrompt && <p>依頼文を入力してください。</p>}{!hasTwoReferenceAssets && <div className="flex flex-wrap items-center gap-2"><p>{referenceRequirementMessage}</p>{galleryReferenceAssets.length === 0 && <button type="button" className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:border-neutral-500" onClick={() => navigate('/asset-center')}>ライブラリーを開く</button>}</div>}</div>}</div></section> : <><section className="mt-8 grid gap-4 sm:grid-cols-3"><button type="button" className="rounded-2xl border border-neutral-200 p-5 text-left hover:border-neutral-500" onClick={() => navigate('/canvas/new')}><FileCardIcon icon={<Plus />} title="新規ファイル" description="白紙のキャンバスから始める" /></button><button type="button" className="rounded-2xl bg-neutral-950 px-4 py-2 text-sm text-white hover:bg-neutral-800" onClick={() => navigate('/designProduction/detail?boardProjectCode=new')}>新規プロジェクト</button><button type="button" className="rounded-2xl border border-neutral-200 p-5 text-left hover:border-neutral-500" onClick={() => navigate('/asset-center')}><FileCardIcon icon={<FolderOpen />} title="インスピレーション" description="ライブラリーの素材を見る" /></button></section><section className="mt-12" data-testid="design-production-persisted-projects"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">保存済みデザイン</h2><span className="text-sm text-neutral-500">{persistedDesignArtifacts.length}件</span></div>{persistedDesignArtifacts.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-neutral-200 px-5 py-12 text-center text-sm text-neutral-500">保存確認できたデザイン成果物はまだありません。生成結果を保存すると、ここに表示されます。</div> : <div className="mt-4 grid gap-4 md:grid-cols-3">{persistedDesignArtifacts.slice(0, 12).map((artifact) => <button type="button" key={artifact.id} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left hover:border-neutral-500" onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(artifact.id)}`)}><div className="h-36 bg-[radial-gradient(circle_at_35%_35%,rgba(14,116,144,0.22),transparent_30%),linear-gradient(135deg,#e5e7eb,#f8fafc)]">{artifact.imageUrl && <img src={artifact.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}</div><div className="p-4"><p className="truncate font-medium">{artifact.title}</p><p className="mt-2 truncate text-xs text-neutral-500">{artifact.featureType} ・ {formatArtifactDate(artifact.createdAt)}</p></div></button>)}</div>}</section></>}
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

  return <ParityShell><div className="mx-auto flex max-w-[1480px] gap-6 px-5 py-8 sm:px-8 lg:px-10"><aside className={`${darkPanel} hidden w-64 shrink-0 p-3 lg:block`}><div className="px-3 py-3 text-xs font-semibold tracking-[0.2em] text-neutral-400">LIBRARY</div>{libraryGroups.map((group) => <button key={group} type="button" onClick={() => { setActiveGroup(group); setSelectedAsset(null); }} className={`flex w-full items-center rounded-xl px-3 py-3 text-left text-sm transition ${activeGroup === group ? 'bg-white text-neutral-950' : 'text-neutral-400 hover:bg-white/[0.06] hover:text-white'}`}><FolderOpen className="mr-2 h-4 w-4" />{group}</button>)}</aside><main className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.25em] text-cyan-200">LIGHTCHAIN AI / LIBRARY</p><h1 className="mt-3 text-3xl font-semibold">{activeGroup}</h1><p className="mt-2 text-sm text-neutral-500">生成済みの成果物は、次のCanvas作業へ同じ系譜で引き継げます。</p></div><div className="flex gap-2"><button type="button" className={`${mutedButton} opacity-60`} disabled title="素材の登録は各ワークベンチから行います"><Upload className="mr-2 inline h-4 w-4" />アップロード</button><button type="button" className={`${mutedButton} opacity-60`} disabled title="グループ管理はβ版で準備中"><Plus className="mr-2 inline h-4 w-4" />新規グループ作成</button></div></div><div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4"><div className="flex gap-2"><button type="button" className={`rounded-lg px-3 py-2 text-sm ${filter === '画像／動画' ? 'bg-white text-neutral-950' : 'text-neutral-400'}`} onClick={() => setFilter('画像／動画')}>画像／動画</button><button type="button" className={`rounded-lg px-3 py-2 text-sm ${filter === 'お気に入り' ? 'bg-white text-neutral-950' : 'text-neutral-400'}`} onClick={() => setFilter('お気に入り')}>お気に入り</button></div><label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-neutral-400"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-40 bg-transparent outline-none" placeholder="検索" aria-label="ライブラリー検索" /></label></div>{assets.length === 0 ? <div className="mt-10 flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-center"><Grid2X2 className="h-8 w-8 text-neutral-600" /><h2 className="mt-4 font-semibold">まだ素材がありません</h2><p className="mt-2 text-sm text-neutral-500">このグループに保存された生成結果はありません。</p></div> : <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{assets.map((asset) => <article key={asset.id} className={`overflow-hidden rounded-2xl border bg-[#151a1c] ${selectedAsset?.id === asset.id ? 'border-cyan-200 ring-1 ring-cyan-200/50' : 'border-white/10'}`}><button type="button" className="flex h-44 w-full items-center justify-center bg-[radial-gradient(circle_at_35%_35%,rgba(103,232,249,0.22),transparent_24%),linear-gradient(135deg,#263438,#111719)]" onClick={() => asset.persisted && setSelectedAsset(persistedArtifacts.find((candidate) => candidate.id === asset.id) ?? null)} aria-label={`${asset.title}を選択`}>{asset.imageUrl ? <img src={asset.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageIcon className="h-10 w-10 text-cyan-100/60" />}</button><div className="p-4"><p className="truncate text-sm font-medium">{asset.title}</p><p className="mt-1 truncate text-xs text-neutral-500">{asset.featureType}</p><div className="mt-3 flex gap-2"><button type="button" className="flex-1 rounded-lg border border-white/10 px-2 py-2 text-xs text-neutral-400 hover:text-white disabled:opacity-40" disabled={!asset.persisted} onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(asset.id)}`)}>ボードにコピー</button><button type="button" className="rounded-lg border border-white/10 px-2 py-2 text-xs text-neutral-400 hover:text-white disabled:opacity-40" disabled={!asset.persisted} onClick={() => setSelectedAsset(persistedArtifacts.find((candidate) => candidate.id === asset.id) ?? null)}>詳細</button></div></div></article>)}</div>}{selectedAsset && <aside className="mt-6 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-5" aria-live="polite"><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.2em] text-cyan-200">SELECTED ASSET</p><h2 className="mt-2 font-semibold">{selectedAsset.title}</h2></div><button type="button" className="text-sm text-neutral-400 hover:text-white" onClick={() => setSelectedAsset(null)}>閉じる</button></div><p className="mt-3 text-sm text-neutral-400">{selectedAsset.prompt || '保存済み成果物'}</p><button type="button" className="mt-4 rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-neutral-950" onClick={() => navigate(`/canvas/new?sourceArtifactId=${encodeURIComponent(selectedAsset.id)}`)}>Canvasへ送る</button></aside>}</main></div></ParityShell>;
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
