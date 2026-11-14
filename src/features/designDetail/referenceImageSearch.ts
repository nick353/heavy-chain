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
  /** The index's own tags (Openverse) or categories (Commons). Only used to rank the images here;
   * searchReferenceImages removes them before returning (the studio keeps found images on this device). */
  keywords?: string[];
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
/**
 * The owner registered an Openverse client on 2026-11-14, so the search goes through this app's own server when one is
 * registered here (setOpenverseRelay in main.tsx): the server holds the secret and the limit becomes about 100 a minute
 * and 10,000 a day for the whole site. The relay returns null when it cannot serve the search (no credentials on the
 * server, not signed in, or the route is missing), and then the search runs keylessly from this page exactly as before.
 */
export type OpenverseRelay = (params: URLSearchParams, signal: AbortSignal) => Promise<Response | null>;
let openverseRelay: OpenverseRelay | null = null;
export function setOpenverseRelay(relay: OpenverseRelay | null) { openverseRelay = relay; }
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
    const signal = timeout(options, 12_000);
    // The relay (this app's server, with the key) first; a caller that brings its own fetcher means its own call.
    let response: Response | null = null;
    if (openverseRelay && !options.fetcher) {
      try { response = await openverseRelay(params, signal); } catch { response = null; }
    }
    if (!response) response = await (options.fetcher ?? fetch)(`${OPENVERSE_API}?${params}`, { signal, credentials: 'omit' });
    if (!response.ok) throw new ReferenceSourceError('openverse', response.status);
    const data = await response.json() as { results?: Array<{ id?: string; title?: string; creator?: string | null; license?: string; license_version?: string;
      license_url?: string; foreign_landing_url?: string; url?: string; thumbnail?: string; source?: string; filetype?: string | null; category?: string | null;
      tags?: Array<{ name?: string }> | null }> };
    if (!Array.isArray(data.results)) throw new ReferenceSourceError('openverse', 502);
    return data.results.flatMap((item) => {
      const license = String(item.license ?? '').toLowerCase();
      if (!item.id || !item.thumbnail || !OPENVERSE_FREE.has(license) || /(^|-)n[cd](-|$)/.test(license)) return [];
      if (item.filetype && !/^(jpe?g|png|webp)$/i.test(item.filetype)) return [];
      // A scanned painting is not a garment reference (2026-11-13: a painting on linen came up for a linen search).
      if (item.category === 'digitized_artwork') return [];
      if (!/^https:\/\//.test(item.thumbnail) || (item.url && !/^https:\/\//.test(item.url))) return [];
      const keywords = (Array.isArray(item.tags) ? item.tags : []).map((tag) => String(tag?.name ?? '').trim()).filter(Boolean).slice(0, 40);
      return [{ id: `openverse-${item.id}`, title: plainText(String(item.title ?? '')) || 'Untitled', thumbUrl: item.thumbnail, imageUrl: item.url || undefined,
        pageUrl: item.foreign_landing_url ?? '', license: openverseLicenseName(license, item.license_version ?? ''), licenseUrl: item.license_url,
        creator: item.creator?.trim() || undefined, source: 'openverse', ...(keywords.length ? { keywords } : {}) }];
    });
  },
};

// ── Wikimedia Commons (MediaWiki API, origin=*) ──────────────────────────────────────────────────────────────────────
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIMEDIA_IMAGE = /^https:\/\/(?:thumb|upload)\.wikimedia\.org\//;
const plainText = (html = '') => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
async function commonsOnce(query: string, options: SearchOptions): Promise<FoundImage[]> {
  const params = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6',
    gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Categories',
    iiurlwidth: '1024', format: 'json', origin: '*' });
  const response = await (options.fetcher ?? fetch)(`${COMMONS_API}?${params}`, { signal: timeout(options, 10_000), credentials: 'omit' });
  if (!response.ok) throw new ReferenceSourceError('wikimedia', response.status);
  const data = await response.json() as { query?: { pages?: Record<string, { pageid: number; index?: number; title: string;
    imageinfo?: Array<{ thumburl?: string; descriptionurl?: string; mime?: string; extmetadata?: { LicenseShortName?: { value?: string }; LicenseUrl?: { value?: string }; Artist?: { value?: string };
      Categories?: { value?: string } } }> }> } };
  return Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !info.mime || !BITMAP.test(info.mime) || !WIKIMEDIA_IMAGE.test(info.thumburl)) return [];
    const creator = plainText(info.extmetadata?.Artist?.value).slice(0, 120);
    // The categories only: a description repeats the title ("Reencuentro del grupo Jeans"), so it cannot tell a pop group from jeans.
    const keywords = String(info.extmetadata?.Categories?.value ?? '').split('|').map((name) => name.trim()).filter(Boolean).slice(0, 30);
    return [{ id: String(page.pageid), title: page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''), thumbUrl: info.thumburl,
      pageUrl: info.descriptionurl ?? '', license: info.extmetadata?.LicenseShortName?.value ?? '',
      ...(info.extmetadata?.LicenseUrl?.value ? { licenseUrl: info.extmetadata.LicenseUrl.value } : {}), ...(creator ? { creator } : {}), source: 'wikimedia',
      ...(keywords.length ? { keywords } : {}) }];
  });
}
/** Commons matches every word, so a narrow query finds little: drop the last words, then the first ones
 * (a rare leading word such as "ditsy" finds nothing alone), until enough images whose title names the query are found.
 * For a garment query the shortened queries that still name the garment go first ("wide jeans" → "jeans" before
 * "wide", which finds the Wide Awake festival). */
export const wikimediaSource: ReferenceImageSource = {
  name: 'wikimedia',
  async search(query, limit, options) {
    const words = query.trim().split(/\s+/).filter(Boolean);
    const shortened = [...words.map((_, index) => words.slice(0, words.length - index).join(' ')),
      ...words.slice(1).map((_, index) => words.slice(index + 1).join(' '))];
    const namesGarment = (attempt: string) => referenceItemStems(attempt).length > 0;
    const queries = [...shortened.filter(namesGarment), ...shortened.filter((attempt) => !namesGarment(attempt))];
    const named: FoundImage[] = [];
    const all: FoundImage[] = [];
    for (const attempt of queries) {
      if (named.length >= limit) break;
      for (const image of await commonsOnce(attempt, options)) {
        if (all.some((item) => item.id === image.id)) continue;
        all.push(image);
        if (referenceImageFit(image, query) === 'named') named.push(image);
      }
    }
    return all;
  },
};

/** Tried in order; a later source only answers when the earlier ones failed or found too few. */
export const REFERENCE_IMAGE_SOURCES: readonly ReferenceImageSource[] = [openverseSource, wikimediaSource];

/** Images with the same title (one Flickr set: eleven photos of one "Linen Dress With Reverse-Applique") count as
 * naming the query this many times; the rest wait with the spare images so the other matching garments are shown too. */
export const REFERENCE_SAME_TITLE_LIMIT = 2;

/**
 * A shortened or loose query also matches files about something else ("smocked" finds smock windmills, "high waist
 * skirt" an Empire clock, "wide jeans" the Wide Awake festival, "natural linen" a sofa), so images whose title names the
 * query come first (#244; for a garment query, the garment itself: referenceImageFit). Files plainly about something
 * else (a concert, a sofa, a building, a logo) are dropped, and as long as too few images name the query the next
 * source is asked to fill the gap. The others only fill the places still empty at the end: titles that name the query
 * but are not about clothes (a pop group called Jeans), then garments and fabrics, images whose tags are about something
 * else last. A Japanese query is searched with its English garment words.
 */
export async function searchReferenceImages(query: string, options: { limit?: number; signal?: AbortSignal; fetcher?: typeof fetch; sources?: readonly ReferenceImageSource[] } = {}): Promise<FoundImage[]> {
  const limit = options.limit ?? 4;
  const searchQuery = englishReferenceQuery(query);
  const found: FoundImage[] = [];
  const spare: Record<'loose' | 'worn' | 'other' | 'aside', FoundImage[]> = { loose: [], worn: [], other: [], aside: [] };
  const seen: FoundImage[] = [];
  const known = (image: FoundImage) => seen.some((item) => item.id === image.id || (item.imageUrl && item.imageUrl === image.imageUrl));
  const sameTitle = (image: FoundImage) => found.filter((item) => item.title.trim().toLowerCase() === image.title.trim().toLowerCase()).length;
  let lastError: unknown = null;
  let answered = false;
  for (const source of options.sources ?? REFERENCE_IMAGE_SOURCES) {
    if (found.length >= limit) break;
    if (options.signal?.aborted) break;
    let images: FoundImage[];
    try { images = await source.search(searchQuery, limit - found.length, options); answered = true; }
    catch (error) { if (options.signal?.aborted) throw error; lastError = error; continue; }
    for (const image of images) {
      if (known(image)) continue;
      seen.push(image);
      const fit = referenceImageFit(image, searchQuery);
      if (fit === 'off') continue;
      if (fit === 'named' && found.length < limit && sameTitle(image) < REFERENCE_SAME_TITLE_LIMIT) found.push(image);
      else spare[fit === 'named' ? 'loose' : fit].push(image);
    }
  }
  if (!answered && lastError) throw lastError;
  return [...found, ...spare.loose, ...spare.worn, ...spare.other, ...spare.aside].slice(0, limit).map(({ keywords: _keywords, ...image }) => image);
}

// ── Does an image fit a clothing search? (2026-11-12: concerts, sofas and rugs ranked first) ────────────────────────
/** Something worn (garments, accessories, the parts of a garment). A query naming one is a garment query. */
const WORN_WORDS = ['dress', 'gown', 'robe', 'skirt', 'blouse', 'shirt', 'tshirt', 't shirt', 'tee', 'top', 'jacket', 'coat', 'raincoat', 'trench', 'parka', 'anorak',
  'blazer', 'cardigan', 'sweater', 'jumper', 'pullover', 'hoodie', 'sweatshirt', 'vest', 'waistcoat', 'tunic', 'kimono', 'yukata', 'smock', 'pinafore', 'overalls',
  'jumpsuit', 'romper', 'tracksuit', 'suit', 'pants', 'trousers', 'jeans', 'shorts', 'leggings', 'culottes', 'slacks', 'chinos', 'uniform', 'costume', 'outfit',
  'lingerie', 'swimsuit', 'bikini', 'scarf', 'shawl', 'poncho', 'cape', 'cloak', 'hat', 'cap', 'beret', 'beanie', 'bonnet', 'glove', 'mitten', 'sock', 'stocking',
  'tights', 'shoe', 'sneaker', 'boot', 'sandal', 'loafer', 'slipper', 'heels', 'bag', 'handbag', 'purse', 'tote', 'backpack', 'clutch', 'wallet', 'belt',
  'necklace', 'earring', 'bracelet', 'brooch', 'jewelry', 'jewellery', 'sunglasses', 'apron', 'sleeve', 'collar', 'cuff', 'neckline', 'hem', 'ruffle', 'frill', 'pleat'];
/** Worn words that also name other things (a smock mill, Cape Town, a car boot, an asteroid belt): they do not save a title that is about something else. */
const LOOSE_WORN_WORDS = new Set(['smock', 'cape', 'cap', 'boot', 'belt', 'suit', 'hem', 'cuff', 'collar', 'top', 'tee', 'bag', 'heels', 'tights', 'clutch']);
/** Words that say an image is about clothes or cloth without naming one garment. */
const CLOTH_WORDS = ['clothing', 'clothes', 'garment', 'apparel', 'fashion', 'wear', 'knitwear', 'menswear', 'womenswear', 'streetwear', 'sportswear', 'outerwear',
  'ootd', 'lookbook', 'runway', 'catwalk', 'model', 'wardrobe', 'sewing', 'sewn', 'handsewn', 'tailor', 'tailoring', 'dressmaking', 'knit', 'knitted', 'knitting',
  'crochet', 'crocheted', 'embroidery', 'embroidered', 'textile', 'fabric', 'cloth', 'lace', 'weave', 'woven', 'denim', 'linen', 'cotton', 'silk', 'wool', 'leather'];
/** Plainly other subjects: music on a stage, furniture and rooms, buildings, roads and places ("Smock PA Historic District"), logos and charts. */
const OFF_TOPIC_WORDS = ['concert', 'festival', 'gig', 'band', 'stage', 'singer', 'guitar', 'guitarist', 'drummer', 'drums', 'bassist', 'musician', 'orchestra',
  'choir', 'rapper', 'dj', 'microphone', 'sofa', 'couch', 'armchair', 'chair', 'rug', 'carpet', 'curtain', 'cushion', 'pillow', 'bedskirt', 'quilt', 'duvet',
  'bedding', 'mattress', 'upholstery', 'furniture', 'interior', 'bedroom', 'livingroom', 'tablecloth', 'building', 'architecture', 'church', 'cathedral', 'tower',
  'bridge', 'skyscraper', 'windmill', 'mill', 'station', 'railway', 'train', 'tram', 'bus', 'car', 'truck', 'motorway', 'highway', 'road', 'airport', 'ferris',
  'district', 'village', 'township', 'county', 'cemetery', 'crater', 'lunar', 'planet', 'asteroid', 'spacecraft', 'painting', 'oil on',
  'logo', 'icon', 'screenshot', 'website', 'web', 'www', 'diagram', 'chart', 'map', 'visualization', 'infographic', 'clock'];

/**
 * Words that only describe how something looks — colours, directions, patterns and the word for cloth itself. A title
 * that shares nothing but these is about its own subject, not about the query: production 2026-11-14,
 * 「ブルー×白の縦ストライプ生地」 ranked "Blue striped butterfly" and a striped fish first, both sharing only "blue" and
 * "striped". A motif named by a noun (#244's 「hydrangea watercolor blue」) is not one of these and still ranks first.
 */
const MODIFIER_WORDS = ['blue', 'white', 'black', 'red', 'green', 'yellow', 'pink', 'grey', 'gray', 'beige', 'brown', 'navy', 'purple', 'orange',
  'gold', 'silver', 'light', 'dark', 'pale', 'bright', 'deep', 'vertical', 'horizontal', 'diagonal', 'stripe', 'striped', 'stripes', 'plaid',
  'checked', 'checkered', 'dotted', 'polka', 'floral', 'plain', 'natural', 'soft', 'fine', 'vintage', 'classic', 'modern', 'simple',
  'pattern', 'print', 'texture', 'color', 'colour', 'fabric', 'cloth', 'textile', 'material'];

const plain = (text: string) => text.toLowerCase().replace(/[_-]+/g, ' ');
const wordPattern = (words: readonly string[]) => new RegExp(`(?:^|[^a-z])(?:${words.map((word) => word.replace(/ /g, '\\s')).join('|')})(?:s|es)?(?![a-z])`);
const WORN_PATTERN = wordPattern(WORN_WORDS);
const FIRM_WORN_PATTERN = wordPattern([...WORN_WORDS.filter((word) => !LOOSE_WORN_WORDS.has(word)), 'fashion', 'clothing', 'clothes', 'garment', 'apparel']);
const CLOTH_PATTERN = wordPattern(CLOTH_WORDS);
const OFF_TOPIC_PATTERN = wordPattern(OFF_TOPIC_WORDS);
const offTopicPatterns = new Map<string, { pattern: RegExp; words: string[] }>();
/** The other-subject words, less those the query itself uses ("vintage map print" keeps maps, "stage costume" stages). */
function offTopicFor(query: string) {
  const asked = new Set(query.toLowerCase().split(/[^a-z]+/).flatMap((word) => [word, word.replace(/e?s$/, ''), word.replace(/s$/, '')]));
  const key = [...asked].sort().join(' ');
  let entry = offTopicPatterns.get(key);
  if (!entry) {
    const words = OFF_TOPIC_WORDS.filter((word) => !asked.has(word));
    entry = { pattern: words.length === OFF_TOPIC_WORDS.length ? OFF_TOPIC_PATTERN : wordPattern(words.length ? words : ['\\b\\B']), words };
    if (offTopicPatterns.size > 200) offTopicPatterns.clear();
    offTopicPatterns.set(key, entry);
  }
  return entry;
}
const WORN_STEMS = new Set(WORN_WORDS.filter((word) => !word.includes(' ')).map((word) => word.slice(0, 5)));
/** The modifier words as referenceStems() cuts a query: four letters or more, the first five. */
const MODIFIER_STEMS = new Set(MODIFIER_WORDS.filter((word) => word.length >= 4).map((word) => word.slice(0, 5)));
/** Flickr tags run words together ("beachhousefurniture", "fashiondesign"): a long word inside one counts too. */
const keywordHas = (keywords: readonly string[], pattern: RegExp, words: readonly string[]) => keywords.some((keyword) => {
  const text = plain(keyword);
  return pattern.test(text) || (!text.includes(' ') && words.some((word) => word.length >= 6 && text.includes(word)));
});

/** The garment words of a query ("smocked puff sleeve" → smock, sleev; "wide jeans" → jeans). Empty for a fabric or motif query ("natural linen", "seigaiha pattern"). */
export function referenceItemStems(query: string): string[] {
  const stems = query.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 3).flatMap((word) => {
    // "shoes" → shoe, "hats" → hat, "dresses" → dress, "sandals" → sanda.
    for (const form of [word, word.replace(/e?s$/, ''), word.replace(/s$/, '')]) if (form.length >= 3 && WORN_STEMS.has(form.slice(0, 5))) return [form.slice(0, 5)];
    return [];
  });
  return [...new Set(stems)];
}
/** A five-letter stem matches the start of a word ("sleev" → sleeves); a shorter garment word only the whole word ("cap" is not "Capital", "hat" not "Hatfield"). */
const titleNamesItem = (title: string, stem: string) => new RegExp(stem.length < 5 ? `(?:^|[^a-z])${stem}(?:s|es)?(?![a-z])` : `(?:^|[^a-z])${stem}`).test(title);

/**
 * How an image fits the query:
 * - off: the title is plainly about something else (a festival, a sofa, a windmill) and names no garment — dropped.
 * - named: the title names the query — for a garment query the garment itself, at the start of a word (so "wide jeans"
 *   does not count "Wide Awake" or "World Wide Web"), or another word of the query on a title that names some garment;
 *   otherwise any word of the query, as #244 did. Shown first.
 * - loose: the title names the garment, but its Commons categories never mention clothes or cloth (the pop group
 *   "Grupo Jeans", "Smock PA Historic District"): the first of the spare images.
 * - worn / other / aside: spare images, in this order: about clothes or cloth (title or tags), neither, tags about something else.
 * Other-subject words that the query itself uses do not count.
 */
export function referenceImageFit(image: Pick<FoundImage, 'title' | 'keywords' | 'source'>, query: string): 'named' | 'loose' | 'worn' | 'other' | 'aside' | 'off' {
  const title = plain(image.title);
  const keywords = image.keywords ?? [];
  const offTopic = offTopicFor(query);
  if (offTopic.pattern.test(title) && !FIRM_WORN_PATTERN.test(title)) return 'off';
  const items = referenceItemStems(query);
  const stems = referenceStems(query);
  // A query with no English stems at all (a Japanese query the word list could not translate) names nothing: without
  // this, titleNamesQuery holds for every title and every image ranks first in the order the index returned it.
  const namesWord = stems.length > 0 && titleNamesQuery(image.title, stems);
  const keywordsCloth = keywordHas(keywords, WORN_PATTERN, WORN_WORDS) || keywordHas(keywords, CLOTH_PATTERN, CLOTH_WORDS);
  const cloth = WORN_PATTERN.test(title) || CLOTH_PATTERN.test(title) || keywordsCloth;
  // A fabric or motif query names no garment, so #244 counts any word of the query in the title. But a title that
  // shares only colours, directions and pattern words ("Blue striped butterfly" for 「ブルー×白の縦ストライプ生地」)
  // is about its own subject: it is named only when it is also about clothes or cloth. A motif noun still names it.
  const onlyModifiers = namesWord && stems.filter((stem) => titleNamesQuery(image.title, [stem])).every((stem) => MODIFIER_STEMS.has(stem));
  // A garment query: the garment itself, or another word of the query on a title that names a garment ("draped top" → "Draped silk blouse").
  const named = items.length ? items.some((stem) => titleNamesItem(title, stem)) || (namesWord && FIRM_WORN_PATTERN.test(title)) : namesWord && (cloth || !onlyModifiers);
  // A title naming the garment and also something else, whose own categories are not about clothes, is that other thing:
  // "Jeans crater" (categories "Jeans (lunar crater)", "Photos of the Moon"). A category that repeats the title does not count as clothes.
  if (named && keywords.length > 0 && offTopic.pattern.test(title)) {
    const ownKeywords = keywords.filter((keyword) => !offTopic.pattern.test(plain(keyword)));
    if (!keywordHas(ownKeywords, WORN_PATTERN, WORN_WORDS) && !keywordHas(ownKeywords, CLOTH_PATTERN, CLOTH_WORDS)) return 'off';
  }
  if (named) return items.length && image.source === 'wikimedia' && keywords.length > 0 && !keywordsCloth ? 'loose' : 'named';
  if (!cloth && keywordHas(keywords, offTopic.pattern, offTopic.words)) return 'aside';
  return cloth ? 'worn' : 'other';
}

/** The screens pass English search words, but a Japanese query (「リネンのワンピース」) finds almost nothing in these
 * English indexes: its garment, material and detail words are searched in English, in the same order. */
const JAPANESE_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['トレンチコート', 'trench coat'], ['レインコート', 'raincoat'], ['ワイドパンツ', 'wide pants'], ['ショートパンツ', 'shorts'], ['パフスリーブ', 'puff sleeve'],
  ['ワンピース', 'dress'], ['ドレス', 'dress'], ['ブラウス', 'blouse'], ['Tシャツ', 't-shirt'], ['シャツ', 'shirt'], ['スカート', 'skirt'], ['ジャケット', 'jacket'],
  ['コート', 'coat'], ['カーディガン', 'cardigan'], ['セーター', 'sweater'], ['ニット', 'knit'], ['パーカー', 'hoodie'], ['スウェット', 'sweatshirt'], ['ベスト', 'vest'],
  ['ジーンズ', 'jeans'], ['デニム', 'denim'], ['パンツ', 'pants'], ['ズボン', 'trousers'], ['スリーブ', 'sleeve'], ['袖', 'sleeve'], ['襟', 'collar'],
  ['スモッキング', 'smocked'], ['ギャザー', 'gathered'], ['プリーツ', 'pleated'], ['フリル', 'ruffle'], ['レース', 'lace'], ['刺繍', 'embroidered'], ['リネン', 'linen'],
  ['麻', 'linen'], ['コットン', 'cotton'], ['綿', 'cotton'], ['シルク', 'silk'], ['ウール', 'wool'], ['レザー', 'leather'], ['革', 'leather'], ['帽子', 'hat'],
  ['バッグ', 'bag'], ['スニーカー', 'sneakers'], ['サンダル', 'sandals'], ['ブーツ', 'boots'], ['靴', 'shoes'], ['着物', 'kimono'], ['浴衣', 'yukata'], ['制服', 'uniform'],
  ['雨', 'rain'], ['服', 'outfit'],
  // Fabric, motif and colour words. Without them a query of only these (「ブルー×白の縦ストライプ生地」) reached the
  // English indexes in Japanese. 「青海波」 comes before 「青」, so the wave pattern is not searched as "blue".
  ['青海波', 'seigaiha wave pattern'], ['縦ストライプ', 'vertical stripe'], ['横ストライプ', 'horizontal stripe'],
  ['ストライプ', 'stripe'], ['縞', 'stripe'], ['チェック', 'plaid'], ['格子', 'plaid'], ['水玉', 'polka dot'],
  ['ドット', 'polka dot'], ['花柄', 'floral'], ['無地', 'plain'], ['テキスタイル', 'textile'],
  ['生地', 'fabric'], ['布地', 'fabric'], ['布', 'cloth'], ['サテン', 'satin'], ['ベロア', 'velour'], ['ウール', 'wool'],
  ['ホワイト', 'white'], ['ブラック', 'black'], ['ブルー', 'blue'], ['ネイビー', 'navy'], ['グリーン', 'green'],
  ['イエロー', 'yellow'], ['ベージュ', 'beige'], ['ブラウン', 'brown'], ['グレー', 'grey'], ['ピンク', 'pink'],
  ['レッド', 'red'], ['白', 'white'], ['黒', 'black'], ['青', 'blue'], ['赤', 'red'], ['緑', 'green'], ['紺', 'navy'],
  ['茶', 'brown'], ['灰', 'grey'], ['黄', 'yellow'],
];
/** Longest first, so 「ワイドパンツ」 is wide pants rather than pants, and 「Tシャツ」 a t-shirt rather than a shirt. */
const JAPANESE_WORDS_LONGEST_FIRST = [...JAPANESE_WORDS].sort((a, b) => b[0].length - a[0].length);
export function englishReferenceQuery(query: string): string {
  if (/[a-z]/i.test(query.replace(/Tシャツ/g, ''))) return query;
  const words: string[] = [];
  for (let at = 0; at < query.length;) {
    const hit = JAPANESE_WORDS_LONGEST_FIRST.find(([japanese]) => query.startsWith(japanese, at));
    if (!hit) { at += 1; continue; }
    if (words[words.length - 1] !== hit[1]) words.push(hit[1]);
    at += hit[0].length;
  }
  return words.length ? words.join(' ') : query;
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
