import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Wand2, 
  Image as ImageIcon, 
  ChevronDown,
  Loader2,
  Download,
  Heart,
  RefreshCw,
  ArrowLeft,
  Sparkles,
  History,
  FolderOpen,
  ExternalLink,
  Plus,
  Minus,
  Sliders,
  AlertCircle,
  CheckCircle2,
  CreditCard,
  KeyRound
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { Button, Textarea, Input } from '../components/ui';
import { FEATURES, type Feature } from '../components/FeatureSelector';
import { PromptHistory, usePromptHistory } from '../components/PromptHistory';
import { ImageSelector, type SelectedImage, type ReferenceType } from '../components/ImageSelector';
import { UsageStats } from '../components/UsageStats';
import { GenerateLightchainEntry } from '../components/GenerateLightchainEntry';
import { MaterialWorkbench } from '../components/workspace/MaterialWorkbench';
import { getErrorMessage } from '../lib/errorMessages';
import { saveWorkspaceArtifact, saveWorkspaceArtifactBestEffort } from '../lib/localWorkspaceArtifacts';
import { parseLocalRunwayMcpImportBundle } from '../lib/localRunwayMcpImport';
import {
  buildMaterialReferenceMetadata,
  type MaterialReferenceState,
} from '../lib/workspaceMaterialReferences';
import {
  enqueueLocalRunwayWorkerGeneration,
  pollLocalRunwayWorkerGeneration,
} from '../lib/localRunwayWorkerQueue';
import {
  hydrateGenerationIntentSource,
  hydratePatternGenerationContext,
  type GenerationIntent,
  type PatternGenerationContext,
} from '../lib/workspaceHandoff';
import { buildProductionImagePrompt, mergeProductionNegativePrompt } from '../lib/productPromptQuality';
import { getWorkflowMetadata, type WorkflowMetadata } from '../lib/workflowMetadata';
import { getLightchainFeature, getLightchainTaskCodes } from '../lib/lightchainParityCatalog';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

const stylePresets = [
  { id: 'minimal', name: 'ミニマル', prompt: 'minimalist, clean, simple', description: '余白多め・無彩色中心のシンプル' },
  { id: 'luxury', name: 'ラグジュアリー', prompt: 'luxury, premium, elegant', description: '高級感・ゴールド/ブラック基調' },
  { id: 'street', name: 'ストリート', prompt: 'street fashion, urban, casual', description: 'ポップな配色・都会的・カジュアル' },
  { id: 'vintage', name: 'ヴィンテージ', prompt: 'vintage, retro, classic', description: 'フィルム調・レトロトーン' },
  { id: 'modern', name: 'モダン', prompt: 'modern, contemporary, sleek', description: 'シャープで現代的・クリーン' },
  { id: 'natural', name: 'ナチュラル', prompt: 'natural, organic, soft', description: '柔らかい質感・自然光・オーガニック' }
];

const aspectRatios = [
  { id: '1:1', name: '正方形', width: 1024, height: 1024, usage: 'Instagram投稿・汎用' },
  { id: '4:3', name: '横長', width: 1024, height: 768, usage: 'Webバナー・LP' },
  { id: '4:5', name: 'ポートレート', width: 819, height: 1024, usage: 'Instagram縦投稿・EC特集' },
  { id: '3:4', name: '縦長', width: 768, height: 1024, usage: 'Pinterest/フライヤー' },
  { id: '16:9', name: 'ワイド', width: 1024, height: 576, usage: 'YouTubeサムネ/ヒーロー' },
  { id: '9:16', name: 'ストーリー', width: 576, height: 1024, usage: 'IG/LINEストーリー・縦動画' }
];

const backgroundOptions = [
  { id: 'white', name: '白背景', prompt: 'white background, studio lighting' },
  { id: 'transparent', name: '透明', prompt: 'transparent background' },
  { id: 'studio', name: 'スタジオ', prompt: 'professional studio background, soft lighting' },
  { id: 'outdoor', name: '屋外', prompt: 'outdoor natural background, daylight' },
  { id: 'urban', name: '都市', prompt: 'urban city background, street scene' },
  { id: 'nature', name: '自然', prompt: 'nature background, forest or garden' },
  { id: 'custom', name: 'カスタム', prompt: '' },
  { id: 'reference', name: '参考画像から', prompt: '' },
];

const colorOptions = [
  { id: 'red', name: '赤', color: '#ef4444' },
  { id: 'blue', name: '青', color: '#3b82f6' },
  { id: 'green', name: '緑', color: '#22c55e' },
  { id: 'yellow', name: '黄', color: '#eab308' },
  { id: 'purple', name: '紫', color: '#a855f7' },
  { id: 'pink', name: 'ピンク', color: '#ec4899' },
  { id: 'orange', name: 'オレンジ', color: '#f97316' },
  { id: 'black', name: '黒', color: '#171717' },
  { id: 'white', name: '白', color: '#f5f5f5' },
  { id: 'beige', name: 'ベージュ', color: '#d4b896' },
  { id: 'navy', name: 'ネイビー', color: '#1e3a5f' },
  { id: 'gray', name: 'グレー', color: '#6b7280' },
];

const patternOptions = [
  { id: 'solid', name: '無地', icon: '◼' },
  { id: 'stripe', name: 'ストライプ', icon: '▤' },
  { id: 'check', name: 'チェック', icon: '▦' },
  { id: 'dot', name: 'ドット', icon: '⚬' },
  { id: 'floral', name: '花柄', icon: '✿' },
  { id: 'geometric', name: '幾何学', icon: '◆' },
  { id: 'camo', name: '迷彩', icon: '🌿' },
  { id: 'animal', name: 'アニマル', icon: '🐆' },
  { id: 'custom', name: 'カスタム', icon: '📷' },
];

const sceneOptions = [
  { id: 'cafe', name: 'カフェ', prompt: 'in a cozy cafe, warm lighting' },
  { id: 'street', name: 'ストリート', prompt: 'on urban street, city background' },
  { id: 'office', name: 'オフィス', prompt: 'in modern office, professional setting' },
  { id: 'outdoor', name: 'アウトドア', prompt: 'outdoor nature, park or garden' },
  { id: 'beach', name: 'ビーチ', prompt: 'beach seaside, summer vibe' },
  { id: 'studio', name: 'スタジオ', prompt: 'professional studio, clean background' },
];

type AssistantPlanItem = {
  title: string;
  description: string;
};

type AssistantPlanningFeatureId =
  | 'campaign-image'
  | 'product-shots'
  | 'model-matrix'
  | 'design-gacha'
  | 'scene-coordinate'
  | 'multilingual-banner'
  | 'remove-bg'
  | 'colorize'
  | 'upscale'
  | 'variations';

const defaultAssistantPlans = {
  'campaign-image': [
    {
      title: '商品ヒーロー',
      description: '商品全体と柄が分かる正方形のEC/SNS向けビジュアル。',
    },
    {
      title: '着用・利用シーン',
      description: 'ブランドの雰囲気、サイズ感、世界観が伝わる縦構図。',
    },
    {
      title: 'ディテール',
      description: '素材、プリント、質感に寄ったクローズアップ案。',
    },
  ],
  'product-shots': [
    {
      title: '商品全体',
      description: '正面・背面・側面の基本カットでECに必要な情報を揃えます。',
    },
    {
      title: '素材と仕様',
      description: '生地、縫製、柄、パーツの質感を寄りで見せます。',
    },
    {
      title: '販売導線',
      description: '商品ページ、SNS、カタログで使える構図へ展開します。',
    },
  ],
  'model-matrix': [
    {
      title: '着用モデル軸',
      description: '年齢層、体型、肌色、雰囲気を分けて比較できる着用案にします。',
    },
    {
      title: 'シルエット確認',
      description: '正面・斜め・全身でサイズ感と落ち感を確認できる構図にします。',
    },
    {
      title: 'ブランド世界観',
      description: '背景やポージングでブランドのムードを補強します。',
    },
  ],
  'design-gacha': [
    {
      title: '固定要素',
      description: 'ブランド、商品形状、守るべき構図を先に固定します。',
    },
    {
      title: '変化要素',
      description: '配色、柄、質感、背景など試す要素を分けます。',
    },
    {
      title: '比較候補',
      description: '複数案を同じ基準で比較できるデザインセットにします。',
    },
  ],
  'scene-coordinate': [
    {
      title: '商品切り抜き',
      description: '商品を主役として扱い、背景合成前の前景条件を整えます。',
    },
    {
      title: '利用シーン',
      description: 'カフェ、街、オフィスなど使う場所ごとの見え方を確認します。',
    },
    {
      title: '販促展開',
      description: 'EC、SNS、LPで使いやすい比率と余白を残します。',
    },
  ],
  'multilingual-banner': [
    {
      title: 'テキスト余白',
      description: '言語ごとに文字量が変わっても崩れにくい余白を確保します。',
    },
    {
      title: '商品とコピー',
      description: '商品、見出し、CTAの優先順位を明確にします。',
    },
    {
      title: '言語バリエーション',
      description: '日本語、英語、韓国語、中国語などへ展開しやすい構造にします。',
    },
  ],
  'remove-bg': [
    {
      title: '対象認識',
      description: '背景から切り抜く商品・人物・素材の境界を確認します。',
    },
    {
      title: 'エッジ確認',
      description: '髪、袖、影、透明部分など破綻しやすい箇所を重点確認します。',
    },
    {
      title: '再利用',
      description: 'Canvas、EC、SNSで使える透過素材として整理します。',
    },
  ],
  colorize: [
    {
      title: '変更対象',
      description: '色や柄を変える領域と残す領域を分けます。',
    },
    {
      title: 'バリエーション',
      description: '販売しやすい色展開やトーン差を複数案にします。',
    },
    {
      title: '質感維持',
      description: '生地感、影、立体感を壊さず色替えします。',
    },
  ],
  upscale: [
    {
      title: '解像度改善',
      description: '商品ディテールと輪郭を保ちながら高解像度化します。',
    },
    {
      title: 'ノイズ調整',
      description: '生地や柄がつぶれない範囲でノイズとシャープネスを調整します。',
    },
    {
      title: '出力確認',
      description: 'EC拡大表示や印刷用に耐える見え方を確認します。',
    },
  ],
  variations: [
    {
      title: '元画像の保持',
      description: '構図や主役は維持しながら変化させる範囲を決めます。',
    },
    {
      title: '差分設計',
      description: '背景、色、質感、ムードなど比較しやすい差分を作ります。',
    },
    {
      title: '採用候補',
      description: 'EC/SNSで使う候補を選びやすいバリエーションにします。',
    },
  ],
} satisfies Record<AssistantPlanningFeatureId, AssistantPlanItem[]>;

const getDefaultAssistantPlan = (featureId: string | undefined): AssistantPlanItem[] => (
  supportsAssistantPlanning(featureId) ? defaultAssistantPlans[featureId] : defaultAssistantPlans['campaign-image']
);

const buildAssistantPlan = (featureId: string | undefined, request: string) => {
  const trimmed = request.trim();
  const subject = trimmed
    .replace(/[。.!?！？].*$/, '')
    .replace(/を.*/, '')
    .slice(0, 36) || '商品';
  const hasSns = /sns|instagram|x（旧twitter）|twitter|投稿|ストーリー/i.test(trimmed);
  const hasEc = /ec|商品ページ|販売|ショップ|store/i.test(trimmed);
  const hasLogoTextOff = /(文字|ロゴ).*(なし|無し|入れない|入れず|不要)|なし|無し|無地|no text|no logo/i.test(trimmed);
  const channel = hasEc && hasSns ? 'ECとSNS' : hasSns ? 'SNS' : hasEc ? 'EC' : '販促';
  const copyRule = hasLogoTextOff ? '文字・ロゴなしで' : 'コピー余白を残して';

  if (featureId === 'campaign-image') {
    return [
      {
        title: `${subject}の主役カット`,
        description: `${channel}で最初に見せる1:1構図。${copyRule}、商品全体と柄を明確に見せます。`,
      },
      {
        title: `${subject}の世界観カット`,
        description: '着用感または利用シーンが伝わる縦構図。ブランドの雰囲気と用途を補強します。',
      },
      {
        title: `${subject}の質感ディテール`,
        description: '素材、プリント、縫製、柄の見え方を寄りで見せ、購入前の不安を減らします。',
      },
    ];
  }

  const defaults = getDefaultAssistantPlan(featureId);

  return defaults.map((item, index) => ({
    ...item,
    title: index === 0 ? `${subject} / ${item.title}` : item.title,
  }));
};

const supportsAssistantPlanning = (featureId: string | undefined): featureId is AssistantPlanningFeatureId => (
  Boolean(featureId && featureId in defaultAssistantPlans)
);

type RunwayMcpConnectionStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

interface RunwayMcpConnectionApproval {
  status: RunwayMcpConnectionStatus;
  updated_at: string;
}

interface BrandRunwaySubscription {
  status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  plan: {
    code: string | null;
    name: string | null;
    is_active: boolean | null;
    runway_mcp_generation: boolean;
  } | null;
}

interface RunwayMcpOAuthConnection {
  connected: boolean;
  bridgeConfigured?: boolean;
  verificationError?: string | null;
}

const RUNWAY_APPROVAL_LABELS: Record<RunwayMcpConnectionStatus | 'not_requested', string> = {
  not_requested: '未申請',
  pending: '承認待ち',
  approved: '承認済み',
  rejected: '却下',
  revoked: '取消済み',
};

const getRunwayPlanLabel = (subscription: BrandRunwaySubscription | null) => {
  return subscription?.plan?.name || subscription?.plan?.code || 'Free';
};

const initialGenerateMaterialReference: MaterialReferenceState = {
  imageUrl: '',
  fileName: '',
  materialKind: '商品画像',
  maskMode: 'auto',
  activeLayer: '商品',
  placement: '中央大きめ',
  scale: 58,
  note: '生成前に素材、切り抜き、レイヤー配置を決める',
};

const generateWorkbenchByFeature: Record<string, {
  title: string;
  description: string;
  uploadLabel: string;
  emptyLabel: string;
  materialKinds: string[];
  layerOptions: string[];
  placementOptions: string[];
}> = {
  'campaign-image': {
    title: '販促素材ワークベンチ',
    description: '商品、ロゴ、背景を置いてから、広告レイヤーとコピー位置を決めます。',
    uploadLabel: '商品・ロゴ・背景をアップロード',
    emptyLabel: '素材を置くとキャンペーン画像の主役として反映できます',
    materialKinds: ['商品画像', 'ロゴ', '背景', '販促参考'],
    layerOptions: ['商品', '背景', 'コピー', 'CTA'],
    placementOptions: ['中央大きめ', '左商品右コピー', 'EC正方形', 'SNS縦長'],
  },
  'design-gacha': {
    title: 'デザイン参照ワークベンチ',
    description: '固定する素材とランダム化する要素を、画像レイヤーで見ながら組みます。',
    uploadLabel: '商品・ロゴ・雰囲気参考をアップロード',
    emptyLabel: '参照素材を置くと、固定/ランダム化の判断がしやすくなります',
    materialKinds: ['商品画像', 'ロゴ', '雰囲気参考', '素材参考'],
    layerOptions: ['固定素材', '配色', '構図', '質感'],
    placementOptions: ['横並び比較', '中央', '全面', '商品横'],
  },
  'product-shots': {
    title: '商品撮影ワークベンチ',
    description: '実物画像を置き、正面・背面・詳細カットへ展開する前に切り抜きと背景を決めます。',
    uploadLabel: '実物商品画像をアップロード',
    emptyLabel: '素材を置くと商品カットのベース画像として使えます',
    materialKinds: ['商品画像', '平置き', 'トルソー', 'ディテール'],
    layerOptions: ['商品', '影', '背景', 'ディテール'],
    placementOptions: ['正面', '背面', '側面', 'ディテール寄り'],
  },
  'model-matrix': {
    title: 'モデル参照ワークベンチ',
    description: '商品、顔、ポーズ、体型の参照を置いて、どの条件へ効かせるかを先に決めます。',
    uploadLabel: '商品・モデル・ポーズ参照をアップロード',
    emptyLabel: '参照素材を置くとモデル条件の実素材として保存されます',
    materialKinds: ['商品画像', 'モデル参照', '顔参照', 'ポーズ参照'],
    layerOptions: ['衣服', '顔', 'ポーズ', '体型', '背景'],
    placementOptions: ['正面', '斜め45度', '全身', '上半身'],
  },
  'scene-coordinate': {
    title: '背景・シーンワークベンチ',
    description: '商品と背景参照を置き、シーン合成時の前景/背景レイヤーを決めます。',
    uploadLabel: '商品・背景参照をアップロード',
    emptyLabel: '素材を置くとシーン配置の前景レイヤーとして扱えます',
    materialKinds: ['商品画像', '背景参照', '小物', '照明参考'],
    layerOptions: ['前景商品', '背景', '影', '小物'],
    placementOptions: ['中央', '左寄せ', '右寄せ', '奥行きあり'],
  },
  colorize: {
    title: 'カラー編集ワークベンチ',
    description: '対象範囲を見ながら、残す色・変える色・柄の重ね方を決めます。',
    uploadLabel: '色変更する衣服・素材をアップロード',
    emptyLabel: '対象画像を置くと色変更範囲とレイヤーを先に整理できます',
    materialKinds: ['衣服', '生地', '柄', '小物'],
    layerOptions: ['元色', '変更範囲', '新色', '柄レイヤー'],
    placementOptions: ['中央', '上半身', '袖', '全面'],
  },
  'remove-bg': {
    title: '切り抜きワークベンチ',
    description: '背景削除前に、残す商品・影・透明背景の扱いを画面上で決めます。',
    uploadLabel: '背景を消す画像をアップロード',
    emptyLabel: '商品画像を置くと自動カットと透明背景レイヤーを確認できます',
    materialKinds: ['商品画像', '人物', '背景付き素材', '小物'],
    layerOptions: ['商品', 'カットマスク', '透明背景', '影'],
    placementOptions: ['中央', '余白あり', 'EC正方形', '全面'],
  },
  upscale: {
    title: '高解像度化ワークベンチ',
    description: '拡大する画像を置き、残す質感・強調するディテールを決めます。',
    uploadLabel: '高解像度化する画像をアップロード',
    emptyLabel: '画像を置くとディテール保持と出力用途を指定できます',
    materialKinds: ['商品画像', 'LOOK画像', '柄', 'ロゴ'],
    layerOptions: ['元画像', 'ディテール', '質感', '出力'],
    placementOptions: ['中央', '全面', 'ディテール寄り', 'EC正方形'],
  },
  variations: {
    title: '派生案ワークベンチ',
    description: '元画像を置き、固定する商品と変える背景・配色・構図を分けます。',
    uploadLabel: '派生元画像をアップロード',
    emptyLabel: '元画像を置くと固定素材と変更レイヤーを分けて保存できます',
    materialKinds: ['元画像', '商品画像', 'スタイル参照', '構図参照'],
    layerOptions: ['固定素材', '背景差分', '配色差分', '構図差分'],
    placementOptions: ['中央', '横並び比較', '左固定', '全面'],
  },
  'multilingual-banner': {
    title: '多言語バナーワークベンチ',
    description: 'ベース画像と文字エリアを置いて、言語別に崩れない余白を決めます。',
    uploadLabel: 'バナーのベース画像をアップロード',
    emptyLabel: 'ベース画像を置くとテキスト配置と多言語展開の前提にできます',
    materialKinds: ['ベース画像', '商品画像', '背景', 'ロゴ'],
    layerOptions: ['商品', '背景', 'コピー領域', 'ロゴ'],
    placementOptions: ['左商品右コピー', '中央', '上コピー', '下コピー'],
  },
};

function getRunwayReadinessIssues({
  approved,
  bridgeConfigured,
}: {
  approved: boolean;
  bridgeConfigured: boolean;
}) {
  const issues: string[] = [];
  if (!approved) issues.push('Runway MCP接続承認が必要です');
  if (!bridgeConfigured) issues.push('本番ブリッジが未設定です');
  return issues;
}

// Feature configuration for reference images
const FEATURE_CONFIG: Record<string, {
  requiresImage: boolean;
  allowedReferenceTypes: ReferenceType[];
  defaultReferenceType: ReferenceType;
  referenceLabel: string;
  referenceHint: string;
}> = {
  'campaign-image': {
    requiresImage: false,
    allowedReferenceTypes: ['style', 'composition'],
    defaultReferenceType: 'style',
    referenceLabel: '参考画像（任意）',
    referenceHint: 'スタイルや構図の参考として使用されます',
  },
  'scene-coordinate': {
    requiresImage: true,
    allowedReferenceTypes: ['base'],
    defaultReferenceType: 'base',
    referenceLabel: '商品画像',
    referenceHint: 'この商品を様々なシーンに配置します',
  },
  'colorize': {
    requiresImage: true,
    allowedReferenceTypes: ['base', 'pattern'],
    defaultReferenceType: 'base',
    referenceLabel: '対象画像',
    referenceHint: 'カラバリや柄を変更する画像',
  },
  'design-gacha': {
    requiresImage: false,
    allowedReferenceTypes: ['style', 'base'],
    defaultReferenceType: 'style',
    referenceLabel: '参考画像（任意）',
    referenceHint: 'スタイルの参考またはベース画像として使用',
  },
  'product-shots': {
    requiresImage: false,
    allowedReferenceTypes: ['base', 'style'],
    defaultReferenceType: 'base',
    referenceLabel: '実物商品画像（任意）',
    referenceHint: 'アップロードすると、この画像を元に4方向のカット設計を保存します',
  },
  'model-matrix': {
    requiresImage: false,
    allowedReferenceTypes: ['base', 'style'],
    defaultReferenceType: 'base',
    referenceLabel: '商品画像（任意）',
    referenceHint: 'モデルに着用させる商品の参考画像',
  },
  'multilingual-banner': {
    requiresImage: false,
    allowedReferenceTypes: ['base', 'style'],
    defaultReferenceType: 'base',
    referenceLabel: 'ベース画像（任意）',
    referenceHint: 'バナーの背景やベースとして使用',
  },
  'remove-bg': {
    requiresImage: true,
    allowedReferenceTypes: ['base'],
    defaultReferenceType: 'base',
    referenceLabel: '対象画像',
    referenceHint: '背景を削除する画像',
  },
  'upscale': {
    requiresImage: true,
    allowedReferenceTypes: ['base'],
    defaultReferenceType: 'base',
    referenceLabel: '対象画像',
    referenceHint: '高解像度化する画像',
  },
  'variations': {
    requiresImage: true,
    allowedReferenceTypes: ['base'],
    defaultReferenceType: 'base',
    referenceLabel: '元画像',
    referenceHint: 'この画像のバリエーション設計を保存します',
  },
  'optimize-prompt': {
    requiresImage: false,
    allowedReferenceTypes: ['style'],
    defaultReferenceType: 'style',
    referenceLabel: '参考画像（任意）',
    referenceHint: 'この画像のスタイルを参考にプロンプトを最適化',
  },
};

interface GeneratedResult {
  id: string;
  imageUrl: string;
  prompt: string;
  label?: string;
  jobId?: string;
  imageId?: string;
  storagePath?: string;
  artifactKind?: 'image' | 'planning_brief';
  materialReferences?: unknown;
  layerPlan?: unknown;
  maskPlan?: unknown;
  compositionPreview?: unknown;
}

const debugGeneration = import.meta.env.VITE_DEBUG_GENERATION === 'true';
const noImageGenerationMode = true;
const localRunwayWorkerMode = import.meta.env.VITE_LOCAL_RUNWAY_WORKER_MODE !== 'false';

const debugLog = (message: string, details?: Record<string, unknown>) => {
  if (!debugGeneration) return;
  if (details) {
    console.debug(message, details);
  } else {
    console.debug(message);
  }
};

const featureQueryAliases: Record<string, string> = {
  'generate-image': 'campaign-image',
  'text-to-image': 'campaign-image',
  'generate-variations': 'variations',
  'remove-background': 'remove-bg',
};

const findFeatureFromQuery = (featureParam: string) => {
  const normalizedFeatureId = featureQueryAliases[featureParam] ?? featureParam;
  return FEATURES.find((item) => item.id === normalizedFeatureId)
    ?? FEATURES.find((item) => item.apiEndpoint === featureParam);
};

const getInitialFeatureFromLocation = () => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const workflow = getWorkflowMetadata(params.get('workflow'));
  const featureParam = workflow?.primaryFeature ?? params.get('feature');
  return featureParam ? findFeatureFromQuery(featureParam) ?? null : null;
};

const modelMatrixBodyTypes = ['slim', 'regular', 'plus'] as const;
const modelMatrixAgeGroups = ['20s', '30s', '40s', '50s'] as const;
const modelMatrixSkinTones = ['light', 'medium', 'dark'] as const;
const modelMatrixHairStyles = ['short', 'medium', 'long'] as const;
const modelCandidateLabels = ['Clean EC 20s', 'Street LOOK 30s', 'Premium AD 40s'] as const;

const parseAllowedListParam = <T extends string>(value: string | null, allowed: readonly T[]) => {
  if (!value) return [];
  const allowedSet = new Set<string>(allowed);
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is T => allowedSet.has(item));
};

const parseAllowedParam = <T extends string>(value: string | null, allowed: readonly T[]) => {
  return value && (allowed as readonly string[]).includes(value) ? value as T : null;
};

const hydrateLightchainCompatContext = (params: URLSearchParams) => {
  const catalogFeature = getLightchainFeature(params.get('lcFeature'));
  if (!catalogFeature) return null;
  const title = params.get('lcTitle');
  const codes = params.get('lcTaskCodes')
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (title !== catalogFeature.title) return null;
  const taskCodes = codes?.length ? codes : getLightchainTaskCodes(catalogFeature);
  return {
    lightchainFeatureId: catalogFeature.id,
    lightchainFeatureTitle: catalogFeature.title,
    lightchainTaskCodes: taskCodes,
    lightchainTaskSteps: taskCodes.map((taskCode) => ({
      taskCode,
      status: 'processing' as const,
    })),
  };
};

const getGeneratedImageKey = (image: GeneratedResult, index: number) => {
  const stablePart = image.id || image.imageUrl || image.label || image.prompt || 'generated-image';
  return `${stablePart}-${index}`;
};

const getDataUrlExtension = (imageUrl: string, fallback: string) => {
  const mime = imageUrl.match(/^data:([^;,]+)/)?.[1] || '';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/svg+xml') return 'svg';
  return fallback;
};

const GENERATED_CANVAS_HANDOFF_KEY = 'heavy-chain-generated-canvas-handoff';

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const compactText = (value: string, maxLength: number) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
};

const getPlanningCardSize = (ratioId: string) => {
  switch (ratioId) {
    case '4:5':
      return { width: 960, height: 1200 };
    case '3:4':
      return { width: 900, height: 1200 };
    case '16:9':
      return { width: 1280, height: 720 };
    case '9:16':
      return { width: 720, height: 1280 };
    case '4:3':
      return { width: 1200, height: 900 };
    default:
      return { width: 1080, height: 1080 };
  }
};

const createPlanningCardDataUrl = ({
  title,
  subtitle,
  ratio,
  lines,
}: {
  title: string;
  subtitle: string;
  ratio: string;
  lines: string[];
}) => {
  const { width, height } = getPlanningCardSize(ratio);
  const lineHeight = Math.max(44, Math.round(height * 0.045));
  const startY = Math.round(height * 0.36);
  const safeLines = lines.slice(0, 6).map((line) => compactText(line, 48));
  const textNodes = safeLines.map((line, index) => (
    `<text x="8%" y="${startY + index * lineHeight}" font-size="${Math.round(height * 0.031)}" font-family="Inter, Arial, sans-serif" fill="#1f2937">${escapeXml(line)}</text>`
  )).join('');
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <rect x="4%" y="4%" width="92%" height="92%" rx="28" fill="#ffffff" stroke="#d4d4d8" stroke-width="2"/>
  <rect x="8%" y="10%" width="84%" height="10" rx="5" fill="#111827"/>
  <text x="8%" y="22%" font-size="${Math.round(height * 0.06)}" font-weight="700" font-family="Inter, Arial, sans-serif" fill="#111827">${escapeXml(compactText(title, 28))}</text>
  <text x="8%" y="29%" font-size="${Math.round(height * 0.029)}" font-family="Inter, Arial, sans-serif" fill="#6b7280">${escapeXml(compactText(subtitle, 52))}</text>
  ${textNodes}
  <text x="8%" y="90%" font-size="${Math.round(height * 0.026)}" font-family="Inter, Arial, sans-serif" fill="#71717a">No-image planning mode / ${escapeXml(ratio)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
};

const buildGenerationIntentHref = (
  feature: string,
  prompt: string,
  ratio: string,
  sourceReadback: NonNullable<ReturnType<typeof hydrateGenerationIntentSource>>,
  modelMatrixParams?: Pick<GenerationIntent, 'bodyTypes' | 'ageGroups' | 'skinTone' | 'hairStyle' | 'modelCandidateLabel'>,
  patternContext?: PatternGenerationContext | null
) => {
  const params = new URLSearchParams({
    feature,
    prompt,
    ratio,
    sourceWorkspace: sourceReadback.sourceWorkspace,
    workflowVersion: sourceReadback.workflowVersion,
    sourceLabel: sourceReadback.sourceLabel,
    sourceResumePath: sourceReadback.sourceResumePath,
    sourceMode: sourceReadback.sourceMode,
  });
  if (modelMatrixParams?.bodyTypes?.length) params.set('bodyTypes', modelMatrixParams.bodyTypes.join(','));
  if (modelMatrixParams?.ageGroups?.length) params.set('ageGroups', modelMatrixParams.ageGroups.join(','));
  if (modelMatrixParams?.skinTone) params.set('skinTone', modelMatrixParams.skinTone);
  if (modelMatrixParams?.hairStyle) params.set('hairStyle', modelMatrixParams.hairStyle);
  if (modelMatrixParams?.modelCandidateLabel) params.set('modelCandidateLabel', modelMatrixParams.modelCandidateLabel);
  if (patternContext) {
    params.set('patternPreviewId', patternContext.selectedPatternPreview.id);
    params.set('patternPreviewLabel', patternContext.selectedPatternPreview.label);
    params.set('patternPreviewMode', patternContext.selectedPatternPreview.mode);
    params.set('repeatSignature', patternContext.selectedPatternPreview.repeatSignature);
    params.set('vectorSignature', patternContext.selectedPatternPreview.vectorSignature);
    params.set('paletteSignature', patternContext.selectedPatternPreview.paletteSignature);
    params.set('motifPrompt', patternContext.motifPrompt);
    params.set('repeatStyle', patternContext.repeatStyle);
    params.set('garmentTarget', patternContext.garmentTarget);
    params.set('paletteNotes', patternContext.paletteNotes);
    params.set('vectorIntent', patternContext.vectorIntent);
    params.set('referenceAssets', patternContext.referenceAssets);
  }
  return `/generate?${params.toString()}`;
};

// Image Modal Component
function ImageModal({ 
  image, 
  isOpen, 
  onClose,
  onDownload,
  onNext,
  onPrev,
  hasNext,
  hasPrev
}: { 
  image: GeneratedResult | null;
  isOpen: boolean;
  onClose: () => void;
  onDownload: (url: string, filename: string) => void;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
}) {
  if (!isOpen || !image) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 text-white/80 hover:text-white p-2 z-10"
        >
          <span className="text-2xl">✕</span>
        </button>

        {/* Navigation arrows */}
        {hasPrev && (
          <button
            onClick={onPrev}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-14 text-white/80 hover:text-white p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
        )}
        {hasNext && (
          <button
            onClick={onNext}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-14 text-white/80 hover:text-white p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all rotate-180"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
        )}

        {/* Label */}
        {image.label && (
          <div className="absolute top-4 left-4 px-4 py-2 bg-black/60 backdrop-blur-md rounded-lg text-white text-sm font-medium">
            {image.label}
          </div>
        )}

        {/* Image */}
        <img
          src={image.imageUrl}
          alt={image.prompt}
          className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl"
        />

        {/* Info and actions */}
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-white/80 text-sm line-clamp-2 flex-1">
            {image.prompt}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDownload(image.imageUrl, `${image.label || 'planning-brief'}.${getDataUrlExtension(image.imageUrl, image.artifactKind === 'planning_brief' ? 'svg' : 'png')}`)}
              className="flex items-center gap-2 px-4 py-2 bg-white text-neutral-900 rounded-lg hover:bg-neutral-100 transition-colors font-medium"
            >
              <Download className="w-4 h-4" />
              ダウンロード
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function GeneratePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentBrand } = useAuthStore();
  const { addToHistory } = usePromptHistory();
  const initialFeatureRef = useRef<Feature | null>(getInitialFeatureFromLocation());
  
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(() => initialFeatureRef.current);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowMetadata | null>(null);
  const [prompt, setPrompt] = useState('');
  const [showPromptHistory, setShowPromptHistory] = useState(false);
  const [showSuccessCard, setShowSuccessCard] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [optimizedPromptResult, setOptimizedPromptResult] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [selectedRatio, setSelectedRatio] = useState('1:1');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImportingLocalRunway, setIsImportingLocalRunway] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedResult[]>([]);
  const localRunwayImportInputRef = useRef<HTMLInputElement | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generateCount, setGenerateCount] = useState(1);
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [overlayText, setOverlayText] = useState('');
  const [overlayLanguage, setOverlayLanguage] = useState<'ja' | 'en' | 'zh' | 'ko'>('ja');
  const [overlayPosition, setOverlayPosition] = useState<'top' | 'center' | 'bottom'>('center');
  const [overlayFont, setOverlayFont] = useState('Noto Sans');
  const [overlayColor, setOverlayColor] = useState('#ffffff');
  const [overlayStrokeColor, setOverlayStrokeColor] = useState('#000000');
  const [overlayStrokeWidth, setOverlayStrokeWidth] = useState(2);
  
  // Reference image state
  const [referenceImage, setReferenceImage] = useState<SelectedImage | null>(null);
  const [backgroundReferenceImage, setBackgroundReferenceImage] = useState<SelectedImage | null>(null);
  const [patternReferenceImage, setPatternReferenceImage] = useState<SelectedImage | null>(null);
  const [materialReference, setMaterialReference] = useState<MaterialReferenceState>(initialGenerateMaterialReference);
  
  // Feature-specific state
  const [productDescription, setProductDescription] = useState('');
  const [headline, setHeadline] = useState('');
  const [subheadline, setSubheadline] = useState('');
  const [selectedLanguages, setSelectedLanguages] = useState(['ja', 'en']);
  const [selectedBodyTypes, setSelectedBodyTypes] = useState(['slim', 'regular', 'plus']);
  const [selectedAgeGroups, setSelectedAgeGroups] = useState(['20s', '30s', '40s']);
  const [selectedScenes, setSelectedScenes] = useState(['cafe', 'street', 'office']);
  const [selectedShots, setSelectedShots] = useState(['front', 'side', 'back', 'detail']);
  const [fixedElements, setFixedElements] = useState<string[]>(['logo']);
  const [randomizedElements, setRandomizedElements] = useState<string[]>(['color', 'layout']);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const [campaignTitle, setCampaignTitle] = useState('');
  const [campaignSubheadline, setCampaignSubheadline] = useState('');
  const [campaignDiscount, setCampaignDiscount] = useState('');
  const [campaignPeriod, setCampaignPeriod] = useState('');
  const [campaignCTA, setCampaignCTA] = useState('');
  const [campaignBrandColor, setCampaignBrandColor] = useState('#ff6b6b');
  const [campaignTextPosition, setCampaignTextPosition] = useState<'top' | 'center' | 'bottom'>('center');
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantPlanConfirmed, setAssistantPlanConfirmed] = useState(false);
  const [assistantPlanItems, setAssistantPlanItems] = useState<AssistantPlanItem[]>(
    () => getDefaultAssistantPlan(initialFeatureRef.current?.id)
  );
  
  // Background & Color options
  const [selectedBackground, setSelectedBackground] = useState('white');
  const [customBackground, setCustomBackground] = useState('');
  const [selectedColors, setSelectedColors] = useState<string[]>(['red', 'blue', 'green']);
  const [customColor, setCustomColor] = useState('#000000');
  const [selectedPattern, setSelectedPattern] = useState('solid');
  const [upscaleScale, setUpscaleScale] = useState<2 | 4>(2);
  const [variationStrength, setVariationStrength] = useState(50);
  
  // Upscale options
  const [denoiseLevel, setDenoiseLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const [sharpness, setSharpness] = useState(50);
  
  // Model options
  const [skinTone, setSkinTone] = useState<'light' | 'medium' | 'dark'>('medium');
  const [hairStyle, setHairStyle] = useState<'short' | 'medium' | 'long'>('medium');
  const [modelCandidateLabel, setModelCandidateLabel] = useState<string>('');
  const [runwayApproval, setRunwayApproval] = useState<RunwayMcpConnectionApproval | null>(null);
  const [runwaySubscription, setRunwaySubscription] = useState<BrandRunwaySubscription | null>(null);
  const [runwayOAuthConnection, setRunwayOAuthConnection] = useState<RunwayMcpOAuthConnection | null>(null);

  const featureConfig = selectedFeature ? FEATURE_CONFIG[selectedFeature.id] : null;
  const selectedGenerateWorkbench = selectedFeature
    ? generateWorkbenchByFeature[selectedFeature.id] ?? null
    : null;
  const sourceReadback = hydrateGenerationIntentSource(searchParams);
  const lightchainCompat = hydrateLightchainCompatContext(searchParams);
  const patternContext = sourceReadback?.sourceWorkspace === 'patterns'
    ? hydratePatternGenerationContext(searchParams)
    : null;

  useEffect(() => {
    if (!selectedGenerateWorkbench) return;
    if (!referenceImage?.url) {
      if (materialReference.imageUrl) {
        setMaterialReference((current) => ({
          ...current,
          imageUrl: '',
          fileName: '',
        }));
      }
      return;
    }
    if (materialReference.imageUrl === referenceImage.url) return;
    setMaterialReference((current) => ({
      ...current,
      imageUrl: referenceImage.url,
      fileName: current.fileName || 'reference image',
    }));
  }, [materialReference.imageUrl, referenceImage?.url, selectedGenerateWorkbench]);

  useEffect(() => {
    if (!currentBrand) {
      setRunwayApproval(null);
      setRunwaySubscription(null);
      setRunwayOAuthConnection(null);
      return;
    }

    let active = true;

    const fetchRunwayReadiness = async () => {
      const [approvalResult, subscriptionResult, oauthResult] = await Promise.all([
        supabase
          .from('runway_mcp_connection_approvals')
          .select('status, updated_at')
          .eq('brand_id', currentBrand.id)
          .maybeSingle(),
        supabase
          .from('brand_subscriptions')
          .select('status, current_period_start, current_period_end, plans(code, name, is_active, features)')
          .eq('brand_id', currentBrand.id)
          .maybeSingle(),
        supabase.functions.invoke('runway-mcp-connection-status', {
          body: { brandId: currentBrand.id },
        }),
      ]);

      if (!active) return;

      if (approvalResult.error) {
        console.error('Failed to fetch Runway MCP approval:', approvalResult.error);
        setRunwayApproval(null);
      } else {
        setRunwayApproval((approvalResult.data || null) as RunwayMcpConnectionApproval | null);
      }

      if (subscriptionResult.error) {
        console.error('Failed to fetch Runway MCP subscription:', subscriptionResult.error);
        setRunwaySubscription(null);
      } else {
        const row = subscriptionResult.data as any;
        const plan = Array.isArray(row?.plans) ? row.plans[0] : row?.plans;
        setRunwaySubscription(row ? {
          status: row.status || null,
          current_period_start: row.current_period_start || null,
          current_period_end: row.current_period_end || null,
          plan: plan ? {
            code: plan.code || null,
            name: plan.name || null,
            is_active: plan.is_active ?? null,
            runway_mcp_generation: plan.features?.runway_mcp_generation === true,
          } : null,
        } : null);
      }

      if (oauthResult.error) {
        debugLog('Runway MCP OAuth connection status unavailable', {
          message: oauthResult.error.message,
        });
        setRunwayOAuthConnection(null);
      } else {
        setRunwayOAuthConnection((oauthResult.data || null) as RunwayMcpOAuthConnection | null);
      }

    };

    fetchRunwayReadiness();

    return () => {
      active = false;
    };
  }, [currentBrand]);

  useEffect(() => {
    const workflow = getWorkflowMetadata(searchParams.get('workflow'));
    const featureParam = searchParams.get('feature');
    const promptParam = searchParams.get('prompt');
    const ratioParam = searchParams.get('ratio');

    if (!workflow && !featureParam && promptParam === null && !ratioParam) {
      setActiveWorkflow(null);
      return;
    }

    const feature = workflow
      ? findFeatureFromQuery(workflow.primaryFeature)
      : featureParam ? findFeatureFromQuery(featureParam) : null;

    if (feature) {
      setActiveWorkflow(workflow);
      setSelectedFeature(feature);
      setGeneratedImages([]);
      setOptimizedPromptResult('');
      setGenerationError('');
      setAssistantPrompt('');
      setAssistantPlanConfirmed(false);
      setAssistantPlanItems(getDefaultAssistantPlan(feature.id));
      setReferenceImage(null);
      setBackgroundReferenceImage(null);
      setPatternReferenceImage(null);
      setMaterialReference(initialGenerateMaterialReference);
      setShowSuccessCard(false);
      setGenerateCount(workflow?.generateCount ?? (feature.id === 'design-gacha' ? 4 : 1));
      setOverlayEnabled(false);
      setSelectedShots(workflow?.shots.length ? workflow.shots : ['front', 'side', 'back', 'detail']);

      if (workflow) {
        setPrompt(workflow.prefill.prompt ?? '');
        setProductDescription(workflow.prefill.productDescription ?? '');
        setCampaignTitle(workflow.prefill.campaignTitle ?? '');
        setCampaignSubheadline(workflow.prefill.campaignSubheadline ?? '');
        setCampaignCTA(workflow.prefill.campaignCTA ?? '');
        setHeadline(workflow.prefill.headline ?? '');
        setSubheadline(workflow.prefill.subheadline ?? '');
        if (aspectRatios.some((ratio) => ratio.id === workflow.ratio)) {
          setSelectedRatio(workflow.ratio);
        }
        if (workflow.languages.length) {
          setSelectedLanguages(workflow.languages);
        }
        if (workflow.scenes.length) {
          setSelectedScenes(workflow.scenes);
        }
      }
    } else {
      setActiveWorkflow(null);
    }

    if (promptParam !== null) {
      setPrompt(promptParam);
      setAssistantPrompt(promptParam);
      setAssistantPlanConfirmed(false);
      setAssistantPlanItems(feature ? buildAssistantPlan(feature.id, promptParam) : getDefaultAssistantPlan('campaign-image'));

      if (feature?.id === 'product-shots' || feature?.id === 'model-matrix') {
        setProductDescription(promptParam);
      } else if (feature?.id === 'multilingual-banner') {
        setHeadline(promptParam);
      }
    }

    if (feature?.id === 'model-matrix') {
      const bodyTypes = parseAllowedListParam(searchParams.get('bodyTypes'), modelMatrixBodyTypes);
      const ageGroups = parseAllowedListParam(searchParams.get('ageGroups'), modelMatrixAgeGroups);
      const sourceSkinTone = parseAllowedParam(searchParams.get('skinTone'), modelMatrixSkinTones);
      const sourceHairStyle = parseAllowedParam(searchParams.get('hairStyle'), modelMatrixHairStyles);
      const sourceModelCandidateLabel = parseAllowedParam(searchParams.get('modelCandidateLabel'), modelCandidateLabels);

      if (bodyTypes.length) setSelectedBodyTypes(bodyTypes);
      if (ageGroups.length) setSelectedAgeGroups(ageGroups);
      if (sourceSkinTone) setSkinTone(sourceSkinTone);
      if (sourceHairStyle) setHairStyle(sourceHairStyle);
      setModelCandidateLabel(sourceModelCandidateLabel ?? '');
    } else {
      setModelCandidateLabel('');
    }

    if (ratioParam && aspectRatios.some((ratio) => ratio.id === ratioParam)) {
      setSelectedRatio(ratioParam);
    }
  }, [searchParams]);

  const resetSharedInputs = () => {
    setPrompt('');
    setNegativePrompt('');
    setOptimizedPromptResult('');
    setGenerationError('');
    setSelectedStyle(null);
  };

  const applyAssistantPrompt = () => {
    const value = assistantPrompt.trim();
    if (!value) {
      toast.error('作りたい内容を入力してください');
      return;
    }

    setAssistantPlanItems(buildAssistantPlan(selectedFeature?.id, value));
    setAssistantPlanConfirmed(true);
  };

  const applyAssistantPlanToForm = () => {
    const value = assistantPrompt.trim();
    if (!value) {
      toast.error('先に生成リクエストを入力してください');
      return;
    }

    const planLines = assistantPlanItems.map((item, index) => (
      `${index + 1}. ${item.title}: ${item.description}`
    ));
    const planSummary = planLines.join('\n');
    const plannedPrompt = `${value}\n\n生成計画:\n${planSummary}`;

    switch (selectedFeature?.id) {
      case 'product-shots':
      case 'model-matrix':
        setProductDescription(plannedPrompt);
        break;
      case 'multilingual-banner':
        setHeadline(value);
        setSubheadline(planSummary);
        break;
      case 'scene-coordinate':
        setPrompt(plannedPrompt);
        if (!selectedScenes.length) setSelectedScenes(['cafe', 'street', 'office']);
        break;
      case 'remove-bg':
      case 'colorize':
      case 'upscale':
      case 'variations':
      case 'design-gacha':
      case 'campaign-image':
      default:
        setPrompt(plannedPrompt);
        break;
    }

    if (selectedFeature?.id === 'campaign-image') {
      setSelectedRatio((current) => current || '1:1');
      setGenerateCount((current) => Math.max(current, 3));
      setCampaignTitle((current) => current || assistantPlanItems[0]?.title || value);
      setCampaignSubheadline((current) => current || assistantPlanItems[1]?.description || '');
    }
    if (selectedFeature?.id === 'design-gacha') {
      setGenerateCount((current) => Math.max(current, 4));
      setFixedElements(['product', 'text']);
      setRandomizedElements(['color', 'layout', 'texture']);
    }
    if (selectedFeature?.id === 'variations') {
      setGenerateCount((current) => Math.max(current, 3));
    }
    if (selectedFeature?.id === 'product-shots') {
      setSelectedShots((current) => current.length ? current : ['front', 'side', 'back', 'detail']);
    }
    if (selectedFeature?.id === 'model-matrix') {
      setSelectedBodyTypes((current) => current.length ? current : ['slim', 'regular', 'plus']);
      setSelectedAgeGroups((current) => current.length ? current : ['20s', '30s', '40s']);
    }
    if (selectedFeature?.id === 'multilingual-banner') {
      setSelectedLanguages((current) => current.length ? current : ['ja', 'en', 'ko']);
    }
    setMaterialReference((current) => ({
      ...current,
      note: `${value}\n${planSummary}`,
    }));
    toast.success('生成計画を詳細設定へ反映しました');
  };

  const handleBack = () => {
    if (selectedFeature?.id === 'optimize-prompt') {
      resetSharedInputs();
    }
    setActiveWorkflow(null);
    setSelectedFeature(null);
    setGeneratedImages([]);
    setOptimizedPromptResult('');
    setGenerationError('');
    setReferenceImage(null);
    setBackgroundReferenceImage(null);
    setPatternReferenceImage(null);
    setShowSuccessCard(false);
  };

  // 画像を圧縮する関数
  const compressImage = async (dataUrl: string, maxWidth: number = 1024): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // 画像が大きすぎる場合はリサイズ
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        // JPEG形式で圧縮（品質0.8）
        const compressed = canvas.toDataURL('image/jpeg', 0.8);
        debugLog('Image compressed', {
          beforeKb: Math.round(dataUrl.length / 1024),
          afterKb: Math.round(compressed.length / 1024),
        });
        resolve(compressed);
      };
      img.onerror = () => resolve(dataUrl); // エラー時は元の画像を返す
      img.src = dataUrl;
    });
  };

  const generatedImageRowToResult = async (image: any, index: number): Promise<GeneratedResult> => {
    let imageUrl = image.image_url || '';
    if (!imageUrl && image.storage_path) {
      const { data, error } = await supabase.storage
        .from('generated-images')
        .createSignedUrl(image.storage_path, 60 * 60);
      if (error || !data?.signedUrl) {
        const details = [image.id, image.storage_path].filter(Boolean).join(':');
        throw error ?? new Error(`local_runway_worker_signed_url_failed:${details}`);
      }
      imageUrl = data?.signedUrl || '';
    }
    if (!imageUrl) {
      const details = [image.id, image.storage_path].filter(Boolean).join(':');
      throw new Error(`local_runway_worker_image_url_missing:${details}`);
    }
    return {
      id: image.id || `${image.job_id || 'local-runway'}-${index}`,
      imageUrl,
      prompt: image.prompt || image.metadata?.prompt || image.generation_params?.prompt || '',
      label: image.metadata?.title || `Runway worker result ${index + 1}`,
      jobId: image.job_id || undefined,
      imageId: image.id || undefined,
      storagePath: image.storage_path || undefined,
      artifactKind: 'image',
    };
  };

  const waitForLocalRunwayWorkerResults = async (jobId: string): Promise<GeneratedResult[]> => {
    const maxAttempts = 120;
    const maxPendingAttempts = 12;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const result = await pollLocalRunwayWorkerGeneration(jobId);
      if (result.job.status === 'failed') {
        throw new Error(result.job.error_message || 'local_runway_worker_generation_failed');
      }
      if (result.job.status === 'completed' && result.images.length > 0) {
        return Promise.all(result.images.map(generatedImageRowToResult));
      }
      if (result.job.status === 'pending' && attempt >= maxPendingAttempts) {
        throw new Error('local_runway_worker_not_running');
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error('local_runway_worker_timeout');
  };

  const buildGenerateMaterialContext = useCallback((imageUrlOverride?: string | null, referenceTypeOverride?: string) => {
    const materialReferenceMetadata = buildMaterialReferenceMetadata({
      ...materialReference,
      imageUrl: imageUrlOverride ?? materialReference.imageUrl,
    });
    const hasGenerateMaterialReference = Boolean(materialReferenceMetadata.hasImage);
    const generateLayerPlan = hasGenerateMaterialReference ? {
      activeLayer: materialReference.activeLayer,
      placement: materialReference.placement,
      scale: materialReference.scale,
      source: 'generate_page_material_workbench',
    } : undefined;
    const generateMaskPlan = hasGenerateMaterialReference ? {
      mode: materialReference.maskMode,
      materialKind: materialReference.materialKind,
      source: 'generate_page_material_workbench',
    } : undefined;
    const generateCompositionPreview = hasGenerateMaterialReference ? {
      referenceType: referenceTypeOverride,
      fileName: materialReference.fileName,
      note: materialReference.note,
      source: 'generate_page_material_workbench',
    } : undefined;
    const generateMaterialMetadata = hasGenerateMaterialReference ? {
      materialReferences: [materialReferenceMetadata],
      layerPlan: generateLayerPlan,
      maskPlan: generateMaskPlan,
      compositionPreview: generateCompositionPreview,
    } : {};
    const materialPromptLines = hasGenerateMaterialReference ? [
      `Material: ${materialReference.materialKind}`,
      `Mask: ${materialReference.maskMode}`,
      `Layer: ${materialReference.activeLayer}`,
      `Placement: ${materialReference.placement}`,
      `Scale: ${materialReference.scale}%`,
      materialReference.note.trim() ? `Material note: ${materialReference.note.trim()}` : '',
    ].filter(Boolean) : [];
    return {
      hasGenerateMaterialReference,
      generateMaterialMetadata,
      materialPromptLines,
    };
  }, [materialReference]);

  const handleGenerate = async () => {
    debugLog('Generation requested', {
      isGenerating,
      selectedFeature: selectedFeature?.id,
      hasBrand: !!currentBrand,
      hasReferenceImage: !!referenceImage,
      selectedBackground,
    });
    
    if (!currentBrand) {
      toast.error('ブランドを選択してください');
      return;
    }

    if (overlayEnabled && !overlayText.trim()) {
      toast.error('画像内テキストを入力してください');
      return;
    }

    // Validate required image
    if (featureConfig?.requiresImage && !referenceImage) {
      toast.error('画像をアップロードしてください');
      return;
    }

    if (!noImageGenerationMode && selectedFeatureUsesRunwayMcp && !runwayReadyInApp) {
      const message = runwayReadinessIssues.length
        ? runwayReadinessIssues.join(' / ')
        : 'Runway MCP生成条件を確認できません。ブランド設定を確認してください';
      setGenerationError(message);
      toast.error(message);
      return;
    }

    setGenerationError('');
    setIsGenerating(true);
    debugLog('Generation started', { selectedFeature: selectedFeature?.id });
    
    try {
      const effectiveReferenceImageUrl = referenceImage?.url || materialReference.imageUrl || null;
      const effectiveReferenceType = referenceImage?.referenceType ?? featureConfig?.defaultReferenceType ?? 'base';

      // 画像が大きすぎる場合は圧縮
      let processedImageUrl = effectiveReferenceImageUrl;
      if (processedImageUrl && processedImageUrl.startsWith('data:') && processedImageUrl.length > 500000) {
        debugLog('Reference image will be compressed');
        toast.loading('画像を圧縮中...', { id: 'compress' });
        processedImageUrl = await compressImage(processedImageUrl);
        toast.dismiss('compress');
      }
      let data: any;
      let error: any;
      let newGeneratedImages: GeneratedResult[] = [];
      const replaceGeneratedImages = (images: GeneratedResult[]) => {
        newGeneratedImages = images;
        setGeneratedImages(images);
      };
      const prependGeneratedImages = (images: GeneratedResult[]) => {
        newGeneratedImages = images;
        setGeneratedImages(prev => [...images, ...prev]);
      };
      const textOverlay = overlayEnabled && overlayText.trim() ? {
        text: overlayText.trim(),
        language: overlayLanguage,
        position: overlayPosition,
        font: overlayFont,
        color: overlayColor,
        strokeColor: overlayStrokeColor,
        strokeWidth: overlayStrokeWidth,
      } : undefined;

      const baseBody = {
        brandId: currentBrand.id,
        referenceImage: processedImageUrl,
        referenceType: effectiveReferenceType,
        textOverlay,
        lightchainCompat: lightchainCompat ?? undefined,
      };
      const { generateMaterialMetadata, materialPromptLines } = buildGenerateMaterialContext(
        processedImageUrl,
        effectiveReferenceType,
      );
      const buildRemoteGenerationContext = (feature: Feature | null, intentPrompt: string, ratio: string) => {
        if (!feature) return {};
        const baseContext = {
          featureType: feature.id,
          ...(lightchainCompat ? { lightchainCompat } : {}),
          ...generateMaterialMetadata,
        };
        if (!sourceReadback) return baseContext;
        const generationIntent: GenerationIntent = {
          feature: feature.id,
          prompt: intentPrompt,
          href: buildGenerationIntentHref(feature.id, intentPrompt, ratio, sourceReadback),
          label: `${feature.name}で生成`,
          aspectRatio: ratio,
          ...sourceReadback,
          ...generateMaterialMetadata,
        };
        return {
          ...baseContext,
          sourceReadback,
          generationIntent,
          ...(lightchainCompat ? { lightchainCompat } : {}),
        };
      };
      
      debugLog('Base generation body prepared', {
        hasReferenceImage: !!processedImageUrl,
        hasTextOverlay: !!textOverlay,
        referenceType: referenceImage?.referenceType,
      });

      const planningFeature = selectedFeature;
      if (noImageGenerationMode && planningFeature && planningFeature.id !== 'optimize-prompt') {
        const shotLabels: Record<string, string> = {
          front: '正面',
          side: '側面',
          back: '背面',
          detail: 'ディテール',
        };
        const selectedStyleLabel = selectedStyle
          ? stylePresets.find((style) => style.id === selectedStyle)?.name
          : null;
        const primaryBrief = [
          prompt.trim(),
          productDescription.trim(),
          headline.trim(),
          campaignTitle.trim(),
          campaignSubheadline.trim(),
        ].filter(Boolean).join(' / ');
        const fallbackBrief = planningFeature.name;
        const featureLines = [
          `Feature: ${planningFeature.name}`,
          productDescription.trim() ? `Product: ${productDescription.trim()}` : '',
          prompt.trim() ? `Concept: ${prompt.trim()}` : '',
          headline.trim() ? `Headline: ${headline.trim()}` : '',
          subheadline.trim() ? `Subheadline: ${subheadline.trim()}` : '',
          campaignTitle.trim() ? `Campaign: ${campaignTitle.trim()}` : '',
          campaignCTA.trim() ? `CTA: ${campaignCTA.trim()}` : '',
          planningFeature.id === 'design-gacha' && fixedElements.length ? `Fixed elements: ${fixedElements.join(', ')}` : '',
          planningFeature.id === 'design-gacha' && randomizedElements.length ? `Randomized elements: ${randomizedElements.join(', ')}` : '',
          selectedStyleLabel ? `Style: ${selectedStyleLabel}` : '',
          `Ratio: ${selectedRatio}`,
          referenceImage ? `Reference: ${referenceImage.referenceType || 'attached'}` : '',
          !referenceImage && materialReference.imageUrl ? `Reference: ${effectiveReferenceType}` : '',
          ...materialPromptLines,
        ].filter(Boolean);
        const resultLabels = (() => {
          if (planningFeature.id === 'product-shots') {
            const shots = selectedShots.length ? selectedShots : ['front', 'side', 'back', 'detail'];
            return shots.map((shot) => `${shotLabels[shot] || shot}カット設計`);
          }
          if (planningFeature.id === 'model-matrix') {
            return selectedBodyTypes.flatMap((bodyType) => selectedAgeGroups.map((ageGroup) => `${bodyType} ${ageGroup} 着用設計`)).slice(0, 6);
          }
          if (planningFeature.id === 'multilingual-banner') {
            return selectedLanguages.map((language) => `${language.toUpperCase()} バナー設計`);
          }
          if (planningFeature.id === 'scene-coordinate') {
            return selectedScenes.map((scene) => `${sceneOptions.find((item) => item.id === scene)?.name || scene} シーン設計`);
          }
          const count = Math.max(1, Math.min(generateCount, 6));
          return Array.from({ length: count }, (_, index) => `${planningFeature.name} 企画 ${index + 1}`);
        })();
        if (localRunwayWorkerMode) {
          const ratio = aspectRatios.find(r => r.id === selectedRatio) || aspectRatios[0];
          const workerPrompt = buildProductionImagePrompt({
            feature: planningFeature,
            userBrief: primaryBrief || fallbackBrief,
            styleLabel: selectedStyleLabel,
            aspectRatio: selectedRatio,
            textOverlay,
            referenceImagePresent: Boolean(processedImageUrl),
            extraLines: featureLines,
          });
          const productionNegativePrompt = mergeProductionNegativePrompt(negativePrompt);
          const { job } = await enqueueLocalRunwayWorkerGeneration({
            brandId: currentBrand.id,
            featureType: planningFeature.id,
            prompt: workerPrompt,
            negativePrompt: productionNegativePrompt,
            width: ratio.width,
            height: ratio.height,
            count: Math.max(1, Math.min(resultLabels.length || generateCount, 4)),
            referenceImage: processedImageUrl ?? null,
            referenceType: effectiveReferenceType,
            metadata: {
              source: 'generate_page',
              artifactKind: 'runway_local_worker_request',
              aspectRatio: selectedRatio,
              selectedStyle: selectedStyleLabel ?? null,
              promptQualityPreset: 'heavy-chain-production-apparel-v1',
              originalUserBrief: primaryBrief || fallbackBrief,
              negativePrompt: productionNegativePrompt,
              resultLabels,
              referenceImagePresent: Boolean(processedImageUrl),
              referenceType: effectiveReferenceType,
              ...generateMaterialMetadata,
              selectedShots,
              selectedBodyTypes,
              selectedAgeGroups,
              selectedScenes,
              selectedLanguages,
              fixedElements,
              randomizedElements,
              campaignTitle,
              campaignSubheadline,
              campaignCTA,
              ...(lightchainCompat ? { lightchainCompat } : {}),
              ...(sourceReadback ? {
                sourceWorkspace: sourceReadback.sourceWorkspace,
                workflowVersion: sourceReadback.workflowVersion,
                sourceLabel: sourceReadback.sourceLabel,
                sourceResumePath: sourceReadback.sourceResumePath,
                sourceMode: sourceReadback.sourceMode,
              } : {}),
              ...(patternContext ?? {}),
            },
          });
          toast.success('ローカルRunway workerに生成依頼を送信しました');
          const workerResults = await waitForLocalRunwayWorkerResults(job.id);
          replaceGeneratedImages(workerResults);
          if (primaryBrief) {
            addToHistory(primaryBrief, `${planningFeature.name} 生成`);
          }
          setShowSuccessCard(true);
          toast.success('ローカルRunway workerの生成が完了しました');
          return;
        }
        const planIdBase = Date.now().toString();
        const planningResults: GeneratedResult[] = resultLabels.map((label, index) => {
          const title = label;
          const imageUrl = createPlanningCardDataUrl({
            title,
            subtitle: primaryBrief || fallbackBrief,
            ratio: selectedRatio,
            lines: featureLines,
          });
          return {
            id: `plan-${planIdBase}-${index + 1}`,
            imageUrl,
            prompt: primaryBrief || fallbackBrief,
            label: title,
            artifactKind: 'planning_brief',
            ...generateMaterialMetadata,
          };
        });

        replaceGeneratedImages(planningResults);
        planningResults.forEach((image, index) => {
          saveWorkspaceArtifact({
            id: `no-image-${image.id}`,
            brandId: currentBrand.id,
            featureType: planningFeature.id,
            title: image.label || planningFeature.name,
            imageUrl: image.imageUrl,
            prompt: image.prompt,
            metadata: {
              artifactKind: 'planning_brief',
              generationDisabled: true,
              noImageGenerationMode: true,
              generatedResultId: image.id,
              generatedResultLabel: image.label,
              generationIndex: index,
              aspectRatio: selectedRatio,
              selectedStyle: selectedStyleLabel,
              referenceImagePresent: Boolean(referenceImage),
              referenceType: referenceImage?.referenceType,
              ...generateMaterialMetadata,
              selectedShots,
              selectedBodyTypes,
              selectedAgeGroups,
              selectedScenes,
              selectedLanguages,
              campaignTitle,
              campaignSubheadline,
              campaignCTA,
              ...(lightchainCompat ? { lightchainCompat } : {}),
              ...(sourceReadback ? {
                sourceWorkspace: sourceReadback.sourceWorkspace,
                workflowVersion: sourceReadback.workflowVersion,
                sourceLabel: sourceReadback.sourceLabel,
                sourceResumePath: sourceReadback.sourceResumePath,
                sourceMode: sourceReadback.sourceMode,
              } : {}),
              ...(patternContext ?? {}),
            },
          });
        });
        if (primaryBrief) {
          addToHistory(primaryBrief, `${planningFeature.name} 企画`);
        }
        setShowSuccessCard(true);
        toast.success('画像生成なしで企画書を保存しました');
        return;
      }

      switch (selectedFeature?.id) {
        case 'remove-bg':
          const bgPrompt = selectedBackground === 'custom' ? customBackground : 
            selectedBackground === 'reference' && backgroundReferenceImage ? 'use reference image' :
            backgroundOptions.find(b => b.id === selectedBackground)?.prompt || '';
          
          ({ data, error } = await supabase.functions.invoke('remove-background', {
            body: { 
              ...baseBody,
              ...generateMaterialMetadata,
              imageUrl: processedImageUrl, 
              newBackground: bgPrompt,
              backgroundReferenceImage: backgroundReferenceImage?.url,
            }
          }));
          if (data?.resultUrl) {
            replaceGeneratedImages([{
              id: Date.now().toString(),
              imageUrl: data.resultUrl,
              prompt: `背景: ${backgroundOptions.find(b => b.id === selectedBackground)?.name || customBackground}`,
              label: '背景変更'
            }]);
          }
          break;

        case 'colorize':
          ({ data, error } = await supabase.functions.invoke('colorize', {
            body: { 
              ...baseBody,
              ...generateMaterialMetadata,
              imageUrl: processedImageUrl, 
              colors: selectedColors.includes('custom') ? [...selectedColors.filter(c => c !== 'custom'), customColor] : selectedColors,
              pattern: selectedPattern,
              patternReferenceImage: patternReferenceImage?.url,
              count: generateCount,
            }
          }));
          if (data?.variations) {
            replaceGeneratedImages(data.variations.map((v: any) => ({
              id: v.storagePath || Date.now().toString(),
              imageUrl: v.imageUrl,
              prompt: v.colorName,
              label: v.colorName
            })));
          }
          break;

        case 'upscale':
          ({ data, error } = await supabase.functions.invoke('upscale', {
            body: { 
              ...baseBody,
              ...generateMaterialMetadata,
              imageUrl: processedImageUrl, 
              scale: upscaleScale,
              denoiseLevel,
              sharpness,
            }
          }));
          if (data?.resultUrl) {
            replaceGeneratedImages([{
              id: Date.now().toString(),
              imageUrl: data.resultUrl,
              prompt: `${upscaleScale}倍アップスケール`,
              label: `${upscaleScale}x 高解像度`
            }]);
          }
          break;

        case 'variations':
          ({ data, error } = await supabase.functions.invoke('generate-variations', {
            body: { 
              ...baseBody,
              ...generateMaterialMetadata,
              imageUrl: processedImageUrl, 
              count: generateCount,
              strength: variationStrength / 100,
              prompt: prompt || undefined,
              featureType: 'variations',
            }
          }));
          if (data?.variations) {
            replaceGeneratedImages(data.variations.map((v: any, i: number) => ({
              id: v.storagePath || Date.now().toString() + i,
              imageUrl: v.imageUrl,
              prompt: prompt || 'バリエーション',
              label: `バリエーション ${i + 1}`
            })));
          }
          break;

        case 'scene-coordinate':
          if (!referenceImage) {
            toast.error('商品画像をアップロードしてください');
            setIsGenerating(false);
            return;
          }
          debugLog('Invoking scene-coordinate', { hasImage: !!processedImageUrl });
          ({ data, error } = await supabase.functions.invoke('generate-variations', {
            body: { 
              ...baseBody,
              ...generateMaterialMetadata,
              imageUrl: processedImageUrl,
              scenes: selectedScenes.map(s => sceneOptions.find(sc => sc.id === s)?.prompt),
              count: selectedScenes.length,
              featureType: 'scene-coordinate',
            }
          }));
          if (data?.variations) {
            replaceGeneratedImages(data.variations.map((v: any, i: number) => ({
              id: v.storagePath || Date.now().toString() + i,
              imageUrl: v.imageUrl,
              prompt: selectedScenes[i],
              label: sceneOptions.find(s => s.id === selectedScenes[i])?.name || `シーン ${i + 1}`
            })));
          }
          break;

        case 'design-gacha':
          if (!prompt.trim() && !referenceImage) {
            toast.error('ブリーフまたは商品画像を入力してください');
            setIsGenerating(false);
            return;
          }
          debugLog('Invoking design-gacha', {
            hasImage: !!processedImageUrl,
            fixedElementCount: fixedElements.length,
            randomizedElementCount: randomizedElements.length,
          });
          ({ data, error } = await supabase.functions.invoke('design-gacha', {
            body: { 
              ...baseBody,
              ...generateMaterialMetadata,
              brief: prompt,
              imageUrl: processedImageUrl, // 画像参照用
              directions: generateCount,
              fixedElements,
              randomizedElements,
              sourceReadback: sourceReadback ?? undefined,
              patternContext: patternContext ?? undefined,
            }
          }));
          if (data?.variations) {
            replaceGeneratedImages(data.variations.map((v: any) => ({
              id: v.imageId || v.storagePath,
              imageUrl: v.imageUrl,
              prompt: v.prompt,
              label: v.directionName,
              jobId: data.jobId,
              imageId: v.imageId,
              storagePath: v.storagePath,
            })));
          }
          break;

        case 'product-shots':
          debugLog('Product-shots validation check', {
            hasProductDescription: !!productDescription.trim(),
            hasReferenceImage: !!referenceImage
          });
          if (!productDescription.trim() && !referenceImage) {
            debugLog('Product-shots validation failed');
            toast.error('商品説明または商品画像を入力してください');
            setIsGenerating(false);
            return;
          }
          debugLog('Product-shots validation passed');
          // 選択されたショットをすべて生成（制限なし）
          const shotsToGenerate = selectedShots.length ? selectedShots : ['front', 'side', 'back', 'detail'];
          debugLog('Product-shots request prepared', {
            shotCount: shotsToGenerate.length,
            background: selectedBackground,
            hasReferenceImage: !!referenceImage,
          });
          const requestBody = { 
            ...baseBody,
            ...generateMaterialMetadata,
            productDescription,
            imageUrl: processedImageUrl,
            shots: shotsToGenerate,
            background: selectedBackground,
          };
          
          debugLog('Invoking product-shots function');
          try {
            // タイムアウト処理付きのAPI呼び出し
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('リクエストがタイムアウトしました（60秒）')), 60000)
            );
            
            const invokePromise = supabase.functions.invoke('product-shots', {
              body: requestBody
            });
            
            const result = await Promise.race([invokePromise, timeoutPromise]) as any;
            data = result.data;
            error = result.error;
            debugLog('Product-shots invoke completed', {
              hasData: !!data,
              hasError: !!error,
              shotCount: data?.shots?.length || 0,
            });
          } catch (invokeError: any) {
            debugLog('Product-shots invoke failed', {
              errorType: invokeError?.constructor?.name,
              hasMessage: !!invokeError?.message,
            });
            throw new Error(`API呼び出しエラー: ${invokeError.message}`);
          }
          if (error) {
            debugLog('Product-shots returned an error');
            throw error;
          }
          if (data?.shots && data.shots.length > 0) {
            const images = data.shots.map((s: any) => ({
              id: s.storagePath,
              imageUrl: s.imageUrl,
              prompt: productDescription || data.productDescription,
              label: s.shotName
            }));
            debugLog('Product-shots images received', { imageCount: images.length });
            replaceGeneratedImages(images);
          } else {
            debugLog('Product-shots returned no shots');
            if (data?.error) {
              throw new Error(data.error);
            }
          }
          break;

        case 'model-matrix':
          if (!productDescription.trim() && !referenceImage) {
            toast.error('商品説明または商品画像を入力してください');
            setIsGenerating(false);
            return;
          }
          debugLog('Invoking model-matrix', { hasImage: !!processedImageUrl });
          ({ data, error } = await supabase.functions.invoke('model-matrix', {
            body: { 
              ...baseBody,
              ...generateMaterialMetadata,
              productDescription,
              imageUrl: processedImageUrl, // 画像参照用
              bodyTypes: selectedBodyTypes,
              ageGroups: selectedAgeGroups,
              skinTone,
              hairStyle,
              sourceReadback: sourceReadback ?? undefined,
              modelCandidateLabel: modelCandidateLabel || undefined,
            }
          }));
          if (data?.matrix) {
            replaceGeneratedImages(data.matrix.map((m: any) => ({
              id: m.storagePath,
              imageUrl: m.imageUrl,
              prompt: productDescription,
              label: `${m.bodyTypeName} × ${m.ageGroupName}`
            })));
          }
          break;

        case 'multilingual-banner':
          if (!headline.trim()) {
            toast.error('ヘッドラインを入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('multilingual-banner', {
            body: { 
              ...baseBody,
              ...generateMaterialMetadata,
              headline, 
              subheadline,
              languages: selectedLanguages,
              aspectRatio: selectedRatio
            }
          }));
          if (data?.banners) {
            replaceGeneratedImages(data.banners.map((b: any) => ({
              id: b.storagePath,
              imageUrl: b.imageUrl,
              prompt: b.headline,
              label: b.languageName
            })));
          }
          break;

        case 'optimize-prompt':
          if (!prompt.trim()) {
            toast.error('プロンプトを入力してください');
            setIsGenerating(false);
            return;
          }
          ({ data, error } = await supabase.functions.invoke('optimize-prompt', {
            body: { 
              prompt, 
              brandId: currentBrand.id,
              style: selectedStyle,
              referenceImageUrl: referenceImage?.url,
            }
          }));
          if (data?.optimized_prompt) {
            toast.success('プロンプトを最適化しました');
            setPrompt(data.optimized_prompt);
            setOptimizedPromptResult(data.optimized_prompt);
            if (data.negative_prompt) {
              setNegativePrompt(data.negative_prompt);
            }
          }
          break;

        case 'campaign-image': {
          if (!prompt.trim() && !campaignTitle.trim()) {
            toast.error('ベースコンセプトまたはタイトルを入力してください');
            setIsGenerating(false);
            return;
          }
          const ratio = aspectRatios.find(r => r.id === selectedRatio) || aspectRatios[0];
          const campaignParts = [
            campaignTitle && `Headline: ${campaignTitle}`,
            campaignSubheadline && `Subheadline: ${campaignSubheadline}`,
            campaignDiscount && `Discount: ${campaignDiscount}`,
            campaignPeriod && `Period: ${campaignPeriod}`,
            campaignCTA && `CTA: ${campaignCTA}`,
            campaignBrandColor && `Brand color: ${campaignBrandColor}`,
            `Typography area at ${campaignTextPosition}`,
          ].filter(Boolean).join(', ');

          const campaignPrompt = `${prompt || 'campaign visual'}, ${campaignParts}, readable typography, high contrast, balanced layout`;
          const campaignPromptWithMaterial = [
            campaignPrompt,
            ...materialPromptLines,
          ].filter(Boolean).join(', ');

          ({ data, error } = await supabase.functions.invoke('generate-image', {
            body: {
              ...baseBody,
              ...buildRemoteGenerationContext(selectedFeature, campaignPromptWithMaterial, selectedRatio),
              prompt: campaignPromptWithMaterial,
              negativePrompt,
              width: ratio.width,
              height: ratio.height,
              count: generateCount,
              campaignMeta: {
                title: campaignTitle,
                subheadline: campaignSubheadline,
                discount: campaignDiscount,
                period: campaignPeriod,
                cta: campaignCTA,
                brandColor: campaignBrandColor,
                textPosition: campaignTextPosition,
              },
            }
          }));
          if (data?.images) {
            prependGeneratedImages(data.images.map((image: any) => ({
              ...image,
              id: image.imageId || image.id || image.storagePath,
              jobId: image.jobId || data.jobId,
              imageId: image.imageId || data.imageId,
              storagePath: image.storagePath || data.storagePath,
            })));
          }
          break;
        }

        default:
          if (!prompt.trim()) {
            toast.error('プロンプトを入力してください');
            setIsGenerating(false);
            return;
          }
          let fullPrompt = prompt;
          if (selectedStyle) {
            const style = stylePresets.find(s => s.id === selectedStyle);
            if (style) {
              fullPrompt = `${prompt}, ${style.prompt}`;
            }
          }
          fullPrompt = [
            fullPrompt,
            ...materialPromptLines,
          ].filter(Boolean).join(', ');
          const ratio = aspectRatios.find(r => r.id === selectedRatio) || aspectRatios[0];
          ({ data, error } = await supabase.functions.invoke('generate-image', {
            body: {
              ...baseBody,
              ...buildRemoteGenerationContext(selectedFeature, fullPrompt, selectedRatio),
              prompt: fullPrompt,
              negativePrompt,
              width: ratio.width,
              height: ratio.height,
              count: generateCount,
            }
          }));
          if (data?.images) {
            prependGeneratedImages(data.images.map((image: any) => ({
              ...image,
              id: image.imageId || image.id || image.storagePath,
              jobId: image.jobId || data.jobId,
              imageId: image.imageId || data.imageId,
              storagePath: image.storagePath || data.storagePath,
            })));
          }
      }

      if (error) throw error;
      
      if (selectedFeature?.id !== 'optimize-prompt') {
        const promptToSave = prompt || productDescription || headline || campaignTitle;
        if (sourceReadback && selectedFeature && newGeneratedImages.length > 0) {
          const modelMatrixParams = selectedFeature.id === 'model-matrix'
            ? {
                bodyTypes: selectedBodyTypes,
                ageGroups: selectedAgeGroups,
                skinTone,
                hairStyle,
                modelCandidateLabel: modelCandidateLabel || undefined,
              }
            : undefined;
          const generatedPatternContext = selectedFeature.id === 'design-gacha'
            ? patternContext
            : null;
          newGeneratedImages.forEach((image, index) => {
            const intentPrompt = image.prompt || promptToSave || '';
            const generationIntent: GenerationIntent = {
              feature: selectedFeature.id,
              prompt: intentPrompt,
              href: buildGenerationIntentHref(
                selectedFeature.id,
                intentPrompt,
                selectedRatio,
                sourceReadback,
                modelMatrixParams,
                generatedPatternContext
              ),
              label: `${selectedFeature.name}で生成`,
              aspectRatio: selectedRatio,
              ...sourceReadback,
              ...modelMatrixParams,
              ...generateMaterialMetadata,
              ...(generatedPatternContext ?? {}),
            };

            saveWorkspaceArtifact({
              id: image.id ? `local-generated-${image.id}` : undefined,
              brandId: currentBrand.id,
              featureType: selectedFeature.id,
              title: image.label || selectedFeature.name,
              imageUrl: image.imageUrl,
              prompt: intentPrompt,
              metadata: {
                sourceWorkspace: sourceReadback.sourceWorkspace,
                workflowVersion: sourceReadback.workflowVersion,
                sourceLabel: sourceReadback.sourceLabel,
                sourceResumePath: sourceReadback.sourceResumePath,
                sourceMode: sourceReadback.sourceMode,
                ...(modelMatrixParams?.modelCandidateLabel ? { modelCandidateLabel: modelMatrixParams.modelCandidateLabel } : {}),
                generationIntent,
                ...generateMaterialMetadata,
                ...(generatedPatternContext ?? {}),
                generatedResultId: image.id,
                generatedResultLabel: image.label,
                ...(image.jobId ? { jobId: image.jobId } : {}),
                ...(image.imageId ? { imageId: image.imageId } : {}),
                ...(image.storagePath ? { storagePath: image.storagePath } : {}),
                generationIndex: index,
                ...(lightchainCompat ? { lightchainCompat } : {}),
              },
            });
          });
        }
        if (promptToSave) {
          addToHistory(promptToSave, selectedFeature?.name);
        }
        setShowSuccessCard(true);
        toast.success('生成が完了しました');
      }
    } catch (error: any) {
      debugLog('Generation failed', {
        selectedFeature: selectedFeature?.id,
        errorName: error?.name,
        hasContextBody: !!error?.context?.body,
      });
      
      // Try to get detailed error from response
      let errorMessage = error.message || '生成に失敗しました';
      
      // ネットワークエラーの場合
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = 'ネットワークエラーが発生しました。接続を確認してください。';
      }
      
      // タイムアウトの場合
      if (error.name === 'AbortError' || error.message?.includes('timeout')) {
        errorMessage = 'リクエストがタイムアウトしました。画像サイズを小さくして再試行してください。';
      }
      
      // Supabaseエラーの詳細を取得
      if (error.context?.body) {
        try {
          const body = JSON.parse(error.context.body);
          const bodyError = body.error;
          if (typeof bodyError === 'string') {
            errorMessage = bodyError;
          } else if (bodyError && typeof bodyError === 'object') {
            errorMessage = bodyError.message || bodyError.details || body.details || errorMessage;
          } else {
            errorMessage = body.details || body.message || errorMessage;
          }
        } catch {}
      }
      
      // FunctionsFetchError の場合
      if (error.__isStorageError || error.message?.includes('FunctionsFetchError')) {
        errorMessage = 'サーバーへの接続に失敗しました。しばらく待ってから再試行してください。';
      }
      
      const friendlyMessage = getErrorMessage({ ...error, message: errorMessage });
      setGenerationError(friendlyMessage);
      toast.error(friendlyMessage);
    } finally {
      debugLog('Generation finished');
      setIsGenerating(false);
    }
  };

  const handleLocalRunwayImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!currentBrand) {
      toast.error('ブランドを選択してください');
      return;
    }

    setIsImportingLocalRunway(true);
    setGenerationError('');
    try {
      const bundle = parseLocalRunwayMcpImportBundle(JSON.parse(await file.text()));
      const importedAt = new Date().toISOString();
      const featureType = selectedFeature?.id ?? bundle.featureType ?? 'campaign-image';
      const importedResults: GeneratedResult[] = [];

      for (const [index, image] of bundle.images.entries()) {
        const artifactId = image.id ? `runway-local-${image.id}` : `runway-local-${Date.now()}-${index + 1}`;
        const title = image.title || `Runway MCP local image ${index + 1}`;
        const promptText = image.prompt ?? prompt.trim() ?? '';
        await saveWorkspaceArtifactBestEffort({
          id: artifactId,
          brandId: currentBrand.id,
          featureType: image.featureType ?? featureType,
          title,
          imageUrl: image.imageUrl,
          prompt: promptText,
          createdAt: importedAt,
          metadata: {
            ...bundle.source,
            ...image.metadata,
            artifactKind: 'runway_local_image',
            localRunwayMcpWorker: true,
            noHostedBridge: true,
            importedFromBundleSchema: bundle.schema,
            importedBundleCreatedAt: bundle.createdAt ?? null,
            importedBundleBrandId: bundle.brandId ?? null,
            importedFileName: file.name,
            importIndex: index,
            selectedFeatureId: selectedFeature?.id ?? null,
          },
        });
        importedResults.push({
          id: artifactId,
          imageUrl: image.imageUrl,
          prompt: promptText,
          label: title,
          artifactKind: 'image',
        });
      }

      setGeneratedImages((prev) => [...importedResults, ...prev]);
      setShowSuccessCard(true);
      toast.success(`${importedResults.length}件のローカルRunway成果物を取り込みました`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ローカルRunway成果物の取り込みに失敗しました';
      setGenerationError(message);
      toast.error(message);
    } finally {
      setIsImportingLocalRunway(false);
    }
  };

  const handleDownload = async (imageUrl: string, filename: string = 'generated-image.png') => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('ダウンロードしました');
    } catch {
      toast.error('ダウンロードに失敗しました');
    }
  };

  const handleBulkDownload = async () => {
    if (!currentBrand || generatedImages.length === 0) return;
    if (noImageGenerationMode || generatedImages.every((image) => image.artifactKind === 'planning_brief' || image.imageUrl.startsWith('data:'))) {
      generatedImages.forEach((image, index) => {
        const fallbackExtension = image.artifactKind === 'planning_brief' ? 'svg' : 'png';
        const extension = getDataUrlExtension(image.imageUrl, fallbackExtension);
        void handleDownload(image.imageUrl, `${image.label || `workspace-artifact-${index + 1}`}.${extension}`);
      });
      toast.success(`${generatedImages.length}件の保存済み成果物をダウンロードします`);
      return;
    }
    const imageIds = generatedImages.map(img => img.id).filter(Boolean);
    if (imageIds.length === 0) {
      toast.error('ダウンロード可能な画像IDがありません');
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke('bulk-download', {
        body: { brandId: currentBrand.id, imageIds }
      });
      if (error || !data?.downloadUrl) {
        throw new Error(error?.message || '一括ダウンロードに失敗しました');
      }
      window.open(data.downloadUrl, '_blank');
      toast.success(`${imageIds.length}件をまとめてダウンロードします`);
    } catch (e: any) {
      debugLog('Bulk download failed', { hasMessage: !!e?.message });
      toast.error(e.message || '一括ダウンロードに失敗しました');
    }
  };

  const handleSendGeneratedImageToCanvas = (image: GeneratedResult, index: number) => {
    const featureConfig = selectedFeature ? FEATURE_CONFIG[selectedFeature.id] : null;
    const effectiveReferenceType = referenceImage?.referenceType ?? featureConfig?.defaultReferenceType ?? 'base';
    const { generateMaterialMetadata } = buildGenerateMaterialContext(
      materialReference.imageUrl,
      effectiveReferenceType,
    );
    const materialHandoffMetadata = {
      ...generateMaterialMetadata,
      ...(image.materialReferences ? { materialReferences: image.materialReferences } : {}),
      ...(image.layerPlan ? { layerPlan: image.layerPlan } : {}),
      ...(image.maskPlan ? { maskPlan: image.maskPlan } : {}),
      ...(image.compositionPreview ? { compositionPreview: image.compositionPreview } : {}),
    };
    const payload = {
      source: 'generate-results',
      createdAt: new Date().toISOString(),
      images: [{
        imageUrl: image.imageUrl,
        label: image.label || `生成結果 ${index + 1}`,
        prompt: image.prompt,
        feature: selectedFeature?.id || 'generate-image',
        resultId: image.id,
        jobId: image.jobId,
        imageId: image.imageId,
        storagePath: image.storagePath,
        artifactKind: image.artifactKind,
        ...materialHandoffMetadata,
      }],
    };
    sessionStorage.setItem(GENERATED_CANVAS_HANDOFF_KEY, JSON.stringify(payload));
    navigate('/canvas/new?handoff=generated');
  };

  // Render generation count selector
  const renderCountSelector = (label: string = '生成数', min: number = 1, max: number = 8) => (
    <div className="mb-4">
      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setGenerateCount(Math.max(min, generateCount - 1))}
          disabled={generateCount <= min}
          className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50"
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="w-12 text-center font-semibold text-lg">{generateCount}</span>
        <button
          onClick={() => setGenerateCount(Math.min(max, generateCount + 1))}
          disabled={generateCount >= max}
          className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
        </button>
        <span className="text-sm text-neutral-500">{noImageGenerationMode ? '件' : '枚'}</span>
      </div>
    </div>
  );

  const renderAspectRatioSelector = (label: string = 'アスペクト比') => (
    <div>
      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">{label}</label>
      <div className="flex flex-wrap gap-2">
        {aspectRatios.map((ratio) => (
          <button
            key={ratio.id}
            type="button"
            aria-pressed={selectedRatio === ratio.id}
            onClick={() => setSelectedRatio(ratio.id)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
              selectedRatio === ratio.id
                ? 'bg-primary-100 border-primary-300 text-primary-700'
                : 'border-neutral-200 hover:border-neutral-300'
            }`}
          >
            <div className="flex flex-col items-start leading-tight">
              <span>{ratio.name}</span>
              {ratio.usage && (
                <span className="text-[11px] text-neutral-500">{ratio.usage}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  const renderTextOverlayControls = () => (
    <div className="space-y-3 p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-200/60 dark:border-neutral-700/60">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">画像内テキスト</p>
          <p className="text-xs text-neutral-500">言語・位置・色を指定して生成時に文字を入れます</p>
        </div>
        <button
          onClick={() => setOverlayEnabled(!overlayEnabled)}
          className={`px-3 py-1.5 text-sm rounded-lg border ${
            overlayEnabled
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
              : 'border-neutral-300 dark:border-neutral-600 text-neutral-600'
          }`}
        >
          {overlayEnabled ? '有効' : '無効'}
        </button>
      </div>

      {overlayEnabled && (
        <div className="space-y-3">
          <Textarea
            label="テキスト内容"
            placeholder="例: SUMMER SALE 50% OFF / 8.1-8.10"
            value={overlayText}
            onChange={(e) => setOverlayText(e.target.value)}
            rows={2}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-600 dark:text-neutral-400 mb-1">言語</label>
              <select
                value={overlayLanguage}
                onChange={(e) => setOverlayLanguage(e.target.value as any)}
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
              >
                <option value="ja">日本語</option>
                <option value="en">English</option>
                <option value="zh">中文</option>
                <option value="ko">한국어</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-600 dark:text-neutral-400 mb-1">位置</label>
              <div className="flex gap-2">
                {(['top', 'center', 'bottom'] as const).map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setOverlayPosition(pos)}
                    className={`flex-1 py-2 rounded-lg border text-sm ${
                      overlayPosition === pos
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-700'
                    }`}
                  >
                    {pos === 'top' ? '上' : pos === 'center' ? '中央' : '下'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="フォント名"
              placeholder="例: Noto Sans, Inter"
              value={overlayFont}
              onChange={(e) => setOverlayFont(e.target.value)}
            />
            <div className="grid grid-cols-[auto,1fr] items-center gap-2">
              <label className="text-sm text-neutral-600 dark:text-neutral-400">文字色</label>
              <input
                type="color"
                className="h-10 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent"
                value={overlayColor}
                onChange={(e) => setOverlayColor(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3 items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">縁取り色</span>
              <input
                type="color"
                className="h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent"
                value={overlayStrokeColor}
                onChange={(e) => setOverlayStrokeColor(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">太さ</span>
              <input
                type="range"
                min={0}
                max={8}
                value={overlayStrokeWidth}
                onChange={(e) => setOverlayStrokeWidth(Number(e.target.value))}
              />
              <span className="text-sm text-neutral-600 dark:text-neutral-400 w-8 text-right">{overlayStrokeWidth}px</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderFeatureForm = () => {
    if (!selectedFeature) return null;

    const config = FEATURE_CONFIG[selectedFeature.id];

    switch (selectedFeature.id) {
      // === IMAGE REQUIRED FEATURES ===
      
      case 'remove-bg':
        return (
          <div className="space-y-4">
            <ImageSelector
              label={config?.referenceLabel || '対象画像'}
              required
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base']}
              defaultReferenceType="base"
              hint={config?.referenceHint}
            />
            
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                新しい背景
              </label>
              <div className="grid grid-cols-4 gap-2">
                {backgroundOptions.map((bg) => (
                  <button
                    key={bg.id}
                    onClick={() => setSelectedBackground(bg.id)}
                    className={`px-3 py-2 text-sm rounded-lg border-2 transition-all ${
                      selectedBackground === bg.id
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {bg.name}
                  </button>
                ))}
              </div>
              
              {selectedBackground === 'custom' && (
                <Input
                  className="mt-3"
                  placeholder="カスタム背景の説明（例: 海辺のビーチ）"
                  value={customBackground}
                  onChange={(e) => setCustomBackground(e.target.value)}
                />
              )}

              {selectedBackground === 'reference' && (
                <div className="mt-3">
                  <ImageSelector
                    label="背景参考画像"
                    value={backgroundReferenceImage}
                    onChange={setBackgroundReferenceImage}
                    allowedReferenceTypes={['base']}
                    defaultReferenceType="base"
                    hint="この画像を背景として合成します"
                  />
                </div>
              )}
            </div>
          </div>
        );

      case 'colorize':
        return (
          <div className="space-y-4">
            <ImageSelector
              label={config?.referenceLabel || '対象画像'}
              required
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base']}
              defaultReferenceType="base"
              hint={config?.referenceHint}
            />
            
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                生成するカラー（複数選択可）
              </label>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color.id}
                    onClick={() => {
                      setSelectedColors(prev => 
                        prev.includes(color.id)
                          ? prev.filter(c => c !== color.id)
                          : [...prev, color.id]
                      );
                    }}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                      selectedColors.includes(color.id)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <div 
                      className="w-8 h-8 rounded-full border border-neutral-200"
                      style={{ backgroundColor: color.color }}
                    />
                    <span className="text-xs text-neutral-600 dark:text-neutral-400">{color.name}</span>
                  </button>
                ))}
                {/* Custom color */}
                <button
                  onClick={() => {
                    setSelectedColors(prev => 
                      prev.includes('custom')
                        ? prev.filter(c => c !== 'custom')
                        : [...prev, 'custom']
                    );
                  }}
                  className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                    selectedColors.includes('custom')
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                      : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                  }`}
                >
                  <input
                    type="color"
                    value={customColor}
                    onChange={(e) => setCustomColor(e.target.value)}
                    className="w-8 h-8 rounded-full cursor-pointer"
                  />
                  <span className="text-xs text-neutral-600 dark:text-neutral-400">カスタム</span>
                </button>
              </div>
              <p className="text-xs text-neutral-500 mt-2">
                {selectedColors.length}色選択中
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                パターン/柄
              </label>
              <div className="grid grid-cols-5 gap-2">
                {patternOptions.map((pattern) => (
                  <button
                    key={pattern.id}
                    onClick={() => setSelectedPattern(pattern.id)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                      selectedPattern === pattern.id
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <span className="text-xl">{pattern.icon}</span>
                    <span className="text-xs text-neutral-600 dark:text-neutral-400">{pattern.name}</span>
                  </button>
                ))}
              </div>

              {selectedPattern === 'custom' && (
                <div className="mt-3">
                  <ImageSelector
                    label="パターン参考画像"
                    value={patternReferenceImage}
                    onChange={setPatternReferenceImage}
                    allowedReferenceTypes={['pattern']}
                    defaultReferenceType="pattern"
                    hint="この柄・テクスチャを適用します"
                  />
                </div>
              )}
            </div>

            {renderCountSelector('生成数', 1, 12)}
          </div>
        );

      case 'upscale':
        return (
          <div className="space-y-4">
            <ImageSelector
              label={config?.referenceLabel || '対象画像'}
              required
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base']}
              defaultReferenceType="base"
              hint={config?.referenceHint}
            />
            
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                アップスケール倍率
              </label>
              <div className="flex gap-3">
                {([2, 4] as const).map((scale) => (
                  <button
                    key={scale}
                    onClick={() => setUpscaleScale(scale)}
                    className={`flex-1 py-4 rounded-xl border-2 transition-all ${
                      upscaleScale === scale
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <div className="text-2xl font-bold text-neutral-800 dark:text-white">{scale}x</div>
                    <div className="text-sm text-neutral-500 dark:text-neutral-400">
                      {scale === 2 ? '2048×2048' : '4096×4096'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                <Sliders className="w-4 h-4 inline mr-1" />
                品質オプション
              </label>
              <div className="space-y-3 p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-neutral-600 dark:text-neutral-400">ノイズ除去</span>
                    <span className="text-neutral-800 dark:text-neutral-200">{denoiseLevel === 'low' ? '弱' : denoiseLevel === 'medium' ? '中' : '強'}</span>
                  </div>
                  <div className="flex gap-2">
                    {(['low', 'medium', 'high'] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => setDenoiseLevel(level)}
                        className={`flex-1 py-1.5 text-xs rounded-lg transition-all ${
                          denoiseLevel === level
                            ? 'bg-primary-500 text-white'
                            : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        {level === 'low' ? '弱' : level === 'medium' ? '中' : '強'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-neutral-600 dark:text-neutral-400">シャープネス</span>
                    <span className="text-neutral-800 dark:text-neutral-200">{sharpness}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sharpness}
                    onChange={(e) => setSharpness(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case 'variations':
        return (
          <div className="space-y-4">
            <ImageSelector
              label={config?.referenceLabel || '元画像'}
              required
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base']}
              defaultReferenceType="base"
              hint={config?.referenceHint}
            />
            
            {renderCountSelector('生成数', 2, 8)}

            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">類似度</span>
                <span className="text-neutral-500">{variationStrength}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="90"
                value={variationStrength}
                onChange={(e) => setVariationStrength(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-neutral-500 mt-1">
                <span>大きく変化</span>
                <span>ほぼ同じ</span>
              </div>
            </div>
            
            <Textarea
              label="追加の指示（任意）"
              placeholder="例: 色味を少し明るくして、背景をぼかして"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
            />
          </div>
        );

      case 'scene-coordinate':
        return (
          <div className="space-y-4">
            <ImageSelector
              label="商品画像"
              required
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={['base']}
              defaultReferenceType="base"
              hint="この商品を様々なシーンに配置します"
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                シーン選択（複数選択可）
              </label>
              <div className="grid grid-cols-3 gap-2">
                {sceneOptions.map((scene) => (
                  <button
                    key={scene.id}
                    onClick={() => {
                      setSelectedScenes(prev =>
                        prev.includes(scene.id)
                          ? prev.filter(s => s !== scene.id)
                          : [...prev, scene.id]
                      );
                    }}
                    className={`px-3 py-2 text-sm rounded-lg border-2 transition-all ${
                      selectedScenes.includes(scene.id)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {scene.name}
                  </button>
                ))}
              </div>
              <p className="text-xs text-neutral-500 mt-2">
                {selectedScenes.length}シーンの設計を保存します
              </p>
            </div>
          </div>
        );

      // === TEXT-TO-IMAGE FEATURES WITH OPTIONAL REFERENCE ===

      case 'campaign-image':
        return (
          <div className="space-y-4">
            <Textarea
              label="ベースコンセプト"
              placeholder="例: 夏のサマーセール告知、爽やかな海辺の雰囲気"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="タイトル"
                placeholder="例: SUMMER SALE"
                value={campaignTitle}
                onChange={(e) => setCampaignTitle(e.target.value)}
              />
              <Input
                label="サブコピー"
                placeholder="例: 最大50% OFF / 8.1-8.10"
                value={campaignSubheadline}
                onChange={(e) => setCampaignSubheadline(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="割引率"
                placeholder="例: 50% OFF"
                value={campaignDiscount}
                onChange={(e) => setCampaignDiscount(e.target.value)}
              />
              <Input
                label="期間"
                placeholder="例: 8/1 - 8/10"
                value={campaignPeriod}
                onChange={(e) => setCampaignPeriod(e.target.value)}
              />
              <Input
                label="CTA"
                placeholder="例: 今すぐ見る"
                value={campaignCTA}
                onChange={(e) => setCampaignCTA(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid grid-cols-[auto,1fr] items-center gap-2">
                <label className="text-sm text-neutral-600 dark:text-neutral-400">ブランドカラー</label>
                <input
                  type="color"
                  className="h-10 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent"
                  value={campaignBrandColor}
                  onChange={(e) => setCampaignBrandColor(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-700 dark:text-neutral-300 mb-2">テキスト位置</label>
                <div className="flex gap-2">
                  {(['top', 'center', 'bottom'] as const).map(pos => (
                    <button
                      key={pos}
                    onClick={() => {
                      setCampaignTextPosition(pos);
                      setOverlayPosition(pos);
                    }}
                      className={`flex-1 py-2 rounded-lg border text-sm ${
                        campaignTextPosition === pos
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                          : 'border-neutral-200 dark:border-neutral-700'
                      }`}
                    >
                      {pos === 'top' ? '上' : pos === 'center' ? '中央' : '下'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {renderAspectRatioSelector('アスペクト比（用途ラベル付き）')}
            {renderTextOverlayControls()}
            {renderCountSelector('生成数', 1, 6)}
          </div>
        );

      case 'design-gacha':
        return (
          <div className="space-y-4">
            <Textarea
              label="ブリーフ（商品コンセプト）"
              placeholder="例: 20代女性向けのカジュアルなサマードレス"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">固定する要素</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'logo', label: 'ロゴ/ブランド' },
                    { id: 'text', label: 'テキスト' },
                    { id: 'product', label: '商品/構図' },
                  ].map(item => (
                    <button
                      key={item.id}
                      onClick={() => setFixedElements(prev => prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id])}
                      className={`px-3 py-1.5 rounded-lg border text-sm ${
                        fixedElements.includes(item.id)
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                          : 'border-neutral-200 dark:border-neutral-700'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">ランダム化する要素</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'color', label: '色/配色' },
                    { id: 'layout', label: 'レイアウト' },
                    { id: 'texture', label: '質感/背景' },
                  ].map(item => (
                    <button
                      key={item.id}
                      onClick={() => setRandomizedElements(prev => prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id])}
                      className={`px-3 py-1.5 rounded-lg border text-sm ${
                        randomizedElements.includes(item.id)
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                          : 'border-neutral-200 dark:border-neutral-700'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <ImageSelector
              label={config?.referenceLabel || '参考画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['style', 'base']}
              defaultReferenceType={config?.defaultReferenceType || 'style'}
              hint={config?.referenceHint}
            />

            {renderCountSelector('スタイル数', 2, 8)}
            {renderTextOverlayControls()}

            <div className="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-4">
              <p className="text-sm text-primary-800 dark:text-primary-200">
                {generateCount}つのスタイル方向（ミニマル、ラグジュアリー、ストリート等）を企画書にします
              </p>
            </div>
          </div>
        );

      case 'product-shots':
        return (
          <div className="space-y-4">
            <Textarea
              label="商品説明"
              placeholder="例: 白いコットンTシャツ、クルーネック、シンプルなデザイン"
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={3}
            />

            <ImageSelector
              label={config?.referenceLabel || '実物商品画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['base', 'style']}
              defaultReferenceType={config?.defaultReferenceType || 'base'}
              hint={config?.referenceHint}
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                生成するカット
              </label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { id: 'front', label: '正面' },
                  { id: 'side', label: '側面' },
                  { id: 'back', label: '背面' },
                  { id: 'detail', label: 'ディテール' },
                ].map(shot => (
                  <button
                    key={shot.id}
                    type="button"
                    aria-pressed={selectedShots.includes(shot.id)}
                    onClick={() => {
                      setSelectedShots(prev => {
                        const next = prev.includes(shot.id)
                          ? prev.filter(s => s !== shot.id)
                          : [...prev, shot.id];
                        setGenerateCount(Math.max(1, Math.min(4, next.length)));
                        return next;
                      });
                    }}
                    className={`px-3 py-1.5 text-sm rounded-lg border-2 transition-all ${
                      selectedShots.includes(shot.id)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {shot.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-neutral-500 mt-1">{selectedShots.length}カット選択中</p>
            </div>

            {renderCountSelector(noImageGenerationMode ? '保存件数上限' : '生成枚数上限', 1, 4)}

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                背景
              </label>
              <div className="flex gap-2 flex-wrap">
                {['white', 'studio', 'transparent'].map((bg) => (
                  <button
                    key={bg}
                    onClick={() => setSelectedBackground(bg)}
                    className={`px-4 py-2 text-sm rounded-lg border-2 transition-all ${
                      selectedBackground === bg
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {backgroundOptions.find(b => b.id === bg)?.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                正面・側面・背面・ディテールの{generateCount}カット設計を保存します
              </p>
            </div>
          </div>
        );

      case 'model-matrix':
        return (
          <div className="space-y-4">
            <Textarea
              label="商品説明"
              placeholder="例: ネイビーのスリムフィットジーンズ"
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={3}
            />

            <ImageSelector
              label={config?.referenceLabel || '商品画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['base', 'style']}
              defaultReferenceType={config?.defaultReferenceType || 'base'}
              hint={config?.referenceHint}
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">体型</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { id: 'slim', name: 'スリム' },
                  { id: 'regular', name: 'レギュラー' },
                  { id: 'plus', name: 'プラス' }
                ].map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setSelectedBodyTypes(prev =>
                      prev.includes(type.id) ? prev.filter(t => t !== type.id) : [...prev, type.id]
                    )}
                    className={`px-4 py-2 rounded-lg border-2 transition-all ${
                      selectedBodyTypes.includes(type.id)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {type.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">年代</label>
              <div className="flex gap-2 flex-wrap">
                {['20s', '30s', '40s', '50s'].map((age) => (
                  <button
                    key={age}
                    onClick={() => setSelectedAgeGroups(prev =>
                      prev.includes(age) ? prev.filter(a => a !== age) : [...prev, age]
                    )}
                    className={`px-4 py-2 rounded-lg border-2 transition-all ${
                      selectedAgeGroups.includes(age)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {age}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              モデル詳細オプション
            </button>

            {showAdvanced && (
              <div className="space-y-3 p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl">
                <div>
                  <label className="block text-xs text-neutral-600 dark:text-neutral-400 mb-1">肌トーン</label>
                  <div className="flex gap-2">
                    {(['light', 'medium', 'dark'] as const).map((tone) => (
                      <button
                        key={tone}
                        onClick={() => setSkinTone(tone)}
                        className={`flex-1 py-1.5 text-xs rounded-lg transition-all ${
                          skinTone === tone
                            ? 'bg-primary-500 text-white'
                            : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        {tone === 'light' ? '明るめ' : tone === 'medium' ? '中間' : '暗め'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-neutral-600 dark:text-neutral-400 mb-1">髪の長さ</label>
                  <div className="flex gap-2">
                    {(['short', 'medium', 'long'] as const).map((style) => (
                      <button
                        key={style}
                        onClick={() => setHairStyle(style)}
                        className={`flex-1 py-1.5 text-xs rounded-lg transition-all ${
                          hairStyle === style
                            ? 'bg-primary-500 text-white'
                            : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400'
                        }`}
                      >
                        {style === 'short' ? 'ショート' : style === 'medium' ? 'ミディアム' : 'ロング'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {selectedBodyTypes.length * selectedAgeGroups.length}パターンの着用設計を保存します
                {selectedBodyTypes.length * selectedAgeGroups.length > 6 && '（生成に時間がかかる場合があります）'}
              </p>
            </div>
          </div>
        );

      case 'multilingual-banner':
        return (
          <div className="space-y-4">
            <Input
              label="ヘッドライン"
              placeholder="例: SUMMER SALE"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
            <Input
              label="サブヘッドライン（任意）"
              placeholder="例: 最大50%OFF"
              value={subheadline}
              onChange={(e) => setSubheadline(e.target.value)}
            />

            <ImageSelector
              label={config?.referenceLabel || 'ベース画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['base', 'style']}
              defaultReferenceType={config?.defaultReferenceType || 'base'}
              hint={config?.referenceHint}
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">言語</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { code: 'ja', name: '日本語' },
                  { code: 'en', name: 'English' },
                  { code: 'zh', name: '中文' },
                  { code: 'ko', name: '한국어' }
                ].map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    aria-pressed={selectedLanguages.includes(lang.code)}
                    onClick={() => setSelectedLanguages(prev =>
                      prev.includes(lang.code) ? prev.filter(l => l !== lang.code) : [...prev, lang.code]
                    )}
                    className={`px-4 py-2 rounded-lg border-2 transition-all ${
                      selectedLanguages.includes(lang.code)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700'
                        : 'border-neutral-200 dark:border-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {lang.name}
                  </button>
                ))}
              </div>
            </div>

            {renderAspectRatioSelector('サイズ')}
            {renderTextOverlayControls()}
          </div>
        );

      case 'optimize-prompt':
        return (
          <div className="space-y-4">
            <Textarea
              label="日本語プロンプト"
              placeholder="例: 白いTシャツを着たモデル、スタジオ撮影"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />

            <ImageSelector
              label={config?.referenceLabel || '参考画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['style']}
              defaultReferenceType={config?.defaultReferenceType || 'style'}
              hint={config?.referenceHint}
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">スタイル</label>
              <div className="flex flex-wrap gap-2">
                {stylePresets.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setSelectedStyle(selectedStyle === style.id ? null : style.id)}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
                      selectedStyle === style.id
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {style.name}
                    {style.description && (
                      <span className="block text-[11px] text-neutral-500">{style.description}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                ✨ 日本語プロンプトを英語に翻訳し、AI画像生成に最適化します
              </p>
            </div>
          </div>
        );

      case 'chat-edit':
        return (
          <div className="space-y-4">
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-6 text-center">
              <Wand2 className="w-12 h-12 text-purple-500 mx-auto mb-3" />
              <h3 className="font-semibold text-neutral-800 dark:text-white mb-2">
                チャットベース編集
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-4">
                対話形式で画像を編集できます。キャンバスエディターでお使いください。
              </p>
              <Link to="/canvas">
                <Button>
                  キャンバスを開く
                  <ExternalLink className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        );

      // === DEFAULT TEXT-TO-IMAGE ===
      default:
        return (
          <div className="space-y-4">
            <Textarea
              label="プロンプト"
              placeholder="作りたい企画や画像指示を日本語で説明してください"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
            />

            <ImageSelector
              label={config?.referenceLabel || '参考画像（任意）'}
              value={referenceImage}
              onChange={setReferenceImage}
              allowedReferenceTypes={config?.allowedReferenceTypes || ['style', 'composition']}
              defaultReferenceType={config?.defaultReferenceType || 'style'}
              hint={config?.referenceHint}
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">スタイルプリセット</label>
              <div className="flex flex-wrap gap-2">
                {stylePresets.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setSelectedStyle(selectedStyle === style.id ? null : style.id)}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-all ${
                      selectedStyle === style.id
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {style.name}
                    {style.description && (
                      <span className="block text-[11px] text-neutral-500">{style.description}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {renderAspectRatioSelector()}
            {renderTextOverlayControls()}

            {renderCountSelector('生成数', 1, 4)}

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              詳細オプション
            </button>
            {showAdvanced && (
              <Textarea
                label="ネガティブプロンプト"
                placeholder="生成したくない要素"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={2}
              />
            )}
          </div>
        );
    }
  };

  const runwayStatus = runwayApproval?.status || 'not_requested';
  const runwayApproved = runwayStatus === 'approved';
  const runwayBridgeConfigured = runwayOAuthConnection?.bridgeConfigured === true;
  const selectedFeatureUsesRunwayMcp = Boolean(selectedFeature && selectedFeature.id !== 'optimize-prompt' && selectedFeature.id !== 'chat-edit');
  const runwayReadyInApp = runwayApproved && runwayBridgeConfigured;
  const runwayReadinessIssues = getRunwayReadinessIssues({
    approved: runwayApproved,
    bridgeConfigured: runwayBridgeConfigured,
  });
  const runwayPlanLabel = getRunwayPlanLabel(runwaySubscription);
  const runwayPeriodEnd = runwaySubscription?.current_period_end
    ? new Date(runwaySubscription.current_period_end).toLocaleDateString('ja-JP')
    : null;
  const generationReadyInApp = noImageGenerationMode || runwayReadyInApp;
  const runwayReadinessText = noImageGenerationMode
    ? localRunwayWorkerMode
      ? 'Mac側ローカルRunway workerで実生成します。Hosted bridgeは使いません'
      : '画像生成はオフです。Runway接続なしで企画書を保存できます'
    : runwayReadyInApp
    ? 'サイト側の生成条件は満たしています'
    : runwayReadinessIssues.join(' / ');
  const isGenerateDisabled = (() => {
    if (!selectedFeature) return true;
    if (isGenerating) return true;
    if (!noImageGenerationMode && selectedFeatureUsesRunwayMcp && !runwayReadyInApp) return true;
    if (featureConfig?.requiresImage && !referenceImage) return true;
    switch (selectedFeature.id) {
      case 'design-gacha':
        return !prompt.trim() && !referenceImage;
      case 'campaign-image':
        return !prompt.trim() && !campaignTitle.trim();
      case 'multilingual-banner':
        return !headline.trim();
      case 'optimize-prompt':
        return !prompt.trim();
      case 'product-shots':
        return !productDescription.trim() && !referenceImage;
      case 'model-matrix':
        return !productDescription.trim() && !referenceImage;
      default:
        if (selectedFeature.id === 'chat-edit') return false;
        if (!featureConfig?.requiresImage && !prompt.trim()) return true;
        return false;
    }
  })();

  const renderLocalRunwayImportControl = () => (
    <div className="mt-4 flex flex-col gap-2 rounded-xl bg-white/75 p-3 dark:bg-neutral-900/70 sm:flex-row sm:items-center sm:justify-between">
      <input
        ref={localRunwayImportInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={handleLocalRunwayImportFile}
      />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-neutral-800 dark:text-white">
          ローカルRunway MCP成果物
        </p>
        <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          Etsy/NisenPrints方式のimport bundleをWorkspaceへ保存します。
        </p>
      </div>
      <button
        type="button"
        onClick={() => localRunwayImportInputRef.current?.click()}
        disabled={!currentBrand || isImportingLocalRunway}
        className="inline-flex w-fit items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:border-primary-300 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
      >
        {isImportingLocalRunway ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
        JSONを読み込む
      </button>
    </div>
  );

  const handleGenerateMaterialChange = (nextState: MaterialReferenceState) => {
    setMaterialReference(nextState);
    if (nextState.imageUrl && nextState.imageUrl !== materialReference.imageUrl) {
      setReferenceImage({
        url: nextState.imageUrl,
        referenceType: featureConfig?.defaultReferenceType ?? 'base',
      });
    }
  };

  // Feature selection view
  if (!selectedFeature) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8"
      >
        <div className="mb-4 sm:mb-6 lg:mb-8">
          <h1 className="text-lg sm:text-xl lg:text-2xl font-display font-semibold text-neutral-900 dark:text-white mb-1 sm:mb-2">
            生成ワークスペース
          </h1>
          <p className="text-sm sm:text-base text-neutral-600 dark:text-neutral-400">
            Lightchain と同じように、作りたいものから生成機能へ進めます
          </p>
        </div>

        <UsageStats className="mb-4 sm:mb-6 lg:mb-8" />

        <section className={`mb-6 rounded-2xl border p-4 shadow-soft lg:mb-8 ${
          generationReadyInApp
              ? 'border-green-200 bg-green-50/80 dark:border-green-800 dark:bg-green-950/20'
            : 'border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/20'
        }`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
                {generationReadyInApp ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-amber-500" />}
                Runway生成前チェック
              </div>
              <p className={`mt-1 text-sm ${generationReadyInApp ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                {runwayReadinessText}
              </p>
            </div>
            <Link
              to="/brand/settings"
              className="inline-flex w-fit items-center gap-2 rounded-xl border border-white/70 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:border-primary-300 hover:text-primary-700 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
            >
              ブランド設定を開く
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-xl bg-white/75 p-3 dark:bg-neutral-900/70">
              <div className="flex items-center gap-2 font-semibold text-neutral-800 dark:text-white">
                <KeyRound className="h-4 w-4" />
                接続承認
              </div>
              <p className="mt-1 text-neutral-500 dark:text-neutral-400">
                {RUNWAY_APPROVAL_LABELS[runwayStatus]}
              </p>
            </div>
            <div className="rounded-xl bg-white/75 p-3 dark:bg-neutral-900/70">
              <div className="flex items-center gap-2 font-semibold text-neutral-800 dark:text-white">
                <CreditCard className="h-4 w-4" />
                利用量管理
              </div>
              <p className="mt-1 text-neutral-500 dark:text-neutral-400">
                {runwayPlanLabel}{runwayPeriodEnd ? ` / ${runwayPeriodEnd}まで` : ''}
              </p>
            </div>
            <div className="rounded-xl bg-white/75 p-3 dark:bg-neutral-900/70">
              <div className="flex items-center gap-2 font-semibold text-neutral-800 dark:text-white">
                {generationReadyInApp ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-amber-500" />}
                最終接続
              </div>
              <p className="mt-1 text-neutral-500 dark:text-neutral-400">
                {noImageGenerationMode ? '不要' : 'Hosted bridge'}
              </p>
            </div>
          </div>
          {renderLocalRunwayImportControl()}
        </section>

        <GenerateLightchainEntry />
      </motion.div>
    );
  }

  // Feature detail view
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
      <div className="grid xl:grid-cols-[400px,1fr] lg:grid-cols-1 gap-4 sm:gap-6 lg:gap-8">
        {/* Left Panel */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          <div>
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 mb-4 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              機能選択に戻る
            </button>
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-md ${
                featureConfig?.requiresImage 
                  ? 'bg-purple-100 dark:bg-purple-900/50' 
                  : 'bg-primary-100 dark:bg-primary-900/50'
              }`}>
                <selectedFeature.icon className={`w-6 h-6 ${
                  featureConfig?.requiresImage 
                    ? 'text-purple-600 dark:text-purple-400' 
                    : 'text-primary-600 dark:text-primary-400'
                }`} />
              </div>
              <div>
                <h1 className="text-xl font-display font-semibold text-neutral-900 dark:text-white">
                  {selectedFeature.name}
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {selectedFeature.description}
                </p>
              </div>
            </div>
          </div>

          {activeWorkflow && (
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-800/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                業務ワークフロー
              </p>
              <h2 className="mt-1 text-sm font-semibold text-neutral-900 dark:text-white">
                {activeWorkflow.title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                {activeWorkflow.description}
              </p>
              <ol className="mt-3 space-y-2">
                {activeWorkflow.steps.map((step, index) => (
                  <li key={`${step}-${index}`} className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-[11px] font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {sourceReadback && (
            <div className="rounded-xl border border-primary-200 bg-primary-50/80 p-4 dark:border-primary-800 dark:bg-primary-950/30">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
                ワークスペース再開
              </p>
              <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-white">
                {sourceReadback.sourceLabel} から受け取った内容で企画書を保存します
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
                {sourceReadback.workflowVersion} / {sourceReadback.sourceMode}
              </p>
              <Link
                to={sourceReadback.sourceResumePath}
                className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary-700 hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-200"
              >
                <ArrowLeft className="h-4 w-4" />
                {sourceReadback.sourceLabel}へ戻る
              </Link>
            </div>
          )}

          {lightchainCompat && (
            <div className="rounded-xl border border-teal-200 bg-teal-50/80 p-4 dark:border-teal-800 dark:bg-teal-950/30">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">
                Lightchain互換
              </p>
              <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-white">
                {lightchainCompat.lightchainFeatureTitle} として企画書を保存します
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
                {lightchainCompat.lightchainTaskCodes.join(' / ')}
              </p>
            </div>
          )}

          <UsageStats />

          <div className={`rounded-2xl border p-4 ${
            generationReadyInApp
              ? 'border-green-200 bg-green-50/80 dark:border-green-800 dark:bg-green-950/20'
              : 'border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/20'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                generationReadyInApp
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
              }`}>
                {generationReadyInApp ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                      Runway生成前チェック
                    </p>
                    <p className={`mt-1 text-sm ${generationReadyInApp ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                      {runwayReadinessText}
                    </p>
                  </div>
                  <Link
                    to="/brand/settings"
                    className="inline-flex w-fit items-center gap-2 rounded-xl border border-white/70 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:border-primary-300 hover:text-primary-700 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                  >
                    ブランド設定を開く
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>

                <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
                  <div className="rounded-xl bg-white/75 p-3 dark:bg-neutral-900/70">
                    <div className="flex items-center gap-2 font-semibold text-neutral-800 dark:text-white">
                      <KeyRound className="h-4 w-4" />
                      接続承認
                    </div>
                    <p className="mt-1 text-neutral-500 dark:text-neutral-400">
                      {RUNWAY_APPROVAL_LABELS[runwayStatus]}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/75 p-3 dark:bg-neutral-900/70">
                    <div className="flex items-center gap-2 font-semibold text-neutral-800 dark:text-white">
                      <CreditCard className="h-4 w-4" />
                      利用量管理
                    </div>
                    <p className="mt-1 text-neutral-500 dark:text-neutral-400">
                      {runwayPlanLabel}{runwayPeriodEnd ? ` / ${runwayPeriodEnd}まで` : ''}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/75 p-3 dark:bg-neutral-900/70">
                    <div className="flex items-center gap-2 font-semibold text-neutral-800 dark:text-white">
                      {generationReadyInApp ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-amber-500" />}
                      最終接続
                    </div>
                    <p className="mt-1 text-neutral-500 dark:text-neutral-400">
                      {noImageGenerationMode ? '不要' : 'Hosted bridge'}
                    </p>
                  </div>
                </div>
                {renderLocalRunwayImportControl()}
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-2xl dark:bg-neutral-800/50 dark:border-neutral-700/50">
            {/* Prompt History Button */}
            {!featureConfig?.requiresImage && selectedFeature.id !== 'chat-edit' && (
              <div className="flex justify-end mb-4">
                <button
                  onClick={() => setShowPromptHistory(true)}
                  className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
                >
                  <History className="w-4 h-4" />
                  履歴から選ぶ
                </button>
              </div>
            )}

            {selectedGenerateWorkbench && (
              <div className="mb-5">
                {supportsAssistantPlanning(selectedFeature.id) && (
                  <div className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white dark:bg-white dark:text-neutral-950">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                          AIアシスタント
                        </p>
                        <h3 className="mt-1 text-base font-semibold text-neutral-900 dark:text-white">
                          作りたい画像を一文で入力
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                          Lightchain と同じように、まず制作意図を伝えると、この機能に合わせた生成計画を確認しながら下の詳細設定に進めます。
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
                      <Textarea
                        label="生成リクエスト"
                        placeholder="商品画像をアップロードして、デザインのリクエストを教えてください"
                        value={assistantPrompt}
                        onChange={(event) => {
                          setAssistantPrompt(event.target.value);
                          setAssistantPlanConfirmed(false);
                        }}
                        rows={3}
                      />
                      <div className="flex items-end">
                        <Button
                          type="button"
                          onClick={applyAssistantPrompt}
                          className="w-full lg:w-auto"
                          leftIcon={<Sparkles className="h-4 w-4" />}
                        >
                          生成計画を作る
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-950">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-neutral-900 dark:text-white">生成計画</p>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          assistantPlanConfirmed
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200'
                        }`}>
                          {assistantPlanConfirmed ? '確認済み' : '未確認'}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-neutral-700 dark:text-neutral-300 md:grid-cols-3">
                        {assistantPlanItems.map((item, index) => (
                          <div key={`${item.title}-${index}`} className="rounded-lg bg-white p-3 dark:bg-neutral-900">
                            <p className="font-semibold text-neutral-900 dark:text-white">
                              {index + 1}. {item.title}
                            </p>
                            <p className="mt-1 text-xs leading-5">{item.description}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex justify-end">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={applyAssistantPlanToForm}
                          disabled={!assistantPlanConfirmed}
                        >
                          フォームへ反映
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                <MaterialWorkbench
                  title={selectedGenerateWorkbench.title}
                  description={selectedGenerateWorkbench.description}
                  uploadLabel={selectedGenerateWorkbench.uploadLabel}
                  emptyLabel={selectedGenerateWorkbench.emptyLabel}
                  state={materialReference}
                  onChange={handleGenerateMaterialChange}
                  materialKinds={selectedGenerateWorkbench.materialKinds}
                  layerOptions={selectedGenerateWorkbench.layerOptions}
                  placementOptions={selectedGenerateWorkbench.placementOptions}
                />
              </div>
            )}

            {renderFeatureForm()}

            {selectedFeature.id !== 'chat-edit' && (
              <Button
                onClick={handleGenerate}
                isLoading={isGenerating}
                disabled={isGenerateDisabled}
                className="w-full mt-6 shadow-glow hover:shadow-glow-lg transition-all duration-300"
                size="lg"
                leftIcon={isGenerating ? undefined : <Sparkles className="w-5 h-5" />}
              >
                {isGenerating ? '生成中...' : selectedFeature.id === 'optimize-prompt' ? '最適化' : localRunwayWorkerMode ? 'Runway workerで生成' : '企画書を保存'}
              </Button>
            )}
          </div>
        </motion.div>

        {/* Right Panel - Results */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-neutral-800 dark:text-white flex items-center gap-2">
              保存した企画
              {generatedImages.length > 0 && (
                <span className="text-xs font-normal text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">
                  {generatedImages.length}件
                </span>
              )}
            </h2>
            {generatedImages.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBulkDownload}
                  className="text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  一括DL
                </button>
                <button
                  onClick={() => {
                    setGeneratedImages([]);
                    setShowSuccessCard(false);
                  }}
                  className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className="w-4 h-4" />
                  クリア
                </button>
              </div>
            )}
          </div>

          {isGenerating && (
            <div className="glass-panel rounded-2xl p-12 text-center shadow-soft min-h-[400px] flex flex-col items-center justify-center">
              <div className="w-20 h-20 bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/50 dark:to-accent-900/50 rounded-2xl flex items-center justify-center mb-6 relative">
                <Loader2 className="w-10 h-10 text-primary-600 animate-spin relative z-10" />
                <div className="absolute inset-0 bg-primary-400/20 blur-xl animate-pulse-slow" />
              </div>
              <h3 className="text-xl font-medium text-neutral-700 dark:text-neutral-200 mb-2 font-display">
                生成しています...
              </h3>
              <p className="text-neutral-500 dark:text-neutral-400 max-w-xs mx-auto mb-8">
                入力内容からWorkspaceで使える企画書カードを保存しています。
              </p>
              <div className="w-64 h-1.5 bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-gradient-to-r from-primary-400 to-accent-400 rounded-full" 
                  initial={{ x: '-100%' }}
                  animate={{ x: '100%' }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                />
              </div>
            </div>
          )}

          {!isGenerating && generationError && (
            <div className="glass-panel rounded-2xl p-6 shadow-soft min-h-[220px] border border-red-200/70 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-red-100 dark:bg-red-900/50 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-red-600 dark:text-red-300 font-semibold">!</span>
                </div>
                <div>
                  <h3 className="text-lg font-medium text-red-800 dark:text-red-200">
                    生成に失敗しました
                  </h3>
                  <p className="mt-2 text-sm leading-7 text-red-700 dark:text-red-300">
                    {generationError}
                  </p>
                  <p className="mt-4 text-sm text-red-700/80 dark:text-red-300/80">
                    入力内容を確認し、少し待ってからもう一度試してください。
                  </p>
                </div>
              </div>
            </div>
          )}

          {!isGenerating && selectedFeature.id === 'optimize-prompt' && optimizedPromptResult && (
            <div className="glass-panel rounded-2xl p-6 shadow-soft min-h-[400px]">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-neutral-800 dark:text-white">
                    プロンプトを最適化しました
                  </h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    左の入力欄にも反映済みです。
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/60 dark:bg-neutral-900/50 p-4">
                <p className="text-sm leading-7 text-neutral-700 dark:text-neutral-200 whitespace-pre-wrap">
                  {optimizedPromptResult}
                </p>
              </div>
              {negativePrompt && (
                <div className="mt-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50/70 dark:bg-neutral-900/40 p-4">
                  <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                    避ける要素
                  </p>
                  <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">
                    {negativePrompt}
                  </p>
                </div>
              )}
            </div>
          )}

          {!isGenerating && !generationError && generatedImages.length === 0 && !(selectedFeature.id === 'optimize-prompt' && optimizedPromptResult) && (
            <div className="glass-panel rounded-2xl p-12 text-center border-2 border-dashed border-neutral-200/50 dark:border-neutral-700/50 min-h-[400px] flex flex-col items-center justify-center">
              <div className="w-20 h-20 bg-neutral-50 dark:bg-neutral-800/50 rounded-full flex items-center justify-center mb-6">
                <ImageIcon className="w-10 h-10 text-neutral-300 dark:text-neutral-600" />
              </div>
              <h3 className="text-lg font-medium text-neutral-700 dark:text-neutral-200 mb-2">
                保存した企画書がここに表示されます
              </h3>
              <p className="text-neutral-500 dark:text-neutral-400">
                {featureConfig?.requiresImage 
                  ? '画像をアップロードして開始' 
                  : '左のフォームに入力して開始'
                }
              </p>
            </div>
          )}

          {generatedImages.length > 0 && (
            <AnimatePresence>
              {/* Success Card */}
              {showSuccessCard && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6 bg-green-50/50 dark:bg-green-900/20 border border-green-200/50 dark:border-green-800/50 rounded-2xl p-4 backdrop-blur-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-green-100 dark:bg-green-800/50 rounded-full flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-green-800 dark:text-green-200 mb-1">
                        企画書を保存しました
                      </h3>
                      <p className="text-sm text-green-700 dark:text-green-300 mb-3">
                        {generatedImages.length}件の企画書カードをWorkspaceに保存しました。
                      </p>
                      <div className="flex items-center gap-3">
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          className="bg-white/50 dark:bg-black/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 hover:bg-white/80"
                          onClick={() => navigate('/gallery')}
                        >
                          <FolderOpen className="w-4 h-4 mr-1.5" />
                          ギャラリーで見る
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30"
                          onClick={() => navigate('/canvas')}
                        >
                          キャンバスで編集
                          <ExternalLink className="w-4 h-4 ml-1.5" />
                        </Button>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowSuccessCard(false)}
                      className="text-green-600 hover:text-green-800 dark:text-green-400 p-1 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </motion.div>
              )}

              <div className={`grid gap-6 ${
                generatedImages.length === 1 ? 'grid-cols-1' :
                generatedImages.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'
              }`}>
                {generatedImages.map((image, index) => (
                  <motion.div
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.1 }}
                    key={getGeneratedImageKey(image, index)}
                    className="group relative glass-card overflow-hidden hover:shadow-elegant transition-all duration-500 hover:-translate-y-1"
                  >
                    {image.label && (
                      <div className="absolute top-3 left-3 z-10 px-3 py-1 bg-black/50 backdrop-blur-md rounded-full text-white text-xs font-medium border border-white/10">
                        {image.label}
                      </div>
                    )}
                    <img
                      src={image.imageUrl}
                      alt={image.prompt}
                      onClick={() => setSelectedImageIndex(index)}
                      className="w-full aspect-square object-cover transition-transform duration-700 group-hover:scale-105 cursor-pointer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300">
                      <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                        <p className="text-white text-sm line-clamp-2 mb-3 opacity-90">
                          {image.prompt}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDownload(image.imageUrl, `${image.label || 'planning-brief'}.${getDataUrlExtension(image.imageUrl, image.artifactKind === 'planning_brief' ? 'svg' : 'png')}`)}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-white rounded-lg text-sm font-medium text-neutral-900 hover:bg-neutral-100 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            保存
                          </button>
                          <button
                            onClick={() => !isGenerating && handleGenerate()}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-white/80 rounded-lg text-sm font-medium text-neutral-900 hover:bg-white transition-colors border border-neutral-200"
                            disabled={isGenerating}
                          >
                            <RefreshCw className="w-4 h-4" />
                            {noImageGenerationMode ? '再保存' : '再生成'}
                          </button>
                          <button
                            onClick={() => handleSendGeneratedImageToCanvas(image, index)}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary-600 rounded-lg text-sm font-medium text-white hover:bg-primary-700 transition-colors border border-primary-500"
                          >
                            <ExternalLink className="w-4 h-4" />
                            Canvasへ
                          </button>
                          <button
                            onClick={() => {
                              setFavoriteIds((prev) =>
                                prev.includes(image.id)
                                  ? prev.filter((id) => id !== image.id)
                                  : [...prev, image.id]
                              );
                            }}
                            className={`p-2 backdrop-blur-sm border rounded-lg transition-colors ${
                              favoriteIds.includes(image.id)
                                ? 'bg-white text-rose-500 border-rose-100'
                                : 'bg-white/20 border-white/30 text-white hover:bg-white/30'
                            }`}
                          >
                            <Heart className="w-4 h-4" fill={favoriteIds.includes(image.id) ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          )}
        </motion.div>
      </div>

      {/* Prompt History Modal */}
      <PromptHistory
        isOpen={showPromptHistory}
        onClose={() => setShowPromptHistory(false)}
        onSelect={(selectedPrompt) => setPrompt(selectedPrompt)}
      />

      {/* Image Modal for enlarged view */}
      <AnimatePresence>
        {selectedImageIndex !== null && generatedImages[selectedImageIndex] && (
          <ImageModal
            image={generatedImages[selectedImageIndex]}
            isOpen={selectedImageIndex !== null}
            onClose={() => setSelectedImageIndex(null)}
            onDownload={handleDownload}
            onNext={() => setSelectedImageIndex(prev => prev !== null && prev < generatedImages.length - 1 ? prev + 1 : prev)}
            onPrev={() => setSelectedImageIndex(prev => prev !== null && prev > 0 ? prev - 1 : prev)}
            hasNext={selectedImageIndex < generatedImages.length - 1}
            hasPrev={selectedImageIndex > 0}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
