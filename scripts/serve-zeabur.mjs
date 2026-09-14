import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DIST_ROOT = resolve(process.env.DIST_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
const AUTH_DEFAULT = 'https://consumer-auth.nichika2000823.workers.dev';
const BODY_LIMIT = 16 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function authBaseUrl() {
  const raw = Object.hasOwn(process.env, 'AUTH_BASE_URL') ? process.env.AUTH_BASE_URL : AUTH_DEFAULT;
  if (!raw || raw.trim() === '') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function json(res, status, code, message, extra = {}) {
  const body = JSON.stringify({ error: { code, message, ...extra } });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function isResetPassword(pathname) {
  return pathname === '/reset-password' || pathname.startsWith('/reset-password/');
}

function setResetHeaders(headers, pathname) {
  if (isResetPassword(pathname)) {
    headers['Cache-Control'] = 'no-store';
    headers['Referrer-Policy'] = 'no-referrer';
  }
  return headers;
}

function safeDistPath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.startsWith('//')) return null;
  const candidate = resolve(DIST_ROOT, `.${decoded}`);
  const rel = relative(DIST_ROOT, candidate);
  return rel.startsWith('..') || rel.includes(`..${'/'}`) || rel.includes(`..\\`) ? null : candidate;
}

function hasTraversalTarget(requestTarget) {
  let path = requestTarget.split('?', 1)[0];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { path = decodeURIComponent(path); } catch { return true; }
    if (path.split(/[\\/]/).some((segment) => segment === '..')) return true;
  }
  return false;
}

function contentType(filePath) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.onnx': 'application/octet-stream', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  return types[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, 'method_not_allowed', 'Only GET and HEAD are supported.');
  let filePath = safeDistPath(url.pathname);
  if (!filePath) return json(res, 400, 'invalid_path', 'Invalid request path.');
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(DIST_ROOT, 'index.html');
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return json(res, 404, 'not_found', 'Resource not found.');
  const size = statSync(filePath).size;
  const headers = setResetHeaders({ 'Content-Type': contentType(filePath), 'Content-Length': size }, url.pathname);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
}

async function readBody(req) {
  const length = Number.parseInt(req.headers['content-length'] || '', 10);
  if (Number.isFinite(length) && length > BODY_LIMIT) return { tooLarge: true };
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > BODY_LIMIT) return { tooLarge: true };
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks) };
}

async function proxyAuth(req, res, url) {
  const base = authBaseUrl();
  if (!base) return json(res, 503, 'auth_proxy_unavailable', 'Authentication proxy is not configured with a valid HTTPS AUTH_BASE_URL.');
  const suffix = url.pathname.slice('/api/auth'.length);
  if (!suffix.startsWith('/') || suffix.startsWith('//')) return json(res, 404, 'not_found', 'Authentication route not found.');
  const target = new URL(base);
  target.pathname = `${target.pathname.replace(/\/$/, '')}/api/auth${suffix}`;
  target.search = url.search;
  const bodyResult = req.method === 'GET' || req.method === 'HEAD' ? { body: undefined } : await readBody(req);
  if (bodyResult.tooLarge) return json(res, 413, 'request_body_too_large', 'Authentication request body must be at most 16 KiB.');
  const headers = new Headers();
  for (const name of ['cookie', 'origin', 'authorization', 'content-type', 'accept', 'accept-language']) {
    const value = req.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  try {
    const upstream = await fetch(target, { method: req.method, headers, body: bodyResult.body, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const responseHeaders = { 'Cache-Control': 'no-store' };
    for (const name of ['content-type', 'content-length', 'location', 'www-authenticate']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    const cookies = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
    if (cookies.length) responseHeaders['set-cookie'] = cookies;
    res.writeHead(upstream.status, responseHeaders);
    if (req.method === 'HEAD' || upstream.status === 204 || upstream.status === 304) return res.end();
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    json(res, 502, 'auth_upstream_failed', 'Authentication service is unavailable.');
  }
}

const server = createServer(async (req, res) => {
  if (hasTraversalTarget(req.url || '/')) return json(res, 400, 'invalid_path', 'Invalid request path.');
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/_health') {
    const configured = Boolean(authBaseUrl());
    const body = JSON.stringify({ status: 'ok', hosting: 'zeabur', cloudflare: { api: true, auth: configured } });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    return req.method === 'HEAD' ? res.end() : res.end(body);
  }
  if (url.pathname.startsWith('/api/auth/')) return proxyAuth(req, res, url);
  return serveStatic(req, res, url);
});

server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
server.listen(PORT, HOST, () => console.log(`heavy-chain-zeabur-server listening on ${HOST}:${PORT}`));
