import type { Brand } from '../types/database';

export type AuthBrandResolutionStatus =
  | 'pending'
  | 'success_nonempty'
  | 'success_empty'
  | 'failure';

export type AuthBrandSelectionState = {
  status: AuthBrandResolutionStatus;
  userId: string | null;
  requestGeneration: number;
  confirmedBrandIds: readonly string[];
  error: string | null;
};

export type AuthBrandFenceSnapshot = {
  userId: string;
  brandId: string;
  requestGeneration: number;
  confirmedBrandIds: readonly string[];
};

export const INITIAL_AUTH_BRAND_SELECTION_STATE: AuthBrandSelectionState = {
  status: 'pending',
  userId: null,
  requestGeneration: 0,
  confirmedBrandIds: [],
  error: null,
};

const confirmedIdsFor = (brands: readonly Brand[]): string[] => (
  Array.from(new Set(brands.map((brand) => brand?.id).filter(Boolean)))
);

export const beginAuthBrandSelection = (
  previous: AuthBrandSelectionState,
  userId: string | null,
): AuthBrandSelectionState => ({
  status: 'pending',
  userId,
  requestGeneration: previous.requestGeneration + 1,
  confirmedBrandIds: [],
  error: null,
});

export const resolveAuthBrandSelection = (
  previous: AuthBrandSelectionState,
  userId: string,
  requestGeneration: number,
  brands: readonly Brand[],
): AuthBrandSelectionState => {
  if (previous.userId !== userId || previous.requestGeneration !== requestGeneration) return previous;
  const confirmedBrandIds = confirmedIdsFor(brands);
  return {
    status: confirmedBrandIds.length > 0 ? 'success_nonempty' : 'success_empty',
    userId,
    requestGeneration,
    confirmedBrandIds,
    error: null,
  };
};

export const failAuthBrandSelection = (
  previous: AuthBrandSelectionState,
  userId: string,
  requestGeneration: number,
  error: unknown,
): AuthBrandSelectionState => {
  if (previous.userId !== userId || previous.requestGeneration !== requestGeneration) return previous;
  return {
    status: 'failure',
    userId,
    requestGeneration,
    confirmedBrandIds: [],
    error: error instanceof Error ? error.message : String(error || 'auth_brand_refresh_failed'),
  };
};

export const canSelectConfirmedBrand = (
  state: AuthBrandSelectionState,
  userId: string | null,
  brandId: string | null,
): boolean => (
  Boolean(
    state.status === 'success_nonempty'
      && userId
      && state.userId === userId
      && brandId
      && state.confirmedBrandIds.includes(brandId),
  )
);

export const selectCurrentBrand = (
  selectedBrand: Brand | null,
  accessibleBrands: readonly Brand[],
): Brand | null => {
  if (selectedBrand) {
    const confirmedSelection = accessibleBrands.find((brand) => brand.id === selectedBrand.id);
    if (confirmedSelection) return confirmedSelection;
  }
  return accessibleBrands[0] || null;
};

export const captureAuthBrandFence = (
  state: AuthBrandSelectionState,
  userId: string | null,
  brandId: string | null,
): AuthBrandFenceSnapshot | null => {
  if (!canSelectConfirmedBrand(state, userId, brandId) || !userId || !brandId) return null;
  return {
    userId,
    brandId,
    requestGeneration: state.requestGeneration,
    confirmedBrandIds: [...state.confirmedBrandIds],
  };
};

export const isAuthBrandFenceValid = (
  captured: AuthBrandFenceSnapshot | null,
  current: AuthBrandFenceSnapshot | null,
): boolean => Boolean(
  captured
    && current
    && captured.userId === current.userId
    && captured.brandId === current.brandId
    && captured.requestGeneration === current.requestGeneration
    && captured.confirmedBrandIds.length === current.confirmedBrandIds.length
    && captured.confirmedBrandIds.every((brandId) => current.confirmedBrandIds.includes(brandId)),
);

export class AuthBrandAccessFenceError extends Error {
  readonly code = 'auth_brand_access_fence_revoked';

  constructor(phase: string) {
    super(`auth_brand_access_fence_revoked:${phase}`);
    this.name = 'AuthBrandAccessFenceError';
  }
}

export const assertAuthBrandFence = (
  captured: AuthBrandFenceSnapshot | null,
  current: AuthBrandFenceSnapshot | null,
  phase: string,
): void => {
  if (!isAuthBrandFenceValid(captured, current)) throw new AuthBrandAccessFenceError(phase);
};
