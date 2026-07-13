type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const sanitizeString = (value: string, key: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (key === 'imageUrl' || key === 'referenceImage') return null;
  const maxLength = 4000;
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength);
};

const sanitizeJsonValue = (value: unknown, key = '', depth = 0): unknown => {
  if (value === null) return null;
  if (typeof value === 'string') return sanitizeString(value, key);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth > 4) return [];
    return value
      .slice(0, 12)
      .map((item) => sanitizeJsonValue(item, key, depth + 1))
      .filter((item) => item !== null && item !== undefined);
  }
  if (isRecord(value)) {
    if (depth > 4) return {};
    const sanitizedRecord = Object.fromEntries(
      Object.entries(value)
        .filter(([entryKey]) => !['imageUrl', 'referenceImage', 'referenceImageHandoff'].includes(entryKey))
        .slice(0, 40)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeJsonValue(entryValue, entryKey, depth + 1)])
        .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined),
    );
    if (typeof value.imageUrl === 'string' && value.imageUrl.trim()) {
      sanitizedRecord.hasImage = true;
    }
    return sanitizedRecord;
  }
  return null;
};

export const sanitizeMaterialGenerationMetadata = (value: unknown): JsonRecord | null => {
  if (!isRecord(value)) return null;

  const materialReferences = Array.isArray(value.materialReferences)
    ? sanitizeJsonValue(value.materialReferences, 'materialReferences')
    : null;
  const layerPlan = isRecord(value.layerPlan) ? sanitizeJsonValue(value.layerPlan, 'layerPlan') : null;
  const maskPlan = isRecord(value.maskPlan) ? sanitizeJsonValue(value.maskPlan, 'maskPlan') : null;
  const compositionPreview = isRecord(value.compositionPreview)
    ? sanitizeJsonValue(value.compositionPreview, 'compositionPreview')
    : null;

  const metadata = {
    ...(Array.isArray(materialReferences) && materialReferences.length ? { materialReferences } : {}),
    ...(isRecord(layerPlan) && Object.keys(layerPlan).length ? { layerPlan } : {}),
    ...(isRecord(maskPlan) && Object.keys(maskPlan).length ? { maskPlan } : {}),
    ...(isRecord(compositionPreview) && Object.keys(compositionPreview).length ? { compositionPreview } : {}),
  };

  return Object.keys(metadata).length ? metadata : null;
};

export const sanitizeMetadataWithoutImageUrls = (value: unknown): JsonRecord => {
  const sanitized = sanitizeJsonValue(value);
  return isRecord(sanitized) ? sanitized : {};
};
