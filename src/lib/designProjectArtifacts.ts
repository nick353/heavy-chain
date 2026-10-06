import { getGeneratedImageIdentityKeys } from './generatedImageIdentity.ts';
import type { WorkspaceArtifact } from './localWorkspaceArtifacts';
import type { Json } from '../types/database';

// Twenty cards is a configurable 5-column by 4-row page size inferred for
// this workspace. Lightchain's production page size has not been confirmed.
export const DESIGN_PROJECT_PAGE_SIZE = 20;

export const designHistoryFeatureTypes: ReadonlySet<string> = new Set([
  'campaign-image',
  'text-to-image',
  'generate-image',
  'generate-variations',
  'marketing-workflow',
  'fashion-studio',
  'fashion-studio-detail-generated-result',
  'graphic-pattern-workspace',
  'design-gacha',
  'lightchain-fabric-image',
  'lightchain-fabric-image-provider-result',
]);

export type DesignProjectEntry = {
  artifact: WorkspaceArtifact;
  origin: 'local' | 'remote';
};

export type DesignProjectPage<T> = {
  page: number;
  pageCount: number;
  items: T[];
};

export const isSyntheticDesignFallback = (
  artifact: Pick<WorkspaceArtifact, 'id' | 'featureType'>,
): boolean => artifact.id.startsWith('source-design-production-untitled-')
  || artifact.featureType === 'design-production-source-fallback';

const readString = (metadata: WorkspaceArtifact['metadata'], key: string): string | null => {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const getDesignArtifactIdentityKeys = (artifact: WorkspaceArtifact): string[] => {
  const metadata = artifact.metadata ?? {};
  const canonicalStoragePath = readString(metadata, 'remoteStoragePath')
    ?? readString(metadata, 'storagePath')
    ?? readString(metadata, 'storage_path')
    ?? '';
  const keys = new Set(getGeneratedImageIdentityKeys({
    id: artifact.id,
    storage_path: canonicalStoragePath,
    metadata: metadata as unknown as Json,
  }));
  for (const key of ['remoteImageId', 'imageId']) {
    const imageId = readString(metadata, key);
    if (imageId) keys.add(`image:${imageId}`);
  }
  return [...keys];
};

const compareDesignEntries = (left: DesignProjectEntry, right: DesignProjectEntry): number => {
  const leftTime = Date.parse(left.artifact.createdAt);
  const rightTime = Date.parse(right.artifact.createdAt);
  const safeLeftTime = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
  const safeRightTime = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
  if (safeLeftTime !== safeRightTime) return safeRightTime - safeLeftTime;
  if (left.artifact.id < right.artifact.id) return -1;
  if (left.artifact.id > right.artifact.id) return 1;
  return 0;
};

export const toDesignEntries = (
  local: readonly WorkspaceArtifact[],
  remote: readonly WorkspaceArtifact[],
  featureTypes: ReadonlySet<string> = designHistoryFeatureTypes,
): DesignProjectEntry[] => {
  const entries: DesignProjectEntry[] = [];
  const indexByIdentity = new Map<string, number>();

  for (const [origin, artifacts] of [
    ['local', local],
    ['remote', remote],
  ] as const) {
    for (const artifact of artifacts) {
      if (isSyntheticDesignFallback(artifact) || !featureTypes.has(artifact.featureType)) continue;
      const keys = getDesignArtifactIdentityKeys(artifact);
      const duplicateIndex = keys
        .map((key) => indexByIdentity.get(key))
        .find((index): index is number => index !== undefined);

      if (duplicateIndex !== undefined) {
        const current = entries[duplicateIndex];
        if (current?.origin === 'remote' && origin === 'local') {
          entries[duplicateIndex] = { artifact, origin };
        }
        for (const key of keys) indexByIdentity.set(key, duplicateIndex);
        continue;
      }

      const nextIndex = entries.length;
      entries.push({ artifact, origin });
      for (const key of keys) indexByIdentity.set(key, nextIndex);
    }
  }

  return entries.sort(compareDesignEntries);
};

export const paginate = <T>(
  items: readonly T[],
  requestedPage: number,
  size = DESIGN_PROJECT_PAGE_SIZE,
): DesignProjectPage<T> => {
  const pageSize = Number.isFinite(size) && size > 0 ? Math.max(1, Math.floor(size)) : DESIGN_PROJECT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1;
  const page = Math.min(pageCount, Math.max(1, normalizedPage));
  return {
    page,
    pageCount,
    items: items.slice((page - 1) * pageSize, page * pageSize),
  };
};

export const designEntryHref = (entry: DesignProjectEntry): string | null => {
  if (entry.origin === 'local') {
    return `/canvas/new?sourceArtifactId=${encodeURIComponent(entry.artifact.id)}`;
  }
  const remoteImageId = readString(entry.artifact.metadata, 'remoteImageId');
  return remoteImageId
    ? `/canvas/new?galleryImageId=${encodeURIComponent(remoteImageId)}`
    : null;
};

export const createDesignArtifactScopeKey = (
  userId?: string | null,
  brandId?: string | null,
): string => `${userId}:${brandId}`;

export const isCurrentDesignArtifactScope = (
  capturedScopeKey: string,
  liveScopeKey: string,
  cancelled = false,
): boolean => !cancelled && capturedScopeKey === liveScopeKey;

export const isCurrentDesignArtifactLoad = (
  capturedScopeKey: string,
  liveScopeKey: string,
  capturedRequestToken: number,
  liveRequestToken: number,
  cancelled = false,
): boolean => isCurrentDesignArtifactScope(capturedScopeKey, liveScopeKey, cancelled)
  && capturedRequestToken === liveRequestToken;
