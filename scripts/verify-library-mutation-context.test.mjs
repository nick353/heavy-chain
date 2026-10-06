import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
const originalFetch=globalThis.fetch;
const root=new URL('..',import.meta.url).pathname;
const vite=await createServer({root,configFile:false,envFile:false,cacheDir:`/tmp/library-mutation-${process.pid}`,appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{name:'isolated-library-api-auth',enforce:'pre',resolveId(id){if(/(?:^|\/)auth(?:\.ts)?$/.test(id))return '\0library-auth';},load(id){if(id==='\0library-auth')return 'export const auth={getSession:async()=>globalThis.__libraryMockSession()};export const refreshAuthSession=async()=>globalThis.__libraryMockSession();';},transform(code,id){if(id.endsWith('/src/lib/cloudflareApi.ts'))return code+'\nexport {CloudflareDataPlaneClient};';}}]});
const {CloudflareDataPlaneClient,ArtifactPersistenceContextError}=await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){let token='mock-token-a',user='alice',valid=true;const calls=[];
 globalThis.__libraryMockSession=()=>({data:{session:{user:{id:user},access_token:token}},error:null});
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.fixture.invalid/v1/generated-images/ai-original');assert.ok(['PATCH','DELETE'].includes(options.method));calls.push({url,method:options.method,authorization:new Headers(options.headers).get('authorization'),body:options.body});return {ok:true,json:async()=>({id:'ai-original'})};};
 const client=new CloudflareDataPlaneClient('https://api.fixture.invalid');
 return {client,calls,capture:()=>client.captureArtifactPersistenceContext({assertContext:()=>{if(!valid)throw new Error('brand_changed');}}),change(kind){if(kind==='token')token='mock-token-b';if(kind==='owner')user='bob';if(kind==='brand')valid=false;}};
}
for(const kind of ['rename','delete']){
 const run=(client,context)=>kind==='rename'?client.updateGeneratedImageLibraryTitle('ai-original','new title',context):client.deleteGeneratedImage('ai-original',context);
 test(`${kind}: existing callers without context retain the authenticated request path`,async()=>{const f=fixture();await run(f.client,undefined);assert.equal(f.calls.length,1);assert.equal(f.calls[0].authorization,'Bearer mock-token-a');});
 test(`${kind}: actual client sends exact identity once with captured auth and no provider call`,async()=>{const f=fixture(),context=await f.capture();await run(f.client,context);assert.equal(f.calls.length,1);assert.equal(f.calls[0].authorization,'Bearer mock-token-a');assert.equal(f.calls[0].method,kind==='rename'?'PATCH':'DELETE');if(kind==='rename')assert.deepEqual(JSON.parse(f.calls[0].body),{library_title:'new title'});});
 test(`${kind}: actual opaque context rejects owner/token/brand revocation and forged/cross-client context before fetch`,async()=>{for(const change of ['token','owner','brand']){const f=fixture(),context=await f.capture();f.change(change);await assert.rejects(run(f.client,context),ArtifactPersistenceContextError);assert.equal(f.calls.length,0);}const f=fixture(),context=await f.capture();await assert.rejects(run(f.client,{assertCurrent:async()=>{}}),ArtifactPersistenceContextError);await assert.rejects(run(new CloudflareDataPlaneClient('https://other.fixture.invalid'),context),ArtifactPersistenceContextError);assert.equal(f.calls.length,0);});
 test(`${kind}: actual client checks revoked context after delayed response and never retries mutation`,async()=>{const f=fixture(),hold=deferred(),context=await f.capture();globalThis.fetch=async()=>{f.calls.push({method:kind});await hold.promise;return {ok:true,json:async()=>({id:'ai-original'})};};const pending=run(f.client,context);await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);f.change('brand');hold.resolve();await assert.rejects(pending,ArtifactPersistenceContextError);assert.equal(f.calls.length,1);});
}
after(async()=>{globalThis.fetch=originalFetch;delete globalThis.__libraryMockSession;await vite.close();});
