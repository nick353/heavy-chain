import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {createServer} from 'vite';
import {createPendingIndexedDbHarness,createPendingLegacyStorage} from './verify-cloudflare-image-pending-store.test.mjs';
const root=new URL('..',import.meta.url).pathname;
const vite=await createServer({root,configFile:false,envFile:false,cacheDir:`/tmp/heavy-printing-draft-${process.pid}`,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
const persistence=await vite.ssrLoadModule('/src/lib/printInputPersistence.ts');
const source=await fs.readFile(process.env.HEAVY_PRINTING_SOURCE??new URL('../src/pages/LightchainParityPages.tsx',import.meta.url),'utf8');
const parsed=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[];const walk=node=>{nodes.push(node);ts.forEachChild(node,walk);};walk(parsed);
const call=nodes.find(n=>ts.isCallExpression(n)&&n.expression.getText(parsed)==='persistPrintInputState'&&n.arguments[1]?.getText(parsed)==='referenceImage');
const original={window:globalThis.window,localStorage:globalThis.localStorage,indexedDB:globalThis.indexedDB,FileReader:globalThis.FileReader,fetch:globalThis.fetch};
let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw new Error('external_fetch_forbidden');};
after(async()=>{Object.assign(globalThis,original);await vite.close();assert.equal(networkCalls,0);});
for(const coverage of ['full','spot'])test(`canonical fresh draft keeps ${coverage} through actual scoped save/module reload`,async()=>{
 const storage=createPendingLegacyStorage();globalThis.window={localStorage:storage};globalThis.localStorage=storage;globalThis.indexedDB=createPendingIndexedDbHarness();
 globalThis.FileReader=class { readAsDataURL(blob){void blob.arrayBuffer().then(bytes=>{this.result=`data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;this.onload?.();});} };
 const persistenceScope={origin:'https://print-draft.test',userId:'alice'};
 const printImage={url:'',file:new Blob(['artwork-bytes'],{type:'image/png'}),referenceType:'pattern',galleryImageId:'artwork',storagePath:'generated-images/artwork'};
 const reference={url:'',file:new Blob(['garment-bytes'],{type:'image/png'}),referenceType:'base',galleryImageId:'garment',storagePath:'generated-images/garment'};
 const options=new Function('coverage','printImage','persistenceScope','assertContext',ts.transpile(`return (${call.arguments[4].getText(parsed)});`,{target:ts.ScriptTarget.ES2022}))(coverage,printImage,persistenceScope,()=>undefined);
 assert.equal(options.editorState?.coverageMode,coverage,'actual page must supply coverage');
 await persistence.persistPrintInputState('brand',reference,[printImage],{garment:null,designs:[]},options);
 const restarted=await vite.ssrLoadModule(`/src/lib/printInputPersistence.ts?reload=${crypto.randomUUID()}`);
 const restored=await restarted.restorePrintInputState('brand',{scope:persistenceScope});
 assert.equal(restored.editorState.coverageMode,coverage);assert.equal(restored.garment.storagePath,reference.storagePath);assert.equal(restored.designs[0].storagePath,printImage.storagePath);
 assert.equal(restored.garment.url,'data:image/png;base64,Z2FybWVudC1ieXRlcw==');assert.equal(restored.designs[0].url,'data:image/png;base64,YXJ0d29yay1ieXRlcw==');
 const foreign=await restarted.restorePrintInputState('brand',{scope:{...persistenceScope,userId:'bob'}});assert.equal(foreign.garment,null);assert.equal(foreign.designs.length,0);
 const effect=nodes.find(n=>ts.isCallExpression(n)&&n.expression.getText(parsed)==='useEffect'&&n.arguments[0]?.getText(parsed).includes('persistPrintInputState(currentBrand.id,referenceImage'));
 assert.ok(effect.arguments[1].elements.some(n=>n.getText(parsed)==='coverage'),'changing coverage must schedule persistence');
});

test('actual page source mappings retain both Library identities through scoped storage and fresh restore',async()=>{
 const storage=createPendingLegacyStorage();globalThis.window={localStorage:storage};globalThis.localStorage=storage;globalThis.indexedDB=createPendingIndexedDbHarness();globalThis.FileReader=class{readAsDataURL(blob){void blob.arrayBuffer().then(bytes=>{this.result=`data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;this.onload?.();});}};
 const workspace={slots:{primary:{imageUrl:'blob:owned-garment',sourceImageId:'ai-garment-0',sourceStoragePath:'generated-images/ai-garment-0'},secondary:{imageUrl:'blob:owned-pattern',sourceImageId:'ai-pattern-0',sourceStoragePath:'generated-images/ai-pattern-0'}}};
 const mapping=name=>{const node=nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(parsed)===name);return new Function('workspace',ts.transpile(`return (${node.initializer.getText(parsed)});`,{target:ts.ScriptTarget.ES2022}))(workspace);};
 const reference=mapping('referenceImage'),design=mapping('printImage');assert.equal(reference.galleryImageId,workspace.slots.primary.sourceImageId);assert.equal(design.storagePath,workspace.slots.secondary.sourceStoragePath);
 const blobs=new Map([['blob:owned-garment',new Blob(['actual-garment-bytes'],{type:'image/png'})],['blob:owned-pattern',new Blob(['actual-pattern-bytes'],{type:'image/png'})]]);const forbidden=globalThis.fetch;globalThis.fetch=async url=>{const blob=blobs.get(url);if(!blob)return forbidden(url);return {ok:true,blob:async()=>blob};};
 try{const persistenceScope={origin:'https://identity.test',userId:'alice'},coverage='full';const options=new Function('coverage','printImage','persistenceScope','assertContext',ts.transpile(`return (${call.arguments[4].getText(parsed)});`,{target:ts.ScriptTarget.ES2022}))(coverage,design,persistenceScope,()=>undefined);
  await persistence.persistPrintInputState('brand',reference,[design],{garment:null,designs:[]},options);const fresh=await vite.ssrLoadModule(`/src/lib/printInputPersistence.ts?identity=${crypto.randomUUID()}`);const restored=await fresh.restorePrintInputState('brand',{scope:persistenceScope});
  for(const [saved,original] of [[restored.garment,reference],[restored.designs[0],design]]){assert.equal(saved.galleryImageId,original.galleryImageId);assert.equal(saved.storagePath,original.storagePath);assert.equal(saved.fromGallery,true);}
  assert.equal(restored.garment.url,'data:image/png;base64,YWN0dWFsLWdhcm1lbnQtYnl0ZXM=');assert.equal(restored.designs[0].url,'data:image/png;base64,YWN0dWFsLXBhdHRlcm4tYnl0ZXM=');
 }finally{globalThis.fetch=forbidden;}
});
