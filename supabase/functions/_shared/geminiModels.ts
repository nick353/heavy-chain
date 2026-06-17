const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_GEMINI_ANALYSIS_MODEL = 'gemini-2.5-flash';

function configuredModel(envName: string, fallback: string): string {
  const configured = Deno.env.get(envName)?.trim();
  return configured || fallback;
}

export function geminiImageModel(): string {
  return configuredModel('GEMINI_IMAGE_MODEL', DEFAULT_GEMINI_IMAGE_MODEL);
}

export function geminiAnalysisModel(): string {
  return configuredModel('GEMINI_ANALYSIS_MODEL', DEFAULT_GEMINI_ANALYSIS_MODEL);
}

export function geminiGenerateContentUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}
