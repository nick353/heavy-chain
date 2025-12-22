# 🔧 エラー解決：環境変数の設定

## ❌ 現在のエラー
```
商品ページ標準カットの生成に失敗しました: Edge Function returned a non-2xx status code
```

## 🔍 原因
`product-shots`関数は**OpenAI API (DALL-E 3)**を使用していますが、必要な環境変数が設定されていません。

---

## ✅ 解決方法：環境変数を設定する

### 必要な環境変数（3つ）

Supabase Dashboard → Settings → Edge Functions → Environment Variables で設定：

👉 **https://supabase.com/dashboard/project/ulfbddqwumeoqidxatyq/settings/functions**

---

### 1️⃣ SUPABASE_URL

**Name:**
```
SUPABASE_URL
```

**Value:** （Zeaburで設定した値と同じ）
```
https://ulfbddqwumeoqidxatyq.supabase.co
```

取得方法：
- Supabase Dashboard → Settings → API → Project URL

---

### 2️⃣ SUPABASE_ANON_KEY

**Name:**
```
SUPABASE_ANON_KEY
```

**Value:** （Zeaburで設定した値と同じ）

取得方法：
- Supabase Dashboard → Settings → API → `anon` `public` key
- 「Reveal」をクリックしてコピー

---

### 3️⃣ OPENAI_API_KEY（必須）

**Name:**
```
OPENAI_API_KEY
```

**Value:**
```
sk-proj-... （OpenAIのAPIキー）
```

取得方法：
- https://platform.openai.com/api-keys
- 「Create new secret key」でキーを作成
- コピーして保存（一度しか表示されません）

⚠️ **注意**: OpenAI APIは有料です。DALL-E 3は1枚あたり約$0.08かかります。

---

### 4️⃣ GEMINI_IMAGE_MODEL（オプション、Geminiを使う場合）

**Name:**
```
GEMINI_IMAGE_MODEL
```

**Value:**
```
imagen-3.0-generate-001
```

---

### 5️⃣ GEMINI_API_KEY（オプション、Geminiを使う場合）

すでに設定済みであることを確認してください。

---

## 🔄 代替案：Gemini APIを使うように変更

OpenAI APIを使いたくない場合、`product-shots`関数をGemini APIを使うように変更できます。

### どちらを使いますか？

#### オプションA: OpenAI (DALL-E 3)を使う
- ✅ 高品質な商品画像
- ❌ 有料（1枚 $0.08）
- 👉 `OPENAI_API_KEY` を設定

#### オプションB: Gemini (Imagen 3.0)を使う
- ✅ Googleの画像生成AI
- ✅ 無料枠あり
- 👉 コードを修正（私が対応できます）

---

## 🚀 クイック設定（5分）

### ステップ1: Supabase環境変数を設定

1. https://supabase.com/dashboard/project/ulfbddqwumeoqidxatyq/settings/functions
2. **Add new secret** を3回クリックして以下を追加：

```
Name:  SUPABASE_URL
Value: https://ulfbddqwumeoqidxatyq.supabase.co

Name:  SUPABASE_ANON_KEY
Value: （Supabase Dashboard → Settings → API → anon key）

Name:  OPENAI_API_KEY
Value: （OpenAI Platform → API Keys → 新規作成）
```

### ステップ2: OpenAI APIキーを取得

1. https://platform.openai.com/api-keys
2. 「Create new secret key」
3. 名前: `heavy-chain`
4. キーをコピー

### ステップ3: 環境変数に設定

Supabaseに戻って、`OPENAI_API_KEY`の値として貼り付け

### ステップ4: テスト

https://heavy-chain.zeabur.app で再度画像生成を試す

---

## 💡 推奨：Gemini APIに切り替え

OpenAI APIの費用が気になる場合、すべての関数をGemini APIに統一することをお勧めします。

### メリット
- ✅ 無料枠が大きい
- ✅ すでに`GEMINI_API_KEY`は設定済み
- ✅ コストを削減

### 切り替えたい場合

「Gemini APIに切り替えたい」と教えてください。コードを修正します！

---

## ❓ 次のステップ

どちらを選びますか？

1. **OpenAI APIキーを設定する** → 上記の手順で設定
2. **Gemini APIに切り替える** → コードを修正します

教えてください！

