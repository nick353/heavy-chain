import { buildProviderMaskGuide,composeProviderProtectedResult } from '../features/lightchain/providerMask';
import { PROTECTED_IMAGE_EDIT_MODE,protectedImageDigest,protectedImageSaveRequestId,type ProtectedImageEditPlan } from './protectedImageEditContract';
import { CLOUDFLARE_IMAGE_MODEL,type ImageReceipt } from './cloudflareImageAI';
import type { cloudflareDataPlane } from './cloudflareApi';
import type { Json } from '../types/database';

type Body = Record<string,unknown>;
type SaveInput = Parameters<NonNullable<typeof cloudflareDataPlane>['saveWorkspaceArtifact']>[0];
type Saved = { success: boolean; remote: { jobId: string; imageId: string; storagePath: string }; metadata?: Body };
const record = (value: unknown): value is Body => !!value && typeof value === 'object' && !Array.isArray(value);

export const CLOUDFLARE_PROTECTED_EDIT_NOTICE = '範囲編集は白黒の参照ガイドで生成し、範囲外を元画像の画素へ戻して別画像として保存します。モデル自体のマスク編集ではありません。';

export async function prepareProtectedCloudflareEdit(body: Body) {
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
  if (width > 1920 || height > 1920) throw new Error('protected_edit_source_aspect_ratio_not_supported');
  const next: Body = { ...body,imageUrls:[guide.sourceDataUrl,...references.slice(1),guide.guideDataUrl],width,height,protectedEdit:plan };
  for (const key of ['maskDataUrl','maskApplied','maskCoveragePercent','maskWidth','maskHeight','imageUrl']) delete (next as Body)[key];
  return { body:next,plan,sourceImageUrl:guide.sourceDataUrl,maskDataUrl:body.maskDataUrl };
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
  save(input: SaveInput): Promise<Saved>;
}): Promise<ImageReceipt> {
  const { prepared,receipt } = options;
  const receiptPlan = receipt.protectedEdit;
  if (receipt.provider !== 'workers_ai' || receipt.backendProvider !== 'cloudflare-workers-ai' || receipt.providerModel !== CLOUDFLARE_IMAGE_MODEL ||
      receipt.jobId !== `ai-${receipt.requestId}` || !record(receiptPlan) || Object.entries(prepared.plan).some(([k,v])=>receiptPlan[k] !== v) ||
      !Array.isArray(receipt.images) || receipt.images.length !== receipt.requestedCandidateCount) throw new Error('protected_edit_receipt_plan_mismatch');
  const images: Body[] = [];
  for (const [index,raw] of receipt.images.entries()) {
    await options.assertCurrent();
    if (!record(raw) || raw.candidateIndex !== index || raw.imageId !== `ai-${receipt.requestId}-${index}` || raw.jobId !== receipt.jobId ||
        raw.storagePath !== `generated-images/${raw.imageId}` || typeof raw.imageUrl !== 'string') throw new Error('protected_edit_candidate_identity_mismatch');
    const requestId = await protectedImageSaveRequestId(receipt.requestId,index);
    const expectedImageId = `wa-${requestId}`; const expectedPath = `generated-images/${expectedImageId}`;
    let saved: Saved | undefined;
    try { saved = await options.call(`/v1/workspace-artifacts/${requestId}`) as Saved; }
    catch (error) {
      if (!(error instanceof Error && /_(404_workspace_artifact_not_found|409_workspace_save_pending)$/.test(error.message))) throw error;
    }
    if (!saved) {
      const composite = await composeProviderProtectedResult({ sourceImageUrl:prepared.sourceImageUrl,providerImageUrl:raw.imageUrl,
        maskDataUrl:prepared.maskDataUrl,preserveSourceDimensions:true });
      await options.assertCurrent();
      const metadata = record(receipt.metadata) ? receipt.metadata as Record<string,Json> : {};
      const input: SaveInput = { requestId,brandId:String(prepared.body.brandId ?? prepared.body.brand_id),
        featureType:String(receipt.featureType ?? 'edit-image'),title:'範囲編集結果',imageUrl:composite.dataUrl,
        prompt:typeof prepared.body.prompt === 'string' ? prepared.body.prompt : null,sourceJobId:String(receipt.jobId),sourceStoragePath:null,
        imageAI:{ requestId:receipt.requestId,candidateIndex:index },
        metadata:{ ...metadata,protectedEdit:prepared.plan,protectedRegionComposited:true,maskApplied:true,
          provider:'workers_ai',backendProvider:'cloudflare-workers-ai',providerModel:String(receipt.providerModel),
          providerRequestId:receipt.requestId,providerJobId:String(receipt.jobId),providerImageId:String(raw.imageId),providerStoragePath:String(raw.storagePath),
          batchId:String(receipt.jobId),candidateIndex:index,artifactRole:'protected-edit-final',outputSize:{width:composite.width,height:composite.height} } };
      try { saved = await options.save(input); }
      catch (error) {
        await options.assertCurrent();
        try { saved = await options.call(`/v1/workspace-artifacts/${requestId}`) as Saved; }
        catch { throw error; }
      }
    }
    if (!saved.success || saved.remote?.imageId !== expectedImageId || saved.remote.storagePath !== expectedPath ||
        saved.remote.jobId !== expectedImageId || saved.metadata?.provider !== 'workers_ai' || saved.metadata?.backendProvider !== 'cloudflare-workers-ai' || saved.metadata?.providerModel !== CLOUDFLARE_IMAGE_MODEL ||
        saved.metadata?.providerRequestId !== receipt.requestId || saved.metadata?.candidateIndex !== index ||
        !record(saved.metadata?.protectedEdit) || Object.entries(prepared.plan).some(([k,v])=>(saved!.metadata!.protectedEdit as Body)[k] !== v)) throw new Error('protected_edit_final_save_readback_mismatch');
    const query = new URLSearchParams({ bucket:'generated-images',path:expectedPath,expiresIn:'3600' });
    const media = await options.call(`/v1/media/read?${query}`) as { url?: string };
    if (typeof media.url !== 'string' || !media.url.startsWith('https://')) throw new Error('protected_edit_final_media_readback_invalid');
    await options.assertCurrent();
    images.push({ ...raw,id:expectedImageId,imageId:expectedImageId,jobId:saved.remote.jobId,storagePath:expectedPath,imageUrl:media.url,
      batchId:receipt.jobId,providerImageId:raw.imageId,providerJobId:raw.jobId,providerStoragePath:raw.storagePath,
      width:prepared.plan.sourceWidth,height:prepared.plan.sourceHeight,protectedRegionComposited:true,persistenceStatus:'completed' });
  }
  return { ...receipt,images,imageUrl:images[0].imageUrl,imageId:images[0].imageId,jobId:images[0].jobId,storagePath:images[0].storagePath,
    providerJobId:receipt.jobId,providerImageId:images[0].providerImageId,providerStoragePath:images[0].providerStoragePath,
    batchId:receipt.jobId,maskApplied:true,protectedRegionComposited:true,requiresProtectedComposite:false,
    maskTreatment:PROTECTED_IMAGE_EDIT_MODE,maskCoveragePercent:prepared.plan.coveragePercent,
    maskWidth:prepared.plan.sourceWidth,maskHeight:prepared.plan.sourceHeight };
}
