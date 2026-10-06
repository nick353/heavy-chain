import { normalizeCloudflareGeneratedImageStoragePath, resolveGeneratedImageStoragePath } from './storagePathSafety.ts';

export type FashionStudioThumbnailCandidate = {
  source: string;
  objectIndex: number;
  sourceKind: 'storagePath' | 'galleryStoragePath' | 'src';
  feature: string | null;
  artifactId: string | null;
  galleryImageId: string | null;
};

/** Preserve provenance without interpreting an input image as a generated result. */
export const extractFashionStudioThumbnailEvidence = (snapshot: unknown): FashionStudioThumbnailCandidate[] => {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray((snapshot as { objects?: unknown }).objects)) return [];
  const candidates: FashionStudioThumbnailCandidate[] = [];
  for (const [objectIndex, object] of (snapshot as { objects: unknown[] }).objects.entries()) {
    if (!object || typeof object !== 'object' || (object as { type?: unknown }).type !== 'image') continue;
    const image = object as { metadata?: unknown; src?: unknown };
    const metadata = image.metadata && typeof image.metadata === 'object' ? image.metadata as Record<string, unknown> : {};
    const parameters = metadata.parameters && typeof metadata.parameters === 'object'
      ? metadata.parameters as Record<string, unknown> : {};
    const provenance = {
      objectIndex,
      feature: typeof metadata.feature === 'string' ? metadata.feature : null,
      artifactId: typeof parameters.artifactId === 'string' ? parameters.artifactId : null,
      galleryImageId: typeof metadata.galleryImageId === 'string' ? metadata.galleryImageId : null,
    };
    if (image.metadata && typeof image.metadata === 'object') {
      for (const field of ['storagePath', 'galleryStoragePath'] as const) {
        const path = metadata[field];
        if (typeof path === 'string'
          && (normalizeCloudflareGeneratedImageStoragePath(path) || resolveGeneratedImageStoragePath(path).ok)) {
          candidates.push({ source: path, sourceKind: field, ...provenance });
        }
      }
    }
    if (typeof image.src === 'string' && image.src.trim()) candidates.push({ source: image.src, sourceKind: 'src', ...provenance });
  }
  return candidates;
};

/** Prefer supported storage metadata before src within each ordered image object. */
export const extractFashionStudioThumbnailCandidates = (snapshot: unknown): string[] => (
  extractFashionStudioThumbnailEvidence(snapshot).map((candidate) => candidate.source)
);

type ThumbnailResolution = { ok: true; url: string } | { ok: false };
export type FashionStudioThumbnailResolver = (source: string) => Promise<ThumbnailResolution>;
export type FashionStudioThumbnailState = {
  scopeKey: string;
  attempt: number;
  candidate: string | null;
  url: string | null;
  status: 'resolving' | 'loading' | 'loaded' | 'failure';
};
export const fashionStudioThumbnailScopeKey = (
  brandId: string | null,
  projectId: string,
  candidates: readonly string[],
) => JSON.stringify([brandId, projectId, candidates]);

/** Sequential resolution and image events share one guarded attempt identity. */
let nextThumbnailAttempt = 0;
export const createFashionStudioThumbnailController = (
  resolve: FashionStudioThumbnailResolver,
  publish: (state: FashionStudioThumbnailState) => void,
) => {
  let active = true;
  let generation = 0;
  let attempt = 0;
  let index = 0;
  let candidates: readonly string[] = [];
  let attemptedUrls = new Set<string>();
  let state: FashionStudioThumbnailState = {
    scopeKey: '', attempt, candidate: null, url: null, status: 'failure',
  };
  const emit = (next: FashionStudioThumbnailState) => {
    state = next;
    if (active) publish(state);
  };
  const advance = async (expectedGeneration: number): Promise<void> => {
    while (active && generation === expectedGeneration && index < candidates.length) {
      const candidate = candidates[index++];
      const token = ++nextThumbnailAttempt;
      attempt = token;
      emit({ ...state, attempt: token, candidate, url: null, status: 'resolving' });
      let resolved: ThumbnailResolution;
      try { resolved = await resolve(candidate); }
      catch { resolved = { ok: false }; }
      if (!active || generation !== expectedGeneration || state.attempt !== token || state.candidate !== candidate) return;
      if (!resolved.ok || !resolved.url || attemptedUrls.has(resolved.url)) continue;
      attemptedUrls.add(resolved.url);
      emit({ ...state, url: resolved.url, status: 'loading' });
      return;
    }
    if (active && generation === expectedGeneration) {
      emit({ ...state, candidate: null, url: null, status: 'failure' });
    }
  };
  const matches = (event: FashionStudioThumbnailState) => active
    && state.status === 'loading'
    && event.scopeKey === state.scopeKey
    && event.attempt === state.attempt
    && event.candidate === state.candidate
    && event.url === state.url;
  return {
    reset(brandId: string | null, projectId: string, nextCandidates: readonly string[]) {
      if (!active) return;
      generation += 1;
      index = 0;
      candidates = [...nextCandidates];
      attemptedUrls = new Set();
      emit({ scopeKey: fashionStudioThumbnailScopeKey(brandId, projectId, candidates),
        attempt: ++nextThumbnailAttempt, candidate: null, url: null, status: 'resolving' });
      void advance(generation);
    },
    onLoad(event: FashionStudioThumbnailState) {
      if (!matches(event)) return false;
      emit({ ...state, status: 'loaded' });
      return true;
    },
    onError(event: FashionStudioThumbnailState) {
      if (matches(event)) void advance(generation);
    },
    dispose() { active = false; generation += 1; },
  };
};
