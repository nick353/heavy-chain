import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = new URL('../src/components/ImageSelector.tsx', import.meta.url);

const readSource = () => readFile(sourcePath, 'utf8');

test('clears the file input immediately before opening the picker', async () => {
  const source = await readSource();
  const pickerStart = source.indexOf('const openFilePicker = () => {');
  const pickerEnd = source.indexOf('\n  };', pickerStart);
  assert.ok(pickerStart >= 0 && pickerEnd > pickerStart, 'picker helper must be present');
  const picker = source.slice(pickerStart, pickerEnd);

  assert.match(picker, /const input = fileInputRef\.current;/);
  assert.match(picker, /if \(!input\) return;/);
  assert.match(picker, /input\.value = '';/);
  assert.match(picker, /input\.click\(\);/);
  assert.ok(picker.indexOf("input.value = '';") < picker.indexOf('input.click();'));
});

test('keeps selection processing asynchronous and preserves cancel, drop, and delete paths', async () => {
  const source = await readSource();
  const selectStart = source.indexOf('const handleFileSelect =');
  const selectEnd = source.indexOf('\n  };', selectStart);
  assert.ok(selectStart >= 0 && selectEnd > selectStart, 'file-select handler must be present');
  const handler = source.slice(selectStart, selectEnd);

  assert.match(handler, /Array\.from\(e\.target\.files \?\? \[\]\)/);
  assert.match(handler, /void processFiles\(files\);/);
  assert.doesNotMatch(handler, /e\.target\.value\s*=\s*''/);
  assert.match(source, /const handleDrop = \(e: React\.DragEvent\) => \{[\s\S]*?void processFiles\(e\.dataTransfer\.files\);/);
  assert.match(source, /const removeImage = \(\) => \{[\s\S]*?fileInputRef\.current\.value = '';/);
});

test('routes every Light and Heavy-compatible picker entry through the reset helper', async () => {
  const source = await readSource();
  assert.equal((source.match(/openFilePicker\(\)/g) ?? []).length, 1);
  assert.equal((source.match(/onClick=\{openFilePicker\}/g) ?? []).length, 3);
  assert.doesNotMatch(source, /fileInputRef\.current\?\.click\(\)/);
});
