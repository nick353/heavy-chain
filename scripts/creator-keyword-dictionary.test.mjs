import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');

test('キーワード辞典 groups open their own words instead of inserting the group name', () => {
  const block = source.slice(source.indexOf('const creatorKeywordDictionary'), source.indexOf('const creatorKeywordPlaceholder'));
  const groups = [...block.matchAll(/group: '([^']+)', words: \[([^\]]+)\]/g)];
  assert.deepEqual(groups.map((match) => match[1]), ['シルエット', '素材感', 'カラー', '柄・プリント', 'シーン', 'ディテール', '季節', '雰囲気', 'アイテム']);
  for (const [, group, words] of groups) assert.ok(words.split(',').length >= 5, `${group} has words`);
  assert.match(source, /onClick=\{\(\) => setDictionaryGroup\(group\)\}/);
  assert.doesNotMatch(source, /setKeywords\(\(value\) => `\$\{value\}\$\{value \? '、' : ''\}\$\{tag\}`\)/);
});
