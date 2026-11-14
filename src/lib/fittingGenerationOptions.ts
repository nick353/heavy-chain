/**
 * AIフィッティング（model-matrix）の 比率 and 画質.
 *
 * The panel offers the same nine frames the server accepts and 1K / 2K / 4K, but until now neither reached the
 * request: the picture always came back in the server's default frame at its default size. スマート keeps the
 * server's own choice (it reads the garment photo), and 2K is what the server returns without a resolution, so
 * both are left out instead of being sent.
 */
export const FITTING_ASPECT_RATIOS = ['スマート', '1:1', '2:3', '3:2', '4:3', '3:4', '4:5', '5:4', '9:16', '16:9'] as const;
export const FITTING_RESOLUTIONS = ['1K', '2K', '4K'] as const;

/** The frames the server accepts (image-ai-contracts `ratios`); anything else would be rejected with 422. */
const SERVER_RATIOS = new Set(['1:1', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '2:3', '3:2']);

export function fittingGenerationOptions(
  aspectRatio: string | null | undefined,
  resolution: string | null | undefined,
): { aspectRatio?: string; resolution?: '1k' | '4k' } | undefined {
  const options: { aspectRatio?: string; resolution?: '1k' | '4k' } = {};
  if (typeof aspectRatio === 'string' && SERVER_RATIOS.has(aspectRatio)) options.aspectRatio = aspectRatio;
  if (resolution === '1K') options.resolution = '1k';
  else if (resolution === '4K') options.resolution = '4k';
  return Object.keys(options).length ? options : undefined;
}
