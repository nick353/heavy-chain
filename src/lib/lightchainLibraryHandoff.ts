import type { LightchainFeature } from './lightchainParityCatalog';

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
  const pathname = feature.id === 'ai-fitting' || feature.id === 'ai-fitting-reference'
    ? '/fitting'
    : feature.id === 'fabric-image'
      ? '/tools/fabric'
      : feature.id === 'printing-image'
        ? '/tools/printing'
        : feature.route;
  const params = new URLSearchParams({ libraryArtifactId: artifactId });
  if (feature.id === 'fabric-image') params.set('librarySlot', 'fabric-design');
  if (feature.id === 'printing-image') params.set('librarySlot', 'printing-design');
  return `${pathname}?${params.toString()}`;
}
