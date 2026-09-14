import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleRequest, type Env } from '../src/index.ts';

class Statement {
  db: DatabaseSync; sql: string; values: SQLInputValue[] = [];
  constructor(db: DatabaseSync, sql: string) { this.db = db; this.sql = sql; }
  bind(...values: SQLInputValue[]) { this.values = values; return this; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values) ?? null) as T | null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.values) }; }
  async run() { return { meta: this.db.prepare(this.sql).run(...this.values) }; }
}
function setup() {
  const sql = new DatabaseSync(':memory:');
  const folder = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(folder).filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, folder), 'utf8'));
  const subject: string = crypto.randomUUID();
  let payload = { issuer: 'https://auth.test', subject, email: 'alice@example.test', name: 'Alice', emailVerified: true };
  let status = 200; let writes = 0;
  const env = {
    DB: {
      prepare(query: string) { return new Statement(sql, query); },
      async batch(statements: Statement[]) {
        writes++; sql.exec('BEGIN');
        try { const result = await Promise.all(statements.map(s => s.run())); sql.exec('COMMIT'); return result; }
        catch (error) { sql.exec('ROLLBACK'); throw error; }
      },
    }, AUTH_ISSUER: 'https://auth.test',
    AUTH_SERVICE: { async fetch(request: Request) {
      assert.equal(request.url, 'https://auth.test/v1/identity');
      const names: string[] = []; request.headers.forEach((_, name) => names.push(name));
      assert.deepEqual(names, ['authorization']);
      return Response.json(payload, { status });
    } },
  } as unknown as Env;
  const profile = () => handleRequest(new Request('https://api.test/v1/profile', {
    headers: { authorization: 'Bearer session-token', 'x-user-id': 'attacker', 'x-role': 'admin' },
  }), env);
  return { sql, subject, env, profile, writes: () => writes, change: (value: Partial<typeof payload>) => { payload = { ...payload, ...value }; }, status: (value: number) => { status = value; } };
}

test('verified Cloudflare subject provisions once and never adopts by email', async t => {
  const s = setup(); t.after(() => s.sql.close());
  const first = await s.profile(); assert.equal(first.status, 200, await first.clone().text());
  assert.equal((await first.json() as { id: string }).id, s.subject);
  assert.equal((await s.profile()).status, 200); assert.equal(s.writes(), 1);
  assert.equal(s.sql.prepare('SELECT count(*) AS n FROM user_identities').get()!.n, 1);
  const second = crypto.randomUUID(); s.change({ subject: second });
  assert.equal((await s.profile()).status, 200);
  assert.equal(s.sql.prepare('SELECT count(*) AS n FROM users').get()!.n, 2);
});

test('unverified, revoked, wrong-issuer and unavailable sessions do not provision or fall back', async t => {
  const s = setup(); t.after(() => s.sql.close());
  s.change({ emailVerified: false }); assert.equal((await s.profile()).status, 401);
  s.change({ emailVerified: true, issuer: 'https://attacker.test' }); assert.equal((await s.profile()).status, 401);
  s.change({ issuer: 'https://auth.test', subject: 'not-a-uuid' }); assert.equal((await s.profile()).status, 401);
  s.status(401); assert.equal((await s.profile()).status, 401);
  s.status(503); assert.equal((await s.profile()).status, 503);
  assert.equal(s.writes(), 0);
  assert.equal(s.sql.prepare('SELECT count(*) AS n FROM user_identities').get()!.n, 0);
});

test('a principal ID already belonging to a different issuer is not linked', async t => {
  const s = setup(); t.after(() => s.sql.close());
  s.sql.prepare('INSERT INTO user_identities VALUES (?, ?, ?, ?)').run(s.subject, 'legacy-issuer', 'someone-else', '2026-09-05');
  assert.equal((await s.profile()).status, 403);
  assert.equal(s.sql.prepare('SELECT count(*) AS n FROM users').get()!.n, 0);
  assert.equal(s.sql.prepare('SELECT issuer FROM user_identities').get()!.issuer, 'legacy-issuer');
});
