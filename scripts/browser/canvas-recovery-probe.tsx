import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {Toaster} from 'react-hot-toast';
import '../../src/index.css';
import {CanvasEditorPage} from '../../src/pages/CanvasEditorPage';
import {useAuthStore} from '../../src/stores/authStore';
import {useCanvasStore,type CanvasObject} from '../../src/stores/canvasStore';
import {cloudflareDataPlane} from '../../src/lib/cloudflareApi';
import {PROTECTED_IMAGE_EDIT_MODE} from '../../src/lib/protectedImageEditContract';

// API fixture methods are replaced only inside this standalone local test
// entrypoint. CanvasEditorPage, the recovery panel, stores, batch normalization,
// document serialization and all UI handlers are the real production modules.
const api=cloudflareDataPlane!;if(!api)throw new Error('probe_cloudflare_client_missing');
const runId=crypto.randomUUID(),userId='canvas-browser-owner',brandId='canvas-browser-brand';
const projectId='local-probe-'+runId,requestId=crypto.randomUUID(),batchId='ai-'+requestId;
const state={resumes:0,creates:0,updates:0,reads:0,acks:0,pending:true,lateEditRetained:false};
const makeImage=(color:string)=>{const canvas=document.createElement('canvas');canvas.width=180;canvas.height=180;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,180,180);ctx.fillStyle='#fff';ctx.fillRect(30,30,25,25);return canvas.toDataURL('image/png');};
const sourceUrl=makeImage('#e33b40');
const images=Array.from({length:4},(_,candidateIndex)=>({candidateIndex,imageUrl:makeImage(['#17c1d2','#f6af35','#9b5ade','#26b678'][candidateIndex]),imageId:'wa-'+crypto.randomUUID(),jobId:'',storagePath:'',persistenceStatus:'completed',batchId}));
images.forEach(image=>{image.jobId=image.imageId;image.storagePath='generated-images/'+image.imageId;});
const summary={requestId,brandId,canvasProjectId:projectId,parentObjectId:'source',createdAt:new Date().toISOString(),prompt:'服の右側の色を変更',featureType:'canvas-partial-edit',generation:1};
const completion={requestId,clientRecoveryKey:`heavy:image-ai:v1:https://canvas-probe.invalid:${userId}:${brandId}:${'f'.repeat(64)}`};
const now=new Date().toISOString();
const base={type:'image' as const,width:180,height:180,rotation:0,scaleX:1,scaleY:1,opacity:1,locked:false,visible:true};
const source:CanvasObject={...base,id:'source',x:120,y:400,zIndex:0,src:sourceUrl,label:'元画像',metadata:{feature:'upload',generation:0}};
const existing:CanvasObject[]=images.slice(0,2).map((image,index)=>({...base,id:'existing-'+index,x:340+index*205,y:400,zIndex:index+1,src:image.imageUrl,label:'既存候補 '+index,metadata:{feature:'partial-edit',generation:1,parentObjectId:'source',imageId:image.imageId,jobId:image.jobId,storagePath:image.storagePath,parameters:{batchId,candidateIndex:index,imageAICompletion:completion}}}));
const brand={id:brandId,owner_id:userId,name:'Canvasローカル検証',brand_colors:[],logo_url:null,tone_description:null,target_audience:null,created_at:now,updated_at:now};
useAuthStore.setState({user:{id:userId,email:'local@example.test',name:'Local fixture'},currentBrand:brand,brands:[brand],isInitialized:true,isLoading:false,
  brandState:{status:'success_nonempty',userId,requestGeneration:1,confirmedBrandIds:[brandId],error:null}} as any);
localStorage.setItem('heavy_chain_canvas_guide_completed:'+userId,'true');
useCanvasStore.getState().hydrateProject({id:projectId,name:'範囲編集の復旧',brandId,objects:[source,...existing],createdAt:now,updatedAt:now,view:{zoom:0.65,panX:30,panY:20}});
let saved:any;const documentId=crypto.randomUUID();
api.listPendingProtectedImageEdits=async()=>state.pending?[summary]:[];
api.resumeProtectedImageEdit=async(brand,id,assertContext,expectedSource)=>{
  assertContext?.();if(brand!==brandId||id!==requestId||expectedSource!==sourceUrl)throw new Error('image_probe_source_mismatch');state.resumes++;
  return {success:true,state:'completed',recovery:'terminal',requestId,clientRecoveryKey:completion.clientRecoveryKey,provider:'workers_ai',backendProvider:'cloudflare-workers-ai',
    requestedCandidateCount:4,persistedCandidateCount:4,persistenceStatus:'completed',protectedRegionComposited:true,maskTreatment:PROTECTED_IMAGE_EDIT_MODE,images,batchId};
};
api.createCanvasDocument=async input=>{state.creates++;saved={id:documentId,ownerId:userId,brandId,title:input.title,snapshot:structuredClone(input.snapshot),snapshotVersion:1,revision:1,createdAt:now,updatedAt:now};return structuredClone(saved);};
api.updateCanvasDocument=async input=>{
  state.updates++;if(input.documentId!==documentId||input.expected_revision!==saved.revision)throw new Error('probe_revision_mismatch');
  saved={...saved,title:input.title,snapshot:structuredClone(input.snapshot),revision:saved.revision+1};
  if(state.updates===1){useCanvasStore.getState().addObject({type:'text',text:'保存中に追加された注記',x:100,y:300,width:230,height:40,rotation:0,scaleX:1,scaleY:1,opacity:1,locked:false,visible:true,label:'保存中の追加編集',fontSize:20,fill:'#fff'});}
  return structuredClone(saved);
};
api.getCanvasDocument=async id=>{
  state.reads++;if(id!==documentId)throw new Error('probe_document_mismatch');
  if(state.reads===1)throw new Error('cloudflare_api_503_probe_readback_lost');
  return structuredClone(saved);
};
api.acknowledgeImageAction=async receipt=>{if(receipt.requestId!==requestId||state.reads<3)throw new Error('probe_early_ack');state.acks++;state.pending=false;window.dispatchEvent(new Event('heavy-image-inputs-changed'));};
const read=()=>{const objects=useCanvasStore.getState().objects;const candidates=objects.filter(object=>object.metadata?.parameters?.batchId===batchId);return{...state,objects:objects.length,candidates:candidates.length,uniqueCandidates:new Set(candidates.map(object=>object.metadata?.imageId)).size,
  annotation:objects.some(object=>object.text==='保存中に追加された注記'),currentProjectId:useCanvasStore.getState().currentProjectId,persistence:document.querySelector('[data-testid="canvas-persistence-status"]')?.textContent};};
const renderStatus=()=>{const info=read();if(state.updates===1&&info.annotation&&state.pending)state.lateEditRetained=true;document.querySelector('#probe-result')!.textContent=JSON.stringify(info);};
useCanvasStore.subscribe(renderStatus);const timer=window.setInterval(renderStatus,400);
createRoot(document.querySelector('#root')!).render(<MemoryRouter initialEntries={['/canvas/'+projectId]}><Routes><Route path="/canvas/:projectId" element={<CanvasEditorPage/>}/></Routes><Toaster/></MemoryRouter>);
document.querySelector('#record')!.addEventListener('click',async()=>{
  const info=read();const checks={twoResumes:info.resumes===2,exactlyFourCandidates:info.candidates===4&&info.uniqueCandidates===4,oneDocument:info.creates===1,readbackAndConcurrentEdit:info.updates===2&&info.reads>=3,
    lateEditRetained:info.lateEditRetained&&info.annotation,onlyAcknowledgedAfterFinalSave:info.acks===1&&!info.pending,canonicalRemoteIdentity:info.currentProjectId===documentId,savedStateStable:info.persistence?.includes('サーバー確認済み')};
  clearInterval(timer);const status=Object.values(checks).every(Boolean)?'pass':'fail';document.querySelector('#probe-result')!.textContent=JSON.stringify({status,checks,info});
  await fetch('/__protected-probe/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runId,phase:'canvas-ui',status,checks,info,browser:navigator.userAgent})});
});
