import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.ts';

async function signedIn(s: ReturnType<typeof setup>) {
  await s.register(); await s.verify();
  const response = await s.login();
  return response.headers.get('set-auth-token')!;
}
const count = (s: ReturnType<typeof setup>, query: string) => (s.db.sql.prepare(query).get() as { n: number }).n;

test('Heavy account erase: dry run only checks, the real call removes the user, sessions and accounts', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const token = await signedIn(s);
  assert.equal((await s.request('/v1/account/erase', { dryRun: true }, token)).status, 204);
  assert.equal(count(s, 'SELECT COUNT(*) n FROM "user"'), 1);
  assert.equal((await s.request('/v1/account/erase', { dryRun: 'no' }, token)).status, 400);
  assert.equal((await s.request('/v1/account/erase', { dryRun: false }, 'forged')).status, 401);
  assert.equal((await s.request('/v1/account/erase', { dryRun: false }, token)).status, 204);
  assert.equal(count(s, 'SELECT COUNT(*) n FROM "user"'), 0);
  assert.equal(count(s, 'SELECT COUNT(*) n FROM session'), 0);
  assert.equal(count(s, 'SELECT COUNT(*) n FROM account'), 0);
  assert.equal(count(s, `SELECT COUNT(*) n FROM verification WHERE instr(identifier, 'alice@example.test') > 0`), 0);
  assert.equal((await s.request('/v1/identity', undefined, token)).status, 401);
  assert.equal((await s.login()).status, 401, 'the address can no longer sign in');
});

test('Heavy account erase requires a sign-in from the last 24 hours and is disabled for MyPro', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const token = await signedIn(s);
  s.db.sql.exec(`UPDATE session SET createdAt = '${new Date(Date.now() - 25 * 3600_000).toISOString()}'`);
  const stale = await s.request('/v1/account/erase', { dryRun: true }, token);
  assert.equal(stale.status, 403);
  assert.deepEqual(await stale.json(), { error: 'reauthentication_required' });
  assert.equal(count(s, 'SELECT COUNT(*) n FROM "user"'), 1);
  Object.assign(s.env, { APP_ID: 'mypro' });
  assert.equal((await s.request('/v1/account/erase', { dryRun: false }, token)).status, 404);
  assert.equal(count(s, 'SELECT COUNT(*) n FROM "user"'), 1);
});
