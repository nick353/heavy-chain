import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair, exportJWK, exportPKCS8, jwtVerify, SignJWT } from 'jose';
import { setup } from './helpers.ts';
import { beginAuthErasure, finishAuthErasure } from '../src/account-erasure.ts';
import { readNativeGrant } from '../src/native-oauth.ts';

const key = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(key.publicKey), kid: 'native-local-fixture', alg: 'RS256', use: 'sig' };
const nonce = 'native-nonce-only-local-fixture';
const nonceHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce))).toString('hex');
type Provider = 'apple' | 'google';
async function fixture(t: test.TestContext, provider: Provider, dynamicApple = false) {
  const s = setup(); t.after(() => s.db.sql.close()); s.env.APP_ID = 'mypro';
  s.env.GOOGLE_CLIENT_ID = 'google-web'; s.env.GOOGLE_IOS_CLIENT_ID = 'google-ios'; s.env.GOOGLE_CLIENT_SECRET = 'local-google-secret';
  s.env.APPLE_APP_BUNDLE_IDENTIFIER = 'mypro.native'; s.env.APPLE_NATIVE_CLIENT_SECRET = 'local-native-secret';
  // Different web credentials must never be used to exchange/revoke a native grant.
  s.env.APPLE_CLIENT_ID = 'web.service'; s.env.APPLE_CLIENT_SECRET = 'local-web-secret';
  const clientKey = dynamicApple ? await generateKeyPair('ES256', { extractable: true }) : undefined;
  if (clientKey) {
    delete s.env.APPLE_NATIVE_CLIENT_SECRET;
    s.env.APPLE_NATIVE_TEAM_ID = 'TEAM123456'; s.env.APPLE_NATIVE_KEY_ID = 'KEY1234567';
    s.env.APPLE_NATIVE_PRIVATE_KEY = await exportPKCS8(clientKey.privateKey);
  }
  let exchanges = 0;
  const replies = new Map<string, Response | Error>();
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const target = url instanceof Request ? url.url : String(url);
    if (['https://appleid.apple.com/auth/keys', 'https://www.googleapis.com/oauth2/v3/certs'].includes(target)) return Response.json({ keys: [jwk] });
    assert.equal(target, provider === 'apple' ? 'https://appleid.apple.com/auth/token' : 'https://oauth2.googleapis.com/token');
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
    const body = init!.body as URLSearchParams;
    assert.equal(body.get('client_id'), provider === 'apple' ? 'mypro.native' : 'google-web');
    if (clientKey) {
      const signed = await jwtVerify(body.get('client_secret')!, clientKey.publicKey,
        { algorithms: ['ES256'], issuer: 'TEAM123456', audience: 'https://appleid.apple.com', subject: 'mypro.native' });
      assert.equal(signed.protectedHeader.kid, 'KEY1234567');
    } else assert.equal(body.get('client_secret'), provider === 'apple' ? 'local-native-secret' : 'local-google-secret');
    assert.equal(body.get('redirect_uri'), provider === 'apple' ? null : '');
    assert.equal(body.get('grant_type'), 'authorization_code');
    exchanges++;
    const response = replies.get(body.get('code')!); assert.ok(response, 'unexpected code or repeated exchange');
    if (response instanceof Error) throw response;
    return response.clone();
  });
  const signed = (overrides: Record<string, unknown> = {}) => new SignJWT({
    sub: 'provider-subject', email: `${provider}@example.test`, email_verified: true,
    iss: provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com',
    aud: provider === 'apple' ? 'mypro.native' : 'google-web', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600,
    ...(provider === 'apple' ? { nonce: nonceHash } : { azp: 'google-ios' }), ...overrides,
  }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(key.privateKey);
  async function login(code: string, options: { original?: Record<string, unknown>; exchanged?: Record<string, unknown>; refresh?: boolean; tokenResponse?: Response | Error; expectedSubject?: string } = {}) {
    const idToken = await signed(options.original);
    replies.set(code, options.tokenResponse ?? Response.json({ id_token: await signed(options.exchanged), access_token: 'only-local-access',
      ...(options.refresh === false ? {} : { refresh_token: 'only-local-refresh' }), token_type: 'Bearer' }));
    return s.request(options.expectedSubject ? '/api/auth/reauthenticate/native' : '/api/auth/sign-in/native',
      { provider, idToken, authorizationCode: code, ...(provider === 'apple' ? { nonce } : {}),
        ...(options.expectedSubject ? { expectedSubject: options.expectedSubject } : {}) });
  }
  return { ...s, loginNative: login, signed, replies, clientKey, exchanges: () => exchanges };
}

test('native Apple private-key login and erasure sign independently; broken signing retains revocable grant', async t => {
  const s = await fixture(t, 'apple', true);
  const login = await s.loginNative('private-key-code'); assert.equal(login.status, 200);
  const requestId = 'f'.repeat(64);
  const frozen = await beginAuthErasure(s.env, 'Bearer ' + login.headers.get('set-auth-token'), requestId);
  assert.equal(frozen.ok, true);
  const before = s.db.sql.prepare('SELECT nativeGrant FROM account').get()!.nativeGrant;
  const pem = s.env.APPLE_NATIVE_PRIVATE_KEY;
  s.env.APPLE_NATIVE_PRIVATE_KEY = 'invalid-private-key';
  let sent = 0;
  const send: typeof fetch = async (url, init) => {
    sent++;
    assert.equal(String(url), 'https://appleid.apple.com/auth/revoke');
    const body = init!.body as URLSearchParams;
    assert.equal(body.get('client_id'), 'mypro.native'); assert.equal(body.get('token'), 'only-local-refresh');
    const signed = await jwtVerify(body.get('client_secret')!, s.clientKey!.publicKey,
      { algorithms: ['ES256'], issuer: 'TEAM123456', audience: 'https://appleid.apple.com', subject: 'mypro.native' });
    assert.equal(signed.payload.exp! - signed.payload.iat!, 300);
    return new Response(null, { status: 200 });
  };
  assert.equal((await finishAuthErasure(s.env, requestId, send)).ok, false);
  assert.equal(sent, 0);
  assert.equal(s.db.sql.prepare('SELECT nativeGrant FROM account').get()!.nativeGrant, before);
  assert.equal(s.db.sql.prepare('SELECT manual_revocation FROM auth_erasure').get()!.manual_revocation, '[]');
  s.env.APPLE_NATIVE_PRIVATE_KEY = pem;
  const done = await finishAuthErasure(s.env, requestId, send);
  assert.equal(done.ok, true); assert.equal(sent, 1);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 0);
});

for (const provider of ['apple', 'google'] as const) {
  test(`${provider}: reauthentication selects only the existing exact user and cannot register or revive an erased account`, async t => {
    const s = await fixture(t, provider);
    const missing = crypto.randomUUID();
    assert.equal((await s.loginNative('not-registered', { expectedSubject: missing })).status, 401);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 0);
    const initial = await s.loginNative('initial-account'); assert.equal(initial.status, 200);
    const initialToken = initial.headers.get('set-auth-token')!;
    const subject = String(s.db.sql.prepare('SELECT id FROM user').get()!.id);
    const before = s.db.sql.prepare('SELECT nativeGrant FROM account').get()!.nativeGrant;
    assert.equal((await s.loginNative('wrong-user', { expectedSubject: missing })).status, 401);
    assert.equal(s.db.sql.prepare('SELECT nativeGrant FROM account').get()!.nativeGrant, before);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM session').get()!.n, 1);
    const renewed = await s.loginNative('matching-user', { expectedSubject: subject.toUpperCase() });
    assert.equal(renewed.status, 200, await renewed.clone().text());
    const renewedToken = renewed.headers.get('set-auth-token')!; assert.notEqual(renewedToken, initialToken);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 1);
    assert.equal((await beginAuthErasure(s.env, 'Bearer ' + renewedToken, 'a'.repeat(64))).ok, true);
    assert.equal((await s.loginNative('already-frozen', { expectedSubject: subject })).status, 401);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM session').get()!.n, 0);
    assert.equal((await finishAuthErasure(s.env, 'a'.repeat(64), (async () => new Response(null, { status: 200 })) as typeof fetch)).ok, true);
    s.db.sql.prepare("UPDATE rateLimit SET lastRequest = 0 WHERE key LIKE 'native:%'").run();
    assert.equal((await s.loginNative('already-deleted', { expectedSubject: subject })).status, 401);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 0);
  });

  test(`${provider}: deletion racing reauthentication cannot recreate the user`, async t => {
    const s = await fixture(t, provider);
    assert.equal((await s.loginNative('initial')).status, 200);
    const subject = String(s.db.sql.prepare('SELECT id FROM user').get()!.id);
    const prepare = s.db.prepare.bind(s.db);
    t.mock.method(s.db, 'prepare', (sql: string) => {
      const statement = prepare(sql);
      if (sql.startsWith('SELECT a.userId FROM account')) {
        const first = statement.first.bind(statement);
        t.mock.method(statement, 'first', async () => {
          const row = await first();
          s.db.sql.prepare('DELETE FROM user WHERE id = ?').run(subject);
          return row;
        });
      }
      return statement;
    });
    const response = await s.loginNative('race', { expectedSubject: subject });
    assert.notEqual(response.status, 200); assert.equal(response.headers.get('set-auth-token'), null);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 0);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM account').get()!.n, 0);
  });

  test(`${provider}: native code -> signed verified identity -> encrypted grant before session -> exact provider erasure`, async t => {
    const s = await fixture(t, provider);
    const login = await s.loginNative('first-code'); assert.equal(login.status, 200, await login.clone().text());
    const token = login.headers.get('set-auth-token')!; assert.ok(token);
    const identity = await s.request('/v1/identity', undefined, token); assert.equal(identity.status, 200);
    const { subject } = await identity.json() as { subject: string };
    const account = s.db.sql.prepare('SELECT * FROM account WHERE userId = ?').get(subject)!;
    assert.equal(account.accessToken, null); assert.equal(account.refreshToken, null);
    assert.equal(typeof account.nativeGrant, 'string');
    assert.ok(!String(account.nativeGrant).includes('only-local-'));
    const stored = await readNativeGrant(s.env, String(account.nativeGrant), provider, 'provider-subject');
    assert.equal(stored.refreshToken, 'only-local-refresh');
    assert.equal(stored.clientId, provider === 'apple' ? 'mypro.native' : 'google-web');
    const publicAccounts = await s.request('/api/auth/list-accounts', undefined, token);
    assert.equal(publicAccounts.status, 200);
    assert.doesNotMatch(await publicAccounts.text(), /nativeGrant|only-local-refresh|only-local-access/);
    assert.equal(s.mail.length, 0, 'provider-verified email needs no fabricated confirmation');
    assert.equal((await s.loginNative('first-code')).status, 401); assert.equal(s.exchanges(), 1, 'replay blocked before upstream');
    const requestId = 'd'.repeat(64);
    assert.deepEqual(await beginAuthErasure(s.env, 'Bearer ' + token, requestId), { ok: true, requestId, subject, state: 'frozen' });
    const complete = await finishAuthErasure(s.env, requestId, (async (url, init) => {
      assert.equal(url, provider === 'apple' ? 'https://appleid.apple.com/auth/revoke' : 'https://oauth2.googleapis.com/revoke');
      const form = init!.body as URLSearchParams;
      assert.equal(form.get('token'), 'only-local-refresh');
      if (provider === 'apple') {
        assert.equal(form.get('client_id'), 'mypro.native'); assert.equal(form.get('client_secret'), 'local-native-secret');
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch);
    assert.deepEqual(complete, { ok: true, requestId, subject: null, state: 'deleted' });
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM account').get()!.n, 0);
    assert.equal((await s.request('/v1/identity', undefined, token)).status, 401);
  });

  test(`${provider}: different subject/unverified identity/unknown exchange create no sessions; no same-code retry`, async t => {
    const s = await fixture(t, provider);
    assert.equal((await s.loginNative('mismatch', { exchanged: { sub: 'other-person' } })).status, 401);
    assert.notEqual((await s.loginNative('unverified', { exchanged: { email_verified: false } })).status, 200);
    assert.equal((await s.loginNative('timeout', { tokenResponse: new Error('private-provider-error') })).status, 503);
    const count = s.exchanges();
    assert.equal((await s.loginNative('timeout')).status, 401); assert.equal(s.exchanges(), count);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM session').get()!.n, 0);
    const rows = s.db.sql.prepare("SELECT * FROM verification WHERE identifier LIKE 'native-code:%'").all();
    assert.ok(rows.length >= 2); assert.doesNotMatch(JSON.stringify(rows), /private-provider-error|only-local-refresh|authorizationCode/);
  });

  test(`${provider}: ciphertext failure blocks session, returning grant survives omitted refresh token`, async t => {
    const s = await fixture(t, provider);
    s.db.sql.exec("CREATE TRIGGER fail_native_grant BEFORE UPDATE OF nativeGrant ON account BEGIN SELECT RAISE(ABORT, 'fixture_storage_failure'); END");
    const failed = await s.loginNative('storage-fails'); assert.equal(failed.status, 503);
    assert.equal(failed.headers.get('set-auth-token'), null);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM session').get()!.n, 0);
    s.db.sql.exec('DROP TRIGGER fail_native_grant');
    assert.equal((await s.loginNative('new-code')).status, 200);
    const before = s.db.sql.prepare('SELECT id, userId, nativeGrant FROM account').get()!;
    const returned = await s.loginNative('returning-code', { refresh: false,
      ...(provider === 'apple' ? { exchanged: { email: undefined, email_verified: undefined } } : {}) });
    assert.equal(returned.status, 200, await returned.clone().text());
    const after = s.db.sql.prepare('SELECT id, userId, nativeGrant FROM account').get()!;
    assert.equal(after.id, before.id); assert.equal(after.userId, before.userId);
    assert.notEqual(after.nativeGrant, before.nativeGrant, 'fresh randomized ciphertext');
    assert.equal((await readNativeGrant(s.env, String(after.nativeGrant), provider, 'provider-subject')).refreshToken, 'only-local-refresh');
  });

  test(`${provider}: no refresh grant does not admit a session; invalid ciphertext permits only manual erasure`, async t => {
    const s = await fixture(t, provider);
    const missing = await s.loginNative('missing-refresh', { refresh: false });
    assert.notEqual(missing.status, 200); assert.equal(missing.headers.get('set-auth-token'), null);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM session').get()!.n, 0);
    const good = await s.loginNative('next-fresh-code'); assert.equal(good.status, 200);
    const token = good.headers.get('set-auth-token')!;
    s.db.sql.prepare('UPDATE account SET nativeGrant = ?').run('corrupt-ciphertext');
    const requestId = 'e'.repeat(64);
    const begun = await beginAuthErasure(s.env, 'Bearer ' + token, requestId);
    assert.ok(begun.ok); assert.deepEqual(begun.manualRevocation, [provider]);
    const result = await finishAuthErasure(s.env, requestId, (async () => { throw new Error('no revocation using unverified grant'); }) as typeof fetch);
    assert.deepEqual(result, { ok: true, requestId, subject: null, state: 'deleted', manualRevocation: [provider] });
  });

  test(`${provider}: wrong audience, expired token and exchanged-token substitution reject without a session`, async t => {
    const s = await fixture(t, provider);
    assert.equal((await s.loginNative('foreign-aud', { original: { aud: 'another-app' } })).status, 401);
    assert.equal((await s.loginNative('expired', { original: { exp: 1 } })).status, 401);
    assert.equal(s.exchanges(), 0);
    assert.equal((await s.loginNative('foreign-exchanged', { exchanged: { aud: 'another-app' } })).status, 401);
    assert.equal((await s.loginNative('wrong-exchanged-nonce', { exchanged: provider === 'apple' ? { nonce: 'wrong' } : { azp: 'wrong-app' } })).status, 401);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 0);
  });
}

test('native route rejects ID-token bypass, wrong app/origin/config and client-selected audience', async t => {
  const s = await fixture(t, 'apple');
  assert.equal((await s.request('/api/auth/sign-in/social', { provider: 'apple', idToken: { token: await s.signed() } })).status, 400);
  assert.equal((await s.request('/api/auth/sign-in/native', {}, undefined, { origin: 'https://web.test' })).status, 403);
  s.env.APP_ID = 'heavy'; assert.equal((await s.loginNative('heavy')).status, 404); s.env.APP_ID = 'mypro';
  assert.equal((await s.request('/api/auth/sign-in/native', { provider: 'apple', client_id: 'attacker' })).status, 401);
  delete s.env.APPLE_NATIVE_CLIENT_SECRET;
  const missing = await s.loginNative('no-native-secret'); assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { code: 'NATIVE_OAUTH_NOT_CONFIGURED' });
  assert.equal(s.exchanges(), 0); assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 0);
});

test('wrong Apple nonce/c_hash and Google authorized party/signature are rejected before code exchange', async t => {
  const s = await fixture(t, 'apple');
  assert.equal((await s.loginNative('bad-nonce', { original: { nonce: 'incorrect' } })).status, 401);
  assert.equal((await s.loginNative('bad-c-hash', { original: { c_hash: 'incorrect' } })).status, 401);
  const broken = (await s.signed()).split('.'); broken[2] = 'invalid-signature';
  assert.equal((await s.request('/api/auth/sign-in/native', { provider: 'apple', idToken: broken.join('.'), authorizationCode: 'bad-sig', nonce })).status, 401);
  assert.equal(s.exchanges(), 0);
});

test('Google authorized-party substitution and native rate limits reject before upstream', async t => {
  const s = await fixture(t, 'google');
  for (let i = 0; i < 5; i++) assert.equal((await s.loginNative(`wrong-azp-${i}`, { original: { azp: 'foreign-client' } })).status, 401);
  assert.equal((await s.loginNative('sixth-code')).status, 429);
  assert.equal(s.exchanges(), 0); assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 0);
});

test('provider redirects never forward codes/secrets or create sessions', async t => {
  const s = await fixture(t, 'google');
  assert.equal((await s.loginNative('redirect-code', { tokenResponse: new Response(null, { status: 307, headers: { location: 'https://foreign.test' } }) })).status, 401);
  assert.equal(s.exchanges(), 1); assert.equal(s.db.sql.prepare('SELECT count(*) n FROM session').get()!.n, 0);
});
