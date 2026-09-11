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
    if (path === '/reset-password') {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('referrer-policy', 'no-referrer');
      headers.set('cache-control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    }
    const manifest = JSON.parse(env.PUBLIC_ASSETS_JSON || '{}');
    const asset = Object.hasOwn(manifest, path) ? manifest[path] : null;
    if (!asset) {
      if (path.startsWith('/assets/') && /\.(onnx|wasm)$/.test(path)) return new Response('Not found', { status: 404 });
      return env.ASSETS.fetch(request);
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
