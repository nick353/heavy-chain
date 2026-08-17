import type { Brand } from '../types/database';

/**
 * Keep a previously verified brand during a transient empty refresh response.
 * A non-empty accessible-brand response still decides whether the selection is
 * valid, so a real membership change cannot silently broaden access.
 */
export const selectCurrentBrand = (selectedBrand: Brand | null, accessibleBrands: Brand[]): Brand | null => {
  if (accessibleBrands.length === 0 && selectedBrand) return selectedBrand;
  if (selectedBrand && accessibleBrands.some((brand) => brand.id === selectedBrand.id)) {
    return selectedBrand;
  }
  return accessibleBrands[0] || null;
};
