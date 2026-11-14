import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceStems, searchReferenceImages, titleNamesQuery, wikimediaSource } from '../src/features/designDetail/referenceImageSearch.ts';

// These cases are the Wikimedia Commons source (Openverse comes first; its own cases are in verify-reference-image-openverse).
const sources = [wikimediaSource];

// One Commons answer per search: the titles of the files it finds.
const commons = (answers: Record<string, string[]>) => {
  const calls: string[] = [];
  let id = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const search = (url.searchParams.get('gsrsearch') ?? '').replace(/ filetype:bitmap$/, '');
    calls.push(search);
    const pages = Object.fromEntries((answers[search] ?? []).map((title, index) => {
      id += 1;
      return [String(id), { pageid: id, index, title: `File:${title}.jpg`, imageinfo: [{ thumburl: `https://upload.wikimedia.org/${id}.jpg`, descriptionurl: '', mime: 'image/jpeg' }] }];
    }));
    return new Response(JSON.stringify({ query: { pages } }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetcher };
};

test('a shortened query that finds smock windmills keeps the garments first (the 2026-11-12 production search)', async () => {
  const { calls, fetcher } = commons({
    'smocked puff sleeve': [],
    'smocked puff': ['Erica (Thorp) de Berry to Thorp family, 5 May 1918'],
    smocked: ['DK Fanoe Windmill01', 'A traditional smock', 'Smock', 'Great Western Windmill'],
    'puff sleeve': ['Blouse with puff sleeves (AM 1969)', 'Sketch of a French Empire style clock'],
  });
  const found = await searchReferenceImages('smocked puff sleeve', { fetcher, sources });
  assert.deepEqual(found.map((image) => image.title), ['A traditional smock', 'Smock', 'Blouse with puff sleeves (AM 1969)', 'Erica (Thorp) de Berry to Thorp family, 5 May 1918']);
  // Every shortened query is still tried in the same order as before.
  assert.deepEqual(calls, ['smocked puff sleeve', 'smocked puff', 'smocked', 'puff sleeve', 'sleeve']);
});

test('when the titles name the query the search stops as soon as four are found', async () => {
  const { calls, fetcher } = commons({ 'yellow blouse': ['Yellow blouse (47220578952)', 'Degas - Two Dancers with Yellow Blouses', 'Blouse (AM 2015.51.4-4)', 'Blouse (AM 2015.51.4-2)', 'Isparta museum woman churning'] });
  const found = await searchReferenceImages('yellow blouse', { fetcher, sources });
  assert.equal(found.length, 4);
  assert.ok(found.every((image) => /blouse/i.test(image.title)));
  assert.deepEqual(calls, ['yellow blouse']);
});

test('files about something else still fill the places that would otherwise stay empty', async () => {
  const { fetcher } = commons({ 'butter yellow blouse': [], 'butter yellow': ['Isparta museum woman churning 4978', 'Isparta museum woman churning 4977'] });
  const found = await searchReferenceImages('butter yellow blouse', { fetcher, sources });
  assert.deepEqual(found.map((image) => image.title), ['Isparta museum woman churning 4978', 'Isparta museum woman churning 4977']);
});

test('the title check reads plurals, -ed forms and dashes', () => {
  assert.deepEqual(referenceStems('Smocked puff-sleeve blouse'), ['smock', 'puff', 'sleev', 'blous']);
  assert.equal(titleNamesQuery('High-waisted black skirt', referenceStems('high waist skirt')), true);
  assert.equal(titleNamesQuery('Great Western Windmill', referenceStems('smocked')), false);
  // Short words alone (「red」) cannot judge a title, so every image counts as before.
  assert.equal(titleNamesQuery('Anything', referenceStems('red')), true);
});

// 2026-11-15 production: 「ブルー×白の縦ストライプ生地」 no longer returns butterflies (#321), but the fourth place of
// 「薄手コットンのシャツ地」 held a species description. Spare images still fill the empty places (2026-11-12); what
// changes here is that a species plate is read as being about something else, like a windmill or a crater.
test('a species description is left out, however the describing author is spelled', async () => {
  // 「薄手コットンのシャツ地」 → "cotton shirt". Commons returned a species description as the fourth file:
  // "Poplin" there is the describing author (Poplin and Lund 2002), not the cloth.
  const { fetcher } = commons({ 'cotton shirt': [
    "Coat, Man's, Cotton, W-R Rip-Stop, Poplin, OG 107, Class 1 - 100% Cotton P01",
    "Coat, Man's, Cotton, W-R Rip-Stop, Poplin, OG 107, Class 1 - 100% Cotton P02",
    "Coat, Man's, Cotton, W-R Rip-Stop, Poplin, OG 107, Class 1 - 100% Cotton P03",
    'Kalops diophrys Poplin and Lund 2002',
  ] });
  const found = await searchReferenceImages('cotton shirt', { fetcher, sources });
  assert.ok(!found.some((image) => /Kalops/.test(image.title)), 'the species description is not shown beside three coats');
  assert.equal(found.length, 3);
});

test('a pattern dated in its title is not read as a species description', async () => {
  const { fetcher } = commons({ 'seigaiha pattern': ['Seigaiha pattern Japan 1900'] });
  const found = await searchReferenceImages('seigaiha pattern', { fetcher, sources });
  assert.deepEqual(found.map((image) => image.title), ['Seigaiha pattern Japan 1900']);
});

test('a fabric pattern named in the title still fills a place (Pinstripe)', async () => {
  // 「ブルー×白のピンストライプ生地」 → "blue white stripe fabric". "Pinstripe" is the one image the owner wants, and
  // it names no garment and shares no whole word with the query: it has to survive on the cloth words alone.
  const { fetcher } = commons({ 'blue white stripe fabric': [
    'Sample Swatch of Fabric From Rogers Peet Company (page 1)',
    'Sample Swatch of Fabric From Rogers Peet Company (page 2)',
    'Sample Swatch of Fabric From Rogers Peet Company (page 4)',
    'Pinstripe',
    'Blue striped butterfly',
  ] });
  const found = await searchReferenceImages('blue white stripe fabric', { fetcher, sources });
  assert.ok(found.some((image) => image.title === 'Pinstripe'), 'a fabric pattern is kept');
  assert.ok(!found.some((image) => /butterfly/i.test(image.title)), 'the butterfly stays out (#321): four fitting images leave it no place');
});

test('a motif noun still ranks first (#244)', async () => {
  const { fetcher } = commons({ 'hydrangea watercolor blue': [
    'Blue striped butterfly',
    'Hydrangea (Hortensia)',
    'Hydrangea by Nakamura Hochu',
  ] });
  const found = await searchReferenceImages('hydrangea watercolor blue', { fetcher, sources });
  // The two hydrangeas come first; the butterfly only fills the place they leave (2026-11-12), never the first one.
  assert.deepEqual(found.map((image) => image.title), ['Hydrangea (Hortensia)', 'Hydrangea by Nakamura Hochu', 'Blue striped butterfly']);
});
