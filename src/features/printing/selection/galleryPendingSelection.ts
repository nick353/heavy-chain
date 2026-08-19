import { classifyGeneratedImageReference } from '../../../lib/storagePathSafety.ts';

export interface GalleryPendingImage {
  id: string;
  image_url?: string | null;
  storage_path: string;
}

export interface ResolvedGalleryPendingSelection<T extends GalleryPendingImage> {
  image: T;
  imageUrl: string;
}

export const getGalleryPendingImageUrl = (image: GalleryPendingImage): string => {
  const imageUrl = image.image_url?.trim() ?? '';
  if (imageUrl) return imageUrl;

  const storagePath = image.storage_path.trim();
  return /^(https?:|data:)/.test(storagePath) ? storagePath : '';
};

/**
 * Preserve the durable storage identity when a Gallery row has been hydrated
 * with a signed display URL. Older rows can carry the signed URL in
 * `storage_path`, so inspect both fields before falling back to the original
 * value. URL-only assets intentionally remain URL-only and still fail closed
 * at durable persistence time.
 */
export const getGallerySelectionStoragePath = (image: GalleryPendingImage): string | undefined => {
  for (const reference of [image.storage_path, image.image_url]) {
    const canonicalPath = classifyGeneratedImageReference(reference).canonicalPath;
    if (canonicalPath) return canonicalPath;
  }

  const fallback = image.storage_path.trim();
  return fallback || undefined;
};

export const resolveGalleryPendingSelection = <T extends GalleryPendingImage>(
  images: readonly T[],
  pendingImageId: string | null | undefined,
): ResolvedGalleryPendingSelection<T> | null => {
  const normalizedId = pendingImageId?.trim() ?? '';
  if (!normalizedId) return null;

  const image = images.find((candidate) => candidate.id === normalizedId);
  if (!image) return null;

  const imageUrl = getGalleryPendingImageUrl(image);
  return imageUrl ? { image, imageUrl } : null;
};
