import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runImageQA, createAttemptJournal } from './hc-10m-real-generation-qa.mjs';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const id='00000000-0000-4000-8000-000000000001';
const jobId='ai-'+id;
const options={apiBaseUrl:'https://api.fixture.invalid',brandId:'brand-1',requestId:id,token:'qa-fixture-session-secret'};
const bytes=Buffer.from([137,80,78,71,13,10,26,10]);
const sha=createHash('sha256').update(bytes).digest('hex');
function fixture(changes={}) {
  const calls=[];let available=changes.available ?? true;let prior=null;let records=0;
  const job={id:jobId,brand_id:'brand-1',user_id:'user-1',created_at:'2026-09-06T12:00:00Z',status:'completed'};
  const journal={read:async()=>prior,record:async record=>{records++;if(changes.failJournal)throw Error('disk unavailable');assert.equal(prior,null);prior=record;}};
  const fetch=async(input,init)=>{
    calls.push({input,init});const u=new URL(input);assert.equal(u.origin,options.apiBaseUrl);
    assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,'Bearer '+options.token);
    if(u.pathname==='/v1/profile')return Response.json({id:changes.userId ?? 'user-1'});
    if(u.pathname==='/v1/image-ai/requests/'+id)return available ? Response.json({requestId:id,jobId,provider:'workers_ai',backendProvider:'cloudflare-workers-ai',state:'completed',success:true,requestedCandidateCount:1,persistedCandidateCount:1,images:[{imageId:'image-1',jobId,candidateIndex:0}],...changes.receipt}) : Response.json({error:'image_request_not_found'},{status:404});
    if(u.pathname==='/v1/provider-actions/generate-image'){
      assert.ok(prior);assert.equal(init.method,'POST');assert.equal(init.headers['idempotency-key'],id);
      assert.equal(JSON.parse(init.body).rightsConfirmed,true);
      available=!changes.remainAbsent;
      if(changes.lostResponse)throw Error(options.token);
      return Response.json({accepted:true});
    }
    assert.equal(init.method,'GET');
    if(u.pathname==='/v1/generation-jobs/'+jobId)return Response.json({...job,...changes.job});
    if(u.pathname==='/v1/generated-images')return Response.json([{id:'image-1',job_id:jobId,brand_id:'brand-1',user_id:'user-1',created_at:job.created_at,metadata:{sha256:sha,contentBytes:bytes.length}}]);
    if(u.pathname==='/v1/generated-images/image-1/content')return new Response(bytes,{headers:{'content-type':'image/png'}});
    if(u.pathname==='/v1/workspace-execution-steps')return Response.json([{id:id+':0:0',job_id:jobId,image_id:'image-1',step_index:0,status:'completed',basis:'cloudflare_execution_ledger',task_code:'候補1・AI処理'},{id:id+':0:1',job_id:jobId,image_id:'image-1',step_index:1,status:'completed',basis:'cloudflare_execution_ledger',task_code:'候補1・private保存'}]);
    throw Error('unexpected route');
  };
  return {calls,journal,fetch,get records(){return records;}};
}
const submit={...options,mode:'submit',action:'generate-image',payload:{brandId:'brand-1',rightsConfirmed:true,prompt:'fixture image'}};
test('default is receipt and real persisted-byte readback, with no submission or quality-completion claim',async()=>{
  const f=fixture();const r=await runImageQA(options,f.journal,f.fetch);
  assert.equal(r.persistedResultVerified,true);assert.equal(r.businessCompletion,'not_verified');
  assert.equal(r.quality,'requires_visual_review');assert.equal(f.records,0);
  assert.ok(f.calls.every(c=>c.init.method==='GET'));
  assert.doesNotMatch(JSON.stringify(r),/qa-fixture-session-secret|Bearer/);
});
test('explicit submission durably records before POST and lost response resolves without a second inference',async()=>{
  const f=fixture({available:false,lostResponse:true});
  const first=await runImageQA(submit,f.journal,f.fetch);
  assert.equal(first.persistedResultVerified,true);assert.equal(f.records,1);
  const second=await runImageQA(submit,f.journal,f.fetch);
  assert.equal(second.submission,'previous_attempt_no_replay');
  assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
  await assert.rejects(runImageQA({...submit,payload:{...submit.payload,prompt:'changed'}},f.journal,f.fetch),/attempt_context_mismatch/);
  assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('journal failure stops POST and a recorded absent request cannot be resubmitted',async()=>{
  const existing=fixture();
  const unbound=await runImageQA(submit,existing.journal,existing.fetch);
  assert.equal(unbound.persistedResultVerified,false);
  assert.equal(existing.calls.filter(c=>c.init.method==='POST').length,0);
  assert.equal(unbound.blockers[0].code,'existing_request_input_not_locally_bound_use_readback');
  const disk=fixture({available:false,failJournal:true});
  await assert.rejects(runImageQA(submit,disk.journal,disk.fetch));
  assert.equal(disk.calls.filter(c=>c.init.method==='POST').length,0);
  const absent=fixture({available:false,remainAbsent:true});
  const first=await runImageQA(submit,absent.journal,absent.fetch);
  assert.equal(first.persistedResultVerified,false);
  const second=await runImageQA(submit,absent.journal,absent.fetch);
  assert.equal(second.submission,'previous_attempt_no_replay');
  assert.equal(absent.calls.filter(c=>c.init.method==='POST').length,1);
});
test('unknown/partial inference and uncomposited protected receipts are not complete',async()=>{
  for(const receipt of [{state:'unknown',success:false},{persistedCandidateCount:0},{requiresProtectedComposite:true},{images:[{imageId:'unrelated',jobId,candidateIndex:0}]}]){
    const f=fixture({receipt});const r=await runImageQA(options,f.journal,f.fetch);
    assert.equal(r.persistedResultVerified,false);assert.ok(r.blockers.length);
    assert.equal(f.calls.filter(c=>c.init.method==='POST').length,0);
  }
});
test('foreign receipt scope and missing rights/configuration cannot trigger inference',async()=>{
  const foreign=fixture({job:{brand_id:'foreign'}});
  await assert.rejects(runImageQA(options,foreign.journal,foreign.fetch),/receipt_scope_mismatch/);
  let calls=0;
  for(const changed of [{token:''},{requestId:'invalid'},{payload:{...submit.payload,rightsConfirmed:false}},{action:'invoke-openai'}]){
    await assert.rejects(runImageQA({...submit,...changed},{read:async()=>null,record:async()=>{}},async()=>{calls++;}));
  }
  assert.equal(calls,0);
});
test('exclusive on-disk attempt survives reopening and cannot be overwritten by another submitter',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'heavy-image-qa-journal-'));
  try {
    const journal=createAttemptJournal(dir);
    const record={schema:'heavy-chain.image-qa-attempt.v2',apiOrigin:options.apiBaseUrl,brandId:options.brandId,userId:'user-1',requestId:id,action:'generate-image',payloadHash:'hash-fixture'};
    assert.equal(await journal.read(),null);await journal.record(record);
    assert.deepEqual(await createAttemptJournal(dir).read(),record);
    await assert.rejects(createAttemptJournal(dir).record({...record,payloadHash:'different'}),{code:'EEXIST'});
    assert.deepEqual(await journal.read(),record);
    assert.equal((await stat(path.join(dir,'attempt.json'))).mode & 0o777,0o600);
    assert.doesNotMatch(await readFile(path.join(dir,'attempt.json'),'utf8'),/qa-fixture-session-secret/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
