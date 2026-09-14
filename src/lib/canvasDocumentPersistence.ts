import { cloudflareDataPlane } from './cloudflareApi';
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
  sourceProjectIds?: string[];
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

export type CanvasImageSourceIssue = {
  objectId: string;
  label: string | null;
  source: string | null;
};

export class CanvasDocumentValidationError extends Error {
  readonly code = 'canvas_image_source_invalid';
  readonly issues: CanvasImageSourceIssue[];
  readonly objectIds: string[];
  readonly labels: string[];

  constructor(issues: CanvasImageSourceIssue[]) {
    super('canvas_image_source_invalid');
    this.name = 'CanvasDocumentValidationError';
    this.issues = issues;
    this.objectIds = issues.map((issue) => issue.objectId);
    this.labels = issues.flatMap((issue) => issue.label ? [issue.label] : []);
  }
}

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
const CLOUDFLARE_IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

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
  const imageId = [metadata?.galleryImageId, metadata?.imageId, parameters.imageId]
    .find((value): value is string => typeof value === 'string' && CLOUDFLARE_IMAGE_ID.test(value.trim()));
  if (imageId) return `generated-images/${imageId.trim()}`;
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
    parentId: typeof object.parentId === 'string' ? object.parentId : undefined,
    derivedFrom: typeof object.derivedFrom === 'string' ? object.derivedFrom : undefined,
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
  sourceProjectIds?:string[];
}): CanvasDocumentSnapshot => ({
  version: 1,
  localProjectId: input.projectId ?? null,
  name: input.name.slice(0, MAX_TITLE_LENGTH),
  objects: input.objects.map(buildRemoteObject),
  view: input.view,
  ...(input.sourceProjectIds?.length?{sourceProjectIds:input.sourceProjectIds}:{}),
});

/** Validate the serialized snapshot, after buildRemoteObject has resolved
 * canonical storage paths/image IDs into src. */
export const validateCanvasDocumentSnapshot = (snapshot: CanvasDocumentSnapshot): void => {
  const issues = snapshot.objects.flatMap((object) => {
    if (object.type !== 'image') return [];
    const source = typeof object.src === 'string' ? object.src : null;
    const normalized = source?.trim() ?? '';
    if (normalized && !/^(?:data|blob):/i.test(normalized) && !/^local-canvas-asset:\/\//i.test(normalized)) {
      return [];
    }
    return [{
      objectId: typeof object.id === 'string' && object.id ? object.id : '(unknown)',
      label: typeof object.label === 'string' && object.label ? object.label : null,
      source,
    }];
  });
  if (issues.length) throw new CanvasDocumentValidationError(issues);
};

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

export type CanvasDocumentRequestContext={userId:string;assertContext:()=>void};

export const getCanvasDocument = async (documentId: string, _brandId: string,context?:CanvasDocumentRequestContext) => {
  const cloudflare = cloudflareDataPlane;
  if (!cloudflare) throw new Error('cloudflare_api_not_configured');
  return mapDocument(await cloudflare.getCanvasDocument(documentId,context));
};

export const createCanvasDocument = async (input: {
  documentId?:string;
  brandId: string;
  title: string;
  snapshot: CanvasDocumentSnapshot;
},context?:CanvasDocumentRequestContext) => {
  validateCanvasDocumentSnapshot(input.snapshot);
  const cloudflare = cloudflareDataPlane;
  if (!cloudflare) throw new Error('cloudflare_api_not_configured');
  return mapDocument(await cloudflare.createCanvasDocument({
      id:input.documentId,
      brand_id: input.brandId,
      title: input.title,
      snapshot: input.snapshot,
    },context));
};

export const updateCanvasDocument = async (input: {
  brandId: string;
  documentId: string;
  title: string;
  snapshot: CanvasDocumentSnapshot;
  expectedRevision: number;
},context?:CanvasDocumentRequestContext) => {
  validateCanvasDocumentSnapshot(input.snapshot);
  const cloudflare = cloudflareDataPlane;
  if (!cloudflare) throw new Error('cloudflare_api_not_configured');
  return mapDocument(await cloudflare.updateCanvasDocument({
      documentId: input.documentId,
      title: input.title,
      snapshot: input.snapshot,
      expected_revision: input.expectedRevision,
    },context));
};

export const captureLegacyCanvasPayload = (userId: string, brandId: string) => {
  if (typeof window === 'undefined' || !userId || !brandId) return false;
  const raw = window.localStorage.getItem(LEGACY_CANVAS_KEY);
  if (!raw) return false;
  const key = getCanvasMigrationCacheKey(userId, brandId);
  if (!window.localStorage.getItem(key)) {
    // The legacy payload may contain base64 image data and can itself be
    // several megabytes. This key is only a migration receipt; copying the
    // payload here duplicates it and can make the receipt write exceed the
    // browser quota before the Canvas route can even render.
    const receipt = JSON.stringify({
      capturedAt: new Date().toISOString(),
      legacyKey: LEGACY_CANVAS_KEY,
      rawLength: raw.length,
    });
    try {
      window.localStorage.setItem(key, receipt);
    } catch {
      // Capturing legacy state is best-effort. A full localStorage bucket must
      // never turn Canvas navigation into an application error.
    }
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
