import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import sharp from 'sharp';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest=value=>createHash('sha256').update(value).digest('hex');
const pngBytes=data=>{if(typeof data!=='string'||!data.startsWith('data:image/png;base64,'))throw new Error('fixture_png_invalid');return Buffer.from(data.slice(22),'base64');};
// This selects the existing checkpoint layout. It is not an invented embedded
// schema field, and decoding never rewrites the checkpoint file.
export const ADMITTED_FIXTURE_SCHEMA='canvas-react-fixture-state-v1';
const restoreFail=gate=>{throw new Error('fixture_restore_admitted_'+gate);};
const requireRestore=(valid,gate)=>{if(!valid)restoreFail(gate);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const count=value=>Number.isSafeInteger(value)&&value>=0;
function validateOptionalPromotionTypes(run){
 if(Object.hasOwn(run,'sourcePromotions'))requireRestore(object(run.sourcePromotions),'source_promotions_invalid');
 for(const key of ['sourcePromotionPosts','sourcePromotionWrites'])if(Object.hasOwn(run,key))requireRestore(count(run[key]),'source_promotion_counters_invalid');
}
// Match core.ts canvasSnapshotText content checks. localProjectId belongs to
// the snapshot; the document UUID is the outer request/route identity.
function validFixtureCanvasSnapshot(snapshot){
 if(!object(snapshot)||!Array.isArray(snapshot.objects))return false;
 if(!snapshot.objects.every(value=>object(value)&&(value.type!=='image'||typeof value.src==='string'&&value.src.trim().length>0&&!/^(?:data:|blob:|local-canvas-asset:\/\/)/i.test(value.src.trim()))))return false;
 try{return JSON.stringify(snapshot).length<=512*1024;}catch{return false;}
}
export function readAdmittedFixtureCheckpoint(file,{expectedRun,expectedSchema,expectedSha256}={}){
 requireRestore(uuid.test(expectedRun??''),'expected_run_required');
 requireRestore(expectedSchema===ADMITTED_FIXTURE_SCHEMA,'schema_invalid');
 requireRestore(typeof expectedSha256==='string'&&/^[a-f0-9]{64}$/.test(expectedSha256),'expected_sha256_required');
 const raw=readFileSync(file);requireRestore(digest(raw)===expectedSha256,'raw_sha256_mismatch');
 let run;try{run=JSON.parse(raw.toString('utf8'));}catch{restoreFail('json_invalid');}
 requireRestore(object(run)&&run.runId===expectedRun&&run.userId==='canvas-probe-'+expectedRun&&run.brandId==='canvas-probe-brand-'+expectedRun,'run_identity_invalid');
 const required=['runId','userId','brandId','createdAt','originalPng','originalDigest','mounts','mountWrites','requests','saves','saveBodies','savePostsByIndex','document','documentAttempts','documentLogicalWrites','generationAdmissions','generationPosts','generationAttempts','requestReads','mediaReads','workspaceReads','controls','reports','events','escapedNetwork','nativeCandidates'];
 const allowed=new Set([...required,'sourcePromotions','sourcePromotionPosts','sourcePromotionWrites']);
 requireRestore(required.every(key=>Object.hasOwn(run,key))&&Object.keys(run).every(key=>allowed.has(key)),'layout_incomplete');
 validateOptionalPromotionTypes(run);
 requireRestore(!Number.isNaN(Date.parse(run.createdAt))&&['requests','saves','saveBodies','savePostsByIndex','controls','nativeCandidates'].every(key=>object(run[key])),'layout_invalid');
 requireRestore(['mountWrites','generationAttempts','reports','events','escapedNetwork'].every(key=>Array.isArray(run[key])),'layout_invalid');
 requireRestore(['mounts','documentAttempts','documentLogicalWrites','generationAdmissions','generationPosts','requestReads','mediaReads','workspaceReads'].every(key=>count(run[key]))&&run.mounts>0&&run.mountWrites.length===run.mounts,'counters_invalid');
 requireRestore(same(Object.keys(run.controls).sort(),['documentLoss','negativePause','readHold'])&&Object.values(run.controls).every(value=>typeof value==='boolean'),'controls_invalid');
 requireRestore(run.controls.negativePause===false&&run.controls.readHold===false&&!run.events.some(event=>event?.type==='provider-paused')&&run.generationAttempts.every(attempt=>attempt?.validationOutcome==='admitted'),'not_quiescent');
 requireRestore(run.generationAdmissions===1&&Object.keys(run.requests).length===1&&run.generationPosts===1&&run.generationAttempts.length===1,'admission_counters_invalid');
 requireRestore(run.mountWrites.every(value=>object(value)&&count(value.generationAdmissions)&&value.generationAdmissions<=run.generationAdmissions&&count(value.documentLogicalWrites)&&value.documentLogicalWrites<=run.documentLogicalWrites&&object(value.finalSavePosts)&&Object.values(value.finalSavePosts).every(count)),'mount_counters_invalid');
 requireRestore(run.events.every(event=>object(event)&&typeof event.type==='string'&&typeof event.at==='string')&&run.events.some(event=>event.type==='ready'&&event.info?.controller===true)&&run.events.some(event=>event.type==='product-mount')&&run.events.some(event=>event.type==='identity'&&typeof event.info?.localId==='string'),'canvas_events_incomplete');
 const baseline=run.events.find(event=>event.type==='baseline')?.info;
 requireRestore(object(baseline)&&['objects','history','selectedIds'].every(key=>Array.isArray(baseline[key]))&&count(baseline.historyIndex)&&typeof baseline.name==='string'&&object(baseline.view)&&['zoom','panX','panY'].every(key=>Number.isFinite(baseline.view[key])),'baseline_incomplete');
 requireRestore(run.reports.every(report=>report.type==='record'&&object(report.info)&&report.info.runId===run.runId)&&same(run.reports,run.events.filter(event=>event.type==='record').map(({at,...event})=>event)),'reports_invalid');
 requireRestore(run.escapedNetwork.every(value=>typeof value==='string')&&same(run.escapedNetwork,run.events.filter(event=>event.type==='network-blocked').map(event=>event.info?.url)),'network_events_invalid');
 requireRestore(run.documentAttempts>=run.documentLogicalWrites&&(run.document===null?run.documentLogicalWrites===0:object(run.document)&&uuid.test(run.document.id)&&run.document.ownerId===run.userId&&run.document.brandId===run.brandId&&validFixtureCanvasSnapshot(run.document.snapshot)&&run.document.snapshotVersion===1&&count(run.document.revision)&&run.documentLogicalWrites===run.document.revision+1),'document_invalid');
 if(run.document===null&&!Object.hasOwn(run,'sourcePromotions'))requireRestore(run.documentAttempts===0&&run.controls.documentLoss===true&&run.controls.readHold===false,'legacy_document_controls_invalid');
 return run;
}
async function restorePng(data,width,height,gate){
 let bytes;try{bytes=pngBytes(data);const meta=await sharp(bytes).metadata();requireRestore(bytes.toString('base64')===data.slice(22)&&meta.format==='png'&&meta.width===width&&meta.height===height,gate);await sharp(bytes).raw().toBuffer();}catch(error){if(error.message.startsWith('fixture_restore_admitted_'))throw error;restoreFail(gate);}return bytes;
}
export async function validateAdmittedFixtureCheckpoint(run,validators){
 requireRestore(validators&&['deriveSaveId','verifyProjectionRequest','validateNativeFrame','validateCanvasBinding'].every(key=>typeof validators[key]==='function'),'validators_unavailable');
 validateOptionalPromotionTypes(run);
 const original=await restorePng(run.originalPng,160,120,'original_png_invalid');requireRestore(digest(run.originalPng)===run.originalDigest,'original_digest_invalid');
 const baseline=run.events.find(event=>event.type==='baseline').info,source=baseline.objects.find(value=>value.id==='probe-source'),revision=source?.metadata?.sourceRevision;
 requireRestore(source?.src==='local-canvas-asset://canvas-react-native-'+run.runId&&source.metadata.sourceIdentity?.kind==='local-upload'&&source.metadata.sourceIdentity.hash===digest(original)&&revision?.algorithm==='sha-256'&&revision.hash===digest(original)&&revision.revision==='sha256:'+digest(original)&&revision.mimeType==='image/png'&&revision.width===160&&revision.height===120&&revision.sizeBytes===original.length,'source_metadata_invalid');
 const expectedSaves=new Set(),indices=new Set();
 for(const [requestId,request] of Object.entries(run.requests)){
  requireRestore(uuid.test(requestId)&&object(request)&&object(request.body)&&object(request.receipt)&&digest(JSON.stringify(request.body))===request.inputDigest,'request_fingerprint_invalid');
  const body=request.body,receipt=request.receipt,binding=validators.validateCanvasBinding(body.canvasProtectedBatchBinding),native=validators.validateNativeFrame(body.nativePrintFinalFrame,body.protectedEdit),projection=body.protectedOpenAIProjection,jobId='ai-'+requestId,model='gpt-image-1-mini';
  requireRestore(body.brandId===run.brandId&&body.count===4&&body.generationProvider==='openai'&&['canvas-partial-edit','canvas-inpaint'].includes(body.featureType)&&binding.requestId===requestId&&binding.scopeId===run.userId&&binding.brandId===run.brandId&&binding.featureType===body.featureType&&body.canvasProjectId===binding.canvasProjectId&&body.parentObjectId===binding.parentObjectId&&body.generation===binding.generation&&native.version==='canvas-protected-openai-contain-v1'&&same(native.canvasBatch,binding)&&native.original.digest===run.originalDigest&&native.original.width===160&&native.original.height===120,'request_identity_invalid');
  await validators.verifyProjectionRequest(projection,body);
  for(const [data,expected] of [[projection.primaryDataUrl,projection.projected.primaryDigest],[projection.guideDataUrl,projection.projected.guideDigest]]){requireRestore(digest(data)===expected,'projection_digest_invalid');await restorePng(data,projection.candidate.width,projection.candidate.height,'projection_png_invalid');}
  requireRestore(receipt.success===true&&receipt.state==='completed'&&receipt.recovery==='terminal'&&receipt.requestId===requestId&&receipt.jobId===jobId&&receipt.featureType===body.featureType&&receipt.provider==='openai'&&receipt.backendProvider==='openai-images-api'&&receipt.providerModel===model&&same(receipt.resolvedProvider,{provider:'openai',backendProvider:'openai-images-api',model,action:'edit-image',requestId})&&receipt.requestedCandidateCount===4&&receipt.persistedCandidateCount===4&&receipt.persistenceStatus==='completed'&&receipt.requiresProtectedComposite===true&&same(receipt.protectedEdit,body.protectedEdit)&&same(receipt.metadata.nativePrintFinalFrame,body.nativePrintFinalFrame)&&receipt.images?.length===4,'receipt_identity_invalid');
  const {primaryDataUrl,guideDataUrl,...compactProjection}=projection;requireRestore(same(receipt.metadata.protectedOpenAIProjection,compactProjection),'receipt_mapping_invalid');
  const attempts=run.generationAttempts.filter(attempt=>attempt.requestIdentity?.headerRequestId===requestId);requireRestore(attempts.filter(attempt=>attempt.validationOutcome==='admitted').length===1,'attempts_invalid');
  const references=[...body.imageUrls];references[0]=primaryDataUrl;references[body.protectedEdit.guideIndex]=guideDataUrl;
  const referenceProof=await Promise.all(references.map(async(data,index)=>{const meta=await sharp(pngBytes(data)).metadata();return{index,digest:digest(data),digestScheme:'sha256-data-url-utf8-v1',width:meta.width,height:meta.height};}));
  requireRestore(attempts.every(attempt=>same(attempt.requestIdentity,{headerRequestId:requestId,bindingRequestId:requestId,scopeId:run.userId,brandId:run.brandId,featureType:body.featureType,count:4,provider:'openai'})&&attempt.bodyDigest===request.inputDigest&&attempt.bodyDigestScheme==='sha256-json-stringify-utf8-v1'&&(attempt.validationOutcome!=='admitted'||same(attempt.providerReferences,referenceProof))),'attempt_identity_invalid');
  const candidates=run.nativeCandidates[requestId];requireRestore(candidates?.codec==='browser-native-canvas'&&same(candidates.geometry,projection.candidate)&&candidates.pngs?.length===4,'native_candidates_incomplete');
  for(let index=0;index<4;index++){
   const candidate=receipt.images[index],imageId=jobId+'-'+index,saveId=await validators.deriveSaveId(requestId,index),id='wa-'+saveId,raw=run.saves['raw:'+imageId],saved=run.saves[saveId],retained=run.saveBodies[saveId];
   requireRestore(candidate.candidateIndex===index&&candidate.imageId===imageId&&candidate.jobId===jobId&&candidate.storagePath==='generated-images/'+imageId&&candidate.provider==='openai'&&candidate.providerModel===model&&candidate.modelUsed===model&&candidate.width===projection.candidate.width&&candidate.height===projection.candidate.height&&candidate.imageUrl===`https://canvas-protected-media.invalid/${run.runId}/${imageId}.png`&&candidate.persistenceStatus==='completed','candidate_identity_invalid');
   await restorePng(candidates.pngs[index],candidate.width,candidate.height,'candidate_png_invalid');requireRestore(raw&&raw.imageUrl===candidates.pngs[index]&&same(Object.keys(raw),['imageUrl']),'raw_candidate_invalid');
   requireRestore(retained&&object(retained.body)&&digest(JSON.stringify(retained.body))===retained.fingerprint,'final_fingerprint_invalid');
   const input=retained.body,m=input.metadata,proof=m?.canvasProtectedComposite;
   requireRestore(input.requestId===saveId&&input.brandId===run.brandId&&input.featureType===body.featureType&&input.sourceJobId===jobId&&input.sourceStoragePath===null&&input.canvasProjectId===binding.canvasProjectId&&same(input.imageAI,{requestId,candidateIndex:index})&&m?.provider==='openai'&&m.backendProvider==='openai-images-api'&&m.providerModel===model&&m.providerRequestId===requestId&&m.providerJobId===jobId&&m.providerImageId===imageId&&m.providerStoragePath===candidate.storagePath&&m.batchId===jobId&&m.candidateIndex===index&&m.artifactRole==='protected-edit-final'&&m.protectedRegionComposited===true&&m.maskApplied===true&&same(m.outputSize,{width:160,height:120})&&same(m.protectedEdit,body.protectedEdit)&&same(m.nativePrintFinalFrame,body.nativePrintFinalFrame)&&same(m.protectedOpenAIProjection,compactProjection)&&same(m.canvasProtectedBatchBinding,binding),'final_identity_invalid');
   requireRestore(proof?.version===1&&proof.digestScheme==='sha256-data-url-utf8-v1'&&same(proof.binding,binding)&&proof.index===index&&same(proof.rawIdentity,{requestId,jobId,index,imageId,storagePath:candidate.storagePath,provider:'openai',model,width:candidate.width,height:candidate.height})&&proof.rawDigest===digest(raw.imageUrl)&&proof.finalDigest===digest(input.imageUrl)&&proof.finalId===id&&proof.width===160&&proof.height===120,'final_proof_invalid');
   await restorePng(input.imageUrl,160,120,'final_png_invalid');requireRestore(saved?.success===true&&same(saved.remote,{jobId:id,imageId:id,storagePath:'generated-images/'+id})&&same(saved.metadata,m)&&saved.imageUrl===input.imageUrl,'saved_identity_invalid');
   requireRestore(run.savePostsByIndex[index]===1,'final_counters_invalid');expectedSaves.add('raw:'+imageId);expectedSaves.add(saveId);indices.add(String(index));
  }
 }
 requireRestore(same(Object.keys(run.nativeCandidates).sort(),Object.keys(run.requests).sort())&&same(Object.keys(run.savePostsByIndex).sort(),[...indices].sort())&&Object.keys(run.saveBodies).length===run.generationAdmissions*4&&run.generationAttempts.every(attempt=>Object.hasOwn(run.requests,attempt.requestIdentity?.headerRequestId)),'ledgers_incomplete');
 const promotions=Object.hasOwn(run,'sourcePromotions')?run.sourcePromotions:{};requireRestore(object(promotions),'source_promotions_invalid');
 for(const [id,entry] of Object.entries(promotions)){
  const input=entry.body,bytes=await restorePng(input?.imageUrl,160,120,'source_promotion_png_invalid'),r=input.metadata?.sourceRevision,remote={jobId:'wa-'+id,imageId:'wa-'+id,storagePath:'generated-images/wa-'+id};
  requireRestore(uuid.test(id)&&entry.ownerId===run.userId&&entry.brandId===run.brandId&&input.requestId===id&&input.brandId===run.brandId&&input.featureType==='canvas-source-upload'&&input.sourceStoragePath===null&&input.imageAI===undefined&&input.prompt===null&&typeof input.title==='string'&&input.title.length>0&&entry.fingerprint===digest(JSON.stringify(input))&&entry.rawSha256===digest(bytes)&&entry.sizeBytes===bytes.length&&input.metadata.sourceDigestScheme==='sha256-raw-bytes-v1'&&same(input.metadata.sourceIdentity,{kind:'local-upload',hash:digest(bytes)})&&r?.algorithm==='sha-256'&&r.hash===digest(bytes)&&r.revision==='sha256:'+digest(bytes)&&r.mimeType==='image/png'&&r.width===160&&r.height===120&&r.sizeBytes===bytes.length&&same(entry.remote,remote)&&same(run.saves[id],{success:true,remote,imageUrl:input.imageUrl}),'source_promotion_identity_invalid');expectedSaves.add(id);
 }
 const promotionPosts=Object.hasOwn(run,'sourcePromotionPosts')?run.sourcePromotionPosts:0,promotionWrites=Object.hasOwn(run,'sourcePromotionWrites')?run.sourcePromotionWrites:0;
 requireRestore(count(promotionPosts)&&count(promotionWrites)&&promotionWrites===Object.keys(promotions).length&&promotionPosts>=promotionWrites&&same(Object.keys(run.saves).sort(),[...expectedSaves].sort()),'save_ledger_invalid');
 // Preserve the absent legacy ledger. The existing source-upload handler
 // initializes an empty ledger only when a later authorized upload runs.
 return run;
}
export class CanvasReactFixture {
 constructor(output){this.output=output;this.runs=new Map();}
 checkpoint(run){if(!this.output)return;mkdirSync(this.output,{recursive:true});const file=resolve(this.output,run.runId+'-state.json'),tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(run,null,2)+'\n');renameSync(tmp,file);}
 async dispatch(runId,path,method,body,headers={}){
  if(!uuid.test(runId))return[400,{error:'fixture_run_invalid'}];let run=this.runs.get(runId);
  const reply=(status,payload)=>{this.checkpoint(run);return[status,payload];};
  if(path==='/bootstrap'&&method==='POST'){
   if(!run){const original=pngBytes(body.originalPng),meta=await sharp(original).metadata();if(meta.width!==160||meta.height!==120)throw new Error('fixture_original_geometry_invalid');run={runId,userId:'canvas-probe-'+runId,brandId:'canvas-probe-brand-'+runId,createdAt:new Date().toISOString(),originalPng:body.originalPng,originalDigest:digest(body.originalPng),mounts:0,mountWrites:[],requests:{},saves:{},saveBodies:{},savePostsByIndex:{},document:null,documentAttempts:0,documentLogicalWrites:0,generationAdmissions:0,generationPosts:0,generationAttempts:[],requestReads:0,mediaReads:0,workspaceReads:0,controls:{documentLoss:false,readHold:false,negativePause:false},reports:[],events:[],escapedNetwork:[]};this.runs.set(runId,run);}
   run.mounts++;run.mountWrites.push({generationAdmissions:run.generationAdmissions,finalSavePosts:{...run.savePostsByIndex},documentLogicalWrites:run.documentLogicalWrites});if(run.mounts>1)run.controls.readHold=false;return reply(200,run);
  }
  if(!run)return[404,{error:'fixture_run_not_found'}];
  if(path==='/candidate-pngs'&&method==='POST'){const mapping=body.geometry;if(!uuid.test(body.requestId)||!Number.isInteger(mapping?.width)||!Number.isInteger(mapping?.height)||mapping.width<1||mapping.height<1||mapping.width>4096||mapping.height>4096||body.pngs?.length!==4)throw new Error('fixture_native_candidates_invalid');for(const png of body.pngs){const meta=await sharp(pngBytes(png)).metadata();if(meta.width!==mapping.width||meta.height!==mapping.height)throw new Error('fixture_native_candidate_geometry_invalid');}run.nativeCandidates??={};run.nativeCandidates[body.requestId]={geometry:mapping,pngs:body.pngs,codec:'browser-native-canvas'};return reply(200,{ok:true});}
  if(path==='/state')return[200,run];
  if(path==='/control'&&method==='POST'){if(body.kind==='document-loss'){run.controls.documentLoss=true;}else if(body.kind==='negative-pause'){run.controls.negativePause=true;}else return reply(400,{error:'fixture_control_invalid'});return reply(200,{ok:true});}
  if(path==='/event'&&method==='POST'){if(!['record','recovery-ui','source-mutated','note-added','ack-cleanup-observed','network-blocked','baseline','identity','reload','ready','error','product-mount'].includes(body.type))return reply(400,{error:'fixture_event_invalid'});run.events.push({...body,at:new Date().toISOString()});if(body.type==='network-blocked')run.escapedNetwork.push(body.info?.url);if(body.type==='record'){run.reports.push(body);if(this.output)writeFileSync(resolve(this.output,runId+'-report-'+Date.now()+'.json'),JSON.stringify(body,null,2)+'\n');}return reply(200,{ok:true});}
  if(path==='/api/auth/get-session')return reply(200,{user:{id:run.userId,email:'fixture@example.test',name:'Local Canvas fixture',emailVerified:true,createdAt:run.createdAt},session:{token:'fixture-not-a-production-credential-'+runId,expiresAt:new Date(Date.now()+3600000).toISOString()}});
  if(path==='/api/auth/ok')return[200,{ok:true}];
  const attempt=path==='/v1/provider-actions/edit-image'&&method==='POST'?{requestIdentity:{headerRequestId:headers['idempotency-key']??null,bindingRequestId:body?.canvasProtectedBatchBinding?.requestId??null,scopeId:body?.canvasProtectedBatchBinding?.scopeId??null,brandId:body?.brandId??null,featureType:body?.featureType??null,count:body?.count??null,provider:body?.generationProvider??null},bodyDigest:digest(JSON.stringify(body??null)),bodyDigestScheme:'sha256-json-stringify-utf8-v1',validationOutcome:'pending',at:new Date().toISOString()}:null;
  if(attempt){run.generationPosts++;(run.generationAttempts??=[]).push(attempt);this.checkpoint(run);}
  const rejectAttempt=error=>{if(attempt){attempt.validationOutcome='rejected';attempt.error=error;this.checkpoint(run);}};
  if(path.startsWith('/v1/')&&headers.authorization!==`Bearer fixture-not-a-production-credential-${runId}`){rejectAttempt('fixture_auth_required');return reply(401,{error:'fixture_auth_required'});}
  if(path==='/v1/provider-actions/edit-image'&&method==='POST'){
   try{const requestId=headers['idempotency-key'];if(!uuid.test(requestId)||body.brandId!==run.brandId||body.count!==4||!['canvas-partial-edit','canvas-inpaint'].includes(body.featureType)||body.generationProvider!=='openai'||body.canvasProtectedBatchBinding?.requestId!==requestId||body.canvasProtectedBatchBinding.scopeId!==run.userId||body.canvasProtectedBatchBinding.brandId!==body.brandId||body.canvasProtectedBatchBinding.featureType!==body.featureType||body.canvasProtectedBatchBinding.requestedCandidateCount!==4)throw new Error('fixture_protected_request_binding_invalid');
   if(run.requests[requestId]){if(run.requests[requestId].inputDigest!==digest(JSON.stringify(body))){rejectAttempt('idempotency_conflict');return reply(409,{error:'idempotency_conflict'});}attempt.validationOutcome='existing-admission-readback';return reply(200,run.requests[requestId].receipt);}
   const mapping=body.protectedOpenAIProjection,{primaryDataUrl,guideDataUrl,...projection}=mapping;for(const [png,expected]of [[primaryDataUrl,mapping.projected.primaryDigest],[guideDataUrl,mapping.projected.guideDigest]]){if(digest(png)!==expected)throw new Error('fixture_projection_digest_invalid');const meta=await sharp(pngBytes(png)).metadata();if(meta.width!==mapping.candidate.width||meta.height!==mapping.candidate.height)throw new Error('fixture_projection_geometry_invalid');}
   const guideIndex=body.protectedEdit?.guideIndex;if(!Number.isSafeInteger(guideIndex)||guideIndex<1||guideIndex>=body.imageUrls?.length)throw new Error('fixture_prepared_guide_index_invalid');
   for(const [data,expected]of [[body.imageUrls[0],mapping.prepared.primaryDigest],[body.imageUrls[guideIndex],mapping.prepared.guideDigest]]){if(digest(data)!==expected)throw new Error('fixture_prepared_digest_invalid');const meta=await sharp(pngBytes(data)).metadata();if(meta.format!=='png'||meta.width!==mapping.prepared.width||meta.height!==mapping.prepared.height)throw new Error('fixture_prepared_geometry_invalid');}
   if(!this.verifyProjectionRequest||!this.validateNativeFrame)throw new Error('fixture_production_projection_validator_unavailable');
   await this.verifyProjectionRequest(mapping,body);const native=this.validateNativeFrame(body.nativePrintFinalFrame,body.protectedEdit);
   if(native.version!=='canvas-protected-openai-contain-v1'||JSON.stringify(native.canvasBatch)!==JSON.stringify(this.validateCanvasBinding(body.canvasProtectedBatchBinding))||native.candidateGeometry.width!==mapping.candidate.width||native.candidateGeometry.height!==mapping.candidate.height)throw new Error('fixture_native_mapping_invalid');
   const providerReferences=[...body.imageUrls];providerReferences[0]=primaryDataUrl;providerReferences[guideIndex]=guideDataUrl;
   attempt.providerReferences=await Promise.all(providerReferences.map(async(png,index)=>{const meta=await sharp(pngBytes(png)).metadata();return{index,digest:digest(png),digestScheme:'sha256-data-url-utf8-v1',width:meta.width,height:meta.height};}));

   const nativeCandidates=run.nativeCandidates?.[requestId];if(!nativeCandidates||nativeCandidates.geometry.width!==mapping.candidate.width||nativeCandidates.geometry.height!==mapping.candidate.height)throw new Error('fixture_native_candidates_required');const model='gpt-image-1-mini',jobId='ai-'+requestId,images=[];for(let index=0;index<4;index++){const imageId=jobId+'-'+index,png=pngBytes(nativeCandidates.pngs[index]);images.push({candidateIndex:index,imageId,jobId,storagePath:'generated-images/'+imageId,provider:'openai',providerModel:model,modelUsed:model,width:mapping.candidate.width,height:mapping.candidate.height,imageUrl:`https://canvas-protected-media.invalid/${runId}/${imageId}.png`,persistenceStatus:'completed'});run.saves['raw:'+imageId]={imageUrl:'data:image/png;base64,'+png.toString('base64')};}
   const receipt={success:true,state:'completed',recovery:'terminal',requestId,jobId,featureType:body.featureType,provider:'openai',backendProvider:'openai-images-api',providerModel:model,resolvedProvider:{provider:'openai',backendProvider:'openai-images-api',model,action:'edit-image',requestId},requestedCandidateCount:4,persistedCandidateCount:4,persistenceStatus:'completed',requiresProtectedComposite:true,protectedEdit:body.protectedEdit,metadata:{nativePrintFinalFrame:body.nativePrintFinalFrame,protectedOpenAIProjection:projection},images};run.generationAdmissions++;run.requests[requestId]={body,inputDigest:digest(JSON.stringify(body)),receipt};attempt.validationOutcome='admitted';this.checkpoint(run);if(run.controls.negativePause){run.events.push({type:'provider-paused',requestId});this.checkpoint(run);await new Promise(resolve=>setTimeout(resolve,4500));}return reply(200,receipt);
   }catch(error){rejectAttempt(error.message);throw error;}
  }
  if(path.startsWith('/v1/image-ai/requests/')){run.requestReads++;const value=run.requests[path.split('/').at(-1)];return reply(value?200:404,value?.receipt??{error:'image_request_not_found'});}
  if(path==='/v1/workspace-artifacts'&&method==='POST'&&body.featureType==='canvas-source-upload'){
   run.sourcePromotionPosts=(run.sourcePromotionPosts??0)+1;
   if(!uuid.test(body.requestId)||body.brandId!==run.brandId||body.sourceStoragePath!==null||body.imageAI!==undefined||typeof body.title!=='string'||!body.title||body.prompt!==null)throw new Error('fixture_source_promotion_binding_invalid');
   const bytes=pngBytes(body.imageUrl),meta=await sharp(bytes).metadata(),m=body.metadata,r=m?.sourceRevision,hash=digest(bytes);
   if(m?.sourceDigestScheme!=='sha256-raw-bytes-v1'||m.sourceIdentity?.kind!=='local-upload'||m.sourceIdentity.hash!==hash||r?.algorithm!=='sha-256'||r.hash!==hash||r.revision!==`sha256:${hash}`||r.sizeBytes!==bytes.length||r.width!==meta.width||r.height!==meta.height||r.mimeType!=='image/png'||meta.format!=='png')throw new Error('fixture_source_promotion_bytes_invalid');
   const fingerprint=digest(JSON.stringify(body));run.sourcePromotions??={};const prior=run.sourcePromotions[body.requestId];
   if(prior&&prior.fingerprint!==fingerprint)return reply(409,{error:'workspace_artifact_idempotency_conflict'});
   const id='wa-'+body.requestId,remote={jobId:id,imageId:id,storagePath:'generated-images/'+id};
   if(!prior){run.sourcePromotions[body.requestId]={ownerId:run.userId,brandId:run.brandId,fingerprint,body,rawSha256:hash,sizeBytes:bytes.length,remote};run.saves[body.requestId]={success:true,remote,imageUrl:body.imageUrl};run.sourcePromotionWrites=(run.sourcePromotionWrites??0)+1;}
   // Generic production receipts omit metadata and image bytes. Media returns raw PNG.
   return reply(200,{success:true,remote});
  }
  if(path==='/v1/workspace-artifacts'&&method==='POST'){
   if(body.sourceStoragePath){const saved=Object.values(run.saves).find(item=>item.remote?.storagePath===body.sourceStoragePath);return reply(saved?200:404,saved??{error:'workspace_artifact_not_found'});}
   const request=run.requests[body.imageAI?.requestId],index=body.imageAI?.candidateIndex;if(!request||!Number.isInteger(index)||index<0||index>3||body.brandId!==run.brandId)throw new Error('fixture_final_binding_invalid');
   const id='wa-'+body.requestId; // Check the real deterministic request helper before accepting final bytes.
   if(!uuid.test(body.requestId)||body.metadata.providerImageId!==request.receipt.images[index].imageId||body.metadata.providerModel!==request.receipt.resolvedProvider.model||body.metadata.canvasProtectedBatchBinding?.requestId!==request.receipt.requestId)throw new Error('fixture_final_lineage_invalid');
   const expected=await this.deriveSaveId(request.receipt.requestId,index);if(body.requestId!==expected)throw new Error('fixture_final_uuid_invalid');
   const size=await sharp(pngBytes(body.imageUrl)).metadata(),native=request.body.nativePrintFinalFrame.original;if(size.width!==native.width||size.height!==native.height)throw new Error('fixture_final_native_geometry_invalid');
   const fingerprint=digest(JSON.stringify(body));run.savePostsByIndex[index]=(run.savePostsByIndex[index]??0)+1;if(run.saveBodies[body.requestId]&&run.saveBodies[body.requestId].fingerprint!==fingerprint)return reply(409,{error:'workspace_artifact_idempotency_conflict'});run.saveBodies[body.requestId]={body,fingerprint};const saved={success:true,remote:{jobId:id,imageId:id,storagePath:'generated-images/'+id},metadata:body.metadata,imageUrl:body.imageUrl};run.saves[body.requestId]=saved;return reply(200,saved);
  }
  if(path.startsWith('/v1/workspace-artifacts/')){run.workspaceReads++;const requestId=path.split('/').at(-1);if(run.sourcePromotions?.[requestId])return reply(200,{success:true,remote:run.sourcePromotions[requestId].remote});const saved=run.saves[requestId];return reply(saved?200:404,saved??{error:'workspace_artifact_not_found'});}
  const pathOnly=path.split('?')[0];
  if(pathOnly==='/v1/media/read'){const q=new URL('http://fixture'+path).searchParams,p=q.get('path'),saved=Object.values(run.saves).find(v=>v.remote?.storagePath===p),raw=run.saves['raw:'+p?.replace(/^generated-images\//,'')];run.mediaReads++;if(q.get('bucket')!=='generated-images'||q.get('expiresIn')!=='3600')throw new Error('fixture_media_query_invalid');return reply(saved||raw?200:404,saved||raw?{provider:'cloudflare_r2',bucket:'generated-images',objectPath:p,url:`https://canvas-protected-media.invalid/${runId}/${p.split('/').at(-1)}.png`}:{error:'not_found'});}
  if(pathOnly==='/v1/canvas-documents'&&method==='GET')return reply(200,run.document?[run.document]:[]);
  if(pathOnly==='/v1/canvas-documents'&&method==='POST'||pathOnly.startsWith('/v1/canvas-documents/')&&method==='PATCH'){
   run.documentAttempts++;const id=method==='POST'?body.id:pathOnly.split('/').at(-1);if(!uuid.test(id)||method==='POST'&&body.brand_id!==run.brandId)throw new Error('fixture_document_identity_invalid');if(!validFixtureCanvasSnapshot(body.snapshot))throw new Error('fixture_document_snapshot_invalid');if(method==='POST'&&run.document)return reply(409,{error:'document_exists'});if(method==='PATCH'&&(!run.document||run.document.id!==id||body.expected_revision!==run.document.revision))return reply(409,{error:'revision_conflict'});
   const now=new Date().toISOString();run.document={id,ownerId:run.userId,brandId:run.brandId,title:body.title,snapshot:body.snapshot,snapshotVersion:1,revision:method==='POST'?0:run.document.revision+1,createdAt:run.document?.createdAt??now,updatedAt:now};run.documentLogicalWrites++;
   if(run.controls.documentLoss){run.controls.documentLoss=false;run.controls.readHold=true;return reply(503,{error:'fixture_document_commit_response_lost',concurrentFixtureNote:true});}return reply(200,run.document);
  }
  if(pathOnly.startsWith('/v1/canvas-documents/')&&method==='GET'){if(run.controls.readHold)return reply(503,{error:'fixture_immediate_document_readback_unavailable'});return reply(run.document&&run.document.id===pathOnly.split('/').at(-1)?200:404,run.document??{error:'not_found'});}
  if(['/v1/generated-images','/v1/folders','/v1/image-folders','/v1/tags','/v1/canvas-projects','/v1/style-presets','/v1/workspace-execution-steps'].includes(pathOnly)&&method==='GET')return reply(200,[]);
  if(pathOnly==='/v1/brands'&&method==='GET')return reply(200,[{id:run.brandId,owner_id:run.userId,name:'Heavy Chain Workspace',brand_colors:[],logo_url:null,tone_description:null,target_audience:null,created_at:run.createdAt,updated_at:run.createdAt}]);
  if(pathOnly==='/v1/profile'&&method==='GET')return reply(200,{id:run.userId,email:'fixture@example.test',name:'Local fixture',avatar_url:null,language:'ja',is_admin:false,created_at:run.createdAt,updated_at:run.createdAt});
  return reply(404,{error:'fixture_undeclared_route'});
 }
 media(runId,name){const run=this.runs.get(runId);if(!run)return null;if(name==='original.png')return pngBytes(run.originalPng);const id=name.replace(/\.png$/,''),value=run.saves['raw:'+id]??Object.values(run.saves).find(item=>item.remote?.imageId===id);return value?pngBytes(value.imageUrl):null;}
}
export async function startCanvasReactProbe({port=0,output,restoreState,restoreAdmittedState,expectedRun,expectedSchema,expectedSha256}={}){
 if(restoreState&&restoreAdmittedState)throw new Error('fixture_restore_modes_exclusive');
 if(!restoreAdmittedState&&[expectedRun,expectedSchema,expectedSha256].some(value=>value!==undefined))throw new Error('fixture_restore_admitted_mode_required');
 let admitted;
 if(restoreAdmittedState){requireRestore(Number.isInteger(port)&&port>0&&port<=65535,'exact_port_required');admitted=readAdmittedFixtureCheckpoint(restoreAdmittedState,{expectedRun,expectedSchema,expectedSha256});}
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),fixture=new CanvasReactFixture(output);
 if(restoreState){const run=JSON.parse(readFileSync(restoreState,'utf8'));if(!uuid.test(run.runId)||run.userId!=='canvas-probe-'+run.runId||run.brandId!=='canvas-probe-brand-'+run.runId||run.generationAdmissions!==0||run.documentLogicalWrites!==0||Object.keys(run.requests??{}).length||run.document!==null||run.events?.some(e=>e.type==='baseline'))throw new Error('fixture_restore_pre_mount_state_required');fixture.runs.set(run.runId,run);}
 const values={VITE_CLOUDFLARE_API_BASE_URL:'https://canvas-protected-api.invalid',VITE_CLOUDFLARE_API_ENABLED:'true',VITE_MEDIA_GATEWAY_URL:'https://canvas-protected-api.invalid',VITE_MEDIA_PROVIDER_ORDER:'cloudflare_r2',VITE_GENERATION_PROVIDER:'openai',VITE_DEFAULT_GENERATION_MODEL:'gpt-image-1-mini'};
 const vite=await createServer({root,configFile:false,envFile:false,envPrefix:[],optimizeDeps:{entries:['scripts/browser/canvas-protected-batch-react-probe.html']},plugins:[{name:'fixture-no-external-css',enforce:'pre',transform(code,id){if(id.split('?')[0]===resolve(root,'src/index.css'))return code.replace(/^@import url\('https:[^\n]+\n/,'');}},react()],define:Object.fromEntries(Object.entries(values).map(([key,value])=>['import.meta.env.'+key,JSON.stringify(value)])),server:{host:'127.0.0.1',port,strictPort:port!==0,hmr:false},appType:'custom'});
 const contract=await vite.ssrLoadModule('/src/lib/protectedImageEditContract.ts');fixture.deriveSaveId=contract.protectedImageSaveRequestId;
 const projection=await vite.ssrLoadModule('/src/lib/protectedOpenAIProjection.ts'),native=await vite.ssrLoadModule('/src/lib/nativePrintFinalFrame.ts');fixture.verifyProjectionRequest=projection.verifyProtectedOpenAIProjectionRequest;fixture.validateNativeFrame=native.validateNativePrintFinalFrame;fixture.validateCanvasBinding=native.validateCanvasProtectedBatchBinding;
 if(admitted){try{await validateAdmittedFixtureCheckpoint(admitted,fixture);fixture.runs.set(admitted.runId,admitted);}catch(error){await vite.close();throw error;}}
 vite.middlewares.use(async(req,res,next)=>{const origin='http://'+req.headers.host,url=new URL(req.url,origin),json=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
  if(url.pathname==='/__canvas-react-sw.js'){res.writeHead(200,{'content-type':'application/javascript','service-worker-allowed':'/','cache-control':'no-store'});return res.end(readFileSync(resolve(root,'scripts/browser/canvas-protected-batch-react-probe-sw.js')));}
  if(url.pathname.startsWith('/__canvas-react/')){try{const[, ,runId,...parts]=url.pathname.split('/'),path='/'+parts.join('/');if(path.startsWith('/png/')){const data=fixture.media(runId,path.slice(5));res.writeHead(data?200:404,{'content-type':'image/png','cache-control':'no-store','access-control-allow-origin':'*'});return res.end(data??'');}let body; if(!['GET','HEAD'].includes(req.method)){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>64*1024*1024)throw new Error('fixture_body_too_large');chunks.push(chunk);}body=JSON.parse(Buffer.concat(chunks).toString());}const[status,payload]=await fixture.dispatch(runId,path+url.search,req.method,body,req.headers);return json(status,payload);}catch(error){return json(500,{error:error.message});}}
  if(url.pathname==='/api/auth/get-session'||url.pathname==='/api/auth/ok'){const[status,payload]=await fixture.dispatch(req.headers['x-fixture-run'],url.pathname,'GET');return json(status,payload);}
  if(url.pathname.startsWith('/v1/')||url.pathname.startsWith('/api/'))return json(403,{error:'fixture_undeclared_loopback_api'});
  if(url.pathname==='/__canvas-react-probe'||url.pathname.startsWith('/canvas/')){const html=await vite.transformIndexHtml(url.pathname,readFileSync(resolve(root,'scripts/browser/canvas-protected-batch-react-probe.html'),'utf8'));res.setHeader('content-type','text/html');res.setHeader('cache-control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://canvas-protected-media.invalid; connect-src 'self' data: blob: https://canvas-protected-media.invalid; font-src 'self' data:; object-src 'none'; base-uri 'self'");return res.end(html);}next();
 });
 try{await vite.listen();}catch(error){await vite.close();throw error;}
 const address=vite.httpServer.address();const origin='http://127.0.0.1:'+address.port;return{vite,fixture,origin,readyUrl:origin+'/__canvas-react-probe'+(admitted?'?run='+admitted.runId:'')};
}
export function parseCanvasReactProbeOptions(args){
 const flags={'--output':'output','--port':'port','--restore-state':'restoreState','--restore-admitted-state':'restoreAdmittedState','--expected-run':'expectedRun','--expected-schema':'expectedSchema','--expected-sha256':'expectedSha256'},options={};
 for(let index=0;index<args.length;index+=2){const key=flags[args[index]],value=args[index+1];if(!key||Object.hasOwn(options,key)||!value||value.startsWith('--'))throw new Error('fixture_cli_argument_invalid');options[key]=key==='port'?Number(value):['output','restoreState','restoreAdmittedState'].includes(key)?resolve(value):value;}
 if(options.port!==undefined&&(!Number.isInteger(options.port)||options.port<0||options.port>65535))throw new Error('fixture_cli_port_invalid');
 if(options.restoreState&&options.restoreAdmittedState)throw new Error('fixture_restore_modes_exclusive');
 return options;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const server=await startCanvasReactProbe(parseCanvasReactProbeOptions(process.argv.slice(2)));process.stdout.write(JSON.stringify({readyUrl:server.readyUrl,pid:process.pid,loopback:true,browserAcceptance:'pending_root_companion'})+'\n');}
