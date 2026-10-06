import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../src/pages/FittingPage.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[];const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(ast);
const evaluate=(code,bindings)=>new Function('bindings',`with(bindings){${ts.transpile(`return (${code});`,{target:ts.ScriptTarget.ES2022})}}`)(new Proxy(bindings,{has:()=>true,get:(o,k)=>k===Symbol.unscopables?undefined:k in o?o[k]:globalThis[k]}));
const idle=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(kind,{reference={imageUrl:'expired-signed-url',sourceStoragePath:'generated-images/original',sourceImageId:'original'},sign=async()=> 'fresh-signed-url',remoteFail=false}={}){
 const state={material:null,status:null,message:null,input:null},calls={signs:0,reads:0};
 const result={materialReference:reference};
 const bindings={currentBrand:{id:'brand'},user:{id:'alice'},resumeJob:kind==='resume'?'known-job':null,libraryArtifactId:null,
  resetFittingDraftPersistenceState:()=>{},readFittingResumeMaterial:()=>remoteFail?null:result,readFittingDraftMaterial:()=>result,listWorkspaceArtifacts:(brand,user)=>{assert.equal(brand,'brand');assert.equal(user,'alice');return [];},
  cloudflareDataPlane:{listGeneratedImages:async()=>{calls.reads++;throw new Error('remote_read_failed');}},
  resolveGeneratedImageUrl:async path=>{assert.equal(path,'generated-images/original');calls.signs++;return sign();},
  readFittingDraftCutout:async()=>null,fittingDraftPersistenceErrorRef:{current:false},fittingDraftRestoredRef:{current:false},
  setMaterialReference:v=>state.material=v,setResumeInputReadback:v=>state.input=v,setFittingDraftPersistenceStatus:v=>state.status=v,setFittingDraftPersistenceMessage:v=>state.message=v,setErrorMessage:()=>{},
 };
 const name=kind==='resume'?'const restoreResumeMaterial':'const restoreDraft';
 const effect=nodes.find(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0].getText(ast).includes(name));
 return {state,calls,run:()=>evaluate(effect.arguments[0].getText(ast),bindings)()};
}
for(const kind of ['resume','draft']){
 test(`${kind}: actual effect always re-signs canonical path and keeps source identity`,async()=>{const f=fixture(kind);f.run();await idle();assert.equal(f.calls.signs,1);assert.equal(f.state.material.imageUrl,'fresh-signed-url');assert.equal(f.state.material.sourceImageId,'original');assert.equal(f.state.material.sourceStoragePath,'generated-images/original');});
 test(`${kind}: canonical signing failure never adopts old URL`,async()=>{const f=fixture(kind,{sign:async()=>{throw new Error('offline');}});f.run();await idle();assert.equal(f.calls.signs,1);assert.equal(f.state.material,null);assert.equal(f.state.status,'unavailable');assert.match(f.state.message,/再署名/);});
 test(`${kind}: cancelled read/sign does not promote stale owner state or failure`,async()=>{for(const failure of [false,true]){const hold=deferred(),f=fixture(kind,{sign:()=>hold.promise});const cancel=f.run();await idle();cancel();failure?hold.reject(new Error('late')):hold.resolve('fresh-signed-url');await idle();assert.equal(f.state.material,null);assert.equal(f.state.status,null);}});
 test(`${kind}: local original bytes remain readable without signing or remote lookup`,async()=>{const imageUrl='data:image/png;base64,b3JpZw==';const f=fixture(kind,{reference:{imageUrl,sourceImageId:'local-original',sourceStoragePath:null}});f.run();await idle();assert.equal(f.calls.signs,0);assert.equal(f.calls.reads,0);assert.equal(f.state.material.imageUrl,imageUrl);assert.equal(f.state.material.sourceImageId,'local-original');});
}
test('resume: remote lookup failure becomes unavailable and cancelled lookup cannot update UI',async()=>{const f=fixture('resume',{remoteFail:true});f.run();await idle();assert.equal(f.state.input,'unavailable');assert.equal(f.state.status,'unavailable');assert.equal(f.state.material,null);const g=fixture('resume',{remoteFail:true});const cancel=g.run();cancel();await idle();assert.equal(g.state.status,null);});
