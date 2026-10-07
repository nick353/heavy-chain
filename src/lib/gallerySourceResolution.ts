import type { Json } from '../types/database.ts';
import { getGeneratedImageIdentityKeys, mergeGeneratedImagesByCanonicalIdentity } from './generatedImageIdentity.ts';
import {
  classifyGeneratedImageReference,
  clearCanonicalRemoteImageUrls,
  normalizeCloudflareGeneratedImageStoragePath,
} from './storagePathSafety.ts';

export type GallerySourceScope = {
  userId: string | null;
  brandId: string;
  favoriteFilter: string;
  sortOrder: string;
};

export type GallerySourceStatus = 'pending' | 'failed' | 'resolved-empty' | 'resolved-rows';

export type GallerySourceRow = {
  id: string;
  storage_path: string;
  image_url?: string | null;
  user_id?: string;
  metadata?: Json | null;
};

export type GallerySourceResolution<T extends GallerySourceRow> = {
  status: GallerySourceStatus;
  scope: GallerySourceScope | null;
  sequence: number;
  rows: T[];
  unavailablePreviewIds: string[];
};

export type GallerySourceRequest = {
  scope: GallerySourceScope;
  sequence: number;
};

export type GallerySourceLiveContext = {
  sequence: number;
  scope: GallerySourceScope | null;
  liveUserId: string | null;
  liveBrandId: string | null;
};

export const createGallerySourceScope = (
  userId: string | null | undefined,
  brandId: string | null | undefined,
  favoriteFilter: string,
  sortOrder: string,
): GallerySourceScope | null => userId && brandId
  ? { userId, brandId, favoriteFilter, sortOrder }
  : null;

export const sameGallerySourceScope = (
  left: GallerySourceScope | null | undefined,
  right: GallerySourceScope | null | undefined,
): boolean => {
  if (!left || !right) return left === right;
  return left.userId === right.userId
    && left.brandId === right.brandId
    && left.favoriteFilter === right.favoriteFilter
    && left.sortOrder === right.sortOrder;
};

export const isGallerySourceRequestCurrent = (
  request: GallerySourceRequest,
  context: GallerySourceLiveContext,
): boolean => request.sequence === context.sequence
  && sameGallerySourceScope(request.scope, context.scope)
  && request.scope.userId === context.liveUserId
  && request.scope.brandId === context.liveBrandId;

const mergeSafeRows = <T extends GallerySourceRow>(first: readonly T[], second: readonly T[]): T[] => (
  mergeGeneratedImagesByCanonicalIdentity(
    clearCanonicalRemoteImageUrls(first),
    clearCanonicalRemoteImageUrls(second),
  )
);

export const getGalleryUnavailablePreviewIds = <T extends GallerySourceRow>(rows: readonly T[]): string[] => (
  rows.filter((row) => {
    if (typeof row.image_url === 'string' && row.image_url.trim()) return false;
    const reference = classifyGeneratedImageReference(row.storage_path);
    return Boolean(normalizeCloudflareGeneratedImageStoragePath(row.storage_path))
      || reference.kind === 'storage_path'
      || reference.kind === 'signed';
  }).map((row) => row.id)
);

export const beginGallerySourceResolution = <T extends GallerySourceRow>(
  previous: GallerySourceResolution<T>,
  request: GallerySourceRequest,
  localRows: readonly T[],
): GallerySourceResolution<T> => {
  const sameScopeRows = sameGallerySourceScope(previous.scope, request.scope) ? previous.rows : [];
  const rows = mergeSafeRows(sameScopeRows, localRows);
  return {
    status: 'pending',
    scope: request.scope,
    sequence: request.sequence,
    rows,
    unavailablePreviewIds: getGalleryUnavailablePreviewIds(rows),
  };
};

export const canClearMissingGallerySelection = <T extends GallerySourceRow>(
  resolution: GallerySourceResolution<T>,
  currentScope: GallerySourceScope | null,
): boolean => (resolution.status === 'resolved-empty' || resolution.status === 'resolved-rows')
  && sameGallerySourceScope(resolution.scope, currentScope);

export type ResolveGallerySourceOptions<T extends GallerySourceRow> = {
  request: GallerySourceRequest;
  previous: GallerySourceResolution<T>;
  getCurrentContext: () => GallerySourceLiveContext;
  readLocalRows: () => T[];
  fetchRemoteRows: () => Promise<T[]>;
  signRows: (rows: T[]) => Promise<T[]>;
  sortRows?: (rows: T[]) => T[];
  onState: (resolution: GallerySourceResolution<T>) => void;
  onFinally?: () => void;
};

/**
 * Resolve the canonical source list and its previews as separate outcomes.
 * A remote list failure preserves safe metadata for this exact scope; signing
 * failure leaves source rows resolved and marks their previews unavailable.
 */
export const resolveGallerySource = async <T extends GallerySourceRow>(
  options: ResolveGallerySourceOptions<T>,
): Promise<GallerySourceResolution<T> | null> => {
  const { request, previous, getCurrentContext, readLocalRows, fetchRemoteRows, signRows, sortRows, onState, onFinally } = options;
  const isCurrent = () => isGallerySourceRequestCurrent(request, getCurrentContext());
  if (!request.scope.userId || !request.scope.brandId || !isCurrent()) return null;

  let localRows: T[] = [];
  try {
    localRows = readLocalRows();
  } catch {
    // Local persistence is only a fallback; keep attempting the authenticated source read.
  }

  let resolution = beginGallerySourceResolution(previous, request, localRows);
  onState(resolution);

  try {
    const safeFallbackRows = clearCanonicalRemoteImageUrls(resolution.rows);
    let signedFallbackRows: T[];
    try {
      signedFallbackRows = await signRows(safeFallbackRows);
    } catch {
      signedFallbackRows = safeFallbackRows;
    }
    if (!isCurrent()) return null;

    const freshPreviewUrlByIdentity = new Map<string, string>();
    for (const row of signedFallbackRows) {
      if (typeof row.image_url !== 'string' || !row.image_url.trim()) continue;
      for (const key of getGeneratedImageIdentityKeys(row)) freshPreviewUrlByIdentity.set(key, row.image_url);
    }
    const safeLocalRows = clearCanonicalRemoteImageUrls(localRows);
    const signedLocalRows = safeLocalRows.map((row) => {
      const freshPreviewUrl = getGeneratedImageIdentityKeys(row)
        .map((key) => freshPreviewUrlByIdentity.get(key))
        .find((value): value is string => Boolean(value));
      return freshPreviewUrl ? { ...row, image_url: freshPreviewUrl } : row;
    });
    const pendingRows = mergeGeneratedImagesByCanonicalIdentity(
      mergeGeneratedImagesByCanonicalIdentity(resolution.rows, signedFallbackRows),
      signedLocalRows,
    );
    resolution = {
      ...resolution,
      rows: pendingRows,
      unavailablePreviewIds: getGalleryUnavailablePreviewIds(pendingRows),
    };
    onState(resolution);

    const remoteRows = await fetchRemoteRows();
    if (!isCurrent()) return null;

    const safeRemoteRows = clearCanonicalRemoteImageUrls(remoteRows);
    let signedRemoteRows: T[];
    try {
      signedRemoteRows = await signRows(safeRemoteRows);
    } catch {
      signedRemoteRows = safeRemoteRows;
    }
    if (!isCurrent()) return null;

    const mergedRows = mergeGeneratedImagesByCanonicalIdentity(signedRemoteRows, signedLocalRows);
    const rows = sortRows ? sortRows(mergedRows) : mergedRows;
    resolution = {
      status: rows.length > 0 ? 'resolved-rows' : 'resolved-empty',
      scope: request.scope,
      sequence: request.sequence,
      rows,
      unavailablePreviewIds: getGalleryUnavailablePreviewIds(rows),
    };
    onState(resolution);
    return resolution;
  } catch {
    if (!isCurrent()) return null;
    const rows = mergeGeneratedImagesByCanonicalIdentity(
      resolution.rows,
      clearCanonicalRemoteImageUrls(localRows),
    );
    if (sortRows) sortRows(rows);
    resolution = {
      status: 'failed',
      scope: request.scope,
      sequence: request.sequence,
      rows,
      unavailablePreviewIds: getGalleryUnavailablePreviewIds(rows),
    };
    onState(resolution);
    return resolution;
  } finally {
    if (isCurrent()) onFinally?.();
  }
};
