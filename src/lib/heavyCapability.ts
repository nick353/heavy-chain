/**
 * Heavy image-action capability contract for the Generate surface.
 *
 * Keep this map deliberately small and default-deny.  The Generate page may
 * still contain legacy Lightchain forms for other feature ids, but a Heavy
 * entitlement read or provider request must never be inferred for a feature
 * that is not explicitly admitted here.
 */

export const HEAVY_UNIMPLEMENTED_ACTION = 'heavy-unimplemented' as const;

export const HEAVY_CAPABILITY_ACTIONS = {
  'campaign-image': 'generate-image',
  'model-matrix': 'model-matrix',
  'design-gacha': HEAVY_UNIMPLEMENTED_ACTION,
  'product-shots': HEAVY_UNIMPLEMENTED_ACTION,
  'scene-coordinate': HEAVY_UNIMPLEMENTED_ACTION,
} as const;

export type HeavyCapabilityAction = (typeof HEAVY_CAPABILITY_ACTIONS)[keyof typeof HEAVY_CAPABILITY_ACTIONS];
export type HeavyEntitlementState = 'unsupported' | 'hydrating' | '401' | '403' | '5xx' | 'ready';

export type HeavyCapability = {
  featureId: string | null;
  action: HeavyCapabilityAction;
  supported: boolean;
};

export type HeavyEntitlementLike = {
  allowed?: boolean;
  reason?: string | null;
  termsVersion?: string | null;
  termsDocumentVersion?: string | null;
  termsDocumentDigest?: string | null;
  rightsVersion?: string | null;
  rightsDocumentVersion?: string | null;
  rightsDocumentDigest?: string | null;
};

const normalizeFeatureId = (featureId: unknown): string | null => {
  if (typeof featureId !== 'string') return null;
  const normalized = featureId.trim();
  return normalized || null;
};

/** Resolve one feature to its exact Heavy action. Unknown ids are denied. */
export const resolveHeavyCapability = (featureId: unknown): HeavyCapability => {
  const normalizedFeatureId = normalizeFeatureId(featureId);
  const action = normalizedFeatureId
    ? HEAVY_CAPABILITY_ACTIONS[normalizedFeatureId as keyof typeof HEAVY_CAPABILITY_ACTIONS] ?? HEAVY_UNIMPLEMENTED_ACTION
    : HEAVY_UNIMPLEMENTED_ACTION;
  return {
    featureId: normalizedFeatureId,
    action,
    supported: action !== HEAVY_UNIMPLEMENTED_ACTION,
  };
};

export const isHeavyCapabilitySupported = (featureId: unknown): boolean => (
  resolveHeavyCapability(featureId).supported
);

const errorText = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const candidate = error as { message?: unknown; status?: unknown; statusCode?: unknown; context?: { status?: unknown } };
  return [candidate.message, candidate.status, candidate.statusCode, candidate.context?.status]
    .filter((value) => value !== undefined && value !== null)
    .map(String)
    .join(' ');
};

/** Map an entitlement request failure to the closed UI state. */
export const classifyHeavyEntitlementError = (error: unknown): Exclude<HeavyEntitlementState, 'unsupported' | 'hydrating' | 'ready'> => {
  const text = errorText(error);
  if (/(?:^|[^0-9])401(?:[^0-9]|$)|unauthori[sz]ed|session_missing|auth_required/i.test(text)) return '401';
  if (/(?:^|[^0-9])403(?:[^0-9]|$)|forbidden|not_allowed|permission/i.test(text)) return '403';
  return '5xx';
};

const hasDocumentField = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

/**
 * A successful status read is only useful for the consent UI when both the
 * terms and rights policy documents are present.  `allowed` alone is not an
 * authorization proof and therefore does not make the state ready.
 */
export const hasHeavyTermsAndRightsPolicy = (status: HeavyEntitlementLike | null | undefined): boolean => (
  !!status
  && hasDocumentField(status.termsVersion)
  && hasDocumentField(status.termsDocumentVersion)
  && hasDocumentField(status.termsDocumentDigest)
  && hasDocumentField(status.rightsVersion)
  && hasDocumentField(status.rightsDocumentVersion)
  && hasDocumentField(status.rightsDocumentDigest)
  && status.reason !== 'heavy_generation_disabled'
);

export const isHeavyEntitlementReady = (status: HeavyEntitlementLike | null | undefined): boolean => (
  hasHeavyTermsAndRightsPolicy(status)
);

/** Closed state used by the page while retaining the server response reason. */
export const resolveHeavyEntitlementState = (
  capability: Pick<HeavyCapability, 'supported'>,
  status: HeavyEntitlementLike | null | undefined,
  loading: boolean,
  error?: unknown,
): HeavyEntitlementState => {
  if (!capability.supported) return 'unsupported';
  if (loading) return 'hydrating';
  if (error) return classifyHeavyEntitlementError(error);
  return status && hasHeavyTermsAndRightsPolicy(status) ? 'ready' : '5xx';
};

/**
 * Keep submit guards pure so UI tests can prove a denied feature has no effect
 * without mounting the full page or reaching a backend.
 */
export const canSubmitHeavyCapability = (input: {
  featureId: unknown;
  entitlementState: HeavyEntitlementState;
  termsAccepted: boolean;
  rightsAttested: boolean;
  userId?: unknown;
  brandId?: unknown;
  currentUserId?: unknown;
  currentBrandId?: unknown;
}): boolean => {
  const capability = resolveHeavyCapability(input.featureId);
  if (!capability.supported) return false;
  if (input.entitlementState !== 'ready') return false;
  if (!input.termsAccepted || !input.rightsAttested) return false;
  if (!input.userId || !input.brandId) return false;
  if (input.currentUserId !== undefined && input.currentUserId !== input.userId) return false;
  if (input.currentBrandId !== undefined && input.currentBrandId !== input.brandId) return false;
  return true;
};

export const HEAVY_UNIMPLEMENTED_MESSAGE = 'Heavyでは未提供';
