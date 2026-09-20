import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  formatShortcutKeys,
  formatShortcutLabel,
  getShortcutModifier,
} from '../src/lib/keyboardShortcutPlatform.ts';

test('uses the Apple modifier on macOS and iOS platforms', () => {
  assert.equal(getShortcutModifier('MacIntel'), '⌘');
  assert.deepEqual(formatShortcutKeys(['⌘', 'Shift', 'Z'], 'Mac OS X'), ['⌘', 'Shift', 'Z']);
  assert.equal(formatShortcutLabel('⌘D', 'iPhone'), '⌘D');
});

test('uses Ctrl on Windows and other desktop platforms', () => {
  assert.equal(getShortcutModifier('Win32'), 'Ctrl');
  assert.deepEqual(formatShortcutKeys(['⌘', 'Z'], 'Win32'), ['Ctrl', 'Z']);
  assert.equal(formatShortcutLabel('⌘+V', 'Linux x86_64'), 'Ctrl+V');
});

test('does not require navigator during server-side rendering', () => {
  assert.equal(getShortcutModifier(''), 'Ctrl');
  assert.deepEqual(formatShortcutKeys(['G', 'L'], ''), ['G', 'L']);
});

test('Canvas multi-select keeps Mac Cmd/Shift and adds Windows/Linux Ctrl', async () => {
  const source = await readFile(new URL('../src/components/canvas/InfiniteCanvas.tsx', import.meta.url), 'utf8');
  assert.match(
    source,
    /const isMultiSelect = e\.evt\.shiftKey \|\| e\.evt\.metaKey \|\| e\.evt\.ctrlKey;/,
  );
});
