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

const statusTone: Record<LightchainFeature['status'], string> = {
  production: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/20',
  workspace: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-400/20',
  'local-proof': 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20',
};

const statusLabel: Record<LightchainFeature['status'], string> = {
  production: '保存まで対応',
  workspace: 'ワークスペース',
  'local-proof': '検証中',
};

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

const getRouteBase = (route: string) => route.split('?')[0];

const getRouteIcon = (feature: LightchainFeature) => {
  const base = getRouteBase(feature.route);
  return routeIcon[base] ?? Sparkles;
};

interface LightchainParityHubProps {
  compactOnMobile?: boolean;
}

export function LightchainParityHub({ compactOnMobile = false }: LightchainParityHubProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('category');
  const [activeCategory, setActiveCategory] = useState<LightchainCategoryId>('recommended');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (categoryParam && lightchainCategories.some((category) => category.id === categoryParam)) {
      setActiveCategory(categoryParam as LightchainCategoryId);
      setQuery('');
    }
  }, [categoryParam]);

  const activeCategoryMeta = lightchainCategories.find((category) => category.id === activeCategory) ?? lightchainCategories[0];

  const visibleFeatures = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = lightchainFeatureCatalog.filter((feature) => {
      const inCategory = feature.category === activeCategory;
      if (!normalizedQuery) return inCategory;
      const haystack = [
        feature.title,
        feature.lightchainName,
        feature.description,
        feature.capability,
        feature.tags.join(' '),
      ].join(' ').toLowerCase();
      return inCategory && haystack.includes(normalizedQuery);
    });

    return filtered.length ? filtered : lightchainFeatureCatalog.filter((feature) => feature.category === activeCategory);
  }, [activeCategory, query]);

  const handleCategoryChange = (categoryId: LightchainCategoryId) => {
    setActiveCategory(categoryId);
    setQuery('');
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('category', categoryId);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white sm:text-3xl">
            制作ワークフロー
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400 sm:text-base">
            商品素材から、販促、着用画像、柄、編集、動画までを目的別に選んで始めます。
          </p>
        </div>

        <label className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-4 transition focus-within:border-cyan-300/70 lg:max-w-md">
          <Search className="h-4 w-4 shrink-0 text-neutral-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-white outline-none placeholder:text-neutral-500"
            placeholder="ツールを検索"
          />
        </label>
      </div>

      <div className="space-y-7 rounded-[28px] border border-white/10 bg-[#090a0a] p-4 sm:p-6">
        <div className="flex max-w-5xl gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.04] p-1.5">
          {lightchainCategories.map((category) => {
            const active = category.id === activeCategory;

            return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => handleCategoryChange(category.id)}
                  aria-pressed={active}
                  className={`shrink-0 rounded-xl px-5 py-3 text-sm font-semibold transition ${
                    active
                      ? 'bg-cyan-300 text-neutral-950 shadow-[0_0_24px_rgba(103,232,249,0.22)]'
                    : 'text-neutral-400 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {category.label}
                {category.id === 'recommended' && <span className="ml-2 text-xs font-medium">Hot</span>}
              </button>
            );
          })}
        </div>

        <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-white">{activeCategoryMeta.label}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-400">{activeCategoryMeta.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 rounded-full bg-white/[0.07] px-4 py-2 text-xs font-medium text-neutral-300">
                <span>{visibleFeatures.length}</span>
                <span>候補</span>
              </div>
            </div>

            <div
              className="grid gap-4 lg:grid-cols-3"
              data-testid={compactOnMobile ? 'dashboard-lightchain-feature-list' : undefined}
            >
              {visibleFeatures.map((feature, index) => {
                const Icon = getRouteIcon(feature);
                const mobileHidden = compactOnMobile && index >= 4;
                const featureHref = buildLightchainFeatureHref(feature);

                return (
                  <Link
                    key={feature.id}
                    to={featureHref}
                    className={`group min-h-[220px] rounded-2xl border border-white/10 bg-[#121313] p-6 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/45 hover:bg-[#171818] ${
                      mobileHidden ? 'hidden md:block' : ''
                    }`}
                    data-testid="dashboard-lightchain-feature-link"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-cyan-300 transition group-hover:bg-cyan-300 group-hover:text-neutral-950">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-white">{feature.title}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusTone[feature.status]}`}>
                            {statusLabel[feature.status]}
                          </span>
                        </span>
                        <span className="mt-3 line-clamp-3 block text-sm leading-6 text-neutral-400">
                          {feature.description}
                        </span>
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="flex min-w-0 flex-wrap gap-2">
                        {feature.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded-full bg-white/[0.08] px-3 py-1.5 text-xs text-neutral-300">
                            {tag}
                          </span>
                        ))}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-cyan-300">
                        開く
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            {compactOnMobile && (
              <Link
                to="/lightchain"
                className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99] md:hidden"
                data-testid="dashboard-lightchain-all-tools-link"
              >
                {lightchainFeatureCatalog.length}機能をすべて見る
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
        </div>
      </div>
    </section>
  );
}
