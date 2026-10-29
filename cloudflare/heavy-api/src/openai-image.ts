import type { Env } from './index.ts';
import type { Candidate, ImageAction, ImageInput } from './image-ai-contracts.ts';

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
  'model_not_found', 'content_policy_violation', 'billing_hard_limit_reached',
]);

const SAFE_PROVIDER_ERROR_TYPES = new Set([
  'invalid_request_error', 'authentication_error', 'permission_error', 'rate_limit_error', 'insufficient_quota', 'server_error', 'tokens', 'requests',
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
    this.errorCode = emptyBalance ? 'image_provider_quota_exhausted' : rateLimited ? 'image_provider_rate_limited' : errorCodes[category];
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
};

type OpenAIImageCandidate = { base64: string; mimeType: string; candidateIndex: number };

const normalizeMimeType = (value: unknown) => {
  const mime = String(value ?? '').split(';')[0].trim().toLowerCase();
  return mime.startsWith('image/') ? mime : 'image/png';
};

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

export function openAIExpectedDimensions(width: number, height: number, model?: string): [number, number] {
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
      ? [{ base64: base64.trim(), mimeType: normalizeMimeType(image?.mime_type), candidateIndex }]
      : [];
  });
}

function safeProviderError(status: number, data: unknown, requestId: string | null): OpenAIImageError {
  const record = asRecord(data);
  const providerError = asRecord(record?.error);
  const explicitRejection = [400, 401, 403, 404, 413, 415, 422, 429].includes(status) &&
    ['invalid_request_error', 'authentication_error', 'permission_error', 'rate_limit_error', 'insufficient_quota']
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

function referenceBlob(bytes: Uint8Array, mimeType: string): Blob {
  const contentType = normalizeMimeType(mimeType);
  return new Blob([bytes as BlobPart], { type: contentType });
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
  const modelAction: ImageAction = edit ? 'edit-image' : 'generate-image';
  void modelAction;
  const model = openAIModelForEndpoint(env, edit, chosenModel);
  const send = async (): Promise<Response> => {
  if (!edit) {
    return observeResponse(fetchImpl, `${baseURL(env)}/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: promptFor(candidate), n: 1, size: imageSize(input.width, input.height, model) }),
    });
  } else {
    const form = new FormData();
    form.set('model', model);
    form.set('prompt', promptFor(candidate));
    form.set('n', '1');
    form.set('size', imageSize(input.width, input.height));
    form.set('output_format', 'png');
    // Left on auto, a print or pattern came back with a transparent ground (10/29: white was asked, the PNG was
    // alpha 0 over dark green). Heavy never asks for transparency (the contract refuses it), so the ground is opaque.
    form.set('background', 'opaque');
    // Small repeats (dots, seams, buttons) keep their scale only at high quality (Light parity 2026-10-29).
    if (HIGH_FIDELITY_EDIT_MODELS.has(model)) { form.set('input_fidelity', 'high'); form.set('quality', 'high'); }
    input.references.forEach((reference, index) => {
      const contentType = normalizeMimeType(reference.contentType);
      form.append('image[]', referenceBlob(reference.bytes, contentType), `reference-${index + 1}.${extensionFromMimeType(contentType)}`);
    });
    return observeResponse(fetchImpl, `${baseURL(env)}/images/edits`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
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
  return {
    image: `data:${image.mimeType};base64,${image.base64}`,
    provider: OPENAI_IMAGE_PROVIDER,
    backendProvider: OPENAI_IMAGE_BACKEND,
    providerModel: model,
    providerTaskId: response.headers.get('x-request-id') || `openai-${crypto.randomUUID()}`,
  };
}
