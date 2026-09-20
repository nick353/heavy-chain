/**
 * Current source-product feature access readback.
 *
 * This is deliberately separate from upload-rights confirmation. The latest
 * source Light Chain readback admits the fabric input surface for the observed
 * account, while generation permission remains a separate fail-closed gate.
 * There is no user-facing toggle or rights checkbox here.
 */

export type LightchainSourceFeatureId = 'fabric-image' | 'printing-image' | 'model-matrix';
export type LightchainSourceFeatureAccess = 'admitted' | 'denied' | 'unknown';
export type LightchainSourceGenerationAccess = 'permitted' | 'denied' | 'unknown';

const OBSERVED_SOURCE_FEATURE_ACCESS: Readonly<Partial<Record<LightchainSourceFeatureId, LightchainSourceFeatureAccess>>> = Object.freeze({
  // Fresh source readback r4 on 2026-09-20: /tools/fabric exposed both
  // upload inputs and the separate 「権限がありません」 generation gate.
  'fabric-image': 'admitted',
  // Fresh source readback r4 on 2026-09-20: /model exposed its input tabs and
  // materials while the generation permission surface was denied.
  'model-matrix': 'admitted',
});

const OBSERVED_SOURCE_GENERATION_ACCESS: Readonly<Partial<Record<LightchainSourceFeatureId, LightchainSourceGenerationAccess>>> = Object.freeze({
  // The same fresh source readback exposed the input controls but rendered
  // 「権限がありません」 instead of a generation action.
  'fabric-image': 'denied',
  'model-matrix': 'denied',
});

export function getLightchainSourceFeatureAccess(
  featureId: LightchainSourceFeatureId,
): LightchainSourceFeatureAccess {
  return OBSERVED_SOURCE_FEATURE_ACCESS[featureId] ?? 'unknown';
}

export function getLightchainSourceGenerationAccess(
  featureId: LightchainSourceFeatureId,
): LightchainSourceGenerationAccess {
  return OBSERVED_SOURCE_GENERATION_ACCESS[featureId] ?? 'unknown';
}
