import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {createServer} from 'vite';
import {createPendingIndexedDbHarness,createPendingLegacyStorage} from './verify-cloudflare-image-pending-store.test.mjs';
const root=new URL('..',import.meta.url).pathname;
const original={window:globalThis.window,localStorage:globalThis.localStorage,indexedDB:globalThis.indexedDB,FileReader:globalThis.FileReader};
const vite=await createServer({root,configFile:false,envFile:false,cacheDir:`/tmp/library-original-${process.pid}`,appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{name:'library-read-only-fixture',enforce:'pre',resolveId(id){if(/\/storage(?:\.ts)?$/.test(id))return '\0fixture-storage';if(/\/cloudflareApi(?:\.ts)?$/.test(id))return '\0fixture-cloudflare';},load(id){if(id==='\0fixture-storage')return 'export const withSignedImageUrls=(...args)=>globalThis.__librarySign(...args);';if(id==='\0fixture-cloudflare')return 'export class ArtifactPersistenceContextError extends Error{};export const cloudflareDataPlane=null;';}}]});
const assets=await vite.ssrLoadModule('/src/lib/canvasLocalAssets.ts');
const readback=await vite.ssrLoadModule('/src/lib/workspaceArtifactImageReadback.ts');
const workspace=await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
const auth=await vite.ssrLoadModule('/src/lib/authBrandSelection.ts');
globalThis.FileReader=class {readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onload();},()=>this.onerror());}};
const scope={brandId:'brand',userId:'alice'};
async function fixture(){globalThis.indexedDB=createPendingIndexedDbHarness();const revision=crypto.randomUUID();const bytes=Buffer.from('original garment bytes');await assets.putLocalCanvasAsset(revision,new Blob([bytes],{type:'image/png'}));return {bytes,artifact:{id:'original-id',brandId:'brand',scopeId:'alice',featureType:'library',title:'garment',prompt:null,createdAt:'2026-10-02',imageUrl:assets.buildLocalCanvasAssetReference(revision),metadata:{}}};}
const parsed={};
for(const [name,file] of [['library','LightchainLibraryPage.tsx'],['workbench','LightchainWorkbenchPage.tsx'],['fitting','FittingPage.tsx'],['material','LightchainMaterialWorkbenchPage.tsx']]){
 const text=await fs.readFile(new URL(`../src/pages/${file}`,import.meta.url),'utf8');const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const nodes=[];const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(ast);parsed[name]={ast,nodes};
}
test('actual readback restores exact IndexedDB bytes and stable original identity without signing',async()=>{
 const f=await fixture();globalThis.__librarySign=()=>{throw new Error('must_not_sign_local');};const restored=await readback.readWorkspaceArtifactImage(f.artifact,scope);assert.deepEqual(Buffer.from(restored.imageUrl.split(',')[1],'base64'),f.bytes);assert.equal(restored.localAssetRef,f.artifact.imageUrl);assert.equal(restored.storagePath,null);assert.ok(f.artifact.imageUrl.startsWith('local-canvas-asset://'));
});
test('canonical path takes precedence and signing failure never falls back to stale URL or local bytes',async()=>{
 const f=await fixture();f.artifact.metadata.remoteStoragePath='generated-images/original';f.artifact.imageUrl='https://expired.test/bearer';let count=0;globalThis.__librarySign=async rows=>{count++;assert.deepEqual(rows,[{storage_path:'generated-images/original',image_url:''}]);return [{image_url:'fresh-url'}];};const restored=await readback.readWorkspaceArtifactImage(f.artifact,scope);assert.equal(restored.storagePath,'generated-images/original');assert.equal(restored.imageUrl,'fresh-url');
 globalThis.__librarySign=async()=>[];await assert.rejects(readback.readWorkspaceArtifactImage(f.artifact,scope),/signing_failed/);assert.equal(count,1);
});
test('foreign scope and missing/invalid original bytes are unavailable, never substituted',async()=>{
 const f=await fixture();for(const wrong of [{brandId:'other',userId:'alice'},{brandId:'brand',userId:'bob'},{brandId:'brand',userId:''}])await assert.rejects(readback.readWorkspaceArtifactImage(f.artifact,wrong),/scope_mismatch/);
 f.artifact.imageUrl=assets.buildLocalCanvasAssetReference('missing');await assert.rejects(readback.readWorkspaceArtifactImage(f.artifact,scope),/bytes_unavailable/);
 await assets.putLocalCanvasAsset('bad',new Blob(['text'],{type:'text/plain'}));f.artifact.imageUrl=assets.buildLocalCanvasAssetReference('bad');await assert.rejects(readback.readWorkspaceArtifactImage(f.artifact,scope),/bytes_unavailable/);
 f.artifact.imageUrl='https://expired.test/bearer';await assert.rejects(readback.readWorkspaceArtifactImage(f.artifact,scope),/source_unavailable/);
});
const evaluate=(code,bindings)=>new Function('bindings',`with(bindings){${ts.transpile(`return (${code});`,{target:ts.ScriptTarget.ES2022})}}`)(new Proxy(bindings,{has:()=>true,get:(o,k)=>k===Symbol.unscopables?undefined:k in o?o[k]:String(k).startsWith('set')?()=>{}:globalThis[k]}));
const idle=()=>new Promise(resolve=>setImmediate(resolve));
const material=parsed.material;
const materialSession=material.nodes.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='LightchainMaterialWorkbenchSession');
const materialVariable=name=>material.nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(material.ast)===name);
const materialStatements=materialSession.body.statements;
const materialRenderStart=materialStatements.findIndex(n=>n.getText(material.ast).startsWith('const libraryRenderContextKey ='));
const materialLayoutEnd=materialStatements.findIndex((n,i)=>i>materialRenderStart&&ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(material.ast)==='useLayoutEffect');
assert.ok(materialRenderStart>=0&&materialLayoutEnd>materialRenderStart,'actual material render/lifetime source is required');
const materialRenderSource=[materialVariable('libraryHandoff').parent.parent.getText(material.ast),...materialStatements.slice(materialRenderStart,materialLayoutEnd+1).map(n=>n.getText(material.ast))].join('\n');
const materialHelperSource=['captureCurrentAuthBrandFence','assertCurrentAuthBrandFence'].map(name=>materialVariable(name).parent.parent.getText(material.ast)).join('\n');
function bindMaterialFixture(bindings){
 let live={user:bindings.user,currentBrand:bindings.currentBrand,isInitialized:bindings.isAuthInitialized,isLoading:bindings.isAuthLoading,
  brandState:{status:'success_nonempty',userId:'alice',requestGeneration:1,confirmedBrandIds:['brand'],error:null}};
 const refs=[];let refIndex=0,layoutSetup;
 Object.assign(bindings,{...auth,brandState:live.brandState,location:{pathname:'/fabric-image',search:'?libraryArtifactId=original-id&librarySlot=fabric-design'},
  useAuthStore:{getState:()=>live},useMemo:fn=>fn(),useRef:value=>refs[refIndex++]??(refs[refIndex-1]={current:value}),useLayoutEffect:setup=>{layoutSetup=setup;}});
 const rendered=evaluate(`(()=>{${materialRenderSource}\nreturn {libraryHandoff,libraryRenderContextRef,libraryRenderRevision,libraryMountLifetimeRef};})()`,bindings);
 Object.assign(bindings,rendered,evaluate(`(()=>{${materialHelperSource}\nreturn {captureCurrentAuthBrandFence,assertCurrentAuthBrandFence};})()`,bindings));
 const layoutCleanup=layoutSetup();
 return {unmount:layoutCleanup,revokeFreshAuth:()=>{live={...live,brandState:{...live.brandState,confirmedBrandIds:[]}};}};
}
const workbench=parsed.workbench;
const workbenchSession=workbench.nodes.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='LightchainWorkbenchWorkspace');
const workbenchVariable=name=>workbench.nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(workbench.ast)===name);
const workbenchStatements=workbenchSession.body.statements;
const workbenchRenderStart=workbenchStatements.findIndex(n=>n.getText(workbench.ast).startsWith('const libraryRenderContextKey ='));
const workbenchLayoutEnd=workbenchStatements.findIndex((n,i)=>i>workbenchRenderStart&&ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(workbench.ast)==='useLayoutEffect');
assert.ok(workbenchRenderStart>=0&&workbenchLayoutEnd>workbenchRenderStart,'actual workbench render/lifetime source is required');
const workbenchRenderSource=workbenchStatements.slice(workbenchRenderStart,workbenchLayoutEnd+1).map(n=>n.getText(workbench.ast)).join('\n');
const workbenchHelperSource=['captureCurrentAuthBrandFence','assertCurrentAuthBrandFence'].map(name=>workbenchVariable(name).parent.parent.getText(workbench.ast)).join('\n');
const evaluateWorkbench=(code,bindings)=>new Function('bindings',`with(bindings){${ts.transpile(`return (${code});`,{target:ts.ScriptTarget.ES2022})}}`)(new Proxy(bindings,{has:()=>true,get:(o,k)=>{
 if(k===Symbol.unscopables)return undefined;
 if(k in o)return o[k];
 // Only unused UI setters may be omitted; every guard dependency must be real and explicitly bound.
 if(String(k).startsWith('set'))return ()=>{};
 if(k==='JSON')return JSON;
 throw new Error(`unexpected_workbench_binding:${String(k)}`);
}}));
function bindWorkbenchFixture(bindings){
 let live={user:bindings.user,currentBrand:bindings.currentBrand,isInitialized:bindings.isAuthInitialized,isLoading:bindings.isAuthLoading,
  brandState:{status:'success_nonempty',userId:'alice',requestGeneration:1,confirmedBrandIds:['brand'],error:null}};
 const refs=[];let refIndex=0,layoutSetup;
 Object.assign(bindings,{...auth,brandState:live.brandState,location:{pathname:'/model',search:'?libraryArtifactId=original-id',hash:''},
  selectedTool:{id:'ai-fitting'},isFeatureDetail:true,useAuthStore:{getState:()=>live},
  useRef:value=>refs[refIndex++]??(refs[refIndex-1]={current:value}),useLayoutEffect:setup=>{layoutSetup=setup;}});
 const rendered=evaluateWorkbench(`(()=>{${workbenchRenderSource}\nreturn {libraryRenderContextRef,libraryRenderRevision,libraryMountLifetimeRef};})()`,bindings);
 Object.assign(bindings,rendered,evaluateWorkbench(`(()=>{${workbenchHelperSource}\nreturn {captureCurrentAuthBrandFence,assertCurrentAuthBrandFence};})()`,bindings));
 const layoutCleanup=layoutSetup();
 return {unmount:layoutCleanup};
}
const fitting=parsed.fitting;
const fittingSession=fitting.nodes.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='FittingWorkspace');
const fittingVariable=name=>fitting.nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(fitting.ast)===name);
const fittingStatements=fittingSession.body.statements;
const fittingRenderStart=fittingStatements.findIndex(n=>n.getText(fitting.ast).startsWith('const libraryRenderContextKey ='));
const fittingLayoutEnd=fittingStatements.findIndex((n,i)=>i>fittingRenderStart&&ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(fitting.ast)==='useLayoutEffect');
assert.ok(fittingRenderStart>=0&&fittingLayoutEnd>fittingRenderStart,'actual fitting render/lifetime source is required');
const fittingRenderSource=fittingStatements.slice(fittingRenderStart,fittingLayoutEnd+1).map(n=>n.getText(fitting.ast)).join('\n');
const fittingHelperSource=['captureCurrentAuthBrandFence','assertCurrentAuthBrandFence'].map(name=>fittingVariable(name).parent.parent.getText(fitting.ast)).join('\n');
const evaluateFitting=(code,bindings)=>new Function('bindings',`with(bindings){${ts.transpile(`return (${code});`,{target:ts.ScriptTarget.ES2022})}}`)(new Proxy(bindings,{has:()=>true,get:(o,k)=>{
 if(k===Symbol.unscopables)return undefined;
 if(k in o)return o[k];
 if(k==='JSON')return JSON;
 throw new Error(`unexpected_fitting_binding:${String(k)}`);
}}));
function bindFittingFixture(bindings){
 const live={user:bindings.user,currentBrand:bindings.currentBrand,isInitialized:bindings.isAuthInitialized,isLoading:bindings.isAuthLoading,
  brandState:{status:'success_nonempty',userId:'alice',requestGeneration:1,confirmedBrandIds:['brand'],error:null}};
 const refs=[];let refIndex=0,layoutSetup;
 Object.assign(bindings,{...auth,brandState:live.brandState,location:{pathname:'/fitting',search:'?libraryArtifactId=original-id',hash:''},
  useAuthStore:{getState:()=>live},useRef:value=>refs[refIndex++]??(refs[refIndex-1]={current:value}),useLayoutEffect:setup=>{layoutSetup=setup;},
  setErrorMessage:()=>{},setFittingDraftPersistenceMessage:()=>{}});
 const rendered=evaluateFitting(`(()=>{${fittingRenderSource}\nreturn {libraryRenderContextRef,libraryRenderRevision,libraryMountLifetimeRef};})()`,bindings);
 Object.assign(bindings,rendered,evaluateFitting(`(()=>{${fittingHelperSource}\nreturn {captureCurrentAuthBrandFence,assertCurrentAuthBrandFence};})()`,bindings));
 return {unmount:layoutSetup()};
}
test('actual Library preview effect reads original bytes without replacing persisted artifact URLs; late completion is discarded',async()=>{
 const {ast,nodes}=parsed.library,effect=nodes.find(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0].getText(ast).includes('const localArtifacts'));
 for(const cancelled of [false,true]){const f=await fixture();const state={};let release;const pending=new Promise(resolve=>release=resolve);const b={currentBrand:{id:'brand'},user:{id:'alice'},listWorkspaceArtifacts:()=>[f.artifact],setArtifacts:v=>state.artifacts=v,setLocalPreviews:v=>state.previews=v,readWorkspaceArtifactImage:async(...args)=>{await pending;return readback.readWorkspaceArtifactImage(...args);}};
 const cleanup=evaluate(effect.arguments[0].getText(ast),b)();if(cancelled)cleanup();release();await new Promise(resolve=>setTimeout(resolve,50));assert.equal(state.artifacts[0].imageUrl,f.artifact.imageUrl);if(cancelled)assert.equal(state.previews.scope,null);else{assert.equal(state.previews.scope,JSON.stringify(['brand','alice']));assert.deepEqual(Buffer.from(state.previews.urls[f.artifact.id].split(',')[1],'base64'),f.bytes);}}
});
for(const page of ['workbench','fitting','material'])test(`${page}: actual Library handoff adopts original bytes/identity and rejects failed or cancelled restoration`,async()=>{
 const {ast,nodes}=parsed[page],target=page==='material'?'restoreLibraryMaterial':'restoreLibraryArtifact';const effect=nodes.find(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0].getText(ast).includes(`const ${target} = async`));
 for(const failure of ['none','missing','cancelled']){const f=await fixture();if(failure==='missing')f.artifact.imageUrl=assets.buildLocalCanvasAssetReference('missing');const state={};let release;const pending=new Promise(resolve=>release=resolve);
 const b={currentBrand:{id:'brand'},user:{id:'alice'},searchParams:new URLSearchParams({libraryArtifactId:f.artifact.id}),libraryArtifactId:f.artifact.id,libraryHandoff:{artifactId:f.artifact.id,slot:'fabric-design'},isAuthInitialized:true,isAuthLoading:false,isPrinting:false,listWorkspaceArtifacts:()=>[f.artifact],readWorkspaceArtifactImage:async(...args)=>{await pending;return readback.readWorkspaceArtifactImage(...args);},
  setMaterialSlotFiles:v=>state.slots=v,setMaterialReference:v=>state.reference=v,setFabricDesign:v=>state.design=v,setResumeInputReadback:v=>state.status=v,setFittingDraftPersistenceStatus:v=>state.persistence=v,initialMaterialReference:{},metadataString:()=>null,resetWorkbenchMaskState:()=>{},toast:{error:v=>state.error=v}};
 const materialFixture=page==='material'?bindMaterialFixture(b):null;
 const workbenchFixture=page==='workbench'?bindWorkbenchFixture(b):null;
 const fittingFixture=page==='fitting'?bindFittingFixture(b):null;
 const cleanup=(page==='workbench'?evaluateWorkbench:page==='fitting'?evaluateFitting:evaluate)(effect.arguments[0].getText(ast),b)();if(failure==='cancelled')cleanup();release();await new Promise(resolve=>setTimeout(resolve,50));
 const adopted=page==='workbench'?state.slots?.primary:page==='fitting'?state.reference:state.design;
 if(failure==='none'){assert.ok(adopted);const url=adopted.imageUrl??adopted.url;assert.deepEqual(Buffer.from(url.split(',')[1],'base64'),f.bytes);assert.equal(adopted.sourceImageId??adopted.galleryImageId,f.artifact.id);if(page==='workbench')assert.equal(adopted.localAssetRef,f.artifact.imageUrl);}
 else{assert.equal(adopted,undefined);if(failure==='missing')assert.ok(state.status==='unavailable'||state.error);}
 materialFixture?.unmount();workbenchFixture?.unmount();fittingFixture?.unmount();
 }
});

test('material: revoked fresh auth after the original image read starts prevents adoption and every material commit',async()=>{
 const f=await fixture(),state={},commits=[];
 let release,readStarted=0,readCompleted=0;
 const pending=new Promise(resolve=>release=resolve);
 const b={currentBrand:{id:'brand'},user:{id:'alice'},isAuthInitialized:true,isAuthLoading:false,isPrinting:false,
  listWorkspaceArtifacts:()=>[f.artifact],readWorkspaceArtifactImage:async(...args)=>{readStarted++;await pending;const restored=await readback.readWorkspaceArtifactImage(...args);readCompleted++;return restored;},
  setFabricBase:v=>{commits.push(['base',v]);state.base=v;},setFabricDesign:v=>{commits.push(['design',v]);state.design=v;},
  selectPrintGarment:v=>{commits.push(['garment',v]);state.garment=v;},addDesigns:async v=>{commits.push(['printing-design',v]);state.printingDesign=v;return {ok:true};},toast:{error:v=>state.error=v}};
 const materialFixture=bindMaterialFixture(b);
 const effect=material.nodes.find(n=>ts.isCallExpression(n)&&n.expression.getText(material.ast)==='useEffect'&&n.arguments[0].getText(material.ast).includes('const restoreLibraryMaterial = async'));
 const cleanup=evaluate(effect.arguments[0].getText(material.ast),b)();
 try{
  assert.equal(readStarted,1,'the actual restoration must start before auth is revoked');
  materialFixture.revokeFreshAuth();release();
  for(let turn=0;turn<100&&readCompleted===0;turn++)await idle();
  assert.equal(readCompleted,1,'the production image reader must finish before checking the post-read fence');
  await idle();
  assert.deepEqual(commits,[]);assert.equal(state.design,undefined);assert.equal(state.base,undefined);assert.equal(state.garment,undefined);assert.equal(state.printingDesign,undefined);assert.equal(state.error,undefined);
 }finally{cleanup();materialFixture.unmount();}
});

test('actual card preview keeps fresh inline upload usable and excludes opaque/stale sources',()=>{
 const {ast,nodes}=parsed.library,fn=nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='cardImageUrl').initializer.getText(ast);
 const b={localPreviews:{scope:'scope',urls:{}},libraryScope:'scope',getWorkspaceArtifactCanonicalStoragePath:metadata=>metadata.remoteStoragePath??null};const url=evaluate(fn,b);
 const artifact={id:'source',metadata:{},imageUrl:'data:image/png;base64,AQ=='};assert.equal(url({kind:'local',artifact}),artifact.imageUrl);
 artifact.imageUrl='local-canvas-asset://original';assert.equal(url({kind:'local',artifact}),'');artifact.imageUrl='https://expired.test/bearer';artifact.metadata.remoteStoragePath='generated-images/original';assert.equal(url({kind:'local',artifact}),'');
 b.localPreviews.urls.source='fresh-url';assert.equal(url({kind:'local',artifact}),'fresh-url');b.libraryScope='new-scope';assert.equal(url({kind:'local',artifact}),'');
});

test('actual workspace save and module reload preserve owned local reference and original bytes without remote URL acceptance',async()=>{
 const f=await fixture(),storage=createPendingLegacyStorage(new Map());globalThis.window={localStorage:storage,dispatchEvent(){}};globalThis.localStorage=storage;
 const saved=workspace.saveWorkspaceArtifactPersisted(f.artifact);assert.equal(saved.ok,true,saved.error?.message);assert.equal(saved.artifact.id,f.artifact.id);assert.equal(saved.artifact.imageUrl,f.artifact.imageUrl);
 const reloaded=await vite.ssrLoadModule(`/src/lib/localWorkspaceArtifacts.ts?reload=${crypto.randomUUID()}`);const [artifact]=reloaded.listWorkspaceArtifacts(scope.brandId,scope.userId);assert.equal(artifact.imageUrl,f.artifact.imageUrl);assert.equal(reloaded.listWorkspaceArtifacts(scope.brandId,'bob').length,0);
 const restored=await readback.readWorkspaceArtifactImage(artifact,scope);assert.deepEqual(Buffer.from(restored.imageUrl.split(',')[1],'base64'),f.bytes);
 const unsafe=workspace.saveWorkspaceArtifactPersisted({...f.artifact,id:'unsafe-new',imageUrl:'https://expired.test/bearer'});assert.equal(unsafe.ok,false);
});
after(async()=>{Object.assign(globalThis,original);delete globalThis.__librarySign;await vite.close();});
