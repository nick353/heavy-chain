export type OpenAiImageResult = {
  base64: string;
  mimeType: string;
  model: string;
  taskId: string;
  candidates?: OpenAiImageCandidate[];
  requestedCount?: number;
  receivedCount?: number;
};

export type OpenAiImageCandidate = {
  base64: string;
  mimeType: string;
  candidateIndex: number;
};

export type OpenAiImageArtifact = {
  base64: string;
  dataUrl: string;
  contentType: string;
  extension: string;
};

export type ImageEditCleanupStatus = 'none' | 'completed' | 'failed';

export function resolveImageEditCleanupStatus(
  cleanupAttempted: boolean,
  cleanupErrors: readonly unknown[],
): ImageEditCleanupStatus {
  if (cleanupErrors.length > 0) return 'failed';
  return cleanupAttempted ? 'completed' : 'none';
}

const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2';

const OPENAI_IMAGE_MODELS = new Set([
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
]);

const OPENAI_IMAGE_EDIT_MODELS = new Set([
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
  'chatgpt-image-latest',
]);

function openAiImageApiKey() {
  const key = Deno.env.get('OPENAI_IMAGE_API_KEY')?.trim()
    || Deno.env.get('OPENAI_API_KEY')?.trim();
  if (!key) throw new Error('openai_image_api_key_missing');
  return key;
}

function openAiImageBaseUrl() {
  return (Deno.env.get('OPENAI_IMAGE_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function resolveOpenAiImageModel(requestedModel?: string | null) {
  const requested = String(requestedModel || '').trim();
  if (OPENAI_IMAGE_MODELS.has(requested)) return requested;
  return Deno.env.get('OPENAI_IMAGE_MODEL')?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
}

function resolveOpenAiImageEditModel(requestedModel?: string | null) {
  const requested = String(requestedModel || '').trim();
  if (OPENAI_IMAGE_EDIT_MODELS.has(requested)) return requested;
  const envModel = Deno.env.get('OPENAI_IMAGE_EDIT_MODEL')?.trim()
    || Deno.env.get('OPENAI_IMAGE_MODEL')?.trim();
  if (envModel && OPENAI_IMAGE_EDIT_MODELS.has(envModel)) return envModel;
  return 'gpt-image-1-mini';
}

function normalizeMimeType(mimeType?: string | null) {
  const cleanMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return cleanMimeType.startsWith('image/') ? cleanMimeType : 'image/png';
}

function extensionFromMimeType(mimeType: string) {
  switch (normalizeMimeType(mimeType)) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/png':
    default:
      return 'png';
  }
}

function dataUrlToBlob(imageUrl: string, index: number) {
  const match = imageUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error(`openai_image_edit_input_not_data_url:${index}`);
  const mimeType = normalizeMimeType(match[1]);
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return {
    blob: new Blob([bytes], { type: mimeType }),
    fileName: `reference-${index + 1}.${extensionFromMimeType(mimeType)}`,
    mimeType,
  };
}

async function imageUrlToBlob(imageUrl: string, index: number, filePrefix = 'reference') {
  if (imageUrl.startsWith('data:')) {
    const data = dataUrlToBlob(imageUrl, index);
    return {
      ...data,
      fileName: `${filePrefix}-${index + 1}.${extensionFromMimeType(data.blob.type)}`,
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    throw new Error(`openai_image_edit_input_invalid_url:${index}`);
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`openai_image_edit_input_protocol_not_allowed:${index}`);
  }

  const response = await fetch(parsedUrl.toString());
  if (!response.ok) {
    throw new Error(`openai_image_edit_input_fetch_failed:${index}:${response.status}`);
  }
  const responseBlob = await response.blob();
  const rawMimeType = (response.headers.get('content-type') || responseBlob.type || '').split(';')[0].trim().toLowerCase();
  if (!rawMimeType.startsWith('image/')) {
    throw new Error(`openai_image_edit_input_not_image:${index}`);
  }
  const mimeType = normalizeMimeType(rawMimeType);
  return {
    blob: new Blob([await responseBlob.arrayBuffer()], { type: mimeType }),
    fileName: `${filePrefix}-${index + 1}.${extensionFromMimeType(mimeType)}`,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractOpenAiImages(data: unknown): OpenAiImageCandidate[] {
  const record = asRecord(data);
  const images = Array.isArray(record?.data) ? record.data : [];
  return images.flatMap((image, candidateIndex) => {
    const imageRecord = asRecord(image);
    const base64 = imageRecord?.b64_json;
    if (typeof base64 === 'string' && base64.trim()) {
      return [{
        base64: base64.trim(),
        mimeType: normalizeMimeType(typeof imageRecord?.mime_type === 'string' ? imageRecord.mime_type : 'image/png'),
        candidateIndex,
      }];
    }
    return [];
  });
}

function openAiSizeFromDimensions(width?: number, height?: number) {
  if (!width || !height) return '1024x1024';
  const ratio = width / height;
  if (Math.abs(ratio - 3 / 2) < 0.08 || Math.abs(ratio - 16 / 9) < 0.08 || width > height) return '1536x1024';
  if (Math.abs(ratio - 2 / 3) < 0.08 || Math.abs(ratio - 9 / 16) < 0.08 || height > width) return '1024x1536';
  return '1024x1024';
}

function sanitizeOpenAiError(error: unknown): string {
  const key = Deno.env.get('OPENAI_IMAGE_API_KEY')?.trim()
    || Deno.env.get('OPENAI_API_KEY')?.trim();
  let message = error instanceof Error ? error.message : String(error ?? 'openai_image_request_failed');
  if (key) message = message.split(key).join('[redacted]');
  return message
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '[redacted-openai-key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .slice(0, 600);
}

export async function generateOpenAiImage(params: {
  prompt: string;
  negativePrompt?: string | null;
  width?: number;
  height?: number;
  model?: string | null;
}): Promise<OpenAiImageResult> {
  const model = resolveOpenAiImageModel(params.model);
  const promptText = [
    params.prompt,
    params.negativePrompt ? `Avoid: ${params.negativePrompt}` : '',
  ].filter(Boolean).join('\n\n');

  try {
    const response = await fetch(`${openAiImageBaseUrl()}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiImageApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: promptText,
        n: 1,
        size: openAiSizeFromDimensions(params.width, params.height),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`openai_image_request_failed:${response.status}:${JSON.stringify(data)}`);
    }
    const image = extractOpenAiImages(data)[0];
    if (!image?.base64) throw new Error('openai_image_empty_response');
    return {
      ...image,
      model,
      taskId: `openai-${crypto.randomUUID()}`,
    };
  } catch (error) {
    throw new Error(sanitizeOpenAiError(error));
  }
}

export async function editOpenAiImage(params: {
  prompt: string;
  images: Array<{ imageUrl: string }>;
  mask?: { imageUrl: string };
  model?: string | null;
  background?: 'transparent' | 'opaque' | 'auto';
  count?: number;
}): Promise<OpenAiImageResult> {
  const model = resolveOpenAiImageEditModel(params.model);
  const images = params.images
    .map((image) => image.imageUrl.trim())
    .filter(Boolean)
    .slice(0, 16);
  if (!images.length) throw new Error('openai_image_edit_input_missing');
  const requestedCount = Math.max(1, Math.min(4, Math.trunc(params.count || 1)));

  try {
    const formData = new FormData();
    formData.set('model', model);
    formData.set('prompt', params.prompt);
    formData.set('n', String(requestedCount));
    formData.set('background', params.background || 'auto');
    formData.set('output_format', 'png');
    const imageBlobs = await Promise.all(images.map((imageUrl, index) => imageUrlToBlob(imageUrl, index)));
    imageBlobs.forEach((image) => {
      formData.append('image[]', image.blob, image.fileName);
    });
    if (params.mask?.imageUrl) {
      const mask = await imageUrlToBlob(params.mask.imageUrl.trim(), images.length, 'mask');
      if (mask.mimeType !== 'image/png') {
        throw new Error('openai_image_edit_mask_not_png');
      }
      formData.append('mask', mask.blob, 'mask.png');
    }

    const response = await fetch(`${openAiImageBaseUrl()}/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiImageApiKey()}`,
      },
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`openai_image_edit_failed:${response.status}:${JSON.stringify(data)}`);
    }
    const candidates = extractOpenAiImages(data).slice(0, requestedCount);
    const image = candidates[0];
    if (!image?.base64) throw new Error('openai_image_edit_empty_response');
    return {
      ...image,
      model,
      taskId: `openai-edit-${crypto.randomUUID()}`,
      candidates,
      requestedCount,
      receivedCount: candidates.length,
    };
  } catch (error) {
    throw new Error(sanitizeOpenAiError(error));
  }
}

export function openAiImageDataUri(base64: string, mimeType?: string | null) {
  return `data:${normalizeMimeType(mimeType)};base64,${base64}`;
}

export function openAiImageArtifact(result: Pick<OpenAiImageResult, 'base64' | 'mimeType'>): OpenAiImageArtifact {
  const contentType = normalizeMimeType(result.mimeType);
  return {
    base64: result.base64,
    dataUrl: openAiImageDataUri(result.base64, contentType),
    contentType,
    extension: extensionFromMimeType(contentType),
  };
}
