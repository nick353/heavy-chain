export type LightchainCategoryId = 'recommended' | 'planning' | 'fitting' | 'graphics';

export interface LightchainFeature {
  id: string;
  title: string;
  lightchainName: string;
  description: string;
  route: string;
  category: LightchainCategoryId;
  status: 'production' | 'workspace' | 'local-proof';
  capability: string;
  evidence: string;
  tags: string[];
}

export interface LightchainCompatContext {
  lightchainFeatureId: string;
  lightchainFeatureTitle: string;
  lightchainTaskCodes: string[];
  lightchainTaskSteps: Array<{
    taskCode: string;
    status: 'processing';
  }>;
}

export interface LightchainCategory {
  id: LightchainCategoryId;
  label: string;
  eyebrow: string;
  description: string;
}

export const lightchainCategories: LightchainCategory[] = [
  {
    id: 'recommended',
    label: 'おすすめ',
    eyebrow: 'Hot',
    description: '社内でよく使う主要ワークスペースを、Heavy Chain の入口へ揃えます。',
  },
  {
    id: 'planning',
    label: '企画デザインツール',
    eyebrow: 'Plan',
    description: '企画、ディテール修正、色変更、線画化、ブランドスタイルを生成前の注文票として残します。',
  },
  {
    id: 'fitting',
    label: 'AIフィッティング',
    eyebrow: 'Fit',
    description: 'モデル、ポーズ、体型、背景、着用イメージを model-matrix と Canvas に接続します。',
  },
  {
    id: 'graphics',
    label: 'グラフィックツール',
    eyebrow: 'Graphic',
    description: '柄作成、総柄、ベクター化、プリント配置、服への反映をパターンワークスペースへ集約します。',
  },
];

export const lightchainFeatureCatalog: LightchainFeature[] = [
  {
    id: 'marketing-workspace',
    title: 'マーケティングワークスペース',
    lightchainName: 'marketingCustom / GenerateMarketing',
    description: '商品画像から EC、SNS、店舗、ライブ配信、プロモーション素材をまとめて作ります。',
    route: '/marketing',
    category: 'recommended',
    status: 'production',
    capability: '販促プロジェクト、進捗、失敗/再試行、Canvas handoff、Gallery/History 保存',
    evidence: 'marketing-workspace-artifact production readback',
    tags: ['EC', 'SNS', 'コピー', 'バナー'],
  },
  {
    id: 'virtual-fitting',
    title: 'AIフィッティング',
    lightchainName: 'VirtualFittingV2 / ChangeModel',
    description: '衣服画像、モデル条件、品質を選び、EC向けの着用画像を生成します。',
    route: '/fitting',
    category: 'recommended',
    status: 'production',
    capability: 'model-matrix 生成、Storage/DB readback、履歴、Canvas 編集',
    evidence: 'fitting durable persistence and production model-matrix readback',
    tags: ['着用画像', 'モデル', 'EC'],
  },
  {
    id: 'wear-design-lab',
    title: 'ウェアデザインラボ',
    lightchainName: 'ChangeDetail / ClothingOrientationDesign',
    description: '服のディテール、方向性、素材、採用候補を編集して生成条件へ渡します。',
    route: '/lab',
    category: 'recommended',
    status: 'local-proof',
    capability: '評価候補、採点、decision、生成前プロンプト、Gallery/History 再開',
    evidence: 'lab-evaluation-local-v1',
    tags: ['ディテール', '評価', '企画'],
  },
  {
    id: 'video-workstation',
    title: '動画ワークステーション',
    lightchainName: 'StoryboardImage / StoryboardVideo / GenerateShortVideo',
    description: '商品紹介や着せ替え動画の構成を storyboard として作り、生成へ渡します。',
    route: '/video',
    category: 'recommended',
    status: 'local-proof',
    capability: '尺、比率、ショット構成、CTA、storyboard preview、Canvas handoff',
    evidence: 'video-storyboard-local-v1',
    tags: ['動画', 'Storyboard', 'CTA'],
  },
  {
    id: 'model-library',
    title: 'モデル企画ライブラリ',
    lightchainName: 'FittingModelCustomize / ChangePosture / ChangeBackground',
    description: '顔、ポーズ、体型、肌色、年齢層を選び、モデル条件を生成に渡します。',
    route: '/models',
    category: 'recommended',
    status: 'production',
    capability: 'モデル候補選択、model-matrix query、生成条件 readback',
    evidence: 'model-library-local-v1 and production model-matrix readback',
    tags: ['顔', 'ポーズ', '体型', '肌色'],
  },
  {
    id: 'fashion-studio',
    title: 'ファッションスタジオ',
    lightchainName: 'OneClickIntegration / DirectionalIntegration',
    description: '服、モデル、背景、小物を組み合わせたスタジオ撮影注文票を作ります。',
    route: '/studio',
    category: 'recommended',
    status: 'workspace',
    capability: 'モデル/ポーズ/背景選択、SVG preview、Canvas/Gallery/History 再開',
    evidence: 'studio-selection-local-v1 and production workspace generation closeout',
    tags: ['撮影', '背景', '小物'],
  },
  {
    id: 'design-agent',
    title: 'デザインエージェント',
    lightchainName: 'ClothingDesignFlux / seriesDesign',
    description: 'トレンド、商品方向、シリーズ案を比較し、デザイン探索へ進めます。',
    route: '/workflows/design-exploration',
    category: 'recommended',
    status: 'workspace',
    capability: 'ワークフローボード、複数案、design-gacha prefill',
    evidence: 'workflow-board-local-20260622',
    tags: ['トレンド', '企画書', 'シリーズ'],
  },
  {
    id: 'heavychain-lab',
    title: 'Heavy Chain Lab',
    lightchainName: 'Lightchain Lab',
    description: '展示、店舗、素材、キャンペーン転用などの仮説を生成前に検証します。',
    route: '/lab',
    category: 'recommended',
    status: 'local-proof',
    capability: 'Material Lighting、Retail Readiness、Campaign Transfer',
    evidence: 'lab-evaluation-local-v1',
    tags: ['実験', '店舗', '検証'],
  },
  {
    id: 'inspiration-design',
    title: 'インスピレーションデザイン',
    lightchainName: 'ClothingDesignFlux / seriesDesign',
    description: '素材やテーマから、シリーズ化できる服飾デザイン案を作ります。',
    route: '/workflows/design-exploration',
    category: 'graphics',
    status: 'workspace',
    capability: '商品コンセプト、複数スタイル、Gallery/History 比較',
    evidence: 'workflow-query-prefill-local-20260621',
    tags: ['素材', 'テーマ', '複数案'],
  },
  {
    id: 'fabric-simulation',
    title: '生地プリントの試着シミュレーション',
    lightchainName: 'FabricBody / DesignatedFabric / PrintingTiling',
    description: '柄、生地、対象アイテムを構造化し、服への反映条件を残します。',
    route: '/lightchain/fabric-image',
    category: 'planning',
    status: 'workspace',
    capability: 'motif、repeat、garment、palette、referenceAssets',
    evidence: 'pattern-structured-context-local-v1',
    tags: ['生地', '総柄', '服反映'],
  },
  {
    id: 'lineart-to-real',
    title: '線画から実写へ変換',
    lightchainName: 'LineArtToReal / GenerateSketch',
    description: '線画や実物を生成前の source context として残し、画像生成に渡します。',
    route: '/generate?feature=design-gacha',
    category: 'planning',
    status: 'workspace',
    capability: 'design-gacha prompt と source provenance',
    evidence: 'generation-source-provenance-local-v1',
    tags: ['線画', '実写化', '下絵'],
  },
  {
    id: 'change-color',
    title: '色変更',
    lightchainName: 'ChangeColor / OneClickChangeColor',
    description: '商品の色替えやパレット変更を、生成条件と履歴に残します。',
    route: '/generate?feature=colorize',
    category: 'planning',
    status: 'production',
    capability: 'colorize Edge Function、生成履歴、Gallery 保存',
    evidence: 'production-parity-readback-20260622',
    tags: ['色替え', 'パレット', '差分'],
  },
  {
    id: 'flat-vector',
    title: '平絵をベクター化',
    lightchainName: 'LineArtVectorConvert / SVGConvert',
    description: '刺繍やプリントに使う線数、色数、ベクター方針を保存します。',
    route: '/patterns/workbench',
    category: 'planning',
    status: 'workspace',
    capability: 'Vector Path Caps preview、vectorNotes、Canvas handoff',
    evidence: 'pattern-preview-local-v1',
    tags: ['平絵', 'SVG', '刺繍'],
  },
  {
    id: 'custom-style',
    title: 'カスタムスタイル',
    lightchainName: 'CustomStyle',
    description: 'ブランドらしさ、ターゲット、トーンを生成条件へ反映します。',
    route: '/brand/settings',
    category: 'planning',
    status: 'production',
    capability: 'ブランド設定、生成時の brand context、チーム管理',
    evidence: 'production closeout baseline',
    tags: ['ブランド', 'トーン', 'ターゲット'],
  },
  {
    id: 'model-change-background',
    title: 'モデル背景変更',
    lightchainName: 'FittingModelChangeBackground',
    description: 'モデル候補と背景候補を選び、撮影シーンを合わせます。',
    route: '/studio',
    category: 'fitting',
    status: 'workspace',
    capability: 'Street 30s、3/4 Walk、Concrete Gallery などの選択同期',
    evidence: 'studio-selection-local-v1',
    tags: ['背景', 'モデル', '撮影'],
  },
  {
    id: 'model-body-shape',
    title: '体型・サイズ変更',
    lightchainName: 'FittingModelChangeBodyShape / BigSize',
    description: '体型、年齢層、肌色、髪型を model-matrix の正規化条件へ渡します。',
    route: '/models',
    category: 'fitting',
    status: 'production',
    capability: 'bodyTypes、ageGroups、skinTone、hairStyle readback',
    evidence: 'model-library-local-v1 and production readback',
    tags: ['体型', '年齢', 'サイズ'],
  },
  {
    id: 'flat-to-model',
    title: '平置き画像から着用画像',
    lightchainName: 'VirtualFittingConvertToFlat / GenerateFlatByModel',
    description: '平置き画像や商品説明を、モデル着用画像の生成に使います。',
    route: '/fitting',
    category: 'fitting',
    status: 'production',
    capability: '衣服画像アップロード、商品説明、結果プレビュー、履歴復帰',
    evidence: 'fitting-parity and durable persistence',
    tags: ['平置き', '着用', '商品画像'],
  },
  {
    id: 'graphic-design',
    title: 'AIグラフィックデザイン',
    lightchainName: 'GeneratePrinting / ModifyPrinting',
    description: '柄、ロゴ、モチーフを作り、商品や販促素材へ展開します。',
    route: '/patterns/workbench',
    category: 'graphics',
    status: 'workspace',
    capability: 'Emblem Lockup、Bandana Grid、Vector Path Caps preview',
    evidence: 'pattern-preview-local-v1',
    tags: ['柄', 'ロゴ', 'モチーフ'],
  },
  {
    id: 'pattern-vector-pro',
    title: 'パターンをベクター画像に変換',
    lightchainName: 'PatternToVector',
    description: '総柄を量産向けに整理し、線と配色の方針を残します。',
    route: '/patterns/workbench',
    category: 'graphics',
    status: 'workspace',
    capability: 'ベクター化方針、repeatSignature、SVG marker readback',
    evidence: 'pattern-structured-context-local-v1',
    tags: ['総柄', '量産', 'ベクター'],
  },
  {
    id: 'design-arrange',
    title: 'デザインアレンジ',
    lightchainName: 'OneClickModifyPrinting / ModifyPrinting',
    description: '既存柄の改変、配置、配色差分を生成条件に残します。',
    route: '/generate?feature=generate-variations',
    category: 'graphics',
    status: 'production',
    capability: 'generate-variations Edge Function、履歴/ギャラリー',
    evidence: 'production-parity-readback-20260622',
    tags: ['差分', '配置', '再生成'],
  },
  {
    id: 'print-design',
    title: 'プリントデザイン',
    lightchainName: 'AddPrinting_Position / AddPrinting_Full',
    description: '定位プリント、総柄、服への配置を一つのワークスペースで組みます。',
    route: '/patterns/workbench',
    category: 'graphics',
    status: 'workspace',
    capability: '対象アイテム、repeat、palette、Canvas 企画ボード',
    evidence: 'pattern-structured-context-local-v1',
    tags: ['プリント', '総柄', '服'],
  },
  {
    id: 'remove-background',
    title: '背景削除・切り抜き',
    lightchainName: 'CutOut / RemoveBackground',
    description: '商品画像の背景を削除し、白背景素材や編集用素材として使います。',
    route: '/generate?feature=remove-bg',
    category: 'graphics',
    status: 'production',
    capability: 'remove-background Edge Function、対象画像アップロード、Gallery 保存',
    evidence: 'production-parity-readback-20260622',
    tags: ['背景削除', '切り抜き', '白背景'],
  },
  {
    id: 'upscale-image',
    title: '高解像度アップスケール',
    lightchainName: 'Sr / SrV2 / VideoBenchSr',
    description: 'ぼやけた商品画像や生成画像を、掲載前に高解像度化します。',
    route: '/generate?feature=upscale',
    category: 'graphics',
    status: 'production',
    capability: 'upscale Edge Function、対象画像アップロード、結果保存',
    evidence: 'production-parity-readback-20260622',
    tags: ['高解像度', '復元', 'HD'],
  },
  {
    id: 'image-variations',
    title: '類似バリエーション生成',
    lightchainName: 'ExpandImage / ExpandImageV2 / GenerateVariations',
    description: '既存画像をもとに、構図や見せ方の近い候補を複数作ります。',
    route: '/generate?feature=generate-variations',
    category: 'graphics',
    status: 'production',
    capability: 'generate-variations Edge Function、履歴/ギャラリー readback',
    evidence: 'production-parity-readback-20260622',
    tags: ['拡張', 'バリエーション', '派生'],
  },
  {
    id: 'partial-fix',
    title: '部分修正・対話編集',
    lightchainName: 'FixPartial / EliminateV2 / DetailCompensation',
    description: '気になる箇所の修正指示や、細部補正の作業を Canvas とチャット編集へ渡します。',
    route: '/generate?feature=chat-edit',
    category: 'planning',
    status: 'workspace',
    capability: 'チャットベース編集入口、Canvas handoff、編集履歴の再利用',
    evidence: 'generate feature selector and Canvas workspace',
    tags: ['部分修正', '消去', '細部補正'],
  },
  {
    id: 'canvas-editing',
    title: 'Canvasで編集・管理',
    lightchainName: 'EditImagesLocally / LocalUpload / IntelligentCropping',
    description: '生成済み素材を並べ、比較、再利用、ローカルアップロード、編集導線をまとめます。',
    route: '/canvas/new',
    category: 'graphics',
    status: 'production',
    capability: 'Canvas project、Gallery/History handoff、local artifact readback',
    evidence: 'local-artifact-readback and production closeout baseline',
    tags: ['Canvas', '管理', 'ローカル素材'],
  },
  {
    id: 'case-series-design',
    title: 'AIファッションデザイン：シリーズ生成',
    lightchainName: 'seriesDesign',
    description: 'シリーズ商品案を複数作り、方向性を比較します。',
    route: '/workflows/design-exploration',
    category: 'planning',
    status: 'workspace',
    capability: 'デザイン探索ワークフロー、複数候補、生成へ進む',
    evidence: 'workflow-board-local-20260622',
    tags: ['シリーズ', '企画', '比較'],
  },
  {
    id: 'case-ec-fusion',
    title: 'EC向けモデル着用画像を一括生成',
    lightchainName: 'OneClickIntegration + VirtualFitting',
    description: '商品写真から EC 用の着用・白背景・販促画像を一気に作ります。',
    route: '/workflows/ec-product-set',
    category: 'fitting',
    status: 'production',
    capability: 'EC商品画像セット、Fitting、Canvas、Gallery',
    evidence: 'production workspace generation closeout',
    tags: ['EC', '一括生成', '着用'],
  },
  {
    id: 'case-sns-video',
    title: '商品画像からSNS動画構成へ',
    lightchainName: 'FashionStudio + Video Workstation',
    description: '商品画像、シーン、CTA を短尺プロモーション構成にします。',
    route: '/workflows/sns-campaign',
    category: 'recommended',
    status: 'workspace',
    capability: 'SNSキャンペーンセット、Video storyboard、Marketing handoff',
    evidence: 'video-storyboard-local-v1',
    tags: ['SNS', '動画', '販促'],
  },
];

export const lightchainFeaturesByCategory = lightchainCategories.map((category) => ({
  ...category,
  features: lightchainFeatureCatalog.filter((feature) => feature.category === category.id),
}));

export const getLightchainFeature = (featureId: string | null) => {
  if (!featureId) return null;
  return lightchainFeatureCatalog.find((feature) => feature.id === featureId) ?? null;
};

export const getLightchainTaskCodes = (feature: Pick<LightchainFeature, 'lightchainName'>) => {
  return feature.lightchainName
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const buildLightchainCompatContext = (feature: LightchainFeature): LightchainCompatContext => {
  const lightchainTaskCodes = getLightchainTaskCodes(feature);
  return {
    lightchainFeatureId: feature.id,
    lightchainFeatureTitle: feature.title,
    lightchainTaskCodes,
    lightchainTaskSteps: lightchainTaskCodes.map((taskCode) => ({
      taskCode,
      status: 'processing',
    })),
  };
};

export const buildLightchainFeatureHref = (feature: LightchainFeature) => {
  if (!feature.route.startsWith('/generate')) return feature.route;
  const [path, search = ''] = feature.route.split('?');
  const params = new URLSearchParams(search);
  params.set('lcFeature', feature.id);
  params.set('lcTitle', feature.title);
  params.set('lcTaskCodes', getLightchainTaskCodes(feature).join(','));
  return `${path}?${params.toString()}`;
};
