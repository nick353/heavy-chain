# 🎯 重要：次にやるべきこと

## 画像が生成されない原因が判明しました

### 確認された状態:

✅ **Zeabur環境変数** → 設定済み  
❌ **Supabase Edge Functions** → 確認が必要  
❌ **GEMINI_API_KEY** → 確認が必要

---

## 📋 今すぐ確認してください（3ステップ）

### ステップ1: Edge Functionsの確認

1. https://app.supabase.com/ にアクセス
2. プロジェクトを選択
3. 左メニューの **Edge Functions** をクリック
4. 画面に12個の関数が表示されているか確認：
   - generate-image
   - product-shots
   - model-matrix
   - colorize
   - design-gacha
   - remove-background
   - upscale
   - generate-variations
   - multilingual-banner
   - optimize-prompt
   - share-link
   - bulk-download

**結果:**
- [ ] すべて表示されている（12個）
- [ ] 一部のみ表示されている（〇個）
- [ ] 何も表示されていない（0個）

---

### ステップ2: GEMINI_API_KEYの確認

1. Supabase Dashboard で左下の **⚙️ Settings** をクリック
2. **Edge Functions** タブをクリック
3. **Environment Variables** セクションを確認
4. `GEMINI_API_KEY` という変数が存在するか確認

**結果:**
- [ ] GEMINI_API_KEY が設定されている
- [ ] GEMINI_API_KEY が設定されていない

---

### ステップ3: GEMINI_IMAGE_MODELの確認

同じ画面で `GEMINI_IMAGE_MODEL` が設定されているか確認

**結果:**
- [ ] GEMINI_IMAGE_MODEL が設定されている
- [ ] GEMINI_IMAGE_MODEL が設定されていない

---

## 🚨 対処方法（結果に応じて）

### パターンA: Edge Functionsが0個または一部のみ

**対処法:** Edge Functionsをデプロイする

```bash
# ターミナルで実行
cd /Users/nichikatanaka/Desktop/アパレル１

# Supabase CLIをインストール（未インストールの場合）
npm install -g supabase

# Supabaseにログイン
supabase login

# プロジェクトにリンク（Project Refは Dashboard の Settings → General → Reference ID）
supabase link --project-ref YOUR_PROJECT_REF

# 全関数をデプロイ
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

---

### パターンB: GEMINI_API_KEYが未設定

**対処法:** Gemini APIキーを取得して設定

1. **APIキーを取得:**
   - https://aistudio.google.com/app/apikey にアクセス
   - Googleアカウントでログイン
   - **Create API Key** をクリック
   - 生成されたキー（`AIzaSy...`で始まる）をコピー

2. **Supabaseに設定:**
   - Supabase Dashboard → Settings → Edge Functions → Environment Variables
   - **Add new secret** をクリック
   - Name: `GEMINI_API_KEY`
   - Value: コピーしたAPIキーを貼り付け
   - **Save** をクリック

3. **モデル名も設定:**
   - もう一度 **Add new secret** をクリック
   - Name: `GEMINI_IMAGE_MODEL`
   - Value: `imagen-3.0-generate-001`
   - **Save** をクリック

---

### パターンC: すべて設定済みだが画像が生成されない

**対処法:** データベースとストレージを確認

1. **データベース確認:**
   - Supabase Dashboard → SQL Editor
   - 以下を実行:
   ```sql
   SELECT table_name FROM information_schema.tables 
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
   ```
   - `brands`, `generated_images`, `folders` が表示されるか確認
   - 表示されない場合: `supabase/migrations/001_initial_schema.sql` を実行

2. **ストレージ確認:**
   - Supabase Dashboard → Storage
   - `generated-images` バケットが存在するか確認
   - 存在しない場合: **New bucket** → 名前: `generated-images` → Public: ✓ → Create

---

## 📝 確認結果を教えてください

上記のステップ1〜3を確認して、以下の情報を教えてください：

1. Edge Functions: 〇個表示されている
2. GEMINI_API_KEY: 設定されている / されていない
3. GEMINI_IMAGE_MODEL: 設定されている / されていない

この情報があれば、次に何をすべきか正確にお伝えできます！

---

## 💡 クイックテスト

設定後、すぐにテストする方法：

1. https://heavy-chain.zeabur.app にアクセス
2. F12キーを押す（デベロッパーツールを開く）
3. **Console** タブに切り替え
4. 画像生成を試す
5. コンソールに以下のようなログが表示されるか確認：

```
🚀 画像生成開始: { feature: 'product-shots', ... }
📤 API呼び出し: product-shots
📥 APIレスポンス: { data: {...}, error: null }
```

エラーがある場合、詳細なエラーメッセージが表示されます。

