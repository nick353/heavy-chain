import type {VerifiedProtectedProvider} from './protectedProviderResult';
import { validateNativePrintFinalFrame,type CanvasProtectedBatchBinding } from './nativePrintFinalFrame';
import { composeNativePrintCandidate,validateNativePrintFrameBinding,type NativePrintFrameBinding } from './materialProtectedComposite';
import { buildProviderMaskGuide,composeProviderProtectedResult,type ProviderProtectedComposite } from '../features/lightchain/providerMask';
import { PROTECTED_IMAGE_EDIT_MODE,protectedImageDigest,protectedImageSaveRequestId,type ProtectedImageEditPlan } from './protectedImageEditContract';
import { CLOUDFLARE_IMAGE_MODEL,type ImageReceipt } from './cloudflareImageAI';
import type { cloudflareDataPlane } from './cloudflareApi';
import type { Json } from '../types/database';

type Body = Record<string,unknown>;
export type ProtectedEditSaveInput = Parameters<NonNullable<typeof cloudflareDataPlane>['saveWorkspaceArtifact']>[0];
export type ProtectedMaterialRecoveryBinding = { version:1; stateArtifactId:string; requestId:string; brandId:string; scopeId:string; generationInputSignature:string };
export type ProtectedEditLifecycleContext = { prepared:PreparedProtectedCloudflareEdit; receipt:ImageReceipt; candidate:Body; candidateIndex:0|1|2|3; saveRequestId:string;verifiedProvider?:VerifiedProtectedProvider };
export type ProtectedEditLifecycle = {
  onCompletedReceipt?(receipt:ImageReceipt):Promise<void>;
  composeCandidate?(context:ProtectedEditLifecycleContext,dataUrl:string):Promise<ProviderProtectedComposite>;
  refreshVerifiedSavedCandidate?(context:ProtectedEditLifecycleContext,imageUrl:string):Promise<void>;
  getVerifiedSavedCandidate?(context:ProtectedEditLifecycleContext):Promise<Record<string,unknown>|undefined>;
  onCandidate(context:ProtectedEditLifecycleContext):Promise<{ dataUrl:string }>;
  getPersistedComposite(context:ProtectedEditLifecycleContext):Promise<ProviderProtectedComposite|undefined>;
  onComposed(context:ProtectedEditLifecycleContext,composite:ProviderProtectedComposite,input:ProtectedEditSaveInput):Promise<Record<string,Json>>;
  onSavedCandidate(context:ProtectedEditLifecycleContext,saved:ProtectedEditSaved,imageUrl:string):Promise<void>;
};
export type PreparedProtectedCloudflareEdit = { body:Body; plan:ProtectedImageEditPlan; sourceImageUrl:string; maskDataUrl:string; materialRecoveryBinding?:ProtectedMaterialRecoveryBinding; canvasProtectedBatchBinding?:CanvasProtectedBatchBinding; nativePrintFrameBinding?:NativePrintFrameBinding };
export type ProtectedEditSaved = { success: boolean; remote: { jobId: string; imageId: string; storagePath: string }; metadata?: Body };
const record = (value: unknown): value is Body => !!value && typeof value === 'object' && !Array.isArray(value);

export const CLOUDFLARE_PROTECTED_EDIT_NOTICE = '範囲編集は白黒の参照ガイドで生成し、範囲外を元画像の画素へ戻して別画像として保存します。モデル自体のマスク編集ではありません。';

export async function prepareProtectedCloudflareEdit(body: Body):Promise<PreparedProtectedCloudflareEdit> {
  if (typeof body.maskDataUrl !== 'string' || !body.maskDataUrl.startsWith('data:image/png;base64,')) throw new Error('protected_edit_png_mask_required');
  const references = body.imageUrls ?? [body.imageUrl];
  if (!Array.isArray(references) || !references.length || references.length > 3 || references.some(v=>typeof v !== 'string' || !v)) {
    throw new Error('Cloudflare範囲編集は元画像と追加参照2枚までです。範囲ガイド用に1枠必要なため、参照を省略せず入力を見直してください。');
  }
  if (body.outputBackground === 'transparent') throw new Error('Cloudflare画像AIによる新しい透過出力は未対応です。');
  const guide = await buildProviderMaskGuide({ sourceImageUrl:references[0],maskDataUrl:body.maskDataUrl });
  const plan: ProtectedImageEditPlan = { mode:PROTECTED_IMAGE_EDIT_MODE,sourceWidth:guide.width,sourceHeight:guide.height,
    sourceSha256:await protectedImageDigest(guide.sourceDataUrl),maskSha256:await protectedImageDigest(body.maskDataUrl),
    guideIndex:references.length,coveragePercent:Number(guide.coveragePercent.toFixed(6)) };
  // Keep the source aspect ratio within the actual model's 256..1920 / 8-pixel
  // contract; the final compositor restores the original-resolution frame.
  const scale = Math.max(Math.min(1,1024 / Math.max(guide.width,guide.height)),256 / Math.min(guide.width,guide.height));
  const width = Math.round(guide.width * scale / 8) * 8; const height = Math.round(guide.height * scale / 8) * 8;
  if (body.generationProvider !== 'openai' && (width > 1920 || height > 1920)) throw new Error('protected_edit_source_aspect_ratio_not_supported');
  if (body.nativePrintFinalFrame !== undefined) {
    validateNativePrintFinalFrame(body.nativePrintFinalFrame,plan);
    if (body.generationProvider !== 'openai' && (guide.width < 256 || guide.height < 256 || guide.width > 1920 || guide.height > 1920 || guide.width % 8 || guide.height % 8)) throw new Error('material_protected_native_print_stage_geometry_not_supported');
  }
  const next: Body = { ...body,imageUrls:[guide.sourceDataUrl,...references.slice(1),guide.guideDataUrl],width:body.nativePrintFinalFrame ? guide.width : width,height:body.nativePrintFinalFrame ? guide.height : height,protectedEdit:plan };
  for (const key of ['maskDataUrl','maskApplied','maskCoveragePercent','maskWidth','maskHeight','imageUrl']) delete (next as Body)[key];
  return { body:next,plan,sourceImageUrl:guide.sourceDataUrl,maskDataUrl:body.maskDataUrl };
}

export function protectedEditCandidateSaveInput(context:ProtectedEditLifecycleContext,composite:{dataUrl:string;width:number;height:number}):ProtectedEditSaveInput {
  const { prepared,receipt,candidate:raw,candidateIndex:index,saveRequestId:requestId } = context;
  const verified = context.verifiedProvider ?? (receipt.provider === 'workers_ai' && receipt.backendProvider === 'cloudflare-workers-ai' && receipt.providerModel === CLOUDFLARE_IMAGE_MODEL ? {provider:'workers_ai',backendProvider:'cloudflare-workers-ai',model:CLOUDFLARE_IMAGE_MODEL} : undefined);
  if (!verified || verified.provider !== receipt.provider || verified.backendProvider !== receipt.backendProvider || verified.model !== receipt.providerModel) throw new Error('protected_edit_verified_provider_required');
  const metadata = record(receipt.metadata) ? receipt.metadata as Record<string,Json> : {};
  const input: ProtectedEditSaveInput = { requestId,brandId:String(prepared.body.brandId ?? prepared.body.brand_id),
        featureType:String(receipt.featureType ?? 'edit-image'),title:'範囲編集結果',imageUrl:composite.dataUrl,
        prompt:typeof prepared.body.prompt === 'string' ? prepared.body.prompt : null,sourceJobId:String(receipt.jobId),sourceStoragePath:null,
        ...(prepared.canvasProtectedBatchBinding?.canvasProjectId?{canvasProjectId:prepared.canvasProtectedBatchBinding.canvasProjectId}:{}),
        imageAI:{ requestId:receipt.requestId,candidateIndex:index },
        metadata:{ ...metadata,...(prepared.canvasProtectedBatchBinding?{canvasProtectedBatchBinding:prepared.canvasProtectedBatchBinding,parentObjectId:prepared.canvasProtectedBatchBinding.parentObjectId,generation:prepared.canvasProtectedBatchBinding.generation}:{}),protectedEdit:prepared.plan,protectedRegionComposited:true,maskApplied:true,
          provider:verified.provider,backendProvider:verified.backendProvider,providerModel:verified.model,
          providerRequestId:receipt.requestId,providerJobId:String(receipt.jobId),providerImageId:String(raw.imageId),providerStoragePath:String(raw.storagePath),
          batchId:String(receipt.jobId),candidateIndex:index,artifactRole:'protected-edit-final',outputSize:{width:composite.width,height:composite.height} } };
  return input;
}

/** Reuse the existing protected compositor and workspace writer. Recovery
 * reads a deterministic private save before re-encoding anything; no model
 * invocation lives in this function. The caller keeps the provider ID until
 * its history/Canvas handoff is acknowledged. */
export async function finalizeProtectedCloudflareEdit(options: {
  prepared: Awaited<ReturnType<typeof prepareProtectedCloudflareEdit>>;
  receipt: ImageReceipt;
  assertCurrent(): Promise<void>;
  call(path: string,init?: RequestInit): Promise<unknown>;
  save(input: ProtectedEditSaveInput): Promise<ProtectedEditSaved>;
  lifecycle?: ProtectedEditLifecycle;
}): Promise<ImageReceipt> {
  const { prepared,receipt } = options;
  const receiptPlan = receipt.protectedEdit;
  if (receipt.provider !== 'workers_ai' || receipt.backendProvider !== 'cloudflare-workers-ai' || receipt.providerModel !== CLOUDFLARE_IMAGE_MODEL ||
      receipt.jobId !== `ai-${receipt.requestId}` || !record(receiptPlan) || Object.entries(prepared.plan).some(([k,v])=>receiptPlan[k] !== v) ||
      !Array.isArray(receipt.images) || receipt.images.length !== receipt.requestedCandidateCount) throw new Error('protected_edit_receipt_plan_mismatch');
  if (prepared.nativePrintFrameBinding) {
    await validateNativePrintFrameBinding(prepared.nativePrintFrameBinding,prepared.plan);
    const native = validateNativePrintFinalFrame(prepared.body.nativePrintFinalFrame,prepared.plan);
    if (JSON.stringify(record(receipt.metadata) ? receipt.metadata.nativePrintFinalFrame : undefined) !== JSON.stringify(native)) throw new Error('protected_edit_native_frame_receipt_mismatch');
  }
  const images: Body[] = [];
  for (const [index,raw] of receipt.images.entries()) {
    await options.assertCurrent();
    if (!record(raw) || raw.candidateIndex !== index || raw.imageId !== `ai-${receipt.requestId}-${index}` || raw.jobId !== receipt.jobId ||
        raw.storagePath !== `generated-images/${raw.imageId}` || typeof raw.imageUrl !== 'string') throw new Error('protected_edit_candidate_identity_mismatch');
    const requestId = await protectedImageSaveRequestId(receipt.requestId,index);
    const context:ProtectedEditLifecycleContext = { prepared,receipt,candidate:raw,candidateIndex:index as 0|1|2|3,saveRequestId:requestId,verifiedProvider:{provider:'workers_ai',backendProvider:'cloudflare-workers-ai',model:CLOUDFLARE_IMAGE_MODEL} };
    const retainedCandidate = await options.lifecycle?.onCandidate(context);
    await options.assertCurrent();
    const persistedComposite = await options.lifecycle?.getPersistedComposite(context);
    await options.assertCurrent();
    const expectedImageId = `wa-${requestId}`; const expectedPath = `generated-images/${expectedImageId}`;
    let saved: ProtectedEditSaved | undefined;
    try { saved = await options.call(`/v1/workspace-artifacts/${requestId}`) as ProtectedEditSaved; }
    catch (error) {
      if (!(error instanceof Error && /_404_workspace_artifact_not_found$/.test(error.message))) throw error;
    }
    if (!saved) {
      const composite = persistedComposite ?? (prepared.nativePrintFrameBinding
        ? await composeNativePrintCandidate(prepared.nativePrintFrameBinding,retainedCandidate?.dataUrl ?? raw.imageUrl,prepared.maskDataUrl)
        : await composeProviderProtectedResult({ sourceImageUrl:prepared.sourceImageUrl,providerImageUrl:retainedCandidate?.dataUrl ?? raw.imageUrl,
        maskDataUrl:prepared.maskDataUrl,preserveSourceDimensions:true }));
      await options.assertCurrent();
      const input = protectedEditCandidateSaveInput(context,composite);
      const materialMetadata = await options.lifecycle?.onComposed(context,composite,input) ?? {};
      input.metadata = { ...materialMetadata,...input.metadata };
      await options.assertCurrent();
      try { saved = await options.save(input); }
      catch (error) {
        await options.assertCurrent();
        try { saved = await options.call(`/v1/workspace-artifacts/${requestId}`) as ProtectedEditSaved; }
        catch { throw error; }
      }
    }
    if (!saved.success || saved.remote?.imageId !== expectedImageId || saved.remote.storagePath !== expectedPath ||
        saved.remote.jobId !== expectedImageId || saved.metadata?.provider !== 'workers_ai' || saved.metadata?.backendProvider !== 'cloudflare-workers-ai' || saved.metadata?.providerModel !== CLOUDFLARE_IMAGE_MODEL ||
        saved.metadata?.providerRequestId !== receipt.requestId || saved.metadata?.candidateIndex !== index ||
        !record(saved.metadata?.protectedEdit) || Object.entries(prepared.plan).some(([k,v])=>(saved!.metadata!.protectedEdit as Body)[k] !== v)) throw new Error('protected_edit_final_save_readback_mismatch');
    if (prepared.body.nativePrintFinalFrame && JSON.stringify(saved.metadata?.nativePrintFinalFrame) !== JSON.stringify(prepared.body.nativePrintFinalFrame)) throw new Error('protected_edit_native_frame_saved_mismatch');
    const finalWidth = prepared.nativePrintFrameBinding?.original.width ?? prepared.plan.sourceWidth;
    const finalHeight = prepared.nativePrintFrameBinding?.original.height ?? prepared.plan.sourceHeight;
    if (prepared.nativePrintFrameBinding && (!record(saved.metadata?.outputSize) || saved.metadata.outputSize.width !== finalWidth
      || saved.metadata.outputSize.height !== finalHeight)) throw new Error('protected_edit_final_dimensions_mismatch');
    const query = new URLSearchParams({ bucket:'generated-images',path:expectedPath,expiresIn:'3600' });
    const media = await options.call(`/v1/media/read?${query}`) as { url?: string };
    if (typeof media.url !== 'string' || !media.url.startsWith('https://')) throw new Error('protected_edit_final_media_readback_invalid');
    await options.assertCurrent();
    await options.lifecycle?.onSavedCandidate(context,saved,media.url);
    await options.assertCurrent();
    images.push({ ...raw,id:expectedImageId,imageId:expectedImageId,jobId:saved.remote.jobId,storagePath:expectedPath,imageUrl:media.url,
      batchId:receipt.jobId,providerImageId:raw.imageId,providerJobId:raw.jobId,providerStoragePath:raw.storagePath,
      width:finalWidth,height:finalHeight,protectedRegionComposited:true,persistenceStatus:'completed' });
  }
  return { ...receipt,images,imageUrl:images[0].imageUrl,imageId:images[0].imageId,jobId:images[0].jobId,storagePath:images[0].storagePath,
    providerJobId:receipt.jobId,providerImageId:images[0].providerImageId,providerStoragePath:images[0].providerStoragePath,
    batchId:receipt.jobId,maskApplied:true,protectedRegionComposited:true,requiresProtectedComposite:false,
    maskTreatment:PROTECTED_IMAGE_EDIT_MODE,maskCoveragePercent:prepared.plan.coveragePercent,
    maskWidth:prepared.plan.sourceWidth,maskHeight:prepared.plan.sourceHeight };
}
