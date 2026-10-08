/**
 * AI model choices from the settings screen, kept per user in this browser.
 * Requests carry the choice; the API uses it only when it is one of its registered models.
 */
export type AIModelPreference = { imageModel?: string; textModel?: string };

const storageKey = (userId: string) => `heavy:ai-models:v1:${userId}`;
let activeUserId: string | null = null;

export const setAIModelUser = (userId: string | null | undefined) => { activeUserId = userId || null; };

export const readAIModelPreference = (userId: string | null | undefined = activeUserId): AIModelPreference => {
  if (!userId) return {};
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(storageKey(userId)) ?? '{}') as Record<string, unknown>;
    return {
      ...(typeof parsed.imageModel === 'string' && parsed.imageModel ? { imageModel: parsed.imageModel } : {}),
      ...(typeof parsed.textModel === 'string' && parsed.textModel ? { textModel: parsed.textModel } : {}),
    };
  } catch { return {}; }
};

export const writeAIModelPreference = (userId: string | null | undefined, preference: AIModelPreference) => {
  if (!userId) return;
  try { globalThis.localStorage?.setItem(storageKey(userId), JSON.stringify(preference)); } catch { /* storage unavailable */ }
};

export const CLAUDE_TEXT_ACTIONS = new Set(['optimize-prompt', 'chat-plan', 'image-plan']);
const IMAGE_ACTIONS = new Set(['generate-image', 'edit-image', 'model-matrix']);

/**
 * Adds the chosen model to an AI request body. The settings choice replaces a tool's built-in model (providerModel);
 * only a model picked explicitly on the generate screen (generationModel) wins over it.
 */
export const withAIModelPreference = (action: string, body: Record<string, unknown>, preference = readAIModelPreference()): Record<string, unknown> => {
  if (IMAGE_ACTIONS.has(action) && preference.imageModel && body.preferredImageModel === undefined && body.generationModel === undefined) {
    const { providerModel: _builtIn, ...rest } = body;
    void _builtIn;
    return { ...rest, preferredImageModel: preference.imageModel };
  }
  if (CLAUDE_TEXT_ACTIONS.has(action) && preference.textModel && body.textModel === undefined) {
    return { ...body, textModel: preference.textModel };
  }
  return body;
};
