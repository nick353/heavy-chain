import assert from 'node:assert/strict';
import test from 'node:test';
import { clampFloatingToolbarPosition } from '../src/components/canvas/floatingToolbarPosition.ts';

test('floating toolbar remains inside the viewport for top and right edge selections', () => {
  assert.deepEqual(clampFloatingToolbarPosition({
    anchorX: 200, anchorY: 7, toolbarWidth: 320, toolbarHeight: 48,
    viewportWidth: 390, viewportHeight: 844,
  }), { left: 40, top: 8 });
  assert.deepEqual(clampFloatingToolbarPosition({
    anchorX: 900, anchorY: 700, toolbarWidth: 360, toolbarHeight: 48,
    viewportWidth: 1024, viewportHeight: 768,
  }), { left: 656, top: 640 });
});
