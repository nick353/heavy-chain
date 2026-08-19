import { getFeatureParityMapping } from './featureParityMapping.ts';
import type { ProductCatalogObjectId } from './parityContract.ts';

/** Route projection of the Heavy product catalog, kept free of React imports. */
export const HEAVY_PRODUCT_ROUTE_BY_FEATURE_ID: Readonly<Record<ProductCatalogObjectId, string>> = Object.freeze({
  'marketing-workspace': '/marketing',
  'virtual-fitting': '/fitting',
  'wear-design-lab': '/lab',
  'video-workstation': '/video',
  'model-library': '/model-library/model-custom-form',
  'fashion-studio': '/flow/integration',
  'design-agent': '/agent',
  'heavychain-lab': '/flow/laboratory',
  'inspiration-design': '/creator',
  'fabric-simulation': '/tools/fabric',
  'printing-image': '/tools/printing',
  'lineart-to-real': '/tools/line-draft-to-tile',
  'change-color': '/editor/changeColor',
  'flat-vector': '/tools/svg-convert',
  'custom-style': '/brand/settings',
  'model-change-background': '/flow/integration',
  'model-body-shape': '/model-library/model-custom-form',
  'flat-to-model': '/fitting',
  'graphic-design': '/printing',
  'pattern-vector-pro': '/tools/vector-special',
  'design-arrange': '/editor/pattern',
  'print-design': '/editor/patternDesign',
  'remove-background': '/tools/reactor',
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
