import type { MaterialReferenceState } from './workspaceMaterialReferences';

type FittingMaterialIdentityInput = Pick<
  MaterialReferenceState,
  'imageUrl' | 'sourceImageId' | 'sourceStoragePath'
>;

/**
 * Signed Gallery URLs are ephemeral. Use the durable Gallery identity when it
 * exists so re-signing a restored source does not look like a new material.
 * Local uploads have no durable identity, so their image data URL is the
 * fallback identity and a new upload can clear a prior persistence failure.
 */
export const getFittingMaterialIdentity = (
  material: FittingMaterialIdentityInput,
): string => {
  const sourceImageId = material.sourceImageId?.trim() ?? '';
  const sourceStoragePath = material.sourceStoragePath?.trim() ?? '';
  if (sourceImageId || sourceStoragePath) {
    return `durable:${sourceImageId}:${sourceStoragePath}`;
  }
  return `local:${material.imageUrl ?? ''}`;
};
