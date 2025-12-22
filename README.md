# Heavy Chain

[![License: Private](https://img.shields.io/badge/License-Private-red.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2-61dafb.svg)](https://reactjs.org/)

> AI駆動のアパレル向け画像生成プラットフォーム | AI-powered Image Generation Platform for Fashion

[🇯🇵 日本語](#日本語) | [🇬🇧 English](#english)

---

## 日本語

### 🎯 概要

Heavy Chainは、**AI（Gemini + OpenAI）を活用したアパレル向け画像生成プラットフォーム**です。マーケティング、商品企画、EC、編集ユーティリティなど、アパレルビジネスに必要な画像生成・編集機能をワンストップで提供します。

### ✨ デモ

**🔗 デモサイト**: [Coming Soon]

<!-- デプロイ後にURLを追加してください -->

### 📸 スクリーンショット

<!-- スクリーンショットを追加する場合は、/screenshotsフォルダに画像を配置してください -->

```
Coming Soon - デモ画面を追加予定
- ダッシュボード画面
- 画像生成インターフェース
- キャンバスエディター
- ギャラリービュー
```

### 🎨 主な機能

#### 🚀 Phase 1 (MVP) - 実装済み

- ✅ **認証システム** - メール/Google/Apple OAuth対応
- ✅ **ブランド管理** - 複数ブランドの一元管理
- ✅ **AI画像生成** - Text-to-Image生成（Gemini API）
- ✅ **画像ギャラリー** - 生成画像の一覧・管理
- ✅ **ダウンロード機能** - PNG/JPEG/WebP形式対応
- ✅ **お気に入り機能** - 重要な画像をブックマーク

#### 🎯 Phase 2+ - 開発予定

- 🔄 **無限キャンバスUI** - Figmaライクな直感的編集体験
- 🌳 **派生ツリービュー** - 画像の生成履歴を視覚化
- 👥 **リアルタイム共同編集** - チームでの同時作業
- 🎭 **カラバリ・柄モックアップ** - 複数バリエーション自動生成
- 🏪 **ECプラットフォーム連携** - Shopify/BASE/STORES
- 🌐 **多言語対応** - 日本語/英語/中国語/韓国語

### 🛠️ 技術スタック

#### フロントエンド
- **React 19.2** + **TypeScript 5.9** - 型安全な開発体験
- **Vite** - 高速なビルドツール
- **Tailwind CSS** - ユーティリティファーストCSS
- **Zustand** - シンプルな状態管理
- **React Router** - SPA routing
- **Framer Motion** - スムーズなアニメーション

#### バックエンド
- **Supabase** - BaaS（認証・DB・ストレージ・Edge Functions）
- **PostgreSQL** - リレーショナルデータベース
- **Row Level Security (RLS)** - セキュアなデータアクセス制御

#### AI/機械学習
- **Gemini API** - 画像生成
- **OpenAI GPT-4** - プロンプト最適化・自然言語処理

#### キャンバス・UI
- **Konva.js** + **react-konva** - 2Dキャンバス操作
- **React Flow** - ノードグラフ・派生ツリー表示
- **Yjs** - リアルタイム共同編集（CRDT）

#### インフラ・その他
- **Zeabur** - ホスティング
- **Stripe** - 決済（将来実装予定）
- **Lucide React** - アイコンセット

### 📂 プロジェクト構造

```
heavy-chain/
├── src/
│   ├── components/       # Reactコンポーネント
│   │   ├── canvas/       # キャンバス関連コンポーネント
│   │   ├── layout/       # ヘッダー・サイドバー等
│   │   ├── ui/           # 再利用可能なUIコンポーネント
│   │   └── ...           # 各種機能別コンポーネント
│   ├── pages/            # ページコンポーネント
│   ├── stores/           # Zustand状態管理
│   ├── lib/              # ユーティリティ・API設定
│   └── types/            # TypeScript型定義
├── supabase/
│   ├── functions/        # Edge Functions（12機能）
│   │   ├── generate-image/        # 画像生成
│   │   ├── remove-background/     # 背景削除
│   │   ├── upscale/              # アップスケール
│   │   ├── colorize/             # カラーバリエーション
│   │   └── ...
│   └── migrations/       # データベースマイグレーション
└── public/               # 静的ファイル
```

### 🚀 セットアップ

#### 必要環境

- Node.js 18.x 以上
- npm または yarn
- Supabaseアカウント

#### 1. リポジトリをクローン

```bash
git clone https://github.com/yourusername/heavy-chain.git
cd heavy-chain
```

#### 2. 依存関係をインストール

```bash
npm install
```

#### 3. 環境変数を設定

`.env` ファイルをプロジェクトルートに作成：

```env
# Supabase
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Stripe (将来用)
VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
```

#### 4. Supabaseの設定

##### データベーススキーマの適用

1. [Supabase Dashboard](https://app.supabase.com/) にアクセス
2. プロジェクトを選択
3. SQL Editorで `supabase/migrations/001_initial_schema.sql` を実行

##### ストレージバケットの作成

Supabase Dashboard → Storage → New bucket:
- Bucket name: `generated-images`
- Public: `true`

##### Edge Functionsのデプロイ

Supabase CLIをインストール（初回のみ）:

```bash
npm install -g supabase
```

Edge Functionsをデプロイ:

```bash
supabase functions deploy generate-image
supabase functions deploy remove-background
supabase functions deploy upscale
# ... 他の関数も同様にデプロイ
```

Edge Functions用の環境変数をSupabase Dashboardで設定：
- `GEMINI_API_KEY` - Google AI Studio APIキー
- `GEMINI_IMAGE_MODEL` - 使用するモデル名（例: `imagen-3.0-generate-001`）
- `OPENAI_API_KEY` - OpenAI APIキー

#### 5. 開発サーバーを起動

```bash
npm run dev
```

ブラウザで [http://localhost:5173](http://localhost:5173) を開いてください。

### 📜 開発コマンド

```bash
# 開発サーバー起動
npm run dev

# 本番ビルド
npm run build

# ビルド結果をプレビュー
npm run preview

# TypeScript型チェック
npm run typecheck

# ESLintでコード品質チェック
npm run lint
```

### 🎨 こだわったポイント

#### 1. **型安全性の徹底**
- TypeScript 5.9を採用し、型定義を完全に整備
- Supabaseの型定義を自動生成することで、DBとの型の不整合を防止

#### 2. **モダンなアーキテクチャ**
- React 19の最新機能を活用
- Zustandによるシンプルかつ強力な状態管理
- Edge Functionsによるサーバーレス実装

#### 3. **ユーザー体験の最適化**
- Framer Motionによる滑らかなアニメーション
- React Hot Toastによる分かりやすいフィードバック
- レスポンシブ対応（デスクトップ・タブレット・モバイル）

#### 4. **セキュリティ**
- Supabase RLS（Row Level Security）による権限制御
- 環境変数によるAPIキー管理
- XSS/CSRF対策の実装

#### 5. **将来の拡張性**
- CRDT（Yjs）による共同編集機能の実装準備
- モジュール化されたコンポーネント設計
- Edge Functionsによる柔軟な機能追加

### 🗺️ ロードマップ

- [x] Phase 1: MVP - 基本機能実装
- [ ] Phase 2: キャンバスUI実装
- [ ] Phase 3: 派生ツリー・履歴機能
- [ ] Phase 4: リアルタイム共同編集
- [ ] Phase 5: チーム機能・外部連携
- [ ] Phase 6: 高度な編集機能
- [ ] Phase 7: 管理者機能・収益化

### 🤝 貢献

現在、このプロジェクトはプライベートです。

### 📄 ライセンス

Private - All rights reserved

### 👤 作者

Nichika Tanaka

---
---

## English

### 🎯 Overview

Heavy Chain is an **AI-powered image generation platform for fashion brands**, leveraging Gemini and OpenAI APIs. It provides one-stop solutions for marketing, product planning, e-commerce, and editing utilities tailored for the apparel industry.

### ✨ Demo

**🔗 Live Demo**: [Coming Soon]

<!-- Add URL after deployment -->

### 📸 Screenshots

<!-- Add screenshots to /screenshots folder -->

```
Coming Soon - Demo screens will be added
- Dashboard
- Image Generation Interface
- Canvas Editor
- Gallery View
```

### 🎨 Key Features

#### 🚀 Phase 1 (MVP) - Completed

- ✅ **Authentication System** - Email/Google/Apple OAuth
- ✅ **Brand Management** - Multi-brand support
- ✅ **AI Image Generation** - Text-to-Image with Gemini API
- ✅ **Image Gallery** - Browse and manage generated images
- ✅ **Download** - PNG/JPEG/WebP format support
- ✅ **Favorites** - Bookmark important images

#### 🎯 Phase 2+ - Planned

- 🔄 **Infinite Canvas UI** - Figma-like intuitive editing
- 🌳 **Derivation Tree View** - Visualize image generation history
- 👥 **Real-time Collaboration** - Team simultaneous editing
- 🎭 **Color Variations** - Auto-generate multiple variants
- 🏪 **E-commerce Integration** - Shopify/BASE/STORES
- 🌐 **Multilingual** - Japanese/English/Chinese/Korean

### 🛠️ Tech Stack

#### Frontend
- **React 19.2** + **TypeScript 5.9** - Type-safe development
- **Vite** - Lightning-fast build tool
- **Tailwind CSS** - Utility-first CSS framework
- **Zustand** - Simple state management
- **React Router** - SPA routing
- **Framer Motion** - Smooth animations

#### Backend
- **Supabase** - BaaS (Auth, DB, Storage, Edge Functions)
- **PostgreSQL** - Relational database
- **Row Level Security (RLS)** - Secure data access control

#### AI/ML
- **Gemini API** - Image generation
- **OpenAI GPT-4** - Prompt optimization & NLP

#### Canvas & UI
- **Konva.js** + **react-konva** - 2D canvas manipulation
- **React Flow** - Node graph & derivation tree
- **Yjs** - Real-time collaboration (CRDT)

#### Infrastructure
- **Zeabur** - Hosting
- **Stripe** - Payment (future)
- **Lucide React** - Icon set

### 📂 Project Structure

```
heavy-chain/
├── src/
│   ├── components/       # React components
│   │   ├── canvas/       # Canvas-related components
│   │   ├── layout/       # Header, Sidebar, etc.
│   │   ├── ui/           # Reusable UI components
│   │   └── ...           # Feature-specific components
│   ├── pages/            # Page components
│   ├── stores/           # Zustand state management
│   ├── lib/              # Utilities & API setup
│   └── types/            # TypeScript type definitions
├── supabase/
│   ├── functions/        # Edge Functions (12 features)
│   │   ├── generate-image/        # Image generation
│   │   ├── remove-background/     # Background removal
│   │   ├── upscale/              # Upscaling
│   │   ├── colorize/             # Color variations
│   │   └── ...
│   └── migrations/       # Database migrations
└── public/               # Static files
```

### 🚀 Getting Started

#### Prerequisites

- Node.js 18.x or higher
- npm or yarn
- Supabase account

#### 1. Clone the repository

```bash
git clone https://github.com/yourusername/heavy-chain.git
cd heavy-chain
```

#### 2. Install dependencies

```bash
npm install
```

#### 3. Set up environment variables

Create a `.env` file in the project root:

```env
# Supabase
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Stripe (future)
VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
```

#### 4. Configure Supabase

##### Apply database schema

1. Go to [Supabase Dashboard](https://app.supabase.com/)
2. Select your project
3. Run `supabase/migrations/001_initial_schema.sql` in SQL Editor

##### Create storage bucket

Supabase Dashboard → Storage → New bucket:
- Bucket name: `generated-images`
- Public: `true`

##### Deploy Edge Functions

Install Supabase CLI (first time only):

```bash
npm install -g supabase
```

Deploy Edge Functions:

```bash
supabase functions deploy generate-image
supabase functions deploy remove-background
supabase functions deploy upscale
# ... deploy other functions similarly
```

Set environment variables for Edge Functions in Supabase Dashboard:
- `GEMINI_API_KEY` - Google AI Studio API key
- `GEMINI_IMAGE_MODEL` - Model name (e.g., `imagen-3.0-generate-001`)
- `OPENAI_API_KEY` - OpenAI API key

#### 5. Start development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 📜 Available Scripts

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# TypeScript type checking
npm run typecheck

# Lint code with ESLint
npm run lint
```

### 🎨 Technical Highlights

#### 1. **Type Safety**
- Full TypeScript 5.9 implementation
- Auto-generated Supabase types for DB consistency

#### 2. **Modern Architecture**
- React 19 latest features
- Zustand for simple yet powerful state management
- Serverless Edge Functions

#### 3. **User Experience**
- Smooth animations with Framer Motion
- Clear feedback with React Hot Toast
- Responsive design (desktop/tablet/mobile)

#### 4. **Security**
- Supabase RLS for access control
- Environment variables for API keys
- XSS/CSRF protection

#### 5. **Scalability**
- CRDT (Yjs) ready for real-time collaboration
- Modular component architecture
- Flexible Edge Functions for feature additions

### 🗺️ Roadmap

- [x] Phase 1: MVP - Core features
- [ ] Phase 2: Canvas UI
- [ ] Phase 3: Derivation tree & history
- [ ] Phase 4: Real-time collaboration
- [ ] Phase 5: Team features & integrations
- [ ] Phase 6: Advanced editing
- [ ] Phase 7: Admin & monetization

### 🤝 Contributing

This project is currently private.

### 📄 License

Private - All rights reserved

### 👤 Author

Nichika Tanaka

---

Made with ❤️ for the fashion industry
