import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Sparkles,
  X,
} from 'lucide-react';
import {
  buildLightchainFeatureHref,
  getLightchainLauncherBadge,
  getLightchainLauncherDescription,
  getLightchainLauncherFeatures,
  getLightchainLauncherTitle,
  lightchainCategories,
  lightchainFeatureCatalog,
  type LightchainCategoryId,
  type LightchainFeature,
} from '../lib/lightchainParityCatalog';

const galleryTabs = [
  { id: 'recommended', label: 'おすすめの事例' },
  { id: 'edit', label: 'デザイン修正' },
  { id: 'print', label: '柄・プリント' },
  { id: 'visual', label: 'ビジュアル素材' },
  { id: 'marketing', label: 'マーケティングコンテンツ' },
  { id: 'production', label: '生産' },
] as const;

const galleryCases = [
  {
    id: 'series-design',
    title: 'AIファッションデザイン：シリーズデザインを一括生成',
    description: '参考素材とブランドスタイルを統合し、シリーズ案を比較しながら企画へ進みます。',
    step: 'インスピレーション → デザインエージェント → シリーズ案を比較',
    featureId: 'inspiration-design',
  },
  {
    id: 'fitting-reference',
    title: '【AIフィッティング】— アパレルデザイン画とモデルの顔・ポーズ参考画像を組み合わせ、リアルなモデル着用画像を瞬時に生成',
    description: '服の画像、顔写真、ポーズ参考画像を組み合わせて着用イメージを作ります。',
    step: 'AIフィッティング → 参考画像 → モデル条件 → 生成',
    featureId: 'virtual-fitting',
  },
  {
    id: 'fabric-replace',
    title: '生地イメージ：ワンクリックで生地差し替えできます。',
    description: 'モデル画像と生地画像を配置し、サンプルレスで上身効果を確認します。',
    step: '生地プリントの試着シミュレーション → モデル画像＋生地画像',
    featureId: 'fabric-simulation',
  },
  {
    id: 'marketing-set',
    title: '【マーケティングワークスペース】既存画像から販促素材を一括生成',
    description: '商品画像やモデル着用画像を活用し、EC・SNS向けの販促案へ展開します。',
    step: 'マーケティング → 商品画像 → EC / SNS / コピー → 保存',
    featureId: 'marketing-workspace',
  },
  {
    id: 'fashion-studio',
    title: '【ファッションスタジオ】— 服・モデル・背景・小物をまとめて撮影',
    description: '素材、モデル、シーンを一つの作業台で組み合わせ、生成かCanvasへ進みます。',
    step: 'ファッションスタジオ → 素材確認 → 撮影セット → Canvas',
    featureId: 'fashion-studio',
  },
] as const;

const isBetaFeature = (feature: LightchainFeature | undefined): feature is LightchainFeature => Boolean(feature && feature.betaIncluded !== false);

const launcherFeatureVisuals: Record<string, { background: string; accent: string; detail: string }> = {
  'design-workspace': { background: '#213b3c', accent: '#b3ddd0', detail: '#e7f2e9' },
  'marketing-workspace': { background: '#5d3830', accent: '#e9b4a2', detail: '#f8e5d7' },
  'virtual-fitting': { background: '#355167', accent: '#c9ddea', detail: '#f5e8d3' },
  'wear-design-lab': { background: '#7a493d', accent: '#f0c0aa', detail: '#f9e8ce' },
  'model-library': { background: '#a87861', accent: '#f1cfb4', detail: '#fff0dc' },
  'fashion-studio': { background: '#4c4e67', accent: '#d1cfee', detail: '#f6e9da' },
  'design-agent': { background: '#31545a', accent: '#b5dfd7', detail: '#f3eee1' },
};

const encodeSvgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;

const buildLauncherFeatureImage = (featureId: string) => {
  const visual = launcherFeatureVisuals[featureId] ?? launcherFeatureVisuals['design-workspace'];
  return encodeSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="560" viewBox="0 0 960 560">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${visual.background}"/>
          <stop offset="1" stop-color="#11191b"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#081012" flood-opacity=".35"/>
        </filter>
      </defs>
      <rect width="960" height="560" fill="url(#background)"/>
      <circle cx="820" cy="90" r="170" fill="${visual.accent}" opacity=".16"/>
      <circle cx="120" cy="520" r="210" fill="${visual.detail}" opacity=".08"/>
      <path d="M0 416 C180 356 274 470 458 416 S770 344 960 424 V560 H0Z" fill="#0d1618" opacity=".55"/>
      <g filter="url(#shadow)">
        <rect x="74" y="72" width="300" height="384" rx="28" fill="${visual.detail}" opacity=".95"/>
        <rect x="108" y="108" width="232" height="18" rx="9" fill="${visual.background}" opacity=".55"/>
        <rect x="108" y="145" width="154" height="12" rx="6" fill="${visual.background}" opacity=".26"/>
        <path d="M185 206 L135 255 L163 286 L192 263 L192 385 L288 385 L288 263 L317 286 L345 255 L295 206 L256 187 L224 187Z" fill="${visual.accent}"/>
        <path d="M215 188 C220 228 261 228 266 188" fill="none" stroke="${visual.background}" stroke-width="10" opacity=".72"/>
        <rect x="108" y="408" width="118" height="10" rx="5" fill="${visual.background}" opacity=".38"/>
        <rect x="238" y="408" width="74" height="10" rx="5" fill="${visual.background}" opacity=".2"/>
      </g>
      <g opacity=".92">
        <rect x="492" y="112" width="362" height="52" rx="18" fill="#f3f0e8" opacity=".12"/>
        <rect x="526" y="130" width="168" height="14" rx="7" fill="${visual.detail}" opacity=".72"/>
        <rect x="714" y="130" width="92" height="14" rx="7" fill="${visual.accent}" opacity=".55"/>
        <rect x="492" y="202" width="164" height="224" rx="24" fill="${visual.accent}" opacity=".42"/>
        <rect x="680" y="202" width="174" height="104" rx="24" fill="${visual.detail}" opacity=".2"/>
        <rect x="680" y="322" width="174" height="104" rx="24" fill="${visual.accent}" opacity=".2"/>
        <circle cx="574" cy="316" r="58" fill="${visual.detail}" opacity=".82"/>
        <path d="M526 374 Q574 302 622 374" fill="${visual.background}" opacity=".72"/>
      </g>
    </svg>
  `);
};

const findFeatureFromPrompt = (prompt: string) => {
  const normalizedPrompt = prompt.trim().toLowerCase();
  const fallbackFeature = lightchainFeatureCatalog.find(isBetaFeature) ?? lightchainFeatureCatalog[0];
  if (!normalizedPrompt) return fallbackFeature;

  const keywordRoute = [
    { keywords: ['背景削除', '切り抜き', 'remove background', 'remove-bg'], featureId: 'remove-background' },
    { keywords: ['プリント', 'print image', 'print design'], featureId: 'printing-image' },
    { keywords: ['canvas', 'キャンバス', '編集'], featureId: 'canvas-editing' },
    { keywords: ['着せ替え', 'フィッティング', 'fitting', '着用'], featureId: 'virtual-fitting' },
    { keywords: ['モデル', '体型', 'サイズ'], featureId: 'model-body-shape' },
    { keywords: ['生地', 'fabric', '布'], featureId: 'fabric-simulation' },
    { keywords: ['柄', 'ロゴ', 'グラフィック'], featureId: 'graphic-design' },
    { keywords: ['バナー', '販促', 'sns', 'ec'], featureId: 'marketing-workspace' },
  ].find((item) => item.keywords.some((keyword) => normalizedPrompt.includes(keyword)));

  if (keywordRoute) {
    return lightchainFeatureCatalog.find((feature) => feature.id === keywordRoute.featureId && isBetaFeature(feature)) ?? fallbackFeature;
  }

  return lightchainFeatureCatalog.find((feature) => {
    const haystack = [feature.title, feature.lightchainName, feature.description, feature.capability, feature.tags.join(' ')]
      .join(' ')
      .toLowerCase();
    return isBetaFeature(feature) && (haystack.includes(normalizedPrompt) || normalizedPrompt.includes(feature.title.toLowerCase()));
  }) ?? fallbackFeature;
};

interface GenerateLightchainEntryProps {
  compactOnMobile?: boolean;
}

export function GenerateLightchainEntry({ compactOnMobile = false }: GenerateLightchainEntryProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState<LightchainCategoryId>('recommended');
  const [command, setCommand] = useState('');
  const [galleryTab, setGalleryTab] = useState<(typeof galleryTabs)[number]['id']>('recommended');
  const [selectedCase, setSelectedCase] = useState<(typeof galleryCases)[number] | null>(null);
  const categoryParam = searchParams.get('category');

  useEffect(() => {
    if (categoryParam && lightchainCategories.some((category) => category.id === categoryParam)) {
      setActiveCategory(categoryParam as LightchainCategoryId);
    }
  }, [categoryParam]);

  const visibleFeatures = useMemo(
    () => getLightchainLauncherFeatures(activeCategory).filter(isBetaFeature),
    [activeCategory],
  );
  const commandFeature = findFeatureFromPrompt(command);
  const commandHref = buildLightchainFeatureHref(commandFeature);
  const galleryItems = galleryTab === 'recommended'
    ? galleryCases
    : [];

  const handleCategoryChange = (categoryId: LightchainCategoryId) => {
    setActiveCategory(categoryId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('category', categoryId);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <div className="min-h-[calc(100vh-70px)] bg-[#050708] text-white">
      <section className="relative overflow-hidden px-5 pb-12 pt-12 sm:px-8 lg:px-10 lg:pt-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_55%_6%,rgba(24,78,83,0.22),transparent_40%),linear-gradient(180deg,rgba(5,10,12,0.1),rgba(5,7,8,0.92))]" />
        <div className="relative mx-auto max-w-[1400px]">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl lg:text-5xl">LIGHTCHAIN AI</h1>
            <p className="text-sm font-medium text-neutral-300 sm:text-base">アパレル特化のAIデザインワークスペース</p>
          </div>

          <form
            className="mt-7 flex max-w-[520px] items-center rounded-full border border-cyan-300/75 bg-white/[0.035] px-4 py-2 shadow-[0_0_22px_rgba(56,189,248,0.12)] focus-within:border-indigo-300"
            onSubmit={(event) => {
              event.preventDefault();
              navigate(`${commandHref}${commandHref.includes('?') ? '&' : '?'}prompt=${encodeURIComponent(command.trim())}`);
            }}
          >
            <Sparkles className="h-4 w-4 shrink-0 text-cyan-300" />
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-500"
              placeholder="指示を入力してください... 例：『モデルの着せ替え』"
              aria-label="指示を入力してください"
            />
          </form>

          <div role="tablist" aria-label="Light Chainカテゴリ" className="mt-12 flex max-w-[650px] overflow-hidden rounded-lg border border-white/15 bg-white/[0.07] p-1">
            {lightchainCategories.map((category) => {
              const active = category.id === activeCategory;
              return (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-pressed={active}
                  onClick={() => handleCategoryChange(category.id)}
                  className={`min-w-0 flex-1 whitespace-nowrap rounded-md px-3 py-2.5 text-xs font-semibold transition sm:px-5 sm:text-sm ${
                    active ? 'bg-gradient-to-r from-cyan-300 to-indigo-200 text-neutral-950 shadow-[0_0_20px_rgba(103,232,249,0.18)]' : 'text-neutral-400 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  {category.label}
                  {category.id === 'recommended' && <span className="ml-1 text-[10px]">Hot</span>}
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="lightchain-tool-grid">
            {visibleFeatures.map((feature, index) => {
              const hiddenOnMobile = compactOnMobile && index > 5;
              return (
                <Link
                  key={feature.id}
                  to={buildLightchainFeatureHref(feature)}
                  data-testid="lightchain-tool-card"
                  className={`${hiddenOnMobile ? 'hidden md:block' : ''} group overflow-hidden rounded-2xl border border-white/10 bg-[#171b1d] transition hover:-translate-y-0.5 hover:border-cyan-300/50 hover:bg-[#1b2022]`}
                >
                  <div className="relative aspect-[1.72] overflow-hidden bg-[#263235]">
                    <img src={buildLauncherFeatureImage(feature.id)} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" />
                    {getLightchainLauncherBadge(feature) && <span className="absolute right-2 top-2 rounded-full bg-fuchsia-500 px-2 py-1 text-[10px] font-bold">{getLightchainLauncherBadge(feature)}</span>}
                    <span className="absolute bottom-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/25 text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{getLightchainLauncherTitle(feature)}</h3>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-400">{getLightchainLauncherDescription(feature)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 px-5 py-8 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-[1400px]">
          <h2 className="text-xs font-semibold text-neutral-300">事例共有</h2>
          <div role="tablist" aria-label="事例共有カテゴリ" className="mt-4 flex gap-5 overflow-x-auto border-b border-white/10 pb-2 text-xs text-neutral-500">
            {galleryTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={galleryTab === tab.id}
                onClick={() => setGalleryTab(tab.id)}
                className={`shrink-0 border-b-2 pb-2 transition ${galleryTab === tab.id ? 'border-cyan-300 text-cyan-200' : 'border-transparent hover:text-white'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {galleryItems.length === 0 ? (
            <div className="py-14 text-center text-sm text-neutral-500">該当する結果が見つかりません</div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {galleryItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedCase(item)}
                  className="group rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-cyan-300/50 hover:bg-white/[0.07]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[10px] font-semibold text-cyan-100">CASE</span>
                    <ArrowRight className="h-4 w-4 text-neutral-600 transition group-hover:translate-x-1 group-hover:text-cyan-200" />
                  </div>
                  <p className="mt-4 line-clamp-3 text-sm font-semibold leading-6 text-white">{item.title}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={selectedCase.title}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/15 bg-[#111416] p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-semibold text-cyan-200">Light Chain 事例</span>
                <h2 className="mt-2 text-xl font-semibold leading-8 text-white">{selectedCase.title}</h2>
              </div>
              <button type="button" onClick={() => setSelectedCase(null)} aria-label="閉じる" className="rounded-full p-2 text-neutral-400 hover:bg-white/10 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-5 text-sm leading-7 text-neutral-300">{selectedCase.description}</p>
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs font-semibold text-neutral-400">実現ステップ</p>
              <p className="mt-2 text-sm leading-6 text-white">{selectedCase.step}</p>
            </div>
            <Link
              to={buildLightchainFeatureHref(lightchainFeatureCatalog.find((feature) => feature.id === selectedCase.featureId) ?? lightchainFeatureCatalog[0])}
              onClick={() => setSelectedCase(null)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200"
            >
              同じもの作成
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
