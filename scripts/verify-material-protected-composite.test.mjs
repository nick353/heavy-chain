import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {deflateSync,inflateSync} from 'node:zlib';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
const vite = await createServer({ configFile:false,envFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true} });
const material = await vite.ssrLoadModule('/src/lib/materialProtectedComposite.ts');
const edit = await vite.ssrLoadModule('/src/lib/cloudflareProtectedImageEdit.ts');
const openai = await vite.ssrLoadModule('/src/lib/protectedOpenAIImageEdit.ts');
const projectionModule = await vite.ssrLoadModule('/src/lib/protectedOpenAIProjection.ts');
const projectionPreparation = await vite.ssrLoadModule('/src/lib/prepareProtectedOpenAIProjection.ts');
const persistence = await vite.ssrLoadModule('/src/lib/providerResultPersistence.ts');
const local = await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
const contract = await vite.ssrLoadModule('/src/lib/protectedImageEditContract.ts');
const originalGlobals = { window:globalThis.window,Image:globalThis.Image,ImageData:globalThis.ImageData,document:globalThis.document,fetch:globalThis.fetch };
after(async()=>{Object.assign(globalThis,originalGlobals);await vite.close();});
const encode = (width,height,pixels) => {const header=Buffer.alloc(24);header.set([137,80,78,71,13,10,26,10]);header.write('IHDR',12);header.writeUInt32BE(width,16);header.writeUInt32BE(height,20);return 'data:image/png;base64,'+Buffer.concat([header,deflateSync(Buffer.from(JSON.stringify({width,height,pixels:[...pixels]})))]).toString('base64');};
const decode = url => JSON.parse(inflateSync(Buffer.from(url.split(',')[1],'base64').subarray(24)).toString());
let savedPng;
const readSavedImage=async()=> 'https://final.test/fixture';
let decodes = 0, encodes = 0;
function setup() {
 const store=new Map();
 globalThis.fetch=async url=>{assert(String(url).startsWith('https://final.test/'));if(!savedPng)throw new Error('missing_saved_png');return new Response(Buffer.from(savedPng.split(',')[1],'base64'),{headers:{'content-type':'image/png'}});};
 globalThis.window={localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},dispatchEvent(){}};
 globalThis.ImageData=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
 globalThis.Image=class {set src(url){decodes++;try {const v=decode(url);Object.assign(this,{naturalWidth:v.width,naturalHeight:v.height,width:v.width,height:v.height,pixels:v.pixels});queueMicrotask(()=>this.onload());}catch{queueMicrotask(()=>this.onerror());}}};
 globalThis.document={createElement:()=>{
   const canvas={width:0,height:0,pixels:[]};
   const context={fillRect(x,y,w,h){if(!canvas.pixels.length)canvas.pixels=new Uint8ClampedArray(canvas.width*canvas.height*4);for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)canvas.pixels.set([0,0,0,255],(j*canvas.width+i)*4);},clearRect(){canvas.pixels=new Uint8ClampedArray(canvas.width*canvas.height*4);},
    drawImage(image,...args){
      const [sx,sy,sw,sh,dx,dy,width,height]=args.length===8?args:[0,0,image.width,image.height,args[0]??0,args[1]??0,args[2]??image.width,args[3]??image.height];
      if(!canvas.pixels.length) canvas.pixels=new Uint8ClampedArray(canvas.width*canvas.height*4);
      for(let y=Math.max(0,Math.floor(dy));y<Math.min(canvas.height,Math.ceil(dy+height));y++)for(let x=Math.max(0,Math.floor(dx));x<Math.min(canvas.width,Math.ceil(dx+width));x++) {
       if(x+.5<dx||x+.5>=dx+width||y+.5<dy||y+.5>=dy+height)continue;
       const at=(Math.min(image.height-1,Math.floor(sy+(y+.5-dy)/height*sh))*image.width+Math.min(image.width-1,Math.floor(sx+(x+.5-dx)/width*sw)))*4;
       canvas.pixels.set(image.pixels.slice(at,at+4),(y*canvas.width+x)*4);
      }
    },getImageData:()=>({data:new Uint8ClampedArray(canvas.pixels)}),putImageData(image){canvas.pixels=new Uint8ClampedArray(image.data);}};
   canvas.getContext=()=>context;canvas.toDataURL=()=>{encodes++;return encode(canvas.width,canvas.height,canvas.pixels);};return canvas;
 }};
 decodes=encodes=0;return store;
}
const sourcePixels=[3,5,9,255,9,6,2,0,255,0,0,255,71,81,91,255];
const providerPixels=[200,220,240,255,200,220,240,255,0,0,255,255,10,20,30,255];
const maskPixels=[0,0,0,255,0,0,0,255,0,0,0,128,0,0,0,0];
async function fixture(feature='fabric-image') {
 setup(); const requestId=crypto.randomUUID();const source=encode(4,1,sourcePixels);const mask=encode(4,1,maskPixels);const candidate=encode(4,1,providerPixels);
 const stage=await material.prepareMaterialComposite({brandId:'brand',scopeId:'alice',featureType:`lightchain-${feature}`,title:'initial',prompt:'fixture',metadata:{mode:feature,generationInputSignature:'signature',sourceWorkspace:'lightchain-material-workbench-provider-result'}},source,mask,requestId);
 const state=await material.validateMaterialCompositeState(stage.metadata.protectedMaterialComposite);
 const binding={version:1,stateArtifactId:stage.id,requestId,brandId:'brand',scopeId:'alice',generationInputSignature:'signature'};
 const plan={mode:contract.PROTECTED_IMAGE_EDIT_MODE,sourceWidth:4,sourceHeight:1,sourceSha256:state.original.digest,maskSha256:state.mask.digest,guideIndex:1,coveragePercent:30};
 const prepared={body:{brandId:'brand',featureType:`lightchain-${feature}`,prompt:'fixture'},plan,sourceImageUrl:source,maskDataUrl:mask,materialRecoveryBinding:binding};
 const receipt={requestId,success:true,state:'completed',recovery:'terminal',jobId:`ai-${requestId}`,requestedCandidateCount:1,protectedEdit:plan,
  provider:'workers_ai',backendProvider:'cloudflare-workers-ai',providerModel:'@cf/black-forest-labs/flux-2-klein-4b',featureType:`lightchain-${feature}`,
  images:[{candidateIndex:0,imageId:`ai-${requestId}-0`,jobId:`ai-${requestId}`,storagePath:`generated-images/ai-${requestId}-0`,imageUrl:candidate}]};
 const lifecycle=await material.createMaterialProtectedLifecycle(binding,prepared,{brandId:'brand',userId:'alice'},async()=>{});
 return{requestId,source,mask,candidate,stage,binding,prepared,receipt,lifecycle};
}
const missing=()=>{throw new Error('cloudflare_api_404_workspace_artifact_not_found');};
const remoteFor=input=>{savedPng=input.imageUrl;return {success:true,remote:{jobId:'wa-'+input.requestId,imageId:'wa-'+input.requestId,storagePath:'generated-images/wa-'+input.requestId},metadata:input.metadata};};
for(const feature of ['fabric-image','printing-image']) test(`${feature}: native dimensions, exact all-channel protected pixels, single premultiplied feather and canonical consumer bytes`,async()=>{
 const f=await fixture(feature);let saveInput;
 const result=await edit.finalizeProtectedCloudflareEdit({...f,assertCurrent:async()=>{},save:async input=>{saveInput=input;return remoteFor(input);},call:async path=>path.startsWith('/v1/media/read?')?{url:'https://final.test/fixture'}:missing()});
 const id=saveInput.requestId;const read=local.findWorkspaceArtifactPersisted('brand',`wa-${id}`,'alice');assert(read.ok&&read.artifact);
 const state=await material.validateMaterialCompositeArtifact(read.artifact);assert.equal(state.stage,'saved');assert.equal(read.artifact.id,result.imageId);
 const pixels=decode(read.artifact.imageUrl);assert.equal(pixels.width,4);assert.equal(pixels.height,1);
 assert.deepEqual(pixels.pixels,[3,5,9,255,9,6,2,0,128,0,127,255,10,20,30,255]);
 assert.equal(saveInput.imageUrl,read.artifact.imageUrl);assert.equal(state.final.digest,await contract.protectedImageDigest(saveInput.imageUrl));
 assert.equal(state.providerLineage.imageId,`ai-${f.requestId}-0`);assert.notEqual(state.providerLineage.imageId,read.artifact.id);
 assert.equal(saveInput.sourceStoragePath,null);assert.equal(saveInput.imageAI.requestId,f.requestId);
 assert(!JSON.stringify(saveInput.metadata.protectedMaterialComposite).includes('data:image'));
});
test('remote failure retains canonical PNG; reload retries same bytes/core/UUID with zero provider calls, image decode or composition',async()=>{
 const f=await fixture();let initial;
 await assert.rejects(edit.finalizeProtectedCloudflareEdit({...f,assertCurrent:async()=>{},save:async input=>{initial=input;throw new Error('save_network_unknown');},call:async()=>missing()}),/save_network_unknown/);
 const id=`wa-${initial.requestId}`;const localBefore=local.findWorkspaceArtifactPersisted('brand',id,'alice');assert(localBefore.ok&&localBefore.artifact);
 assert.equal((await material.validateMaterialCompositeArtifact(localBefore.artifact)).stage,'composed');
 const refreshed=await vite.ssrLoadModule('/src/lib/materialProtectedComposite.ts?reload=protected-save');
 let writes=0;const beforeDecode=decodes,beforeEncode=encodes;let remote;
 const recovered=await refreshed.recoverBoundMaterialComposite(f.binding,f.prepared,{brandId:'brand',userId:'alice'},{assertCurrent:async()=>{},readSavedImage,readRemote:async()=>remote??missing(),save:async input=>{writes++;assert.deepEqual(input,initial);remote=remoteFor(input);}});
 assert.equal(recovered.imageUrl,initial.imageUrl);assert.equal(recovered.id,id);assert.equal(writes,1);
 assert.equal(decodes,beforeDecode);assert.equal(encodes,beforeEncode);
 const repeat=await refreshed.recoverBoundMaterialComposite(f.binding,f.prepared,{brandId:'brand',userId:'alice'},{assertCurrent:async()=>{},readSavedImage,readRemote:async()=>remote,save:async()=>assert.fail('saved readback must not write')});
 assert.equal(repeat.imageUrl,recovered.imageUrl);assert.equal(repeat.id,id);
 // The finalizer's durable hook path also ignores an expired raw signed URL and never blends a second time.
 const savedLifecycle=await refreshed.createMaterialProtectedLifecycle(f.binding,f.prepared,{brandId:'brand',userId:'alice'},async()=>{});
 const expired={...f.receipt,images:f.receipt.images.map(image=>({...image,imageUrl:'https://expired.test/raw'}))};
 await edit.finalizeProtectedCloudflareEdit({prepared:f.prepared,receipt:expired,lifecycle:savedLifecycle,assertCurrent:async()=>{},save:async()=>assert.fail('no save'),call:async path=>path.startsWith('/v1/media/read?')?{url:'https://final.test/fixture'}:remote});
 assert.equal(decodes,beforeDecode);assert.equal(encodes,beforeEncode);
});
test('candidate-ready recovery composes the retained raw PNG with no provider endpoint and preserves original save core',async()=>{
 const f=await fixture();const saveRequestId=await contract.protectedImageSaveRequestId(f.requestId,0);
 await f.lifecycle.onCandidate({prepared:f.prepared,receipt:f.receipt,candidate:f.receipt.images[0],candidateIndex:0,saveRequestId});
 let remote,posts=0;
 const result=await material.recoverBoundMaterialComposite(f.binding,f.prepared,{brandId:'brand',userId:'alice'},{assertCurrent:async()=>{},readSavedImage,readRemote:async()=>remote??missing(),save:async input=>{posts++;remote=remoteFor(input);assert.equal(input.imageAI.requestId,f.requestId);}});
 assert.equal(posts,1);assert.equal(result.id,`wa-${saveRequestId}`);assert.deepEqual(decode(result.imageUrl).pixels,[3,5,9,255,9,6,2,0,128,0,127,255,10,20,30,255]);
});
test('preparation quota prevents any provider dispatch; non-durable and dimension-invalid inputs fail preparation',async()=>{
 setup();window.localStorage.setItem=()=>{throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});};let calls=0;
 await assert.rejects((async()=>{await material.prepareMaterialComposite({brandId:'brand',scopeId:'alice',featureType:'fixture',title:'fixture',metadata:{}},encode(4,1,sourcePixels),encode(4,1,maskPixels));calls++;})(),/quota/i);assert.equal(calls,0);
 setup();await assert.rejects(material.prepareMaterialComposite({brandId:'brand',scopeId:'alice',featureType:'fixture',title:'fixture',metadata:{}},'blob:unavailable',encode(4,1,maskPixels)),/decode/);
 await assert.rejects(material.prepareMaterialComposite({brandId:'brand',scopeId:'alice',featureType:'fixture',title:'fixture',metadata:{}},encode(4,1,sourcePixels),encode(2,2,maskPixels)),/dimensions_mismatch/);
});
test('unknown/pending/mismatch and stale auth/scope prevent save; provider boolean alone cannot establish composition',async()=>{
 const f=await fixture();let initial;
 await assert.rejects(edit.finalizeProtectedCloudflareEdit({...f,assertCurrent:async()=>{},save:async input=>{initial=input;throw new Error('failure');},call:async()=>missing()}),/failure/);
 let writes=0;for(const message of ['cloudflare_api_409_workspace_save_pending','network_unknown','cloudflare_api_401_unauthorized']) {
 await assert.rejects(material.recoverBoundMaterialComposite(f.binding,f.prepared,{brandId:'brand',userId:'alice'},{assertCurrent:async()=>{},readSavedImage,readRemote:async()=>{throw new Error(message);},save:async()=>{writes++;}}),new RegExp(message));
 }
 const wrong=remoteFor(initial);wrong.metadata={...initial.metadata,protectedMaterialComposite:{...initial.metadata.protectedMaterialComposite,requestId:crypto.randomUUID()}};
 await assert.rejects(material.recoverBoundMaterialComposite(f.binding,f.prepared,{brandId:'brand',userId:'alice'},{assertCurrent:async()=>{},readSavedImage,readRemote:async()=>wrong,save:async()=>{writes++;}}),/mismatch/);assert.equal(writes,0);
 for(const binding of [{...f.binding,scopeId:'bob'},{...f.binding,requestId:crypto.randomUUID()},{...f.binding,generationInputSignature:'other'}])await assert.rejects(material.createMaterialProtectedLifecycle(binding,f.prepared,{brandId:'brand',userId:'alice'},async()=>{}),/binding|scope|inputs/);
 await assert.rejects(material.recoverBoundMaterialComposite(f.binding,f.prepared,{brandId:'brand',userId:'alice'},{assertCurrent:async()=>{throw new Error('auth_scope_changed');},readSavedImage,readRemote:async()=>{writes++;},save:async()=>{writes++;}}),/auth_scope_changed/);assert.equal(writes,0);
 const forged={...local.findWorkspaceArtifactPersisted('brand',`wa-${initial.requestId}`,'alice').artifact,metadata:{protectedRegionComposited:true}};
 await assert.rejects(material.validateMaterialCompositeArtifact(forged),/state_invalid/);
});
test('provider persistence retains only validated protected final bytes on remote failure',async()=>{
 const f=await fixture();let initial;
 await assert.rejects(edit.finalizeProtectedCloudflareEdit({...f,assertCurrent:async()=>{},save:async input=>{initial=input;throw new Error('failure');},call:async()=>missing()}),/failure/);
 const artifact=local.findWorkspaceArtifactPersisted('brand',`wa-${initial.requestId}`,'alice').artifact;
 await assert.rejects(persistence.persistProviderResultArtifact({...artifact,requireRemote:true,reuseCanonicalRemoteArtifact:false}),/remote_persistence_unverified.*protected_composite_retained/);
 assert(local.findWorkspaceArtifactPersisted('brand',artifact.id,'alice').artifact);
 await assert.rejects(persistence.persistProviderResultArtifact({id:'ordinary',brandId:'brand',scopeId:'alice',featureType:'other',title:'other',imageUrl:f.candidate,requireRemote:true,reuseCanonicalRemoteArtifact:false,metadata:{}}),/remote_persistence_unverified/);
 assert.equal(local.findWorkspaceArtifactPersisted('brand','ordinary','alice').artifact,null);
});
test('large local recovery bytes produce compact remote metadata, preserving digest scheme and immutable proof',async()=>{
 const f=await fixture();const retained=await material.retainMaterialCandidate(f.stage,f.candidate,{provider:'workers_ai',requestId:f.requestId,jobId:`ai-${f.requestId}`,imageId:`ai-${f.requestId}-0`,storagePath:`generated-images/ai-${f.requestId}-0`});
 const final=await material.composeMaterialCandidate(retained);const state=await material.validateMaterialCompositeArtifact(final);
 const large='data:image/png;base64,'+'A'.repeat(300000);
 const stateLarge={...state,original:{...state.original,dataUrl:large,digest:await contract.protectedImageDigest(large)},candidate:{dataUrl:large,digest:await contract.protectedImageDigest(large)}};
 assert(JSON.stringify(stateLarge).length>128*1024);const projection=material.materialRemoteProjection(stateLarge);
 assert(JSON.stringify(projection).length<2000);assert(!JSON.stringify(projection).includes('data:image'));assert.equal(projection.digestScheme,'sha256-data-url-utf8-v1');
});
test('save retry caller and API recovery are separate from all generation calls',async()=>{
 const source=await fs.readFile(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx',import.meta.url),'utf8');
 const retry=source.slice(source.indexOf('  const handleRetryMaterialSave ='),source.indexOf('  const handleGenerate ='));
 assert(!retry.includes('editImageWithPrompt'));assert(!retry.includes('handleGenerate('));assert(retry.includes('recoverProtectedMaterialComposite'));
 const api=await fs.readFile(new URL('../src/lib/cloudflareApi.ts',import.meta.url),'utf8');
 const recovery=api.slice(api.indexOf('  async recoverProtectedMaterialComposite('),api.indexOf('  /** Explicit recovery'));
 assert(!recovery.includes('invokeDurableImageAction'));assert(!recovery.includes('readImageAIRequest'));assert(recovery.includes('readWorkspaceArtifact'));
});

for(const [name,W,H,SW,SH] of [['portrait',2,4,6,6],['landscape',4,2,6,6],['fractional',3,2,8,7]])test(`native printing ${name}: actual original pixels and binary footprint map through the recorded stage frame`,async()=>{
 setup();const source=[];for(let i=0;i<W*H;i++)source.push(7+i,25+i,43+i,i===0?0:255);
 const primary=[];const candidate=[];const stageMask=[];
 for(let y=0;y<SH;y++)for(let x=0;x<SW;x++){primary.push(90,80,70,255);candidate.push(x+120,y+160,x+y+200,255);stageMask.push(255,255,255,(x+y)%2?0:255);}
 const original=encode(W,H,source), primaryUrl=encode(SW,SH,primary),maskUrl=encode(SW,SH,stageMask),candidateUrl=encode(SW,SH,candidate);
 const scale=Math.min(SW/W,SH/H);const frame={x:(SW-W*scale)/2,y:(SH-H*scale)/2,width:W*scale,height:H*scale};const requestId=crypto.randomUUID();
 const snapshots={compositionSha256:await contract.protectedImageDigest(primaryUrl),maskSha256:await contract.protectedImageDigest(maskUrl),originalFrameSha256:'a'.repeat(64)};
 const stage=await material.prepareMaterialComposite({brandId:'brand',scopeId:'alice',featureType:'lightchain-printing-image',title:'printing',prompt:'fixture',metadata:{generationInputSignature:'native',mode:'printing-image'}},original,maskUrl,requestId,{providerPrimaryDataUrl:primaryUrl,frame,printingSnapshot:snapshots});
 const state=await material.validateMaterialCompositeState(stage.metadata.protectedMaterialComposite);const binding={version:1,stateArtifactId:stage.id,requestId,brandId:'brand',scopeId:'alice',generationInputSignature:'native'};
 const plan={mode:contract.PROTECTED_IMAGE_EDIT_MODE,sourceWidth:SW,sourceHeight:SH,sourceSha256:snapshots.compositionSha256,maskSha256:snapshots.maskSha256,guideIndex:1,coveragePercent:50};
 const prepared={body:{brandId:'brand',prompt:'fixture'},plan,sourceImageUrl:primaryUrl,maskDataUrl:maskUrl,materialRecoveryBinding:binding,nativePrintFrameBinding:state.nativePrintFrame};
 const receipt={requestId,success:true,state:'completed',recovery:'terminal',jobId:`ai-${requestId}`,requestedCandidateCount:1,protectedEdit:plan,featureType:'lightchain-printing-image',provider:'workers_ai',backendProvider:'cloudflare-workers-ai',providerModel:'@cf/black-forest-labs/flux-2-klein-4b',images:[{candidateIndex:0,jobId:`ai-${requestId}`,imageId:`ai-${requestId}-0`,storagePath:`generated-images/ai-${requestId}-0`,imageUrl:candidateUrl}]};
 prepared.body.nativePrintFinalFrame=await material.nativePrintFinalFrameFor(state.nativePrintFrame);receipt.metadata={nativePrintFinalFrame:prepared.body.nativePrintFinalFrame};
 const lifecycle=await material.createMaterialProtectedLifecycle(binding,prepared,{brandId:'brand',userId:'alice'},async()=>{});let savedInput;
 await assert.rejects(edit.finalizeProtectedCloudflareEdit({prepared,receipt,lifecycle,assertCurrent:async()=>{},call:async()=>missing(),save:async input=>{savedInput=input;throw new Error('native_save_failed');}}),/native_save_failed/);
 const final=local.findWorkspaceArtifactPersisted('brand',`wa-${savedInput.requestId}`,'alice').artifact;const decoded=decode(final.imageUrl);assert.equal(decoded.width,W);assert.equal(decoded.height,H);
 const expected=[];
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const sx=Math.floor(frame.x+(x+.5)*frame.width/W),sy=Math.floor(frame.y+(y+.5)*frame.height/H);const at=(sy*SW+sx)*4,originalAt=(y*W+x)*4;
  expected.push(...(stageMask[at+3]===255?source.slice(originalAt,originalAt+4):candidate.slice(at,at+4)));
 }
 assert.deepEqual(decoded.pixels,expected);
 const nativeMask=material.remapNativePrintMask(state.nativePrintFrame,new Uint8ClampedArray(stageMask));assert(nativeMask.every((v,i)=>i%4!==3||v===0||v===255));
 assert.equal(savedInput.metadata.protectedEdit.sourceWidth,SW);assert.equal(savedInput.metadata.protectedEdit.sourceHeight,SH);assert.equal(savedInput.metadata.outputSize.width,W);
 let writes=0,remote;const beforeDecode=decodes,beforeEncode=encodes;
 const recovered=await material.recoverBoundMaterialComposite(binding,prepared,{brandId:'brand',userId:'alice'},{assertCurrent:async()=>{},readSavedImage,readRemote:async()=>remote??missing(),save:async input=>{writes++;assert.deepEqual(input,savedInput);remote=remoteFor(input);}});
 assert.equal(recovered.imageUrl,final.imageUrl);assert.equal(writes,1);assert.equal(decodes,beforeDecode);assert.equal(encodes,beforeEncode);
 const savedLifecycle=await material.createMaterialProtectedLifecycle(binding,prepared,{brandId:'brand',userId:'alice'},async()=>{});
 const returned=await edit.finalizeProtectedCloudflareEdit({prepared,receipt,lifecycle:savedLifecycle,assertCurrent:async()=>{},call:async path=>path.startsWith('/v1/media/read?')?{url:'https://final.test/native'}:remote,save:async()=>assert.fail('saved native bytes cannot be resaved')});
 assert.equal(returned.images[0].width,W);assert.equal(returned.images[0].height,H);assert.equal(decodes,beforeDecode);assert.equal(encodes,beforeEncode);
 await assert.rejects(material.composeNativePrintCandidate(state.nativePrintFrame,encode(SW-1,SH,candidate.slice(0,(SW-1)*SH*4)),maskUrl),/geometry_unmapped/);
 await assert.rejects(material.validateNativePrintFrameBinding({...state.nativePrintFrame,frame:{...frame,x:frame.x+.1}},plan),/frame_mismatch/);
 await assert.rejects(material.validateNativePrintFrameBinding({...state.nativePrintFrame,printingSnapshot:{...snapshots,compositionSha256:'f'.repeat(64)}},plan),/binding_invalid/);
});

test('actual Cloudflare API save-only method reconstructs serialized binding and never reaches provider transport',async()=>{
 const f=await fixture();let initial;
 await assert.rejects(edit.finalizeProtectedCloudflareEdit({...f,assertCurrent:async()=>{},save:async input=>{initial=input;throw new Error('save_unknown');},call:async()=>missing()}),/save_unknown/);
 const ts=await import('typescript');const apiSource=await fs.readFile(new URL('../src/lib/cloudflareApi.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('api.ts',apiSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let method;
 const walk=node=>{if(ts.isMethodDeclaration(node)&&node.name.getText(ast)==='recoverProtectedMaterialComposite')method=node;ts.forEachChild(node,walk);};walk(ast);assert(method);
 const recovery=new Function('loadProtectedImageInput','recoverBoundMaterialComposite',ts.transpile(`return async function(brandId,requestId,assertContext) ${method.body.getText(ast)}`,{target:ts.ScriptTarget.ES2022}));
 const restored=JSON.parse(JSON.stringify({prepared:f.prepared,requestId:f.requestId,clientRecoveryKey:'same-durable-key'}));
 const paths=[];let providerCalls=0,remote;
 const transport=async(path,init={})=>{paths.push([path,init.method??'GET']);if(path.includes('provider-actions')||path.includes('image-ai')){providerCalls++;throw new Error('provider_transport_forbidden');}if(path.startsWith('/v1/media/read?')) return {url:'https://final.test/fixture'};if(init.method==='POST'){assert.deepEqual(init.body,initial);remote=remoteFor(initial);return remote;}return remote??missing();};
 const subject={origin:'https://isolated.test',captureRequestContext:async guard=>({userId:'alice',assertCurrent:async()=>guard?.(),call:transport}),readWorkspaceArtifact:async(id,call)=>call(`/v1/workspace-artifacts/${id}`),saveWorkspaceArtifact:async(input,call)=>call('/v1/workspace-artifacts',{method:'POST',body:input}),invokeProviderAction:async()=>{providerCalls++;throw new Error('provider_transport_forbidden');}};
 const actual=recovery(async(scope,requestId)=>{assert.equal(scope.userId,'alice');assert.equal(requestId,f.requestId);return restored;},material.recoverBoundMaterialComposite).bind(subject);
 const result=await actual('brand',f.requestId,()=>{});
 assert.equal(result.artifact.imageUrl,initial.imageUrl);assert.deepEqual(result.acknowledgement,{requestId:f.requestId,clientRecoveryKey:'same-durable-key'});assert.equal(providerCalls,0);
 assert.deepEqual(paths.map(v=>v[1]),['GET','POST','GET','GET']);assert(paths.every(v=>v[0].startsWith('/v1/workspace-artifacts')||v[0].startsWith('/v1/media/read?')));
 paths.length=0;await actual('brand',f.requestId,()=>{});assert.deepEqual(paths.map(v=>v[1]),['GET','GET']);assert.equal(providerCalls,0);
});

test('actual protected pending cache persists and reloads the serializable material binding, not a process-only callback',async()=>{
 const f=await fixture();const originals=Object.fromEntries(['indexedDB','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const {createPendingIndexedDbHarness}=await import('./verify-cloudflare-image-pending-store.test.mjs');
 Object.defineProperty(globalThis,'indexedDB',{value:createPendingIndexedDbHarness(),configurable:true,writable:true});
 Object.defineProperty(globalThis,'localStorage',{value:window.localStorage,configurable:true,writable:true});
 try {
  const pending=await vite.ssrLoadModule('/src/lib/cloudflareImagePendingStore.ts');const image=await vite.ssrLoadModule('/src/lib/cloudflareImageAI.ts');const cache=await vite.ssrLoadModule('/src/lib/cloudflareImageInputCache.ts');
  const scope={origin:'https://cache.test',userId:'alice',brandId:'brand'};
  const prepared={...f.prepared,body:{...f.prepared.body,imageUrls:[f.source,f.mask],protectedEdit:f.prepared.plan}};
  const key=await image.durableImageRecoveryKey(scope.origin,scope.userId,'edit-image',prepared.body);
  await pending.rememberPendingIdentity(key,f.requestId,async()=>{});
  await cache.persistProtectedImageInput(scope,prepared,f.requestId,key);
  const fresh=await vite.ssrLoadModule('/src/lib/cloudflareImageInputCache.ts?reload=material-binding');
  const restored=await fresh.loadProtectedImageInput(scope,f.requestId);
  assert.deepEqual(restored.prepared.materialRecoveryBinding,f.binding);
  const hooks=await material.createMaterialProtectedLifecycle(restored.prepared.materialRecoveryBinding,restored.prepared,{brandId:'brand',userId:'alice'},async()=>{});assert.equal(typeof hooks.onCandidate,'function');
  await assert.rejects(material.createMaterialProtectedLifecycle({...restored.prepared.materialRecoveryBinding,scopeId:'foreign'},restored.prepared,{brandId:'brand',userId:'alice'},async()=>{}),/binding_invalid/);
 } finally {for(const [key,descriptor] of Object.entries(originals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});

test('actual saved bytes are required: matching metadata with wrong bytes/read failure cannot mark saved or acknowledge',async()=>{
 const f=await fixture();let input;
 await assert.rejects(edit.finalizeProtectedCloudflareEdit({...f,assertCurrent:async()=>{},call:async()=>missing(),save:async value=>{input=value;throw new Error('retain');}}),/retain/);
 const remote=remoteFor(input);const artifact=local.findWorkspaceArtifactPersisted('brand',`wa-${input.requestId}`,'alice').artifact;
 for(const behavior of ['wrong','expired','fence']) {
  let fetched=false;globalThis.fetch=async()=>{fetched=true;if(behavior==='expired')throw new Error('expired_read');return new Response(Buffer.from((behavior==='wrong'?f.candidate:input.imageUrl).split(',')[1],'base64'));};
  await assert.rejects(material.recoverBoundMaterialComposite(f.binding,f.prepared,{brandId:'brand',userId:'alice'},{assertCurrent:async()=>{if(behavior==='fence'&&fetched)throw new Error('stale_read_fence');},readSavedImage,readRemote:async()=>remote,save:async()=>assert.fail('noPOST')}),/bytes_mismatch|expired_read|stale_read_fence/);
  assert.equal((await material.validateMaterialCompositeArtifact(local.findWorkspaceArtifactPersisted('brand',artifact.id,'alice').artifact)).stage,'composed');
 }
});

async function openAIFixture(W=4,H=1,SW=W,SH=H,feature='fabric-image'){
 const f=await fixture(feature); // independent storage setup
 const original=encode(W,H,Array.from({length:W*H},(_,i)=>[3+i,5+i,9+i,i===0?0:255]).flat());
 const stagePrimary=encode(SW,SH,new Array(SW*SH).fill([90,80,70,255]).flat());
 const mask=encode(SW,SH,Array.from({length:SW*SH},(_,i)=>[255,255,255,i%2?0:255]).flat());
 const scale=Math.min(SW/W,SH/H),frame={x:(SW-W*scale)/2,y:(SH-H*scale)/2,width:W*scale,height:H*scale};
 const snapshots={compositionSha256:await contract.protectedImageDigest(stagePrimary),maskSha256:await contract.protectedImageDigest(mask),originalFrameSha256:'a'.repeat(64)};
 const stage=await material.prepareMaterialComposite({brandId:'brand',scopeId:'alice',featureType:`lightchain-${feature}`,title:'initial',prompt:'fixture',metadata:{generationInputSignature:'signature'}},original,mask,f.requestId,feature==='printing-image'?{providerPrimaryDataUrl:stagePrimary,frame,printingSnapshot:snapshots}:undefined);
 const state=await material.validateMaterialCompositeState(stage.metadata.protectedMaterialComposite);
 const plan={mode:contract.PROTECTED_IMAGE_EDIT_MODE,sourceWidth:SW,sourceHeight:SH,sourceSha256:state.nativePrintFrame?.providerPrimaryDigest??state.original.digest,maskSha256:state.mask.digest,guideIndex:1,coveragePercent:50};
 const PW=SW,PH=SH,[CW,CH]=PW>PH?[1536,1024]:PH>PW?[1024,1536]:[1024,1024];const s=Math.min(CW/PW,CH/PH);
 const pixels=new Uint8ClampedArray(CW*CH*4);for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){const at=(y*CW+x)*4;pixels.set([x%200,y%200,(x+y)%200,255],at);}
 const candidate=encode(CW,CH,pixels);
 const mapping={version:'protected-openai-contain-v1',digestScheme:'sha256-data-url-utf8-v1',stage:{width:SW,height:SH,primaryDigest:plan.sourceSha256,maskDigest:plan.maskSha256,guideDigest:'a'.repeat(64)},prepared:{width:PW,height:PH,primaryDigest:'b'.repeat(64),guideDigest:'c'.repeat(64),transform:{x:0,y:0,scaleX:PW/SW,scaleY:PH/SH}},candidate:{width:CW,height:CH},contain:{x:(CW-PW*s)/2,y:(CH-PH*s)/2,scale:s},projected:{primaryDigest:'d'.repeat(64),guideDigest:'e'.repeat(64)}};
 const nativeBase=state.nativePrintFrame?await material.nativePrintFinalFrameFor(state.nativePrintFrame):{original:{width:W,height:H,digest:state.original.digest,digestScheme:'sha256-data-url-utf8-v1'},stage:{width:SW,height:SH,primaryDigest:plan.sourceSha256,maskDigest:plan.maskSha256},frame:{x:0,y:0,width:W,height:H},printingSnapshotDigest:await contract.protectedImageDigest(JSON.stringify([]))};
 const native={...nativeBase,version:'native-print-openai-contain-v1',mapping,candidateGeometry:{version:'openai-output-frame-v1',width:CW,height:CH}};
 const prepared={body:{brandId:'brand',featureType:`lightchain-${feature}`,prompt:'fixture',count:1,protectedOpenAIProjection:mapping,nativePrintFinalFrame:native},plan,sourceImageUrl:state.nativePrintFrame?stagePrimary:state.original.dataUrl,maskDataUrl:mask,materialRecoveryBinding:f.binding,nativePrintFrameBinding:state.nativePrintFrame};
 const model='gpt-image-1-mini';const receipt={...f.receipt,featureType:`lightchain-${feature}`,provider:'openai',backendProvider:'openai-images-api',providerModel:model,protectedEdit:plan,resolvedProvider:{provider:'openai',backendProvider:'openai-images-api',model,action:'edit-image',requestId:f.requestId},metadata:{protectedOpenAIProjection:mapping,nativePrintFinalFrame:native},images:[{...f.receipt.images[0],provider:'openai',providerModel:model,modelUsed:model,width:CW,height:CH,imageUrl:candidate}]};
 const lifecycle=await material.createMaterialProtectedLifecycle(f.binding,prepared,{brandId:'brand',userId:'alice'},async()=>{});
 return {...f,stage,prepared,receipt,lifecycle,state,candidate,mapping,native};
}
for(const [name,W,H,SW,SH,feature] of [['fabric',4,1,4,1,'fabric-image'],['portrait',2,4,6,6,'printing-image'],['landscape',4,2,6,6,'printing-image'],['fractional',3,2,8,7,'printing-image']])test(`OpenAI ${name}: recorded native mapping exact RGBA and same bytes/UUID/core retry without generation or reblend`,async()=>{
 const f=await openAIFixture(W,H,SW,SH,feature);let initial;
 await assert.rejects(openai.finalizeProtectedOpenAIEdit({...f,assertCurrent:async()=>{},call:async()=>missing(),save:async input=>{initial=input;throw new Error('openai_save_failure');}}),/openai_save_failure/);
 const artifact=local.findWorkspaceArtifactPersisted('brand',`wa-${initial.requestId}`,'alice').artifact;const final=decode(artifact.imageUrl),original=decode(f.state.original.dataUrl),mask=decode(f.state.mask.dataUrl),candidate=decode(f.candidate),frame=f.native.frame;
 assert.equal(final.width,W);assert.equal(final.height,H);const expected=[];
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const sx=frame.x+(x+.5)*frame.width/W,sy=frame.y+(y+.5)*frame.height/H;const keep=mask.pixels[(Math.floor(sy)*SW+Math.floor(sx))*4+3];const cx=Math.floor(f.mapping.contain.x+sx*f.mapping.prepared.transform.scaleX*f.mapping.contain.scale),cy=Math.floor(f.mapping.contain.y+sy*f.mapping.prepared.transform.scaleY*f.mapping.contain.scale);expected.push(...(keep===255?original.pixels.slice((y*W+x)*4,(y*W+x)*4+4):candidate.pixels.slice((cy*f.mapping.candidate.width+cx)*4,(cy*f.mapping.candidate.width+cx)*4+4)));}
 assert.deepEqual(final.pixels,expected);const beforeDecode=decodes,beforeEncode=encodes;let remote,writes=0;
 const recovered=await material.recoverBoundMaterialComposite(f.binding,f.prepared,{brandId:'brand',userId:'alice'},{assertCurrent:async()=>{},readSavedImage,readRemote:async()=>remote??missing(),save:async input=>{writes++;assert.deepEqual(input,initial);remote=remoteFor(input);}});
 assert.equal(recovered.imageUrl,initial.imageUrl);assert.equal(writes,1);assert.equal(decodes,beforeDecode);assert.equal(encodes,beforeEncode);
 const lifecycle=await material.createMaterialProtectedLifecycle(f.binding,f.prepared,{brandId:'brand',userId:'alice'},async()=>{});
 const receipt={...f.receipt,images:f.receipt.images.map(image=>({...image,imageUrl:'https://expired.test/raw'}))};
 const result=await openai.finalizeProtectedOpenAIEdit({prepared:f.prepared,receipt,lifecycle,assertCurrent:async()=>{},call:async path=>path.startsWith('/v1/media/read?')?{url:'https://final.test/fixture'}:remote,save:async()=>assert.fail('noPOST')});
 assert.equal(result.imageId,recovered.id);assert.equal(decodes,beforeDecode);assert.equal(encodes,beforeEncode);assert.equal(result.images[0].providerImageId,`ai-${f.requestId}-0`);
});
test('OpenAI strict receipt/candidate/model authority and geometry cannot pass Workers gates or mark saved with wrong bytes',async()=>{
 const f=await openAIFixture();let hooks=0;const options={...f,lifecycle:{onCandidate:async()=>{hooks++;throw new Error('must not hook');}},assertCurrent:async()=>{},call:async()=>missing(),save:async()=>assert.fail('no save')};
 for(const receipt of [{...f.receipt,success:false},{...f.receipt,state:'unknown'},{...f.receipt,requestedCandidateCount:0,images:[]},{...f.receipt,resolvedProvider:{...f.receipt.resolvedProvider,model:'gpt-image-1'}},{...f.receipt,requestId:crypto.randomUUID()},{...f.receipt,featureType:'other'}, {...f.receipt,providerModel:'gpt-image-2'}, {...f.receipt,images:[{...f.receipt.images[0],width:1024}]}, {...f.receipt,images:[{...f.receipt.images[0],modelUsed:'other'}]}])await assert.rejects(openai.finalizeProtectedOpenAIEdit({...options,receipt}),/identity_mismatch/);
 assert.equal(hooks,0);await assert.rejects(openai.finalizeProtectedOpenAIEdit({...f,lifecycle:undefined,assertCurrent:async()=>{},call:async()=>missing(),save:async()=>assert.fail('no save')}),/durable_material_binding_required/);await assert.rejects(edit.finalizeProtectedCloudflareEdit({...f,assertCurrent:async()=>{},call:async()=>missing(),save:async()=>assert.fail('noWorkersSave')}),/receipt_plan_mismatch/);
 let input;await assert.rejects(openai.finalizeProtectedOpenAIEdit({...f,assertCurrent:async()=>{},call:async path=>path.startsWith('/v1/media/read?')?{url:'https://final.test/fixture'}:missing(),save:async value=>{input=value;const remote=remoteFor(value);savedPng=f.candidate;return remote;}}),/saved_png_bytes_mismatch/);
 const artifact=local.findWorkspaceArtifactPersisted('brand',`wa-${input.requestId}`,'alice').artifact;assert.equal((await material.validateMaterialCompositeArtifact(artifact)).stage,'composed');
});
test('projection rejects missing/nonfinite/string transforms, fake PNG, digest mismatch and guessed uniform rounding',async()=>{
 const f=await openAIFixture();const m=f.mapping;
 for(const bad of [undefined,NaN,Infinity,'0'])for(const key of ['x','y','scale'])assert.throws(()=>projectionModule.validateProtectedOpenAIProjection({...m,contain:{...m.contain,[key]:bad}}),/projection_invalid/);
 assert.throws(()=>projectionModule.validateProtectedOpenAIProjection({...m,prepared:{...m.prepared,transform:{...m.prepared.transform,scaleY:'1'}}}),/projection_invalid/);
 assert.throws(()=>projectionModule.validateProtectedOpenAIProjection({...m,prepared:{...m.prepared,width:3,height:1,transform:{x:0,y:0,scaleX:.75,scaleY:.75}}}),/projection_invalid/);
 const payload={...m,primaryDataUrl:f.candidate,guideDataUrl:f.candidate,projected:{primaryDigest:await contract.protectedImageDigest(f.candidate),guideDigest:await contract.protectedImageDigest(f.candidate)}};
 await projectionModule.validateProtectedOpenAIProjectionPayload(payload);
 await assert.rejects(projectionModule.validateProtectedOpenAIProjectionPayload({...payload,projected:{...payload.projected,primaryDigest:'a'.repeat(64)}}),/projection_invalid/);
 const fake='data:image/png;base64,'+Buffer.alloc(24).toString('base64');await assert.rejects(projectionModule.validateProtectedOpenAIProjectionPayload({...payload,primaryDataUrl:fake,projected:{...payload.projected,primaryDigest:await contract.protectedImageDigest(fake)}}),/projection_invalid/);
 const normalized=projectionModule.validateProtectedOpenAIProjection({...m,untrusted:'extra'});assert.equal(normalized.untrusted,undefined);
});

for(const [name,SW,SH,PW,PH] of [['square',16,16,16,16],['portrait',10,20,10,20],['landscape',20,10,20,10],['fractional-rounded-axes',999,1535,333,512]])test(`actual projection preparation ${name}: primary/guide identical recorded placement, black opaque protected padding and round-trip native pixels`,async()=>{
 setup();const original=encode(SW,SH,[]),stageGuide=encode(SW,SH,[]),primary=encode(PW,PH,new Array(PW*PH).fill([31,51,71,255]).flat()),guide=encode(PW,PH,new Array(PW*PH).fill([255,255,255,255]).flat());
 const sourceDigest=await contract.protectedImageDigest(original),maskDigest='b'.repeat(64),plan={mode:contract.PROTECTED_IMAGE_EDIT_MODE,sourceWidth:SW,sourceHeight:SH,sourceSha256:sourceDigest,maskSha256:maskDigest,guideIndex:1,coveragePercent:50};
 const transform={x:0,y:0,scaleX:PW/SW,scaleY:PH/SH};const body={brandId:'brand',featureType:'lightchain-fabric-image',imageUrls:[primary,guide],referenceTransforms:[0,1].map(index=>({index,sourceWidth:SW,sourceHeight:SH,width:PW,height:PH,renderingTransform:transform}))};
 const prepared={body:{imageUrls:[original,stageGuide]},sourceImageUrl:original,maskDataUrl:'unloaded',plan};
 const result=await projectionPreparation.prepareProtectedOpenAIProjection(prepared,body);const p=decode(result.projection.primaryDataUrl),g=decode(result.projection.guideDataUrl),o=result.projection.contain;
 assert.equal(p.width,result.projection.candidate.width);assert.equal(g.height,result.projection.candidate.height);assert.deepEqual(result.projection.prepared.transform,transform);
 assert.equal(result.projection.prepared.primaryDigest,await contract.protectedImageDigest(primary));assert.equal(result.projection.projected.guideDigest,await contract.protectedImageDigest(result.projection.guideDataUrl));
 let padding=0,inside=0;
 for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){const at=(y*p.width+x)*4,isInside=x+.5>=o.x&&x+.5<o.x+PW*o.scale&&y+.5>=o.y&&y+.5<o.y+PH*o.scale;assert.deepEqual(g.pixels.slice(at,at+4),isInside?[255,255,255,255]:[0,0,0,255]);assert.deepEqual(p.pixels.slice(at,at+4),isInside?[31,51,71,255]:[0,0,0,255]);if(isInside)inside++;else padding++;}
 assert(inside>0);if(name!=='square')assert(padding>0);else assert.equal(padding,0);
 if(name==='fractional-rounded-axes'){assert.notEqual(transform.scaleX,transform.scaleY);await assert.rejects(projectionPreparation.prepareProtectedOpenAIProjection(prepared,{...body,referenceTransforms:body.referenceTransforms.map(v=>({...v,renderingTransform:{...transform,scaleY:transform.scaleX}}))}),/transform_missing/);}
 const actualOriginal=encode(2,2,[9,8,7,0,9,8,7,255,9,8,7,255,9,8,7,255]),mask=encode(SW,SH,new Array(SW*SH).fill([255,255,255,0]).flat());
 const nativeScale=Math.min(SW/2,SH/2),frame={x:(SW-2*nativeScale)/2,y:(SH-2*nativeScale)/2,width:2*nativeScale,height:2*nativeScale};
 const binding={version:1,original:{dataUrl:actualOriginal,digest:await contract.protectedImageDigest(actualOriginal),width:2,height:2},stageWidth:SW,stageHeight:SH,providerPrimaryDigest:sourceDigest,stageMaskDigest:await contract.protectedImageDigest(mask),frame,printingSnapshot:{compositionSha256:sourceDigest,maskSha256:await contract.protectedImageDigest(mask),originalFrameSha256:'a'.repeat(64)}};
 const state={version:1,requestId:crypto.randomUUID(),candidateIndex:0,stage:'candidate-ready',original:binding.original,mask:{dataUrl:mask,digest:binding.stageMaskDigest,width:SW,height:SH},nativePrintFrame:binding,openAIProjection:result.projection};
 const composed=await material.composeMappedOpenAICandidate(state,result.projection.primaryDataUrl);assert.deepEqual(decode(composed.dataUrl).pixels,new Array(4).fill([31,51,71,255]).flat());
});

test('actual invokeProviderAction OpenAI wire: initial durable projection, strict finalizer and reload same-core save-only zero provider replay',async()=>{
 const f=await fixture();const ts=await import('typescript'),source=await fs.readFile(new URL('../src/lib/cloudflareApi.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('api.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);const methods=new Map();
 const walk=node=>{if(ts.isMethodDeclaration(node))methods.set(node.name.getText(ast),node);ts.forEachChild(node,walk);};walk(ast);
 let entry,remote,initial,providerCalls=0;const candidate=encode(1536,1024,new Array(1536*1024).fill([121,151,181,255]).flat());
 const bindings={CLOUDFLARE_IMAGE_ACTIONS:new Set(['edit-image']),nativePrintFinalFrameFor:material.nativePrintFinalFrameFor,prepareProtectedCloudflareEdit:edit.prepareProtectedCloudflareEdit,
  canonicalCloudflareImageBody:body=>body,prepareCloudflareImageInput:async(_action,body)=>({...body,referenceTransforms:body.imageUrls.map((url,index)=>{const size=decode(url);return {index,sourceWidth:size.width,sourceHeight:size.height,width:size.width,height:size.height,resized:false,renderingTransform:{x:0,y:0,scaleX:1,scaleY:1}};})}),
  prepareProtectedOpenAIProjection:projectionPreparation.prepareProtectedOpenAIProjection,createMaterialProtectedLifecycle:material.createMaterialProtectedLifecycle,
  persistProtectedImageInput:async(_scope,prepared,requestId,clientRecoveryKey)=>{entry=JSON.parse(JSON.stringify({prepared,requestId,clientRecoveryKey}));},deleteProtectedImageInput:async()=>assert.fail('no premature deletion'),
  finalizeProtectedCloudflareEdit:edit.finalizeProtectedCloudflareEdit,finalizeProtectedOpenAIEdit:openai.finalizeProtectedOpenAIEdit,
  invokeDurableImageAction:async options=>{providerCalls++;await options.beforeSubmit(f.requestId,'durable-wire-key');assert.equal(entry.prepared.body.generationProvider,'openai');assert.equal(entry.prepared.body.nativePrintFinalFrame.version,'native-print-openai-contain-v1');
   const mapping=projectionModule.protectedOpenAIProjectionProof(options.body.protectedOpenAIProjection);await projectionModule.verifyProtectedOpenAIProjectionRequest(options.body.protectedOpenAIProjection,options.body);
   const model='gpt-image-1-mini',receipt={...f.receipt,featureType:'lightchain-fabric-image',protectedEdit:options.body.protectedEdit,provider:'openai',backendProvider:'openai-images-api',providerModel:model,resolvedProvider:{provider:'openai',backendProvider:'openai-images-api',model,action:'edit-image',requestId:f.requestId},metadata:{protectedOpenAIProjection:mapping,nativePrintFinalFrame:options.body.nativePrintFinalFrame},images:[{...f.receipt.images[0],provider:'openai',providerModel:model,modelUsed:model,width:1536,height:1024,imageUrl:candidate}]};return options.finalize(receipt);},
 };
 const invoke=new Function(...Object.keys(bindings),ts.transpile(`return async function(action,body,options={}) ${methods.get('invokeProviderAction').body.getText(ast)}`,{target:ts.ScriptTarget.ES2022}))(...Object.values(bindings));
 let failSave=true;const paths=[];const call=async(path,init={})=>{paths.push(path);if(path.includes('provider-actions')||path.includes('image-ai')){providerCalls++;throw new Error('provider replay forbidden');}if(path.startsWith('/v1/media/read?')){assert.equal(new URL('https://wire.test'+path).searchParams.get('bucket'),'generated-images');assert.equal(new URL('https://wire.test'+path).searchParams.get('expiresIn'),'3600');assert.equal(new URL('https://wire.test'+path).searchParams.get('path'),'generated-images/wa-'+initial.requestId);return {url:'https://final.test/fixture'};}return remote??missing();};
 const subject={origin:'https://wire.test',captureRequestContext:async()=>({userId:'alice',assertCurrent:async()=>{},call}),readWorkspaceArtifact:async(id,captured)=>captured(`/v1/workspace-artifacts/${id}`),saveWorkspaceArtifact:async input=>{if(!initial)initial=input;else assert.deepEqual(input,initial);if(failSave)throw new Error('wire_save_unknown');remote=remoteFor(input);return remote;}};
 await assert.rejects(invoke.call(subject,'edit-image',{brandId:'brand',generationProvider:'openai',featureType:'lightchain-fabric-image',imageUrls:[f.source],maskDataUrl:f.mask,count:1,prompt:'fixture'},{idempotencyKey:f.requestId,materialRecoveryBinding:f.binding}),/wire_save_unknown/);
 assert.equal(providerCalls,1);assert(entry);const beforeDecode=decodes,beforeEncode=encodes;
 const recover=new Function('loadProtectedImageInput','recoverBoundMaterialComposite',ts.transpile(`return async function(brandId,requestId,assertContext) ${methods.get('recoverProtectedMaterialComposite').body.getText(ast)}`,{target:ts.ScriptTarget.ES2022}))(async()=>JSON.parse(JSON.stringify(entry)),material.recoverBoundMaterialComposite);
 failSave=false;const result=await recover.call(subject,'brand',f.requestId);assert.equal(result.artifact.imageUrl,initial.imageUrl);assert.equal(result.artifact.id,'wa-'+initial.requestId);assert.equal(providerCalls,1);assert.equal(decodes,beforeDecode);assert.equal(encodes,beforeEncode);assert.deepEqual(result.acknowledgement,{requestId:f.requestId,clientRecoveryKey:'durable-wire-key'});
});

test('actual durable OpenAI material count1 clears incoming requiresProtectedComposite only after canonical PNG proof',async()=>{
 const f=await openAIFixture();f.receipt={...f.receipt,requiresProtectedComposite:true,persistenceStatus:'completed'};const image=await vite.ssrLoadModule('/src/lib/cloudflareImageAI.ts');const originalDescriptors=Object.fromEntries(['indexedDB','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));const {createPendingIndexedDbHarness}=await import('./verify-cloudflare-image-pending-store.test.mjs');Object.defineProperty(globalThis,'indexedDB',{value:createPendingIndexedDbHarness(),configurable:true,writable:true});Object.defineProperty(globalThis,'localStorage',{value:window.localStorage,configurable:true,writable:true});let providers=0;
 try {const result=await image.invokeDurableImageAction({origin:'https://material-positive.test',userId:'alice',action:'edit-image',body:f.prepared.body,idempotencyKey:f.requestId,retainUntilAcknowledged:true,assertCurrent:async()=>{},call:async(path,init)=>{providers++;assert(path.includes('provider-actions')&&init.method==='POST');return f.receipt;},finalize:receipt=>openai.finalizeProtectedOpenAIEdit({...f,receipt,assertCurrent:async()=>{},save:async input=>remoteFor(input),call:async path=>path.startsWith('/v1/media/read?')?{url:'https://final.test/fixture'}:missing()})});assert.equal(providers,1);assert.equal(result.requiresProtectedComposite,false);assert.equal(result.imageId.startsWith('wa-'),true);assert(result.clientRecoveryKey);}
 finally {for(const [key,descriptor]of Object.entries(originalDescriptors)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});

test('material count1 verified-saved media and refresh failures propagate without workspace POST replay; success keeps authoritative provider model',async()=>{
 const f=await openAIFixture();let remote,saves=0;const first=await openai.finalizeProtectedOpenAIEdit({...f,assertCurrent:async()=>{},call:async path=>path.startsWith('/v1/media/read?')?{url:'https://final.test/fixture'}:remote??missing(),save:async input=>{saves++;remote=remoteFor(input);return remote;}});assert.equal(saves,1);const beforeEncode=encodes;
 const lifecycle={...f.lifecycle,getVerifiedSavedCandidate:async()=>first.images[0],refreshVerifiedSavedCandidate:async()=>{throw new Error('count1_refresh_unavailable');}};let workspace=0,refreshes=0;
 await assert.rejects(openai.finalizeProtectedOpenAIEdit({...f,lifecycle,assertCurrent:async()=>{},call:async path=>{assert(path.startsWith('/v1/media/read?'));throw new Error('count1_media_unavailable');},save:async()=>{workspace++;assert.fail('saved POST replay');}}),/count1_media_unavailable/);assert.equal(workspace,0);
 await assert.rejects(openai.finalizeProtectedOpenAIEdit({...f,lifecycle,assertCurrent:async()=>{},call:async path=>{assert(path.startsWith('/v1/media/read?'));return{url:'https://final.test/fixture'};},save:async()=>{workspace++;assert.fail('saved POST replay');}}),/count1_refresh_unavailable/);assert.equal(workspace,0);
 const result=await openai.finalizeProtectedOpenAIEdit({...f,lifecycle:{...lifecycle,refreshVerifiedSavedCandidate:async(_context,url)=>{refreshes++;assert.equal(url,'https://final.test/fixture');}},assertCurrent:async()=>{},call:async()=>({url:'https://final.test/fixture'}),save:async()=>{workspace++;assert.fail('saved POST replay');}});assert.equal(workspace,0);assert.equal(refreshes,1);assert.equal(encodes,beforeEncode);assert.equal(result.provider,'openai');assert.equal(result.providerModel,f.receipt.resolvedProvider.model);assert.equal(result.modelUsed,f.receipt.resolvedProvider.model);assert.equal(result.requiresProtectedComposite,false);
});
