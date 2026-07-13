# Heavy Chain - セットアップガイド

## 🚀 クイックスタート

### 1. 環境変数の設定

プロジェクトルートに `.env` ファイルを作成し、以下の内容を記入してください：

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

#### Supabase の設定値を取得する方法：

1. [Supabase Dashboard](https://app.supabase.com) にログイン
2. プロジェクトを選択
3. **Settings** → **API** に移動
4. **Project URL** を `VITE_SUPABASE_URL` にコピー
5. **Project API keys** の **anon public** キーを `VITE_SUPABASE_ANON_KEY` にコピー

### 2. Supabase のセットアップ

通常手順は migration を正本にします。Supabase CLI を使える環境では、`supabase/migrations/` の全 migration を順に適用してください。SQL Editor で手動適用する場合も、`001_initial_schema.sql` だけではなく最新 migration まで順番に実行します。

最新 migration には以下が含まれます：
- `generated-images` / `brand-assets` / `exports` の private bucket 作成
- `storage.objects` の RLS policy
- private schema 上の権限判定関数

### 3. ストレージバケットの確認

Supabase Dashboard で：
1. **Storage** を開く
2. 以下のバケットが作成されていることを確認：
   - `generated-images` (private)
   - `brand-assets` (private)
   - `exports` (private)

### 4. 依存関係のインストール

```bash
npm install
```

### 5. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。

## 🔧 トラブルシューティング

### 画像が表示されない場合

1. **ストレージバケットが作成されているか確認**
   - Supabase Dashboard → Storage
   - `generated-images`、`brand-assets`、`exports` が存在するか

2. **private bucket になっているか確認**
   - 各バケットをクリック
   - "Public bucket" がオフになっているか

3. **ストレージポリシーが設定されているか確認**
   - 通常は最新 migration まで適用済みか確認
   - 緊急再適用のみ `supabase/storage-setup.sql` を実行

4. **コンソールでエラーを確認**
   - ブラウザの開発者ツールを開く（F12）
   - Console タブでエラーメッセージを確認

### 画像パスのデバッグ

コンソールに以下の情報が表示されます：
```
Fetched images: X images
Sample image data: { id: "...", storage_path: "...", ... }
Image URL generated: { path: "...", url: "..." }
```

これらの情報から：
- `storage_path` が正しい形式か確認（例：`user-id/brand-id/job-id.png`）
- `url` が正しいSupabaseのURLか確認

### よくある問題

**問題**: "Failed to load image" エラーが多数表示される

**解決策**:
1. 最新 migration が適用されているか確認
2. 緊急時のみ `supabase/storage-setup.sql` で private bucket policy を再適用
3. RLS（Row Level Security）が正しく設定されているか確認

**問題**: データベースのテーブルが見つからない

**解決策**:
1. `supabase link --project-ref your-project-ref` を実行
2. `supabase db push` で最新 migration まで適用

## 📝 環境変数の詳細

| 変数名 | 説明 | 必須 |
|--------|------|------|
| `VITE_SUPABASE_URL` | SupabaseプロジェクトのURL | ✅ 必須 |
| `VITE_SUPABASE_ANON_KEY` | Supabaseの匿名キー（公開キー） | ✅ 必須 |

## 🎨 画像生成機能を使用する場合

画像生成機能を使用する場合は、Supabase Edge Functions に以下の環境変数を設定する必要があります：

```bash
# OpenAI API (DALL-E用)
OPENAI_API_KEY=your-openai-key

# Google Gemini API（画像分析・生成用）
GEMINI_API_KEY=your-gemini-key
```

Supabase Dashboard で設定：
1. **Edge Functions** を開く
2. **Secrets** タブ
3. 上記の環境変数を追加

## 📚 その他のドキュメント

- [デプロイガイド](DEPLOYMENT_CHECKLIST.md)
- [要件定義](HeavyChain_Requirements%20(3).md)
- [次のステップ](NEXT_STEPS.md)
