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

## 2. Claude につなぐ

Claude の設定で MCP サーバーを足し、同じ URL を入れます。OAuth の流れは ChatGPT と同じです。

Claude Code から使う場合は `.mcp.json` に書きます。

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

## 3. 使えるツール

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

## 4. 安全のしかけ

- **許可は heavychain.app のログアウトで止まります。** 承認のときに預かったセッションを封じて持っているだけなので、ログアウトやセッション切れでそのまま使えなくなります
- 見えるのは**承認した本人のブランドだけ**。ほかの人のブランドの id を渡しても通りません
- 月や日の生成の上限、ブランドの役割（owner / editor / viewer）は、画面から使うときと同じに効きます
- 画像は**1時間だけ有効なリンク**で返します。リンクは保存せず、必要なときに取り直してください
- クライアントは**動的クライアント登録**で自分の id を作ります。戻り先は登録したものと完全一致のときだけ受け付けます
- 読み取りのツールには `readOnlyHint` を付けてあるので、アプリ側で毎回の確認が出ません

## 5. 出すときに要ること（運用）

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

## 6. 困ったとき

| 様子 | 見るところ |
|---|---|
| アプリが「つながらない」と言う | `curl https://heavy-chain-api.nichika2000823.workers.dev/.well-known/oauth-protected-resource/mcp` が JSON を返すか |
| サインインの画面が出ない | `/.well-known/oauth-authorization-server` が返るか。`code_challenge_methods_supported` に `S256` があるか |
| 承認ページが「期限切れ」と言う | 承認の要求は10分で切れます。アプリ側からサインインをやり直してください |
| ツールが毎回 401 | heavychain.app でログインし直し、アプリ側でもサインインし直してください |
| ツールが「権限が足りません」 | `list_brands` で使えるブランドを確かめ、その `brand_id` を渡してください |

中身の決まりは `src/mcp.ts`（MCP の入口とツール）と `src/mcp-oauth.ts`（OAuth）に書いてあります。
試験は `test/mcp.test.ts`・`test/mcp-oauth.test.ts`（48件）。
