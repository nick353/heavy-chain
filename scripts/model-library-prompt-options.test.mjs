import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/lib/modelLibrarySettings.ts', 'utf8');

test('おまかせ (stored スマート) is sent as おまかせ, not スマート which reads as "slim"', () => {
  assert.match(source, /promptOption = \(option: unknown\) => option === 'スマート' \? 'おまかせ（指定なし）' : String\(option\)/);
  for (const key of ['age', 'nationality', 'skinColor', 'bodyType']) assert.match(source, new RegExp(`promptOption\\(settings\\.${key}\\)`));
});
