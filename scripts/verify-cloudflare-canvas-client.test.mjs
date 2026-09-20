import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';

const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
globalThis.window={location:{origin:'https://canvas-web.test'}};
const vite=await createServer({configFile:false,envFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true},define:{
  'import.meta.env.VITE_CLOUDFLARE_API_ENABLED':'"true"','import.meta.env.VITE_CLOUDFLARE_AUTH_ENABLED':'"true"','import.meta.env.VITE_CLOUDFLARE_API_BASE_URL':'"https://canvas-api.test"',
}});
const {auth}=await vite.ssrLoadModule('/src/lib/auth.ts');
const {cloudflareDataPlane:client}=await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
const persistence=await vite.ssrLoadModule('/src/lib/canvasDocumentPersistence.ts');
const recovery=await vite.ssrLoadModule('/src/lib/canvasDocumentSaveRecovery.ts');
after(async()=>{globalThis.fetch=originalFetch;auth.dispose();globalThis.window=originalWindow;await vite.close();});
let current,refreshes;
const setup=()=>{
  current={user:{id:'alice'},access_token:'canvas-test-token'};refreshes=0;
  auth.getSession=async()=>({data:{session:current},error:null});auth.refreshSession=async()=>{refreshes++;throw new Error('unexpected_refresh');};
  const values=new Map();window.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
};
const content={title:'Board',snapshot:{version:1,objects:[]}};
const context={userId:'alice',assertContext:()=>{}};
test('actual Canvas browser transport sends stable ID/revision and captured bearer through persistence wrappers',async()=>{
  setup();const id=crypto.randomUUID(),calls=[];
  globalThis.fetch=async(url,init)=>{
    assert.equal(new URL(url).origin,'https://canvas-api.test');assert.equal(new Headers(init.headers).get('authorization'),'Bearer canvas-test-token');assert(init.signal instanceof AbortSignal);
    calls.push({url,method:init.method??'GET',body:init.body&&JSON.parse(init.body)});
    return Response.json({id,ownerId:'alice',brandId:'brand',...content,revision:init.method==='PATCH'?1:0,snapshotVersion:1,createdAt:'now',updatedAt:'now'});
  };
  assert.equal((await persistence.createCanvasDocument({documentId:id,brandId:'brand',...content},context)).id,id);
  await persistence.getCanvasDocument(id,'brand',context);
  assert.equal((await persistence.updateCanvasDocument({documentId:id,brandId:'brand',expectedRevision:0,...content},context)).revision,1);
  assert.deepEqual(calls.map(c=>c.method),['POST','GET','PATCH']);assert.equal(calls[0].body.id,id);assert.equal(calls[2].body.expected_revision,0);assert.equal(refreshes,0);
});
test('actual Canvas transport never refresh-replays POST/PATCH on 401/403/409/503 or lost response',async()=>{
  setup();const id=crypto.randomUUID();let calls=0;
  for(const status of [401,403,409,503]){
    globalThis.fetch=async()=>{calls++;return Response.json({error:'rejected'},{status});};const before=calls;
    await assert.rejects(persistence.createCanvasDocument({documentId:id,brandId:'brand',...content},context),new RegExp('_'+status+'_'));
    await assert.rejects(persistence.updateCanvasDocument({documentId:id,brandId:'brand',expectedRevision:0,...content},context),new RegExp('_'+status+'_'));
    assert.equal(calls-before,2);
  }
  globalThis.fetch=async()=>{calls++;throw new TypeError('response_lost');};
  await assert.rejects(client.createCanvasDocument({id,brand_id:'brand',...content},context),/response_lost/);assert.equal(calls,9);assert.equal(refreshes,0);
});
test('actual Canvas transport fences expected user, late token changes and caller route changes',async()=>{
  setup();let calls=0;const id=crypto.randomUUID();
  globalThis.fetch=async()=>{calls++;return Response.json({id});};
  await assert.rejects(client.getCanvasDocument(id,{...context,userId:'bob'}),/session_changed/);assert.equal(calls,0);
  globalThis.fetch=async()=>{calls++;current={...current,access_token:'rotated'};return Response.json({id});};
  await assert.rejects(client.getCanvasDocument(id,context),/session_changed/);assert.equal(calls,1);
  let valid=true;globalThis.fetch=async()=>{calls++;valid=false;return Response.json({id});};
  await assert.rejects(client.getCanvasDocument(id,{...context,assertContext:()=>{if(!valid)throw new Error('route_changed');}}),/route_changed/);assert.equal(calls,2);assert.equal(refreshes,0);
});
test('full recovery plus actual browser transport reconciles a lost create by GET only',async()=>{
  setup();const id=crypto.randomUUID(),scope={origin:client.origin,userId:'alice',brandId:'brand'};let document=null,outage=false;const methods=[];
  globalThis.fetch=async(url,init)=>{
    methods.push(init.method??'GET');assert.equal(new URL(url).origin,scope.origin);
    if(init.method==='POST'){assert.equal(document,null);const body=JSON.parse(init.body);assert.equal(body.id,id);document={id,ownerId:'alice',brandId:'brand',...content,revision:0,snapshotVersion:1,createdAt:'now',updatedAt:'now'};outage=true;throw new Error('lost_create_response');}
    if(outage)return Response.json({error:'outage'},{status:503});return document?Response.json(document):Response.json({error:'not_found'},{status:404});
  };
  const options={scope,documentId:id,ownerId:'alice',expectedRevision:null,content,assertCurrent:()=>{},transport:{
    get:id=>persistence.getCanvasDocument(id,'brand',context),create:(id,body)=>persistence.createCanvasDocument({documentId:id,brandId:'brand',...body},context),update:(id,revision,body)=>persistence.updateCanvasDocument({documentId:id,brandId:'brand',expectedRevision:revision,...body},context),
  }};
  await assert.rejects(recovery.saveCanvasDocumentRecoverably(options),/503/);assert.deepEqual(methods,['GET','POST','GET']);
  outage=false;assert.equal((await recovery.inspectCanvasSaveRecovery(options)).state,'saved');assert.deepEqual(methods,['GET','POST','GET','GET']);assert.equal(refreshes,0);
});
