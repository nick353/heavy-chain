import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchValidatedImageBlob, getImageDownloadFormat } from '../src/lib/imageDownload.ts';

test('infers the requested output format from the download filename', () => {
  assert.equal(getImageDownloadFormat('result.png'), 'png');
  assert.equal(getImageDownloadFormat('result.jpeg'), 'jpeg');
  assert.equal(getImageDownloadFormat('result.jpg'), 'jpeg');
  assert.equal(getImageDownloadFormat('result.webp'), 'webp');
  assert.equal(getImageDownloadFormat('result.unknown'), 'png');
});

test('rejects an empty image URL before fetching', async () => {
  await assert.rejects(
    fetchValidatedImageBlob('  ', 'download'),
    /download_url_unavailable/,
  );
});

test('rejects an HTTP success response that is not an image', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>error</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
  try {
    await assert.rejects(
      fetchValidatedImageBlob('https://example.test/result', 'download'),
      /download_not_image/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('accepts a non-empty image blob from an OK response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
  try {
    const blob = await fetchValidatedImageBlob('https://example.test/result', 'download');
    assert.equal(blob.type, 'image/png');
    assert.equal(blob.size, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps browser format conversion on the non-pending data URL path', async () => {
  const implementation = readFileSync(new URL('../src/lib/imageDownload.ts', import.meta.url), 'utf8');
  assert.match(implementation, /canvas\.toDataURL/);
  assert.match(implementation, /new Blob\(\[bytes\], \{ type: mimeType \}\)/);
  assert.doesNotMatch(implementation, /canvas\.toBlob/);
});
