import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Images,
  Layers3,
  PackageOpen,
  Palette,
  PlayCircle,
  Shirt,
  Sparkles,
  UserRound,
  WandSparkles,
  X,
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
  '/lightchain/fabric-image': Shirt,
  '/lightchain/printing-image': Palette,
  '/tools/fabric': Shirt,
  '/model': UserRound,
  '/flow/orientedDesign': WandSparkles,
  '/brand/settings': CheckCircle2,
  '/canvas/new': Layers3,
};

const statusLabel: Record<LightchainFeature['status'], string> = {
  production: '生成対応',
  workspace: '作業台',
  'local-proof': '検証済み',
};

const statusTone: Record<LightchainFeature['status'], string> = {
  production: 'border-emerald-300/35 bg-emerald-300/10 text-emerald-100',
  workspace: 'border-sky-300/35 bg-sky-300/10 text-sky-100',
  'local-proof': 'border-amber-300/35 bg-amber-300/10 text-amber-100',
};

const galleryTabs = [
  { id: 'recommended', label: 'おすすめの事例' },
  { id: 'edit', label: 'デザイン修正' },
  { id: 'print', label: '柄・プリント' },
  { id: 'visual', label: 'ビジュアル素材' },
  { id: 'marketing', label: 'マーケティングコンテンツ' },
  { id: 'production', label: '生産のつながりです' },
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
  {
    id: 'video-promotion',
    title: 'ファッションスタジオ＋動画ワークステーション：白背景の商品画像からシーン動画を生成',
    description: '商品画像、シーン、CTAを短尺プロモーションの構成にまとめます。',
    step: '動画ワークステーション → storyboard → CTA → 保存',
    featureId: 'video-workstation',
  },
] as const;

const getRouteBase = (route: string) => route.split('?')[0];
const getRouteIcon = (feature: LightchainFeature) => routeIcon[getRouteBase(feature.route)] ?? Sparkles;
const isBetaFeature = (feature: LightchainFeature | undefined): feature is LightchainFeature => Boolean(feature && feature.betaIncluded !== false);

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
    { keywords: ['動画', 'sns動画', 'storyboard'], featureId: 'video-workstation' },
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

  const activeCategoryMeta = lightchainCategories.find((category) => category.id === activeCategory) ?? lightchainCategories[0];
  const visibleFeatures = useMemo(
    () => lightchainFeatureCatalog.filter((feature) => feature.category === activeCategory && isBetaFeature(feature)),
    [activeCategory],
  );
  const commandFeature = findFeatureFromPrompt(command);
  const commandHref = buildLightchainFeatureHref(commandFeature);
  const galleryItems = galleryTab === 'recommended'
    ? galleryCases.filter((item) => item.featureId !== 'video-workstation')
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
          <div className="flex items-end gap-4">
            <h1 className="text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">LIGHTCHAIN AI</h1>
            <p className="pb-1 text-sm text-neutral-400 sm:text-base">アパレル特化のAIデザインワークスペース</p>
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

          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{activeCategoryMeta.label}</h2>
              <p className="mt-1 text-sm text-neutral-400">{activeCategoryMeta.description}</p>
            </div>
            <span className="hidden text-xs text-neutral-500 sm:inline">{visibleFeatures.length} tools</span>
          </div>

          <div className="mt-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3" data-testid="lightchain-tool-grid">
            {visibleFeatures.map((feature, index) => {
              const Icon = getRouteIcon(feature);
              const hiddenOnMobile = compactOnMobile && index > 5;
              return (
                <Link
                  key={feature.id}
                  to={buildLightchainFeatureHref(feature)}
                  data-testid="lightchain-tool-card"
                  className={`${hiddenOnMobile ? 'hidden md:block' : ''} group overflow-hidden rounded-2xl border border-white/10 bg-[#171b1d] transition hover:-translate-y-0.5 hover:border-cyan-300/50 hover:bg-[#1b2022]`}
                >
                  <div className="relative flex h-28 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_35%_30%,rgba(121,239,255,0.26),transparent_28%),linear-gradient(135deg,#273337,#111719)]">
                    <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(115deg,transparent_20%,rgba(255,255,255,0.12)_20.5%,transparent_21%)] [background-size:20px_20px]" />
                    <Icon className="relative h-12 w-12 text-cyan-100 transition group-hover:scale-110" strokeWidth={1.2} />
                    {feature.id === 'marketing-workspace' && <span className="absolute right-2 top-2 rounded-full bg-fuchsia-500 px-2 py-1 text-[10px] font-bold">Beta</span>}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{feature.title}</h3>
                      {feature.id !== 'marketing-workspace' && <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusTone[feature.status]}`}>{statusLabel[feature.status]}</span>}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-400">{feature.description}</p>
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
