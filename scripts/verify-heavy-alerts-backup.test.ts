import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase, backupPrefix, pruneBackups } from '../cloudflare/heavy-alerts/src/backup.ts';

// Minimal D1 stand-in over node:sqlite.
const d1 = (sql: DatabaseSync) => ({
  prepare: (query: string) => {
    let params: unknown[] = [];
    const statement = { bind: (...values: unknown[]) => { params = values; return statement; },
      all: async () => ({ results: sql.prepare(query).all(...(params as never[])) }) };
    return statement;
  },
}) as unknown as D1Database;

test('daily backup writes every table as NDJSON plus a manifest with schema and row counts', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE empty_table (x INTEGER); CREATE INDEX users_email ON users(email);");
  const insert = sql.prepare('INSERT INTO users VALUES (?, ?)');
  for (let i = 0; i < 1203; i++) insert.run(`u${i}`, `u${i}@example.test`);
  const objects = new Map<string, string>();
  const bucket = { put: async (key: string, body: string) => { objects.set(key, body); } } as unknown as R2Bucket;
  const now = new Date('2026-10-08T18:00:00Z');
  const result = await backupDatabase(d1(sql), bucket, now);
  assert.equal(result.prefix, 'backups/d1/2026-10-08');
  assert.equal(backupPrefix(now), result.prefix);
  assert.deepEqual(result.tables.map((t) => [t.name, t.rows]), [['empty_table', 0], ['users', 1203]]);
  const lines = objects.get('backups/d1/2026-10-08/users.ndjson')!.trim().split('\n');
  assert.equal(lines.length, 1203);
  assert.deepEqual(JSON.parse(lines[0]), { id: 'u0', email: 'u0@example.test' });
  const manifest = JSON.parse(objects.get('backups/d1/2026-10-08/manifest.json')!);
  assert.ok(manifest.schema.some((row: { name: string }) => row.name === 'users_email'));
  assert.equal(manifest.tables.length, 2);
});

test('backup pruning removes only backups/d1 copies older than 28 days, across list pages', async () => {
  const keys = new Set(['backups/d1/2026-09-10/users.ndjson', 'backups/d1/2026-09-10/manifest.json', 'backups/d1/2026-09-11/users.ndjson',
    'backups/d1/2026-10-08/users.ndjson', 'backups/d1/not-a-date/x.json', 'generated-images/2026-01-01/a.png']);
  const bucket = {
    list: async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
      const all = [...keys].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      return { objects: all.slice(start, start + 2).map((key) => ({ key })), truncated: start + 2 < all.length, cursor: String(start + 2) };
    },
    delete: async (batch: string[]) => { for (const key of batch) keys.delete(key); },
  } as unknown as R2Bucket;
  const deleted = await pruneBackups(bucket, new Date('2026-10-09T18:00:00Z'));
  assert.deepEqual(deleted.sort(), ['backups/d1/2026-09-10/manifest.json', 'backups/d1/2026-09-10/users.ndjson']);
  assert.deepEqual([...keys].sort(), ['backups/d1/2026-09-11/users.ndjson', 'backups/d1/2026-10-08/users.ndjson',
    'backups/d1/not-a-date/x.json', 'generated-images/2026-01-01/a.png']);
});
