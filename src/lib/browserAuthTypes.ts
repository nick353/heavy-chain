/** Browser-facing identity from the same-origin Cloudflare auth service.
 * Metadata is presentation data, never an authorization source.
 */
export interface BrowserAuthUser {
  id: string;
  email: string;
  aud: 'authenticated';
  created_at: string;
  email_confirmed_at?: string;
  app_metadata: { provider: 'cloudflare' };
  user_metadata: Record<string, unknown>;
}

export interface BrowserAuthSession {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_at: number;
  expires_in: number;
  user: BrowserAuthUser;
}

export type BrowserAuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';
