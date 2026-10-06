import {validateProtectedOpenAIProjection,type ProtectedOpenAIProjectionProof} from './protectedOpenAIProjection.ts';
/** Shared immutable printing geometry. No browser, SDK, provider or network dependency. */
export const NATIVE_PRINT_FRAME_VERSION = 'native-print-contain-v1' as const;
export const NATIVE_PRINT_FRAME_TOLERANCE = 1e-7;
export const NATIVE_PRINT_DIGEST_SCHEME = 'sha256-data-url-utf8-v1' as const;
/** Object identity: SHA256 UTF8 JSON [id,path,imageId,generation,sourceRevision,path?null:src].
 * Generated source key: SHA256 UTF8 JSON [documentId,requestId,pngDataUrlDigest,imageIdOrNull].
 * pngDigest uses NATIVE_PRINT_DIGEST_SCHEME; neither identity digest is a raw PNG checksum. */
export type CanvasProtectedSource={kind:'object';objectId:string;identityDigest:string}|{kind:'retained-generated';sourceKey:string;sourceArtifactId:string;pngDigest:string;sourceImageId?:string};
export type CanvasProtectedBatchBinding = {version:1;requestId:string;batchStateArtifactId:string;requestedCandidateCount:4;featureType:'canvas-partial-edit'|'canvas-inpaint';canvasProjectId:string;parentObjectId:string|null;generation:number;brandId:string;scopeId:string;generationInputSignature:string;source:CanvasProtectedSource};
export function validateCanvasProtectedBatchBinding(value:unknown):CanvasProtectedBatchBinding {
 if(!object(value)||value.version!==1||value.requestedCandidateCount!==4||!['canvas-partial-edit','canvas-inpaint'].includes(String(value.featureType))||typeof value.requestId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)||value.batchStateArtifactId!==`canvas-protected-batch-${value.requestId}`||![value.brandId,value.scopeId].every(v=>typeof v==='string'&&v.length>0&&v.length<=128)||![value.canvasProjectId,value.parentObjectId].every(v=>v===null||typeof v==='string'&&v.length>0&&v.length<=128)||!Number.isSafeInteger(value.generation)||Number(value.generation)<0||!digest(value.generationInputSignature))throw new Error('canvas_protected_batch_binding_invalid');
 if(!object(value.source)||value.canvasProjectId===null)throw new Error('canvas_protected_source_identity_required');
 const source=value.source;let normalizedSource:CanvasProtectedSource;
 if(source.kind==='object'&&typeof source.objectId==='string'&&source.objectId===value.parentObjectId&&digest(source.identityDigest))normalizedSource={kind:'object',objectId:source.objectId,identityDigest:String(source.identityDigest)};
 else if(source.kind==='retained-generated'&&value.parentObjectId===null&&digest(source.sourceKey)&&digest(source.pngDigest)&&source.sourceArtifactId===`canvas-protected-source-${value.requestId}`&&(source.sourceImageId===undefined||typeof source.sourceImageId==='string'&&source.sourceImageId.length<=128))normalizedSource={kind:'retained-generated',sourceKey:String(source.sourceKey),sourceArtifactId:String(source.sourceArtifactId),pngDigest:String(source.pngDigest),...(source.sourceImageId!==undefined?{sourceImageId:source.sourceImageId}:{})};
 else throw new Error('canvas_protected_source_identity_invalid');
 return {version:1,requestId:value.requestId,batchStateArtifactId:String(value.batchStateArtifactId),requestedCandidateCount:4,featureType:value.featureType as CanvasProtectedBatchBinding['featureType'],canvasProjectId:String(value.canvasProjectId),parentObjectId:value.parentObjectId as string|null,generation:Number(value.generation),brandId:String(value.brandId),scopeId:String(value.scopeId),generationInputSignature:String(value.generationInputSignature),source:normalizedSource};
}
export type NativePrintFinalFrame = {
  version: typeof NATIVE_PRINT_FRAME_VERSION | 'native-print-openai-contain-v1' | 'canvas-protected-openai-contain-v1';
  original: { width: number; height: number; digest: string; digestScheme: typeof NATIVE_PRINT_DIGEST_SCHEME };
  stage: { width: number; height: number; primaryDigest: string; maskDigest: string };
  frame: { x: number; y: number; width: number; height: number };
  /** SHA-256 of UTF-8 JSON [compositionSha256, maskSha256, originalFrameSha256]. */
  printingSnapshotDigest: string;
  candidateGeometry: { version: 'stage-frame-v1' | 'openai-output-frame-v1'; width: number; height: number };
  mapping?:ProtectedOpenAIProjectionProof;
  canvasBatch?:CanvasProtectedBatchBinding;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const dimension = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 4096;
const digest = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
function invalid(reason: string): never { throw new Error(`invalid_native_print_final_frame:${reason}`); }
export function validateNativePrintFinalFrame(value: unknown, plan?: { sourceWidth: unknown; sourceHeight: unknown; sourceSha256: unknown; maskSha256: unknown }): NativePrintFinalFrame {
  if (!object(value) || ![NATIVE_PRINT_FRAME_VERSION,'native-print-openai-contain-v1','canvas-protected-openai-contain-v1'].includes(String(value.version))
    || !object(value.original) || !object(value.stage) || !object(value.frame) || !object(value.candidateGeometry)) invalid('schema');
  const original = value.original; const stage = value.stage; const frame = value.frame; const geometry = value.candidateGeometry;
  if (original.digestScheme !== NATIVE_PRINT_DIGEST_SCHEME) invalid('digest_scheme');
  if (![original.width, original.height, stage.width, stage.height, geometry.width, geometry.height].every(dimension)
    || ![original.digest, stage.primaryDigest, stage.maskDigest, value.printingSnapshotDigest].every(digest)) invalid('dimensions_or_digest');
  const mapping = value.version !== NATIVE_PRINT_FRAME_VERSION ? validateProtectedOpenAIProjection(value.mapping,plan) : undefined;
  if (mapping ? geometry.version !== 'openai-output-frame-v1' || geometry.width !== mapping.candidate.width || geometry.height !== mapping.candidate.height : geometry.version !== 'stage-frame-v1' || geometry.width !== stage.width || geometry.height !== stage.height) invalid('candidate_geometry');
  const scale = Math.min(Number(stage.width) / Number(original.width), Number(stage.height) / Number(original.height));
  const expected = { x: (Number(stage.width) - Number(original.width) * scale) / 2,
    y: (Number(stage.height) - Number(original.height) * scale) / 2, width: Number(original.width) * scale, height: Number(original.height) * scale };
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (typeof frame[key] !== 'number' || !Number.isFinite(frame[key]) || Math.abs(frame[key] - expected[key]) > NATIVE_PRINT_FRAME_TOLERANCE) invalid('contain_frame');
  }
  if (plan && (stage.width !== plan.sourceWidth || stage.height !== plan.sourceHeight
    || stage.primaryDigest !== plan.sourceSha256 || stage.maskDigest !== plan.maskSha256)) invalid('stage_plan');
  const canvasBatch=value.version==='canvas-protected-openai-contain-v1'?validateCanvasProtectedBatchBinding(value.canvasBatch):undefined;
  if(canvasBatch&&(original.width!==stage.width||original.height!==stage.height||canvasBatch.source.kind==='retained-generated'&&canvasBatch.source.pngDigest!==original.digest))invalid('canvas_original_stage');
  // Return only the declared immutable contract; unknown caller fields have no authority.
  return { version: canvasBatch ? 'canvas-protected-openai-contain-v1' : mapping ? 'native-print-openai-contain-v1' : NATIVE_PRINT_FRAME_VERSION,
    original: { width: Number(original.width), height: Number(original.height), digest: String(original.digest), digestScheme: NATIVE_PRINT_DIGEST_SCHEME },
    stage: { width: Number(stage.width), height: Number(stage.height), primaryDigest: String(stage.primaryDigest), maskDigest: String(stage.maskDigest) },
    frame: { x: Number(frame.x), y: Number(frame.y), width: Number(frame.width), height: Number(frame.height) },
    printingSnapshotDigest: String(value.printingSnapshotDigest), candidateGeometry: { version: mapping ? 'openai-output-frame-v1' : 'stage-frame-v1', width: Number(geometry.width), height: Number(geometry.height) },...(mapping?{mapping}: {}),...(canvasBatch?{canvasBatch}:{}) };
}
