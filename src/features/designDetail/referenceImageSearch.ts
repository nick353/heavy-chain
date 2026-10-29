/**
 * Light's third confirmation step searches the web for reference images. Heavy uses Wikimedia Commons: free, no key,
 * freely licensed images, and both its API (origin=*) and its image files allow this page to read them directly.
 */
export type FoundImage = { id: string; title: string; thumbUrl: string; pageUrl: string; license: string };

const API = 'https://commons.wikimedia.org/w/api.php';
const BITMAP = /^image\/(jpeg|png|webp)$/;

export async function searchReferenceImages(query: string, options: { limit?: number; signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<FoundImage[]> {
  const params = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6',
    gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1024', format: 'json', origin: '*' });
  const response = await (options.fetcher ?? fetch)(`${API}?${params}`, { signal: options.signal ?? AbortSignal.timeout(10_000), credentials: 'omit' });
  if (!response.ok) throw new Error('reference_image_search_failed');
  const data = await response.json() as { query?: { pages?: Record<string, { pageid: number; index?: number; title: string;
    imageinfo?: Array<{ thumburl?: string; descriptionurl?: string; mime?: string; extmetadata?: { LicenseShortName?: { value?: string } } }> }> } };
  return Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !info.mime || !BITMAP.test(info.mime) || !/^https:\/\/upload\.wikimedia\.org\//.test(info.thumburl)) return [];
    return [{ id: String(page.pageid), title: page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''), thumbUrl: info.thumburl,
      pageUrl: info.descriptionurl ?? '', license: info.extmetadata?.LicenseShortName?.value ?? '' }];
  }).slice(0, options.limit ?? 4);
}

/** The chosen image becomes an ordinary chat reference (the same upload as a file from the computer). */
export async function foundImageFile(image: FoundImage, fetcher: typeof fetch = fetch): Promise<File> {
  const response = await fetcher(image.thumbUrl, { credentials: 'omit', signal: AbortSignal.timeout(20_000) });
  const blob = await response.blob();
  if (!response.ok || !BITMAP.test(blob.type)) throw new Error('reference_image_unavailable');
  return new File([blob], `search-${image.id}.${blob.type.split('/')[1].replace('jpeg', 'jpg')}`, { type: blob.type });
}
