import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from '../../tailwind.config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePath = 'src/components/lightchain/SourceModelLibrarySurface.tsx';
const expectedProductHash = 'd2531987bb9eed946a7bd365de7be73c1765ba835452dccbbea9dca5fbf1d4eb';
const entry = '/scripts/browser/model-combobox-native-probe.tsx';
const mocks = resolve(root, 'scripts/browser/model-combobox-native-probe-mocks.ts');
const mockImports = new Set(['react-router-dom', '../../hooks/useCanonicalImageWorkspace', '../CanonicalImageWorkspaceControls', '../../stores/authStore', '../../lib/localWorkspaceArtifacts', '../../lib/lightchainResume', '../../lib/cloudflareApi', '../../lib/authBrandSelection']);
export const probeCsp = "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'";
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Model combobox native fixture</title><link rel="stylesheet" href="/__model-native-probe.css"><style>body{margin:0;background:#171b1c;color:white}#model-native-diagnostics{position:fixed;right:8px;top:8px;width:min(38vw,560px);max-height:90vh;overflow:auto;background:#0c1011e8;border:1px solid #65d3cf;padding:10px;font:11px/1.45 monospace;z-index:50;pointer-events:none;white-space:pre-wrap}</style></head><body><div id="model-native-root"></div><pre id="model-native-diagnostics" aria-label="Read-only fixture diagnostics"></pre><script type="module" src="${entry}"></script></body></html>`;

export function parseProbeArguments(args) {
  if (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1])) throw new Error('model_native_probe_requires_exact_port');
  const port = Number(args[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('model_native_probe_port_invalid');
  return { port };
}

// Creating/transforming does not listen. Root alone activates the exact port.
export async function createModelNativeProbe({ port }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('model_native_probe_requires_exact_port');
  const productHash = createHash('sha256').update(readFileSync(resolve(root, sourcePath))).digest('hex');
  if (productHash !== expectedProductHash) throw new Error('model_native_probe_product_hash_mismatch');
  // Serve static compiled CSS, avoiding Vite's CSS runtime/WebSocket client.
  // Product files/config remain untouched; optional external font import is
  // excluded from this localhost-only fixture's rendered stylesheet.
  const fixtureCss = (await postcss([tailwindcss({ ...tailwindConfig, content: tailwindConfig.content.map(pattern => resolve(root, pattern)) }), autoprefixer()]).process(readFileSync(resolve(root, 'src/index.css'), 'utf8').replace(/^@import url\('https:[^\n]+\n/, ''), { from: resolve(root, 'src/index.css') })).css;
  let vite;
  async function modelNativeBoundary(req, res, next) {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    res.setHeader('Content-Security-Policy', probeCsp);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(403); res.end('model_native_probe_mutation_forbidden'); return; }
    if (pathname === '/' || pathname === '/__model-native-probe') {
      try {
        const transformed = (await vite.transformIndexHtml(pathname, html)).replace(/\s*<script type="module" src="\/@vite\/client"><\/script>/, '');
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(transformed);
      } catch (error) { res.writeHead(500); res.end(String(error)); }
      return;
    }
    if (pathname === '/__model-native-probe.css') { res.setHeader('Content-Type', 'text/css; charset=utf-8'); res.end(fixtureCss); return; }
    const allowed = pathname === entry || pathname === '/scripts/browser/model-combobox-native-probe-mocks.ts' || pathname === '/' + sourcePath || pathname.startsWith('/node_modules/.vite/');
    if (!allowed) { res.writeHead(403); res.end('model_native_probe_undeclared_route'); return; }
    next();
  }
  vite = await createServer({
    root, configFile: false, envFile: false, envPrefix: [], appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'lucide-react'] },
    ssr: { noExternal: ['react-router-dom'] },
    plugins: [{
      name: 'model-native-service-boundaries', enforce: 'pre',
      resolveId(source, importer) {
        if (importer?.split('?')[0] === resolve(root, sourcePath) && mockImports.has(source)) return mocks;
      },
      configureServer(server) { server.middlewares.use(modelNativeBoundary); },
    }, react()],
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null, fs: { strict: true, allow: [root] } },
  });
  return { vite, productHash, readyUrl: `http://127.0.0.1:${port}/__model-native-probe` };
}

export async function startModelNativeProbe(options) {
  const probe = await createModelNativeProbe(options);
  try { await probe.vite.listen(); } catch (error) { await probe.vite.close(); throw error; }
  const address = probe.vite.httpServer?.address();
  if (!address || typeof address === 'string' || address.port !== options.port) { await probe.vite.close(); throw new Error('model_native_probe_exact_port_not_bound'); }
  return probe;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const probe = await startModelNativeProbe(parseProbeArguments(process.argv.slice(2)));
  console.log(JSON.stringify({ contract: 'model-native-probe-ready.v1', pid: process.pid, readyUrl: probe.readyUrl, productHash: probe.productHash, port: probe.vite.config.server.port, strictPort: probe.vite.config.server.strictPort }));
}
