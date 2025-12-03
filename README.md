# Heavy Chain

AI駆動のアパレル向け画像生成プラットフォーム

## 概要

Heavy Chainは、AI（Gemini + OpenAI）を活用したアパレル向け画像生成プラットフォームです。マーケティング、商品企画、EC、編集ユーティリティなど、アパレルビジネスに必要な画像生成・編集機能をワンストップで提供します。

## 技術スタック

- **フロントエンド**: React + Vite + TypeScript + Tailwind CSS
- **バックエンド**: Supabase（認証・DB・ストレージ・Edge Functions）
- **AI画像生成**: Gemini API
- **AIテキスト処理**: OpenAI GPT-4（プロンプト最適化）
- **決済**: Stripe（将来実装予定）
- **ホスティング**: Zeabur

## セットアップ

### 1. 依存関係のインストール

```bash
cd heavy-chain
npm install
```

### 2. 環境変数の設定

`.env` ファイルをプロジェクトルートに作成：

```env
# Supabase
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Stripe (将来用)
VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
```

### 3. Supabaseの設定

#### データベーススキーマの適用

1. Supabase Dashboard にアクセス
2. SQL Editor で `supabase/migrations/001_initial_schema.sql` を実行

#### ストレージバケットの作成

Supabase Dashboard → Storage → New bucket:
- Bucket name: `generated-images`
- Public: `true`

#### Edge Functionsのデプロイ

Supabase CLIを使用：

```bash
supabase functions deploy generate-image
```

Edge Functions用の環境変数をSupabase Dashboardで設定：
- `GEMINI_API_KEY`
- `GEMINI_IMAGE_MODEL`
- `OPENAI_API_KEY`

### 4. 開発サーバーの起動

```bash
npm run dev
```

## プロジェクト構造

```
heavy-chain/
├── src/
│   ├── components/       # Reactコンポーネント
│   │   ├── layout/       # レイアウトコンポーネント
│   │   ├── ui/           # 再利用可能なUIコンポーネント
│   │   └── ...
│   ├── pages/            # ページコンポーネント
│   ├── stores/           # Zustand状態管理
│   ├── lib/              # ユーティリティ・API設定
│   ├── hooks/            # カスタムフック
│   └── types/            # TypeScript型定義
├── supabase/
│   ├── functions/        # Edge Functions
│   └── migrations/       # データベースマイグレーション
└── public/               # 静的ファイル
```

## 機能一覧（Phase 1 MVP）

- ✅ 認証システム（メール/Google/Apple OAuth）
- ✅ ブランド管理（シングルブランド）
- ✅ Text-to-Image画像生成
- ✅ 画像ギャラリー・管理
- ✅ 画像ダウンロード（PNG/JPEG/WebP）
- ✅ お気に入り機能

## 開発コマンド

```bash
# 開発サーバー起動
npm run dev

# ビルド
npm run build

# プレビュー
npm run preview

# 型チェック
npm run typecheck

# リント
npm run lint
```

## ライセンス

Private - All rights reserved
