/**
 * Old "Canvasで編集" links (/canvas/new?galleryImageId|sourceArtifactId) now open Light's design detail with the
 * image attached as a reference. /canvas/:projectId opens the same saved document there.
 */
export const DESIGN_ATTACH_GALLERY_PARAM = 'attachImageId';
export const DESIGN_ATTACH_ARTIFACT_PARAM = 'attachArtifactId';

export function designDetailHrefForLegacyCanvas(projectId: string | undefined, search: string, detailPath = '/designProduction/detail') {
  const legacy = new URLSearchParams(search);
  const next = new URLSearchParams();
  if (projectId && projectId !== 'new') next.set('projectId', projectId);
  const galleryImageId = legacy.get('galleryImageId');
  const artifactId = legacy.get('sourceArtifactId');
  if (!next.has('projectId') && galleryImageId) next.set(DESIGN_ATTACH_GALLERY_PARAM, galleryImageId);
  else if (!next.has('projectId') && artifactId) next.set(DESIGN_ATTACH_ARTIFACT_PARAM, artifactId);
  const query = next.toString();
  return query ? `${detailPath}?${query}` : detailPath;
}
