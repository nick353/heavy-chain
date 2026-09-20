// Independent local synthetic fixture. No production API/provider requests.
import { createServer } from 'vite';
const port = 4178;
const server = await createServer({ configFile: false, envFile: false, appType: 'custom',
  define: { 'import.meta.env.VITE_CLOUDFLARE_AUTH_ENABLED': '"true"', 'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"', 'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://history-probe.invalid"' },
  esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port, strictPort: true } });
let report = null;
server.middlewares.use(async (req, res, next) => {
  if (req.url === '/report') {
    if (req.method === 'POST') {
      if (req.headers.origin !== `http://127.0.0.1:${port}`) { res.statusCode = 403; return res.end(); }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      report = JSON.parse(Buffer.concat(chunks).toString()); console.log(JSON.stringify(report));
    }
    res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(report));
  }
  if (req.url === '/' || req.url?.startsWith('/lightchain/printing-image')) {
    res.setHeader('content-type', 'text/html');
    return res.end('<!doctype html><html><head><title>Print history scope probe</title></head><body><pre id="report" style="color:white;background:#111;padding:16px">Running synthetic history checks</pre><div id="root"></div><script type="module" src="/scripts/browser/print-history-probe.tsx"></script></body></html>');
  }
  next();
});
await server.listen(); console.log(`History probe http://127.0.0.1:${port}/`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
