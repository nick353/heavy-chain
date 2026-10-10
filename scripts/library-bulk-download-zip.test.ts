import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { uniqueZipName } from '../src/lib/clientImageOps.ts';

test('same-titled assets get distinct names inside the ZIP', () => {
  const files: Array<{ name: string }> = [];
  for (let i = 0; i < 3; i++) files.push({ name: uniqueZipName(files, 'chain', 'png') });
  assert.deepEqual(files.map((file) => file.name), ['chain.png', 'chain (2).png', 'chain (3).png']);
});

test('library bulk download no longer fires simultaneous downloads', () => {
  for (const page of ['src/pages/LightchainLibraryPage.tsx', 'src/pages/LightchainParityPages.tsx']) {
    const source = readFileSync(page, 'utf8');
    assert.doesNotMatch(source, /Promise\.all\([^)]*downloadValidatedImage/);
    assert.match(source, /downloadImagesAsZip\(/);
  }
});
