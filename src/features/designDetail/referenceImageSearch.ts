/**
 * Light's third confirmation step searches the web for reference images. Heavy searches free, keyless image indexes in
 * order (REFERENCE_IMAGE_SOURCES): Openverse first (Wikimedia Commons, Flickr and other open collections), then
 * Wikimedia Commons when Openverse is over its keyless rate limit, fails or finds too few. Both APIs and their image
 * files allow this page to read them directly (Access-Control-Allow-Origin: *), so no server relay is needed.
 *
 * Every image may be used commercially and changed (it is sent to the image AI as a reference), so Openverse is asked
 * for license_type=commercial,modification and anything with NC / ND is dropped again here; Commons only hosts such
 * licences. The creator and licence travel with each image and are shown under it (the licences require attribution).
 *
 * A source is a small object; another one (e.g. a garment photo library the owner chooses later) is added to the list.
 */
export type FoundImage = {
  id: string;
  title: string;
  /** Shown on the page. */
  thumbUrl: string;
  /** The larger file sent to the image AI when chosen (falls back to thumbUrl). */
  imageUrl?: string;
  /** The image's own page (credit link). */
  pageUrl: string;
  /** Short licence name, e.g. "CC BY-SA 2.0". */
  license: string;
  licenseUrl?: string;
  creator?: string;
  /** Which index found it (openverse / wikimedia). */
  source?: string;
};
type SearchOptions = { signal?: AbortSignal; fetcher?: typeof fetch };
export type ReferenceImageSource = {
  name: string;
  /** Images for the query, best first. Throws when the index cannot answer (rate limit, network, bad reply). */
  search(query: string, limit: number, options: SearchOptions): Promise<FoundImage[]>;
};

const BITMAP = /^image\/(jpeg|png|webp)$/;
const timeout = (options: SearchOptions, ms: number) => options.signal ?? AbortSignal.timeout(ms);

// ── Openverse (https://api.openverse.org, keyless: 20 searches a minute and 200 a day per visitor) ─────────────────
const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
/** Licences that allow commercial use and changes. */
const OPENVERSE_FREE = new Set(['by', 'by-sa', 'cc0', 'pdm']);
export const openverseLicenseName = (license: string, version = '') => {
  if (license === 'cc0') return 'CC0 1.0';
  if (license === 'pdm') return 'Public Domain Mark 1.0';
  return `CC ${license.toUpperCase()}${version ? ` ${version}` : ''}`;
};
export class ReferenceSourceError extends Error {
  readonly source: string;
  readonly status: number;
  constructor(source: string, status: number) { super(`reference_image_source_${source}_${status}`); this.source = source; this.status = status; }
}
export const openverseSource: ReferenceImageSource = {
  name: 'openverse',
  async search(query, limit, options) {
    const params = new URLSearchParams({ q: query, license_type: 'commercial,modification', mature: 'false', page_size: String(Math.min(20, Math.max(limit * 3, 12))) });
    const response = await (options.fetcher ?? fetch)(`${OPENVERSE_API}?${params}`, { signal: timeout(options, 12_000), credentials: 'omit' });
    if (!response.ok) throw new ReferenceSourceError('openverse', response.status);
    const data = await response.json() as { results?: Array<{ id?: string; title?: string; creator?: string | null; license?: string; license_version?: string;
      license_url?: string; foreign_landing_url?: string; url?: string; thumbnail?: string; source?: string; filetype?: string | null }> };
    if (!Array.isArray(data.results)) throw new ReferenceSourceError('openverse', 502);
    return data.results.flatMap((item) => {
      const license = String(item.license ?? '').toLowerCase();
      if (!item.id || !item.thumbnail || !OPENVERSE_FREE.has(license) || /(^|-)n[cd](-|$)/.test(license)) return [];
      if (item.filetype && !/^(jpe?g|png|webp)$/i.test(item.filetype)) return [];
      if (!/^https:\/\//.test(item.thumbnail) || (item.url && !/^https:\/\//.test(item.url))) return [];
      return [{ id: `openverse-${item.id}`, title: String(item.title ?? '').trim() || 'Untitled', thumbUrl: item.thumbnail, imageUrl: item.url || undefined,
        pageUrl: item.foreign_landing_url ?? '', license: openverseLicenseName(license, item.license_version ?? ''), licenseUrl: item.license_url,
        creator: item.creator?.trim() || undefined, source: 'openverse' }];
    });
  },
};

// ── Wikimedia Commons (MediaWiki API, origin=*) ──────────────────────────────────────────────────────────────────────
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIMEDIA_IMAGE = /^https:\/\/(?:thumb|upload)\.wikimedia\.org\//;
const plainText = (html = '') => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
async function commonsOnce(query: string, options: SearchOptions): Promise<FoundImage[]> {
  const params = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6',
    gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1024', format: 'json', origin: '*' });
  const response = await (options.fetcher ?? fetch)(`${COMMONS_API}?${params}`, { signal: timeout(options, 10_000), credentials: 'omit' });
  if (!response.ok) throw new ReferenceSourceError('wikimedia', response.status);
  const data = await response.json() as { query?: { pages?: Record<string, { pageid: number; index?: number; title: string;
    imageinfo?: Array<{ thumburl?: string; descriptionurl?: string; mime?: string; extmetadata?: { LicenseShortName?: { value?: string }; LicenseUrl?: { value?: string }; Artist?: { value?: string } } }> }> } };
  return Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !info.mime || !BITMAP.test(info.mime) || !WIKIMEDIA_IMAGE.test(info.thumburl)) return [];
    const creator = plainText(info.extmetadata?.Artist?.value).slice(0, 120);
    return [{ id: String(page.pageid), title: page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''), thumbUrl: info.thumburl,
      pageUrl: info.descriptionurl ?? '', license: info.extmetadata?.LicenseShortName?.value ?? '',
      ...(info.extmetadata?.LicenseUrl?.value ? { licenseUrl: info.extmetadata.LicenseUrl.value } : {}), ...(creator ? { creator } : {}), source: 'wikimedia' }];
  });
}
/** Commons matches every word, so a narrow query finds little: drop the last words, then the first ones
 * (a rare leading word such as "ditsy" finds nothing alone), until enough images whose title names the query are found. */
export const wikimediaSource: ReferenceImageSource = {
  name: 'wikimedia',
  async search(query, limit, options) {
    const words = query.trim().split(/\s+/).filter(Boolean);
    const queries = [...words.map((_, index) => words.slice(0, words.length - index).join(' ')),
      ...words.slice(1).map((_, index) => words.slice(index + 1).join(' '))];
    const stems = referenceStems(query);
    const named: FoundImage[] = [];
    const all: FoundImage[] = [];
    for (const attempt of queries) {
      if (named.length >= limit) break;
      for (const image of await commonsOnce(attempt, options)) {
        if (all.some((item) => item.id === image.id)) continue;
        all.push(image);
        if (titleNamesQuery(image.title, stems)) named.push(image);
      }
    }
    return all;
  },
};

/** Tried in order; a later source only answers when the earlier ones failed or found too few. */
export const REFERENCE_IMAGE_SOURCES: readonly ReferenceImageSource[] = [openverseSource, wikimediaSource];

/** A shortened or loose query also matches files about something else ("smocked" finds smock windmills, "high waist
 * skirt" an Empire clock), so images whose title names a word of the query come first; the others only fill the places
 * still empty at the end. */
export async function searchReferenceImages(query: string, options: { limit?: number; signal?: AbortSignal; fetcher?: typeof fetch; sources?: readonly ReferenceImageSource[] } = {}): Promise<FoundImage[]> {
  const limit = options.limit ?? 4;
  const stems = referenceStems(query);
  const found: FoundImage[] = [];
  const spare: FoundImage[] = [];
  const known = (image: FoundImage) => [...found, ...spare].some((item) => item.id === image.id || (item.imageUrl && item.imageUrl === image.imageUrl));
  let lastError: unknown = null;
  let answered = false;
  for (const source of options.sources ?? REFERENCE_IMAGE_SOURCES) {
    if (found.length >= limit) break;
    if (options.signal?.aborted) break;
    let images: FoundImage[];
    try { images = await source.search(query, limit - found.length, options); answered = true; }
    catch (error) { if (options.signal?.aborted) throw error; lastError = error; continue; }
    for (const image of images) {
      if (known(image)) continue;
      if (titleNamesQuery(image.title, stems)) { if (found.length < limit) found.push(image); }
      else spare.push(image);
    }
  }
  if (!answered && lastError) throw lastError;
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

/** "作者 / CC BY 4.0" under each found image (the licences require the credit). */
export function foundImageCredit(image: Pick<FoundImage, 'creator' | 'license'>): string {
  return [image.creator, image.license].filter(Boolean).join(' / ');
}

/** The chosen image becomes an ordinary chat reference (the same upload as a file from the computer): the larger file
 * first, the shown thumbnail when the larger one cannot be read. */
export async function foundImageFile(image: FoundImage, fetcher: typeof fetch = fetch): Promise<File> {
  const read = async (url: string) => {
    const response = await fetcher(url, { credentials: 'omit', signal: AbortSignal.timeout(20_000) });
    const blob = await response.blob();
    if (!response.ok || !BITMAP.test(blob.type)) throw new Error('reference_image_unavailable');
    return blob;
  };
  let blob: Blob;
  try { blob = await read(image.imageUrl || image.thumbUrl); }
  catch (error) { if (!image.imageUrl || image.imageUrl === image.thumbUrl) throw error; blob = await read(image.thumbUrl); }
  return new File([blob], `search-${image.id}.${blob.type.split('/')[1].replace('jpeg', 'jpg')}`, { type: blob.type });
}
