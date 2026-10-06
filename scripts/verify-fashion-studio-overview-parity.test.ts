import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../src/pages/FashionStudioPage.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');

test('new-file tile uses one dark surface with a centered source icon and label', () => {
  const start = page.indexOf('data-testid="lightchain-fashion-studio-new-file"');
  assert.notEqual(start, -1);
  const end = page.indexOf('</div>', start) + '</div>'.length;
  const tile = page.slice(start, end);

  assert.match(tile, /className="studio-new-file-card group/);
  assert.match(tile, /src="\/lightchain-oriented-design-icon\.svg"/);
  assert.match(tile, /className="studio-new-file-label">新規ファイル/);
  assert.doesNotMatch(tile, /radial-gradient|absolute bottom-0|h-40|w-20/);
  assert.match(css, /\.fashion-studio-overview-parity > section > div:nth-child\(2\) > \.studio-new-file-card \{ display: flex; flex-direction: column; align-items: center; justify-content: center;/);
});

test('saved card title and date use lighter visual weight and color', () => {
  assert.match(page, /className="studio-project-title[^\"]*font-normal[^\"]*"/);
  assert.match(page, /className="studio-project-date[^\"]*text-neutral-400"/);
  assert.match(css, /\.fashion-studio-overview-parity \.studio-project-title \{ font-weight: 400; \}/);
  assert.match(css, /\.fashion-studio-overview-parity \.studio-project-date \{ color: #a3a3a3; \}/);
});

test('numbered pagination is based only on actual merged card count', () => {
  assert.match(page, /const projectPageCount = Math\.max\(1, Math\.ceil\(allProjectCards\.length \/ projectsPerPage\)\)/);
  assert.match(page, /const pageItems = buildPageItems\(currentProjectPage, projectPageCount\)/);
  assert.match(page, /import \{ buildPageItems \} from '\.\.\/lib\/studioPagination'/);
  assert.match(page, /aria-current=\{currentProjectPage === item \? 'page' : undefined\}/);
  assert.match(page, /onClick=\{\(\) => setProjectPage\(item\)\}/);
  assert.match(page, /key=\{`ellipsis-\$\{index\}`\}[\s\S]*?aria-hidden="true"[^>]*>…<\/span>/);
  assert.match(page, /disabled=\{currentProjectPage === 1\}/);
  assert.match(page, /disabled=\{currentProjectPage === projectPageCount\}/);
  assert.doesNotMatch(page, /\bprojectPageCount\s*=\s*6\b/);
});
