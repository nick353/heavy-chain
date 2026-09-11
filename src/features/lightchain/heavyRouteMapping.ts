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
  'custom-style': '/model-base/style',
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

/**
 * Deep Lightchain entry routes are real feature surfaces, not generic
 * fallbacks. Keep these rows on their canonical Heavy route now that the
 * shared workbench exposes the corresponding detail/input state.
 */
const LIGHTCHAIN_DEEP_ROUTE_BY_ROW: Readonly<Record<string, string>> = Object.freeze({
  'marketing-detail': '/marketing/detail',
  'ai-fitting-reference': '/model?tab=参考図',
  'fitting-clothing-reference': '/model/clothing',
  'fitting-background-reference': '/model/background-reference',
  'wear-design-lab': '/flow/orientedDesign',
  'wear-design-detail': '/flow/orientedDesign/detail',
  'print-design-project': '/editor/patternDesign',
  'print-design-detail': '/editor/patternDesign/detail',
  'line-generation': '/tools/line',
  'pattern-vector': '/tools/pattern-to-vector',
  'model-face': '/model-library/head-form',
  'model-change': '/model-library/model-change-form',
  'body-shape': '/model-library/body-form',
  'clothing-size': '/model-library/size-form',
  'pose-change': '/model-library/pose-form',
  'background-change': '/model-library/background-form',
  'angle-change': '/model-library/perspective-form',
});

/** Resolve a Light source row to the current Heavy catalog route.
 *
 * Pending rows intentionally keep their caller-provided safe fallback. The
 * fallback is a valid Heavy route, but it is not evidence that the workflows
 * are identical.
 */
export function resolveHeavyRouteForRow(rowId: string, fallback: string): string {
  const deepRoute = LIGHTCHAIN_DEEP_ROUTE_BY_ROW[rowId];
  if (deepRoute) return deepRoute;
  const mapping = getFeatureParityMapping(rowId);
  const mappedRoute = mapping?.productObjectId
    ? HEAVY_PRODUCT_ROUTE_BY_FEATURE_ID[mapping.productObjectId]
    : undefined;
  return mappedRoute ?? fallback;
}
