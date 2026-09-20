# Heavy Chain クイックスタート（Cloudflare）

## 1. 依存関係と公開設定

```bash
cp .env.example .env
npm ci
```

`.env.example`はCloudflare API、private R2 gateway、Workers AI、公開Web URLの
設定です。Supabase URL/keyやprovider secretは設定しません。

## 2. 起動

```bash
npm run dev
```

`http://localhost:5173`を開きます。

## 3. 最小検証

```bash
npm run typecheck
npm run test:lightchain-material-contract
```

本番向けのCloudflare buildは次で作成します。

```bash
node cloudflare/heavy-web/build.mjs
```

## 現行サービス境界

- Web: `heavy-chain-web.nichika2000823.workers.dev`
- API: `heavy-chain-api.nichika2000823.workers.dev`
- Auth: `consumer-auth.nichika2000823.workers.dev`
- AI: `workers_ai`
- Media: 認証済みAPI経由のprivate R2

実メール登録、password reset、OAuth交換、認証済み生成・保存・再利用、実機確認は
別の本番受入れ工程です。`/health`、local fixture、buildだけでは完了としません。

## 旧経路について

Supabaseのmigration/Edge Function/環境変数は履歴資料です。旧データをコピーせず、
旧providerへfallbackせず、旧サービスを停止・削除するのは本番受入れ証拠と
rollback確認の後だけです。詳細は[SETUP.md](SETUP.md)、[STATE.md](STATE.md)、
[Cloudflare Web README](cloudflare/heavy-web/README.md)を参照してください。
