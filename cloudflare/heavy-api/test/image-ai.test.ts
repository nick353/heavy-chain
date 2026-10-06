import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { IMAGE_MODEL, decodeImage, parseImageInput, imageEstimate } from '../src/image-ai-contracts.ts';
import { imageSetup, pngFixture, TEST_HEAVY_DOCUMENT_DIGEST, TEST_HEAVY_DOCUMENT_VERSION, TEST_HEAVY_RIGHTS_VERSION } from './image-ai-fixture.ts';
import { PROTECTED_IMAGE_EDIT_MODE,protectedImageDigest,protectedImageSaveRequestId } from '../../../src/lib/protectedImageEditContract.ts';
type Json=Record<string,any>;
const url='/v1/provider-actions/';
const json=async(response: Response) => { const result=await response.json() as Json; assert.equal(response.status,200,JSON.stringify(result)); return result; };
const jpegHeaderFixture=(index=0) => new Uint8Array([255,216,255,192,0,8,8,0,8,0,8+index,3,255,217]);
const fiveOrderedReferences=() => [
  ...[0,1,2,3].map(index => ({ bytes:jpegHeaderFixture(index), contentType:'image/jpeg', width:8+index, height:8 })),
  { bytes:pngFixture(8,8,[180,30,20]), contentType:'image/png', width:8, height:8 },
];
const referenceDataUrl=(reference: { bytes:Uint8Array; contentType:string }) =>
  `data:${reference.contentType};base64,${Buffer.from(reference.bytes).toString('base64')}`;

test('ordinary workspace sources resolve server checksum for new and legacy uploads without trusting client metadata', async t => {
  const s=imageSetup(); t.after(()=>s.db.sql.close()); s.setAutoProvisionEntitlement(false);
  const sourceData='data:image/png;base64,'+Buffer.from(s.output).toString('base64');
  const saved=await json(await s.call('/v1/workspace-artifacts','alice',{
    requestId:crypto.randomUUID(),brandId:'brand',featureType:'design-gacha',title:'reference',imageUrl:sourceData,
    metadata:{contentSha256:'f'.repeat(64)},
  }));
  const imageId=saved.remote.imageId;
  const metadata=JSON.parse(String(s.db.sql.prepare('SELECT metadata FROM generated_images WHERE id=?').get(imageId)!.metadata));
  assert.notEqual(metadata.contentSha256,'f'.repeat(64));
  assert.equal(metadata.contentSha256,s.bucket.rows.get(saved.remote.storagePath)!.customMetadata.sha256);
  // Simulate the actual old ordinary-upload row, whose checksum lived only in R2.
  s.db.sql.prepare('UPDATE generated_images SET metadata=? WHERE id=?').run('{}',imageId);
  const input={...s.input(),count:1,imageUrls:[sourceData],sourceReadback:{sourceImageId:imageId}};
  const id=crypto.randomUUID();
  const result=await json(await s.call(url+'generate-image','alice',input,id));
  assert.equal(result.state,'completed'); assert.equal(s.calls.length,1);
  await json(await s.call('/v1/image-ai/requests/'+id,'alice'));
  assert.equal(s.calls.length,1);
  const foreign={...input,sourceReadback:{sourceImageId:imageId}};
  assert.equal((await s.call(url+'generate-image','bob',foreign,crypto.randomUUID())).status,409);
  assert.equal(s.calls.length,1);
  s.bucket.rows.get(saved.remote.storagePath)!.customMetadata.sha256='invalid';
  assert.equal((await s.call(url+'generate-image','alice',input,crypto.randomUUID())).status,409);
  assert.equal(s.calls.length,1);
});

async function protectedFixture(s: ReturnType<typeof imageSetup>,count=1) {
  const data='data:image/png;base64,'+Buffer.from(s.output).toString('base64');
  const plan={ mode:PROTECTED_IMAGE_EDIT_MODE,sourceWidth:256,sourceHeight:256,sourceSha256:await protectedImageDigest(data),
    maskSha256:await protectedImageDigest('synthetic-mask-contract'),guideIndex:1,coveragePercent:20 };
  const id=crypto.randomUUID();
  const input={...s.input(),featureType:'canvas-inpaint',imageUrls:[data,data],count,protectedEdit:plan};
  const finalInput=async(index=0)=>({ requestId:await protectedImageSaveRequestId(id,index),brandId:'brand',featureType:'canvas-inpaint',
    title:'範囲編集結果',imageUrl:data,prompt:input.prompt,sourceStoragePath:null,sourceJobId:`ai-${id}`,
    imageAI:{requestId:id,candidateIndex:index},metadata:{ arbitraryClientClaim:'not_authority',providerRequestId:'not-the-source' } });
  return {id,input,plan,finalInput};
}

test('workspace execution readback distinguishes AI/intermediate/final saves without reconciliation or writes', async t => {
  const s=imageSetup(); t.after(()=>s.db.sql.close()); const f=await protectedFixture(s);
  const raw=await json(await s.call(url+'edit-image','alice',f.input,f.id));
  const readSteps = async (jobId: string, user='alice') => {
    const before = s.db.sql.prepare('SELECT total_changes() n').get()!.n;
    const calls = s.calls.length, puts = s.bucket.puts;
    const response = await s.call('/v1/workspace-execution-steps?brand_id=brand&job_id='+encodeURIComponent(jobId),user);
    assert.equal(response.status,200,await response.clone().text());
    assert.equal(s.db.sql.prepare('SELECT total_changes() n').get()!.n,before);
    assert.equal(s.calls.length,calls); assert.equal(s.bucket.puts,puts);
    return await response.json() as Json[];
  };
  assert.deepEqual((await readSteps(raw.jobId)).map(step=>step.status),['completed','completed','not_started']);
  assert.deepEqual(await readSteps(raw.jobId,'bob'),[]);
  const input=await f.finalInput(); await json(await s.call('/v1/workspace-artifacts','alice',input));
  const finalId=`wa-${input.requestId}`;
  const completed=await readSteps(raw.jobId);
  assert.deepEqual(completed.map(step=>step.status),['completed','completed','completed']);
  assert.equal(completed[2].image_id,finalId);
  const finalSteps=await readSteps(finalId);
  assert.equal(finalSteps.length,3); assert(finalSteps.every(step=>step.job_id===finalId));
  assert.deepEqual(finalSteps.map(step=>step.id),completed.map(step=>step.id));
  // A row that merely claims a request/candidate cannot adopt its execution.
  s.db.sql.prepare(`INSERT INTO generation_jobs(id,brand_id,user_id,feature_type,input_params,status,created_at)
    VALUES ('spoof','brand','alice','canvas-inpaint',?,'completed','2026-09-06')`).run(JSON.stringify({sourceJobId:raw.jobId,imageAI:{requestId:f.id,candidateIndex:0}}));
  assert.deepEqual(await readSteps('spoof'),[]);
  const changes=s.db.sql.prepare('SELECT total_changes() n').get()!.n;
  assert.equal((await s.call('/v1/workspace-execution-steps?brand_id=brand&job_id='+raw.jobId,'other')).status,403);
  for (const query of ['brand_id=brand','brand_id=brand&job_id=bad%2Fid', 'brand_id=brand&'+Array(101).fill('job_id=x').join('&')]) {
    assert.equal((await s.call('/v1/workspace-execution-steps?'+query)).status,400);
  }
  assert.equal(s.db.sql.prepare('SELECT total_changes() n').get()!.n,changes);
});

test('workspace execution reports queued, failed and uncertain stored states without marking every input step complete', async t => {
  const s=imageSetup(); t.after(()=>s.db.sql.close()); const id=crypto.randomUUID();
  const raw=await json(await s.call(url+'generate-image','alice',s.input(),id));
  for (const [state,attempted,expected] of [
    ['planned',null,['queued','not_started']], ['running','2026-09-01',['processing','not_started']],
    ['unknown','2026-09-01',['unknown','not_started']], ['failed',null,['not_started','not_started']],
    ['failed','2026-09-01',['failed','not_started']],
  ] as const) {
    s.db.sql.prepare('UPDATE heavy_ai_candidates SET state=?,attempted_at=?,sha256=NULL,content_bytes=NULL WHERE request_id=?').run(state,attempted,id);
    const before=s.db.sql.prepare('SELECT total_changes() n').get()!.n;
    const response=await s.call('/v1/workspace-execution-steps?brand_id=brand&job_id='+raw.jobId);
    assert.equal(response.status,200);
    assert.deepEqual((await response.json() as Json[]).map(step=>step.status),expected);
    assert.equal(s.db.sql.prepare('SELECT total_changes() n').get()!.n,before);
  }
  assert.equal(s.calls.length,1);
});

test('protected four-candidate batch keeps intermediates out of Gallery and completes Jobs only after every final private save',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); const f=await protectedFixture(s,4);
  const raw=await json(await s.call(url+'edit-image','alice',f.input,f.id));
  assert.equal(raw.requiresProtectedComposite,true); assert.deepEqual(raw.protectedEdit,f.plan); assert.equal(s.calls.length,4);
  assert.match(String(s.calls[0].form.get('prompt')),/Image 1 is ONLY a spatial edit guide/);
  assert.equal((await json(await s.call('/v1/generated-images?brand_id=brand'))).length,0);
  for(let index=0;index<4;index++) {
    assert.equal(s.db.sql.prepare('SELECT status FROM generation_jobs WHERE id=?').get(raw.jobId)!.status,'processing');
    const input=await f.finalInput(index); const saved=await json(await s.call('/v1/workspace-artifacts','alice',input));
    assert.equal(saved.remote.imageId,`wa-${input.requestId}`); assert.equal(saved.metadata.providerRequestId,f.id);
    assert.deepEqual(saved.metadata.protectedEdit,f.plan); assert.equal(saved.metadata.candidateIndex,index);
    const again=await json(await s.call(`/v1/workspace-artifacts/${input.requestId}`)); assert.deepEqual(again,saved);
  }
  assert.equal(s.db.sql.prepare('SELECT status FROM generation_jobs WHERE id=?').get(raw.jobId)!.status,'completed');
  const gallery=await json(await s.call('/v1/generated-images?brand_id=brand')); assert.equal(gallery.length,4);
  assert(gallery.every((row:Json)=>row.metadata.artifactRole==='protected-edit-final' && row.parent_image_id.startsWith(`ai-${f.id}-`)));
  const first=await f.finalInput(); assert.equal((await s.call(`/v1/workspace-artifacts/${first.requestId}`,'bob')).status,404);
  const savedAgain=await json(await s.call('/v1/workspace-artifacts','alice',first)); assert.equal(savedAgain.success,true);
  assert.equal((await s.call('/v1/workspace-artifacts','alice',{...first,title:'different'})).status,409);
  assert.equal(s.bucket.puts,8); assert.equal(s.calls.length,4);
  assert.equal((await json(await s.call('/v1/image-ai/usage?brand_id=brand'))).remainingUnits,21);
});

test('lost final R2 response recovers through GET; viewer cannot repair and another owner cannot adopt the save',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); const f=await protectedFixture(s);
  await json(await s.call(url+'edit-image','alice',f.input,f.id)); const input=await f.finalInput();
  s.bucket.fail='after'; assert.equal((await s.call('/v1/workspace-artifacts','alice',input)).status,502);
  assert.equal(s.db.sql.prepare('SELECT status FROM generation_jobs WHERE id=?').get(`wa-${input.requestId}`)!.status,'pending');
  s.db.sql.exec("UPDATE brands SET owner_id='bob' WHERE id='brand'; INSERT INTO brand_members(id,brand_id,user_id,role,joined_at) VALUES('alice-view','brand','alice','viewer','2026-09-06')");
  assert.equal((await s.call(`/v1/workspace-artifacts/${input.requestId}`,'bob')).status,404);
  assert.equal((await s.call(`/v1/workspace-artifacts/${input.requestId}`)).status,403);
  assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM generated_images WHERE id=?').get(`wa-${input.requestId}`)!.n,0);
  s.db.sql.exec("UPDATE brands SET owner_id='alice' WHERE id='brand'");
  const recovered=await json(await s.call(`/v1/workspace-artifacts/${input.requestId}`)); assert.equal(recovered.success,true);
  assert.equal(s.calls.length,1); assert.equal(s.bucket.puts,2);
  assert.equal(s.db.sql.prepare('SELECT status FROM generation_jobs WHERE id=?').get(`ai-${f.id}`)!.status,'completed');
});

test('final-save source, candidate, frame and immutable object identity are checked before adoption',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); const f=await protectedFixture(s);
  await json(await s.call(url+'edit-image','alice',f.input,f.id)); const input=await f.finalInput();
  for(const changed of [ {...input,requestId:crypto.randomUUID()}, {...input,imageAI:{requestId:f.id,candidateIndex:2}},
    {...input,sourceJobId:'other-job'}, {...input,imageUrl:'data:image/png;base64,'+Buffer.from(pngFixture(128,128)).toString('base64')} ]) {
    assert.equal((await s.call('/v1/workspace-artifacts','alice',changed)).status,409);
  }
  const path=`generated-images/wa-${input.requestId}`;
  s.bucket.rows.set(path,{ bytes:s.output,size:s.output.length,httpMetadata:{contentType:'image/png'},customMetadata:{sha256:'foreign',userId:'bob'} });
  const before=s.bucket.rows.get(path); assert.equal((await s.call('/v1/workspace-artifacts','alice',input)).status,409);
  assert.equal(s.bucket.rows.get(path),before); assert.equal(s.calls.length,1); assert.equal(s.bucket.puts,1);
  assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM generated_images WHERE id=?').get(`wa-${input.requestId}`)!.n,0);
});

test('session revocation after final R2 write prevents SQL commit; reauthentication reads the same exact save',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); const f=await protectedFixture(s);
  await json(await s.call(url+'edit-image','alice',f.input,f.id)); const input=await f.finalInput();
  const put=s.bucket.put.bind(s.bucket); s.bucket.put=async(...args)=>{const value=await put(...args);if(args[0].startsWith('generated-images/wa-'))s.revoked.add('alice');return value;};
  assert.equal((await s.call('/v1/workspace-artifacts','alice',input)).status,401);
  assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM generated_images WHERE id=?').get(`wa-${input.requestId}`)!.n,0);
  assert.equal((await s.call(`/v1/workspace-artifacts/${input.requestId}`)).status,401);
  s.revoked.delete('alice'); assert.equal((await s.call(`/v1/workspace-artifacts/${input.requestId}`)).status,200);
  assert.equal(s.calls.length,1); assert.equal(s.bucket.puts,2);
});

test('protected-edit guide role and bounds are explicit; malformed plans do not reach inference',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); const f=await protectedFixture(s);
  for(const protectedEdit of [{...f.plan,guideIndex:0},{...f.plan,sourceWidth:5000},{...f.plan,maskSha256:'unknown'},{...f.plan,coveragePercent:0}]) {
    assert.equal((await s.call(url+'edit-image','alice',{...f.input,protectedEdit},crypto.randomUUID())).status,422);
  }
  assert.equal((await s.call(url+'generate-image','alice',f.input,crypto.randomUUID())).status,422);
  assert.equal(s.calls.length,0); assert.equal(s.bucket.puts,0);
});

test('real SQLite/R2 contract: generation result, quota, private content, Gallery/Jobs and replay agree',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); const id=crypto.randomUUID();
  const result=await json(await s.call(url+'generate-image','alice',{...s.input(),count:2},id));
  assert.equal(result.success,true); assert.equal(result.persistedCandidateCount,2); assert.equal(result.providerModel,IMAGE_MODEL);
  assert.equal(s.calls.length,2); assert.equal(s.bucket.puts,2);
  assert.equal(s.calls[0].form.get('width'),'256'); assert.equal(s.calls[0].model,IMAGE_MODEL);
  assert.equal(s.db.sql.prepare('SELECT status FROM generation_jobs').get()!.status,'completed');
  const listing=await json(await s.call('/v1/generated-images?brand_id=brand')); assert.equal(listing.length,2);
  assert.equal((await json(await s.call('/v1/generation-jobs?brand_id=brand'))).length,1);
  const signed=new URL(result.imageUrl); const image=await s.call(signed.pathname+signed.search,'');
  assert.equal(image.status,200); assert.deepEqual(new Uint8Array(await image.arrayBuffer()),s.output);
  assert.equal((await s.call('/v1/generated-images/'+result.imageId+'/content','bob')).status,404);
  assert.equal((await s.call('/v1/image-ai/requests/'+id,'bob')).status,404);
  const again=await json(await s.call(url+'generate-image','alice',{...s.input(),count:2},id));
  assert.equal(again.imageId,result.imageId); assert.equal(s.calls.length,2); assert.equal(s.bucket.puts,2);
  assert.equal((await s.call(url+'generate-image','alice',{...s.input(),prompt:'changed'},id)).status,409);
  const usage=await json(await s.call('/v1/image-ai/usage?brand_id=brand','viewer'));
  assert.equal(usage.remainingUnits,23); assert.equal(usage.completedImages,2); assert.equal(usage.runningImages,0); assert.equal(usage.estimatedMicroUSD,574);
  assert.equal(usage.providerBilling,null); assert.equal(usage.accountFreeAllocationRemaining,null);
});

test('provider omission defaults to OpenAI, and a missing key fails before admission or provider calls',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); delete s.env.AI_IMAGE_PROVIDER;
  const providerImage=pngFixture(1024,1024,[40,120,80]); const originalFetch=globalThis.fetch; let providerCalls=0;
  globalThis.fetch=async(input: RequestInfo|URL, init?: RequestInit) => {
    providerCalls++; assert.equal(String(input),'https://api.openai.com/v1/images/generations');
    assert.equal(init?.headers && new Headers(init.headers).get('authorization'),'Bearer server-only-test-key');
    return Response.json({data:[{b64_json:Buffer.from(providerImage).toString('base64'),mime_type:'image/png'}]},
      {headers:{'x-request-id':'req-openai-default-fixture'}});
  };
  try {
    const missing=await s.call(url+'generate-image','alice',s.input(),crypto.randomUUID());
    assert.equal(missing.status,503); assert.deepEqual(await missing.json(),{success:false,error:'openai_image_api_key_missing'});
    assert.equal(providerCalls,0); assert.equal(s.calls.length,0);
    assert.equal(s.db.sql.prepare('SELECT COUNT(*) AS n FROM heavy_ai_requests').get()!.n,0);
    s.env.OPENAI_API_KEY='server-only-test-key';
    const result=await json(await s.call(url+'generate-image','alice',{...s.input(),generationModel:'gpt-image-1-mini'},crypto.randomUUID()));
    assert.equal(result.provider,'openai'); assert.equal(result.backendProvider,'openai-images-api');
    assert.equal(result.images[0].providerTaskId,'req-openai-default-fixture'); assert.equal(providerCalls,1); assert.equal(s.calls.length,0);
  } finally { globalThis.fetch=originalFetch; }
});

test('explicit Workers AI remains available, while a mismatched provider is rejected',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close());
  const worker=await json(await s.call(url+'generate-image','alice',{...s.input(),generationProvider:'workers_ai'},crypto.randomUUID()));
  assert.equal(worker.provider,'workers_ai'); assert.equal(worker.backendProvider,'cloudflare-workers-ai'); assert.equal(s.calls.length,1);
  delete s.env.AI_IMAGE_PROVIDER;
  const mismatch=await s.call(url+'generate-image','alice',{...s.input(),generationProvider:'workers_ai'},crypto.randomUUID());
  assert.equal(mismatch.status,422); assert.deepEqual(await mismatch.json(),{success:false,error:'image_provider_not_enabled'}); assert.equal(s.calls.length,1);
});

test('OpenAI provider uses the same authenticated admission, R2 persistence, receipt and Gallery provenance',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close());
  s.env.AI_IMAGE_PROVIDER='openai'; s.env.OPENAI_API_KEY='server-only-test-key'; s.env.OPENAI_IMAGE_MODEL='gpt-image-1-mini';
  const providerImage=pngFixture(1024,1024,[40,120,80]);
  const originalFetch=globalThis.fetch;
  let providerURL='';
  globalThis.fetch=async(input: RequestInfo|URL, init?: RequestInit) => {
    providerURL=String(input);
    assert.equal(init?.headers && new Headers(init.headers).get('authorization'),'Bearer server-only-test-key');
    return Response.json({data:[{b64_json:Buffer.from(providerImage).toString('base64'),mime_type:'image/png'}]}, {headers:{'x-request-id':'req-openai-runtime-fixture'}});
  };
  try {
    const id=crypto.randomUUID();
    const result=await json(await s.call(url+'generate-image','alice',{...s.input(),generationProvider:'openai',generationModel:'gpt-image-1-mini'},id));
    assert.equal(result.success,true); assert.equal(result.provider,'openai'); assert.equal(result.backendProvider,'openai-images-api');
    assert.equal(result.providerModel,'gpt-image-1-mini'); assert.equal(result.images[0].providerTaskId,'req-openai-runtime-fixture');
    assert.equal(providerURL,'https://api.openai.com/v1/images/generations');
    assert.equal(s.calls.length,0); assert.equal(s.bucket.puts,1);
    const stored=JSON.parse(s.db.sql.prepare('SELECT metadata FROM generated_images').get()!.metadata as string);
    assert.equal(stored.provider,'openai'); assert.equal(stored.backendProvider,'openai-images-api'); assert.equal(stored.providerTaskId,'req-openai-runtime-fixture');
    assert.equal((await json(await s.call('/v1/generated-images?brand_id=brand')))[0].metadata.provider,'openai');
  } finally { globalThis.fetch=originalFetch; }
});

test('configured OpenAI accepts five ordered references and forwards exact multipart files',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close());
  s.env.AI_IMAGE_PROVIDER='openai'; s.env.OPENAI_API_KEY='server-only-test-key'; s.env.OPENAI_IMAGE_EDIT_MODEL='gpt-image-1-mini';
  const references=fiveOrderedReferences(); const originalFetch=globalThis.fetch; let providerCalls=0;
  globalThis.fetch=async(_input: RequestInfo|URL, init?: RequestInit) => {
    providerCalls++;
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer server-only-test-key');
    const form=init?.body as FormData;
    const files=form.getAll('image[]'); assert.equal(files.length,5);
    for(const [index,value] of files.entries()) {
      assert(value instanceof File);
      const jpeg=index<4; assert.equal(value.name,`reference-${index+1}.${jpeg?'jpg':'png'}`);
      assert.equal(value.type,jpeg?'image/jpeg':'image/png');
      assert.deepEqual(new Uint8Array(await value.arrayBuffer()),references[index].bytes);
    }
    return Response.json({data:[{b64_json:Buffer.from(pngFixture(1024,1024,[40,120,80])).toString('base64'),mime_type:'image/png'}]},
      {headers:{'x-request-id':'req-openai-five-reference-fixture'}});
  };
  try {
    const result=await json(await s.call(url+'edit-image','alice',{
      ...s.input(), imageUrls:references.map(referenceDataUrl), generationProvider:'openai', generationModel:'gpt-image-1-mini',
    },crypto.randomUUID()));
    assert.equal(result.success,true); assert.equal(result.provider,'openai'); assert.equal(providerCalls,1);
    assert.equal(s.calls.length,0); assert.equal(s.db.sql.prepare('SELECT count(*) n FROM heavy_ai_requests').get()!.n,1);
  } finally { globalThis.fetch=originalFetch; }
});

test('configured OpenAI rejects seventeen references before preparation, admission, or provider fetch',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close());
  s.env.AI_IMAGE_PROVIDER='openai'; s.env.OPENAI_API_KEY='server-only-test-key'; s.env.OPENAI_IMAGE_EDIT_MODEL='gpt-image-1-mini';
  const reference=referenceDataUrl(fiveOrderedReferences()[0]); let providerCalls=0; const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{ providerCalls++; throw new Error('provider_fetch_must_not_run'); };
  try {
    const response=await s.call(url+'edit-image','alice',{
      ...s.input(), imageUrls:Array(17).fill(reference), generationProvider:'openai', generationModel:'gpt-image-1-mini',
    },crypto.randomUUID());
    assert.equal(response.status,422); assert.deepEqual(await response.json(),{success:false,error:'image_reference_count_not_supported'});
    assert.equal(providerCalls,0); assert.equal(s.db.sql.prepare('SELECT count(*) n FROM heavy_ai_requests').get()!.n,0);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM heavy_generation_preparations').get()!.n,0);
  } finally { globalThis.fetch=originalFetch; }
});

test('Workers AI stays capped at four and caller provider spoofing cannot bypass its configured provider',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); s.env.AI_IMAGE_PROVIDER='workers_ai';
  const reference=referenceDataUrl(fiveOrderedReferences()[0]);
  const tooMany=await s.call(url+'edit-image','alice',{...s.input(),imageUrls:Array(5).fill(reference)},crypto.randomUUID());
  assert.equal(tooMany.status,422); assert.deepEqual(await tooMany.json(),{success:false,error:'image_reference_count_not_supported'});
  const spoof=await s.call(url+'edit-image','alice',{
    ...s.input(),imageUrls:[reference],generationProvider:'openai',generationModel:'gpt-image-1-mini',
  },crypto.randomUUID());
  assert.equal(spoof.status,422); assert.deepEqual(await spoof.json(),{success:false,error:'image_provider_not_enabled'});
  const unknown=await s.call(url+'generate-image','alice',{...s.input(),generationProvider:'mock'},crypto.randomUUID());
  assert.equal(unknown.status,422); assert.deepEqual(await unknown.json(),{success:false,error:'image_provider_not_supported'});
  assert.equal(s.calls.length,0); assert.equal(s.db.sql.prepare('SELECT count(*) n FROM heavy_ai_requests').get()!.n,0);
});

test('five-reference preparation, attestation digest binding, and final admission use the same trusted OpenAI context',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); s.setAutoProvisionEntitlement(false);
  s.env.AI_IMAGE_PROVIDER='openai'; s.env.OPENAI_API_KEY='server-only-test-key'; s.env.OPENAI_IMAGE_EDIT_MODEL='gpt-image-1-mini';
  const references=fiveOrderedReferences(); const requestId=crypto.randomUUID();
  const input={...s.input(),imageUrls:references.map(referenceDataUrl),generationProvider:'openai',generationModel:'gpt-image-1-mini',seed:172903};
  const prepared=await json(await s.call('/v1/heavy/entitlement/prepare','alice',{
    brandId:'brand',action:'edit-image',requestId,input,
  }));
  const attested=await json(await s.call('/v1/heavy/entitlement/attestation','alice',{
    brandId:'brand',action:'edit-image',requestId,preparationId:prepared.preparationId,inputDigest:prepared.inputDigest,
    termsAccepted:true,rightsAttested:true,rightsVersion:TEST_HEAVY_RIGHTS_VERSION,
    termsDocumentVersion:TEST_HEAVY_DOCUMENT_VERSION,termsDocumentDigest:TEST_HEAVY_DOCUMENT_DIGEST,
    rightsDocumentVersion:TEST_HEAVY_DOCUMENT_VERSION,rightsDocumentDigest:TEST_HEAVY_DOCUMENT_DIGEST,input,
  }));
  assert.equal(attested.success,true); assert.equal(attested.inputDigest,prepared.inputDigest);

  const mismatch=await s.call(url+'edit-image','alice',{
    ...input,preparationId:prepared.preparationId,inputDigest:'f'.repeat(64),
  },requestId);
  assert.equal(mismatch.status,409); assert.deepEqual(await mismatch.json(),{success:false,error:'heavy_input_digest_mismatch'});
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM heavy_ai_requests').get()!.n,0);

  const originalFetch=globalThis.fetch; let providerCalls=0;
  globalThis.fetch=async(_input:RequestInfo|URL,init?:RequestInit)=>{
    providerCalls++; assert.equal((init?.body as FormData).getAll('image[]').length,5);
    return Response.json({data:[{b64_json:Buffer.from(pngFixture(1024,1024,[40,120,80])).toString('base64'),mime_type:'image/png'}]},
      {headers:{'x-request-id':'req-openai-prepared-five-reference-fixture'}});
  };
  try {
    const admitted=await json(await s.call(url+'edit-image','alice',{
      ...input,preparationId:prepared.preparationId,inputDigest:prepared.inputDigest,
    },requestId));
    assert.equal(admitted.success,true); assert.equal(providerCalls,1);
    assert.equal(s.db.sql.prepare('SELECT count(*) n FROM heavy_ai_requests').get()!.n,1);
  } finally { globalThis.fetch=originalFetch; }
});

test('completed Heavy receipts remain readable after the short-lived preparation expires',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close());
  s.env.AI_IMAGE_PROVIDER='openai'; s.env.OPENAI_API_KEY='server-only-test-key'; s.env.OPENAI_IMAGE_MODEL='gpt-image-1-mini';
  const providerImage=pngFixture(1024,1024,[40,120,80]); const originalFetch=globalThis.fetch;
  globalThis.fetch=async() => Response.json({data:[{b64_json:Buffer.from(providerImage).toString('base64'),mime_type:'image/png'}]}, {headers:{'x-request-id':'req-openai-expiry-fixture'}});
  try {
    const id=crypto.randomUUID();
    const result=await json(await s.call(url+'generate-image','alice',{...s.input(),generationProvider:'openai',generationModel:'gpt-image-1-mini'},id));
    assert.equal(result.success,true);
    const originalNow=Date.now;
    Date.now=()=>originalNow()+10*60*1000;
    try {
      const receipt=await s.call(`/v1/image-ai/requests/${id}`,'alice');
      assert.equal(receipt.status,200,await receipt.clone().text());
      const body=await receipt.json() as Json;
      assert.equal(body.success,true); assert.equal(body.persistenceStatus,'completed'); assert.equal(body.requestId,id);
    } finally { Date.now=originalNow; }
  } finally { globalThis.fetch=originalFetch; }
});

const fittingFramingInstruction='Frame the entire person from the top of the head through both feet, with visible margin above the head and below the feet. Keep both feet and all limbs inside the image; do not crop at the torso, thighs, knees or ankles. Use wider camera framing as needed, including when a supplied person reference is cropped.';
const fittingGarmentInstruction='Dress the person in EXACTLY the garment in image 0. Preserve its color, print, fabric, pockets, fastenings, proportions and logos; do not substitute a similar item.';
const fittingGarmentAdditionProhibition='Do not add garment features, decorations or logos absent from image 0.';
const fittingPersonInstruction='Image 1 is the person reference: preserve their face, hairstyle, pose direction and identity while applying the selected fit and adult age context.';

test('OpenAI model-matrix accepts a prompt-only brief and uses the generation endpoint',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close());
  s.env.AI_IMAGE_PROVIDER='openai'; s.env.OPENAI_API_KEY='server-only-test-key'; s.env.OPENAI_IMAGE_MODEL='gpt-image-2';
  const providerImage=pngFixture(1024,1024,[40,120,80]); const originalFetch=globalThis.fetch; let providerURL='';
  globalThis.fetch=async(input: RequestInfo|URL, init?: RequestInit) => {
    providerURL=String(input);
    assert.equal(init?.headers && new Headers(init.headers).get('authorization'),'Bearer server-only-test-key');
    const body=JSON.parse(String(init?.body));
    assert.equal(body.model,'gpt-image-2');
    assert(body.prompt.includes(fittingFramingInstruction));
    assert.doesNotMatch(body.prompt,/image 0|Image 1/);
    assert.match(body.prompt,/Garment\/request: blue cotton shirt/);
    return Response.json({data:[{b64_json:Buffer.from(providerImage).toString('base64'),mime_type:'image/png'}]}, {headers:{'x-request-id':'req-openai-fitting-fixture'}});
  };
  try {
    const result=await json(await s.call(url+'model-matrix','alice',{...s.input(),generationProvider:'openai',generationModel:'gpt-image-2',productDescription:'blue cotton shirt',bodyTypes:['regular'],ageGroups:['20s']},crypto.randomUUID()));
    assert.equal(result.success,true); assert.equal(result.provider,'openai'); assert.equal(result.backendProvider,'openai-images-api');
    assert.equal(result.providerModel,'gpt-image-2'); assert.equal(result.matrix.length,1); assert.equal(providerURL,'https://api.openai.com/v1/images/generations');
  } finally { globalThis.fetch=originalFetch; }
});

test('image editing passes each ordered reference as binary multipart, preserves lineage and never exposes URLs/secrets',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); const first=pngFixture(128,64); const second=pngFixture(64,128,[180,30,20]);
  const references=[first,second].map(bytes=>'data:image/png;base64,'+Buffer.from(bytes).toString('base64'));
  const result=await json(await s.call(url+'edit-image','alice',{...s.input(),imageUrls:references,
    materialReferences:[{role:'garment',sourceStoragePath:'generated-images/original',imageUrl:'https://private.invalid/?token=secret'}],
    compositionPreview:{parityRuntime:JSON.stringify({fixtureId:'data:image/png;base64,privatepixels',token:'private-bearer',sourceImageId:'source'})},
    sourceReadback:{sourceWorkspace:'canvas',authorization:'do-not-store'}},crypto.randomUUID()));
  assert.equal(result.success,true); assert.equal(result.inputImageCount,2);
  for(const [i,bytes] of [first,second].entries()) assert.deepEqual(new Uint8Array(await (s.calls[0].form.get('input_image_'+i) as File).arrayBuffer()),bytes);
  assert.match(String(s.calls[0].form.get('prompt')),/Edit image 0/);
  const stored=s.db.sql.prepare('SELECT input_metadata FROM heavy_ai_requests').get()!.input_metadata as string;
  assert.doesNotMatch(stored,/private.invalid|do-not-store|data:image|Bearer/); assert.match(stored,/generated-images\/original/);
});

test('fitting yields all selected adult/body combinations and durable reconstructible metadata',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close());
  const ref='data:image/png;base64,'+Buffer.from(s.output).toString('base64');
  const result=await json(await s.call(url+'model-matrix','alice',{...s.input(),productDescription:'blue cotton shirt',imageUrl:ref,modelReferenceImageUrl:ref,
    bodyTypes:['regular'],ageGroups:['20s','30s','40s'],gender:'male',skinTone:'medium',hairStyle:'short',
    modelReferenceSourceImageId:'person-source',modelReferenceSourceStoragePath:'generated-images/person-source'},crypto.randomUUID()));
  assert.equal(result.success,true); assert.deepEqual(result.matrix.map((v:Json)=>v.ageGroup),['20s','30s','40s']);
  assert.equal(result.matrix[0].bodyTypeName,'レギュラー');
  assert.match(String(s.calls[0].form.get('prompt')),/EXACTLY the garment in image 0/); assert.match(String(s.calls[0].form.get('prompt')),/Image 1 is the person reference/);
  assert.equal(s.calls.length,3);
  for(const [index,call] of s.calls.entries()) {
    const prompt=String(call.form.get('prompt')).replace(/\r\n/g,'\n');
    assert(prompt.startsWith(`Professional full-body apparel try-on photograph. male adult in their ${result.matrix[index].ageGroup}, average body type.\n${fittingFramingInstruction}\n`));
    assert(prompt.includes(fittingGarmentInstruction+'\n'+fittingGarmentAdditionProhibition+'\n'+fittingPersonInstruction));
    assert.match(prompt,/Selected skin tone: medium\.\nSelected hair length: short\./);
    assert.match(prompt,/The garment is worn naturally, not a flat product mockup\. Neutral studio background, professional lighting\.\nGarment\/request: blue cotton shirt/);
  }
  for(const row of s.db.sql.prepare('SELECT metadata FROM generated_images').all()) {
    const metadata=JSON.parse(row.metadata as string); assert.equal(metadata.feature,'model-matrix'); assert.equal(metadata.backendProvider,'cloudflare-workers-ai');
    assert.equal(metadata.bodyTypes[0],'regular'); assert.equal(metadata.persistenceStatus,'completed');
    assert.equal(metadata.modelReferenceSourceStoragePath,'generated-images/person-source'); assert.equal(metadata.modelReferenceImageUrl,'[provided]');
  }
});

test('fitting with only a garment reference retains garment identity and full-body framing without a person-reference instruction',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close());
  const ref='data:image/png;base64,'+Buffer.from(s.output).toString('base64');
  const result=await json(await s.call(url+'model-matrix','alice',{...s.input(),productDescription:'blue cotton shirt',imageUrl:ref,
    bodyTypes:['regular'],ageGroups:['20s']},crypto.randomUUID()));
  assert.equal(result.success,true); assert.equal(result.inputImageCount,1); assert.equal(s.calls.length,1);
  const prompt=String(s.calls[0].form.get('prompt')).replace(/\r\n/g,'\n');
  assert(prompt.includes(fittingFramingInstruction));
  assert(prompt.includes(fittingGarmentInstruction+'\n'+fittingGarmentAdditionProhibition));
  assert.doesNotMatch(prompt,/Image 1|preserve their face, hairstyle, pose direction and identity/);
  assert.match(prompt,/Garment\/request: blue cotton shirt/);
});

test('rights, current role, unsupported masks/models and oversized/extra references stop before inference',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close());
  assert.equal((await s.call(url+'generate-image','',s.input(),crypto.randomUUID())).status,401);
  assert.equal((await s.call(url+'generate-image','viewer',s.input(),crypto.randomUUID())).status,403);
  assert.equal((await s.call(url+'generate-image','other',s.input(),crypto.randomUUID())).status,403);
  for(const change of [{maskApplied:true},{outputBackground:'transparent'},
    {generationModel:'gpt-image-1'},{generationProvider:'mock'},{prompt:'copy the Nike logo'}]) {
    const response=await s.call(url+'generate-image','alice',{...s.input(),...change},crypto.randomUUID()); assert([403,422].includes(response.status));
  }
  const ref='data:image/png;base64,'+Buffer.from(s.output).toString('base64');
  assert.equal((await s.call(url+'edit-image','alice',{...s.input(),imageUrls:Array(5).fill(ref)},crypto.randomUUID())).status,422);
  assert.equal((await s.call(url+'edit-image','alice',{...s.input(),imageUrls:['https://127.0.0.1/secret']},crypto.randomUUID())).status,400);
  assert.throws(()=>decodeImage('data:image/png;base64,'+Buffer.from(pngFixture(520,256)).toString('base64')),/512px/);
  assert.throws(()=>decodeImage(Buffer.from(s.output.subarray(0,33)).toString('base64'),false),/invalid_image_bytes/);
  assert.equal(s.calls.length,0); assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM heavy_ai_requests').get()!.n,0);
});

test('authenticated Heavy generation does not require a rights declaration or entitlement row', async t => {
  const s=imageSetup(); t.after(() => s.db.sql.close());
  const input = { ...s.input() } as Record<string, unknown>;
  delete input.legalSafety;
  s.setAutoProvisionEntitlement(false);
  s.env.HEAVY_IMAGE_ENTITLEMENT_ENABLED = 'false';
  const response = await s.call(url + 'generate-image', 'alice', input, crypto.randomUUID());
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json() as Json;
  assert.equal(result.success, true);
  assert.equal(result.persistenceStatus, 'completed');
  assert.equal(s.calls.length, 1);
  assert.equal(s.bucket.puts, 1);
  const stored = s.db.sql.prepare('SELECT terms_acceptance_id,rights_attestation_id,request_binding FROM heavy_ai_requests LIMIT 1').get() as Record<string, unknown>;
  assert.equal(stored.terms_acceptance_id, null);
  assert.equal(stored.rights_attestation_id, null);
  assert.equal(stored.request_binding, null);
});

test('concurrent identical submissions share one atomic admission and one inference',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); let release!:()=>void; let entered!:()=>void;
  const arrived=new Promise<void>(resolve=>{entered=resolve;}); const wait=new Promise<void>(resolve=>{release=resolve;});
  s.setHook(async()=>{entered(); await wait; return {image:Buffer.from(s.output).toString('base64')};});
  const id=crypto.randomUUID(); const first=s.call(url+'generate-image','alice',s.input(),id); await arrived;
  const duplicate=await json(await s.call(url+'generate-image','alice',s.input(),id)); assert.equal(duplicate.state,'running');
  assert.equal(s.calls.length,1); release(); assert.equal((await json(await first)).success,true);
  assert.equal(s.db.sql.prepare('SELECT admitted_units FROM heavy_ai_daily').get()!.admitted_units,1);
});

test('monthly units are atomically reserved per brand; concurrency and UTC daily controls are independent',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); s.env.AI_MONTHLY_IMAGE_UNITS='2';
  let release!:()=>void; let entered!:()=>void;
  const arrived=new Promise<void>(resolve=>{entered=resolve;}); const wait=new Promise<void>(resolve=>{release=resolve;});
  s.setHook(async()=>{entered(); await wait; return {image:Buffer.from(s.output).toString('base64')};});
  const first=s.call(url+'generate-image','alice',{...s.input(),count:2},crypto.randomUUID()); await arrived;
  assert.equal((await s.call(url+'generate-image','bob',s.input(),crypto.randomUUID())).status,429);
  release(); assert.equal((await json(await first)).success,true);
  assert.equal((await json(await s.call('/v1/image-ai/usage?brand_id=brand'))).remainingUnits,0);
  s.env.AI_MONTHLY_IMAGE_UNITS='25'; s.env.AI_DAILY_IMAGE_UNITS='2';
  assert.equal((await s.call(url+'generate-image','bob',s.input(),crypto.randomUUID())).status,429);
  assert.equal(s.calls.length,2);
});

test('account-wide monthly admission cap is shared across brands',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); s.env.AI_MONTHLY_IMAGE_UNITS='25'; s.env.AI_ACCOUNT_MONTHLY_IMAGE_UNITS='2';
  s.db.sql.exec("INSERT INTO brands(id,owner_id,name,created_at,updated_at) VALUES('brand-two','alice','Brand Two','2026-09-06','2026-09-06'); INSERT INTO brand_members(id,brand_id,user_id,role,joined_at) VALUES('brand-two-bob','brand-two','bob','editor','2026-09-06')");
  const first=await json(await s.call(url+'generate-image','alice',{...s.input(),count:2},crypto.randomUUID())); assert.equal(first.success,true);
  const second=await s.call(url+'generate-image','bob',{...s.input(),brandId:'brand-two'},crypto.randomUUID()); assert.equal(second.status,429);
  const usage=await json(await s.call('/v1/image-ai/usage?brand_id=brand-two','bob')); assert.equal(usage.accountMonthlyQuota,2); assert.equal(usage.accountRemainingUnits,0);
  assert.equal(s.calls.length,2);
});

test('provider exception remains unknown; later candidates are not submitted and same-ID recovery never reinfers',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); s.setHook(async()=>{throw new Error('binding response lost');});
  const id=crypto.randomUUID(); const input={...s.input(),count:3};
  const result=await json(await s.call(url+'generate-image','alice',input,id));
  assert.equal(result.success,false); assert.equal(result.state,'unknown'); assert.equal(result.usage.estimatedMicroUSD,null); assert.equal(result.usage.unknownEstimateCount,1);
  assert.equal(s.calls.length,1); assert.equal(s.bucket.puts,0);
  await json(await s.call(url+'generate-image','alice',input,id)); await json(await s.call('/v1/image-ai/requests/'+id)); assert.equal(s.calls.length,1);
  const usage=await json(await s.call('/v1/image-ai/usage?brand_id=brand')); assert.equal(usage.remainingUnits,24); assert.equal(usage.uncertainImages,1);
  assert.equal(s.db.sql.prepare('SELECT admitted_units FROM heavy_ai_daily').get()!.admitted_units,3);
  assert.equal(s.db.sql.prepare('SELECT admitted_centi_neurons FROM heavy_ai_daily').get()!.admitted_centi_neurons,7815);
});

test('daily admission also reserves estimated image-size/ref cost, and deletion cannot replenish that guard',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); s.env.AI_DAILY_ESTIMATED_NEURONS='53';
  assert.equal((await json(await s.call(url+'generate-image','alice',{...s.input(),count:2},crypto.randomUUID()))).success,true);
  assert.equal((await s.call(url+'generate-image','bob',s.input(),crypto.randomUUID())).status,429);
  const day=s.db.sql.prepare('SELECT * FROM heavy_ai_daily').get()!; assert.equal(day.admitted_centi_neurons,5210);
  s.db.sql.exec('DELETE FROM heavy_ai_requests');
  assert.equal((await s.call(url+'generate-image','bob',s.input(),crypto.randomUUID())).status,429);
  assert.equal(s.db.sql.prepare('SELECT admitted_centi_neurons FROM heavy_ai_daily').get()!.admitted_centi_neurons,5210);
  assert.equal(s.calls.length,2);
});

test('lost admission, R2 and final D1 responses reconcile immutable targets without paying twice',async t=>{
  for(const mode of ['admission','r2','d1']) {
    const s=imageSetup(); t.after(()=>s.db.sql.close()); const id=crypto.randomUUID();
    if(mode==='admission') s.db.fail={batch:'INSERT OR IGNORE INTO heavy_ai_requests',when:'after'};
    if(mode==='r2') s.bucket.fail='after';
    if(mode==='d1') s.db.fail={batch:'INSERT OR IGNORE INTO generated_images',when:'after'};
    const first=await s.call(url+'generate-image','alice',s.input(),id); assert([200,503].includes(first.status));
    const result=await json(await s.call('/v1/image-ai/requests/'+id)); assert.equal(result.success,true,mode);
    assert.equal(s.calls.length,1); assert.equal(s.bucket.puts,1); assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM generated_images').get()!.n,1);
  }
});

test('missing or foreign R2 content is not overwritten or fabricated by recovery',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); s.bucket.fail='before'; const id=crypto.randomUUID();
  const failed=await json(await s.call(url+'generate-image','alice',s.input(),id)); assert.equal(failed.state,'unknown');
  assert.equal(s.calls.length,1); assert.equal((await json(await s.call('/v1/image-ai/requests/'+id))).success,false);
  const foreignId=crypto.randomUUID(); const path=`generated-images/ai-${foreignId}-0`;
  s.bucket.rows.set(path,{bytes:s.output,size:s.output.length,customMetadata:{sha256:'foreign'},httpMetadata:{contentType:'image/png'}});
  assert.equal((await s.call(url+'generate-image','alice',s.input(),foreignId)).status,409); assert.equal(s.calls.length,1);
  assert.equal(s.bucket.rows.get(path)!.customMetadata.sha256,'foreign');
});

test('logout during inference prevents private persistence and late delivery',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close());
  s.setHook(async()=>{s.revoked.add('alice'); return {image:Buffer.from(s.output).toString('base64')};});
  const id=crypto.randomUUID(); assert.equal((await s.call(url+'generate-image','alice',s.input(),id)).status,401);
  assert.equal(s.bucket.puts,0); assert.equal((await s.call('/v1/image-ai/requests/'+id)).status,401);
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM generated_images').get()!.n,0);
});

test('a same-owner row inserted into a different job during inference is never adopted as this result',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); const id=crypto.randomUUID(); const imageId=`ai-${id}-0`;
  s.setHook(async()=>{
    s.db.sql.prepare("INSERT INTO generation_jobs(id,brand_id,user_id,feature_type,created_at) VALUES('other-job','brand','alice','other',?)").run(new Date().toISOString());
    s.db.sql.prepare("INSERT INTO generated_images(id,job_id,brand_id,user_id,storage_path,created_at) VALUES(?,'other-job','brand','alice',?,?)")
      .run(imageId,'generated-images/'+imageId,new Date().toISOString());
    return {image:Buffer.from(s.output).toString('base64')};
  });
  const result=await json(await s.call(url+'generate-image','alice',s.input(),id));
  assert.equal(result.success,false); assert.equal(result.state,'unknown'); assert.equal(result.images.length,0);
  assert.equal((await json(await s.call('/v1/image-ai/requests/'+id))).success,false); assert.equal(s.calls.length,1);
  assert.equal(s.db.sql.prepare('SELECT job_id FROM generated_images WHERE id=?').get(imageId)!.job_id,'other-job');
});

test('invalid model pixels do not become a successful result or a zero-cost invoice',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close()); s.setHook(async()=>({image:Buffer.from(pngFixture(512,256)).toString('base64')}));
  const result=await json(await s.call(url+'generate-image','alice',s.input(),crypto.randomUUID()));
  assert.equal(result.success,false); assert.equal(result.state,'failed'); assert.equal(result.error,'image_provider_invalid_output');
  assert.equal(result.usage.unknownEstimateCount,1); assert.equal(result.usage.estimatedMicroUSD,null); assert.equal(s.bucket.puts,0);
  const parsed=parseImageInput('generate-image',s.input()); assert.deepEqual(imageEstimate(parsed),{microUSD:287,neurons:26.05});
});

const openAIObservationSetup = (t: TestContext, timeout = '180000') => {
  const s = imageSetup(); const originalFetch = globalThis.fetch;
  s.setAutoProvisionEntitlement(false);
  s.env.AI_IMAGE_PROVIDER = 'openai'; s.env.OPENAI_IMAGE_API_KEY = 'local-observation-key';
  s.env.OPENAI_IMAGE_MODEL = 'gpt-image-1-mini'; s.env.AI_IMAGE_TIMEOUT_MS = timeout;
  t.after(() => { globalThis.fetch = originalFetch; s.db.sql.close(); });
  return s;
};
const openAIObservationResponse = () => Response.json({data:[{b64_json:Buffer.from(pngFixture(1024,1024)).toString('base64')}]},
  {headers:{'x-request-id':'req-local-observation'}});

test('OpenAI observes a connected edit beyond 90s and persists once with GET and same-ID recovery', async t => {
  const s = openAIObservationSetup(t);
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-01T00:00:00Z')});
  let entered!: () => void; const arrived = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0; let endpoint = '';
  globalThis.fetch = async (input) => {
    calls++; endpoint = String(input); entered();
    return new Promise(resolve => setTimeout(() => resolve(openAIObservationResponse()),120000));
  };
  const id = crypto.randomUUID(); const input = {...s.input(),imageUrls:[referenceDataUrl(fiveOrderedReferences()[0])]};
  const pending = s.call(url+'edit-image','alice',input,id); await arrived;
  t.mock.timers.tick(90001);
  assert.equal((await json(await s.call('/v1/image-ai/requests/'+id))).state,'running');
  assert.equal((await json(await s.call(url+'edit-image','alice',input,id))).state,'running');
  assert.equal(calls,1); assert.equal(s.bucket.puts,0);
  t.mock.timers.tick(29999);
  const result = await json(await pending); assert.equal(result.success,true); assert.equal(result.persistenceStatus,'completed');
  assert.equal(endpoint,'https://api.openai.com/v1/images/edits'); assert.equal(calls,1); assert.equal(s.bucket.puts,1);
  assert.equal(s.db.sql.prepare('SELECT latency_ms FROM heavy_ai_candidates WHERE request_id=?').get(id)!.latency_ms,120000);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM generated_images').get()!.n,1);
  await json(await s.call('/v1/image-ai/requests/'+id)); await json(await s.call(url+'edit-image','alice',input,id));
  assert.equal(calls,1); assert.equal(s.bucket.puts,1);
});

test('OpenAI serial candidates retain their own observation window and the same-owner admission fence past 210s', async t => {
  const s = openAIObservationSetup(t);
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-01T00:00:00Z')});
  const release: Array<() => void> = []; const entered: Array<() => void> = [];
  const arrivals = [0,1].map(index => new Promise<void>(resolve => { entered[index] = resolve; }));
  let calls = 0;
  globalThis.fetch = async () => { const index = calls++; return new Promise(resolve => {
    release[index] = () => resolve(openAIObservationResponse()); entered[index]();
  }); };
  const id = crypto.randomUUID(); const input = {...s.input(),count:2};
  const pending = s.call(url+'generate-image','alice',input,id); await arrivals[0];
  t.mock.timers.tick(120000); release[0](); await arrivals[1];
  t.mock.timers.tick(90001);
  const receipt = await json(await s.call('/v1/image-ai/requests/'+id));
  assert.equal(receipt.state,'running'); assert.equal(receipt.persistedCandidateCount,1);
  assert.equal((await s.call(url+'generate-image','alice',s.input(),crypto.randomUUID())).status,429);
  assert.equal((await json(await s.call(url+'generate-image','alice',input,id))).state,'running');
  assert.equal(calls,2);
  t.mock.timers.tick(89998); release[1]();
  const result = await json(await pending); assert.equal(result.success,true); assert.equal(result.persistedCandidateCount,2);
  assert.equal(calls,2); assert.equal(s.bucket.puts,2);
});

test('OpenAI 180s timeout is sanitized, stops the batch and never adopts a late provider result or rewrites terminal unknown', async t => {
  const s = openAIObservationSetup(t);
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-01T00:00:00Z')});
  let release!: () => void; let entered!: () => void;
  const arrived = new Promise<void>(resolve => { entered = resolve; }); let calls = 0;
  globalThis.fetch = async () => { calls++; return new Promise(resolve => { release = () => resolve(openAIObservationResponse()); entered(); }); };
  const id = crypto.randomUUID(); const input = {...s.input(),count:3};
  const pending = s.call(url+'generate-image','alice',input,id); await arrived;
  t.mock.timers.tick(179999); assert.equal((await json(await s.call('/v1/image-ai/requests/'+id))).state,'running');
  t.mock.timers.tick(1); const result = await json(await pending);
  assert.equal(result.state,'unknown'); assert.equal(result.error,'image_provider_timeout');
  assert.equal(result.usage.attemptedImages,1); assert.equal(result.usage.unknownEstimateCount,1);
  const snapshot = () => ({
    request:s.db.sql.prepare('SELECT * FROM heavy_ai_requests WHERE request_id=?').get(id),
    candidates:s.db.sql.prepare('SELECT * FROM heavy_ai_candidates WHERE request_id=? ORDER BY candidate_index').all(id),
    job:s.db.sql.prepare('SELECT * FROM generation_jobs WHERE id=?').get('ai-'+id),
  });
  const before = snapshot(); release(); t.mock.timers.tick(500000);
  await json(await s.call('/v1/image-ai/requests/'+id)); await json(await s.call(url+'generate-image','alice',input,id));
  assert.deepEqual(snapshot(),before); assert.equal(calls,1); assert.equal(s.bucket.puts,0);
});

test('stale GET expires an abandoned OpenAI observation without letting a late connected result overwrite unknown or reach R2', async t => {
  const s = openAIObservationSetup(t); const now = Date.parse('2026-10-01T00:00:00Z');
  t.mock.timers.enable({apis:['Date','setTimeout'],now});
  let release!: () => void; let entered!: () => void; let calls = 0;
  const arrived = new Promise<void>(resolve => { entered = resolve; });
  globalThis.fetch = async () => { calls++; return new Promise(resolve => { release = () => resolve(openAIObservationResponse()); entered(); }); };
  const id = crypto.randomUUID(); const input = {...s.input(),count:2};
  const pending = s.call(url+'generate-image','alice',input,id); await arrived;
  // Advance only the wall clock to model a suspended/delayed timer callback.
  t.mock.timers.setTime(now+210001);
  const stale = await json(await s.call('/v1/image-ai/requests/'+id));
  assert.equal(stale.state,'unknown'); assert.equal(stale.error,'image_outcome_unknown');
  const snapshot = () => ({request:s.db.sql.prepare('SELECT * FROM heavy_ai_requests WHERE request_id=?').get(id),
    candidates:s.db.sql.prepare('SELECT * FROM heavy_ai_candidates WHERE request_id=? ORDER BY candidate_index').all(id)});
  const before = snapshot(); t.mock.timers.setTime(now+220000); release();
  const late = await json(await pending); assert.equal(late.state,'unknown'); assert.equal(late.error,'image_outcome_unknown');
  assert.deepEqual(snapshot(),before); assert.equal(calls,1); assert.equal(s.bucket.puts,0);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM generated_images').get()!.n,0);
});

test('provider-specific timeout bounds preserve Workers AI defaults and 90s support', async t => {
  const cases: Array<[string,string | undefined,number]> = [
    ['workers_ai',undefined,45000], ['workers_ai','90000',90000], ['workers_ai','180000',90000], ['workers_ai','180001',45000], ['openai','180001',45000],
  ];
  for (const [provider,configured,timeout] of cases) await t.test(`${provider}:${configured ?? 'default'}`, async t => {
    const s = openAIObservationSetup(t,configured); s.env.AI_IMAGE_PROVIDER = provider; s.env.AI_IMAGE_TIMEOUT_MS = configured;
    t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-01T00:00:00Z')});
    let entered!: () => void; const arrived = new Promise<void>(resolve => { entered = resolve; }); let calls = 0;
    const pendingProvider = async () => { calls++; entered(); return new Promise<never>(() => {}); };
    globalThis.fetch = pendingProvider; s.setHook(pendingProvider);
    const id = crypto.randomUUID(); const pending = s.call(url+'generate-image','alice',s.input(),id); await arrived;
    t.mock.timers.tick(timeout-1); assert.equal((await json(await s.call('/v1/image-ai/requests/'+id))).state,'running');
    t.mock.timers.tick(1); const result = await json(await pending);
    assert.equal(result.state,'unknown'); assert.equal(result.error,provider === 'openai' ? 'image_provider_timeout' : 'image_outcome_unknown');
    assert.equal(calls,1); assert.equal(s.bucket.puts,0);
  });
});

test('OpenAI error receipts keep unusable output uncertain, fail explicit rejections and preserve safe diagnostics without reinference', async t => {
  const secret = 'local-observation-key private-prompt';
  const headers = {'x-request-id':'req-local-error'};
  const cases: Array<[() => Promise<Response>,string,string,Json]> = [
    [async () => { throw new Error(secret); },'unknown','image_provider_transport_uncertain',{category:'transport_uncertainty'}],
    [async () => Response.json({error:{type:'invalid_request_error',message:secret,code:secret}},{status:503,headers}),
      'unknown','image_provider_transport_uncertain',{category:'transport_uncertainty',status:503,providerRequestId:'req-local-error'}],
    [async () => Response.json({error:{type:'invalid_request_error',message:secret,code:'content_policy_violation'}},{status:400,headers}),
      'failed','image_provider_request_rejected',{category:'request_rejected',status:400,providerCode:'content_policy_violation',providerRequestId:'req-local-error'}],
    [async () => Response.json({data:[]},{headers}),'unknown','image_provider_invalid_output',{category:'unusable_response',status:200,providerRequestId:'req-local-error'}],
    [async () => Response.json({data:[{b64_json:Buffer.from(pngFixture(8,8)).toString('base64')}]},{headers}),
      'unknown','image_provider_invalid_output',{category:'unusable_response',status:200,providerRequestId:'req-local-error'}],
  ];
  for (const [respond,state,error,diagnostics] of cases) await t.test(error+':'+state, async t => {
    const s = openAIObservationSetup(t); let calls = 0;
    globalThis.fetch = async () => { calls++; return respond(); };
    const id = crypto.randomUUID(); const input = {...s.input(),count:2};
    const result = await json(await s.call(url+'generate-image','alice',input,id));
    assert.equal(result.success,false); assert.equal(result.state,state); assert.equal(result.error,error);
    assert.equal(result.usage.attemptedImages,1); assert(!JSON.stringify(result).includes(secret));
    await json(await s.call('/v1/image-ai/requests/'+id)); await json(await s.call(url+'generate-image','alice',input,id));
    assert.equal(calls,1); assert.equal(s.bucket.puts,0); assert.equal(s.db.sql.prepare('SELECT count(*) n FROM generated_images').get()!.n,0);
    const stored = s.db.sql.prepare('SELECT error_code,descriptor FROM heavy_ai_candidates WHERE request_id=? ORDER BY candidate_index').all(id);
    assert(!JSON.stringify(stored).includes(secret));
    assert.deepEqual(JSON.parse(stored[0].descriptor as string).providerError,diagnostics);
  });
});

async function nativeFixture(s: ReturnType<typeof imageSetup>) {
  const f=await protectedFixture(s);const data='data:image/png;base64,'+Buffer.from(pngFixture(128,256)).toString('base64');
  const native={version:'native-print-contain-v1',original:{width:128,height:256,digest:await protectedImageDigest(data),digestScheme:'sha256-data-url-utf8-v1'},
    stage:{width:256,height:256,primaryDigest:f.plan.sourceSha256,maskDigest:f.plan.maskSha256},frame:{x:64,y:0,width:128,height:256},
    printingSnapshotDigest:await protectedImageDigest(JSON.stringify([f.plan.sourceSha256,f.plan.maskSha256,'a'.repeat(64)])),candidateGeometry:{version:'stage-frame-v1',width:256,height:256}};
  const input={...f.input,featureType:'lightchain-printing-image',width:256,height:256,nativePrintFinalFrame:native};
  const final=async()=>({...await f.finalInput(),featureType:input.featureType,imageUrl:data,metadata:{nativePrintFinalFrame:native}});
  return {...f,input,native,final};
}
test('native printing normalization, initial stored truth, final dimensions, immutable fingerprint and readback lineage agree',async t=>{
 const s=imageSetup();t.after(()=>s.db.sql.close());const f=await nativeFixture(s);
 const normalized=parseImageInput('edit-image',f.input);assert.deepEqual(normalized.metadata.nativePrintFinalFrame,f.native);
 const raw=await json(await s.call(url+'edit-image','alice',f.input,f.id));assert.deepEqual(raw.metadata.nativePrintFinalFrame,f.native);
 const stored=JSON.parse(String(s.db.sql.prepare('SELECT input_metadata FROM heavy_ai_requests WHERE request_id=?').get(f.id)!.input_metadata));assert.deepEqual(stored.metadata.nativePrintFinalFrame,f.native);
 const input=await f.final();const saved=await json(await s.call('/v1/workspace-artifacts','alice',input));assert.deepEqual(saved.metadata.nativePrintFinalFrame,f.native);
 assert.equal(saved.metadata.providerJobId,`ai-${f.id}`);assert.equal(saved.metadata.providerImageId,`ai-${f.id}-0`);assert.equal(saved.remote.imageId,`wa-${input.requestId}`);
 const job=s.db.sql.prepare('SELECT input_params FROM generation_jobs WHERE id=?').get(saved.remote.jobId)!;const params=JSON.parse(String(job.input_params));assert.deepEqual(params.metadata.nativePrintFinalFrame,f.native);assert.equal(params.sourceJobId,`ai-${f.id}`);
 assert.deepEqual(await json(await s.call(`/v1/workspace-artifacts/${input.requestId}`)),saved);
 assert.deepEqual(await json(await s.call('/v1/workspace-artifacts','alice',input)),saved);assert.equal(s.calls.length,1);assert.equal(s.bucket.puts,2);
 assert.equal((await s.call('/v1/workspace-artifacts','alice',{...input,imageUrl:'data:image/png;base64,'+Buffer.from(pngFixture(128,256,[200,10,30])).toString('base64')})).status,409);
 const changed={...f.input,nativePrintFinalFrame:{...f.native,original:{...f.native.original,digest:'c'.repeat(64)}}};assert.equal((await s.call(url+'edit-image','alice',changed,f.id)).status,409);assert.equal(s.calls.length,1);
});
test('native printing caller-only, conflicting binding, wrong dimensions/source/UUID/candidate/feature/owner/brand are rejected',async t=>{
 const s=imageSetup();t.after(()=>s.db.sql.close());const f=await nativeFixture(s);await json(await s.call(url+'edit-image','alice',f.input,f.id));const input=await f.final();
 for(const changed of [{...input,requestId:crypto.randomUUID()}, {...input,imageAI:{requestId:f.id,candidateIndex:1}}, {...input,sourceJobId:'other'}, {...input,featureType:'canvas-inpaint'},
 {...input,imageUrl:'data:image/png;base64,'+Buffer.from(s.output).toString('base64')}, {...input,metadata:{nativePrintFinalFrame:{...f.native,original:{...f.native.original,digest:'f'.repeat(64)}}}}])assert.equal((await s.call('/v1/workspace-artifacts','alice',changed)).status,409);
 assert.equal((await s.call('/v1/workspace-artifacts','bob',input)).status,409);assert.equal((await s.call('/v1/workspace-artifacts','alice',{...input,brandId:'foreign'})).status,403);
 s.db.sql.prepare('UPDATE heavy_ai_candidates SET width=512 WHERE request_id=?').run(f.id);assert.equal((await s.call('/v1/workspace-artifacts','alice',input)).status,409);s.db.sql.prepare('UPDATE heavy_ai_candidates SET width=256 WHERE request_id=?').run(f.id);
 const legacy=await protectedFixture(s);await json(await s.call(url+'edit-image','alice',legacy.input,legacy.id));const legacyInput=await legacy.finalInput();
 assert.equal((await s.call('/v1/workspace-artifacts','alice',{...legacyInput,metadata:{nativePrintFinalFrame:f.native}})).status,409);
 assert.equal((await s.call('/v1/workspace-artifacts','alice',{...input,imageAI:undefined})).status,409);
 const saved=await json(await s.call('/v1/workspace-artifacts','alice',legacyInput));assert.equal(saved.metadata.nativePrintFinalFrame,undefined);assert.equal(s.calls.length,2);
});
test('native printing version, digest scheme, contain frame, stage hashes and candidate geometry fail before inference',async t=>{
 const s=imageSetup();t.after(()=>s.db.sql.close());const f=await nativeFixture(s);
 for(const native of [{...f.native,version:'future'}, {...f.native,original:{...f.native.original,digestScheme:'sha256-png-binary'}}, {...f.native,original:{...f.native.original,digest:'invalid'}},
 {...f.native,frame:{...f.native.frame,x:63.999}}, {...f.native,stage:{...f.native.stage,primaryDigest:'c'.repeat(64)}}, {...f.native,stage:{...f.native.stage,maskDigest:'c'.repeat(64)}},
 {...f.native,candidateGeometry:{...f.native.candidateGeometry,width:512}}, {...f.native,candidateGeometry:{mode:'stage-frame-v1',width:256,height:256}}, {...f.native,printingSnapshotDigest:'invalid'}])
 assert.equal((await s.call(url+'edit-image','alice',{...f.input,nativePrintFinalFrame:native},crypto.randomUUID())).status,422);
 assert.equal((await s.call(url+'edit-image','alice',{...f.input,width:264},crypto.randomUUID())).status,422);
 assert.equal((await s.call(url+'edit-image','alice',{...f.input,featureType:'canvas-inpaint'},crypto.randomUUID())).status,422);
 assert.equal(s.calls.length,0);assert.equal(s.bucket.puts,0);
});

async function openAIProtectedFixture(s:ReturnType<typeof imageSetup>){
 const f=await nativeFixture(s);const projected='data:image/png;base64,'+Buffer.from(pngFixture(1024,1024)).toString('base64');const primary=f.input.imageUrls[0];
 const map={version:'protected-openai-contain-v1',digestScheme:'sha256-data-url-utf8-v1',stage:{width:256,height:256,primaryDigest:f.plan.sourceSha256,guideDigest:await protectedImageDigest(primary),maskDigest:f.plan.maskSha256},prepared:{width:256,height:256,primaryDigest:await protectedImageDigest(primary),guideDigest:await protectedImageDigest(primary),transform:{x:0,y:0,scaleX:1,scaleY:1}},candidate:{width:1024,height:1024},contain:{x:0,y:0,scale:4},projected:{primaryDigest:await protectedImageDigest(projected),guideDigest:await protectedImageDigest(projected)}};
 const native={...f.native,version:'native-print-openai-contain-v1',mapping:map,candidateGeometry:{version:'openai-output-frame-v1',width:1024,height:1024}};
 const body={...f.input,generationProvider:'openai',width:1024,height:1024,nativePrintFinalFrame:native,protectedOpenAIProjection:{...map,primaryDataUrl:projected,guideDataUrl:projected},referenceTransforms:[0,1].map(index=>({index,sourceWidth:256,sourceHeight:256,width:256,height:256,resized:false,renderingTransform:{x:0,y:0,scaleX:1,scaleY:1}}))};
 return {...f,body,native,map,projected};
}
test('protected OpenAI every supported edit model uses pre-inference stored authority, exact projected multipart bytes and native stored save authority',async t=>{
 const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
 for(const model of ['gpt-image-1.5','gpt-image-1','gpt-image-1-mini','chatgpt-image-latest']){
  const s=imageSetup();t.after(()=>s.db.sql.close());s.env.AI_IMAGE_PROVIDER='openai';s.env.OPENAI_API_KEY='test-only';s.env.OPENAI_IMAGE_EDIT_MODEL=model;
  const f=await openAIProtectedFixture(s);let calls=0;
  globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'https://api.openai.com/v1/images/edits');const form=init!.body as FormData;assert.equal(form.get('model'),model);assert.equal(form.get('size'),'1024x1024');assert.equal(form.has('mask'),false);
   const rows=s.db.sql.prepare('SELECT model,input_metadata FROM heavy_ai_requests WHERE request_id=?').get(f.id)!;assert.equal(rows.model,model);assert.deepEqual(JSON.parse(String(rows.input_metadata)).resolvedProvider,{provider:'openai',backendProvider:'openai-images-api',model,action:'edit-image',requestId:f.id});
   const refs=form.getAll('image[]') as File[];assert.equal(refs.length,2);for(const ref of refs)assert.deepEqual(new Uint8Array(await ref.arrayBuffer()),new Uint8Array(Buffer.from(f.projected.split(',')[1],'base64')));
   return Response.json({data:[{b64_json:Buffer.from(pngFixture(1024,1024)).toString('base64')}]},{headers:{'x-request-id':'req-protected-fixture'}});};
  const raw=await json(await s.call(url+'edit-image','alice',f.body,f.id));assert.equal(raw.success,true,JSON.stringify(raw));assert.equal(calls,1);assert.equal(raw.resolvedProvider.model,model);assert.equal(raw.images[0].width,1024);assert.deepEqual(raw.metadata.protectedOpenAIProjection,f.map);
  const stored=JSON.parse(String(s.db.sql.prepare('SELECT input_metadata FROM heavy_ai_requests WHERE request_id=?').get(f.id)!.input_metadata));assert(!JSON.stringify(stored.metadata).includes('data:image'));assert.equal(stored.normalizedInput.references[0].contentDigest,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Buffer.from(f.projected.split(',')[1],'base64'))),n=>n.toString(16).padStart(2,'0')).join(''));assert.notEqual(stored.normalizedInput.references[0].contentDigest,f.map.projected.primaryDigest);
  const input={...await f.final(),metadata:{nativePrintFinalFrame:f.native,protectedOpenAIProjection:f.map,provider:'workers_ai',providerModel:'client-lie'}};
  assert.equal((await s.call('/v1/workspace-artifacts','alice',{...input,metadata:{...input.metadata,protectedOpenAIProjection:{...f.map,contain:{...f.map.contain,x:1}}}})).status,409);
  const saved=await json(await s.call('/v1/workspace-artifacts','alice',input));assert.equal(saved.metadata.provider,'openai');assert.equal(saved.metadata.providerModel,model);assert.equal(saved.metadata.backendProvider,'openai-images-api');assert.deepEqual(saved.metadata.nativePrintFinalFrame,f.native);
  assert.deepEqual(await json(await s.call(`/v1/workspace-artifacts/${input.requestId}`)),saved);
  assert.equal((await s.call('/v1/media/read?'+new URLSearchParams({path:saved.remote.storagePath,expiresIn:'3600'}))).status,400);
  const media=await json(await s.call('/v1/media/read?'+new URLSearchParams({bucket:'generated-images',path:saved.remote.storagePath,expiresIn:'3600'})));assert(media.url.startsWith('https://'));
  assert.equal(calls,1);assert.equal(s.calls.length,0);
  s.db.sql.prepare('UPDATE heavy_ai_requests SET model=? WHERE request_id=?').run('contradictory-model',f.id);assert.equal((await s.call(`/v1/workspace-artifacts/${input.requestId}`)).status,410);
 }
});
test('protected OpenAI projection exactbytes/dimensions/recorded transforms and initial digest are checked before admission',async t=>{
 const s=imageSetup();t.after(()=>s.db.sql.close());s.env.AI_IMAGE_PROVIDER='openai';s.env.OPENAI_API_KEY='test-only';let calls=0;const prior=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error('no provider');};t.after(()=>{globalThis.fetch=prior;});const f=await openAIProtectedFixture(s);
 for(const body of [
  {...f.body,protectedOpenAIProjection:{...f.body.protectedOpenAIProjection,primaryDataUrl:'data:image/png;base64,'+Buffer.from(pngFixture(1024,1024,[1,2,3])).toString('base64')}},
  {...f.body,imageUrls:[...f.body.imageUrls].reverse().map((v,i)=>i===0?'data:image/png;base64,'+Buffer.from(pngFixture()).toString('base64').replace(/.$/,'A'):v)},
  {...f.body,referenceTransforms:f.body.referenceTransforms.map(v=>({...v,renderingTransform:{...v.renderingTransform,scaleX:2}}))},
  {...f.body,protectedOpenAIProjection:{...f.body.protectedOpenAIProjection,primaryDataUrl:'data:image/png;base64,'+Buffer.from(pngFixture(512,512)).toString('base64')}},
  {...f.body,inputDigest:'0'.repeat(64)},
 ])assert([400,409,422].includes((await s.call(url+'edit-image','alice',body,crypto.randomUUID())).status));
 assert.equal(calls,0);assert.equal(s.bucket.puts,0);assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM heavy_ai_requests').get()!.n,0);
});

test('server-default OpenAI rejects unprojected Canvas partial/inpaint count-four requests before admission or any provider call',async t=>{
 const s=imageSetup();t.after(()=>s.db.sql.close());delete s.env.AI_IMAGE_PROVIDER;s.env.OPENAI_API_KEY='test-only';const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('provider forbidden');};t.after(()=>{globalThis.fetch=old;});const f=await protectedFixture(s,4);
 for(const featureType of ['canvas-partial-edit','canvas-inpaint']){const response=await s.call(url+'edit-image','alice',{...f.input,featureType},crypto.randomUUID());assert.equal(response.status,422);assert.deepEqual(await response.json(),{success:false,error:'protected_openai_projection_required'});}
 assert.equal(calls,0);assert.equal(s.calls.length,0);assert.equal(s.bucket.puts,0);assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM heavy_ai_requests').get()!.n,0);
});

async function canvasBatchFixture(s:ReturnType<typeof imageSetup>,feature='canvas-partial-edit'){
 const f=await openAIProtectedFixture(s);const binding={version:1,requestId:f.id,batchStateArtifactId:`canvas-protected-batch-${f.id}`,requestedCandidateCount:4,featureType:feature,canvasProjectId:'local-fixture',parentObjectId:'parent',generation:2,brandId:'brand',scopeId:'alice',generationInputSignature:'f'.repeat(64),source:{kind:'object',objectId:'parent',identityDigest:'a'.repeat(64)}};
 const native={...f.native,version:'canvas-protected-openai-contain-v1',original:{width:256,height:256,digest:f.plan.sourceSha256,digestScheme:'sha256-data-url-utf8-v1'},frame:{x:0,y:0,width:256,height:256},canvasBatch:binding};
 const body={...f.body,featureType:feature,count:4,generation:2,parentObjectId:'parent',canvasProjectId:'local-fixture',canvasProtectedBatchBinding:binding,nativePrintFinalFrame:native};return{...f,binding,native,body};
}
test('Canvas batch stored normalized authority permits four independent native saves/readbacks; caller context cannot create or replace authority',async t=>{
 const s=imageSetup();t.after(()=>s.db.sql.close());s.env.AI_IMAGE_PROVIDER='openai';s.env.OPENAI_API_KEY='test-only';const f=await canvasBatchFixture(s);const prior=globalThis.fetch;t.after(()=>{globalThis.fetch=prior;});let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({data:[{b64_json:Buffer.from(pngFixture(1024,1024)).toString('base64')}]});};
 const normalized=parseImageInput('edit-image',f.body,{provider:'openai',model:'gpt-image-1-mini'});assert.deepEqual(normalized.metadata.canvasProtectedBatchBinding,f.binding);const receipt=await json(await s.call(url+'edit-image','alice',f.body,f.id));assert.equal(receipt.images.length,4);assert.equal(calls,4);
 const inputs=[];for(let i=0;i<4;i++){const input={brandId:'brand',requestId:await protectedImageSaveRequestId(f.id,i),featureType:f.body.featureType,title:'Canvas result',imageUrl:'data:image/png;base64,'+Buffer.from(pngFixture(256,256,[20+i,30,40])).toString('base64'),sourceJobId:`ai-${f.id}`,sourceStoragePath:null,canvasProjectId:'local-fixture',imageAI:{requestId:f.id,candidateIndex:i},metadata:{nativePrintFinalFrame:f.native,protectedOpenAIProjection:f.map,canvasProtectedBatchBinding:f.binding,parentObjectId:'parent',generation:2}};inputs.push(input);const saved=await json(await s.call('/v1/workspace-artifacts','alice',input));assert.equal(saved.metadata.providerImageId,`ai-${f.id}-${i}`);assert.deepEqual(saved.metadata.nativePrintFinalFrame,f.native);assert.deepEqual(await json(await s.call('/v1/workspace-artifacts/'+input.requestId)),saved);assert.deepEqual(await json(await s.call('/v1/workspace-artifacts','alice',input)),saved);}
 for(const changed of [{...inputs[0],metadata:{...inputs[0].metadata,parentObjectId:'foreign'}},{...inputs[0],canvasProjectId:'foreign'},{...inputs[0],metadata:{...inputs[0].metadata,generation:3}},{...inputs[0],metadata:{...inputs[0].metadata,canvasProtectedBatchBinding:{...f.binding,scopeId:'bob'}}},{...inputs[0],imageAI:undefined},{...inputs[0],imageUrl:f.projected}])assert.equal((await s.call('/v1/workspace-artifacts','alice',changed)).status,409);
 assert.equal(calls,4);assert.equal(s.bucket.puts,8);
});
test('Canvas admission bound header/user/brand/feature/count rejects before provider and admission writes',async t=>{
 const s=imageSetup();t.after(()=>s.db.sql.close());s.env.AI_IMAGE_PROVIDER='openai';s.env.OPENAI_API_KEY='test-only';const f=await canvasBatchFixture(s);const prior=globalThis.fetch;t.after(()=>{globalThis.fetch=prior;});let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('forbidden');};
 for(const [body,id] of [[f.body,crypto.randomUUID()], [{...f.body,canvasProtectedBatchBinding:{...f.binding,scopeId:'bob'},nativePrintFinalFrame:{...f.native,canvasBatch:{...f.binding,scopeId:'bob'}}},f.id], [{...f.body,canvasProtectedBatchBinding:{...f.binding,brandId:'foreign'}},f.id], [{...f.body,featureType:'canvas-inpaint'},f.id], [{...f.body,featureType:'ordinary'},f.id], [{...f.body,count:3},f.id]] as const){assert.equal((await s.call(url+'edit-image','alice',body,id)).status,422);assert.equal(s.db.sql.prepare('SELECT count(*) n FROM heavy_ai_requests').get()!.n,0);assert.equal(s.db.sql.prepare('SELECT count(*) n FROM heavy_ai_candidates').get()!.n,0);}
 assert.equal(calls,0);assert.equal(s.bucket.puts,0);
});

test('Canvas retained-generated source discriminator keeps nullable parent but stable document/PNG authority; readback rejects stored context mutation',async t=>{
 const s=imageSetup();t.after(()=>s.db.sql.close());s.env.AI_IMAGE_PROVIDER='openai';s.env.OPENAI_API_KEY='test-only';const f=await canvasBatchFixture(s,'canvas-inpaint');const binding={...f.binding,parentObjectId:null,source:{kind:'retained-generated',sourceKey:'c'.repeat(64),sourceArtifactId:`canvas-protected-source-${f.id}`,pngDigest:f.plan.sourceSha256}};const native={...f.native,canvasBatch:binding};const body={...f.body,parentObjectId:null,canvasProtectedBatchBinding:binding,nativePrintFinalFrame:native};const prior=globalThis.fetch;t.after(()=>{globalThis.fetch=prior;});let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({data:[{b64_json:Buffer.from(pngFixture(1024,1024)).toString('base64')}]});};
 for(const bad of [{...binding,canvasProjectId:null},{...binding,source:{...binding.source,pngDigest:'d'.repeat(64)}},{...binding,source:{...binding.source,sourceArtifactId:'foreign'}},{...binding,parentObjectId:'other'}])assert.throws(()=>parseImageInput('edit-image',{...body,canvasProtectedBatchBinding:bad,nativePrintFinalFrame:{...native,canvasBatch:bad}},{provider:'openai',model:'gpt-image-1-mini'}));
 const receipt=await json(await s.call(url+'edit-image','alice',body,f.id));assert.equal(receipt.images.length,4);const input={brandId:'brand',requestId:await protectedImageSaveRequestId(f.id,0),featureType:'canvas-inpaint',canvasProjectId:'local-fixture',title:'Canvas generated-source result',imageUrl:'data:image/png;base64,'+Buffer.from(pngFixture(256,256)).toString('base64'),sourceJobId:`ai-${f.id}`,sourceStoragePath:null,imageAI:{requestId:f.id,candidateIndex:0},metadata:{nativePrintFinalFrame:native,protectedOpenAIProjection:f.map,canvasProtectedBatchBinding:binding,parentObjectId:null,generation:2}};const saved=await json(await s.call('/v1/workspace-artifacts','alice',input));assert.deepEqual(saved.metadata.canvasProtectedBatchBinding,binding);const row=s.db.sql.prepare('SELECT input_params FROM generation_jobs WHERE id=?').get(saved.remote.jobId)!;const params=JSON.parse(String(row.input_params));s.db.sql.prepare('UPDATE generation_jobs SET input_params=? WHERE id=?').run(JSON.stringify({...params,canvasProjectId:'foreign'}),saved.remote.jobId);assert.equal((await s.call('/v1/workspace-artifacts/'+input.requestId)).status,410);assert.equal(calls,4);
});
