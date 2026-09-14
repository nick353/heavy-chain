import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, type V4WorkerOptions } from 'miniflare';
import { IMAGE_MODEL, decodeImage } from '../src/image-ai-contracts.ts';
import { pngFixture } from './image-ai-fixture.ts';
import { PROTECTED_IMAGE_EDIT_MODE,protectedImageSaveRequestId } from '../../../src/lib/protectedImageEditContract.ts';
type Json = Record<string, any>;

test('actual workerd/Auth/D1/private R2: three image actions, exact provider bytes, reuse, restart, unknown and revocation',async t => {
  const authRoot = new URL('../../consumer-auth/',import.meta.url).pathname;
  const heavyRoot = new URL('..',import.meta.url).pathname;
  const bundle = { bundle:true,write:false as const,format:'esm' as const,platform:'neutral' as const,
    conditions:['workerd','worker','browser'],external:['node:*','cloudflare:workers'] };
  const auth = await build({ ...bundle,stdin:{ resolveDir:authRoot,contents:`import {handleRequest} from './src/index.ts';
    export default {fetch(request,env) {return handleRequest(request,{...env,EMAIL:{send:async message =>
      env.MAIL.fetch(new Request('https://mail.test',{method:'POST',body:JSON.stringify(message)})).then(r=>r.json())}})}};` } });
  // Only AI inference and email transport are fixtures. Product auth/authorization,
  // all image contracts, multipart encoding, SQL/R2/signing/recovery run in workerd.
  const heavy = await build({ ...bundle,stdin:{ resolveDir:heavyRoot,contents:`import {handleRequest} from './src/index.ts';
    export default {fetch(request,env) {return handleRequest(request,{...env,AI:{run:async(model,input) => {
      const response=await env.MODEL.fetch(new Request('https://model.test',{method:'POST',
        headers:{'content-type':input.multipart.contentType,'x-model':model},body:input.multipart.body}));
      if(!response.ok) throw new Error('provider response unknown'); return response.json();
    }}})}};` } });
  const captured = process.env.HEAVY_IMAGE_PROVIDER_FIXTURE_DIR;
  const fixture = (name:string,width:number,height:number) => {
    if (!captured) return { bytes:pngFixture(width,height),width,height };
    const report = JSON.parse(readFileSync(`${captured}/${name}-01.json`,'utf8'));
    assert.equal(report.status,'inference_and_raster_contract_pass'); assert.equal(report.model,IMAGE_MODEL);
    const raw = readFileSync(`${captured}/${name}-01.provider.json`);
    assert.equal(createHash('sha256').update(raw).digest('hex'),report.rawSHA256);
    const image = decodeImage(JSON.parse(raw.toString()).result.image,false);
    assert.equal(createHash('sha256').update(image.bytes).digest('hex'),report.imageSHA256);
    assert.equal(image.width,width); assert.equal(image.height,height); return image;
  };
  const garment = fixture('garment',512,512); const edit = fixture('edit',512,512);
  const fitting = fixture('fitting',768,1024); const person = fixture('person',512,512);
  t.diagnostic(captured ? 'Captured real FLUX generate/edit/fitting payloads and SHA256 verified; no new provider inference in this test.' : 'Synthetic decodable PNG inference fixtures; no real-provider claim.');
  const mail:string[] = []; const calls:Array<{model:string,form:FormData}> = [];
  let output = garment; let hook:((form:FormData)=>Promise<Response|null>)|undefined;
  const common = { modules:true,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat'] };
  const workers:V4WorkerOptions[] = [
    { ...common,name:'auth',routes:['auth.test/*'],script:auth.outputFiles[0].text,d1Databases:{AUTH_DB:'auth-db'},
      bindings:{APP_ID:'heavy',AUTH_SECRET:'local-image-runtime-auth-secret-1234567890',AUTH_BASE_URL:'https://auth.test',WEB_ORIGINS:'',EMAIL_FROM:'auth@example.test',EMAIL_DAILY_ATTEMPT_LIMIT:'20',EMAIL_TOTAL_ATTEMPT_LIMIT:'20'},
      serviceBindings:{ MAIL:async(request:Request) => { mail.push((await request.json() as {text:string}).text); return Response.json({messageId:'local-fixture'}); } } },
    { ...common,name:'heavy',routes:['heavy.test/*'],script:heavy.outputFiles[0].text,d1Databases:{DB:'heavy-db'},r2Buckets:{PRIVATE_MEDIA:'heavy-private'},
      bindings:{AUTH_ISSUER:'https://auth.test',FRONTEND_ORIGINS:'https://heavy.test',MEDIA_READ_SECRET:'local-image-runtime-media-secret-1234567890',
        AI_IMAGE_ENABLED:'true',AI_IMAGE_ALLOWED_ACTIONS:'generate-image,edit-image,model-matrix'},
      serviceBindings:{AUTH_SERVICE:'auth',MODEL:async(request:Request) => {
        const form = await request.formData(); const model = request.headers.get('x-model')!;
        assert.equal(model,IMAGE_MODEL); assert.equal(Number(form.get('width')),output.width); assert.equal(Number(form.get('height')),output.height);
        calls.push({model,form}); const custom = await hook?.(form); return custom ?? Response.json({image:Buffer.from(output.bytes).toString('base64')});
      } } },
  ];
  const mf = new Miniflare(convertV4MiniflareOptions({workers})); t.after(()=>mf.dispose());
  for (const [worker,dir,binding] of [['auth',authRoot,'AUTH_DB'],['heavy',heavyRoot,'DB']]) {
    const db = await mf.getD1Database(binding,worker);
    for (const file of readdirSync(dir+'/migrations').filter(f=>f.endsWith('.sql')).sort()) {
      const sql = readFileSync(dir+'/migrations/'+file,'utf8');
      const statements = sql.includes('-- statement-breakpoint') ? sql.split('-- statement-breakpoint') : sql.replace(/^\s*--.*$/gm,'').split(';');
      for (const statement of statements.map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
  }
  const call = (worker:string,path:string,token?:string,value?:unknown,id?:string,method=value===undefined?'GET':'POST') =>
    mf.dispatchFetch(`https://${worker}.test${path}`,{method,redirect:'manual',headers:{origin:`https://${worker}.test`,
      ...(token?{authorization:`Bearer ${token}`} : {}),...(value===undefined?{}:{'content-type':'application/json'}),...(id?{'Idempotency-Key':id}:{})},
      ...(value===undefined?{}:{body:JSON.stringify(value)})});
  const json = async(response:Awaited<ReturnType<typeof call>>) => { assert.equal(response.status,200,await response.clone().text()); return response.json() as Promise<Json>; };
  async function register(name:string) {
    const credentials={email:`${name}@example.test`,password:'local-only-image-runtime-password-4729'};
    assert.equal((await call('auth','/api/auth/sign-up/email',undefined,{...credentials,name})).status,200);
    const verify = new URL(mail.at(-1)!.match(/https:\/\/\S+/)![0]); assert.equal((await mf.dispatchFetch(verify.toString(),{redirect:'manual'})).status,302);
    const login = await call('auth','/api/auth/sign-in/email',undefined,credentials); assert.equal(login.status,200);
    const token = login.headers.get('set-auth-token')!; assert(token);
    return {token,profile:await json(await call('heavy','/v1/profile',token))};
  }
  const owner = await register('owner'); const maker = await register('maker'); const outsider = await register('outsider');
  const brandResponse = await call('heavy','/v1/brands',owner.token,{name:'Image Runtime'}); assert.equal(brandResponse.status,201);
  const brand = (await brandResponse.json() as Json).id;
  let db = await mf.getD1Database('DB','heavy'); let bucket = await mf.getR2Bucket('PRIVATE_MEDIA','heavy');
  await db.prepare('INSERT INTO brand_members(id,brand_id,user_id,role,joined_at) VALUES(?,?,?,?,?)').bind('local-maker',brand,maker.profile.id,'editor',new Date().toISOString()).run();
  const basic = {brandId:brand,prompt:'Original cotton garment, studio product photograph',width:512,height:512,legalSafety:{rightsConfirmed:true}};
  const id = crypto.randomUUID();
  const first = await json(await call('heavy','/v1/provider-actions/generate-image',maker.token,basic,id));
  assert.equal(first.success,true); assert.equal(first.providerModel,IMAGE_MODEL); assert.equal(calls.length,1);
  const privateRead = await mf.dispatchFetch(first.imageUrl); assert.equal(privateRead.status,200);
  assert.deepEqual(new Uint8Array(await privateRead.arrayBuffer()),garment.bytes);
  assert.equal((await bucket.list({prefix:'generated-images/'})).objects.length,1);
  const again = await json(await call('heavy','/v1/provider-actions/generate-image',maker.token,basic,id)); assert.equal(again.imageId,first.imageId); assert.equal(calls.length,1);
  assert.equal((await call('heavy','/v1/image-ai/requests/'+id,outsider.token)).status,404);
  assert.equal((await call('heavy','/v1/generated-images/'+first.imageId+'/content',outsider.token)).status,404);
  assert.equal((await call('heavy','/v1/image-ai/usage?brand_id='+brand,outsider.token)).status,403);
  const asURL = (bytes:Uint8Array) => `data:${decodeImage(Buffer.from(bytes).toString('base64'),false).contentType};base64,${Buffer.from(bytes).toString('base64')}`;
  output = edit; const editID = crypto.randomUUID();
  const editInput = {...basic,prompt:'Change only the two pocket colors to mustard yellow; retain the other garment details.',imageUrls:[asURL(garment.bytes)],parentImageId:first.imageId,generation:2};
  const edited = await json(await call('heavy','/v1/provider-actions/edit-image',maker.token,editInput,editID)); assert.equal(edited.success,true);
  assert.deepEqual(new Uint8Array(await (calls[1].form.get('input_image_0') as File).arrayBuffer()),garment.bytes);
  assert.equal((await db.prepare('SELECT parent_image_id FROM generated_images WHERE id=?').bind(edited.imageId).first<Json>())!.parent_image_id,first.imageId);
  output = fitting;
  const fitted = await json(await call('heavy','/v1/provider-actions/model-matrix',maker.token,{...basic,width:768,height:1024,
    imageUrl:asURL(garment.bytes),modelReferenceImageUrl:asURL(person.bytes),bodyTypes:['regular'],ageGroups:['30s'],gender:'male'},crypto.randomUUID()));
  assert.equal(fitted.success,true); assert.equal(fitted.matrix[0].ageGroup,'30s');
  assert.deepEqual(new Uint8Array(await (calls[2].form.get('input_image_1') as File).arrayBuffer()),person.bytes);
  const fittingRead = await mf.dispatchFetch(fitted.imageUrl); assert.equal(fittingRead.status,200); assert.deepEqual(new Uint8Array(await fittingRead.arrayBuffer()),fitting.bytes);
  const gallery = await json(await call('heavy','/v1/generated-images?brand_id='+brand,maker.token)); assert.equal(gallery.length,3);
  const jobs = await json(await call('heavy','/v1/generation-jobs?brand_id='+brand,maker.token)); assert.equal(jobs.length,3); assert(jobs.every((j:Json)=>j.status==='completed'));
  const canvasInput = {id:crypto.randomUUID(),brand_id:brand,title:'Use existing AI result',snapshot:{version:1,objects:[{id:'canvas-image',imageId:fitted.imageId,storagePath:fitted.storagePath}]}};
  const canvas = await json(await call('heavy','/v1/canvas-documents',maker.token,canvasInput));
  assert.equal(canvas.id,canvasInput.id);assert.equal(canvas.revision,0);
  assert.deepEqual(await json(await call('heavy','/v1/canvas-documents',maker.token,canvasInput)),canvas);
  assert.equal((await call('heavy','/v1/canvas-documents',maker.token,{...canvasInput,title:'Different create'})).status,409);
  assert.equal((await call('heavy','/v1/canvas-documents',owner.token,canvasInput)).status,409);
  assert.equal((await call('heavy','/v1/canvas-documents/'+canvas.id,outsider.token)).status,404);
  const restoredCanvas = await json(await call('heavy','/v1/canvas-documents/'+canvas.id,maker.token)); assert.equal(restoredCanvas.snapshot.objects[0].storagePath,fitted.storagePath);
  const usage = await json(await call('heavy','/v1/image-ai/usage?brand_id='+brand,maker.token));
  assert.equal(usage.completedImages,3); assert.equal(usage.remainingUnits,22); assert.equal(usage.estimatedMicroUSD,1899); assert.equal(usage.providerBilling,null);
  // Simulate the persisted object / not-yet-committed image boundary, then an
  // actual Worker restart. Recovery reads immutable R2; it never invokes AI.
  await db.batch([
    db.prepare('DELETE FROM generated_images WHERE id=?').bind(edited.imageId),
    db.prepare("UPDATE heavy_ai_candidates SET state='storing' WHERE request_id=?").bind(editID),
    db.prepare("UPDATE heavy_ai_requests SET state='unknown' WHERE request_id=?").bind(editID),
  ]);
  await mf.setOptions(convertV4MiniflareOptions({workers:workers.map(w=>w.name==='heavy'?{...w,script:heavy.outputFiles[0].text+'\n// image-restart'}:w)}));
  db = await mf.getD1Database('DB','heavy'); bucket = await mf.getR2Bucket('PRIVATE_MEDIA','heavy');
  assert.deepEqual(await json(await call('heavy','/v1/canvas-documents/'+canvas.id,maker.token)),canvas);
  assert.deepEqual(await json(await call('heavy','/v1/canvas-documents',maker.token,canvasInput)),canvas);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM canvas_documents WHERE id=?').bind(canvas.id).first<Json>())!.n,1);
  const canvasUpdate={title:'Updated existing design',snapshot:canvasInput.snapshot,expected_revision:0};
  assert.equal((await json(await call('heavy','/v1/canvas-documents/'+canvas.id,maker.token,canvasUpdate,undefined,'PATCH'))).revision,1);
  assert.equal((await call('heavy','/v1/canvas-documents/'+canvas.id,maker.token,canvasUpdate,undefined,'PATCH')).status,409);
  await db.prepare("UPDATE brand_members SET role='viewer' WHERE id='local-maker'").run();
  assert.equal((await call('heavy','/v1/canvas-documents',maker.token,{...canvasInput,id:crypto.randomUUID()})).status,403);
  assert.equal((await call('heavy','/v1/canvas-documents/'+canvas.id,maker.token,{...canvasUpdate,expected_revision:1},undefined,'PATCH')).status,404);
  assert.equal((await db.prepare('SELECT revision FROM canvas_documents WHERE id=?').bind(canvas.id).first<Json>())!.revision,1);
  await db.prepare("UPDATE brand_members SET role='editor' WHERE id='local-maker'").run();
  const recovered = await json(await call('heavy','/v1/image-ai/requests/'+editID,maker.token)); assert.equal(recovered.success,true); assert.equal(calls.length,3);
  assert.equal((await bucket.list({prefix:'generated-images/'})).objects.length,3);
  const recoveredRead = await mf.dispatchFetch(recovered.imageUrl); assert.deepEqual(new Uint8Array(await recoveredRead.arrayBuffer()),edit.bytes);
  output = garment; hook = async()=>new Response('uncertain provider response',{status:503});
  const unknownID = crypto.randomUUID(); const unknownInput = {...basic,count:2};
  const unknown = await json(await call('heavy','/v1/provider-actions/generate-image',maker.token,unknownInput,unknownID)); assert.equal(unknown.state,'unknown'); assert.equal(unknown.success,false);
  assert.equal(unknown.usage.estimatedMicroUSD,null); assert.equal(unknown.usage.unknownEstimateCount,1);
  await json(await call('heavy','/v1/provider-actions/generate-image',maker.token,unknownInput,unknownID));
  await json(await call('heavy','/v1/image-ai/requests/'+unknownID,maker.token)); assert.equal(calls.length,4);
  // A real current membership downgrade inside inference prevents R2 write and
  // late delivery. A viewer cannot reconcile an unfinished save into existence.
  hook = async()=> { await db.prepare("UPDATE brand_members SET role='viewer' WHERE id='local-maker'").run(); return null; };
  const revokedID = crypto.randomUUID();
  assert.equal((await call('heavy','/v1/provider-actions/generate-image',maker.token,basic,revokedID)).status,403);
  assert.equal((await bucket.list({prefix:'generated-images/'})).objects.length,3);
  const before = await db.prepare('SELECT state FROM heavy_ai_requests WHERE request_id=?').bind(revokedID).first<Json>();
  await json(await call('heavy','/v1/image-ai/requests/'+revokedID,maker.token));
  assert.deepEqual(await db.prepare('SELECT state FROM heavy_ai_requests WHERE request_id=?').bind(revokedID).first<Json>(),before);
  assert.equal((await json(await call('heavy','/v1/image-ai/requests/'+id,maker.token))).success,true);
  assert.equal(calls.length,5); assert.equal((await bucket.list({prefix:'generated-images/'})).objects.length,3);
  assert.equal((await call('auth','/api/auth/sign-out',maker.token,{})).status,200);
  assert.equal((await call('heavy','/v1/image-ai/requests/'+id,maker.token)).status,401);
  assert.equal((await call('heavy','/v1/image-ai/usage?brand_id='+brand,maker.token)).status,401);
  // The real workspace writer closes a masked batch only after all four
  // canonical composites exist. Its recovery route repairs D1 from R2 alone.
  hook = undefined; output = edit;
  const protectedID = crypto.randomUUID(); const finalPng = pngFixture(512,512);
  const plan = {mode:PROTECTED_IMAGE_EDIT_MODE,sourceWidth:512,sourceHeight:512,sourceSha256:'a'.repeat(64),maskSha256:'b'.repeat(64),guideIndex:1,coveragePercent:20};
  const protectedInput = {...basic,count:4,featureType:'canvas-partial-edit',imageUrls:[asURL(garment.bytes),asURL(finalPng)],protectedEdit:plan};
  const beforeProtectedUsage = await json(await call('heavy','/v1/image-ai/usage?brand_id='+brand,owner.token));
  const intermediate = await json(await call('heavy','/v1/provider-actions/edit-image',owner.token,protectedInput,protectedID));
  assert.equal(intermediate.requiresProtectedComposite,true); assert.equal(calls.length,9);
  assert.match(String(calls.at(-1)!.form.get('prompt')),/white.*edit|editable.*white/i);
  assert.equal((await json(await call('heavy','/v1/generated-images?brand_id='+brand,owner.token))).length,0,'provider intermediates and another creator\'s private images are not Gallery results');
  assert.equal((await db.prepare('SELECT status FROM generation_jobs WHERE id=?').bind(intermediate.jobId).first<Json>())!.status,'processing');
  const finalIds:string[] = [];
  for (let index=0;index<4;index++) {
    const requestId = await protectedImageSaveRequestId(protectedID,index); finalIds.push(requestId);
    const input = {requestId,brandId:brand,featureType:'canvas-partial-edit',title:'Protected edit',prompt:basic.prompt,
      sourceJobId:intermediate.jobId,sourceStoragePath:null,imageUrl:asURL(finalPng),imageAI:{requestId:protectedID,candidateIndex:index},metadata:{}};
    if (index===0) {
      assert.equal((await call('heavy','/v1/workspace-artifacts',owner.token,{...input,imageUrl:asURL(pngFixture(256,256))})).status,409);
      assert.equal((await call('heavy','/v1/workspace-artifacts',outsider.token,input)).status,403);
    }
    const saved = await json(await call('heavy','/v1/workspace-artifacts',owner.token,input));
    assert.equal(saved.metadata.providerRequestId,protectedID); assert.equal(saved.remote.imageId,'wa-'+requestId);
    const final = (await db.prepare('SELECT parent_image_id,model_used FROM generated_images WHERE id=?').bind(saved.remote.imageId).first<Json>())!;
    assert.equal(final.parent_image_id,`ai-${protectedID}-${index}`); assert.equal(final.model_used,IMAGE_MODEL);
    assert.deepEqual(new Uint8Array(await (await bucket.get(saved.remote.storagePath))!.arrayBuffer()),finalPng);
    assert.equal((await db.prepare('SELECT status FROM generation_jobs WHERE id=?').bind(intermediate.jobId).first<Json>())!.status,index===3?'completed':'processing');
  }
  // Lost last-save acknowledgement plus a Worker restart: no image re-upload.
  const last = 'wa-'+finalIds[3];
  await db.batch([db.prepare('DELETE FROM generated_images WHERE id=?').bind(last),
    db.prepare("UPDATE generation_jobs SET status='pending' WHERE id=?").bind(last),
    db.prepare("UPDATE generation_jobs SET status='processing' WHERE id=?").bind(intermediate.jobId)]);
  await mf.setOptions(convertV4MiniflareOptions({workers:workers.map(w=>w.name==='heavy'?{...w,script:heavy.outputFiles[0].text+'\n// protected-final-restart'}:w)}));
  db = await mf.getD1Database('DB','heavy'); bucket = await mf.getR2Bucket('PRIVATE_MEDIA','heavy');
  assert.equal((await call('heavy','/v1/workspace-artifacts/'+finalIds[3],outsider.token)).status,404);
  const restored = await json(await call('heavy','/v1/workspace-artifacts/'+finalIds[3],owner.token)); assert.equal(restored.remote.imageId,last);
  assert.equal(calls.length,9); assert.equal((await bucket.list({prefix:'generated-images/'})).objects.length,11);
  const finalGallery = await json(await call('heavy','/v1/generated-images?brand_id='+brand,owner.token)); assert.equal(finalGallery.length,4);
  assert(finalGallery.every((image:Json)=>image.metadata?.artifactRole !== 'provider-intermediate'));
  assert.equal((await db.prepare('SELECT status FROM generation_jobs WHERE id=?').bind(intermediate.jobId).first<Json>())!.status,'completed');
  const restoredDocument = await json(await call('heavy','/v1/canvas-documents',owner.token,{brand_id:brand,title:'Four protected edits',snapshot:{objects:finalIds.map((id,index)=>({id:'candidate-'+index,imageId:'wa-'+id,storagePath:'generated-images/wa-'+id}))}}));
  const canvasReadback = await json(await call('heavy','/v1/canvas-documents/'+restoredDocument.id,owner.token));
  assert.deepEqual(canvasReadback.snapshot.objects.map((image:Json)=>image.imageId),finalIds.map(id=>'wa-'+id));
  const sourceReceipt = await json(await call('heavy','/v1/image-ai/requests/'+protectedID,owner.token)); assert.equal(sourceReceipt.requestId,protectedID); assert.equal(calls.length,9);
  const ownerUsage = await json(await call('heavy','/v1/image-ai/usage?brand_id='+brand,owner.token));
  assert.equal(ownerUsage.completedImages-beforeProtectedUsage.completedImages,4,'four composites do not charge another four inference units');
  assert.equal(ownerUsage.remainingUnits,beforeProtectedUsage.remainingUnits-4);
});
