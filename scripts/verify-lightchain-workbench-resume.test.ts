import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer } from 'vite';

// Real shared page/router/auth/artifact store + browser IndexedDB. Only the
// provider, persistence receipt and signing boundary are deterministic mocks.
const source = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,useNavigate,useLocation} from 'react-router-dom';
import {LightchainWorkbenchPage} from '/src/pages/LightchainWorkbenchPage.tsx';
import {LightchainUnifiedWorkspaceShell} from '/src/components/workspace/LightchainUnifiedWorkspaceShell.tsx';
import {useAuthStore} from '/src/stores/authStore.ts';
import {useCanvasStore} from '/src/stores/canvasStore.ts';
import {saveWorkspaceArtifactPersisted,listWorkspaceArtifacts} from '/src/lib/localWorkspaceArtifacts.ts';
import {buildLocalCanvasAssetReference,putLocalCanvasAsset,getLocalCanvasAsset} from '/src/lib/canvasLocalAssets.ts';
const params=new URLSearchParams(location.search);
const tool=params.get('tool')||'lab';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="teal"/></svg>';
const localRef=buildLocalCanvasAssetReference('resume-local-reference');
await putLocalCanvasAsset('resume-local-reference',new Blob([svg],{type:'image/svg+xml'}));
const fixture=window.__fixture={calls:0,persistCalls:0,signed:[],released:[],created:[],mode:'success',holdSign:params.has('hold'),signWaiters:[],holdPersist:false};
const createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=createURL(blob);fixture.created.push(url);return url;};
URL.revokeObjectURL=url=>{fixture.released.push(url);revokeURL(url);};
window.__releaseSign=()=>{fixture.holdSign=false;fixture.signWaiters.splice(0).forEach(resolve=>resolve());};
window.__releasePersist=()=>{fixture.holdPersist=false;fixture.persistRelease?.();};
const auth=(owner='owner',brand='brand')=>({user:{id:owner},currentBrand:{id:brand,name:'Workspace'},isInitialized:true,isLoading:false,
 brandState:{status:'success_nonempty',userId:owner,requestGeneration:1,confirmedBrandIds:[brand],error:null},
 ensureHeavyWorkspace:async()=>useAuthStore.getState().currentBrand,refreshCurrentBrand:async()=>useAuthStore.getState().currentBrand});
useAuthStore.setState(auth());
window.__switchBrand=()=>useAuthStore.setState(auth('owner','other-brand'));
window.__switchUser=()=>useAuthStore.setState(auth('other-user','brand'));
const slots=[{key:'primary',fileName:'canonical-source.png',materialKind:'shirt',imageUrl:params.has('localPrimary')?localRef:'https://old.test/read?token=STALE',sourceImageId:params.has('localPrimary')?undefined:'source-1',sourceStoragePath:params.has('localPrimary')?undefined:'generated-images/source-1',persistenceStatus:'persistent'},
 {key:'secondary',fileName:'local-reference.svg',materialKind:'background',imageUrl:params.has('missing')?buildLocalCanvasAssetReference('missing'):localRef,persistenceStatus:'persistent'}];
const makeArtifact=(id,job,brief,overrides={})=>({id,brandId:'brand',scopeId:'owner',featureType:'lightchain-'+tool+'-provider-result',title:'Exact result '+job,
 imageUrl:'',prompt:'saved',sourceJobId:job,createdAt:'2026-10-01T00:00:00Z',metadata:{providerResultArtifact:true,toolId:tool,brief,
 referenceNote:'Exact reference note',materialSlots:slots,modelFormState:{angleZoom:3},storagePath:'generated-images/result-'+job,imageId:'result-'+job,provider:'openai',generationSummary:'Exact saved result'},...overrides});
const save=artifact=>{const result=saveWorkspaceArtifactPersisted(artifact);if(!result.ok)throw result.error;return result.artifact;};
save(makeArtifact('exact-artifact','exact-job','Exact persisted brief'));
save(makeArtifact('latest-artifact','latest-job','Latest unrelated brief',{createdAt:'2026-10-02T00:00:00Z'}));
window.__artifacts=()=>listWorkspaceArtifacts('brand','owner');
window.__localAsset=async ref=>Boolean(await getLocalCanvasAsset(ref));
const before=useCanvasStore.getState();window.__canvasBefore=JSON.stringify({objects:before.objects,currentProjectId:before.currentProjectId});
window.__canvasOperations=[];
useCanvasStore.setState(Object.fromEntries(Object.entries(before).filter(([name,value])=>typeof value==='function'&&/hydrate|loadProject|save|addObject|reset|createProject|deleteProject|selectObject/i.test(name))
 .map(([name])=>[name,()=>{window.__canvasOperations.push(name);throw new Error('unexpected_global_canvas_operation:'+name);}])));
window.__canvasNow=()=>{const state=useCanvasStore.getState();return JSON.stringify({objects:state.objects,currentProjectId:state.currentProjectId});};
function App(){const navigate=useNavigate(),location=useLocation();React.useEffect(()=>{window.__navigate=navigate;window.__href=location.pathname+location.search+location.hash;},[navigate,location]);
 return React.createElement(LightchainUnifiedWorkspaceShell,null,React.createElement(Routes,null,
  React.createElement(Route,{path:'/heavy/:toolId',element:React.createElement(LightchainWorkbenchPage)}),
  React.createElement(Route,{path:'/editor/patternDesign/detail',element:React.createElement(LightchainWorkbenchPage)})));}
const root=createRoot(document.getElementById('fixture-root'));
window.__unmount=()=>root.render(null);
root.render(React.createElement(React.StrictMode,null,React.createElement(BrowserRouter,null,React.createElement(App))));
window.__ready=true;
`;
const storageStub = String.raw`
export async function withSignedImageUrls(images){const f=window.__fixture;return Promise.all(images.map(async image=>{
 const path=image.storage_path;if(path?.startsWith('generated-images/')){f.signed.push(path);if(f.holdSign&&path==='generated-images/source-1')await new Promise(resolve=>f.signWaiters.push(resolve));
 return {...image,image_url:'/__resume_image__?path='+encodeURIComponent(path)};}return image;}));}
`;
const imageStub = String.raw`
export {assertCompletedImageEditResult,assertCompletedModelMatrixResult} from '/src/lib/imageApi.ts';
async function generate(){const f=window.__fixture;f.calls++;if(f.mode==='provider-fail')throw new Error('fixture_provider_failed');
 const image={id:'generated-image',imageId:'generated-image',storagePath:'generated-images/generated-image',imageUrl:'/__resume_image__?path=generated',jobId:'generated-job',candidateIndex:0,persistenceStatus:'completed',provider:'openai'};
 return {...image,success:true,state:'completed',status:'completed',persistenceStatus:'completed',requestId:'fixture-request',requestedCandidateCount:1,persistedCandidateCount:1,images:[image],matrix:[image],provider:'openai',backendProvider:'openai-images-api'};}
export const generateImage=generate,editImageWithPrompt=generate,generateModelMatrix=generate;
`;
const persistenceStub = String.raw`
import {saveWorkspaceArtifactPersisted} from '/src/lib/localWorkspaceArtifacts.ts';
export async function persistProviderResultArtifact(input){const f=window.__fixture;f.persistCalls++;f.persistInput=input;
 if(f.holdPersist)await new Promise(resolve=>f.persistRelease=resolve);if(f.mode==='persist-fail')throw new Error('fixture_persistence_failed');
 const remote={jobId:'returned-persisted-job',imageId:'returned-image',storagePath:'generated-images/returned-image'};
 const artifact={...input,id:'returned-artifact',imageUrl:'',sourceJobId:remote.jobId,createdAt:new Date().toISOString(),metadata:{...input.metadata,providerResultArtifact:true,storagePath:remote.storagePath,imageId:remote.imageId}};
 const result=saveWorkspaceArtifactPersisted(artifact);if(!result.ok)throw result.error;return {artifact:result.artifact,remote,localPersisted:true};}
`;

type Fixture = {page:Page;close():Promise<void>};
async function fixture(tool='lab',query='resumeJob=exact-job',path?:string):Promise<Fixture>{
  const stubs:Record<string,string>={'../lib/storage':storageStub,'../lib/imageApi':imageStub,'../lib/providerResultPersistence':persistenceStub,
    '../lib/cloudflareApi':`export const cloudflareDataPlane={listGeneratedImages:async()=>[]};export const asGeneratedImageListRow=image=>image;`};
  const vite=await createServer({configFile:new URL('../vite.config.ts',import.meta.url).pathname,server:{host:'127.0.0.1',port:0},logLevel:'silent',
    define:{'import.meta.env.VITE_CLOUDFLARE_API_ENABLED':'"false"'},optimizeDeps:{include:['react','react-dom/client']},
    plugins:[{name:'workbench-resume-fixture',enforce:'pre',resolveId(id,importer){
      if(id==='/__resume_fixture__.tsx')return '\0resume-fixture';
      if(importer?.endsWith('/src/pages/LightchainWorkbenchPage.tsx')&&id in stubs)return '\0resume-stub:'+id;
    },load(id){if(id==='\0resume-fixture')return source;if(id.startsWith('\0resume-stub:'))return stubs[id.slice('\0resume-stub:'.length)];}}]});
  let browser:Browser|undefined;
  try{
    await vite.listen();const address=vite.httpServer!.address();assert(address&&typeof address==='object');const origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.setDefaultTimeout(10000);
    const errors:string[]=[];const documents:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{const url=new URL(route.request().url());
      if(/\/v1\/(?:canvas|documents)|\/canvas-documents\//.test(url.pathname)){documents.push(url.pathname);return route.abort();}
      if(url.origin===origin&&(url.pathname.startsWith('/heavy/')||url.pathname==='/editor/patternDesign/detail'))return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="/src/index.css"></head><body><div id="fixture-root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('/__resume_fixture__.tsx');</script></body></html>`});
      if(url.origin===origin&&url.pathname==='/__resume_image__')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="teal"/></svg>'});
      return url.origin===origin||url.protocol==='data:'||url.protocol==='blob:'?route.continue():route.abort();});
    await page.goto(origin+(path??'/heavy/'+tool)+'?tool='+encodeURIComponent(tool)+'&keep=preserved&'+query);
    try{await page.waitForFunction(()=>Boolean((window as any).__ready),{},{timeout:20000});}catch(error){throw new Error(`fixture_load_failed:${errors.join(';')}:${String(error)}`);}
    return {page,close:async()=>{const operations=await page.evaluate(()=>(window as any).__canvasOperations??[]);await browser?.close();await vite.close();assert.deepEqual(operations,[],'no global Canvas action');assert.deepEqual(documents,[],'no Canvas document request');}};
  }catch(error){await browser?.close();await vite.close();throw error;}
}
const state=(page:Page)=>page.evaluate(()=>({calls:(window as any).__fixture.calls,persistCalls:(window as any).__fixture.persistCalls,href:(window as any).__href,
  created:(window as any).__fixture.created,released:(window as any).__fixture.released,persistInput:(window as any).__fixture.persistInput}));
const restored=(page:Page)=>page.locator('main[data-lightchain-resume-input-readback="restored"]').waitFor();

test('real StrictMode common routes restore exact job inputs, canonical/local sources and result with zero inference, including reload',async t=>{
  for(const tool of ['fitting-background-reference','wear-design-detail','lab','print-design-project','print-design-detail'])await t.test(tool,async()=>{
    const f=await fixture(tool);try{
      await restored(f.page);const main=f.page.locator('main');
      assert.equal(await main.getAttribute('data-lightchain-material-primary-id'),'source-1');
      assert.equal(await main.getAttribute('data-lightchain-material-primary-path'),'generated-images/source-1');
      assert.equal(await main.getAttribute('data-lightchain-result-job'),'exact-job');assert.equal(await main.getAttribute('data-lightchain-result-image'),'result-exact-job');
      assert.equal((await state(f.page)).calls,0);
      const values=await f.page.locator('textarea,input:not([type="file"])').evaluateAll(nodes=>nodes.map(node=>(node as HTMLInputElement).value));
      assert.equal(await main.getAttribute('data-lightchain-input-brief'),'Exact persisted brief');
      assert.equal(await main.getAttribute('data-lightchain-input-reference-note'),'Exact reference note');
      assert.equal(await main.getAttribute('data-lightchain-model-angle-zoom'),'3');
      assert.match(await main.getAttribute('data-lightchain-material-secondary-reference')??'',/^local-canvas-asset:\/\//);
      if(tool==='fitting-background-reference')assert(values.includes('Exact reference note'),JSON.stringify(values));
      if(tool==='wear-design-detail'||tool==='print-design-detail')assert(values.includes('Exact persisted brief'),JSON.stringify(values));
      assert.equal(await f.page.evaluate(()=>(window as any).__canvasNow()),await f.page.evaluate(()=>(window as any).__canvasBefore));
      assert.deepEqual(await f.page.evaluate(()=>(window as any).__canvasOperations),[]);
      assert((await state(f.page)).created.length>0,'real browser IndexedDB reference resolved to an object URL');
      await f.page.reload();await restored(f.page);assert.equal((await state(f.page)).calls,0);assert.equal(await f.page.locator('main').getAttribute('data-lightchain-result-job'),'exact-job');
    }finally{await f.close();}
  });
});

test('direct patternDesign/detail maps to the shared print detail and restores exact input',async()=>{
  const f=await fixture('print-design-detail','resumeJob=exact-job','/editor/patternDesign/detail');try{await restored(f.page);assert.equal(await f.page.locator('main').getAttribute('data-lightchain-result-job'),'exact-job');assert.equal((await state(f.page)).calls,0);}finally{await f.close();}
});

test('delayed source resolution cannot commit after owner, brand, route/tool, job change or unmount',async t=>{
  for(const change of ['brand','user','route','job','unmount'])await t.test(change,async()=>{
    const f=await fixture('lab','resumeJob=exact-job&hold=1');try{
      await f.page.waitForFunction(()=>(window as any).__fixture.signWaiters.length>0);
      await f.page.evaluate(change=>{if(change==='brand')(window as any).__switchBrand();else if(change==='user')(window as any).__switchUser();else if(change==='route')(window as any).__navigate('/heavy/wear-design-detail?tool=wear-design-detail');else if(change==='job')(window as any).__navigate('/heavy/lab?resumeJob=missing-job');else (window as any).__unmount();},change);
      await f.page.evaluate(()=>(window as any).__releaseSign());
      await f.page.waitForTimeout(150);
      assert.equal(await f.page.locator('main[data-lightchain-result-job="exact-job"]').count(),0);assert.equal((await state(f.page)).calls,0);
      const observed=await state(f.page);assert(observed.created.every((url:string)=>observed.released.includes(url)),'cancelled object URLs are released');
    }finally{await f.close();}
  });
});

test('missing local reference reports unavailable and does not substitute the latest job or infer',async()=>{
  const f=await fixture('lab','resumeJob=exact-job&missing=1');try{await f.page.locator('main[data-lightchain-resume-input-readback="unavailable"]').waitFor();assert.equal(await f.page.locator('main').getAttribute('data-lightchain-result-job'),'');assert.equal((await state(f.page)).calls,0);}finally{await f.close();}
});

test('shared background-reference upload persists its source in real IndexedDB and releases replaced URL',async()=>{
  const f=await fixture('fitting-background-reference','resumeJob=exact-job&localPrimary=1');try{
    await restored(f.page);const before=await state(f.page);
    const inputs=f.page.locator('input[type="file"]');assert.equal(await inputs.count(),1,'actual shared upload control');
    await inputs.first().setInputFiles({name:'replacement-reference.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="orange"/></svg>')});
    await f.page.waitForFunction(()=>{const ref=document.querySelector('main')?.getAttribute('data-lightchain-material-primary-reference');return Boolean(ref&&ref!=='local-canvas-asset://resume-local-reference');});
    const ref=await f.page.locator('main').getAttribute('data-lightchain-material-primary-reference');assert.match(ref??'',/^local-canvas-asset:\/\//);
    assert.equal(await f.page.evaluate(ref=>(window as any).__localAsset(ref),ref),true);
    assert.equal(await f.page.getByText('replacement-reference.svg',{exact:true}).count(),1);
    await f.page.waitForFunction(url=>(window as any).__fixture.released.includes(url),before.created[0]);
    assert.equal((await state(f.page)).calls,0);
  }finally{await f.close();}
});

test('successful persisted generation replaces URL with returned job and preserves unrelated params; failure/stale scope never bind',async t=>{
  for(const mode of ['success','provider-fail','persist-fail','stale'])await t.test(mode,async()=>{
    const f=await fixture('lab');try{await restored(f.page);await f.page.evaluate(mode=>{(window as any).__fixture.mode=mode;(window as any).__fixture.holdPersist=mode==='stale';},mode);
      await f.page.getByRole('button',{name:'新規ファイル',exact:true}).click();
      if(mode==='stale'){
        await f.page.waitForFunction(()=>(window as any).__fixture.persistRelease);
        await f.page.evaluate(()=>(window as any).__navigate('/heavy/wear-design-detail?keep=next'));
        await f.page.waitForFunction(()=>(window as any).__href==='/heavy/wear-design-detail?keep=next');
        await f.page.evaluate(()=>(window as any).__releasePersist());
      }
      if(mode==='success'){await f.page.waitForFunction(()=>new URL(location.href).searchParams.get('resumeJob')==='returned-persisted-job',{}, {timeout:10000});assert.equal(new URL(f.page.url()).searchParams.get('keep'),'preserved');assert.equal(new URL(f.page.url()).searchParams.get('tool'),'lab');
        const input=(await state(f.page)).persistInput;assert.equal(input.metadata.brief,'Exact persisted brief');assert(input.metadata.materialSlots.every((slot:any)=>!slot.imageUrl.startsWith('data:')&&!slot.imageUrl.startsWith('blob:')&&!slot.imageUrl.includes('token=')));}
      else{await f.page.waitForTimeout(200);assert.notEqual(new URL(f.page.url()).searchParams.get('resumeJob'),'returned-persisted-job');}
    }finally{await f.close();}
  });
});

test('replacement/scope/unmount release local object URLs; fresh entry remains latest-result-only',async()=>{
  const f=await fixture('lab');try{await restored(f.page);const before=await state(f.page);await f.page.evaluate(()=>(window as any).__unmount());
    await f.page.waitForFunction(()=>(window as any).__fixture.created.every(url=>(window as any).__fixture.released.includes(url)));assert(before.created.length>0);
  }finally{await f.close();}
  const fresh=await fixture('lab','fresh=1');try{await fresh.page.waitForFunction(()=>document.querySelector('main')?.getAttribute('data-lightchain-result-job')==='latest-job');
    assert.equal(await fresh.page.locator('main').getAttribute('data-lightchain-material-primary-id'),'');assert.equal((await state(fresh.page)).calls,0);
    assert.equal(await fresh.page.getByText('Latest unrelated brief',{exact:true}).count(),0);
  }finally{await fresh.close();}
});
