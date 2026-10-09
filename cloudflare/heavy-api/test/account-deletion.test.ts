import assert from 'node:assert/strict';
import test from 'node:test';
import { imageSetup } from './image-ai-fixture.ts';

type Setup = ReturnType<typeof imageSetup>;

function withAuth(s: Setup, answer: (dryRun: boolean) => number = () => 204) {
  const erase: boolean[] = [];
  Object.assign(s.env, {
    AUTH_ISSUER: 'https://auth.test',
    AUTH_SERVICE: { fetch: async (request: Request) => {
      assert.equal(new URL(request.url).pathname, '/v1/account/erase');
      const { dryRun } = await request.json() as { dryRun: boolean };
      erase.push(dryRun);
      return new Response(null, { status: answer(dryRun) });
    } },
  });
  const deleted: string[] = [];
  const bucket = s.bucket as unknown as { delete(keys: string | string[]): Promise<void>; rows: Map<string, unknown> };
  bucket.delete = async (keys) => { for (const key of [keys].flat()) { deleted.push(key); bucket.rows.delete(key); } };
  return { erase, deleted };
}

const remove = (s: Setup, user: string, confirmation: unknown = 'DELETE_ACCOUNT') =>
  s.call('/v1/account/delete', user, { confirmation });

const count = (s: Setup, query: string, ...values: string[]) =>
  (s.db.sql.prepare(query).get(...values) as { n: number }).n;

function seedSolo(s: Setup) {
  s.db.sql.exec(`
    INSERT INTO brands(id,owner_id,name,created_at,updated_at) VALUES ('solo','other','Solo','2026-09-06','2026-09-06');
    INSERT INTO generation_jobs(id,brand_id,user_id,feature_type,input_params,status,created_at) VALUES ('job-o','solo','other','generate-image','{}','completed','2026-09-06');
    INSERT INTO generated_images(id,job_id,brand_id,user_id,storage_path,metadata,created_at) VALUES
      ('img-o','job-o','solo','other','generated-images/img-o','{}','2026-09-06'),
      ('img-o-in-alice','job-o','brand','other','generated-images/img-o-in-alice','{}','2026-09-06'),
      ('img-bob','job-o','brand','bob','generated-images/img-bob','{}','2026-09-06');
    INSERT INTO canvas_documents(id,owner_id,brand_id,title,snapshot,created_at,updated_at) VALUES ('doc-o','other','solo','P','{}','2026-09-06','2026-09-06');
    INSERT INTO feedback_submissions(id,user_id,request_id,payload_hash,type,message,email,page_url,pathname,screenshot_path,screenshot_capture_status,submission_state,status,created_at,updated_at)
      VALUES ('fb-o','other','req-fb','h','other','m','other@example.test','https://heavy.test/','/','feedback/fb-o.png','captured','accepted','new','2026-09-06','2026-09-06');
    INSERT INTO media_assets(id,owner_issuer,owner_subject,client_request_id,object_key,content_type,declared_size_bytes,state,created_at,updated_at)
      VALUES ('m-o','test-issuer','other','c1','media/v1/m-o','image/png',10,'ready','2026-09-06','2026-09-06');`);
  for (const key of ['generated-images/img-o', 'generated-images/img-o-in-alice', 'generated-images/img-bob', 'feedback/fb-o.png', 'media/v1/m-o']) {
    (s.bucket as unknown as { rows: Map<string, unknown> }).rows.set(key, {});
  }
}

test('account deletion removes the user, owned brand, files and auth user; leaves other users untouched', async t => {
  const s = imageSetup(); t.after(() => s.db.sql.close());
  seedSolo(s);
  const { erase, deleted } = withAuth(s);
  const response = await remove(s, 'other');
  assert.equal(response.status, 204, await response.clone().text());
  assert.deepEqual(erase, [true, false]);
  for (const key of ['generated-images/img-o', 'generated-thumbnails/img-o.webp', 'generated-images/img-o-in-alice', 'feedback/fb-o.png', 'media/v1/m-o']) {
    assert.ok(deleted.includes(key), key);
  }
  assert.ok(!deleted.includes('generated-images/img-bob'));
  assert.equal(count(s, `SELECT COUNT(*) n FROM users WHERE id = 'other'`), 0);
  assert.equal(count(s, `SELECT COUNT(*) n FROM user_identities WHERE principal_id = 'other'`), 0);
  assert.equal(count(s, `SELECT COUNT(*) n FROM brands WHERE owner_id = 'other'`), 0);
  assert.equal(count(s, `SELECT COUNT(*) n FROM generated_images WHERE user_id = 'other'`), 0);
  assert.equal(count(s, `SELECT COUNT(*) n FROM canvas_documents WHERE owner_id = 'other'`), 0);
  assert.equal(count(s, `SELECT COUNT(*) n FROM feedback_submissions WHERE user_id = 'other'`), 0);
  assert.equal(count(s, `SELECT COUNT(*) n FROM heavy_terms_acceptances WHERE user_id = 'other'`), 0);
  assert.equal(count(s, `SELECT COUNT(*) n FROM media_assets WHERE owner_subject = 'other'`), 0);
  assert.equal(count(s, `SELECT COUNT(*) n FROM generated_images WHERE id = 'img-bob'`), 1);
  assert.equal(count(s, `SELECT COUNT(*) n FROM brands WHERE id = 'brand'`), 1);
  assert.equal(count(s, `SELECT COUNT(*) n FROM users WHERE id IN ('alice','bob','viewer')`), 3);
});

test('a member who owns nothing can leave: their work in the shared brand goes, the brand stays', async t => {
  const s = imageSetup(); t.after(() => s.db.sql.close());
  seedSolo(s);
  withAuth(s);
  assert.equal((await remove(s, 'bob')).status, 204);
  assert.equal(count(s, `SELECT COUNT(*) n FROM brand_members WHERE user_id = 'bob'`), 0);
  assert.equal(count(s, `SELECT COUNT(*) n FROM generated_images WHERE id = 'img-bob'`), 0);
  assert.equal(count(s, `SELECT COUNT(*) n FROM brand_members WHERE brand_id = 'brand'`), 1);
  assert.equal(count(s, `SELECT COUNT(*) n FROM brands WHERE id = 'brand'`), 1);
});

test('account deletion refuses shared brands, admins, missing confirmation and stale sessions without deleting anything', async t => {
  const s = imageSetup(); t.after(() => s.db.sql.close());
  seedSolo(s);
  let auth = 204;
  const { erase, deleted } = withAuth(s, () => auth);
  const users = () => count(s, `SELECT COUNT(*) n FROM users`);
  const before = users();
  assert.equal((await remove(s, 'alice')).status, 409, 'alice owns a brand with members');
  assert.equal((await remove(s, 'other', 'yes')).status, 400);
  assert.equal((await remove(s, '')).status, 401, 'no session');
  s.db.sql.exec(`INSERT INTO platform_admins(user_id,granted_at,grant_reason) VALUES ('viewer','2026-09-06','test')`);
  assert.equal((await remove(s, 'viewer')).status, 409);
  auth = 403;
  assert.equal((await remove(s, 'other')).status, 403);
  assert.deepEqual(erase, [true]);
  assert.deepEqual(deleted, []);
  assert.equal(users(), before);
});

test('a lost auth erase is retryable: the second request finishes the job', async t => {
  const s = imageSetup(); t.after(() => s.db.sql.close());
  seedSolo(s);
  let finalAnswer = 503;
  const { erase } = withAuth(s, dryRun => dryRun ? 204 : finalAnswer);
  assert.equal((await remove(s, 'other')).status, 503);
  assert.equal(count(s, `SELECT COUNT(*) n FROM brands WHERE owner_id = 'other'`), 0);
  // The test verifier still accepts the session; recreate the mapping the real principal() would provision.
  s.db.sql.exec(`INSERT INTO user_identities VALUES ('other','test-issuer','other','2026-09-07');
    INSERT INTO users(id,email,created_at,updated_at) VALUES ('other','other@example.test','2026-09-07','2026-09-07');`);
  finalAnswer = 204;
  assert.equal((await remove(s, 'other')).status, 204);
  assert.deepEqual(erase, [true, false, true, false]);
  assert.equal(count(s, `SELECT COUNT(*) n FROM users WHERE id = 'other'`), 0);
});

test('evidence tables stay append-only outside an account deletion', async t => {
  const s = imageSetup(); t.after(() => s.db.sql.close());
  assert.throws(() => s.db.sql.exec(`DELETE FROM heavy_terms_acceptances WHERE user_id = 'alice'`), /append_only/);
  s.db.sql.exec(`INSERT INTO account_erasures VALUES ('bob','2026-09-06')`);
  assert.throws(() => s.db.sql.exec(`DELETE FROM heavy_terms_acceptances WHERE user_id = 'alice'`), /append_only/);
  s.db.sql.exec(`DELETE FROM heavy_terms_acceptances WHERE user_id = 'bob'`);
});
