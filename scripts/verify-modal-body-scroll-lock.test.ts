import assert from 'node:assert/strict';
import test from 'node:test';
import { createModalBodyScrollLock } from '../src/components/ui/modalBodyScrollLock.ts';

test('closing one of two open modals keeps body scrolling locked', () => {
  const target = { style: { overflow: 'auto' } };
  const coordinator = createModalBodyScrollLock();
  const releaseFirst = coordinator.acquire(target);
  const releaseSecond = coordinator.acquire(target);
  assert.equal(target.style.overflow, 'hidden');
  assert.equal(coordinator.getLockCount(), 2);
  releaseFirst();
  assert.equal(target.style.overflow, 'hidden');
  assert.equal(coordinator.getLockCount(), 1);
  releaseSecond();
  assert.equal(target.style.overflow, 'auto');
  assert.equal(coordinator.getLockCount(), 0);
});

test('a release function is idempotent and restores the exact original overflow', () => {
  const target = { style: { overflow: 'clip' } };
  const coordinator = createModalBodyScrollLock();
  const release = coordinator.acquire(target);
  release();
  release();
  assert.equal(target.style.overflow, 'clip');
  assert.equal(coordinator.getLockCount(), 0);
});
