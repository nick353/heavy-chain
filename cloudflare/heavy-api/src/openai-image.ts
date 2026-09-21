import type { Env } from './index.ts';
import type { Candidate, ImageAction, ImageInput } from './image-ai-contracts.ts';

export const OPENAI_IMAGE_PROVIDER = 'openai';
export const OPENAI_IMAGE_BACKEND = 'openai-images-api';
export const OPENAI_IMAGE_MODELS = new Set([
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
]);
export const OPENAI_IMAGE_EDIT_MODELS = new Set([
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
  'chatgpt-image-latest',
]);

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

const imageSize = (width?: number, height?: number) => {
  if (!width || !height) return '1024x1024';
  const ratio = width / height;
  if (Math.abs(ratio - 3 / 2) < 0.08 || Math.abs(ratio - 16 / 9) < 0.08 || width > height) return '1536x1024';
  if (Math.abs(ratio - 2 / 3) < 0.08 || Math.abs(ratio - 9 / 16) < 0.08 || height > width) return '1024x1536';
  return '1024x1024';
};

export function openAIExpectedDimensions(width: number, height: number): [number, number] {
  const value = imageSize(width, height);
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
    return 'gpt-image-1-mini';
  }
  const configured = env.OPENAI_IMAGE_MODEL?.trim();
  if (configured && OPENAI_IMAGE_MODELS.has(configured)) return configured;
  return 'gpt-image-1-mini';
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

function safeProviderError(status: number, value: unknown): Error {
  const record = asRecord(value);
  const providerError = asRecord(record?.error);
  const code = typeof providerError?.code === 'string' ? providerError.code :
    typeof providerError?.type === 'string' ? providerError.type : 'request_failed';
  return new Error(`openai_image_request_failed:${status}:${code.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120)}`);
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
): Promise<OpenAIImageOutput> {
  const key = apiKey(env);
  if (!key) throw new Error('openai_image_api_key_missing');
  const candidate = input.candidates[candidateIndex];
  if (!candidate) throw new Error('openai_image_candidate_missing');
  const edit = action !== 'generate-image' || input.references.length > 0;
  const modelAction: ImageAction = edit && action === 'generate-image' ? 'edit-image' : action;
  const model = resolveOpenAIModel(env, modelAction, edit ? (env.OPENAI_IMAGE_EDIT_MODEL || env.OPENAI_IMAGE_MODEL) : env.OPENAI_IMAGE_MODEL);
  let response: Response;
  if (!edit) {
    response = await fetchImpl(`${baseURL(env)}/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: promptFor(candidate), n: 1, size: imageSize(input.width, input.height) }),
    });
  } else {
    const form = new FormData();
    form.set('model', model);
    form.set('prompt', promptFor(candidate));
    form.set('n', '1');
    form.set('size', imageSize(input.width, input.height));
    form.set('output_format', 'png');
    input.references.forEach((reference, index) => {
      const contentType = normalizeMimeType(reference.contentType);
      form.append('image[]', referenceBlob(reference.bytes, contentType), `reference-${index + 1}.${extensionFromMimeType(contentType)}`);
    });
    response = await fetchImpl(`${baseURL(env)}/images/edits`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw safeProviderError(response.status, data);
  const image = extractImages(data)[0];
  if (!image?.base64) throw new Error('openai_image_empty_response');
  return {
    image: `data:${image.mimeType};base64,${image.base64}`,
    provider: OPENAI_IMAGE_PROVIDER,
    backendProvider: OPENAI_IMAGE_BACKEND,
    providerModel: model,
    providerTaskId: response.headers.get('x-request-id') || `openai-${crypto.randomUUID()}`,
  };
}
