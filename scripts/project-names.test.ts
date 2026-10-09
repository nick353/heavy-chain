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

test('an untitled project takes its name from the request being generated', async () => {
  const { namedProjectTitle, isPlaceholderProjectTitle } = await import('../src/lib/projectNames.ts');
  assert.equal(namedProjectTitle('Untitled', 'この黒TシャツのInstagram投稿用の正方形画像を作ってください。'), 'この黒TシャツのInstagram投稿用の正方形…');
  assert.equal(namedProjectTitle('プロジェクト名', '襟を変える'), '襟を変える');
  assert.equal(namedProjectTitle('model', '襟を変える'), 'model');
  assert.equal(namedProjectTitle('Untitled', '   '), 'Untitled');
  assert.ok(isPlaceholderProjectTitle(' Untitled '));
  assert.ok(!isPlaceholderProjectTitle('tshirt'));
});

test('a saved result without a title is named after its primary material', async () => {
  const { projectTitleFromMetadata } = await import('../src/lib/projectNames.ts');
  assert.equal(projectTitleFromMetadata({ materialReferences: [{ key: 'secondary', fileName: 'chain.png' }, { key: 'primary', fileName: 'tshirt.png' }] }), 'tshirt');
  assert.equal(projectTitleFromMetadata({ materialReferences: [{ key: 'reference', fileName: 'model.jpg' }] }), 'model');
  assert.equal(projectTitleFromMetadata({}), 'Untitled');
});
