import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Boxes,
  ClipboardList,
  Film,
  Layers3,
  MessageSquareText,
  Palette,
  Search,
  Shirt,
  Sparkles,
  UserRound,
  WandSparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { useCanvasStore } from '../stores/canvasStore';
import { saveWorkspaceArtifactBestEffort } from '../lib/localWorkspaceArtifacts';

type ToolCategory = 'home' | 'marketing' | 'fitting' | 'planning' | 'graphics' | 'model' | 'video' | 'lab';
type ToolStatus = 'ready' | 'workspace' | 'needs-image' | 'coming-soon';

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
  { id: 'home', label: 'おすすめ', icon: Sparkles, description: 'Lightchainトップの主要ワークスペースをまとめた入口です。' },
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
    category: 'home',
    status: 'ready',
    description: '衣服画像0/4、シングル/マルチタスク、説明生成、参考画像、モデルセット写真、1K品質を持つ着用生成。',
    inputs: ['衣服画像', '説明文', 'モデル画像', 'ポーズ', '背景'],
    outputs: ['モデル着用画像', 'EC素材', '生成履歴'],
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
    heavyChainHref: '/studio',
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
    heavyChainHref: '/generate?feature=chat-edit',
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
    heavyChainHref: '/models',
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
    title: 'Lightchain Lab',
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
    title: 'プリントデザイン',
    lightchainRoute: '/editor/patternDesign',
    category: 'graphics',
    status: 'workspace',
    description: 'プリントデザインの新規ファイル、過去プロジェクト、ファッション/ホームテキスタイル事例。',
    inputs: ['柄画像', '用途', 'リピート条件'],
    outputs: ['プリント案', '柄プロジェクト'],
    heavyChainHref: '/patterns',
    runLabel: '柄を作る',
    promptTemplate: 'アパレル向けプリント柄を、用途とリピート条件に合わせて作成してください。',
  },
  {
    id: 'print-design-detail',
    title: 'プリントデザイン詳細',
    lightchainRoute: '/editor/patternDesign/detail',
    category: 'graphics',
    status: 'needs-image',
    description: '画像追加からプリント編集を開始し、ガイドあり/なしで進める詳細編集画面。',
    inputs: ['柄画像', '編集指示', '配色'],
    outputs: ['編集済み柄', 'Canvas素材'],
    heavyChainHref: '/patterns',
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
    heavyChainHref: '/patterns',
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
    heavyChainHref: '/generate?feature=product-shots',
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
    heavyChainHref: '/patterns',
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
    heavyChainHref: '/patterns',
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
    heavyChainHref: '/patterns',
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
    heavyChainHref: '/patterns',
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
    heavyChainHref: '/models',
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
    heavyChainHref: '/models',
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

const statusLabel: Record<ToolStatus, string> = {
  ready: '生成導線あり',
  workspace: '企画/Canvas対応',
  'needs-image': '画像入力必須',
  'coming-soon': '設計中',
};

const statusTone: Record<ToolStatus, string> = {
  ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/20',
  workspace: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-400/20',
  'needs-image': 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20',
  'coming-soon': 'bg-neutral-100 text-neutral-600 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700',
};

const totalToolCount = tools.length;

const textArtifactPreview =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><rect width="1200" height="900" fill="#0f172a"/><rect x="96" y="96" width="1008" height="708" rx="40" fill="#111827" stroke="#22d3ee" stroke-width="4"/><text x="150" y="210" fill="#e5e7eb" font-family="Arial, sans-serif" font-size="54" font-weight="700">Lightchain compatible brief</text><text x="150" y="300" fill="#67e8f9" font-family="Arial, sans-serif" font-size="34">Heavy Chain Canvas order sheet</text></svg>'
  );

export function LightchainWorkbenchPage() {
  const navigate = useNavigate();
  const { currentBrand } = useAuthStore();
  const { createProject, addObject, saveCurrentProject } = useCanvasStore();
  const [activeCategory, setActiveCategory] = useState<ToolCategory>('home');
  const [selectedToolId, setSelectedToolId] = useState('marketing-home');
  const [query, setQuery] = useState('');
  const [brief, setBrief] = useState('黒のチェーン柄フーディーを、ECとSNSで使える高級ストリート系ビジュアルに展開したい。');
  const [referenceNote, setReferenceNote] = useState('モデルは20代、無地背景、チェーン柄は服の主役として残す。');
  const [isSaving, setIsSaving] = useState(false);

  const filteredTools = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return tools.filter((tool) => {
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

  const selectedTool = tools.find((tool) => tool.id === selectedToolId) ?? filteredTools[0] ?? tools[0];
  const selectedCategory = categories.find((category) => category.id === activeCategory) ?? categories[0];

  const handleCategoryChange = (categoryId: ToolCategory) => {
    setActiveCategory(categoryId);
    setQuery('');
    setSelectedToolId(tools.find((tool) => tool.category === categoryId)?.id ?? tools[0].id);
  };

  const handleSaveToCanvas = async () => {
    if (!currentBrand || isSaving) {
      if (!currentBrand) toast.error('ブランドを選択してください');
      return;
    }

    setIsSaving(true);
    try {
      const projectId = createProject(`Lightchain互換: ${selectedTool.title}`, currentBrand.id);
      const artifact = await saveWorkspaceArtifactBestEffort({
        brandId: currentBrand.id,
        featureType: `lightchain-${selectedTool.id}`,
        title: selectedTool.title,
        imageUrl: textArtifactPreview,
        prompt: `${selectedTool.promptTemplate}\n\n依頼: ${brief}\n参考: ${referenceNote}`,
        canvasProjectId: projectId,
        metadata: {
          sourceWorkspace: 'lightchain-workbench',
          lightchainRoute: selectedTool.lightchainRoute,
          inputs: selectedTool.inputs,
          outputs: selectedTool.outputs,
          heavyChainHref: selectedTool.heavyChainHref,
        },
      });

      addObject({
        type: 'text',
        x: 120,
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
          parameters: {
            toolId: selectedTool.id,
            artifactId: artifact.artifact.id,
            lightchainRoute: selectedTool.lightchainRoute,
            heavyChainHref: selectedTool.heavyChainHref,
            inputs: selectedTool.inputs,
            outputs: selectedTool.outputs,
          },
        },
      });
      saveCurrentProject();
      toast.success('Lightchain互換の注文票をCanvasへ保存しました');
      navigate(`/canvas/${projectId}`);
    } catch (error) {
      console.error('Failed to save Lightchain workbench artifact:', error);
      toast.error('Canvas保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-surface-50 px-4 py-5 dark:bg-surface-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-100 dark:bg-primary-400/10 dark:text-primary-300 dark:ring-primary-400/20">
                <Sparkles className="h-3.5 w-3.5" />
                Lightchain互換 / {totalToolCount}機能
              </p>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-neutral-950 dark:text-white sm:text-3xl">
                用途を選んで、そのまま制作へ進む
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-neutral-600 dark:text-neutral-300">
                既存の生成、フィッティング、柄、モデル、動画、Canvasへつながる入口です。
              </p>
            </div>
            <label className="flex min-w-0 items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-700 dark:bg-neutral-950 lg:w-[420px]">
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
          <div className="rounded-2xl border border-neutral-200 bg-white p-2 shadow-soft dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex gap-1.5 overflow-x-auto">
              {categories.map((category) => {
                const Icon = category.icon;
                const active = category.id === activeCategory;
                const count = tools.filter((tool) => tool.category === category.id).length;
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

          <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
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
                      onChange={(event) => setQuery(event.target.value)}
                      className="w-full min-w-0 border-0 bg-transparent outline-none placeholder:text-neutral-400"
                      placeholder="機能を検索"
                    />
                  </label>
                </div>
              </div>

              <div className="grid gap-3 2xl:grid-cols-2">
                {filteredTools.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => setSelectedToolId(tool.id)}
                      className={`rounded-xl border bg-white p-4 text-left transition dark:bg-neutral-900 ${
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
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusTone[tool.status]}`}>
                            {statusLabel[tool.status]}
                          </span>
                        </span>
                        <span className="mt-2 line-clamp-2 block text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                          {tool.description}
                        </span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <aside>
              <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 xl:sticky xl:top-24">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                      {selectedTool.lightchainRoute}
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-neutral-900 dark:text-white">{selectedTool.title}</h3>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusTone[selectedTool.status]}`}>
                    {statusLabel[selectedTool.status]}
                  </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                  {selectedTool.description}
                </p>

                <div className="mt-5 grid gap-4">
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

                <label className="mt-5 block">
                  <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">参考条件</span>
                  <textarea
                    value={referenceNote}
                    onChange={(event) => setReferenceNote(event.target.value)}
                    className="mt-2 min-h-[110px] w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
                  />
                </label>

                <div className="mt-5 grid gap-2">
                  <Link
                    to={selectedTool.heavyChainHref}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                  >
                    {selectedTool.runLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={handleSaveToCanvas}
                    disabled={isSaving}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 transition hover:border-primary-300 hover:text-primary-700 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                  >
                    <Layers3 className="h-4 w-4" />
                    Canvasに注文票を保存
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
