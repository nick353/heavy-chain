import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudflareBrowserAuth } from '../src/lib/cloudflareBrowserAuth.ts';

const user = { id: '6c8e6a27-1e93-4ed1-9c32-13a7ed2641ad', name: 'Alice', email: 'alice@example.test', emailVerified: true, createdAt: '2026-09-05T00:00:00Z' };
const sessionPayload = () => ({ user, session: { token: 'opaque-test-session', expiresAt: new Date(Date.now() + 86400000).toISOString() } });
function fixture() {
  const calls = []; let session = null;
  const fetchImpl = async (url, init) => {
    assert.ok(url.startsWith('https://heavy.test/api/auth/'));
    assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store');
    const headers = new Headers(init.headers);
    assert.equal(headers.has('apikey'), false); assert.equal(headers.has('authorization'), false);
    const path = new URL(url).pathname; const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    if (path.endsWith('/get-session')) return Response.json(session);
    if (path.endsWith('/sign-up/email')) return Response.json({ user: { ...user, emailVerified: false }, token: null });
    if (path.endsWith('/sign-in/email')) { session = sessionPayload(); return Response.json({ user, token: session.session.token }); }
    if (path.endsWith('/sign-out') || path.endsWith('/reset-password')) session = null;
    return Response.json({ status: true });
  };
  return { calls, fetchImpl, auth: createCloudflareBrowserAuth(fetchImpl, 'https://heavy.test') };
}

test('pending signup never adopts a session and has a same-origin verification callback', async t => {
  const s = fixture(); t.after(() => s.auth.dispose());
  const result = await s.auth.signUp({ email: user.email, password: 'long-test-password', options: { data: { name: 'Alice' } } });
  assert.equal(result.error, null); assert.equal(result.data.session, null);
  assert.equal((await s.auth.getSession()).data.session, null);
  assert.equal(s.calls[0].body.callbackURL, 'https://heavy.test/login?verified=1');
});

test('login resolves the cookie session, shares in-flight requests, and only caches in memory', async t => {
  const s = fixture(); t.after(() => s.auth.dispose()); const events = [];
  s.auth.onAuthStateChange(event => events.push(event));
  const result = await s.auth.signInWithPassword({ email: user.email, password: 'long-test-password' });
  assert.equal(result.error, null); assert.equal(result.data.session.access_token, 'opaque-test-session');
  assert.equal(result.data.session.refresh_token, ''); assert.equal(result.data.user.id, user.id);
  await Promise.all([s.auth.getSession(), s.auth.getSession()]);
  assert.equal(s.calls.filter(c => c.path.endsWith('/get-session')).length, 1);
  assert.ok(events.includes('SIGNED_IN'));
  await s.auth.refreshSession();
  assert.equal(s.calls.filter(c => c.path.endsWith('/get-session')).length, 2);
  await s.auth.signOut(); assert.equal((await s.auth.getSession()).data.session, null);
});

test('a same-token session revalidation does not revoke the confirmed auth transition', async t => {
  const s = fixture(); t.after(() => s.auth.dispose()); const events = [];
  s.auth.onAuthStateChange(event => events.push(event));
  await s.auth.signInWithPassword({ email: user.email, password: 'long-test-password' });
  await s.auth.refreshSession();
  assert.deepEqual(events, ['SIGNED_IN']);
});

test('a rotated session token still emits TOKEN_REFRESHED', async t => {
  let reads = 0;
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/get-session')) {
      reads += 1;
      return Response.json({ ...sessionPayload(), session: {
        token: reads === 1 ? 'opaque-first-session' : 'opaque-rotated-session',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      } });
    }
    return Response.json({ status: true });
  };
  const auth = createCloudflareBrowserAuth(fetchImpl, 'https://heavy.test');
  t.after(() => auth.dispose()); const events = [];
  auth.onAuthStateChange(event => events.push(event));
  await auth.getSession(); await auth.refreshSession();
  assert.deepEqual(events, ['SIGNED_IN', 'TOKEN_REFRESHED']);
});

test('an in-flight refresh cannot resurrect a successfully logged-out session', async t => {
  const s = fixture(); let resolveRefresh; let intercept = false;
  const auth = createCloudflareBrowserAuth((url, init) => {
    if (intercept && url.endsWith('/get-session')) return new Promise(resolve => { resolveRefresh = resolve; });
    return s.fetchImpl(url, init);
  }, 'https://heavy.test');
  t.after(() => { auth.dispose(); s.auth.dispose(); });
  await auth.signInWithPassword({ email: user.email, password: 'long-test-password' });
  intercept = true; const refreshing = auth.refreshSession();
  await auth.signOut(); resolveRefresh(Response.json(sessionPayload()));
  assert.equal((await refreshing).data.session, null);
  intercept = false; assert.equal((await auth.getSession()).data.session, null);
});

test('recovery credentials are POST bodies, and recovery clears the cached session', async t => {
  const s = fixture(); t.after(() => s.auth.dispose());
  await s.auth.signInWithPassword({ email: user.email, password: 'long-test-password' });
  await s.auth.resetPasswordForEmail(user.email);
  assert.equal(s.calls.at(-1).body.redirectTo, 'https://heavy.test/reset-password');
  await s.auth.completePasswordReset('test-recovery-token', 'new-long-password');
  assert.deepEqual(s.calls.at(-1), { path: '/api/auth/reset-password', body: { token: 'test-recovery-token', newPassword: 'new-long-password' } });
  assert.equal((await s.auth.getSession()).data.session, null);
});

test('a session read started during logout cannot resurrect the revoked session', async t => {
  const s = fixture(); let resolveLogout; let resolveSession; let intercept = false;
  const auth = createCloudflareBrowserAuth((url, init) => {
    if (intercept && url.endsWith('/sign-out')) return new Promise(resolve => { resolveLogout = resolve; });
    if (intercept && url.endsWith('/get-session')) return new Promise(resolve => { resolveSession = resolve; });
    return s.fetchImpl(url, init);
  }, 'https://heavy.test');
  t.after(() => { auth.dispose(); s.auth.dispose(); });
  await auth.signInWithPassword({ email: user.email, password: 'long-test-password' });
  intercept = true; const logout = auth.signOut(); const duringLogout = auth.getSession();
  resolveLogout(Response.json({ status: true })); assert.equal((await logout).error, null);
  resolveSession(Response.json(sessionPayload())); assert.equal((await duringLogout).data.session, null);
});

test('provider errors and unverified or expired sessions fail closed', async t => {
  const failed = createCloudflareBrowserAuth(async () => Response.json({ code: 'EMAIL_NOT_CONFIGURED', message: 'Mail unavailable' }, { status: 503 }), 'https://heavy.test');
  t.after(() => failed.dispose());
  assert.equal((await failed.signUp({ email: user.email, password: 'long-test-password' })).error.code, 'EMAIL_NOT_CONFIGURED');
  for (const data of [{ ...sessionPayload(), user: { ...user, emailVerified: false } }, { ...sessionPayload(), session: { token: 'expired', expiresAt: '2020-01-01' } }]) {
    const auth = createCloudflareBrowserAuth(async () => Response.json(data), 'https://heavy.test');
    assert.equal((await auth.getSession()).data.session, null); auth.dispose();
  }
});
