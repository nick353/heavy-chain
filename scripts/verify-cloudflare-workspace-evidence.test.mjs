import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyWorkspaceEvidence } from './cloudflare-workspace-evidence.mjs';
import { collectWorkspaceReadback } from './collect-workspace-live-readback.mjs';
import { createHash } from 'node:crypto';

const now = Date.parse('2026-09-07T00:00:00Z');
const expected = { apiOrigin:'https://fixture.invalid', brandId:'brand', userId:'user', since:'2026-09-06T23:00:00Z', jobs:[{id:'job',requestId:'request',candidateCount:1,protectedEdit:false}] };
const bytes = Buffer.from('fixture image');
const hash = createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  return collectWorkspaceReadback({apiBaseUrl:expected.apiOrigin,brandId:'brand',jobIds:['job'],since:expected.since,now,token:'fixture-token'}, async input => {
    const pathname = new URL(input).pathname;
    const base = {brand_id:'brand',user_id:'user',created_at:'2026-09-06T23:30:00Z'};
    if (pathname === '/v1/generation-jobs/job') return Response.json({...base,id:'job',status:'completed'});
    if (pathname === '/v1/generated-images') return Response.json([{...base,id:'image',job_id:'job',metadata:{contentSha256:hash,contentBytes:bytes.length}}]);
    if (pathname.endsWith('/content')) return new Response(bytes,{headers:{'content-type':'image/png'}});
    if (pathname === '/v1/workspace-execution-steps') return Response.json([0,1].map(phase=>({id:`request:0:${phase}`,job_id:'job',image_id:'image',task_code:'phase',step_index:phase,status:'completed',basis:'cloudflare_execution_ledger'})));
    throw Error('unexpected request');
  });
}
test('actual collector shape passes offline consistency without claiming business completion',async()=>{
  const result = verifyWorkspaceEvidence(await fixture(),expected,now);
  assert.deepEqual(result,{persistedEvidenceConsistent:true,businessCompletion:'not_verified',failures:[]});
});
test('missing, unknown, duplicate, wrong-owner and unverified private bytes fail',async()=>{
  const changes = [r=>r.executionSteps.pop(),r=>r.executionSteps[0].status='unknown',r=>r.executionSteps.push(r.executionSteps[0]),
    r=>r.images[0].user_id='other',r=>r.storage[0].checksumVerified=false,r=>r.storage[0].sha256='bad',r=>r.jobs[0].status='processing',
    r=>r.images[0].created_at='2027-01-01',r=>r.scope.requestedJobIds.push('job'),r=>r.storage.push({...r.storage[0],imageId:'extra'})];
  for (const change of changes) { const r=await fixture(); change(r); assert.equal(verifyWorkspaceEvidence(r,expected,now).persistedEvidenceConsistent,false); }
});
test('explicit candidate, request, phase and observation expectations cannot be inferred from a partial report',async()=>{
  const r=await fixture();
  for (const change of [{candidateCount:2},{requestId:'other'},{protectedEdit:true}]) {
    assert.equal(verifyWorkspaceEvidence(r,{...expected,jobs:[{...expected.jobs[0],...change}]},now).persistedEvidenceConsistent,false);
  }
  assert.equal(verifyWorkspaceEvidence(r,expected,now+900001).persistedEvidenceConsistent,false);
  for (const e of [null,{}, {...expected,userId:'other'},{...expected,apiOrigin:'https://other.invalid'}]) assert.equal(verifyWorkspaceEvidence(r,e,now).persistedEvidenceConsistent,false);
});
test('protected edit requires exact final-save link and final job, not only intermediate persistence',async()=>{
  const r=await fixture();
  const e={...expected,jobs:[{...expected.jobs[0],protectedEdit:true}]};
  r.executionSteps.push({...r.executionSteps[0],id:'request:0:2',step_index:2,image_id:'final'});
  r.jobs.push({...r.jobs[0],id:'final'});
  r.images[0]={...r.images[0],id:'final',job_id:'final'};
  r.storage[0]={...r.storage[0],imageId:'final',jobId:'final'};
  r.canonicalFinalLinks.push({sourceJobId:'job',finalJobId:'final',imageId:'final',executionStepId:'request:0:2',basis:'cloudflare_execution_ledger'});
  assert.equal(verifyWorkspaceEvidence(r,e,now).persistedEvidenceConsistent,true);
  for (const change of [v=>v.canonicalFinalLinks=[],v=>v.canonicalFinalLinks[0].sourceJobId='other',v=>v.jobs[1].status='processing',v=>v.executionSteps[2].status='not_started']) {
    const changed=structuredClone(r); change(changed); assert.equal(verifyWorkspaceEvidence(changed,e,now).persistedEvidenceConsistent,false);
  }
});
