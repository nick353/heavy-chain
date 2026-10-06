import {getLocalCanvasAsset,isLocalCanvasAssetReference} from './canvasLocalAssets';
import {sha256Hex} from '../features/canvasSourceMetadata';
import type {CanvasObject} from '../stores/canvasStore';
import type {Json} from '../types/database';

export type CanvasSourcePromotionScope={origin:string;userId:string;brandId:string};
type Remote={success:boolean;remote:{jobId:string;imageId:string;storagePath:string}};
export type CanvasSourcePromotionInput={requestId:string;brandId:string;featureType:'canvas-source-upload';title:string;imageUrl:string;prompt:null;sourceStoragePath:null;metadata:Record<string,Json|undefined>};
type Binding={version:1;scope:CanvasSourcePromotionScope;localReference:string;sourceIdentity:unknown;sourceRevision:unknown;rawSha256:string;sizeBytes:number;width:number;height:number;mimeType:string;requestId:string};
export type CanvasSourcePromotionRecord={binding:Binding;stage:'dispatched'|'verified';remote?:Remote['remote']};
type Promotion=CanvasSourcePromotionRecord;
const prefix='heavy:canvas-source-promotion:v1:';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function fail(reason:string):never{throw new Error('canvas_source_promotion_'+reason);}
const key=(scope:CanvasSourcePromotionScope,id:string)=>prefix+JSON.stringify([scope.origin,scope.userId,scope.brandId,id]);
const source=(o:CanvasObject)=>JSON.stringify([o.id,o.src,o.metadata?.sourceIdentity,o.metadata?.sourceRevision,o.metadata?.generation,o.metadata?.galleryStoragePath,o.metadata?.storagePath,o.metadata?.imageId,o.metadata?.galleryImageId,o.metadata?.galleryImageUrl,...['galleryStoragePath','storagePath','remoteStoragePath','sourceStoragePath','backendStoragePath','imageId'].map(key=>o.metadata?.parameters?.[key])]);
function read(scope:CanvasSourcePromotionScope,id:string):Promotion|null{const raw=localStorage.getItem(key(scope,id));if(!raw)return null;try{return JSON.parse(raw) as Promotion;}catch{return fail('record_invalid');}}
function retain(scope:CanvasSourcePromotionScope,id:string,value:Promotion){const serialized=JSON.stringify(value);localStorage.setItem(key(scope,id),serialized);if(localStorage.getItem(key(scope,id))!==serialized)fail('record_not_durable');}
async function identity(scope:CanvasSourcePromotionScope,o:Pick<CanvasObject,'src'|'metadata'>):Promise<Binding>{
 const revision=o.metadata?.sourceRevision,original=o.metadata?.sourceIdentity;
 if(!isLocalCanvasAssetReference(o.src)||!revision||!original||original.kind!=='local-upload'||revision.algorithm!=='sha-256'||!/^[a-f0-9]{64}$/.test(revision.hash)||original.hash!==revision.hash||revision.revision!==`sha256:${revision.hash}`||![revision.width,revision.height,revision.sizeBytes].every(v=>Number.isSafeInteger(v)&&v>0))fail('source_metadata_invalid');
 // The actual IndexedDB key may differ from the observational content digest.
 let localKey:string;try{localKey=decodeURIComponent(o.src.slice('local-canvas-asset://'.length));}catch{return fail('local_key_invalid');}
 if(!localKey||![scope.origin,scope.userId,scope.brandId].every(v=>typeof v==='string'&&v.length>0))fail('scope_invalid');
 const hash=await sha256Hex(new TextEncoder().encode(JSON.stringify(['canvas-source-promotion-v1',scope.origin,scope.userId,scope.brandId,localKey,original,revision])).buffer);
 const chars=hash.slice(0,32).split('');chars[12]='4';chars[16]=((parseInt(chars[16],16)&3)|8).toString(16);const hex=chars.join('');
 const requestId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 return{version:1,scope:{...scope},localReference:o.src,sourceIdentity:structuredClone(original),sourceRevision:structuredClone(revision),rawSha256:revision.hash,sizeBytes:revision.sizeBytes,width:revision.width,height:revision.height,mimeType:revision.mimeType,requestId};
}
function validateRemote(value:Remote,b:Binding){const id='wa-'+b.requestId;if(!value?.success||value.remote?.jobId!==id||value.remote.imageId!==id||value.remote.storagePath!==`generated-images/${id}`)fail('remote_identity_mismatch');return value.remote;}
/** Read an existing verified record only. This never adopts current remote
 * metadata, writes a marker, uploads, or reconciles an uncertain dispatch. */
export async function readVerifiedCanvasSourcePromotion(scope:CanvasSourcePromotionScope,source:Pick<CanvasObject,'src'|'metadata'>):Promise<CanvasSourcePromotionRecord>{
 const expected=await identity(scope,source),record=read(scope,expected.requestId);
 if(!record)fail('verified_record_missing');
 if(record.stage!=='verified'||!same(record.binding,expected)||!record.remote)fail('verified_record_mismatch');
 validateRemote({success:true,remote:record.remote},expected);return structuredClone(record);
}
const dataUrl=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('canvas_source_promotion_blob_invalid'));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
const dimensions=(blob:Blob)=>new Promise<{width:number;height:number}>((resolve,reject)=>{const url=URL.createObjectURL(blob),image=new Image();image.onload=()=>{URL.revokeObjectURL(url);resolve({width:image.naturalWidth,height:image.naturalHeight});};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('canvas_source_promotion_decode_failed'));};image.src=url;});

/** One generic workspace upload, exact raw bytes. A durable dispatch marker
 * permanently turns subsequent calls into GET-only reconciliation. */
export async function promoteCanvasLocalSource(options:{scope:CanvasSourcePromotionScope;object:CanvasObject;readCurrentObject():CanvasObject|undefined;assertCurrent():void|Promise<void>;readRemote(id:string):Promise<Remote>;saveRemote(input:CanvasSourcePromotionInput):Promise<Remote>;signedRead(path:string):Promise<string>;getBlob?:(reference:string)=>Promise<Blob|null>;fetchBytes?:(url:string)=>Promise<ArrayBuffer>;readDimensions?:(blob:Blob)=>Promise<{width:number;height:number}>;blobDataUrl?:(blob:Blob)=>Promise<string>}):Promise<Promotion>{
 const frozen=source(options.object),b=await identity(options.scope,options.object);
 const check=async()=>{await options.assertCurrent();const current=options.readCurrentObject();if(!current||source(current)!==frozen)fail('source_changed');};
 await check();const blob=await(options.getBlob??getLocalCanvasAsset)(b.localReference);await check();if(!blob)fail('local_blob_missing');const bytes=await blob.arrayBuffer();await check();
 if(blob.size!==b.sizeBytes||bytes.byteLength!==b.sizeBytes||blob.type!==b.mimeType||await sha256Hex(bytes)!==b.rawSha256)fail('local_bytes_mismatch');await check();
 const size=await(options.readDimensions??dimensions)(blob);await check();if(size.width!==b.width||size.height!==b.height)fail('local_dimensions_mismatch');
 const existing=read(b.scope,b.requestId);if(existing&&(!same(existing.binding,b)||!['dispatched','verified'].includes(existing.stage)))fail('record_identity_mismatch');
 let receipt:Remote|undefined;
 try{receipt=await options.readRemote(b.requestId);if(!receipt)fail('remote_receipt_invalid');}catch(error){await check();if(!(error instanceof Error&&/_404_workspace_artifact_not_found$/.test(error.message)))throw error;if(existing)fail('dispatch_unknown_get_only');}
 await check();
 if(!receipt){const imageUrl=await(options.blobDataUrl??dataUrl)(blob);await check();
  if(!imageUrl.startsWith(`data:${b.mimeType};base64,`))fail('upload_data_url_invalid');
  let decoded:Uint8Array<ArrayBuffer>;try{decoded=Uint8Array.from(atob(imageUrl.split(',')[1]),char=>char.charCodeAt(0));}catch{return fail('upload_data_url_invalid');}
  if(decoded.byteLength!==b.sizeBytes||await sha256Hex(decoded.buffer)!==b.rawSha256)fail('upload_bytes_mismatch');await check();
  const input:CanvasSourcePromotionInput={requestId:b.requestId,brandId:b.scope.brandId,featureType:'canvas-source-upload',title:'Canvas source',imageUrl,prompt:null,sourceStoragePath:null,metadata:{sourceIdentity:b.sourceIdentity as Json,sourceRevision:b.sourceRevision as Json,sourceDigestScheme:'sha256-raw-bytes-v1'}};
  // Web Locks is origin-wide across tabs/workers. A localStorage read/write
  // pair alone cannot own this decision. No in-process or unavailable fallback.
  const locks=globalThis.navigator?.locks,lockName=key(b.scope,b.requestId)+':dispatch';
  if(!locks||typeof locks.request!=='function')fail('atomic_claim_unavailable');
  receipt=await locks.request(lockName,{mode:'exclusive'},async lock=>{
    if(!lock||lock.name!==lockName||lock.mode!=='exclusive')fail('atomic_claim_invalid');
    await check();const retained=read(b.scope,b.requestId);
    if(retained&&(!same(retained.binding,b)||!['dispatched','verified'].includes(retained.stage)))fail('record_identity_mismatch');
    // A different context may have committed/marked dispatch while we waited.
    // Its marker is permanent; even a confirmed404 may never replay its POST.
    try{const remote=await options.readRemote(b.requestId);await check();if(!remote)fail('remote_receipt_invalid');return remote;}
    catch(error){await check();if(!(error instanceof Error&&/_404_workspace_artifact_not_found$/.test(error.message)))throw error;if(retained)fail('dispatch_unknown_get_only');}
    retain(b.scope,b.requestId,{binding:b,stage:'dispatched'});await check();
    // Hold ownership through dispatch; a lost/closed context leaves its durable
    // marker for GET-only recovery. It is never cleared or expired to retry.
    const remote=await options.saveRemote(input);await check();return remote;
  });await check();
 }
 const remote=validateRemote(receipt,b);const url=await options.signedRead(remote.storagePath);await check();if(typeof url!=='string'||!url.startsWith('https://'))fail('signed_media_invalid');
 const remoteBytes=await(options.fetchBytes??(async value=>{const r=await fetch(value);if(!r.ok)fail('media_unavailable');return r.arrayBuffer();}))(url);await check();
 if(remoteBytes.byteLength!==b.sizeBytes||await sha256Hex(remoteBytes)!==b.rawSha256)fail('remote_bytes_mismatch');await check();
 const proof:Promotion={binding:b,stage:'verified',remote};retain(b.scope,b.requestId,proof);await check();return proof;
}

/** Add only a local alias annotation; keep source authority and all store state.
 * Snapshot serialization uses the verified path without changing the live src. */
export function applyCanvasSourcePromotionAlias(object:CanvasObject,proof:Promotion):CanvasObject{
 if(proof.stage!=='verified'||!proof.remote||object.src!==proof.binding.localReference||!same(object.metadata?.sourceIdentity,proof.binding.sourceIdentity)||!same(object.metadata?.sourceRevision,proof.binding.sourceRevision))fail('alias_source_mismatch');
 return{...object,metadata:{...object.metadata!,parameters:{...object.metadata?.parameters,canvasSourcePromotion:{requestId:proof.binding.requestId,storagePath:proof.remote.storagePath}}}};
}
export function canvasSaveObjectsWithPromotedSources(objects:CanvasObject[],scope:CanvasSourcePromotionScope):CanvasObject[]{
 return objects.map(object=>{const alias=object.metadata?.parameters?.canvasSourcePromotion;if(!alias||!isLocalCanvasAssetReference(object.src))return object;
  const proof=read(scope,String(alias.requestId));if(!proof||proof.stage!=='verified'||!proof.remote||!same(proof.binding.scope,scope)||proof.binding.localReference!==object.src||!same(proof.binding.sourceIdentity,object.metadata?.sourceIdentity)||!same(proof.binding.sourceRevision,object.metadata?.sourceRevision)||alias.storagePath!==proof.remote.storagePath)fail('alias_unverified');
  validateRemote({success:true,remote:proof.remote},proof.binding);const {canvasSourcePromotion:_local,...parameters}=object.metadata!.parameters;
  return{...object,metadata:{...object.metadata!,parameters:{...parameters,remoteStoragePath:proof.remote.storagePath}}};
 });
}
