# 🚀 Heavy Chain - セットアップ完了ガイド

## ✅ Supabase設定完了

Supabaseの接続情報が設定されました！

- **Project URL**: `https://ulfbddqwumeoqidxatyq.supabase.co`
- **Anon Key**: 設定済み ✅

## 📋 次のステップ

### ステップ1: ストレージバケットのセットアップ（必須）

画像を表示するには、Supabaseでストレージバケットを設定する必要があります。

1. [Supabase Dashboard](https://app.supabase.com) を開く
2. プロジェクト `ulfbddqwumeoqidxatyq` を選択
3. 左メニューから **SQL Editor** をクリック
4. 以下のファイルの内容をコピー&ペースト：
   - **`storage-setup.sql`**（プロジェクトルートにあります）
5. **Run** ボタンをクリック

これで以下が作成されます：
- ✅ `generated-images` バケット（画像保存用）
- ✅ `brand-assets` バケット（ロゴ等）
- ✅ 適切なアクセスポリシー

### ステップ2: アプリを起動

```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。

### ステップ3: 画像が表示されることを確認

- ダッシュボードとギャラリーに移動
- 画像が正常に表示されれば完了です！🎉

## 🔍 トラブルシューティング

### 画像が「読込失敗」と表示される場合

**原因**: ストレージバケットが設定されていない

**解決方法**:
1. `storage-setup.sql` を実行したか確認
2. Supabase Dashboard → **Storage** で以下を確認：
   - `generated-images` バケットが存在する
   - バケットが **Public** になっている

### ストレージバケットの状態を確認

Supabase Dashboard で：
1. **Storage** メニューを開く
2. バケット一覧に以下が表示されるはず：
   - `generated-images` (Public)
   - `brand-assets` (Public)

### データベーステーブルが見つからない場合

**解決方法**:
1. Supabase Dashboard → **SQL Editor**
2. `setup.sql` の内容をコピー&ペースト
3. **Run** をクリック

## 📊 確認項目チェックリスト

- [ ] Supabase設定完了（コードに組み込み済み ✅）
- [ ] `storage-setup.sql` を実行した
- [ ] ストレージバケットが作成されている
- [ ] `setup.sql` を実行した（データベーススキーマ）
- [ ] アプリが起動する
- [ ] ログイン/サインアップができる
- [ ] ダッシュボードが表示される
- [ ] ギャラリーページが開く
- [ ] 画像が正常に表示される

## 🎨 画像生成機能を使う場合（オプション）

実際に画像を生成したい場合は、Supabase Edge Functions に API キーを設定します：

1. Supabase Dashboard → **Edge Functions** → **Secrets**
2. 以下の環境変数を追加：
   ```
   OPENAI_API_KEY=your-openai-api-key
   GEMINI_API_KEY=your-gemini-api-key
   ```

## 💡 重要な注意事項

### セキュリティ

現在、Supabaseの認証情報がコード（`src/lib/supabase.ts`）に直接記載されています。

**本番環境では必ず `.env` ファイルを使用してください：**

1. プロジェクトルートに `.env` ファイルを作成
2. 以下を記載：
   ```env
   VITE_SUPABASE_URL=https://ulfbddqwumeoqidxatyq.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsZmJkZHF3dW1lb3FpZHhhdHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0MTcxMjcsImV4cCI6MjA4MTk5MzEyN30.1B8yRfF2QzN-HX7d3LtJkHyQ452k-Po0319ER35pzfQ
   ```
3. `src/lib/supabase.ts` からハードコードされた値を削除

**注意**: `.env` ファイルは `.gitignore` に含まれているため、Gitにコミットされません。

## 📚 関連ドキュメント

- [デプロイガイド](./DEPLOYMENT_CHECKLIST.md)
- [プロジェクト要件](./HeavyChain_Requirements%20(3).md)
- [次のステップ](./NEXT_STEPS.md)

## 🎉 完了！

すべてのステップを完了したら、Heavy Chainを使い始められます！

問題が発生した場合は、ブラウザの開発者ツール（F12）でコンソールのエラーメッセージを確認してください。

