import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {createServer} from 'vite';
import {createPendingIndexedDbHarness,createPendingLegacyStorage} from './verify-cloudflare-image-pending-store.test.mjs';
const root=new URL('..',import.meta.url).pathname;
const vite=await createServer({root,configFile:false,envFile:false,cacheDir:`/tmp/heavy-print-design-${process.pid}`,appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{name:'isolated-print-workspace',enforce:'pre',resolveId(id){if(/\/cloudflareApi(?:\.ts)?$/.test(id))return '\0print-workspace';},load(id){if(id==='\0print-workspace')return `export class ArtifactPersistenceContextError extends Error{}; export const cloudflareDataPlane={saveWorkspaceArtifact:(...args)=>globalThis.__printWorkspaceSave(...args)};`;}}]});
const image=await vite.ssrLoadModule('/src/lib/cloudflareImageAI.ts');
const persistence=await vite.ssrLoadModule('/src/lib/providerResultPersistence.ts');
const workspace=await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
const resume=await vite.ssrLoadModule('/src/lib/lightchainResume.ts');
const remoteResume=await vite.ssrLoadModule('/src/lib/lightchainPrintDesignRemoteResume.ts');
const assets=await vite.ssrLoadModule('/src/lib/canvasLocalAssets.ts');
const guards=await vite.ssrLoadModule('/src/lib/providerResultReadback.ts');
const source=await fs.readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx',import.meta.url),'utf8');
const parsed=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[];const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(parsed);
const handler=nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(parsed)==='handleLightchainPreviewGenerate').initializer.getText(parsed);
const handlerCode=ts.transpile(`const extracted=${handler}; extracted;`,{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
const globals={window:globalThis.window,localStorage:globalThis.localStorage,indexedDB:globalThis.indexedDB,fetch:globalThis.fetch};
let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw new Error('external_fetch_forbidden');};
after(async()=>{Object.assign(globalThis,globals);await vite.close();assert.equal(networkCalls,0);});
const origin='https://isolated-print-design.test',userId='alice',brandId='brand';
const clone=x=>structuredClone(x);
async function fixture(toolId,route='generate-image'){
 const values=new Map(),storage=createPendingLegacyStorage(values);globalThis.window={localStorage:storage,dispatchEvent(){}};globalThis.localStorage=storage;globalThis.indexedDB=createPendingIndexedDbHarness();
 const revision='print-source-'+crypto.randomUUID();await assets.putLocalCanvasAsset(revision,new Blob(['original-garment-bytes'],{type:'image/png'}));
 const localAssetRef=assets.buildLocalCanvasAssetReference(revision),sourceBytes='data:image/png;base64,b3JpZ2luYWwtZ2FybWVudC1ieXRlcw==';
 const slots={primary:{name:'original.png',kind:'服',imageUrl:sourceBytes,localAssetRef},secondary:null};
 const savedInputs=new Map(),receipts=new Map(),events=[],ui={result:null,errors:[],successes:0};let saveFailure=false,ackFailure=false,wrongRemote=false,current=true,switchScopeDuringSave=false,providerOptions;
 const counts={post:0,get:0,save:0,ack:0};
 globalThis.__printWorkspaceSave=async input=>{counts.save++;events.push('save');if(saveFailure)throw new Error('workspace_unavailable');
  const previous=savedInputs.get(input.requestId);if(previous)assert.deepEqual(input,previous);else savedInputs.set(input.requestId,clone(input));
  const id=input.sourceStoragePath.split('/').at(-1);if(switchScopeDuringSave)current=false;return {success:true,remote:{jobId:wrongRemote?'wrong-job':input.sourceJobId,imageId:id,storagePath:input.sourceStoragePath}};};
 const noop=()=>{},ref={current:0},requestRef={current:null},scopeRef={current:'scope'},mounted={current:true};
 const assertAuth=()=>{if(!current)throw new Error('scope_changed');};
 const provider=async(prompt,_brand,options)=>{
  assert.equal(options.retainUntilAcknowledged,true);assert.equal(options.featureType,`lightchain-${toolId}`);
  if(route==='generate-image')assert.deepEqual(options.imageUrls,[sourceBytes]);
  providerOptions={origin,userId,action:route,body:{brandId,prompt,featureType:options.featureType,imageUrls:options.imageUrls??[sourceBytes],compositionPreview:options.compositionPreview},retainUntilAcknowledged:options.retainUntilAcknowledged,assertCurrent:async()=>options.assertContext(),
    call:async(path,init={})=>{let id;if(init.method==='POST'){counts.post++;id=new Headers(init.headers).get('Idempotency-Key');events.push('provider');
      const imageId=`ai-${id}-0`;receipts.set(id,{requestId:id,recovery:'terminal',state:'completed',success:true,jobId:`ai-${id}`,imageId,storagePath:`generated-images/${imageId}`,imageUrl:'data:image/png;base64,AQ==',persistenceStatus:'completed',images:[{imageId,storagePath:`generated-images/${imageId}`,imageUrl:'data:image/png;base64,AQ==',persistenceStatus:'completed'}]});
    }else{counts.get++;id=path.split('/').at(-1);}return clone(receipts.get(id));}};
  return image.invokeDurableImageAction(providerOptions);
 };
 const context={selectedTool:{id:toolId,title:'柄・グラフィック',lightchainRoute:toolId.endsWith('detail')?'/editor/patternDesign/detail':'/printing'},materialSlotFiles:slots,heavyEntitlementReady:true,isHeavyRoute:true,heavyOwnedFeature:true,user:{id:userId},currentBrand:{id:brandId},ensureHeavyWorkspace:async()=>({id:brandId}),isHeavyWorkspaceBrandName:(name)=>name==='Heavy Chain Workspace',refreshCurrentBrand:async()=>({id:brandId}),captureCurrentAuthBrandFence:()=>({brandId,userId}),assertCurrentAuthBrandFence:assertAuth,lightchainProviderRoute:route,lightchainProviderSupported:true,providerRightsConfirmed:true,
  lightchainGenerationSequenceRef:ref,lightchainGenerationRequestRef:requestRef,workbenchScopeRef:scopeRef,workbenchMountedRef:mounted,
  printDesignMode:'guide',printDesignStyle:'ワンポイント',printDesignPrompt:'  original print brief  ',brief:'  original print brief  ',referenceNote:'original reference',
  modelFormState:new Proxy({},{get:()=>''}),patternVectorLayers:[],fabricPresetIds:[],isFittingDetail:false,currentModelPanel:null,
  buildCurrentParityRuntime:()=>({}),buildLightchainProviderPrompt:input=>[input.summary,input.brief,input.referenceNote].join('\n'),serializeLightchainParityRuntime:x=>x,serializeLightchainResumeSlots:resume.serializeLightchainResumeSlots,
  generateImage:provider,editImageWithPrompt:async(_source,prompt,brand,options)=>provider(prompt,brand,options),assertCompletedImageEditResult:guards.assertCompletedImageEditResult,
  persistProviderResultArtifact:persistence.persistProviderResultArtifact,
  cloudflareDataPlane:{captureArtifactPersistenceContext:async({assertContext})=>({assertCurrent:async()=>assertContext()}),acknowledgeImageAction:async receipt=>{counts.ack++;events.push('ack');if(ackFailure)throw new Error('ack_disconnected');await image.acknowledgeDurableImageAction({...providerOptions,receipt});}},
  setLightchainResult:result=>{ui.result=clone(result);events.push('ui-saved');},setLightchainGenerationError:error=>{if(error)ui.errors.push(error);},bindPersistedResumeJob:noop,getErrorMessage:error=>error.message,toast:{success:()=>ui.successes++,error:message=>ui.errors.push(message)},
 };
 const bindings=new Proxy(context,{has:()=>true,get:(target,key)=>{if(key===Symbol.unscopables)return undefined;if(key in target)return target[key];if(key in globalThis)return globalThis[key];if(String(key).startsWith('set'))return noop;return '';}});
 const run=new Function('bindings',`with(bindings){${handlerCode.replace(/extracted;\s*$/,'return extracted;')}}`)(bindings);
 return {context,counts,ui,events,slots,localAssetRef,sourceBytes,savedInputs,run:()=>run(),
  set:flags=>{({saveFailure=saveFailure,ackFailure=ackFailure,wrongRemote=wrongRemote,current=current,switchScopeDuringSave=switchScopeDuringSave}=flags);},
  remoteRow:()=>{const receipt=[...receipts.values()].at(-1);return {id:receipt.imageId,job_id:receipt.jobId,brand_id:brandId,user_id:userId,feature_type:`lightchain-${toolId}`,storage_path:receipt.storagePath,prompt:'provider instruction',created_at:'2026-10-02T00:00:00Z',metadata:{requestId:receipt.requestId,persistenceStatus:'completed',compositionPreview:clone(providerOptions.body.compositionPreview)}};},
  artifacts:()=>workspace.listWorkspaceArtifacts(brandId,userId),
  reload:async()=>{const module=await vite.ssrLoadModule(`/src/lib/lightchainResume.ts?reload=${crypto.randomUUID()}`);const all=workspace.listWorkspaceArtifacts(brandId,userId),job=all[0]?.sourceJobId;const scope={brandId,scopeId:userId,toolId};return {input:module.readLightchainResumeInput(all,job,scope),result:module.readLightchainResumeResult(all,job,scope)};}};
}
for(const tool of ['print-design-project','print-design-detail'])test(`${tool}: actual handler saves bytes/settings and same job/result before ACK; reload uses same identity`,async()=>{
 const f=await fixture(tool);await f.run();assert.ok(f.ui.result,f.ui.errors.join(','));assert.equal(f.ui.successes,1);assert.equal(f.counts.post,1);assert.equal(f.counts.ack,1);
 assert.deepEqual(f.events,['provider','save','ui-saved','ack']);const restored=await f.reload();assert.deepEqual(restored.input.printDesignState,{version:1,mode:'guide',style:'ワンポイント',prompt:'  original print brief  '});
 assert.equal(restored.input.slots[0].imageUrl,f.localAssetRef);assert.equal(await (await assets.getLocalCanvasAsset(f.localAssetRef)).text(),'original-garment-bytes');
 assert.equal(restored.result.jobId,f.ui.result.jobId);assert.equal(restored.result.imageId,f.ui.result.imageId);assert.equal(restored.result.storagePath,f.ui.result.storagePath);assert.equal(restored.result.artifactId,f.ui.result.artifactId);
});
test('save failure never promotes success; same input retry GETs retained request without another generation',async()=>{
 const f=await fixture('print-design-detail');f.set({saveFailure:true});await f.run();assert.equal(f.ui.result,null);assert.equal(f.ui.successes,0);assert.equal(f.counts.ack,0);
 f.set({saveFailure:false});await f.run();assert.ok(f.ui.result,f.ui.errors.join(','));assert.equal(f.counts.post,1);assert.equal(f.counts.get,1);assert.equal(f.artifacts().length,1);
});
test('saved ACK disconnection keeps result through reload; retry reuses exact request/job/artifact',async()=>{
 const f=await fixture('print-design-project');f.set({ackFailure:true});await f.run();assert.ok(f.ui.result,f.ui.errors.join(','));const original=clone(f.ui.result);const restored=await f.reload();assert.equal(restored.result.artifactId,original.artifactId);
 f.set({ackFailure:false,saveFailure:true});await f.run();assert.equal(f.counts.post,1);assert.equal(f.counts.get,1);assert.equal(f.counts.save,1);assert.equal(f.counts.ack,2);assert.equal(f.artifacts().length,1);assert.equal(f.ui.result.artifactId,original.artifactId);assert.equal(f.ui.result.jobId,original.jobId);
});
test('edit route also retains caller ACK and exact print feature identity',async()=>{const f=await fixture('print-design-detail','edit-image');await f.run();assert.ok(f.ui.result,f.ui.errors.join(','));assert.equal(f.counts.post,1);assert.equal(f.counts.ack,1);});
test('wrong saved canonical job never promotes or ACKs',async()=>{const f=await fixture('print-design-detail');f.set({wrongRemote:true});await f.run();assert.equal(f.ui.result,null);assert.equal(f.ui.successes,0);assert.equal(f.counts.ack,0);assert.ok(f.ui.errors.some(e=>e.includes('identity_mismatch')));});

test('legacy/invalid dedicated settings are not fabricated, and foreign job/owner/tool are rejected',async()=>{
 const f=await fixture('print-design-detail');await f.run();const artifact=f.artifacts()[0],job=artifact.sourceJobId,scope={brandId,scopeId:userId,toolId:'print-design-detail'};
 for(const state of [undefined,{version:1,mode:'bad',style:'ホーム',prompt:''},{version:1,mode:'guide',style:'unknown',prompt:''},{version:1,mode:'guide',style:'ホーム',prompt:'x'.repeat(201)}]){
  const changed=clone(artifact);changed.metadata.printDesignState=state;assert.equal(resume.readLightchainResumeInput([changed],job,scope).printDesignState,undefined);
 }
 assert.equal(resume.readLightchainResumeInput([artifact],'foreign-job',scope),null);
 assert.equal(resume.readLightchainResumeInput([artifact],job,{...scope,scopeId:'bob'}),null);
 assert.equal(resume.readLightchainResumeInput([artifact],job,{...scope,toolId:'print-design-project'}),null);
});
test('scope changes before provider or during workspace response cannot promote results or ACK',async()=>{
 for(const mid of [false,true]){const f=await fixture('print-design-project');f.set(mid?{switchScopeDuringSave:true}:{current:false});await f.run();
  assert.equal(f.ui.result,null);assert.equal(f.ui.successes,0);assert.equal(f.counts.ack,0);assert.equal(f.artifacts().length,0);
  assert.equal(f.counts.post,mid?1:0);
 }
});
test('actual resume UI block applies saved guide/style/prompt without resetting empty or spaced input',async()=>{
 const f=await fixture('print-design-detail');await f.run();const restored=await f.reload(),state={};
 const block=nodes.find(n=>ts.isIfStatement(n)&&n.expression.getText(parsed)==='resumed?.printDesignState').thenStatement.getText(parsed);
 const body=ts.transpile(block,{target:ts.ScriptTarget.ES2022});
 new Function('resumed','setPrintDesignMode','setPrintDesignStyle','setPrintDesignPrompt','setPrintDesignDetailStarted',body)(restored.input,v=>state.mode=v,v=>state.style=v,v=>state.prompt=v,v=>state.started=v);
 assert.deepEqual(state,{mode:'guide',style:'ワンポイント',prompt:'  original print brief  ',started:true});
 const changed=clone(f.artifacts()[0]);changed.metadata.printDesignState={version:1,mode:'no-guide',style:'ホーム',prompt:''};
 const empty=resume.readLightchainResumeInput([changed],changed.sourceJobId,{brandId,scopeId:userId,toolId:'print-design-detail'});assert.equal(empty.printDesignState.prompt,'');
});

test('Canvas snapshot keeps dedicated state, and old preferred Canvas input uses only this scoped job settings',async()=>{
 const f=await fixture('print-design-detail');await f.run();const provider=clone(f.artifacts()[0]);
 const declaration=nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(parsed)==='lightchainWorkbenchState');
 const object=declaration.initializer.whenTrue;
 const spread=object.properties.find(p=>ts.isSpreadAssignment(p)&&p.getText(parsed).includes('printDesignState'));
 const metadata=new Function('selectedTool','printDesignMode','printDesignStyle','printDesignPrompt',ts.transpile(`return ({${spread.getText(parsed)}});`,{target:ts.ScriptTarget.ES2022}))({id:'print-design-detail'},'guide','ワンポイント','  original print brief  ');
 assert.deepEqual(metadata.printDesignState,provider.metadata.printDesignState);
 const canvas=clone(provider);canvas.id='canvas-restored-input';canvas.metadata={toolId:'print-design-detail',providerResultArtifact:true,lightchainWorkbenchState:{materialSlots:provider.metadata.materialSlots,brief:provider.metadata.brief}};
 const scope={brandId,scopeId:userId,toolId:'print-design-detail'};
 assert.deepEqual(resume.readLightchainResumeInput([canvas,provider],provider.sourceJobId,scope).printDesignState,provider.metadata.printDesignState);
 const foreign=clone(provider);foreign.scopeId='bob';assert.equal(resume.readLightchainResumeInput([canvas,foreign],provider.sourceJobId,scope).printDesignState,undefined);
 const otherJob=clone(provider);otherJob.sourceJobId='other-job';otherJob.metadata.remoteJobId='other-job';assert.equal(resume.readLightchainResumeInput([canvas,otherJob],provider.sourceJobId,scope).printDesignState,undefined);
});
test('changed dedicated settings receive a new request identity instead of adopting a saved pending result',async()=>{
 const f=await fixture('print-design-detail');f.set({ackFailure:true});await f.run();const original=clone(f.ui.result);
 f.context.printDesignStyle='ホーム';f.set({ackFailure:false});await f.run();
 assert.equal(f.counts.post,2);assert.equal(f.counts.get,0);assert.equal(f.artifacts().length,2);assert.notEqual(f.ui.result.jobId,original.jobId);
 assert.ok(f.artifacts().some(a=>a.id===original.artifactId&&a.metadata.printDesignState.style==='ワンポイント'));
 assert.ok(f.artifacts().some(a=>a.id===f.ui.result.artifactId&&a.metadata.printDesignState.style==='ホーム'));
});

for(const toolId of ['print-design-project','print-design-detail'])test(`${toolId}: remote-only metadata restores exact inputs/bytes and identity without inference or workspace save`,async()=>{
 const f=await fixture(toolId);f.set({ackFailure:true});await f.run();const row=f.remoteRow(),before=clone(f.counts);
 globalThis.localStorage.removeItem(workspace.getWorkspaceArtifactStorageKey(brandId,userId));assert.equal(f.artifacts().length,0);
 const restored=remoteResume.readPrintDesignRemoteResume([row],row.job_id,{brandId,scopeId:userId,toolId});assert.ok(restored);
 assert.deepEqual(restored.input.printDesignState,{version:1,mode:'guide',style:'ワンポイント',prompt:'  original print brief  '});
 assert.equal(await (await assets.getLocalCanvasAsset(restored.input.slots[0].imageUrl)).text(),'original-garment-bytes');
 assert.equal(restored.result.jobId,row.job_id);assert.equal(restored.result.imageId,row.id);assert.equal(restored.result.storagePath,row.storage_path);assert.equal(restored.result.artifactId,f.ui.result.artifactId);
 assert.deepEqual(f.counts,before);
});
test('remote adoption rejects foreign owner/brand/tool/job/request/image/path, incomplete metadata and ambiguity',async()=>{
 const f=await fixture('print-design-detail');await f.run();const row=f.remoteRow(),scope={brandId,scopeId:userId,toolId:'print-design-detail'};
 for(const mutation of [r=>r.user_id='bob',r=>r.brand_id='other',r=>r.feature_type='lightchain-print-design-project',r=>r.job_id='other',r=>r.id='other',r=>r.storage_path='generated-images/other',r=>r.metadata.requestId=crypto.randomUUID(),r=>r.metadata.persistenceStatus='pending',r=>delete r.metadata.compositionPreview.printDesignInput,r=>r.metadata.compositionPreview.printDesignState.mode='bad']){const changed=clone(row);mutation(changed);assert.equal(remoteResume.readPrintDesignRemoteResume([changed],row.job_id,scope),null);}
 assert.equal(remoteResume.readPrintDesignRemoteResume([row,row],row.job_id,scope),null);
});
test('canonical source paths retain original input identity; missing original bytes never become alternative inputs',async()=>{
 const f=await fixture('print-design-detail');await f.run();const row=f.remoteRow(),scope={brandId,scopeId:userId,toolId:'print-design-detail'};
 const slot=row.metadata.compositionPreview.printDesignInput.materialSlots[0];slot.sourceStoragePath='generated-images/original-source';slot.sourceImageId='original-source';slot.imageUrl='https://expired.test/bearer';slot.localAssetRef='';
 const restored=remoteResume.readPrintDesignRemoteResume([row],row.job_id,scope);assert.ok(restored);assert.equal(restored.input.slots[0].sourceStoragePath,'generated-images/original-source');assert.equal(restored.input.slots[0].imageUrl,'');
 slot.sourceStoragePath=null;slot.imageUrl='https://expired.test/bearer';assert.equal(remoteResume.readPrintDesignRemoteResume([row],row.job_id,scope),null);
});
test('failed workspace save is not a remote restoration success and retained retry stays one inference',async()=>{
 const f=await fixture('print-design-project');f.set({saveFailure:true});await f.run();assert.equal(f.ui.result,null);assert.equal(f.counts.ack,0);
 const row=f.remoteRow(),bad=clone(row);bad.metadata.persistenceStatus='pending';assert.equal(remoteResume.readPrintDesignRemoteResume([bad],row.job_id,{brandId,scopeId:userId,toolId:'print-design-project'}),null);
 f.set({saveFailure:false});await f.run();assert.equal(f.counts.post,1);assert.equal(f.counts.get,1);assert.equal(f.counts.ack,1);
});

test('actual remote-only resume caller reads exact job, restores coherent UI, and fences scope/read/bytes failures',async()=>{
 const effect=nodes.find(n=>ts.isCallExpression(n)&&n.expression.getText(parsed)==='useEffect'&&n.arguments[0]?.getText(parsed).includes("const resumeJob = searchParams.get('resumeJob')"));
 const code=ts.transpile(`const extracted=${effect.arguments[0].getText(parsed)}; extracted;`,{target:ts.ScriptTarget.ES2022});
 for(const failure of ['none','scope','read','bytes','invalid']){
  const f=await fixture('print-design-detail');await f.run();const row=f.remoteRow();globalThis.localStorage.removeItem(workspace.getWorkspaceArtifactStorageKey(brandId,userId));
  if(failure==='invalid')row.metadata.compositionPreview.printDesignState.mode='bad';
  const state={},scopeRef={current:'scope'};let finish;const done=new Promise(resolve=>finish=resolve);const noop=()=>{};
  const before=clone(f.counts),bindings=new Proxy({isFeatureDetail:true,workbenchScopeRef:scopeRef,workbenchMountedRef:{current:true},lightchainResultRef:{current:null},materialSlotReleasesRef:{current:{}},resultReleaseRef:{current:null},searchParams:new URLSearchParams({resumeJob:row.job_id}),currentBrand:{id:brandId},user:{id:userId},selectedTool:{id:'print-design-detail'},
   hydrateGenerationIntentSource:()=>null,captureCurrentAuthBrandFence:()=>({}),assertCurrentAuthBrandFence:noop,listWorkspaceArtifacts:workspace.listWorkspaceArtifacts,readLightchainResumeInput:resume.readLightchainResumeInput,readLightchainResumeResult:resume.readLightchainResumeResult,readPrintDesignRemoteResume:remoteResume.readPrintDesignRemoteResume,
   cloudflareDataPlane:{listGeneratedImages:async(brand,options)=>{assert.equal(brand,brandId);assert.equal(options.jobId,row.job_id);assert.equal(options.featureType,'lightchain-print-design-detail');if(failure==='scope')scopeRef.current='changed';if(failure==='read')throw new Error('read_unavailable');return [row];}},
   isLocalCanvasAssetReference:assets.isLocalCanvasAssetReference,resolveLocalCanvasAsset:async ref=>failure==='bytes'?null:{source:f.sourceBytes,release:noop},withSignedImageUrls:async rows=>rows.map(r=>({...r,image_url:'fresh-result-url'})),
   setMaterialSlotFiles:v=>state.slots=v,setPrintDesignMode:v=>state.mode=v,setPrintDesignStyle:v=>state.style=v,setPrintDesignPrompt:v=>state.prompt=v,setLightchainResult:v=>state.result=v,
   setResumeInputReadback:v=>{state.status=v;if(v!==null)finish();},defaultModelFormState:{},
  },{has:()=>true,get:(target,key)=>{if(key===Symbol.unscopables)return undefined;if(key in target)return target[key];if(key in globalThis)return globalThis[key];return noop;}});
  const run=new Function('bindings',`with(bindings){${code.replace(/extracted;\s*$/,'return extracted;')}}`)(bindings);run();
  if(failure==='scope'){await new Promise(resolve=>setImmediate(resolve));assert.equal(state.result,null);assert.equal(state.slots.primary,null);}else{
   await done;if(failure==='none'){assert.equal(state.status,'restored');assert.equal(state.mode,'guide');assert.equal(state.prompt,'  original print brief  ');assert.equal(state.result.jobId,row.job_id);assert.equal(state.slots.primary.imageUrl,f.sourceBytes);}
   else{assert.equal(state.status,'unavailable');assert.equal(state.result,null);}
  }
  assert.deepEqual(f.counts,before);
 }
});

test('remote no-guide restores empty prompt and no material without fabricating inputs',async()=>{
 const f=await fixture('print-design-project');await f.run();const row=f.remoteRow(),composition=row.metadata.compositionPreview;composition.printDesignState={version:1,mode:'no-guide',style:'ホーム',prompt:''};composition.printDesignInput={version:1,materialSlots:[],brief:'',referenceNote:''};
 const restored=remoteResume.readPrintDesignRemoteResume([row],row.job_id,{brandId,scopeId:userId,toolId:'print-design-project'});assert.ok(restored);assert.equal(restored.input.printDesignState.prompt,'');assert.equal(restored.input.slots.length,0);
});
