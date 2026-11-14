/**
 * Yahoo!ショッピング 商品検索（v3）: real products for the planning agent (the owner chose it on 2026-11-12; Light's sources
 * are mostly real products: its 顧客提案 source index starts with 「EC実商品(収集 …)」). Spec read 2026-11-12 from
 * https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html: GET, JSON, `appid` (Client ID) required, at most 1
 * query per second (429 when exceeded), `results`, `image_size` (600 → `exImage`), `in_stock`, `sort` (-score).
 *
 * The terms the owner accepted: images stay on Yahoo!'s addresses (never copied to R2 or anywhere), each links to its
 * product page, and the Yahoo! credit HTML is shown unchanged wherever products are shown (the app does that). Without the
 * secret YAHOO_SHOPPING_APP_ID nothing is called and the agent works as before.
 */
export const YAHOO_ITEM_SEARCH_URL = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';
/** The spec's limit: 1 query per second. */
export const YAHOO_QUERY_INTERVAL_MS = 1100;
const YAHOO_TIMEOUT_MS = 8000;
export const YAHOO_RESULTS_PER_QUERY = 4;
export const YAHOO_MAX_QUERIES = 4;

export type ShopProduct = { name: string; url: string; price: number | null; image: string; store: string; query: string; at: string };
export type ShopSearch = { query: string; fallback?: string; needs?: string[] };
type YahooEnv = { YAHOO_SHOPPING_APP_ID?: string };
type Fetch = typeof fetch;

export const yahooShoppingConfigured = (env: YahooEnv) => !!env.YAHOO_SHOPPING_APP_ID?.trim();

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const httpsOn = (value: unknown, hosts: RegExp): value is string => {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && hosts.test(url.hostname); } catch { return false; }
};
/** Product pages are on Yahoo!'s shopping hosts (store.shopping.yahoo.co.jp, lohaco.yahoo.co.jp…), images on its image hosts. */
const PAGE_HOSTS = /(^|\.)yahoo\.co\.jp$/;
const IMAGE_HOSTS = /(^|\.)yimg\.jp$/;
const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** The collection date in Japan (the report's 「収集 YYYY-MM-DD」). */
export const japanDate = (now = new Date()) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

/** One hit as the app keeps it, or null when it has no product page, no image or no name on Yahoo!'s own hosts. */
export function yahooProduct(hit: unknown, query: string, at: string): ShopProduct | null {
  if (!record(hit)) return null;
  const exImage = record(hit.exImage) ? hit.exImage.url : undefined;
  const image = httpsOn(exImage, IMAGE_HOSTS) ? exImage : record(hit.image) && httpsOn(hit.image.medium, IMAGE_HOSTS) ? hit.image.medium as string : '';
  const name = clean(hit.name, 120);
  if (!name || !image || !httpsOn(hit.url, PAGE_HOSTS)) return null;
  const price = typeof hit.price === 'number' && Number.isSafeInteger(hit.price) && hit.price > 0 ? hit.price : null;
  return { name, url: hit.url, price, image, store: clean(record(hit.seller) ? hit.seller.name : '', 60), query: clean(query, 60), at };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Does this product answer the search? Yahoo! sorts by its own score and still answers a thin query with whatever it
 * ranks highest: production 2026-11-14, a 顧客提案 direction card cited 「水着 ¥2,090」, a swimsuit, for a direction about
 * something else. `needs` is what the search is for (the direction's own item), and a product whose name never names it
 * is dropped instead of padding the four cards. Without `needs` every product is kept, as before.
 */
export function shopProductNamesNeed(name: string, needs: readonly string[] | undefined): boolean {
  const words = (needs ?? []).map(word => word.trim()).filter(word => word.length >= 2);
  return !words.length || words.some(word => name.includes(word));
}

/**
 * Searches each query in turn, one query per second. A query that finds nothing tries its fallback (fewer words). A 429
 * or a failure stops the searches; what was found so far is kept. Never throws.
 */
export async function searchYahooProducts(
  env: YahooEnv, searches: ShopSearch[],
  options: { perQuery?: number; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<unknown>; now?: Date } = {},
): Promise<Array<{ query: string; products: ShopProduct[] }>> {
  const appid = env.YAHOO_SHOPPING_APP_ID?.trim();
  if (!appid) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? wait;
  const at = japanDate(options.now);
  const results: Array<{ query: string; products: ShopProduct[] }> = [];
  let calls = 0;
  let stopped = false;
  const search = async (query: string): Promise<ShopProduct[] | null> => {
    if (calls > 0) await sleep(YAHOO_QUERY_INTERVAL_MS);
    calls += 1;
    const params = new URLSearchParams({ appid, query, results: String(Math.min(10, options.perQuery ?? YAHOO_RESULTS_PER_QUERY)), image_size: '600', in_stock: 'true', sort: '-score' });
    try {
      const response = await fetchImpl(`${YAHOO_ITEM_SEARCH_URL}?${params}`, { signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS) });
      if (!response.ok) { console.warn('yahoo_shopping_upstream_error', response.status); return null; }
      const data = await response.json() as { hits?: unknown };
      return (Array.isArray(data.hits) ? data.hits : []).map(hit => yahooProduct(hit, query, at)).filter((item): item is ShopProduct => !!item);
    } catch {
      console.warn('yahoo_shopping_request_failed');
      return null;
    }
  };
  for (const entry of searches.slice(0, YAHOO_MAX_QUERIES)) {
    const query = clean(entry.query, 60);
    if (!query || stopped) continue;
    const needs = Array.isArray(entry.needs) ? entry.needs.filter((word): word is string => typeof word === 'string') : undefined;
    const fitting = (found: ShopProduct[] | null) => found && found.filter(product => shopProductNamesNeed(product.name, needs));
    let products = fitting(await search(query));
    const fallback = clean(entry.fallback, 60);
    // The fallback has fewer words, so it answers more loosely: it runs when the query itself found nothing at all, and
    // its products are held to the same need.
    if (products && !products.length && fallback && fallback !== query) products = fitting(await search(fallback));
    if (!products) { stopped = true; results.push({ query, products: [] }); continue; }
    results.push({ query, products });
  }
  return results;
}
