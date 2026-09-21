import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('Light color-change entry keeps the direct colorize workflow and durable result promotion', async () => {
  const source = await read('src/pages/GeneratePage.tsx');
  const colorizeStart = source.lastIndexOf("case 'colorize':");
  const colorizeEnd = source.indexOf("case 'upscale':", colorizeStart);
  assert.ok(colorizeStart >= 0 && colorizeEnd > colorizeStart, 'colorize form must remain addressable');
  const colorizeForm = source.slice(colorizeStart, colorizeEnd);

  assert.match(source, /window\.location\.pathname\.startsWith\('\/editor\/changeColor'\)/);
  assert.match(colorizeForm, /<ImageSelector[\s\S]*required/);
  assert.match(colorizeForm, /色変更/);
  assert.match(source, /invokeProviderAction\('colorize'/);
  assert.match(source, /assertGeneratedResponseAccepted\(data\)/);
  assert.match(source, /assertMaterializedGeneratedImages\(newGeneratedImages\)/);
  assert.match(source, /saveLocalArtifactsWithReadback\(newGeneratedImages\.map/);
  assert.match(source, /addToHistory\(promptToSave/);
  assert.match(source, /Canvas/);
  assert.doesNotMatch(colorizeForm, /type=["']checkbox["']/);
});

test('Light partial-edit chat states target and action before submission', async () => {
  const source = await read('src/components/ChatEditor.tsx');
  assert.match(source, /data-testid="chat-edit-context"/);
  assert.match(source, /編集対象:/);
  assert.match(source, /操作:/);
  assert.match(source, /currentImage \? '画像を編集' : '画像を生成'/);
  assert.match(source, /if \(currentImage\)[\s\S]*editImageWithPrompt\(currentImage, userInput/);
  assert.match(source, /onEditResult\?\./);
  assert.doesNotMatch(source, /type=["']checkbox["']/);
});
