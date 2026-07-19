export const PRINT_DESIGN_ASSET_PURPOSE = 'print-design' as const;

export type PrintDesignAssetPurpose = typeof PRINT_DESIGN_ASSET_PURPOSE;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export const hasPrintDesignAssetPurpose = (metadata: unknown): boolean => (
  isRecord(metadata) && metadata.assetPurpose === PRINT_DESIGN_ASSET_PURPOSE
);
