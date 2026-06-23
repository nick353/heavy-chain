import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createServiceClient, createUserClient, requireBrandRole, requireUser } from '../_shared/auth.ts';
import {
  buildRunwayAuthorizeUrl,
  jsonResponse,
  randomBase64Url,
  registerRunwayOAuthClient,
  sha256Base64Url,
} from '../_shared/runwayMcpConnection.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse({ ok: true });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const userClient = createUserClient(req);
    const serviceClient = createServiceClient() as any;
    const user = await requireUser(userClient);
    const body = await req.json().catch(() => ({}));
    const brandId = typeof body.brandId === 'string' ? body.brandId : '';
    const returnTo = typeof body.returnTo === 'string' ? body.returnTo : '/brand/settings';
    if (!brandId) return jsonResponse({ error: 'brand_id_required' }, 400);

    await requireBrandRole(userClient, brandId, user.id, 'admin');

    const redirectUri = Deno.env.get('RUNWAY_MCP_OAUTH_CALLBACK_URL')?.trim()
      || `${Deno.env.get('SUPABASE_URL')}/functions/v1/runway-mcp-connect-callback`;
    const state = randomBase64Url(32);
    const stateHash = await sha256Base64Url(state);
    const codeVerifier = randomBase64Url(64);
    const clientId = await registerRunwayOAuthClient(redirectUri);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await serviceClient
      .from('runway_mcp_oauth_states')
      .insert({
        state_hash: stateHash,
        brand_id: brandId,
        user_id: user.id,
        code_verifier: codeVerifier,
        client_id: clientId,
        redirect_uri: redirectUri,
        return_to: returnTo,
        expires_at: expiresAt,
      });
    if (error) throw error;

    const authorizationUrl = await buildRunwayAuthorizeUrl({
      clientId,
      redirectUri,
      state,
      codeVerifier,
    });

    return jsonResponse({ authorizationUrl, expiresAt });
  } catch (error) {
    return jsonResponse({ error: sanitizeError(error) }, 400);
  }
});

function sanitizeError(error: unknown) {
  return String(error instanceof Error ? error.message : error || 'runway_mcp_connect_start_failed').slice(0, 400);
}
