import {PROTECTED_OPENAI_EDIT_MODELS} from './protectedProviderResult';
import {validateProtectedOpenAIProjection} from './protectedOpenAIProjection';
import {validateNativePrintFinalFrame} from './nativePrintFinalFrame';
import {protectedImageSaveRequestId} from './protectedImageEditContract';
import {composeMappedOpenAICandidate,materializeMaterialPng,type ProtectedMaterialComposite} from './materialProtectedComposite';
import {protectedEditCandidateSaveInput,type PreparedProtectedCloudflareEdit,type ProtectedEditLifecycle,type ProtectedEditLifecycleContext,type ProtectedEditSaved,type ProtectedEditSaveInput} from './cloudflareProtectedImageEdit';
import type {ImageReceipt} from './cloudflareImageAI';
type Body=Record<string,unknown>;
const object=(v:unknown):v is Body=>!!v&&typeof v==='object'&&!Array.isArray(v);
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
/** Independent strict OpenAI validation. It does not grant OpenAI receipts access
 * to the Workers validator or infer coordinate transforms from returned pixels. */
export async function finalizeProtectedOpenAIEdit(options:{prepared:PreparedProtectedCloudflareEdit;receipt:ImageReceipt;assertCurrent():Promise<void>;call(path:string,init?:RequestInit):Promise<unknown>;save(input:ProtectedEditSaveInput):Promise<ProtectedEditSaved>;lifecycle?:ProtectedEditLifecycle}):Promise<ImageReceipt>{
 if(!options.lifecycle)throw new Error('protected_openai_durable_material_binding_required');
 const {prepared,receipt}=options;const authority=receipt.resolvedProvider;const plan=receipt.protectedEdit;
 const map=validateProtectedOpenAIProjection(prepared.body.protectedOpenAIProjection,prepared.plan);
 const native=validateNativePrintFinalFrame(prepared.body.nativePrintFinalFrame,prepared.plan);
 if(!receipt.success||receipt.state!=='completed'||!Number.isSafeInteger(receipt.requestedCandidateCount)||Number(receipt.requestedCandidateCount)<1||Number(receipt.requestedCandidateCount)>4||(prepared.materialRecoveryBinding && prepared.materialRecoveryBinding.requestId!==receipt.requestId)||receipt.provider!=='openai'||receipt.backendProvider!=='openai-images-api'||typeof receipt.providerModel!=='string'||!PROTECTED_OPENAI_EDIT_MODELS.has(receipt.providerModel)
  ||!object(authority)||authority.provider!=='openai'||authority.backendProvider!=='openai-images-api'||authority.model!==receipt.providerModel||authority.action!=='edit-image'||authority.requestId!==receipt.requestId
  ||receipt.jobId!==`ai-${receipt.requestId}`||receipt.featureType!==String(prepared.body.featureType??'edit-image')||!object(plan)||canonical(plan)!==canonical(prepared.plan)
  ||receipt.requestedCandidateCount!==Number(prepared.body.count??1)||!Array.isArray(receipt.images)||receipt.images.length!==receipt.requestedCandidateCount
  ||!object(receipt.metadata)||canonical(receipt.metadata.nativePrintFinalFrame)!==canonical(native)||canonical(receipt.metadata.protectedOpenAIProjection)!==canonical(map))throw new Error('protected_openai_receipt_identity_mismatch');
 const batch=prepared.canvasProtectedBatchBinding;
 if(batch&&(!options.lifecycle.onCompletedReceipt||!options.lifecycle.composeCandidate||!options.lifecycle.getVerifiedSavedCandidate||!options.lifecycle.refreshVerifiedSavedCandidate))throw new Error('canvas_protected_durable_batch_lifecycle_required');
 if(batch && (batch.requestId!==receipt.requestId||batch.requestedCandidateCount!==receipt.requestedCandidateCount||batch.featureType!==receipt.featureType))throw new Error('canvas_protected_receipt_identity_mismatch');
 const images:Body[]=[];const contexts:ProtectedEditLifecycleContext[]=[];const retainedByIndex:Array<{dataUrl:string}|undefined>=[];
 // Validate the complete batch before retaining or saving any candidate.
 for(const [index,raw] of receipt.images.entries()){
  await options.assertCurrent();
  if(!object(raw)||raw.candidateIndex!==index||raw.provider!=='openai'||raw.providerModel!==authority.model||raw.modelUsed!==authority.model||raw.imageId!==`ai-${receipt.requestId}-${index}`||raw.jobId!==receipt.jobId||raw.storagePath!==`generated-images/${raw.imageId}`||typeof raw.imageUrl!=='string'||raw.width!==map.candidate.width||raw.height!==map.candidate.height)throw new Error('protected_openai_candidate_identity_mismatch');
  const requestId=await protectedImageSaveRequestId(receipt.requestId,index);
  const context:ProtectedEditLifecycleContext={prepared,receipt,candidate:raw,candidateIndex:index as 0|1|2|3,saveRequestId:requestId,verifiedProvider:{provider:'openai',backendProvider:'openai-images-api',model:String(authority.model)}};
  contexts.push(context);
 }
 await options.lifecycle.onCompletedReceipt?.(receipt);await options.assertCurrent();
 if(batch){for(const context of contexts){retainedByIndex[context.candidateIndex]=await options.lifecycle.onCandidate(context);await options.assertCurrent();}
  // A second local read proves earlier candidates were not evicted by later writes.
  for(const context of contexts){await options.lifecycle.onCandidate(context);await options.assertCurrent();}}
 const failures:number[]=[];
 const verifiedSavedByIndex=new Map<number,Body|undefined>();
 const candidateFailure=async(index:number,error:unknown)=>{await options.assertCurrent();if(!batch||!(error instanceof Error)||/(identity|mismatch|invalid|scope|context|binding|bytes_mismatch|auth|unauthori[sz]ed|forbidden|(?:^|_)40[13](?:_|$))/.test(error.message))throw error;failures.push(index);};
 // Inspect every retained saved identity before the first media read or final save.
 // An operational local-read failure skips that index; conflicting authority aborts all.
 if(batch){for(const context of contexts){try{verifiedSavedByIndex.set(context.candidateIndex,await options.lifecycle.getVerifiedSavedCandidate!(context));await options.assertCurrent();}catch(error){await candidateFailure(context.candidateIndex,error);}}}
 for(const context of contexts){const {candidate:raw,candidateIndex:index,saveRequestId:requestId}=context;const id=`wa-${requestId}`,path=`generated-images/${id}`;
  if(failures.includes(index))continue;
  try{
  const retained=batch?retainedByIndex[index]:await options.lifecycle.onCandidate(context);await options.assertCurrent();
  const verified=batch?verifiedSavedByIndex.get(index):await options.lifecycle.getVerifiedSavedCandidate?.(context);await options.assertCurrent();
  if(verified){const media=await options.call('/v1/media/read?'+new URLSearchParams({bucket:'generated-images',path,expiresIn:'3600'})) as {url?:string};await options.assertCurrent();if(typeof media?.url!=='string'||!media.url.startsWith('https://'))throw new Error('protected_openai_final_media_readback_missing');await options.lifecycle.refreshVerifiedSavedCandidate?.(context,media.url);await options.assertCurrent();images.push({...verified,imageUrl:media.url,provider:'openai',backendProvider:'openai-images-api',providerModel:authority.model,modelUsed:authority.model,persistenceStatus:'completed',...(batch?{batchId:receipt.jobId,providerJobId:receipt.jobId}: {})});continue;}
  const persisted=await options.lifecycle?.getPersistedComposite(context);await options.assertCurrent();
  let saved:ProtectedEditSaved|undefined;
  try{saved=await options.call(`/v1/workspace-artifacts/${requestId}`) as ProtectedEditSaved;}catch(error){if(!(error instanceof Error&&/_404_workspace_artifact_not_found$/.test(error.message)))throw error;}
  if(!saved){
   let composite=persisted;
   if(!composite&&options.lifecycle.composeCandidate)composite=await options.lifecycle.composeCandidate(context,retained?.dataUrl??String(raw.imageUrl));
   if(!composite){const original=prepared.nativePrintFrameBinding?.original ?? {...await materializeMaterialPng(prepared.sourceImageUrl),digest:prepared.plan.sourceSha256};
    const mask=await materializeMaterialPng(prepared.maskDataUrl);
    const state:ProtectedMaterialComposite={version:1,requestId:receipt.requestId,candidateIndex:index as 0|1|2|3,stage:'candidate-ready',original,mask:{...mask,digest:prepared.plan.maskSha256},nativePrintFrame:prepared.nativePrintFrameBinding,openAIProjection:map};
    composite=await composeMappedOpenAICandidate(state,retained?.dataUrl??String(raw.imageUrl));}
   await options.assertCurrent();const input=protectedEditCandidateSaveInput(context,composite);const proof=await options.lifecycle?.onComposed(context,composite,input)??{};input.metadata={...proof,...input.metadata};await options.assertCurrent();
   try{saved=await options.save(input);}catch(error){await options.assertCurrent();try{saved=await options.call(`/v1/workspace-artifacts/${requestId}`) as ProtectedEditSaved;}catch{throw error;}}
  }
  const m=saved.metadata;
  if(!saved.success||saved.remote?.jobId!==id||saved.remote.imageId!==id||saved.remote.storagePath!==path||!object(m)||m.provider!=='openai'||m.backendProvider!=='openai-images-api'||m.providerModel!==authority.model||m.providerRequestId!==receipt.requestId||m.providerJobId!==receipt.jobId||m.providerImageId!==raw.imageId||m.providerStoragePath!==raw.storagePath||m.candidateIndex!==index||canonical(m.protectedEdit)!==canonical(prepared.plan)||canonical(m.nativePrintFinalFrame)!==canonical(native)||canonical(m.protectedOpenAIProjection)!==canonical(map)||!object(m.outputSize)||m.outputSize.width!==native.original.width||m.outputSize.height!==native.original.height)throw new Error('protected_openai_final_save_readback_mismatch');
  const media=await options.call('/v1/media/read?'+new URLSearchParams({bucket:'generated-images',path,expiresIn:'3600'})) as {url?:string};if(typeof media?.url !== 'string'||!media.url.startsWith('https://'))throw new Error('protected_openai_final_media_readback_missing');await options.assertCurrent();
  await options.lifecycle?.onSavedCandidate(context,saved,media.url);await options.assertCurrent();
  images.push({...raw,provider:'openai',backendProvider:'openai-images-api',providerModel:authority.model,modelUsed:authority.model,id,imageId:id,jobId:id,storagePath:path,imageUrl:media.url,width:native.original.width,height:native.original.height,providerJobId:receipt.jobId,providerImageId:raw.imageId,providerStoragePath:raw.storagePath,protectedRegionComposited:true,persistenceStatus:'completed',...(batch?{batchId:receipt.jobId}: {})});
  }catch(error){await candidateFailure(index,error);}
 }
 if(failures.length)throw new Error(`canvas_protected_batch_save_incomplete:${failures.join(',')}`);
 return {...receipt,...images[0],provider:'openai',backendProvider:'openai-images-api',providerModel:authority.model,modelUsed:authority.model,...(batch?{canvasProtectedBatchBinding:batch,batchId:receipt.jobId}:{}),images,requiresProtectedComposite:false,persistedCandidateCount:images.length,failedCandidateIndices:[],protectedRegionComposited:true,providerJobId:receipt.jobId,metadata:{...receipt.metadata,protectedRegionComposited:true},persistenceStatus:'completed'} as ImageReceipt;
}
