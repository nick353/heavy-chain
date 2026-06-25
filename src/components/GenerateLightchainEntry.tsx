import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  '/patterns': Palette,
  '/brand/settings': CheckCircle2,
  '/canvas/new': Layers3,
};

const routeLabel: Record<string, string> = {
  '/marketing': '販促を作る',
  '/fitting': '着用画像を作る',
  '/lab': '企画を試す',
  '/video': '動画構成へ',
  '/models': 'モデルを選ぶ',
  '/studio': '撮影セットへ',
  '/patterns': '柄を作る',
  '/brand/settings': 'ブランド設定へ',
  '/canvas/new': 'Canvasで編集',
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

const getActionLabel = (feature: LightchainFeature) => {
  const base = getRouteBase(feature.route);
  return routeLabel[base] ?? '生成画面を開く';
};

const findFeatureFromPrompt = (prompt: string) => {
  const normalizedPrompt = prompt.trim().toLowerCase();
  if (!normalizedPrompt) return lightchainFeatureCatalog[0];

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
  const [activeCategory, setActiveCategory] = useState<LightchainCategoryId>('recommended');
  const [selectedFeatureId, setSelectedFeatureId] = useState(lightchainFeatureCatalog[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [command, setCommand] = useState('');

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

  const selectedFeature = visibleFeatures.find((feature) => feature.id === selectedFeatureId) ?? visibleFeatures[0] ?? lightchainFeatureCatalog[0];
  const commandFeature = findFeatureFromPrompt(command);
  const commandHref = buildLightchainFeatureHref(commandFeature);
  const commandHrefWithPrompt = command.trim()
    ? `${commandHref}${commandHref.includes('?') ? '&' : '?'}prompt=${encodeURIComponent(command.trim())}`
    : commandHref;

  const handleCategoryChange = (categoryId: LightchainCategoryId) => {
    const firstFeature = lightchainFeatureCatalog.find((feature) => feature.category === categoryId);
    setActiveCategory(categoryId);
    setSelectedFeatureId(firstFeature?.id ?? '');
    setQuery('');
  };

  return (
    <section className="overflow-hidden rounded-[28px] border border-neutral-800 bg-neutral-950 text-white shadow-soft">
      <div className="border-b border-white/10 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">HEAVY CHAIN</p>
            <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">HEAVY CHAIN AI</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-300">
              Lightchain と同じように、やりたい制作内容を入力するか、ワークスペースを選んで生成へ進めます。
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

        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-white/10 bg-neutral-900 p-2 sm:flex-row sm:items-center">
          <label className="flex min-h-[54px] flex-1 items-center gap-3 px-3">
            <Search className="h-5 w-5 shrink-0 text-cyan-300" />
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-white outline-none placeholder:text-neutral-500"
              placeholder="指示を入力してください... 例: モデルの着せ替え、夏のSNSバナー、背景削除"
            />
          </label>
          <Link
            to={commandHrefWithPrompt}
            className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200"
          >
            開始
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {lightchainCategories.map((category) => {
            const active = category.id === activeCategory;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => handleCategoryChange(category.id)}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? 'border-cyan-300 bg-cyan-300 text-neutral-950'
                    : 'border-white/10 bg-white/5 text-neutral-300 hover:border-cyan-300/60 hover:text-white'
                }`}
              >
                {category.label}
                <span className={`ml-2 text-xs ${active ? 'text-neutral-700' : 'text-cyan-300'}`}>{category.eyebrow}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr),340px]">
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
                const selected = feature.id === selectedFeature?.id;
                return (
                  <button
                    key={feature.id}
                    type="button"
                    onClick={() => setSelectedFeatureId(feature.id)}
                    className={`min-h-[190px] rounded-2xl border p-4 text-left transition ${
                      selected
                        ? 'border-cyan-300 bg-white/10'
                        : 'border-white/10 bg-white/[0.04] hover:border-cyan-300/70 hover:bg-white/[0.07]'
                    }`}
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-cyan-200">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="mt-4 flex flex-wrap items-center gap-2">
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
                  </button>
                );
              })}
            </div>
          </div>

          {selectedFeature && (
            <aside className="h-fit rounded-2xl border border-white/10 bg-neutral-900 p-5">
              {(() => {
                const SelectedIcon = getRouteIcon(selectedFeature);
                const selectedHref = buildLightchainFeatureHref(selectedFeature);
                return (
                  <>
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-300 text-neutral-950">
                        <SelectedIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-white">{selectedFeature.title}</h3>
                        <p className="mt-1 text-xs text-neutral-500">{selectedFeature.lightchainName}</p>
                      </div>
                    </div>

                    <div className="mt-5 space-y-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">できること</p>
                        <p className="mt-2 text-sm leading-6 text-neutral-300">{selectedFeature.capability}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Lightchain 互換</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedFeature.lightchainName.split('/').map((taskCode) => (
                            <span key={taskCode.trim()} className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-neutral-300">
                              {taskCode.trim()}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <Link
                      to={selectedHref}
                      className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200"
                    >
                      {getActionLabel(selectedFeature)}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                );
              })()}
            </aside>
          )}
        </div>
      </div>
    </section>
  );
}
