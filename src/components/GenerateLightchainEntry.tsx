import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Images,
  Layers3,
  PackageOpen,
  Palette,
  PlayCircle,
  Search,
  Shirt,
  Sparkles,
  UserRound,
  WandSparkles,
} from 'lucide-react';
import {
  buildLightchainFeatureHref,
  lightchainCategories,
  lightchainFeatureCatalog,
  type LightchainCategoryId,
  type LightchainFeature,
} from '../lib/lightchainParityCatalog';

const routeIcon: Record<string, typeof Sparkles> = {
  '/marketing': PackageOpen,
  '/fitting': Shirt,
  '/lab': WandSparkles,
  '/video': PlayCircle,
  '/models': UserRound,
  '/studio': Images,
  '/patterns/workbench': Palette,
  '/brand/settings': CheckCircle2,
  '/canvas/new': Layers3,
};

const statusLabel: Record<LightchainFeature['status'], string> = {
  production: '生成対応',
  workspace: '作業台',
  'local-proof': '検証済み',
};

const statusTone: Record<LightchainFeature['status'], string> = {
  production: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100',
  workspace: 'border-sky-400/40 bg-sky-400/10 text-sky-100',
  'local-proof': 'border-amber-400/40 bg-amber-400/10 text-amber-100',
};

const getRouteBase = (route: string) => route.split('?')[0];

const getRouteIcon = (feature: LightchainFeature) => {
  const base = getRouteBase(feature.route);
  return routeIcon[base] ?? Sparkles;
};

const findFeatureFromPrompt = (prompt: string) => {
  const normalizedPrompt = prompt.trim().toLowerCase();
  if (!normalizedPrompt) return lightchainFeatureCatalog[0];

  const keywordRoute = [
    { keywords: ['背景削除', '切り抜き', 'remove background', 'remove-bg'], featureId: 'remove-background' },
    { keywords: ['canvas', 'キャンバス', '編集'], featureId: 'canvas-editing' },
    { keywords: ['着せ替え', 'フィッティング', 'fitting', '着用'], featureId: 'virtual-fitting' },
    { keywords: ['モデル', '体型', 'サイズ'], featureId: 'model-body-shape' },
    { keywords: ['柄', 'プリント', 'ロゴ', 'グラフィック'], featureId: 'graphic-design' },
    { keywords: ['動画', 'sns動画', 'storyboard'], featureId: 'video-workstation' },
    { keywords: ['バナー', '販促', 'sns', 'ec'], featureId: 'marketing-workspace' },
  ].find((item) => item.keywords.some((keyword) => normalizedPrompt.includes(keyword)));

  if (keywordRoute) {
    return lightchainFeatureCatalog.find((feature) => feature.id === keywordRoute.featureId) ?? lightchainFeatureCatalog[0];
  }

  return (
    lightchainFeatureCatalog.find((feature) => {
      const haystack = [
        feature.title,
        feature.lightchainName,
        feature.description,
        feature.capability,
        feature.tags.join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedPrompt) || normalizedPrompt.includes(feature.title.toLowerCase());
    }) ?? lightchainFeatureCatalog[0]
  );
};

export function GenerateLightchainEntry() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState<LightchainCategoryId>('recommended');
  const [query, setQuery] = useState('');
  const [command, setCommand] = useState('');
  const categoryParam = searchParams.get('category');

  useEffect(() => {
    if (categoryParam && lightchainCategories.some((category) => category.id === categoryParam)) {
      setActiveCategory(categoryParam as LightchainCategoryId);
      setQuery('');
    }
  }, [categoryParam]);

  const activeCategoryMeta = lightchainCategories.find((category) => category.id === activeCategory) ?? lightchainCategories[0];

  const visibleFeatures = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const categoryFeatures = lightchainFeatureCatalog.filter((feature) => feature.category === activeCategory);
    if (!normalizedQuery) return categoryFeatures;

    const filtered = categoryFeatures.filter((feature) => {
      const haystack = [
        feature.title,
        feature.lightchainName,
        feature.description,
        feature.capability,
        feature.tags.join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    return filtered.length ? filtered : categoryFeatures;
  }, [activeCategory, query]);

  const commandFeature = findFeatureFromPrompt(command);
  const commandHref = buildLightchainFeatureHref(commandFeature);
  const commandHrefWithPrompt = command.trim()
    ? `${commandHref}${commandHref.includes('?') ? '&' : '?'}prompt=${encodeURIComponent(command.trim())}`
    : commandHref;

  const handleCategoryChange = (categoryId: LightchainCategoryId) => {
    setActiveCategory(categoryId);
    setQuery('');
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('category', categoryId);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <section className="overflow-hidden rounded-[28px] border border-neutral-800 bg-neutral-950 text-white shadow-soft">
      <div className="border-b border-white/10 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-4xl font-semibold tracking-normal text-white sm:text-5xl">HEAVY CHAIN AI</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-300">
              目的別の4カテゴリから始めます。
            </p>
          </div>
          <Link
            to="/dashboard"
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
          >
            制作ワークフロー
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-7 flex flex-col gap-3 rounded-full border border-cyan-300/60 bg-neutral-900/80 p-2 shadow-[0_0_28px_rgba(34,211,238,0.12)] sm:flex-row sm:items-center">
          <label className="flex min-h-[54px] flex-1 items-center gap-3 px-3">
            <Search className="h-5 w-5 shrink-0 text-cyan-300" />
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-white outline-none placeholder:text-neutral-500"
              placeholder="例: モデルの着せ替え、背景削除"
              />
            </label>
          <Link
            to={commandHrefWithPrompt}
            className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200"
          >
            開始
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex max-w-4xl gap-2 overflow-x-auto rounded-xl border border-white/15 bg-white/5 p-1">
          {lightchainCategories.map((category) => {
            const active = category.id === activeCategory;
            return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => handleCategoryChange(category.id)}
                  aria-pressed={active}
                  className={`shrink-0 rounded-lg border px-5 py-2.5 text-sm font-semibold transition ${
                    active
                      ? 'border-cyan-300 bg-cyan-300 text-neutral-950'
                    : 'border-transparent bg-transparent text-neutral-400 hover:text-white'
                }`}
              >
                {category.label}
                {category.id === 'recommended' && (
                  <span className={`ml-2 text-xs ${active ? 'text-neutral-700' : 'text-cyan-300'}`}>{category.eyebrow}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-6">
          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">{activeCategoryMeta.label}</h3>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-400">{activeCategoryMeta.description}</p>
              </div>
              <label className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 transition focus-within:border-cyan-300 sm:max-w-xs">
                <Search className="h-4 w-4 shrink-0 text-neutral-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-white outline-none placeholder:text-neutral-500"
                  placeholder="ツールを検索"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleFeatures.map((feature) => {
                const Icon = getRouteIcon(feature);
                const selectedHref = buildLightchainFeatureHref(feature);
                return (
                  <Link
                    key={feature.id}
                    to={selectedHref}
                    className="group min-h-[150px] rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-cyan-300/70 hover:bg-white/[0.07]"
                    data-testid="lightchain-tool-card"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-cyan-200 transition group-hover:bg-cyan-300 group-hover:text-neutral-950">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="text-sm font-semibold text-white">{feature.title}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone[feature.status]}`}>
                        {statusLabel[feature.status]}
                      </span>
                    </span>
                    <span className="mt-2 line-clamp-3 block text-sm leading-6 text-neutral-400">{feature.description}</span>
                    <span className="mt-4 flex flex-wrap gap-2">
                      {feature.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-neutral-300">
                          {tag}
                        </span>
                      ))}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
