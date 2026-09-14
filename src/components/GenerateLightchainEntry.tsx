import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Search,
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
import {
  getWorkspaceArtifactCanonicalStoragePath,
  listWorkspaceArtifacts,
  type WorkspaceArtifact,
} from '../lib/localWorkspaceArtifacts';
import { withSignedImageUrls } from '../lib/storage';
import { useAuthStore } from '../stores/authStore';

const galleryTabs = [
  { id: 'recommended', label: 'おすすめの事例' },
  { id: 'edit', label: 'デザイン修正' },
  { id: 'print', label: '柄・プリント' },
  { id: 'visual', label: 'ビジュアル素材' },
  { id: 'marketing', label: 'マーケティングコンテンツ' },
  { id: 'production', label: '生産' },
] as const;

const galleryCasesByTab = {
  recommended: [
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
      description: 'モデル画像と生地画像を配置し、サンプルレスで着用効果を確認します。',
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
  ],
  edit: [
    {
      id: 'detail-recreate',
      title: '【ファッションスタジオ】— ディテールをワンクリックで再現',
      description: '服のディテールを参照画像から保ち、対象箇所を調整します。',
      step: 'ウェアデザインラボ → 対象箇所 → 候補比較 → 保存',
      featureId: 'wear-design-lab',
    },
    {
      id: 'inspiration-knit',
      title: 'インスピレーション｜インスピレーションデザイン：クリエイティブなニットコレクション設計',
      description: '素材やテーマから複数のデザイン案を作り、企画へつなげます。',
      step: 'インスピレーション → テーマ → 複数案 → デザインエージェント',
      featureId: 'inspiration-design',
    },
    {
      id: 'body-proportion',
      title: '【ファッションスタジオ】— モデルの体型・プロポーションをワンクリックで調整',
      description: '衣服と構図を保ちながら、モデル条件の差分を比較します。',
      step: 'モデル企画ライブラリ → 体型・サイズ → 比較 → 保存',
      featureId: 'model-body-shape',
    },
    {
      id: 'line-to-product',
      title: '【ファッションスタジオ】— 線画から商品画像・モデル着用画像までを瞬時に生成',
      description: '線画のsource provenanceを保ちながら、商品と着用の候補へ展開します。',
      step: '平絵生成 → 線画の実写化 → AIフィッティング → 保存',
      featureId: 'lineart-to-real',
    },
  ],
  print: [
    {
      id: 'print-fabric',
      title: 'ファッションスタジオ：平絵＋生地',
      description: '平絵と生地を組み合わせ、質感と服の見え方を確認します。',
      step: '生地イメージ → 生地選択 → 結果比較 → Canvas',
      featureId: 'fabric-simulation',
    },
    {
      id: 'print-placement',
      title: 'プリントイメージ：服画像へプリントを配置',
      description: 'スポットと全体のプリント範囲を切り替え、配置結果を比較します。',
      step: 'プリントイメージ → 範囲調整 → AI生成 → Gallery / History',
      featureId: 'printing-image',
    },
    {
      id: 'print-vector',
      title: 'パターンをベクター化し量産用データへつなげる',
      description: '総柄、リピート、配色の方針を保持して生産工程へ渡します。',
      step: '柄・グラフィック → ベクター化 → repeat確認 → 保存',
      featureId: 'pattern-vector-pro',
    },
    {
      id: 'graphic-motif',
      title: 'AIグラフィックデザイン：柄・ロゴ・モチーフを作成',
      description: 'グラフィック案を商品、プリント、販促素材へ展開します。',
      step: 'グラフィックツール → モチーフ → 配置 → 保存',
      featureId: 'graphic-design',
    },
  ],
  visual: [
    {
      id: 'flat-to-fitting',
      title: '【ファッションスタジオ】— 平置き商品画像をモデル着用画像へ変換',
      description: '平置き画像を標準モデルの着用イメージへ変換します。',
      step: 'AIフィッティング → 衣服画像 → モデル条件 → 生成',
      featureId: 'flat-to-model',
    },
    {
      id: 'multi-angle',
      title: 'ファッションスタジオの360度マルチアングル表示',
      description: '正面・側面・背面など複数の角度でシルエットと素材感を確認します。',
      step: 'ファッションスタジオ → 撮影セット → アングル比較 → Canvas',
      featureId: 'fashion-studio',
    },
    {
      id: 'styling-try-on',
      title: '【ファッションスタジオ】— 多彩なコーディネート試着',
      description: '服、モデル、背景、小物を組み合わせて着用候補を比較します。',
      step: 'ファッションスタジオ → 素材選択 → コーディネート → 保存',
      featureId: 'fashion-studio',
    },
    {
      id: 'pose-visual',
      title: '【ファッションスタジオ】— ポーズ指定ワンクリック生成',
      description: '衣服とモデルを保ったまま、ポーズだけを比較します。',
      step: 'AIフィッティング → ポーズ参考 → 結果比較 → 保存',
      featureId: 'virtual-fitting',
    },
  ],
  marketing: [
    {
      id: 'marketing-lingerie',
      title: '【マーケティングワークスペース】既存画像から多様な販促ビジュアルを生成',
      description: '既存の商品画像やモデル着用画像から、複数ターゲット向け素材を作ります。',
      step: 'マーケティング → 商品画像 → EC / SNS → 保存',
      featureId: 'marketing-workspace',
    },
    {
      id: 'fitting-poster',
      title: 'AIフィッティング：多様な体型・人種に対応したランジェリーポスター',
      description: 'モデル条件を変えた販促用着用ビジュアルを比較します。',
      step: 'AIフィッティング → モデル企画 → ポスター → 保存',
      featureId: 'virtual-fitting',
    },
    {
      id: 'agent-styling',
      title: 'デザインエージェント＋ファッションスタジオ：多様なスタイリング展開',
      description: '企画案から複数のスタイリングと販促素材へ連続して展開します。',
      step: 'デザインエージェント → シリーズ比較 → ファッションスタジオ → 保存',
      featureId: 'design-agent',
    },
    {
      id: 'text-style',
      title: 'ファッションスタジオ（テキスト生成）：スタイルDNAを保ったバリエーション',
      description: '人気デザインのトーンを保ちながら、企画のバリエーションを作ります。',
      step: 'ファッションスタジオ → テキスト指示 → バリエーション → 保存',
      featureId: 'fashion-studio',
    },
  ],
  production: [
    {
      id: 'outdoor-line',
      title: 'ファッションスタジオ：実物から線画化',
      description: '商品画像から生産・企画用の線画とsource provenanceを作ります。',
      step: '線画生成 → 線画確認 → ベクター化 → 保存',
      featureId: 'lineart-to-real',
    },
    {
      id: 'garment-detail',
      title: 'ファッションスタジオ：服の着せ替えからデザイン制作まで',
      description: '衣服、モデル、背景をつないで企画から制作へ進みます。',
      step: 'AIフィッティング → デザイン修正 → 生地／プリント → Canvas',
      featureId: 'virtual-fitting',
    },
    {
      id: 'multiple-models',
      title: '【ファッションスタジオ】— 複数モデルによるシーンを生成',
      description: '同じ衣服を複数モデルとシーンで比較し、量産前の判断へつなげます。',
      step: 'モデル企画ライブラリ → シーン → 複数案 → 保存',
      featureId: 'fashion-studio',
    },
    {
      id: 'three-dimensional-display',
      title: '【ファッションスタジオ】— 3Dビジュアル展示',
      description: '商品デザインの見え方を立体的に確認し、企画・確認・販促へ渡します。',
      step: 'ファッションスタジオ → 撮影セット → マルチアングル → Canvas',
      featureId: 'fashion-studio',
    },
  ],
} as const;

type GalleryCase = {
  id: string;
  title: string;
  description: string;
  step: string;
  featureId: string;
  artifactId?: string;
  imageUrl?: string;
};

const resolveArtifactFeatureId = (artifact: WorkspaceArtifact, fallback: string) => {
  const candidate = artifact.metadata.toolId;
  return typeof candidate === 'string' && lightchainFeatureCatalog.some((feature) => feature.id === candidate)
    ? candidate
    : fallback;
};

const isBetaFeature = (feature: LightchainFeature | undefined): feature is LightchainFeature => Boolean(feature && feature.betaIncluded !== false);

// The home mirrors Lightchain's complete recommended card inventory. Video remains
// visibly discoverable here while its /video destination stays fail-closed.
const isHomepageVisibleFeature = (_feature: LightchainFeature): boolean => true;

/**
 * Lightchain is the visual source of truth for this launcher. These are the
 * public production card assets observed on Lightchain, kept as remote
 * references so Heavy does not invent substitute artwork or duplicate files.
 */
const launcherCategoryImages: Record<LightchainCategoryId, string> = {
  recommended: 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/designProduction.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  planning: 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/aiDesignCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  fitting: 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/VirtualFittingCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  graphics: 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/GeneratePrintingCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
};

const launcherFeatureImages: Partial<Record<string, string>> = {
  'design-workspace': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/designProduction.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'marketing-workspace': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/GenerateMarketingCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'virtual-fitting': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/VirtualFittingCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'wear-design-lab': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/orientedDesignCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'model-library': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/FittingModelLibraryCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'fashion-studio': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/integrationCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'design-agent': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/AIAgentCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'heavychain-lab': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/laboratoryCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'inspiration-design': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/aiDesignCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'fabric-simulation': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/FabricBodyCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'lineart-to-real': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/LineArtToRealCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'change-color': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/OneClickChangeColorCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'flat-vector': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/LineArtVectorConvertCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'custom-style': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/fashionModelCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'graphic-design': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/GeneratePrintingCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'pattern-vector-pro': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/SVGConvertCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'design-arrange': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/OneClickModifyPrintingCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
  'print-design': 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/home5_0_1/FlowerShapedDesignCover.png?x-oss-process=image/resize,m_lfit,w_256,limit_1/format,webp',
};

const buildGalleryExampleImage = (featureId: string) => {
  const feature = lightchainFeatureCatalog.find((candidate) => candidate.id === featureId);
  return feature
    ? (launcherFeatureImages[feature.id] ?? launcherCategoryImages[feature.category])
    : launcherCategoryImages.recommended;
};

const buildLauncherFeatureImage = (feature: LightchainFeature) => (
  launcherFeatureImages[feature.id] ?? launcherCategoryImages[feature.category]
);

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
  const { currentBrand, user } = useAuthStore();
  const [activeCategory, setActiveCategory] = useState<LightchainCategoryId>('recommended');
  const [command, setCommand] = useState('');
  const [galleryTab, setGalleryTab] = useState<(typeof galleryTabs)[number]['id']>('recommended');
  const [gallerySearchOpen, setGallerySearchOpen] = useState(false);
  const [galleryQuery, setGalleryQuery] = useState('');
  const [gallerySearchTerm, setGallerySearchTerm] = useState('');
  const [selectedCase, setSelectedCase] = useState<GalleryCase | null>(null);
  const [galleryArtifacts, setGalleryArtifacts] = useState<WorkspaceArtifact[]>([]);
  const categoryParam = searchParams.get('category');

  useEffect(() => {
    if (categoryParam && lightchainCategories.some((category) => category.id === categoryParam)) {
      setActiveCategory(categoryParam as LightchainCategoryId);
    }
  }, [categoryParam]);

  const visibleFeatures = useMemo(
    () => getLightchainLauncherFeatures(activeCategory).filter(isHomepageVisibleFeature),
    [activeCategory],
  );
  const commandFeature = findFeatureFromPrompt(command);
  const commandHref = buildLightchainFeatureHref(commandFeature);
  const galleryItems = useMemo<GalleryCase[]>(() => {
    const templates = galleryCasesByTab[galleryTab];
    const persistedItems = galleryArtifacts.slice(0, templates.length).flatMap((artifact, index) => {
      const template = templates[index];
      const imageUrl = artifact.imageUrl.trim();
      if (!imageUrl) return [];
      return [{
        ...template,
        id: `saved-${artifact.id}`,
        artifactId: artifact.id,
        title: artifact.title || template.title,
        description: artifact.prompt?.trim() || template.description,
        featureId: resolveArtifactFeatureId(artifact, template.featureId),
        imageUrl,
      }];
    });
    const exampleItems = templates.slice(persistedItems.length).map((template) => ({
      ...template,
      id: `example-${template.id}`,
      imageUrl: buildGalleryExampleImage(template.featureId),
    }));
    return [...persistedItems, ...exampleItems];
  }, [galleryArtifacts, galleryTab]);

  const filteredGalleryItems = useMemo(() => {
    const normalizedQuery = gallerySearchTerm.trim().toLocaleLowerCase();
    if (!normalizedQuery) return galleryItems;
    return galleryItems.filter((item) => (
      `${item.title} ${item.description} ${item.step}`.toLocaleLowerCase().includes(normalizedQuery)
    ));
  }, [galleryItems, gallerySearchTerm]);

  useEffect(() => {
    if (!currentBrand?.id) {
      setGalleryArtifacts([]);
      return;
    }
    let cancelled = false;
    const localArtifacts = listWorkspaceArtifacts(currentBrand.id, user?.id)
      .filter((artifact) => Boolean(artifact.imageUrl || getWorkspaceArtifactCanonicalStoragePath(artifact.metadata)));
    setGalleryArtifacts(localArtifacts);

    const imageReferences = localArtifacts.map((artifact) => ({
      storage_path: getWorkspaceArtifactCanonicalStoragePath(artifact.metadata) ?? artifact.imageUrl,
      image_url: artifact.imageUrl,
    }));
    void withSignedImageUrls(imageReferences)
      .then((signedArtifacts) => {
        if (cancelled) return;
        setGalleryArtifacts(localArtifacts.map((artifact, index) => {
          const canonicalStoragePath = getWorkspaceArtifactCanonicalStoragePath(artifact.metadata);
          return {
            ...artifact,
            imageUrl: signedArtifacts[index]?.image_url || (canonicalStoragePath ? '' : artifact.imageUrl),
          };
        }));
      })
      .catch(() => {
        // Local data URLs remain usable when remote signing is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [currentBrand?.id, user?.id]);

  const handleCategoryChange = (categoryId: LightchainCategoryId) => {
    setActiveCategory(categoryId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('category', categoryId);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <div className="min-h-[calc(100vh-50px)] bg-[#171b1c] text-white">
      <section className="relative overflow-hidden px-10 pb-4 pt-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_55%_6%,rgba(24,78,83,0.12),transparent_40%)]" />
        <div className="relative mx-auto max-w-none">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-3xl font-[Montserrat] font-bold tracking-[-0.04em] text-white sm:text-4xl lg:text-5xl">LIGHTCHAIN AI</h1>
            <p className="text-sm font-medium text-neutral-300 sm:text-base">アパレル特化のAIデザインワークスペース</p>
          </div>

          <form
            className="mt-4 flex h-10 max-w-[507px] items-center rounded-full border border-cyan-300/75 bg-white/[0.035] px-4 shadow-[0_0_22px_rgba(56,189,248,0.12)] focus-within:border-indigo-300"
            onSubmit={(event) => {
              event.preventDefault();
              navigate(`${commandHref}${commandHref.includes('?') ? '&' : '?'}prompt=${encodeURIComponent(command.trim())}`);
            }}
          >
            <Sparkles className="h-4 w-4 shrink-0 text-cyan-300" />
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent px-3 py-0 text-sm text-white outline-none placeholder:text-neutral-500"
              placeholder="指示を入力してください... 例：『モデルの着せ替え』"
              aria-label="指示を入力してください"
            />
          </form>

          <div role="tablist" aria-label="Light Chainカテゴリ" className="mt-12 flex h-10 max-w-[645px] overflow-hidden rounded-lg border border-white/15 bg-white/[0.07] p-1">
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
                  className={`min-w-0 flex-1 whitespace-nowrap rounded-md px-3 py-0 text-xs font-semibold transition sm:px-5 sm:text-sm ${
                    active ? 'bg-[#63cbc7] text-neutral-950 shadow-[0_0_20px_rgba(99,203,199,0.18)]' : 'text-neutral-400 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  {category.label}
                  {category.id === 'recommended' && <><span aria-hidden="true">{' '}</span><span className="ml-1 text-[10px]">Hot</span></>}
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="lightchain-tool-grid">
            {visibleFeatures.map((feature, index) => {
              const hiddenOnMobile = compactOnMobile && index > 5;
              return (
                <Link
                  key={feature.id}
                  to={buildLightchainFeatureHref(feature)}
                  data-testid="lightchain-tool-card"
                  className={`${hiddenOnMobile ? 'hidden md:flex' : ''} relative flex w-full cursor-pointer gap-3 overflow-hidden rounded-2xl border border-white/10 bg-[#262a2b] p-3 transition hover:border-cyan-300/50 xl:gap-4 xl:p-4`}
                >
                  {getLightchainLauncherBadge(feature) && <span className="absolute right-0 top-0 z-10 rounded-bl-xl bg-gradient-to-r from-fuchsia-500 to-rose-500 px-3 py-1 text-[10px] font-medium leading-3 text-white">{getLightchainLauncherBadge(feature)}</span>}
                  <div className="relative h-[80px] w-[112px] shrink-0 overflow-hidden rounded-[5px] bg-white xl:h-[88px] xl:w-[132px]">
                    <img src={buildLauncherFeatureImage(feature)} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </div>
                  <div className="flex min-h-[80px] min-w-0 flex-1 flex-col gap-1 xl:min-h-[88px]">
                    <div className="relative flex min-h-7 items-center xl:min-h-8">
                      <h3 className="min-w-0 truncate bg-gradient-to-r from-white to-cyan-100 bg-clip-text text-sm font-medium leading-5 text-transparent xl:text-base xl:leading-6">{getLightchainLauncherTitle(feature)}</h3>
                    </div>
                    <p className="line-clamp-3 text-sm leading-4 text-neutral-300">{getLightchainLauncherDescription(feature)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 px-5 pb-8 pt-10 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-none">
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white">事例共有</h2>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <div role="tablist" aria-label="事例共有カテゴリ" className="flex w-fit gap-0 overflow-x-auto rounded-lg border border-white/10 bg-[#262a2b] p-1 text-sm text-neutral-400">
            {galleryTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={galleryTab === tab.id}
                onClick={() => setGalleryTab(tab.id)}
                className={`shrink-0 rounded-md px-7 py-2 transition ${galleryTab === tab.id ? 'bg-[#63cbc7] font-medium text-neutral-950' : 'hover:bg-white/[0.06] hover:text-white'}`}
              >
                {tab.label}
              </button>
            ))}
            </div>
            <button type="button" aria-label="検索" aria-expanded={gallerySearchOpen} onClick={() => setGallerySearchOpen((open) => !open)} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#262a2b] text-neutral-400 transition hover:bg-white/[0.08] hover:text-white ${gallerySearchOpen ? 'border-cyan-200/60 text-cyan-100' : ''}`}>
              <Search className="h-5 w-5" />
            </button>
            {gallerySearchOpen && (
              <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-white/15 bg-[#262a2b] px-4 py-2 text-sm text-neutral-300 sm:max-w-sm" aria-label="検索キーワードを入力してください...">
                <Search className="h-4 w-4 shrink-0 text-neutral-500" />
                <input
                  autoFocus
                  value={galleryQuery}
                  onChange={(event) => setGalleryQuery(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-neutral-500"
                  placeholder="検索キーワードを入力してください..."
                  aria-label="検索キーワードを入力してください..."
                />
                {galleryQuery && <button type="button" aria-label="事例検索をクリア" onClick={() => { setGalleryQuery(''); setGallerySearchTerm(''); }} className="text-neutral-500 hover:text-white"><X className="h-4 w-4" /></button>}
                <button type="button" aria-label="検索" onClick={() => setGallerySearchTerm(galleryQuery.trim())} className="rounded-md bg-[#63cbc7] px-3 py-1 text-xs font-medium text-neutral-950 transition hover:bg-[#7edbd7]">検索</button>
              </label>
            )}
          </div>

          {filteredGalleryItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-5 py-14 text-center text-sm text-neutral-400">
              {gallerySearchTerm.trim() ? (
                <>
                  <span className="block">該当する結果が見つかりません</span>
                  <span className="mt-1 block text-xs text-neutral-500">別のキーワードで検索してください</span>
                </>
              ) : 'このカテゴリに表示できる保存済み成果物はまだありません。生成結果を保存すると、ここに表示されます。'}
            </div>
          ) : (
            <div className="mt-4 columns-1 gap-2 sm:columns-2 xl:columns-4 2xl:columns-5">
              {filteredGalleryItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedCase(item)}
                  className="group relative mb-2 block w-full break-inside-avoid overflow-hidden rounded-xl bg-[#262a2b] text-left shadow-md transition hover:shadow-xl"
                >
                  <img src={item.imageUrl} alt="" loading="lazy" className="block h-auto w-full object-cover transition duration-500 group-hover:scale-[1.01]" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-4 pt-14 opacity-0 transition group-hover:opacity-100">
                    <p className="text-sm font-medium leading-5 text-white">{item.title}</p>
                  </div>
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
