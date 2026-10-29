import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cardButton } from '../src/lib/cardButton.ts';

test('a project card is a focusable button that opens on click, Enter and Space', () => {
  let opened = 0;
  const props = cardButton(() => { opened++; });
  assert.equal(props.role, 'button');
  assert.equal(props.tabIndex, 0);
  props.onClick();
  const card = {};
  const key = (value: string, target: object = card) => {
    let prevented = false;
    props.onKeyDown({ key: value, target, currentTarget: card, preventDefault: () => { prevented = true; } } as never);
    return prevented;
  };
  assert.equal(key('Enter'), true);
  assert.equal(key(' '), true);
  assert.equal(key('a'), false);
  // Keys on a menu button inside the card belong to that button.
  assert.equal(key('Enter', {}), false);
  assert.equal(opened, 3);
});

test('the lab, pattern and wear-design cards use it instead of a bare clickable div', async () => {
  const pages = await Promise.all(['LabPage', 'PatternProjectDashboardPage', 'LightchainParityPages']
    .map((name) => readFile(new URL(`../src/pages/${name}.tsx`, import.meta.url), 'utf8')));
  assert.equal((pages[0].match(/\{\.\.\.cardButton\(/g) ?? []).length, 2);
  assert.equal((pages[1].match(/\{\.\.\.cardButton\(/g) ?? []).length, 3);
  assert.equal((pages[2].match(/\{\.\.\.cardButton\(/g) ?? []).length, 2);
  for (const page of pages) assert.doesNotMatch(page, /<div onClick=\{\(\) => navigate\(/);
});
