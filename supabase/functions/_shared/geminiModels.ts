const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_GEMINI_ANALYSIS_MODEL = 'gemini-2.5-flash';

const GEMINI_IMAGE_MODELS = new Set([
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
]);

const IMAGEN_IMAGE_MODELS = new Set([
  'imagen-4.0-fast-generate-001',
  'imagen-4.0-generate-001',
  'imagen-4.0-ultra-generate-001',
  'imagen-3.0-fast-generate-001',
  'imagen-3.0-generate-001',
  'imagen-2.0-generate-001',
]);

function configuredModel(envName: string, fallback: string): string {
  const configured = Deno.env.get(envName)?.trim();
  return configured || fallback;
}

export function geminiImageModel(): string {
  return configuredModel('GEMINI_IMAGE_MODEL', DEFAULT_GEMINI_IMAGE_MODEL);
}

export function resolveGeminiImageModel(requestedModel?: string | null): string {
  const requested = String(requestedModel || '').trim();
  if (GEMINI_IMAGE_MODELS.has(requested) || IMAGEN_IMAGE_MODELS.has(requested)) return requested;
  return geminiImageModel();
}

export function isImagenImageModel(model: string): boolean {
  return IMAGEN_IMAGE_MODELS.has(model);
}

export function geminiAnalysisModel(): string {
  return configuredModel('GEMINI_ANALYSIS_MODEL', DEFAULT_GEMINI_ANALYSIS_MODEL);
}

export function geminiGenerateContentUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

export function imagenPredictUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`;
}
