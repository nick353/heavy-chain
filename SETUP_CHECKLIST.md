# Heavy Chain セットアップチェックリスト

## ✅ Zeabur環境変数（設定済み）
- [x] `VITE_SUPABASE_URL` - SupabaseプロジェクトURL
- [x] `VITE_SUPABASE_ANON_KEY` - Supabase Anonymous Key

---

## 📋 Supabase設定状況を確認

### 1. データベーススキーマ

**確認方法**: 
1. [Supabase Dashboard](https://app.supabase.com/) にログイン
2. プロジェクトを選択
3. 左メニュー → **SQL Editor**
4. 以下のテーブルが存在するか確認：

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE';
```

**必要なテーブル**:
- [ ] `brands` - ブランド情報
- [ ] `users` - ユーザー情報
- [ ] `generated_images` - 生成画像
- [ ] `folders` - フォルダ
- [ ] その他

**未設定の場合**: `supabase/migrations/001_initial_schema.sql` を実行

---

### 2. ストレージバケット

**確認方法**:
1. Supabase Dashboard → 左メニュー → **Storage**
2. 以下のバケットが存在するか確認

**必要なバケット**:
- [ ] `generated-images` (Public: true)
- [ ] `reference-images` (Public: true)
- [ ] `brand-assets` (Public: true)

**未設定の場合**: 
1. Storage → **New bucket**
2. バケット名を入力
3. **Public bucket** にチェック
4. **Create bucket**

---

### 3. Edge Functions デプロイ状況

**確認方法**:
1. Supabase Dashboard → 左メニュー → **Edge Functions**
2. 以下の12個の関数がデプロイされているか確認

**必要な関数**:
- [ ] `generate-image` - テキストから画像生成
- [ ] `product-shots` - 商品の4方向カット生成
- [ ] `model-matrix` - モデル着用画像生成
- [ ] `colorize` - カラーバリエーション生成
- [ ] `design-gacha` - デザインガチャ
- [ ] `remove-background` - 背景削除
- [ ] `upscale` - 画像高解像度化
- [ ] `generate-variations` - バリエーション生成
- [ ] `multilingual-banner` - 多言語バナー生成
- [ ] `optimize-prompt` - プロンプト最適化
- [ ] `share-link` - 共有リンク生成
- [ ] `bulk-download` - 一括ダウンロード

**未設定の場合**:

```bash
# Supabase CLIをインストール（初回のみ）
npm install -g supabase

# Supabaseにログイン
supabase login

# プロジェクトにリンク
supabase link --project-ref your-project-ref

# 全ての関数をデプロイ
cd supabase/functions
supabase functions deploy generate-image
supabase functions deploy product-shots
supabase functions deploy model-matrix
supabase functions deploy colorize
supabase functions deploy design-gacha
supabase functions deploy remove-background
supabase functions deploy upscale
supabase functions deploy generate-variations
supabase functions deploy multilingual-banner
supabase functions deploy optimize-prompt
supabase functions deploy share-link
supabase functions deploy bulk-download
```

または一括デプロイ:
```bash
for func in generate-image product-shots model-matrix colorize design-gacha remove-background upscale generate-variations multilingual-banner optimize-prompt share-link bulk-download; do
  supabase functions deploy $func
done
```

---

### 4. Edge Functions 環境変数

**確認方法**:
1. Supabase Dashboard → **Settings** (左下の歯車アイコン)
2. **Edge Functions** タブをクリック
3. **Environment Variables** セクションを確認

**必要な環境変数**:

#### 🔴 必須（画像生成に必要）
- [ ] `GEMINI_API_KEY` - Google AI Studio APIキー
  - 取得方法: https://aistudio.google.com/app/apikey
  - 例: `AIzaSy...`
  
- [ ] `GEMINI_IMAGE_MODEL` - 使用するGeminiモデル名
  - 推奨値: `imagen-3.0-generate-001`
  - または: `imagen-3.0-fast-generate-001` (高速版)

#### 🟡 推奨（一部機能に必要）
- [ ] `OPENAI_API_KEY` - OpenAI APIキー
  - プロンプト最適化機能で使用
  - 取得方法: https://platform.openai.com/api-keys
  - 例: `sk-...`

#### 🟢 自動設定（通常は不要）
- [x] `SUPABASE_URL` - 自動設定
- [x] `SUPABASE_ANON_KEY` - 自動設定
- [x] `SUPABASE_SERVICE_ROLE_KEY` - 自動設定

**設定方法**:
1. Settings → Edge Functions → **Add new secret**
2. Name: `GEMINI_API_KEY`
3. Value: あなたのAPIキー
4. **Save**
5. 他の環境変数も同様に設定

---

### 5. Row Level Security (RLS) ポリシー

**確認方法**:
1. Supabase Dashboard → **Authentication** → **Policies**
2. 各テーブルにRLSポリシーが設定されているか確認

**必要なポリシー**:
- [ ] `brands` テーブル: ユーザーは自分のブランドのみ読み書き
- [ ] `generated_images` テーブル: ユーザーは自分のブランドの画像のみアクセス
- [ ] `folders` テーブル: ユーザーは自分のフォルダのみ管理

**未設定の場合**: `supabase/migrations/001_initial_schema.sql` にポリシー定義が含まれています

---

## 🧪 テスト手順

### 1. ローカルでテスト

```bash
cd /Users/nichikatanaka/Desktop/アパレル１
npm run dev
```

ブラウザで http://localhost:5173 を開き、コンソール（F12）を確認：

```
✅ 正常な場合:
VITE_SUPABASE_URL: ✅ 設定済み
VITE_SUPABASE_ANON_KEY: ✅ 設定済み

❌ エラーの場合:
❌ Supabase環境変数が設定されていません！
VITE_SUPABASE_URL: ❌ 未設定
VITE_SUPABASE_ANON_KEY: ❌ 未設定
```

### 2. 画像生成テスト

1. Heavy Chainにログイン
2. 「画像生成」ページに移動
3. 「商品カット生成」を選択
4. 商品説明を入力: "白いTシャツ"
5. 「生成」ボタンをクリック
6. ブラウザのコンソールでログを確認:

```
✅ 正常な場合:
🚀 画像生成開始: { feature: 'product-shots', brand: 'xxx', hasReferenceImage: false }
📤 API呼び出し: product-shots
📥 APIレスポンス: { data: {...}, error: null }

❌ エラーの場合:
📥 APIレスポンス: { data: null, error: { message: "..." } }
```

---

## 🐛 よくあるエラーと対処法

### エラー: "Function not found"
**原因**: Edge Functionsがデプロイされていない
**対処**: 上記「3. Edge Functions デプロイ状況」の手順を実行

### エラー: "OpenAI API key not configured"
**原因**: `OPENAI_API_KEY`が設定されていない
**対処**: Settings → Edge Functions → Environment Variablesで設定

### エラー: "Service role key not configured"
**原因**: まれに`SUPABASE_SERVICE_ROLE_KEY`が自動設定されていない
**対処**: SupabaseダッシュボードのSettings → API → service_role keyをコピーして手動設定

### エラー: "Unauthorized"
**原因**: ログインしていない、またはセッションが切れている
**対処**: 再ログイン

### エラー: "Quota exceeded"
**原因**: Gemini APIまたはOpenAI APIの無料枠を超えている
**対処**: 
- Google AI Studioで使用状況を確認
- 有料プランにアップグレード

---

## 📞 サポート

問題が解決しない場合：

1. **ブラウザコンソールのログをスクリーンショット**
2. **Supabase Dashboard → Edge Functions → Logsでエラーを確認**
3. **GitHub Issueを作成** または **サポートに連絡**

必要な情報：
- エラーメッセージ（日本語でOK）
- ブラウザのコンソールログ
- 実行した手順
- Supabase Edge Functionsのログ

