import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FolderOpen,
  History,
  Images,
  Layers3,
  LockKeyhole,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  lightchainCategories,
  type LightchainFeature,
} from '../../lib/lightchainParityCatalog';
import {
  buildLightchainUnifiedFeatureHref,
  getLightchainUnifiedRouteAliases,
  lightchainUnifiedFeatureCatalog,
} from '../../lib/lightchainUnifiedFeatureCatalog';
import {
  unifiedWorkspaceFlowLabels,
  type UnifiedWorkspaceFlowState,
} from '../../lib/unifiedWorkspaceFlow';
import {
  readUnifiedWorkspaceFlowState,
  writeUnifiedWorkspaceFlowState,
} from '../../lib/unifiedWorkspaceFlowPersistence';

type LightchainUnifiedWorkspaceShellProps = {
  children: ReactNode;
};

const isBetaFeature = (feature: LightchainFeature) => feature.betaIncluded !== false;
const routeBase = (route: string) => route.split('?')[0];
const workspaceSteps = [
  { id: 'input', label: '素材・条件', detail: 'Libraryから入力を選択' },
  { id: 'generate', label: '生成', detail: '準備完了後に開始' },
  { id: 'result', label: '結果確認', detail: '生成結果と失敗状態を確認' },
  { id: 'reuse', label: '保存・再利用', detail: 'Gallery / Canvas / History / Jobs' },
] as const;

type UnifiedWorkspaceFlowContextValue = {
  flowState: UnifiedWorkspaceFlowState;
  setFlowState: (state: UnifiedWorkspaceFlowState) => void;
};

const UnifiedWorkspaceFlowContext = createContext<UnifiedWorkspaceFlowContextValue | null>(null);

export function useUnifiedWorkspaceFlow() {
  const context = useContext(UnifiedWorkspaceFlowContext);
  if (!context) throw new Error('useUnifiedWorkspaceFlow must be used inside LightchainUnifiedWorkspaceShell');
  return context;
}

const featureMatchesLocation = (feature: LightchainFeature, pathname: string, search: string) => {
  const params = new URLSearchParams(search);
  const featureParam = params.get('feature') || params.get('lcFeature');
  if (featureParam === feature.id) return true;
  if (getLightchainUnifiedRouteAliases(feature.id).includes(pathname)) return true;
  return pathname === routeBase(feature.route);
};

export function LightchainUnifiedWorkspaceShell({ children }: LightchainUnifiedWorkspaceShellProps) {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [catalogOpen, setCatalogOpen] = useState(true);

  const activeFeature = useMemo(
    () => lightchainUnifiedFeatureCatalog.find((feature) => (
      isBetaFeature(feature) && featureMatchesLocation(feature, location.pathname, location.search)
    )) ?? null,
    [location.pathname, location.search],
  );
  const activeFlowKey = activeFeature?.id ?? 'workspace-hub';
  const [flowState, setFlowStateValue] = useState<UnifiedWorkspaceFlowState>(() => (
    readUnifiedWorkspaceFlowState(activeFlowKey)
  ));
  useEffect(() => {
    setFlowStateValue(readUnifiedWorkspaceFlowState(activeFlowKey));
  }, [activeFlowKey]);
  const setFlowState = useCallback((state: UnifiedWorkspaceFlowState) => {
    setFlowStateValue(state);
    writeUnifiedWorkspaceFlowState(activeFlowKey, state);
  }, [activeFlowKey]);
  const visibleFeatures = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return lightchainUnifiedFeatureCatalog.filter((feature) => {
      if (!isBetaFeature(feature)) return false;
      if (activeCategory !== 'all' && feature.category !== activeCategory) return false;
      if (!normalized) return true;
      return [feature.title, feature.description, feature.tags.join(' ')].join(' ').toLowerCase().includes(normalized);
    });
  }, [activeCategory, query]);

  const flowStepIndex = flowState === 'completed'
    ? workspaceSteps.length
    : flowState === 'generating' || flowState === 'failed'
      ? 2
      : flowState === 'ready'
        ? 1
        : 0;
  const flowStatusTone = flowState === 'completed'
    ? 'border-emerald-200/20 bg-emerald-200/[0.08] text-emerald-100/85'
    : flowState === 'failed'
      ? 'border-amber-200/20 bg-amber-200/[0.08] text-amber-100/85'
      : 'border-cyan-200/15 bg-cyan-200/[0.06] text-cyan-100/75';

  return (
    <UnifiedWorkspaceFlowContext.Provider value={{ flowState, setFlowState }}>
      <div data-testid="heavy-unified-workspace-shell" data-flow-state={flowState} className="min-h-[calc(100vh-70px)] bg-[#050708] text-white">
      <div className="border-b border-white/10 bg-[#0b1012]/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-300/15 text-cyan-100 ring-1 ring-cyan-200/25">
              <Layers3 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/75">Heavy Chain / Apparel Beta</p>
              <p className="truncate text-sm font-semibold text-white">統合ワークスペース{activeFeature ? ` / ${activeFeature.title}` : ''}</p>
            </div>
          </div>
          <nav aria-label="共通保存先" className="flex flex-wrap items-center gap-1.5 text-xs">
            <Link to="/gallery" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-white/65 transition hover:border-cyan-200/40 hover:text-white"><Images className="h-3.5 w-3.5" />Gallery</Link>
            <Link to="/canvas" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-white/65 transition hover:border-cyan-200/40 hover:text-white"><FolderOpen className="h-3.5 w-3.5" />Canvas</Link>
            <Link to="/history" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-white/65 transition hover:border-cyan-200/40 hover:text-white"><History className="h-3.5 w-3.5" />History</Link>
            <Link to="/jobs" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-white/65 transition hover:border-cyan-200/40 hover:text-white"><BriefcaseBusiness className="h-3.5 w-3.5" />Jobs</Link>
          </nav>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1680px] gap-4 px-3 py-3 sm:px-5 lg:grid-cols-[270px_minmax(0,1fr)] lg:px-6 lg:py-5 xl:grid-cols-[270px_minmax(0,1fr)_250px]">
        <aside className="min-w-0 lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-104px)] lg:self-start">
          <div className="rounded-2xl border border-white/10 bg-[#111719] p-3 shadow-2xl shadow-black/20">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/70">Library</p>
                <p className="mt-1 text-sm font-semibold text-white">機能を選択</p>
              </div>
              <button type="button" onClick={() => setCatalogOpen((open) => !open)} aria-expanded={catalogOpen} aria-label="機能ライブラリを開閉" className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/[0.06] hover:text-white">
                <ChevronDown className={`h-4 w-4 transition ${catalogOpen ? '' : '-rotate-90'}`} />
              </button>
            </div>
            {catalogOpen && (
              <>
                <label className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-xs text-white/55 focus-within:border-cyan-200/50">
                  <Search className="h-3.5 w-3.5 shrink-0" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="機能を検索" aria-label="機能を検索" className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-white/35" />
                </label>
                <div className="mt-3 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="機能カテゴリ">
                  <button type="button" role="tab" aria-selected={activeCategory === 'all'} onClick={() => setActiveCategory('all')} className={`shrink-0 rounded-md px-2 py-1.5 text-[10px] font-semibold ${activeCategory === 'all' ? 'bg-cyan-300 text-slate-950' : 'text-white/50 hover:bg-white/[0.06] hover:text-white'}`}>全て</button>
                  {lightchainCategories.map((category) => (
                    <button key={category.id} type="button" role="tab" aria-selected={activeCategory === category.id} onClick={() => setActiveCategory(category.id)} className={`shrink-0 rounded-md px-2 py-1.5 text-[10px] font-semibold ${activeCategory === category.id ? 'bg-cyan-300 text-slate-950' : 'text-white/50 hover:bg-white/[0.06] hover:text-white'}`}>{category.label}</button>
                  ))}
                </div>
                <div className="mt-2 max-h-[min(52vh,520px)] space-y-1 overflow-y-auto pr-1" data-testid="heavy-unified-feature-library">
                  {visibleFeatures.map((feature) => {
                    const active = activeFeature?.id === feature.id;
                    return (
                      <Link key={feature.id} to={buildLightchainUnifiedFeatureHref(feature)} aria-current={active ? 'page' : undefined} className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${active ? 'bg-cyan-300/15 text-cyan-50 ring-1 ring-cyan-200/30' : 'text-white/60 hover:bg-white/[0.06] hover:text-white'}`}>
                        <Sparkles className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-cyan-200' : 'text-white/35'}`} />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{feature.title}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-white/20 transition group-hover:translate-x-0.5 group-hover:text-cyan-200" />
                      </Link>
                    );
                  })}
                  {visibleFeatures.length === 0 && <p className="px-2 py-6 text-center text-xs text-white/40">該当する機能がありません</p>}
                </div>
              </>
            )}
          </div>
        </aside>

        <main className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#0b1012] shadow-2xl shadow-black/20">
          {children}
        </main>

        <aside className="hidden min-w-0 xl:block xl:sticky xl:top-[84px] xl:self-start" aria-label="制作コンテキスト">
          <div className="space-y-3">
            <section className="rounded-2xl border border-white/10 bg-[#111719] p-3 shadow-2xl shadow-black/20" data-testid="heavy-unified-context-rail">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-300/15 text-cyan-100 ring-1 ring-cyan-200/20">
                  <CircleDot className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Context</p>
                  <h2 className="mt-1 truncate text-sm font-semibold text-white">{activeFeature?.title ?? '制作を選択'}</h2>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-white/55">{activeFeature?.description ?? '左のLibraryから機能を選ぶと、入力・生成・保存の状態をここで確認できます。'}</p>
              {activeFeature && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {activeFeature.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/55">{tag}</span>)}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#111719] p-3 shadow-2xl shadow-black/20" aria-labelledby="heavy-unified-flow-title">
              <div className="flex items-center justify-between gap-2">
                <h2 id="heavy-unified-flow-title" className="text-xs font-semibold text-white">共通フロー</h2>
                <span className={`rounded-full border px-2 py-1 text-[10px] ${flowStatusTone}`} data-testid="heavy-unified-flow-state">{unifiedWorkspaceFlowLabels[flowState]}</span>
              </div>
              <ol className="mt-3 space-y-3">
                {workspaceSteps.map((step, index) => (
                  <li key={step.id} className="flex gap-2.5">
                    <div className="relative flex w-4 shrink-0 justify-center">
                      {index < workspaceSteps.length - 1 && <span className="absolute top-4 h-7 w-px bg-white/10" aria-hidden="true" />}
                      <span className={`relative z-10 mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border ${index < flowStepIndex ? 'border-cyan-200/60 bg-cyan-300/20 text-cyan-100' : 'border-white/15 bg-black/20 text-white/35'}`}>
                        {index < flowStepIndex ? <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" /> : <span className="text-[9px]">{index + 1}</span>}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white/85">{step.label}</p>
                      <p className="mt-0.5 text-[10px] leading-4 text-white/45">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#111719] p-3 shadow-2xl shadow-black/20" aria-labelledby="heavy-unified-safety-title">
              <div className="flex items-center gap-2">
                <LockKeyhole className="h-3.5 w-3.5 text-cyan-200/75" aria-hidden="true" />
                <h2 id="heavy-unified-safety-title" className="text-xs font-semibold text-white">社内βの状態</h2>
              </div>
              <ul className="mt-2 space-y-1.5 text-[10px] leading-4 text-white/50">
                <li>動画・公開・課金は対象外</li>
                <li>権利確認なしではproviderを開始しない</li>
                <li>失敗時は入力を保持して再試行</li>
              </ul>
            </section>
          </div>
        </aside>
      </div>
      </div>
    </UnifiedWorkspaceFlowContext.Provider>
  );
}
