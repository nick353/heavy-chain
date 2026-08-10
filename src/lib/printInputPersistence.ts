import type { SelectedImage } from '../components/ImageSelector';

const DB_NAME = 'heavy-chain-print-input-assets';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const REFERENCE_PREFIX = 'local-print-input://';
const STORAGE_PREFIX = 'heavy-chain-print-inputs:v1';
const MAX_DESIGNS = 6;

type PrintInputKind = 'garment' | 'design';

type StoredInputAsset = {
  key: string;
  blob: Blob;
  createdAt: string;
};

type PersistedInputImage = {
  kind: PrintInputKind;
  index: number;
  referenceType: SelectedImage['referenceType'];
  fromGallery?: boolean;
  galleryImageId?: string;
  storagePath?: string;
  printDesignAssetPurpose?: SelectedImage['printDesignAssetPurpose'];
  source?: string;
  assetRef?: string;
};

export type RestoredPrintInputImage = Omit<SelectedImage, 'file'> & {
  release?: () => void;
};

export type RestoredPrintInputState = {
  garment: RestoredPrintInputImage | null;
  designs: RestoredPrintInputImage[];
};

const isBrowser = () => typeof window !== 'undefined';

const storageKey = (brandId: string) => `${STORAGE_PREFIX}:${brandId}`;

const buildAssetReference = (brandId: string, kind: PrintInputKind, index: number) => (
  `${REFERENCE_PREFIX}${encodeURIComponent(`${brandId}:${kind}:${index}`)}`
);

const isAssetReference = (value: unknown): value is string => (
  typeof value === 'string' && value.startsWith(REFERENCE_PREFIX)
);

const assetKey = (reference: string) => decodeURIComponent(reference.slice(REFERENCE_PREFIX.length));

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('print_input_indexeddb_unavailable'));
    return;
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onerror = () => reject(request.error || new Error('print_input_indexeddb_open_failed'));
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'key' });
    }
  };
  request.onsuccess = () => resolve(request.result);
});

const getAsset = async (reference: string): Promise<Blob | null> => {
  const database = await openDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(assetKey(reference));
      request.onerror = () => reject(request.error || new Error('print_input_read_failed'));
      request.onsuccess = () => resolve((request.result as StoredInputAsset | undefined)?.blob || null);
    });
  } finally {
    database.close();
  }
};

const putAssets = async (assets: StoredInputAsset[]) => {
  if (!assets.length) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.onerror = () => reject(transaction.error || new Error('print_input_write_failed'));
      transaction.oncomplete = () => resolve();
      const store = transaction.objectStore(STORE_NAME);
      assets.forEach((asset) => store.put(asset));
    });
    for (const asset of assets) {
      const reference = `${REFERENCE_PREFIX}${encodeURIComponent(asset.key)}`;
      if (!(await getAsset(reference))) throw new Error('print_input_write_readback_failed');
    }
  } finally {
    database.close();
  }
};

const deleteAssets = async (keys: string[]) => {
  if (!keys.length) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.onerror = () => reject(transaction.error || new Error('print_input_delete_failed'));
      transaction.oncomplete = () => resolve();
      const store = transaction.objectStore(STORE_NAME);
      keys.forEach((key) => store.delete(key));
    });
  } finally {
    database.close();
  }
};

const dataUrlToBlob = async (url: string): Promise<Blob> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('print_input_image_read_failed');
  return response.blob();
};

const isLocalImageSource = (url: string) => url.startsWith('data:') || url.startsWith('blob:');

const readMetadata = (brandId: string): PersistedInputImage[] => {
  if (!isBrowser() || !brandId) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(brandId)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is PersistedInputImage => {
      if (!value || typeof value !== 'object') return false;
      const item = value as Partial<PersistedInputImage>;
      return (
        (item.kind === 'garment' || item.kind === 'design')
        && Number.isSafeInteger(item.index)
        && Number(item.index) >= 0
        && Number(item.index) < MAX_DESIGNS
        && typeof item.referenceType === 'string'
        && (typeof item.source === 'string' || isAssetReference(item.assetRef))
        && (!item.galleryImageId || typeof item.galleryImageId === 'string')
        && (!item.storagePath || typeof item.storagePath === 'string')
      );
    }).slice(0, MAX_DESIGNS + 1);
  } catch {
    return [];
  }
};

const metadataForImage = async (
  brandId: string,
  kind: PrintInputKind,
  index: number,
  image: SelectedImage,
): Promise<{ metadata: PersistedInputImage; asset?: StoredInputAsset }> => {
  const base = {
    kind,
    index,
    referenceType: image.referenceType,
    ...(image.fromGallery ? { fromGallery: true } : {}),
    ...(image.galleryImageId ? { galleryImageId: image.galleryImageId } : {}),
    ...(image.storagePath ? { storagePath: image.storagePath } : {}),
    ...(image.printDesignAssetPurpose ? { printDesignAssetPurpose: image.printDesignAssetPurpose } : {}),
  } satisfies Omit<PersistedInputImage, 'source' | 'assetRef'>;

  if (!isLocalImageSource(image.url)) {
    return { metadata: { ...base, source: image.url } };
  }

  const reference = buildAssetReference(brandId, kind, index);
  const blob = image.file instanceof Blob ? image.file : await dataUrlToBlob(image.url);
  return {
    metadata: { ...base, assetRef: reference },
    asset: {
      key: assetKey(reference),
      blob,
      createdAt: new Date().toISOString(),
    },
  };
};

const persistQueue = new Map<string, Promise<void>>();

const persistInputState = async (
  brandId: string,
  garment: SelectedImage | null,
  designs: readonly SelectedImage[],
) => {
  if (!isBrowser() || !brandId) throw new Error('print_input_storage_unavailable');
  const previous = readMetadata(brandId);
  const images: Array<{ kind: PrintInputKind; index: number; image: SelectedImage }> = [];
  if (garment) images.push({ kind: 'garment', index: 0, image: garment });
  designs.slice(0, MAX_DESIGNS).forEach((image, index) => images.push({ kind: 'design', index, image }));
  const resolved = await Promise.all(images.map(({ kind, index, image }) => metadataForImage(brandId, kind, index, image)));
  const metadata = resolved.map((entry) => entry.metadata);
  await putAssets(resolved.flatMap((entry) => entry.asset ? [entry.asset] : []));
  window.localStorage.setItem(storageKey(brandId), JSON.stringify(metadata));
  const nextKeys = new Set(metadata.flatMap((entry) => entry.assetRef ? [assetKey(entry.assetRef)] : []));
  const staleKeys = previous
    .flatMap((entry) => entry.assetRef ? [assetKey(entry.assetRef)] : [])
    .filter((key) => !nextKeys.has(key));
  await deleteAssets(staleKeys);
};

export function persistPrintInputState(
  brandId: string,
  garment: SelectedImage | null,
  designs: readonly SelectedImage[],
): Promise<void> {
  const queued = (persistQueue.get(brandId) || Promise.resolve())
    .catch(() => undefined)
    .then(() => persistInputState(brandId, garment, designs));
  persistQueue.set(brandId, queued);
  return queued.finally(() => {
    if (persistQueue.get(brandId) === queued) persistQueue.delete(brandId);
  });
}

export async function restorePrintInputState(brandId: string): Promise<RestoredPrintInputState> {
  const metadata = readMetadata(brandId);
  const restore = async (entry: PersistedInputImage): Promise<RestoredPrintInputImage | null> => {
    let url = entry.source;
    let release: (() => void) | undefined;
    if (entry.assetRef) {
      const blob = await getAsset(entry.assetRef);
      if (!blob) return null;
      url = URL.createObjectURL(blob);
      release = () => URL.revokeObjectURL(url as string);
    }
    if (!url) return null;
    return {
      url,
      referenceType: entry.referenceType,
      ...(entry.fromGallery ? { fromGallery: true } : {}),
      ...(entry.galleryImageId ? { galleryImageId: entry.galleryImageId } : {}),
      ...(entry.storagePath ? { storagePath: entry.storagePath } : {}),
      ...(entry.printDesignAssetPurpose ? { printDesignAssetPurpose: entry.printDesignAssetPurpose } : {}),
      ...(release ? { release } : {}),
    };
  };
  const restored = await Promise.all(metadata.map(restore));
  return {
    garment: restored.find((image, index) => image && metadata[index]?.kind === 'garment') || null,
    designs: restored
      .map((image, index) => ({ image, metadata: metadata[index] }))
      .filter((entry): entry is { image: RestoredPrintInputImage; metadata: PersistedInputImage } => (
        entry.metadata.kind === 'design' && entry.image !== null
      ))
      .sort((a, b) => a.metadata.index - b.metadata.index)
      .map((entry) => entry.image),
  };
}

export const releaseRestoredPrintInput = (image: RestoredPrintInputImage | null) => {
  image?.release?.();
};

