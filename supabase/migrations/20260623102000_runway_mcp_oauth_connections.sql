-- Store server-only Runway MCP OAuth connection state.
-- OAuth tokens are encrypted by Edge Functions before insertion.

CREATE TABLE IF NOT EXISTS public.runway_mcp_oauth_states (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  state_hash TEXT NOT NULL UNIQUE,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  return_to TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runway_mcp_oauth_states_brand_id
  ON public.runway_mcp_oauth_states(brand_id);
CREATE INDEX IF NOT EXISTS idx_runway_mcp_oauth_states_expires_at
  ON public.runway_mcp_oauth_states(expires_at);

ALTER TABLE public.runway_mcp_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.runway_mcp_oauth_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.runway_mcp_oauth_states TO service_role;

CREATE TABLE IF NOT EXISTS public.runway_mcp_oauth_connections (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  brand_id UUID NOT NULL UNIQUE REFERENCES public.brands(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'reauthorization_required', 'revoked', 'error')),
  connected_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  client_id TEXT NOT NULL,
  scope TEXT,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runway_mcp_oauth_connections_status
  ON public.runway_mcp_oauth_connections(status);

ALTER TABLE public.runway_mcp_oauth_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.runway_mcp_oauth_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.runway_mcp_oauth_connections TO service_role;

DROP POLICY IF EXISTS "Brand admins can view Runway MCP OAuth connection status"
  ON public.runway_mcp_oauth_connections;
CREATE POLICY "Brand admins can view Runway MCP OAuth connection status"
  ON public.runway_mcp_oauth_connections FOR SELECT
  TO authenticated
  USING (
    private.has_brand_role(brand_id, 'admin')
    OR private.is_current_user_admin()
  );
