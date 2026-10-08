import { resolveGeneratedImageUrl } from '../../lib/storage';
import { getWorkspaceArtifactCanonicalStoragePath, listWorkspaceArtifacts, listWorkspaceArtifactsForActivity } from '../../lib/localWorkspaceArtifacts';
import { resolveLocalCanvasAsset } from '../../lib/canvasLocalAssets';

export { DESIGN_ATTACH_ARTIFACT_PARAM, DESIGN_ATTACH_GALLERY_PARAM } from '../../lib/legacyCanvasRoute';

const IMAGE_TYPES = /^image\/(png|jpe?g|webp|avif)$/;

async function fileFromSource(source: string, name: string): Promise<File> {
  const local = await resolveLocalCanvasAsset(source);
  try {
    const url = local?.source ?? (/^(https?:|data:|blob:)/i.test(source) ? source : await resolveGeneratedImageUrl(source));
    if (!url) throw new Error('design_attach_source_unavailable');
    const response = await fetch(url);
    if (!response.ok) throw new Error('design_attach_fetch_failed');
    const blob = await response.blob();
    const type = IMAGE_TYPES.test(blob.type) ? blob.type : 'image/png';
    return new File([blob], `${name}.${type.split('/')[1].replace('jpeg', 'jpg')}`, { type });
  } finally {
    local?.release();
  }
}

/** File name (without extension) that identifies one handed-off image, so reopening the same link does not attach it twice. */
export const designAttachmentName = (options: { galleryImageId?: string | null; artifactId?: string | null }) =>
  `library-${(options.galleryImageId ?? options.artifactId ?? 'image').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120)}`;

/** Reads the handed-off image bytes so they can be saved as a dialogue reference. */
export async function resolveDesignAttachment(options: { brandId: string; userId: string; galleryImageId?: string | null; artifactId?: string | null }): Promise<File> {
  if (options.galleryImageId) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(options.galleryImageId)) throw new Error('design_attach_image_invalid');
    return fileFromSource(`generated-images/${options.galleryImageId}`, designAttachmentName(options));
  }
  const artifactId = options.artifactId?.startsWith('id:') ? options.artifactId.slice(3) : options.artifactId;
  if (!artifactId) throw new Error('design_attach_missing');
  const artifact = [...listWorkspaceArtifacts(options.brandId, options.userId), ...listWorkspaceArtifactsForActivity(options.brandId, options.userId)]
    .find((candidate) => candidate.id === artifactId);
  if (!artifact) throw new Error('design_attach_artifact_missing');
  const canonical = getWorkspaceArtifactCanonicalStoragePath(artifact.metadata);
  const sources = [canonical, artifact.imageUrl].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
  let lastError: unknown = new Error('design_attach_source_unavailable');
  for (const source of sources) {
    try { return await fileFromSource(source, designAttachmentName(options)); } catch (error) { lastError = error; }
  }
  throw lastError;
}
