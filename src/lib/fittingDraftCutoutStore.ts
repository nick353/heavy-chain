import type { MaterialReferenceState } from './workspaceMaterialReferences';

const DATABASE_NAME = 'heavy-chain-fitting-drafts-v1';
const STORE_NAME = 'cutouts';
const DATABASE_VERSION = 1;

export type FittingDraftCutoutRecord = {
  sourceImageId: string | null;
  sourceStoragePath: string | null;
  extractedImageUrl: string;
  extractedLayerReady: true;
  cutoutBounds: MaterialReferenceState['cutoutBounds'];
  cutoutOutputSize: MaterialReferenceState['cutoutOutputSize'];
  cutoutDataUrlBytes: number | null;
  cutoutMaxDataUrlBytes: number | null;
  cutoutStoragePolicy: MaterialReferenceState['cutoutStoragePolicy'];
  maskEngine: string;
  nextStepReady: true;
  updatedAt: string;
};

const isBrowser = () => (
  typeof window !== 'undefined'
  && typeof window.indexedDB !== 'undefined'
);

const getKey = (brandId: string, scopeId: string) => `${brandId}:${scopeId}`;

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (!isBrowser()) {
    reject(new Error('Fitting draft cutout storage is unavailable.'));
    return;
  }

  const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onerror = () => reject(request.error ?? new Error('Fitting draft cutout storage could not be opened.'));
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'key' });
    }
  };
  request.onsuccess = () => resolve(request.result);
});

const materialHasDurableIdentity = (material: MaterialReferenceState) => (
  Boolean(material.sourceImageId?.trim() || material.sourceStoragePath?.trim())
);

const recordMatchesMaterial = (
  record: FittingDraftCutoutRecord,
  material: MaterialReferenceState,
) => (
  materialHasDurableIdentity(material)
  && Boolean(record.sourceImageId || record.sourceStoragePath)
  && (!record.sourceImageId || record.sourceImageId === material.sourceImageId)
  && (!record.sourceStoragePath || record.sourceStoragePath === material.sourceStoragePath)
);

export const saveFittingDraftCutout = async (
  brandId: string,
  scopeId: string,
  material: MaterialReferenceState,
): Promise<void> => {
  if (!material.nextStepReady || !material.extractedLayerReady || !material.extractedImageUrl) return;
  if (!materialHasDurableIdentity(material)) {
    throw new Error('切り抜き状態を再読込するための素材IDまたは保存先がありません。');
  }
  if (!material.maskEngine || material.maskEngine.startsWith('browser-canvas-')) {
    throw new Error('ブラウザ表示用の切り抜きは永続保存しません。');
  }

  const record: FittingDraftCutoutRecord & { key: string } = {
    key: getKey(brandId, scopeId),
    sourceImageId: material.sourceImageId ?? null,
    sourceStoragePath: material.sourceStoragePath ?? null,
    extractedImageUrl: material.extractedImageUrl,
    extractedLayerReady: true,
    cutoutBounds: material.cutoutBounds ?? null,
    cutoutOutputSize: material.cutoutOutputSize ?? null,
    cutoutDataUrlBytes: material.cutoutDataUrlBytes ?? null,
    cutoutMaxDataUrlBytes: material.cutoutMaxDataUrlBytes ?? null,
    cutoutStoragePolicy: material.cutoutStoragePolicy ?? null,
    maskEngine: material.maskEngine,
    nextStepReady: true,
    updatedAt: new Date().toISOString(),
  };
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.onerror = () => reject(transaction.error ?? new Error('Fitting draft cutout save failed.'));
      transaction.oncomplete = () => resolve();
      transaction.objectStore(STORE_NAME).put(record);
    });
  } finally {
    database.close();
  }
};

export const readFittingDraftCutout = async (
  brandId: string,
  scopeId: string,
  material: MaterialReferenceState,
): Promise<Partial<MaterialReferenceState> | null> => {
  if (!isBrowser() || !materialHasDurableIdentity(material)) return null;
  const database = await openDatabase();
  try {
    const record = await new Promise<(FittingDraftCutoutRecord & { key: string }) | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(getKey(brandId, scopeId));
      request.onerror = () => reject(request.error ?? new Error('Fitting draft cutout read failed.'));
      request.onsuccess = () => resolve(request.result as (FittingDraftCutoutRecord & { key: string }) | undefined);
    });
    if (!record || !recordMatchesMaterial(record, material)) return null;
    return {
      extractedLayerReady: true,
      extractedImageUrl: record.extractedImageUrl,
      cutoutBounds: record.cutoutBounds,
      cutoutOutputSize: record.cutoutOutputSize,
      cutoutDataUrlBytes: record.cutoutDataUrlBytes,
      cutoutMaxDataUrlBytes: record.cutoutMaxDataUrlBytes,
      cutoutStoragePolicy: record.cutoutStoragePolicy,
      maskEngine: record.maskEngine as MaterialReferenceState['maskEngine'],
      nextStepReady: true,
    };
  } finally {
    database.close();
  }
};
