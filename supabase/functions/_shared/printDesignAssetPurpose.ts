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

export const buildPrintDesignAssetPrompt = ({
  description,
  directionPrompt,
  hasReference,
}: {
  description: string;
  directionPrompt: string;
  hasReference: boolean;
}) => `Create one isolated print-ready graphic asset based on this brief:

${description}

Style direction: ${directionPrompt}.

STRICT OUTPUT CONTRACT:
1. Output exactly one self-contained compact motif or emblem, centered and fully visible.
2. NO CLOTHING, T-shirt, hoodie, dress, fabric product, person, mannequin, product mockup, room, or scene.
3. Use a flat, uniform pure white (#FFFFFF) background reaching every image edge and corner so it can be removed deterministically.
4. Do not create a repeating pattern, seamless tile, all-over print, tiled grid, or rows/columns of repeated elements.
5. Keep every artwork pixel, shape, and stroke entirely inside the composition; no artwork may cross the composition boundary or be cropped, clipped, cut off, or bleed beyond it.
6. Leave a generous, clearly visible pure-white margin between every artwork pixel and every one of the four image edges.
7. Use crisp print-design edges and a compact composition suitable for placement on a garment.
8. Do not add presentation shadows, frames, labels, watermarks, or explanatory text.${hasReference
  ? '\n9. Use the reference only as visual motif inspiration. Do not preserve or reproduce any garment or product silhouette from it.'
  : ''}`;
