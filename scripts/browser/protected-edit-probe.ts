import {prepareProtectedCloudflareEdit,finalizeProtectedCloudflareEdit} from '../../src/lib/cloudflareProtectedImageEdit';
import {prepareCloudflareImageInput,invokeDurableImageAction,acknowledgeDurableImageAction,canonicalCloudflareImageBody,CLOUDFLARE_IMAGE_MODEL,type ImageReceipt} from '../../src/lib/cloudflareImageAI';
import {persistProtectedImageInput,loadProtectedImageInput,listProtectedImageInputs,deleteProtectedImageInput} from '../../src/lib/cloudflareImageInputCache';
import {buildLocalCanvasAssetReference,putLocalCanvasAsset,getLocalCanvasAsset,deleteLocalCanvasAsset} from '../../src/lib/canvasLocalAssets';
import {protectedImageDigest} from '../../src/lib/protectedImageEditContract';

const result=document.querySelector<HTMLPreElement>('#result')!;
const run=document.querySelector<HTMLButtonElement>('#run')!;
const reload=document.querySelector<HTMLButtonElement>('#reload')!;
const scope={origin:location.origin,userId:'browser-probe-owner',brandId:'browser-probe-brand'};
const runId=new URL(location.href).searchParams.get('run')||crypto.randomUUID();
const phase=new URL(location.href).searchParams.get('phase')==='reload'?'reload':'initial';
const checks:string[]=[];const finals=new Map<string,string>();
const check=(condition:unknown,label:string)=>{if(!condition)throw new Error(label);checks.push(label);result.textContent=checks.join('\n');};
const nativeFetch=fetch;
const call=async(path:string,init:RequestInit={})=>{
  const response=await nativeFetch('/__protected-probe'+path,init);const body=await response.json();
  if(!response.ok)throw new Error(`cloudflare_api_${response.status}_${body.error}`);
  if(/^\/(v1\/)?media\/read\?/.test(path))finals.set(body.url,body.imageUrl);
  return body;
};
const png=(draw:(ctx:CanvasRenderingContext2D)=>void)=>{
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  draw(canvas.getContext('2d')!);return canvas.toDataURL('image/png');
};
const pixels=async(url:string)=>{
  const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,rgba:ctx.getImageData(0,0,canvas.width,canvas.height).data};
};
const show=(label:string,url:string)=>{
  const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.src=url;image.alt=label;caption.textContent=label;figure.append(image,caption);document.querySelector('#pictures')!.append(figure);
};
const assertCurrent=async()=>{};
const options=(prepared:Awaited<ReturnType<typeof prepareProtectedCloudflareEdit>>)=>({
  ...scope,action:'edit-image',body:prepared.body,assertCurrent,call,retainUntilAcknowledged:true,
  beforeSubmit:(id:string,key:string)=>persistProtectedImageInput(scope,prepared,id,key),
  onTerminal:(id:string,key:string)=>deleteProtectedImageInput(scope,id,key),
  finalize:(receipt:ImageReceipt)=>finalizeProtectedCloudflareEdit({prepared,receipt,assertCurrent,
    call:async(path,init)=>call(path,init),save:input=>call('/workspace-artifacts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})}),
});
async function execute(){
  run.disabled=true;const start=performance.now();
  try{
    if(phase==='initial'){
      const source=png(ctx=>{ctx.fillStyle='#e33b40';ctx.fillRect(0,0,256,256);ctx.clearRect(0,0,24,24);ctx.fillStyle='#ffd24c';ctx.fillRect(32,32,48,48);});
      const mask=png(ctx=>{ctx.fillStyle='#000';ctx.fillRect(0,0,128,256);ctx.fillStyle='rgba(0,0,0,.5)';ctx.fillRect(128,0,8,256);});
      const provider=png(ctx=>{ctx.fillStyle='#17c1d2';ctx.fillRect(0,0,256,256);});
      const prepared=await prepareProtectedCloudflareEdit({brandId:scope.brandId,prompt:'Change only the right panel to cyan',imageUrls:[source],maskDataUrl:mask,count:1,
        featureType:'browser-protected-probe',legalSafety:{rightsConfirmed:true},materialReferences:[{sourceImageId:'local-fixture',imageUrl:'https://private.test/?token=must-not-persist',authorization:'must-not-persist'}]});
      const guide=await pixels((prepared.body.imageUrls as string[]).at(-1)!);
      check(guide.rgba[40*256*4]===0&&guide.rgba[(40*256+200)*4]===255,'PASS actual PNG guide: white editable / black protected');
      prepared.body=canonicalCloudflareImageBody(await prepareCloudflareImageInput('edit-image',prepared.body));
      // Only this fixture field configures the local fake provider. The
      // production request body/contract never contains it.
      const fixtureReceipt={success:true,state:'completed',recovery:'terminal',persistenceStatus:'completed',requestedCandidateCount:1,persistedCandidateCount:1,
        provider:'workers_ai',backendProvider:'cloudflare-workers-ai',providerModel:CLOUDFLARE_IMAGE_MODEL,protectedEdit:prepared.plan,requiresProtectedComposite:true,
        featureType:'browser-protected-probe',images:[{candidateIndex:0,imageUrl:provider,persistenceStatus:'completed'}]};
      const original=options(prepared);original.call=async(path,init)=>{
        if(init?.method==='POST'&&path.includes('/provider-actions/')){
          const body={...JSON.parse(String(init.body)),fixtureReceipt,fixtureMetadata:{}};
          return call(path,{...init,body:JSON.stringify(body)});
        }
        return call(path,init);
      };
      let failed=false;try{await invokeDurableImageAction(original);}catch(error){failed=/fixture_final_save_outage/.test(String(error));}
      check(failed,'PASS injected final-save outage leaves request unfinished');
      const pending=await listProtectedImageInputs(scope);check(pending.length===1,'PASS full input snapshot and UUID retained in actual IndexedDB');
      const entry=await loadProtectedImageInput(scope,pending[0].requestId);
      check(!JSON.stringify(entry).includes('must-not-persist'),'PASS signed reference URLs / credentials omitted from cached metadata');
      check((await listProtectedImageInputs({...scope,userId:'other'})).length===0,'PASS other user cannot list this pending snapshot');
      let wrongScope=false;try{await deleteProtectedImageInput({...scope,brandId:'foreign'},entry.requestId,entry.clientRecoveryKey);}catch{wrongScope=true;}
      check(wrongScope,'PASS foreign-brand cleanup rejected');
      await putLocalCanvasAsset('probe-unrelated-'+runId,new Blob(['unrelated-canvas-asset'],{type:'text/plain'}));
      const state=await call('/state');check(state.counts.inferences===1&&state.counts.providerPosts===1,'PASS one provider submission, no inference replay after save failure');
      show('元画像（左上は透明）',entry.prepared.sourceImageUrl);show('編集範囲ガイド',String((entry.prepared.body.imageUrls as string[]).at(-1)));show('fixture生成結果',provider);
      reload.hidden=false;reload.onclick=()=>location.assign(`/__protected-probe?run=${runId}&phase=reload`);
    }else{
      const entries=await listProtectedImageInputs(scope);check(entries.length===1,'PASS real page reload discovers scoped pending work without React inputs');
      const entry=await loadProtectedImageInput(scope,entries[0].requestId);
      const revision='image-ai-input:v1:'+await protectedImageDigest(JSON.stringify([scope.origin,scope.userId,scope.brandId,entry.requestId]));
      const originalBlob=(await getLocalCanvasAsset(buildLocalCanvasAssetReference(revision)))!;
      const corrupt={...entry,prepared:{...entry.prepared,body:{...entry.prepared.body,prompt:'different request'}}};
      await putLocalCanvasAsset(revision,new Blob([JSON.stringify(corrupt)],{type:'application/json'}));
      let rejected=false;try{await loadProtectedImageInput(scope,entry.requestId);}catch(error){rejected=/checksum_mismatch/.test(String(error));}
      check(rejected,'PASS corrupted prepared input cannot change the request');
      await putLocalCanvasAsset(revision,originalBlob);
      const resumed=await invokeDurableImageAction<ImageReceipt>({...options(entry.prepared),idempotencyKey:entry.requestId});
      check(resumed.success&&resumed.protectedRegionComposited===true&&resumed.requiresProtectedComposite===false,'PASS reload resumes original receipt and real native-frame compositor');
      const finalUrl=finals.get(String(resumed.imageUrl))!;check(!!finalUrl,'PASS lost final-save response recovered by deterministic GET');
      const src=await pixels(entry.prepared.sourceImageUrl),final=await pixels(finalUrl),mask=await pixels(entry.prepared.maskDataUrl);
      check(final.width===src.width&&final.height===src.height,'PASS final PNG preserves original 256x256 frame');
      let protectedMismatch=0,changedEditable=0,transparentMismatch=0;
      for(let i=0;i<src.rgba.length;i+=4){if(mask.rgba[i+3]===255){if([0,1,2,3].some(c=>src.rgba[i+c]!==final.rgba[i+c]))protectedMismatch++;if(src.rgba[i+3]===0&&final.rgba[i+3]!==0)transparentMismatch++;}else if(mask.rgba[i+3]===0&&src.rgba[i]!==final.rgba[i])changedEditable++;}
      check(protectedMismatch===0&&transparentMismatch===0,'PASS decoded final PNG preserves every fully protected RGBA pixel, including transparent area');
      check(changedEditable>30000,'PASS editable area uses provider pixels');
      const state=await call('/state');check(state.counts.inferences===1&&state.counts.providerPosts===1&&state.counts.savePosts===2,'PASS page reload and lost-save repair made no second inference');
      check((await listProtectedImageInputs(scope)).length===1,'PASS completed final artifact retains inputs until explicit handoff acknowledgement');
      await acknowledgeDurableImageAction({...scope,receipt:resumed,assertCurrent,
        cleanup:()=>deleteProtectedImageInput(scope,entry.requestId,entry.clientRecoveryKey)});
      check((await listProtectedImageInputs(scope)).length===0,'PASS acknowledgement removes only this pending request and snapshot');
      check(await (await getLocalCanvasAsset(buildLocalCanvasAssetReference('probe-unrelated-'+runId)))?.text()==='unrelated-canvas-asset','PASS unrelated Canvas asset survives acknowledgement');
      await deleteLocalCanvasAsset(buildLocalCanvasAssetReference('probe-unrelated-'+runId));
      show('復旧した元画像',entry.prepared.sourceImageUrl);show('保存した最終PNG',finalUrl);
    }
    result.className='pass';result.textContent=checks.join('\n')+'\nALL PASS';
    await call('/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runId,phase,status:'pass',checks,elapsedMs:Math.round(performance.now()-start),browser:navigator.userAgent})});
  }catch(error){result.className='fail';result.textContent=checks.join('\n')+'\nFAIL '+String(error);await call('/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runId,phase,status:'fail',checks,error:String(error)})});}
}
run.onclick=()=>void execute();if(phase==='reload')run.textContent='復旧のブラウザ検証を実行';
