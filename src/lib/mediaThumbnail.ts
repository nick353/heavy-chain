/**
 * Grid previews: asks the media gateway for its 384px WebP of the same signed image. Any other URL (data, blob, static
 * asset, external) is returned unchanged, so callers can apply it to whatever a card shows.
 */
export function thumbnailImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.pathname !== '/v1/media/read' || !parsed.searchParams.get('token')) return url;
    parsed.searchParams.set('variant', 'thumb');
    return parsed.toString();
  } catch {
    return url;
  }
}

/** The edge the gateway's own thumbnails use, so a kept preview is no heavier than a signed one. */
const KEPT_PREVIEW_EDGE = 384;

/**
 * A preview that outlives the object URL it was drawn from. The print history shows the garment a run started from,
 * but an uploaded garment is only an object URL, and the workspace revokes it as soon as the slot is filled again —
 * which is what happens when a finished run reopens the page (production 2026-11-15: the finished row's preview tile
 * was blank and the console held ERR_FILE_NOT_FOUND). Uploaded garments carry no storage path, so there is no signed
 * URL to fall back to; the image is instead drawn once, at thumbnail size, into a data URL the panel can keep.
 * Returns null when the image can no longer be read, so callers can leave the tile out rather than show a broken one.
 */
export async function keptPreviewUrl(url: string, maxEdge = KEPT_PREVIEW_EDGE): Promise<string | null> {
  if (!url.startsWith('blob:')) return url;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) return null;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.8);
  } catch {
    return null;
  }
}
