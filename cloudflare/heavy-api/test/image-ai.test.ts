import assert from 'node:assert/strict';
import test from 'node:test';
import { IMAGE_MODEL, decodeImage, parseImageInput, imageEstimate } from '../src/image-ai-contracts.ts';
import { imageSetup, pngFixture } from './image-ai-fixture.ts';
import { PROTECTED_IMAGE_EDIT_MODE,protectedImageDigest,protectedImageSaveRequestId } from '../../../src/lib/protectedImageEditContract.ts';
type Json=Record<string,any>;
const url='/v1/provider-actions/';
const json=async(response: Response) => { const result=await response.json() as Json; assert.equal(response.status,200,JSON.stringify(result)); return result; };

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
  for(const row of s.db.sql.prepare('SELECT metadata FROM generated_images').all()) {
    const metadata=JSON.parse(row.metadata as string); assert.equal(metadata.feature,'model-matrix'); assert.equal(metadata.backendProvider,'cloudflare-workers-ai');
    assert.equal(metadata.bodyTypes[0],'regular'); assert.equal(metadata.persistenceStatus,'completed');
    assert.equal(metadata.modelReferenceSourceStoragePath,'generated-images/person-source'); assert.equal(metadata.modelReferenceImageUrl,'[provided]');
  }
});

test('rights, current role, unsupported masks/models and oversized/extra references stop before inference',async t=>{
  const s=imageSetup(); t.after(()=>s.db.sql.close());
  assert.equal((await s.call(url+'generate-image','',s.input(),crypto.randomUUID())).status,401);
  assert.equal((await s.call(url+'generate-image','viewer',s.input(),crypto.randomUUID())).status,403);
  assert.equal((await s.call(url+'generate-image','other',s.input(),crypto.randomUUID())).status,403);
  for(const change of [{legalSafety:{rightsConfirmed:false}},{maskApplied:true},{outputBackground:'transparent'},
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
