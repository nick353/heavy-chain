import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('workbench grids that only define columns at lg/xl get a single shrinkable column on phones', () => {
  const page = read('src/pages/LightchainWorkbenchPage.tsx');
  for (const match of page.matchAll(/className=[{"`][^"`]*?\b(?:lg|xl):grid-cols-\[[^\]]+\][^"`]*/g)) {
    assert.match(match[0], /grid-cols-\[minmax\(0,1fr\)\]/, `missing base column: ${match[0].slice(0, 120)}`);
  }
  assert.match(page, /relative grid min-h-\[calc\(100vh-50px\)\] grid-cols-\[minmax\(0,1fr\)\] lg:h-\[calc\(100vh-50px\)\] lg:overflow-clip/);
});

test('design workspace and library fit narrow screens without changing the desktop layout', () => {
  const css = read('src/index.css');
  const narrow = css.slice(css.indexOf('/* Narrow screens: the design workspace'));
  assert.match(narrow, /@media \(max-width: 1023px\) \{[^}]*design-dialogue-tabpanel"\] \{ left: 0; width: 100%; transform: none; \}/);
  assert.match(narrow, /design-dialogue-scenes"\] \{ width: 100%; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\n\.asset-center-parity \.asset-center-card-media \{ aspect-ratio: 0\.79024; \}/);
  const library = read('src/pages/LightchainLibraryPage.tsx');
  assert.match(library, /data-testid="library-mobile-groups" className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden"/);
  const parity = read('src/pages/LightchainParityPages.tsx');
  assert.match(parity, /justify-start gap-4 overflow-x-auto rounded-xl lg:justify-center/);
});

test('admin tabs stay on one scrollable line on phones', () => {
  const admin = read('src/pages/AdminDashboard.tsx');
  assert.match(admin, /flex max-w-full gap-1 overflow-x-auto p-1/);
  assert.match(admin, /shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium rounded-lg/);
});
