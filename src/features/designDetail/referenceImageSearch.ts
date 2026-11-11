/**
 * Light's third confirmation step searches the web for reference images. Heavy uses Wikimedia Commons: free, no key,
 * freely licensed images, and both its API (origin=*) and its image files allow this page to read them directly.
 */
export type FoundImage = { id: string; title: string; thumbUrl: string; pageUrl: string; license: string };

const API = 'https://commons.wikimedia.org/w/api.php';
const BITMAP = /^image\/(jpeg|png|webp)$/;

const WIKIMEDIA_IMAGE = /^https:\/\/(?:thumb|upload)\.wikimedia\.org\//;

/** Commons matches every word, so a narrow query finds little: drop the last words, then the first ones
 * (a rare leading word such as "ditsy" finds nothing alone), until four images are found.
 * A shortened query also matches files about something else ("smocked" finds smock windmills, "high waist skirt" an Empire clock),
 * so images whose title names a word of the query come first; the others only fill the places still empty at the end. */
export async function searchReferenceImages(query: string, options: { limit?: number; signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<FoundImage[]> {
  const limit = options.limit ?? 4;
  const words = query.trim().split(/\s+/).filter(Boolean);
  const queries = [...words.map((_, index) => words.slice(0, words.length - index).join(' ')),
    ...words.slice(1).map((_, index) => words.slice(index + 1).join(' '))];
  const stems = referenceStems(query);
  const found: FoundImage[] = [];
  const spare: FoundImage[] = [];
  const known = (image: FoundImage) => found.some((item) => item.id === image.id) || spare.some((item) => item.id === image.id);
  for (const attempt of queries) {
    if (found.length >= limit) break;
    for (const image of await searchOnce(attempt, options)) {
      if (known(image)) continue;
      if (titleNamesQuery(image.title, stems)) { if (found.length < limit) found.push(image); }
      else spare.push(image);
    }
  }
  return [...found, ...spare].slice(0, limit);
}

/** The first five letters of each word of four letters or more ("smocked" → "smock", "blouse" → "blous"), so plurals and -ed forms match. */
export function referenceStems(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 4).map((word) => word.slice(0, 5)))];
}

export function titleNamesQuery(title: string, stems: string[]): boolean {
  const text = title.toLowerCase().replace(/[_-]+/g, ' ');
  return stems.length === 0 || stems.some((stem) => text.includes(stem));
}

async function searchOnce(query: string, options: { signal?: AbortSignal; fetcher?: typeof fetch }): Promise<FoundImage[]> {
  const params = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6',
    gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1024', format: 'json', origin: '*' });
  const response = await (options.fetcher ?? fetch)(`${API}?${params}`, { signal: options.signal ?? AbortSignal.timeout(10_000), credentials: 'omit' });
  if (!response.ok) throw new Error('reference_image_search_failed');
  const data = await response.json() as { query?: { pages?: Record<string, { pageid: number; index?: number; title: string;
    imageinfo?: Array<{ thumburl?: string; descriptionurl?: string; mime?: string; extmetadata?: { LicenseShortName?: { value?: string } } }> }> } };
  return Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !info.mime || !BITMAP.test(info.mime) || !WIKIMEDIA_IMAGE.test(info.thumburl)) return [];
    return [{ id: String(page.pageid), title: page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''), thumbUrl: info.thumburl,
      pageUrl: info.descriptionurl ?? '', license: info.extmetadata?.LicenseShortName?.value ?? '' }];
  });
}

/** The chosen image becomes an ordinary chat reference (the same upload as a file from the computer). */
export async function foundImageFile(image: FoundImage, fetcher: typeof fetch = fetch): Promise<File> {
  const response = await fetcher(image.thumbUrl, { credentials: 'omit', signal: AbortSignal.timeout(20_000) });
  const blob = await response.blob();
  if (!response.ok || !BITMAP.test(blob.type)) throw new Error('reference_image_unavailable');
  return new File([blob], `search-${image.id}.${blob.type.split('/')[1].replace('jpeg', 'jpg')}`, { type: blob.type });
}
