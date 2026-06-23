export type RunwayImageResult = {
  base64: string;
  mimeType: string;
  model: string;
  taskId: string;
  outputUrl: string;
};

export type RunwayReferenceImage = {
  uri: string;
  tag: string;
};

export type RunwayImageArtifact = {
  base64: string;
  dataUrl: string;
  contentType: string;
  extension: string;
};

const DEFAULT_RUNWAY_IMAGE_MODEL = 'gen4_image';
const RUNWAY_UPSCALE_MODEL = 'magnific_precision_upscaler_v2';

type BridgeResult = {
  base64: string;
  mimeType: string;
  model: string;
  taskId: string;
  outputUrl: string;
};

function bridgeConfig() {
  const url = Deno.env.get('RUNWAY_MCP_BRIDGE_URL')?.trim().replace(/\/+$/, '');
  const token = Deno.env.get('RUNWAY_MCP_BRIDGE_TOKEN')?.trim();

  if (!url || !token) {
    throw new Error('runway_mcp_bridge_not_configured');
  }

  return { url, token };
}

function sanitizeRunwayError(error: unknown): string {
  const token = Deno.env.get('RUNWAY_MCP_BRIDGE_TOKEN')?.trim();
  let message = error instanceof Error ? error.message : String(error ?? 'runway_mcp_request_failed');

  if (token) {
    message = message.split(token).join('[redacted]');
  }

  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/RUNWAY_MCP_BRIDGE_TOKEN\s*[:=]\s*\S+/gi, 'RUNWAY_MCP_BRIDGE_TOKEN=[redacted]')
    .replace(/token\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}["']?/gi, 'token=[redacted]')
    .slice(0, 600);
}

function runwayModel() {
  return Deno.env.get('RUNWAY_IMAGE_MODEL')?.trim() || DEFAULT_RUNWAY_IMAGE_MODEL;
}

function ratioFromDimensions(width?: number, height?: number) {
  const w = Number(width || 1024);
  const h = Number(height || 1024);
  if (w > h) return '1920:1080';
  if (h > w) return '1080:1920';
  return '1024:1024';
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
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    case 'image/png':
    default:
      return 'png';
  }
}

export function runwayImageDataUri(base64: string, mimeType?: string | null) {
  return `data:${normalizeMimeType(mimeType)};base64,${base64}`;
}

export function runwayReferenceImage(base64: string, mimeType?: string | null, tag = 'reference'): RunwayReferenceImage {
  return {
    uri: runwayImageDataUri(base64, mimeType),
    tag,
  };
}

export function runwayImageArtifact(result: Pick<RunwayImageResult, 'base64' | 'mimeType'>): RunwayImageArtifact {
  const contentType = normalizeMimeType(result.mimeType);
  return {
    base64: result.base64,
    dataUrl: runwayImageDataUri(result.base64, contentType),
    contentType,
    extension: extensionFromMimeType(contentType),
  };
}

async function parseBridgeJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function mapBridgeStatus(status: number) {
  if (status === 401 || status === 403) return 'runway_mcp_auth_required';
  if (status === 402) return 'runway_mcp_subscription_inactive';
  return `runway_mcp_request_failed:${status}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function nestedImageCandidate(data: unknown): unknown {
  const record = asRecord(data);
  if (!record) return null;
  return record.image ?? record.result ?? record.output ?? record.data ?? null;
}

function stringCandidate(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const firstString = value.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return firstString?.trim() || '';
  }
  return '';
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: normalizeMimeType(match[1]),
    base64: match[2].trim(),
  };
}

function extractBridgeImage(data: unknown, fallbackModel: string): BridgeResult {
  const record = asRecord(data);
  const imageCandidate = nestedImageCandidate(data);
  const imageRecord = asRecord(imageCandidate);
  const imageString = stringCandidate(imageCandidate);
  const topLevelUrl = stringField(record, ['outputUrl', 'output_url', 'url']);
  const dataUrl =
    stringField(record, ['dataUrl', 'data_url']) ||
    stringField(imageRecord, ['dataUrl', 'data_url', 'url', 'uri']) ||
    (topLevelUrl.startsWith('data:') ? topLevelUrl : '') ||
    (imageString.startsWith('data:') ? imageString : '');
  const parsedDataUrl = dataUrl.startsWith('data:') ? parseDataUrl(dataUrl) : null;
  const base64 =
    parsedDataUrl?.base64 ||
    stringField(record, ['base64']) ||
    stringField(imageRecord, ['base64']) ||
    (!/^https?:\/\//.test(imageString) && !imageString.startsWith('data:') ? imageString : '');
  const outputUrl =
    (!dataUrl.startsWith('data:') ? dataUrl : '') ||
    (!topLevelUrl.startsWith('data:') ? topLevelUrl : '') ||
    stringField(imageRecord, ['outputUrl', 'output_url']) ||
    (/^https?:\/\//.test(imageString) ? imageString : '');
  const bridgeMimeType =
    parsedDataUrl?.mimeType ||
    stringField(record, ['mimeType', 'mime_type', 'contentType', 'content_type']) ||
    stringField(imageRecord, ['mimeType', 'mime_type', 'contentType', 'content_type']);

  return {
    base64,
    mimeType: bridgeMimeType ? normalizeMimeType(bridgeMimeType) : '',
    model: stringField(record, ['model']) || stringField(imageRecord, ['model']) || fallbackModel,
    taskId: stringField(record, ['taskId', 'task_id', 'id']) || stringField(imageRecord, ['taskId', 'task_id', 'id']),
    outputUrl,
  };
}

async function fetchOutputAsBase64(outputUrl: string) {
  const response = await fetch(outputUrl);
  if (!response.ok) {
    throw new Error(`runway_mcp_output_fetch_failed:${response.status}`);
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }

  return { base64: btoa(binary), mimeType };
}

async function callBridge(path: '/text-to-image' | '/image-upscale', payload: Record<string, unknown>, fallbackModel: string) {
  const config = bridgeConfig();
  const response = await fetch(`${config.url}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await parseBridgeJson(response);

  if (!response.ok) {
    throw new Error(`${mapBridgeStatus(response.status)}:${JSON.stringify(data)}`);
  }

  const result = extractBridgeImage(data, fallbackModel);
  if (result.base64) return result;
  if (result.outputUrl) {
    const fetched = await fetchOutputAsBase64(result.outputUrl);
    return {
      ...result,
      base64: fetched.base64,
      mimeType: normalizeMimeType(result.mimeType || fetched.mimeType),
    };
  }

  throw new Error('runway_mcp_empty_image_response');
}

export async function generateRunwayImage(params: {
  brandId: string;
  prompt: string;
  width?: number;
  height?: number;
  negativePrompt?: string | null;
  pollTimeoutMs?: number;
  referenceImages?: RunwayReferenceImage[];
}): Promise<RunwayImageResult> {
  try {
    const promptText = params.negativePrompt
      ? `${params.prompt}\n\nAvoid: ${params.negativePrompt}`
      : params.prompt;
    const result = await callBridge('/text-to-image', {
      model: runwayModel(),
      prompt: params.prompt,
      promptText,
      negativePrompt: params.negativePrompt ?? null,
      width: params.width,
      height: params.height,
      brandId: params.brandId,
      ratio: ratioFromDimensions(params.width, params.height),
      referenceImages: params.referenceImages ?? [],
    }, runwayModel());
    return result;
  } catch (error) {
    throw new Error(sanitizeRunwayError(error));
  }
}

export async function upscaleRunwayImage(params: {
  brandId: string;
  base64: string;
  mimeType?: string | null;
  pollTimeoutMs?: number;
}): Promise<RunwayImageResult> {
  try {
    const result = await callBridge('/image-upscale', {
      model: RUNWAY_UPSCALE_MODEL,
      brandId: params.brandId,
      image: {
        base64: params.base64,
        mimeType: normalizeMimeType(params.mimeType),
        dataUrl: runwayImageDataUri(params.base64, params.mimeType),
      },
    }, RUNWAY_UPSCALE_MODEL);
    return {
      ...result,
      model: result.model || RUNWAY_UPSCALE_MODEL,
    };
  } catch (error) {
    throw new Error(sanitizeRunwayError(error));
  }
}

export function runwayProviderName() {
  return 'runway';
}
