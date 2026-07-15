export type PrintingFoundationCase = {
  id: string;
  oracle: 'bit-exact' | 'tolerance' | 'ui-readback';
  focus: string;
};

/** Stage 0 procedural seed set. This is not the release realism corpus. */
export const PRINTING_FOUNDATION_CASES: readonly PrintingFoundationCase[] = [
  { id: 'rgba-ramp-identity', oracle: 'bit-exact', focus: 'rgba' },
  { id: 'one-pixel-alpha', oracle: 'bit-exact', focus: 'edge' },
  { id: 'fine-text-bitmap', oracle: 'bit-exact', focus: 'detail' },
  { id: 'qr-like-grid', oracle: 'bit-exact', focus: 'detail' },
  { id: 'transparent-exterior', oracle: 'bit-exact', focus: 'alpha' },
  { id: 'opaque-interior', oracle: 'bit-exact', focus: 'alpha' },
  { id: 'forbidden-precedence', oracle: 'bit-exact', focus: 'surface' },
  { id: 'occluder-precedence', oracle: 'bit-exact', focus: 'surface' },
  { id: 'conditional-disabled', oracle: 'bit-exact', focus: 'surface' },
  { id: 'conditional-enabled', oracle: 'bit-exact', focus: 'surface' },
  { id: 'semi-transparent-compose', oracle: 'tolerance', focus: 'alpha' },
  { id: 'fractional-scale', oracle: 'tolerance', focus: 'resampling' },
  { id: 'rotation-positive', oracle: 'tolerance', focus: 'resampling' },
  { id: 'rotation-negative', oracle: 'tolerance', focus: 'resampling' },
  { id: 'six-layer-order', oracle: 'ui-readback', focus: 'layers' },
  { id: 'history-two-results', oracle: 'ui-readback', focus: 'history' },
] as const;
