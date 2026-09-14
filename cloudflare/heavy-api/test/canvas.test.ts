import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleRequest, type Env } from '../src/index.ts';

class Db {
  sql = new DatabaseSync(':memory:');
  beforeWrite: ((sql:string)=>void)|null = null;
  fail: {match:RegExp;phase:'before'|'after'|'read'}|null = null;
  writes: string[] = [];
  constructor() {
    const folder = new URL('../migrations/',import.meta.url);
    for(const file of readdirSync(folder).filter(f=>f.endsWith('.sql')).sort())this.sql.exec(readFileSync(new URL(file,folder),'utf8'));
    for(const user of ['alice','bob','viewer']) {
      this.sql.prepare('INSERT INTO user_identities VALUES (?,?,?,?)').run(user,'canvas-issuer',user,'2026-09-06');
      this.sql.prepare('INSERT INTO users (id,email,created_at,updated_at) VALUES (?,?,?,?)').run(user,`${user}@example.test`,'2026-09-06','2026-09-06');
    }
    for(const brand of ['brand-1','brand-2'])this.sql.prepare('INSERT INTO brands (id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(brand,'alice',brand,'2026-09-06','2026-09-06');
    this.sql.exec("INSERT INTO brand_members(id,brand_id,user_id,role,joined_at) VALUES ('viewer-member','brand-1','viewer','viewer','2026-09-06')");
  }
  maybeFail(sql:string,phase:'before'|'after'|'read') {
    if(this.fail?.phase===phase&&this.fail.match.test(sql)){this.fail=null;throw new Error('D1 response unavailable');}
  }
  prepare(sql:string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the nested statement mock must reach its outer harness.
    const db=this;
    return new class {
      values:SQLInputValue[]=[];
      bind(...values:SQLInputValue[]){this.values=values;return this;}
      async first<T>(){db.maybeFail(sql,'read');return(db.sql.prepare(sql).get(...this.values)??null) as T|null;}
      async all(){db.maybeFail(sql,'read');return{results:db.sql.prepare(sql).all(...this.values)};}
      async run(){db.beforeWrite?.(sql);db.maybeFail(sql,'before');db.writes.push(sql);const result=db.sql.prepare(sql).run(...this.values);db.maybeFail(sql,'after');return{meta:result};}
    }();
  }
}
function setup() {
  const db=new Db();
  const env={DB:db,FRONTEND_ORIGINS:'https://heavy.test',MEDIA_TOKEN_VERIFIER:(r:Request)=>({issuer:'canvas-issuer',subject:r.headers.get('authorization')!.slice(7)})} as unknown as Env;
  const call=(method:string,path:string,body?:unknown,user='alice')=>handleRequest(new Request('https://api.test/v1/canvas-documents'+path,{
    method,headers:{authorization:`Bearer ${user}`,origin:'https://heavy.test','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  const row=(id:string)=>db.sql.prepare('SELECT * FROM canvas_documents WHERE id=?').get(id);
  const editor=()=>db.sql.exec("INSERT INTO brand_members(id,brand_id,user_id,role,joined_at) VALUES ('bob-member','brand-1','bob','editor','2026-09-06')");
  return{db,call,row,editor};
}
const input=()=>({id:crypto.randomUUID(),brand_id:'brand-1',title:'Durable board',snapshot:{version:1,objects:[{id:'note',type:'text',text:'original'}]}});

test('real Canvas SQL: exact create retry is one revision-zero row; changed body, owner and brand conflict',async t=>{
  const s=setup();t.after(()=>s.db.sql.close());const body=input();
  const first=await s.call('POST','',body);assert.equal(first.status,200,await first.clone().text());
  assert.equal(first.headers.get('access-control-allow-origin'),'https://heavy.test');
  const record=await first.json();assert.equal((record as {id:string}).id,body.id);
  const reordered={...body,snapshot:{objects:[{text:'original',type:'text',id:'note'}],version:1}};
  assert.deepEqual(await(await s.call('POST','',reordered)).json(),record);
  assert.equal(s.db.sql.prepare('SELECT COUNT(*) AS n FROM canvas_documents').get()?.n,1);assert.equal(s.row(body.id)?.revision,0);
  for(const patch of [{title:'Changed'}, {snapshot:{version:1,objects:[]}}, {brand_id:'brand-2'}])assert.equal((await s.call('POST','',{...body,...patch})).status,409);
  assert.equal((await s.call('POST','',body,'bob')).status,403);s.editor();
  assert.equal((await s.call('POST','',body,'bob')).status,409);
  assert.equal((await s.call('POST','',input(),'viewer')).status,403);
  assert.equal(s.row(body.id)?.title,body.title);assert.equal(s.row(body.id)?.revision,0);
});

test('real Canvas SQL: lost INSERT receipt reconciles exact row; precommit/read failure keeps same-ID recovery',async t=>{
  const s=setup();t.after(()=>s.db.sql.close());const body=input();
  s.db.fail={match:/INSERT INTO canvas_documents/,phase:'after'};
  assert.equal((await s.call('POST','',body)).status,200);assert.equal(s.row(body.id)?.revision,0);
  const next=input();s.db.fail={match:/INSERT INTO canvas_documents/,phase:'before'};
  assert.equal((await s.call('POST','',next)).status,503);assert.equal(s.row(next.id),undefined);
  assert.equal((await s.call('POST','',next)).status,200);
  const last=input();s.db.fail={match:/FROM canvas_documents WHERE id/,phase:'read'};
  assert.equal((await s.call('POST','',last)).status,503);assert.equal(s.row(last.id)?.revision,0);
  assert.equal((await s.call('POST','',last)).status,200);
  assert.equal(s.db.sql.prepare('SELECT COUNT(*) AS n FROM canvas_documents').get()?.n,3);
});

test('real Canvas SQL: role revocation immediately before INSERT and PATCH prevents the write atomically',async t=>{
  const s=setup();t.after(()=>s.db.sql.close());s.editor();const body=input();
  s.db.beforeWrite=sql=>{if(/INSERT INTO canvas_documents/.test(sql)){s.db.beforeWrite=null;s.db.sql.exec("UPDATE brand_members SET role='viewer' WHERE user_id='bob'");}};
  assert.equal((await s.call('POST','',body,'bob')).status,403);assert.equal(s.row(body.id),undefined);
  s.db.sql.exec("UPDATE brand_members SET role='editor' WHERE user_id='bob'");
  assert.equal((await s.call('POST','',body,'bob')).status,200);
  s.db.beforeWrite=sql=>{if(/UPDATE canvas_documents SET/.test(sql)){s.db.beforeWrite=null;s.db.sql.exec("UPDATE brand_members SET joined_at=NULL WHERE user_id='bob'");}};
  assert.equal((await s.call('PATCH','/'+body.id,{...body,title:'Revoked edit',expected_revision:0},'bob')).status,403);
  assert.equal(s.row(body.id)?.revision,0);assert.equal(s.row(body.id)?.title,body.title);
  const ownerInput=input();s.db.beforeWrite=sql=>{if(/INSERT INTO canvas_documents/.test(sql)){s.db.beforeWrite=null;s.db.sql.exec("UPDATE brands SET owner_id='bob' WHERE id='brand-1'");}};
  assert.equal((await s.call('POST','',ownerInput)).status,403);assert.equal(s.row(ownerInput.id),undefined);
});

test('real Canvas SQL: shared editors retain owner; stale revision and foreign/viewer writes cannot overwrite',async t=>{
  const s=setup();t.after(()=>s.db.sql.close());const body=input();await s.call('POST','',body);s.editor();
  const update={title:'Edited by member',snapshot:{version:1,objects:[]},expected_revision:0};
  const response=await s.call('PATCH','/'+body.id,update,'bob');assert.equal(response.status,200,await response.clone().text());
  assert.equal(s.row(body.id)?.owner_id,'alice');assert.equal(s.row(body.id)?.revision,1);
  assert.equal((await s.call('PATCH','/'+body.id,{...update,title:'stale'})).status,409);
  assert.equal((await s.call('PATCH','/'+body.id,{...update,expected_revision:1},'viewer')).status,404);
  s.db.sql.exec("DELETE FROM brand_members WHERE user_id='bob'");
  assert.equal((await s.call('GET','/'+body.id,undefined,'bob')).status,404);
  assert.equal((await s.call('PATCH','/'+body.id,{...update,expected_revision:1},'bob')).status,404);
  assert.equal((await s.call('PATCH','/'+crypto.randomUUID(),update)).status,404);
  assert.equal(s.row(body.id)?.title,update.title);assert.equal(s.row(body.id)?.revision,1);
});

test('real Canvas SQL: lost PATCH receipt is 503; GET reveals one commit and stale retry cannot increment it again',async t=>{
  const s=setup();t.after(()=>s.db.sql.close());const body=input();await s.call('POST','',body);
  const update={title:'One commit',snapshot:{version:1,objects:[]},expected_revision:0};
  s.db.fail={match:/UPDATE canvas_documents SET/,phase:'after'};
  assert.equal((await s.call('PATCH','/'+body.id,update)).status,503);
  assert.equal((await(await s.call('GET','/'+body.id)).json() as {revision:number}).revision,1);
  assert.equal((await s.call('PATCH','/'+body.id,update)).status,409);assert.equal(s.row(body.id)?.revision,1);
});

test('real Canvas SQL: snapshot validation rejects unsafe images before writes and preserves PATCH state',async t=>{
  const invalidSnapshots=[
    undefined,
    {},
    {objects:'not-an-array'},
    {objects:[null]},
    {objects:[{type:'image'}]},
    {objects:[{type:'image',src:'   '}]},
    {objects:[{type:'image',src:123}]},
    ...['data:image/png;base64,abc',' BLOB:https://example.test/image.png ','LOCAL-CANVAS-ASSET://asset-1']
      .map(src=>({objects:[{type:'image',src}]})),
  ];
  const s=setup();t.after(()=>s.db.sql.close());
  for(const snapshot of invalidSnapshots){
    const writes=s.db.writes.length;
    const response=await s.call('POST','',{...input(),id:crypto.randomUUID(),snapshot});
    assert.equal(response.status,400,await response.clone().text());
    assert.deepEqual(await response.json(),{error:'invalid_canvas_document'});
    assert.equal(s.db.writes.length,writes);
  }
  const body=input();assert.equal((await s.call('POST','',body)).status,200);
  const before=s.row(body.id);
  for(const snapshot of invalidSnapshots){
    const writes=s.db.writes.length;
    const response=await s.call('PATCH','/'+body.id,{snapshot,expected_revision:0});
    assert.equal(response.status,400,await response.clone().text());
    assert.deepEqual(await response.json(),{error:'invalid_canvas_document'});
    assert.equal(s.db.writes.length,writes);
    assert.deepEqual(s.row(body.id),before);
  }
});

test('real Canvas SQL: valid image URLs and empty, text, and shape snapshots remain accepted',async t=>{
  const s=setup();t.after(()=>s.db.sql.close());
  for(const snapshot of [
    {objects:[{type:'image',src:' https://cdn.example.test/image.png '}]},
    {objects:[]},
    {objects:[{type:'text',text:'hello'}]},
    {objects:[{type:'rect',left:10,top:20}]},
  ] as const){
    const body={...input(),id:crypto.randomUUID(),snapshot};
    const response=await s.call('POST','',body);
    assert.equal(response.status,200);
    const source=snapshot.objects[0];
    if(source?.type==='image') {
      const saved=await response.json() as {snapshot:{objects:Array<{src:string}>}};
      assert.equal(saved.snapshot.objects[0].src,source.src);
    }
  }
});
