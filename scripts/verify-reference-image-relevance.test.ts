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
