import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.ts';
import { beginAuthErasure, authErasureStatus, finishAuthErasure, cancelAuthErasure } from '../src/account-erasure.ts';
import { signJWT } from 'better-auth/crypto';

const requestId = 'a'.repeat(64);

test('private cancellation fences the exact receipt without revoking sessions or claiming deletion', async t => {
  const s = await fixture(t);
  const expected = { ok: true, requestId, state: 'cancelled', subject: null };
  assert.deepEqual(await cancelAuthErasure(s.env, requestId), expected);
  assert.deepEqual(await cancelAuthErasure(s.env, requestId), expected);
  assert.deepEqual(await authErasureStatus(s.env, requestId), expected);
  assert.deepEqual(await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId), expected);
  assert.deepEqual(await finishAuthErasure(s.env, requestId, (async () => { throw new Error('must not revoke provider'); }) as typeof fetch), expected);
  assert.equal((await s.request('/v1/identity', undefined, s.token)).status, 200);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM auth_erasure').get()!.n, 0);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM auth_erasure_cancellations').get()!.n, 1);
  assert.deepEqual(Object.keys(s.db.sql.prepare('SELECT * FROM auth_erasure_cancellations').get()!), ['request_id', 'cancelled_at']);
  assert.equal((await s.request('/v1/account-erasure/cancel', {requestId})).status, 404);
  // A later, explicitly new deletion receipt is independent of the cancelled one.
  const next = await beginAuthErasure(s.env, 'Bearer ' + s.token, 'b'.repeat(64));
  assert.ok(next.ok); assert.equal(next.state, 'frozen');
});

test('cancellation cannot unfreeze or undo an accepted/deleted erasure; Heavy rejects cancellation', async t => {
  const s = await fixture(t);
  s.env.APP_ID = 'heavy';
  assert.deepEqual(await cancelAuthErasure(s.env, requestId), {ok: false, error: 'disabled'});
  s.env.APP_ID = 'mypro';
  assert.deepEqual(await cancelAuthErasure(s.env, 'invalid'), {ok: false, error: 'invalid_request'});
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM auth_erasure_cancellations').get()!.n, 0);
  const frozen = await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId);
  assert.ok(frozen.ok); assert.equal(frozen.state, 'frozen');
  assert.deepEqual(await cancelAuthErasure(s.env, requestId), {ok: false, error: 'already_accepted'});
  assert.deepEqual(await authErasureStatus(s.env, requestId), frozen);
  const completed = await finishAuthErasure(s.env, requestId);
  assert.ok(completed.ok); assert.equal(completed.state, 'deleted');
  assert.deepEqual(await cancelAuthErasure(s.env, requestId), {ok: false, error: 'already_accepted'});
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM auth_erasure_cancellations').get()!.n, 0);
});

test('real SQL cancellation wins while begin is awaiting its freeze transaction: session deletion rolls back', async t => {
  const s = await fixture(t);
  const batch = s.db.batch.bind(s.db);
  let intercept = true;
  s.db.batch = async statements => {
    if (intercept && statements.some(statement => statement.sql.startsWith('INSERT INTO auth_erasure '))) {
      intercept = false;
      const cancelled = await cancelAuthErasure(s.env, requestId);
      assert.ok(cancelled.ok); assert.equal(cancelled.state, 'cancelled');
    }
    return batch(statements);
  };
  const result = await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId);
  assert.ok(result.ok); assert.equal(result.state, 'cancelled');
  assert.equal((await s.request('/v1/identity', undefined, s.token)).status, 200);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM auth_erasure').get()!.n, 0);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM auth_erasure_cancellations').get()!.n, 1);
});

test('real SQL begin wins after cancellation pre-read: late cancellation cannot create a contradictory receipt', async t => {
  const s = await fixture(t);
  const prepare = s.db.prepare.bind(s.db);
  let intercept = true;
  s.db.prepare = sql => {
    const statement = prepare(sql);
    if (sql.startsWith('INSERT OR IGNORE INTO auth_erasure_cancellations')) {
      const run = statement.run.bind(statement);
      statement.run = async () => {
        if (intercept) {
          intercept = false;
          const begun = await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId);
          assert.ok(begun.ok); assert.equal(begun.state, 'frozen');
        }
        return run();
      };
    }
    return statement;
  };
  assert.deepEqual(await cancelAuthErasure(s.env, requestId), {ok: false, error: 'already_accepted'});
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM auth_erasure').get()!.n, 1);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM auth_erasure_cancellations').get()!.n, 0);
});

test('lost cancellation write/read responses retain uncertainty until the same receipt is read', async t => {
  const s = await fixture(t);
  const prepare = s.db.prepare.bind(s.db);
  let unavailable = false;
  s.db.prepare = sql => {
    const statement = prepare(sql);
    if (unavailable) { statement.first = async () => { throw new Error('D1 read unavailable'); }; }
    if (sql.startsWith('INSERT OR IGNORE INTO auth_erasure_cancellations')) {
      const run = statement.run.bind(statement);
      statement.run = async () => { await run(); unavailable = true; throw new Error('lost commit response'); };
    }
    return statement;
  };
  assert.deepEqual(await cancelAuthErasure(s.env, requestId), {ok: false, error: 'storage_unavailable'});
  s.db.prepare = prepare;
  assert.deepEqual(await authErasureStatus(s.env, requestId), {ok: true, requestId, state: 'cancelled', subject: null});
  assert.equal((await s.request('/v1/identity', undefined, s.token)).status, 200);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM auth_erasure').get()!.n, 0);
});
async function fixture(t: test.TestContext) {
  const s = setup(); t.after(() => s.db.sql.close()); s.env.APP_ID = 'mypro';
  await s.register(); await s.verify();
  const token = (await s.login()).headers.get('set-auth-token')!;
  const subject = (await (await s.request('/v1/identity', undefined, token)).json() as { subject: string }).subject;
  return { ...s, token, subject };
}

test('trusted MyPro erasure freezes all sessions and auth writes, then removes only that user', async t => {
  const s = await fixture(t);
  await s.register('bob@example.test'); await s.verify();
  const otherToken = (await s.login('bob@example.test')).headers.get('set-auth-token')!;
  s.db.sql.prepare('INSERT INTO verification VALUES (?, ?, ?, ?, ?, ?)').run('recovery', 'reset-password-fixture', s.subject, 'later', 'now', 'now');
  const started = await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId);
  assert.deepEqual(started, { ok: true, state: 'frozen', requestId, subject: s.subject });
  assert.equal((await s.request('/v1/identity', undefined, s.token)).status, 401);
  assert.equal((await s.request('/v1/identity', undefined, otherToken)).status, 200);
  assert.notEqual((await s.login()).status, 200);
  assert.throws(() => s.db.sql.prepare('UPDATE user SET name = ? WHERE id = ?').run('late write', s.subject), /account_erasing/);
  assert.throws(() => s.db.sql.prepare('UPDATE account SET password = ? WHERE userId = ?').run('late password', s.subject), /account_erasing/);
  assert.throws(() => s.db.sql.prepare('INSERT INTO session (id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)')
    .run('late', 'later', 'late-token', 'now', 'now', s.subject), /account_erasing/);
  assert.throws(() => s.db.sql.prepare('INSERT INTO account (id,issuer,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('late', 'credential', 'late-account', 'credential', s.subject, 'now', 'now'), /account_erasing/);
  assert.deepEqual(await authErasureStatus(s.env, requestId), started);
  assert.deepEqual(await finishAuthErasure(s.env, requestId), { ok: true, state: 'deleted', requestId, subject: null });
  for (const table of ['session', 'account']) assert.equal(s.db.sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE userId = ?`).get(s.subject)!.n, 0);
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM user WHERE id = ?').get(s.subject)!.n, 0);
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM verification WHERE value = ?').get(s.subject)!.n, 0);
  assert.deepEqual(await finishAuthErasure(s.env, requestId), { ok: true, state: 'deleted', requestId, subject: null });
  assert.equal((await s.request('/v1/identity', undefined, otherToken)).status, 200);
  assert.equal((await s.request('/api/auth/delete-user', {}, otherToken)).status, 404);
  assert.equal((await s.request('/v1/account-erasure/finish', { requestId })).status, 404);
});

test('erasure rejects wrong scope and stale sessions but deletes ID-token-only accounts with manual guidance', async t => {
  const s = await fixture(t);
  s.env.APP_ID = 'heavy';
  assert.deepEqual(await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId), { ok: false, error: 'disabled' });
  assert.deepEqual(await finishAuthErasure(s.env, requestId), { ok: false, error: 'disabled' });
  s.env.APP_ID = 'mypro';
  assert.deepEqual(await beginAuthErasure(s.env, 'Bearer ' + s.token, 'bad'), { ok: false, error: 'invalid_request' });
  assert.deepEqual(await beginAuthErasure(s.env, 'Bearer forged', requestId), { ok: false, error: 'unauthorized' });
  s.db.sql.prepare('UPDATE session SET createdAt = ? WHERE userId = ?').run(new Date(Date.now() - 16 * 60_000).toISOString(), s.subject);
  assert.deepEqual(await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId), { ok: false, error: 'reauthentication_required' });
  s.db.sql.prepare('UPDATE session SET createdAt = ? WHERE userId = ?').run(new Date().toISOString(), s.subject);
  s.db.sql.prepare('INSERT INTO account (id,issuer,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)')
    .run('apple-id-only', 'https://appleid.apple.com', 'native-fixture', 'apple', s.subject, 'now', 'now');
  assert.deepEqual(await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId),
    { ok: true, requestId, subject: s.subject, state: 'frozen', manualRevocation: ['apple'] });
  assert.equal((await s.request('/v1/identity', undefined, s.token)).status, 401);
  const complete = { ok: true, requestId, subject: null, state: 'deleted', manualRevocation: ['apple'] };
  assert.deepEqual(await finishAuthErasure(s.env, requestId, (async () => { throw new Error('no provider call without tokens'); }) as typeof fetch), complete);
  assert.deepEqual(await authErasureStatus(s.env, requestId), complete);
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM user').get()!.n, 0);
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM account').get()!.n, 0);
  const saved = s.db.sql.prepare('SELECT * FROM auth_erasure').get()!;
  assert.equal(saved.user_id, null); assert.equal(saved.manual_revocation, '["apple"]');
});

test('manual provider guidance survives a final commit failure and never claims automatic revocation', async t => {
  const s = await fixture(t);
  for (const provider of ['apple', 'google']) {
    s.db.sql.prepare('INSERT INTO account (id,issuer,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)')
      .run(provider, provider, provider, provider, s.subject, 'now', 'now');
  }
  assert.equal((await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId)).ok, true);
  const batch = s.db.batch.bind(s.db);
  s.db.batch = async statements => {
    if (statements.some(statement => statement.sql.startsWith('DELETE FROM verification'))) throw new Error('final D1 failure');
    return batch(statements);
  };
  assert.deepEqual(await finishAuthErasure(s.env, requestId), { ok: false, error: 'storage_unavailable' });
  assert.equal(s.db.sql.prepare("SELECT count(*) n FROM account WHERE providerId <> 'credential'").get()!.n, 0);
  s.db.batch = batch;
  const result = await finishAuthErasure(s.env, requestId);
  assert.ok(result.ok); assert.equal(result.state, 'deleted');
  assert.deepEqual(result.manualRevocation, ['apple', 'google']);
  assert.deepEqual(await authErasureStatus(s.env, requestId), result);
});

test('commit response loss reconciles the same request; final failure keeps credentials until retry', async t => {
  const s = await fixture(t);
  const batch = s.db.batch.bind(s.db);
  s.db.batch = async statements => { await batch(statements); throw new Error('lost response'); };
  assert.deepEqual(await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId), { ok: false, error: 'storage_unavailable' });
  assert.equal((await authErasureStatus(s.env, requestId) as { state: string }).state, 'frozen');
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM auth_erasure').get()!.n, 1);
  s.db.batch = async () => { throw new Error('temporary D1 failure'); };
  assert.deepEqual(await finishAuthErasure(s.env, requestId), { ok: false, error: 'storage_unavailable' });
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM user WHERE id = ?').get(s.subject)!.n, 1);
  s.db.batch = batch;
  assert.equal((await finishAuthErasure(s.env, requestId) as { state: string }).state, 'deleted');
});

test('provider revocation uses exact HTTPS destinations, awaits success and persists accepted work across D1 retry', async t => {
  const s = await fixture(t);
  s.env.APPLE_CLIENT_ID = 'web-service'; s.env.APPLE_CLIENT_SECRET = 'server-only-fixture';
  const appleToken = ['header', btoa(JSON.stringify({ aud: 'web-service' })), 'signature'].join('.');
  for (const [provider, idToken] of [['apple', appleToken], ['google', null]]) {
    s.db.sql.prepare('INSERT INTO account (id,issuer,accountId,providerId,userId,refreshToken,idToken,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(provider, provider, provider, provider, s.subject, provider + '-fixture-refresh', idToken, 'now', 'now');
  }
  assert.equal((await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId)).ok, true);
  const seen: string[] = []; let fail = true;
  const sender = (async (url: string | URL | Request, init: RequestInit) => {
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual'); assert.ok(init.signal);
    const address = String(url); seen.push(address);
    assert.ok(['https://appleid.apple.com/auth/revoke', 'https://oauth2.googleapis.com/revoke'].includes(address));
    const body = init.body as URLSearchParams;
    assert.equal(body.get('token'), address.includes('apple') ? 'apple-fixture-refresh' : 'google-fixture-refresh');
    if (address.includes('apple')) { assert.equal(body.get('client_id'), 'web-service'); assert.equal(body.get('token_type_hint'), 'refresh_token'); }
    return new Response(null, { status: fail ? 503 : 200 });
  }) as typeof fetch;
  assert.deepEqual(await finishAuthErasure(s.env, requestId, sender), { ok: false, error: 'provider_unavailable' });
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM account WHERE userId = ?').get(s.subject)!.n, 3);
  fail = false;
  const batch = s.db.batch.bind(s.db);
  s.db.batch = async () => { throw new Error('final commit temporarily unavailable'); };
  assert.deepEqual(await finishAuthErasure(s.env, requestId, sender), { ok: false, error: 'storage_unavailable' });
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM account WHERE userId = ?').get(s.subject)!.n, 1);
  const accepted = seen.length;
  s.db.batch = batch;
  assert.equal((await finishAuthErasure(s.env, requestId, sender) as { state: string }).state, 'deleted');
  assert.equal(seen.length, accepted, 'do not replay already persisted revocations');
});

test('Google lost revocation response resumes through invalid_token with durable manual guidance', async t => {
  const s = await fixture(t);
  s.db.sql.prepare('INSERT INTO account (id,issuer,accountId,providerId,userId,refreshToken,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('google', 'https://accounts.google.com', 'google-sub', 'google', s.subject, 'local-refresh', 'now', 'now');
  assert.equal((await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId)).ok, true);
  let calls = 0;
  const sender = (async () => {
    calls++;
    if (calls === 1) throw new Error('provider accepted revocation but response was lost');
    return Response.json({ error: 'invalid_token' }, { status: 400 });
  }) as typeof fetch;
  assert.deepEqual(await finishAuthErasure(s.env, requestId, sender), { ok: false, error: 'provider_unavailable' });
  assert.equal(s.db.sql.prepare("SELECT count(*) n FROM account WHERE providerId='google'").get()!.n, 1);
  const complete = { ok: true, state: 'deleted', requestId, subject: null, manualRevocation: ['google'] };
  assert.deepEqual(await finishAuthErasure(s.env, requestId, sender), complete);
  assert.deepEqual(await authErasureStatus(s.env, requestId), complete);
  assert.deepEqual(await finishAuthErasure(s.env, requestId, sender), complete);
  assert.equal(calls, 2, 'completed receipt never repeats provider work');
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 0);
});

test('Google malformed, oversized or other errors remain pending with credentials retained', async t => {
  const s = await fixture(t);
  s.db.sql.prepare('INSERT INTO account (id,issuer,accountId,providerId,userId,refreshToken,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('google', 'https://accounts.google.com', 'google-sub', 'google', s.subject, 'local-refresh', 'now', 'now');
  assert.equal((await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId)).ok, true);
  for (const response of [Response.json({ error: 'invalid_request' }, { status: 400 }),
    new Response('not JSON', { status: 400 }), Response.json({ error: 'invalid_token', extra: 'x'.repeat(17000) }, { status: 400 }),
    Response.json({ error: 'invalid_token' }, { status: 503 })]) {
    assert.deepEqual(await finishAuthErasure(s.env, requestId, (async () => response) as typeof fetch),
      { ok: false, error: 'provider_unavailable' });
    assert.equal(s.db.sql.prepare("SELECT count(*) n FROM account WHERE providerId='google'").get()!.n, 1);
    assert.equal(s.db.sql.prepare('SELECT manual_revocation FROM auth_erasure').get()!.manual_revocation, '[]');
  }
});

test('old confirmation links cannot verify a re-registered account with the same email', async t => {
  const s = await fixture(t);
  const oldLink = new URL(s.link());
  assert.equal((await beginAuthErasure(s.env, 'Bearer ' + s.token, requestId)).ok, true);
  assert.equal((await s.request(oldLink.pathname + oldLink.search)).status, 400, 'frozen user cannot be verified');
  assert.equal((await finishAuthErasure(s.env, requestId) as { state: string }).state, 'deleted');
  assert.equal((await s.register()).status, 200);
  const newLink = new URL(s.link());
  const replacement = s.db.sql.prepare('SELECT id,emailVerified FROM user WHERE email = ?').get('alice@example.test')!;
  assert.notEqual(replacement.id, s.subject); assert.equal(replacement.emailVerified, 0);
  assert.equal((await s.request(oldLink.pathname + oldLink.search)).status, 400);
  assert.equal(s.db.sql.prepare('SELECT emailVerified FROM user WHERE id = ?').get(replacement.id as string)!.emailVerified, 0);
  const legacyToken = await signJWT({ email: 'alice@example.test' }, s.env.AUTH_SECRET, 3600);
  assert.equal((await s.request('/api/auth/verify-email?token=' + legacyToken)).status, 400);
  const hostile = new URL(newLink); hostile.searchParams.set('callbackURL', 'https://untrusted.example/');
  assert.equal((await s.request(hostile.pathname + hostile.search)).status, 400);
  assert.equal(s.db.sql.prepare('SELECT emailVerified FROM user WHERE id = ?').get(replacement.id as string)!.emailVerified, 0);
  const verified = await s.request(newLink.pathname + newLink.search);
  assert.equal(verified.status, 302); assert.equal(verified.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await s.login()).status, 200);
  const relative = new URL(newLink); relative.searchParams.set('callbackURL', '/');
  const defaultRedirect = await s.request(relative.pathname + relative.search);
  assert.equal(defaultRedirect.status, 302); assert.equal(defaultRedirect.headers.get('location'), s.env.AUTH_BASE_URL + '/');
});
