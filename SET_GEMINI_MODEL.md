# 🎯 GEMINI_IMAGE_MODEL 設定手順

## 現在の状況
- ✅ Edge Functions: 8個デプロイ済み（基本機能は揃っています）
- ✅ GEMINI_API_KEY: 設定済み
- ❌ GEMINI_IMAGE_MODEL: 未設定 ← **これを設定します**

---

## 📝 設定手順（3ステップ）

### ステップ1: Environment Variables 画面で
今開いている画面（Supabase Dashboard → Settings → Edge Functions → Environment Variables）で、

**「Add new secret」** ボタンをクリック

---

### ステップ2: 以下を入力

```
Name (環境変数名):
GEMINI_IMAGE_MODEL

Value (値):
imagen-3.0-generate-001
```

**重要**: 
- スペルミスに注意！
- `imagen-3.0-generate-001` をそのままコピー&ペースト推奨

---

### ステップ3: 保存

**「Save」** または **「Create secret」** ボタンをクリック

✅ 完了！

---

## 🧪 テスト方法

設定後、すぐにテストできます：

### 1. Heavy Chainにアクセス
https://heavy-chain.zeabur.app

### 2. ログイン
アカウントにログイン

### 3. 画像生成ページに移動
左メニュー → 「画像生成」

### 4. 商品カット生成を試す
1. 「商品カット生成」を選択
2. 商品説明を入力: 例「白いTシャツ」
3. 「生成」ボタンをクリック

### 5. コンソールでログを確認（F12キー）
正常な場合：
```
🚀 画像生成開始: { feature: 'product-shots', ... }
📤 API呼び出し: product-shots
📥 APIレスポンス: { data: {...}, error: null }
```

エラーの場合：
```
📥 APIレスポンス: { data: null, error: { message: "..." } }
```

---

## ⚡ これで動くはずの機能

GEMINI_IMAGE_MODELを設定すれば、以下の機能が動作します：

- ✅ **画像生成**（テキストから）
- ✅ **商品カット生成**（4方向）
- ✅ **モデル着用画像**
- ✅ **デザインガチャ**
- ✅ **画像バリエーション生成**
- ✅ **高解像度化（アップスケール）**

---

## 📋 追加で設定すると良いもの（後でOK）

### 残りのEdge Functions（4個）

画面を下にスクロールすると、もしかしたら以下も表示されているかもしれません：
- colorize（カラーバリエーション）
- remove-background（背景削除）
- share-link（共有リンク）
- bulk-download（一括ダウンロード）

もし表示されていない場合、ターミナルでデプロイできます：

```bash
cd /Users/nichikatanaka/Desktop/アパレル１
cd supabase/functions

supabase functions deploy colorize
supabase functions deploy remove-background
supabase functions deploy share-link
supabase functions deploy bulk-download
```

ただし、**これは後回しでOK**です。まずは画像生成が動くか確認しましょう！

---

## 🔧 もし問題が発生したら

### エラー1: 「Model not found」
→ `GEMINI_IMAGE_MODEL` のスペルミスを確認
→ 正しくは: `imagen-3.0-generate-001`

### エラー2: 「API key invalid」
→ `GEMINI_API_KEY` が正しく設定されているか再確認
→ Google AI Studio で新しいキーを生成

### エラー3: 「Quota exceeded」
→ Gemini APIの無料枠を使い切った
→ Google AI Studio で使用状況を確認

---

## ✅ 設定完了後のチェックリスト

- [x] Edge Functions: 8個デプロイ済み
- [x] GEMINI_API_KEY: 設定済み
- [ ] **GEMINI_IMAGE_MODEL: 設定する** ← 今ここ
- [ ] テスト: 画像生成を試す

---

## 🎉 設定したら報告してください！

`GEMINI_IMAGE_MODEL` を設定したら、以下を教えてください：

1. ✅ 設定完了
2. 画像生成を試した結果:
   - ✅ 成功：画像が生成された
   - ❌ エラー：エラーメッセージ「〇〇〇」

エラーが出た場合は、ブラウザのコンソール（F12）に表示されるメッセージを教えてください！

---

**これで99%動くはずです！頑張ってください！ 🚀**

