import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('separate app Auth databases: identity, recovery and MyPro data/R2 erasure through private RPC', async t => {
  const authRoot = new URL('..', import.meta.url).pathname;
  const heavyRoot = new URL('../../heavy-api/', import.meta.url).pathname;
  const myproRoot = process.env.MYPRO_API_ROOT!;
  assert.ok(myproRoot, 'MYPRO_API_ROOT is required');
  const options = { bundle: true, write: false as const, format: 'esm' as const, platform: 'neutral' as const,
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:workers'] };
  const auth = await build({ ...options, stdin: { resolveDir: authRoot, contents: `import {handleRequest} from './src/index.ts';
    export {MyProAccountLifecycle} from './src/mypro.ts';
    export default {fetch(request, env) {return handleRequest(request, {...env, EMAIL: {send: async builder => {
      const response = await env.TEST_MAIL_SEND.fetch(new Request('https://mail.test/send', {
        method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(builder),
      }));
      if (!response.ok) throw new Error('email_provider_rejected');
      return response.json();
    }}})}};` } });
  const heavy = await build({ ...options, entryPoints: [heavyRoot + '/src/index.ts'] });
  const mypro = await build({ ...options, entryPoints: [myproRoot + '/src/index.ts'] });
  const mail: Record<string, Array<{ from: string; to: string; subject: string; text: string }>> = { heavy: [], mypro: [] };
  const common = { modules: true, compatibilityDate: '2026-09-05', compatibilityFlags: ['nodejs_compat'] };
  const workers = ['heavy', 'mypro'].map(app => ({
    ...common, name: app + '-auth', routes: [app + '-auth.test/*'], script: auth.outputFiles[0].text,
    d1Databases: { AUTH_DB: app + '-auth-db' },
    bindings: { APP_ID: app, AUTH_SECRET: app + '-isolated-local-fixture-secret-1234567890',
      AUTH_BASE_URL: 'https://' + app + '-auth.test', WEB_ORIGINS: '',
      EMAIL_FROM: app === 'mypro' ? 'mypro@notify.nisen.uk' : 'heavy@notify.nisen.uk',
      EMAIL_DAILY_ATTEMPT_LIMIT: '1000', EMAIL_TOTAL_ATTEMPT_LIMIT: '10000' },
    serviceBindings: { TEST_MAIL_SEND: async (request: Request) => {
      const value = await request.json() as { from: string; to: string; subject: string; text: string };
      assert.equal(value.from, app === 'mypro' ? 'mypro@notify.nisen.uk' : 'heavy@notify.nisen.uk');
      assert.equal(value.to, 'same-person@example.test');
      assert.ok(value.subject.startsWith(app === 'mypro' ? 'MyPro' : 'Heavy Chain'));
      mail[app].push(value); return Response.json({ messageId: 'local-fixture' });
    } },
  }));
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    ...workers,
    { ...common, name: 'heavy', routes: ['heavy.test/*'], script: heavy.outputFiles[0].text,
      d1Databases: { DB: 'heavy-db' }, r2Buckets: { PRIVATE_MEDIA: 'heavy-private' },
      bindings: { AUTH_ISSUER: 'https://heavy-auth.test', FRONTEND_ORIGINS: 'https://heavy.test' },
      serviceBindings: { AUTH_SERVICE: 'heavy-auth' } },
    { ...common, name: 'mypro', routes: ['mypro.test/*'], script: mypro.outputFiles[0].text,
      d1Databases: { DB: 'mypro-db' }, r2Buckets: { MEDIA_BUCKET: 'mypro-private' },
      bindings: { AUTH_ISSUER: 'https://mypro-auth.test' }, serviceBindings: { AUTH_SERVICE: 'mypro-auth',
        AUTH_LIFECYCLE: { name: 'mypro-auth', entrypoint: 'MyProAccountLifecycle' } } },
  ] }));
  t.after(() => mf.dispose());
  for (const [worker, dir, binding] of [['heavy-auth', authRoot, 'AUTH_DB'], ['mypro-auth', authRoot, 'AUTH_DB'],
      ['heavy', heavyRoot, 'DB'], ['mypro', myproRoot, 'DB']]) {
    const db = await mf.getD1Database(binding, worker);
    for (const file of readdirSync(dir + '/migrations').filter(f => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(dir + '/migrations/' + file, 'utf8');
      const statements = sql.includes('-- statement-breakpoint') ? sql.split('-- statement-breakpoint') : sql.replace(/^\s*--.*$/gm, '').split(';');
      for (const statement of statements.map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
  }
  const call = (worker: string, path: string, body?: unknown, token?: string) => mf.dispatchFetch('https://' + worker + '.test' + path, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json', origin: 'https://' + worker + '.test' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const credentials = { email: 'same-person@example.test', password: 'local-only-password-123' };
  const tokens: Record<string, string> = {}, ids: Record<string, string> = {};
  for (const app of ['heavy', 'mypro']) {
    assert.equal((await call(app + '-auth', '/api/auth/sign-up/email', { ...credentials, name: 'Fixture' })).status, 200);
    const verify = new URL(mail[app].at(-1)!.text.match(/https:\/\/\S+/)![0]);
    assert.equal(verify.origin, 'https://' + app + '-auth.test');
    assert.ok((await call(app + '-auth', verify.pathname + verify.search)).status < 400);
    const login = await call(app + '-auth', '/api/auth/sign-in/email', credentials);
    assert.equal(login.status, 200); tokens[app] = login.headers.get('set-auth-token')!;
    const profile = await call(app, '/v1/profile', undefined, tokens[app]);
    assert.equal(profile.status, 200);
    ids[app] = (await profile.json() as { id: string }).id;
  }
  assert.notEqual(ids.heavy, ids.mypro);
  assert.equal((await call('heavy', '/v1/profile', undefined, tokens.mypro)).status, 401);
  assert.equal((await call('mypro', '/v1/profile', undefined, tokens.heavy)).status, 401);
  const resetPage = await call('mypro-auth', '/reset-password?token=must-not-render');
  assert.equal(resetPage.status, 200);
  assert.equal(resetPage.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(resetPage.headers.get('cache-control'), 'no-store');
  assert.match(resetPage.headers.get('content-security-policy')!, /script-src 'nonce-/);
  const html = await resetPage.text();
  assert.ok(!html.includes('must-not-render')); assert.match(html, /history.replaceState/);
  const reset = await call('mypro-auth', '/api/auth/request-password-reset', {
    email: credentials.email, redirectTo: 'https://mypro-auth.test/reset-password',
  });
  assert.equal(reset.status, 200);
  assert.equal(mail.mypro.at(-1)!.from, 'mypro@notify.nisen.uk');
  assert.equal(mail.mypro.at(-1)!.subject, 'MyPro — パスワードの再設定');
  assert.match(mail.mypro.at(-1)!.text, /^パスワードを再設定してください。\n\nhttps:\/\/mypro-auth\.test\/api\/auth\/reset-password/);
  assert.match(mail.mypro.at(-1)!.text, /心当たりがない場合は、このメールを破棄してください。$/);
  const resetLink = new URL(mail.mypro.at(-1)!.text.match(/https:\/\/\S+/)![0]);
  const redirected = await call('mypro-auth', resetLink.pathname + resetLink.search);
  const token = new URL(redirected.headers.get('location')!).searchParams.get('token');
  assert.ok(token);
  assert.equal((await call('mypro-auth', '/api/auth/reset-password', { token, newPassword: 'mypro-new-password-456' })).status, 200);
  assert.equal((await call('mypro', '/v1/profile', undefined, tokens.mypro)).status, 401);
  assert.equal((await call('heavy', '/v1/profile', undefined, tokens.heavy)).status, 200);
  assert.equal((await call('heavy-auth', '/api/auth/sign-in/email', credentials)).status, 200);
  // Actual MyPro API is now the RPC caller, with D1/R2 cleanup before finish.
  const nextLogin = await call('mypro-auth', '/api/auth/sign-in/email', { ...credentials, password: 'mypro-new-password-456' });
  const nextToken = nextLogin.headers.get('set-auth-token')!;
  const receipt = 'b'.repeat(64);
  assert.equal((await call('mypro-auth', '/v1/account-erasure/finish', { requestId: receipt })).status, 404);
  assert.equal((await call('mypro-auth', '/api/auth/delete-user', {}, nextToken)).status, 404);
  const native = (path: string, body: unknown, token?: string, method = 'POST') => mf.dispatchFetch('https://mypro.test' + path, {
    method, headers: { 'content-type': typeof body === 'string' ? 'image/png' : 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const keys: string[] = [];
  for (const bucket of ['meal-images', 'analysis-previews', 'chat-media', 'feedback-screenshots', 'story-media', 'profile-images', 'post-images']) {
    const allocation = await native('/v1/media', { clientRequestId: bucket, bucket,
      objectPath: ids.mypro + '/' + bucket + '.png', contentType: 'image/png', declaredSizeBytes: 3 }, nextToken);
    assert.equal(allocation.status, 201, await allocation.clone().text());
    const { id } = await allocation.json() as { id: string }; keys.push('objects/' + id);
    assert.equal((await native('/v1/media/' + id + '/content', 'abc', nextToken, 'PUT')).status, 200);
  }
  const myproData = await mf.getD1Database('DB', 'mypro');
  const meal = crypto.randomUUID();
  await myproData.prepare("INSERT INTO meal_logs (id,user_id,created_at,calories,protein) VALUES (?,?,'now',1,1)").bind(meal, ids.mypro).run();
  const request = { receipt, confirmation: 'delete-mypro-account' };
  const myproDB = await mf.getD1Database('AUTH_DB', 'mypro-auth');
  // Cancellation traverses the actual MyPro API -> named Auth RPC, never a
  // public test bridge. It preserves data and both apps' sessions, and the
  // cancelled receipt cannot later be repurposed as deletion authority.
  const cancelledReceipt = 'c'.repeat(64);
  const cancelled = await native('/v1/account-erasure/cancel', {
    receipt: cancelledReceipt, confirmation: 'cancel-mypro-account-erasure',
  }, nextToken);
  assert.equal(cancelled.status, 200, await cancelled.clone().text());
  assert.deepEqual(await cancelled.json(), {success: true, state: 'cancelled'});
  assert.deepEqual(await (await native('/v1/account-erasure/status', {receipt: cancelledReceipt})).json(), {success: true, state: 'cancelled'});
  assert.deepEqual(await (await native('/v1/account-erasure', {receipt: cancelledReceipt, confirmation: 'delete-mypro-account'}, nextToken)).json(), {success: true, state: 'cancelled'});
  assert.equal((await call('mypro', '/v1/profile', undefined, nextToken)).status, 200);
  assert.equal((await call('heavy', '/v1/profile', undefined, tokens.heavy)).status, 200);
  assert.equal((await myproDB.prepare('SELECT count(*) n FROM auth_erasure').first<{n:number}>())!.n, 0);
  const authCancel = await myproDB.prepare('SELECT request_id FROM auth_erasure_cancellations').first<{request_id:string}>();
  const apiCancel = await myproData.prepare('SELECT request_id,state FROM account_erasure_cancellations').first<{request_id:string;state:string}>();
  assert.equal(authCancel!.request_id, apiCancel!.request_id);
  assert.notEqual(authCancel!.request_id, cancelledReceipt); assert.equal(apiCancel!.state, 'cancelled');
  assert.equal((await myproData.prepare('SELECT count(*) n FROM meal_logs').first<{n:number}>())!.n, 1);
  const intactBucket = await mf.getR2Bucket('MEDIA_BUCKET', 'mypro');
  for (const key of keys) assert.equal(await (await intactBucket.get(key))!.text(), 'abc');
  for (const provider of ['apple', 'google']) {
    await myproDB.prepare('INSERT INTO account (id,issuer,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)')
      .bind(provider, provider, provider, provider, ids.mypro, 'now', 'now').run();
  }
  const begin = await native('/v1/account-erasure', request, nextToken);
  assert.equal(begin.status, 202, await begin.clone().text());
  assert.equal((await begin.json() as { success: boolean }).success, false);
  assert.equal((await call('mypro', '/v1/profile', undefined, nextToken)).status, 401);
  assert.equal((await call('heavy', '/v1/profile', undefined, tokens.heavy)).status, 200);
  const done = { success: true, state: 'completed', manualRevocation: ['apple', 'google'] };
  assert.deepEqual(await (await native('/v1/account-erasure', request)).json(), done);
  assert.deepEqual(await (await native('/v1/account-erasure/status', { receipt })).json(), done);
  assert.equal((await native('/v1/account-erasure/cancel', {receipt, confirmation: 'cancel-mypro-account-erasure'})).status, 409);
  assert.deepEqual(await (await native('/v1/account-erasure', request)).json(), done);
  assert.equal((await myproDB.prepare('SELECT count(*) AS n FROM user').first<{ n: number }>())!.n, 0);
  assert.equal((await myproDB.prepare('SELECT count(*) AS n FROM session').first<{ n: number }>())!.n, 0);
  assert.equal((await myproDB.prepare('SELECT count(*) AS n FROM account').first<{ n: number }>())!.n, 0);
  for (const table of ['profiles', 'user_identities', 'meal_logs', 'media_objects'])
    assert.equal((await myproData.prepare('SELECT count(*) AS n FROM ' + table).first<{ n: number }>())!.n, 0, table);
  const bucket = await mf.getR2Bucket('MEDIA_BUCKET', 'mypro');
  for (const key of keys) {
    const object = await bucket.get(key); assert.equal(object!.size, 0);
    assert.equal(await object!.text(), ''); assert.deepEqual(object!.customMetadata, { erased: '1' });
  }
  const heavyDB = await mf.getD1Database('AUTH_DB', 'heavy-auth');
  assert.equal((await heavyDB.prepare('SELECT count(*) AS n FROM user').first<{ n: number }>())!.n, 1);
  assert.equal((await call('heavy', '/v1/profile', undefined, tokens.heavy)).status, 200);
  assert.equal((await call('mypro-auth', '/api/auth/sign-in/email', { ...credentials, password: 'mypro-new-password-456' })).status, 401);
});
