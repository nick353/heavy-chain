import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('real isolated D1 allocations serialize concurrent attempts and survive Worker restart', async t => {
  const bundled = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname,
    contents: `import {reserveMailAttempt} from './src/mail-budget.ts';
    import {cleanupExpiredAuth} from './src/housekeeping.ts';
    export default { async fetch(req, env) {
      try { await reserveMailAttempt(env); return new Response('admitted'); }
      catch { return new Response('denied', {status:429}); }
    }, async scheduled(controller, env) { await cleanupExpiredAuth(env); } };` },
    bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker'], external: ['node:*'] });
  const persistence = mkdtempSync(join(tmpdir(), 'auth-mail-budget-'));
  const options = convertV4MiniflareOptions({ resourcePersistencePath: persistence, workers: ['heavy', 'mypro'].map(name => ({
    name, routes: [name + '.test/*'], modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-09-05', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { AUTH_DB: name + '-budget' },
    bindings: { EMAIL_DAILY_ATTEMPT_LIMIT: '3', EMAIL_TOTAL_ATTEMPT_LIMIT: '3' },
  })) });
  let mf = new Miniflare(options); t.after(() => mf.dispose());
  for (const app of ['heavy', 'mypro']) {
    const db = await mf.getD1Database('AUTH_DB', app);
    for (const file of ['0001_auth.sql', '0007_mail_budget.sql', '0008_auth_expiry_indexes.sql']) {
      const sql = readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8');
      for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    const results = await Promise.all(Array.from({ length: 16 }, () => mf.dispatchFetch('https://' + app + '.test')));
    assert.equal(results.filter(r => r.status === 200).length, 3);
    assert.equal((await db.prepare('SELECT total_attempts FROM auth_mail_budget').first())!.total_attempts, 3);
    // Real D1 scheduler entrypoint: expired ISO date deleted, current row kept.
    await db.prepare('INSERT INTO verification VALUES (?,?,?,?,?,?)')
      .bind('expired', 'fixture', 'fixture', '2000-01-01T00:00:00.000Z', '2000', '2000').run();
    const worker = await mf.getWorker(app);
    await worker.scheduled();
    assert.equal((await db.prepare('SELECT count(*) AS n FROM verification').first())!.n, 0);
  }
  await mf.dispose(); mf = new Miniflare(options);
  let total = 0;
  for (const app of ['heavy', 'mypro']) {
    assert.equal((await mf.dispatchFetch('https://' + app + '.test')).status, 429);
    const db = await mf.getD1Database('AUTH_DB', app);
    total += Number((await db.prepare('SELECT total_attempts FROM auth_mail_budget').first())!.total_attempts);
  }
  assert.equal(total, 6); // Sum of these two allocations only, not an account-wide quota claim.
});
