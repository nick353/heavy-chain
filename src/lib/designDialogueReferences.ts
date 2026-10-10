import { WORKSPACE_UPLOAD_MAX_BYTES } from './workspaceUploadLimits.ts';
import type { cloudflareDataPlane } from './cloudflareApi.ts';

type CloudflareDataPlane = NonNullable<typeof cloudflareDataPlane>;
export type DesignDialogueReferenceClient = Pick<CloudflareDataPlane,
  'captureArtifactPersistenceContext' | 'saveWorkspaceArtifact' | 'readWorkspaceArtifact'>;
export type DesignDialoguePersistenceContext = Awaited<ReturnType<CloudflareDataPlane['captureArtifactPersistenceContext']>>;
export type DesignDialogueReferenceScope = {
  userId: string;
  brandId: string;
  selectionId: string;
  generation: number;
};
export type DesignDialogueReferenceKind = 'upload' | 'scene-asset';
export type DesignDialogueManifestReference = {
  order: number;
  kind: DesignDialogueReferenceKind;
  imageId: string;
  storagePath: string;
  name: string;
  sceneAssetKey?: string;
};
export type DesignDialogueReferenceStatus = 'pending' | 'saving' | 'recovering' | 'ready' | 'failure';
export type DesignDialogueReferenceView = {
  id: string;
  requestId: string;
  kind: DesignDialogueReferenceKind;
  name: string;
  sceneAssetKey?: string;
  status: DesignDialogueReferenceStatus;
  error?: string;
  receipt?: { jobId: string; imageId: string; storagePath: string };
};
export type DesignDialogueReferenceState = {
  scopeKey: string;
  references: DesignDialogueReferenceView[];
  ready: boolean;
};
export type DesignDialogueReferenceFile = Blob & { name: string };
export type DesignDialogueReferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type DesignDialogueSceneByteLoader = (
  sceneAssetKey: string,
  context: { assertCurrent(): void },
) => Promise<Blob>;

const readBoundedSceneResponse = async (
  response: Response,
  mimeType: string,
  assertCurrent: () => void,
): Promise<Blob> => {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('design_dialogue_scene_asset_body_missing');
  const chunks: BlobPart[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      assertCurrent();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > WORKSPACE_UPLOAD_MAX_BYTES) throw new Error('workspace_image_too_large');
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      chunks.push(copy.buffer);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  assertCurrent();
  if (totalBytes <= 0) throw new Error('design_dialogue_scene_asset_size_invalid');
  return new Blob(chunks, { type: mimeType });
};

/** Loads only a named, locally bundled scene asset; never accepts arbitrary URLs. */
export const createSameOriginDesignSceneAssetLoader = (
  fetchImpl: typeof fetch = globalThis.fetch,
): DesignDialogueSceneByteLoader => async (sceneAssetKey, context) => {
  if (!safeSceneAssetKey(sceneAssetKey)) throw new Error('design_dialogue_scene_asset_key_invalid');
  if (typeof fetchImpl !== 'function') throw new Error('design_dialogue_scene_loader_unavailable');
  context.assertCurrent();
  const response = await fetchImpl(`/scene-assets/${encodeURIComponent(sceneAssetKey)}`, {
    method: 'GET',
    mode: 'same-origin',
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
  context.assertCurrent();
  if (!response.ok || response.status !== 200 || response.redirected) {
    throw new Error('design_dialogue_scene_asset_unavailable');
  }
  const expectedMime = SCENE_ASSET_MIME[sceneAssetKey];
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== expectedMime) throw new Error('design_dialogue_scene_asset_content_type_invalid');
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) throw new Error('design_dialogue_scene_asset_size_invalid');
    const size = Number(contentLength);
    if (!Number.isSafeInteger(size) || size <= 0 || size > WORKSPACE_UPLOAD_MAX_BYTES) {
      throw new Error(size > WORKSPACE_UPLOAD_MAX_BYTES
        ? 'workspace_image_too_large'
        : 'design_dialogue_scene_asset_size_invalid');
    }
  }
  return readBoundedSceneResponse(response, expectedMime, context.assertCurrent);
};

export const DESIGN_DIALOGUE_REFERENCE_LIMIT = 16;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
const CANONICAL_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const STORAGE_KEY_PREFIX = 'heavy:design-dialogue-references:v1:';
const URL_OR_BYTES_SCHEME = /(?:https?:|data:|blob:)/i;
const SCENE_ASSET_MIME: Readonly<Record<string, 'image/jpeg' | 'image/png'>> = Object.freeze({
  'fabric1.jpg': 'image/jpeg',
  'fabric2.jpg': 'image/jpeg',
  'fabric3.jpg': 'image/jpeg',
  'fabric4.jpg': 'image/jpeg',
  'fabric5.png': 'image/png',
  'draft1.png': 'image/png',
  'multi1.jpg': 'image/jpeg',
  'multi2.jpg': 'image/jpeg',
  'print1.png': 'image/png',
  'print2.jpg': 'image/jpeg',
  'fabric.png': 'image/png',
  'draft.png': 'image/png',
  'multi.png': 'image/png',
  'print.png': 'image/png',
  'upload-placeholder.png': 'image/png',
});

type CanonicalReceipt = { jobId: string; imageId: string; storagePath: string };
type InternalReference = DesignDialogueReferenceView & { receipt?: CanonicalReceipt };
type StoredReference = {
  requestId: string;
  kind: DesignDialogueReferenceKind;
  name: string;
  sceneAssetKey?: string;
  receipt?: CanonicalReceipt;
};
type StoredSelection = {
  version: 1;
  scope: Pick<DesignDialogueReferenceScope, 'userId' | 'brandId' | 'selectionId'>;
  references: StoredReference[];
};
type StoredSceneIndex = {
  version: 1;
  scope: Pick<DesignDialogueReferenceScope, 'userId' | 'brandId'>;
  assets: Record<string, string>;
};
type RasterImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif';
type Dependencies = {
  client: DesignDialogueReferenceClient;
  storage: DesignDialogueReferenceStorage;
  getCurrentScope(): DesignDialogueReferenceScope | null;
  loadSceneAsset?: DesignDialogueSceneByteLoader;
  materializeAvifToPng?: (blob: Blob) => Promise<Blob>;
  encodeImage?: (blob: Blob, mimeType: 'image/png' | 'image/jpeg' | 'image/webp') => Promise<string>;
  requestId?: () => string;
  publish?: (state: DesignDialogueReferenceState) => void;
  restoreTimeoutMs?: number;
};

const DESIGN_DIALOGUE_RESTORE_TIMEOUT_MS = 20_000;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const sameScopeIdentity = (
  left: DesignDialogueReferenceScope,
  right: DesignDialogueReferenceScope,
) => left.userId === right.userId && left.brandId === right.brandId && left.selectionId === right.selectionId;

const sameScope = (left: DesignDialogueReferenceScope, right: DesignDialogueReferenceScope) => (
  sameScopeIdentity(left, right) && left.generation === right.generation
);

const validScope = (scope: DesignDialogueReferenceScope): boolean => (
  typeof scope.userId === 'string' && Boolean(scope.userId.trim()) && scope.userId.length <= 128
  && typeof scope.brandId === 'string' && Boolean(scope.brandId.trim()) && scope.brandId.length <= 128
  && typeof scope.selectionId === 'string' && Boolean(scope.selectionId.trim()) && scope.selectionId.length <= 256
  && Number.isSafeInteger(scope.generation) && scope.generation >= 0
  && !/[\u0000-\u001f\u007f]/u.test(scope.userId + scope.brandId + scope.selectionId)
);

const scopeKey = (scope: DesignDialogueReferenceScope) => JSON.stringify([
  scope.userId, scope.brandId, scope.selectionId, scope.generation,
]);

const storageKey = (scope: DesignDialogueReferenceScope) => (
  `${STORAGE_KEY_PREFIX}${encodeURIComponent(JSON.stringify([scope.userId, scope.brandId, scope.selectionId]))}`
);

const sceneIndexStorageKey = (scope: DesignDialogueReferenceScope) => (
  `${STORAGE_KEY_PREFIX}scene-assets:${encodeURIComponent(JSON.stringify([scope.userId, scope.brandId]))}`
);

const safeName = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= 512
  && value.trim() === value
  && !/[\\/\u0000-\u001f\u007f?#]/u.test(value)
  && !URL_OR_BYTES_SCHEME.test(value)
  && value !== '.'
  && value !== '..'
);

const safeSceneAssetKey = (value: unknown): value is string => (
  typeof value === 'string'
  && Object.hasOwn(SCENE_ASSET_MIME, value)
);

const hasExactKeys = (value: Record<string, unknown>, allowed: readonly string[]) => (
  Object.keys(value).every((key) => allowed.includes(key))
);

const expectedReceipt = (requestId: string): CanonicalReceipt => {
  const imageId = `wa-${requestId.toLowerCase()}`;
  return { jobId: imageId, imageId, storagePath: `generated-images/${imageId}` };
};

const validateReceipt = (value: unknown, requestId: string): CanonicalReceipt => {
  const expected = expectedReceipt(requestId);
  if (!isRecord(value) || value.success !== true || !isRecord(value.remote)
    || value.remote.jobId !== expected.jobId
    || value.remote.imageId !== expected.imageId
    || value.remote.storagePath !== expected.storagePath) {
    throw new Error('design_dialogue_reference_receipt_invalid');
  }
  return expected;
};

const validateStoredReceipt = (value: unknown, requestId: string): CanonicalReceipt | null => {
  if (!isRecord(value)) return null;
  const expected = expectedReceipt(requestId);
  return value.jobId === expected.jobId && value.imageId === expected.imageId && value.storagePath === expected.storagePath
    ? expected : null;
};

const storedScopeMatches = (value: unknown, scope: DesignDialogueReferenceScope): value is StoredSelection => (
  isRecord(value)
  && hasExactKeys(value, ['version', 'scope', 'references'])
  && value.version === 1
  && isRecord(value.scope)
  && hasExactKeys(value.scope, ['userId', 'brandId', 'selectionId'])
  && value.scope.userId === scope.userId
  && value.scope.brandId === scope.brandId
  && value.scope.selectionId === scope.selectionId
  && Array.isArray(value.references)
  && value.references.length <= DESIGN_DIALOGUE_REFERENCE_LIMIT
);

const parseStoredReferences = (serialized: string, scope: DesignDialogueReferenceScope): InternalReference[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('design_dialogue_reference_pending_state_invalid');
  }
  if (!noPersistedBytesOrUrls(serialized)) throw new Error('design_dialogue_reference_pending_state_unsafe');
  if (!storedScopeMatches(parsed, scope)) throw new Error('design_dialogue_reference_pending_scope_mismatch');

  const seen = new Set<string>();
  return parsed.references.map((item): InternalReference => {
    if (!isRecord(item)
      || !hasExactKeys(item, ['requestId', 'kind', 'name', 'sceneAssetKey', 'receipt'])
      || !UUID_V4.test(String(item.requestId ?? ''))
      || seen.has(String(item.requestId))
      || (item.kind !== 'upload' && item.kind !== 'scene-asset')
      || !safeName(item.name)
      || (item.kind === 'scene-asset' && !safeSceneAssetKey(item.sceneAssetKey))
      || (item.kind === 'upload' && item.sceneAssetKey !== undefined)) {
      throw new Error('design_dialogue_reference_pending_state_invalid');
    }
    const requestId = item.requestId as string;
    seen.add(requestId);
    if (item.receipt !== undefined && (!isRecord(item.receipt)
      || !hasExactKeys(item.receipt, ['jobId', 'imageId', 'storagePath']))) {
      throw new Error('design_dialogue_reference_pending_state_invalid');
    }
    const receipt = item.receipt === undefined ? undefined : validateStoredReceipt(item.receipt, requestId);
    if (item.receipt !== undefined && !receipt) throw new Error('design_dialogue_reference_pending_state_invalid');
    return {
      id: requestId,
      requestId,
      kind: item.kind,
      name: item.name,
      ...(item.sceneAssetKey === undefined ? {} : { sceneAssetKey: item.sceneAssetKey as string }),
      status: 'pending',
      ...(receipt ? { receipt } : {}),
    };
  });
};

const parseSceneIndex = (serialized: string | null, scope: DesignDialogueReferenceScope): Record<string, string> => {
  if (serialized === null) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); }
  catch { throw new Error('design_dialogue_scene_index_invalid'); }
  if (!noPersistedBytesOrUrls(serialized)) throw new Error('design_dialogue_scene_index_unsafe');
  if (!isRecord(parsed) || !hasExactKeys(parsed, ['version', 'scope', 'assets']) || parsed.version !== 1
    || !isRecord(parsed.scope) || !hasExactKeys(parsed.scope, ['userId', 'brandId'])
    || parsed.scope.userId !== scope.userId || parsed.scope.brandId !== scope.brandId
    || !isRecord(parsed.assets) || Object.keys(parsed.assets).length > Object.keys(SCENE_ASSET_MIME).length) {
    throw new Error('design_dialogue_scene_index_scope_or_shape_invalid');
  }
  const assets: Record<string, string> = {};
  for (const [key, requestId] of Object.entries(parsed.assets)) {
    if (!safeSceneAssetKey(key) || typeof requestId !== 'string' || !UUID_V4.test(requestId)) {
      throw new Error('design_dialogue_scene_index_invalid');
    }
    assets[key] = requestId;
  }
  return assets;
};

const validBlobLike = (value: unknown): value is Blob => (
  typeof value === 'object' && value !== null
  && typeof (value as Blob).size === 'number'
  && typeof (value as Blob).type === 'string'
  && typeof (value as Blob).slice === 'function'
  && typeof (value as Blob).arrayBuffer === 'function'
);

const rasterTypeFromHeader = (header: Uint8Array): RasterImageType | null => {
  const starts = (signature: number[]) => signature.every((value, index) => header[index] === value);
  const ascii = (from: number, to: number) => String.fromCharCode(...header.slice(from, to));
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (starts([255, 216, 255])) return 'image/jpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  return null;
};

const inspectRaster = async (blob: Blob, declaredType?: string): Promise<RasterImageType> => {
  if (!validBlobLike(blob) || !Number.isSafeInteger(blob.size) || blob.size <= 0 || blob.size > WORKSPACE_UPLOAD_MAX_BYTES) {
    throw new Error('design_dialogue_reference_size_invalid');
  }
  if (declaredType && declaredType !== 'application/octet-stream' && declaredType !== 'binary/octet-stream'
    && !IMAGE_MIME.has(declaredType)) throw new Error('design_dialogue_reference_format_invalid');
  const header = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const rasterType = rasterTypeFromHeader(header);
  if (!rasterType || (declaredType && IMAGE_MIME.has(declaredType) && declaredType !== rasterType)) {
    throw new Error('design_dialogue_reference_raster_invalid');
  }
  return rasterType;
};

const defaultAvifMaterializer = async (blob: Blob): Promise<Blob> => {
  if (typeof createImageBitmap !== 'function') throw new Error('design_dialogue_avif_materialization_unavailable');
  const bitmap = await createImageBitmap(blob);
  try {
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    else {
      if (typeof document === 'undefined') throw new Error('design_dialogue_avif_materialization_unavailable');
      canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    const context = canvas.getContext('2d');
    if (!context) throw new Error('design_dialogue_avif_materialization_failed');
    context.drawImage(bitmap, 0, 0);
    const result = 'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('design_dialogue_avif_materialization_failed')), 'image/png');
      });
    return result;
  } finally {
    bitmap.close();
  }
};

const defaultEncodeImage = (blob: Blob, mimeType: 'image/png' | 'image/jpeg' | 'image/webp'): Promise<string> => (
  new Promise<string>((resolve, reject) => {
    if (typeof FileReader === 'undefined') return reject(new Error('design_dialogue_reference_reader_unavailable'));
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('design_dialogue_reference_encode_failed'));
    reader.onerror = () => reject(reader.error ?? new Error('design_dialogue_reference_encode_failed'));
    reader.onabort = () => reject(new Error('design_dialogue_reference_encode_cancelled'));
    reader.readAsDataURL(blob);
  }).then((value) => {
    if (!value.startsWith(`data:${mimeType};base64,`)) throw new Error('design_dialogue_reference_encode_invalid');
    return value;
  })
);

const errorCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  return /^[a-z0-9_:-]{1,96}$/i.test(message) ? message : 'design_dialogue_reference_failed';
};

const isExactNotFound = (error: unknown) => (
  error instanceof Error && /(?:cloudflare_api_404_workspace_artifact_not_found|workspace_artifact_not_found)$/.test(error.message)
);

const noPersistedBytesOrUrls = (serialized: string) => (
  !/(?:\bdata:|\bblob:|https?:\/\/|access_token|Bearer\s|(?:^|[?&])(?:X-Amz-)?(?:signature|credential|token)=)/i.test(serialized)
);

/**
 * Ordered source-file/scene-asset materialization for dialogue. Only request
 * IDs, labels, scene keys, and verified canonical receipts enter local state;
 * image bytes exist only transiently while calling the existing save API.
 */
export const createDesignDialogueReferenceController = (dependencies: Dependencies) => {
  let active = true;
  let currentScope: DesignDialogueReferenceScope | null = null;
  let references: InternalReference[] = [];
  const sourceFiles = new Map<string, DesignDialogueReferenceFile>();

  const requireScope = (): DesignDialogueReferenceScope => {
    if (!active || !currentScope) throw new Error('design_dialogue_reference_scope_missing');
    const live = dependencies.getCurrentScope();
    if (!live || !sameScope(live, currentScope)) throw new Error('design_dialogue_reference_scope_stale');
    return currentScope;
  };

  const assertAttempt = (scope: DesignDialogueReferenceScope, requestId?: string) => {
    if (!active || !currentScope || !sameScope(currentScope, scope)) throw new Error('design_dialogue_reference_scope_stale');
    const live = dependencies.getCurrentScope();
    if (!live || !sameScope(live, scope)) throw new Error('design_dialogue_reference_scope_stale');
    if (requestId && !references.some((reference) => reference.requestId === requestId)) {
      throw new Error('design_dialogue_reference_selection_stale');
    }
  };

  const snapshot = (): DesignDialogueReferenceState => ({
    scopeKey: currentScope ? scopeKey(currentScope) : '',
    references: references.map(({ id, requestId, kind, name, sceneAssetKey, status, error, receipt }) => ({
      id,
      requestId,
      kind,
      name,
      ...(sceneAssetKey ? { sceneAssetKey } : {}),
      status,
      ...(error ? { error } : {}),
      ...(receipt ? { receipt: { ...receipt } } : {}),
    })),
    ready: references.every((reference) => reference.status === 'ready' && Boolean(reference.receipt)),
  });

  const publish = () => {
    if (currentScope) {
      const live = dependencies.getCurrentScope();
      if (!live || !sameScope(live, currentScope)) return;
    }
    dependencies.publish?.(snapshot());
  };

  const serialize = (scope: DesignDialogueReferenceScope, value: readonly InternalReference[]) => {
    const stored: StoredSelection = {
      version: 1,
      scope: { userId: scope.userId, brandId: scope.brandId, selectionId: scope.selectionId },
      references: value.map((reference) => ({
        requestId: reference.requestId,
        kind: reference.kind,
        name: reference.name,
        ...(reference.sceneAssetKey ? { sceneAssetKey: reference.sceneAssetKey } : {}),
        ...(reference.receipt ? { receipt: reference.receipt } : {}),
      })),
    };
    const serialized = JSON.stringify(stored);
    if (!noPersistedBytesOrUrls(serialized)) throw new Error('design_dialogue_reference_pending_state_unsafe');
    return serialized;
  };

  const persist = (scope: DesignDialogueReferenceScope, next: readonly InternalReference[]) => {
    const key = storageKey(scope);
    if (next.length === 0) dependencies.storage.removeItem(key);
    else dependencies.storage.setItem(key, serialize(scope, next));
  };

  const commitReferences = (scope: DesignDialogueReferenceScope, next: InternalReference[], requestId?: string) => {
    assertAttempt(scope);
    if (requestId && !next.some((reference) => reference.requestId === requestId)) {
      throw new Error('design_dialogue_reference_selection_stale');
    }
    if (new Set(next.map((reference) => reference.requestId)).size !== next.length) {
      throw new Error('design_dialogue_reference_selection_duplicate');
    }
    persist(scope, next);
    references = next;
    publish();
  };

  const loadSelection = (scope: DesignDialogueReferenceScope): InternalReference[] => {
    const serialized = dependencies.storage.getItem(storageKey(scope));
    return serialized === null ? [] : parseStoredReferences(serialized, scope);
  };

  const ensureSceneRequestId = (scope: DesignDialogueReferenceScope, sceneAssetKey: string) => {
    assertAttempt(scope);
    const key = sceneIndexStorageKey(scope);
    const assets = parseSceneIndex(dependencies.storage.getItem(key), scope);
    const existing = assets[sceneAssetKey];
    if (existing) return { requestId: existing, existed: true };
    const requestId = (dependencies.requestId ?? (() => crypto.randomUUID()))();
    if (!UUID_V4.test(requestId)) throw new Error('cloudflare_workspace_request_id_invalid');
    assets[sceneAssetKey] = requestId;
    const stored: StoredSceneIndex = {
      version: 1,
      scope: { userId: scope.userId, brandId: scope.brandId },
      assets,
    };
    const serialized = JSON.stringify(stored);
    if (!noPersistedBytesOrUrls(serialized)) throw new Error('design_dialogue_scene_index_unsafe');
    dependencies.storage.setItem(key, serialized);
    assertAttempt(scope);
    return { requestId, existed: false };
  };

  const captureContext = async (scope: DesignDialogueReferenceScope, requestId?: string) => {
    assertAttempt(scope, requestId);
    const context = await dependencies.client.captureArtifactPersistenceContext({
      assertContext: () => assertAttempt(scope, requestId),
    });
    assertAttempt(scope, requestId);
    await context.assertCurrent();
    assertAttempt(scope, requestId);
    return context;
  };

  const setStatus = (
    scope: DesignDialogueReferenceScope,
    requestId: string,
    status: DesignDialogueReferenceStatus,
    error?: unknown,
  ) => {
    const live = dependencies.getCurrentScope();
    if (!active || !live || !currentScope || !sameScope(currentScope, scope) || !sameScope(live, scope)) return;
    const index = references.findIndex((reference) => reference.requestId === requestId);
    if (index < 0) return;
    const next = references.slice();
    next[index] = {
      ...next[index],
      status,
      ...(error === undefined ? { error: undefined } : { error: errorCode(error) }),
    };
    references = next;
    publish();
  };

  const storeReceipt = (scope: DesignDialogueReferenceScope, requestId: string, receipt: CanonicalReceipt) => {
    const index = references.findIndex((reference) => reference.requestId === requestId);
    if (index < 0) throw new Error('design_dialogue_reference_selection_stale');
    const current = references[index];
    const next = references.slice();
    next[index] = { ...current, status: 'ready', receipt, error: undefined };
    commitReferences(scope, next, requestId);
  };

  const readExact = async (
    scope: DesignDialogueReferenceScope,
    requestId: string,
    context: DesignDialoguePersistenceContext,
  ) => {
    assertAttempt(scope, requestId);
    await context.assertCurrent();
    assertAttempt(scope, requestId);
    const response = await dependencies.client.readWorkspaceArtifact(requestId, undefined, null, context);
    await context.assertCurrent();
    assertAttempt(scope, requestId);
    return validateReceipt(response, requestId);
  };

  const prepareUploadBlob = async (blob: Blob, declaredType?: string): Promise<{ blob: Blob; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }> => {
    const rasterType = await inspectRaster(blob, declaredType);
    let prepared = blob;
    let preparedType: RasterImageType = rasterType;
    if (rasterType === 'image/avif') {
      prepared = await (dependencies.materializeAvifToPng ?? defaultAvifMaterializer)(blob);
      preparedType = await inspectRaster(prepared, prepared.type || undefined);
      if (preparedType !== 'image/png') throw new Error('design_dialogue_avif_materialization_invalid');
    }
    if (!CANONICAL_MIME.has(preparedType)) throw new Error('design_dialogue_reference_format_invalid');
    return { blob: prepared, mimeType: preparedType as 'image/png' | 'image/jpeg' | 'image/webp' };
  };

  const resolveBlob = async (reference: InternalReference, scope: DesignDialogueReferenceScope, suppliedFile?: DesignDialogueReferenceFile) => {
    if (reference.kind === 'upload') {
      const file = suppliedFile ?? sourceFiles.get(reference.requestId);
      if (!file) throw new Error('design_dialogue_reference_retry_file_required');
      if (!safeName(file.name)) throw new Error('design_dialogue_reference_name_invalid');
      if (!IMAGE_MIME.has(file.type) || file.size <= 0 || file.size > WORKSPACE_UPLOAD_MAX_BYTES) {
        throw new Error(file.size > WORKSPACE_UPLOAD_MAX_BYTES ? 'workspace_image_too_large' : 'design_dialogue_reference_file_invalid');
      }
      return prepareUploadBlob(file, file.type);
    }
    if (!dependencies.loadSceneAsset) throw new Error('design_dialogue_scene_loader_unavailable');
    const key = reference.sceneAssetKey;
    if (!key || !safeSceneAssetKey(key)) throw new Error('design_dialogue_scene_asset_key_invalid');
    const blob = await dependencies.loadSceneAsset(key, { assertCurrent: () => assertAttempt(scope, reference.requestId) });
    assertAttempt(scope, reference.requestId);
    return prepareUploadBlob(blob, blob.type || undefined);
  };

  const performSave = async (
    reference: InternalReference,
    scope: DesignDialogueReferenceScope,
    context: DesignDialoguePersistenceContext,
    suppliedFile?: DesignDialogueReferenceFile,
  ) => {
    setStatus(scope, reference.requestId, 'saving');
    const prepared = await resolveBlob(reference, scope, suppliedFile);
    await context.assertCurrent();
    assertAttempt(scope, reference.requestId);
    const imageUrl = await (dependencies.encodeImage ?? defaultEncodeImage)(prepared.blob, prepared.mimeType);
    assertAttempt(scope, reference.requestId);
    if (!imageUrl.startsWith(`data:${prepared.mimeType};base64,`)) throw new Error('design_dialogue_reference_encode_invalid');
    const metadata: Record<string, import('../types/database').Json | undefined> = {
      source: 'design-dialogue-reference',
      referenceKind: reference.kind,
      ...(reference.sceneAssetKey ? { sceneAssetKey: reference.sceneAssetKey } : {}),
    };
    const input: Parameters<CloudflareDataPlane['saveWorkspaceArtifact']>[0] = {
      requestId: reference.requestId,
      brandId: scope.brandId,
      featureType: 'design-dialogue-reference',
      title: 'Design dialogue reference',
      imageUrl,
      prompt: null,
      metadata,
      canvasProjectId: null,
      sourceStoragePath: null,
    };
    await context.assertCurrent();
    assertAttempt(scope, reference.requestId);
    const saved = await dependencies.client.saveWorkspaceArtifact(input, undefined, context);
    await context.assertCurrent();
    assertAttempt(scope, reference.requestId);
    storeReceipt(scope, reference.requestId, validateReceipt(saved, reference.requestId));
  };

  const runInitialSave = async (
    reference: InternalReference,
    scope: DesignDialogueReferenceScope,
    suppliedFile?: DesignDialogueReferenceFile,
    recoverBeforeSave = false,
  ) => {
    try {
      const context = await captureContext(scope, reference.requestId);
      if (recoverBeforeSave) {
        setStatus(scope, reference.requestId, 'recovering');
        try {
          storeReceipt(scope, reference.requestId, await readExact(scope, reference.requestId, context));
          return snapshot();
        } catch (error) {
          if (!isExactNotFound(error)) throw error;
        }
      }
      await performSave(reference, scope, context, suppliedFile);
      return snapshot();
    } catch (error) {
      setStatus(scope, reference.requestId, 'failure', error);
      throw error;
    }
  };

  const addReference = async (
    kind: DesignDialogueReferenceKind,
    name: string,
    sceneAssetKey?: string,
    file?: DesignDialogueReferenceFile,
  ) => {
    const scope = requireScope();
    if (references.length >= DESIGN_DIALOGUE_REFERENCE_LIMIT) throw new Error('design_dialogue_reference_limit_reached');
    if (!safeName(name)) throw new Error('design_dialogue_reference_name_invalid');
    if (kind === 'scene-asset' && (!sceneAssetKey || !safeSceneAssetKey(sceneAssetKey))) {
      throw new Error('design_dialogue_scene_asset_key_invalid');
    }
    const requestId = (dependencies.requestId ?? (() => crypto.randomUUID()))();
    if (!UUID_V4.test(requestId)) throw new Error('cloudflare_workspace_request_id_invalid');
    const reference: InternalReference = {
      id: requestId,
      requestId,
      kind,
      name,
      ...(sceneAssetKey ? { sceneAssetKey } : {}),
      status: 'pending',
    };
    if (references.some((entry) => entry.requestId === requestId)) throw new Error('design_dialogue_reference_selection_duplicate');
    if (kind === 'upload') {
      if (!file || !IMAGE_MIME.has(file.type) || file.size <= 0 || file.size > WORKSPACE_UPLOAD_MAX_BYTES) {
        throw new Error(file && file.size > WORKSPACE_UPLOAD_MAX_BYTES ? 'workspace_image_too_large' : 'design_dialogue_reference_file_invalid');
      }
      sourceFiles.set(requestId, file);
    }
    const next = [...references, reference];
    try { commitReferences(scope, next, requestId); }
    catch (error) { sourceFiles.delete(requestId); throw error; }
    return runInitialSave(reference, scope, file);
  };

  return {
    activate(scope: DesignDialogueReferenceScope): DesignDialogueReferenceState {
      if (!active) throw new Error('design_dialogue_reference_controller_disposed');
      const liveBeforeLoad = dependencies.getCurrentScope();
      if (!validScope(scope) || !liveBeforeLoad || !sameScope(scope, liveBeforeLoad)) {
        throw new Error('design_dialogue_reference_scope_stale');
      }
      if (currentScope && sameScope(currentScope, scope)) return snapshot();
      const loadedReferences = loadSelection(scope);
      const liveAfterLoad = dependencies.getCurrentScope();
      if (!liveAfterLoad || !sameScope(liveAfterLoad, scope)) throw new Error('design_dialogue_reference_scope_stale');
      if (currentScope && !sameScopeIdentity(currentScope, scope)) sourceFiles.clear();
      currentScope = { ...scope };
      references = loadedReferences;
      publish();
      return snapshot();
    },

    async restore(): Promise<DesignDialogueReferenceState> {
      const scope = requireScope();
      const selected = (requestId: string) => references.some((reference) => reference.requestId === requestId);
      const timeoutMs = dependencies.restoreTimeoutMs ?? DESIGN_DIALOGUE_RESTORE_TIMEOUT_MS;
      for (const reference of references.slice()) {
        // A reference removed while an earlier one was recovering must not abort the rest.
        assertAttempt(scope);
        if (!selected(reference.requestId)) continue;
        setStatus(scope, reference.requestId, 'recovering');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const receipt = await Promise.race([
            (async () => readExact(scope, reference.requestId, await captureContext(scope, reference.requestId)))(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('design_dialogue_reference_restore_timeout')), timeoutMs);
            }),
          ]);
          storeReceipt(scope, reference.requestId, receipt);
        } catch (error) {
          const live = dependencies.getCurrentScope();
          if (!active || !live || !sameScope(live, scope) || !currentScope || !sameScope(currentScope, scope)) throw error;
          // A stalled or failed recovery becomes a visible failure (retry/remove) instead of an endless pending state.
          if (selected(reference.requestId)) setStatus(scope, reference.requestId, 'failure', error);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
      return snapshot();
    },

    addFile(file: DesignDialogueReferenceFile): Promise<DesignDialogueReferenceState> {
      if (!validBlobLike(file) || !safeName(file.name)) return Promise.reject(new Error('design_dialogue_reference_file_invalid'));
      return addReference('upload', file.name, undefined, file);
    },

    addSceneAsset(sceneAssetKey: string, name: string): Promise<DesignDialogueReferenceState> {
      const scope = requireScope();
      if (!safeSceneAssetKey(sceneAssetKey)) return Promise.reject(new Error('design_dialogue_scene_asset_key_invalid'));
      const selected = references.find((reference) => reference.kind === 'scene-asset' && reference.sceneAssetKey === sceneAssetKey);
      if (selected) return Promise.resolve(snapshot());
      if (!safeName(name)) return Promise.reject(new Error('design_dialogue_reference_name_invalid'));
      if (references.length >= DESIGN_DIALOGUE_REFERENCE_LIMIT) return Promise.reject(new Error('design_dialogue_reference_limit_reached'));
      let sceneRequest: { requestId: string; existed: boolean };
      try { sceneRequest = ensureSceneRequestId(scope, sceneAssetKey); }
      catch (error) { return Promise.reject(error); }
      const { requestId } = sceneRequest;
      const reference: InternalReference = { id: requestId, requestId, kind: 'scene-asset', name, sceneAssetKey, status: 'pending' };
      if (references.some((entry) => entry.requestId === requestId)) return Promise.reject(new Error('design_dialogue_reference_selection_duplicate'));
      const next = [...references, reference];
      try { commitReferences(scope, next, requestId); }
      catch (error) { return Promise.reject(error); }
      return runInitialSave(reference, scope, undefined, sceneRequest.existed);
    },

    async retry(referenceId: string, replacementFile?: DesignDialogueReferenceFile): Promise<DesignDialogueReferenceState> {
      const scope = requireScope();
      const reference = references.find((entry) => entry.id === referenceId);
      if (!reference) throw new Error('design_dialogue_reference_missing');
      if (reference.status === 'ready') return snapshot();
      if (replacementFile && reference.kind === 'upload') {
        if (!validBlobLike(replacementFile) || !safeName(replacementFile.name)
          || !IMAGE_MIME.has(replacementFile.type) || replacementFile.size <= 0 || replacementFile.size > WORKSPACE_UPLOAD_MAX_BYTES) {
          throw new Error(replacementFile.size > WORKSPACE_UPLOAD_MAX_BYTES ? 'workspace_image_too_large' : 'design_dialogue_reference_file_invalid');
        }
        sourceFiles.set(reference.requestId, replacementFile);
      }
      return runInitialSave(reference, scope, replacementFile, true);
    },

    move(referenceId: string, toIndex: number): DesignDialogueReferenceState {
      const scope = requireScope();
      const fromIndex = references.findIndex((reference) => reference.id === referenceId);
      if (fromIndex < 0) throw new Error('design_dialogue_reference_missing');
      if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= references.length) throw new Error('design_dialogue_reference_order_invalid');
      if (fromIndex === toIndex) return snapshot();
      const next = references.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      commitReferences(scope, next);
      return snapshot();
    },

    remove(referenceId: string): DesignDialogueReferenceState {
      const scope = requireScope();
      if (!references.some((reference) => reference.id === referenceId)) return snapshot();
      const next = references.filter((reference) => reference.id !== referenceId);
      commitReferences(scope, next);
      sourceFiles.delete(referenceId);
      return snapshot();
    },

    prepareForSend(): DesignDialogueManifestReference[] {
      const scope = requireScope();
      if (references.length > DESIGN_DIALOGUE_REFERENCE_LIMIT) throw new Error('design_dialogue_reference_limit_reached');
      const output: DesignDialogueManifestReference[] = [];
      for (const [order, reference] of references.entries()) {
        if (reference.status !== 'ready' || !reference.receipt) throw new Error('design_dialogue_references_incomplete');
        output.push({
          order,
          kind: reference.kind,
          imageId: reference.receipt.imageId,
          storagePath: reference.receipt.storagePath,
          name: reference.name,
          ...(reference.sceneAssetKey ? { sceneAssetKey: reference.sceneAssetKey } : {}),
        });
      }
      assertAttempt(scope);
      return output;
    },

    snapshot,

    dispose() {
      active = false;
      sourceFiles.clear();
    },
  };
};
