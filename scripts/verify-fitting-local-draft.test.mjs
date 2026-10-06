import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
const root=new URL('..',import.meta.url).pathname;
const oldWindow=globalThis.window;
const vite=await createServer({root,configFile:false,envFile:false,cacheDir:`/tmp/fitting-local-draft-${process.pid}`,appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{name:'local-draft-no-cloud',enforce:'pre',resolveId(id){if(/\/cloudflareApi(?:\.ts)?$/.test(id))return '\0draft-cloud';},load(id){if(id==='\0draft-cloud')return 'export class ArtifactPersistenceContextError extends Error{};export const cloudflareDataPlane=null;';}}]});
let workspace=await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');
let resume=await vite.ssrLoadModule('/src/lib/fittingResume.ts');
const imageUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4FQAAAAASUVORK5CYII=';
const reference={imageUrl,sourceImageId:'library-original',sourceStoragePath:null,fileName:'original.png',extractedLayerReady:false,nextStepReady:false,extractedImageUrl:null};
const artifact=ref=>({id:'draft-original',brandId:'brand',scopeId:'alice',featureType:'fitting-background-draft',title:'original',imageUrl,prompt:null,createdAt:'2026-10-02',metadata:{feature:'fitting-background-draft',draftVersion:'fitting-background-draft-v1',materialReference:ref}});
test('actual scoped save/module reload restores exact raw local bytes without claiming cutout completion',async()=>{
 const map=new Map();globalThis.window={localStorage:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},dispatchEvent(){}};
 const saved=workspace.saveWorkspaceArtifactPersisted(artifact(reference));assert.equal(saved.ok,true);
 const first=resume.readFittingDraftMaterial(workspace.listWorkspaceArtifacts('brand','alice'));assert.ok(first);assert.equal(first.materialReference.imageUrl,imageUrl);assert.equal(first.materialReference.sourceImageId,'library-original');assert.equal(first.materialReference.extractedLayerReady,false);assert.equal(first.materialReference.nextStepReady,false);
 vite.moduleGraph.invalidateAll();workspace=await vite.ssrLoadModule('/src/lib/localWorkspaceArtifacts.ts');resume=await vite.ssrLoadModule('/src/lib/fittingResume.ts');
 const restored=resume.readFittingDraftMaterial(workspace.listWorkspaceArtifacts('brand','alice'));assert.equal(restored.artifactId,saved.artifact.id);assert.equal(restored.materialReference.imageUrl,imageUrl);assert.deepEqual(Buffer.from(restored.materialReference.imageUrl.split(',')[1],'base64'),Buffer.from(imageUrl.split(',')[1],'base64'));assert.equal(restored.materialReference.nextStepReady,false);
 assert.equal(resume.readFittingDraftMaterial(workspace.listWorkspaceArtifacts('brand','bob')),null);assert.equal(resume.readFittingDraftMaterial(workspace.listWorkspaceArtifacts('other','alice')),null);
});
test('raw source-only resume preserves bundled assets and canonical paths; stale/cutout-only references remain unready',()=>{
 for(const url of [imageUrl,'/assets/original.png']){const raw=resume.readFittingResumeMaterialReference({...reference,imageUrl:url,extractedImageUrl:'blob:unconfirmed',extractedLayerReady:false,nextStepReady:true});assert.equal(raw.imageUrl,url);assert.equal(raw.extractedImageUrl,null);assert.equal(raw.extractedLayerReady,false);assert.equal(raw.nextStepReady,false);}
 const canonical=resume.readFittingResumeMaterialReference({...reference,imageUrl:'https://expired.test/bearer',sourceStoragePath:'generated-images/original'});assert.equal(canonical.imageUrl,'');assert.equal(canonical.sourceStoragePath,'generated-images/original');assert.equal(canonical.nextStepReady,false);
 for(const url of ['https://expired.test/bearer','blob:expired','local:unknown',''])assert.equal(resume.readFittingResumeMaterialReference({...reference,imageUrl:url}),null);
 assert.equal(resume.readFittingResumeMaterialReference({...reference,extractedImageUrl:imageUrl,extractedLayerReady:true,nextStepReady:true,maskEngine:'browser-canvas-unconfirmed'}),null);
});
after(async()=>{globalThis.window=oldWindow;await vite.close();});
