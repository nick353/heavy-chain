const DB_NAME = 'heavy-chain-canvas-assets';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const REFERENCE_PREFIX = 'local-canvas-asset://';
const availableAssetKeys = new Set<string>();

type StoredCanvasAsset = {
  key: string;
  blob: Blob;
  createdAt: string;
};

export type LocalCanvasAssetResolution = {
  source: string;
  release: () => void;
};

export const buildLocalCanvasAssetReference = (revision: string) => (
  `${REFERENCE_PREFIX}${encodeURIComponent(revision)}`
);

export const isLocalCanvasAssetReference = (value: unknown): value is string => (
  typeof value === 'string' && value.startsWith(REFERENCE_PREFIX)
);

const referenceKey = (reference: string) => decodeURIComponent(reference.slice(REFERENCE_PREFIX.length));

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('canvas_local_asset_indexeddb_unavailable'));
    return;
  }

  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onerror = () => reject(request.error || new Error('canvas_local_asset_indexeddb_open_failed'));
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'key' });
    }
  };
  request.onsuccess = () => resolve(request.result);
});

export async function putLocalCanvasAsset(revision: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.onerror = () => reject(transaction.error || new Error('canvas_local_asset_write_failed'));
    transaction.oncomplete = () => resolve();
    transaction.objectStore(STORE_NAME).put({
      key: revision,
      blob,
      createdAt: new Date().toISOString(),
    } satisfies StoredCanvasAsset);
  }).finally(() => database.close());

  const stored = await getLocalCanvasAsset(buildLocalCanvasAssetReference(revision));
  if (!stored) throw new Error('canvas_local_asset_write_readback_failed');
  availableAssetKeys.add(revision);
}

export const hasLocalCanvasAsset = (revision: string) => availableAssetKeys.has(revision);

const getLocalCanvasAsset = async (reference: string): Promise<Blob | null> => {
  const database = await openDatabase();
  return new Promise<Blob | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(referenceKey(reference));
    request.onerror = () => reject(request.error || new Error('canvas_local_asset_read_failed'));
    request.onsuccess = () => resolve((request.result as StoredCanvasAsset | undefined)?.blob || null);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('canvas_local_asset_read_failed'));
    };
  });
};

/**
 * Resolve a persisted local-upload reference to a temporary object URL.
 * The caller must release it after the image has finished loading.
 */
export async function resolveLocalCanvasAsset(source: string): Promise<LocalCanvasAssetResolution | null> {
  if (!isLocalCanvasAssetReference(source)) return null;
  const blob = await getLocalCanvasAsset(source);
  if (!blob) throw new Error('canvas_local_asset_missing');
  const objectUrl = URL.createObjectURL(blob);
  return { source: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
}
