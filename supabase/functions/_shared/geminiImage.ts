import { geminiGenerateContentUrl, imagenPredictUrl, isImagenImageModel, resolveGeminiImageModel } from './geminiModels.ts';

export type GeminiImageResult = {
  base64: string;
  mimeType: string;
  model: string;
  taskId: string;
};

export type GeminiImageArtifact = {
  base64: string;
  dataUrl: string;
  contentType: string;
  extension: string;
};

function geminiApiKey() {
  const key = Deno.env.get('GEMINI_API_KEY')?.trim();
  if (!key) throw new Error('gemini_api_key_missing');
  return key;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractInlineImage(data: unknown) {
  const record = asRecord(data);
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  for (const candidate of candidates) {
    const content = asRecord(candidate)?.content;
    const parts = Array.isArray(asRecord(content)?.parts) ? asRecord(content)?.parts as unknown[] : [];
    for (const part of parts) {
      const partRecord = asRecord(part);
      const inlineData = asRecord(partRecord?.inlineData) ?? asRecord(partRecord?.inline_data);
      const base64 = inlineData?.data;
      if (typeof base64 === 'string' && base64.trim()) {
        return {
          base64: base64.trim(),
          mimeType: normalizeMimeType(
            typeof inlineData?.mimeType === 'string'
              ? inlineData.mimeType
              : typeof inlineData?.mime_type === 'string'
                ? inlineData.mime_type
                : 'image/png',
          ),
        };
      }
    }
  }
  return null;
}

function extractImagenImage(data: unknown) {
  const record = asRecord(data);
  const predictions = Array.isArray(record?.predictions) ? record.predictions : [];
  for (const prediction of predictions) {
    const predictionRecord = asRecord(prediction);
    const bytesBase64Encoded = predictionRecord?.bytesBase64Encoded;
    const mimeType = predictionRecord?.mimeType;
    if (typeof bytesBase64Encoded === 'string' && bytesBase64Encoded.trim()) {
      return {
        base64: bytesBase64Encoded.trim(),
        mimeType: normalizeMimeType(typeof mimeType === 'string' ? mimeType : 'image/png'),
      };
    }
  }
  return null;
}

function sanitizeGeminiError(error: unknown): string {
  const key = Deno.env.get('GEMINI_API_KEY')?.trim();
  let message = error instanceof Error ? error.message : String(error ?? 'gemini_image_request_failed');
  if (key) message = message.split(key).join('[redacted]');
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-gemini-key]')
    .replace(/key=([^&\s]+)/g, 'key=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .slice(0, 600);
}

export async function generateGeminiImage(params: {
  prompt: string;
  negativePrompt?: string | null;
  width?: number;
  height?: number;
  model?: string | null;
}): Promise<GeminiImageResult> {
  const model = resolveGeminiImageModel(params.model);
  const promptText = [
    params.prompt,
    params.negativePrompt ? `Avoid: ${params.negativePrompt}` : '',
    params.width && params.height ? `Target canvas: ${params.width}x${params.height}.` : '',
  ].filter(Boolean).join('\n\n');

  try {
    if (isImagenImageModel(model)) {
      const response = await fetch(imagenPredictUrl(model), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey(),
        },
        body: JSON.stringify({
          instances: [{ prompt: promptText }],
          parameters: {
            sampleCount: 1,
            aspectRatio: aspectRatioFromDimensions(params.width, params.height),
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`gemini_image_request_failed:${response.status}:${JSON.stringify(data)}`);
      }
      const image = extractImagenImage(data);
      if (!image?.base64) throw new Error('gemini_image_empty_response');
      return {
        ...image,
        model,
        taskId: `gemini-${crypto.randomUUID()}`,
      };
    }

    const response = await fetch(geminiGenerateContentUrl(model, geminiApiKey()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: promptText }],
          },
        ],
        generationConfig: {
          responseModalities: ['IMAGE'],
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`gemini_image_request_failed:${response.status}:${JSON.stringify(data)}`);
    }
    const image = extractInlineImage(data);
    if (!image?.base64) throw new Error('gemini_image_empty_response');
    return {
      ...image,
      model,
      taskId: `gemini-${crypto.randomUUID()}`,
    };
  } catch (error) {
    throw new Error(sanitizeGeminiError(error));
  }
}

function aspectRatioFromDimensions(width?: number, height?: number) {
  if (!width || !height) return '1:1';
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.08) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.08) return '9:16';
  if (Math.abs(ratio - 4 / 3) < 0.08) return '4:3';
  if (Math.abs(ratio - 3 / 4) < 0.08) return '3:4';
  return '1:1';
}

export function geminiImageDataUri(base64: string, mimeType?: string | null) {
  return `data:${normalizeMimeType(mimeType)};base64,${base64}`;
}

export function geminiImageArtifact(result: Pick<GeminiImageResult, 'base64' | 'mimeType'>): GeminiImageArtifact {
  const contentType = normalizeMimeType(result.mimeType);
  return {
    base64: result.base64,
    dataUrl: geminiImageDataUri(result.base64, contentType),
    contentType,
    extension: extensionFromMimeType(contentType),
  };
}

export function geminiProviderName() {
  return 'gemini';
}
