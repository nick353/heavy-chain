import type { Json } from '../types/database';

const DB_NAME = 'heavy-chain-print-result-assets';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const REFERENCE_PREFIX = 'local-print-result://';
const STORAGE_PREFIX = 'heavy-chain-print-result-history:v2';
const MAX_PERSISTED_RESULTS = 12;

export type PrintResultHistoryScope = { origin: string; userId: string; assertCurrent?: () => void };
export const printResultHistoryScopeKey = (brandId: string, scope: PrintResultHistoryScope): string => {
  if (!brandId || !scope?.userId || !scope.origin || new URL(scope.origin).origin !== scope.origin) {
    throw new Error('print_result_history_scope_invalid');
  }
  return JSON.stringify([scope.origin, scope.userId, brandId]);
};
const pendingWrites = new Map<string, Promise<unknown>>();

type PersistedParityRuntime = Json;

export type PersistedPrintInputLineage = {
  role: 'garment' | 'print-artwork' | 'model-or-design' | 'textile';
  sourceImageId: string | null;
  sourceStoragePath: string | null;
  referenceType: string | null;
};

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
  generationMode?: 'provider' | 'preview';
  backendProvider?: string | null;
  jobId?: string | null;
  persistenceStatus?: string | null;
  artifactId?: string | null;
  inputLineage?: PersistedPrintInputLineage[];
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

const storageKey = (brandId: string, scope: PrintResultHistoryScope) => `${STORAGE_PREFIX}:${printResultHistoryScopeKey(brandId, scope)}`;

export const buildLocalPrintResultAssetReference = (brandId: string, resultId: string, scope: PrintResultHistoryScope) => (
  `${REFERENCE_PREFIX}${encodeURIComponent(JSON.stringify([printResultHistoryScopeKey(brandId, scope), resultId]))}`
);

export const isLocalPrintResultAssetReference = (value: unknown): value is string => (
  typeof value === 'string' && value.startsWith(REFERENCE_PREFIX)
);

const referenceKey = (reference: string) => decodeURIComponent(reference.slice(REFERENCE_PREFIX.length));

const isPersistedPrintInputLineage = (value: unknown): value is PersistedPrintInputLineage => {
  if (!value || typeof value !== 'object') return false;
  const lineage = value as Partial<PersistedPrintInputLineage>;
  return Boolean(
    lineage.role === 'garment'
    || lineage.role === 'print-artwork'
    || lineage.role === 'model-or-design'
    || lineage.role === 'textile'
  ) && (lineage.sourceImageId === null || typeof lineage.sourceImageId === 'string')
    && (lineage.sourceStoragePath === null || typeof lineage.sourceStoragePath === 'string')
    && (lineage.referenceType === null || typeof lineage.referenceType === 'string');
};

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
    && (!result.generationMode || ['provider', 'preview'].includes(result.generationMode))
    && (result.backendProvider === null || result.backendProvider === undefined || typeof result.backendProvider === 'string')
    && (result.jobId === null || result.jobId === undefined || typeof result.jobId === 'string')
    && (result.persistenceStatus === null || result.persistenceStatus === undefined || typeof result.persistenceStatus === 'string')
    && (result.artifactId === null || result.artifactId === undefined || typeof result.artifactId === 'string')
    && (result.inputLineage === undefined || (
      Array.isArray(result.inputLineage) && result.inputLineage.every(isPersistedPrintInputLineage)
    ))
    && (!result.generatedAt || Number.isFinite(result.generatedAt))
    && (!outputSize || (
      Number.isSafeInteger(outputSize.width) && outputSize.width > 0
      && Number.isSafeInteger(outputSize.height) && outputSize.height > 0
    ))
  );
};

const readPersistedMetadata = (brandId: string, scope: PrintResultHistoryScope): PersistedPrintResult[] => {
  if (!isBrowser() || !brandId) return [];
  const raw = window.localStorage.getItem(storageKey(brandId, scope));
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('print_result_history_metadata_invalid');
  return parsed.filter(isPersistedPrintResult).filter(result => result.brandId === brandId
    && result.assetRef === buildLocalPrintResultAssetReference(brandId, result.id, scope)).slice(0, MAX_PERSISTED_RESULTS);
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

export async function restorePrintResultHistory(brandId: string, scope: PrintResultHistoryScope): Promise<RestoredPrintResult[]> {
  printResultHistoryScopeKey(brandId, scope);
  scope.assertCurrent?.();
  const metadata = readPersistedMetadata(brandId, scope);
  const restored: RestoredPrintResult[] = [];
  try {
  for (const result of metadata) {
    const blob = await getAsset(result.assetRef);
    scope.assertCurrent?.();
    if (!blob) continue;
    restored.push({
      ...result,
      imageUrl: URL.createObjectURL(blob),
    });
  }
  return restored;
  } catch (error) {
    restored.forEach(releaseRestoredPrintResult);
    throw error;
  }
}

export async function persistPrintResultHistory(
  brandId: string,
  results: readonly PersistablePrintResult[],
  scope: PrintResultHistoryScope,
): Promise<{ assetRefs: Record<string, string> }> {
  const key = printResultHistoryScopeKey(brandId, scope);
  scope.assertCurrent?.();
  const previousWrite = pendingWrites.get(key) ?? Promise.resolve();
  const write = previousWrite.catch(() => {}).then(() => persistScopedHistory(brandId, results, scope));
  pendingWrites.set(key, write);
  try { return await write; }
  finally { if (pendingWrites.get(key) === write) pendingWrites.delete(key); }
}

async function persistScopedHistory(brandId: string, results: readonly PersistablePrintResult[], scope: PrintResultHistoryScope) {
  scope.assertCurrent?.();
  if (!isBrowser() || !brandId) throw new Error('print_result_history_storage_unavailable');
  const nextResults = results
    .filter((result) => result.brandId === brandId && result.id.startsWith('print-'))
    .slice(0, MAX_PERSISTED_RESULTS);
  const previous = readPersistedMetadata(brandId, scope);
  const assetRefs: Record<string, string> = {};
  const assets: StoredPrintResultAsset[] = [];
  const metadata: PersistedPrintResult[] = [];

  for (const result of nextResults) {
    const assetRef = buildLocalPrintResultAssetReference(brandId, result.id, scope);
    if (result.assetRef && result.assetRef !== assetRef) throw new Error('print_result_history_foreign_reference');
    assetRefs[result.id] = assetRef;
    if (result.assetRef) {
      if (!(await getAsset(assetRef))) throw new Error('print_result_history_asset_missing');
      scope.assertCurrent?.();
    } else {
      const blob = await dataUrlToBlob(result.imageUrl);
      scope.assertCurrent?.();
      assets.push({
        key: referenceKey(assetRef),
        blob,
        createdAt: new Date().toISOString(),
      });
    }
    const { imageUrl: _imageUrl, assetRef: _assetRef, ...safeResult } = result;
    metadata.push({ ...safeResult, assetRef });
  }

  if (assets.length) await putAssets(assets);
  scope.assertCurrent?.();
  try {
    const serialized = JSON.stringify(metadata);
    window.localStorage.setItem(storageKey(brandId, scope), serialized);
    if (window.localStorage.getItem(storageKey(brandId, scope)) !== serialized) throw new Error('print_result_history_metadata_readback_failed');
  } catch (error) {
    throw error instanceof Error ? error : new Error('print_result_history_metadata_write_failed');
  }

  const nextKeys = new Set(metadata.map((result) => referenceKey(result.assetRef)));
  const staleKeys = previous
    .map((result) => referenceKey(result.assetRef))
    .filter((key) => !nextKeys.has(key));
  scope.assertCurrent?.();
  await deleteAssets(staleKeys);
  scope.assertCurrent?.();
  return { assetRefs };
}

export const releaseRestoredPrintResult = (result: RestoredPrintResult) => {
  if (result.imageUrl.startsWith('blob:')) URL.revokeObjectURL(result.imageUrl);
};
