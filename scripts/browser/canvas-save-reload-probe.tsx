import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route} from 'react-router-dom';
import {Toaster} from 'react-hot-toast';
import '../../src/index.css';
import {CanvasEditorPage} from '../../src/pages/CanvasEditorPage';
import {useAuthStore} from '../../src/stores/authStore';
import {useCanvasStore,type CanvasObject} from '../../src/stores/canvasStore';
import {cloudflareDataPlane} from '../../src/lib/cloudflareApi';
import {PROTECTED_IMAGE_EDIT_MODE} from '../../src/lib/protectedImageEditContract';
import {buildLocalCanvasAssetReference,getLocalCanvasAsset,putLocalCanvasAsset} from '../../src/lib/canvasLocalAssets';
import {readCanvasSaveRecovery} from '../../src/lib/canvasDocumentSaveRecovery';

// Real React page/store/handlers/localStorage/IndexedDB and real browser reload.
// Only auth/API/provider transport are fixtures; server state outlives the page.
const api=cloudflareDataPlane!;if(!api)throw new Error('probe_cloudflare_client_missing');
const sessionKey='heavy-canvas-save-probe:v1';
const runId=sessionStorage.getItem(sessionKey)||crypto.randomUUID();sessionStorage.setItem(sessionKey,runId);
const prefix='/__canvas-save-api/'+runId+'/';
const call=async(action:string,body?:unknown,method=body===undefined?'GET':'POST')=>{
  const response=await fetch(prefix+action,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)throw new Error(`cloudflare_api_${response.status}_${(await response.json()).error}`);return response.json();
};
const makeImage=(color:string)=>{const canvas=document.createElement('canvas');canvas.width=180;canvas.height=180;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,180,180);ctx.fillStyle='#fff';ctx.fillRect(30,30,25,25);return canvas.toDataURL('image/png');};
let remote:any;
try{remote=await call('bootstrap');}catch(error){
  if(!String(error).includes('404_not_found'))throw error;
  const requestId=crypto.randomUUID(),userId='canvas-save-owner',brandId='canvas-save-brand',projectId='local-save-'+runId;
  const images=Array.from({length:4},(_,candidateIndex)=>{const imageId='wa-'+crypto.randomUUID();return{candidateIndex,imageUrl:makeImage(['#17c1d2','#f6af35','#9b5ade','#26b678'][candidateIndex]),imageId,jobId:imageId,storagePath:'generated-images/'+imageId,persistenceStatus:'completed',batchId:'ai-'+requestId};});
  remote=await call('bootstrap',{userId,brandId,projectId,requestId,batchId:'ai-'+requestId,sourceUrl:makeImage('#e33b40'),images,createdAt:new Date().toISOString()});
}
const {userId,brandId,projectId,requestId,batchId,images,sourceUrl,createdAt:now}=remote.fixture;
const sourceKey='canvas-save-probe-source-'+runId,sourceReference=buildLocalCanvasAssetReference(sourceKey);
if(remote.mounts===1)await putLocalCanvasAsset(sourceKey,await(await fetch(sourceUrl)).blob());
const completion={requestId,clientRecoveryKey:`heavy:image-ai:v1:https://canvas-probe.invalid:${userId}:${brandId}:${'f'.repeat(64)}`};
const brand={id:brandId,owner_id:userId,name:'Canvas保存・実リロード検証',brand_colors:[],logo_url:null,tone_description:null,target_audience:null,created_at:now,updated_at:now};
useAuthStore.setState({user:{id:userId,email:'local@example.test',name:'Local fixture'},currentBrand:brand,brands:[brand],isInitialized:true,isLoading:false,
  brandState:{status:'success_nonempty',userId,requestGeneration:1,confirmedBrandIds:[brandId],error:null}} as any);
localStorage.setItem('heavy_chain_canvas_guide_completed:'+userId,'true');
if(remote.mounts===1){
  const base={type:'image' as const,width:180,height:180,rotation:0,scaleX:1,scaleY:1,opacity:1,locked:false,visible:true};
  const source:CanvasObject={...base,id:'source',x:120,y:400,zIndex:0,src:sourceReference,label:'元画像',metadata:{feature:'upload',generation:0}};
  const existing:CanvasObject[]=images.slice(0,2).map((image:any,index:number)=>({...base,id:'existing-'+index,x:340+index*205,y:400,zIndex:index+1,src:image.storagePath,label:'既存候補 '+index,metadata:{feature:'partial-edit',generation:1,parentObjectId:'source',imageId:image.imageId,jobId:image.jobId,storagePath:image.storagePath,parameters:{batchId,candidateIndex:index,imageAICompletion:completion}}}));
  useCanvasStore.getState().hydrateProject({id:projectId,name:'応答を失っても編集を保持',brandId,objects:[source,...existing],createdAt:now,updatedAt:now,view:{zoom:0.65,panX:30,panY:20}});
  history.replaceState(null,'','/canvas/'+projectId);
}
const summary={requestId,brandId,canvasProjectId:projectId,parentObjectId:'source',createdAt:now,prompt:'服の右側の色を変更',featureType:'canvas-partial-edit',generation:1};
api.listPendingProtectedImageEdits=async()=>{remote=await call('state');return remote.pending?[summary]:[];};
api.resumeProtectedImageEdit=async(brand,id,assertContext,expectedSource)=>{
  assertContext?.();if(brand!==brandId||id!==requestId||!expectedSource)throw new Error('image_probe_source_mismatch');
  const observed=new Uint8Array(await(await fetch(expectedSource)).arrayBuffer()),original=new Uint8Array(await(await fetch(sourceUrl)).arrayBuffer());
  if(observed.length!==original.length||observed.some((n,i)=>n!==original[i]))throw new Error('image_probe_source_bytes_changed');
  assertContext?.();remote=await call('resume');
  return{success:true,state:'completed',recovery:'terminal',requestId,clientRecoveryKey:completion.clientRecoveryKey,provider:'workers_ai',backendProvider:'cloudflare-workers-ai',requestedCandidateCount:4,persistedCandidateCount:4,persistenceStatus:'completed',protectedRegionComposited:true,maskTreatment:PROTECTED_IMAGE_EDIT_MODE,images,batchId};
};
api.readMediaObjectUrl=async path=>{const image=images.find((item:any)=>item.storagePath===path);if(!image)throw new Error('probe_image_missing');return image.imageUrl;};
const addNote=(text:string)=>useCanvasStore.getState().addObject({type:'text',text,x:100,y:text.includes('作成')?250:300,width:350,height:40,rotation:0,scaleX:1,scaleY:1,opacity:1,locked:false,visible:true,label:text,fontSize:20,fill:'#fff'});
api.createCanvasDocument=async(input,context)=>{context?.assertContext?.();try{return await call('document',input);}catch(error){if(String(error).includes('probe_create_response_lost'))addNote('作成応答待ち中の注記');throw error;}};
api.updateCanvasDocument=async(input,context)=>{context?.assertContext?.();try{return await call('document',input,'PATCH');}catch(error){if(String(error).includes('probe_update_response_lost'))addNote('更新応答待ち中の注記');throw error;}};
api.getCanvasDocument=async(id,context)=>{context?.assertContext?.();const value=await call('document');context?.assertContext?.();if(value.id!==id)throw new Error('probe_document_id_mismatch');return value;};
api.acknowledgeImageAction=async receipt=>{if(receipt.requestId!==requestId)throw new Error('probe_wrong_ack');remote=await call('ack');window.dispatchEvent(new Event('heavy-image-inputs-changed'));};
const read=()=>{const current=useCanvasStore.getState(),candidates=current.objects.filter(object=>object.metadata?.parameters?.batchId===batchId);return{mounts:remote.mounts,creates:remote.creates,updates:remote.updates,reads:remote.reads,resumes:remote.resumes,acks:remote.acks,pending:remote.pending,objects:current.objects.length,candidates:candidates.length,uniqueCandidates:new Set(candidates.map(o=>o.metadata?.imageId)).size,notes:current.objects.filter(o=>o.type==='text').map(o=>o.text),source:current.objects.find(o=>o.id==='source')?.src,documentId:current.currentProjectId,persistence:document.querySelector('[data-testid="canvas-persistence-status"]')?.textContent};};
const refresh=async()=>{remote=await call('state');document.querySelector('#probe-result')!.textContent=JSON.stringify(read());};
const timer=window.setInterval(()=>void refresh(),400);
createRoot(document.querySelector('#root')!).render(<BrowserRouter><Routes><Route path="/canvas/:projectId" element={<CanvasEditorPage/>}/></Routes><Toaster/></BrowserRouter>);
document.querySelector('#reload')!.addEventListener('click',()=>location.reload());
document.querySelector('#record')!.addEventListener('click',async()=>{
  await refresh();const info=read(),entry=readCanvasSaveRecovery({origin:api.origin,userId,brandId},info.documentId!);
  const checks={threeRealPageMounts:remote.mounts===3,noAutomaticWritesOnReload:JSON.stringify(remote.mountWrites)===JSON.stringify([[0,0],[1,0],[1,1]]),oneCreateTwoUpdates:remote.creates===1&&remote.updates===2,originalSourceStillInIndexedDB:!!await getLocalCanvasAsset(sourceReference)&&info.source===sourceReference,exactlyFourCandidates:info.candidates===4&&info.uniqueCandidates===4,threeResumesSameSource:remote.resumes===3,twoLateNotesRetained:info.notes.includes('作成応答待ち中の注記')&&info.notes.includes('更新応答待ち中の注記'),scopedIdentityRetained:remote.document.id===info.documentId&&entry?.documentId===info.documentId&&entry.snapshot.sourceProjectIds?.includes(projectId),confirmedRevisionTwo:remote.document.revision===2&&entry?.revision===2&&!entry.pending,ackOnlyAfterFinalSave:remote.acks===1&&!remote.pending,savedStateStable:info.persistence?.includes('サーバー確認済み')};
  clearInterval(timer);const status=Object.values(checks).every(Boolean)?'pass':'fail';document.querySelector('#probe-result')!.textContent=JSON.stringify({status,checks,info});
  await call('report',{runId,status,checks,info,browser:navigator.userAgent});
});
