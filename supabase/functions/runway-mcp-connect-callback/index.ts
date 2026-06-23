import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createServiceClient } from '../_shared/auth.ts';
import {
  encryptSecret,
  exchangeRunwayCode,
  redirectResponse,
  sha256Base64Url,
} from '../_shared/runwayMcpConnection.ts';

serve(async (req) => {
  const appBaseUrl = Deno.env.get('APP_BASE_URL')?.trim().replace(/\/+$/, '') || 'https://heavy-chain.zeabur.app';
  const failUrl = `${appBaseUrl}/brand/settings?runway_mcp=failed`;

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code') || '';
    const state = url.searchParams.get('state') || '';
    const providerError = url.searchParams.get('error');
    if (providerError) return redirectResponse(`${failUrl}&reason=${encodeURIComponent(providerError)}`);
    if (!code || !state) return redirectResponse(`${failUrl}&reason=missing_code_or_state`);

    const serviceClient = createServiceClient() as any;
    const stateHash = await sha256Base64Url(state);
    const { data: oauthState, error: stateError } = await serviceClient
      .from('runway_mcp_oauth_states')
      .select('id, brand_id, user_id, code_verifier, client_id, redirect_uri, return_to, expires_at, used_at')
      .eq('state_hash', stateHash)
      .maybeSingle();
    if (stateError || !oauthState) return redirectResponse(`${failUrl}&reason=state_not_found`);
    if (oauthState.used_at) return redirectResponse(`${failUrl}&reason=state_already_used`);
    if (new Date(oauthState.expires_at).getTime() < Date.now()) return redirectResponse(`${failUrl}&reason=state_expired`);

    const token = await exchangeRunwayCode({
      code,
      clientId: oauthState.client_id,
      redirectUri: oauthState.redirect_uri,
      codeVerifier: oauthState.code_verifier,
    });
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;

    const encryptedAccessToken = await encryptSecret(token.access_token);
    const encryptedRefreshToken = token.refresh_token ? await encryptSecret(token.refresh_token) : null;

    const now = new Date().toISOString();
    const { error: connectionError } = await serviceClient
      .from('runway_mcp_oauth_connections')
      .upsert({
        brand_id: oauthState.brand_id,
        status: 'connected',
        connected_by: oauthState.user_id,
        client_id: oauthState.client_id,
        scope: token.scope || null,
        token_type: token.token_type || 'Bearer',
        encrypted_access_token: encryptedAccessToken,
        encrypted_refresh_token: encryptedRefreshToken,
        expires_at: expiresAt,
        last_verified_at: now,
        last_error: null,
        updated_at: now,
      }, { onConflict: 'brand_id' });
    if (connectionError) throw connectionError;

    await serviceClient
      .from('runway_mcp_oauth_states')
      .update({ used_at: now })
      .eq('id', oauthState.id);

    await serviceClient
      .from('runway_mcp_connection_approvals')
      .upsert({
        brand_id: oauthState.brand_id,
        status: 'approved',
        requested_by: oauthState.user_id,
        approved_by: oauthState.user_id,
        requested_at: now,
        approved_at: now,
        rejected_by: null,
        revoked_by: null,
        rejected_at: null,
        revoked_at: null,
        updated_at: now,
      }, { onConflict: 'brand_id' });

    const returnTo = typeof oauthState.return_to === 'string' && oauthState.return_to.startsWith('/')
      ? oauthState.return_to
      : '/brand/settings';
    return redirectResponse(`${appBaseUrl}${returnTo}?runway_mcp=connected`);
  } catch (error) {
    return redirectResponse(`${failUrl}&reason=${encodeURIComponent(sanitizeError(error))}`);
  }
});

function sanitizeError(error: unknown) {
  return String(error instanceof Error ? error.message : error || 'runway_mcp_callback_failed')
    .replace(/access_token["=:]\s*["']?[^"',\s}]+/gi, 'access_token=[redacted]')
    .replace(/refresh_token["=:]\s*["']?[^"',\s}]+/gi, 'refresh_token=[redacted]')
    .slice(0, 160);
}
