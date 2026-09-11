import { auth } from './auth';
import type { GeneratedImage } from '../types/database';
import {
  createMediaGatewayClient,
  readMediaRuntimeConfig,
} from './mediaGateway';
import {
  classifyGeneratedImageReference,
  clearCanonicalRemoteImageUrls,
  extractGeneratedImageStoragePath,
  hasGeneratedImageSignedRoute,
  hasGeneratedImageSignedPathCapture,
  isDirectImageUrl,
  isLocalWorkspaceStoragePath,
  resolveGeneratedImageStoragePath,
  normalizeCloudflareGeneratedImageStoragePath,
} from './storagePathSafety';
export {
  classifyGeneratedImageReference,
  clearCanonicalRemoteImageUrls,
  extractGeneratedImageStoragePath,
  hasGeneratedImageSignedRoute,
  hasGeneratedImageSignedPathCapture,
  isDirectImageUrl,
  isLocalWorkspaceStoragePath,
  isPreservableImageUrl,
  isSafeGeneratedImageStoragePath,
  normalizeGeneratedImageStoragePath,
  resolveGeneratedImageStoragePath,
} from './storagePathSafety';
export type {
  GeneratedImageStoragePathFailureCode,
  GeneratedImageStoragePathResolution,
  GeneratedImageReference,
  GeneratedImageReferenceKind,
  ImageUrlCarrier,
} from './storagePathSafety';

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const SIGNED_URL_BATCH_CONCURRENCY = 4;

const mediaRuntimeConfig = readMediaRuntimeConfig(import.meta.env);
const mediaGateway = createMediaGatewayClient({
  baseUrl: mediaRuntimeConfig.gatewayUrl,
  getAccessToken: async () => {
    try {
      const { data } = await auth.getSession();
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  },
});

/** Resolve private images only through the authenticated Cloudflare gateway. */
const createSignedMediaUrl = async (path: string): Promise<string | null> => {
  if (mediaRuntimeConfig.configError || !mediaRuntimeConfig.providerOrder.includes('cloudflare_r2')) return null;
  const result = await mediaGateway.createSignedReadUrl({ bucket: 'generated-images', objectPath: path, expiresInSeconds: SIGNED_URL_TTL_SECONDS });
  return result.ok ? result.url : null;
};

export type GeneratedImageUrlResolutionFailureCode =
  | 'missing_url'
  | 'missing_canonical_path'
  | 'invalid_canonical_path'
  | 'local_workspace_path'
  | 'signing_failed'
  | 'resolution_failed';

export class GeneratedImageUrlResolutionError extends Error {
  readonly code: GeneratedImageUrlResolutionFailureCode;
  readonly canonicalPath: string | null;

  constructor(code: GeneratedImageUrlResolutionFailureCode, message: string, canonicalPath: string | null = null) {
    super(message);
    this.name = 'GeneratedImageUrlResolutionError';
    this.code = code;
    this.canonicalPath = canonicalPath;
  }
}

export type GeneratedImageUrlResolution =
  | { ok: true; url: string; canonicalPath: string | null }
  | { ok: false; status: GeneratedImageUrlResolutionFailureCode; error: GeneratedImageUrlResolutionError; canonicalPath: string | null };

export async function resolveGeneratedImageUrlWithStatus(source: string): Promise<GeneratedImageUrlResolution> {
  const trimmed = source.trim();
  if (!trimmed) {
    const error = new GeneratedImageUrlResolutionError('missing_url', '画像URLが空です');
    return { ok: false, status: error.code, error, canonicalPath: null };
  }

  if (isLocalWorkspaceStoragePath(trimmed)) {
    const resolutionError = new GeneratedImageUrlResolutionError('local_workspace_path', 'ローカルワークスペース画像にはリモート署名が不要です');
    return { ok: false, status: resolutionError.code, error: resolutionError, canonicalPath: null };
  }

  const storagePath = extractGeneratedImageStoragePath(trimmed);
  if (storagePath) {
    const signedUrl = await createSignedMediaUrl(storagePath);
    if (signedUrl) return { ok: true, url: signedUrl, canonicalPath: storagePath };

    // A URL that already contains a retired signing route is stale when it
    // cannot be re-signed; never fall through and return that expired bearer
    // URL to a canvas or other caller.
    const resolutionError = new GeneratedImageUrlResolutionError('signing_failed', '画像URLの再署名に失敗しました', storagePath);
    return { ok: false, status: resolutionError.code, error: resolutionError, canonicalPath: storagePath };
  }

  if (hasGeneratedImageSignedRoute(trimmed)) {
    const status = hasGeneratedImageSignedPathCapture(trimmed) ? 'invalid_canonical_path' : 'missing_canonical_path';
    const resolutionError = new GeneratedImageUrlResolutionError(status, '画像の正規ストレージパスを解決できません');
    return { ok: false, status: resolutionError.code, error: resolutionError, canonicalPath: null };
  }

  if (isDirectImageUrl(trimmed) || trimmed.startsWith('blob:')) {
    return { ok: true, url: trimmed, canonicalPath: null };
  }

  const cloudflarePath = normalizeCloudflareGeneratedImageStoragePath(trimmed);
  const pathResolution = cloudflarePath ? { ok: true as const, path: cloudflarePath } : resolveGeneratedImageStoragePath(trimmed);
  if (!pathResolution.ok) {
    const code = pathResolution.code === 'empty_path' ? 'missing_canonical_path' : 'invalid_canonical_path';
    const resolutionError = new GeneratedImageUrlResolutionError(code, '画像の正規ストレージパスを解決できません');
    return { ok: false, status: resolutionError.code, error: resolutionError, canonicalPath: null };
  }

  const signedUrl = await createSignedMediaUrl(pathResolution.path);
  if (!signedUrl) {
    const resolutionError = new GeneratedImageUrlResolutionError('resolution_failed', '画像URLの解決に失敗しました', pathResolution.path);
    return { ok: false, status: resolutionError.code, error: resolutionError, canonicalPath: pathResolution.path };
  }

  return { ok: true, url: signedUrl, canonicalPath: pathResolution.path };
}

export async function resolveGeneratedImageUrl(source: string) {
  const result = await resolveGeneratedImageUrlWithStatus(source);
  if (!result.ok) throw result.error;
  return result.url;
}

export async function withSignedImageUrls<T extends Pick<GeneratedImage, 'storage_path' | 'image_url'>>(images: T[]) {
  const signedUrlByPath = new Map<string, string>();
  const paths = Array.from(new Set(
    images
      .map((image) => image.storage_path)
      .map((path) => {
        const cloudflarePath = normalizeCloudflareGeneratedImageStoragePath(path);
        if (cloudflarePath) return cloudflarePath;
        const reference = classifyGeneratedImageReference(path);
        return reference.kind === 'storage_path' || reference.kind === 'signed'
          ? reference.canonicalPath
          : null;
      })
      .filter((path): path is string => Boolean(path)),
  ));

  const signWithExplicitProviderOrder = async (pathsToResolve: string[]) => {
    const resolved = new Map<string, string>();
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < pathsToResolve.length) {
        const path = pathsToResolve[nextIndex];
        nextIndex += 1;
        if (!path) continue;
        const signedUrl = await createSignedMediaUrl(path);
        if (signedUrl) resolved.set(path, signedUrl);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SIGNED_URL_BATCH_CONCURRENCY, pathsToResolve.length) }, () => worker()),
    );
    return resolved;
  };

  const resolvedByProviderOrder = await signWithExplicitProviderOrder(paths);

  resolvedByProviderOrder.forEach((url, path) => signedUrlByPath.set(path, url));

  return images.map((image) => {
    const cloudflarePath = normalizeCloudflareGeneratedImageStoragePath(image.storage_path);
    if (cloudflarePath) return { ...image, image_url: signedUrlByPath.get(cloudflarePath) ?? null };
    const reference = classifyGeneratedImageReference(image.storage_path);
    if (reference.kind === 'empty' || reference.kind === 'local') {
      return image;
    }
    if (reference.kind === 'legacy') {
      // A non-empty but malformed canonical path must not preserve a stale
      // signed bearer URL. URL-only legacy rows (empty path) remain above.
      return clearCanonicalRemoteImageUrls([image])[0];
    }
    if (reference.kind === 'data' || reference.kind === 'blob' || reference.kind === 'direct') {
      return typeof image.storage_path === 'string'
        ? { ...image, image_url: image.storage_path }
        : image;
    }

    const signedUrl = reference.canonicalPath ? signedUrlByPath.get(reference.canonicalPath) : undefined;
    // Never retain a stale URL when signing failed. The storage path remains
    // the canonical identity and callers can decide how to surface the error.
    return signedUrl
      ? { ...image, image_url: signedUrl }
      : clearCanonicalRemoteImageUrls([image])[0];
  });
}
