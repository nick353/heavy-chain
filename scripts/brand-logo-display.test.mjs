import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/pages/BrandSettingsPage.tsx', 'utf8');

test('brand logo renders only the resolved display URL, never the stored media path', () => {
  assert.match(source, /src=\{logoDisplayUrl\}/);
  assert.doesNotMatch(source, /src=\{logoDisplayUrl \|\| currentBrand\.logo_url/);
});

test('a new logo clears the previous load failure', () => {
  assert.match(source, /setLogoLoadFailed\(false\);\s*if \(!source\)/);
});
