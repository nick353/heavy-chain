import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleRequest, type Env } from '../src/index.ts';
import { studioFeedbackImagePath, studioFeedbackInput } from '../src/core.ts';

// ファッションスタジオの生成結果の 👍👎「フィードバックする」（本家の ai-task-feedback と同じ役目）を、本物の SQL で確かめる。
class Db {
  sql = new DatabaseSync(':memory:');
  beforeWrite: ((sql: string) => void) | null = null;
  constructor() {
    this.sql.exec('PRAGMA foreign_keys = ON;');
    const folder = new URL('../migrations/', import.meta.url);
    for (const file of readdirSync(folder).filter(f => f.endsWith('.sql')).sort()) this.sql.exec(readFileSync(new URL(file, folder), 'utf8'));
    for (const user of ['alice', 'bob', 'viewer']) {
      this.sql.prepare('INSERT INTO user_identities VALUES (?,?,?,?)').run(user, 'studio-issuer', user, '2026-11-12');
      this.sql.prepare('INSERT INTO users (id,email,created_at,updated_at) VALUES (?,?,?,?)').run(user, `${user}@example.test`, '2026-11-12', '2026-11-12');
    }
    for (const brand of ['brand-1', 'brand-2']) this.sql.prepare('INSERT INTO brands (id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(brand, brand === 'brand-1' ? 'alice' : 'bob', brand, '2026-11-12', '2026-11-12');
    this.sql.exec("INSERT INTO brand_members(id,brand_id,user_id,role,joined_at) VALUES ('viewer-member','brand-1','viewer','viewer','2026-11-12')");
    const snapshot = JSON.stringify({ version: 1, objects: [
      { id: 'result-1', type: 'image', src: 'brand-1/generated/result-1.png', metadata: { parameters: { layerRole: 'generated-result' } } },
      { id: 'note', type: 'text', text: 'not an image' },
    ] });
    this.sql.prepare('INSERT INTO canvas_documents (id,owner_id,brand_id,title,snapshot,snapshot_version,revision,created_at,updated_at) VALUES (?,?,?,?,?,1,0,?,?)')
      .run('doc-1', 'alice', 'brand-1', 'Untitled', snapshot, '2026-11-12', '2026-11-12');
  }
  prepare(sql: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the nested statement mock must reach its outer harness.
    const db = this;
    return new class {
      values: SQLInputValue[] = [];
      bind(...values: SQLInputValue[]) { this.values = values; return this; }
      async first<T>() { return (db.sql.prepare(sql).get(...this.values) ?? null) as T | null; }
      async all() { return { results: db.sql.prepare(sql).all(...this.values) }; }
      async run() { db.beforeWrite?.(sql); const result = db.sql.prepare(sql).run(...this.values); return { meta: result }; }
    }();
  }
}
function setup() {
  const db = new Db();
  const env = { DB: db, FRONTEND_ORIGINS: 'https://heavy.test', MEDIA_TOKEN_VERIFIER: (r: Request) => ({ issuer: 'studio-issuer', subject: r.headers.get('authorization')!.slice(7) }) } as unknown as Env;
  const call = (method: string, path: string, body?: unknown, user = 'alice') => handleRequest(new Request('https://api.test/v1/canvas-documents' + path, {
    method, headers: { authorization: `Bearer ${user}`, origin: 'https://heavy.test', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
  const rows = () => db.sql.prepare('SELECT * FROM studio_result_feedback').all() as Record<string, unknown>[];
  return { db, call, rows };
}

test('スタジオのフィードバック: 👍・👎と理由・要望を1行に上書きし、読み直すと同じ状態が返る', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const like = await s.call('PUT', '/doc-1/studio-feedback/result-1', { studio_function: 'region', direction: 1, reasons: [], remark: '', improve: '' });
  assert.equal(like.status, 200, await like.clone().text());
  assert.equal(like.headers.get('access-control-allow-origin'), 'https://heavy.test');
  assert.equal((await like.json() as { direction: number }).direction, 1);
  const dislike = await s.call('PUT', '/doc-1/studio-feedback/result-1', { studio_function: 'region', direction: 0, reasons: ['エッジがぼやけている', 'その他', 'エッジがぼやけている'], remark: '肩ひもが太い', improve: '色を残したい' });
  assert.equal(dislike.status, 200);
  assert.deepEqual((await dislike.json() as { reasons: string[] }).reasons, ['エッジがぼやけている', 'その他']);
  const saved = s.rows();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].direction, 0);
  assert.equal(saved[0].image_path, 'brand-1/generated/result-1.png', '画像の住所はプロジェクトに保存された結果から取る');
  assert.equal(saved[0].brand_id, 'brand-1');
  assert.equal(saved[0].user_id, 'alice');
  const list = await (await s.call('GET', '/doc-1/studio-feedback')).json() as { feedback: Record<string, unknown>[] };
  assert.deepEqual(list.feedback.map(row => ({ ...row, updated_at: undefined })), [{ object_id: 'result-1', studio_function: 'region', direction: 0,
    reasons: ['エッジがぼやけている', 'その他'], remark: '肩ひもが太い', improve: '色を残したい', updated_at: undefined }]);
  // フィードバックする（要望だけ）は向きを消せる（null）
  assert.equal((await s.call('PUT', '/doc-1/studio-feedback/result-1', { direction: null, reasons: [], remark: '', improve: '新しい機能がほしい\n2行目' })).status, 200);
  assert.equal(s.rows()[0].direction, null);
});

test('スタジオのフィードバック: 見られない人・無いプロジェクト・プロジェクトに無い画像は書けない（404）', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const body = { studio_function: 'text', direction: 1, reasons: [], remark: '', improve: '' };
  assert.equal((await s.call('PUT', '/doc-1/studio-feedback/result-1', body, 'bob')).status, 404, 'ほかのブランドの人');
  assert.equal((await s.call('GET', '/doc-1/studio-feedback', undefined, 'bob')).status, 404);
  assert.equal((await s.call('PUT', '/doc-missing/studio-feedback/result-1', body)).status, 404);
  assert.equal((await s.call('PUT', '/doc-1/studio-feedback/other-object', body)).status, 404, 'プロジェクトに無い画像');
  assert.equal((await s.call('PUT', '/doc-1/studio-feedback/note', body)).status, 404, '画像ではない物');
  assert.equal(s.rows().length, 0);
  assert.equal((await s.call('PUT', '/doc-1/studio-feedback/result-1', body, 'viewer')).status, 200, '閲覧者は押せる');
  assert.equal(s.rows()[0].user_id, 'viewer');
});

test('スタジオのフィードバック: 書く直前に外された人の書き込みは残らない', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  s.db.beforeWrite = sql => { if (/INSERT INTO studio_result_feedback/.test(sql)) { s.db.beforeWrite = null; s.db.sql.exec("UPDATE brand_members SET joined_at=NULL WHERE user_id='viewer'"); } };
  assert.equal((await s.call('PUT', '/doc-1/studio-feedback/result-1', { direction: 1 }, 'viewer')).status, 404);
  assert.equal(s.rows().length, 0);
});

test('スタジオのフィードバック: 送る内容の点検（向き・機能・理由・その他の文 50字・要望 1000字）', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  for (const bad of [{ direction: 2 }, { direction: '1' }, { studio_function: 'video' }, { reasons: 'その他' }, { reasons: Array.from({ length: 21 }, (_, i) => `r${i}`) },
    { reasons: ['x'.repeat(41)] }, { reasons: [''] }, { remark: 'あ'.repeat(51) }, { improve: 'あ'.repeat(1001) }, { remark: '改行\nは不可' }, { improve: 'tab\tは不可' }]) {
    assert.equal((await s.call('PUT', '/doc-1/studio-feedback/result-1', bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(s.rows().length, 0);
  assert.deepEqual(studioFeedbackInput({ direction: 0, reasons: [' その他 ', 'その他'], remark: 'あ'.repeat(50), improve: 'あ'.repeat(1000) })?.reasons, ['その他']);
  assert.equal(studioFeedbackImagePath({ objects: [{ id: 'a', type: 'image', src: 'data:image/png;base64,AAAA' }] }, 'a'), null, 'data: の住所は残さない');
  assert.equal(studioFeedbackImagePath({ objects: [] }, 'a'), undefined);
});

test('スタジオのフィードバック: プロジェクトを消すと一緒に消える', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  assert.equal((await s.call('PUT', '/doc-1/studio-feedback/result-1', { direction: 1 })).status, 200);
  assert.equal((await s.call('DELETE', '/doc-1')).status, 204);
  assert.equal(s.rows().length, 0);
});
