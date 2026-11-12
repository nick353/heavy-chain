import test from 'node:test';
import assert from 'node:assert/strict';
import { YAHOO_ITEM_SEARCH_URL, YAHOO_QUERY_INTERVAL_MS, japanDate, searchYahooProducts, yahooProduct, yahooShoppingConfigured } from '../cloudflare/heavy-api/src/yahooShopping.ts';

// The owner chose Yahoo!ショッピング 商品検索 v3 for real products (2026-11-12). The key (Worker secret YAHOO_SHOPPING_APP_ID)
// is not there yet: without it nothing is called. The answers below follow the spec page's field names
// (https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html): hits[].name / url / price / image.medium /
// exImage.url / seller.name.

export const yahooHit = (n: number, extra: Record<string, unknown> = {}) => ({
  index: n, name: `リネンシャツ レディース ${n}`, url: `https://store.shopping.yahoo.co.jp/zozo/${n}.html`, price: 7990 + n, inStock: true,
  image: { small: `https://item-shopping.c.yimg.jp/i/c/zozo_${n}`, medium: `https://item-shopping.c.yimg.jp/i/g/zozo_${n}` },
  exImage: { url: `https://item-shopping.c.yimg.jp/i/n/zozo_${n}`, width: 600, height: 600 },
  seller: { sellerId: 'zozo', name: 'ZOZOTOWN Yahoo!店', url: 'https://store.shopping.yahoo.co.jp/zozo/' }, ...extra,
});
export const yahooAnswer = (hits: unknown[]) => Response.json({ totalResultsAvailable: hits.length, totalResultsReturned: hits.length, firstResultsPosition: 1, request: { query: 'q' }, hits });

test('without the key nothing is called', async () => {
  let called = 0;
  assert.equal(yahooShoppingConfigured({}), false);
  assert.equal(yahooShoppingConfigured({ YAHOO_SHOPPING_APP_ID: '  ' }), false);
  assert.deepEqual(await searchYahooProducts({}, [{ query: 'リネンシャツ' }], { fetchImpl: (async () => { called += 1; return yahooAnswer([]); }) as typeof fetch }), []);
  assert.equal(called, 0);
});

test('each query is one GET with the spec\'s parameters, one per second, and a hit keeps only Yahoo!\'s own addresses', async () => {
  const urls: URL[] = [];
  const slept: number[] = [];
  const fetchImpl = (async (url: string) => { urls.push(new URL(url)); return yahooAnswer([yahooHit(1), yahooHit(2, { exImage: undefined }), yahooHit(3, { url: 'https://evil.example/x' }), yahooHit(4, { image: { medium: 'http://item-shopping.c.yimg.jp/x' }, exImage: null }), yahooHit(5, { name: '' })]); }) as typeof fetch;
  const results = await searchYahooProducts({ YAHOO_SHOPPING_APP_ID: 'client-id-for-tests' }, [{ query: 'リネンシャツ レディース' }, { query: 'ワンピース' }],
    { fetchImpl, sleep: async (ms) => { slept.push(ms); }, now: new Date('2026-11-12T20:00:00Z') });
  assert.equal(urls.length, 2);
  assert.equal(`${urls[0].origin}${urls[0].pathname}`, YAHOO_ITEM_SEARCH_URL);
  assert.deepEqual(Object.fromEntries(urls[0].searchParams), { appid: 'client-id-for-tests', query: 'リネンシャツ レディース', results: '4', image_size: '600', in_stock: 'true', sort: '-score' });
  assert.deepEqual(slept, [YAHOO_QUERY_INTERVAL_MS]);
  assert.equal(YAHOO_QUERY_INTERVAL_MS >= 1000, true);
  // The 600px image when there is one, else the 146px one; hits off Yahoo!'s hosts, over http or without a name are dropped.
  assert.deepEqual(results[0].products, [
    { name: 'リネンシャツ レディース 1', url: 'https://store.shopping.yahoo.co.jp/zozo/1.html', price: 7991, image: 'https://item-shopping.c.yimg.jp/i/n/zozo_1', store: 'ZOZOTOWN Yahoo!店', query: 'リネンシャツ レディース', at: '2026-11-13' },
    { name: 'リネンシャツ レディース 2', url: 'https://store.shopping.yahoo.co.jp/zozo/2.html', price: 7992, image: 'https://item-shopping.c.yimg.jp/i/g/zozo_2', store: 'ZOZOTOWN Yahoo!店', query: 'リネンシャツ レディース', at: '2026-11-13' },
  ]);
  assert.equal(japanDate(new Date('2026-11-12T14:59:00Z')), '2026-11-12');
  assert.equal(yahooProduct(yahooHit(9, { price: 'free' }), 'q', 'd')?.price, null);
});

test('a query that finds nothing tries its fallback; a 429 stops the rest', async () => {
  const queries: string[] = [];
  const fetchImpl = (async (url: string) => {
    const query = new URL(url).searchParams.get('query')!;
    queries.push(query);
    if (query === 'ブラウス') return new Response('{}', { status: 429 });
    return yahooAnswer(query === 'レディース 透け感 シャツ' ? [] : [yahooHit(queries.length)]);
  }) as typeof fetch;
  const results = await searchYahooProducts({ YAHOO_SHOPPING_APP_ID: 'k' },
    [{ query: 'レディース 透け感 シャツ', fallback: 'レディース シャツ' }, { query: 'ブラウス' }, { query: 'スカート' }], { fetchImpl, sleep: async () => {} });
  assert.deepEqual(queries, ['レディース 透け感 シャツ', 'レディース シャツ', 'ブラウス']);
  assert.equal(results[0].products[0].query, 'レディース シャツ');
  assert.deepEqual(results.map(result => result.products.length), [1, 0]);
});
