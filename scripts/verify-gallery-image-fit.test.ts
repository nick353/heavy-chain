import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fitContain } from '../src/lib/galleryImageFit.ts';

const galleryPage = await readFile(new URL('../src/pages/GalleryPage.tsx', import.meta.url), 'utf8');

test('fitContain constrains a desktop square image to the measured content height', () => {
  assert.deepEqual(fitContain({ naturalW: 1024, naturalH: 1024, availW: 912, availH: 488 }), {
    width: 488,
    height: 488,
  });
});

test('fitContain contains tall and wide images without changing their aspect ratio', () => {
  assert.deepEqual(fitContain({ naturalW: 768, naturalH: 1536, availW: 912, availH: 488 }), {
    width: 244,
    height: 488,
  });
  assert.deepEqual(fitContain({ naturalW: 2048, naturalH: 512, availW: 912, availH: 488 }), {
    width: 912,
    height: 228,
  });
});

test('fitContain responds to narrower and resized viewports', () => {
  assert.deepEqual(fitContain({ naturalW: 1024, naturalH: 1024, availW: 311, availH: 400 }), {
    width: 311,
    height: 311,
  });
  assert.deepEqual(fitContain({ naturalW: 1024, naturalH: 1024, availW: 500, availH: 300 }), {
    width: 300,
    height: 300,
  });
  assert.deepEqual(fitContain({ naturalW: 1024, naturalH: 1024, availW: 720, availH: 500 }), {
    width: 500,
    height: 500,
  });
});

test('fitContain does not upscale small images', () => {
  assert.deepEqual(fitContain({ naturalW: 300, naturalH: 200, availW: 912, availH: 488 }), {
    width: 300,
    height: 200,
  });
});

test('fitContain rejects zero, negative, and non-finite dimensions', () => {
  assert.equal(fitContain({ naturalW: 0, naturalH: 1024, availW: 912, availH: 488 }), null);
  assert.equal(fitContain({ naturalW: 1024, naturalH: Number.NaN, availW: 912, availH: 488 }), null);
  assert.equal(fitContain({ naturalW: 1024, naturalH: 1024, availW: Number.POSITIVE_INFINITY, availH: 488 }), null);
  assert.equal(fitContain({ naturalW: 1024, naturalH: 1024, availW: -1, availH: 488 }), null);
});

test('Gallery lightbox wires measured bounds and natural dimensions into fitContain', () => {
  assert.match(galleryPage, /import \{ fitContain \} from '\.\.\/lib\/galleryImageFit'/);
  assert.match(galleryPage, /galleryContentBox\?\.imageId === selectedImage\.id[\s\S]*?galleryNaturalSize\?\.imageId === selectedImage\.id/);
  assert.match(galleryPage, /fitContain\(\{[\s\S]*?naturalW: galleryNaturalSize\.width[\s\S]*?availH: galleryContentBox\.height/);
  assert.match(galleryPage, /useLayoutEffect\(\(\) => \{[\s\S]*?const imageId = selectedImage\?\.id[\s\S]*?new ResizeObserver\(measureContentBox\)[\s\S]*?\}, \[selectedImage\?\.id\]\);/);
  assert.match(galleryPage, /new ResizeObserver\(measureContentBox\)/);
  assert.match(galleryPage, /window\.getComputedStyle\(pane\)/);
  assert.match(galleryPage, /pane\.clientWidth[\s\S]*?style\.paddingLeft[\s\S]*?style\.paddingRight/);
  assert.match(galleryPage, /pane\.clientHeight[\s\S]*?style\.paddingTop[\s\S]*?style\.paddingBottom/);
  assert.match(galleryPage, /ref=\{galleryImagePaneRef\} className="[^"]*min-h-0 min-w-0/);
  assert.match(galleryPage, /className="relative w-full h-full[^"]*max-w-full max-h-full/);
  assert.match(galleryPage, /width: event\.currentTarget\.naturalWidth/);
  assert.match(galleryPage, /height: event\.currentTarget\.naturalHeight/);
  assert.match(galleryPage, /style=\{fittedGalleryImageSize \?\? undefined\}/);
  assert.match(galleryPage, /key=\{selectedImage\.id\}/);
  assert.match(galleryPage, /onError=\{\(\) => \{[\s\S]*?setFailedImageIds/);
});

test('gallery grid cards ask the media gateway for the thumbnail variant only', async () => {
  const { thumbnailImageUrl } = await import('../src/lib/mediaThumbnail.ts');
  const signed = 'https://heavy-chain-api.example.workers.dev/v1/media/read?token=abc.def';
  assert.equal(thumbnailImageUrl(signed), `${signed}&variant=thumb`);
  for (const other of ['data:image/png;base64,AAAA', 'blob:https://heavy.test/1', '/lightchain-assets/a.webp', 'https://example.com/v1/media/read?bucket=x']) {
    assert.equal(thumbnailImageUrl(other), other);
  }
  assert.equal(thumbnailImageUrl(null), undefined);
  assert.match(galleryPage, /src=\{thumbnailImageUrl\(getImageUrl\(image\)\)\}/);
});
