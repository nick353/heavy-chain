# Heavy Chain セットアップガイド（現行Cloudflare構成）

この文書が現行のセットアップ手順です。Heavy Chainの実行時データ面は
Cloudflare Workers、D1、private R2、`consumer-auth`、Workers AIを使用します。
Supabase CLI、Supabase credentials、Edge Functions、旧テストデータのコピーは
この手順では使用しません。

## 現行の公開構成

- Web: `https://heavy-chain-web.nichika2000823.workers.dev`
- API/D1/private R2: `https://heavy-chain-api.nichika2000823.workers.dev`
- Auth: `https://consumer-auth.nichika2000823.workers.dev`
- 画像AI adapter: Cloudflare `workers_ai`
- ブラウザのprivate media: API経由の認証済みR2 gateway

実メール、OAuth consent、認証済みAI/R2業務、実機、全通信zero、旧サービス停止は
別の本番受入れ条件です。healthやlocal testだけで業務完了とは扱いません。

## ローカル準備

必要環境はNode.js 18以上とnpmです。

```bash
cp .env.example .env
npm ci
```

`.env.example` に含まれるのはブラウザへ公開可能なCloudflare設定だけです。
session token、R2 key、Worker secret、provider secretは`VITE_*`へ入れません。

## ローカル検証と起動

```bash
npm run typecheck
npm run test:lightchain-material-contract
npm run build
npm run dev
```

開発サーバーは `http://localhost:5173` で起動します。`npm run verify` は6つの
Cloudflare公開設定を環境から要求します。未設定の場合は`env:check`で停止します。

```bash
npm run verify
```

## Cloudflare Webのビルド

Cloudflare Webの生成物は`cloudflare/heavy-web/.build`へ作成されます。
既存の`dist`やユーザーデータを置き換えません。

```bash
node --test cloudflare/heavy-web/test/web.test.mjs
node cloudflare/heavy-web/build.mjs
```

配置・large assetのreadback・ロールバック境界は
[Cloudflare Web README](cloudflare/heavy-web/README.md)を使用します。
本番配置やsecret変更は、対象・version・bindingを直前に確認してから実施します。

## Cloudflare Workerのローカル検証

```bash
npm --prefix cloudflare/heavy-api ci
npm --prefix cloudflare/heavy-api test
npm --prefix cloudflare/heavy-api run typecheck

npm --prefix cloudflare/consumer-auth ci
npm --prefix cloudflare/consumer-auth test
npm --prefix cloudflare/consumer-auth run typecheck
```

これらはSQLite/R2/外部providerのfixtureを使うローカル契約検証です。実AI、
実メール、実OAuth、実R2業務の証拠とは分けて扱います。

## 旧資料の扱い

ルートの`supabase/`、`SUPABASE_SETUP.md`、旧migration、旧Edge Function資料は
移行履歴・比較・rollback検討用に保持しています。現行起動のために適用したり、
旧providerへfallbackしたりしないでください。移行完了の判定と旧サービス整理は、
[STATE.md](STATE.md)と計画書の本番証拠に従います。
