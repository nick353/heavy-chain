// Cloudflare's actual image contract. No provider key or arbitrary server-side
// URL fetching; original local images are retained while bounded PNG copies go
// to the model. Resizing is recorded, never reported as original-resolution input.
export const CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
export const CLOUDFLARE_IMAGE_ACTIONS = new Set(['generate-image','edit-image','model-matrix']);
export const CLOUDFLARE_IMAGE_NOTICE = 'Cloudflare FLUX.2 Klein 4B（品質検証中）。参照は最大4枚・長辺512pxで送信し、元画像は保持します。範囲編集は参照ガイド＋元画素の合成で対応し、新しい透過出力は未対応です。';
type Body = Record<string, unknown>;
export type ImageReceipt = Body & { success: boolean; requestId: string; state: 'running' | 'completed' | 'failed' | 'unknown'; recovery: string };
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n => n.toString(16).padStart(2,'0')).join('');
const canonical = (value: unknown): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().filter(k => (value as Body)[k] !== undefined).map(k => JSON.stringify(k)+':'+canonical((value as Body)[k])).join(',') + '}' : JSON.stringify(value);
const metadataIdentity = (value: unknown): unknown => {
  if (typeof value === 'string') {
    if (/^(data:|blob:|https?:\/\/)/i.test(value)) return '[provided]';
    // Existing parity metadata contains serialized JSON, not just objects.
    // Expiring URLs inside it must not change the durable request identity.
    if (/^\s*(?:[[]|[{])/.test(value)) { try { return canonical(metadataIdentity(JSON.parse(value))); } catch { /* descriptive text */ } }
    return value;
  }
  return Array.isArray(value) ? value.map(metadataIdentity) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key])=>!/token|password|authorization|secret/i.test(key)).map(([key,item])=>[key,metadataIdentity(item)])) : value;
};
export function canonicalCloudflareImageBody(body: Body): Body {
  const next = {...body};
  // Actual prepared image bytes remain part of identity. Expiring display URLs
  // in descriptive lineage must not turn recovery into a new paid inference;
  // canonical source IDs/paths and all generation settings remain distinct.
  for (const key of ['materialReference','materialReferences','sourceReadback','compositionPreview','lightchainCompat','generationIntent','layerPlan','maskPlan','campaignMeta','textOverlay']) {
    if (next[key] !== undefined) next[key] = metadataIdentity(next[key]);
  }
  return next;
}
export async function durableImageRecoveryKey(origin:string,userId:string,action:string,body:Body):Promise<string> {
  const hash = await digest(canonical({action,body:canonicalCloudflareImageBody(body)}));
  return `heavy:image-ai:v1:${origin}:${userId}:${String(body.brandId ?? body.brand_id)}:${hash}`;
}
const pending = new Map<string,string>();
const inFlight = new Map<string,Promise<unknown>>();
const dataURL = (blob: Blob): Promise<string> => new Promise((resolve,reject) => {
  const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('image_reference_encode_failed'));
  reader.onerror = () => reject(new Error('image_reference_encode_failed')); reader.readAsDataURL(blob);
});

export async function prepareCloudflareImageInput(action: string, body: Body): Promise<Body> {
  if (!CLOUDFLARE_IMAGE_ACTIONS.has(action)) return body;
  if (body.maskDataUrl || body.maskApplied === true || body.outputBackground === 'transparent') throw new Error('マスク編集・透過出力はCloudflare画像AIでまだ対応していません。入力は保持されています。');
  if (action === 'generate-image' && ![body.prompt,body.brief].some(value => typeof value === 'string' && value.trim())) throw new Error('Cloudflare画像AIにはプロンプトまたは brief が必要です。');
  if (action === 'model-matrix' && body.modelReferenceImageUrl && !body.imageUrl) throw new Error('人物参照を使う試着には衣服参照も必要です。人物画像を衣服として送信していません。');
  const source = action === 'model-matrix' ? [body.imageUrl,body.modelReferenceImageUrl].filter(Boolean)
    : body.imageUrls ?? [body.imageUrl ?? body.referenceImage].filter(Boolean);
  if (!Array.isArray(source) || source.length > 4 || source.some(v => typeof v !== 'string' || !v)) throw new Error('Cloudflare画像AIの参照は最大4枚です。参照を省略せず入力を見直してください。');
  if (action !== 'generate-image' && source.length === 0) throw new Error('このCloudflare画像AI操作には参照画像が必要です。');
  const references: string[] = []; const transforms: Body[] = [];
  for (const [index,raw] of source.entries()) {
    const response = await fetch(raw as string,{ credentials: 'omit' });
    if (!response.ok) throw new Error(`image_reference_fetch_failed:${index}:${response.status}`);
    if (Number(response.headers.get('content-length')) > 12 * 1024 * 1024) throw new Error('image_reference_too_large');
    const blob = await response.blob();
    if (blob.size > 12 * 1024 * 1024 || !blob.type.startsWith('image/')) throw new Error('image_reference_invalid');
    const url = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve,reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = () => reject(new Error('image_reference_decode_failed')); value.src = url; });
      const sourceWidth = image.naturalWidth; const sourceHeight = image.naturalHeight;
      if (!sourceWidth || !sourceHeight || sourceWidth > 16384 || sourceHeight > 16384 || sourceWidth * sourceHeight > 64 * 1024 * 1024) throw new Error('image_reference_dimensions_invalid');
      const scale = Math.min(1,512 / sourceWidth,512 / sourceHeight);
      const width = Math.max(1,Math.round(sourceWidth * scale)); const height = Math.max(1,Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('image_reference_canvas_unavailable');
      context.drawImage(image,0,0,width,height);
      const png = await new Promise<Blob>((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('image_reference_encode_failed')),'image/png'));
      references.push(await dataURL(png)); transforms.push({ index, sourceWidth,sourceHeight,width,height,resized: scale < 1 });
    } finally { URL.revokeObjectURL(url); }
  }
  const next: Body = { ...body, referenceTransforms: transforms };
  delete next.referenceImage;
  if (action === 'model-matrix') {
    next.imageUrl = references[0]; next.modelReferenceImageUrl = references[1];
  } else { next.imageUrls = references; delete next.imageUrl; }
  return next;
}

function getPending(key: string): string | null {
  try { return localStorage.getItem(key) ?? pending.get(key) ?? null; } catch { return pending.get(key) ?? null; }
}
function remember(key: string,id: string) {
  pending.set(key,id);
  try { localStorage.setItem(key,id); if (localStorage.getItem(key) !== id) throw new Error('readback'); }
  catch { throw new Error('生成依頼IDを保存できません。ブラウザの保存領域を確認してください。推論は開始していません。'); }
}
function forget(key: string,id: string) {
  if (pending.get(key) === id) pending.delete(key);
  try { if (localStorage.getItem(key) === id) localStorage.removeItem(key); } catch { /* retaining a terminal ID is safe */ }
}
function readReceipt(value: unknown,id: string): ImageReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('image_receipt_invalid');
  const receipt = value as ImageReceipt;
  if (receipt.requestId !== id || !['running','completed','failed','unknown'].includes(receipt.state) ||
      typeof receipt.success !== 'boolean' || receipt.success !== (receipt.state === 'completed') || typeof receipt.recovery !== 'string') throw new Error('image_receipt_invalid');
  if (receipt.success && (receipt.persistenceStatus !== 'completed' || !Array.isArray(receipt.images) || !receipt.images.length ||
      receipt.images.some(item => !item || typeof item !== 'object' || !(item as Body).storagePath || !(item as Body).imageUrl))) throw new Error('image_receipt_invalid');
  return receipt;
}

/** One submission per invocation; after a lost response only the same receipt is
 * read. Later explicit retries can submit the SAME ID if D1 confirms absent;
 * server atomic admission still makes concurrent copies a single inference. */
export async function invokeDurableImageAction<T>(options: {
  origin: string; userId: string; action: string; body: Body; idempotencyKey?: string;
  call(path: string,init?: RequestInit): Promise<unknown>; assertCurrent(): Promise<void>;
  /** Runs under the same request lock. A failed composite/save retains the
   * completed provider ID, so a later invocation never repeats inference. */
  finalize?(receipt: ImageReceipt): Promise<ImageReceipt>;
  retainUntilAcknowledged?: boolean;
  beforeSubmit?(requestId:string,clientRecoveryKey:string):Promise<void>;
  onTerminal?(requestId:string,clientRecoveryKey:string):Promise<void>;
}): Promise<T> {
  // Coalesce before the asynchronous hash: a fast first response can otherwise
  // finish and clear its map entry while the second identical hash is pending.
  const identity = canonicalCloudflareImageBody(options.body);
  const flightKey = canonical({ origin:options.origin,userId:options.userId,action:options.action,body:identity,idempotencyKey:options.idempotencyKey,retainUntilAcknowledged:options.retainUntilAcknowledged });
  if (inFlight.has(flightKey)) return await inFlight.get(flightKey) as T;
  const runTask = async ():Promise<T> => {
  const key = await durableImageRecoveryKey(options.origin,options.userId,options.action,identity);
  const run = async (): Promise<T> => {
    await options.assertCurrent();
    const previous = getPending(key);
    if (options.idempotencyKey && previous && previous !== options.idempotencyKey) throw new Error('同じ入力の生成依頼が未照合です。先にその結果を確認してください。');
    const id = previous ?? options.idempotencyKey ?? crypto.randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('image_request_id_invalid');
    remember(key,id);
    // Full masked-edit inputs must be durable and checked before any inference.
    await options.beforeSubmit?.(id,key);
    await options.assertCurrent();
    const path = `/v1/image-ai/requests/${id}`;
    let value: ImageReceipt | undefined;
    if (previous) {
      try { value = readReceipt(await options.call(path),id); }
      catch (error) { if (!(error instanceof Error && error.message.includes('_404_image_request_not_found'))) throw error; }
    }
    if (!value) {
      await options.assertCurrent();
      try {
        value = readReceipt(await options.call(`/v1/provider-actions/${encodeURIComponent(options.action)}`,{
          method: 'POST',headers: { 'content-type': 'application/json','Idempotency-Key': id },body: JSON.stringify(options.body),
        }),id);
      } catch (error) {
        // Only definite pre-admission rejection can discard the ID. A generic
        // 401/403 may arrive AFTER inference if the session/brand role changed.
        if (error instanceof Error && (/_(400|413|422|429)_/.test(error.message) ||
          /_403_(rights_confirmation_required|legal_safety_prompt_blocked)$/.test(error.message))) { await options.onTerminal?.(id,key); forget(key,id); throw error; }
        await options.assertCurrent();
        try { value = readReceipt(await options.call(path),id); }
        catch { throw new Error(`生成結果を確認できません。依頼 ${id} を保持しました。再操作時は同じ依頼を照合します。`); }
      }
    }
    const until = Date.now() + 210_000;
    while (value.state === 'running' && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve,1000)); await options.assertCurrent();
      value = readReceipt(await options.call(path),id);
    }
    await options.assertCurrent();
    if (value.state === 'running') throw new Error(`生成依頼 ${id} は処理中です。再推論せず、後で同じ依頼を照合してください。`);
    if (value.state === 'completed' && value.requiresProtectedComposite === true && !options.finalize) throw new Error('image_protected_finalizer_required');
    if (value.state === 'completed' && options.finalize) {
      value = readReceipt(await options.finalize(value),id);
      if (!value.success || value.requiresProtectedComposite === true) throw new Error('image_final_save_incomplete');
      await options.assertCurrent();
    }
    if (value.state === 'failed' || (value.state === 'completed' && !options.retainUntilAcknowledged)) { await options.onTerminal?.(id,key); forget(key,id); }
    if (value.state === 'completed' && options.retainUntilAcknowledged) value = { ...value,clientRecoveryKey:key };
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('heavy-image-usage-changed'));
    return value as T;
  };
  const task = typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(key,run) : run();
  return await task;
  };
  const task = runTask(); inFlight.set(flightKey,task);
  try { return await task; } finally { if (inFlight.get(flightKey) === task) inFlight.delete(flightKey); }
}

/** The caller acknowledges only after its final history/Canvas handoff. This
 * clears one exact user's input key, never all pending work or another session. */
export async function acknowledgeDurableImageAction(options: {
  origin: string; userId: string; receipt: { requestId?: unknown; clientRecoveryKey?: unknown };
  assertCurrent(): Promise<void>;
  cleanup?():Promise<void>;
}): Promise<void> {
  await options.assertCurrent();
  const { requestId,clientRecoveryKey } = options.receipt;
  if (typeof requestId !== 'string' || typeof clientRecoveryKey !== 'string' ||
      !clientRecoveryKey.startsWith(`heavy:image-ai:v1:${options.origin}:${options.userId}:`)) throw new Error('image_acknowledgement_scope_invalid');
  const run = async () => {
    await options.assertCurrent();
    const existing = getPending(clientRecoveryKey);
    if (existing && existing !== requestId) throw new Error('image_acknowledgement_request_mismatch');
    await options.cleanup?.();
    await options.assertCurrent();
    forget(clientRecoveryKey,requestId);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('heavy-image-inputs-changed'));
  };
  if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(clientRecoveryKey,run);
  else await run();
}
