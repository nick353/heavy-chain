import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createServiceClient } from '../_shared/auth.ts';
import {
  jsonResponse,
  readConnectionToken,
  runwayMcpCallTool,
  runwayMcpListTools,
} from '../_shared/runwayMcpConnection.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse({ ok: true });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  try {
    const expectedToken = Deno.env.get('RUNWAY_MCP_BRIDGE_TOKEN')?.trim();
    const supplied = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!expectedToken || supplied !== expectedToken) {
      return jsonResponse({ error: 'unauthorized_bridge_request' }, 401);
    }

    const url = new URL(req.url);
    const action = url.pathname.endsWith('/image-upscale') ? 'image-upscale' : 'text-to-image';
    const payload = await req.json().catch(() => ({}));
    const brandId = typeof payload.brandId === 'string' ? payload.brandId : '';
    if (!brandId) return jsonResponse({ error: 'brand_id_required' }, 400);

    const serviceClient = createServiceClient();
    const accessToken = await readConnectionToken(serviceClient, brandId);
    const tools = await runwayMcpListTools(accessToken);
    const tool = selectTool(tools, action);
    if (!tool?.name) {
      return jsonResponse({
        error: 'runway_mcp_tool_unavailable',
        action,
        availableTools: tools.map((candidate: unknown) => projectTool(candidate)).slice(0, 20),
      }, 502);
    }

    const result = await runwayMcpCallTool(accessToken, tool.name, buildToolArguments(payload, action));
    const image = extractImageResult(result, payload.model);
    if (!image.base64 && !image.outputUrl) {
      return jsonResponse({
        error: 'runway_mcp_empty_image_response',
        tool: tool.name,
        resultPreview: previewResult(result),
      }, 502);
    }

    return jsonResponse({
      base64: image.base64,
      dataUrl: image.dataUrl,
      outputUrl: image.outputUrl,
      mimeType: image.mimeType || 'image/png',
      model: image.model || payload.model || 'runway-mcp',
      taskId: image.taskId || crypto.randomUUID(),
      tool: tool.name,
    });
  } catch (error) {
    return jsonResponse({ error: sanitizeError(error) }, mapErrorStatus(error));
  }
});

function selectTool(tools: unknown[], action: 'text-to-image' | 'image-upscale') {
  const projected = tools.map(projectTool).filter((tool) => tool.name);
  const preferred = action === 'image-upscale'
    ? ['upscale', 'magnific']
    : ['text_to_image', 'text-to-image', 'generate_image', 'image_generation', 'gen4', 'image'];

  return projected.find((tool) => {
    const haystack = `${tool.name} ${tool.description || ''}`.toLowerCase();
    return preferred.some((needle) => haystack.includes(needle));
  }) || projected[0] || null;
}

function buildToolArguments(payload: Record<string, unknown>, action: string) {
  if (action === 'image-upscale') {
    return {
      image: payload.base64 ? `data:${payload.mimeType || 'image/png'};base64,${payload.base64}` : payload.image,
      mimeType: payload.mimeType || 'image/png',
      prompt: payload.prompt || 'Upscale this image while preserving details.',
      model: payload.model,
    };
  }

  return {
    prompt: payload.promptText || payload.prompt,
    negativePrompt: payload.negativePrompt || null,
    model: payload.model,
    ratio: payload.ratio,
    width: payload.width,
    height: payload.height,
    referenceImages: payload.referenceImages || [],
  };
}

function extractImageResult(result: unknown, fallbackModel: unknown) {
  const record = asRecord(result);
  const content = Array.isArray(record?.content) ? record.content : [];
  const firstImageContent = content
    .map((item) => asRecord(item))
    .find((item) => item && (typeof item.data === 'string' || typeof item.url === 'string')) ?? null;
  const dataUrl = stringField(record, ['dataUrl', 'data_url', 'url', 'uri'])
    || stringField(firstImageContent, ['dataUrl', 'data_url', 'url', 'uri']);
  const base64 = stringField(record, ['base64', 'data'])
    || stringField(firstImageContent, ['base64', 'data'])
    || parseDataUrl(dataUrl)?.base64
    || '';
  const outputUrl = dataUrl && !dataUrl.startsWith('data:') ? dataUrl : stringField(record, ['outputUrl', 'output_url']);
  const mimeType = parseDataUrl(dataUrl)?.mimeType
    || stringField(record, ['mimeType', 'mime_type', 'contentType', 'content_type'])
    || stringField(firstImageContent, ['mimeType', 'mime_type'])
    || 'image/png';

  return {
    base64,
    dataUrl: dataUrl?.startsWith('data:') ? dataUrl : '',
    outputUrl,
    mimeType,
    model: stringField(record, ['model']) || (typeof fallbackModel === 'string' ? fallbackModel : 'runway-mcp'),
    taskId: stringField(record, ['taskId', 'task_id', 'id']),
  };
}

function parseDataUrl(value: string) {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i.exec(value || '');
  if (!match) return null;
  return { mimeType: match[1] || 'image/png', base64: match[2] || '' };
}

function projectTool(tool: unknown) {
  const record = asRecord(tool);
  return {
    name: stringField(record, ['name']),
    description: stringField(record, ['description']),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function previewResult(value: unknown) {
  return JSON.stringify(value).slice(0, 1200);
}

function sanitizeError(error: unknown) {
  return String(error instanceof Error ? error.message : error || 'runway_mcp_bridge_failed')
    .replace(/access_token["=:]\s*["']?[^"',\s}]+/gi, 'access_token=[redacted]')
    .replace(/refresh_token["=:]\s*["']?[^"',\s}]+/gi, 'refresh_token=[redacted]')
    .slice(0, 700);
}

function mapErrorStatus(error: unknown) {
  const message = String(error instanceof Error ? error.message : error || '');
  if (/auth_required|unauthorized|decrypt|encryption_key/i.test(message)) return 401;
  if (/subscription/i.test(message)) return 402;
  return 502;
}
