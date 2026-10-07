export type HeavyGenerationReferenceHandoff = {
  featureId: string;
  dataUrl: string;
  fileName: string;
  createdAt: string;
};

export const HEAVY_GENERATION_REFERENCE_HANDOFF_KEY = 'heavy-generation-reference-handoff-v1';

export const writeHeavyGenerationReferenceHandoff = (handoff: HeavyGenerationReferenceHandoff) => {
  try {
    window.sessionStorage.setItem(HEAVY_GENERATION_REFERENCE_HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    // The receiving page remains usable and asks for a fresh upload when
    // session storage is unavailable or quota-limited.
  }
};

export const readHeavyGenerationReferenceHandoff = (featureId: string): HeavyGenerationReferenceHandoff | null => {
  try {
    const raw = window.sessionStorage.getItem(HEAVY_GENERATION_REFERENCE_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HeavyGenerationReferenceHandoff>;
    if (parsed.featureId !== featureId || typeof parsed.dataUrl !== 'string' || !parsed.dataUrl.startsWith('data:image/')) {
      return null;
    }
    return {
      featureId,
      dataUrl: parsed.dataUrl,
      fileName: typeof parsed.fileName === 'string' && parsed.fileName ? parsed.fileName : 'reference image',
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

export const clearHeavyGenerationReferenceHandoff = () => {
  try {
    window.sessionStorage.removeItem(HEAVY_GENERATION_REFERENCE_HANDOFF_KEY);
  } catch {
    // Best effort only; a mismatched handoff is rejected by the reader.
  }
};
