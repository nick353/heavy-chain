import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = readFileSync(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');

test('design project cards show the first canvas image like Light (measured 2026-10-29)', () => {
  assert.match(pages, /if \(entry\.coverPath\) void designCoverUrl\(entry\.coverPath\)/);
  assert.match(pages, /data-testid="design-project-cover"/);
  // The box icon stays only for projects with no image yet.
  assert.match(pages, /: <img src=\{DESIGN_PROJECT_DEFAULT_COVER\}/);
});
