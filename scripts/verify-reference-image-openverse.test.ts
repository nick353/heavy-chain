import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foundImageCredit, foundImageFile, openverseLicenseName, REFERENCE_IMAGE_SOURCES, searchReferenceImages } from '../src/features/designDetail/referenceImageSearch.ts';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const openverseItem = (id: string, title: string, license: string, extra: Record<string, unknown> = {}) => ({
  id, title, creator: `creator ${id}`, license, license_version: license === 'cc0' ? '1.0' : '2.0', license_url: `https://creativecommons.org/licenses/${license}/2.0/`,
  foreign_landing_url: `https://www.flickr.com/photos/x/${id}`, url: `https://live.staticflickr.com/${id}_b.jpg`,
  thumbnail: `https://api.openverse.org/v1/images/${id}/thumb/`, source: 'flickr', filetype: null, ...extra,
});
const commonsPage = (id: number, title: string) => ({ pageid: id, index: id, title: `File:${title}.jpg`, imageinfo: [{ thumburl: `https://upload.wikimedia.org/${id}.jpg`,
  descriptionurl: `https://commons.wikimedia.org/wiki/File:${id}.jpg`, mime: 'image/jpeg',
  extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' }, Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Someone">Some&nbsp;One</a>' } } }] });

test('Openverse is asked first, only for images that may be used commercially and changed', async () => {
  const calls: URL[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(init?.credentials, 'omit');
    return json({ result_count: 5, results: [
      openverseItem('a', 'Linen dress with applique', 'by-sa'),
      openverseItem('b', 'Summer linen dress', 'by'),
      openverseItem('c', 'No derivatives dress', 'by-nd'),
      openverseItem('d', 'Non commercial dress', 'by-nc-sa'),
      openverseItem('e', 'Public domain dress', 'cc0'),
      openverseItem('f', 'Vector dress', 'by', { filetype: 'svg' }),
      openverseItem('g', 'Linen dress pattern', 'pdm'),
    ] });
  }) as typeof fetch;
  const found = await searchReferenceImages('linen dress', { fetcher });
  assert.equal(calls.length, 1, 'Openverse found four images whose titles name the query, so Wikimedia is not asked');
  assert.equal(calls[0].origin + calls[0].pathname, 'https://api.openverse.org/v1/images/');
  assert.equal(calls[0].searchParams.get('license_type'), 'commercial,modification');
  assert.equal(calls[0].searchParams.get('mature'), 'false');
  assert.deepEqual(found.map((image) => image.title), ['Linen dress with applique', 'Summer linen dress', 'Public domain dress', 'Linen dress pattern']);
  assert.deepEqual(found.map((image) => image.license), ['CC BY-SA 2.0', 'CC BY 2.0', 'CC0 1.0', 'Public Domain Mark 1.0']);
  assert.equal(found[0].creator, 'creator a');
  assert.equal(found[0].pageUrl, 'https://www.flickr.com/photos/x/a');
  assert.equal(found[0].imageUrl, 'https://live.staticflickr.com/a_b.jpg');
  assert.equal(found[0].thumbUrl, 'https://api.openverse.org/v1/images/a/thumb/');
  assert.equal(found[0].source, 'openverse');
  assert.equal(foundImageCredit(found[0]), 'creator a / CC BY-SA 2.0');
});

test('over the keyless rate limit (429) or on a failure, the same search goes to Wikimedia Commons', async () => {
  for (const status of [429, 504]) {
    const hosts: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input)); hosts.push(url.host);
      if (url.host === 'api.openverse.org') return json({ detail: 'Request was throttled.' }, status);
      return json({ query: { pages: { 1: commonsPage(1, 'Pleated skirt (AM 1)'), 2: commonsPage(2, 'Pleated skirt (AM 2)') } } });
    }) as typeof fetch;
    const found = await searchReferenceImages('pleated skirt', { fetcher, limit: 2 });
    assert.equal(hosts[0], 'api.openverse.org');
    assert.equal(hosts[1], 'commons.wikimedia.org');
    assert.deepEqual(found.map((image) => image.title), ['Pleated skirt (AM 1)', 'Pleated skirt (AM 2)']);
    assert.equal(found[0].source, 'wikimedia');
    assert.equal(foundImageCredit(found[0]), 'Some One / CC BY-SA 4.0');
  }
});

test('when Openverse finds too few images that name the query, Wikimedia fills the rest and the named ones come first (#244)', async () => {
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.host === 'api.openverse.org') return json({ results: [openverseItem('w', 'Great Western Windmill', 'by'), openverseItem('s', 'Smocked blouse', 'by')] });
    const search = url.searchParams.get('gsrsearch');
    return json(search === 'smocked filetype:bitmap' ? { query: { pages: { 7: commonsPage(7, 'A traditional smock') } } } : { batchcomplete: '' });
  }) as typeof fetch;
  const found = await searchReferenceImages('smocked', { fetcher, limit: 3 });
  assert.deepEqual(found.map((image) => image.title), ['Smocked blouse', 'A traditional smock', 'Great Western Windmill']);
});

test('every source failing is a failure (the screen says no images were found)', async () => {
  const fetcher = (async () => json({}, 503)) as typeof fetch;
  await assert.rejects(searchReferenceImages('dress', { fetcher }), /reference_image_source_wikimedia_503/);
});

test('the chosen Openverse image uploads the larger file, and the thumbnail when that cannot be read', async () => {
  const image = { id: 'openverse-a', title: 'A', thumbUrl: 'https://api.openverse.org/v1/images/a/thumb/', imageUrl: 'https://example.org/a.jpg', pageUrl: '', license: 'CC BY 2.0' };
  const read: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    read.push(String(input));
    return String(input).startsWith('https://example.org/') ? new Response('nope', { status: 403 })
      : new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
  }) as typeof fetch;
  const file = await foundImageFile(image, fetcher);
  assert.deepEqual(read, ['https://example.org/a.jpg', 'https://api.openverse.org/v1/images/a/thumb/']);
  assert.equal(file.name, 'search-openverse-a.jpg');
});

test('licence names and the order of the sources', () => {
  assert.equal(openverseLicenseName('by-sa', '4.0'), 'CC BY-SA 4.0');
  assert.equal(openverseLicenseName('pdm', '1.0'), 'Public Domain Mark 1.0');
  assert.deepEqual(REFERENCE_IMAGE_SOURCES.map((source) => source.name), ['openverse', 'wikimedia']);
});

test('both pickers show the creator and licence under each found image, linked to its page', () => {
  for (const file of ['../src/features/designDetail/AssistantImageSearchCard.tsx', '../src/features/agent/AgentDialogueView.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /<FoundImageCredit image=\{image\} \/>/, file);
    assert.match(source, /FOUND_IMAGE_SOURCES_NOTE/, file);
    assert.doesNotMatch(source, /画像: Wikimedia Commons（/, file);
  }
  const credit = readFileSync(new URL('../src/features/designDetail/FoundImageCredit.tsx', import.meta.url), 'utf8');
  assert.match(credit, /rel="noopener noreferrer"/);
});
