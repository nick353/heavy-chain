import {
  normalizeMediaObjectPath,
  normalizeMediaProviderOrder,
  type MediaProvider,
} from './mediaReference.ts';

/**
 * Runtime media policy for the browser.
 *
 * Cloudflare R2 is the only runtime provider and is reachable only through
 * an authenticated gateway; R2 access keys must never be placed in Vite
 * variables or shipped to the browser.
 */
export const DEFAULT_RUNTIME_MEDIA_PROVIDER_ORDER: readonly MediaProvider[] = ['cloudflare_r2'];

export const PRIVATE_MEDIA_BUCKETS = ['generated-images', 'brand-assets', 'exports'] as const;
export type PrivateMediaBucket = (typeof PRIVATE_MEDIA_BUCKETS)[number];

export type MediaRuntimeEnv = object;

export type MediaRuntimeConfigError = 'invalid_provider_order' | 'invalid_gateway_url';

export type MediaRuntimeConfig = {
  providerOrder: MediaProvider[];
  gatewayUrl: string | null;
  configError: MediaRuntimeConfigError | null;
};

const HTTPS_PROTOCOL = 'https:';

const normalizeGatewayUrl = (source: unknown): { url: string | null; invalid: boolean } => {
  if (source === undefined || source === null || String(source).trim() === '') {
    return { url: null, invalid: false };
  }
  if (typeof source !== 'string') return { url: null, invalid: true };

  try {
    const url = new URL(source.trim());
    if (url.protocol !== HTTPS_PROTOCOL || url.username || url.password || url.search || url.hash) {
      return { url: null, invalid: true };
    }
    return { url: url.toString().replace(/\/+$/, ''), invalid: false };
  } catch {
    return { url: null, invalid: true };
  }
};

/** Parse deploy-time provider settings without performing I/O. */
export const readMediaRuntimeConfig = (env: MediaRuntimeEnv | null | undefined): MediaRuntimeConfig => {
  const values = env && typeof env === 'object' ? env as Record<string, unknown> : {};
  const rawOrder = values.VITE_MEDIA_PROVIDER_ORDER;
  let providerOrder = [...DEFAULT_RUNTIME_MEDIA_PROVIDER_ORDER];
  let configError: MediaRuntimeConfigError | null = null;

  if (typeof rawOrder === 'string' && rawOrder.trim()) {
    try {
      providerOrder = normalizeMediaProviderOrder(rawOrder.split(',').map((provider) => provider.trim()));
      if (providerOrder.length !== 1 || providerOrder[0] !== 'cloudflare_r2') throw new Error('retired_media_provider');
    } catch {
      // Retired/malformed provider settings must not activate another backend.
      providerOrder = [];
      configError = 'invalid_provider_order';
    }
  } else if (rawOrder !== undefined && rawOrder !== null && rawOrder !== '') {
    providerOrder = [];
    configError = 'invalid_provider_order';
  }

  const gateway = normalizeGatewayUrl(values.VITE_MEDIA_GATEWAY_URL);
  if (gateway.invalid) configError = configError ?? 'invalid_gateway_url';

  return {
    providerOrder,
    gatewayUrl: configError ? null : gateway.url,
    configError,
  };
};

export type MediaGatewayReadRequest = {
  bucket: string;
  objectPath: string;
  expiresInSeconds?: number;
};

export type MediaGatewayReadFailureCode =
  | 'gateway_not_configured'
  | 'missing_access_token'
  | 'request_failed'
  | 'invalid_response';

export type MediaGatewayReadResult =
  | {
      ok: true;
      provider: 'cloudflare_r2';
      bucket: string;
      objectPath: string;
      url: string;
    }
  | {
      ok: false;
      code: MediaGatewayReadFailureCode;
    };

type MediaGatewayResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type MediaGatewayFetch = (
  input: string,
  init?: RequestInit,
) => Promise<MediaGatewayResponseLike>;

export type MediaGatewayClientOptions = {
  baseUrl: string | null;
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: MediaGatewayFetch;
};

const isSafeBucket = (source: string): source is PrivateMediaBucket => (
  PRIVATE_MEDIA_BUCKETS.includes(source as PrivateMediaBucket)
);

const isSafeGatewayUrl = (source: unknown): source is string => {
  if (typeof source !== 'string' || !source) return false;
  try {
    const url = new URL(source);
    return url.protocol === HTTPS_PROTOCOL && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
};

const isSafeSignedUrl = (source: unknown): source is string => {
  if (typeof source !== 'string' || !source.trim()) return false;
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};

const isRecord = (source: unknown): source is Record<string, unknown> => (
  typeof source === 'object' && source !== null
);

const readReturnedObjectPath = (body: Record<string, unknown>): string | null => {
  const candidate = body.objectPath ?? body.object_path;
  return normalizeMediaObjectPath(candidate);
};

/**
 * Client for the authenticated Cloudflare media gateway.
 *
 * The gateway contract is deliberately narrow: the client sends only a
 * bucket/path and the current application access token, then accepts an HTTPS short-lived
 * URL whose returned identity matches the request. No R2 credential is ever
 * read by this module.
 */
export const createMediaGatewayClient = ({
  baseUrl,
  getAccessToken,
  fetchImpl = globalThis.fetch.bind(globalThis) as MediaGatewayFetch,
}: MediaGatewayClientOptions) => ({
  async createSignedReadUrl(request: MediaGatewayReadRequest): Promise<MediaGatewayReadResult> {
    const bucket = request.bucket.trim();
    const objectPath = normalizeMediaObjectPath(request.objectPath);
    if (!isSafeGatewayUrl(baseUrl)) return { ok: false, code: 'gateway_not_configured' };
    if (!isSafeBucket(bucket) || !objectPath) return { ok: false, code: 'invalid_response' };

    let accessToken: string | null = null;
    try {
      accessToken = (await getAccessToken())?.trim() || null;
    } catch {
      accessToken = null;
    }
    if (!accessToken) return { ok: false, code: 'missing_access_token' };

    const endpoint = new URL(`${baseUrl}/v1/media/read`);
    endpoint.searchParams.set('bucket', bucket);
    endpoint.searchParams.set('path', objectPath);
    const expiresInSeconds = typeof request.expiresInSeconds === 'number'
      && Number.isSafeInteger(request.expiresInSeconds)
      ? Math.min(Math.max(request.expiresInSeconds, 60), 3600)
      : 3600;
    endpoint.searchParams.set('expiresIn', String(expiresInSeconds));

    let response: MediaGatewayResponseLike;
    try {
      response = await fetchImpl(endpoint.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        // A stalled gateway must not leave Canvas image hydration pending
        // forever. Callers can then surface a bounded request_failed result
        // and keep the rest of the saved document usable.
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      return { ok: false, code: 'request_failed' };
    }
    if (!response.ok) return { ok: false, code: 'request_failed' };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, code: 'invalid_response' };
    }
    if (!isRecord(body)) return { ok: false, code: 'invalid_response' };

    const url = body.url ?? body.signedUrl;
    // Do not infer identity from the request when the gateway omits it. The
    // response itself is the target readback used to bind a signed URL to the
    // requested object, so all identity fields must be explicit.
    const returnedProvider = body.provider;
    const returnedBucket = typeof body.bucket === 'string' ? body.bucket.trim() : null;
    const returnedObjectPath = readReturnedObjectPath(body);
    if (
      returnedProvider !== 'cloudflare_r2'
      || returnedBucket !== bucket
      || returnedObjectPath !== objectPath
      || !isSafeSignedUrl(url)
    ) {
      return { ok: false, code: 'invalid_response' };
    }

    return {
      ok: true,
      provider: 'cloudflare_r2',
      bucket,
      objectPath,
      url,
    };
  },
});
