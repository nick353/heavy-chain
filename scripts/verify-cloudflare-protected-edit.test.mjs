import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import { createServer } from 'vite';

const vite=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
after(()=>vite.close());
const mask=await vite.ssrLoadModule('/src/features/lightchain/providerMask.ts');
const contract=await vite.ssrLoadModule('/src/lib/protectedImageEditContract.ts');
const edit=await vite.ssrLoadModule('/src/lib/cloudflareProtectedImageEdit.ts');
const {normalizeCanvasImageEditCandidates}=await vite.ssrLoadModule('/src/lib/canvasImageEditResults.ts');

test('guide uses the existing transparent-is-editable mask channel, not its RGB colors',()=>{
  const pixels=new Uint8ClampedArray([0,0,0,255,255,0,99,0,0,180,0,128]);
  const guide=mask.providerMaskGuidePixels(pixels);
  assert.deepEqual([...guide.rgba],[0,0,0,255,255,255,255,255,127,127,127,255]);
  assert(Math.abs(guide.coveragePercent-((1+127/255)/3*100))<1e-9);
  assert.throws(()=>mask.providerMaskGuidePixels(new Uint8ClampedArray([1,2,3,255])),/no_editable/);
});

test('protected opaque and transparent source pixels remain exact, while editable pixels come from the provider',()=>{
  const source=new Uint8ClampedArray([3,5,9,255,9,6,2,0,80,90,100,255]);
  const provider=new Uint8ClampedArray([200,220,240,255,200,220,240,255,10,20,30,255]);
  const pixels=new Uint8ClampedArray([0,0,0,255,0,0,0,255,0,0,0,0]);
  assert.deepEqual([...mask.blendProviderProtectedPixels(source,provider,pixels)],[3,5,9,255,9,6,2,0,10,20,30,255]);
  assert.deepEqual([...source],[3,5,9,255,9,6,2,0,80,90,100,255],'source buffer is never modified');
  assert.throws(()=>mask.blendProviderProtectedPixels(source,provider,pixels.slice(0,4)),/dimensions_mismatch/);
});

test('feathered mask edges blend premultiplied alpha without leaking a protected transparent background',()=>{
  const source=new Uint8ClampedArray([255,0,0,0,255,0,0,255]);
  const provider=new Uint8ClampedArray([0,0,255,255,0,0,255,255]);
  const pixels=new Uint8ClampedArray([0,0,0,128,0,0,0,128]);
  assert.deepEqual([...mask.blendProviderProtectedPixels(source,provider,pixels)],[0,0,255,127,128,0,127,255]);
});

test('final-save identities are deterministic, candidate-specific and UUID-v4 compatible',async()=>{
  const id='cf82018b-901a-4b3f-9aed-ddb5c94fb5e4';
  const results=await Promise.all([0,1,2,3].map(index=>contract.protectedImageSaveRequestId(id,index)));
  assert.equal(new Set(results).size,4);
  for(const value of results)assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(await contract.protectedImageSaveRequestId(id.toUpperCase(),0),results[0]);
  await assert.rejects(contract.protectedImageSaveRequestId(id,4),/identity_invalid/);
});

test('already-saved candidates are read back after restart without canvas encoding, image upload or model calls',async()=>{
  const requestId=crypto.randomUUID(); const batchId=`ai-${requestId}`;
  const plan={mode:contract.PROTECTED_IMAGE_EDIT_MODE,sourceWidth:256,sourceHeight:256,sourceSha256:'a'.repeat(64),maskSha256:'b'.repeat(64),guideIndex:1,coveragePercent:20};
  const receipt={success:true,state:'completed',requestId,jobId:batchId,requestedCandidateCount:4,persistedCandidateCount:4,protectedEdit:plan,
    provider:'workers_ai',backendProvider:'cloudflare-workers-ai',providerModel:'@cf/black-forest-labs/flux-2-klein-4b',persistenceStatus:'completed',recovery:'terminal',
    images:Array.from({length:4},(_,candidateIndex)=>({candidateIndex,imageId:`ai-${requestId}-${candidateIndex}`,jobId:batchId,
      storagePath:`generated-images/ai-${requestId}-${candidateIndex}`,imageUrl:'https://raw.test/image',persistenceStatus:'completed'}))};
  const saves=await Promise.all([0,1,2,3].map(index=>contract.protectedImageSaveRequestId(requestId,index))); let uploadCount=0;
  const result=await edit.finalizeProtectedCloudflareEdit({prepared:{body:{brandId:'brand'},plan,sourceImageUrl:'unneeded',maskDataUrl:'unneeded'},receipt,
    assertCurrent:async()=>{},save:async()=>{uploadCount++;throw new Error('must not upload');},call:async path=>{
      if(path.startsWith('/v1/media/read?'))return{url:'https://final.test/image?path='+encodeURIComponent(new URLSearchParams(path.split('?')[1]).get('path'))};
      const id=path.split('/').at(-1); const index=saves.indexOf(id);assert(index>=0);
      return{success:true,remote:{jobId:'wa-'+id,imageId:'wa-'+id,storagePath:'generated-images/wa-'+id},metadata:{provider:'workers_ai',backendProvider:'cloudflare-workers-ai',providerModel:receipt.providerModel,providerRequestId:requestId,candidateIndex:index,protectedEdit:plan}};
    }});
  assert.equal(uploadCount,0);assert.equal(result.requiresProtectedComposite,false);assert.equal(result.protectedRegionComposited,true);
  const candidates=normalizeCanvasImageEditCandidates(result);assert.equal(candidates.length,4);
  assert.equal(new Set(candidates.map(c=>c.jobId)).size,4,'actual workspace job identities are not fabricated as one job');
  assert(candidates.every(c=>c.batchId===batchId));
  const corrupt={...result,images:result.images.map((c,index)=>index===1?{...c,batchId:'foreign'}:c)};
  assert.equal(normalizeCanvasImageEditCandidates(corrupt).length,3);
});
