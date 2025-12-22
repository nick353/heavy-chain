# トラブルシューティング

## 画像が生成されない場合

### 1. Supabase環境変数の確認

開発環境で画像が生成されない場合、まずブラウザのコンソールを開いて以下のエラーメッセージを確認してください：

```
❌ Supabase環境変数が設定されていません！
VITE_SUPABASE_URL: ❌ 未設定
VITE_SUPABASE_ANON_KEY: ❌ 未設定
```

このエラーが表示されている場合：

1. プロジェクトルートに `.env` ファイルを作成
2. 以下の内容を追加：

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

3. 開発サーバーを再起動：

```bash
npm run dev
```

### 2. Zeabur環境変数の設定

Zeaburにデプロイした場合、環境変数をZeaburのダッシュボードで設定する必要があります：

1. Zeaburダッシュボードにログイン
2. プロジェクトを選択
3. 「Variables」タブをクリック
4. 以下の環境変数を追加：
   - `VITE_SUPABASE_URL`: SupabaseプロジェクトのURL
   - `VITE_SUPABASE_ANON_KEY`: SupabaseのAnonymous Key

5. 再デプロイ

### 3. Supabase Edge Functionsの確認

Supabaseダッシュボードで以下を確認：

1. Edge Functionsがデプロイされているか
   - `generate-image`
   - `remove-background`
   - `colorize`
   - `upscale`
   - その他必要な関数

2. Edge Functions用の環境変数が設定されているか：
   - `GEMINI_API_KEY`: Google AI Studio APIキー
   - `GEMINI_IMAGE_MODEL`: 使用するモデル名（例: `imagen-3.0-generate-001`）
   - `OPENAI_API_KEY`: OpenAI APIキー（プロンプト最適化用）

### 4. ブラウザコンソールの確認

ブラウザの開発者ツール（F12）でコンソールを開き、以下のようなデバッグ情報を確認：

```
🚀 画像生成開始: { feature: 'product-shots', brand: 'xxx', hasReferenceImage: false }
📤 API呼び出し: product-shots
📥 APIレスポンス: { data: {...}, error: null }
```

エラーがある場合、詳細なエラーメッセージが表示されます。

### 5. ネットワークタブの確認

ブラウザの開発者ツールの「Network」タブで：

1. Supabase Functionsへのリクエストが送信されているか
2. レスポンスステータスコードを確認（200が正常）
3. レスポンス内容を確認

### 6. よくあるエラーと対処法

#### `Function not found`
- Edge Functionsがデプロイされていない
- 関数名が間違っている

**対処法**: Supabaseダッシュボードで関数をデプロイ

#### `Invalid API key`
- GEMINI_API_KEYまたはOPENAI_API_KEYが設定されていない、または無効

**対処法**: Supabaseダッシュボード → Settings → Edge Functions → Environment Variablesで設定

#### `Quota exceeded`
- Gemini APIまたはOpenAI APIの無料枠を超えている

**対処法**: Google AI StudioまたはOpenAIのダッシュボードで使用状況を確認

#### `Network error`
- インターネット接続の問題
- Supabaseサービスの障害

**対処法**: 
- ネットワーク接続を確認
- Supabaseステータスページを確認

## ローカル開発でのテスト

開発環境で画像生成をテストする場合：

```bash
# 開発サーバーを起動
npm run dev

# ブラウザでコンソールを開いて確認
# http://localhost:5173
```

## 本番環境（Zeabur）でのデバッグ

Zeaburのログを確認：

1. Zeaburダッシュボードにログイン
2. プロジェクトを選択
3. 「Logs」タブでリアルタイムログを確認
4. エラーメッセージを探す

## お問い合わせ

上記の手順で解決しない場合：

1. ブラウザのコンソールログをスクリーンショット
2. Zeaburのログをコピー
3. 実行した手順を記録
4. GitHubのIssueを作成またはサポートに連絡

