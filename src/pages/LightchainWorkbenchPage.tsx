import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Boxes,
  ClipboardList,
  Film,
  Layers3,
  ImagePlus,
  MessageSquareText,
  Palette,
  Search,
  Shirt,
  Sparkles,
  UserRound,
  WandSparkles,
  Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { useCanvasStore } from '../stores/canvasStore';
import { buildMaterialCutoutDataUrl, type MaterialCutoutBounds } from '../lib/workspaceMaterialReferences';
import { saveWorkspaceArtifactBestEffort } from '../lib/localWorkspaceArtifacts';

type ToolCategory = 'home' | 'marketing' | 'fitting' | 'planning' | 'graphics' | 'model' | 'video' | 'lab';
type ToolStatus = 'ready' | 'workspace' | 'needs-image' | 'coming-soon';
type MaskCandidate = 'トップス' | '無地部分' | '柄' | '手動範囲';
type WorkbenchStep = 'asset' | 'mask' | 'extracted' | 'next';

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
    title: 'Heavy Chain Lab',
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
      <text x="112" y="126" fill="#67e8f9" font-family="Arial, sans-serif" font-size="28" font-weight="700">LIGHTCHAIN ORDER SHEET</text>
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
      <text x="112" y="794" fill="#94a3b8" font-family="Arial, sans-serif" font-size="22">lightchain-order-sheet-v1 / selected-tool-preview / Canvas handoff</text>
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

const maskCandidateLayer: Record<MaskCandidate, string> = {
  トップス: 'garment',
  無地部分: 'base',
  柄: 'pattern',
  手動範囲: 'mask',
};

export function LightchainWorkbenchPage() {
  const navigate = useNavigate();
  const { toolId } = useParams<{ toolId?: string }>();
  const { currentBrand } = useAuthStore();
  const { createProject, addObject, selectObject, saveCurrentProject } = useCanvasStore();
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

  const routeTool = toolId ? tools.find((tool) => tool.id === toolId) ?? null : null;
  const isFeatureDetail = Boolean(toolId);
  const selectedTool = routeTool ?? tools.find((tool) => tool.id === selectedToolId) ?? filteredTools[0] ?? tools[0];
  const selectedCategory = categories.find((category) => category.id === (isFeatureDetail ? selectedTool.category : activeCategory)) ?? categories[0];
  const workbenchLabels = categoryWorkbenchLabels[selectedTool.category] ?? categoryWorkbenchLabels.home;
  const workbenchEnabled = selectedTool.status !== 'coming-soon';
  const layerIds = workbenchLabels.layers.map(([layer]) => layer);
  const beginnerStep = nextStepConfirmed ? 3 : extractedLayerReady ? 2 : garmentImageUrl ? 1 : 0;

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

  useEffect(() => {
    const defaults = categoryWorkbenchLabels[selectedTool.category] ?? categoryWorkbenchLabels.home;
    setGarmentCategory(defaults.materialKinds[0] ?? '素材');
    setActiveLayer(defaults.layers[0]?.[0] ?? 'base');
    setPrintPlacement(defaults.placements[0] ?? '中央');
    setSelectedToolId(selectedTool.id);
    setActiveCategory(selectedTool.category);
    resetWorkbenchMaskState();
  }, [selectedTool.category, selectedTool.id]);

  const handleCategoryChange = (categoryId: ToolCategory) => {
    setActiveCategory(categoryId);
    setQuery('');
    setMobileToolsExpanded(false);
    setSelectedToolId(tools.find((tool) => tool.category === categoryId)?.id ?? tools[0].id);
  };

  if (toolId && !routeTool) {
    return <Navigate to="/lightchain" replace />;
  }

  const handleGarmentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('衣服画像は5MB以下にしてください');
      event.target.value = '';
      return;
    }

    try {
      setGarmentImageUrl(await readFileAsDataUrl(file));
      setGarmentFileName(file.name);
      setAnalysisStatus('ready');
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
      toast.success('素材画像を読み込み、編集レイヤーを準備しました');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '画像を読み込めませんでした');
    }
  };

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

    setIsSaving(true);
    try {
      const shouldSaveWorkbenchAsset = workbenchEnabled && Boolean(garmentImageUrl);
      const ensuredCutout = shouldSaveWorkbenchAsset && extractedLayerReady && !extractedGarmentImageUrl
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
      const projectId = createProject(`素材ワークベンチ: ${selectedTool.title}`, currentBrand.id);
      const lightchainWorkbenchState = workbenchEnabled ? {
        toolId: selectedTool.id,
        toolCategory: selectedTool.category,
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
        overlayLabel: 'HC',
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
          status: 'processing' as const,
        }],
      };
      const workbenchParameters = lightchainWorkbenchState ? {
        materialReference,
        materialReferences: materialReference ? [materialReference] : [],
        layerPlan,
        maskPlan,
        compositionPreview,
        lightchainWorkbenchState,
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
      const artifact = await saveWorkspaceArtifactBestEffort({
        brandId: currentBrand.id,
        featureType: `lightchain-${selectedTool.id}`,
        title: selectedTool.title,
        imageUrl: orderSheetPreview,
        prompt: `${selectedTool.promptTemplate}\n\n依頼: ${brief}\n参考: ${referenceNote}${lightchainWorkbenchState ? `\n素材: ${garmentCategory} / ${cutMode} / ${printPlacement} / ${printScale}%` : ''}`,
        canvasProjectId: projectId,
        metadata: {
          sourceWorkspace: 'lightchain-workbench',
          previewKind: 'lightchain-order-sheet-v1',
          lightchainRoute: selectedTool.lightchainRoute,
          inputs: selectedTool.inputs,
          outputs: selectedTool.outputs,
          heavyChainHref: selectedTool.heavyChainHref,
          ...workbenchParameters,
        },
      });

      let materialObjectId: string | null = null;
      let overlayObjectId: string | null = null;

      if (shouldSaveWorkbenchAsset) {
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
          text: 'HC',
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
      if (overlayObjectId ?? materialObjectId) {
        selectObject((overlayObjectId ?? materialObjectId) as string);
      }
      saveCurrentProject();
      toast.success('素材ワークベンチの内容をCanvasへ保存しました');
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
                {isFeatureDetail ? selectedTool.lightchainRoute : `素材ワークベンチ / ${totalToolCount}機能`}
              </p>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-neutral-950 dark:text-white sm:text-3xl">
                {isFeatureDetail ? selectedTool.title : '用途を選んで、そのまま制作へ進む'}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-neutral-600 dark:text-neutral-300">
                {isFeatureDetail ? selectedTool.description : '既存の生成、フィッティング、柄、モデル、動画、Canvasへつながる入口です。'}
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
          {!isFeatureDetail && (
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
          )}

          {isFeatureDetail && (
            <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-soft dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                  <Link
                    to="/lightchain"
                    className="shrink-0 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 transition hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                  >
                    すべての機能
                  </Link>
                  {['素材を入れる', '調整する', 'Canvasへ保存'].map((step, index) => (
                    <span
                      key={step}
                      className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${
                        beginnerStep >= index
                          ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                          : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                      }`}
                    >
                      {step}
                    </span>
                  ))}
                </div>
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                  素材を入れて、必要な調整をして、Canvasへ保存します。
                </p>
              </div>
            </div>
          )}

          <div className={isFeatureDetail ? 'grid gap-5' : 'grid gap-5 xl:grid-cols-[1fr_420px]'}>
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
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusTone[tool.status]}`}>
                            {statusLabel[tool.status]}
                          </span>
                        </span>
                        <span className="mt-2 line-clamp-2 block text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                          {tool.description}
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
              <div className={`rounded-2xl border border-neutral-200 bg-white p-5 shadow-soft dark:border-neutral-800 dark:bg-neutral-900 ${isFeatureDetail ? 'mx-auto w-full max-w-6xl' : 'xl:sticky xl:top-24'}`}>
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

                {workbenchEnabled && (
                  <section className="mt-5 space-y-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
                    <div className="grid gap-3">
                      <label className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-center transition hover:border-primary-300 dark:border-neutral-700 dark:bg-neutral-900">
                        <input type="file" accept="image/*" className="hidden" onChange={handleGarmentUpload} />
	                        {garmentImageUrl ? (
	                          <img src={garmentImageUrl} alt="アップロードした素材" className="max-h-28 rounded-lg object-contain" />
	                        ) : (
	                          <>
	                            <Upload className="h-7 w-7 text-primary-500" />
	                            <span className="mt-2 text-sm font-semibold text-neutral-900 dark:text-white">{workbenchLabels.uploadLabel}</span>
	                            <span className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
	                              {workbenchLabels.emptyLabel}
	                            </span>
                          </>
                        )}
                      </label>

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
                              HC
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
                  <Link
                    to={selectedTool.heavyChainHref}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                  >
                    {selectedTool.runLabel}
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

                {garmentImageUrl && (
                <div className="mt-5 grid gap-2">
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
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
