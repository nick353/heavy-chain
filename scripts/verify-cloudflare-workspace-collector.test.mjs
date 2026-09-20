import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectWorkspaceReadback } from './collect-workspace-live-readback.mjs';

const bytes = Buffer.from([137,80,78,71,13,10,26,10]);
const hash = createHash('sha256').update(bytes).digest('hex');
const options = { apiBaseUrl:'https://api.fixture.invalid', brandId:'brand-1', jobIds:['job-1'], since:'2026-09-06T12:00:00Z', now:Date.parse('2026-09-06T14:00:00Z'), token:'collector-session-fixture-secret' };
const job = { id:'job-1', brand_id:'brand-1', user_id:'user-1', created_at:'2026-09-06T13:00:00Z', status:'completed', feature_type:'model-matrix', input_params:{ sourceReadback:{ sourceWorkspace:'fitting', workflowVersion:'fitting-brief-local-v1' }, lightchainCompat:{ lightchainTaskCodes:['declared-only'] } } };
const image = { id:'image-1', job_id:'job-1', brand_id:'brand-1', user_id:'user-1', created_at:job.created_at, metadata:{ contentSha256:hash, contentBytes:bytes.length } };
const step = { id:'request-1:0:0', job_id:'job-1', image_id:'image-1', task_code:'候補1・AI処理', step_index:0, status:'unknown', basis:'cloudflare_execution_ledger' };
function fixture(changes = {}) {
  const calls = [];
  return { calls, fetch:async (input, init) => {
    calls.push({ input, init });
    const u = new URL(input); assert.equal(u.origin, options.apiBaseUrl);
    assert.equal(init.method,'GET'); assert.equal(init.redirect,'error'); assert.equal(init.headers.authorization,'Bearer '+options.token);
    if (u.pathname === '/v1/generation-jobs/job-1') return changes.jobResponse?.() ?? Response.json(changes.job ?? job);
    if (u.pathname === '/v1/generated-images') {
      assert.equal(u.searchParams.get('brand_id'),'brand-1'); assert.equal(u.searchParams.get('job_id'),'job-1');
      return Response.json(changes.images?.(u) ?? [image]);
    }
    if (u.pathname === '/v1/generated-images/image-1/content') return changes.content?.() ?? new Response(bytes,{ headers:{'content-type':'image/png'} });
    if (u.pathname === '/v1/workspace-execution-steps') {
      assert.deepEqual(u.searchParams.getAll('job_id'),['job-1']);
      return Response.json(changes.steps ?? [step]);
    }
    throw new Error('unexpected route');
  } };
}
test('named job, exact final image and actual ledger preserve unknown status without synthesizing task completion', async () => {
  const f = fixture(); const r = await collectWorkspaceReadback(options,f.fetch);
  assert.equal(r.collectionComplete,true); assert.equal(r.businessCompletion,'not_verified');
  assert.equal(r.executionSteps[0].status,'unknown'); assert.equal(r.executionSteps.length,1);
  assert.equal(r.jobs[0].source.sourceWorkspace,'fitting'); assert.equal(r.jobs[0].source.basis,'declared_metadata_not_execution');
  assert.equal(r.storage[0].sha256,hash); assert.equal(r.storage[0].checksumVerified,true);
  assert.equal(f.calls.length,4); assert.doesNotMatch(JSON.stringify(r),/declared-only|collector-session-fixture-secret|Bearer/);
});
test('wrong brand, owner, job or time cannot contribute private image proof', async () => {
  for (const changed of [{ brand_id:'foreign' },{ user_id:'foreign' },{ job_id:'other' },{ created_at:'2020-01-01' }]) {
    const f = fixture({ images:()=>[{ ...image,...changed }] }); const r = await collectWorkspaceReadback(options,f.fetch);
    assert.equal(r.collectionComplete,false); assert.equal(r.storage.length,0);
    assert.equal(f.calls.filter(c=>c.input.endsWith('/content')).length,0);
  }
  const old = await collectWorkspaceReadback(options,fixture({ job:{...job,created_at:'2020-01-01'} }).fetch);
  assert.equal(old.jobs.length,0); assert.equal(old.collectionComplete,false);
});
test('empty images or missing execution records remain incomplete and repeated pages are rejected', async () => {
  const empty = await collectWorkspaceReadback(options,fixture({ images:()=>[],steps:[] }).fetch);
  assert.equal(empty.collectionComplete,false);
  assert.ok(empty.blockers.some(b=>b.code==='no_final_image_for_requested_job'));
  assert.ok(empty.blockers.some(b=>b.code==='execution_records_not_available'));
  const page = Array.from({length:100},(_,n)=>({...image,id:'image-'+n}));
  const repeat = await collectWorkspaceReadback(options,fixture({ images:()=>page }).fetch);
  assert.ok(repeat.blockers.some(b=>b.code==='job_unstable_pagination'));
});
test('private content failures never retry or become successful collection', async () => {
  const f = fixture({ content:()=>new Response('hidden diagnostic',{status:503}) });
  const r = await collectWorkspaceReadback(options,f.fetch);
  assert.equal(r.collectionComplete,false); assert.equal(r.storage[0].error,'http_503');
  assert.equal(f.calls.filter(c=>c.input.endsWith('/content')).length,1);
  assert.doesNotMatch(JSON.stringify(r),/hidden diagnostic/);
  const bad = await collectWorkspaceReadback(options,fixture({ images:()=>[{...image,metadata:{contentSha256:'bad'}}] }).fetch);
  assert.equal(bad.storage[0].error,'media_checksum_mismatch');
});
test('step provenance and authority are validated before use and sensitive report values are refused', async () => {
  for (const changed of [{job_id:'foreign'},{basis:'declared_metadata'},{status:'made-up'}]) {
    const r = await collectWorkspaceReadback(options,fixture({steps:[{...step,...changed}]}).fetch);
    assert.equal(r.collectionComplete,false);
  }
  let calls=0;
  for (const changed of [{jobIds:[]},{token:''},{since:'invalid'},{apiBaseUrl:'https://user:password@api.fixture.invalid'}]) {
    await assert.rejects(collectWorkspaceReadback({...options,...changed},async()=>{calls++;}));
  }
  assert.equal(calls,0);
  await assert.rejects(collectWorkspaceReadback(options,fixture({ job:{...job,input_params:{sourceWorkspace:options.token}} }).fetch),/sensitive_output_refused/);
});

function protectedFixture(changes = {}) {
  const finalStep = { ...step, id:'request-1:0:2', step_index:2, task_code:'候補1・最終合成保存', image_id:'wa-final-1', status:'completed', ...changes.step };
  const finalImage = { ...image, id:'wa-final-1', job_id:'wa-final-1', storage_path:'generated-images/wa-final-1', ...changes.image };
  const finalJob = { ...job, id:'wa-final-1', input_params:{ sourceJobId:'job-1', imageAI:{requestId:'request-1',candidateIndex:0}, checksum:hash, contentBytes:bytes.length }, ...changes.finalJob };
  const calls=[];
  return { calls, fetch:async(input,init)=>{
    calls.push({input,init}); assert.equal(init.method,'GET'); assert.equal(init.redirect,'error');
    const u=new URL(input); assert.equal(u.origin,options.apiBaseUrl);
    if(u.pathname==='/v1/generation-jobs/job-1')return Response.json(job);
    if(u.pathname==='/v1/generated-images')return Response.json([]);
    if(u.pathname==='/v1/workspace-execution-steps')return Response.json([
      {...step,image_id:'intermediate-only'},
      {...step,id:'request-1:0:1',step_index:1,image_id:'intermediate-only',status:'completed'},finalStep]);
    if(u.pathname==='/v1/generated-images/wa-final-1')return Response.json(finalImage);
    if(u.pathname==='/v1/generation-jobs/wa-final-1')return Response.json(finalJob);
    if(u.pathname==='/v1/generated-images/wa-final-1/content')return changes.content?.() ?? new Response(bytes,{headers:{'content-type':'image/png'}});
    throw Error('unexpected route');
  }};
}
test('protected source job follows only the completed ledger final save and verifies final receipt and private bytes', async()=>{
  const f=protectedFixture(); const r=await collectWorkspaceReadback(options,f.fetch);
  assert.equal(r.collectionComplete,true); assert.equal(r.images.length,1);
  assert.deepEqual(r.jobs.map(j=>j.id),['job-1','wa-final-1']);
  assert.deepEqual(r.canonicalFinalLinks,[{sourceJobId:'job-1',finalJobId:'wa-final-1',imageId:'wa-final-1',executionStepId:'request-1:0:2',basis:'cloudflare_execution_ledger'}]);
  assert.equal(r.storage[0].checksumVerified,true);
  assert.equal(f.calls.some(c=>c.input.includes('intermediate-only')),false);
});
test('foreign final owner, wrong source, request or receipt do not create a final link',async()=>{
  for(const change of [
    {image:{user_id:'foreign'}}, {image:{brand_id:'foreign'}}, {image:{job_id:'other'}},
    {finalJob:{input_params:{sourceJobId:'foreign',imageAI:{requestId:'request-1',candidateIndex:0},checksum:hash,contentBytes:bytes.length}}},
    {finalJob:{input_params:{sourceJobId:'job-1',imageAI:{requestId:'different',candidateIndex:0},checksum:hash,contentBytes:bytes.length}}},
  ]){
    const f=protectedFixture(change);const r=await collectWorkspaceReadback(options,f.fetch);
    assert.equal(r.collectionComplete,false);assert.equal(r.canonicalFinalLinks.length,0);
    assert.equal(f.calls.some(c=>c.input.endsWith('/content')),false);
  }
  const f=protectedFixture({finalJob:{input_params:{sourceJobId:'job-1',imageAI:{requestId:'request-1',candidateIndex:0},checksum:'0'.repeat(64),contentBytes:bytes.length}}});
  const r=await collectWorkspaceReadback(options,f.fetch);
  assert.equal(r.collectionComplete,false); assert.equal(r.canonicalFinalLinks.length,0);
  assert.ok(r.blockers.some(b=>b.code==='final_link_media_checksum_mismatch'));
});
test('unstarted final saves and failed final bytes stay incomplete without replay',async()=>{
  const f=protectedFixture({step:{status:'not_started'}});const r=await collectWorkspaceReadback(options,f.fetch);
  assert.equal(r.collectionComplete,false);assert.equal(r.canonicalFinalLinks.length,0);
  assert.equal(f.calls.some(c=>c.input.includes('/wa-final-1')),false);
  const broken=protectedFixture({content:()=>new Response('unavailable',{status:502})});
  const failed=await collectWorkspaceReadback(options,broken.fetch);
  assert.equal(failed.collectionComplete,false);assert.equal(failed.canonicalFinalLinks.length,0);
  assert.equal(broken.calls.filter(c=>c.input.endsWith('/content')).length,1);
});
