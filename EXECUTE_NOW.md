# 🎯 今すぐ実行：残り4個のデプロイコマンド

## 📋 準備

### 1. Supabase Project Reference ID を取得

今開いているSupabaseの画面で：
1. 左下の **⚙️ Settings** をクリック
2. **General** タブ（最初から開いているはず）
3. 下にスクロールして **Reference ID** を探す
4. コピーボタンをクリックしてコピー

または、URLから確認：
- URL: `https://app.supabase.com/project/ulfbddqwumeoqidxatyq/...`
- この場合、Reference IDは `ulfbddqwumeoqidxatyq`

---

## 🚀 実行コマンド

Reference IDを取得したら、以下のコマンドをターミナルで実行してください。

### コマンド1: ログイン

```bash
cd /Users/nichikatanaka/Desktop/アパレル１
supabase login
```

**何が起こる**: ブラウザが開きます → Supabaseにログイン → ターミナルに戻って続行

---

### コマンド2: プロジェクトにリンク

**⚠️ 重要**: `YOUR_PROJECT_REF` を実際のReference IDに置き換えてください

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

**実際の例**（あなたの場合、おそらく）:
```bash
supabase link --project-ref ulfbddqwumeoqidxatyq
```

**何が起こる**: プロジェクトに接続されます

---

### コマンド3: 残り4個をデプロイ

```bash
cd supabase/functions
supabase functions deploy colorize
```

**何が起こる**: 
```
Deploying colorize...
✔ Function deployed successfully
```

続けて：

```bash
supabase functions deploy remove-background
```

```bash
supabase functions deploy share-link
```

```bash
supabase functions deploy bulk-download
```

---

### コマンド4: 確認

```bash
supabase functions list
```

**期待される結果**: 12個の関数が表示される
```
bulk-download
colorize            ← 新規
design-gacha
generate-image
generate-variations
model-matrix
multilingual-banner
optimize-prompt
product-shots
remove-background   ← 新規
share-link          ← 新規
upscale
```

---

## ✅ 成功した場合

全部デプロイできたら：

1. **GEMINI_IMAGE_MODELを設定**（まだの場合）
   - Supabase Dashboard
   - Settings → Edge Functions → Environment Variables
   - Add new secret: `GEMINI_IMAGE_MODEL` = `imagen-3.0-generate-001`

2. **テスト**
   - https://heavy-chain.zeabur.app
   - 画像生成を試す

---

## ❌ エラーが出た場合

エラーメッセージをそのままコピーして教えてください。対処法をお伝えします。

---

## 💡 ヒント

- コマンドは1行ずつコピー&ペーストして実行
- エラーが出たら次に進まず、エラー内容を確認
- Reference IDのコピーミスが最も多いエラーの原因

---

**準備ができたら、上から順に実行してください！** 🚀

実行したら結果を教えてください：
- ✅ 成功：12個すべてデプロイできた
- ❌ エラー：「〇〇〇」というエラーが出た

