type JsonRecord = Record<string, unknown>;

export const PRINT_DESIGN_ASSET_PURPOSE = 'print-design' as const;

const isRecord = (value: unknown): value is JsonRecord => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export const sanitizePrintDesignAssetPurpose = (sourceMetadata: unknown) => {
  if (!isRecord(sourceMetadata)) return null;
  if (sourceMetadata.sourceWorkspace !== 'patterns') return null;
  if (sourceMetadata.workflowVersion !== 'pattern-preview-local-v1') return null;
  if (sourceMetadata.sourceLabel !== '柄・グラフィック') return null;
  if (sourceMetadata.sourceResumePath !== '/patterns/workbench') return null;
  if (sourceMetadata.sourceMode !== 'local-workflow-intake') return null;

  const generationIntent = sourceMetadata.generationIntent;
  if (!isRecord(generationIntent) || generationIntent.feature !== 'design-gacha') return null;

  return { assetPurpose: PRINT_DESIGN_ASSET_PURPOSE } as const;
};
