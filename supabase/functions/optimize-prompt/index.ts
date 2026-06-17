import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { clientError, createServiceClient, requireBrandRole, type Database } from '../_shared/auth.ts';
import { createOpenAiChatCompletion } from '../_shared/openaiChat.ts';
import { completeBrandUsage, reserveBrandUsage, type UsageReservation } from '../_shared/usage.ts';
import { durationSince, recordEdgeFunctionRun, requestIdFrom, sanitizeError } from '../_shared/observability.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type OpenAiErrorMetadata = {
  provider: 'openai';
  status: number;
  type?: string;
  code?: string;
  message?: string;
};

class OpenAiResponseError extends Error {
  readonly metadata: OpenAiErrorMetadata;

  constructor(metadata: OpenAiErrorMetadata) {
    super(formatOpenAiErrorMessage(metadata));
    this.name = 'OpenAiResponseError';
    this.metadata = metadata;
  }
}

function redactSensitiveText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-[REDACTED]')
    .replace(/(authorization|api[-_ ]?key)\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=[REDACTED]');
}

function shortSafeText(value: unknown, maxLength = 180) {
  if (typeof value !== 'string') return undefined;
  const cleaned = redactSensitiveText(value).replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function formatOpenAiErrorMessage(metadata: OpenAiErrorMetadata) {
  const details = [
    `status=${metadata.status}`,
    metadata.type ? `type=${metadata.type}` : null,
    metadata.code ? `code=${metadata.code}` : null,
    metadata.message ? `message=${metadata.message}` : null,
  ].filter(Boolean).join(' ');

  return `Failed to optimize prompt: OpenAI request failed (${details})`;
}

async function openAiErrorFromResponse(response: Response) {
  let parsedBody: unknown = null;

  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = null;
  }

  const errorBody = parsedBody &&
    typeof parsedBody === 'object' &&
    'error' in parsedBody &&
    parsedBody.error &&
    typeof parsedBody.error === 'object'
    ? parsedBody.error as Record<string, unknown>
    : {};

  return new OpenAiResponseError({
    provider: 'openai',
    status: response.status,
    type: shortSafeText(errorBody.type, 80),
    code: shortSafeText(errorBody.code, 80),
    message: shortSafeText(errorBody.message),
  });
}

function errorMetadata(error: unknown): Record<string, unknown> {
  if (error instanceof OpenAiResponseError) {
    return {
      error: sanitizeError(error),
      openai: error.metadata,
    };
  }

  return { error: sanitizeError(error) };
}

serve(async (req) => {
  let usageReservation: UsageReservation | null = null;
  let telemetryClient: any = null;
  let observedBrandId: string | null = null;
  let observedUserId: string | null = null;
  const functionName = 'optimize-prompt';
  const requestId = requestIdFrom(req);
  const startedAt = Date.now();

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );
    const supabaseService = createServiceClient();
    telemetryClient = supabaseService;

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { prompt, style, targetPlatform, brandId } = await req.json();

    if (!prompt || !brandId) {
      throw new Error('Missing required parameters: prompt, brandId');
    }

    await requireBrandRole(supabaseClient, brandId, user.id, 'editor');
    observedBrandId = brandId;
    observedUserId = user.id;
    usageReservation = await reserveBrandUsage(supabaseService, {
      brandId,
      userId: user.id,
      functionName,
      units: 1,
      requestId,
      idempotencyKey: req.headers.get('idempotency-key'),
    });
    await recordEdgeFunctionRun(supabaseService, {
      reservation: usageReservation,
      brandId,
      userId: user.id,
      functionName,
      status: 'started',
      requestId,
    });

    // Optimize prompt using GPT-4
    const systemPrompt = `You are an expert fashion image prompt engineer. Your task is to optimize Japanese prompts for AI image generation (DALL-E 3, Stable Diffusion).

Rules:
1. Translate Japanese to English
2. Add specific fashion photography terms
3. Include lighting, composition, and style details
4. Optimize for the target platform/style if specified
5. Keep the core intent while enhancing quality

Target style: ${style || 'professional fashion photography'}
Target platform: ${targetPlatform || 'general'}

Output format:
Return valid JSON only.
{
  "optimized_prompt": "the optimized English prompt",
  "negative_prompt": "things to avoid",
  "style_tags": ["relevant", "style", "tags"],
  "suggested_settings": {
    "aspect_ratio": "1:1 or 16:9 etc",
    "quality": "standard or hd"
  }
}`;

    const response = await createOpenAiChatCompletion(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Optimize this prompt: ${prompt}` },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
      },
      'gpt-4o',
    );

    if (!response.ok) {
      throw await openAiErrorFromResponse(response);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    await completeBrandUsage(supabaseService, usageReservation, 'succeeded');
    await recordEdgeFunctionRun(supabaseService, {
      reservation: usageReservation,
      brandId,
      userId: user.id,
      functionName,
      status: 'succeeded',
      requestId,
      durationMs: durationSince(startedAt),
    });

    return new Response(
      JSON.stringify({
        success: true,
        original: prompt,
        ...result,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    if (telemetryClient) {
      await completeBrandUsage(telemetryClient, usageReservation, 'failed', errorMetadata(error));
      await recordEdgeFunctionRun(telemetryClient, {
        reservation: usageReservation,
        brandId: observedBrandId,
        userId: observedUserId,
        functionName,
        status: 'failed',
        requestId,
        durationMs: durationSince(startedAt),
        errorMessage: sanitizeError(error),
        metadata: errorMetadata(error),
      });
    }

    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: clientError(error) }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
