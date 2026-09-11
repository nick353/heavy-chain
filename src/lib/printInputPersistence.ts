import type { SelectedImage } from '../components/ImageSelector';
import type {
  MaterialCutoutResult,
  PrintGarmentMaskCandidate,
  EncodedManualPrintableSurface,
  PrintDesignSnapshotLayer,
} from './workspaceMaterialReferences';
import type {
  GarmentSegmentationTarget,
  GarmentSelectionSource,
} from '../features/printing/selection/garmentSegmentationPolicy';

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

type PersistedCutoutResult = Omit<MaterialCutoutResult, 'dataUrl'> & {
  dataUrlAssetRef: string;
};

type PersistedMaskCandidate = Omit<PrintGarmentMaskCandidate, 'result'> & {
  result: PersistedCutoutResult;
};

type PersistedProcessedArtifact = {
  dataUrlAssetRef: string;
  result?: PersistedCutoutResult;
  maskRevision?: number;
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
  processed?: PersistedProcessedArtifact;
  maskCandidates?: PersistedMaskCandidate[];
  selectedMaskCandidateId?: string;
  maskExplicitlyConfirmed?: boolean;
  selectionSource?: GarmentSelectionSource;
  segmentationTarget?: GarmentSegmentationTarget;
};

export type RestoredPrintInputImage = Omit<SelectedImage, 'file'> & {
  release?: () => void;
  processedUrl?: string;
  processedResult?: MaterialCutoutResult;
  maskCandidates?: PrintGarmentMaskCandidate[];
  selectedMaskCandidateId?: string;
  maskRevision?: number;
  maskExplicitlyConfirmed?: boolean;
  selectionSource?: GarmentSelectionSource;
  segmentationTarget?: GarmentSegmentationTarget;
};

export type PrintInputProcessedState = {
  garment?: {
    processedUrl?: string | null;
    processedResult?: MaterialCutoutResult | null;
    maskCandidates?: readonly PrintGarmentMaskCandidate[];
    selectedMaskCandidateId?: string;
    maskRevision?: number;
    maskExplicitlyConfirmed?: boolean;
    selectionSource?: GarmentSelectionSource;
    segmentationTarget?: GarmentSegmentationTarget;
  } | null;
  designs: ReadonlyArray<{
    processedUrl?: string | null;
    processedResult?: MaterialCutoutResult | null;
    maskRevision?: number;
  }>;
};

export type RestoredPrintInputState = {
  garment: RestoredPrintInputImage | null;
  designs: RestoredPrintInputImage[];
  editorState?: PrintInputEditorState;
};

export type PrintInputScope = { origin: string; userId: string };
export type PrintInputEditorState = {
  version: 1;
  /** Array order is paint order; designIndex addresses the original input list. */
  layers: Array<{ designIndex: number; layerId: string; transform: PrintDesignSnapshotLayer['transform'] }>;
  coverageMode: 'spot' | 'full';
  outputScale: 1 | 2;
  placementConfirmed: boolean;
  printableSurfaceEnabled: boolean;
  manualPrintableSurface?: EncodedManualPrintableSurface;
};
export type PrintInputPersistenceOptions = {
  scope?: PrintInputScope;
  editorState?: PrintInputEditorState;
  assertContext?: () => void;
  /** Only the explicit Clear control may replace unreadable metadata. */
  replaceUnreadableSnapshot?: boolean;
};
type PersistedPlane = Omit<EncodedManualPrintableSurface['plane'], 'dataUrl'> & { dataUrlAssetRef: string };
type PersistedEditorState = Omit<PrintInputEditorState, 'manualPrintableSurface'> & {
  manualPrintableSurface?: Omit<EncodedManualPrintableSurface, 'plane' | 'occluder'> & {
    plane: PersistedPlane; occluder?: PersistedPlane;
  };
};

export const printInputScopeKey = (brandId: string, scope?: PrintInputScope) => {
  if (!scope) return brandId;
  const origin = new URL(scope.origin);
  if (!brandId || !scope.userId || origin.origin !== scope.origin || origin.username || origin.password
    || (origin.protocol !== 'https:' && !(['localhost', '127.0.0.1'].includes(origin.hostname) && origin.protocol === 'http:'))) {
    throw new Error('print_input_scope_invalid');
  }
  return `v2:${JSON.stringify([scope.origin, scope.userId, brandId])}`;
};

export function validatePrintInputEditorState<T extends PrintInputEditorState | PersistedEditorState>(value: T, designCount: number): T {
  if (!value || value.version !== 1 || !['spot', 'full'].includes(value.coverageMode)
    || ![1, 2].includes(value.outputScale) || typeof value.placementConfirmed !== 'boolean'
    || typeof value.printableSurfaceEnabled !== 'boolean' || !Array.isArray(value.layers)
    || value.layers.length !== designCount || designCount > MAX_DESIGNS
    || new Set(value.layers.map(layer => layer.designIndex)).size !== designCount
    || new Set(value.layers.map(layer => layer.layerId)).size !== designCount
    || value.layers.some(layer => !Number.isSafeInteger(layer.designIndex) || layer.designIndex < 0 || layer.designIndex >= designCount
      || !/^print-design-[1-9]\d{0,8}$/.test(layer.layerId) || !layer.transform
      || !['x', 'y', 'scale', 'rotation', 'opacity'].every(key => Number.isFinite(layer.transform[key as keyof typeof layer.transform]))
      || layer.transform.scale <= 0 || layer.transform.scale > 100
      || layer.transform.opacity < 0 || layer.transform.opacity > 1
      || typeof layer.transform.flipX !== 'boolean' || typeof layer.transform.flipY !== 'boolean')
    || (value.printableSurfaceEnabled && !value.manualPrintableSurface)) {
    throw new Error('print_input_editor_state_invalid');
  }
  return value;
}

const isBrowser = () => typeof window !== 'undefined';

const storageKey = (scopeKey: string) => `${STORAGE_PREFIX}:${scopeKey}`;

const buildAssetReference = (brandId: string, kind: PrintInputKind, index: number) => (
  `${REFERENCE_PREFIX}${encodeURIComponent(`${brandId}:${kind}:${index}`)}`
);

const buildArtifactReference = (
  brandId: string,
  kind: PrintInputKind,
  index: number,
  suffix: string,
) => (
  `${REFERENCE_PREFIX}${encodeURIComponent(`${brandId}:${kind}:${index}:${suffix}`)}`
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
      const originalBytes = new Uint8Array(await asset.blob.arrayBuffer());
      const readback = await getAsset(reference);
      if (!readback || readback.type !== asset.blob.type || readback.size !== asset.blob.size
        || new Uint8Array(await readback.arrayBuffer()).some((byte, index) => byte !== originalBytes[index])) {
        throw new Error('print_input_write_readback_failed');
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

const createStoredAsset = async (reference: string, url: string): Promise<StoredInputAsset> => ({
  key: assetKey(reference),
  blob: await dataUrlToBlob(url),
  createdAt: new Date().toISOString(),
});

const serializeCutoutResult = (
  result: MaterialCutoutResult,
  dataUrlAssetRef: string,
): PersistedCutoutResult => {
  const { dataUrl: _dataUrl, ...metadata } = result;
  return { ...metadata, dataUrlAssetRef };
};

const isLocalImageSource = (url: string) => url.startsWith('data:') || url.startsWith('blob:');

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      resolve(reader.result);
      return;
    }
    reject(new Error('print_input_blob_read_failed'));
  };
  reader.onerror = () => reject(new Error('print_input_blob_read_failed'));
  reader.readAsDataURL(blob);
});

const imageAssetReferences = (entry: PersistedInputImage) => [
  ...(entry.assetRef ? [entry.assetRef] : []),
  ...(entry.processed?.dataUrlAssetRef ? [entry.processed.dataUrlAssetRef] : []),
  ...(entry.processed?.result?.dataUrlAssetRef ? [entry.processed.result.dataUrlAssetRef] : []),
  ...(entry.maskCandidates || []).map((candidate) => candidate.result.dataUrlAssetRef),
];
const editorAssetReferences = (editor?: PersistedEditorState) => [
  ...(editor?.manualPrintableSurface ? [editor.manualPrintableSurface.plane.dataUrlAssetRef] : []),
  ...(editor?.manualPrintableSurface?.occluder ? [editor.manualPrintableSurface.occluder.dataUrlAssetRef] : []),
];

const readMetadata = (scopeKey: string, scoped = false): { images: PersistedInputImage[]; editorState?: PersistedEditorState } => {
  if (!isBrowser() || !scopeKey) return { images: [] };
  try {
    const raw = window.localStorage.getItem(storageKey(scopeKey));
    if (!raw) return { images: [] };
    const parsed = JSON.parse(raw);
    if (scoped && (!parsed || parsed.version !== 2 || parsed.scopeKey !== scopeKey || !Array.isArray(parsed.images))) {
      throw new Error('print_input_scope_mismatch');
    }
    const values: unknown = scoped ? parsed.images : parsed;
    if (!Array.isArray(values)) return { images: [] };
    const images = values.filter((value): value is PersistedInputImage => {
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
    const editorState = scoped && parsed.editorState ? validatePrintInputEditorState<PersistedEditorState>(parsed.editorState,
      images.filter(image => image.kind === 'design').length) : undefined;
    if (scoped) {
      if (images.length !== values.length || new Set(images.map(image => `${image.kind}:${image.index}`)).size !== images.length
        || images.filter(image => image.kind === 'garment').some(image => image.index !== 0)
        || images.filter(image => image.kind === 'design').sort((a, b) => a.index - b.index).some((image, index) => image.index !== index)
        || images.some(image => !image.assetRef || image.source)
        || [...images.flatMap(imageAssetReferences), ...editorAssetReferences(editorState)].some(reference =>
          !isAssetReference(reference) || !assetKey(reference).startsWith(`${scopeKey}:revision:`))) {
        throw new Error('print_input_snapshot_invalid');
      }
    }
    return { images, ...(editorState ? { editorState } : {}) };
  } catch (error) {
    if (scoped) throw error;
    return { images: [] };
  }
};

const metadataForImage = async (
  brandId: string,
  kind: PrintInputKind,
  index: number,
  image: SelectedImage,
  persistRemoteBytes = false,
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

  if (!persistRemoteBytes && !isLocalImageSource(image.url)) {
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
  processedState: PrintInputProcessedState,
  options: PrintInputPersistenceOptions,
) => {
  if (!isBrowser() || !brandId) throw new Error('print_input_storage_unavailable');
  options.assertContext?.();
  const scopeKey = printInputScopeKey(brandId, options.scope);
  let previous: ReturnType<typeof readMetadata>;
  try { previous = readMetadata(scopeKey, Boolean(options.scope)); }
  catch (error) {
    if (!options.replaceUnreadableSnapshot) throw error;
    // Unknown old asset targets are retained, not guessed or bulk-deleted.
    previous = { images: [] };
  }
  // Revision-specific keys leave the previous complete snapshot intact when a
  // fetch, IndexedDB write, context check or localStorage commit fails.
  const assetScope = options.scope ? `${scopeKey}:revision:${crypto.randomUUID()}` : brandId;
  if (options.scope && designs.length > MAX_DESIGNS) throw new Error('print_input_design_limit');
  const images: Array<{ kind: PrintInputKind; index: number; image: SelectedImage }> = [];
  if (garment) images.push({ kind: 'garment', index: 0, image: garment });
  designs.slice(0, MAX_DESIGNS).forEach((image, index) => images.push({ kind: 'design', index, image }));
  const resolved = await Promise.all(images.map(async ({ kind, index, image }) => {
    const source = await metadataForImage(assetScope, kind, index, image, Boolean(options.scope));
    const artifacts = kind === 'garment'
      ? processedState.garment
      : processedState.designs[index];
    const assets: StoredInputAsset[] = source.asset ? [source.asset] : [];
    const metadata: PersistedInputImage = { ...source.metadata };

    const processedUrl = artifacts?.processedUrl || artifacts?.processedResult?.dataUrl;
    const processedResult = artifacts?.processedResult || undefined;
    if (processedUrl) {
      const processedReference = buildArtifactReference(assetScope, kind, index, 'processed');
      assets.push(await createStoredAsset(processedReference, processedUrl));
      metadata.processed = {
        dataUrlAssetRef: processedReference,
        ...(processedResult ? {
          result: serializeCutoutResult(processedResult, processedReference),
        } : {}),
        ...(artifacts?.maskRevision !== undefined ? { maskRevision: artifacts.maskRevision } : {}),
      };
    }

    if (kind === 'garment' && artifacts) {
      const garmentArtifacts = artifacts as NonNullable<PrintInputProcessedState['garment']>;
      const persistedCandidates: PersistedMaskCandidate[] = [];
      for (const candidate of garmentArtifacts.maskCandidates || []) {
        const candidateReference = buildArtifactReference(
          assetScope,
          kind,
          index,
          `candidate:${candidate.candidateId}`,
        );
        assets.push(await createStoredAsset(candidateReference, candidate.result.dataUrl));
        persistedCandidates.push({
          candidateId: candidate.candidateId,
          label: candidate.label,
          description: candidate.description,
          result: serializeCutoutResult(candidate.result, candidateReference),
        });
      }
      if (persistedCandidates.length > 0) metadata.maskCandidates = persistedCandidates;
      if (garmentArtifacts.selectedMaskCandidateId) metadata.selectedMaskCandidateId = garmentArtifacts.selectedMaskCandidateId;
      if (garmentArtifacts.maskExplicitlyConfirmed !== undefined) metadata.maskExplicitlyConfirmed = garmentArtifacts.maskExplicitlyConfirmed;
      if (garmentArtifacts.selectionSource) metadata.selectionSource = garmentArtifacts.selectionSource;
      if (garmentArtifacts.segmentationTarget) metadata.segmentationTarget = garmentArtifacts.segmentationTarget;
    }

    return { metadata, assets };
  }));
  const metadata = resolved.map((entry) => entry.metadata);
  const assets = resolved.flatMap(entry => entry.assets);
  let editorState: PersistedEditorState | undefined;
  if (options.scope && options.editorState) {
    const { manualPrintableSurface, ...state } = validatePrintInputEditorState(options.editorState, designs.length);
    editorState = state;
    if (manualPrintableSurface) {
      const serializePlane = async (plane: EncodedManualPrintableSurface['plane'], suffix: string): Promise<PersistedPlane> => {
        const reference = buildArtifactReference(assetScope, 'garment', 0, suffix);
        assets.push(await createStoredAsset(reference, plane.dataUrl));
        const { dataUrl: _dataUrl, ...planeMetadata } = plane;
        return { ...planeMetadata, dataUrlAssetRef: reference };
      };
      editorState.manualPrintableSurface = {
        provenance: manualPrintableSurface.provenance, identity: { ...manualPrintableSurface.identity },
        plane: await serializePlane(manualPrintableSurface.plane, 'printable'),
        ...(manualPrintableSurface.occluder ? { occluder: await serializePlane(manualPrintableSurface.occluder, 'occluder') } : {}),
      };
    }
  }
  if (options.scope && (assets.some(asset => asset.blob.size > 20 * 1024 * 1024)
    || assets.reduce((sum, asset) => sum + asset.blob.size, 0) > 96 * 1024 * 1024)) throw new Error('print_input_snapshot_too_large');
  let committed = false;
  try {
    options.assertContext?.();
    await putAssets(assets);
    options.assertContext?.();
    const serialized = JSON.stringify(options.scope ? { version: 2, scopeKey, images: metadata, ...(editorState ? { editorState } : {}) } : metadata);
    window.localStorage.setItem(storageKey(scopeKey), serialized);
    committed = true;
    if (window.localStorage.getItem(storageKey(scopeKey)) !== serialized) throw new Error('print_input_metadata_readback_failed');
  } catch (error) {
    // Only this uncommitted revision, never a previous/foreign snapshot.
    if (options.scope && !committed) await deleteAssets(assets.map(asset => asset.key)).catch(() => undefined);
    throw error;
  }
  const nextKeys = new Set([...metadata.flatMap(imageAssetReferences), ...editorAssetReferences(editorState)].map(assetKey));
  const staleKeys = [...previous.images.flatMap(imageAssetReferences), ...editorAssetReferences(previous.editorState)]
    .map(assetKey)
    .filter((key) => !nextKeys.has(key));
  await deleteAssets(staleKeys);
};

export function persistPrintInputState(
  brandId: string,
  garment: SelectedImage | null,
  designs: readonly SelectedImage[],
  processedState: PrintInputProcessedState = { garment: null, designs: [] },
  options: PrintInputPersistenceOptions = {},
): Promise<void> {
  const scopeKey = printInputScopeKey(brandId, options.scope);
  const queued = (persistQueue.get(scopeKey) || Promise.resolve())
    .catch(() => undefined)
    .then(() => persistInputState(brandId, garment, designs, processedState, options));
  persistQueue.set(scopeKey, queued);
  return queued.finally(() => {
    if (persistQueue.get(scopeKey) === queued) persistQueue.delete(scopeKey);
  });
}

export async function restorePrintInputState(brandId: string, options: Pick<PrintInputPersistenceOptions, 'scope' | 'assertContext'> = {}): Promise<RestoredPrintInputState> {
  options.assertContext?.();
  const scopeKey = printInputScopeKey(brandId, options.scope);
  // Never read or adopt brand-only legacy data for a Cloudflare identity.
  const { images: metadata, editorState: persistedEditor } = readMetadata(scopeKey, Boolean(options.scope));
  const restoreAssetDataUrl = async (reference: string): Promise<string | null> => {
    if (!isAssetReference(reference)) return null;
    if (options.scope && !assetKey(reference).startsWith(`${scopeKey}:revision:`)) throw new Error('print_input_scope_mismatch');
    const blob = await getAsset(reference);
    if (!blob && options.scope) throw new Error('print_input_asset_missing');
    return blob ? blobToDataUrl(blob) : null;
  };
  const restoreCutoutResult = async (result: PersistedCutoutResult): Promise<MaterialCutoutResult | null> => {
    const dataUrl = await restoreAssetDataUrl(result.dataUrlAssetRef);
    return dataUrl ? { ...result, dataUrl } : null;
  };
  const restore = async (entry: PersistedInputImage): Promise<RestoredPrintInputImage | null> => {
    let url = entry.source;
    if (entry.assetRef) {
      const blob = await getAsset(entry.assetRef);
      if (!blob) {
        if (options.scope) throw new Error('print_input_asset_missing');
        return null;
      }
      // Normalize persisted local bytes back to the same data-URL boundary
      // used by ImageSelector. This keeps browser cutout/model loaders
      // identical across a fresh upload and a reload, without putting bytes
      // into localStorage.
      url = await blobToDataUrl(blob);
    }
    if (!url) return null;
    const processedUrl = entry.processed
      ? await restoreAssetDataUrl(entry.processed.dataUrlAssetRef)
      : null;
    const processedResult = entry.processed?.result
      ? await restoreCutoutResult(entry.processed.result)
      : null;
    const maskCandidates = entry.maskCandidates
      ? (await Promise.all(entry.maskCandidates.map(async (candidate) => {
          const result = await restoreCutoutResult(candidate.result);
          return result ? { ...candidate, result } : null;
        }))).filter((candidate): candidate is PrintGarmentMaskCandidate => candidate !== null)
      : [];
    const selectedCandidate = maskCandidates.find((candidate) => candidate.candidateId === entry.selectedMaskCandidateId)
      || maskCandidates[0];
    return {
      url,
      referenceType: entry.referenceType,
      ...(entry.fromGallery ? { fromGallery: true } : {}),
      ...(entry.galleryImageId ? { galleryImageId: entry.galleryImageId } : {}),
      ...(entry.storagePath ? { storagePath: entry.storagePath } : {}),
      ...(entry.printDesignAssetPurpose ? { printDesignAssetPurpose: entry.printDesignAssetPurpose } : {}),
      ...(processedUrl ? { processedUrl } : {}),
      ...(processedResult ? { processedResult } : {}),
      ...(maskCandidates.length > 0 ? { maskCandidates } : {}),
      ...(entry.selectedMaskCandidateId ? { selectedMaskCandidateId: entry.selectedMaskCandidateId } : {}),
      ...(entry.processed?.maskRevision !== undefined ? { maskRevision: entry.processed.maskRevision } : {}),
      ...(entry.maskExplicitlyConfirmed !== undefined ? { maskExplicitlyConfirmed: entry.maskExplicitlyConfirmed } : {}),
      ...(entry.selectionSource ? { selectionSource: entry.selectionSource } : {}),
      ...(entry.segmentationTarget ? { segmentationTarget: entry.segmentationTarget } : {}),
      ...(!processedUrl && selectedCandidate ? {
        processedUrl: selectedCandidate.result.dataUrl,
        processedResult: selectedCandidate.result,
      } : {}),
    };
  };
  const restored = await Promise.all(metadata.map(restore));
  let editorState: PrintInputEditorState | undefined;
  if (persistedEditor) {
    const { manualPrintableSurface, ...state } = persistedEditor;
    editorState = state;
    if (manualPrintableSurface) {
      const restorePlane = async (plane: PersistedPlane) => {
        const { dataUrlAssetRef, ...planeMetadata } = plane;
        const dataUrl = await restoreAssetDataUrl(dataUrlAssetRef);
        if (!dataUrl) throw new Error('print_input_surface_missing');
        return { ...planeMetadata, dataUrl };
      };
      editorState.manualPrintableSurface = {
        ...manualPrintableSurface, plane: await restorePlane(manualPrintableSurface.plane),
        ...(manualPrintableSurface.occluder ? { occluder: await restorePlane(manualPrintableSurface.occluder) } : { occluder: undefined }),
      };
    }
  }
  options.assertContext?.();
  return {
    garment: restored.find((image, index) => image && metadata[index]?.kind === 'garment') || null,
    designs: restored
      .map((image, index) => ({ image, metadata: metadata[index] }))
      .filter((entry): entry is { image: RestoredPrintInputImage; metadata: PersistedInputImage } => (
        entry.metadata.kind === 'design' && entry.image !== null
      ))
      .sort((a, b) => a.metadata.index - b.metadata.index)
      .map((entry) => entry.image),
    ...(editorState ? { editorState } : {}),
  };
}

export const releaseRestoredPrintInput = (image: RestoredPrintInputImage | null) => {
  image?.release?.();
};
