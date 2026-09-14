import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, type V4WorkerOptions } from 'miniflare';

test('real workerd/Auth/D1/R2: feedback deduplication, admin privacy, restart and session revocation', async t => {
  const authRoot = new URL('../../consumer-auth/', import.meta.url).pathname;
  const heavyRoot = new URL('..', import.meta.url).pathname;
  const bundle = { bundle: true, write: false as const, format: 'esm' as const, platform: 'neutral' as const,
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:workers'] };
  const auth = await build({ ...bundle, stdin: { resolveDir: authRoot, contents: `import {handleRequest} from './src/index.ts';
    export default {fetch(request, env) {return handleRequest(request, {...env, EMAIL: {send: async message =>
      env.MAIL.fetch(new Request('https://mail.test', {method:'POST',body:JSON.stringify(message)})).then(r=>r.json())}})}};` } });
  const heavy = await build({ ...bundle, entryPoints: [heavyRoot + '/src/index.ts'] });
  const mail: string[] = [];
  const common = { modules: true, compatibilityDate: '2026-09-05', compatibilityFlags: ['nodejs_compat'] };
  const workers: V4WorkerOptions[] = [
    { ...common, name: 'auth', routes: ['auth.test/*'], script: auth.outputFiles[0].text,
      d1Databases: { AUTH_DB: 'auth-db' },
      bindings: { APP_ID: 'heavy', AUTH_SECRET: 'local-runtime-only-secret-1234567890-heavy', AUTH_BASE_URL: 'https://auth.test',
        WEB_ORIGINS: '', EMAIL_FROM: 'auth@example.test' },
      serviceBindings: { MAIL: async (request: Request) => { mail.push((await request.json() as { text: string }).text); return Response.json({ messageId: 'local-fixture' }); } } },
    { ...common, name: 'heavy', routes: ['heavy.test/*'], script: heavy.outputFiles[0].text,
      d1Databases: { DB: 'heavy-db' }, r2Buckets: { PRIVATE_MEDIA: 'heavy-private' },
      bindings: { AUTH_ISSUER: 'https://auth.test', FRONTEND_ORIGINS: 'https://heavy.test' },
      serviceBindings: { AUTH_SERVICE: 'auth' } },
  ];
  const options = { workers };
  const mf = new Miniflare(convertV4MiniflareOptions(options)); t.after(() => mf.dispose());
  for (const [worker, dir, binding] of [['auth', authRoot, 'AUTH_DB'], ['heavy', heavyRoot, 'DB']]) {
    const db = await mf.getD1Database(binding, worker);
    for (const file of readdirSync(dir + '/migrations').filter(f => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(dir + '/migrations/' + file, 'utf8');
      const statements = sql.includes('-- statement-breakpoint') ? sql.split('-- statement-breakpoint') : sql.replace(/^\s*--.*$/gm, '').split(';');
      for (const statement of statements.map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
  }
  const call = (worker: string, path: string, token?: string, value?: unknown, method = value === undefined ? 'GET' : 'POST') =>
    mf.dispatchFetch(`https://${worker}.test${path}`, { method, redirect: 'manual',
      headers: { origin: `https://${worker}.test`, ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  async function register(name: string) {
    const credentials = { email: `${name}@example.test`, password: 'local-test-only-long-password-4729' };
    const signup = await call('auth', '/api/auth/sign-up/email', undefined, { ...credentials, name });
    assert.equal(signup.status, 200, await signup.clone().text());
    const verification = new URL(mail.at(-1)!.match(/https:\/\/\S+/)![0]);
    assert.equal((await mf.dispatchFetch(verification.toString(), { redirect: 'manual' })).status, 302);
    const login = await call('auth', '/api/auth/sign-in/email', undefined, credentials);
    assert.equal(login.status, 200, await login.clone().text()); const token = login.headers.get('set-auth-token')!; assert(token);
    const profile = await call('heavy', '/v1/profile', token); assert.equal(profile.status, 200, await profile.clone().text());
    return { token, profile: await profile.json() as { id: string; is_admin: boolean } };
  }
  const author = await register('author'); const admin = await register('admin');
  assert.equal(admin.profile.is_admin, false);
  assert.equal((await call('heavy', '/v1/admin/feedback', admin.token)).status, 403);
  let db = await mf.getD1Database('DB', 'heavy');
  await db.prepare('INSERT INTO platform_admins VALUES (?,?,?)').bind(admin.profile.id, new Date().toISOString(), 'LOCAL RUNTIME TEST ONLY').run();
  const brand = await call('heavy', '/v1/brands', author.token, { name: 'Runtime Brand' });
  assert.equal(brand.status, 201); const brandId = (await brand.json() as { id: string }).id;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/f0AAAAASUVORK5CYII=';
  const input = { request_id: crypto.randomUUID(), brand_id: brandId, message: 'Runtime feedback', type: 'other',
    page_url: 'https://heavy.test/canvas?token=not-stored', screenshot_data_url: `data:image/png;base64,${png}`, screenshot_capture_status: 'captured' };
  const replies = await Promise.all([call('heavy', '/v1/feedback', author.token, input), call('heavy', '/v1/feedback', author.token, input)]);
  for (const response of replies) assert.equal(response.status, 200, await response.clone().text());
  const receipt = await replies[0].json() as { feedback: { id: string } }; assert.deepEqual(await replies[1].json(), receipt);
  let bucket = await mf.getR2Bucket('PRIVATE_MEDIA', 'heavy');
  assert.equal((await bucket.list({ prefix: 'feedback/v1/' })).objects.length, 1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM feedback_submissions').first<{ n: number }>())!.n, 1);
  const screenshotPath = `/v1/admin/feedback/${receipt.feedback.id}/screenshot`;
  assert.equal((await call('heavy', screenshotPath, author.token)).status, 403);
  let image = await call('heavy', screenshotPath, admin.token); assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, 'base64'));
  const update = await call('heavy', `/v1/admin/feedback/${receipt.feedback.id}`, admin.token, { revision: 0, status: 'done', admin_note: 'Verified' }, 'PATCH');
  assert.equal(update.status, 200); assert.equal((await update.json() as { revision: number }).revision, 1);
  const announcement = { request_id: crypto.randomUUID(), title: 'Runtime', content: 'Actual local Workers', type: 'maintenance' };
  assert.equal((await call('heavy', '/v1/admin/announcements', admin.token, announcement)).status, 200);
  assert.equal((await (await call('heavy', '/v1/announcements', author.token)).json() as unknown[]).length, 1);
  // A pending receipt can recover an already stored attachment after restart.
  await db.prepare("UPDATE feedback_submissions SET submission_state='pending' WHERE id=?").bind(receipt.feedback.id).run();
  await mf.setOptions(convertV4MiniflareOptions({ ...options, workers: workers.map(w => w.name === 'heavy' ? { ...w, script: heavy.outputFiles[0].text + '\n// restart' } : w) }));
  db = await mf.getD1Database('DB', 'heavy'); bucket = await mf.getR2Bucket('PRIVATE_MEDIA', 'heavy');
  assert.deepEqual(await (await call('heavy', '/v1/feedback', author.token, input)).json(), receipt);
  assert.equal((await bucket.list({ prefix: 'feedback/v1/' })).objects.length, 1);
  image = await call('heavy', screenshotPath, admin.token); assert.equal(image.status, 200); await image.arrayBuffer();
  assert.equal((await call('auth', '/api/auth/sign-out', admin.token, {})).status, 200);
  assert.equal((await call('heavy', screenshotPath, admin.token)).status, 401);
  assert.equal((await call('heavy', '/v1/admin/users', admin.token)).status, 401);
});
