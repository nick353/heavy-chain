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
