import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { clientError, createServiceClient, createUserClient, requireBrandRole, requireUser } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FEEDBACK_SCREENSHOT_BUCKET = 'feedback-screenshots';
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 7 * 1024 * 1024;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const FEEDBACK_TYPES = new Set(['lost', 'result', 'save', 'speed', 'other']);
const ALLOWED_PAGE_ORIGINS = new Set([
  'https://heavy-chain.zeabur.app',
  'https://heavy-chain.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

type FeedbackType = 'lost' | 'result' | 'save' | 'speed' | 'other';
type ScreenshotCaptureStatus = 'captured' | 'screenshot_capture_failed' | 'screenshot_upload_failed';

interface SubmitFeedbackRequest {
  brand_id?: string | null;
  type?: string;
  message?: string;
  email?: string | null;
  page_url?: string;
  pathname?: string;
  viewport?: unknown;
  user_agent?: string | null;
  screenshot_data_url?: string | null;
  screenshot_capture_status?: ScreenshotCaptureStatus;
}

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

const readString = (value: unknown, maxLength: number) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
};

const normalizeFeedbackType = (value: unknown): FeedbackType | null => {
  const type = readString(value, 32);
  return FEEDBACK_TYPES.has(type) ? type as FeedbackType : null;
};

const normalizePageUrl = (value: unknown) => {
  const raw = readString(value, 2000) || '/';
  try {
    const url = raw.startsWith('/') ? new URL(raw, 'https://heavy-chain.zeabur.app') : new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !ALLOWED_PAGE_ORIGINS.has(url.origin)) {
      return 'https://heavy-chain.zeabur.app/';
    }
    return url.toString();
  } catch {
    return 'https://heavy-chain.zeabur.app/';
  }
};

const normalizePathname = (value: unknown, pageUrl: string) => {
  const raw = readString(value, 512);
  if (raw.startsWith('/')) return raw;
  try {
    return new URL(pageUrl).pathname || '/';
  } catch {
    return '/';
  }
};

const readJsonWithLimit = async (req: Request) => {
  if (!req.body) return {};

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error('feedback_payload_too_large');
    }
    chunks.push(value);
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(bodyBytes)) as SubmitFeedbackRequest;
};

const parsePngDataUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!value.startsWith(PNG_DATA_URL_PREFIX)) throw new Error('feedback_screenshot_must_be_png');

  const base64 = value.slice(PNG_DATA_URL_PREFIX.length);
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error('feedback_screenshot_must_be_png');

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const estimatedBytes = Math.floor((base64.length * 3) / 4) - padding;
  if (estimatedBytes > MAX_SCREENSHOT_BYTES || value.length > MAX_REQUEST_BYTES) {
    throw new Error('feedback_screenshot_too_large');
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: 'feedback_payload_too_large' }, 413);
  }

  let uploadedScreenshotPath: string | null = null;

  try {
    const userClient = createUserClient(req);
    const serviceClient = createServiceClient();
    const user = await requireUser(userClient);
    const body = await readJsonWithLimit(req);

    const type = normalizeFeedbackType(body.type);
    if (!type) {
      return jsonResponse({ error: 'feedback_type_invalid' }, 400);
    }

    const message = readString(body.message, 4000);
    if (!message) {
      return jsonResponse({ error: 'feedback_message_required' }, 400);
    }

    const pageUrl = normalizePageUrl(body.page_url);
    const pathname = normalizePathname(body.pathname, pageUrl);
    const brandId = readString(body.brand_id, 80) || null;
    if (brandId) {
      await requireBrandRole(userClient, brandId, user.id, 'viewer');
    }

    let screenshotPath: string | null = null;
    let screenshotStatus: ScreenshotCaptureStatus = (
      body.screenshot_capture_status === 'screenshot_capture_failed'
      || body.screenshot_capture_status === 'screenshot_upload_failed'
    )
      ? body.screenshot_capture_status
      : 'captured';

    const screenshotBytes = parsePngDataUrl(body.screenshot_data_url);
    if (screenshotBytes) {
      screenshotPath = `${user.id}/${Date.now()}-${crypto.randomUUID()}.png`;
      const { error: uploadError } = await serviceClient.storage
        .from(FEEDBACK_SCREENSHOT_BUCKET)
        .upload(screenshotPath, screenshotBytes, {
          contentType: 'image/png',
          cacheControl: '60',
          upsert: false,
        });

      if (uploadError) {
        screenshotPath = null;
        screenshotStatus = 'screenshot_upload_failed';
      } else {
        uploadedScreenshotPath = screenshotPath;
      }
    } else if (screenshotStatus === 'captured') {
      screenshotStatus = 'screenshot_capture_failed';
    }

    const { data, error } = await serviceClient
      .from('feedback_submissions')
      .insert({
        user_id: user.id,
        brand_id: brandId,
        type,
        message,
        email: readString(body.email, 320) || null,
        page_url: pageUrl,
        pathname,
        viewport: body.viewport && typeof body.viewport === 'object'
          ? JSON.parse(JSON.stringify(body.viewport))
          : {},
        user_agent: readString(body.user_agent, 1024) || null,
        screenshot_path: screenshotPath,
        screenshot_capture_status: screenshotStatus,
        status: 'new',
        admin_note: null,
        resolved_at: null,
      })
      .select('id, screenshot_path, screenshot_capture_status')
      .single();

    if (error) {
      if (uploadedScreenshotPath) {
        await serviceClient.storage
          .from(FEEDBACK_SCREENSHOT_BUCKET)
          .remove([uploadedScreenshotPath]);
      }
      throw error;
    }

    return jsonResponse({ ok: true, feedback: data });
  } catch (error) {
    return jsonResponse({ error: clientError(error) }, 400);
  }
});
