import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isDownloadWatermarkOn,
  readWatermarkPreference,
  setWatermarkUser,
  watermarkLayout,
  writeWatermarkPreference,
} from '../src/lib/watermarkPreference.ts';
import { watermarkImageBlobIfOn } from '../src/lib/imageDownload.ts';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

test('the switch is stored per user and read back for the signed-in user only', () => {
  (globalThis as { localStorage?: unknown }).localStorage = memoryStorage();
  writeWatermarkPreference('user-a', true);
  assert.equal(readWatermarkPreference('user-a'), true);
  assert.equal(readWatermarkPreference('user-b'), false);
  setWatermarkUser('user-b');
  assert.equal(isDownloadWatermarkOn(), false);
  setWatermarkUser('user-a');
  assert.equal(isDownloadWatermarkOn(), true);
  setWatermarkUser(null);
  assert.equal(isDownloadWatermarkOn(), false);
  writeWatermarkPreference('user-a', false);
  setWatermarkUser('user-a');
  assert.equal(isDownloadWatermarkOn(), false);
  setWatermarkUser(null);
});

test('keeps the pre-existing storage key so a saved switch survives the change', () => {
  const source = readFileSync(new URL('../src/lib/watermarkPreference.ts', import.meta.url), 'utf8');
  assert.match(source, /heavy:watermark-display:v1:\$\{userId\}/);
});

test('label scales with the image and stays inside the bottom-right corner', () => {
  const small = watermarkLayout(512, 512);
  const large = watermarkLayout(4096, 2048);
  assert.ok(large.fontSize > small.fontSize);
  assert.ok(small.fontSize >= 12);
  assert.ok(small.x < 512 && small.y < 512);
  assert.ok(large.x < 4096 && large.y < 2048);
});

test('with the switch off, editor and ZIP downloads keep the original bytes', async () => {
  setWatermarkUser(null);
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  assert.equal(await watermarkImageBlobIfOn(blob), blob);
  const svg = new Blob(['<svg/>'], { type: 'image/svg+xml' });
  assert.equal(await watermarkImageBlobIfOn(svg), svg);
});

test('every image download path goes through the watermark', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(read('src/lib/imageDownload.ts'), /convertImageBlob\(sourceBlob, format, errorPrefix, isDownloadWatermarkOn\(\)\)/);
  assert.match(read('src/lib/imageDownload.ts'), /if \(!watermark && source\.type\.toLowerCase\(\) === mimeType\) return source;/);
  for (const path of [
    'src/lib/clientImageOps.ts',
    'src/features/designDetail/DesignEntryDetailPage.tsx',
    'src/pages/PatternDesignDetailPage.tsx',
    'src/pages/PrintDesignDetailPage.tsx',
    'src/pages/ChangeColorDetailPage.tsx',
    'src/pages/CanvasEditorPage.tsx',
  ]) {
    assert.match(read(path), /watermarkImageBlobIfOn\(/, path);
  }
  assert.match(read('src/components/layout/Layout.tsx'), /setWatermarkUser\(user\?\.id\)/);
});
