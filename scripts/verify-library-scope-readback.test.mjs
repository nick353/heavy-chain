import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../src/pages/LightchainLibraryPage.tsx',import.meta.url),'utf8');
const parsed = ts.createSourceFile('library.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[]; const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(parsed);
const effects=nodes.filter(n=>ts.isCallExpression(n)&&n.expression.getText(parsed)==='useEffect');
const remote=effects.find(n=>n.arguments[0].getText(parsed).includes('const loadRemoteAssets'));
const evaluate=(code,bindings)=>new Function('bindings',`with(bindings){${ts.transpile(`return (${code});`,{target:ts.ScriptTarget.ES2022})}}`)(new Proxy(bindings,{has:()=>true,get:(o,k)=>k===Symbol.unscopables?undefined:k in o?o[k]:globalThis[k]}));
const helperNames=['isVideoGeneratedImage','metadataLibraryTitle','remoteAssetFromImage'];
const helpers=nodes.filter(n=>ts.isVariableDeclaration(n)&&helperNames.includes(n.name.getText(parsed)));
const idle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const image={id:'result-1',brand_id:'brand',feature_type:'fabric-image',image_url:'expired-bearer',storage_path:'generated-images/result-1',metadata:{},prompt:'fabric',created_at:'2026-10-02',is_favorite:false};
function fixture({list=async()=>[image],sign=async rows=>rows.map(r=>({...r,image_url:'fresh-url'}))}={}) {
 const state={assets:[{id:'old'}],scope:'old',error:false},calls={reads:0,signs:0,writes:0};
 const bindings={currentBrand:{id:'brand'},user:{id:'alice'},libraryScope:JSON.stringify(['brand','alice']),remoteReload:0,
  cloudflareDataPlane:{listGeneratedImages:async(brand,options)=>{calls.reads++;assert.equal(brand,'brand');assert.deepEqual(options,{limit:100,offset:0});return list();}},
  asGeneratedImageListRow:v=>v,withSignedImageUrls:async rows=>{calls.signs++;return sign(rows);},
  setRemoteAssets:v=>state.assets=v,setRemoteAssetsScope:v=>state.scope=v,setRemoteLoadError:v=>state.error=v,
 };
 for(const helper of helpers)bindings[helper.name.getText(parsed)]=evaluate(helper.initializer.getText(parsed),bindings);
 const run=()=>evaluate(remote.arguments[0].getText(parsed),bindings)();
 return {bindings,state,calls,run};
}

test('actual library loader clears old cards and adopts freshly signed original identity',async()=>{
 const hold=deferred(),f=fixture({list:()=>hold.promise});f.run();assert.deepEqual(f.state.assets,[]);assert.equal(f.state.scope,null);
 hold.resolve([image]);await idle();assert.equal(f.state.assets[0].remoteImageId,image.id);assert.equal(f.state.assets[0].storagePath,image.storage_path);assert.equal(f.state.assets[0].imageUrl,'fresh-url');assert.equal(f.state.scope,f.bindings.libraryScope);assert.equal(f.calls.writes,0);
});
test('scope cancellation before list completion never signs or exposes previous owner results',async()=>{
 const hold=deferred(),f=fixture({list:()=>hold.promise});const cancel=f.run();cancel();hold.resolve([image]);await idle();assert.equal(f.calls.signs,0);assert.deepEqual(f.state.assets,[]);assert.equal(f.state.scope,null);
});
test('scope cancellation during signing cannot promote cards or old failure state',async()=>{
 for(const rejects of [false,true]){const hold=deferred(),f=fixture({sign:()=>hold.promise});const cancel=f.run();await idle();cancel();rejects?hold.reject(new Error('late failure')):hold.resolve([{...image,image_url:'fresh-url'}]);await idle();assert.deepEqual(f.state.assets,[]);assert.equal(f.state.scope,null);assert.equal(f.state.error,false);}
});
test('list/sign/media failures expose recoverable read error; retry only repeats reads',async()=>{
 for(const failure of ['list','sign','empty-media']){let failing=true;const f=fixture({list:async()=>{if(failing&&failure==='list')throw new Error('offline');return [image];},sign:async rows=>{if(failing&&failure==='sign')throw new Error('sign failure');return rows.map(r=>({...r,image_url:failing&&failure==='empty-media'?'':'fresh-url'}));}});
  f.run();await idle();assert.equal(f.state.error,true);assert.deepEqual(f.state.assets,[]);assert.equal(f.state.scope,null);failing=false;f.run();await idle();assert.equal(f.state.error,false);assert.equal(f.state.assets[0].remoteImageId,image.id);assert.equal(f.calls.reads,2);assert.equal(f.calls.writes,0);
 }
});
test('logout performs no list/sign and actual card memo excludes old owner or brand immediately',async()=>{
 const f=fixture();f.bindings.user=null;f.bindings.libraryScope=null;f.run();await idle();assert.equal(f.calls.reads,0);assert.equal(f.calls.signs,0);assert.deepEqual(f.state.assets,[]);
 const memo=nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(parsed)==='libraryCards').initializer.arguments[0].getText(parsed);
 const local={id:'local',brandId:'brand',scopeId:'alice',metadata:{}};
 for(const [brand,user,scope,remoteScope,expected] of [['brand','alice','current','current',2],['brand','bob','next','current',0],['other','alice','next','current',0],['brand',null,null,'current',0]]){
  const cards=evaluate(memo,{artifacts:[local],currentBrand:{id:brand},user:user?{id:user}:null,libraryScope:scope,remoteAssetsScope:remoteScope,remoteAssets:[{id:'remote',remoteImageId:'remote'}],importedRemoteImageIds:new Set()})();assert.equal(cards.length,expected);
 }
});
test('actual scope-change effect clears selected panels and pending delete; owner is a remote effect dependency',()=>{
 const reset=effects.find(n=>n.arguments[0].getText(parsed).includes('setSelectedIds(new Set())'));assert.ok(reset);
 const state={},bindings={};for(const key of ['SelectedAssetId','SelectedIds','PendingDelete','DetailMode','RenameOpen','DownloadOpen','OpenMenuId'])bindings['set'+key]=v=>state[key]=v;
 evaluate(reset.arguments[0].getText(parsed),bindings)();assert.equal(state.SelectedAssetId,null);assert.equal(state.SelectedIds.size,0);assert.equal(state.PendingDelete,null);assert.equal(state.DetailMode,false);assert.equal(state.RenameOpen,false);assert.equal(state.DownloadOpen,false);
 const values={currentBrand:{id:'brand'},user:{id:'alice'},libraryScope:'scope',remoteReload:0};const before=evaluate(remote.arguments[1].getText(parsed),values);values.user={id:'bob'};const after=evaluate(remote.arguments[1].getText(parsed),values);assert.notDeepEqual(before,after);
});
