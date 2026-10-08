import type { LightchainFeature } from './lightchainParityCatalog';
import { getLightchainUnifiedRouteAliases } from './lightchainUnifiedFeatureCatalog.ts';

/** The library's 生成履歴 group. Heavy's old /history, /jobs and /gallery screens redirect here, as Light has none of them. */
export const LIBRARY_HISTORY_HREF = `/asset-center?group=${encodeURIComponent('生成履歴')}`;

/** Opens one result in the library (the old Gallery's `?image=` link). Accepts a generated image id or a library artifact id. */
export const libraryImageHref = (imageId: string) => `${LIBRARY_HISTORY_HREF}&image=${encodeURIComponent(imageId)}`;

/**
 * Builds the canonical library-origin URL for any non-video Lightchain
 * feature. The artifact id is deliberately kept in the query so the target
 * workbench can restore the source lineage instead of treating the handoff as
 * a fresh upload.
 */
export function buildLightchainLibraryFeatureHref(
  feature: Pick<LightchainFeature, 'id' | 'route'>,
  artifactId: string,
): string {
  const canonicalRoute = getLightchainUnifiedRouteAliases(feature.id)[0]
    ?? (feature.id === 'ai-fitting' || feature.id === 'ai-fitting-reference'
      ? '/model'
      : feature.id === 'fabric-image'
        ? '/tools/fabric'
        : feature.id === 'printing-image'
          ? '/tools/printing'
          : feature.route);
  const [pathname, query = ''] = canonicalRoute.split('?');
  const params = new URLSearchParams(query);
  params.set('libraryArtifactId', artifactId);
  if (feature.id === 'fabric-image') params.set('librarySlot', 'fabric-design');
  if (feature.id === 'printing-image') params.set('librarySlot', 'printing-design');
  return `${pathname}?${params.toString()}`;
}
