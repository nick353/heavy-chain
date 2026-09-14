import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { generateKeyPair, exportJWK, exportPKCS8, jwtVerify, SignJWT } from 'jose';
import { symmetricDecrypt } from 'better-auth/crypto';

test('workerd + real local D1: verification, session refresh and revocation', async t => {
  const bundle = await build({
    stdin: { contents: `import { handleRequest } from './src/index.ts';
      export default { fetch(request, env) {
        return handleRequest(request, { ...env, EMAIL: { send: async builder => {
          const response = await env.TEST_MAIL_SEND.fetch(new Request('https://mail.test/send', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(builder),
          }));
          if (!response.ok) throw new Error('email_provider_rejected');
          return response.json();
        } } });
      } };`, resolveDir: new URL('..', import.meta.url).pathname, sourcefile: 'local-runtime-test.ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], external: ['node:*'],
  });
  const mail: Array<{ from: string; to: string; subject: string; text: string }> = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-05', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['AUTH_DB'], bindings: {
      AUTH_SECRET: 'runtime-local-only-1234567890-abcdef', AUTH_BASE_URL: 'https://auth.test', WEB_ORIGINS: 'https://web.test', EMAIL_FROM: 'auth@example.test',
    EMAIL_DAILY_ATTEMPT_LIMIT: '1000', EMAIL_TOTAL_ATTEMPT_LIMIT: '10000',
    }, serviceBindings: { TEST_MAIL_SEND: async request => {
      mail.push(await request.json() as { from: string; to: string; subject: string; text: string });
      return Response.json({ messageId: 'local-only' });
    } },
  }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('AUTH_DB');
  for (const file of ['0001_auth.sql', '0007_mail_budget.sql', '0008_auth_expiry_indexes.sql']) {
    const sql = readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const call = (path: string, body?: unknown, token?: string) => mf.dispatchFetch(`https://auth.test${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
    headers: { 'cf-connecting-ip': '192.0.2.10', ...(body === undefined ? {} : { 'content-type': 'application/json', origin: 'https://auth.test' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const credentials = { email: 'runtime@example.test', password: 'runtime-only-long-password-123' };
  const registration = await call('/api/auth/sign-up/email', { ...credentials, name: 'Runtime', callbackURL: 'https://web.test/login' });
  assert.equal(registration.status, 200, await registration.clone().text());
  assert.deepEqual(mail[0], {
    from: 'auth@example.test', to: credentials.email,
    subject: 'Heavy Chain — メールアドレスの確認', text: mail[0]!.text,
  });
  assert.match(mail[0]!.text, /^メールアドレスを確認してください。\n\nhttps:\/\/auth\.test\/api\/auth\/verify-email\?token=/);
  assert.equal((await call('/api/auth/sign-in/email', credentials)).status, 403);
  const verification = new URL(mail.at(-1)!.text.match(/https:\/\/\S+/)![0]);
  assert.equal((await call(verification.pathname + verification.search)).status, 302);
  const loggedIn = await call('/api/auth/sign-in/email', credentials);
  assert.equal(loggedIn.status, 200, await loggedIn.clone().text());
  const token = loggedIn.headers.get('set-auth-token'); assert.ok(token);
  assert.equal((await call('/v1/identity', undefined, token)).status, 200);
  // Age a real stored session to exercise Better Auth's sliding refresh on D1.
  const before = await db.prepare('SELECT expiresAt FROM session').first<{ expiresAt: string }>();
  await db.prepare('UPDATE session SET expiresAt = ?, updatedAt = ?')
    .bind(new Date(Date.now() + 3600000).toISOString(), new Date(Date.now() - 86400000 * 2).toISOString()).run();
  assert.equal((await call('/api/auth/get-session', undefined, token)).status, 200);
  const after = await db.prepare('SELECT expiresAt FROM session').first<{ expiresAt: string }>();
  assert.ok(Date.parse(after!.expiresAt) >= Date.parse(before!.expiresAt));
  assert.equal((await call('/api/auth/sign-out', {}, token)).status, 200);
  assert.equal((await call('/v1/identity', undefined, token)).status, 401);
});

test('actual workerd/D1 native exchange and daily provider checks survive restart, serialize refresh and revoke before effects', async t => {
  const bundle = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname], bundle: true, write: false,
    format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], external: ['node:*'] });
  const key = await generateKeyPair('RS256');
  const clientKey = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...await exportJWK(key.publicKey), kid: 'runtime-native', alg: 'RS256', use: 'sig' };
  const nonce = 'runtime-native-apple-nonce';
  const nonceHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce))).toString('hex');
  const tokens: Record<string, string> = {};
  for (const provider of ['apple', 'google']) tokens[provider] = await new SignJWT({
    sub: provider + '-native-subject', email: provider + '@runtime.test', email_verified: true,
    ...(provider === 'apple' ? { nonce: nonceHash } : { azp: 'runtime-google-ios' }),
  }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com')
    .setAudience(provider === 'apple' ? 'runtime.native.bundle' : 'runtime-google-web').setIssuedAt().setExpirationTime('10m').sign(key.privateKey);
  const secret = 'runtime-native-only-local-secret-1234567890';
  let exchanges = 0;
  let refreshes = 0;
  let invalidGrant = false;
  let refreshStarted: (() => void) | undefined;
  let refreshWait: Promise<void> | undefined;
  const outboundPaths: string[] = [];
  const options = { modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-09-05', compatibilityFlags: ['nodejs_compat'], d1Databases: ['AUTH_DB'], bindings: {
      APP_ID: 'mypro', AUTH_SECRET: secret, AUTH_BASE_URL: 'https://auth.test', WEB_ORIGINS: '',
      APPLE_APP_BUNDLE_IDENTIFIER: 'runtime.native.bundle', APPLE_NATIVE_TEAM_ID: 'TEAM123456',
      APPLE_NATIVE_KEY_ID: 'KEY1234567', APPLE_NATIVE_PRIVATE_KEY: await exportPKCS8(clientKey.privateKey),
      GOOGLE_CLIENT_ID: 'runtime-google-web', GOOGLE_IOS_CLIENT_ID: 'runtime-google-ios', GOOGLE_CLIENT_SECRET: 'google-only-secret',
    }, outboundService: async (request: Request) => {
      outboundPaths.push(request.url);
      if (['https://appleid.apple.com/auth/keys', 'https://www.googleapis.com/oauth2/v3/certs'].includes(request.url)) return Response.json({ keys: [jwk] });
      const provider = request.url === 'https://appleid.apple.com/auth/token' ? 'apple' : 'google';
      assert.equal(request.url, provider === 'apple' ? 'https://appleid.apple.com/auth/token' : 'https://oauth2.googleapis.com/token');
      assert.equal(request.method, 'POST');
      const form = new URLSearchParams(await request.text());
      assert.equal(form.get('client_id'), provider === 'apple' ? 'runtime.native.bundle' : 'runtime-google-web');
      if (provider === 'apple') {
        const signed = await jwtVerify(form.get('client_secret')!, clientKey.publicKey,
          { algorithms: ['ES256'], issuer: 'TEAM123456', audience: 'https://appleid.apple.com', subject: 'runtime.native.bundle' });
        assert.equal(signed.protectedHeader.kid, 'KEY1234567');
        assert.equal(signed.payload.exp! - signed.payload.iat!, 300);
      } else assert.equal(form.get('client_secret'), 'google-only-secret');
      if (form.get('grant_type') === 'refresh_token') {
        assert.equal(form.get('code'), null); assert.equal(form.get('refresh_token'), provider + '-refresh');
        refreshes++; refreshStarted?.(); await refreshWait;
        if (invalidGrant) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({ id_token: tokens[provider], access_token: provider + '-renewed-access', token_type: 'Bearer', expires_in: 3600 });
      }
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.ok([provider + '-one-use-code', provider + '-reauth-code'].includes(form.get('code')!));
      exchanges++;
      return Response.json({ id_token: tokens[provider], access_token: provider + '-access', refresh_token: provider + '-refresh', token_type: 'Bearer' });
    },
  } satisfies Parameters<typeof convertV4MiniflareOptions>[0];
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  t.after(() => mf.dispose());
  let db = await mf.getD1Database('AUTH_DB');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    const statements = sql.includes('-- statement-breakpoint') ? sql.split('-- statement-breakpoint') : sql.replace(/^\s*--.*$/gm, '').split(';');
    for (const statement of statements.map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const call = (path: string, body?: unknown, token?: string) => mf.dispatchFetch('https://auth.test' + path, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: { 'cf-connecting-ip': (body as { provider?: string })?.provider === 'google' ? '192.0.2.22' : '192.0.2.21',
      ...(body === undefined ? {} : { 'content-type': 'application/json', origin: 'https://auth.test' }),
      ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const provider of ['apple', 'google']) {
    invalidGrant = false;
    const body = { provider, idToken: tokens[provider], authorizationCode: provider + '-one-use-code', ...(provider === 'apple' ? { nonce } : {}) };
    const login = await call('/api/auth/sign-in/native', body);
    assert.equal(login.status, 200, JSON.stringify({ response: await login.clone().text(), exchanges, outboundPaths }));
    const bearer = login.headers.get('set-auth-token')!; assert.ok(bearer);
    const identity = await call('/v1/identity', undefined, bearer); assert.equal(identity.status, 200);
    const subject = (await identity.json() as { subject: string }).subject;
    const account = await db.prepare('SELECT nativeGrant, refreshToken FROM account WHERE providerId = ?').bind(provider)
      .first<{ nativeGrant: string; refreshToken: string | null }>();
    assert.equal(account!.refreshToken, null); assert.ok(account!.nativeGrant);
    const grant = JSON.parse(await symmetricDecrypt({ key: secret, data: account!.nativeGrant }));
    assert.equal(grant.refreshToken, provider + '-refresh'); assert.equal(grant.subject, provider + '-native-subject');
    const reauthenticated = await call('/api/auth/reauthenticate/native', { ...body,
      authorizationCode: provider + '-reauth-code', expectedSubject: subject });
    assert.equal(reauthenticated.status, 200, await reauthenticated.clone().text());
    const reauthToken = reauthenticated.headers.get('set-auth-token')!;
    assert.ok(reauthToken); assert.notEqual(reauthToken, bearer);
    assert.equal((await call('/api/auth/sign-out', {}, reauthToken)).status, 200);
    assert.equal((await call('/v1/identity', undefined, bearer)).status, 200, 'temporary reauth logout preserves original session');
    assert.equal((await call('/api/auth/sign-in/native', body)).status, 401);
    const beforeRefresh = refreshes;
    await db.prepare('UPDATE provider_validation SET next_check_at = 0 WHERE account_id IN (SELECT id FROM account WHERE userId = ?)').bind(subject).run();
    const started = new Promise<void>(resolve => { refreshStarted = resolve; });
    let release!: () => void; refreshWait = new Promise<void>(resolve => { release = resolve; });
    const first = call('/v1/identity', undefined, bearer); await started;
    assert.equal((await call('/api/auth/get-session', undefined, bearer)).status, 503);
    release(); assert.equal((await first).status, 200);
    refreshWait = undefined; refreshStarted = undefined;
    assert.equal(refreshes, beforeRefresh + 1);
    await mf.setOptions(convertV4MiniflareOptions({ ...options, script: bundle.outputFiles[0].text + '\n// fresh isolate after ' + provider }));
    db = await mf.getD1Database('AUTH_DB');
    assert.equal((await call('/v1/identity', undefined, bearer)).status, 200);
    assert.equal(refreshes, beforeRefresh + 1, 'fresh isolate respects durable daily check');
    const originalName = await db.prepare('SELECT name FROM user WHERE id = ?').bind(subject).first<{ name: string }>();
    invalidGrant = true;
    await db.prepare('UPDATE provider_validation SET next_check_at = 0 WHERE account_id IN (SELECT id FROM account WHERE userId = ?)').bind(subject).run();
    assert.equal((await call('/api/auth/update-user', { name: 'should-never-write' }, bearer)).status, 401);
    assert.equal((await db.prepare('SELECT name FROM user WHERE id = ?').bind(subject).first<{ name: string }>())!.name, originalName!.name);
    assert.equal((await db.prepare('SELECT count(*) n FROM session WHERE userId = ?').bind(subject).first<{ n: number }>())!.n, 0);
    assert.equal((await db.prepare('SELECT count(*) n FROM account WHERE userId = ? AND nativeGrant IS NOT NULL').bind(subject).first<{ n: number }>())!.n, 1);
    assert.equal((await call('/api/auth/get-session', undefined, bearer)).status, 401);
    assert.equal(refreshes, beforeRefresh + 2);
    assert.equal((await call('/api/auth/sign-out', {}, bearer)).status, 200);
    assert.equal((await call('/v1/identity', undefined, bearer)).status, 401);
  }
  assert.equal(exchanges, 4);
  assert.equal(refreshes, 4);
});
