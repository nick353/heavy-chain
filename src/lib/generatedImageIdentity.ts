import { classifyGeneratedImageReference, normalizeGeneratedImageStoragePath } from './storagePathSafety.ts';
import type { GeneratedImage, Json } from '../types/database';

type GeneratedImageIdentityCarrier = Pick<GeneratedImage, 'id' | 'storage_path'> & Partial<Pick<GeneratedImage, 'user_id' | 'image_url'>> & {
  metadata?: Json | null;
};

export const shouldClearWorkspaceArtifactImageUrl = (
  imageUrl: string,
  hasCanonicalRemotePath: boolean,
): boolean => hasCanonicalRemotePath && /^(?:https?:|\/\/)/i.test(imageUrl.trim());

const REMOTE_IMAGE_ID_KEYS = [
  'remoteImageId',
  'sourceImageId',
  'backendImageId',
] as const;

const REMOTE_STORAGE_PATH_KEYS = [
  'remoteStoragePath',
  'sourceStoragePath',
  'backendStoragePath',
  'storagePath',
] as const;

const readMetadataObject = (metadata: Json | null | undefined): Record<string, Json | undefined> => (
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, Json | undefined>
    : {}
);

const addKey = (keys: Set<string>, prefix: string, value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return;
  keys.add(`${prefix}:${value.trim()}`);
};

/**
 * Return stable identities for a generated image without using signed URLs.
 * Remote rows and their local persistence fallback can therefore be merged
 * even when their visible ids or bearer URLs differ.
 */
export const getGeneratedImageIdentityKeys = (
  image: GeneratedImageIdentityCarrier,
): string[] => {
  const keys = new Set<string>();
  const metadata = readMetadataObject(image.metadata);
  const storageReferences = [image.storage_path, ...REMOTE_STORAGE_PATH_KEYS.map((key) => metadata[key])];

  for (const reference of storageReferences) {
    if (typeof reference !== 'string') continue;
    const classified = classifyGeneratedImageReference(reference);
    const canonicalPath = classified.canonicalPath
      ?? normalizeGeneratedImageStoragePath(reference);
    addKey(keys, 'storage', canonicalPath);
  }

  for (const key of REMOTE_IMAGE_ID_KEYS) addKey(keys, 'image', metadata[key]);
  addKey(keys, 'id', image.id);
  return [...keys];
};

/**
 * Return the URL-safe identity used by Gallery selection and navigation.
 * Prefer a non-local canonical storage identity so a remote row and its local
 * fallback keep the same selected item when the remote query changes shape.
 */
export const getGeneratedImageSelectionKey = (
  image: GeneratedImageIdentityCarrier,
): string => {
  const keys = getGeneratedImageIdentityKeys(image);
  const canonicalStorageKey = keys.find((key) => (
    key.startsWith('storage:') && !key.startsWith('storage:local/')
  ));
  return canonicalStorageKey
    ?? keys.find((key) => key.startsWith('image:'))
    ?? `id:${image.id}`;
};

/**
 * Prefer authoritative remote rows, while retaining local artifacts when the
 * remote query is unavailable. Duplicate rows are identified by canonical
 * storage path or remote image id, never by a signed URL.
 */
export const mergeGeneratedImagesByCanonicalIdentity = (
  remoteImages: GeneratedImage[],
  localImages: GeneratedImage[],
): GeneratedImage[] => {
  const merged: GeneratedImage[] = [];
  const indexByKey = new Map<string, number>();

  const isDisplayable = (image: GeneratedImageIdentityCarrier) => (
    typeof image.image_url === 'string' && image.image_url.trim().length > 0
  );
  const isLocal = (image: GeneratedImageIdentityCarrier) => (
    image.storage_path.startsWith('local/') || image.user_id === 'local-workspace'
  );

  for (const image of [...remoteImages, ...localImages]) {
    const keys = getGeneratedImageIdentityKeys(image);
    const existingIndex = keys
      .map((key) => indexByKey.get(key))
      .find((index): index is number => index !== undefined);

    if (existingIndex !== undefined) {
      const existing = merged[existingIndex];
      const shouldReplace = Boolean(existing)
        && isDisplayable(image)
        && (!isDisplayable(existing) || (isLocal(existing) && !isLocal(image)));
      if (shouldReplace) {
        merged[existingIndex] = image;
        for (const key of keys) indexByKey.set(key, existingIndex);
      }
      continue;
    }

    const nextIndex = merged.length;
    merged.push(image);
    for (const key of keys) indexByKey.set(key, nextIndex);
  }

  return merged;
};
