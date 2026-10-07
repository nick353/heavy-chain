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
