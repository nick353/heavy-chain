import type { Env } from './index.ts';

// Text-only Claude actions. These never touch the image pipeline (Workers AI /
// OpenAI Images), D1 quota tables, or R2; they turn user text into structured
// guidance that the existing image actions consume.
export const CLAUDE_TEXT_ACTIONS = new Set(['optimize-prompt', 'chat-plan']);
export type ClaudeTextAction = 'optimize-prompt' | 'chat-plan';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-opus-5-5';
const ANTHROPIC_VERSION = '2023-06-01';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PROMPT_CHARS = 4_000;
const MAX_HISTORY_TURNS = 12;

type JsonSchema = Record<string, unknown>;
type Fetch = typeof fetch;

export class ClaudeTextError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

export const claudeConfigured = (env: Env) => !!env.ANTHROPIC_API_KEY?.trim();

function claudeModel(env: Env): string {
  const value = env.ANTHROPIC_TEXT_MODEL?.trim();
  return value && /^claude-[a-z0-9-]+$/.test(value) ? value : DEFAULT_MODEL;
}

function claudeBaseURL(env: Env): string {
  return (env.ANTHROPIC_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** One Messages API call constrained to a JSON schema; returns the parsed object. */
export async function callClaudeJSON<T>(
  env: Env,
  options: { system: string; user: string; schema: JsonSchema; maxTokens?: number },
  fetchImpl: Fetch = fetch,
): Promise<T> {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new ClaudeTextError('claude_api_key_missing', 503);
  let response: Response;
  try {
    response = await fetchImpl(`${claudeBaseURL(env)}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': FALLBACK_BETA,
      },
      body: JSON.stringify({
        model: claudeModel(env),
        max_tokens: options.maxTokens ?? 8000,
        system: options.system,
        messages: [{ role: 'user', content: options.user }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: options.schema } },
        fallbacks: 'default',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ClaudeTextError('claude_request_failed', 502);
  }
  if (!response.ok) {
    // Upstream 429/529 are retryable for the client; everything else is a
    // server-side configuration or request problem it cannot fix.
    const status = response.status === 429 || response.status === 529 ? 429 : 502;
    throw new ClaudeTextError(`claude_upstream_${response.status}`, status);
  }
  const data = await response.json() as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
  if (data.stop_reason === 'refusal') throw new ClaudeTextError('claude_request_refused', 422);
  if (data.stop_reason === 'max_tokens') throw new ClaudeTextError('claude_output_truncated', 502);
  const text = data.content?.find(block => block.type === 'text')?.text;
  if (!text) throw new ClaudeTextError('claude_empty_response', 502);
  try { return JSON.parse(text) as T; }
  catch { throw new ClaudeTextError('claude_invalid_json', 502); }
}

const requiredText = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new ClaudeTextError(code, 400);
  if (value.length > MAX_PROMPT_CHARS) throw new ClaudeTextError('prompt_too_long', 413);
  return value.trim();
};
const optionalText = (value: unknown, max = 200): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

const OPTIMIZE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['optimized_prompt', 'negative_prompt', 'style_tags', 'suggested_settings'],
  properties: {
    optimized_prompt: { type: 'string' },
    negative_prompt: { type: 'string' },
    style_tags: { type: 'array', items: { type: 'string' } },
    suggested_settings: {
      type: 'object',
      additionalProperties: false,
      required: ['aspect_ratio', 'quality'],
      properties: { aspect_ratio: { type: 'string' }, quality: { type: 'string', enum: ['standard', 'hd'] } },
    },
  },
};

const OPTIMIZE_SYSTEM = `You write prompts for an apparel brand's AI image generator (FLUX or GPT Image).
Turn the user's request, usually short Japanese, into one detailed English prompt that keeps their intent: garment, material, color, fit, model or flat-lay, setting, lighting, composition, and photographic style.
Do not invent logos, brand names, or text that the user did not ask for.
negative_prompt lists what to avoid (distortions, extra limbs, unwanted text). style_tags are 3-6 short English tags.
suggested_settings.aspect_ratio is one of 1:1, 4:5, 3:4, 9:16, 16:9.`;

export type OptimizedPrompt = {
  optimized_prompt: string; negative_prompt: string; style_tags: string[];
  suggested_settings: { aspect_ratio: string; quality: 'standard' | 'hd' };
};

export async function optimizePrompt(env: Env, body: Record<string, unknown>, fetchImpl?: Fetch) {
  const prompt = requiredText(body.prompt, 'prompt_required');
  const style = optionalText(body.style) ?? 'professional fashion photography';
  const platform = optionalText(body.targetPlatform) ?? 'general';
  const result = await callClaudeJSON<OptimizedPrompt>(env, {
    system: OPTIMIZE_SYSTEM,
    user: `Target style: ${style}\nTarget platform: ${platform}\n\n<request>\n${prompt}\n</request>`,
    schema: OPTIMIZE_SCHEMA,
  }, fetchImpl);
  return { success: true, original: prompt, ...result };
}

const CHAT_PLAN_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'instruction', 'reply'],
  properties: {
    mode: { type: 'string', enum: ['generate', 'edit'] },
    instruction: { type: 'string' },
    reply: { type: 'string' },
  },
};

const CHAT_PLAN_SYSTEM = `You route chat messages in an apparel image editor.
Decide whether the latest user message asks to EDIT the current image ("edit") or to create a NEW image ("generate").
Choose "edit" only when a current image exists and the user refers to changing it (color, background, sleeve, pose, adding or removing details). Choose "generate" when there is no current image or the user asks for something new.
instruction: one concise English instruction for the image model. For edits, state only the change and say to keep everything else unchanged. Use earlier turns to resolve references like "もっと" or "さっきの".
reply: one short Japanese sentence telling the user what will be done.`;

export type ChatPlan = { mode: 'generate' | 'edit'; instruction: string; reply: string };
type ChatTurn = { role: 'user' | 'assistant'; content: string };

function chatHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((turn): turn is ChatTurn => !!turn && typeof turn === 'object' &&
      ((turn as ChatTurn).role === 'user' || (turn as ChatTurn).role === 'assistant') &&
      typeof (turn as ChatTurn).content === 'string')
    .slice(-MAX_HISTORY_TURNS)
    .map(turn => ({ role: turn.role, content: turn.content.slice(0, 500) }));
}

export async function planChatEdit(env: Env, body: Record<string, unknown>, fetchImpl?: Fetch): Promise<ChatPlan & { success: true }> {
  const message = requiredText(body.message, 'message_required');
  const hasCurrentImage = body.hasCurrentImage === true;
  const history = chatHistory(body.history).map(turn => `${turn.role}: ${turn.content}`).join('\n');
  const plan = await callClaudeJSON<ChatPlan>(env, {
    system: CHAT_PLAN_SYSTEM,
    user: `Current image exists: ${hasCurrentImage ? 'yes' : 'no'}\n<history>\n${history}\n</history>\n<latest>\n${message}\n</latest>`,
    schema: CHAT_PLAN_SCHEMA,
  }, fetchImpl);
  // Never send an edit without an image to edit.
  const mode = plan.mode === 'edit' && hasCurrentImage ? 'edit' : 'generate';
  return { success: true, mode, instruction: plan.instruction.trim() || message, reply: plan.reply };
}

export async function runClaudeTextAction(env: Env, action: ClaudeTextAction, body: Record<string, unknown>, fetchImpl?: Fetch) {
  return action === 'optimize-prompt' ? optimizePrompt(env, body, fetchImpl) : planChatEdit(env, body, fetchImpl);
}
