# GitHub公開チェックリスト | GitHub Publishing Checklist

このチェックリストを使って、GitHubリポジトリを公開する前に確認してください。

## 📋 公開前の必須チェック項目

### 🔒 セキュリティ

- [ ] `.env`ファイルが`.gitignore`に含まれている
- [ ] APIキーやパスワードなどの機密情報がコードに含まれていない
- [ ] コミット履歴に機密情報が含まれていない（含まれている場合は、git履歴の書き換えが必要）
- [ ] 環境変数のサンプルファイル(`.env.example`)を作成している

### 📝 ドキュメント

- [ ] **README.md**が充実している
  - [ ] プロジェクト概要
  - [ ] デモURL（デプロイ後）
  - [ ] スクリーンショットまたはGIF
  - [ ] 使用技術スタック
  - [ ] セットアップ手順
  - [ ] こだわったポイント・技術的な工夫
- [ ] ライセンスファイル(`LICENSE`)を追加（または明記）
- [ ] CONTRIBUTINGガイド（オープンソースの場合）

### 🖼️ ビジュアル

- [ ] スクリーンショットを撮影し、`/screenshots`フォルダに配置
- [ ] デモGIFを作成（推奨）
- [ ] README.mdに画像を埋め込み

### 🏷️ リポジトリ設定

- [ ] リポジトリの説明文（Description）を設定
- [ ] トピック（Topics）を追加
  - 例: `react`, `typescript`, `ai`, `supabase`, `vite`, `image-generation`
- [ ] WebサイトURL（About欄）を設定（デプロイ後）
- [ ] 適切なライセンスを選択

### 🧹 コードの整理

- [ ] `node_modules`が`.gitignore`に含まれている
- [ ] 不要なコメントやデバッグコードを削除
- [ ] コミットメッセージが適切（「fix」「あ」などの意味のないメッセージを避ける）
- [ ] Lintエラーがない（`npm run lint`を実行）
- [ ] ビルドが成功する（`npm run build`を実行）

### 🚀 デプロイ

- [ ] アプリケーションがデプロイされている
  - [ ] Vercel / Netlify / Zeabur / Render など
- [ ] デプロイURLがREADME.mdに記載されている
- [ ] デプロイURLがGitHubリポジトリのAbout欄に設定されている
- [ ] デプロイされたアプリが正常に動作する

---

## 🎨 GitHubプロフィールの設定

### プロフィール基本情報

- [ ] プロフィール画像を設定（デフォルトアイコンではなく）
- [ ] Bio（自己紹介）を記載
- [ ] ロケーション（任意）
- [ ] WebサイトURL（任意）

### Pinned Repositories（ピン留め）

- [ ] 自信のあるリポジトリを6つまでピン留め
- [ ] Heavy Chainをピン留めの一つに設定

### プロフィールREADME

- [ ] ユーザー名と同じ名前のリポジトリを作成
  - 例: ユーザー名が`john-doe`なら、`john-doe/john-doe`リポジトリ
- [ ] `PROFILE_README_TEMPLATE.md`を参考にプロフィールREADMEを作成
- [ ] スキルセット・技術スタックを記載
- [ ] 注目プロジェクトをリンク
- [ ] 連絡先情報を追加

---

## 📤 公開手順

### 1. ローカルでの最終確認

```bash
# 未追跡ファイルの確認
git status

# ビルドテスト
npm run build

# Lintチェック
npm run lint

# 型チェック
npm run typecheck
```

### 2. リポジトリの作成

1. GitHubにアクセス: https://github.com/new
2. リポジトリ名を入力（例: `heavy-chain`）
3. 説明文を入力
4. Public を選択
5. README、.gitignore、ライセンスは既にあるので追加しない
6. "Create repository"をクリック

### 3. ローカルリポジトリをプッシュ

```bash
# リモートリポジトリを追加（初回のみ）
git remote add origin https://github.com/[あなたのユーザー名]/heavy-chain.git

# ブランチ名を確認・変更（必要に応じて）
git branch -M main

# プッシュ
git push -u origin main
```

### 4. GitHubリポジトリの設定

1. リポジトリページにアクセス
2. **About**（画面右上）をクリックして編集
   - Description: プロジェクトの説明
   - Website: デプロイURL
   - Topics: `react`, `typescript`, `ai`, `supabase`, `image-generation`, `fashion`
3. **Settings** → **Options**
   - Features: Issues, Discussions（必要に応じて）

### 5. デプロイ

#### Vercel（推奨）

```bash
# Vercel CLIをインストール
npm install -g vercel

# デプロイ
vercel

# 本番環境にデプロイ
vercel --prod
```

#### Netlify

1. [Netlify](https://www.netlify.com/)にログイン
2. "Add new site" → "Import an existing project"
3. GitHubリポジトリを選択
4. Build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
5. 環境変数を設定
6. Deploy

#### Zeabur（現在の設定）

1. [Zeabur](https://zeabur.com/)にログイン
2. "New Project"をクリック
3. GitHubリポジトリを接続
4. 環境変数を設定
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy

### 6. デプロイ後の設定

- [ ] デプロイURLをREADME.mdに追加
- [ ] デプロイURLをGitHub About欄に追加
- [ ] デプロイされたアプリをテスト

---

## 🎯 ポートフォリオとして見せる際のポイント

### 採用担当者向け

1. **README.mdの充実度が最重要**
   - 何ができるアプリか一目で分かる
   - 技術的な工夫を明確に記載
   - セットアップ手順が明確

2. **デモサイトは必須**
   - 「動くもの」を見せることが最も説得力がある
   - ローカル環境構築は相手に負担をかける

3. **コードの品質**
   - 適切なコメント
   - 一貫したコーディングスタイル
   - TypeScriptの型定義

4. **コミット履歴**
   - 意味のあるコミットメッセージ
   - 論理的な変更単位

### エンジニア仲間向け

1. **技術選定の理由**
   - なぜその技術を選んだか
   - どのような課題を解決したか

2. **アーキテクチャ**
   - 設計思想
   - ディレクトリ構造の意図

3. **今後の展望**
   - ロードマップ
   - 改善点

---

## ✅ 公開完了後のチェック

- [ ] GitHubリポジトリが正常に表示される
- [ ] README.mdの画像が正しく表示される
- [ ] デプロイサイトが正常に動作する
- [ ] GitHubプロフィールにピン留めされている
- [ ] GitHubプロフィールREADMEが表示される
- [ ] SNSやポートフォリオサイトにリンクを追加

---

## 📞 共有方法

### URL共有

```
GitHub: https://github.com/[あなたのユーザー名]/heavy-chain
Demo: https://heavy-chain.vercel.app (デプロイURLに変更)
```

### メール文例（日本語）

```
件名: ポートフォリオのご共有

お世話になっております、[あなたの名前]です。

私が開発したWebアプリケーション「Heavy Chain」をご紹介させていただきます。

■ プロジェクト概要
AI駆動のアパレル向け画像生成プラットフォームです。
Gemini APIとOpenAI GPT-4を活用し、マーケティング画像の生成から
編集までを一貫して行えるSaaSアプリケーションを開発しました。

■ デモサイト
https://heavy-chain.vercel.app

■ GitHubリポジトリ
https://github.com/[あなたのユーザー名]/heavy-chain

■ 主な技術スタック
- フロントエンド: React 19, TypeScript, Tailwind CSS
- バックエンド: Supabase (PostgreSQL, Edge Functions)
- AI: Gemini API, OpenAI GPT-4
- その他: Zustand, React Flow, Konva.js

■ こだわったポイント
- TypeScriptによる型安全な開発
- リアルタイム共同編集機能（CRDT）
- セキュアな認証・権限管理
- モダンなUIデザイン

ご確認いただけますと幸いです。
何かご質問等ございましたら、お気軽にお問い合わせください。

よろしくお願いいたします。
```

### メール文例（English）

```
Subject: Portfolio Project - Heavy Chain

Dear [Recipient's Name],

I would like to introduce my web application project "Heavy Chain."

■ Project Overview
Heavy Chain is an AI-powered image generation platform for fashion brands.
It leverages Gemini API and OpenAI GPT-4 to provide end-to-end solutions
for marketing image generation and editing.

■ Live Demo
https://heavy-chain.vercel.app

■ GitHub Repository
https://github.com/[your-username]/heavy-chain

■ Tech Stack
- Frontend: React 19, TypeScript, Tailwind CSS
- Backend: Supabase (PostgreSQL, Edge Functions)
- AI: Gemini API, OpenAI GPT-4
- Others: Zustand, React Flow, Konva.js

■ Key Features
- Type-safe development with TypeScript
- Real-time collaboration (CRDT)
- Secure authentication & authorization
- Modern UI design

I would appreciate it if you could take a look.
Please feel free to contact me if you have any questions.

Best regards,
[Your Name]
```

---

## 🎉 おめでとうございます！

これで、あなたのプロジェクトはプロフェッショナルなポートフォリオとして
GitHubで公開する準備が整いました！

次のステップ:
1. スクリーンショットを撮影
2. アプリをデプロイ
3. README.mdにデモURLを追加
4. GitHubにプッシュ
5. プロフィールREADMEを作成
6. 世界に共有！🚀

