import type { WorkspaceArtifact } from './localWorkspaceArtifacts';

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

/** Read the stable project identity from both direct saves and Canvas handoffs. */
export const getVideoProjectCodeFromArtifact = (
  artifact: Pick<WorkspaceArtifact, 'metadata'>,
): string => {
  const metadata = asRecord(artifact.metadata);
  if (!metadata) return '';
  const candidates: unknown[] = [
    metadata.videoProjectCode,
    asRecord(metadata.inputs)?.videoProjectCode,
    asRecord(metadata.plan)?.videoProjectCode,
    asRecord(metadata.preview)?.videoProjectCode,
  ];
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()))?.trim() ?? '';
};

/**
 * Match a video draft to the current project before rehydrating editor state.
 *
 * New artifacts carry the stable `videoProjectCode`; the draft id is only a
 * compatibility fallback for older local artifacts that predate that field.
 * This prevents a route change from reusing the previous project's editor
 * state merely because React retained the draft-id state across the route.
 */
export const matchesVideoProjectArtifact = (
  artifact: Pick<WorkspaceArtifact, 'id' | 'featureType' | 'metadata'>,
  projectCode: string,
  draftArtifactId?: string,
) => {
  if (artifact.featureType !== 'video-workstation') return false;

  const normalizedProjectCode = projectCode.trim();
  const storedProjectCode = getVideoProjectCodeFromArtifact(artifact);

  if (storedProjectCode) {
    return Boolean(normalizedProjectCode) && storedProjectCode === normalizedProjectCode;
  }

  const normalizedDraftId = draftArtifactId?.trim() ?? '';
  return Boolean(normalizedDraftId) && artifact.id === normalizedDraftId;
};

/**
 * Rehydrate a saved source image without overwriting a user's later choice.
 * Existing Light-compatible project routes start with a reference placeholder,
 * so that placeholder is the only non-empty value eligible for replacement.
 */
export const shouldHydrateVideoSourceImage = (
  currentImageUrl: string,
  savedImageUrl: string,
  defaultProjectImageUrl: string,
) => {
  const saved = savedImageUrl.trim();
  if (!saved) return false;
  const current = currentImageUrl.trim();
  return !current || current === defaultProjectImageUrl.trim();
};

/** The workspace API stores only PNG/JPEG/WebP/GIF data URLs as the artifact image. */
export const isRasterDataUrl = (url: string | null | undefined): url is string => (
  typeof url === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(url)
);

/**
 * Metadata travels with the remote save, which caps it at 128 KB. Keep short
 * URLs and small previews; drop large inline images (the artifact image holds the source).
 */
export const compactVideoMetadataImage = (url: string | null | undefined, limit = 32_000): string => {
  if (typeof url !== 'string' || !url || url.startsWith('blob:')) return '';
  return !url.startsWith('data:') || url.length <= limit ? url : '';
};

/** Turn the editor's source image into a raster data URL the workspace API accepts. */
export const rasterSourceDataUrl = async (
  url: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<string | null> => {
  if (!url) return null;
  if (isRasterDataUrl(url)) return url;
  try {
    const response = await fetcher(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(blob.type)) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return `data:${blob.type.toLowerCase()};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
};
