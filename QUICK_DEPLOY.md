# ⚡ 5分で完了！残り4個のデプロイ

## 📝 必要な情報

デプロイする前に、以下を準備してください：

### Supabase Project Reference ID

1. https://app.supabase.com/ を開く
2. プロジェクトを選択
3. Settings (⚙️) → General
4. **Reference ID** をコピー

例: `ulfbddqwumeoqidxatyq`

---

## 🚀 ターミナルでコピペ実行（5分）

以下をターミナルで実行してください。**YOUR_PROJECT_REF** の部分だけ、先ほどコピーしたIDに置き換えてください。

### ステップ1: ログイン

```bash
cd /Users/nichikatanaka/Desktop/アパレル１
supabase login
```

→ ブラウザが開きます。ログインしてください。

---

### ステップ2: プロジェクトにリンク

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

**重要**: `YOUR_PROJECT_REF` を実際のIDに置き換えてください！

例:
```bash
supabase link --project-ref ulfbddqwumeoqidxatyq
```

---

### ステップ3: デプロイ（4個）

```bash
cd supabase/functions
supabase functions deploy colorize
supabase functions deploy remove-background
supabase functions deploy share-link
supabase functions deploy bulk-download
```

各コマンドで「✔ Function deployed successfully」と表示されれば成功です。

---

## ✅ 確認

```bash
supabase functions list
```

**12個すべて**が表示されればOK！

---

## 🎯 次にやること

### 1. GEMINI_IMAGE_MODELを設定（まだの場合）

Supabase Dashboard で：
- Settings → Edge Functions → Environment Variables
- Add new secret
  - Name: `GEMINI_IMAGE_MODEL`
  - Value: `imagen-3.0-generate-001`
- Save

### 2. テスト

https://heavy-chain.zeabur.app にアクセスして画像生成を試す

---

## ❓ エラーが出たら

### "Not logged in"
→ `supabase login` をもう一度実行

### "Missing required field"
→ Project Reference IDが間違っている。もう一度コピーして確認

### "Permission denied"
→ Supabaseプロジェクトの管理者権限があるか確認

---

**これで全12個の機能が使えます！** 🎉

実行したら結果を教えてください！

