import { buildGenerationIntentHref, workspaceSourceConfig } from './workspaceHandoff';

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
    description: 'よく使う入口をまとめます。',
  },
  {
    id: 'planning',
    label: '企画デザインツール',
    eyebrow: 'Plan',
    description: '企画、修正、色変更をまとめます。',
  },
  {
    id: 'fitting',
    label: 'AIフィッティング',
    eyebrow: 'Fit',
    description: 'モデル条件と着用画像をつなぎます。',
  },
  {
    id: 'graphics',
    label: 'グラフィックツール',
    eyebrow: 'Graphic',
    description: '生地、プリント、柄、配置、変換をまとめます。',
  },
];

const modelLibraryDirectGenerateRoute = buildGenerationIntentHref({
  feature: 'model-matrix',
  prompt: [
    'Face: 柔らかい卵型の顔、自然な微笑み、黒髪のショートボブ',
    'Pose: 正面立ち、肩線をまっすぐ見せる、両腕は自然に下ろす',
    'Body type: 標準体型 / 162cm / S-Mサイズの着用確認',
    'Skin tone: ウォームライト',
    'Age group: 20代',
    'Usage: EC標準',
    'Product description: シアージャケット、軽い透け感、ミニマルなEC商品画像',
  ].join('\n'),
  bodyTypes: ['regular'],
  ageGroups: ['20s'],
  skinTone: 'light',
  hairStyle: 'short',
  modelCandidateLabel: 'Clean EC 20s',
  sourceWorkspace: 'models',
  workflowVersion: 'model-library-local-v1',
  sourceLabel: workspaceSourceConfig.models.label,
  sourceResumePath: workspaceSourceConfig.models.resumePath,
  sourceMode: 'local-workflow-intake',
});

export const lightchainFeatureCatalog: LightchainFeature[] = [
  {
    id: 'marketing-workspace',
    title: 'マーケティングワークスペース',
    lightchainName: 'marketingCustom / GenerateMarketing',
    description: '商品画像から販促素材まで作ります。',
    route: '/marketing',
    category: 'recommended',
    status: 'production',
    capability: '販促プロジェクト、進捗、再試行、保存',
    evidence: 'marketing-workspace-artifact production readback',
    tags: ['EC', 'SNS', 'コピー', 'バナー'],
  },
  {
    id: 'virtual-fitting',
    title: 'AIフィッティング',
    lightchainName: 'VirtualFittingV2 / ChangeModel',
    description: '衣服画像と条件から着用画像を作ります。',
    route: '/fitting',
    category: 'recommended',
    status: 'production',
    capability: 'model-matrix 生成、保存、Canvas 編集',
    evidence: 'fitting durable persistence and production model-matrix readback',
    tags: ['着用画像', 'モデル', 'EC'],
  },
  {
    id: 'wear-design-lab',
    title: 'ウェアデザインラボ',
    lightchainName: 'ChangeDetail / ClothingOrientationDesign',
    description: '服の方向性を編集して渡します。',
    route: '/lab',
    category: 'recommended',
    status: 'local-proof',
    capability: '評価候補、採点、生成前条件、再開',
    evidence: 'lab-evaluation-local-v1',
    tags: ['ディテール', '評価', '企画'],
  },
  {
    id: 'video-workstation',
    title: '動画ワークステーション',
    lightchainName: 'StoryboardImage / StoryboardVideo / GenerateShortVideo',
    description: '動画構成を storyboard にまとめます。',
    route: '/video',
    category: 'recommended',
    status: 'local-proof',
    capability: '尺、比率、ショット構成、CTA、保存',
    evidence: 'video-storyboard-local-v1',
    tags: ['動画', 'Storyboard', 'CTA'],
  },
  {
    id: 'model-library',
    title: 'モデル企画ライブラリ',
    lightchainName: 'FittingModelCustomize / ChangePosture / ChangeBackground',
    description: 'モデル条件をまとめて生成へ渡します。',
    route: modelLibraryDirectGenerateRoute,
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
    description: '服、モデル、背景、小物をまとめます。',
    route: '/studio',
    category: 'recommended',
    status: 'workspace',
    capability: 'モデル/ポーズ/背景選択、保存、再開',
    evidence: 'studio-selection-local-v1 and production workspace generation closeout',
    tags: ['撮影', '背景', '小物'],
  },
  {
    id: 'design-agent',
    title: 'デザインエージェント',
    lightchainName: 'ClothingDesignFlux / seriesDesign',
    description: 'トレンドとシリーズ案を比べます。',
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
    lightchainName: 'Heavy Chain Lab',
    description: '仮説を生成前に検証します。',
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
    description: '素材やテーマから案を作ります。',
    route: '/workflows/design-exploration',
    category: 'graphics',
    status: 'workspace',
    capability: '商品コンセプト、複数スタイル、比較',
    evidence: 'workflow-query-prefill-local-20260621',
    tags: ['素材', 'テーマ', '複数案'],
  },
  {
    id: 'fabric-simulation',
    title: '生地プリントの試着シミュレーション',
    lightchainName: 'FabricBody / DesignatedFabric / PrintingTiling',
    description: '柄と生地の条件を残します。',
    route: '/lightchain/fabric-image',
    category: 'graphics',
    status: 'workspace',
    capability: 'motif、repeat、garment、palette',
    evidence: 'pattern-structured-context-local-v1',
    tags: ['生地', '総柄', '服反映'],
  },
  {
    id: 'printing-image',
    title: 'プリントイメージ',
    lightchainName: 'PrintingImage / PrintPlacement / PrintingTiling',
    description: '服画像にプリントを配置し、スポット/全面の仕上がりを確認します。',
    route: '/lightchain/printing-image',
    category: 'graphics',
    status: 'workspace',
    capability: '服画像、プリント画像、配置範囲、出力解像度',
    evidence: 'printing-image-iab-r43 and local parity catalog',
    tags: ['プリント', '配置', '印刷プレビュー'],
  },
  {
    id: 'lineart-to-real',
    title: '線画から実写へ変換',
    lightchainName: 'LineArtToReal / GenerateSketch',
    description: '線画を実写化の条件にします。',
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
    description: '商品の色替えを残します。',
    route: '/generate?feature=colorize',
    category: 'planning',
    status: 'production',
    capability: 'colorize Edge Function、保存',
    evidence: 'production-parity-readback-20260622',
    tags: ['色替え', 'パレット', '差分'],
  },
  {
    id: 'flat-vector',
    title: '平絵をベクター化',
    lightchainName: 'LineArtVectorConvert / SVGConvert',
    description: '刺繍やプリント向けに整えます。',
    route: '/patterns/workbench',
    category: 'planning',
    status: 'workspace',
    capability: 'Vector Path Caps preview、保存',
    evidence: 'pattern-preview-local-v1',
    tags: ['平絵', 'SVG', '刺繍'],
  },
  {
    id: 'custom-style',
    title: 'カスタムスタイル',
    lightchainName: 'CustomStyle',
    description: 'ブランドのトーンを反映します。',
    route: '/brand/settings',
    category: 'planning',
    status: 'production',
    capability: 'ブランド設定、brand context、チーム管理',
    evidence: 'production closeout baseline',
    tags: ['ブランド', 'トーン', 'ターゲット'],
  },
  {
    id: 'model-change-background',
    title: 'モデル背景変更',
    lightchainName: 'FittingModelChangeBackground',
    description: 'モデルと背景を合わせます。',
    route: '/studio',
    category: 'fitting',
    status: 'workspace',
    capability: 'Street 30s、3/4 Walk、背景選択',
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
    capability: 'bodyTypes、ageGroups、skinTone、hairStyle',
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
    capability: '衣服画像アップロード、商品説明、結果プレビュー',
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
    capability: 'Emblem Lockup、Bandana Grid、保存',
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
    capability: 'ベクター化方針、repeatSignature、保存',
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
    capability: 'generate-variations Edge Function、保存',
    evidence: 'production-parity-readback-20260622',
    tags: ['差分', '配置', '再生成'],
  },
  {
    id: 'print-design',
    title: '柄・グラフィック',
    lightchainName: 'AddPrinting_Position / AddPrinting_Full',
    description: '新規ファイル、最近の案件、事例から入って、定位プリントや総柄に進みます。',
    route: '/patterns/workbench',
    category: 'graphics',
    status: 'workspace',
    capability: '新規ファイル、最近の案件、事例、保存',
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
    capability: 'remove-background Edge Function、対象画像アップロード、保存',
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
    capability: 'upscale Edge Function、対象画像アップロード、保存',
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
    capability: 'generate-variations Edge Function、保存',
    evidence: 'production-parity-readback-20260622',
    tags: ['拡張', 'バリエーション', '派生'],
  },
  {
    id: 'partial-fix',
    title: '対話編集',
    lightchainName: 'FixPartial / EliminateV2 / DetailCompensation',
    description: '気になる箇所の修正を、Canvas とチャット編集へ渡します。',
    route: '/generate?feature=chat-edit',
    category: 'planning',
    status: 'workspace',
    capability: 'チャット編集入口、保存、再利用',
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
    capability: 'Canvas project、保存、readback',
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
    capability: 'EC商品画像セット、Fitting、保存',
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
    capability: 'SNSキャンペーンセット、Video storyboard、保存',
    evidence: 'video-storyboard-local-v1',
    tags: ['SNS', '動画', '販促'],
  },
];

export type LightchainParityPriority = 'P0' | 'P1' | 'P2';
export type LightchainParityGoalStatus = 'queued' | 'in_progress' | 'done';

export interface LightchainParityGoal {
  matrixId: string;
  title: string;
  lightBehavior: string;
  heavyCurrentBehavior: string;
  heavyTarget: string;
  priority: LightchainParityPriority;
  rationale: string;
  owningSurface: string;
  acceptanceEvidence: string;
  status: LightchainParityGoalStatus;
}

export const lightchainParityGoals: LightchainParityGoal[] = [
  {
    matrixId: 'M01',
    title: 'AIフィッティング',
    lightBehavior: 'virtual shooting assistant',
    heavyCurrentBehavior: 'garment image + product description can reach model-matrix, but the entry is still heavier than the Light path',
    heavyTarget: 'simplify the Heavy entry while keeping the practical pre-generation flow',
    priority: 'P0',
    rationale: 'removes core onboarding ambiguity and keeps the first generation path moving',
    owningSurface: 'GeneratePage / MaterialWorkbench / /fitting',
    acceptanceEvidence: 'local QA shows garment image or product description reaches a clear ready, generating, success, failure, retry state',
    status: 'in_progress',
  },
  {
    matrixId: 'M02',
    title: 'グラフィックツール',
    lightBehavior: 'same-name catalog of graphics tools',
    heavyCurrentBehavior: 'Heavy workbench wording is broader than the Light feature catalog split',
    heavyTarget: 'clarify the save flow and keep catalog vs workbench intent obvious',
    priority: 'P1',
    rationale: 'useful parity, but not required for first generation',
    owningSurface: 'GeneratePage / Heavy Chain parity catalog',
    acceptanceEvidence: 'feature entry text makes the save flow and catalog split obvious without hiding advanced actions',
    status: 'queued',
  },
  {
    matrixId: 'M03',
    title: 'ファッションスタジオ',
    lightBehavior: 'same-name studio entry',
    heavyCurrentBehavior: 'Heavy still starts from model, pose, background, and props all at once',
    heavyTarget: 'make the staged/default path lighter without losing the studio workflow',
    priority: 'P1',
    rationale: 'helpful parity, but not required for first generation',
    owningSurface: 'GeneratePage / /studio',
    acceptanceEvidence: 'initial studio copy and controls read as staged instead of all-at-once',
    status: 'queued',
  },
  {
    matrixId: 'M04',
    title: 'モデル企画ライブラリ',
    lightBehavior: 'same-name model planning library',
    heavyCurrentBehavior: 'Heavy equivalent lives under /generate?feature=model-matrix and the route naming is still indirect',
    heavyTarget: 'make routing and naming direct',
    priority: 'P0',
    rationale: 'core generation continuity depends on a direct route into model planning',
    owningSurface: 'GeneratePage / lightchainParityCatalog',
    acceptanceEvidence: 'the model planning entry resolves directly to the intended generate route and reads clearly in the UI',
    status: 'in_progress',
  },
  {
    matrixId: 'M05',
    title: '動画ワークステーション',
    lightBehavior: 'same-name video workstation',
    heavyCurrentBehavior: 'Heavy storyboard and generation conditions are mixed into a heavier entry',
    heavyTarget: 'simplify the entry while keeping storyboard conditions visible',
    priority: 'P1',
    rationale: 'useful parity, but not required for first generation',
    owningSurface: 'GeneratePage / /video',
    acceptanceEvidence: 'video entry shows storyboard conditions without forcing extra steps first',
    status: 'queued',
  },
  {
    matrixId: 'M06',
    title: 'ウェアデザインラボ',
    lightBehavior: 'same-name wear design lab',
    heavyCurrentBehavior: 'Heavy Chain Lab copy still reads like a separate experiment space',
    heavyTarget: 'align naming and meaning without losing the experimental nature',
    priority: 'P1',
    rationale: 'helps comprehension, but does not block first generation',
    owningSurface: 'GeneratePage / /lab',
    acceptanceEvidence: 'lab copy explains the experimental nature and the Heavy name without extra decoding',
    status: 'queued',
  },
  {
    matrixId: 'M07',
    title: 'デザインエージェント',
    lightBehavior: 'same-name design agent',
    heavyCurrentBehavior: 'Heavy AI fashion series generation still reads more like a generic workflow',
    heavyTarget: 'clarify comparison and series purpose',
    priority: 'P1',
    rationale: 'useful parity, but not required for first generation',
    owningSurface: 'GeneratePage / design exploration workflow',
    acceptanceEvidence: 'series/comparison intent is explicit before any generation starts',
    status: 'queued',
  },
  {
    matrixId: 'M08',
    title: '生地プリント試着シミュレーション',
    lightBehavior: 'simulation-first fabric print try-on',
    heavyCurrentBehavior: 'Heavy starts from a print design / pattern graphics workbench',
    heavyTarget: 'align onboarding so the simulation goal is understandable immediately',
    priority: 'P1',
    rationale: 'helps the feature explain itself, but not required for first generation',
    owningSurface: 'GeneratePage / /patterns/workbench',
    acceptanceEvidence: 'the first screen makes the simulation goal clear before the workbench details',
    status: 'queued',
  },
  {
    matrixId: 'M09',
    title: '線画から実写',
    lightBehavior: 'equivalent line-art to real conversion',
    heavyCurrentBehavior: 'Heavy already has explicit source context, but the guidance can still be simpler',
    heavyTarget: 'simplify the source guidance while keeping provenance',
    priority: 'P1',
    rationale: 'useful parity, but not required for first generation',
    owningSurface: 'GeneratePage / source-readback generation',
    acceptanceEvidence: 'source context is understandable without extra route jargon',
    status: 'queued',
  },
  {
    matrixId: 'M10',
    title: '色変更',
    lightBehavior: 'equivalent color change flow',
    heavyCurrentBehavior: 'Heavy tracks conditions and history, which can make the first change feel heavier than needed',
    heavyTarget: 'simplify the interaction while keeping traceability',
    priority: 'P0',
    rationale: 'keeps generation continuity visible and prevents state ambiguity',
    owningSurface: 'GeneratePage / colorize flow',
    acceptanceEvidence: 'color-change entry shows a direct action plus durable history/readback',
    status: 'in_progress',
  },
  {
    matrixId: 'M11',
    title: '平絵/パターンのベクター化',
    lightBehavior: 'vectorize',
    heavyCurrentBehavior: 'Heavy adds embroidery and print submission context on top of vectorization',
    heavyTarget: 'simplify the core path while retaining production details',
    priority: 'P1',
    rationale: 'production detail is valuable, but not required for first generation',
    owningSurface: 'GeneratePage / /patterns/workbench',
    acceptanceEvidence: 'vectorize path is obvious before the production-specific extras appear',
    status: 'queued',
  },
  {
    matrixId: 'M12',
    title: 'カスタムスタイル',
    lightBehavior: 'equivalent custom style entry',
    heavyCurrentBehavior: 'Heavy brand settings already exist, but the connection is not always obvious',
    heavyTarget: 'make the brand connection understandable immediately',
    priority: 'P1',
    rationale: 'useful parity, but not required for first generation',
    owningSurface: 'GeneratePage / /brand/settings',
    acceptanceEvidence: 'brand settings explain how style settings flow into generation',
    status: 'queued',
  },
  {
    matrixId: 'M13',
    title: '対話編集',
    lightBehavior: 'design arrangement and partial correction',
    heavyCurrentBehavior: 'Heavy Canvas/chat editing exists, but the edit target and action can stay implicit',
    heavyTarget: 'make the edit target and action clear before editing begins',
    priority: 'P0',
    rationale: 'prevents invalid or duplicate edits and protects generation continuity',
    owningSurface: 'GeneratePage / Canvas chat edit',
    acceptanceEvidence: 'the edit flow states the target and action before any edit is submitted',
    status: 'in_progress',
  },
];

export const lightchainParityGoalIds = lightchainParityGoals.map((goal) => goal.matrixId);

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
