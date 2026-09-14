import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveMailAttempt, type MailBudgetEnv } from '../src/mail-budget.ts';
import { setup } from './helpers.ts';
import { cleanupExpiredAuth } from '../src/housekeeping.ts';

test('atomic concurrent reservations enforce daily and cumulative caps without rollover refunds', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  s.env.EMAIL_DAILY_ATTEMPT_LIMIT = '3'; s.env.EMAIL_TOTAL_ATTEMPT_LIMIT = '5';
  const day = 20000 * 86_400_000;
  const attempts = () => Promise.allSettled(Array.from({ length: 20 }, () => reserveMailAttempt(s.env, day)));
  assert.equal((await attempts()).filter(x => x.status === 'fulfilled').length, 3);
  await assert.rejects(reserveMailAttempt({ ...s.env }, day), /EXHAUSTED/);
  await assert.rejects(reserveMailAttempt(s.env, day - 86_400_000), /EXHAUSTED/);
  await reserveMailAttempt(s.env, day + 86_400_000);
  await reserveMailAttempt(s.env, day + 86_400_000);
  await assert.rejects(reserveMailAttempt(s.env, day + 2 * 86_400_000), /EXHAUSTED/);
  s.env.EMAIL_TOTAL_ATTEMPT_LIMIT = '2';
  await assert.rejects(reserveMailAttempt(s.env, day + 3 * 86_400_000), /EXHAUSTED/);
  const row = s.db.sql.prepare('SELECT * FROM auth_mail_budget').get()!;
  assert.equal(row.total_attempts, 5); assert.equal(row.day_attempts, 2);
});

test('missing, zero, malformed policies and uncertain D1 responses never authorize sending', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  for (const value of [undefined, '0', '-1', '1.5', ' 2', '1e3', '9007199254740992']) {
    await assert.rejects(reserveMailAttempt({ ...s.env, EMAIL_DAILY_ATTEMPT_LIMIT: value }), /UNAVAILABLE/);
  }
  const env = { ...s.env, AUTH_DB: { prepare() { return { bind() { return {
    async first() { throw new Error('uncertain reservation'); },
  }; } }; } } } as unknown as MailBudgetEnv;
  await assert.rejects(reserveMailAttempt(env), /UNAVAILABLE/);
  assert.equal(s.db.sql.prepare('SELECT total_attempts FROM auth_mail_budget').get()!.total_attempts, 0);
  s.env.EMAIL_DAILY_ATTEMPT_LIMIT = '0';
  assert.equal((await s.register()).status, 503);
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM user').get()!.n, 0);
});

test('every send path is bounded; verified login and recovery consumption remain independent', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  s.env.EMAIL_DAILY_ATTEMPT_LIMIT = '2'; s.env.EMAIL_TOTAL_ATTEMPT_LIMIT = '2';
  assert.equal((await s.register()).status, 200);
  assert.equal((await s.login()).status, 403); // unverified sign-in sends a second email
  assert.equal(s.mail.length, 2);
  assert.equal((await s.login()).status, 429); // no unbudgeted hidden library send
  assert.equal((await s.request('/api/auth/send-verification-email', { email: 'alice@example.test' })).status, 429);
  assert.equal(s.mail.length, 2);
  await s.verify();
  assert.equal((await s.login()).status, 200);
  assert.equal((await s.request('/api/auth/request-password-reset', { email: 'alice@example.test' })).status, 429);
  assert.equal(s.mail.length, 2);
});

test('provider failure or unknown acceptance consumes one reservation and never replays', async t => {
  for (const outcome of ['throw', 'unknown']) {
    const s = setup(); t.after(() => s.db.sql.close());
    let calls = 0;
    s.env.EMAIL = { send: async () => {
      calls++;
      if (outcome === 'throw') throw new Error('provider rejected');
      return {} as { messageId: string };
    } };
    assert.equal((await s.register()).status, 503);
    assert.equal(calls, 1);
    assert.equal(s.db.sql.prepare('SELECT total_attempts FROM auth_mail_budget').get()!.total_attempts, 1);
    // User deletion must not erase anonymous allocation history.
    s.db.sql.exec('DELETE FROM user');
    assert.equal(s.db.sql.prepare('SELECT total_attempts FROM auth_mail_budget').get()!.total_attempts, 1);
  }
});

test('housekeeping bounds each table and preserves refreshed records and every other table', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  await s.register(); await s.verify(); await s.login();
  const now = Date.now(), old = new Date(now - 3600_000).toISOString(), fresh = new Date(now + 3600_000).toISOString();
  for (let i = 0; i < 105; i++) {
    s.db.sql.prepare('INSERT INTO verification VALUES (?,?,?,?,?,?)').run('v' + i, 'synthetic', 'synthetic', old, old, old);
    s.db.sql.prepare('INSERT INTO rateLimit VALUES (?,?,?,?)').run('r' + i, 'fixture' + i, 1, now - 3600_000);
  }
  s.db.sql.prepare('UPDATE verification SET expiresAt = ? WHERE id = ?').run(fresh, 'v104');
  s.db.sql.prepare('UPDATE rateLimit SET lastRequest = ? WHERE id = ?').run(now, 'r104');
  const names = s.db.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('verification','rateLimit')").all();
  const snapshot = () => JSON.stringify(names.map(r => [r.name, s.db.sql.prepare('SELECT * FROM "' + String(r.name).replaceAll('"', '""') + '"').all()]));
  const before = snapshot();
  await cleanupExpiredAuth(s.env, now);
  assert.equal(s.db.sql.prepare("SELECT count(*) AS n FROM verification WHERE id LIKE 'v%'").get()!.n, 5);
  assert.equal(s.db.sql.prepare("SELECT count(*) AS n FROM rateLimit WHERE id LIKE 'r%'").get()!.n, 5);
  assert.equal(snapshot(), before);
  await cleanupExpiredAuth(s.env, now);
  assert.equal(s.db.sql.prepare("SELECT count(*) AS n FROM verification WHERE id LIKE 'v%'").get()!.n, 1);
  assert.equal(s.db.sql.prepare("SELECT count(*) AS n FROM rateLimit WHERE id LIKE 'r%'").get()!.n, 1);
  assert.equal(snapshot(), before);
});

test('lost D1 reservation response retains consumption but never calls the mail provider', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const prepare = s.db.prepare.bind(s.db);
  s.db.prepare = sql => {
    const statement = prepare(sql);
    if (sql.startsWith('UPDATE auth_mail_budget')) {
      const first = statement.first.bind(statement);
      statement.first = async () => { await first(); throw new Error('response lost after commit'); };
    }
    return statement;
  };
  assert.equal((await s.register()).status, 503);
  assert.equal(s.mail.length, 0);
  assert.equal(s.db.sql.prepare('SELECT total_attempts FROM auth_mail_budget').get()!.total_attempts, 1);
});
