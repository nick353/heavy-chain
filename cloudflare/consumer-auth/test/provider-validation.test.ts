import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { serializeSignedCookie } from 'better-call';
import { setup } from './helpers.ts';
import { persistNativeGrant, readNativeGrant } from '../src/native-oauth.ts';
import { recordBrowserConsent } from '../src/provider-validation.ts';
import { PROVIDER_CHECK_INTERVAL } from '../src/provider-state.ts';
import { beginAuthErasure, identifyAuthErasure } from '../src/account-erasure.ts';

const key = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(key.publicKey), kid: 'refresh-fixture', alg: 'RS256', use: 'sig' };
type Provider = 'apple' | 'google';
async function fixture(t: test.TestContext, provider: Provider, native = true) {
  const s = setup(); t.after(() => s.db.sql.close()); s.env.APP_ID = 'mypro';
  Object.assign(s.env, { GOOGLE_CLIENT_ID: 'google-web', GOOGLE_IOS_CLIENT_ID: 'google-ios', GOOGLE_CLIENT_SECRET: 'google-secret',
    APPLE_APP_BUNDLE_IDENTIFIER: 'mypro.native', APPLE_NATIVE_CLIENT_SECRET: 'apple-native-secret',
    APPLE_CLIENT_ID: 'mypro.web', APPLE_CLIENT_SECRET: 'apple-web-secret' });
  const userId = crypto.randomUUID(); const accountId = crypto.randomUUID(); const now = new Date().toISOString();
  s.db.sql.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run(userId, 'Original', 'provider@example.test', now, now);
  s.db.sql.prepare(`INSERT INTO account (id, userId, issuer, providerId, accountId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(accountId, userId,
      provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com', provider, 'bound-subject', now, now);
  const clientId = provider === 'google' ? 'google-web' : native ? 'mypro.native' : 'mypro.web';
  const newSession = () => {
    const id = crypto.randomUUID(); const token = 'local-' + crypto.randomUUID();
    s.db.sql.prepare('INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, token, userId, new Date(Date.now() + 86400000).toISOString(), now, now);
    return { id, token };
  };
  const session = newSession();
  const grant = { provider, subject: 'bound-subject', clientId, accessToken: 'first-access', refreshToken: 'first-refresh' };
  if (native) await persistNativeGrant(s.env, userId, grant);
  else s.db.sql.prepare('UPDATE account SET accessToken = ?, refreshToken = ?').run('first-access', 'first-refresh');
  const cookie = (await serializeSignedCookie('__Secure-mypro-auth.session_token', session.token, s.env.AUTH_SECRET)).split(';')[0];
  let calls = 0;
  let reply: () => Promise<Response> = async () => Response.json({ access_token: 'renewed-access', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 3600 });
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const target = url instanceof Request ? url.url : String(url);
    if (['https://appleid.apple.com/auth/keys', 'https://www.googleapis.com/oauth2/v3/certs'].includes(target)) return Response.json({ keys: [jwk] });
    assert.equal(target, provider === 'apple' ? 'https://appleid.apple.com/auth/token' : 'https://oauth2.googleapis.com/token');
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
    const body = init!.body as URLSearchParams;
    assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('client_id'), clientId);
    assert.equal(body.get('client_secret'), provider === 'google' ? 'google-secret' : native ? 'apple-native-secret' : 'apple-web-secret');
    assert.equal(body.get('code'), null); assert.equal(body.get('nonce'), null);
    assert.ok(['first-refresh', 'rotated-refresh', 'fresh-login-refresh'].includes(body.get('refresh_token')!));
    calls++; return reply();
  });
  const due = () => s.db.sql.prepare('UPDATE provider_validation SET next_check_at = 0').run();
  const check = () => s.request('/v1/identity', undefined, session.token);
  const record = () => s.db.sql.prepare('SELECT * FROM provider_validation').get()!;
  const account = () => s.db.sql.prepare('SELECT * FROM account').get()!;
  const signed = (overrides: Record<string, unknown> = {}) => new SignJWT({ sub: 'bound-subject',
    iss: provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com', aud: clientId,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...overrides,
  }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(key.privateKey);
  return { ...s, session, userId, accountId, clientId, grant, newSession, cookie, due, check, record, account, signed,
    calls: () => calls, reply: (response: Response | (() => Promise<Response>)) => { reply = typeof response === 'function' ? response : async () => response; } };
}

for (const provider of ['apple', 'google'] as const) {
  for (const native of [true, false]) test(`${provider} ${native ? 'native' : 'web'}: daily durable refresh rotates only the bound grant; no public secrets`, async t => {
    const s = await fixture(t, provider, native);
    if (native) { assert.equal((await s.check()).status, 200); assert.equal(s.calls(), 0, 'verified native exchange is fresh'); }
    s.due(); const before = s.account().nativeGrant;
    assert.equal((await s.check()).status, 200); assert.equal(s.calls(), 1);
    assert.equal(s.record().state, 'ok'); assert.equal(s.record().check_id, null);
    assert.ok(Number(s.record().next_check_at) > Date.now() + PROVIDER_CHECK_INTERVAL - 10000);
    if (native) {
      assert.notEqual(s.account().nativeGrant, before);
      const stored = await readNativeGrant(s.env, String(s.account().nativeGrant), provider, 'bound-subject');
      assert.equal(stored.refreshToken, 'rotated-refresh'); assert.equal(stored.accessToken, 'renewed-access');
    } else assert.equal(s.account().refreshToken, 'rotated-refresh');
    for (const path of ['/api/auth/get-session', '/api/auth/token', '/api/auth/list-accounts']) {
      const response = await s.request(path, undefined, undefined, { cookie: s.cookie });
      assert.equal(response.status, 200, await response.clone().text());
      assert.doesNotMatch(await response.text(), /refreshToken|nativeGrant|credential_fingerprint|rotated-refresh|renewed-access/);
    }
    assert.equal(s.calls(), 1, 'separate handler/Auth instances use durable daily result');
    for (const path of ['/get-access-token', '/refresh-token', '/account-info']) {
      assert.equal((await s.request('/api/auth' + path, path === '/account-info' ? undefined : { providerId: provider }, s.session.token)).status, 404);
    }
    assert.equal(s.calls(), 1, 'library routes cannot expose grants or bypass daily refresh');
    s.due(); assert.equal((await s.check()).status, 200); assert.equal(s.calls(), 2);
  });

  test(`${provider}: invalid_grant denies before both cookie/bearer effects and removes sessions but keeps erasure credentials`, async t => {
    const s = await fixture(t, provider); s.due(); const before = s.account().nativeGrant;
    s.reply(Response.json({ error: 'invalid_grant', error_description: 'private-upstream-detail' }, { status: 400 }));
    const changed = await s.request('/api/auth/update-user', { name: 'Must not change' }, undefined, { cookie: s.cookie });
    assert.equal(changed.status, 401); assert.doesNotMatch(await changed.text(), /private-upstream/);
    assert.equal(s.db.sql.prepare('SELECT name FROM user').get()!.name, 'Original');
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM session').get()!.n, 0);
    assert.equal(s.record().state, 'reauth_required'); assert.equal(s.account().nativeGrant, before);
    for (const path of ['/v1/identity', '/api/auth/get-session', '/api/auth/token', '/api/auth/list-accounts']) {
      assert.equal((await s.request(path, undefined, s.session.token)).status, 401);
    }
    s.due(); assert.equal((await s.check()).status, 401); assert.equal(s.calls(), 1, 'terminal grant is not retried daily');
    assert.equal((await s.request('/api/auth/sign-out', {}, s.session.token)).status, 200);
    assert.equal((await s.request('/api/auth/jwks')).status, 200);
  });

  test(`${provider}: concurrent checks claim once; logout during refresh cannot be admitted`, async t => {
    const s = await fixture(t, provider); s.due();
    let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    s.reply(async () => { started(); await pending; return Response.json({ access_token: 'new-access', token_type: 'bearer', expires_in: 3600 }); });
    const first = s.check(); await entered;
    assert.equal((await s.request('/api/auth/get-session', undefined, undefined, { cookie: s.cookie })).status, 503);
    assert.equal((await s.check()).status, 503); assert.equal(s.calls(), 1);
    assert.equal((await s.request('/api/auth/sign-out', {}, s.session.token)).status, 200);
    release(); assert.equal((await first).status, 401); assert.equal(s.calls(), 1);
  });

  for (const rejected of [false, true]) test(`${provider}: ${rejected ? 'negative' : 'successful'} old check cannot overwrite or revoke fresh native login`, async t => {
    const s = await fixture(t, provider); s.due();
    let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
    let finish!: () => void; const wait = new Promise<void>(r => { finish = r; });
    s.reply(async () => { entered(); await wait; return rejected ? Response.json({ error: 'invalid_grant' }, { status: 400 })
      : Response.json({ access_token: 'obsolete-access', refresh_token: 'obsolete-refresh', token_type: 'Bearer', expires_in: 3600 }); });
    const checking = s.check(); await started;
    await persistNativeGrant(s.env, s.userId, { ...s.grant, refreshToken: 'fresh-login-refresh' });
    const fresh = s.account().nativeGrant; const newerSession = s.newSession();
    s.db.sql.prepare('DELETE FROM session WHERE id = ?').run(s.session.id);
    finish(); assert.equal((await checking).status, 401, 'old session was explicitly logged out');
    assert.equal(s.account().nativeGrant, fresh); assert.equal(s.record().state, 'ok');
    assert.equal((await s.request('/v1/identity', undefined, newerSession.token)).status, 200);
    assert.equal(s.calls(), 1);
  });

  test(`${provider}: refresh ID token is pinned to old subject/audience/issuer/signature; no original login nonce required`, async t => {
    const s = await fixture(t, provider);
    for (const overrides of [{ sub: 'another-user' }, { aud: 'another-client' }, { iss: 'https://evil.test' }, { exp: 1 },
      ...(provider === 'google' ? [{ azp: 'foreign-client' }] : [])]) {
      s.due(); s.reply(Response.json({ access_token: 'new-access', token_type: 'Bearer', expires_in: 3600, id_token: await s.signed(overrides) }));
      assert.equal((await s.check()).status, 503); assert.equal(s.record().state, 'unavailable');
      assert.equal(s.db.sql.prepare('SELECT count(*) n FROM session').get()!.n, 1);
    }
    s.due(); s.reply(Response.json({ access_token: 'new-access', token_type: 'Bearer', expires_in: 3600, id_token: await s.signed() }));
    assert.equal((await s.check()).status, 200);
  });
}

test('provider outages/malformed results/redirects/configuration retain sessions and credentials, fail closed and never retry that day', async t => {
  const s = await fixture(t, 'apple');
  const results = [new Response(null, { status: 503 }), new Response(null, { status: 302, headers: { location: 'https://evil.test' } }),
    Response.json({ error: 'invalid_client' }, { status: 400 }), new Response('{', { status: 400 }),
    new Response('x'.repeat(17000)), Response.json({ access_token: 'new-access', expires_in: -1, token_type: 'Bearer' }),
    Response.json({ access_token: 'new-access', expires_in: 3600, token_type: 'wrong' }),
    Response.json({ access_token: 'new-access', expires_in: 3600, token_type: 'Bearer', id_token: 'forged.jwt.value' })];
  const before = s.account().nativeGrant;
  for (const response of results) {
    s.due(); const count = s.calls(); s.reply(response);
    assert.equal((await s.check()).status, 503); assert.equal(s.record().state, 'unavailable');
    assert.equal((await s.check()).status, 503); assert.equal(s.calls(), count + 1);
    assert.equal(s.account().nativeGrant, before);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM session').get()!.n, 1);
  }
  s.due(); s.reply(async () => { throw new Error('private network detail'); });
  const failure = await s.check(); assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /private network/);
  assert.equal((await s.request('/api/auth/request-password-reset', { email: 'missing@example.test', redirectTo: 'https://web.test/reset-password' }, s.session.token)).status, 200);
  assert.equal((await s.request('/api/auth/sign-in/email', { email: 'missing@example.test', password: s.password }, s.session.token)).status, 401);
  s.due(); delete s.env.APPLE_NATIVE_CLIENT_SECRET;
  const count = s.calls(); assert.equal((await s.check()).status, 503); assert.equal(s.calls(), count);
  assert.equal((await beginAuthErasure(s.env, 'Bearer ' + s.session.token, 'a'.repeat(64))).ok, true, 'unavailable provider must not block fresh app deletion');
});

test('ambiguous D1 claim reply is durable; no provider call can start again until next day or reconsent', async t => {
  const s = await fixture(t, 'google'); s.due(); const prepare = s.db.prepare.bind(s.db); let lost = false;
  t.mock.method(s.db, 'prepare', (sql: string) => {
    const statement = prepare(sql);
    if (sql.startsWith('INSERT INTO provider_validation\n')) {
      const run = statement.run.bind(statement);
      t.mock.method(statement, 'run', async () => { const result = await run(); if (!lost) { lost = true; throw new Error('reply lost'); } return result; });
    }
    return statement;
  });
  assert.equal((await s.check()).status, 503); assert.equal(s.record().state, 'checking'); assert.equal(s.calls(), 0);
  assert.equal((await s.check()).status, 503); assert.equal(s.calls(), 0);
});

for (const commit of [false, true]) test(`refresh D1 ${commit ? 'commit reply loss reconciles' : 'transaction failure retains grant'} without provider replay`, async t => {
  const s = await fixture(t, 'google'); s.due(); const batch = s.db.batch.bind(s.db); let failed = false;
  const before = s.account().nativeGrant;
  t.mock.method(s.db, 'batch', async (...args: Parameters<typeof batch>) => {
    if (failed) return batch(...args); failed = true;
    if (commit) await batch(...args);
    throw new Error('injected D1 error');
  });
  assert.equal((await s.check()).status, commit ? 200 : 503); assert.equal(s.calls(), 1);
  assert.equal(s.record().state, commit ? 'ok' : 'unavailable');
  if (!commit) assert.equal(s.account().nativeGrant, before);
  assert.equal((await s.check()).status, commit ? 200 : 503); assert.equal(s.calls(), 1);
});

test('fresh browser consent replaces native generation atomically; stale refresh cannot overwrite its web grant', async t => {
  const s = await fixture(t, 'google'); s.due();
  let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
  let finish!: () => void; const wait = new Promise<void>(r => { finish = r; });
  s.reply(async () => { entered(); await wait; return Response.json({ error: 'invalid_grant' }, { status: 400 }); });
  const checking = s.check(); await started;
  s.db.sql.prepare('UPDATE account SET accessToken = ?, refreshToken = ?, idToken = ?').run('web-access', 'web-refresh', 'new-web-token');
  await recordBrowserConsent(s.env, { id: s.accountId, userId: s.userId, accessToken: 'web-access', refreshToken: 'web-refresh', idToken: 'new-web-token' });
  const newer = s.newSession(); finish(); assert.equal((await checking).status, 200);
  assert.equal(s.account().nativeGrant, null); assert.equal(s.account().refreshToken, 'web-refresh');
  assert.equal((await s.request('/v1/identity', undefined, newer.token)).status, 200); assert.equal(s.calls(), 1);
  await persistNativeGrant(s.env, s.userId, s.grant);
  const newest = s.account().nativeGrant;
  await recordBrowserConsent(s.env, { id: s.accountId, userId: s.userId, accessToken: 'web-access', refreshToken: 'web-refresh', idToken: 'new-web-token' });
  assert.equal(s.account().nativeGrant, newest, 'late browser hook cannot clear fresh native grant');
});

test('missing web refresh requires reconsent; unknown provider does not destroy data; email and Heavy do not use daily validation', async t => {
  const s = await fixture(t, 'google', false); s.db.sql.prepare('UPDATE account SET refreshToken = NULL').run();
  assert.equal((await s.check()).status, 401); assert.equal(s.calls(), 0); assert.equal(s.record().state, 'reauth_required');
  const fresh = s.newSession(); s.db.sql.prepare("UPDATE account SET providerId = 'unknown'").run();
  assert.equal((await s.request('/v1/identity', undefined, fresh.token)).status, 401);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM session').get()!.n, 1);
  s.db.sql.prepare("UPDATE account SET providerId = 'credential'").run();
  assert.equal((await s.request('/v1/identity', undefined, fresh.token)).status, 200);
  s.env.APP_ID = 'heavy'; s.db.sql.prepare("UPDATE account SET providerId = 'google'").run();
  s.db.sql.exec('DROP TABLE provider_validation');
  assert.equal((await s.request('/v1/identity', undefined, fresh.token)).status, 200); assert.equal(s.calls(), 0);
});

test('private erasure identification is fresh-session-only, read-only and never exposes a general HTTP bypass', async t => {
  const s = await fixture(t, 'apple', false);
  s.db.sql.prepare('UPDATE account SET refreshToken = NULL, accessToken = NULL').run();
  const before = JSON.stringify(s.account());
  assert.deepEqual(await identifyAuthErasure(s.env, 'Bearer ' + s.session.token), { ok: true, issuer: s.env.AUTH_BASE_URL, subject: s.userId });
  assert.equal(JSON.stringify(s.account()), before); assert.equal(s.calls(), 0);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM provider_validation').get()!.n, 0);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM auth_erasure').get()!.n, 0);
  assert.equal((await s.request('/v1/account-erasure/identify', {}, s.session.token)).status, 404);
  s.db.sql.prepare('UPDATE session SET createdAt = ?').run(new Date(Date.now() - 16 * 60000).toISOString());
  assert.deepEqual(await identifyAuthErasure(s.env, 'Bearer ' + s.session.token), { ok: false, error: 'reauthentication_required' });
  assert.deepEqual(await identifyAuthErasure(s.env, 'Bearer forged'), { ok: false, error: 'unauthorized' });
  s.env.APP_ID = 'heavy'; assert.deepEqual(await identifyAuthErasure(s.env, 'Bearer ' + s.session.token), { ok: false, error: 'disabled' });
});

for (const provider of ['apple', 'google'] as const) test(`${provider}: real browser redirect/callback records fresh create/update consent before session use`, async t => {
  const s = await fixture(t, provider, false);
  s.db.sql.prepare('DELETE FROM user').run();
  const send = globalThis.fetch; let codeExchanges = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const target = url instanceof Request ? url.url : String(url);
    if (target.endsWith('/token') && new URLSearchParams(String(init?.body)).get('grant_type') === 'authorization_code') {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get('client_id'), s.clientId);
      assert.equal(form.get('redirect_uri'), 'https://auth.test/api/auth/callback/' + provider);
      codeExchanges++;
      return Response.json({ id_token: await s.signed({ email: 'provider@example.test', email_verified: true, name: 'Browser' }),
        access_token: 'browser-access-' + codeExchanges, refresh_token: 'browser-refresh-' + codeExchanges, expires_in: 3600, token_type: 'Bearer' });
    }
    return send(url, init);
  });
  let previousToken: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const begin = await s.request('/api/auth/sign-in/social', { provider, callbackURL: 'https://web.test/login', disableRedirect: true }, previousToken);
    assert.equal(begin.status, 200, await begin.clone().text());
    const redirect = new URL((await begin.json() as { url: string }).url);
    if (provider === 'google') {
      assert.equal(redirect.searchParams.get('access_type'), 'offline'); assert.equal(redirect.searchParams.get('prompt'), 'consent');
    }
    const cookie = begin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const query = new URLSearchParams({ state: redirect.searchParams.get('state')!, code: 'browser-code-' + attempt });
    const callback = await s.request('/api/auth/callback/' + provider + '?' + query, undefined, undefined, { cookie });
    assert.equal(callback.status, 302); assert.equal(callback.headers.get('location'), 'https://web.test/login', await callback.clone().text());
    const token = callback.headers.get('set-auth-token')!; assert.ok(token);
    assert.equal(s.record().state, 'ok'); assert.ok(Number(s.record().next_check_at) > Date.now());
    assert.equal(s.account().nativeGrant, null);
    assert.equal((await s.request('/api/auth/get-session', undefined, token)).status, 200); assert.equal(s.calls(), 0);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 1);
    if (attempt === 0) {
      await persistNativeGrant(s.env, String(s.account().userId), { ...s.grant,
        clientId: provider === 'apple' ? 'mypro.native' : s.clientId });
      s.db.sql.prepare("UPDATE provider_validation SET state = 'reauth_required'").run();
      previousToken = token;
    }
  }
  assert.equal(codeExchanges, 2); assert.equal(s.calls(), 0);
});
