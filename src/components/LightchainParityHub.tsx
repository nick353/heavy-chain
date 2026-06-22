import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Boxes,
  ChevronRight,
  ClipboardList,
  Images,
  Scissors,
  Search,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import {
  buildLightchainFeatureHref,
  lightchainCategories,
  lightchainFeatureCatalog,
  type LightchainCategoryId,
  type LightchainFeature,
} from '../lib/lightchainParityCatalog';

const statusLabel: Record<LightchainFeature['status'], string> = {
  production: '本番保存まで対応',
  workspace: '生成前ワークスペース',
  'local-proof': '検証済みワークスペース',
};

const statusClass: Record<LightchainFeature['status'], string> = {
  production: 'border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200',
  workspace: 'border-cyan-300/60 bg-cyan-50 text-cyan-700 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-200',
  'local-proof': 'border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200',
};

const categoryIcon: Record<LightchainCategoryId, typeof Sparkles> = {
  recommended: Sparkles,
  planning: ClipboardList,
  fitting: Bot,
  graphics: Images,
  editing: Scissors,
  cases: Boxes,
};

export function LightchainParityHub() {
  const [activeCategory, setActiveCategory] = useState<LightchainCategoryId>('recommended');
  const [query, setQuery] = useState('');
  const activeMeta = lightchainCategories.find((category) => category.id === activeCategory) ?? lightchainCategories[0];

  const visibleFeatures = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return lightchainFeatureCatalog.filter((feature) => {
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
  }, [activeCategory, query]);

  const productionCount = lightchainFeatureCatalog.filter((feature) => feature.status === 'production').length;

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-neutral-950 text-white shadow-floating dark:border-white/10">
      <div className="relative">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(20,184,166,0.22),rgba(197,136,81,0.14)_45%,rgba(15,23,42,0)_75%)]" />
        <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.15fr_0.85fr] lg:p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/25 bg-white/8 px-3 py-1 text-xs font-semibold text-teal-100">
              <BadgeCheck className="h-3.5 w-3.5" />
              Lightchain互換ホーム
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-normal sm:text-3xl">
              Lightchainで慣れた入口を、Heavy Chainへ。
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-300">
              実操作で確認した Lightchain のタブ、主要カード、事例、周辺機能を Heavy Chain の生成、保存、履歴、Canvas に対応付けています。課金導線を除き、ここから同じ業務を開始できます。
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/8 p-3">
                <p className="text-2xl font-semibold">{lightchainFeatureCatalog.length}</p>
                <p className="mt-1 text-xs text-neutral-300">対応済み入口</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/8 p-3">
                <p className="text-2xl font-semibold">{productionCount}</p>
                <p className="mt-1 text-xs text-neutral-300">本番readback済み</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/8 p-3">
                <p className="text-2xl font-semibold">0</p>
                <p className="mt-1 text-xs text-neutral-300">課金操作</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-300 text-neutral-950">
                <WandSparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">指示から始める</p>
                <p className="text-xs text-neutral-300">Lightchain の prompt 入力に近い入口</p>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-neutral-950/70 p-3">
              <p className="text-sm text-neutral-200">モデルの着せ替え、総柄プリント、EC商品画像、SNS動画構成などを選ぶと、最短の Heavy Chain ワークスペースへ移動します。</p>
            </div>
            <Link
              to="/generate"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-300 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-teal-200"
            >
              画像生成を開く
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 bg-white/[0.03] p-4 sm:p-5 lg:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {lightchainCategories.map((category) => {
              const Icon = categoryIcon[category.id];
              const active = category.id === activeCategory;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveCategory(category.id)}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm transition ${
                    active
                      ? 'border-teal-300 bg-teal-300 text-neutral-950'
                      : 'border-white/10 bg-white/5 text-neutral-200 hover:border-white/25 hover:bg-white/10'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{category.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${active ? 'bg-neutral-950/10' : 'bg-white/10 text-neutral-300'}`}>
                    {category.eyebrow}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="relative block w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-neutral-950/70 py-2.5 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-teal-300"
              placeholder="機能名で検索"
            />
          </label>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-neutral-950/45 p-4">
          <p className="text-sm font-semibold text-white">{activeMeta.label}</p>
          <p className="mt-1 text-sm leading-6 text-neutral-300">{activeMeta.description}</p>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {visibleFeatures.map((feature) => (
            <Link
              key={feature.id}
              to={buildLightchainFeatureHref(feature)}
              className="group rounded-xl border border-white/10 bg-white/[0.06] p-4 transition hover:border-teal-300/60 hover:bg-white/[0.09]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-white">{feature.title}</h3>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass[feature.status]}`}>
                      {statusLabel[feature.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-teal-100/80">{feature.lightchainName}</p>
                  <p className="mt-2 text-sm leading-6 text-neutral-300">{feature.description}</p>
                </div>
                <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-neutral-500 transition group-hover:translate-x-1 group-hover:text-teal-200" />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-neutral-950/50 p-3">
                  <p className="text-[11px] font-semibold uppercase text-neutral-500">Heavy Chainでできること</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-300">{feature.capability}</p>
                </div>
                <div className="rounded-lg bg-neutral-950/50 p-3">
                  <p className="text-[11px] font-semibold uppercase text-neutral-500">確認済み証跡</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-300">{feature.evidence}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
