/**
 * Openverse relay: the reference image search the browser runs (src/features/designDetail/referenceImageSearch.ts) calls
 * api.openverse.org directly and keylessly, which Openverse counts per visitor at 20 searches a minute and 200 a day.
 * The owner registered a client on 2026-11-14 ("登録する"), so the search goes through this relay instead when the
 * credentials are set: it holds one OAuth2 client-credentials token and raises the limit to about 100 a minute and
 * 10,000 a day — counted for the whole site, not per visitor.
 *
 * Spec read 2026-11-14 (https://api.openverse.org/v1/, WordPress/openverse#5315, #5613):
 * - POST /v1/auth_tokens/token/ with grant_type=client_credentials returns `access_token` and `expires_in` (43200 = 12 h).
 * - The client stays on anonymous limits until the registration email's link is clicked; GET /v1/rate_limit/ reports
 *   `verified` and the tier, so that is what proves the key works.
 *
 * Without OPENVERSE_CLIENT_ID / OPENVERSE_CLIENT_SECRET nothing is called here and the browser searches keylessly as
 * before, so a half-configured deploy still works. The secret never reaches the browser: only this relay sees it.
 */
export const OPENVERSE_TOKEN_URL = 'https://api.openverse.org/v1/auth_tokens/token/';
export const OPENVERSE_IMAGES_URL = 'https://api.openverse.org/v1/images/';
export const OPENVERSE_RATE_LIMIT_URL = 'https://api.openverse.org/v1/rate_limit/';
const TOKEN_TIMEOUT_MS = 8000;
const SEARCH_TIMEOUT_MS = 12_000;
/** Ask for a new token this long before the old one expires (a request must not die mid-flight). */
const TOKEN_EARLY_MS = 5 * 60_000;
/** Openverse's own page_size ceiling for this endpoint. */
const MAX_PAGE_SIZE = 20;

export type OpenverseEnv = { OPENVERSE_CLIENT_ID?: string; OPENVERSE_CLIENT_SECRET?: string };
type Fetch = typeof fetch;

export const openverseConfigured = (env: OpenverseEnv) =>
  Boolean(env.OPENVERSE_CLIENT_ID?.trim() && env.OPENVERSE_CLIENT_SECRET?.trim());

export class OpenverseError extends Error {
  readonly status: number;
  constructor(status: number, message = `openverse_${status}`) { super(message); this.status = status; }
}

/** One token per isolate. A new isolate just fetches its own; nothing is stored outside memory. */
let held: { token: string; expiresAt: number; clientId: string } | null = null;
/** Reset between tests. */
export function forgetOpenverseToken() { held = null; }

export async function openverseToken(env: OpenverseEnv, fetcher: Fetch = fetch, now = Date.now()): Promise<string> {
  const clientId = env.OPENVERSE_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.OPENVERSE_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) throw new OpenverseError(503, 'openverse_not_configured');
  // A redeploy can change the client; a token minted for the old one would 401 on every search.
  if (held && held.clientId === clientId && held.expiresAt > now) return held.token;

  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  let response: Response;
  try {
    response = await fetcher(OPENVERSE_TOKEN_URL, {
      method: 'POST', body, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  } catch { throw new OpenverseError(502, 'openverse_token_unreachable'); }
  if (!response.ok) throw new OpenverseError(response.status === 429 ? 429 : 502, `openverse_token_${response.status}`);

  const data = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
  const token = typeof data?.access_token === 'string' ? data.access_token.trim() : '';
  if (!token) throw new OpenverseError(502, 'openverse_token_missing');
  const seconds = typeof data?.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in : 43_200;
  held = { token, clientId, expiresAt: now + Math.max(60_000, seconds * 1000 - TOKEN_EARLY_MS) };
  return token;
}

/** The query the browser may ask for, kept to what the reference search actually uses. */
export function openverseSearchParams(input: URLSearchParams): URLSearchParams {
  const query = (input.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!query) throw new OpenverseError(400, 'openverse_query_required');
  // Number(null) is 0, so an absent page_size must not fall through as "1 image".
  const raw = input.get('page_size')?.trim();
  const asked = raw ? Number(raw) : NaN;
  const pageSize = Number.isFinite(asked) ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(asked))) : 12;
  // license_type and mature are fixed here: every image is sent to the image AI as a reference, so it must allow
  // commercial use and changes, and mature results are never wanted (the browser asked for the same two).
  return new URLSearchParams({ q: query, license_type: 'commercial,modification', mature: 'false', page_size: String(pageSize) });
}

/** Openverse's own JSON for the query, as the browser's keyless call would have received it. */
export async function openverseImages(env: OpenverseEnv, input: URLSearchParams, fetcher: Fetch = fetch, now = Date.now()): Promise<unknown> {
  const params = openverseSearchParams(input);
  const token = await openverseToken(env, fetcher, now);
  let response: Response;
  try {
    response = await fetcher(`${OPENVERSE_IMAGES_URL}?${params}`, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS), headers: { authorization: `Bearer ${token}` },
    });
  } catch { throw new OpenverseError(502, 'openverse_unreachable'); }
  if (response.status === 401 || response.status === 403) {
    held = null; // The token was rejected: drop it so the next search mints a fresh one instead of failing again.
    throw new OpenverseError(502, `openverse_${response.status}`);
  }
  if (!response.ok) throw new OpenverseError(response.status === 429 ? 429 : 502, `openverse_${response.status}`);
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || !Array.isArray((data as { results?: unknown }).results)) {
    throw new OpenverseError(502, 'openverse_unusable_reply');
  }
  return data;
}
