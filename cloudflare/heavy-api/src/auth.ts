const MAX_ISSUER_LENGTH = 1024;
const MAX_TOKEN_LENGTH = 4096;
const MAX_IDENTITY_BODY_LENGTH = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OidcAuthEnv {
  /** Required in production. A missing binding never falls back to JWT/JWKS or global fetch. */
  AUTH_SERVICE?: { fetch(request: Request): Promise<Response> };
  /** Exact base URL of the app's dedicated consumer-auth Worker. */
  AUTH_ISSUER?: string;
}
export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  /** Only populated after the bound auth service validates the live session. */
  verifiedProfile?: { email: string; name: string };
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ISSUER_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.hash === "";
  } catch {
    return false;
  }
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

type IdentityResponse = {
  issuer?: unknown;
  subject?: unknown;
  email?: unknown;
  emailVerified?: unknown;
  name?: unknown;
};

function verifiedIdentity(value: IdentityResponse, issuer: string): VerifiedIdentity | null {
  if (value.issuer !== issuer || typeof value.subject !== "string" || !UUID.test(value.subject) ||
      value.emailVerified !== true || typeof value.email !== "string" || value.email.length > 320 ||
      !/^[^\s@]+@[^\s@]+$/.test(value.email) || typeof value.name !== "string" || value.name.length > 512) {
    return null;
  }
  return { issuer, subject: value.subject, verifiedProfile: { email: value.email, name: value.name } };
}

export type ConfiguredTokenVerifier = (request: Request) => Promise<VerifiedIdentity | null>;

/**
 * The API accepts only a live session admitted by its dedicated Auth Worker.
 * Auth owns signature checks, expiry and revocation; this Worker never performs
 * a global network fetch and never accepts a legacy JWT/JWKS configuration.
 */
export function configuredTokenVerifier(env: OidcAuthEnv): ConfiguredTokenVerifier | null {
  const service = env.AUTH_SERVICE;
  const issuer = env.AUTH_ISSUER?.trim();
  if (!service || typeof service.fetch !== "function" || !validHttpsUrl(issuer)) return null;

  return async (request) => {
    const token = bearerToken(request);
    if (!token || token.length > MAX_TOKEN_LENGTH) return null;

    const response = await service.fetch(new Request(`${issuer}/v1/identity`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    }));
    // The Auth Worker uses 401 for missing, expired, revoked or otherwise
    // unverified sessions. Do not retry or reinterpret those responses.
    if (response.status === 401) return null;
    if (!response.ok) throw new Error("session_verifier_unavailable");

    const body = await response.text();
    if (body.length > MAX_IDENTITY_BODY_LENGTH) throw new Error("session_identity_invalid");
    let payload: IdentityResponse;
    try {
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("identity");
      payload = parsed as IdentityResponse;
    } catch {
      throw new Error("session_identity_invalid");
    }
    return verifiedIdentity(payload, issuer);
  };
}
