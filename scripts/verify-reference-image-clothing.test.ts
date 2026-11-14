import test from 'node:test';
import assert from 'node:assert/strict';
import { englishReferenceQuery, referenceImageFit, referenceItemStems, searchReferenceImages, wikimediaSource } from '../src/features/designDetail/referenceImageSearch.ts';

// 2026-11-12: inspiration's reference images showed concert photos ("wide jeans" → the Wide Awake festival on Commons)
// and fabric searches sofas and rugs ("natural linen"). The answers below are the titles and tags those searches returned.
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const openverseItem = (id: string, title: string, tags: string[] = []) => ({
  id, title, creator: `creator ${id}`, license: 'by', license_version: '2.0', license_url: 'https://creativecommons.org/licenses/by/2.0/',
  foreign_landing_url: `https://www.flickr.com/photos/x/${id}`, url: `https://live.staticflickr.com/${id}_b.jpg`,
  thumbnail: `https://api.openverse.org/v1/images/${id}/thumb/`, source: 'flickr', filetype: null, tags: tags.map((name) => ({ name })),
});
type CommonsFile = string | { title: string; categories?: string[]; description?: string };
/** Openverse answers `openverse` to every search; Commons answers per search (the words without " filetype:bitmap"). */
const indexes = (openverse: ReturnType<typeof openverseItem>[], commons: Record<string, CommonsFile[]>) => {
  const openverseQueries: string[] = [];
  const commonsQueries: string[] = [];
  let id = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.host === 'api.openverse.org') { openverseQueries.push(url.searchParams.get('q') ?? ''); return json({ result_count: openverse.length, results: openverse }); }
    const search = (url.searchParams.get('gsrsearch') ?? '').replace(/ filetype:bitmap$/, '');
    commonsQueries.push(search);
    const pages = Object.fromEntries((commons[search] ?? []).map((file, index) => {
      id += 1;
      const { title, categories, description } = typeof file === 'string' ? { title: file } : file;
      return [String(id), { pageid: id, index, title: `File:${title}.jpg`, imageinfo: [{ thumburl: `https://upload.wikimedia.org/${id}.jpg`, descriptionurl: '', mime: 'image/jpeg',
        extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, ...(categories ? { Categories: { value: categories.join('|') } } : {}),
          ...(description ? { ImageDescription: { value: description } } : {}) } }] }];
    }));
    return json({ query: { pages } });
  }) as typeof fetch;
  return { fetcher, openverseQueries, commonsQueries };
};

test('"wide jeans" shows jeans, not the Wide Awake festival or the World Wide Web, and Commons fills the places left (inspiration, 4 images)', async () => {
  const { fetcher, commonsQueries } = indexes([
    openverseItem('1', 'Wetherspoon - The Royal Enfield - The Old Cinema', ['abccinema', 'artdeco']),
    openverseItem('2', 'Eiffel Tower and Pont Alexandre III', ['bridge', 'eiffeltower']),
    openverseItem('3', 'Wide Leg Jeans', ['instagramapp']),
  ], {
    'wide jeans': ['High waisted jeans 1435042736'],
    wide: ['The Murder Capital at the Wide Awake Festival (51427965005)', 'World Wide Web Foundation Logo',
      { title: 'WideAwake030921 (202 of 307) (51424503934)', categories: ['Wide Awake Festival 2021'] }],
    jeans: ['Bobson Baggy Jeans from the SM Store at SM City Cebu (2024-08-18)', 'Jeans (AM 1)'],
  });
  const found = await searchReferenceImages('wide jeans', { fetcher, limit: 4 });
  assert.deepEqual(found.map((image) => image.title), ['Wide Leg Jeans', 'High waisted jeans 1435042736', 'Bobson Baggy Jeans from the SM Store at SM City Cebu (2024-08-18)', 'Jeans (AM 1)']);
  // Commons tries the shortened query that still names the garment first, and never needs "wide" (the festival) here.
  assert.deepEqual(commonsQueries, ['wide jeans', 'jeans']);
});

test('when too few jeans are found, the festival and the logo are still left out and tags about a festival come last', async () => {
  const { fetcher } = indexes([openverseItem('3', 'Wide Leg Jeans')], {
    wide: ['The Murder Capital at the Wide Awake Festival (51427965005)', 'World Wide Web Foundation Logo',
      { title: 'WideAwake030921 (202 of 307) (51424503934)', categories: ['Wide Awake Festival 2021'] }, 'Portrait of a woman, 1890'],
  });
  const found = await searchReferenceImages('wide jeans', { fetcher, limit: 12 });
  assert.deepEqual(found.map((image) => image.title), ['Wide Leg Jeans', 'Portrait of a woman, 1890', 'WideAwake030921 (202 of 307) (51424503934)']);
});

test('a title naming the garment whose Commons categories never mention clothes (the pop group "Jeans") comes after the garments', async () => {
  const { fetcher } = indexes([], {
    'wide jeans': [{ title: 'Grupo Jeans Reencuentro', categories: ['JNS', '4 women', 'Still images of YouTube videos'], description: 'Reencuentro del grupo Jeans: Karla, Melissa, Angie y Regina.' },
      { title: 'Jeans 2009', categories: ['Jeans', 'Clothing shops in 2009'] }],
    jeans: [{ title: 'Jeans mexicanos', categories: ['Jeans'] }, { title: 'Max Giesinger - 2021-09-12 - Mannheim', categories: ['Men with handheld microphones in Germany', 'Festivalsommer 2021'] }],
  });
  const found = await searchReferenceImages('wide jeans', { fetcher, limit: 4, sources: [wikimediaSource] });
  assert.deepEqual(found.map((image) => image.title), ['Jeans 2009', 'Jeans mexicanos', 'Grupo Jeans Reencuentro', 'Max Giesinger - 2021-09-12 - Mannheim']);
});

test('"natural linen" (a fabric) drops the sofa and the rug and keeps the cloth, refilling from Commons', async () => {
  const { fetcher } = indexes([
    openverseItem('1', 'Modern Sofa in Natural Linen', ['beachhousefurniture', 'furniture', 'interior']),
    openverseItem('2', 'Soumack Rug with our Natural Linen bedskirt and a pretty striped quilt'),
    openverseItem('3', 'striped linen natural', ['background', 'fabric', 'linen', 'textile', 'upholstery']),
    openverseItem('4', 'Summer House Lounge Chair', ['fabric', 'furniture']),
  ], { 'natural linen': ['Natural linen fabric texture', 'Natural linen weave (AM 2)'] });
  const found = await searchReferenceImages('natural linen', { fetcher, limit: 4 });
  assert.deepEqual(found.map((image) => image.title), ['striped linen natural', 'Natural linen fabric texture', 'Natural linen weave (AM 2)']);
});

test('spare images: clothes in the tags first, unrelated next, tags about a concert or furniture last', async () => {
  const { fetcher } = indexes([
    openverseItem('1', 'Linen dress'),
    openverseItem('2', 'Saturday night', ['concert', 'livemusic']),
    openverseItem('3', 'Sunset walk'),
    openverseItem('4', 'Summer afternoon', ['fashion', 'dresses']),
  ], {});
  const found = await searchReferenceImages('linen dress', { fetcher, limit: 4 });
  assert.deepEqual(found.map((image) => image.title), ['Linen dress', 'Summer afternoon', 'Sunset walk', 'Saturday night']);
});

test('one photo set with the same title fills two places; the other garments come before its other photos', async () => {
  const { fetcher } = indexes([
    ...['a', 'b', 'c', 'd', 'e'].map((id) => openverseItem(id, 'Linen Dress With Reverse-Applique', ['dress'])),
    openverseItem('f', 'Linen shirt dress'),
  ], { 'linen dress': ['Linen dress (AM 1)'] });
  const found = await searchReferenceImages('linen dress', { fetcher, limit: 4 });
  assert.deepEqual(found.map((image) => image.title), ['Linen Dress With Reverse-Applique', 'Linen Dress With Reverse-Applique', 'Linen shirt dress', 'Linen dress (AM 1)']);
});

test('a Japanese request is searched with its English garment words', async () => {
  const { fetcher, openverseQueries } = indexes(['A', 'B', 'C', 'D'].map((id) => openverseItem(id, `Linen dress ${id}`)), {});
  await searchReferenceImages('リネンのワンピース', { fetcher });
  assert.deepEqual(openverseQueries, ['linen dress']);
  assert.equal(englishReferenceQuery('雨の日の通勤服'), 'rain outfit');
  assert.equal(englishReferenceQuery('スモッキングのパフスリーブ'), 'smocked puff sleeve');
  assert.equal(englishReferenceQuery('ニットのカーディガン'), 'knit cardigan');
  assert.equal(englishReferenceQuery('デニムのワイドパンツ'), 'denim wide pants');
  // Colours, patterns and the word for cloth are searched too (2026-11-14): without them 「ブルー×白の縦ストライプ生地」
  // reached the English indexes in Japanese and found a butterfly and a fish.
  assert.equal(englishReferenceQuery('白いTシャツ'), 'white t-shirt');
  assert.equal(englishReferenceQuery('ブルー×白の縦ストライプ生地'), 'blue white vertical stripe fabric');
  assert.equal(englishReferenceQuery('青海波の柄'), 'seigaiha wave pattern');
  // English search words (what the screens pass) and Japanese without a known word stay as they are.
  assert.equal(englishReferenceQuery('draped blouse'), 'draped blouse');
  assert.equal(englishReferenceQuery('星空'), '星空');
});

test('Openverse titles lose their markup', async () => {
  const { fetcher } = indexes([openverseItem('1', "<div class='fn'> Green Pleated Linen Dress</div>")], {});
  const found = await searchReferenceImages('linen dress', { fetcher, limit: 1 });
  assert.equal(found[0].title, 'Green Pleated Linen Dress');
});

test('the tags used to rank are not kept on the returned images', async () => {
  const { fetcher } = indexes([openverseItem('1', 'Linen dress', ['dress', 'linen'])], { 'linen dress': [{ title: 'Linen dress (AM 1)', categories: ['Dresses'] }] });
  const found = await searchReferenceImages('linen dress', { fetcher, limit: 2 });
  assert.equal(found.length, 2);
  assert.ok(found.every((image) => !('keywords' in image)));
});

test('how a title fits: the garment itself, not a shared adjective; a garment word saves a title, a loose one (smock mill) does not', () => {
  assert.deepEqual(referenceItemStems('smocked puff sleeve'), ['smock', 'sleev']);
  assert.deepEqual(referenceItemStems('black leather sandals'), ['sanda']);
  assert.deepEqual(referenceItemStems('natural linen'), []);
  assert.equal(referenceImageFit({ title: 'The Murder Capital at the Wide Awake Festival' }, 'wide jeans'), 'off');
  assert.equal(referenceImageFit({ title: 'Kurt Cobain\'s cardigan from MTV Unplugged' }, 'knit cardigan'), 'named');
  assert.equal(referenceImageFit({ title: 'Smock mill at Sint-Annaland' }, 'smocked blouse'), 'off');
  assert.equal(referenceImageFit({ title: 'Smock PA Historic District' }, 'smocked puff sleeve'), 'off');
  assert.equal(referenceImageFit({ title: 'A traditional smock', keywords: ['Self-published work', 'Smock'], source: 'wikimedia' }, 'smocked puff sleeve'), 'named');
  assert.equal(referenceImageFit({ title: 'Stage costume, 1920s' }, 'smocked blouse'), 'worn');
  assert.equal(referenceImageFit({ title: 'Wide leg trousers' }, 'wide jeans'), 'named');
  assert.equal(referenceImageFit({ title: 'Draped silk blouse' }, 'draped top'), 'named');
  assert.equal(referenceImageFit({ title: 'The Murder Capital live' }, 'baseball cap'), 'other');
  assert.equal(referenceImageFit({ title: 'Hatfield House' }, 'straw hat'), 'other');
  assert.equal(referenceImageFit({ title: 'Untitled', keywords: ['beachhousefurniture'] }, 'natural linen'), 'aside');
  assert.equal(referenceImageFit({ title: 'Untitled', keywords: ['fashiondesign', 'concert'] }, 'natural linen'), 'worn');
  // A word of the query is never another subject: a map print search keeps maps, a linen dress search does not.
  assert.equal(referenceImageFit({ title: 'Old map of Edo' }, 'vintage map print'), 'other');
  assert.equal(referenceImageFit({ title: 'Old map of Edo' }, 'linen dress'), 'off');
  // A motif search keeps #244: any word of the query in the title.
  assert.equal(referenceImageFit({ title: 'Blue hydrangea' }, 'hydrangea watercolor blue'), 'named');
});

// 2026-11-14 (production, 素材検索): 「ブルー×白の縦ストライプ生地」 returned three butterflies and a fish. The word list had no
// entry for 「生地」, 「ストライプ」 or the colours, so the Japanese query reached the English indexes unchanged — and a query
// with no English stems made titleNamesQuery hold for every title, so every image ranked first in the index's own order.
test('a fabric or colour query keeps the cloth and drops the butterfly and the fish that share only its colour and pattern words', () => {
  const query = englishReferenceQuery('ブルー×白の縦ストライプ生地');
  assert.equal(query, 'blue white vertical stripe fabric');
  assert.equal(referenceImageFit({ title: 'Blue striped butterfly on a leaf' }, query), 'other');
  assert.equal(referenceImageFit({ title: 'Striped fish, blue and white' }, query), 'other');
  assert.equal(referenceImageFit({ title: 'Blue and white striped cotton fabric' }, query), 'named');
  assert.equal(referenceImageFit({ title: 'Striped shirt, 1950s' }, query), 'named');
  assert.equal(referenceImageFit({ title: 'Untitled', keywords: ['handwoven', 'textile'] }, query), 'worn');
  // A motif named by a noun still ranks first, as #244 asks: the shared word is not only a colour or a pattern.
  assert.equal(referenceImageFit({ title: 'Blue hydrangea' }, 'hydrangea watercolor blue'), 'named');
  assert.equal(referenceImageFit({ title: 'Seigaiha wave pattern on paper' }, englishReferenceQuery('青海波の柄')), 'named');
  // A Japanese query the list cannot translate names nothing at all: cloth leads, the rest keeps the index's order.
  assert.equal(referenceImageFit({ title: 'Blue striped butterfly' }, '謎の素材'), 'other');
  assert.equal(referenceImageFit({ title: 'Linen cloth, undyed' }, '謎の素材'), 'worn');
});
