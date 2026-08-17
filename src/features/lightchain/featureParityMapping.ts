import {
  GOAL_CANDIDATE_ROW_IDS,
  isProductCatalogObjectId,
  type GoalCandidateRowId,
  type ProductCatalogObjectId,
} from './parityContract.ts';

/**
 * Maps the 33 source-comparison rows to the Heavy product catalog without
 * confusing catalog identity with live Light/Heavy parity evidence.
 *
 * `semantic` means the source row and Heavy object represent the same named
 * workflow family, but still require same-input UI/readback evidence.
 * `pending` is intentional where the preserved source does not distinguish
 * competing Heavy objects well enough to make a safe mapping.
 */
export type FeatureParityMappingStatus = 'exact' | 'semantic' | 'pending';

export interface FeatureParityMapping {
  readonly rowId: GoalCandidateRowId;
  readonly productObjectId: ProductCatalogObjectId | null;
  readonly status: FeatureParityMappingStatus;
  readonly sourceBasis: string;
}

const exact = (rowId: GoalCandidateRowId, sourceBasis: string): FeatureParityMapping => ({
  rowId,
  productObjectId: isProductCatalogObjectId(rowId) ? rowId : null,
  status: 'exact',
  sourceBasis,
});

const semantic = (
  rowId: GoalCandidateRowId,
  productObjectId: ProductCatalogObjectId,
  sourceBasis: string,
): FeatureParityMapping => ({ rowId, productObjectId, status: 'semantic', sourceBasis });

const pending = (rowId: GoalCandidateRowId, sourceBasis: string): FeatureParityMapping => ({
  rowId,
  productObjectId: null,
  status: 'pending',
  sourceBasis,
});

export const LIGHTCHAIN_ROW_TO_PRODUCT_MAPPING: Readonly<Record<GoalCandidateRowId, FeatureParityMapping>> = Object.freeze({
  'marketing-home': semantic('marketing-home', 'marketing-workspace', 'Marketing entry and workspace share the marketing feature family.'),
  'marketing-detail': semantic('marketing-detail', 'marketing-workspace', 'Marketing detail is the same workspace workflow at a deeper step.'),
  'ai-fitting': semantic('ai-fitting', 'virtual-fitting', 'AI fitting row maps to the virtual-fitting generation workflow.'),
  'ai-fitting-reference': semantic('ai-fitting-reference', 'virtual-fitting', 'Reference-image fitting remains within the virtual-fitting workflow.'),
  'fitting-clothing-reference': semantic('fitting-clothing-reference', 'flat-to-model', 'Clothing-reference input is the flat-to-model entry contract.'),
  'fitting-background-reference': semantic('fitting-background-reference', 'virtual-fitting', 'Background-reference is an input mode of the virtual-fitting workflow, not the standalone background-change tool.'),
  'wear-design-lab': exact('wear-design-lab', 'Source row and Heavy object use the same feature ID.'),
  'wear-design-detail': semantic('wear-design-detail', 'wear-design-lab', 'Wear-design detail is a deeper step of the same lab.'),
  'video-workstation': exact('video-workstation', 'Source row and Heavy object use the same feature ID.'),
  'video-detail': semantic('video-detail', 'video-workstation', 'Video detail is a deeper step of the same workstation.'),
  'model-library': exact('model-library', 'Source row and Heavy object use the same feature ID.'),
  'fashion-studio': exact('fashion-studio', 'Source row and Heavy object use the same feature ID.'),
  'design-agent': exact('design-agent', 'Source row and Heavy object use the same feature ID.'),
  lab: semantic('lab', 'heavychain-lab', 'The generic lab row maps to Heavy Chain Lab; naming remains a UI-difference surface.'),
  'print-design-project': semantic('print-design-project', 'print-design', 'Project entry is the print-design workflow.'),
  'print-design-detail': semantic('print-design-detail', 'print-design', 'Print-design detail is a deeper step of the same workflow.'),
  'fabric-image': semantic('fabric-image', 'fabric-simulation', 'Fabric-image row maps to the fabric simulation workflow.'),
  'line-generation': semantic('line-generation', 'lineart-to-real', 'Line-generation row maps to line-art-to-real.'),
  'line-to-real': semantic('line-to-real', 'lineart-to-real', 'Line-to-real row maps to line-art-to-real.'),
  'pattern-vector': semantic('pattern-vector', 'flat-vector', 'Pattern-vector row maps to the base vectorization workflow.'),
  'pattern-vector-pro': exact('pattern-vector-pro', 'Source row and Heavy object use the same feature ID.'),
  'printing-image': exact('printing-image', 'Source row and Heavy object use the same feature ID.'),
  'image-repair': semantic('image-repair', 'partial-fix', 'Image-repair row maps to the partial-fix/edit workflow.'),
  'svg-convert': semantic('svg-convert', 'flat-vector', 'SVG conversion is the vectorization workflow.'),
  'model-face': semantic('model-face', 'model-library', 'Face customization is a model-library selection workflow.'),
  'model-change': pending('model-change', 'Preserved evidence does not safely distinguish model-library, fitting, and body-shape semantics.'),
  'body-shape': semantic('body-shape', 'model-body-shape', 'Body-shape row maps to model body/condition selection.'),
  'clothing-size': semantic('clothing-size', 'model-body-shape', 'Clothing-size row maps to model body/condition selection.'),
  'pose-change': semantic('pose-change', 'model-library', 'Pose change is represented by the model planning/library workflow.'),
  'background-change': semantic('background-change', 'model-change-background', 'Background change maps to the model/background workflow.'),
  'angle-change': pending('angle-change', 'Preserved evidence does not safely distinguish pose, studio, and fitting angle workflows.'),
  'model-custom': semantic('model-custom', 'model-library', 'Custom model conditions remain within the model-library workflow.'),
  'custom-style': exact('custom-style', 'Source row and Heavy object use the same feature ID.'),
});

for (const rowId of GOAL_CANDIDATE_ROW_IDS) {
  if (!LIGHTCHAIN_ROW_TO_PRODUCT_MAPPING[rowId]) {
    throw new Error(`feature_parity_mapping_missing:${rowId}`);
  }
}

export function getFeatureParityMapping(rowId: string): FeatureParityMapping | null {
  return (LIGHTCHAIN_ROW_TO_PRODUCT_MAPPING as Record<string, FeatureParityMapping>)[rowId] ?? null;
}

export function getSourceFeatureMappings(productObjectId: string): readonly FeatureParityMapping[] {
  if (!isProductCatalogObjectId(productObjectId)) return Object.freeze([]);
  return Object.freeze(
    GOAL_CANDIDATE_ROW_IDS
      .map((rowId) => LIGHTCHAIN_ROW_TO_PRODUCT_MAPPING[rowId])
      .filter((mapping) => mapping.productObjectId === productObjectId),
  );
}

export function assertFeatureParityMapping(
  rowId: string,
  productObjectId: string,
): FeatureParityMapping {
  const mapping = getFeatureParityMapping(rowId);
  if (!mapping) throw new Error(`parity_feature_mapping_row_unknown:${rowId}`);
  if (!isProductCatalogObjectId(productObjectId)) {
    throw new Error(`parity_feature_mapping_feature_unknown:${productObjectId}`);
  }
  if (mapping.status === 'pending' || mapping.productObjectId === null) {
    throw new Error(`parity_feature_mapping_pending:${rowId}`);
  }
  if (mapping.productObjectId !== productObjectId) {
    throw new Error(`parity_feature_mapping_mismatch:${rowId}:${productObjectId}:${mapping.productObjectId}`);
  }
  return mapping;
}
