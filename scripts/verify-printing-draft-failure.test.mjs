import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../src/pages/LightchainParityPages.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[];const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(ast);
const effect=nodes.find(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0].getText(ast).includes('restorePrintInputState'));
const evaluate=(code,b)=>new Function('bindings',`with(bindings){${ts.transpile(`return (${code});`,{target:ts.ScriptTarget.ES2022})}}`)(new Proxy(b,{has:()=>true,get:(o,k)=>k===Symbol.unscopables?undefined:k in o?o[k]:globalThis[k]}));
const idle=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture({restore,sign,fetcher}={}){
 const b={user:{id:'alice'},currentBrand:{id:'brand'},persistenceScope:{origin:'local',userId:'alice'},draftReady:{current:false},draftEdited:{current:false},draftSourceEdited:{current:false},draftReadyContext:{current:null},draftContext:'original-context',draftContextRef:{current:'original-context'},explicitLibrary:false,draftRestoreGeneration:{current:0},workspace:{jobId:null,upload:async(key,file)=>{b.uploads.push([key,await file.text()]);},setInputState:v=>b.input=v},restorePrintInputState:restore??(async()=>({garment:{url:'old-url',storagePath:'generated-images/source'},designs:[{url:'data:image/png;base64,eA=='}],editorState:{coverageMode:'full'}})),withSignedImageUrls:sign??(async()=>[{image_url:'fresh-url'}]),fetch:fetcher??(async url=>({ok:true,blob:async()=>new Blob([url],{type:'image/png'})})),uploads:[],message:null,input:null,setMessage:v=>b.message=v};
 return {b,run:()=>evaluate(effect.arguments[0].getText(ast),b)()};
}
test('failed canonical signing does not fetch old URL or allow partial-draft overwrite',async()=>{const calls=[],f=fixture({sign:async()=>{throw Error('offline');},fetcher:async url=>{calls.push(url);return {ok:true,blob:async()=>new Blob([url],{type:'image/png'})};}});f.run();await idle();assert.equal(f.b.draftReady.current,false);assert.match(f.b.message,/取得できません/);assert.deepEqual(calls,['data:image/png;base64,eA==']);});
test('whole draft read failure remains visible and cannot unlock automatic persistence',async()=>{const f=fixture({restore:async()=>{throw Error('missing');}});f.run();await idle();assert.equal(f.b.draftReady.current,false);assert.match(f.b.message,/取得できません/);assert.equal(f.b.uploads.length,0);});
test('successful read restores both original bytes and coverage before enabling explicit edits',async()=>{const f=fixture();f.run();await idle();assert.equal(f.b.uploads.length,2);assert.equal(f.b.draftReady.current,true);assert.equal(f.b.input.coverage,'full');});
test('cancelled scope or explicit newer edit cannot promote pending source success/failure',async()=>{for(const failure of [false,true])for(const cancelMode of ['scope','edit']){const h=deferred(),f=fixture({sign:()=>h.promise});const cancel=f.run();await idle();if(cancelMode==='scope')cancel();else f.b.draftRestoreGeneration.current++;failure?h.reject(Error('late')):h.resolve([{image_url:'fresh-url'}]);await idle();assert.equal(f.b.uploads.length,0);assert.equal(f.b.message,null);assert.equal(f.b.input,null);}});

test('actual explicit file selection cancels late draft adoption and allows saving new selection',async()=>{
 const h=deferred(),f=fixture({sign:()=>h.promise});f.run();await idle();
 const begin=nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='beginDraftEdit');assert.ok(begin);f.b.beginDraftEdit=evaluate(begin.initializer.getText(ast),f.b);
 const workspace=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='LightchainPrintingWorkspace');const local=[];const collect=n=>{local.push(n);ts.forEachChild(n,collect);};collect(workspace);
 const handler=local.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='handleFile');assert.ok(handler);
 const file=new File(['new-user-bytes'],'new.png',{type:'image/png'});evaluate(handler.initializer.getText(ast),f.b)({target:{files:[file]}},'base');await idle();h.resolve([{image_url:'old-restore-url'}]);await idle();
 assert.deepEqual(f.b.uploads,[['primary','new-user-bytes']]);assert.equal(f.b.draftReady.current,true);assert.equal(f.b.input,null);
});

test('cancelling a file picker keeps restore failure and persistence lock',async()=>{
 const f=fixture({restore:async()=>{throw Error('missing');}});f.run();await idle();const message=f.b.message;
 const begin=nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='beginDraftEdit');f.b.beginDraftEdit=evaluate(begin.initializer.getText(ast),f.b);
 const workspace=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='LightchainPrintingWorkspace');const local=[];const collect=n=>{local.push(n);ts.forEachChild(n,collect);};collect(workspace);
 for(const name of ['handleFile','handleCanonicalFiles']){const handler=local.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name);evaluate(handler.initializer.getText(ast),f.b)({target:{files:[]}},'base');}
 assert.equal(f.b.message,message);assert.equal(f.b.draftReady.current,false);assert.equal(f.b.uploads.length,0);
});
