import assert from 'node:assert/strict';
import test from 'node:test';
import { imageSetup } from './image-ai-fixture.ts';

test('Fitting SQL finds old feature/job results before LIMIT without crossing owner or brand', async t => {
  const s = imageSetup(); t.after(() => s.db.sql.close());
  s.db.sql.exec(`INSERT INTO generation_jobs(id,brand_id,user_id,feature_type,input_params,status,created_at)
    VALUES ('fit-job','brand','alice','model-matrix','{}','completed','2026-09-01');
    INSERT INTO brands(id,owner_id,name,created_at,updated_at) VALUES ('other-brand','alice','Other','2026-09-01','2026-09-01');`);
  const insert = s.db.sql.prepare(`INSERT INTO generated_images
    (id,brand_id,user_id,storage_path,metadata,created_at,feature_type,job_id,is_favorite)
    VALUES (?,?,?,?,?,?,?,?,1)`);
  for (let i=0;i<120;i++) insert.run(`new-${i}`,'brand','alice',`new-${i}`,'{}','2026-09-06','generate-image',null);
  for (const id of ['fit-a','fit-b','fit-c']) insert.run(id,'brand','alice',id,'{"assetPurpose":"print-design"}','2026-09-01','model-matrix','fit-job');
  insert.run('foreign','brand','bob','foreign','{}','2026-09-07','model-matrix','fit-job');
  insert.run('other-brand','other-brand','alice','other','{}','2026-09-07','model-matrix','fit-job');
  insert.run('raw','brand','alice','raw','{"artifactRole":"provider-intermediate"}','2026-09-07','model-matrix','fit-job');
  insert.run('other-feature','brand','alice','other-feature','{}','2026-09-07','generate-image','fit-job');
  const list = async (query: string, user='alice') => {
    const response = await s.call('/v1/generated-images?brand_id=brand&' + query,user);
    assert.equal(response.status,200,await response.clone().text());
    return (await response.json() as Array<{id:string}>).map(row=>row.id);
  };
  const filtered = 'feature_type=model-matrix&job_id=fit-job';
  assert.deepEqual(await list(filtered+'&limit=1'),['fit-c']);
  assert.deepEqual(await list(filtered+'&order=oldest&limit=1'),['fit-a']);
  assert.deepEqual(await list(filtered+'&order=oldest&limit=1&offset=1'),['fit-b']);
  assert.deepEqual(await list(filtered+'&asset_purpose=print-design&favorite=true&has_job=true&limit=100'),['fit-c','fit-b','fit-a']);
  assert.deepEqual(await list('feature_type=model-matrix&limit=100'),['fit-c','fit-b','fit-a']);
  assert.deepEqual(await list(filtered,'bob'),['foreign']);
  assert.deepEqual(await list(filtered+'&has_job=false'),[]);
  assert.deepEqual(await list('feature_type='+encodeURIComponent("x' OR 1=1 --")),[]);
  assert.equal((await s.call('/v1/generated-images?brand_id=brand&'+filtered,'other')).status,403);
  assert.equal(s.calls.length,0);
});

test('Gallery oldest ordering precedes LIMIT and invalid filter values are rejected', async t => {
  const s = imageSetup(); t.after(()=>s.db.sql.close());
  const insert = s.db.sql.prepare(`INSERT INTO generated_images(id,brand_id,user_id,storage_path,metadata,created_at)
    VALUES (?,'brand','alice',?,'{}',?)`);
  for (let i=0;i<120;i++) insert.run(`new-${i}`,`new-${i}`,'2026-09-06');
  insert.run('old-a','old-a','2026-09-01'); insert.run('old-b','old-b','2026-09-01');
  const response = await s.call('/v1/generated-images?brand_id=brand&order=oldest&limit=1&offset=1');
  assert.equal(response.status,200);
  assert.deepEqual((await response.json() as Array<{id:string}>).map(row=>row.id),['old-b']);
  for (const query of ['feature_type=','feature_type=%00','feature_type='+ 'x'.repeat(257),
    'job_id=', 'job_id=%27%20OR%201=1', 'order=', 'order=asc','order=DESC%3BDELETE']) {
    assert.equal((await s.call('/v1/generated-images?brand_id=brand&'+query)).status,400,query);
  }
});

test('Gallery real SQL filters artwork before pagination and preserves user/brand boundaries', async t => {
  const s = imageSetup(); t.after(() => s.db.sql.close());
  const insert = s.db.sql.prepare(`INSERT INTO generated_images
    (id,brand_id,user_id,storage_path,metadata,created_at,is_favorite)
    VALUES (?,'brand',?,?,?,?,?)`);
  for (let i = 0; i < 120; i++) insert.run(`new-${i}`, 'alice', `new-${i}.png`, '{}', '2026-09-06', 0);
  for (const id of ['art-a','art-b','art-c']) insert.run(id, 'alice', `${id}.png`, '{"assetPurpose":"print-design"}', '2026-09-05', 1);
  insert.run('foreign-art', 'bob', 'foreign.png', '{"assetPurpose":"print-design"}', '2026-09-07', 1);
  insert.run('raw-art', 'alice', 'raw.png', '{"assetPurpose":"print-design","artifactRole":"provider-intermediate"}', '2026-09-07', 1);
  insert.run('malformed', 'alice', 'bad.png', '{', '2026-09-07', 1);
  s.db.sql.exec(`INSERT INTO brands(id,owner_id,name,created_at,updated_at)
    VALUES ('other-brand','alice','Other','2026-09-06','2026-09-06');
    INSERT INTO generated_images(id,brand_id,user_id,storage_path,metadata,created_at,is_favorite)
    VALUES ('other-brand-art','other-brand','alice','other.png','{"assetPurpose":"print-design"}','2026-09-07',1);`);
  const list = async (query: string, user = 'alice') => {
    const response = await s.call('/v1/generated-images?brand_id=brand' + query, user);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json() as Array<{id:string}>).map(row => row.id);
  };
  assert.deepEqual(await list('&asset_purpose=print-design&favorite=true&limit=2'), ['art-c','art-b']);
  assert.deepEqual(await list('&asset_purpose=print-design&favorite=true&limit=2&offset=2'), ['art-a']);
  assert.deepEqual(await list('&asset_purpose=print-design', 'bob'), ['foreign-art']);
  assert.equal((await s.call('/v1/generated-images?brand_id=brand&asset_purpose=print-design', 'other')).status, 403);
  assert.equal((await list('&limit=100')).length, 100);
  assert.equal(s.calls.length, 0);
});

test('Gallery real SQL combines generation history and purpose before limit; rejects invalid filters', async t => {
  const s = imageSetup(); t.after(() => s.db.sql.close());
  s.db.sql.exec(`INSERT INTO generation_jobs(id,brand_id,user_id,feature_type,input_params,status,created_at)
    VALUES ('job','brand','alice','generate-image','{}','completed','2026-09-05');
    INSERT INTO generated_images(id,brand_id,user_id,storage_path,metadata,created_at,job_id)
    VALUES ('generated','brand','alice','generated.png','{"assetPurpose":"print-design"}','2026-09-05','job'),
           ('upload','brand','alice','upload.png','{"assetPurpose":"print-design"}','2026-09-06',NULL);`);
  for (const [hasJob, expected] of [['true','generated'], ['false','upload']]) {
    const response = await s.call('/v1/generated-images?brand_id=brand&asset_purpose=print-design&has_job=' + hasJob + '&limit=1');
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual((await response.json() as Array<{id:string}>).map(row => row.id), [expected]);
  }
  for (const query of ['asset_purpose=garment','asset_purpose=','has_job=1', 'has_job=']) {
    assert.equal((await s.call('/v1/generated-images?brand_id=brand&' + query)).status, 400);
  }
});
