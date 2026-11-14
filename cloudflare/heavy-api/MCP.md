# Heavy Chain の MCP サーバー

ChatGPT・Claude・Cursor など、MCP に対応したアプリから Heavy Chain を使うための入口です。
2026-11-14 オーナーの依頼「MCP化して、Chatgptからも使えるようにしたい」「全て汎用的に使えるようにして」。

- **サーバーの URL**: `https://heavy-chain-api.nichika2000823.workers.dev/mcp`
- **通信**: streamable HTTP（単一 JSON レスポンス。SSE は使わない）
- **認証**: OAuth 2.1。アプリ側で「サインイン」を押すと heavychain.app のふだんのログイン（Google / Apple / メール）に入り、承認すると使えるようになります。**秘密の鍵や URL を手で貼る場面はありません。**

---

## 1. ChatGPT につなぐ

1. [chatgpt.com/plugins](https://chatgpt.com/plugins) を開く
2. ＋ ボタン → **Add custom MCP server**
3. 入れるもの
   - **名前**: Heavy Chain
   - **Server URL**: `https://heavy-chain-api.nichika2000823.workers.dev/mcp`
   - **Authentication**: **OAuth**（認証情報は空のままにする。ChatGPT が自分でクライアント登録をします）
4. 危険の警告を読んで「I understand and want to continue」
5. **Create as a plugin**
6. 個人のプラグイン一覧に出るので、開いて ＋ で install
7. 会話で `@` を押して Heavy Chain を選ぶ。初回はここで「サインイン」が出るので、heavychain.app のログイン → 「許可する」

ChatGPT は web で使います。独自 MCP サーバーの追加は有料プラン向けの機能で、ワークスペースの制限（Lockdown など）がかかっていると使えません。

### 聞き方の例

```
@Heavy Chain 先週作ったデザインを5件見せて。画像のリンクも付けて。
@Heavy Chain このブランドの生成の残りを教えて。
@Heavy Chain 「オーバーサイズ スウェット」で実際に売っている商品を探して、値段を並べて。
```

ツールが選ばれないときは、はっきり指示します（公式の助言）。
`Heavy Chain の "list_designs" ツールを使って。ほかのツールは使わないで。`

## 2. Claude Code につなぐ

```bash
claude mcp add --transport http heavy-chain https://heavy-chain-api.nichika2000823.workers.dev/mcp
```

そのあと Claude Code の中で `/mcp` を実行し、heavy-chain を選んでブラウザのサインインを済ませます。
（`claude mcp login heavy-chain` でも同じことができます。トークンは安全に保存され、自動で更新されます。）

プロジェクトで共有するなら `.mcp.json` に書きます。

```json
{
  "mcpServers": {
    "heavy-chain": {
      "type": "http",
      "url": "https://heavy-chain-api.nichika2000823.workers.dev/mcp"
    }
  }
}
```

`claude -p`（画面なしの実行）では OAuth の画面を出せないので、**先に対話セッションか `claude mcp login` でサインインを済ませて**ください。

## 3. ほかのクライアントにつなぐ

標準の MCP（Streamable HTTP ＋ MCP の OAuth 2.1）で建ててあるので、URL を入れるだけでどれも同じようにつながります。

### Cursor（`mcp.json`）

```json
{
  "mcpServers": {
    "heavy-chain": { "url": "https://heavy-chain-api.nichika2000823.workers.dev/mcp" }
  }
}
```

リモートのサーバーに `type` は要りません。Cursor は PKCE つきの認可コードフローで、protected resource metadata（RFC 9728）と resource indicator（RFC 8707）を読み、クライアント登録は秘密なしの公開クライアントとして行います。どれもこのサーバーが出している形です。

### Gemini CLI（`settings.json`）

```json
{
  "mcpServers": {
    "heavy-chain": { "httpUrl": "https://heavy-chain-api.nichika2000823.workers.dev/mcp" }
  }
}
```

HTTP ストリーミングの口は `url` ではなく **`httpUrl`** です。`oauth` の欄は書かなくてよく、401 を見て自分でサインインの入口を見つけます。Gemini CLI は RFC 9207 の `iss` を検証しますが、このサーバーは成功もエラーも含め**すべての応答に `iss` を付けている**ので通ります。サインインには手元のブラウザと localhost のコールバックが要るので、SSH 越しやコンテナの中では失敗します。

### VS Code（`.vscode/mcp.json` または個人設定）

サーバーの追加で **HTTP** を選び、同じ URL を入れます。

```json
{
  "servers": {
    "heavy-chain": { "type": "http", "url": "https://heavy-chain-api.nichika2000823.workers.dev/mcp" }
  }
}
```

### クライアントごとの違い（2026-11-14 に一次情報で確認）

| | つなぎ方 | OAuth | 備考 |
|---|---|---|---|
| ChatGPT | 画面で「Add custom MCP server」。認証は **OAuth** を選び、認証情報は空のまま | 動的登録・CIMD・固定の資格情報 | 独自サーバーの追加は有料プラン向け。ワークスペースの制限（Lockdown）がかかると使えない |
| Claude Code | `claude mcp add --transport http` | 401 を見て「認証が必要」とし、`/mcp` か `claude mcp login` でサインイン | `--header "Authorization: Bearer …"` で自分のトークンを直に渡す道もある（その場合 OAuth は使われない） |
| Cursor | `mcp.json` に `url` だけ | PKCE＋メタデータの発見。公開クライアントとして動的登録 | 固定の Client ID を使う道もある |
| Gemini CLI | `settings.json` に **`httpUrl`** | 401 を見て自動発見 | `iss` を RFC 9207 どおり検証する。ブラウザと localhost が要る |
| VS Code | `.vscode/mcp.json` に `type: "http"` | 公式ページでは認証の詳細に触れていない | 設定の詳細は VS Code の MCP 設定リファレンスを見る |

**ChatGPT だけのために作った部分はありません。** 標準の形（Streamable HTTP の単一 JSON ＋ 401 の `WWW-Authenticate` ＋ RFC 9728 / 8414 のメタデータ ＋ RFC 7591 の動的登録 ＋ PKCE S256 ＋ RFC 9207 の `iss`）が本体で、ChatGPT もその1つとしてつながります。

## 4. 使えるツール

いまは**読み取りだけ**です。デザインの新規作成や削除はできません。

| ツール | すること | かかるもの |
|---|---|---|
| `list_brands` | ブランドの一覧。ほかのツールに渡す `brand_id` をここで取る | 無料・1秒 |
| `list_projects` | プロジェクト（キャンバス）の一覧 | 無料・1秒 |
| `list_designs` | 作ったデザインの一覧。`with_image_urls: true` で1時間だけ有効な画像リンクを最大5件 | 無料・1〜3秒 |
| `get_design_request` | 生成の進み具合（画面で始めた生成の結果を見る） | 無料・1秒 |
| `get_usage` | 生成の使用量と残り | 無料・1秒 |
| `search_reference_images` | Openverse の参考画像（自由に使える画像だけ） | 無料枠・数秒 |
| `search_products` | Yahoo!ショッピングの実在の商品（値段・店・リンク） | 無料枠・数秒 |

**まず `list_brands`** を呼んで `brand_id` を取るのが決まりです。`search_products` には `list_projects` で取った `project_id` も必要です。

## 5. 安全のしかけ

- **許可は heavychain.app のログアウトで止まります。** 承認のときに預かったセッションを封じて持っているだけなので、ログアウトやセッション切れでそのまま使えなくなります
- 見えるのは**承認した本人のブランドだけ**。ほかの人のブランドの id を渡しても通りません
- 月や日の生成の上限、ブランドの役割（owner / editor / viewer）は、画面から使うときと同じに効きます
- 画像は**1時間だけ有効なリンク**で返します。リンクは保存せず、必要なときに取り直してください
- クライアントは**動的クライアント登録**で自分の id を作ります。戻り先は登録したものと完全一致のときだけ受け付けます
- 読み取りのツールには `readOnlyHint` を付けてあるので、アプリ側で毎回の確認が出ません

## 6. 出すときに要ること（運用）

```bash
# 1. セッションを封じる鍵（32文字以上）。値は画面に出さず、stdin から入れる
npx wrangler secret put MCP_TOKEN_SECRET --config wrangler.production.jsonc

# 2. D1 の移行
npx wrangler d1 migrations apply heavy-chain-production-db --remote --config wrangler.production.jsonc

# 3. Worker
npx wrangler deploy --config wrangler.production.jsonc
```

承認ページ（`heavychain.app/mcp-authorize`）はフロント側なので、heavy-web も出し直します。

鍵が入っていない間、OAuth の道は 503 で閉じたままです（勝手に開くことはありません）。

## 7. 困ったとき

| 様子 | 見るところ |
|---|---|
| アプリが「つながらない」と言う | `curl https://heavy-chain-api.nichika2000823.workers.dev/.well-known/oauth-protected-resource/mcp` が JSON を返すか |
| サインインの画面が出ない | `/.well-known/oauth-authorization-server` が返るか。`code_challenge_methods_supported` に `S256` があるか |
| 承認ページが「期限切れ」と言う | 承認の要求は10分で切れます。アプリ側からサインインをやり直してください |
| ツールが毎回 401 | heavychain.app でログインし直し、アプリ側でもサインインし直してください |
| ツールが「権限が足りません」 | `list_brands` で使えるブランドを確かめ、その `brand_id` を渡してください |

中身の決まりは `src/mcp.ts`（MCP の入口とツール）と `src/mcp-oauth.ts`（OAuth）に書いてあります。
試験は `test/mcp.test.ts`・`test/mcp-oauth.test.ts`（48件）。
