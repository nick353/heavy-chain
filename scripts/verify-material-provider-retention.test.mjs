import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { createServer } from 'vite';
import { createPendingIndexedDbHarness, createPendingLegacyStorage } from './verify-cloudflare-image-pending-store.test.mjs';
const root = new URL('..', import.meta.url).pathname;
const vite = await createServer({root,configFile:false,envFile:false,cacheDir:`/tmp/heavy-material-retention-${process.pid}`,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
const image = await vite.ssrLoadModule('/src/lib/cloudflareImageAI.ts');
const source = await fs.readFile(process.env.HEAVY_MATERIAL_SOURCE ?? new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx',import.meta.url),'utf8');
const parsed = ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=[];const walk=node=>{nodes.push(node);ts.forEachChild(node,walk);};walk(parsed);
const evaluate=(expression,bindings)=>new Function(...Object.keys(bindings),ts.transpile(`return (${expression});`,{target:ts.ScriptTarget.ES2022}))(...Object.values(bindings));
const original={window:globalThis.window,localStorage:globalThis.localStorage,indexedDB:globalThis.indexedDB};
after(async()=>{Object.assign(globalThis,original);await vite.close();});
function actualControls(feature) {
 const options=nodes.find(n=>ts.isObjectLiteralExpression(n)&&n.properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(parsed)==='featureType'&&p.initializer.getText(parsed)===`'lightchain-${feature}'`)&&n.properties.some(p=>p.name?.getText(parsed)==='assertContext'));
 assert(options,'actual material provider options exist');
 const controls=options.properties.filter(p=>['retainUntilAcknowledged','assertContext'].includes(p.name?.getText(parsed)));
 return evaluate(`({${controls.map(p=>p.getText(parsed)).join(',')}})`,{assertCurrentAuthBrandFence:()=>{},authBrandFence:{},isCurrentRequest:()=>true});
}
for(const feature of ['fabric-image','printing-image'])test(`${feature}: actual provider options retain inference through failed save and reload`,async()=>{
 const store=new Map();globalThis.localStorage=createPendingLegacyStorage(store);globalThis.indexedDB=createPendingIndexedDbHarness();globalThis.window={dispatchEvent(){}};
 const controls=actualControls(feature);let posts=0,gets=0;const requestId=crypto.randomUUID();
 const options={origin:'https://material.test',userId:'alice',action:'edit-image',body:{brandId:'brand',featureType:`lightchain-${feature}`,imageUrls:['data:source','data:reference'],prompt:'fixture'},idempotencyKey:requestId,retainUntilAcknowledged:controls.retainUntilAcknowledged,assertCurrent:async()=>controls.assertContext(),
 call:async(_path,init={})=>{if(init.method==='POST')posts++;else gets++;return {requestId,state:'completed',success:true,recovery:'terminal',persistenceStatus:'completed',images:[{imageId:`ai-${requestId}-0`,storagePath:`generated-images/ai-${requestId}-0`,imageUrl:'data:image/png;base64,AA=='}]};}};
 const receipt=await image.invokeDurableImageAction(options);assert.ok(receipt.clientRecoveryKey,'save caller must own ACK');
 const restarted=await vite.ssrLoadModule(`/src/lib/cloudflareImageAI.ts?reload=${crypto.randomUUID()}`);
 const recovered=await restarted.invokeDurableImageAction(options);assert.equal(recovered.requestId,requestId);assert.equal(recovered.clientRecoveryKey,receipt.clientRecoveryKey);
 assert.equal(posts,1);assert.equal(gets,1);assert.equal(store.size,1);
 await restarted.acknowledgeDurableImageAction({...options,receipt:recovered});assert.equal(store.size,0);
});
test('actual persistence callback guards auth and generation and is supplied to the existing save',()=>{
 const declaration=nodes.find(n=>ts.isVariableDeclaration(n)&&n.name.getText(parsed)==='assertProviderPersistenceCurrent');assert(declaration);
 let current=true,fence=true;
 const guard=evaluate(declaration.initializer.getText(parsed),{assertCurrentAuthBrandFence:()=>{if(!fence)throw new Error('auth_scope_changed');},authBrandFence:{},isCurrentRequest:()=>current});
 guard();current=false;assert.throws(guard,/material_provider_request_changed/);current=true;fence=false;assert.throws(guard,/auth_scope_changed/);
 const generation=source.slice(source.indexOf('  const handleGenerate ='),source.indexOf('  const addDesigns ='));
 assert.ok(generation.indexOf('prepareMaterialComposite(')<generation.indexOf('editImageWithPrompt('));
 assert.ok(generation.indexOf('validateMaterialCompositeArtifact(canonicalArtifact)')<generation.indexOf('acknowledgeImageAction(providerResult)'));
 assert.ok(generation.includes('assertProviderPersistenceCurrent();'));
 assert.ok(!generation.includes("providerResult.provider === 'openai' ||"));
 assert.ok(!generation.includes('composeProviderProtectedResult('));
});

test('actual Heavy fabric and printing callers select the connected OpenAI protected path with one candidate',()=>{
 for(const feature of ['fabric-image','printing-image']){
  const options=nodes.find(n=>ts.isObjectLiteralExpression(n)&&n.properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(parsed)==='featureType'&&p.initializer.getText(parsed)===`'lightchain-${feature}'`)&&n.properties.some(p=>p.name?.getText(parsed)==='materialRecoveryBinding'));assert(options);
  const properties=options.properties.filter(p=>['generationProvider','count','materialRecoveryBinding'].includes(p.name?.getText(parsed)));
  const selected=evaluate(`({${properties.map(p=>p.getText(parsed)).join(',')}})`,{isHeavyRoute:true,materialRecoveryBinding:{requestId:'original'}});assert.equal(selected.generationProvider,'openai');assert.equal(selected.count,1);assert.equal(selected.materialRecoveryBinding.requestId,'original');
 }
 assert(!source.includes('material_protected_openai_route_unresolved'));
});
