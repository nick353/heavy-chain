export const IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
import { PROTECTED_IMAGE_EDIT_MODE } from '../../../src/lib/protectedImageEditContract.ts';
export const IMAGE_ACTIONS = new Set(['generate-image', 'edit-image', 'model-matrix']);
export type ImageAction = 'generate-image' | 'edit-image' | 'model-matrix';
export type Json = Record<string, unknown>;
export type Raster = { bytes: Uint8Array; contentType: string; width: number; height: number };
export type Candidate = { prompt: string; descriptor: Json; seed: number };
export type ImageInput = { action: ImageAction; brandId: string; prompt: string; featureType: string;
  width: number; height: number; references: Raster[]; candidates: Candidate[]; metadata: Json;
  parentImageId: string | null; generation: number };
export class ImageInputError extends Error {
  status: number;
  constructor(code: string, status = 400) { super(code); this.status = status; }
}
export const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const requiredText = (v: unknown, max: number): string => {
  // eslint-disable-next-line no-control-regex -- control characters are invalid in prompts.
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000\u007f]/.test(v)) throw new ImageInputError('invalid_image_prompt');
  return v.trim();
};

export async function boundedImageJSON(request: Request): Promise<Json> {
  const max = 9 * 1024 * 1024;
  if (!request.body || Number(request.headers.get('content-length')) > max) throw new ImageInputError('image_input_too_large', 413);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > max) { await reader.cancel(); throw new ImageInputError('image_input_too_large', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ImageInputError('invalid_image_input'); }
  if (!isRecord(value)) throw new ImageInputError('invalid_image_input');
  return value;
}

// Header parsing is deliberately small enough for the Worker. Actual decode /
// resizing happens in the browser; PNG/JPEG dimensions are verified again here.
export function raster(bytes: Uint8Array): Raster | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0; let height = 0; let contentType = '';
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n) &&
      String.fromCharCode(...bytes.subarray(12,16)) === 'IHDR') {
    width = view.getUint32(16); height = view.getUint32(20); contentType = 'image/png';
    let offset = 8; let data = false; let end = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset); if (length > bytes.length - offset - 12) return null;
      const type = String.fromCharCode(...bytes.subarray(offset+4,offset+8));
      if (type === 'IDAT' && length > 0) data = true;
      offset += length+12;
      if (type === 'IEND') { end = length === 0 && offset === bytes.length; break; }
    }
    if (!data || !end) return null;
  } else if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) return null;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]; if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) return null;
      const size = view.getUint16(offset); if (size < 2 || offset + size > bytes.length) return null;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && size >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); contentType = 'image/jpeg'; break;
      }
      offset += size;
    }
  }
  return width > 0 && height > 0 && width <= 8192 && height <= 8192 ? { bytes, contentType, width, height } : null;
}

export function decodeImage(value: unknown, reference = true): Raster {
  const match = typeof value === 'string' ? /^(?:data:(image\/(?:png|jpeg));base64,)?([A-Za-z0-9+/]+={0,2})$/.exec(value) : null;
  const max = reference ? 1536 * 1024 : 10 * 1024 * 1024;
  if (!match || match[2].length > Math.ceil(max / 3) * 4) throw new ImageInputError('invalid_image_bytes');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)); } catch { throw new ImageInputError('invalid_image_bytes'); }
  const image = raster(bytes);
  if (!image || bytes.length > max || (match[1] && match[1] !== image.contentType)) throw new ImageInputError('invalid_image_bytes');
  if (reference && (image.width > 512 || image.height > 512)) throw new ImageInputError('image_reference_exceeds_512px');
  return image;
}

export async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), n => n.toString(16).padStart(2,'0')).join('');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isRecord(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

function compact(value: unknown, depth = 0): unknown {
  if (depth > 10) throw new ImageInputError('image_metadata_too_deep');
  if (typeof value === 'string') {
    if (/^(?:data:|blob:|https?:\/\/)/i.test(value)) return '[provided]';
    if (/^\s*(?:[[]|[{])/.test(value)) {
      let parsed: unknown;
      try { parsed = JSON.parse(value); } catch { return value; }
      return JSON.stringify(compact(parsed,depth + 1));
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(v => compact(v, depth + 1));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).filter(([k]) => !/token|password|authorization|secret/i.test(k)).map(([k,v]) => [k, compact(v, depth + 1)]));
  return value;
}
const BODY_TYPES: Record<string, [string, string]> = { slim: ['スリム','slim, lean'], regular: ['レギュラー','average'], plus: ['プラス','plus-size, curvy'] };
const AGES: Record<string, string> = { '20s': '20代', '30s': '30代', '40s': '40代', '50s': '50代' };
function choices(value: unknown, allowed: Record<string, unknown>, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || !(v in allowed)) || new Set(value).size !== value.length) throw new ImageInputError('invalid_fitting_options');
  return value as string[];
}

export function parseImageInput(action: ImageAction, body: Json): ImageInput {
  const brandId = body.brandId ?? body.brand_id;
  if (typeof brandId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(brandId)) throw new ImageInputError('invalid_brand_id');
  if (!isRecord(body.legalSafety) || body.legalSafety.rightsConfirmed !== true) throw new ImageInputError('rights_confirmation_required', 403);
  try { requireLegalSafetyApproval(body.legalSafety,[body.prompt,body.productDescription,body.negativePrompt,body.textOverlay,body.generationIntent]); }
  catch { throw new ImageInputError('legal_safety_prompt_blocked',403); }
  if (body.maskDataUrl || body.maskApplied === true || body.outputBackground === 'transparent') throw new ImageInputError('image_mask_or_transparency_not_supported', 422);
  // A caller asking for a different provider/model must not be silently routed.
  for (const value of [body.generationModel, body.providerModel]) if (value && value !== IMAGE_MODEL) throw new ImageInputError('image_model_not_supported', 422);
  if (body.generationProvider && body.generationProvider !== 'workers_ai') throw new ImageInputError('image_provider_not_supported', 422);
  const prompt = requiredText(action === 'model-matrix'
    ? (typeof body.productDescription === 'string' && body.productDescription.trim() ? body.productDescription
      : body.imageUrl ? 'Use the provided garment reference without inventing or replacing its design.' : body.productDescription)
    : body.prompt, 12000);
  const ratios: Record<string, [number,number]> = { '1:1': [1024,1024], '3:4': [768,1024], '4:3': [1024,768], '4:5': [1024,1280], '5:4': [1280,1024], '16:9': [1024,576], '9:16': [576,1024], '2:3': [768,1152], '3:2': [1152,768] };
  if (body.aspectRatio !== undefined && (typeof body.aspectRatio !== 'string' || !ratios[body.aspectRatio])) throw new ImageInputError('image_aspect_ratio_not_supported');
  const defaults = ratios[String(body.aspectRatio)] ?? (action === 'model-matrix' ? [768,1024] : [1024,1024]);
  const width = body.width ?? defaults[0]; const height = body.height ?? defaults[1];
  if (![width,height].every(v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 256 && v <= 1920 && v % 8 === 0)) throw new ImageInputError('invalid_image_dimensions');
  const inputURLs = action === 'edit-image' ? body.imageUrls ?? [body.imageUrl]
    : action === 'model-matrix' ? [body.imageUrl, body.modelReferenceImageUrl].filter(Boolean) : body.imageUrls ?? [];
  if (!Array.isArray(inputURLs) || inputURLs.length > 4 || (action === 'edit-image' && !inputURLs.length)) throw new ImageInputError('image_reference_count_not_supported', 422);
  if (action === 'model-matrix' && body.modelReferenceImageUrl && !body.imageUrl) throw new ImageInputError('fitting_garment_reference_required');
  const references = inputURLs.map(v => decodeImage(v));
  const protectedEdit = body.protectedEdit;
  if (protectedEdit !== undefined) {
    if (body.inputFidelity !== undefined || body.quality !== undefined) throw new ImageInputError('protected_image_quality_setting_not_supported',422);
    if (action !== 'edit-image' || !isRecord(protectedEdit) || protectedEdit.mode !== PROTECTED_IMAGE_EDIT_MODE ||
        ![protectedEdit.sourceWidth,protectedEdit.sourceHeight].every(v=>typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 4096) ||
        ![protectedEdit.sourceSha256,protectedEdit.maskSha256].every(v=>typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) ||
        references.length < 2 || protectedEdit.guideIndex !== references.length - 1 ||
        typeof protectedEdit.coveragePercent !== 'number' || !Number.isFinite(protectedEdit.coveragePercent) || protectedEdit.coveragePercent <= 0 || protectedEdit.coveragePercent > 100 ||
        references.at(-1)!.contentType !== 'image/png' || references[0].width !== references.at(-1)!.width || references[0].height !== references.at(-1)!.height) {
      throw new ImageInputError('invalid_protected_image_edit_plan',422);
    }
  }
  const featureType = typeof body.featureType === 'string' ? requiredText(body.featureType, 256) : action;
  const metadata = compact(Object.fromEntries(['protectedEdit','sourceReadback','generationIntent','materialReference','materialReferences','layerPlan','maskPlan','compositionPreview','lightchainCompat','campaignMeta','textOverlay','style','negativePrompt','referenceTransforms','parentObjectId','skinTone','hairStyle','modelCandidateLabel',
    'modelReferenceImageUrl','modelReferenceFileName','modelReferenceSourceImageId','modelReferenceSourceStoragePath'].filter(k => body[k] !== undefined).map(k => [k, body[k]]))) as Json;
  if (new TextEncoder().encode(JSON.stringify(metadata)).length > 128 * 1024) throw new ImageInputError('image_metadata_too_large');
  const suffix = [typeof body.negativePrompt === 'string' && body.negativePrompt ? `Avoid: ${body.negativePrompt}` : '',
    typeof body.style === 'string' && body.style ? `Style: ${body.style}` : '',
    isRecord(body.textOverlay) && body.textOverlay.text ? `Text to render exactly: ${JSON.stringify(body.textOverlay)}.` : ''].filter(Boolean).join('\n');
  let descriptors: Json[];
  if (action === 'model-matrix') {
    const types = choices(body.bodyTypes, BODY_TYPES, ['regular']); const ages = choices(body.ageGroups, AGES, ['20s']);
    if (types.length * ages.length > 3 || (body.gender !== undefined && !['male','female'].includes(String(body.gender)))) throw new ImageInputError('invalid_fitting_options');
    if ((body.skinTone !== undefined && !['light','medium','dark'].includes(String(body.skinTone))) ||
        (body.hairStyle !== undefined && !['short','medium','long'].includes(String(body.hairStyle)))) throw new ImageInputError('invalid_fitting_options');
    descriptors = types.flatMap(type => ages.map(age => ({ bodyType: type, bodyTypeName: BODY_TYPES[type][0], ageGroup: age, ageGroupName: AGES[age], gender: body.gender ?? 'female' })));
  } else {
    const count = body.count ?? 1;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 4) throw new ImageInputError('invalid_image_count');
    descriptors = Array.from({ length: count }, (_, candidateIndex) => ({ candidateIndex }));
  }
  const candidates = descriptors.map((descriptor, index) => {
    let instruction = prompt;
    if (action === 'edit-image') instruction = `Edit image 0 according to the request. Preserve the garment identity, construction, texture, logos, and all unrequested details. Other indexed images are references, not replacements.\nRequest: ${prompt}`;
    if (isRecord(protectedEdit)) instruction += `\nImage ${protectedEdit.guideIndex} is ONLY a spatial edit guide aligned exactly with image 0: WHITE is the editable region; BLACK is protected. Do not copy this guide, its black/white colors, or its edges into the artwork. Apply the requested change inside the white region and retain image 0 framing. Other references describe the requested material/artwork. The client will restore every protected source pixel after generation; this is reference-guided editing, not native masked inference.`;
    if (action === 'model-matrix') {
      instruction = `Professional full-body apparel try-on photograph. ${descriptor.gender} adult in their ${descriptor.ageGroup}, ${BODY_TYPES[String(descriptor.bodyType)][1]} body type.\n` +
        (references[0] ? 'Dress the person in EXACTLY the garment in image 0. Preserve its color, print, fabric, pockets, fastenings, proportions and logos; do not substitute a similar item.\n' : '') +
        (references[1] ? 'Image 1 is the person reference: preserve their face, hairstyle, pose direction and identity while applying the selected fit and adult age context.\n' : '') +
        (body.skinTone ? `Selected skin tone: ${body.skinTone}.\n` : '') + (body.hairStyle ? `Selected hair length: ${body.hairStyle}.\n` : '') +
        `The garment is worn naturally, not a flat product mockup. Neutral studio background, professional lighting.\nGarment/request: ${prompt}`;
    }
    const seed = body.seed === undefined ? crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647 : Number(body.seed) + index;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) throw new ImageInputError('invalid_image_seed');
    return { prompt: `${instruction}\n${suffix}`.trim(), descriptor, seed };
  });
  const parentImageId = body.parentImageId ?? null;
  if (parentImageId !== null && (typeof parentImageId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parentImageId))) throw new ImageInputError('invalid_parent_image');
  const generation = body.generation ?? 1;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1 || generation > 10000) throw new ImageInputError('invalid_image_generation');
  return { action, brandId, prompt, featureType, width: width as number, height: height as number, references, candidates, metadata, parentImageId, generation };
}

export function modelMultipart(input: ImageInput, candidate: Candidate): { body: ReadableStream<Uint8Array>; contentType: string } {
  const form = new FormData();
  form.set('prompt', candidate.prompt); form.set('width', String(input.width)); form.set('height', String(input.height)); form.set('seed', String(candidate.seed));
  input.references.forEach((ref, index) => form.set(`input_image_${index}`, new Blob([ref.bytes as BlobPart], { type: ref.contentType }), `reference-${index}.${ref.contentType === 'image/png' ? 'png' : 'jpg'}`));
  const response = new Response(form);
  return { body: response.body!, contentType: response.headers.get('content-type')! };
}
export function imageEstimate(input: Pick<ImageInput, 'width' | 'height' | 'references'>) {
  const tiles = (w: number,h: number) => Math.ceil(w / 512) * Math.ceil(h / 512);
  const inputTiles = input.references.reduce((sum, ref) => sum + tiles(ref.width, ref.height), 0);
  const outputTiles = tiles(input.width,input.height);
  return { microUSD: inputTiles * 59 + outputTiles * 287, neurons: inputTiles * 5.37 + outputTiles * 26.05 };
}
import { requireLegalSafetyApproval } from './legalSafety.ts';
