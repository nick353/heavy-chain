import type { Json } from '../types/database';

const DB_NAME = 'heavy-chain-print-result-assets';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const REFERENCE_PREFIX = 'local-print-result://';
const STORAGE_PREFIX = 'heavy-chain-print-result-history:v1';
const MAX_PERSISTED_RESULTS = 12;

type PersistedParityRuntime = Json;

export type PersistablePrintResult = {
  id: string;
  brandId: string;
  runId?: string;
  resultKind?: 'exact' | 'fabric' | 'surface' | 'provider';
  generatedAt?: number;
  title: string;
  note: string;
  imageUrl: string;
  outputSize?: { width: number; height: number };
  assetRef?: string;
  parityRuntime?: PersistedParityRuntime;
};

export type RestoredPrintResult = Omit<PersistablePrintResult, 'imageUrl'> & {
  imageUrl: string;
  assetRef: string;
};

type PersistedPrintResult = Omit<RestoredPrintResult, 'imageUrl'>;

type StoredPrintResultAsset = {
  key: string;
  blob: Blob;
  createdAt: string;
};

const isBrowser = () => typeof window !== 'undefined';

const storageKey = (brandId: string) => `${STORAGE_PREFIX}:${brandId}`;

export const buildLocalPrintResultAssetReference = (brandId: string, resultId: string) => (
  `${REFERENCE_PREFIX}${encodeURIComponent(`${brandId}:${resultId}`)}`
);

export const isLocalPrintResultAssetReference = (value: unknown): value is string => (
  typeof value === 'string' && value.startsWith(REFERENCE_PREFIX)
);

const referenceKey = (reference: string) => decodeURIComponent(reference.slice(REFERENCE_PREFIX.length));

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('print_result_history_indexeddb_unavailable'));
    return;
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onerror = () => reject(request.error || new Error('print_result_history_indexeddb_open_failed'));
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'key' });
    }
  };
  request.onsuccess = () => resolve(request.result);
});

const isPersistedPrintResult = (value: unknown): value is PersistedPrintResult => {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<PersistedPrintResult>;
  const outputSize = result.outputSize;
  return Boolean(
    typeof result.id === 'string' && result.id.trim()
    && typeof result.brandId === 'string' && result.brandId.trim()
    && typeof result.title === 'string' && result.title.trim()
    && typeof result.note === 'string'
    && typeof result.assetRef === 'string' && isLocalPrintResultAssetReference(result.assetRef)
    && (!result.runId || typeof result.runId === 'string')
    && (!result.resultKind || ['exact', 'fabric', 'surface', 'provider'].includes(result.resultKind))
    && (!result.generatedAt || Number.isFinite(result.generatedAt))
    && (!outputSize || (
      Number.isSafeInteger(outputSize.width) && outputSize.width > 0
      && Number.isSafeInteger(outputSize.height) && outputSize.height > 0
    ))
  );
};

const readPersistedMetadata = (brandId: string): PersistedPrintResult[] => {
  if (!isBrowser() || !brandId) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(brandId)) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(isPersistedPrintResult).slice(0, MAX_PERSISTED_RESULTS)
      : [];
  } catch {
    return [];
  }
};

const getAsset = async (reference: string): Promise<Blob | null> => {
  const database = await openDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(referenceKey(reference));
      request.onerror = () => reject(request.error || new Error('print_result_history_read_failed'));
      request.onsuccess = () => resolve((request.result as StoredPrintResultAsset | undefined)?.blob || null);
    });
  } finally {
    database.close();
  }
};

const putAssets = async (assets: StoredPrintResultAsset[]) => {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.onerror = () => reject(transaction.error || new Error('print_result_history_write_failed'));
      transaction.oncomplete = () => resolve();
      const store = transaction.objectStore(STORE_NAME);
      assets.forEach((asset) => store.put(asset));
    });
    for (const asset of assets) {
      const assetReference = `${REFERENCE_PREFIX}${encodeURIComponent(asset.key)}`;
      if (!(await getAsset(assetReference))) {
        throw new Error('print_result_history_write_readback_failed');
      }
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
      transaction.onerror = () => reject(transaction.error || new Error('print_result_history_delete_failed'));
      transaction.oncomplete = () => resolve();
      const store = transaction.objectStore(STORE_NAME);
      keys.forEach((key) => store.delete(key));
    });
  } finally {
    database.close();
  }
};

const dataUrlToBlob = async (imageUrl: string): Promise<Blob> => {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error('print_result_history_image_read_failed');
  return response.blob();
};

export async function restorePrintResultHistory(brandId: string): Promise<RestoredPrintResult[]> {
  const metadata = readPersistedMetadata(brandId);
  const restored: RestoredPrintResult[] = [];
  for (const result of metadata) {
    const blob = await getAsset(result.assetRef);
    if (!blob) continue;
    restored.push({
      ...result,
      imageUrl: URL.createObjectURL(blob),
    });
  }
  return restored;
}

export async function persistPrintResultHistory(
  brandId: string,
  results: readonly PersistablePrintResult[],
): Promise<{ assetRefs: Record<string, string> }> {
  if (!isBrowser() || !brandId) throw new Error('print_result_history_storage_unavailable');
  const nextResults = results
    .filter((result) => result.brandId === brandId && result.id.startsWith('print-'))
    .slice(0, MAX_PERSISTED_RESULTS);
  const previous = readPersistedMetadata(brandId);
  const assetRefs: Record<string, string> = {};
  const assets: StoredPrintResultAsset[] = [];
  const metadata: PersistedPrintResult[] = [];

  for (const result of nextResults) {
    const assetRef = isLocalPrintResultAssetReference(result.assetRef)
      ? result.assetRef
      : buildLocalPrintResultAssetReference(brandId, result.id);
    assetRefs[result.id] = assetRef;
    if (!isLocalPrintResultAssetReference(result.assetRef) && !result.imageUrl.startsWith('blob:')) {
      assets.push({
        key: referenceKey(assetRef),
        blob: await dataUrlToBlob(result.imageUrl),
        createdAt: new Date().toISOString(),
      });
    }
    const { imageUrl: _imageUrl, assetRef: _assetRef, ...safeResult } = result;
    metadata.push({ ...safeResult, assetRef });
  }

  if (assets.length) await putAssets(assets);
  try {
    window.localStorage.setItem(storageKey(brandId), JSON.stringify(metadata));
  } catch (error) {
    throw error instanceof Error ? error : new Error('print_result_history_metadata_write_failed');
  }

  const nextKeys = new Set(metadata.map((result) => referenceKey(result.assetRef)));
  const staleKeys = previous
    .map((result) => referenceKey(result.assetRef))
    .filter((key) => !nextKeys.has(key));
  await deleteAssets(staleKeys);
  return { assetRefs };
}

export const releaseRestoredPrintResult = (result: RestoredPrintResult) => {
  if (result.imageUrl.startsWith('blob:')) URL.revokeObjectURL(result.imageUrl);
};
