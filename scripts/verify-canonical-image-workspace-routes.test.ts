import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,type Browser,type Page} from '@playwright/test';
import {createServer} from 'vite';

// Imports production App itself: its BrowserRouter, HeavyCanonicalRouteBoundary,
// protected wrappers and lazy canonical destinations remain in the fixture.
const source=String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';
import App from '/src/App.tsx';
import {useAuthStore} from '/src/stores/authStore.ts';
import {useCanvasStore} from '/src/stores/canvasStore.ts';
import {saveWorkspaceArtifactPersisted,listWorkspaceArtifacts} from '/src/lib/localWorkspaceArtifacts.ts';
import {generateModelMatrix,normalizeCompletedModelMatrixResult} from '/src/lib/imageApi.ts';
import {putLocalCanvasAsset,buildLocalCanvasAssetReference} from '/src/lib/canvasLocalAssets.ts';
const params=new URLSearchParams(location.search);
const featureFor=path=>{const aliases={'model-face':'head-form','model-change':'model-change-form','body-shape':'body-form','clothing-size':'size-form','pose-change':'pose-form','background-change':'background-form','angle-change':'perspective-form'};for(const [id,form]of Object.entries(aliases))if(path.endsWith('/'+id)||path.endsWith('/'+form))return id;
 if(path==='/heavy/wear-design-lab'||path==='/flow/orientedDesign')return 'wear-design-lab';if(/wear-design|orientedDesign/.test(path))return params.get('workspaceFeature')==='wear-design-lab'?'wear-design-lab':'wear-design-detail';if(/printing/.test(path))return 'printing-image';if(/pattern-vector-pro|vector-special/.test(path))return 'pattern-vector-pro';if(/pattern-vector|pattern-to-vector/.test(path))return 'pattern-vector';if(path==='/heavy/model-custom')return 'model-custom';if(/model-library/.test(path))return params.get('workspaceFeature')||'model-library';return 'lab';};
const tool=params.get('seedFeature')||featureFor(location.pathname);
window.__artifacts=()=>listWorkspaceArtifacts('brand','owner');window.__modelAdapter=generateModelMatrix;window.__normalizeMatrix=normalizeCompletedModelMatrixResult;
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="teal"/></svg>';
await putLocalCanvasAsset('fixture-reference',new Blob([svg],{type:'image/svg+xml'}));
const key='canonical-fixture-server';window.__server=JSON.parse(sessionStorage.getItem(key)||'null')||{calls:[],reads:[],persists:[],requests:{},events:[],mode:'success'};
window.__save=()=>sessionStorage.setItem(key,JSON.stringify(window.__server));
window.__held={sign:[],provider:[],persist:[],upload:[]};window.__holdSign=params.has('hold');
window.__release=(kind)=>window.__held[kind].splice(0).forEach(resolve=>resolve());
window.__created=[];window.__released=[];window.__canvas=[];
const createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=createURL(blob);window.__created.push(url);return url;};URL.revokeObjectURL=url=>{window.__released.push(url);revokeURL(url);};
const auth=(user='owner',brand='brand')=>({user:{id:user},currentBrand:{id:brand,name:'Workspace'},isInitialized:true,isLoading:false,authRecoveryRequired:false,authServiceUnavailable:false,
 brandState:{status:'success_nonempty',userId:user,requestGeneration:1,confirmedBrandIds:[brand],error:null}});
useAuthStore.setState(auth());window.__switch=(what)=>useAuthStore.setState(auth(what==='user'?'other-owner':'owner',what==='brand'?'other-brand':'brand'));
const makeArtifact=(job,original=true)=>({id:'fixture-'+tool+'-'+job,brandId:'brand',scopeId:'owner',featureType:'lightchain-'+tool+'-provider-result',title:'Saved '+job,imageUrl:'',prompt:null,sourceJobId:job,createdAt:'2026-10-01T00:00:00Z',
 metadata:{toolId:tool,...(params.has('matrix')?{modelCandidates:[0,1].map(index=>({imageId:'matrix-'+index,storagePath:'generated-images/'+(params.has('crossImageCandidates')?'unrelated-image':('matrix-'+index)),jobId:params.has('crossJobCandidates')?'other-job':job,bodyType:index?'slim':'regular',ageGroup:'20s',provider:'openai'})),...(params.has('noSelection')?{}:{selectedCandidateId:'matrix-1'})}:{}),inputState:{coverage:'full',layerModes:['split'],gender:'女性',half:true,age:'青年',nationality:'日本',skinColor:'白い肌',bodyType:'痩せ型',bodyTypes:params.has('matrix')?['regular','slim']:['regular'],ageGroups:['20s']},providerResultArtifact:true,imageId:params.has('matrix')&&params.has('noSelection')?'matrix-1':'result-'+job,storagePath:params.has('matrix')&&params.has('noSelection')?'generated-images/matrix-1':'generated-images/result-'+job,provider:'openai',...(original?{brief:'Exact original brief',referenceNote:'Exact original reference note',materialSlots:[
 {key:'primary',fileName:'source.png',materialKind:'primary',sourceImageId:'source-primary',sourceStoragePath:'generated-images/source-primary',imageUrl:''},
 {key:'secondary',fileName:'local.svg',materialKind:'secondary',imageUrl:buildLocalCanvasAssetReference('fixture-reference')}].filter(()=>!params.has('textOnly'))}:{})}});
const save=artifact=>{const result=saveWorkspaceArtifactPersisted(artifact);if(!result.ok)throw result.error;};
if(!params.has('remoteOnly')&&!listWorkspaceArtifacts('brand','owner').some(artifact=>artifact.sourceJobId==='exact-job'&&artifact.metadata.toolId===tool))save(makeArtifact('exact-job',!params.has('legacy')));save({...makeArtifact('latest-job'),createdAt:'2026-10-02T00:00:00Z'});
for(const method of ['getState','setState','subscribe'])useCanvasStore[method]=()=>{window.__canvas.push(method);throw new Error('global_canvas_access:'+method);};
window.__navigate=href=>{history.pushState(null,'',href);window.dispatchEvent(new PopStateEvent('popstate'));};
const root=createRoot(document.getElementById('fixture-root'));window.__unmount=()=>root.render(null);
root.render(React.createElement(React.StrictMode,null,React.createElement(App)));window.__ready=true;
`;
const storage=String.raw`
export async function withSignedImageUrls(images){return Promise.all(images.map(async image=>{
 if(window.__server.mode==='sign-fail'&&image.storage_path==='generated-images/result-exact-job')throw new Error('fixture_definite_sign_failure');
 if(window.__holdSign&&image.storage_path==='generated-images/source-primary')await new Promise(resolve=>window.__held.sign.push(resolve));
 return {...image,image_url:'/__image__?path='+encodeURIComponent(image.storage_path)};}));}
`;
const image=String.raw`
export {assertCompletedImageEditResult,assertCompletedModelMatrixResult,normalizeCompletedModelMatrixResult,generateModelMatrix} from '/src/lib/imageApi.ts';
const result=id=>({success:true,state:'completed',status:'completed',requestId:id,recovery:'none',persistenceStatus:'completed',requestedCandidateCount:1,persistedCandidateCount:1,
 imageUrl:'/__image__?path='+id,jobId:'generated-'+id,imageId:'image-'+id,storagePath:'generated-images/image-'+id,provider:'openai',images:[{imageUrl:'/__image__?path='+id,jobId:'generated-'+id,imageId:'image-'+id,storagePath:'generated-images/image-'+id,persistenceStatus:'completed',candidateIndex:0}]});
window.__completed=result;
async function invoke(action,url,prompt,brand,options){options.assertContext();const s=window.__server,id=options.idempotencyKey;
 s.calls.push({action,url,prompt,brand,id,references:options.referenceImageUrls||[],rights:options.rightsConfirmed,feature:options.lightchainCompat?.lightchainFeatureId,materialReferences:options.materialReferences});s.events.push('PROVIDER:'+id);s.requests[id]=result(id);window.__save();
 if(s.mode==='hold-provider')await new Promise(resolve=>window.__held.provider.push(resolve));options.assertContext();
 if(s.mode==='failed')return {success:false,state:'failed',requestId:id,error:'fixture_failed'};
 if(s.mode==='throw-provider'){s.requests[id]={success:false,state:'unknown',requestId:id};window.__save();throw new Error('fixture_uncertain_provider_transport');}
 if(s.mode==='unknown'){s.requests[id]={success:false,state:'unknown',requestId:id};window.__save();return s.requests[id];}
 return s.requests[id];}
export const generateImage=(prompt,brand,options)=>invoke('generate',null,prompt,brand,options);
export const editImageWithPrompt=(url,prompt,brand,options)=>invoke('edit',url,prompt,brand,options);
`;
const cloudflare=String.raw`
export const cloudflareDataPlane={
 async invokeProviderAction(action,body,options){await options.assertContext?.();const s=window.__server,id=options.idempotencyKey;
 s.calls.push({action,body,id,retain:options.retainUntilAcknowledged,assertContext:typeof options.assertContext==='function',feature:body.lightchainCompat?.lightchainFeatureId});s.events.push('PROVIDER:'+id);window.__save();
 const pairs=(body.bodyTypes||['regular']).flatMap(bodyType=>(body.ageGroups||['20s']).map(ageGroup=>({bodyType,ageGroup})));
 const result={success:true,state:'completed',requestId:id,jobId:'matrix-job-'+id,provider:'openai',persistenceStatus:'completed',requestedCandidateCount:pairs.length,persistedCandidateCount:pairs.length,
 matrix:pairs.map((pair,index)=>({...pair,bodyTypeName:pair.bodyType,ageGroupName:pair.ageGroup,candidateIndex:index,imageId:'matrix-'+id+'-'+index,storagePath:'generated-images/matrix-'+id+'-'+index,imageUrl:'/__image__?matrix='+id+'-'+index,jobId:'matrix-job-'+id,provider:'openai',persistenceStatus:'completed'}))};
 if(s.mode==='incomplete-matrix')delete result.matrix[0].imageId;
 s.requests[id]=result;window.__save();if(s.mode==='hold-provider')await new Promise(resolve=>window.__held.provider.push(resolve));await options.assertContext?.();
 if(s.mode==='unknown'){s.requests[id]={success:false,state:'unknown',requestId:id};window.__save();return s.requests[id];}return result;},
 async listGeneratedImages(brand,options){window.__server.remoteReads=(window.__server.remoteReads||[]).concat({brand,...options});window.__save();const tool=new URLSearchParams(location.search).get('seedFeature')||(/model-library/.test(location.pathname)?new URLSearchParams(location.search).get('workspaceFeature')||'model-library':/orientedDesign/.test(location.pathname)?'wear-design-detail':'lab');return [
  {id:'foreign-result',job_id:options.jobId,brand_id:'foreign',user_id:'owner',feature_type:tool,storage_path:'generated-images/foreign'},
  {id:'remote-result',job_id:'remote-job',brand_id:'brand',user_id:'owner',feature_type:tool,storage_path:'generated-images/remote-result',prompt:'Provider result summary',created_at:'2026-10-01T00:00:00Z',metadata:{...(new URLSearchParams(location.search).has('matrix')?{toolId:tool,modelCandidates:[0,1].map(index=>({imageId:'remote-matrix-'+index,storagePath:'generated-images/remote-matrix-'+index,jobId:new URLSearchParams(location.search).has('crossJobCandidates')?'other-job':'remote-job',bodyType:index?'slim':'regular',ageGroup:'20s',provider:'openai'})),selectedCandidateId:'remote-matrix-0'}:{}),...(new URLSearchParams(location.search).has('remoteInputs')?{toolId:tool,brief:'Remote original brief',referenceNote:'',originalInputsAvailable:true,inputState:{gender:'女性',half:true,age:'青年',nationality:'日本',skinColor:'白い肌',bodyType:'痩せ型',bodyTypes:['regular','slim'],ageGroups:['20s']},materialSlots:[{key:'primary',fileName:'remote-source.png',materialKind:'primary',sourceImageId:'source-primary',sourceStoragePath:'generated-images/source-primary',imageUrl:''}]}:{})}}];},
 async captureArtifactPersistenceContext(options){await options.assertContext();return {assertCurrent:async()=>options.assertContext()};},
 async readImageAIRequest(id){window.__server.reads.push(id);window.__save();return window.__server.requests[id];},
 async acknowledgeImageAction(){}
};
`;
const persistence=String.raw`
import {saveWorkspaceArtifactPersisted} from '/src/lib/localWorkspaceArtifacts.ts';
export async function persistProviderResultArtifact(input,options){await options.persistenceContext.assertCurrent();const s=window.__server;
 s.persists.push(input);s.events.push('PERSIST_START:'+input.sourceJobId);window.__save();
 if(s.mode==='hold-persist')await new Promise(resolve=>window.__held.persist.push(resolve));await options.persistenceContext.assertCurrent();
 if(s.mode==='persist-fail')throw new Error('fixture_persist_failed');
 const remote={jobId:input.metadata.backendAction==='model-matrix'?(s.mode==='matrix-save-mismatch'?'unrelated-saved-job':input.sourceJobId):'saved-'+input.metadata.imageId,imageId:input.metadata.imageId,storagePath:input.storagePath};
 const result=saveWorkspaceArtifactPersisted({...input,id:remote.jobId,imageUrl:'',sourceJobId:remote.jobId,createdAt:new Date().toISOString(),metadata:{...input.metadata,providerResultArtifact:true,storagePath:input.storagePath}});
 if(!result.ok)throw result.error;s.events.push('PERSIST_DONE:'+remote.jobId);window.__save();return {artifact:result.artifact,remote,localPersisted:true};}
`;
type Fixture={page:Page;close():Promise<void>};
async function fixture(path:string):Promise<Fixture>{
 const stubs:Record<string,string>={'../lib/storage':storage,'../lib/imageApi':image,'../lib/cloudflareApi':cloudflare,'../lib/providerResultPersistence':persistence};
 const vite=await createServer({configFile:new URL('../vite.config.ts',import.meta.url).pathname,server:{host:'127.0.0.1',port:0},logLevel:'silent',
  define:{'import.meta.env.VITE_CLOUDFLARE_API_ENABLED':'"false"'},optimizeDeps:{include:['react','react-dom/client']},plugins:[{name:'canonical-app-fixture',enforce:'pre',resolveId(id,importer){
   if(importer?.endsWith('/src/components/lightchain/SourceModelLibrarySurface.tsx')&&id==='../../lib/cloudflareApi')return '\0canonical-stub:../lib/cloudflareApi';
   if(importer?.endsWith('/src/lib/imageApi.ts')&&id==='./cloudflareApi')return '\0canonical-stub:../lib/cloudflareApi';
   if(id==='/__fixture__.tsx')return '\0canonical-fixture';if(importer?.endsWith('/src/hooks/useCanonicalImageWorkspace.ts')&&id in stubs)return '\0canonical-stub:'+id;
  },load(id){if(id==='\0canonical-fixture')return source;if(id.startsWith('\0canonical-stub:'))return stubs[id.slice('\0canonical-stub:'.length)];}}]});
 let browser:Browser|undefined;const docs:string[]=[],errors:string[]=[];
 try{await vite.listen();const address=vite.httpServer!.address();assert(address&&typeof address==='object');const origin=`http://127.0.0.1:${address.port}`;
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(/\/v1\/(?:canvas|documents)|\/canvas-documents\//.test(url.pathname)){docs.push(url.pathname);return route.abort();}
   if(url.origin===origin&&/^\/(?:heavy|flow|tools|model-library)\//.test(url.pathname))return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="/src/index.css"></head><body><div id="fixture-root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('/__fixture__.tsx');</script></body></html>`});
   if(url.pathname==='/__image__')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="teal"/></svg>'});
   return url.origin===origin||url.protocol==='blob:'||url.protocol==='data:'?route.continue():route.abort();});
  await page.goto(origin+path);try{await page.waitForFunction(()=>Boolean((window as any).__ready),{}, {timeout:20000});}catch(e){throw new Error('actual_App_fixture_load:'+errors.join(';')+String(e));}
  return {page,close:async()=>{const canvas=await page.evaluate(()=>(window as any).__canvas);await browser?.close();await vite.close();assert.deepEqual(canvas,[]);assert.deepEqual(docs,[]);assert.deepEqual(errors,[]);}};
 }catch(e){await browser?.close();await vite.close();throw e;}
}
const saved=(page:Page,job='exact-job')=>page.locator(`main[data-resume-job="${job}"]`).waitFor();
const familySaved=(page:Page,job='exact-job')=>page.locator(`[data-workspace-feature][data-resume-job="${job}"]`).first().waitFor();
const uploadSVG=async(page:Page,input:any,name='source.svg')=>{await input.setInputFiles({name,mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="teal"/></svg>')});await page.waitForFunction(name=>Array.from(document.querySelectorAll('img')).some(image=>image.src.startsWith('blob:')),name);};
const server=(page:Page)=>page.evaluate(()=>(window as any).__server);
const detail=async(page:Page)=>{await page.getByRole('button',{name:'編集を続ける',exact:true}).click();await page.getByTestId('lightchain-lab-detail').waitFor();};

test('actual App heavy/lab canonical home -> continue -> detail -> reload restores exact available inputs/result without inference and keeps query/hash',async()=>{
 const f=await fixture('/heavy/lab?resumeJob=exact-job&keep=yes#context');try{await saved(f.page);assert.equal(new URL(f.page.url()).pathname,'/flow/laboratory');
  assert.equal(await f.page.getByRole('img',{name:'保存されたラボ画像'}).count(),1);await detail(f.page);await saved(f.page);
  assert.equal(new URL(f.page.url()).pathname,'/flow/laboratory/detail');assert.equal(new URL(f.page.url()).searchParams.get('keep'),'yes');assert.equal(new URL(f.page.url()).hash,'#context');
  assert.equal(await f.page.getByLabel('依頼',{exact:true}).inputValue(),'Exact original brief');assert.equal(await f.page.getByLabel('参考メモ',{exact:true}).inputValue(),'Exact original reference note');
  assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-primary-source'),'source-primary');assert.match(await f.page.locator('main[data-resume-state]').getAttribute('data-secondary-source')??'',/^local-canvas-asset:/);
  await f.page.reload();await saved(f.page);assert.equal(await f.page.getByLabel('依頼',{exact:true}).inputValue(),'Exact original brief');assert.equal((await server(f.page)).calls.length,0);
 }finally{await f.close();}
});

test('actual App heavy/wear-design-detail boundary restores editable exact input/result; first-state parity adds no control overlay',async t=>{
 const f=await fixture('/heavy/wear-design-detail?resumeJob=exact-job&keep=yes#context');try{await saved(f.page);assert.equal(new URL(f.page.url()).pathname,'/flow/orientedDesign/detail');assert.equal(await f.page.getByLabel('依頼',{exact:true}).inputValue(),'Exact original brief');assert.equal((await server(f.page)).calls.length,0);}finally{await f.close();}
 for(const path of ['/flow/laboratory/detail','/flow/orientedDesign/detail'])await t.test(path,async()=>{const fresh=await fixture(path);try{
  await fresh.page.getByLabel('主素材画像').waitFor({state:'attached'});assert.equal(await fresh.page.getByTestId('canonical-image-workspace-controls').count(),0);
  const box=await fresh.page.locator('label[data-testid$="-upload"]').boundingBox();assert(box);
  // Light 1440x900 readback: Lab drop zone 768x554 (2026-10-07), Wear Design Lab 782x496.
  assert.equal(Math.round(box.height),path.includes('laboratory')?554:496);assert.equal(Math.round(box.width),path.includes('laboratory')?768:782);
  assert.equal(await fresh.page.locator('main[data-resume-state]').getAttribute('data-resume-job'),'');assert.equal((await server(fresh.page)).calls.length,0);
 }finally{await fresh.close();}});
});

test('legacy saved result remains available but missing original form inputs are explicit; new inputs never become restored proof',async()=>{
 const f=await fixture('/heavy/lab?resumeJob=exact-job&legacy=1');try{await saved(f.page);assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-resume-inputs'),'false');await detail(f.page);await saved(f.page);
  assert.equal(await f.page.getByLabel('依頼',{exact:true}).inputValue(),'');assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-primary-source'),'');
  await f.page.getByLabel('依頼',{exact:true}).fill('New brief');assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-resume-inputs'),'false');assert.equal((await server(f.page)).calls.length,0);
 }finally{await f.close();}
});

test('authorized remote-only exact job result restores without inventing local/original input proof',async()=>{
 const f=await fixture('/heavy/lab?resumeJob=remote-job&remoteOnly=1&keep=yes#context');try{await saved(f.page,'remote-job');assert.equal(new URL(f.page.url()).pathname,'/flow/laboratory');
  assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-resume-inputs'),'false');await detail(f.page);await saved(f.page,'remote-job');
  assert.equal(await f.page.getByLabel('依頼',{exact:true}).inputValue(),'');assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-primary-source'),'');
  const s=await server(f.page);assert.equal(s.calls.length,0);assert(s.remoteReads.every((read:any)=>read.brand==='brand'&&read.jobId==='remote-job'));
  assert.match(await f.page.getByRole('img',{name:'保存された生成結果'}).getAttribute('src')??'',/remote-result/);
  await f.page.reload();await saved(f.page,'remote-job');assert.equal((await server(f.page)).calls.length,0);
 }finally{await f.close();}
});

test('remote result with explicit saved form metadata restores canonical original input and deliberate empty reference note',async()=>{
 const f=await fixture('/heavy/wear-design-detail?resumeJob=remote-job&remoteOnly=1&remoteInputs=1');try{await saved(f.page,'remote-job');
  assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-resume-inputs'),'true');assert.equal(await f.page.getByLabel('依頼',{exact:true}).inputValue(),'Remote original brief');
  assert.equal(await f.page.getByLabel('参考メモ',{exact:true}).inputValue(),'');assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-primary-source'),'source-primary');assert.equal((await server(f.page)).calls.length,0);
 }finally{await f.close();}
});

test('out-of-order same-slot uploads retain newer file, release abandoned URL, and source-aware generation uses it once',async()=>{
 const f=await fixture('/flow/orientedDesign/detail');try{await f.page.getByLabel('主素材画像').waitFor({state:'attached'});
  await f.page.evaluate(()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){if(this.name==='older.svg')await new Promise<void>(resolve=>(window as any).__held.upload.push(resolve));return original.call(this);};});
  const svg=(color:string)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${color}"/></svg>`);
  await f.page.getByLabel('主素材画像').setInputFiles({name:'older.svg',mimeType:'image/svg+xml',buffer:svg('red')});await f.page.waitForFunction(()=>(window as any).__held.upload.length===1);
  await f.page.getByLabel('主素材画像').setInputFiles({name:'newer.svg',mimeType:'image/svg+xml',buffer:svg('blue')});await f.page.getByText('newer.svg',{exact:true}).waitFor();
  const source=await f.page.locator('main[data-resume-state]').getAttribute('data-primary-source');await f.page.evaluate(()=>(window as any).__release('upload'));await f.page.waitForTimeout(100);
  assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-primary-source'),source);assert.equal(await f.page.getByText('older.svg',{exact:true}).count(),0);
  assert.match(source??'',/^local-canvas-asset:/);assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-resume-inputs'),'false');
  await f.page.getByLabel('依頼',{exact:true}).fill('Edit newly uploaded source');await f.page.getByRole('button',{name:'生成',exact:true}).click();await f.page.waitForFunction(()=>new URL(location.href).searchParams.get('resumeJob')?.startsWith('saved-image-'));
  const s=await server(f.page);assert.equal(s.calls.length,1);assert.equal(s.calls[0].action,'edit');assert.match(s.calls[0].url,/^blob:/);
  assert.match(s.persists[0].metadata.materialSlots[0].imageUrl,/^local-canvas-asset:/);await f.page.evaluate(()=>(window as any).__unmount());
  await f.page.waitForFunction(()=>(window as any).__created.every(url=>(window as any).__released.includes(url)));
 }finally{await f.close();}
});

test('explicit generate and edit transport each submit once, persist before URL binding, and reload; canonical result edit preserves reference order',async t=>{
 for(const action of ['生成','素材を編集','保存結果を編集'])await t.test(action,async()=>{const f=await fixture('/heavy/wear-design-detail?resumeJob=exact-job&keep=yes'+(action==='生成'?'&textOnly=1':'')+'#context');try{
  await saved(f.page);await f.page.evaluate(()=>(window as any).__server.mode='hold-persist');await f.page.getByRole('button',{name:action,exact:true}).click();
  await f.page.waitForFunction(()=>(window as any).__held.persist.length===1);assert.equal(new URL(f.page.url()).searchParams.get('resumeJob'),'exact-job');assert.equal(await f.page.getByText('保存済み',{exact:true}).count(),0);
  await f.page.evaluate(()=>(window as any).__release('persist'));await f.page.waitForFunction(()=>new URL(location.href).searchParams.get('resumeJob')?.startsWith('saved-image-'));
  const s=await server(f.page);assert.equal(s.calls.length,1);assert.equal(s.persists.length,1);assert.equal(s.calls[0].rights,true);assert.equal(new URL(f.page.url()).searchParams.get('keep'),'yes');assert.equal(new URL(f.page.url()).hash,'#context');
  if(action==='素材を編集'){assert.match(s.calls[0].url,/source-primary/);assert.equal(s.calls[0].references.length,1);assert.match(s.calls[0].references[0],/^blob:/);}
  if(action==='保存結果を編集'){assert.match(s.calls[0].url,/result-exact-job/);assert.equal(s.calls[0].references.length,2);assert.match(s.calls[0].references[0],/source-primary/);assert.match(s.calls[0].references[1],/^blob:/);}
  assert(s.persists[0].metadata.materialSlots.every((slot:any)=>!slot.imageUrl.startsWith('blob:')&&!slot.imageUrl.startsWith('data:')));
  const job=new URL(f.page.url()).searchParams.get('resumeJob')!;await f.page.reload();await saved(f.page,job);assert.equal((await server(f.page)).calls.length,1);
 }finally{await f.close();}});
});

test('delayed restore cannot commit after user/brand/job/tool change or unmount and releases acquired local URLs',async t=>{
 for(const change of ['user','brand','job','tool','unmount'])await t.test(change,async()=>{const f=await fixture('/heavy/wear-design-detail?resumeJob=exact-job&hold=1');try{
  await f.page.waitForFunction(()=>(window as any).__held.sign.length>0);
  await f.page.evaluate(change=>{if(change==='user'||change==='brand')(window as any).__switch(change);else if(change==='job')(window as any).__navigate('/flow/orientedDesign/detail?resumeJob=missing');else if(change==='tool')(window as any).__navigate('/flow/laboratory/detail?resumeJob=missing');else (window as any).__unmount();},change);
  if(change==='job'||change==='tool')await f.page.waitForURL(/resumeJob=missing/);await f.page.evaluate(()=>{(window as any).__holdSign=false;(window as any).__release('sign');});
  await f.page.waitForTimeout(150);assert.equal(await f.page.locator('main[data-resume-job="exact-job"]').count(),0);assert.equal((await server(f.page)).calls.length,0);
  assert(await f.page.evaluate(()=>(window as any).__created.every(url=>(window as any).__released.includes(url))));
 }finally{await f.close();}});
});

test('unknown attempt reload reconciles the retained ID by GET, never replays inference; explicit failure retains previous result',async t=>{
 const f=await fixture('/heavy/wear-design-detail?resumeJob=exact-job');try{await saved(f.page);await f.page.evaluate(()=>(window as any).__server.mode='unknown');await f.page.getByRole('button',{name:'生成',exact:true}).click();
  await f.page.getByRole('button',{name:'同じ依頼を照合',exact:true}).waitFor();const id=(await server(f.page)).calls[0].id;
  await f.page.reload();await saved(f.page);assert.equal(await f.page.getByRole('button',{name:'生成',exact:true}).isDisabled(),true);
  await f.page.evaluate(id=>{(window as any).__server.requests[id]=(window as any).__completed(id);(window as any).__save();},id);
  await f.page.getByRole('button',{name:'同じ依頼を照合',exact:true}).click();await f.page.waitForFunction(()=>new URL(location.href).searchParams.get('resumeJob')?.startsWith('saved-image-'));
  assert.equal((await server(f.page)).calls.length,1);assert.deepEqual((await server(f.page)).reads,[id]);
 }finally{await f.close();}
 for(const mode of ['failed','persist-fail'])await t.test(mode,async()=>{const f=await fixture('/heavy/wear-design-detail?resumeJob=exact-job');try{await saved(f.page);await f.page.evaluate(mode=>(window as any).__server.mode=mode,mode);await f.page.getByRole('button',{name:'生成',exact:true}).click();await f.page.getByRole('alert').last().waitFor();assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-resume-job'),'exact-job');assert.equal(new URL(f.page.url()).searchParams.get('resumeJob'),'exact-job');assert.equal((await server(f.page)).calls.length,1);}finally{await f.close();}});
});

test('pending provider completion cannot commit after canonical job change and releases restored local URLs on unmount',async()=>{
 const f=await fixture('/heavy/wear-design-detail?resumeJob=exact-job');try{await saved(f.page);await f.page.evaluate(()=>(window as any).__server.mode='hold-provider');await f.page.getByRole('button',{name:'生成',exact:true}).click();await f.page.waitForFunction(()=>(window as any).__held.provider.length===1);
  await f.page.evaluate(()=>(window as any).__navigate('/flow/orientedDesign/detail?resumeJob=missing'));await f.page.waitForURL(/resumeJob=missing/);await f.page.evaluate(()=>(window as any).__release('provider'));await f.page.waitForTimeout(150);
  assert.equal((await server(f.page)).persists.length,0);assert.equal(new URL(f.page.url()).searchParams.get('resumeJob'),'missing');await f.page.evaluate(()=>(window as any).__unmount());
  await f.page.waitForFunction(()=>(window as any).__created.every(url=>(window as any).__released.includes(url)));
 }finally{await f.close();}
});

test('fresh uploaded operation unknown reload keeps same-ID reconciliation visible with zero inference replay',async()=>{
 const f=await fixture('/flow/orientedDesign/detail?keep=yes#fresh-context');try{
  await f.page.getByLabel('主素材画像').waitFor({state:'attached'});
  await f.page.getByLabel('主素材画像').setInputFiles({name:'fresh-source.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="purple"/></svg>')});
  await f.page.getByText('fresh-source.svg',{exact:true}).waitFor();await f.page.getByLabel('依頼',{exact:true}).fill('Fresh source edit');
  await f.page.evaluate(()=>(window as any).__server.mode='throw-provider');await f.page.getByRole('button',{name:'生成',exact:true}).click();
  await f.page.locator('main[data-resume-state="unknown"]').waitFor();const id=(await server(f.page)).calls[0].id;assert.equal(new URL(f.page.url()).searchParams.has('resumeJob'),false);
  await f.page.reload();const reconcile=f.page.getByRole('button',{name:'同じ依頼を照合',exact:true});await reconcile.waitFor();assert.equal(await reconcile.isEnabled(),true);
  assert.equal((await server(f.page)).calls.length,1);assert.equal(await f.page.getByRole('button',{name:'生成',exact:true}).isDisabled(),true);
  await f.page.evaluate(id=>{(window as any).__server.requests[id]=(window as any).__completed(id);(window as any).__save();},id);
  await reconcile.click();await f.page.waitForFunction(()=>new URL(location.href).searchParams.get('resumeJob')?.startsWith('saved-image-'));
  const s=await server(f.page);assert.equal(s.calls.length,1);assert.deepEqual(s.reads,[id]);assert.equal(s.persists[0].metadata.brief,'Fresh source edit');
  assert.equal(new URL(f.page.url()).searchParams.get('keep'),'yes');assert.equal(new URL(f.page.url()).hash,'#fresh-context');
 }finally{await f.close();}
});

test('edit-result signing definite failure creates no pending or provider attempt and preserves usable inputs and prior saved result',async()=>{
 const f=await fixture('/heavy/wear-design-detail?resumeJob=exact-job');try{await saved(f.page);await f.page.evaluate(()=>(window as any).__server.mode='sign-fail');
  await f.page.getByRole('button',{name:'保存結果を編集',exact:true}).click();await f.page.locator('main[data-resume-state="error"]').waitFor();
  assert.equal((await server(f.page)).calls.length,0);assert.equal((await server(f.page)).persists.length,0);assert.equal(new URL(f.page.url()).searchParams.get('resumeJob'),'exact-job');
  assert.equal(await f.page.locator('main[data-resume-state]').getAttribute('data-resume-job'),'exact-job');assert.equal(await f.page.getByRole('button',{name:'同じ依頼を照合',exact:true}).count(),0);
  assert.equal(await f.page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('heavy:canonical-image-workspace:v1:')).length),0);
  assert.equal(await f.page.getByLabel('依頼',{exact:true}).isEnabled(),true);assert.equal(await f.page.getByLabel('主素材画像').isEnabled(),true);
  await f.page.getByLabel('依頼',{exact:true}).fill('Still editable after definite preprocessing failure');assert.equal(await f.page.getByRole('button',{name:'生成',exact:true}).isEnabled(),true);
 }finally{await f.close();}
});

test('family printing alias operates on canonical page with ordered durable sources, coverage, single edit and reload without a loop',async()=>{
 const f=await fixture('/heavy/printing-image?resumeJob=exact-job&keep=yes#context');try{await familySaved(f.page);assert.equal(new URL(f.page.url()).pathname,'/tools/printing');
  await f.page.getByRole('button',{name:'全体',exact:true}).waitFor();assert.equal(await f.page.getByRole('button',{name:'全体',exact:true}).getAttribute('aria-pressed'),'true');
  await f.page.getByRole('button',{name:'AI生成',exact:true}).click();await f.page.waitForFunction(()=>new URL(location.href).searchParams.get('resumeJob')?.startsWith('saved-image-'));
  const s=await server(f.page);assert.equal(s.calls.length,1);assert.equal(s.calls[0].action,'edit');assert.equal(s.calls[0].feature,'printing-image');assert.match(s.calls[0].url,/source-primary/);assert.match(s.calls[0].references[0],/^blob:/);
  assert.equal(s.persists[0].metadata.inputState.coverage,'full');assert.equal(s.persists[0].metadata.materialSlots[0].sourceImageId,'source-primary');assert.match(s.persists[0].metadata.materialSlots[1].imageUrl,/^local-canvas-asset:/);
  const job=new URL(f.page.url()).searchParams.get('resumeJob')!;assert.equal(new URL(f.page.url()).searchParams.get('keep'),'yes');assert.equal(new URL(f.page.url()).hash,'#context');await f.page.reload();await familySaved(f.page,job);assert.equal((await server(f.page)).calls.length,1);
 }finally{await f.close();}
});

test('family vector standard/pro actual aliases retain distinct feature IDs, input mode and canonical raster results',async t=>{
 for(const [feature,path]of [['pattern-vector','/tools/pattern-to-vector'],['pattern-vector-pro','/tools/vector-special']])await t.test(feature,async()=>{
 const f=await fixture('/heavy/'+feature+'?resumeJob=exact-job&keep=yes');try{await familySaved(f.page);assert.equal(new URL(f.page.url()).pathname,path);await f.page.getByRole('button',{name:/^AI生成/}).click();
 await f.page.waitForFunction(()=>new URL(location.href).searchParams.get('resumeJob')?.startsWith('saved-image-'));const s=await server(f.page);assert.equal(s.calls.length,1);assert.equal(s.calls[0].feature,feature);assert.equal(s.calls[0].action,'edit');assert.deepEqual(s.persists[0].metadata.inputState.layerModes,['split']);
 await f.page.getByText('保存された結果はラスター画像です。',{exact:true}).waitFor();const job=new URL(f.page.url()).searchParams.get('resumeJob')!;await f.page.reload();await familySaved(f.page,job);assert.equal((await server(f.page)).calls.length,1);
 }finally{await f.close();}});
});

test('family seven model tool aliases pass exact client identity, configured prompt, source order and retained context into actual model adapter',async t=>{
 for(const [feature,title]of [['model-face','顔変更'],['model-change','モデル変更'],['body-shape','体型'],['clothing-size','服のサイズ'],['pose-change','ポーズ'],['background-change','背景'],['angle-change','アングル']])await t.test(feature,async()=>{
 const f=await fixture('/heavy/'+feature+'?resumeJob=exact-job&keep=yes#context');try{await familySaved(f.page);await f.page.getByTestId('heavy-model-tool-generate').click();await f.page.waitForFunction(()=>new URL(location.href).searchParams.get('resumeJob')?.startsWith('matrix-job-'));
 const s=await server(f.page),call=s.calls[0];assert.equal(s.calls.length,1);assert.equal(call.action,'model-matrix');assert.equal(call.feature,feature);assert.match(call.body.productDescription,new RegExp(title));assert.match(call.body.imageUrl,/source-primary/);assert.match(call.body.modelReferenceImageUrl,/^blob:/);assert.equal(call.retain,true);assert.equal(call.assertContext,true);assert(call.id);assert.equal(call.body.idempotencyKey,undefined);
 assert.equal(s.persists[0].metadata.modelCandidates[0].imageId,'matrix-'+call.id+'-0');const job=new URL(f.page.url()).searchParams.get('resumeJob')!;await f.page.reload();await familySaved(f.page,job);assert.equal((await server(f.page)).calls.length,1);
 }finally{await f.close();}});
});

test('family bare model aliases carry authoritative origin/query/hash: library text creation needs no upload; explicit custom requires source',async t=>{
 for(const feature of ['model-library','model-custom'])await t.test(feature,async()=>{const f=await fixture('/heavy/'+feature+'?keep=yes&workspaceFeature='+ (feature==='model-custom'?'model-library':'model-custom')+'#context');try{
 await f.page.getByTestId('heavy-model-generate').waitFor();assert.equal(new URL(f.page.url()).pathname,'/model-library/model-custom-form');assert.equal(new URL(f.page.url()).searchParams.get('workspaceFeature'),feature);assert.equal(new URL(f.page.url()).searchParams.get('keep'),'yes');assert.equal(new URL(f.page.url()).hash,'#context');
 assert.equal(await f.page.getByTestId('lightchain-source-model-surface').getAttribute('data-workspace-feature'),feature);
 if(feature==='model-custom'){assert.equal(await f.page.getByTestId('heavy-model-generate').isDisabled(),true);assert.equal((await server(f.page)).calls.length,0);await uploadSVG(f.page,f.page.getByLabel('元の画像',{exact:true}));}
 await f.page.getByTestId('heavy-model-generate').click();await f.page.waitForFunction(()=>new URL(location.href).searchParams.get('resumeJob')?.startsWith('matrix-job-'));const s=await server(f.page);assert.equal(s.calls.length,1);assert.equal(s.calls[0].feature,feature);assert.equal(s.calls[0].action,'model-matrix');assert.equal(Boolean(s.calls[0].body.imageUrl),feature==='model-custom');assert.equal(s.persists[0].metadata.inputState.gender,'男性');assert.equal(s.persists[0].metadata.inputState.half,false);
 const job=new URL(f.page.url()).searchParams.get('resumeJob')!;await f.page.reload();await familySaved(f.page,job);assert.equal((await server(f.page)).calls.length,1);
 }finally{await f.close();}});
 const mismatch=await fixture('/heavy/model-custom?resumeJob=exact-job&seedFeature=model-library');try{await familySaved(mismatch.page);assert.equal(await mismatch.page.getByTestId('heavy-model-generate').isDisabled(),true);assert.match(await mismatch.page.getByRole('alert').first().textContent()??'',/一致しません/);assert.equal((await server(mismatch.page)).calls.length,0);}finally{await mismatch.close();}
});

test('family model nonfirst selected identity and full form restore exactly; candidate selection persists through reload without inference',async()=>{
 const f=await fixture('/heavy/model-library?resumeJob=exact-job&matrix=1');try{await familySaved(f.page);await f.page.getByRole('button',{name:/候補 2/}).waitFor();assert.equal(await f.page.getByRole('button',{name:/候補 2/}).getAttribute('aria-pressed'),'true');assert.match(await f.page.getByRole('img',{name:'保存された生成結果'}).getAttribute('src')??'',/matrix-1/);
 assert.equal(await f.page.getByRole('combobox',{name:'国籍'}).textContent(),'日本');assert.equal(await f.page.getByRole('switch',{name:'ハーフ'}).getAttribute('aria-checked'),'true');
 await f.page.getByRole('button',{name:/候補 1/}).click();await f.page.waitForFunction(()=>document.querySelector('[data-selected-candidate]')?.getAttribute('data-selected-candidate')==='matrix-0');await f.page.reload();await familySaved(f.page);await f.page.getByRole('button',{name:/候補 1/}).waitFor();assert.equal(await f.page.getByRole('button',{name:/候補 1/}).getAttribute('aria-pressed'),'true');assert.equal((await server(f.page)).calls.length,0);
 await f.page.getByTestId('heavy-model-generate').click();await f.page.waitForFunction(()=>new URL(location.href).searchParams.get('resumeJob')?.startsWith('matrix-job-'));
 await f.page.getByRole('button',{name:/候補 2/}).click();const s=await server(f.page),secondId='matrix-'+s.calls[0].id+'-1';await f.page.waitForFunction(id=>document.querySelector('[data-selected-candidate]')?.getAttribute('data-selected-candidate')===id,secondId);
 const job=new URL(f.page.url()).searchParams.get('resumeJob')!;await f.page.reload();await familySaved(f.page,job);await f.page.getByRole('button',{name:/候補 2/}).waitFor();assert.equal(await f.page.getByRole('button',{name:/候補 2/}).getAttribute('aria-pressed'),'true');assert.match(await f.page.getByRole('img',{name:'保存された生成結果'}).getAttribute('src')??'',new RegExp(secondId));assert.equal((await server(f.page)).calls.length,1);
 }finally{await f.close();}
});

test('family model actual matrix and images normalization reject incomplete/order/context identities; unknown uses same-ID GET without replay',async()=>{
 const f=await fixture('/heavy/model-library?resumeJob=exact-job&matrix=1');try{await familySaved(f.page);const normalized=await f.page.evaluate(()=>{const normalize=(window as any).__normalizeMatrix;
 const base={success:true,jobId:'job',provider:'openai',persistenceStatus:'completed',requestedCandidateCount:1,persistedCandidateCount:1,images:[{imageId:'id',imageUrl:'/__image__',storagePath:'generated-images/id',jobId:'job',candidateIndex:0,persistenceStatus:'completed',provider:'openai'}]};
 const good=normalize(base,{bodyTypes:['regular'],ageGroups:['20s']});const rejected=[];for(const changes of [{imageId:null},{candidateIndex:1},{storagePath:'https://signed.invalid/a?token=secret'},{jobId:'other'}])try{normalize({...base,images:[{...base.images[0],...changes}]},{bodyTypes:['regular'],ageGroups:['20s']});rejected.push(false);}catch{rejected.push(true);}return {good,rejected};});assert.equal(normalized.good.matrix[0].bodyType,'regular');assert.deepEqual(normalized.rejected,[true,true,true,true]);
 await f.page.evaluate(()=>(window as any).__server.mode='incomplete-matrix');await f.page.getByTestId('heavy-model-generate').click();await f.page.getByRole('button',{name:'同じ依頼を照合'}).waitFor();let s=await server(f.page);assert.equal(s.calls.length,1);assert.equal(s.persists.length,0);assert.equal(new URL(f.page.url()).searchParams.get('resumeJob'),'exact-job');
 await f.page.reload();await familySaved(f.page);await f.page.getByRole('button',{name:'同じ依頼を照合'}).click();await f.page.getByRole('button',{name:'同じ依頼を照合'}).waitFor();s=await server(f.page);assert.equal(s.calls.length,1);assert.deepEqual(s.reads,[s.calls[0].id]);assert.equal(s.persists.length,0);
 }finally{await f.close();}
});

test('family remote-only model result with candidates can select and persist exact job locally without inference or invented inputs',async()=>{
 const f=await fixture('/heavy/model-library?resumeJob=remote-job&remoteOnly=1&matrix=1');try{await familySaved(f.page,'remote-job');await f.page.getByRole('button',{name:/候補 2/}).waitFor();assert.equal(await f.page.getByLabel('依頼',{exact:true}).inputValue(),'');assert.equal(await f.page.getByRole('combobox',{name:'年齢'}).textContent(),'未設定');
 await f.page.getByRole('button',{name:/候補 2/}).click();await f.page.waitForFunction(()=>document.querySelector('[data-selected-candidate]')?.getAttribute('data-selected-candidate')==='remote-matrix-1');await f.page.reload();await familySaved(f.page,'remote-job');await f.page.getByRole('button',{name:/候補 2/}).waitFor();assert.equal(await f.page.getByRole('button',{name:/候補 2/}).getAttribute('aria-pressed'),'true');assert.equal(await f.page.getByLabel('依頼',{exact:true}).inputValue(),'');assert.equal(await f.page.getByRole('combobox',{name:'年齢'}).textContent(),'未設定');assert.match(await f.page.getByRole('alert').first().textContent()??'',/元の入力/);assert.equal((await server(f.page)).calls.length,0);
 }finally{await f.close();}
});

test('family delayed model operation cannot commit after user/brand/job/tool/unmount change; retained invocation is never replayed',async t=>{
 for(const change of ['user','brand','job','tool','unmount'])await t.test(change,async()=>{const f=await fixture('/heavy/model-face?resumeJob=exact-job&keep=yes');try{
 await familySaved(f.page);await f.page.evaluate(()=>(window as any).__server.mode='hold-provider');await f.page.getByTestId('heavy-model-tool-generate').click();await f.page.waitForFunction(()=>(window as any).__held.provider.length===1);
 await f.page.evaluate(change=>{if(change==='user'||change==='brand')(window as any).__switch(change);else if(change==='job')(window as any).__navigate('/model-library/head-form?resumeJob=missing');else if(change==='tool')(window as any).__navigate('/model-library/body-form?resumeJob=missing');else (window as any).__unmount();},change);
 if(change==='job'||change==='tool')await f.page.locator('[data-workspace-feature][data-resume-job="missing"]').waitFor();else if(change==='unmount')await f.page.locator('[data-workspace-feature]').waitFor({state:'detached'});else await f.page.waitForFunction(()=>!document.querySelector('[data-resume-state="saved"]'));
 await f.page.evaluate(()=>(window as any).__release('provider'));await f.page.waitForTimeout(100);const s=await server(f.page);assert.equal(s.calls.length,1);assert.equal(s.persists.length,0);assert(!new URL(f.page.url()).searchParams.get('resumeJob')?.startsWith('saved-'));
 }finally{await f.close();}});
});

test('wear bridge actual App alias home -> explicit same-feature detail -> reload keeps exact saved preview, inputs, source IDs/query/hash and zero inference',async()=>{
 const f=await fixture('/heavy/wear-design-lab?resumeJob=exact-job&keep=yes#context');try{
 await saved(f.page);assert.equal(new URL(f.page.url()).pathname,'/flow/orientedDesign');assert.equal(await f.page.getByRole('img',{name:'保存されたウェア画像'}).count(),1);
 assert.equal(await f.page.getByTestId('oriented-design-resume').getAttribute('data-resume-feature'),'wear-design-lab');assert.equal(await f.page.getByTestId('oriented-design-resume').getAttribute('data-resume-inputs'),'true');
 const preview=await f.page.getByRole('img',{name:'保存されたウェア画像'}).getAttribute('src');await f.page.getByRole('button',{name:'編集を続ける',exact:true}).click();await f.page.getByTestId('oriented-design-detail').waitFor();await saved(f.page);
 assert.equal(new URL(f.page.url()).pathname,'/flow/orientedDesign/detail');assert.equal(new URL(f.page.url()).searchParams.get('workspaceFeature'),'wear-design-lab');assert.equal(new URL(f.page.url()).searchParams.get('resumeJob'),'exact-job');assert.equal(new URL(f.page.url()).searchParams.get('keep'),'yes');assert.equal(new URL(f.page.url()).hash,'#context');
 assert.equal(await f.page.getByLabel('依頼',{exact:true}).inputValue(),'Exact original brief');assert.equal(await f.page.getByLabel('参考メモ',{exact:true}).inputValue(),'Exact original reference note');assert.equal(await f.page.getByTestId('oriented-design-detail').getAttribute('data-primary-source'),'source-primary');assert.match(await f.page.getByTestId('oriented-design-detail').getAttribute('data-secondary-source')??'',/^local-canvas-asset:/);
 assert.equal(await f.page.getByRole('img',{name:'保存された生成結果'}).getAttribute('src'),preview);await f.page.reload();await saved(f.page);assert.equal(await f.page.getByTestId('oriented-design-detail').getAttribute('data-resume-feature'),'wear-design-lab');assert.equal(await f.page.getByRole('img',{name:'保存された生成結果'}).getAttribute('src'),preview);assert.equal((await server(f.page)).calls.length,0);
 }finally{await f.close();}
});

test('wear bridge bare detail preserves distinct detail job identity; legacy home result never invents missing original inputs',async t=>{
 const bare=await fixture('/heavy/wear-design-detail?resumeJob=exact-job');try{await saved(bare.page);assert.equal(await bare.page.getByTestId('oriented-design-detail').getAttribute('data-resume-feature'),'wear-design-detail');assert.equal((await server(bare.page)).calls.length,0);}finally{await bare.close();}
 const legacy=await fixture('/heavy/wear-design-lab?resumeJob=exact-job&legacy=1');try{await saved(legacy.page);assert.equal(await legacy.page.getByTestId('oriented-design-resume').getAttribute('data-resume-inputs'),'false');await legacy.page.getByRole('button',{name:'編集を続ける',exact:true}).click();await saved(legacy.page);
 assert.equal(await legacy.page.getByLabel('依頼',{exact:true}).inputValue(),'');assert.equal(await legacy.page.getByTestId('oriented-design-detail').getAttribute('data-primary-source'),'');assert.equal(await legacy.page.getByTestId('oriented-design-detail').getAttribute('data-resume-inputs'),'false');await legacy.page.reload();await saved(legacy.page);assert.equal(await legacy.page.getByTestId('oriented-design-detail').getAttribute('data-resume-inputs'),'false');assert.equal((await server(legacy.page)).calls.length,0);
 }finally{await legacy.close();}
});

test('wear bridge rejects unrelated/contradictory feature and foreign brand/user; fresh source home stays unchanged and new file stays fresh',async t=>{
 for(const path of ['/heavy/wear-design-lab?resumeJob=exact-job&workspaceFeature=lab','/heavy/wear-design-lab?resumeJob=exact-job&seedFeature=wear-design-detail','/flow/orientedDesign/detail?resumeJob=exact-job&workspaceFeature=lab','/flow/orientedDesign/detail?resumeJob=exact-job&workspaceFeature=wear-design-lab&seedFeature=wear-design-detail'])await t.test(path,async()=>{const f=await fixture(path);try{
 await f.page.locator('main[data-resume-state="unavailable"]').waitFor();assert.equal(await f.page.locator('main[data-resume-job="exact-job"]').count(),0);assert.equal(await f.page.getByRole('button',{name:'編集を続ける',exact:true}).count(),0);assert.equal((await server(f.page)).calls.length,0);
 }finally{await f.close();}});
 for(const scope of ['user','brand'])await t.test(scope,async()=>{const f=await fixture('/heavy/wear-design-lab?resumeJob=exact-job&hold=1');try{await f.page.waitForFunction(()=>(window as any).__held.sign.length>0);await f.page.evaluate(scope=>(window as any).__switch(scope),scope);await f.page.evaluate(()=>{(window as any).__holdSign=false;(window as any).__release('sign');});await f.page.locator('main[data-resume-state="unavailable"]').waitFor();assert.equal(await f.page.getByRole('img',{name:'保存されたウェア画像'}).count(),0);assert.equal((await server(f.page)).calls.length,0);}finally{await f.close();}});
 const fresh=await fixture('/heavy/wear-design-lab?keep=yes#fresh');try{await fresh.page.getByText('ウェアデザインラボ',{exact:true}).waitFor();assert.equal(new URL(fresh.page.url()).pathname,'/flow/orientedDesign');assert.equal(await fresh.page.getByTestId('oriented-design-resume').count(),0);assert.equal(await fresh.page.getByTestId('canonical-image-workspace-controls').count(),0);assert.equal(await fresh.page.locator('.oriented-design-new-card').count(),1);assert((await fresh.page.locator('.oriented-design-project-card').count())>1);
 await fresh.page.getByText('新規ファイル',{exact:true}).click();await fresh.page.getByTestId('oriented-design-detail').waitFor();assert.equal(new URL(fresh.page.url()).searchParams.get('resumeJob'),null);assert.equal(new URL(fresh.page.url()).searchParams.get('workspaceFeature'),null);assert.equal(await fresh.page.getByTestId('oriented-design-detail').getAttribute('data-resume-feature'),'wear-design-detail');assert.equal((await server(fresh.page)).calls.length,0);
 }finally{await fresh.close();}
});

test('selection fix cross-job candidates never replace an exact local/remote result or become selectable',async t=>{
 for(const remote of [false,true])await t.test(remote?'remote':'local',async()=>{const job=remote?'remote-job':'exact-job',f=await fixture('/heavy/model-library?resumeJob='+job+'&matrix=1&crossJobCandidates=1'+(remote?'&remoteOnly=1':''));try{
 await familySaved(f.page,job);await f.page.getByRole('img',{name:'保存された生成結果'}).waitFor();assert.equal(await f.page.getByRole('button',{name:/候補 [12]/}).count(),0);assert.equal(await f.page.getByTestId('lightchain-source-model-surface').getAttribute('data-selected-candidate'),'');
 assert.match(await f.page.getByRole('img',{name:'保存された生成結果'}).getAttribute('src')??'',remote?/remote-result/:/result-exact-job/);assert.equal((await server(f.page)).calls.length,0);
 }finally{await f.close();}});
});

test('selection fix remote restored original inputs remain immutable after text/form/upload edits and candidate selection/reload',async()=>{
 const f=await fixture('/heavy/model-library?resumeJob=remote-job&remoteOnly=1&matrix=1&remoteInputs=1');try{
 await familySaved(f.page,'remote-job');await f.page.getByRole('button',{name:/候補 2/}).waitFor();assert.equal(await f.page.getByLabel('依頼',{exact:true}).inputValue(),'Remote original brief');
 await f.page.getByLabel('依頼',{exact:true}).fill('Current edited brief');await f.page.getByLabel('参考メモ',{exact:true}).fill('Current edited note');await f.page.getByRole('combobox',{name:'国籍'}).click();await f.page.getByRole('option',{name:'韓国',exact:true}).click();
 await uploadSVG(f.page,f.page.getByLabel('追加の参考画像',{exact:true}),'new-reference.svg');await f.page.getByRole('button',{name:/候補 2/}).click();await f.page.waitForFunction(()=>document.querySelector('[data-selected-candidate]')?.getAttribute('data-selected-candidate')==='remote-matrix-1');
 const metadata=await f.page.evaluate(()=>(window as any).__artifacts().find((artifact:any)=>artifact.sourceJobId==='remote-job').metadata);assert.equal(metadata.brief,'Remote original brief');assert.equal(metadata.referenceNote,'');assert.equal(metadata.inputState.nationality,'日本');assert.equal(metadata.originalInputsAvailable,true);assert.equal(metadata.materialSlots.length,1);assert.equal(metadata.materialSlots[0].sourceImageId,'source-primary');assert(!JSON.stringify(metadata).includes('Current edited'));assert(!JSON.stringify(metadata).includes('new-reference.svg'));
 await f.page.reload();await familySaved(f.page,'remote-job');await f.page.getByRole('button',{name:/候補 2/}).waitFor();assert.equal(await f.page.getByLabel('依頼',{exact:true}).inputValue(),'Remote original brief');assert.equal(await f.page.getByLabel('参考メモ',{exact:true}).inputValue(),'');assert.equal(await f.page.getByRole('combobox',{name:'国籍'}).textContent(),'日本');assert.equal(await f.page.getByTestId('lightchain-source-model-surface').getAttribute('data-resume-inputs'),'true');assert.equal((await server(f.page)).calls.length,0);
 }finally{await f.close();}
});

test('selection fix implicit selected candidate matches the displayed result identity rather than first candidate',async()=>{
 const f=await fixture('/heavy/model-library?resumeJob=exact-job&matrix=1&noSelection=1');try{await familySaved(f.page);await f.page.getByRole('button',{name:/候補 2/}).waitFor();assert.equal(await f.page.getByRole('button',{name:/候補 2/}).getAttribute('aria-pressed'),'true');assert.equal(await f.page.getByRole('button',{name:/候補 1/}).getAttribute('aria-pressed'),'false');assert.match(await f.page.getByRole('img',{name:'保存された生成結果'}).getAttribute('src')??'',/matrix-1/);assert.equal((await server(f.page)).calls.length,0);
 }finally{await f.close();}
});

test('selection fix mismatched model save receipt retains prior result/exact URL and unknown operation with no replay',async()=>{
 const f=await fixture('/heavy/model-library?resumeJob=exact-job&matrix=1&keep=yes#context');try{await familySaved(f.page);await f.page.getByRole('button',{name:/候補 2/}).waitFor();const image=await f.page.getByRole('img',{name:'保存された生成結果'}).getAttribute('src');await f.page.evaluate(()=>(window as any).__server.mode='matrix-save-mismatch');await f.page.getByTestId('heavy-model-generate').click();await f.page.getByRole('button',{name:'同じ依頼を照合'}).waitFor();
 assert.equal(new URL(f.page.url()).searchParams.get('resumeJob'),'exact-job');assert.equal(new URL(f.page.url()).searchParams.get('keep'),'yes');assert.equal(new URL(f.page.url()).hash,'#context');assert.equal(await f.page.getByRole('img',{name:'保存された生成結果'}).getAttribute('src'),image);const s=await server(f.page);assert.equal(s.calls.length,1);assert.equal(s.persists.length,1);
 await f.page.reload();await familySaved(f.page);await f.page.getByRole('button',{name:'同じ依頼を照合'}).waitFor();assert.equal((await server(f.page)).calls.length,1);assert.equal(new URL(f.page.url()).searchParams.get('resumeJob'),'exact-job');
 }finally{await f.close();}
});


test('candidate image/path mismatch preserves the saved result and prevents candidate reuse without inference',async()=>{
 const f=await fixture('/heavy/model-library?resumeJob=exact-job&matrix=1&crossImageCandidates=1');try{
 await familySaved(f.page);await f.page.getByRole('img',{name:'保存された生成結果'}).waitFor();
 assert.equal(await f.page.getByRole('button',{name:/候補 [12]/}).count(),0);
 assert.match(await f.page.getByRole('img',{name:'保存された生成結果'}).getAttribute('src')??'',/result-exact-job/);
 assert.equal((await server(f.page)).calls.length,0);assert.equal((await server(f.page)).persists.length,0);
 }finally{await f.close();}
});


test('provider matrix identity rejects image/key contradictions before persistence for matrix and images receipts',async()=>{
 const f=await fixture('/heavy/model-library?resumeJob=exact-job&matrix=1');try{
 await familySaved(f.page);
 const results=await f.page.evaluate(()=>{const normalize=(window as any).__normalizeMatrix;
 const image={imageId:'candidate-1',imageUrl:'/__image__',storagePath:'generated-images/candidate-1',jobId:'job',candidateIndex:0,persistenceStatus:'completed',provider:'openai',bodyType:'regular',ageGroup:'20s'};
 const base={success:true,jobId:'job',provider:'openai',persistenceStatus:'completed',requestedCandidateCount:1,persistedCandidateCount:1};
 return ['matrix','images'].map(key=>{const valid=normalize({...base,[key]:[image]});let rejected=false;try{normalize({...base,[key]:[{...image,storagePath:'generated-images/other-image'}]});}catch{rejected=true;}return {validId:valid.matrix[0].imageId,rejected};});
 });
 assert.deepEqual(results,[{validId:'candidate-1',rejected:true},{validId:'candidate-1',rejected:true}]);
 assert.equal((await server(f.page)).calls.length,0);assert.equal((await server(f.page)).persists.length,0);
 }finally{await f.close();}
});


test('saved model central preview follows candidate reuse and reload without overlapping editing controls',async()=>{
 const f=await fixture('/heavy/model-library?resumeJob=exact-job&matrix=1');try{
 await familySaved(f.page);const preview=f.page.getByRole('img',{name:'保存モデルのプレビュー'});await preview.waitFor();
 assert.match(await preview.getAttribute('src')??'',/matrix-1/);
 const box=await preview.boundingBox(),controls=await f.page.getByTestId('canonical-image-workspace-controls').boundingBox();assert(box&&controls);assert(box.width>100&&box.height>100);assert(box.x+box.width<=controls.x);
 await f.page.getByRole('button',{name:/候補 1/}).click();await f.page.waitForFunction(()=>document.querySelector('[data-selected-candidate]')?.getAttribute('data-selected-candidate')==='matrix-0');
 assert.match(await preview.getAttribute('src')??'',/matrix-0/);await f.page.reload();await familySaved(f.page);await preview.waitFor();assert.match(await preview.getAttribute('src')??'',/matrix-0/);
 assert.equal((await server(f.page)).calls.length,0);assert.equal((await server(f.page)).persists.length,0);
 }finally{await f.close();}
});
