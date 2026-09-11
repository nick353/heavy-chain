import { buildLocalCanvasAssetReference,deleteLocalCanvasAsset,getLocalCanvasAsset,putLocalCanvasAsset } from './canvasLocalAssets';
import { canonicalCloudflareImageBody,durableImageRecoveryKey } from './cloudflareImageAI';
import { PROTECTED_IMAGE_EDIT_MODE,protectedImageDigest } from './protectedImageEditContract';
import type { prepareProtectedCloudflareEdit } from './cloudflareProtectedImageEdit';

type Prepared = Awaited<ReturnType<typeof prepareProtectedCloudflareEdit>>;
export type ImageInputScope = { origin:string; userId:string; brandId:string };
export type PendingProtectedImageEdit = ImageInputScope & {
  version:1; requestId:string; clientRecoveryKey:string; createdAt:string;
  prepared:Prepared;
};
export type PendingProtectedImageSummary = Pick<PendingProtectedImageEdit,'requestId'|'brandId'|'createdAt'> & {
  canvasProjectId:string|null; parentObjectId:string|null; prompt:string; featureType:string; generation:number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const png = /^data:image\/png;base64,[a-z0-9+/]+=*$/i;
const MAX_SNAPSHOT_BYTES = 42 * 1024 * 1024;
const prefix = (scope:ImageInputScope) => `heavy:image-ai:v1:${scope.origin}:${scope.userId}:${scope.brandId}:`;
const revision = async (scope:ImageInputScope,requestId:string) => {
  if (!scope.origin || !scope.userId || !scope.brandId || !uuid.test(requestId)) throw new Error('image_input_scope_invalid');
  return 'image-ai-input:v1:' + await protectedImageDigest(JSON.stringify([scope.origin,scope.userId,scope.brandId,requestId]));
};
const changed = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('heavy-image-inputs-changed')); };

async function validate(scope:ImageInputScope,entry:PendingProtectedImageEdit,requirePending=true):Promise<void> {
  if (!entry || entry.version !== 1 || entry.origin !== scope.origin || entry.userId !== scope.userId || entry.brandId !== scope.brandId || !uuid.test(entry.requestId) ||
      typeof entry.clientRecoveryKey !== 'string' || !entry.clientRecoveryKey.startsWith(prefix(scope)) || !Number.isFinite(Date.parse(entry.createdAt))) throw new Error('image_input_scope_mismatch');
  const prepared = entry.prepared;
  if (!prepared?.body || String(prepared.body.brandId ?? prepared.body.brand_id) !== scope.brandId || prepared.plan?.mode !== PROTECTED_IMAGE_EDIT_MODE ||
      !png.test(prepared.sourceImageUrl) || !png.test(prepared.maskDataUrl) || !Array.isArray(prepared.body.imageUrls) ||
      prepared.body.imageUrls.length < 2 || prepared.body.imageUrls.length > 4 || prepared.body.imageUrls.some(v=>typeof v !== 'string' || !png.test(v)) ||
      JSON.stringify(prepared.body.protectedEdit) !== JSON.stringify(prepared.plan)) throw new Error('image_input_snapshot_invalid');
  if (await protectedImageDigest(prepared.sourceImageUrl) !== prepared.plan.sourceSha256 || await protectedImageDigest(prepared.maskDataUrl) !== prepared.plan.maskSha256 ||
      await durableImageRecoveryKey(scope.origin,scope.userId,'edit-image',prepared.body) !== entry.clientRecoveryKey) throw new Error('image_input_checksum_mismatch');
  if (requirePending && localStorage.getItem(entry.clientRecoveryKey) !== entry.requestId) throw new Error('image_input_no_longer_pending');
}

/** A single JSON Blob transaction reuses the Canvas asset store. Images never
 * go in localStorage. This is scoped browser storage, not encrypted storage. */
export async function persistProtectedImageInput(scope:ImageInputScope,prepared:Prepared,requestId:string,clientRecoveryKey:string):Promise<void> {
  const ref = await revision(scope,requestId);
  const existing = await getLocalCanvasAsset(buildLocalCanvasAssetReference(ref));
  if (existing) {
    const entry = await parse(existing); await validate(scope,entry);
    if (entry.clientRecoveryKey !== clientRecoveryKey) throw new Error('image_input_request_collision');
    return;
  }
  const entry:PendingProtectedImageEdit = { ...scope,version:1,requestId,clientRecoveryKey,createdAt:new Date().toISOString(),
    prepared:{...prepared,body:canonicalCloudflareImageBody(prepared.body)} };
  await validate(scope,entry);
  const serialized = JSON.stringify(entry); const blob = new Blob([serialized],{type:'application/json'});
  if (blob.size > MAX_SNAPSHOT_BYTES) throw new Error('image_input_snapshot_too_large');
  await putLocalCanvasAsset(ref,blob);
  const readback = await getLocalCanvasAsset(buildLocalCanvasAssetReference(ref));
  if (!readback || await readback.text() !== serialized) throw new Error('image_input_snapshot_readback_failed');
  changed();
}
async function parse(blob:Blob):Promise<PendingProtectedImageEdit> {
  if (blob.size > MAX_SNAPSHOT_BYTES || blob.type !== 'application/json') throw new Error('image_input_snapshot_invalid');
  return JSON.parse(await blob.text()) as PendingProtectedImageEdit;
}
export async function loadProtectedImageInput(scope:ImageInputScope,requestId:string):Promise<PendingProtectedImageEdit> {
  const blob = await getLocalCanvasAsset(buildLocalCanvasAssetReference(await revision(scope,requestId)));
  if (!blob) throw new Error('image_input_snapshot_missing');
  const entry = await parse(blob); await validate(scope,entry); return entry;
}
export async function listProtectedImageInputs(scope:ImageInputScope):Promise<PendingProtectedImageSummary[]> {
  const ids = new Set<string>();
  for (let index=0;index<localStorage.length;index++) {
    const key = localStorage.key(index); if (!key?.startsWith(prefix(scope))) continue;
    const id = localStorage.getItem(key); if (id && uuid.test(id)) ids.add(id);
  }
  const entries:PendingProtectedImageSummary[] = [];
  for (const id of ids) {
    try {
      const entry = await loadProtectedImageInput(scope,id); const body = entry.prepared.body;
      entries.push({requestId:entry.requestId,brandId:entry.brandId,createdAt:entry.createdAt,
        canvasProjectId:typeof body.canvasProjectId === 'string' ? body.canvasProjectId : null,
        parentObjectId:typeof body.parentObjectId === 'string' ? body.parentObjectId : null,
        prompt:typeof body.prompt === 'string' ? body.prompt : '',featureType:String(body.featureType ?? 'edit-image'),generation:Number(body.generation ?? 1)});
    }
    catch (error) {
      // Non-masked/older pending requests have no snapshot. Corrupt snapshots
      // must be surfaced; they must never become a new inference silently.
      if (!(error instanceof Error && error.message === 'image_input_snapshot_missing')) throw error;
    }
  }
  return entries.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
}
export async function deleteProtectedImageInput(scope:ImageInputScope,requestId:string,clientRecoveryKey:string):Promise<void> {
  if (!clientRecoveryKey.startsWith(prefix(scope))) throw new Error('image_input_scope_mismatch');
  const ref = buildLocalCanvasAssetReference(await revision(scope,requestId));
  const blob = await getLocalCanvasAsset(ref); if (!blob) return;
  const entry = await parse(blob); await validate(scope,entry,false);
  if (entry.requestId !== requestId || entry.clientRecoveryKey !== clientRecoveryKey) throw new Error('image_input_request_collision');
  await deleteLocalCanvasAsset(ref); changed();
}
