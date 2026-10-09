import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Search,
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
import { isHeavyWorkspaceRuntime } from '../lib/heavyWorkspace';

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
      id: 'outdoor-line',
      title: 'ファッションスタジオ - アウトドアジャケット実物から線画化',
      description: '商品画像から企画・生産用の線画とsource provenanceを作ります。',
      step: '線画生成 → 線画確認 → ベクター化 → 保存',
      featureId: 'lineart-to-real',
    },
    {
      id: 'apparel-pattern-fitting',
      title: '【ファッションスタジオ】— モデル着用画像のアパレルパターンをワンクリックで高精度生成',
      description: '衣服とモデル条件を組み合わせ、着用パターンを比較します。',
      step: 'AIフィッティング → 衣服画像 → モデル条件 → 生成',
      featureId: 'virtual-fitting',
    },
    {
      id: 'detail-recreate-recommended',
      title: '【ファッションスタジオ】— ディテールをワンクリックで再現',
      description: '参照画像の衣服ディテールを保ちながら対象箇所を調整します。',
      step: 'ウェアデザインラボ → 対象箇所 → 候補比較 → 保存',
      featureId: 'wear-design-lab',
    },
    {
      id: 'marketing-lingerie',
      title: '【マーケティングワークスペース】は、既存のランジェリー商品画像やモデル着用画像を活用し、異なるモデルによる新しい販促ビジュアルを一括生成します。',
      description: '既存の商品画像やモデル着用画像から複数ターゲット向け素材を作ります。',
      step: 'マーケティング → 商品画像 → EC / SNS / コピー → 保存',
      featureId: 'marketing-workspace',
    },
    {
      id: 'text-style-recommended',
      title: 'ファッションスタジオ（テキスト生成）：人気モデルのスタイルDNAを維持しながら、AIが人気デザインのバリエーション展開をスピーディーに実現',
      description: '人気デザインのトーンを保ちながら、企画のバリエーションを作ります。',
      step: 'ファッションスタジオ → テキスト指示 → バリエーション → 保存',
      featureId: 'fashion-studio',
    },
    {
      id: 'flat-fabric',
      title: 'ファッションスタジオ： 平絵＋生地',
      description: '平絵と生地を組み合わせ、質感と服の見え方を確認します。',
      step: '生地イメージ → 生地選択 → 結果比較 → Canvas',
      featureId: 'fabric-simulation',
    },
    {
      id: 'body-proportion-recommended',
      title: '【ファッションスタジオ】— モデルの体型・プロポーションをワンクリックで調整。',
      description: '衣服と構図を保ちながら、モデル条件の差分を比較します。',
      step: 'モデル企画ライブラリ → 体型・サイズ → 比較 → 保存',
      featureId: 'model-body-shape',
    },
    {
      id: 'multiple-models-recommended',
      title: '【ファッションスタジオ】— 複数モデルによるシーンをワンクリックで生成',
      description: '同じ衣服を複数モデルとシーンで比較します。',
      step: 'モデル企画ライブラリ → シーン → 複数案 → 保存',
      featureId: 'fashion-studio',
    },
    {
      id: 'fitting-no-shoot',
      title: '【AIフィッティング】撮影不要、すぐに着用イメージ。',
      description: '衣服画像とモデル条件から着用イメージを作ります。',
      step: 'AIフィッティング → 衣服画像 → モデル条件 → 生成',
      featureId: 'virtual-fitting',
    },
    {
      id: 'socks-line-to-real',
      title: '【ファッションスタジオ】——靴下カテゴリー：手描き線画から実物イメージをワンクリック生成',
      description: '手描き線画を実物イメージへ展開します。',
      step: '線画生成 → 実物化 → 保存',
      featureId: 'lineart-to-real',
    },
    {
      id: 'video-workstation-recommended',
      title: 'ファッションスタジオ＋動画ワークスペース：白背景の商品画像からシーン動画をワンクリック生成',
      description: '商品画像からプロモーション動画の構成へ展開します。',
      step: '動画ワークステーション → 商品画像 → 構成 → 書き出し',
      featureId: 'video-workstation',
    },
    {
      id: 'face-pose-recommended',
      title: '【AIフィッティング】— アパレルデザイン画とモデルの顔・ポーズ参考画像を組み合わせ、リアルなモデル着用画像を瞬時に生成',
      description: 'デザイン画と顔・ポーズ参考画像を組み合わせて着用イメージを作ります。',
      step: 'AIフィッティング → 顔・ポーズ参考 → 生成 → 保存',
      featureId: 'virtual-fitting',
    },
    {
      id: 'three-dimensional-display-recommended',
      title: '【ファッションスタジオ】——靴下カテゴリー：3Dビジュアル展示',
      description: '商品デザインの見え方を立体的に確認します。',
      step: 'ファッションスタジオ → 撮影セット → マルチアングル → Canvas',
      featureId: 'fashion-studio',
    },
    {
      id: 'garment-design-video-recommended',
      title: '【ファッションスタジオ】——服の着せ替えからデザイン制作までをワンストップで実現',
      description: '衣服、モデル、背景をつないで企画から制作へ進みます。',
      step: 'AIフィッティング → デザイン修正 → 生地／プリント → Canvas',
      featureId: 'fashion-studio',
    },
    {
      id: 'inner-lookbook',
      title: 'ファッションスタジオ：インナーのLookbook生成',
      description: 'インナー商品のLookbook向けビジュアルを作ります。',
      step: 'ファッションスタジオ → 撮影セット → Lookbook → 保存',
      featureId: 'fashion-studio',
    },
    {
      id: 'flat-to-mannequin',
      title: '【ファッションスタジオ】— AIが平置き商品画像を標準マネキン着用画像へ自動変換。わずか20秒で画像生成し、業務効率を大幅に向上。',
      description: '平置き画像を標準マネキン着用画像へ変換します。',
      step: 'AIフィッティング → 平置き画像 → 生成 → 保存',
      featureId: 'flat-to-model',
    },
    {
      id: 'styling-try-on-recommended',
      title: '【ファッションスタジオ】 — ワンクリックで広がる多彩なコーディネート試着',
      description: '服、モデル、背景、小物を組み合わせて比較します。',
      step: 'ファッションスタジオ → 素材選択 → コーディネート → 保存',
      featureId: 'fashion-studio',
    },
    {
      id: 'line-to-product-recommended',
      title: '【ファッションスタジオ】— 線画から商品画像・モデル着用画像までを瞬時に生成',
      description: '線画のsource provenanceを保ちながら商品と着用候補へ展開します。',
      step: '平絵生成 → 線画の実写化 → AIフィッティング → 保存',
      featureId: 'lineart-to-real',
    },
    {
      id: 'fitting-poster-recommended',
      title: 'AIフィッティング+ファッションスタジオ:平置き画像を商用ポスターに変換',
      description: '平置き画像を商用ポスター向けの着用ビジュアルへ展開します。',
      step: 'AIフィッティング → ファッションスタジオ → ポスター → 保存',
      featureId: 'virtual-fitting',
    },
    {
      id: 'multi-angle-recommended',
      title: 'ファッションスタジオの360度マルチアングル表示機能では、正面・側面・背面など複数の角度から商品デザインを自動生成。',
      description: 'シルエット、素材感、縫製、装飾ディテールを複数角度で確認します。',
      step: 'ファッションスタジオ → 撮影セット → アングル比較 → Canvas',
      featureId: 'fashion-studio',
    },
    {
      id: 'pose-one-click',
      title: '【ファッションスタジオ】— ポーズ指定ワンクリック生成：ダイナミックなビジュアルで訴求力を最大化',
      description: '衣服とモデルを保ったままポーズを比較します。',
      step: 'AIフィッティング → ポーズ参考 → 結果比較 → 保存',
      featureId: 'virtual-fitting',
    },
  ],
  // These tabs are currently empty on the Light production session. Keep the
  // Heavy launcher faithful to that observed state instead of inventing cards.
  edit: [],
  print: [],
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
  production: [],
} as const;

// Kept exported for old fixture imports; Heavy Chain no longer renders the Lightchain wordmark.
export const LEGACY_LIGHTCHAIN_WORDMARK_PATH = 'M-0.000390589 34.176V0.576023H9.50361V25.152H23.7116V34.176H-0.000390589ZM27.0934 34.176V0.576023H36.9814V34.176H27.0934ZM67.6852 34.176H61.4452V30.48H61.0132C60.0052 33.264 57.9412 34.752 53.2852 34.752C42.7732 34.752 40.8052 29.808 40.8052 19.584V15.168C40.8052 4.94402 41.9572 2.47955e-05 54.2452 2.47955e-05C66.5332 2.47955e-05 67.6852 4.51202 67.6852 12.048V12.768H58.0852V11.328C58.0852 9.36002 57.3172 8.16002 54.2452 8.16002C51.1732 8.16002 50.4052 9.36002 50.4052 11.328V23.424C50.4052 25.392 51.1732 26.592 54.2452 26.592C57.3172 26.592 58.0852 25.392 58.0852 23.424V21.408H53.1412V15.6H67.6852V34.176ZM88.554 34.176V21.12H81.738V34.176H72.234V0.576023H81.738V13.92H88.554V0.576023H98.058V34.176H88.554ZM109.371 34.176V8.92802H101.019V0.576023H127.227V8.92802H118.875V34.176H109.371ZM142.362 34.752C130.41 34.752 129.258 29.808 129.258 19.584V15.168C129.258 4.94402 130.41 2.47955e-05 142.362 2.47955e-05C154.314 2.47955e-05 155.466 4.60802 155.466 12.768V14.928H145.866V11.328C145.866 9.36002 145.098 8.16002 142.362 8.16002C139.626 8.16002 138.858 9.36002 138.858 11.328V23.424C138.858 25.392 139.626 26.592 142.362 26.592C145.098 26.592 145.866 25.392 145.866 23.424V19.632H155.466V21.984C155.466 30.144 154.314 34.752 142.362 34.752ZM175.648 34.176V21.12H168.832V34.176H159.328V0.576023H168.832V13.92H175.648V0.576023H185.152V34.176H175.648ZM187.777 34.176L194.977 0.576023H209.281L216.481 34.176H205.537L205.057 30.72H199.201L198.721 34.176H187.777ZM199.393 23.52H204.865L202.465 11.04H201.793L199.393 23.52ZM219.14 34.176V0.576023H229.028V34.176H219.14ZM233.812 34.176V0.576023H245.236L250.852 17.52V34.176H248.164L242.116 15.936V34.176H233.812ZM276.183 34.176L283.383 0.576023H297.687L304.887 34.176H293.943L293.463 30.72H287.607L287.127 34.176H276.183ZM287.799 23.52H293.271L290.871 11.04H290.199L287.799 23.52ZM307.546 34.176V0.576023H317.434V34.176H307.546Z';

type GalleryCase = {
  id: string;
  title: string;
  description: string;
  step: string;
  featureId: string;
  artifactId?: string;
  imageUrl?: string;
  videoUrl?: string;
};

const resolveArtifactFeatureId = (artifact: WorkspaceArtifact, fallback: string) => {
  const candidates = [artifact.metadata.toolId, artifact.featureType];
  const matched = candidates.find((candidate): candidate is string => (
    typeof candidate === 'string' && lightchainFeatureCatalog.some((feature) => feature.id === candidate)
  ));
  if (matched) return matched;

  const normalizedFeatureType = candidates.find((candidate): candidate is string => (
    typeof candidate === 'string' && candidate.trim().length > 0
  ))
    ?.trim()
    .replace(/^lightchain-/, '')
    .replace(/-provider-result$/, '');
  return normalizedFeatureType && lightchainFeatureCatalog.some((feature) => feature.id === normalizedFeatureType)
    ? normalizedFeatureType
    : fallback;
};

// Kept as the shared reuse-route resolver for saved artifacts; the launcher
// intentionally does not inject saved artifacts into the production gallery.
void resolveArtifactFeatureId;

const isBetaFeature = (feature: LightchainFeature | undefined): feature is LightchainFeature => Boolean(feature && feature.betaIncluded !== false);

// The home mirrors Lightchain's complete recommended card inventory. Video is
// visibly discoverable here while provider execution remains fail-closed until
// the canonical production receipt/readback is available.
const isHomepageVisibleFeature = (_feature: LightchainFeature): boolean => true;

/** Heavy-owned artwork for the shared Lightchain-shaped launcher chrome. */
const launcherCategoryImages: Record<LightchainCategoryId, string> = {
  recommended: '/lightchain-assets/mirror/lightchain-qlxy-prod/AIAgentCover-76724916.webp',
  planning: '/lightchain-assets/mirror/lightchain-qlxy-prod/designProduction-e8834c25.webp',
  fitting: '/lightchain-assets/mirror/lightchain-qlxy-prod/VirtualFittingCover-c04b6319.webp',
  graphics: '/lightchain-assets/mirror/lightchain-qlxy-prod/designProduction-e8834c25.webp',
};

const launcherFeatureImages: Partial<Record<string, string>> = {
  'design-agent': '/lightchain-assets/mirror/lightchain-qlxy-prod/AIAgentCover-76724916.webp',
  'design-workspace': '/lightchain-assets/mirror/lightchain-qlxy-prod/designProduction-e8834c25.webp',
  'marketing-workspace': '/lightchain-assets/mirror/lightchain-qlxy-prod/GenerateMarketingCover-cb27f243.webp',
  'fashion-studio': '/lightchain-assets/mirror/lightchain-qlxy-prod/integrationCover-ffc3ea17.webp',
  'video-workstation': '/lightchain-assets/mirror/lightchain-qlxy-prod/GenerateShortVideoCover-1f4ae742.webp',
  'virtual-fitting': '/lightchain-assets/mirror/lightchain-qlxy-prod/VirtualFittingCover-c04b6319.webp',
  'image-repair': '/lightchain-assets/mirror/lightchain-qlxy-prod/FixDeformitiesCover-ffca3315.webp',
  'remove-background': '/lightchain-assets/mirror/lightchain-qlxy-prod/FixDeformitiesCover-ffca3315.webp',
  'wear-design-lab': '/lightchain-assets/mirror/lightchain-qlxy-prod/orientedDesignCover-ac28f2a8.webp',
  'model-library': '/lightchain-assets/mirror/lightchain-qlxy-prod/FittingModelLibraryCover-f8b1e86f.webp',
  'heavychain-lab': '/lightchain-assets/mirror/lightchain-qlxy-prod/laboratoryCover-f42878b4.webp',
  'inspiration-design': '/lightchain-assets/mirror/lightchain-qlxy-prod/aiDesignCover-ecc22aa6.webp',
  'fabric-simulation': '/lightchain-assets/mirror/lightchain-qlxy-prod/FabricBodyCover-e2a3f86b.webp',
  'lineart-to-real': '/lightchain-assets/mirror/lightchain-qlxy-prod/LineArtToRealCover-107ca36f.webp',
  'change-color': '/lightchain-assets/mirror/lightchain-qlxy-prod/OneClickChangeColorCover-a89f5f43.webp',
  'flat-vector': '/lightchain-assets/mirror/lightchain-qlxy-prod/LineArtVectorConvertCover-72bb99a0.webp',
  'custom-style': '/lightchain-assets/mirror/lightchain-qlxy-prod/fashionModelCover-17cf7a74.webp',
  'graphic-design': '/lightchain-assets/mirror/lightchain-qlxy-prod/GeneratePrintingCover-855aabe1.webp',
  'pattern-vector-pro': '/lightchain-assets/mirror/lightchain-qlxy-prod/SVGConvertCover-4b9559be.webp',
  'design-arrange': '/lightchain-assets/mirror/lightchain-qlxy-prod/OneClickModifyPrintingCover-c7f33e3f.webp',
  'print-design': '/lightchain-assets/mirror/lightchain-qlxy-prod/FlowerShapedDesignCover-b505779c.webp',
};

const canonicalRecommendedGalleryImages = [
  '/lightchain-assets/mirror/static-cn/d81b55aa18721b86c37b96a36223a936-715ef430.webp',
  '/lightchain-assets/mirror/static-cn/a25e632441de5b1198f4e20ae7040568-5310d227.webp',
  '/lightchain-assets/mirror/static-cn/3266745d3f905fc8c770cd0894438279-e1192cdc.webp',
  '/lightchain-assets/mirror/static-cn/6051a3df009110d3de23c3af3173e418-b4252d95.webp',
  '/lightchain-assets/mirror/static-cn/1b69b85c8eba09e87fbae86a8f98b3b5-277c40f0.webp',
  '/lightchain-assets/mirror/static-cn/8a0819ffd465485fca3826a8daa55e52-8c5a913f.webp',
  '/lightchain-assets/mirror/static-cn/3012bf485d2fcf846ea006975040b91d-0a1c9be0.webp',
  '/lightchain-assets/mirror/static-cn/19fa690cf8a20c07f5e289464d676f59-826a5905.webp',
  '/lightchain-assets/mirror/static-cn/5d67da9df9be3f548f1cc425a1f84280-f4765512.webp',
  '/lightchain-assets/mirror/static-cn/b8ec2a7a0c4568e30b842f7f6b116474-7cb0ba85.webp',
  '/lightchain-assets/mirror/static-cn/a15e92993792273cb5a65d4387f84692-63b7caf9.webp',
  '/lightchain-assets/mirror/static-cn/8e27567f4e2e95a129348ccbaabec8d7-479d0a17.webp',
  '/lightchain-assets/mirror/static-cn/dfec176704c22897d7d90cec933e117f-d3144a9d.webp',
  '/lightchain-assets/mirror/static-cn/886d82e0b698aae745d4ba2ead9b92c5-ef73b6e1.webp',
  '/lightchain-assets/mirror/static-cn/d2c7f4a20364316cbf0549b3a81e5cae-ad805d7d.webp',
  '/lightchain-assets/mirror/static-cn/1483b69c2c945b0ef7c366374430edc8-575aa39a.webp',
  '/lightchain-assets/mirror/static-cn/02e6be67a4d3e7a7cded82c1e82eccb4-133e48df.webp',
  '/lightchain-assets/mirror/static-cn/a38a76f61065a395382e94a9cd9b8bd4-a85d72e7.webp',
  '/lightchain-assets/mirror/static-cn/b9db6ef4425f19e9ed865fd88e6e6115-95dfd073.webp',
];

const buildGalleryExampleImage = (featureId: string) => {
  const feature = lightchainFeatureCatalog.find((candidate) => candidate.id === featureId);
  return feature
    ? (launcherFeatureImages[feature.id] ?? launcherCategoryImages[feature.category])
    : launcherCategoryImages.recommended;
};

const buildLauncherFeatureImage = (feature: LightchainFeature) => (
  launcherFeatureImages[feature.id] ?? launcherCategoryImages[feature.category]
).replace('w_256', 'w_384');

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
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState<LightchainCategoryId>('recommended');
  const [command, setCommand] = useState('');
  const [galleryTab, setGalleryTab] = useState<(typeof galleryTabs)[number]['id']>('recommended');
  const [gallerySearchOpen, setGallerySearchOpen] = useState(false);
  const [galleryQuery, setGalleryQuery] = useState('');
  const [gallerySearchTerm, setGallerySearchTerm] = useState('');
  const [selectedCase, setSelectedCase] = useState<GalleryCase | null>(null);
  const currentBrand = useAuthStore((state) => state.currentBrand);
  const user = useAuthStore((state) => state.user);
  const [savedArtifacts, setSavedArtifacts] = useState<WorkspaceArtifact[]>([]);
  const categoryParam = searchParams.get('category');
  // The Heavy deployment must keep Heavy route aliases even when the public
  // launcher is opened at `/`. Checking the host as well as the legacy path
  // prevents a Heavy-domain click from leaking back to `/lightchain/*` URLs.
  const isHeavyRoute = isHeavyWorkspaceRuntime()
    || location.pathname === '/heavy'
    || location.pathname.startsWith('/heavy/');
  const buildLauncherFeatureHref = (feature: LightchainFeature) => {
    const href = buildLightchainFeatureHref(feature);
    return isHeavyRoute ? href.replace(/^\/lightchain(?=\/|$)/, '/heavy') : href;
  };

  useEffect(() => {
    if (categoryParam && lightchainCategories.some((category) => category.id === categoryParam)) {
      setActiveCategory(categoryParam as LightchainCategoryId);
    }
  }, [categoryParam]);

  useEffect(() => {
    if (!currentBrand?.id) {
      setSavedArtifacts([]);
      return;
    }
    let cancelled = false;
    const hydrateSavedArtifacts = async () => {
      const artifacts = listWorkspaceArtifacts(currentBrand.id, user?.id);
      const signedReferences = artifacts.map((artifact) => ({
        storage_path: getWorkspaceArtifactCanonicalStoragePath(artifact.metadata) ?? artifact.imageUrl,
        image_url: artifact.imageUrl,
      }));
      const signed = await withSignedImageUrls(signedReferences).catch(() => signedReferences);
      if (cancelled) return;
      setSavedArtifacts(artifacts.map((artifact, index) => ({
        ...artifact,
        imageUrl: signed[index]?.image_url?.trim() || artifact.imageUrl,
      })));
    };
    void hydrateSavedArtifacts();
    return () => {
      cancelled = true;
    };
  }, [currentBrand?.id, user?.id]);

  const visibleFeatures = useMemo(
    () => getLightchainLauncherFeatures(activeCategory).filter(isHomepageVisibleFeature),
    [activeCategory],
  );
  const commandFeature = findFeatureFromPrompt(command);
  const commandHref = buildLauncherFeatureHref(commandFeature);
  const galleryItems = useMemo<GalleryCase[]>(() => {
    const templates = galleryCasesByTab[galleryTab];
    const exampleItems = templates.map((template, index) => ({
      ...template,
      id: `example-${template.id}`,
      imageUrl: galleryTab === 'recommended'
        ? (canonicalRecommendedGalleryImages[index] ?? buildGalleryExampleImage(template.featureId))
        : buildGalleryExampleImage(template.featureId),
    }));
    const persistedCandidates = galleryTab === 'recommended'
      ? savedArtifacts
      : savedArtifacts.filter((artifact) => {
        const featureId = resolveArtifactFeatureId(artifact, '');
        return templates.some((template) => template.featureId === featureId);
      });
    const persistedItems = persistedCandidates
      .filter((artifact) => artifact.imageUrl.trim())
      .map((artifact) => {
        const featureId = resolveArtifactFeatureId(artifact, templates[0]?.featureId ?? 'fashion-studio');
        const matchingTemplate = templates.find((template) => template.featureId === featureId);
        return {
          id: `saved-${artifact.id}`,
          artifactId: artifact.id,
          title: artifact.title || matchingTemplate?.title || '保存済み成果物',
          description: artifact.prompt?.trim() || matchingTemplate?.description || '保存済みのHeavy Chain成果物です。',
          step: '保存済み成果物 → 再利用',
          featureId,
          imageUrl: artifact.imageUrl,
        };
      });
    return [...exampleItems, ...persistedItems];
  }, [galleryTab, savedArtifacts]);

  const filteredGalleryItems = useMemo(() => {
    const normalizedQuery = gallerySearchTerm.trim().toLocaleLowerCase();
    if (!normalizedQuery) return galleryItems;
    return galleryItems.filter((item) => (
      `${item.title} ${item.description} ${item.step}`.toLocaleLowerCase().includes(normalizedQuery)
    ));
  }, [galleryItems, gallerySearchTerm]);

  const handleCategoryChange = (categoryId: LightchainCategoryId) => {
    setActiveCategory(categoryId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('category', categoryId);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <div className="min-h-[calc(100vh-50px)] bg-[#171b1c] text-white">
      <section className="relative px-4 pt-12 sm:px-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_55%_6%,rgba(24,78,83,0.12),transparent_40%)]" />
        <div className="relative mx-auto max-w-none">
          <div className="flex min-h-14 flex-wrap items-end gap-x-4 gap-y-1">
            <h1 className="sr-only">HEAVY CHAIN</h1>
            <svg aria-label="Heavy Chain AI" role="img" viewBox="0 0 318 35" fill="none" className="h-12 w-full max-w-[318px] shrink-0 text-white">
              <text x="0" y="28" fill="currentColor" fontFamily="Arial, Helvetica, sans-serif" fontSize="31" fontWeight="600" textLength="318" lengthAdjust="spacingAndGlyphs">HEAVY CHAIN AI</text>
            </svg>
            <p className="text-sm font-medium text-neutral-300 sm:text-base">アパレル特化のAIデザインワークスペース</p>
          </div>

          <form
            role="search"
            className="mt-4 flex h-10 w-full max-w-[506px] items-center gap-2 rounded-[24px] border border-cyan-300/75 bg-white/[0.035] px-4 shadow-[0_0_22px_rgba(56,189,248,0.12)] transition-all duration-300 focus-within:border-indigo-300"
            onSubmit={(event) => {
              event.preventDefault();
              navigate(`${commandHref}${commandHref.includes('?') ? '&' : '?'}prompt=${encodeURIComponent(command.trim())}`);
            }}
          >
            <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center text-sm text-cyan-200">✦</span>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent py-0 text-sm leading-5 text-white outline-none placeholder:text-neutral-500 focus-visible:ring-0"
              placeholder="指示を入力してください... 例：『モデルの着せ替え』"
            />
          </form>

          <div role="tablist" aria-label="Heavy Chainカテゴリ" className="mt-12 flex h-10 max-w-[645px] items-center justify-start gap-2 overflow-x-auto rounded-lg sm:justify-center border border-white/15 bg-white/[0.07] p-1">
            {lightchainCategories.map((category) => {
              const active = category.id === activeCategory;
              return (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-pressed={active}
                  data-state={active ? 'active' : 'inactive'}
                  onClick={() => handleCategoryChange(category.id)}
                  style={{ fontFamily: '-apple-system, "system-ui", "Segoe UI", "PingFang SC", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif' }}
                  className={`shrink-0 rounded-md px-6 py-2 transition group relative flex h-8 items-center justify-center whitespace-nowrap border-0 text-sm leading-[21px] ${
                    active ? 'bg-[#63cbc7] font-medium text-neutral-950 shadow-[0_0_20px_rgba(99,203,199,0.18)]' : 'font-normal text-neutral-400 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  {category.label}
                  {category.id === 'recommended' && <span className="pointer-events-none absolute -right-1.5 -top-1 hidden min-w-[21px] items-center justify-center rounded-lg bg-gradient-to-l from-[#FF00F6] to-[#FF2929] px-0.5 py-0 text-[10px] font-medium leading-3 text-white group-data-[state=active]:flex">Hot</span>}
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-testid="lightchain-tool-grid">
            {visibleFeatures.map((feature, index) => {
              const hiddenOnMobile = compactOnMobile && index > 5;
              const badge = getLightchainLauncherBadge(feature);
              return (
                <Link
                  key={feature.id}
                  to={buildLauncherFeatureHref(feature)}
                  data-testid="lightchain-tool-card"
                  className={`${hiddenOnMobile ? 'hidden md:flex' : ''} relative flex w-full cursor-pointer gap-4 overflow-hidden rounded-2xl border border-white/10 bg-[#262a2b] p-4 transition hover:border-cyan-300/50`}
                >
                  {badge && <span className={`absolute right-0 top-0 z-10 rounded-bl-xl px-3 py-1 text-[10px] font-medium leading-3 text-white ${badge === 'Beta' ? 'bg-gradient-to-r from-fuchsia-500 to-rose-500' : 'bg-[#687070]'}`}>{badge}</span>}
                  <div className="relative h-[88px] w-[132px] shrink-0 overflow-hidden rounded-[5px] bg-white/[0.06]">
                    <img src={buildLauncherFeatureImage(feature)} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </div>
                  <div className="flex min-h-[88px] min-w-0 flex-1 flex-col gap-1">
                    <div className="relative flex min-h-8 items-center overflow-hidden">
                      <img src="/lightchain-assets/mirror/jp/title_bg-58b86113.png" alt="" aria-hidden="true" className="pointer-events-none absolute top-1/2 left-0 max-h-11 w-[148px] -translate-y-1/2 object-contain object-left" />
                      <h3
                        style={{ fontFamily: '-apple-system, "system-ui", "Segoe UI", "PingFang SC", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif' }}
                        className="relative z-[1] min-w-0 line-clamp-2 text-[14px] font-medium leading-6 text-white"
                      >
                        {getLightchainLauncherTitle(feature)}
                      </h3>
                    </div>
                    <p
                      style={{ fontFamily: '-apple-system, "system-ui", "Segoe UI", "PingFang SC", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif' }}
                      className="line-clamp-3 text-[12px] leading-4 text-[#aab8b6]"
                    >
                      {getLightchainLauncherDescription(feature)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t-0 px-5 pb-8 pt-[58px] sm:px-8 lg:px-10">
        <div className="mx-auto max-w-none">
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white">事例共有</h2>
          <div className="mt-[23px] flex flex-wrap items-center gap-4">
            <div role="tablist" aria-label="事例共有カテゴリ" className="flex h-10 w-fit items-center justify-center gap-2 overflow-x-auto rounded-lg border border-white/10 bg-[#262a2b] p-1 text-neutral-400 xl:overflow-x-visible">
            {galleryTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={galleryTab === tab.id}
                onClick={() => setGalleryTab(tab.id)}
                data-state={galleryTab === tab.id ? 'active' : 'inactive'}
                style={{ fontFamily: '-apple-system, "system-ui", "Segoe UI", "PingFang SC", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif' }}
                className={`shrink-0 rounded-md px-6 py-2 transition group relative flex h-8 items-center justify-center whitespace-nowrap rounded-lg border-0 text-sm font-normal leading-[21px] ${galleryTab === tab.id ? 'rounded-md bg-[#63cbc7] font-medium text-neutral-950 shadow-sm' : 'text-neutral-400 hover:bg-white/[0.06] hover:text-white'}`}
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
                  {item.videoUrl ? (
                    <video src={item.videoUrl} muted loop playsInline preload="metadata" className="block h-auto w-full object-cover transition duration-500 group-hover:scale-[1.01]" />
                  ) : (
                    <img
                      src={item.imageUrl}
                      srcSet={item.imageUrl ? `${item.imageUrl.replace(/w_1200(?=,limit_1)/, 'w_640')} 1x, ${item.imageUrl} 2x` : undefined}
                      alt=""
                      loading="lazy"
                      className="block h-auto w-full object-cover transition duration-500 group-hover:scale-[1.01]"
                    />
                  )}
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
                <span className="text-xs font-semibold text-cyan-200">Heavy Chain 事例</span>
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
              to={buildLauncherFeatureHref(lightchainFeatureCatalog.find((feature) => feature.id === selectedCase.featureId) ?? lightchainFeatureCatalog[0])}
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
