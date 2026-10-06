import {canvasObjectProtectedIdentity,loadCanvasProtectedBatch,verifyCanvasObjectProofPng,type CanvasObjectSourceProof,type CanvasProtectedBatchBinding,type VerifiedCanvasObjectSource} from './canvasProtectedBatchComposite';
import {readVerifiedCanvasSourcePromotion,applyCanvasSourcePromotionAlias,canvasSaveObjectsWithPromotedSources,type CanvasSourcePromotionRecord,type CanvasSourcePromotionScope} from './canvasSourcePromotion';
import {buildCanvasDocumentSnapshot} from './canvasDocumentPersistence';
import {initialCanvasDocumentId,readCanvasSaveRecovery} from './canvasDocumentSaveRecovery';
import {loadProtectedImageInput,type PendingProtectedImageSummary} from './cloudflareImageInputCache';
import {materializeMaterialPng} from './materialProtectedComposite';
import {sha256Hex} from '../features/canvasSourceMetadata';
import type {CanvasObject} from '../stores/canvasStore';

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function fail(reason:string):never{throw new Error('canvas_protected_promotion_bridge_'+reason);}
export type CanvasPromotionBridgeContext={
 binding:CanvasProtectedBatchBinding;scope:CanvasSourcePromotionScope;object:CanvasObject;
 canvasProjectId:string|null;canvasProjectAliases:readonly string[];pending:PendingProtectedImageSummary;
};
type BridgeStructure={proof:CanvasObjectSourceProof;promotion:CanvasSourcePromotionRecord;expectedDescriptor:ReturnType<typeof canvasObjectProtectedIdentity>};

/** Only the transformation performed by promotion and the existing serializer
 * is allowed. Hydration preserves these descriptor fields verbatim. */
async function structure(input:CanvasPromotionBridgeContext,readPendingInput:boolean):Promise<BridgeStructure>{
 const {binding,scope,object,pending}=input;
 if(binding.source.kind!=='object'||binding.scopeId!==scope.userId||binding.brandId!==scope.brandId)fail('scope_mismatch');
 const batch=await loadCanvasProtectedBatch(binding),proof=batch.sourceProof;
 if(!proof||object.id!==binding.source.objectId||proof.objectDescriptor.objectId!==object.id)fail('object_mismatch');
 if(pending.requestId!==binding.requestId||pending.brandId!==binding.brandId||pending.canvasProjectId!==binding.canvasProjectId||pending.parentObjectId!==binding.parentObjectId||pending.featureType!==binding.featureType||pending.generation!==binding.generation)fail('pending_identity_mismatch');
 // The scoped durable input also proves the original operation locator. Reads
 // never acknowledge, migrate, or create a replacement pending operation.
 if(!batch.prepared||!same(batch.prepared.canvasProtectedBatchBinding,binding))fail('pending_binding_mismatch');
 if(readPendingInput){const retained=await loadProtectedImageInput(scope,binding.requestId);if(!same(retained.prepared,batch.prepared))fail('pending_binding_mismatch');}
 if(!binding.canvasProjectId||!input.canvasProjectId)fail('canvas_mismatch');
 if(input.canvasProjectId!==binding.canvasProjectId){
  const cache=readCanvasSaveRecovery(scope,input.canvasProjectId);
  if(!input.canvasProjectAliases.includes(binding.canvasProjectId)||await initialCanvasDocumentId(scope,binding.canvasProjectId)!==input.canvasProjectId||!cache||cache.ownerId!==scope.userId||!cache.snapshot.sourceProjectIds?.includes(binding.canvasProjectId))fail('canvas_alias_unproven');
 }
 const d=proof.objectDescriptor;
 if(typeof d.src!=='string'||!d.src.startsWith('local-canvas-asset://')||proof.selectedSource!==d.src||typeof d.generation!=='number')fail('original_local_source_unproven');
 // Existing promotion records do not contain object or Canvas IDs. Bind those
 // through the immutable batch proof and proven document alias, never by adding
 // historical fields to the record.
 if(!same(canvasObjectProtectedIdentity(object).sourceRevision,d.sourceRevision))fail('source_revision_mismatch');
 const original:CanvasObject={...object,src:d.src};
 const promotion=await readVerifiedCanvasSourcePromotion(scope,original);
 if(!same(object.metadata?.sourceIdentity,promotion.binding.sourceIdentity)||!same(object.metadata?.sourceRevision,promotion.binding.sourceRevision)||promotion.binding.localReference!==proof.selectedSource||promotion.binding.width!==proof.width||promotion.binding.height!==proof.height||promotion.binding.mimeType!=='image/png')fail('source_identity_mismatch');
 // Restore every descriptor field from the proof before deriving the allowed
 // change. The actual serializer chooses the canonical remote source and strips
 // the local alias annotation; unrelated current metadata cannot choose it.
 original.metadata={...original.metadata!,imageId:d.imageId,generation:d.generation,sourceRevision:promotion.binding.sourceRevision as NonNullable<CanvasObject['metadata']>['sourceRevision'],galleryStoragePath:d.galleryStoragePath??undefined,storagePath:d.storagePath,galleryImageId:d.galleryImageId as string|undefined,galleryImageUrl:d.galleryImageUrl as string|undefined,parameters:Object.fromEntries(Object.entries(d.parameters).filter(([,value])=>value!==null))};
 const aliased=applyCanvasSourcePromotionAlias(original,promotion),saved=canvasSaveObjectsWithPromotedSources([aliased],scope);
 const snapshot=buildCanvasDocumentSnapshot({projectId:binding.canvasProjectId,name:'',objects:saved});
 const expectedDescriptor=canvasObjectProtectedIdentity(snapshot.objects[0] as unknown as CanvasObject);
 if(!same(canvasObjectProtectedIdentity(object),expectedDescriptor))fail('descriptor_mismatch');
 return{proof,promotion,expectedDescriptor};
}

/** Read-only structural diagnosis. Pixel checks are explicitly unperformed;
 * this result never authorizes recovery or placement. Compare before redaction. */
export async function inspectCanvasProtectedSourcePromotionBridge(input:CanvasPromotionBridgeContext){
 try{const verified=await structure(input,false);return {status:'unproven_pixels' as const,reason:'raw_and_materialized_png_checks_unperformed',...verified,rawPngVerification:'unperformed' as const,materializedPngVerification:'unperformed' as const};}
 catch(error){return {status:'unproven' as const,reason:error instanceof Error?error.message:'canvas_protected_promotion_bridge_unavailable',rawPngVerification:'unperformed' as const,materializedPngVerification:'unperformed' as const};}
}

/** Explicit remote-only bridge. No current-source fallback, provider operation,
 * workspace save, marker mutation, or pending cleanup is available here. */
export async function verifyCanvasProtectedSourcePromotionBridge(input:CanvasPromotionBridgeContext&{
 assertCurrent():void|Promise<void>;readCurrentObject():CanvasObject|undefined;
 signedRead(storagePath:string):Promise<string>;fetchMedia?:(url:string)=>Promise<Response>;
}):Promise<VerifiedCanvasObjectSource>{
 const frozen=JSON.stringify(canvasObjectProtectedIdentity(input.object)),frozenSourceIdentity=JSON.stringify(input.object.metadata?.sourceIdentity);
 const check=async()=>{await input.assertCurrent();const current=input.readCurrentObject();if(!current||JSON.stringify(canvasObjectProtectedIdentity(current))!==frozen||JSON.stringify(current.metadata?.sourceIdentity)!==frozenSourceIdentity)fail('source_changed');};
 await check();const verified=await structure(input,true);await check();
 const url=await input.signedRead(verified.promotion.remote!.storagePath);await check();
 if(typeof url!=='string'||!url.startsWith('https://'))fail('media_url_invalid');
 const response=await(input.fetchMedia??fetch)(url);await check();
 if(!response.ok||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='image/png')fail('media_unavailable');
 const bytes=await response.arrayBuffer();await check();
 const b=verified.promotion.binding;
 if(bytes.byteLength!==b.sizeBytes||await sha256Hex(bytes)!==b.rawSha256)fail('raw_png_mismatch');await check();
 const blobUrl=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
 let png:Awaited<ReturnType<typeof materializeMaterialPng>>;
 try{png=await materializeMaterialPng(blobUrl);await check();}finally{URL.revokeObjectURL(blobUrl);}
 // Raw-byte SHA256 and UTF8 dataURL SHA256 are separate domains. The original
 // PNG proof gate checks the latter and the native decoded dimensions.
 const result=await verifyCanvasObjectProofPng(verified.proof,png.dataUrl);await check();
 const latest=await structure(input,true);await check();if(!same(latest,verified))fail('record_changed');
 return result;
}
