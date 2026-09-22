/** Public application assets only. This Worker has no private-media binding. */
export function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return false;
  return { offset: start, length: end - start + 1 };
}

const PUBLIC_BROWSER_PATHS = new Set(['/login', '/login-m', '/auth/callback', '/reset-password']);
const SOURCE_LIGHTCHAIN_FONT_URL = 'https://lightchain-qlxy-prod.oss-cn-hangzhou.aliyuncs.com/light-chain-platform/common/AlimamaFangYuanTiVF-Thin.woff';

function isHtmlNavigationPath(path) {
  // Static assets and API routes have their own authorization/asset boundary.
  // Only the SPA document fallback is subject to the source's auth redirect.
  return !path.startsWith('/assets/') && !path.startsWith('/api/') && !path.includes('.');
}

function sourceLoginRedirect(request) {
  const requestUrl = new URL(request.url);
  const loginUrl = new URL('/login', request.url);
  // The source preserves a trailing `?` even when the original route has no
  // query string. Hash fragments never reach a Worker and therefore cannot be
  // preserved at this boundary.
  const returnTo = `${requestUrl.pathname}${requestUrl.search || '?'}`;
  loginUrl.searchParams.set('redirect', returnTo);
  return Response.redirect(loginUrl.toString(), 307);
}

function hasValidAuthPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const user = payload.user;
  const session = payload.session;
  if (!user || typeof user !== 'object' || user.emailVerified !== true) return false;
  if (!session || typeof session !== 'object' || typeof session.token !== 'string') return false;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

async function hasAuthenticatedBrowserSession(request, env) {
  if (!env.AUTH_SERVICE) return false;
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const origin = request.headers.get('origin');
  if (origin) headers.set('origin', origin);
  try {
    const sessionRequest = new Request(new URL('/api/auth/get-session', request.url), {
      method: 'GET',
      headers,
    });
    const response = await env.AUTH_SERVICE.fetch(sessionRequest);
    if (!response.ok) return false;
    return hasValidAuthPayload(await response.json());
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/auth/')) {
      if (!env.AUTH_SERVICE) return Response.json({ error: 'auth_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
      // Keep the original allowlisted web URL, Origin and cookie. The auth Worker
      // enforces CSRF/host checks and emits host-only HttpOnly cookies.
      try { return await env.AUTH_SERVICE.fetch(request); }
      catch { return Response.json({ error: 'auth_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } }); }
    }
    if (path === '/_health') {
      return Response.json({ service: 'heavy-chain-web', hosting: 'cloudflare', authProvider: env.AUTH_SERVICE ? 'cloudflare' : 'unavailable' },
        { headers: { 'cache-control': 'no-store' } });
    }
    if (path === '/assets/AlimamaFangYuanTiVF-Thin.woff') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      }
      try {
        const response = await fetch(SOURCE_LIGHTCHAIN_FONT_URL, { method: request.method });
        if (!response.ok) return new Response('Font unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
        const headers = new Headers(response.headers);
        headers.set('content-type', 'font/woff');
        headers.set('cache-control', 'public, max-age=31536000, immutable');
        headers.set('access-control-allow-origin', '*');
        headers.set('x-content-type-options', 'nosniff');
        return new Response(request.method === 'HEAD' ? null : response.body, { status: 200, headers });
      } catch {
        return new Response('Font unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
      }
    }
    const serveHtml = async () => {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      if (headers.get('content-type')?.includes('text/html')) {
        headers.set('cache-control', 'no-store');
        headers.set('cdn-cache-control', 'no-store');
      }
      return new Response(response.body, { status: response.status, headers });
    };
    if (path === '/reset-password') {
      const response = await serveHtml();
      const headers = new Headers(response.headers);
      // The reset token is carried in the URL. Apply the no-store boundary even
      // when the asset binding returns a non-HTML fixture or error response.
      headers.set('cache-control', 'no-store');
      headers.set('cdn-cache-control', 'no-store');
      headers.set('referrer-policy', 'no-referrer');
      return new Response(response.body, { status: response.status, headers });
    }
    const manifest = JSON.parse(env.PUBLIC_ASSETS_JSON || '{}');
    const asset = Object.hasOwn(manifest, path) ? manifest[path] : null;
    if (!asset) {
      if (path.startsWith('/assets/') && /\.(onnx|wasm)$/.test(path)) return new Response('Not found', { status: 404 });
      if (isHtmlNavigationPath(path) && !PUBLIC_BROWSER_PATHS.has(path)) {
        const authenticated = await hasAuthenticatedBrowserSession(request, env);
        if (!authenticated) return sourceLoginRedirect(request);
      }
      return serveHtml();
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const etag = `"${asset.sha256}"`;
    const headers = new Headers({
      'content-type': asset.contentType,
      'content-length': String(asset.size),
      'cache-control': path.endsWith('/silueta.onnx') ? 'public, max-age=3600' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
      etag,
    });
    const conditions = (request.headers.get('if-none-match') || '').split(',').map(x => x.trim().replace(/^W\//, ''));
    if (conditions.includes(etag) || conditions.includes('*')) {
      headers.delete('content-length');
      return new Response(null, { status: 304, headers });
    }
    const ifRange = request.headers.get('if-range');
    const range = request.method === 'HEAD' || (ifRange && ifRange !== etag)
      ? null : parseRange(request.headers.get('range'), asset.size);
    if (range === false) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${asset.size}` } });
    }
    try {
      const object = request.method === 'HEAD'
        ? await env.PUBLIC_ASSETS.head(asset.key)
        : await env.PUBLIC_ASSETS.get(asset.key, range ? { range } : undefined);
      if (!object || object.size !== asset.size) return new Response('Asset unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
      if (range) {
        headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${asset.size}`);
        headers.set('content-length', String(range.length));
      }
      return new Response(request.method === 'HEAD' ? null : object.body, { status: range ? 206 : 200, headers });
    } catch {
      return new Response('Asset unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  },
};
