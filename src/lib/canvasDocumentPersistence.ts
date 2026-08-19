import { supabase } from './supabase';
import type { CanvasObject } from '../stores/canvasStore';
import { buildLocalCanvasAssetReference, hasLocalCanvasAsset } from './canvasLocalAssets';

export type CanvasDocumentRecord = {
  id: string;
  ownerId: string;
  brandId: string;
  title: string;
  snapshot: CanvasDocumentSnapshot;
  snapshotVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type CanvasDocumentSnapshot = {
  version: number;
  projectId?: string | null;
  localProjectId?: string | null;
  name?: string;
  objects: Array<Record<string, unknown>>;
  view?: {
    zoom?: number;
    panX?: number;
    panY?: number;
    gridVisible?: boolean;
    snapToGrid?: boolean;
    gridSize?: number;
  };
};

const LEGACY_CANVAS_KEY = 'heavy-chain-canvas';
const MAX_TITLE_LENGTH = 160;
// Keep this in lockstep with the edge function's canonical snapshot contract.
// Canvas objects may carry provider-specific metadata that is useful in-memory
// but must not make a durable save fail with a schema rejection.
const REMOTE_METADATA_KEYS = new Set([
  'feature', 'prompt', 'parentId', 'generation', 'parameters', 'parentObjectId', 'maskApplied',
  'protectedRegionComposited', 'backendProvider', 'provider', 'status', 'jobId', 'imageId',
  'storagePath', 'persistenceStatus', 'lightchainCompat', 'galleryStoragePath', 'galleryImageId',
  'galleryImageUrl', 'inputLineage', 'parityRuntime', 'legalSafety', 'sourceIdentity', 'sourceRevision',
  'sourceReadback', 'lightchainEditStages', 'timestamp',
]);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const safeNamespacePart = (value: string) => value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);

export const getCanvasDocumentCacheKey = (userId: string, brandId: string, documentId: string) => (
  `heavy-chain-canvas:v2:${safeNamespacePart(userId)}:${safeNamespacePart(brandId)}:${safeNamespacePart(documentId)}`
);

export const getCanvasMigrationCacheKey = (userId: string, brandId: string) => (
  `heavy-chain-canvas:migration:${safeNamespacePart(userId)}:${safeNamespacePart(brandId)}`
);

const stripUnsafeData = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return /^(?:data|blob):/i.test(value) ? '' : value;
  }
  if (Array.isArray(value)) return value.map(stripUnsafeData);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stripUnsafeData(entry)]));
  }
  return value;
};

const getRemoteSource = (object: CanvasObject) => {
  const metadata = object.metadata;
  const parameters = metadata?.parameters && typeof metadata.parameters === 'object'
    ? metadata.parameters as Record<string, unknown>
    : {};
  const storagePath = [
    metadata?.galleryStoragePath,
    metadata?.storagePath,
    parameters.galleryStoragePath,
    parameters.storagePath,
    parameters.remoteStoragePath,
    parameters.sourceStoragePath,
    parameters.backendStoragePath,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (storagePath) return storagePath;
  const sourceRevision = metadata?.sourceRevision?.revision || metadata?.sourceRevision?.hash;
  if (sourceRevision && hasLocalCanvasAsset(sourceRevision)) return buildLocalCanvasAssetReference(sourceRevision);
  if (typeof object.src === 'string' && !/^(?:data|blob):/i.test(object.src)) return object.src;
  return '';
};

const buildRemoteObject = (object: CanvasObject): Record<string, unknown> => {
  const metadata = object.metadata
    ? Object.fromEntries(Object.entries(object.metadata).filter(([key]) => REMOTE_METADATA_KEYS.has(key)))
    : undefined;
  const candidate = stripUnsafeData({
    id: object.id,
    type: object.type,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    rotation: object.rotation,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
    opacity: object.opacity,
    locked: object.locked,
    visible: object.visible,
    zIndex: object.zIndex,
    src: object.type === 'image' ? getRemoteSource(object) : undefined,
    text: object.text,
    fontSize: object.fontSize,
    fontFamily: object.fontFamily,
    fill: object.fill,
    stroke: object.stroke,
    strokeWidth: object.strokeWidth,
    shapeType: object.shapeType,
    parentId: object.parentId,
    derivedFrom: object.derivedFrom,
    label: object.label,
    metadata,
  });
  return Object.fromEntries(Object.entries(candidate as Record<string, unknown>).filter(([, value]) => value !== undefined));
};

export const buildCanvasDocumentSnapshot = (input: {
  projectId?: string | null;
  name: string;
  objects: CanvasObject[];
  view?: CanvasDocumentSnapshot['view'];
}): CanvasDocumentSnapshot => ({
  version: 1,
  localProjectId: input.projectId ?? null,
  name: input.name.slice(0, MAX_TITLE_LENGTH),
  objects: input.objects.map(buildRemoteObject),
  view: input.view,
});

const mapDocument = (document: any): CanvasDocumentRecord => ({
  id: String(document.id),
  ownerId: String(document.ownerId ?? document.owner_id ?? ''),
  brandId: String(document.brandId ?? document.brand_id ?? ''),
  title: String(document.title || '無題のプロジェクト'),
  snapshot: (document.snapshot && typeof document.snapshot === 'object' ? document.snapshot : { version: 1, objects: [] }) as CanvasDocumentSnapshot,
  snapshotVersion: Number(document.snapshotVersion ?? document.snapshot_version ?? 1),
  revision: Number(document.revision ?? 0),
  createdAt: String(document.createdAt ?? document.created_at ?? ''),
  updatedAt: String(document.updatedAt ?? document.updated_at ?? ''),
});

const invokeCanvasDocument = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke('canvas-document', { body });
  if (error) {
    // Supabase FunctionsHttpError keeps the response in `context`. Preserve
    // only the server's bounded error code so Canvas can report the real
    // rejection reason without leaking headers, tokens, or the raw response.
    const context = (error as { context?: unknown }).context;
    if (context) {
      let serverMessage: string | null = null;
      try {
        const payload = await context.clone().json() as { error?: unknown };
        if (typeof payload.error === 'string' && payload.error.trim()) {
          serverMessage = payload.error.trim().slice(0, 160);
        }
      } catch {
        // Keep the SDK error when the response is not JSON.
      }
      if (serverMessage) throw new Error(serverMessage);
    }
    const errorName = error instanceof Error ? error.name : 'CanvasFunctionError';
    const errorMessage = error instanceof Error ? error.message : 'Canvas persistence request failed';
    const contextDetail = context instanceof Response
      ? `http_${context.status}`
      : context instanceof Error
        ? `${context.name}:${context.message}`
        : null;
    const detail = contextDetail ? ` (${contextDetail})` : '';
    throw new Error(`${errorName}: ${errorMessage}${detail}`.slice(0, 160));
  }
  if (!data?.success || !data.document) throw new Error(data?.error || 'canvas_document_request_failed');
  return mapDocument(data.document);
};

export const getCanvasDocument = async (documentId: string, brandId: string) => (
  invokeCanvasDocument({ action: 'get', documentId, brandId })
);

export const createCanvasDocument = async (input: {
  brandId: string;
  title: string;
  snapshot: CanvasDocumentSnapshot;
}) => invokeCanvasDocument({
  action: 'upsert',
  brandId: input.brandId,
  title: input.title,
  snapshot: input.snapshot,
});

export const updateCanvasDocument = async (input: {
  brandId: string;
  documentId: string;
  title: string;
  snapshot: CanvasDocumentSnapshot;
  expectedRevision: number;
}) => invokeCanvasDocument({
  action: 'upsert',
  brandId: input.brandId,
  documentId: input.documentId,
  title: input.title,
  snapshot: input.snapshot,
  expectedRevision: input.expectedRevision,
});

export const captureLegacyCanvasPayload = (userId: string, brandId: string) => {
  if (typeof window === 'undefined' || !userId || !brandId) return false;
  const raw = window.localStorage.getItem(LEGACY_CANVAS_KEY);
  if (!raw) return false;
  const key = getCanvasMigrationCacheKey(userId, brandId);
  if (!window.localStorage.getItem(key)) {
    window.localStorage.setItem(key, JSON.stringify({ capturedAt: new Date().toISOString(), raw }));
  }
  return true;
};

export const retainCanvasCacheAfterFailedReadback = (userId: string, brandId: string, documentId: string, snapshot: CanvasDocumentSnapshot) => {
  if (typeof window === 'undefined' || !userId || !brandId || !documentId) return;
  window.localStorage.setItem(getCanvasDocumentCacheKey(userId, brandId, documentId), JSON.stringify({ snapshot, retainedAt: new Date().toISOString() }));
};

export const acknowledgeCanvasRemoteReadback = (userId: string, brandId: string, documentId: string, snapshot: CanvasDocumentSnapshot) => {
  if (typeof window === 'undefined' || !userId || !brandId || !documentId) return;
  window.localStorage.setItem(getCanvasDocumentCacheKey(userId, brandId, documentId), JSON.stringify({ snapshot, verifiedAt: new Date().toISOString() }));
  // The legacy key is deliberately retained. It is not safe to remove a
  // shared legacy key until all old clients and all brands have been audited.
  // The namespaced migration receipt is the only cleanup boundary here.
  window.localStorage.removeItem(getCanvasMigrationCacheKey(userId, brandId));
};
