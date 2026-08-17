import { getFeatureParityMapping } from './featureParityMapping.ts';
import type { ProductCatalogObjectId } from './parityContract.ts';

/** Route projection of the Heavy product catalog, kept free of React imports. */
export const HEAVY_PRODUCT_ROUTE_BY_FEATURE_ID: Readonly<Record<ProductCatalogObjectId, string>> = Object.freeze({
  'marketing-workspace': '/marketing',
  'virtual-fitting': '/fitting',
  'wear-design-lab': '/lab',
  'video-workstation': '/video',
  'model-library': '/generate?feature=model-matrix',
  'fashion-studio': '/studio',
  'design-agent': '/workflows/design-exploration',
  'heavychain-lab': '/lab',
  'inspiration-design': '/workflows/design-exploration',
  'fabric-simulation': '/lightchain/fabric-image',
  'printing-image': '/lightchain/printing-image',
  'lineart-to-real': '/generate?feature=design-gacha',
  'change-color': '/generate?feature=colorize',
  'flat-vector': '/patterns/workbench',
  'custom-style': '/brand/settings',
  'model-change-background': '/studio',
  'model-body-shape': '/models',
  'flat-to-model': '/fitting',
  'graphic-design': '/patterns/workbench',
  'pattern-vector-pro': '/patterns/workbench',
  'design-arrange': '/generate?feature=generate-variations',
  'print-design': '/patterns/workbench',
  'remove-background': '/generate?feature=remove-bg',
  'upscale-image': '/generate?feature=upscale',
  'image-variations': '/generate?feature=generate-variations',
  'partial-fix': '/generate?feature=chat-edit',
  'canvas-editing': '/canvas/new',
  'case-series-design': '/workflows/design-exploration',
  'case-ec-fusion': '/workflows/ec-product-set',
  'case-sns-video': '/workflows/sns-campaign',
});

/** Resolve a Light source row to the current Heavy catalog route.
 *
 * Pending rows intentionally keep their caller-provided safe fallback. The
 * fallback is a valid Heavy route, but it is not evidence that the workflows
 * are identical.
 */
export function resolveHeavyRouteForRow(rowId: string, fallback: string): string {
  const mapping = getFeatureParityMapping(rowId);
  const mappedRoute = mapping?.productObjectId
    ? HEAVY_PRODUCT_ROUTE_BY_FEATURE_ID[mapping.productObjectId]
    : undefined;
  return mappedRoute ?? fallback;
}
