# Heavy Chain 設定状況レポート

**日時**: 2025年12月22日  
**確認方法**: ローカル開発サーバー (http://localhost:5173)

---

## 📊 現在の状況

### ❌ ローカル開発環境

#### 環境変数の状態:
```
❌ VITE_SUPABASE_URL: 未設定
❌ VITE_SUPABASE_ANON_KEY: 未設定
```

**確認された問題:**
- `.env` ファイルが存在しない（`.env.example`のみ）
- そのため、Supabaseクライアントが初期化できない
- 画像生成などのSupabase機能が動作しない

---

## ✅ Zeabur本番環境

**ユーザー報告によると:**
- Zeaburの環境変数は設定済み
- `VITE_SUPABASE_URL` ✅ 設定済み
- `VITE_SUPABASE_ANON_KEY` ✅ 設定済み

**これは正しい状態です。**

---

## 🔍 問題の原因

### なぜ画像が生成されないのか？

Zeaburの環境変数は設定済みとのことですが、画像が生成されない場合、以下のいずれかが原因です：

### 1. **Supabase Edge Functionsが未デプロイ** 🔴 最も可能性が高い

必要な12個のEdge Functionsがデプロイされていない可能性があります：

```bash
必要な関数:
- generate-image          # テキストから画像生成
- product-shots          # 商品カット生成
- model-matrix           # モデル着用画像
- colorize              # カラーバリエーション
- design-gacha          # デザインガチャ
- remove-background     # 背景削除
- upscale              # 高解像度化
- generate-variations   # バリエーション生成
- multilingual-banner   # 多言語バナー
- optimize-prompt       # プロンプト最適化
- share-link           # 共有リンク
- bulk-download        # 一括ダウンロード
```

**確認方法:**
1. Supabase Dashboard (https://app.supabase.com/) にログイン
2. プロジェクトを選択
3. 左メニュー → **Edge Functions**
4. 上記12個の関数がリストに表示されているか確認

### 2. **Edge Functions用の環境変数が未設定** 🔴 最も重要

Edge Functionsがデプロイされていても、必要なAPIキーが設定されていないと画像生成できません：

#### 必須の環境変数:

```bash
GEMINI_API_KEY           # Google AI Studio APIキー（必須）
GEMINI_IMAGE_MODEL       # 推奨: imagen-3.0-generate-001
```

#### 推奨の環境変数:

```bash
OPENAI_API_KEY           # プロンプト最適化用（一部機能で使用）
```

**確認方法:**
1. Supabase Dashboard → **Settings** (左下の歯車アイコン)
2. **Edge Functions** タブ
3. **Environment Variables** セクション
4. 上記の環境変数が設定されているか確認

**設定方法:**
1. **Add new secret** をクリック
2. Name: `GEMINI_API_KEY`
3. Value: あなたのGemini APIキー
4. **Save**

**Gemini APIキーの取得方法:**
- https://aistudio.google.com/app/apikey にアクセス
- Google アカウントでログイン
- **Create API Key** をクリック
- 生成されたキー（`AIzaSy...`で始まる）をコピー

### 3. **データベーススキーマが未適用**

必要なテーブル（brands, generated_images, foldersなど）が作成されていない可能性があります。

**確認方法:**
1. Supabase Dashboard → **SQL Editor**
2. 以下のSQLを実行:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE';
```

3. `brands`, `generated_images`, `folders` などが表示されるか確認

**未設定の場合:**
- SQL Editorで `supabase/migrations/001_initial_schema.sql` の内容をコピー&実行

### 4. **ストレージバケットが未作成**

画像を保存するバケットが作成されていない可能性があります。

**確認方法:**
1. Supabase Dashboard → **Storage**
2. 以下のバケットが存在するか確認:
   - `generated-images` (Public: true)
   - `reference-images` (Public: true)
   - `brand-assets` (Public: true)

**未設定の場合:**
1. Storage → **New bucket**
2. Bucket name: `generated-images`
3. **Public bucket** にチェック ✓
4. **Create bucket**
5. 他のバケットも同様に作成

---

## 🎯 優先度別の対処手順

### 🔴 最優先（これがないと動きません）

1. **Edge Functionsをデプロイ**
   ```bash
   # Supabase CLIをインストール
   npm install -g supabase
   
   # Supabaseにログイン
   supabase login
   
   # プロジェクトにリンク
   supabase link --project-ref your-project-ref
   
   # 全関数をデプロイ
   cd supabase/functions
   for func in generate-image product-shots model-matrix colorize design-gacha remove-background upscale generate-variations multilingual-banner optimize-prompt share-link bulk-download; do
     supabase functions deploy $func
   done
   ```

2. **GEMINI_API_KEYを設定**
   - Supabase Dashboard → Settings → Edge Functions → Environment Variables
   - Add new secret:
     - Name: `GEMINI_API_KEY`
     - Value: `AIzaSy...` (あなたのAPIキー)
   - Add new secret:
     - Name: `GEMINI_IMAGE_MODEL`
     - Value: `imagen-3.0-generate-001`

### 🟡 推奨

3. **データベーススキーマを適用**
   - SQL Editorで `001_initial_schema.sql` を実行

4. **ストレージバケットを作成**
   - `generated-images`, `reference-images`, `brand-assets` を作成

5. **OPENAI_API_KEYを設定**（プロンプト最適化機能用）
   - Supabase Dashboard → Settings → Edge Functions → Environment Variables
   - Add new secret:
     - Name: `OPENAI_API_KEY`
     - Value: `sk-...` (あなたのAPIキー)

---

## 🧪 テスト方法

設定後、Zeaburにデプロイされたアプリで：

1. ブラウザで https://heavy-chain.zeabur.app を開く
2. F12キーでデベロッパーツールを開く
3. Consoleタブに切り替え
4. 画像生成を試す
5. 以下のログを確認:

```
✅ 正常な場合:
🚀 画像生成開始: { feature: 'product-shots', ... }
📤 API呼び出し: product-shots
📥 APIレスポンス: { data: {...}, error: null }

❌ エラーの場合:
📥 APIレスポンス: { data: null, error: { message: "..." } }
```

---

## 📞 次のアクション

### 今すぐ確認すべきこと:

1. **Supabase Dashboard にログイン** → https://app.supabase.com/
2. **Edge Functions ページを開く** → 12個の関数が表示されているか？
3. **Settings → Edge Functions → Environment Variables** → GEMINI_API_KEYが設定されているか？

この3点を確認して、結果を教えてください。
その結果に応じて、具体的な対処法をお伝えします。

---

## 📝 補足：ローカル開発環境の設定

ローカルでテストしたい場合:

1. `.env` ファイルを作成:
```bash
cd /Users/nichikatanaka/Desktop/アパレル１
cat > .env << 'EOF'
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
EOF
```

2. 開発サーバーを再起動:
```bash
npm run dev
```

ただし、**Zeaburは設定済み**とのことなので、本番環境（Zeabur）の問題解決を優先すべきです。

