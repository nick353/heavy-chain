import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createServiceClient,
  createUserClient,
  requireBrandRole,
  requireUser,
} from '../_shared/auth.ts';

const ALLOWED_BUCKETS = new Set(['generated-images', 'brand-assets', 'exports']);
const MAX_OBJECT_PATH_LENGTH = 1024;
const MIN_EXPIRES_SECONDS = 60;
const MAX_EXPIRES_SECONDS = 3600;

const jsonHeaders = (req: Request): Record<string, string> => {
  const configuredOrigin = Deno.env.get('MEDIA_GATEWAY_ALLOWED_ORIGIN')?.trim() || null;
  const requestOrigin = req.headers.get('Origin');
  if (requestOrigin && !configuredOrigin) throw new GatewayError('media_gateway_origin_not_configured', 503);
  if (requestOrigin && configuredOrigin && requestOrigin !== configuredOrigin) {
    throw new GatewayError('media_gateway_origin_not_allowed', 403);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
  if (requestOrigin && configuredOrigin) headers['Access-Control-Allow-Origin'] = configuredOrigin;
  return headers;
};

const corsHeaders = (req: Request): Record<string, string> => ({
  ...jsonHeaders(req),
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
});

class GatewayError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status;
  }
}

const respond = (req: Request, body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: jsonHeaders(req) },
);

const normalizeObjectPath = (value: string): string => {
  const path = value.trim().normalize('NFC');
  if (!path || path.length > MAX_OBJECT_PATH_LENGTH) throw new GatewayError('object_path_invalid', 400);
  if (path.startsWith('/') || path.endsWith('/') || path.includes('\\') || path.includes('?') || path.includes('#')) {
    throw new GatewayError('object_path_invalid', 400);
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) {
    throw new GatewayError('object_path_invalid', 400);
  }

  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new GatewayError('object_path_invalid', 400);
  }
  if (decoded !== path && /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(decoded)) {
    throw new GatewayError('object_path_invalid', 400);
  }
  const segments = decoded.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new GatewayError('object_path_invalid', 400);
  }
  if (segments.some((segment) => Array.from(segment).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  }))) {
    throw new GatewayError('object_path_invalid', 400);
  }
  return decoded;
};

const readR2Config = () => {
  const endpoint = Deno.env.get('R2_S3_ENDPOINT')?.trim() || '';
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')?.trim() || '';
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')?.trim() || '';
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new GatewayError('media_gateway_not_configured', 503);
  }
  if (
    endpointUrl.protocol !== 'https:'
    || endpointUrl.username
    || endpointUrl.password
    || endpointUrl.search
    || endpointUrl.hash
    || endpointUrl.pathname !== '/'
    || !accessKeyId
    || !secretAccessKey
  ) {
    throw new GatewayError('media_gateway_not_configured', 503);
  }
  return { endpointUrl, accessKeyId, secretAccessKey };
};

const toHex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes))
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const hmacSha256 = async (key: string | ArrayBuffer, value: string): Promise<ArrayBuffer> => {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : new Uint8Array(key);
  const keyBuffer = keyBytes.slice().buffer as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
};

const sha256Hex = async (value: string): Promise<string> => toHex(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
);

const awsEncode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (character) => (
  `%${character.charCodeAt(0).toString(16).toUpperCase()}`
));

const canonicalQuery = (params: Array<[string, string]>): string => params
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
  .join('&');

const createPresignedGetUrl = async (
  bucket: string,
  objectPath: string,
  expiresInSeconds: number,
): Promise<string> => {
  const { endpointUrl, accessKeyId, secretAccessKey } = readR2Config();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const shortDate = amzDate.slice(0, 8);
  const host = endpointUrl.host;
  const canonicalUri = `/${[bucket, ...objectPath.split('/')].map(awsEncode).join('/')}`;
  const credentialScope = `${shortDate}/auto/s3/aws4_request`;
  const query = canonicalQuery([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresInSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    'GET',
    canonicalUri,
    query,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const dateKey = await hmacSha256(`AWS4${secretAccessKey}`, shortDate);
  const regionKey = await hmacSha256(dateKey, 'auto');
  const serviceKey = await hmacSha256(regionKey, 's3');
  const signingKey = await hmacSha256(serviceKey, 'aws4_request');
  const signature = toHex(await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey('raw', signingKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    new TextEncoder().encode(stringToSign),
  ));

  const signedUrl = new URL(endpointUrl.toString());
  signedUrl.pathname = canonicalUri;
  signedUrl.search = `${query}&X-Amz-Signature=${signature}`;
  return signedUrl.toString();
};

const authorizeObject = async (
  userClient: ReturnType<typeof createUserClient>,
  userId: string,
  bucket: string,
  objectPath: string,
) => {
  const segments = objectPath.split('/');
  if (bucket === 'generated-images') {
    // Service lookup is metadata-only; the user client still performs the
    // actual brand-role decision, so R2 never becomes an authorization source.
    const serviceClient = createServiceClient();
    const { data: image, error } = await serviceClient
      .from('generated_images')
      .select('brand_id, storage_path')
      .eq('storage_path', objectPath)
      .maybeSingle();
    if (error || !image || image.storage_path !== objectPath) {
      throw new GatewayError('media_object_not_found', 404);
    }
    await requireBrandRole(userClient, image.brand_id, userId, 'viewer');
    return image.brand_id;
  }

  if (segments.length < 3 || !segments[1]) throw new GatewayError('object_path_invalid', 400);
  const brandId = segments[1];
  await requireBrandRole(userClient, brandId, userId, 'viewer');
  if (bucket === 'exports' && segments[0] !== userId) {
    throw new GatewayError('media_object_not_found', 404);
  }
  return brandId;
};

const handleRead = async (req: Request) => {
  const url = new URL(req.url);
  if (!url.pathname.endsWith('/v1/media/read')) throw new GatewayError('route_not_found', 404);
  const bucket = url.searchParams.get('bucket')?.trim() || '';
  const pathValue = url.searchParams.get('path');
  if (!ALLOWED_BUCKETS.has(bucket) || !pathValue) throw new GatewayError('request_invalid', 400);
  const objectPath = normalizeObjectPath(pathValue);
  const expiresRaw = Number(url.searchParams.get('expiresIn') || MAX_EXPIRES_SECONDS);
  const expiresInSeconds = Number.isSafeInteger(expiresRaw)
    ? Math.min(Math.max(expiresRaw, MIN_EXPIRES_SECONDS), MAX_EXPIRES_SECONDS)
    : MAX_EXPIRES_SECONDS;

  const userClient = createUserClient(req);
  const user = await requireUser(userClient);
  await authorizeObject(userClient, user.id, bucket, objectPath);
  const signedUrl = await createPresignedGetUrl(bucket, objectPath, expiresInSeconds);

  return respond(req, {
    provider: 'cloudflare_r2',
    bucket,
    objectPath,
    url: signedUrl,
    expiresIn: expiresInSeconds,
  });
};

serve(async (req) => {
  try {
    const headers = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers });
    return await handleRead(req);
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 401;
    const code = error instanceof GatewayError
      ? error.code
      : error instanceof Error && error.message === 'Unauthorized'
        ? 'unauthorized'
        : 'media_gateway_request_failed';
    try {
      return respond(req, { error: code }, status);
    } catch {
      return new Response(JSON.stringify({ error: code }), { status, headers: { 'Content-Type': 'application/json' } });
    }
  }
});
