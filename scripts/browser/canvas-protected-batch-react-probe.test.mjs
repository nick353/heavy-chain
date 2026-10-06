import test,{after} from 'node:test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as createHttpServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {CanvasReactFixture,startCanvasReactProbe,ADMITTED_FIXTURE_SCHEMA,readAdmittedFixtureCheckpoint,validateAdmittedFixtureCheckpoint,parseCanvasReactProbeOptions} from './canvas-protected-batch-react-probe-server.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const png=async(w=160,h=120)=>'data:image/png;base64,'+(await sharp({create:{width:w,height:h,channels:4,background:{r:30,g:50,b:70,alpha:1}}}).png().toBuffer()).toString('base64');
const vite=await createServer({configFile:false,envFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
const projection=await vite.ssrLoadModule('/src/lib/protectedOpenAIProjection.ts'),native=await vite.ssrLoadModule('/src/lib/nativePrintFinalFrame.ts'),preparation=await vite.ssrLoadModule('/src/lib/prepareProtectedOpenAIProjection.ts');
const contract=await vite.ssrLoadModule('/src/lib/protectedImageEditContract.ts');
const documents=await vite.ssrLoadModule('/src/lib/canvasDocumentPersistence.ts');
const restoreValidators={deriveSaveId:contract.protectedImageSaveRequestId,verifyProjectionRequest:projection.verifyProtectedOpenAIProjectionRequest,validateNativeFrame:native.validateNativePrintFinalFrame,validateCanvasBinding:native.validateCanvasProtectedBatchBinding};
const originals={Image:globalThis.Image,document:globalThis.document};after(async()=>{Object.assign(globalThis,originals);await vite.close();});
const boot=async()=>{const fixture=new CanvasReactFixture();fixture.verifyProjectionRequest=projection.verifyProtectedOpenAIProjectionRequest;fixture.validateNativeFrame=native.validateNativePrintFinalFrame;fixture.validateCanvasBinding=native.validateCanvasProtectedBatchBinding;const runId=randomUUID();const[,run]=await fixture.dispatch(runId,'/bootstrap','POST',{originalPng:await png()});return{fixture,runId,run,headers:{authorization:`Bearer fixture-not-a-production-credential-${runId}`}};};
// Unit renderer supplies real encoded PNGs and checks actual helper draw geometry.
// It does not stand in for root's native-browser Canvas/readback acceptance.
async function wire(f){
 const primary=await png(160,120),guide=await png(160,120),extra=await png(24,32),renderedPrimary=await png(1536,1024),renderedGuide=await png(1536,1024),draws=[];
 globalThis.Image=class{set src(url){this.input=url;sharp(Buffer.from(url.slice(22),'base64')).metadata().then(meta=>{this.naturalWidth=meta.width;this.naturalHeight=meta.height;this.onload();}).catch(()=>this.onerror());}};
 globalThis.document={createElement(){const canvas={width:0,height:0};canvas.getContext=()=>({fillStyle:'#000',fillRect(x,y,w,h){assert.equal(x,0);assert.equal(y,0);assert.equal(w,1536);assert.equal(h,1024);},drawImage(image,...args){assert.equal(args.length,8);draws.push(args);canvas.output=draws.length%2===1?renderedPrimary:renderedGuide;}});canvas.toDataURL=()=>canvas.output;return canvas;}};
 const id=randomUUID(),binding={version:1,requestId:id,batchStateArtifactId:'canvas-protected-batch-'+id,requestedCandidateCount:4,featureType:'canvas-partial-edit',canvasProjectId:'local-'+randomUUID(),parentObjectId:'source',generation:1,brandId:f.run.brandId,scopeId:f.run.userId,generationInputSignature:'a'.repeat(64),source:{kind:'object',objectId:'source',identityDigest:'b'.repeat(64)}};
 const plan={sourceWidth:160,sourceHeight:120,sourceSha256:hash(primary),maskSha256:'c'.repeat(64),guideIndex:2};
 const transforms=[{index:0,sourceWidth:160,sourceHeight:120,width:160,height:120,resized:false,renderingTransform:{x:0,y:0,scaleX:1,scaleY:1}},{index:1,sourceWidth:24,sourceHeight:32,width:24,height:32,resized:false},{index:2,sourceWidth:160,sourceHeight:120,width:160,height:120,resized:false,renderingTransform:{x:0,y:0,scaleX:1,scaleY:1}}];
 const sourceBody={brandId:f.run.brandId,featureType:'canvas-partial-edit',generationProvider:'openai',count:4,imageUrls:[primary,extra,guide],referenceTransforms:transforms,protectedEdit:plan,canvasProjectId:binding.canvasProjectId,parentObjectId:'source',generation:1};
 const result=await preparation.prepareProtectedOpenAIProjection({body:sourceBody,plan,sourceImageUrl:primary,maskDataUrl:primary},sourceBody);
 const body={...result.body,canvasProtectedBatchBinding:binding,nativePrintFinalFrame:{...result.native,version:'canvas-protected-openai-contain-v1',canvasBatch:binding}};
 const data=await png(1536,1024);await f.fixture.dispatch(f.runId,'/candidate-pngs','POST',{requestId:id,geometry:result.projection.candidate,pngs:[data,data,data,data]});
 return{body,id,headers:{...f.headers,'idempotency-key':id},draws,data};
}
test('fail-closed service boundary authenticates fixture-only user and refuses undeclared API',async()=>{const{fixture,runId,run}=await boot();const[auth,data]=await fixture.dispatch(runId,'/api/auth/get-session','GET');assert.equal(auth,200);assert.equal(data.user.id,run.userId);assert.match(data.session.token,/^fixture-not-a-production-credential-/);assert.equal((await fixture.dispatch(runId,'/v1/workspace-artifacts/'+randomUUID(),'GET'))[0],401);assert.deepEqual(await fixture.dispatch(runId,'/v1/not-declared','GET',undefined,{authorization:`Bearer fixture-not-a-production-credential-${runId}`}),[404,{error:'fixture_undeclared_route'}]);await fixture.dispatch(runId,'/event','POST',{type:'network-blocked',info:{url:'https://undeclared.invalid'}});assert.deepEqual(run.escapedNetwork,['https://undeclared.invalid']);assert.equal(run.generationAdmissions,0);});
test('lost manual document response commits once, holds immediate readback, and reload preserves server revision',async()=>{const{fixture,runId,run,headers}=await boot(),id=randomUUID();await fixture.dispatch(runId,'/control','POST',{kind:'document-loss'});const body={id,brand_id:run.brandId,title:'native fixture',snapshot:{projectId:id,objects:[{id:'ordinary'}]},snapshotVersion:1};assert.equal((await fixture.dispatch(runId,'/v1/canvas-documents','POST',body,headers))[0],503);assert.equal(run.documentLogicalWrites,1);assert.equal((await fixture.dispatch(runId,'/v1/canvas-documents/'+id,'GET',undefined,headers))[0],503);await fixture.dispatch(runId,'/bootstrap','POST',{originalPng:await png()});const[status,saved]=await fixture.dispatch(runId,'/v1/canvas-documents/'+id,'GET',undefined,headers);assert.equal(status,200);assert.equal(saved.revision,0);assert.equal(run.documentLogicalWrites,1);assert.equal((await fixture.dispatch(runId,'/v1/canvas-documents/'+id,'PATCH',{title:'with concurrent note',snapshot:{projectId:id,objects:[{id:'ordinary'},{id:'note'}]},expected_revision:0},headers))[0],200);assert.equal(run.document.revision,1);assert.equal(run.documentLogicalWrites,2);assert.equal(run.mountWrites[1].generationAdmissions,0);});
test('actual preparation helper sends different prepared/projected bytes+dims; provider primary/guide replacements preserve ordered additional references',async()=>{
 const f=await boot(),w=await wire(f);assert.notEqual(w.body.imageUrls[0],w.body.protectedOpenAIProjection.primaryDataUrl);assert.equal((await sharp(Buffer.from(w.body.imageUrls[0].slice(22),'base64')).metadata()).width,160);assert.equal(w.body.protectedOpenAIProjection.candidate.width,1536);assert.deepEqual(w.draws[0],w.draws[1]);
 const[status,receipt]=await f.fixture.dispatch(f.runId,'/v1/provider-actions/edit-image','POST',w.body,w.headers);assert.equal(status,200);assert.equal(receipt.requiresProtectedComposite,true);assert.deepEqual(receipt.images.map(v=>v.candidateIndex),[0,1,2,3]);assert.equal(new Set(receipt.images.map(v=>v.imageId)).size,4);assert.equal(f.run.generationAdmissions,1);const attempt=f.run.generationAttempts.at(-1);assert.equal(attempt.validationOutcome,'admitted');assert.equal(attempt.bodyDigest,hash(JSON.stringify(w.body)));assert.deepEqual(attempt.providerReferences.map(r=>[r.index,r.width,r.height,r.digest]),[[0,1536,1024,w.body.protectedOpenAIProjection.projected.primaryDigest],[1,24,32,hash(w.body.imageUrls[1])],[2,1536,1024,w.body.protectedOpenAIProjection.projected.guideDigest]]);for(const candidate of receipt.images)assert.deepEqual(f.fixture.media(f.runId,candidate.imageId+'.png'),Buffer.from(w.data.slice(22),'base64'));
});
for(const [name,change,expected]of [
 ['prepared-digest',async b=>{b.imageUrls[0]=await png(159,120);},'fixture_prepared_digest_invalid'],
 ['prepared-dimensions',async b=>{b.imageUrls[0]=await png(159,120);b.protectedOpenAIProjection.prepared.primaryDigest=hash(b.imageUrls[0]);},'fixture_prepared_geometry_invalid'],
 ['projected-digest',async b=>{b.protectedOpenAIProjection.projected.primaryDigest='f'.repeat(64);},'fixture_projection_digest_invalid'],
 ['projected-dimensions',async b=>{b.protectedOpenAIProjection.primaryDataUrl=await png(1535,1024);b.protectedOpenAIProjection.projected.primaryDigest=hash(b.protectedOpenAIProjection.primaryDataUrl);},'fixture_projection_geometry_invalid'],
 ['preparation-transform',async b=>{b.referenceTransforms[0].renderingTransform.scaleX=2;},'protected_openai_projection_invalid'],
 ['contain',async b=>{b.protectedOpenAIProjection.contain.x+=1;},'protected_openai_projection_invalid'],
 ['guide-index',async b=>{b.protectedEdit.guideIndex=9;},'fixture_prepared_guide_index_invalid'],
 ['native-candidate-geometry',async b=>{b.nativePrintFinalFrame.candidateGeometry.width=1024;},'invalid_native_print_final_frame:candidate_geometry'],
])test(name+' rejects before admission and records actual gate/identity/body digest',async()=>{const f=await boot(),w=await wire(f);await change(w.body);await assert.rejects(f.fixture.dispatch(f.runId,'/v1/provider-actions/edit-image','POST',w.body,w.headers),e=>e.message===expected);assert.equal(f.run.generationPosts,1);assert.equal(f.run.generationAdmissions,0);assert.deepEqual(f.run.requests,{});assert.deepEqual(f.run.saves,{});const a=f.run.generationAttempts.at(-1);assert.equal(a.validationOutcome,'rejected');assert.equal(a.error,expected);assert.equal(a.requestIdentity.headerRequestId,w.id);assert.equal(a.bodyDigest,hash(JSON.stringify(w.body)));});
for(const [name,change]of [
 ['headerUUID',(b,h)=>h['idempotency-key']=randomUUID()],['scope',b=>b.canvasProtectedBatchBinding.scopeId='foreign'],['brand',b=>b.brandId='foreign'],['feature',b=>b.featureType='canvas-inpaint'],['unsupported-feature',b=>b.featureType='ordinary-edit'],['count',b=>b.count=3],['provider',b=>b.generationProvider='workers_ai'],
])test(name+' binding fence remains before admission',async()=>{const f=await boot(),w=await wire(f);change(w.body,w.headers);await assert.rejects(f.fixture.dispatch(f.runId,'/v1/provider-actions/edit-image','POST',w.body,w.headers),/fixture_protected_request_binding_invalid/);assert.equal(f.run.generationAdmissions,0);assert.deepEqual(f.run.saves,{});assert.equal(f.run.generationAttempts.at(-1).error,'fixture_protected_request_binding_invalid');});

test('pre-mount same-run restart retains exact history and narrow CSP; completed effects cannot use startup restoration',async()=>{const{run}=await boot();run.events.push({type:'error',info:{message:'Failed to fetch before baseline'},at:new Date().toISOString()});const dir=mkdtempSync(join(tmpdir(),'canvas-probe-csp-')),file=join(dir,'restore.json');writeFileSync(file,JSON.stringify(run));const server=await startCanvasReactProbe({restoreState:file});try{const response=await fetch(server.readyUrl);assert.equal(response.status,200);const connect=response.headers.get('content-security-policy').split(';').find(v=>v.trim().startsWith('connect-src')).trim();assert.equal(connect,"connect-src 'self' data: blob: https://canvas-protected-media.invalid");assert.deepEqual(await(await fetch(server.origin+'/__canvas-react/'+run.runId+'/state')).json(),run);const invalid={...run,generationAdmissions:1};writeFileSync(file,JSON.stringify(invalid));await assert.rejects(startCanvasReactProbe({restoreState:file}),/fixture_restore_pre_mount_state_required/);const baseline={...run,events:[{type:'baseline'}]};writeFileSync(file,JSON.stringify(baseline));await assert.rejects(startCanvasReactProbe({restoreState:file}),/fixture_restore_pre_mount_state_required/);}finally{await server.vite.close();rmSync(dir,{recursive:true,force:true});}});

test('independent generic source promotion ledger: exact raw bytes/canonical UUID/no-metadata receipts; conflict and scope rejected, four-candidate counters unchanged',async()=>{
 const f=await boot(),requestId=randomUUID(),imageUrl=await png(),bytes=Buffer.from(imageUrl.slice(22),'base64'),rawHash=hash(bytes),revision={algorithm:'sha-256',hash:rawHash,revision:'sha256:'+rawHash,mimeType:'image/png',width:160,height:120,sizeBytes:bytes.length},body={requestId,brandId:f.run.brandId,featureType:'canvas-source-upload',title:'Canvas source',imageUrl,prompt:null,sourceStoragePath:null,metadata:{sourceIdentity:{kind:'local-upload',hash:rawHash},sourceRevision:revision,sourceDigestScheme:'sha256-raw-bytes-v1'}};
 const baseline={posts:f.run.generationPosts,admissions:f.run.generationAdmissions,finals:{...f.run.savePostsByIndex},native:f.run.nativeCandidates};
 const [status,receipt]=await f.fixture.dispatch(f.runId,'/v1/workspace-artifacts','POST',body,f.headers);assert.equal(status,200);assert.deepEqual(receipt,{success:true,remote:{jobId:'wa-'+requestId,imageId:'wa-'+requestId,storagePath:'generated-images/wa-'+requestId}});assert.equal(receipt.metadata,undefined);assert.equal(receipt.imageUrl,undefined);assert.equal(f.run.sourcePromotionPosts,1);assert.equal(f.run.sourcePromotionWrites,1);assert.equal(f.run.sourcePromotions[requestId].ownerId,f.run.userId);assert.equal(f.run.sourcePromotions[requestId].rawSha256,rawHash);
 const [getStatus,read]=await f.fixture.dispatch(f.runId,'/v1/workspace-artifacts/'+requestId,'GET',undefined,f.headers);assert.equal(getStatus,200);assert.deepEqual(read,receipt);assert.deepEqual(f.fixture.media(f.runId,'wa-'+requestId+'.png'),bytes);const [mediaStatus,media]=await f.fixture.dispatch(f.runId,'/v1/media/read?bucket=generated-images&path=generated-images/wa-'+requestId+'&expiresIn=3600','GET',undefined,f.headers);assert.equal(mediaStatus,200);assert.equal(media.objectPath,receipt.remote.storagePath);assert(media.url.startsWith('https://'));
 assert.deepEqual(await f.fixture.dispatch(f.runId,'/v1/workspace-artifacts','POST',body,f.headers),[200,receipt]);assert.equal(f.run.sourcePromotionWrites,1);
 assert.equal((await f.fixture.dispatch(f.runId,'/v1/workspace-artifacts','POST',{...body,title:'conflict'},f.headers))[0],409);assert.equal(f.run.sourcePromotionWrites,1);
 assert.equal((await f.fixture.dispatch(f.runId,'/v1/workspace-artifacts','POST',body,{authorization:'Bearer foreign'}))[0],401);
 for(const wrong of [{...body,requestId:'not-a-uuid'},{...body,brandId:'foreign'},{...body,imageAI:{requestId:randomUUID(),candidateIndex:0}},{...body,sourceStoragePath:'generated-images/foreign'},{...body,metadata:{...body.metadata,sourceRevision:{...revision,hash:'f'.repeat(64)}}}])await assert.rejects(f.fixture.dispatch(f.runId,'/v1/workspace-artifacts','POST',wrong,f.headers));
 assert.deepEqual({posts:f.run.generationPosts,admissions:f.run.generationAdmissions,finals:f.run.savePostsByIndex,native:f.run.nativeCandidates},baseline);assert.equal(f.run.documentLogicalWrites,0);assert.equal(f.run.documentAttempts,0);
});

// Read the frozen QA checkpoint; these tests never activate its original port,
// browser or provider operation. The file itself is not modified.
const admittedFile=join(process.cwd(),'../../2026-10-04/heavy-chain/outputs/canvas-protected-batch-20261005/local-source-promotion/document-fixture-contract-implementation/checkpoint-before.json');
const admittedRaw=readFileSync(admittedFile),admittedOriginal=JSON.parse(admittedRaw),admittedOptions={expectedRun:admittedOriginal.runId,expectedSchema:ADMITTED_FIXTURE_SCHEMA,expectedSha256:hash(admittedRaw)};
// A synthetic unit-only pre-promotion shape keeps absence/partial-type coverage.
// No old persisted checkpoint is read, restored or rewritten by these tests.
function syntheticPrePromotion(run){for(const id of Object.keys(run.sourcePromotions??{}))delete run.saves[id];delete run.sourcePromotions;delete run.sourcePromotionPosts;delete run.sourcePromotionWrites;run.documentAttempts=0;}
async function withCheckpoint(change,fn){const dir=mkdtempSync(join(tmpdir(),'canvas-admitted-')),file=join(dir,'state.json'),run=structuredClone(admittedOriginal);change?.(run);const raw=Buffer.from(JSON.stringify(run,null,2)+'\n');writeFileSync(file,raw);try{return await fn(file,{...admittedOptions,expectedSha256:hash(raw)},run);}finally{rmSync(dir,{recursive:true,force:true});}}
async function listeningHttp(){const server=createHttpServer((req,res)=>res.end('occupied'));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});assert.notEqual(server.address().port,5187);return server;}
const closeHttp=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
async function freeTestPort(){const holder=await listeningHttp(),port=holder.address().port;await closeHttp(holder);return port;}

test('admitted decoder preserves exact latest QA state including verified source ledger and unsuccessful document attempt',async()=>{
 const run=readAdmittedFixtureCheckpoint(admittedFile,admittedOptions),decoded=await validateAdmittedFixtureCheckpoint(run,restoreValidators);
 assert.deepEqual(decoded,admittedOriginal);assert.equal(decoded.sourcePromotionPosts,1);assert.equal(decoded.sourcePromotionWrites,1);assert.equal(decoded.documentAttempts,1);assert.equal(decoded.documentLogicalWrites,0);assert.equal(decoded.document,null);assert.deepEqual(readFileSync(admittedFile),admittedRaw);
 assert.equal(decoded.controls.documentLoss,true);assert.deepEqual(decoded.savePostsByIndex,{'0':1,'1':1,'2':1,'3':1});assert.equal(decoded.generationAdmissions,1);assert.equal(decoded.reports.at(-1).info.placements,4);
 for(const [id,record]of Object.entries(decoded.saveBodies)){assert.equal(record.fingerprint,hash(JSON.stringify(record.body)));assert.equal(decoded.saves[id].imageUrl,record.body.imageUrl);assert.equal(decoded.saves[id].remote.imageId,'wa-'+id);}
});

test('admitted startup hydrates directly before bind, stays read-only over event loop, and ready URL pins run; HTTP cannot restore',async()=>{
 const port=await freeTestPort(),dir=mkdtempSync(join(tmpdir(),'canvas-admitted-output-')),originalDispatch=CanvasReactFixture.prototype.dispatch;let handlers=0;
 CanvasReactFixture.prototype.dispatch=function(...args){handlers++;return originalDispatch.apply(this,args);};
 let server;try{
  server=await startCanvasReactProbe({port,output:dir,restoreAdmittedState:admittedFile,...admittedOptions});assert.equal(handlers,0);assert.equal(server.origin,'http://127.0.0.1:'+port);assert.equal(server.readyUrl,server.origin+'/__canvas-react-probe?run='+admittedOriginal.runId);
  const restored=admittedOriginal;assert.deepEqual(server.fixture.runs.get(admittedOriginal.runId),restored);await new Promise(resolve=>setTimeout(resolve,40));assert.equal(handlers,0);assert.deepEqual(server.fixture.runs.get(admittedOriginal.runId),restored);
  const read=await fetch(server.origin+'/__canvas-react/'+admittedOriginal.runId+'/state');assert.deepEqual(await read.json(),restored);assert.equal(handlers,1);
  const html=await fetch(server.readyUrl);assert.equal(html.status,200);assert.match(await html.text(),/canvas-protected-batch-react-probe\.tsx/);
  for(const path of ['/scripts/browser/canvas-protected-batch-react-probe.tsx','/src/lib/canvasSourcePromotion.ts']){const module=await fetch(server.origin+path);assert.equal(module.status,200);assert.doesNotMatch(await module.text(),/Error when evaluating SSR module/);}
  assert.equal(handlers,1);assert.deepEqual(server.fixture.runs.get(admittedOriginal.runId),restored);
  const denied=await fetch(server.origin+'/__canvas-react/'+admittedOriginal.runId+'/restore-admitted-state',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(denied.status,404);assert.deepEqual(await denied.json(),{error:'fixture_undeclared_route'});assert.deepEqual(server.fixture.runs.get(admittedOriginal.runId),restored);
 }finally{CanvasReactFixture.prototype.dispatch=originalDispatch;if(server)await server.vite.close();rmSync(dir,{recursive:true,force:true});}
});

test('admitted file-only flags are mandatory, modes exclusive, hash/schema exact, and legacy guard rejects QA effects',async()=>{
 assert.throws(()=>readAdmittedFixtureCheckpoint(admittedFile,{...admittedOptions,expectedSha256:'0'.repeat(64)}),/raw_sha256_mismatch/);
 for(const [key,value,gate]of [['expectedRun',undefined,'expected_run_required'],['expectedRun',randomUUID(),'run_identity_invalid'],['expectedSchema',undefined,'schema_invalid'],['expectedSchema','future-v2','schema_invalid'],['expectedSha256',undefined,'expected_sha256_required']])assert.throws(()=>readAdmittedFixtureCheckpoint(admittedFile,{...admittedOptions,[key]:value}),new RegExp(gate));
 await assert.rejects(startCanvasReactProbe({restoreState:admittedFile}),/fixture_restore_pre_mount_state_required/);
 await assert.rejects(startCanvasReactProbe({port:1,restoreState:admittedFile,restoreAdmittedState:admittedFile,...admittedOptions}),/fixture_restore_modes_exclusive/);
 await assert.rejects(startCanvasReactProbe({restoreAdmittedState:admittedFile,...admittedOptions}),/exact_port_required/);
 await assert.rejects(startCanvasReactProbe({...admittedOptions}),/fixture_restore_admitted_mode_required/);
 assert.throws(()=>parseCanvasReactProbeOptions(['--restore-admitted-state']),/fixture_cli_argument_invalid/);assert.throws(()=>parseCanvasReactProbeOptions(['--restore-state','a','--restore-admitted-state','b']),/fixture_restore_modes_exclusive/);assert.throws(()=>parseCanvasReactProbeOptions(['--port','5187','--port','5188']),/fixture_cli_argument_invalid/);
 const parsed=parseCanvasReactProbeOptions(['--port','5188','--restore-admitted-state',admittedFile,'--expected-run',admittedOptions.expectedRun,'--expected-schema',ADMITTED_FIXTURE_SCHEMA,'--expected-sha256',admittedOptions.expectedSha256]);assert.equal(parsed.port,5188);assert.equal(parsed.restoreAdmittedState,admittedFile);assert.equal(parsed.expectedRun,admittedOriginal.runId);
});

for(const [name,change,gate]of [
 ['derived-user',r=>r.userId='foreign','run_identity_invalid'],['derived-brand',r=>r.brandId='foreign','run_identity_invalid'],
 ['missing-native-candidates',r=>delete r.nativeCandidates,'layout_incomplete'],['missing-control',r=>delete r.controls.documentLoss,'controls_invalid'],
 ['fabricated-schema',r=>r.schema=ADMITTED_FIXTURE_SCHEMA,'layout_incomplete'],['lost-armed-document-control',r=>{syntheticPrePromotion(r);r.controls.documentLoss=false;},'legacy_document_controls_invalid'],['unexpected-read-hold',r=>r.controls.readHold=true,'not_quiescent'],
 ['active-generation',r=>r.activeGeneration=1,'layout_incomplete'],['active-timer',r=>r.timers=[1],'layout_incomplete'],
 ['pending-generation',r=>r.generationAttempts[0].validationOutcome='pending','not_quiescent'],['negative-pause',r=>r.controls.negativePause=true,'not_quiescent'],
 ['provider-paused',r=>r.events.push({type:'provider-paused',requestId:Object.keys(r.requests)[0]}),'not_quiescent'],
 ['missing-baseline',r=>r.events=r.events.filter(e=>e.type!=='baseline'),'baseline_incomplete'],
 ['missing-canvas-mount',r=>r.events=r.events.filter(e=>e.type!=='product-mount'),'canvas_events_incomplete'],
 ['admission-count',r=>r.generationAdmissions++,'admission_counters_invalid'],
 ['request-body-fingerprint',r=>Object.values(r.requests)[0].body.prompt='changed','request_fingerprint_invalid'],
 ['receipt-provider',r=>Object.values(r.requests)[0].receipt.provider='workers_ai','receipt_identity_invalid'],
 ['last-candidate-identity',r=>Object.values(r.requests)[0].receipt.images[3].imageId='foreign','candidate_identity_invalid'],
 ['last-final-fingerprint',r=>Object.values(r.saveBodies)[3].body.prompt='changed','final_fingerprint_invalid'],
 ['last-final-raw-bytes',r=>{const entry=Object.values(r.saveBodies)[3];entry.body.imageUrl=r.originalPng;entry.fingerprint=hash(JSON.stringify(entry.body));},'final_proof_invalid'],
 ['last-saved-native-bytes',r=>{const id=Object.keys(r.saveBodies)[3];r.saves[id].imageUrl=r.originalPng;},'saved_identity_invalid'],
 ['incomplete-raw',r=>delete r.saves[Object.keys(r.saves).find(id=>id.startsWith('raw:'))],'raw_candidate_invalid'],
 ['incomplete-last-final',r=>delete r.saveBodies[Object.keys(r.saveBodies)[3]],'final_fingerprint_invalid'],
 ['source-byte-metadata',r=>r.events.find(e=>e.type==='baseline').info.objects.find(o=>o.id==='probe-source').metadata.sourceRevision.hash='f'.repeat(64),'source_metadata_invalid'],
 ['save-counter-missing',r=>delete r.savePostsByIndex[3],'final_counters_invalid'],
])test('admitted '+name+' fails file decoding/validation before any bind',async()=>withCheckpoint(change,async(file,options)=>{
 await assert.rejects(async()=>validateAdmittedFixtureCheckpoint(readAdmittedFixtureCheckpoint(file,options),restoreValidators),new RegExp('fixture_restore_admitted_'+gate));
}));

test('deep rejected admitted state leaves exact requested alternative port unbound',async()=>withCheckpoint(r=>delete r.saveBodies[Object.keys(r.saveBodies)[3]],async(file,options)=>{
 const port=await freeTestPort();await assert.rejects(startCanvasReactProbe({port,restoreAdmittedState:file,...options}),/final_fingerprint_invalid/);
 const holder=createHttpServer();await new Promise((resolve,reject)=>{holder.once('error',reject);holder.listen(port,'127.0.0.1',resolve);});await closeHttp(holder);
}));

test('occupied alternative port is fatal, never falls back or writes restored checkpoint',async()=>{
 const holder=await listeningHttp(),dir=mkdtempSync(join(tmpdir(),'canvas-admitted-occupied-'));try{await assert.rejects(startCanvasReactProbe({port:holder.address().port,output:dir,restoreAdmittedState:admittedFile,...admittedOptions}),/already in use/);assert.deepEqual(readFileSync(admittedFile),admittedRaw);}finally{await closeHttp(holder);rmSync(dir,{recursive:true,force:true});}
});

test('latest checkpoint after document mutation retains controls, source ledger and exact counters; stale checkpoint is not substituted',async()=>{
 const run=await validateAdmittedFixtureCheckpoint(readAdmittedFixtureCheckpoint(admittedFile,admittedOptions),restoreValidators),fixture=new CanvasReactFixture();Object.assign(fixture,restoreValidators);fixture.runs.set(run.runId,run);
 const sourceId=randomUUID(),imageUrl=run.originalPng,bytes=Buffer.from(imageUrl.slice(22),'base64'),rawHash=hash(bytes),body={requestId:sourceId,brandId:run.brandId,featureType:'canvas-source-upload',title:'Canvas source',imageUrl,prompt:null,sourceStoragePath:null,metadata:{sourceIdentity:{kind:'local-upload',hash:rawHash},sourceRevision:{algorithm:'sha-256',hash:rawHash,revision:'sha256:'+rawHash,mimeType:'image/png',width:160,height:120,sizeBytes:bytes.length},sourceDigestScheme:'sha256-raw-bytes-v1'}},headers={authorization:'Bearer fixture-not-a-production-credential-'+run.runId};
 assert.equal((await fixture.dispatch(run.runId,'/v1/workspace-artifacts','POST',body,headers))[0],200);const id=randomUUID();assert.equal((await fixture.dispatch(run.runId,'/v1/canvas-documents','POST',{id,brand_id:run.brandId,title:'latest',snapshot:{projectId:id,objects:[{id:'ordinary'}]}},headers))[0],503);
 const dir=mkdtempSync(join(tmpdir(),'canvas-admitted-latest-')),file=join(dir,'state.json');try{const held=Buffer.from(JSON.stringify(run));writeFileSync(file,held);assert.throws(()=>readAdmittedFixtureCheckpoint(file,{...admittedOptions,expectedSha256:hash(held)}),/not_quiescent/);await fixture.dispatch(run.runId,'/bootstrap','POST',{originalPng:run.originalPng});const raw=Buffer.from(JSON.stringify(run));writeFileSync(file,raw);const options={...admittedOptions,expectedSha256:hash(raw)},decoded=await validateAdmittedFixtureCheckpoint(readAdmittedFixtureCheckpoint(file,options),restoreValidators);assert.deepEqual(decoded,run);assert.equal(decoded.documentLogicalWrites,1);assert.equal(decoded.controls.documentLoss,false);assert.equal(decoded.controls.readHold,false);assert.equal(decoded.sourcePromotionWrites,admittedOriginal.sourcePromotionWrites+1);assert.deepEqual(decoded.savePostsByIndex,admittedOriginal.savePostsByIndex);assert.throws(()=>readAdmittedFixtureCheckpoint(admittedFile,options),/raw_sha256_mismatch/);}finally{rmSync(dir,{recursive:true,force:true});}
});

for(const [key,values,gate]of [
 ['sourcePromotions',[['null',null],['array',[]],['string',''],['number',0],['boolean',false]],'source_promotions_invalid'],
 ...['sourcePromotionPosts','sourcePromotionWrites'].map(key=>[key,[['null',null],['array',[]],['string','0'],['object',{}],['boolean',false],['negative',-1],['fractional',0.5],['unsafe-integer',Number.MAX_SAFE_INTEGER+1]],'source_promotion_counters_invalid']),
])for(const [name,value]of values)test('optional promotion '+key+' present '+name+' rejects before bind without absent-value substitution',async()=>withCheckpoint(run=>{run[key]=value;},async(file,options,run)=>{
 assert.throws(()=>readAdmittedFixtureCheckpoint(file,options),new RegExp('fixture_restore_admitted_'+gate));
 await assert.rejects(validateAdmittedFixtureCheckpoint(run,restoreValidators),new RegExp('fixture_restore_admitted_'+gate));
}));

test('optional promotion valid partial presence preserves values and existing ledger consistency',async()=>{
 for(const fields of [{},{sourcePromotions:{}},{sourcePromotionPosts:0},{sourcePromotionWrites:0},{sourcePromotionPosts:1},{sourcePromotions:{},sourcePromotionPosts:0,sourcePromotionWrites:0}])await withCheckpoint(run=>{syntheticPrePromotion(run);Object.assign(run,fields);},async(file,options,run)=>{
  const decoded=await validateAdmittedFixtureCheckpoint(readAdmittedFixtureCheckpoint(file,options),restoreValidators);assert.deepEqual(decoded,run);
  for(const key of ['sourcePromotions','sourcePromotionPosts','sourcePromotionWrites'])assert.equal(Object.hasOwn(decoded,key),Object.hasOwn(fields,key));
 });
 await withCheckpoint(run=>{syntheticPrePromotion(run);run.sourcePromotionWrites=1;},async(file,options)=>assert.rejects(validateAdmittedFixtureCheckpoint(readAdmittedFixtureCheckpoint(file,options),restoreValidators),/save_ledger_invalid/));
});

const qaRemoteDocumentId='a457fc25-bdb0-4205-942a-60a8728a6763';
function actualDocumentSnapshot(run,{note=false}={}){
 const request=Object.values(run.requests)[0],binding=request.body.canvasProtectedBatchBinding,objects=structuredClone(run.events.find(e=>e.type==='baseline').info.objects),source=objects.find(o=>o.id==='probe-source'),promotion=Object.values(run.sourcePromotions)[0];
 source.metadata.parameters={...source.metadata.parameters,remoteStoragePath:promotion.remote.storagePath};
 for(const entry of Object.values(run.saveBodies)){const saved=run.saves[entry.body.requestId],index=entry.body.imageAI.candidateIndex;objects.push({id:'canonical-fixture-'+index,type:'image',x:400+index*170,y:110,width:160,height:120,rotation:0,scaleX:1,scaleY:1,opacity:1,locked:false,visible:true,zIndex:index+3,src:saved.remote.storagePath,metadata:{...entry.body.metadata,imageId:saved.remote.imageId,storagePath:saved.remote.storagePath}});}
 if(note)objects.push({id:'fixture-concurrent-note',type:'text',x:100,y:400,width:350,height:40,zIndex:8,text:'response-loss reconciliation keeps concurrent note'});
 const snapshot=documents.buildCanvasDocumentSnapshot({projectId:binding.canvasProjectId,name:'actual serialized fixture document',objects,view:{zoom:0.8,panX:35,panY:20},sourceProjectIds:[binding.canvasProjectId]});
 documents.validateCanvasDocumentSnapshot(snapshot);assert.equal(snapshot.localProjectId,binding.canvasProjectId);assert.equal(Object.hasOwn(snapshot,'projectId'),false);assert.notEqual(snapshot.localProjectId,qaRemoteDocumentId);return snapshot;
}
function fixtureDocumentRecord(run,snapshot=actualDocumentSnapshot(run)){return{id:qaRemoteDocumentId,ownerId:run.userId,brandId:run.brandId,title:'actual document',snapshot,snapshotVersion:1,revision:0,createdAt:run.createdAt,updatedAt:run.createdAt};}

test('actual document serializer localProjectId differs from remote UUID; loss/readback/PATCH/restore preserve exact content',async()=>{
 const run=await validateAdmittedFixtureCheckpoint(readAdmittedFixtureCheckpoint(admittedFile,admittedOptions),restoreValidators),fixture=new CanvasReactFixture();Object.assign(fixture,restoreValidators);fixture.runs.set(run.runId,run);const headers={authorization:'Bearer fixture-not-a-production-credential-'+run.runId},snapshot=actualDocumentSnapshot(run),beforeFinals=structuredClone(run.saveBodies),sourceWrites=run.sourcePromotionWrites;
 const [lost,error]=await fixture.dispatch(run.runId,'/v1/canvas-documents','POST',{id:qaRemoteDocumentId,brand_id:run.brandId,title:'actual document',snapshot},headers);assert.equal(lost,503);assert.equal(error.error,'fixture_document_commit_response_lost');assert.equal(run.documentLogicalWrites,1);assert.equal(run.documentAttempts,admittedOriginal.documentAttempts+1);assert.deepEqual(run.document.snapshot,snapshot);
 assert.equal((await fixture.dispatch(run.runId,'/v1/canvas-documents/'+qaRemoteDocumentId,'GET',undefined,headers))[0],503);
 await fixture.dispatch(run.runId,'/bootstrap','POST',{originalPng:run.originalPng});const [status,read]=await fixture.dispatch(run.runId,'/v1/canvas-documents/'+qaRemoteDocumentId,'GET',undefined,headers);assert.equal(status,200);assert.equal(read.id,qaRemoteDocumentId);assert.equal(read.ownerId,run.userId);assert.equal(read.brandId,run.brandId);assert.deepEqual(read.snapshot,snapshot);
 const withNote=actualDocumentSnapshot(run,{note:true});const [patched,updated]=await fixture.dispatch(run.runId,'/v1/canvas-documents/'+qaRemoteDocumentId,'PATCH',{title:'with concurrent note',snapshot:withNote,expected_revision:0},headers);assert.equal(patched,200);assert.equal(updated.revision,1);assert.deepEqual(updated.snapshot,withNote);assert.equal(run.documentLogicalWrites,2);
 assert.equal((await fixture.dispatch(run.runId,'/v1/canvas-documents/'+qaRemoteDocumentId,'PATCH',{title:'stale',snapshot,expected_revision:0},headers))[0],409);assert.deepEqual(run.document.snapshot,withNote);assert.equal(run.documentLogicalWrites,2);
 const dir=mkdtempSync(join(tmpdir(),'canvas-actual-document-')),file=join(dir,'latest.json'),raw=Buffer.from(JSON.stringify(run)),port=await freeTestPort();writeFileSync(file,raw);let server;
 try{server=await startCanvasReactProbe({port,restoreAdmittedState:file,...admittedOptions,expectedSha256:hash(raw)});assert.deepEqual(server.fixture.runs.get(run.runId),run);const response=await fetch(server.origin+'/__canvas-react/'+run.runId+'/v1/canvas-documents/'+qaRemoteDocumentId,{headers});assert.equal(response.status,200);const restored=await response.json();assert.deepEqual(restored,run.document);assert.deepEqual(restored.snapshot,withNote);assert.equal(restored.snapshot.localProjectId,snapshot.localProjectId);assert.deepEqual(run.saveBodies,beforeFinals);assert.equal(run.sourcePromotionWrites,sourceWrites);assert.equal(run.generationPosts,1);assert.deepEqual(run.savePostsByIndex,admittedOriginal.savePostsByIndex);assert.deepEqual(readFileSync(admittedFile),admittedRaw);}finally{if(server)await server.vite.close();rmSync(dir,{recursive:true,force:true});}
});

test('document outer UUID/brand/auth gates remain and content shape/image sources/size reject without write',async()=>{
 for(const wrong of ['uuid','brand','auth','objects','image-local','image-data','image-blob','size']){
  const run=structuredClone(admittedOriginal),fixture=new CanvasReactFixture();fixture.runs.set(run.runId,run);const snapshot=actualDocumentSnapshot(run),body={id:qaRemoteDocumentId,brand_id:run.brandId,title:'document',snapshot},headers={authorization:'Bearer fixture-not-a-production-credential-'+run.runId};
  if(wrong==='uuid')body.id='not-a-uuid';if(wrong==='brand')body.brand_id='foreign';if(wrong==='auth')headers.authorization='Bearer foreign-owner';if(wrong==='objects')snapshot.objects=null;
  if(wrong.startsWith('image-'))snapshot.objects[0].src=wrong==='image-local'?'local-canvas-asset://other':wrong==='image-data'?'data:image/png;base64,AA==':'blob:https://fixture/other';
  if(wrong==='size')snapshot.objects.push({id:'oversize',type:'text',text:'x'.repeat(512*1024)});
  if(wrong==='auth')assert.equal((await fixture.dispatch(run.runId,'/v1/canvas-documents','POST',body,headers))[0],401);else await assert.rejects(fixture.dispatch(run.runId,'/v1/canvas-documents','POST',body,headers),new RegExp(wrong==='uuid'||wrong==='brand'?'fixture_document_identity_invalid':'fixture_document_snapshot_invalid'));
  assert.equal(run.document,null);assert.equal(run.documentLogicalWrites,0);assert.equal(run.sourcePromotionWrites,1);assert.equal(run.generationAdmissions,1);assert.deepEqual(run.savePostsByIndex,admittedOriginal.savePostsByIndex);
 }
});

for(const [name,change]of [
 ['outer-UUID',record=>record.id='not-a-uuid'],['owner',record=>record.ownerId='foreign'],['brand',record=>record.brandId='foreign'],['snapshot-shape',record=>record.snapshot.objects=null],['image-source',record=>record.snapshot.objects[0].src='local-canvas-asset://other'],
])test('stored actual document '+name+' rejects admitted decoding before bind',async()=>withCheckpoint(run=>{run.document=fixtureDocumentRecord(run);run.documentLogicalWrites=1;run.documentAttempts++;change(run.document);},async(file,options)=>{
 assert.throws(()=>readAdmittedFixtureCheckpoint(file,options),/fixture_restore_admitted_document_invalid/);
}));
