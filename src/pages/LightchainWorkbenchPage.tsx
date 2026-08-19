import { type ChangeEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Film,
  Layers3,
  ImagePlus,
  LayoutGrid,
  Maximize2,
  MessageSquareText,
  Palette,
  Search,
  Shirt,
  ShieldCheck,
  Sparkles,
  UserRound,
  WandSparkles,
  Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { useCanvasStore } from '../stores/canvasStore';
import { Modal } from '../components/ui';
import { supabase } from '../lib/supabase';
import {
  buildMaterialCutoutDataUrl,
  buildPrintDesignCutoutDataUrl,
  buildPrintGarmentCutoutDataUrl,
  buildMaterialReferenceMetadata,
  type MaterialCutoutBounds,
  type MaterialReferenceState,
} from '../lib/workspaceMaterialReferences';
import {
  getWorkspaceArtifactCanonicalStoragePath,
  listWorkspaceArtifacts,
  saveWorkspaceArtifactBestEffort,
  saveWorkspaceArtifactPersisted,
  type WorkspaceArtifact,
} from '../lib/localWorkspaceArtifacts';
import { hydrateGenerationIntentSource } from '../lib/workspaceHandoff';
import { readLightchainResumeInput } from '../lib/lightchainResume';
import { compactLightchainWorkbenchStateForPersistence } from '../lib/lightchainPersistence';
import { prepareFittingDraftMaterialReferenceForPersistence } from '../lib/fittingPersistence';
import { getErrorMessage } from '../lib/errorMessages';
import { persistProviderResultArtifact } from '../lib/providerResultPersistence';
import { downloadValidatedImage } from '../lib/imageDownload';
import { withSignedImageUrls } from '../lib/storage';
import {
  buildPrintingImagePreviewDataUrl,
  defaultPrintArtworkTransform,
  describePrintPlacement,
  describePrintScale,
  type PrintArtworkTransform,
  PrintingImageComposer,
} from '../components/lightchain/PrintingImageComposer';
import { LIGHTCHAIN_MATERIAL_LIBRARY_TABS } from '../lib/lightchainMaterialContract';
import { deriveUnifiedWorkspaceFlowState, unifiedWorkspaceFlowLabels } from '../lib/unifiedWorkspaceFlow';
import { useUnifiedWorkspaceFlow } from '../components/workspace/LightchainUnifiedWorkspaceShell';
import { buildAssetAnchoredPreviewDataUrl, type AssetAnchoredPreviewMode } from '../features/lightchain/assetAnchoredPreview';
import {
  buildLightchainProviderPrompt,
  getLightchainProviderRoute,
  isLightchainProviderSupported,
} from '../features/lightchain/providerAdapter';
import {
  buildLightchainParityInputRoles,
  buildLightchainParityRuntime,
  serializeLightchainParityRuntime,
} from '../features/lightchain/parityRuntime';
import { resolveHeavyRouteForRow } from '../features/lightchain/heavyRouteMapping';
import {
  assertCompletedImageEditResult,
  assertCompletedModelMatrixResult,
  editImageWithPrompt,
  generateImage,
  generateModelMatrix,
} from '../lib/imageApi';

type ToolCategory = 'home' | 'marketing' | 'fitting' | 'planning' | 'graphics' | 'model' | 'video' | 'lab';
type ToolStatus = 'ready' | 'workspace' | 'needs-image' | 'coming-soon';
type MaskCandidate = 'トップス' | '無地部分' | '柄' | '手動範囲';
type WorkbenchStep = 'asset' | 'mask' | 'extracted' | 'next';
type MaterialTab = 'upload-history' | 'generation-history' | 'my-library' | 'team-library' | 'platform-assets';
type MaterialSlotKey = 'primary' | 'secondary';
type MaterialSlotFile = {
  name: string;
  kind: string;
  imageUrl: string;
  sourceImageId?: string | null;
  sourceStoragePath?: string | null;
};
type MaterialTabItem = {
  id: string;
  title: string;
  kind: string;
  note: string;
  imageUrl: string;
  sourceImageId?: string | null;
  sourceStoragePath?: string | null;
};
type ModelPanelVariant = 'uploadPair' | 'body' | 'size' | 'angle' | 'custom';
type PrintingGenerationStatus = 'idle' | 'pending' | 'processing' | 'success' | 'error';
type PrintingCutoutStatus = 'idle' | 'processing' | 'done' | 'error';

type LightchainResult = {
  toolId: string;
  title: string;
  summary: string;
  imageUrl: string;
  generationMode?: 'provider' | 'preview';
  provider?: string | null;
  backendProvider?: string | null;
  jobId?: string | null;
  imageId?: string | null;
  storagePath?: string | null;
  artifactId?: string | null;
  parityRuntime?: ReturnType<typeof serializeLightchainParityRuntime>;
};

const PRINTING_CUTOUT_TIMEOUT_MS = 30_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

type ModelFormState = {
  customMode: string;
  gender: string;
  age: string;
  nationality: string;
  skinTone: string;
  bodyType: string;
  half: string;
  poseMode: string;
  backgroundMode: string;
  bodyGender: string;
  garmentType: string;
  sourceSize: string;
  targetSize: string;
  angleHorizontal: number;
  angleVertical: number;
  angleZoom: number;
  keepSize: 'on' | 'off';
  customBody: 'on' | 'off';
  backView: 'on' | 'off';
};

type CompatTool = {
  id: string;
  title: string;
  lightchainRoute: string;
  category: ToolCategory;
  status: ToolStatus;
  description: string;
  inputs: string[];
  outputs: string[];
  heavyChainHref: string;
  runLabel: string;
  promptTemplate: string;
};

const categories: Array<{ id: ToolCategory; label: string; icon: typeof Sparkles; description: string }> = [
  { id: 'home', label: 'おすすめ', icon: Sparkles, description: '主要ワークスペースをまとめた入口です。' },
  { id: 'marketing', label: 'マーケティング', icon: MessageSquareText, description: 'EC、SNS、ブランド、店舗、ライブ配信、販促素材を一括で作ります。' },
  { id: 'fitting', label: 'AIフィッティング', icon: Shirt, description: '商品画像からモデル着用、ポーズ、背景、体型差分を作ります。' },
  { id: 'planning', label: '企画デザイン', icon: ClipboardList, description: '企画書、ディテール変更、シリーズ案、スタイル方向を作ります。' },
  { id: 'graphics', label: 'グラフィック', icon: Palette, description: '生地、プリント、線画、ベクター化、生産向け素材を扱います。' },
  { id: 'model', label: 'モデル企画', icon: UserRound, description: '顔、体型、服サイズ、ポーズ、背景、アングルを変更します。' },
  { id: 'video', label: '動画', icon: Film, description: '商品動画、着せ替え、ショート動画構成を作ります。' },
  { id: 'lab', label: 'Lab', icon: Boxes, description: '実験機能、変換、品質確認を試します。' },
];

const tools: CompatTool[] = [
  {
    id: 'marketing-home',
    title: 'マーケティングワークスペース',
    lightchainRoute: '/marketing',
    category: 'home',
    status: 'ready',
    description: '4000文字の依頼、EC/SNS/ブランド/店舗/ライブ配信/プロモーションのシーン選択、参考事例、マイプロジェクトを1画面に集約。',
    inputs: ['依頼文', '参考画像', 'シーン', 'プロジェクト'],
    outputs: ['販促画像', 'コピー', '商品ページ素材', 'Canvas編集'],
    heavyChainHref: '/marketing',
    runLabel: '販促ワークスペースを開く',
    promptTemplate: 'EC/SNS向けに、商品の強みが伝わる販促画像とコピーを作成してください。',
  },
  {
    id: 'marketing-detail',
    title: 'マーケティング詳細キャンバス',
    lightchainRoute: '/marketing/detail',
    category: 'marketing',
    status: 'workspace',
    description: '左にアップロード/作業面、右にAIアシスタントとレイヤー設定を置く対話型制作画面。',
    inputs: ['商品画像', 'AIチャット指示', 'レイヤー', '用途プリセット'],
    outputs: ['展示パネル', '店舗ポスター', 'ブランドビジュアル'],
    heavyChainHref: '/marketing',
    runLabel: '対話制作を始める',
    promptTemplate: 'アップロード画像をもとに、展示パネル、店舗ポスター、ブランドビジュアルの3案を作成してください。',
  },
  {
    id: 'ai-fitting',
    title: 'AIフィッティング',
    lightchainRoute: '/model',
    category: 'fitting',
    status: 'ready',
    description: '衣服画像0/4、シングル/マルチタスク、説明生成、参考画像、モデルセット写真、1K品質を持つ着用生成。',
    inputs: ['衣服画像', '説明文', 'モデル画像', 'ポーズ', '背景'],
    outputs: ['モデル着用画像', 'EC素材', '履歴'],
    heavyChainHref: '/fitting',
    runLabel: '着用画像を作る',
    promptTemplate: '平置き商品画像を、自然なモデル着用EC画像に変換してください。',
  },
  {
    id: 'ai-fitting-reference',
    title: 'AIフィッティング 参考画像モード',
    lightchainRoute: '/model?tab=参考図',
    category: 'fitting',
    status: 'needs-image',
    description: 'モデル画像、ポーズ、背景を個別アップロードまたは参考画像ライブラリから選ぶ高精度モード。',
    inputs: ['衣服画像', 'モデル参照', 'ポーズ参照', '背景参照'],
    outputs: ['参照準拠の着用画像', '比較候補'],
    heavyChainHref: '/fitting',
    runLabel: '参照付きで作る',
    promptTemplate: '商品画像、モデル参照、ポーズ参照、背景参照を維持して、自然な着用画像を作成してください。',
  },
  {
    id: 'fitting-clothing-reference',
    title: '衣服参考ライブラリ',
    lightchainRoute: '/model/clothing',
    category: 'fitting',
    status: 'needs-image',
    description: '衣服画像をアップロードし、平置き変換や複数コーディネートの元素材として管理。',
    inputs: ['衣服画像', 'カテゴリ', '説明文'],
    outputs: ['衣服参照', 'フィッティング素材'],
    heavyChainHref: '/fitting',
    runLabel: '衣服素材を準備',
    promptTemplate: '衣服画像をAIフィッティング用の参照素材として整理し、説明文も生成してください。',
  },
  {
    id: 'fitting-background-reference',
    title: '背景参考ライブラリ',
    lightchainRoute: '/model/background-reference',
    category: 'fitting',
    status: 'needs-image',
    description: '背景参考画像を登録し、モデル着用画像や撮影シーンの背景条件として使う導線。',
    inputs: ['背景画像', '背景説明', '用途'],
    outputs: ['背景参照', '撮影シーン条件'],
    heavyChainHref: '/fitting',
    runLabel: '背景素材を準備',
    promptTemplate: '背景参考画像をもとに、EC着用画像へ使える撮影シーン条件を作成してください。',
  },
  {
    id: 'wear-design-lab',
    title: 'ウェアデザインラボ',
    lightchainRoute: '/flow/orientedDesign',
    category: 'home',
    status: 'workspace',
    description: 'ディテールカスタマイズ、デザイン要素融合、ディテール変更のプロジェクト/事例画面。',
    inputs: ['服画像', '変更したい箇所', '参考要素'],
    outputs: ['ディテール変更案', '採用候補', '生成条件'],
    heavyChainHref: '/lab',
    runLabel: 'ラボで試す',
    promptTemplate: '服のディテールを指定箇所だけ変更し、元のシルエットとブランド感は維持してください。',
  },
  {
    id: 'wear-design-detail',
    title: 'ウェアデザイン詳細',
    lightchainRoute: '/flow/orientedDesign/detail',
    category: 'planning',
    status: 'needs-image',
    description: 'ガイドを見て開始し、画像追加からディテール変更を進める詳細画面。',
    inputs: ['対象画像', '変更範囲', '変更説明'],
    outputs: ['部分変更画像', '変更履歴'],
    heavyChainHref: '/lab',
    runLabel: '部分編集へ',
    promptTemplate: '対象画像の指定ディテールのみを自然に変更してください。',
  },
  {
    id: 'video-workstation',
    title: '動画ワークステーション',
    lightchainRoute: '/flow/GenerateShortVideo',
    category: 'home',
    status: 'workspace',
    description: 'ストーリーボード、映像複製、ECモデル展示、動画生成+服の置き換えのプロジェクト画面。',
    inputs: ['商品画像', '動画目的', '尺', 'CTA'],
    outputs: ['動画構成', 'ショットリスト', 'Canvas素材'],
    heavyChainHref: '/video',
    runLabel: '動画構成を作る',
    promptTemplate: 'この商品の15秒ショート動画構成を、3ショットとCTA付きで作成してください。',
  },
  {
    id: 'video-detail',
    title: '動画詳細生成',
    lightchainRoute: '/flow/GenerateShortVideo/detail',
    category: 'video',
    status: 'workspace',
    description: 'ガイドから始める動画詳細制作画面。商品紹介、着せ替え、復元、複製へ接続。',
    inputs: ['開始画像', '終了画像', '動き', '尺'],
    outputs: ['動画タスク', 'ストーリーボード'],
    heavyChainHref: '/video',
    runLabel: '詳細構成へ',
    promptTemplate: '開始画像から自然な商品紹介動画になるように、動きとカメラワークを設計してください。',
  },
  {
    id: 'model-library',
    title: 'モデル企画ライブラリ',
    lightchainRoute: '/model-library/*',
    category: 'home',
    status: 'ready',
    description: '顔、モデル変更、体型、服サイズ、ポーズ、背景、アングル、カスタムモデルをまとめるモデル操作群。',
    inputs: ['モデル条件', '年齢', '国籍', '肌色', '体型'],
    outputs: ['モデル候補', 'model-matrix条件'],
    heavyChainHref: '/generate?feature=model-matrix',
    runLabel: 'モデルを設計',
    promptTemplate: 'ターゲット顧客に合うモデル条件を設計し、EC着用画像に使える候補を作ってください。',
  },
  {
    id: 'fashion-studio',
    title: 'ファッションスタジオ',
    lightchainRoute: '/studio-equivalent',
    category: 'home',
    status: 'workspace',
    description: '衣服、シーン、小物、モデルを組み合わせ、コーディネート案や360度表示に接続する撮影スタジオ。',
    inputs: ['衣服', 'モデル', 'シーン', '小物'],
    outputs: ['コーディネート画像', '多角度候補'],
    heavyChainHref: '/studio',
    runLabel: 'スタジオを開く',
    promptTemplate: '衣服、モデル、背景、小物を自然に融合したファッション撮影案を作成してください。',
  },
  {
    id: 'design-agent',
    title: 'デザインエージェント',
    lightchainRoute: '/agent',
    category: 'home',
    status: 'workspace',
    description: 'ブランド/コレクション名から企画案、インスピレーション、AIグラフィックデザインを生成する対話型エージェント。',
    inputs: ['ブランド', 'コレクション', '構成アイテム', '対象'],
    outputs: ['企画書', 'シリーズ案', 'デザイン方向'],
    heavyChainHref: '/workflows/design-exploration',
    runLabel: '企画書を作る',
    promptTemplate: '指定ブランドのコレクションから着想を得た、シリーズ構成のデザイン企画書を作成してください。',
  },
  {
    id: 'lab',
    title: 'ラボ',
    lightchainRoute: '/flow/laboratory',
    category: 'lab',
    status: 'workspace',
    description: '開発中機能や物撮りからマーケティング画像への変換を試す実験ワークスペース。',
    inputs: ['素材画像', '変換目的', '品質メモ'],
    outputs: ['実験結果', '採用判定'],
    heavyChainHref: '/lab',
    runLabel: '実験を始める',
    promptTemplate: '素材画像をマーケティング用途に変換し、採用可否を評価してください。',
  },
  {
    id: 'print-design-project',
    title: '柄・グラフィック',
    lightchainRoute: '/editor/patternDesign',
    category: 'graphics',
    status: 'workspace',
    description: '柄・グラフィックの新規ファイル、過去プロジェクト、ファッション/ホームテキスタイル事例。',
    inputs: ['柄画像', '用途', 'リピート条件'],
    outputs: ['プリント案', '柄プロジェクト'],
    heavyChainHref: '/patterns/workbench',
    runLabel: '柄を作る',
    promptTemplate: 'アパレル向けプリント柄を、用途とリピート条件に合わせて作成してください。',
  },
  {
    id: 'print-design-detail',
    title: '柄・グラフィック詳細',
    lightchainRoute: '/editor/patternDesign/detail',
    category: 'graphics',
    status: 'needs-image',
    description: '画像追加からプリント編集を開始し、ガイドあり/なしで進める詳細編集画面。',
    inputs: ['柄画像', '編集指示', '配色'],
    outputs: ['編集済み柄', 'Canvas素材'],
    heavyChainHref: '/patterns/workbench',
    runLabel: 'プリント編集へ',
    promptTemplate: 'アップロード柄を元に、アパレル商品へ使いやすい配色と構図に調整してください。',
  },
  {
    id: 'fabric-image',
    title: '生地イメージ',
    lightchainRoute: '/tools/fabric',
    category: 'graphics',
    status: 'needs-image',
    description: 'モデル/デザイン画像と生地画像を組み合わせ、異なる生地効果を生成。',
    inputs: ['モデル/デザイン画像', '生地画像', 'キーワード', '画像比率'],
    outputs: ['生地置換画像', '比較候補'],
    heavyChainHref: '/lightchain/fabric-image',
    runLabel: '生地置換へ',
    promptTemplate: '衣服画像に指定生地の質感を自然に反映してください。',
  },
  {
    id: 'line-generation',
    title: '平絵生成',
    lightchainRoute: '/tools/line',
    category: 'graphics',
    status: 'needs-image',
    description: '着用画像または平置き画像から線画/平絵へ変換。',
    inputs: ['参考画像', '画像タイプ', '生成画像の種類'],
    outputs: ['線画', '平絵'],
    heavyChainHref: '/generate?feature=design-gacha',
    runLabel: '線画化を作る',
    promptTemplate: '衣服画像をアパレル仕様書向けのクリーンな平絵線画に変換してください。',
  },
  {
    id: 'line-to-real',
    title: '線画の実写化',
    lightchainRoute: '/tools/line-draft-to-tile',
    category: 'graphics',
    status: 'needs-image',
    description: 'カラー/モノクロ線画から平置き画像や実写風画像を生成。',
    inputs: ['線画画像', '線画タイプ', '生成画像種類', 'カスタム説明'],
    outputs: ['平置き画像', '実写化候補'],
    heavyChainHref: '/generate?feature=design-gacha',
    runLabel: '実写化する',
    promptTemplate: '線画を元に、商品撮影用の自然な平置き画像へ変換してください。',
  },
  {
    id: 'pattern-vector',
    title: 'パターンをベクター画像に変換',
    lightchainRoute: '/tools/pattern-to-vector',
    category: 'graphics',
    status: 'needs-image',
    description: 'プリントパターンを通常版ベクターへ変換。',
    inputs: ['パターン画像'],
    outputs: ['ベクター化方針', 'SVG素材'],
    heavyChainHref: '/patterns/workbench',
    runLabel: 'ベクター化へ',
    promptTemplate: 'プリントパターンを生産向けに整理し、編集可能なベクター素材へ変換してください。',
  },
  {
    id: 'pattern-vector-pro',
    title: 'パターンをベクター画像に変換 Pro',
    lightchainRoute: '/tools/vector-special',
    category: 'graphics',
    status: 'needs-image',
    description: '積み重ね/分割などレイヤー分け方法を選んでプロ向けにベクター化。',
    inputs: ['パターン画像', '積み重ね', '分割'],
    outputs: ['レイヤー分けSVG', '量産素材'],
    heavyChainHref: '/patterns/workbench',
    runLabel: 'Proベクター化',
    promptTemplate: '柄を積み重ね/分割レイヤーに整理し、量産向けのベクター仕様を作成してください。',
  },
  {
    id: 'printing-image',
    title: 'プリントイメージ',
    lightchainRoute: '/tools/printing',
    category: 'graphics',
    status: 'needs-image',
    description: '服画像にプリント画像をスポット/全体で反映し、版下なしで印刷効果を確認。',
    inputs: ['服画像', 'プリント画像', 'スポット/全体'],
    outputs: ['プリント反映画像', '印刷プレビュー'],
    heavyChainHref: '/lightchain/printing-image',
    runLabel: 'プリント反映へ',
    promptTemplate: '服画像に指定プリントを自然に配置し、印刷効果が分かる商品画像を作成してください。',
  },
  {
    id: 'image-repair',
    title: '画像修正',
    lightchainRoute: '/tools/reactor',
    category: 'fitting',
    status: 'needs-image',
    description: '手足や顔の変形をマスク指定で修復。',
    inputs: ['対象画像', '修復箇所', 'マスク'],
    outputs: ['修復画像', '品質改善候補'],
    heavyChainHref: '/generate?feature=chat-edit',
    runLabel: '修復する',
    promptTemplate: '手足や顔の不自然な変形だけを自然に修復してください。',
  },
  {
    id: 'svg-convert',
    title: '平絵をベクター化',
    lightchainRoute: '/tools/svg-convert',
    category: 'graphics',
    status: 'needs-image',
    description: '平絵やプリントを編集可能なベクターファイルに変換。',
    inputs: ['平絵画像'],
    outputs: ['SVG', '生産用素材'],
    heavyChainHref: '/patterns/workbench',
    runLabel: 'SVG化へ',
    promptTemplate: '平絵を編集可能なSVGベクターとして再構成してください。',
  },
  {
    id: 'model-face',
    title: '顔変更',
    lightchainRoute: '/model-library/head-form',
    category: 'model',
    status: 'needs-image',
    description: '元画像と顔参照画像、または参考画像ライブラリから顔を変更。',
    inputs: ['元画像', '顔参考画像'],
    outputs: ['顔変更モデル画像'],
    heavyChainHref: '/generate?feature=model-matrix',
    runLabel: '顔を変更',
    promptTemplate: '衣服とポーズは維持し、モデルの顔だけを参考画像に近づけて変更してください。',
  },
  {
    id: 'model-change',
    title: 'モデル変更',
    lightchainRoute: '/model-library/model-change-form',
    category: 'model',
    status: 'needs-image',
    description: '元画像のメインモデルを、モデル参考画像またはランダムモデルへ変更。アパレルサイズ保持あり。',
    inputs: ['元画像', 'モデル参考画像', 'サイズ保持'],
    outputs: ['モデル変更画像'],
    heavyChainHref: '/models',
    runLabel: 'モデルを変更',
    promptTemplate: '服のサイズ感を維持しながら、メインモデルだけを変更してください。',
  },
  {
    id: 'body-shape',
    title: '体型',
    lightchainRoute: '/model-library/body-form',
    category: 'model',
    status: 'needs-image',
    description: '服装を変えずに体型のみを男性/女性/標準/カスタムへ変更。',
    inputs: ['元画像', '性別', '体型'],
    outputs: ['体型変更画像'],
    heavyChainHref: '/models',
    runLabel: '体型を調整',
    promptTemplate: '服装は変えず、モデルの体型だけを自然に調整してください。',
  },
  {
    id: 'clothing-size',
    title: '服のサイズ',
    lightchainRoute: '/model-library/size-form',
    category: 'model',
    status: 'needs-image',
    description: '体型は変えず、トップス/ボトムス/全身の服サイズだけを変更。',
    inputs: ['元画像', '服装タイプ', '元サイズ', '変更サイズ'],
    outputs: ['サイズ差分画像'],
    heavyChainHref: '/models',
    runLabel: 'サイズを変更',
    promptTemplate: '体型は維持し、服のサイズ感だけを指定サイズに変更してください。',
  },
  {
    id: 'pose-change',
    title: 'ポーズ',
    lightchainRoute: '/model-library/pose-form',
    category: 'model',
    status: 'needs-image',
    description: 'ポーズ参考画像またはライブラリからモデルのポーズと身体の動きを調整。',
    inputs: ['元画像', 'ポーズ参考画像'],
    outputs: ['ポーズ変更画像'],
    heavyChainHref: '/generate?feature=model-matrix',
    runLabel: 'ポーズ変更',
    promptTemplate: '衣服の見え方を保ちながら、モデルのポーズを参考画像に合わせて変更してください。',
  },
  {
    id: 'background-change',
    title: '背景',
    lightchainRoute: '/model-library/background-form',
    category: 'model',
    status: 'needs-image',
    description: '背景参照画像またはランダム背景で画像背景を変更。',
    inputs: ['元画像', '背景参考画像', '背景説明'],
    outputs: ['背景変更画像'],
    heavyChainHref: '/studio',
    runLabel: '背景変更',
    promptTemplate: '商品とモデルは保ち、背景だけを指定シーンへ自然に変更してください。',
  },
  {
    id: 'angle-change',
    title: 'アングル',
    lightchainRoute: '/model-library/perspective-form',
    category: 'model',
    status: 'needs-image',
    description: '左右45度、見上げ/見下ろし、接写/遠景、背面など画角と構図を変更。',
    inputs: ['元画像', '左右視点', '上下視点', '距離', '背面'],
    outputs: ['アングル差分画像'],
    heavyChainHref: '/studio',
    runLabel: 'アングル変更',
    promptTemplate: '衣服の特徴を保ち、カメラアングルだけを指定方向へ変更してください。',
  },
  {
    id: 'model-custom',
    title: 'モデルカスタマイズ',
    lightchainRoute: '/model-library/model-custom-form',
    category: 'model',
    status: 'ready',
    description: '性別、年齢、国籍、ハーフ、肌色、体型を選ぶ専用バーチャルモデル生成。',
    inputs: ['性別', '年齢', '国籍', '肌色', '体型'],
    outputs: ['専用モデル画像'],
    heavyChainHref: '/generate?feature=model-matrix',
    runLabel: 'モデル生成',
    promptTemplate: '指定条件に合う専用バーチャルモデルを、EC撮影に使える品質で生成してください。',
  },
  {
    id: 'custom-style',
    title: 'カスタムスタイル',
    lightchainRoute: '/model-base/style',
    category: 'planning',
    status: 'workspace',
    description: '30〜50枚の学習素材、パーソナル/チームスペース、スタイルライブラリ管理。',
    inputs: ['学習素材', 'スタイル名', '共有範囲'],
    outputs: ['スタイルライブラリ', 'ブランド生成条件'],
    heavyChainHref: '/brand/settings',
    runLabel: 'ブランド設定へ',
    promptTemplate: 'ブランド固有の撮影スタイル、色、モデル傾向、構図ルールを保存してください。',
  },
];

for (const [index, tool] of tools.entries()) {
  tools[index] = {
    ...tool,
    heavyChainHref: resolveHeavyRouteForRow(tool.id, tool.heavyChainHref),
  };
}

// Keep legacy video definitions available to the provider-boundary tests, but
// never expose them through the Lightchain non-video beta workbench.
const visibleTools = tools.filter((tool) => !tool.id.startsWith('video-'));
const visibleCategories = categories.filter((category) => category.id !== 'video');
const totalToolCount = visibleTools.length;

const categoryWorkbenchLabels: Record<ToolCategory, {
  uploadLabel: string;
  emptyLabel: string;
  materialKinds: string[];
  layers: Array<[string, string]>;
  placements: string[];
}> = {
  home: {
    uploadLabel: '制作素材をアップロード',
    emptyLabel: '商品、モデル、背景、柄など制作の起点になる素材を置きます',
    materialKinds: ['商品画像', '衣服', 'モデル参照'],
    layers: [['base', '素材ベース'], ['mask', 'マスク'], ['design', 'デザイン'], ['output', '出力']],
    placements: ['中央', '横並び比較', '全面', '商品横'],
  },
  marketing: {
    uploadLabel: '商品・販促素材をアップロード',
    emptyLabel: '商品写真を置き、背景やコピーのレイヤーを重ねます',
    materialKinds: ['商品画像', '背景', 'ロゴ', '販促参考'],
    layers: [['product', '商品'], ['background', '背景'], ['copy', 'コピー'], ['cta', 'CTA']],
    placements: ['中央大きめ', '左商品右コピー', 'EC正方形', 'SNS縦長'],
  },
  fitting: {
    uploadLabel: '衣服画像をアップロード',
    emptyLabel: '平置き、トルソー、着用写真から衣服参照を作ります',
    materialKinds: ['Tシャツ', 'フーディー', 'ジャケット', 'パンツ', '背景'],
    layers: [['garment', '衣服ベース'], ['mask', 'カットマスク'], ['print', 'プリント'], ['fit', '着用展開']],
    placements: ['胸中央', '背面大判', '袖ワンポイント', '全面総柄'],
  },
  planning: {
    uploadLabel: '変更対象の服画像をアップロード',
    emptyLabel: '変更したい箇所をマスクし、ディテールの候補を重ねます',
    materialKinds: ['対象服', '襟', '袖', 'ポケット', '素材参考'],
    layers: [['base', '元画像'], ['mask', '変更範囲'], ['detail', 'ディテール'], ['compare', '比較']],
    placements: ['襟元', '袖', '裾', 'ポケット', '全面'],
  },
  graphics: {
    uploadLabel: '柄・ロゴ・服モックをアップロード',
    emptyLabel: '柄やロゴを置き、服の上へ配置して確認します',
    materialKinds: ['柄画像', 'ロゴ', '服モック', '生地テクスチャ'],
    layers: [['pattern', '柄'], ['mask', 'マスク'], ['garment', '服'], ['plate', '版下']],
    placements: ['胸中央', '背面大判', '袖', '全面総柄', '小物'],
  },
  model: {
    uploadLabel: 'モデル・ポーズ参照をアップロード',
    emptyLabel: '顔、ポーズ、体型、背景の参照画像を置きます',
    materialKinds: ['モデル参照', '顔参照', 'ポーズ参照', '背景参照'],
    layers: [['face', '顔'], ['pose', 'ポーズ'], ['body', '体型'], ['background', '背景']],
    placements: ['正面', '斜め45度', '全身', '上半身'],
  },
  video: {
    uploadLabel: '開始画像・商品画像をアップロード',
    emptyLabel: '動画の開始フレーム、商品、終了フレームを素材として置きます',
    materialKinds: ['開始画像', '終了画像', '商品画像', '背景'],
    layers: [['start', '開始'], ['motion', '動き'], ['product', '商品'], ['end', '終了']],
    placements: ['1ショット目', '中央商品', 'クローズアップ', 'CTA前'],
  },
  lab: {
    uploadLabel: '実験素材をアップロード',
    emptyLabel: '変換したい素材を置き、処理範囲と品質確認レイヤーを作ります',
    materialKinds: ['素材画像', '物撮り', '背景', '比較対象'],
    layers: [['source', '元画像'], ['mask', '処理範囲'], ['quality', '品質確認'], ['result', '結果']],
    placements: ['中央', '左比較', '右結果', '全面'],
  },
};

const encodeSvgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;

const escapeSvgText = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const truncateSvgText = (value: string, maxLength: number) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
};

const buildOrderSheetPreview = ({
  tool,
  brief,
  referenceNote,
  materialKind,
  activeLayer,
  printPlacement,
  printScale,
  selectedMaskCandidate,
  workbenchStep,
  outputs,
}: {
  tool: CompatTool;
  brief: string;
  referenceNote: string;
  materialKind: string;
  activeLayer: string;
  printPlacement: string;
  printScale: number;
  selectedMaskCandidate: MaskCandidate | null;
  workbenchStep: WorkbenchStep;
  outputs: string[];
}) => {
  const title = escapeSvgText(truncateSvgText(tool.title, 34));
  const request = escapeSvgText(truncateSvgText(brief, 58));
  const reference = escapeSvgText(truncateSvgText(referenceNote, 58));
  const outputText = escapeSvgText(outputs.slice(0, 3).join(' / '));
  const maskText = escapeSvgText(selectedMaskCandidate ?? 'not-selected');
  const layerText = escapeSvgText(`${materialKind} / ${activeLayer} / ${printPlacement} / ${printScale}%`);
  const nextStep = workbenchStep === 'next' ? 'Canvas-ready' : workbenchStep === 'extracted' ? 'Extracted' : workbenchStep === 'mask' ? 'Mask review' : 'Material intake';

  return encodeSvgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" data-lightchain-order-preview="lightchain-order-sheet-v1" data-tool-id="${escapeSvgText(tool.id)}">
      <rect width="1200" height="900" fill="#f8fafc"/>
      <rect x="70" y="64" width="1060" height="772" rx="34" fill="#ffffff" stroke="#d4d4d8" stroke-width="3"/>
      <rect x="70" y="64" width="1060" height="156" rx="34" fill="#0f172a"/>
      <text x="112" y="126" fill="#67e8f9" font-family="Arial, sans-serif" font-size="28" font-weight="700">LIGHTCHAIN WORKSHEET</text>
      <text x="112" y="178" fill="#ffffff" font-family="Arial, sans-serif" font-size="48" font-weight="800">${title}</text>
      <text x="112" y="276" fill="#0f172a" font-family="Arial, sans-serif" font-size="28" font-weight="700">Selected tool</text>
      <text x="112" y="316" fill="#334155" font-family="Arial, sans-serif" font-size="26">${escapeSvgText(tool.id)} / ${escapeSvgText(tool.lightchainRoute)}</text>
      <text x="112" y="392" fill="#0f172a" font-family="Arial, sans-serif" font-size="28" font-weight="700">Request</text>
      <text x="112" y="432" fill="#334155" font-family="Arial, sans-serif" font-size="25">${request}</text>
      <text x="112" y="492" fill="#64748b" font-family="Arial, sans-serif" font-size="22">${reference}</text>
      <rect x="112" y="560" width="460" height="172" rx="22" fill="#ecfeff" stroke="#67e8f9" stroke-width="2"/>
      <text x="144" y="612" fill="#0f172a" font-family="Arial, sans-serif" font-size="26" font-weight="700">Material / Layer</text>
      <text x="144" y="658" fill="#0f766e" font-family="Arial, sans-serif" font-size="24">${layerText}</text>
      <text x="144" y="704" fill="#155e75" font-family="Arial, sans-serif" font-size="22">mask: ${maskText}</text>
      <rect x="628" y="560" width="460" height="172" rx="22" fill="#f0fdf4" stroke="#86efac" stroke-width="2"/>
      <text x="660" y="612" fill="#0f172a" font-family="Arial, sans-serif" font-size="26" font-weight="700">Output / Next step</text>
      <text x="660" y="658" fill="#166534" font-family="Arial, sans-serif" font-size="24">${outputText}</text>
      <text x="660" y="704" fill="#15803d" font-family="Arial, sans-serif" font-size="22">${nextStep}</text>
      <text x="112" y="794" fill="#94a3b8" font-family="Arial, sans-serif" font-size="22">selected-tool-preview / 保存用シート</text>
    </svg>
  `);
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('画像を読み込めませんでした。'));
    };
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
}

function getOverlayPosition(placement: string, scale: number) {
  const clampedScale = Math.max(20, Math.min(90, scale));
  const offset = Math.round((clampedScale - 46) * 0.8);
  if (/背|背面|後/.test(placement)) return { x: 220 - offset, y: 285 - offset };
  if (/左/.test(placement)) return { x: 170 - offset, y: 235 - offset };
  if (/右/.test(placement)) return { x: 280 - offset, y: 235 - offset };
  if (/全面|全体/.test(placement)) return { x: 190 - offset, y: 215 - offset };
  return { x: 225 - offset, y: 250 - offset };
}

const defaultMaskCandidates: MaskCandidate[] = ['トップス', '無地部分', '柄'];

const materialTabDescriptions: Record<MaterialTab, string> = {
  'upload-history': '直近で使ったアップロード素材を再利用します。',
  'generation-history': '過去14日間の生成結果を素材として使います。',
  'my-library': '個人で保存した商品、柄、モデル参照を選びます。',
  'team-library': 'チーム共有の素材を制作に使います。',
  'platform-assets': 'サンプル素材から開始します。',
};

const materialTabs: Array<{ id: MaterialTab; label: string; description: string }> =
  LIGHTCHAIN_MATERIAL_LIBRARY_TABS.map((tab) => ({
    ...tab,
    description: materialTabDescriptions[tab.id],
  }));

const emptyMaterialTabItems: Record<MaterialTab, MaterialTabItem[]> = {
  'upload-history': [],
  'generation-history': [],
  'my-library': [],
  'team-library': [],
  'platform-assets': [],
};

const metadataString = (artifact: WorkspaceArtifact, key: string): string | null => {
  const value = artifact.metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const metadataBoolean = (artifact: WorkspaceArtifact, key: string): boolean => artifact.metadata[key] === true;

const materialTabForArtifact = (artifact: WorkspaceArtifact): MaterialTab | null => {
  const previewKind = metadataString(artifact, 'previewKind');
  const libraryScope = metadataString(artifact, 'libraryScope');
  if (libraryScope === 'personal') return 'my-library';
  if (libraryScope === 'team') return 'team-library';
  if (previewKind?.startsWith('uploaded-')) return 'upload-history';

  const resultKind = metadataString(artifact, 'resultKind');
  const isProviderResult = metadataBoolean(artifact, 'providerResultArtifact')
    || resultKind === 'provider'
    || artifact.featureType.endsWith('-provider-result')
    || artifact.featureType === 'lightchain-material-result';
  return isProviderResult ? 'generation-history' : null;
};

const buildMaterialTabItems = (artifacts: WorkspaceArtifact[]): Record<MaterialTab, MaterialTabItem[]> => {
  const items = { ...emptyMaterialTabItems } as Record<MaterialTab, MaterialTabItem[]>;
  artifacts.forEach((artifact) => {
    const tab = materialTabForArtifact(artifact);
    // A canonical remote path without a current signed URL is not selectable
    // from this modal. Gallery/History remain responsible for re-signing it.
    if (!tab || !artifact.imageUrl.trim()) return;
    items[tab].push({
      id: artifact.id,
      title: artifact.title,
      kind: metadataString(artifact, 'toolTitle') ?? artifact.featureType,
      note: `保存済み / ${new Date(artifact.createdAt).toLocaleDateString('ja-JP')}`,
      imageUrl: artifact.imageUrl,
      sourceImageId: metadataString(artifact, 'sourceImageId') ?? metadataString(artifact, 'imageId') ?? artifact.id,
      sourceStoragePath: getWorkspaceArtifactCanonicalStoragePath(artifact.metadata),
    });
  });
  return items;
};

const formatWorkspaceArtifactDate = (createdAt: string): string => {
  const timestamp = new Date(createdAt).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString('ja-JP') : '保存日時不明';
};

type WorkspaceProjectCard = {
  id: string;
  title: string;
  age: string;
  imageUrl: string;
  isNew?: boolean;
};

const buildWorkspaceProjectCards = (
  artifacts: WorkspaceArtifact[],
  featureTypes: string[],
  newLabel: string,
): WorkspaceProjectCard[] => [
  { id: `new-${newLabel}`, title: newLabel, age: '', imageUrl: '', isNew: true },
  ...artifacts
    .filter((artifact) => featureTypes.includes(artifact.featureType))
    .map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      age: formatWorkspaceArtifactDate(artifact.createdAt),
      imageUrl: artifact.imageUrl,
    })),
];

const modelToolOrder = [
  'model-custom',
  'model-face',
  'model-change',
  'body-shape',
  'clothing-size',
  'pose-change',
  'background-change',
  'angle-change',
];

const modelPanelConfig: Record<string, {
  variant: ModelPanelVariant;
  title: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  modeLabel?: string;
  modeOptions?: string[];
  note?: string;
  subtitle?: string;
}> = {
  'model-face': {
    variant: 'uploadPair',
    title: '顔変更',
    primaryLabel: '元の画像',
    secondaryLabel: '顔の参考図',
    note: '顔の参考画像をアップロードしなければ、ランダムな顔を直接生成できます',
  },
  'model-change': {
    variant: 'uploadPair',
    title: 'モデル変更',
    primaryLabel: '元の画像',
    secondaryLabel: 'モデル参考画像',
    note: 'モデル参考画像をアップロードしなければ、ランダムモデルを直接生成できます',
  },
  'body-shape': {
    variant: 'body',
    title: '体型',
    primaryLabel: '元の画像',
    subtitle: '服装は変わらずに体型のみ変わります',
  },
  'clothing-size': {
    variant: 'size',
    title: '服のサイズ',
    primaryLabel: '元の画像',
    subtitle: '体型は変わらず、服のサイズが変わります',
    note: '画像内の人物の体型を変えず、服のサイズのみを調整します',
  },
  'pose-change': {
    variant: 'uploadPair',
    title: 'ポーズ',
    primaryLabel: '元の画像',
    secondaryLabel: 'ポーズ参考画像',
    modeLabel: 'ポーズ生成方法',
    modeOptions: ['参考画像', 'カスタム'],
    note: 'ポーズ参考画像をアップロードしなければ、ランダムポーズを直接生成できます',
  },
  'background-change': {
    variant: 'uploadPair',
    title: '背景',
    primaryLabel: '元の画像',
    secondaryLabel: '背景参考画像',
    modeLabel: '背景生成方法',
    modeOptions: ['参考画像', 'カスタム'],
    note: '背景参考画像をアップロードしなければ、ランダム背景を直接生成できます',
  },
  'angle-change': {
    variant: 'angle',
    title: 'アングル',
    primaryLabel: '元の画像',
  },
  'model-custom': {
    variant: 'custom',
    title: 'モデルカスタマイズ',
  },
};

const defaultModelFormState: ModelFormState = {
  customMode: 'ラベル',
  gender: '男性',
  age: 'スマート',
  nationality: 'スマート',
  skinTone: 'スマート',
  bodyType: 'スマート',
  half: 'オフ',
  poseMode: '参考画像',
  backgroundMode: '参考画像',
  bodyGender: '男性',
  garmentType: 'トップス',
  sourceSize: 'L',
  targetSize: 'XXL',
  angleHorizontal: 50,
  angleVertical: 50,
  angleZoom: 50,
  keepSize: 'on',
  customBody: 'off',
  backView: 'on',
};

const workspaceStyleConfig: Record<string, {
  kind: 'marketing' | 'agent' | 'lab' | 'studio';
  title: string;
  subtitle: string;
  prompt: string;
  tabs?: string[];
  chips?: string[];
  examples?: string[];
}> = {
  'marketing-home': {
    kind: 'marketing',
    title: 'マーケティングワークスペースへようこそ',
    subtitle: '今日は何を作りますか？リクエストを聞かせてください。一緒に始めましょう！',
    prompt: '商品画像をアップロードして、デザインのリクエストを教えてください',
    chips: ['EC', 'SNS', 'ブランド', '店舗・オフライン', 'ライブ配信', 'プロモーション'],
  },
  'design-agent': {
    kind: 'agent',
    title: 'Hello,山内カンナ',
    subtitle: '今日はどんなデザインが必要ですか?',
    prompt: 'LOUIS VUITTON の 2026年春夏 コレクションからインスピレーションを得て、ショートジャケット、シャツ、ロングパンツ、ショートパンツで構成するメンズ デザイン企画書を作成する。',
    tabs: ['企画案', 'インスピレーション', 'AIグラフィックデザイン'],
    examples: [
      'ZIMMERMANNのRESORT 2026コレクションからインスピレーションを得て、ショートジャケット、シャツワンピース、プリントワンピース、スカートで構成するレディースデザイン企画書を作成する。',
      'PDFの2025年秋冬コレクションからインスピレーションを得て、ブルゾンアウター、ベースボールジャケット、パーカー、ニット、ロングパンツで構成するボーイズデザイン企画書を作成する。',
    ],
  },
  lab: {
    kind: 'lab',
    title: 'ラボ',
    subtitle: '参考事例',
    prompt: '物マーケティング画像への変換',
  },
  'fashion-studio': {
    kind: 'studio',
    title: 'ファッションスタジオ',
    subtitle: '衣服、モデル、シーン、小物を組み合わせて撮影スタジオ案を作ります。',
    prompt: '黒のチェーン柄フーディーを、モデル、背景、小物と組み合わせてEC/SNS向けの撮影案にしてください。',
    tabs: ['スタジオ案', 'コーディネート', '360度表示'],
    examples: [
      '平置き商品画像を、白背景のモデル着用スタジオ撮影に展開する。',
      'バッグ、靴、小物を合わせた高級ストリート系コーディネートを作る。',
    ],
  },
};

const maskCandidateLayer: Record<MaskCandidate, string> = {
  トップス: 'garment',
  無地部分: 'base',
  柄: 'pattern',
  手動範囲: 'mask',
};

export function LightchainWorkbenchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toolId } = useParams<{ toolId?: string }>();
  const [searchParams] = useSearchParams();
  const { user, currentBrand } = useAuthStore();
  const { setFlowState } = useUnifiedWorkspaceFlow();
  const { createProject, deleteProject, addObject, selectObject, saveCurrentProject } = useCanvasStore();
  const [activeCategory, setActiveCategory] = useState<ToolCategory>('home');
  const [selectedToolId, setSelectedToolId] = useState('marketing-home');
  const [query, setQuery] = useState('');
  const [brief, setBrief] = useState('黒のチェーン柄フーディーを、ECとSNSで使える高級ストリート系ビジュアルに展開したい。');
  const [referenceNote, setReferenceNote] = useState('モデルは20代、無地背景、チェーン柄は服の主役として残す。');
  const [isSaving, setIsSaving] = useState(false);
  const [garmentImageUrl, setGarmentImageUrl] = useState('');
  const [garmentFileName, setGarmentFileName] = useState('');
  const [garmentCategory, setGarmentCategory] = useState('フーディー');
  const [cutMode, setCutMode] = useState<'auto' | 'manual' | 'keep'>('auto');
  const [activeLayer, setActiveLayer] = useState('print');
  const [printPlacement, setPrintPlacement] = useState('胸中央');
  const [printScale, setPrintScale] = useState(46);
  const [printArtworkTransform, setPrintArtworkTransform] = useState<PrintArtworkTransform>(defaultPrintArtworkTransform);
  const [analysisStatus, setAnalysisStatus] = useState<'empty' | 'ready'>('empty');
  const [workbenchStep, setWorkbenchStep] = useState<WorkbenchStep>('asset');
  const [maskCandidates, setMaskCandidates] = useState<MaskCandidate[]>([]);
  const [selectedMaskCandidate, setSelectedMaskCandidate] = useState<MaskCandidate | null>(null);
  const [extractedLayerReady, setExtractedLayerReady] = useState(false);
  const [extractedGarmentImageUrl, setExtractedGarmentImageUrl] = useState<string | null>(null);
  const [cutoutBounds, setCutoutBounds] = useState<MaterialCutoutBounds | null>(null);
  const [cutoutOutputSize, setCutoutOutputSize] = useState<{ width: number; height: number } | null>(null);
  const [cutoutDataUrlBytes, setCutoutDataUrlBytes] = useState<number | null>(null);
  const [cutoutMaxDataUrlBytes, setCutoutMaxDataUrlBytes] = useState<number | null>(null);
  const [cutoutStoragePolicy, setCutoutStoragePolicy] = useState<string | null>(null);
  const [maskEngine, setMaskEngine] = useState<string | null>(null);
  const [nextStepConfirmed, setNextStepConfirmed] = useState(false);
  const [mobileToolsExpanded, setMobileToolsExpanded] = useState(false);
  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [activeMaterialTab, setActiveMaterialTab] = useState<MaterialTab>('upload-history');
  const [activeMaterialSlot, setActiveMaterialSlot] = useState<MaterialSlotKey>('primary');
  const [secondaryUploadResetKey, setSecondaryUploadResetKey] = useState(0);
  const [materialSlotFiles, setMaterialSlotFiles] = useState<Record<MaterialSlotKey, MaterialSlotFile | null>>({
    primary: null,
    secondary: null,
  });
  const [modelFormState, setModelFormState] = useState<ModelFormState>(defaultModelFormState);
  const [lightchainResult, setLightchainResult] = useState<LightchainResult | null>(null);
  const lightchainResultRef = useRef<typeof lightchainResult>(null);
  lightchainResultRef.current = lightchainResult;
  const [lightchainResultPreviewOpen, setLightchainResultPreviewOpen] = useState(false);
  const [providerRightsConfirmed, setProviderRightsConfirmed] = useState(false);
  const [lightchainGenerationRunning, setLightchainGenerationRunning] = useState(false);
  const [lightchainGenerationError, setLightchainGenerationError] = useState<string | null>(null);
  const [resumeInputReadback, setResumeInputReadback] = useState<'restored' | 'unavailable' | null>(null);
  const [workspaceText, setWorkspaceText] = useState('');
  const [workspaceTextDrafts, setWorkspaceTextDrafts] = useState<Record<string, string>>({});
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState('');
  const [activeFittingTaskTab, setActiveFittingTaskTab] = useState('シングルタスク');
  const [activeFittingInputTab, setActiveFittingInputTab] = useState('説明生成');
  const [autoConvertGarment, setAutoConvertGarment] = useState(true);
  const [printingMode, setPrintingMode] = useState<'スポット' | '全体'>('スポット');
  const [printingNotice, setPrintingNotice] = useState('');
  const [printingGenerationStatus, setPrintingGenerationStatus] = useState<PrintingGenerationStatus>('idle');
  const [printingGenerationError, setPrintingGenerationError] = useState<string | null>(null);
  const [printingCutoutStatus, setPrintingCutoutStatus] = useState<Record<MaterialSlotKey, PrintingCutoutStatus>>({
    primary: 'idle',
    secondary: 'idle',
  });
  const [printingCutoutErrors, setPrintingCutoutErrors] = useState<Record<MaterialSlotKey, string | null>>({
    primary: null,
    secondary: null,
  });
  const [fabricPrompt, setFabricPrompt] = useState('');
  const [fabricNotice, setFabricNotice] = useState('');
  const [lineDraftType, setLineDraftType] = useState<'カラー線画' | 'モノクロ線画'>('カラー線画');
  const [lineToRealImageType, setLineToRealImageType] = useState<'平置き画像' | 'モデル図'>('平置き画像');
  const [lineGenerationImageType, setLineGenerationImageType] = useState<'平置き画像' | 'モデル図'>('平置き画像');
  const [patternVectorLayers, setPatternVectorLayers] = useState<Array<'積み重ね' | '分割'>>(['積み重ね']);
  const [lineToRealPrompt, setLineToRealPrompt] = useState('');
  const [imageRepairMode, setImageRepairMode] = useState<'手足の変形を修正' | 'マスクツール'>('手足の変形を修正');
  const [imageRepairGenerating, setImageRepairGenerating] = useState(false);
  const [customStyleTab, setCustomStyleTab] = useState<'personal' | 'team'>('personal');
  const [customStyleSearch, setCustomStyleSearch] = useState('');
  const [wearDesignDetailStarted, setWearDesignDetailStarted] = useState(false);
  const [wearDesignMode, setWearDesignMode] = useState<'guide' | 'no-guide'>('no-guide');
  const [wearDesignPrompt, setWearDesignPrompt] = useState('');
  const [wearDesignFocus, setWearDesignFocus] = useState('襟');
  const [printDesignDetailStarted, setPrintDesignDetailStarted] = useState(false);
  const [printDesignMode, setPrintDesignMode] = useState<'guide' | 'no-guide'>('no-guide');
  const [printDesignPrompt, setPrintDesignPrompt] = useState('');
  const [printDesignStyle, setPrintDesignStyle] = useState('ファッション');
  const [marketingDetailTab, setMarketingDetailTab] = useState<'assistant' | 'layers'>('assistant');
  const [marketingProjectName, setMarketingProjectName] = useState('無題のプロジェクト');
  const [marketingProjectNameDraft, setMarketingProjectNameDraft] = useState('無題のプロジェクト');
  const [marketingProjectNameEditing, setMarketingProjectNameEditing] = useState(false);
  const [marketingCanvasTool, setMarketingCanvasTool] = useState('選択');
  const [marketingCanvasZoom, setMarketingCanvasZoom] = useState(20);
  const [marketingTutorialStep, setMarketingTutorialStep] = useState(1);
  const [marketingTutorialDismissed, setMarketingTutorialDismissed] = useState(false);
  const [workspaceTutorialStep, setWorkspaceTutorialStep] = useState(1);
  const [workspaceTutorialDismissed, setWorkspaceTutorialDismissed] = useState(false);

  const [workspaceArtifacts, setWorkspaceArtifacts] = useState<WorkspaceArtifact[]>([]);
  const [remoteMaterialTabItems, setRemoteMaterialTabItems] = useState<Record<MaterialTab, MaterialTabItem[]>>(emptyMaterialTabItems);

  useEffect(() => {
    let cancelled = false;
    const brandId = currentBrand?.id;
    if (!brandId) {
      setWorkspaceArtifacts([]);
      return () => {
        cancelled = true;
      };
    }

    const localArtifacts = listWorkspaceArtifacts(brandId, user?.id);
    setWorkspaceArtifacts(localArtifacts);

    const imageReferences = localArtifacts.map((artifact) => ({
      storage_path: getWorkspaceArtifactCanonicalStoragePath(artifact.metadata) ?? artifact.imageUrl,
      image_url: artifact.imageUrl,
    }));
    void withSignedImageUrls(imageReferences)
      .then((signedArtifacts) => {
        if (cancelled) return;
        setWorkspaceArtifacts(localArtifacts.map((artifact, index) => ({
          ...artifact,
          imageUrl: signedArtifacts[index]?.image_url || artifact.imageUrl,
        })));
      })
      .catch(() => {
        // Keep local/data URLs usable when one remote artifact cannot be signed.
      });

    return () => {
      cancelled = true;
    };
  }, [currentBrand?.id, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const brandId = currentBrand?.id;
    if (!brandId) {
      setRemoteMaterialTabItems(emptyMaterialTabItems);
      return () => {
        cancelled = true;
      };
    }

    const hydrateRemoteGallery = async () => {
      const { data, error } = await supabase
        .from('generated_images')
        .select('*')
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error || !data) {
        if (!cancelled) setRemoteMaterialTabItems(emptyMaterialTabItems);
        return;
      }
      const signedImages = await withSignedImageUrls(data).catch(() => data);
      const generationItems = signedImages.flatMap((image) => {
        if (!image.image_url) return [];
        const promptTitle = image.prompt?.split('\n')[0]?.trim().slice(0, 80);
        return [{
          id: `remote-gallery-${image.id}`,
          title: promptTitle || image.feature_type || 'Gallery素材',
          kind: image.feature_type || 'generated-image',
          note: `Gallery / ${new Date(image.created_at).toLocaleDateString('ja-JP')}`,
          imageUrl: image.image_url,
          sourceImageId: image.id,
          sourceStoragePath: image.storage_path || null,
        }];
      });
      if (!cancelled) {
        setRemoteMaterialTabItems({
          ...emptyMaterialTabItems,
          'generation-history': generationItems,
        });
      }
    };

    void hydrateRemoteGallery();
    return () => {
      cancelled = true;
    };
  }, [currentBrand?.id]);

  const materialTabItems = useMemo(() => {
    const localItems = buildMaterialTabItems(workspaceArtifacts);
    const localGenerationIds = new Set(localItems['generation-history'].map((item) => item.id));
    const remoteGenerationItems = remoteMaterialTabItems['generation-history']
      .filter((item) => !localGenerationIds.has(item.id));
    return {
      ...localItems,
      'generation-history': [...localItems['generation-history'], ...remoteGenerationItems],
    };
  }, [remoteMaterialTabItems, workspaceArtifacts]);

  const [marketingDetailPrompt, setMarketingDetailPrompt] = useState('');
  const printingGenerationRequestRef = useRef<number | null>(null);
  const printingGenerationSequenceRef = useRef(0);
  const printingCutoutRequestRef = useRef<Record<MaterialSlotKey, number>>({ primary: 0, secondary: 0 });
  const lightchainGenerationSequenceRef = useRef(0);

  const renderLightchainResultPreviewImage = (className: string, alt: string) => {
    if (!lightchainResult) return null;
    return (
      <button
        type="button"
        onClick={() => setLightchainResultPreviewOpen(true)}
        className="group block w-full text-left focus:outline-none"
        aria-label={`${lightchainResult.title}を拡大表示`}
      >
        <span className="relative block overflow-hidden">
          <img
            src={lightchainResult.imageUrl}
            alt={alt}
            className={`${className} cursor-zoom-in transition duration-300 group-hover:scale-[1.01] group-hover:brightness-105`}
          />
          <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-semibold text-white opacity-0 shadow-lg transition group-hover:opacity-100">
            <Maximize2 className="h-3 w-3" />
            拡大
          </span>
        </span>
      </button>
    );
  };

  const handleDownloadLightchainResult = async () => {
    if (!lightchainResult?.imageUrl) return;
    try {
      await downloadValidatedImage(
        lightchainResult.imageUrl,
        `lightchain-${lightchainResult.toolId}-result.png`,
        'lightchain_result_download',
      );
      toast.success('生成結果をダウンロードしました');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'lightchain_result_download_failed';
      toast.error(message);
    }
  };

  const lightchainResultModal = lightchainResult ? (
    <Modal
      isOpen={lightchainResultPreviewOpen && Boolean(lightchainResult)}
      onClose={() => setLightchainResultPreviewOpen(false)}
      title={lightchainResult?.title ?? '結果を拡大表示'}
      size="xl"
    >
      {lightchainResult && (
      <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl bg-black/30">
            <img
              src={lightchainResult.imageUrl}
              alt={lightchainResult.title}
              className="max-h-[72vh] w-full object-contain"
            />
          </div>
          <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">
            {lightchainResult.summary}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleDownloadLightchainResult()}
              data-testid="lightchain-result-download"
              className="inline-flex items-center rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:border-primary-300 hover:text-primary-700 dark:border-white/10 dark:text-neutral-200"
            >
              ダウンロード
            </button>
          </div>
        </div>
      )}
    </Modal>
  ) : null;

  const filteredTools = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return visibleTools.filter((tool) => {
      const categoryMatch = tool.category === activeCategory || activeCategory === 'home' && tool.category === 'home';
      if (!categoryMatch) return false;
      if (!normalized) return true;
      return [
        tool.title,
        tool.description,
        tool.lightchainRoute,
        tool.inputs.join(' '),
        tool.outputs.join(' '),
      ].join(' ').toLowerCase().includes(normalized);
    });
  }, [activeCategory, query]);

  const lightchainReadiness = useMemo(() => {
    const ready = visibleTools.filter((tool) => tool.status === 'ready').length;
    const workspace = visibleTools.filter((tool) => tool.status === 'workspace').length;
    const needsImage = visibleTools.filter((tool) => tool.status === 'needs-image').length;
    return { ready, workspace, needsImage, total: visibleTools.length };
  }, []);

  const quickStartTools = useMemo(() => (
    ['marketing-home', 'ai-fitting', 'model-library', 'image-repair']
      .map((id) => visibleTools.find((tool) => tool.id === id))
      .filter((tool): tool is CompatTool => Boolean(tool))
  ), []);

  const hasCurrentInput = Boolean(
    garmentImageUrl
      || workspaceText.trim()
      || Object.values(materialSlotFiles).some(Boolean),
  );
  const workflowPhase = lightchainResult
    ? { label: '結果あり', detail: '保存して再利用できます。', tone: 'success' as const }
    : hasCurrentInput
      ? { label: '生成準備', detail: '入力を確認してAI生成へ進めます。', tone: 'ready' as const }
      : { label: '入力待ち', detail: 'まず素材か依頼内容を追加します。', tone: 'waiting' as const };

  const isModelRoute = location.pathname === '/model';
  const routeTool = toolId
    ? visibleTools.find((tool) => tool.id === toolId) ?? null
    : isModelRoute
      ? visibleTools.find((tool) => tool.id === 'ai-fitting') ?? null
      : null;
  const isFeatureDetail = Boolean(toolId || isModelRoute);
  const selectedTool = routeTool ?? visibleTools.find((tool) => tool.id === selectedToolId) ?? filteredTools[0] ?? visibleTools[0];
  const lightchainProviderRoute = getLightchainProviderRoute(selectedTool.id);
  const lightchainProviderSupported = isLightchainProviderSupported(selectedTool.id);
  const isPrintingImageGenerationRunning = printingGenerationStatus === 'pending' || printingGenerationStatus === 'processing';
  const isPrintingImageGenerationLocked = isPrintingImageGenerationRunning || printingGenerationRequestRef.current !== null;
  const isPrintingCutoutProcessing = selectedTool.id === 'printing-image'
    && (printingCutoutStatus.primary === 'processing' || printingCutoutStatus.secondary === 'processing');
  const selectedCategory = categories.find((category) => category.id === (isFeatureDetail ? selectedTool.category : activeCategory)) ?? categories[0];
  const isPatternVectorProFlow = selectedTool.id === 'pattern-vector' || selectedTool.id === 'pattern-vector-pro';
  const isFittingDetail = [
    'ai-fitting',
    'ai-fitting-reference',
    'fitting-clothing-reference',
    'fitting-background-reference',
  ].includes(selectedTool.id);
  const currentModelPanel = selectedTool.id === 'model-library'
    ? modelPanelConfig['model-custom']
    : modelPanelConfig[selectedTool.id] ?? null;
  const currentDisplayTitle = currentModelPanel?.title ?? selectedTool.title;
  const isModelToolDetail = isFeatureDetail && Boolean(currentModelPanel);
  const workspaceStyle = selectedTool.id === 'custom-style' ? null : workspaceStyleConfig[selectedTool.id] ?? null;
  const selectedToolActionHref = isFittingDetail ? '/fitting#fitting-material-workbench' : selectedTool.heavyChainHref;
  const workbenchLabels = categoryWorkbenchLabels[selectedTool.category] ?? categoryWorkbenchLabels.home;
  const workbenchEnabled = selectedTool.status !== 'coming-soon';
  const layerIds = workbenchLabels.layers.map(([layer]) => layer);
  const beginnerStep = nextStepConfirmed ? 3 : extractedLayerReady ? 2 : garmentImageUrl ? 1 : 0;
  const selectedCategoryTools = useMemo(
    () => {
      const coreGraphicToolIds = ['fabric-image', 'printing-image', 'line-to-real', 'line-generation'];
      if (coreGraphicToolIds.includes(selectedTool.id)) {
        return coreGraphicToolIds
          .map((id) => visibleTools.find((tool) => tool.id === id))
          .filter((tool): tool is CompatTool => Boolean(tool));
      }
      if (selectedTool.id === 'pattern-vector' || selectedTool.id === 'pattern-vector-pro') {
        return ['pattern-vector', 'pattern-vector-pro']
          .map((id) => visibleTools.find((tool) => tool.id === id))
          .filter((tool): tool is CompatTool => Boolean(tool));
      }
      if (selectedTool.id === 'svg-convert') {
        return ['svg-convert']
          .map((id) => visibleTools.find((tool) => tool.id === id))
          .filter((tool): tool is CompatTool => Boolean(tool));
      }
      if (selectedTool.category === 'model' || selectedTool.id === 'model-library') {
        return modelToolOrder
          .map((id) => visibleTools.find((tool) => tool.id === id))
          .filter((tool): tool is CompatTool => Boolean(tool));
      }
      return visibleTools.filter((tool) => tool.category === selectedTool.category);
    },
    [selectedTool.category, selectedTool.id],
  );

  const unifiedFlowState = deriveUnifiedWorkspaceFlowState({
    inputReady: hasCurrentInput || Boolean(nextStepConfirmed),
    rightsReady: !lightchainProviderSupported || providerRightsConfirmed,
    generating: lightchainGenerationRunning || isPrintingImageGenerationRunning,
    completed: Boolean(lightchainResult) || workspaceArtifacts.length > 0,
    failed: Boolean(lightchainGenerationError || printingGenerationError),
    persisted: workspaceArtifacts.some((artifact) => Boolean(artifact.id)),
  });

  useEffect(() => {
    setFlowState(unifiedFlowState);
  }, [setFlowState, unifiedFlowState]);

  useEffect(() => {
    if (toolId) return;
    const categoryParam = searchParams.get('category');
    if (!categoryParam || !visibleCategories.some((category) => category.id === categoryParam)) return;
    const categoryId = categoryParam as ToolCategory;
    setActiveCategory(categoryId);
    const firstTool = visibleTools.find((tool) => tool.category === categoryId);
    if (firstTool) setSelectedToolId(firstTool.id);
  }, [searchParams, toolId]);
  const flowTabs =
    selectedTool.id === 'image-repair'
        ? ['手足の変形を修正', 'マスクツール']
        : ['素材を入れる', '調整する', 'Canvasへ保存'];
  const primaryUploadLabel =
    selectedTool.id === 'printing-image'
      ? '参考画像をアップロードしてください'
      : selectedTool.id === 'image-repair'
        ? '修復したい画像をアップロードしてください'
        : selectedTool.id === 'fitting-background-reference'
          ? '背景画像をアップロード'
        : workbenchLabels.uploadLabel;
  const secondaryUploadLabel =
    selectedTool.id === 'printing-image'
      ? 'プリントをアップロード'
      : selectedTool.id === 'image-repair'
        ? 'マスクツールで修復範囲を指定'
        : '履歴、ライブラリー、アセットからも選べます。';
  const materialSlots: Array<{ key: MaterialSlotKey; label: string; helper: string; required: boolean }> =
    selectedTool.id === 'printing-image'
      ? [
        { key: 'primary', label: '参考画像をアップロードしてください', helper: '服やモデルの参考画像', required: true },
        { key: 'secondary', label: 'プリントをアップロード', helper: '柄、ロゴ、プリント画像', required: true },
      ]
      : selectedTool.id === 'fabric-image'
        ? [
          { key: 'primary', label: 'モデル/デザイン画像', helper: '服の形や着用イメージ', required: true },
          { key: 'secondary', label: '生地画像', helper: '質感を反映する生地素材', required: true },
        ]
        : currentModelPanel?.variant === 'custom'
          ? []
          : currentModelPanel?.secondaryLabel
            ? [
              { key: 'primary', label: currentModelPanel.primaryLabel ?? '元の画像', helper: 'クリック/ドラッグして追加します。', required: true },
              { key: 'secondary', label: currentModelPanel.secondaryLabel, helper: 'アップロードまたは参考画像ライブラリから選べます。', required: false },
            ]
            : currentModelPanel
              ? [
                { key: 'primary', label: currentModelPanel.primaryLabel ?? '元の画像', helper: 'クリック/ドラッグして追加します。', required: true },
              ]
        : [
          { key: 'primary', label: primaryUploadLabel, helper: workbenchLabels.emptyLabel, required: true },
        ];
  const materialRequirementsMissing = materialSlots.some((slot) => slot.required && !materialSlotFiles[slot.key]);
  const buildCurrentParityRuntime = () => {
    const hasAuthoritativeInput = Boolean(
      materialSlotFiles.primary?.imageUrl
      || garmentImageUrl
      || materialSlotFiles.secondary?.imageUrl,
    );
    const fixtureId = hasAuthoritativeInput
      ? [
        selectedTool.id,
        materialSlotFiles.primary?.imageUrl ?? garmentImageUrl ?? 'none',
        materialSlotFiles.secondary?.imageUrl ?? 'none',
      ].join('|')
      : null;
    return buildLightchainParityRuntime({
      rowId: selectedTool.id,
      inputRoles: buildLightchainParityInputRoles({
        rowId: selectedTool.id,
        slots: materialSlots.map((slot) => ({
          role: slot.key,
          required: slot.required,
          present: Boolean(materialSlotFiles[slot.key]),
        })),
      }),
      fixtureId,
      settings: {
        providerRoute: lightchainProviderRoute,
        referenceNote: referenceNote.trim(),
        brief: brief.trim(),
        workspaceText: workspaceText.trim(),
        modelVariant: currentModelPanel?.variant ?? null,
        garmentCategory,
        cutMode,
        activeLayer,
        printPlacement,
        printScale,
        featureSettings: {
          autoConvertGarment: isFittingDetail ? autoConvertGarment : null,
          fittingTaskTab: isFittingDetail ? activeFittingTaskTab : null,
          fittingInputTab: isFittingDetail ? activeFittingInputTab : null,
          fabricPrompt: selectedTool.id === 'fabric-image' ? fabricPrompt.trim() : null,
          lineDraftType: ['line-to-real', 'line-generation'].includes(selectedTool.id) ? lineDraftType : null,
          lineToRealOutputType: selectedTool.id === 'line-to-real' ? lineToRealImageType : null,
          lineToRealPrompt: selectedTool.id === 'line-to-real' ? lineToRealPrompt.trim() : null,
          lineGenerationImageType: selectedTool.id === 'line-generation' ? lineGenerationImageType : null,
          patternVectorLayers: isPatternVectorProFlow ? patternVectorLayers : null,
          imageRepairMode: selectedTool.id === 'image-repair' ? imageRepairMode : null,
          printingMode: selectedTool.id === 'printing-image' ? printingMode : null,
          wearDesignMode: ['wear-design-lab', 'wear-design-detail'].includes(selectedTool.id) ? wearDesignMode : null,
          wearDesignFocus: ['wear-design-lab', 'wear-design-detail'].includes(selectedTool.id) ? wearDesignFocus : null,
          wearDesignPrompt: ['wear-design-lab', 'wear-design-detail'].includes(selectedTool.id) ? wearDesignPrompt.trim() : null,
          printDesignMode: ['print-design-project', 'print-design-detail'].includes(selectedTool.id) ? printDesignMode : null,
          printDesignStyle: ['print-design-project', 'print-design-detail'].includes(selectedTool.id) ? printDesignStyle : null,
          printDesignPrompt: ['print-design-project', 'print-design-detail'].includes(selectedTool.id) ? printDesignPrompt.trim() : null,
          marketingDetailTab: selectedTool.id === 'marketing-detail' ? marketingDetailTab : null,
          marketingProjectName: selectedTool.id === 'marketing-detail' ? marketingProjectName : null,
          marketingDetailPrompt: selectedTool.id === 'marketing-detail' ? marketingDetailPrompt.trim() : null,
          activeWorkspaceTab: workspaceStyle ? activeWorkspaceTab : null,
          workspaceText: workspaceText.trim() || null,
          modelFormState: currentModelPanel ? modelFormState : null,
        },
      },
    });
  };
  const printingCutoutBlocked = selectedTool.id === 'printing-image'
    && (materialRequirementsMissing
      || printingCutoutStatus.primary !== 'done'
      || printingCutoutStatus.secondary !== 'done');
  // Model subfeatures are image-to-image operations and cannot fall back to a
  // brief-only matrix request. `model-library`/`model-custom` are the only
  // model flows that intentionally support brief-only generation.
  const modelSourceRequired = selectedTool.category === 'model'
    && currentModelPanel?.variant !== 'custom';
  const aiGenerateDisabled = selectedTool.id === 'printing-image'
    ? printingCutoutBlocked
    : modelSourceRequired
      ? materialRequirementsMissing
      : ['fabric-image', 'line-to-real', 'line-generation', 'pattern-vector', 'pattern-vector-pro', 'image-repair'].includes(selectedTool.id)
      ? false
      : materialRequirementsMissing;
  const lightchainToolPanelConfig = useMemo(() => {
    const sharedNotice = 'この機能はまもなく終了します。より高機能な画像生成機能はデザイン制作ワークスペースでご利用ください';
    const base = {
      notice: sharedNotice,
      primaryLabel: '参考画像をアップロードしてください',
      primaryHelp: '20MB以下の画像アップロードしてください',
      secondaryLabel: null as string | null,
      optionLabel: 'アップロードする画像のタイプを選択してください',
      options: [] as string[],
      bottomControl: null as string | null,
    };

    if (selectedTool.id === 'fabric-image') {
      return {
        ...base,
        primaryLabel: '参考画像をアップロードしてください',
        primaryHelp: '20MB以下の画像アップロードしてください',
        secondaryLabel: '生地画像',
        optionLabel: '',
        options: [],
        bottomControl: '画像比率自動',
      };
    }

    if (selectedTool.id === 'line-to-real') {
      return {
        ...base,
        optionLabel: 'アップロードする画像のタイプを選択してください',
        options: ['カラー線画', 'モノクロ線画'],
      };
    }

    if (selectedTool.id === 'line-generation') {
      return {
        ...base,
        optionLabel: 'アップロードする画像のタイプを選択してください',
        options: ['平置き画像', 'モデル図'],
      };
    }

    if (selectedTool.id === 'image-repair') {
      return {
        notice: null,
        primaryLabel: '参考画像をアップロードしてください',
        primaryHelp: '20MB以下の画像アップロードしてください',
        secondaryLabel: null,
        optionLabel: '修復内容を選択します',
        options: ['手足の変形を修正', 'マスクツール'],
        bottomControl: null,
      };
    }

    if (selectedTool.id === 'pattern-vector') {
      return {
        ...base,
        primaryLabel: '参考画像をアップロードしてください',
        optionLabel: 'レイヤー分け方法を選択してください（複数選択可）',
        options: ['積み重ね', '分割'],
      };
    }

    if (selectedTool.id === 'pattern-vector-pro') {
      return {
        ...base,
        primaryLabel: '参考画像をアップロードしてください',
        optionLabel: 'レイヤー分け方法を選択してください（複数選択可）',
        options: ['積み重ね', '分割'],
      };
    }

    if (selectedTool.id === 'svg-convert') {
      return {
        ...base,
        primaryLabel: '参考画像をアップロードしてください',
        optionLabel: '',
        options: [],
      };
    }

    return null;
  }, [selectedTool.id]);

  const getLayerForMaskCandidate = (candidate: MaskCandidate) => {
    const preferredLayer = maskCandidateLayer[candidate];
    if (layerIds.includes(preferredLayer)) return preferredLayer;
    if (candidate === '柄' && layerIds.includes('print')) return 'print';
    if ((candidate === 'トップス' || candidate === '無地部分') && layerIds.includes('garment')) return 'garment';
    if (candidate === '手動範囲' && layerIds.includes('mask')) return 'mask';
    return layerIds[0] ?? preferredLayer;
  };

  const resetWorkbenchMaskState = () => {
    setWorkbenchStep('asset');
    setMaskCandidates([]);
    setSelectedMaskCandidate(null);
    setExtractedLayerReady(false);
    setExtractedGarmentImageUrl(null);
    setCutoutBounds(null);
    setCutoutOutputSize(null);
    setCutoutDataUrlBytes(null);
    setCutoutMaxDataUrlBytes(null);
    setCutoutStoragePolicy(null);
    setMaskEngine(null);
    setNextStepConfirmed(false);
  };

  const applyMaterialToSlot = async (slot: MaterialSlotKey, item: MaterialSlotFile) => {
    const shouldCutoutForPrinting = selectedTool.id === 'printing-image';
    lightchainGenerationSequenceRef.current += 1;
    setLightchainGenerationRunning(false);
    setProviderRightsConfirmed(false);
    setLightchainGenerationError(null);
    setLightchainResult(null);
    setLightchainResultPreviewOpen(false);
    const requestId = shouldCutoutForPrinting ? printingCutoutRequestRef.current[slot] + 1 : 0;
    if (shouldCutoutForPrinting) {
      printingCutoutRequestRef.current[slot] = requestId;
      printingGenerationSequenceRef.current += 1;
      printingGenerationRequestRef.current = null;
      setPrintingGenerationStatus('idle');
      setPrintingGenerationError(null);
      setLightchainResult(null);
      setLightchainResultPreviewOpen(false);
    }
    if (shouldCutoutForPrinting) {
      setPrintingCutoutStatus((current) => ({ ...current, [slot]: 'processing' }));
      setPrintingCutoutErrors((current) => ({ ...current, [slot]: null }));
      setMaterialSlotFiles((current) => ({ ...current, [slot]: null }));
      if (slot === 'primary') setGarmentImageUrl('');
    }

    let nextItem = item;
    try {
      if (shouldCutoutForPrinting) {
        const cutout = slot === 'primary'
          ? await withTimeout(
            buildPrintGarmentCutoutDataUrl({ imageUrl: item.imageUrl }),
            PRINTING_CUTOUT_TIMEOUT_MS,
            '参考画像の透明化がタイムアウトしました。元画像を確認して再試行してください',
          )
          : await withTimeout(
            buildPrintDesignCutoutDataUrl({ imageUrl: item.imageUrl }),
            PRINTING_CUTOUT_TIMEOUT_MS,
            'プリント画像の透明化がタイムアウトしました。元画像を確認して再試行してください',
          );
        if (printingCutoutRequestRef.current[slot] !== requestId) return false;
        nextItem = { ...item, imageUrl: cutout.dataUrl };
        setPrintingCutoutStatus((current) => ({ ...current, [slot]: 'done' }));
      }
    } catch (error) {
      if (shouldCutoutForPrinting && printingCutoutRequestRef.current[slot] !== requestId) return false;
      if (shouldCutoutForPrinting) {
        const message = error instanceof Error ? error.message : '背景を透明化できませんでした。別の画像で再試行してください';
        setPrintingCutoutStatus((current) => ({ ...current, [slot]: 'error' }));
        setPrintingCutoutErrors((current) => ({ ...current, [slot]: message }));
      }
      throw error;
    }

    setMaterialSlotFiles((current) => ({ ...current, [slot]: nextItem }));
    if (slot === 'primary') {
      setGarmentImageUrl(nextItem.imageUrl);
      setGarmentFileName(nextItem.name);
      setGarmentCategory(nextItem.kind);
      setAnalysisStatus('ready');
      setImageRepairGenerating(false);
      if (selectedTool.id === 'printing-image') {
        setPrintArtworkTransform(defaultPrintArtworkTransform);
      }
      resetWorkbenchMaskState();
    }
    return true;
  };

  const openMaterialModalForSlot = (slot: MaterialSlotKey) => {
    setActiveMaterialSlot(slot);
    setMaterialModalOpen(true);
  };

  useEffect(() => {
    const defaults = categoryWorkbenchLabels[selectedTool.category] ?? categoryWorkbenchLabels.home;
    setGarmentCategory(defaults.materialKinds[0] ?? '素材');
    setActiveLayer(defaults.layers[0]?.[0] ?? 'base');
    setPrintPlacement(defaults.placements[0] ?? '中央');
    setPrintArtworkTransform(defaultPrintArtworkTransform);
    setSelectedToolId(selectedTool.id);
    setActiveCategory(selectedTool.category);
    setActiveMaterialSlot('primary');
    setMaterialSlotFiles({ primary: null, secondary: null });
    printingCutoutRequestRef.current.primary += 1;
    printingCutoutRequestRef.current.secondary += 1;
    setPrintingCutoutStatus({ primary: 'idle', secondary: 'idle' });
    setPrintingCutoutErrors({ primary: null, secondary: null });
    setLightchainResult(null);
    setLightchainResultPreviewOpen(false);
    setProviderRightsConfirmed(false);
    setLightchainGenerationRunning(false);
    setLightchainGenerationError(null);
    lightchainGenerationSequenceRef.current += 1;
    setModelFormState(defaultModelFormState);
    setPrintingGenerationStatus('idle');
    setPrintingGenerationError(null);
    printingGenerationSequenceRef.current += 1;
    printingGenerationRequestRef.current = null;
    setPrintingMode('スポット');
    setPrintingNotice('');
    setAutoConvertGarment(true);
    setFabricPrompt('');
    setFabricNotice('');
    setLineDraftType('カラー線画');
    setLineToRealImageType('平置き画像');
    setLineGenerationImageType('平置き画像');
    setPatternVectorLayers(['積み重ね']);
    setLineToRealPrompt('');
    setImageRepairMode('手足の変形を修正');
    setImageRepairGenerating(false);
    setCustomStyleTab('personal');
    setCustomStyleSearch('');
    setWearDesignDetailStarted(false);
    setWearDesignMode('no-guide');
    setWearDesignPrompt('');
    setWearDesignFocus('襟');
    setPrintDesignDetailStarted(false);
    setPrintDesignMode('no-guide');
    setPrintDesignPrompt('');
    setPrintDesignStyle('ファッション');
    setMarketingDetailTab('assistant');
    setMarketingDetailPrompt('');
    setMarketingProjectName('無題のプロジェクト');
    setMarketingProjectNameDraft('無題のプロジェクト');
    setMarketingProjectNameEditing(false);
    setMarketingCanvasTool('選択');
    setMarketingCanvasZoom(20);
    setMarketingTutorialStep(1);
    setMarketingTutorialDismissed(false);
    setWorkspaceTutorialStep(1);
    setWorkspaceTutorialDismissed(false);
    const nextWorkspaceStyle = workspaceStyleConfig[selectedTool.id];
    const nextWorkspaceTab = nextWorkspaceStyle?.tabs?.[0] ?? '';
    const nextWorkspaceText = ['agent', 'studio'].includes(nextWorkspaceStyle?.kind ?? '') ? nextWorkspaceStyle?.prompt ?? '' : '';
    setActiveWorkspaceTab(nextWorkspaceTab);
    setWorkspaceTextDrafts(nextWorkspaceTab ? { [nextWorkspaceTab]: nextWorkspaceText } : {});
    setActiveFittingTaskTab('シングルタスク');
    setActiveFittingInputTab('説明生成');
    setWorkspaceText(nextWorkspaceText);
    resetWorkbenchMaskState();
  }, [selectedTool.category, selectedTool.id]);

  useEffect(() => {
    if (!toolId) return;
    setResumeInputReadback(null);
    const source = hydrateGenerationIntentSource(searchParams);
    const briefParam = searchParams.get('brief')?.trim();
    const projectNameParam = searchParams.get('projectName')?.trim();
    const referenceNoteParam = searchParams.get('referenceNote')?.trim();
    const resumeJob = searchParams.get('resumeJob');
    if (!briefParam && !resumeJob && projectNameParam) {
      if (toolId === 'marketing-detail') {
        setMarketingProjectName(projectNameParam.slice(0, 80));
        setMarketingProjectNameDraft(projectNameParam.slice(0, 80));
      }
      if (referenceNoteParam) setReferenceNote(referenceNoteParam);
      return;
    }
    if (!briefParam && !resumeJob) return;
    if (!resumeJob && !source && !projectNameParam) return;
    if (briefParam) {
      setWorkspaceText(briefParam);
      if (toolId === 'marketing-detail') setMarketingDetailPrompt(briefParam);
    }
    if (projectNameParam && toolId === 'marketing-detail') {
      setMarketingProjectName(projectNameParam.slice(0, 80));
      setMarketingProjectNameDraft(projectNameParam.slice(0, 80));
    }
    if (referenceNoteParam) setReferenceNote(referenceNoteParam);
    if (!resumeJob) return;
    if (!currentBrand?.id || !user?.id) {
      setResumeInputReadback('unavailable');
      return;
    }
    const resumed = readLightchainResumeInput(listWorkspaceArtifacts(currentBrand.id, user?.id), resumeJob);
    if (!resumed) {
      setResumeInputReadback('unavailable');
      return;
    }
    const nextSlots = resumed.slots.reduce<Record<MaterialSlotKey, { name: string; kind: string; imageUrl: string } | null>>(
      (slots, slot) => ({ ...slots, [slot.key]: slot }),
      { primary: null, secondary: null },
    );
    setMaterialSlotFiles(nextSlots);
    const primary = nextSlots.primary;
    if (primary) {
      setGarmentImageUrl(primary.imageUrl);
      setGarmentFileName(primary.name);
      setGarmentCategory(primary.kind);
      setAnalysisStatus('ready');
    }
    if (resumed.modelFormState) {
      setModelFormState((current) => ({ ...current, ...resumed.modelFormState }));
    }
    setResumeInputReadback('restored');
  }, [currentBrand?.id, searchParams, toolId, user?.id]);

  useEffect(() => {
    return () => {
      printingGenerationSequenceRef.current += 1;
      printingGenerationRequestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (selectedTool.id !== 'printing-image') return;
    setPrintPlacement(describePrintPlacement(printArtworkTransform));
    setPrintScale(describePrintScale(printArtworkTransform));
  }, [printArtworkTransform, selectedTool.id]);

  useEffect(() => {
    if (selectedTool.id !== 'printing-image') return;
    if (printingGenerationRequestRef.current !== null) {
      printingGenerationSequenceRef.current += 1;
      printingGenerationRequestRef.current = null;
      setPrintingGenerationStatus('idle');
      setPrintingGenerationError('プリント設定が変更されたため、進行中の生成結果を無効化しました。再生成してください。');
    }
    if (lightchainResultRef.current) {
      setLightchainResult(null);
      setLightchainResultPreviewOpen(false);
    }
  }, [garmentCategory, printArtworkTransform, printingMode, selectedTool.id]);

  const handleCategoryChange = (categoryId: ToolCategory) => {
    setActiveCategory(categoryId);
    setQuery('');
    setMobileToolsExpanded(false);
    setSelectedToolId(visibleTools.find((tool) => tool.category === categoryId)?.id ?? visibleTools[0].id);
  };

  const yieldNextTick = () => new Promise<void>((resolve) => {
    window.setTimeout(resolve, 48);
  });

  const handlePrintingImageGenerate = async () => {
    if (isPrintingImageGenerationLocked) return;
    if (aiGenerateDisabled) {
      toast.error(isPrintingCutoutProcessing ? '背景の透明化が完了するまでお待ちください' : '先に素材画像を選択してください');
      return;
    }
    if (!materialSlotFiles.primary || !materialSlotFiles.secondary) {
      toast.error('参考画像とプリント画像を選択してください');
      return;
    }
    if (!currentBrand) {
      toast.error('ブランドを選択してください');
      return;
    }
    if (!providerRightsConfirmed) {
      toast.error('AI生成前に、アップロード素材の権利・利用許諾を確認してください');
      setLightchainGenerationError('rights_confirmation_required');
      return;
    }

    const requestId = ++printingGenerationSequenceRef.current;
    printingGenerationRequestRef.current = requestId;
    setPrintingGenerationError(null);
    setLightchainGenerationError(null);
    setPrintingGenerationStatus('pending');
    setPrintingNotice('');
    // A retry should not erase the last completed provider result. Material
    // changes invalidate it earlier in applyMaterialToSlot/useEffect.
    setLightchainResultPreviewOpen(false);
    let committed = false;
    let failed = false;

    try {
      await yieldNextTick();
      if (printingGenerationRequestRef.current !== requestId) return;

      setPrintingGenerationStatus('processing');
      await yieldNextTick();
      if (printingGenerationRequestRef.current !== requestId) return;

      if (printingGenerationRequestRef.current !== requestId) return;
      const parityRuntime = buildCurrentParityRuntime();
      const providerPrompt = buildLightchainProviderPrompt({
        toolId: selectedTool.id,
        toolTitle: selectedTool.title,
        summary: `${printingMode} / ${describePrintPlacement(printArtworkTransform)} / ${describePrintScale(printArtworkTransform)}%`,
        primaryName: materialSlotFiles.primary.name,
        secondaryName: materialSlotFiles.secondary.name,
        brief: `${printingMode}でプリントを配置し、${describePrintPlacement(printArtworkTransform)}・${describePrintScale(printArtworkTransform)}%を維持する`,
        referenceNote,
      });
      const providerResult = await editImageWithPrompt(
        materialSlotFiles.primary.imageUrl,
        providerPrompt,
        currentBrand.id,
        {
          referenceImageUrls: [materialSlotFiles.secondary.imageUrl],
          rightsConfirmed: providerRightsConfirmed,
          lightchainCompat: {
            lightchainFeatureId: selectedTool.id,
            lightchainFeatureTitle: selectedTool.title,
            lightchainTaskCodes: [selectedTool.id],
          },
          materialReferences: [
            { slotKey: 'primary', fileName: materialSlotFiles.primary.name, hasImage: true },
            { slotKey: 'secondary', fileName: materialSlotFiles.secondary.name, hasImage: true },
          ],
          compositionPreview: {
            mode: printingMode,
            placement: describePrintPlacement(printArtworkTransform),
            scale: describePrintScale(printArtworkTransform),
            transform: printArtworkTransform,
            parityRuntime,
          },
        },
      );
      assertCompletedImageEditResult(providerResult, 'printing_provider_result');
      const resultTitle = `${selectedTool.title} AI生成結果`;
      const persistedResult = await persistProviderResultArtifact({
        brandId: currentBrand.id,
        scopeId: user?.id,
        featureType: `lightchain-${selectedTool.id}-provider-result`,
        title: resultTitle,
        imageUrl: providerResult.imageUrl,
        prompt: providerPrompt,
        sourceJobId: providerResult.jobId,
        storagePath: providerResult.storagePath,
        requireRemote: true,
        metadata: {
          sourceWorkspace: 'lightchain-workbench-provider-result',
          resultKind: 'provider',
          toolId: selectedTool.id,
          toolTitle: selectedTool.title,
          brief: `${printingMode}でプリントを配置し、${describePrintPlacement(printArtworkTransform)}・${describePrintScale(printArtworkTransform)}%を維持する`,
          referenceNote,
          sourceLabel: selectedTool.title,
          sourceResumePath: `/lightchain/${selectedTool.id}`,
          provider: providerResult.provider ?? 'openai',
          backendProvider: providerResult.backendProvider ?? 'supabase-edge-function',
          imageId: providerResult.imageId ?? null,
          providerModel: providerResult.providerModel ?? null,
          inputFidelity: providerResult.inputFidelity ?? null,
          quality: providerResult.quality ?? null,
          inputImageCount: providerResult.inputImageCount ?? null,
          persistenceStatus: providerResult.persistenceStatus ?? null,
          materialSlotFiles,
          materialSlots: Object.entries(materialSlotFiles).flatMap(([key, file]) => file ? [{
            key,
            fileName: file.name,
            materialKind: file.kind,
            imageUrl: file.imageUrl,
          }] : []),
          printArtworkTransform,
          printingMode,
          parityRuntime: serializeLightchainParityRuntime(parityRuntime),
        },
      });
      setLightchainResult({
        toolId: selectedTool.id,
        title: selectedTool.title,
        summary: `${printingMode} / ${materialSlotFiles.primary?.name ?? '参考画像'} / ${materialSlotFiles.secondary?.name ?? 'プリント画像'} / ${describePrintPlacement(printArtworkTransform)} / ${describePrintScale(printArtworkTransform)}%`,
        imageUrl: providerResult.imageUrl,
        generationMode: 'provider',
        provider: providerResult.provider ?? 'openai',
        backendProvider: providerResult.backendProvider ?? 'supabase-edge-function',
        jobId: persistedResult.remote?.jobId ?? providerResult.jobId ?? null,
        imageId: persistedResult.remote?.imageId ?? providerResult.imageId ?? null,
        storagePath: persistedResult.remote?.storagePath ?? providerResult.storagePath ?? null,
        artifactId: persistedResult.artifact.id,
        parityRuntime: serializeLightchainParityRuntime(parityRuntime),
      });
      setPrintingNotice('OpenAI画像編集の生成結果を生成履歴に反映しました');
      setPrintingGenerationStatus('success');
      toast.success('AI生成結果を履歴に追加しました');
      committed = true;
    } catch (error) {
      if (printingGenerationRequestRef.current === requestId) {
        const message = error instanceof Error ? error.message : '生成に失敗しました';
        failed = true;
        setPrintingGenerationError(message);
        setPrintingGenerationStatus('error');
        // Keep the previous result available for inspection and retry.
        setLightchainResultPreviewOpen(false);
        toast.error(message);
      }
    } finally {
      if (printingGenerationRequestRef.current === requestId) {
        printingGenerationRequestRef.current = null;
        // Keep the success state visible while allowing another generation;
        // failures retain the previous result and expose the retry action.
        if (!committed && !failed) {
          setPrintingGenerationStatus('error');
        }
      }
    }
  };

  if (toolId && !routeTool) {
    return <Navigate to="/lightchain" replace />;
  }

  const handleMaterialSlotUpload = async (slot: MaterialSlotKey, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      toast.error('素材画像は20MB以下にしてください');
      event.target.value = '';
      return;
    }

    try {
      const imageUrl = await readFileAsDataUrl(file);
      const slotConfig = materialSlots.find((materialSlot) => materialSlot.key === slot);
      const applied = await applyMaterialToSlot(slot, {
        name: file.name,
        kind: slot === 'secondary' || selectedTool.id === 'fitting-background-reference'
          ? slotConfig?.label ?? '追加素材'
          : garmentCategory,
        imageUrl,
        sourceImageId: null,
        sourceStoragePath: null,
      });
      if (applied) toast.success('素材画像を読み込み、編集レイヤーを準備しました');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '画像を読み込めませんでした');
    } finally {
      event.target.value = '';
    }
  };

  const handleUseMaterialAsset = async (item: MaterialTabItem) => {
    try {
      const applied = await applyMaterialToSlot(activeMaterialSlot, {
        name: item.title,
        kind: item.kind,
        imageUrl: item.imageUrl,
        sourceImageId: item.sourceImageId ?? null,
        sourceStoragePath: item.sourceStoragePath ?? null,
      });
      if (applied) {
        setMaterialModalOpen(false);
        toast.success(`${item.title}を使用しました`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '素材画像の背景を透明化できませんでした');
    }
  };

  const persistFittingActionHandoff = () => {
    if (!isFittingDetail || !currentBrand?.id || !user?.id) return true;
    const source = materialSlotFiles.primary;
    if (!source?.imageUrl) return true;

    const materialState: MaterialReferenceState = {
      imageUrl: source.imageUrl,
      fileName: source.name,
      sourceImageId: source.sourceImageId ?? null,
      sourceStoragePath: source.sourceStoragePath ?? null,
      materialKind: selectedTool.id === 'fitting-background-reference'
        ? '背景参照'
        : source.kind,
      maskMode: cutMode,
      activeLayer: selectedTool.id === 'fitting-background-reference' ? '背景' : activeLayer,
      placement: selectedTool.id === 'fitting-background-reference' ? '背景全面' : printPlacement,
      scale: printScale,
      note: [
        referenceNote,
        `Lightchainから${selectedTool.title}の素材を引き継ぎ`,
      ].filter(Boolean).join(' / '),
      extractedLayerReady: false,
      extractedImageUrl: null,
      nextStepReady: false,
      maskEngine: null,
    };
    const preparedMaterialReference = prepareFittingDraftMaterialReferenceForPersistence(
      buildMaterialReferenceMetadata(materialState),
      source.imageUrl,
    );
    if (!preparedMaterialReference) return true;

    const persisted = saveWorkspaceArtifactPersisted({
      id: `fitting-draft-${currentBrand.id}`,
      brandId: currentBrand.id,
      scopeId: user.id,
      featureType: 'fitting-background-draft',
      title: `AIフィッティング入力 / ${source.name || 'Lightchain素材'}`,
      imageUrl: preparedMaterialReference.imageUrl ?? '',
      prompt: brief,
      metadata: {
        feature: 'fitting-background-draft',
        draftVersion: 'fitting-background-draft-v1',
        sourceImageId: preparedMaterialReference.sourceImageId ?? null,
        sourceStoragePath: preparedMaterialReference.sourceStoragePath ?? null,
        sourceWorkspace: 'lightchain-workbench',
        lightchainFeatureId: selectedTool.id,
        materialReference: preparedMaterialReference,
      },
    });
    if (!persisted.ok) {
      toast.error(`Fitting入力の保存確認に失敗しました。${getErrorMessage(persisted.error)}`);
      return false;
    }
    return true;
  };

  const handleFittingActionClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!persistFittingActionHandoff()) event.preventDefault();
  };

  const updateModelFormState = <Key extends keyof ModelFormState>(key: Key, value: ModelFormState[Key]) => {
    setModelFormState((current) => ({ ...current, [key]: value }));
  };

  const setUploadedAssetResult = ({
    toolId,
    title,
    summary,
    mode = 'asset',
    includeSecondary = true,
  }: {
    toolId: string;
    title: string;
    summary: string;
    mode?: AssetAnchoredPreviewMode;
    includeSecondary?: boolean;
  }) => {
    const sourceImageUrl = materialSlotFiles.primary?.imageUrl || garmentImageUrl;
    if (!sourceImageUrl) return false;
    setLightchainResult({
      toolId,
      title,
      summary,
      imageUrl: buildAssetAnchoredPreviewDataUrl({
        sourceImageUrl,
        secondaryImageUrl: includeSecondary ? materialSlotFiles.secondary?.imageUrl : undefined,
        title,
        summary,
        mode,
      }),
    });
    return true;
  };

  const handleLightchainPreviewGenerate = async (overrides?: {
    summary?: string;
    title?: string;
    brief?: string;
    allowBriefOnly?: boolean;
  }) => {
    if (selectedTool.id === 'fabric-image' && materialRequirementsMissing) {
      setFabricNotice('先に生地をアップロードしてください');
      toast.error('先に生地をアップロードしてください');
      return;
    }
    if (selectedTool.id === 'svg-convert' && materialRequirementsMissing) {
      toast.error('先に参考画像をアップロードしてください');
      return;
    }
    if (selectedTool.id === 'image-repair') {
      if (materialRequirementsMissing) {
        toast.error('先に参考画像をアップロードしてください');
        return;
      }
    }
    if (aiGenerateDisabled && !isFittingDetail && !overrides?.allowBriefOnly) {
      toast.error('先に素材画像を選択してください');
      return;
    }
    if (selectedTool.id === 'fabric-image') setFabricNotice('');

    const lineToRealSummary = [
      materialSlotFiles.primary?.name ?? '参考画像',
      lineDraftType,
      lineToRealImageType,
      lineToRealPrompt.trim() || null,
    ].filter(Boolean).join(' / ');
    const lineGenerationSummary = [
      materialSlotFiles.primary?.name ?? '参考画像',
      lineGenerationImageType,
      '線画',
    ].filter(Boolean).join(' / ');
    const patternVectorSummary = [
      materialSlotFiles.primary?.name ?? '参考画像',
      patternVectorLayers.join(' + ') || '積み重ね',
      'AI生成 1',
    ].filter(Boolean).join(' / ');
    const svgConvertSummary = [
      materialSlotFiles.primary?.name ?? '参考画像',
      'ベクター画像へ変換（通常モード）',
    ].filter(Boolean).join(' / ');
    const imageRepairSummary = [
      materialSlotFiles.primary?.name ?? '参考画像',
      imageRepairMode,
      imageRepairMode === 'マスクツール' ? 'マスク範囲を選択' : '手足や顔の変形を修復',
    ].filter(Boolean).join(' / ');
    const fabricSummary = [
      materialSlotFiles.primary?.name ?? 'モデル/デザイン画像',
      materialSlotFiles.secondary?.name ?? '生地画像',
      lightchainToolPanelConfig?.bottomControl ?? null,
      fabricPrompt.trim() || null,
    ].filter(Boolean).join(' / ');
    const fittingSummary = [
      selectedTool.title,
      materialSlotFiles.primary?.name ?? '衣服画像',
      referenceNote.trim() || null,
    ].filter(Boolean).join(' / ');
    const modelSummary = selectedTool.id === 'fabric-image'
      ? fabricSummary
      : selectedTool.id === 'line-to-real'
        ? lineToRealSummary
      : selectedTool.id === 'line-generation'
        ? lineGenerationSummary
      : isPatternVectorProFlow
        ? patternVectorSummary
      : selectedTool.id === 'svg-convert'
        ? svgConvertSummary
      : selectedTool.id === 'image-repair'
        ? imageRepairSummary
      : isFittingDetail
        ? fittingSummary
      : currentModelPanel
      ? [
        currentModelPanel.title,
	        currentModelPanel.variant === 'custom' ? `${modelFormState.gender} / ${modelFormState.age} / ${modelFormState.nationality}` : null,
	        currentModelPanel.variant === 'body' ? `${modelFormState.bodyGender} / ${modelFormState.bodyType} / カスタムボディ${modelFormState.customBody}` : null,
	        currentModelPanel.variant === 'size' ? `${modelFormState.garmentType} / ${modelFormState.sourceSize}→${modelFormState.targetSize}` : null,
	        currentModelPanel.variant === 'angle' ? `左右${modelFormState.angleHorizontal} / 上下${modelFormState.angleVertical} / 距離${modelFormState.angleZoom} / 背面${modelFormState.backView}` : null,
		        currentModelPanel.variant === 'uploadPair' ? `${currentModelPanel.secondaryLabel ?? '参考画像'}: ${materialSlotFiles.secondary?.name ?? 'ランダム参考'}` : null,
        selectedTool.id === 'model-change' ? `サイズ維持${modelFormState.keepSize}` : null,
      ].filter(Boolean).join(' / ')
      : selectedTool.title;
    const generationSummary = overrides?.summary ?? modelSummary;
    const generationTitle = overrides?.title ?? currentDisplayTitle;
    const providerSourceImageUrl = materialSlotFiles.primary?.imageUrl || garmentImageUrl || undefined;
    // Do not silently convert an image-edit route into a brief-only image
    // generation route. The explicit `allowBriefOnly` path is the only place
    // where a workspace may request a text-driven preview.
    const effectiveProviderRoute = lightchainProviderRoute === 'edit-image' && overrides?.allowBriefOnly && !providerSourceImageUrl
      ? 'generate-image'
      : lightchainProviderRoute;

    if (!currentBrand) {
      toast.error('ブランドを選択してください');
      return;
    }
    if (!lightchainProviderSupported) {
      const message = 'video_provider_not_admitted: 動画providerの利用可能状態が未確認です';
      setLightchainGenerationError(message);
      toast.error(message);
      return;
    }
    if (effectiveProviderRoute === 'edit-image' && !providerSourceImageUrl && !overrides?.allowBriefOnly) {
      const message = `provider_input_missing:${selectedTool.id}`;
      setLightchainGenerationError(message);
      toast.error('先に主素材画像を選択してください');
      return;
    }
    if (!providerRightsConfirmed) {
      const message = 'rights_confirmation_required';
      setLightchainGenerationError(message);
      toast.error('AI生成前に、アップロード素材の権利・利用許諾を確認してください');
      return;
    }

    const requestId = ++lightchainGenerationSequenceRef.current;
    setLightchainGenerationRunning(true);
    setLightchainGenerationError(null);
    // Keep the last successful result visible while a retry is running. Input
    // changes reset the result at their source boundary; a provider failure
    // must not discard the last recoverable artifact.
    setLightchainResultPreviewOpen(false);
    if (selectedTool.id === 'image-repair') setImageRepairGenerating(true);
    try {
      const parityRuntime = buildCurrentParityRuntime();
      const providerPrompt = buildLightchainProviderPrompt({
        toolId: selectedTool.id,
        toolTitle: generationTitle,
        summary: generationSummary,
        primaryName: materialSlotFiles.primary?.name ?? garmentFileName,
        secondaryName: materialSlotFiles.secondary?.name,
        brief: overrides?.brief ?? brief,
        referenceNote,
        briefOnly: effectiveProviderRoute === 'generate-image'
          || (effectiveProviderRoute === 'model-matrix' && !providerSourceImageUrl && !modelSourceRequired),
      });
      const materialReferences = Object.entries(materialSlotFiles)
        .filter(([, file]) => Boolean(file))
        .map(([slotKey, file]) => ({
          slotKey,
          fileName: file?.name ?? null,
          materialKind: file?.kind ?? null,
          hasImage: Boolean(file),
        }));
      const lightchainCompat = {
        lightchainFeatureId: selectedTool.id,
        lightchainFeatureTitle: selectedTool.title,
        lightchainTaskCodes: [selectedTool.id],
      };
      let providerImageUrl: string | undefined;
      let providerJobId: string | null | undefined;
      let providerImageId: string | null | undefined;
      let providerStoragePath: string | undefined;
      let providerName = 'openai';
      let backendProvider = 'supabase-edge-function';

      if (effectiveProviderRoute === 'model-matrix') {
        const bodyType = modelFormState.bodyType.includes('スマート') ? 'slim' : modelFormState.bodyType.includes('プラス') ? 'plus' : 'regular';
        const ageGroup = modelFormState.age.includes('30') ? '30s' : modelFormState.age.includes('40') ? '40s' : modelFormState.age.includes('50') ? '50s' : '20s';
        const gender = (modelFormState.gender || modelFormState.bodyGender).includes('男') ? 'male' : 'female';
        const modelResult = await generateModelMatrix(generationSummary, currentBrand.id, {
          bodyTypes: [bodyType],
          ageGroups: [ageGroup],
          gender,
          imageUrl: providerSourceImageUrl,
          modelReferenceImageUrl: materialSlotFiles.secondary?.imageUrl,
          rightsConfirmed: providerRightsConfirmed,
          lightchainCompat,
          materialReferences,
          layerPlan: { source: providerSourceImageUrl ? 'uploaded-primary' : 'brief-only', secondaryReference: Boolean(materialSlotFiles.secondary) },
          compositionPreview: { summary: generationSummary, route: selectedTool.lightchainRoute, parityRuntime },
        });
        assertCompletedModelMatrixResult(modelResult);
        providerImageUrl = modelResult.matrix[0].imageUrl;
        providerJobId = modelResult.jobId;
        providerImageId = modelResult.matrix[0].imageId ?? null;
        providerStoragePath = modelResult.matrix[0].storagePath;
        backendProvider = 'supabase-edge-function:model-matrix';
      } else if (effectiveProviderRoute === 'edit-image') {
        if (!providerSourceImageUrl) throw new Error(`provider_input_missing:${selectedTool.id}`);
        const editResult = await editImageWithPrompt(providerSourceImageUrl, providerPrompt, currentBrand.id, {
          referenceImageUrls: materialSlotFiles.secondary?.imageUrl ? [materialSlotFiles.secondary.imageUrl] : [],
          rightsConfirmed: providerRightsConfirmed,
          lightchainCompat,
          materialReferences,
          layerPlan: { source: 'uploaded-primary', secondaryReference: Boolean(materialSlotFiles.secondary) },
          compositionPreview: { summary: generationSummary, route: selectedTool.lightchainRoute, parityRuntime },
        });
        providerImageUrl = editResult.imageUrl;
        providerJobId = editResult.jobId;
        providerImageId = editResult.imageId;
        providerStoragePath = editResult.storagePath;
        providerName = editResult.provider ?? providerName;
        backendProvider = editResult.backendProvider ?? backendProvider;
        assertCompletedImageEditResult(editResult, 'provider_edit_result');
      } else {
        const generatedResult = await generateImage(providerPrompt, currentBrand.id, {
          generationProvider: 'openai_image',
          featureType: `lightchain-${selectedTool.id}`,
          lightchainCompat,
          materialReferences,
          compositionPreview: { summary: generationSummary, route: selectedTool.lightchainRoute, parityRuntime },
          rightsConfirmed: providerRightsConfirmed,
        });
        providerImageUrl = generatedResult.imageUrl;
        providerJobId = generatedResult.jobId;
        providerImageId = generatedResult.imageId;
        providerStoragePath = generatedResult.storagePath;
        providerName = generatedResult.provider ?? providerName;
        backendProvider = generatedResult.backendProvider ?? backendProvider;
        assertCompletedImageEditResult(generatedResult, 'provider_generate_result');
      }

      if (lightchainGenerationSequenceRef.current !== requestId) return;
      if (!providerImageUrl) throw new Error('provider_result_image_missing');
      const resultTitle = `${generationTitle} AI生成結果`;
      const persistedResult = await persistProviderResultArtifact({
        brandId: currentBrand.id,
        scopeId: user?.id,
        featureType: `lightchain-${selectedTool.id}-provider-result`,
        title: resultTitle,
        imageUrl: providerImageUrl,
        prompt: providerPrompt,
        sourceJobId: providerJobId,
        storagePath: providerStoragePath,
        requireRemote: true,
        metadata: {
          sourceWorkspace: 'lightchain-workbench-provider-result',
          resultKind: 'provider',
          toolId: selectedTool.id,
          toolTitle: selectedTool.title,
          brief,
          referenceNote,
          sourceLabel: selectedTool.title,
          sourceResumePath: `/lightchain/${selectedTool.id}`,
          provider: providerName,
          backendProvider,
          imageId: providerImageId ?? null,
          providerModel: effectiveProviderRoute,
          materialReferences,
          materialSlots: Object.entries(materialSlotFiles).flatMap(([key, file]) => file ? [{
            key,
            fileName: file.name,
            materialKind: file.kind,
            imageUrl: file.imageUrl,
          }] : []),
          lightchainCompat,
          parityRuntime: serializeLightchainParityRuntime(parityRuntime),
          modelFormState: currentModelPanel ? modelFormState : null,
          generationSummary,
        },
      });
      setLightchainResult({
        toolId: selectedTool.id,
        title: resultTitle,
        summary: generationSummary,
        imageUrl: providerImageUrl,
        generationMode: 'provider',
        provider: providerName,
        backendProvider,
        jobId: persistedResult.remote?.jobId ?? providerJobId ?? null,
        imageId: persistedResult.remote?.imageId ?? providerImageId ?? null,
        storagePath: persistedResult.remote?.storagePath ?? providerStoragePath ?? null,
        artifactId: persistedResult.artifact.id,
        parityRuntime: serializeLightchainParityRuntime(parityRuntime),
      });
      toast.success('AI生成結果を履歴に追加しました');
    } catch (error) {
      if (lightchainGenerationSequenceRef.current !== requestId) return;
      const message = error instanceof Error ? error.message : 'provider_generation_failed';
      setLightchainGenerationError(message);
      // Preserve the previous result so the user can inspect it or retry
      // without losing the last completed artifact.
      toast.error(message);
    } finally {
      if (lightchainGenerationSequenceRef.current === requestId) {
        setLightchainGenerationRunning(false);
        setImageRepairGenerating(false);
      }
    }
    return;

    const sourceImageUrl = materialSlotFiles.primary?.imageUrl || garmentImageUrl;
    if (sourceImageUrl) {
      const previewMode = selectedTool.id === 'line-generation'
        ? 'line-art'
        : selectedTool.id === 'line-to-real'
          ? 'asset'
          : isPatternVectorProFlow
            ? 'pattern'
            : selectedTool.id === 'svg-convert'
              ? 'vector'
              : currentModelPanel
                ? 'model'
                : 'asset';
      const anchoredPreview = buildAssetAnchoredPreviewDataUrl({
        sourceImageUrl,
        secondaryImageUrl: materialSlotFiles.secondary?.imageUrl,
        title: currentDisplayTitle,
        summary: modelSummary,
        mode: previewMode,
      });
      const resultTitle = selectedTool.id === 'svg-convert'
        ? 'SVGプレビュー'
        : ['line-to-real', 'line-generation', 'pattern-vector', 'pattern-vector-pro'].includes(selectedTool.id)
          ? `${currentDisplayTitle}プレビュー`
          : currentModelPanel
            ? `${currentDisplayTitle}プレビュー`
            : currentDisplayTitle;
      setLightchainResult({
        toolId: selectedTool.id,
        title: resultTitle,
        summary: modelSummary,
        imageUrl: anchoredPreview,
      });
      toast.success('入力素材を保持した生成プレビューを履歴に追加しました');
      return;
    }

    const preview = encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">
        <rect width="900" height="560" fill="#050909"/>
        <rect x="74" y="64" width="752" height="432" rx="26" fill="#101719" stroke="#1f2a2d" stroke-width="3"/>
        ${selectedTool.id === 'fabric-image'
          ? '<path d="M326 134h248l78 144-68 178H316l-68-178z" fill="#e5e7eb"/><path d="M294 248c42-22 82-22 124 0s82 22 124 0 82-22 124 0v164H294z" fill="#65d3cf" opacity="0.72"/><path d="M296 316c42-20 82-20 124 0s82 20 124 0 82-20 124 0" fill="none" stroke="#0f766e" stroke-width="14" opacity="0.55"/>'
          : selectedTool.id === 'line-to-real'
            ? '<rect x="282" y="132" width="336" height="292" rx="22" fill="#f8fafc"/><path d="M350 196c58-38 142-38 200 0M354 250h192M380 304h140M402 358h96" fill="none" stroke="#111827" stroke-width="18" stroke-linecap="round"/><rect x="570" y="286" width="96" height="92" rx="20" fill="#65d3cf" opacity="0.82"/>'
          : selectedTool.id === 'line-generation'
            ? '<rect x="280" y="126" width="340" height="310" rx="18" fill="#f8fafc"/><path d="M364 188c42-28 130-28 172 0v212H364z" fill="none" stroke="#111827" stroke-width="14" stroke-linejoin="round"/><path d="M364 226h172M392 280h116M404 334h92" fill="none" stroke="#111827" stroke-width="10" stroke-linecap="round"/><path d="M294 184h76M530 184h76" fill="none" stroke="#111827" stroke-width="12" stroke-linecap="round"/>'
          : isPatternVectorProFlow
            ? '<rect x="258" y="126" width="384" height="306" rx="22" fill="#f8fafc"/><path d="M312 194c54-44 122-44 176 0s78 44 118 0" fill="none" stroke="#0f172a" stroke-width="16" stroke-linecap="round"/><path d="M310 272c70-48 132-48 188 0s86 48 112 0M334 356c56-36 116-36 178 0" fill="none" stroke="#65d3cf" stroke-width="14" stroke-linecap="round"/><circle cx="450" cy="274" r="44" fill="none" stroke="#111827" stroke-width="12"/>'
          : selectedTool.id === 'svg-convert'
            ? '<rect x="286" y="124" width="328" height="308" rx="18" fill="#f8fafc"/><path d="M362 190h176l50 86-46 120H358l-46-120z" fill="none" stroke="#111827" stroke-width="14" stroke-linejoin="round"/><path d="M340 260h220M374 318h152M408 366h84" fill="none" stroke="#65d3cf" stroke-width="12" stroke-linecap="round"/><text x="450" y="230" text-anchor="middle" fill="#111827" font-family="Arial, sans-serif" font-size="34" font-weight="800">SVG</text>'
          : selectedTool.id === 'image-repair'
            ? '<rect x="268" y="118" width="364" height="318" rx="22" fill="#f8fafc"/><path d="M348 190c42-30 162-30 204 0v162c0 52-46 88-102 88s-102-36-102-88z" fill="#ffffff" stroke="#d1d5db" stroke-width="8"/><path d="M364 244h172M384 298h132M404 354h92" fill="none" stroke="#111827" stroke-width="10" stroke-linecap="round" opacity="0.28"/><circle cx="560" cy="186" r="30" fill="#65d3cf"/><path d="M546 186h28M560 172v28" stroke="#052f2f" stroke-width="8" stroke-linecap="round"/><path d="M322 374c44-34 214-34 258 0" fill="none" stroke="#65d3cf" stroke-width="16" stroke-linecap="round" opacity="0.82"/>'
          : '<circle cx="450" cy="206" r="72" fill="#65d3cf" opacity="0.92"/><rect x="326" y="288" width="248" height="86" rx="43" fill="#e5e7eb"/>'}
        <text x="450" y="426" text-anchor="middle" fill="#65d3cf" font-family="Arial, sans-serif" font-size="30" font-weight="800">${escapeSvgText(truncateSvgText(currentDisplayTitle, 18))}</text>
        <text x="450" y="462" text-anchor="middle" fill="#9ca3af" font-family="Arial, sans-serif" font-size="18">${escapeSvgText(truncateSvgText(modelSummary, 48))}</text>
      </svg>
    `);

    setLightchainResult({
      toolId: selectedTool.id,
      title: selectedTool.id === 'svg-convert'
        ? 'SVGプレビュー'
        : selectedTool.id === 'image-repair'
          ? '画像修正プレビュー'
        : ['line-to-real', 'line-generation', 'pattern-vector', 'pattern-vector-pro'].includes(selectedTool.id)
          ? '生成中...'
        : currentModelPanel
          ? `${currentDisplayTitle}プレビュー`
          : currentDisplayTitle,
      summary: modelSummary,
      imageUrl: preview,
    });
    toast.success('履歴にプレビューを追加しました');
  };

  const handleWorkspaceStyleGenerate = async () => {
    const request = workspaceText.trim() || workspaceStyle?.prompt || selectedTool.promptTemplate;
    const workspaceSummary = selectedTool.id === 'fashion-studio'
      ? `${workspaceStyle?.tabs?.includes(activeWorkspaceTab) ? activeWorkspaceTab : workspaceStyle?.tabs?.[0] ?? 'スタジオ案'} / 生成済みプレビュー / ${request}`
      : request;
    await handleLightchainPreviewGenerate({
      title: workspaceStyle?.title ?? selectedTool.title,
      summary: workspaceSummary,
      brief: request,
      allowBriefOnly: true,
    });
  };

  const handleProjectHomeGenerate = async () => {
    const summary = [
      selectedTool.promptTemplate,
      selectedTool.inputs.join(' / '),
      selectedTool.outputs.join(' / '),
    ].join(' / ');
    await handleLightchainPreviewGenerate({
      title: `${selectedTool.title} AI生成`,
      summary,
      brief: selectedTool.promptTemplate,
      allowBriefOnly: true,
    });
    return;
    if (setUploadedAssetResult({
      toolId: selectedTool.id,
      title: `${selectedTool.title}プレビュー`,
      summary,
      mode: selectedTool.category === 'graphics' ? 'pattern' : selectedTool.category === 'model' ? 'model' : 'asset',
    })) {
      toast.success('入力素材を保持したプレビューを履歴に追加しました');
      return;
    }
    const preview = encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="980" height="620" viewBox="0 0 980 620">
        <rect width="980" height="620" fill="#0b0f10"/>
        <rect x="72" y="68" width="836" height="484" rx="34" fill="#171c1f" stroke="#65d3cf" stroke-width="3"/>
        <rect x="132" y="126" width="238" height="300" rx="28" fill="#f8fafc"/>
        <path d="M176 220c44-34 104-34 148 0s72 34 106 0v154H176z" fill="#0f172a" opacity="0.9"/>
        <path d="M176 286c44-34 104-34 148 0s72 34 106 0" fill="none" stroke="#65d3cf" stroke-width="16" stroke-linecap="round"/>
        <rect x="438" y="142" width="320" height="38" rx="19" fill="#65d3cf" opacity="0.34"/>
        <rect x="438" y="222" width="390" height="24" rx="12" fill="#ffffff" opacity="0.15"/>
        <rect x="438" y="276" width="312" height="24" rx="12" fill="#ffffff" opacity="0.11"/>
        <rect x="438" y="376" width="180" height="48" rx="24" fill="#65d3cf"/>
        <text x="528" y="407" text-anchor="middle" fill="#062c2b" font-family="Arial, sans-serif" font-size="20" font-weight="800">Canvas</text>
        <text x="132" y="496" fill="#65d3cf" font-family="Arial, sans-serif" font-size="30" font-weight="800">${escapeSvgText(truncateSvgText(selectedTool.title, 22))}</text>
        <text x="132" y="532" fill="#a3a3a3" font-family="Arial, sans-serif" font-size="18">${escapeSvgText(truncateSvgText(selectedTool.promptTemplate, 72))}</text>
      </svg>
    `);
    setLightchainResult({
      toolId: selectedTool.id,
      title: `${selectedTool.title}プレビュー`,
      summary,
      imageUrl: preview,
    });
    toast.success('履歴にプレビューを追加しました');
  };

  const handleCustomStyleSave = async () => {
    const summary = [
      customStyleTab === 'personal' ? 'パーソナルスペース' : 'チームスペース',
      customStyleSearch.trim() || '名前未入力',
      '学習素材 30〜50枚',
      '比率統一',
    ].join(' / ');
    await handleLightchainPreviewGenerate({
      title: 'カスタムスタイルAI生成',
      summary,
      brief: customStyleSearch.trim() || 'アップロード素材から一貫したカスタムスタイルを作成',
      allowBriefOnly: true,
    });
    return;
    if (setUploadedAssetResult({
      toolId: selectedTool.id,
      title: 'カスタムスタイル保存プレビュー',
      summary,
      mode: 'model',
    })) {
      toast.success('入力素材を保持したカスタムスタイルを保存しました');
      return;
    }
    const preview = encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">
        <rect width="900" height="560" fill="#0f1416"/>
        <rect x="70" y="62" width="760" height="436" rx="28" fill="#171c1f" stroke="#253034" stroke-width="3"/>
        <rect x="118" y="116" width="156" height="218" rx="18" fill="#dbeafe"/>
        <rect x="312" y="116" width="156" height="218" rx="18" fill="#fee2e2"/>
        <rect x="506" y="116" width="156" height="218" rx="18" fill="#dcfce7"/>
        <path d="M158 272c24-40 52-60 84-60s62 20 84 60" fill="none" stroke="#0f172a" stroke-width="14" stroke-linecap="round"/>
        <path d="M354 278c28-46 58-70 94-70s66 24 88 70" fill="none" stroke="#0f172a" stroke-width="14" stroke-linecap="round"/>
        <path d="M548 276c24-44 54-66 90-66s66 22 88 66" fill="none" stroke="#0f172a" stroke-width="14" stroke-linecap="round"/>
        <rect x="118" y="352" width="544" height="24" rx="12" fill="#65d3cf" opacity="0.32"/>
        <rect x="118" y="394" width="430" height="18" rx="9" fill="#ffffff" opacity="0.14"/>
        <text x="450" y="454" text-anchor="middle" fill="#65d3cf" font-family="Arial, sans-serif" font-size="30" font-weight="800">カスタムスタイル</text>
        <text x="450" y="488" text-anchor="middle" fill="#a3a3a3" font-family="Arial, sans-serif" font-size="18">${escapeSvgText(truncateSvgText(summary, 54))}</text>
      </svg>
    `);
    setLightchainResult({
      toolId: selectedTool.id,
      title: 'カスタムスタイル保存プレビュー',
      summary,
      imageUrl: preview,
    });
    toast.success('カスタムスタイルをライブラリに保存しました');
  };

  const handleWearDesignStart = async (mode: 'guide' | 'no-guide') => {
    setWearDesignMode(mode);
    setWearDesignDetailStarted(true);
    const summary = [
      mode === 'guide' ? 'ガイドを見る' : 'ガイド無しで開始します',
      `変更箇所: ${wearDesignFocus}`,
      materialSlotFiles.primary?.name ?? '画像追加待ち',
      wearDesignPrompt.trim() || 'ディテール変更',
    ].join(' / ');
    await handleLightchainPreviewGenerate({
      title: 'ディテール変更AI生成',
      summary,
      brief: `${wearDesignFocus}のディテール変更: ${wearDesignPrompt.trim() || 'ディテール変更'}`,
      allowBriefOnly: true,
    });
    return;
    if (setUploadedAssetResult({
      toolId: 'wear-design-detail',
      title: 'ディテール変更プレビュー',
      summary,
      mode: 'asset',
    })) {
      toast.success(mode === 'guide' ? '入力素材を保持したガイドを表示しました' : '入力素材を保持した詳細プレビューを作成しました');
      return;
    }
    const preview = encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">
        <rect width="900" height="560" fill="#090d0f"/>
        <rect x="68" y="58" width="764" height="444" rx="30" fill="#151b1e" stroke="#263034" stroke-width="3"/>
        <rect x="116" y="112" width="262" height="330" rx="22" fill="#f8fafc"/>
        <path d="M188 188h118l44 78-38 118H182l-38-118z" fill="#ffffff" stroke="#111827" stroke-width="10" stroke-linejoin="round"/>
        <path d="M170 282c28-18 54-18 82 0s54 18 82 0" fill="none" stroke="#65d3cf" stroke-width="18" stroke-linecap="round"/>
        <rect x="438" y="132" width="282" height="36" rx="18" fill="#65d3cf" opacity="0.34"/>
        <rect x="438" y="204" width="210" height="22" rx="11" fill="#ffffff" opacity="0.16"/>
        <rect x="438" y="252" width="248" height="22" rx="11" fill="#ffffff" opacity="0.12"/>
        <rect x="438" y="332" width="156" height="46" rx="23" fill="#65d3cf"/>
        <text x="516" y="362" text-anchor="middle" fill="#062c2b" font-family="Arial, sans-serif" font-size="20" font-weight="800">AI生成</text>
        <text x="116" y="472" fill="#65d3cf" font-family="Arial, sans-serif" font-size="26" font-weight="800">ウェアデザイン詳細</text>
        <text x="438" y="430" fill="#a3a3a3" font-family="Arial, sans-serif" font-size="18">${escapeSvgText(truncateSvgText(summary, 48))}</text>
      </svg>
    `);
    setLightchainResult({
      toolId: 'wear-design-detail',
      title: 'ディテール変更プレビュー',
      summary,
      imageUrl: preview,
    });
    toast.success(mode === 'guide' ? 'ガイドを表示しました' : 'ガイド無しで開始します');
  };

  const handlePrintDesignStart = async (mode: 'guide' | 'no-guide') => {
    setPrintDesignMode(mode);
    setPrintDesignDetailStarted(true);
    const summary = [
      mode === 'guide' ? 'ガイドを表示する' : 'ガイド無しで開始します',
      `用途: ${printDesignStyle}`,
      materialSlotFiles.primary?.name ?? '画像追加待ち',
      printDesignPrompt.trim() || 'プリント編集',
    ].join(' / ');
    await handleLightchainPreviewGenerate({
      title: '柄・グラフィックAI生成',
      summary,
      brief: `${printDesignStyle}向けのプリント編集: ${printDesignPrompt.trim() || 'プリント編集'}`,
      allowBriefOnly: true,
    });
    return;
    if (setUploadedAssetResult({
      toolId: 'print-design-detail',
      title: '柄・グラフィックプレビュー',
      summary,
      mode: 'pattern',
    })) {
      toast.success(mode === 'guide' ? '入力素材を保持したガイドを表示しました' : '入力素材を保持した柄プレビューを作成しました');
      return;
    }
    const preview = encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">
        <rect width="900" height="560" fill="#0a0d0f"/>
        <rect x="62" y="54" width="776" height="452" rx="30" fill="#151b1e" stroke="#263034" stroke-width="3"/>
        <rect x="118" y="106" width="282" height="334" rx="24" fill="#f8fafc"/>
        <path d="M142 178c52-36 104 36 156 0s78-36 118 0v214H142z" fill="#0f172a" opacity="0.94"/>
        <path d="M142 246c52-36 104 36 156 0s78-36 118 0" fill="none" stroke="#65d3cf" stroke-width="18" stroke-linecap="round"/>
        <path d="M142 314c52-36 104 36 156 0s78-36 118 0" fill="none" stroke="#fbbf24" stroke-width="18" stroke-linecap="round"/>
        <rect x="462" y="124" width="282" height="38" rx="19" fill="#65d3cf" opacity="0.36"/>
        <rect x="462" y="194" width="214" height="22" rx="11" fill="#ffffff" opacity="0.16"/>
        <rect x="462" y="242" width="250" height="22" rx="11" fill="#ffffff" opacity="0.12"/>
        <rect x="462" y="320" width="158" height="46" rx="23" fill="#65d3cf"/>
        <text x="541" y="350" text-anchor="middle" fill="#062c2b" font-family="Arial, sans-serif" font-size="20" font-weight="800">AI生成</text>
        <text x="118" y="472" fill="#65d3cf" font-family="Arial, sans-serif" font-size="28" font-weight="800">柄・グラフィック詳細</text>
        <text x="462" y="428" fill="#a3a3a3" font-family="Arial, sans-serif" font-size="18">${escapeSvgText(truncateSvgText(summary, 50))}</text>
      </svg>
    `);
    setLightchainResult({
      toolId: 'print-design-detail',
      title: '柄・グラフィックプレビュー',
      summary,
      imageUrl: preview,
    });
    toast.success(mode === 'guide' ? 'ガイドを表示しました' : 'ガイド無しで開始します');
  };

  const handleMarketingDetailGenerate = async () => {
    const summary = [
      marketingProjectName,
      marketingDetailPrompt.trim() || '商品画像をアップロードして、デザインのリクエストを教えてください',
      materialSlotFiles.primary?.name ?? 'アップロード待ち',
      `生成元: ${marketingDetailTab === 'assistant' ? 'AIアシスタント' : 'レイヤー設定'}`,
    ].join(' / ');
    await handleLightchainPreviewGenerate({
      title: 'マーケティング詳細AI生成',
      summary,
      brief: marketingDetailPrompt.trim() || '商品画像を使ったマーケティングビジュアル',
      allowBriefOnly: true,
    });
    return;
    if (setUploadedAssetResult({
      toolId: 'marketing-detail',
      title: 'マーケティング詳細プレビュー',
      summary,
      mode: 'asset',
    })) {
      toast.success('入力素材を保持したマーケティングプレビューを履歴に追加しました');
      return;
    }
    const preview = encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="980" height="620" viewBox="0 0 980 620">
        <rect width="980" height="620" fill="#080c0d"/>
        <rect x="62" y="70" width="570" height="420" rx="28" fill="#151719" stroke="#2f3638" stroke-width="3" stroke-dasharray="12 10"/>
        <path d="M320 278v-82M320 196l-34 34M320 196l34 34" fill="none" stroke="#e5e7eb" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="682" y="72" width="236" height="420" rx="28" fill="#171c1f" stroke="#273033" stroke-width="3"/>
        <rect x="714" y="130" width="172" height="24" rx="12" fill="#65d3cf" opacity="0.25"/>
        <rect x="714" y="194" width="146" height="18" rx="9" fill="#ffffff" opacity="0.16"/>
        <rect x="714" y="236" width="178" height="18" rx="9" fill="#ffffff" opacity="0.12"/>
        <rect x="714" y="318" width="142" height="38" rx="19" fill="#262c30"/>
        <rect x="714" y="374" width="176" height="70" rx="18" fill="#0f1416" stroke="#2a3336" stroke-width="2"/>
        <text x="92" y="548" fill="#65d3cf" font-family="Arial, sans-serif" font-size="28" font-weight="800">マーケティング詳細キャンバス</text>
        <text x="92" y="582" fill="#a3a3a3" font-family="Arial, sans-serif" font-size="18">${escapeSvgText(truncateSvgText(summary, 70))}</text>
      </svg>
    `);
    setLightchainResult({
      toolId: 'marketing-detail',
      title: 'マーケティング詳細プレビュー',
      summary,
      imageUrl: preview,
    });
    toast.success('履歴にプレビューを追加しました');
  };

  const commitMarketingProjectName = () => {
    const nextName = marketingProjectNameDraft.trim();
    if (!nextName) {
      setMarketingProjectNameDraft(marketingProjectName);
      setMarketingProjectNameEditing(false);
      return;
    }
    const normalizedName = nextName.slice(0, 80);
    setMarketingProjectName(normalizedName);
    setMarketingProjectNameDraft(normalizedName);
    setMarketingProjectNameEditing(false);
  };

  const specialProviderGenerationLocked = !lightchainProviderSupported || lightchainGenerationRunning;
  const renderLightchainProviderGate = () => (
    <div className="mt-4 space-y-2 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] p-3" data-testid="lightchain-special-provider-gate">
      {lightchainProviderSupported ? (
        <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-cyan-50">
          <input
            type="checkbox"
            checked={providerRightsConfirmed}
            onChange={(event) => {
              setProviderRightsConfirmed(event.target.checked);
              setLightchainGenerationError(null);
            }}
            className="mt-1 h-4 w-4 accent-[#65d3cf]"
            data-testid="lightchain-rights-confirmation"
          />
          <span>
            アップロードした画像・人物・柄・生地について、AI生成に利用する権利または許諾を確認済みです。
            <span className="mt-1 block text-[11px] text-cyan-100/60">確認後のみ実プロバイダを実行します。未確認時は結果を作成しません。</span>
          </span>
        </label>
      ) : (
        <>
          <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.08] px-3 py-2 text-xs font-semibold leading-5 text-amber-100" data-testid="lightchain-special-provider-error">
            この機能のプロバイダが未接続のため、生成は開始されません。
          </p>
        </>
      )}
      {lightchainGenerationRunning && (
        <p className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-2 text-xs font-semibold text-cyan-50">AI生成を実行中です。</p>
      )}
      {lightchainGenerationError && (
        <p className="rounded-xl border border-rose-300/20 bg-rose-300/[0.08] px-3 py-2 text-xs font-semibold text-rose-100" data-testid="lightchain-generation-error">
          {lightchainGenerationError}
        </p>
      )}
    </div>
  );

  const handleOpenMaskAdjustment = () => {
    if (!garmentImageUrl) {
      toast.error('先に素材画像を選択してください');
      return;
    }
    setWorkbenchStep('mask');
    if (maskCandidates.length === 0) setMaskCandidates(defaultMaskCandidates);
    toast.success('マスク調整を開きました');
  };

  const handleRecognizeMask = () => {
    if (!garmentImageUrl) {
      toast.error('先に素材画像を選択してください');
      return;
    }
    setWorkbenchStep('mask');
    setMaskCandidates(defaultMaskCandidates);
    setSelectedMaskCandidate('トップス');
    setCutMode('auto');
    setActiveLayer(getLayerForMaskCandidate('トップス'));
    setExtractedLayerReady(false);
    setExtractedGarmentImageUrl(null);
    setCutoutBounds(null);
    setCutoutOutputSize(null);
    setCutoutDataUrlBytes(null);
    setCutoutMaxDataUrlBytes(null);
    setCutoutStoragePolicy(null);
    setMaskEngine(null);
    setNextStepConfirmed(false);
    toast.success('AIマスク認識でトップス候補を検出しました');
  };

  const handleSelectMaskCandidate = (candidate: MaskCandidate) => {
    setSelectedMaskCandidate(candidate);
    setActiveLayer(getLayerForMaskCandidate(candidate));
    setExtractedLayerReady(false);
    setExtractedGarmentImageUrl(null);
    setCutoutBounds(null);
    setCutoutOutputSize(null);
    setCutoutDataUrlBytes(null);
    setCutoutMaxDataUrlBytes(null);
    setCutoutStoragePolicy(null);
    setMaskEngine(null);
    setNextStepConfirmed(false);
    setWorkbenchStep('mask');
  };

  const handleSetCutMode = (mode: typeof cutMode) => {
    setCutMode(mode);
    setExtractedLayerReady(false);
    setExtractedGarmentImageUrl(null);
    setCutoutBounds(null);
    setCutoutOutputSize(null);
    setCutoutDataUrlBytes(null);
    setCutoutMaxDataUrlBytes(null);
    setCutoutStoragePolicy(null);
    setMaskEngine(null);
    setNextStepConfirmed(false);
    if (mode === 'keep') {
      setMaskCandidates([]);
      setSelectedMaskCandidate(null);
    }
    if (mode === 'auto') {
      setMaskCandidates(defaultMaskCandidates);
      setSelectedMaskCandidate(null);
    }
    if (mode === 'manual') {
      setMaskCandidates(['手動範囲']);
      setSelectedMaskCandidate('手動範囲');
      setActiveLayer(getLayerForMaskCandidate('手動範囲'));
    }
    if (workbenchStep === 'extracted' || workbenchStep === 'next') setWorkbenchStep('mask');
  };

  const handleSelectDesignLayer = (layer: string) => {
    setActiveLayer(layer);
    setExtractedLayerReady(false);
    setExtractedGarmentImageUrl(null);
    setCutoutBounds(null);
    setCutoutOutputSize(null);
    setCutoutDataUrlBytes(null);
    setCutoutMaxDataUrlBytes(null);
    setCutoutStoragePolicy(null);
    setMaskEngine(null);
    setNextStepConfirmed(false);
    setSelectedMaskCandidate(maskCandidates.includes(layer as MaskCandidate) ? (layer as MaskCandidate) : null);
    if (workbenchStep === 'extracted' || workbenchStep === 'next') setWorkbenchStep('mask');
  };

  const runCutoutExtraction = async () => {
    if (!selectedMaskCandidate) {
      toast.error('保存したい範囲を選択してください');
      return null;
    }
    if (cutMode === 'keep') setCutMode('auto');
    const cutout = await buildMaterialCutoutDataUrl({
      imageUrl: garmentImageUrl,
      mode: cutMode === 'keep' ? 'auto' : cutMode,
      candidate: selectedMaskCandidate,
    });
    setExtractedGarmentImageUrl(cutout.dataUrl);
    setCutoutBounds(cutout.bounds);
    setCutoutOutputSize(cutout.outputSize);
    setCutoutDataUrlBytes(cutout.dataUrlBytes);
    setCutoutMaxDataUrlBytes(750_000);
    setCutoutStoragePolicy(cutout.storagePolicy);
    setMaskEngine(cutout.engine);
    setExtractedLayerReady(true);
    return cutout;
  };

  const handleExtractMask = async () => {
    try {
      const cutout = await runCutoutExtraction();
      if (!cutout) return;
      setWorkbenchStep('extracted');
      toast.success(`${selectedMaskCandidate}を透明PNGで抽出しました`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '抽出に失敗しました');
    }
  };

  const handleConfirmNextStep = () => {
    if (!extractedLayerReady) {
      toast.error('先に抽出を完了してください');
      return;
    }
    setNextStepConfirmed(true);
    setWorkbenchStep('next');
    toast.success('次のステップへ進める状態です');
  };

  const handleExtractAndConfirmNextStep = async () => {
    try {
      const cutout = await runCutoutExtraction();
      if (!cutout) return;
      setNextStepConfirmed(true);
      setWorkbenchStep('next');
      toast.success(`${selectedMaskCandidate}を透明PNGで抽出して次へ進めます`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '抽出に失敗しました');
    }
  };

  const handleSaveToCanvas = async () => {
    if (!currentBrand || isSaving) {
      if (!currentBrand) toast.error('ブランドを選択してください');
      return;
    }
    if (selectedTool.id === 'printing-image' && (
      printingCutoutStatus.primary !== 'done'
      || printingCutoutStatus.secondary !== 'done'
      || !materialSlotFiles.primary?.imageUrl
      || !materialSlotFiles.secondary?.imageUrl
    )) {
      toast.error('参考画像とプリント画像の透明化が完了するまで保存できません');
      return;
    }
    if (selectedTool.id === 'printing-image' && printingGenerationStatus === 'error' && !lightchainResult) {
      toast.error('生成に失敗しています。再生成してから保存してください');
      return;
    }

    setIsSaving(true);
    try {
      const shouldSaveWorkbenchAsset = workbenchEnabled && Boolean(garmentImageUrl);
      const ensuredCutout = selectedTool.id !== 'printing-image'
        && shouldSaveWorkbenchAsset
        && extractedLayerReady
        && !extractedGarmentImageUrl
        ? await buildMaterialCutoutDataUrl({
          imageUrl: garmentImageUrl,
          mode: cutMode === 'keep' ? 'auto' : cutMode,
          candidate: selectedMaskCandidate,
        })
        : null;
      const finalExtractedImageUrl = extractedGarmentImageUrl || ensuredCutout?.dataUrl || null;
      const finalCutoutBounds = cutoutBounds || ensuredCutout?.bounds || null;
      const finalCutoutOutputSize = cutoutOutputSize || ensuredCutout?.outputSize || null;
      const finalCutoutDataUrlBytes = cutoutDataUrlBytes || ensuredCutout?.dataUrlBytes || null;
      const finalCutoutMaxDataUrlBytes = cutoutMaxDataUrlBytes || (ensuredCutout ? 750_000 : null);
      const finalCutoutStoragePolicy = cutoutStoragePolicy || ensuredCutout?.storagePolicy || null;
      const finalMaskEngine = maskEngine || ensuredCutout?.engine || null;
      const parityRuntimeJson = lightchainResult?.parityRuntime
        ?? serializeLightchainParityRuntime(buildCurrentParityRuntime());
      const projectId = createProject(`制作: ${selectedTool.title}`, currentBrand.id);
      const lightchainWorkbenchState = workbenchEnabled ? {
        toolId: selectedTool.id,
        toolCategory: selectedTool.category,
        modelFormState: currentModelPanel ? modelFormState : null,
        lightchainResult,
        generationMode: lightchainResult?.generationMode ?? null,
        provider: lightchainResult?.provider ?? null,
        backendProvider: lightchainResult?.backendProvider ?? null,
        generationJobId: lightchainResult?.jobId ?? null,
        generatedImageId: lightchainResult?.imageId ?? null,
        generatedStoragePath: lightchainResult?.storagePath ?? null,
            fabricPrompt: selectedTool.id === 'fabric-image' ? fabricPrompt : null,
            imageRatio: selectedTool.id === 'fabric-image' ? lightchainToolPanelConfig?.bottomControl ?? '画像比率自動' : null,
            autoConvertGarment: isFittingDetail ? autoConvertGarment : null,
            lineDraftType: selectedTool.id === 'line-to-real' ? lineDraftType : null,
            lineToRealOutputType: selectedTool.id === 'line-to-real' ? lineToRealImageType : null,
            lineToRealPrompt: selectedTool.id === 'line-to-real' ? lineToRealPrompt : null,
            lineGenerationImageType: selectedTool.id === 'line-generation' ? lineGenerationImageType : null,
            lineGenerationOutputType: selectedTool.id === 'line-generation' ? '線画' : null,
            patternVectorLayers: isPatternVectorProFlow ? patternVectorLayers : null,
            patternVectorUsage: isPatternVectorProFlow ? '6/30' : null,
        patternVectorGenerationCost: isPatternVectorProFlow ? 1 : null,
        printArtworkTransform: selectedTool.id === 'printing-image' ? printArtworkTransform : null,
		        materialSlots: materialSlots.map((slot) => ({
	          key: slot.key,
	          label: slot.label,
	          required: slot.required,
	          fileName: materialSlotFiles[slot.key]?.name ?? null,
	          materialKind: materialSlotFiles[slot.key]?.kind ?? slot.label,
	          hasImage: Boolean(materialSlotFiles[slot.key]),
	          imageUrl: materialSlotFiles[slot.key]?.imageUrl ?? null,
	        })),
	        garmentFileName: garmentFileName || null,
	        materialKind: garmentCategory,
        cutMode,
        activeLayer,
        printPlacement,
        printScale,
        referenceNote,
        hasImage: Boolean(garmentImageUrl),
        workbenchStep,
        selectedMaskCandidate,
        maskCandidates,
        extractedLayerReady,
        extractedImageUrl: finalExtractedImageUrl,
        cutoutBounds: finalCutoutBounds,
        cutoutOutputSize: finalCutoutOutputSize,
        cutoutDataUrlBytes: finalCutoutDataUrlBytes,
        cutoutMaxDataUrlBytes: finalCutoutMaxDataUrlBytes,
        cutoutStoragePolicy: finalCutoutStoragePolicy,
        maskEngine: finalMaskEngine,
        nextStepConfirmed,
      } : null;
      const materialReference = lightchainWorkbenchState ? {
        hasImage: lightchainWorkbenchState.hasImage,
        fileName: lightchainWorkbenchState.garmentFileName,
        materialKind: lightchainWorkbenchState.materialKind,
        maskMode: lightchainWorkbenchState.cutMode,
        activeLayer: lightchainWorkbenchState.activeLayer,
        placement: lightchainWorkbenchState.printPlacement,
        scale: lightchainWorkbenchState.printScale,
        note: lightchainWorkbenchState.referenceNote,
        selectedMaskCandidate: lightchainWorkbenchState.selectedMaskCandidate,
        extractedLayerReady: lightchainWorkbenchState.extractedLayerReady,
        extractedImageUrl: lightchainWorkbenchState.extractedImageUrl,
        cutoutBounds: lightchainWorkbenchState.cutoutBounds,
        cutoutOutputSize: lightchainWorkbenchState.cutoutOutputSize,
        cutoutDataUrlBytes: lightchainWorkbenchState.cutoutDataUrlBytes,
        cutoutMaxDataUrlBytes: lightchainWorkbenchState.cutoutMaxDataUrlBytes,
        cutoutStoragePolicy: lightchainWorkbenchState.cutoutStoragePolicy,
        maskEngine: lightchainWorkbenchState.maskEngine,
      } : null;
      const layerPlan = lightchainWorkbenchState ? {
        activeLayer: lightchainWorkbenchState.activeLayer,
        placement: lightchainWorkbenchState.printPlacement,
        scale: lightchainWorkbenchState.printScale,
        overlayLabel: 'プリント',
        objectRole: 'design-overlay',
        stack: lightchainWorkbenchState.extractedLayerReady ? ['original-base', 'extracted-cutout', 'design-overlay'] : ['material-reference', 'design-overlay'],
        extractedLayer: lightchainWorkbenchState.extractedLayerReady ? {
          role: 'extracted-cutout',
          sourceCandidate: lightchainWorkbenchState.selectedMaskCandidate,
          sourceImageUrl: lightchainWorkbenchState.extractedImageUrl,
          cutoutBounds: lightchainWorkbenchState.cutoutBounds,
          outputSize: lightchainWorkbenchState.cutoutOutputSize,
          dataUrlBytes: lightchainWorkbenchState.cutoutDataUrlBytes,
          maxDataUrlBytes: lightchainWorkbenchState.cutoutMaxDataUrlBytes,
          storagePolicy: lightchainWorkbenchState.cutoutStoragePolicy,
          maskEngine: lightchainWorkbenchState.maskEngine,
          zIndex: 2,
        } : null,
      } : null;
      const maskPlan = lightchainWorkbenchState ? {
        mode: lightchainWorkbenchState.cutMode,
        maskMode: lightchainWorkbenchState.cutMode,
        source: lightchainWorkbenchState.hasImage ? 'uploaded-garment' : 'brief-only',
        appliedToCanvasImage: lightchainWorkbenchState.hasImage && lightchainWorkbenchState.cutMode !== 'keep',
        candidates: lightchainWorkbenchState.maskCandidates,
        selectedCandidate: lightchainWorkbenchState.selectedMaskCandidate,
        recognition: lightchainWorkbenchState.maskCandidates.length > 0 ? 'ai-mask-recognition' : 'not-run',
        extracted: lightchainWorkbenchState.extractedLayerReady,
        extractedImageKind: lightchainWorkbenchState.extractedImageUrl ? 'transparent-png' : null,
        cutoutBounds: lightchainWorkbenchState.cutoutBounds,
        cutoutOutputSize: lightchainWorkbenchState.cutoutOutputSize,
        cutoutDataUrlBytes: lightchainWorkbenchState.cutoutDataUrlBytes,
        cutoutMaxDataUrlBytes: lightchainWorkbenchState.cutoutMaxDataUrlBytes,
        cutoutStoragePolicy: lightchainWorkbenchState.cutoutStoragePolicy,
        maskEngine: lightchainWorkbenchState.maskEngine,
      } : null;
      const compositionPreview = lightchainWorkbenchState ? {
        summary: `${lightchainWorkbenchState.materialKind} / ${lightchainWorkbenchState.activeLayer} / ${lightchainWorkbenchState.printPlacement}`,
        fileName: lightchainWorkbenchState.garmentFileName,
        status: lightchainWorkbenchState.extractedLayerReady ? '抽出レイヤー重ね済み' : 'Canvas保存済み',
        flow: lightchainWorkbenchState.nextStepConfirmed ? 'next-step-ready' : lightchainWorkbenchState.workbenchStep,
      } : null;
      const lightchainCompat = {
        lightchainFeatureId: selectedTool.id,
        lightchainFeatureTitle: selectedTool.title,
        lightchainRoute: selectedTool.lightchainRoute,
        lightchainTaskCodes: [selectedTool.id],
        lightchainTaskSteps: [{
          taskCode: selectedTool.id,
          route: selectedTool.lightchainRoute,
          status: lightchainResult ? 'completed' as const : 'processing' as const,
        }],
      };
	      const slotMaterialReferences = lightchainWorkbenchState
	        ? lightchainWorkbenchState.materialSlots
	          .filter((slot) => slot.hasImage)
	          .map((slot) => ({
	            hasImage: slot.hasImage,
	            fileName: slot.fileName,
	            materialKind: slot.materialKind,
	            slotKey: slot.key,
	            slotLabel: slot.label,
	            imageUrl: slot.imageUrl,
	          }))
	        : [];
		      const workbenchParameters = lightchainWorkbenchState ? {
            fabricPrompt: lightchainWorkbenchState.fabricPrompt,
            imageRatio: lightchainWorkbenchState.imageRatio,
            autoConvertGarment: lightchainWorkbenchState.autoConvertGarment,
            lineDraftType: lightchainWorkbenchState.lineDraftType,
            lineToRealOutputType: lightchainWorkbenchState.lineToRealOutputType,
            lineToRealPrompt: lightchainWorkbenchState.lineToRealPrompt,
            lineGenerationImageType: lightchainWorkbenchState.lineGenerationImageType,
            lineGenerationOutputType: lightchainWorkbenchState.lineGenerationOutputType,
            patternVectorLayers: lightchainWorkbenchState.patternVectorLayers,
            patternVectorUsage: lightchainWorkbenchState.patternVectorUsage,
            patternVectorGenerationCost: lightchainWorkbenchState.patternVectorGenerationCost,
            printArtworkTransform: lightchainWorkbenchState.printArtworkTransform,
            parityRuntime: parityRuntimeJson,
			        materialReference,
	        materialReferences: [
	          ...(materialReference ? [materialReference] : []),
	          ...slotMaterialReferences.filter((slotReference) => slotReference.slotKey !== 'primary'),
	        ],
	        layerPlan,
        maskPlan,
        compositionPreview,
          lightchainWorkbenchState: compactLightchainWorkbenchStateForPersistence(lightchainWorkbenchState),
        garmentReferenceState: selectedTool.id === 'fitting-clothing-reference' ? lightchainWorkbenchState : null,
      } : {};
      const orderSheetPreview = buildOrderSheetPreview({
        tool: selectedTool,
        brief,
        referenceNote,
        materialKind: garmentCategory,
        activeLayer,
        printPlacement,
        printScale,
        selectedMaskCandidate,
        workbenchStep,
        outputs: selectedTool.outputs,
      });
      const artifactPreview = lightchainResult?.imageUrl ?? orderSheetPreview;
      const artifact = await saveWorkspaceArtifactBestEffort({
        brandId: currentBrand.id,
        scopeId: user?.id,
        featureType: `lightchain-${selectedTool.id}`,
        title: selectedTool.title,
        imageUrl: artifactPreview,
        prompt: `${selectedTool.promptTemplate}\n\n依頼: ${brief}\n参考: ${referenceNote}${lightchainWorkbenchState ? `\n素材: ${garmentCategory} / ${cutMode} / ${printPlacement} / ${printScale}%` : ''}`,
        canvasProjectId: projectId,
        sourceJobId: lightchainResult?.jobId ?? undefined,
        metadata: {
          sourceWorkspace: 'lightchain-workbench',
          previewKind: 'lightchain-order-sheet-v1',
          toolId: selectedTool.id,
          toolTitle: selectedTool.title,
          brief,
          referenceNote,
          sourceLabel: selectedTool.title,
          sourceResumePath: `/lightchain/${selectedTool.id}`,
          sourceProviderResultArtifactId: lightchainResult?.artifactId ?? null,
          remoteStoragePath: lightchainResult?.storagePath ?? null,
          remoteImageId: lightchainResult?.imageId ?? null,
          marketingProjectName: selectedTool.id === 'marketing-detail' ? marketingProjectName : null,
          parityRuntime: parityRuntimeJson,
          lightchainRoute: selectedTool.lightchainRoute,
          inputs: selectedTool.inputs,
          outputs: selectedTool.outputs,
          heavyChainHref: selectedTool.heavyChainHref,
          ...workbenchParameters,
        },
      });
      if (!artifact.remote && !artifact.localPersisted) {
        deleteProject(projectId);
        throw artifact.localError ?? artifact.remoteError ?? new Error('workspace_artifact_persistence_unverified');
      }

      let materialObjectId: string | null = null;
      let overlayObjectId: string | null = null;
      let resultObjectId: string | null = null;

      if (shouldSaveWorkbenchAsset) {
        if (selectedTool.id === 'printing-image') {
          const composedPreview = buildPrintingImagePreviewDataUrl({
            garmentImageUrl: materialSlotFiles.primary!.imageUrl,
            garmentMaskUrl: materialSlotFiles.primary!.imageUrl,
            printImageUrl: materialSlotFiles.secondary!.imageUrl,
            garmentCategory,
            printMode: printingMode,
            printLabel: materialSlotFiles.secondary?.name ?? 'プリント画像',
            transform: printArtworkTransform,
          });
          materialObjectId = addObject({
            type: 'image',
            x: 120,
            y: 100,
            width: 360,
            height: 360,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
            locked: false,
            visible: true,
            src: composedPreview,
            label: garmentFileName || `${selectedTool.title} 合成プレビュー`,
            metadata: {
              feature: `lightchain-${selectedTool.id}-composited-print-preview`,
              prompt: selectedTool.promptTemplate,
              generation: 0,
              lightchainCompat,
              parameters: {
                toolId: selectedTool.id,
                artifactId: artifact.artifact.id,
                printMode: printingMode,
                garmentCategory,
                printArtworkTransform,
                printPlacement,
                printScale,
                ...workbenchParameters,
              },
            },
          });
        } else {
          const processedMaterialImageUrl = finalExtractedImageUrl || garmentImageUrl;
          const overlayPosition = getOverlayPosition(printPlacement, printScale);
          if (extractedLayerReady) {
            addObject({
              type: 'image',
              x: 120,
              y: 100,
              width: 360,
              height: 360,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 0.46,
              locked: false,
              visible: true,
              src: garmentImageUrl,
              label: `${garmentFileName || selectedTool.title} 元画像ベース`,
              metadata: {
                feature: `lightchain-${selectedTool.id}-original-base-layer`,
                prompt: selectedTool.promptTemplate,
                generation: 0,
                lightchainCompat,
                parameters: {
                  toolId: selectedTool.id,
                  artifactId: artifact.artifact.id,
                  layerRole: 'original-base',
                  ...workbenchParameters,
                },
              },
            });
          }
          materialObjectId = addObject({
            type: 'image',
            x: 120,
            y: 100,
            width: 360,
            height: 360,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
            locked: false,
            visible: true,
            src: processedMaterialImageUrl,
            label: extractedLayerReady
              ? `${selectedMaskCandidate ?? '抽出'} カットレイヤー`
              : garmentFileName || `${selectedTool.title} 素材画像`,
            metadata: {
              feature: `lightchain-${selectedTool.id}-material-reference`,
              prompt: selectedTool.promptTemplate,
              generation: 0,
              lightchainCompat,
              parameters: {
                toolId: selectedTool.id,
                artifactId: artifact.artifact.id,
                processedImageKind: cutMode === 'keep' ? 'original' : 'masked-transparent-png',
                layerRole: extractedLayerReady ? 'extracted-cutout' : 'material-reference',
                cutoutBounds: finalCutoutBounds,
                cutoutOutputSize: finalCutoutOutputSize,
                cutoutDataUrlBytes: finalCutoutDataUrlBytes,
                cutoutMaxDataUrlBytes: finalCutoutMaxDataUrlBytes,
                cutoutStoragePolicy: finalCutoutStoragePolicy,
                maskEngine: finalMaskEngine,
                hasTransparentCutout: Boolean(extractedLayerReady && processedMaterialImageUrl.startsWith('data:image/png')),
                ...workbenchParameters,
              },
            },
          });

          overlayObjectId = addObject({
            type: 'text',
            x: overlayPosition.x,
            y: overlayPosition.y,
            width: 150,
            height: 58,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
            locked: false,
            visible: true,
            text: 'プリント',
            fontSize: Math.max(24, Math.round(printScale * 0.9)),
            fontFamily: 'Inter',
            fill: '#0f172a',
            label: `レイヤー: ${activeLayer} / ${printPlacement}`,
            parentId: materialObjectId,
            derivedFrom: materialObjectId,
            metadata: {
              feature: `lightchain-${selectedTool.id}-overlay-layer`,
              prompt: `${printPlacement}に${activeLayer}レイヤーを配置`,
              parentId: materialObjectId,
              generation: 0,
              lightchainCompat,
              parameters: {
                toolId: selectedTool.id,
                printPlacement,
                printScale,
                activeLayer,
                ...workbenchParameters,
              },
            },
          });
        }
      }

      // A brief-only provider result has no garment source layer, but it is
      // still a completed artifact that must be placed on Canvas. Keep source
      // material/mask layers gated by garmentImageUrl while allowing the
      // durable provider result itself to cross the Canvas boundary.
      if (workbenchEnabled && lightchainResult?.imageUrl && selectedTool.id !== 'printing-image') {
        resultObjectId = addObject({
          type: 'image',
          x: 520,
          y: 100,
          width: 420,
          height: 360,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          locked: false,
          visible: true,
          src: lightchainResult.imageUrl,
          label: `${selectedTool.title} 生成結果`,
          metadata: {
            feature: `lightchain-${selectedTool.id}-generated-result`,
            prompt: selectedTool.promptTemplate,
            generation: 1,
            provider: lightchainResult.provider ?? null,
            backendProvider: lightchainResult.backendProvider ?? null,
            status: lightchainResult.generationMode === 'provider' ? 'completed' : 'preview',
            jobId: lightchainResult.jobId ?? null,
            imageId: lightchainResult.imageId ?? null,
            storagePath: lightchainResult.storagePath ?? null,
            galleryStoragePath: lightchainResult.storagePath ?? undefined,
            galleryImageId: lightchainResult.imageId ?? undefined,
            galleryImageUrl: lightchainResult.imageUrl,
            parityRuntime: lightchainResult.parityRuntime ?? parityRuntimeJson,
            lightchainCompat,
            parameters: {
              toolId: selectedTool.id,
              artifactId: artifact.artifact.id,
              resultTitle: lightchainResult.title,
              resultSummary: lightchainResult.summary,
              previewKind: lightchainResult.generationMode === 'provider' ? 'provider-generated-v1' : 'asset-anchored-v2',
              generationMode: lightchainResult.generationMode ?? 'preview',
              provider: lightchainResult.provider ?? null,
              backendProvider: lightchainResult.backendProvider ?? null,
              generationJobId: lightchainResult.jobId ?? null,
              generatedImageId: lightchainResult.imageId ?? null,
              generatedStoragePath: lightchainResult.storagePath ?? null,
              ...workbenchParameters,
            },
          },
        });
      }

      addObject({
        type: 'text',
        x: shouldSaveWorkbenchAsset ? 520 : 120,
        y: 120,
        width: 520,
        height: 220,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        locked: false,
        visible: true,
        text: `${selectedTool.title}\n\n${brief}\n\n${referenceNote}`,
        fontSize: 24,
        fontFamily: 'Inter',
        fill: '#1f2937',
        metadata: {
          feature: 'lightchain-workbench',
          prompt: `${selectedTool.promptTemplate}\n\n依頼: ${brief}\n参考: ${referenceNote}`,
          generation: 0,
          lightchainCompat,
          parameters: {
            toolId: selectedTool.id,
            artifactId: artifact.artifact.id,
            lightchainRoute: selectedTool.lightchainRoute,
            heavyChainHref: selectedTool.heavyChainHref,
            inputs: selectedTool.inputs,
            outputs: selectedTool.outputs,
            ...workbenchParameters,
          },
        },
      });
      if (resultObjectId ?? overlayObjectId ?? materialObjectId) {
        selectObject((resultObjectId ?? overlayObjectId ?? materialObjectId) as string);
      }
      saveCurrentProject();
      toast.success('制作内容を保存しました');
      navigate(`/canvas/${projectId}`);
    } catch (error) {
      console.error('Failed to save Lightchain workbench artifact:', error);
      toast.error('Canvas保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  if (isFeatureDetail && isFittingDetail) {
    return (
      <main
        className="dark min-h-[calc(100vh-70px)] bg-[#121414] text-white"
        data-flow-state={unifiedFlowState}
        data-flow-state-label={unifiedWorkspaceFlowLabels[unifiedFlowState]}
      >
        {renderLightchainProviderGate()}
        <div className="relative grid min-h-[calc(100vh-70px)] lg:grid-cols-[432px_minmax(0,1fr)]">
          <section className="border-r border-white/10 bg-[#141717]" data-testid="lightchain-fitting-input-flow">
            <div className="flex h-12 items-center justify-between border-b border-white/10 px-4">
              <h1 className="text-sm font-semibold text-white">AIフィッティング</h1>
              <div className="inline-flex rounded-xl bg-[#262b2e] p-1" role="tablist" aria-label="AIフィッティングタスク">
                {['シングルタスク', 'マルチタスク'].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    onClick={() => setActiveFittingTaskTab(tab)}
                    aria-selected={activeFittingTaskTab === tab}
                    className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${activeFittingTaskTab === tab ? 'bg-[#687178] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]' : 'text-neutral-400 hover:text-neutral-200'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">衣服の画像 (0/4)</p>
                    <p className="mt-2 text-sm text-neutral-400">自動でアパレル平置き画像に変換</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoConvertGarment((current) => !current)}
                    aria-pressed={autoConvertGarment}
                    aria-label="自動変換"
                  >
                    <span className={`block h-5 w-9 rounded-full p-0.5 transition ${autoConvertGarment ? 'bg-cyan-300' : 'bg-neutral-500'}`}>
                      <span className={`block h-4 w-4 rounded-full bg-white shadow-sm transition ${autoConvertGarment ? 'translate-x-4' : ''}`} />
                    </span>
                  </button>
                </div>
                <label className="mt-4 grid min-h-[200px] cursor-pointer grid-cols-[1fr_140px] overflow-hidden rounded-2xl border border-white/5 bg-[#202527] p-2 transition hover:border-cyan-300/40">
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => handleMaterialSlotUpload('primary', event)} />
                  <div className="flex flex-col items-center justify-center px-5 text-center">
                    <ImagePlus className="h-6 w-6 text-neutral-300" />
                    <p className="mt-5 text-base font-semibold leading-7 text-neutral-100">
                      {activeFittingTaskTab === 'マルチタスク' ? '複数のコーディネートのアップロードに対応' : '1つの衣服画像から着用画像を作成'}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-neutral-400">
                      {activeFittingInputTab === '説明生成'
                        ? 'ここをクリック/ドラッグしてアイテムを追加します。'
                        : activeFittingInputTab === '参考画像'
                          ? '衣服と一緒に使う参考画像の条件を指定します。'
                          : 'モデルのセット写真に合わせた条件を指定します。'}
                    </p>
                    <span className="mt-3 rounded-full bg-cyan-400 px-3 py-1 text-xs font-bold text-neutral-950">必須項目</span>
                  </div>
                  <div className="flex items-center justify-center rounded-xl bg-white p-2">
                    {garmentImageUrl ? (
                      <img src={garmentImageUrl} alt="衣服画像" className="max-h-40 rounded-lg object-contain" />
                    ) : (
                      <div className="flex h-full w-full items-end justify-center rounded-lg bg-[linear-gradient(180deg,#f5f0e8,#ffffff)] p-2 text-xs font-semibold text-neutral-500">
                        例
                      </div>
                    )}
                  </div>
                </label>
              </div>
              <div className="grid grid-cols-3 border-b border-white/10" role="tablist" aria-label="AIフィッティング入力">
                {['説明生成', '参考画像', 'モデルのセット写真'].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    onClick={() => setActiveFittingInputTab(tab)}
                    aria-selected={activeFittingInputTab === tab}
                    className={`px-2 py-3 text-sm font-semibold transition ${activeFittingInputTab === tab ? 'rounded-lg bg-[#707980] text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <textarea
                value={referenceNote}
                onChange={(event) => setReferenceNote(event.target.value)}
                className="min-h-[114px] w-full resize-none rounded-2xl border border-white/5 bg-[#181d1f] px-4 py-4 text-sm text-white outline-none placeholder:text-neutral-500"
                placeholder={activeFittingInputTab === '説明生成' ? '背景の説明をここに記入してください' : activeFittingInputTab === '参考画像' ? '参考画像で残したい雰囲気や衣服の条件を記入してください' : 'モデルセット写真で合わせたいポーズ、背景、小物を記入してください'}
              />
              <div className="rounded-2xl border border-white/5 bg-[#181d1f] px-4 py-3 text-left text-xs leading-5 text-neutral-400">
                {activeFittingTaskTab === 'マルチタスク'
                  ? 'マルチタスクでは複数コーディネートを同時に管理し、各参考条件を履歴にまとめます。'
                  : 'シングルタスクでは1つの衣服画像から最短で着用イメージを作ります。'}
                <span className="mt-1 block text-[#65d3cf]">{activeFittingInputTab}</span>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 grid w-full gap-2 border-t border-white/10 bg-[#141717] p-2 sm:grid-cols-[1fr_1fr_2fr] lg:w-[432px]">
              {['スマート', '1K'].map((control) => (
                  <span key={control} className="rounded-lg bg-[#24292c] px-3 py-3 text-sm font-semibold text-neutral-200">
                    {control}
                  </span>
                ))}
                <button
                  type="button"
                  disabled={aiGenerateDisabled || lightchainGenerationRunning}
                  onClick={() => void handleLightchainPreviewGenerate()}
                  className="inline-flex items-center justify-center rounded-lg bg-[#65d3cf] px-5 py-3 text-sm font-semibold text-neutral-950 hover:bg-[#78e0dc] disabled:bg-[#3a484b] disabled:text-neutral-500"
                >
                  AI生成 <Sparkles className="ml-2 h-4 w-4" />
                </button>
            </div>
          </section>
          <aside className="relative flex min-h-[calc(100vh-70px)] items-center justify-center bg-[#151515]">
            <Link
              to="/fitting#fitting-history"
              className="absolute right-4 top-4 rounded-xl border border-white/15 bg-[#181b1d] px-4 py-2 text-sm font-semibold text-white"
              data-testid="lightchain-fitting-history-link"
            >
              生成履歴
            </Link>
            <div className="text-center">
              <h2 className="text-xl font-semibold text-[#6ee7df]">AIフィッティング</h2>
              <p className="mt-3 text-sm text-neutral-400">AIでモデル着用イメージを素早く実現</p>
              {lightchainResult ? (
                <div className="mx-auto mt-8 max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#1a1f22] text-left shadow-2xl">
                  {renderLightchainResultPreviewImage('h-56 w-full object-cover', '生成結果プレビュー')}
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{lightchainResult.title}</p>
                        <p className="mt-1 text-xs leading-5 text-neutral-400">{lightchainResult.summary}</p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2">
                        <button
                          type="button"
                          onClick={handleSaveToCanvas}
                          disabled={isSaving}
                          className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDownloadLightchainResult()}
                          disabled={!lightchainResult}
                          data-testid="lightchain-fitting-result-download"
                          className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                        >
                          ダウンロード
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : garmentImageUrl ? (
                <img src={garmentImageUrl} alt="右側プレビュー" className="mx-auto mt-8 max-h-[58vh] max-w-[50vw] rounded-xl object-contain" />
              ) : null}
            </div>
          </aside>
        </div>
        {materialModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end bg-neutral-950/55 p-3 backdrop-blur-sm sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="素材選択">
            <div className="max-h-[88vh] w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900 sm:max-w-4xl">
              <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <div>
                  <h2 className="text-base font-semibold text-neutral-900 dark:text-white">素材選択</h2>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">素材から選びます。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMaterialModalOpen(false)}
                  className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-600 transition hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-200"
                >
                  閉じる
                </button>
              </div>
              <div className="grid max-h-[calc(88vh-64px)] overflow-y-auto md:grid-cols-[220px_1fr]">
                <div className="border-b border-neutral-200 p-3 dark:border-neutral-800 md:border-b-0 md:border-r">
                  <div className="flex gap-2 overflow-x-auto md:block md:space-y-2">
                    {materialTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveMaterialTab(tab.id)}
                        className={`w-full shrink-0 rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                          activeMaterialTab === tab.id
                            ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-4">
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                    {materialTabs.find((tab) => tab.id === activeMaterialTab)?.label}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {materialTabs.find((tab) => tab.id === activeMaterialTab)?.description}
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {materialTabItems[activeMaterialTab].length > 0 ? materialTabItems[activeMaterialTab].map((item) => (
                      <div key={`fitting-${activeMaterialTab}-${item.title}`} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
                        <div className="relative flex min-h-[92px] items-center justify-center overflow-hidden rounded-lg bg-white text-sm font-semibold text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                          <img src={item.imageUrl} alt="" className="h-28 w-full object-cover" />
                        </div>
                        <div className="mt-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-neutral-900 dark:text-white">{item.title}</p>
                            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{item.note}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleUseMaterialAsset(item)}
                            className="shrink-0 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-950"
                          >
                            使用
                          </button>
                        </div>
                      </div>
                    )) : (
                      <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                        このタブに使える保存済み素材はありません。アップロードまたは生成結果を保存してください。
                      </p>
                    )}
                  </div>
                </div>
                          </div>
                        </div>
                        {selectedTool.id === 'image-repair' && imageRepairMode === 'マスクツール' && (
                          <p className="mt-3 rounded-full bg-[#20272a] px-4 py-2 text-center text-xs font-semibold text-[#65d3cf]">
                            「マスクツール」を使用して手足の部分をマスクで選択してください
                          </p>
                        )}
                      </div>
		                      )}
      </main>
    );
  }

  if (isFeatureDetail && selectedTool.id !== 'custom-style' && workspaceStyle) {
    if (workspaceStyle.kind === 'lab') {
      return (
        <main className="dark min-h-[calc(100vh-70px)] bg-[#111111] px-4 py-4 text-white" data-testid="lightchain-lab-home">
          <h1 className="text-base font-semibold">{workspaceStyle.title}</h1>
          {renderLightchainProviderGate()}
          <section className="mt-5 grid max-w-[520px] gap-5">
            <button
              type="button"
              onClick={handleWorkspaceStyleGenerate}
              disabled={specialProviderGenerationLocked}
              className="flex h-[220px] flex-col items-center justify-center rounded-xl bg-[#171c1f] text-neutral-300 transition hover:bg-[#20272a]"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_30%_25%,#e8ffe8,#7f7cff_52%,#111719)] text-white">
                <ImagePlus className="h-6 w-6" />
              </div>
              <span className="mt-5 text-sm font-semibold">新規ファイル</span>
            </button>
            <div>
              <h2 className="text-base font-semibold">{workspaceStyle.subtitle}</h2>
              <div className="mt-4 flex min-h-[128px] items-center justify-center rounded-xl border border-dashed border-white/15 bg-[#171c1f] px-4 text-center text-sm text-neutral-500">
                保存済みのラボ履歴はありません。新規ファイルから開始してください。
              </div>
            </div>
          {lightchainResult && (
            <div className="overflow-hidden rounded-xl border border-white/10 bg-[#171c1f]">
              {renderLightchainResultPreviewImage('h-48 w-full object-cover', '生成結果プレビュー')}
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-neutral-200">{lightchainResult.title}</p>
                      <p className="mt-1 text-xs leading-5 text-neutral-500">{lightchainResult.summary}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <button
                        type="button"
                        onClick={handleSaveToCanvas}
                        disabled={isSaving}
                        className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDownloadLightchainResult()}
                        disabled={!lightchainResult}
                        data-testid="lightchain-lab-result-download"
                        className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                      >
                        ダウンロード
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </main>
      );
    }

    const workspaceTabs = workspaceStyle.tabs ?? [];
    const currentWorkspaceTab = activeWorkspaceTab || workspaceTabs[0] || '';
    const workspaceTabCopy: Record<string, { helper: string; prompt: string; historyLabel: string; examples?: string[] }> = {
      企画案: {
        helper: 'ブランド情報と参考コレクションから、企画書の構成案を作ります。',
        prompt: workspaceStyle.prompt,
        historyLabel: '企画履歴',
        examples: workspaceStyle.examples,
      },
      インスピレーション: {
        helper: 'ムード、素材、色、シルエットの参照を集めるモードです。',
        prompt: '参考ブランド、年代、素材感、色、シルエットを入力してください。',
        historyLabel: 'インスピレーション履歴',
        examples: [
          'メタリック素材、ショート丈、都会的な春夏スタイリングを集める。',
          'ヴィンテージスポーツとラグジュアリーを組み合わせたムードボードを作る。',
        ],
      },
      AIグラフィックデザイン: {
        helper: '企画からプリント、柄、配置案へ展開するモードです。',
        prompt: '服に入れたいグラフィック、柄、配置、色数を入力してください。',
        historyLabel: 'グラフィック履歴',
        examples: [
          'チェーンモチーフを胸元と袖に配置した2色プリントを作る。',
          'モノグラム調の総柄を、黒地に銀で展開する。',
        ],
      },
      スタジオ案: {
        helper: '商品、モデル、背景、小物を組み合わせた撮影案を作ります。',
        prompt: workspaceStyle.prompt,
        historyLabel: 'スタジオ案履歴',
        examples: workspaceStyle.examples,
      },
      コーディネート: {
        helper: '服と小物、靴、バッグを合わせたコーディネート案を作ります。',
        prompt: '黒のチェーン柄フーディーに合わせるボトムス、靴、バッグ、小物の方向性を入力してください。',
        historyLabel: 'コーディネート履歴',
        examples: [
          'ワイドデニム、シルバースニーカー、レザーバッグを合わせる。',
          '黒スラックス、チェーンアクセサリー、ミニマルな背景でまとめる。',
        ],
      },
      '360度表示': {
        helper: '正面、背面、横、ディテールなど多角度の見せ方を作ります。',
        prompt: '360度表示で見せたい角度、ディテール、背景、回転順を入力してください。',
        historyLabel: '360度表示履歴',
        examples: [
          '正面、左斜め、背面、袖ディテールの4カットを作る。',
          'EC用にフード、袖口、裾、チェーン柄を順番に見せる。',
        ],
      },
    };
    const currentWorkspaceCopy = workspaceTabCopy[currentWorkspaceTab] ?? {
      helper: workspaceStyle.subtitle,
      prompt: workspaceStyle.prompt,
      historyLabel: workspaceStyle.kind === 'marketing' ? 'マイプロジェクト' : '履歴',
      examples: workspaceStyle.examples,
    };
    const visibleExamples = currentWorkspaceCopy.examples ?? workspaceStyle.examples;
    const workspaceTutorialSteps = [
      'ここで参考画像のアップロードや、アイデア（プロンプト）の入力ができます。',
      'おすすめのシーンから入力内容を切り替えられます。',
      '右側の矢印で生成を開始できます。',
      '生成後は履歴から保存・ダウンロードできます。',
    ];

    return (
      <main className="dark min-h-[calc(100vh-70px)] bg-[#101313] text-white" data-testid={`lightchain-workspace-${workspaceStyle.kind}`}>
        <section className="relative min-h-[calc(100vh-70px)] overflow-hidden px-4 py-14 sm:px-8">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_52%_20%,rgba(101,211,207,0.22),transparent_38%),linear-gradient(90deg,rgba(15,23,42,0.15),rgba(34,197,94,0.1),rgba(59,130,246,0.12))]" />
          {workspaceStyle.kind === 'marketing' && (
            <div className="absolute right-4 top-4 rounded-lg border border-white/10 bg-[#1b2125] px-4 py-3 text-sm font-semibold text-neutral-200">
              ✦ 33607
            </div>
          )}
          {workspaceStyle.kind === 'agent' && (
            <Link
              to="/lightchain"
              data-testid="lightchain-design-agent-menu"
              className="absolute left-5 top-5 flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-[#171c1f] text-neutral-200"
              aria-label="メニュー"
            >
              <ClipboardList className="h-5 w-5" />
            </Link>
          )}
          <div className={`relative mx-auto ${workspaceStyle.kind === 'marketing' ? 'max-w-[980px]' : 'max-w-[720px]'} text-center`}>
            <h1 className={`${workspaceStyle.kind === 'marketing' ? 'text-3xl sm:text-4xl' : 'text-3xl'} font-semibold tracking-tight text-white`}>
              {workspaceStyle.title}
            </h1>
            <p className="mt-4 text-sm text-neutral-400">{workspaceStyle.subtitle}</p>
            {renderLightchainProviderGate()}

            {workspaceStyle.tabs && (
              <div className="mx-auto mt-6 inline-flex rounded-xl border border-white/10 bg-[#1a1f22] p-1" role="tablist" aria-label={`${workspaceStyle.title}タブ`}>
                {workspaceTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={currentWorkspaceTab === tab}
                    onClick={() => {
                      setWorkspaceTextDrafts((drafts) => ({ ...drafts, [currentWorkspaceTab]: workspaceText }));
                      setActiveWorkspaceTab(tab);
                      const nextCopy = workspaceTabCopy[tab];
                      setWorkspaceText(workspaceTextDrafts[tab] ?? nextCopy?.prompt ?? '');
                    }}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${currentWorkspaceTab === tab ? 'bg-[#3b4247] text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}
            {workspaceTabs.length > 0 && (
              <p className="mx-auto mt-3 max-w-[560px] text-xs leading-5 text-[#65d3cf]" data-testid="lightchain-workspace-tab-state">
                {currentWorkspaceCopy.helper}
              </p>
            )}

            {visibleExamples && (
              <div className="mt-7 text-left">
                <p className="text-sm text-neutral-300">こちらをお試しください</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {visibleExamples.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setWorkspaceText(example)}
                      className="rounded-lg bg-[#1b2125] px-4 py-3 text-left text-sm leading-6 text-neutral-300 transition hover:bg-[#232b30]"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={`${workspaceStyle.kind === 'marketing' ? 'mt-6 min-h-[232px] border-[#0bcabc]' : 'mt-4 min-h-[160px] border-cyan-300/80'} rounded-2xl border bg-[#1a1f22]/95 p-3 shadow-[0_0_28px_rgba(101,211,207,0.18)]`}>
              <div className={`${workspaceStyle.kind === 'marketing' ? 'grid min-h-[206px] grid-cols-[120px_1fr_52px]' : 'grid min-h-[136px] grid-cols-[1fr_52px]'} items-center gap-4 rounded-2xl bg-[#1d2326] px-4 text-left`}>
                {workspaceStyle.kind === 'marketing' && (
                  <button
                    type="button"
                    onClick={() => openMaterialModalForSlot('primary')}
                    className="flex h-28 w-24 rotate-[-8deg] items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#243039,#101719)] text-neutral-300"
                  >
                    <ImagePlus className="h-6 w-6" />
                  </button>
                )}
                <div className="relative h-full min-h-[112px]">
                  {workspaceStyle.kind === 'agent' && (
                    <div className="pointer-events-none absolute left-0 top-4 z-10 flex max-w-[520px] flex-wrap gap-1 text-sm">
                      {['LOUIS VUITTON', '2026年春夏', 'ショートジャケット', 'シャツ', 'ロングパンツ', 'ショートパンツ', 'メンズ'].map((chip) => (
                        <span key={chip} className="rounded bg-[#244440] px-2 py-0.5 text-[#7ee1d4]">{chip}</span>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={workspaceText}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setWorkspaceText(nextValue);
                      if (currentWorkspaceTab) {
                        setWorkspaceTextDrafts((drafts) => ({ ...drafts, [currentWorkspaceTab]: nextValue }));
                      }
                    }}
                    placeholder={currentWorkspaceCopy.prompt}
                    maxLength={4000}
                    className={`h-full min-h-[112px] w-full resize-none border-0 bg-transparent ${workspaceStyle.kind === 'agent' ? 'pt-[74px]' : 'py-5'} text-sm leading-7 text-neutral-200 outline-none placeholder:text-neutral-400`}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleWorkspaceStyleGenerate}
                  disabled={specialProviderGenerationLocked}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-[#253034] text-[#65d3cf] transition hover:bg-[#65d3cf] hover:text-neutral-950"
                  aria-label="AI生成"
                >
                  <ArrowRight className="h-5 w-5 -rotate-45" />
                </button>
              </div>
              {workspaceStyle.kind === 'marketing' && !workspaceTutorialDismissed && (
                <div className="absolute left-1/2 mt-[-150px] hidden -translate-x-1/2 items-center gap-3 rounded-full bg-[#91f0df] px-4 py-2 text-xs font-semibold text-neutral-950 shadow-xl lg:flex" data-testid="lightchain-workspace-tutorial">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-white ring-4 ring-[#65d3cf]/50" />
                  <span className="min-w-0">{workspaceTutorialSteps[workspaceTutorialStep - 1]} {workspaceTutorialStep}/4</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (workspaceTutorialStep >= workspaceTutorialSteps.length) {
                        setWorkspaceTutorialDismissed(true);
                      } else {
                        setWorkspaceTutorialStep((current) => current + 1);
                      }
                    }}
                    data-testid="lightchain-workspace-tutorial-next"
                    className="shrink-0 underline"
                  >
                    {workspaceTutorialStep >= workspaceTutorialSteps.length ? '完了' : '次へ'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceTutorialDismissed(true)}
                    data-testid="lightchain-workspace-tutorial-skip"
                    className="shrink-0 underline"
                  >
                    スキップ
                  </button>
                </div>
              )}
              {workspaceStyle.kind === 'marketing' && (
                <p className="mt-[-48px] pr-16 text-right text-sm text-neutral-500">0 / 4000</p>
              )}
            </div>

            {workspaceStyle.chips && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <span className="mr-1 text-sm text-neutral-300">おすすめのシーン👉</span>
                {workspaceStyle.chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setWorkspaceText(`${chip}向けに${workspaceStyle.prompt}`)}
                    className="rounded-xl bg-[#262c30] px-5 py-3 text-sm font-semibold text-neutral-200 transition hover:bg-[#343c41]"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
          </div>

          <section className={`relative mx-auto mt-8 ${workspaceStyle.kind === 'marketing' ? 'max-w-[1130px]' : 'max-w-[720px]'}`}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{currentWorkspaceCopy.historyLabel}</h2>
              {lightchainResult && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveToCanvas}
                    disabled={isSaving}
                    className="rounded-xl border border-white/10 bg-[#20272a] px-4 py-2 text-sm font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadLightchainResult()}
                    disabled={!lightchainResult}
                    data-testid="lightchain-workspace-result-download"
                    className="rounded-xl border border-white/10 bg-[#20272a] px-4 py-2 text-sm font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                  >
                    ダウンロード
                  </button>
                </div>
              )}
            </div>
            {lightchainResult ? (
              <div className="mt-4 overflow-hidden rounded-xl bg-[#1b2023]">
                {renderLightchainResultPreviewImage('h-36 w-full object-cover', '生成結果プレビュー')}
                <div className="px-4 py-3 text-left">
                  <p className="truncate text-sm font-semibold text-neutral-200">{lightchainResult.title}</p>
                  <p className="mt-1 truncate text-xs text-neutral-500">{lightchainResult.summary}</p>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex min-h-36 items-center justify-center rounded-xl border border-dashed border-white/15 bg-[#1b2023] px-4 text-center text-sm text-neutral-500">
                保存済みの履歴はありません。生成結果を保存すると、ここに表示されます。
              </div>
            )}
          </section>
          {workspaceStyle.kind === 'agent' && (
            <div className="absolute bottom-6 right-14 rounded-xl border border-white/10 bg-[#171c1f] px-4 py-3 text-sm text-neutral-300">
              ✦ 残り生成回数 9
            </div>
          )}
        </section>
      </main>
    );
  }

  if (selectedTool.id === 'marketing-detail') {
    const assistantPresets = ['詳細ページの画像ギャラリー', '画像付きノート／ブログ', 'ブランドストーリーの構築'];
    const marketingTutorialSteps = [
      'ここをクリックしてプロジェクト名を変更できます',
      'レイヤーから編集対象を選択できます',
      'アセットから画像素材を追加できます',
      'キャンバスツールで作業面を操作できます',
      'アシスタントから生成内容を指定できます',
      '生成後に保存・ダウンロードできます',
    ];
    const layerRows = [
      { id: 'background', label: '背景' },
      { id: 'product', label: '商品画像' },
      { id: 'copy', label: '見出しテキスト' },
      { id: 'cta', label: 'CTAボタン' },
    ];
    const canvasTools = ['選択', '手のひら', '戻る', '進む', '矩形', 'グリッド', 'テキスト', '画像'];

    return (
      <main className="dark min-h-screen bg-[#0b0f10] px-4 py-4 text-white sm:px-6" data-testid="lightchain-marketing-detail-page">
        <section className="grid min-h-[calc(100vh-102px)] gap-4 xl:grid-cols-[280px_minmax(0,1fr)_420px]">
          <aside className="rounded-2xl border border-white/10 bg-[#151a1d] p-4">
            <button
              type="button"
              onClick={() => navigate('/lightchain/marketing-home')}
              data-testid="lightchain-marketing-workspace-home"
              className="text-sm font-semibold text-neutral-300 transition hover:text-white"
            >
              マーケティングワークスペース
            </button>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/lightchain/marketing-home')}
                data-testid="lightchain-marketing-back"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#20272a] text-neutral-300 transition hover:border-cyan-300/50 hover:text-white"
                aria-label="戻る"
              >
                <ArrowRight className="h-4 w-4 rotate-180" />
              </button>
              {marketingProjectNameEditing ? (
                <input
                  autoFocus
                  value={marketingProjectNameDraft}
                  onChange={(event) => setMarketingProjectNameDraft(event.target.value.slice(0, 80))}
                  onBlur={commitMarketingProjectName}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitMarketingProjectName();
                    }
                    if (event.key === 'Escape') {
                      setMarketingProjectNameDraft(marketingProjectName);
                      setMarketingProjectNameEditing(false);
                    }
                  }}
                  data-testid="lightchain-marketing-project-name-input"
                  aria-label="プロジェクト名"
                  className="min-w-0 flex-1 rounded-xl border border-[#65d3cf] bg-[#1b2426] px-4 py-3 text-sm font-semibold text-white outline-none shadow-[0_0_18px_rgba(101,211,207,0.18)]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setMarketingProjectNameEditing(true)}
                  data-testid="lightchain-marketing-project-name"
                  className="flex-1 rounded-xl border border-[#65d3cf] bg-[#1b2426] px-4 py-3 text-left text-sm font-semibold text-white shadow-[0_0_18px_rgba(101,211,207,0.18)] transition hover:bg-[#243436]"
                >
                  {marketingProjectName}
                </button>
              )}
            </div>
            {!marketingTutorialDismissed && (
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-[#65d3cf]/50 bg-[#91f0df] px-4 py-2 text-xs font-semibold text-neutral-950" data-testid="lightchain-marketing-tutorial">
                <span className="min-w-0 flex-1">{marketingTutorialSteps[marketingTutorialStep - 1]} {marketingTutorialStep}/6</span>
                <button
                  type="button"
                  onClick={() => {
                    if (marketingTutorialStep >= marketingTutorialSteps.length) {
                      setMarketingTutorialDismissed(true);
                    } else {
                      setMarketingTutorialStep((current) => current + 1);
                    }
                  }}
                  data-testid="lightchain-marketing-tutorial-next"
                  className="shrink-0 underline"
                >
                  {marketingTutorialStep >= marketingTutorialSteps.length ? '完了' : '次へ'}
                </button>
                <button
                  type="button"
                  onClick={() => setMarketingTutorialDismissed(true)}
                  data-testid="lightchain-marketing-tutorial-skip"
                  className="shrink-0 underline"
                >
                  スキップ
                </button>
              </div>
            )}
            <div className="mt-6 grid gap-3">
              {[
                { label: 'レイヤー', icon: Layers3, onClick: () => setMarketingDetailTab('layers'), testId: 'lightchain-marketing-layers-nav' },
                { label: 'アセット', icon: Boxes, onClick: () => openMaterialModalForSlot('primary'), testId: 'lightchain-marketing-assets-nav' },
              ].map(({ label, icon: Icon, onClick, testId }) => (
                <button
                  key={label}
                  type="button"
                  onClick={onClick}
                  data-testid={testId}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#101719] px-4 py-3 text-sm font-semibold text-neutral-300 transition hover:border-cyan-300/50 hover:text-white"
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>
          </aside>

          <section
            className="relative flex min-h-[560px] flex-col rounded-2xl border border-white/10 bg-[#111416] p-4"
            data-testid="lightchain-marketing-canvas"
            data-active-tool={marketingCanvasTool}
            data-zoom={`${marketingCanvasZoom}%`}
          >
            <div className="absolute right-4 top-4 rounded-lg border border-white/10 bg-[#1b2125] px-4 py-3 text-sm font-semibold text-neutral-200">
              ✦ 33607
            </div>
            <label className="flex flex-1 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-600 bg-[#151719] p-6 text-center transition hover:border-cyan-300/60" data-testid="lightchain-marketing-upload-surface">
              <input type="file" accept="image/*" className="hidden" onChange={(event) => handleMaterialSlotUpload('primary', event)} />
              {materialSlotFiles.primary ? (
                <>
                  <img src={materialSlotFiles.primary.imageUrl} alt="商品画像" className="max-h-[360px] rounded-xl object-contain" />
                  <span className="mt-4 text-sm font-semibold text-white">{materialSlotFiles.primary.name}</span>
                </>
              ) : (
                <>
                  <Upload className="h-10 w-10 text-neutral-300" />
                  <p className="mt-5 text-sm font-semibold text-neutral-200">クリック・ドラッグ＆ドロップで画像をアップロード、またはAIとチャット</p>
                  <p className="mt-2 text-xs text-neutral-500">対応形式：jpg、jpeg、png、webp（最大20MBまで）</p>
                </>
              )}
            </label>
            <div className="mx-auto mt-[-24px] flex items-center gap-2 rounded-2xl border border-white/10 bg-[#181f22] p-2 shadow-xl">
              {canvasTools.map((tool, index) => (
                <button
                  key={tool}
                  type="button"
                  disabled={index === 2 || index === 3}
                  onClick={() => {
                    setMarketingCanvasTool(tool);
                    if (tool === '画像') openMaterialModalForSlot('primary');
                  }}
                  data-testid={`lightchain-marketing-canvas-tool-${tool}`}
                  className={`flex h-9 min-w-9 items-center justify-center rounded-lg px-3 text-xs font-semibold ${marketingCanvasTool === tool ? 'bg-[#65d3cf] text-neutral-950' : 'bg-[#20272a] text-neutral-300 disabled:opacity-40'}`}
                >
                  {tool}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMarketingCanvasZoom((current) => current >= 100 ? 20 : current + 20)}
                data-testid="lightchain-marketing-zoom-value"
                aria-label="ズーム倍率"
                className="rounded-lg bg-[#20272a] px-3 py-2 text-sm font-semibold text-neutral-300 transition hover:bg-[#2d383c]"
              >
                {marketingCanvasZoom}%
              </button>
              <button
                type="button"
                onClick={() => setMarketingCanvasZoom(100)}
                data-testid="lightchain-marketing-zoom-fit"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#20272a] text-neutral-300 transition hover:bg-[#2d383c]"
                aria-label="ズーム"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
          </section>

          <aside className="flex max-h-[calc(100vh-102px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#171c1f]" data-testid="lightchain-marketing-assistant-panel">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              {[
                ['assistant', 'AIアシスタント'],
                ['layers', 'レイヤー設定'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMarketingDetailTab(id as 'assistant' | 'layers')}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${marketingDetailTab === id ? 'border border-[#65d3cf] bg-[#1b2b2c] text-white' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {marketingDetailTab === 'assistant' ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <p className="text-sm font-semibold text-white">新しいチャット</p>
                <h1 className="mt-10 text-2xl font-bold leading-10 text-white">こんにちは<br />専属のデザインアシスタントがサポートします。</h1>
                <p className="mt-5 text-sm leading-6 text-neutral-400">具体的なリクエストを入力するか、以下のプリセットから最適なシーンを選択してください。</p>
                <div className="mt-8 grid gap-3">
                  {assistantPresets.map((preset) => (
                    <button key={preset} type="button" onClick={() => setMarketingDetailPrompt(preset)} className="rounded-xl bg-[#23292c] px-4 py-3 text-left text-sm font-semibold text-neutral-200 transition hover:bg-[#2d3438]">
                      {preset}
                    </button>
                  ))}
                </div>
                {lightchainProviderSupported && (
                  <div className="mt-4 space-y-2 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] p-3" data-testid="lightchain-provider-gate">
                    <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-cyan-50">
                      <input
                        type="checkbox"
                        checked={providerRightsConfirmed}
                        onChange={(event) => {
                          setProviderRightsConfirmed(event.target.checked);
                          setLightchainGenerationError(null);
                        }}
                        className="mt-1 h-4 w-4 accent-[#65d3cf]"
                        data-testid="lightchain-rights-confirmation"
                      />
                      <span>
                        アップロードした画像・人物・柄・生地について、AI生成に利用する権利または許諾を確認済みです。
                        <span className="mt-1 block text-[11px] text-cyan-100/60">確認後のみ実プロバイダを実行します。未確認時は結果を作成しません。</span>
                      </span>
                    </label>
                    {lightchainGenerationRunning && (
                      <p className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-2 text-xs font-semibold text-cyan-50">AI生成を実行中です。</p>
                    )}
                    {lightchainGenerationError && (
                      <p className="rounded-xl border border-rose-300/20 bg-rose-300/[0.08] px-3 py-2 text-xs font-semibold text-rose-100" data-testid="lightchain-generation-error">
                        {lightchainGenerationError}
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-4 rounded-2xl border border-white/10 bg-[#111719] p-3">
                  <textarea
                    value={marketingDetailPrompt}
                    onChange={(event) => setMarketingDetailPrompt(event.target.value.slice(0, 400))}
                    placeholder="商品画像をアップロードして、デザインのリクエストを教えてください"
                    className="min-h-[84px] w-full resize-none border-0 bg-transparent text-sm leading-6 text-neutral-100 outline-none placeholder:text-neutral-500"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <button type="button" onClick={() => openMaterialModalForSlot('primary')} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#20272a] text-neutral-200" aria-label="画像追加">
                      <ImagePlus className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={handleMarketingDetailGenerate} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#65d3cf] text-neutral-950" aria-label="更新">
                      <ArrowRight className="h-5 w-5 -rotate-45" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <h2 className="text-base font-semibold text-white">レイヤー設定</h2>
                <div className="mt-4 grid gap-2">
                  {layerRows.map((layer) => (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => setActiveLayer(layer.id)}
                      aria-pressed={activeLayer === layer.id}
                      data-testid={`lightchain-marketing-layer-${layer.id}`}
                      className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold ${activeLayer === layer.id ? 'bg-[#263335] text-[#65d3cf]' : 'bg-[#20272a] text-neutral-300'}`}
                    >
                      <span>{layer.label}</span>
                      <span className="text-xs text-neutral-500">{activeLayer === layer.id ? '選択中' : '表示'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <section className="max-h-[42%] shrink-0 overflow-y-auto border-t border-white/10 bg-[#0f1416] p-3" data-testid="lightchain-marketing-detail-readback" data-preview-title="マーケティング詳細プレビュー">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">生成履歴</p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleSaveToCanvas} disabled={isSaving || !lightchainResult} className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 disabled:opacity-60">保存</button>
                  <button type="button" onClick={() => void handleDownloadLightchainResult()} disabled={!lightchainResult} data-testid="marketing-detail-result-download" className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 disabled:opacity-60">ダウンロード</button>
                </div>
              </div>
              <p className="mt-3 text-sm font-semibold text-white">マーケティング詳細プレビュー</p>
              {lightchainResult ? (
                <>
                  {renderLightchainResultPreviewImage('mt-3 h-36 w-full rounded-lg object-cover', 'マーケティング詳細プレビュー')}
                  <p className="mt-2 text-xs leading-5 text-neutral-400">{lightchainResult.summary}</p>
                </>
              ) : (
                <p className="mt-2 text-xs leading-5 text-neutral-500">プリセットまたはチャットから更新すると、ここにプレビューが表示されます。</p>
              )}
            </section>
          </aside>
        </section>
      </main>
    );
  }

  if (selectedTool.id === 'print-design-project') {
    const printProjectCards = buildWorkspaceProjectCards(
      workspaceArtifacts,
      ['lightchain-print-design-project', 'lightchain-print-design-detail'],
      '新規ファイル',
    );
    const exampleCards = [
      { title: 'ファッション用途', age: '参考サンプル', tone: 'bg-[linear-gradient(135deg,#f8fafc,#111827_42%,#65d3cf_43%,#f8fafc_72%)]' },
      { title: 'ホームテキスタイル', age: '参考サンプル', tone: 'bg-[radial-gradient(circle_at_35%_26%,#fef3c7,#111827_28%,#f8fafc_29%,#f8fafc_64%,#fb7185_65%)]' },
    ];

    return (
      <main className="dark min-h-screen bg-[#101010] px-4 py-4 text-white sm:px-6" data-testid="lightchain-print-design-project-page">
        <section className="mx-auto max-w-[1180px]">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-base font-semibold text-white">柄・グラフィック</h1>
            <button
              type="button"
              onClick={handleProjectHomeGenerate}
              disabled={specialProviderGenerationLocked}
              className="rounded-xl bg-[#65d3cf] px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-[#78e0dc]"
            >
              生成へ
            </button>
          </div>
          {renderLightchainProviderGate()}
          {lightchainResult && (
            <div className="mt-4 grid gap-4 rounded-xl border border-white/10 bg-[#171c1f] p-3 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
              {renderLightchainResultPreviewImage('h-28 w-full rounded-lg object-cover', '生成結果プレビュー')}
              <div>
                <p className="text-sm font-semibold text-white">{lightchainResult.title}</p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-400">{lightchainResult.summary}</p>
              </div>
              <div className="flex flex-col gap-2 self-start">
                <button
                  type="button"
                  onClick={handleSaveToCanvas}
                  disabled={isSaving}
                  className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadLightchainResult()}
                  disabled={!lightchainResult}
                  data-testid="lightchain-print-design-project-result-download"
                  className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                >
                  ダウンロード
                </button>
              </div>
            </div>
          )}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {printProjectCards.map((card, index) => (
              <button
                key={`${card.title}-${index}`}
                type="button"
                onClick={() => navigate('/lightchain/print-design-detail')}
                className="overflow-hidden rounded-xl bg-[#171c1f] text-left transition hover:ring-1 hover:ring-cyan-300/60"
              >
                <div className="relative flex h-40 items-center justify-center bg-[#171c1f]">
                  {card.isNew ? (
                    <div className="flex flex-col items-center text-neutral-300">
                      <div className="relative flex h-16 w-20 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_28%_24%,#f8fafc,#5d646b_52%,#181f22)] text-xs font-bold text-white">
                        PRINT
                        <span className="absolute -bottom-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-xl font-bold text-neutral-700">+</span>
                      </div>
                      <span className="mt-5 text-sm font-semibold">新規ファイル</span>
                    </div>
                  ) : card.imageUrl ? (
                    <img src={card.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-semibold text-neutral-500">プレビュー未取得</span>
                  )}
                </div>
                {!card.isNew && (
                  <div className="px-4 py-4">
                    <p className="text-sm font-semibold text-neutral-200">{card.title}</p>
                    <p className="mt-2 text-xs text-neutral-500">{card.age}</p>
                  </div>
                )}
              </button>
            ))}
          </div>

          <h2 className="mt-6 text-base font-semibold text-white">参考事例</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
            {exampleCards.map((card) => (
              <button key={card.title} type="button" onClick={() => navigate('/lightchain/print-design-detail')} className="overflow-hidden rounded-xl bg-[#171c1f] text-left transition hover:ring-1 hover:ring-cyan-300/60">
                <div className={`h-40 ${card.tone}`} />
                <div className="px-4 py-4">
                  <p className="text-sm font-semibold text-neutral-200">{card.title}</p>
                  <p className="mt-2 text-xs text-neutral-500">{card.age}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (selectedTool.id === 'print-design-detail') {
    return (
      <main className="dark min-h-screen bg-[#0d1112] px-4 py-4 text-white sm:px-6" data-testid="lightchain-print-design-detail-page">
        {renderLightchainProviderGate()}
        {!printDesignDetailStarted ? (
          <section className="mx-auto flex min-h-[calc(100vh-112px)] max-w-[780px] items-center justify-center">
            <div className="w-full">
              <div className="mb-6 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/75">PRINT DESIGN</p>
                <h1 className="mt-2 text-2xl font-semibold text-white">柄・グラフィック詳細</h1>
                <p className="mt-2 text-sm text-neutral-400">ガイドを選び、素材を追加して、AI生成と生成履歴へ進みます。</p>
              </div>
              <div className="grid w-full gap-8 md:grid-cols-2">
                {[
                { mode: 'guide' as const, title: 'ガイドを見る', subtitle: 'ガイドを表示する', tone: 'bg-[#111719]' },
                { mode: 'no-guide' as const, title: 'ガイドを表示しない', subtitle: 'ガイド無しで開始します', tone: 'bg-[linear-gradient(135deg,#20282b,#30383b)]' },
              ].map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => handlePrintDesignStart(item.mode)}
                  disabled={specialProviderGenerationLocked}
                  className={`group flex min-h-[480px] flex-col justify-end rounded-2xl border border-white/10 p-7 text-left transition hover:border-cyan-300/50 ${item.tone}`}
                >
                  <div className="mb-auto flex flex-1 items-center justify-center">
                    {item.mode === 'guide' ? (
                      <div className="grid h-52 w-52 grid-cols-3 gap-3 opacity-30">
                        {Array.from({ length: 9 }).map((_, index) => <span key={index} className="rounded-lg bg-white/10" />)}
                      </div>
                    ) : (
                      <div className="relative h-44 w-44 rounded-[36px] border border-cyan-300/20 bg-[#111719] shadow-[0_0_32px_rgba(101,211,207,0.12)]">
                        <ArrowRight className="absolute left-11 top-12 h-24 w-24 -rotate-45 text-neutral-200 drop-shadow" />
                      </div>
                    )}
                  </div>
                  <h1 className="text-2xl font-semibold text-white">{item.title}</h1>
                  <p className="mt-3 text-sm font-semibold text-neutral-400">{item.subtitle}</p>
                </button>
              ))}
              </div>
            </div>
          </section>
        ) : (
          <section className="grid gap-4 lg:grid-cols-[84px_596px_minmax(0,1fr)]" data-testid="lightchain-print-design-workbench">
            <aside className="hidden rounded-2xl border border-neutral-800 bg-neutral-900/90 p-3 lg:block">
              <div className="flex flex-col items-center gap-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200">
                  <Palette className="h-6 w-6" />
                </div>
                <div className="flex w-full flex-col items-center gap-2 rounded-xl bg-cyan-400/15 px-2 py-3 text-[11px] font-semibold leading-4 text-cyan-200">
                  <WandSparkles className="h-5 w-5" />
                  <span>柄・グラフィック</span>
                </div>
              </div>
            </aside>

            <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#171c1f]" data-testid="lightchain-print-design-input-panel">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
                <div>
                  <h1 className="text-base font-semibold text-white">柄・グラフィック</h1>
                  <p className="mt-1 text-xs font-semibold text-neutral-500">無題のプロジェクト / {printDesignMode === 'guide' ? 'ガイドあり' : 'ガイドなし'}</p>
                </div>
                <button type="button" onClick={() => setPrintDesignDetailStarted(false)} className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-300 transition hover:text-white">
                  戻る
                </button>
              </div>
              <div className="p-4">
                <label className="flex min-h-[312px] cursor-pointer flex-col items-center justify-center rounded-xl bg-[#121719] p-5 text-center transition hover:bg-[#151c1f]">
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => handleMaterialSlotUpload('primary', event)} />
                  {materialSlotFiles.primary ? (
                    <>
                      <img src={materialSlotFiles.primary.imageUrl} alt="プリント画像" className="max-h-56 rounded-lg object-contain" />
                      <span className="mt-3 text-sm font-semibold text-white">{materialSlotFiles.primary.name}</span>
                    </>
                  ) : (
                    <>
                      <ImagePlus className="h-7 w-7 text-neutral-300" />
                      <span className="mt-5 text-sm font-semibold text-neutral-200">ここをクリックまたはドラッグして画像を追加</span>
                      <span className="mt-2 text-xs text-neutral-500">jpg、jpeg、png、webp形式の画像（最大20M）に対応</span>
                    </>
                  )}
                </label>

                <div className="mt-5 grid gap-3">
                  <div className="rounded-xl border border-white/10 bg-[#111719] p-4">
                    <p className="text-sm font-semibold text-neutral-200">用途</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {['ファッション', 'ホーム', '総柄', 'ワンポイント'].map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setPrintDesignStyle(item)}
                          aria-pressed={printDesignStyle === item}
                          data-testid={`lightchain-print-design-style-${item}`}
                          className={`rounded-lg px-3 py-2 text-sm font-semibold ${printDesignStyle === item ? 'bg-[#737d84] text-white' : 'bg-[#20272a] text-neutral-400'}`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="print-design-prompt" className="text-sm font-semibold text-neutral-200">指示</label>
                    <textarea
                      id="print-design-prompt"
                      value={printDesignPrompt}
                      onChange={(event) => setPrintDesignPrompt(event.target.value.slice(0, 200))}
                      placeholder="例：花柄を少し整理して、ワンピース向けの配色にしてください。"
                      className="mt-3 min-h-[92px] w-full resize-none rounded-xl border border-white/10 bg-[#111719] px-4 py-3 text-sm leading-6 text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-cyan-300/60"
                    />
                    <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                      <span>文字数：{printDesignPrompt.length}/200</span>
                      <button type="button" onClick={() => setPrintDesignPrompt('')} disabled={!printDesignPrompt} className="font-semibold text-neutral-400 transition hover:text-white disabled:text-neutral-600">全削除</button>
                    </div>
                  </div>
                </div>

                <button type="button" onClick={() => handlePrintDesignStart(printDesignMode)} disabled={specialProviderGenerationLocked} className="mt-4 flex w-full items-center justify-center rounded-xl bg-[#65d3cf] px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-[#78e0dc] disabled:cursor-not-allowed disabled:opacity-50">
                  つくる <Sparkles className="ml-2 h-4 w-4" />
                </button>
              </div>
            </section>

            <aside className="rounded-2xl border border-white/10 bg-[#141717] p-4" data-testid="lightchain-print-design-history">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">生成履歴</h2>
                {lightchainResult && (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleSaveToCanvas} disabled={isSaving} className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60">
                      保存
                    </button>
                    <button type="button" onClick={() => void handleDownloadLightchainResult()} data-testid="lightchain-print-design-detail-result-download" className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60">
                      ダウンロード
                    </button>
                  </div>
                )}
              </div>
              {lightchainResult ? (
                <div className="mt-4 overflow-hidden rounded-xl bg-[#0f1416]" data-testid="lightchain-print-design-readback">
                  {renderLightchainResultPreviewImage('h-56 w-full object-cover', '柄・グラフィックプレビュー')}
                  <div className="p-4">
                    <p className="text-sm font-semibold text-white">{lightchainResult.title}</p>
                    <p className="mt-2 text-xs leading-6 text-neutral-400">{lightchainResult.summary}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex h-64 items-center justify-center rounded-xl bg-[#0f1416] text-sm font-semibold text-neutral-500">
                  素材選択後に表示
                </div>
              )}
            </aside>
          </section>
        )}
      </main>
    );
  }

  if (selectedTool.id === 'wear-design-lab') {
    const projectCards = buildWorkspaceProjectCards(
      workspaceArtifacts,
      ['lightchain-wear-design-lab', 'lightchain-wear-design-detail'],
      '新規ファイル',
    );
    const exampleCards = [
      { title: 'デザイン要素融合', age: '参考サンプル', tone: 'bg-[linear-gradient(135deg,#dbeafe,#f8fafc_52%,#65d3cf_53%)]' },
      { title: 'ディテール変更', age: '参考サンプル', tone: 'bg-[linear-gradient(135deg,#f8fafc,#fca5a5_58%,#111827_59%)]' },
    ];

    return (
      <main className="dark min-h-screen bg-[#101010] px-4 py-4 text-white sm:px-6" data-testid="lightchain-wear-design-lab-page">
        <section className="mx-auto max-w-[1180px]">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-base font-semibold text-white">ウェアデザインラボ</h1>
            <button
              type="button"
              onClick={handleProjectHomeGenerate}
              disabled={specialProviderGenerationLocked}
              className="rounded-xl bg-[#65d3cf] px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-[#78e0dc]"
            >
              AI生成
            </button>
          </div>
          {renderLightchainProviderGate()}
          {lightchainResult && (
            <div className="mt-4 grid gap-4 rounded-xl border border-white/10 bg-[#171c1f] p-3 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
              {renderLightchainResultPreviewImage('h-28 w-full rounded-lg object-cover', '生成結果プレビュー')}
              <div>
                <p className="text-sm font-semibold text-white">{lightchainResult.title}</p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-400">{lightchainResult.summary}</p>
              </div>
              <div className="flex flex-col gap-2 self-start">
                <button
                  type="button"
                  onClick={handleSaveToCanvas}
                  disabled={isSaving}
                  className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadLightchainResult()}
                  disabled={!lightchainResult}
                  data-testid="lightchain-wear-design-lab-result-download"
                  className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                >
                  ダウンロード
                </button>
              </div>
            </div>
          )}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {projectCards.map((card, index) => (
              <button
                key={`${card.title}-${index}`}
                type="button"
                onClick={() => navigate('/lightchain/wear-design-detail')}
                className="overflow-hidden rounded-xl bg-[#171c1f] text-left transition hover:ring-1 hover:ring-cyan-300/60"
              >
                <div className="flex h-40 items-center justify-center bg-[#171c1f]">
                  {card.isNew ? (
                    <div className="flex flex-col items-center text-neutral-300">
                      <div className="relative flex h-16 w-20 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_28%_24%,#e7ffe8,#5d646b_52%,#181f22)] text-xs font-bold text-white">
                        PROJECT
                        <span className="absolute -bottom-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-xl font-bold text-neutral-700">+</span>
                      </div>
                      <span className="mt-5 text-sm font-semibold">新規ファイル</span>
                    </div>
                  ) : card.imageUrl ? (
                    <img src={card.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-semibold text-neutral-500">プレビュー未取得</span>
                  )}
                </div>
                {!card.isNew && (
                  <div className="px-4 py-4">
                    <p className="text-sm font-semibold text-neutral-200">{card.title}</p>
                    <p className="mt-2 text-xs text-neutral-500">{card.age}</p>
                  </div>
                )}
              </button>
            ))}
          </div>

          <h2 className="mt-6 text-base font-semibold text-white">参考事例</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {exampleCards.map((card) => (
              <button key={card.title} type="button" onClick={() => navigate('/lightchain/wear-design-detail')} className="overflow-hidden rounded-xl bg-[#171c1f] text-left transition hover:ring-1 hover:ring-cyan-300/60">
                <div className={`h-40 ${card.tone}`} />
                <div className="px-4 py-4">
                  <p className="text-sm font-semibold text-neutral-200">{card.title}</p>
                  <p className="mt-2 text-xs text-neutral-500">{card.age}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (selectedTool.id === 'wear-design-detail') {
    return (
      <main className="dark min-h-screen bg-[#0d1112] px-4 py-4 text-white sm:px-6" data-testid="lightchain-wear-design-detail-page">
        {renderLightchainProviderGate()}
        {!wearDesignDetailStarted ? (
          <section className="mx-auto flex min-h-[calc(100vh-112px)] max-w-[780px] items-center justify-center">
            <div className="grid w-full gap-8 md:grid-cols-2">
              {[
                { mode: 'guide' as const, title: 'ガイドを見る', subtitle: 'ガイドを表示する', tone: 'bg-[#111719]' },
                { mode: 'no-guide' as const, title: 'ガイドを表示しない', subtitle: 'ガイド無しで開始します', tone: 'bg-[linear-gradient(135deg,#20282b,#30383b)]' },
              ].map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => handleWearDesignStart(item.mode)}
                  disabled={specialProviderGenerationLocked}
                  className={`group flex min-h-[480px] flex-col justify-end rounded-2xl border border-white/10 p-7 text-left transition hover:border-cyan-300/50 ${item.tone}`}
                >
                  <div className="mb-auto flex flex-1 items-center justify-center">
                    {item.mode === 'guide' ? (
                      <div className="grid h-48 w-48 grid-cols-3 gap-3 opacity-30">
                        {Array.from({ length: 9 }).map((_, index) => <span key={index} className="rounded-lg bg-white/10" />)}
                      </div>
                    ) : (
                      <div className="relative h-44 w-44 rounded-[36px] border border-cyan-300/20 bg-[#111719] shadow-[0_0_32px_rgba(101,211,207,0.12)]">
                        <ArrowRight className="absolute left-11 top-12 h-24 w-24 -rotate-45 text-neutral-200 drop-shadow" />
                      </div>
                    )}
                  </div>
                  <h1 className="text-2xl font-semibold text-white">{item.title}</h1>
                  <p className="mt-3 text-sm font-semibold text-neutral-400">{item.subtitle}</p>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="grid gap-4 lg:grid-cols-[84px_596px_minmax(0,1fr)]" data-testid="lightchain-wear-design-workbench">
            <aside className="hidden rounded-2xl border border-neutral-800 bg-neutral-900/90 p-3 lg:block">
              <div className="flex flex-col items-center gap-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200">
                  <Palette className="h-6 w-6" />
                </div>
                <div className="flex w-full flex-col items-center gap-2 rounded-xl bg-cyan-400/15 px-2 py-3 text-[11px] font-semibold leading-4 text-cyan-200">
                  <WandSparkles className="h-5 w-5" />
                  <span>ディテール変更</span>
                </div>
              </div>
            </aside>

            <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#171c1f]" data-testid="lightchain-wear-design-input-panel">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
                <div>
                  <h1 className="text-base font-semibold text-white">ウェアデザイン詳細</h1>
                  <p className="mt-1 text-xs font-semibold text-neutral-500">{wearDesignMode === 'guide' ? 'ガイドを見る' : 'ガイド無しで開始します'}</p>
                </div>
                <button type="button" onClick={() => setWearDesignDetailStarted(false)} className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-300 transition hover:text-white">
                  ガイドを見る
                </button>
              </div>
              <div className="p-4">
                <label className="flex min-h-[256px] cursor-pointer flex-col items-center justify-center rounded-xl bg-[#121719] p-5 text-center transition hover:bg-[#151c1f]">
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => handleMaterialSlotUpload('primary', event)} />
                  {materialSlotFiles.primary ? (
                    <>
                      <img src={materialSlotFiles.primary.imageUrl} alt="対象画像" className="max-h-48 rounded-lg object-contain" />
                      <span className="mt-3 text-sm font-semibold text-white">{materialSlotFiles.primary.name}</span>
                    </>
                  ) : (
                    <>
                      <ImagePlus className="h-7 w-7 text-neutral-300" />
                      <span className="mt-5 text-sm font-semibold text-neutral-200">画像を追加</span>
                      <span className="mt-2 text-xs text-neutral-500">クリック/ドラッグ＆ドロップで対象画像をアップロード</span>
                    </>
                  )}
                </label>

                <div className="mt-5 grid gap-3">
                  <div className="rounded-xl border border-white/10 bg-[#111719] p-4">
                    <p className="text-sm font-semibold text-neutral-200">変更したい箇所</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {['襟', '袖', '柄', '裾'].map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setWearDesignFocus(item)}
                          aria-pressed={wearDesignFocus === item}
                          data-testid={`lightchain-wear-design-focus-${item}`}
                          className={`rounded-lg px-3 py-2 text-sm font-semibold ${wearDesignFocus === item ? 'bg-[#737d84] text-white' : 'bg-[#20272a] text-neutral-400'}`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="wear-design-prompt" className="text-sm font-semibold text-neutral-200">ディテール変更の説明</label>
                    <textarea
                      id="wear-design-prompt"
                      value={wearDesignPrompt}
                      onChange={(event) => setWearDesignPrompt(event.target.value.slice(0, 200))}
                      placeholder="例：襟元に花柄刺繍を追加し、元のシルエットと生地感は維持してください。"
                      className="mt-3 min-h-[92px] w-full resize-none rounded-xl border border-white/10 bg-[#111719] px-4 py-3 text-sm leading-6 text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-cyan-300/60"
                    />
                    <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                      <span>文字数：{wearDesignPrompt.length}/200</span>
                      <button type="button" onClick={() => setWearDesignPrompt('')} disabled={!wearDesignPrompt} className="font-semibold text-neutral-400 transition hover:text-white disabled:text-neutral-600">全削除</button>
                    </div>
                  </div>
                </div>

                <button type="button" onClick={() => handleWearDesignStart(wearDesignMode)} disabled={specialProviderGenerationLocked} className="mt-4 flex w-full items-center justify-center rounded-xl bg-[#65d3cf] px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-[#78e0dc] disabled:cursor-not-allowed disabled:opacity-50">
                  AI生成 <Sparkles className="ml-2 h-4 w-4" />
                </button>
              </div>
            </section>

            <aside className="rounded-2xl border border-white/10 bg-[#141717] p-4" data-testid="lightchain-wear-design-history">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">生成履歴</h2>
                {lightchainResult && (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleSaveToCanvas} disabled={isSaving} className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60">
                      保存
                    </button>
                    <button type="button" onClick={() => void handleDownloadLightchainResult()} data-testid="lightchain-wear-design-detail-result-download" className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60">
                      ダウンロード
                    </button>
                  </div>
                )}
              </div>
              {lightchainResult ? (
                <div className="mt-4 overflow-hidden rounded-xl bg-[#0f1416]" data-testid="lightchain-wear-design-readback">
                  {renderLightchainResultPreviewImage('h-56 w-full object-cover', 'ディテール変更プレビュー')}
                  <div className="p-4">
                    <p className="text-sm font-semibold text-white">{lightchainResult.title}</p>
                    <p className="mt-2 text-xs leading-6 text-neutral-400">{lightchainResult.summary}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex h-64 items-center justify-center rounded-xl bg-[#0f1416] text-sm font-semibold text-neutral-500">
                  素材選択後に表示
                </div>
              )}
            </aside>
          </section>
        )}
      </main>
    );
  }

  if (selectedTool.id === 'custom-style') {
    const customStyleCards = [
      { title: 'カフェスタイル', tone: 'bg-[linear-gradient(135deg,#d7f5e8,#f9fafb)]', done: true },
      { title: 'リゾート', tone: 'bg-[linear-gradient(135deg,#fee2c6,#f8fafc)]', done: true },
      { title: 'かりゆしウェアビジネス', tone: 'bg-[linear-gradient(135deg,#dbeafe,#f8fafc)]', done: true },
      { title: 'テスト', tone: 'bg-[linear-gradient(135deg,#cffafe,#f3e8ff)]', done: true },
    ];

    return (
      <main className="dark min-h-screen bg-[#0d1112] px-4 py-4 text-white sm:px-6" data-testid="lightchain-custom-style-page">
        <div className="grid gap-4 lg:grid-cols-[84px_minmax(0,1fr)]">
          <aside className="hidden rounded-2xl border border-neutral-800 bg-neutral-900/90 p-3 lg:block">
            <div className="flex flex-col items-center gap-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200">
                <WandSparkles className="h-6 w-6" />
              </div>
              <div className="flex w-full flex-col items-center gap-2 rounded-xl bg-cyan-400/15 px-2 py-3 text-[11px] font-semibold leading-4 text-cyan-200">
                <Palette className="h-5 w-5" />
                <span>カスタムスタイル</span>
              </div>
            </div>
          </aside>

          <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#171c1f] p-5 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-lg font-semibold text-white">ラーニング素材をアップロードしてください</h1>
              <button
                type="button"
                onClick={handleCustomStyleSave}
                disabled={specialProviderGenerationLocked}
                className="rounded-full bg-[#7b5c34] px-4 py-2 text-xs font-bold text-[#f7e7c8] transition hover:bg-[#8b6a40]"
              >
                カスタマイズについて連絡する
              </button>
            </div>
            {renderLightchainProviderGate()}

            <button
              type="button"
              onClick={() => openMaterialModalForSlot('primary')}
              className="mt-4 flex min-h-[164px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-neutral-500/70 bg-[#14191b] px-6 text-center transition hover:border-cyan-300/70"
            >
              <ImagePlus className="h-7 w-7 text-neutral-300" />
              <p className="mt-4 text-sm font-semibold text-white">次の要件を満たす写真をアップロードしてください：</p>
              <p className="mt-2 max-w-3xl text-xs leading-6 text-neutral-400">
                1、正面または斜めから撮影された全身または半身のモデル画像 2、画像の背景が可能な限り似している画像
                <br />
                3、推奨される画像のアップロード数は30〜50枚 4、画像は鮮明で、比率は統一されていることが望ましい
              </p>
            </button>

            <section className="mt-5">
              <h2 className="text-base font-semibold text-white">カスタムスタイルライブラリ</h2>
              <div className="mt-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex gap-6">
                  {[
                    ['personal', 'パーソナルスペース'],
                    ['team', 'チームスペース'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCustomStyleTab(id as 'personal' | 'team')}
                      className={`border-b-2 pb-2 text-sm font-semibold transition ${customStyleTab === id ? 'border-[#65d3cf] text-[#65d3cf]' : 'border-transparent text-neutral-400 hover:text-white'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <label className="flex h-10 min-w-[260px] items-center gap-2 rounded-lg bg-[#252b2e] px-3 text-sm text-neutral-300">
                    <input
                      value={customStyleSearch}
                      onChange={(event) => setCustomStyleSearch(event.target.value)}
                      className="w-full border-0 bg-transparent outline-none placeholder:text-neutral-500"
                      placeholder="名前を入力してください"
                    />
                    <Search className="h-4 w-4 text-neutral-500" />
                  </label>
                  <button
                    type="button"
                    onClick={handleCustomStyleSave}
                    disabled={specialProviderGenerationLocked}
                    className="rounded-lg bg-[#7b5c34] px-4 py-2.5 text-sm font-bold text-[#f7e7c8] transition hover:bg-[#8b6a40]"
                  >
                    カスタマイズについて連絡する
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
                {customStyleCards.map((card) => (
                  <article key={card.title} className="overflow-hidden rounded-lg bg-[#111719]">
                    <div className={`relative h-48 ${card.tone}`}>
                      {card.done && (
                        <span className="absolute left-3 top-3 rounded bg-[#65d3cf] px-4 py-1 text-xs font-bold text-neutral-950">✓ 完了</span>
                      )}
                      <div className="absolute inset-x-0 bottom-5 mx-auto h-24 w-20 rounded-full bg-neutral-900/80" />
                      <div className="absolute bottom-4 left-1/2 h-20 w-28 -translate-x-1/2 rounded-t-full bg-[linear-gradient(135deg,#1f2937,#65d3cf)]" />
                    </div>
                    <p className="px-1 py-3 text-sm font-semibold text-neutral-300">{card.title}</p>
                  </article>
                ))}
              </div>
            </section>

            {lightchainResult && (
              <section className="mt-6 rounded-xl border border-white/10 bg-[#111719] p-4" data-testid="lightchain-custom-style-readback">
                <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">生成履歴</h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveToCanvas}
                      disabled={isSaving}
                      className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadLightchainResult()}
                      disabled={!lightchainResult}
                      data-testid="lightchain-custom-style-result-download"
                      className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                    >
                      ダウンロード
                    </button>
                  </div>
              </div>
              <div className="mt-3 grid gap-4 md:grid-cols-[260px_1fr]">
                  {renderLightchainResultPreviewImage('h-36 w-full rounded-lg object-cover', 'カスタムスタイル保存プレビュー')}
                  <div>
                    <p className="text-sm font-semibold text-white">{lightchainResult.title}</p>
                    <p className="mt-2 text-xs leading-6 text-neutral-400">{lightchainResult.summary}</p>
                  </div>
                </div>
              </section>
            )}
          </section>
        </div>
        {materialModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end bg-neutral-950/55 p-3 backdrop-blur-sm sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="素材選択">
            <div className="max-h-[88vh] w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900 sm:max-w-4xl">
              <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <div>
                  <h2 className="text-base font-semibold text-neutral-900 dark:text-white">素材選択</h2>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">素材から選びます。</p>
                </div>
                <button type="button" onClick={() => setMaterialModalOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800">閉じる</button>
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-2">
                  {materialTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveMaterialTab(tab.id)}
                      className={`w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${activeMaterialTab === tab.id ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div>
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">{materialTabs.find((tab) => tab.id === activeMaterialTab)?.label}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {materialTabItems[activeMaterialTab].length > 0 ? materialTabItems[activeMaterialTab].map((item) => (
                      <article key={item.title} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
                        <div className="flex items-center gap-3">
                          <img src={item.imageUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{item.title}</p>
                            <p className="mt-1 text-xs text-neutral-500">{item.note}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => handleUseMaterialAsset(item)} className="mt-3 w-full rounded-lg bg-neutral-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-950">使用</button>
                      </article>
                    )) : (
                      <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                        このタブに使える保存済み素材はありません。アップロードまたは生成結果を保存してください。
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {lightchainResultModal}
      </main>
    );
  }

  return (
    <main
      className={`dark min-h-screen ${isFeatureDetail ? 'bg-[#0b0f10] px-4 py-4 text-white sm:px-6' : 'bg-surface-50 px-4 py-5 dark:bg-surface-950 sm:px-6 lg:px-8'}`}
      data-flow-state={unifiedFlowState}
      data-flow-state-label={unifiedWorkspaceFlowLabels[unifiedFlowState]}
    >
      <div className={isFeatureDetail ? 'space-y-4' : 'mx-auto max-w-7xl space-y-5'}>
        <section className={`rounded-2xl border border-neutral-200 bg-white shadow-soft dark:border-neutral-800 dark:bg-neutral-900 ${isFeatureDetail ? 'hidden' : 'p-5 sm:p-6'}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-100 dark:bg-primary-400/10 dark:text-primary-300 dark:ring-primary-400/20">
                <Sparkles className="h-3.5 w-3.5" />
                {isFeatureDetail ? selectedTool.lightchainRoute : `制作 / ${totalToolCount}機能`}
              </p>
              <h1 className={`${isFeatureDetail ? 'mt-2 text-xl sm:text-2xl' : 'mt-4 text-2xl sm:text-3xl'} font-semibold tracking-tight text-neutral-950 dark:text-white`}>
                {isFeatureDetail ? selectedTool.title : '用途を選んで、そのまま制作へ進む'}
              </h1>
              <p className={`${isFeatureDetail ? 'mt-1 max-w-4xl text-xs leading-6' : 'mt-2 max-w-3xl text-sm leading-7'} text-neutral-600 dark:text-neutral-300`}>
                {isFeatureDetail ? selectedTool.description : '既存の生成、フィッティング、柄、モデル、動画、Canvasへつながる入口です。'}
              </p>
            </div>
            <label className={`${isFeatureDetail ? 'hidden xl:flex' : 'flex'} min-w-0 items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-700 dark:bg-neutral-950 lg:w-[420px]`}>
              <Bot className="h-5 w-5 shrink-0 text-primary-500" />
              <input
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-white"
                placeholder="制作したい内容"
              />
            </label>
          </div>
        </section>

        <section className="space-y-5">
          {!isFeatureDetail && (
            <section
              className="overflow-hidden rounded-[28px] border border-neutral-200 bg-[radial-gradient(circle_at_top_right,rgba(101,211,207,0.18),transparent_38%),linear-gradient(135deg,#111719,#20282b)] p-5 text-white shadow-soft sm:p-6"
              data-testid="lightchain-quick-start"
            >
              <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                <div className="max-w-2xl">
                  <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-cyan-200">
                    <Sparkles className="h-4 w-4" />
                    素材作業台
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">まず作りたいものを選んでください</h2>
                  <p className="mt-2 text-sm leading-6 text-neutral-300">
                    入口で目的を決め、必要な素材だけを追加して、生成結果をCanvas・履歴へつなげます。高度な設定は次の画面で開きます。
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]" data-testid="lightchain-readiness-summary">
                  {[
                    { label: 'すぐ開始', value: lightchainReadiness.ready, icon: CheckCircle2, tone: 'text-emerald-300' },
                    { label: 'ワークスペース', value: lightchainReadiness.workspace, icon: LayoutGrid, tone: 'text-cyan-200' },
                    { label: '素材が必要', value: lightchainReadiness.needsImage, icon: ImagePlus, tone: 'text-amber-200' },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                        <Icon className={`h-4 w-4 ${item.tone}`} />
                        <p className="mt-3 text-xl font-semibold">{item.value}</p>
                        <p className="mt-1 text-[11px] text-neutral-400">{item.label}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="lightchain-quick-start-list">
                {quickStartTools.map((tool) => (
                  <Link
                    key={tool.id}
                    to={`/lightchain/${tool.id}`}
                    className="group rounded-2xl border border-white/10 bg-black/20 p-4 transition hover:-translate-y-0.5 hover:border-cyan-300/50 hover:bg-cyan-300/[0.08]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-300/15 text-cyan-200">
                        {tool.category === 'fitting' ? <Shirt className="h-5 w-5" /> : tool.category === 'marketing' ? <MessageSquareText className="h-5 w-5" /> : tool.category === 'model' ? <UserRound className="h-5 w-5" /> : <WandSparkles className="h-5 w-5" />}
                      </span>
                      <ArrowRight className="h-4 w-4 text-neutral-500 transition group-hover:translate-x-0.5 group-hover:text-cyan-200" />
                    </div>
                    <p className="mt-4 text-sm font-semibold">{tool.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-400">{tool.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {tool.inputs.slice(0, 2).map((input) => <span key={input} className="rounded-full bg-white/[0.08] px-2 py-1 text-[10px] text-neutral-300">{input}</span>)}
                    </div>
                  </Link>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-neutral-400">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-cyan-200" />権利確認は生成前に固定</span>
                <span className="inline-flex items-center gap-1.5"><Layers3 className="h-3.5 w-3.5 text-cyan-200" />結果はCanvasへ再利用</span>
                <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-cyan-200" />状態は入力→生成→保存で表示</span>
              </div>
            </section>
          )}

          {isFeatureDetail && (
            <section
              className="rounded-2xl border border-white/10 bg-[#111719] p-3 text-white shadow-soft sm:p-4"
              data-testid="lightchain-workflow-rail"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-300/15 text-cyan-200"><Sparkles className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{currentDisplayTitle}</p>
                    <p className="mt-0.5 truncate text-xs text-neutral-400">{workflowPhase.detail}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${workflowPhase.tone === 'success' ? 'bg-emerald-400/15 text-emerald-200' : workflowPhase.tone === 'ready' ? 'bg-cyan-400/15 text-cyan-200' : 'bg-amber-400/15 text-amber-200'}`}>
                    {workflowPhase.label}
                  </span>
                </div>
                <nav className="flex flex-wrap items-center gap-2 text-xs font-semibold" aria-label="制作の次の操作">
                  <Link to="/history" className="rounded-lg border border-white/10 px-3 py-2 text-neutral-300 transition hover:border-cyan-300/40 hover:text-white">生成履歴</Link>
                  <Link to="/gallery" className="rounded-lg border border-white/10 px-3 py-2 text-neutral-300 transition hover:border-cyan-300/40 hover:text-white">Gallery</Link>
                  <Link to="/jobs" className="rounded-lg border border-white/10 px-3 py-2 text-neutral-300 transition hover:border-cyan-300/40 hover:text-white">Jobs</Link>
                  <Link to="/canvas/new" className="rounded-lg bg-cyan-300 px-3 py-2 text-neutral-950 transition hover:bg-cyan-200">Canvasへ</Link>
                </nav>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] font-semibold text-neutral-400 sm:max-w-xl">
                {[
                  ['1', '素材・依頼', hasCurrentInput],
                  ['2', 'AI生成', Boolean(lightchainResult)],
                  ['3', '保存・再利用', Boolean(lightchainResult)],
                ].map(([step, label, done]) => (
                  <div key={step as string} className={`rounded-lg px-3 py-2 ${done ? 'bg-emerald-400/10 text-emerald-200' : 'bg-white/[0.05]'}`}>
                    <span className="mr-1.5">{done ? '✓' : step}</span>{label}
                  </div>
                ))}
              </div>
            </section>
          )}

          {!isFeatureDetail && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-2 shadow-soft dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex gap-1.5 overflow-x-auto">
              {visibleCategories.map((category) => {
                const Icon = category.icon;
                const active = category.id === activeCategory;
                const count = visibleTools.filter((tool) => tool.category === category.id).length;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => handleCategoryChange(category.id)}
                    className={`flex min-w-fit items-center gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                      active
                        ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                        : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-white/15 text-white dark:bg-neutral-900 dark:text-white' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300'}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="whitespace-nowrap">
                      <span className="text-sm font-semibold">{category.label}</span>
                      <span className={active ? 'ml-2 text-xs text-white/60 dark:text-neutral-500' : 'ml-2 text-xs text-neutral-400'}>{count}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {isFeatureDetail && !isModelToolDetail && (
            <div className={`rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,13,15,0.98),rgba(13,17,20,0.94))] p-3 shadow-soft lg:ml-[92px] lg:max-w-[636px] ${lightchainToolPanelConfig || selectedTool.id === 'printing-image' ? 'pb-3' : ''}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                  <Link
                    to="/lightchain"
                    className="shrink-0 rounded-lg border border-white/10 bg-[#111517] px-3 py-2 text-sm font-semibold text-neutral-300 transition hover:border-neutral-400"
                  >
                    すべての機能
                  </Link>
                  {!lightchainToolPanelConfig && selectedTool.id !== 'printing-image' && flowTabs.map((step, index) => (
                    <span
                      key={step}
                      className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${
                        beginnerStep >= index || index === 0
                          ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                          : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                      }`}
                    >
                      {step}
                    </span>
                  ))}
                </div>
                {!lightchainToolPanelConfig && selectedTool.id !== 'printing-image' && (
                <p className="hidden text-sm font-medium text-neutral-400 lg:block">
                  素材を入れて、調整して、保存します。
                </p>
                )}
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto" data-testid="lightchain-detail-tabs">
                {selectedCategoryTools.map((tool) => (
                  <Link
                    key={tool.id}
                    to={`/lightchain/${tool.id}`}
                    className={`shrink-0 rounded-full border px-3 py-2 text-sm font-semibold transition ${
                      selectedTool.id === tool.id
                        ? 'border-cyan-300/40 bg-cyan-300/10 text-white'
                        : 'border-white/5 bg-white/[0.03] text-neutral-300 hover:border-cyan-300/20 hover:bg-white/[0.06]'
                    }`}
                  >
                    {tool.id === 'pattern-vector'
                      ? 'パターンをベクター画像に変換（通常版）'
                      : tool.id === 'pattern-vector-pro'
                        ? 'パターンをベクター画像に変換（プロフェッショナル版）'
                        : tool.title}
                  </Link>
                ))}
              </div>
              {lightchainProviderSupported ? (
                <div className="mt-3 space-y-2 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-3" data-testid="lightchain-provider-gate">
                  <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-cyan-50">
                    <input
                      type="checkbox"
                      checked={providerRightsConfirmed}
                      onChange={(event) => {
                        setProviderRightsConfirmed(event.target.checked);
                        setLightchainGenerationError(null);
                      }}
                      className="mt-1 h-4 w-4 accent-[#65d3cf]"
                      data-testid="lightchain-rights-confirmation"
                    />
                    <span>
                      アップロードした画像・人物・柄・生地について、AI生成に利用する権利または許諾を確認済みです。
                      <span className="mt-1 block text-[11px] text-cyan-100/60">確認後のみ実プロバイダを実行します。未確認時は結果を作成しません。</span>
                    </span>
                  </label>
                  {lightchainGenerationRunning && (
                    <p className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-2 text-xs font-semibold text-cyan-50" data-testid="lightchain-generation-running">
                      AI生成を実行中です。
                    </p>
                  )}
                  {lightchainGenerationError && (
                    <p className="rounded-xl border border-rose-300/20 bg-rose-300/[0.08] px-3 py-2 text-xs font-semibold text-rose-100" data-testid="lightchain-generation-error">
                      {lightchainGenerationError}
                    </p>
                  )}
                </div>
              ) : selectedTool.id === 'video-workstation' || selectedTool.id === 'video-detail' ? (
                <p className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] px-3 py-3 text-xs font-semibold leading-5 text-amber-100" data-testid="lightchain-video-provider-blocker">
                  動画プロバイダの同一run tools/readback が未確認のため、AI生成は開始できません。
                </p>
              ) : null}
            </div>
          )}

          {isFeatureDetail && isModelToolDetail && lightchainProviderSupported && (
            <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-3 lg:ml-[92px] lg:max-w-[636px]" data-testid="lightchain-provider-gate">
              <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-cyan-50">
                <input
                  type="checkbox"
                  checked={providerRightsConfirmed}
                  onChange={(event) => {
                    setProviderRightsConfirmed(event.target.checked);
                    setLightchainGenerationError(null);
                  }}
                  className="mt-1 h-4 w-4 accent-[#65d3cf]"
                  data-testid="lightchain-rights-confirmation"
                />
                <span>アップロードした画像・人物について、AI生成に利用する権利または許諾を確認済みです。<span className="mt-1 block text-[11px] text-cyan-100/60">確認後のみ実プロバイダを実行します。</span></span>
              </label>
              {lightchainGenerationRunning && (
                <p className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-2 text-xs font-semibold text-cyan-50" data-testid="lightchain-generation-running">
                  AI生成を実行中です。
                </p>
              )}
              {lightchainGenerationError && (
                <p className="mt-2 rounded-xl border border-rose-300/20 bg-rose-300/[0.08] px-3 py-2 text-xs font-semibold text-rose-100" data-testid="lightchain-generation-error">
                  {lightchainGenerationError}
                </p>
              )}
            </div>
          )}

          {resumeInputReadback === 'restored' && (
            <p className="mt-3 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.08] px-3 py-3 text-xs font-semibold leading-5 text-emerald-100" data-testid="lightchain-resume-input-restored">
              保存済みの同一ジョブ入力を復元しました。remote URLは再利用せず、現在のローカル素材だけを再開に使います。
            </p>
          )}
          {resumeInputReadback === 'unavailable' && (
            <p className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] px-3 py-3 text-xs font-semibold leading-5 text-amber-100" data-testid="lightchain-resume-input-unavailable">
              再開元の画像は現在のローカル保存から復元できません。providerを実行する前に、入力素材を選び直してください。
            </p>
          )}

          <div className={isFeatureDetail ? isModelToolDetail ? 'grid gap-4 lg:grid-cols-[80px_432px_minmax(0,1fr)]' : 'grid gap-4 lg:grid-cols-[84px_596px_minmax(0,1fr)]' : 'grid gap-5 xl:grid-cols-[1fr_420px]'}>
            {isFeatureDetail && (
              <aside className="hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,16,18,0.98),rgba(10,13,15,0.96))] p-3 lg:block">
                <div className="flex flex-col items-center gap-5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200">
                    <Bot className="h-6 w-6" />
                  </div>
                  {(isModelToolDetail
                    ? selectedCategoryTools.map((tool) => [tool.title, UserRound, tool.id] as const)
                    : [
                      ['デザインツール', Palette, 'planning'],
                      ['フィッティングツール', Shirt, 'fitting'],
                      ['グラフィックツール', ImagePlus, 'graphics'],
                    ] as const
                  ).map(([label, Icon, id]) => (
                    <Link
                      key={label as string}
                      to={isModelToolDetail ? `/lightchain/${id}` : `/lightchain?category=${id}`}
                      className={`flex w-full flex-col items-center gap-2 rounded-2xl px-2 py-3 text-[11px] font-semibold leading-4 transition ${
                        isModelToolDetail && selectedTool.id === id
                          ? 'bg-cyan-400/15 text-cyan-200'
                          : selectedTool.category === 'graphics' && label === 'グラフィックツール'
                          ? 'bg-cyan-400/15 text-cyan-200'
                          : selectedTool.category === 'fitting' && label === 'フィッティングツール'
                            ? 'bg-cyan-400/15 text-cyan-200'
                            : 'text-neutral-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span>{label as string}</span>
                    </Link>
                  ))}
                </div>
              </aside>
            )}
            {!isFeatureDetail && (
            <section className="space-y-4">
              <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-soft dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">{selectedCategory.label}</h2>
                    <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">{filteredTools.length}件の導線</p>
                  </div>
                  <label className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 xl:w-56">
                    <Search className="h-4 w-4 text-neutral-400" />
                    <input
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setMobileToolsExpanded(false);
                      }}
                      className="w-full min-w-0 border-0 bg-transparent outline-none placeholder:text-neutral-400"
                      placeholder="機能を検索"
                    />
                  </label>
                </div>
              </div>

              <div className="grid gap-3 2xl:grid-cols-2" data-testid="lightchain-tool-list">
                {filteredTools.map((tool, index) => {
                  const hiddenOnMobile = !mobileToolsExpanded && index >= 6;
                  return (
                  <Link
                    key={tool.id}
                    to={`/lightchain/${tool.id}`}
                    onClick={() => {
                      setSelectedToolId(tool.id);
                      resetWorkbenchMaskState();
                    }}
                      data-testid="lightchain-tool-card"
                      className={`rounded-xl border bg-white p-4 text-left transition dark:bg-neutral-900 ${
                      hiddenOnMobile ? 'hidden md:block' : ''
                    } ${
                      selectedTool.id === tool.id
                        ? 'border-neutral-950 shadow-soft dark:border-white'
                        : 'border-neutral-200 hover:border-neutral-400 hover:shadow-soft dark:border-neutral-800 dark:hover:border-neutral-500'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200">
                        {tool.category === 'graphics' ? <Palette className="h-5 w-5" /> : tool.category === 'model' || tool.category === 'fitting' ? <UserRound className="h-5 w-5" /> : tool.category === 'video' ? <Film className="h-5 w-5" /> : <WandSparkles className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-neutral-900 dark:text-white">{tool.title}</span>
                        </span>
                        <span className="mt-2 line-clamp-2 block text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                          {tool.description}
                        </span>
                        <span className="mt-3 flex flex-wrap gap-1.5">
                          {tool.inputs.slice(0, 2).map((input) => (
                            <span key={input} className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
                              入力: {input}
                            </span>
                          ))}
                          {tool.outputs.slice(0, 1).map((output) => (
                            <span key={output} className="rounded-full bg-cyan-50 px-2 py-1 text-[10px] font-medium text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-200">
                              出力: {output}
                            </span>
                          ))}
                        </span>
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-end text-xs font-semibold text-primary-600 dark:text-primary-300">
                      機能画面へ
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </div>
                  </Link>
                  );
                })}
              </div>

              {filteredTools.length > 6 && (
                <button
                  type="button"
                  onClick={() => setMobileToolsExpanded((expanded) => !expanded)}
                  className="flex w-full items-center justify-center rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 shadow-soft transition active:scale-[0.99] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 md:hidden"
                  data-testid="mobile-lightchain-show-all-tools"
                >
                  {mobileToolsExpanded ? '少なく表示' : `さらに${filteredTools.length - 6}件を表示`}
                </button>
              )}
            </section>
            )}

            <aside>
              <div className={`shadow-soft ${isFeatureDetail ? 'w-full' : 'rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900 xl:sticky xl:top-24'}`}>
                {isFeatureDetail && currentModelPanel ? (
	                  <section className="flex h-[calc(100vh-104px)] min-h-[520px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,17,19,0.98),rgba(9,13,15,0.96))]" data-testid="lightchain-model-panel">
	                    <div className="px-4 pb-3 pt-5">
	                      <h1 className="text-base font-semibold text-white">{currentModelPanel.title}</h1>
                        {currentModelPanel.subtitle && (
                          <p className="mt-2 text-xs font-semibold text-neutral-400">{currentModelPanel.subtitle}</p>
                        )}
	                    </div>
	                    <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-3">
                      {currentModelPanel.variant !== 'custom' && (
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold text-neutral-400">既存素材またはアップロード</p>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openMaterialModalForSlot('primary');
                              }}
                              className="rounded-lg bg-[#31383c] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-[#3b4549]"
                            >
                              Galleryから選ぶ
                            </button>
                          </div>
                          <label
                            className="grid min-h-[160px] cursor-pointer grid-cols-[1fr_118px] overflow-hidden rounded-2xl border border-white/5 bg-[#22282a] p-2 transition hover:border-cyan-300/40"
                            onClick={() => setActiveMaterialSlot('primary')}
                          >
                            <input type="file" accept="image/*" className="hidden" onChange={(event) => handleMaterialSlotUpload('primary', event)} />
                            <div className="flex flex-col items-center justify-center px-4 text-center">
                              <ImagePlus className="h-5 w-5 text-neutral-300" />
                              <p className="mt-4 text-base font-semibold text-neutral-100">{currentModelPanel.primaryLabel}</p>
                              <p className="mt-2 text-xs leading-5 text-neutral-400">クリック/ドラッグ＆ドロップで追加します。</p>
                              <span className="mt-3 rounded-full bg-[#65d3cf] px-3 py-1 text-xs font-bold text-neutral-950">必須項目</span>
                            </div>
                            <div className="flex items-center justify-center rounded-xl bg-white p-2">
                              {materialSlotFiles.primary ? (
                                <img src={materialSlotFiles.primary.imageUrl} alt={currentModelPanel.primaryLabel} className="max-h-32 rounded-lg object-contain" />
                              ) : (
                                <div className="flex h-full w-full items-end justify-center rounded-lg bg-[linear-gradient(180deg,#f4eee6,#ffffff)] p-3 text-xs font-semibold text-neutral-500">
                                  例
                                </div>
                              )}
                            </div>
                          </label>
                        </div>
                      )}

                      {currentModelPanel.variant === 'uploadPair' && currentModelPanel.modeOptions && (
                        <div>
                          <p className="mb-2 text-sm font-semibold text-neutral-200">{currentModelPanel.modeLabel}</p>
                          <div className="grid grid-cols-2 overflow-hidden rounded-xl bg-[#252b2e] p-1">
                            {currentModelPanel.modeOptions.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => updateModelFormState(selectedTool.id === 'background-change' ? 'backgroundMode' : 'poseMode', option)}
                                className={`rounded-lg px-4 py-2 text-sm font-semibold ${(selectedTool.id === 'background-change' ? modelFormState.backgroundMode : modelFormState.poseMode) === option ? 'bg-[#747e85] text-white' : 'text-neutral-400'}`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

	                      {currentModelPanel.variant === 'uploadPair' && currentModelPanel.secondaryLabel && (
	                        <div>
                          <p className="mb-2 text-sm font-semibold text-neutral-200">画像をアップロード</p>
	                        <div className="rounded-2xl border border-white/5 bg-[#1d2224] p-4">
	                          <div className="flex items-center justify-between gap-3">
	                            <p className="text-sm font-semibold text-white">{currentModelPanel.secondaryLabel}</p>
	                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openMaterialModalForSlot('secondary')}
                                className="rounded-lg bg-[#31383c] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-[#3b4549]"
                              >
                                参考画像ライブラリ
	                              </button>
	                              <label className="cursor-pointer rounded-lg bg-[#65d3cf] px-3 py-2 text-xs font-bold text-neutral-950 transition hover:bg-[#78e0dc]">
	                                画像をアップロード
	                                <input type="file" accept="image/*" className="hidden" onChange={(event) => handleMaterialSlotUpload('secondary', event)} />
	                              </label>
	                            </div>
                          </div>
                          <div className="mt-3 flex min-h-[88px] items-center justify-center rounded-xl bg-[#121719] p-3 text-center">
                            {materialSlotFiles.secondary ? (
                              <div className="flex items-center gap-3">
                                <img src={materialSlotFiles.secondary.imageUrl} alt={currentModelPanel.secondaryLabel} className="h-14 w-14 rounded-lg object-contain" />
                                <span className="text-sm font-semibold text-white">{materialSlotFiles.secondary.name}</span>
                              </div>
                            ) : (
	                              <span className="text-sm text-neutral-400">{currentModelPanel.note}</span>
	                            )}
	                          </div>
                            {['model-face', 'model-change'].includes(selectedTool.id) && (
                              <p className="mt-3 text-[11px] leading-5 text-neutral-400">
                                参考画像をアップロードしなければ、ランダムな候補を直接生成できます。
                              </p>
                            )}
	                        </div>
                          {selectedTool.id === 'model-change' && (
                            <div className="mt-3 flex items-center justify-between rounded-xl bg-[#1d2224] px-4 py-3 text-sm font-semibold text-neutral-200">
                              <span>サイズを維持する</span>
                              <button
                                type="button"
                                onClick={() => updateModelFormState('keepSize', modelFormState.keepSize === 'on' ? 'off' : 'on')}
                                className={`h-5 w-10 rounded-full p-0.5 transition ${modelFormState.keepSize === 'on' ? 'bg-[#65d3cf]' : 'bg-[#3a4246]'}`}
                                aria-label="サイズを維持する"
                                aria-pressed={modelFormState.keepSize === 'on'}
                              >
                                <span className={`block h-4 w-4 rounded-full bg-white transition ${modelFormState.keepSize === 'on' ? 'translate-x-5' : ''}`} />
                              </button>
                            </div>
                          )}
	                        </div>
	                      )}

                      {currentModelPanel.variant === 'body' && (
                        <>
                          <div>
                            <p className="mb-2 text-sm font-semibold text-neutral-200">性別</p>
                            <div className="grid grid-cols-4 overflow-hidden rounded-xl bg-[#252b2e] p-1">
                              {['男性', '男の子', '女性', '女の子'].map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => updateModelFormState('bodyGender', option)}
                                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${modelFormState.bodyGender === option ? 'bg-[#747e85] text-white' : 'text-neutral-400'}`}
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          </div>
	                          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                              <button type="button" onClick={() => updateModelFormState('bodyType', modelFormState.bodyType === '標準体型' ? 'スマート' : '標準体型')} className="rounded-xl bg-[#252b2e] px-4 py-3 text-left text-sm font-semibold text-neutral-200">体型 <span className="float-right text-white">{modelFormState.bodyType}</span></button>
                              <button
                                type="button"
                                onClick={() => updateModelFormState('customBody', modelFormState.customBody === 'on' ? 'off' : 'on')}
                                className="flex items-center justify-between gap-3 rounded-xl bg-[#252b2e] px-4 py-3 text-sm font-semibold text-neutral-200"
                                aria-pressed={modelFormState.customBody === 'on'}
                              >
                                <span>カスタムボディ</span>
                                <span className={`h-3 w-3 rounded-full ${modelFormState.customBody === 'on' ? 'bg-[#65d3cf]' : 'bg-neutral-500'}`} />
                              </button>
	                          </div>
                        </>
                      )}

                      {currentModelPanel.variant === 'size' && (
                        <>
                          <div>
                            <p className="mb-2 text-sm font-semibold text-neutral-200">服装タイプ</p>
                            <div className="grid grid-cols-3 overflow-hidden rounded-xl bg-[#252b2e] p-1">
                            {['トップス', 'ボトムス', '全身'].map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => updateModelFormState('garmentType', option)}
                                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${modelFormState.garmentType === option ? 'bg-[#747e85] text-white' : 'text-neutral-400'}`}
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <button type="button" onClick={() => updateModelFormState('sourceSize', modelFormState.sourceSize === 'L' ? 'M' : 'L')} className="rounded-xl bg-[#252b2e] px-4 py-3 text-left text-sm font-semibold text-neutral-200">元のサイズ <span className="float-right text-white">{modelFormState.sourceSize}</span></button>
                            <button type="button" onClick={() => updateModelFormState('targetSize', modelFormState.targetSize === 'XXL' ? 'XL' : 'XXL')} className="rounded-xl bg-[#252b2e] px-4 py-3 text-left text-sm font-semibold text-neutral-200">変更サイズ <span className="float-right text-white">{modelFormState.targetSize}</span></button>
                          </div>
                          <p className="rounded-xl bg-[#22282a] px-4 py-3 text-sm leading-6 text-neutral-400">{currentModelPanel.note}</p>
                        </>
                      )}

	                      {currentModelPanel.variant === 'angle' && (
	                        <div className="space-y-5">
                          {[
                            ['左視⇔右視', 'angleHorizontal', ['左視点', '左45°', '変更なし', '右45°', '右視点']],
                            ['見上げる⇔見下ろす', 'angleVertical', ['見上げる', '変更なし', '見下ろす']],
                            ['ズームイン⇔ズームアウト', 'angleZoom', ['接写', '変更なし', '遠景']],
                          ].map(([label, stateKey, marks]) => (
                            <div key={label as string}>
                              <p className="text-sm font-semibold text-neutral-200">{label as string}</p>
                              <input
                                aria-label={label as string}
                                type="range"
                                min="0"
                                max="100"
                                value={modelFormState[stateKey as 'angleHorizontal' | 'angleVertical' | 'angleZoom']}
                                onChange={(event) => updateModelFormState(stateKey as 'angleHorizontal' | 'angleVertical' | 'angleZoom', Number(event.target.value))}
                                className="mt-3 w-full accent-[#65d3cf]"
                              />
                              <div className="mt-2 flex justify-between text-xs text-neutral-400">
                                {(marks as string[]).map((mark) => (
                                  <span key={mark} className={mark === '変更なし' ? 'text-[#65d3cf]' : ''}>{mark}</span>
                                ))}
                              </div>
                            </div>
	                          ))}
                            <div className="flex items-center justify-between rounded-xl bg-[#252b2e] px-4 py-3 text-sm font-semibold text-neutral-200">
                              <span>背面</span>
                              <button
                                type="button"
                                onClick={() => updateModelFormState('backView', modelFormState.backView === 'on' ? 'off' : 'on')}
                                className={`h-5 w-10 rounded-full p-0.5 transition ${modelFormState.backView === 'on' ? 'bg-[#65d3cf]' : 'bg-[#3a4246]'}`}
                                aria-label="背面"
                                aria-pressed={modelFormState.backView === 'on'}
                              >
                                <span className={`block h-4 w-4 rounded-full bg-white transition ${modelFormState.backView === 'on' ? 'translate-x-5' : ''}`} />
                              </button>
                            </div>
	                        </div>
	                      )}

                      {currentModelPanel.variant === 'custom' && (
                        <div className="space-y-4">
	                          <div className="grid grid-cols-2 overflow-hidden rounded-xl bg-[#252b2e] p-1">
	                            {['ラベル', 'カスタム'].map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => updateModelFormState('customMode', option)}
                                className={`rounded-lg px-4 py-2 text-sm font-semibold ${modelFormState.customMode === option ? 'bg-[#747e85] text-white' : 'text-neutral-400'}`}
                              >
                                {option}
	                              </button>
	                            ))}
	                          </div>
                          <p className="text-sm font-semibold text-neutral-200">性別</p>
	                          <div className="grid grid-cols-2 overflow-hidden rounded-xl bg-[#252b2e] p-1">
	                            {['男性', '女性'].map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => updateModelFormState('gender', option)}
                                className={`rounded-lg px-4 py-2 text-sm font-semibold ${modelFormState.gender === option ? 'bg-[#747e85] text-white' : 'text-neutral-400'}`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                          {[
                            ['年齢', 'age'],
                            ['国籍', 'nationality'],
                            ['肌の色', 'skinTone'],
                            ['体型', 'bodyType'],
                          ].map(([label, stateKey]) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() => updateModelFormState(stateKey as 'age' | 'nationality' | 'skinTone' | 'bodyType', modelFormState[stateKey as 'age' | 'nationality' | 'skinTone' | 'bodyType'] === 'スマート' ? '標準' : 'スマート')}
                              className="w-full rounded-xl bg-[#252b2e] px-4 py-3 text-left text-sm font-semibold text-neutral-200"
                            >
                              {label}<span className="float-right text-white">{modelFormState[stateKey as 'age' | 'nationality' | 'skinTone' | 'bodyType']}</span>
                            </button>
                          ))}
                          <button type="button" onClick={() => updateModelFormState('half', modelFormState.half === 'オフ' ? 'オン' : 'オフ')} className="w-full rounded-xl bg-[#252b2e] px-4 py-3 text-left text-sm font-semibold text-neutral-200">
                            ハーフ<span className="float-right text-neutral-400">{modelFormState.half}</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 grid gap-2 border-t border-white/10 bg-[#141717] p-2 sm:grid-cols-[1fr_1fr_2fr]">
                      {['スマート', '1K'].map((control) => (
                        <span key={control} className="rounded-lg bg-[#252b2e] px-3 py-3 text-sm font-semibold text-neutral-200">
                          {control}
                        </span>
                      ))}
                      <button
                        type="button"
                        disabled={aiGenerateDisabled || lightchainGenerationRunning}
                        onClick={() => void handleLightchainPreviewGenerate()}
                        className="inline-flex items-center justify-center rounded-lg bg-[#65d3cf] px-5 py-3 text-sm font-semibold text-neutral-950 hover:bg-[#78e0dc] disabled:bg-[#3a484b] disabled:text-neutral-500"
                      >
                        AI生成 <Sparkles className="ml-2 h-4 w-4" />
                      </button>
                    </div>
                  </section>
                ) : isFeatureDetail && selectedTool.id === 'printing-image' ? (
                  <section className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,#0b1012,#070b0d)] shadow-[0_22px_80px_rgba(0,0,0,0.3)]" data-testid="lightchain-input-material-panel">
                    <div className="border-b border-white/10 bg-[#0f171a] px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">printing-image</p>
                          <h3 className="mt-1 text-lg font-semibold text-white">プリントイメージ</h3>
                          <p className="mt-1 text-sm leading-6 text-neutral-400">Canva のように、キャンバス上で直接配置を触れます。右のプレビューが実際の作業面です。</p>
                        </div>
                        <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                          {printingMode}
                        </span>
                      </div>
                    </div>
                    <div className="grid gap-4 p-4 xl:grid-cols-[340px_minmax(0,1fr)]">
                      <div className="space-y-4">
                        <div className="rounded-[26px] border border-white/10 bg-white/[0.025] p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-sm font-semibold text-white">参考画像</p>
                            <button
                              type="button"
                              onClick={() => openMaterialModalForSlot('primary')}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/40 hover:text-white"
                            >
                              素材を選択
                            </button>
                          </div>
                          <label
                            className="flex min-h-[270px] cursor-pointer flex-col items-center justify-center rounded-[22px] border border-white/10 bg-[#101719] p-5 text-center transition hover:border-cyan-300/35 hover:bg-[#121b1e]"
                            onClick={() => setActiveMaterialSlot('primary')}
                          >
                            <input type="file" accept="image/*" className="hidden" onChange={(event) => handleMaterialSlotUpload('primary', event)} />
                            {materialSlotFiles.primary ? (
                              <>
                                <div className="relative">
                                  <img src={materialSlotFiles.primary.imageUrl} alt="参考画像" className="max-h-52 rounded-xl object-contain" />
                                  {printingCutoutStatus.primary === 'processing' && (
                                    <span className="absolute inset-x-2 bottom-2 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-cyan-100">背景を透明化中…</span>
                                  )}
                                </div>
                                <span className="mt-3 text-sm font-semibold text-white">{materialSlotFiles.primary.name}</span>
                                <span className={`mt-1 text-xs ${printingCutoutStatus.primary === 'error' ? 'text-rose-300' : printingCutoutStatus.primary === 'done' ? 'text-emerald-300' : 'text-cyan-200'}`}>
                                  {printingCutoutStatus.primary === 'done' ? '透明化済み' : printingCutoutStatus.primary === 'processing' ? '服の背景を分離しています' : printingCutoutStatus.primary === 'error' ? (printingCutoutErrors.primary || '透明化失敗') : '処理待ち'}
                                </span>
                              </>
                            ) : (
                              <>
                                <ImagePlus className="h-7 w-7 text-cyan-200/70" />
                                <span className="mt-5 text-sm font-semibold text-neutral-200">参考画像をアップロードしてください</span>
                                <span className="mt-2 text-xs text-neutral-500">20MB以下の画像アップロードしてください</span>
                              </>
                            )}
                          </label>
                          {printingCutoutStatus.primary === 'processing' && !materialSlotFiles.primary && (
                            <p className="mt-2 text-center text-xs text-cyan-200">参考画像の背景を透明化しています…</p>
                          )}
                          {printingCutoutStatus.primary === 'error' && printingCutoutErrors.primary && (
                            <p className="mt-2 text-center text-xs text-rose-300">{printingCutoutErrors.primary}</p>
                          )}
                        </div>

                        <div className="rounded-[26px] border border-white/10 bg-white/[0.025] p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-sm font-semibold text-white">プリント画像</p>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => openMaterialModalForSlot('secondary')}
                                className="text-xs font-semibold text-neutral-300 transition hover:text-white"
                              >
                                素材を選択
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  printingGenerationSequenceRef.current += 1;
                                  printingGenerationRequestRef.current = null;
                                  setPrintingGenerationStatus('idle');
                                  setPrintingGenerationError(null);
                                  printingCutoutRequestRef.current.secondary += 1;
                                  setMaterialSlotFiles((current) => ({ ...current, secondary: null }));
                                  setPrintingCutoutStatus((current) => ({ ...current, secondary: 'idle' }));
                                  setPrintingCutoutErrors((current) => ({ ...current, secondary: null }));
                                  setSecondaryUploadResetKey((key) => key + 1);
                                }}
                                className="text-xs font-semibold text-neutral-400 transition hover:text-white"
                              >
                                リセット
                              </button>
                            </div>
                          </div>
                          <label
                            className="flex min-h-[112px] cursor-pointer items-center justify-center rounded-[22px] border border-white/10 bg-[#101719] p-4 text-center transition hover:border-cyan-300/35 hover:bg-[#121b1e]"
                            onClick={() => setActiveMaterialSlot('secondary')}
                          >
                            <input key={secondaryUploadResetKey} type="file" accept="image/*" className="hidden" onChange={(event) => handleMaterialSlotUpload('secondary', event)} />
                            {materialSlotFiles.secondary ? (
                              <div className="flex items-center gap-3">
                                <div className="relative shrink-0">
                                  <img src={materialSlotFiles.secondary.imageUrl} alt="プリント" className="h-14 w-14 rounded-lg object-contain" />
                                  {printingCutoutStatus.secondary === 'processing' && (
                                    <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/65 text-[9px] font-semibold text-cyan-100">処理中</span>
                                  )}
                                </div>
                                <span className="min-w-0 text-left">
                                  <span className="block truncate text-sm font-semibold text-white">{materialSlotFiles.secondary.name}</span>
                                  <span className={`mt-1 block text-xs ${printingCutoutStatus.secondary === 'error' ? 'text-rose-300' : printingCutoutStatus.secondary === 'done' ? 'text-emerald-300' : 'text-cyan-200'}`}>
                                    {printingCutoutStatus.secondary === 'done' ? '透明化済み' : printingCutoutStatus.secondary === 'processing' ? '背景を分離しています' : printingCutoutStatus.secondary === 'error' ? (printingCutoutErrors.secondary || '透明化失敗') : '処理待ち'}
                                  </span>
                                </span>
                              </div>
                            ) : (
                              <span className="text-sm font-semibold text-neutral-300">プリント画像を追加</span>
                            )}
                          </label>
                          {printingCutoutStatus.secondary === 'processing' && !materialSlotFiles.secondary && (
                            <p className="mt-2 text-center text-xs text-cyan-200">プリント画像の背景を透明化しています…</p>
                          )}
                          {printingCutoutStatus.secondary === 'error' && printingCutoutErrors.secondary && (
                            <p className="mt-2 text-center text-xs text-rose-300">{printingCutoutErrors.secondary}</p>
                          )}
                          <p className="mt-2 text-center text-xs text-neutral-500">画像をアップロード</p>
                          <p className="mt-1 text-center text-xs text-neutral-500">20MB以下の画像アップロードしてください</p>
                        </div>

                        <div className="rounded-[26px] border border-white/10 bg-white/[0.025] p-4">
                          <p className="text-sm font-semibold text-white">プリントモード</p>
                          <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-[#101719] p-1">
                            {(['スポット', '全体'] as const).map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => setPrintingMode(mode)}
                                className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${printingMode === mode ? 'bg-[#172326] text-cyan-100 ring-1 ring-cyan-300/25' : 'text-neutral-400 hover:text-white'}`}
                              >
                                {mode}
                              </button>
                            ))}
                          </div>
                          <p className="mt-3 text-xs leading-5 text-neutral-400">移動はドラッグ、拡大縮小は角、回転は上のハンドルで直接操作します。</p>
                        </div>

                        <button
                          type="button"
                          disabled={aiGenerateDisabled || isPrintingImageGenerationLocked}
                          onClick={handlePrintingImageGenerate}
                          className="inline-flex w-full items-center justify-center rounded-2xl bg-[#65d3cf] px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-[#78e0dc] disabled:bg-[#243236] disabled:text-neutral-500"
                        >
                          {printingGenerationStatus === 'error'
                            ? '再生成'
                            : isPrintingImageGenerationRunning
                              ? '生成中...'
                              : 'AI生成'}
                          <Sparkles className={`ml-2 h-4 w-4 ${isPrintingImageGenerationRunning ? 'animate-pulse' : ''}`} />
                        </button>
                        {printingGenerationStatus === 'error' && printingGenerationError && (
                          <p className="rounded-2xl border border-rose-300/20 bg-rose-300/[0.08] px-3 py-2 text-center text-sm font-semibold text-rose-100">
                            {printingGenerationError}
                          </p>
                        )}
                        {printingNotice && (
                          <p className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.08] px-3 py-2 text-center text-sm font-semibold text-cyan-100">
                            {printingNotice}
                          </p>
                        )}
                      </div>

                      <PrintingImageComposer
                        garmentImageUrl={selectedTool.id === 'printing-image'
                          ? printingCutoutStatus.primary === 'done' ? materialSlotFiles.primary?.imageUrl ?? null : null
                          : (extractedLayerReady ? extractedGarmentImageUrl || garmentImageUrl : garmentImageUrl)}
                        garmentMaskUrl={selectedTool.id === 'printing-image'
                          ? printingCutoutStatus.primary === 'done' ? materialSlotFiles.primary?.imageUrl ?? null : null
                          : (extractedLayerReady ? extractedGarmentImageUrl : null)}
                        printImageUrl={selectedTool.id === 'printing-image'
                          ? printingCutoutStatus.secondary === 'done' ? materialSlotFiles.secondary?.imageUrl ?? null : null
                          : materialSlotFiles.secondary?.imageUrl ?? null}
                        garmentCategory={garmentCategory}
                        printMode={printingMode}
                        printLabel={materialSlotFiles.secondary?.name ?? 'プリント画像'}
                        transform={printArtworkTransform}
                        isProcessing={isPrintingImageGenerationRunning || isPrintingCutoutProcessing}
                        processingLabel={isPrintingCutoutProcessing
                          ? printingCutoutStatus.primary === 'processing' ? '参考画像の背景を透明化中…' : 'プリント画像の背景を透明化中…'
                          : '生成中…'}
                        onTransformChange={setPrintArtworkTransform}
                        onResetTransform={() => setPrintArtworkTransform(defaultPrintArtworkTransform)}
                      />
                    </div>
                  </section>
                ) : isFeatureDetail && lightchainToolPanelConfig ? (
                  <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#171c1e]" data-testid="lightchain-input-material-panel">
                    {lightchainToolPanelConfig.notice && (
                      <div className="bg-[#1d4d49] px-4 py-3 text-sm leading-6 text-cyan-50">
                        <span>{lightchainToolPanelConfig.notice} </span>
                        <span className="underline">今すぐ体験</span>
                      </div>
	                    )}
	                    <div className="p-4">
                      {selectedTool.id === 'fabric-image' && (
                        <p className="mb-3 text-sm font-semibold text-neutral-200">モデル/デザイン画像*</p>
                      )}
	                      <div className="mb-3 flex justify-end">
	                        <button
	                          type="button"
	                          onClick={() => openMaterialModalForSlot('primary')}
	                          className="rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 hover:text-white"
	                        >
	                          素材を選択
	                        </button>
	                      </div>
		                      <label
		                        className="relative flex min-h-[244px] cursor-pointer flex-col items-center justify-center rounded-xl bg-[#121719] p-5 text-center transition hover:bg-[#151c1f]"
		                        onClick={() => setActiveMaterialSlot('primary')}
	                      >
	                        <input type="file" accept="image/*" className="hidden" onChange={(event) => handleMaterialSlotUpload('primary', event)} />
	                        {materialSlotFiles.primary ? (
	                          <>
	                            <img src={materialSlotFiles.primary.imageUrl} alt={lightchainToolPanelConfig.primaryLabel} className="max-h-44 rounded-lg object-contain" />
	                            <span className="mt-3 text-sm font-semibold text-white">{materialSlotFiles.primary.name}</span>
                              {selectedTool.id === 'image-repair' && (
                                <span className="pointer-events-none absolute right-4 top-4 flex flex-col gap-36">
                                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#2d3437] text-xs font-bold text-neutral-100 shadow-lg">
                                    <Maximize2 className="h-4 w-4" />
                                  </span>
                                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[#65d3cf] text-sm font-bold text-neutral-950 shadow-lg">
                                    <WandSparkles className="h-4 w-4" />
                                  </span>
                                </span>
                              )}
	                          </>
	                        ) : (
                          <>
                            <ImagePlus className="h-7 w-7 text-neutral-300" />
                            <span className="mt-5 text-sm font-semibold text-neutral-200">
                              {selectedTool.id === 'fabric-image' ? '参考画像をアップロードしてください' : lightchainToolPanelConfig.primaryLabel}
                            </span>
                            <span className="mt-2 text-xs text-neutral-500">{lightchainToolPanelConfig.primaryHelp}</span>
                          </>
                        )}
                      </label>

                      {lightchainToolPanelConfig.secondaryLabel && (
                        <>
	                          <div className="mt-5 flex items-center justify-between">
	                            <p className="text-sm font-semibold text-neutral-200">
                                {lightchainToolPanelConfig.secondaryLabel}{selectedTool.id === 'fabric-image' ? '*' : ''}
                              </p>
	                            <div className="flex items-center gap-3">
	                              <button
	                                type="button"
	                                onClick={() => openMaterialModalForSlot('secondary')}
	                                className="text-xs font-semibold text-neutral-300 transition hover:text-white"
	                              >
	                                素材を選択
	                              </button>
	                              <button
	                                type="button"
	                                onClick={() => {
	                                  setMaterialSlotFiles((current) => ({ ...current, secondary: null }));
	                                  setSecondaryUploadResetKey((key) => key + 1);
	                                }}
	                                className="text-xs font-semibold text-neutral-400 transition hover:text-white"
	                              >
	                                リセット
	                              </button>
	                            </div>
	                          </div>
                          <label
                            className="mt-3 flex min-h-[92px] cursor-pointer items-center justify-center rounded-xl border border-white/5 bg-[#111719] p-4 text-center transition hover:border-cyan-300/40"
                            onClick={() => setActiveMaterialSlot('secondary')}
                          >
                            <input key={`secondary-${secondaryUploadResetKey}`} type="file" accept="image/*" className="hidden" onChange={(event) => handleMaterialSlotUpload('secondary', event)} />
                            {materialSlotFiles.secondary ? (
                              <div className="flex items-center gap-3">
                                <img src={materialSlotFiles.secondary.imageUrl} alt={lightchainToolPanelConfig.secondaryLabel} className="h-14 w-14 rounded-lg object-contain" />
	                              <span className="text-sm font-semibold text-white">{materialSlotFiles.secondary.name}</span>
	                            </div>
	                          ) : (
                              <div className="flex flex-col items-center">
	                              <span className="text-sm font-semibold text-neutral-300">
                                  {selectedTool.id === 'fabric-image' ? '参考画像をアップロードしてください' : `${lightchainToolPanelConfig.secondaryLabel}を追加`}
                                </span>
                                {selectedTool.id === 'fabric-image' && (
                                  <span className="mt-2 text-xs text-neutral-500">20MB以下の画像アップロードしてください</span>
                                )}
                              </div>
	                          )}
                          </label>
                        </>
                      )}

                      {lightchainToolPanelConfig.optionLabel && (
                        <div className="mt-5">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-neutral-200">{lightchainToolPanelConfig.optionLabel}</p>
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedTool.id === 'line-to-real') setLineDraftType('カラー線画');
                                if (selectedTool.id === 'line-to-real') setLineToRealImageType('平置き画像');
                                if (selectedTool.id === 'line-generation') setLineGenerationImageType('平置き画像');
	                                if (isPatternVectorProFlow) setPatternVectorLayers(['積み重ね']);
                                  if (selectedTool.id === 'image-repair') setImageRepairMode('手足の変形を修正');
	                              }}
                              className="text-xs font-semibold text-neutral-400 transition hover:text-white"
                            >
                              リセット
                            </button>
                          </div>
	                          <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl bg-[#20272a] p-1">
		                            {lightchainToolPanelConfig.options.map((option, index) => (
	                              <button
	                                key={option}
	                                type="button"
	                                  onClick={() => {
	                                    if (selectedTool.id === 'line-to-real') setLineDraftType(option as 'カラー線画' | 'モノクロ線画');
	                                    if (selectedTool.id === 'line-generation') setLineGenerationImageType(option as '平置き画像' | 'モデル図');
                                      if (selectedTool.id === 'image-repair') setImageRepairMode(option as '手足の変形を修正' | 'マスクツール');
	                                    if (isPatternVectorProFlow) {
                                      const layer = option as '積み重ね' | '分割';
                                      setPatternVectorLayers((current) =>
                                        current.includes(layer)
                                          ? current.length > 1 ? current.filter((item) => item !== layer) : current
                                          : [...current, layer],
                                      );
                                    }
                                  }}
	                                className={`rounded-lg px-4 py-2 text-sm font-semibold ${
	                                    selectedTool.id === 'line-to-real'
	                                      ? lineDraftType === option ? 'bg-[#737d84] text-white' : 'text-neutral-400'
	                                      : selectedTool.id === 'line-generation'
	                                        ? lineGenerationImageType === option ? 'bg-[#737d84] text-white' : 'text-neutral-400'
                                      : selectedTool.id === 'image-repair'
                                        ? imageRepairMode === option ? 'bg-[#737d84] text-white' : 'text-neutral-400'
	                                      : isPatternVectorProFlow
                                        ? patternVectorLayers.includes(option as '積み重ね' | '分割') ? 'bg-[#737d84] text-white' : 'text-neutral-400'
                                      : index === 0 ? 'bg-[#737d84] text-white' : 'text-neutral-400'
                                  }`}
	                              >
	                                {option}
	                              </button>
		                            ))}
	                          </div>
                          {selectedTool.id === 'image-repair' && imageRepairMode === 'マスクツール' && (
                            <p className="mt-3 rounded-full bg-[#20272a] px-4 py-2 text-center text-xs font-semibold text-[#65d3cf]">
                              「マスクツール」を使用して手足の部分をマスクで選択してください
                            </p>
                          )}
	                        </div>
		                      )}

                      {selectedTool.id === 'line-to-real' && (
                        <div className="mt-5 space-y-4">
                          <div>
                            <p className="mb-2 text-sm font-semibold text-neutral-200">生成画像の種類</p>
                              <div className="grid grid-cols-2 overflow-hidden rounded-xl bg-[#20272a] p-1" role="group" aria-label="生成画像の種類">
                                {(['平置き画像', 'モデル図'] as const).map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => setLineToRealImageType(option)}
                                    aria-pressed={lineToRealImageType === option}
                                    data-testid={`lightchain-line-to-real-output-type-${option}`}
                                    className={`rounded-lg px-4 py-2 text-sm font-semibold ${lineToRealImageType === option ? 'bg-[#737d84] text-white' : 'text-neutral-400'}`}
                                  >
                                    {option}
                                  </button>
                                ))}
                              </div>
                          </div>
                          <div>
                            <label className="text-sm font-semibold text-neutral-200" htmlFor="line-to-real-description">
                              スタイルのカスタム説明
                            </label>
                            <p className="mt-1 text-xs font-semibold text-neutral-500">オプション</p>
                            <textarea
                              id="line-to-real-description"
                              value={lineToRealPrompt}
                              onChange={(event) => setLineToRealPrompt(event.target.value.slice(0, 200))}
                              placeholder="キーワードを入力してください 例：&#10;1.素材：デニム、ニット、シルク&#10;2.カラー：カーキ、ブルー×ホワイトストライプ&#10;3.スタイル：シングルボタン、小さめの襟、コントラストカラーの金属ジッパー"
                              className="mt-3 min-h-[92px] w-full resize-none rounded-xl border border-white/10 bg-[#111719] px-4 py-3 text-sm leading-6 text-neutral-100 outline-none transition placeholder:text-neutral-500 focus:border-cyan-300/60"
                            />
                            <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                              <span>文字数：{lineToRealPrompt.length}/200</span>
                              <button
                                type="button"
                                disabled={!lineToRealPrompt}
                                onClick={() => setLineToRealPrompt('')}
                                className="font-semibold text-neutral-400 transition hover:text-white disabled:cursor-not-allowed disabled:text-neutral-600"
                              >
                                全削除
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedTool.id === 'fabric-image' && (
                        <div className="mt-5">
                          <label className="text-sm font-semibold text-neutral-200" htmlFor="fabric-keywords">
                            キーワードを追加してください（任意）
                          </label>
                          <textarea
                            id="fabric-keywords"
                            value={fabricPrompt}
                            onChange={(event) => setFabricPrompt(event.target.value.slice(0, 500))}
                            placeholder="素材はシルクサテンで、柔らかく光沢感があります。それを上衣またはパンツに置き換えてください。"
                            className="mt-3 min-h-[88px] w-full resize-none rounded-xl border border-white/10 bg-[#111719] px-4 py-3 text-sm leading-6 text-neutral-100 outline-none transition placeholder:text-neutral-500 focus:border-cyan-300/60"
                          />
                          <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                            <span>{fabricPrompt.length} / 500</span>
                            <button
                              type="button"
                              disabled={!fabricPrompt}
                              onClick={() => setFabricPrompt('')}
                              className="font-semibold text-neutral-400 transition hover:text-white disabled:cursor-not-allowed disabled:text-neutral-600"
                            >
                              全削除
                            </button>
                          </div>
                        </div>
                      )}

                      {fabricNotice && selectedTool.id === 'fabric-image' && (
                        <p className="mt-3 rounded-xl bg-[#101719] px-3 py-2 text-center text-sm font-semibold text-[#65d3cf]">
                          {fabricNotice}
                        </p>
                      )}

                      {isPatternVectorProFlow && (
                        <div className="mt-4 flex justify-end text-sm font-semibold text-neutral-300">
                          <span className="text-neutral-500">使用回数</span>
                          <span className="ml-2 text-white">6/30</span>
                        </div>
                      )}

                      <div className={lightchainToolPanelConfig.bottomControl || selectedTool.id === 'line-generation' ? 'mt-4 grid grid-cols-[1fr_1.45fr] items-end gap-3' : 'mt-4'}>
                        {selectedTool.id === 'line-generation' && (
                          <div>
                            <p className="mb-2 text-sm font-semibold text-neutral-200">生成画像の種類</p>
                            <div className="w-full rounded-xl border border-white/10 bg-[#20272a] px-4 py-3 text-left text-sm font-semibold text-neutral-300" aria-label="生成画像の種類">
                              線画
                            </div>
                          </div>
                        )}
                        {lightchainToolPanelConfig.bottomControl && (
                          <div
                            data-testid={selectedTool.id === 'fabric-image' ? 'lightchain-fabric-image-ratio-readout' : undefined}
                            className="rounded-xl border border-white/10 bg-[#20272a] px-4 py-3 text-left text-sm font-semibold text-neutral-300"
                            aria-label={selectedTool.id === 'fabric-image' ? '画像比率' : undefined}
                          >
                            {lightchainToolPanelConfig.bottomControl}
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={aiGenerateDisabled || lightchainGenerationRunning}
                          onClick={() => void handleLightchainPreviewGenerate()}
                          className={`flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition disabled:bg-[#3a484b] disabled:text-neutral-500 ${
                            selectedTool.id === 'image-repair' && imageRepairGenerating
                              ? 'bg-gradient-to-r from-[#65d3cf] via-[#9df3ef] to-[#65d3cf] text-neutral-950 shadow-[0_0_22px_rgba(101,211,207,0.22)]'
                              : 'bg-[#65d3cf] text-neutral-950 hover:bg-[#78e0dc]'
                          }`}
                        >
                          AI生成 {selectedTool.id === 'image-repair' && imageRepairGenerating ? <span className="ml-2 text-xs">生成中...</span> : isPatternVectorProFlow ? <span className="ml-1">1</span> : <Sparkles className="ml-2 h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </section>
                ) : (
                <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                      {selectedTool.lightchainRoute}
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-neutral-900 dark:text-white">{selectedTool.title}</h3>
                  </div>
                </div>

                <p className="mt-3 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                  {selectedTool.description}
                </p>

                {workbenchEnabled && (
                  <section className="mt-5 space-y-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950" data-testid="lightchain-input-material-panel">
                    <div className="grid gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-neutral-900 dark:text-white">入力素材</p>
                          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{secondaryUploadLabel}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMaterialSlot('primary');
                            setMaterialModalOpen(true);
                          }}
                          className="shrink-0 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:border-cyan-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                        >
                          素材を選択
                        </button>
                      </div>
                      <div className={materialSlots.length > 1 ? 'grid gap-3 md:grid-cols-2' : 'grid gap-3'}>
                        {materialSlots.map((slot) => {
                          const slotFile = materialSlotFiles[slot.key];
                          return (
                            <label
                              key={slot.key}
                              className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-center transition hover:border-primary-300 dark:border-neutral-700 dark:bg-neutral-900"
                              onClick={() => setActiveMaterialSlot(slot.key)}
                            >
                              <input type="file" accept="image/*" className="hidden" onChange={(event) => handleMaterialSlotUpload(slot.key, event)} />
                              {slotFile ? (
                                <>
                                  <img src={slotFile.imageUrl} alt={slot.label} className="max-h-24 rounded-lg object-contain" />
                                  <span className="mt-2 text-xs font-semibold text-neutral-900 dark:text-white">{slotFile.name}</span>
                                </>
                              ) : (
                                <>
                                  <Upload className="h-7 w-7 text-primary-500" />
                                  <span className="mt-2 text-sm font-semibold text-neutral-900 dark:text-white">{slot.label}</span>
                                  <span className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                                    {slot.helper}
                                  </span>
                                  {slot.required && (
                                    <span className="mt-2 rounded-full bg-cyan-400 px-2 py-0.5 text-[11px] font-semibold text-neutral-950">必須項目</span>
                                  )}
                                </>
                              )}
                            </label>
                          );
                        })}
                      </div>
                      {materialSlots.length > 1 && (
                        <div className="grid gap-2 md:grid-cols-2">
                          {materialSlots.map((slot) => (
                            <button
                              key={`picker-${slot.key}`}
                              type="button"
                              onClick={() => {
                                setActiveMaterialSlot(slot.key);
                                setMaterialModalOpen(true);
                              }}
                              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:border-cyan-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                            >
                              {slot.label}を選択
                            </button>
                          ))}
                        </div>
                      )}

                      {garmentImageUrl && (
                      <details className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                        <summary className="cursor-pointer rounded-lg text-sm font-semibold text-neutral-800 outline-none focus-visible:ring-2 focus-visible:ring-primary-300 dark:text-neutral-100">
                          詳細設定
                          <span className="ml-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                            素材種別・レイヤー・配置
                          </span>
                        </summary>
                        <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">素材読み込み</p>
                            <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-white">
	                              {analysisStatus === 'ready' ? `${garmentCategory} / ${activeLayer} / ${printPlacement}` : '画像待ち'}
                            </p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${analysisStatus === 'ready' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300'}`}>
                            {analysisStatus === 'ready' ? '素材あり' : '素材を追加'}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2">
	                          {workbenchLabels.materialKinds.map((category) => (
                            <button
                              key={category}
                              type="button"
                              onClick={() => setGarmentCategory(category)}
                              className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                                garmentCategory === category
                                  ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
                              }`}
                            >
                              {category}
                            </button>
                          ))}
                        </div>
                        </div>
                      </details>
                      )}

                      {garmentImageUrl && (
                      <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">切り抜き / マスク</p>
                          <span className="rounded-full bg-cyan-50 px-2 py-1 text-[11px] font-semibold text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-200">
                            {workbenchStep === 'next' ? '次ステップ可' : workbenchStep === 'extracted' ? '抽出済み' : workbenchStep === 'mask' ? 'マスク調整' : garmentImageUrl ? '素材選択' : 'アップロード後'}
                          </span>
                        </div>
                        <>
                            <div className="mt-2 grid grid-cols-3 gap-2">
                              {[
                                ['auto', '自動カット'],
                                ['manual', '手動マスク'],
                                ['keep', '背景維持'],
                              ].map(([mode, label]) => (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => handleSetCutMode(mode as typeof cutMode)}
                                  className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
                                    cutMode === mode
                                      ? 'bg-primary-600 text-white'
                                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <div className="mt-3 grid gap-2">
                              <button
                                type="button"
                                onClick={handleOpenMaskAdjustment}
                                className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:border-cyan-300 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                              >
                                クリッピング
                              </button>
                              <button
                                type="button"
                                onClick={handleRecognizeMask}
                                className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500"
                              >
                                AIマスク認識
                              </button>
                            </div>
                        </>
                        {maskCandidates.length > 0 && (
                          <div className="mt-3 rounded-lg border border-cyan-100 bg-cyan-50 p-2 dark:border-cyan-400/20 dark:bg-cyan-400/10">
                            <p className="text-[11px] font-semibold text-cyan-800 dark:text-cyan-100">保存したい範囲を選択してください</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {maskCandidates.map((candidate) => (
                                <button
                                  key={candidate}
                                  type="button"
                                  onClick={() => handleSelectMaskCandidate(candidate)}
                                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                    selectedMaskCandidate === candidate
                                      ? 'border-cyan-500 bg-cyan-600 text-white'
                                      : 'border-cyan-200 bg-white text-cyan-700 hover:border-cyan-400 dark:bg-neutral-950 dark:text-cyan-200'
                                  }`}
                                >
                                  {candidate}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={handleExtractAndConfirmNextStep}
                              disabled={!selectedMaskCandidate || cutMode === 'keep'}
                              className="mt-3 w-full rounded-lg bg-neutral-950 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-950"
                            >
                              抽出して次へ
                            </button>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={handleExtractMask}
                                disabled={!selectedMaskCandidate || cutMode === 'keep'}
                                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                              >
                                抽出
                              </button>
                              <button
                                type="button"
                                onClick={handleConfirmNextStep}
                                disabled={!extractedLayerReady}
                                className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-950"
                              >
                                次のステップ
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      )}

                      {lightchainProviderSupported && (
                        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-cyan-200/20 bg-cyan-50 px-3 py-3 text-xs leading-5 text-cyan-900 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-50">
                          <input
                            type="checkbox"
                            checked={providerRightsConfirmed}
                            onChange={(event) => {
                              setProviderRightsConfirmed(event.target.checked);
                              setLightchainGenerationError(null);
                            }}
                            className="mt-1 h-4 w-4 accent-cyan-600"
                            data-testid="lightchain-rights-confirmation"
                          />
                          <span>アップロード素材の権利・利用許諾を確認済みです。確認後のみ実プロバイダを実行します。</span>
                        </label>
                      )}
                      <button
                        type="button"
                        disabled={aiGenerateDisabled || lightchainGenerationRunning}
                        onClick={() => void handleLightchainPreviewGenerate({ allowBriefOnly: true })}
                        className="w-full rounded-xl bg-primary-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-500 disabled:bg-neutral-300 disabled:text-neutral-500 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
                      >
                        AI生成
                      </button>

                      {garmentImageUrl && (
                      <details className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                        <summary className="cursor-pointer rounded-lg text-sm font-semibold text-neutral-800 outline-none focus-visible:ring-2 focus-visible:ring-primary-300 dark:text-neutral-100">
                          レイヤー詳細
                          <span className="ml-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                            {activeLayer} / {printPlacement}
                          </span>
                        </summary>
                        <p className="mt-3 text-xs font-semibold text-neutral-500 dark:text-neutral-400">デザインレイヤー</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {[
	                            ...workbenchLabels.layers,
	                          ].map(([layer, label]) => (
                            <button
                              key={layer}
                              type="button"
		                              onClick={() => handleSelectDesignLayer(layer)}
                              className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
                                activeLayer === layer
                                  ? 'bg-cyan-600 text-white'
                                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <label className="mt-3 block">
                          <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">配置</span>
                          <select
                            value={printPlacement}
                            onChange={(event) => setPrintPlacement(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-2 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
                          >
	                            {workbenchLabels.placements.map((placement) => (
	                              <option key={placement}>{placement}</option>
	                            ))}
                          </select>
                        </label>
                        <label className="mt-3 block">
                          <span className="flex items-center justify-between text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                            サイズ
                            <span>{printScale}%</span>
                          </span>
                          <input
                            type="range"
                            min="20"
                            max="90"
                            value={printScale}
                            onChange={(event) => setPrintScale(Number(event.target.value))}
                            className="mt-2 w-full accent-cyan-600"
                          />
                        </label>
                      </details>
                      )}

                      {garmentImageUrl && (
                      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                        <div className={`relative flex min-h-[220px] items-center justify-center ${garmentImageUrl ? 'bg-[linear-gradient(45deg,#f4f4f5_25%,transparent_25%),linear-gradient(-45deg,#f4f4f5_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f4f4f5_75%),linear-gradient(-45deg,transparent_75%,#f4f4f5_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0] dark:bg-neutral-950' : 'bg-neutral-50 dark:bg-neutral-950'}`}>
                          {garmentImageUrl ? (
                            <>
                              <img src={garmentImageUrl} alt="衣服レイヤープレビュー" className={`max-h-56 max-w-[78%] object-contain ${extractedLayerReady ? 'opacity-45' : ''}`} />
                              {extractedLayerReady && (
                                <img
                                  src={extractedGarmentImageUrl || garmentImageUrl}
                                  alt="抽出済みカットレイヤー"
                                  className="absolute max-h-52 max-w-[72%] rounded-xl object-contain drop-shadow-[0_16px_26px_rgba(15,23,42,0.35)]"
                                />
                              )}
                            </>
                          ) : (
                            <div className="text-center">
                              <ImagePlus className="mx-auto h-10 w-10 text-neutral-300 dark:text-neutral-700" />
                              <p className="mt-2 text-sm font-semibold text-neutral-500 dark:text-neutral-400">素材を入れると合成プレビューが表示されます</p>
                            </div>
                          )}
                          {garmentImageUrl && !extractedLayerReady && (
                            <div
                              className="absolute left-1/2 top-1/2 flex -translate-x-1/2 items-center justify-center rounded-full border-2 border-cyan-200 bg-neutral-950/88 px-5 py-3 text-xs font-black tracking-[0.18em] text-cyan-100 shadow-xl"
                              style={{
                                width: `${printScale * 2.2}px`,
                                transform: `translate(-50%, ${printPlacement.includes('背面') ? '-16%' : printPlacement.includes('袖') ? '-72%' : '-50%'})`,
                              }}
                            >
                              プリント
                            </div>
                          )}
                          {nextStepConfirmed && (
                            <div className="absolute bottom-3 right-3 rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-white shadow-lg">
                              OK
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-3 border-t border-neutral-200 text-xs dark:border-neutral-800">
                          <div className="p-2">
                            <p className="font-semibold text-neutral-500">素材</p>
                            <p className="mt-1 truncate text-neutral-900 dark:text-white">{garmentFileName || '未選択'}</p>
                          </div>
                          <div className="border-x border-neutral-200 p-2 dark:border-neutral-800">
                            <p className="font-semibold text-neutral-500">処理</p>
                            <p className="mt-1 text-neutral-900 dark:text-white">{cutMode === 'auto' ? '自動カット' : cutMode === 'manual' ? '手動マスク' : '背景維持'}</p>
                          </div>
                          <div className="p-2">
                            <p className="font-semibold text-neutral-500">レイヤー</p>
                            <p className="mt-1 text-neutral-900 dark:text-white">{activeLayer}</p>
                          </div>
                        </div>
                      </div>
                      )}
                    </div>
                  </section>
                )}

                <details className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
                  <summary className="cursor-pointer rounded-lg text-sm font-semibold text-neutral-800 outline-none focus-visible:ring-2 focus-visible:ring-primary-300 dark:text-neutral-100">
                    この機能の詳細
                  </summary>
                <div className="mt-4 grid gap-4">
                  <div>
                    <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">入力</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedTool.inputs.map((input) => (
                    <span key={input} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                          {input}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">成果物</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedTool.outputs.map((output) => (
                        <span key={output} className="rounded-lg bg-primary-50 px-2.5 py-1 text-xs text-primary-700 dark:bg-primary-400/10 dark:text-primary-200">
                          {output}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                  {isFittingDetail && (
                    <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800 dark:bg-amber-400/10 dark:text-amber-100">
                      着用画像を作る時は、この画面ではなくAIフィッティング画面で「画像を入れて作る」から進みます。
                    </p>
                  )}
                  <Link
                    to={selectedToolActionHref}
                    onClick={isFittingDetail ? handleFittingActionClick : undefined}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                  >
                    {isFittingDetail ? 'AIフィッティング画面で作る' : selectedTool.runLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </details>

                {garmentImageUrl && (
                <label className="mt-5 block">
                  <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">参考条件</span>
                  <textarea
                    value={referenceNote}
                    onChange={(event) => setReferenceNote(event.target.value)}
                    className="mt-2 min-h-[110px] w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
                  />
                </label>
                )}

                {(garmentImageUrl || lightchainResult) && (
                <div className="mt-5 grid gap-2">
                  <button
                    type="button"
                    onClick={handleSaveToCanvas}
                    disabled={isSaving}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 transition hover:border-primary-300 hover:text-primary-700 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                  >
                    <Layers3 className="h-4 w-4" />
                    保存
                  </button>
                </div>
                )}
                </>
                )}
              </div>
            </aside>
            {isFeatureDetail && (
              <aside className="relative min-h-[560px] lg:sticky lg:top-24 lg:self-start">
                <Link
                  to="/history"
                  className="absolute right-0 top-0 z-10 rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white"
                  data-testid="lightchain-feature-history-link"
                >
                  履歴
                </Link>
                <section className="flex min-h-[560px] items-center justify-center">
                  <div className="w-full pt-16 text-center">
                    <h2 className="text-xl font-semibold text-[#6ee7df]">
                      {isPatternVectorProFlow ? 'パターンをベクター画像に変換（プロフェッショナル版）' : currentDisplayTitle}
                    </h2>
                    <p className="mx-auto mt-4 max-w-[460px] text-sm leading-7 text-neutral-400">
                      {selectedTool.id === 'printing-image'
                        ? 'プリントイメージを使用し、版下を作成せずに印刷効果を確認できます'
                        : selectedTool.id === 'fabric-image'
                          ? '異なる生地の効果を生成できます'
                        : selectedTool.id === 'line-to-real'
                          ? '平絵を編集可能なベクター画像に変換します'
                        : selectedTool.id === 'line-generation'
                          ? '衣類の着用画像や平置き画像から平絵に変換'
                        : isPatternVectorProFlow
                          ? 'プリントパターンをベクター画像に変換します'
                        : currentModelPanel
                          ? currentModelPanel.subtitle ?? selectedTool.description
                        : selectedTool.description}
                    </p>
                    <div className={`mx-auto mt-10 flex max-w-[520px] items-center justify-center bg-black/30 p-4 ${lightchainResult ? 'min-h-[420px] overflow-visible' : 'aspect-[16/9] overflow-hidden'}`}>
                      {lightchainResult ? (
	                        <div className="w-full">
	                          {renderLightchainResultPreviewImage('mx-auto max-h-56 w-full rounded-lg object-contain', '生成結果プレビュー')}
	                          <div className="mx-auto mt-3 max-w-[420px] rounded-xl border border-white/10 bg-[#111719] px-4 py-3 text-left">
	                            <p className="text-sm font-semibold text-white">{lightchainResult.title}</p>
	                            <p className="mt-1 text-xs leading-5 text-neutral-400">{lightchainResult.summary}</p>
                              <div className="mt-3 grid gap-2">
                                <button
                                  type="button"
                                  onClick={handleSaveToCanvas}
                                  disabled={isSaving}
                                  className="w-full rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                                >
                                  保存
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDownloadLightchainResult()}
                                  disabled={!lightchainResult}
                                  data-testid="lightchain-feature-result-download"
                                  className="w-full rounded-lg border border-white/10 bg-[#20272a] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-cyan-300/50 disabled:opacity-60"
                                >
                                  ダウンロード
                                </button>
                              </div>
	                          </div>
	                        </div>
	                      ) : garmentImageUrl ? (
	                        <div className={`grid w-full items-center gap-4 ${materialSlots.length > 1 ? 'grid-cols-[minmax(0,1fr)_96px]' : 'grid-cols-1'}`}>
	                          <img src={extractedGarmentImageUrl || garmentImageUrl} alt="右側プレビュー" className="max-h-56 w-full rounded-lg object-contain" />
	                          {materialSlots.length > 1 && materialSlotFiles.secondary ? (
	                            <div className="rounded-xl border border-white/10 bg-[#111719] p-2 text-center">
	                              <img src={materialSlotFiles.secondary.imageUrl} alt="追加素材プレビュー" className="h-20 w-full rounded-lg object-contain" />
	                              <p className="mt-2 truncate text-[11px] font-semibold text-neutral-300">{materialSlotFiles.secondary.name}</p>
	                            </div>
	                          ) : materialSlots.length > 1 ? (
	                            <div className="rounded-xl border border-dashed border-white/10 bg-[#111719] p-2 text-center text-[11px] font-semibold text-neutral-500">
	                              追加素材
	                            </div>
	                          ) : null}
	                        </div>
	                      ) : (
	                        <div className="text-center">
	                          <ImagePlus className="mx-auto h-9 w-9 text-neutral-300 dark:text-neutral-700" />
                          <p className="mt-2 text-sm font-semibold text-neutral-500 dark:text-neutral-400">素材選択後に表示</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </aside>
            )}
          </div>
        </section>
      </div>
      {materialModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-neutral-950/65 p-3 backdrop-blur-md sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="素材選択">
          <div className="max-h-[88vh] w-full overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(13,17,20,0.98),rgba(9,12,14,0.96))] shadow-2xl sm:max-w-4xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-white">素材選択</h2>
                <p className="mt-0.5 text-xs text-neutral-400">素材から選びます。</p>
              </div>
              <button
                type="button"
                onClick={() => setMaterialModalOpen(false)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-neutral-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-white"
              >
                閉じる
              </button>
            </div>
            <div className="grid max-h-[calc(88vh-64px)] overflow-y-auto md:grid-cols-[220px_1fr]">
              <div className="border-b border-white/10 p-3 md:border-b-0 md:border-r">
                <div className="flex gap-2 overflow-x-auto md:block md:space-y-2">
                  {materialTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveMaterialTab(tab.id)}
                      className={`w-full shrink-0 rounded-2xl px-3 py-2 text-left text-sm font-semibold transition ${
                        activeMaterialTab === tab.id
                          ? 'bg-cyan-300 text-neutral-950'
                          : 'bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-4">
                <p className="text-sm font-semibold text-white">
                  {materialTabs.find((tab) => tab.id === activeMaterialTab)?.label}
                </p>
                <p className="mt-1 text-sm text-neutral-400">
                  {materialTabs.find((tab) => tab.id === activeMaterialTab)?.description}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {materialTabItems[activeMaterialTab].length > 0 ? materialTabItems[activeMaterialTab].map((item) => (
                    <div key={`${activeMaterialTab}-${item.title}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <div className="relative flex min-h-[92px] items-center justify-center overflow-hidden rounded-xl bg-white/[0.04] text-sm font-semibold text-neutral-400">
                        <img src={item.imageUrl} alt="" className="h-28 w-full object-cover" />
                      </div>
                      <div className="mt-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{item.title}</p>
                          <p className="mt-1 text-xs text-neutral-400">{item.note}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUseMaterialAsset(item)}
                          className="shrink-0 rounded-full bg-cyan-300 px-3 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-cyan-200"
                        >
                          使用
                        </button>
                      </div>
                    </div>
                  )) : (
                    <p className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-neutral-500">
                      このタブに使える保存済み素材はありません。アップロードまたは生成結果を保存してください。
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {lightchainResultModal}
    </main>
  );
}
