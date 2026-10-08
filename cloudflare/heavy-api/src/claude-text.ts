import type { Env } from './index.ts';

// Text-only Claude actions. These never touch the image pipeline (Workers AI /
// OpenAI Images), D1 quota tables, or R2; they turn user text into structured
// guidance that the existing image actions consume.
export const CLAUDE_TEXT_ACTIONS = new Set(['optimize-prompt', 'chat-plan', 'image-plan']);
export type ClaudeTextAction = 'optimize-prompt' | 'chat-plan' | 'image-plan';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** Claude models offered in the settings screen. Only these can be requested per call. */
export const CLAUDE_TEXT_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（最高品質）' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（標準）' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5（高速・低コスト）' },
];
const CLAUDE_TEXT_MODEL_IDS = new Set(CLAUDE_TEXT_MODELS.map(model => model.id));
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

/** The server default (ANTHROPIC_TEXT_MODEL or Sonnet 5.5). */
export function defaultClaudeModel(env: Env): string {
  const value = env.ANTHROPIC_TEXT_MODEL?.trim();
  return value && /^claude-[a-z0-9-]+$/.test(value) ? value : DEFAULT_MODEL;
}

/** A model chosen in the settings screen when it is on the list; otherwise the server default. */
export function claudeModel(env: Env, requested?: unknown): string {
  const value = typeof requested === 'string' ? requested.trim() : '';
  return value && CLAUDE_TEXT_MODEL_IDS.has(value) ? value : defaultClaudeModel(env);
}

function claudeBaseURL(env: Env): string {
  return (env.ANTHROPIC_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** One Messages API call constrained to a JSON schema; returns the parsed object. */
export async function callClaudeJSON<T>(
  env: Env,
  options: { system: string; user: string | Array<Record<string, unknown>>; schema: JsonSchema; maxTokens?: number; model?: unknown },
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
        model: claudeModel(env, options.model),
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

export type ClaudeMessage = { role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> };

/** Free-text Messages API call (e.g. the design consultation chat). Roles are normalised to start with user and alternate. */
export async function callClaudeMessages(
  env: Env,
  options: { system: string; messages: ClaudeMessage[]; maxTokens?: number; model?: unknown; timeoutMs?: number },
  fetchImpl: Fetch = fetch,
): Promise<{ text: string; usage: Record<string, number> | null; model: string }> {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new ClaudeTextError('claude_api_key_missing', 503);
  const messages: ClaudeMessage[] = [];
  for (const message of options.messages) {
    if (!messages.length && message.role !== 'user') continue;
    const last = messages[messages.length - 1];
    if (last && last.role === message.role) {
      const asBlocks = (c: ClaudeMessage['content']) => typeof c === 'string' ? [{ type: 'text', text: c }] : c;
      last.content = [...asBlocks(last.content), ...asBlocks(message.content)];
    } else messages.push({ ...message });
  }
  const model = claudeModel(env, options.model);
  let response: Response;
  try {
    response = await fetchImpl(`${claudeBaseURL(env)}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify({ model, max_tokens: options.maxTokens ?? 1536, system: options.system, messages }),
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ClaudeTextError('claude_request_failed', 502);
  }
  if (!response.ok) throw new ClaudeTextError(`claude_upstream_${response.status}`, response.status === 429 || response.status === 529 ? 429 : 502);
  const data = await response.json() as { stop_reason?: string; content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  if (data.stop_reason === 'refusal') throw new ClaudeTextError('claude_request_refused', 422);
  const text = (data.content ?? []).filter(block => block.type === 'text' && block.text).map(block => block.text).join('');
  if (!text.trim()) throw new ClaudeTextError('claude_empty_response', 502);
  const input = data.usage?.input_tokens, output = data.usage?.output_tokens;
  const usage = Number.isSafeInteger(input) && Number.isSafeInteger(output)
    ? { prompt_tokens: input as number, completion_tokens: output as number, total_tokens: (input as number) + (output as number) } : null;
  return { text, usage, model };
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
    model: body.textModel,
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
    model: body.textModel,
  }, fetchImpl);
  // Never send an edit without an image to edit.
  const mode = plan.mode === 'edit' && hasCurrentImage ? 'edit' : 'generate';
  return { success: true, mode, instruction: plan.instruction.trim() || message, reply: plan.reply };
}

// image-plan: Claude writes one image-model prompt per requested output for the
// multi-image features. The browser then runs each prompt through the existing
// generate-image / edit-image actions.
export const IMAGE_PLAN_TASKS = ['banner', 'design-gacha', 'product-shots', 'variations', 'scene', 'colorize', 'background'] as const;
export type ImagePlanTask = typeof IMAGE_PLAN_TASKS[number];
const MAX_PLAN_ITEMS = 8;

const IMAGE_PLAN_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label', 'prompt', 'headline', 'subheadline'],
        properties: {
          key: { type: 'string' }, label: { type: 'string' }, prompt: { type: 'string' },
          headline: { type: 'string' }, subheadline: { type: 'string' },
        },
      },
    },
  },
};

const TASK_GUIDE: Record<ImagePlanTask, string> = {
  banner: 'Make one marketing banner per requested language. Translate the headline and subheadline naturally for that market (keep brand and product names as written). Put the translated text in headline/subheadline, and in prompt describe a clean apparel banner layout that renders exactly that text. label is the language name in Japanese (e.g. 英語).',
  'design-gacha': 'Propose distinct design directions for the brief, one per item. Keep the fixed elements, vary the randomized ones. label is a short Japanese direction name; prompt is the full image prompt.',
  'product-shots': 'One e-commerce product photo per requested shot (front, side, back, detail, etc.) of the SAME garment. When an image is given, prompt is an edit instruction that keeps the garment identical and only changes camera angle/framing/background. label is the Japanese shot name.',
  variations: 'One variation instruction for the given garment image: change styling, color mood or composition as requested by strength/prompt while keeping the garment recognizable. Return exactly one item.',
  scene: 'One item per requested scene: an edit instruction that places the same garment/outfit in that scene with matching lighting. label is the Japanese scene name.',
  colorize: 'One item per requested color: an edit instruction that recolors only the garment to that color (and pattern, if given), keeping shape, texture and everything else. label is the Japanese color name.',
  background: 'One item: an edit instruction that replaces only the background as requested and keeps the product pixels unchanged. label is a short Japanese description.',
};

const IMAGE_PLAN_SYSTEM = `You plan image-model prompts for an apparel brand's creative tool (FLUX or GPT Image).
Write every prompt in English, concrete and visual. Never add logos, brand names or text the user did not ask for.
Return exactly the requested number of items, in the requested order. key echoes the requested item key (or "1", "2", ... when none).
headline and subheadline are empty strings except for banner tasks.`;

function imageBlock(value: unknown): { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } | null {
  if (typeof value !== 'string') return null;
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  if (match[2].length > 7_000_000) throw new ClaudeTextError('plan_image_too_large', 413);
  return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
}

const textList = (value: unknown, max = MAX_PLAN_ITEMS): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim().slice(0, 300)).slice(0, max) : [];

export type ImagePlanItem = { key: string; label: string; prompt: string; headline: string; subheadline: string };

export async function planImages(env: Env, body: Record<string, unknown>, fetchImpl?: Fetch): Promise<{ success: true; task: ImagePlanTask; items: ImagePlanItem[] }> {
  const task = body.task;
  if (typeof task !== 'string' || !(IMAGE_PLAN_TASKS as readonly string[]).includes(task)) throw new ClaudeTextError('invalid_plan_task', 400);
  const planTask = task as ImagePlanTask;
  const items = textList(body.items);
  const requested = items.length || Math.min(MAX_PLAN_ITEMS, Math.max(1, Number.isInteger(body.count) ? Number(body.count) : 1));
  const count = planTask === 'variations' || planTask === 'background' ? 1 : requested;
  if (typeof body.brief === 'string' && body.brief.length > MAX_PROMPT_CHARS) throw new ClaudeTextError('prompt_too_long', 413);
  const brief = optionalText(body.brief, MAX_PROMPT_CHARS) ?? '';
  const details = [
    `Task: ${planTask}`, TASK_GUIDE[planTask],
    `Number of items: ${count}`,
    items.length && count > 1 ? `Requested item keys in order: ${JSON.stringify(items)}` : '',
    brief ? `<brief>\n${brief}\n</brief>` : '',
    optionalText(body.headline, 500) ? `Headline: ${optionalText(body.headline, 500)}` : '',
    optionalText(body.subheadline, 500) ? `Subheadline: ${optionalText(body.subheadline, 500)}` : '',
    textList(body.fixedElements).length ? `Fixed elements: ${textList(body.fixedElements).join(', ')}` : '',
    textList(body.randomizedElements).length ? `Randomized elements: ${textList(body.randomizedElements).join(', ')}` : '',
    optionalText(body.background) ? `Background: ${optionalText(body.background)}` : '',
    optionalText(body.pattern) ? `Pattern: ${optionalText(body.pattern)}` : '',
    typeof body.strength === 'number' ? `Variation strength (0-1): ${body.strength}` : '',
    planTask === 'variations' && items.length ? `Requested change: ${items.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  const image = imageBlock(body.imageDataUrl);
  const result = await callClaudeJSON<{ items: ImagePlanItem[] }>(env, {
    system: IMAGE_PLAN_SYSTEM,
    user: image ? [image, { type: 'text', text: `The image above is the user's garment/reference.\n${details}` }] : details,
    schema: IMAGE_PLAN_SCHEMA,
    model: body.textModel,
  }, fetchImpl);
  const planned = (Array.isArray(result.items) ? result.items : []).filter(item => item && typeof item.prompt === 'string' && item.prompt.trim()).slice(0, count);
  if (!planned.length) throw new ClaudeTextError('plan_empty', 502);
  // Keep the caller's keys/order even if the model renamed them.
  const keys = count > 1 && items.length ? items : null;
  return { success: true, task: planTask, items: planned.map((item, index) => ({
    key: keys?.[index] ?? (item.key || String(index + 1)), label: item.label || String(index + 1), prompt: item.prompt.trim(),
    headline: item.headline ?? '', subheadline: item.subheadline ?? '',
  })) };
}

export async function runClaudeTextAction(env: Env, action: ClaudeTextAction, body: Record<string, unknown>, fetchImpl?: Fetch) {
  if (action === 'optimize-prompt') return optimizePrompt(env, body, fetchImpl);
  if (action === 'image-plan') return planImages(env, body, fetchImpl);
  return planChatEdit(env, body, fetchImpl);
}
