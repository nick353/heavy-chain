/**
 * Heavy image-action capability contract for the Generate surface.
 *
 * Keep this map explicit and default-deny. Every non-video image workflow is
 * translated to one of the small canonical provider-action values that the
 * API actually persists; unknown ids never fall through to Light.
 * Feature-specific prompts and metadata stay on the client, while the server
 * still owns auth, brand, quota, idempotency, provider and storage checks.
 */

export const HEAVY_UNIMPLEMENTED_ACTION = 'heavy-unimplemented' as const;

export const HEAVY_CAPABILITY_ACTIONS = {
  'campaign-image': 'generate-image',
  'model-matrix': 'model-matrix',
  'design-gacha': 'generate-image',
  'product-shots': 'generate-image',
  'scene-coordinate': 'edit-image',
  'marketing-home': 'edit-image',
  'marketing-detail': 'edit-image',
  'fitting-clothing-reference': 'edit-image',
  'fitting-background-reference': 'edit-image',
  'wear-design-lab': 'edit-image',
  'wear-design-detail': 'edit-image',
  'fashion-studio': 'edit-image',
  'design-agent': 'edit-image',
  lab: 'edit-image',
  'print-design-project': 'edit-image',
  'print-design-detail': 'edit-image',
  'fabric-image': 'edit-image',
  'line-generation': 'edit-image',
  'line-to-real': 'edit-image',
  'pattern-vector': 'edit-image',
  'pattern-vector-pro': 'edit-image',
  'printing-image': 'edit-image',
  'image-repair': 'edit-image',
  'svg-convert': 'edit-image',
  'custom-style': 'edit-image',
  'ai-fitting': 'model-matrix',
  'ai-fitting-reference': 'model-matrix',
  'model-library': 'model-matrix',
  'model-face': 'model-matrix',
  'model-change': 'model-matrix',
  'body-shape': 'model-matrix',
  'clothing-size': 'model-matrix',
  'pose-change': 'model-matrix',
  'background-change': 'model-matrix',
  'angle-change': 'model-matrix',
  'model-custom': 'model-matrix',
} as const;

/**
 * Heavy owns every non-video image feature plus the legacy entry ids. Unknown
 * ids remain closed instead of falling through to the Light surface.
 */
export const HEAVY_OWNED_FEATURE_IDS: ReadonlySet<string> = new Set([
  ...Object.keys(HEAVY_CAPABILITY_ACTIONS),
]);

export type HeavyCapabilityAction = (typeof HEAVY_CAPABILITY_ACTIONS)[keyof typeof HEAVY_CAPABILITY_ACTIONS] | typeof HEAVY_UNIMPLEMENTED_ACTION;
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

/** Resolve whether a feature belongs to the Heavy entitlement surface. */
export const isHeavyOwnedFeature = (featureId: unknown): boolean => {
  const normalizedFeatureId = normalizeFeatureId(featureId);
  return normalizedFeatureId !== null && HEAVY_OWNED_FEATURE_IDS.has(normalizedFeatureId);
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

/**
 * Heavy image generation is login-first.  The policy/document fields below
 * remain on the type because older receipts and compatibility endpoints still
 * expose them, but they are not a user-facing prerequisite for a new image
 * request.  The authenticated server still owns membership, quota, safety,
 * idempotency, and private persistence checks.
 */
export const hasHeavyTermsAndRightsPolicy = (status: HeavyEntitlementLike | null | undefined): boolean => (
  !!status && status.reason !== 'heavy_generation_disabled'
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
  /** Legacy compatibility fields; they no longer gate Heavy image submit. */
  termsAccepted?: boolean;
  rightsAttested?: boolean;
  userId?: unknown;
  brandId?: unknown;
  currentUserId?: unknown;
  currentBrandId?: unknown;
}): boolean => {
  const capability = resolveHeavyCapability(input.featureId);
  if (!capability.supported) return false;
  if (input.entitlementState !== 'ready') return false;
  if (!input.userId || !input.brandId) return false;
  if (input.currentUserId !== undefined && input.currentUserId !== input.userId) return false;
  if (input.currentBrandId !== undefined && input.currentBrandId !== input.brandId) return false;
  return true;
};

export const HEAVY_UNIMPLEMENTED_MESSAGE = 'Heavyでは未提供';
