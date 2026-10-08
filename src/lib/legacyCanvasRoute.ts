/**
 * Old "Canvasで編集" links now open Light's design detail: a saved image opens as its own Canvas project
 * (/canvas/new?galleryImageId), a browser-only artifact is attached as a reference (sourceArtifactId), and
 * /canvas/:projectId opens that saved document.
 */
export const DESIGN_OPEN_IMAGE_PARAM = 'openImageId';
export const DESIGN_ATTACH_GALLERY_PARAM = 'attachImageId';
export const DESIGN_ATTACH_ARTIFACT_PARAM = 'attachArtifactId';

export function designDetailHrefForLegacyCanvas(projectId: string | undefined, search: string, detailPath = '/designProduction/detail') {
  const legacy = new URLSearchParams(search);
  const next = new URLSearchParams();
  if (projectId && projectId !== 'new') next.set('projectId', projectId);
  const galleryImageId = legacy.get('galleryImageId');
  const artifactId = legacy.get('sourceArtifactId');
  if (!next.has('projectId') && galleryImageId) next.set(DESIGN_OPEN_IMAGE_PARAM, galleryImageId);
  else if (!next.has('projectId') && artifactId) next.set(DESIGN_ATTACH_ARTIFACT_PARAM, artifactId);
  const query = next.toString();
  return query ? `${detailPath}?${query}` : detailPath;
}

export const designImageProjectHref = (imageId: string, detailPath = '/designProduction/detail') =>
  `${detailPath}?${new URLSearchParams({ [DESIGN_OPEN_IMAGE_PARAM]: imageId })}`;
