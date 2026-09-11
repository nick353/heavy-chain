import type { Brand } from '../types/database';

/**
 * Merge only brands already proven accessible by an owner or membership query.
 * Keeping this pure makes the session-recovery fallback easy to verify.
 */
export const mergeAccessibleBrands = (
  ownedBrands: Brand[] = [],
  memberBrands: Brand[] = [],
): Brand[] => {
  const byId = new Map<string, Brand>();
  for (const brand of [...ownedBrands, ...memberBrands]) {
    if (brand?.id) byId.set(brand.id, brand);
  }
  return Array.from(byId.values()).sort((a, b) => (
    (b.created_at || '').localeCompare(a.created_at || '')
  ));
};
