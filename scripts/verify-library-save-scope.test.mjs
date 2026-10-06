import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../src/pages/LightchainLibraryPage.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[];const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(ast);
const auth={};new Function('exports',ts.transpile(await fs.readFile(new URL('../src/lib/authBrandSelection.ts',import.meta.url),'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(auth);
const evaluate=(code,bindings)=>new Function('bindings',`with(bindings){${ts.transpile(`return (${code});`,{target:ts.ScriptTarget.ES2022})}}`)(new Proxy(bindings,{has:()=>true,get:(o,k)=>k===Symbol.unscopables?undefined:k in o?o[k]:globalThis[k]}));
const declaration=name=>nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name).initializer.getText(ast);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const idle=()=>new Promise(resolve=>setImmediate(resolve));
const asset={id:'remote-original',imageUrl:'signed-original',title:'original',featureType:'fabric',remoteImageId:'ai-original',storagePath:'generated-images/ai-original',prompt:'original',createdAt:'2026-10-02'};
function fixture({read=async()=> 'data:image/png;base64,b3JpZw==',save=async()=>{},capture=async()=>{}}={}){
 let authState={user:{id:'alice'},currentBrand:{id:'brand'},brandState:{status:'success_nonempty',userId:'alice',requestGeneration:1,confirmedBrandIds:['brand']}};
 const state={artifacts:[],groups:[],selected:[],success:[],errors:[],routes:[],uploading:false,remoteAssets:[asset],renamed:[]},calls={saves:0,captures:0};
 const bindings={...auth,currentBrand:{id:'brand'},user:{id:'alice'},saveOperationRef:{current:null},useAuthStore:{getState:()=>authState},setUploading:v=>state.uploading=v,
  selectedAsset:{kind:'remote',asset},renameValue:'new title',setRenameOpen:v=>state.renamed.push(v),setRemoteAssets:f=>state.remoteAssets=f(state.remoteAssets),
  readFileAsDataUrl:read,MAX_LIBRARY_UPLOAD_BYTES:10*1024*1024,customGroups:[],activeGroup:'履歴アップロード',
  cloudflareDataPlane:{captureArtifactPersistenceContext:async options=>{calls.captures++;await capture();await options.assertContext();return {assertCurrent:options.assertContext};},updateGeneratedImageLibraryTitle:async(id,title,context)=>{assert.equal(id,asset.remoteImageId);assert.equal(title,'new title');assert.ok(context);calls.saves++;await context.assertCurrent();await save();await context.assertCurrent();},deleteGeneratedImage:async(id,context)=>{assert.equal(id,asset.remoteImageId);assert.ok(context);calls.saves++;await context.assertCurrent();await save();await context.assertCurrent();}},
  saveWorkspaceArtifactBestEffort:async(input,options)=>{calls.saves++;assert.ok(options.persistenceContext);await options.persistenceContext.assertCurrent();await save();await options.persistenceContext.assertCurrent();return {localPersisted:true,remote:true,artifact:{...input,id:'original-id'}};},
  toast:{success:v=>state.success.push(v),error:v=>state.errors.push(v)},setArtifacts:f=>state.artifacts=f(state.artifacts),setActiveGroup:v=>state.groups.push(v),setSelectedAssetId:v=>state.selected.push(v),navigate:v=>state.routes.push(v),
  lightchainUnifiedFeatureCatalog:[],buildLightchainLibraryFeatureHref:()=>{throw new Error('unexpected');},
 };
 bindings.beginLibrarySave=evaluate(declaration('beginLibrarySave'),bindings);
 const reset=nodes.find(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0].getText(ast).includes('saveOperationRef.current = null'));
 const start=kind=>kind==='rename'?evaluate(declaration('handleRenameSelected'),bindings)():kind==='delete'?evaluate(declaration('handleDeleteCard'),bindings)({kind:'remote',asset}):kind==='upload'?evaluate(declaration('handleUpload'),bindings)({target:{files:[{name:'original.png',type:'image/png',size:4}],value:'selected'}}):evaluate(declaration('handleImportRemote'),bindings)(asset,'fitting');
 return {state,calls,bindings,start,change(kind){authState=kind==='generation'?{...authState,brandState:{...authState.brandState,requestGeneration:2}}:kind==='logout'?{...authState,user:null}:{...authState,user:{id:'bob'},brandState:{...authState.brandState,userId:'bob'}};},reset:()=>evaluate(reset.arguments[0].getText(ast),bindings)()};
}
for(const kind of ['upload','import']){
 test(`${kind}: unchanged scope preserves original identity and uses persistence context`,async()=>{const f=fixture();await f.start(kind);assert.equal(f.calls.saves,1);assert.equal(f.state.artifacts[0].id,'original-id');assert.equal(f.state.artifacts[0].scopeId,'alice');assert.equal(f.state.success.length,1);assert.equal(f.state.uploading,false);assert.equal(f.state.routes.length,kind==='import'?1:0);});
 test(`${kind}: scope/generation/logout change during save cannot promote or navigate`,async()=>{for(const change of ['owner','generation','logout']){const hold=deferred(),f=fixture({save:()=>hold.promise});const run=f.start(kind);await idle();assert.equal(f.calls.saves,1);f.change(change);hold.resolve();await run;assert.deepEqual(f.state.artifacts,[]);assert.deepEqual(f.state.routes,[]);assert.deepEqual(f.state.success,[]);assert.deepEqual(f.state.errors,[]);}});
 test(`${kind}: capture delay and duplicate click never dispatch another save`,async()=>{const hold=deferred(),f=fixture({capture:()=>hold.promise});const run=f.start(kind);await f.start(kind);assert.equal(f.calls.captures,1);f.change('owner');hold.resolve();await run;assert.equal(f.calls.saves,0);});
 test(`${kind}: late old failure cannot clear a new operation after scope reset`,async()=>{const oldHold=deferred(),newHold=deferred();let saves=0;const f=fixture({save:()=>++saves===1?oldHold.promise:newHold.promise});const old=f.start(kind);await idle();f.reset();const newer=f.start(kind);await idle();assert.equal(f.state.uploading,true);oldHold.reject(new Error('late failure'));await old;assert.equal(f.state.uploading,true);assert.equal(f.state.errors.length,0);newHold.resolve();await newer;assert.equal(f.state.success.length,1);assert.equal(f.state.uploading,false);assert.equal(f.calls.saves,2);});
}
test('upload: file-read delay checks auth fence before save; unmount invalidates pending work',async()=>{for(const mode of ['scope','unmount']){const hold=deferred(),f=fixture({read:()=>hold.promise});const run=f.start('upload');await idle();if(mode==='scope')f.change('owner');else f.reset()();hold.resolve('data:image/png;base64,b3JpZw==');await run;assert.equal(f.calls.saves,0);assert.deepEqual(f.state.artifacts,[]);}});

for(const kind of ['rename','delete']) {
 test(`${kind}: current scope dispatches exact original remote ID through persistence context`,async()=>{const f=fixture();await f.start(kind);assert.equal(f.calls.saves,1);assert.equal(f.calls.captures,1);assert.equal(f.state.success.length,1);assert.equal(f.state.uploading,false);if(kind==='rename')assert.equal(f.state.remoteAssets[0].title,'new title');else assert.equal(f.state.remoteAssets.length,0);});
 test(`${kind}: late owner/generation/logout response cannot alter new selection or notify`,async()=>{for(const change of ['owner','generation','logout']){const hold=deferred(),f=fixture({save:()=>hold.promise});const old=f.start(kind);await idle();f.change(change);f.reset();f.state.selected.push('new-selection');hold.resolve();await old;assert.deepEqual(f.state.selected,['new-selection']);assert.deepEqual(f.state.success,[]);assert.deepEqual(f.state.errors,[]);assert.equal(f.state.remoteAssets[0].title,'original');}});
 test(`${kind}: pending context and duplicate click dispatch at most once`,async()=>{const hold=deferred(),f=fixture({capture:()=>hold.promise});const old=f.start(kind);await f.start(kind);assert.equal(f.calls.captures,1);f.change('owner');hold.resolve();await old;assert.equal(f.calls.saves,0);});
}
