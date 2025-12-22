# 🚀 残り4個のEdge Functionsをデプロイする手順

## 📋 デプロイが必要な関数（4個）

1. **colorize** - カラーバリエーション生成
2. **remove-background** - 背景削除
3. **share-link** - 共有リンク生成
4. **bulk-download** - 一括ダウンロード

---

## 🔧 デプロイ手順（2つの方法）

### 方法A: ターミナルでデプロイ（推奨）

#### ステップ1: Supabaseにログイン

```bash
cd /Users/nichikatanaka/Desktop/アパレル１
supabase login
```

ブラウザが開くので、Supabaseアカウントでログインしてください。

---

#### ステップ2: プロジェクトをリンク

まず、**Project Reference ID**を取得します：

1. Supabase Dashboard (https://app.supabase.com/) を開く
2. プロジェクトを選択
3. 左下の **⚙️ Settings** をクリック
4. **General** タブ
5. **Reference ID** をコピー（例: `abcdefghijklmnop`）

次に、ターミナルで：

```bash
# YOUR_PROJECT_REF の部分を、コピーしたReference IDに置き換えてください
supabase link --project-ref YOUR_PROJECT_REF
```

例：
```bash
supabase link --project-ref ulfbddqwumeoqidxatyq
```

---

#### ステップ3: 残り4個をデプロイ

```bash
cd supabase/functions

# 1個ずつデプロイ
supabase functions deploy colorize
supabase functions deploy remove-background
supabase functions deploy share-link
supabase functions deploy bulk-download
```

各コマンドで以下のような出力が表示されれば成功です：
```
Deploying colorize (project ref: ...)
✔ Function deployed successfully
```

---

### 方法B: Supabase Dashboardから手動デプロイ

もしターミナルでうまくいかない場合：

1. Supabase Dashboard → **Edge Functions**
2. 右上の **「Deploy a new function」** をクリック
3. 各関数について：
   - Function name: `colorize` など
   - Function code: `/Users/nichikatanaka/Desktop/アパレル１/supabase/functions/colorize/index.ts` の内容をコピー&ペースト
   - Deploy をクリック
4. 4個すべて繰り返す

---

## 🧪 デプロイ確認

### ターミナルで確認：

```bash
supabase functions list
```

12個すべて表示されればOK！

### Dashboardで確認：

Supabase Dashboard → Edge Functions

12個すべて表示されていることを確認：
- [x] bulk-download
- [x] colorize
- [x] design-gacha
- [x] generate-image
- [x] generate-variations
- [x] model-matrix
- [x] multilingual-banner
- [x] optimize-prompt
- [x] product-shots
- [x] remove-background
- [x] share-link
- [x] upscale

---

## ⚡ クイックコマンド（全部まとめて）

Project Reference IDを取得したら、以下を一気に実行できます：

```bash
# 作業ディレクトリに移動
cd /Users/nichikatanaka/Desktop/アパレル１

# ログイン（初回のみ）
supabase login

# プロジェクトにリンク（YOUR_PROJECT_REFを実際のIDに置き換え）
supabase link --project-ref YOUR_PROJECT_REF

# 関数ディレクトリに移動
cd supabase/functions

# 残り4個を一気にデプロイ
supabase functions deploy colorize && \
supabase functions deploy remove-background && \
supabase functions deploy share-link && \
supabase functions deploy bulk-download

# 確認
supabase functions list
```

---

## 💡 トラブルシューティング

### エラー1: "Missing required field in config: project_id"
**原因**: プロジェクトがリンクされていない  
**対処**: ステップ2を実行してプロジェクトをリンク

### エラー2: "Not logged in"
**原因**: Supabaseにログインしていない  
**対処**: `supabase login` を実行

### エラー3: "Permission denied"
**原因**: アクセス権限がない  
**対処**: Supabaseプロジェクトのオーナーまたは管理者であることを確認

### エラー4: "Function already exists"
**原因**: すでにデプロイされている（これはOK）  
**対処**: そのまま次の関数へ進む

---

## 🎯 デプロイ後にやること

### 1. GEMINI_IMAGE_MODELを設定（まだの場合）

Supabase Dashboard → Settings → Edge Functions → Environment Variables

- Name: `GEMINI_IMAGE_MODEL`
- Value: `imagen-3.0-generate-001`

### 2. 画像生成をテスト

https://heavy-chain.zeabur.app にアクセスして、各機能をテスト：

- [ ] 画像生成（テキストから）
- [ ] 商品カット生成
- [ ] カラーバリエーション（新規デプロイ）
- [ ] 背景削除（新規デプロイ）
- [ ] モデル着用画像
- [ ] デザインガチャ
- [ ] プロンプト最適化

---

## ✅ 完了チェックリスト

- [ ] Supabaseにログイン完了
- [ ] プロジェクトをリンク完了
- [ ] colorize デプロイ完了
- [ ] remove-background デプロイ完了
- [ ] share-link デプロイ完了
- [ ] bulk-download デプロイ完了
- [ ] Edge Functions: 12個すべて表示されることを確認
- [ ] GEMINI_IMAGE_MODEL 設定完了
- [ ] 画像生成テスト成功

---

## 📞 サポート

デプロイ中にエラーが出たら、以下を教えてください：

1. 実行したコマンド
2. 表示されたエラーメッセージ（全文）
3. どのステップで詰まったか

具体的な対処法をお伝えします！

---

**頑張ってください！全機能が使えるようになります！** 🚀

