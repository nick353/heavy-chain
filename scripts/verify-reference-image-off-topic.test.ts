import test from 'node:test';
import assert from 'node:assert/strict';
import { openverseSource, referenceImageFit } from '../src/features/designDetail/referenceImageSearch.ts';

// 2026-11-13 production: a lunar crater named Jeans and a painting on linen came up as clothing references.
test('a crater or a painting that only shares the garment or fabric word is dropped', () => {
  assert.equal(referenceImageFit({ title: 'Jeans crater 4006 h3', source: 'wikimedia',
    keywords: ['CC-Zero', 'Jeans (lunar crater)', 'Self-published work', 'Photos of the Moon by Lunar Orbiter spacecraft'] }, 'jeans'), 'off');
  assert.equal(referenceImageFit({ title: 'Portrait of a lady, oil on linen', source: 'wikimedia', keywords: ['Oil paintings'] }, 'natural linen'), 'off');
  assert.equal(referenceImageFit({ title: 'Still life painting on linen canvas', source: 'openverse' }, 'linen'), 'off');
  // Real jeans keep their place, even when a category repeats the title.
  assert.equal(referenceImageFit({ title: 'Jeans mexicanos', source: 'wikimedia', keywords: ['Jeans', 'CC-Zero', 'Self-published work'] }, 'jeans'), 'named');
  assert.equal(referenceImageFit({ title: 'High waisted jeans 1435042736', source: 'wikimedia', keywords: ['Mom jeans', 'Blue jeans', 'Women wearing blue jeans'] }, 'jeans'), 'named');
  assert.equal(referenceImageFit({ title: 'Linen dress, oil on canvas study', source: 'openverse' }, 'linen dress'), 'named');
});

test('Openverse leaves out scanned artworks', async () => {
  const result = (id: string, category: string | null) => ({ id, title: `Linen ${id}`, license: 'by', license_version: '2.0', thumbnail: `https://example.org/${id}.jpg`,
    url: `https://example.org/${id}-large.jpg`, foreign_landing_url: '', filetype: 'jpg', category });
  const fetcher = (async () => new Response(JSON.stringify({ results: [result('a', 'photograph'), result('b', 'digitized_artwork'), result('c', null)] }),
    { headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const found = await openverseSource.search('linen', 4, { fetcher });
  assert.deepEqual(found.map((image) => image.id), ['openverse-a', 'openverse-c']);
});
