export type WorkflowId =
  | 'ec-product-set'
  | 'sns-campaign'
  | 'design-exploration'
  | 'global-expansion';

export type WorkflowPrimaryFeature =
  | 'product-shots'
  | 'campaign-image'
  | 'design-gacha'
  | 'multilingual-banner';

export type WorkflowIconKey = 'shopping-bag' | 'camera' | 'palette' | 'globe';

export interface WorkflowPrefill {
  prompt?: string;
  productDescription?: string;
  campaignTitle?: string;
  campaignSubheadline?: string;
  campaignCTA?: string;
  headline?: string;
  subheadline?: string;
}

export interface WorkflowArtifactCandidate {
  title: string;
  description: string;
}

export interface WorkflowCta {
  label: string;
  href: string;
  variant: 'primary' | 'secondary';
}

export interface WorkflowMetadata {
  id: WorkflowId;
  title: string;
  description: string;
  primaryFeature: WorkflowPrimaryFeature;
  progressLabel: string;
  progressPercent: number;
  steps: string[];
  artifactCandidates: WorkflowArtifactCandidate[];
  ctas: WorkflowCta[];
  prefill: WorkflowPrefill;
  ratio: string;
  languages: string[];
  shots: string[];
  scenes: string[];
  generateCount: number;
  estimatedTime: string;
  color: string;
  iconKey: WorkflowIconKey;
}

export const workflowMetadata: WorkflowMetadata[] = [
  {
    id: 'ec-product-set',
    title: 'EC商品画像セット',
    description: '商品ページに必要な標準カットを、商品説明からまとめて生成します。',
    primaryFeature: 'product-shots',
    progressLabel: '商品ページ用の標準カット設計中',
    progressPercent: 35,
    steps: ['商品説明を確認', '正面・側面・背面・ディテールを生成', 'EC掲載用に選定'],
    artifactCandidates: [
      { title: '白背景の商品カット', description: '正面、側面、背面、ディテールを商品ページ向けに揃えます。' },
      { title: '着用イメージ用の生成メモ', description: 'Fitting や Canvas で再利用する商品説明とショット条件を残します。' },
      { title: 'EC 掲載候補セット', description: 'Gallery/History で比較しやすい候補群として扱います。' },
    ],
    ctas: [
      { label: '生成へ進む', href: '/generate?workflow=ec-product-set', variant: 'primary' },
      { label: 'Fitting workspace', href: '/fitting', variant: 'secondary' },
      { label: 'Canvasで編集', href: '/canvas/new', variant: 'secondary' },
    ],
    prefill: {
      productDescription: '上質なヘビーウェイトTシャツ、ボックスシルエット、厚みのある生地、EC商品ページ用の白背景撮影',
    },
    ratio: '1:1',
    languages: ['ja'],
    shots: ['front', 'side', 'back', 'detail'],
    scenes: ['studio'],
    generateCount: 4,
    estimatedTime: '約5分',
    color: 'from-blue-500 to-cyan-500',
    iconKey: 'shopping-bag',
  },
  {
    id: 'sns-campaign',
    title: 'SNSキャンペーンセット',
    description: 'SNS告知に使うキャンペーン画像を、縦長比率とCTAつきで立ち上げます。',
    primaryFeature: 'campaign-image',
    progressLabel: '縦長キャンペーンの初期構成を準備中',
    progressPercent: 40,
    steps: ['訴求コンセプトを作成', 'タイトルとCTAを配置', 'SNS向け比率で生成'],
    artifactCandidates: [
      { title: 'SNS 告知ビジュアル', description: '4:5 のローンチ画像としてタイトル、補足文、CTA をまとめます。' },
      { title: 'キャンペーンコピー案', description: '投稿文や広告見出しに転用できる短い訴求軸を残します。' },
      { title: '動画化の素材メモ', description: 'Video workspace で短尺構成に展開しやすい構成を作ります。' },
    ],
    ctas: [
      { label: '生成へ進む', href: '/generate?workflow=sns-campaign', variant: 'primary' },
      { label: 'Marketing workspace', href: '/marketing', variant: 'secondary' },
      { label: 'Canvasで編集', href: '/canvas/new', variant: 'secondary' },
    ],
    prefill: {
      prompt: '新作アパレルのローンチ告知。都会的でクリーン、スマートフォンで目に留まるSNSキャンペーン画像',
      campaignTitle: 'NEW DROP',
      campaignSubheadline: 'Heavy essentials for everyday wear',
      campaignCTA: '今すぐ見る',
    },
    ratio: '4:5',
    languages: ['ja'],
    shots: [],
    scenes: ['street', 'studio'],
    generateCount: 3,
    estimatedTime: '約3分',
    color: 'from-purple-500 to-pink-500',
    iconKey: 'camera',
  },
  {
    id: 'design-exploration',
    title: 'デザイン探索',
    description: '新商品の方向性を複数案で比較し、企画初期の判断材料を作ります。',
    primaryFeature: 'design-gacha',
    progressLabel: '企画初期の方向性を比較準備中',
    progressPercent: 25,
    steps: ['商品コンセプトを入力', '複数スタイルを生成', '有望案を選定'],
    artifactCandidates: [
      { title: 'デザイン方向案', description: '素材感、ロゴ量、シルエット違いを複数案で比較します。' },
      { title: '総柄プリント案', description: 'Pattern workspace でリピート、配色、対象アイテムを詰められる候補にします。' },
      { title: 'ベクター化メモ', description: '刺繍、プリント、タグ展開に使う線数や色数の意図を残します。' },
    ],
    ctas: [
      { label: '生成へ進む', href: '/generate?workflow=design-exploration', variant: 'primary' },
      { label: 'Pattern workspace', href: '/patterns', variant: 'secondary' },
      { label: 'Canvasで編集', href: '/canvas/new', variant: 'secondary' },
    ],
    prefill: {
      prompt: '20代から30代向けのミニマルなストリートウェア。厚手素材、控えめなロゴ、日常使いしやすい新作デザイン案',
    },
    ratio: '1:1',
    languages: ['ja'],
    shots: [],
    scenes: ['studio', 'street'],
    generateCount: 6,
    estimatedTime: '約4分',
    color: 'from-amber-500 to-orange-500',
    iconKey: 'palette',
  },
  {
    id: 'global-expansion',
    title: 'グローバル展開セット',
    description: '越境EC向けの多言語バナーを、主要4言語のコピーで作成します。',
    primaryFeature: 'multilingual-banner',
    progressLabel: '多言語バナーの基準コピーを展開中',
    progressPercent: 45,
    steps: ['基準コピーを入力', '多言語を選択', 'ECバナーとして生成'],
    artifactCandidates: [
      { title: '多言語 EC バナー', description: '日本語、英語、中国語、韓国語のバナー候補を同じ基準で作ります。' },
      { title: '越境向けコピーセット', description: '商品価値を崩さず、地域ごとの掲載文へ広げます。' },
      { title: 'グローバル販促ボード', description: 'Studio や Canvas で見せ方を整えるための初期セットにします。' },
    ],
    ctas: [
      { label: '生成へ進む', href: '/generate?workflow=global-expansion', variant: 'primary' },
      { label: 'Studio workspace', href: '/studio', variant: 'secondary' },
      { label: 'Canvasで編集', href: '/canvas/new', variant: 'secondary' },
    ],
    prefill: {
      headline: 'NEW SEASON ESSENTIALS',
      subheadline: 'Premium heavy cotton basics for everyday style',
    },
    ratio: '16:9',
    languages: ['ja', 'en', 'zh', 'ko'],
    shots: [],
    scenes: ['studio'],
    generateCount: 4,
    estimatedTime: '約2分',
    color: 'from-green-500 to-teal-500',
    iconKey: 'globe',
  },
];

export const workflowMetadataById = workflowMetadata.reduce<Record<string, WorkflowMetadata>>((acc, workflow) => {
  acc[workflow.id] = workflow;
  return acc;
}, {});

export const getWorkflowMetadata = (workflowId: string | null) => {
  if (!workflowId) return null;
  return workflowMetadataById[workflowId] ?? null;
};
