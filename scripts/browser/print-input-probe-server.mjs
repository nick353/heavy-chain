// Synthetic, loopback-only transport fixture for the real print workbench.
import { readFileSync, mkdirSync, writeFileSync, existsSync, lstatSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export function installPrintInputProbe(vite, { root, origin, output }) {
  const runs = new Map();
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  vite.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, origin);
    if (['/__print-input-probe', '/lightchain/printing-image'].includes(url.pathname)) {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      return res.end(readFileSync(resolve(root, 'scripts/browser/print-input-probe.html'), 'utf8'));
    }
    if (!url.pathname.startsWith('/__print-input-api/')) return next();
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'probe_origin_forbidden' });
    try {
      const [, , runId, ...parts] = url.pathname.split('/');
      if (!/^[0-9a-f-]{36}$/i.test(runId)) return json(res, 400, { error: 'probe_run_invalid' });
      const path = '/' + parts.join('/');
      let body;
      if (req.method === 'POST') {
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > 48 * 1024 * 1024) throw new Error('probe_body_too_large'); chunks.push(chunk); }
        body = JSON.parse(Buffer.concat(chunks));
      }
      let run = runs.get(runId);
      const checkpoint = output && resolve(output, `${runId}-print-state.json`);
      if (!run && checkpoint && existsSync(checkpoint)) {
        if (!lstatSync(checkpoint).isFile() || lstatSync(checkpoint).isSymbolicLink()) throw new Error('probe_checkpoint_not_regular');
        run = JSON.parse(readFileSync(checkpoint, 'utf8'));
        if (run.fixture?.brandId !== `print-probe-${runId}` || run.fixture?.userId !== 'print-probe-owner') throw new Error('probe_checkpoint_identity_mismatch');
        run.serverRestores = (run.serverRestores || 0) + 1;
        runs.set(runId, run);
      }
      if (path === '/bootstrap' && body && !run) {
        run = { fixture: body, mounts: 0, providerPosts: 0, inferences: 0, receiptReads: 0,
          finalSavePosts: 0, reusePosts: 0, saveReads: 0, mediaReads: 0, mountCounts: [], requests: {}, saves: {}, reports: {} };
        runs.set(runId, run);
      }
      if (!run) return json(res, 404, { error: 'probe_run_not_found' });
      // The loopback fixture must not lose its provider receipts when its
      // process ends between explicit browser reloads. Only synthetic run
      // state is written here; no production provider/auth is connected.
      const reply = (status, payload) => {
        if (checkpoint) {
          mkdirSync(output, { recursive: true, mode: 0o700 });
          const temporary = checkpoint + '.' + randomUUID() + '.tmp';
          writeFileSync(temporary, JSON.stringify(run) + '\n', { flag: 'wx', mode: 0o600 });
          renameSync(temporary, checkpoint);
        }
        return json(res, status, payload);
      };
      if (path === '/bootstrap') { run.mounts++; run.mountCounts.push([run.providerPosts, run.finalSavePosts, run.reusePosts]); return reply(200, run); }
      if (path === '/state') return json(res, 200, run);
      if (path === '/report') {
        if (!['native', 'initial', 'final'].includes(body.phase)) throw new Error('probe_report_phase_invalid');
        const report = { ...body, at: new Date().toISOString(), server: { mounts: run.mounts, providerPosts: run.providerPosts,
          inferences: run.inferences, finalSavePosts: run.finalSavePosts, reusePosts: run.reusePosts, receiptReads: run.receiptReads,
          saveReads: run.saveReads, mediaReads: run.mediaReads, mountCounts: run.mountCounts } };
        run.reports[body.phase] = report;
        if (output) { mkdirSync(output, { recursive: true }); writeFileSync(resolve(output, `${runId}-print-${body.phase}-${Date.now()}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
        process.stdout.write(JSON.stringify({ printInputReport: { runId, phase: report.phase, status: report.status, checks: report.checks, server: report.server } }) + '\n');
        return reply(200, { ok: true });
      }
      if (path === '/v1/provider-actions/edit-image' && req.method === 'POST') {
        run.providerPosts++; const requestId = req.headers['idempotency-key'];
        if (!/^[0-9a-f-]{36}$/i.test(requestId) || body.brandId !== run.fixture.brandId) throw new Error('probe_request_identity_invalid');
        if (!run.requests[requestId]) {
          run.inferences++;
          const receipt = { success: true, state: 'completed', recovery: 'terminal', persistenceStatus: 'completed', requestId, jobId: 'ai-' + requestId,
            provider: 'workers_ai', backendProvider: 'cloudflare-workers-ai', providerModel: '@cf/black-forest-labs/flux-2-klein-4b',
            createdAt: new Date().toISOString(), requestedCandidateCount: 1, persistedCandidateCount: 1,
            protectedEdit: body.protectedEdit, requiresProtectedComposite: true, inputImageCount: body.imageUrls.length, featureType: body.featureType,
            metadata: { compositionPreview: body.compositionPreview, layerPlan: body.layerPlan },
            images: [{ candidateIndex: 0, imageId: `ai-${requestId}-0`, jobId: 'ai-' + requestId, storagePath: `generated-images/ai-${requestId}-0`,
              imageUrl: run.fixture.providerImage, persistenceStatus: 'completed' }] };
          run.requests[requestId] = { body, receipt };
        }
        return reply(200, run.requests[requestId].receipt);
      }
      if (path.startsWith('/v1/image-ai/requests/')) {
        run.receiptReads++; const request = run.requests[parts.at(-1)];
        return reply(request ? 200 : 404, request?.receipt ?? { error: 'image_request_not_found' });
      }
      if (path === '/v1/workspace-artifacts' && req.method === 'POST') {
        if (body.sourceStoragePath) {
          run.reusePosts++; const saved = Object.values(run.saves).find(item => item.remote.storagePath === body.sourceStoragePath);
          return reply(saved ? 200 : 404, saved ?? { error: 'workspace_artifact_not_found' });
        }
        run.finalSavePosts++;
        if (run.finalSavePosts === 1) return reply(503, { error: 'fixture_print_final_save_outage' });
        const imageId = 'wa-' + body.requestId;
        run.saves[body.requestId] = { success: true, remote: { imageId, jobId: imageId, storagePath: 'generated-images/' + imageId },
          metadata: body.metadata, imageUrl: body.imageUrl };
        if (run.finalSavePosts === 2) return reply(503, { error: 'fixture_print_final_save_response_lost' });
        return reply(200, run.saves[body.requestId]);
      }
      if (path.startsWith('/v1/workspace-artifacts/')) {
        run.saveReads++; const saved = run.saves[parts.at(-1)];
        return reply(saved ? 200 : 404, saved ?? { error: 'workspace_artifact_not_found' });
      }
      if (path === '/v1/media/read') {
        run.mediaReads++; const saved = Object.values(run.saves).find(item => item.remote.storagePath === url.searchParams.get('path'));
        return reply(saved ? 200 : 404, saved ? { url: `https://print-probe.invalid/${runId}/${saved.remote.imageId}.png`, imageUrl: saved.imageUrl } : { error: 'not_found' });
      }
      if (path.startsWith('/v1/generated-images') || path.startsWith('/v1/folders')) return json(res, 200, []);
      return json(res, 404, { error: 'print_probe_route_missing' });
    } catch (error) { return json(res, 500, { error: String(error.message) }); }
  });
}
