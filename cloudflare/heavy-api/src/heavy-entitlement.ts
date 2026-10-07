import type { Env } from './index.ts';
import { canonical, isRecord, sha256, type Json } from './image-ai-contracts.ts';

/**
 * Heavy generation is admitted only by server-owned, request-scoped records.
 * Browser fields are declarations used by the explicit POST endpoints; they
 * are never treated as proof by the provider-action handler.
 */

export type HeavyEntitlementReason =
  | 'heavy_generation_disabled'
  | 'heavy_terms_version_unconfigured'
  | 'heavy_terms_document_version_unconfigured'
  | 'heavy_terms_document_digest_unconfigured'
  | 'heavy_rights_version_unconfigured'
  | 'heavy_rights_document_version_unconfigured'
  | 'heavy_rights_document_digest_unconfigured'
  | 'heavy_terms_acceptance_required'
  | 'heavy_terms_acceptance_invalid'
  | 'heavy_terms_required'
  | 'heavy_rights_attestation_required'
  | 'heavy_request_attestation_required'
  | 'heavy_rights_attestation_mismatch'
  | 'heavy_request_binding_mismatch'
  | 'heavy_input_digest_mismatch'
  | 'heavy_request_binding_inputs_required'
  | 'heavy_terms_document_version_mismatch'
  | 'heavy_terms_document_digest_mismatch'
  | 'heavy_rights_document_version_mismatch'
  | 'heavy_rights_document_digest_mismatch'
  | 'heavy_preparation_required'
  | 'heavy_preparation_not_found'
  | 'heavy_preparation_expired'
  | 'heavy_preparation_mismatch'
  | 'heavy_preparation_conflict'
  | 'heavy_request_attestation_conflict';

export type HeavyEntitlementRequest = {
  userId: string;
  brandId: string;
  action: string;
  requestId?: string;
  inputDigest?: string;
  /** Server-normalized provider inputs used to recompute the request binding. */
  normalizedInput?: unknown;
  /** Opaque server preparation proof required for generation/admission. */
  preparationId?: string;
  /** Require a preparation proof for this resolution, rather than status-only resolution. */
  requirePreparation?: boolean;
};

export type HeavyEntitlementPolicy = {
  termsVersion: string | null;
  termsDocumentVersion: string | null;
  termsDocumentDigest: string | null;
  rightsVersion: string | null;
  rightsDocumentVersion: string | null;
  rightsDocumentDigest: string | null;
};

export type HeavyEntitlementResult = {
  allowed: boolean;
  reason: HeavyEntitlementReason | null;
  termsVersion: string | null;
  termsDocumentVersion: string | null;
  termsDocumentDigest: string | null;
  rightsVersion: string | null;
  rightsDocumentVersion: string | null;
  rightsDocumentDigest: string | null;
  termsAcceptanceId: string | null;
  rightsAttestationId: string | null;
  requestBinding: string | null;
  inputDigest: string | null;
  requestScopedAttestationRequired: boolean;
};

/**
 * Generation admission for the authenticated Heavy image surface.
 *
 * Heavy used to require a second, request-scoped terms/rights ceremony before
 * every provider call.  The product contract now makes login + brand
 * membership the only user-facing prerequisite.  Keep the old entitlement
 * resolver and its explicit acceptance endpoints available for historical
 * records and compatibility, but do not make them a prerequisite for a new
 * image job.  Authentication and brand ownership are checked by the caller
 * before this helper is reached.
 */
export const resolveHeavyGenerationAccess = (request: HeavyEntitlementRequest): HeavyEntitlementResult => ({
  allowed: true,
  reason: null,
  termsVersion: null,
  termsDocumentVersion: null,
  termsDocumentDigest: null,
  rightsVersion: null,
  rightsDocumentVersion: null,
  rightsDocumentDigest: null,
  termsAcceptanceId: null,
  rightsAttestationId: null,
  requestBinding: null,
  inputDigest: request.inputDigest ?? null,
  requestScopedAttestationRequired: false,
});

type AcceptanceRow = {
  id: string;
  user_id: string;
  terms_version: string;
  document_version: string | null;
  document_digest: string | null;
  accepted_at: string;
};

type AttestationRow = {
  id: string;
  request_id: string;
  user_id: string;
  brand_id: string;
  action: string;
  terms_acceptance_id: string;
  terms_version: string;
  rights_version: string;
  document_version: string | null;
  document_digest: string | null;
  request_binding: string;
  input_digest: string | null;
  normalized_input: string | null;
  attested_at: string;
};

type PreparationRow = {
  preparation_id: string;
  request_id: string;
  user_id: string;
  brand_id: string;
  action: string;
  input_digest: string;
  normalized_input: string;
  source_digests: string;
  expires_at: string;
  created_at: string;
};

type ExplicitDocumentInput = {
  documentVersion?: unknown;
  approvedDocumentVersion?: unknown;
  termsDocumentVersion?: unknown;
  rightsDocumentVersion?: unknown;
  documentDigest?: unknown;
  approvedDocumentDigest?: unknown;
  approvedDocumentContentDigest?: unknown;
  termsDocumentDigest?: unknown;
  rightsDocumentDigest?: unknown;
  rightsVersion?: unknown;
  rightsAttestationVersion?: unknown;
};

export type RecordAcceptanceInput = ExplicitDocumentInput & {
  userId: string;
  brandId: string;
  action: string;
  requestId: string;
  preparationId: string;
  inputDigest: string;
  termsAccepted: unknown;
  source?: unknown;
};

export type RecordAttestationInput = ExplicitDocumentInput & {
  userId: string;
  brandId: string;
  action: string;
  requestId: string;
  preparationId: string;
  inputDigest: string;
  termsAccepted: unknown;
  rightsAttested: unknown;
  /** Must be the server-normalized input whose digest is inputDigest. */
  normalizedInput?: unknown;
};

export type HeavyGenerationPreparation = {
  preparationId: string;
  requestId: string;
  inputDigest: string;
  expiresAt: string;
  policy: HeavyEntitlementPolicy;
};

export type HeavyPreparationInput = {
  userId: string;
  brandId: string;
  action: string;
  requestId: string;
  inputDigest: string;
  normalizedInput: unknown;
};

export type HeavyPreparationProof = {
  preparationId?: string;
  requestId: string;
  userId: string;
  brandId: string;
  action: string;
  inputDigest?: string;
  normalizedInput?: unknown;
  requirePreparation?: boolean;
};

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};
const digest = (value: unknown): string | null => {
  const candidate = text(value);
  return candidate && /^[0-9a-f]{64}$/i.test(candidate) ? candidate.toLowerCase() : null;
};
const configuredDigest = (value: unknown): string | null => digest(value);
const entitlementEnabled = (env: Env): boolean => env.HEAVY_IMAGE_ENTITLEMENT_ENABLED?.trim() === 'true';
const PREPARATION_TTL_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** No version or digest is ever defaulted. Empty production configuration is closed. */
export function heavyEntitlementPolicy(env: Env): HeavyEntitlementPolicy {
  const approvedVersion = text(env.HEAVY_APPROVED_DOCUMENT_VERSION);
  const approvedDigest = configuredDigest(env.HEAVY_APPROVED_DOCUMENT_DIGEST);
  return {
    termsVersion: text(env.HEAVY_TERMS_VERSION),
    termsDocumentVersion: text(env.HEAVY_TERMS_DOCUMENT_VERSION) ?? approvedVersion,
    termsDocumentDigest: configuredDigest(env.HEAVY_TERMS_DOCUMENT_DIGEST) ?? approvedDigest,
    rightsVersion: text(env.HEAVY_RIGHTS_ATTESTATION_VERSION),
    rightsDocumentVersion: text(env.HEAVY_RIGHTS_DOCUMENT_VERSION) ?? approvedVersion,
    rightsDocumentDigest: configuredDigest(env.HEAVY_RIGHTS_DOCUMENT_DIGEST) ?? approvedDigest,
  };
}

function documentVersion(input: ExplicitDocumentInput, kind: 'terms' | 'rights'): string | null {
  if (kind === 'terms') return text(input.termsDocumentVersion) ?? text(input.documentVersion) ?? text(input.approvedDocumentVersion);
  return text(input.rightsDocumentVersion) ?? text(input.documentVersion) ?? text(input.approvedDocumentVersion);
}
function documentDigest(input: ExplicitDocumentInput, kind: 'terms' | 'rights'): string | null {
  if (kind === 'terms') {
    return digest(input.termsDocumentDigest) ?? digest(input.documentDigest) ?? digest(input.approvedDocumentDigest) ?? digest(input.approvedDocumentContentDigest);
  }
  return digest(input.rightsDocumentDigest) ?? digest(input.documentDigest) ?? digest(input.approvedDocumentDigest) ?? digest(input.approvedDocumentContentDigest);
}

/** Server-computed binding; never accept this value from request JSON. */
export async function computeHeavyRequestBinding(input: {
  userId: string;
  brandId: string;
  action: string;
  requestId: string;
  termsAcceptanceId: string;
  termsVersion: string;
  termsDocumentVersion: string;
  termsDocumentDigest: string;
  rightsVersion: string;
  rightsDocumentVersion: string;
  rightsDocumentDigest: string;
  inputDigest?: string;
  normalizedInput?: unknown;
  sourceContentDigests?: string[];
}): Promise<string> {
  const normalizedInput = input.normalizedInput ?? null;
  const normalizedDigests = normalizedInputDigests(normalizedInput);
  const value: Json = {
    schema: 'heavy-request-binding.v2',
    action: input.action,
    brandId: input.brandId,
    contentDigests: normalizedDigests.contentDigests,
    inputDigest: input.inputDigest ?? null,
    normalizedGenerationInputs: normalizedInput,
    requestId: input.requestId,
    rightsDocumentDigest: input.rightsDocumentDigest,
    rightsDocumentVersion: input.rightsDocumentVersion,
    rightsVersion: input.rightsVersion,
    sourceContentDigests: uniqueDigests([
      ...normalizedDigests.sourceContentDigests,
      ...(input.sourceContentDigests ?? []),
    ]),
    termsAcceptanceId: input.termsAcceptanceId,
    termsDocumentDigest: input.termsDocumentDigest,
    termsDocumentVersion: input.termsDocumentVersion,
    termsVersion: input.termsVersion,
    userId: input.userId,
  };
  return sha256(canonical(value));
}

function uniqueDigests(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)))]
    .map(value => value.toLowerCase()).sort();
}

/** Extract the exact reference/source byte digests from the normalized input. */
function normalizedInputDigests(value: unknown): { contentDigests: string[]; sourceContentDigests: string[] } {
  if (!isRecord(value)) return { contentDigests: [], sourceContentDigests: [] };
  const references = Array.isArray(value.references) ? value.references : [];
  const sourceAssets = Array.isArray(value.authorizedSourceAssets) ? value.authorizedSourceAssets : [];
  return {
    contentDigests: uniqueDigests([
      ...(Array.isArray(value.contentDigests) ? value.contentDigests : []),
      ...references.map(reference => isRecord(reference) ? reference.contentDigest : null),
    ]),
    sourceContentDigests: uniqueDigests([
      ...(Array.isArray(value.sourceContentDigests) ? value.sourceContentDigests : []),
      ...sourceAssets.map(asset => isRecord(asset) ? asset.contentDigest : null),
    ]),
  };
}

/** Source identities retained in a preparation record, excluding inline reference bytes. */
export function heavySourceContentDigests(value: unknown): string[] {
  return normalizedInputDigests(value).sourceContentDigests;
}

function readSourceDigests(value: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string' && /^[0-9a-f]{64}$/i.test(item))
      ? uniqueDigests(parsed)
      : null;
  } catch {
    return null;
  }
}

function samePreparationInput(row: PreparationRow, input: HeavyPreparationInput, normalizedInputJSON: string, sourceDigests: string[]): boolean {
  return row.user_id === input.userId && row.brand_id === input.brandId && row.action === input.action &&
    row.request_id === input.requestId && row.input_digest === input.inputDigest &&
    row.normalized_input === normalizedInputJSON && JSON.stringify(readSourceDigests(row.source_digests) ?? []) === JSON.stringify(sourceDigests);
}

async function preparationRow(env: Env, preparationId: string): Promise<PreparationRow | null> {
  return env.DB.prepare(`SELECT preparation_id,request_id,user_id,brand_id,action,input_digest,
      normalized_input,source_digests,expires_at,created_at
    FROM heavy_generation_preparations WHERE preparation_id=? LIMIT 1`)
    .bind(preparationId).first<PreparationRow>();
}

/** Verify the opaque proof against the authenticated owner and exact normalized input. */
export async function validateHeavyPreparation(env: Env, proof: HeavyPreparationProof): Promise<HeavyEntitlementReason | null> {
  if (!proof.preparationId) return proof.requirePreparation ? 'heavy_preparation_required' : null;
  if (!UUID.test(proof.preparationId)) return 'heavy_preparation_not_found';
  const row = await preparationRow(env, proof.preparationId);
  if (!row) return 'heavy_preparation_not_found';
  if (row.user_id !== proof.userId || row.brand_id !== proof.brandId || row.action !== proof.action || row.request_id !== proof.requestId) {
    return 'heavy_preparation_mismatch';
  }
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return 'heavy_preparation_expired';
  // Terms acceptance does not need the full provider body again; the opaque
  // preparation plus the caller's digest is sufficient to prove the exact
  // prepared input while keeping normalized input out of the response.
  if (!isRecord(proof.normalizedInput)) {
    return proof.inputDigest && proof.inputDigest.toLowerCase() === row.input_digest
      ? null
      : 'heavy_input_digest_mismatch';
  }
  const normalizedInputJSON = canonical(proof.normalizedInput);
  const normalizedInputDigest = await sha256(normalizedInputJSON);
  if (normalizedInputDigest !== row.input_digest || proof.inputDigest && proof.inputDigest.toLowerCase() !== row.input_digest) {
    return 'heavy_input_digest_mismatch';
  }
  if (row.normalized_input !== normalizedInputJSON) return 'heavy_preparation_mismatch';
  const expectedSourceDigests = heavySourceContentDigests(proof.normalizedInput);
  const storedSourceDigests = readSourceDigests(row.source_digests);
  if (!storedSourceDigests || JSON.stringify(storedSourceDigests) !== JSON.stringify(expectedSourceDigests)) {
    return 'heavy_preparation_mismatch';
  }
  return null;
}

export type HeavyPreparationWriteResult =
  | { ok: true; preparation: HeavyGenerationPreparation }
  | { ok: false; reason: HeavyEntitlementReason };

/** Create or reuse one short-lived preparation for an exact server-normalized request. */
export async function prepareHeavyGeneration(env: Env, input: HeavyPreparationInput): Promise<HeavyPreparationWriteResult> {
  const policy = heavyEntitlementPolicy(env);
  if (!entitlementEnabled(env)) return { ok: false, reason: 'heavy_generation_disabled' };
  const configurationError = policyError(policy);
  if (configurationError) return { ok: false, reason: configurationError };
  if (!UUID.test(input.requestId) || !input.action || !isRecord(input.normalizedInput) || !/^[0-9a-f]{64}$/i.test(input.inputDigest)) {
    return { ok: false, reason: 'heavy_preparation_mismatch' };
  }
  const normalizedInputJSON = canonical(input.normalizedInput);
  const normalizedInputDigest = await sha256(normalizedInputJSON);
  if (normalizedInputDigest !== input.inputDigest.toLowerCase()) return { ok: false, reason: 'heavy_input_digest_mismatch' };
  const sourceDigests = heavySourceContentDigests(input.normalizedInput);
  const latest = await env.DB.prepare(`SELECT preparation_id,request_id,user_id,brand_id,action,input_digest,
      normalized_input,source_digests,expires_at,created_at
    FROM heavy_generation_preparations WHERE request_id=? ORDER BY created_at DESC,preparation_id DESC LIMIT 1`)
    .bind(input.requestId).first<PreparationRow>();
  if (latest && (latest.user_id !== input.userId || latest.brand_id !== input.brandId || latest.action !== input.action)) {
    return { ok: false, reason: 'heavy_preparation_conflict' };
  }
  if (latest && Date.parse(latest.expires_at) > Date.now() && samePreparationInput(latest, input, normalizedInputJSON, sourceDigests)) {
    return { ok: true, preparation: {
      preparationId: latest.preparation_id, requestId: latest.request_id, inputDigest: latest.input_digest,
      expiresAt: latest.expires_at, policy,
    } };
  }
  if (latest && Date.parse(latest.expires_at) > Date.now()) return { ok: false, reason: 'heavy_preparation_conflict' };
  const now = new Date().toISOString();
  const preparationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PREPARATION_TTL_MS).toISOString();
  try {
    await env.DB.prepare(`INSERT INTO heavy_generation_preparations
      (preparation_id,request_id,user_id,brand_id,action,input_digest,normalized_input,source_digests,expires_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(preparationId, input.requestId, input.userId, input.brandId, input.action, normalizedInputDigest,
        normalizedInputJSON, JSON.stringify(sourceDigests), expiresAt, now).run();
  } catch {
    return { ok: false, reason: 'heavy_preparation_conflict' };
  }
  return { ok: true, preparation: { preparationId, requestId: input.requestId, inputDigest: normalizedInputDigest, expiresAt, policy } };
}

function parseNormalizedInput(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const blocked = (
  reason: HeavyEntitlementReason,
  policy: HeavyEntitlementPolicy,
  values: Partial<HeavyEntitlementResult> = {},
): HeavyEntitlementResult => ({
  allowed: false,
  reason,
  termsVersion: values.termsVersion ?? policy.termsVersion,
  termsDocumentVersion: values.termsDocumentVersion ?? policy.termsDocumentVersion,
  termsDocumentDigest: values.termsDocumentDigest ?? policy.termsDocumentDigest,
  rightsVersion: values.rightsVersion ?? policy.rightsVersion,
  rightsDocumentVersion: values.rightsDocumentVersion ?? policy.rightsDocumentVersion,
  rightsDocumentDigest: values.rightsDocumentDigest ?? policy.rightsDocumentDigest,
  termsAcceptanceId: values.termsAcceptanceId ?? null,
  rightsAttestationId: values.rightsAttestationId ?? null,
  requestBinding: values.requestBinding ?? null,
  inputDigest: values.inputDigest ?? null,
  requestScopedAttestationRequired: values.requestScopedAttestationRequired ?? true,
});

const permitted = (values: Omit<HeavyEntitlementResult, 'allowed' | 'reason'>): HeavyEntitlementResult => ({
  allowed: true,
  reason: null,
  ...values,
});

async function latestAcceptance(env: Env, userId: string, policy: HeavyEntitlementPolicy): Promise<AcceptanceRow | null> {
  if (!policy.termsVersion || !policy.termsDocumentVersion || !policy.termsDocumentDigest) return null;
  return env.DB.prepare(`SELECT id,user_id,terms_version,document_version,document_digest,accepted_at
    FROM heavy_terms_acceptances
    WHERE user_id=? AND terms_version=? AND document_version=? AND document_digest=?
    ORDER BY accepted_at DESC,id DESC LIMIT 1`)
    .bind(userId, policy.termsVersion, policy.termsDocumentVersion, policy.termsDocumentDigest)
    .first<AcceptanceRow>();
}

async function requestAttestation(
  env: Env,
  request: Required<Pick<HeavyEntitlementRequest, 'userId' | 'brandId' | 'action' | 'requestId'>>,
  policy: HeavyEntitlementPolicy,
): Promise<AttestationRow | null> {
  if (!policy.termsVersion || !policy.rightsVersion || !policy.rightsDocumentVersion || !policy.rightsDocumentDigest) return null;
  return env.DB.prepare(`SELECT id,request_id,user_id,brand_id,action,terms_acceptance_id,
      terms_version,rights_version,document_version,document_digest,request_binding,input_digest,normalized_input,attested_at
    FROM heavy_request_rights_attestations
    WHERE request_id=? AND user_id=? AND brand_id=? AND action=?
    LIMIT 1`)
    .bind(request.requestId, request.userId, request.brandId, request.action)
    .first<AttestationRow>();
}

function policyError(policy: HeavyEntitlementPolicy): HeavyEntitlementReason | null {
  if (!policy.termsVersion) return 'heavy_terms_version_unconfigured';
  if (!policy.termsDocumentVersion) return 'heavy_terms_document_version_unconfigured';
  if (!policy.termsDocumentDigest) return 'heavy_terms_document_digest_unconfigured';
  if (!policy.rightsVersion) return 'heavy_rights_version_unconfigured';
  if (!policy.rightsDocumentVersion) return 'heavy_rights_document_version_unconfigured';
  if (!policy.rightsDocumentDigest) return 'heavy_rights_document_digest_unconfigured';
  return null;
}

/** Resolve the exact request-scoped Heavy entitlement. Every failure is closed. */
export async function resolveHeavyEntitlement(env: Env, request: HeavyEntitlementRequest): Promise<HeavyEntitlementResult> {
  const policy = heavyEntitlementPolicy(env);
  if (!entitlementEnabled(env)) return blocked('heavy_generation_disabled', policy);
  const configurationError = policyError(policy);
  if (configurationError) return blocked(configurationError, policy);
  if (request.preparationId) {
    const preparationReason = await validateHeavyPreparation(env, {
      preparationId: request.preparationId,
      requestId: request.requestId ?? '',
      userId: request.userId,
      brandId: request.brandId,
      action: request.action,
      inputDigest: request.inputDigest,
      normalizedInput: request.normalizedInput,
      requirePreparation: request.requirePreparation,
    });
    if (preparationReason) return blocked(preparationReason, policy, { inputDigest: request.inputDigest ?? null });
  }
  const acceptance = await latestAcceptance(env, request.userId, policy);
  if (!acceptance) return blocked('heavy_terms_acceptance_required', policy);
  if (!request.requestId) return blocked('heavy_request_attestation_required', policy, { termsAcceptanceId: acceptance.id });
  const attestation = await requestAttestation(env, {
    userId: request.userId,
    brandId: request.brandId,
    action: request.action,
    requestId: request.requestId,
  }, policy);
  if (!attestation) {
    return blocked('heavy_rights_attestation_mismatch', policy, {
      termsAcceptanceId: acceptance.id,
      inputDigest: request.inputDigest ?? null,
    });
  }
  if (attestation.terms_acceptance_id !== acceptance.id ||
      attestation.terms_version !== policy.termsVersion ||
      attestation.rights_version !== policy.rightsVersion) {
    return blocked('heavy_rights_attestation_mismatch', policy, {
      termsAcceptanceId: acceptance.id,
      rightsAttestationId: attestation.id,
      inputDigest: attestation.input_digest,
    });
  }
  if (attestation.document_version !== policy.rightsDocumentVersion) {
    return blocked('heavy_rights_document_version_mismatch', policy, {
      termsAcceptanceId: acceptance.id,
      rightsAttestationId: attestation.id,
      inputDigest: attestation.input_digest,
    });
  }
  if (attestation.document_digest !== policy.rightsDocumentDigest) {
    return blocked('heavy_rights_document_digest_mismatch', policy, {
      termsAcceptanceId: acceptance.id,
      rightsAttestationId: attestation.id,
      inputDigest: attestation.input_digest,
    });
  }
  if (request.requirePreparation && !request.preparationId) {
    return blocked('heavy_preparation_required', policy, {
      termsAcceptanceId: acceptance.id,
      rightsAttestationId: attestation.id,
      inputDigest: attestation.input_digest,
    });
  }
  const normalizedInput = request.normalizedInput ?? parseNormalizedInput(attestation.normalized_input);
  if (!isRecord(normalizedInput)) {
    return blocked('heavy_request_binding_inputs_required', policy, {
      termsAcceptanceId: acceptance.id,
      rightsAttestationId: attestation.id,
      inputDigest: attestation.input_digest,
    });
  }
  const normalizedInputDigest = await sha256(canonical(normalizedInput));
  if (!attestation.input_digest || attestation.input_digest.toLowerCase() !== normalizedInputDigest) {
    return blocked('heavy_input_digest_mismatch', policy, {
      termsAcceptanceId: acceptance.id,
      rightsAttestationId: attestation.id,
      inputDigest: attestation.input_digest,
    });
  }
  if (request.inputDigest && request.inputDigest.toLowerCase() !== normalizedInputDigest) {
    return blocked('heavy_input_digest_mismatch', policy, {
      termsAcceptanceId: acceptance.id,
      rightsAttestationId: attestation.id,
      inputDigest: attestation.input_digest,
    });
  }
  const requestBinding = await computeHeavyRequestBinding({
    userId: request.userId,
    brandId: request.brandId,
    action: request.action,
    requestId: request.requestId,
    termsAcceptanceId: acceptance.id,
    termsVersion: policy.termsVersion!,
    termsDocumentVersion: policy.termsDocumentVersion!,
    termsDocumentDigest: policy.termsDocumentDigest!,
    rightsVersion: policy.rightsVersion!,
    rightsDocumentVersion: policy.rightsDocumentVersion!,
    rightsDocumentDigest: policy.rightsDocumentDigest!,
    inputDigest: normalizedInputDigest,
    normalizedInput,
  });
  if (attestation.request_binding !== requestBinding) {
    return blocked('heavy_request_binding_mismatch', policy, {
      termsAcceptanceId: acceptance.id,
      rightsAttestationId: attestation.id,
      requestBinding,
      inputDigest: attestation.input_digest,
    });
  }
  return permitted({
    termsVersion: policy.termsVersion,
    termsDocumentVersion: policy.termsDocumentVersion,
    termsDocumentDigest: policy.termsDocumentDigest,
    rightsVersion: policy.rightsVersion,
    rightsDocumentVersion: policy.rightsDocumentVersion,
    rightsDocumentDigest: policy.rightsDocumentDigest,
    termsAcceptanceId: acceptance.id,
    rightsAttestationId: attestation.id,
    requestBinding,
    inputDigest: attestation.input_digest,
    requestScopedAttestationRequired: false,
  });
}

/** Read-only UI/status resolution. A status read has no request ID. */
export async function resolveHeavyEntitlementStatus(
  env: Env,
  request: Omit<HeavyEntitlementRequest, 'requestId' | 'inputDigest'>,
): Promise<HeavyEntitlementResult> {
  return resolveHeavyEntitlement(env, request);
}

export type HeavyEntitlementWriteResult =
  | { ok: true; acceptanceId: string; acceptedAt: string; policy: HeavyEntitlementPolicy; attestationId?: string }
  | { ok: false; reason: HeavyEntitlementReason; attestationId?: string };

function validateExplicitDocuments(input: ExplicitDocumentInput, policy: HeavyEntitlementPolicy): HeavyEntitlementReason | null {
  const submittedVersion = documentVersion(input, 'terms');
  const submittedDigest = documentDigest(input, 'terms');
  if (!submittedVersion || submittedVersion !== policy.termsDocumentVersion) return 'heavy_terms_document_version_mismatch';
  if (!submittedDigest || submittedDigest !== policy.termsDocumentDigest) return 'heavy_terms_document_digest_mismatch';
  return null;
}

/** Record an explicit user terms acceptance; no legal text is generated here. */
export async function recordHeavyTermsAcceptance(env: Env, input: RecordAcceptanceInput): Promise<HeavyEntitlementWriteResult> {
  const policy = heavyEntitlementPolicy(env);
  if (!entitlementEnabled(env)) return { ok: false, reason: 'heavy_generation_disabled' };
  const configurationError = policyError(policy);
  if (configurationError) return { ok: false, reason: configurationError };
  const preparationReason = await validateHeavyPreparation(env, {
    preparationId: input.preparationId,
    requestId: input.requestId,
    userId: input.userId,
    brandId: input.brandId,
    action: input.action,
    inputDigest: input.inputDigest,
    requirePreparation: true,
  });
  if (preparationReason) return { ok: false, reason: preparationReason };
  if (input.termsAccepted !== true) return { ok: false, reason: 'heavy_terms_required' };
  const mismatch = validateExplicitDocuments(input, policy);
  if (mismatch) return { ok: false, reason: mismatch };
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const source = text(input.source) ?? 'heavy-explicit-api';
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(source)) return { ok: false, reason: 'heavy_terms_acceptance_invalid' };
  try {
    await env.DB.prepare(`INSERT INTO heavy_terms_acceptances
      (id,user_id,terms_version,document_version,document_digest,accepted_at,recorded_at,acceptance_source)
      VALUES(?,?,?,?,?,?,?,?)`)
      .bind(id, input.userId, policy.termsVersion, policy.termsDocumentVersion, policy.termsDocumentDigest, now, now, source).run();
  } catch {
    return { ok: false, reason: 'heavy_terms_acceptance_invalid' };
  }
  return { ok: true, acceptanceId: id, acceptedAt: now, policy };
}

async function acceptanceForPolicy(env: Env, userId: string, policy: HeavyEntitlementPolicy): Promise<AcceptanceRow | null> {
  return latestAcceptance(env, userId, policy);
}

/** Record one immutable request attestation bound to the server digest. */
export async function recordHeavyRequestAttestation(
  env: Env,
  input: RecordAttestationInput,
): Promise<HeavyEntitlementWriteResult> {
  const policy = heavyEntitlementPolicy(env);
  if (!entitlementEnabled(env)) return { ok: false, reason: 'heavy_generation_disabled' };
  const configurationError = policyError(policy);
  if (configurationError) return { ok: false, reason: configurationError };
  const preparationReason = await validateHeavyPreparation(env, {
    preparationId: input.preparationId,
    requestId: input.requestId,
    userId: input.userId,
    brandId: input.brandId,
    action: input.action,
    inputDigest: input.inputDigest,
    normalizedInput: input.normalizedInput,
    requirePreparation: true,
  });
  if (preparationReason) return { ok: false, reason: preparationReason };
  if (input.termsAccepted !== true) return { ok: false, reason: 'heavy_terms_required' };
  if (input.rightsAttested !== true) return { ok: false, reason: 'heavy_rights_attestation_required' };
  const termsMismatch = validateExplicitDocuments(input, policy);
  if (termsMismatch) return { ok: false, reason: termsMismatch };
  const rightsVersion = text(input.rightsVersion) ?? text(input.rightsAttestationVersion);
  const rightsDocVersion = documentVersion(input, 'rights');
  const rightsDocDigest = documentDigest(input, 'rights');
  if (!rightsVersion || rightsVersion !== policy.rightsVersion) return { ok: false, reason: 'heavy_rights_version_unconfigured' };
  if (!rightsDocVersion || rightsDocVersion !== policy.rightsDocumentVersion) return { ok: false, reason: 'heavy_rights_document_version_mismatch' };
  if (!rightsDocDigest || rightsDocDigest !== policy.rightsDocumentDigest) return { ok: false, reason: 'heavy_rights_document_digest_mismatch' };
  if (!/^[0-9a-f]{64}$/i.test(input.inputDigest)) return { ok: false, reason: 'heavy_input_digest_mismatch' };
  if (!isRecord(input.normalizedInput)) return { ok: false, reason: 'heavy_request_binding_inputs_required' };
  const normalizedInput = input.normalizedInput;
  const normalizedInputJSON = canonical(normalizedInput);
  const normalizedInputDigest = await sha256(normalizedInputJSON);
  if (normalizedInputDigest !== input.inputDigest.toLowerCase()) return { ok: false, reason: 'heavy_input_digest_mismatch' };
  const acceptance = await acceptanceForPolicy(env, input.userId, policy);
  if (!acceptance) return { ok: false, reason: 'heavy_terms_acceptance_required' };
  const requestBinding = await computeHeavyRequestBinding({
    userId: input.userId,
    brandId: input.brandId,
    action: input.action,
    requestId: input.requestId,
    termsAcceptanceId: acceptance.id,
    termsVersion: policy.termsVersion!,
    termsDocumentVersion: policy.termsDocumentVersion!,
    termsDocumentDigest: policy.termsDocumentDigest!,
    rightsVersion: policy.rightsVersion!,
    rightsDocumentVersion: policy.rightsDocumentVersion!,
    rightsDocumentDigest: policy.rightsDocumentDigest!,
    inputDigest: normalizedInputDigest,
    normalizedInput,
  });
  const existing = await env.DB.prepare(`SELECT id,user_id,brand_id,action,terms_acceptance_id,terms_version,rights_version,
      document_version,document_digest,input_digest,normalized_input,request_binding
    FROM heavy_request_rights_attestations WHERE request_id=? LIMIT 1`)
    .bind(input.requestId).first<AttestationRow>();
  if (existing) {
    const sameScope = existing.user_id === input.userId && existing.brand_id === input.brandId && existing.action === input.action &&
      existing.terms_acceptance_id === acceptance.id && existing.terms_version === policy.termsVersion &&
      existing.rights_version === policy.rightsVersion && existing.document_version === policy.rightsDocumentVersion &&
      existing.document_digest === policy.rightsDocumentDigest && existing.input_digest === normalizedInputDigest &&
      existing.normalized_input === normalizedInputJSON && existing.request_binding === requestBinding;
    return sameScope
      ? { ok: true, acceptanceId: acceptance.id, acceptedAt: acceptance.accepted_at, policy, attestationId: existing.id }
      : { ok: false, reason: 'heavy_request_attestation_conflict', attestationId: existing.id };
  }
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT INTO heavy_request_rights_attestations
      (id,request_id,user_id,brand_id,action,terms_acceptance_id,terms_version,rights_version,
       document_version,document_digest,request_binding,input_digest,normalized_input,attested_at,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), input.requestId, input.userId, input.brandId, input.action, acceptance.id,
        policy.termsVersion, policy.rightsVersion, policy.rightsDocumentVersion, policy.rightsDocumentDigest,
        requestBinding, normalizedInputDigest, normalizedInputJSON, now, now).run();
  } catch {
    const raced = await env.DB.prepare(`SELECT id,user_id,brand_id,action,terms_acceptance_id,terms_version,rights_version,
        document_version,document_digest,input_digest,normalized_input,request_binding
      FROM heavy_request_rights_attestations WHERE request_id=? LIMIT 1`)
      .bind(input.requestId).first<AttestationRow>();
    if (!raced || raced.user_id !== input.userId || raced.brand_id !== input.brandId || raced.action !== input.action ||
        raced.terms_acceptance_id !== acceptance.id || raced.terms_version !== policy.termsVersion ||
        raced.rights_version !== policy.rightsVersion || raced.document_version !== policy.rightsDocumentVersion ||
        raced.document_digest !== policy.rightsDocumentDigest || raced.input_digest !== normalizedInputDigest ||
        raced.normalized_input !== normalizedInputJSON || raced.request_binding !== requestBinding) {
      return { ok: false, reason: 'heavy_request_attestation_conflict', attestationId: raced?.id };
    }
    return { ok: true, acceptanceId: acceptance.id, acceptedAt: acceptance.accepted_at, policy, attestationId: raced.id };
  }
  const created = await env.DB.prepare('SELECT id FROM heavy_request_rights_attestations WHERE request_id=? LIMIT 1')
    .bind(input.requestId).first<{ id: string }>();
  return { ok: true, acceptanceId: acceptance.id, acceptedAt: now, policy, attestationId: created?.id };
}
