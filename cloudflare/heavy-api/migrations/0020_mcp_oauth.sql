-- MCP（ChatGPT・Claude・Cursor など）が OAuth 2.1 でサインインするための台帳。
-- 2026-11-14 オーナーの依頼「MCP化して、Chatgptからも使えるようにしたい」「ログインとおんなじ感じで」。
--
-- 身元そのものは今までどおり consumer-auth が持つ。ここが預かるのは、
-- 承認のときに本人のブラウザから受け取ったセッションを封じたもの（session_sealed）だけで、
-- 封を解く鍵はサーバーの秘密（MCP_TOKEN_SECRET）にしかない。
-- heavychain.app でログアウト・セッションが切れると、MCP の呼び出しもそこで止まる。

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  -- 動的クライアント登録（RFC 7591）で作った id。クライアントの秘密は持たない（公開クライアント＋PKCE）。
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  -- JSON の配列。登録時に出した URI と完全一致しない戻り先は受け付けない。
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

-- /mcp-oauth/authorize で受けた、まだ承認されていない要求。
-- 承認ページ（heavychain.app）には request_id だけを渡すので、ページ側でパラメータを書き換えられない。
CREATE TABLE IF NOT EXISTS mcp_oauth_requests (
  request_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT,
  code_challenge TEXT NOT NULL,
  resource TEXT,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- 承認されたときだけ入る。コードは1回しか引き換えられない（consumed_at）。
  code_hash TEXT,
  owner_issuer TEXT,
  owner_subject TEXT,
  session_sealed TEXT,
  approved_at TEXT,
  consumed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_oauth_requests_code ON mcp_oauth_requests(code_hash) WHERE code_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_oauth_requests_expiry ON mcp_oauth_requests(expires_at);

CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  refresh_hash TEXT,
  client_id TEXT NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  session_sealed TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  refresh_expires_at TEXT,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_oauth_tokens_refresh ON mcp_oauth_tokens(refresh_hash) WHERE refresh_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_owner ON mcp_oauth_tokens(owner_issuer, owner_subject);
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_expiry ON mcp_oauth_tokens(expires_at);
