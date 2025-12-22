# 🔍 エラー診断：Edge Functionログの確認方法

## ❌ 現在のエラー
```
商品ページ標準カットの生成に失敗しました: Edge Function returned a non-2xx status code
```

このエラーは、`product-shots`関数が正常に動作していないことを示しています。

---

## 🔧 診断ステップ

### ステップ1: Edge Functionのログを確認

Supabase Dashboardでログを確認します：

👉 **https://supabase.com/dashboard/project/ulfbddqwumeoqidxatyq/logs/edge-functions**

#### 確認方法：
1. 上記リンクを開く
2. 左側メニューから **Edge Functions** を選択
3. **`product-shots`** を選択
4. 最新のログを確認

#### 確認するポイント：
- ❌ `Gemini API key not configured` → APIキーが読み込めていない
- ❌ `Failed to fetch` → Gemini APIへの接続に失敗
- ❌ `Error: ...` → その他のエラーメッセージ

---

### ステップ2: クイック診断（CLI）

ターミナルで直接ログを確認できます：

```bash
cd /Users/nichikatanaka/Desktop/アパレル１
export SUPABASE_ACCESS_TOKEN="sbp_257c591725f8def68c6316c5859a76c31845979c"
supabase functions logs product-shots --limit 20
```

---

## 🔍 考えられる原因と対策

### 原因1: Gemini APIキーが読み込めていない

**確認:**
```bash
supabase secrets list
```

**対策:**
`GEMINI_API_KEY`が正しく設定されているか確認

---

### 原因2: 関数のデプロイが反映されていない

**確認:**
```bash
supabase functions list
```

**対策:**
`product-shots`が最新バージョン（v6以上）になっているか確認

現在の状態から、再デプロイが必要かもしれません：
```bash
cd supabase/functions
supabase functions deploy product-shots
```

---

### 原因3: Gemini APIのリクエスト形式が間違っている

**対策:**
修正したコードに問題がある可能性があります。エラーログを見て、Gemini APIのエラーメッセージを確認してください。

---

## 🚀 今すぐできること

### オプションA: ログを確認する（推奨）

1. https://supabase.com/dashboard/project/ulfbddqwumeoqidxatyq/logs/edge-functions
2. `product-shots`のログを確認
3. エラーメッセージをそのまま教えてください

### オプションB: CLIでログ確認

ターミナルで以下を実行してください：

```bash
cd /Users/nichikatanaka/Desktop/アパレル１
export SUPABASE_ACCESS_TOKEN="sbp_257c591725f8def68c6316c5859a76c31845979c"
supabase functions logs product-shots --limit 20
```

実行結果を教えてください。

---

## 💡 別の可能性

### Zeaburのフロントエンドが古いバージョン

Zeaburにデプロイされているフロントエンドが、まだ古いエンドポイントを呼んでいる可能性があります。

確認：ブラウザのキャッシュをクリアして、再度試してください：
- Chrome: `Ctrl+Shift+Delete` → キャッシュをクリア
- または、シークレットウィンドウで開く

---

**まずはログを確認して、具体的なエラーメッセージを教えてください！**

