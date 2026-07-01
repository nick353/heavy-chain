import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
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

const categoryIcon: Record<LightchainCategoryId, typeof Sparkles> = {
  recommended: Sparkles,
  planning: ClipboardList,
  fitting: UserRound,
  graphics: Palette,
};

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
  '/patterns': Palette,
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
  const [activeCategory, setActiveCategory] = useState<LightchainCategoryId>('recommended');
  const [query, setQuery] = useState('');

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
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-300">Workflow</p>
          <h2 className="mt-1 text-xl font-semibold text-neutral-900 dark:text-white sm:text-2xl">
            制作ワークフロー
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            商品素材から、販促、着用画像、柄、編集、動画までを目的別に選んで始めます。
          </p>
        </div>

        <label className="flex w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 transition focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-200 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-within:border-primary-400 lg:max-w-sm">
          <Search className="h-4 w-4 shrink-0 text-neutral-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-white"
            placeholder="例: 着用画像、総柄、背景削除"
          />
        </label>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="rounded-2xl border border-neutral-200 bg-white p-2 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 lg:col-span-3">
          {lightchainCategories.map((category) => {
            const Icon = categoryIcon[category.id];
            const active = category.id === activeCategory;
            const count = lightchainFeatureCatalog.filter((feature) => feature.category === category.id).length;

            return (
              <button
                key={category.id}
                type="button"
                onClick={() => handleCategoryChange(category.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                  active
                    ? 'bg-primary-50 text-primary-800 dark:bg-primary-400/10 dark:text-primary-100'
                    : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/70'
                }`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  active ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300'
                }`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{category.label}</span>
                  <span className="mt-0.5 block text-xs text-neutral-400">{count} tools</span>
                </span>
                <ChevronRight className={`h-4 w-4 ${active ? 'text-primary-500' : 'text-neutral-300'}`} />
              </button>
            );
          })}
        </div>

        <div className="space-y-4 lg:col-span-9">
            <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-soft dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-neutral-900 dark:text-white">{activeCategoryMeta.label}</h3>
                  <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">{activeCategoryMeta.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  <span>{visibleFeatures.length}</span>
                  <span>候補</span>
                </div>
              </div>
            </div>

            <div
              className="grid gap-3 md:grid-cols-2"
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
                    className={`group rounded-2xl border bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 dark:bg-neutral-900 ${
                      mobileHidden ? 'hidden md:block' : ''
                    } border-neutral-200 hover:border-primary-300 hover:shadow-lg dark:border-neutral-800 dark:hover:border-primary-500/70`}
                    data-testid="dashboard-lightchain-feature-link"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 transition group-hover:bg-primary-600 group-hover:text-white dark:bg-neutral-800 dark:text-neutral-200">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-neutral-900 dark:text-white">{feature.title}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusTone[feature.status]}`}>
                            {statusLabel[feature.status]}
                          </span>
                        </span>
                        <span className="mt-2 line-clamp-2 block text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                          {feature.description}
                        </span>
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="flex min-w-0 flex-wrap gap-2">
                        {feature.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
                            {tag}
                          </span>
                        ))}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary-600 dark:text-primary-300">
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
                className="flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 shadow-soft transition active:scale-[0.99] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 md:hidden"
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
