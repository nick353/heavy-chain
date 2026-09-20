import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

// Test the synthetic fixture's durability in fresh OS processes. No browser,
// production account, model or existing probe run is touched by this test.
test('print fixture survives process restarts with one inference and GET-only lost-save recovery', async t => {
  const output = await mkdtemp(join(tmpdir(), 'heavy-print-restart-'));
  const children = new Set();
  const stop = async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended;
    children.delete(child);
  };
  t.after(async () => {
    for (const child of children) await stop(child);
    await rm(output, { recursive: true, force: true });
  });
  const moduleUrl = new URL('./browser/print-input-probe-server.mjs', import.meta.url).href;
  const start = async () => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', `
      import { createServer } from 'node:http';
      import { installPrintInputProbe } from ${JSON.stringify(moduleUrl)};
      let handler;
      installPrintInputProbe({ middlewares: { use(fn) { handler = fn; } } }, {
        root: '.', origin: 'http://127.0.0.1', output: ${JSON.stringify(output)}
      });
      const server = createServer((req,res) => handler(req,res,() => { res.writeHead(404); res.end(); }));
      server.listen(0,'127.0.0.1',() => process.stdout.write(String(server.address().port)+'\\n'));
    `], { stdio: ['ignore','pipe','pipe'] });
    children.add(child);
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const port = await new Promise((resolve, reject) => {
      let text = '';
      const timeout = setTimeout(() => reject(new Error('fixture start timeout: ' + stderr)), 10000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('fixture exited: ' + stderr)); });
      child.stdout.on('data', chunk => {
        text += chunk;
        if (text.includes('\n')) { clearTimeout(timeout); resolve(Number(text.split('\n')[0])); }
      });
    });
    assert.ok(Number.isInteger(port) && port > 0);
    return { child, origin: `http://127.0.0.1:${port}` };
  };
  const runId = randomUUID(), requestId = randomUUID(), saveId = randomUUID();
  let server = await start();
  const call = async (path, body, id) => {
    const response = await fetch(`${server.origin}/__print-input-api/${runId}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(id ? {'idempotency-key': id} : {}) },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    return { status: response.status, body: await response.json() };
  };
  const fixture = { brandId: `print-probe-${runId}`, userId: 'print-probe-owner', providerImage: 'data:image/png;base64,c3ludGhldGlj' };
  assert.equal((await call('/bootstrap', fixture)).status, 200);
  const generated = await call('/v1/provider-actions/edit-image', {brandId: fixture.brandId, imageUrls: ['synthetic-input']}, requestId);
  assert.equal(generated.status, 200);
  const save = { requestId: saveId, metadata: {sourceRequest: requestId}, imageUrl: fixture.providerImage };
  assert.equal((await call('/v1/workspace-artifacts', save)).status, 503);
  await stop(server.child); server = await start();
  const recovered = await call('/v1/image-ai/requests/' + requestId);
  assert.deepEqual(recovered.body, generated.body);
  assert.equal((await call('/v1/workspace-artifacts/' + saveId)).status, 404);
  assert.equal((await call('/v1/workspace-artifacts', save)).status, 503);
  await stop(server.child); server = await start();
  const saved = await call('/v1/workspace-artifacts/' + saveId);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.imageUrl, save.imageUrl);
  assert.deepEqual(saved.body.metadata, save.metadata);
  const reuse = await call('/v1/workspace-artifacts', {sourceStoragePath: saved.body.remote.storagePath});
  assert.deepEqual(reuse.body, saved.body);
  const state = (await call('/state')).body;
  assert.equal(state.serverRestores, 2);
  assert.equal(state.providerPosts, 1); assert.equal(state.inferences, 1);
  assert.equal(state.finalSavePosts, 2); assert.equal(state.reusePosts, 1);
  assert.equal(state.receiptReads, 1); assert.equal(state.saveReads, 2);
  assert.equal(Object.keys(state.requests).length, 1); assert.equal(Object.keys(state.saves).length, 1);
  const disk = JSON.parse(await readFile(join(output, `${runId}-print-state.json`), 'utf8'));
  assert.deepEqual(disk, state);
});
