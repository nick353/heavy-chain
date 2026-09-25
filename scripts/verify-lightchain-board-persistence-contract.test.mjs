import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/pages/LightchainBoardPage.tsx', import.meta.url), 'utf8');

test('design-document Board keeps its own source-shaped persistence namespace', () => {
  assert.match(source, /LIGHTCHAIN_BOARD_STORAGE_KEY = 'heavy-chain:lightchain-board-documents:v1'/);
  assert.match(source, /fillSourceBoardDocuments/);
  assert.match(source, /lightchain-board-seed-\$\{index \+ 1\}/);
  assert.match(source, /Math\.max\(0, seededDocuments\.length - documents\.length\)/);
});

test('Board readback merges persisted artifacts without replacing real user documents', () => {
  assert.match(source, /listWorkspaceArtifacts\(brandId, userId/);
  assert.match(source, /const merged = \[\.\.\.stored, \.\.\.artifacts\]/);
  assert.match(source, /seen\.has\(document\.id\)/);
  assert.match(source, /window\.localStorage\.setItem\(LIGHTCHAIN_BOARD_STORAGE_KEY/);
});
