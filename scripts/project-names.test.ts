import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectNameFromFile, projectNameFromPrompt } from '../src/lib/projectNames.ts';
test('project names come from the first file or request', () => {
  assert.equal(projectNameFromFile('tshirt.png'), 'tshirt');
  assert.equal(projectNameFromFile(''), 'Untitled');
  assert.equal(projectNameFromFile('911c8b3d-4aaf-48fb-b89e-8dba936fc4b1'), 'Untitled');
  assert.equal(projectNameFromPrompt('この黒Tシャツの Instagram 投稿用の正方形画像を作ってください'), 'この黒Tシャツの Instagram 投稿用の正…');
  assert.equal(projectNameFromPrompt('  '), 'Untitled');
});
