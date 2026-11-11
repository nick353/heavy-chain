import type { FashionStudioDetailAsset, FashionStudioSavedDetail } from './fashionStudioDetailHydration.ts';
import { STUDIO_EXAMPLES, type StudioFunctionId } from './fashionStudioExamples.ts';

/**
 * Light shows a function's example the moment it is chosen (about 1 s, nothing saved first); Heavy used to save the sample
 * garment, create the project and open it before anything appeared (about 9 s, 2026-11-12). The example now shows at once
 * from its bundled files while the project is created and saved behind it. Each role switches to its saved copy only after
 * that copy has loaded, so the canvas does not blink, and nothing can be generated or changed until the save has finished.
 */
export type StudioExamplePreview = { fn: StudioFunctionId; projectCode: string };
export type StudioExamplePreviewRoles = { main: boolean; reference: boolean };

/** Which roles still show the bundled example: a role stays until its saved copy is available and has loaded once. */
export const studioExamplePreviewRoles = (
  detail: Pick<FashionStudioSavedDetail, 'roles'>, fn: StudioFunctionId, loaded: { main: boolean; reference: boolean },
): StudioExamplePreviewRoles => ({
  main: !(detail.roles.main.status === 'available' && loaded.main),
  reference: Boolean(STUDIO_EXAMPLES[fn].reference) && !(detail.roles.reference.status === 'available' && loaded.reference),
});

/** The example's images by absolute address (the image resolver takes http(s) addresses as they are). */
export const studioExampleHoldUrls = (fn: StudioFunctionId, origin: string) => {
  const example = STUDIO_EXAMPLES[fn];
  return { main: new URL(example.main, origin).href, reference: example.reference ? new URL(example.reference, origin).href : undefined };
};

/** The detail the canvas draws: the saved detail with the example's bundled images in the roles still being saved. */
export const withStudioExamplePreview = (
  detail: FashionStudioSavedDetail, fn: StudioFunctionId, roles: StudioExamplePreviewRoles, origin: string,
): FashionStudioSavedDetail => {
  if (!roles.main && !roles.reference) return detail;
  const urls = studioExampleHoldUrls(fn, origin);
  const asset = (url: string): FashionStudioDetailAsset => ({ status: 'available', objectId: null, candidates: [url] });
  return { ...detail, roles: { ...detail.roles,
    ...(roles.main ? { main: asset(urls.main) } : {}),
    ...(roles.reference && urls.reference ? { reference: asset(urls.reference) } : {}) } };
};
