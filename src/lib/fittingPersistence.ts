import type { MaterialReferenceMetadata } from './workspaceMaterialReferences';

const LARGE_CUTOUT_DATA_URL_LENGTH = 100_000;

const isLargeDataUrl = (value: unknown) => (
  typeof value === 'string'
  && /^data:image\//i.test(value)
  && value.length >= LARGE_CUTOUT_DATA_URL_LENGTH
);

/**
 * Keep durable Fitting sources small enough for local artifact readback.
 * Signed Gallery URLs and bundled `/assets/...` files can be loaded again,
 * so their derived cutout data URL must not be duplicated into localStorage.
 * Local file data URLs are retained because they have no durable source path.
 */
export const compactFittingMaterialReferenceForPersistence = (
  reference: MaterialReferenceMetadata | undefined,
  sourceMaterialImageUrl: string | undefined,
): MaterialReferenceMetadata | undefined => {
  const hasDurableSource = /^(?:https?:\/\/|\/assets\/)/i.test(sourceMaterialImageUrl ?? '');
  if (!reference) return reference;

  if (!hasDurableSource) {
    if (!isLargeDataUrl(reference.imageUrl) && !isLargeDataUrl(reference.extractedImageUrl)) return reference;
    return {
      ...reference,
      hasImage: false,
      imageUrl: null,
      extractedImageUrl: null,
      extractedLayerReady: false,
      nextStepReady: false,
      note: [
        reference.note,
        'ローカル入力の大きなdata URLはlocalStorageへ保存せず、再開時に再アップロードが必要',
      ].filter(Boolean).join(' / '),
    };
  }

  if (
    typeof reference.extractedImageUrl !== 'string'
    || reference.extractedImageUrl.length < LARGE_CUTOUT_DATA_URL_LENGTH
  ) return reference;

  return {
    ...reference,
    extractedImageUrl: null,
    extractedLayerReady: false,
    nextStepReady: false,
    note: [
      reference.note,
      'remote Gallery素材の高精度切り抜きdata URLはlocalStorage容量保護のため保存せず、再読込時に再生成',
    ].filter(Boolean).join(' / '),
  };
};

/**
 * Prepare the browser-local Fitting draft without retaining a signed bearer URL.
 * A canonical Gallery path is enough to re-sign the source after reload; the
 * ephemeral URL must never become the durable draft identity.
 */
export const prepareFittingDraftMaterialReferenceForPersistence = (
  reference: MaterialReferenceMetadata | undefined,
  sourceMaterialImageUrl: string | undefined,
): MaterialReferenceMetadata | undefined => {
  if (!reference) return reference;
  void sourceMaterialImageUrl;

  const maxCutoutDataUrlBytes = typeof reference.cutoutMaxDataUrlBytes === 'number'
    && Number.isFinite(reference.cutoutMaxDataUrlBytes)
    && reference.cutoutMaxDataUrlBytes > 0
    ? reference.cutoutMaxDataUrlBytes
    : 750_000;
  const extractedImageUrl = reference.extractedImageUrl;
  const cutoutTooLarge = typeof extractedImageUrl === 'string'
    && isLargeDataUrl(extractedImageUrl)
    && extractedImageUrl.length > maxCutoutDataUrlBytes;
  const compacted: MaterialReferenceMetadata = cutoutTooLarge
    ? {
        ...reference,
        extractedImageUrl: null,
        extractedLayerReady: false,
        nextStepReady: false,
        note: [
          reference.note,
          'Fitting draftの切り抜きdata URLが保存上限を超えたため、素材復元後に再切り抜きが必要',
        ].filter(Boolean).join(' / '),
      }
    : reference;

  const canonicalSourcePath = typeof compacted.sourceStoragePath === 'string'
    && compacted.sourceStoragePath.trim()
    ? compacted.sourceStoragePath.trim()
    : null;

  return canonicalSourcePath
    ? { ...compacted, imageUrl: null, sourceStoragePath: canonicalSourcePath }
    : compacted;
};
