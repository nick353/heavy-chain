import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('real workerd bindings: common identity/data plus browser proxy login/logout/recovery revocation', async t => {
  assert.ok(process.env.MYPRO_API_ROOT, 'Set MYPRO_API_ROOT to the MyPro cloudflare/mypro-api directory');
  const heavyRoot = new URL('../../heavy-api/', import.meta.url).pathname;
  const myproRoot = path.resolve(process.env.MYPRO_API_ROOT);
  const authRoot = new URL('..', import.meta.url).pathname;
  const bundleOptions = { bundle: true, write: false as const, format: 'esm' as const, platform: 'neutral' as const,
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*'] };
  const [auth, heavy, mypro, web, browser] = await Promise.all([
    build({ ...bundleOptions, stdin: { contents: `import { handleRequest } from './src/index.ts';
      export default { fetch(request, env) { return handleRequest(request, { ...env,
        EMAIL: { send: async builder => {
          const response = await env.TEST_MAIL_SEND.fetch(new Request('https://mail.test/send', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(builder),
          }));
          if (!response.ok) throw new Error('email_provider_rejected');
          return response.json();
        } },
      }); } };`, resolveDir: authRoot } }),
    build({ ...bundleOptions, entryPoints: [path.join(heavyRoot, 'src/index.ts')] }),
    build({ ...bundleOptions, entryPoints: [path.join(myproRoot, 'src/index.ts')] }),
    build({ ...bundleOptions, entryPoints: [new URL('../../heavy-web/src/index.mjs', import.meta.url).pathname] }),
    build({ ...bundleOptions, entryPoints: [new URL('../../../src/lib/cloudflareBrowserAuth.ts', import.meta.url).pathname] }),
  ]);
  // Compile browser code in its own DOM type environment (the Heavy build checks
  // it); do not mix browser lib.dom globals into this Worker's TS environment.
  const { createCloudflareBrowserAuth } = await import(`data:text/javascript;base64,${Buffer.from(browser.outputFiles[0].text).toString('base64')}`);
  const mail: Array<{ from: string; to: string; subject: string; text: string }> = [];
  const common = { modules: true, compatibilityDate: '2026-09-05', compatibilityFlags: ['nodejs_compat'] };
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { ...common, name: 'auth', routes: ['auth.test/*'], script: auth.outputFiles[0].text,
      bindings: { AUTH_SECRET: 'integration-local-secret-only-1234567890', AUTH_BASE_URL: 'https://auth.test', WEB_ORIGINS: 'https://heavy.test,https://web.test', EMAIL_FROM: 'auth@example.test',
        EMAIL_DAILY_ATTEMPT_LIMIT: '1000', EMAIL_TOTAL_ATTEMPT_LIMIT: '10000' },
      d1Databases: { AUTH_DB: 'auth-db' },
      serviceBindings: { TEST_MAIL_SEND: async request => {
        mail.push(await request.json() as { from: string; to: string; subject: string; text: string });
        return Response.json({ messageId: 'test-only' });
      } },
    },
    { ...common, name: 'heavy', routes: ['heavy.test/*'], script: heavy.outputFiles[0].text, d1Databases: { DB: 'heavy-db' }, r2Buckets: { PRIVATE_MEDIA: 'heavy-private' },
      bindings: { AUTH_ISSUER: 'https://auth.test', FRONTEND_ORIGINS: 'https://heavy.test', MEDIA_READ_SECRET: 'local-media-secret' }, serviceBindings: { AUTH_SERVICE: 'auth' } },
    { ...common, name: 'mypro', routes: ['mypro.test/*'], script: mypro.outputFiles[0].text, d1Databases: { DB: 'mypro-db' }, r2Buckets: { MEDIA_BUCKET: 'mypro-private' },
      bindings: { AUTH_ISSUER: 'https://auth.test' }, serviceBindings: { AUTH_SERVICE: 'auth' } },
    { ...common, name: 'web', routes: ['web.test/*'], script: web.outputFiles[0].text, serviceBindings: { AUTH_SERVICE: 'auth' } },
  ] }));
  t.after(() => mf.dispose());
  for (const [worker, root, binding] of [['auth', authRoot, 'AUTH_DB'], ['heavy', heavyRoot, 'DB'], ['mypro', myproRoot, 'DB']]) {
    const db = await mf.getD1Database(binding, worker);
    for (const file of readdirSync(path.join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(path.join(root, 'migrations', file), 'utf8').replace(/^\s*--.*$/gm, '');
      const statements = readFileSync(path.join(root, 'migrations', file), 'utf8').includes('-- statement-breakpoint')
        ? readFileSync(path.join(root, 'migrations', file), 'utf8').split('-- statement-breakpoint')
        : sql.split(';');
      for (const statement of statements.map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
  }
  const call = (worker: 'auth' | 'heavy' | 'mypro', route: string, body?: unknown, token?: string) => mf.dispatchFetch(`https://${worker}.test${route}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: {
      'cf-connecting-ip': '192.0.2.30', ...(body === undefined ? {} : { 'content-type': 'application/json', origin: `https://${worker}.test` }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const credentials = { email: 'integration@example.test', password: 'integration-only-password-123' };
  const registration = await call('auth', '/api/auth/sign-up/email', { ...credentials, name: 'Integration', callbackURL: 'https://heavy.test/login' });
  assert.equal(registration.status, 200, await registration.clone().text());
  assert.deepEqual(mail[0], {
    from: 'auth@example.test', to: credentials.email,
    subject: 'Heavy Chain — メールアドレスの確認', text: mail[0]!.text,
  });
  const link = new URL(mail.at(-1)!.text.match(/https:\/\/\S+/)![0]);
  assert.equal((await call('auth', link.pathname + link.search)).status, 302);
  const signedIn = await call('auth', '/api/auth/sign-in/email', credentials);
  assert.equal(signedIn.status, 200); const token = signedIn.headers.get('set-auth-token')!; assert.ok(token);
  const ids = [];
  for (const worker of ['heavy', 'mypro'] as const) {
    const response = await call(worker, '/v1/profile', undefined, token);
    assert.equal(response.status, 200, await response.clone().text());
    ids.push((await response.json() as { id: string }).id);
  }
  assert.equal(ids[0], ids[1]);
  const brandResponse = await call('heavy', '/v1/brands', { name: 'Integration brand' }, token);
  assert.equal(brandResponse.status, 201, await brandResponse.clone().text());
  const brand = await brandResponse.json() as { id: string };
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/f0AAAAASUVORK5CYII=';
  const artifact = { requestId: crypto.randomUUID(), brandId: brand.id, featureType: 'ai-fitting', imageUrl: `data:image/png;base64,${png}`, title: 'Local fixture', metadata: {} };
  const saved = await call('heavy', '/v1/workspace-artifacts', artifact, token);
  assert.equal(saved.status, 200, await saved.clone().text());
  const result = await saved.json() as { remote: { imageId: string } };
  const read = await call('heavy', `/v1/generated-images/${result.remote.imageId}/content`, undefined, token);
  assert.equal(read.status, 200); assert.deepEqual(Buffer.from(await read.arrayBuffer()), Buffer.from(png, 'base64'));
  const retried = await call('heavy', '/v1/workspace-artifacts', artifact, token);
  assert.equal(retried.status, 200); assert.deepEqual(await retried.json(), result);
  const meal = await call('mypro', '/v1/meals', { calories: 500, protein: 30, carbs: 40, fat: 15, name: 'Lunch', meal_nutrients: [{ code: 'FE', amount: 2.5 }] }, token);
  assert.equal(meal.status, 201, await meal.clone().text());
  const meals = await call('mypro', '/v1/meals', undefined, token);
  assert.equal(meals.status, 200); assert.equal((await meals.json() as unknown[]).length, 1);
  assert.equal((await call('auth', '/api/auth/sign-out', {}, token)).status, 200);
  for (const worker of ['heavy', 'mypro'] as const) assert.equal((await call(worker, '/v1/profile', undefined, token)).status, 401);
  assert.equal((await call('heavy', `/v1/generated-images/${result.remote.imageId}/content`, undefined, token)).status, 401);

  // Exercise the production browser adapter through the actual web service proxy.
  // This cookie jar models the browser; the visible UI is verified separately.
  const cookies = new Map<string, string>();
  const browserFetch: typeof fetch = async (input, init) => {
    const url = String(input); assert.equal(new URL(url).origin, 'https://web.test');
    assert.equal(init?.credentials, 'include'); assert.equal(init?.cache, 'no-store');
    const headers = new Headers(init?.headers);
    headers.set('origin', 'https://web.test'); headers.set('cf-connecting-ip', '192.0.2.31');
    if (cookies.size) headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const requestHeaders: Record<string, string> = {}; headers.forEach((value, key) => { requestHeaders[key] = value; });
    const response = await mf.dispatchFetch(url, { method: init?.method, headers: requestHeaders,
      ...(init?.body ? { body: String(init.body) } : {}), redirect: 'manual' });
    for (const setCookie of response.headers.getSetCookie()) {
      assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /Secure/i); assert.match(setCookie, /SameSite=Lax/i);
      const [pair] = setCookie.split(';'); const index = pair.indexOf('=');
      const name = pair.slice(0, index); const value = pair.slice(index + 1);
      if (/Max-Age=0/i.test(setCookie)) cookies.delete(name); else cookies.set(name, value);
    }
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const responseHeaders: Record<string, string> = {}; response.headers.forEach((value, key) => { responseHeaders[key] = value; });
    return new Response(new Uint8Array(await response.arrayBuffer()), { status: response.status, headers: responseHeaders });
  };
  const client = createCloudflareBrowserAuth(browserFetch, 'https://web.test');
  t.after(() => client.dispose());
  const browserLogin = await client.signInWithPassword(credentials);
  assert.equal(browserLogin.error, null);
  const browserToken = browserLogin.data.session!.access_token;
  for (const worker of ['heavy', 'mypro'] as const) assert.equal((await call(worker, '/v1/profile', undefined, browserToken)).status, 200);
  assert.equal((await client.refreshSession()).data.session?.user.id, ids[0]);
  assert.equal((await client.signOut()).error, null);
  assert.equal((await client.getSession()).data.session, null);
  for (const worker of ['heavy', 'mypro'] as const) assert.equal((await call(worker, '/v1/profile', undefined, browserToken)).status, 401);
  const beforeReset = await client.signInWithPassword(credentials);
  assert.equal(beforeReset.error, null);
  const beforeResetToken = beforeReset.data.session!.access_token;
  assert.equal((await client.resetPasswordForEmail(credentials.email)).error, null);
  const recoveryLink = new URL(mail.at(-1)!.text.match(/https:\/\/\S+/)![0]);
  assert.equal(recoveryLink.origin, 'https://web.test');
  const recoveryResponse = await browserFetch(recoveryLink, { credentials: 'include', cache: 'no-store' });
  assert.equal(recoveryResponse.status, 302);
  const callback = new URL(recoveryResponse.headers.get('location')!);
  assert.equal(callback.origin + callback.pathname, 'https://web.test/reset-password');
  const newPassword = 'integration-new-password-456';
  await client.completePasswordReset(callback.searchParams.get('token')!, newPassword);
  for (const worker of ['heavy', 'mypro'] as const) assert.equal((await call(worker, '/v1/profile', undefined, beforeResetToken)).status, 401);
  assert.ok((await client.signInWithPassword(credentials)).error);
  const newLogin = await client.signInWithPassword({ ...credentials, password: newPassword });
  assert.equal(newLogin.error, null);
  assert.equal(newLogin.data.user?.id, ids[0]);
});
