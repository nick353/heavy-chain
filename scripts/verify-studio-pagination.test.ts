import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPageItems } from '../src/lib/studioPagination.ts';

test('page list handles zero and one actual pages', () => {
  assert.deepEqual(buildPageItems(1, 0), []);
  assert.deepEqual(buildPageItems(1, 1), [1]);
});

test('page list shows every page when total is at most seven', () => {
  assert.deepEqual(buildPageItems(4, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test('page list adds ellipses around the current window for larger totals', () => {
  assert.deepEqual(buildPageItems(10, 20), [1, 'ellipsis', 9, 10, 11, 'ellipsis', 20]);
  assert.deepEqual(buildPageItems(1, 20), [1, 2, 3, 4, 5, 'ellipsis', 20]);
  assert.deepEqual(buildPageItems(20, 20), [1, 'ellipsis', 16, 17, 18, 19, 20]);
});

test('current page is clamped to real total bounds', () => {
  assert.deepEqual(buildPageItems(99, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(buildPageItems(0, 8), [1, 2, 3, 4, 5, 'ellipsis', 8]);
  assert.deepEqual(buildPageItems(Number.NaN, 1), [1]);
});
