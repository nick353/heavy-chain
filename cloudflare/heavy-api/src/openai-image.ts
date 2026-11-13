import type { Env } from './index.ts';
import { raster, type Candidate, type ImageAction, type ImageInput } from './image-ai-contracts.ts';

export const OPENAI_IMAGE_PROVIDER = 'openai';
export const OPENAI_IMAGE_BACKEND = 'openai-images-api';
export const MAX_OPENAI_IMAGE_TIMEOUT_MS = 180_000;
export type OpenAIImageErrorCategory = 'timeout' | 'transport_uncertainty' | 'request_rejected' | 'unusable_response';
const errorCodes: Record<OpenAIImageErrorCategory, string> = {
  timeout: 'image_provider_timeout',
  transport_uncertainty: 'image_provider_transport_uncertain',
  request_rejected: 'image_provider_request_rejected',
  unusable_response: 'image_provider_invalid_output',
};
const SAFE_PROVIDER_ERROR_CODES = new Set([
  'invalid_api_key', 'invalid_request_error', 'insufficient_quota', 'rate_limit_exceeded',
  'model_not_found', 'content_policy_violation', 'billing_hard_limit_reached', 'moderation_blocked',
]);

const SAFE_PROVIDER_ERROR_TYPES = new Set([
  'invalid_request_error', 'authentication_error', 'permission_error', 'rate_limit_error', 'insufficient_quota', 'server_error', 'tokens', 'requests',
  // The image safety system's refusal (code moderation_blocked); 2026-11-11 it was dropped and read as a lost connection.
  'image_generation_user_error',
]);

// Retain only fixed categories, HTTP status, allowlisted codes and a bounded
// request identifier. Raw messages and transport errors can contain secrets.
export class OpenAIImageError extends Error {
  readonly category: OpenAIImageErrorCategory;
  readonly errorCode: string;
  readonly status?: number;
  readonly providerCode?: string;
  readonly providerRequestId?: string;
  readonly providerType?: string;
  constructor(category: OpenAIImageErrorCategory, status?: number, providerCode?: unknown, providerRequestId?: string | null, rateLimited = false, providerType?: unknown) {
    super(errorCodes[category]);
    this.name = 'OpenAIImageError';
    this.category = category;
    // A per-minute/day limit is still a rejection (nothing ran), but the person should wait, not change the input;
    // an empty balance (10/29: type insufficient_quota, no code) needs someone to top it up.
    const emptyBalance = category === 'request_rejected' && (providerCode === 'insufficient_quota' || providerType === 'insufficient_quota');
    const moderationBlocked = category === 'request_rejected' && providerCode === 'moderation_blocked';
    this.errorCode = emptyBalance ? 'image_provider_quota_exhausted' : rateLimited ? 'image_provider_rate_limited'
      : moderationBlocked ? 'image_provider_moderation_blocked' : errorCodes[category];
    this.status = status;
    this.providerCode = typeof providerCode === 'string' && SAFE_PROVIDER_ERROR_CODES.has(providerCode) ? providerCode : undefined;
    this.providerRequestId = providerRequestId && /^req[-_][a-zA-Z0-9_-]{1,96}$/.test(providerRequestId) ? providerRequestId : undefined;
    // The error type tells a per-minute limit from an empty balance when the code is missing (10/29: 429s with no code).
    this.providerType = typeof providerType === 'string' && SAFE_PROVIDER_ERROR_TYPES.has(providerType) ? providerType : undefined;
  }
  get diagnostics() {
    return { category: this.category, status: this.status, providerCode: this.providerCode, providerType: this.providerType, providerRequestId: this.providerRequestId };
  }
}
export const OPENAI_IMAGE_MODELS = new Set([
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
]);
/** Edit models that accept input_fidelity=high (OpenAI: gpt-image-1 and 1.5; not mini). */
const HIGH_FIDELITY_EDIT_MODELS = new Set(['gpt-image-1.5', 'gpt-image-1']);
export const OPENAI_IMAGE_EDIT_MODELS = new Set([
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
  'chatgpt-image-latest',
]);

/** OpenAI image models offered in the settings screen (labels shown to users). */
export const OPENAI_IMAGE_MODEL_LABELS: Record<string, string> = {
  'gpt-image-2': 'GPT Image 2（新規生成のみ・最高品質）',
  'gpt-image-1.5': 'GPT Image 1.5（高品質）',
  'gpt-image-1': 'GPT Image 1（標準）',
  'gpt-image-1-mini': 'GPT Image 1 mini（高速・低コスト）',
};

/** The model actually sent to OpenAI: the chosen one when the endpoint supports it, otherwise the server default. */
export function openAIModelForEndpoint(env: Env, edit: boolean, chosen?: string | null): string {
  if (chosen && (edit ? OPENAI_IMAGE_EDIT_MODELS : OPENAI_IMAGE_MODELS).has(chosen)) return chosen;
  return resolveOpenAIModel(env, edit ? 'edit-image' : 'generate-image', edit ? (env.OPENAI_IMAGE_EDIT_MODEL || env.OPENAI_IMAGE_MODEL) : env.OPENAI_IMAGE_MODEL);
}

export type OpenAIImageOutput = {
  image: string;
  provider: typeof OPENAI_IMAGE_PROVIDER;
  backendProvider: typeof OPENAI_IMAGE_BACKEND;
  providerModel: string;
  providerTaskId: string;
  inputFidelity?: 'low' | 'high';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  /** Studio 画質 4K: how the direct draw went (kept on the candidate so the size, time and tokens can be checked). */
  direct4K?: Direct4KRecord;
};
export type Direct4KRecord = {
  /** drawn: OpenAI drew it large. fell_back: the usual draw was used, `reason` says why the large draw did not come back. */
  model: string; size: string; outcome: 'drawn' | 'fell_back'; reason?: 'rejected' | 'server_error' | 'timeout' | 'transport' | 'unusable';
  status?: number; providerCode?: string; providerType?: string; elapsedMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; imageInputTokens?: number; textInputTokens?: number };
};

type OpenAIImageCandidate = { base64: string; mimeType: string; candidateIndex: number };

const normalizeMimeType = (value: unknown) => {
  const mime = String(value ?? '').split(';')[0].trim().toLowerCase();
  return mime.startsWith('image/') ? mime : 'image/png';
};
/** The reply carries no mime_type for every model; a JPEG asked for by output_format starts with /9j/ in base64. */
const imageMimeType = (value: unknown, base64: string) => value ? normalizeMimeType(value) : base64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';

const extensionFromMimeType = (value: string) => normalizeMimeType(value) === 'image/jpeg' ? 'jpg' : 'png';

/** gpt-image-2 takes free sizes (multiples of 16, long side < 3840); Light returns 2048px-class images (2026-10-29). */
const LARGE_SIZES: Record<string, string> = { '1536x1024': '2048x1360', '1024x1536': '1360x2048', '1024x1024': '2048x2048' };
const imageSize = (width?: number, height?: number, model?: string) => {
  const base = baseImageSize(width, height);
  return model === 'gpt-image-2' ? LARGE_SIZES[base] ?? base : base;
};
const baseImageSize = (width?: number, height?: number) => {
  if (!width || !height) return '1024x1024';
  const ratio = width / height;
  if (Math.abs(ratio - 3 / 2) < 0.08 || Math.abs(ratio - 16 / 9) < 0.08 || width > height) return '1536x1024';
  if (Math.abs(ratio - 2 / 3) < 0.08 || Math.abs(ratio - 9 / 16) < 0.08 || height > width) return '1024x1536';
  return '1024x1024';
};

/**
 * Studio 画質 4K draws with OpenAI's newest image model at a large size and only the shortfall to Light's 4096 long edge
 * is enlarged. The image guide's custom-size rules: edges multiples of 16 and at most 3840, aspect 1:3 to 3:1, and
 * "Resolutions above 2560x1440 are experimental". #268 asked for 2336x3520 (8.2 MP) and OpenAI answered HTTP 500 after
 * 54.8 s (2026-11-12), so the draw stays within 2560x1440's pixel count: 3:4 is 1648x2208, 2:3 1552x2336, 1:1 1920x1920.
 */
export const DIRECT_4K_MODEL = 'gpt-image-2.6-sunburst';
const DIRECT_4K_MAX_EDGE = 3840;
const DIRECT_4K_MAX_PIXELS = 2560 * 1440;
/** The large draw gives up after this long so the usual draw still fits in the 180 s observation window. */
export const DIRECT_4K_WAIT_MS = 100_000;
const floor16 = (value: number) => Math.floor(value / 16) * 16;
export function direct4KSize(width?: number, height?: number): [number, number] {
  const ratio = width && height ? Math.min(3, Math.max(1 / 3, width / height)) : 1;
  const tall = Math.min(DIRECT_4K_MAX_EDGE, DIRECT_4K_MAX_EDGE / ratio, Math.sqrt(DIRECT_4K_MAX_PIXELS / ratio));
  return [floor16(tall * ratio), floor16(tall)];
}

export function openAIExpectedDimensions(width: number, height: number, model?: string): [number, number] {
  if (model === DIRECT_4K_MODEL) return direct4KSize(width, height);
  const value = imageSize(width, height, model);
  const [w, h] = value.split('x').map(Number);
  return [w, h];
}

function apiKey(env: Env): string | null {
  return env.OPENAI_IMAGE_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || null;
}

function baseURL(env: Env): string {
  return (env.OPENAI_IMAGE_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

export function resolveOpenAIModel(env: Env, action: ImageAction, requested?: unknown): string {
  const value = typeof requested === 'string' ? requested.trim() : '';
  if (action === 'generate-image' && value && OPENAI_IMAGE_MODELS.has(value)) return value;
  if (action !== 'generate-image' && value && OPENAI_IMAGE_EDIT_MODELS.has(value)) return value;
  if (value) throw new Error('openai_image_model_not_supported');
  if (action !== 'generate-image') {
    const edit = env.OPENAI_IMAGE_EDIT_MODEL?.trim();
    if (edit && OPENAI_IMAGE_EDIT_MODELS.has(edit)) return edit;
    const configuredEdit = env.OPENAI_IMAGE_MODEL?.trim();
    if (configuredEdit && OPENAI_IMAGE_EDIT_MODELS.has(configuredEdit)) return configuredEdit;
    // Edits must keep the source's buttons, seams and silhouette (Light keeps them, measured 2026-10-29);
    // mini redrew the garment and cannot take input_fidelity, so the default edit model is 1.5.
    return 'gpt-image-1.5';
  }
  const configured = env.OPENAI_IMAGE_MODEL?.trim();
  if (configured && OPENAI_IMAGE_MODELS.has(configured)) return configured;
  return 'gpt-image-2';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function extractImages(value: unknown): OpenAIImageCandidate[] {
  const record = asRecord(value);
  const list = Array.isArray(record?.data) ? record.data : [];
  return list.flatMap((item, candidateIndex) => {
    const image = asRecord(item);
    const base64 = image?.b64_json;
    return typeof base64 === 'string' && base64.trim()
      ? [{ base64: base64.trim(), mimeType: imageMimeType(image?.mime_type, base64.trim()), candidateIndex }]
      : [];
  });
}

function safeProviderError(status: number, data: unknown, requestId: string | null): OpenAIImageError {
  const record = asRecord(data);
  const providerError = asRecord(record?.error);
  const explicitRejection = [400, 401, 403, 404, 413, 415, 422, 429].includes(status) &&
    ['invalid_request_error', 'authentication_error', 'permission_error', 'rate_limit_error', 'insufficient_quota', 'image_generation_user_error']
      .includes(String(providerError?.type ?? ''));
  // A server/gateway error, timeout response or opaque HTTP error does not
  // establish that the provider rejected the inference before executing it.
  return new OpenAIImageError(explicitRejection ? 'request_rejected' : 'transport_uncertainty', status, providerError?.code, requestId,
    explicitRejection && isRateLimit(status, data), providerError?.type);
}

/** 429 from a request/token-per-minute limit (not an empty balance): nothing ran, so waiting and resending is safe. */
function isRateLimit(status: number, value: unknown): boolean {
  const providerError = asRecord(asRecord(value)?.error);
  return status === 429 && providerError?.type === 'rate_limit_error' && providerError?.code !== 'insufficient_quota';
}
const RATE_LIMIT_RETRIES = 2;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const RATE_LIMIT_MAX_WAIT_MS = 20_000;
/** OpenAI says how long to wait in retry-after (seconds) or retry-after-ms; without it, back off 5s then 10s. */
function rateLimitWait(response: Response, attempt: number): number {
  const ms = Number(response.headers.get('retry-after-ms'));
  const seconds = Number(response.headers.get('retry-after'));
  const asked = Number.isFinite(ms) && ms > 0 ? ms : Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 5000 * (attempt + 1);
  return Math.min(asked, RATE_LIMIT_MAX_WAIT_MS);
}

async function observeResponse(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try { return await fetchImpl(url, init); }
  catch { throw new OpenAIImageError('transport_uncertainty'); }
}

/** Candidates are drawn at the same time (2026-11-13); they share one Blob per reference instead of each copying it. */
const referenceBlobs = new WeakMap<Uint8Array, Blob>();
function referenceBlob(bytes: Uint8Array, mimeType: string): Blob {
  const contentType = normalizeMimeType(mimeType);
  const shared = referenceBlobs.get(bytes);
  if (shared?.type === contentType) return shared;
  const blob = new Blob([bytes as BlobPart], { type: contentType });
  referenceBlobs.set(bytes, blob);
  return blob;
}

function promptFor(candidate: Candidate): string {
  return candidate.prompt.trim();
}

export async function runOpenAIImage(
  env: Env,
  action: ImageAction,
  input: ImageInput,
  candidateIndex: number,
  fetchImpl: typeof fetch = fetch,
  chosenModel?: string | null,
): Promise<OpenAIImageOutput> {
  const key = apiKey(env);
  if (!key) throw new Error('openai_image_api_key_missing');
  const candidate = input.candidates[candidateIndex];
  if (!candidate) throw new Error('openai_image_candidate_missing');
  // A model-matrix brief can be generated without a reference. Only requests
  // with references (or explicit edit-image actions) use the edits endpoint.
  // Keeping the endpoint and model resolution aligned prevents a prompt-only
  // model-matrix request from being sent as an image edit with no image.
  const edit = action === 'edit-image' || input.references.length > 0;
  const model = openAIModelForEndpoint(env, edit, chosenModel);
  const draw = async (model: string, size: string, direct: boolean, signal?: AbortSignal) => {
  const send = async (): Promise<Response> => {
  if (!edit) {
    return observeResponse(fetchImpl, `${baseURL(env)}/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: promptFor(candidate), n: 1, size, moderation: 'low',
        ...(direct ? { quality: 'high', output_format: 'jpeg', output_compression: 95 } : {}) }),
      signal,
    });
  } else {
    const form = new FormData();
    form.set('model', model);
    form.set('prompt', promptFor(candidate));
    form.set('n', '1');
    form.set('size', size);
    // A 4K photo as PNG is over the 10 MB a result may be, so the direct 4K draw comes back as JPEG (quality 95).
    form.set('output_format', direct ? 'jpeg' : 'png');
    if (direct) form.set('output_compression', '95');
    // Left on auto, a print or pattern came back with a transparent ground (10/29: white was asked, the PNG was
    // alpha 0 over dark green). Heavy never asks for transparency (the contract refuses it), so the ground is opaque.
    form.set('background', 'opaque');
    // Apparel work routinely shows innerwear and swimwear on models (Light's 下着のフィッティング). On the default level the
    // image safety system refused the studio's innerwear sample (2026-11-11, 400 moderation_blocked); `low` is the
    // documented, less restrictive level for GPT image models and keeps OpenAI's usage policies in force.
    form.set('moderation', 'low');
    // Small repeats (dots, seams, buttons) keep their scale only at high quality (Light parity 2026-10-29).
    if (HIGH_FIDELITY_EDIT_MODELS.has(model)) { form.set('input_fidelity', 'high'); form.set('quality', 'high'); }
    // The GPT Image 2 family reads every input image at high fidelity and refuses input_fidelity; quality stays high.
    else if (direct) form.set('quality', 'high');
    input.references.forEach((reference, index) => {
      const contentType = normalizeMimeType(reference.contentType);
      form.append('image[]', referenceBlob(reference.bytes, contentType), `reference-${index + 1}.${extensionFromMimeType(contentType)}`);
    });
    return observeResponse(fetchImpl, `${baseURL(env)}/images/edits`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal,
    });
  }
  };
  let response: Response;
  let data: unknown;
  let requestId: string | null;
  // 10/29: twenty-odd generations in a row hit the per-minute limit and every tool just said 「失敗しました」.
  for (let attempt = 0; ; attempt++) {
    response = await send();
    requestId = response.headers.get('x-request-id');
    try { data = await response.json(); }
    catch (error) {
      throw new OpenAIImageError(response.ok && error instanceof SyntaxError ? 'unusable_response' : 'transport_uncertainty', response.status, undefined, requestId);
    }
    if (response.ok || attempt >= RATE_LIMIT_RETRIES || !isRateLimit(response.status, data)) break;
    await sleep(rateLimitWait(response, attempt));
  }
  if (!response.ok) throw safeProviderError(response.status, data, requestId);
  const image = extractImages(data)[0];
  if (!image?.base64) throw new OpenAIImageError('unusable_response', response.status, undefined, requestId);
  const output: OpenAIImageOutput = {
    image: `data:${image.mimeType};base64,${image.base64}`,
    provider: OPENAI_IMAGE_PROVIDER,
    backendProvider: OPENAI_IMAGE_BACKEND,
    providerModel: model,
    providerTaskId: response.headers.get('x-request-id') || `openai-${crypto.randomUUID()}`,
  };
  return direct ? { ...output, direct4K: { model, size, outcome: 'drawn' as const, usage: tokenUsage(data) } } : output;
  };
  // 画質 4K: the newest model draws large first. Whatever stops that draw (a refusal, HTTP 500 as on 2026-11-12, no answer
  // within DIRECT_4K_WAIT_MS, a lost connection or an unusable reply) falls back to the usual draw and enlargement, so the
  // studio never stops at 「失敗・保存を再試行」. Only an empty balance or a passing limit stop, since they refuse that too.
  let fellBack: Direct4KRecord | undefined;
  if (input.resolution === '4k') {
    const size = direct4KSize(input.width, input.height).join('x');
    const started = Date.now(); const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const output = await Promise.race([draw(DIRECT_4K_MODEL, size, true, controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new OpenAIImageError('timeout')); }, DIRECT_4K_WAIT_MS);
      })]);
      const drawn = raster(base64Bytes(output.image.slice(output.image.indexOf(',') + 1)));
      if (!drawn || `${drawn.width}x${drawn.height}` !== size) throw new OpenAIImageError('unusable_response', 200, undefined, output.providerTaskId);
      return output;
    } catch (error) {
      if (error instanceof OpenAIImageError && (error.errorCode === 'image_provider_quota_exhausted' || error.errorCode === 'image_provider_rate_limited')) throw error;
      const category = error instanceof OpenAIImageError ? error.category : 'transport_uncertainty';
      fellBack = { model: DIRECT_4K_MODEL, size, outcome: 'fell_back', elapsedMs: Date.now() - started,
        reason: category === 'request_rejected' ? 'rejected' : category === 'timeout' ? 'timeout' : category === 'unusable_response' ? 'unusable'
          : error instanceof OpenAIImageError && (error.status ?? 0) >= 500 ? 'server_error' : 'transport',
        ...(error instanceof OpenAIImageError ? { status: error.status, providerCode: error.providerCode, providerType: error.providerType } : {}) };
    } finally { if (timer) clearTimeout(timer); }
  }
  const output = await draw(model, edit ? imageSize(input.width, input.height) : imageSize(input.width, input.height, model), false);
  return fellBack ? { ...output, direct4K: fellBack } : output;
}

const base64Bytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/** Token counts from the reply (numbers only), for the cost of a direct 4K draw. */
function tokenUsage(value: unknown): Direct4KRecord['usage'] {
  const usage = asRecord(asRecord(value)?.usage);
  const details = asRecord(usage?.input_tokens_details);
  const count = (raw: unknown) => typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined;
  const result = { inputTokens: count(usage?.input_tokens), outputTokens: count(usage?.output_tokens),
    imageInputTokens: count(details?.image_tokens), textInputTokens: count(details?.text_tokens) };
  return Object.values(result).some((item) => item !== undefined) ? result : undefined;
}
